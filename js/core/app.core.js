/* ============================================================================
 * VYKO MANUFACTURING ERP — CORE
 * Tiện ích chung, UI kit (toast / modal / drawer / dropdown), router,
 * và các widget dùng lại ở mọi module (toolbar, bảng, phân trang…).
 * ==========================================================================*/

/* ---------------------------------------------------------- 1. TIỆN ÍCH */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Chống XSS khi ghép chuỗi HTML (dữ liệu do người dùng nhập trong demo) */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const fmtN     = (n) => (Math.round(Number(n) || 0)).toLocaleString('vi-VN');
const fmtVND   = (n) => fmtN(n) + 'đ';
// Tiền trong form: hiển thị dấu chấm phân cách hàng nghìn nhưng vẫn parse về Number khi lưu.
const parseMoney = (v) => {
  const raw = String(v ?? '').trim().replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '').replace(/[^0-9-]/g, '');
  return Number(raw) || 0;
};
const fmtMoneyInput = (v) => {
  const n = parseMoney(v);
  return n ? Math.round(n).toLocaleString('vi-VN') : '';
};
const fmtDec   = (n, d = 1) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: d });
const fmtDate  = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const fmtMonth = (s) => (s ? 'Tháng ' + Number(s.slice(5, 7)) + '/' + s.slice(0, 4) : '—');

/** Ngày hiện tại theo múi giờ local của trình duyệt, định dạng YYYY-MM-DD.
 *  Không thay DB.today demo để tránh ảnh hưởng các module cũ; chỉ dùng ở
 *  những chứng từ mới cần lấy ngày thực tế hiện tại. */
function currentDateYMD() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Chuẩn hóa ngày cho các form nghiệp vụ:
 * - không cho chọn ngày quá khứ;
 * - form tạo/cập nhật nếu đang rỗng hoặc mang ngày quá khứ thì lấy ngày hiện tại;
 * - riêng bộ lọc báo cáo/danh sách (data-f) vẫn giữ quyền lọc lịch sử.
 */
function enforceBusinessDateInputs(scope = document) {
  const today = currentDateYMD();
  if (!scope || !scope.querySelectorAll) return;
  scope.querySelectorAll('input[type="date"]').forEach((el) => {
    // Một số trường lưu ngày quá khứ hợp lệ theo nghiệp vụ (vd: ngày vào làm
    // của nhân sự cũ) — đánh dấu data-allow-past="1" để không bị ép về hôm nay.
    if (el.dataset.allowPast === '1' || el.dataset.f) return;
    el.min = today;
    const isFilter = !!el.dataset.f;
    if (!isFilter && (!el.value || el.value < today)) el.value = today;
  });
}


/** 4.860.000.000 -> "4,86 tỷ" */
function fmtShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2).replace('.', ',') + ' tỷ';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(v >= 1e8 ? 0 : 1).replace('.', ',') + ' tr';
  return fmtN(v);
}

/** Chữ cái viết tắt cho avatar: "Hà Minh Tú" -> "HT" */
function initials(name) {
  const w = String(name || '').trim().split(/\s+/);
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

const AVA_TONES = ['', 'teal', 'orange', 'indigo', 'green', 'slate'];
const avaTone = (seed) => AVA_TONES[(String(seed).charCodeAt(String(seed).length - 1) || 0) % AVA_TONES.length];

/** Số ngày từ hôm nay tới ngày d (âm = đã quá hạn) */
const daysTo = (d) => Math.round((new Date(d + 'T00:00:00') - new Date(DB.today + 'T00:00:00')) / 86400000);

/** Badge trạng thái theo từ điển STATUS trong data.js */
function badge(key, extraClass = '') {
  const s = DB.statusMap[key];
  if (!s) return `<span class="badge slate ${extraClass}">${esc(key)}</span>`;
  return `<span class="badge ${s.tone} ${extraClass}">${esc(s.label)}</span>`;
}
const statusLabel = (key) => (DB.statusMap[key] || {}).label || key;
const statusTone  = (key) => (DB.statusMap[key] || {}).tone || 'slate';

/** Thanh tiến độ có màu theo mức hoàn thành */
function progressBar(pct, showText = true) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const tone = p >= 100 ? 'green' : p >= 60 ? '' : p >= 30 ? 'orange' : 'red';
  return `<div class="bar-row"><div class="bar ${tone}"><span style="width:${p}%"></span></div>${showText ? `<b>${p}%</b>` : ''}</div>`;
}

function avatarHTML(name, cls = 'sm') {
  return `<span class="avatar ${cls} ${avaTone(name)}">${esc(initials(name))}</span>`;
}

/** Ô 2 dòng trong bảng: dòng chính + dòng phụ */
const cell2 = (main, sub) => `<div class="cell-main">${main}</div>${sub ? `<div class="cell-sub">${sub}</div>` : ''}`;

/* -------------------------------------------------------- 2. TRẠNG THÁI */
const State = {
  module: 'dashboard',
  params: {},
  filters: {},
  page: {},
  tab: null,

  // Bộ lọc tạm được gắn khi người dùng click từ Dashboard/KPI sang màn chi tiết.
  // Khi người dùng chủ động chuyển sang tab khác, filter tạm sẽ được xóa để
  // lần quay lại màn hình hiển thị dữ liệu bình thường. Filter người dùng tự chọn
  // trực tiếp trên màn hình không bị ảnh hưởng.
  transientFilters: {},
};

/** Lấy (và khởi tạo) bộ lọc của một module */
function F(key, defaults = {}) {
  if (!State.filters[key]) State.filters[key] = { ...defaults };
  return State.filters[key];
}


/* -------------------------------------------------------- 2.1. PHÂN QUYỀN
 * Chỉ bổ sung lớp kiểm tra quyền ở UI/action; KHÔNG thay đổi luồng nghiệp vụ.
 * Quyền được lấy từ DB.users -> roleId -> DB.roles[].perms.
 */
