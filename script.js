// Bijective Alphanumeric Serial Number Conversion Helpers
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
    if (isNaN(slNo)) return String(slNo);
    const num = slNo % 1000000;
    const prefixCode = Math.floor(slNo / 1000000);
    const prefix = codeToPrefix(prefixCode);
    return prefix + num;
}

// State and DB Initialization
const DEFAULT_COORDS = { lat: 18.5485, lng: 84.2982 }; // Center near Noupada, Andhra Pradesh, India
let db = {
    loans: [],
    collections: [],
    areas: [],
    collectors: [],
    owners: [],
    lines: [],
    expenses: [],
    dailyFloats: [],
    collectorLines: [],
    investments: [],
    fixedAssets: [],
    lineTransactions: []
};

let activeUser = null;
let currentView = 'dashboard';
let currentNavIndex = -1; // Index of current loan in edit view navigation
let currentCalDate = new Date(); // Default calendar date: current date
let activeLineId = '';
let activeFolder = 'new'; // 'new' or 'old'
let dashMap = null;
let areaMap = null;
let areaMapMarkers = [];
let areaMapCircles = [];
let portalAreaMap = null;
let portalAreaMapMarkers = [];
let portalAreaMapCircles = [];
let dashMapLayers = [];
let monthlyChart = null;
let tempCustPhoto = '';
let tempHousePhoto = '';
let currentPortalTab = 'lines';

// Complete client database purge to ensure 100% tenant isolation
function resetClientDatabase() {
    db = {
        loans: [],
        collections: [],
        areas: [],
        collectors: [],
        owners: [],
        lines: [],
        expenses: [],
        dailyFloats: [],
        collectorLines: [],
        investments: [],
        fixedAssets: [],
        lineTransactions: [],
        villages: []
    };
    activeUser = null;
    activeLineId = '';
    activeFolder = 'new';
    currentNavIndex = -1;
    if (typeof activeRapidLoanee !== 'undefined') activeRapidLoanee = null;
    if (typeof rapidSessionRecords !== 'undefined') rapidSessionRecords = [];
    if (typeof currentDueReportData !== 'undefined') currentDueReportData = [];

    // Clear session storage tokens & active line
    sessionStorage.removeItem('tsfs_session');
    sessionStorage.removeItem('tsfs_jwt');
    sessionStorage.removeItem('tsfs_active_line');

    // Clean up map instances to prevent cross-tenant layout/caching issues
    if (dashMap) {
        try { dashMap.remove(); } catch(e) {}
        dashMap = null;
    }
    if (areaMap) {
        try { areaMap.remove(); } catch(e) {}
        areaMap = null;
    }
    if (portalAreaMap) {
        try { portalAreaMap.remove(); } catch(e) {}
        portalAreaMap = null;
    }
    dashMapLayers = [];
    areaMapMarkers = [];
    areaMapCircles = [];
    portalAreaMapMarkers = [];
    portalAreaMapCircles = [];

    // Clear DOM dropdowns
    const portalDropdown = document.getElementById('portal-lines-dropdown');
    if (portalDropdown) {
        portalDropdown.innerHTML = '<option value="">-- Select a Collection Line --</option>';
    }
    const loanAreaSelect = document.getElementById('loan-area');
    if (loanAreaSelect) {
        loanAreaSelect.innerHTML = '<option value="">-- Select Village/Area --</option>';
    }
    const memberAreaSelect = document.getElementById('filter-member-area');
    if (memberAreaSelect) {
        memberAreaSelect.innerHTML = '<option value="">All Areas</option>';
    }
    const slipAreaSelect = document.getElementById('slip-filter-area');
    if (slipAreaSelect) {
        slipAreaSelect.innerHTML = '<option value="">All Areas</option>';
    }
    const newLineAreaSelect = document.getElementById('portal-new-line-area');
    if (newLineAreaSelect) {
        newLineAreaSelect.innerHTML = '<option value="">-- Area --</option>';
    }
    const folderList = document.getElementById('loan-folder-list');
    if (folderList) {
        folderList.innerHTML = '';
    }
}

function getLatestCollectionDate() {
    if (db.collections && db.collections.length > 0) {
        const nonDeleted = db.collections.filter(c => !c.deleted);
        if (nonDeleted.length > 0) {
            const sorted = [...nonDeleted].sort((a, b) => b.date.localeCompare(a.date));
            return sorted[0].date;
        }
    }
    return new Date().toISOString().substring(0, 10);
}

function getLatestYear() {
    let latestYear = new Date().getFullYear();
    if (db.loans && db.loans.length > 0) {
        db.loans.forEach(l => {
            const date = new Date(l.fromDate);
            if (!isNaN(date.getFullYear())) {
                latestYear = Math.max(latestYear, date.getFullYear());
            }
        });
    }
    if (db.collections && db.collections.length > 0) {
        db.collections.forEach(c => {
            const date = new Date(c.date);
            if (!isNaN(date.getFullYear())) {
                latestYear = Math.max(latestYear, date.getFullYear());
            }
        });
    }
    return latestYear;
}

const uiTranslations = {
    en: {
        // Sidebar Menu
        menu_dashboard: "Dashboard",
        menu_new_loans: "New Loans",
        menu_daily_posting: "Daily Posting",
        menu_total_members: "Total Members",
        menu_posting_slips: "Posting Slips",
        menu_monthly_list: "Monthly List",
        menu_trial_balance: "Trial Balance",
        menu_area_management: "Area Management",
        menu_admin_console: "Admin Console",
        menu_settings: "System Settings",
        menu_switch_line: "Switch Line",
        menu_logout: "Log Out",

        // View Titles
        view_title_dashboard: "Dashboard Overview",
        view_title_new_loans: "New Loan Registration",
        view_title_daily_posting: "Daily Posting Entry",
        view_title_total_members: "Total Members Directory",
        view_title_posting_slips: "Transaction Posting Slips",
        view_title_monthly_list: "Monthly Ledger & Reports",
        view_title_trial_balance: "Trial Balance & Capital Management",
        view_title_area_settings: "Village / Area Configuration",
        view_title_admin_console: "Administrative Platform Console",
        view_title_settings: "System Settings",

        // Main Stat Cards
        dash_total_loans: "Total Loans Issued",
        dash_total_paid: "Total Paid (Collections)",
        dash_outstanding_bal: "Outstanding Balance",
        dash_total_members: "Total Members",

        // Status badges
        status_done: "Done",
        status_pending: "Pending",
        status_over_days: "Over Days",

        // Table Headers
        th_slno: "Sl.No",
        th_name: "Name",
        th_area: "Area",
        th_start_date: "Start Date",
        th_end_date: "End Date",
        th_loan_amt: "Loan Amt",
        th_paid: "Paid",
        th_unpaid: "Unpaid",
        th_status: "Status",
        th_action: "Action",

        // Labels
        label_member_name: "Member Full Name",
        label_area: "Target Village / Area",
        label_phone: "Mobile / Phone Number",
        label_principal: "Principal Amount (₹)",
        label_interest_rate: "Interest Amount (₹)",
        label_no_days: "Duration (Days)",
        label_total_loan: "Total Loan Amount (₹)",
        label_daily_inst: "Daily Installment Amount (₹)",
        label_start_date: "Start Date",
        label_end_date: "End Date",
        label_member_photo: "Customer Photo",
        label_house_photo: "House Photo (Optional)",
        label_collection_date: "Collection Date",
        label_expected_amount: "Expected Amt (₹)",
        label_actual_paid: "Actual Paid (₹)",
        
        // Placeholders
        placeholder_member_name: "Enter member's full name",
        placeholder_phone: "Enter 10-digit mobile number",
        placeholder_principal: "e.g. 10000",
        placeholder_interest_rate: "e.g. 2000",
        placeholder_no_days: "e.g. 100",
        placeholder_enter_amount: "₹ Enter amount",
        placeholder_enter_slno: "Enter Sl.No (e.g. A230)",

        // Language settings card
        lang_settings_title: "Language Settings",
        lang_settings_desc: "Configure your system display language and your input typing language.",
        label_system_lang: "System Language",
        label_input_lang: "Input Language",
        label_translit_enable: "Enable Phonetic Transliteration (Space to convert English to native script)"
    },
    hi: {
        // Sidebar Menu
        menu_dashboard: "डैशबोर्ड",
        menu_new_loans: "नया ऋण",
        menu_daily_posting: "दैनिक प्रविष्टि",
        menu_total_members: "कुल सदस्य",
        menu_posting_slips: "पोस्टिंग पर्ची",
        menu_monthly_list: "मासिक सूची",
        menu_trial_balance: "तुलन पत्र",
        menu_area_management: "क्षेत्र प्रबंधन",
        menu_admin_console: "एडमिन कंसोल",
        menu_settings: "सिस्टम सेटिंग्स",
        menu_switch_line: "लाइन बदलें",
        menu_logout: "लॉग आउट",

        // View Titles
        view_title_dashboard: "डैशबोर्ड अवलोकन",
        view_title_new_loans: "नया ऋण पंजीकरण",
        view_title_daily_posting: "दैनिक पोस्टिंग प्रविष्टि",
        view_title_total_members: "कुल सदस्य निर्देशिका",
        view_title_posting_slips: "लेनदेन पोस्टिंग पर्ची",
        view_title_monthly_list: "मासिक खाता और रिपोर्ट",
        view_title_trial_balance: "तुलन पत्र और पूंजी प्रबंधन",
        view_title_area_settings: "गांव / क्षेत्र विन्यास",
        view_title_admin_console: "प्रशासनिक मंच कंसोल",
        view_title_settings: "सिस्टम सेटिंग्स",

        // Main Stat Cards
        dash_total_loans: "कुल जारी ऋण",
        dash_total_paid: "कुल भुगतान (संग्रह)",
        dash_outstanding_bal: "बकाया राशि",
        dash_total_members: "कुल सदस्य",

        // Status badges
        status_done: "पूर्ण (Done)",
        status_pending: "लंबित (Pending)",
        status_over_days: "अतिरिक्त दिन (Over Days)",

        // Table Headers
        th_slno: "क्रम संख्या",
        th_name: "नाम",
        th_area: "क्षेत्र",
        th_start_date: "शुरू तिथि",
        th_end_date: "अंत तिथि",
        th_loan_amt: "ऋण राशि",
        th_paid: "भुगतान किया",
        th_unpaid: "शेष ऋण",
        th_status: "स्थिति",
        th_action: "कार्रवाई",

        // Labels
        label_member_name: "सदस्य का पूरा नाम",
        label_area: "लक्ष्य गांव / क्षेत्र",
        label_phone: "मोबाइल / फोन नंबर",
        label_principal: "मूल राशि (₹)",
        label_interest_rate: "ब्याज राशि (₹)",
        label_no_days: "अवधि (दिन)",
        label_total_loan: "कुल ऋण राशि (₹)",
        label_daily_inst: "दैनिक किस्त राशि (₹)",
        label_start_date: "शुरू होने की तिथि",
        label_end_date: "समाप्ति तिथि",
        label_member_photo: "ग्राहक फोटो",
        label_house_photo: "घर की फोटो (वैकल्पिक)",
        label_collection_date: "संग्रह तिथि",
        label_expected_amount: "अपेक्षित राशि (₹)",
        label_actual_paid: "वास्तविक भुगतान (₹)",
        
        // Placeholders
        placeholder_member_name: "सदस्य का पूरा नाम दर्ज करें",
        placeholder_phone: "10-अंकीय मोबाइल नंबर दर्ज करें",
        placeholder_principal: "जैसे: 10000",
        placeholder_interest_rate: "जैसे: 2000",
        placeholder_no_days: "जैसे: 100",
        placeholder_enter_amount: "₹ राशि दर्ज करें",
        placeholder_enter_slno: "क्रम संख्या दर्ज करें (जैसे: A230)",

        // Language settings card
        lang_settings_title: "भाषा सेटिंग्स",
        lang_settings_desc: "अपनी सिस्टम प्रदर्शन भाषा और अपनी इनपुट टाइपिंग भाषा को कॉन्फ़िगर करें।",
        label_system_lang: "सिस्टम भाषा",
        label_input_lang: "इनपुट भाषा",
        label_translit_enable: "ध्वन्यात्मक लिप्यंतरण सक्षम करें (अंग्रेजी को हिंदी लिपि में बदलने के लिए स्पेस दबाएं)"
    },
    te: {
        // Sidebar Menu
        menu_dashboard: "డ్యాష్‌బోర్డ్",
        menu_new_loans: "కొత్త రుణాలు",
        menu_daily_posting: "రోజువారీ పోస్టింగ్",
        menu_total_members: "మొత్తం సభ్యులు",
        menu_posting_slips: "పోస్టింగ్ స్లిప్స్",
        menu_monthly_list: "నెలవారీ జాబితా",
        menu_trial_balance: "ట్రయల్ బ్యాలెన్స్",
        menu_area_management: "ఏరియా మేనేజ్‌మెంట్",
        menu_admin_console: "అడ్మిన్ కన్సోల్",
        menu_settings: "సిస్టమ్ సెట్టింగ్స్",
        menu_switch_line: "లైన్ మార్చండి",
        menu_logout: "లాగ్ అవుట్",

        // View Titles
        view_title_dashboard: "డ్యాష్‌బోర్డ్ అవలోకనం",
        view_title_new_loans: "కొత్త రుణ నమోదు",
        view_title_daily_posting: "రోజువారీ పోస్టింగ్ నమోదు",
        view_title_total_members: "మొత్తం సభ్యుల జాబితా",
        view_title_posting_slips: "లావాదేవీల పోస్టింగ్ స్లిప్స్",
        view_title_monthly_list: "నెలవారీ లెడ్జర్ & నివేదికలు",
        view_title_trial_balance: "ట్రయల్ బ్యాలెన్స్ & క్యాపిటల్ మేనేజ్‌మెంట్",
        view_title_area_settings: "గ్రామం / ఏరియా కాన్ఫిగరేషన్",
        view_title_admin_console: "అడ్మినిస్ట్రేటివ్ ప్లాట్‌ఫాం కన్సోల్",
        view_title_settings: "సిస్టమ్ సెట్టింగ్స్",

        // Main Stat Cards
        dash_total_loans: "మొత్తం ఇచ్చిన రుణాలు",
        dash_total_paid: "మొత్తం వసూళ్లు (చెల్లించినవి)",
        dash_outstanding_bal: "బకాయి మొత్తం",
        dash_total_members: "మొత్తం సభ్యులు",

        // Status badges
        status_done: "పూర్తయింది (Done)",
        status_pending: "పెండింగ్ (Pending)",
        status_over_days: "గడువు ముగిసింది (Over Days)",

        // Table Headers
        th_slno: "క్రమ సంఖ్య",
        th_name: "పేరు",
        th_area: "ఏరియా",
        th_start_date: "ప్రారంభ తేదీ",
        th_end_date: "ముగింపు తేదీ",
        th_loan_amt: "రుణ మొత్తం",
        th_paid: "చెల్లించినది",
        th_unpaid: "బకాయి",
        th_status: "స్థితి",
        th_action: "చర్య",

        // Labels
        label_member_name: "సభ్యుని పూర్తి పేరు",
        label_area: "లక్ష్య గ్రామం / ఏరియా",
        label_phone: "మొబైల్ / ఫోన్ నంబర్",
        label_principal: "అసలు మొత్తం (₹)",
        label_interest_rate: "వడ్డీ మొత్తం (₹)",
        label_no_days: "వ్యవధి (రోజులు)",
        label_total_loan: "మొత్తం రుణ విలువ (₹)",
        label_daily_inst: "రోజువారీ వాయిదా మొత్తం (₹)",
        label_start_date: "ప్రారంభ తేదీ",
        label_end_date: "ముగింపు తేదీ",
        label_member_photo: "కస్టమర్ ఫోటో",
        label_house_photo: "ఇంటి ఫోటో (ఐచ్ఛికం)",
        label_collection_date: "వసూలు తేదీ",
        label_expected_amount: "ఆశించిన మొత్తం (₹)",
        label_actual_paid: "చెల్లించిన మొత్తం (₹)",
        
        // Placeholders
        placeholder_member_name: "సభ్యుని పూర్తి పేరు నమోదు చేయండి",
        placeholder_phone: "10 అంకెల మొబైల్ నంబర్ నమోదు చేయండి",
        placeholder_principal: "ఉదా: 10000",
        placeholder_interest_rate: "ఉదా: 2000",
        placeholder_no_days: "ఉదా: 100",
        placeholder_enter_amount: "₹ మొత్తం నమోదు చేయండి",
        placeholder_enter_slno: "క్రమ సంఖ్య నమోదు చేయండి (ఉదా: A230)",

        // Language settings card
        lang_settings_title: "భాషా సెట్టింగ్స్",
        lang_settings_desc: "మీ సిస్టమ్ ప్రదర్శన భాషను మరియు మీ ఇన్‌పుట్ టైపింగ్ భాషను కాన్ఫిగర్ చేయండి.",
        label_system_lang: "సిస్టమ్ భాష",
        label_input_lang: "ఇన్‌పుట్ భాష",
        label_translit_enable: "ధ్వనిరూప లిప్యంతరీకరణను ప్రారంభించు (ఇంగ్లీషును తెలుగులోకి మార్చడానికి స్పేస్ నొక్కండి)"
    }
};

function applyTranslations() {
    const sysLang = localStorage.getItem('systemLanguage') || 'en';
    const inputLang = localStorage.getItem('inputLanguage') || 'en';
    
    const sysDict = uiTranslations[sysLang] || uiTranslations['en'];
    const inputDict = uiTranslations[inputLang] || uiTranslations['en'];

    // 1. Sidebar Links
    document.querySelectorAll('.sidebar-menu span[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        if (sysDict[key]) el.textContent = sysDict[key];
    });
    
    const logoutEl = document.querySelector('#btn-logout span[data-translate]');
    if (logoutEl && sysDict['menu_logout']) {
        logoutEl.textContent = sysDict['menu_logout'];
    }

    // 2. Selectors mappings
    const systemSelectorMappings = {
        '.stats-grid .stat-card:nth-child(1) .stat-label': 'dash_total_loans',
        '.stats-grid .stat-card:nth-child(2) .stat-label': 'dash_total_paid',
        '.stats-grid .stat-card:nth-child(3) .stat-label': 'dash_outstanding_bal',
        '.stats-grid .stat-card:nth-child(4) .stat-label': 'dash_total_members',
        
        '#settings-language-card h3': 'lang_settings_title',
        '#settings-language-card p': 'lang_settings_desc',
        'label[for="settings-system-lang-select"]': 'label_system_lang',
        'label[for="settings-input-lang-select"]': 'label_input_lang',
        'label[for="settings-translit-enabled"]': 'label_translit_enable',

        // Table headers for Total Members
        '#view-total-members th:nth-child(1)': 'th_slno',
        '#view-total-members th:nth-child(3)': 'th_name',
        '#view-total-members th:nth-child(4)': 'th_area',
        '#view-total-members th:nth-child(5)': 'th_start_date',
        '#view-total-members th:nth-child(6)': 'th_end_date',
        '#view-total-members th:nth-child(7)': 'th_loan_amt',
        '#view-total-members th:nth-child(8)': 'th_paid',
        '#view-total-members th:nth-child(9)' : 'th_unpaid',
        '#view-total-members th:nth-child(10)': 'th_status',
        '#view-total-members th:nth-child(11)': 'th_action'
    };

    for (const [selector, key] of Object.entries(systemSelectorMappings)) {
        const el = document.querySelector(selector);
        if (el && sysDict[key]) {
            const icon = el.querySelector('i');
            if (icon) {
                el.innerHTML = '';
                el.appendChild(icon);
                el.appendChild(document.createTextNode(' ' + sysDict[key]));
            } else {
                el.textContent = sysDict[key];
            }
        }
    }

    // 3. Inputs
    const inputSelectorMappings = {
        'label[for="loan-name"]': 'label_member_name',
        'label[for="loan-area"]': 'label_area',
        'label[for="loan-phone"]': 'label_phone',
        'label[for="loan-principal"]': 'label_principal',
        'label[for="loan-interest"]': 'label_interest_rate',
        'label[for="loan-duration"]': 'label_no_days',
        'label[for="loan-amount"]': 'label_total_loan',
        'label[for="loan-inst-amount"]': 'label_daily_inst',
        'label[for="loan-from-date"]': 'label_start_date',
        'label[for="loan-to-date"]': 'label_end_date',
        'label[for="loan-photo-cust"]': 'label_member_photo',
        'label[for="loan-photo-house"]': 'label_house_photo',
        
        'label[for="post-date"]': 'label_collection_date',
        'label[for="post-expected-amount"]': 'label_expected_amount',
        'label[for="post-amount"]': 'label_actual_paid',

        '#loan-name': 'placeholder_member_name',
        '#loan-phone': 'placeholder_phone',
        '#loan-principal': 'placeholder_principal',
        '#loan-interest': 'placeholder_interest_rate',
        '#loan-duration': 'placeholder_no_days',
        '#post-amount': 'placeholder_enter_amount',
        '#post-slno-search': 'placeholder_enter_slno'
    };

    for (const [selector, key] of Object.entries(inputSelectorMappings)) {
        const el = document.querySelector(selector);
        if (el) {
            if (el.tagName === 'LABEL') {
                const icon = el.querySelector('i');
                if (icon) {
                    el.innerHTML = '';
                    el.appendChild(icon);
                    el.appendChild(document.createTextNode(' ' + inputDict[key]));
                } else {
                    el.textContent = inputDict[key];
                }
            } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                if (inputDict[key]) el.placeholder = inputDict[key];
            }
        }
    }

    // Update active title in header
    const activeViewLink = document.querySelector('.menu-link.active');
    if (activeViewLink) {
        const viewId = activeViewLink.getAttribute('data-view');
        if (viewId) {
            const titles = {
                'dashboard': 'Dashboard Overview',
                'new-loans': 'New Loan Registration',
                'daily-posting': 'Daily Posting Entry',
                'total-members': 'Total Members Directory',
                'posting-slips': 'Transaction Posting Slips',
                'monthly-list': 'Monthly Ledger & Reports',
                'trial-balance': 'Trial Balance & Capital Management',
                'area-settings': 'Village / Area Configuration',
                'admin-console': 'Administrative Platform Console',
                'settings': 'System Settings'
            };
            const titleKey = `view_title_${viewId.replace('-', '_')}`;
            const displayTitle = sysDict[titleKey] || titles[viewId] || 'Terrasol FinServ';
            document.getElementById('active-view-title').textContent = displayTitle;
        }
    }
}

