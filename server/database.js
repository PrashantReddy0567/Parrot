const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Secure Salted PBKDF2 Hashing
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash) return false;
    if (!storedHash.includes(':')) {
        // Fallback for pre-existing plain text records
        return password === storedHash;
    }
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

// Ensure database directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const masterDbPath = path.join(dbDir, 'master.db');
const dbCache = {}; // Cache of active tenant DB connections

// Connect to Master DB
const masterDb = new sqlite3.Database(masterDbPath, (err) => {
    if (err) {
        console.error('Failed to connect to Master DB:', err.message);
    } else {
        console.log('Connected to Master DB.');
        initMasterSchema();
    }
});

// Initialize Master DB Tables
function initMasterSchema() {
    masterDb.serialize(() => {
        // Tenants table: maps owner account to their tenant database
        masterDb.run(`
            CREATE TABLE IF NOT EXISTS tenants (
                tenant_id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password TEXT NOT NULL,
                created_at TEXT NOT NULL,
                company_name TEXT,
                subscription_status TEXT DEFAULT 'active',
                subscription_expires_at TEXT
            )
        `, () => {
            // Safe migrations to add columns to existing master DB
            masterDb.run("ALTER TABLE tenants ADD COLUMN company_name TEXT", () => {});
            masterDb.run("ALTER TABLE tenants ADD COLUMN subscription_status TEXT DEFAULT 'active'", () => {});
            masterDb.run("ALTER TABLE tenants ADD COLUMN subscription_expires_at TEXT", () => {});
        });

        // Global collectors lookup: maps collector username to tenant_id
        masterDb.run(`
            CREATE TABLE IF NOT EXISTS global_collectors (
                username TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL
            )
        `);

        // Super-admin table: global system administrator credentials
        masterDb.run(`
            CREATE TABLE IF NOT EXISTS super_admins (
                username TEXT PRIMARY KEY,
                password TEXT NOT NULL
            )
        `, () => {
            // Seed default administrator if not present or update to Rajkishor@0567
            masterDb.get('SELECT * FROM super_admins WHERE username = ?', ['ramachandra'], (err, row) => {
                const defaultPass = 'Rajkishor@0567';
                const hashedPass = hashPassword(defaultPass);
                if (!row) {
                    masterDb.run('INSERT INTO super_admins (username, password) VALUES (?, ?)', ['ramachandra', hashedPass]);
                    console.log('Default administrator credentials seeded.');
                } else {
                    if (!row.password.includes(':')) {
                        masterDb.run('UPDATE super_admins SET password = ? WHERE username = ?', [hashedPass, 'ramachandra']);
                        console.log('Migrated default admin password to secure hash.');
                    }
                }
            });
        });
    });
}