const Auth = {
  currentAccount() {
    if (typeof SystemAPI !== 'undefined') return SystemAPI.currentUser();
    return (DB.users || []).find(u => u.id === DB.currentUser?.userId || u.empId === DB.currentUser?.id) || null;
  },
  currentRole() {
    const account=this.currentAccount();
    return account ? (DB.roles || []).find(r => r.id === account.roleId) || null : null;
  },
  hasPermission(permission) {
    const role=this.currentRole();
    if (!role) return false;
    const perms=role.permissions || role.perms || [];
    return perms.includes('*') || perms.includes(permission);
  },
  require(permission, message='Bạn không có quyền thực hiện thao tác này.') {
    if (this.hasPermission(permission)) return true;
    if (typeof Toast !== 'undefined') Toast.err('Không có quyền', message);
    return false;
  },
  canApprovePurchase() { return this.hasPermission('PURCHASE_PR_APPROVE'); },
  canAccess(module, tab=null) {
    // Mỗi actor luôn được xem màn Thông tin phân quyền của chính mình.
    if (module === 'my-access') return !!this.currentAccount();

    // Route chi tiết LSX là màn con của phân hệ Sản xuất, không phải một
    // module phân quyền độc lập. Vì vậy quyền xem chi tiết kế thừa từ
    // module `production`. Điều này chỉ cho phép truy cập màn chi tiết;
    // các nút thao tác bên trong vẫn kiểm tra permission riêng như cũ.
    if (module === 'production-detail') module = 'production';

    // Các màn chi tiết bán hàng là route con của CRM, không phải module
    // phân quyền độc lập. Nếu không map về `crm`, Trưởng Kinh doanh có
    // quyền CRM/SALES_APPROVE vẫn bị chặn khi mở chi tiết đơn hàng.
    if (module === 'order-detail') module = 'crm';

    const role=this.currentRole();
    if (!role) return false;
    const modules=role.modules || {};
    if (modules['*'] === '*') return true;
    if (!Object.prototype.hasOwnProperty.call(modules,module)) return false;
    const tabs=modules[module];
    if (tabs === '*' || tabs === true || tab == null) return true;
    return Array.isArray(tabs) && tabs.includes(tab);
  },
  firstRoute() {
    const role=this.currentRole();
    const modules=role?.modules || {};

    // Mỗi lần đăng nhập luôn bắt đầu ở trang TỔNG QUAN của đúng phân hệ
    // mà vai trò đó phụ trách. Không kế thừa tab/route của tài khoản trước.
    const roleHome = {
      ROLE_ADMIN:            { module:'dashboard',      tab:null },
      ROLE_DIRECTOR:         { module:'dashboard',      tab:null },
      ROLE_PURCHASE:         { module:'purchases',      tab:'dashboard' },
      ROLE_PURCHASE_MANAGER: { module:'purchases',      tab:'dashboard' },
      ROLE_WAREHOUSE:        { module:'warehouse',      tab:'dashboard' },
      ROLE_PRODUCTION:       { module:'production',     tab:'dashboard' },
      ROLE_QC:               { module:'quality',        tab:'dashboard' },
      ROLE_SALES:            { module:'crm',            tab:'dashboard' },
      ROLE_SALES_MANAGER:    { module:'crm',            tab:'dashboard' },
      ROLE_ACCOUNTING:       { module:'accounting',     tab:'dashboard' },
      ROLE_HR:               { module:'hr',             tab:'dashboard' },
      ROLE_MAINTENANCE:      { module:'maintenance',    tab:'dashboard' },
      ROLE_LOGISTICS:        { module:'logistics',      tab:'dashboard' },
      ROLE_RESTAURANT:       { module:'restaurant',     tab:'dashboard' },
      ROLE_RESTAURANT_STAFF: { module:'restaurant',     tab:'dashboard' },
      ROLE_SUBCONTRACT:      { module:'subcontracting', tab:'dashboard' },
      ROLE_RND:              { module:'rnd',            tab:'dashboard' },
    };
    const preferred = roleHome[role?.id];
    if (preferred && this.canAccess(preferred.module, preferred.tab)) return preferred;

    if (modules['*'] === '*') return {module:'dashboard',tab:null};
    const order=['dashboard','purchases','warehouse','production','subcontracting','restaurant','crm','accounting','quality','hr','maintenance','logistics','rnd','approvals','bi'];
    for (const m of order) if (Object.prototype.hasOwnProperty.call(modules,m)) {
      const tabs=modules[m];
      if (tabs === '*' || tabs === true) return {module:m,tab:'dashboard'};
      return {module:m,tab:Array.isArray(tabs)?tabs[0]:null};
    }
    return {module:'dashboard',tab:null};
  },
  permissionForAction(action) {
    const map={
      'new-pr':'PURCHASE_PR_CREATE','create-pr':'PURCHASE_PR_CREATE','pr-save':'PURCHASE_PR_CREATE','pr-edit':'PURCHASE_PR_CREATE','pr-delete':'PURCHASE_PR_CREATE',
      'pr-approve-action':'PURCHASE_PR_APPROVE','pr-reject-modal':'PURCHASE_PR_APPROVE','pr-reject-save':'PURCHASE_PR_APPROVE',
      'pr-convert-po':'PURCHASE_PO_CREATE','po-approve-action':'PURCHASE_PO_APPROVE','po-cancel':'PURCHASE_PO_CREATE','po-change-status':'PURCHASE_PO_SEND',
      'supplier-add':'PURCHASE_SUPPLIER_MANAGE','supplier-edit':'PURCHASE_SUPPLIER_MANAGE','supplier-delete':'PURCHASE_SUPPLIER_MANAGE','supplier-save':'PURCHASE_SUPPLIER_MANAGE',
      'inv-new-receipt':'INVENTORY_OPERATE','inv-new-issue':'INVENTORY_OPERATE','inv-new-transfer':'INVENTORY_OPERATE','inv-new-count':'INVENTORY_OPERATE',
      'inv-receipt-save-new':'INVENTORY_OPERATE','inv-issue-save-new':'INVENTORY_OPERATE','inv-transfer-save-new':'INVENTORY_OPERATE','inv-count-save':'INVENTORY_OPERATE','stock-move':'INVENTORY_OPERATE','stock-move-save':'INVENTORY_OPERATE','inv-return-confirm-issue':'INVENTORY_OPERATE',
      'inventory-item-add':'INVENTORY_OPERATE','inventory-item-edit':'INVENTORY_OPERATE','inventory-item-save':'INVENTORY_OPERATE','inventory-item-delete':'INVENTORY_OPERATE','shelf-life-save':'INVENTORY_OPERATE','inv-defect-handle':'INVENTORY_OPERATE','oqc-open':'QC_INSPECT','oqc-save':'QC_INSPECT','oqc-request-recheck':'INVENTORY_OPERATE','po-actual-qty':'PRODUCTION_OPERATE','po-actual-qty-save':'PRODUCTION_OPERATE','po-complete-all':'PRODUCTION_OPERATE','po-complete-all-save':'PRODUCTION_OPERATE','lsx-near-days-save':'PRODUCTION_OPERATE','inv-defect-save':'INVENTORY_OPERATE',
      'item-category-manager':'INVENTORY_OPERATE','item-category-add':'INVENTORY_OPERATE','item-category-prefix-save':'INVENTORY_OPERATE','item-category-delete':'INVENTORY_OPERATE',
      'inv-warehouse-new':'INVENTORY_OPERATE','inv-warehouse-edit':'INVENTORY_OPERATE','inv-warehouse-save':'INVENTORY_OPERATE','inv-warehouse-delete':'INVENTORY_OPERATE',
      'inv-warehouse-zone-new':'INVENTORY_OPERATE','inv-warehouse-zone-edit':'INVENTORY_OPERATE','inv-warehouse-zone-save':'INVENTORY_OPERATE','inv-warehouse-zone-delete':'INVENTORY_OPERATE',
      'inv-warehouse-rack-new':'INVENTORY_OPERATE','inv-warehouse-rack-edit':'INVENTORY_OPERATE','inv-warehouse-rack-save':'INVENTORY_OPERATE','inv-warehouse-rack-delete':'INVENTORY_OPERATE',
      'inv-lot-config':'INVENTORY_OPERATE','inv-lot-quarantine':'INVENTORY_OPERATE','inv-save-alert-config':'INVENTORY_OPERATE',
      'warehouse-receipt-save':'INVENTORY_OPERATE','po-goods-receipt-save':'INVENTORY_OPERATE','subcontracting-warehouse':'INVENTORY_OPERATE',
      'material-request':'PURCHASE_PR_CREATE',
      'iqc-save-inspection':'QC_INSPECT','iqc-open-inspection':'QC_VIEW','pqc-open':'QC_VIEW','pqc-save':'QC_INSPECT','po-qc':'QC_INSPECT',
      'new-po':'PRODUCTION_OPERATE','po-edit':'PRODUCTION_OPERATE','po-edit-save':'PRODUCTION_OPERATE','po-delete':'PRODUCTION_OPERATE','po-approve':'PRODUCTION_OPERATE','po-advance':'PRODUCTION_OPERATE','stage-start':'PRODUCTION_OPERATE','stage-update':'PRODUCTION_OPERATE','stage-save':'PRODUCTION_OPERATE','pqc-rework-done':'PRODUCTION_OPERATE',
      'edit-customer':'CRM_OPERATE','save-customer':'CRM_OPERATE','customer-care':'CRM_OPERATE','save-customer-care':'CRM_OPERATE','delete-customer':'CRM_DELETE_CUSTOMER',
      'new-order':'SALES_ORDER_OPERATE','new-order-for':'SALES_ORDER_OPERATE','crm-order-save':'SALES_ORDER_OPERATE','crm-order-edit':'SALES_ORDER_OPERATE','crm-order-edit-save':'SALES_ORDER_OPERATE','crm-order-delete':'SALES_ORDER_OPERATE','crm-customer-pay-modal':'CRM_OPERATE','crm-customer-pay-save':'CRM_OPERATE',
      'crm-order-approve':'SALES_APPROVE','crm-order-reject':'SALES_APPROVE','sales-production-request':'SALES_ORDER_OPERATE','sales-production-request-approve':'SALES_APPROVE',
      'crm-order-issue':'INVENTORY_OPERATE','crm-order-issue-confirm':'INVENTORY_OPERATE','inv-sales-issue-confirm':'INVENTORY_OPERATE',
      'order-status-save':'SALES_ORDER_OPERATE',
      // Logistics: các thao tác làm thay đổi chuyến/xe/tài xế/bảo trì chỉ role
      // có LOGISTICS_OPERATE mới được thực hiện. Các action chỉ xem không map
      // để Giám đốc/Admin vẫn xem được theo phạm vi module.
      'lg-delivery-new':'LOGISTICS_OPERATE','lg-delivery-save':'LOGISTICS_OPERATE',
      'lg-dispatch':'LOGISTICS_OPERATE','lg-dispatch-save':'LOGISTICS_OPERATE',
      'lg-trip-start':'LOGISTICS_OPERATE','lg-trip-complete':'LOGISTICS_OPERATE','lg-trip-complete-save':'LOGISTICS_OPERATE','lg-trip-close':'LOGISTICS_OPERATE','lg-trip-close-save':'LOGISTICS_OPERATE',
      'lg-gps-update':'LOGISTICS_OPERATE','lg-gps-update-save':'LOGISTICS_OPERATE',
      'lg-vehicle-new':'LOGISTICS_OPERATE','lg-vehicle-edit':'LOGISTICS_OPERATE','lg-vehicle-save':'LOGISTICS_OPERATE',
      'lg-vehicle-type-new':'LOGISTICS_OPERATE','lg-vehicle-type-edit':'LOGISTICS_OPERATE','lg-vehicle-type-save':'LOGISTICS_OPERATE',
      'lg-driver-new':'LOGISTICS_OPERATE','lg-driver-edit':'LOGISTICS_OPERATE','lg-driver-save':'LOGISTICS_OPERATE',
      'lg-maint-new':'LOGISTICS_OPERATE','lg-maint-save':'LOGISTICS_OPERATE','lg-maint-start':'LOGISTICS_OPERATE','lg-maint-finish':'LOGISTICS_OPERATE','lg-maint-finish-save':'LOGISTICS_OPERATE',
      'acc-entry-new':'ACCOUNTING_OPERATE','acc-entry-edit':'ACCOUNTING_OPERATE','acc-entry-save':'ACCOUNTING_OPERATE','acc-entry-delete':'ACCOUNTING_OPERATE','acc-entry-subtab':'ACCOUNTING_VIEW',
      'new-user':'ADMIN_USER_MANAGE','user-toggle':'ADMIN_USER_MANAGE','user-role':'ADMIN_USER_MANAGE','user-role-save':'ADMIN_USER_MANAGE',
      'new-employee':'HR_OPERATE','employee-edit':'HR_OPERATE','employee-save':'HR_OPERATE','employee-toggle-active':'HR_OPERATE','employee-import':'HR_OPERATE'
    };
    return map[action] || null;
  }
};

