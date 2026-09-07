const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const {
    masterDb,
    getTenantDB,
    closeTenantDB,
    queryRun,
    queryGet,
    queryAll,
    hashPassword,
    verifyPassword
} = require('./database');

// Serial Number Encoding/Decoding Helpers
function codeToPrefix(code) {
    if (code === 0) return '';
    let prefix = '';
    while (code > 0) {
        let remainder = (code - 1) % 26;
        prefix = String.fromCharCode(65 + remainder) + prefix;
        code = Math.floor((code - 1) / 26);
    }
    return prefix;
}

function prefixToCode(prefix) {
    if (!prefix) return 0;
    prefix = prefix.toUpperCase();
    let code = 0;
    for (let i = 0; i < prefix.length; i++) {
        code = code * 26 + (prefix.charCodeAt(i) - 64);
    }
    return code;
}

function parseBorrowerNo(val) {
    if (!val) return null;
    if (typeof val === 'number') return val;
    val = String(val).trim().toUpperCase();
    const match = val.match(/^([A-Za-z]*)(\d+)$/);
    if (!match) {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? null : parsed;
    }
    const prefix = match[1];
    const num = parseInt(match[2], 10);
    const prefixCode = prefixToCode(prefix);
    return prefixCode * 1000000 + num;
}

function formatBorrowerNo(slNo) {
    if (!slNo) return '';
    const num = slNo % 1000000;
    const prefixCode = Math.floor(slNo / 1000000);
    const prefix = codeToPrefix(prefixCode);
    return prefix + num;
}

function runPowerShell(args) {
    return new Promise((resolve, reject) => {
        const psPath = 'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe';
        execFile(psPath, args, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}


const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'terrasol_finserv_jwt_secret_key_12345';

// Enable CORS and JSON Parsing
app.use(cors());
app.use(express.json({ limit: '10mb' })); // support base64 images uploads

// Serve Frontend Static Files
app.use(express.static(path.join(__dirname, '../')));

// Middleware to Authenticate JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Authentication token required.' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Session expired or invalid token.' });
        }
        req.user = user;
        next();
    });
}

// ----------------------------------------------------
// 1. AUTHENTICATION ENDPOINTS
// ----------------------------------------------------

// User Login
app.post('/api/auth/login', (req, res) => {
    const { username, password, role } = req.body;
    const cleanUser = username.trim().toLowerCase();
    
    if (role === 'admin') {
        masterDb.get('SELECT * FROM super_admins WHERE username = ?', [cleanUser], (err, row) => {
            if (err) return res.status(500).json({ error: 'Database query error.' });
            if (row && verifyPassword(password, row.password)) {
                const token = jwt.sign({ username: cleanUser, role: 'admin', tenantId: 'default_tenant', name: 'Ramachandra', companyName: 'Terrasol FinServ' }, JWT_SECRET, { expiresIn: '8h' });
                return res.json({ token, user: { username: cleanUser, role: 'admin', name: 'Ramachandra', companyName: 'Terrasol FinServ' } });
            }
            return res.status(400).json({ error: 'Invalid security credentials.' });
        });
    } else if (role === 'owner') {
        masterDb.get('SELECT * FROM tenants WHERE username = ?', [cleanUser], (err, row) => {
            if (err) return res.status(500).json({ error: 'Database query error.' });
            if (row && verifyPassword(password, row.password)) {
                const token = jwt.sign({ username: cleanUser, role: 'owner', tenantId: row.tenant_id, name: row.name, companyName: row.company_name }, JWT_SECRET, { expiresIn: '8h' });
                return res.json({ token, user: { username: cleanUser, role: 'owner', name: row.name, companyName: row.company_name } });
            }
            return res.status(400).json({ error: 'Invalid owner credentials.' });
        });
    } else if (role === 'collector') {
        masterDb.get('SELECT tenant_id FROM global_collectors WHERE username = ?', [cleanUser], (err, globalRow) => {
            if (err) return res.status(500).json({ error: 'Database lookup error.' });
            if (!globalRow) return res.status(400).json({ error: 'Invalid collector credentials.' });
            
            // Get owner's company name
            masterDb.get('SELECT company_name FROM tenants WHERE tenant_id = ?', [globalRow.tenant_id], (err, tenantRow) => {
                const companyName = tenantRow ? tenantRow.company_name : null;
                const tenantDb = getTenantDB(globalRow.tenant_id);
                tenantDb.get('SELECT * FROM collectors WHERE username = ?', [cleanUser], (err, collectorRow) => {
                    if (err) return res.status(500).json({ error: 'Database connection error.' });
                    if (collectorRow && verifyPassword(password, collectorRow.password)) {
                        const token = jwt.sign({ username: cleanUser, role: 'collector', tenantId: globalRow.tenant_id, name: collectorRow.name, companyName }, JWT_SECRET, { expiresIn: '8h' });
                        return res.json({ token, user: { username: cleanUser, role: 'collector', name: collectorRow.name, companyName } });
                    }
                    return res.status(400).json({ error: 'Invalid collector credentials.' });
                });
            });
        });
    } else {
        return res.status(400).json({ error: 'Invalid role selection.' });
    }
});

// Register a New Owner (Admin Only)
app.post('/api/auth/register-owner', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Admin privileges required.' });
    }
    
    const { username, name, password } = req.body;
    const cleanUser = username.trim().toLowerCase();
    
    if (cleanUser === 'admin') {
        return res.status(400).json({ error: 'Username "admin" is reserved.' });
    }
    
    try {
        const duplicate = await queryGet(masterDb, 'SELECT * FROM tenants WHERE username = ?', [cleanUser]);
        if (duplicate) {
            return res.status(400).json({ error: 'Username already exists!' });
        }
        
        const tenantId = 'tenant_' + Date.now();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30); // 30 days trial
        
        await queryRun(masterDb, 
            'INSERT INTO tenants (tenant_id, username, name, password, created_at, subscription_status, subscription_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [tenantId, cleanUser, name, hashPassword(password), new Date().toISOString(), 'active', expiresAt.toISOString()]
        );
        
        // Auto-initialize the tenant's SQLite DB
        getTenantDB(tenantId);
        
        return res.json({ success: true, message: `Owner "${name}" added successfully!` });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to create owner account: ' + err.message });
    }
});