// Helper to run raw query as Promise
function queryRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// Helper to get single row as Promise
function queryGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Helper to get all rows as Promise
function queryAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Retrieve or open tenant database connection dynamically
function runTenantMigrations(db) {
    db.serialize(() => {
        db.run("ALTER TABLE loans ADD COLUMN principalAmount REAL DEFAULT 0", () => {});
        db.run("ALTER TABLE loans ADD COLUMN interestAmount REAL DEFAULT 0", () => {});
        db.run("ALTER TABLE loans ADD COLUMN durationDays INTEGER DEFAULT 0", () => {});
        db.run("ALTER TABLE loans ADD COLUMN latitude REAL", () => {});
        db.run("ALTER TABLE loans ADD COLUMN longitude REAL", () => {});
        db.run("ALTER TABLE collections ADD COLUMN expectedAmount REAL DEFAULT 0", () => {});
        db.run("ALTER TABLE collections ADD COLUMN deficit REAL DEFAULT 0", () => {});
        db.run("ALTER TABLE loans ADD COLUMN deleted INTEGER DEFAULT 0", () => {});
        db.run("ALTER TABLE collections ADD COLUMN deleted INTEGER DEFAULT 0", () => {});
        db.run("ALTER TABLE loans ADD COLUMN phone TEXT", () => {});
        // Mentor Specific Columns
        db.run("ALTER TABLE loans ADD COLUMN borrowerNo TEXT", () => {});
        db.run("ALTER TABLE loans ADD COLUMN line_no TEXT DEFAULT 'Line 1'", () => {});
        db.run("ALTER TABLE loans ADD COLUMN folder TEXT DEFAULT 'new'", () => {});
        db.run("ALTER TABLE loans ADD COLUMN durationSlots REAL DEFAULT 0", () => {});
        db.run("ALTER TABLE loans ADD COLUMN durationMode TEXT DEFAULT 'W'", () => {});
        db.run("ALTER TABLE loans ADD COLUMN villageOrder INTEGER DEFAULT 0", () => {});
        db.run("ALTER TABLE loans ADD COLUMN examt REAL DEFAULT 0", () => {});

        db.run("ALTER TABLE collections ADD COLUMN borrowerNo TEXT", () => {});
        db.run("ALTER TABLE collections ADD COLUMN line_no TEXT DEFAULT 'Line 1'", () => {});
        db.run("ALTER TABLE collections ADD COLUMN folder TEXT DEFAULT 'new'", () => {});

        db.run(`
            CREATE TABLE IF NOT EXISTS villages (
                id TEXT PRIMARY KEY,
                line_no TEXT NOT NULL,
                serial_no INTEGER NOT NULL,
                village_name TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        `, () => {});
        db.run(`
            CREATE TABLE IF NOT EXISTS lines (
                id TEXT PRIMARY KEY,
                line_no TEXT NOT NULL,
                area_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        `, () => {});
        db.run(`
            CREATE TABLE IF NOT EXISTS tenant_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `, () => {});
        db.run(`
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY,
                line_no TEXT NOT NULL,
                date TEXT NOT NULL,
                category TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT,
                collector_username TEXT NOT NULL
            )
        `, () => {});
        db.run(`
            CREATE TABLE IF NOT EXISTS daily_floats (
                line_no TEXT NOT NULL,
                date TEXT NOT NULL,
                amount REAL DEFAULT 0,
                PRIMARY KEY (line_no, date)
            )
        `, () => {});
        db.run(`
            CREATE TABLE IF NOT EXISTS collector_line_assignments (
                username TEXT NOT NULL,
                line_no TEXT NOT NULL,
                PRIMARY KEY (username, line_no)
            )
        `, () => {});
        db.run(`
            CREATE TABLE IF NOT EXISTS investments (
                id TEXT PRIMARY KEY,
                line_no TEXT NOT NULL,
                date TEXT NOT NULL,
                investor_name TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT,
                collector_username TEXT NOT NULL
            )
        `, () => {});
        db.run(`
            CREATE TABLE IF NOT EXISTS fixed_assets (
                id TEXT PRIMARY KEY,
                line_no TEXT NOT NULL,
                date TEXT NOT NULL,
                asset_name TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT,
                collector_username TEXT NOT NULL
            )
        `, () => {});
        db.run(`
            CREATE TABLE IF NOT EXISTS line_transactions (
                id TEXT PRIMARY KEY,
                line_no TEXT NOT NULL,
                date TEXT NOT NULL,
                type TEXT NOT NULL,
                person_name TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT,
                collector_username TEXT NOT NULL
            )
        `, () => {});

        // Performance Indexes for fast lookups & nested queries
        db.run("CREATE INDEX IF NOT EXISTS idx_loans_areaId ON loans(areaId)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_collections_loanId ON collections(loanId)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_lines_lineNo ON lines(line_no)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_lines_areaId ON lines(area_id)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_collector_line_assignments_username ON collector_line_assignments(username)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_collector_line_assignments_lineNo ON collector_line_assignments(line_no)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_loans_deleted ON loans(deleted)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_collections_deleted ON collections(deleted)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_collections_date ON collections(date)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_loans_lineNo_folder ON loans(line_no, folder)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_loans_borrowerNo ON loans(borrowerNo)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_collections_lineNo_folder ON collections(line_no, folder)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_collections_borrowerNo ON collections(borrowerNo)", () => {});
        db.run("CREATE INDEX IF NOT EXISTS idx_villages_lineNo ON villages(line_no)", () => {});
    });
}

function getTenantDB(tenantId) {
    if (!tenantId) {
        throw new Error('Tenant ID is required to resolve database context.');
    }
    if (dbCache[tenantId]) {
        return dbCache[tenantId];
    }

    const tenantDbPath = path.join(dbDir, `tenant_${tenantId}.db`);
    const dbExists = fs.existsSync(tenantDbPath);

    const db = new sqlite3.Database(tenantDbPath);
    dbCache[tenantId] = db;

    if (!dbExists) {
        console.log(`Initializing new database schema for tenant: ${tenantId}`);
        initTenantSchema(db);
    }
    
    // Ensure all migrations run on every connection
    runTenantMigrations(db);

    return db;
}