/* ---------------------------------------------------------- 3. TOAST */
const Toast = {
  show(msg, { type = 'success', desc = '', timeout = 3200 } = {}) {
    const icons = { success: 'fa-circle-check', warning: 'fa-triangle-exclamation', danger: 'fa-circle-xmark', info: 'fa-circle-info' };
    const tones = { success: 't-green', warning: 't-orange', danger: 't-red', info: 't-blue' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <span class="toast-ico ${tones[type]}"><i class="fa-solid ${icons[type]}"></i></span>
      <span style="min-width:0"><b>${esc(msg)}</b>${desc ? `<p>${esc(desc)}</p>` : ''}</span>
      <button class="x" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button>`;
    $('#toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
    el.querySelector('.x').onclick = close;
    if (timeout) setTimeout(close, timeout);
  },
  ok:   (m, d) => Toast.show(m, { type: 'success', desc: d }),
  warn: (m, d) => Toast.show(m, { type: 'warning', desc: d }),
  err:  (m, d) => Toast.show(m, { type: 'danger', desc: d }),
  info: (m, d) => Toast.show(m, { type: 'info', desc: d }),
};

/* ------------------------------------------------- 4. MODAL / DRAWER / POP */
const Overlay = {
  el: () => $('#overlay'),
  show() { Overlay.el().classList.add('show'); },
  hide() { if (!Modal.isOpen() && !Drawer.isOpen()) Overlay.el().classList.remove('show'); },
};

const Modal = {
  /* Hẹn giờ dọn dẹp sau khi đóng — phải hủy nếu có modal mới mở ngay sau đó,
     nếu không nội dung modal mới sẽ bị xóa oan. */
  _timer: null,

  open({ title, sub = '', body, foot = '', size = '', onMount, closable = true }) {
    if (Modal._timer) { clearTimeout(Modal._timer); Modal._timer = null; }
    const host = $('#modalHost');
    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="modal ${size}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div style="min-width:0">
            <h3>${title}</h3>
            ${sub ? `<p>${sub}</p>` : ''}
          </div>
          ${closable ? '<button class="icon-btn btn-icon x" data-act="modal-close" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button>' : ''}
        </div>
        <div class="modal-body">${body}</div>
        ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
      </div>`;
    enforceBusinessDateInputs(host);
    Overlay.show();
    Modal._open = true;
    const m = host.querySelector('.modal');
    // Bật hiệu ứng ở khung hình kế tiếp; hủy lệnh cũ nếu modal bị đóng ngay sau đó
    if (Modal._raf) cancelAnimationFrame(Modal._raf);
    Modal._raf = requestAnimationFrame(() => { Modal._raf = null; if (Modal._open) m.classList.add('show'); });
    if (onMount) onMount(m);
    return m;
  },
  _raf: null,
  _open: false,
  isOpen: () => Modal._open,
  close() {
    if (!Modal._open) return;
    Modal._open = false;
    if (Modal._raf) { cancelAnimationFrame(Modal._raf); Modal._raf = null; }
    const host = $('#modalHost');
    const m = host.querySelector('.modal');
    if (m) m.classList.remove('show');
    if (Modal._timer) clearTimeout(Modal._timer);
    Modal._timer = setTimeout(() => {
      Modal._timer = null;
      host.classList.add('hidden'); host.innerHTML = ''; Overlay.hide();
    }, 200);
  },
};

const Drawer = {
  _timer: null,
  _raf: null,
  _open: false,

  open({ title, sub = '', body, foot = '', wide = false, onMount, headExtra = '' }) {
    if (Drawer._timer) { clearTimeout(Drawer._timer); Drawer._timer = null; }
    const d = $('#drawer');
    d.className = 'drawer' + (wide ? ' wide' : '');
    d.innerHTML = `
      <div class="drawer-head">
        <div style="min-width:0;flex:1 1 auto">
          <h3 style="font-size:16px">${title}</h3>
          ${sub ? `<p style="font-size:12.5px;color:var(--text-3);margin-top:3px">${sub}</p>` : ''}
        </div>
        ${headExtra}
        <button class="icon-btn btn-icon" data-act="drawer-close" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="drawer-body">${body}</div>
      ${foot ? `<div class="drawer-foot">${foot}</div>` : ''}`;
    Overlay.show();
    Drawer._open = true;
    if (Drawer._raf) cancelAnimationFrame(Drawer._raf);
    Drawer._raf = requestAnimationFrame(() => { Drawer._raf = null; if (Drawer._open) d.classList.add('show'); });
    if (onMount) onMount(d);
  },
  isOpen: () => Drawer._open,
  close() {
    if (!Drawer._open) return;
    Drawer._open = false;
    if (Drawer._raf) { cancelAnimationFrame(Drawer._raf); Drawer._raf = null; }
    const d = $('#drawer');
    d.classList.remove('show');
    if (Drawer._timer) clearTimeout(Drawer._timer);
    Drawer._timer = setTimeout(() => { Drawer._timer = null; d.innerHTML = ''; Overlay.hide(); }, 260);
  },
  /** Cập nhật phần thân drawer mà không đóng/mở lại (dùng khi chuyển tab) */
  setBody(html) { const b = $('#drawer .drawer-body'); if (b) b.innerHTML = html; },
};

const Pop = {
  open(anchor, html, { align = 'right', width } = {}) {
    const p = $('#pop');
    p.innerHTML = html;
    if (width) p.style.width = typeof width === 'number' ? width + 'px' : width;
    else p.style.width = '';
    p.classList.add('show');
    const r = anchor.getBoundingClientRect();
    const pw = p.offsetWidth, ph = p.offsetHeight;
    let left = align === 'right' ? r.right - pw : r.left;
    left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));
    let top = r.bottom + 7;
    if (top + ph > window.innerHeight - 10) top = Math.max(10, r.top - ph - 7);
    p.style.left = left + 'px';
    p.style.top = top + 'px';
    p.dataset.anchor = anchor.id || '';
  },
  close() { const p = $('#pop'); p.classList.remove('show'); p.dataset.anchor = ''; },
  isOpen: () => $('#pop').classList.contains('show'),
};

/** Hộp xác nhận dùng chung (thay cho confirm() mặc định) */
function confirmBox({ title, message, okText = 'Xác nhận', tone = 'danger', icon = 'fa-triangle-exclamation', onOk }) {
  Modal.open({
    title: esc(title),
    body: `<div style="display:flex;gap:14px;align-items:flex-start">
        <span class="kpi-ico t-${tone === 'danger' ? 'red' : tone}"><i class="fa-solid ${icon}"></i></span>
        <div style="font-size:13.5px;color:var(--text-2);line-height:1.6">${message}</div>
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy bỏ</button>
           <button class="btn btn-${tone === 'danger' ? 'danger' : 'primary'}" data-act="confirm-ok">${esc(okText)}</button>`,
    onMount: (m) => { m.querySelector('[data-act="confirm-ok"]').onclick = () => { Modal.close(); setTimeout(() => onOk && onOk(), 210); }; },
  });
}

/* ------------------------------------------------- 5. WIDGET DÙNG CHUNG */

/** Khung bảng chuẩn: header + body + trạng thái rỗng */
function tableShell(headers, rowsHTML, { emptyTitle = 'Chưa có dữ liệu', emptyDesc = 'Không tìm thấy bản ghi nào khớp với bộ lọc hiện tại. Hãy thử xóa bớt điều kiện lọc.', emptyAction = '' } = {}) {
  const normalizedRows = Array.isArray(rowsHTML) ? rowsHTML.join('') : String(rowsHTML || '');
  const body = normalizedRows.length
    ? normalizedRows
    : `<tr><td colspan="${headers.length}" style="padding:0">
        <div class="empty">
          <div class="empty-ico"><i class="fa-solid fa-inbox"></i></div>
          <h4>${esc(emptyTitle)}</h4><p>${esc(emptyDesc)}</p>${emptyAction}
        </div></td></tr>`;
  return `<div class="tbl-wrap"><table class="tbl">
      <thead><tr>${headers.map((h) => `<th class="${h.cls || ''}" ${h.w ? `style="width:${h.w}"` : ''}>${h.t}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

/** Cắt trang danh sách + ghi nhớ trang hiện tại theo module */
function paged(list, key, size = 10) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  let page = State.page[key] || 1;
  if (page > pages) { page = pages; State.page[key] = page; }
  return { items: list.slice((page - 1) * size, page * size), total, pages, page, size };
}

function pagiHTML(key, pg, unit = 'bản ghi') {
  if (!pg.total) return '';
  const from = (pg.page - 1) * pg.size + 1;
  const to = Math.min(pg.total, pg.page * pg.size);
  const nums = [];
  const push = (n) => nums.push(`<button class="pg ${n === pg.page ? 'active' : ''}" data-act="page" data-key="${key}" data-p="${n}">${n}</button>`);
  const dots = () => nums.push('<button class="pg dots" disabled>…</button>');
  if (pg.pages <= 7) { for (let i = 1; i <= pg.pages; i++) push(i); }
  else {
    push(1);
    if (pg.page > 3) dots();
    for (let i = Math.max(2, pg.page - 1); i <= Math.min(pg.pages - 1, pg.page + 1); i++) push(i);
    if (pg.page < pg.pages - 2) dots();
    push(pg.pages);
  }
  return `<div class="pagi">
      <span class="pagi-info">Hiển thị <b>${from}–${to}</b> trên tổng <b>${fmtN(pg.total)}</b> ${unit}</span>
      <div class="pagi-btns">
        <button class="pg" data-act="page" data-key="${key}" data-p="${pg.page - 1}" ${pg.page === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
        ${nums.join('')}
        <button class="pg" data-act="page" data-key="${key}" data-p="${pg.page + 1}" ${pg.page === pg.pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
      </div>
    </div>`;
}

/** Ô tìm kiếm của module (gắn với State.filters[key].q) */
function searchBox(key, placeholder = 'Tìm kiếm…') {
  const f = F(key);
  return `<div class="search-box">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input class="inp" type="text" data-f="${key}.q" value="${esc(f.q || '')}" placeholder="${esc(placeholder)}" />
    </div>`;
}

/** Select lọc: options = [[value,label],...] */
function selectFilter(key, field, options, allLabel) {
  const f = F(key);
  const cur = f[field] || '';
  return `<select class="inp" data-f="${key}.${field}">
      <option value="">${esc(allLabel)}</option>
      ${options.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
    </select>`;
}

/** Danh sách option trạng thái từ tiền tố khóa (vd 'dh_') */
function statusOptions(prefix) {
  return Object.keys(DB.statusMap).filter((k) => k.startsWith(prefix)).map((k) => [k, DB.statusMap[k].label]);
}

