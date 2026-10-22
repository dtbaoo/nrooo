const axios = require('axios');
const fs = require('fs');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

// ================= 1. CẤU HÌNH HỆ THỐNG =================
const BOT_TOKEN = '8816015468:AAHjTG8jHN_qmsi9e5VJxVQxpb_w0v5HIgg';
const ADMIN_PASSWORD = 'DoanThanhBao3331234567890a';
const DEFAULT_SUPPORT_CONTACT = '@aitbao';
const DEFAULT_PINNED_KEYWORDS = [
    'Slot Family gemini Pro',
    'Link Gemini Pro 18M',
    'Gemini Pro 18M'
];

// ================= CẤU HÌNH SẢN PHẨM THỦ CÔNG: SLOT FAMILY GEMINI PRO =================
const CUSTOM_SLOT_SOURCE_ID = 'custom_slot_family_gemini_pro';
const CUSTOM_SLOT_DEFAULT_NAME = 'Slot Family gemini Pro';
const CUSTOM_SLOT_DEFAULT_PRICE = 50000;
const CUSTOM_SLOT_DEFAULT_STOCK = 'Sẵn hàng';
const CUSTOM_SLOT_DEFAULT_DESCRIPTION =
    '⚠️ <b>LƯU Ý & MÔ TẢ SẢN PHẨM:</b>\n' +
    '• Sản phẩm: <b>Slot Family gemini Pro</b> (Nâng cấp chính chủ qua lời mời Google Family).\n' +
    '• Điều kiện: Gmail của bạn hiện <b>không tham gia nhóm Gia đình (Family) khác</b> và chưa đổi nhóm Family quá giới hạn 12 tháng của Google.\n' +
    '• Quy trình nhận hàng:\n' +
    '  1️⃣ Bấm <b>Tiếp tục mua hàng</b> và hoàn tất thanh toán.\n' +
    '  2️⃣ Nhập <b>địa chỉ Gmail</b> của bạn vào khung chat để gửi đến Admin.\n' +
    '  3️⃣ Khi <b>Admin bấm Duyệt</b>, lời mời Family Gemini Pro sẽ được gửi tới Gmail của bạn và đơn hàng hoàn tất!';

// ================= CẤU HÌNH BOT THÔNG BÁO ĐƠN HÀNG (BOT MỚI) =================
const NOTIFY_BOT_TOKEN = '8610782064:AAGEi27OO3-213OGEWdemqGmMWOjO_PNlr4';
const NOTIFY_CHAT_ID = '8661895412';

// Cấu hình API Nguồn
const SOURCE_BASE_URL = 'https://api.altivoxai.com/api/v1';
const SOURCE_ROOT_URL = 'https://api.altivoxai.com';
const SOURCE_API_KEY = 'isk_087c8b910abb03666b7cef2034df5ed394d3f67b5ec10478';
const PRODUCTS_PER_PAGE = 10;
const ORDERS_PER_PAGE = 5;

// FIX TREO TRÊN LINUX: Ép dùng IPv4 (family: 4) và đặt timeout 15s cho mọi request tới Telegram
const ipv4Agent = new https.Agent({
    keepAlive: true,
    family: 4,
    timeout: 15000
});
const tgClient = axios.create({
    timeout: 15000,
    httpsAgent: ipv4Agent
});

function calculateSellingPrice(rawPrice) {
    const base = Number(rawPrice) || 0;
    if (base < 100000) {
        return base + 20000;
    } else {
        return Math.round(base * 1.15);
    }
}

const BANK_CONFIG = {
    BANK_ID: 'MB',
    ACCOUNT_NO: '49001433841407',
    ACCOUNT_NAME: 'DOAN THANH BAO'
};

let WEBHOOK_PORT = 3000;

// Biến lưu trạng thái phiên làm việc & Khóa chống giao dịch trùng
const awaitingPasswordUsers = {};
const awaitingSupportContactUsers = {};
const awaitingBalanceAdjustUsers = {};
const awaitingDirectMsgUsers = {};
const awaitingBroadcastUsers = {};
const awaitingCustomerReplyUsers = {};
const awaitingSlotGmailUsers = {}; // Lưu trạng thái khách đang chờ nhập Gmail sau khi thanh toán
const awaitingSlotPriceUsers = {}; // Lưu trạng thái Admin đang nhập giá mới cho Slot Family
const awaitingSlotDescUsers = {};  // Lưu trạng thái Admin đang nhập Mô tả & Lưu ý mới cho Slot Family
const loggedInAdmins = new Set();
const buyingLocks = new Set();

function clearUserStates(userId) {
    delete awaitingPasswordUsers[userId];
    delete awaitingSupportContactUsers[userId];
    delete awaitingBalanceAdjustUsers[userId];
    delete awaitingDirectMsgUsers[userId];
    delete awaitingBroadcastUsers[userId];
    delete awaitingCustomerReplyUsers[userId];
    delete awaitingSlotGmailUsers[userId];
    delete awaitingSlotPriceUsers[userId];
    delete awaitingSlotDescUsers[userId];
}

// ================= 2. QUẢN LÝ DATABASE (LƯU FILE JSON) =================
const DB_FILE = './database.json';

function loadDB() {
    const defaultData = {
        users: {},
        orders: [],
        processed_tx: [],
        products: [],
        daily_visits: {},
        settings: {
            support_contact: DEFAULT_SUPPORT_CONTACT,
            pinned_source_ids: [],
            working_api_prefix: '',
            slot_family_price: CUSTOM_SLOT_DEFAULT_PRICE,
            slot_family_stock: CUSTOM_SLOT_DEFAULT_STOCK,
            slot_family_description: CUSTOM_SLOT_DEFAULT_DESCRIPTION
        }
    };
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (!Array.isArray(data.products)) data.products = [];
        if (!data.users || typeof data.users !== 'object') data.users = {};
        if (!Array.isArray(data.orders)) data.orders = [];
        if (!Array.isArray(data.processed_tx)) data.processed_tx = [];
        if (!data.daily_visits || typeof data.daily_visits !== 'object') {
            data.daily_visits = {};
        }
        if (!data.settings || typeof data.settings !== 'object') {
            data.settings = defaultData.settings;
        }
        if (!data.settings.support_contact) {
            data.settings.support_contact = DEFAULT_SUPPORT_CONTACT;
        }
        if (!Array.isArray(data.settings.pinned_source_ids)) {
            data.settings.pinned_source_ids = [];
        }
        if (typeof data.settings.working_api_prefix !== 'string') {
            data.settings.working_api_prefix = '';
        }
        if (typeof data.settings.slot_family_price !== 'number' || isNaN(data.settings.slot_family_price)) {
            data.settings.slot_family_price = CUSTOM_SLOT_DEFAULT_PRICE;
        }
        if (!data.settings.slot_family_stock) {
            data.settings.slot_family_stock = CUSTOM_SLOT_DEFAULT_STOCK;
        }
        if (!data.settings.slot_family_description) {
            data.settings.slot_family_description = CUSTOM_SLOT_DEFAULT_DESCRIPTION;
        }
        return data;
    } catch (e) {
        return defaultData;
    }
}

function saveDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Lỗi ghi DB:', err.message);
    }
}

function getSupportContact() {
    const db = loadDB();
    return (db.settings && db.settings.support_contact) ? db.settings.support_contact : DEFAULT_SUPPORT_CONTACT;
}

// Lấy mã ngày YYYY-MM-DD theo múi giờ Việt Nam
function getVNDateKey(dateObj) {
    const dObj = dateObj || new Date();
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(dObj);
        const y = (parts.find(p => p.type === 'year') || {}).value;
        const m = (parts.find(p => p.type === 'month') || {}).value;
        const d = (parts.find(p => p.type === 'day') || {}).value;
        return y + '-' + m + '-' + d;
    } catch (e) {
        return dObj.toISOString().slice(0, 10);
    }
}

// Chuyển YYYY-MM-DD sang DD/MM/YYYY để hiển thị đẹp
function formatDateKeyVN(dateKey) {
    if (!dateKey || !dateKey.includes('-')) return dateKey;
    const parts = dateKey.split('-');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function isProductPinned(product, db) {
    const sId = String(product.source_id);
    const pinnedIds = (db.settings && Array.isArray(db.settings.pinned_source_ids))
        ? db.settings.pinned_source_ids
        : [];
    const unpinnedIds = (db.settings && Array.isArray(db.settings.unpinned_source_ids))
        ? db.settings.unpinned_source_ids
        : [];
    if (unpinnedIds.includes(sId)) {
        return false;
    }
    if (pinnedIds.includes(sId)) {
        return true;
    }
    const lowerName = (product.name || '').toLowerCase();
    return DEFAULT_PINNED_KEYWORDS.some(kw => lowerName.includes(kw.toLowerCase()));
}

function getCustomSlotProductObj(db) {
    const settings = (db && db.settings) ? db.settings : {};
    const price = (typeof settings.slot_family_price === 'number' && !isNaN(settings.slot_family_price))
        ? settings.slot_family_price
        : CUSTOM_SLOT_DEFAULT_PRICE;
    const desc = settings.slot_family_description || CUSTOM_SLOT_DEFAULT_DESCRIPTION;
    const stock = settings.slot_family_stock || CUSTOM_SLOT_DEFAULT_STOCK;
    return {
        id: 'sp_slot_family',
        name: CUSTOM_SLOT_DEFAULT_NAME,
        source_price: 0,
        price: price,
        source_id: CUSTOM_SLOT_SOURCE_ID,
        is_custom_slot: true,
        description: desc,
        stock: stock
    };
}

function isCustomSlotProduct(product) {
    if (!product) return false;
    if (product.is_custom_slot || String(product.source_id) === CUSTOM_SLOT_SOURCE_ID) return true;
    return String(product.name || '').trim().toLowerCase() === CUSTOM_SLOT_DEFAULT_NAME.toLowerCase();
}

function isSlotFamilyOutOfStock(product) {
    if (!product) return false;
    const st = String(product.stock || '').trim().toLowerCase();
    return st === 'hết hàng' || st === 'het hang' || st === '0' || st === 'out of stock';
}

function isValidGmail(emailStr) {
    if (!emailStr || typeof emailStr !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr.trim());
}

function sortProductsWithPinnedFirst(products, db) {
    const listWithoutCustom = (Array.isArray(products) ? products : []).filter(
        p => !isCustomSlotProduct(p)
    );
    const customSlotProd = getCustomSlotProductObj(db);
    const allProducts = [customSlotProd].concat(listWithoutCustom);
    const pinned = [];
    const normal = [];
    for (const p of allProducts) {
        if (isProductPinned(p, db)) {
            pinned.push(Object.assign({}, p, { is_pinned: true }));
        } else {
            normal.push(Object.assign({}, p, { is_pinned: false }));
        }
    }
    const combined = pinned.concat(normal);
    return combined.map((item, idx) => Object.assign({}, item, { id: 'sp_' + (idx + 1) }));
}

// Lấy thông tin User đồng thời ghi nhận lượt truy cập trong ngày theo ID
function getUser(userId, username) {
    const cleanName = username || 'Khách';
    const db = loadDB();
    const uidStr = String(userId);
    const todayKey = getVNDateKey();
    const nowIso = new Date().toISOString();
    let changed = false;
    if (!db.users[userId]) {
        db.users[userId] = {
            id: userId,
            username: cleanName,
            balance: 0,
            total_deposited: 0,
            created_at: nowIso,
            last_active: nowIso
        };
        changed = true;
    } else {
        if (cleanName && cleanName !== 'Khách' && db.users[userId].username !== cleanName) {
            db.users[userId].username = cleanName;
            changed = true;
        }
        const lastActiveMs = db.users[userId].last_active ? new Date(db.users[userId].last_active).getTime() : 0;
        if (Date.now() - lastActiveMs > 60000) {
            db.users[userId].last_active = nowIso;
            changed = true;
        }
    }
    if (!Array.isArray(db.daily_visits[todayKey])) {
        db.daily_visits[todayKey] = [];
    }
    if (!db.daily_visits[todayKey].includes(uidStr)) {
        db.daily_visits[todayKey].push(uidStr);
        db.users[userId].last_active = nowIso;
        changed = true;
    }
    if (changed) {
        saveDB(db);
    }
    return db.users[userId];
}

function updateBalance(userId, amount, username) {
    const db = loadDB();
    if (!db.users[userId]) {
        db.users[userId] = {
            id: userId,
            username: username || 'Khách',
            balance: 0,
            total_deposited: 0,
            created_at: new Date().toISOString(),
            last_active: new Date().toISOString()
        };
    } else if (username && username !== 'Khách') {
        db.users[userId].username = username;
    }
    db.users[userId].balance += amount;
    if (amount > 0) db.users[userId].total_deposited += amount;
    saveDB(db);
    return db.users[userId].balance;
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatVNTime(isoStr) {
    try {
        return new Date(isoStr).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    } catch (e) {
        return isoStr || 'Không rõ';
    }
}

// ================= 2.1. HÀM TÁCH RIÊNG LINK SẢN PHẨM (ẨN THÔNG TIN KÈM THEO VỚI KHÁCH) =================
function extractAllLinks(text) {
    if (!text) return [];
    const matches = String(text).match(/https?:\/\/[^\s"'<>|`)\]]+/gi) || [];
    const cleaned = matches.map(rawUrl => {
        let u = rawUrl;
        while (u.length > 0 && '.,;!?'.includes(u.charAt(u.length - 1))) {
            u = u.slice(0, -1);
        }
        return u;
    });
    return Array.from(new Set(cleaned));
}

// Lọc bỏ các dòng JSON hệ thống của kho nguồn (orderId, upstreamOrderId, f0_order_id...)
function stripSystemJsonLines(rawStr) {
    return String(rawStr || '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => {
            if (!l || l === '{' || l === '}' || l === '[' || l === ']') return false;
            const lower = l.toLowerCase();
            if (
                lower.includes('"success"') ||
                lower.includes('"orderid"') ||
                lower.includes('"order_id"') ||
                lower.includes('"ordercode"') ||
                lower.includes('"order_code"') ||
                lower.includes('"upstream') ||
                lower.includes('"f0_order') ||
                lower.includes('"providerorder') ||
                lower.includes('"provider_order') ||
                lower.includes('"deliveredtext"') ||
                lower.includes('"status"') ||
                lower.includes('"statuscode"')
            ) {
                return false;
            }
            return true;
        })
        .join('\n')
        .trim();
}

// Hiển thị cho KHÁCH HÀNG: Chỉ hiện Link (hoặc Tài khoản), TUYỆT ĐỐI KHÔNG hiện "Thông tin kèm theo"
function formatProductDisplayForCustomer(rawDeliveredText) {
    const rawStr = String(rawDeliveredText || '').trim();
    const links = extractAllLinks(rawStr);
    if (links.length > 0) {
        let html = '';
        if (links.length === 1) {
            html += '🔗 <b>LINK SẢN PHẨM (Chạm vào link để sao chép ngay):</b>\n<code>' + escapeHTML(links[0]) + '</code>';
        } else {
            html += '🔗 <b>DANH SÁCH LINK SẢN PHẨM (Chạm vào từng link để sao chép):</b>\n';
            html += links.map((lnk, i) => (i + 1) + '. <code>' + escapeHTML(lnk) + '</code>').join('\n');
        }
        return { html: html, links: links };
    }
    const cleanText = stripSystemJsonLines(rawStr) || rawStr;
    const safeText = escapeHTML(
        cleanText.length > 3000 ? cleanText.substring(0, 3000) + '\n... (Đã cắt bớt)' : cleanText
    );
    return {
        html: '🎁 <b>THÔNG TIN SẢN PHẨM (Chạm vào để sao chép):</b>\n<code>' + safeText + '</code>',
        links: []
    };
}

// Hiển thị cho ADMIN: Hiện cả Link sản phẩm VÀ "📋 Thông tin kèm theo (Chỉ Admin thấy)"
function formatProductDisplayForAdmin(rawDeliveredText, apiResponse) {
    const customerFormatted = formatProductDisplayForCustomer(rawDeliveredText);
    let html = customerFormatted.html;
    const rawStr = String(rawDeliveredText || '').trim();
    let remaining = rawStr;
    for (const lnk of customerFormatted.links) {
        remaining = remaining.split(lnk).join('');
    }
    const ignoredLabels = ['link', 'url', 'đường dẫn', 'sản phẩm', 'link nhận'];
    const extraLines = remaining
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0 && !ignoredLabels.includes(l.toLowerCase()));
    if (extraLines.length > 0 && customerFormatted.links.length > 0) {
        const safeExtra = escapeHTML(extraLines.join('\n')).substring(0, 1500);
        html += '\n\n📋 <b>Thông tin kèm theo (Chỉ Admin thấy):</b>\n<code>' + safeExtra + '</code>';
    } else if (apiResponse && typeof apiResponse === 'object') {
        const safeJson = escapeHTML(JSON.stringify(apiResponse, null, 2)).substring(0, 1500);
        html += '\n\n📋 <b>Thông tin kèm theo (Chỉ Admin thấy):</b>\n<code>' + safeJson + '</code>';
    }
    return html;
}

// ================= 2.2. BỘ TẠO FILE EXCEL (.XLSX) THUẦN NODE.JS =================
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createZipBuffer(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const file of files) {
        const nameBuf = Buffer.from(file.name, 'utf8');
        const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
        const compressedBuf = zlib.deflateRawSync(dataBuf);
        const crc = crc32(dataBuf);
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compressedBuf.length, 18);
        localHeader.writeUInt32LE(dataBuf.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);
        localParts.push(localHeader, nameBuf, compressedBuf);
        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(compressedBuf.length, 20);
        centralHeader.writeUInt32LE(dataBuf.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, nameBuf);
        offset += localHeader.length + nameBuf.length + compressedBuf.length;
    }
    const centralDirBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDirBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat(localParts.concat([centralDirBuf, eocd]));
}

function escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function colIndexToLetter(index) {
    let letter = '';
    let temp = index + 1;
    while (temp > 0) {
        let rem = (temp - 1) % 26;
        letter = String.fromCharCode(65 + rem) + letter;
        temp = Math.floor((temp - 1) / 26);
    }
    return letter;
}

function buildOrdersExcelBuffer(orders, db, isAdmin) {
    const headers = isAdmin
        ? ['STT', 'Mã Đơn Hàng', 'Thời Gian Mua', 'ID Khách Hàng', 'Tên Khách Hàng', 'Tên Sản Phẩm', 'Giá Thanh Toán (VNĐ)', 'Link Sản Phẩm (Chép Nhanh)', 'Toàn Bộ Dữ Liệu Giao (Admin)']
        : ['STT', 'Mã Đơn Hàng', 'Thời Gian Mua', 'Tên Sản Phẩm', 'Giá Thanh Toán (VNĐ)', 'Thông Tin / Link Sản Phẩm'];
    const rows = [headers];
    let totalRevenue = 0;
    orders.forEach((order, idx) => {
        const deliveredText = order.delivered_product
            ? String(order.delivered_product)
            : formatDeliveredProductFromSource(order.api_response);
        const links = extractAllLinks(deliveredText);
        const linkCell = links.length > 0 ? links.join('\n') : (stripSystemJsonLines(deliveredText) || deliveredText);
        const priceNum = Number(order.price_charged || 0);
        totalRevenue += priceNum;
        const userObj = (db.users && db.users[order.user_id]) ? db.users[order.user_id] : {};
        const customerName = userObj.username || 'Khách';
        if (isAdmin) {
            rows.push([
                idx + 1,
                String(order.order_id || ''),
                formatVNTime(order.time),
                String(order.user_id || ''),
                String(customerName),
                String(order.product_name || ''),
                priceNum,
                linkCell,
                deliveredText
            ]);
        } else {
            rows.push([
                idx + 1,
                String(order.order_id || ''),
                formatVNTime(order.time),
                String(order.product_name || ''),
                priceNum,
                linkCell
            ]);
        }
    });
    if (isAdmin) {
        rows.push(['', '', '', '', '', 'TỔNG DOANH THU:', totalRevenue, '', '']);
    } else {
        rows.push(['', '', '', 'TỔNG CHI TIÊU:', totalRevenue, '']);
    }
    const colWidths = isAdmin
        ? [8, 16, 22, 16, 20, 32, 20, 48, 55]
        : [8, 16, 22, 32, 20, 55];
    const colsXml = colWidths
        .map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>')
        .join('');
    let sheetDataXml = '';
    rows.forEach((row, rIdx) => {
        const rowNum = rIdx + 1;
        const isHeader = rIdx === 0;
        const isTotalRow = rIdx === rows.length - 1;
        let cellsXml = '';
        row.forEach((val, cIdx) => {
            const cellRef = colIndexToLetter(cIdx) + rowNum;
            const styleId = isHeader ? 1 : (isTotalRow ? 2 : 0);
            if (typeof val === 'number' && !isNaN(val)) {
                cellsXml += '<c r="' + cellRef + '" s="' + styleId + '"><v>' + val + '</v></c>';
            } else {
                cellsXml += '<c r="' + cellRef + '" s="' + styleId + '" t="inlineStr"><is><t>' + escapeXml(val) + '</t></is></c>';
            }
        });
        sheetDataXml += '<row r="' + rowNum + '">' + cellsXml + '</row>';
    });
    const contentTypesXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
        '    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
        '    <Default Extension="xml" ContentType="application/xml"/>\n' +
        '    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n' +
        '    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n' +
        '    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n' +
        '</Types>';
    const relsXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
        '    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n' +
        '</Relationships>';
    const workbookXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n' +
        '    <sheets>\n' +
        '        <sheet name="LichSuDonHang" sheetId="1" r:id="rId1"/>\n' +
        '    </sheets>\n' +
        '</workbook>';
    const workbookRelsXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
        '    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n' +
        '    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n' +
        '</Relationships>';
    const stylesXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
        '    <fonts count="3">\n' +
        '        <font><sz val="11"/><name val="Arial"/></font>\n' +
        '        <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>\n' +
        '        <font><b/><sz val="11"/><color rgb="FF1F4E78"/><name val="Arial"/></font>\n' +
        '</fonts>\n' +
        '    <fills count="4">\n' +
        '        <fill><patternFill patternType="none"/></fill>\n' +
        '        <fill><patternFill patternType="gray125"/></fill>\n' +
        '        <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/></patternFill></fill>\n' +
        '        <fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/></patternFill></fill>\n' +
        '    </fills>\n' +
        '    <borders count="2">\n' +
        '        <border><left/><right/><top/><bottom/><diagonal/></border>\n' +
        '        <border>\n' +
        '            <left style="thin"><color auto="1"/></left>\n' +
        '            <right style="thin"><color auto="1"/></right>\n' +
        '            <top style="thin"><color auto="1"/></top>\n' +
        '            <bottom style="thin"><color auto="1"/></bottom>\n' +
        '            <diagonal/>\n' +
        '        </border>\n' +
        '    </borders>\n' +
        '    <cellStyleXfs count="1">\n' +
        '        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>\n' +
        '    </cellStyleXfs>\n' +
        '    <cellXfs count="3">\n' +
        '        <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">\n' +
        '            <alignment vertical="center" wrapText="1"/>\n' +
        '        </xf>\n' +
        '        <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">\n' +
        '            <alignment horizontal="center" vertical="center" wrapText="1"/>\n' +
        '        </xf>\n' +
        '        <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">\n' +
        '            <alignment vertical="center"/>\n' +
        '        </xf>\n' +
        '    </cellXfs>\n' +
        '</styleSheet>';
    const sheetXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
        '    <cols>' + colsXml + '</cols>\n' +
        '    <sheetData>' + sheetDataXml + '</sheetData>\n' +
        '</worksheet>';
    return createZipBuffer([
        { name: '[Content_Types].xml', data: contentTypesXml },
        { name: '_rels/.rels', data: relsXml },
        { name: 'xl/workbook.xml', data: workbookXml },
        { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
        { name: 'xl/styles.xml', data: stylesXml },
        { name: 'xl/worksheets/sheet1.xml', data: sheetXml }
    ]);
}

// ================= 3. HÀM GIAO TIẾP TELEGRAM API (ĐÃ GẮN TIMEOUT + IPV4) =================
const TG_API = 'https://api.telegram.org/bot' + BOT_TOKEN;

// Hàm gửi thông báo sang Con Bot Thứ 2 (Bot Thông Báo Đơn Hàng)
async function sendNotifyBotMessage(text) {
    const cleanToken = (NOTIFY_BOT_TOKEN || '').trim();
    if (!cleanToken || cleanToken === 'DAN_TOKEN_BOT_THONG_BAO_MOI_VAO_DAY') {
        return;
    }
    const notifyApiUrl = 'https://api.telegram.org/bot' + cleanToken + '/sendMessage';
    const targetIds = new Set();
    if (NOTIFY_CHAT_ID && String(NOTIFY_CHAT_ID).trim() !== '') {
        targetIds.add(String(NOTIFY_CHAT_ID).trim());
    }
    for (const adminId of loggedInAdmins) {
        targetIds.add(String(adminId));
    }
    for (const tid of targetIds) {
        try {
            await tgClient.post(notifyApiUrl, {
                chat_id: tid,
                text: text,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        } catch (err) {
            try {
                const plainText = String(text).replace(/<[^>]*>?/gm, '');
                await tgClient.post(notifyApiUrl, {
                    chat_id: tid,
                    text: plainText
                });
            } catch (err2) {
                console.error('❌ Lỗi gửi tin qua Bot Thông Báo tới ID ' + tid + ':', err2.response ? err2.response.data : err2.message);
            }
        }
    }
}

// Hàm gửi thông báo kèm nút bấm Duyệt đơn trên Bot Chính cho Admin
async function sendAdminInteractiveNotification(text, replyMarkup, excludeChatId) {
    const targetIds = new Set();
    if (NOTIFY_CHAT_ID && String(NOTIFY_CHAT_ID).trim() !== '') {
        targetIds.add(String(NOTIFY_CHAT_ID).trim());
    }
    for (const adminId of loggedInAdmins) {
        targetIds.add(String(adminId));
    }
    for (const tid of targetIds) {
        if (excludeChatId && String(tid) === String(excludeChatId)) continue;
        await sendMessage(tid, text, replyMarkup);
    }
}

async function setupBotCommands() {
    try {
        const commands = [
            { command: 'start', description: '🏠 Trang chủ cửa hàng' },
            { command: 'muahang', description: '🛒 Xem danh sách sản phẩm & Mua hàng' },
            { command: 'lichsu', description: '📜 Xem lại sản phẩm & đơn hàng đã mua' },
            { command: 'naptien', description: '💳 Lấy mã QR Nạp tiền tự động 24/7' },
            { command: 'taikhoan', description: '👤 Kiểm tra số dư & Thông tin tài khoản' },
            { command: 'hotro', description: 'Liên hệ Admin Hỗ trợ' }
        ];
        await tgClient.post(TG_API + '/setMyCommands', { commands: commands });
        await tgClient.post(TG_API + '/setChatMenuButton', {
            menu_button: { type: 'commands' }
        });
        console.log('✅ Đã cài đặt Menu lệnh "/" cho khách hàng (Đã thêm /lichsu & ẩn /admin)');
    } catch (err) {
        console.error('Lỗi cài đặt Menu lệnh:', err.response ? err.response.data : err.message);
    }
}

async function sendMessage(chatId, text, replyMarkup) {
    try {
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await tgClient.post(TG_API + '/sendMessage', payload);
    } catch (err) {
        try {
            const plainText = String(text).replace(/<[^>]*>?/gm, '');
            const fallbackPayload = { chat_id: chatId, text: plainText };
            if (replyMarkup) fallbackPayload.reply_markup = replyMarkup;
            await tgClient.post(TG_API + '/sendMessage', fallbackPayload);
        } catch (err2) {
            console.error('Lỗi gửi tin nhắn:', err2.message);
        }
    }
}

async function editOrSendMessage(chatId, messageId, text, replyMarkup) {
    if (messageId) {
        try {
            const payload = {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            };
            if (replyMarkup) payload.reply_markup = replyMarkup;
            await tgClient.post(TG_API + '/editMessageText', payload);
            return;
        } catch (err) {
            const desc = (err.response && err.response.data && err.response.data.description) || '';
            if (desc.includes('message is not modified')) {
                return;
            }
        }
    }
    await sendMessage(chatId, text, replyMarkup);
}

async function deleteMessage(chatId, messageId) {
    try {
        await tgClient.post(TG_API + '/deleteMessage', {
            chat_id: chatId,
            message_id: messageId
        });
    } catch (err) {}
}

async function sendPhoto(chatId, photoUrl, caption, replyMarkup) {
    try {
        const payload = { chat_id: chatId, photo: photoUrl, caption: caption, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await tgClient.post(TG_API + '/sendPhoto', payload);
        return;
    } catch (err) {
        console.error('⚠️ Telegram không tự tải được URL ảnh, chuyển sang tải từ VPS...');
    }
    try {
        const imgRes = await axios.get(photoUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            httpsAgent: ipv4Agent
        });
        const imgBuffer = Buffer.from(imgRes.data);
        const boundary = '----TelegramPhotoBoundary' + Date.now().toString(16);
        const parts = [];
        function addField(name, value) {
            parts.push(Buffer.from(
                '--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + '\r\n',
                'utf8'
            ));
        }
        addField('chat_id', String(chatId));
        if (caption) {
            addField('caption', caption);
            addField('parse_mode', 'HTML');
        }
        if (replyMarkup) {
            addField('reply_markup', JSON.stringify(replyMarkup));
        }
        parts.push(Buffer.from(
            '--' + boundary + '\r\nContent-Disposition: form-data; name="photo"; filename="qr.png"\r\nContent-Type: image/png\r\n\r\n',
            'utf8'
        ));
        parts.push(imgBuffer);
        parts.push(Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8'));
        const bodyBuffer = Buffer.concat(parts);
        await tgClient.post(TG_API + '/sendPhoto', bodyBuffer, {
            headers: {
                'Content-Type': 'multipart/form-data; boundary=' + boundary,
                'Content-Length': bodyBuffer.length
            },
            timeout: 20000
        });
        return;
    } catch (err2) {
        console.error('Lỗi tải ảnh QR:', err2.message);
    }
    await sendMessage(
        chatId,
        caption + '\n\n🔗 <a href="' + photoUrl + '">Bấm vào đây để xem mã QR</a>',
        replyMarkup
    );
}

async function sendDocumentBuffer(chatId, fileBuffer, fileName, caption, replyMarkup) {
    try {
        const boundary = '----TelegramBotBoundary' + Date.now().toString(16);
        const parts = [];
        function addField(name, value) {
            parts.push(Buffer.from(
                '--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + '\r\n',
                'utf8'
            ));
        }
        addField('chat_id', String(chatId));
        if (caption) {
            addField('caption', caption);
            addField('parse_mode', 'HTML');
        }
        if (replyMarkup) {
            addField('reply_markup', JSON.stringify(replyMarkup));
        }
        parts.push(Buffer.from(
            '--' + boundary + '\r\nContent-Disposition: form-data; name="document"; filename="' + fileName + '"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n',
            'utf8'
        ));
        parts.push(fileBuffer);
        parts.push(Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8'));
        const bodyBuffer = Buffer.concat(parts);
        await tgClient.post(TG_API + '/sendDocument', bodyBuffer, {
            headers: {
                'Content-Type': 'multipart/form-data; boundary=' + boundary,
                'Content-Length': bodyBuffer.length
            },
            timeout: 30000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
    } catch (err) {
        console.error('Lỗi gửi file Excel:', err.response ? err.response.data : err.message);
        await sendMessage(chatId, '❌ Có lỗi xảy ra khi tải file Excel lên Telegram.');
    }
}

async function answerCallback(callbackQueryId, text, showAlert) {
    try {
        await tgClient.post(TG_API + '/answerCallbackQuery', {
            callback_query_id: callbackQueryId,
            text: text || '',
            show_alert: Boolean(showAlert)
        }, { timeout: 8000 });
    } catch (err) {}
}

// ================= 4. KẾT NỐI API GỐC & BÓC TÁCH SẢN PHẨM =================
const sourceHeaders = {
    'X-Source-Api-Key': SOURCE_API_KEY,
    'x-source-api-key': SOURCE_API_KEY,
    'X-API-Key': SOURCE_API_KEY,
    'x-api-key': SOURCE_API_KEY,
    'Authorization': 'Bearer ' + SOURCE_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
};

function extractProductsFromRawData(raw) {
    let extracted = [];
    function traverse(node, parentName) {
        const pName = parentName || '';
        if (!node) return;
        if (Array.isArray(node)) {
            for (const elem of node) {
                traverse(elem, pName);
            }
            return;
        }
        if (typeof node === 'object') {
            const containerKeys = ['data', 'items', 'products', 'catalog', 'categories', 'groups', 'services', 'results', 'rows', 'list'];
            let foundContainer = false;
            for (const key of containerKeys) {
                if (Array.isArray(node[key])) {
                    const currentCatName = node.name || node.title || node.categoryName || pName;
                    traverse(node[key], currentCatName);
                    foundContainer = true;
                } else if (node[key] && typeof node[key] === 'object') {
                    traverse(node[key], pName);
                    foundContainer = true;
                }
            }
            const variantKeys = ['variants', 'plans', 'packages', 'options', 'skus'];
            for (const vKey of variantKeys) {
                if (Array.isArray(node[vKey]) && node[vKey].length > 0) {
                    const prodTitle = node.name || node.title || node.productName || pName;
                    for (const variant of node[vKey]) {
                        const vName = variant.name || variant.title || variant.planName || '';
                        const combinedName = (prodTitle && vName && !vName.includes(prodTitle))
                            ? (prodTitle + ' — ' + vName)
                            : (vName || prodTitle);
                        extracted.push(Object.assign({}, node, variant, {
                            parent_id: node.id ?? node.productId ?? node.product_id,
                            parent_code: node.code ?? node.productCode ?? node.sku,
                            variant_id: variant.id ?? variant.variantId ?? variant.variant_id ?? variant.planId,
                            variant_code: variant.code ?? variant.sku ?? variant.productCode,
                            name: combinedName
                        }));
                    }
                    return;
                }
            }
            if (foundContainer) return;
            const hasIdentifier = node.id !== undefined || node.code !== undefined || node.productCode !== undefined || node.productId !== undefined || node.sku !== undefined;
            const hasName = node.name !== undefined || node.title !== undefined || node.productName !== undefined;
            const hasPrice = node.price !== undefined || node.cost !== undefined || node.amount !== undefined || node.unitPrice !== undefined || node.priceVnd !== undefined;
            if ((hasIdentifier && hasName) || (hasName && hasPrice) || (hasIdentifier && hasPrice)) {
                extracted.push(node);
            }
        }
    }
    traverse(raw, '');
    return extracted;
}

// 4.1. Đồng bộ danh sách sản phẩm
let isSyncingCatalog = false;
async function syncCatalogFromSource() {
    if (isSyncingCatalog) return { success: false, error: 'Đang đồng bộ...' };
    isSyncingCatalog = true;
    try {
        const candidateUrls = [
            SOURCE_BASE_URL + '/catalog',
            SOURCE_BASE_URL + '/products',
            SOURCE_BASE_URL + '/internal-source/v1/catalog',
            SOURCE_BASE_URL + '/internal-source/catalog',
            SOURCE_ROOT_URL + '/api/internal-source/v1/catalog',
            SOURCE_ROOT_URL + '/api/internal-source/catalog'
        ];
        let lastError = '';
        for (const url of candidateUrls) {
            try {
                let allRawItems = [];
                let currentPage = 1;
                let totalPages = 1;
                while (currentPage <= totalPages && currentPage <= 20) {
                    const res = await axios.get(url, {
                        headers: sourceHeaders,
                        params: {
                            page: currentPage,
                            limit: 500,
                            per_page: 500,
                            pageSize: 500,
                            size: 500
                        },
                        timeout: 12000,
                        httpsAgent: ipv4Agent
                    });
                    const raw = res.data;
                    const pageItems = extractProductsFromRawData(raw);
                    if (pageItems.length === 0) break;
                    allRawItems = allRawItems.concat(pageItems);
                    const meta = (raw && (raw.meta || raw.pagination || (raw.data && (raw.data.meta || raw.data.pagination)))) || raw;
                    const apiTotalPages = Number((meta && (meta.totalPages || meta.total_pages || meta.last_page)) || 1);
                    if (apiTotalPages > 1) {
                        totalPages = apiTotalPages;
                        currentPage++;
                    } else {
                        break;
                    }
                }
                if (allRawItems.length === 0) {
                    const resPlain = await axios.get(url, { headers: sourceHeaders, timeout: 10000, httpsAgent: ipv4Agent });
                    allRawItems = extractProductsFromRawData(resPlain.data);
                }
                const uniqueItemsMap = new Map();
                allRawItems.forEach((item, idx) => {
                    const code = String(
                        item.variant_code ?? item.variant_id ?? item.code ?? item.productCode ?? item.id ?? item.productId ?? item.product_id ?? item.sku ?? ('item_' + idx)
                    );
                    if (!uniqueItemsMap.has(code)) {
                        uniqueItemsMap.set(code, item);
                    }
                });
                const finalItems = Array.from(uniqueItemsMap.values());
                if (finalItems.length > 0) {
                    const db = loadDB();
                    const mappedProducts = finalItems.map((item, idx) => {
                        const rawPrice = Number(
                            item.price ?? item.cost ?? item.amount ?? item.unitPrice ?? item.priceVnd ?? item.salePrice ?? 20000
                        );
                        const sourceCode = String(
                            item.code ?? item.productCode ?? item.id ?? item.productId ?? item.product_id ?? item.sku ?? (idx + 1)
                        );
                        const stockCount = item.stock ?? item.available ?? item.quantity ?? item.remain ?? item.inStock ?? 'Sẵn hàng';
                        return {
                            id: 'sp_' + (idx + 1),
                            name: item.name || item.title || item.productName || ('Sản phẩm #' + (idx + 1)),
                            source_price: rawPrice,
                            price: calculateSellingPrice(rawPrice),
                            source_id: sourceCode,
                            raw_item: item,
                            stock: stockCount
                        };
                    });
                    const detectedPrefix = url.replace(/\/catalog\/?/i, '').replace(/\/products\/?/i, '');
                    db.settings.working_api_prefix = detectedPrefix;
                    db.products = sortProductsWithPinnedFirst(mappedProducts, db);
                    saveDB(db);
                    console.log('✅ [AUTO-SYNC] Đã đồng bộ ' + db.products.length + ' sản phẩm từ ' + url);
                    return { success: true, count: db.products.length, url: url };
                } else {
                    lastError = 'API trả về thành công nhưng không tìm thấy sản phẩm tại ' + url;
                }
            } catch (err) {
                lastError = err.response ? (err.response.status + ': ' + JSON.stringify(err.response.data)) : err.message;
            }
        }
        console.error('❌ [SYNC-ERROR] Lỗi đồng bộ:', lastError);
        return { success: false, error: lastError };
    } finally {
        isSyncingCatalog = false;
    }
}

// 4.2. Kiểm tra số dư ví gốc
async function checkSourceBalance() {
    const db = loadDB();
    const prefix = db.settings ? db.settings.working_api_prefix : '';
    const candidateUrls = Array.from(new Set([
        prefix ? (prefix + '/balance') : null,
        prefix ? (prefix + '/me') : null,
        SOURCE_BASE_URL + '/balance',
        SOURCE_BASE_URL + '/me',
        SOURCE_BASE_URL + '/profile',
        SOURCE_BASE_URL + '/internal-source/v1/balance',
        SOURCE_BASE_URL + '/internal-source/balance',
        SOURCE_ROOT_URL + '/api/internal-source/v1/balance'
    ].filter(Boolean)));
    let lastError = '';
    for (const url of candidateUrls) {
        try {
            const res = await axios.get(url, { headers: sourceHeaders, timeout: 10000, httpsAgent: ipv4Agent });
            return { success: true, data: res.data, url: url };
        } catch (err) {
            const status = err.response ? err.response.status : 0;
            const errStr = err.response ? (status + ': ' + JSON.stringify(err.response.data)) : err.message;
            if (status !== 404 || !lastError) {
                lastError = errStr;
            }
        }
    }
    return { success: false, error: lastError };
}

// 4.3. Kiểm tra dữ liệu đơn hàng trả về từ kho gốc
function isApiOrderResponseValid(resData) {
    if (!resData) return false;
    if (typeof resData === 'object') {
        if (
            resData.success === false ||
            resData.ok === false ||
            resData.status === 'error' ||
            resData.status === 'failed' ||
            resData.status === 'cancelled' ||
            resData.status === 'rejected' ||
            (typeof resData.statusCode === 'number' && resData.statusCode >= 400)
        ) {
            return false;
        }
        if (resData.error && !resData.data && !resData.order && !resData.items && !resData.accounts && !resData.deliveredItems) {
            return false;
        }
    }
    return true;
}

// 4.4. Bóc tách thông tin sản phẩm từ phản hồi của kho gốc
function formatDeliveredProductFromSource(apiData) {
    if (!apiData) return '';
    if (typeof apiData === 'string') return apiData.trim();
    let deliveredLines = [];
    const seen = new Set();
    function addLine(str) {
        if (str === undefined || str === null) return;
        const clean = String(str).trim();
        if (!clean || clean === '[object Object]' || seen.has(clean)) return;
        seen.add(clean);
        deliveredLines.push(clean);
    }
    function formatSingleItemObj(obj) {
        if (!obj || typeof obj !== 'object') {
            addLine(obj);
            return;
        }
        const directFields = [
            'link', 'url', 'inviteLink', 'invite_link', 'redeemUrl', 'redeem_url',
            'fullInfo', 'full_info', 'accountData', 'account_data', 'credentials',
            'content', 'value', 'secret', 'licenseKey', 'license_key', 'key',
            'token', 'voucher', 'serial', 'data', 'text', 'account',
            'deliveredContent', 'delivered_content', 'productData', 'product_data'
        ];
        for (const f of directFields) {
            if (typeof obj[f] === 'string' && obj[f].trim() !== '') {
                addLine(obj[f]);
            }
        }
        const user = obj.username || obj.email || obj.user || obj.login || obj.accountName;
        const pass = obj.password || obj.pass || obj.pwd;
        const twoFa = obj.twoFa || obj.two_fa || obj.totp || obj.secretKey || obj.otp;
        const note = obj.note || obj.description || obj.guide || obj.instruction || obj.expiredAt || obj.expires_at;
        if (user || pass) {
            let cred = [];
            if (user) cred.push('Tài khoản: ' + user);
            if (pass) cred.push('Mật khẩu: ' + pass);
            if (twoFa) cred.push('2FA/OTP: ' + twoFa);
            if (note) cred.push('Ghi chú: ' + note);
            addLine(cred.join(' | '));
        }
    }
    function scanObject(node) {
        if (!node) return;
        if (typeof node === 'string') {
            addLine(node);
            return;
        }
        if (Array.isArray(node)) {
            for (const item of node) {
                if (typeof item === 'string' || typeof item === 'number') {
                    addLine(item);
                } else if (typeof item === 'object') {
                    formatSingleItemObj(item);
                    scanObject(item);
                }
            }
            return;
        }
        if (typeof node === 'object') {
            const deliveryArrayKeys = [
                'deliveredItems', 'delivered_items', 'accounts', 'keys', 'codes',
                'links', 'vouchers', 'licenses', 'credentials', 'results',
                'items', 'products', 'orderItems', 'order_items', 'deliveries', 'stockData'
            ];
            for (const key of deliveryArrayKeys) {
                if (Array.isArray(node[key]) && node[key].length > 0) {
                    for (const elem of node[key]) {
                        if (typeof elem === 'string' || typeof elem === 'number') {
                            addLine(elem);
                        } else if (typeof elem === 'object') {
                            formatSingleItemObj(elem);
                            for (const subKey of ['accounts', 'keys', 'items', 'data', 'codes', 'delivered', 'content']) {
                                if (elem[subKey]) scanObject(elem[subKey]);
                            }
                        }
                    }
                } else if (typeof node[key] === 'string' && node[key].trim() !== '') {
                    addLine(node[key]);
                }
            }
            formatSingleItemObj(node);
            const wrapperKeys = ['data', 'order', 'result', 'payload', 'delivery', 'item', 'response'];
            for (const wKey of wrapperKeys) {
                if (node[wKey] && typeof node[wKey] === 'object') {
                    scanObject(node[wKey]);
                } else if (typeof node[wKey] === 'string' && node[wKey].trim() !== '') {
                    addLine(node[wKey]);
                }
            }
        }
    }
    scanObject(apiData);
    const ignoreWords = new Set([
        'completed', 'success', 'paid', 'processing', 'pending',
        'ok', 'true', 'active', 'done', 'delivered', 'created'
    ]);
    const filteredLines = deliveredLines.filter(line => !ignoreWords.has(line.toLowerCase()));
    if (filteredLines.length > 0) {
        return filteredLines.join('\n');
    }
    return JSON.stringify(apiData, null, 2);
}

// 4.5. Tự động lấy chi tiết đơn hàng nếu đơn đang xử lý
async function fetchOrderDetailsIfNeeded(orderResponseData, baseOrderUrl) {
    const rootObj = (orderResponseData && (orderResponseData.data || orderResponseData.order)) || orderResponseData;
    const orderId = rootObj ? (rootObj.orderId || rootObj.order_id || rootObj.id || rootObj.code || rootObj.orderCode) : null;
    if (!orderId) return orderResponseData;
    const cleanBaseUrl = baseOrderUrl.endsWith('/') ? baseOrderUrl.slice(0, -1) : baseOrderUrl;
    const db = loadDB();
    const prefix = db.settings ? db.settings.working_api_prefix : '';
    const detailUrls = Array.from(new Set([
        cleanBaseUrl + '/' + orderId,
        prefix ? (prefix + '/orders/' + orderId) : null,
        SOURCE_BASE_URL + '/orders/' + orderId,
        SOURCE_BASE_URL + '/internal-source/v1/orders/' + orderId,
        SOURCE_BASE_URL + '/internal-source/orders/' + orderId,
        SOURCE_ROOT_URL + '/api/internal-source/v1/orders/' + orderId
    ].filter(Boolean)));
    for (let attempt = 1; attempt <= 4; attempt++) {
        const extractedText = formatDeliveredProductFromSource(orderResponseData);
        if (extractedText && !extractedText.startsWith('{') && !extractedText.startsWith('[')) {
            return orderResponseData;
        }
        await new Promise(r => setTimeout(r, 1500));
        for (const dUrl of detailUrls) {
            try {
                const res = await axios.get(dUrl, { headers: sourceHeaders, timeout: 10000, httpsAgent: ipv4Agent });
                if (res.data && isApiOrderResponseValid(res.data)) {
                    orderResponseData = res.data;
                    break;
                }
            } catch (err) {}
        }
    }
    return orderResponseData;
}

// 4.6. Đặt hàng từ nguồn
async function buyFromSourceAPI(product, quantity) {
    const qty = quantity || 1;
    const db = loadDB();
    const prefix = db.settings ? db.settings.working_api_prefix : '';
    const candidateUrls = Array.from(new Set([
        prefix ? (prefix + '/orders') : null,
        prefix ? (prefix + '/order') : null,
        SOURCE_BASE_URL + '/orders',
        SOURCE_BASE_URL + '/internal-source/v1/orders',
        SOURCE_BASE_URL + '/internal-source/orders',
        SOURCE_ROOT_URL + '/api/internal-source/v1/orders',
        SOURCE_ROOT_URL + '/api/v1/orders',
        SOURCE_BASE_URL + '/order'
    ].filter(Boolean)));
    const raw = product.raw_item || {};
    const idVal = raw.id ?? raw.productId ?? raw.product_id ?? product.source_id;
    const codeVal = raw.code ?? raw.productCode ?? raw.sku ?? product.source_id;
    const payloadVariants = [];
    if (codeVal) {
        payloadVariants.push({ productCode: String(codeVal), quantity: qty });
        payloadVariants.push({ code: String(codeVal), quantity: qty });
    }
    if (idVal) {
        payloadVariants.push({ productId: String(idVal), quantity: qty });
        payloadVariants.push({ product_id: String(idVal), quantity: qty });
        payloadVariants.push({ id: String(idVal), quantity: qty });
    }
    const uniquePayloads = [];
    const seenPayloads = new Set();
    for (const p of payloadVariants) {
        const s = JSON.stringify(p);
        if (!seenPayloads.has(s)) {
            seenPayloads.add(s);
            uniquePayloads.push(p);
        }
    }
    let realServerError = '';
    let last404Error = '';
    for (const url of candidateUrls) {
        for (const payload of uniquePayloads) {
            try {
               const res = await axios.post(url, payload, {
    headers: sourceHeaders,
    timeout: 120000,
    httpsAgent: ipv4Agent
});
                if (!isApiOrderResponseValid(res.data)) {
                    return {
                        success: false,
                        error: 'Kho từ chối tạo đơn: ' + JSON.stringify(res.data)
                    };
                }
                const fullOrderData = await fetchOrderDetailsIfNeeded(res.data, url);
                return { success: true, data: fullOrderData };
            } catch (err) {
                const status = err.response ? err.response.status : 0;
                if (
                    err.code === 'ECONNABORTED' ||
                    err.message.toLowerCase().includes('timeout') ||
                    status === 502 ||
                    status === 504
                ) {
                    return {
                        success: false,
                        error: 'Kho phản hồi quá lâu (Timeout tại ' + url + '). Hệ thống đã dừng ngay để tránh trừ tiền trùng ở kho gốc!'
                    };
                }
                const errData = err.response ? JSON.stringify(err.response.data) : err.message;
                const lowerErr = errData.toLowerCase();
                if (status === 404) {
                    last404Error = '404 (' + url + '): ' + errData;
                    if (lowerErr.includes('cannot post') || lowerErr.includes('not found')) {
                        break;
                    }
                    continue;
                }
                realServerError = status + ' (' + url + '): ' + errData;
                if (
                    status === 401 ||
                    status === 403 ||
                    status === 429 ||
                    status === 500 ||
                    lowerErr.includes('balance') ||
                    lowerErr.includes('insufficient') ||
                    lowerErr.includes('số dư') ||
                    lowerErr.includes('không đủ') ||
                    lowerErr.includes('out of stock') ||
                    lowerErr.includes('hết hàng') ||
                    lowerErr.includes('stock')
                ) {
                    return { success: false, error: realServerError };
                }
            }
        }
        if (realServerError) {
            return { success: false, error: realServerError };
        }
    }
    return { success: false, error: realServerError || last404Error || 'Không kết nối được API đặt hàng của kho' };
}

// ================= 5. GIAO DIỆN MENU KHÁCH HÀNG, LỊCH SỬ ĐƠN HÀNG & ADMIN =================
function getCustomerMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🛒 Danh sách Sản phẩm (Mua hàng)', callback_data: 'menu_shop_1' }],
            [
                { text: '💳 Nạp tiền Tự động (QR)', callback_data: 'menu_deposit' },
                { text: '📜 Lịch sử Mua hàng', callback_data: 'menu_history_1' }
            ],
            [
                { text: '👤 Tài khoản của tôi', callback_data: 'menu_profile' },
                { text: '💬 Hỗ trợ / Bảo hành', callback_data: 'menu_support' }
            ]
        ]
    };
}

function getAdminMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '📈 Thống kê Truy cập (Theo Ngày)', callback_data: 'admin_traffic_stats' }
            ],
            [
                { text: '🛠️ Quản lý SP: Slot Family (Giá / Kho / Lưu ý)', callback_data: 'admin_slot_family_config' }
            ],
            [
                { text: '✉️ Nhắn tin riêng cho Khách', callback_data: 'admin_send_dm' },
                { text: '📢 Thông báo Toàn bộ Khách', callback_data: 'admin_broadcast' }
            ],
            [
                { text: '🔄 Đồng bộ SP Ngay', callback_data: 'admin_sync' },
                { text: '🔑 Xem Số dư Ví Gốc', callback_data: 'admin_balance' }
            ],
            [
                { text: '📌 Ghim / Bỏ ghim SP lên đầu', callback_data: 'admin_pin_page_1' },
                { text: '✏️ Đổi Liên hệ Hỗ trợ', callback_data: 'admin_edit_support' }
            ],
            [
                { text: '💰 Cộng / Trừ tiền Ví (Tùy ý)', callback_data: 'admin_adjust_balance' },
                { text: '📊 Xuất Excel Đơn hàng', callback_data: 'admin_export_excel' }
            ],
            [
                { text: '🔒 Đăng xuất Admin', callback_data: 'admin_logout' },
                { text: '🏠 Về Giao diện Khách hàng', callback_data: 'menu_home' }
            ]
        ]
    };
}