// Global transliteration helper
async function transliterateWord(word, lang) {
    if (!word) return '';
    const itc = lang === 'hi' ? 'hi-t-i0-und' : 'te-t-i0-und';
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(word)}&itc=${itc}&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8&app=demopage`;
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600); // 600ms timeout
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        if (data && data[0] === 'SUCCESS') {
            const translits = data[1][0][1];
            if (translits && translits.length > 0) {
                return translits[0];
            }
        }
    } catch (e) {
        console.warn('Transliteration failed or timed out:', e);
    }
    return word; // fallback
}

// Transliteration keypress interception
document.addEventListener('keydown', async (e) => {
    const translitActive = localStorage.getItem('translitEnabled') !== 'false';
    const inputLang = localStorage.getItem('inputLanguage') || 'en';
    
    if (!translitActive || (inputLang !== 'hi' && inputLang !== 'te')) {
        return;
    }
    
    const input = e.target;
    if (input.tagName === 'INPUT' && (input.type === 'text' || input.type === 'search') || input.tagName === 'TEXTAREA') {
        if (e.key === ' ' || e.key === 'Spacebar') {
            const text = input.value;
            const cursorPos = input.selectionStart;
            const textBeforeCursor = text.substring(0, cursorPos);
            const matches = textBeforeCursor.match(/([a-zA-Z]+)$/);
            
            if (matches) {
                e.preventDefault(); // Intercept the space
                const englishWord = matches[1];
                const wordStart = cursorPos - englishWord.length;
                
                const translitWord = await transliterateWord(englishWord, inputLang);
                
                const currentValue = input.value;
                const before = currentValue.substring(0, wordStart);
                const after = currentValue.substring(cursorPos);
                
                input.value = before + translitWord + ' ' + after;
                input.selectionStart = input.selectionEnd = wordStart + translitWord.length + 1;
                
                // Dispatch input event to notify any frameworks/libraries
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }
});

// IndexedDB Offline Cache Helper
const offlineDB = {
    dbName: 'TerrasolOfflineCache',
    dbVersion: 1,
    
    init() {
        return new Promise((resolve) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('sync_cache')) {
                    db.createObjectStore('sync_cache');
                }
            };
            request.onsuccess = (e) => {
                resolve(e.target.result);
            };
            request.onerror = () => {
                resolve(null);
            };
        });
    },
    
    async save(key, data) {
        const db = await this.init();
        if (!db) return false;
        return new Promise((resolve) => {
            const tx = db.transaction('sync_cache', 'readwrite');
            const store = tx.objectStore('sync_cache');
            const request = store.put(data, key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
        });
    },
    
    async get(key) {
        const db = await this.init();
        if (!db) return null;
        return new Promise((resolve) => {
            const tx = db.transaction('sync_cache', 'readonly');
            const store = tx.objectStore('sync_cache');
            const request = store.get(key);
            request.onsuccess = (e) => resolve(e.target.result || null);
            request.onerror = () => resolve(null);
        });
    }
};

// Offline Mutation Request Queue
const offlineQueue = {
    async enqueue(url, options) {
        const queue = await offlineDB.get('pending_requests') || [];
        queue.push({ id: Date.now(), url, options });
        await offlineDB.save('pending_requests', queue);
        showToast('Saved transaction to offline sync queue.', 'warning');
        this.processQueue();
    },
    async processQueue() {
        if (!navigator.onLine) return;
        const queue = await offlineDB.get('pending_requests') || [];
        if (queue.length === 0) return;
        
        console.log(`Processing ${queue.length} pending offline transactions...`);
        const remaining = [];
        for (const req of queue) {
            try {
                const token = sessionStorage.getItem('tsfs_jwt');
                if (token) {
                    if (!req.options.headers) req.options.headers = {};
                    req.options.headers['Authorization'] = `Bearer ${token}`;
                }
                await fetch(req.url, req.options);
            } catch (err) {
                console.error(`Failed to process queued request:`, err);
                remaining.push(req);
            }
        }
        await offlineDB.save('pending_requests', remaining);
        if (remaining.length === 0) {
            showToast('All offline transactions synced successfully!', 'success');
            refreshLocalData();
        }
    }
};

// Sync queue when online status changes
window.addEventListener('online', () => {
    offlineQueue.processQueue();
});
setTimeout(() => offlineQueue.processQueue(), 2000);

// Dynamic Backend API Base URL configuration for decoupled hosting (Vercel + Render)
const DEFAULT_RENDER_BACKEND = 'https://parrot-ledger-api.onrender.com';

function normalizeBackendUrl(url) {
    if (!url) return '';
    let clean = url.trim().replace(/\/+$/, '');
    if (clean && !clean.startsWith('http://') && !clean.startsWith('https://')) {
        clean = 'https://' + clean;
    }
    return clean;
}

let API_BASE_URL = (() => {
    // If running locally or served directly from Render, use relative endpoints
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return '';
    if (window.location.hostname.endsWith('onrender.com')) return '';
    // If hosted on Vercel or custom domain, use configured Render backend URL or default live backend
    const custom = localStorage.getItem('CUSTOM_API_BASE_URL');
    return custom ? normalizeBackendUrl(custom) : DEFAULT_RENDER_BACKEND;
})();

function updateApiStatusIndicator() {
    const apiIndicatorEl = document.getElementById('api-current-url');
    if (!apiIndicatorEl) return;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        apiIndicatorEl.textContent = 'Localhost (Direct)';
        apiIndicatorEl.style.color = '#38bdf8';
    } else if (window.location.hostname.endsWith('onrender.com')) {
        apiIndicatorEl.textContent = 'Render (Direct Full-Stack)';
        apiIndicatorEl.style.color = '#4ade80';
    } else {
        const activeUrl = API_BASE_URL || DEFAULT_RENDER_BACKEND;
        apiIndicatorEl.textContent = activeUrl.replace(/^https?:\/\//, '');
        apiIndicatorEl.style.color = '#4ade80';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    updateApiStatusIndicator();
    const btnChangeApi = document.getElementById('btn-change-api-url');
    if (btnChangeApi) {
        btnChangeApi.addEventListener('click', () => {
            const current = localStorage.getItem('CUSTOM_API_BASE_URL') || DEFAULT_RENDER_BACKEND;
            const next = prompt(
                'Enter your live Render Backend API URL:\n(e.g., https://your-app-name.onrender.com)\n\nLeave blank to reset to default.',
                current
            );
            if (next !== null) {
                const clean = normalizeBackendUrl(next);
                if (clean) {
                    localStorage.setItem('CUSTOM_API_BASE_URL', clean);
                } else {
                    localStorage.removeItem('CUSTOM_API_BASE_URL');
                }
                window.location.reload();
            }
        });
    }
});

function showBillingPage() {
    const billingOverlay = document.getElementById('billing-overlay');
    if (billingOverlay) {
        billingOverlay.style.display = 'flex';
    }
}

function hideBillingPage() {
    const billingOverlay = document.getElementById('billing-overlay');
    if (billingOverlay) {
        billingOverlay.style.display = 'none';
    }
}

// Multi-tenant API Fetch wrapper
async function apiFetch(url, options = {}) {
    const token = sessionStorage.getItem('tsfs_jwt');
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    const targetUrl = url.startsWith('http') ? url : API_BASE_URL + url;
    let response;
    try {
        response = await fetch(targetUrl, { ...options, headers });
    } catch (networkError) {
        if (options.method && options.method !== 'GET' && url.includes('/api/tenant/')) {
            await offlineQueue.enqueue(url, options);
            return { success: true, message: "Saved offline. Will sync when online." };
        }
        throw networkError;
    }
    
    if (response.status === 401 || response.status === 403) {
        showLoginPage();
        throw new Error('Unauthorized');
    }
    if (response.status === 402) {
        showBillingPage();
        throw new Error('Subscription Expired');
    }
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
    }
    return response.json();
}

async function refreshLocalData() {
    if (!activeUser) return;
    try {
        const data = await apiFetch('/api/tenant/sync');
        db.owners = data.owners || [];
        db.areas = data.areas || [];
        db.loans = data.loans || [];
        db.collections = data.collections || [];
        db.collectors = data.collectors || [];
        db.lines = data.lines || [];
        db.villages = data.villages || [];
        db.expenses = data.expenses || [];
        db.dailyFloats = data.dailyFloats || [];
        db.collectorLines = data.collectorLines || [];
        db.investments = data.investments || [];
        db.fixedAssets = data.fixedAssets || [];
        db.lineTransactions = data.lineTransactions || [];
        
        await offlineDB.save('last_sync_' + activeUser.username, db);
        hideBillingPage(); // Hide overlay if sync was successful
    } catch (err) {
        if (err.message === 'Subscription Expired') {
            return; // Managed by 402 interceptor
        }
        console.error('Failed to sync data with server. Loading offline cache:', err);
        const cachedDb = await offlineDB.get('last_sync_' + activeUser.username);
        if (cachedDb) {
            db.owners = cachedDb.owners || [];
            db.areas = cachedDb.areas || [];
            db.loans = cachedDb.loans || [];
            db.collections = cachedDb.collections || [];
            db.collectors = cachedDb.collectors || [];
            db.lines = cachedDb.lines || [];
            db.villages = cachedDb.villages || [];
            db.expenses = cachedDb.expenses || [];
            db.dailyFloats = cachedDb.dailyFloats || [];
            db.collectorLines = cachedDb.collectorLines || [];
            db.investments = cachedDb.investments || [];
            db.fixedAssets = cachedDb.fixedAssets || [];
            db.lineTransactions = cachedDb.lineTransactions || [];
            showToast('Offline Mode: Loaded cached data.', 'warning');
        } else {
            // Strictly reset to clean arrays so no data from prior owner remains in memory
            db.owners = [];
            db.areas = [];
            db.loans = [];
            db.collections = [];
            db.collectors = [];
            db.lines = [];
            db.villages = [];
            db.expenses = [];
            db.dailyFloats = [];
            db.collectorLines = [];
            db.investments = [];
            db.fixedAssets = [];
            db.lineTransactions = [];
            showToast('Offline Mode: No cached data available for this user.', 'warning');
        }
    }
}

// Syncing Indicator State and Helpers
let activeSyncsCount = 0;

function showSyncIndicator() {
    activeSyncsCount++;
    const indicator = document.getElementById('sync-indicator');
    if (indicator) {
        indicator.style.display = 'inline-flex';
    }
}

function hideSyncIndicator() {
    activeSyncsCount--;
    if (activeSyncsCount <= 0) {
        activeSyncsCount = 0;
        const indicator = document.getElementById('sync-indicator');
        if (indicator) {
            setTimeout(() => {
                if (activeSyncsCount === 0) {
                    indicator.style.display = 'none';
                }
            }, 300);
        }
    }
}

// Resize and compress uploaded files via canvas
function processImageUpload(file, maxWidth, maxHeight, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            // Calculate new aspect ratio dimensions
            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Compress JPEG at 70% quality
            const base64 = canvas.toDataURL('image/jpeg', 0.7);
            callback(base64);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Dynamic lightbox modal overlay to enlarge house photo
function showHouseModal(src) {
    let overlay = document.getElementById('house-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'house-modal-overlay';
        overlay.style = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999; cursor:pointer; opacity:0; transition:opacity 0.2s ease; display:none;';
        overlay.innerHTML = `<img id="house-modal-img" src="" style="max-width:90%; max-height:85%; border-radius:12px; border:3px solid rgba(255,255,255,0.1); box-shadow:0 12px 48px rgba(0,0,0,0.5);">`;
        overlay.addEventListener('click', () => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.style.display = 'none', 200);
        });
        document.body.appendChild(overlay);
    }
    document.getElementById('house-modal-img').src = src;
    overlay.style.display = 'flex';
    setTimeout(() => overlay.style.opacity = '1', 50);
}

// DOM Elements & Event Listeners setup on load
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
    updateSystemTime();
});

function initApp() {
    // Check if session exists
    const savedSession = sessionStorage.getItem('tsfs_session');
    const savedJwt = sessionStorage.getItem('tsfs_jwt');
    const savedLine = sessionStorage.getItem('tsfs_active_line');
    if (savedSession && savedJwt) {
        try {
            activeUser = JSON.parse(savedSession);
            if (savedLine) {
                activeLineId = savedLine;
            }
            showMainApp();
        } catch(e) {
            showLoginPage();
        }
    } else {
        showLoginPage();
    }
}

function saveDB() {
    // Handled on backend database
}

// UI Views Transition helper with smooth animations
function transitionToContainer(targetId, displayMode = 'flex') {
    const containers = ['login-container', 'workspace-setup-container', 'line-portal-container', 'app-container'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === targetId) {
                el.style.display = displayMode;
                el.classList.remove('container-active-animate');
                void el.offsetWidth; // Force reflow
                el.classList.add('container-active-animate');
                
                // Remove animation class after completion to prevent fixed positioning bugs on children like the sidebar
                const handleAnimEnd = () => {
                    el.classList.remove('container-active-animate');
                    el.removeEventListener('animationend', handleAnimEnd);
                };
                el.addEventListener('animationend', handleAnimEnd);
            } else {
                el.style.display = 'none';
                el.classList.remove('container-active-animate');
            }
        }
    });
}

// UI Views Switcher
function showLoginPage() {
    transitionToContainer('login-container', 'flex');
    resetClientDatabase();
}

async function showMainApp() {
    if (!activeUser) {
        showLoginPage();
        return;
    }

    // Fetch latest data to ensure we have collectorLines, lines, companyName etc.
    showSyncIndicator();
    try {
        await refreshLocalData();
    } catch (e) {
        console.error("Error refreshing data:", e);
    } finally {
        hideSyncIndicator();
    }

    // Owners without a company name must configure their workspace name first (Page 2)
    if (activeUser && activeUser.role === 'owner' && !activeUser.companyName) {
        transitionToContainer('workspace-setup-container', 'flex');
        document.getElementById('setup-company-name').value = '';
        return;
    }
    
    // If collector, assign line automatically and lock them to it
    if (activeUser && activeUser.role === 'collector') {
        const assignment = db.collectorLines ? db.collectorLines.find(cl => cl.username === activeUser.username) : null;
        if (assignment && assignment.line_no) {
            activeLineId = assignment.line_no;
            sessionStorage.setItem('tsfs_active_line', activeLineId);
        } else {
            showToast('No line assigned to this collector. Please contact the owner/admin.', 'error');
            showLoginPage();
            return;
        }
    }
    
    // If no line is selected and user is not admin, show portal instead
    if (activeUser && activeUser.role !== 'admin' && !activeLineId) {
        await showLinePortal();
        return;
    }
    
    transitionToContainer('app-container', 'flex');
    
    // Update sidebar brand text and header view title fallback
    const brandTextEl = document.getElementById('sidebar-brand-text');
    if (brandTextEl) {
        brandTextEl.textContent = activeUser.companyName || 'Terrasol FinServ';
    }
    
    // Update sidebar active line badge
    const badge = document.getElementById('sidebar-active-line-badge');
    if (badge) {
        badge.innerHTML = `<i class="fa-solid fa-route"></i> Line: ${activeLineId || 'All'}`;
    }
    
    // Set Profile Info
    document.getElementById('profile-name').textContent = activeUser.name;
    const avatar = document.getElementById('user-avatar-initials');
    avatar.textContent = activeUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    
    const roleBadge = document.getElementById('profile-role');
    const roleText = roleBadge.querySelector('span');
    const roleIcon = roleBadge.querySelector('i');
    
    if (activeUser.role === 'owner') {
        roleText.textContent = 'System Owner';
        roleBadge.className = 'user-role owner-role';
        roleIcon.className = 'fa-solid fa-user-tie';
        
        // Show line badge and switch line option
        document.getElementById('active-line-badge-container').style.display = 'block';
        const switchLineMenu = document.getElementById('btn-sidebar-switch-line');
        if (switchLineMenu) switchLineMenu.parentElement.style.display = 'block';
        
        // Show all sidebar menu items except Admin Console
        document.querySelectorAll('.sidebar-menu .menu-item').forEach(el => {
            const viewLink = el.querySelector('.menu-link');
            if (viewLink) {
                const viewId = viewLink.getAttribute('data-view');
                if (viewId === 'admin-console') {
                    el.style.display = 'none';
                } else {
                    el.style.display = 'block';
                }
            } else {
                el.style.display = 'block';
            }
        });
        
        // Hide deletion controls but show navigation controls
        document.querySelectorAll('.owner-only-element').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.owner-admin-element').forEach(el => el.style.display = 'table-cell');
        document.getElementById('loan-navigation-container').style.display = 'flex';
        document.getElementById('owner-delete-btn-container').style.display = 'none';
    } else if (activeUser.role === 'admin') {
        roleText.textContent = 'System Admin';
        roleBadge.className = 'user-role admin-role';
        roleIcon.className = 'fa-solid fa-user-gear';
        
        // Hide line badge and switch line option for Admin
        document.getElementById('active-line-badge-container').style.display = 'none';
        const switchLineMenu = document.getElementById('btn-sidebar-switch-line');
        if (switchLineMenu) switchLineMenu.parentElement.style.display = 'none';
        
        // Show only Admin Console and Settings
        document.querySelectorAll('.sidebar-menu .menu-item').forEach(el => {
            const viewLink = el.querySelector('.menu-link');
            if (viewLink) {
                const viewId = viewLink.getAttribute('data-view');
                if (viewId === 'admin-console' || viewId === 'settings') {
                    el.style.display = 'block';
                } else {
                    el.style.display = 'none';
                }
            } else {
                el.style.display = 'block';
            }
        });
        
        // Hide standard owner/admin elements since admin acts as platform manager
        document.querySelectorAll('.owner-only-element').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.owner-admin-element').forEach(el => el.style.display = 'none');
        document.getElementById('loan-navigation-container').style.display = 'none';
        document.getElementById('owner-delete-btn-container').style.display = 'none';
    } else {
        roleText.textContent = 'Field Collector';
        roleBadge.className = 'user-role';
        roleIcon.className = 'fa-solid fa-motorcycle';
        
        // Show line badge but hide switch line option
        document.getElementById('active-line-badge-container').style.display = 'block';
        const switchLineMenu = document.getElementById('btn-sidebar-switch-line');
        if (switchLineMenu) switchLineMenu.parentElement.style.display = 'none';
        
        // Hide owner only elements, admin console, and others except new-loans and daily-posting
        document.querySelectorAll('.sidebar-menu .menu-item').forEach(el => {
            const viewLink = el.querySelector('.menu-link');
            if (viewLink) {
                const viewId = viewLink.getAttribute('data-view');
                if (viewId === 'new-loans' || viewId === 'daily-posting') {
                    el.style.display = 'block';
                } else {
                    el.style.display = 'none';
                }
            } else {
                el.style.display = 'none';
            }
        });
        
        document.querySelectorAll('.owner-only-element').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.owner-admin-element').forEach(el => el.style.display = 'none');
        document.getElementById('loan-navigation-container').style.display = 'none';
        document.getElementById('owner-delete-btn-container').style.display = 'none';
    }
    
    // Render default view based on role
    if (activeUser.role === 'admin') {
        switchView('admin-console');
    } else if (activeUser.role === 'owner') {
        switchView('dashboard');
    } else {
        switchView('daily-posting');
    }
}

async function switchView(viewId) {
    // Role-based view protection
    if (activeUser) {
        if (activeUser.role === 'collector') {
            const allowed = ['new-loans', 'daily-posting', 'rapid-posting'];
            if (!allowed.includes(viewId)) {
                viewId = 'rapid-posting';
            }
        } else if (activeUser.role === 'admin') {
            const allowed = ['admin-console', 'settings', 'mentor-center', 'rapid-posting', 'due-reports', 'dashboard', 'new-loans', 'daily-posting', 'total-members', 'posting-slips', 'monthly-list', 'trial-balance', 'area-settings'];
            if (!allowed.includes(viewId)) {
                viewId = 'admin-console';
            }
        } else if (activeUser.role === 'owner') {
            const allowed = ['dashboard', 'mentor-center', 'rapid-posting', 'due-reports', 'new-loans', 'daily-posting', 'total-members', 'posting-slips', 'monthly-list', 'trial-balance', 'area-settings', 'settings'];
            if (!allowed.includes(viewId)) {
                viewId = 'dashboard';
            }
        }
    }
    
    // Always collapse the sidebar by default (expands on hover)
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.classList.add('collapsed');
    }
    
    if (viewId === 'daily-posting' && currentView !== 'daily-posting') {
        const postDateInput = document.getElementById('post-date');
        if (postDateInput) {
            postDateInput.value = getLatestCollectionDate();
        }
    }
    currentView = viewId;
    
    // Update active class in sidebar links
    document.querySelectorAll('.menu-link').forEach(link => {
        if (link.getAttribute('data-view') === viewId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // Update active class in bottom nav links
    document.querySelectorAll('.bottom-nav-link').forEach(link => {
        if (link.getAttribute('data-view') === viewId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
    
    // Update header title
    const titles = {
        'dashboard': 'Dashboard Overview',
        'mentor-center': 'Mentor Line Books Manager',
        'rapid-posting': 'Rapid Daily Posting (Counter Mode)',
        'due-reports': 'Mentor Due & Deficit Reports',
        'new-loans': 'New Loan Registration',
        'daily-posting': 'Field Collections Entry',
        'total-members': 'Total Members Directory',
        'posting-slips': 'Transaction Posting Slips',
        'monthly-list': 'Monthly Ledger & Reports',
        'trial-balance': 'Trial Balance & Capital Management',
        'area-settings': 'Village / Area Configuration',
        'admin-console': 'Administrative Platform Console',
        'settings': 'System Settings'
    };
    document.getElementById('active-view-title').textContent = titles[viewId] || (activeUser ? activeUser.companyName : '') || 'Terrasol FinServ';
    
    // Toggle active view panel
    document.querySelectorAll('.app-view').forEach(panel => {
        if (panel.id === `view-${viewId}`) {
            panel.classList.add('active-view');
        } else {
            panel.classList.remove('active-view');
        }
    });

    // Populate Area Dropdowns immediately using current cache
    populateAreaDropdowns();

    // Render immediately using cache (0ms latency view transition)
    triggerViewRendering(viewId);

    // Sync in the background and update view when completed
    showSyncIndicator();
    refreshLocalData()
        .then(() => {
            if (currentView === viewId) {
                populateAreaDropdowns();
                triggerViewRendering(viewId);
            }
        })
        .finally(() => {
            hideSyncIndicator();
        });
}

function triggerViewRendering(viewId) {
    if (viewId === 'dashboard') {
        renderDashboard();
    } else if (viewId === 'mentor-center') {
        renderMentorCenter();
    } else if (viewId === 'rapid-posting') {
        renderRapidPosting();
    } else if (viewId === 'due-reports') {
        renderDueReports();
    } else if (viewId === 'new-loans') {
        renderNewLoans();
    } else if (viewId === 'daily-posting') {
        renderDailyPosting();
    } else if (viewId === 'total-members') {
        renderTotalMembers();
    } else if (viewId === 'posting-slips') {
        renderPostingSlips();
    } else if (viewId === 'monthly-list') {
        renderMonthlyList();
    } else if (viewId === 'trial-balance') {
        renderTrialBalance();
    } else if (viewId === 'area-settings') {
        renderAreaSettings();
    } else if (viewId === 'admin-console') {
        renderAdminConsole();
    } else if (viewId === 'settings') {
        renderSettingsView();
    }
}

// Setup Event Listeners
function setupEventListeners() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    // Helper to close mobile sidebar drawer
    const closeMobileSidebar = () => {
        if (window.innerWidth < 992) {
            if (sidebar) sidebar.classList.remove('mobile-open');
            if (overlay) overlay.classList.remove('active');
        }
    };

    // Login Submit
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    
    // Toggle Password Visibility
    const togglePasswordBtn = document.getElementById('toggle-password-btn');
    if (togglePasswordBtn) {
        togglePasswordBtn.addEventListener('click', () => {
            const passwordInput = document.getElementById('login-password');
            const passwordIcon = document.getElementById('toggle-password-icon');
            if (passwordInput && passwordIcon) {
                if (passwordInput.type === 'password') {
                    passwordInput.type = 'text';
                    passwordIcon.className = 'fa-solid fa-eye-slash';
                } else {
                    passwordInput.type = 'password';
                    passwordIcon.className = 'fa-solid fa-eye';
                }
            }
        });
    }
    
    // Sidebar Links
    document.querySelectorAll('.menu-link[data-view]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = link.getAttribute('data-view');
            switchView(targetView);
            closeMobileSidebar();
        });
    });
    
    // Sidebar Toggle
    if (sidebar) {
        document.getElementById('sidebar-toggle').addEventListener('click', () => {
            if (window.innerWidth < 992) {
                sidebar.classList.toggle('mobile-open');
                if (overlay) overlay.classList.toggle('active');
            } else {
                sidebar.classList.toggle('collapsed');
            }
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            closeMobileSidebar();
        });
    }
    
    // Logout
    document.getElementById('btn-logout').addEventListener('click', (e) => {
        closeMobileSidebar();
        showLoginPage(e);
    });
    
    // NEW LOANS
    document.getElementById('loan-entry-form').addEventListener('submit', handleSaveLoan);
    document.getElementById('btn-clear-loan').addEventListener('click', clearLoanForm);
    document.getElementById('btn-delete-loan').addEventListener('click', handleDeleteLoan);
    document.getElementById('new-loans-search').addEventListener('input', renderNewLoansTable);
    document.getElementById('loan-address').addEventListener('change', handleAddressGeocode);
    const btnUseGps = document.getElementById('btn-loan-use-gps');
    if (btnUseGps) btnUseGps.addEventListener('click', handleUseCurrentLocationForLoan);
    
    // Photo change listeners
    document.getElementById('loan-photo-cust').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            processImageUpload(file, 120, 120, (base64) => {
                tempCustPhoto = base64;
                document.getElementById('cust-photo-preview').innerHTML = `<img src="${base64}" style="width: 100%; height: 100%; object-fit: cover;">`;
            });
        }
    });
    
    document.getElementById('loan-photo-house').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            processImageUpload(file, 300, 200, (base64) => {
                tempHousePhoto = base64;
                document.getElementById('house-photo-preview').innerHTML = `<img src="${base64}" style="width: 100%; height: 100%; object-fit: cover;">`;
            });
        }
    });
    
    // Navigation controls in New Loans
    document.getElementById('btn-nav-first').addEventListener('click', () => navigateLoan('first'));
    document.getElementById('btn-nav-prev').addEventListener('click', () => navigateLoan('prev'));
    document.getElementById('btn-nav-next').addEventListener('click', () => navigateLoan('next'));
    document.getElementById('btn-nav-last').addEventListener('click', () => navigateLoan('last'));
    
    // Automatically set calculated fields on Loan Entry
    document.getElementById('loan-principal').addEventListener('input', calculateLoanInstallment);
    document.getElementById('loan-interest').addEventListener('input', calculateLoanInstallment);
    document.getElementById('loan-duration').addEventListener('input', calculateLoanInstallment);
    document.getElementById('loan-paid-amount').addEventListener('input', calculateLoanInstallment);
    document.getElementById('loan-frequency').addEventListener('change', calculateLoanInstallment);
    document.getElementById('loan-from-date').addEventListener('input', calculateLoanInstallment);
    
    // DAILY POSTING
    document.getElementById('post-slno-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const slNoVal = parseBorrowerNo(e.target.value);
            const loanIdInput = document.getElementById('post-loan-id');
            
            if (slNoVal === null) {
                loanIdInput.value = '';
                handlePostingMemberSelect();
                return;
            }
            
            // Find loan matching the slNo in the active line
            const activeAreas = getActiveLineAreas();
            const matchedLoan = db.loans.find(l => l.slNo === slNoVal && activeAreas.includes(l.areaId));
            if (matchedLoan) {
                if (matchedLoan.unpaidAmount > 0) {
                    loanIdInput.value = matchedLoan.id;
                    handlePostingMemberSelect();
                    document.getElementById('post-amount').focus();
                    document.getElementById('post-amount').select();
                } else {
                    loanIdInput.value = '';
                    document.getElementById('post-member-details-card').style.display = 'none';
                    document.getElementById('postings-table-body').innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Loan account #${formatBorrowerNo(slNoVal)} is already Paid</td></tr>`;
                    document.getElementById('over-days-card').style.display = 'none';
                    document.getElementById('calendar-cells-grid').innerHTML = '';
                    e.target.select();
                }
            } else {
                loanIdInput.value = '';
                document.getElementById('post-member-details-card').style.display = 'none';
                document.getElementById('postings-table-body').innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Serial Number not found</td></tr>';
                document.getElementById('over-days-card').style.display = 'none';
                document.getElementById('calendar-cells-grid').innerHTML = '';
                e.target.select();
            }
        }
    });
    document.getElementById('post-amount').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('posting-entry-form').requestSubmit();
        }
    });
    document.getElementById('posting-entry-form').addEventListener('submit', handleSavePosting);
    document.getElementById('btn-clear-posting').addEventListener('click', clearPostingForm);
    document.getElementById('post-date').addEventListener('change', (e) => {
        renderLinesList();
        const selVal = document.getElementById('post-loan-id').value;
        if (!selVal) {
            renderDailyPostingsGrid(e.target.value);
        }
    });
    document.getElementById('post-amount').addEventListener('input', () => {
        const expected = parseFloat(document.getElementById('post-expected-amount').value) || 0;
        const actual = parseFloat(document.getElementById('post-amount').value) || 0;
        const deficit = Math.max(0, expected - actual);
        
        const deficitContainer = document.getElementById('post-deficit-container');
        const deficitAmountEl = document.getElementById('post-deficit-amount');
        
        if (deficitContainer && deficitAmountEl) {
            if (actual > 0 && deficit > 0) {
                deficitContainer.style.display = 'flex';
                deficitAmountEl.textContent = '₹' + deficit.toLocaleString('en-IN');
            } else {
                deficitContainer.style.display = 'none';
            }
        }
    });
    document.getElementById('btn-refresh-postings').addEventListener('click', () => {
        const selVal = document.getElementById('post-loan-id').value;
        if (selVal) {
            handlePostingMemberSelect();
        } else {
            renderDailyPostingsGrid();
        }
    });
    document.getElementById('btn-print-receipt-posting').addEventListener('click', handlePrintCollectionReceipt);
    const btnShareReceiptPosting = document.getElementById('btn-share-receipt-posting');
    if (btnShareReceiptPosting) {
        btnShareReceiptPosting.addEventListener('click', handleShareCollectionReceipt);
    }
    
    // Calendar Navigation
    document.getElementById('btn-cal-prev').addEventListener('click', () => navigateCalendar(-1));
    document.getElementById('btn-cal-next').addEventListener('click', () => navigateCalendar(1));
    
    // Portal Tabs
    const tabLines = document.getElementById('btn-portal-tab-lines');
    const tabAreas = document.getElementById('btn-portal-tab-areas');
    if (tabLines) tabLines.addEventListener('click', () => switchPortalTab('lines'));
    if (tabAreas) tabAreas.addEventListener('click', () => switchPortalTab('areas'));
    
    // Collection Line & Folders Event Listeners
    document.getElementById('portal-create-line-form').addEventListener('submit', handleSaveLinePortal);
    document.getElementById('btn-portal-logout').addEventListener('click', showLoginPage);
    const btnSwitchLine = document.getElementById('btn-sidebar-switch-line');
    if (btnSwitchLine) {
        btnSwitchLine.addEventListener('click', (e) => {
            closeMobileSidebar();
            handleSwitchLine(e);
        });
    }
    document.getElementById('portal-area-config-form').addEventListener('submit', handleSaveAreaPortal);
    document.getElementById('btn-portal-clear-area').addEventListener('click', () => {
        document.getElementById('portal-area-config-form').reset();
    });
    const portalAreaNameInput = document.getElementById('portal-area-name');
    if (portalAreaNameInput) {
        portalAreaNameInput.addEventListener('change', () => handleAreaGeocoding('portal'));
    }
    
    // Portal lines dropdown change
    const portalLinesDropdown = document.getElementById('portal-lines-dropdown');
    if (portalLinesDropdown) {
        portalLinesDropdown.addEventListener('change', updatePortalDeleteButtonState);
    }

    // Portal lines select button (Begin Work)
    const btnPortalSelectLine = document.getElementById('btn-portal-select-line-submit');
    if (btnPortalSelectLine) {
        btnPortalSelectLine.addEventListener('click', () => {
            const val = document.getElementById('portal-lines-dropdown').value;
            if (val) {
                selectPortalLine(val);
            } else {
                showToast('Please select a collection line first.', 'error');
            }
        });
    }

    // Portal lines delete button
    const btnPortalDeleteLine = document.getElementById('btn-portal-delete-line-submit');
    if (btnPortalDeleteLine) {
        btnPortalDeleteLine.addEventListener('click', () => {
            const val = document.getElementById('portal-lines-dropdown').value;
            if (val) {
                handleDeleteLinePortal(val);
            }
        });
    }
    
    // TOTAL MEMBERS
    document.getElementById('btn-search-members').addEventListener('click', renderTotalMembers);
    document.getElementById('btn-reset-member-filters').addEventListener('click', () => {
        document.getElementById('filter-member-name').value = '';
        document.getElementById('filter-member-area').value = '';
        document.getElementById('filter-member-date').value = '';
        document.getElementById('filter-member-no').value = '';
        renderTotalMembers();
    });
    
    // Total members categories filters
    document.getElementById('btn-filter-all-members').addEventListener('click', (e) => toggleMemberCategory(e, 'all'));
    document.getElementById('btn-filter-pending-members').addEventListener('click', (e) => toggleMemberCategory(e, 'pending'));
    document.getElementById('btn-filter-over-members').addEventListener('click', (e) => toggleMemberCategory(e, 'over'));
    document.getElementById('btn-filter-completed-members').addEventListener('click', (e) => toggleMemberCategory(e, 'completed'));
    document.getElementById('btn-filter-paid-today').addEventListener('click', (e) => toggleMemberCategory(e, 'paid-today'));
    document.getElementById('btn-filter-unpaid-today').addEventListener('click', (e) => toggleMemberCategory(e, 'unpaid-today'));
    
    document.getElementById('btn-print-members-list').addEventListener('click', () => {
        if (activeMemberCategory === 'paid-today' || activeMemberCategory === 'unpaid-today') {
            printCompactMemberList();
        } else {
            window.print();
        }
    });
    
    // POSTING SLIPS
    document.getElementById('btn-search-slips').addEventListener('click', renderPostingSlips);
    
    // AREA MANAGEMENT
    document.getElementById('area-config-form').addEventListener('submit', handleSaveArea);
    document.getElementById('btn-clear-area').addEventListener('click', () => {
        document.getElementById('area-config-form').reset();
    });
    const areaNameInput = document.getElementById('area-name');
    if (areaNameInput) {
        areaNameInput.addEventListener('change', () => handleAreaGeocoding('main'));
    }
    
    // SETTINGS / DATABASE
    document.getElementById('owner-password-change-form').addEventListener('submit', handleOwnerPasswordChange);
    document.getElementById('collector-management-form').addEventListener('submit', handleSaveCollector);
    document.getElementById('owner-management-form').addEventListener('submit', handleSaveOwner);
    document.getElementById('btn-export-db').addEventListener('click', exportDatabase);
    document.getElementById('btn-import-db-trigger').addEventListener('click', () => {
        document.getElementById('db-import-file-input').click();
    });
    document.getElementById('db-import-file-input').addEventListener('change', importDatabase);
    document.getElementById('btn-export-mdb').addEventListener('click', exportDatabaseMDB);
    document.getElementById('btn-import-mdb-trigger').addEventListener('click', () => {
        document.getElementById('db-import-mdb-input').click();
    });
    document.getElementById('db-import-mdb-input').addEventListener('change', importDatabaseMDB);
    document.getElementById('btn-clear-db').addEventListener('click', handleWipeDatabase);
    document.getElementById('btn-load-dummies').addEventListener('click', () => {
        if (activeUser.role !== 'admin' && activeUser.role !== 'owner') {
            showToast('Forbidden. Only administrators and owners can load demo data.', 'error');
            return;
        }
        loadDummyData(true);
    });

    // WORKSPACE SETUP
    document.getElementById('workspace-setup-form').addEventListener('submit', handleWorkspaceSetupSubmit);

    // ADMIN CONSOLE
    document.getElementById('admin-owner-form').addEventListener('submit', handleRegisterOwnerAdmin);

    // EXPENSES & CASH LEDGER
    const expenseForm = document.getElementById('expense-entry-form');
    if (expenseForm) expenseForm.addEventListener('submit', handleSaveExpense);
    
    const expenseDate = document.getElementById('expense-date');
    if (expenseDate) expenseDate.addEventListener('change', renderExpensesTable);
    
    setupExpenseCategoryListener();
    
    const btnSetFloat = document.getElementById('btn-set-float');
    if (btnSetFloat) btnSetFloat.addEventListener('click', handleSetOpeningFloat);

    // TRIAL BALANCE LISTENERS
    const tbTxnForm = document.getElementById('tb-transaction-form');
    if (tbTxnForm) tbTxnForm.addEventListener('submit', handleSaveTransaction);

    const btnPrintTB = document.getElementById('btn-print-trial-balance');
    if (btnPrintTB) btnPrintTB.addEventListener('click', printTrialBalance);

    // ====================================================
    // LANGUAGE & TRANSLATION SETTING LISTENERS
    // ====================================================
    const sysLang = localStorage.getItem('systemLanguage') || 'en';
    const inputLang = localStorage.getItem('inputLanguage') || 'en';
    const translitEnabled = localStorage.getItem('translitEnabled') !== 'false';

    const hSelect = document.getElementById('header-lang-select');
    const sSelect = document.getElementById('settings-system-lang-select');
    const iSelect = document.getElementById('settings-input-lang-select');
    const tCheck = document.getElementById('settings-translit-enabled');

    if (hSelect) hSelect.value = sysLang;
    if (sSelect) sSelect.value = sysLang;
    if (iSelect) iSelect.value = inputLang;
    if (tCheck) tCheck.checked = translitEnabled;

    if (hSelect) {
        hSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            localStorage.setItem('systemLanguage', val);
            if (sSelect) sSelect.value = val;
            applyTranslations();
            renderTotalMembers();
        });
    }

    if (sSelect) {
        sSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            localStorage.setItem('systemLanguage', val);
            if (hSelect) hSelect.value = val;
            applyTranslations();
            renderTotalMembers();
        });
    }

    if (iSelect) {
        iSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            localStorage.setItem('inputLanguage', val);
            applyTranslations();
        });
    }

    if (tCheck) {
        tCheck.addEventListener('change', (e) => {
            localStorage.setItem('translitEnabled', e.target.checked ? 'true' : 'false');
        });
    }

    // Bottom Navigation click handler
    document.querySelectorAll('.bottom-nav-link[data-view]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = link.getAttribute('data-view');
            switchView(targetView);
            closeMobileSidebar();
        });
    });

    // Mobile Drawer More Button Toggle
    const btnMobileMore = document.getElementById('btn-mobile-more');
    if (btnMobileMore) {
        btnMobileMore.addEventListener('click', () => {
            if (sidebar) {
                sidebar.classList.toggle('mobile-open');
                if (overlay) overlay.classList.toggle('active');
            }
        });
    }

    // Dashboard Action Cards click handler
    document.querySelectorAll('.action-card[data-view]').forEach(card => {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = card.getAttribute('data-view');
            switchView(targetView);
        });
    });

    // Advanced Stats Expand/Collapse Toggle
    const toggleStatsBtn = document.getElementById('btn-toggle-advanced-stats');
    const advancedStatsContainer = document.getElementById('advanced-stats-container');
    const toggleStatsIcon = document.getElementById('toggle-stats-icon');
    const toggleStatsText = document.getElementById('toggle-stats-text');

    if (toggleStatsBtn && advancedStatsContainer) {
        toggleStatsBtn.addEventListener('click', () => {
            const isHidden = advancedStatsContainer.style.display === 'none';
            if (isHidden) {
                advancedStatsContainer.style.display = '';
                if (toggleStatsIcon) toggleStatsIcon.className = 'fa-solid fa-eye-slash';
                if (toggleStatsText) toggleStatsText.textContent = 'Hide Details';
            } else {
                advancedStatsContainer.style.display = 'none';
                if (toggleStatsIcon) toggleStatsIcon.className = 'fa-solid fa-eye';
                if (toggleStatsText) toggleStatsText.textContent = 'Show Details';
            }
        });
    }

    // Run translations
    applyTranslations();
}

// Update System time tag
function updateSystemTime() {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const formatted = `${dd}-${mm}-${yyyy}`;
    document.getElementById('current-system-time').textContent = formatted;
}

// Authentication Logic
async function handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('login-username').value.trim().toLowerCase();
    const pass = document.getElementById('login-password').value;
    const role = document.getElementById('login-role').value;
    
    // Purge any existing in-memory tenant state before authenticating new user
    resetClientDatabase();

    try {
        const res = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username: user, password: pass, role })
        });
        
        sessionStorage.setItem('tsfs_jwt', res.token);
        activeUser = res.user;
        sessionStorage.setItem('tsfs_session', JSON.stringify(activeUser));
        
        showToast(`Authentication Successful! Welcome ${res.user.name}.`, 'success');
        await showMainApp();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Dropdowns populator helper
function populateAreaDropdowns() {
    const loanAreaSelect = document.getElementById('loan-area');
    const memberAreaSelect = document.getElementById('filter-member-area');
    const slipAreaSelect = document.getElementById('slip-filter-area');
    const newLineAreaSelect = document.getElementById('portal-new-line-area');
    
    // Save current values
    const val1 = loanAreaSelect.value;
    const val2 = memberAreaSelect.value;
    const val3 = slipAreaSelect.value;
    const val4 = newLineAreaSelect ? newLineAreaSelect.value : '';
    
    // Reset HTML
    loanAreaSelect.innerHTML = '<option value="">-- Select Village/Area --</option>';
    memberAreaSelect.innerHTML = '<option value="">All Areas</option>';
    slipAreaSelect.innerHTML = '<option value="">All Areas</option>';
    if (newLineAreaSelect) {
        newLineAreaSelect.innerHTML = '<option value="">-- Area --</option>';
    }
    
    const activeAreas = getActiveLineAreas();
    
    db.areas.forEach(area => {
        if (newLineAreaSelect) {
            newLineAreaSelect.innerHTML += `<option value="${area.id}">${area.name}</option>`;
        }
        
        if (activeAreas.includes(area.id)) {
            const option = `<option value="${area.id}">${area.name}</option>`;
            loanAreaSelect.innerHTML += option;
            memberAreaSelect.innerHTML += option;
            slipAreaSelect.innerHTML += option;
        }
    });
    
    // Restore values
    loanAreaSelect.value = val1;
    memberAreaSelect.value = val2;
    slipAreaSelect.value = val3;
    if (newLineAreaSelect) {
        newLineAreaSelect.value = val4;
    }
}