/** Thẻ KPI nhỏ đầu module */
// function mkpi(label, value, icon, tone, onClickAct) {
//   return `<div class="mkpi" ${onClickAct ? `data-act="${onClickAct}" style="cursor:pointer"` : ''}>
//       <span class="mkpi-ico t-${tone}"><i class="fa-solid ${icon}"></i></span>
//       <span style="min-width:0">
//         <span class="mkpi-label">${esc(label)}</span>
//         <div class="mkpi-value">${value}</div>
//       </span>
//     </div>`;
// }
/** Thẻ KPI nhỏ đầu module */
function mkpi(label, value, icon, tone, onClickAct, note = '', data = {}) {
  return `
    <div class="mkpi" ${Object.entries(data).map(([key, value]) => `data-${esc(key)}="${esc(value)}"`).join(' ')}
      ${onClickAct ? `data-act="${onClickAct}" style="cursor:pointer"` : ''}>

      <span class="mkpi-ico t-${tone}">
        <i class="fa-solid ${icon}"></i>
      </span>

      <span style="min-width:0">
        <span class="mkpi-label">${esc(label)}</span>

        <div class="mkpi-value">
          ${value}
        </div>

        ${
          note
            ? `<div class="cell-sub" style="margin-top:4px;font-size:11px;line-height:1.35">
                 ${note}
               </div>`
            : ''
        }
      </span>

    </div>
  `;
}



/** Nút thao tác cuối dòng bảng */
function rowActions(acts) {
  // Chỉ hiển thị thao tác mà tài khoản hiện tại thực sự có quyền thực hiện.
  // Action chỉ-xem không có mapping quyền vẫn được hiển thị bình thường.
  const visibleActs = (acts || []).filter((a) => {
    if (typeof Auth === 'undefined') return true;
    const required = Auth.permissionForAction(a.act);
    return !required || Auth.hasPermission(required);
  });
  if (!visibleActs.length) return '';
  return `<div class="row-actions">${visibleActs.map((a) => `
      <button class="btn btn-icon btn-sm" data-act="${a.act}" ${a.data || ''} title="${esc(a.title)}"><i class="fa-solid ${a.icon}"></i></button>`).join('')}</div>`;
}

/** Khối tiêu đề trang */
function pageHead(title, sub, actions = '') {
  return `<div class="page-head">
      <div style="min-width:0"><h1>${title}</h1><p>${sub}</p></div>
      ${actions ? `<div class="page-head-actions">${actions}</div>` : ''}
    </div>`;
}

function moduleTabs(tabs, active) {
  return `<div class="tabs module-tabs" style="margin-bottom:16px">
    ${tabs.map((tab) => `<button class="tab ${active === tab.id ? 'active' : ''}" data-act="nav" data-id="${tab.route || tab.id}" ${tab.tab ? `data-tab="${tab.tab}"` : ''}>${esc(tab.label)}</button>`).join('')}
  </div>`;
}

/** Ô thông tin nhãn - giá trị */
const infoItem = (label, value) => `<div class="info-item"><div class="info-label">${esc(label)}</div><div class="info-value">${value}</div></div>`;

/* ------------------------------------------------------- 6. XUẤT DỮ LIỆU */
const Exporter = {
  /** Xuất CSV thật (mở được bằng Excel) — hoạt động hoàn toàn offline */
  csv(filename, headers, rows) {
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const content = '﻿' + [headers.map(q).join(';')].concat(rows.map((r) => r.map(q).join(';'))).join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    Toast.ok('Đã xuất file Excel', filename + ' — ' + rows.length + ' dòng dữ liệu');
  },
  /** Mô phỏng kết xuất PDF (bản demo không nhúng thư viện PDF) */
  pdf(name) {
    Toast.info('Đang kết xuất PDF…', name);
    setTimeout(() => Toast.ok('Đã tạo file PDF', name + '.pdf — sẵn sàng tải xuống'), 1100);
  },
};

/* ------------------------------------------------------------ 7. ROUTER */
// [WORK BADGES] Mỗi menu con có record đang chờ người dùng xử lý sẽ hiện badge đỏ.
// Badge menu cha = tổng badge của các menu con đang có việc. Record đã hoàn tất
// không còn tính badge. Các collection chưa hydrate sẽ trả 0 thay vì dùng số giả.
function navStatus(v){ return String(v || '').trim().toUpperCase(); }
function navCountWhere(rows, fn){ try { return (Array.isArray(rows) ? rows : []).filter(fn).length; } catch (_) { return 0; } }
function navPendingStatus(v){ return ['PENDING','WAITING','NEW','OPEN','DRAFT','WAITING_APPROVAL','PENDING_APPROVAL','WAITING_CONFIRMATION','PENDING_CONFIRMATION','WAITING_WAREHOUSE','WAITING_WAREHOUSE_APPROVAL','APPROVED','READY','READY_TO_SEND','SENT_TO_SUPPLIER','SHIPPING','PARTIAL_RECEIVED','ASSIGNED','IN_TRANSIT','QC_PENDING'].includes(navStatus(v)); }

/* [BADGE ROLE RULE]
 * Badge chỉ dành cho công việc mà vai trò hiện tại CÓ QUYỀN THAO TÁC.
 * Quyền xem (VIEW) không làm phát sinh badge. Ví dụ Mua hàng/QC chỉ xem Tồn kho
 * thì không được nhận badge công việc của Kho.
 */
function navHasAnyPermission(perms){
  try {
    if (!Array.isArray(perms) || !perms.length) return false;
    return perms.some(p => Auth.hasPermission(p));
  } catch (_) { return false; }
}
function navBadgeActionAllowed(key){
  const roleId = (Auth.currentRole() || {}).id || '';
  if (roleId === 'ROLE_ADMIN') return true;

  const rules = {
    // Mua hàng
    'purchase-pr': ['PURCHASE_PR_CREATE','PURCHASE_PR_APPROVE'],
    'purchase-quotes': ['PURCHASE_PR_CREATE','PURCHASE_PO_CREATE'],
    'purchase-po': ['PURCHASE_PO_CREATE','PURCHASE_PO_SEND'],
    'purchase-debts': ['ACCOUNTING_OPERATE','PAYMENT_APPROVE'],

    // Kho — bắt buộc quyền thao tác Kho, INVENTORY_VIEW không đủ.
    'warehouse-receipts': ['INVENTORY_OPERATE'],
    'warehouse-issues': ['INVENTORY_OPERATE'],
    'warehouse-transfers': ['INVENTORY_OPERATE'],
    'warehouse-stocktake': ['INVENTORY_OPERATE','INVENTORY_ADJUST'],
    'warehouse-defects': ['INVENTORY_OPERATE'],
    'warehouse-production-plan': ['INVENTORY_OPERATE'],
    'warehouse-store-replenishment': ['INVENTORY_OPERATE'],

    // Sản xuất
    'production-plan': ['PRODUCTION_OPERATE','PRODUCTION_APPROVE'],
    'production-orders': ['PRODUCTION_OPERATE','PRODUCTION_APPROVE'],
    'production-progress': ['PRODUCTION_OPERATE','PRODUCTION_APPROVE'],

    // Nhà hàng / cửa hàng
    'restaurant-pos': ['RESTAURANT_OPERATE'],
    'restaurant-kitchen': ['RESTAURANT_OPERATE'],
    'restaurant-replenishment': ['RESTAURANT_OPERATE'],
    'restaurant-issue': ['RESTAURANT_OPERATE'],

    // Kế toán / CRM
    'accounting-ar': ['ACCOUNTING_OPERATE','PAYMENT_APPROVE'],
    'accounting-ap': ['ACCOUNTING_OPERATE','PAYMENT_APPROVE'],
    'crm-orders': ['CRM_OPERATE','SALES_ORDER_OPERATE','SALES_APPROVE'],
    'crm-debts': ['CRM_OPERATE','SALES_ORDER_OPERATE','ACCOUNTING_OPERATE'],
    'crm-complaints': ['CRM_OPERATE','SALES_ORDER_OPERATE'],

    // QC
    'quality-iqc': ['QC_INSPECT','QC_APPROVE'],
    'quality-pqc': ['QC_INSPECT','QC_APPROVE'],
    'quality-fqc': ['QC_INSPECT','QC_APPROVE'],
    'quality-oqc': ['QC_INSPECT','QC_APPROVE'],
    'quality-capa': ['QC_INSPECT','QC_APPROVE'],
    'quality-recall': ['QC_INSPECT','QC_APPROVE'],

    // Logistics / bảo trì
    'logistics-deliveries': ['LOGISTICS_OPERATE'],
    'logistics-maintenance': ['LOGISTICS_OPERATE'],
    'maintenance-workorders': ['MAINTENANCE_OPERATE'],

    // R&D
    'rnd-approvals': ['RND_OPERATE'],
  };

  if (key === 'approval-pending') {
    // Có quyền xem approvals chưa đủ; request còn phải đúng CẤP DUYỆT của role.
    return Auth.canAccess('approvals', 'pending') || Auth.canAccess('approvals', null);
  }
  return navHasAnyPermission(rules[key] || []);
}

function navApprovalActionableCount(){
  return navCountWhere(DB?.approvalRequests, req =>
    req.status === 'PENDING' && typeof ApprovalEngine !== 'undefined' &&
    approvalRequestIsCurrent(req) && ApprovalEngine.canAct(req));
}

function incomingInspectionStatus(receipt) {
  const status = String(receipt.inspectionStatus || 'PENDING').trim().toUpperCase();
  return ['QC_PENDING','WAITING_QC'].includes(status) ? 'PENDING' : status;
}
function incomingInspectionReceipts() {
  const unique = new Map();
  for (const receipt of DB.goodsReceipts || []) {
    if (!receipt || !receipt.id) continue;
    const old = unique.get(receipt.id);
    if (!old || String(receipt.updatedAt || receipt.inspectedAt || receipt.date || '') >= String(old.updatedAt || old.inspectedAt || old.date || '')) unique.set(receipt.id, receipt);
  }
  return [...unique.values()].filter(receipt => receipt.poId && (receipt.items || []).length &&
    !['CANCELLED','CANCELED'].includes(String(receipt.status || '').trim().toUpperCase()));
}