// Initialize Tenant Database Schema
function initTenantSchema(db) {
    db.serialize(() => {
        // Areas Table
        db.run(`
            CREATE TABLE IF NOT EXISTS areas (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                radius INTEGER NOT NULL
            )
        `);

        // Collectors Table
        db.run(`
            CREATE TABLE IF NOT EXISTS collectors (
                username TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                password TEXT NOT NULL
            )
        `);

        // Loans Table
        db.run(`
            CREATE TABLE IF NOT EXISTS loans (
                id TEXT PRIMARY KEY,
                slNo INTEGER NOT NULL,
                name TEXT NOT NULL,
                address TEXT NOT NULL,
                areaId TEXT NOT NULL,
                frequency TEXT NOT NULL,
                fromDate TEXT NOT NULL,
                toDate TEXT NOT NULL,
                loanAmount REAL NOT NULL,
                installmentAmount REAL NOT NULL,
                paidAmount REAL DEFAULT 0,
                unpaidAmount REAL NOT NULL,
                status TEXT DEFAULT 'Active',
                createdAt TEXT NOT NULL,
                customerPhoto TEXT NOT NULL,
                housePhoto TEXT,
                principalAmount REAL DEFAULT 0,
                interestAmount REAL DEFAULT 0,
                durationDays INTEGER DEFAULT 0,
                latitude REAL,
                longitude REAL,
                deleted INTEGER DEFAULT 0,
                phone TEXT
            )
        `, () => {
            // Safe migrations to add columns to existing databases
            db.run("ALTER TABLE loans ADD COLUMN principalAmount REAL DEFAULT 0", () => {});
            db.run("ALTER TABLE loans ADD COLUMN interestAmount REAL DEFAULT 0", () => {});
            db.run("ALTER TABLE loans ADD COLUMN durationDays INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE loans ADD COLUMN latitude REAL", () => {});
            db.run("ALTER TABLE loans ADD COLUMN longitude REAL", () => {});
            db.run("ALTER TABLE loans ADD COLUMN deleted INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE loans ADD COLUMN phone TEXT", () => {});
        });

        // Collections Table
        db.run(`
            CREATE TABLE IF NOT EXISTS collections (
                id TEXT PRIMARY KEY,
                loanId TEXT NOT NULL,
                slNo INTEGER NOT NULL,
                amount REAL NOT NULL,
                date TEXT NOT NULL,
                lat REAL,
                lng REAL,
                verifiedLocation INTEGER DEFAULT 0, -- boolean 0/1
                collectorId TEXT NOT NULL,
                expectedAmount REAL DEFAULT 0,
                deficit REAL DEFAULT 0,
                deleted INTEGER DEFAULT 0
            )
        `, () => {
            db.run("ALTER TABLE collections ADD COLUMN expectedAmount REAL DEFAULT 0", () => {});
            db.run("ALTER TABLE collections ADD COLUMN deficit REAL DEFAULT 0", () => {});
            db.run("ALTER TABLE collections ADD COLUMN deleted INTEGER DEFAULT 0", () => {});
        });

        // Lines Table
        db.run(`
            CREATE TABLE IF NOT EXISTS lines (
                id TEXT PRIMARY KEY,
                line_no TEXT NOT NULL,
                area_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        `);

        // Settings Table
        db.run(`
            CREATE TABLE IF NOT EXISTS tenant_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        // Expenses Table
        db.run(`
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY,
                line_no TEXT NOT NULL,
                date TEXT NOT NULL,
                category TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT,
                collector_username TEXT NOT NULL
            )
        `);

        // Daily Floats Table
        db.run(`
            CREATE TABLE IF NOT EXISTS daily_floats (
                line_no TEXT NOT NULL,
                date TEXT NOT NULL,
                amount REAL DEFAULT 0,
                PRIMARY KEY (line_no, date)
            )
        `);

        // Collector Line Assignments Table
        db.run(`
            CREATE TABLE IF NOT EXISTS collector_line_assignments (
                username TEXT NOT NULL,
                line_no TEXT NOT NULL,
                PRIMARY KEY (username, line_no)
            )
        `);
    });
}

function closeTenantDB(tenantId) {
    return new Promise((resolve, reject) => {
        if (dbCache[tenantId]) {
            dbCache[tenantId].close((err) => {
                if (err) {
                    console.error(`Error closing DB for tenant ${tenantId}:`, err.message);
                    reject(err);
                } else {
                    console.log(`Closed DB connection for tenant ${tenantId}.`);
                    delete dbCache[tenantId];
                    resolve();
                }
            });
        } else {
            resolve();
        }
    });
}

module.exports = {
    masterDb,
    getTenantDB,
    closeTenantDB,
    queryRun,
    queryGet,
    queryAll,
    hashPassword,
    verifyPassword
};