async function showCustomerMainMenu(chatId, user) {
    const text =
        '🎉 <b>CHÀO MỪNG ĐẾN VỚI SHOP AI TECH</b>\n\n' +
        '👤 Khách hàng: <b>' + escapeHTML(user.username) + '</b> (ID: <code>' + user.id + '</code>)\n' +
        '💰 Số dư hiện tại: <b>' + user.balance.toLocaleString('vi-VN') + 'đ</b>\n\n' +
        '⚡ <i>Hệ thống bán hàng tự động 24/7 - Giao tài khoản ngay lập tức sau khi thanh toán!</i>';
    await sendMessage(chatId, text, getCustomerMenuKeyboard());
}

async function showUserProfile(chatId, user) {
    const db = loadDB();
    const userOrdersCount = db.orders.filter(o => String(o.user_id) === String(user.id)).length;
    const text =
        '👤 <b>THÔNG TIN TÀI KHOẢN</b>\n\n' +
        '🆔 Mã ID: <code>' + user.id + '</code>\n' +
        '💰 Số dư hiện tại: <b>' + user.balance.toLocaleString('vi-VN') + 'đ</b>\n' +
        '📈 Tổng tiền đã nạp: <b>' + user.total_deposited.toLocaleString('vi-VN') + 'đ</b>\n' +
        '🧾 Tổng đơn hàng đã mua: <b>' + userOrdersCount + ' đơn</b>';
    await sendMessage(chatId, text, {
        inline_keyboard: [
            [
                { text: '📜 Xem Lịch sử Mua hàng', callback_data: 'menu_history_1' },
                { text: '📥 Xuất Excel Đơn hàng', callback_data: 'export_my_orders_excel' }
            ],
            [{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]
        ]
    });
}

async function showOrderHistoryPage(chatId, userId, page, messageId) {
    const pageNum = page || 1;
    const db = loadDB();
    const userOrders = db.orders
        .filter(o => String(o.user_id) === String(userId))
        .slice()
        .reverse();
    if (userOrders.length === 0) {
        return editOrSendMessage(
            chatId,
            messageId,
            '📜 <b>LỊCH SỬ MUA HÀNG</b>\n\n' +
            'Bạn chưa có đơn hàng nào. Hãy ghé cửa hàng để chọn mua sản phẩm nhé!',
            {
                inline_keyboard: [
                    [{ text: '🛒 Mua hàng ngay', callback_data: 'menu_shop_1' }],
                    [{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]
                ]
            }
        );
    }
    const totalOrders = userOrders.length;
    const totalPages = Math.ceil(totalOrders / ORDERS_PER_PAGE);
    const currentPage = Math.max(1, Math.min(pageNum, totalPages));
    const startIndex = (currentPage - 1) * ORDERS_PER_PAGE;
    const pageOrders = userOrders.slice(startIndex, startIndex + ORDERS_PER_PAGE);
    let listText = '';
    const buttons = [];
    pageOrders.forEach((order, idx) => {
        const orderIndex = startIndex + idx + 1;
        const orderIdStr = String(order.order_id);
        const timeStr = formatVNTime(order.time);
        const priceStr = Number(order.price_charged || 0).toLocaleString('vi-VN');
        const deliveredRaw = order.delivered_product
            ? String(order.delivered_product)
            : formatDeliveredProductFromSource(order.api_response);
        const orderLinks = extractAllLinks(deliveredRaw);
        listText +=
            '<b>' + orderIndex + '. [' + escapeHTML(orderIdStr) + '] ' + escapeHTML(order.product_name) + '</b>\n' +
            '   💵 Giá: <b>' + priceStr + 'đ</b> | 🕒 ' + escapeHTML(timeStr) + '\n';
        if (orderLinks.length > 0) {
            listText += '   🔗 Link (Chạm để chép): <code>' + escapeHTML(orderLinks[0]) + '</code>\n';
        }
        listText += '\n';
        buttons.push([{
            text: '🎁 Chi tiết đơn #' + orderIdStr + ' (' + order.product_name.substring(0, 22) + ')',
            callback_data: 'order_detail_' + orderIdStr + '_' + currentPage
        }]);
    });
    if (totalPages > 1) {
        const navRow = [];
        if (currentPage > 1) {
            navRow.push({ text: '⬅️ Trang trước', callback_data: 'menu_history_' + (currentPage - 1) });
        }
        navRow.push({ text: '📄 ' + currentPage + '/' + totalPages, callback_data: 'noop' });
        if (currentPage < totalPages) {
            navRow.push({ text: 'Trang sau ➡️', callback_data: 'menu_history_' + (currentPage + 1) });
        }
        buttons.push(navRow);
    }
    buttons.push([{ text: '📥 Xuất File Excel Lịch sử Đơn hàng', callback_data: 'export_my_orders_excel' }]);
    buttons.push([
        { text: '🛒 Mua thêm SP', callback_data: 'menu_shop_1' },
        { text: '🏠 Về Trang chủ', callback_data: 'menu_home' }
    ]);
    const text =
        '📜 <b>LỊCH SỬ MUA HÀNG CỦA BẠN (Trang ' + currentPage + '/' + totalPages + ')</b>\n' +
        '🧾 Tổng số đơn đã mua: <b>' + totalOrders + ' đơn</b>\n\n' +
        listText +
        '👇 <i>Chạm trực tiếp vào dòng Link để sao chép nhanh hoặc bấm nút bên dưới:</i>';
    await editOrSendMessage(chatId, messageId, text, { inline_keyboard: buttons });
}

async function showOrderDetail(chatId, userId, orderIdStr, backPage, messageId) {
    const bPage = backPage || 1;
    const db = loadDB();
    const order = db.orders.find(
        o => String(o.order_id) === String(orderIdStr) && String(o.user_id) === String(userId)
    );
    if (!order) {
        return editOrSendMessage(
            chatId,
            messageId,
            '❌ <b>Không tìm thấy thông tin đơn hàng này!</b>',
            {
                inline_keyboard: [
                    [{ text: '🔙 Quay lại Lịch sử mua hàng', callback_data: 'menu_history_' + bPage }],
                    [{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]
                ]
            }
        );
    }
    const deliveredText = order.delivered_product
        ? String(order.delivered_product)
        : formatDeliveredProductFromSource(order.api_response);
    const formatted = formatProductDisplayForCustomer(deliveredText);
    const productDisplayHtml = formatted.html;
    const links = formatted.links;
    const text =
        '🧾 <b>CHI TIẾT ĐƠN HÀNG #' + escapeHTML(order.order_id) + '</b>\n\n' +
        '📦 Sản phẩm: <b>' + escapeHTML(order.product_name) + '</b>\n' +
        '💵 Giá thanh toán: <b>' + Number(order.price_charged || 0).toLocaleString('vi-VN') + 'đ</b>\n' +
        '🕒 Thời gian mua: <b>' + escapeHTML(formatVNTime(order.time)) + '</b>\n\n' +
        productDisplayHtml + '\n\n' +
        '💡 <i>Nếu cần hỗ trợ bảo hành, vui lòng liên hệ Admin: ' + escapeHTML(getSupportContact()) + '</i>';
    const kb = [];
    if (links.length > 0) {
        kb.push([{ text: '🔗 Mở Link Sản Phẩm Ngay', url: links[0] }]);
    }
    kb.push([{ text: '🔙 Quay lại Lịch sử mua hàng', callback_data: 'menu_history_' + bPage }]);
    kb.push([
        { text: '🛒 Mua tiếp SP khác', callback_data: 'menu_shop_1' },
        { text: '🏠 Về Trang chủ', callback_data: 'menu_home' }
    ]);
    await editOrSendMessage(chatId, messageId, text, { inline_keyboard: kb });
}

async function exportOrdersToExcelAndSend(chatId, userId, isAdmin) {
    const db = loadDB();
    const orders = isAdmin
        ? db.orders.slice().reverse()
        : db.orders.filter(o => String(o.user_id) === String(userId)).slice().reverse();
    if (orders.length === 0) {
        return sendMessage(
            chatId,
            '📭 <b>Hiện tại chưa có đơn hàng nào để xuất file Excel!</b>',
            {
                inline_keyboard: [
                    [{ text: isAdmin ? '🔙 Quay lại Bảng Admin' : '🏠 Về Trang chủ', callback_data: isAdmin ? 'admin_panel' : 'menu_home' }]
                ]
            }
        );
    }
    await sendMessage(chatId, '⏳ <b>Đang tạo file Excel (.xlsx) lịch sử đơn hàng, vui lòng chờ giây lát...</b>');
    const excelBuffer = buildOrdersExcelBuffer(orders, db, isAdmin);
    const dateTag = new Date().toISOString().slice(0, 10);
    const fileName = isAdmin
        ? ('Lich_Su_Don_Hang_Admin_' + dateTag + '.xlsx')
        : ('Don_Hang_Cua_Toi_' + userId + '_' + dateTag + '.xlsx');
    const totalMoney = orders.reduce((sum, o) => sum + Number(o.price_charged || 0), 0);
    const caption = isAdmin
        ? ('📊 <b>BÁO CÁO EXCEL TOÀN BỘ LỊCH SỬ ĐƠN HÀNG</b>\n\n' +
          '🧾 Tổng số đơn: <b>' + orders.length + ' đơn</b>\n' +
          '💰 Tổng doanh thu: <b>' + totalMoney.toLocaleString('vi-VN') + 'đ</b>\n' +
          '🕒 Xuất lúc: <b>' + escapeHTML(formatVNTime(new Date().toISOString())) + '</b>')
        : ('📥 <b>FILE EXCEL LỊCH SỬ MUA HÀNG CỦA BẠN</b>\n\n' +
          '🧾 Tổng số đơn: <b>' + orders.length + ' đơn</b>\n' +
          '💵 Tổng chi tiêu: <b>' + totalMoney.toLocaleString('vi-VN') + 'đ</b>\n' +
          '💡 <i>Cột Link sản phẩm đã được tách riêng trong file Excel để bạn tiện sao chép!</i>');
    await sendDocumentBuffer(chatId, excelBuffer, fileName, caption, {
        inline_keyboard: [
            [{ text: isAdmin ? '🔙 Quay lại Bảng Admin' : '🏠 Về Trang chủ', callback_data: isAdmin ? 'admin_panel' : 'menu_home' }]
        ]
    });
}

async function showSupportInfo(chatId) {
    const supportContact = getSupportContact();
    await sendMessage(
        chatId,
        '💬 <b>HỖ TRỢ KHÁCH HÀNG</b>\n\n' +
        'Mọi vấn đề về bảo hành hoặc nạp tiền, vui lòng liên hệ trực tiếp Admin: <b>' + escapeHTML(supportContact) + '</b>\n\n' +
        'Hoặc bạn có thể bấm nút bên dưới để gửi tin nhắn trực tiếp cho Admin ngay tại đây:',
        {
            inline_keyboard: [
                [{ text: '✉️ Nhắn tin trực tiếp cho Admin', callback_data: 'customer_reply_admin' }],
                [{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]
            ]
        }
    );
}

async function sendDepositQR(chatId, userId) {
    const memo = 'NAP' + userId;
    const qrUrl = 'https://img.vietqr.io/image/' + BANK_CONFIG.BANK_ID + '-' + BANK_CONFIG.ACCOUNT_NO + '-compact2.png?addInfo=' + encodeURIComponent(memo) + '&accountName=' + encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME);
    const caption =
        '💳 <b>NẠP TIỀN TỰ ĐỘNG QUA NGÂN HÀNG (24/7)</b>\n\n' +
        '🏦 Ngân hàng: <b>' + BANK_CONFIG.BANK_ID + '</b>\n' +
        '🔢 Số tài khoản: <code>' + BANK_CONFIG.ACCOUNT_NO + '</code>\n' +
        '👤 Chủ tài khoản: <b>' + BANK_CONFIG.ACCOUNT_NAME + '</b>\n' +
        '📝 Nội dung chuyển khoản (Bắt buộc): <code>' + memo + '</code>\n\n' +
        '⚡ <i>Quét mã QR bên trên và nhập số tiền cần nạp. Tiền sẽ được cộng tự động sau 10-30 giây!</i>';
    await sendPhoto(chatId, qrUrl, caption, {
        inline_keyboard: [[{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]]
    });
}

async function showAdminPanel(chatId) {
    const db = loadDB();
    const supportContact = getSupportContact();
    const pinnedCount = db.products.filter(p => isProductPinned(p, db)).length;
    const todayKey = getVNDateKey();
    const todayVisitorsCount = (db.daily_visits && Array.isArray(db.daily_visits[todayKey]))
        ? db.daily_visits[todayKey].length
        : 0;
    const hasNotifyBot = NOTIFY_BOT_TOKEN && NOTIFY_BOT_TOKEN !== 'DAN_TOKEN_BOT_THONG_BAO_MOI_VAO_DAY';
    const slotProd = getCustomSlotProductObj(db);
    const text =
        '⚙️ <b>BẢNG ĐIỀU KHIỂN ADMIN</b>\n\n' +
        '📦 Sản phẩm đang bán: <b>' + db.products.length + ' mặt hàng</b> (Đang ghim: <b>' + pinnedCount + ' SP</b> đầu trang 1)\n' +
        '🌟 Slot Family Gemini Pro: <b>' + slotProd.price.toLocaleString('vi-VN') + 'đ</b> (Kho: <b>' + escapeHTML(slotProd.stock) + '</b>)\n' +
        '👥 Tổng khách hàng (All-time): <b>' + Object.keys(db.users).length + ' ID</b>\n' +
        '🟢 Truy cập hôm nay (' + formatDateKeyVN(todayKey) + '): <b>' + todayVisitorsCount + ' ID</b>\n' +
        '🧾 Đơn hàng thành công: <b>' + db.orders.length + '</b>\n' +
        '🔔 Bot Thông Báo phụ: <b>' + (hasNotifyBot ? ('Đã bật (Gửi về ID ' + escapeHTML(NOTIFY_CHAT_ID) + ')') : 'Chưa gắn Token') + '</b>\n' +
        '💬 Liên hệ Hỗ trợ hiện tại: <b>' + escapeHTML(supportContact) + '</b>\n' +
        '🌐 Nhánh API gốc đang dùng: <code>' + escapeHTML(db.settings.working_api_prefix || SOURCE_BASE_URL) + '</code>\n\n' +
        '👇 <i>Chọn chức năng quản trị bên dưới:</i>';
    await sendMessage(chatId, text, getAdminMenuKeyboard());
}

async function showAdminSlotFamilyConfig(chatId, messageId) {
    const db = loadDB();
    const slotProd = getCustomSlotProductObj(db);
    const isOut = isSlotFamilyOutOfStock(slotProd);
    const statusBadge = isOut
        ? '🔴 Hết hàng'
        : ('🟢 ' + escapeHTML(slotProd.stock));

    const text =
        '🛠️ <b>QUẢN LÝ SẢN PHẨM: SLOT FAMILY GEMINI PRO</b>\n\n' +
        '📦 Tên sản phẩm: <b>' + escapeHTML(slotProd.name) + '</b>\n' +
        '💵 Giá bán hiện tại: <b>' + slotProd.price.toLocaleString('vi-VN') + 'đ</b>\n' +
        '📊 Trạng thái kho: <b>' + statusBadge + '</b>\n' +
        '👁️ Hiển thị trên menu: <code>' + escapeHTML(slotProd.name) + ' | ' + slotProd.price.toLocaleString('vi-VN') + 'đ (Kho: ' + escapeHTML(slotProd.stock) + ')</code>\n' +
        '────────────────────\n' +
        '📝 <b>MÔ TẢ & LƯU Ý HIỆN TẠI (Hiện khi khách nhấn vào SP):</b>\n' +
        slotProd.description + '\n' +
        '────────────────────\n' +
        '👇 <i>Chọn chức năng điều chỉnh bên dưới:</i>';

    const kb = {
        inline_keyboard: [
            [
                { text: '💵 Điều chỉnh mức giá bán', callback_data: 'admin_slot_set_price' }
            ],
            [
                { text: '📝 Sửa Mô tả & Lưu ý sản phẩm', callback_data: 'admin_slot_set_desc' },
                { text: '🔄 Khôi phục Mô tả gốc', callback_data: 'admin_slot_reset_desc' }
            ],
            [
                { text: '🟢 Đặt: Sẵn hàng', callback_data: 'admin_slot_stock_sanhang' },
                { text: '🟢 Đặt: Còn hàng', callback_data: 'admin_slot_stock_conhang' }
            ],
            [
                { text: '🔴 Đặt: Hết hàng (Khóa mua)', callback_data: 'admin_slot_stock_hethang' }
            ],
            [
                { text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }
            ]
        ]
    };
    await editOrSendMessage(chatId, messageId, text, kb);
}

async function showAdminTrafficStats(chatId, messageId) {
    const db = loadDB();
    const dailyVisits = db.daily_visits || {};
    const now = new Date();
    const todayKey = getVNDateKey(now);
    const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayKey = getVNDateKey(yesterdayDate);
    const todayList = Array.isArray(dailyVisits[todayKey]) ? dailyVisits[todayKey] : [];
    const yesterdayList = Array.isArray(dailyVisits[yesterdayKey]) ? dailyVisits[yesterdayKey] : [];
    const unique7Days = new Set();
    const unique30Days = new Set();
    const last14DaysRows = [];
    for (let i = 0; i < 30; i++) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = getVNDateKey(d);
        const ids = Array.isArray(dailyVisits[key]) ? dailyVisits[key] : [];
        if (i < 7) {
            ids.forEach(id => unique7Days.add(String(id)));
        }
        ids.forEach(id => unique30Days.add(String(id)));
        if (i < 14) {
            const suffix = i === 0 ? ' (Hôm nay) 🔥' : (i === 1 ? ' (Hôm qua)' : '');
            last14DaysRows.push('• <code>' + formatDateKeyVN(key) + '</code>: <b>' + ids.length + ' người</b> (ID)' + suffix);
        }
    }
    const totalAllTimeUsers = Object.keys(db.users || {}).length;
    const text =
        '📈 <b>THỐNG KÊ LƯỢT TRUY CẬP BOT (TÍNH THEO ID)</b>\n' +
        '<i>(Mỗi ID người dùng chỉ được tính 1 lần duy nhất trong ngày)</i>\n\n' +
        '🟢 <b>Hôm nay (' + formatDateKeyVN(todayKey) + '):</b> <b>' + todayList.length + ' người</b>\n' +
        '🕒 <b>Hôm qua (' + formatDateKeyVN(yesterdayKey) + '):</b> <b>' + yesterdayList.length + ' người</b>\n' +
        '📅 <b>7 ngày gần nhất (ID duy nhất):</b> <b>' + unique7Days.size + ' người</b>\n' +
        '🗓️ <b>30 ngày gần nhất (ID duy nhất):</b> <b>' + unique30Days.size + ' người</b>\n' +
        '👥 <b>Tổng ID đã từng vào Bot:</b> <b>' + totalAllTimeUsers + ' người</b>\n\n' +
        '📊 <b>CHI TIẾT 14 NGÀY GẦN NHẤT:</b>\n' +
        last14DaysRows.join('\n') + '\n\n' +
        '🕒 <i>Cập nhật lúc: ' + escapeHTML(formatVNTime(now.toISOString())) + '</i>';
    const kb = {
        inline_keyboard: [
            [
                { text: '👁️ Xem DS ' + todayList.length + ' ID vào hôm nay', callback_data: 'admin_traffic_today_ids' },
                { text: '🔄 Làm mới', callback_data: 'admin_traffic_stats' }
            ],
            [
                { text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }
            ]
        ]
    };
    await editOrSendMessage(chatId, messageId, text, kb);
}

async function showAdminTodayVisitorIds(chatId, messageId) {
    const db = loadDB();
    const todayKey = getVNDateKey();
    const todayIds = (db.daily_visits && Array.isArray(db.daily_visits[todayKey])) ? db.daily_visits[todayKey] : [];
    if (todayIds.length === 0) {
        return editOrSendMessage(
            chatId,
            messageId,
            '📭 <b>Hôm nay (' + formatDateKeyVN(todayKey) + ') chưa có ID nào truy cập.</b>',
            {
                inline_keyboard: [
                    [{ text: '🔙 Quay lại Thống kê', callback_data: 'admin_traffic_stats' }],
                    [{ text: '⚙️ Bảng Admin', callback_data: 'admin_panel' }]
                ]
            }
        );
    }
    const displayIds = todayIds.slice(-50).reverse();
    const lines = displayIds.map((uid, idx) => {
        const u = (db.users && db.users[uid]) ? db.users[uid] : {};
        const name = u.username || 'Khách';
        const bal = Number(u.balance || 0).toLocaleString('vi-VN');
        const lastActive = u.last_active ? formatVNTime(u.last_active) : 'Hôm nay';
        return (idx + 1) + '. <b>' + escapeHTML(name) + '</b> — ID: <code>' + escapeHTML(uid) + '</code>\n   💰 Ví: <b>' + bal + 'đ</b> | 🕒 ' + escapeHTML(lastActive);
    });
    const extraNote = todayIds.length > 50
        ? ('\n\n<i>(Đang hiển thị 50/' + todayIds.length + ' ID truy cập gần nhất trong hôm nay)</i>')
        : '';
    const text =
        '👥 <b>DANH SÁCH ID TRUY CẬP HÔM NAY (' + formatDateKeyVN(todayKey) + ')</b>\n' +
        '🟢 Tổng cộng: <b>' + todayIds.length + ' người (ID duy nhất)</b>\n\n' +
        lines.join('\n') + extraNote;
    await editOrSendMessage(chatId, messageId, text, {
        inline_keyboard: [
            [
                { text: '✉️ Nhắn tin cho Khách theo ID', callback_data: 'admin_send_dm' }
            ],
            [
                { text: '🔄 Làm mới DS', callback_data: 'admin_traffic_today_ids' },
                { text: '🔙 Quay lại Thống kê', callback_data: 'admin_traffic_stats' }
            ],
            [
                { text: '⚙️ Về Bảng Admin', callback_data: 'admin_panel' }
            ]
        ]
    });
}

async function showShopMenuPage(chatId, user, page, messageId) {
    const pageNum = page || 1;
    let db = loadDB();
    if (db.products.length === 0) {
        await syncCatalogFromSource();
        db = loadDB();
    }
    if (db.products.length === 0) {
        return editOrSendMessage(
            chatId,
            messageId,
            '⏳ <b>Cửa hàng đang cập nhật sản phẩm mới, vui lòng quay lại sau ít phút!</b>',
            { inline_keyboard: [[{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]] }
        );
    }
    const sortedProducts = sortProductsWithPinnedFirst(db.products, db);
    const totalProducts = sortedProducts.length;
    const totalPages = Math.ceil(totalProducts / PRODUCTS_PER_PAGE);
    const currentPage = Math.max(1, Math.min(pageNum, totalPages));
    const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
    const pageItems = sortedProducts.slice(startIndex, startIndex + PRODUCTS_PER_PAGE);
    const buttons = pageItems.map(p => {
        const pinBadge = p.is_pinned ? '📌 ' : '';
        return [{
            text: pinBadge + p.name + ' | ' + p.price.toLocaleString('vi-VN') + 'đ (Kho: ' + p.stock + ')',
            callback_data: 'buy_' + p.id
        }];
    });
    if (totalPages > 1) {
        const navRow = [];
        if (currentPage > 1) {
            navRow.push({ text: '⬅️ Trang trước', callback_data: 'menu_shop_' + (currentPage - 1) });
        }
        navRow.push({ text: '📄 ' + currentPage + '/' + totalPages, callback_data: 'noop' });
        if (currentPage < totalPages) {
            navRow.push({ text: 'Trang sau ➡️', callback_data: 'menu_shop_' + (currentPage + 1) });
        }
        buttons.push(navRow);
    }
    buttons.push([{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]);
    const text =
        '🛒 <b>DANH SÁCH SẢN PHẨM (Trang ' + currentPage + '/' + totalPages + ')</b>\n' +
        '📦 Tổng cộng: <b>' + totalProducts + ' sản phẩm</b>\n' +
        '💰 Số dư của bạn: <b>' + user.balance.toLocaleString('vi-VN') + 'đ</b>\n\n' +
        '👇 <i>Bấm vào sản phẩm bạn muốn mua:</i>';
    await editOrSendMessage(chatId, messageId, text, { inline_keyboard: buttons });
}

async function showAdminPinManagerPage(chatId, page, messageId) {
    const pageNum = page || 1;
    const db = loadDB();
    db.products = sortProductsWithPinnedFirst(db.products, db);
    saveDB(db);
    const totalProducts = db.products.length;
    const totalPages = Math.max(1, Math.ceil(totalProducts / PRODUCTS_PER_PAGE));
    const currentPage = Math.max(1, Math.min(pageNum, totalPages));
    const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
    const pageItems = db.products.slice(startIndex, startIndex + PRODUCTS_PER_PAGE);
    const buttons = pageItems.map(p => {
        const statusIcon = p.is_pinned ? '📌 [ĐANG GHIM]' : '⬜ [Chưa ghim]';
        return [{
            text: statusIcon + ' ' + p.name,
            callback_data: 'admin_togglepin_' + p.id + '_' + currentPage
        }];
    });
    if (totalPages > 1) {
        const navRow = [];
        if (currentPage > 1) {
            navRow.push({ text: '⬅️ Trước', callback_data: 'admin_pin_page_' + (currentPage - 1) });
        }
        navRow.push({ text: '📄 ' + currentPage + '/' + totalPages, callback_data: 'noop' });
        if (currentPage < totalPages) {
            navRow.push({ text: 'Sau ➡️', callback_data: 'admin_pin_page_' + (currentPage + 1) });
        }
        buttons.push(navRow);
    }
    buttons.push([{ text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }]);
    const text =
        '📌 <b>QUẢN LÝ GHIM SẢN PHẨM LÊN ĐẦU TRANG 1 (Trang ' + currentPage + '/' + totalPages + ')</b>\n\n' +
        '• Sản phẩm có dấu <b>📌 [ĐANG GHIM]</b> sẽ luôn nằm ở đầu Trang 1.\n' +
        '• Bấm vào tên sản phẩm bên dưới để <b>Ghim</b> hoặc <b>Bỏ ghim</b>:';
    await editOrSendMessage(chatId, messageId, text, { inline_keyboard: buttons });
}

function parseFlexibleAmount(rawStr) {
    if (!rawStr) return NaN;
    let s = String(rawStr).trim().toLowerCase().replace(/,/g, '').replace(/\./g, '');
    let multiplier = 1;
    if (s.endsWith('k')) {
        multiplier = 1000;
        s = s.slice(0, -1);
    } else if (s.endsWith('đ') || s.endsWith('d')) {
        s = s.slice(0, -1);
    }
    const num = Number(s);
    if (isNaN(num) || num === 0) return NaN;
    return Math.round(num * multiplier);
}

function isDigitsOnly(str) {
    if (!str || typeof str !== 'string') return false;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charAt(i);
        if (ch < '0' || ch > '9') return false;
    }
    return true;
}

// ================= 6. XỬ LÝ TIN NHẮN & NÚT BẤM =================
async function handleUpdate(update) {
    try {
        if (update.message && update.message.text) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const username = msg.from.first_name || msg.from.username || 'Khách';
            const text = msg.text.trim();
            const user = getUser(userId, username);

            // 0. Xử lý khi Khách hàng nhập Gmail sau khi thanh toán "Slot Family gemini Pro"
            let pendingGmailOrderId = awaitingSlotGmailUsers[userId];
            if (!pendingGmailOrderId && !text.startsWith('/')) {
                const dbCheck = loadDB();
                const foundWaitingOrder = (dbCheck.orders || []).find(
                    o => String(o.user_id) === String(userId) && o.is_manual_slot && o.status === 'awaiting_gmail'
                );
                if (foundWaitingOrder && isValidGmail(text)) {
                    pendingGmailOrderId = foundWaitingOrder.order_id;
                }
            }
            if (pendingGmailOrderId && !text.startsWith('/')) {
                if (!isValidGmail(text)) {
                    await sendMessage(
                        chatId,
                        '❌ <b>Địa chỉ Gmail không hợp lệ!</b>\n\n' +
                        '👉 Vui lòng nhập đúng định dạng Gmail của bạn (Ví dụ: <code>tenban@gmail.com</code>) để gửi tới Admin:',
                        { inline_keyboard: [[{ text: '💬 Liên hệ Hỗ trợ', callback_data: 'menu_support' }]] }
                    );
                    return;
                }
                const customerGmail = text.trim();
                delete awaitingSlotGmailUsers[userId];
                const db = loadDB();
                const order = db.orders.find(
                    o => String(o.order_id) === String(pendingGmailOrderId) && String(o.user_id) === String(userId)
                );
                if (!order) {
                    await sendMessage(chatId, '❌ Không tìm thấy đơn hàng cần cập nhật Gmail!');
                    return;
                }
                order.customer_gmail = customerGmail;
                order.status = 'pending_approval';
                order.gmail_submitted_at = new Date().toISOString();
                order.delivered_product = '⏳ Đang chờ Admin duyệt cho Gmail: ' + customerGmail;
                saveDB(db);

                await sendMessage(
                    chatId,
                    '📨 <b>ĐÃ GỬI GMAIL TỚI ADMIN THÀNH CÔNG!</b>\n\n' +
                    '🧾 Mã đơn hàng: <code>' + escapeHTML(order.order_id) + '</code>\n' +
                    '📦 Sản phẩm: <b>' + escapeHTML(order.product_name) + '</b>\n' +
                    '📧 Gmail của bạn: <code>' + escapeHTML(customerGmail) + '</code>\n' +
                    '📌 Trạng thái: <b>⏳ Đang chờ Admin duyệt</b>\n\n' +
                    '⚡ <i>Khi Admin bấm duyệt, Bot sẽ thông báo hoàn tất đơn hàng cho bạn ngay tại đây!</i>',
                    {
                        inline_keyboard: [
                            [{ text: '📜 Xem Lịch sử Mua hàng', callback_data: 'menu_history_1' }],
                            [{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]
                        ]
                    }
                );

                const adminNotifyText =
                    '🔔 <b>[ĐƠN HÀNG SLOT FAMILY CHỜ DUYỆT]</b>\n\n' +
                    '🧾 Mã đơn hàng: <code>' + escapeHTML(order.order_id) + '</code>\n' +
                    '📦 Sản phẩm: <b>' + escapeHTML(order.product_name) + '</b>\n' +
                    '👤 Khách hàng: <b>' + escapeHTML(username) + '</b> (ID: <code>' + userId + '</code>)\n' +
                    '💵 Đã thanh toán: <b>' + Number(order.price_charged || 0).toLocaleString('vi-VN') + 'đ</b>\n' +
                    '📧 <b>Gmail khách gửi (Chạm để sao chép):</b>\n<code>' + escapeHTML(customerGmail) + '</code>\n' +
                    '🕒 Thời gian gửi: <b>' + escapeHTML(formatVNTime(order.gmail_submitted_at)) + '</b>\n\n' +
                    '👇 <i>Sau khi thêm Gmail khách vào Family, hãy bấm nút <b>✅ Duyệt đơn hàng hoàn tất</b> bên dưới:</i>';
                const adminApproveKeyboard = {
                    inline_keyboard: [
                        [{ text: '✅ Duyệt đơn hàng hoàn tất (#' + order.order_id + ')', callback_data: 'admin_approve_order_' + order.order_id }],
                        [{ text: '✉️ Nhắn tin cho khách này', callback_data: 'admin_dm_to_' + userId }]
                    ]
                };
                await sendAdminInteractiveNotification(adminNotifyText, adminApproveKeyboard);
                await sendNotifyBotMessage(adminNotifyText);
                return;
            }

            // 1. Xử lý khi Khách hàng gửi tin nhắn phản hồi cho Admin
            if (awaitingCustomerReplyUsers[userId] && !text.startsWith('/')) {
                delete awaitingCustomerReplyUsers[userId];
                let sentToAdmin = false;
                const replyNotifyMsg =
                    '📩 <b>[TIN NHẮN MỚI TỪ KHÁCH HÀNG]</b>\n\n' +
                    '👤 Khách hàng: <b>' + escapeHTML(username) + '</b> (ID: <code>' + userId + '</code>)\n' +
                    '💰 Số dư hiện tại: <b>' + Number(user.balance || 0).toLocaleString('vi-VN') + 'đ</b>\n\n' +
                    '💬 <b>Nội dung:</b>\n' + escapeHTML(text);
                for (const adminId of loggedInAdmins) {
                    await sendMessage(
                        adminId,
                        replyNotifyMsg,
                        {
                            inline_keyboard: [
                                [{ text: '✉️ Bấm để Trả lời ngay khách này', callback_data: 'admin_dm_to_' + userId }]
                            ]
                        }
                    );
                    sentToAdmin = true;
                }
                await sendNotifyBotMessage(replyNotifyMsg);
                await sendMessage(
                    chatId,
                    '✅ <b>Đã gửi tin nhắn của bạn tới Admin!</b>\n' +
                    (sentToAdmin
                        ? 'Admin sẽ phản hồi lại cho bạn qua Bot trong thời gian sớm nhất.'
                        : ('Nếu cần gấp, bạn có thể nhắn trực tiếp qua: <b>' + escapeHTML(getSupportContact()) + '</b>')),
                    {
                        inline_keyboard: [
                            [{ text: '💬 Gửi thêm tin nhắn khác', callback_data: 'customer_reply_admin' }],
                            [{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]
                        ]
                    }
                );
                return;
            }

            // 2. Xử lý khi Admin nhắn tin riêng cho 1 khách hàng
            if (awaitingDirectMsgUsers[userId] && !text.startsWith('/')) {
                const mode = awaitingDirectMsgUsers[userId];
                let targetId = '';
                let msgContent = '';
                if (mode === 'ANY') {
                    const spaceIdx = text.indexOf(' ');
                    if (spaceIdx === -1) {
                        await sendMessage(
                            chatId,
                            '❌ <b>Sai cú pháp!</b> Vui lòng nhập: <code>ID_Khách Nội_dung_tin_nhắn</code>\n' +
                            'Ví dụ: <code>' + userId + ' Chào bạn, đơn hàng của bạn đã được xử lý nhé!</code>',
                            { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_panel' }]] }
                        );
                        return;
                    }
                    targetId = text.substring(0, spaceIdx).trim();
                    msgContent = text.substring(spaceIdx + 1).trim();
                } else {
                    targetId = String(mode);
                    msgContent = text;
                }
                if (!isDigitsOnly(targetId) || !msgContent) {
                    await sendMessage(
                        chatId,
                        '❌ <b>ID khách hàng phải là dãy số và nội dung không được để trống!</b>\n' +
                        'Vui lòng nhập lại theo cú pháp: <code>ID_Khách Nội_dung_tin_nhắn</code>',
                        { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_panel' }]] }
                    );
                    return;
                }
                delete awaitingDirectMsgUsers[userId];
                const db = loadDB();
                const targetName = (db.users[targetId] && db.users[targetId].username) ? db.users[targetId].username : 'Khách';
                await sendMessage(
                    targetId,
                    '📩 <b>TIN NHẮN TỪ ADMIN SHOP AI TECH:</b>\n\n' +
                    escapeHTML(msgContent) + '\n\n' +
                    '💡 <i>Bạn có thể bấm nút <b>💬 Phản hồi lại Admin</b> bên dưới để trả lời trực tiếp!</i>',
                    {
                        inline_keyboard: [
                            [{ text: '💬 Phản hồi lại Admin', callback_data: 'customer_reply_admin' }],
                            [{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]
                        ]
                    }
                );
                await sendMessage(
                    chatId,
                    '✅ <b>ĐÃ GỬI TIN NHẮN CHO KHÁCH HÀNG!</b>\n\n' +
                    '👤 Người nhận: <b>' + escapeHTML(targetName) + '</b> (ID: <code>' + escapeHTML(targetId) + '</code>)\n' +
                    '📝 <b>Nội dung đã gửi:</b>\n' + escapeHTML(msgContent),
                    {
                        inline_keyboard: [
                            [{ text: '✉️ Nhắn tiếp cho khách này', callback_data: 'admin_dm_to_' + targetId }],
                            [{ text: '✉️ Nhắn cho khách khác', callback_data: 'admin_send_dm' }],
                            [{ text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }]
                        ]
                    }
                );
                return;
            }

            // 3. Xử lý khi Admin gửi thông báo cho toàn bộ khách hàng (Broadcast)
            if (awaitingBroadcastUsers[userId] && !text.startsWith('/')) {
                delete awaitingBroadcastUsers[userId];
                const db = loadDB();
                const allUserIds = Object.keys(db.users || {});
                await sendMessage(chatId, '⏳ Đang gửi thông báo tới <b>' + allUserIds.length + ' khách hàng</b>, vui lòng chờ...');
                let sentCount = 0;
                for (const uid of allUserIds) {
                    try {
                        await sendMessage(
                            uid,
                            '📢 <b>THÔNG BÁO TỪ SHOP AI TECH:</b>\n\n' +
                            escapeHTML(text),
                            {
                                inline_keyboard: [
                                    [{ text: '🛒 Xem Sản phẩm ngay', callback_data: 'menu_shop_1' }],
                                    [{ text: '💬 Liên hệ / Nhắn Admin', callback_data: 'customer_reply_admin' }]
                                ]
                            }
                        );
                        sentCount++;
                        await new Promise(r => setTimeout(r, 50));
                    } catch (e) {}
                }
                await sendMessage(
                    chatId,
                    '✅ <b>ĐÃ GỬI THÔNG BÁO HOÀN TẤT!</b>\n\n' +
                    '📊 Đã gửi tới: <b>' + sentCount + '/' + allUserIds.length + ' khách hàng</b>.',
                    { inline_keyboard: [[{ text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }]] }
                );
                return;
            }

            // 4. Xử lý cộng / trừ tiền ví
            if (awaitingBalanceAdjustUsers[userId] && !text.startsWith('/')) {
                const parts = text.split(/\s+/);
                let targetUserId = String(userId);
                let amount = NaN;
                if (parts.length === 1) {
                    amount = parseFlexibleAmount(parts[0]);
                } else if (parts.length >= 2) {
                    targetUserId = parts[0].trim();
                    amount = parseFlexibleAmount(parts[1]);
                }
                if (isNaN(amount) || !isDigitsOnly(targetUserId)) {
                    await sendMessage(
                        chatId,
                        '❌ <b>Cú pháp không hợp lệ!</b>\n\n' +
                        '👉 Nhập <b>1 số</b> để cộng/trừ cho chính bạn (VD: <code>100000</code> hoặc <code>-50000</code> hoặc <code>50k</code>)\n' +
                        '👉 Hoặc nhập <b>ID_Khách Số_Tiền</b> để cộng/trừ cho khách (VD: <code>' + userId + ' 50000</code> hoặc <code>' + userId + ' -20000</code>):',
                        { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_panel' }]] }
                    );
                    return;
                }
                delete awaitingBalanceAdjustUsers[userId];
                const db = loadDB();
                const targetName = (db.users[targetUserId] && db.users[targetUserId].username)
                    ? db.users[targetUserId].username
                    : (String(targetUserId) === String(userId) ? username : 'Khách');
                const newBal = updateBalance(targetUserId, amount, targetName);
                const signStr = amount > 0 ? ('+' + amount.toLocaleString('vi-VN') + 'đ') : (amount.toLocaleString('vi-VN') + 'đ');
                const actionTitle = amount > 0 ? 'CỘNG TIỀN' : 'TRỪ TIỀN';
                await sendMessage(
                    chatId,
                    '✅ <b>ĐÃ ' + actionTitle + ' THÀNH CÔNG!</b>\n\n' +
                    '👤 Tài khoản: <b>' + escapeHTML(targetName) + '</b> (ID: <code>' + escapeHTML(targetUserId) + '</code>)\n' +
                    '💸 Số tiền điều chỉnh: <b>' + signStr + '</b>\n' +
                    '💰 Số dư mới: <b>' + newBal.toLocaleString('vi-VN') + 'đ</b>',
                    {
                        inline_keyboard: [
                            [{ text: '💰 Tiếp tục Cộng / Trừ tiền', callback_data: 'admin_adjust_balance' }],
                            [{ text: '✉️ Nhắn tin cho khách này', callback_data: 'admin_dm_to_' + targetUserId }],
                            [{ text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }]
                        ]
                    }
                );
                if (String(targetUserId) !== String(chatId)) {
                    await sendMessage(
                        targetUserId,
                        '🔔 <b>THÔNG BÁO BIẾN ĐỘNG SỐ DƯ</b>\n\n' +
                        'Admin vừa điều chỉnh số dư tài khoản của bạn: <b>' + signStr + '</b>\n' +
                        '💰 Số dư hiện tại: <b>' + newBal.toLocaleString('vi-VN') + 'đ</b>'
                    );
                }
                return;
            }

            // 4.1. Xử lý khi Admin nhập giá mới cho Slot Family Gemini Pro
            if (awaitingSlotPriceUsers[userId] && !text.startsWith('/')) {
                const newPrice = parseFlexibleAmount(text);
                if (isNaN(newPrice) || newPrice < 0) {
                    await sendMessage(
                        chatId,
                        '❌ <b>Mức giá không hợp lệ!</b>\n\n' +
                        '👉 Vui lòng nhập số tiền hợp lệ (Ví dụ: <code>50000</code> hoặc <code>50k</code>):',
                        { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_slot_family_config' }]] }
                    );
                    return;
                }
                delete awaitingSlotPriceUsers[userId];
                const db = loadDB();
                db.settings.slot_family_price = newPrice;
                db.products = sortProductsWithPinnedFirst(db.products, db);
                saveDB(db);
                await sendMessage(
                    chatId,
                    '✅ <b>ĐÃ CẬP NHẬT GIÁ BÁN THÀNH CÔNG!</b>\n\n' +
                    '📦 Sản phẩm: <b>' + escapeHTML(CUSTOM_SLOT_DEFAULT_NAME) + '</b>\n' +
                    '💵 Giá bán mới: <b>' + newPrice.toLocaleString('vi-VN') + 'đ</b>',
                    {
                        inline_keyboard: [
                            [{ text: '🛠️ Quay lại Quản lý Slot Family', callback_data: 'admin_slot_family_config' }],
                            [{ text: '⚙️ Về Bảng Admin', callback_data: 'admin_panel' }]
                        ]
                    }
                );
                return;
            }

            // 4.2. Xử lý khi Admin nhập Mô tả & Lưu ý mới cho Slot Family Gemini Pro
            if (awaitingSlotDescUsers[userId] && !text.startsWith('/')) {
                delete awaitingSlotDescUsers[userId];
                const db = loadDB();
                db.settings.slot_family_description = text;
                db.products = sortProductsWithPinnedFirst(db.products, db);
                saveDB(db);
                await sendMessage(
                    chatId,
                    '✅ <b>ĐÃ CẬP NHẬT MÔ TẢ & LƯU Ý SẢN PHẨM THÀNH CÔNG!</b>\n\n' +
                    '📦 Sản phẩm: <b>' + escapeHTML(CUSTOM_SLOT_DEFAULT_NAME) + '</b>\n' +
                    '────────────────────\n' +
                    '📝 <b>Nội dung hiển thị khi khách nhấn mua:</b>\n' +
                    text + '\n' +
                    '────────────────────',
                    {
                        inline_keyboard: [
                            [{ text: '🛠️ Quay lại Quản lý Slot Family', callback_data: 'admin_slot_family_config' }],
                            [{ text: '⚙️ Về Bảng Admin', callback_data: 'admin_panel' }]
                        ]
                    }
                );
                return;
            }

            // 5. Xử lý đổi liên hệ hỗ trợ
            if (awaitingSupportContactUsers[userId] && !text.startsWith('/')) {
                delete awaitingSupportContactUsers[userId];
                const db = loadDB();
                db.settings.support_contact = text;
                saveDB(db);
                await sendMessage(
                    chatId,
                    '✅ <b>Đã cập nhật thông tin Liên hệ Hỗ trợ / Bảo hành thành:</b>\n👉 <b>' + escapeHTML(text) + '</b>',
                    { inline_keyboard: [[{ text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }]] }
                );
                return;
            }

            // 6. Xử lý nhập mật khẩu Admin
            if (awaitingPasswordUsers[userId] && !text.startsWith('/')) {
                delete awaitingPasswordUsers[userId];
                if (text === ADMIN_PASSWORD) {
                    loggedInAdmins.add(userId);
                    await deleteMessage(chatId, msg.message_id);
                    await sendMessage(chatId, '✅ <b>Xác thực mật khẩu thành công!</b>');
                    await showAdminPanel(chatId);
                } else {
                    await sendMessage(chatId, '❌ <b>Mật khẩu không chính xác! Đã hủy yêu cầu truy cập.</b>');
                }
                return;
            }

            const command = text.split(' ')[0].split('@')[0].toLowerCase();
            if (command === '/doanthanhbao22' || command === '/admin') {
                clearUserStates(userId);
                awaitingPasswordUsers[userId] = true;
                await sendMessage(chatId, '🔐 <b>Vui lòng nhập mật khẩu Admin:</b>');
                return;
            }
            if (command === '/xuatexcel') {
                clearUserStates(userId);
                const isAdminUser = loggedInAdmins.has(userId);
                await exportOrdersToExcelAndSend(chatId, userId, isAdminUser);
                return;
            }
            if (command === '/start' || command === '/menu') {
                clearUserStates(userId);
                await showCustomerMainMenu(chatId, user);
                return;
            }
            if (command === '/muahang' || command === '/shop') {
                clearUserStates(userId);
                await showShopMenuPage(chatId, user, 1);
                return;
            }
            if (command === '/lichsu' || command === '/donhang' || command === '/history') {
                clearUserStates(userId);
                await showOrderHistoryPage(chatId, userId, 1);
                return;
            }
            if (command === '/naptien') {
                clearUserStates(userId);
                await sendDepositQR(chatId, userId);
                return;
            }
            if (command === '/taikhoan') {
                clearUserStates(userId);
                await showUserProfile(chatId, user);
                return;
            }
            if (command === '/hotro') {
                clearUserStates(userId);
                await showSupportInfo(chatId);
                return;
            }
        }

        if (update.callback_query) {
            const cb = update.callback_query;
            answerCallback(cb.id);
            if (!cb.message || !cb.message.chat) return;
            const chatId = cb.message.chat.id;
            const messageId = cb.message.message_id;
            const userId = cb.from.id;
            const username = cb.from.first_name || cb.from.username || 'Khách';
            const action = cb.data || '';
            const user = getUser(userId, username);
            if (action === 'noop') return;

            const isAuthorizedAdmin = loggedInAdmins.has(userId) || (NOTIFY_CHAT_ID && String(userId) === String(NOTIFY_CHAT_ID).trim());
            if (action.startsWith('admin_') && !isAuthorizedAdmin) {
                return sendMessage(chatId, '🔒 Phiên đăng nhập Admin đã hết hạn. Vui lòng gõ <code>/doanthanhbao22</code> và nhập lại mật khẩu!');
            }

            if (action === 'menu_home') {
                clearUserStates(userId);
                await showCustomerMainMenu(chatId, user);
            }
            else if (action === 'customer_reply_admin') {
                clearUserStates(userId);
                awaitingCustomerReplyUsers[userId] = true;
                await sendMessage(
                    chatId,
                    '💬 <b>NHẮN TIN TRỰC TIẾP CHO ADMIN</b>\n\n' +
                    '👉 Vui lòng nhập nội dung bạn muốn nhắn (cần hỗ trợ, bảo hành hoặc hỏi đáp) vào khung chat bên dưới và gửi đi:',
                    { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'menu_home' }]] }
                );
            }
            else if (action === 'menu_profile') {
                await showUserProfile(chatId, user);
            }
            else if (action === 'menu_support') {
                await showSupportInfo(chatId);
            }
            else if (action === 'export_my_orders_excel') {
                await exportOrdersToExcelAndSend(chatId, userId, false);
            }
            else if (action === 'menu_history' || action.startsWith('menu_history_')) {
                const pageNum = action.startsWith('menu_history_')
                    ? parseInt(action.replace('menu_history_', ''), 10) || 1
                    : 1;
                await showOrderHistoryPage(chatId, userId, pageNum, messageId);
            }
            else if (action.startsWith('order_detail_')) {
                const rawParams = action.replace('order_detail_', '');
                const lastUnderscore = rawParams.lastIndexOf('_');
                let orderIdStr = rawParams;
                let backPage = 1;
                if (lastUnderscore > -1) {
                    orderIdStr = rawParams.substring(0, lastUnderscore);
                    backPage = parseInt(rawParams.substring(lastUnderscore + 1), 10) || 1;
                }
                await showOrderDetail(chatId, userId, orderIdStr, backPage, messageId);
            }
            else if (action === 'menu_shop' || action.startsWith('menu_shop_')) {
                const pageNum = action.startsWith('menu_shop_')
                    ? parseInt(action.replace('menu_shop_', ''), 10) || 1
                    : 1;
                await showShopMenuPage(chatId, user, pageNum, messageId);
            }
            else if (action.startsWith('buy_')) {
                const db = loadDB();
                const sorted = sortProductsWithPinnedFirst(db.products, db);
                const prodId = action.replace('buy_', '');
                const product = sorted.find(p => p.id === prodId) || db.products.find(p => p.id === prodId);
                if (!product) return sendMessage(chatId, '❌ Sản phẩm không tồn tại!');

                // Nếu là "Slot Family gemini Pro" -> Kiểm tra tồn kho trước, sau đó hiện Lưu ý / Mô tả
                if (isCustomSlotProduct(product)) {
                    if (isSlotFamilyOutOfStock(product)) {
                        return sendMessage(
                            chatId,
                            '⚠️ <b>THÔNG BÁO HẾT HÀNG</b>\n\n' +
                            'Sản phẩm <b>' + escapeHTML(product.name) + '</b> hiện đang <b>Hết hàng</b>.\n' +
                            'Vui lòng quay lại sau hoặc liên hệ Admin hỗ trợ: <b>' + escapeHTML(getSupportContact()) + '</b>',
                            { inline_keyboard: [[{ text: '🔙 Quay lại Cửa hàng', callback_data: 'menu_shop_1' }]] }
                        );
                    }
                    const slotDesc = (db.settings && db.settings.slot_family_description)
                        ? db.settings.slot_family_description
                        : CUSTOM_SLOT_DEFAULT_DESCRIPTION;
                    const noteText =
                        '🌟 <b>THÔNG TIN & LƯU Ý SẢN PHẨM</b>\n\n' +
                        '📦 Sản phẩm: <b>' + escapeHTML(product.name) + '</b>\n' +
                        '💵 Giá bán: <b>' + product.price.toLocaleString('vi-VN') + 'đ</b>\n' +
                        '📦 Tình trạng: <b>' + escapeHTML(product.stock) + '</b>\n' +
                        '────────────────────\n' +
                        slotDesc + '\n' +
                        '────────────────────\n' +
                        '💰 Số dư hiện tại của bạn: <b>' + user.balance.toLocaleString('vi-VN') + 'đ</b>\n\n' +
                        '👇 <i>Vui lòng đọc kỹ lưu ý trên và nhấn <b>➡️ Tiếp tục mua hàng</b> bên dưới:</i>';
                    await sendMessage(chatId, noteText, {
                        inline_keyboard: [
                            [{ text: '➡️ Tiếp tục mua hàng', callback_data: 'proceed_buy_' + product.id }],
                            [{ text: '🔙 Quay lại Cửa hàng', callback_data: 'menu_shop_1' }]
                        ]
                    });
                    return;
                }

                const text =
                    '📦 <b>XÁC NHẬN ĐƠN HÀNG</b>\n\n' +
                    '🔹 Sản phẩm: <b>' + escapeHTML(product.name) + '</b>\n' +
                    '💵 Giá bán: <b>' + product.price.toLocaleString('vi-VN') + 'đ</b>\n' +
                    '📦 Tồn kho: <b>' + escapeHTML(product.stock) + '</b>\n' +
                    '💰 Số dư hiện tại: <b>' + user.balance.toLocaleString('vi-VN') + 'đ</b>\n\n' +
                    'Nhấn nút bên dưới để thanh toán và nhận sản phẩm ngay lập tức:';
                await sendMessage(chatId, text, {
                    inline_keyboard: [
                        [{ text: '✅ Thanh toán ngay (' + product.price.toLocaleString('vi-VN') + 'đ)', callback_data: 'confirm_' + product.id }],
                        [{ text: '🔙 Quay lại Cửa hàng', callback_data: 'menu_shop_1' }]
                    ]
                });
            }
            else if (action.startsWith('proceed_buy_')) {
                const db = loadDB();
                const sorted = sortProductsWithPinnedFirst(db.products, db);
                const prodId = action.replace('proceed_buy_', '');
                const product = sorted.find(p => p.id === prodId) || db.products.find(p => p.id === prodId);
                if (!product) return sendMessage(chatId, '❌ Sản phẩm không tồn tại!');

                if (isCustomSlotProduct(product) && isSlotFamilyOutOfStock(product)) {
                    return sendMessage(
                        chatId,
                        '❌ <b>Sản phẩm "' + escapeHTML(product.name) + '" hiện đã Hết hàng, không thể thanh toán lúc này!</b>',
                        { inline_keyboard: [[{ text: '🔙 Quay lại Cửa hàng', callback_data: 'menu_shop_1' }]] }
                    );
                }

                const text =
                    '📦 <b>XÁC NHẬN MUA HÀNG & THANH TOÁN</b>\n\n' +
                    '🔹 Sản phẩm: <b>' + escapeHTML(product.name) + '</b>\n' +
                    '💵 Giá thanh toán: <b>' + product.price.toLocaleString('vi-VN') + 'đ</b>\n' +
                    '📦 Tình trạng: <b>' + escapeHTML(product.stock) + '</b>\n' +
                    '💰 Số dư hiện tại: <b>' + user.balance.toLocaleString('vi-VN') + 'đ</b>\n\n' +
                    '📧 <i>Sau khi thanh toán thành công, bạn sẽ nhập địa chỉ Gmail của mình để gửi tới Admin duyệt nâng cấp!</i>\n\n' +
                    '👇 Nhấn nút bên dưới để tiến hành thanh toán:';
                await editOrSendMessage(chatId, messageId, text, {
                    inline_keyboard: [
                        [{ text: '✅ Thanh toán ngay (' + product.price.toLocaleString('vi-VN') + 'đ)', callback_data: 'confirm_' + product.id }],
                        [{ text: '🔙 Xem lại Lưu ý / Mô tả', callback_data: 'buy_' + product.id }],
                        [{ text: '🏠 Quay lại Cửa hàng', callback_data: 'menu_shop_1' }]
                    ]
                });
            }
            else if (action.startsWith('confirm_')) {
                if (buyingLocks.has(userId)) {
                    return sendMessage(chatId, '⏳ <b>Đơn hàng trước của bạn đang được xử lý, vui lòng không bấm nhiều lần!</b>');
                }
                const db = loadDB();
                const sorted = sortProductsWithPinnedFirst(db.products, db);
                const prodId = action.replace('confirm_', '');
                const product = sorted.find(p => p.id === prodId) || db.products.find(p => p.id === prodId);
                if (!product) return sendMessage(chatId, '❌ Sản phẩm không hợp lệ!');

                if (isCustomSlotProduct(product) && isSlotFamilyOutOfStock(product)) {
                    return sendMessage(
                        chatId,
                        '❌ <b>Sản phẩm "' + escapeHTML(product.name) + '" hiện đã Hết hàng, số dư của bạn không bị trừ!</b>',
                        { inline_keyboard: [[{ text: '🔙 Quay lại Cửa hàng', callback_data: 'menu_shop_1' }]] }
                    );
                }

                const freshUser = getUser(userId, username);
                if (freshUser.balance < product.price) {
                    const missing = product.price - freshUser.balance;
                    return sendMessage(
                        chatId,
                        '❌ <b>SỐ DƯ KHÔNG ĐỦ!</b>\n\n' +
                        'Giá sản phẩm: <b>' + product.price.toLocaleString('vi-VN') + 'đ</b>\n' +
                        'Số dư của bạn: <b>' + freshUser.balance.toLocaleString('vi-VN') + 'đ</b>\n' +
                        'Cần nạp thêm: <b>' + missing.toLocaleString('vi-VN') + 'đ</b>',
                        {
                            inline_keyboard: [
                                [{ text: '💳 Nạp tiền ngay', callback_data: 'menu_deposit' }],
                                [{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]
                            ]
                        }
                    );
                }

                // XỬ LÝ RIÊNG CHO SẢN PHẨM "Slot Family gemini Pro"
                if (isCustomSlotProduct(product)) {
                    buyingLocks.add(userId);
                    try {
                        await deleteMessage(chatId, messageId);
                        const newBalance = updateBalance(userId, -product.price, username);
                        const currentDb = loadDB();
                        const orderCode = 'DH' + Date.now().toString().slice(-6);
                        const orderTimeIso = new Date().toISOString();
                        currentDb.orders.push({
                            order_id: orderCode,
                            user_id: userId,
                            product_name: product.name,
                            price_charged: product.price,
                            is_manual_slot: true,
                            status: 'awaiting_gmail',
                            customer_gmail: '',
                            delivered_product: '⏳ Đang chờ khách hàng nhập Gmail...',
                            time: orderTimeIso
                        });
                        saveDB(currentDb);
                        clearUserStates(userId);
                        awaitingSlotGmailUsers[userId] = orderCode;
                        await sendMessage(
                            chatId,
                            '✅ <b>THANH TOÁN ĐƠN HÀNG THÀNH CÔNG!</b>\n\n' +
                            '🧾 Mã đơn hàng: <code>' + orderCode + '</code>\n' +
                            '📦 Sản phẩm: <b>' + escapeHTML(product.name) + '</b>\n' +
                            '➖ Đã thanh toán: <b>' + product.price.toLocaleString('vi-VN') + 'đ</b>\n' +
                            '💰 Số dư còn lại: <b>' + newBalance.toLocaleString('vi-VN') + 'đ</b>\n\n' +
                            '📧 <b>BƯỚC TIẾP THEO (BẮT BUỘC):</b>\n' +
                            '👉 <b>Vui lòng nhập địa chỉ Gmail của bạn vào khung chat bên dưới và gửi đi</b> (Ví dụ: <code>tenban@gmail.com</code>) để hệ thống gửi tới Admin duyệt nâng cấp!'
                        );
                    } finally {
                        buyingLocks.delete(userId);
                    }
                    return;
                }

                buyingLocks.add(userId);
                await deleteMessage(chatId, messageId);
                await sendMessage(chatId, '⏳ <b>Đang kết nối kho và lấy sản phẩm cho bạn, vui lòng chờ...</b>');
                try {
                    const apiResult = await buyFromSourceAPI(product, 1);
                    if (apiResult.success) {
                        const formattedProduct = formatDeliveredProductFromSource(apiResult.data);
                        const newBalance = updateBalance(userId, -product.price, username);
                        const currentDb = loadDB();
                        const orderCode = 'DH' + Date.now().toString().slice(-6);
                        const orderTimeIso = new Date().toISOString();
                        currentDb.orders.push({
                            order_id: orderCode,
                            user_id: userId,
                            product_name: product.name,
                            price_charged: product.price,
                            delivered_product: formattedProduct,
                            api_response: apiResult.data,
                            time: orderTimeIso
                        });
                        saveDB(currentDb);

                        const formattedDisplayCustomer = formatProductDisplayForCustomer(formattedProduct);
                        const customerProductHtml = formattedDisplayCustomer.html;
                        const links = formattedDisplayCustomer.links;
                        const kb = [];
                        if (links.length > 0) {
                            kb.push([{ text: '🔗 Mở Link Sản Phẩm Ngay', url: links[0] }]);
                        }
                        kb.push([
                            { text: '🛒 Mua thêm SP', callback_data: 'menu_shop_1' },
                            { text: '📜 Lịch sử Mua hàng', callback_data: 'menu_history_1' }
                        ]);
                        kb.push([{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]);
                        await sendMessage(
                            chatId,
                            '✅ <b>MUA HÀNG & NHẬN SẢN PHẨM THÀNH CÔNG!</b>\n\n' +
                            '🧾 Mã đơn hàng: <code>' + orderCode + '</code>\n' +
                            '📦 Sản phẩm: <b>' + escapeHTML(product.name) + '</b>\n' +
                            '➖ Đã thanh toán: <b>' + product.price.toLocaleString('vi-VN') + 'đ</b>\n' +
                            '💰 Số dư còn lại: <b>' + newBalance.toLocaleString('vi-VN') + 'đ</b>\n\n' +
                            customerProductHtml + '\n\n' +
                            '💡 <i>Sản phẩm đã được lưu tự động vào mục <b>📜 Lịch sử Mua hàng</b>. Nếu cần hỗ trợ bảo hành, vui lòng liên hệ: ' + escapeHTML(getSupportContact()) + '</i>',
                            { inline_keyboard: kb }
                        );

                        const adminProductHtml = formatProductDisplayForAdmin(formattedProduct, apiResult.data);
                        const sourceCost = Number(product.source_price || 0);
                        const profit = Number(product.price || 0) - sourceCost;
                        const notifyOrderText =
                            '🔔 <b>[ĐƠN HÀNG MỚI THÀNH CÔNG]</b>\n' +
                            '🕒 Thời gian: <b>' + escapeHTML(formatVNTime(orderTimeIso)) + '</b>\n' +
                            '🧾 Mã đơn: <code>' + orderCode + '</code>\n' +
                            '👤 Khách hàng: <b>' + escapeHTML(user.username) + '</b> (ID: <code>' + userId + '</code>)\n' +
                            '📦 Sản phẩm: <b>' + escapeHTML(product.name) + '</b>\n' +
                            '💵 Giá bán thu về: <b>' + product.price.toLocaleString('vi-VN') + 'đ</b>\n' +
                            '🏷️ Giá vốn kho: <b>' + sourceCost.toLocaleString('vi-VN') + 'đ</b>\n' +
                            '📈 Lợi nhuận: <b>+' + profit.toLocaleString('vi-VN') + 'đ</b>\n' +
                            '💰 Ví khách còn: <b>' + newBalance.toLocaleString('vi-VN') + 'đ</b>\n\n' +
                            adminProductHtml;

                        await sendNotifyBotMessage(notifyOrderText);
                        for (const adminId of loggedInAdmins) {
                            if (String(adminId) !== String(chatId)) {
                                await sendMessage(
                                    adminId,
                                    notifyOrderText,
                                    {
                                        inline_keyboard: [
                                            [{ text: '✉️ Nhắn tin cho khách này', callback_data: 'admin_dm_to_' + userId }]
                                        ]
                                    }
                                );
                            }
                        }
                    } else {
                        await sendMessage(
                            chatId,
                            '⚠️ <b>THÔNG BÁO:</b>\n\n' +
                            'Hiện tại sản phẩm <b>' + escapeHTML(product.name) + '</b> đang tạm hết hàng hoặc kho đang bảo trì.\n' +
                            '💰 <b>Số dư của bạn (' + freshUser.balance.toLocaleString('vi-VN') + 'đ) được giữ nguyên, KHÔNG bị trừ!</b>',
                            { inline_keyboard: [[{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]] }
                        );
                        const errorAlertText =
                            '🚨 <b>[BÁO ĐỘNG LỖI KHO]</b>\n' +
                            'Khách <b>' + escapeHTML(user.username) + '</b> (<code>' + userId + '</code>) đặt mua <b>' + escapeHTML(product.name) + '</b> (Mã SP G: <code>' + escapeHTML(product.source_id) + '</code>) nhưng nguồn báo lỗi:\n' +
                            '<pre>' + escapeHTML(apiResult.error) + '</pre>';
                        await sendNotifyBotMessage(errorAlertText);
                        for (const adminId of loggedInAdmins) {
                            await sendMessage(
                                adminId,
                                errorAlertText,
                                {
                                    inline_keyboard: [
                                        [{ text: '✉️ Nhắn tin cho khách này', callback_data: 'admin_dm_to_' + userId }]
                                    ]
                                }
                            );
                        }
                    }
                } finally {
                    buyingLocks.delete(userId);
                }
            }
            else if (action === 'menu_deposit') {
                await sendDepositQR(chatId, userId);
            }
            // ================= XỬ LÝ CÁC NÚT TRONG BẢNG ADMIN =================
            else if (action.startsWith('admin_approve_order_')) {
                const orderIdToApprove = action.replace('admin_approve_order_', '').trim();
                const db = loadDB();
                const order = db.orders.find(o => String(o.order_id) === String(orderIdToApprove));
                if (!order) {
                    return sendMessage(chatId, '❌ <b>Không tìm thấy đơn hàng #' + escapeHTML(orderIdToApprove) + '!</b>');
                }
                if (order.status === 'completed') {
                    return sendMessage(chatId, 'ℹ️ <b>Đơn hàng #' + escapeHTML(order.order_id) + ' đã được duyệt trước đó!</b>');
                }
                const approvedTimeIso = new Date().toISOString();
                order.status = 'completed';
                order.approved_at = approvedTimeIso;
                order.delivered_product =
                    '✅ Đã kích hoạt Slot Family gemini Pro thành công cho Gmail: ' +
                    (order.customer_gmail || 'Của khách') +
                    ' | Duyệt lúc: ' + formatVNTime(approvedTimeIso);
                saveDB(db);
                const customerObj = (db.users && db.users[order.user_id]) ? db.users[order.user_id] : {};
                const customerName = customerObj.username || 'Khách';

                await sendMessage(
                    order.user_id,
                    '🎉 <b>ĐƠN HÀNG ĐÃ ĐƯỢC ADMIN DUYỆT & HOÀN TẤT!</b>\n\n' +
                    '🧾 Mã đơn hàng: <code>' + escapeHTML(order.order_id) + '</code>\n' +
                    '📦 Sản phẩm: <b>' + escapeHTML(order.product_name) + '</b>\n' +
                    '📧 Gmail nâng cấp: <code>' + escapeHTML(order.customer_gmail || 'Đã ghi nhận') + '</code>\n' +
                    '📌 Trạng thái: <b>✅ Đơn hàng hoàn tất</b>\n' +
                    '🕒 Thời gian duyệt: <b>' + escapeHTML(formatVNTime(approvedTimeIso)) + '</b>\n\n' +
                    '💌 <i>Vui lòng kiểm tra hộp thư Gmail của bạn để chấp nhận lời mời tham gia Family Gemini Pro. Cảm ơn bạn đã ủng hộ Shop!</i>',
                    {
                        inline_keyboard: [
                            [{ text: '🛒 Mua thêm SP khác', callback_data: 'menu_shop_1' }],
                            [{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]
                        ]
                    }
                );

                const approvedAdminText =
                    '✅ <b>[ĐÃ DUYỆT HOÀN TẤT ĐƠN HÀNG]</b>\n\n' +
                    '🧾 Mã đơn hàng: <code>' + escapeHTML(order.order_id) + '</code>\n' +
                    '📦 Sản phẩm: <b>' + escapeHTML(order.product_name) + '</b>\n' +
                    '👤 Khách hàng: <b>' + escapeHTML(customerName) + '</b> (ID: <code>' + escapeHTML(order.user_id) + '</code>)\n' +
                    '💵 Giá thanh toán: <b>' + Number(order.price_charged || 0).toLocaleString('vi-VN') + 'đ</b>\n' +
                    '📧 Gmail của khách: <code>' + escapeHTML(order.customer_gmail || 'Không rõ') + '</code>\n' +
                    '🕒 Duyệt hoàn tất lúc: <b>' + escapeHTML(formatVNTime(approvedTimeIso)) + '</b>';
                await editOrSendMessage(chatId, messageId, approvedAdminText, {
                    inline_keyboard: [
                        [{ text: '✉️ Nhắn tin cho khách này', callback_data: 'admin_dm_to_' + order.user_id }],
                        [{ text: '⚙️ Về Bảng Admin', callback_data: 'admin_panel' }]
                    ]
                });
                await sendNotifyBotMessage(approvedAdminText);
            }
            else if (action === 'admin_panel') {
                clearUserStates(userId);
                await showAdminPanel(chatId);
            }
            else if (action === 'admin_slot_family_config') {
                clearUserStates(userId);
                await showAdminSlotFamilyConfig(chatId, messageId);
            }
            else if (action === 'admin_slot_set_price') {
                clearUserStates(userId);
                awaitingSlotPriceUsers[userId] = true;
                const db = loadDB();
                const slotProd = getCustomSlotProductObj(db);
                await sendMessage(
                    chatId,
                    '💵 <b>ĐIỀU CHỈNH GIÁ BÁN: SLOT FAMILY GEMINI PRO</b>\n\n' +
                    '• Giá hiện tại: <b>' + slotProd.price.toLocaleString('vi-VN') + 'đ</b>\n\n' +
                    '👉 Vui lòng nhập mức giá mới vào khung chat (Ví dụ: <code>50000</code> hoặc <code>50k</code>):',
                    { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_slot_family_config' }]] }
                );
            }
            else if (action === 'admin_slot_set_desc') {
                clearUserStates(userId);
                awaitingSlotDescUsers[userId] = true;
                const db = loadDB();
                const slotProd = getCustomSlotProductObj(db);
                await sendMessage(
                    chatId,
                    '📝 <b>CHỈNH SỬA MÔ TẢ & LƯU Ý: SLOT FAMILY GEMINI PRO</b>\n\n' +
                    '📌 <b>Nội dung đang hiển thị cho khách hiện tại:</b>\n' +
                    '────────────────────\n' +
                    slotProd.description + '\n' +
                    '────────────────────\n\n' +
                    '👉 <i>Vui lòng nhập nội dung Mô tả & Lưu ý mới vào khung chat bên dưới và gửi đi (Hỗ trợ xuống dòng tự nhiên và thẻ in đậm &lt;b&gt;...&lt;/b&gt;):</i>',
                    { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_slot_family_config' }]] }
                );
            }
            else if (action === 'admin_slot_reset_desc') {
                clearUserStates(userId);
                const db = loadDB();
                db.settings.slot_family_description = CUSTOM_SLOT_DEFAULT_DESCRIPTION;
                db.products = sortProductsWithPinnedFirst(db.products, db);
                saveDB(db);
                await showAdminSlotFamilyConfig(chatId, messageId);
            }
            else if (
                action === 'admin_slot_stock_sanhang' ||
                action === 'admin_slot_stock_conhang' ||
                action === 'admin_slot_stock_hethang'
            ) {
                const db = loadDB();
                let newStock = 'Sẵn hàng';
                if (action === 'admin_slot_stock_conhang') {
                    newStock = 'Còn hàng';
                } else if (action === 'admin_slot_stock_hethang') {
                    newStock = 'Hết hàng';
                }
                db.settings.slot_family_stock = newStock;
                db.products = sortProductsWithPinnedFirst(db.products, db);
                saveDB(db);
                await showAdminSlotFamilyConfig(chatId, messageId);
            }
            else if (action === 'admin_send_dm') {
                clearUserStates(userId);
                awaitingDirectMsgUsers[userId] = 'ANY';
                const db = loadDB();
                const recentUsers = Object.values(db.users).slice(-12).reverse();
                let userListText = '';
                if (recentUsers.length > 0) {
                    userListText = '\n📋 <b>Danh sách khách hàng gần đây (Chạm vào ID để sao chép):</b>\n' +
                        recentUsers.map(u => '• <b>' + escapeHTML(u.username) + '</b>: <code>' + u.id + '</code> (Ví: ' + Number(u.balance || 0).toLocaleString('vi-VN') + 'đ)').join('\n') + '\n';
                }
                await sendMessage(
                    chatId,
                    '✉️ <b>NHẮN TIN RIÊNG CHO KHÁCH HÀNG</b>\n\n' +
                    '👉 Nhập theo cú pháp: <code>ID_Khách Nội_dung_tin_nhắn</code>\n' +
                    '• Ví dụ: <code>' + userId + ' Chào bạn, shop gửi bạn thông tin hỗ trợ nhé!</code>\n' +
                    userListText + '\n' +
                    '👇 <i>Vui lòng nhập ID kèm nội dung vào khung chat bên dưới:</i>',
                    { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_panel' }]] }
                );
            }
            else if (action.startsWith('admin_dm_to_')) {
                const targetId = action.replace('admin_dm_to_', '').trim();
                clearUserStates(userId);
                awaitingDirectMsgUsers[userId] = targetId;
                const db = loadDB();
                const targetName = (db.users[targetId] && db.users[targetId].username) ? db.users[targetId].username : 'Khách';
                await sendMessage(
                    chatId,
                    '✉️ <b>NHẮN TIN TRỰC TIẾP CHO KHÁCH HÀNG</b>\n\n' +
                    '👤 Người nhận: <b>' + escapeHTML(targetName) + '</b> (ID: <code>' + escapeHTML(targetId) + '</code>)\n\n' +
                    '👉 <i>Bạn chỉ cần nhập nội dung tin nhắn vào khung chat bên dưới (không cần gõ lại ID):</i>',
                    { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_panel' }]] }
                );
            }
            else if (action === 'admin_broadcast') {
                clearUserStates(userId);
                awaitingBroadcastUsers[userId] = true;
                const db = loadDB();
                const totalUsers = Object.keys(db.users || {}).length;
                await sendMessage(
                    chatId,
                    '📢 <b>GỬI THÔNG BÁO CHO TOÀN BỘ KHÁCH HÀNG</b>\n\n' +
                    '👥 Tổng số người nhận: <b>' + totalUsers + ' khách hàng</b>\n\n' +
                    '👉 <i>Vui lòng nhập nội dung thông báo bạn muốn gửi vào khung chat bên dưới:</i>',
                    { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_panel' }]] }
                );
            }
            else if (action === 'admin_traffic_stats') {
                await showAdminTrafficStats(chatId, messageId);
            }
            else if (action === 'admin_traffic_today_ids') {
                await showAdminTodayVisitorIds(chatId, messageId);
            }
            else if (action === 'admin_adjust_balance') {
                clearUserStates(userId);
                awaitingBalanceAdjustUsers[userId] = true;
                const db = loadDB();
                const recentUsers = Object.values(db.users).slice(-10).reverse();
                let userListText = '';
                if (recentUsers.length > 0) {
                    userListText = '\n📋 <b>Danh sách khách hàng gần đây (Chạm vào ID để sao chép):</b>\n' +
                        recentUsers.map(u => '• <b>' + escapeHTML(u.username) + '</b>: <code>' + u.id + '</code> (Số dư: ' + Number(u.balance || 0).toLocaleString('vi-VN') + 'đ)').join('\n') + '\n';
                }
                await sendMessage(
                    chatId,
                    '💰 <b>CỘNG / TRỪ TIỀN VÍ TÙY Ý (ADMIN)</b>\n\n' +
                    '🔹 <b>Cách 1 (Cộng/Trừ cho chính bạn):</b>\n' +
                    'Nhập trực tiếp số tiền cần cộng hoặc trừ.\n' +
                    '• Ví dụ cộng 100k: <code>100000</code> hoặc <code>100k</code>\n' +
                    '• Ví dụ trừ 50k: <code>-50000</code> hoặc <code>-50k</code>\n\n' +
                    '🔹 <b>Cách 2 (Cộng/Trừ cho khách hàng bất kỳ):</b>\n' +
                    'Nhập theo cú pháp: <code>ID_Khách Số_Tiền</code>\n' +
                    '• Ví dụ cộng 50k: <code>' + userId + ' 50000</code>\n' +
                    '• Ví dụ trừ 30k: <code>' + userId + ' -30000</code>\n' +
                    userListText + '\n' +
                    '👇 <i>Vui lòng nhập nội dung vào khung chat bên dưới:</i>',
                    { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_panel' }]] }
                );
            }
            else if (action === 'admin_export_excel') {
                await exportOrdersToExcelAndSend(chatId, userId, true);
            }
            else if (action === 'admin_edit_support') {
                clearUserStates(userId);
                awaitingSupportContactUsers[userId] = true;
                const currentContact = getSupportContact();
                await sendMessage(
                    chatId,
                    '✏️ <b>ĐỔI THÔNG TIN LIÊN HỆ HỖ TRỢ / BẢO HÀNH</b>\n\n' +
                    'Hiện tại đang hiển thị: <b>' + escapeHTML(currentContact) + '</b>\n\n' +
                    '👉 Vui lòng nhập <b>@username Telegram</b>, <b>Số Zalo</b> hoặc <b>Link hỗ trợ</b> mới của bạn vào khung chat:',
                    { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'admin_panel' }]] }
                );
            }
            else if (action.startsWith('admin_pin_page_')) {
                const pageNum = parseInt(action.replace('admin_pin_page_', ''), 10) || 1;
                await showAdminPinManagerPage(chatId, pageNum, messageId);
            }
            else if (action.startsWith('admin_togglepin_')) {
                const parts = action.replace('admin_togglepin_', '').split('_');
                const pageNum = parseInt(parts.pop(), 10) || 1;
                const prodId = parts.join('_');
                const db = loadDB();
                db.products = sortProductsWithPinnedFirst(db.products, db);
                const product = db.products.find(p => p.id === prodId);
                if (product) {
                    const sId = String(product.source_id);
                    if (!Array.isArray(db.settings.pinned_source_ids)) db.settings.pinned_source_ids = [];
                    if (!Array.isArray(db.settings.unpinned_source_ids)) db.settings.unpinned_source_ids = [];
                    const currentlyPinned = isProductPinned(product, db);
                    if (currentlyPinned) {
                        db.settings.pinned_source_ids = db.settings.pinned_source_ids.filter(id => id !== sId);
                        if (!db.settings.unpinned_source_ids.includes(sId)) {
                            db.settings.unpinned_source_ids.push(sId);
                        }
                    } else {
                        db.settings.unpinned_source_ids = db.settings.unpinned_source_ids.filter(id => id !== sId);
                        if (!db.settings.pinned_source_ids.includes(sId)) {
                            db.settings.pinned_source_ids.push(sId);
                        }
                    }
                    db.products = sortProductsWithPinnedFirst(db.products, db);
                    saveDB(db);
                }
                await showAdminPinManagerPage(chatId, pageNum, messageId);
            }
            else if (action === 'admin_sync') {
                await sendMessage(chatId, '🔄 Đang đồng bộ toàn bộ sản phẩm và sắp xếp SP ghim lên đầu Trang 1...');
                const res = await syncCatalogFromSource();
                if (res.success) {
                    await sendMessage(
                        chatId,
                        '✅ <b>ĐỒNG BỘ THÀNH CÔNG!</b>\n\n' +
                        '📦 Đã lưu cố định: <b>' + res.count + ' sản phẩm</b> vào hệ thống.\n' +
                        '🌐 Nhánh API chuẩn: <code>' + escapeHTML(res.url) + '</code>\n' +
                        '📌 Sản phẩm <b>Slot Family</b>, <b>Gemini Pro 18M</b> và các SP ghim đã được đưa lên đầu Trang 1.\n' +
                        '💵 Giá bán đã tự động điều chỉnh (&lt;100k +20k, &gt;=100k +15%).',
                        { inline_keyboard: [[{ text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }]] }
                    );
                } else {
                    await sendMessage(
                        chatId,
                        '❌ <b>Đồng bộ thất bại:</b>\n<code>' + escapeHTML(res.error) + '</code>',
                        { inline_keyboard: [[{ text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }]] }
                    );
                }
            }
            else if (action === 'admin_balance') {
                const res = await checkSourceBalance();
                if (res.success) {
                    await sendMessage(
                        chatId,
                        '🔑 <b>SỐ DƯ VÍ GỐC CỦA BẠN:</b>\n<pre>' + escapeHTML(JSON.stringify(res.data, null, 2)) + '</pre>',
                        { inline_keyboard: [[{ text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }]] }
                    );
                } else {
                    await sendMessage(
                        chatId,
                        '❌ <b>Không kiểm tra được số dư:</b>\n<code>' + escapeHTML(res.error) + '</code>',
                        { inline_keyboard: [[{ text: '🔙 Quay lại Bảng Admin', callback_data: 'admin_panel' }]] }
                    );
                }
            }
            else if (action === 'admin_logout') {
                loggedInAdmins.delete(userId);
                clearUserStates(userId);
                await sendMessage(chatId, '🔒 <b>Đã đăng xuất khỏi chế độ Admin!</b>');
                await showCustomerMainMenu(chatId, user);
            }
        }
    } catch (err) {
        console.error('❌ Lỗi trong handleUpdate:', err.message);
    }
}

// ================= 7. WEBHOOK NHẬN TIỀN NGÂN HÀNG TỰ ĐỘNG =================
const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook/bank') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                console.log('📩 [WEBHOOK] Nhận tín hiệu từ ngân hàng:', body);
                const data = JSON.parse(body);
                const transactions = Array.isArray(data.data) ? data.data : [data];
                for (const tx of transactions) {
                    const content = tx.content || tx.description || '';
                    const transferAmount = Number(tx.transferAmount || tx.amount || 0);
                    const txId = String(tx.id || tx.referenceCode || tx.tid || Date.now());
                    const match = content.match(/NAP[\s\-_]*(\d+)/i);
                    if (match && transferAmount > 0) {
                        const targetUserId = match[1];
                        const db = loadDB();
                        if (!db.processed_tx.includes(txId)) {
                            db.processed_tx.push(txId);
                            saveDB(db);
                            const newBal = updateBalance(targetUserId, transferAmount);
                            console.log('✅ Đã cộng ' + transferAmount + 'đ cho ID ' + targetUserId);
                            await sendMessage(
                                targetUserId,
                                '🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>\n\n' +
                                '➕ Số tiền nhận: <b>+' + transferAmount.toLocaleString('vi-VN') + 'đ</b>\n' +
                                '💰 Số dư hiện tại: <b>' + newBal.toLocaleString('vi-VN') + 'đ</b>',
                                {
                                    inline_keyboard: [
                                        [{ text: '🛒 Mua hàng ngay', callback_data: 'menu_shop_1' }],
                                        [{ text: '🏠 Về Trang chủ', callback_data: 'menu_home' }]
                                    ]
                                }
                            );
                            const depositNotifyMsg =
                                '💰 <b>[KHÁCH NẠP TIỀN TỰ ĐỘNG]</b>\n' +
                                '👤 ID Khách: <code>' + escapeHTML(targetUserId) + '</code>\n' +
                                '➕ Số tiền nạp: <b>+' + transferAmount.toLocaleString('vi-VN') + 'đ</b>\n' +
                                '🏦 Số dư mới của khách: <b>' + newBal.toLocaleString('vi-VN') + 'đ</b>';
                            await sendNotifyBotMessage(depositNotifyMsg);
                            for (const adminId of loggedInAdmins) {
                                if (String(adminId) !== String(targetUserId)) {
                                    await sendMessage(
                                        adminId,
                                        depositNotifyMsg,
                                        {
                                            inline_keyboard: [
                                                [{ text: '✉️ Nhắn tin cho khách này', callback_data: 'admin_dm_to_' + targetUserId }]
                                            ]
                                        }
                                    );
                                }
                            }
                        }
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                console.error('❌ Lỗi xử lý Webhook:', err.message);
                res.writeHead(400);
                res.end('Invalid payload');
            }
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ShopBot Server Running');
    }
});

// ================= 8. KHỞI CHẠY BOT & TỰ ĐỘNG ĐỒNG BỘ =================
let lastUpdateId = 0;
let isPollingStarted = false;
async function startBot() {
    if (isPollingStarted) return;
    isPollingStarted = true;
    console.log('====================================================');
    console.log('🚀 Đang kết nối tới Telegram...');
    while (true) {
        try {
            const me = await tgClient.get(TG_API + '/getMe');
            console.log('✅ KẾT NỐI THÀNH CÔNG! Tên Bot: @' + me.data.result.username);
            console.log('🔐 Lệnh mở quản trị (Ẩn): /doanthanhbao22 -> Nhập mật khẩu');
            await setupBotCommands();
            await tgClient.get(TG_API + '/deleteWebhook', { params: { drop_pending_updates: false } });
            break;
        } catch (err) {
            console.error('❌ LỖI KHỞI ĐỘNG TELEGRAM (Thử lại sau 5s):', err.response ? err.response.data : err.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    console.log('🔄 Đang tự động đồng bộ sản phẩm từ nguồn ULTRA...');
    syncCatalogFromSource().catch(() => {});
    setInterval(() => {
        syncCatalogFromSource().catch(() => {});
    }, 5 * 60 * 1000);
    console.log('====================================================');
    while (true) {
        try {
            const res = await tgClient.get(TG_API + '/getUpdates', {
                params: { offset: lastUpdateId + 1, timeout: 20 },
                timeout: 28000
            });
            const updates = res.data && res.data.result;
            if (Array.isArray(updates) && updates.length > 0) {
                for (const update of updates) {
                    lastUpdateId = update.update_id;
                    handleUpdate(update).catch(err => {
                        console.error('❌ Lỗi xử lý sự kiện:', err.message);
                    });
                }
            }
        } catch (pollErr) {
            if (pollErr.response && pollErr.response.status === 409) {
                console.error('⚠️ Phát hiện có 1 tiến trình Bot khác đang chạy trùng Token (Lỗi 409)! Hãy tắt các tiến trình cũ.');
                await tgClient.get(TG_API + '/deleteWebhook').catch(() => {});
            }
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

process.on('uncaughtException', (err) => {
    console.error('🔥 Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('🔥 Unhandled Rejection:', reason);
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        WEBHOOK_PORT++;
        server.listen(WEBHOOK_PORT);
    }
});

server.listen(WEBHOOK_PORT, () => {
    startBot();
});