function navWorkCount(key){
  // Không hiển thị số từ local cache ở first-paint. Đợi warmup server hoàn tất
  // rồi hiện thẳng số đúng, tránh 2 -> 5 trong vài chục ms.
  if (window.SidebarBadges && !window.SidebarBadges.isReady?.('all')) return 0;
  if (!navBadgeActionAllowed(key)) return 0;

  const S = navStatus;
  switch (key) {
    // Mua hàng
    case 'purchase-pr': return navCountWhere(DB?.purchases, x => ['MH_CHO_DUYET','PENDING_APPROVAL'].includes(S(x.status)));
    case 'purchase-quotes': return navCountWhere(DB?.purchases, p => purchaseQuoteProcessStatus(p) === 'WAITING_QUOTE' && (PURCHASE_INVENTORY_CONFIG.prStatus.approved || []).includes(p.status));
    case 'purchase-po': return navCountWhere(DB?.purchaseOrders, x => ['DRAFT','READY_TO_SEND','SENT_TO_SUPPLIER','SHIPPING','PARTIAL_RECEIVED'].includes(S(x.status)));
    case 'purchase-debts': return navCountWhere(DB?.supplierPayments, x => navPendingStatus(x.status)) + navCountWhere(DB?.supplierRefunds, x => navPendingStatus(x.status));

    // Kho
    case 'warehouse-receipts': return navCountWhere(DB?.purchaseOrders, x => ['SHIPPING','PARTIAL_RECEIVED'].includes(S(x.status))) + navCountWhere(DB?.goodsReceipts, x => ['WAITING_RECEIPT','PENDING_RECEIPT'].includes(S(x.status)));
    case 'warehouse-issues': {
      const req = navCountWhere(DB?.productionMaterialRequests, x => ['APPROVED','WAITING_WAREHOUSE_APPROVAL'].includes(S(x.status)));
      const sales = navCountWhere(DB?.goodsIssues, x => S(x.status)==='PENDING_CONFIRMATION' && S(x.qcStatus||'PENDING')==='PASSED');
      const returns = navCountWhere(DB?.materialReturnRequests, x => ['WAITING_WAREHOUSE','WAITING_WAREHOUSE_CONFIRMATION','PENDING_WAREHOUSE'].includes(S(x.status)));
      return req + sales + returns;
    }
    case 'warehouse-transfers': return navCountWhere(DB?.stockTransfers, x => ['PENDING','WAITING','PENDING_CONFIRMATION','WAITING_CONFIRMATION','IN_TRANSIT'].includes(S(x.status)));
    case 'warehouse-stocktake': return navCountWhere(DB?.inventoryCounts, x => ['DRAFT','IN_PROGRESS','PENDING'].includes(S(x.status)));
    case 'warehouse-defects': return navCountWhere(DB?.materialReturnRequests, x => ['WAITING_WAREHOUSE','WAITING_WAREHOUSE_CONFIRMATION','PENDING_WAREHOUSE'].includes(S(x.status))) + navCountWhere(DB?.inventory, x => Number(x.qtyRejected||0)>0);
    case 'warehouse-production-plan': return navCountWhere(DB?.productionPlans, x => ['WAITING_APPROVAL','APPROVED'].includes(S(x.status)));
    case 'warehouse-store-replenishment': return navCountWhere(DB?.restaurantReplenishmentRequests, x => { const st=(typeof restaurantReplenishmentDerivedStatus==='function'?restaurantReplenishmentDerivedStatus(x):x.status); return ['REQUESTED','PARTIAL_RECEIVED','PENDING','WAITING_WAREHOUSE','WAITING_APPROVAL','APPROVED'].includes(S(st)); });

    // Sản xuất
    case 'production-plan': return navCountWhere(DB?.productionPlans, x => ['APPROVED','MATERIAL_ISSUED'].includes(S(x.status)));
    case 'production-orders': return navCountWhere(DB?.productionOrders, x => ['LSX_CHO_SAN_XUAT','LSX_DANG_SAN_XUAT','LSX_DANG_QC'].includes(S(x.status)));
    case 'production-progress': return navCountWhere(DB?.productionOrders, x => ['LSX_CHO_SAN_XUAT','LSX_DANG_SAN_XUAT'].includes(S(x.status)));

    // Nhà hàng / cửa hàng
    case 'restaurant-pos': return navCountWhere(DB?.restaurantPosOrders, x => ['NEW','PENDING_PAYMENT','OPEN'].includes(S(x.status)));
    case 'restaurant-kitchen': return navCountWhere(DB?.restaurantPosOrders, x => ['NEW','PENDING','WAITING_KITCHEN','COOKING'].includes(S(x.kitchenStatus || x.status)));
    case 'restaurant-replenishment': return navCountWhere(DB?.restaurantReplenishmentRequests, x => { const st=(typeof restaurantReplenishmentDerivedStatus==='function'?restaurantReplenishmentDerivedStatus(x):x.status); return ['REQUESTED','PARTIAL_RECEIVED','ISSUED','PENDING','WAITING_APPROVAL','WAITING_WAREHOUSE'].includes(S(st)); });
    case 'restaurant-issue': return navCountWhere(DB?.restaurantReplenishmentRequests, x => ['APPROVED','WAITING_ISSUE'].includes(S(x.status)));

    // Kế toán / CRM
    case 'accounting-ar': return navCountWhere(DB?.customerPayments, x => S(x.confirmStatus)==='PENDING'); // khoản thu chờ kế toán xác nhận đã nhận tiền
    case 'accounting-ap': return navCountWhere(DB?.purchaseOrders, x => ['RECEIVED','PARTIAL_RECEIVED'].includes(S(x.status)) && Number(x.remainingAmount ?? x.payable ?? x.balanceDue ?? 0) > 0);
    case 'crm-orders': return navCountWhere(DB?.orders, x => ['DH_CHO_XAC_NHAN','PENDING','NEW','CONFIRMED','DH_CHO_SAN_XUAT'].includes(S(x.status)));
    case 'crm-debts': return navCountWhere(DB?.orders, x => Number(x.remainingAmount ?? x.debt ?? x.balanceDue ?? 0) > 0);
    case 'crm-complaints': return navCountWhere(DB?.crmComplaints, x => !['CLOSED','RESOLVED','DONE'].includes(S(x.status)));

    // QC
    case 'quality-iqc': return incomingInspectionReceipts().filter(x => incomingInspectionStatus(x) === 'PENDING').length;
    case 'quality-pqc': return navCountWhere(DB?.productionOrders, x => ['LSX_DANG_SAN_XUAT','LSX_DANG_QC'].includes(S(x.status)) && (x.stages||[]).some(st => ['PENDING_QC','QC_PENDING','WAITING_QC'].includes(S(st.qcStatus || st.status))));
    case 'quality-oqc': return navCountWhere(DB?.goodsIssues, x => S(x.type)==='SALES_ISSUE' && S(x.status)==='PENDING_CONFIRMATION' && S(x.qcStatus||'PENDING')==='PENDING');
    case 'quality-fqc': return navCountWhere(DB?.productionFinalInspections, x => ['PENDING','WAITING','QC_PENDING'].includes(S(x.status)));
    case 'quality-capa': return navCountWhere(DB?.qualityCapa, x => !['CLOSED','DONE','COMPLETED'].includes(S(x.status)));
    case 'quality-recall': return navCountWhere(DB?.qualityRecalls, x => !['CLOSED','DONE','COMPLETED'].includes(S(x.status)));

    // Logistics / bảo trì
    case 'logistics-deliveries': return navCountWhere(DB?.logisticsDeliveries, x => ['PENDING','WAITING','READY','ASSIGNED','IN_TRANSIT'].includes(S(x.status)));
    case 'logistics-maintenance': return navCountWhere(DB?.logisticsMaintenance, x => ['PENDING','DUE','OVERDUE','IN_PROGRESS'].includes(S(x.status)));
    case 'maintenance-workorders': return navCountWhere(DB?.maintenanceWorkOrders, x => ['NEW','OPEN','PENDING','IN_PROGRESS'].includes(S(x.status)));

    // R&D / Phê duyệt
    case 'rnd-approvals': return navCountWhere(DB?.rndApprovals, x => ['PENDING','WAITING'].includes(S(x.status)));
    case 'approval-pending': return navApprovalActionableCount();
    default: return 0;
  }
}
function navEntryCount(it){
  if (!it) return 0;
  if (Array.isArray(it.children) && it.children.length) {
    // Parent chỉ là tổng các menu con mà role hiện tại thật sự nhìn thấy và có badge.
    // Không fallback sang cảnh báo/module khác để tránh role chỉ VIEW cũng bị badge.
    return it.children.reduce((sum,c) => sum + Number(typeof c.count==='function' ? c.count() : 0), 0);
  }
  return Number(typeof it.count==='function' ? it.count() : 0) || 0;
}
const NAV = [
  { group: 'TỔNG QUAN', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high' },
  ]},
  { group: 'NGHIỆP VỤ', items: [
    {
      id: 'purchases',
      label: 'Mua hàng',
      icon: 'fa-cart-shopping',
      children: [
        { id: 'dashboard', label: 'Tổng quan' },
        { id: 'pr', label: 'Đề nghị mua hàng', count: () => navWorkCount('purchase-pr'), alert: true },
        { id: 'quotes', label: 'Báo giá nhà cung cấp', count: () => navWorkCount('purchase-quotes'), alert: true },
        { id: 'po', label: 'Đơn đặt hàng', count: () => navWorkCount('purchase-po'), alert: true },
        { id: 'debts', label: 'Công nợ NCC', count: () => navWorkCount('purchase-debts'), alert: true },
        { id: 'price_history', label: 'Lịch sử giá mua' },
        { id: 'suppliers', label: 'Nhà cung cấp' }
      ],
      alert: true
    },
    {
      id: 'warehouse',
      label: 'Kho',
      icon: 'fa-boxes-stacked',
      children: [
        { id: 'dashboard', label: 'Tổng quan' },
        { id: 'receipts', label: 'Nhập kho', count: () => navWorkCount('warehouse-receipts'), alert: true },
        { id: 'issues', label: 'Xuất kho', count: () => navWorkCount('warehouse-issues'), alert: true },
        { id: 'transfers', label: 'Chuyển kho', count: () => navWorkCount('warehouse-transfers'), alert: true },
        { id: 'inventory', label: 'Tồn kho' },
        { id: 'stock_period', label: 'Thống kê tồn theo kỳ' },
        { id: 'locations', label: 'Quản lý kho' },
        // Tạm ẩn theo yêu cầu: Lô và hạn sử dụng
        // { id: 'batches', label: 'Lô và hạn sử dụng' },
        { id: 'shelf_life', label: 'Cấu hình hạn dùng' },
        { id: 'defects', label: 'Hàng lỗi & hàng trả về', count: () => navWorkCount('warehouse-defects'), alert: true },
        { id: 'production_plan', label: 'Kế hoạch sản xuất & gia công', count: () => navWorkCount('warehouse-production-plan'), alert: true },
        { id: 'store_replenishment', label: 'Duyệt bổ sung cửa hàng', count: () => navWorkCount('warehouse-store-replenishment'), alert: true },
        // Tạm ẩn: Cảnh báo kho, Barcode / QR Code
      ],
      alert: true
    },
    {
      id: 'production',
      label: 'Sản xuất',
      icon: 'fa-industry',
      children: [
        { id: 'dashboard', label: 'Tổng quan sản xuất' },
        { id: 'orders', label: 'Lệnh sản xuất', count: () => navWorkCount('production-orders'), alert: true },
        { id: 'bom', label: 'BOM / Định mức' },
        { id: 'plan', label: 'Kế hoạch sản xuất', count: () => navWorkCount('production-plan'), alert: true },
        { id: 'progress', label: 'Tiến độ sản xuất', count: () => navWorkCount('production-progress'), alert: true },
        // Tạm ẩn: Nhập kho thành phẩm, Theo dõi bán thành phẩm
      ],
    },
    {
      id: 'subcontracting',
      label: 'Gia công',
      icon: 'fa-screwdriver-wrench',
      children: [
        { id: 'dashboard', label: 'Tổng quan' },
        { id: 'orders', label: 'Đơn gia công' },
        { id: 'materials', label: 'NVL khách gửi' },
        { id: 'customers', label: 'Khách hàng gia công' },
        // Tạm ẩn: Nhận hàng hoàn thành (đã gộp vào chi tiết kế hoạch), Báo cáo gia công
      ]
    },
    {
      id: 'restaurant',
      label: 'Nhà hàng & Cửa hàng',
      icon: 'fa-utensils',
      children: [
        { id: 'dashboard', label: 'Tổng quan' },
        { id: 'pos', label: 'Order / Bán hàng', count: () => navWorkCount('restaurant-pos'), alert: true },
        { id: 'kitchen', label: 'Bếp / Chế biến', count: () => navWorkCount('restaurant-kitchen'), alert: true },
        { id: 'recipe', label: 'Menu / Công thức món' },
        { id: 'branches', label: 'Chi nhánh' },
        { id: 'store_stock', label: 'Tồn kho cửa hàng' },
        { id: 'replenishment', label: 'Yêu cầu bổ sung', count: () => navWorkCount('restaurant-replenishment'), alert: true },
        { id: 'issue', label: 'Xuất kho nguyên liệu', count: () => navWorkCount('restaurant-issue'), alert: true },
        { id: 'revenue', label: 'Doanh thu' }
        // Báo cáo cửa hàng đã tích hợp vào Tổng quan.
      ]
    },
    {
      id: 'accounting',
      label: 'Kế toán – Tài chính',
      icon: 'fa-coins',
      children: [
        { id: 'dashboard', label: 'Tổng quan tài chính' },
        { id: 'entries', label: 'Định khoản' },
        { id: 'general_ledger', label: 'Hạch toán' },
        { id: 'ar', label: 'Công nợ phải thu', count: () => navWorkCount('accounting-ar'), alert: true },
        { id: 'ap', label: 'Công nợ phải chi', count: () => navWorkCount('accounting-ap'), alert: true },
        { id: 'cashflow_inout', label: 'Thu – Chi' },
        { id: 'banking', label: 'Ngân hàng' },
        { id: 'costing', label: 'Giá thành' },
        { id: 'fixed_assets', label: 'Tài sản cố định' },
        { id: 'revenue_period', label: 'Doanh thu theo kỳ' },
        { id: 'invoices', label: 'Hóa đơn' },
        { id: 'tax', label: 'Thuế' },
        { id: 'reports', label: 'Báo cáo tài chính' }
      ]
    },
    {
      id: 'hr',
      label: 'Nhân sự – Tiền lương',
      icon: 'fa-users',
      children: [
        { id: 'dashboard', label: 'Tổng quan nhân sự' },
        { id: 'attendance', label: 'Chấm công' },
        { id: 'timesheet', label: 'Bảng công ngày' },
        { id: 'shifts', label: 'Phân ca' },
        { id: 'daystats', label: 'Thống kê chuyến / tấn' },
        { id: 'kpi', label: 'KPI' },
        { id: 'evaluations', label: 'Đánh giá' },
        { id: 'efficiency', label: 'Hiệu quả lao động' },
        { id: 'payroll', label: 'Tính lương' },
        { id: 'pay_profiles', label: 'Hồ sơ lương' },
        { id: 'pay_config', label: 'Cấu hình lương' }
      ]
    },
    {
      id: 'quality',
      label: 'QC / QA',
      icon: 'fa-shield-halved',
      children: [
        { id: 'dashboard', label: 'Tổng quan chất lượng' },
        { id: 'iqc', label: 'Kiểm tra đầu vào', count: () => navWorkCount('quality-iqc'), alert: true },
        { id: 'pqc', label: 'Kiểm tra bán thành phẩm', count: () => navWorkCount('quality-pqc'), alert: true },
        { id: 'fqc', label: 'Kiểm tra thành phẩm', count: () => navWorkCount('quality-fqc'), alert: true },
        { id: 'oqc', label: 'Kiểm tra xuất kho', count: () => navWorkCount('quality-oqc'), alert: true },
        { id: 'subcontracting_qc', label: 'Kiểm tra gia công', count: () => (typeof gcQcPendingCount === 'function' ? gcQcPendingCount() : 0), alert: true },
        { id: 'coa', label: 'Hồ sơ kiểm nghiệm' },
        { id: 'capa', label: 'CAPA', count: () => navWorkCount('quality-capa'), alert: true },
        { id: 'recall', label: 'Thu hồi sản phẩm', count: () => navWorkCount('quality-recall'), alert: true }
      ]
    },
    {
      id: 'maintenance',
      label: 'Bảo trì thiết bị',
      icon: 'fa-gears',
      children: [
        { id: 'dashboard', label: 'Tổng quan' },
        { id: 'equipment', label: 'Danh sách máy móc' },
        { id: 'equipment_catalog', label: 'Danh mục máy móc' },
        { id: 'schedule', label: 'Lịch bảo trì' },
        { id: 'work_orders', label: 'Phiếu sửa chữa', count: () => navWorkCount('maintenance-workorders'), alert: true },
        { id: 'logs', label: 'Nhật ký máy' }
      ]
    },
    {
      id: 'crm',
      label: 'CRM – Bán hàng',
      icon: 'fa-handshake',
      children: [
        { id: 'dashboard', label: 'Tổng quan' },
        { id: 'customers', label: 'Khách hàng' },
        { id: 'transactions', label: 'Lịch sử giao dịch' },
        { id: 'orders', label: 'Đơn hàng bán', count: () => navWorkCount('crm-orders'), alert: true },
        { id: 'debts', label: 'Công nợ khách hàng', count: () => navWorkCount('crm-debts'), alert: true },
      ]
    },
    {
      id: 'logistics',
      label: 'Logistics & Fleet',
      icon: 'fa-truck',
      children: [
        { id: 'dashboard', label: 'Tổng quan vận tải' },
        { id: 'deliveries', label: 'Đơn giao hàng', count: () => navWorkCount('logistics-deliveries'), alert: true },
        { id: 'maintenance', label: 'Bảo trì xe', count: () => navWorkCount('logistics-maintenance'), alert: true },
        { id: 'fleet', label: 'Danh sách xe' },
        { id: 'vehicle-types', label: 'Danh mục xe' },
        { id: 'drivers', label: 'Danh sách tài xế' },
        { id: 'schedule', label: 'Lịch giao hàng' }
      ]
    },
    {
      id: 'rnd',
      label: 'R&D',
      icon: 'fa-flask',
      children: [
        { id: 'dashboard', label: 'Tổng quan R&D' },
        { id: 'projects', label: 'Dự án nghiên cứu' },
        { id: 'formula', label: 'Công thức' },
        { id: 'versions', label: 'Phiên bản công thức' },
        { id: 'trials', label: 'Thử nghiệm' },
        { id: 'costs', label: 'Chi phí nghiên cứu' },
        { id: 'approvals', label: 'Quy trình duyệt', count: () => navWorkCount('rnd-approvals'), alert: true },
        { id: 'reports', label: 'Báo cáo R&D' }
      ]
    },
    {
      id: 'approvals',
      label: 'Phê duyệt',
      icon: 'fa-circle-check',
      children: [
        { id: 'dashboard', label: 'Tổng quan' },
        { id: 'pending', label: 'Việc cần duyệt', count: () => navWorkCount('approval-pending'), alert: true },
        { id: 'workflows', label: 'Quy trình phê duyệt' },
        { id: 'signature', label: 'Chữ ký điện tử' }
      ]
    },
    {
      id: 'bi',
      label: 'Quản trị doanh nghiệp — BI',
      icon: 'fa-chart-line',
      children: [
        { id: 'finance', label: 'Tài chính' },
        { id: 'warehouse', label: 'Kho' },
        { id: 'production', label: 'Sản xuất' },
        { id: 'sales', label: 'Kinh doanh' },
        { id: 'restaurant', label: 'Nhà hàng' },
        { id: 'hr', label: 'Nhân sự' }
      ]
    }
  ]},
  { group: 'TÀI KHOẢN', items: [
    { id: 'my-access', label: 'Thông tin phân quyền', icon: 'fa-id-card' },
  ]},
  { group: 'QUẢN TRỊ', items: [
    { id: 'users', label: 'Hệ thống', icon: 'fa-gear' },
  ]},
];