// Form logic helpers
function calculateLoanInstallment() {
    const principal = parseFloat(document.getElementById('loan-principal').value) || 0;
    const interest = parseFloat(document.getElementById('loan-interest').value) || 0;
    const duration = parseInt(document.getElementById('loan-duration').value) || 0;
    const frequency = document.getElementById('loan-frequency').value;
    const fromDateVal = document.getElementById('loan-from-date').value;
    
    // 1. Update Duration & Installment Labels & Placeholders
    const durationLabel = document.querySelector('label[for="loan-duration"]');
    const durationInput = document.getElementById('loan-duration');
    const instLabel = document.querySelector('label[for="loan-inst-amount"]');
    
    if (durationLabel && durationInput) {
        if (frequency === 'Days') {
            durationLabel.innerHTML = 'Duration (Days)';
            durationInput.placeholder = 'e.g. 100';
            if (instLabel) instLabel.innerHTML = 'Daily Installment Amount (₹)';
        } else if (frequency === 'Weeks') {
            durationLabel.innerHTML = 'Duration (Weeks)';
            durationInput.placeholder = 'e.g. 20';
            if (instLabel) instLabel.innerHTML = 'Weekly Installment Amount (₹)';
        } else if (frequency === 'Months') {
            durationLabel.innerHTML = 'Duration (Months)';
            durationInput.placeholder = 'e.g. 12';
            if (instLabel) instLabel.innerHTML = 'Monthly Installment Amount (₹)';
        }
    }
    
    // 2. Calculate Total Loan Amount
    const totalLoan = principal + interest;
    document.getElementById('loan-amount').value = totalLoan;
    
    // 3. Calculate Installment Amount (Principal + Interest divided by Duration)
    const instAmt = duration > 0 ? parseFloat((totalLoan / duration).toFixed(2)) : 0;
    document.getElementById('loan-inst-amount').value = instAmt;
    
    // 4. Calculate To Date automatically
    if (fromDateVal && duration > 0) {
        const fromDateObj = new Date(fromDateVal);
        let toDateObj = new Date(fromDateObj);
        
        if (frequency === 'Days') {
            toDateObj.setDate(fromDateObj.getDate() + duration);
        } else if (frequency === 'Weeks') {
            toDateObj.setDate(fromDateObj.getDate() + (duration * 7));
        } else if (frequency === 'Months') {
            toDateObj.setMonth(fromDateObj.getMonth() + duration);
        }
        
        // Format as YYYY-MM-DD
        const yyyy = toDateObj.getFullYear();
        const mm = String(toDateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(toDateObj.getDate()).padStart(2, '0');
        document.getElementById('loan-to-date').value = `${yyyy}-${mm}-${dd}`;
    }
    
    // 5. Update unpaid amount
    const paidAmt = parseFloat(document.getElementById('loan-paid-amount').value) || 0;
    document.getElementById('loan-unpaid-amount').value = Math.max(0, totalLoan - paidAmt);
}

// ----------------------------------------------------
// 1. DASHBOARD CONTROLLER
// ----------------------------------------------------
function renderDashboard() {
    // Calculations
    const activeAreas = getActiveLineAreas();
    const lineLoans = db.loans.filter(l => activeAreas.includes(l.areaId));
    const lineLoanIds = lineLoans.map(l => l.id);
    const lineCollections = db.collections.filter(c => lineLoanIds.includes(c.loanId));

    // Aggregate stats only for running/active loans (unpaidAmount > 0)
    const runningLoans = lineLoans.filter(l => (parseFloat(l.unpaidAmount) || 0) > 0);

    const totalLoans = runningLoans.reduce((acc, curr) => acc + (parseFloat(curr.loanAmount) || 0), 0);
    const totalPaid = runningLoans.reduce((acc, curr) => acc + (parseFloat(curr.paidAmount) || 0), 0);
    const totalUnpaid = runningLoans.reduce((acc, curr) => acc + (parseFloat(curr.unpaidAmount) || 0), 0);
    
    document.getElementById('dash-total-loans').textContent = '₹' + totalLoans.toLocaleString('en-IN');
    document.getElementById('dash-total-paid').textContent = '₹' + totalPaid.toLocaleString('en-IN');
    document.getElementById('dash-total-unpaid').textContent = '₹' + totalUnpaid.toLocaleString('en-IN');
    const activeUniqueMembersCount = new Set(runningLoans.map(l => (l.name || '').trim().toLowerCase()).filter(Boolean)).size;
    document.getElementById('dash-total-members').textContent = activeUniqueMembersCount;

    const todayStr = new Date().toISOString().substring(0, 10);
    
    // Calculate Today's Business Metrics (loans created today)
    const todayLoans = lineLoans.filter(l => l.createdAt && l.createdAt.substring(0, 10) === todayStr);
    const todayMembers = todayLoans.length;
    const todayAmount = todayLoans.reduce((acc, curr) => {
        const principal = curr.principalAmount !== undefined ? (parseFloat(curr.principalAmount) || 0) : (parseFloat(curr.loanAmount) || 0);
        return acc + principal;
    }, 0);
    const todayInterest = todayLoans.reduce((acc, curr) => acc + (parseFloat(curr.interestAmount) || 0), 0);

    const todayMembersEl = document.getElementById('dash-today-members');
    const todayAmountEl = document.getElementById('dash-today-amount');
    const todayInterestEl = document.getElementById('dash-today-interest');

    if (todayMembersEl) todayMembersEl.textContent = todayMembers.toLocaleString('en-IN');
    if (todayAmountEl) todayAmountEl.textContent = '₹' + todayAmount.toLocaleString('en-IN');
    if (todayInterestEl) todayInterestEl.textContent = '₹' + todayInterest.toLocaleString('en-IN');

    // Today's Cash Ledger Calculations
    const floatRow = db.dailyFloats.find(f => f.line_no === activeLineId && f.date === todayStr);
    const openingFloat = floatRow ? (parseFloat(floatRow.amount) || 0) : 0;
    const todayCollections = lineCollections.filter(c => c.date === todayStr);
    const totalCollectionsToday = todayCollections.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    const todayExpenses = db.expenses.filter(e => e.line_no === activeLineId && e.date === todayStr);
    const totalExpensesToday = todayExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    const netCashInHand = openingFloat + totalCollectionsToday - totalExpensesToday - todayAmount;

    const floatEl = document.getElementById('dash-cash-float');
    const collectionsEl = document.getElementById('dash-cash-collections');
    const expensesEl = document.getElementById('dash-cash-expenses');
    const loansEl = document.getElementById('dash-cash-loans');
    const cashInHandEl = document.getElementById('dash-cash-in-hand');
    const btnSetFloatEl = document.getElementById('btn-set-float');

    if (floatEl) floatEl.textContent = '₹' + openingFloat.toLocaleString('en-IN');
    if (collectionsEl) collectionsEl.textContent = '₹' + totalCollectionsToday.toLocaleString('en-IN');
    if (expensesEl) expensesEl.textContent = '₹' + totalExpensesToday.toLocaleString('en-IN');
    if (loansEl) loansEl.textContent = '₹' + todayAmount.toLocaleString('en-IN');
    if (cashInHandEl) cashInHandEl.textContent = '₹' + netCashInHand.toLocaleString('en-IN');

    if (btnSetFloatEl) {
        if (activeUser.role === 'owner' || activeUser.role === 'admin') {
            btnSetFloatEl.style.display = 'block';
        } else {
            btnSetFloatEl.style.display = 'none';
        }
    }

    // Render Deficit Alerts for Owner / Admin
    const todayDeficits = lineCollections.filter(c => c.date === todayStr && c.deficit > 0);
    const alertContainer = document.getElementById('dash-deficit-alert-container');
    if (alertContainer) {
        if (todayDeficits.length > 0 && (activeUser.role === 'owner' || activeUser.role === 'admin')) {
            alertContainer.style.display = 'block';
            alertContainer.innerHTML = `
                <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 12px; margin-bottom: 24px; display: flex; align-items: center; gap: 12px; color: #fecaca; font-size: 13px;">
                    <i class="fa-solid fa-circle-exclamation" style="color: var(--color-danger); font-size: 16px;"></i>
                    <div style="flex-grow: 1;">
                        <strong>Deficit Alert:</strong> ${todayDeficits.length} collection(s) recorded today with unpaid deficit!
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="switchView('posting-slips')" style="padding: 4px 8px; font-size: 11px;">View Slips</button>
                </div>
            `;
        } else {
            alertContainer.style.display = 'none';
        }
    }
    
    // Recent collections list (Last 10 collections)
    const recentBody = document.getElementById('dash-recent-collections');
    const sortedColls = [...lineCollections].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
    
    if (sortedColls.length === 0) {
        recentBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No collections recorded yet</td></tr>';
    } else {
        recentBody.innerHTML = '';
        sortedColls.forEach(c => {
            const loan = lineLoans.find(l => l.id === c.loanId);
            const borrowerName = loan ? loan.name : 'Unknown';
            const locIcon = c.verifiedLocation 
                ? '<i class="fa-solid fa-location-dot" style="color:var(--color-success);" title="GPS Verified On-site"></i> Verified' 
                : '<i class="fa-solid fa-triangle-exclamation" style="color:var(--color-warning);" title="Off-site/Manual collection"></i> Manual';
                
            const deficitBadge = (c.deficit && c.deficit > 0)
                ? `<div style="font-size: 10px; color: var(--color-danger); font-weight: 600; margin-top: 2px;"><i class="fa-solid fa-circle-exclamation"></i> Deficit: ₹${c.deficit}</div>`
                : '';

            recentBody.innerHTML += `
                <tr>
                    <td style="font-weight: 500;">${borrowerName}</td>
                    <td style="font-weight: 600; color: var(--color-success);">
                        ₹${c.amount}
                        ${deficitBadge}
                    </td>
                    <td style="font-size: 12px; color: var(--text-muted);">${locIcon}</td>
                </tr>
            `;
        });
    }
    
    // Render Heatmap Map
    setTimeout(initDashboardMap, 100);
}

function initDashboardMap() {
    const mapContainer = document.getElementById('dashboard-collections-map');
    if (!mapContainer) return;
    
    if (!dashMap) {
        dashMap = L.map('dashboard-collections-map').setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lng], 12);
        
        // Universally whitelisted OpenStreetMap layer (converted to dark mode via CSS filter)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(dashMap);
    } else {
        // Clear old markers/circles instead of recreating map
        dashMapLayers.forEach(layer => {
            try { dashMap.removeLayer(layer); } catch(e) {}
        });
        dashMapLayers = [];
    }
    
    const activeAreas = getActiveLineAreas();
    const lineLoans = db.loans.filter(l => activeAreas.includes(l.areaId));
    const lineLoanIds = lineLoans.map(l => l.id);
    const lineCollections = db.collections.filter(c => lineLoanIds.includes(c.loanId));

    // Add Area boundaries as circles
    db.areas.forEach(area => {
        if (activeAreas.includes(area.id)) {
            const circle = L.circle([area.lat, area.lng], {
                color: 'rgba(99, 102, 241, 0.4)',
                fillColor: 'rgba(99, 102, 241, 0.08)',
                fillOpacity: 0.5,
                radius: area.radius
            }).addTo(dashMap).bindPopup(`<b>Area: ${area.name}</b><br>Radius: ${area.radius}m`);
            dashMapLayers.push(circle);
        }
    });
    
    // Add collections as dots/markers
    lineCollections.forEach(coll => {
        if (coll.lat && coll.lng) {
            const loan = lineLoans.find(l => l.id === coll.loanId);
            const name = loan ? loan.name : 'Unknown';
            const color = coll.verifiedLocation ? 'var(--color-success)' : 'var(--color-warning)';
            
            const marker = L.circleMarker([coll.lat, coll.lng], {
                radius: 6,
                fillColor: color,
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(dashMap).bindPopup(`
                <b>Collection for: ${name}</b><br>
                Amount: ₹${coll.amount}<br>
                Date: ${formatDisplayDate(coll.date)}<br>
                Verification: ${coll.verifiedLocation ? 'Verified On-site' : 'Manual Tag'}
            `);
            dashMapLayers.push(marker);
        }
    });

    // Solve grey box/display issues by forcing reflow computation
    setTimeout(() => {
        if (dashMap) dashMap.invalidateSize();
    }, 100);
}

// ----------------------------------------------------
// 2. NEW LOANS CONTROLLER
// ----------------------------------------------------
function renderNewLoans() {
    clearLoanForm();
    renderNewLoansTable();
    setTimeout(initLoanEntryMap, 100);
}

function renderNewLoansTable() {
    const tableBody = document.getElementById('new-loans-table-body');
    const searchQuery = document.getElementById('new-loans-search').value.toLowerCase();
    
    const activeAreas = getActiveLineAreas();
    let filteredLoans = db.loans.filter(l => activeAreas.includes(l.areaId));
    
    if (searchQuery) {
        const parsedQueryNo = parseBorrowerNo(searchQuery);
        filteredLoans = filteredLoans.filter(l => 
            l.name.toLowerCase().includes(searchQuery) || 
            l.address.toLowerCase().includes(searchQuery) ||
            formatBorrowerNo(l.slNo).toLowerCase().includes(searchQuery) ||
            (parsedQueryNo !== null && l.slNo === parsedQueryNo)
        );
    }
    
    // Show in sequential order (ascending slNo)
    const displayList = [...filteredLoans].sort((a,b) => a.slNo - b.slNo);
    
    if (displayList.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No loans found</td></tr>';
    } else {
        tableBody.innerHTML = '';
        displayList.forEach(l => {
            const area = db.areas.find(a => a.id === l.areaId);
            const areaName = area ? area.name : 'Unassigned';
            
            const actionCell = (activeUser.role === 'owner' || activeUser.role === 'admin')
                ? `<td>
                        <button class="btn btn-secondary btn-icon-only" style="width:30px; height:30px; font-size:12px; border-radius:6px;" onclick="loadLoanIntoForm('${l.id}')">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                    </td>`
                : '';
                
            tableBody.innerHTML += `
                <tr>
                    <td style="font-weight:600;">${formatBorrowerNo(l.slNo)}</td>
                    <td>${l.name}</td>
                    <td><span class="badge badge-primary">${areaName}</span></td>
                    <td style="font-weight: 600;">₹${l.loanAmount}</td>
                    <td>${l.frequency}</td>
                    ${actionCell}
                </tr>
            `;
        });
    }
    
    // Also render recent collections on the line
    renderNewLoansRecentCollections();
}

function renderNewLoansRecentCollections() {
    const activeAreas = getActiveLineAreas();
    const lineLoans = db.loans.filter(l => activeAreas.includes(l.areaId));
    const lineLoanIds = lineLoans.map(l => l.id);
    const lineCollections = db.collections.filter(c => lineLoanIds.includes(c.loanId) && !c.deleted);

    const recentBody = document.getElementById('new-loans-recent-collections');
    if (!recentBody) return;

    const sortedColls = [...lineCollections].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
    
    if (sortedColls.length === 0) {
        recentBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px;">No collections recorded yet</td></tr>';
    } else {
        recentBody.innerHTML = '';
        sortedColls.forEach(c => {
            const loan = lineLoans.find(l => l.id === c.loanId);
            const borrowerName = loan ? loan.name : 'Unknown';
            
            recentBody.innerHTML += `
                <tr>
                    <td style="font-weight: 600;">${formatBorrowerNo(loan ? loan.slNo : 0)}</td>
                    <td style="font-weight: 500;">${borrowerName}</td>
                    <td style="font-weight: 600; color: var(--color-success);">₹${c.amount}</td>
                    <td style="font-size: 12px; color: var(--text-muted);">${formatDisplayDate(c.date)}</td>
                </tr>
            `;
        });
    }
}

let loanEntryMap = null;
let loanEntryMarker = null;
let loanAreaBoundaryCircle = null;

function initLoanEntryMap() {
    const mapContainer = document.getElementById('loan-entry-map');
    if (!mapContainer) return;
    
    if (!loanEntryMap) {
        loanEntryMap = L.map('loan-entry-map').setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lng], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(loanEntryMap);
        
        loanEntryMap.on('click', (e) => {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            updateLoanMapMarker(lat, lng);
        });
    } else {
        if (loanEntryMarker) {
            try { loanEntryMap.removeLayer(loanEntryMarker); } catch(e) {}
            loanEntryMarker = null;
        }
        if (loanAreaBoundaryCircle) {
            try { loanEntryMap.removeLayer(loanAreaBoundaryCircle); } catch(e) {}
            loanAreaBoundaryCircle = null;
        }
        loanEntryMap.setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lng], 13);
    }
    
    setTimeout(() => {
        if (loanEntryMap) loanEntryMap.invalidateSize();
    }, 100);
}

function updateLoanMapMarker(lat, lng) {
    document.getElementById('loan-lat').value = lat.toFixed(6);
    document.getElementById('loan-lng').value = lng.toFixed(6);
    
    if (loanEntryMarker) {
        loanEntryMarker.setLatLng([lat, lng]);
    } else {
        loanEntryMarker = L.marker([lat, lng], {
            icon: L.icon({
                iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41]
            })
        }).addTo(loanEntryMap);
    }
    loanEntryMap.panTo([lat, lng]);
}

function handleLoanAreaChange() {
    const areaId = document.getElementById('loan-area').value;
    if (!areaId) return;
    
    const area = db.areas.find(a => a.id === areaId);
    if (!area) return;
    
    if (loanEntryMap) {
        loanEntryMap.setView([area.lat, area.lng], 14);
        
        // Update/draw area boundary circle
        if (loanAreaBoundaryCircle) {
            try { loanEntryMap.removeLayer(loanAreaBoundaryCircle); } catch(e) {}
        }
        loanAreaBoundaryCircle = L.circle([area.lat, area.lng], {
            color: 'rgba(99, 102, 241, 0.5)',
            fillColor: 'rgba(99, 102, 241, 0.1)',
            radius: area.radius
        }).addTo(loanEntryMap);
    }
}

async function handleUseCurrentLocationForLoan() {
    const btn = document.getElementById('btn-loan-use-gps');
    if (!navigator.geolocation) {
        showToast('Geolocation is not supported by your browser.', 'error');
        return;
    }
    
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Getting GPS...';
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            // 1. Update Map Marker
            updateLoanMapMarker(lat, lng);
            
            // 2. Reverse Geocode to get address details
            try {
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
                    headers: { 'Accept-Language': 'en' }
                });
                const data = await response.json();
                
                if (data && data.display_name) {
                    document.getElementById('loan-address').value = data.display_name;
                    showToast('Location and address loaded successfully!', 'success');
                } else {
                    showToast('Location loaded. Reverse geocoding failed.', 'warning');
                }
            } catch (err) {
                console.error('Reverse geocoding error:', err);
                showToast('Location loaded, but could not resolve address text.', 'warning');
            }
            
            btn.disabled = false;
            btn.innerHTML = originalText;
        },
        (error) => {
            console.error('Geolocation error:', error);
            showToast('Failed to retrieve device location: ' + error.message, 'error');
            btn.disabled = false;
            btn.innerHTML = originalText;
        },
        {
            enableHighAccuracy: true,
            timeout: 8000,
            maximumAge: 0
        }
    );
}