// Get All Owners (Admin Only)
app.get('/api/owners', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    try {
        const rows = await queryAll(masterDb, 'SELECT username, name, created_at FROM tenants');
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Delete an Owner (Admin Only)
app.delete('/api/owners/:username', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    const targetUser = req.params.username.trim().toLowerCase();
    
    try {
        const tenant = await queryGet(masterDb, 'SELECT tenant_id FROM tenants WHERE username = ?', [targetUser]);
        if (!tenant) {
            return res.status(404).json({ error: 'Owner account not found.' });
        }
        
        // Close DB connections to release the file lock on Windows systems
        await closeTenantDB(tenant.tenant_id);
        
        // Delete tenant database file
        const dbPath = path.join(__dirname, 'db', `tenant_${tenant.tenant_id}.db`);
        if (fs.existsSync(dbPath)) {
            try {
                fs.unlinkSync(dbPath);
            } catch (fileErr) {
                console.error(`Could not delete tenant file: ${dbPath}. It may be locked or busy.`, fileErr);
            }
        }
        
        // Remove from master db
        await queryRun(masterDb, 'DELETE FROM tenants WHERE username = ?', [targetUser]);
        // Remove any collector associations with this tenant
        await queryRun(masterDb, 'DELETE FROM global_collectors WHERE tenant_id = ?', [tenant.tenant_id]);
        
        return res.json({ success: true, message: 'Owner account and database removed successfully.' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Change Password
app.post('/api/settings/change-password', authenticateToken, async (req, res) => {
    const { newPassword } = req.body;
    
    try {
        if (req.user.role === 'admin') {
            await queryRun(masterDb, 'UPDATE super_admins SET password = ? WHERE username = ?', [newPassword, req.user.username]);
            return res.json({ success: true, message: 'Admin password updated successfully!' });
        } else if (req.user.role === 'owner') {
            await queryRun(masterDb, 'UPDATE tenants SET password = ? WHERE username = ?', [newPassword, req.user.username]);
            return res.json({ success: true, message: 'Owner password updated successfully!' });
        } else {
            return res.status(403).json({ error: 'Unauthorized role operation.' });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Update Company Name (Owner Only)
app.post('/api/tenant/settings/company-name', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Forbidden. Owner privileges required.' });
    }
    const { companyName } = req.body;
    if (!companyName || !companyName.trim()) {
        return res.status(400).json({ error: 'Company name is required.' });
    }
    
    try {
        await queryRun(masterDb, 'UPDATE tenants SET company_name = ? WHERE tenant_id = ?', [companyName.trim(), req.user.tenantId]);
        
        const newToken = jwt.sign({
            username: req.user.username,
            role: 'owner',
            tenantId: req.user.tenantId,
            name: req.user.name,
            companyName: companyName.trim()
        }, JWT_SECRET, { expiresIn: '8h' });
        
        return res.json({
            success: true,
            token: newToken,
            user: {
                username: req.user.username,
                role: 'owner',
                name: req.user.name,
                companyName: companyName.trim()
            }
        });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to update company name: ' + err.message });
    }
});

// Retrieve OAuth Settings (Owner Only)
app.get('/api/tenant/settings/oauth', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Forbidden. Owner privileges required.' });
    }
    const tenantDb = getTenantDB(req.user.tenantId);
    try {
        const rows = await queryAll(tenantDb, 'SELECT * FROM tenant_settings WHERE key LIKE "oauth_%"');
        const settings = {};
        rows.forEach(row => {
            settings[row.key] = row.value;
        });
        return res.json(settings);
    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch OAuth settings: ' + err.message });
    }
});

// Save OAuth Settings (Owner Only)
app.post('/api/tenant/settings/oauth', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Forbidden. Owner privileges required.' });
    }
    const { oauth_enabled, oauth_provider, oauth_client_id, oauth_client_secret } = req.body;
    const tenantDb = getTenantDB(req.user.tenantId);
    
    try {
        await queryRun(tenantDb, 'INSERT OR REPLACE INTO tenant_settings (key, value) VALUES (?, ?)', ['oauth_enabled', String(oauth_enabled)]);
        await queryRun(tenantDb, 'INSERT OR REPLACE INTO tenant_settings (key, value) VALUES (?, ?)', ['oauth_provider', String(oauth_provider || 'google')]);
        await queryRun(tenantDb, 'INSERT OR REPLACE INTO tenant_settings (key, value) VALUES (?, ?)', ['oauth_client_id', String(oauth_client_id || '')]);
        await queryRun(tenantDb, 'INSERT OR REPLACE INTO tenant_settings (key, value) VALUES (?, ?)', ['oauth_client_secret', String(oauth_client_secret || '')]);
        
        return res.json({ success: true, message: 'OAuth settings updated successfully!' });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to update OAuth settings: ' + err.message });
    }
});

// Get all tenant environments (Admin Only)
app.get('/api/admin/tenants', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Admin privileges required.' });
    }
    try {
        const tenants = await queryAll(masterDb, 'SELECT tenant_id, username, name, company_name, created_at FROM tenants');
        const results = [];
        
        for (let tenant of tenants) {
            const dbFile = `tenant_${tenant.tenant_id}.db`;
            const dbPath = path.join(__dirname, 'db', dbFile);
            let sizeBytes = 0;
            let activeLoans = 0;
            let totalCollections = 0;
            
            if (fs.existsSync(dbPath)) {
                const stat = fs.statSync(dbPath);
                sizeBytes = stat.size;
                
                try {
                    const tenantDb = getTenantDB(tenant.tenant_id);
                    const activeLoansRow = await queryGet(tenantDb, "SELECT COUNT(*) as count FROM loans WHERE status = 'Active'");
                    activeLoans = activeLoansRow ? activeLoansRow.count : 0;
                    
                    const collectionsRow = await queryGet(tenantDb, "SELECT COUNT(*) as count FROM collections");
                    totalCollections = collectionsRow ? collectionsRow.count : 0;
                } catch (dbErr) {
                    console.error(`Error querying tenant DB ${tenant.tenant_id}:`, dbErr.message);
                }
            }
            
            results.push({
                tenantId: tenant.tenant_id,
                username: tenant.username,
                name: tenant.name,
                companyName: tenant.company_name || '',
                createdAt: tenant.created_at,
                dbFile,
                dbSizeKb: parseFloat((sizeBytes / 1024).toFixed(2)),
                activeLoans,
                totalCollections
            });
        }
        
        return res.json(results);
    } catch (err) {
        return res.status(500).json({ error: 'Failed to retrieve tenants: ' + err.message });
    }
});

// Admin Export Database for specific tenant
app.post('/api/admin/tenants/:tenantId/export', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    const { tenantId } = req.params;
    try {
        const tenantDb = getTenantDB(tenantId);
        const loans = await queryAll(tenantDb, 'SELECT * FROM loans');
        const collections = await queryAll(tenantDb, 'SELECT * FROM collections');
        const areas = await queryAll(tenantDb, 'SELECT * FROM areas');
        const collectors = await queryAll(tenantDb, 'SELECT * FROM collectors');
        const lines = await queryAll(tenantDb, 'SELECT * FROM lines').catch(() => []);
        
        return res.json({ loans, collections, areas, collectors, lines });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Admin Wipe Database for specific tenant
app.post('/api/admin/tenants/:tenantId/wipe', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    const { tenantId } = req.params;
    try {
        const tenantDb = getTenantDB(tenantId);
        await queryRun(tenantDb, 'DELETE FROM loans');
        await queryRun(tenantDb, 'DELETE FROM collections');
        await queryRun(tenantDb, 'DELETE FROM areas');
        await queryRun(tenantDb, 'DELETE FROM collectors');
        await queryRun(tenantDb, 'DELETE FROM lines').catch(() => {});
        
        // Wiped without re-seeding to remain clean
        
        return res.json({ success: true, message: 'Tenant database wiped successfully.' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Mock Billing Webhook to simulate subscription renewal
app.post('/api/billing/mock-webhook', async (req, res) => {
    const { username, months } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'Username is required.' });
    }
    
    const cleanUser = username.trim().toLowerCase();
    const monthsToExtend = months ? parseInt(months, 10) : 1;
    
    try {
        const tenant = await queryGet(masterDb, 'SELECT * FROM tenants WHERE username = ?', [cleanUser]);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found.' });
        }
        
        let currentExpiry = tenant.subscription_expires_at ? new Date(tenant.subscription_expires_at) : new Date();
        if (currentExpiry < new Date()) {
            currentExpiry = new Date();
        }
        currentExpiry.setMonth(currentExpiry.getMonth() + monthsToExtend);
        
        await queryRun(masterDb, 
            "UPDATE tenants SET subscription_status = 'active', subscription_expires_at = ? WHERE username = ?",
            [currentExpiry.toISOString(), cleanUser]
        );
        
        console.log(`[Billing Webhook] Subscription for ${cleanUser} extended by ${monthsToExtend} months. Expiry: ${currentExpiry.toISOString()}`);
        return res.json({ success: true, message: `Subscription renewed successfully! New expiry: ${currentExpiry.toLocaleDateString()}` });
    } catch (err) {
        return res.status(500).json({ error: 'Billing update failed: ' + err.message });
    }
});

// ----------------------------------------------------
// 2. MULTI-TENANT CORE ENDPOINTS (LOANS, COLLECTIONS, AREAS, COLLECTORS)
// ----------------------------------------------------

// Get Tenant DB dynamically in routes and verify subscription status
app.use('/api/tenant/*', authenticateToken, async (req, res, next) => {
    if (!req.user || !req.user.tenantId) {
        return res.status(401).json({ error: 'Unauthorized: Missing tenant context.' });
    }
    if (req.user.tenantId === 'admin') {
        return res.status(403).json({ error: 'Admin must operate in a specific Owner tenant database context.' });
    }
    
    // Check subscription status
    const tenantId = req.user.tenantId;
    try {
        const tenant = await queryGet(masterDb, 'SELECT subscription_status, subscription_expires_at FROM tenants WHERE tenant_id = ?', [tenantId]);
        if (tenant) {
            const now = new Date();
            const expiresAt = tenant.subscription_expires_at ? new Date(tenant.subscription_expires_at) : null;
            if (tenant.subscription_status === 'inactive' || (expiresAt && now > expiresAt)) {
                return res.status(402).json({ 
                    error: 'Subscription Expired', 
                    message: 'Your subscription has expired. Please renew your account to continue accessing services.' 
                });
            }
        }
    } catch (err) {
        return res.status(500).json({ error: 'Failed to verify subscription: ' + err.message });
    }
    
    req.tenantDb = getTenantDB(tenantId);
    next();
});

// Sync All Data
app.get('/api/tenant/sync', async (req, res) => {
    try {
        const isCollector = req.user.role === 'collector';
        const isOwnerOrAdmin = req.user.role === 'owner' || req.user.role === 'admin';
        const username = req.user.username;

        // Run all queries concurrently using Promise.all to optimize performance and prevent event loop blocking
        const [
            owners,
            areas,
            loans,
            collections,
            collectors,
            lines,
            expenses,
            floats,
            collectorLines,
            investments,
            fixedAssets,
            lineTransactions,
            villages
        ] = await Promise.all([
            // 1. Fetch owners (only for admin)
            req.user.role === 'admin' 
                ? queryAll(masterDb, 'SELECT username, name, created_at FROM tenants').catch(() => []) 
                : Promise.resolve([]),

            // 2. Fetch areas
            isCollector 
                ? queryAll(req.tenantDb, `
                    SELECT * FROM areas 
                    WHERE id IN (
                        SELECT area_id FROM lines 
                        WHERE line_no IN (
                            SELECT line_no FROM collector_line_assignments WHERE username = ?
                        )
                    )
                `, [username]) 
                : queryAll(req.tenantDb, 'SELECT * FROM areas'),

            // 3. Fetch loans
            req.user.role === 'admin'
                ? queryAll(req.tenantDb, 'SELECT * FROM loans')
                : (isCollector 
                    ? queryAll(req.tenantDb, `
                        SELECT * FROM loans 
                        WHERE deleted = 0 AND areaId IN (
                            SELECT area_id FROM lines 
                            WHERE line_no IN (
                                SELECT line_no FROM collector_line_assignments WHERE username = ?
                            )
                        )
                    `, [username])
                    : queryAll(req.tenantDb, 'SELECT * FROM loans WHERE deleted = 0')),

            // 4. Fetch collections
            req.user.role === 'admin'
                ? queryAll(req.tenantDb, 'SELECT * FROM collections')
                : (isCollector
                    ? queryAll(req.tenantDb, `
                        SELECT * FROM collections 
                        WHERE deleted = 0 AND loanId IN (
                            SELECT id FROM loans 
                            WHERE deleted = 0 AND areaId IN (
                                SELECT area_id FROM lines 
                                WHERE line_no IN (
                                    SELECT line_no FROM collector_line_assignments WHERE username = ?
                                )
                            )
                        )
                    `, [username])
                    : queryAll(req.tenantDb, 'SELECT * FROM collections WHERE deleted = 0')),

            // 5. Fetch collectors
            isCollector
                ? queryAll(req.tenantDb, 'SELECT username, name FROM collectors WHERE username = ?', [username])
                : queryAll(req.tenantDb, 'SELECT username, name FROM collectors'),

            // 6. Fetch lines
            isCollector
                ? queryAll(req.tenantDb, `
                    SELECT * FROM lines 
                    WHERE line_no IN (
                        SELECT line_no FROM collector_line_assignments WHERE username = ?
                    )
                `, [username])
                : queryAll(req.tenantDb, 'SELECT * FROM lines'),

            // 7. Fetch expenses
            isCollector
                ? queryAll(req.tenantDb, `
                    SELECT * FROM expenses 
                    WHERE line_no IN (
                        SELECT line_no FROM collector_line_assignments WHERE username = ?
                    )
                `, [username])
                : queryAll(req.tenantDb, 'SELECT * FROM expenses'),

            // 8. Fetch daily floats
            isCollector
                ? queryAll(req.tenantDb, `
                    SELECT * FROM daily_floats 
                    WHERE line_no IN (
                        SELECT line_no FROM collector_line_assignments WHERE username = ?
                    )
                `, [username])
                : queryAll(req.tenantDb, 'SELECT * FROM daily_floats'),

            // 9. Fetch collector-lines
            isOwnerOrAdmin
                ? queryAll(req.tenantDb, 'SELECT * FROM collector_line_assignments')
                : (isCollector
                    ? queryAll(req.tenantDb, 'SELECT * FROM collector_line_assignments WHERE username = ?', [username])
                    : Promise.resolve([])),

            // 10. Fetch investments
            isCollector
                ? queryAll(req.tenantDb, `
                    SELECT * FROM investments 
                    WHERE line_no IN (
                        SELECT line_no FROM collector_line_assignments WHERE username = ?
                    )
                `, [username])
                : queryAll(req.tenantDb, 'SELECT * FROM investments'),

            // 11. Fetch fixed assets
            isCollector
                ? queryAll(req.tenantDb, `
                    SELECT * FROM fixed_assets 
                    WHERE line_no IN (
                        SELECT line_no FROM collector_line_assignments WHERE username = ?
                    )
                `, [username])
                : queryAll(req.tenantDb, 'SELECT * FROM fixed_assets'),

            // 12. Fetch line transactions
            isCollector
                ? queryAll(req.tenantDb, `
                    SELECT * FROM line_transactions 
                    WHERE line_no IN (
                        SELECT line_no FROM collector_line_assignments WHERE username = ?
                    )
                `, [username])
                : queryAll(req.tenantDb, 'SELECT * FROM line_transactions'),

            // 13. Fetch villages
            queryAll(req.tenantDb, 'SELECT * FROM villages ORDER BY line_no, serial_no').catch(() => [])
        ]);

        return res.json({
            owners,
            areas,
            loans,
            collections,
            collectors,
            lines,
            expenses,
            dailyFloats: floats,
            collectorLines,
            investments,
            fixedAssets,
            lineTransactions,
            villages
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Retrieve Areas
app.get('/api/tenant/areas', async (req, res) => {
    try {
        let rows;
        if (req.user.role === 'collector') {
            rows = await queryAll(req.tenantDb, `
                SELECT * FROM areas 
                WHERE id IN (
                    SELECT area_id FROM lines 
                    WHERE line_no IN (
                        SELECT line_no FROM collector_line_assignments WHERE username = ?
                    )
                )
            `, [req.user.username]);
        } else {
            rows = await queryAll(req.tenantDb, 'SELECT * FROM areas');
        }
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Save Area
app.post('/api/tenant/areas', async (req, res) => {
    const { id, name, lat, lng, radius } = req.body;
    try {
        await queryRun(req.tenantDb, 
            'INSERT INTO areas (id, name, lat, lng, radius) VALUES (?, ?, ?, ?, ?)', 
            [id, name, lat, lng, radius]
        );
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Delete Area
app.delete('/api/tenant/areas/:id', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only administrators can delete areas.' });
    }
    const { id } = req.params;
    
    try {
        const linked = await queryGet(req.tenantDb, 'SELECT COUNT(*) as count FROM loans WHERE areaId = ?', [id]);
        if (linked && linked.count > 0) {
            return res.status(400).json({ error: `Cannot delete! ${linked.count} loan accounts are linked to this area.` });
        }
        await queryRun(req.tenantDb, 'DELETE FROM areas WHERE id = ?', [id]);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Retrieve Lines
app.get('/api/tenant/lines', async (req, res) => {
    try {
        let rows;
        if (req.user.role === 'collector') {
            rows = await queryAll(req.tenantDb, `
                SELECT * FROM lines 
                WHERE line_no IN (
                    SELECT line_no FROM collector_line_assignments WHERE username = ?
                )
            `, [req.user.username]);
        } else {
            rows = await queryAll(req.tenantDb, 'SELECT * FROM lines');
        }
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Save Line
app.post('/api/tenant/lines', async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Forbidden. Only the owner can create lines.' });
    }
    const { id, line_no, area_id } = req.body;
    try {
        await queryRun(req.tenantDb, 
            'INSERT INTO lines (id, line_no, area_id, created_at) VALUES (?, ?, ?, ?)', 
            [id, line_no, area_id, new Date().toISOString()]
        );
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Delete Line
app.delete('/api/tenant/lines/:id', async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Forbidden. Only the owner can delete lines.' });
    }
    const { id } = req.params;
    try {
        await queryRun(req.tenantDb, 'DELETE FROM lines WHERE id = ?', [id]);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Retrieve Collectors
app.get('/api/tenant/collectors', async (req, res) => {
    try {
        const rows = await queryAll(req.tenantDb, 'SELECT username, name FROM collectors');
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Save Collector
app.post('/api/tenant/collectors', async (req, res) => {
    const { username, name, password } = req.body;
    const cleanUser = username.trim().toLowerCase();
    
    try {
        // Check duplicate globally first
        const globalDuplicate = await queryGet(masterDb, 'SELECT * FROM global_collectors WHERE username = ?', [cleanUser]);
        const ownerDuplicate = await queryGet(masterDb, 'SELECT * FROM tenants WHERE username = ?', [cleanUser]);
        
        if (globalDuplicate || ownerDuplicate || cleanUser === 'admin') {
            return res.status(400).json({ error: 'Username already exists!' });
        }
        
        // Save in tenant DB
        await queryRun(req.tenantDb, 
            'INSERT INTO collectors (username, name, password) VALUES (?, ?, ?)', 
            [cleanUser, name, hashPassword(password)]
        );
        
        // Save in global registry
        await queryRun(masterDb, 'INSERT INTO global_collectors (username, tenant_id) VALUES (?, ?)', [cleanUser, req.user.tenantId]);
        
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Delete Collector
app.delete('/api/tenant/collectors/:username', async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    const cleanUser = req.params.username.trim().toLowerCase();
    
    try {
        const count = await queryGet(req.tenantDb, 'SELECT COUNT(*) as count FROM collectors');
        if (count && count.count <= 1) {
            return res.status(400).json({ error: 'Cannot delete! At least one active collector must remain in the system.' });
        }
        
        // Remove from tenant database
        await queryRun(req.tenantDb, 'DELETE FROM collectors WHERE username = ?', [cleanUser]);
        // Remove from global registry
        await queryRun(masterDb, 'DELETE FROM global_collectors WHERE username = ?', [cleanUser]);
        
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Retrieve Loans
app.get('/api/tenant/loans', async (req, res) => {
    try {
        let rows;
        if (req.user.role === 'admin') {
            rows = await queryAll(req.tenantDb, 'SELECT * FROM loans');
        } else if (req.user.role === 'collector') {
            rows = await queryAll(req.tenantDb, `
                SELECT * FROM loans 
                WHERE deleted = 0 AND areaId IN (
                    SELECT area_id FROM lines 
                    WHERE line_no IN (
                        SELECT line_no FROM collector_line_assignments WHERE username = ?
                    )
                )
            `, [req.user.username]);
        } else {
            rows = await queryAll(req.tenantDb, 'SELECT * FROM loans WHERE deleted = 0');
        }
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Save or Update Loan
app.post('/api/tenant/loans', async (req, res) => {
    const {
        id, slNo, name, address, areaId, frequency, fromDate, toDate,
        loanAmount, installmentAmount, customerPhoto, housePhoto,
        principalAmount, interestAmount, durationDays, latitude, longitude,
        phone
    } = req.body;
    
    try {
        if (id) {
            // Update mode
            if (req.user.role !== 'owner' && req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Forbidden. Only administrators or owners can edit loan parameters.' });
            }
            
            await queryRun(req.tenantDb, `
                UPDATE loans 
                SET name = ?, address = ?, areaId = ?, frequency = ?, fromDate = ?, toDate = ?, 
                    loanAmount = ?, installmentAmount = ?, customerPhoto = ?, housePhoto = ?,
                    principalAmount = ?, interestAmount = ?, durationDays = ?,
                    latitude = ?, longitude = ?,
                    unpaidAmount = loanAmount - paidAmount,
                    status = CASE WHEN (loanAmount - paidAmount) <= 0 THEN 'Paid' ELSE 'Active' END,
                    phone = ?
                WHERE id = ?
            `, [name, address, areaId, frequency, fromDate, toDate, loanAmount, installmentAmount, customerPhoto, housePhoto, principalAmount || 0, interestAmount || 0, durationDays || 0, latitude, longitude, phone || '', id]);
            
            return res.json({ success: true, message: 'Loan record updated successfully!' });
        } else {
            // Create mode
            // Validate collector funds
            if (req.user.role === 'collector') {
                const lineRow = await queryGet(req.tenantDb, 'SELECT line_no FROM lines WHERE area_id = ?', [areaId]);
                const targetLine = lineRow ? lineRow.line_no : null;
                
                if (targetLine) {
                    const todayStr = new Date().toISOString().substring(0, 10);
                    
                    // 1. Opening float
                    const floatRow = await queryGet(req.tenantDb, 'SELECT amount FROM daily_floats WHERE line_no = ? AND date = ?', [targetLine, todayStr]);
                    const openingFloat = floatRow ? (parseFloat(floatRow.amount) || 0) : 0;
                    
                    // 2. Today's collections
                    const collRow = await queryGet(req.tenantDb, `
                        SELECT SUM(c.amount) as totalCollections FROM collections c
                        JOIN loans l ON c.loanId = l.id
                        JOIN lines ln ON l.areaId = ln.area_id
                        WHERE ln.line_no = ? AND c.date = ? AND c.deleted = 0 AND l.deleted = 0
                    `, [targetLine, todayStr]);
                    const totalCollectionsToday = collRow ? (parseFloat(collRow.totalCollections) || 0) : 0;
                    
                    // 3. Today's interest
                    const interestRow = await queryGet(req.tenantDb, `
                        SELECT SUM(l.interestAmount) as todayInterest FROM loans l
                        JOIN lines ln ON l.areaId = ln.area_id
                        WHERE ln.line_no = ? AND SUBSTR(l.createdAt, 1, 10) = ? AND l.deleted = 0
                    `, [targetLine, todayStr]);
                    const todayInterest = interestRow ? (parseFloat(interestRow.todayInterest) || 0) : 0;
                    
                    if (openingFloat <= 0 && totalCollectionsToday <= 0 && todayInterest <= 0) {
                        return res.status(400).json({ error: `Cannot register a new loan: No active funds today (Opening Float: ₹${openingFloat}, Collections: ₹${totalCollectionsToday}, Interest: ₹${todayInterest})` });
                    }
                }
            }

            // Calculate next slNo dynamically
            const maxSlRow = await queryGet(req.tenantDb, 'SELECT MAX(slNo) as maxSl FROM loans');
            const nextSlNo = maxSlRow.maxSl ? maxSlRow.maxSl + 1 : 1;
            
            const newId = 'loan-' + Date.now();
            await queryRun(req.tenantDb, `
                INSERT INTO loans (
                    id, slNo, name, address, areaId, frequency, fromDate, toDate, 
                    loanAmount, installmentAmount, paidAmount, unpaidAmount, status, createdAt, customerPhoto, housePhoto,
                    principalAmount, interestAmount, durationDays, latitude, longitude, phone
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [newId, nextSlNo, name, address, areaId, frequency, fromDate, toDate, loanAmount, installmentAmount, loanAmount, new Date().toISOString(), customerPhoto, housePhoto, principalAmount || 0, interestAmount || 0, durationDays || 0, latitude, longitude, phone || '']);
            
            return res.json({ success: true, message: `New loan #${nextSlNo} registered successfully!` });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Delete Loan
app.delete('/api/tenant/loans/:id', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Only administrators can delete loan records.' });
    }
    const { id } = req.params;
    
    try {
        await queryRun(req.tenantDb, 'UPDATE loans SET deleted = 1 WHERE id = ?', [id]);
        // Cascading soft deletion of collections for this loan
        await queryRun(req.tenantDb, 'UPDATE collections SET deleted = 1 WHERE loanId = ?', [id]);
        
        return res.json({ success: true, message: 'Loan record deleted successfully!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Retrieve Collections
app.get('/api/tenant/collections', async (req, res) => {
    const { loanId } = req.query;
    try {
        let rows;
        if (req.user.role === 'admin') {
            if (loanId) {
                rows = await queryAll(req.tenantDb, 'SELECT * FROM collections WHERE loanId = ?', [loanId]);
            } else {
                rows = await queryAll(req.tenantDb, 'SELECT * FROM collections');
            }
        } else if (req.user.role === 'collector') {
            if (loanId) {
                const allowedLoan = await queryGet(req.tenantDb, `
                    SELECT id FROM loans 
                    WHERE deleted = 0 AND id = ? AND areaId IN (
                        SELECT area_id FROM lines 
                        WHERE line_no IN (
                            SELECT line_no FROM collector_line_assignments WHERE username = ?
                        )
                    )
                `, [loanId, req.user.username]);
                if (allowedLoan) {
                    rows = await queryAll(req.tenantDb, 'SELECT * FROM collections WHERE deleted = 0 AND loanId = ?', [loanId]);
                } else {
                    rows = [];
                }
            } else {
                rows = await queryAll(req.tenantDb, `
                    SELECT * FROM collections 
                    WHERE deleted = 0 AND loanId IN (
                        SELECT id FROM loans 
                        WHERE deleted = 0 AND areaId IN (
                            SELECT area_id FROM lines 
                            WHERE line_no IN (
                                SELECT line_no FROM collector_line_assignments WHERE username = ?
                            )
                        )
                    )
                `, [req.user.username]);
            }
        } else {
            if (loanId) {
                rows = await queryAll(req.tenantDb, 'SELECT * FROM collections WHERE deleted = 0 AND loanId = ?', [loanId]);
            } else {
                rows = await queryAll(req.tenantDb, 'SELECT * FROM collections WHERE deleted = 0');
            }
        }
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Post Collection
app.post('/api/tenant/collections', async (req, res) => {
    const { loanId, amount, date, lat, lng, verifiedLocation, expectedAmount, deficit } = req.body;
    
    try {
        const loan = await queryGet(req.tenantDb, 'SELECT * FROM loans WHERE id = ?', [loanId]);
        if (!loan) {
            return res.status(404).json({ error: 'Loan account not found.' });
        }
        
        // Get next collection index slNo
        const countRow = await queryGet(req.tenantDb, 'SELECT COUNT(*) as count FROM collections WHERE loanId = ?', [loanId]);
        const nextCollSlNo = countRow.count + 1;
        
        const newId = 'coll-' + Date.now();
        const expAmt = expectedAmount !== undefined ? parseFloat(expectedAmount) : loan.installmentAmount;
        const defAmt = deficit !== undefined ? parseFloat(deficit) : Math.max(0, expAmt - amount);

        await queryRun(req.tenantDb, `
            INSERT INTO collections (id, loanId, slNo, amount, date, lat, lng, verifiedLocation, collectorId, expectedAmount, deficit)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [newId, loanId, nextCollSlNo, amount, date, lat, lng, verifiedLocation ? 1 : 0, req.user.username, expAmt, defAmt]);
        
        // Update loan balances
        const newPaid = loan.paidAmount + amount;
        const newUnpaid = Math.max(0, loan.loanAmount - newPaid);
        const newStatus = newUnpaid === 0 ? 'Paid' : 'Active';
        
        await queryRun(req.tenantDb, 'UPDATE loans SET paidAmount = ?, unpaidAmount = ?, status = ? WHERE id = ?', [newPaid, newUnpaid, newStatus, loanId]);
        
        return res.json({ success: true, message: `Posted collection of ₹${amount} for ${loan.name}!` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Delete (Reverse) Collection
app.delete('/api/tenant/collections/:id', async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'owner' && req.user.role !== 'collector') {
        return res.status(403).json({ error: 'Forbidden. Only authorized roles can delete collection postings.' });
    }
    const { id } = req.params;
    
    try {
        const coll = await queryGet(req.tenantDb, 'SELECT * FROM collections WHERE id = ?', [id]);
        if (!coll) {
            return res.status(404).json({ error: 'Collection record not found.' });
        }
        
        const loan = await queryGet(req.tenantDb, 'SELECT * FROM loans WHERE id = ?', [coll.loanId]);
        if (loan) {
            // Reverse balances
            const newPaid = Math.max(0, loan.paidAmount - coll.amount);
            const newUnpaid = Math.max(0, loan.loanAmount - newPaid);
            const newStatus = newUnpaid > 0 ? 'Active' : 'Paid';
            await queryRun(req.tenantDb, 'UPDATE loans SET paidAmount = ?, unpaidAmount = ?, status = ? WHERE id = ?', [newPaid, newUnpaid, newStatus, coll.loanId]);
        }
        
        // Soft delete from db
        await queryRun(req.tenantDb, 'UPDATE collections SET deleted = 1 WHERE id = ?', [id]);
        
        // Recalculate index numbers for remaining non-deleted collections of this loan
        const remaining = await queryAll(req.tenantDb, 'SELECT * FROM collections WHERE loanId = ? AND deleted = 0 ORDER BY date ASC', [coll.loanId]);
        let counter = 1;
        for (let row of remaining) {
            await queryRun(req.tenantDb, 'UPDATE collections SET slNo = ? WHERE id = ?', [counter++, row.id]);
        }
        
        return res.json({ success: true, message: 'Collection posting reversed.' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ----------------------------------------------------
// 3. DATABASE OPERATIONS (BACKUP, RESET, SEEDING)
// ----------------------------------------------------

// Export Database (Admin Only)
app.post('/api/tenant/db/export', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    
    try {
        const loans = await queryAll(req.tenantDb, 'SELECT * FROM loans');
        const collections = await queryAll(req.tenantDb, 'SELECT * FROM collections');
        const areas = await queryAll(req.tenantDb, 'SELECT * FROM areas');
        const collectors = await queryAll(req.tenantDb, 'SELECT * FROM collectors');
        const lines = await queryAll(req.tenantDb, 'SELECT * FROM lines').catch(() => []);
        
        return res.json({ loans, collections, areas, collectors, lines });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Import Database (Admin Only)
app.post('/api/tenant/db/import', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    const { loans, collections, areas, collectors, lines } = req.body;
    
    try {
        // Wipe tables first
        await queryRun(req.tenantDb, 'DELETE FROM loans');
        await queryRun(req.tenantDb, 'DELETE FROM collections');
        await queryRun(req.tenantDb, 'DELETE FROM areas');
        await queryRun(req.tenantDb, 'DELETE FROM collectors');
        await queryRun(req.tenantDb, 'DELETE FROM lines').catch(() => {});
        
        // Insert import datasets
        if (areas) {
            for (let area of areas) {
                await queryRun(req.tenantDb, 'INSERT INTO areas (id, name, lat, lng, radius) VALUES (?, ?, ?, ?, ?)', [area.id, area.name, area.lat, area.lng, area.radius]);
            }
        }
        if (collectors) {
            for (let c of collectors) {
                await queryRun(req.tenantDb, 'INSERT INTO collectors (username, name, password) VALUES (?, ?, ?)', [c.username, c.name, c.password]);
                await queryRun(masterDb, 'INSERT OR IGNORE INTO global_collectors (username, tenant_id) VALUES (?, ?)', [c.username, req.user.tenantId]);
            }
        }
        if (loans) {
            for (let l of loans) {
                await queryRun(req.tenantDb, `
                    INSERT INTO loans (
                        id, slNo, name, address, areaId, frequency, fromDate, toDate, 
                        loanAmount, installmentAmount, paidAmount, unpaidAmount, status, createdAt, customerPhoto, housePhoto,
                        principalAmount, interestAmount, durationDays
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [l.id, l.slNo, l.name, l.address, l.areaId, l.frequency, l.fromDate, l.toDate, l.loanAmount, l.installmentAmount, l.paidAmount, l.unpaidAmount, l.status, l.createdAt, l.customerPhoto, l.housePhoto, l.principalAmount || l.loanAmount, l.interestAmount || 0, l.durationDays || 100]);
            }
        }
        if (collections) {
            for (let c of collections) {
                await queryRun(req.tenantDb, `
                    INSERT INTO collections (id, loanId, slNo, amount, date, lat, lng, verifiedLocation, collectorId, expectedAmount, deficit)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [c.id, c.loanId, c.slNo, c.amount, c.date, c.lat, c.lng, c.verifiedLocation, c.collectorId, c.expectedAmount || c.amount, c.deficit || 0]);
            }
        }
        if (lines) {
            for (let line of lines) {
                await queryRun(req.tenantDb, 'INSERT INTO lines (id, line_no, area_id, created_at) VALUES (?, ?, ?, ?)', [line.id, line.line_no, line.area_id, line.created_at || new Date().toISOString()]).catch(() => {});
            }
        }
        
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Import MDB Database (Admin Only)
app.post('/api/tenant/db/import-mdb', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    const { mdbBase64 } = req.body;
    if (!mdbBase64) {
        return res.status(400).json({ error: 'Missing mdbBase64 data.' });
    }

    const tempDir = path.join(__dirname, 'db', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempMdbPath = path.join(tempDir, `import_${Date.now()}_${req.user.tenantId}.mdb`);
    const tempJsonPath = path.join(tempDir, `import_${Date.now()}_${req.user.tenantId}.json`);

    try {
        // 1. Write MDB file from base64
        const mdbBuffer = Buffer.from(mdbBase64, 'base64');
        fs.writeFileSync(tempMdbPath, mdbBuffer);

        // 2. Execute PowerShell script to dump to JSON
        const psArgs = [
            '-ExecutionPolicy', 'Bypass',
            '-File', path.join(__dirname, 'db_ops', 'mdb_to_json.ps1'),
            '-mdbPath', tempMdbPath,
            '-outputPath', tempJsonPath
        ];
        
        const output = await runPowerShell(psArgs);
        if (!output.includes('SUCCESS')) {
            throw new Error('PowerShell script failed: ' + output);
        }

        // 3. Read JSON data
        if (!fs.existsSync(tempJsonPath)) {
            throw new Error('JSON output file not found.');
        }
        const mdbData = JSON.parse(fs.readFileSync(tempJsonPath, 'utf8'));

        // 4. Populate active tenant SQLite database
        // Wipe tables first (loans, collections, areas, lines, expenses, line transactions, etc.)
        await queryRun(req.tenantDb, 'DELETE FROM loans');
        await queryRun(req.tenantDb, 'DELETE FROM collections');
        await queryRun(req.tenantDb, 'DELETE FROM areas');
        await queryRun(req.tenantDb, 'DELETE FROM lines').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM expenses').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM daily_floats').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM investments').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM fixed_assets').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM line_transactions').catch(() => {});

        // Resolve areas (from unique ADD1 in LOANEE)
        const areaMap = {}; // Maps ADD1 area name -> areaId
        const existingAreas = await queryAll(req.tenantDb, 'SELECT * FROM areas');
        existingAreas.forEach(a => {
            areaMap[a.name.toLowerCase().trim()] = a.id;
        });

        // Import Areas
        if (mdbData.LOANEE) {
            for (let row of mdbData.LOANEE) {
                const areaName = (row.ADD1 || 'Default Area').trim();
                const key = areaName.toLowerCase();
                if (!areaMap[key]) {
                    const areaId = 'area-' + Math.random().toString(36).substring(2, 11);
                    await queryRun(req.tenantDb, 'INSERT INTO areas (id, name, lat, lng, radius) VALUES (?, ?, 18.5, 84.2, 1000)', [areaId, areaName]);
                    areaMap[key] = areaId;
                    
                    // Create line assignment for this area
                    const lineId = 'line-' + Math.random().toString(36).substring(2, 11);
                    await queryRun(req.tenantDb, 'INSERT INTO lines (id, line_no, area_id, created_at) VALUES (?, ?, ?, ?)', [lineId, 'Line 1', areaId, new Date().toISOString()]).catch(() => {});
                }
            }
        }

        // Import Loanees (Loans)
        const loanIdMap = {}; // Maps ANO -> SQLite loan.id
        if (mdbData.LOANEE) {
            for (let row of mdbData.LOANEE) {
                const slNo = parseBorrowerNo(row.ANO);
                if (slNo === null) continue;

                const loanId = 'loan-' + Math.random().toString(36).substring(2, 11);
                loanIdMap[row.ANO.trim().toUpperCase()] = loanId;

                const areaName = (row.ADD1 || 'Default Area').trim();
                const areaId = areaMap[areaName.toLowerCase()] || '';

                const frequency = row.DW === 'W' ? 'Weeks' : (row.DW === 'M' ? 'Months' : 'Days');
                const status = (row.BAMT <= 0) ? 'Paid' : 'Active';

                await queryRun(req.tenantDb, `
                    INSERT INTO loans (
                        id, slNo, name, address, areaId, frequency, fromDate, toDate, 
                        loanAmount, installmentAmount, paidAmount, unpaidAmount, status, createdAt, customerPhoto, housePhoto,
                        principalAmount, interestAmount, durationDays
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, 0, ?)
                `, [
                    loanId,
                    slNo,
                    row.NAME || 'Unknown',
                    row.ADD2 || '',
                    areaId,
                    frequency,
                    row.FDT || '',
                    row.TDT || '',
                    row.AMT || 0,
                    row.DA || 0,
                    row.PAMT || 0,
                    row.BAMT || 0,
                    status,
                    new Date().toISOString(),
                    row.AMT || 0,
                    row.DS || 100
                ]);
            }
        }

        // Import Collections (PAMT1 and PAMT2)
        const allPayments = [];
        if (mdbData.PAMT1) allPayments.push(...mdbData.PAMT1);
        if (mdbData.PAMT2) allPayments.push(...mdbData.PAMT2);

        // Sort payments by date to ensure proper slNo indexing
        allPayments.sort((a, b) => new Date(a.PDT) - new Date(b.PDT));

        const collectionIndexMap = {}; // Maps loanId -> next index number
        for (let row of allPayments) {
            const anoKey = row.ANO ? row.ANO.trim().toUpperCase() : '';
            const loanId = loanIdMap[anoKey];
            if (!loanId) continue;

            if (!collectionIndexMap[loanId]) {
                collectionIndexMap[loanId] = 1;
            }
            const colSlNo = collectionIndexMap[loanId]++;
            const colId = 'coll-' + Math.random().toString(36).substring(2, 11);

            await queryRun(req.tenantDb, `
                INSERT INTO collections (id, loanId, slNo, amount, date, lat, lng, verifiedLocation, collectorId, expectedAmount, deficit)
                VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, 'collector', ?, 0)
            `, [
                colId,
                loanId,
                colSlNo,
                row.AMT || 0,
                row.PDT || '',
                row.AMT || 0
            ]);
        }

        // Import Expenses (EXAMT)
        if (mdbData.EXAMT) {
            for (let row of mdbData.EXAMT) {
                const expId = 'exp-' + Math.random().toString(36).substring(2, 11);
                await queryRun(req.tenantDb, `
                    INSERT INTO expenses (id, line_no, date, category, amount, description, collector_username)
                    VALUES (?, 'Line 1', ?, 'Legacy Expense', ?, 'Legacy MDB Expense Import', 'collector')
                `, [
                    expId,
                    row.DT || '',
                    row.AMT || 0
                ]);
            }
        }

        res.json({ success: true, message: `Successfully imported ${mdbData.LOANEE ? mdbData.LOANEE.length : 0} loans and ${allPayments.length} collections.` });

    } catch (err) {
        console.error('Import MDB Error:', err);
        res.status(500).json({ error: 'Import failed: ' + err.message });
    } finally {
        // Clean up temp files
        if (fs.existsSync(tempMdbPath)) try { fs.unlinkSync(tempMdbPath); } catch (e) {}
        if (fs.existsSync(tempJsonPath)) try { fs.unlinkSync(tempJsonPath); } catch (e) {}
    }
});

// Export MDB Database (Admin Only)
app.post('/api/tenant/db/export-mdb', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden.' });
    }

    const tempDir = path.join(__dirname, 'db', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempMdbPath = path.join(tempDir, `export_${Date.now()}_${req.user.tenantId}.mdb`);
    const tempJsonPath = path.join(tempDir, `export_${Date.now()}_${req.user.tenantId}.json`);

    try {
        // 1. Fetch data from SQLite (excluding deleted ones)
        const loans = await queryAll(req.tenantDb, 'SELECT * FROM loans WHERE deleted = 0');
        const collections = await queryAll(req.tenantDb, 'SELECT * FROM collections WHERE deleted = 0');
        const areas = await queryAll(req.tenantDb, 'SELECT * FROM areas');
        const expenses = await queryAll(req.tenantDb, 'SELECT * FROM expenses');

        // Maps areaId -> areaName
        const areaNameMap = {};
        areas.forEach(a => {
            areaNameMap[a.id] = a.name;
        });

        // Maps loanId -> loanObject (to get slNo)
        const loanMap = {};
        loans.forEach(l => {
            loanMap[l.id] = l;
        });

        // 2. Format to legacy schema
        const mdbData = {
            LOANEE: [],
            PAMT1: [],
            PAMT2: [],
            EXAMT: []
        };

        loans.forEach(l => {
            const ano = formatBorrowerNo(l.slNo);
            const areaName = areaNameMap[l.areaId] || 'Default Area';
            const dw = l.frequency === 'Weeks' ? 'W' : (l.frequency === 'Months' ? 'M' : 'D');

            mdbData.LOANEE.push({
                ANO: ano,
                NAME: l.name,
                ADD1: areaName,
                ADD2: l.address || '',
                ADD3: '',
                FDT: l.fromDate ? l.fromDate + ' 00:00:00' : '',
                TDT: l.toDate ? l.toDate + ' 00:00:00' : '',
                AMT: l.loanAmount || 0,
                PAMT: l.paidAmount || 0,
                BAMT: l.unpaidAmount || 0,
                DA: l.installmentAmount || 0,
                DW: dw,
                DS: l.durationDays || 100
            });
        });

        // Sort collections by date
        collections.forEach(c => {
            const loan = loanMap[c.loanId];
            if (!loan) return;
            const ano = formatBorrowerNo(loan.slNo);

            mdbData.PAMT1.push({
                ANO: ano,
                PDT: c.date ? c.date + ' 00:00:00' : '',
                AMT: c.amount || 0
            });
        });

        expenses.forEach(e => {
            mdbData.EXAMT.push({
                AMT: e.amount || 0,
                DT: e.date ? e.date + ' 00:00:00' : '',
                LAMT: 0
            });
        });

        // 3. Write temp JSON file
        fs.writeFileSync(tempJsonPath, JSON.stringify(mdbData, null, 2));

        // 4. Run PowerShell script to compile MDB
        const psArgs = [
            '-ExecutionPolicy', 'Bypass',
            '-File', path.join(__dirname, 'db_ops', 'json_to_mdb.ps1'),
            '-jsonPath', tempJsonPath,
            '-mdbPath', tempMdbPath
        ];

        const output = await runPowerShell(psArgs);
        if (!output.includes('SUCCESS')) {
            throw new Error('PowerShell script failed: ' + output);
        }

        // 5. Send file response
        if (!fs.existsSync(tempMdbPath)) {
            throw new Error('MDB output file not found.');
        }

        res.download(tempMdbPath, '1.MDB', (err) => {
            if (err) {
                console.error('File transmission failed:', err);
            }
            // Clean up files
            if (fs.existsSync(tempMdbPath)) try { fs.unlinkSync(tempMdbPath); } catch (e) {}
            if (fs.existsSync(tempJsonPath)) try { fs.unlinkSync(tempJsonPath); } catch (e) {}
        });

    } catch (err) {
        console.error('Export MDB Error:', err);
        res.status(500).json({ error: 'Export failed: ' + err.message });
        
        // Ensure clean up in case of error
        if (fs.existsSync(tempMdbPath)) try { fs.unlinkSync(tempMdbPath); } catch (e) {}
        if (fs.existsSync(tempJsonPath)) try { fs.unlinkSync(tempJsonPath); } catch (e) {}
    }
});

// ----------------------------------------------------
// MENTOR APPLICATION INTEGRATION ENDPOINTS
// ----------------------------------------------------

// 1. Scan Mentor lines across TDATA/New and TDATA/OLD
app.get('/api/tenant/mentor/scan', async (req, res) => {
    try {
        const customDir = req.query.dir;
        const defaultTdata = path.join(__dirname, '../TDATA');
        const fallbackTdata = 'D:\\Mentor\\TDATA';
        let targetDir = customDir;
        if (!targetDir) {
            targetDir = fs.existsSync(defaultTdata) ? defaultTdata : (fs.existsSync(fallbackTdata) ? fallbackTdata : defaultTdata);
        }

        const psScript = path.join(__dirname, 'db_ops', 'mentor_bridge.ps1');
        const psArgs = [
            '-ExecutionPolicy', 'Bypass',
            '-File', psScript,
            '-action', 'scan',
            '-tdataDir', targetDir
        ];

        const output = await runPowerShell(psArgs);
        const jsonStart = output.indexOf('{');
        const jsonEnd = output.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error('Invalid output from mentor scanner: ' + output);
        }
        const parsed = JSON.parse(output.substring(jsonStart, jsonEnd + 1));
        const activeBooks = (parsed.newLines || []).map(b => ({
            lineNo: b.lineNo,
            lineTitle: 'Line Book ' + b.lineNo,
            folder: b.folder || 'New',
            fileSizeKB: Math.round((b.sizeBytes || 0) / 1024),
            borrowersCount: b.loaneeCount || 0,
            totalAmt: b.disbursedAmount || 0,
            totalPamt: b.paidAmount || 0,
            totalBamt: b.balanceAmount || 0,
            lastModified: b.lastModified || ''
        }));
        const archivedBooks = (parsed.oldLines || []).map(b => ({
            lineNo: b.lineNo,
            lineTitle: 'Line Book ' + b.lineNo,
            folder: b.folder || 'OLD',
            fileSizeKB: Math.round((b.sizeBytes || 0) / 1024),
            borrowersCount: b.loaneeCount || 0,
            totalAmt: b.disbursedAmount || 0,
            totalPamt: b.paidAmount || 0,
            totalBamt: b.balanceAmount || 0,
            lastModified: b.lastModified || ''
        }));

        res.json({
            success: true,
            activeBooks,
            archivedBooks,
            newLines: parsed.newLines || [],
            oldLines: parsed.oldLines || [],
            villages: parsed.villages || [],
            villagesCount: (parsed.villages || []).length,
            tdataDir: parsed.tdataDir
        });
    } catch (err) {
        console.error('Mentor Scan Error:', err);
        res.status(500).json({ error: 'Scan failed: ' + err.message });
    }
});

// 2. Import a specific Mentor Line MDB into Tenant DB
app.post('/api/tenant/mentor/import-line', async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Forbidden.' });
    }

    const { lineNo, folder = 'New', wipeLine = false, customMdbPath } = req.body;
    if (lineNo === undefined || lineNo === null) {
        return res.status(400).json({ error: 'Missing lineNo.' });
    }

    const defaultTdata = path.join(__dirname, '../TDATA');
    const fallbackTdata = 'D:\\Mentor\\TDATA';
    const targetDir = fs.existsSync(defaultTdata) ? defaultTdata : fallbackTdata;

    const tempDir = path.join(__dirname, 'db', 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempJsonPath = path.join(tempDir, `mentor_import_${Date.now()}_${lineNo}.json`);

    try {
        const psScript = path.join(__dirname, 'db_ops', 'mentor_bridge.ps1');
        const psArgs = [
            '-ExecutionPolicy', 'Bypass',
            '-File', psScript,
            '-action', 'import-line',
            '-tdataDir', targetDir,
            '-folder', folder,
            '-lineNo', String(lineNo),
            '-outputJson', tempJsonPath
        ];
        if (customMdbPath) {
            psArgs.push('-mdbPath', customMdbPath);
        }

        const psOut = await runPowerShell(psArgs);
        if (!fs.existsSync(tempJsonPath)) {
            throw new Error('Failed to generate import JSON: ' + psOut);
        }

        const data = JSON.parse(fs.readFileSync(tempJsonPath, 'utf8'));
        const lineStr = 'Line ' + lineNo;
        const folderStr = folder.toLowerCase();

        // If wiping this line first
        if (wipeLine) {
            await queryRun(req.tenantDb, 'DELETE FROM loans WHERE line_no = ? AND folder = ?', [lineStr, folderStr]);
            await queryRun(req.tenantDb, 'DELETE FROM collections WHERE line_no = ? AND folder = ?', [lineStr, folderStr]);
            await queryRun(req.tenantDb, 'DELETE FROM expenses WHERE line_no = ?', [lineStr]);
            await queryRun(req.tenantDb, 'DELETE FROM villages WHERE line_no = ?', [lineStr]);
        }

        // 1. Process Villages
        if (data.villages && data.villages.length > 0) {
            for (let v of data.villages) {
                const vid = 'vil-' + lineNo + '-' + v.serialNo;
                await queryRun(req.tenantDb, `
                    INSERT OR REPLACE INTO villages (id, line_no, serial_no, village_name, created_at)
                    VALUES (?, ?, ?, ?, ?)
                `, [vid, lineStr, v.serialNo || 0, (v.villageName || '').trim(), new Date().toISOString()]);
            }
        }

        // 2. Process Areas (ADD1)
        const areaMap = {};
        const existingAreas = await queryAll(req.tenantDb, 'SELECT * FROM areas');
        existingAreas.forEach(a => { areaMap[a.name.toLowerCase().trim()] = a.id; });

        if (data.LOANEE) {
            for (let row of data.LOANEE) {
                const aName = (row.ADD1 || 'Default Area').trim();
                const key = aName.toLowerCase();
                if (!areaMap[key]) {
                    const areaId = 'area-' + Math.random().toString(36).substring(2, 11);
                    await queryRun(req.tenantDb, 'INSERT INTO areas (id, name, lat, lng, radius) VALUES (?, ?, 18.5, 84.2, 1000)', [areaId, aName]);
                    areaMap[key] = areaId;

                    // Also map line
                    const lid = 'line-' + Math.random().toString(36).substring(2, 11);
                    await queryRun(req.tenantDb, 'INSERT OR IGNORE INTO lines (id, line_no, area_id, created_at) VALUES (?, ?, ?, ?)', [lid, lineStr, areaId, new Date().toISOString()]);
                } else {
                    const existingAreaId = areaMap[key];
                    await queryRun(req.tenantDb, 'INSERT OR IGNORE INTO lines (id, line_no, area_id, created_at) VALUES (?, ?, ?, ?)', ['line-' + Math.random().toString(36).substring(2, 11), lineStr, existingAreaId, new Date().toISOString()]);
                }
            }
        }

        // 3. Process LOANEE (Loans)
        const loanIdMap = {};
        let loaneeCount = 0;
        if (data.LOANEE) {
            for (let row of data.LOANEE) {
                const rawAno = (row.ANO || '').trim().toUpperCase();
                if (!rawAno) continue;

                const slNo = parseBorrowerNo(rawAno) || Math.floor(Math.random() * 900000);
                const areaName = (row.ADD1 || 'Default Area').trim();
                const areaId = areaMap[areaName.toLowerCase()] || '';
                const frequency = row.DW === 'W' ? 'Weeks' : (row.DW === 'M' ? 'Months' : 'Days');
                const status = (row.BAMT <= 0) ? 'Paid' : 'Active';

                const existing = await queryGet(req.tenantDb, 'SELECT id FROM loans WHERE borrowerNo = ? AND line_no = ? AND folder = ?', [rawAno, lineStr, folderStr]);
                let loanId = existing ? existing.id : ('loan-' + Math.random().toString(36).substring(2, 11));
                loanIdMap[rawAno] = loanId;

                await queryRun(req.tenantDb, `
                    INSERT OR REPLACE INTO loans (
                        id, slNo, borrowerNo, name, address, areaId, line_no, folder, frequency, fromDate, toDate,
                        loanAmount, installmentAmount, paidAmount, unpaidAmount, status, createdAt, customerPhoto, housePhoto,
                        principalAmount, interestAmount, durationDays, durationSlots, durationMode, deleted, phone
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, 0, ?, ?, ?, 0, '')
                `, [
                    loanId,
                    slNo,
                    rawAno,
                    row.NAME || 'Unknown',
                    row.ADD2 || '',
                    areaId,
                    lineStr,
                    folderStr,
                    frequency,
                    row.FDT || '',
                    row.TDT || '',
                    row.AMT || 0,
                    row.DA || 0,
                    row.PAMT || 0,
                    row.BAMT || 0,
                    status,
                    new Date().toISOString(),
                    row.AMT || 0,
                    (row.DS || 0) * (row.DW === 'W' ? 7 : (row.DW === 'M' ? 30 : 1)),
                    row.DS || 0,
                    row.DW || 'W'
                ]);
                loaneeCount++;
            }
        }

        // 4. Process Collections (PAMT1 and PAMT2)
        const allPayments = [];
        if (data.PAMT1) allPayments.push(...data.PAMT1);
        if (data.PAMT2) allPayments.push(...data.PAMT2);

        allPayments.sort((a, b) => (a.PDT || '').localeCompare(b.PDT || ''));

        let collectionCount = 0;
        const colIdxMap = {};
        for (let pay of allPayments) {
            const rawAno = (pay.ANO || '').trim().toUpperCase();
            const loanId = loanIdMap[rawAno];
            if (!loanId) continue;

            if (!colIdxMap[loanId]) colIdxMap[loanId] = 1;
            const cSlNo = colIdxMap[loanId]++;
            const colId = 'coll-' + Math.random().toString(36).substring(2, 11);

            await queryRun(req.tenantDb, `
                INSERT INTO collections (
                    id, loanId, slNo, borrowerNo, line_no, folder, amount, date, lat, lng, verifiedLocation, collectorId, expectedAmount, deficit, deleted
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, 0, 0)
            `, [
                colId,
                loanId,
                cSlNo,
                rawAno,
                lineStr,
                folderStr,
                pay.AMT || 0,
                pay.PDT || '',
                req.user.username || 'collector',
                pay.AMT || 0
            ]);
            collectionCount++;
        }

        // 5. Process EXAMT
        if (data.EXAMT) {
            for (let ex of data.EXAMT) {
                const expId = 'exp-' + Math.random().toString(36).substring(2, 11);
                await queryRun(req.tenantDb, `
                    INSERT INTO expenses (id, line_no, date, category, amount, description, collector_username)
                    VALUES (?, ?, ?, 'Extra Expense', ?, 'Mentor EXAMT Import', ?)
                `, [expId, lineStr, ex.DT || '', ex.AMT || 0, req.user.username || 'collector']);
            }
        }

        res.json({
            success: true,
            lineNo,
            line_no: lineStr,
            folder,
            loaneeCount,
            collectionCount,
            villagesCount: (data.villages || []).length,
            message: `Line ${lineNo} (${folder}) imported successfully: ${loaneeCount} members, ${collectionCount} collections.`
        });
    } catch (err) {
        console.error('Import Line Error:', err);
        res.status(500).json({ error: 'Import failed: ' + err.message });
    } finally {
        if (fs.existsSync(tempJsonPath)) try { fs.unlinkSync(tempJsonPath); } catch (e) {}
    }
});

// 3. Export Line back to Mentor MDB
app.post('/api/tenant/mentor/export-line', async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Forbidden.' });
    }

    const { lineNo, folder = 'New', customMdbPath } = req.body;
    if (lineNo === undefined || lineNo === null) {
        return res.status(400).json({ error: 'Missing lineNo.' });
    }

    const lineStr = 'Line ' + lineNo;

    const tempDir = path.join(__dirname, 'db', 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempJsonPath = path.join(tempDir, `mentor_export_${Date.now()}_${lineNo}.json`);

    try {
        const loans = await queryAll(req.tenantDb, 'SELECT * FROM loans WHERE line_no = ? AND deleted = 0', [lineStr]);
        const collections = await queryAll(req.tenantDb, 'SELECT * FROM collections WHERE line_no = ? AND deleted = 0', [lineStr]);
        const expenses = await queryAll(req.tenantDb, 'SELECT * FROM expenses WHERE line_no = ?', [lineStr]);
        const areas = await queryAll(req.tenantDb, 'SELECT * FROM areas');
        const areaNameMap = {};
        areas.forEach(a => { areaNameMap[a.id] = a.name; });

        const loanMap = {};
        loans.forEach(l => { loanMap[l.id] = l; });

        const loaneeRows = loans.map(l => ({
            ANO: l.borrowerNo || formatBorrowerNo(l.slNo) || String(l.slNo),
            NAME: l.name || '',
            ADD1: areaNameMap[l.areaId] || '',
            ADD2: l.address || '',
            ADD3: '',
            FDT: l.fromDate || '',
            TDT: l.toDate || '',
            AMT: l.loanAmount || 0,
            PAMT: l.paidAmount || 0,
            BAMT: l.unpaidAmount || 0,
            DA: l.installmentAmount || 0,
            DW: l.durationMode || (l.frequency === 'Weeks' ? 'W' : (l.frequency === 'Months' ? 'M' : 'D')),
            DS: l.durationSlots || 17
        }));

        const pamt1Rows = collections.map(c => {
            const parent = loanMap[c.loanId];
            return {
                ANO: c.borrowerNo || (parent ? (parent.borrowerNo || formatBorrowerNo(parent.slNo)) : ''),
                PDT: c.date || '',
                AMT: c.amount || 0
            };
        });

        const examtRows = expenses.map(e => ({
            AMT: e.amount || 0,
            DT: e.date || '',
            LAMT: 0
        }));

        const exportPayload = {
            LOANEE: loaneeRows,
            PAMT1: pamt1Rows,
            PAMT2: [],
            EXAMT: examtRows
        };

        fs.writeFileSync(tempJsonPath, JSON.stringify(exportPayload, null, 2));

        const defaultTdata = path.join(__dirname, '../TDATA');
        const targetMdb = customMdbPath || path.join(defaultTdata, folder, `${lineNo}.MDB`);

        const psScript = path.join(__dirname, 'db_ops', 'mentor_bridge.ps1');
        const psArgs = [
            '-ExecutionPolicy', 'Bypass',
            '-File', psScript,
            '-action', 'export-line',
            '-inputJson', tempJsonPath,
            '-mdbPath', targetMdb
        ];

        const psOut = await runPowerShell(psArgs);
        if (!psOut.includes('SUCCESS')) {
            throw new Error('Export script failed: ' + psOut);
        }

        res.json({
            success: true,
            lineNo,
            folder,
            mdbPath: targetMdb,
            message: `Line ${lineNo} exported to ${targetMdb} successfully (${loaneeRows.length} loans, ${pamt1Rows.length} collections).`
        });
    } catch (err) {
        console.error('Export Line Error:', err);
        res.status(500).json({ error: 'Export failed: ' + err.message });
    } finally {
        if (fs.existsSync(tempJsonPath)) try { fs.unlinkSync(tempJsonPath); } catch (e) {}
    }
});

// 4. Mentor ACC.txt Passbook & Card Generator
app.get('/api/tenant/mentor/acc-card/:loanId', async (req, res) => {
    try {
        const { loanId } = req.params;
        const loan = await queryGet(req.tenantDb, 'SELECT * FROM loans WHERE id = ?', [loanId]);
        if (!loan) return res.status(404).json({ error: 'Loan not found.' });

        const areas = await queryAll(req.tenantDb, 'SELECT * FROM areas');
        const areaMap = {};
        areas.forEach(a => { areaMap[a.id] = a.name; });
        const villageName = areaMap[loan.areaId] || loan.address || 'Unknown';

        const collections = await queryAll(req.tenantDb, 'SELECT * FROM collections WHERE loanId = ? AND deleted = 0 ORDER BY date ASC, slNo ASC', [loanId]);

        const ano = loan.borrowerNo || formatBorrowerNo(loan.slNo);
        const padL = (str, len) => String(str || '').padStart(len, ' ');

        let text = '';
        text += `             SL.No. ${ano}\n`;
        text += `             Name. ${loan.name}\n`;
        text += `             Address ${villageName}\n`;
        text += `             Date   ${loan.fromDate || ''}\n`;
        text += `            ToDate  ${loan.toDate || ''}\n`;
        text += `             Amount ${loan.loanAmount.toFixed(2)}\n`;
        text += ` Outstanding Amount ${loan.unpaidAmount.toFixed(2)}\n`;
        text += `      ---------------------------------------- \n`;
        text += `        Date             Paid         Total  \n`;
        text += `      ---------------------------------------- \n`;

        let runningTotal = 0;
        collections.forEach(c => {
            runningTotal += Number(c.amount);
            const dt = c.date || '          ';
            const paid = padL(Number(c.amount).toFixed(2), 8);
            const tot = padL(runningTotal.toFixed(2), 11);
            text += `       ${dt}  -- ${paid}  --  ${tot}\n`;
        });
        text += `      ---------------------------------------- \n`;
        text += `      Total Paid: ₹${runningTotal.toFixed(2)} | Balance: ₹${loan.unpaidAmount.toFixed(2)}\n`;

        res.json({
            success: true,
            accText: text,
            rawText: text,
            loan: {
                id: loan.id,
                ano,
                name: loan.name,
                village: villageName,
                fromDate: loan.fromDate,
                toDate: loan.toDate,
                loanAmount: loan.loanAmount,
                installmentAmount: loan.installmentAmount,
                paidAmount: loan.paidAmount,
                unpaidAmount: loan.unpaidAmount,
                status: loan.status
            },
            collections: collections.map((c, i) => ({
                slNo: i + 1,
                date: c.date,
                amount: c.amount,
                runningTotal: collections.slice(0, i + 1).reduce((s, x) => s + Number(x.amount), 0)
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Mentor DUE & Deficit Report Engine
app.get('/api/tenant/mentor/reports/due-list', async (req, res) => {
    try {
        const { line_no, folder, village } = req.query;
        let sql = 'SELECT * FROM loans WHERE deleted = 0 AND unpaidAmount > 0';
        const params = [];

        if (line_no) {
            sql += ' AND (line_no = ? OR line_no = ?)';
            params.push(String(line_no), 'Line ' + line_no);
        }
        if (folder) {
            sql += ' AND (LOWER(folder) = ? OR folder IS NULL)';
            params.push(folder.toLowerCase());
        }

        const loans = await queryAll(req.tenantDb, sql, params);
        const areas = await queryAll(req.tenantDb, 'SELECT * FROM areas');
        const areaMap = {};
        areas.forEach(a => { areaMap[a.id] = a.name; });

        const now = new Date();
        const dueList = [];

        for (let l of loans) {
            const vName = areaMap[l.areaId] || l.address || 'Unknown';
            if (village && vName.toLowerCase() !== village.toLowerCase()) continue;

            const fromDate = l.fromDate ? new Date(l.fromDate) : null;
            let elapsedSlots = 0;

            if (fromDate && !isNaN(fromDate.getTime())) {
                const diffMs = Math.max(0, now.getTime() - fromDate.getTime());
                const isWeekly = l.durationMode === 'W' || l.frequency === 'Weeks';
                const isMonthly = l.durationMode === 'M' || l.frequency === 'Months';

                if (isWeekly) {
                    elapsedSlots = Math.floor(diffMs / (7 * 24 * 3600 * 1000));
                } else if (isMonthly) {
                    elapsedSlots = Math.floor(diffMs / (30 * 24 * 3600 * 1000));
                } else {
                    elapsedSlots = Math.floor(diffMs / (24 * 3600 * 1000));
                }
            }

            const totalSlots = l.durationSlots || (l.durationMode === 'W' ? 17 : (l.durationMode === 'M' ? 5 : 100));
            const aw = Math.min(elapsedSlots, totalSlots);
            const da = l.installmentAmount || (totalSlots > 0 ? (l.loanAmount / totalSlots) : 0);
            const pdw = da > 0 ? Math.floor(l.paidAmount / da) : 0;
            const pw = Math.max(0, aw - pdw);
            const damt = pw * da;

            dueList.push({
                loanId: l.id,
                ano: l.borrowerNo || formatBorrowerNo(l.slNo),
                borrowerNo: l.borrowerNo || formatBorrowerNo(l.slNo),
                name: l.name,
                borrowerName: l.name,
                village: vName,
                line_no: l.line_no,
                startDate: l.fromDate,
                fromDate: l.fromDate,
                toDate: l.toDate,
                loanAmount: l.loanAmount,
                paidAmount: l.paidAmount,
                bamt: l.unpaidAmount,
                outstandingAmount: l.unpaidAmount,
                da: Math.round(da),
                aw,
                pdw,
                pw,
                damt: Math.round(damt),
                isDefaulter: pw >= 2,
                isDue: pw === 1,
                status: pw >= 2 ? 'Defaulter' : (pw === 1 ? 'Due' : 'Current')
            });
        }

        dueList.sort((a, b) => b.pw - a.pw || a.village.localeCompare(b.village));

        const totalDueAmount = dueList.reduce((s, r) => s + r.damt, 0);
        const totalOutstanding = dueList.reduce((s, r) => s + r.outstandingAmount, 0);
        const defaultersCount = dueList.filter(r => r.pw >= 2).length;
        const dueCount = dueList.filter(r => r.pw === 1).length;

        res.json({
            success: true,
            dueList,
            summary: {
                totalCount: dueList.length,
                defaultersCount,
                dueCount,
                totalDueAmount,
                totalDeficitAmount: totalDueAmount,
                totalOutstanding
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Mentor Balance Sheet / Trial Balance
app.get('/api/tenant/mentor/reports/balance-sheet', async (req, res) => {
    try {
        const { line_no, folder } = req.query;
        let sql = 'SELECT * FROM loans WHERE deleted = 0';
        const params = [];
        if (line_no) {
            sql += ' AND (line_no = ? OR line_no = ?)';
            params.push(String(line_no), 'Line ' + line_no);
        }
        if (folder) {
            sql += ' AND (LOWER(folder) = ? OR folder IS NULL)';
            params.push(folder.toLowerCase());
        }

        const loans = await queryAll(req.tenantDb, sql, params);
        const areas = await queryAll(req.tenantDb, 'SELECT * FROM areas');
        const areaMap = {};
        areas.forEach(a => { areaMap[a.id] = a.name; });

        let totalMembers = loans.length;
        let activeMembers = 0;
        let closedMembers = 0;
        let sumAmt = 0;
        let sumPamt = 0;
        let sumBamt = 0;
        let sumDa = 0;

        const villageStats = {};

        loans.forEach(l => {
            const vName = areaMap[l.areaId] || l.address || 'Unknown';
            if (l.unpaidAmount > 0) activeMembers++; else closedMembers++;
            sumAmt += l.loanAmount || 0;
            sumPamt += l.paidAmount || 0;
            sumBamt += l.unpaidAmount || 0;
            sumDa += l.installmentAmount || 0;

            if (!villageStats[vName]) {
                villageStats[vName] = { village: vName, members: 0, amt: 0, pamt: 0, bamt: 0, da: 0 };
            }
            villageStats[vName].members++;
            villageStats[vName].amt += l.loanAmount || 0;
            villageStats[vName].pamt += l.paidAmount || 0;
            villageStats[vName].bamt += l.unpaidAmount || 0;
            villageStats[vName].da += l.installmentAmount || 0;
        });

        res.json({
            success: true,
            summary: {
                totalMembers,
                activeMembers,
                closedMembers,
                totalDisbursed: Math.round(sumAmt),
                totalCollected: Math.round(sumPamt),
                totalOutstanding: Math.round(sumBamt),
                sumAmt: Math.round(sumAmt),
                sumPamt: Math.round(sumPamt),
                sumBamt: Math.round(sumBamt),
                sumDa: Math.round(sumDa),
                recoveryRate: sumAmt > 0 ? ((sumPamt / sumAmt) * 100).toFixed(1) : 0
            },
            villageBreakdown: Object.values(villageStats).sort((a, b) => b.bamt - a.bamt)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Rapid Keyboard-First Collection Posting
app.post('/api/tenant/collections/rapid-post', async (req, res) => {
    try {
        const { loanId, borrowerNo, line_no = 'Line 1', amount, date = new Date().toISOString().substring(0, 10), collectionDate, lat, lng } = req.body;
        if ((!borrowerNo && !loanId) || amount === undefined) {
            return res.status(400).json({ error: 'Borrower number or loan ID and amount required.' });
        }

        const numAmt = Number(amount);
        if (isNaN(numAmt) || numAmt <= 0) {
            return res.status(400).json({ error: 'Invalid collection amount.' });
        }

        let loan = null;
        if (loanId) {
            loan = await queryGet(req.tenantDb, 'SELECT * FROM loans WHERE id = ? AND deleted = 0', [loanId]);
        }

        const cleanAno = borrowerNo ? String(borrowerNo).trim().toUpperCase() : (loan ? loan.borrowerNo : '');
        const targetLine = String(line_no).startsWith('Line ') ? line_no : ('Line ' + line_no);

        if (!loan && cleanAno) {
            loan = await queryGet(req.tenantDb, 'SELECT * FROM loans WHERE borrowerNo = ? AND (line_no = ? OR line_no = ?) AND deleted = 0', [cleanAno, line_no, targetLine]);
            if (!loan) {
                const parsedNo = parseBorrowerNo(cleanAno);
                if (parsedNo !== null) {
                    loan = await queryGet(req.tenantDb, 'SELECT * FROM loans WHERE slNo = ? AND (line_no = ? OR line_no = ?) AND deleted = 0', [parsedNo, line_no, targetLine]);
                }
            }
            if (!loan) {
                loan = await queryGet(req.tenantDb, 'SELECT * FROM loans WHERE borrowerNo = ? AND deleted = 0', [cleanAno]);
            }
        }

        if (!loan) {
            return res.status(404).json({ error: `Borrower ${cleanAno || loanId} not found in ${line_no}.` });
        }

        const newPaid = (loan.paidAmount || 0) + numAmt;
        const newUnpaid = Math.max(0, (loan.loanAmount || 0) - newPaid);
        const newStatus = newUnpaid <= 0 ? 'Paid' : 'Active';

        await queryRun(req.tenantDb, 'UPDATE loans SET paidAmount = ?, unpaidAmount = ?, status = ? WHERE id = ?', [newPaid, newUnpaid, newStatus, loan.id]);

        const lastCol = await queryGet(req.tenantDb, 'SELECT MAX(slNo) as maxSl FROM collections WHERE loanId = ?', [loan.id]);
        const nextSl = (lastCol && lastCol.maxSl ? lastCol.maxSl : 0) + 1;
        const colId = 'coll-' + Math.random().toString(36).substring(2, 11);
        const effectiveDate = collectionDate || date;

        await queryRun(req.tenantDb, `
            INSERT INTO collections (
                id, loanId, slNo, borrowerNo, line_no, folder, amount, date, lat, lng, verifiedLocation, collectorId, expectedAmount, deficit, deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0)
        `, [
            colId,
            loan.id,
            nextSl,
            loan.borrowerNo || cleanAno,
            loan.line_no,
            loan.folder || 'new',
            numAmt,
            effectiveDate,
            lat || null,
            lng || null,
            req.user.username || 'collector',
            loan.installmentAmount || numAmt
        ]);

        res.json({
            success: true,
            collection: {
                id: colId,
                loanId: loan.id,
                borrowerNo: cleanAno,
                amount: numAmt,
                date,
                slNo: nextSl
            },
            loan: {
                id: loan.id,
                name: loan.name,
                borrowerNo: cleanAno,
                loanAmount: loan.loanAmount,
                paidAmount: newPaid,
                unpaidAmount: newUnpaid,
                status: newStatus
            }
        });
    } catch (err) {
        console.error('Rapid Post Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Wipe Tenant Database (Admin Only)
app.post('/api/tenant/db/wipe', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    
    try {
        await queryRun(req.tenantDb, 'DELETE FROM loans');
        await queryRun(req.tenantDb, 'DELETE FROM collections');
        await queryRun(req.tenantDb, 'DELETE FROM areas');
        await queryRun(req.tenantDb, 'DELETE FROM collectors');
        await queryRun(req.tenantDb, 'DELETE FROM lines').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM expenses').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM investments').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM fixed_assets').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM line_transactions').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM daily_floats').catch(() => {});
        await queryRun(req.tenantDb, 'DELETE FROM collector_line_assignments').catch(() => {});
        
        // Wiped without re-seeding to remain clean
        
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Load Demo Data into Tenant Database (Admin Only)
app.post('/api/tenant/db/load-demo', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Only administrators can load demo data.' });
    }
    
    try {
        // Wipe tables first
        await queryRun(req.tenantDb, 'DELETE FROM loans');
        await queryRun(req.tenantDb, 'DELETE FROM collections');
        await queryRun(req.tenantDb, 'DELETE FROM areas');
        await queryRun(req.tenantDb, 'DELETE FROM collectors');
        await queryRun(req.tenantDb, 'DELETE FROM lines').catch(() => {});
        
        // Seed default collector mapping
        await queryRun(req.tenantDb, 'INSERT INTO collectors (username, name, password) VALUES (?, ?, ?)', ['collector', 'Field Collector', hashPassword('collector123')]);
        await queryRun(masterDb, 'INSERT OR IGNORE INTO global_collectors (username, tenant_id) VALUES (?, ?)', ['collector', req.user.tenantId]);
        
        // Helper SVG generators for seeding
        const getDummyAvatar = (name, color = '#6366f1') => {
            const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="50" fill="${color}"/><text x="50%" y="55%" font-family="'Plus Jakarta Sans', sans-serif" font-weight="700" font-size="36" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`;
            return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        };
        const getDummyHouse = (color = '#0ea5e9') => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect width="100" height="100" fill="${color}"/><polygon points="50,20 15,50 85,50" fill="#ffffff"/><rect x="25" y="50" width="50" height="35" fill="#ffffff"/><rect x="43" y="60" width="14" height="25" fill="${color}"/></svg>`;
            return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        };
        
        // Seed Areas
        const areas = [
            { id: 'area-1', name: 'Noupada Coastal Ward', lat: 18.5485, lng: 84.2982, radius: 1000 },
            { id: 'area-2', name: 'Srikakulam East Village', lat: 18.2949, lng: 83.8938, radius: 1200 },
            { id: 'area-3', name: 'Tekkali Market Area', lat: 18.6139, lng: 84.2341, radius: 800 }
        ];
        for (let a of areas) {
            await queryRun(req.tenantDb, 'INSERT INTO areas (id, name, lat, lng, radius) VALUES (?, ?, ?, ?, ?)', [a.id, a.name, a.lat, a.lng, a.radius]);
        }

        // Seed default Lines
        await queryRun(req.tenantDb, 'INSERT INTO lines (id, line_no, area_id, created_at) VALUES (?, ?, ?, ?)', ['line-1', 'Line 1', 'area-1', new Date().toISOString()]);
        await queryRun(req.tenantDb, 'INSERT INTO lines (id, line_no, area_id, created_at) VALUES (?, ?, ?, ?)', ['line-2', 'Line 2', 'area-2', new Date().toISOString()]);
        await queryRun(req.tenantDb, 'INSERT INTO lines (id, line_no, area_id, created_at) VALUES (?, ?, ?, ?)', ['line-3', 'Line 3', 'area-3', new Date().toISOString()]);
        
        // Seed Loans
        const loans = [
            {
                id: 'loan-1', slNo: 1012, name: 'Noupada Lingaraju', address: 'Main Bazar, Noupada Village', areaId: 'area-1',
                frequency: 'Weeks', fromDate: '2026-02-17', toDate: '2026-06-16', loanAmount: 1200, installmentAmount: 100,
                paidAmount: 1010, unpaidAmount: 190, status: 'Active', createdAt: '2026-02-17T10:00:00Z',
                customerPhoto: getDummyAvatar('Noupada Lingaraju', '#10b981'), housePhoto: getDummyHouse('#0ea5e9')
            },
            {
                id: 'loan-2', slNo: 104, name: 'Nalla Saraswathi', address: 'Subramanyam Street, Srikakulam', areaId: 'area-2',
                frequency: 'Months', fromDate: '2019-01-25', toDate: '2019-05-24', loanAmount: 3600, installmentAmount: 900,
                paidAmount: 200, unpaidAmount: 3400, status: 'Active', createdAt: '2019-01-25T11:00:00Z',
                customerPhoto: getDummyAvatar('Nalla Saraswathi', '#f59e0b'), housePhoto: getDummyHouse('#6366f1')
            },
            {
                id: 'loan-3', slNo: 1063, name: 'Pulakala Jairam', address: 'Temple Street, Tekkali', areaId: 'area-3',
                frequency: 'Weeks', fromDate: '2026-03-18', toDate: '2026-07-16', loanAmount: 12000, installmentAmount: 1000,
                paidAmount: 11400, unpaidAmount: 600, status: 'Active', createdAt: '2026-03-18T09:00:00Z',
                customerPhoto: getDummyAvatar('Pulakala Jairam', '#3b82f6'), housePhoto: getDummyHouse('#ec4899')
            },
            {
                id: 'loan-4', slNo: 117, name: 'Sangarapu Santosh', address: 'Fish Landing Road, Noupada', areaId: 'area-1',
                frequency: 'Weeks', fromDate: '2019-03-01', toDate: '2019-07-19', loanAmount: 12000, installmentAmount: 1000,
                paidAmount: 11400, unpaidAmount: 600, status: 'Active', createdAt: '2019-03-01T12:00:00Z',
                customerPhoto: getDummyAvatar('Sangarapu Santosh', '#8b5cf6'), housePhoto: getDummyHouse('#f59e0b')
            },
            {
                id: 'loan-5', slNo: 122, name: 'Bade Sarathi', address: 'East Street, Noupada', areaId: 'area-1',
                frequency: 'Weeks', fromDate: '2019-03-15', toDate: '2019-08-02', loanAmount: 14400, installmentAmount: 1200,
                paidAmount: 14000, unpaidAmount: 400, status: 'Active', createdAt: '2019-03-15T08:00:00Z',
                customerPhoto: getDummyAvatar('Bade Sarathi', '#ec4899'), housePhoto: getDummyHouse('#10b981')
            },
            {
                id: 'loan-6', slNo: 123, name: 'Medimi Ramu', address: 'RTC Complex Area, Tekkali', areaId: 'area-3',
                frequency: 'Days', fromDate: '2019-03-22', toDate: '2019-08-09', loanAmount: 30000, installmentAmount: 200,
                paidAmount: 29900, unpaidAmount: 100, status: 'Active', createdAt: '2019-03-22T08:30:00Z',
                customerPhoto: getDummyAvatar('Medimi Ramu', '#14b8a6'), housePhoto: getDummyHouse('#ef4444')
            }
        ];
        for (let l of loans) {
            await queryRun(req.tenantDb, `
                INSERT INTO loans (
                    id, slNo, name, address, areaId, frequency, fromDate, toDate, 
                    loanAmount, installmentAmount, paidAmount, unpaidAmount, status, createdAt, customerPhoto, housePhoto,
                    principalAmount, interestAmount, durationDays
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [l.id, l.slNo, l.name, l.address, l.areaId, l.frequency, l.fromDate, l.toDate, l.loanAmount, l.installmentAmount, l.paidAmount, l.unpaidAmount, l.status, l.createdAt, l.customerPhoto, l.housePhoto, l.loanAmount, 0, 100]);
        }
        
        // Seed Collections
        const collections = [
            { id: 'coll-100', loanId: 'loan-1', slNo: 1, amount: 500, date: '2026-03-05', lat: 18.5489, lng: 84.2985, verifiedLocation: 1, collectorId: 'collector' },
            { id: 'coll-101', loanId: 'loan-1', slNo: 2, amount: 510, date: '2026-04-12', lat: 18.5482, lng: 84.2979, verifiedLocation: 1, collectorId: 'collector' },
            { id: 'coll-102', loanId: 'loan-3', slNo: 1, amount: 5000, date: '2026-04-10', lat: 18.6141, lng: 84.2345, verifiedLocation: 1, collectorId: 'collector' },
            { id: 'coll-103', loanId: 'loan-3', slNo: 2, amount: 6400, date: '2026-05-18', lat: 18.6136, lng: 84.2339, verifiedLocation: 1, collectorId: 'collector' },
            { id: 'coll-104', loanId: 'loan-4', slNo: 1, amount: 10000, date: '2026-05-20', lat: 18.5499, lng: 84.2995, verifiedLocation: 1, collectorId: 'collector' },
            { id: 'coll-105', loanId: 'loan-4', slNo: 2, amount: 1400, date: '2026-06-01', lat: 18.5471, lng: 84.2965, verifiedLocation: 1, collectorId: 'collector' }
        ];
        for (let c of collections) {
            await queryRun(req.tenantDb, `
                INSERT INTO collections (id, loanId, slNo, amount, date, lat, lng, verifiedLocation, collectorId, expectedAmount, deficit)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [c.id, c.loanId, c.slNo, c.amount, c.date, c.lat, c.lng, c.verifiedLocation, c.collectorId, c.amount, 0]);
        }
        
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// EXPENSES ENDPOINTS
// ==========================================
app.get('/api/tenant/expenses', async (req, res) => {
    try {
        let rows;
        if (req.user.role === 'collector') {
            rows = await queryAll(req.tenantDb, `
                SELECT * FROM expenses 
                WHERE line_no IN (
                    SELECT line_no FROM collector_line_assignments WHERE username = ?
                )
            `, [req.user.username]);
        } else {
            rows = await queryAll(req.tenantDb, 'SELECT * FROM expenses');
        }
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/tenant/expenses', async (req, res) => {
    const { category, amount, description, date, line_no } = req.body;
    if (!category || !amount || !line_no || !date) {
        return res.status(400).json({ error: 'Missing required fields: category, amount, line_no, date' });
    }
    const id = 'exp-' + Date.now();
    try {
        // Compute Trial Balance cash in hand
        const query = `
            SELECT
                (SELECT COALESCE(SUM(amount), 0) FROM line_transactions WHERE line_no = ? AND type = 'invest') as totalCapital,
                (SELECT COALESCE(SUM(c.amount), 0) FROM collections c 
                 JOIN loans l ON c.loanId = l.id 
                 JOIN lines ln ON l.areaId = ln.area_id 
                 WHERE ln.line_no = ? AND c.deleted = 0 AND l.deleted = 0) as totalCollections,
                (SELECT COALESCE(SUM(CASE WHEN l.principalAmount IS NOT NULL AND l.principalAmount > 0 THEN l.principalAmount ELSE l.loanAmount END), 0) FROM loans l 
                 JOIN lines ln ON l.areaId = ln.area_id 
                 WHERE ln.line_no = ? AND l.deleted = 0) as totalPrincipal,
                (SELECT COALESCE(SUM(amount), 0) FROM line_transactions WHERE line_no = ? AND type = 'spend') as totalSpent,
                (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE line_no = ?) as totalExpenses
        `;
        const row = await queryGet(req.tenantDb, query, [line_no, line_no, line_no, line_no, line_no]);
        const cashInHand = row.totalCapital + row.totalCollections - row.totalPrincipal - row.totalSpent - row.totalExpenses;
        
        if (parseFloat(amount) > cashInHand) {
            return res.status(400).json({ error: `Cannot record expense of ₹${amount} because the available Trial Balance cash in hand is only ₹${cashInHand}.` });
        }

        await queryRun(req.tenantDb, `
            INSERT INTO expenses (id, line_no, date, category, amount, description, collector_username)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [id, line_no, date, category, parseFloat(amount), description || '', req.user.username]);
        return res.json({ success: true, message: 'Expense added successfully!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tenant/expenses/:id', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Only owners can delete expenses.' });
    }
    const { id } = req.params;
    try {
        await queryRun(req.tenantDb, 'DELETE FROM expenses WHERE id = ?', [id]);
        return res.json({ success: true, message: 'Expense deleted successfully!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// INVESTMENTS ENDPOINTS
// ==========================================
app.get('/api/tenant/investments', async (req, res) => {
    try {
        let rows;
        if (req.user.role === 'collector') {
            rows = await queryAll(req.tenantDb, `
                SELECT * FROM investments 
                WHERE line_no IN (
                    SELECT line_no FROM collector_line_assignments WHERE username = ?
                )
            `, [req.user.username]);
        } else {
            rows = await queryAll(req.tenantDb, 'SELECT * FROM investments');
        }
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/tenant/investments', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Owner privileges required.' });
    }
    const { investor_name, amount, description, date, line_no } = req.body;
    if (!investor_name || !amount || !line_no || !date) {
        return res.status(400).json({ error: 'Missing required fields: investor_name, amount, line_no, date' });
    }
    const id = 'inv-' + Date.now();
    try {
        await queryRun(req.tenantDb, `
            INSERT INTO investments (id, line_no, date, investor_name, amount, description, collector_username)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [id, line_no, date, investor_name, parseFloat(amount), description || '', req.user.username]);
        return res.json({ success: true, message: 'Investment added successfully!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tenant/investments/:id', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Owner privileges required.' });
    }
    const { id } = req.params;
    try {
        await queryRun(req.tenantDb, 'DELETE FROM investments WHERE id = ?', [id]);
        return res.json({ success: true, message: 'Investment deleted successfully!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// FIXED ASSETS ENDPOINTS
// ==========================================
app.get('/api/tenant/fixed-assets', async (req, res) => {
    try {
        let rows;
        if (req.user.role === 'collector') {
            rows = await queryAll(req.tenantDb, `
                SELECT * FROM fixed_assets 
                WHERE line_no IN (
                    SELECT line_no FROM collector_line_assignments WHERE username = ?
                )
            `, [req.user.username]);
        } else {
            rows = await queryAll(req.tenantDb, 'SELECT * FROM fixed_assets');
        }
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/tenant/fixed-assets', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Owner privileges required.' });
    }
    const { asset_name, amount, description, date, line_no } = req.body;
    if (!asset_name || !amount || !line_no || !date) {
        return res.status(400).json({ error: 'Missing required fields: asset_name, amount, line_no, date' });
    }
    const id = 'ast-' + Date.now();
    try {
        await queryRun(req.tenantDb, `
            INSERT INTO fixed_assets (id, line_no, date, asset_name, amount, description, collector_username)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [id, line_no, date, asset_name, parseFloat(amount), description || '', req.user.username]);
        return res.json({ success: true, message: 'Asset added successfully!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tenant/fixed-assets/:id', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Owner privileges required.' });
    }
    const { id } = req.params;
    try {
        await queryRun(req.tenantDb, 'DELETE FROM fixed_assets WHERE id = ?', [id]);
        return res.json({ success: true, message: 'Asset deleted successfully!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// LINE TRANSACTIONS ENDPOINTS
// ==========================================
app.get('/api/tenant/line-transactions', async (req, res) => {
    try {
        let rows;
        if (req.user.role === 'collector') {
            rows = await queryAll(req.tenantDb, `
                SELECT * FROM line_transactions 
                WHERE line_no IN (
                    SELECT line_no FROM collector_line_assignments WHERE username = ?
                )
            `, [req.user.username]);
        } else {
            rows = await queryAll(req.tenantDb, 'SELECT * FROM line_transactions');
        }
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/tenant/line-transactions', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Owner privileges required.' });
    }
    const { type, person_name, amount, description, date, line_no } = req.body;
    if (!type || !person_name || !amount || !line_no || !date) {
        return res.status(400).json({ error: 'Missing required fields: type, person_name, amount, line_no, date' });
    }
    const id = 'txn-' + Date.now();
    try {
        if (type === 'spend') {
            const query = `
                SELECT
                    (SELECT COALESCE(SUM(amount), 0) FROM line_transactions WHERE line_no = ? AND type = 'invest') as totalCapital,
                    (SELECT COALESCE(SUM(c.amount), 0) FROM collections c 
                     JOIN loans l ON c.loanId = l.id 
                     JOIN lines ln ON l.areaId = ln.area_id 
                     WHERE ln.line_no = ? AND c.deleted = 0 AND l.deleted = 0) as totalCollections,
                    (SELECT COALESCE(SUM(CASE WHEN l.principalAmount IS NOT NULL AND l.principalAmount > 0 THEN l.principalAmount ELSE l.loanAmount END), 0) FROM loans l 
                     JOIN lines ln ON l.areaId = ln.area_id 
                     WHERE ln.line_no = ? AND l.deleted = 0) as totalPrincipal,
                    (SELECT COALESCE(SUM(amount), 0) FROM line_transactions WHERE line_no = ? AND type = 'spend') as totalSpent,
                    (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE line_no = ?) as totalExpenses
            `;
            const row = await queryGet(req.tenantDb, query, [line_no, line_no, line_no, line_no, line_no]);
            const cashInHand = row.totalCapital + row.totalCollections - row.totalPrincipal - row.totalSpent - row.totalExpenses;
            
            if (parseFloat(amount) > cashInHand) {
                return res.status(400).json({ error: `Cannot record spending of ₹${amount} because the available Trial Balance cash in hand is only ₹${cashInHand}.` });
            }
        }

        await queryRun(req.tenantDb, `
            INSERT INTO line_transactions (id, line_no, date, type, person_name, amount, description, collector_username)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, line_no, date, type, person_name.trim(), parseFloat(amount), description || '', req.user.username]);
        return res.json({ success: true, message: 'Transaction recorded successfully!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tenant/line-transactions/:id', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Owner privileges required.' });
    }
    const { id } = req.params;
    try {
        await queryRun(req.tenantDb, 'DELETE FROM line_transactions WHERE id = ?', [id]);
        return res.json({ success: true, message: 'Transaction deleted successfully!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// DAILY FLOATS ENDPOINTS
// ==========================================
app.get('/api/tenant/floats', async (req, res) => {
    try {
        let rows;
        if (req.user.role === 'collector') {
            rows = await queryAll(req.tenantDb, `
                SELECT * FROM daily_floats 
                WHERE line_no IN (
                    SELECT line_no FROM collector_line_assignments WHERE username = ?
                )
            `, [req.user.username]);
        } else {
            rows = await queryAll(req.tenantDb, 'SELECT * FROM daily_floats');
        }
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/tenant/floats', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Only owners can set floats.' });
    }
    const { line_no, date, amount } = req.body;
    if (!line_no || !date || amount === undefined) {
        return res.status(400).json({ error: 'Missing required fields: line_no, date, amount' });
    }
    try {
        // Compute Trial Balance cash in hand
        const query = `
            SELECT
                (SELECT COALESCE(SUM(amount), 0) FROM line_transactions WHERE line_no = ? AND type = 'invest') as totalCapital,
                (SELECT COALESCE(SUM(c.amount), 0) FROM collections c 
                 JOIN loans l ON c.loanId = l.id 
                 JOIN lines ln ON l.areaId = ln.area_id 
                 WHERE ln.line_no = ? AND c.deleted = 0 AND l.deleted = 0) as totalCollections,
                (SELECT COALESCE(SUM(CASE WHEN l.principalAmount IS NOT NULL AND l.principalAmount > 0 THEN l.principalAmount ELSE l.loanAmount END), 0) FROM loans l 
                 JOIN lines ln ON l.areaId = ln.area_id 
                 WHERE ln.line_no = ? AND l.deleted = 0) as totalPrincipal,
                (SELECT COALESCE(SUM(amount), 0) FROM line_transactions WHERE line_no = ? AND type = 'spend') as totalSpent,
                (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE line_no = ?) as totalExpenses
        `;
        const row = await queryGet(req.tenantDb, query, [line_no, line_no, line_no, line_no, line_no]);
        const cashInHand = row.totalCapital + row.totalCollections - row.totalPrincipal - row.totalSpent - row.totalExpenses;
        
        if (parseFloat(amount) > cashInHand) {
            return res.status(400).json({ error: `Cannot allocate float of ₹${amount} because the available Trial Balance cash in hand is only ₹${cashInHand}.` });
        }

        const existing = await queryGet(req.tenantDb, 'SELECT * FROM daily_floats WHERE line_no = ? AND date = ?', [line_no, date]);
        if (existing) {
            await queryRun(req.tenantDb, 'UPDATE daily_floats SET amount = ? WHERE line_no = ? AND date = ?', [parseFloat(amount), line_no, date]);
        } else {
            await queryRun(req.tenantDb, 'INSERT INTO daily_floats (line_no, date, amount) VALUES (?, ?, ?)', [line_no, date, parseFloat(amount)]);
        }
        return res.json({ success: true, message: 'Float updated successfully!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// COLLECTOR ASSIGNMENT ENDPOINTS
// ==========================================
app.get('/api/tenant/collector-lines', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    try {
        const rows = await queryAll(req.tenantDb, 'SELECT * FROM collector_line_assignments');
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/tenant/collector-lines', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Only owners can assign lines.' });
    }
    const { username, line_no } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'Missing required field: username' });
    }
    try {
        await queryRun(req.tenantDb, 'DELETE FROM collector_line_assignments WHERE username = ?', [username]);
        if (line_no) {
            await queryRun(req.tenantDb, 'INSERT INTO collector_line_assignments (username, line_no) VALUES (?, ?)', [username, line_no]);
        }
        return res.json({ success: true, message: 'Collector line assignment updated!' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Wildcard Redirect for SPA Routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Multi-Tenant Server running on http://localhost:${PORT}`);
});