/** Thông tin tiêu đề / breadcrumb từng màn hình */
const META = {
  dashboard:   { title: 'Dashboard – Lê Nam ERP', sub: 'Theo dõi hoạt động kinh doanh đậu hủ theo thời gian thực', crumb: ['Tổng quan', 'Dashboard'] },
  customers: { title: 'Quản lý khách hàng', sub: 'Hồ sơ khách hàng, lịch sử giao dịch đậu hủ và công nợ', crumb: ['CRM – Bán hàng', 'Khách hàng']},
  crm: { title: 'CRM – Bán hàng', sub: 'Quản lý khách hàng, đơn hàng và hoạt động bán hàng', crumb: ['CRM – Bán hàng', 'Tổng quan']},
  orders: { title: 'Quản lý đơn hàng', sub: 'Theo dõi đơn hàng đậu hủ từ lúc đặt tới khi giao', crumb: ['CRM – Bán hàng', 'Đơn hàng']},
  quotes:      { title: 'Quản lý báo giá', sub: 'Lập, gửi và theo dõi báo giá đậu hủ tới khi chốt đơn hàng', crumb: ['Bán hàng', 'Báo giá'] },
  'quote-detail': { title: 'Chi tiết báo giá', sub: 'Tham số sản phẩm — định mức — phân tích giá thành', crumb: ['Bán hàng', 'Báo giá', 'Chi tiết'], parent: 'quotes' },
  pricebook:   { title: 'Đơn giá đầu vào', sub: 'Đơn giá nguyên liệu, công đoạn và bảng giá sản phẩm đậu hủ', crumb: ['Bán hàng', 'Đơn giá đầu vào'] },
  catalogs:    { title: 'Danh mục hệ thống', sub: 'Nhà cung cấp, sản phẩm, quy trình sản xuất đậu hủ', crumb: ['Hệ thống', 'Danh mục'] },
  'order-detail': { title: 'Chi tiết đơn hàng', sub: 'Thông tin đơn hàng và tiến trình xử lý', crumb: ['Bán hàng', 'Đơn hàng', 'Chi tiết'], parent: 'orders' },
  contracts:   { title: 'Quản lý hợp đồng', sub: 'Hợp đồng cung cấp đậu hủ, tiến độ thanh toán và hiệu lực', crumb: ['Bán hàng', 'Hợp đồng'] },
  production:  { title: 'Lệnh sản xuất', sub: 'Điều hành lệnh sản xuất đậu hủ theo từng công đoạn', crumb: ['Sản xuất', 'Lệnh sản xuất'] },
  'production-detail': { title: 'Chi tiết lệnh sản xuất', sub: 'Quy trình sản xuất đậu hủ, vật tư và tiến độ thực tế', crumb: ['Sản xuất', 'Lệnh sản xuất', 'Chi tiết'], parent: 'production' },
  progress:    { title: 'Tiến độ sản xuất', sub: 'Bảng điều hành dây chuyền ngâm – xay – nấu – ép – đóng gói', crumb: ['Sản xuất', 'Tiến độ sản xuất'] },
  operations:  { title: 'Công đoạn & BOM', sub: 'Danh mục công đoạn sản xuất đậu hủ và định mức nguyên liệu', crumb: ['Sản xuất', 'Công đoạn & BOM'] },
  materials:   { title: 'Quản lý vật tư', sub: 'Nguyên liệu, hóa chất, bao bì, thiết bị và tồn kho đậu hủ', crumb: ['Kho & Vật tư', 'Vật tư'] },
  inventory:   { title: 'Tồn kho & biến động', sub: 'Phiếu nhập, phiếu xuất và lịch sử giao dịch kho', crumb: ['Kho & Vật tư', 'Tồn kho'] },
  purchases:   { title: 'Trung tâm Mua hàng', sub: 'PR → Phê duyệt → Báo giá NCC → PO → Nhập kho → Công nợ', crumb: ['Mua hàng', 'Quản lý mua sắm'] },
  suppliers:   { title: 'Nhà cung cấp', sub: 'Danh mục đối tác cung cấp nguyên liệu, bao bì, dịch vụ và vận chuyển cho Lê Nam', crumb: ['Mua hàng', 'Nhà cung cấp'] },
  'my-access': { title: 'Thông tin phân quyền', sub: 'Quyền truy cập và thao tác của tài khoản đang đăng nhập', crumb: ['Tài khoản', 'Thông tin phân quyền'] },
  users:       { title: 'Người dùng & phân quyền', sub: 'Tài khoản đăng nhập và vai trò truy cập hệ thống', crumb: ['Quản trị', 'Hệ thống'] },
  settings:    { title: 'Cài đặt hệ thống', sub: 'Thông tin Công ty TNHH SX TM DV Lê Nam và tham số vận hành', crumb: ['Quản trị', 'Cài đặt'] },
};