async function handleAddressGeocode() {
    const address = document.getElementById('loan-address').value.trim();
    if (!address) return;
    
    const areaId = document.getElementById('loan-area').value;
    let areaQuery = '';
    if (areaId) {
        const area = db.areas.find(a => a.id === areaId);
        if (area) {
            areaQuery = ` ${area.name}`;
        }
    }
    
    const query = address + areaQuery + ", Andhra Pradesh, India";
    
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`, {
            headers: {
                'Accept-Language': 'en'
            }
        });
        const data = await response.json();
        
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            updateLoanMapMarker(lat, lng);
            showToast('Address autopinned on map!', 'success');
        } else {
            // Fallback query
            const fallbackResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
            const fallbackData = await fallbackResponse.json();
            
            if (fallbackData && fallbackData.length > 0) {
                const lat = parseFloat(fallbackData[0].lat);
                const lng = parseFloat(fallbackData[0].lon);
                updateLoanMapMarker(lat, lng);
                showToast('Address autopinned on map!', 'success');
            }
        }
    } catch (err) {
        console.error('Geocoding service error:', err);
    }
}

function loadLoanIntoForm(loanId) {
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan) return;
    
    // Find index in main list for owner navigation
    currentNavIndex = db.loans.findIndex(l => l.id === loanId);
    
    document.getElementById('loan-form-action').innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit Loan Details`;
    document.getElementById('loan-sl-indicator').textContent = `Sl.No: ${formatBorrowerNo(loan.slNo)}`;
    
    document.getElementById('loan-id-field').value = loan.id;
    document.getElementById('loan-slno').value = formatBorrowerNo(loan.slNo);
    document.getElementById('loan-name').value = loan.name;
    document.getElementById('loan-phone').value = loan.phone || '';
    document.getElementById('loan-address').value = loan.address;
    document.getElementById('loan-area').value = loan.areaId;
    document.getElementById('loan-frequency').value = loan.frequency;
    document.getElementById('loan-from-date').value = loan.fromDate;
    document.getElementById('loan-to-date').value = loan.toDate;
    
    // Set Principal, Interest, Duration, and calculated fields
    document.getElementById('loan-principal').value = loan.principalAmount !== undefined ? loan.principalAmount : loan.loanAmount;
    document.getElementById('loan-interest').value = loan.interestAmount !== undefined ? loan.interestAmount : 0;
    document.getElementById('loan-duration').value = loan.durationDays !== undefined ? loan.durationDays : 100;
    
    document.getElementById('loan-amount').value = loan.loanAmount;
    document.getElementById('loan-inst-amount').value = loan.installmentAmount;
    document.getElementById('loan-paid-amount').value = loan.paidAmount;
    document.getElementById('loan-unpaid-amount').value = loan.unpaidAmount;
    document.getElementById('loan-lat').value = loan.latitude !== undefined && loan.latitude !== null ? loan.latitude : '';
    document.getElementById('loan-lng').value = loan.longitude !== undefined && loan.longitude !== null ? loan.longitude : '';
    
    // Load images
    tempCustPhoto = loan.customerPhoto || '';
    tempHousePhoto = loan.housePhoto || '';
    
    const custPreview = document.getElementById('cust-photo-preview');
    if (tempCustPhoto) {
        custPreview.innerHTML = `<img src="${tempCustPhoto}" style="width: 100%; height: 100%; object-fit: cover;">`;
        document.getElementById('loan-photo-cust').removeAttribute('required');
    } else {
        custPreview.innerHTML = `<i class="fa-solid fa-user" style="color: var(--text-muted);"></i>`;
        document.getElementById('loan-photo-cust').setAttribute('required', 'true');
    }
    
    const housePreview = document.getElementById('house-photo-preview');
    if (tempHousePhoto) {
        housePreview.innerHTML = `<img src="${tempHousePhoto}" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else {
        housePreview.innerHTML = `<i class="fa-solid fa-house" style="color: var(--text-muted);"></i>`;
    }
    
    if (activeUser.role === 'admin') {
        document.getElementById('btn-delete-loan').style.display = 'block';
    }
    
    if (loan.latitude !== undefined && loan.latitude !== null && loan.longitude !== undefined && loan.longitude !== null) {
        setTimeout(() => {
            updateLoanMapMarker(loan.latitude, loan.longitude);
        }, 150);
    } else {
        if (loanEntryMarker && loanEntryMap) {
            try { loanEntryMap.removeLayer(loanEntryMarker); } catch(e) {}
            loanEntryMarker = null;
        }
    }
    setTimeout(handleLoanAreaChange, 120);
    
    calculateLoanInstallment();
}

function clearLoanForm() {
    document.getElementById('loan-form-action').innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Create Loan Account`;
    document.getElementById('loan-sl-indicator').textContent = `Sl.No: Auto`;
    
    document.getElementById('loan-entry-form').reset();
    
    // Set default date to today
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById('loan-from-date').value = `${yyyy}-${mm}-${dd}`;
    
    document.getElementById('loan-id-field').value = '';
    document.getElementById('loan-slno').value = '';
    document.getElementById('loan-principal').value = '';
    document.getElementById('loan-interest').value = '';
    document.getElementById('loan-duration').value = '';
    document.getElementById('loan-amount').value = '';
    document.getElementById('loan-inst-amount').value = '';
    document.getElementById('loan-paid-amount').value = 0;
    document.getElementById('loan-unpaid-amount').value = 0;
    document.getElementById('loan-lat').value = '';
    document.getElementById('loan-lng').value = '';
    document.getElementById('btn-delete-loan').style.display = 'none';
    
    // Clear images state and previews
    tempCustPhoto = '';
    tempHousePhoto = '';
    document.getElementById('cust-photo-preview').innerHTML = `<i class="fa-solid fa-user" style="color: var(--text-muted);"></i>`;
    document.getElementById('house-photo-preview').innerHTML = `<i class="fa-solid fa-house" style="color: var(--text-muted);"></i>`;
    document.getElementById('loan-photo-cust').setAttribute('required', 'true');
    
    if (loanEntryMarker && loanEntryMap) {
        try { loanEntryMap.removeLayer(loanEntryMarker); } catch(e) {}
        loanEntryMarker = null;
    }
    if (loanAreaBoundaryCircle && loanEntryMap) {
        try { loanEntryMap.removeLayer(loanAreaBoundaryCircle); } catch(e) {}
        loanAreaBoundaryCircle = null;
    }
    
    currentNavIndex = -1;
    calculateLoanInstallment();
}

async function handleSaveLoan(e) {
    e.preventDefault();
    
    const id = document.getElementById('loan-id-field').value;
    const name = document.getElementById('loan-name').value.trim();
    const address = document.getElementById('loan-address').value.trim();
    const areaId = document.getElementById('loan-area').value;
    const frequency = document.getElementById('loan-frequency').value;
    const fromDate = document.getElementById('loan-from-date').value;
    const toDate = document.getElementById('loan-to-date').value;
    const loanAmount = parseFloat(document.getElementById('loan-amount').value) || 0;
    const installmentAmount = parseFloat(document.getElementById('loan-inst-amount').value) || 0;
    const principalAmount = parseFloat(document.getElementById('loan-principal').value) || 0;
    const interestAmount = parseFloat(document.getElementById('loan-interest').value) || 0;
    const durationDays = parseInt(document.getElementById('loan-duration').value) || 0;
    
    // Customer Photo is mandatory validation
    if (!tempCustPhoto) {
        showToast('Customer Photo is mandatory for registering a new loan!', 'error');
        return;
    }
    
    // Validate opening float
    if (!id) {
        const lineMapping = db.lines.find(l => l.area_id === areaId);
        const targetLineId = lineMapping ? lineMapping.line_no : activeLineId;
        
        if (targetLineId) {
            const todayStr = new Date().toISOString().substring(0, 10);
            
            // 1. Opening float
            const floatRow = db.dailyFloats.find(f => f.line_no === targetLineId && f.date === todayStr);
            const openingFloat = floatRow ? (parseFloat(floatRow.amount) || 0) : 0;
            
            if (openingFloat <= 0) {
                showToast(`Cannot register a new loan: You have no opening float set for today on Line "${targetLineId}"! Please set an opening float first.`, 'error');
                return;
            }
        } else {
            showToast('Cannot register a new loan: Selected area is not mapped to any active collection line!', 'error');
            return;
        }
    }
    
    // Dates logic check
    if (new Date(fromDate) > new Date(toDate)) {
        showToast('From Date cannot be after To Date!', 'error');
        return;
    }
    const phone = document.getElementById('loan-phone') ? document.getElementById('loan-phone').value.trim() : '';
    
    try {
        const payload = {
            id, name, address, areaId, frequency, fromDate, toDate,
            loanAmount, installmentAmount, principalAmount, interestAmount, durationDays,
            customerPhoto: tempCustPhoto, housePhoto: tempHousePhoto,
            latitude: parseFloat(document.getElementById('loan-lat').value) || null,
            longitude: parseFloat(document.getElementById('loan-lng').value) || null,
            phone
        };
        const res = await apiFetch('/api/tenant/loans', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        showToast(res.message, 'success');
        
        await refreshLocalData();
        clearLoanForm();
        renderNewLoansTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleDeleteLoan() {
    if (activeUser.role !== 'admin') {
        showToast('Forbidden. Only administrators can delete loan records.', 'error');
        return;
    }
    
    const id = document.getElementById('loan-id-field').value;
    if (!id) return;
    
    showConfirmModal(
        'Delete Loan Account',
        'Are you absolutely sure you want to delete this loan account and all its collections history? This action cannot be undone.',
        async () => {
            try {
                const res = await apiFetch(`/api/tenant/loans/${id}`, {
                    method: 'DELETE'
                });
                showToast(res.message, 'success');
                
                await refreshLocalData();
                clearLoanForm();
                renderNewLoansTable();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

function navigateLoan(direction) {
    if (activeUser.role !== 'owner' && activeUser.role !== 'admin') return;
    
    const activeAreas = getActiveLineAreas();
    const lineLoans = db.loans.filter(l => activeAreas.includes(l.areaId));
    if (lineLoans.length === 0) return;
    
    // Sort loans by serial number to navigate logically
    const sorted = [...lineLoans].sort((a,b) => a.slNo - b.slNo);
    
    // Find current index in sorted list
    const currentId = document.getElementById('loan-id-field').value;
    if (currentId) {
        currentNavIndex = sorted.findIndex(l => l.id === currentId);
    }
    
    if (direction === 'first') {
        currentNavIndex = 0;
    } else if (direction === 'last') {
        currentNavIndex = sorted.length - 1;
    } else if (direction === 'prev') {
        currentNavIndex = Math.max(0, currentNavIndex - 1);
    } else if (direction === 'next') {
        currentNavIndex = Math.min(sorted.length - 1, currentNavIndex + 1);
    }
    
    if (currentNavIndex !== -1 && sorted[currentNavIndex]) {
        loadLoanIntoForm(sorted[currentNavIndex].id);
    }
}

// ----------------------------------------------------
// 3. DAILY POSTING CONTROLLER (Interactive Calendar & Verification)
// ----------------------------------------------------
let activeGPSCoords = null;

function renderDailyPosting() {
    if (!activeLineId && activeUser && activeUser.role !== 'owner' && activeUser.role !== 'admin') {
        showLinePortal();
        return;
    }
    
    const postDateInput = document.getElementById('post-date');
    if (postDateInput) {
        const todayStr = new Date().toISOString().substring(0, 10);
        if (!postDateInput.value || postDateInput.value === todayStr) {
            const hasTodayCollections = db.collections.some(c => c.date === todayStr && !c.deleted);
            if (!hasTodayCollections && db.collections.length > 0) {
                const latestDate = getLatestCollectionDate();
                if (latestDate) {
                    postDateInput.value = latestDate;
                }
            }
        }
    }

    const loanId = document.getElementById('post-loan-id').value;
    if (!loanId) {
        clearPostingForm();
    }
    
    renderLinesList();
    
    // Set default expense date to today
    const expDateInput = document.getElementById('expense-date');
    if (expDateInput && !expDateInput.value) {
        expDateInput.value = new Date().toISOString().substring(0, 10);
    }
    renderExpensesTable();
    
    // Start fetching GPS coordinates in background for collector tagging
    requestGPSCoordinates();
}

function requestGPSCoordinates() {
    const geoText = document.getElementById('geo-text');
    const geoIcon = document.getElementById('geo-icon');
    
    geoText.textContent = "Acquiring field coordinates...";
    geoIcon.className = "fa-solid fa-spinner fa-spin";
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                activeGPSCoords = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                geoText.innerHTML = `GPS Lock: <span style="color:var(--color-success); font-weight:600;">Active</span> (${activeGPSCoords.lat.toFixed(4)}, ${activeGPSCoords.lng.toFixed(4)})`;
                geoIcon.className = "fa-solid fa-circle-check";
                geoIcon.style.color = "var(--color-success)";
            },
            (error) => {
                console.warn('Geolocation failed or denied. Standard simulation active.', error);
                // Fallback to simulation to ensure maps work in all environments
                simulateGPSCoordinates();
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    } else {
        simulateGPSCoordinates();
    }
}

function simulateGPSCoordinates() {
    const geoText = document.getElementById('geo-text');
    const geoIcon = document.getElementById('geo-icon');
    
    // Generate minor variance near default coords
    const lat = DEFAULT_COORDS.lat + (Math.random() - 0.5) * 0.01;
    const lng = DEFAULT_COORDS.lng + (Math.random() - 0.5) * 0.01;
    
    activeGPSCoords = { lat, lng };
    geoText.innerHTML = `GPS Simulation: <span style="color:var(--color-warning); font-weight:600;">Acquired</span> (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    geoIcon.className = "fa-solid fa-triangle-exclamation";
    geoIcon.style.color = "var(--color-warning)";
}

function handlePostingMemberSelect() {
    const loanId = document.getElementById('post-loan-id').value;
    const detailsCard = document.getElementById('post-member-details-card');
    
    if (!loanId) {
        detailsCard.style.display = 'none';
        document.getElementById('post-slno-search').value = '';
        clearPostingForm();
        return;
    }
    
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan) return;
    
    // Sync Sl.No search input box
    document.getElementById('post-slno-search').value = formatBorrowerNo(loan.slNo);
    
    // Fill member stats card
    detailsCard.style.display = 'block';
    document.getElementById('post-detail-name').textContent = loan.name;
    
    const detailPhoto = document.getElementById('post-detail-photo');
    if (loan.customerPhoto) {
        detailPhoto.innerHTML = `<img src="${loan.customerPhoto}" style="width: 100%; height: 100%; object-fit: cover;" onclick="showHouseModal('${loan.customerPhoto}')">`;
        detailPhoto.style.cursor = 'pointer';
        detailPhoto.title = "Click to enlarge Customer Photo";
    } else {
        detailPhoto.innerHTML = `<i class="fa-solid fa-user" style="color: var(--text-muted);"></i>`;
        detailPhoto.style.cursor = 'default';
        detailPhoto.title = "No Customer Photo uploaded";
    }
    
    const detailHouse = document.getElementById('post-detail-house');
    if (loan.housePhoto) {
        detailHouse.innerHTML = `<img src="${loan.housePhoto}" style="width: 100%; height: 100%; object-fit: cover;" onclick="showHouseModal('${loan.housePhoto}')">`;
        detailHouse.style.cursor = 'pointer';
        detailHouse.title = "Click to enlarge House Photo";
    } else {
        detailHouse.innerHTML = `<i class="fa-solid fa-house" style="color: var(--text-muted); font-size: 11px;"></i>`;
        detailHouse.style.cursor = 'default';
        detailHouse.title = "No House Photo uploaded";
    }
    
    const area = db.areas.find(a => a.id === loan.areaId);
    document.getElementById('post-detail-area').textContent = area ? area.name : 'Unknown';
    document.getElementById('post-detail-loan').textContent = '₹' + loan.loanAmount;
    document.getElementById('post-detail-paid').textContent = '₹' + loan.paidAmount;
    document.getElementById('post-detail-unpaid').textContent = '₹' + loan.unpaidAmount;
    
    const totalDeficit = db.collections.filter(c => c.loanId === loan.id).reduce((sum, c) => sum + (c.deficit || 0), 0);
    document.getElementById('post-detail-remainder').textContent = '₹' + totalDeficit;
    
    document.getElementById('post-detail-inst').textContent = '₹' + loan.installmentAmount;
    document.getElementById('post-detail-freq').textContent = loan.frequency;
    document.getElementById('post-detail-from-date').textContent = formatDisplayDate(loan.fromDate);
    document.getElementById('post-detail-to-date').textContent = formatDisplayDate(loan.toDate);
    
    // Setup inputs
    document.getElementById('post-expected-amount').value = loan.installmentAmount;
    document.getElementById('post-amount').value = ''; // Start empty so they write actual paid amount
    
    // Display initial deficit of the full installment amount when empty
    const deficitContainer = document.getElementById('post-deficit-container');
    const deficitAmountEl = document.getElementById('post-deficit-amount');
    if (deficitContainer) deficitContainer.style.display = 'none';
    if (deficitAmountEl) deficitAmountEl.textContent = '₹' + loan.installmentAmount;
    
    // Sync Calendar Focus Month
    const targetDate = new Date(loan.fromDate);
    currentCalDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    
    // Refresh table and calendar
    renderPostingsGrid(loanId);
    renderCalendar(loan);
    renderLinesList();
}

function renderPostingsGrid(loanId) {
    const dateHeader = document.getElementById('posting-grid-date-header');
    if (dateHeader) dateHeader.textContent = "Date";
    
    const tableBody = document.getElementById('postings-table-body');
    const collections = db.collections.filter(c => c.loanId === loanId).sort((a,b) => b.slNo - a.slNo);
    
    const loan = db.loans.find(l => l.id === loanId);
    const customerSlNo = loan ? formatBorrowerNo(loan.slNo) : '';
    
    if (collections.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No postings recorded yet</td></tr>';
    } else {
        tableBody.innerHTML = '';
        collections.forEach(c => {
            const dateStr = formatDisplayDate(c.date);
            const expectedAmt = c.expectedAmount !== undefined ? c.expectedAmount : c.amount;
                
            const actionBtn = `
                <td>
                    <div style="display: flex; gap: 4px; align-items: center;">
                        <button class="btn btn-secondary btn-icon-only" style="width:26px; height:26px; font-size:10px; border-radius:4px;" onclick="handleDeletePosting('${c.id}')" title="Delete Posting">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                        <button class="btn btn-success btn-icon-only" style="width:26px; height:26px; font-size:10px; border-radius:4px; background: var(--color-success); border-color: var(--color-success);" onclick="sharePostingReceipt('${c.id}')" title="Share Receipt">
                            <i class="fa-brands fa-whatsapp"></i>
                        </button>
                    </div>
                </td>
            `;
            
            tableBody.innerHTML += `
                <tr>
                    <td style="font-weight:600; color: var(--text-muted);">${customerSlNo}</td>
                    <td style="font-weight:500; color: var(--text-muted);">₹${expectedAmt.toLocaleString('en-IN')}</td>
                    <td style="font-weight:700; color: var(--color-success);">₹${c.amount.toLocaleString('en-IN')}</td>
                    <td style="font-size:13px; color: var(--text-muted);">${dateStr}</td>
                    ${actionBtn}
                </tr>
            `;
        });
    }
}

function renderDailyPostingsGrid(selectedDate) {
    const tableBody = document.getElementById('postings-table-body');
    if (!tableBody) return;
    
    if (!selectedDate) {
        selectedDate = document.getElementById('post-date')?.value || getLatestCollectionDate();
    }
    
    const collections = db.collections.filter(c => c.date === selectedDate && !c.deleted);
    
    if (collections.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No postings recorded on this date</td></tr>';
    } else {
        tableBody.innerHTML = '';
        collections.forEach(c => {
            const loan = db.loans.find(l => l.id === c.loanId);
            const customerSlNo = loan ? formatBorrowerNo(loan.slNo) : 'Unknown';
            const customerName = loan ? loan.name : 'Unknown';
            const expectedAmt = c.expectedAmount !== undefined ? c.expectedAmount : c.amount;
            
            const actionBtn = (activeUser && (activeUser.role === 'owner' || activeUser.role === 'admin' || activeUser.role === 'collector'))
                ? `<td>
                    <div style="display: flex; gap: 4px; align-items: center;">
                        <button class="btn btn-secondary btn-icon-only" style="width:26px; height:26px; font-size:10px; border-radius:4px;" onclick="handleDeletePosting('${c.id}')" title="Delete Posting">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                        <button class="btn btn-success btn-icon-only" style="width:26px; height:26px; font-size:10px; border-radius:4px; background: var(--color-success); border-color: var(--color-success);" onclick="sharePostingReceipt('${c.id}')" title="Share Receipt">
                            <i class="fa-brands fa-whatsapp"></i>
                        </button>
                    </div>
                </td>`
                : '<td></td>';
                
            tableBody.innerHTML += `
                <tr>
                    <td style="font-weight:600;" title="${customerName}">${customerSlNo}</td>
                    <td style="font-weight:500; color: var(--text-muted);">₹${expectedAmt.toLocaleString('en-IN')}</td>
                    <td style="font-weight:700; color: var(--color-success);">₹${c.amount.toLocaleString('en-IN')}</td>
                    <td style="font-size:13px; color: var(--text-muted);">${customerName}</td>
                    ${actionBtn}
                </tr>
            `;
        });
    }
}

// Interactive Calendar drawing algorithm
function renderCalendar(loan) {
    const grid = document.getElementById('calendar-cells-grid');
    const title = document.getElementById('calendar-month-year');
    
    grid.innerHTML = '';
    
    // Set Header titles
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    title.textContent = `${months[currentCalDate.getMonth()]} ${currentCalDate.getFullYear()}`;
    
    // Weekday headers
    const daysHeader = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    daysHeader.forEach(d => {
        const headerEl = document.createElement('div');
        headerEl.className = 'calendar-day-header';
        headerEl.textContent = d;
        grid.appendChild(headerEl);
    });
    
    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();
    
    // First day of month
    const firstDayIndex = new Date(year, month, 1).getDay();
    // Total days in month
    const totalDays = new Date(year, month + 1, 0).getDate();
    // Total days in previous month
    const prevTotalDays = new Date(year, month, 0).getDate();
    
    // Render padding from previous month
    for (let i = firstDayIndex - 1; i >= 0; i--) {
        const dayNum = prevTotalDays - i;
        const cellEl = document.createElement('div');
        cellEl.className = 'calendar-cell muted';
        cellEl.textContent = dayNum;
        grid.appendChild(cellEl);
    }
    
    // Fetch target payment dates & historical collection dates
    const scheduleDates = getScheduledDates(loan);
    const collectionRecords = db.collections.filter(c => c.loanId === loan.id);
    
    let overdueCount = 0;
    const todayStr = new Date().toISOString().substring(0, 10);
    
    // Render current month dates
    for (let day = 1; day <= totalDays; day++) {
        const cellDate = new Date(year, month, day);
        const cellDateStr = cellDate.toISOString().substring(0, 10);
        
        let cellClass = 'calendar-cell';
        let dotHTML = '';
        
        // 1. Is this cell a target installment date?
        const isScheduled = scheduleDates.some(d => d === cellDateStr);
        
        // 2. Was a payment posted on this date?
        const hasPayment = collectionRecords.some(c => c.date === cellDateStr);
        
        if (hasPayment) {
            cellClass += ' paid';
        } else if (isScheduled) {
            // Unpaid target installment
            if (cellDateStr < todayStr) {
                // Past target date and unpaid: Overdue!
                cellClass += ' unpaid';
                overdueCount++;
            } else {
                // Future target
                dotHTML = '<span class="status-dot"></span>';
            }
        }
        
        // Today check
        if (cellDateStr === todayStr) {
            cellClass += ' today';
        }
        
        const cellEl = document.createElement('div');
        cellEl.className = cellClass;
        cellEl.innerHTML = `${day}${dotHTML}`;
        cellEl.addEventListener('click', () => {
            document.getElementById('post-date').value = cellDateStr;
            // Highlight active selection
            document.querySelectorAll('.calendar-cell').forEach(c => c.classList.remove('selected'));
            cellEl.classList.add('selected');
        });
        
        grid.appendChild(cellEl);
    }
    
    // Render padding for next month (fill up to 42 cells total)
    const totalCellsUsed = firstDayIndex + totalDays;
    const remainingCells = (totalCellsUsed <= 35) ? 35 - totalCellsUsed : 42 - totalCellsUsed;
    
    for (let day = 1; day <= remainingCells; day++) {
        const cellEl = document.createElement('div');
        cellEl.className = 'calendar-cell muted';
        cellEl.textContent = day;
        grid.appendChild(cellEl);
    }
    
    // Show Overdue alert overlay
    const overdueCard = document.getElementById('over-days-card');
    const overdueText = document.getElementById('over-days-text');
    if (overdueCount > 0 && loan.unpaidAmount > 0) {
        overdueCard.style.display = 'block';
        overdueText.textContent = `${overdueCount} overdue installments detected! (${loan.frequency} schedule)`;
    } else {
        overdueCard.style.display = 'none';
    }
}

// Compute scheduled calendar milestone dates based on loan settings
function getScheduledDates(loan) {
    const list = [];
    const start = new Date(loan.fromDate);
    const end = new Date(loan.toDate);
    
    let current = new Date(start);
    
    while (current <= end) {
        list.push(current.toISOString().substring(0, 10));
        
        // Offset by installment frequency
        if (loan.frequency === 'Days') {
            current.setDate(current.getDate() + 1);
        } else if (loan.frequency === 'Weeks') {
            current.setDate(current.getDate() + 7);
        } else if (loan.frequency === 'Months') {
            current.setMonth(current.getMonth() + 1);
        } else {
            break; // Safety breakout
        }
    }
    return list;
}

function navigateCalendar(offset) {
    const loanId = document.getElementById('post-loan-id').value;
    if (!loanId) return;
    
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan) return;
    
    currentCalDate.setMonth(currentCalDate.getMonth() + offset);
    renderCalendar(loan);
}

async function handleSavePosting(e) {
    e.preventDefault();
    
    const loanId = document.getElementById('post-loan-id').value;
    const expected = parseFloat(document.getElementById('post-expected-amount').value) || 0;
    const amount = parseFloat(document.getElementById('post-amount').value) || 0;
    const date = document.getElementById('post-date').value;
    const deficit = Math.max(0, expected - amount);
    
    if (!loanId) {
        showToast('Please select a member first!', 'error');
        return;
    }
    
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan) return;
    
    const area = db.areas.find(a => a.id === loan.areaId);
    
    // Capture and calculate coordinates geofencing validation
    let lat = null;
    let lng = null;
    let verifiedLocation = false;
    
    if (activeGPSCoords) {
        lat = activeGPSCoords.lat;
        lng = activeGPSCoords.lng;
        
        if (area && area.lat && area.lng) {
            const distance = getDistance(lat, lng, area.lat, area.lng);
            if (distance <= area.radius) {
                verifiedLocation = true;
            }
        }
    }
    
    try {
        const payload = { loanId, amount, date, lat, lng, verifiedLocation, expectedAmount: expected, deficit };
        const res = await apiFetch('/api/tenant/collections', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        showToast(res.message, 'success');
        
        // Synchronously update local cache for instant UI feedback loop
        const loanIndex = db.loans.findIndex(l => l.id === loanId);
        if (loanIndex !== -1) {
            const loan = db.loans[loanIndex];
            loan.paidAmount = (loan.paidAmount || 0) + amount;
            loan.unpaidAmount = Math.max(0, loan.loanAmount - loan.paidAmount);
            if (loan.unpaidAmount === 0) {
                loan.status = 'Paid';
            }
        }
        
        const tempColl = {
            id: 'temp-' + Date.now(),
            loanId,
            slNo: (db.collections.filter(c => c.loanId === loanId).length + 1),
            amount,
            date,
            lat,
            lng,
            verifiedLocation,
            collectorId: activeUser ? activeUser.username : '',
            expectedAmount: expected,
            deficit
        };
        db.collections.push(tempColl);

        // Reset the form and refocus immediately to prevent keyboard latency
        clearPostingForm();
        const slNoInput = document.getElementById('post-slno-search');
        if (slNoInput) {
            slNoInput.focus();
            slNoInput.select();
        }

        // Run data refresh in background (non-blocking)
        refreshLocalData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleDeletePosting(collId) {
    if (activeUser.role !== 'admin' && activeUser.role !== 'owner' && activeUser.role !== 'collector') return;
    
    const coll = db.collections.find(c => c.id === collId);
    if (!coll) return;
    
    showConfirmModal(
        'Delete Collection Slip',
        `Are you sure you want to delete collection slip #${coll.slNo} of ₹${coll.amount}? This action cannot be undone.`,
        async () => {
            try {
                const res = await apiFetch(`/api/tenant/collections/${collId}`, {
                    method: 'DELETE'
                });
                showToast(res.message, 'success');
                
                await refreshLocalData();
                handlePostingMemberSelect();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

function clearPostingForm() {
    const postDateInput = document.getElementById('post-date');
    let currentDateVal = postDateInput ? postDateInput.value : '';
    document.getElementById('posting-entry-form').reset();
    
    const todayStr = new Date().toISOString().substring(0, 10);
    if (!currentDateVal || currentDateVal === todayStr) {
        const hasTodayCollections = db.collections.some(c => c.date === todayStr && !c.deleted);
        if (!hasTodayCollections && db.collections.length > 0) {
            currentDateVal = getLatestCollectionDate();
        }
    }
    
    if (!currentDateVal) {
        currentDateVal = todayStr;
    }
    
    if (postDateInput) {
        postDateInput.value = currentDateVal;
    }
    
    const dateHeader = document.getElementById('posting-grid-date-header');
    if (dateHeader) dateHeader.textContent = "Borrower Name";
    renderDailyPostingsGrid(currentDateVal);
    document.getElementById('over-days-card').style.display = 'none';
    document.getElementById('post-member-details-card').style.display = 'none';
    document.getElementById('post-slno-search').value = '';
    document.getElementById('post-loan-id').value = '';
    document.getElementById('post-expected-amount').value = '';
    document.getElementById('post-detail-remainder').textContent = '₹0';
    document.getElementById('post-detail-from-date').textContent = '-';
    document.getElementById('post-detail-to-date').textContent = '-';
    const deficitContainer = document.getElementById('post-deficit-container');
    if (deficitContainer) deficitContainer.style.display = 'none';
    document.getElementById('calendar-cells-grid').innerHTML = '';
    activeGPSCoords = null;
    requestGPSCoordinates();
    renderLinesList();
}

// ----------------------------------------------------
// 4. TOTAL MEMBERS DIRECTORY CONTROLLER
let activeMemberCategory = 'all';

function toggleMemberCategory(e, category) {
    // Toggle active buttons style
    const btnGroup = e.target.parentElement;
    btnGroup.querySelectorAll('.btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    
    activeMemberCategory = category;
    renderTotalMembers();
}

function renderTotalMembers() {
    const tableBody = document.getElementById('members-list-table-body');
    
    // Read search inputs
    const filterName = document.getElementById('filter-member-name').value.toLowerCase();
    const filterArea = document.getElementById('filter-member-area').value;
    const filterDate = document.getElementById('filter-member-date').value;
    const filterNo = document.getElementById('filter-member-no').value;
    
    const activeAreas = getActiveLineAreas();
    let filtered = db.loans.filter(l => activeAreas.includes(l.areaId));
    
    // Apply search filters
    if (filterName) {
        filtered = filtered.filter(l => l.name.toLowerCase().includes(filterName));
    }
    if (filterArea) {
        filtered = filtered.filter(l => l.areaId === filterArea);
    }
    if (filterNo) {
        const parsed = parseBorrowerNo(filterNo);
        filtered = filtered.filter(l => l.slNo == parsed);
    }
    if (filterDate) {
        // Find loans active on reference date (fromDate <= date <= toDate)
        filtered = filtered.filter(l => l.fromDate <= filterDate && l.toDate >= filterDate);
    }
    
    // Apply categories filters
    // Apply categories filters
    const todayStr = new Date().toISOString().substring(0, 10);
    const targetDate = document.getElementById('filter-member-date').value || todayStr;
    
    if (activeMemberCategory === 'pending') {
        filtered = filtered.filter(l => l.unpaidAmount > 0 && l.toDate >= todayStr);
    } else if (activeMemberCategory === 'over') {
        filtered = filtered.filter(l => l.unpaidAmount > 0 && l.toDate < todayStr);
    } else if (activeMemberCategory === 'completed') {
        filtered = filtered.filter(l => l.unpaidAmount === 0);
    } else if (activeMemberCategory === 'paid-today') {
        filtered = filtered.filter(l => db.collections.some(c => c.loanId === l.id && c.date === targetDate));
    } else if (activeMemberCategory === 'unpaid-today') {
        filtered = filtered.filter(l => {
            const scheduled = getScheduledDates(l);
            const isScheduled = scheduled.includes(targetDate);
            const hasPaid = db.collections.some(c => c.loanId === l.id && c.date === targetDate);
            return isScheduled && !hasPaid && l.unpaidAmount > 0;
        });
    }
    
    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: var(--text-muted);">No members matching criteria</td></tr>';
    } else {
        tableBody.innerHTML = '';
        filtered.forEach(l => {
            const area = db.areas.find(a => a.id === l.areaId);
            const areaName = area ? area.name : 'Unknown';
            
            // Status determination
            let statusBadge = '<span class="badge badge-success">Done</span>';
            if (l.unpaidAmount > 0) {
                if (l.toDate < todayStr) {
                    statusBadge = '<span class="badge badge-danger">Over Days</span>';
                } else {
                    statusBadge = '<span class="badge badge-warning">Pending</span>';
                }
            }
            
            if (activeMemberCategory === 'paid-today') {
                const todayColls = db.collections.filter(c => c.loanId === l.id && c.date === targetDate);
                const paidTodayVal = todayColls.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
                statusBadge = `<span class="badge badge-success" style="background:#10b981; border:none; padding:4px 8px; border-radius:6px; font-weight:600;"><i class="fa-solid fa-check-double"></i> Paid: ₹${paidTodayVal}</span>`;
            } else if (activeMemberCategory === 'unpaid-today') {
                statusBadge = `<span class="badge badge-warning" style="background:#f59e0b; border:none; padding:4px 8px; border-radius:6px; font-weight:600;"><i class="fa-solid fa-hourglass-half"></i> Due: ₹${l.installmentAmount}</span>`;
            }
            
            const photoSrc = l.customerPhoto 
                ? `<img src="${l.customerPhoto}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; border:1px solid rgba(255,255,255,0.1); cursor:pointer;" onclick="showHouseModal('${l.customerPhoto}')" title="Click to enlarge profile photo">` 
                : `<div style="width:30px; height:30px; border-radius:50%; background:rgba(255,255,255,0.05); display:inline-flex; align-items:center; justify-content:center;"><i class="fa-solid fa-user" style="font-size:10px; color:var(--text-muted);"></i></div>`;

            tableBody.innerHTML += `
                <tr>
                    <td style="font-weight:600;">${formatBorrowerNo(l.slNo)}</td>
                    <td>${photoSrc}</td>
                    <td style="font-weight:500;">${l.name}</td>
                    <td>${areaName}</td>
                    <td>${formatDisplayDate(l.fromDate)}</td>
                    <td>${formatDisplayDate(l.toDate)}</td>
                    <td style="font-weight:600;">₹${l.loanAmount}</td>
                    <td style="color:var(--color-success); font-weight:600;">₹${l.paidAmount}</td>
                    <td style="color:var(--color-warning); font-weight:600;">₹${l.unpaidAmount}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="btn btn-secondary btn-icon-only" style="width:28px; height:28px; font-size:12px; border-radius:6px;" onclick="loadMemberIntoPosting('${l.id}')" title="Post Collection">
                            <i class="fa-solid fa-calculator"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    }
}

function loadMemberIntoPosting(loanId) {
    switchView('daily-posting');
    document.getElementById('post-loan-id').value = loanId;
    handlePostingMemberSelect();
}

// ----------------------------------------------------
// 5. POSTING SLIPS CONTROLLER
// ----------------------------------------------------
function renderPostingSlips() {
    const tableBody = document.getElementById('slips-table-body');
    
    // Read filters
    const start = document.getElementById('slip-filter-start-date').value;
    const end = document.getElementById('slip-filter-end-date').value;
    const areaId = document.getElementById('slip-filter-area').value;
    const nameSearch = document.getElementById('slip-filter-name').value.toLowerCase();
    
    const activeAreas = getActiveLineAreas();
    const lineLoans = db.loans.filter(l => activeAreas.includes(l.areaId));
    const lineLoanIds = lineLoans.map(l => l.id);
    
    let list = db.collections.filter(c => lineLoanIds.includes(c.loanId));
    
    // Filter logic
    if (start) {
        list = list.filter(c => c.date >= start);
    }
    if (end) {
        list = list.filter(c => c.date <= end);
    }
    
    // Join with loan data for filtering
    let mappedList = list.map(c => {
        const loan = db.loans.find(l => l.id === c.loanId);
        return {
            ...c,
            borrowerName: loan ? loan.name : 'Unknown',
            areaId: loan ? loan.areaId : '',
            borrowerSl: loan ? formatBorrowerNo(loan.slNo) : ''
        };
    });
    
    if (areaId) {
        mappedList = mappedList.filter(c => c.areaId === areaId);
    }
    if (nameSearch) {
        mappedList = mappedList.filter(c => c.borrowerName.toLowerCase().includes(nameSearch));
    }
    
    // Sort newest collections first
    mappedList.sort((a,b) => new Date(b.date) - new Date(a.date));
    
    if (mappedList.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No transaction slips found</td></tr>';
    } else {
        tableBody.innerHTML = '';
        mappedList.forEach(c => {
            const area = db.areas.find(a => a.id === c.areaId);
            const areaName = area ? area.name : 'Unknown';
            const statusLabel = c.verifiedLocation 
                ? '<span class="badge badge-success"><i class="fa-solid fa-location-dot"></i> On-site</span>' 
                : '<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Manual</span>';
                
            const deficitBadge = (c.deficit && c.deficit > 0)
                ? `<div style="font-size:10px; color:var(--color-danger); font-weight:600; margin-top:2px;">Deficit: ₹${c.deficit}</div>`
                : '';

            tableBody.innerHTML += `
                <tr>
                    <td style="font-weight:600;">TXN-${c.id.split('-')[1]}</td>
                    <td>${c.borrowerName} (${c.borrowerSl})</td>
                    <td>${areaName}</td>
                    <td>${formatDisplayDate(c.date)}</td>
                    <td style="font-weight:700; color:var(--color-success);">
                        ₹${c.amount}
                        ${deficitBadge}
                    </td>
                    <td>${c.collectorId}</td>
                    <td>${statusLabel}</td>
                    <td>
                        <button class="btn btn-secondary btn-icon-only" style="width:28px; height:28px; font-size:12px; border-radius:6px;" onclick="printIndividualSlip('${c.id}')" title="Print Slip">
                            <i class="fa-solid fa-print"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    }
}

function printIndividualSlip(collId) {
    const coll = db.collections.find(c => c.id === collId);
    if (!coll) return;
    
    const loan = db.loans.find(l => l.id === coll.loanId);
    if (!loan) return;
    
    const area = db.areas.find(a => a.id === loan.areaId);
    const areaName = area ? area.name : 'Unknown';
    
    const photoHTML = loan.customerPhoto 
        ? `<div style="text-align:center; margin:8px 0;"><img src="${loan.customerPhoto}" style="width:45px; height:45px; border-radius:50%; object-fit:cover; border:1px solid #000;"></div>`
        : '';
        
    // Inject thermal receipt content
    const receipt = document.getElementById('print-receipt-slip');
    receipt.innerHTML = `
        <div class="print-header">
            <h2 style="font-size:16px; margin:0;">${(activeUser.companyName || 'TERRASOL FINSERV').toUpperCase()}</h2>
            <p style="font-size:10px; margin:2px 0;">TRANS-POSTING COLLECTION SLIP</p>
            <p style="font-size:9px; margin:0;">Srikakulam District, Andhra Pradesh</p>
            ${photoHTML}
        </div>
        <hr style="border-top:1px dashed #000; margin:10px 0;">
        <table style="width:100%; font-size:11px; text-align:left;">
            <tr><td><b>Slip ID:</b></td><td style="text-align:right;">TXN-${coll.id.split('-')[1]}</td></tr>
            <tr><td><b>Serial No:</b></td><td style="text-align:right;">${formatBorrowerNo(loan.slNo)}</td></tr>
            <tr><td><b>Borrower:</b></td><td style="text-align:right;">${loan.name}</td></tr>
            <tr><td><b>Village/Area:</b></td><td style="text-align:right;">${areaName}</td></tr>
            <tr><td><b>Posting Date:</b></td><td style="text-align:right;">${formatDisplayDate(coll.date)}</td></tr>
            <tr><td><b>Collector Agent:</b></td><td style="text-align:right;">${coll.collectorId}</td></tr>
            <tr><td><b>GPS Tagging:</b></td><td style="text-align:right;">${coll.verifiedLocation ? 'VERIFIED (ON-SITE)' : 'MANUAL REGISTER'}</td></tr>
            <tr style="font-size:11px;">
                <td>Expected Installment:</td>
                <td style="text-align:right;">₹${coll.expectedAmount !== undefined ? coll.expectedAmount : coll.amount}.00</td>
            </tr>
            <tr style="font-size:11px;">
                <td>Deficit Amount:</td>
                <td style="text-align:right; color:#000;">₹${coll.deficit !== undefined ? coll.deficit : 0}.00</td>
            </tr>
            <tr style="font-size:13px; font-weight:bold;">
                <td style="padding-top:10px;">AMOUNT PAID:</td>
                <td style="text-align:right; padding-top:10px;">₹${coll.amount}.00</td>
            </tr>
        </table>
        <hr style="border-top:1px dashed #000; margin:10px 0;">
        <table style="width:100%; font-size:11px;">
            <tr><td>Total Account Loan:</td><td style="text-align:right;">₹${loan.loanAmount}</td></tr>
            <tr><td>Total Paid So Far:</td><td style="text-align:right;">₹${loan.paidAmount}</td></tr>
            <tr><td><b>Outstanding Balance:</b></td><td style="text-align:right;"><b>₹${loan.unpaidAmount}</b></td></tr>
        </table>
        <hr style="border-top:1px dashed #000; margin:10px 0;">
        <div style="text-align:center; font-size:10px; margin-top:10px;">
            <p>Thank You for your transaction!</p>
            <p style="font-size:8px; margin-top:4px;">Printed on: ${new Date().toLocaleString()}</p>
        </div>
    `;
    
    document.body.classList.add('print-receipt-mode');
    window.print();
    document.body.classList.remove('print-receipt-mode');
}

function sharePostingReceipt(collId) {
    const coll = db.collections.find(c => c.id === collId);
    if (!coll) return;
    
    const loan = db.loans.find(l => l.id === coll.loanId);
    if (!loan) return;
    
    const area = db.areas.find(a => a.id === loan.areaId);
    const areaName = area ? area.name : 'Unknown';
    
    const companyName = activeUser.companyName || 'Terrasol FinServ';
    
    // Format receipt text
    const receiptText = 
`*Receipt from ${companyName.toUpperCase()}*
------------------------------------
*Slip ID:* TXN-${coll.id.split('-')[1]}
*Serial No:* ${formatBorrowerNo(loan.slNo)}
*Borrower:* ${loan.name}
*Village/Area:* ${areaName}
*Posting Date:* ${formatDisplayDate(coll.date)}
*Expected Installment:* ₹${coll.expectedAmount !== undefined ? coll.expectedAmount : coll.amount}.00
*Amount Paid:* ₹${coll.amount}.00
*Deficit:* ₹${coll.deficit !== undefined ? coll.deficit : 0}.00
------------------------------------
*Total Loan Amount:* ₹${loan.loanAmount}
*Total Paid So Far:* ₹${loan.paidAmount}
*Outstanding Balance:* ₹${loan.unpaidAmount}
------------------------------------
Thank you for your transaction!`;

    // Try Web Share API first
    if (navigator.share) {
        navigator.share({
            title: 'Transaction Receipt',
            text: receiptText
        }).then(() => {
            showToast('Receipt shared successfully!', 'success');
        }).catch(err => {
            if (err.name !== 'AbortError') {
                fallbackWhatsAppShare(loan.phone, receiptText);
            }
        });
    } else {
        fallbackWhatsAppShare(loan.phone, receiptText);
    }
}

function fallbackWhatsAppShare(phone, text) {
    let cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    if (cleanPhone && cleanPhone.length === 10) {
        cleanPhone = '91' + cleanPhone;
    }
    const encodedText = encodeURIComponent(text);
    const waUrl = cleanPhone 
        ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`
        : `https://api.whatsapp.com/send?text=${encodedText}`;
    window.open(waUrl, '_blank');
}

function handleShareCollectionReceipt() {
    const loanId = document.getElementById('post-loan-id').value;
    if (!loanId) return;
    
    // Find latest collection for borrower
    const collections = db.collections.filter(c => c.loanId === loanId).sort((a,b) => new Date(b.date) - new Date(a.date));
    if (collections.length > 0) {
        sharePostingReceipt(collections[0].id);
    } else {
        showToast('No collections found to share receipt.', 'error');
    }
}

function printCompactMemberList() {
    const todayStr = new Date().toISOString().substring(0, 10);
    const filterDate = document.getElementById('filter-member-date').value || todayStr;
    const activeAreas = getActiveLineAreas();
    
    let filtered = db.loans.filter(l => activeAreas.includes(l.areaId));
    
    const filterName = document.getElementById('filter-member-name').value.toLowerCase();
    const filterArea = document.getElementById('filter-member-area').value;
    const filterNo = document.getElementById('filter-member-no').value;
    
    if (filterName) filtered = filtered.filter(l => l.name.toLowerCase().includes(filterName));
    if (filterArea) filtered = filtered.filter(l => l.areaId === filterArea);
    if (filterNo) {
        const parsed = parseBorrowerNo(filterNo);
        filtered = filtered.filter(l => l.slNo == parsed);
    }
    
    let listTitle = "";
    let htmlContent = "";
    
    if (activeMemberCategory === 'paid-today') {
        listTitle = "PAID LIST";
        filtered = filtered.filter(l => db.collections.some(c => c.loanId === l.id && c.date === filterDate));
        
        let totalPaidToday = 0;
        let itemsHtml = "";
        
        filtered.forEach((l, idx) => {
            const area = db.areas.find(a => a.id === l.areaId);
            const areaName = area ? area.name : 'Unknown';
            const colls = db.collections.filter(c => c.loanId === l.id && c.date === filterDate);
            const paidAmt = colls.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
            totalPaidToday += paidAmt;
            
            itemsHtml += `
                <tr>
                    <td style="font-weight:bold; padding:4px 0;">${formatBorrowerNo(l.slNo)}</td>
                    <td style="padding:4px 0;">${l.name}</td>
                    <td style="padding:4px 0;">${areaName}</td>
                    <td style="text-align:right; font-weight:bold; padding:4px 0;">₹${paidAmt}</td>
                </tr>
            `;
        });
        
        htmlContent = `
            <div class="print-header" style="text-align:center;">
                <h2 style="font-size:14px; margin:0; font-family:monospace; font-weight:bold;">${(activeUser.companyName || 'TERRASOL FINSERV').toUpperCase()}</h2>
                <p style="font-size:11px; margin:3px 0; font-family:monospace; font-weight:bold;">${listTitle}</p>
                <p style="font-size:10px; margin:0; font-family:monospace;">Date: ${formatDisplayDate(filterDate)} | Line: ${activeLineId || 'All'}</p>
            </div>
            <hr style="border-top:1px dashed #000; margin:8px 0;">
            <table style="width:100%; font-size:10px; border-collapse:collapse; text-align:left; font-family:monospace;">
                <thead>
                    <tr style="border-bottom:1px solid #000;">
                        <th style="padding-bottom:4px; width:12%;">Sl</th>
                        <th style="padding-bottom:4px; width:43%;">Borrower</th>
                        <th style="padding-bottom:4px; width:25%;">Area</th>
                        <th style="padding-bottom:4px; text-align:right; width:20%;">Paid</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml || '<tr><td colspan="4" style="text-align:center; padding:10px 0;">No collections recorded</td></tr>'}
                </tbody>
            </table>
            <hr style="border-top:1px dashed #000; margin:8px 0;">
            <table style="width:100%; font-size:10px; font-weight:bold; font-family:monospace;">
                <tr>
                    <td>Members: ${filtered.length}</td>
                    <td style="text-align:right;">Total Paid: ₹${totalPaidToday}</td>
                </tr>
            </table>
            <hr style="border-top:1px dashed #000; margin:8px 0;">
            <div style="text-align:center; font-size:8px; font-family:monospace;">
                <p style="margin:2px 0;">Printed on: ${new Date().toLocaleString()}</p>
            </div>
        `;
    } else if (activeMemberCategory === 'unpaid-today') {
        listTitle = "UNPAID LIST";
        filtered = filtered.filter(l => {
            const scheduled = getScheduledDates(l);
            const isScheduled = scheduled.includes(filterDate);
            const hasPaid = db.collections.some(c => c.loanId === l.id && c.date === filterDate);
            return isScheduled && !hasPaid && l.unpaidAmount > 0;
        });
        
        let totalExpected = 0;
        let itemsHtml = "";
        
        filtered.forEach((l, idx) => {
            const area = db.areas.find(a => a.id === l.areaId);
            const areaName = area ? area.name : 'Unknown';
            totalExpected += parseFloat(l.installmentAmount) || 0;
            
            itemsHtml += `
                <tr>
                    <td style="font-weight:bold; padding:4px 0;">${formatBorrowerNo(l.slNo)}</td>
                    <td style="padding:4px 0;">${l.name}</td>
                    <td style="padding:4px 0;">${areaName}</td>
                    <td style="text-align:right; font-weight:bold; padding:4px 0;">₹${l.installmentAmount}</td>
                </tr>
            `;
        });
        
        htmlContent = `
            <div class="print-header" style="text-align:center;">
                <h2 style="font-size:14px; margin:0; font-family:monospace; font-weight:bold;">${(activeUser.companyName || 'TERRASOL FINSERV').toUpperCase()}</h2>
                <p style="font-size:11px; margin:3px 0; font-family:monospace; font-weight:bold;">${listTitle}</p>
                <p style="font-size:10px; margin:0; font-family:monospace;">Date: ${formatDisplayDate(filterDate)} | Line: ${activeLineId || 'All'}</p>
            </div>
            <hr style="border-top:1px dashed #000; margin:8px 0;">
            <table style="width:100%; font-size:10px; border-collapse:collapse; text-align:left; font-family:monospace;">
                <thead>
                    <tr style="border-bottom:1px solid #000;">
                        <th style="padding-bottom:4px; width:12%;">Sl</th>
                        <th style="padding-bottom:4px; width:43%;">Borrower</th>
                        <th style="padding-bottom:4px; width:25%;">Area</th>
                        <th style="padding-bottom:4px; text-align:right; width:20%;">Due</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml || '<tr><td colspan="4" style="text-align:center; padding:10px 0;">No pending dues today</td></tr>'}
                </tbody>
            </table>
            <hr style="border-top:1px dashed #000; margin:8px 0;">
            <table style="width:100%; font-size:10px; font-weight:bold; font-family:monospace;">
                <tr>
                    <td>Pending: ${filtered.length}</td>
                    <td style="text-align:right;">Total Due: ₹${totalExpected}</td>
                </tr>
            </table>
            <hr style="border-top:1px dashed #000; margin:8px 0;">
            <div style="text-align:center; font-size:8px; font-family:monospace;">
                <p style="margin:2px 0;">Printed on: ${new Date().toLocaleString()}</p>
            </div>
        `;
    }
    
    const receipt = document.getElementById('print-receipt-slip');
    receipt.innerHTML = htmlContent;
    
    document.body.classList.add('print-receipt-mode');
    window.print();
    document.body.classList.remove('print-receipt-mode');
}

function handlePrintCollectionReceipt() {
    const loanId = document.getElementById('post-loan-id').value;
    if (!loanId) return;
    
    // Find latest collection for borrower
    const collections = db.collections.filter(c => c.loanId === loanId).sort((a,b) => new Date(b.date) - new Date(a.date));
    if (collections.length > 0) {
        printIndividualSlip(collections[0].id);
    } else {
        showToast('No collections found to print receipt.', 'error');
    }
}

// ----------------------------------------------------
// 6. MONTHLY LIST & LEDGER CONTROLLER
// ----------------------------------------------------
function renderMonthlyList() {
    const latestYear = getLatestYear();
    
    // Generate Monthly stats
    const monthlyData = {};
    const monthsNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    for (let i = 0; i < 12; i++) {
        monthlyData[i] = {
            name: monthsNames[i] + ' ' + latestYear,
            loans: 0,
            collections: 0
        };
    }
    
    const activeAreas = getActiveLineAreas();
    const lineLoans = db.loans.filter(l => activeAreas.includes(l.areaId));
    const lineLoanIds = lineLoans.map(l => l.id);
    const lineCollections = db.collections.filter(c => lineLoanIds.includes(c.loanId));
    
    lineLoans.forEach(l => {
        const date = new Date(l.fromDate);
        if (date.getFullYear() === latestYear) {
            monthlyData[date.getMonth()].loans += l.loanAmount;
        }
    });
    
    lineCollections.forEach(c => {
        const date = new Date(c.date);
        if (date.getFullYear() === latestYear) {
            monthlyData[date.getMonth()].collections += c.amount;
        }
    });
    
    // Fill monthly summary table
    const tableBody = document.getElementById('monthly-summary-table-body');
    tableBody.innerHTML = '';
    
    const chartLabels = [];
    const chartLoans = [];
    const chartCollections = [];
    
    for (let i = 0; i < 12; i++) {
        const monthStats = monthlyData[i];
        const net = monthStats.loans - monthStats.collections;
        
        chartLabels.push(monthStats.name);
        chartLoans.push(monthStats.loans);
        chartCollections.push(monthStats.collections);
        
        tableBody.innerHTML += `
            <tr>
                <td><b>${monthStats.name}</b></td>
                <td>₹${monthStats.loans.toLocaleString('en-IN')}</td>
                <td style="color:var(--color-success);">₹${monthStats.collections.toLocaleString('en-IN')}</td>
                <td style="font-weight:600; color:${net >= 0 ? 'var(--color-warning)' : 'var(--color-success)'}">
                    ₹${net.toLocaleString('en-IN')}
                </td>
            </tr>
        `;
    }
    
    // Render Chart
    setTimeout(() => {
        initMonthlyChart(chartLabels, chartLoans, chartCollections);
    }, 100);
}

function initMonthlyChart(labels, loanData, collData) {
    const ctx = document.getElementById('monthlyPerformanceChart');
    if (!ctx) return;
    
    if (monthlyChart) {
        monthlyChart.destroy();
    }
    
    monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Loans Disbursed (₹)',
                    data: loanData,
                    backgroundColor: 'rgba(99, 102, 241, 0.65)',
                    borderColor: 'var(--color-primary)',
                    borderWidth: 1,
                    borderRadius: 6
                },
                {
                    label: 'Collections (₹)',
                    data: collData,
                    backgroundColor: 'rgba(16, 185, 129, 0.65)',
                    borderColor: 'var(--color-success)',
                    borderWidth: 1,
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#64748b', font: { family: 'Plus Jakarta Sans', weight: '600' } }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { color: '#64748b' }
                },
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { color: '#64748b' }
                }
            }
        }
    });
}

// ----------------------------------------------------
// 7. AREA / LOCATION CONFIGURATION CONTROLLER
// ----------------------------------------------------
function renderAreaSettings() {
    renderAreaListTable();
    setTimeout(initAreaMap, 100);
}

function initAreaMap() {
    const mapContainer = document.getElementById('area-management-map');
    if (!mapContainer) return;
    
    if (!areaMap) {
        areaMap = L.map('area-management-map').setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lng], 13);
        
        // Universally whitelisted OpenStreetMap layer (converted to dark mode via CSS filter)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(areaMap);
        
        // Click Listener to pick coordinates - only bind once to avoid duplicate pins/inputs
        areaMap.on('click', (e) => {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            
            document.getElementById('area-lat').value = lat.toFixed(6);
            document.getElementById('area-lng').value = lng.toFixed(6);
            
            // Remove temporary markers if any
            if (window.tempMarker) {
                try { areaMap.removeLayer(window.tempMarker); } catch(e) {}
            }
            
            window.tempMarker = L.marker([lat, lng], {
                icon: L.icon({
                    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                    iconSize: [25, 41],
                    iconAnchor: [12, 41],
                    className: 'temp-pin'
                })
            }).addTo(areaMap).bindPopup("New Center Selected").openPopup();
        });
    } else {
        // Clear old markers/circles instead of recreating map (prevents resetting center/zoom)
        areaMapMarkers.forEach(m => {
            try { areaMap.removeLayer(m); } catch(e) {}
        });
        areaMapCircles.forEach(c => {
            try { areaMap.removeLayer(c); } catch(e) {}
        });
    }
    
    areaMapMarkers = [];
    areaMapCircles = [];
    
    // Add existing areas on map
    db.areas.forEach(area => {
        const marker = L.marker([area.lat, area.lng]).addTo(areaMap)
            .bindPopup(`<b>${area.name}</b><br>Radius: ${area.radius}m`);
        const circle = L.circle([area.lat, area.lng], {
            color: 'rgba(99, 102, 241, 0.8)',
            fillColor: 'rgba(99, 102, 241, 0.15)',
            radius: area.radius
        }).addTo(areaMap);
        
        areaMapMarkers.push(marker);
        areaMapCircles.push(circle);
    });

    // Force map size refresh to fix any display glitches on tab change
    setTimeout(() => {
        if (areaMap) areaMap.invalidateSize();
    }, 100);
}

async function handleAreaGeocoding(type) {
    const isPortal = type === 'portal';
    const nameInputId = isPortal ? 'portal-area-name' : 'area-name';
    const latInputId = isPortal ? 'portal-area-lat' : 'area-lat';
    const lngInputId = isPortal ? 'portal-area-lng' : 'area-lng';
    const map = isPortal ? portalAreaMap : areaMap;
    const markerKey = isPortal ? 'portalTempMarker' : 'tempMarker';
    
    const query = document.getElementById(nameInputId).value.trim();
    if (!query || query.length < 3) return;

    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
        if (!response.ok) return;
        const results = await response.json();
        
        if (results && results.length > 0) {
            const result = results[0];
            const lat = parseFloat(result.lat);
            const lng = parseFloat(result.lon);
            
            document.getElementById(latInputId).value = lat.toFixed(6);
            document.getElementById(lngInputId).value = lng.toFixed(6);
            
            if (map) {
                map.setView([lat, lng], 14);
                
                if (window[markerKey]) {
                    try { map.removeLayer(window[markerKey]); } catch(e) {}
                }
                
                window[markerKey] = L.marker([lat, lng], {
                    icon: L.icon({
                        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                        iconSize: [25, 41],
                        iconAnchor: [12, 41],
                        className: 'temp-pin'
                    })
                }).addTo(map).bindPopup(`<b>Center Located:</b><br>${result.display_name}`).openPopup();
            }
        }
    } catch (err) {
        console.error('Geocoding search failed:', err);
    }
}

async function handleSaveArea(e) {
    e.preventDefault();
    
    const name = document.getElementById('area-name').value.trim();
    const lat = parseFloat(document.getElementById('area-lat').value);
    const lng = parseFloat(document.getElementById('area-lng').value);
    const radius = parseInt(document.getElementById('area-radius').value) || 500;
    
    const areaId = 'area-' + Date.now();
    
    try {
        await apiFetch('/api/tenant/areas', {
            method: 'POST',
            body: JSON.stringify({ id: areaId, name, lat, lng, radius })
        });
        showToast(`Area "${name}" configured successfully!`, 'success');
        
        document.getElementById('area-config-form').reset();
        if (window.tempMarker) {
            areaMap.removeLayer(window.tempMarker);
            window.tempMarker = null;
        }
        
        await refreshLocalData();
        populateAreaDropdowns();
        renderAreaSettings();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderAreaListTable() {
    const tableBody = document.getElementById('area-list-table-body');
    tableBody.innerHTML = '';
    
    if (db.areas.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No areas configured</td></tr>';
    } else {
        db.areas.forEach(a => {
            const deleteBtn = activeUser.role === 'admin'
                ? `<button class="btn btn-secondary btn-icon-only" style="width:26px; height:26px; font-size:10px; border-radius:4px;" onclick="handleDeleteArea('${a.id}')" title="Delete Area">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>`
                : '';
            tableBody.innerHTML += `
                <tr>
                    <td><b>${a.name}</b></td>
                    <td>${a.radius}m</td>
                    <td>${deleteBtn}</td>
                </tr>
            `;
        });
    }
}

async function handleDeleteArea(areaId) {
    if (activeUser.role !== 'admin') return;
    
    const area = db.areas.find(a => a.id === areaId);
    if (!area) return;
    
    // Check if any loans are linked to this area
    const linkedLoansCount = db.loans.filter(l => l.areaId === areaId).length;
    if (linkedLoansCount > 0) {
        showToast(`Cannot delete! ${linkedLoansCount} loan accounts are linked to this area.`, 'error');
        return;
    }
    
    showConfirmModal(
        'Delete Area',
        `Are you sure you want to delete the Area definition for "${area.name}"? This action cannot be undone.`,
        async () => {
            try {
                await apiFetch(`/api/tenant/areas/${areaId}`, {
                    method: 'DELETE'
                });
                showToast('Area deleted successfully.', 'success');
                
                await refreshLocalData();
                populateAreaDropdowns();
                renderAreaSettings();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

// ----------------------------------------------------
// 8. SECURITY & DB SETTINGS CONTROLLER
// ----------------------------------------------------
async function handleOwnerPasswordChange(e) {
    e.preventDefault();
    const newPwd = document.getElementById('pwd-admin-new').value;
    const confPwd = document.getElementById('pwd-admin-confirm').value;
    
    if (newPwd !== confPwd) {
        showToast('Passwords do not match!', 'error');
        return;
    }
    
    try {
        const res = await apiFetch('/api/settings/change-password', {
            method: 'POST',
            body: JSON.stringify({ newPassword: newPwd })
        });
        showToast(res.message, 'success');
        document.getElementById('owner-password-change-form').reset();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderCollectorsList() {
    const tableBody = document.getElementById('collector-list-table-body');
    tableBody.innerHTML = '';
    
    // Get unique lines
    const uniqueLines = [];
    db.lines.forEach(l => {
        if (!uniqueLines.includes(l.line_no)) {
            uniqueLines.push(l.line_no);
        }
    });
    uniqueLines.sort();

    // Populate the collector creation dropdown in Settings
    const collLineSelect = document.getElementById('coll-assigned-line');
    if (collLineSelect) {
        const val = collLineSelect.value;
        collLineSelect.innerHTML = '<option value="">-- Select Line --</option>';
        uniqueLines.forEach(lineNo => {
            collLineSelect.innerHTML += `<option value="${lineNo}">Line ${lineNo}</option>`;
        });
        collLineSelect.value = val;
    }
    
    if (!db.collectors || db.collectors.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No collectors registered</td></tr>';
    } else {
        db.collectors.forEach(c => {
            const assignment = db.collectorLines.find(cl => cl.username === c.username);
            const assignedLine = assignment ? assignment.line_no : '';

            let optionsHtml = '<option value="">Select Line (No Access)...</option>';
            uniqueLines.forEach(lineNo => {
                const isSelected = (assignedLine === lineNo) ? 'selected' : '';
                optionsHtml += `<option value="${lineNo}" ${isSelected}>${lineNo}</option>`;
            });

            const selectHtml = `<select class="form-input" style="padding: 4px 8px; font-size: 11px; width: 100%; min-width: 120px;" onchange="handleAssignCollectorLine('${c.username}', this.value)">
                ${optionsHtml}
            </select>`;

            tableBody.innerHTML += `
                <tr>
                    <td><b>${c.username}</b></td>
                    <td>${c.name}</td>
                    <td>${selectHtml}</td>
                    <td>
                        <button class="btn btn-secondary btn-icon-only" style="width:26px; height:26px; font-size:10px; border-radius:4px;" onclick="handleDeleteCollector('${c.username}')" title="Remove Collector">
                            <i class="fa-solid fa-user-minus"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    }
}

async function handleAssignCollectorLine(username, lineNo) {
    try {
        await apiFetch('/api/tenant/collector-lines', {
            method: 'POST',
            body: JSON.stringify({ username, line_no: lineNo })
        });
        showToast(`Line assignment updated for collector ${username}!`, 'success');
        await refreshLocalData();
        renderCollectorsList();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleSaveCollector(e) {
    e.preventDefault();
    if (activeUser.role !== 'admin' && activeUser.role !== 'owner') {
        showToast('Forbidden. Only administrators and owners can manage collectors.', 'error');
        return;
    }
    const username = document.getElementById('coll-username').value.trim().toLowerCase();
    const name = document.getElementById('coll-name').value.trim();
    const password = document.getElementById('coll-password').value;
    const assignedLine = document.getElementById('coll-assigned-line').value;
    
    try {
        await apiFetch('/api/tenant/collectors', {
            method: 'POST',
            body: JSON.stringify({ username, name, password })
        });
        
        // If line is assigned, save it immediately
        if (assignedLine) {
            await apiFetch('/api/tenant/collector-lines', {
                method: 'POST',
                body: JSON.stringify({ username, line_no: assignedLine })
            });
        }
        
        showToast(`Collector "${name}" added successfully!`, 'success');
        
        document.getElementById('collector-management-form').reset();
        await refreshLocalData();
        renderCollectorsList();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleDeleteCollector(username) {
    if (activeUser.role !== 'admin' && activeUser.role !== 'owner') return;
    
    if (db.collectors.length <= 1) {
        showToast('Cannot delete! At least one active collector must remain in the system.', 'error');
        return;
    }
    
    showConfirmModal(
        'Delete Collector Agent',
        `Are you sure you want to delete the collector account for "${username}"? This action cannot be undone.`,
        async () => {
            try {
                await apiFetch(`/api/tenant/collectors/${username}`, {
                    method: 'DELETE'
                });
                showToast('Collector agent removed.', 'success');
                
                await refreshLocalData();
                renderCollectorsList();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

function renderSettingsView() {
    renderCollectorsList();
    
    // Header for credentials change
    const pwdHeader = document.querySelector('#owner-password-change-form').parentElement.querySelector('h3');
    const pwdDesc = document.querySelector('#owner-password-change-form').parentElement.querySelector('p');
    const dbOpsCard = document.getElementById('btn-export-db').closest('.glass-card');
    
    // Always hide the old Owner Management card in settings
    document.getElementById('owner-management-card').style.display = 'none';

    if (activeUser.role === 'owner') {
        pwdHeader.innerHTML = `<i class="fa-solid fa-key"></i> Owner Credentials`;
        pwdDesc.textContent = `Update your System Owner password.`;
        
        // Show Collector Management
        document.getElementById('collector-management-card').style.display = 'block';
        
        // Hide Database Operations for Owner
        if (dbOpsCard) {
            dbOpsCard.style.display = 'none';
        }
    } else if (activeUser.role === 'admin') {
        pwdHeader.innerHTML = `<i class="fa-solid fa-key"></i> Admin Credentials`;
        pwdDesc.textContent = `Update your System Administrator password.`;
        
        // Hide Collector Management for Admin
        document.getElementById('collector-management-card').style.display = 'none';
        
        // Show Database Operations for Admin
        if (dbOpsCard) {
            dbOpsCard.style.display = 'block';
            document.getElementById('btn-import-db-trigger').style.display = 'inline-flex';
            document.getElementById('settings-dangerous-actions').style.display = 'block';
        }
    } else {
        // Collectors
        if (dbOpsCard) dbOpsCard.style.display = 'none';
    }
}

function renderOwnersList() {
    const tableBody = document.getElementById('owner-list-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    if (!db.owners || db.owners.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No owners registered</td></tr>';
    } else {
        db.owners.forEach(o => {
            tableBody.innerHTML += `
                <tr>
                    <td><b>${o.username}</b></td>
                    <td>${o.name}</td>
                    <td>
                        <button class="btn btn-secondary btn-icon-only" style="width:26px; height:26px; font-size:10px; border-radius:4px;" onclick="handleDeleteOwner('${o.username}')" title="Remove Owner">
                            <i class="fa-solid fa-user-minus"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    }
}

async function handleSaveOwner(e) {
    e.preventDefault();
    const username = document.getElementById('owner-username').value.trim().toLowerCase();
    const name = document.getElementById('owner-name').value.trim();
    const password = document.getElementById('owner-password').value;
    
    if (username === 'admin') {
        showToast('Username "admin" is reserved for the System Administrator!', 'error');
        return;
    }
    
    try {
        const res = await apiFetch('/api/auth/register-owner', {
            method: 'POST',
            body: JSON.stringify({ username, name, password })
        });
        showToast(res.message, 'success');
        
        document.getElementById('owner-management-form').reset();
        await refreshLocalData();
        renderOwnersList();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleDeleteOwner(username) {
    if (activeUser.role !== 'admin') return;
    
    showConfirmModal(
        'Delete Owner Account',
        `Are you sure you want to delete the owner account for "${username}"? This action cannot be undone.`,
        async () => {
            try {
                await apiFetch(`/api/owners/${username}`, {
                    method: 'DELETE'
                });
                showToast('Owner account removed.', 'success');
                
                await refreshLocalData();
                renderOwnersList();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

async function exportDatabase() {
    if (activeUser.role !== 'admin') return;
    try {
        const data = await apiFetch('/api/tenant/db/export', { method: 'POST' });
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href",     dataStr);
        downloadAnchor.setAttribute("download", `terrasol_backup_${new Date().toISOString().substring(0,10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('Database exported successfully!', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function importDatabase(e) {
    if (activeUser.role !== 'admin') return;
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const parsed = JSON.parse(evt.target.result);
            
            await apiFetch('/api/tenant/db/import', {
                method: 'POST',
                body: JSON.stringify(parsed)
            });
            showToast('Database restored successfully from backup!', 'success');
            await switchView(currentView);
        } catch (err) {
            showToast('Failed to import database: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

async function exportDatabaseMDB() {
    if (activeUser.role !== 'admin') return;
    try {
        const token = sessionStorage.getItem('tsfs_jwt');
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        showToast('Compiling MDB file... please wait', 'info');
        const response = await fetch('/api/tenant/db/export-mdb', {
            method: 'POST',
            headers: headers
        });
        
        if (response.status === 401 || response.status === 403) {
            showLoginPage();
            throw new Error('Unauthorized');
        }
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
        }
        
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", downloadUrl);
        downloadAnchor.setAttribute("download", "1.MDB");
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        window.URL.revokeObjectURL(downloadUrl);
        showToast('Database exported successfully as 1.MDB!', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function importDatabaseMDB(e) {
    if (activeUser.role !== 'admin') return;
    const file = e.target.files[0];
    if (!file) return;
    
    showToast('Importing 1.MDB file... please wait', 'info');
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const dataUrl = evt.target.result;
            const base64Data = dataUrl.split(',')[1];
            
            const res = await apiFetch('/api/tenant/db/import-mdb', {
                method: 'POST',
                body: JSON.stringify({ mdbBase64: base64Data })
            });
            showToast(res.message || 'Database imported successfully from MDB!', 'success');
            await refreshLocalData();
            await switchView(currentView);
        } catch (err) {
            showToast('Failed to import MDB: ' + err.message, 'error');
        }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}


async function handleWipeDatabase() {
    if (activeUser.role !== 'admin') return;
    
    showConfirmModal(
        'Wipe Database',
        'CRITICAL WARNING: This will completely wipe all database records, areas, settings, and histories. This action is IRREVERSIBLE! Proceed?',
        async () => {
            try {
                await apiFetch('/api/tenant/db/wipe', { method: 'POST' });
                showToast('System database wiped completely.', 'info');
                await switchView(currentView);
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

// Geofencing distance calculation utilities (Haversine formula)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;
 
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
 
    return R * c; // Distance in meters
}
 
// Display Date Formatter (e.g. 2026-06-01 to 01-06-2026)
function formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}
 
function showConfirmModal(title, message, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal-overlay';
    
    const card = document.createElement('div');
    card.className = 'confirm-modal-card';
    
    card.innerHTML = `
        <div class="confirm-modal-icon">
            <i class="fa-solid fa-triangle-exclamation"></i>
        </div>
        <div class="confirm-modal-title">${title}</div>
        <div class="confirm-modal-message">${message}</div>
        <div class="confirm-modal-actions">
            <button type="button" class="btn btn-secondary" id="btn-confirm-modal-cancel">Cancel</button>
            <button type="button" class="btn btn-danger" id="btn-confirm-modal-confirm" disabled>Confirm Delete (10s)</button>
        </div>
    `;
    
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    
    setTimeout(() => overlay.classList.add('active'), 10);
    
    const cancelBtn = card.querySelector('#btn-confirm-modal-cancel');
    const confirmBtn = card.querySelector('#btn-confirm-modal-confirm');
    
    cancelBtn.focus();
    
    let countdown = 10;
    let timer = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            confirmBtn.textContent = `Confirm Delete (${countdown}s)`;
        } else {
            clearInterval(timer);
            confirmBtn.textContent = 'Confirm Delete';
            confirmBtn.disabled = false;
        }
    }, 1000);
    
    const closeModal = (confirmed) => {
        clearInterval(timer);
        overlay.classList.remove('active');
        setTimeout(() => {
            document.body.removeChild(overlay);
            if (confirmed) {
                if (onConfirm) onConfirm();
            } else {
                if (onCancel) onCancel();
            }
        }, 250);
    };
    
    cancelBtn.addEventListener('click', () => closeModal(false));
    confirmBtn.addEventListener('click', () => closeModal(true));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeModal(false);
        }
    });
}

function showPromptModal(title, message, defaultValue, onSave, onCancel) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal-overlay';
    
    const card = document.createElement('div');
    card.className = 'confirm-modal-card';
    card.style.maxWidth = '400px';
    
    card.innerHTML = `
        <div class="confirm-modal-icon" style="background: rgba(6, 182, 212, 0.1); color: #06b6d4;">
            <i class="fa-solid fa-wallet"></i>
        </div>
        <div class="confirm-modal-title" style="margin-top: 12px; font-weight: 800; font-size: 18px; color: var(--text-dark);">${title}</div>
        <div class="confirm-modal-message" style="margin: 8px 0 16px; color: var(--text-muted); font-size: 13px; text-align: center;">${message}</div>
        <div class="form-group" style="width: 100%; text-align: left; margin-bottom: 20px;">
            <input type="number" id="prompt-modal-input" class="form-input" style="width: 100%; font-size: 16px; padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); color: var(--text-main);" value="${defaultValue}" required min="0" step="any">
        </div>
        <div class="confirm-modal-actions" style="display: flex; gap: 12px; justify-content: flex-end; width: 100%;">
            <button type="button" class="btn btn-secondary" id="btn-prompt-modal-cancel" style="flex: 1; padding: 12px;">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-prompt-modal-save" style="flex: 1; padding: 12px;">Save</button>
        </div>
    `;
    
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    
    setTimeout(() => overlay.classList.add('active'), 10);
    
    const inputEl = card.querySelector('#prompt-modal-input');
    const cancelBtn = card.querySelector('#btn-prompt-modal-cancel');
    const saveBtn = card.querySelector('#btn-prompt-modal-save');
    
    inputEl.focus();
    inputEl.select();
    
    const closeModal = (saved) => {
        const value = inputEl.value;
        overlay.classList.remove('active');
        setTimeout(() => {
            document.body.removeChild(overlay);
            if (saved) {
                if (onSave) onSave(value);
            } else {
                if (onCancel) onCancel();
            }
        }, 300);
    };
    
    cancelBtn.addEventListener('click', () => closeModal(false));
    saveBtn.addEventListener('click', () => {
        const val = parseFloat(inputEl.value);
        if (isNaN(val) || val < 0) {
            showToast('Please enter a valid non-negative number!', 'error');
            return;
        }
        closeModal(true);
    });
    
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            saveBtn.click();
        } else if (e.key === 'Escape') {
            cancelBtn.click();
        }
    });
}

// Display alert system
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        'success': 'fa-solid fa-circle-check',
        'error': 'fa-solid fa-circle-xmark',
        'info': 'fa-solid fa-circle-info'
    };
    
    toast.innerHTML = `
        <i class="${icons[type] || icons['info']}"></i>
        <div style="font-size:13px; font-weight:600;">${message}</div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
 
// Dynamic dummy data generator matching user screenshots & location context
function loadDummyData(force = false) {
    if (!force) return;
    
    apiFetch('/api/tenant/db/load-demo', { method: 'POST' })
        .then(() => {
            showToast('Demo data loaded successfully!', 'success');
            switchView(currentView);
        })
        .catch(err => {
            showToast(err.message, 'error');
        });
}

// ----------------------------------------------------
// 9. COLLECTION LINES & FOLDERS VIEW MANAGEMENT
// ----------------------------------------------------

// Helper to get area IDs linked to the active line
function getActiveLineAreas() {
    if (activeUser && (activeUser.role === 'owner' || activeUser.role === 'admin')) {
        if (activeLineId) {
            return db.lines.filter(l => l.line_no === activeLineId).map(l => l.area_id);
        }
        return db.areas.map(a => a.id);
    }
    if (!activeLineId) return [];
    return db.lines.filter(l => l.line_no === activeLineId).map(l => l.area_id);
}

// Show the Selection Portal
async function showLinePortal() {
    if (activeUser && activeUser.role === 'collector') {
        const assignment = db.collectorLines ? db.collectorLines.find(cl => cl.username === activeUser.username) : null;
        if (assignment && assignment.line_no) {
            activeLineId = assignment.line_no;
            sessionStorage.setItem('tsfs_active_line', activeLineId);
            await showMainApp();
            return;
        } else {
            showToast('No line assigned to this collector. Please contact the owner/admin.', 'error');
            showLoginPage();
            return;
        }
    }

    transitionToContainer('line-portal-container', 'flex');
    
    // Clear dropdown immediately so stale lines from any previous tenant never appear
    const dropdown = document.getElementById('portal-lines-dropdown');
    if (dropdown) {
        dropdown.innerHTML = '<option value="">Loading collection lines...</option>';
    }

    // Fetch latest lines & areas strictly for THIS authenticated tenant
    showSyncIndicator();
    try {
        await refreshLocalData();
    } catch (err) {
        console.error("Failed to sync tenant data in portal:", err);
    } finally {
        hideSyncIndicator();
        populateAreaDropdowns();
        renderLinePortal();
    }
}

// Render selector portal page
function renderLinePortal() {
    const portalCard = document.getElementById('line-portal-card');
    const portalTabs = document.getElementById('portal-tabs');
    
    if (activeUser && activeUser.role === 'collector') {
        if (portalCard) portalCard.style.width = '520px';
        if (portalTabs) portalTabs.style.display = 'none';
        switchPortalTab('lines');
    } else {
        if (portalCard) portalCard.style.width = '700px';
        if (portalTabs) portalTabs.style.display = 'flex';
        switchPortalTab(currentPortalTab);
    }

    // Show/Hide creation controls by role
    const createSection = document.getElementById('portal-create-line-section');
    if (createSection) {
        if (activeUser && activeUser.role === 'collector') {
            createSection.style.display = 'none';
        } else {
            createSection.style.display = 'block';
        }
    }
    
    // Dropdown population
    const dropdown = document.getElementById('portal-lines-dropdown');
    if (!dropdown) return;
    
    // Fetch unique line numbers
    const uniqueLines = [];
    if (db.lines && Array.isArray(db.lines)) {
        db.lines.forEach(l => {
            if (l.line_no && !uniqueLines.includes(l.line_no)) {
                uniqueLines.push(l.line_no);
            }
        });
    }
    uniqueLines.sort();
    
    const currentSelVal = dropdown.value;
    if (uniqueLines.length === 0) {
        dropdown.innerHTML = '<option value="">-- No Lines Configured Yet --</option>';
    } else {
        dropdown.innerHTML = '<option value="">-- Select a Collection Line --</option>';
        uniqueLines.forEach(lineNo => {
            const areasCount = db.lines.filter(l => l.line_no === lineNo).length;
            const displayLine = lineNo.toLowerCase().startsWith('line') ? lineNo : `Line ${lineNo}`;
            dropdown.innerHTML += `<option value="${lineNo}">${displayLine} (${areasCount} area(s))</option>`;
        });
    }
    
    if (uniqueLines.includes(currentSelVal)) {
        dropdown.value = currentSelVal;
    } else {
        dropdown.value = '';
    }
    
    updatePortalDeleteButtonState();
}

function updatePortalDeleteButtonState() {
    const dropdown = document.getElementById('portal-lines-dropdown');
    const deleteBtn = document.getElementById('btn-portal-delete-line-submit');
    if (!dropdown || !deleteBtn) return;
    
    const selectedLine = dropdown.value;
    if (selectedLine && activeUser && activeUser.role !== 'collector') {
        deleteBtn.style.display = 'inline-block';
    } else {
        deleteBtn.style.display = 'none';
    }
}

// Switch between portal tabs
function switchPortalTab(tabName) {
    currentPortalTab = tabName;
    const tabLinesBtn = document.getElementById('btn-portal-tab-lines');
    const tabAreasBtn = document.getElementById('btn-portal-tab-areas');
    const linesContent = document.getElementById('portal-tab-content-lines');
    const areasContent = document.getElementById('portal-tab-content-areas');
    
    if (tabName === 'lines') {
        if (tabLinesBtn) tabLinesBtn.classList.add('active');
        if (tabAreasBtn) tabAreasBtn.classList.remove('active');
        if (linesContent) linesContent.style.display = 'block';
        if (areasContent) areasContent.style.display = 'none';
    } else {
        if (tabLinesBtn) tabLinesBtn.classList.remove('active');
        if (tabAreasBtn) tabAreasBtn.classList.add('active');
        if (linesContent) linesContent.style.display = 'none';
        if (areasContent) areasContent.style.display = 'block';
        
        // Refresh portal area map and table
        renderPortalAreaListTable();
        setTimeout(initPortalAreaMap, 100);
    }
}

// Portal Area List Table
function renderPortalAreaListTable() {
    const tableBody = document.getElementById('portal-area-list-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    if (db.areas.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No areas configured</td></tr>';
    } else {
        db.areas.forEach(a => {
            const deleteBtn = activeUser.role === 'admin'
                ? `<button class="btn btn-secondary btn-icon-only" style="width:26px; height:26px; font-size:10px; border-radius:4px;" onclick="event.stopPropagation(); handleDeleteAreaPortal('${a.id}')" title="Delete Area">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>`
                : '';
            tableBody.innerHTML += `
                <tr>
                    <td><b>${a.name}</b></td>
                    <td>${a.radius}m</td>
                    <td>${deleteBtn}</td>
                </tr>
            `;
        });
    }
}

// Delete Area from Portal
async function handleDeleteAreaPortal(areaId) {
    if (activeUser.role !== 'admin') return;
    
    const area = db.areas.find(a => a.id === areaId);
    if (!area) return;
    
    // Check if any loans are linked to this area
    const linkedLoansCount = db.loans.filter(l => l.areaId === areaId).length;
    if (linkedLoansCount > 0) {
        showToast(`Cannot delete! ${linkedLoansCount} loan accounts are linked to this area.`, 'error');
        return;
    }
    
    showConfirmModal(
        'Delete Area',
        `Are you sure you want to delete the Area definition for "${area.name}"? This action cannot be undone.`,
        async () => {
            try {
                await apiFetch(`/api/tenant/areas/${areaId}`, {
                    method: 'DELETE'
                });
                showToast('Area deleted successfully.', 'success');
                
                await refreshLocalData();
                populateAreaDropdowns();
                renderLinePortal();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

// Save Area from Portal
async function handleSaveAreaPortal(e) {
    e.preventDefault();
    
    const name = document.getElementById('portal-area-name').value.trim();
    const lat = parseFloat(document.getElementById('portal-area-lat').value);
    const lng = parseFloat(document.getElementById('portal-area-lng').value);
    const radius = parseInt(document.getElementById('portal-area-radius').value) || 500;
    
    const areaId = 'area-' + Date.now();
    
    try {
        await apiFetch('/api/tenant/areas', {
            method: 'POST',
            body: JSON.stringify({ id: areaId, name, lat, lng, radius })
        });
        showToast(`Area "${name}" configured successfully!`, 'success');
        
        document.getElementById('portal-area-config-form').reset();
        if (window.portalTempMarker) {
            portalAreaMap.removeLayer(window.portalTempMarker);
            window.portalTempMarker = null;
        }
        
        await refreshLocalData();
        populateAreaDropdowns();
        renderLinePortal();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Portal Leaflet Map Visualizer
function initPortalAreaMap() {
    const mapContainer = document.getElementById('portal-area-management-map');
    if (!mapContainer || activeUser.role === 'collector') return;
    
    if (!portalAreaMap) {
        portalAreaMap = L.map('portal-area-management-map').setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lng], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(portalAreaMap);
        
        portalAreaMap.on('click', (e) => {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            
            document.getElementById('portal-area-lat').value = lat.toFixed(6);
            document.getElementById('portal-area-lng').value = lng.toFixed(6);
            
            if (window.portalTempMarker) {
                try { portalAreaMap.removeLayer(window.portalTempMarker); } catch(e) {}
            }
            
            window.portalTempMarker = L.marker([lat, lng], {
                icon: L.icon({
                    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                    iconSize: [25, 41],
                    iconAnchor: [12, 41]
                })
            }).addTo(portalAreaMap).bindPopup("New Center Selected").openPopup();
        });
    } else {
        portalAreaMapMarkers.forEach(m => {
            try { portalAreaMap.removeLayer(m); } catch(e) {}
        });
        portalAreaMapCircles.forEach(c => {
            try { portalAreaMap.removeLayer(c); } catch(e) {}
        });
    }
    
    portalAreaMapMarkers = [];
    portalAreaMapCircles = [];
    
    db.areas.forEach(area => {
        const marker = L.marker([area.lat, area.lng]).addTo(portalAreaMap)
            .bindPopup(`<b>${area.name}</b><br>Radius: ${area.radius}m`);
        const circle = L.circle([area.lat, area.lng], {
            color: 'rgba(99, 102, 241, 0.8)',
            fillColor: 'rgba(99, 102, 241, 0.15)',
            radius: area.radius
        }).addTo(portalAreaMap);
        
        portalAreaMapMarkers.push(marker);
        portalAreaMapCircles.push(circle);
    });
    
    setTimeout(() => {
        if (portalAreaMap) portalAreaMap.invalidateSize();
    }, 100);
}

// Line selected from portal
function selectPortalLine(lineNo) {
    activeLineId = lineNo;
    sessionStorage.setItem('tsfs_active_line', lineNo);
    showMainApp();
}

// Create new line mapping from portal
async function handleSaveLinePortal(e) {
    e.preventDefault();
    const lineNoInput = document.getElementById('portal-new-line-no');
    const lineAreaSelect = document.getElementById('portal-new-line-area');
    
    const lineNo = lineNoInput.value.trim();
    const areaId = lineAreaSelect.value;
    
    if (!lineNo) {
        showToast('Please enter a Line Number!', 'error');
        return;
    }
    if (!areaId) {
        showToast('Please select an Area!', 'error');
        return;
    }
    
    const id = 'line-' + Date.now();
    try {
        await apiFetch('/api/tenant/lines', {
            method: 'POST',
            body: JSON.stringify({ id, line_no: lineNo, area_id: areaId })
        });
        showToast(`Line "${lineNo}" created/mapped successfully!`, 'success');
        
        lineNoInput.value = '';
        lineAreaSelect.value = '';
        
        await refreshLocalData();
        renderLinePortal();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Delete line configuration from portal
async function handleDeleteLinePortal(lineNo) {
    showConfirmModal(
        'Delete Line Mapping',
        `Are you sure you want to delete Line "${lineNo}"? Areas mapped to this line will lose their line association.`,
        async () => {
            const matchingLines = db.lines.filter(l => l.line_no === lineNo);
            try {
                for (let lineObj of matchingLines) {
                    await apiFetch(`/api/tenant/lines/${lineObj.id}`, { method: 'DELETE' });
                }
                showToast(`Line "${lineNo}" deleted successfully.`, 'success');
                await refreshLocalData();
                renderLinePortal();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

// Handle Switch Line action
async function handleSwitchLine() {
    activeLineId = '';
    sessionStorage.removeItem('tsfs_active_line');
    await showLinePortal();
}

function renderLinesList() {
    const listContainer = document.getElementById('loan-folder-list');
    if (!listContainer) return;
    
    if (!activeLineId && activeUser && activeUser.role !== 'owner' && activeUser.role !== 'admin') {
        listContainer.innerHTML = '<li style="text-align: center; padding: 12px; font-size: 12px; color: var(--text-muted);">Please select a collection line</li>';
        return;
    }
    
    // Find areas linked to this line number
    const activeAreas = getActiveLineAreas();
    
    // Filter loans in these areas, show active running loans, and exclude those already collected on the selected date
    const selectedDate = document.getElementById('post-date')?.value || getLatestCollectionDate();
    let loans = db.loans.filter(l => {
        const isLinked = activeAreas.includes(l.areaId);
        const isActive = l.unpaidAmount > 0;
        const alreadyCollected = db.collections.some(c => c.loanId === l.id && c.date === selectedDate && !c.deleted);
        return isLinked && isActive && !alreadyCollected;
    });
    
    if (loans.length === 0) {
        listContainer.innerHTML = `<li style="text-align: center; padding: 12px; font-size: 12px; color: var(--text-muted);">No remaining collections for this date</li>`;
        return;
    }
    
    // Sort by Sl.No
    loans.sort((a,b) => a.slNo - b.slNo);
    
    const activeLoanId = document.getElementById('post-loan-id').value;
    
    listContainer.innerHTML = '';
    loans.forEach(loan => {
        const area = db.areas.find(a => a.id === loan.areaId);
        const areaName = area ? area.name : 'Unknown';
        const isSelected = loan.id === activeLoanId ? 'selected' : '';
        
        listContainer.innerHTML += `
            <li class="loan-folder-item ${isSelected}" onclick="loadMemberIntoPosting('${loan.id}')">
                <div class="item-details">
                    <div class="item-name">${loan.name} <span style="font-size:10px; color:var(--text-muted);">(#${formatBorrowerNo(loan.slNo)})</span></div>
                    <div class="item-meta"><i class="fa-solid fa-location-dot"></i> ${areaName}</div>
                </div>
                <div class="item-balance" style="color:${loan.unpaidAmount > 0 ? 'var(--color-warning)' : 'var(--color-success)'}">
                    ₹${loan.unpaidAmount.toLocaleString('en-IN')}
                </div>
            </li>
        `;
    });
}

// ====================================================
// SAAS MULTI-TENANT ONBOARDING, ADMIN CONSOLE & OAUTH
// ====================================================

async function handleWorkspaceSetupSubmit(e) {
    e.preventDefault();
    const companyNameVal = document.getElementById('setup-company-name').value.trim();
    if (!companyNameVal) return;
    
    try {
        const res = await apiFetch('/api/tenant/settings/company-name', {
            method: 'POST',
            body: JSON.stringify({ companyName: companyNameVal })
        });
        
        // Re-save session token and profile info
        sessionStorage.setItem('tsfs_jwt', res.token);
        activeUser = res.user;
        sessionStorage.setItem('tsfs_session', JSON.stringify(activeUser));
        
        showToast('Workspace setup completed successfully!', 'success');
        
        // Transition to main app
        showMainApp();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function renderAdminConsole() {
    const tableBody = document.getElementById('admin-tenants-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 12px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading tenant environments...</td></tr>';
    
    try {
        const tenants = await apiFetch('/api/admin/tenants');
        tableBody.innerHTML = '';
        
        if (tenants.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 12px;">No active tenant environments found.</td></tr>';
            return;
        }
        
        tenants.forEach(t => {
            const dateStr = new Date(t.createdAt).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric'
            });
            
            tableBody.innerHTML += `
                <tr>
                    <td>
                        <div style="font-weight: bold; color: white;">${t.name}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">ID: ${t.username}</div>
                    </td>
                    <td>
                        <span style="font-size: 12px; font-weight: 600; color: var(--color-primary-light);">${t.companyName || 'Not Set'}</span>
                    </td>
                    <td>
                        <div style="font-family: monospace; font-size: 11px;">${t.dbFile}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">Size: ${t.dbSizeKb} KB</div>
                    </td>
                    <td>
                        <span class="badge badge-primary" style="font-size: 11px;">${t.activeLoans} active</span>
                    </td>
                    <td>
                        <span class="badge badge-success" style="font-size: 11px;">${t.totalCollections} postings</span>
                    </td>
                    <td>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-secondary btn-icon-only" style="width: 28px; height: 28px; font-size: 11px; border-radius: 6px;" onclick="adminExportTenantDB('${t.tenantId}', '${t.companyName || t.username}')" title="Export / Backup DB">
                                <i class="fa-solid fa-file-export"></i>
                            </button>
                            <button class="btn btn-warning btn-icon-only" style="width: 28px; height: 28px; font-size: 11px; border-radius: 6px; color: black; background: var(--color-warning);" onclick="adminWipeTenantDB('${t.tenantId}', '${t.companyName || t.name}')" title="Wipe Database">
                                <i class="fa-solid fa-dumpster-fire"></i>
                            </button>
                            <button class="btn btn-danger btn-icon-only" style="width: 28px; height: 28px; font-size: 11px; border-radius: 6px;" onclick="adminDeleteOwner('${t.username}', '${t.name}')" title="Delete Owner & Database">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
    } catch (err) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-danger); padding: 12px;">Error: ${err.message}</td></tr>`;
    }
}

async function adminExportTenantDB(tenantId, name) {
    try {
        const data = await apiFetch(`/api/admin/tenants/${tenantId}/export`, { method: 'POST' });
        const cleanName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `terrasol_backup_${cleanName}_${new Date().toISOString().substring(0,10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('Tenant database exported successfully!', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function adminWipeTenantDB(tenantId, name) {
    showConfirmModal(
        'Wipe Tenant Database',
        `CRITICAL WARNING: Are you sure you want to WIPE all loan, collection, area, and line data inside the SQLite database for "${name}"? This action is irreversible and cannot be undone.`,
        async () => {
            try {
                await apiFetch(`/api/admin/tenants/${tenantId}/wipe`, { method: 'POST' });
                showToast(`Tenant "${name}" database has been wiped.`, 'success');
                renderAdminConsole();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

async function adminDeleteOwner(username, name) {
    showConfirmModal(
        'Delete Owner and Database',
        `CRITICAL WARNING: Are you sure you want to DELETE the owner account "${name}" (${username}) along with their isolated SQLite database container? All client ledgers, collections, and collectors will be permanently lost!`,
        async () => {
            try {
                await apiFetch(`/api/owners/${username}`, { method: 'DELETE' });
                showToast(`Owner "${name}" and their database file have been permanently deleted.`, 'success');
                renderAdminConsole();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

async function handleRegisterOwnerAdmin(e) {
    e.preventDefault();
    const username = document.getElementById('admin-owner-username').value.trim().toLowerCase();
    const name = document.getElementById('admin-owner-name').value.trim();
    const password = document.getElementById('admin-owner-password').value;
    
    if (username === 'admin') {
        showToast('Username "admin" is reserved!', 'error');
        return;
    }
    
    try {
        await apiFetch('/api/auth/register-owner', {
            method: 'POST',
            body: JSON.stringify({ username, name, password })
        });
        showToast(`Owner "${name}" registered successfully!`, 'success');
        document.getElementById('admin-owner-form').reset();
        renderAdminConsole();
    } catch (err) {
        showToast(err.message, 'error');
    }
}


// ==========================================
// DAILY EXPENSES & FLOATS CONTROLLERS
// ==========================================
function renderExpensesTable() {
    const tableBody = document.getElementById('expenses-table-body');
    const totalIndicator = document.getElementById('expense-total-indicator');
    if (!tableBody) return;
    
    const expDateInput = document.getElementById('expense-date');
    const selectedDate = expDateInput ? expDateInput.value : new Date().toISOString().substring(0, 10);
    
    const dailyExpenses = db.expenses.filter(e => e.line_no === activeLineId && e.date === selectedDate);
    const totalAmount = dailyExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    
    if (totalIndicator) {
        totalIndicator.textContent = `Total: ₹${totalAmount.toLocaleString('en-IN')}`;
    }
    
    tableBody.innerHTML = '';
    
    if (dailyExpenses.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 12px;">No expenses recorded for this date</td></tr>';
    } else {
        dailyExpenses.forEach(e => {
            const deleteBtn = (activeUser && (activeUser.role === 'owner' || activeUser.role === 'admin'))
                ? `<button class="btn btn-secondary btn-icon-only" style="width:26px; height:26px; font-size:10px; border-radius:4px;" onclick="handleDeleteExpense('${e.id}')" title="Delete Expense">
                    <i class="fa-solid fa-trash-can"></i>
                   </button>`
                : '';
                
            tableBody.innerHTML += `
                <tr>
                    <td><b>${e.category}</b></td>
                    <td style="font-weight: 600; color: var(--color-danger);">₹${e.amount}</td>
                    <td>${e.description || '<span style="color: var(--text-muted);">--</span>'}</td>
                    <td>${e.collector_username}</td>
                    <td>${e.date}</td>
                    <td>${deleteBtn}</td>
                </tr>
            `;
        });
    }
}

async function handleSaveExpense(event) {
    event.preventDefault();
    const categorySelect = document.getElementById('expense-category');
    const category = categorySelect.value;
    const amount = parseFloat(document.getElementById('expense-amount').value) || 0;
    const description = document.getElementById('expense-desc').value.trim();
    const date = document.getElementById('expense-date').value;
    
    if (!category || category === 'custom') {
        showToast('Please select a valid expense category!', 'error');
        return;
    }

    const cashInHand = getTrialBalanceCashInHand(activeLineId);
    if (amount > cashInHand) {
        showToast(`Cannot record expense of ₹${amount.toLocaleString('en-IN')} because the available Trial Balance cash in hand is only ₹${cashInHand.toLocaleString('en-IN')}.`, 'error');
        return;
    }
    
    try {
        await apiFetch('/api/tenant/expenses', {
            method: 'POST',
            body: JSON.stringify({ category, amount, description, date, line_no: activeLineId })
        });
        showToast('Expense recorded successfully!', 'success');
        document.getElementById('expense-entry-form').reset();
        
        document.getElementById('expense-date').value = date;
        
        await refreshLocalData();
        renderExpensesTable();
        
        if (currentView === 'dashboard') {
            renderDashboard();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleDeleteExpense(id) {
    showConfirmModal(
        'Delete Expense',
        'Are you sure you want to delete this expense entry? This action cannot be undone.',
        async () => {
            try {
                await apiFetch(`/api/tenant/expenses/${id}`, {
                    method: 'DELETE'
                });
                showToast('Expense deleted successfully!', 'success');
                await refreshLocalData();
                renderExpensesTable();
                
                if (currentView === 'dashboard') {
                    renderDashboard();
                }
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

function setupExpenseCategoryListener() {
    const categorySelect = document.getElementById('expense-category');
    if (!categorySelect) return;
    
    categorySelect.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
            const customType = prompt('Enter custom expense category name:');
            if (customType && customType.trim()) {
                const cleanType = customType.trim();
                let exists = false;
                for (let option of e.target.options) {
                    if (option.value.toLowerCase() === cleanType.toLowerCase()) {
                        e.target.value = option.value;
                        exists = true;
                        break;
                    }
                }
                if (!exists) {
                    const newOpt = document.createElement('option');
                    newOpt.value = cleanType;
                    newOpt.textContent = cleanType;
                    e.target.insertBefore(newOpt, e.target.lastElementChild);
                    e.target.value = cleanType;
                }
            } else {
                e.target.value = '';
            }
        }
    });
}

function getTrialBalanceCashInHand(lineId) {
    if (!lineId) return 0;
    const areas = db.lines.filter(l => l.line_no === lineId).map(l => l.area_id);
    const lineLoans = db.loans.filter(l => areas.includes(l.areaId) && !l.deleted);
    const lineLoanIds = lineLoans.map(l => l.id);
    const lineCollections = db.collections.filter(c => lineLoanIds.includes(c.loanId) && !c.deleted);
    const lineExpenses = db.expenses.filter(e => e.line_no === lineId);
    
    const txns = (db.lineTransactions || []).filter(t => t.line_no === lineId);
    const investments = txns.filter(t => t.type === 'invest');
    const totalCapital = investments.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
    const spendings = txns.filter(t => t.type === 'spend');
    const totalSpent = spendings.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
    const totalExpenses = lineExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const totalCollections = lineCollections.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
    const totalPrincipal = lineLoans.reduce((sum, l) => {
        const principal = l.principalAmount !== undefined ? (parseFloat(l.principalAmount) || 0) : (parseFloat(l.loanAmount) || 0);
        return sum + principal;
    }, 0);
    
    return totalCapital + totalCollections - totalPrincipal - totalSpent - totalExpenses;
}

async function handleSetOpeningFloat() {
    const todayStr = new Date().toISOString().substring(0, 10);
    const currentFloatRow = db.dailyFloats.find(f => f.line_no === activeLineId && f.date === todayStr);
    const defaultVal = currentFloatRow ? currentFloatRow.amount : 0;
    
    showPromptModal(
        'Set Opening Cash Float',
        `Enter the opening cash float for Line: <strong>${activeLineId}</strong> today (₹).`,
        defaultVal,
        async (inputVal) => {
            const amount = parseFloat(inputVal);
            const cashInHand = getTrialBalanceCashInHand(activeLineId);
            if (amount > cashInHand) {
                showToast(`Cannot allocate float of ₹${amount.toLocaleString('en-IN')} because the available Trial Balance cash in hand is only ₹${cashInHand.toLocaleString('en-IN')}. Please add investment capital first.`, 'error');
                return;
            }
            
            try {
                await apiFetch('/api/tenant/floats', {
                    method: 'POST',
                    body: JSON.stringify({ line_no: activeLineId, date: todayStr, amount })
                });
                showToast('Opening cash float updated successfully!', 'success');
                await refreshLocalData();
                renderDashboard();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

// ====================================================
// 9. TRIAL BALANCE & CAPITAL CONTROLLERS
// ====================================================
function renderTrialBalanceLogs() {
    const body = document.getElementById('tb-log-body');
    if (!body) return;
    body.innerHTML = '';

    const txns = (db.lineTransactions || []).filter(t => t.line_no === activeLineId);
    if (txns.length === 0) {
        body.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No transaction logs found</td></tr>';
    } else {
        const sortedTxns = [...txns].sort((a, b) => new Date(b.date) - new Date(a.date) || b.id.localeCompare(a.id));
        sortedTxns.forEach(t => {
            const isInvest = t.type === 'invest';
            const badgeClass = isInvest ? 'badge-success' : 'badge-danger';
            const typeLabel = isInvest ? 'Invest' : 'Spend';
            const color = isInvest ? '#10b981' : 'var(--color-danger)';
            const sign = isInvest ? '+' : '-';
            
            body.innerHTML += `
                <tr>
                    <td>${formatDisplayDate(t.date)}</td>
                    <td style="font-weight: 500;">${t.person_name}</td>
                    <td><span class="badge ${badgeClass}">${typeLabel}</span></td>
                    <td style="text-align: right; font-weight: bold; color: ${color};">${sign} ₹${t.amount.toLocaleString('en-IN')}</td>
                    <td style="text-align: right;">
                        <button class="btn btn-secondary btn-icon-only" style="width: 24px; height: 24px; font-size: 10px; border-radius: 4px;" onclick="handleDeleteTransaction('${t.id}')" title="Delete Transaction">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    }
}

function renderTrialBalance() {
    const todayStr = new Date().toISOString().substring(0, 10);
    const txnDate = document.getElementById('txn-date');
    if (txnDate && !txnDate.value) txnDate.value = todayStr;

    const activeAreas = getActiveLineAreas();
    const lineLoans = db.loans.filter(l => activeAreas.includes(l.areaId));
    const lineLoanIds = lineLoans.map(l => l.id);
    const lineCollections = db.collections.filter(c => lineLoanIds.includes(c.loanId));
    const lineExpenses = db.expenses.filter(e => e.line_no === activeLineId);
    
    const txns = (db.lineTransactions || []).filter(t => t.line_no === activeLineId);
    
    const investments = txns.filter(t => t.type === 'invest');
    const investorNames = [...new Set(investments.map(i => i.person_name))];
    const totalCapital = investments.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

    const spendings = txns.filter(t => t.type === 'spend');
    const spenderNames = [...new Set(spendings.map(s => s.person_name))];
    const totalSpent = spendings.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
    
    const totalInterest = lineLoans.reduce((sum, l) => sum + (parseFloat(l.interestAmount) || 0), 0);
    const amountOnLine = lineLoans.reduce((sum, l) => sum + (parseFloat(l.unpaidAmount) || 0), 0);
    const totalExpenses = lineExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const totalCollections = lineCollections.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
    const totalPrincipal = lineLoans.reduce((sum, l) => {
        const principal = l.principalAmount !== undefined ? (parseFloat(l.principalAmount) || 0) : (parseFloat(l.loanAmount) || 0);
        return sum + principal;
    }, 0);
    
    const cashInHand = totalCapital + totalCollections - totalPrincipal - totalSpent - totalExpenses;
    
    const debits = amountOnLine + totalSpent + totalExpenses + cashInHand;
    const credits = totalCapital + totalInterest;

    // Populate stats
    const ecEl = document.getElementById('tb-existing-capital');
    if (ecEl) {
        ecEl.textContent = '₹' + cashInHand.toLocaleString('en-IN');
        if (cashInHand >= 0) {
            ecEl.style.color = '#10b981';
        } else {
            ecEl.style.color = 'var(--color-danger)';
        }
    }
    
    const tcEl = document.getElementById('tb-total-capital');
    if (tcEl) tcEl.textContent = '₹' + totalCapital.toLocaleString('en-IN');
    const aolEl = document.getElementById('tb-amount-on-line');
    if (aolEl) aolEl.textContent = '₹' + amountOnLine.toLocaleString('en-IN');
    const iaEl = document.getElementById('tb-interest-accrued');
    if (iaEl) iaEl.textContent = '₹' + totalInterest.toLocaleString('en-IN');
    
    const dailyYieldTotal = lineLoans.filter(l => l.unpaidAmount > 0).reduce((sum, l) => {
        const days = Math.max(1, (new Date(l.toDate) - new Date(l.fromDate)) / (1000 * 60 * 60 * 24));
        return sum + ((parseFloat(l.interestAmount) || 0) / days);
    }, 0);

    const dyrEl = document.getElementById('tb-daily-yield-rate');
    if (dyrEl) dyrEl.textContent = '₹' + dailyYieldTotal.toFixed(2) + ' / day';
    const alcEl = document.getElementById('tb-active-loans-count');
    if (alcEl) alcEl.textContent = lineLoans.filter(l => l.unpaidAmount > 0).length;
    const tvlEl = document.getElementById('tb-total-value-line');
    if (tvlEl) tvlEl.textContent = '₹' + amountOnLine.toLocaleString('en-IN');
    const ipEl = document.getElementById('tb-interest-portion');
    if (ipEl) ipEl.textContent = '₹' + totalInterest.toLocaleString('en-IN');

    // Balance Status
    const bsEl = document.getElementById('tb-balance-status');
    if (bsEl) {
        if (Math.abs(debits - credits) < 0.05) {
            bsEl.innerHTML = '<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Balanced</span>';
        } else {
            bsEl.innerHTML = '<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Unbalanced</span>';
        }
    }

    // Populate Sheet Table
    const sheetBody = document.getElementById('tb-sheet-body');
    if (sheetBody) {
        let capitalRowsHTML = "";
        if (investorNames.length === 0) {
            capitalRowsHTML += `
                <tr>
                    <td>Capital: (No Partner)</td>
                    <td style="text-align: right; color: var(--text-muted); font-size:12px;">-</td>
                    <td style="text-align: right; font-weight: 600; color: var(--color-success);">₹0.00</td>
                </tr>
            `;
        } else {
            investorNames.sort((a, b) => a.localeCompare(b));
            investorNames.forEach(name => {
                const amt = investments.filter(i => i.person_name === name).reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
                capitalRowsHTML += `
                    <tr>
                        <td>Capital: ${name}</td>
                        <td style="text-align: right; color: var(--text-muted); font-size:12px;">-</td>
                        <td style="text-align: right; font-weight: 600; color: var(--color-success);">₹${amt.toFixed(2)}</td>
                    </tr>
                `;
            });
        }

        let spenderRowsHTML = "";
        if (spenderNames.length > 0) {
            spenderNames.sort((a, b) => a.localeCompare(b));
            spenderNames.forEach(name => {
                const amt = spendings.filter(s => s.person_name === name).reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
                spenderRowsHTML += `
                    <tr>
                        <td>Capital Spent: ${name}</td>
                        <td style="text-align: right; font-weight: 600; color: var(--color-warning);">₹${amt.toFixed(2)}</td>
                        <td style="text-align: right; color: var(--text-muted); font-size:12px;">-</td>
                    </tr>
                `;
            });
        }

        sheetBody.innerHTML = `
            ${capitalRowsHTML}
            <tr>
                <td>Revenue: Interest Accrued</td>
                <td style="text-align: right; color: var(--text-muted); font-size:12px;">-</td>
                <td style="text-align: right; font-weight: 600; color: var(--color-success);">₹${totalInterest.toFixed(2)}</td>
            </tr>
            <tr>
                <td>Assets: Outstanding Loans (Amount on Line)</td>
                <td style="text-align: right; font-weight: 600; color: var(--color-warning);">₹${amountOnLine.toFixed(2)}</td>
                <td style="text-align: right; color: var(--text-muted); font-size:12px;">-</td>
            </tr>
            ${spenderRowsHTML}
            <tr>
                <td>Assets: Cash in Hand (Line Cash Balance)</td>
                <td style="text-align: right; font-weight: 600; color: var(--color-warning);">₹${cashInHand.toFixed(2)}</td>
                <td style="text-align: right; color: var(--text-muted); font-size:12px;">-</td>
            </tr>
            <tr>
                <td>Expenses: Operating Expenses</td>
                <td style="text-align: right; font-weight: 600; color: var(--color-warning);">₹${totalExpenses.toFixed(2)}</td>
                <td style="text-align: right; color: var(--text-muted); font-size:12px;">-</td>
            </tr>
        `;
    }

    const tdEl = document.getElementById('tb-total-debits');
    if (tdEl) tdEl.textContent = '₹' + debits.toFixed(2);
    const tcCreditsEl = document.getElementById('tb-total-credits');
    if (tcCreditsEl) tcCreditsEl.textContent = '₹' + credits.toFixed(2);

    renderTrialBalanceLogs();
}

async function handleSaveTransaction(e) {
    e.preventDefault();
    const type = document.getElementById('txn-type').value;
    const person_name = document.getElementById('txn-person-name').value.trim();
    const amount = parseFloat(document.getElementById('txn-amount').value) || 0;
    const date = document.getElementById('txn-date').value;
    const description = document.getElementById('txn-desc').value.trim();
    
    if (!person_name) {
        showToast('Please enter a name.', 'error');
        return;
    }

    if (type === 'spend') {
        const cashInHand = getTrialBalanceCashInHand(activeLineId);
        if (amount > cashInHand) {
            showToast(`Cannot record spending of ₹${amount.toLocaleString('en-IN')} because the available Trial Balance cash in hand is only ₹${cashInHand.toLocaleString('en-IN')}.`, 'error');
            return;
        }
    }

    try {
        await apiFetch('/api/tenant/line-transactions', {
            method: 'POST',
            body: JSON.stringify({ type, person_name, amount, description, date, line_no: activeLineId })
        });
        showToast('Transaction recorded successfully!', 'success');
        document.getElementById('tb-transaction-form').reset();
        document.getElementById('txn-date').value = date;
        
        await refreshLocalData();
        renderTrialBalance();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleDeleteTransaction(id) {
    showConfirmModal(
        'Delete Transaction Entry',
        'Are you sure you want to delete this transaction entry? This action cannot be undone.',
        async () => {
            try {
                await apiFetch(`/api/tenant/line-transactions/${id}`, {
                    method: 'DELETE'
                });
                showToast('Transaction deleted successfully!', 'success');
                await refreshLocalData();
                renderTrialBalance();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    );
}

function printTrialBalance() {
    const todayStr = new Date().toISOString().substring(0, 10);
    const activeAreas = getActiveLineAreas();
    
    const lineLoans = db.loans.filter(l => activeAreas.includes(l.areaId));
    const lineLoanIds = lineLoans.map(l => l.id);
    const lineCollections = db.collections.filter(c => lineLoanIds.includes(c.loanId));
    const lineExpenses = db.expenses.filter(e => e.line_no === activeLineId);
    
    const txns = (db.lineTransactions || []).filter(t => t.line_no === activeLineId);
    
    const investments = txns.filter(t => t.type === 'invest');
    const investorNames = [...new Set(investments.map(i => i.person_name))];
    const totalCapital = investments.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

    const spendings = txns.filter(t => t.type === 'spend');
    const spenderNames = [...new Set(spendings.map(s => s.person_name))];
    const totalSpent = spendings.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
    
    const totalInterest = lineLoans.reduce((sum, l) => sum + (parseFloat(l.interestAmount) || 0), 0);
    const amountOnLine = lineLoans.reduce((sum, l) => sum + (parseFloat(l.unpaidAmount) || 0), 0);
    const totalExpenses = lineExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const totalCollections = lineCollections.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
    const totalPrincipal = lineLoans.reduce((sum, l) => {
        const principal = l.principalAmount !== undefined ? (parseFloat(l.principalAmount) || 0) : (parseFloat(l.loanAmount) || 0);
        return sum + principal;
    }, 0);
    
    const cashInHand = totalCapital + totalCollections - totalPrincipal - totalSpent - totalExpenses;
    
    const debits = amountOnLine + totalSpent + totalExpenses + cashInHand;
    const credits = totalCapital + totalInterest;

    let printCapitalRowsHTML = "";
    if (investorNames.length === 0) {
        printCapitalRowsHTML += `
            <tr>
                <td style="padding:4px 0;">Capital: (No Partner)</td>
                <td style="text-align:right; padding:4px 0;">-</td>
                <td style="text-align:right; padding:4px 0;">₹0.00</td>
            </tr>
        `;
    } else {
        investorNames.sort((a, b) => a.localeCompare(b));
        investorNames.forEach(name => {
            const amt = investments.filter(i => i.person_name === name).reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
            printCapitalRowsHTML += `
                <tr>
                    <td style="padding:4px 0;">Capital: ${name}</td>
                    <td style="text-align:right; padding:4px 0;">-</td>
                    <td style="text-align:right; padding:4px 0;">₹${amt.toFixed(2)}</td>
                </tr>
            `;
        });
    }

    let printSpenderRowsHTML = "";
    if (spenderNames.length > 0) {
        spenderNames.sort((a, b) => a.localeCompare(b));
        spenderNames.forEach(name => {
            const amt = spendings.filter(s => s.person_name === name).reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
            printSpenderRowsHTML += `
                <tr>
                    <td style="padding:4px 0;">Capital Spent: ${name}</td>
                    <td style="text-align:right; padding:4px 0;">₹${amt.toFixed(2)}</td>
                    <td style="text-align:right; padding:4px 0;">-</td>
                </tr>
            `;
        });
    }
    
    const receipt = document.getElementById('print-receipt-slip');
    receipt.innerHTML = `
        <div class="print-header" style="text-align:center;">
            <h2 style="font-size:15px; margin:0; font-family:monospace; font-weight:bold;">${(activeUser.companyName || 'TERRASOL FINSERV').toUpperCase()}</h2>
            <p style="font-size:11px; margin:3px 0; font-family:monospace; font-weight:bold;">TRIAL BALANCE SHEET</p>
            <p style="font-size:10px; margin:0; font-family:monospace;">Line Route: ${activeLineId || 'All'}</p>
        </div>
        <hr style="border-top:1px dashed #000; margin:10px 0;">
        <table style="width:100%; font-size:10px; border-collapse:collapse; text-align:left; font-family:monospace;">
            <thead>
                <tr style="border-bottom:1px solid #000;">
                    <th style="padding-bottom:4px;">Account Description</th>
                    <th style="padding-bottom:4px; text-align:right; width:25%;">Debit</th>
                    <th style="padding-bottom:4px; text-align:right; width:25%;">Credit</th>
                </tr>
            </thead>
            <tbody>
                ${printCapitalRowsHTML}
                <tr>
                    <td style="padding:4px 0;">Revenue: Interest</td>
                    <td style="text-align:right; padding:4px 0;">-</td>
                    <td style="text-align:right; padding:4px 0;">₹${totalInterest.toFixed(2)}</td>
                </tr>
                <tr>
                    <td style="padding:4px 0;">Assets: Loans on Line</td>
                    <td style="text-align:right; padding:4px 0;">₹${amountOnLine.toFixed(2)}</td>
                    <td style="text-align:right; padding:4px 0;">-</td>
                </tr>
                ${printSpenderRowsHTML}
                <tr>
                    <td style="padding:4px 0;">Assets: Cash in Hand</td>
                    <td style="text-align:right; padding:4px 0;">₹${cashInHand.toFixed(2)}</td>
                    <td style="text-align:right; padding:4px 0;">-</td>
                </tr>
                <tr>
                    <td style="padding:4px 0;">Expenses: Operating</td>
                    <td style="text-align:right; padding:4px 0;">₹${totalExpenses.toFixed(2)}</td>
                    <td style="text-align:right; padding:4px 0;">-</td>
                </tr>
            </tbody>
        </table>
        <hr style="border-top:1px dashed #000; margin:10px 0;">
        <table style="width:100%; font-size:10px; font-weight:bold; font-family:monospace;">
            <tr>
                <td>Trial Balance Total:</td>
                <td style="text-align:right;">Dr. ₹${debits.toFixed(2)}</td>
            </tr>
            <tr>
                <td></td>
                <td style="text-align:right;">Cr. ₹${credits.toFixed(2)}</td>
            </tr>
        </table>
        <hr style="border-top:1px dashed #000; margin:10px 0;">
        <div style="text-align:center; font-size:8px; font-family:monospace; margin-top:10px;">
            <p style="margin:2px 0;">Status: BALANCED (Accrual Complete)</p>
            <p style="margin:2px 0;">Printed on: ${new Date().toLocaleString()}</p>
        </div>
    `;
    
    document.body.classList.add('print-receipt-mode');
    window.print();
    document.body.classList.remove('print-receipt-mode');
}

// PWA Installation helper logic
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installSection = document.getElementById('pwa-install-section');
    if (installSection) {
        installSection.style.display = 'block';
    }
});

const installBtn = document.getElementById('btn-pwa-install');
if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        deferredPrompt = null;
        const installSection = document.getElementById('pwa-install-section');
        if (installSection) {
            installSection.style.display = 'none';
        }
    });
}

window.addEventListener('appinstalled', (event) => {
    console.log('Terrasol FinServ was installed successfully.');
    const installSection = document.getElementById('pwa-install-section');
    if (installSection) {
        installSection.style.display = 'none';
    }
});

// ==========================================================
// DYNAMIC THEME SYSTEM, EASTER EGGS, & RADIO AUDIO ENGINE
// ==========================================================

// Web Audio API Walkie-Talkie Radio Squelch Synthesizer
function playRadioSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        // 1. Radio Beep
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.07);
        
        oscGain.gain.setValueAtTime(0.08, ctx.currentTime);
        oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        
        osc.connect(oscGain);
        oscGain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
        
        // 2. Radio Squelch White Noise Burst
        const bufferSize = ctx.sampleRate * 0.22;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1100;
        filter.Q.value = 1.8;
        
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0, ctx.currentTime);
        noiseGain.gain.linearRampToValueAtTime(0.035, ctx.currentTime + 0.04);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        
        noise.start(ctx.currentTime + 0.02);
        noise.stop(ctx.currentTime + 0.22);
    } catch (err) {
        console.warn('Web Audio API not supported or user gesture needed:', err);
    }
}

// Dialogues lists for different themes
const dialoguesNormal = [
    { speaker: "Audit Officer", text: "Henry, this is Audit Station 3. Please reconcile the collections sheet. Over.", avatar: "A" },
    { speaker: "Henry", text: "Reconciling now. All balances look matched. Over.", avatar: "H" },
    { speaker: "Audit Officer", text: "Ensure interest rates comply with local regulations. Over.", avatar: "A" },
    { speaker: "Henry", text: "Copy that. Staying compliant. Out.", avatar: "H" }
];

const dialoguesRoyalGold = [
    { speaker: "Grand Vizier", text: "Henry? Is the Royal Treasury secure? We must ensure the gold reserves are accounted for. Over.", avatar: "👑" },
    { speaker: "Royal Treasurer", text: "Rest assured, Vizier. The vaults are overflowing and every coin is accounted for. Over.", avatar: "🛡️" },
    { speaker: "Grand Vizier", text: "Splendid. Let the kingdom know the ledger is balanced. Over.", avatar: "👑" },
    { speaker: "Royal Treasurer", text: "Long live the King. Out.", avatar: "🛡️" }
];

const dialoguesRoyalCrimson = [
    { speaker: "Chancellor", text: "Henry? Is the Crimson Vault secure? The gold reserves must be ready. Over.", avatar: "👑" },
    { speaker: "Royal Scribe", text: "Reconciliation complete, Chancellor. The ledgers match perfectly. Over.", avatar: "✒️" },
    { speaker: "Chancellor", text: "Magnificent. Let the kingdom celebrate. Out.", avatar: "👑" }
];

let activeDialogues = dialoguesNormal;
let currentDialogueIndex = 0;

// Connect elements and listeners
const walkieTalkieBtn = document.getElementById('walkie-talkie-btn');
const radioPopup = document.getElementById('radio-popup');
const closeRadioBtn = document.getElementById('close-radio-btn');
const radioText = document.getElementById('radio-text');
const radioSpeaker = document.getElementById('radio-speaker');
const radioAvatar = document.getElementById('radio-avatar');

if (walkieTalkieBtn && radioPopup) {
    walkieTalkieBtn.addEventListener('click', () => {
        playRadioSound();
        radioPopup.style.display = 'block';
        
        const diag = activeDialogues[currentDialogueIndex];
        radioText.innerText = `"${diag.text}"`;
        radioSpeaker.innerText = diag.speaker;
        radioAvatar.innerText = diag.avatar;
        
        if (diag.speaker === "Grand Vizier" || diag.speaker === "Chancellor") {
            if (currentTheme === 'royal-gold') {
                radioAvatar.style.background = "linear-gradient(135deg, #ffd700, #8a2be2)";
            } else if (currentTheme === 'royal-crimson') {
                radioAvatar.style.background = "linear-gradient(135deg, #ffd700, #800020)";
            } else {
                radioAvatar.style.background = "linear-gradient(135deg, var(--color-primary), var(--color-secondary))";
            }
        } else if (diag.speaker === "Audit Officer") {
            radioAvatar.style.background = "linear-gradient(135deg, #7c3aed, #a78bfa)";
        } else {
            if (currentTheme === 'royal-gold') {
                radioAvatar.style.background = "linear-gradient(135deg, #8a2be2, #0c0b16)";
            } else if (currentTheme === 'royal-crimson') {
                radioAvatar.style.background = "linear-gradient(135deg, #800020, #14050a)";
            } else {
                radioAvatar.style.background = "linear-gradient(135deg, #2b3a55, #3b82f6)";
            }
        }
        
        currentDialogueIndex = (currentDialogueIndex + 1) % activeDialogues.length;
    });
}

if (closeRadioBtn && radioPopup) {
    closeRadioBtn.addEventListener('click', () => {
        radioPopup.style.display = 'none';
    });
}

// Particle System Canvas
const leavesCanvas = document.getElementById('leaves-canvas');
let particlesActive = false;
let activeParticleType = 'none';
let particlesArray = [];

class LeafParticle {
    constructor(w, h) {
        this.x = Math.random() * w;
        this.y = -20 - Math.random() * 50;
        this.size = Math.random() * 14 + 6;
        this.speedX = Math.random() * 1.5 - 0.3;
        this.speedY = Math.random() * 2.2 + 0.8;
        this.rotation = Math.random() * 360;
        this.rotationSpeed = Math.random() * 2.5 - 1.25;
        const colors = currentTheme === 'royal-crimson'
            ? ['#ffd700', '#d4af37', '#800020', '#a30029', '#ffe3eb']
            : (currentTheme === 'royal-gold'
                ? ['#ffd700', '#d4af37', '#8a2be2', '#4b0082', '#f3e5ab']
                : ['#e25b38', '#f68b55', '#febb60', '#8b3a47', '#bc4d54']);
        this.color = colors[Math.floor(Math.random() * colors.length)];
    }
    update(w, h) {
        this.x += this.speedX + Math.sin(this.y / 25) * 0.4;
        this.y += this.speedY;
        this.rotation += this.rotationSpeed;
        if (this.y > h + 20) {
            this.y = -20;
            this.x = Math.random() * w;
        }
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.moveTo(0, -this.size / 2);
        ctx.quadraticCurveTo(this.size / 2, 0, 0, this.size / 2);
        ctx.quadraticCurveTo(-this.size / 2, 0, 0, -this.size / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

class SnowParticle {
    constructor(w, h) {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.radius = Math.random() * 3.5 + 1.2;
        this.speedY = Math.random() * 1.6 + 0.6;
        this.speedX = Math.random() * 1.2 - 0.6;
    }
    update(w, h) {
        this.y += this.speedY;
        this.x += this.speedX + Math.sin(this.y / 30) * 0.3;
        if (this.y > h + 10) {
            this.y = -10;
            this.x = Math.random() * w;
        }
    }
    draw(ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
        ctx.shadowBlur = 4;
        ctx.shadowColor = "#ffffff";
        ctx.fill();
        ctx.restore();
    }
}

class BatParticle {
    constructor(w, h) {
        this.x = Math.random() * w;
        this.y = h + Math.random() * 100;
        this.size = Math.random() * 16 + 8;
        this.speedX = Math.random() * 2 - 1;
        this.speedY = -(Math.random() * 2 + 1);
        this.wingAngle = Math.random() * 10;
        this.wingSpeed = Math.random() * 0.2 + 0.1;
    }
    update(w, h) {
        this.x += this.speedX + Math.sin(this.y / 20) * 0.5;
        this.y += this.speedY;
        this.wingAngle += this.wingSpeed;
        if (this.y < -20) {
            this.y = h + 20;
            this.x = Math.random() * w;
            this.speedY = -(Math.random() * 2 + 1);
        }
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.fillStyle = "#1e0b24";
        ctx.strokeStyle = "#ba0c2f";
        ctx.lineWidth = 1.2;
        
        const f = Math.sin(this.wingAngle) * (this.size / 2);
        
        ctx.beginPath();
        ctx.moveTo(0, -this.size/4);
        ctx.lineTo(-this.size/2, -this.size/2 + f);
        ctx.quadraticCurveTo(-this.size/4, -this.size/8, 0, 0);
        ctx.quadraticCurveTo(this.size/4, -this.size/8, this.size/2, -this.size/2 + f);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();
    }
}

class RainParticle {
    constructor(w, h) {
        this.x = Math.random() * w;
        this.y = Math.random() * h - h;
        this.length = Math.random() * 18 + 12;
        this.speedY = Math.random() * 8 + 8;
        this.speedX = -(Math.random() * 2 + 1);
        this.opacity = Math.random() * 0.35 + 0.15;
    }
    update(w, h) {
        this.y += this.speedY;
        this.x += this.speedX;
        if (this.y > h + 20 || this.x < -20) {
            this.y = -40;
            this.x = Math.random() * (w + 100);
            this.speedY = Math.random() * 8 + 8;
        }
    }
    draw(ctx) {
        ctx.save();
        ctx.strokeStyle = `rgba(174, 219, 255, ${this.opacity})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x + this.speedX * 0.8, this.y + this.length);
        ctx.stroke();
        ctx.restore();
    }
}

// Resize handler for particles canvas
function handleCanvasResize() {
    if (leavesCanvas) {
        leavesCanvas.width = window.innerWidth;
        leavesCanvas.height = window.innerHeight;
    }
}

// Debounced version of canvas resize for high efficiency
let resizeTimeout;
function handleCanvasResizeDebounced() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        handleCanvasResize();
    }, 150);
}
window.addEventListener('resize', handleCanvasResizeDebounced);

function initParticles(type) {
    if (!leavesCanvas) return;
    const ctx = leavesCanvas.getContext('2d');
    
    handleCanvasResize(); // set initial size
    
    particlesArray = [];
    const count = type === 'snow' ? 60 : (type === 'bats' ? 20 : (type === 'rain' ? 80 : 30));
    for (let i = 0; i < count; i++) {
        if (type === 'snow') {
            particlesArray.push(new SnowParticle(leavesCanvas.width, leavesCanvas.height));
        } else if (type === 'bats') {
            particlesArray.push(new BatParticle(leavesCanvas.width, leavesCanvas.height));
        } else if (type === 'rain') {
            particlesArray.push(new RainParticle(leavesCanvas.width, leavesCanvas.height));
        } else {
            particlesArray.push(new LeafParticle(leavesCanvas.width, leavesCanvas.height));
        }
    }
    
    function animate() {
        if (!particlesActive || activeParticleType !== type || document.hidden) {
            return;
        }
        ctx.clearRect(0, 0, leavesCanvas.width, leavesCanvas.height);
        for (let i = 0; i < particlesArray.length; i++) {
            particlesArray[i].update(leavesCanvas.width, leavesCanvas.height);
            particlesArray[i].draw(ctx);
        }
        requestAnimationFrame(animate);
    }
    animate();
}

// Global page visibility handler to resume particles
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && particlesActive && activeParticleType !== 'none') {
        initParticles(activeParticleType);
    }
});

function startParticles(type) {
    if (!leavesCanvas) return;
    activeParticleType = type;
    if (type === 'none') {
        particlesActive = false;
        leavesCanvas.style.display = 'none';
        const ctx = leavesCanvas.getContext('2d');
        ctx.clearRect(0, 0, leavesCanvas.width, leavesCanvas.height);
    } else {
        particlesActive = true;
        leavesCanvas.style.display = 'block';
        initParticles(type);
    }
}

// Theme Switcher Coordinator
let currentTheme = 'normal';
let isCrimsonThemeUnlocked = localStorage.getItem('tsfs_crimson_theme_unlocked') === 'true';

function switchTheme(themeName) {
    if (themeName === currentTheme) return;
    currentTheme = themeName;
    
    // 1. Update body classes
    document.body.classList.remove('theme-royal-gold', 'theme-royal-crimson');
    if (themeName !== 'normal') {
        document.body.classList.add('theme-' + themeName);
    }
    
    // 2. Adjust particle systems
    if (themeName === 'royal-gold') {
        startParticles('leaves');
        activeDialogues = dialoguesRoyalGold;
    } else if (themeName === 'royal-crimson') {
        startParticles('leaves');
        activeDialogues = dialoguesRoyalCrimson;
    } else {
        startParticles('none');
        activeDialogues = dialoguesNormal;
    }
    currentDialogueIndex = 0;
    
    // 3. Update Lookout Status Widget text dynamically
    const wTitle = document.getElementById('widget-title');
    const wPost = document.getElementById('widget-post');
    const wThreatLabel = document.getElementById('widget-threat-label');
    const wThreat = document.getElementById('widget-threat');
    const wRadio = document.getElementById('widget-radio');
    const wHenryLabel = document.getElementById('widget-henry-label');
    const wHenry = document.getElementById('widget-henry');
    
    if (wTitle) {
        if (themeName === 'royal-gold') {
            wTitle.innerText = "👑 Royal Treasury Status";
        } else if (themeName === 'royal-crimson') {
            wTitle.innerText = "👑 Crimson Treasury Status";
        } else {
            wTitle.innerText = "Tower 2 - Two Forks";
        }
    }
    
    console.log(`Theme switched to: ${themeName}`);
}

function cycleTheme() {
    playRadioSound();
    if (currentTheme === 'normal') {
        switchTheme('royal-gold');
    } else if (currentTheme === 'royal-gold') {
        if (isCrimsonThemeUnlocked) {
            switchTheme('royal-crimson');
        } else {
            switchTheme('normal');
        }
    } else {
        switchTheme('normal');
    }
}

// Bind dblclick to logo elements
const logoElements = document.querySelectorAll('.terrasol-logo');
logoElements.forEach(logo => {
    logo.addEventListener('dblclick', () => {
        cycleTheme();
    });
});

// Keyboard secret triggers
let typedBuffer = "";
window.addEventListener('keydown', (e) => {
    typedBuffer += e.key.toLowerCase();
    if (typedBuffer.length > 20) {
        typedBuffer = typedBuffer.substring(typedBuffer.length - 20);
    }
    
    if (typedBuffer.endsWith('normal') || typedBuffer.endsWith('default') || typedBuffer.endsWith('reset')) {
        playRadioSound();
        switchTheme('normal');
        typedBuffer = "";
    } else if (typedBuffer.endsWith('royal') || typedBuffer.endsWith('gold') || typedBuffer.endsWith('royal-gold')) {
        playRadioSound();
        switchTheme('royal-gold');
        typedBuffer = "";
    } else if (typedBuffer.endsWith('crimson') || typedBuffer.endsWith('perfection')) {
        typedBuffer = "";
        if (!isCrimsonThemeUnlocked) {
            isCrimsonThemeUnlocked = true;
            localStorage.setItem('tsfs_crimson_theme_unlocked', 'true');
            showToast("👑 Royal Crimson Theme Unlocked!", "success");
        }
        playRadioSound();
        switchTheme('royal-crimson');
    }
});

// Subscription billing action bindings
document.addEventListener('DOMContentLoaded', () => {
    const btnSimulate = document.getElementById('btn-simulate-payment');
    const btnStripe = document.getElementById('btn-stripe-checkout');
    
    if (btnSimulate) {
        btnSimulate.addEventListener('click', async () => {
            if (!activeUser) {
                showToast('Please log in first to renew.', 'danger');
                return;
            }
            
            btnSimulate.disabled = true;
            btnSimulate.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Triggering Stripe Webhook...`;
            
            try {
                const res = await apiFetch('/api/billing/mock-webhook', {
                    method: 'POST',
                    body: JSON.stringify({
                        username: activeUser.username,
                        months: 1
                    })
                });
                showToast(res.message, 'success');
                hideBillingPage();
                refreshLocalData();
            } catch (err) {
                showToast('Simulated payment failed: ' + err.message, 'danger');
            } finally {
                btnSimulate.disabled = false;
                btnSimulate.innerHTML = `<i class="fa-solid fa-flask"></i> Simulate Stripe Webhook (Renew 1 Mo)`;
            }
        });
    }
    
    if (btnStripe) {
        btnStripe.addEventListener('click', () => {
            showToast('Redirecting securely to Stripe checkout screen...', 'success');
        });
    }
});

// ==========================================
// MENTOR ENTERPRISE SUITE MODULE
// ==========================================
let currentMentorLine = 1;
let currentMentorFolder = 'New';
let mentorScanData = null;
let rapidAudioEnabled = true;
let rapidSessionRecords = [];
let activeRapidLoanee = null;
let currentDueReportData = [];
let currentReportTab = 'due-list';
let currentPassbookText = "";

function playMentorChime() {
    if (!rapidAudioEnabled) return;
    try {
        const audio = new Audio('sounds/Bells.wav');
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {
                playFallbackChime();
            });
        }
    } catch (err) {
        playFallbackChime();
    }
}

function playFallbackChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } catch(e) {}
}

function updateHeaderLineDropdown(lines = []) {
    const select = document.getElementById('header-quick-line-select');
    if (!select) return;
    
    let html = `<option value="">-- Quick Line --</option>`;
    lines.forEach(l => {
        const isSel = String(l.lineNo) === String(currentMentorLine);
        html += `<option value="${l.lineNo}" ${isSel ? 'selected' : ''}>Line ${l.lineNo} (${l.folder || 'New'}${l.borrowersCount ? ' - ' + l.borrowersCount + ' acc' : ''})</option>`;
    });
    select.innerHTML = html;
}

async function renderMentorCenter() {
    const statusText = document.getElementById('mentor-status-text');
    const activeStat = document.getElementById('mentor-stat-active-count');
    const archivedStat = document.getElementById('mentor-stat-archived-count');
    const loansStat = document.getElementById('mentor-stat-total-loans');
    const grid = document.getElementById('mentor-lines-grid');
    
    if (grid) {
        grid.innerHTML = `
            <div class="glass-card" style="text-align: center; padding: 40px; color: var(--text-muted); grid-column: 1 / -1;">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 28px; margin-bottom: 12px; color: var(--color-primary);"></i>
                <p>Scanning TDATA line databases (Active & Archive)...</p>
            </div>
        `;
    }
    
    try {
        const data = await apiFetch('/api/tenant/mentor/scan');
        mentorScanData = data;
        
        if (activeStat) activeStat.textContent = (data.activeBooks || []).length;
        if (archivedStat) archivedStat.textContent = (data.archivedBooks || []).length;
        
        const totalLoansCount = (data.activeBooks || []).reduce((sum, b) => sum + (b.borrowersCount || 0), 0);
        if (loansStat) loansStat.textContent = totalLoansCount.toLocaleString('en-IN');
        if (statusText) statusText.textContent = `Connected: ${data.activeBooks.length} Active Books, ${data.archivedBooks.length} Archived Books, ${data.villagesCount || 0} Villages mapped.`;
        
        const allBooks = [...(data.activeBooks || []), ...(data.archivedBooks || [])];
        updateHeaderLineDropdown(allBooks);
        
        renderMentorGrid(currentMentorFolder);
    } catch (err) {
        console.error('Failed to scan mentor books:', err);
        if (statusText) statusText.textContent = `Scan failed: ${err.message}`;
        if (grid) {
            grid.innerHTML = `
                <div class="glass-card" style="text-align: center; padding: 30px; color: var(--color-danger); grid-column: 1 / -1;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 32px; margin-bottom: 12px;"></i>
                    <p style="font-weight: 700;">Could not scan Mentor TDATA: ${err.message}</p>
                    <button class="btn btn-primary btn-sm" onclick="renderMentorCenter()" style="margin-top: 10px;">Retry Scan</button>
                </div>
            `;
        }
    }
}

function renderMentorGrid(folder = 'New') {
    const grid = document.getElementById('mentor-lines-grid');
    if (!grid || !mentorScanData) return;
    
    const books = folder === 'New' ? (mentorScanData.activeBooks || []) : (mentorScanData.archivedBooks || []);
    
    if (books.length === 0) {
        grid.innerHTML = `
            <div class="glass-card" style="text-align: center; padding: 40px; color: var(--text-muted); grid-column: 1 / -1;">
                <i class="fa-solid fa-box-open" style="font-size: 32px; margin-bottom: 12px;"></i>
                <p>No line books found in TDATA\\${folder}.</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = books.map(book => {
        const isActiveCurrent = String(book.lineNo) === String(currentMentorLine) && (book.folder || 'New') === currentMentorFolder;
        const bamt = book.totalBamt || 0;
        const amt = book.totalAmt || 0;
        const pamt = amt - bamt;
        const recoveryRate = amt > 0 ? Math.round((pamt / amt) * 100) : 0;
        
        return `
            <div class="glass-card mentor-line-card ${isActiveCurrent ? 'line-card-active' : ''}" style="padding: 18px; display: flex; flex-direction: column; justify-content: space-between; border-left: 4px solid ${isActiveCurrent ? 'var(--color-primary)' : 'var(--border-color)'};">
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(226, 91, 56, 0.12); display: flex; align-items: center; justify-content: center; color: var(--color-primary); font-weight: 900; font-size: 15px;">
                                ${book.lineNo}
                            </div>
                            <div>
                                <h4 style="font-size: 14px; font-weight: 800; margin: 0; color: var(--text-dark);">${book.lineTitle || ('Line Book ' + book.lineNo)}</h4>
                                <span style="font-size: 11px; color: var(--text-muted);">${book.folder || 'New'} · ${book.fileSizeKB || 0} KB</span>
                            </div>
                        </div>
                        <span class="badge ${book.folder === 'New' ? 'badge-primary' : 'badge-secondary'}" style="font-size: 10px;">
                            ${book.folder === 'New' ? 'Active' : 'Archived'}
                        </span>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; background: var(--bg-main); padding: 10px; border-radius: 8px; margin-bottom: 12px;">
                        <div>
                            <span style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); display: block;">Accounts</span>
                            <strong style="font-size: 14px; color: var(--text-dark);">${book.borrowersCount || 0}</strong>
                        </div>
                        <div>
                            <span style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); display: block;">Outstanding</span>
                            <strong style="font-size: 14px; color: var(--color-danger);">₹${(book.totalBamt || 0).toLocaleString('en-IN')}</strong>
                        </div>
                        <div>
                            <span style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); display: block;">Disbursed</span>
                            <strong style="font-size: 12px; color: var(--text-muted);">₹${(book.totalAmt || 0).toLocaleString('en-IN')}</strong>
                        </div>
                        <div>
                            <span style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); display: block;">Recovery</span>
                            <strong style="font-size: 12px; color: var(--color-success);">${recoveryRate}%</strong>
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 6px; margin-top: 10px;">
                    <button type="button" class="btn btn-wood btn-sm" onclick="selectAndWorkLine(${book.lineNo}, '${book.folder || 'New'}')" style="flex: 1; padding: 6px 8px; font-size: 11px;">
                        <i class="fa-solid fa-bolt"></i> Work Line
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="importMentorLine(${book.lineNo}, '${book.folder || 'New'}', this)" style="padding: 6px 10px; font-size: 11px;" title="Re-import from MDB">
                        <i class="fa-solid fa-cloud-arrow-down"></i> Sync
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="exportMentorLine(${book.lineNo}, '${book.folder || 'New'}', this)" style="padding: 6px 10px; font-size: 11px;" title="Export back to MDB for MAL.EXE">
                        <i class="fa-solid fa-floppy-disk"></i> Export
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function selectAndWorkLine(lineNo, folder = 'New') {
    currentMentorLine = lineNo;
    currentMentorFolder = folder;
    
    const select = document.getElementById('header-quick-line-select');
    if (select) select.value = String(lineNo);
    
    showToast(`Switched to Line ${lineNo} (${folder})`, 'info');
    switchView('rapid-posting');
}

async function importMentorLine(lineNo, folder = 'New', btn = null) {
    let originalHtml = '';
    if (btn) {
        originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    }
    showToast(`Synchronizing Line ${lineNo} (${folder}) from MDB...`, 'info');
    
    try {
        const res = await apiFetch('/api/tenant/mentor/import-line', {
            method: 'POST',
            body: JSON.stringify({ lineNo, folder })
        });
        
        showToast(res.message || `Line ${lineNo} successfully synced!`, 'success');
        await refreshLocalData();
        if (currentView === 'mentor-center') {
            renderMentorCenter();
        } else if (currentView === 'rapid-posting') {
            renderRapidPosting();
        } else if (currentView === 'due-reports') {
            renderDueReports();
        }
    } catch (err) {
        console.error('Import line error:', err);
        showToast(`Failed to import Line ${lineNo}: ${err.message}`, 'danger');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

async function exportMentorLine(lineNo, folder = 'New', btn = null) {
    let originalHtml = '';
    if (btn) {
        originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    }
    showToast(`Exporting Line ${lineNo} to TDATA\\${folder}\\${lineNo}.MDB for MAL.EXE...`, 'info');
    
    try {
        const res = await apiFetch('/api/tenant/mentor/export-line', {
            method: 'POST',
            body: JSON.stringify({ lineNo, folder })
        });
        
        showToast(res.message || `Line ${lineNo} exported successfully to MDB!`, 'success');
    } catch (err) {
        console.error('Export line error:', err);
        showToast(`Failed to export Line ${lineNo}: ${err.message}`, 'danger');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

function renderRapidPosting() {
    const lineLabel = document.getElementById('rapid-active-line-label');
    const folderLabel = document.getElementById('rapid-active-folder-label');
    const dateInput = document.getElementById('rapid-date-input');
    const anoInput = document.getElementById('rapid-ano-input');
    
    if (lineLabel) lineLabel.textContent = `Line ${currentMentorLine}`;
    if (folderLabel) folderLabel.textContent = `${currentMentorFolder === 'New' ? 'Active (New)' : 'Archived (OLD)'}`;
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }
    
    updateRapidSessionTally();
    renderRapidSessionTable();
    
    if (anoInput) {
        setTimeout(() => anoInput.focus(), 150);
    }
}

function updateRapidSessionTally() {
    const totalEl = document.getElementById('rapid-session-total');
    const countEl = document.getElementById('rapid-session-count');
    const avgEl = document.getElementById('rapid-session-avg');
    
    const count = rapidSessionRecords.length;
    const total = rapidSessionRecords.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const avg = count > 0 ? Math.round(total / count) : 0;
    
    if (totalEl) totalEl.textContent = `₹${total.toLocaleString('en-IN')}`;
    if (countEl) countEl.textContent = count;
    if (avgEl) avgEl.textContent = `₹${avg.toLocaleString('en-IN')}`;
}

function renderRapidSessionTable() {
    const tbody = document.getElementById('rapid-session-table-body');
    if (!tbody) return;
    
    if (rapidSessionRecords.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px 10px;">
                    Type an account number on the left and hit Enter to post collections rapidly.
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = rapidSessionRecords.map((r, i) => `
        <tr>
            <td style="font-weight: 700; color: var(--text-muted);">${i + 1}</td>
            <td><strong style="color: var(--color-primary);">${r.borrowerNo || '--'}</strong></td>
            <td style="font-weight: 600;">${r.borrowerName || 'Member'}</td>
            <td><strong style="color: var(--color-success);">₹${Number(r.amount).toLocaleString('en-IN')}</strong></td>
            <td style="font-size: 11px; color: var(--text-muted);">${r.time || ''}</td>
            <td>
                <button type="button" class="btn btn-secondary btn-sm" onclick="openPassbookModal('${r.loanId}')" style="padding: 2px 6px; font-size: 10px;" title="View ACC.txt">
                    <i class="fa-solid fa-receipt"></i> ACC
                </button>
            </td>
        </tr>
    `).join('');
}

function findLoanByAno(anoRaw) {
    if (!anoRaw) return null;
    const searchStr = String(anoRaw).trim().toUpperCase();
    
    let candidates = db.loans.filter(l => String(l.line_no) === String(currentMentorLine));
    if (candidates.length === 0) {
        candidates = db.loans;
    }
    
    let match = candidates.find(l => String(l.borrowerNo || '').toUpperCase() === searchStr);
    if (match) return match;
    
    match = candidates.find(l => String(l.loanId || '').toUpperCase() === searchStr || String(l.id || '').toUpperCase() === searchStr);
    if (match) return match;
    
    match = candidates.find(l => (l.borrowerName || '').toUpperCase().includes(searchStr));
    return match || null;
}

function displayLoaneeSnapshot(loan) {
    const card = document.getElementById('rapid-loanee-card');
    const nameEl = document.getElementById('rapid-card-name');
    const vilEl = document.getElementById('rapid-card-village');
    const statusBadge = document.getElementById('rapid-card-status-badge');
    const loanAmtEl = document.getElementById('rapid-card-loan-amt');
    const paidAmtEl = document.getElementById('rapid-card-paid-amt');
    const balanceAmtEl = document.getElementById('rapid-card-balance-amt');
    const amountInput = document.getElementById('rapid-amount-input');
    
    if (!card) return;
    
    if (!loan) {
        card.style.display = 'none';
        activeRapidLoanee = null;
        return;
    }
    
    activeRapidLoanee = loan;
    card.style.display = 'block';
    
    if (nameEl) nameEl.textContent = `${loan.borrowerName || 'Member'} (${loan.borrowerNo || loan.loanId})`;
    if (vilEl) vilEl.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${loan.village || loan.areaName || 'General'}`;
    
    const unpaid = Number(loan.unpaidAmount) || 0;
    const paid = Number(loan.paidAmount) || 0;
    const amt = Number(loan.loanAmount) || 0;
    
    if (loanAmtEl) loanAmtEl.textContent = `₹${amt.toLocaleString('en-IN')}`;
    if (paidAmtEl) paidAmtEl.textContent = `₹${paid.toLocaleString('en-IN')}`;
    if (balanceAmtEl) balanceAmtEl.textContent = `₹${unpaid.toLocaleString('en-IN')}`;
    
    if (statusBadge) {
        if (unpaid <= 0) {
            statusBadge.className = 'badge badge-secondary';
            statusBadge.textContent = 'Settled';
        } else {
            statusBadge.className = 'badge badge-success';
            statusBadge.textContent = 'Active';
        }
    }
    
    if (amountInput) {
        const da = Number(loan.installmentAmount) || 0;
        const suggestedAmount = (unpaid > 0 && unpaid < da) ? unpaid : (da > 0 ? da : 100);
        amountInput.value = suggestedAmount;
    }
}

async function renderDueReports() {
    setupDueReportsNavigation();
    if (currentReportTab === 'due-list') {
        await loadDueReport();
    } else if (currentReportTab === 'balance-sheet') {
        await loadBalanceSheetReport();
    } else if (currentReportTab === 'village-summary') {
        await loadVillageSummaryReport();
    } else if (currentReportTab === 'pending-list') {
        await loadPendingListReport();
    }
}

function setupDueReportsNavigation() {
    const tabs = document.querySelectorAll('#reports-suite-tabs .report-tab-btn');
    tabs.forEach(btn => {
        btn.onclick = (e) => {
            tabs.forEach(t => {
                t.classList.remove('active', 'btn-wood');
                t.classList.add('btn-secondary');
            });
            btn.classList.remove('btn-secondary');
            btn.classList.add('active', 'btn-wood');
            
            const target = btn.getAttribute('data-report');
            currentReportTab = target;
            
            document.querySelectorAll('.report-subview').forEach(sub => {
                sub.style.display = 'none';
            });
            const subTarget = document.getElementById(`subview-${target}`);
            if (subTarget) subTarget.style.display = 'block';
            
            if (target === 'due-list') loadDueReport();
            else if (target === 'balance-sheet') loadBalanceSheetReport();
            else if (target === 'village-summary') loadVillageSummaryReport();
            else if (target === 'pending-list') loadPendingListReport();
        };
    });
}

async function loadDueReport() {
    const tbody = document.getElementById('due-table-body');
    const deficitEl = document.getElementById('due-stat-total-deficit');
    const defaultersEl = document.getElementById('due-stat-defaulters-count');
    const dueEl = document.getElementById('due-stat-due-count');
    const outEl = document.getElementById('due-stat-total-outstanding');
    
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="14" style="text-align:center; padding:30px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Calculating Mentor Due & Deficits...</td></tr>`;
    }
    
    try {
        const lineParam = currentMentorLine ? `?line_no=${currentMentorLine}` : '';
        const data = await apiFetch(`/api/tenant/mentor/reports/due-list${lineParam}`);
        currentDueReportData = data.dueList || [];
        
        if (deficitEl) deficitEl.textContent = `₹${(data.summary.totalDeficitAmount || 0).toLocaleString('en-IN')}`;
        if (defaultersEl) defaultersEl.textContent = data.summary.defaultersCount || 0;
        if (dueEl) dueEl.textContent = data.summary.dueCount || 0;
        if (outEl) outEl.textContent = `₹${(data.summary.totalOutstanding || 0).toLocaleString('en-IN')}`;
        
        populateDueFilters(currentDueReportData);
        filterAndRenderDueTable();
    } catch (err) {
        console.error('Failed to load due list report:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="14" style="text-align:center; padding:30px; color:var(--color-danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error loading due report: ${err.message}</td></tr>`;
        }
    }
}

function populateDueFilters(data) {
    const lineSelect = document.getElementById('due-filter-line');
    const vilSelect = document.getElementById('due-filter-village');
    
    if (lineSelect && lineSelect.options.length <= 1) {
        const lines = [...new Set(data.map(d => d.line_no).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
        lines.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l;
            opt.textContent = `Line ${l}`;
            if (String(l) === String(currentMentorLine)) opt.selected = true;
            lineSelect.appendChild(opt);
        });
    }
    
    if (vilSelect) {
        const currentVil = vilSelect.value;
        const villages = [...new Set(data.map(d => d.village).filter(Boolean))].sort();
        let html = `<option value="">-- All Villages --</option>`;
        villages.forEach(v => {
            html += `<option value="${v}" ${v === currentVil ? 'selected' : ''}>${v}</option>`;
        });
        vilSelect.innerHTML = html;
    }
}

function filterAndRenderDueTable() {
    const tbody = document.getElementById('due-table-body');
    const lineFilter = document.getElementById('due-filter-line')?.value || '';
    const vilFilter = document.getElementById('due-filter-village')?.value || '';
    const defaultersOnly = document.getElementById('due-filter-defaulters-only')?.checked || false;
    
    if (!tbody) return;
    
    let filtered = currentDueReportData;
    if (lineFilter) {
        filtered = filtered.filter(r => String(r.line_no) === String(lineFilter));
    }
    if (vilFilter) {
        filtered = filtered.filter(r => r.village === vilFilter);
    }
    if (defaultersOnly) {
        filtered = filtered.filter(r => r.isDefaulter);
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="14" style="text-align:center; padding:30px; color:var(--text-muted);">No accounts match the selected filters.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = filtered.map(r => {
        let badgeHtml = `<span class="badge badge-success">On Track</span>`;
        let rowClass = '';
        if (r.bamt <= 0) {
            badgeHtml = `<span class="badge badge-secondary">Settled</span>`;
        } else if (r.isDefaulter) {
            badgeHtml = `<span class="badge-defaulter">Defaulter (${r.pw}w)</span>`;
            rowClass = 'row-defaulter';
        } else if (r.isDue) {
            badgeHtml = `<span class="badge-due">Due (${r.pw}w)</span>`;
        }
        
        return `
            <tr class="${rowClass}">
                <td><strong style="color: var(--color-primary);">${r.borrowerNo || '--'}</strong></td>
                <td style="font-weight: 700;">${r.borrowerName}</td>
                <td>${r.village || '--'}</td>
                <td><span class="badge badge-secondary">Line ${r.line_no || '--'}</span></td>
                <td>₹${(r.loanAmount || 0).toLocaleString('en-IN')}</td>
                <td style="color: var(--color-success); font-weight: 600;">₹${(r.paidAmount || 0).toLocaleString('en-IN')}</td>
                <td><strong style="color: var(--color-danger);">₹${(r.bamt || 0).toLocaleString('en-IN')}</strong></td>
                <td>₹${(r.da || 0).toLocaleString('en-IN')}</td>
                <td>${r.aw || 0}</td>
                <td>${r.pdw || 0}</td>
                <td><strong style="color: ${r.pw >= 2 ? 'var(--color-danger)' : (r.pw === 1 ? 'var(--color-warning)' : 'var(--text-dark)')};">${r.pw || 0}</strong></td>
                <td><strong style="color: var(--color-danger);">₹${(r.damt || 0).toLocaleString('en-IN')}</strong></td>
                <td>${badgeHtml}</td>
                <td>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="openPassbookModal('${r.loanId}')" style="padding: 4px 8px; font-size: 11px;">
                        <i class="fa-solid fa-receipt"></i> ACC
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function loadBalanceSheetReport() {
    const membersEl = document.getElementById('tb-total-members');
    const amtEl = document.getElementById('tb-sum-amt');
    const pamtEl = document.getElementById('tb-sum-pamt');
    const bamtEl = document.getElementById('tb-sum-bamt');
    const recEl = document.getElementById('tb-recovery-rate');
    const tbody = document.getElementById('tb-village-table-body');
    
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading balance sheet...</td></tr>`;
    }
    
    try {
        const lineParam = currentMentorLine ? `?line_no=${currentMentorLine}` : '';
        const data = await apiFetch(`/api/tenant/mentor/reports/balance-sheet${lineParam}`);
        
        if (membersEl) membersEl.textContent = data.summary.totalMembers.toLocaleString('en-IN');
        if (amtEl) amtEl.textContent = `₹${data.summary.totalDisbursed.toLocaleString('en-IN')}`;
        if (pamtEl) pamtEl.textContent = `₹${data.summary.totalCollected.toLocaleString('en-IN')}`;
        if (bamtEl) bamtEl.textContent = `₹${data.summary.totalOutstanding.toLocaleString('en-IN')}`;
        if (recEl) recEl.textContent = `${data.summary.recoveryRate}%`;
        
        if (tbody) {
            if (!data.villageBreakdown || data.villageBreakdown.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">No village breakdown data available.</td></tr>`;
                return;
            }
            tbody.innerHTML = data.villageBreakdown.map(v => {
                const rec = v.amt > 0 ? Math.round((v.pamt / v.amt) * 100) : 0;
                return `
                    <tr>
                        <td><strong><i class="fa-solid fa-location-dot" style="color:var(--color-primary); margin-right:4px;"></i> ${v.village}</strong></td>
                        <td>${v.members}</td>
                        <td>₹${v.amt.toLocaleString('en-IN')}</td>
                        <td style="color: var(--color-success);">₹${v.pamt.toLocaleString('en-IN')}</td>
                        <td><strong style="color: var(--color-danger);">₹${v.bamt.toLocaleString('en-IN')}</strong></td>
                        <td>₹${v.da.toLocaleString('en-IN')}</td>
                        <td><span class="badge ${rec >= 80 ? 'badge-success' : (rec >= 50 ? 'badge-primary' : 'badge-danger')}">${rec}%</span></td>
                    </tr>
                `;
            }).join('');
        }
    } catch (err) {
        console.error('Failed to load balance sheet report:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--color-danger);">Error: ${err.message}</td></tr>`;
        }
    }
}

async function loadVillageSummaryReport() {
    const tbody = document.getElementById('village-route-table-body');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading routes...</td></tr>`;
    
    try {
        const villages = db.villages || [];
        const loans = db.loans || [];
        
        const lineFiltered = villages.filter(v => !currentMentorLine || String(v.line_no) === String(currentMentorLine));
        
        if (lineFiltered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">No route mappings found for this line.</td></tr>`;
            return;
        }
        
        tbody.innerHTML = lineFiltered.map(v => {
            const vilLoans = loans.filter(l => (l.village === v.village_name || l.areaName === v.village_name));
            const outBamt = vilLoans.reduce((s, l) => s + (Number(l.unpaidAmount) || 0), 0);
            return `
                <tr>
                    <td><strong style="color: var(--color-primary);">Route #${v.serial_no || '--'}</strong></td>
                    <td>Line ${v.line_no}</td>
                    <td><i class="fa-solid fa-location-pin" style="color:var(--color-primary); margin-right:4px;"></i> <strong>${v.village_name}</strong></td>
                    <td>${vilLoans.length} Members</td>
                    <td><strong style="color: var(--color-danger);">₹${outBamt.toLocaleString('en-IN')}</strong></td>
                </tr>
            `;
        }).join('');
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--color-danger);">Error: ${e.message}</td></tr>`;
    }
}

async function loadPendingListReport() {
    const tbody = document.getElementById('pending-list-table-body');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading aging report...</td></tr>`;
    
    try {
        const lineParam = currentMentorLine ? `?line_no=${currentMentorLine}` : '';
        const data = await apiFetch(`/api/tenant/mentor/reports/due-list${lineParam}`);
        const pendingRows = (data.dueList || []).filter(r => r.pw > 0).sort((a, b) => b.pw - a.pw);
        
        if (pendingRows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--color-success);"><i class="fa-solid fa-check"></i> Excellent! Zero accounts currently pending in this book.</td></tr>`;
            return;
        }
        
        tbody.innerHTML = pendingRows.map(r => `
            <tr>
                <td><strong style="color: var(--color-primary);">${r.borrowerNo || '--'}</strong></td>
                <td style="font-weight: 700;">${r.borrowerName}</td>
                <td>${r.village || '--'}</td>
                <td>Line ${r.line_no || '--'}</td>
                <td>${r.startDate || '--'}</td>
                <td>₹${(r.loanAmount || 0).toLocaleString('en-IN')}</td>
                <td>₹${(r.paidAmount || 0).toLocaleString('en-IN')}</td>
                <td><strong style="color: var(--color-danger);">₹${(r.bamt || 0).toLocaleString('en-IN')}</strong></td>
                <td><span class="badge ${r.pw >= 2 ? 'badge-danger' : 'badge-warning'}">${r.pw} Slots Pending</span></td>
                <td><strong style="color: var(--color-danger);">₹${(r.damt || 0).toLocaleString('en-IN')}</strong></td>
            </tr>
        `).join('');
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--color-danger);">Error: ${e.message}</td></tr>`;
    }
}

async function openPassbookModal(loanId) {
    const modal = document.getElementById('modal-mentor-passbook');
    const container = document.getElementById('passbook-monospace-container');
    
    if (!modal || !container) return;
    
    modal.style.display = 'flex';
    container.textContent = 'Loading passbook statement (ACC.txt format)...';
    currentPassbookText = "";
    
    try {
        const data = await apiFetch(`/api/tenant/mentor/acc-card/${loanId}`);
        currentPassbookText = data.accText || "No statement data generated.";
        container.textContent = currentPassbookText;
    } catch (err) {
        container.textContent = `Failed to generate passbook card:\n${err.message}`;
    }
}

function closePassbookModal() {
    const modal = document.getElementById('modal-mentor-passbook');
    if (modal) modal.style.display = 'none';
}

function exportCurrentReportToCSV() {
    if (currentReportTab === 'due-list' && currentDueReportData.length > 0) {
        let csv = "ANO,Name,Village,Line,Loan Amount,Paid Amount,Balance,DA,AW,PDW,PW,DAMT,Status\n";
        currentDueReportData.forEach(r => {
            const status = r.bamt <= 0 ? 'Settled' : (r.isDefaulter ? 'Defaulter' : (r.isDue ? 'Due' : 'On Track'));
            csv += `"${r.borrowerNo || ''}","${r.borrowerName || ''}","${r.village || ''}","${r.line_no || ''}",${r.loanAmount || 0},${r.paidAmount || 0},${r.bamt || 0},${r.da || 0},${r.aw || 0},${r.pdw || 0},${r.pw || 0},${r.damt || 0},"${status}"\n`;
        });
        downloadCSVBlob(csv, `mentor_due_list_line_${currentMentorLine || 'all'}.csv`);
    } else {
        showToast('Export available for Due & Deficit table.', 'info');
    }
}

function downloadCSVBlob(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function initMentorSuite() {
    const btnQuickRapid = document.getElementById('btn-quick-rapid-post');
    if (btnQuickRapid) {
        btnQuickRapid.onclick = () => switchView('rapid-posting');
    }
    
    const headerLineSelect = document.getElementById('header-quick-line-select');
    if (headerLineSelect) {
        headerLineSelect.onchange = (e) => {
            currentMentorLine = e.target.value;
            showToast(`Line selected: Line ${currentMentorLine}`, 'info');
            if (currentView === 'rapid-posting') renderRapidPosting();
            else if (currentView === 'due-reports') renderDueReports();
        };
    }
    
    const btnScan = document.getElementById('btn-mentor-scan-trigger');
    if (btnScan) btnScan.onclick = () => renderMentorCenter();
    
    const btnImportAll = document.getElementById('btn-mentor-import-all');
    if (btnImportAll) {
        btnImportAll.onclick = async () => {
            if (!mentorScanData || !mentorScanData.activeBooks || mentorScanData.activeBooks.length === 0) {
                showToast('Please scan Mentor books first.', 'warning');
                return;
            }
            if (!confirm(`Import/Sync all ${mentorScanData.activeBooks.length} active line books? This will sync all records from TDATA.`)) return;
            
            btnImportAll.disabled = true;
            btnImportAll.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Syncing All Lines...`;
            
            for (let book of mentorScanData.activeBooks) {
                try {
                    await apiFetch('/api/tenant/mentor/import-line', {
                        method: 'POST',
                        body: JSON.stringify({ lineNo: book.lineNo, folder: 'New' })
                    });
                } catch(e) {
                    console.error(`Import line ${book.lineNo} error:`, e);
                }
            }
            
            showToast('All active lines synchronized successfully!', 'success');
            btnImportAll.disabled = false;
            btnImportAll.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Sync / Import All Lines`;
            await refreshLocalData();
            renderMentorCenter();
        };
    }
    
    const tabNew = document.getElementById('tab-mentor-new');
    const tabOld = document.getElementById('tab-mentor-old');
    if (tabNew && tabOld) {
        tabNew.onclick = () => {
            tabNew.classList.add('active');
            tabNew.style.background = 'var(--color-primary)';
            tabNew.style.color = 'white';
            tabOld.classList.remove('active');
            tabOld.style.background = 'var(--bg-card)';
            tabOld.style.color = 'var(--text-main)';
            currentMentorFolder = 'New';
            renderMentorGrid('New');
        };
        tabOld.onclick = () => {
            tabOld.classList.add('active');
            tabOld.style.background = 'var(--color-primary)';
            tabOld.style.color = 'white';
            tabNew.classList.remove('active');
            tabNew.style.background = 'var(--bg-card)';
            tabNew.style.color = 'var(--text-main)';
            currentMentorFolder = 'OLD';
            renderMentorGrid('OLD');
        };
    }
    
    const rapidForm = document.getElementById('rapid-posting-form');
    const rapidAnoInput = document.getElementById('rapid-ano-input');
    const rapidAmtInput = document.getElementById('rapid-amount-input');
    const rapidAudioIcon = document.getElementById('rapid-audio-icon');
    const btnRapidClear = document.getElementById('btn-rapid-clear-batch');
    
    if (rapidAudioIcon) {
        rapidAudioIcon.onclick = () => {
            rapidAudioEnabled = !rapidAudioEnabled;
            rapidAudioIcon.className = rapidAudioEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
            rapidAudioIcon.style.color = rapidAudioEnabled ? 'var(--color-success)' : 'var(--text-muted)';
            showToast(rapidAudioEnabled ? 'Posting chimes enabled' : 'Posting chimes muted', 'info');
        };
    }
    
    if (btnRapidClear) {
        btnRapidClear.onclick = () => {
            rapidSessionRecords = [];
            updateRapidSessionTally();
            renderRapidSessionTable();
            showToast('Session batch cleared.', 'info');
        };
    }
    
    if (rapidAnoInput) {
        rapidAnoInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const loan = findLoanByAno(rapidAnoInput.value);
                if (loan) {
                    displayLoaneeSnapshot(loan);
                    if (rapidAmtInput) rapidAmtInput.focus();
                } else {
                    showToast(`Borrower '${rapidAnoInput.value}' not found in Line ${currentMentorLine}.`, 'warning');
                }
            }
        });
        
        rapidAnoInput.addEventListener('blur', () => {
            if (rapidAnoInput.value && !activeRapidLoanee) {
                const loan = findLoanByAno(rapidAnoInput.value);
                if (loan) displayLoaneeSnapshot(loan);
            }
        });
    }
    
    if (rapidForm) {
        rapidForm.onsubmit = async (e) => {
            e.preventDefault();
            const anoVal = rapidAnoInput.value.trim();
            const loan = activeRapidLoanee || findLoanByAno(anoVal);
            
            if (!loan) {
                showToast(`Please enter a valid borrower account.`, 'danger');
                if (rapidAnoInput) rapidAnoInput.focus();
                return;
            }
            
            const amt = parseFloat(rapidAmtInput.value);
            if (!amt || amt <= 0) {
                showToast('Please enter a valid collection amount.', 'warning');
                if (rapidAmtInput) rapidAmtInput.focus();
                return;
            }
            
            const colDate = document.getElementById('rapid-date-input')?.value || new Date().toISOString().split('T')[0];
            const btnSubmit = document.getElementById('btn-rapid-post-submit');
            if (btnSubmit) {
                btnSubmit.disabled = true;
                btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Posting...`;
            }
            
            try {
                const res = await apiFetch('/api/tenant/collections/rapid-post', {
                    method: 'POST',
                    body: JSON.stringify({
                        loanId: loan.id,
                        borrowerNo: loan.borrowerNo,
                        amount: amt,
                        collectionDate: colDate,
                        line_no: loan.line_no || currentMentorLine,
                        folder: currentMentorFolder
                    })
                });
                
                playMentorChime();
                
                rapidSessionRecords.unshift({
                    loanId: loan.id,
                    borrowerNo: loan.borrowerNo || anoVal,
                    borrowerName: loan.borrowerName,
                    amount: amt,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                });
                
                loan.paidAmount = (Number(loan.paidAmount) || 0) + amt;
                loan.unpaidAmount = Math.max(0, (Number(loan.loanAmount) || 0) - loan.paidAmount);
                
                showToast(`✓ ₹${amt.toLocaleString('en-IN')} posted for ${loan.borrowerName} (${loan.borrowerNo || ''})`, 'success');
                
                displayLoaneeSnapshot(null);
                rapidAnoInput.value = '';
                rapidAmtInput.value = '';
                updateRapidSessionTally();
                renderRapidSessionTable();
                
                setTimeout(() => {
                    rapidAnoInput.focus();
                }, 50);
            } catch (err) {
                console.error('Rapid post error:', err);
                showToast(`Posting failed: ${err.message}`, 'danger');
            } finally {
                if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.innerHTML = `<i class="fa-solid fa-circle-check"></i> Post Payment [Enter]`;
                }
            }
        };
    }
    
    const dueLineFilter = document.getElementById('due-filter-line');
    const dueVilFilter = document.getElementById('due-filter-village');
    const dueDefaulterCheck = document.getElementById('due-filter-defaulters-only');
    if (dueLineFilter) dueLineFilter.onchange = filterAndRenderDueTable;
    if (dueVilFilter) dueVilFilter.onchange = filterAndRenderDueTable;
    if (dueDefaulterCheck) dueDefaulterCheck.onchange = filterAndRenderDueTable;
    
    const btnPrintReport = document.getElementById('btn-print-current-report');
    if (btnPrintReport) btnPrintReport.onclick = () => window.print();
    
    const btnCsv = document.getElementById('btn-export-report-csv');
    if (btnCsv) btnCsv.onclick = exportCurrentReportToCSV;
    
    const btnClosePassbook1 = document.getElementById('btn-close-passbook-modal');
    const btnClosePassbook2 = document.getElementById('btn-close-passbook-btn');
    if (btnClosePassbook1) btnClosePassbook1.onclick = closePassbookModal;
    if (btnClosePassbook2) btnClosePassbook2.onclick = closePassbookModal;
    
    const modalPassbook = document.getElementById('modal-mentor-passbook');
    if (modalPassbook) {
        modalPassbook.onclick = (e) => {
            if (e.target === modalPassbook) closePassbookModal();
        };
    }
    
    const btnPrintPassbook = document.getElementById('btn-print-passbook');
    if (btnPrintPassbook) {
        btnPrintPassbook.onclick = () => {
            const printWin = window.open('', '_blank');
            printWin.document.write(`
                <html>
                <head><title>ACC Statement - Terrasol FinServ</title>
                <style>
                    body { font-family: 'Courier New', Courier, monospace; font-size: 13px; line-height: 1.4; padding: 20px; }
                    pre { margin: 0; white-space: pre-wrap; }
                </style>
                </head>
                <body>
                <pre>${currentPassbookText}</pre>
                <script>window.onload = function() { window.print(); window.close(); }<\/script>
                </body>
                </html>
            `);
            printWin.document.close();
        };
    }
    
    const btnThermalPassbook = document.getElementById('btn-thermal-passbook');
    if (btnThermalPassbook) {
        btnThermalPassbook.onclick = () => {
            const printWin = window.open('', '_blank');
            printWin.document.write(`
                <html>
                <head><title>Thermal 80mm Receipt</title>
                <style>
                    @page { size: 80mm auto; margin: 4mm; }
                    body { font-family: 'Courier New', Courier, monospace; font-size: 11px; width: 72mm; line-height: 1.25; margin: 0; }
                    pre { white-space: pre-wrap; margin: 0; }
                </style>
                </head>
                <body>
                <pre>${currentPassbookText}</pre>
                <script>window.onload = function() { window.print(); window.close(); }<\/script>
                </body>
                </html>
            `);
            printWin.document.close();
        };
    }
    
    const btnCopyAcc = document.getElementById('btn-copy-acc-text');
    if (btnCopyAcc) {
        btnCopyAcc.onclick = () => {
            if (!currentPassbookText) return;
            navigator.clipboard.writeText(currentPassbookText).then(() => {
                showToast('ACC.txt copied to clipboard!', 'success');
            }).catch(() => {
                showToast('Could not copy to clipboard.', 'warning');
            });
        };
    }
    
    window.addEventListener('keydown', (e) => {
        if ((e.altKey && (e.key === 'r' || e.key === 'R')) || e.key === 'F2') {
            e.preventDefault();
            switchView('rapid-posting');
        } else if (e.key === 'Escape') {
            closePassbookModal();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initMentorSuite();
});