/** Bảng đăng ký view — được nạp ở app.js */
const Views = {};

/** Hàm render Placeholder tiêu chuẩn UI cho các menu con chưa phát triển backend/CRUD */
function renderPlaceholderView(moduleName, tabName, icon = 'fa-gear') {
  return `
    ${pageHead(esc(tabName), `Chức năng thuộc phân hệ ${esc(moduleName)}`, '<button class="btn btn-sm" disabled style="opacity:0.75"><i class="fa-solid fa-clock"></i> Giai đoạn tiếp theo</button>')}
    <div class="card" style="padding:48px 24px;text-align:center;max-width:720px;margin:24px auto;border-radius:12px;border:1px dashed var(--border);">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--primary-soft);color:var(--primary);display:inline-flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 16px auto;">
        <i class="fa-solid ${icon}"></i>
      </div>
      <h3 style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text);">${esc(tabName)}</h3>
      <p style="font-size:13.5px;color:var(--text-muted);margin-bottom:20px;line-height:1.6;max-width:480px;margin-left:auto;margin-right:auto;">
        Chức năng <b>${esc(tabName)}</b> thuộc phân hệ <b>${esc(moduleName)}</b> đang được hoàn thiện cấu trúc giao diện &amp; nghiệp vụ chi tiết.
      </p>
      <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:var(--bg-hover);border-radius:20px;font-size:12.5px;color:var(--text-2);">
        <i class="fa-solid fa-link" style="color:var(--primary);"></i>
        <span>Route SPA: <code>#${esc(State.module)}${State.tab ? '/' + esc(State.tab) : ''}</code></span>
      </div>
    </div>
  `;
}



/**
 * Xóa bộ lọc điều hướng tạm khi người dùng CHỦ ĐỘNG chuyển tab/menu.
 * Chỉ xử lý filter do Dashboard/KPI gắn vào, không xóa filter người dùng tự chọn.
 */
function clearTransientNavigationFilter(module, nextTab = null) {
  const transient = State.transientFilters?.[module];
  if (!transient) return;

  // Nếu vẫn đang điều hướng tới chính tab mà Dashboard vừa mở thì giữ filter.
  // Filter chỉ được bỏ khi người dùng rời tab đó.
  if (transient.tab && transient.tab === nextTab) return;

  const filterKey = transient.filterKey || module;
  const f = F(filterKey);
  (transient.fields || []).forEach((field) => {
    if (field in f) f[field] = '';
  });

  if (transient.pageKey) State.page[transient.pageKey] = 1;
  delete State.transientFilters[module];
}

/** Điều hướng sang module khác */
function go(module, params = {}) {
  // Giữ lại module trước khi đổi State. Sidebar dùng go() + history.replaceState(),
  // KHÔNG phát sinh hashchange. Vì vậy server-first phải được xử lý ngay tại đây,
  // nếu không HR sẽ render snapshot 86 trước rồi KIO mới đổi thành số thật.
  const previousModule = State.module;
  const requestedTab = params.tab || null;
  if (typeof Auth !== 'undefined' && Auth.currentAccount() && !Auth.canAccess(module, requestedTab)) {
    Toast.err('Không có quyền truy cập', 'Vai trò hiện tại không được cấp quyền vào chức năng này.');
    return;
  }
  State.module = module;
  State.params = params;

  let navItem = null;
  for (const group of NAV) {
    const found = group.items.find(i => i.id === module);
    if (found) { navItem = found; break; }
  }

  if (navItem && Array.isArray(navItem.children) && navItem.children.length > 0) {
    const allowedChildren = navItem.children.filter(c => Auth.canAccess(module, c.tab || c.id));
    const firstChild = allowedChildren[0] || navItem.children[0];
    const defaultTab = firstChild.tab || firstChild.id;
    State.tab = params.tab || defaultTab;
  } else {
    State.tab = params.tab || null;
  }

  const hash = module === 'production-detail' && params.id
    ? `${module}/${encodeURIComponent(params.id)}`
    : (State.tab ? `${module}/${State.tab}` : module);

  if (location.hash.replace('#', '') !== hash) {
    try {
      history.replaceState(null, '', '#' + hash);
    } catch (e) { /* bỏ qua */ }
  }

  Pop.close();
  if (window.innerWidth <= 900) closeSidebar();

  // [HR SERVER-FIRST VIA SIDEBAR]
  // go() dùng history.replaceState nên browser không bắn hashchange. Trước đây
  // render() chạy ngay với DB.employees từ data.js/cache (86), sau đó
  // scheduleRouteDataRefresh mới lấy KIO (51) và render lại => nháy 86 -> 51.
  // Khi đi TỪ module khác VÀO HR, tuyệt đối không first-paint dữ liệu cũ.
  // Giữ nguyên màn hình hiện tại trong lúc request ngắn, lấy server xong mới render HR.
  if (module === 'hr' && previousModule !== 'hr' && typeof HRAPI !== 'undefined') {
    Promise.resolve().then(async () => {
      try {
        await HRAPI.bootstrap?.();
        await HRAPI.ensureFresh?.(['employees'], { force: true });
      } catch (err) {
        console.warn('[HR] Không hydrate được nhân sự KIO trước first paint từ sidebar:', err);
      }
      if (State.module !== 'hr') return;
      render();
      // Không schedule refresh HR lần nữa ngay sau force:true để tránh request/render kép.
      $('.view')?.scrollTo?.({ top: 0 });
      window.scrollTo({
        top: 0,
        behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto'
      });
    });
    return;
  }

  // [QC FAST CACHE] IQC/FQC dùng cùng cơ chế điều hướng như Kho:
  // render ngay từ snapshot đã hydrate trong phiên; scheduleRouteDataRefresh()
  // chỉ đọc server khi collection chưa fresh/đã hết TTL/được đánh dấu thay đổi.
  // Không force list.php và không hiện màn 'Đang tải dữ liệu' mỗi lần đổi tab.
  render();
  if (typeof scheduleRouteDataRefresh === 'function') {
    scheduleRouteDataRefresh(State.module, State.tab);
  }

  $('.view')?.scrollTo?.({ top: 0 });
  window.scrollTo({
    top: 0,
    behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto'
  });
}

function getPageMeta() {
  const module = State.module;
  const tab = State.tab;

  if (module === 'purchases') {
    const purchaseCrumbMap = {
      pr: 'Đề nghị mua',
      dashboard: 'Tổng quan',
      approval: 'Duyệt mua hàng',
      quotes: 'Báo giá NCC',
      po: 'Đơn đặt hàng',
      debts: 'Công nợ NCC',
      price_history: 'Lịch sử giá mua',
      budget: 'Cảnh báo vượt ngân sách',
      stock_control: 'Kiểm soát tồn kho',
      evaluations: 'Đánh giá NCC',
      suppliers: 'Nhà cung cấp',
      reports: 'Báo cáo mua hàng'
    };
    const tabName = purchaseCrumbMap[tab] || 'Đề nghị mua';
    return {
      title: 'Mua hàng',
      sub: 'PR → Phê duyệt → Báo giá NCC → PO → Nhập kho → Công nợ',
      crumb: ['Mua hàng', tabName],
      parent: 'purchases'
    };
  }

  let navParent = null;
  let navChild = null;
  for (const group of NAV) {
    const item = group.items.find(i => i.id === module);
    if (item) {
      navParent = item;
      if (Array.isArray(item.children)) {
        navChild = item.children.find(c => (c.tab || c.id) === tab);
        if (!navChild) {
          for (const childGroup of item.children) {
            if (!Array.isArray(childGroup.children)) continue;
            const nested = childGroup.children.find(c => (c.tab || c.id) === tab);
            if (nested) { navChild = nested; break; }
          }
        }
      }
      break;
    }
  }

  if (navParent) {
    if (navChild) {
      return {
        title: navChild.label,
        sub: `Quản lý ${navChild.label} thuộc phân hệ ${navParent.label}`,
        crumb: [navParent.label, navChild.label],
        parent: navParent.id
      };
    }
    return {
      title: navParent.label,
      sub: `Quản lý tổng quan phân hệ ${navParent.label}`,
      crumb: [navParent.label, 'Tổng quan'],
      parent: navParent.id
    };
  }

  return META[module] || { title: 'Lê Nam ERP', sub: 'Hệ thống quản lý sản xuất và kinh doanh', crumb: ['Hệ thống'] };
}

/** Vẽ lại toàn bộ view hiện tại (giữ nguyên con trỏ trong ô đang nhập) */
function render() {
  const active = document.activeElement;
  const keepF = active && active.dataset && active.dataset.f ? active.dataset.f : null;
  const caret = keepF && active.selectionStart != null ? active.selectionStart : null;

  Charts.destroyAll();

  const meta = getPageMeta();
  $('#crumbTitle').textContent = meta.title;
  $('#crumb').innerHTML = meta.crumb
    .map((c, i) => (
      i === meta.crumb.length - 1
        ? `<b>${esc(c)}</b>`
        : `<span>${esc(c)}</span><i class="fa-solid fa-chevron-right"></i>`
    ))
    .join('');

  const view = $('#view');
  const fn = Views[State.module];
  let html = '';

  if (typeof fn === 'function') {
    html = fn(State.params) || '';
  }

  if (!html) {
    const icon = (NAV.flatMap(g => g.items).find(i => i.id === State.module) || {}).icon || 'fa-gear';
    html = renderPlaceholderView(meta.crumb[0] || State.module, meta.crumb[1] || meta.title, icon);
  }

  view.innerHTML = html;
  enforceBusinessDateInputs(view);

  if (typeof fn === 'function' && typeof fn.after === 'function') {
    fn.after(State.params);
  }

  renderNav();

  if (keepF) {
    const again = view.querySelector(`[data-f="${CSS.escape(keepF)}"]`);
    if (again) { again.focus(); if (caret != null && again.setSelectionRange) again.setSelectionRange(caret, caret); }
  }
}

/** Sidebar Navigation Render & Behavior */
function renderNav() {
  const curModule = State.module;
  const curTab = State.tab;
  State.openNavParents = State.openNavParents || {};

  // [UI FIX] Giữ nguyên vị trí cuộn sidebar khi render lại nội dung.
  // Trước đây renderNav() thay toàn bộ innerHTML làm menu ở các phân hệ thấp
  // (Sản xuất/CRM/...) bị nhảy lên một mục sau mỗi lần render.
  const navEl = $('#nav');
  const previousScrollTop = navEl ? navEl.scrollTop : 0;

  const roleNav = NAV.map(g => ({
    ...g,
    items: g.items
      .filter(it => Auth.canAccess(it.id, null))
      .map(it => ({
        ...it,
        children: Array.isArray(it.children)
          ? it.children.map(c => {
              if (Array.isArray(c.children)) {
                const nested = c.children.filter(nc => Auth.canAccess(it.id, nc.tab || nc.id));
                return nested.length ? {...c, children:nested} : null;
              }
              return Auth.canAccess(it.id, c.tab || c.id) ? c : null;
            }).filter(Boolean)
          : it.children
      }))
  })).filter(g => g.items.length);

  navEl.innerHTML = roleNav.map(g => `
    <div class="nav-group">${esc(g.group)}</div>

    ${g.items.map(it => {
      const n = navEntryCount(it);
      const hasChildren = Array.isArray(it.children) && it.children.length > 0;

      if (hasChildren) {
        const isParentActive = curModule === it.id;
        const isParentOpen = isParentActive || State.openNavParents[it.id] === true;

        return `
          <div class="nav-parent ${isParentActive ? 'active' : ''} ${isParentOpen ? 'open' : ''}">
            <button
              class="nav-item nav-toggle ${isParentActive ? 'active' : ''}"
              data-submenu="${it.id}"
              type="button"
            >
              <i class="fa-solid ${it.icon}"></i>
              <span>${esc(it.label)}</span>
              ${n ? `<span class="nav-count ${it.alert ? 'alert' : ''}">${n}</span>` : ''}
              <i class="fa-solid fa-chevron-down nav-arrow"></i>
            </button>

            <div class="nav-submenu" data-submenu-content="${it.id}">
              ${it.children.map((child, idx) => {
                if (Array.isArray(child.children) && child.children.length) {
                  const nestedActive = isParentActive && child.children.some(nc => (nc.tab || nc.id) === curTab);
                  return `
                    <div class="nav-subgroup ${nestedActive ? 'active' : ''}">
                      <div class="nav-subgroup-title"><i class="fa-solid fa-cart-shopping"></i><span>${esc(child.label)}</span></div>
                      <div class="nav-subgroup-items">
                        ${child.children.map(nc => {
                          const nestedTab = nc.tab || nc.id;
                          const isNestedActive = isParentActive && curTab === nestedTab;
                          return `
                            <button
                              class="nav-subitem nav-subitem-nested ${isNestedActive ? 'active' : ''}"
                              data-act="nav"
                              data-id="${it.id}"
                              data-tab="${nestedTab}"
                              type="button">
                              <span>${esc(nc.label)}</span>
                            </button>
                          `;
                        }).join('')}
                      </div>
                    </div>
                  `;
                }

                const tab = child.tab || child.id;
                const isChildActive = isParentActive && (curTab ? curTab === tab : idx === 0);

                return `
                  <button
                    class="nav-subitem ${isChildActive ? 'active' : ''}"
                    data-act="nav"
                    data-id="${it.id}"
                    data-tab="${tab}"
                    type="button">
                    <span>${esc(child.label)}</span>
                    ${child.count && child.count() ? `<span class="nav-count ${child.alert ? 'alert' : ''}">${child.count()}</span>` : ''}
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      return `
        <button
          class="nav-item ${curModule === it.id ? 'active' : ''}"
          data-act="nav"
          data-id="${it.id}"
          type="button"
        >
          <i class="fa-solid ${it.icon}"></i>
          <span>${esc(it.label)}</span>
          ${n ? `<span class="nav-count ${it.alert ? 'alert' : ''}">${n}</span>` : ''}
        </button>
      `;
    }).join('')}
  `).join('');

  // Khôi phục chính xác vị trí sidebar trước khi gắn event.
  // Không focus/scrollIntoView tự động nên tab đang chọn không làm menu nhảy.
  navEl.scrollTop = previousScrollTop;

  // Submenu Toggle
  $('#nav').querySelectorAll('.nav-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parentEl = btn.closest('.nav-parent');
      const submenuId = btn.dataset.submenu;
      const nextOpen = !parentEl.classList.contains('open');
      parentEl.classList.toggle('open', nextOpen);
      State.openNavParents[submenuId] = nextOpen;
    });
  });

  // Navigation Click
  $('#nav').querySelectorAll('[data-act="nav"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const module = btn.dataset.id;
      const tab = btn.dataset.tab || null;
      // Khi chọn menu con, luôn ghi nhớ parent đang mở để render lại không làm mất dropdown.
      if (btn.closest('.nav-parent')) State.openNavParents[module] = true;

      // Nếu màn hiện tại đang mang filter tạm từ Dashboard/KPI và người dùng
      // chủ động chuyển tab, bỏ filter đó trước khi điều hướng.
      clearTransientNavigationFilter(module, tab);
      go(module, { tab });
    });
  });
}

function openSidebar()  { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }

