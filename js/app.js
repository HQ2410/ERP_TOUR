/* ---------------------------------------------------- 1. NHẬT KÝ & THÔNG BÁO */
function logActivity(action, target, extra, icon = 'fa-circle-info', tone = 'blue') {
  DB.activities.unshift({
    time: 'Vừa xong', user: DB.currentUser.name, action, target, extra, icon, tone,
  });
  DB.activities = DB.activities.slice(0, 12);
}

function pushNotification({ level = 'info', icon = 'fa-circle-info', title, desc = '', go = null }) {
  DB.notifications.unshift({ id: 'N' + Date.now(), level, icon, title, desc, time: 'Vừa xong', read: false, go });
  updateBell();
}

function updateBell() {
  const n = DB.notifications.filter((x) => !x.read).length;
  const el = $('#bellCount');
  el.textContent = n;
  el.style.display = n ? 'grid' : 'none';
}


// FEFO + FIFO dùng chung cho mọi nghiệp vụ xuất kho:
// 1) Hạn sử dụng gần nhất trước; 2) nếu cùng HSD/không HSD thì lô nhập trước trước.
// Lô đã hết hạn không được cấp cho xuất bán/sản xuất thông thường.
function inventoryRowReceiptDate(row) {
  const lot = typeof Q !== 'undefined' ? Q.lot?.(row?.lotId) : null;
  const receipt = (DB.goodsReceipts || []).find(gr => (gr.items || []).some(i =>
    (row?.lotId && i.lotId === row.lotId) ||
    (lot?.lotNumber && i.lotNumber === lot.lotNumber)
  ));
  return String(receipt?.date || receipt?.createdAt || lot?.createdAt || lot?.mfgDate || row?.lastUpdated || '9999-12-31');
}
function inventoryRowExpiryDate(row) {
  const lot = typeof Q !== 'undefined' ? Q.lot?.(row?.lotId) : null;
  return String(lot?.expiryDate || row?.expiryDate || '9999-12-31');
}
function inventoryRowIsUsableForIssue(row) {
  const lot = typeof Q !== 'undefined' ? Q.lot?.(row?.lotId) : null;
  if (lot?.qcStatus && ['FAILED','QUARANTINE','QC_PENDING'].includes(String(lot.qcStatus).toUpperCase())) return false;
  const exp = String(lot?.expiryDate || row?.expiryDate || '');
  const today = typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0,10);
  return !exp || exp >= today;
}
function sortIssueRowsFefoFifo(a, b) {
  const byExp = inventoryRowExpiryDate(a).localeCompare(inventoryRowExpiryDate(b));
  if (byExp) return byExp;
  const byReceipt = inventoryRowReceiptDate(a).localeCompare(inventoryRowReceiptDate(b));
  if (byReceipt) return byReceipt;
  return String(a?.lotId || a?.id || '').localeCompare(String(b?.lotId || b?.id || ''));
}

/* --------------------------------------------- 2. ĐỒNG BỘ TRẠNG THÁI ĐƠN HÀNG */
/** Trạng thái đơn hàng luôn suy ra từ các lệnh sản xuất của nó */
function syncOrderStatus(orderId) {
  const o = Q.order(orderId);
  if (!o || ['dh_da_giao', 'dh_hoan_tat', 'dh_da_huy'].includes(o.status)) return;
  const pos = Q.posOfOrder(orderId);
  if (!pos.length) return;
  if (pos.every((p) => ['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status))) o.status = 'dh_hoan_thanh';
  else if (pos.some((p) => ['lsx_dang_san_xuat', 'lsx_dang_qc'].includes(p.status))) o.status = 'dh_dang_san_xuat';
  else o.status = 'dh_cho_san_xuat';
}


// [SALES -> WAREHOUSE] Đơn có thể trở thành "Sẵn sàng xuất bán" sau khi
// Sản xuất hoàn tất. Trường hợp đó trước đây chỉ đổi trạng thái đơn, chưa tạo
// SALES_ISSUE nên Kho thành phẩm không có chứng từ để xác nhận xuất.
// Hàm này đối soát từ dữ liệu server đã hydrate, giữ chỗ FEFO và tạo phiếu
// chờ xác nhận đúng một lần. Server/KIO vẫn là nguồn dữ liệu chuẩn.
async function ensureReadySalesIssuesForWarehouse() {
  if (typeof SalesCRM === 'undefined') return { created:0, linked:0 };
  DB.goodsIssues = Array.isArray(DB.goodsIssues) ? DB.goodsIssues : [];
  DB.orders = Array.isArray(DB.orders) ? DB.orders : [];

  let created = 0, linked = 0, inventoryChanged = false, ordersChanged = false;
  const readyOrders = DB.orders.filter(o => o && o.status === 'dh_hoan_thanh');

  for (const o of readyOrders) {
    const existing = DB.goodsIssues.find(gi =>
      gi && gi.type === 'SALES_ISSUE' &&
      String(gi.orderId || gi.refDoc || '') === String(o.id) &&
      ['PENDING_CONFIRMATION','COMPLETED'].includes(gi.status)
    );
    if (existing) {
      if (o.pendingIssueId !== existing.id && existing.status === 'PENDING_CONFIRMATION') {
        o.pendingIssueId = existing.id;
        ordersChanged = true;
        linked++;
      }
      if (existing.status === 'COMPLETED' && o.salesIssueId !== existing.id) {
        o.salesIssueId = existing.id;
        o.pendingIssueId = '';
        if (!['dh_da_giao','dh_hoan_tat'].includes(o.status)) o.status = 'dh_cho_van_chuyen';
        ordersChanged = true;
        linked++;
      }
      continue;
    }

    const reserved = SalesCRM.reserveOrderStock(o);
    if (!reserved?.ok || !reserved.warehouseId || !(reserved.reservations || []).length) continue;

    const issueId = nextCode('PX-2026-', DB.goodsIssues);
    const issueDate = typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0,10);
    DB.goodsIssues.unshift({
      id: issueId,
      type: 'SALES_ISSUE',
      warehouseId: reserved.warehouseId,
      refDoc: o.id,
      orderId: o.id,
      date: issueDate,
      status: 'PENDING_CONFIRMATION',
      qcStatus: 'PENDING',
      qcRequestedAt: new Date().toISOString(),
      createdBy: o.approvedBy || o.createdBy || '',
      requestedBy: o.createdBy || '',
      approvedBy: o.approvedBy || '',
      note: `Chờ Kho xác nhận xuất theo đơn ${o.id}`,
      items: (reserved.reservations || []).map(r => ({ ...r }))
    });
    o.pendingIssueId = issueId;
    o.reservedWarehouseId = reserved.warehouseId;
    created++;
    inventoryChanged = true; // reserveOrderStock đã cập nhật qtyReserved/qtyAvailable
    ordersChanged = true;
  }

  if (created || linked) {
    const writes = [];
    if (created && typeof InventoryAPI !== 'undefined' && InventoryAPI.syncCollections) {
      writes.push(InventoryAPI.syncCollections(['goodsIssues','inventory']));
    }
    if (ordersChanged && typeof CRMAPI !== 'undefined' && CRMAPI.syncCollections) {
      writes.push(CRMAPI.syncCollections(['orders']));
    }
    if (writes.length) await Promise.all(writes);
  }
  return { created, linked, inventoryChanged, ordersChanged };
}

/** Xuất vật tư theo định mức BOM khi bắt đầu sản xuất */
function issueMaterials(po) {
  const check = Q.materialCheck(po);
  const lacking = check.filter((m) => !m.ok);
  if (lacking.length) return { ok: false, lacking };
  check.forEach((m) => {
    const mat = Q.material(m.materialId);
    mat.stock = Math.round((mat.stock - m.need) * 100) / 100;
    DB.stockMoves.unshift({
      id: nextCode('PX-2026-', DB.stockMoves.filter((x) => x.type === 'out')),
      type: 'out', date: DB.today, materialId: m.materialId, qty: m.need,
      ref: po.id, by: 'NV-018', note: `Xuất vật tư cho ${po.id} — ${po.productName}`,
    });
  });
  return { ok: true, count: check.length };
}

/* ------------------------------------------------------- 3. TÌM KIẾM TOÀN CỤC */
function searchIndex() {
  const idx = [];
  DB.customers.forEach((c) => idx.push({ type: 'Khách hàng', icon: 'fa-address-book', tone: 'blue', id: c.id, title: c.name, sub: `${c.id} · ${c.contact} · ${c.phone}`, right: fmtShort(Q.revenueOf(c.id)), act: 'open-customer' }));
  DB.orders.forEach((o) => idx.push({ type: 'Đơn hàng', icon: 'fa-cart-flatbed', tone: 'indigo', id: o.id, title: `${o.id} — ${Q.customerName(o.customerId)}`, sub: `${o.items.map((i) => i.name).join(', ')} · ${fmtDate(o.date)}`, right: fmtVND(o.total), act: 'open-order' }));
  DB.contracts.forEach((c) => idx.push({ type: 'Hợp đồng', icon: 'fa-file-contract', tone: 'teal', id: c.id, title: `${c.id} — ${Q.customerName(c.customerId)}`, sub: `${c.type} · hết hạn ${fmtDate(c.expireDate)}`, right: fmtVND(c.value), act: 'open-contract' }));
  DB.productionOrders.forEach((p) => idx.push({ type: 'Lệnh sản xuất', icon: 'fa-industry', tone: 'orange', id: p.id, title: `${p.id} — ${p.productName}`, sub: `${p.orderId} · ${Q.customerName(p.customerId)} · ${Q.progress(p)}%`, right: statusLabel(p.status), act: 'open-po' }));
  DB.materials.forEach((m) => idx.push({ type: 'Vật tư', icon: 'fa-layer-group', tone: 'slate', id: m.id, title: `${m.name}`, sub: `${m.id} · ${m.group} · ${m.location}`, right: `${fmtDec(m.stock, 2)} ${m.unit}`, act: 'open-material' }));
  DB.employees.forEach((e) => idx.push({ type: 'Nhân sự', icon: 'fa-user', tone: 'red', id: e.id, title: e.name, sub: `${e.id} · ${e.position} · ${e.dept}`, right: statusLabel(e.status), act: 'open-employee' }));
  DB.purchases.forEach((p) => idx.push({ type: 'Mua sắm', icon: 'fa-cart-shopping', tone: 'orange', id: p.id, title: `${p.id} — ${Q.supplierName(p.supplierId)}`, sub: `${p.items.map((i) => i.name).join(', ')}`, right: fmtVND(p.total), act: 'open-pr' }));
  return idx;
}
let SEARCH_INDEX = null;

function runGlobalSearch(term) {
  const t = term.trim().toLowerCase();
  const anchor = $('#globalSearch');
  if (t.length < 1) { Pop.close(); return; }
  if (!SEARCH_INDEX) SEARCH_INDEX = searchIndex();
  const hits = SEARCH_INDEX.filter((x) => (x.title + ' ' + x.sub + ' ' + x.id).toLowerCase().includes(t)).slice(0, 24);

  if (!hits.length) {
    Pop.open(anchor, `<div class="empty" style="padding:26px 16px">
        <div class="empty-ico"><i class="fa-solid fa-magnifying-glass"></i></div>
        <h4>Không tìm thấy "${esc(term)}"</h4>
        <p>Thử tìm theo mã chứng từ (DH-, BG-, LSX-, VT-), tên khách hàng hoặc tên sản phẩm.</p>
      </div>`, { align: 'left', width: 460 });
    return;
  }

  // Nhóm kết quả theo loại đối tượng
  const groups = {};
  hits.forEach((h) => { (groups[h.type] = groups[h.type] || []).push(h); });
  const html = Object.entries(groups).map(([type, items]) => `
      <div class="pop-label">${esc(type)} · ${items.length}</div>
      ${items.map((h) => `<div class="sr-item" data-act="${h.act}" data-id="${h.id}" data-search="1">
          <span class="sr-ico t-${h.tone}"><i class="fa-solid ${h.icon}"></i></span>
          <span style="min-width:0;flex:1 1 auto">
            <div class="sr-title">${esc(h.title)}</div>
            <div class="sr-sub">${esc(h.sub)}</div>
          </span>
          <span class="sr-right">${esc(h.right)}</span>
        </div>`).join('')}`).join('');

  Pop.open(anchor, `<div class="search-pop-inner">${html}</div>`, { align: 'left', width: 460 });
  $('#pop').classList.add('search-pop');
}

/* ------------------------------------------------------------ 4. THÔNG BÁO */
function openNotifications(anchor) {
  const html = `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px 6px">
      <b style="font-size:13.5px">Thông báo</b>
      <span class="chip">${DB.notifications.filter((n) => !n.read).length} mới</span>
      <button class="btn btn-xs" style="margin-left:auto" data-act="notif-read-all">Đánh dấu đã đọc</button>
    </div>
    <div class="pop-sep"></div>
    <div style="max-height:min(60vh,430px);overflow-y:auto">
      ${DB.notifications.map((n) => `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-act="notif-go" data-id="${n.id}">
          <span class="notif-ico t-${{ danger: 'red', warning: 'orange', info: 'blue', success: 'green' }[n.level]}"><i class="fa-solid ${n.icon}"></i></span>
          <span style="min-width:0">
            <div class="notif-title">${esc(n.title)}</div>
            <div class="notif-desc">${esc(n.desc)}</div>
            <div class="notif-time"><i class="fa-regular fa-clock"></i> ${esc(n.time)}</div>
          </span>
        </div>`).join('')}
    </div>
    <div class="pop-sep"></div>
    <button class="pop-item" data-act="notif-all" style="justify-content:center;color:var(--primary);font-weight:600">Xem tất cả thông báo</button>`;
  Pop.open(anchor, html, { align: 'right', width: 400 });
}

/* ------------------------------------------------------------ 6. DARK MODE */
function setTheme(mode) {
  document.documentElement.dataset.theme = mode;
  $('#btnTheme').innerHTML = `<i class="fa-solid fa-${mode === 'dark' ? 'sun' : 'moon'}"></i>`;
  try { localStorage.setItem('vyko-theme', mode); } catch (e) { /* chế độ riêng tư */ }
  Charts.retheme();
}
function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

/* ------------------------------------- 6b. CHUYỂN GIỮA MODAL / DRAWER */
/** Mở nội dung mới thay cho modal/drawer đang hiển thị.
 *  Nếu đang có lớp phủ mở thì chờ hiệu ứng đóng cho mượt, nếu không thì mở ngay
 *  (tránh phụ thuộc vào setTimeout khi không cần). */
function switchTo(fn, { keepDrawer = false } = {}) {
  const busy = Modal.isOpen() || (!keepDrawer && Drawer.isOpen());
  Modal.close();
  if (!keepDrawer) Drawer.close();
  if (busy) setTimeout(fn, 220); else fn();
}

/* PR dùng chung master nguyên liệu với Kho. Lần đầu mở form PR phải hydrate
 * đúng danh mục nguyên liệu/tồn từ server; sau đó dùng RAM đã hydrate và TTL
 * của InventoryAPI, không phụ thuộc việc người dùng đã từng mở Kho hay chưa. */
const PurchasePRMasterData = (() => {
  let ready = false;
  let warmPromise = null;
  const keys = ['materials', 'inventory', 'itemCategories'];

  async function loadOnce({ force = false } = {}) {
    if (ready && !force) return true;
    if (warmPromise) return warmPromise;
    warmPromise = (async () => {
      if (typeof InventoryAPI === 'undefined') return false;
      if (typeof InventoryAPI.bootstrap === 'function') await InventoryAPI.bootstrap();
      if (typeof InventoryAPI.ensureFresh === 'function') await InventoryAPI.ensureFresh(keys, { force });
      ready = true;
      return true;
    })().finally(() => { warmPromise = null; });
    return warmPromise;
  }

  function ensure() { return ready ? Promise.resolve(true) : loadOnce({ force: false }); }
  function prewarm() { return ready ? Promise.resolve(true) : loadOnce({ force: false }); }
  function markDirty() { ready = false; }
  return { ensure, prewarm, markDirty };
})();

async function openPRFormWithServerMaterials(materialId = null) {
  await PurchasePRMasterData.ensure();
  openPRForm(materialId);
}

/* ============================================================================
 * 7. BẢNG HÀNH ĐỘNG — tất cả tương tác đi qua data-act (event delegation)
 * ==========================================================================*/

/* ------------------------------------------------ 3A. THÀNH PHẨM CHỜ QC */
function finalInspectionOfPO(poId) {
  return (DB.productionFinalInspections || []).find(x => x.productionOrderId === poId) || null;
}

function ensureFinishedQcPending(po, qty) {
  if (!po) return null;
  // Chỉ Final QC (công đoạn áp chót trước Hoàn thành) mới được tạo FQC.
  // QC nằm giữa routing chỉ là checkpoint nội bộ và tuyệt đối không phát sinh tồn kho.
  const stages = po.stages || [];
  const finalQcIndex = stages.findIndex((st, idx) => typeof isFinalQcStage === 'function' ? isFinalQcStage(po, idx) : /QC — ATTP/i.test(String(st?.name || '')));
  if (finalQcIndex >= 0) {
    const previousDone = stages.slice(0, finalQcIndex).every(st => st.status === 'done');
    if (!previousDone) {
      Toast.warn('Chưa đến QC thành phẩm', 'QC giữa quy trình chỉ kiểm soát công đoạn và không được tạo phiếu QC thành phẩm / nhập kho.');
      return null;
    }
  }
  DB.productionFinalInspections = DB.productionFinalInspections || [];
  const existing = finalInspectionOfPO(po.id);
  if (existing) return existing;
  const warehouse = (DB.warehouses || []).find(w => w.type === 'FINISHED_GOODS' && w.status !== 'inactive');
  const location = (DB.warehouseLocations || []).find(l => l.warehouseId === warehouse?.id && l.status !== 'inactive');
  if (!warehouse || !location) {
    Toast.err('Thiếu cấu hình kho thành phẩm', 'Cần có Kho thành phẩm và vị trí lưu trước khi chuyển sản phẩm sang QC.');
    return null;
  }
  const safeQty = Math.max(0, Number((po.actualQty !== undefined && po.actualQty !== '' && Number(po.actualQty) > 0) ? po.actualQty : (qty || po.qty || 0)));
  const lotId = nextCode('LOT-', DB.inventoryLots || []);
  const lotNumber = `LOT-${po.id}`;
  const productMaster = Q.product(po.productId) || {};
  const mfgDate = currentDateYMD();
  const shelfLifeDays = Math.max(0, Number(productMaster.shelfLifeDays || 0));
  const lot = {
    id: lotId, lotNumber, productId: po.productId, productionOrderId: po.id,
    mfgDate, expiryDate: shelfLifeDays > 0 ? addDays(mfgDate, shelfLifeDays) : '',
    supplierLot:'', supplierId:'', qcStatus:'QC_PENDING', status:'active', createdAt:new Date().toISOString()
  };
  DB.inventoryLots.unshift(lot);
  DB.inventory.unshift({
    productId: po.productId, warehouseId: warehouse.id, locationId: location.id, lotId,
    qtyOnHand:0, qtyPending:safeQty, qtyRejected:0, qtyReserved:0, qtyAvailable:0,
    unit:po.unit, lastUpdated:new Date().toISOString()
  });
  const inspection = {
    id: nextCode('FQC-2026-', DB.productionFinalInspections), productionOrderId:po.id,
    productId:po.productId, productName:po.productName, unit:po.unit, qty:safeQty,
    warehouseId:warehouse.id, locationId:location.id, lotId, lotNumber,
    status:'PENDING', passQty:0, failQty:0, note:'', createdAt:new Date().toISOString(),
    inspectedAt:'', inspectedBy:''
  };
  DB.productionFinalInspections.unshift(inspection);
  po.finalInspectionId = inspection.id;
  po.finishedLotId = lotId;
  po.status = 'lsx_dang_qc';
  // FQC chỉ tạo phiếu QC + tồn chờ QC. Không ghi lại toàn bộ LSX lớn;
  // trạng thái công đoạn/LSX được lưu bằng bảng tiến độ compact.
  if (typeof ProductionAPI !== 'undefined') ProductionAPI.scheduleCollections?.(['productionFinalInspections']);
  if (typeof InventoryAPI !== 'undefined') InventoryAPI.scheduleCollections?.(['inventoryLots','inventory'],80);
  pushNotification({ level:'warning', icon:'fa-clipboard-check', title:`${inspection.id} chờ QC thành phẩm`, desc:`${po.productName} · ${fmtN(safeQty)} ${po.unit}`, go:{ module:'quality', tab:'fqc' } });
  return inspection;
}


// [QC INITIAL HYDRATE] QC phải dùng dữ liệu server đúng ngay lần đầu sau đăng nhập.
// Warm IQC/FQC một lần ở nền khi user đang ở Tổng quan QC; nếu user bấm vào
// trước khi warm xong thì giữ nguyên màn hiện tại và chờ cùng Promise, tuyệt đối
// không render snapshot cũ rồi vài chục ms sau mới đổi danh sách.
const QualityPrimaryData = (() => {
  let ready = false;
  let warmPromise = null;

  async function loadOnce({ force = true } = {}) {
    if (ready && !force) return true;
    if (warmPromise) return warmPromise;

    warmPromise = (async () => {
      const jobs = [];
      if (typeof PurchaseAPI !== 'undefined') {
        if (typeof PurchaseAPI.bootstrap === 'function') await PurchaseAPI.bootstrap();
        if (typeof PurchaseAPI.ensureFresh === 'function') {
          jobs.push(PurchaseAPI.ensureFresh(['goodsReceipts','purchaseOrders','suppliers'], { force }));
        }
      }
      if (typeof InventoryAPI !== 'undefined') {
        if (typeof InventoryAPI.bootstrap === 'function') await InventoryAPI.bootstrap();
        if (typeof InventoryAPI.ensureFresh === 'function') {
          jobs.push(InventoryAPI.ensureFresh(['materials'], { force }));
        }
      }
      if (typeof ProductionAPI !== 'undefined') {
        if (typeof ProductionAPI.bootstrap === 'function') await ProductionAPI.bootstrap();
        if (typeof ProductionAPI.ensureFresh === 'function') {
          jobs.push(ProductionAPI.ensureFresh(['productionOrders','productionFinalInspections'], { force }));
        }
      }

      await Promise.allSettled(jobs);
      ready = true;
      return true;
    })().finally(() => { warmPromise = null; });

    return warmPromise;
  }

  function ensure() {
    return ready ? Promise.resolve(true) : loadOnce({ force: true });
  }
  function prewarm() {
    if (ready) return Promise.resolve(true);
    return loadOnce({ force: true });
  }
  function markReady() { ready = true; }
  function isReady() { return ready; }

  return { ensure, prewarm, markReady, isReady };
})();

// [WAREHOUSE INVENTORY INITIAL HYDRATE] Không render snapshot Tồn kho cũ rồi
// vài chục ms sau mới thay bằng server. Lần đầu trong phiên hydrate đúng các
// collection cần cho màn Tồn kho; các lần sau dùng RAM đã server-validated.

// [ACCOUNTING INITIAL HYDRATE] Kế toán cần Ngân hàng/NCC/KH đúng ngay lần đầu.
// Warm đúng các master dùng xuyên suốt một lần; sau đó chuyển menu dùng RAM đã
// server-validated, không cần F5 và không gọi list.php lặp cho mỗi lần chuyển tab.
const AccountingPrimaryData = (() => {
  // Kế toán đọc TRỰC TIẾP đúng bảng KIO cần cho tab hiện tại.
  // Không gọi bootstrap của Purchase/Inventory/CRM/Restaurant ở đây vì bootstrap
  // của một số phân hệ có tác vụ khởi tạo/migration riêng và làm login Kế toán
  // phát sinh hàng chục list.php/krud.php không liên quan.
  const readyTabs = new Set();
  const inflight = new Map();

  const MAP = {
    suppliers: ['suppliers', () => KIO_CONFIG.purchaseTables.suppliers],
    purchaseOrders: ['purchaseOrders', () => KIO_CONFIG.purchaseTables.purchaseOrders],
    supplierPayments: ['supplierPayments', () => KIO_CONFIG.purchaseTables.supplierPayments],
    supplierRefunds: ['supplierRefunds', () => KIO_CONFIG.purchaseTables.supplierRefunds],
    customers: ['customers', () => KIO_CONFIG.crmTables.customers],
    orders: ['orders', () => KIO_CONFIG.crmTables.orders],
    customerPayments: ['customerPayments', () => KIO_CONFIG.crmTables.customerPayments],
    inventory: ['inventory', () => KIO_CONFIG.inventoryTables.inventory],
    materials: ['materials', () => KIO_CONFIG.inventoryTables.materials],
    products: ['products', () => KIO_CONFIG.inventoryTables.products],
    goodsIssues: ['goodsIssues', () => KIO_CONFIG.inventoryTables.goodsIssues],
    materialReturnHistory: ['materialReturnHistory', () => KIO_CONFIG.inventoryTables.materialReturnHistory],
    stores: ['stores', () => KIO_CONFIG.restaurantTables.stores],
    bankAccounts: ['bankAccounts', () => KIO_CONFIG.restaurantTables.bankAccounts],
    cashTransactions: ['cashTransactions', () => KIO_CONFIG.restaurantTables.cashTransactions],
    fixedAssets: ['fixedAssets', () => KIO_CONFIG.restaurantTables.fixedAssets],
  };

  const KEYS_BY_TAB = {
    // accDashboardView: doanh thu/COGS/AR/AP/ngân hàng/tài sản/tồn kho + thu chi gần đây.
    dashboard: ['suppliers','purchaseOrders','supplierPayments','supplierRefunds','customers','orders','customerPayments','inventory','materials','products','bankAccounts','cashTransactions','fixedAssets'],
    ar: ['customers','orders','customerPayments','bankAccounts'],
    ap: ['suppliers','purchaseOrders','supplierPayments','supplierRefunds','goodsIssues','materialReturnHistory','bankAccounts'],
    banking: ['stores','bankAccounts'],
    cashflow_inout: ['suppliers','supplierPayments','supplierRefunds','customers','customerPayments','bankAccounts','cashTransactions'],
  };

  async function loadKey(key, {force=false}={}) {
    const entry = MAP[key];
    if (!entry) return false;
    const [dbKey, tableFn] = entry;
    const table = tableFn();
    if (!table) return false;
    const rows = await KioStore.listCollection(table, {force});
    DB[dbKey] = Array.isArray(rows) ? rows : [];
    return true;
  }

  async function ensureForTab(tab='dashboard', {force=false}={}) {
    tab = tab || 'dashboard';
    if (readyTabs.has(tab) && !force) return true;
    if (inflight.has(tab)) return inflight.get(tab);
    const task = (async()=>{
      const keys = KEYS_BY_TAB[tab] || KEYS_BY_TAB.dashboard;
      // Các bảng độc lập: đọc song song. KioStore vẫn là nguồn server thật.
      await Promise.all(keys.map(k => loadKey(k,{force}).catch(err=>{
        console.warn(`[Accounting] Không tải được ${k} từ KIO:`,err); return false;
      })));
      if (typeof AccountingBank !== 'undefined') AccountingBank.hydrate();
      readyTabs.add(tab);
      return true;
    })().finally(()=>inflight.delete(tab));
    inflight.set(tab,task);
    return task;
  }

  function ensure(tab=State.tab||'dashboard'){ return ensureForTab(tab,{force:false}); }
  function prewarm(tab=State.tab||'dashboard'){ return ensureForTab(tab,{force:false}); }
  function refresh(tab=State.tab||'dashboard',{force=false}={}){ return ensureForTab(tab,{force}); }
  function markReady(tab=State.tab||'dashboard'){ readyTabs.add(tab||'dashboard'); }
  function isReady(tab=State.tab||'dashboard'){ return readyTabs.has(tab||'dashboard'); }
  return {ensure,ensureForTab,prewarm,refresh,markReady,isReady};
})();

// [WAREHOUSE PRODUCTION PLAN INITIAL HYDRATE] Kế hoạch sản xuất của Kho
// phải đọc trực tiếp từ lenam_production_plans sau login/F5. Không phụ thuộc
// việc user đã từng mở phân hệ Sản xuất hay DataWarmup chạy xong hay chưa.
const WarehouseProductionPlanPrimaryData = (() => {
  let ready = false;
  let warmPromise = null;

  async function loadOnce({ force = true } = {}) {
    if (ready && !force) return true;
    if (warmPromise) return warmPromise;
    warmPromise = (async () => {
      const jobs = [];
      if (typeof ProductionAPI !== 'undefined') {
        await ProductionAPI.bootstrap?.();
        jobs.push(ProductionAPI.ensureFresh?.(['productionPlans','productionOrders','productionMaterialRequests'], { force }));
      }
      if (typeof CRMAPI !== 'undefined') {
        await CRMAPI.bootstrap?.();
        jobs.push(CRMAPI.ensureFresh?.(['orders','customers'], { force }));
      }
      if (typeof InventoryAPI !== 'undefined') {
        await InventoryAPI.bootstrap?.();
        jobs.push(InventoryAPI.ensureFresh?.(['products','inventory'], { force }));
      }
      await Promise.allSettled(jobs.filter(Boolean));
      ready = true;
      return true;
    })().finally(() => { warmPromise = null; });
    return warmPromise;
  }

  function ensure() { return ready ? Promise.resolve(true) : loadOnce({ force:true }); }
  function prewarm() { return ready ? Promise.resolve(true) : loadOnce({ force:true }); }
  function markReady() { ready = true; }
  function isReady() { return ready; }
  return { ensure, prewarm, markReady, isReady };
})();

const WarehouseInventoryPrimaryData = (() => {
  let ready = false;
  let warmPromise = null;
  // [CROSS-DEVICE CONSISTENCY] Tồn kho không thể chỉ tải balance. View còn cần
  // master kho + master hàng để xác định loại RAW/BTP/TP và dựng từng dòng.
  // Máy đã có cache trước đây vẫn nhìn thấy dữ liệu nên che mất lỗi này, trong khi
  // điện thoại/máy mới có DB.warehouses/products/materials = [] và bảng bị trống.
  // Lần đầu vào Tồn kho trong mỗi phiên phải hydrate đủ bộ dữ liệu hiển thị từ KIO.
  const keys = [
    'inventory', 'inventoryLots',
    'warehouses', 'warehouseLocations',
    'materials', 'semiFinishedProducts', 'products', 'itemCategories'
  ];

  async function loadOnce({ force = true } = {}) {
    if (ready && !force) return true;
    if (warmPromise) return warmPromise;
    warmPromise = (async () => {
      if (typeof InventoryAPI === 'undefined') return false;
      if (typeof InventoryAPI.bootstrap === 'function') await InventoryAPI.bootstrap();
      if (typeof InventoryAPI.ensureFresh === 'function') await InventoryAPI.ensureFresh(keys, { force });
      ready = true;
      return true;
    })().finally(() => { warmPromise = null; });
    return warmPromise;
  }

  function ensure() { return ready ? Promise.resolve(true) : loadOnce({ force:true }); }
  function refresh({ force = true } = {}) { return loadOnce({ force }); }
  function prewarm() { return ready ? Promise.resolve(true) : loadOnce({ force:true }); }
  function markReady() { ready = true; }
  function isReady() { return ready; }
  return { ensure, refresh, prewarm, markReady, isReady };
})();

// [LOGISTICS INITIAL HYDRATE] Logistics phải thấy đơn CRM sẵn sàng xuất ngay
// lần đầu, không phụ thuộc việc user đã mở CRM/Kho trước đó. Hydrate đúng dữ liệu
// liên phân hệ một lần; các lần chuyển tab sau dùng RAM đã server-validated.


// [SUBCONTRACT INVENTORY FIRST-LOAD] Role Gia công chỉ xem Tồn kho nhưng lần đầu
// phải lấy snapshot server hoàn chỉnh trước khi render để không flash cache cũ.
// Sau lần hydrate đầu tiên, dùng RAM đã xác thực trong phiên.
const SubcontractInventoryPrimaryData = (() => {
  let ready = false;
  let warmPromise = null;

  async function loadOnce() {
    if (ready) return true;
    if (warmPromise) return warmPromise;
    warmPromise = (async () => {
      if (typeof InventoryAPI === 'undefined') return false;
      await InventoryAPI.bootstrap?.();
      // refreshFromServer đọc snapshot Kho đầy đủ và apply xong mới resolve,
      // tránh trạng thái danh sách vật tư/tồn bị thay đổi sau khi view đã render.
      if (typeof InventoryAPI.refreshFromServer === 'function') {
        await InventoryAPI.refreshFromServer();
      } else if (typeof InventoryAPI.ensureFresh === 'function') {
        await InventoryAPI.ensureFresh(
          ['inventory','inventoryLots','warehouses','warehouseLocations','materials','semiFinishedProducts','products','itemCategories'],
          { force:true }
        );
      }
      ready = true;
      return true;
    })().finally(() => { warmPromise = null; });
    return warmPromise;
  }

  function ensure() { return ready ? Promise.resolve(true) : loadOnce(); }
  function prewarm() { return ready ? Promise.resolve(true) : loadOnce(); }
  function markReady() { ready = true; }
  function isReady() { return ready; }
  return { ensure, prewarm, markReady, isReady };
})();

const LogisticsPrimaryData = (() => {
  let ready = false;
  let warmPromise = null;

  async function loadOnce({ force = true } = {}) {
    if (ready && !force) return true;
    if (warmPromise) return warmPromise;
    warmPromise = (async () => {
      const jobs = [];
      if (typeof CRMAPI !== 'undefined') {
        await CRMAPI.bootstrap?.();
        jobs.push(CRMAPI.ensureFresh?.(['orders','customers'], { force }));
      }
      if (typeof InventoryAPI !== 'undefined') {
        await InventoryAPI.bootstrap?.();
        jobs.push(InventoryAPI.ensureFresh?.(['goodsIssues','products'], { force }));
      }
      if (typeof LogisticsFleet !== 'undefined' && typeof LogisticsFleet.ensureFresh === 'function') {
        jobs.push(LogisticsFleet.ensureFresh({ force }));
      }
      await Promise.allSettled(jobs.filter(Boolean));
      if (typeof LogisticsFleet !== 'undefined' && LogisticsFleet.reconcileSalesOrders) LogisticsFleet.reconcileSalesOrders();
      ready = true;
      return true;
    })().finally(() => { warmPromise = null; });
    return warmPromise;
  }

  function ensure() { return ready ? Promise.resolve(true) : loadOnce({ force:true }); }
  function prewarm() { return ready ? Promise.resolve(true) : loadOnce({ force:true }); }
  function markReady() { ready = true; }
  function isReady() { return ready; }
  return { ensure, prewarm, markReady, isReady };
})();

const Actions = {
  /* --- Điều hướng chung --- */
  nav: async (d) => {
    clearTransientNavigationFilter(d.id, d.tab || null);

    // QC: lần đầu trong phiên phải hydrate dữ liệu thật trước khi đổi màn.
    // Sau đó IQC/FQC dùng cache RAM đã server-validated nên chuyển tab hiện ngay,
    // không flash dữ liệu cũ và cũng không gọi list.php lặp mỗi lần.
    if (d.id === 'quality' && (d.tab === 'iqc' || d.tab === 'fqc')) {
      try { await QualityPrimaryData.ensure(); }
      catch (err) { console.warn('[QC] Không warm được dữ liệu ban đầu:', err); }
    }

    // Kho → Kế hoạch sản xuất: đọc productionPlans thật từ server trước khi đổi màn.
    // Nhờ vậy kế hoạch đã tạo/duyệt vẫn còn sau logout/login và không cần mở Sản xuất trước.
    if (d.id === 'warehouse' && d.tab === 'production_plan') {
      try { await WarehouseProductionPlanPrimaryData.ensure(); }
      catch (err) { console.warn('[Warehouse] Không hydrate được Kế hoạch sản xuất:', err); }
    }

    // Kho → Tồn kho: lần đầu sau đăng nhập phải hydrate server xong mới đổi màn,
    // tránh flash vài dòng cache cũ rồi mới nhảy sang tồn thật. Sau lần đầu,
    // chuyển màn dùng RAM đã hydrate và không gọi list.php lại nếu TTL còn fresh.
    if (d.id === 'warehouse' && d.tab === 'inventory') {
      try {
        const isSubcontractRole = DB.currentUser?.roleId === 'ROLE_SUBCONTRACT';
        if (isSubcontractRole) await SubcontractInventoryPrimaryData.ensure();
        else await WarehouseInventoryPrimaryData.refresh({ force:true });
      }
      catch (err) { console.warn('[Warehouse] Không warm được Tồn kho ban đầu:', err); }
    }

    // Kế toán dùng chung dữ liệu AP/AR/Ngân hàng/Thu-Chi. Lần đầu vào bất kỳ
    // màn Kế toán nào phải hydrate đủ dữ liệu server trước, không được phụ thuộc
    // việc user đã mở Công nợ phải thu/phải chi trước đó.
    if (d.id === 'accounting') {
      try { await AccountingPrimaryData.ensureForTab(d.tab || 'dashboard'); }
      catch (err) { console.warn('[Accounting] Không hydrate đủ dữ liệu tài chính ban đầu:', err); }
    }

    // Mua hàng: warm master nguyên liệu ở nền để khi bấm Tạo đề nghị mua
    // form mở với danh sách đầy đủ ngay, không cần qua Kho trước.
    if (d.id === 'purchases') {
      PurchasePRMasterData.prewarm().catch(err => console.warn('[Purchase] Không warm được master nguyên liệu PR:', err));
    }

    // Gia công: warm danh mục thành phẩm thật từ server để form Tạo kế hoạch
    // luôn có đầy đủ sản phẩm, không phụ thuộc đã mở Kho/Thành phẩm trước đó.
    if (d.id === 'subcontracting') {
      (async () => {
        try {
          if (typeof InventoryAPI !== 'undefined') {
            await InventoryAPI.bootstrap?.();
            await InventoryAPI.ensureFresh?.(['products'], { force:false });
          }
        } catch (err) { console.warn('[Subcontracting] Không warm được danh mục thành phẩm:', err); }
      })();
    }

    // Logistics: đơn bán Sẵn sàng xuất phải có ngay lần đầu. Chờ hydrate
    // CRM + phiếu xuất Kho + dữ liệu Logistics trước khi đổi màn để không render
    // danh sách rỗng/cũ rồi vài chục ms sau mới nhảy dữ liệu.
    if (d.id === 'logistics') {
      try { await LogisticsPrimaryData.ensure(); }
      catch (err) { console.warn('[Logistics] Không hydrate đủ dữ liệu giao hàng ban đầu:', err); }
    }

    // Kho → Nhập kho là màn giao nhau Purchase + Inventory. Nạp server trước khi
    // điều hướng để không flash dữ liệu cache cũ rồi mới đổi sau ~100ms.
    if (d.id === 'warehouse' && d.tab === 'receipts') {
      try {
        const jobs = [];
        if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.ensureFresh) jobs.push(PurchaseAPI.ensureFresh(['purchaseOrders','goodsReceipts','suppliers'], {force:false}));
        if (typeof InventoryAPI !== 'undefined' && InventoryAPI.ensureFresh) jobs.push(InventoryAPI.ensureFresh(['warehouses','warehouseLocations','materials','products','semiFinishedProducts'], {force:true}));
        await Promise.all(jobs);
      } catch (err) {
        console.warn('[Warehouse] Không tải đủ dữ liệu Nhập kho trước điều hướng:', err);
      }
    }
    go(d.id, d.tab ? { tab: d.tab } : d.filter ? { filter: d.filter } : {});
  },
  go: (d) => go(d.id, d.filter ? { filter: d.filter } : {}),
  page: (d) => { State.page[d.key] = Number(d.p); render(); },
  'clear-filter': (d) => { State.filters[d.key] = {}; State.page[d.key] = 1; State.params.filter = null; render(); },
  'create-pr': async () => { State.prFormDraft = null; await openPRFormWithServerMaterials(null); },
  'modal-close': () => Modal.close(),
  'drawer-close': () => Drawer.close(),

  /* --- Kho --- */

  /* --- Khách hàng --- */
  // Drawer tự thay nội dung nên không cần đóng trước khi mở hồ sơ khác
  'open-customer': (d) => { State.customerTab = 'overview'; switchTo(() => openCustomerDrawer(d.id), { keepDrawer: true }); },
  'customer-care': (d) => { openCustomerCareModal(d.customerId);},
  'save-customer-care': (d) => { saveCustomerCare(d.customerId);},
  'cust-tab': (d) => { State.customerTab = d.tab; const c = Q.customer(d.id); Drawer.setBody(customerDrawerBody(c)); drawCustomerChart(c); },
  'edit-customer': (d) => switchTo(() => openCustomerForm(d.id)),
  'save-customer': async (d) => {
    const form = $('#custForm');
    const data = validateCustomerForm(form);
    if (!data) { Toast.err('Dữ liệu chưa hợp lệ', 'Vui lòng kiểm tra lại các trường được đánh dấu đỏ.'); return; }

    const previous = d.id ? JSON.parse(JSON.stringify(Q.customer(d.id) || {})) : null;
    let id = d.id || '';
    let created = false;

    if (d.id) {
      const current = Q.customer(d.id);
      if (!current) { Toast.err('Không tìm thấy khách hàng', d.id); return; }
      Object.assign(current, data);
    } else {
      id = nextCode('KH-', DB.customers, 3);
      DB.customers.push({ ...data, id, since: DB.today, note: '' });
      created = true;
      logActivity('thêm khách hàng mới', id, data.name, 'fa-address-book', 'blue');
    }

    SEARCH_INDEX = null;

    try {
      // Ghi KIO và CHỜ server xác nhận trước khi báo thành công/đóng form.
      // Không schedule toàn CRM vì thao tác này chỉ thay đổi customers.
      if (typeof CRMAPI !== 'undefined' && CRMAPI.syncCollections) {
        await CRMAPI.syncCollections(['customers']);
        await CRMAPI.refreshKeys?.(['customers'], { force: true });
      } else if (typeof SalesCRM !== 'undefined') {
        SalesCRM.saveLocal(['customers']);
      }

      Modal.close();
      // Route đúng là CRM/customers. go('customers') là module không tồn tại trong
      // role.modules nên trước đây vừa báo thành công vừa phát sinh toast Không có quyền.
      go('crm', { tab: 'customers' });
      Toast.ok(created ? 'Đã thêm khách hàng mới' : 'Đã cập nhật khách hàng', `${id} · ${data.name}`);
    } catch (err) {
      // Rollback UI nếu server không xác nhận để không tạo trạng thái giả thành công.
      if (created) DB.customers = (DB.customers || []).filter(c => c.id !== id);
      else {
        const current = Q.customer(id);
        if (current && previous) Object.assign(current, previous);
      }
      SEARCH_INDEX = null;
      render();
      Toast.err('Không lưu được khách hàng', err?.message || 'Server chưa xác nhận dữ liệu.');
    }
  },
  'delete-customer': (d) => {
    const customer = Q.customer(d.id);
    if (!customer) return;
    const orders = (DB.orders || []).filter(o => o.customerId === d.id);
    if (orders.length) {
      Toast.err('Không thể xóa khách hàng', `${customer.name} đã có ${orders.length} đơn hàng.`);
      return;
    }
    confirmBox({
      title: 'Xóa khách hàng',
      tone: 'danger',
      icon: 'fa-trash',
      okText: 'Xóa khách hàng',
      message: `Xóa khách hàng <b>${esc(customer.id)} · ${esc(customer.name)}</b>?<br><br>Chỉ khách hàng chưa có đơn hàng mới được phép xóa.`,
      onOk: () => {
        DB.customers = (DB.customers || []).filter(c => c.id !== d.id);
        SEARCH_INDEX = null;

        // Xóa đúng record ở bảng lenam_customers. KioStore.syncCollection không
        // tự xóa record server chỉ vì frontend không còn record đó.
        if (typeof CRMAPI !== 'undefined') {
          CRMAPI.deleteKeys('customers', [d.id]).catch(err => {
            console.error('[CRMAPI] Xóa khách hàng trên server thất bại:', err);
            Toast.err('Chưa xóa được trên server', err.message);
          });
        }
        if (typeof SalesCRM !== 'undefined') SalesCRM.saveLocal(['customers']);
        Drawer.close();
        render();
        Toast.ok('Đã xóa khách hàng', `${customer.id} · ${customer.name}`);
      }
    });
  },
  'new-quote-for': (d) => switchTo(() => openQuoteForm(d.id)),
  // CRM mới: tạo đơn hàng thành phẩm trực tiếp từ hồ sơ khách hàng, không qua báo giá legacy.
  // Trước khi mở form phải bảo đảm dữ liệu Kho thành phẩm đã được nạp; nếu không
  // user vừa đăng nhập rồi tạo đơn ngay sẽ thấy danh sách thành phẩm rỗng/sai.
  'new-order-for': async (d, el) => {
    const ok = await prepareSalesOrderFormData(el);
    if (ok) switchTo(() => openOrderForm(d.id, ''));
  },

  /* --- CRM – Bán hàng --- */
  'crm-go-customers': () => go('crm', { tab: 'customers' }),
  'crm-go-opportunities': () => go('crm', { tab: 'customers' }),
  'crm-go-transactions': () => go('crm', { tab: 'transactions' }),
  'crm-go-orders': () => go('crm', { tab: 'orders' }),
  'crm-go-debts': () => go('crm', { tab: 'debts' }),
  'crm-customer-pay-modal': async (d) => { if(typeof accountingEntriesEnsureFresh==='function') await accountingEntriesEnsureFresh(false); openCustomerPaymentModal(d.id); },
  'crm-customer-pay-save': async (d, el) => {
    DB.customerPayments = DB.customerPayments || [];
    const o = Q.order(d.orderid); if (!o) return;
    const amount = parseMoney($('#crmPayAmount')?.value || 0);
    const pendingAmt = SalesCRM.pendingOfOrder ? SalesCRM.pendingOfOrder(o.id) : 0;
    const remain = Math.max(0, SalesCRM.receivableOfOrder(o) - pendingAmt);
    const method = $('#crmPayMethod')?.value || 'BANK_TRANSFER';
    const payerId = $('#crmPayPayer')?.value || '';
    const payer = (DB.employees || []).find(e => String(e.id) === String(payerId));
    const payerName = payer?.name || payer?.fullName || ((String(payerId)===String(DB.currentUser?.userId||DB.currentUser?.id)) ? ((String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||'')) : Q.employeeName(payerId));
    const accountingEntryId = $('#crmPayAccountingEntry')?.value || '';
    const bankId = method === 'BANK_TRANSFER' ? ($('#crmPayBank')?.value || '') : '';
    const bank = (DB.bankAccounts || []).find(b => String(b.id) === String(bankId));
    const date = $('#crmPayDate')?.value || (typeof currentDateYMD==='function'?currentDateYMD():new Date().toISOString().slice(0,10));
    if (amount <= 0) { Toast.err('Số tiền không hợp lệ','Vui lòng nhập số tiền lớn hơn 0.'); return; }
    if (amount > remain) { Toast.err('Vượt quá công nợ',`Số tiền thu ${fmtVND(amount)} lớn hơn số còn phải thu ${fmtVND(remain)}${pendingAmt > 0 ? ` (đã trừ ${fmtVND(pendingAmt)} đang chờ kế toán xác nhận)` : ''}.`); return; }
    if (!accountingEntryId) { Toast.err('Chưa chọn định khoản','Thu tiền khách hàng bắt buộc phải chọn định khoản.'); return; }
    if (!payerId) { Toast.err('Chưa chọn người thực hiện','Vui lòng chọn người ghi nhận/thu khoản thanh toán này.'); return; }
    if (method === 'BANK_TRANSFER' && !bankId) { Toast.err('Chưa chọn ngân hàng','Vui lòng chọn tài khoản ngân hàng nhận tiền.'); return; }

    // Người ngoài bộ phận kế toán chỉ ghi nhận; kế toán phải xác nhận ĐÃ NHẬN TIỀN thì khoản thu mới tính vào đã thu và ghi sổ ngân hàng.
    const autoConfirm = (typeof Auth === 'undefined') || Auth.hasPermission('ACCOUNTING_OPERATE');
    const id = SalesCRM.nextNumericCode('TT-KH-2026-', DB.customerPayments, 4);
    const payment = {
      id, orderId:o.id, customerId:o.customerId, date, amount,
      method: method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt',
      bankId, bankName: bank?.name || bank?.bankName || '', bankAccount: bank?.accountNumber || '',
      payerId, payerName, accountingEntryId,
      reference: $('#crmPayRef')?.value.trim() || '', note: $('#crmPayNote')?.value.trim() || '',
      createdBy: DB.currentUser?.id || '', createdByName: DB.currentUser?.name || '', createdAt: new Date().toISOString(),
      confirmStatus: autoConfirm ? 'CONFIRMED' : 'PENDING',
      ...(autoConfirm ? { confirmedAt: new Date().toISOString(), confirmedBy: DB.currentUser?.id || '', confirmedByName: DB.currentUser?.name || '', receivedDate: date } : {})
    };

    // Lưu snapshot để rollback nếu KIO không ghi được. Không được để UI hiện
    // "Thanh toán một phần" khi persistence thật thất bại.
    const oldPaid = o.paid;
    const oldReceivable = o.receivable;
    DB.customerPayments.unshift(payment);
    o.paid = SalesCRM.paidOfOrder(o.id);
    o.receivable = SalesCRM.receivableOfOrder(o);

    // Chuyển khoản khách hàng là tiền VÀO đúng tài khoản ngân hàng đã chọn.
    // Giao dịch được persist cùng bankAccounts trên KIO, không chỉ giữ trong RAM.

    if (el) el.disabled = true;
    try {
      if (typeof CRMAPI !== 'undefined') {
        await CRMAPI.syncCollections(['customerPayments','orders']);
      }
      if (autoConfirm && bankId && typeof AccountingBank !== 'undefined') {
        await AccountingBank.record({ bankId, type:'IN', date, amount, note:`Thu công nợ ${o.id} · ${Q.customerName(o.customerId)}`, sourceType:'CUSTOMER_PAYMENT', sourceId:id, createdBy:payment.createdBy, accountingEntryId });
      }
      // KIO đã thành công: chỉ cập nhật cache local, không schedule ghi lần 2.
      SalesCRM.saveLocal(['customerPayments','orders'], { sync:false });
      Modal.close();
      if(State.module==='accounting') go('accounting',{tab:'ar'}); else go('crm',{tab:'debts'});
      if (autoConfirm) Toast.ok('Đã ghi nhận thu tiền',`${id} · ${fmtVND(amount)} · Còn lại ${fmtVND(SalesCRM.receivableOfOrder(o))}`);
      else { Toast.ok('Đã gửi kế toán xác nhận',`${id} · ${fmtVND(amount)} · chưa tính vào đã thu cho đến khi kế toán xác nhận đã nhận tiền`); if (typeof pushNotification === 'function') pushNotification({ level:'warning', icon:'fa-hand-holding-dollar', title:`Chờ xác nhận đã nhận tiền · ${Q.customerName(o.customerId)}`, desc:`${id} · đơn ${o.id} · ${fmtVND(amount)}`, go:{ module:'accounting', tab:'ar' } }); }
    } catch (err) {
      // Rollback state/cache giao diện nếu server không lưu được.
      DB.customerPayments = (DB.customerPayments || []).filter(p => p !== payment && p.id !== id);
      if (oldPaid === undefined) delete o.paid; else o.paid = oldPaid;
      if (oldReceivable === undefined) delete o.receivable; else o.receivable = oldReceivable;
      SalesCRM.saveLocal(['customerPayments','orders'], { sync:false });
      console.error('[CRM] Ghi nhận thu tiền thất bại, đã rollback local state:', err);
      Toast.err('Chưa ghi nhận được thu tiền', err?.message || 'Không thể lưu dữ liệu lên KIO.');
    } finally {
      if (el) el.disabled = false;
    }
  },
  'crm-customer-orders': (d) => {
    const f = F('orders', { q:'',status:'',statusGroup:'',owner:'',customerId:'',from:'',to:'' });
    f.q = ''; f.status = 'dh_da_giao'; f.statusGroup = ''; f.owner = ''; f.customerId = d.id || ''; f.from = ''; f.to = '';
    State.page.orders = 1;
    go('crm', { tab: 'orders' });
  },
  'crm-go-orders-delivered': () => { F('orders', { q:'',status:'',owner:'',from:'',to:'' }).status='dh_da_giao'; go('crm',{tab:'orders'}); },

  'crm-order-filter-all': () => { const f=F('orders'); f.status=''; f.statusGroup=''; State.page.orders=1; render(); },
  'crm-order-filter-new': () => { const f=F('orders'); f.status='dh_cho_xu_ly'; f.statusGroup=''; State.page.orders=1; render(); },
  'crm-order-filter-production': () => { const f=F('orders'); f.status=''; f.statusGroup='production'; State.page.orders=1; render(); },
  'crm-order-filter-ready': () => { const f=F('orders'); f.status='dh_hoan_thanh'; f.statusGroup=''; State.page.orders=1; render(); },
  'crm-order-filter-delivered': () => { const f=F('orders'); f.status='dh_da_giao'; f.statusGroup=''; State.page.orders=1; render(); },

  'crm-order-add-line': () => {
    const wrap=$('#crmOrderLines'); if(!wrap)return;
    const options=decodeURIComponent(wrap.dataset.options||'');
    wrap.insertAdjacentHTML('beforeend', crmOrderLineHTML(options,false));
    if (typeof bindCrmOrderWeightEvents === 'function') bindCrmOrderWeightEvents(wrap);
    if (typeof updateCrmOrderTotals === 'function') updateCrmOrderTotals(document);
    const rows=wrap.querySelectorAll('.crm-order-line');
    if(rows.length>1) rows[0].querySelector('[data-act="crm-order-remove-line"]')?.removeAttribute('disabled');
  },
  'crm-order-remove-line': (d,el) => {
    const wrap=$('#crmOrderLines'); const row=el?.closest('.crm-order-line'); if(!wrap||!row)return;
    if(wrap.querySelectorAll('.crm-order-line').length<=1)return;
    row.remove();
    if (typeof updateCrmOrderTotals === 'function') updateCrmOrderTotals(document);
    const remain=wrap.querySelectorAll('.crm-order-line');
    if(remain.length===1) remain[0].querySelector('[data-act="crm-order-remove-line"]')?.setAttribute('disabled','');
  },
  'crm-order-add-cost': () => {
    const wrap=$('#crmOtherCosts'); if(!wrap||typeof crmOtherCostLineHTML!=='function')return;
    wrap.insertAdjacentHTML('beforeend', crmOtherCostLineHTML({},false));
    if(typeof bindCrmOtherCostEvents==='function') bindCrmOtherCostEvents(wrap);
    const rows=wrap.querySelectorAll('.crm-other-cost-line');
    if(rows.length>1) rows[0].querySelector('[data-act="crm-order-remove-cost"]')?.removeAttribute('disabled');
    if(typeof updateCrmOrderTotals==='function') updateCrmOrderTotals(document);
  },
  'crm-order-remove-cost': (d,el) => {
    const wrap=$('#crmOtherCosts'); const row=el?.closest('.crm-other-cost-line'); if(!wrap||!row)return;
    if(wrap.querySelectorAll('.crm-other-cost-line').length<=1){
      row.querySelector('input[name="otherCostName"]')?.setAttribute('value','');
      const n=row.querySelector('input[name="otherCostName"]'); if(n)n.value='';
      const a=row.querySelector('input[name="otherCostAmount"]'); if(a)a.value='';
    } else row.remove();
    const remain=wrap.querySelectorAll('.crm-other-cost-line');
    if(remain.length===1) remain[0].querySelector('[data-act="crm-order-remove-cost"]')?.setAttribute('disabled','');
    if(typeof updateCrmOrderTotals==='function') updateCrmOrderTotals(document);
  },
  'crm-order-save': () => {
    const customerId=$('#crmOrderCustomer')?.value||'';
    const actualToday=typeof currentDateYMD==='function'?currentDateYMD():new Date().toISOString().slice(0,10);
    const orderedLocal=$('#crmOrderDate')?.value||'';
    const date=orderedLocal.slice(0,10);
    const dueDate=$('#crmOrderDue')?.value||'';
    const paymentDueDate=$('#crmPaymentDue')?.value||dueDate;
    const ownerId=$('#crmOrderOwnerLocked')?.value||$('#crmOrderOwner')?.value||DB.currentUser?.id||'';
    if(!customerId){Toast.err('Chưa chọn khách hàng','Vui lòng chọn khách hàng mua thành phẩm.');return;}
    const deliveryParts=typeof crmReadDeliveryAddressForm==='function'?crmReadDeliveryAddressForm():{address:$('#crmDeliveryAddressDetail')?.value.trim()||'',province:'',district:'',ward:'',addressDetail:$('#crmDeliveryAddressDetail')?.value.trim()||''};
    const deliveryAddress=deliveryParts.address;
    const deliveryProvince=deliveryParts.province||'';
    const deliveryDistrict=deliveryParts.district||'';
    const deliveryWard=deliveryParts.ward||'';
    const deliveryAddressDetail=deliveryParts.addressDetail||'';
    const deliveryRecipient=$('#crmDeliveryRecipient')?.value.trim()||'';
    const deliveryPhone=$('#crmDeliveryPhone')?.value.trim()||'';
    const deliveryNote=$('#crmDeliveryNote')?.value.trim()||'';
    const deliveryLat=Number($('#crmDeliveryLat')?.value||0)||null;
    const deliveryLng=Number($('#crmDeliveryLng')?.value||0)||null;
    const shippingFee=Math.max(0,parseMoney($('#crmShippingFee')?.value)||0);
    if(!deliveryAddress){Toast.err('Thiếu địa chỉ giao hàng','Vui lòng nhập địa chỉ nhận hàng của đơn bán.');return;}
    if(!date||!dueDate){Toast.err('Thiếu ngày','Vui lòng nhập ngày đặt và ngày giao dự kiến.');return;}
    if(date<actualToday){Toast.err('Ngày đặt không hợp lệ',`Ngày đặt hàng phải từ ${fmtDate(actualToday)} trở về sau.`);return;}
    if(dueDate<date){Toast.err('Ngày giao không hợp lệ','Ngày giao dự kiến không được trước ngày đặt.');return;}
    if(paymentDueDate<date){Toast.err('Hạn thanh toán không hợp lệ','Hạn thanh toán không được trước ngày đặt hàng.');return;}
    const rows=$$('#crmOrderLines .crm-order-line').map((row,index)=>{
      const productId=row.querySelector('select[name="product"]')?.value||'';
      const qty=Number(row.querySelector('input[name="qty"]')?.value)||0;
      const p=Q.product(productId);
      const price=parseMoney(row.querySelector('input[name="price"]')?.value)||Number(p?.price||0);
      const vatRate=Math.max(0,Number(row.querySelector('select[name="vatRate"]')?.value ?? 0)||0);
      const packedWeightKg=typeof crmPackedWeightKg==='function'?crmPackedWeightKg(productId):Math.max(0, Number(p?.packedWeightG||0)>0 ? Number(p.packedWeightG)/1000 : Number(p?.packedWeightKg||0));
      return {index,productId,qty,price,vatRate,p,packedWeightKg};
    });
    if(!rows.length||rows.some(x=>!x.productId||!Number.isFinite(x.qty)||x.qty<=0)){Toast.err('Dòng hàng chưa hợp lệ','Mỗi dòng phải chọn thành phẩm và nhập số lượng lớn hơn 0.');return;}
    const invalidIntegerRow=rows.find(x=>!(typeof crmIsKgProduct==='function'&&crmIsKgProduct(x.p))&&!Number.isInteger(x.qty));
    if(invalidIntegerRow){Toast.err('Số lượng chưa hợp lệ',`${invalidIntegerRow.p?.name||invalidIntegerRow.productId} có ĐVT ${invalidIntegerRow.p?.unit||''}: chỉ được nhập số nguyên lớn hơn 0.`);return;}
    if(new Set(rows.map(x=>x.productId)).size!==rows.length){Toast.err('Thành phẩm bị trùng','Vui lòng gộp cùng thành phẩm vào một dòng.');return;}
    const items=rows.map((x,i)=>{const amount=x.qty*x.price;const vatAmount=Math.round(amount*x.vatRate/100);return {no:i+1,productId:x.productId,name:x.p?.name||x.productId,spec:x.p?.spec||'',unit:x.p?.unit||'',qty:x.qty,price:x.price,amount,vatRate:x.vatRate,vatAmount,lineTotal:amount+vatAmount,packedWeightKg:x.packedWeightKg,shippingWeightKg:Math.round(x.qty*x.packedWeightKg*1000)/1000};});
    const shippingWeightKg=Math.round(items.reduce((sum,it)=>sum+Number(it.shippingWeightKg||0),0)*1000)/1000;
    const otherCosts=typeof crmReadOtherCosts==='function'?crmReadOtherCosts(document):[];
    if(otherCosts.some(x=>!x.name||Number(x.amount||0)<=0)){Toast.err('Chi phí khác chưa hợp lệ','Mỗi khoản chi phí phải có nội dung và số tiền lớn hơn 0.');return;}
    const otherCost=otherCosts.reduce((sum,x)=>sum+Number(x.amount||0),0);
    const subtotal=items.reduce((sum,it)=>sum+it.amount,0); const vat=items.reduce((sum,it)=>sum+Number(it.vatAmount||0),0); const total=subtotal+vat+shippingFee+otherCost;
    const id=SalesCRM.nextNumericCode('DH-2026-',DB.orders,4);
    const opportunityId=$('#crmOrderOpportunity')?.value||'';
    const nowIso=new Date().toISOString();
    const order={id,customerId,date, orderedAt: orderedLocal.length>10 ? localDTToIso(orderedLocal) : new Date().toISOString(),dueDate,paymentDueDate,ownerId,status:'dh_cho_xu_ly',quoteId:null,opportunityId,items,subtotal,discountPct:0,discount:0,vatRate:null,vat,shippingFee,otherCosts,otherCost,total,shippingWeightKg,deliveryAddress,deliveryProvince,deliveryDistrict,deliveryWard,deliveryAddressDetail,deliveryLat,deliveryLng,deliveryRecipient,deliveryPhone,deliveryNote,note:$('#crmOrderNote')?.value.trim()||'',createdBy:DB.currentUser?.userId||DB.currentUser?.id||'',createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||DB.currentUser?.fullName||''),createdAt:nowIso};
    DB.orders.unshift(order);
    // Đơn bán vừa tạo phải xuất hiện NGAY ở Việc cần duyệt của Trưởng Kinh doanh.
    if (typeof approvalRegisterPendingSalesOrderNow === 'function') approvalRegisterPendingSalesOrderNow(order);
    if(opportunityId){const opp=(DB.crmOpportunities||[]).find(x=>x.id===opportunityId);if(opp){opp.customerId=opp.customerId||customerId;opp.stage='CLOSED_WON';opp.probability=100;opp.updatedAt=actualToday;opp.orderId=id;}}
    SalesCRM.saveLocal(['orders']); SEARCH_INDEX=null; Modal.close();
    if(typeof SystemAPI!=='undefined') SystemAPI.audit({module:'CRM',entityType:'SALES_ORDER',entityId:id,action:'CREATE',description:`${DB.currentUser?.name||'Người dùng'} tạo đơn hàng ${id}`,newData:{status:order.status,total:order.total}});
    go('order-detail',{id}); Toast.ok('Đã tạo đơn hàng bán',`${id} · Chờ Trưởng Kinh doanh duyệt`);
  },

  'crm-order-approve': (d) => {
    const o=Q.order(d.id); if(!o)return;
    if(o.status!=='dh_cho_xu_ly'){Toast.warn('Không thể duyệt','Chỉ đơn đang Chờ duyệt mới được phê duyệt.');return;}
    const reserved=SalesCRM.reserveOrderStock(o);
    if(!reserved.ok){
      const nowIso=new Date().toISOString();
      o.status='dh_cho_san_xuat';
      o.approvedBy=DB.currentUser?.userId||DB.currentUser?.id||'';
      o.approvedByName=DB.currentUser?.name||'';
      o.approvedAt=nowIso;
      o.pendingIssueId='';
      SalesCRM.saveLocal(['orders']);
      if(typeof SystemAPI!=='undefined') SystemAPI.audit({module:'CRM',entityType:'SALES_ORDER',entityId:o.id,action:'APPROVE',description:`${DB.currentUser?.name||'Người dùng'} duyệt đơn ${o.id}; Kho sẽ kiểm tra tồn và lập kế hoạch sản xuất phần thiếu`,newData:{status:o.status}});
      render(); Toast.ok('Đã duyệt đơn hàng',`${o.id} đang chờ Kho kiểm tra tồn thành phẩm và lập kế hoạch sản xuất nếu thiếu.`);
      return;
    }
    const actualToday=typeof currentDateYMD==='function'?currentDateYMD():new Date().toISOString().slice(0,10);
    const issueId=nextCode('PX-2026-',DB.goodsIssues || []);
    DB.goodsIssues.unshift({id:issueId,type:'SALES_ISSUE',warehouseId:reserved.warehouseId,refDoc:o.id,orderId:o.id,date:actualToday,status:'PENDING_CONFIRMATION',qcStatus:'PENDING',qcRequestedAt:new Date().toISOString(),createdBy:DB.currentUser?.id||'',requestedBy:o.createdBy||'',approvedBy:DB.currentUser?.userId||DB.currentUser?.id||'',note:`Chờ kho xác nhận xuất theo đơn ${o.id}`,items:(reserved.reservations||[]).map(r=>({...r}))});
    o.status='dh_hoan_thanh'; o.approvedBy=DB.currentUser?.userId||DB.currentUser?.id||''; o.approvedByName=DB.currentUser?.name||''; o.approvedAt=new Date().toISOString(); o.pendingIssueId=issueId;
    SalesCRM.saveLocal(['orders']);
    if(typeof InventoryAPI!=='undefined') InventoryAPI.scheduleCollections(['goodsIssues','inventory'],40);
    if(typeof SystemAPI!=='undefined') SystemAPI.audit({module:'CRM',entityType:'SALES_ORDER',entityId:o.id,action:'APPROVE',description:`${DB.currentUser?.name||'Người dùng'} duyệt đơn ${o.id} và giữ chỗ tồn kho`,newData:{status:o.status,pendingIssueId:issueId}});
    render(); Toast.ok('Đã duyệt đơn hàng',`${issueId} đã chuyển sang Kho thành phẩm · chờ xác nhận xuất.`);
  },

  'crm-order-reject': (d) => {
    const o=Q.order(d.id); if(!o)return;
    if(o.status!=='dh_cho_xu_ly'){Toast.warn('Không thể từ chối','Chỉ đơn đang Chờ duyệt mới được từ chối.');return;}
    const reason=prompt('Lý do từ chối đơn hàng:','')||'';
    if(!reason.trim()) return;
    o.status='dh_tu_choi'; o.rejectedBy=DB.currentUser?.userId||DB.currentUser?.id||''; o.rejectedByName=DB.currentUser?.name||''; o.rejectedAt=new Date().toISOString(); o.rejectReason=reason.trim();
    SalesCRM.saveLocal(['orders']);
    if(typeof SystemAPI!=='undefined') SystemAPI.audit({module:'CRM',entityType:'SALES_ORDER',entityId:o.id,action:'REJECT',description:`${DB.currentUser?.name||'Người dùng'} từ chối đơn ${o.id}: ${reason.trim()}`,newData:{status:o.status}});
    render(); Toast.ok('Đã từ chối đơn hàng',o.id);
  },

  // [SALES FLOW] Sau khi đơn đã được duyệt, nút "Giao hàng" không tạo thêm chứng từ mới.
  // Phiếu SALES_ISSUE chờ xác nhận đã được tạo ở bước duyệt; thao tác này chỉ mở đúng
  // màn Xuất kho thành phẩm và lọc theo đơn bán để Kho xác nhận xuất thật.
  'crm-order-deliver': (d) => {
    const o = Q.order(d.id);
    if (!o) return;

    // Logistics chỉ theo dõi/điều phối giao hàng. Không được đẩy sang route
    // Xuất kho (quyền của Kho), nếu không sẽ phát sinh toast "Không có quyền".
    if (typeof Auth !== 'undefined' && Auth.hasPermission('LOGISTICS_VIEW') && !Auth.hasPermission('INVENTORY_OPERATE')) {
      go('logistics', { tab:'deliveries' });
      if (o.status === 'dh_hoan_thanh' && o.pendingIssueId) {
        Toast.info('Đang chờ Kho xuất thành phẩm', `${o.id} đã sẵn sàng bán. Sau khi Kho xác nhận xuất, đơn sẽ tự chuyển sang Điều phối/Giao hàng.`);
      }
      return;
    }

    if (o.status !== 'dh_hoan_thanh' || !o.pendingIssueId) {
      Toast.warn('Chưa thể giao hàng', 'Đơn hàng phải được duyệt và có yêu cầu xuất kho đang chờ xác nhận.');
      return;
    }
    const f = F('inv-issues', { q:'', type:'', kind:'', issueTab:'finished', dateFrom:'', dateTo:'' });
    f.issueTab = 'finished';
    f.kind = 'issue';
    f.type = 'SALES_ISSUE';
    f.q = o.id;
    State.page['inv-issues'] = 1;
    go('inv-issues');
  },

  'crm-order-issue': (d) => openSalesIssueModal(d.id),
  'crm-order-issue-confirm': (d) => {
    const o=Q.order(d.id); if(!o)return;
    if(SalesCRM.hasSalesIssue(o.id)){Toast.warn('Đơn đã xuất kho','Đơn hàng này đã có phiếu xuất bán hoàn tất.');return;}
    // Luồng mới: Đơn hàng → QC → Kho → Logistics. Không xuất trực tiếp từ CRM, bỏ qua QC.
    Toast.warn('Cần QC xuất kho trước','Xuất bán phải đi qua QC → Kho. Phiếu xuất của đơn nằm ở Kiểm tra chất lượng → Kiểm tra xuất kho.');return;
    const warehouseId=$('#crmSalesWarehouse')?.value||'';
    const wh=(DB.warehouses||[]).find(w=>w.id===warehouseId);
    if(!wh||wh.type!=='FINISHED_GOODS'){Toast.err('Kho không hợp lệ','Chỉ được xuất từ Kho thành phẩm.');return;}
    const plans=[];
    for(const item of o.items||[]){
      const eligible=SalesCRM.eligibleFinishedRows(item.productId,warehouseId);
      const available=eligible.reduce((s,r)=>s+Number(r.qtyAvailable??r.qtyOnHand??0),0);
      if(available<Number(item.qty||0)){Toast.err('Không đủ thành phẩm',`${item.name}: kho ${wh.name} chỉ còn ${fmtN(available)} ${item.unit}, cần ${fmtN(item.qty)}.`);return;}
      plans.push({item,eligible});
    }
    const issueId=nextCode('PX-2026-',DB.goodsIssues);
    const issueItems=[];
    for(const plan of plans){let remain=Number(plan.item.qty||0);for(const row of plan.eligible){if(remain<=0)break;const avail=Number(row.qtyAvailable??row.qtyOnHand??0);const take=Math.min(remain,avail);if(take<=0)continue;const posted=InventoryService.apply({productId:row.productId,warehouseId,locationId:row.locationId,lotId:row.lotId,quantity:take,type:'SALES_ISSUE',refType:'SALES_ORDER',refId:issueId,note:`Xuất bán theo đơn ${o.id}`,updateMaterial:false});if(!posted.ok){Toast.err('Không thể xuất kho',posted.message);return;}issueItems.push({productId:row.productId,lotId:row.lotId,qty:take,locationId:row.locationId,unit:row.unit});remain-=take;}}
    DB.goodsIssues.unshift({id:issueId,type:'SALES_ISSUE',warehouseId,refDoc:o.id,orderId:o.id,date:DB.today,status:'COMPLETED',createdBy:DB.currentUser.id,note:$('#crmSalesIssueNote')?.value.trim()||`Xuất bán theo đơn ${o.id}`,items:issueItems});
    o.salesIssueId=issueId; o.warehouseIssuedDate=DB.today; o.status='dh_cho_van_chuyen';
    SalesCRM.saveLocal(['orders']);
    if(typeof InventoryAPI!=='undefined') InventoryAPI.scheduleCollections(['goodsIssues','inventory','inventoryTransactions'],80);
    const lgDeliveryId = (typeof LogisticsFleet!=='undefined' && LogisticsFleet.createFromSalesOrder) ? LogisticsFleet.createFromSalesOrder(o.id, issueId) : '';
    Modal.close(); go('order-detail',{id:o.id}); Toast.ok('Đã xuất kho bán hàng',`${issueId} · Đơn ${o.id} đã chuyển sang Logistics${lgDeliveryId?` · ${lgDeliveryId}`:''}.`);
  },

  'oqc-open': async (d) => {
    try {
      if (typeof InventoryAPI !== 'undefined') { await InventoryAPI.bootstrap?.(); await InventoryAPI.ensureFresh?.(['goodsIssues','inventory','inventoryLots','warehouses'], { force: false }); }
    } catch (err) { Toast.err('Không tải được phiếu xuất', 'Vui lòng thử lại. Không mở dữ liệu cũ để tránh kiểm tra sai.'); return; }
    if (typeof openOutboundInspectionModal === 'function') openOutboundInspectionModal(d.id);
  },
  'oqc-save': async (d) => {
    const gi = (DB.goodsIssues || []).find(x => x.id === d.id); if (!gi) return;
    if (gi.status !== 'PENDING_CONFIRMATION' || salesIssueQcStatus(gi) !== 'PENDING') { Toast.warn('Phiếu đã xử lý', gi.id); return; }
    const note = ($('#oqcNote')?.value || '').trim();
    const rows = [...document.querySelectorAll('tr[data-idx]')];
    const lines = []; let anyFail = false;
    for (const tr of rows) {
      const it = (gi.items || [])[Number(tr.dataset.idx)]; if (!it) continue;
      const qty = Number(it.qty || 0), pass = Number(tr.querySelector('.oqc-pass')?.value || 0), fail = Number(tr.querySelector('.oqc-fail')?.value || 0);
      const reason = (tr.querySelector('.oqc-reason')?.value || '').trim();
      if (pass < 0 || fail < 0 || Math.abs(pass + fail - qty) > 1e-6) { Toast.err('Số lượng không khớp', `${Q.product(it.productId)?.name || it.productId}: đạt + không đạt phải bằng ${fmtN(qty)}.`); return; }
      if (fail > 0) { anyFail = true; if (!reason && !note) { Toast.err('Thiếu lý do', 'Vui lòng ghi lý do cho phần không đạt.'); return; } }
      lines.push({ productId: it.productId, lotId: it.lotId || '', qty, passQty: pass, failQty: fail, reason });
    }
    const before = { qcStatus: gi.qcStatus, qcNote: gi.qcNote, qcLines: gi.qcLines, qcInspectedAt: gi.qcInspectedAt, qcInspectedBy: gi.qcInspectedBy, qcInspectedByName: gi.qcInspectedByName, qcHistory: gi.qcHistory };
    const status = anyFail ? 'FAILED' : 'PASSED';
    const nowIso = new Date().toISOString(); const byName = DB.currentUser?.name || DB.currentUser?.id || 'QC/QA';
    gi.qcStatus = status; gi.qcNote = note; gi.qcLines = lines; gi.qcInspectedAt = nowIso; gi.qcInspectedBy = DB.currentUser?.id || ''; gi.qcInspectedByName = byName;
    gi.qcHistory = [...(gi.qcHistory || []), { at: nowIso, by: gi.qcInspectedBy, byName, status, note: note || lines.filter(l => l.failQty > 0).map(l => l.reason).filter(Boolean).join('; ') }];
    try { if (typeof InventoryAPI !== 'undefined') { InventoryAPI.cacheCurrent?.(); await InventoryAPI.syncRecords?.('goodsIssues', [gi]); } }
    catch (err) { Object.assign(gi, before); Toast.err('Không lưu được kết quả QC', err?.message || 'Vui lòng thử lại.'); render(); return; }
    try { SystemAPI?.audit?.({ module: 'QUALITY', entityType: 'SALES_ISSUE', entityId: gi.id, action: 'OQC', description: `${byName} kiểm tra chất lượng xuất kho ${gi.id}: ${status === 'PASSED' ? 'đạt' : 'không đạt'}`, newData: { qcStatus: status, orderId: gi.orderId } }); } catch (_) {}
    pushNotification(status === 'PASSED'
      ? { level: 'info', icon: 'fa-box-open', title: `${gi.id} đã qua QC, chờ Kho xuất`, desc: `Đơn ${gi.orderId || gi.refDoc}`, go: { module: 'warehouse', tab: 'issues' } }
      : { level: 'warning', icon: 'fa-circle-xmark', title: `${gi.id} QC xuất kho không đạt`, desc: `Đơn ${gi.orderId || gi.refDoc} · cần Kho xử lý hàng lỗi`, go: { module: 'warehouse', tab: 'issues' } });
    Modal.close(); render();
    Toast.ok(status === 'PASSED' ? 'QC đạt — chuyển Kho xuất hàng' : 'QC không đạt', `${gi.id} · đơn ${gi.orderId || gi.refDoc}`);
  },
  'oqc-request-recheck': async (d) => {
    const gi = (DB.goodsIssues || []).find(x => x.id === d.id); if (!gi) return;
    if (gi.status !== 'PENDING_CONFIRMATION' || salesIssueQcStatus(gi) !== 'FAILED') { Toast.warn('Không thể yêu cầu', 'Chỉ phiếu QC không đạt mới gửi lại QC.'); return; }
    const prev = { qcStatus: gi.qcStatus, qcHistory: gi.qcHistory };
    gi.qcStatus = 'PENDING'; gi.qcRequestedAt = new Date().toISOString();
    gi.qcHistory = [...(gi.qcHistory || []), { at: gi.qcRequestedAt, by: DB.currentUser?.id || '', byName: DB.currentUser?.name || 'Kho', status: 'RECHECK', note: 'Kho yêu cầu QC kiểm tra lại' }];
    try { if (typeof InventoryAPI !== 'undefined') { InventoryAPI.cacheCurrent?.(); await InventoryAPI.syncRecords?.('goodsIssues', [gi]); } }
    catch (err) { Object.assign(gi, prev); Toast.err('Không gửi được yêu cầu', err?.message || 'Vui lòng thử lại.'); render(); return; }
    render(); Toast.ok('Đã gửi QC kiểm tra lại', gi.id);
  },
  'inv-sales-issue-confirm': async (d) => {
    // Luôn đối chiếu tồn + phiếu SALES_ISSUE mới nhất từ server trước khi xác nhận.
    // Trước đây qtyReserved có thể vẫn là snapshot cũ/0 dù phiếu PENDING đã tồn tại,
    // khiến Kho bị chặn sai với thông báo "tồn/giữ chỗ của lô đã thay đổi".
    if(typeof InventoryAPI!=='undefined' && typeof InventoryAPI.ensureFresh==='function'){
      try{ await InventoryAPI.ensureFresh(['goodsIssues','inventory','inventoryLots'],{force:true}); }
      catch(e){ Toast.err('Không tải được tồn kho mới nhất','Vui lòng thử lại.'); return; }
    }
    const gi=(DB.goodsIssues||[]).find(x=>x.id===d.id); if(!gi)return;
    if(gi.type!=='SALES_ISSUE'||gi.status!=='PENDING_CONFIRMATION'){Toast.warn('Phiếu không hợp lệ','Chỉ yêu cầu xuất bán đang chờ xác nhận mới được xử lý.');return;}
    if(salesIssueQcStatus(gi)!=='PASSED'){Toast.warn('Chưa qua QC xuất kho',salesIssueQcStatus(gi)==='FAILED'?'QC không đạt: xử lý hàng lỗi và yêu cầu QC kiểm tra lại.':'Phiếu đang chờ QC kiểm tra chất lượng trước khi Kho xuất.');return;}
    const o=Q.order(gi.orderId||gi.refDoc); if(!o){Toast.err('Không tìm thấy đơn hàng','Không thể xác nhận xuất kho.');return;}
    for(const item of gi.items||[]){
      const row=(DB.inventory||[]).find(x=>x.productId===item.productId&&x.warehouseId===gi.warehouseId&&x.locationId===item.locationId&&x.lotId===item.lotId);
      const need=Number(item.qty||0);
      // ensureFresh() đã reconcile qtyReserved theo toàn bộ SALES_ISSUE PENDING trên server.
      // Chỉ chặn khi tồn vật lý thật sự thiếu hoặc reservation của chính phiếu không còn hợp lệ.
      if(!row||Number(row.qtyOnHand||0)+1e-9<need||Number(row.qtyReserved||0)+1e-9<need){
        Toast.err('Không thể xác nhận xuất',`${Q.product(item.productId)?.name||item.productId}: tồn thực tế không còn đủ cho phiếu này. Hãy làm mới phân bổ lô.`);return;
      }
    }
    for(const item of gi.items||[]){
      const row=(DB.inventory||[]).find(x=>x.productId===item.productId&&x.warehouseId===gi.warehouseId&&x.locationId===item.locationId&&x.lotId===item.lotId);
      row.qtyReserved=Math.max(0,Math.round((Number(row.qtyReserved||0)-Number(item.qty||0))*100)/100);
      row.qtyAvailable=Math.round((Number(row.qtyOnHand||0)-Number(row.qtyReserved||0))*100)/100;
      const posted=InventoryService.apply({productId:item.productId,warehouseId:gi.warehouseId,locationId:item.locationId,lotId:item.lotId,quantity:Number(item.qty||0),type:'SALES_ISSUE',refType:'SALES_ORDER',refId:gi.id,note:`Xuất bán theo đơn ${o.id}`,updateMaterial:false});
      if(!posted.ok){Toast.err('Không thể xuất kho',posted.message);return;}
    }
    gi.status='COMPLETED'; gi.confirmedAt = new Date().toISOString(); gi.confirmedBy=DB.currentUser?.id||''; gi.confirmedByName=DB.currentUser?.name||''; gi.confirmedAt=new Date().toISOString(); gi.date=typeof currentDateYMD==='function'?currentDateYMD():new Date().toISOString().slice(0,10);
    o.status='dh_cho_van_chuyen'; o.salesIssueId=gi.id; o.warehouseIssuedDate=gi.date; o.reservations=[];
    SalesCRM.saveLocal(['orders']);
    if(typeof InventoryAPI!=='undefined') InventoryAPI.scheduleCollections(['goodsIssues','inventory','inventoryTransactions'],40);
    const lgDeliveryId = (typeof LogisticsFleet!=='undefined' && LogisticsFleet.createFromSalesOrder) ? LogisticsFleet.createFromSalesOrder(o.id, gi.id) : '';
    if(typeof SystemAPI!=='undefined') SystemAPI.audit({module:'INVENTORY',entityType:'SALES_ISSUE',entityId:gi.id,action:'ISSUE',description:`${DB.currentUser?.name||'Người dùng'} xác nhận xuất kho theo đơn ${o.id}`,newData:{status:gi.status,orderId:o.id,logisticsDeliveryId:lgDeliveryId||''}});
    render(); Toast.ok('Đã xác nhận xuất kho',`${gi.id} · đơn ${o.id} đã chuyển sang Logistics${lgDeliveryId?` · ${lgDeliveryId}`:''}.`);
  },

  'crm-care-new': () => openCrmCarePicker(),
  'crm-care-pick': () => {
    const customerId = $('#crmCareCustomer')?.value || '';
    if (!customerId) { Toast.err('Chưa chọn khách hàng', 'Vui lòng chọn khách hàng cần chăm sóc.'); return; }
    switchTo(() => openCustomerCareModal(customerId));
  },

  'crm-opportunity-view': (d) => {
    const o=(DB.crmOpportunities||[]).find(x=>x.id===d.id); if(!o)return;
    Modal.open({title:`Chi tiết cơ hội · ${o.id}`,size:'md',body:`<div class="detail-list"><div class="detail-row"><span class="muted">Khách hàng</span><strong>${esc(SalesCRM.customerNameForOpp(o))}</strong></div><div class="detail-row"><span class="muted">Người liên hệ</span><strong>${esc(o.contact||'—')}</strong></div><div class="detail-row"><span class="muted">Giai đoạn</span><strong>${SalesCRM.badgeFrom(SalesCRM.oppStage,o.stage)}</strong></div><div class="detail-row"><span class="muted">Giá trị</span><strong>${fmtVND(o.value)}</strong></div><div class="detail-row"><span class="muted">Xác suất</span><strong>${Number(o.probability||0)}%</strong></div><div class="detail-row"><span class="muted">Dự kiến chốt</span><strong>${fmtDate(o.expectedCloseDate)}</strong></div><div class="detail-row"><span class="muted">Ghi chú</span><strong>${esc(o.note||'—')}</strong></div></div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="crm-opportunity-edit" data-id="${esc(o.id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`});
  },
  'crm-opportunity-delete': (d) => {
    const o=(DB.crmOpportunities||[]).find(x=>x.id===d.id); if(!o)return;
    confirmBox({title:'Xóa cơ hội bán hàng',icon:'fa-trash',okText:'Xóa',message:`Xóa cơ hội <b>${esc(o.id)}</b>?`,onOk:()=>{DB.crmOpportunities=(DB.crmOpportunities||[]).filter(x=>x.id!==o.id);SalesCRM.saveLocal();render();Toast.ok('Đã xóa cơ hội',o.id);}});
  },
  'crm-opportunity-edit': (d) => openOpportunityForm(d.id||''),
  'crm-opportunity-save': (d) => {
    const customerId=$('#crmOppCustomer')?.value||''; const company=$('#crmOppCompany')?.value.trim()||''; const stage=$('#crmOppStage')?.value||'NEW';
    if(!customerId&&!company){Toast.err('Thiếu khách hàng','Chọn khách hàng hoặc nhập tên công ty/nhu cầu.');return;}
    const obj={customerId:customerId||null,company:company||Q.customerName(customerId),contact:$('#crmOppContact')?.value.trim()||Q.customer(customerId)?.contact||'',ownerId:$('#crmOppOwner')?.value||'',stage,value:parseMoney($('#crmOppValue')?.value)||0,probability:SalesCRM.oppStage[stage]?.probability??0,expectedCloseDate:$('#crmOppClose')?.value||DB.today,source:$('#crmOppSource')?.value.trim()||'',note:$('#crmOppNote')?.value.trim()||'',updatedAt:DB.today};
    if(d.id){Object.assign((DB.crmOpportunities||[]).find(x=>x.id===d.id),obj);}else{(DB.crmOpportunities||(DB.crmOpportunities=[])).unshift({id:SalesCRM.nextNumericCode('OPP-2026-',DB.crmOpportunities,3),createdAt:DB.today,leadId:null,...obj});}
    SalesCRM.saveLocal(); Modal.close(); render(); Toast.ok('Đã lưu cơ hội bán hàng');
  },
  'crm-opportunity-order': async (d, el) => {
    const o=(DB.crmOpportunities||[]).find(x=>x.id===d.id);
    if(!o)return;
    const ok = await prepareSalesOrderFormData(el);
    if(ok) switchTo(()=>openOrderForm(o.customerId||'',o.id));
  },

  'crm-care-view': (d) => {
    const l=(DB.customerCareLogs||[]).find(x=>x.id===d.id);if(!l)return;
    Modal.open({title:`Chi tiết CSKH · ${l.id}`,size:'md',body:`<div class="detail-list"><div class="detail-row"><span class="muted">Khách hàng</span><strong>${esc(Q.customerName(l.customerId))}</strong></div><div class="detail-row"><span class="muted">Ngày</span><strong>${fmtDate(l.date)}</strong></div><div class="detail-row"><span class="muted">Kênh</span><strong>${esc(l.method||'—')}</strong></div><div class="detail-row"><span class="muted">Nhân viên</span><strong>${esc(l.staff||'—')}</strong></div><div class="detail-row"><span class="muted">Nội dung</span><strong>${esc(l.content||'—')}</strong></div></div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="crm-care-edit" data-id="${esc(l.id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`});
  },
  'crm-care-edit': (d) => {
    const l=(DB.customerCareLogs||[]).find(x=>x.id===d.id);if(!l)return;
    Modal.open({title:`Sửa nhật ký CSKH · ${l.id}`,body:`<div class="field"><label>Ngày</label><input class="inp" type="date" id="crmCareEditDate" min="${currentDateYMD()}" value="${esc(l.date||currentDateYMD())}"></div><div class="field"><label>Kênh</label><select class="inp" id="crmCareEditMethod">${['phone','meeting','email','zalo','message'].map(x=>`<option value="${x}" ${l.method===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Nội dung</label><textarea class="inp" id="crmCareEditContent" rows="4">${esc(l.content||'')}</textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="crm-care-edit-save" data-id="${esc(l.id)}">Lưu</button>`});
  },
  'crm-care-edit-save': (d) => {const l=(DB.customerCareLogs||[]).find(x=>x.id===d.id);if(!l)return;const date=$('#crmCareEditDate')?.value||currentDateYMD();if(date<currentDateYMD()){Toast.err('Ngày không hợp lệ','Không được chọn ngày quá khứ.');return;}l.date=date;l.method=$('#crmCareEditMethod')?.value||l.method;l.content=$('#crmCareEditContent')?.value.trim()||'';SalesCRM.saveLocal();Modal.close();render();Toast.ok('Đã cập nhật nhật ký',l.id);},
  'crm-care-delete': (d) => {const l=(DB.customerCareLogs||[]).find(x=>x.id===d.id);if(!l)return;confirmBox({title:'Xóa nhật ký CSKH',icon:'fa-trash',okText:'Xóa',message:`Xóa nhật ký <b>${esc(l.id)}</b>?`,onOk:()=>{DB.customerCareLogs=(DB.customerCareLogs||[]).filter(x=>x.id!==l.id);SalesCRM.saveLocal();render();Toast.ok('Đã xóa nhật ký',l.id);}});},
  'crm-order-complaint': (d) => openComplaintForm('', d.id || ''),
  'crm-complaint-view': (d) => {
    const t=(DB.crmTickets||[]).find(x=>x.id===d.id); if(!t)return;
    Modal.open({title:`Chi tiết khiếu nại · ${t.id}`,size:'md',body:`<div class="detail-list"><div class="detail-row"><span class="muted">Khách hàng</span><strong>${esc(t.customerId?Q.customerName(t.customerId):t.customerName||'—')}</strong></div><div class="detail-row"><span class="muted">Đơn hàng</span><strong>${esc(t.orderId||'—')}</strong></div><div class="detail-row"><span class="muted">Tiêu đề</span><strong>${esc(t.title||'—')}</strong></div><div class="detail-row"><span class="muted">Mức độ</span><strong>${esc(t.priority||'—')}</strong></div><div class="detail-row"><span class="muted">Trạng thái</span><strong>${SalesCRM.badgeFrom(SalesCRM.ticketStatus,t.status)}</strong></div><div class="detail-row"><span class="muted">Hạn xử lý</span><strong>${fmtDate(t.dueDate)}</strong></div><div class="detail-row"><span class="muted">Mô tả</span><strong>${esc(t.description||'—')}</strong></div></div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="crm-complaint-edit" data-id="${esc(t.id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`});
  },
  'crm-complaint-delete': (d) => {
    const t=(DB.crmTickets||[]).find(x=>x.id===d.id);if(!t)return;
    confirmBox({title:'Xóa khiếu nại',icon:'fa-trash',okText:'Xóa',message:`Xóa khiếu nại <b>${esc(t.id)}</b>?`,onOk:()=>{DB.crmTickets=(DB.crmTickets||[]).filter(x=>x.id!==t.id);SalesCRM.saveLocal();render();Toast.ok('Đã xóa khiếu nại',t.id);}});
  },
  'crm-complaint-edit': (d) => openComplaintForm(d.id||'', ''),
  'crm-complaint-save': (d) => {
    const customerId=$('#crmTicketCustomer')?.value||''; const title=$('#crmTicketTitle')?.value.trim()||''; if(!customerId||!title){Toast.err('Thiếu thông tin','Vui lòng chọn khách hàng và nhập tiêu đề khiếu nại.');return;}
    const status=$('#crmTicketStatus')?.value||'OPEN'; const obj={customerId,customerName:Q.customerName(customerId),orderId:$('#crmTicketOrder')?.value||'',title,description:$('#crmTicketDesc')?.value.trim()||'',type:'COMPLAINT',priority:$('#crmTicketPriority')?.value||'MEDIUM',status,ownerId:DB.currentUser?.id||'',dueDate:$('#crmTicketDue')?.value||DB.today,resolvedAt:['RESOLVED','CLOSED'].includes(status)?DB.today:null};
    if(d.id){Object.assign((DB.crmTickets||[]).find(x=>x.id===d.id),obj);}else{(DB.crmTickets||(DB.crmTickets=[])).unshift({id:SalesCRM.nextNumericCode('TKT-2026-',DB.crmTickets,3),createdAt:DB.today,...obj});}
    SalesCRM.saveLocal(); Modal.close(); render(); Toast.ok('Đã lưu khiếu nại');
  },


  /* --- Đơn hàng --- */
  'open-order': (d) => switchTo(() => go('order-detail', { id: d.id })),
  'new-order': async (d, el) => {
    const ok = await prepareSalesOrderFormData(el);
    if (ok) openOrderForm();
  },
  'crm-order-edit': (d) => openOrderEditForm(d.id),
  'crm-order-edit-save': (d) => {
    const o = Q.order(d.id); if (!o) return;
    const customerId = $('#crmOrderCustomer')?.value || '';
    const orderedLocal = $('#crmOrderDate')?.value || '';
    const date = orderedLocal.slice(0, 10);
    const dueDate = $('#crmOrderDue')?.value || '';
    const paymentDueDate = $('#crmPaymentDue')?.value || dueDate;
    const ownerId = $('#crmOrderOwner')?.value || o.ownerId || '';
    const deliveryParts = typeof crmReadDeliveryAddressForm==='function' ? crmReadDeliveryAddressForm() : {address:$('#crmDeliveryAddressDetail')?.value.trim()||'',province:'',district:'',ward:'',addressDetail:$('#crmDeliveryAddressDetail')?.value.trim()||''};
    const deliveryAddress = deliveryParts.address;
    const deliveryProvince = deliveryParts.province||'';
    const deliveryDistrict = deliveryParts.district||'';
    const deliveryWard = deliveryParts.ward||'';
    const deliveryAddressDetail = deliveryParts.addressDetail||'';
    const deliveryRecipient = $('#crmDeliveryRecipient')?.value.trim() || '';
    const deliveryPhone = $('#crmDeliveryPhone')?.value.trim() || '';
    const deliveryNote = $('#crmDeliveryNote')?.value.trim() || '';
    const deliveryLat = Number($('#crmDeliveryLat')?.value||0)||null;
    const deliveryLng = Number($('#crmDeliveryLng')?.value||0)||null;
    const shippingFee = Math.max(0, parseMoney($('#crmShippingFee')?.value) || 0);
    if (!customerId) { Toast.err('Chưa chọn khách hàng', 'Vui lòng chọn khách hàng.'); return; }
    if (!deliveryAddress) { Toast.err('Thiếu địa chỉ giao hàng', 'Vui lòng nhập địa chỉ nhận hàng.'); return; }
    if (!date || !dueDate) { Toast.err('Thiếu ngày', 'Vui lòng nhập ngày đặt và ngày giao dự kiến.'); return; }
    if (dueDate < date) { Toast.err('Ngày giao không hợp lệ', 'Ngày giao dự kiến không được trước ngày đặt.'); return; }
    if (paymentDueDate < date) { Toast.err('Hạn thanh toán không hợp lệ', 'Hạn thanh toán không được trước ngày đặt hàng.'); return; }
    const rows = $$('#crmOrderLines .crm-order-line').map((row, index) => {
      const productId = row.querySelector('select[name="product"]')?.value || '';
      const qty = Number(row.querySelector('input[name="qty"]')?.value) || 0;
      const product = Q.product(productId);
      const price = parseMoney(row.querySelector('input[name="price"]')?.value) || Number(product?.price || 0);
      const vatRate = Math.max(0, Number(row.querySelector('select[name="vatRate"]')?.value ?? 0) || 0);
      const packedWeightKg = typeof crmPackedWeightKg==='function'?crmPackedWeightKg(productId):Math.max(0, Number(product?.packedWeightG||0)>0 ? Number(product.packedWeightG)/1000 : Number(product?.packedWeightKg || 0));
      return { index, productId, qty, price, vatRate, product, packedWeightKg };
    });
    if (!rows.length || rows.some(x => !x.productId || !Number.isFinite(x.qty) || x.qty <= 0)) { Toast.err('Dòng hàng chưa hợp lệ', 'Mỗi dòng phải chọn thành phẩm và nhập số lượng lớn hơn 0.'); return; }
    const invalidIntegerRow = rows.find(x => !(typeof crmIsKgProduct==='function' && crmIsKgProduct(x.product)) && !Number.isInteger(x.qty));
    if (invalidIntegerRow) { Toast.err('Số lượng chưa hợp lệ', `${invalidIntegerRow.product?.name||invalidIntegerRow.productId} có ĐVT ${invalidIntegerRow.product?.unit||''}: chỉ được nhập số nguyên lớn hơn 0.`); return; }
    if (new Set(rows.map(x => x.productId)).size !== rows.length) { Toast.err('Thành phẩm bị trùng', 'Vui lòng gộp cùng thành phẩm vào một dòng.'); return; }
    const items = rows.map((x, i) => { const amount=x.qty*x.price; const vatAmount=Math.round(amount*x.vatRate/100); return { no:i+1, productId:x.productId, name:x.product?.name||x.productId, spec:x.product?.spec||'', unit:x.product?.unit||'', qty:x.qty, price:x.price, amount, vatRate:x.vatRate, vatAmount, lineTotal:amount+vatAmount, packedWeightKg:x.packedWeightKg, shippingWeightKg:Math.round(x.qty*x.packedWeightKg*1000)/1000 }; });
    const shippingWeightKg = Math.round(items.reduce((sum,it)=>sum+Number(it.shippingWeightKg||0),0)*1000)/1000;
    const otherCosts = typeof crmReadOtherCosts==='function'?crmReadOtherCosts(document):[];
    if(otherCosts.some(x=>!x.name||Number(x.amount||0)<=0)){Toast.err('Chi phí khác chưa hợp lệ','Mỗi khoản chi phí phải có nội dung và số tiền lớn hơn 0.');return;}
    const otherCost = otherCosts.reduce((sum,x)=>sum+Number(x.amount||0),0);
    const subtotal = items.reduce((sum, it) => sum + it.amount, 0);
    const vat = items.reduce((sum,it)=>sum+Number(it.vatAmount||0),0);
    Object.assign(o, { customerId, ownerId, date, orderedAt: orderedLocal.length>10 ? localDTToIso(orderedLocal) : (o.orderedAt||''), dueDate, paymentDueDate, items, subtotal, vatRate:null, vat, shippingFee, otherCosts, otherCost, shippingWeightKg, total:subtotal+vat+shippingFee+otherCost, deliveryAddress, deliveryProvince, deliveryDistrict, deliveryWard, deliveryAddressDetail, deliveryLat, deliveryLng, deliveryRecipient, deliveryPhone, deliveryNote, note:$('#crmOrderNote')?.value.trim()||'', updatedAt:new Date().toISOString(), updatedBy:DB.currentUser?.userId||DB.currentUser?.id||'', updatedByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||'') });
    SalesCRM.saveLocal(['orders']); SEARCH_INDEX = null;
    if (typeof SystemAPI !== 'undefined') SystemAPI.audit({module:'CRM',entityType:'SALES_ORDER',entityId:o.id,action:'UPDATE',description:`${DB.currentUser?.name||'Người dùng'} cập nhật đơn hàng ${o.id}`,newData:{status:o.status,total:o.total}});
    Modal.close(); render(); Toast.ok('Đã cập nhật đơn hàng', o.id);
  },
  'crm-order-delete': (d) => {
    const o = Q.order(d.id); if (!o) return;
    if (o.status !== 'dh_cho_xu_ly' || o.approvedAt) { Toast.warn('Không thể xóa đơn hàng', 'Chỉ đơn hàng chưa duyệt mới được phép xóa.'); return; }
    const linked = (DB.productionOrders || []).filter(p => p.orderId === o.id);
    const linkedPlans = (DB.productionPlans || []).filter(p => p.source === 'SALES_ORDER' && p.sourceOrderId === o.id && p.status !== 'CANCELLED');
    const lockedPlans = linkedPlans.filter(p => !['WAITING_APPROVAL','WAITING_SALES_APPROVAL'].includes(p.status));
    if (lockedPlans.length) { Toast.warn('Không thể xóa đơn hàng', `Đơn ${o.id} đã có kế hoạch sản xuất được duyệt/đang triển khai. Hãy xử lý kế hoạch sản xuất trước.`); return; }
    const locked = linked.filter(p => p.approvedAt || (typeof productionOrderStarted === 'function' && productionOrderStarted(p)) || p.status !== 'lsx_cho_san_xuat');
    if (locked.length) { Toast.warn('Không thể xóa đơn hàng', `Đơn ${o.id} đã có lệnh sản xuất được duyệt/đang thực hiện. Hãy xử lý lệnh sản xuất trước.`); return; }
    confirmBox({ title:'Xóa đơn hàng', icon:'fa-trash', okText:'Xóa đơn hàng', message:`Xóa đơn hàng <b>${esc(o.id)}</b>?${linked.length?`<br/><br/>${linked.length} lệnh sản xuất chưa duyệt liên kết với đơn cũng sẽ được xóa để tránh dữ liệu mồ côi.`:''}`, onOk:() => {
      DB.orders = (DB.orders || []).filter(x => x.id !== o.id);
      if (linked.length) DB.productionOrders = (DB.productionOrders || []).filter(p => p.orderId !== o.id);
      if (linkedPlans.length) DB.productionPlans = (DB.productionPlans || []).filter(p => !(p.source === 'SALES_ORDER' && p.sourceOrderId === o.id && ['WAITING_APPROVAL','WAITING_SALES_APPROVAL'].includes(p.status)));
      SEARCH_INDEX = null;
      SalesCRM.saveLocal(['orders']);
      if (typeof CRMAPI !== 'undefined' && CRMAPI.deleteKeys) CRMAPI.deleteKeys('orders', [o.id]).catch(()=>{});
      if ((linked.length || linkedPlans.length) && typeof ProductionAPI !== 'undefined') ProductionAPI.scheduleSync(80);
      if (typeof SystemAPI !== 'undefined') SystemAPI.audit({module:'CRM',entityType:'SALES_ORDER',entityId:o.id,action:'DELETE',description:`${DB.currentUser?.name||'Người dùng'} xóa đơn hàng chưa duyệt ${o.id}`});
      go('orders'); Toast.ok('Đã xóa đơn hàng', o.id);
    }});
  },
  'order-status': (d) => openOrderStatusModal(d.id),
  'order-status-save': (d) => {
    const o = Q.order(d.id); if (!o) return;
    const next = $('#ordStatus')?.value || o.status;
    // CRM bán hàng: “Đã giao” bắt buộc phải có phiếu SALES_ISSUE từ Kho thành phẩm.
    if (next === 'dh_da_giao' && typeof SalesCRM !== 'undefined' && !SalesCRM.hasSalesIssue(o.id)) {
      Toast.err('Chưa thể đánh dấu Đã giao', 'Đơn hàng chưa có phiếu Xuất kho bán hàng. Hãy xuất Kho thành phẩm trước.');
      return;
    }
    if (next === 'dh_da_giao' && typeof LogisticsFleet !== 'undefined') {
      const trip = (LogisticsFleet.data()?.deliveries || []).find(x => x.orderId === o.id && ['DELIVERED','PARTIAL','CLOSED'].includes(x.status));
      if (!trip) { Toast.err('Chưa thể đánh dấu Đã giao', 'Logistics chưa xác nhận giao hàng cho đơn này.'); return; }
    }
    if (next === 'dh_hoan_tat') {
      Toast.warn('Hãy xác nhận hoàn thành đúng quy trình', 'Sau khi đơn ở trạng thái Đã giao, dùng nút “Xác nhận hoàn thành đơn hàng” để khai báo hàng trả (nếu có).');
      return;
    }
    if (next === 'dh_hoan_thanh' && typeof SalesCRM !== 'undefined' && !SalesCRM.orderStockState(o).enough) {
      Toast.err('Chưa đủ thành phẩm', 'Kho thành phẩm chưa đủ số lượng đạt QC/còn hạn để sẵn sàng xuất bán.');
      return;
    }
    o.status = next;
    if (typeof SalesCRM !== 'undefined') SalesCRM.saveLocal();
    logActivity('cập nhật trạng thái đơn hàng', o.id, (typeof SalesCRM !== 'undefined' ? SalesCRM.orderStatus[o.status]?.label : statusLabel(o.status)) || o.status, 'fa-arrows-rotate', 'blue');
    Modal.close(); render();
    Toast.ok('Đã cập nhật trạng thái', `${o.id}`);
  },
  'sales-production-request': (d) => {
    const o=Q.order(d.id); if(!o)return;
    Toast.warn('Luồng đã thay đổi',`Đơn ${o.id} sau khi duyệt sẽ được Kho kiểm tra tồn và lập Kế hoạch sản xuất cho phần thiếu.`);
  },
  'sales-production-request-approve': () => {
    Toast.warn('Luồng đã thay đổi','Kế hoạch sản xuất được lập và duyệt tại phân hệ Kho.');
  },
  // Alias cũ chỉ giữ để HTML/cache cũ không phát sinh lỗi.
  'order-create-po': (d) => Actions['sales-production-request'](d),
  'order-deliver': (d) => {
    const o = Q.order(d.id); if (!o) return;
    if (typeof SalesCRM !== 'undefined' && !SalesCRM.hasSalesIssue(o.id)) {
      Toast.err('Chưa thể xác nhận giao hàng', 'Đơn chưa có phiếu Xuất kho bán hàng từ Kho thành phẩm.');
      return;
    }
    confirmBox({
      title: 'Xác nhận giao hàng',
      tone: 'primary', icon: 'fa-truck-fast', okText: 'Xác nhận đã giao',
      message: `Xác nhận đã bàn giao đơn hàng <b>${o.id}</b> cho ${esc(Q.customerName(o.customerId))}?<br/><br/>Đơn hàng sẽ chuyển sang trạng thái <b>Đã giao</b> và ghi nhận doanh thu.`,
      onOk: () => {
        o.status = 'dh_da_giao';
        if (typeof SalesCRM !== 'undefined') SalesCRM.saveLocal();
        logActivity('xác nhận giao hàng', o.id, fmtVND(o.total), 'fa-truck-fast', 'green');
        pushNotification({ level: 'success', icon: 'fa-truck-fast', title: `Đơn hàng ${o.id} đã giao thành công`, desc: `${Q.customerName(o.customerId)} — ${fmtVND(o.total)}`, go: { module: 'orders' } });
        render();
        Toast.ok('Đã cập nhật trạng thái', `${o.id} · Đã giao hàng`);
      },
    });
  },
  'crm-order-complete-open': (d) => {
    const o = Q.order(d.id); if (!o) return;
    if (o.status !== 'dh_da_giao') { Toast.warn('Chưa thể hoàn thành đơn', 'Chỉ đơn hàng ở trạng thái Đã giao mới được xác nhận hoàn thành.'); return; }
    const totalDelivered = (o.items || []).reduce((sum,it)=>sum+Number(it.qty||0),0);
    const lines = (o.items || []).map((it) => {
      const alreadyReturned = (o.returnedItems || []).filter(r => r.productId === it.productId).reduce((sum,r)=>sum+Number(r.qty||0),0);
      const maxAdditional = Math.max(0, Number(it.qty||0) - alreadyReturned);
      return `<div class="crm-return-line return-item-card" data-product="${esc(it.productId)}">
        <div class="return-item-main">
          <div class="return-item-icon"><i class="fa-solid fa-box"></i></div>
          <div class="return-item-info"><div class="return-item-name">${esc(it.name || Q.product(it.productId)?.name || it.productId)}</div><div class="return-item-code">${esc(it.productId)} · Đã giao <b>${fmtN(it.qty)} ${esc(it.unit||'')}</b>${alreadyReturned>0?` · Logistics đã ghi nhận trả <b>${fmtN(alreadyReturned)} ${esc(it.unit||'')}</b>`:''}</div></div>
        </div>
        <div class="return-item-qty"><label>Trả bổ sung khi hoàn tất</label><div class="return-qty-wrap"><input class="inp right num" name="returnQty" type="number" min="0" max="${maxAdditional}" step="0.01" value="0" ${maxAdditional<=0?'disabled':''}><span>${esc(it.unit||'')}</span></div><small>Còn có thể ghi nhận ${fmtN(maxAdditional)} ${esc(it.unit||'')}</small></div>
      </div>`;
    }).join('');
    Modal.open({
      title:'Xác nhận hoàn thành đơn hàng', sub:`${esc(o.id)} · ${esc(Q.customerName(o.customerId))}`, size:'lg',
      body:`<div class="order-complete-summary">
          <div class="order-complete-icon"><i class="fa-solid fa-circle-check"></i></div>
          <div><b>Hoàn tất giao hàng</b><p>Kiểm tra hàng khách trả trước khi đóng đơn. Nếu không có hàng trả, giữ số lượng trả bằng 0.</p></div>
          <div class="order-complete-stat"><span>Đã giao</span><b>${fmtN(totalDelivered)}</b><small>${(o.items||[]).length} mặt hàng</small></div>
        </div>
        <div class="return-info-strip"><i class="fa-solid fa-rotate-left"></i><span>Hàng khách trả sẽ được chuyển riêng vào <b>Kho Hàng trả về</b> và không cộng lại vào tồn thành phẩm bán được.</span></div>
        <div class="form-sec-title return-section-title"><span>Sản phẩm đã giao</span><small>Nhập số lượng thực tế khách trả</small></div>
        <div class="return-items-list">${lines || '<div class="empty">Đơn hàng không có dòng sản phẩm.</div>'}</div>
        <div class="field return-note-field"><label>Ghi chú hoàn thành / trả hàng <span class="muted">(không bắt buộc)</span></label><textarea class="inp" id="crmOrderCompleteNote" rows="3" placeholder="Ví dụ: Khách nhận đủ hàng; hoặc trả 2 hộp do móp bao bì…"></textarea></div>`,
      foot:`<button class="btn" data-act="modal-close"><i class="fa-solid fa-xmark"></i>Hủy</button><button class="btn btn-primary" data-act="crm-order-complete-save" data-id="${esc(o.id)}"><i class="fa-solid fa-circle-check"></i>Xác nhận hoàn thành</button>`
    });
  },
  'crm-order-complete-save': (d) => {
    const o = Q.order(d.id); if (!o) return;
    if (o.status !== 'dh_da_giao') { Toast.warn('Đơn hàng không còn ở trạng thái Đã giao', o.id); return; }
    DB.goodsReceipts = DB.goodsReceipts || []; DB.inventory = DB.inventory || []; DB.inventoryLots = DB.inventoryLots || []; DB.inventoryTransactions = DB.inventoryTransactions || [];
    const returns = []; let invalidReturn = '';
    $$('.crm-return-line').forEach(row => {
      const pid = row.dataset.product || '';
      const it = (o.items || []).find(x => x.productId === pid);
      const qty = Math.max(0, Number(row.querySelector('[name="returnQty"]')?.value || 0));
      const existingQty=(o.returnedItems||[]).filter(x=>x.productId===pid).reduce((sum,x)=>sum+Number(x.qty||0),0);
      if (qty + existingQty > Number(it?.qty || 0) + 0.0001) invalidReturn = `Tổng số lượng trả của ${it?.name || pid} vượt số lượng đã giao.`;
      if (qty > 0) returns.push({ productId:pid, name:it?.name || Q.product(pid)?.name || pid, unit:it?.unit || Q.product(pid)?.unit || '', qty });
    });
    if (invalidReturn) { Toast.err('Số lượng hàng trả không hợp lệ', invalidReturn); return; }
    // Kho Hàng trả về là cấu hình hệ thống bắt buộc. Dữ liệu KIO legacy có thể
    // đã có WH-007 nhưng thiếu location, hoặc thiếu cả warehouse do seed cũ.
    // Chỉ khôi phục master cấu hình (không tự tạo tồn/số lượng) để nghiệp vụ
    // xác nhận hàng trả không bị chặn vô lý.
    DB.warehouses = DB.warehouses || [];
    DB.warehouseLocations = DB.warehouseLocations || [];
    let returnWh = DB.warehouses.find(w => w.type === 'RETURNED' && w.status !== 'inactive');
    let repairedReturnWarehouse = false;
    if (returns.length && !returnWh) {
      returnWh = { id:'WH-007', code:'RETURNED', name:'Kho Hàng trả về', type:'RETURNED', address:'Khu tiếp nhận trả hàng', managerId:'NV-019', status:'active', note:'Tiếp nhận hàng trả từ khách hàng' };
      DB.warehouses.push(returnWh);
      repairedReturnWarehouse = true;
    }
    let returnLoc = DB.warehouseLocations.find(l => l.warehouseId === returnWh?.id && l.status !== 'inactive');
    if (returns.length && returnWh && !returnLoc) {
      const usedIds = new Set(DB.warehouseLocations.map(x => String(x?.id || '')));
      let locId = 'LOC-023';
      if (usedIds.has(locId)) {
        let n = 24;
        while (usedIds.has(`LOC-${String(n).padStart(3,'0')}`)) n += 1;
        locId = `LOC-${String(n).padStart(3,'0')}`;
      }
      returnLoc = { id:locId, warehouseId:returnWh.id, code:'RET-R1', name:'Kệ R1 - Hàng khách trả', parentLocation:'', locationType:'SHELF', capacity:2000, currentUsage:0, status:'active' };
      DB.warehouseLocations.push(returnLoc);
      repairedReturnWarehouse = true;
    }
    if (returns.length && (!returnWh || !returnLoc)) { Toast.err('Không thể khởi tạo Kho Hàng trả về', 'Vui lòng kiểm tra dữ liệu kho và thử lại.'); return; }
    if (repairedReturnWarehouse) {
      InventoryAPI?.cacheCurrent?.();
      InventoryAPI?.scheduleCollections?.(['warehouses','warehouseLocations'], 30);
    }
    let receiptId = '';
    if (returns.length) {
      receiptId = nextCode('PNTR-2026-', DB.goodsReceipts || []);
      const receiptItems = [];
      returns.forEach(r => {
        const lot = { id:nextCode('LOT-',DB.inventoryLots||[]), lotNumber:`RET-${o.id}-${r.productId}`, productId:r.productId, salesOrderId:o.id, mfgDate:currentDateYMD(), expiryDate:'', qcStatus:'RETURNED', status:'active', createdAt:new Date().toISOString() };
        DB.inventoryLots.unshift(lot);
        DB.inventory.unshift({ productId:r.productId, warehouseId:returnWh.id, locationId:returnLoc.id, lotId:lot.id, qtyOnHand:r.qty, qtyPending:0, qtyRejected:0, qtyReserved:0, qtyAvailable:0, unit:r.unit, sourceType:'SALES_RETURN', sourceId:o.id, lastUpdated:new Date().toISOString() });
        DB.inventoryTransactions.unshift({ id:nextCode('TX-',DB.inventoryTransactions||[]), transactionNumber:receiptId, type:'SALES_RETURN_RECEIPT', productId:r.productId, warehouseId:returnWh.id, locationId:returnLoc.id, lotId:lot.id, qty:r.qty, qtyBefore:0, qtyAfter:r.qty, refType:'SALES_ORDER', refId:o.id, userId:DB.currentUser?.id||'', date:currentDateYMD(), note:`Hàng khách trả từ ${o.id}` });
        receiptItems.push({ materialId:r.productId, productId:r.productId, name:r.name, unit:r.unit, qty:r.qty, lotId:lot.id, lotNumber:lot.lotNumber, locationId:returnLoc.id });
      });
      DB.goodsReceipts.unshift({ id:receiptId, type:'SALES_RETURN_RECEIPT', salesOrderId:o.id, refDoc:o.id, date:currentDateYMD(), receivedBy:DB.currentUser?.id||'', warehouse:returnWh.name, warehouseId:returnWh.id, locationId:returnLoc.id, location:returnLoc.name, status:'RECEIVED', note:$('#crmOrderCompleteNote')?.value.trim()||`Hàng khách trả từ ${o.id}`, items:receiptItems });
    }
    const returnMap=new Map(); [...(o.returnedItems||[]),...returns].forEach(r=>{const cur=returnMap.get(r.productId)||{productId:r.productId,name:r.name||r.productId,unit:r.unit||'',qty:0};cur.qty=Math.round((Number(cur.qty||0)+Number(r.qty||0))*1000)/1000;returnMap.set(r.productId,cur);});
    o.status = 'dh_hoan_tat'; o.completedAt = new Date().toISOString(); o.completedBy = DB.currentUser?.id || ''; o.returnedItems = [...returnMap.values()]; if(receiptId){o.returnReceiptId = receiptId;o.returnReceiptIds=[...new Set([...(o.returnReceiptIds||[]),receiptId])];} o.completionNote = $('#crmOrderCompleteNote')?.value.trim() || '';
    SalesCRM?.saveLocal?.(['orders']); InventoryAPI?.scheduleCollections?.(['goodsReceipts','inventoryLots','inventory','inventoryTransactions'],80);
    logActivity('hoàn thành đơn hàng', o.id, returns.length ? `Có ${fmtN(returns.reduce((s,x)=>s+x.qty,0))} hàng trả` : 'Không có hàng trả', 'fa-circle-check', 'green');
    Modal.close(); render(); Toast.ok('Đã hoàn thành đơn hàng', returns.length ? `${o.id} · hàng trả đã nhập Kho Hàng trả về${receiptId?` · ${receiptId}`:''}` : `${o.id} · không có hàng trả`);
  },
  'export-order-pdf': (d) => Exporter.pdf('Don-hang-' + d.id),
  'clear-filter-orders': () => { State.filters.orders = {}; render(); },
  'filter-order-wait': () => { F('orders').status = 'dh_cho_san_xuat'; State.page.orders = 1; render(); },
  'filter-order-doing': () => { F('orders').status = 'dh_dang_san_xuat'; State.page.orders = 1; render(); },
  'filter-order-done': () => { F('orders').status = 'dh_hoan_thanh'; State.page.orders = 1; render(); },
  'filter-order-delivered': () => { F('orders').status = 'dh_da_giao'; State.page.orders = 1; render(); },

  /* --- Hợp đồng --- */
  'open-contract': (d) => switchTo(() => openContractModal(d.id)),
  'filter-expiring': () => { F('contracts').status = 'hd_sap_het_han'; State.page.contracts = 1; render(); },
  'export-contract': (d) => Exporter.pdf('Hop-dong-' + d.id),
  'new-contract': () => Toast.info('Chức năng soạn hợp đồng', 'Bản demo tập trung vào luồng báo giá → đơn hàng → sản xuất. Module soạn thảo hợp đồng sẽ có ở bản triển khai đầy đủ.'),
  'pay-contract': (d) => {
    const c = Q.contract(d.id);
    const amount = Math.min(c.remain, Math.round(c.value * 0.3));
    confirmBox({
      title: 'Ghi nhận thanh toán',
      tone: 'primary', icon: 'fa-money-bill-transfer', okText: 'Ghi nhận ' + fmtVND(amount),
      message: `Ghi nhận khách hàng thanh toán đợt tiếp theo cho hợp đồng <b>${c.id}</b>?<br/><br/>
        Số tiền: <b style="color:var(--primary)">${fmtVND(amount)}</b> · Còn lại sau ghi nhận: <b>${fmtVND(c.remain - amount)}</b>`,
      onOk: () => {
        c.paid += amount; c.remain = c.value - c.paid;
        const cus = Q.customer(c.customerId);
        if (cus) cus.debt = Math.max(0, cus.debt - amount);
        logActivity('ghi nhận thanh toán', c.id, fmtVND(amount), 'fa-money-bill-transfer', 'green');
        render();
        Toast.ok('Đã ghi nhận thanh toán', `${c.id} · ${fmtVND(amount)}`);
      },
    });
  },

  /* --- Lệnh sản xuất --- */
  'open-production-order': (d) => switchTo(() => go('production-detail', { id: d.id })),
  'new-po': () => {
    const productOptions = (DB.products || []).map((p) => `<option value="${esc(p.id)}">${esc(p.id)} — ${esc(p.name)} (${esc(p.unit || '')})</option>`).join('');
    Modal.open({
      title: 'Tạo lệnh sản xuất',
      sub: 'LSX từ đơn hàng bán chỉ được phát hành sau luồng Kho lập Kế hoạch sản xuất → Sản xuất yêu cầu NVL → Kho cấp NVL. Màn này chỉ dùng cho lệnh sản xuất nội bộ/thủ công.',
      size: 'lg',
      body: `
        <div class="card" style="margin-bottom:14px;border-left:3px solid var(--blue)">
          <div class="card-body"><div style="display:flex;gap:10px;align-items:flex-start"><span class="mkpi-ico t-blue"><i class="fa-solid fa-circle-info"></i></span><div><b>Đơn hàng bán không tạo LSX trực tiếp tại đây</b><div class="cell-sub" style="margin-top:4px">Nếu đơn bán thiếu thành phẩm: Kho xem đơn đã duyệt → lập và duyệt Kế hoạch sản xuất → Sản xuất lập yêu cầu NVL → Kho xuất NVL → Sản xuất tạo LSX từ Kế hoạch sản xuất.</div></div></div></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Tạo lệnh sản xuất thủ công</h3><p>Dùng cho nhu cầu sản xuất nội bộ không phát sinh từ đơn hàng bán/kế hoạch đã duyệt</p></div></div>
          <div class="card-body">
            <div class="form-grid cols-2">
              <div class="field"><label>Thành phẩm *</label><select class="inp" id="manualPoProduct"><option value="">-- Chọn thành phẩm --</option>${productOptions}</select></div>
              <div class="field"><label>Số lượng *</label><input class="inp right num" id="manualPoQty" type="number" min="0.01" step="0.01" value="1"></div>
              <div class="field"><label>Ngày bắt đầu</label><input class="inp" id="manualPoStart" type="date" value="${currentDateYMD()}" min="${currentDateYMD()}"></div>
              <div class="field"><label>Deadline</label><input class="inp" id="manualPoDeadline" type="date" value="${addDays(currentDateYMD(), 7)}" min="${currentDateYMD()}"></div>
              <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea class="inp" id="manualPoNote" rows="2" placeholder="Kế hoạch sản xuất nội bộ…"></textarea></div>
            </div>
          </div>
        </div>`,
      foot: `<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="po-manual-create"><i class="fa-solid fa-plus"></i>Tạo lệnh thủ công</button>`,
    });
  },
  'po-manual-create': () => {
    const productId = $('#manualPoProduct')?.value || '';
    const product = Q.product(productId);
    const qty = Number($('#manualPoQty')?.value || 0);
    const today = currentDateYMD();
    const startDate = $('#manualPoStart')?.value || today;
    const deadline = $('#manualPoDeadline')?.value || addDays(startDate, 7);
    const note = $('#manualPoNote')?.value.trim() || '';
    if (!product) { Toast.err('Chưa chọn thành phẩm', 'Vui lòng chọn thành phẩm cần sản xuất.'); return; }
    if (!(qty > 0)) { Toast.err('Số lượng không hợp lệ', 'Số lượng sản xuất phải lớn hơn 0.'); return; }
    if (startDate < today) { Toast.err('Ngày bắt đầu không hợp lệ', 'Ngày bắt đầu phải từ ngày hiện tại trở đi.'); return; }
    if (deadline < today || deadline < startDate) { Toast.err('Deadline không hợp lệ', 'Deadline phải từ ngày hiện tại và bằng hoặc sau ngày bắt đầu.'); return; }

    const po = {
      id: nextCode('LSX-2026-', DB.productionOrders),
      orderId: '',
      productId: product.id,
      productName: product.name,
      spec: product.spec || '',
      unit: product.unit || '',
      customerId: '',
      qty,
      startDate,
      deadline,
      managerId: 'NV-008',
      status: 'lsx_cho_san_xuat',
      stages: buildProductionStagesFromRouting(qty, product.routing || [], startDate),
      qcPass: 0,
      qcFail: 0,
      note,
      source: 'MANUAL',
    };
    DB.productionOrders.unshift(po);
    SEARCH_INDEX = null;
    if (typeof ProductionAPI !== 'undefined') ProductionAPI.scheduleSync(120);
    logActivity('tạo lệnh sản xuất thủ công', po.id, `${po.productName} · ${fmtN(po.qty)} ${po.unit}`, 'fa-industry', 'indigo');
    Modal.close();
    Toast.ok('Đã tạo lệnh sản xuất', `${po.id} · ${po.productName}`);
    go('production-detail', { id: po.id });
  },
  'po-edit': () => Toast.info('Lệnh sản xuất không chỉnh sửa', 'Thông tin LSX được kế thừa từ Kế hoạch sản xuất. Nếu cần thay đổi, xử lý tại Kế hoạch trước khi phát hành LSX.'),
  'po-material-request': (d) => {
    const po=Q.po(d.id); if(!po)return;
    Toast.info('NVL được xử lý tại Kế hoạch sản xuất', 'LSX không lập thêm phiếu yêu cầu NVL. Hãy dùng phiếu đã được lập và Kho cấp từ Kế hoạch sản xuất.');
    return;
    const existing=(DB.productionMaterialRequests||[]).find(r=>r.id===po.materialRequestId||r.productionOrderId===po.id);
    if(existing){Actions['pf-mr-view']({id:existing.id});return;}
    const product=Q.product(po.productId);
    const bom=(po.materialPlan&&po.materialPlan.length)
      ? po.materialPlan.map(x=>({materialId:x.materialId,qty:Number(x.qty||0)}))
      : (product?.bom||[]).map(([mid,per,lossPct=0])=>({materialId:mid,qty:pfBomRequiredQty(per,po.qty,lossPct),lossPct:Number(lossPct||0),baseQtyPerUnit:Number(per||0)}));
    if(!bom.length){Toast.warn('Chưa có BOM',`${product?.name||po.productName} chưa được khai báo BOM / định mức.`);return;}
    const rows=bom.map((x,idx)=>{const m=Q.material(x.materialId);return `<div class="po-mr-line" data-index="${idx}" data-material="${esc(x.materialId)}" style="display:grid;grid-template-columns:1fr 180px;gap:8px;margin-bottom:8px"><div><b>${esc(m?.name||x.materialId)}</b><div class="cell-sub"><span class="code">${esc(x.materialId)}</span> · BOM cho ${fmtN(po.qty)} ${esc(po.unit||'')}</div></div><input class="inp right num" name="qty" type="number" min="0.0001" step="0.0001" value="${Number(x.qty||0)}"></div>`;}).join('');
    Modal.open({title:`Lập phiếu yêu cầu NVL · ${po.id}`,sub:`Hệ thống tự lấy BOM của ${product?.name||po.productName} × ${fmtN(po.qty)} ${esc(po.unit||'')}. Có thể điều chỉnh số lượng thực tế trước khi gửi Kho.`,size:'lg',body:`<div class="alert info" style="margin-bottom:12px"><i class="fa-solid fa-link"></i><span>Dữ liệu nguyên liệu được đồng bộ trực tiếp từ BOM / Định mức của thành phẩm <b>${esc(po.productId)}</b>.</span></div>${rows}<div class="field"><label>Ghi chú yêu cầu</label><textarea class="inp" id="poMrNote" rows="2"></textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="po-material-request-save" data-id="${esc(po.id)}"><i class="fa-solid fa-paper-plane"></i>Gửi yêu cầu NVL</button>`});
  },
  'po-material-request-save': (d) => {
    const po=Q.po(d.id); if(!po)return;
    const existing=(DB.productionMaterialRequests||[]).find(r=>r.id===po.materialRequestId||r.productionOrderId===po.id);
    if(existing){Toast.warn('Đã có phiếu yêu cầu',existing.id);return;}
    const items=[];
    for(const row of document.querySelectorAll('.po-mr-line')){const materialId=row.dataset.material;const qty=Number(row.querySelector('[name="qty"]')?.value||0);if(!materialId||!(qty>0)){Toast.err('Số lượng không hợp lệ','Tất cả nguyên liệu phải có số lượng lớn hơn 0.');return;}items.push({productId:po.productId,materialId,qty});}
    if(!items.length){Toast.err('Chưa có nguyên liệu','Không thể lập phiếu yêu cầu NVL khi BOM rỗng.');return;}
    const id=nextCode('YCNVL-2026-',DB.productionMaterialRequests||[]);
    DB.productionMaterialRequests.unshift({id,productionOrderId:po.id,planId:po.planId||'',date:currentDateYMD(),items,status:'APPROVED',note:$('#poMrNote')?.value.trim()||`Yêu cầu NVL theo BOM của ${po.id}`,createdBy:DB.currentUser?.userId||DB.currentUser?.id||'',createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''),createdAt:new Date().toISOString(),source:'PRODUCTION_ORDER_BOM'});
    po.materialRequestId=id;
    po.materialPlan=items.map(i=>({materialId:i.materialId,qty:i.qty}));
    ProductionAPI?.scheduleSync(80);Modal.close();render();Toast.ok('Đã lập phiếu yêu cầu NVL',`${id} · BOM của ${po.productId} đã được đưa vào phiếu và gửi Kho nguyên liệu.`);
  },
  'po-edit-save': (d) => {
    const po = Q.po(d.id); if (!po) return;
    const started = typeof productionOrderStarted === 'function' ? productionOrderStarted(po) : false;
    const lockCore = !!po.approvedAt || started;
    if (['lsx_dang_qc','lsx_hoan_thanh','lsx_da_nhap_kho'].includes(po.status)) { Toast.warn('Lệnh đã khóa', 'Lệnh đang QC/đã hoàn thành không được chỉnh sửa.'); return; }
    const productId = lockCore ? po.productId : ($('#poEditProduct')?.value || po.productId);
    const product = Q.product(productId);
    const qty = lockCore ? Number(po.qty||0) : Number($('#poEditQty')?.value || 0);
    const startDate = $('#poEditStart')?.value || po.startDate;
    const deadline = $('#poEditDeadline')?.value || po.deadline;
    const managerId = $('#poEditManager')?.value || po.managerId;
    if (!product) { Toast.err('Thành phẩm không hợp lệ', 'Vui lòng chọn thành phẩm.'); return; }
    if (!(qty > 0)) { Toast.err('Số lượng không hợp lệ', 'Số lượng sản xuất phải lớn hơn 0.'); return; }
    if (startDate < currentDateYMD() || deadline < currentDateYMD()) { Toast.err('Ngày không hợp lệ', 'Ngày bắt đầu và deadline không được ở quá khứ.'); return; }
    if (deadline < startDate) { Toast.err('Deadline không hợp lệ', 'Deadline phải bằng hoặc sau ngày bắt đầu.'); return; }
    if (!lockCore && qty !== Number(po.qty||0)) (po.stages || []).forEach(st => { st.qtyPlan = qty; });
    Object.assign(po, { productId:product.id, productName:product.name, spec:product.spec||'', unit:product.unit||'', qty, startDate, deadline, managerId, note:$('#poEditNote')?.value.trim()||'', updatedAt:new Date().toISOString(), updatedBy:DB.currentUser?.userId||DB.currentUser?.id||'' });
    SEARCH_INDEX = null;
    if (typeof ProductionAPI !== 'undefined') ProductionAPI.scheduleSync(80);
    logActivity('cập nhật lệnh sản xuất', po.id, `${po.productName} · ${fmtN(po.qty)} ${po.unit}`, 'fa-pen', 'blue');
    Modal.close(); render(); Toast.ok('Đã cập nhật lệnh sản xuất', po.id);
  },
  'po-approve': (d) => {
    const po = Q.po(d.id); if (!po) return;
    if (po.approvedAt || !['lsx_cho_duyet','lsx_cho_san_xuat'].includes(po.status)) { Toast.warn('Không thể duyệt', 'Lệnh sản xuất này đã được duyệt hoặc đã chuyển sang xử lý.'); return; }
    po.approvedAt = new Date().toISOString();
    po.status = 'lsx_cho_san_xuat';
    po.approvedBy = DB.currentUser?.userId || DB.currentUser?.id || '';
    po.approvedByName = DB.currentUser?.name || DB.currentUser?.fullName || '';
    if (typeof ProductionAPI !== 'undefined') ProductionAPI.scheduleSync(80);
    logActivity('duyệt lệnh sản xuất', po.id, po.productName, 'fa-check', 'green');
    render(); Toast.ok('Đã duyệt lệnh sản xuất', `${po.id} · Từ thời điểm này lệnh không thể xóa.`);
  },
  'po-delete': (d) => {
    const po = Q.po(d.id); if (!po) return;
    const canDelete = typeof productionOrderCanDelete === 'function' ? productionOrderCanDelete(po) : (['lsx_cho_duyet','lsx_cho_san_xuat'].includes(po.status) && !po.approvedAt);
    if (!canDelete) { Toast.warn('Không thể xóa lệnh sản xuất', 'Chỉ lệnh sản xuất chưa duyệt và chưa bắt đầu sản xuất mới được phép xóa.'); return; }
    confirmBox({ title:'Xóa lệnh sản xuất', icon:'fa-trash', okText:'Xóa lệnh', message:`Xóa lệnh sản xuất <b>${esc(po.id)}</b>?`, onOk:() => {
      DB.productionOrders = (DB.productionOrders || []).filter(x => x.id !== po.id);
      SEARCH_INDEX = null;
      if (typeof ProductionAPI !== 'undefined') ProductionAPI.scheduleSync(80);
      logActivity('xóa lệnh sản xuất', po.id, po.productName, 'fa-trash', 'red');
      if (po.orderId) syncOrderStatus(po.orderId);
      go('production'); Toast.ok('Đã xóa lệnh sản xuất', po.id);
    }});
  },
  'po-advance': (d) => {
    const p = Q.po(d.id); if (!p) return;
    const i = p.stages.findIndex((s) => s.status === 'doing');
    if (i >= 0) {
      if (typeof isFinalQcStage === 'function' && isFinalQcStage(p, i)) { Actions['po-qc']({ id:p.id }); return; }
      // QC nằm giữa routing là QC công đoạn, xử lý như một công đoạn bình thường;
      // tuyệt đối không mở FQC thành phẩm và không phát sinh tồn kho.
      openStageModal(p.id, i); return;
    }
    const next = p.stages.findIndex((s) => s.status === 'pending');
    if (next >= 0) Actions['stage-start']({ id: p.id, i: String(next) });
    else Toast.info('Lệnh đã hoàn tất', 'Tất cả công đoạn của lệnh này đã xong.');
  },
  'stage-start': async (d) => {
    const p = Q.po(d.id);
    if (!p) return;
    const i = Number(d.i);
    const s = p.stages[i];
    if (!s) return;
    if (typeof isFinalQcStage === 'function' && isFinalQcStage(p, i)) {
      const ins = finalInspectionOfPO(p.id) || ensureFinishedQcPending(p, Number(s.qtyPlan || p.qty || 0));
      if (ins) {
        go('quality', { tab:'fqc' });
        setTimeout(() => { if (typeof openFinalInspectionModal === 'function') openFinalInspectionModal(ins.id); }, 120);
      }
      return;
    }

    // Công đoạn đầu tiên chỉ được bắt đầu sau khi Kho đã cấp NVL theo phiếu yêu cầu.
    // Không tự trừ tồn tại đây để tránh xuất kho hai lần và bảo đảm lịch sử kho luôn có chứng từ.
    if (i === 0) {
      const product = Q.product(p.productId);
      const requiresMaterials = !!((p.materialPlan || []).length || (product?.bom || []).length);
      if (requiresMaterials) {
        const req = (DB.productionMaterialRequests || []).find(r => r.id === p.materialRequestId || r.productionOrderId === p.id);
        if (!req) {
          Toast.warn('Chưa có NVL từ kế hoạch', `Lệnh ${p.id} chưa có phiếu NVL đã được cấp từ Kế hoạch sản xuất. Hãy xử lý tại Sản xuất → Kế hoạch sản xuất, không lập lại phiếu trong LSX.`);
          return;
        }
        if (req.status !== 'ISSUED' && !p.materialIssuedAt) {
          const msg = req.status === 'APPROVED' ? 'Phiếu đang chờ Kho xuất nguyên liệu.' : 'Phiếu chưa được xuất nguyên liệu.';
          Toast.warn('Nguyên liệu chưa được cấp', `${req.id} · ${msg}`);
          return;
        }
      }
    }

    s.status = 'doing';
    s.start = currentDateYMD();
    s.actualStartedAt = new Date().toISOString();
    p.status = (typeof isFinalQcStage === 'function' && isFinalQcStage(p, i)) ? 'lsx_dang_qc' : 'lsx_dang_san_xuat';
    syncOrderStatus(p.orderId);
    const processQc = typeof isProcessQcStage === 'function' && isProcessQcStage(p, i);
    try {
      if (typeof ProductionAPI !== 'undefined') {
        if (ProductionAPI.persistStageProgress) await ProductionAPI.persistStageProgress(p,[i]);
        else if (processQc && ProductionAPI.persistCollections) await ProductionAPI.persistCollections(['productionOrders']);
        else ProductionAPI.scheduleCollections?.(['productionOrders']);
      }
    } catch (err) {
      s.status = 'pending'; s.start = ''; s.actualStartedAt = '';
      Toast.err('Không lưu được công đoạn lên server', err?.message || 'Vui lòng thử lại.');
      render(); return;
    }
    if (processQc) {
      pushNotification({ level:'warning', icon:'fa-vial-circle-check', title:`${p.id} chờ QC bán thành phẩm`, desc:`${s.name} · ${p.productName}`, go:{module:'quality',tab:'pqc'} });
    }
    logActivity('bắt đầu công đoạn ' + s.name, p.id, p.productName, 'fa-play', 'blue');
    Modal.close(); render();
    Toast.ok(processQc ? 'Đã chuyển QC bán thành phẩm' : 'Đã bắt đầu công đoạn ' + s.name, processQc ? `${p.id} · ${s.name}` : `${p.id} · phụ trách ${Q.employeeName(s.leadId)}`);
  },
  'lsx-near-days-save': () => {
    const n = Number($('#lsxNearDays')?.value);
    if (!Number.isInteger(n) || n < 0 || n > 60) { Toast.err('Giá trị không hợp lệ', 'Số ngày phải là số nguyên từ 0 đến 60.'); return; }
    DB.inventoryAlertConfig = DB.inventoryAlertConfig || {};
    DB.inventoryAlertConfig.lsxNearDeadlineDays = n;
    try { InventoryAPI?.cacheCurrent?.(); InventoryAPI?.scheduleCollections?.(['settings'], 40); } catch (_) {}
    render(); Toast.ok('Đã lưu', `LSX báo sắp hết hạn trước ${n} ngày`);
  },
  // Ghi nhận sản lượng thực tế (user LSX nhập) → thiếu/thừa. Phần thừa đi theo phiếu QC TP và nhập kho cùng lô.
  'po-actual-qty': (d) => {
    const p = Q.po(d.id); if (!p) return;
    if (typeof lsxCanRecordActual === 'function' && !lsxCanRecordActual(p)) { Toast.warn('Không thể ghi nhận', 'LSX chưa sản xuất hoặc phiếu QC thành phẩm đã được xử lý.'); return; }
    const cur = (p.actualQty !== undefined && p.actualQty !== '' && p.actualQty !== null) ? p.actualQty : p.qty;
    Modal.open({
      title: `Sản lượng thực tế · ${p.id}`, sub: `${esc(p.productName)} · Kế hoạch ${fmtN(p.qty)} ${esc(p.unit || '')}`, size: 'md',
      body: `<div class="form-grid">
        <div class="field"><label>Số lượng thực tế sản xuất được <span class="req">*</span></label><input class="inp right num" id="poActualQty" type="number" min="0" step="any" value="${esc(cur)}" oninput="(function(i){const d=Number(i.value||0)-${Number(p.qty||0)};const e=document.getElementById('poActualDiff');if(e)e.textContent=d===0?'Đủ kế hoạch':(d<0?'Thiếu '+(-d):'Thừa '+d);})(this)"><div class="cell-sub" id="poActualDiff" style="margin-top:6px"></div></div>
        <div class="field"><label>Lý do thiếu/thừa</label><textarea class="inp" id="poActualNote" rows="3" placeholder="Bắt buộc nếu khác kế hoạch">${esc(p.actualQtyNote || '')}</textarea></div>
      </div>
      <div class="alert info" style="margin-top:12px"><i class="fa-solid fa-circle-info"></i><span>Số lượng này được chuyển cho QC thành phẩm và hiển thị cho Kho. Phần <b>thừa</b> được QC và nhập kho cùng lô; phần <b>thiếu</b> có thể lập kế hoạch bù tại Kho.</span></div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="po-actual-qty-save" data-id="${esc(p.id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`
    });
    setTimeout(() => $('#poActualQty')?.dispatchEvent(new Event('input')), 0);
  },
  'po-actual-qty-save': async (d) => {
    const p = Q.po(d.id); if (!p) return;
    const actual = Number($('#poActualQty')?.value);
    const note = ($('#poActualNote')?.value || '').trim();
    if (!Number.isFinite(actual) || actual <= 0) { Toast.err('Số lượng không hợp lệ', 'Sản lượng thực tế phải lớn hơn 0.'); return; }
    if (actual !== Number(p.qty || 0) && !note) { Toast.err('Thiếu lý do', 'Vui lòng ghi lý do khi sản lượng thực tế khác kế hoạch.'); return; }
    const ins = typeof finalInspectionOfPO === 'function' ? finalInspectionOfPO(p.id) : null;
    if (ins && (ins.status || 'PENDING') !== 'PENDING') { Toast.warn('Phiếu QC đã xử lý', ins.id); return; }
    const before = { actualQty: p.actualQty, actualQtyNote: p.actualQtyNote, actualQtyAt: p.actualQtyAt, actualQtyBy: p.actualQtyBy, insQty: ins?.qty };
    const row = ins ? (DB.inventory || []).find(r => r.productId === ins.productId && r.lotId === ins.lotId && r.warehouseId === ins.warehouseId) : null;
    const beforePending = row ? row.qtyPending : undefined;
    p.actualQty = actual; p.actualQtyNote = note; p.actualQtyAt = new Date().toISOString(); p.actualQtyBy = DB.currentUser?.name || DB.currentUser?.id || '';
    if (ins) { ins.qty = actual; if (row) row.qtyPending = actual; }
    try {
      if (typeof ProductionAPI !== 'undefined' && ProductionAPI.persistCollections) await ProductionAPI.persistCollections(ins ? ['productionOrders', 'productionFinalInspections'] : ['productionOrders']);
      if (ins && typeof InventoryAPI !== 'undefined') InventoryAPI.scheduleCollections?.(['inventory'], 80);
    } catch (err) {
      Object.assign(p, before); if (ins) { ins.qty = before.insQty; if (row) row.qtyPending = beforePending; }
      Toast.err('Không lưu được sản lượng thực tế', err?.message || 'Vui lòng thử lại.'); render(); return;
    }
    const diff = actual - Number(p.qty || 0);
    logActivity('ghi nhận sản lượng thực tế', p.id, `${fmtN(actual)}/${fmtN(p.qty)} ${p.unit}${diff ? (diff < 0 ? ` · thiếu ${fmtN(-diff)}` : ` · thừa ${fmtN(diff)}`) : ''}`, 'fa-scale-balanced', diff < 0 ? 'red' : 'blue');
    Modal.close(); render();
    Toast.ok('Đã ghi nhận sản lượng thực tế', diff === 0 ? 'Đủ kế hoạch' : (diff < 0 ? `Thiếu ${fmtN(-diff)} ${p.unit || ''}` : `Thừa ${fmtN(diff)} ${p.unit || ''} sẽ được nhập kho sau QC`));
  },
  // Hoàn thành toàn bộ công đoạn SX còn lại (dừng trước QC bán thành phẩm / QC thành phẩm).
  'po-complete-all': (d) => {
    const p = Q.po(d.id); if (!p) return;
    const idx = lsxCompleteAllEligible(p);
    if (!idx.length) { Toast.info('Không còn công đoạn', 'Không có công đoạn sản xuất nào cần hoàn thành.'); return; }
    const rows = idx.map((i) => {
      const s = p.stages[i];
      const norm = (Q.opsOfStage(p.productId, s.name) || []).reduce((t, o) => t + Number(o.hoursPer || 0), 0) * Number(p.qty || 0);
      const remain = Math.max(0, Number(s.qtyPlan || 0) - Number(s.qtyDone || 0));
      return `<div class="pf-plan-line" data-i="${i}" style="display:grid;grid-template-columns:1fr 130px 150px;gap:8px;align-items:center;margin-bottom:8px"><div><b>${i + 1}. ${esc(s.name)}</b><div class="cell-sub">Ghi nhận thêm ${fmtN(remain)} ${esc(p.unit || '')}</div></div><span class="cell-sub">Giờ máy thêm</span><input class="inp right num" name="hours" type="number" min="0.01" step="0.01" value="${norm > 0 ? Math.round(norm * 100) / 100 : 1}"></div>`;
    }).join('');
    Modal.open({
      title: `Hoàn thành toàn bộ công đoạn · ${p.id}`, sub: `${esc(p.productName)} · ${idx.length} công đoạn sản xuất`, size: 'lg',
      body: `<div class="alert warning" style="margin-bottom:12px"><i class="fa-solid fa-triangle-exclamation"></i><span>Mỗi công đoạn được ghi nhận đủ sản lượng kế hoạch. Quy trình dừng trước QC bán thành phẩm / QC thành phẩm vì các bước này do QC thực hiện. Giờ máy mặc định lấy theo định mức, hãy chỉnh về giờ thực tế.</span></div>${rows}`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="po-complete-all-save" data-id="${esc(p.id)}"><i class="fa-solid fa-forward-fast"></i>Xác nhận hoàn thành</button>`
    });
  },
  'po-complete-all-save': async (d) => {
    const p = Q.po(d.id); if (!p) return;
    const idx = lsxCompleteAllEligible(p);
    const hoursBy = {};
    for (const el of document.querySelectorAll('.pf-plan-line[data-i]')) {
      const h = Number(el.querySelector('[name="hours"]')?.value || 0);
      if (!(h > 0)) { Toast.err('Thiếu giờ máy', 'Giờ máy mỗi công đoạn phải lớn hơn 0.'); return; }
      hoursBy[el.dataset.i] = h;
    }
    if (!idx.length) { Modal.close(); return; }
    // Công đoạn đầu phải qua kiểm tra cấp NVL như khi bắt đầu thủ công.
    if (p.stages[idx[0]].status === 'pending') {
      await Actions['stage-start']({ id: p.id, i: String(idx[0]) });
      if (p.stages[idx[0]].status !== 'doing') return;
    }
    const beforePo = JSON.parse(JSON.stringify(p));
    const nowIso = () => new Date().toISOString();
    const touched = [];
    idx.forEach((i) => {
      const s = p.stages[i];
      if (s.status === 'pending') { s.status = 'doing'; s.start = currentDateYMD(); s.actualStartedAt = nowIso(); }
      s.qtyDone = Number(s.qtyPlan || 0);
      s.hours = Number(s.hours || 0) + Number(hoursBy[String(i)] || 0);
      s.status = 'done'; s.end = currentDateYMD(); s.actualEndedAt = nowIso();
      touched.push(i);
    });
    const last = idx[idx.length - 1];
    const next = p.stages[last + 1];
    if (next) {
      next.status = 'doing'; next.start = currentDateYMD(); next.actualStartedAt = nowIso();
      touched.push(last + 1);
      if (typeof isFinalQcStage === 'function' && isFinalQcStage(p, last + 1)) { p.status = 'lsx_dang_qc'; ensureFinishedQcPending(p, Number(p.stages[last].qtyDone || p.qty)); }
      else p.status = 'lsx_dang_san_xuat';
    } else { p.status = 'lsx_hoan_thanh'; p.completedAt = nowIso(); }
    syncOrderStatus(p.orderId);
    try {
      if (typeof ProductionAPI !== 'undefined' && ProductionAPI.persistCollections) {
        if (ProductionAPI.persistStageProgress) await ProductionAPI.persistStageProgress(p, touched); else await ProductionAPI.persistCollections(['productionOrders']);
      }
    } catch (err) {
      const k = (DB.productionOrders || []).findIndex(x => x.id === p.id); if (k >= 0) DB.productionOrders[k] = beforePo;
      Toast.err('Không lưu được tiến độ lên server', err?.message || 'Dữ liệu đã được hoàn tác.'); render(); return;
    }
    if (next && typeof isProcessQcStage === 'function' && isProcessQcStage(p, last + 1)) {
      pushNotification({ level: 'warning', icon: 'fa-vial-circle-check', title: `${p.id} chờ QC bán thành phẩm`, desc: `${next.name} · ${p.productName}`, go: { module: 'quality', tab: 'pqc' } });
    }
    logActivity('hoàn thành toàn bộ công đoạn', p.id, `${idx.length} công đoạn · ${p.productName}`, 'fa-forward-fast', 'green');
    Modal.close(); render();
    Toast.ok('Đã hoàn thành các công đoạn sản xuất', `${p.id} · ${idx.length} công đoạn${next ? ` · chuyển sang ${next.name}` : ''}`);
  },
  'stage-update': (d) => openStageModal(d.id, Number(d.i)),
  'stage-save': async (d) => {
    const p = Q.po(d.id);
    const i = Number(d.i);
    const s = p.stages[i];
    if (typeof isProcessQcStage === 'function' && isProcessQcStage(p, i)) {
      Toast.warn('Công đoạn do QC kiểm tra', 'Hãy thực hiện tại QC / QA → Kiểm tra bán thành phẩm. Sản xuất chỉ theo dõi kết quả.');
      return;
    }
    const beforePo = JSON.parse(JSON.stringify(p));
    const qtyInput = Number($('#stQty')?.value || 0);
    const hoursInput = Number($('#stHours')?.value || 0);
    const leadInput = String($('#stLead')?.value || '').trim();
    const machineInput = String($('#stMachine')?.value || '').trim();
    const noteInput = String($('#stNote')?.value || '').trim();
    if (!(qtyInput > 0)) { Toast.err('Thiếu sản lượng', 'Sản lượng hoàn thành là bắt buộc và phải lớn hơn 0.'); return; }
    if (!(hoursInput > 0)) { Toast.err('Thiếu giờ máy', 'Giờ máy phát sinh là bắt buộc và phải lớn hơn 0.'); return; }
    if (!leadInput) { Toast.err('Thiếu người phụ trách', 'Vui lòng chọn người phụ trách công đoạn.'); return; }
    if (!machineInput) { Toast.err('Thiếu máy / trạm', 'Máy hoặc trạm thực hiện là bắt buộc.'); return; }
    // Ghi nhận theo từng lần và cộng dồn vào tổng sản lượng của công đoạn.
    // Không cho nhập vượt phần còn lại của kế hoạch.
    const qtyPlan = Number(s.qtyPlan || 0);
    const qtyDoneBefore = Number(s.qtyDone || 0);
    const qtyRemain = Math.max(0, qtyPlan - qtyDoneBefore);
    if (!(qtyRemain > 0)) {
      Toast.warn('Công đoạn đã đủ sản lượng', `Đã ghi nhận đủ ${fmtN(qtyPlan)} ${p.unit || ''}.`);
      return;
    }
    if (qtyInput > qtyRemain) {
      Toast.err('Sản lượng vượt kế hoạch', `Công đoạn đã hoàn thành ${fmtN(qtyDoneBefore)}/${fmtN(qtyPlan)} ${p.unit || ''}. Chỉ còn được ghi nhận tối đa ${fmtN(qtyRemain)} ${p.unit || ''}.`);
      return;
    }
    const qty = qtyDoneBefore + qtyInput;
    s.qtyDone = qty;
    s.hours = Number(s.hours || 0) + hoursInput;
    s.leadId = leadInput;
    s.machine = machineInput;
    s.note = noteInput;

    if (qty >= qtyPlan) {
      s.status = 'done';
      s.end = currentDateYMD();
      s.actualEndedAt = new Date().toISOString();
      const next = p.stages[i + 1];
      if (next) {
        next.status = 'doing';
        next.start = currentDateYMD();
        next.actualStartedAt = new Date().toISOString();
        if (typeof isFinalQcStage === 'function' && isFinalQcStage(p, i + 1)) {
          p.status = 'lsx_dang_qc';
          ensureFinishedQcPending(p, qty);
        } else {
          // Kể cả khi next là QC giữa routing, đây vẫn là luồng sản xuất nội bộ.
          // QC công đoạn không tạo phiếu FQC và không chạm tồn kho.
          p.status = 'lsx_dang_san_xuat';
        }
      } else {
        p.status = 'lsx_hoan_thanh';
        p.completedAt = new Date().toISOString();
      }
    } else {
      s.status = 'doing';
      p.status = (typeof isFinalQcStage === 'function' && isFinalQcStage(p, i)) ? 'lsx_dang_qc' : 'lsx_dang_san_xuat';
    }
    syncOrderStatus(p.orderId);
    try {
      if (typeof ProductionAPI !== 'undefined' && ProductionAPI.persistCollections) {
        if (ProductionAPI.persistStageProgress) await ProductionAPI.persistStageProgress(p,[i, i+1]);
        else await ProductionAPI.persistCollections(['productionOrders']);
      } else if (typeof ProductionAPI !== 'undefined') ProductionAPI.scheduleCollections?.(['productionOrders']);
    } catch (err) {
      const idx=(DB.productionOrders||[]).findIndex(x=>x.id===p.id);
      if(idx>=0) DB.productionOrders[idx]=beforePo;
      Toast.err('Không lưu được tiến độ lên server', err?.message || 'Dữ liệu đã được hoàn tác.');
      render(); return;
    }
    if (qty >= s.qtyPlan) {
      const nextStage = p.stages[i + 1];
      if (nextStage && typeof isProcessQcStage === 'function' && isProcessQcStage(p, i + 1)) {
        pushNotification({ level:'warning', icon:'fa-vial-circle-check', title:`${p.id} chờ QC bán thành phẩm`, desc:`${nextStage.name} · ${p.productName}`, go:{module:'quality',tab:'pqc'} });
      }
    }
    logActivity('cập nhật tiến độ', p.id, `${s.name}: ${fmtN(s.qtyDone)}/${fmtN(s.qtyPlan)} ${p.unit}`, 'fa-gears', 'indigo');
    Modal.close(); render();
    Toast.ok(qty >= s.qtyPlan ? `Hoàn tất công đoạn ${s.name}` : 'Đã cập nhật sản lượng',
      `${p.id} · tiến độ tổng ${Q.progress(p)}%`);
  },
  'pqc-open': (d) => {
    const po = Q.po(d.id); if (!po) return;
    const i = Number(d.i);
    const stage = (po.stages || [])[i];
    if (!stage || typeof isProcessQcStage !== 'function' || !isProcessQcStage(po, i)) return;
    if (typeof openProcessInspectionModal === 'function') openProcessInspectionModal(po.id, i);
  },
  'pqc-save': async (d) => {
    if (!Auth.require('QC_INSPECT', 'Chỉ QC/QA được ghi nhận kết quả kiểm tra bán thành phẩm.')) return;
    const po = Q.po(d.id); if (!po) return;
    const i = Number(d.i);
    const stage = (po.stages || [])[i];
    if (!stage || typeof isProcessQcStage !== 'function' || !isProcessQcStage(po, i)) return;
    if (stage.status === 'done') { Toast.info('Checkpoint đã hoàn tất', 'Kết quả QC đã được khóa.'); return; }

    const plan = Number(stage.qtyPlan || po.qty || 0);
    const doneBefore = Number(stage.qtyDone || 0);
    const q0 = stage.processQc || {};
    const legacyPending = q0.status === 'FAILED' ? Math.max(0, Number(q0.lastFailQty || 0)) : 0;
    const pendingReworkBefore = Math.max(0, Number(q0.pendingReworkQty ?? legacyPending));
    const readyRetestBefore = Math.max(0, Number(q0.readyRetestQty || 0));
    const uninspectedBefore = Math.max(0, plan - doneBefore - pendingReworkBefore - readyRetestBefore);
    const isRetest = readyRetestBefore > 0;
    const maxCheck = isRetest ? readyRetestBefore : uninspectedBefore;

    if (pendingReworkBefore > 0 && !isRetest) {
      Toast.warn('Đang chờ Sản xuất sửa/tái chế', `Còn ${fmtN(pendingReworkBefore)} ${po.unit || ''} lỗi chưa được xác nhận xử lý.`);
      return;
    }

    const pass = Number($('#pqcPass')?.value || 0);
    const fail = Number($('#pqcFail')?.value || 0);
    const note = String($('#pqcNote')?.value || '').trim();
    if (!(pass >= 0) || !(fail >= 0) || !(pass + fail > 0)) { Toast.err('Thiếu kết quả kiểm tra', 'Hãy nhập số lượng đạt hoặc không đạt của lần kiểm này.'); return; }
    if (pass + fail > maxCheck) { Toast.err(isRetest ? 'Số lượng tái kiểm vượt phần đã sửa' : 'Số lượng kiểm vượt phần còn lại', `Tối đa ${fmtN(maxCheck)} ${po.unit || ''}.`); return; }
    if (fail > 0 && !note) { Toast.err('Thiếu ghi chú lỗi', 'Khi có bán thành phẩm không đạt, vui lòng ghi rõ lỗi / hướng xử lý.'); return; }

    const beforePo = JSON.parse(JSON.stringify(po));
    const inspectedAt = new Date().toISOString();
    const inspectorId = DB.currentUser?.id || DB.currentUser?.userId || '';
    const inspectorName = DB.currentUser?.name || DB.currentUser?.fullName || 'QC/QA';
    stage.processQcHistory = Array.isArray(stage.processQcHistory) ? stage.processQcHistory : [];
    const inspectionNo = stage.processQcHistory.filter(x=>x && x.eventType !== 'REWORK').length + 1;
    stage.processQcHistory.push({
      id:`PQC-${po.id}-${i}-${Date.now()}`,
      eventType:'INSPECTION', inspectionNo,
      inspectionType:isRetest ? 'RETEST' : 'INITIAL',
      checkedQty:pass + fail, passQty:pass, failQty:fail, note,
      inspectedAt, inspectorId, inspectorName
    });

    stage.qtyDone = Math.min(plan, doneBefore + pass);
    let pendingReworkQty = pendingReworkBefore;
    let readyRetestQty = readyRetestBefore;
    if (isRetest) readyRetestQty = Math.max(0, readyRetestQty - (pass + fail));
    pendingReworkQty += fail;
    const uninspectedQty = Math.max(0, plan - Number(stage.qtyDone || 0) - pendingReworkQty - readyRetestQty);

    let qcStatus = 'IN_PROGRESS';
    if (pendingReworkQty > 0) qcStatus = 'REWORK_PENDING';
    else if (readyRetestQty > 0) qcStatus = 'READY_RETEST';
    else if (Number(stage.qtyDone || 0) >= plan && uninspectedQty === 0) qcStatus = 'PASSED';

    stage.processQc = {
      ...q0,
      status: qcStatus,
      lastPassQty: pass, lastFailQty: fail, note, inspectedAt, inspectorId, inspectorName,
      totalPassQty: Number(stage.qtyDone || 0),
      historicalFailQty: stage.processQcHistory.reduce((t,x)=>t+Number(x?.failQty||0),0),
      pendingReworkQty, readyRetestQty, uninspectedQty,
      lastInspectionType: isRetest ? 'RETEST' : 'INITIAL',
      lastInspectionNo: inspectionNo
    };
    stage.note = note || stage.note || '';

    const completed = qcStatus === 'PASSED';
    if (completed) {
      stage.qtyDone = plan;
      stage.status = 'done';
      stage.end = currentDateYMD();
      const next = po.stages[i + 1];
      if (next) {
        next.status = 'doing';
        next.start = currentDateYMD();
        next.actualStartedAt = new Date().toISOString();
        if (typeof isFinalQcStage === 'function' && isFinalQcStage(po, i + 1)) po.status = 'lsx_dang_qc';
        else po.status = 'lsx_dang_san_xuat';
      }
    } else {
      stage.status = 'doing';
      po.status = 'lsx_dang_san_xuat';
    }

    try {
      if (typeof ProductionAPI !== 'undefined' && ProductionAPI.persistStageProgress) await ProductionAPI.persistStageProgress(po,[i, i+1]);
      else if (typeof ProductionAPI !== 'undefined' && ProductionAPI.persistCollections) await ProductionAPI.persistCollections(['productionOrders']);
      else if (typeof ProductionAPI !== 'undefined') ProductionAPI.scheduleCollections?.(['productionOrders']);
    } catch (err) {
      const idx=(DB.productionOrders||[]).findIndex(x=>x.id===po.id); if(idx>=0) DB.productionOrders[idx]=beforePo;
      Toast.err('Không lưu được QC bán thành phẩm', err?.message || 'Dữ liệu đã được hoàn tác.');
      render(); return;
    }

    if (completed) {
      const next = po.stages[i + 1];
      if (next && typeof isFinalQcStage === 'function' && isFinalQcStage(po, i + 1)) {
        const ins = ensureFinishedQcPending(po, Number(stage.qtyDone || po.qty || 0));
        try {
          if (ins && typeof ProductionAPI !== 'undefined' && ProductionAPI.persistCollections) await ProductionAPI.persistCollections(['productionOrders','productionFinalInspections']);
          if (ins && typeof InventoryAPI !== 'undefined' && InventoryAPI.syncNow) await InventoryAPI.syncNow();
        } catch (err) { console.warn('[PQC] Final QC pending chưa sync hoàn tất:', err); }
      }
      pushNotification({ level:'info', icon:'fa-circle-check', title:`${po.id} đã đạt QC bán thành phẩm`, desc:`${stage.name} · chuyển công đoạn tiếp theo`, go:{module:'production',tab:'orders'} });
    } else if (pendingReworkQty > 0) {
      pushNotification({ level:'warning', icon:'fa-screwdriver-wrench', title:`${po.id} chờ sửa/tái chế bán thành phẩm`, desc:`${stage.name} · ${fmtN(pendingReworkQty)} ${po.unit||''} cần xử lý`, go:{module:'production',tab:'orders'} });
    }
    logActivity(isRetest ? 'tái kiểm bán thành phẩm' : 'QC bán thành phẩm', po.id, `${stage.name}: đạt ${fmtN(pass)}, lỗi ${fmtN(fail)}`, 'fa-vial-circle-check', fail>0?'orange':'green');
    Modal.close(); render();
    Toast.ok(completed ? 'QC bán thành phẩm đạt' : (pendingReworkQty>0 ? 'Đã chuyển phần lỗi sang chờ sửa/tái chế' : (isRetest ? 'Đã lưu kết quả tái kiểm' : 'Đã lưu kết quả QC')), completed ? `${po.id} · đã mở công đoạn tiếp theo.` : `${po.id} · đã lưu lên server.`);
  },
  'pqc-rework-done': async (d) => {
    if (!Auth.require('PRODUCTION_OPERATE', 'Chỉ Sản xuất được xác nhận phần bán thành phẩm đã sửa/tái chế.')) return;
    const po = Q.po(d.id); if (!po) return;
    const i = Number(d.i);
    const stage = (po.stages || [])[i];
    if (!stage || typeof isProcessQcStage !== 'function' || !isProcessQcStage(po, i)) return;
    const q = stage.processQc || {};
    const legacyPending = q.status === 'FAILED' ? Math.max(0, Number(q.lastFailQty || 0)) : 0;
    const pending = Math.max(0, Number(q.pendingReworkQty ?? legacyPending));
    if (pending <= 0) { Toast.info('Không có bán thành phẩm chờ sửa', 'Checkpoint này chưa có số lượng lỗi cần xử lý.'); return; }
    const beforePo = JSON.parse(JSON.stringify(po));
    const now = new Date().toISOString();
    const userId = DB.currentUser?.id || DB.currentUser?.userId || '';
    const userName = DB.currentUser?.name || DB.currentUser?.fullName || Q.employeeName(stage.leadId) || 'Sản xuất';
    stage.processQcReworkHistory = Array.isArray(stage.processQcReworkHistory) ? stage.processQcReworkHistory : [];
    stage.processQcReworkHistory.push({ id:`PQR-${po.id}-${i}-${Date.now()}`, qty:pending, reworkedAt:now, userId, userName });
    stage.processQc = {
      ...q,
      status:'READY_RETEST',
      pendingReworkQty:0,
      readyRetestQty:Math.max(0, Number(q.readyRetestQty||0)) + pending,
      lastReworkQty:pending,
      lastReworkedAt:now,
      lastReworkedBy:userName
    };
    stage.status = 'doing';
    try {
      if (typeof ProductionAPI !== 'undefined' && ProductionAPI.persistStageProgress) await ProductionAPI.persistStageProgress(po,[i]);
      else if (typeof ProductionAPI !== 'undefined' && ProductionAPI.persistCollections) await ProductionAPI.persistCollections(['productionOrders']);
    } catch (err) {
      const idx=(DB.productionOrders||[]).findIndex(x=>x.id===po.id); if(idx>=0) DB.productionOrders[idx]=beforePo;
      Toast.err('Không lưu được xác nhận sửa/tái chế', err?.message || 'Dữ liệu đã được hoàn tác.'); render(); return;
    }
    pushNotification({ level:'info', icon:'fa-vial-circle-check', title:`${po.id} đã sửa/tái chế xong`, desc:`${stage.name} · ${fmtN(pending)} ${po.unit||''} sẵn sàng tái kiểm`, go:{module:'quality',tab:'pqc'} });
    logActivity('sửa/tái chế bán thành phẩm', po.id, `${stage.name}: ${fmtN(pending)} ${po.unit||''}`, 'fa-screwdriver-wrench', 'orange');
    render();
    Toast.ok('Đã xác nhận sửa/tái chế', `${fmtN(pending)} ${po.unit||''} đã chuyển sang chờ QC tái kiểm.`);
  },
  'po-qc': (d) => {
    const p = Q.po(d.id); if (!p) return;
    const finalQcIndex = (p.stages || []).findIndex((st, idx) => typeof isFinalQcStage === 'function' ? isFinalQcStage(p, idx) : /QC — ATTP/i.test(String(st?.name || '')));
    if (finalQcIndex < 0 || !(p.stages || []).slice(0, finalQcIndex).every(st => st.status === 'done')) {
      Toast.warn('Chưa đến QC thành phẩm', 'Hãy hoàn tất các công đoạn và QC trung gian trước. QC giữa quy trình không nhập kho thành phẩm.');
      return;
    }
    const ins = finalInspectionOfPO(p.id) || ensureFinishedQcPending(p, Number(p.qty || 0));
    if (!ins) return;
    go('quality', { tab:'fqc' });
    setTimeout(() => { if (typeof openFinalInspectionModal === 'function') openFinalInspectionModal(ins.id); }, 120);
  },
  'po-qc-save': (d) => {
    const p = Q.po(d.id); if (!p) return;
    const finalQcIndex = (p.stages || []).findIndex((st, idx) => typeof isFinalQcStage === 'function' ? isFinalQcStage(p, idx) : /QC — ATTP/i.test(String(st?.name || '')));
    if (finalQcIndex < 0 || !(p.stages || []).slice(0, finalQcIndex).every(st => st.status === 'done')) {
      Toast.warn('Chưa đến QC thành phẩm', 'QC công đoạn giữa quy trình không phát sinh nhập kho.');
      return;
    }
    const ins = finalInspectionOfPO(p.id) || ensureFinishedQcPending(p, Number(p.qty || 0));
    if (ins && typeof openFinalInspectionModal === 'function') openFinalInspectionModal(ins.id);
  },
  'fqc-open': async (d) => {
    // [SERVER-FIRST FQC DETAIL] Form phải dùng phiếu QC mới nhất từ server,
    // không mở snapshot cũ rồi mới đổi dữ liệu sau đó. Master kho/lô vẫn lazy-load.
    try {
      const jobs = [];
      if (typeof ProductionAPI !== 'undefined') {
        await ProductionAPI.bootstrap?.();
        jobs.push(ProductionAPI.ensureFresh?.(['productionOrders','productionFinalInspections'], { force: false }));
      }
      if (typeof InventoryAPI !== 'undefined') {
        await InventoryAPI.bootstrap?.();
        jobs.push(InventoryAPI.ensureFresh?.(['warehouses','warehouseLocations','inventoryLots','inventory'], { force: false }));
      }
      await Promise.allSettled(jobs.filter(Boolean));
    } catch (err) {
      console.warn('[FQC] Không tải đủ dữ liệu server:', err);
      Toast.err('Không tải được phiếu QC', 'Vui lòng thử lại. Không mở dữ liệu cũ để tránh kiểm tra sai.');
      return;
    }
    if (typeof openFinalInspectionModal === 'function') openFinalInspectionModal(d.id);
  },
  'fqc-save': (d) => {
    const ins = (DB.productionFinalInspections || []).find(x => x.id === d.id); if (!ins) return;
    if ((ins.status || 'PENDING') !== 'PENDING') { Toast.warn('Phiếu QC đã xử lý', ins.id); return; }
    const po = Q.po(ins.productionOrderId); if (!po) { Toast.err('Không tìm thấy LSX', ins.productionOrderId); return; }
    const row = (DB.inventory || []).find(r => r.productId === ins.productId && r.lotId === ins.lotId && r.warehouseId === ins.warehouseId);
    const lot = Q.lot(ins.lotId);
    const total = Number(ins.qty || row?.qtyPending || po.qty || 0);
    const pass = Math.max(0, Number($('#fqcPass')?.value || 0));
    const fail = Math.max(0, Number($('#fqcFail')?.value || 0));
    if (Math.abs((pass + fail) - total) > 0.0001) { Toast.err('Số lượng QC chưa hợp lệ', `Đạt + không đạt phải bằng ${fmtN(total)} ${po.unit}.`); return; }
    if (!row || !lot) { Toast.err('Thiếu dữ liệu lô chờ QC', 'Không tìm thấy tồn chờ QC của thành phẩm này.'); return; }

    const before = Number(row.qtyOnHand || 0);
    row.qtyPending = 0;
    row.qtyRejected = 0;
    row.qtyOnHand = Math.round((before + pass) * 10000) / 10000;
    row.qtyAvailable = Math.max(0, Math.round((row.qtyOnHand - Number(row.qtyReserved || 0)) * 10000) / 10000);
    row.lastUpdated = new Date().toISOString();
    lot.qcStatus = pass > 0 ? (fail > 0 ? 'PARTIAL_FAILED' : 'PASSED') : 'FAILED';

    // Thành phẩm không đạt được chuyển vật lý sang Kho Hàng lỗi, không nằm trong tồn khả dụng thành phẩm.
    let defectLotId = '';
    let defectWarehouseId = '';
    if (fail > 0) {
      const defectWh = (DB.warehouses || []).find(w => w.type === 'DEFECTIVE' && w.status !== 'inactive');
      const defectLoc = (DB.warehouseLocations || []).find(l => l.warehouseId === defectWh?.id && l.status !== 'inactive');
      if (!defectWh || !defectLoc) { Toast.err('Thiếu cấu hình Kho Hàng lỗi', 'Cần có kho loại DEFECTIVE và vị trí lưu để ghi nhận thành phẩm QC không đạt.'); return; }
      const defectLot = {
        id: nextCode('LOT-', DB.inventoryLots || []),
        lotNumber: `${ins.lotNumber || lot.lotNumber || po.id}-DEF`,
        productId: po.productId, productionOrderId: po.id, sourceLotId: ins.lotId,
        mfgDate: lot.mfgDate || currentDateYMD(), expiryDate: lot.expiryDate || addDays(currentDateYMD(),7),
        supplierLot:'', supplierId:'', qcStatus:'FAILED', status:'active', createdAt:new Date().toISOString()
      };
      DB.inventoryLots.unshift(defectLot);
      DB.inventory.unshift({
        productId:po.productId, warehouseId:defectWh.id, locationId:defectLoc.id, lotId:defectLot.id,
        qtyOnHand:fail, qtyPending:0, qtyRejected:fail, qtyReserved:0, qtyAvailable:0,
        unit:po.unit, sourceType:'PRODUCTION_QC', sourceId:ins.id, productionOrderId:po.id, lastUpdated:new Date().toISOString()
      });
      DB.inventoryTransactions.unshift({
        id:nextCode('TX-',DB.inventoryTransactions||[]), transactionNumber:ins.id, type:'PRODUCTION_QC_DEFECT',
        productId:po.productId, warehouseId:defectWh.id, locationId:defectLoc.id, lotId:defectLot.id, qty:fail,
        qtyBefore:0, qtyAfter:fail, refType:'FINAL_QC', refId:ins.id, userId:DB.currentUser?.id||'', date:currentDateYMD(),
        note:`Thành phẩm không đạt QC từ ${po.id}`
      });
      defectLotId = defectLot.id; defectWarehouseId = defectWh.id;
      ins.defectLotId = defectLotId; ins.defectWarehouseId = defectWarehouseId;
    }

    ins.passQty = pass; ins.failQty = fail; ins.note = $('#fqcNote')?.value.trim() || '';
    ins.status = pass > 0 ? (fail > 0 ? 'PARTIAL_FAILED' : 'PASSED') : 'FAILED';
    ins.inspectedAt = new Date().toISOString();
    ins.inspectedBy = DB.currentUser?.userId || DB.currentUser?.id || '';
    ins.inspectedByName = DB.currentUser?.name || Q.employeeName(ins.inspectedBy) || 'QC/QA';

    po.qcPass = pass; po.qcFail = fail; po.qcNote = ins.note; po.qcAt = ins.inspectedAt;
    po.qcBy = ins.inspectedBy; po.qcByName = ins.inspectedByName;
    const qcIndex = (po.stages || []).findIndex((st, idx) => typeof isFinalQcStage === 'function' ? isFinalQcStage(po, idx) : /QC — ATTP/i.test(String(st.name || '')));
    if (qcIndex >= 0) {
      const qc = po.stages[qcIndex]; qc.qtyDone = total; qc.status = 'done'; qc.end = currentDateYMD(); qc.note = ins.note;
      const doneStage = po.stages[qcIndex + 1];
      if (doneStage) { doneStage.qtyPlan = pass; doneStage.qtyDone = pass; doneStage.status = 'done'; doneStage.start = currentDateYMD(); doneStage.end = currentDateYMD(); }
    }
    po.completedAt = new Date().toISOString();

    let receiptId = '';
    if (pass > 0) {
      receiptId = nextCode('PN-2026-', DB.goodsReceipts || []);
      const receivedAt = new Date().toISOString();
      DB.goodsReceipts.unshift({
        id:receiptId, poId:'', prId:'', productionOrderId:po.id, finalInspectionId:ins.id,
        sourceType:'PRODUCTION_FINAL_QC', refType:'PRODUCTION_ORDER', refId:po.id,
        date:currentDateYMD(), receivedAt, receivedBy:DB.currentUser?.id || DB.currentUser?.userId || '',
        warehouse:Q.warehouseName(ins.warehouseId), warehouseId:ins.warehouseId, locationId:ins.locationId, location:Q.locationName(ins.locationId),
        status:'RECEIVED', inspectionStatus:ins.status, note:`Nhập thành phẩm đạt QC từ ${po.id}`,
        items:[{ materialId:po.productId, productId:po.productId, name:po.productName, unit:po.unit, qty:pass, rejectedQty:fail,
          lotId:ins.lotId, lotNumber:ins.lotNumber, productionOrderId:po.id, finalInspectionId:ins.id,
          mfgDate:lot.mfgDate, expiryDate:lot.expiryDate, locationId:ins.locationId }]
      });
      DB.inventoryTransactions.unshift({
        id:nextCode('TX-',DB.inventoryTransactions||[]), transactionNumber:receiptId, type:'PRODUCTION_QC_RECEIPT',
        productId:po.productId, warehouseId:ins.warehouseId, locationId:ins.locationId, lotId:ins.lotId, qty:pass,
        qtyBefore:before, qtyAfter:row.qtyOnHand, refType:'PRODUCTION_ORDER', refId:po.id,
        receiptId, finalInspectionId:ins.id, userId:DB.currentUser?.id||DB.currentUser?.userId||'',
        date:currentDateYMD(), createdAt:receivedAt, note:`Nhập kho thành phẩm từ ${po.id} · QC ${ins.id} · ${fmtN(pass)} ${po.unit}`
      });
      po.finishedReceiptId = receiptId; po.receivedQty = pass; po.receivedAt = new Date().toISOString(); po.status = 'lsx_da_nhap_kho';
    } else {
      po.status = 'lsx_hoan_thanh';
    }
    syncOrderStatus(po.orderId);
    logActivity('QC thành phẩm', po.id, `Đạt ${fmtN(pass)} · lỗi ${fmtN(fail)} ${po.unit}`, 'fa-clipboard-check', fail ? 'orange' : 'green');

    // Đóng form và cập nhật UI ngay. Các bước ghi KIO chạy sau khi browser đã có
    // cơ hội paint frame mới, tránh cảm giác bấm Xác nhận rồi giao diện bị đơ.
    Modal.close(); render();
    Toast.info('Đang lưu kết quả QC', `${po.id} · đang đồng bộ dữ liệu lên server...`);
    requestAnimationFrame(() => setTimeout(async () => {
      try {
        // Chỉ ghi đúng các collection đã thay đổi; không quét/sync toàn Production.
        if (typeof ProductionAPI !== 'undefined') {
          ProductionAPI.scheduleCollections?.(['productionOrders','productionFinalInspections']);
          const stageIdx = [qcIndex, qcIndex >= 0 ? qcIndex + 1 : -1].filter(i => i >= 0);
          if (stageIdx.length && ProductionAPI.persistStageProgress) {
            await ProductionAPI.persistStageProgress(po, stageIdx);
          }
        }
        // goodsReceipts thuộc PurchaseAPI (lenam_goods_receipts), không thuộc InventoryAPI.
        // Trước đây gọi InventoryAPI.scheduleCollections(['goodsReceipts', ...]) khiến key goodsReceipts bị bỏ qua,
        // nên phiếu nhập TP chỉ còn trong RAM và mất sau F5/logout. Ghi đúng từng collection lên server ngay tại đây.
        const persistJobs = [];
        if (receiptId && typeof PurchaseAPI !== 'undefined' && PurchaseAPI.syncCollections) {
          persistJobs.push(PurchaseAPI.syncCollections(['goodsReceipts']));
        }
        if (typeof InventoryAPI !== 'undefined' && InventoryAPI.syncCollections) {
          persistJobs.push(InventoryAPI.syncCollections(['inventoryLots','inventory','inventoryTransactions']));
        }
        if (persistJobs.length) await Promise.all(persistJobs);

        Toast.ok('Đã xác nhận QC thành phẩm', pass > 0 ? `${fmtN(pass)} ${po.unit} đã được nhập kho và lưu lịch sử${receiptId ? ` · ${receiptId}` : ''}.` : `Toàn bộ ${fmtN(fail)} ${po.unit} không đạt, không cộng tồn.`);
      } catch (err) {
        console.error('[FQC] Không lưu được kết quả QC lên server:', err);
        Toast.err('Chưa lưu được kết quả QC lên server', err?.message || 'Vui lòng thử lại.');
      }
    }, 0));
  },
  'po-fg-receipt': (d) => {
    const p = Q.po(d.id); if (!p) return;
    const ins = finalInspectionOfPO(p.id);
    if (ins && typeof openFinalInspectionModal === 'function') openFinalInspectionModal(ins.id);
    else Toast.info('Nhập kho theo QC thành phẩm', 'Thành phẩm chỉ được cộng tồn khi QC/QA xác nhận đạt.');
  },
  'po-fg-receipt-save': () => {
    Toast.info('Không nhập kho thủ công', 'Hãy thực hiện QC/QA → Kiểm tra thành phẩm. Số lượng đạt sẽ tự động cập nhật tồn kho thành phẩm.');
  },
  'po-create-pr': (d) => {
    const p = Q.po(d.id);
    const lacking = Q.materialCheck(p).filter((m) => !m.ok);
    if (!lacking.length) { Toast.info('Vật tư đã đủ', 'Không cần tạo yêu cầu mua hàng cho lệnh này.'); return; }
    const supplierId = Q.material(lacking[0].materialId).supplier;
    const items = lacking.map((m) => {
      const mat = Q.material(m.materialId);
      const qty = Math.ceil(m.lack + mat.minStock * 0.5);
      return { materialId: m.materialId, name: mat.name, unit: mat.unit, qty, price: mat.price, amount: qty * mat.price };
    });
    const pr = {
      id: nextCode('YCM-2026-', DB.purchases),
      requesterId: 'NV-018', supplierId, date: DB.today, status: 'mh_cho_duyet', items,
      reason: `Bổ sung vật tư thiếu cho lệnh sản xuất ${p.id} — ${p.productName}`,
      total: items.reduce((s, i) => s + i.amount, 0),
      expectedDate: addDays(DB.today, 7),
      receivedDate: '', approvedBy: '',
    };
    DB.purchases.unshift(pr);
    SEARCH_INDEX = null;
    logActivity('tạo yêu cầu mua hàng', pr.id, `${items.length} vật tư · ${fmtVND(pr.total)}`, 'fa-cart-plus', 'orange');
    pushNotification({ level: 'warning', icon: 'fa-cart-shopping', title: `Yêu cầu mua hàng ${pr.id} chờ duyệt`, desc: `${items.length} vật tư cho ${p.id} — ${fmtVND(pr.total)}`, go: { module: 'purchases', id: pr.id } });
    Modal.close();
    Toast.ok('Đã tạo yêu cầu mua hàng', `${pr.id} · ${fmtVND(pr.total)} — đang chờ phê duyệt`);
    setTimeout(() => { go('purchases'); openPRModal(pr.id); }, 400);
  },
  'export-po-detail': (d) => Exporter.pdf('Phieu-san-xuat-' + d.id),

  /* --- Danh mục công đoạn sản xuất --- */
  'open-operation': (d) => switchTo(() => openOperationModal(d.id)),
  'filter-op-new': () => { F('operations').source = 'quote'; State.page.operations = 1; render(); },
  'export-operations': () => Exporter.csv('Danh-muc-cong-doan-san-xuat.csv',
    ['Mã CĐ', 'Tên công đoạn', 'Phân xưởng', 'Máy / thiết bị', 'ĐVT', 'Đơn giá giờ', 'Số SP áp dụng', 'Nguồn'],
    DB.operations.map((o) => [o.id, o.name, o.workshop, o.machine, o.unit, o.rate, Q.productsUsingOp(o.id).length, o.source ? 'Báo giá ' + o.source : 'Danh mục gốc'])),

  /* --- Vật tư & kho --- */
  'open-material': (d) => switchTo(() => openMaterialModal(d.id)),

  // Legacy aliases: giữ để các nút/route cũ vẫn hoạt động, nhưng UI chính dùng inventory-item-* .
  'new-material': () => Actions['inventory-item-add']({ type: 'RAW_MATERIAL' }),
  'material-edit': (d) => Actions['inventory-item-edit']({ type: 'RAW_MATERIAL', id: d.id }),
  'material-delete': (d) => Actions['inventory-item-delete']({ type: 'RAW_MATERIAL', id: d.id }),
  'inventory-item-add': (d) => openInventoryItemForm(d.type || 'RAW_MATERIAL'),
  'inventory-item-edit': (d) => openInventoryItemForm(d.type || 'RAW_MATERIAL', d.id),
  'inventory-item-view': (d) => openInventoryMasterDetail(d.type || 'RAW_MATERIAL', d.id),
  'inventory-item-save': async (d) => {
    const type=d.type || 'RAW_MATERIAL';
    const name=$('#invItemName')?.value.trim() || '';
    const category=$('#invItemCategory')?.value || '';
    const unit=$('#invItemUnit')?.value.trim() || '';
    if(!name || !category || !unit){Toast.err('Thiếu thông tin','Vui lòng nhập tên, danh mục và đơn vị tính.');return;}
    const isRaw=type==='RAW_MATERIAL', isSemi=type==='SEMI_FINISHED';
    let arr=isRaw?DB.materials:isSemi?(DB.semiFinishedProducts||(DB.semiFinishedProducts=[])):DB.products;
    if(isSemi && d.id && (DB.products||[]).some(x=>x.id===d.id)) arr=DB.products;
    const id=d.id || nextInventoryMasterCode(type, category);
    let item=arr.find(x=>x.id===d.id || x.id===id);
    if(!item){
      const allIds=[...(DB.materials||[]),...(DB.semiFinishedProducts||[]),...(DB.products||[])].map(x=>x.id);
      if(allIds.includes(id)){Toast.err('Trùng mã hàng',`${id} đã tồn tại.`);return;}
      item={id}; arr.unshift(item);
    }
    const priceValue=Number(String($('#invItemPrice')?.value||'').replace(/[^0-9]/g,''))||0;
    // Số lượng ban đầu chỉ áp dụng khi TẠO MỚI nguyên liệu hoặc thành phẩm.
    // Đây là tồn đầu kỳ, không thay đổi luồng PR -> PO -> Nhập kho hay luồng Sản xuất hiện tại.
    const canOpeningStock = !d.id && (isRaw || type === 'FINISHED_GOODS');
    const openingQty = canOpeningStock ? Number($('#invItemOpeningQty')?.value || 0) : 0;
    if (!Number.isFinite(openingQty) || openingQty < 0) {
      Toast.err('Số lượng không hợp lệ', 'Số lượng ban đầu phải lớn hơn hoặc bằng 0.');
      return;
    }
    // Hạn dùng mặc định + ngưỡng cảnh báo áp dụng cho mọi loại hàng (NL / BTP / TP).
    const commonShelfLife = Number($('#invItemShelfLifeDays')?.value || 0);
    const commonWarnDays = Number($('#invItemExpiryWarnDays')?.value || 0);
    if (!Number.isInteger(commonShelfLife) || commonShelfLife < 0 || !Number.isInteger(commonWarnDays) || commonWarnDays < 0) {
      Toast.err('Hạn sử dụng không hợp lệ', 'Số ngày hạn sử dụng và ngày cảnh báo phải là số nguyên lớn hơn hoặc bằng 0.');
      return;
    }
    Object.assign(item,{name,unit,price:priceValue,category});
    item.shelfLifeDays=commonShelfLife; item.expiryWarnDays=commonWarnDays;
    if(isRaw){
      item.group=category;
      item.minStock=Number($('#invItemMinStock')?.value||0);
      item.maxStock=item.maxStock??null;
      // Master nguyên liệu không gắn NCC/kho/vị trí mặc định. Tồn chỉ phát sinh khi có phiếu nhập kho.
      if(!d.id) item.stock=0;
      item.stock=Number(item.stock||0);
      delete item.supplier; delete item.supplierId;
      delete item.warehouseId; delete item.zone; delete item.locationId; delete item.location;
      delete item.status; delete item.value;
      Object.defineProperty(item,'status',{enumerable:true,configurable:true,get(){if(Number(this.stock||0)<=0)return 'vt_het_hang';if(Number(this.stock||0)<Number(this.minStock||0))return 'vt_sap_het';return 'vt_du_ton';}});
      Object.defineProperty(item,'value',{enumerable:true,configurable:true,get(){return Number(this.stock||0)*Number(this.price||0);}});

      // Nếu người dùng nhập số lượng lúc tạo mới, ghi nhận một giao dịch TỒN ĐẦU KỲ.
      // Dùng InventoryService hiện hữu để không tạo thêm một nhánh xử lý tồn kho mới.
      if (!d.id && openingQty > 0) {
        const rawWarehouse = (DB.warehouses || []).find(w => w.type === 'RAW_MATERIAL' && w.status !== 'inactive')
          || (DB.warehouses || []).find(w => w.type === 'RAW_MATERIAL')
          || { id: 'WH-001' };
        const openingResult = InventoryService.apply({
          productId: id,
          warehouseId: rawWarehouse.id,
          locationId: '',
          lotId: '',
          quantity: openingQty,
          type: 'ADJUSTMENT_IN',
          refType: 'MASTER_OPENING',
          refId: id,
          note: `Tồn đầu kỳ khi tạo master ${id}`,
          userId: DB.currentUser.id,
          updateMaterial: true,
        });
        if (!openingResult.ok) {
          // Rollback master vừa thêm nếu không thể ghi nhận tồn đầu kỳ.
          DB.materials = DB.materials.filter(x => x.id !== id);
          Toast.err('Không thể ghi nhận tồn đầu kỳ', openingResult.message || 'Vui lòng kiểm tra lại số lượng.');
          return;
        }
      }
    } else {
      item.spec=$('#invItemSpec')?.value.trim()||item.spec||'';
      if(isSemi) item.minStock=Number($('#invItemMinStock')?.value||0);
      else {
        // [FINISHED GOODS MASTER] Khối lượng đóng gói lưu theo gram để dễ khai báo,
        // đồng thời duy trì packedWeightKg tương thích với Sales/Logistics hiện hữu.
        const unitIsKg = /^\s*kg\s*$/i.test(unit);
        const packedWeightG = unitIsKg ? 0 : Number($('#invItemPackedWeightG')?.value || 0);
        const shelfLifeDays = Number($('#invItemShelfLifeDays')?.value || 0);
        if (!Number.isFinite(packedWeightG) || packedWeightG < 0) {
          Toast.err('Khối lượng không hợp lệ', 'Khối lượng đóng gói phải lớn hơn hoặc bằng 0 gram.');
          return;
        }
        if (!Number.isFinite(shelfLifeDays) || shelfLifeDays < 0 || !Number.isInteger(shelfLifeDays)) {
          Toast.err('Hạn sử dụng không hợp lệ', 'Số ngày hạn sử dụng phải là số nguyên lớn hơn hoặc bằng 0.');
          return;
        }
        item.packedWeightG = packedWeightG;
        item.packedWeightKg = Math.round((packedWeightG / 1000) * 1000000) / 1000000;
        item.shelfLifeDays = shelfLifeDays;
        DB.finishedMinStock=DB.finishedMinStock||{};
        DB.finishedMinStock[id]=Number($('#invItemMinStock')?.value||0);
        item.bom=item.bom||[];
        item.routing=item.routing||[];

        // Thành phẩm tạo mới có thể khai báo tồn đầu kỳ giống nguyên liệu.
        // Khác nguyên liệu, thành phẩm cần một lô để phục vụ truy xuất và xuất bán FEFO.
        if (!d.id && openingQty > 0) {
          const fgWarehouse = (DB.warehouses || []).find(w => w.type === 'FINISHED_GOODS' && w.status !== 'inactive')
            || (DB.warehouses || []).find(w => w.type === 'FINISHED_GOODS');
          if (!fgWarehouse) {
            DB.products = DB.products.filter(x => x.id !== id);
            delete DB.finishedMinStock[id];
            Toast.err('Chưa có Kho thành phẩm', 'Không thể ghi nhận tồn đầu kỳ vì hệ thống chưa có kho FINISHED_GOODS.');
            return;
          }
          const fgLocation = (Q.locationsOf(fgWarehouse.id) || [])[0] || null;
          const actualToday = typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0, 10);
          const lotId = nextCode('LOT-', DB.inventoryLots || []);
          const lotNumber = `OPEN-${String(id).replace(/[^A-Z0-9]/gi,'')}-${actualToday.replace(/-/g,'')}`;
          const openingLot = {
            id: lotId,
            lotNumber,
            productId: id,
            productionOrderId: '',
            mfgDate: actualToday,
            expiryDate: Number(item.shelfLifeDays||0) > 0 ? addDays(actualToday, Number(item.shelfLifeDays)) : '',
            supplierLot: 'TỒN-ĐẦU-KỲ',
            supplierId: '',
            qcStatus: 'PASSED',
            status: 'active',
            createdAt: new Date().toISOString(),
          };
          DB.inventoryLots.unshift(openingLot);
          const openingResult = InventoryService.apply({
            productId: id,
            warehouseId: fgWarehouse.id,
            locationId: fgLocation?.id || '',
            lotId,
            quantity: openingQty,
            type: 'ADJUSTMENT_IN',
            refType: 'MASTER_OPENING',
            refId: id,
            note: `Tồn đầu kỳ thành phẩm khi tạo master ${id}`,
            userId: DB.currentUser.id,
            updateMaterial: false,
          });
          if (!openingResult.ok) {
            DB.inventoryLots = DB.inventoryLots.filter(x => x.id !== lotId);
            DB.products = DB.products.filter(x => x.id !== id);
            delete DB.finishedMinStock[id];
            Toast.err('Không thể ghi nhận tồn đầu kỳ', openingResult.message || 'Vui lòng kiểm tra lại số lượng.');
            return;
          }
        }
      }
    }
    // UI đã chốt chỉ dùng một màn Tồn kho có 3 subtab ngang.
    // Sau khi lưu master, luôn quay về #warehouse/inventory và chọn đúng subtab.
    const inventoryFilter = F('inventory', {
      q: '', stockTab: 'raw', warehouse: '', category: '', stockStatus: '', expandedProductId: ''
    });
    inventoryFilter.q = '';
    inventoryFilter.category = '';
    inventoryFilter.stockStatus = '';
    inventoryFilter.warehouse = '';
    inventoryFilter.stockTab = isRaw ? 'raw' : isSemi ? 'semi' : 'finished';
    State.page.inventory = 1;
    // [PERFORMANCE] Lưu state/cache ngay để nút Lưu phản hồi tức thì.
    // KIO bắt đầu đồng bộ đúng các collection ngay ở tick kế tiếp; không đổi nghiệp vụ.
    if(typeof InventoryAPI!=='undefined') {
      InventoryAPI.cacheCurrent?.();
      // Master mới chỉ ghi đúng record vừa tạo/sửa. Với tồn đầu kỳ chỉ ghi thêm
      // balance/transaction/lô vừa phát sinh; không full-sync cả bảng Kho.
      try {
        const isNewMaster = !d.id;
        const persistRecord = (key, rows) => isNewMaster && InventoryAPI.appendRecords
          ? InventoryAPI.appendRecords(key, rows)
          : InventoryAPI.syncRecords?.(key, rows);
        if (isRaw) await persistRecord('materials', [item]);
        else if (isSemi) await persistRecord('semiFinishedProducts', [item]);
        else {
          // Thành phẩm mới append thẳng lên server, không LIST toàn bộ lenam_finished_products.
          // Await hoàn tất trước khi đóng modal/F5 để không còn tình trạng vừa thêm xong bị mất.
          await persistRecord('products', [item]);
          InventoryAPI.scheduleCollections(['settings'], 0);
        }
        if (openingQty > 0) {
          const openingRows=(DB.inventory||[]).filter(r=>r.productId===id && String(r.sourceType||'')!=='LOGISTICS_TEST_DATA');
          const openingTx=(DB.inventoryTransactions||[]).filter(t=>t.productId===id && t.refType==='MASTER_OPENING' && t.refId===id);
          const openingLots=type==='FINISHED_GOODS'
            ? (DB.inventoryLots||[]).filter(l=>l.productId===id && String(l.supplierLot||'')==='TỒN-ĐẦU-KỲ') : [];
          // Ba bảng độc lập: ghi song song. Với record mới dùng append nên không quét bảng trước.
          const jobs=[];
          if(openingLots.length) jobs.push(persistRecord('inventoryLots', openingLots));
          if(openingRows.length) jobs.push(persistRecord('inventory', openingRows));
          if(openingTx.length) jobs.push(persistRecord('inventoryTransactions', openingTx));
          if(jobs.length) await Promise.all(jobs);
        }
      } catch(err) {
        Toast.err('Không lưu được dữ liệu Kho', err?.message || 'Vui lòng thử lại.');
        return;
      }
    }
    Modal.close();
    go('warehouse', { tab: 'inventory' });
    Toast.ok(d.id?'Đã cập nhật hàng hóa':'Đã thêm hàng hóa',`${id} · ${name}`);
  },
  'stock-period-tab': (d) => { const f=F('invPeriod'); f.tab=d.type||'RAW_MATERIAL'; f.warehouse=''; f.q=''; State.page.invPeriod=1; render(); },
  'stock-period-today': () => { const f=F('invPeriod'); const t=inventoryStockPeriodToday(); f.dateFrom=t; f.dateTo=t; State.page.invPeriod=1; render(); },
  'shelf-life-tab': (d) => { const f=F('shelfLife'); f.type=d.type||'RAW_MATERIAL'; f.q=''; f.status=''; State.page.shelfLife=1; render(); },
  'shelf-life-save': async (d) => {
    const item=inventoryMasterItem(d.id); if(!item){Toast.err('Không tìm thấy hàng hóa',d.id||'');return;}
    const sel=(window.CSS&&CSS.escape)?CSS.escape(d.id):String(d.id).replace(/"/g,'');
    const days=Number(document.querySelector(`[data-sl-days="${sel}"]`)?.value||0);
    const warn=Number(document.querySelector(`[data-sl-warn="${sel}"]`)?.value||0);
    if(!Number.isInteger(days)||days<0||!Number.isInteger(warn)||warn<0){Toast.err('Giá trị không hợp lệ','Số ngày phải là số nguyên lớn hơn hoặc bằng 0.');return;}
    item.shelfLifeDays=days; item.expiryWarnDays=warn;
    try{
      if(typeof InventoryAPI!=='undefined'){
        InventoryAPI.cacheCurrent?.();
        const key=(DB.materials||[]).includes(item)?'materials':(DB.semiFinishedProducts||[]).includes(item)?'semiFinishedProducts':'products';
        await InventoryAPI.syncRecords?.(key,[item]);
      }
    }catch(err){Toast.err('Không lưu được cấu hình hạn dùng',err?.message||'Vui lòng thử lại.');return;}
    Toast.ok('Đã lưu hạn dùng',`${item.name||d.id} · ${days>0?days+' ngày':'chưa quy định'}`);
    render();
  },
  'inventory-item-delete': async (d) => {
    const type=d.type||'RAW_MATERIAL'; const item=inventoryMasterItem(d.id); if(!item)return;
    const usedBom=type==='RAW_MATERIAL' && (DB.products||[]).some(p=>(p.bom||[]).some(([mid])=>mid===d.id));
    const inPR=(DB.purchases||[]).some(pr=>(pr.items||[]).some(it=>String(it.materialId||it.productId||it.id||'')===String(d.id)));
    const inPO=(DB.purchaseOrders||[]).some(po=>(po.items||[]).some(it=>String(it.materialId||it.productId||it.id||'')===String(d.id)));
    const inProductionRequest=(DB.productionMaterialRequests||[]).some(r=>(r.items||[]).some(it=>String(it.materialId||it.mid||it.productId||'')===String(d.id)));
    if(usedBom||inPR||inPO||inProductionRequest){
      Toast.err('Không thể xóa master',`${item.name} đã được dùng trong BOM, yêu cầu mua/đơn mua hoặc yêu cầu NVL sản xuất.`);return;
    }
    const stockRows=(DB.inventory||[]).filter(r=>r.productId===d.id);
    const txRows=(DB.inventoryTransactions||[]).filter(t=>t.productId===d.id);
    const lotRows=(DB.inventoryLots||[]).filter(l=>l.productId===d.id);
    const onlyOpening=txRows.every(t=>t.refType==='MASTER_OPENING' && t.refId===d.id);
    if((stockRows.length||txRows.length||lotRows.length) && !onlyOpening){
      Toast.err('Không thể xóa master',`${item.name} đã có phát sinh kho thực tế. Chỉ tồn đầu kỳ lúc tạo master mới được phép xóa cùng nguyên liệu.`);return;
    }
    if(!confirm(`Xóa ${d.id} - ${item.name}?${stockRows.length?' Tồn đầu kỳ liên quan cũng sẽ được xóa.':''}`))return;
    const key=type==='RAW_MATERIAL'?'materials':type==='SEMI_FINISHED'?'semiFinishedProducts':'products';
    try {
      if(typeof InventoryAPI==='undefined') throw new Error('InventoryAPI chưa sẵn sàng');
      if(stockRows.length) await InventoryAPI.deleteCollectionKeys?.('inventory',stockRows.map(r=>r.id).filter(Boolean));
      if(txRows.length) await InventoryAPI.deleteCollectionKeys?.('inventoryTransactions',txRows.map(r=>r.id).filter(Boolean));
      if(lotRows.length) await InventoryAPI.deleteCollectionKeys?.('inventoryLots',lotRows.map(r=>r.id).filter(Boolean));
      await InventoryAPI.deleteCollectionKey(key,d.id);
      DB.inventory=(DB.inventory||[]).filter(r=>r.productId!==d.id);
      DB.inventoryTransactions=(DB.inventoryTransactions||[]).filter(t=>t.productId!==d.id);
      DB.inventoryLots=(DB.inventoryLots||[]).filter(l=>l.productId!==d.id);
      if(type==='RAW_MATERIAL')DB.materials=DB.materials.filter(x=>x.id!==d.id);
      else if(type==='SEMI_FINISHED')DB.semiFinishedProducts=(DB.semiFinishedProducts||[]).filter(x=>x.id!==d.id);
      else {DB.products=DB.products.filter(x=>x.id!==d.id); if(DB.finishedMinStock)delete DB.finishedMinStock[d.id];}
      InventoryAPI.cacheCurrent?.();
      Modal.close(); render(); Toast.ok('Đã xóa master hàng hóa',`${d.id} · ${item.name} · đã xóa trên server`);
    } catch(err) { Toast.err('Không xóa được trên server',err?.message||'Vui lòng thử lại.'); }
  },
  'item-category-manager': (d) => openItemCategoryManager(d.type || 'RAW_MATERIAL'),
  'item-category-add': async (d) => {
    const type=d.type || document.querySelector('[data-category-manager-type]')?.dataset.categoryManagerType || 'RAW_MATERIAL';
    const name=$('#newItemCategoryName')?.value.trim()||'';
    if(!name){Toast.err('Thiếu tên danh mục','Vui lòng nhập tên danh mục.');return;}
    DB.itemCategories=DB.itemCategories||[];
    if(DB.itemCategories.some(c=>c.type===type && String(c.name).trim().toLowerCase()===name.toLowerCase())){Toast.err('Danh mục đã tồn tại',name);return;}
    const tablePrefix=type==='RAW_MATERIAL'?'CAT-RAW-':type==='SEMI_FINISHED'?'CAT-SEMI-':'CAT-FIN-';
    const current=DB.itemCategories.filter(c=>c.type===type && String(c.id||'').startsWith(tablePrefix));
    const id=nextCode(tablePrefix,current,3);
    const typedPrefix=String($('#newItemCategoryPrefix')?.value||'').trim();
    const codePrefix=(typedPrefix || inventoryCategoryCodePrefix(type,name)).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    if(!codePrefix){Toast.err('Mã viết tắt không hợp lệ','Ví dụ: BB, NLC, PG.');return;}
    if(DB.itemCategories.some(c=>c.type===type && String(c.codePrefix||'').toUpperCase()===codePrefix)){Toast.err('Trùng mã viết tắt',`${codePrefix} đã được dùng cho danh mục khác.`);return;}
    DB.itemCategories.push({id,type,name,codePrefix,status:'active'});
    if(typeof InventoryAPI!=='undefined') await InventoryAPI.syncCollections(['itemCategories']);
    openItemCategoryManager(type);
    Toast.ok('Đã thêm danh mục',`${name} · mã ${codePrefix}`);
  },
  'item-category-prefix-save': async (d) => {
    const cat=(DB.itemCategories||[]).find(c=>c.id===d.id); if(!cat)return;
    const input=document.querySelector(`.category-prefix-input[data-id="${CSS.escape(d.id)}"]`);
    const codePrefix=String(input?.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    if(!codePrefix){Toast.err('Mã viết tắt không hợp lệ','Vui lòng nhập mã như BB, NLC, BTP.');return;}
    cat.codePrefix=codePrefix;
    if(typeof InventoryAPI!=='undefined') await InventoryAPI.syncCollections(['itemCategories']);
    openItemCategoryManager(cat.type); Toast.ok('Đã cập nhật mã danh mục',`${cat.name} → ${codePrefix}`);
  },
  'item-category-delete': async (d) => {
    const cat=(DB.itemCategories||[]).find(c=>c.id===d.id); if(!cat)return;
    const used=cat.type==='RAW_MATERIAL'?(DB.materials||[]).some(x=>x.group===cat.name):cat.type==='SEMI_FINISHED'?(DB.semiFinishedProducts||[]).some(x=>x.category===cat.name):(DB.products||[]).some(x=>x.category===cat.name);
    if(used){Toast.err('Không thể xóa danh mục',`Danh mục ${cat.name} đang được hàng hóa sử dụng.`);return;}
    if(!confirm(`Xóa danh mục ${cat.name}?`))return;
    DB.itemCategories=DB.itemCategories.filter(c=>c.id!==d.id);
    if(typeof InventoryAPI!=='undefined') await InventoryAPI.syncCollections(['itemCategories']);
    openItemCategoryManager(cat.type); Toast.ok('Đã xóa danh mục',cat.name);
  },
  'stock-move': (d) => switchTo(() => openStockMoveModal(d.id)),
  'stock-move-save': (d) => {
    const m = Q.material(d.id);
    const type = $('#smType').value;
    const qty = Number($('#smQty').value) || 0;
    if (qty <= 0) { Toast.err('Số lượng không hợp lệ', 'Vui lòng nhập số lượng lớn hơn 0.'); return; }
    if (type === 'out' && qty > m.stock) { Toast.err('Không đủ tồn kho', `Tồn hiện tại chỉ còn ${fmtDec(m.stock, 2)} ${m.unit}.`); return; }
    let stockRow = DB.inventory.find((row) => row.productId === m.id);
    if (!stockRow) {
      stockRow = { productId: m.id, warehouseId: 'WH-001', locationId: 'LOC-001', lotId: '', qtyOnHand: m.stock, qtyReserved: 0, qtyAvailable: m.stock, unit: m.unit, lastUpdated: DB.today };
      DB.inventory.push(stockRow);
    }
    const posted = InventoryService.apply({
      productId: m.id, warehouseId: stockRow.warehouseId, locationId: stockRow.locationId, lotId: stockRow.lotId,
      quantity: qty, type: type === 'in' ? 'RECEIPT' : 'ISSUE', refType: 'MANUAL', refId: $('#smRef').value.trim() || '',
      note: $('#smNote').value.trim() || (type === 'in' ? 'Nhập kho thủ công' : 'Xuất kho thủ công'),
    });
    if (!posted.ok) { Toast.err('Không thể ghi phiếu', posted.message); return; }
    DB.stockMoves.unshift({
      id: nextCode(type === 'in' ? 'PN-2026-' : 'PX-2026-', DB.stockMoves.filter((x) => x.type === type)),
      type, date: $('#smDate').value || DB.today, materialId: m.id, qty,
      ref: $('#smRef').value.trim() || '—', by: 'NV-018', note: $('#smNote').value.trim() || (type === 'in' ? 'Nhập kho thủ công' : 'Xuất kho thủ công'),
    });
    logActivity(type === 'in' ? 'nhập kho' : 'xuất kho', m.id, `${fmtN(qty)} ${m.unit} · ${m.name}`, 'fa-right-left', type === 'in' ? 'green' : 'orange');
    Modal.close(); render();
    Toast.ok(type === 'in' ? 'Đã nhập kho' : 'Đã xuất kho', `${m.name} · ${fmtN(qty)} ${m.unit} — tồn mới ${fmtDec(m.stock, 2)} ${m.unit}`);
  },
  'material-request': async (d) => { await PurchasePRMasterData.ensure(); switchTo(() => openPRForm(d.id)); },
  'inv-warehouse-new': () => openWarehouseMasterForm(''),
  'inv-warehouse-view': (d) => openWarehouseMasterDetail(d.id),
  'inv-warehouse-edit': (d) => openWarehouseMasterForm(d.id),
  'inv-warehouse-delete': (d) => deleteWarehouseMaster(d.id || ''),
  'inv-warehouse-save': (d) => saveWarehouseMaster(d.id || ''),
  'inv-warehouse-site-open': (d) => { const f=F('inv-warehouses'); Object.assign(f,{siteId:d.id||'',zoneId:'',rackId:'',itemType:'',q:'',tab:'overview'}); render(); },
  'inv-warehouse-site-back': () => { const f=F('inv-warehouses'); Object.assign(f,{siteId:'',zoneId:'',rackId:'',itemType:'',q:'',tab:'overview'}); render(); },
  'inv-warehouse-tab': (d) => { const f=F('inv-warehouses'); f.tab=d.tab||'overview'; if(f.tab!=='zones')f.rackId=''; render(); },
  'inv-warehouse-zone-open': (d) => { const f=F('inv-warehouses'); f.siteId=d.site||f.siteId||''; f.zoneId=d.id||''; f.rackId=''; f.q=''; f.tab='zones'; render(); },
  'inv-warehouse-zone-new': (d) => openWarehouseZoneForm(d.site||F('inv-warehouses').siteId||'', ''),
  'inv-warehouse-zone-edit': (d) => openWarehouseZoneForm(d.site||F('inv-warehouses').siteId||'', d.id||''),
  'inv-warehouse-zone-save': (d) => saveWarehouseZone(d.site||'', d.id||''),
  'inv-warehouse-zone-filter-clear': () => { const f=F('inv-warehouses'); f.itemType=''; f.zoneId=''; f.rackId=''; f.q=''; render(); },
  'inv-warehouse-rack-new': (d) => openWarehouseRackForm(d.site||F('inv-warehouses').siteId||'', d.zone||F('inv-warehouses').zoneId||'', ''),
  'inv-warehouse-rack-edit': (d) => openWarehouseRackForm(d.site||F('inv-warehouses').siteId||'', d.zone||F('inv-warehouses').zoneId||'', d.id||''),
  'inv-warehouse-rack-save': (d) => saveWarehouseRack(d.site||'', d.zone||'', d.id||''),
  'inv-warehouse-rack-delete': (d) => deleteWarehouseRack(d.id||''),
  'inv-warehouse-rack-open': (d) => { const f=F('inv-warehouses'); f.rackId=d.id||''; f.tab='zones'; render(); },
  'inv-warehouse-rack-close': () => { const f=F('inv-warehouses'); f.rackId=''; render(); },
  'inv-new-receipt': async (d) => {
    if (d.tab && d.tab !== 'raw') { switchTo(() => openWarehouseReceiptModal(d.tab)); return; }
    // Luôn lấy PO/phiếu nhập hiện tại từ server TRƯỚC khi dựng dropdown.
    // Không dùng danh sách stale từ cache/dashboard rồi bắt user mở lại lần hai.
    try {
      const jobs = [];
      if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.ensureFresh) jobs.push(PurchaseAPI.ensureFresh(['purchaseOrders','goodsReceipts','suppliers'], {force:false}));
      if (typeof InventoryAPI !== 'undefined' && InventoryAPI.ensureFresh) jobs.push(InventoryAPI.ensureFresh(['warehouses','warehouseLocations','materials'], {force:true}));
      await Promise.all(jobs);
    } catch (err) {
      console.warn('[Warehouse] Không tải đủ dữ liệu lập phiếu nhập từ server:', err);
      Toast.err('Không tải được dữ liệu mới nhất', 'Vui lòng thử lại. Hệ thống không mở form bằng dữ liệu cũ.');
      return;
    }
    switchTo(() => openNewReceiptModal(d.poid || ''));
  },
  'inv-new-issue': (d) => switchTo(() => openNewIssueModal(d.tab || F('inv-issues').issueTab || 'raw')),
  'inv-new-transfer': (d) => switchTo(() => openNewTransferModal(d.type || State.invTransferType || 'RAW_MATERIAL')),
  'inv-new-count': () => Modal.open({
    title: 'Tạo phiếu kiểm kê kho', sub: 'Chốt số tồn hệ thống trước khi nhập số lượng thực tế',
    body: `<div class="form-grid"><div class="field"><label>Kho kiểm kê</label><select class="inp" id="countWarehouse">${DB.warehouses.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div><div class="field"><label>Ngày kiểm kê</label><input class="inp" type="date" id="countDate" value="${currentDateYMD()}" min="${currentDateYMD()}" /></div></div><div class="field"><label>Ghi chú</label><textarea class="inp" id="countNote" rows="2" placeholder="Ca kiểm kê, khu vực, người tham gia…"></textarea></div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="inv-count-save"><i class="fa-solid fa-clipboard-check"></i>Tạo phiếu kiểm kê</button>`,
  }),
  'inv-count-save': () => {
    const id = nextCode('KK-2026-', DB.inventoryCounts);
    const warehouseId = $('#countWarehouse').value;
    DB.inventoryCounts.unshift({ id, warehouseId, date: $('#countDate').value || DB.today, status: 'DRAFT', createdBy:DB.currentUser?.userId||DB.currentUser?.id||'', createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''), note: $('#countNote').value.trim(), items: DB.inventory.filter((row) => row.warehouseId === warehouseId).map((row) => ({ productId: row.productId, lotId: row.lotId, locationId: row.locationId, systemQty: row.qtyOnHand, actualQty: row.qtyOnHand, difference: 0, reason: '' })) });
    Modal.close(); go('inv-counts'); Toast.ok('Đã tạo phiếu kiểm kê', `${id} · Chốt tồn hệ thống thành công.`);
  },
  'inv-receipt-save-new': () => {
    const materialId = $('#grNewItems select[name="mat"]').value;
    const quantity = Number($('#grNewItems input[name="qty"]').value) || 0;
    const warehouseId = $('#grNewWarehouse').value;
    const location = Q.locationsOf(warehouseId)[0];
    const lotNumber = $('#grNewItems input[name="lot"]').value.trim();
    if (!location) { Toast.err('Kho chưa có vị trí', 'Vui lòng cấu hình vị trí lưu trữ trước khi nhập kho.'); return; }
    if (!lotNumber) { Toast.err('Thiếu số lô', 'Nguyên liệu và thành phẩm thực phẩm phải có số lô.'); return; }
    let lot = Q.lotByNumber(lotNumber);
    if (lot && lot.productId !== materialId) { Toast.err('Lô không hợp lệ', 'Số lô đã tồn tại nhưng không thuộc nguyên liệu đang nhập.'); return; }
    if (!lot) {
      lot = { id: nextCode('LOT-', DB.inventoryLots), lotNumber, productId: materialId, productionOrderId: $('#grNewType').value === 'PRODUCTION' ? $('#grNewRef').value.trim() : '', mfgDate: $('#grNewItems input[name="mfg"]').value, expiryDate: $('#grNewItems input[name="exp"]').value, supplierLot: '', supplierId: '', qcStatus: $('#grNewType').value === 'PURCHASE' ? 'QC_PENDING' : 'PASSED', status: 'active', createdAt: DB.today + ' 09:00' };
      DB.inventoryLots.unshift(lot);
    }
    const typeMap = { PURCHASE: 'RECEIPT', PRODUCTION: 'PRODUCTION_RECEIPT', ADJUSTMENT_IN: 'ADJUSTMENT_IN', RETURN_IN: 'RETURN_IN' };
    const receiptId = nextCode('PN-2026-', DB.goodsReceipts);
    const posted = InventoryService.apply({ productId: materialId, warehouseId, locationId: location.id, lotId: lot.id, quantity, type: typeMap[$('#grNewType').value], refType: $('#grNewType').value, refId: $('#grNewRef').value.trim() || receiptId, note: $('#grNewNote').value.trim() || 'Nhập kho theo chứng từ' });
    if (!posted.ok) { Toast.err('Không thể nhập kho', posted.message); return; }
    DB.goodsReceipts.unshift({ id: receiptId, poId: $('#grNewType').value === 'PURCHASE' ? $('#grNewRef').value.trim() : '', prId: '', date: $('#grNewDate').value || DB.today, receivedBy: DB.currentUser.id, createdBy:DB.currentUser?.userId||DB.currentUser?.id||'', createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''), warehouse: Q.warehouseName(warehouseId), warehouseId, status: 'RECEIVED', note: $('#grNewNote').value.trim(), items: [{ materialId, name: Q.material(materialId)?.name || Q.product(materialId)?.name || materialId, unit: posted.row.unit, qty: quantity, lotNumber, mfgDate: lot.mfgDate, expiryDate: lot.expiryDate, locationId: location.id }] });
    Modal.close(); go('inv-receipts'); Toast.ok('Đã nhập kho thành công', `${receiptId} · ${fmtDec(quantity, 2)} ${posted.row.unit}`);
  },
  'inv-issue-add-line': () => {
    const wrap = $('#giNewItems');
    if (!wrap) return;
    const options = decodeURIComponent(wrap.dataset.options || '');
    const first = wrap.querySelector('.gi-issue-line');
    const row = document.createElement('div');
    row.className = 'gi-issue-line';
    row.style.cssText = 'display:grid;grid-template-columns:minmax(280px,2fr) minmax(150px,1fr) 44px;gap:10px;align-items:center;margin-bottom:8px';
    row.innerHTML = `<select class="inp" name="product">${options}</select><input class="inp right num" name="qty" type="number" min="0.01" step="0.01" placeholder="Nhập số lượng" /><button type="button" class="btn btn-sm" data-act="inv-issue-remove-line" title="Xóa dòng"><i class="fa-solid fa-trash"></i></button>`;
    wrap.appendChild(row);
    if (first) first.querySelector('[data-act="inv-issue-remove-line"]')?.removeAttribute('disabled');
  },
  'inv-issue-remove-line': (d, el) => {
    const wrap = $('#giNewItems');
    const row = el?.closest('.gi-issue-line');
    if (!wrap || !row) return;
    const rows = wrap.querySelectorAll('.gi-issue-line');
    if (rows.length <= 1) return;
    row.remove();
    const remain = wrap.querySelectorAll('.gi-issue-line');
    if (remain.length === 1) remain[0].querySelector('[data-act="inv-issue-remove-line"]')?.setAttribute('disabled','');
  },
  'inv-issue-save-new': () => {
    const warehouseId = $('#giNewWarehouse')?.value || '';
    if (!warehouseId) { Toast.err('Chưa chọn khu xuất', 'Vui lòng chọn khu xuất kho.'); return; }
    const issueType = $('#giNewType')?.value || '';
    if (issueType === 'RETURN_OUT') { Toast.err('Không dùng phiếu xuất mới để trả NCC', 'Vui lòng xử lý từ Yêu cầu trả nguyên liệu tại Kho nguyên liệu.'); return; }

    const lines = $$('#giNewItems .gi-issue-line').map(row => ({
      productId: row.querySelector('select[name="product"]')?.value || '',
      quantity: Number(row.querySelector('input[name="qty"]')?.value) || 0
    }));
    if (!lines.length || lines.some(x => !x.productId)) { Toast.err('Chưa chọn đủ hàng xuất', 'Vui lòng chọn mặt hàng cho tất cả các dòng.'); return; }
    if (lines.some(x => x.quantity <= 0)) { Toast.err('Số lượng không hợp lệ', 'Số lượng xuất của tất cả các dòng phải lớn hơn 0.'); return; }
    const unique = new Set(lines.map(x=>x.productId));
    if (unique.size !== lines.length) { Toast.err('Mặt hàng bị trùng', 'Mỗi nguyên liệu / sản phẩm chỉ nên xuất hiện một lần trong phiếu. Hãy gộp số lượng vào cùng một dòng.'); return; }

    // Pha 1: kiểm tra đủ tồn cho TOÀN BỘ dòng trước khi trừ kho.
    const plans = [];
    for (const line of lines) {
      const candidates = DB.inventory
        .filter(r => r.productId === line.productId && r.warehouseId === warehouseId && Number(r.qtyAvailable ?? r.qtyOnHand ?? 0) > 0 && inventoryRowIsUsableForIssue(r))
        .sort(sortIssueRowsFefoFifo);
      const eligible = issueType === 'SALES_ISSUE'
        ? candidates.filter(row => { const lot=Q.lot(row.lotId); return lot && lot.qcStatus === 'PASSED' && (!lot.expiryDate || new Date(lot.expiryDate+'T00:00:00') > new Date(DB.today+'T00:00:00')); })
        : candidates;
      const totalAvailable = eligible.reduce((n,r)=>n+Number(r.qtyAvailable ?? r.qtyOnHand ?? 0),0);
      if (totalAvailable < line.quantity) {
        const item = Q.material(line.productId) || Q.product(line.productId);
        Toast.err('Không đủ tồn kho', `${item?.name || line.productId}: ${issueType === 'SALES_ISSUE' ? 'tồn đạt QC/còn hạn' : 'tồn khả dụng'} chỉ còn ${fmtN(totalAvailable)}, yêu cầu ${fmtN(line.quantity)}.`);
        return;
      }
      plans.push({ ...line, eligible });
    }

    const issueId = nextCode('PX-2026-', DB.goodsIssues);
    const items=[];
    for (const plan of plans) {
      let remaining=plan.quantity;
      for (const row of plan.eligible) {
        if (remaining <= 0) break;
        const available=Number(row.qtyAvailable ?? row.qtyOnHand ?? 0);
        const take=Math.min(remaining, available);
        if (!take) continue;
        const posted=InventoryService.apply({ productId:row.productId, warehouseId, locationId:row.locationId, lotId:row.lotId, quantity:take, type:issueType, refType:issueType, refId:$('#giNewRef').value.trim() || issueId, note:$('#giNewNote').value.trim() || 'Xuất kho theo chứng từ' });
        if (!posted.ok) { Toast.err('Không thể xuất kho', posted.message); return; }
        items.push({productId:row.productId,lotId:row.lotId,qty:take,locationId:row.locationId,unit:row.unit});
        remaining-=take;
      }
    }
    const totalQty = lines.reduce((n,x)=>n+x.quantity,0);
    DB.goodsIssues.unshift({ id:issueId, type:issueType, warehouseId, refDoc:$('#giNewRef').value.trim(), date:$('#giNewDate').value || DB.today, status:'COMPLETED', createdBy:DB.currentUser.id, note:$('#giNewNote').value.trim(), items });
    Modal.close(); go('inv-issues'); Toast.ok('Đã xuất kho thành công', `${issueId} · ${lines.length} mặt hàng · Tổng ${fmtN(totalQty)}`);
  },
  'inv-transfer-tab': (d) => {
    State.invTransferType = d.type || 'RAW_MATERIAL';
    render();
  },
  'inv-transfer-view': (d) => openTransferDetailModal(d.id),
  'inv-transfer-save-new': () => {
    const transferType = $('#ckTransferType')?.value || State.invTransferType || 'RAW_MATERIAL';
    const fromWarehouseId = $('#ckFromWh')?.value || '';
    const toWarehouseId = $('#ckToWh')?.value || '';
    if (!fromWarehouseId || !toWarehouseId) { Toast.err('Thiếu thông tin kho', 'Vui lòng chọn kho nguồn và kho đích.'); return; }
    if (fromWarehouseId === toWarehouseId) { Toast.err('Kho chuyển không hợp lệ', 'Kho nguồn và kho đích phải khác nhau.'); return; }
    const fromWh = Q.warehouse(fromWarehouseId);
    const toWh = Q.warehouse(toWarehouseId);
    const storeSupply = transferType === 'STORE';
    const validStoreSource = ['RAW_MATERIAL','SEMI_FINISHED','FINISHED_GOODS'].includes(fromWh?.type);
    const validType = storeSupply
      ? (validStoreSource && toWh?.type === 'STORE')
      : (fromWh?.type === transferType && toWh?.type === transferType);
    if (!fromWh || !toWh || !validType) {
      Toast.err('Sai loại kho', storeSupply
        ? 'Cấp hàng cửa hàng chỉ nhận từ Kho nguyên liệu / Bán thành phẩm / Thành phẩm và chuyển đến Kho cửa hàng.'
        : 'Chỉ được chuyển giữa các kho cùng loại trong tab hiện tại.'); return;
    }
    const destination = Q.locationsOf(toWarehouseId)[0];
    if (!destination) { Toast.err('Kho đích chưa có vị trí', 'Vui lòng cấu hình vị trí lưu trữ cho kho đích.'); return; }

    const selected = [];
    const usedKeys = new Set();
    for (const rowEl of $$('.ck-transfer-row')) {
      const key = rowEl.querySelector('.ck-stock-select')?.value || '';
      const quantity = Number(rowEl.querySelector('.ck-transfer-qty')?.value) || 0;
      if (!key && !quantity) continue;
      if (!key) { Toast.err('Chưa chọn hàng chuyển', 'Vui lòng chọn hàng hóa cho tất cả các dòng có số lượng.'); return; }
      if (quantity <= 0) { Toast.err('Số lượng không hợp lệ', 'Số lượng chuyển phải lớn hơn 0.'); return; }
      if (usedKeys.has(key)) { Toast.err('Hàng hóa bị trùng', 'Một lô/vị trí chỉ nên xuất hiện một lần trong phiếu chuyển kho.'); return; }
      usedKeys.add(key);
      const [productId, lotId, locationId] = key.split('|');
      const source = DB.inventory.find((inv) =>
        inv.productId === productId &&
        inv.warehouseId === fromWarehouseId &&
        inv.lotId === lotId &&
        inv.locationId === locationId
      );
      if (!source) { Toast.err('Không tìm thấy tồn kho nguồn', `${productId} không còn tại kho nguồn.`); return; }
      const available = Number(source.qtyAvailable ?? source.qtyOnHand ?? 0);
      if (quantity > available) { Toast.err('Số lượng vượt tồn', `${source.productId}: khả dụng ${fmtN(available)}, yêu cầu ${fmtN(quantity)}.`); return; }
      selected.push({ source, quantity });
    }
    if (!selected.length) { Toast.err('Chưa có hàng chuyển', 'Thêm ít nhất một hàng hóa và nhập số lượng lớn hơn 0.'); return; }

    const id = nextCode('CK-2026-', DB.stockTransfers);
    const items = [];
    for (const { source, quantity } of selected) {
      const out = InventoryService.apply({ productId: source.productId, warehouseId: fromWarehouseId, locationId: source.locationId, lotId: source.lotId, quantity, type: 'TRANSFER_OUT', refType: 'TRANSFER', refId: id, note: 'Xuất chuyển kho nội bộ' });
      if (!out.ok) { Toast.err('Không thể chuyển kho', out.message); return; }
      const incoming = InventoryService.apply({ productId: source.productId, warehouseId: toWarehouseId, locationId: destination.id, lotId: source.lotId, quantity, type: 'TRANSFER_IN', refType: 'TRANSFER', refId: id, note: 'Nhập chuyển kho nội bộ' });
      // Balance mới ở kho đích phải có khóa riêng theo hàng+kho+vị trí+lô.
      // Nếu dùng lotId làm khóa KIO, cùng một lô ở hai kho sẽ ghi đè nhau trên server.
      if (incoming.ok && incoming.row && !incoming.row.id) incoming.row.id = `BAL-${source.productId}-${toWarehouseId}-${destination.id}-${source.lotId || 'NOLOT'}`;
      if (!incoming.ok) { Toast.err('Không thể nhận tại kho đích', incoming.message); return; }
      items.push({ productId: source.productId, lotId: source.lotId, qty: quantity, fromLocationId: source.locationId, toLocationId: destination.id, unit: source.unit });
    }
    DB.stockTransfers.unshift({ id, transferType, fromWarehouseId, toWarehouseId, date: $('#ckDate').value || DB.today, status: 'RECEIVED', createdBy:DB.currentUser?.userId||DB.currentUser?.id||'', createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''), note: $('#ckNote').value.trim(), items });

    // Balance nguồn đã chuyển hết không còn giá trị tồn kho. Bỏ khỏi state và KIO
    // để F5 cũng không xuất hiện lại dòng 0. Không xóa lot master vì lô vẫn cần
    // cho lịch sử giao dịch và có thể đang còn tồn ở kho khác.
    const depleted = selected.map(x=>x.source).filter(r =>
      Number(r.qtyOnHand||0) <= 0.000001 &&
      Number(r.qtyPending||0) <= 0.000001 &&
      Number(r.qtyReserved||0) <= 0.000001
    );
    const depletedIds = depleted.map(r=>r.id).filter(Boolean);
    if (depleted.length) {
      const gone = new Set(depleted);
      DB.inventory = (DB.inventory||[]).filter(r => !gone.has(r));
      if (depletedIds.length) InventoryAPI?.deleteCollectionKeys?.('inventory', depletedIds).catch(err => console.warn('[Transfer] Không xóa được balance 0 trên KIO:', err));
    }
    InventoryAPI?.scheduleCollections?.(['stockTransfers','inventory','inventoryTransactions'], 40);
    Modal.close();
    State.invTransferType = transferType;
    // Phiếu chuyển kho đang nằm trong Kho -> Chuyển kho. Không điều hướng sang
    // route độc lập `inv-transfers` vì role Kho chỉ được cấp module `warehouse`
    // và việc điều hướng đó tạo toast "Không có quyền" dù giao dịch đã thành công.
    // Render ngay state vừa tạo để phiếu xuất hiện tức thì; InventoryAPI wrapper
    // sẽ đồng bộ stockTransfers + inventory + inventoryTransactions lên KIO/server.
    render();
    Toast.ok('Đã chuyển kho thành công', `${id} · ${items.length} dòng hàng`);
  },
  // [WAREHOUSE DASHBOARD INTERACTION]
  // Mọi KPI chỉ trỏ đến màn hình Kho đã có và đặt filter tương ứng.
  'warehouse-dashboard-open-inventory': async () => {
    const f = F('inventory'); f.stockStatus = ''; State.page.inventory = 1;
    try { await WarehouseInventoryPrimaryData.ensure(); } catch (err) { console.warn('[Warehouse] Không warm được Tồn kho:', err); }
    go('warehouse', { tab: 'inventory' });
  },
  'warehouse-dashboard-open-low': async () => {
    const f = F('inventory'); f.stockTab = 'raw'; f.stockStatus = 'LOW'; State.page.inventory = 1;
    try { await WarehouseInventoryPrimaryData.ensure(); } catch (err) { console.warn('[Warehouse] Không warm được Tồn kho:', err); }
    go('warehouse', { tab: 'inventory' });
  },
  'warehouse-dashboard-open-near-expiry': () => {
    const f = F('inv-lots'); f.expStatus = 'near_expiry'; State.page['inv-lots'] = 1;
    go('warehouse', { tab: 'batches' });
  },
  'warehouse-dashboard-open-expired': () => {
    const f = F('inv-lots'); f.expStatus = 'expired'; State.page['inv-lots'] = 1;
    go('warehouse', { tab: 'batches' });
  },
  'warehouse-alert-open-low': async () => {
    const f = F('inventory'); f.stockTab = 'raw'; f.stockStatus = 'LOW'; State.page.inventory = 1;
    try { await WarehouseInventoryPrimaryData.ensure(); } catch (err) { console.warn('[Warehouse] Không warm được Tồn kho:', err); }
    go('warehouse', { tab: 'inventory' });
  },
  'warehouse-alert-open-inventory': async () => {
    const f = F('inventory'); f.stockStatus = ''; State.page.inventory = 1;
    try { await WarehouseInventoryPrimaryData.ensure(); } catch (err) { console.warn('[Warehouse] Không warm được Tồn kho:', err); }
    go('warehouse', { tab: 'inventory' });
  },
  'inventory-dashboard-all': () => { F('inventory').stockStatus = ''; State.page.inventory = 1; delete State.transientFilters.warehouse; render(); },
  'inventory-dashboard-in': () => { F('inventory').stockStatus = 'IN'; State.page.inventory = 1; State.transientFilters.warehouse = { tab:'inventory', filterKey:'inventory', fields:['stockStatus'], pageKey:'inventory' }; render(); },
  'inventory-dashboard-low': () => { F('inventory').stockStatus = 'LOW'; State.page.inventory = 1; State.transientFilters.warehouse = { tab:'inventory', filterKey:'inventory', fields:['stockStatus'], pageKey:'inventory' }; render(); },
  'inventory-dashboard-out': () => { F('inventory').stockStatus = 'OUT'; State.page.inventory = 1; State.transientFilters.warehouse = { tab:'inventory', filterKey:'inventory', fields:['stockStatus'], pageKey:'inventory' }; render(); },
  'inventory-receipts-all': () => { F('inv-receipts').status = ''; State.page['inv-receipts'] = 1; render(); },
  'inventory-receipts-received': () => { F('inv-receipts').status = 'RECEIVED'; State.page['inv-receipts'] = 1; render(); },
  'inventory-receipts-partial': () => { F('inv-receipts').status = 'PARTIAL_RECEIVED'; State.page['inv-receipts'] = 1; render(); },
  'inventory-issues-all': () => { const f=F('inv-issues'); f.kind=''; f.type = ''; State.page['inv-issues'] = 1; render(); },
  'inventory-issues-return': () => { const f=F('inv-issues'); f.kind='return'; f.type = ''; State.page['inv-issues'] = 1; render(); },
  'inventory-issues-posted': () => { const f=F('inv-issues'); f.kind='issue'; f.type = ''; State.page['inv-issues'] = 1; render(); },
  'inventory-transfers-all': () => { F('inv-transfers').status = ''; State.page['inv-transfers'] = 1; render(); },
  'inventory-transfers-draft': () => { F('inv-transfers').status = 'DRAFT'; State.page['inv-transfers'] = 1; render(); },
  'inventory-transfers-transit': () => { F('inv-transfers').status = 'IN_TRANSIT'; State.page['inv-transfers'] = 1; render(); },
  'inventory-transfers-received': () => { F('inv-transfers').status = 'RECEIVED'; State.page['inv-transfers'] = 1; render(); },
  'inventory-counts-all': () => { F('inv-counts').status = ''; State.page['inv-counts'] = 1; render(); },
  'inv-defect-handle': (d) => openInventoryDefectHandleModal(d.product, d.lotid, d.warehouse),
  'inv-defect-save': async (d) => {
    const row=(DB.inventory||[]).find(r=>r.productId===d.product && String(r.lotId||'')===String(d.lotid||'') && r.warehouseId===d.warehouse);
    if(!row){Toast.err('Không tìm thấy dòng tồn',d.product||'');return;}
    row.defectDisposition=$('#defectDisposition')?.value||'PENDING';
    row.defectNote=($('#defectNote')?.value||'').trim();
    row.defectUpdatedAt=new Date().toISOString();
    row.defectUpdatedBy=DB.currentUser?.name||DB.currentUser?.id||'';
    try{
      if(typeof InventoryAPI!=='undefined'){ InventoryAPI.cacheCurrent?.(); await InventoryAPI.syncRecords?.('inventory',[row]); }
    }catch(err){Toast.err('Không lưu được phương án xử lý',err?.message||'Vui lòng thử lại.');return;}
    Modal.close(); render(); Toast.ok('Đã lưu phương án xử lý',`${row.productId}`);
  },
  'inv-exception-tab': (d) => { F('inv-defects',{subtab:'defective',q:''}).subtab=d.tab||'defective'; State.page['inv-defects']=1; render(); },
  'inv-exception-detail': (d) => {
    const row=(DB.inventory||[]).find(r=>r.productId===d.product && String(r.lotId||'')===String(d.lotid||'') && r.warehouseId===d.warehouse); if(!row)return;
    const p=Q.product(row.productId)||Q.material(row.productId), lot=Q.lot(row.lotId), wh=(DB.warehouses||[]).find(w=>w.id===row.warehouseId), loc=(DB.warehouseLocations||[]).find(l=>l.id===row.locationId);
    const isReturn=wh?.type==='RETURNED';
    const isExpired=typeof inventoryLotIsExpired==='function' && inventoryLotIsExpired(lot);
    const tx=(DB.inventoryTransactions||[]).filter(t=>t.productId===row.productId&&t.lotId===row.lotId&&t.warehouseId===row.warehouseId).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const primaryRef = isReturn ? (row.sourceId||lot?.salesOrderId||'') : (row.productionOrderId||lot?.productionOrderId||'');
    const productionRefExists = isReturn || !primaryRef || (DB.productionOrders||[]).some(po => String(po?.id||po?.code||'') === String(primaryRef));
    const primaryRefHtml = primaryRef
      ? (productionRefExists
        ? `<button type="button" class="ref-link" data-act="${isReturn?'open-order':'open-production-order'}" data-id="${esc(primaryRef)}"><i class="fa-solid fa-arrow-up-right-from-square"></i><span class="code">${esc(primaryRef)}</span></button>`
        : `<span class="code">${esc(primaryRef)}</span><div class="cell-sub" style="color:var(--orange);margin-top:4px"><i class="fa-solid fa-triangle-exclamation"></i> Chứng từ LSX không còn trên server</div>`)
      : '<span class="muted">—</span>';
    const qcRef = !isReturn ? (row.sourceId||'') : '';
    Modal.open({title:isReturn?'Chi tiết hàng trả về':isExpired?'Chi tiết lô hết hạn':'Chi tiết hàng lỗi',sub:`${esc(row.productId)} · ${esc(p?.name||row.productId)}`,size:'lg',body:`
      <div class="exception-detail-head ${isReturn?'returned':'defective'}"><div class="exception-detail-icon"><i class="fa-solid ${isReturn?'fa-rotate-left':isExpired?'fa-calendar-xmark':'fa-triangle-exclamation'}"></i></div><div><b>${esc(p?.name||row.productId)}</b><span>${isReturn?'Hàng khách trả về':isExpired?'Phân loại: Hết hạn · Chờ xử lý':'Thành phẩm QC không đạt'}</span></div><div class="exception-detail-qty"><b>${fmtN(row.qtyOnHand||0)}</b><span>${esc(row.unit||p?.unit||'')}</span></div></div>
      <div class="info-grid">${infoItem('Mã hàng',`<span class="code">${esc(row.productId)}</span>`)}${infoItem('Kho',esc(wh?.name||'—'))}${infoItem('Vị trí',esc(loc?.name||'—'))}${infoItem('Phương án xử lý',inventoryDefectDispositionBadge(row))}${infoItem('Lô',`<span class="code">${esc(lot?.lotNumber||'—')}</span>`)}${isExpired?infoItem('Hạn sử dụng',`<span class="badge red">${lot?.expiryDate?fmtDate(lot.expiryDate):'—'} · Hết hạn</span>`):''}${infoItem(isReturn?'Đơn hàng tham chiếu':'Lệnh sản xuất tham chiếu',primaryRefHtml)}${!isReturn&&!isExpired&&qcRef?infoItem('Phiếu QC',`<span class="code">${esc(qcRef)}</span>`):''}${infoItem('Ngày ghi nhận',fmtDate(String(row.lastUpdated||'').slice(0,10)))}</div>
      <div class="form-sec-title" style="margin-top:16px">Lịch sử giao dịch</div>${tableShell([{t:'Giao dịch'},{t:'Ngày'},{t:'Loại'},{t:'Số lượng',cls:'right'},{t:'Tham chiếu'}],tx.map(t=>{const ref=t.refId||'';const act=ref?(isReturn?'open-order':(String(ref).startsWith('LSX-')?'open-production-order':'')):'';const refHtml=act?`<button type="button" class="ref-link compact" data-act="${act}" data-id="${esc(ref)}"><span class="code">${esc(ref)}</span><i class="fa-solid fa-arrow-up-right-from-square"></i></button>`:`<span class="code">${esc(ref||'—')}</span>`;return `<tr><td><span class="code">${esc(t.id)}</span></td><td>${fmtDate(t.date)}</td><td>${esc(t.type||'')}</td><td class="right num">${fmtN(t.qty||0)} ${esc(row.unit||'')}</td><td>${refHtml}</td></tr>`}).join(''),{emptyTitle:'Chưa có giao dịch'})}`,foot:'<button class="btn" data-act="modal-close">Đóng</button>'});
  },
  'inv-supplier-return-detail': (d) => {
    const req=(DB.materialReturnRequests||[]).find(r=>r.id===d.id);
    const hist=(DB.materialReturnHistory||[]).find(r=>r.id===d.id);
    const r=req||hist;
    if(!r) return;
    const mat=Q.material(r.materialId), lot=Q.lot(r.lotId), po=Q.purchaseOrder(r.poId);
    const supplier=(DB.suppliers||[]).find(s=>s.id===(r.supplierId||po?.supplierId));
    const wh=(DB.warehouses||[]).find(w=>w.id===r.warehouseId), loc=(DB.warehouseLocations||[]).find(l=>l.id===r.locationId);
    const done=(r.status==='COMPLETED'||r.status==='RETURNED'||!!r.issueId);
    const statusHtml=done?'<span class="badge green">Đã xuất trả NCC</span>':'<span class="badge orange">Chờ kho xác nhận</span>';
    const poHtml=r.poId?`<button type="button" class="ref-link" data-act="open-po" data-id="${esc(r.poId)}"><i class="fa-solid fa-arrow-up-right-from-square"></i><span class="code">${esc(r.poId)}</span></button>`:'<span class="muted">—</span>';
    const receiptHtml=r.receiptId?`<span class="code">${esc(r.receiptId)}</span>`:'—';
    Modal.open({title:`Chi tiết hàng trả NCC · ${esc(r.id||'')}`,sub:`${esc(mat?.name||r.materialId||'—')} · ${fmtN(r.qty||0)} ${esc(r.unit||mat?.unit||'')}`,size:'lg',body:`
      <div class="exception-detail-head returned"><div class="exception-detail-icon"><i class="fa-solid fa-truck-arrow-right"></i></div><div><b>${esc(mat?.name||r.materialId||'—')}</b><span>Nguyên liệu QC đầu vào không đạt · Trả nhà cung cấp</span></div><div class="exception-detail-qty"><b>${fmtN(r.qty||0)}</b><span>${esc(r.unit||mat?.unit||'')}</span></div></div>
      <div class="info-grid">
        ${infoItem('Yêu cầu trả',`<span class="code">${esc(r.id||'—')}</span>`)}
        ${infoItem('Trạng thái',statusHtml)}
        ${infoItem('PO',poHtml)}
        ${infoItem('Nhà cung cấp',esc(supplier?.name||r.supplierId||po?.supplierId||'—'))}
        ${infoItem('Phiếu nhập',receiptHtml)}
        ${infoItem('Kho / vị trí',`${esc(wh?.name||Q.warehouseName(r.warehouseId)||'—')}${loc?.name?` · ${esc(loc.name)}`:''}`)}
        ${infoItem('Lô hệ thống',`<span class="code">${esc(lot?.lotNumber||'—')}</span>`)}
        ${infoItem('Ngày yêu cầu',fmtDate(r.requestedDate||r.date||''))}
        ${done?infoItem('Phiếu xuất trả',`<span class="code">${esc(r.issueId||'—')}</span>`):''}
        ${done?infoItem('Ngày hoàn tất',fmtDate(r.completedAt||r.date||'')):''}
        ${infoItem('Người tạo yêu cầu',esc(Q.employeeName(r.requestedBy)||r.requestedBy||r.createdByName||r.createdBy||'—'))}
      </div>
      <div class="field" style="margin-top:14px"><label>Lý do trả NCC</label><div class="inp" style="height:auto;min-height:48px">${esc(r.reason||'Không đạt kiểm tra đầu vào')}</div></div>
      <div class="note-box"><b>Luồng xử lý</b><div class="cell-sub">Hàng trả được theo dõi tại đây để tra cứu. Việc xác nhận xuất trả NCC vẫn thực hiện tại <b>Kho → Xuất kho</b>, đúng luồng hiện tại.</div></div>`,foot:'<button class="btn" data-act="modal-close">Đóng</button>'});
  },
  'inventory-counts-completed': () => { F('inv-counts').status = 'COMPLETED'; State.page['inv-counts'] = 1; render(); },
  'inventory-counts-open': () => { F('inv-counts').status = 'DRAFT'; State.page['inv-counts'] = 1; render(); },
  'inventory-lots-all': () => { const f=F('inv-lots'); f.expStatus=''; f.qcStatus=''; State.page['inv-lots']=1; render(); },
  'inventory-lots-near': () => { F('inv-lots').expStatus='near_expiry'; State.page['inv-lots']=1; render(); },
  'inventory-lots-expired': () => { F('inv-lots').expStatus='expired'; State.page['inv-lots']=1; render(); },
  'inventory-lots-passed': () => { const f=F('inv-lots'); f.qcStatus='PASSED'; f.expStatus=''; State.page['inv-lots']=1; render(); },
  'inventory-lots-failed': () => { const f=F('inv-lots'); f.qcStatus='FAILED'; f.expStatus=''; State.page['inv-lots']=1; render(); },
  'inv-tab': (d) => go('warehouse', { tab: d.tab === 'lots' ? 'batches' : (d.tab || 'batches') }),
  'inv-receipt-view': (d) => Toast.info('Chi tiết phiếu nhập', `${d.id} · Có thể đối chiếu lô, hạn dùng, QC và vị trí nhận hàng.`),
  'inv-issue-view': (d) => openIssueDetailModal(d.id),
  'inv-tx-view': (d) => {
    const tx=(DB.inventoryTransactions||[]).find(x=>x.id===d.id); if(!tx)return;
    const item=Q.material(tx.productId)||Q.product(tx.productId);
    const lot=Q.lot(tx.lotId);
    Modal.open({title:`Chi tiết giao dịch kho ${tx.id}`,sub:`${esc(tx.transactionNumber||tx.id)} · ${fmtDate(tx.date)}`,size:'md',body:`<div class="info-grid">${infoItem('Loại giao dịch',esc(tx.type||'—'))}${infoItem('Mã hàng',`<span class="code">${esc(tx.productId)}</span>`)}${infoItem('Tên hàng',esc(item?.name||tx.productId))}${infoItem('Kho',esc(Q.warehouseName(tx.warehouseId)||'—'))}${infoItem('Lô',esc(lot?.lotNumber||'—'))}${infoItem('Vị trí',esc(Q.locationName(tx.locationId)||'—'))}${infoItem('Số lượng biến động',`<b class="num">${Number(tx.qty)>0?'+':''}${fmtDec(tx.qty,2)}</b>`)}${infoItem('Tồn trước → sau',`<span class="num">${fmtDec(tx.qtyBefore,2)} → ${fmtDec(tx.qtyAfter,2)}</span>`)}${infoItem('Tham chiếu',`<span class="code">${esc(tx.refId||'—')}</span>`)}${infoItem('Người thực hiện',esc(Q.employeeName(tx.userId)||tx.userId||'—'))}</div><div class="field" style="margin-top:14px"><label>Diễn giải</label><div class="inp" style="height:auto;min-height:42px">${esc(tx.note||'—')}</div></div>`,foot:'<button class="btn" data-act="modal-close">Đóng</button>'});
  },
  'inv-lot-detail': (d) => Toast.info('Chi tiết lô hàng', `${Q.lot(d.lotid)?.lotNumber || d.lotid} · Xem sổ giao dịch tại menu Sổ giao dịch kho.`),
  'inv-export-stock': () => Exporter.csv('Ton-kho-Le-Nam.csv', ['Mã hàng', 'Kho', 'Vị trí', 'Lô', 'On Hand', 'Reserved', 'Available'], DB.inventory.map((row) => [row.productId, Q.warehouseName(row.warehouseId), Q.locationName(row.locationId), Q.lot(row.lotId)?.lotNumber || '', row.qtyOnHand, row.qtyReserved, row.qtyAvailable])),
  'inv-export-receipts': () => Exporter.csv('Phieu-nhap-kho-Le-Nam.csv', ['Số phiếu', 'Ngày', 'Trạng thái', 'Ghi chú'], DB.goodsReceipts.map((row) => [row.id, row.date, row.status, row.note])),
  'inv-export-issues': () => Exporter.csv('Phieu-xuat-kho-Le-Nam.csv', ['Số phiếu', 'Ngày', 'Loại', 'Trạng thái'], DB.goodsIssues.map((row) => [row.id, row.date, row.type, row.status])),
  'inv-export-transactions': () => Exporter.csv('So-giao-dich-kho-Le-Nam.csv', ['Mã giao dịch', 'Loại', 'Sản phẩm', 'Số lượng', 'Ngày'], DB.inventoryTransactions.map((row) => [row.id, row.type, row.productId, row.qty, row.date])),

  /* --- Nhà cung cấp --- */
  'pr-add-supplier': (d) => {
    State.prFormDraft = {
      dept: $('#prDept')?.value || '',
      requester: $('#prRequester')?.value || '',
      expectedDate: $('#prExpectedDate')?.value || '',
      reason: $('#prReason')?.value || '',
      quantities: Object.fromEntries([...document.querySelectorAll('.pr-qty')].map((input) => [input.dataset.id, input.value])),
      prices: Object.fromEntries([...document.querySelectorAll('.pr-expected-price')].map((input) => [input.dataset.id, input.value])),
    };
    openPRSupplierModal(d.id);
  },

  'pr-select-supplier': (d) => {
    const materialId = d.materialId;
    const selected = [...document.querySelectorAll('input[name="prSupplier"]:checked')];
    if (!selected.length) {
      alert('Vui lòng chọn nhà cung cấp.');
      return;
    }
    const material = State.prFormMaterials?.find(
      m => String(m.id) === String(materialId)
    );
    if (!material) return;
    material.supplierIds = selected.map(input => input.value);
    material.supplierId = material.supplierIds[0] || '';
    // Đóng modal NCC
    Modal.close();
    // Mở lại form PR để tiếp tục thêm vật tư hoặc NCC.
    openPRForm();
  },

  'supplier-add': () => openSupplierForm(),
  'supplier-edit': (d) => openSupplierForm(d.id),
  'supplier-delete': async (d) => {
    const supplier = DB.suppliers.find((x) => x.id === d.id);
    if (!supplier) return;
    const refs = [
      ...(DB.purchaseOrders || []).filter((x) => x.supplierId === d.id),
      ...(DB.supplierQuotations || []).filter((x) => x.supplierId === d.id),
      ...(DB.inventoryLots || []).filter((x) => x.supplierId === d.id),
    ];
    if (refs.length) { Toast.err('Không thể xóa nhà cung cấp', `${supplier.name} đã phát sinh chứng từ/lô hàng. Bạn có thể sửa thông tin thay vì xóa.`); return; }
    if (!confirm(`Xóa nhà cung cấp ${supplier.id} - ${supplier.name}?`)) return;
    try {
      if (typeof PurchaseAPI === 'undefined' || !PurchaseAPI.deleteCollectionKey) throw new Error('PurchaseAPI chưa sẵn sàng');
      await PurchaseAPI.deleteCollectionKey('suppliers', d.id);
      DB.suppliers = DB.suppliers.filter((x) => x.id !== d.id);
      Modal.close(); render(); Toast.ok('Đã xóa nhà cung cấp', `${supplier.id} · ${supplier.name} · đã xóa trên server`);
    } catch (err) {
      Toast.err('Không xóa được nhà cung cấp trên server', err?.message || 'Vui lòng thử lại.');
    }
  },
  'supplier-detail': (d) => { State.supplierTab='overview'; switchTo(() => openSupplierDrawer(d.id), { keepDrawer: true }); },
  'supplier-tab': (d) => { State.supplierTab=d.tab; const supplier=Q.supplier(d.id); if(supplier) Drawer.setBody(supplierDrawerBody(supplier)); },
  'supplier-refund-modal': async (d) => { if(typeof accountingEntriesEnsureFresh==='function') await accountingEntriesEnsureFresh(false); switchTo(() => openSupplierRefundModal(d.id)); },
  'supplier-refund-save': (d) => saveSupplierRefund(d.id),
  'supplier-save': (d) => {
    const name = $('#supName')?.value.trim();
    const group = $('#supGroup')?.value.trim();
    if (!name || !group) { Toast.err('Thiếu thông tin', 'Vui lòng nhập tên và nhóm cung ứng của nhà cung cấp.'); return; }
    const existing = d.id ? DB.suppliers.find((x) => x.id === d.id) : null;
    const payload = {
      name, group,
      contact: $('#supContact')?.value.trim() || '', phone: $('#supPhone')?.value.trim() || '',
      email: $('#supEmail')?.value.trim() || '', taxCode: $('#supTaxCode')?.value.trim() || '',
      bankAccount: $('#supBankAccount')?.value.trim() || '', bankName: $('#supBankName')?.value.trim() || '',
      address: $('#supAddress')?.value.trim() || '', paymentTerm: $('#supPayment')?.value.trim() || 'Theo hợp đồng',
    };
    if (existing) {
      Object.assign(existing, payload);
      Modal.close(); render(); Toast.ok('Đã cập nhật nhà cung cấp', `${existing.id} · ${name}`);
      return;
    }
    const id = nextCode('NCC-', DB.suppliers);
    DB.suppliers.unshift({ id, ...payload, rating: 0, ratingStatus: 'UNRATED' });
    Modal.close(); render(); Toast.ok('Đã thêm nhà cung cấp', `${id} · ${name} · Chưa đánh giá`);
  },
  'export-enterprise': (d) => {
    const module = ENTERPRISE_MODULES[d.key];
    if (!module) return;
    Exporter.csv(`Bao-cao-${d.key}.csv`, module.columns, module.rows);
  },
  'enterprise-action': (d) => { if (d.key === 'suppliers') openSupplierForm(); else Toast.info('Chức năng đang chờ dữ liệu nhập', `Màn ${d.key} đã sẵn sàng để kết nối form nghiệp vụ và API triển khai.`); },
  'subcontracting-new': async () => {
    try {
      if (typeof InventoryAPI !== 'undefined') {
        await InventoryAPI.bootstrap?.();
        await InventoryAPI.ensureFresh?.(['products'], { force:false });
      }
    } catch (err) { console.warn('[Subcontracting] Không hydrate được đầy đủ thành phẩm:', err); }
    openSubcontractingForm();
  },
  'subcontracting-open': (d) => openSubcontractingDetail(d.id),
  'subcontracting-edit': async (d) => {
    try {
      if (typeof InventoryAPI !== 'undefined') {
        await InventoryAPI.bootstrap?.();
        await InventoryAPI.ensureFresh?.(['products'], { force:false });
      }
    } catch (err) { console.warn('[Subcontracting] Không hydrate được đầy đủ thành phẩm:', err); }
    openSubcontractingForm(d.id);
  },
  'subcontracting-save': (d) => subcontractingSaveOrder(d.id || ''),
  'subcontracting-delete': (d) => subcontractingDeleteOrder(d.id),
  'subcontracting-approve': (d) => subcontractingApproveOrder(d.id),
  'subcontracting-issue': (d) => openSubcontractingIssueModal(d.id),
  'subcontracting-issue-confirm': (d) => subcontractingIssueMaterials(d.id),
  'subcontracting-handover': (d) => openSubcontractingHandoverModal(d.id),
  'subcontracting-handover-confirm': (d) => subcontractingHandoverConfirm(d.id),
  'subcontracting-progress-update': (d) => openSubcontractingProgressModal(d.id),
  'subcontracting-progress-save': (d) => subcontractingSaveProgress(d.id),
  'subcontracting-receive': (d) => openSubcontractingReceiveModal(d.id),
  'subcontracting-receive-confirm': (d) => subcontractingReceiveGoods(d.id),
  'subcontracting-qc': (d) => openSubcontractingQcModal(d.id, d.receipt || ''),
  'subcontracting-qc-confirm': (d) => subcontractingQcConfirm(d.id, d.receipt || ''),
  'subcontracting-go-qc': () => go('quality', { tab:'subcontracting_qc' }),
  'subcontracting-go-warehouse': () => { go('warehouse', { tab:'receipts' }); setTimeout(() => { const f = F('inv-receipts', { receiptTab:'finished' }); f.receiptTab='finished'; render(); }, 0); },
  'subcontracting-warehouse': (d) => openSubcontractingWarehouseModal(d.id, d.receipt || ''),
  'subcontracting-warehouse-confirm': (d) => subcontractingWarehouseConfirm(d.id, d.receipt || ''),
  'subcontracting-reconcile': (d) => openSubcontractingReconcileModal(d.id),
  'subcontracting-reconcile-confirm': (d) => subcontractingReconcileConfirm(d.id),
  'subcontracting-pay': (d) => openSubcontractingPaymentModal(d.id),
  'subcontracting-pay-save': (d) => subcontractingSavePayment(d.id),
  'subcontracting-partner-new': () => openSubcontractingPartnerForm(),
  'subcontracting-partner-edit': (d) => openSubcontractingPartnerForm(d.id),
  'subcontracting-partner-save': (d) => subcontractingSavePartner(d.id || ''),
  'subcontracting-partner-detail': (d) => openSubcontractingPartnerDetail(d.id || d.partner),
  'subcontracting-partner-delete': (d) => subcontractingDeletePartner(d.id),
  'restaurant-replenishment-new': async (d) => {
    // Form yêu cầu bổ sung phải độc lập với thứ tự người dùng đã mở các phân hệ.
    // Nạp Chi nhánh + master Thành phẩm thật từ server trước khi dựng dropdown.
    try {
      const jobs=[];
      if (typeof RestaurantQualityAPI !== 'undefined' && RestaurantQualityAPI.refreshRestaurant)
        jobs.push(RestaurantQualityAPI.refreshRestaurant(['stores']));
      if (typeof InventoryAPI !== 'undefined' && InventoryAPI.ensureFresh)
        jobs.push(InventoryAPI.ensureFresh(['products','inventory','inventoryLots','warehouses'],{force:false}));
      await Promise.allSettled(jobs);
    } catch (err) {
      console.warn('[Restaurant] Không hydrate đủ dữ liệu bổ sung cửa hàng từ server:', err);
    }
    const requestedStore=(restaurantIsStoreStaff&&restaurantIsStoreStaff())?restaurantBoundStoreId():(d.store||''); openRestaurantReplenishmentForm({storeId:requestedStore,productId:d.product||'',quantity:Number(d.qty||0)||1});
  },
  'restaurant-replenishment-add-line': () => {
    const wrap=document.getElementById('rrLines'); if(!wrap)return;
    const storeId=document.getElementById('rrStore')?.value||'';
    wrap.insertAdjacentHTML('beforeend',restaurantReplenishmentLineHtml(storeId,{quantity:1}));
  },
  'restaurant-replenishment-toggle': (d,el) => {
    const input=el?.closest('.restaurant-replenishment-line')?.querySelector('.rr-product-search');
    if(input){input.focus();restaurantSearchReplenishmentItems(input);}
  },
  'restaurant-replenishment-pick': (d,el) => {
    const row=el?.closest('.restaurant-replenishment-line');if(row)restaurantSelectReplenishmentItem(row,d.product);
  },
  'restaurant-replenishment-remove-line': (d,el) => {
    const lines=document.querySelectorAll('#rrLines .restaurant-replenishment-line');
    if(lines.length<=1){Toast.warn('Cần ít nhất một thành phẩm','Phiếu yêu cầu phải có ít nhất một dòng hàng.');return;}
    el?.closest('.restaurant-replenishment-line')?.remove();
  },
  'restaurant-replenishment-save': async () => {
    DB.storeReplenishmentRequests=DB.storeReplenishmentRequests||[];
    const storeId=$('#rrStore')?.value||'', store=restaurantStore(storeId);
    if(typeof restaurantCanAccessStore==='function'&&!restaurantCanAccessStore(storeId)){Toast.err('Không có quyền','Tài khoản này chỉ thao tác trên cửa hàng được phân công.');return;}
    if(!store){Toast.err('Dữ liệu chưa hợp lệ','Vui lòng chọn cửa hàng.');return;}
    const sourceWarehouseId=restaurantReplenishmentSourceId(storeId), sourceWh=Q.warehouse(sourceWarehouseId);
    const sourceSiteId=restaurantReplenishmentSiteId(storeId), sourceWarehouseIds=restaurantReplenishmentWarehouses(storeId).map(w=>w.id);
    if(!sourceWh || !restaurantReplenishmentWarehouses(storeId).some(w=>w.id===sourceWarehouseId)){Toast.err('Kho nguồn không hợp lệ','Cửa hàng chưa liên kết kho nguồn hợp lệ.');return;}
    const raw=[...document.querySelectorAll('#rrLines .restaurant-replenishment-line')].map(line=>({productId:line.querySelector('.rr-product-select')?.value||'',quantity:Number(line.querySelector('.rr-qty')?.value||0)}));
    if(raw.some(x=>!x.productId || !Number.isFinite(x.quantity) || x.quantity<=0)){Toast.err('Dòng hàng chưa hợp lệ','Chọn hàng hóa từ danh sách gợi ý và nhập số lượng lớn hơn 0 cho mọi dòng.');return;}
    if(!raw.length){Toast.err('Chưa có hàng hóa','Hãy thêm ít nhất một mặt hàng và nhập số lượng lớn hơn 0.');return;}
    const merged=new Map(); raw.forEach(x=>merged.set(x.productId,(merged.get(x.productId)||0)+x.quantity));
    const items=[...merged.entries()].map(([productId,quantity])=>({productId,quantity}));
    for(const it of items){
      if(!restaurantSourceProducts(storeId,sourceWarehouseId).includes(it.productId)){Toast.err('Hàng hóa không hợp lệ',it.productId);return;}
    }
    const id=nextCode('YCBS-2026-',DB.storeReplenishmentRequests);
    DB.storeReplenishmentRequests.unshift({id,storeId,sourceWarehouseId,sourceSiteId,sourceWarehouseIds,items,date:restaurantToday(),status:'REQUESTED',note:$('#rrNote')?.value.trim()||'',createdBy:DB.currentUser?.id||'',createdAt:new Date().toISOString(),transferId:'',issuedLines:[]});
    await restaurantPersist(['replenishments']); Modal.close(); go('restaurant',{tab:'replenishment'}); Toast.ok('Đã gửi yêu cầu bổ sung',`${id} · ${items.length} mặt hàng`);
  },
  'restaurant-replenishment-view': (d) => {
    const r=restaurantReplenishment(d.id); if(!r)return;
    const store=restaurantStore(r.storeId), sourceWh=Q.warehouse(r.sourceWarehouseId||store?.sourceWarehouseId), progress=restaurantReplenishmentProgress(r);
    const rows=progress.items.map(x=>{const item=restaurantItem(x.productId);return `<tr><td><span class="code">${esc(x.productId)}</span><div class="cell-sub">${esc(item?.name||x.productId)}</div></td><td class="right num">${fmtDec(x.requestedQty,3)} ${esc(item?.unit||'')}</td><td class="right num">${fmtDec(x.issuedQty,3)} ${esc(item?.unit||'')}</td><td class="right num">${fmtDec(x.receivedQty,3)} ${esc(item?.unit||'')}</td><td class="right num strong">${fmtDec(x.remainingToReceive,3)} ${esc(item?.unit||'')}</td></tr>`}).join('');
    const issueRefs=progress.batches.flatMap(b=>b.goodsIssueIds || [b.goodsIssueId]).filter(Boolean).join(', '), transferRefs=progress.batches.map(b=>b.transferId).filter(Boolean).join(', ');
    Modal.open({title:`Yêu cầu bổ sung · ${esc(r.id)}`,size:'lg',body:`<div class="detail-grid"><div><span>Cửa hàng</span><b>${esc(store?.name||r.storeId)}</b></div><div><span>Ngày yêu cầu</span><b>${fmtDate(r.date)}</b></div><div><span>Kho nguồn</span><b>${esc(restaurantReplenishmentSourceLabel(r.storeId,r))}</b></div><div><span>Số mặt hàng</span><b>${progress.items.length}</b></div><div><span>Trạng thái</span><b>${restaurantReplenishmentStatus(progress.status)}</b></div><div><span>Phiếu xuất kho</span><b>${esc(issueRefs||r.goodsIssueId||'—')}</b></div><div><span>Mã điều phối</span><b>${esc(transferRefs||r.transferId||'—')}</b></div><div><span>Người tạo yêu cầu</span><b>${esc(Q.employeeName(r.createdBy)||r.createdBy||'—')}</b></div><div><span>Kho xuất gần nhất bởi</span><b>${esc(Q.employeeName(r.issuedBy)||r.issuedBy||'—')}</b></div><div><span>Cửa hàng nhận gần nhất bởi</span><b>${esc(Q.employeeName(r.receivedBy)||r.receivedBy||'—')}</b></div></div><div class="form-sec-title" style="margin-top:12px">Tiến độ hàng yêu cầu</div>${tableShell([{t:'Hàng hóa'},{t:'SL yêu cầu',cls:'right'},{t:'Đã xuất',cls:'right'},{t:'Đã nhận',cls:'right'},{t:'Còn thiếu',cls:'right'}],rows,{emptyTitle:'Phiếu chưa có dòng hàng'})}<div class="field" style="margin-top:12px"><label>Ghi chú</label><div class="inp" style="height:auto;min-height:42px">${esc(r.note||'—')}</div></div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button>${progress.status==='ISSUED'?`<button class="btn btn-primary" data-act="restaurant-replenishment-receive" data-id="${esc(r.id)}"><i class="fa-solid fa-box-open"></i>Cửa hàng nhập đợt hàng này</button>`:''}`});
  },
  'restaurant-replenishment-fulfill': (d) => {
    if(State.module!=='warehouse'){ Toast.warn('Kho thực hiện duyệt xuất','Vui lòng xử lý yêu cầu này tại Kho → Duyệt bổ sung cửa hàng.'); go('warehouse',{tab:'store_replenishment'}); return; }
    openRestaurantReplenishmentFulfill(d.id);
  },
  'restaurant-replenishment-fulfill-save': async (d) => {
    const req=restaurantReplenishment(d.id); if(!req)return;
    const beforeProgress=restaurantReplenishmentProgress(req);
    if(!['REQUESTED','PARTIAL_RECEIVED'].includes(beforeProgress.status))return;
    const store=restaurantStore(req.storeId), fromWarehouseId=req.sourceWarehouseId||store?.sourceWarehouseId||'', sourceWh=Q.warehouse(fromWarehouseId);
    if(!store||!sourceWh||!['FINISHED_GOODS','RAW_MATERIAL'].includes(sourceWh.type)){Toast.err('Dữ liệu chưa hợp lệ','Yêu cầu phải có kho nguyên liệu hoặc thành phẩm nguồn hợp lệ.');return;}
    const sourceIds=new Set(restaurantRequestSourceWarehouses(req).map(w=>w.id));
    if(!sourceIds.size){Toast.err('Kho nguồn không hợp lệ','Không tìm thấy khu xuất thuộc kho nguồn của yêu cầu.');return;}
    const remainingMap=new Map(beforeProgress.items.filter(x=>x.remainingToIssue>1e-6).map(x=>[x.productId,x.remainingToIssue]));
    const approved=[...document.querySelectorAll('.rr-approved-qty')].map(el=>({productId:el.dataset.product||'',quantity:Number(el.value||0)}));
    if(!approved.length||approved.some(x=>!x.productId||x.quantity<=0)){Toast.err('Số lượng xuất chưa hợp lệ','Mỗi mặt hàng phải có số lượng xuất lớn hơn 0.');return;}
    if(approved.length!==remainingMap.size){Toast.err('Chưa đủ dòng cần xuất','Phải xử lý đầy đủ các mặt hàng còn thiếu trong yêu cầu.');return;}
    for(const it of approved){
      const need=Number(remainingMap.get(it.productId)||0);
      if(need<=0||Math.abs(it.quantity-need)>1e-6){Toast.err('Số lượng xuất không đúng phần còn thiếu',`${restaurantItem(it.productId)?.name||it.productId}: còn thiếu ${fmtDec(need,3)}, cần xác nhận đúng số lượng này.`);return;}
    }
    // Chỉ cho hoàn tất một đợt xuất nếu Kho có đủ TOÀN BỘ phần còn thiếu hiện tại.
    const allocationPlan=[];
    for(const it of approved){
      const item=restaurantItem(it.productId);
      const sourceRows=(DB.inventory||[]).filter(r=>sourceIds.has(r.warehouseId)&&r.productId===it.productId&&Number(r.qtyAvailable??r.qtyOnHand??0)>0&&inventoryRowIsUsableForIssue(r)).sort(sortIssueRowsFefoFifo);
      const usableTotal=sourceRows.reduce((sum,r)=>sum+Number(r.qtyAvailable??r.qtyOnHand??0),0);
      if(usableTotal+1e-9<it.quantity){Toast.err('Không đủ tồn hợp lệ để xuất',`${item?.name||it.productId}: lô hợp lệ ${fmtDec(usableTotal,3)}, còn thiếu cần xuất ${fmtDec(it.quantity,3)}. Không trừ tồn và không tạo phiếu.`);return;}
      let remaining=it.quantity; const allocations=[];
      for(const source of sourceRows){if(remaining<=1e-9)break;const take=Math.min(remaining,Number(source.qtyAvailable??source.qtyOnHand??0));if(take>0){allocations.push({source,take});remaining-=take;}}
      if(remaining>1e-9){Toast.err('Không thể phân bổ đủ lô',`${item?.name||it.productId}: còn thiếu ${fmtDec(remaining,3)}. Phiếu chưa bị trừ tồn.`);return;}
      allocationPlan.push({it,item,allocations});
    }
    const transferId=nextCode('XCH-2026-',DB.stockTransfers||[]), issuedLines=[];
    for(const plan of allocationPlan){
      for(const alloc of plan.allocations){
        const source=alloc.source, take=alloc.take;
        const out=InventoryService.apply({productId:plan.it.productId,warehouseId:source.warehouseId,locationId:source.locationId,lotId:source.lotId,quantity:take,type:'TRANSFER_OUT',refType:'STORE_REPLENISHMENT',refId:transferId,note:`Kho xuất cho cửa hàng theo ${req.id}`,updateMaterial:Q.warehouse(source.warehouseId)?.type==='RAW_MATERIAL'});
        if(!out.ok){Toast.err('Không thể xuất kho nguồn',out.message);return;}
        issuedLines.push({productId:plan.it.productId,lotId:source.lotId||'',qty:take,unit:source.unit||plan.item?.unit||'',sourceLocationId:source.locationId||'',sourceWarehouseId:source.warehouseId});
      }
    }
    for(const it of approved){const issued=issuedLines.filter(x=>x.productId===it.productId).reduce((sum,x)=>sum+Number(x.qty||0),0);if(Math.abs(issued-it.quantity)>1e-6){Toast.err('Sai lệch số lượng xuất',`${restaurantItem(it.productId)?.name||it.productId}: xác nhận ${fmtDec(it.quantity,3)} nhưng chứng từ mới có ${fmtDec(issued,3)}.`);return;}}
    DB.goodsIssues=DB.goodsIssues||[];
    const goodsIssueIds=[];
    const issueGroups=new Map();
    for(const line of issuedLines){const wh=line.sourceWarehouseId||fromWarehouseId;if(!issueGroups.has(wh))issueGroups.set(wh,[]);issueGroups.get(wh).push(line);}
    for(const [warehouseId,lines] of issueGroups){
      const issueId=nextCode('PX-2026-',DB.goodsIssues);goodsIssueIds.push(issueId);
      lines.forEach(line=>{line.goodsIssueId=issueId;});
      DB.goodsIssues.unshift({id:issueId,type:'TRANSFER_OUT',warehouseId,sourceSiteId:req.sourceSiteId||'',refDoc:req.id,replenishmentId:req.id,transferId,storeId:req.storeId,date:restaurantToday(),status:'COMPLETED',createdBy:DB.currentUser?.id||'',note:`Xuất hàng cho ${store.name||req.storeId} theo yêu cầu ${req.id}`,items:lines.map(line=>({productId:line.productId,lotId:line.lotId||'',qty:Number(line.qty||0),unit:line.unit||'',locationId:line.sourceLocationId||''}))});
    }
    const goodsIssueId=goodsIssueIds[0];
    // Materialize lịch sử legacy rồi thêm đợt xuất mới. Không ghi đè 600 cũ của các request đã xử lý một phần.
    const history=restaurantReplenishmentIssueBatches(req).map(b=>({...b,issuedLines:(b.issuedLines||[]).map(x=>({...x}))}));
    history.push({id:goodsIssueId,goodsIssueId,goodsIssueIds,transferId,issuedLines:issuedLines.map(x=>({...x})),issuedAt:new Date().toISOString(),issuedBy:DB.currentUser?.id||'',receivedAt:'',receivedBy:''});
    req.issueBatches=history; req.status='ISSUED'; req.approvedItems=approved; req.sourceWarehouseId=fromWarehouseId; req.transferId=transferId; req.goodsIssueId=goodsIssueId; req.issuedLines=issuedLines; req.issuedAt=new Date().toISOString(); req.issuedBy=DB.currentUser?.id||'';
    req.goodsIssueIds=history.flatMap(x=>x.goodsIssueIds || [x.goodsIssueId]).filter(Boolean); req.transferIds=history.map(x=>x.transferId).filter(Boolean);
    if(typeof InventoryAPI!=='undefined'&&InventoryAPI.scheduleCollections) InventoryAPI.scheduleCollections(['inventory','inventoryTransactions','goodsIssues'],120);
    await restaurantPersist(['replenishments']); Modal.close(); go('warehouse',{tab:'store_replenishment'}); Toast.ok('Kho đã xuất phần còn thiếu',`${goodsIssueId} · ${transferId} · chờ cửa hàng nhận đợt này`);
  },
  'restaurant-replenishment-receive': (d) => {
    const req=restaurantReplenishment(d.id); if(!req)return; const progress=restaurantReplenishmentProgress(req); if(progress.status!=='ISSUED')return; const store=restaurantStore(req.storeId);
    const pending=[...progress.batches].reverse().find(b=>!b.receivedAt&&(b.issuedLines||[]).length); if(!pending)return;
    const grouped={}; for(const line of pending.issuedLines||[]){grouped[line.productId]=(grouped[line.productId]||0)+Number(line.qty||0);}
    const rows=Object.entries(grouped).map(([productId,qty])=>{const item=restaurantItem(productId);return `<tr><td><span class="code">${esc(productId)}</span><div class="cell-sub">${esc(item?.name||productId)}</div></td><td class="right num">${fmtDec(qty,3)} ${esc(item?.unit||'')}</td></tr>`}).join('');
    Modal.open({title:`Cửa hàng nhập hàng · ${esc(req.id)}`,sub:`${esc(store?.name||req.storeId)} · đợt ${esc(pending.goodsIssueId||pending.transferId||'xuất mới')}`,size:'lg',body:`<div class="detail-grid"><div><span>Phiếu xuất kho</span><b>${esc((pending.goodsIssueIds || [pending.goodsIssueId]).filter(Boolean).join(', ')||'—')}</b></div><div><span>Mã điều phối</span><b>${esc(pending.transferId||'—')}</b></div><div><span>Kho nguồn</span><b>${esc(restaurantReplenishmentSourceLabel(req.storeId,req))}</b></div><div><span>Trạng thái</span><b>Chờ cửa hàng xác nhận nhập đợt này</b></div></div><div class="form-sec-title" style="margin-top:14px">Hàng cửa hàng sẽ nhận</div>${tableShell([{t:'Hàng hóa'},{t:'Số lượng nhận',cls:'right'}],rows,{emptyTitle:'Không có hàng đã xuất'})}<div class="note-box"><b>Sau khi xác nhận</b><div class="cell-sub">Chỉ đợt hàng này được cộng vào tồn cửa hàng. Nếu yêu cầu vẫn còn thiếu, phiếu sẽ chuyển sang “Đã nhận một phần” để Kho xuất tiếp phần còn lại.</div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="restaurant-replenishment-receive-confirm" data-id="${esc(req.id)}"><i class="fa-solid fa-box-open"></i>Xác nhận nhập đợt này</button>`});
  },
  'restaurant-replenishment-receive-confirm': async (d) => {
    const req=restaurantReplenishment(d.id); if(!req)return; const progressBefore=restaurantReplenishmentProgress(req); if(progressBefore.status!=='ISSUED')return; const store=restaurantStore(req.storeId); if(!store)return;
    // Materialize cả batch legacy nếu có, rồi xác định đúng đợt chưa nhận gần nhất.
    req.issueBatches=restaurantReplenishmentIssueBatches(req).map(b=>({...b,issuedLines:(b.issuedLines||[]).map(x=>({...x}))}));
    let pendingIndex=-1; for(let i=req.issueBatches.length-1;i>=0;i--){if(!req.issueBatches[i].receivedAt&&(req.issueBatches[i].issuedLines||[]).length){pendingIndex=i;break;}}
    if(pendingIndex<0)return; const pending=req.issueBatches[pendingIndex];
    DB.restaurantStoreStocks=DB.restaurantStoreStocks||[]; DB.restaurantStoreStockTransactions=DB.restaurantStoreStockTransactions||[];
    for(const line of pending.issuedLines||[]){
      const productId=line.productId; const item=Q.product(productId)||restaurantItem(productId); const key=`${req.storeId}|${productId}|${line.lotId||''}`;
      let stock=(DB.restaurantStoreStocks||[]).find(x=>`${x.storeId}|${x.productId}|${x.lotId||''}`===key);
      if(!stock){stock={id:`RSS-${req.storeId}-${productId}-${line.lotId||'NOLOT'}`.replace(/[^A-Za-z0-9_-]/g,'-'),storeId:req.storeId,sourceWarehouseId:line.sourceWarehouseId||req.sourceWarehouseId,productId,lotId:line.lotId||'',unit:line.unit||item?.unit||'',qtyOnHand:0,qtyAvailable:0,createdAt:new Date().toISOString()};DB.restaurantStoreStocks.unshift(stock);}
      const before=Number(stock.qtyOnHand||0), add=Number(line.qty||0); stock.qtyOnHand=before+add; stock.qtyAvailable=Number(stock.qtyAvailable||0)+add; stock.updatedAt=new Date().toISOString();
      DB.restaurantStoreStockTransactions.unshift({id:`RSTX-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,storeId:req.storeId,sourceWarehouseId:line.sourceWarehouseId||req.sourceWarehouseId,productId,lotId:line.lotId||'',type:'RECEIPT',qty:add,qtyBefore:before,qtyAfter:stock.qtyOnHand,refType:'STORE_REPLENISHMENT',refId:req.id,goodsIssueId:line.goodsIssueId||pending.goodsIssueId||'',date:restaurantToday(),createdAt:new Date().toISOString()});
    }
    pending.receivedAt=new Date().toISOString(); pending.receivedBy=DB.currentUser?.id||''; req.issueBatches[pendingIndex]=pending; req.receivedAt=pending.receivedAt; req.receivedBy=pending.receivedBy;
    const afterProgress=restaurantReplenishmentProgress(req); req.status=afterProgress.remainingToReceiveTotal<=1e-6?'RECEIVED':'PARTIAL_RECEIVED';
    await restaurantPersist(['replenishments','storeStocks','storeStockTransactions']); Modal.close();
    if(req.status==='RECEIVED'){go('restaurant',{tab:'store_stock'});Toast.ok('Cửa hàng đã nhập đủ hàng',`${req.id} · yêu cầu đã hoàn tất`);}else{go('restaurant',{tab:'replenishment'});Toast.ok('Đã nhận một phần',`${req.id} · còn thiếu ${fmtDec(afterProgress.remainingToReceiveTotal,3)} đơn vị để Kho xuất tiếp`);}
  },
  'restaurant-pos-add': (d) => restaurantPosAdd(d.id),
  'restaurant-pos-inc': (d) => restaurantPosChange(d.id, 1),
  'restaurant-pos-dec': (d) => restaurantPosChange(d.id, -1),
  'restaurant-pos-clear': () => { RestaurantPOSState.cart=[]; render(); },
  'restaurant-pos-checkout': () => {
    if(window.RestaurantPOSState) window.RestaurantPOSState.channel='POS';
    if(!(RestaurantPOSState.cart||[]).length){ Toast.warn('Đơn hàng đang trống','Hãy chọn ít nhất một món.'); return; }
    const store=restaurantPosStore(); if(!store){ Toast.err('Chưa có chi nhánh','Hãy khai báo chi nhánh trước khi bán hàng.'); return; }
    const probe={storeId:store.id,items:(RestaurantPOSState.cart||[]).map(x=>({recipeId:x.recipeId,quantity:Number(x.qty||0)}))};
    const check=restaurantCanFulfill(probe); if(!check.ok){Toast.err('Không đủ nguyên liệu để nhận order',check.message||'Một hoặc nhiều nguyên liệu đã hết.');return;}
    Modal.open({title:'Gửi order xuống bếp',sub:`${esc(store.name)} · ${fmtN(RestaurantPOSState.cart.length)} dòng món`,size:'md',body:`<div class="detail-grid"><div><span>Tạm tính</span><b style="font-size:20px">${fmtVND(restaurantPosCartTotal())}</b></div><div><span>Ca bán hàng</span><b>${esc(RestaurantPOSState.shift)}</b></div></div><div class="note-box"><b>Quy trình</b><div class="cell-sub">Order được gửi xuống Bếp. Bếp bắt đầu chế biến → hoàn thành món → phục vụ. Sau đó POS mới thực hiện thanh toán.</div></div>`,foot:'<button class="btn" data-act="modal-close">Quay lại</button><button class="btn btn-primary" data-act="restaurant-pos-checkout-confirm"><i class="fa-solid fa-fire-burner"></i>Gửi xuống bếp</button>'});
  },
  'restaurant-pos-checkout-confirm': async () => {
    const store=restaurantPosStore(); if(!store)return;
    const invoiceId=nextCode('POS-2026-',DB.posOrders||[]);
    const order={id:invoiceId,storeId:store.id,shift:RestaurantPOSState.shift||'Ca sáng',employeeId:DB.currentUser?.id||'',date:restaurantToday(),channel:RestaurantPOSState.channel||'POS',tableNo:'',items:(RestaurantPOSState.cart||[]).map(x=>({recipeId:x.recipeId,quantity:Number(x.qty||0),price:Number(x.price||0)})),payment:'',status:'KITCHEN_WAITING',createdAt:new Date().toISOString()};
    const check=restaurantCanFulfill(order); if(!check.ok){Toast.err('Không thể nhận order',check.message||'Không đủ nguyên liệu tại cửa hàng.');return;}
    DB.posOrders.unshift(order); await restaurantPersist(['orders']); RestaurantPOSState.cart=[]; Modal.close(); go('restaurant',{tab:'orders'}); Toast.ok('Đã gửi order xuống bếp',`${invoiceId} · ${fmtVND(restaurantOrderTotal(order))}`);
  },
  'restaurant-pos-open': () => openRestaurantPos('POS'),
  'restaurant-tablet-open': () => openRestaurantPos('TABLET'),
  'restaurant-qr-open': () => openRestaurantPos('QR'),
  'restaurant-recipes': () => go('restaurant',{tab:'recipe'}),
  'restaurant-remote-add-line': () => {
    const host=$('#restaurantRemoteOrderLines'); if(!host)return;
    const row=document.createElement('div');
    row.innerHTML=restaurantRemoteOrderLineHtml({},$('#posStore')?.value||'');
    const line=row.firstElementChild; if(!line)return;
    host.appendChild(line);
    line.querySelectorAll('.remote-recipe,.remote-qty').forEach(el=>el.addEventListener('change',restaurantRemoteOrderRefreshTotal));
    restaurantRemoteRefreshAvailability();
  },
  'restaurant-remote-remove-line': (d,el) => {
    const lines=[...document.querySelectorAll('.restaurant-remote-order-line')];
    if(lines.length<=1){Toast.warn('Đơn hàng cần ít nhất một món','Bạn có thể đổi món hoặc số lượng thay vì xóa dòng cuối.');return;}
    el.closest('.restaurant-remote-order-line')?.remove();
    restaurantRemoteOrderRefreshTotal();
  },
  'restaurant-pos-save': async () => {
    const store = restaurantStore($('#posStore')?.value);
    if(store&&typeof restaurantCanAccessStore==='function'&&!restaurantCanAccessStore(store.id)){Toast.err('Không có quyền','Tài khoản này chỉ bán hàng tại cửa hàng được phân công.');return;}
    const channel = $('#posChannel')?.value || 'POS';
    if(!store){Toast.err('Chưa chọn cửa hàng','Vui lòng chọn cửa hàng trước khi tạo đơn.');return;}
    let items=[];
    if(channel==='TABLET'||channel==='QR'){
      const tableNo=$('#posTable')?.value?.trim()||'';
      if(!tableNo){Toast.warn('Thiếu bàn / mã nhận đơn','Vui lòng nhập bàn hoặc mã nhận đơn.');return;}
      for(const row of document.querySelectorAll('.restaurant-remote-order-line')){
        const recipe=restaurantRecipe(row.querySelector('.remote-recipe')?.value);
        const quantity=Math.floor(Number(row.querySelector('.remote-qty')?.value)||0);
        if(!recipe||quantity<=0)continue;
        const existed=items.find(x=>x.recipeId===recipe.id);
        if(existed) existed.quantity+=quantity;
        else items.push({recipeId:recipe.id,quantity,price:Number(recipe.price||0)});
      }
      if(!items.length){Toast.err('Đơn hàng chưa có món','Hãy chọn ít nhất một món và số lượng lớn hơn 0.');return;}
      const invoiceId=nextCode('POS-2026-',DB.posOrders||[]);
      const order={id:invoiceId,storeId:store.id,shift:$('#posShift')?.value||'Ca sáng',employeeId:DB.currentUser?.id||'',date:restaurantToday(),channel,tableNo,payment:'',items,status:'KITCHEN_WAITING',createdAt:new Date().toISOString()};
      const check=restaurantCanFulfill(order);
      if(!check.ok){Toast.err('Có món tạm hết / không đủ nguyên liệu',check.message||'Tồn khả dụng không đủ cho đơn này.');return;}
      DB.posOrders.unshift(order);
      try{
        await restaurantPersist(['orders']);
      }catch(err){
        DB.posOrders=(DB.posOrders||[]).filter(x=>x!==order);
        Toast.err('Không gửi được đơn lên server',err?.message||'Vui lòng thử lại.');
        return;
      }
      Modal.close(); go('restaurant',{tab:channel.toLowerCase()});
      const total=items.reduce((sum,x)=>sum+Number(x.price||0)*Number(x.quantity||0),0);
      Toast.ok('Đã gửi đơn về POS',`${invoiceId} · ${items.length} món · ${fmtVND(total)}`);
      return;
    }
    const recipe = restaurantRecipe($('#posRecipe')?.value);
    const quantity = Number($('#posQty')?.value) || 0;
    if (!recipe || quantity <= 0) { Toast.err('Dữ liệu bán hàng không hợp lệ', 'Vui lòng chọn món và nhập số lượng lớn hơn 0.'); return; }
    const invoiceId = nextCode('POS-2026-', DB.posOrders || []);
    const order = { id: invoiceId, storeId: store.id, shift: $('#posShift')?.value || 'Ca sáng', employeeId: DB.currentUser?.id || '', date: restaurantToday(), channel:'POS', tableNo:'', items: [{ recipeId: recipe.id, quantity, price: recipe.price }], payment:'', status:'KITCHEN_WAITING', createdAt: new Date().toISOString() };
    const check = restaurantCanFulfill(order);
    if (!check.ok) { Toast.err('Không đủ nguyên liệu tại cửa hàng', check.message || 'Không thể nhận order.'); return; }
    DB.posOrders.unshift(order); await restaurantPersist(['orders']);
    Modal.close(); go('restaurant',{tab:'orders'});
    Toast.ok('Đã gửi order xuống bếp', `${invoiceId} · ${recipe.name} · ${quantity} ${recipe.unit}`);
  },
  'restaurant-order-view': (d) => openRestaurantOrderDetail(d.id),
  'restaurant-order-pay': async (d) => {
    if(typeof accountingEntriesEnsureFresh==='function') await accountingEntriesEnsureFresh(false);
    const order = (DB.posOrders || []).find(x => x.id === d.id); if (!order || !['READY','SERVED'].includes(order.status)) return;
    if(typeof RestaurantQualityAPI!=='undefined') await RestaurantQualityAPI.ensureFresh(['stores','bankAccounts'],{force:false});
    const defaultEntry=typeof accountingResolveRestaurantEntry==='function'?accountingResolveRestaurantEntry('Tiền mặt'):null;
    Modal.open({title:`Thanh toán đơn · ${esc(order.id)}`,sub:`${esc(restaurantStore(order.storeId)?.name||order.storeId)} · ${fmtVND(restaurantOrderTotal(order))}`,size:'md',body:`<div class="field"><label>Phương thức thanh toán *</label><select class="inp" id="restaurantOrderPayment" onchange="restaurantPaymentMethodChanged('${esc(order.id)}')"><option value="Tiền mặt">Tiền mặt</option><option value="Chuyển khoản">Chuyển khoản</option></select></div><input type="hidden" id="restaurantOrderAccountingEntry" value="${esc(defaultEntry?.id||'')}"><div class="field" style="margin-top:12px"><label>Định khoản kế toán</label><div class="inp" id="restaurantOrderAccountingEntryDisplay" style="background:var(--surface-2)">${defaultEntry?esc((defaultEntry.number||defaultEntry.id)+' · '+defaultEntry.name):'Chưa cấu hình định khoản bán hàng tiền mặt'}</div><div class="cell-sub">Tự động theo phương thức thanh toán do Kế toán cấu hình; nhân viên cửa hàng không được chọn thủ công.</div></div><div id="restaurantBankPaymentArea"></div><div class="note-box"><b>Thanh toán nhà hàng</b><div class="cell-sub">Nhân viên chỉ chọn phương thức thanh toán. Định khoản được hệ thống áp tự động để tránh chọn sai.</div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="restaurant-order-pay-confirm" data-id="${esc(order.id)}"><i class="fa-solid fa-credit-card"></i>Xác nhận thanh toán</button>`});
    restaurantPaymentMethodChanged(order.id);
  },
  'restaurant-order-pay-confirm': async (d) => {
    const order=(DB.posOrders||[]).find(x=>x.id===d.id); if(!order||!['READY','SERVED'].includes(order.status))return;
    const payment=$('#restaurantOrderPayment')?.value||'Tiền mặt';
    const resolvedEntry=typeof accountingResolveRestaurantEntry==='function'?accountingResolveRestaurantEntry(payment):null;
    const accountingEntryId=resolvedEntry?.id||'';
    if(!accountingEntryId){Toast.err('Chưa cấu hình định khoản',`Kế toán chưa khai báo định khoản tự động cho bán hàng nhà hàng bằng ${payment}. Vào Kế toán – Tài chính → Định khoản → Khai báo định khoản để cấu hình.`);return;}
    if(!['Tiền mặt','Chuyển khoản'].includes(payment)){Toast.err('Phương thức thanh toán không hợp lệ','Nhà hàng chỉ nhận Tiền mặt hoặc Chuyển khoản.');return;}
    if(payment==='Chuyển khoản'){
      const account=restaurantBankAccount($('#restaurantOrderBankAccount')?.value);
      const eligibleAccounts=restaurantEligibleBankAccounts(order.storeId);
      const eligible=account && eligibleAccounts.some(x=>String(x.id)===String(account.id));
      if(!eligible){Toast.warn('Chưa chọn tài khoản nhận tiền','Hãy chọn tài khoản được gắn với đúng cửa hàng của đơn.');return;}
      order.bankAccountId=account.id;
      order.bankAccountSnapshot={bankName:account.bankName||'',accountNumber:account.accountNumber||'',accountName:account.accountName||'',scopeType:account.scopeType||'',storeId:account.storeId||''};
    }else{ delete order.bankAccountId; delete order.bankAccountSnapshot; }
    order.payment=payment; order.accountingEntryId=accountingEntryId; order.status='PAID'; order.paidAt=new Date().toISOString(); order.updatedAt=new Date().toISOString();
    if(payment==='Chuyển khoản' && order.bankAccountId){
      const amount=Math.round(Number(restaurantOrderTotal(order)||0));
      if(typeof AccountingBank!=='undefined' && AccountingBank?.record){
        await AccountingBank.record({bankId:order.bankAccountId,type:'IN',date:String(order.paidAt).slice(0,10),amount,note:`Thanh toán đơn nhà hàng ${order.id} · ${restaurantStore(order.storeId)?.name||order.storeId}`,sourceType:'RESTAURANT_ORDER',sourceId:order.id,createdBy:DB.currentUser?.id||'',accountingEntryId});
      }else{
        const bank=restaurantBankAccount(order.bankAccountId);
        if(bank){ bank.transactions=Array.isArray(bank.transactions)?bank.transactions:[]; if(!bank.transactions.some(t=>String(t.sourceType||'')==='RESTAURANT_ORDER'&&String(t.sourceId||'')===String(order.id))) bank.transactions.unshift({id:`BTX-REST-${Date.now()}`,type:'IN',date:String(order.paidAt).slice(0,10),amount,note:`Thanh toán đơn nhà hàng ${order.id}`,sourceType:'RESTAURANT_ORDER',sourceId:order.id,createdBy:DB.currentUser?.id||'',createdAt:new Date().toISOString()}); if(typeof RestaurantQualityAPI!=='undefined') await RestaurantQualityAPI.syncRestaurant(['bankAccounts']); }
      }
    }
    // Chỉ ghi đúng đơn vừa thanh toán thay vì quét/sync lại toàn bộ lịch sử order.
    if(typeof RestaurantQualityAPI!=='undefined' && typeof RestaurantQualityAPI.saveRestaurantRecord==='function') await RestaurantQualityAPI.saveRestaurantRecord('orders',order);
    else await restaurantPersist(['orders']);
    Modal.close(); render(); Toast.ok('Đã thanh toán',`${order.id} · ${order.payment}`);
  },
  'restaurant-kitchen-start': async (d) => {
    const order=(DB.posOrders||[]).find(x=>x.id===d.id); if(!order||!['OPEN','KITCHEN_WAITING'].includes(order.status))return;
    const check=restaurantCanFulfill(order); if(!check.ok){Toast.err('Không đủ nguyên liệu để chế biến',check.message||'Kiểm tra tồn cửa hàng.');return;}
    order.status='COOKING'; order.kitchenStartedAt=new Date().toISOString(); order.updatedAt=new Date().toISOString(); await restaurantPersist(['orders']); render(); Toast.ok('Bếp đã nhận món',order.id);
  },
  'restaurant-kitchen-ready': async (d) => {
    const order=(DB.posOrders||[]).find(x=>x.id===d.id); if(!order||order.status!=='COOKING')return;
    const posted=restaurantPostOrder(order); if(!posted.ok){Toast.err('Không thể hoàn thành món',posted.message||'Không đủ nguyên liệu để ghi nhận tiêu hao.');return;}
    order.status='READY'; order.kitchenReadyAt=new Date().toISOString(); order.updatedAt=new Date().toISOString(); await restaurantPersist(['orders','storeStocks','storeStockTransactions']); render(); Toast.ok('Món đã hoàn thành',`${order.id} · chờ phục vụ`);
  },
  'restaurant-kitchen-serve': async (d) => {
    const order=(DB.posOrders||[]).find(x=>x.id===d.id); if(!order||order.status!=='READY')return;
    order.status='SERVED'; order.servedAt=new Date().toISOString(); order.updatedAt=new Date().toISOString(); await restaurantPersist(['orders']); render(); Toast.ok('Đã phục vụ khách',order.id);
  },
  'restaurant-order-delete': (d) => {
    const order = (DB.posOrders || []).find(x => x.id === d.id); if (!order) return;
    if (!['OPEN','KITCHEN_WAITING'].includes(order.status)) { Toast.warn('Không thể xóa', 'Chỉ được hủy đơn trước khi bếp bắt đầu chế biến.'); return; }
    confirmBox({ title:'Xóa đơn hàng', icon:'fa-trash', okText:'Xóa đơn', message:`Xóa đơn <b>${esc(order.id)}</b>?`, onOk:()=>{ DB.posOrders=(DB.posOrders||[]).filter(x=>x.id!==order.id); if(typeof RestaurantQualityAPI!=='undefined') RestaurantQualityAPI.deleteRestaurant('orders',order.id).catch(err=>Toast.err('Không xóa được trên server',err?.message||'')); render(); Toast.ok('Đã xóa đơn', order.id); } });
  },
  'restaurant-waste-new': async () => {
    try{ if(typeof RestaurantQualityAPI!=='undefined') await RestaurantQualityAPI.ensureFresh(['stores','storeStocks'],{force:false}); }catch(err){}
    const stores=(DB.stores||[]).filter(x=>x.status!=='inactive');
    const storeId=F('restaurant-store-stock',{storeId:''}).storeId||stores[0]?.id||'';
    const stockItems=[...new Map((DB.restaurantStoreStocks||[]).filter(x=>!storeId||x.storeId===storeId).map(x=>[restaurantStockItemId(x),x])).values()];
    Modal.open({title:'Ghi nhận hao hụt / thất thoát bếp',size:'md',body:`<div class="form-grid cols-2"><div class="field"><label>Cửa hàng *</label><select class="inp" id="restaurantWasteStore">${stores.map(st=>`<option value="${esc(st.id)}" ${st.id===storeId?'selected':''}>${esc(st.name)}</option>`).join('')}</select></div><div class="field"><label>Ngày *</label><input class="inp" id="restaurantWasteDate" type="date" value="${currentDateYMD()}"></div></div><div class="field"><label>Nguyên liệu / thành phẩm *</label><select class="inp" id="restaurantWasteItem"><option value="">-- Chọn mặt hàng --</option>${stockItems.map(x=>{const id=restaurantStockItemId(x),m=Q.material?.(id)||Q.product?.(id)||restaurantItem(id);return `<option value="${esc(id)}">${esc(id)} — ${esc(m?.name||id)} (${esc(m?.unit||'')})</option>`}).join('')}</select></div><div class="form-grid cols-2"><div class="field"><label>Số lượng hao hụt *</label><input class="inp right num" id="restaurantWasteQty" type="number" min="0.0001" step="0.0001" value="1"></div><div class="field"><label>Lý do</label><select class="inp" id="restaurantWasteReason"><option>Chế biến lỗi</option><option>Hư hỏng</option><option>Đổ vỡ</option><option>Hết hạn</option><option>Kiểm kê thiếu</option><option>Khác</option></select></div></div><div class="field"><label>Ghi chú</label><textarea class="inp" id="restaurantWasteNote" rows="2" placeholder="Mô tả nguyên nhân, ca, người ghi nhận…"></textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="restaurant-waste-save"><i class="fa-solid fa-floppy-disk"></i>Ghi nhận hao hụt</button>`});
  },
  'restaurant-waste-save': async () => {
    const storeId=$('#restaurantWasteStore')?.value||'', itemId=$('#restaurantWasteItem')?.value||'', qty=Number($('#restaurantWasteQty')?.value||0);
    if(!storeId||!itemId||qty<=0){Toast.warn('Thiếu dữ liệu','Chọn cửa hàng, mặt hàng và số lượng hao hụt lớn hơn 0.');return;}
    const rows=(DB.restaurantStoreStocks||[]).filter(x=>x.storeId===storeId&&restaurantStockItemId(x)===itemId&&Number(x.qtyOnHand??x.qtyAvailable??0)>0).sort((a,b)=>String(a.expiryDate||Q.lot?.(a.lotId)?.expiryDate||'9999').localeCompare(String(b.expiryDate||Q.lot?.(b.lotId)?.expiryDate||'9999')));
    const physical=rows.reduce((s,x)=>s+Number(x.qtyOnHand??x.qtyAvailable??0),0); if(physical+1e-9<qty){Toast.err('Không đủ tồn để ghi hao hụt',`Tồn vật lý hiện tại ${fmtDec(physical,3)}, hao hụt nhập ${fmtDec(qty,3)}.`);return;}
    let remaining=qty; DB.restaurantStoreStockTransactions=DB.restaurantStoreStockTransactions||[];
    for(const stock of rows){ if(remaining<=0)break; const before=Number(stock.qtyOnHand??stock.qtyAvailable??0),take=Math.min(before,remaining); stock.qtyOnHand=Math.max(0,before-take); stock.qtyAvailable=Math.max(0,Number(stock.qtyAvailable??before)-take); stock.updatedAt=new Date().toISOString(); DB.restaurantStoreStockTransactions.unshift({id:`RSTX-WASTE-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,storeId,productId:itemId,lotId:stock.lotId||'',type:'WASTE',qty:-take,qtyBefore:before,qtyAfter:stock.qtyOnHand,refType:'KITCHEN_WASTE',refId:'',date:$('#restaurantWasteDate')?.value||currentDateYMD(),reason:$('#restaurantWasteReason')?.value||'Khác',note:$('#restaurantWasteNote')?.value.trim()||'',createdBy:DB.currentUser?.id||'',createdAt:new Date().toISOString()}); remaining-=take; }
    await restaurantPersist(['storeStocks','storeStockTransactions']); Modal.close(); render(); Toast.ok('Đã ghi nhận hao hụt',`${restaurantStore(storeId)?.name||storeId} · ${fmtDec(qty,3)}`);
  },
  'restaurant-kitchen-print': (d) => {
    const order=(DB.posOrders||[]).find(x=>x.id===d.id); if(!order)return;
    const w=window.open('','_blank','width=420,height=700'); if(!w){Toast.warn('Trình duyệt đã chặn cửa sổ in','Cho phép popup để in phiếu bếp.');return;} w.document.open(); w.document.write(restaurantKitchenPrintHtml(order)); w.document.close();
  },
  'restaurant-printer-test': () => {
    const w=window.open('','_blank','width=360,height=480'); if(!w){Toast.warn('Trình duyệt đã chặn cửa sổ in','Cho phép popup để kiểm tra máy in.');return;} w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Test máy in bếp</title><style>body{font-family:Arial;padding:20px;text-align:center}</style></head><body><h2>LÊ NAM ERP</h2><p>PHIẾU KIỂM TRA MÁY IN BẾP</p><p>${new Date().toLocaleString('vi-VN')}</p><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}<\/script></body></html>`); w.document.close();
  },
  'restaurant-recipe-new': () => openRestaurantRecipeForm(''),
  'restaurant-recipe-edit': (d) => openRestaurantRecipeForm(d.id),
  'restaurant-recipe-view': (d) => {
    const r=restaurantRecipe(d.id); if(!r)return;
    const rows=(r.items||[]).map(i=>`<tr><td><span class="code">${esc(i.materialId)}</span></td><td>${esc(restaurantRecipeComponent(i.materialId)?.name||i.materialId)}</td><td class="right num">${fmtDec(i.quantity,4)} ${esc(i.unit||restaurantRecipeComponent(i.materialId)?.unit||'')}</td></tr>`).join('');
    Modal.open({title:`Chi tiết món · ${r.id}`,sub:r.name,size:'lg',body:`<div class="detail-grid"><div><span>Nhóm</span><b>${esc(r.group||'—')}</b></div><div><span>Giá bán</span><b>${fmtVND(r.price||0)}</b></div><div><span>Đơn vị</span><b>${esc(r.unit||'—')}</b></div><div><span>Trạng thái</span><b>${r.active!==false?'Đang bán':'Ngừng bán'}</b></div></div><div class="form-sec-title" style="margin-top:14px">Recipe / BOM món</div>${tableShell([{t:'Mã'},{t:'Nguyên liệu / thành phẩm'},{t:'Định lượng',cls:'right'}],rows,{emptyTitle:'Chưa có nguyên liệu'})}`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="restaurant-recipe-edit" data-id="${esc(r.id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`});
  },
  'restaurant-recipe-add-line': () => {
    const host=$('#restaurantRecipeLines'); if(!host)return;
    const row=document.createElement('div'); row.className='restaurant-recipe-line'; row.style.cssText='display:grid;grid-template-columns:125px minmax(250px,1fr) 105px 90px 120px 120px 42px;gap:8px;margin-bottom:8px;align-items:center';
    row.innerHTML=`<select class="inp" name="itemType" disabled><option>Tự nhận diện</option></select><select class="inp" name="material">${restaurantRecipeComponentOptions('')}</select><input class="inp right num" name="qty" type="number" min="0.0001" step="0.0001" value="1"><input class="inp" name="unitDisplay" value="" placeholder="ĐVT" readonly><input class="inp right num" name="unitCostDisplay" value="" placeholder="0" readonly><input class="inp right num" name="lineCostDisplay" value="" placeholder="0" readonly><button class="btn btn-sm" type="button" data-act="restaurant-recipe-remove-line"><i class="fa-solid fa-trash"></i></button>`;
    host.appendChild(row);
    const sel=row.querySelector('[name="material"]'); if(sel) sel.addEventListener('change',()=>{ const c=restaurantRecipeComponent(sel.value),type=row.querySelector('[name="itemType"]'),unit=row.querySelector('[name="unitDisplay"]'); if(type)type.innerHTML=`<option>${sel.value?(Q.material(sel.value)?'Nguyên liệu':'Thành phẩm'):'Tự nhận diện'}</option>`; if(unit)unit.value=c?.unit||''; if(typeof restaurantRefreshRecipeFoodCost==='function') restaurantRefreshRecipeFoodCost(); }); const qty=row.querySelector('[name="qty"]'); if(qty) qty.addEventListener('input',()=>{ if(typeof restaurantRefreshRecipeFoodCost==='function') restaurantRefreshRecipeFoodCost(); });
  },
  'restaurant-recipe-remove-line': (d,el) => { const rows=[...document.querySelectorAll('.restaurant-recipe-line')]; if(rows.length<=1){Toast.warn('Công thức cần ít nhất một thành phần','Giữ ít nhất một dòng nguyên liệu hoặc thành phẩm.');return;} el.closest('.restaurant-recipe-line')?.remove(); if(typeof restaurantRefreshRecipeFoodCost==='function') restaurantRefreshRecipeFoodCost(); },
  'restaurant-recipe-save': async () => {
    const id=$('#restaurantRecipeId')?.value||''; const name=$('#restaurantRecipeName')?.value.trim()||''; const price=parseMoney($('#restaurantRecipePrice')?.value||0); if(!name||price<0){Toast.err('Dữ liệu chưa hợp lệ','Tên món là bắt buộc và giá bán không được âm.');return;}
    const items=[],seen=new Set(); for(const row of document.querySelectorAll('.restaurant-recipe-line')){ const materialId=row.querySelector('[name="material"]')?.value; const quantity=Number(row.querySelector('[name="qty"]')?.value||0); const component=restaurantRecipeComponent(materialId); if(!materialId||!component||quantity<=0){Toast.err('Định lượng chưa hợp lệ','Hãy chọn nguyên liệu/thành phẩm và nhập số lượng lớn hơn 0.');return;} if(seen.has(materialId)){Toast.err('Trùng nguyên liệu / thành phẩm',materialId);return;} seen.add(materialId); items.push({materialId,quantity,unit:component.unit||'',itemType:restaurantRecipeComponentType(materialId)}); }
    let r=restaurantRecipe(id); if(!r){ const rid=nextCode('MON-',DB.restaurantRecipes||[]); r={id:rid}; DB.restaurantRecipes.unshift(r); }
    const foodCost=(typeof restaurantRecipeDraftFoodCost==='function')?restaurantRecipeDraftFoodCost():0; Object.assign(r,{name,group:$('#restaurantRecipeGroup')?.value.trim()||'',price,foodCost,unit:$('#restaurantRecipeUnit')?.value.trim()||'Phần',active:!!$('#restaurantRecipeActive')?.checked,items}); await restaurantPersist(['recipes']); Modal.close(); render(); Toast.ok('Đã lưu món / công thức',r.id);
  },
  'restaurant-recipe-delete': (d) => {
    const r=restaurantRecipe(d.id); if(!r)return; const used=(DB.posOrders||[]).some(o=>(o.items||[]).some(i=>i.recipeId===r.id)); if(used){Toast.warn('Không thể xóa','Món đã phát sinh đơn hàng. Hãy chuyển sang Ngừng bán để giữ lịch sử.');return;}
    confirmBox({title:'Xóa món',icon:'fa-trash',okText:'Xóa',message:`Xóa <b>${esc(r.name)}</b>?`,onOk:()=>{DB.restaurantRecipes=(DB.restaurantRecipes||[]).filter(x=>x.id!==r.id);if(typeof RestaurantQualityAPI!=='undefined') RestaurantQualityAPI.deleteRestaurant('recipes',r.id).catch(err=>Toast.err('Không xóa được trên server',err?.message||''));render();Toast.ok('Đã xóa món',r.id);}});
  },
  'restaurant-store-new': () => openRestaurantStoreForm(''),
  'restaurant-store-edit': (d) => openRestaurantStoreForm(d.id),
  'restaurant-store-view': (d) => {
    const s=restaurantStore(d.id); if(!s)return; const wh=Q.warehouse(s.sourceWarehouseId); const orderCount=(DB.posOrders||[]).filter(o=>o.storeId===s.id).length;
    Modal.open({title:`Chi tiết chi nhánh · ${s.id}`,size:'md',body:`<div class="detail-grid"><div><span>Mã</span><b>${esc(s.code||s.id)}</b></div><div><span>Tên</span><b>${esc(s.name)}</b></div><div><span>Kho thành phẩm nguồn</span><b>${esc(wh?.name||'Chưa liên kết')}</b></div><div><span>Đơn hàng</span><b>${orderCount}</b></div><div><span>Địa chỉ</span><b>${esc(s.address||'—')}</b></div><div><span>Trạng thái</span><b>${s.status!=='inactive'?'Hoạt động':'Ngưng hoạt động'}</b></div></div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="restaurant-store-edit" data-id="${esc(s.id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`});
  },
  'restaurant-store-save': async () => {
    const id=$('#restaurantStoreId')?.value||''; const name=$('#restaurantStoreName')?.value.trim()||''; const sourceWarehouseId=$('#restaurantStoreWarehouse')?.value||''; const wh=Q.warehouse(sourceWarehouseId); if(!name||!wh||wh.type!=='FINISHED_GOODS'){Toast.err('Dữ liệu chưa hợp lệ','Tên chi nhánh và Kho thành phẩm nguồn là bắt buộc.');return;}
    let s=restaurantStore(id); if(!s){const sid=nextCode('STORE-',DB.stores||[]);s={id:sid};DB.stores.push(s);} Object.assign(s,{code:$('#restaurantStoreCode')?.value.trim()||s.id,name,sourceWarehouseId,address:$('#restaurantStoreAddress')?.value.trim()||'',status:$('#restaurantStoreStatus')?.value||'active'}); delete s.warehouseId; await restaurantPersist(['stores']);Modal.close();render();Toast.ok('Đã lưu chi nhánh',`${s.id} · ${wh.name}`);
  },
  'restaurant-store-delete': (d) => {
    const s=restaurantStore(d.id); if(!s)return; if((DB.posOrders||[]).some(o=>o.storeId===s.id)){Toast.warn('Không thể xóa','Chi nhánh đã có đơn hàng. Hãy chuyển trạng thái sang Ngưng hoạt động.');return;}
    confirmBox({title:'Xóa chi nhánh',icon:'fa-trash',okText:'Xóa',message:`Xóa chi nhánh <b>${esc(s.name)}</b>?`,onOk:()=>{DB.stores=(DB.stores||[]).filter(x=>x.id!==s.id);if(typeof RestaurantQualityAPI!=='undefined') RestaurantQualityAPI.deleteRestaurant('stores',s.id).catch(err=>Toast.err('Không xóa được trên server',err?.message||''));render();Toast.ok('Đã xóa chi nhánh',s.id);}});
  },


  /* --- QC/QA: Hồ sơ kiểm nghiệm / CAPA / Thu hồi --- */
  'quality-coa-new': () => openQualityCoaForm(''),
  'quality-coa-edit': (d) => openQualityCoaForm(d.id),
  'quality-coa-save': () => {
    qualityOpsHydrate(); const id=$('#qualityCoaId')?.value||''; const lotId=$('#qualityCoaLot')?.value||''; if(!lotId){Toast.err('Thiếu lô kiểm nghiệm','Hãy chọn lô cần kiểm nghiệm.');return;}
    const lot=(DB.inventoryLots||[]).find(x=>x.id===lotId); let x=(DB.qualityCoa||[]).find(v=>v.id===id); if(!x){x={id:nextCode('COA-2026-',DB.qualityCoa||[])};DB.qualityCoa.unshift(x);}
    const raw=($('#qualityCoaTests')?.value||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const [name,...rest]=v.split(':');return {name:(name||'Chỉ tiêu').trim(),result:rest.join(':').trim()||'—'};});
    Object.assign(x,{lotId,productId:lot?.productId||'',testDate:$('#qualityCoaDate')?.value||restaurantToday(),inspector:$('#qualityCoaInspector')?.value?.trim()||'QC/QA',result:$('#qualityCoaResult')?.value||'PENDING',tests:raw,note:$('#qualityCoaNote')?.value?.trim()||''}); qualityOpsPersist(); Modal.close(); render(); Toast.ok('Đã lưu hồ sơ kiểm nghiệm',x.id);
  },
  'quality-coa-view': (d) => { qualityOpsHydrate(); const x=(DB.qualityCoa||[]).find(v=>v.id===d.id); if(!x)return; const tests=(x.tests||[]).map(t=>`<tr><td>${esc(t.name||'')}</td><td>${esc(t.spec||'—')}</td><td>${esc(t.result||'—')}</td></tr>`).join(''); Modal.open({title:`Hồ sơ kiểm nghiệm · ${esc(x.id)}`,sub:qualityLotLabel(x.lotId),size:'lg',body:`<div class="detail-grid"><div><span>Ngày kiểm</span><b>${fmtDate(x.testDate)}</b></div><div><span>Người kiểm</span><b>${esc(x.inspector||'—')}</b></div><div><span>Kết quả</span><b>${x.result==='PASSED'?'Đạt':x.result==='FAILED'?'Không đạt':'Chờ kết quả'}</b></div><div><span>Sản phẩm</span><b>${esc(x.productId||'—')}</b></div></div><div class="form-sec-title" style="margin-top:14px">Chỉ tiêu kiểm nghiệm</div>${tableShell([{t:'Chỉ tiêu'},{t:'Tiêu chuẩn'},{t:'Kết quả'}],tests,{emptyTitle:'Chưa có chỉ tiêu'})}<div class="note-box"><b>Ghi chú</b><div class="cell-sub">${esc(x.note||'Không có')}</div></div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="quality-coa-edit" data-id="${esc(x.id)}"><i class="fa-solid fa-pen"></i>Cập nhật</button>`}); },
  'quality-capa-new': () => openQualityCapaForm(''),
  'quality-capa-edit': (d) => openQualityCapaForm(d.id),
  'quality-capa-save': () => { qualityOpsHydrate(); const id=$('#qualityCapaId')?.value||''; const issue=$('#qualityCapaIssue')?.value?.trim()||''; if(!issue){Toast.err('Thiếu nội dung CAPA','Hãy nhập vấn đề / sai lệch cần xử lý.');return;} let x=(DB.qualityCapa||[]).find(v=>v.id===id);if(!x){x={id:nextCode('CAPA-2026-',DB.qualityCapa||[])};DB.qualityCapa.unshift(x);} Object.assign(x,{source:$('#qualityCapaSource')?.value||'Kiểm tra chất lượng',issue,rootCause:$('#qualityCapaRoot')?.value?.trim()||'',correction:$('#qualityCapaCorrection')?.value?.trim()||'',preventive:$('#qualityCapaPreventive')?.value?.trim()||'',owner:$('#qualityCapaOwner')?.value?.trim()||'QC/QA',dueDate:$('#qualityCapaDue')?.value||'',status:$('#qualityCapaStatus')?.value||'OPEN'});qualityOpsPersist();Modal.close();render();Toast.ok('Đã lưu CAPA',x.id); },
  'quality-dashboard-tab': (d) => {
    if (['iqc','pqc','fqc','oqc','subcontracting_qc','capa','recall','coa'].includes(d.tab)) go('quality', {tab:d.tab});
  },
  'quality-dashboard-refresh': async () => {
    const plan=routeRefreshPlan('quality','dashboard');
    await plan.api.bootstrap();
    await plan.api.ensureFresh(plan.keys,{force:true});
    render();
  },
  'quality-dashboard-open': (d) => {
    const record=qualityDashboardData({},QualityDashboardState.sources).records.find(r=>r.key===d.key);
    if(!record){Toast.info('Dữ liệu đã thay đổi','Vui lòng cập nhật tổng quan rồi mở lại phiếu.');return;}
    return Actions[record.action]?.(record.data);
  },
  'quality-capa-view': (d) => {qualityOpsHydrate();const x=(DB.qualityCapa||[]).find(v=>v.id===d.id);if(!x)return;Modal.open({title:`CAPA · ${esc(x.id)}`,size:'lg',body:`<div class="detail-grid"><div><span>Nguồn</span><b>${esc(x.source||'—')}</b></div><div><span>Phụ trách</span><b>${esc(x.owner||'—')}</b></div><div><span>Hạn xử lý</span><b>${fmtDate(x.dueDate)}</b></div><div><span>Trạng thái</span><b>${esc(x.status||'OPEN')}</b></div></div><div class="form-sec-title">Vấn đề / sai lệch</div><div class="note-box">${esc(x.issue||'')}</div><div class="form-sec-title">Nguyên nhân gốc</div><div class="note-box">${esc(x.rootCause||'Chưa xác định')}</div><div class="form-sec-title">Khắc phục</div><div class="note-box">${esc(x.correction||'Chưa cập nhật')}</div><div class="form-sec-title">Phòng ngừa</div><div class="note-box">${esc(x.preventive||'Chưa cập nhật')}</div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="quality-capa-edit" data-id="${esc(x.id)}"><i class="fa-solid fa-pen"></i>Cập nhật</button>`});},
  'quality-recall-new': () => openQualityRecallForm(''),
  'quality-recall-edit': (d) => openQualityRecallForm(d.id),
  'quality-recall-save': () => {qualityOpsHydrate();const id=$('#qualityRecallId')?.value||'';const lotId=$('#qualityRecallLot')?.value||'';const reason=$('#qualityRecallReason')?.value?.trim()||'';if(!lotId||!reason){Toast.err('Dữ liệu chưa đủ','Lô thành phẩm và lý do thu hồi là bắt buộc.');return;}let x=(DB.qualityRecalls||[]).find(v=>v.id===id);if(!x){x={id:nextCode('TH-2026-',DB.qualityRecalls||[])};DB.qualityRecalls.unshift(x);}Object.assign(x,{lotId,date:$('#qualityRecallDate')?.value||restaurantToday(),qty:Number($('#qualityRecallQty')?.value||0),status:$('#qualityRecallStatus')?.value||'OPEN',reason,action:$('#qualityRecallAction')?.value?.trim()||''});qualityOpsPersist();Modal.close();render();Toast.ok('Đã lưu đợt thu hồi',x.id);},
  'quality-recall-view': (d) => {qualityOpsHydrate();const x=(DB.qualityRecalls||[]).find(v=>v.id===d.id);if(!x)return;Modal.open({title:`Thu hồi sản phẩm · ${esc(x.id)}`,sub:qualityLotLabel(x.lotId),size:'lg',body:`<div class="detail-grid"><div><span>Ngày khởi tạo</span><b>${fmtDate(x.date)}</b></div><div><span>SL mục tiêu</span><b>${fmtDec(x.qty||0,2)}</b></div><div><span>Trạng thái</span><b>${esc(x.status||'OPEN')}</b></div><div><span>Lô</span><b>${esc(qualityLotLabel(x.lotId))}</b></div></div><div class="form-sec-title">Lý do thu hồi</div><div class="note-box">${esc(x.reason||'')}</div><div class="form-sec-title">Phạm vi / hướng xử lý</div><div class="note-box">${esc(x.action||'Chưa cập nhật')}</div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="quality-recall-edit" data-id="${esc(x.id)}"><i class="fa-solid fa-pen"></i>Cập nhật</button>`});},

  /* --- Mua sắm (Purchase Module Actions) --- */
  'purchase-tab-change': (d) => { F('purchases').tab = d.tab; render(); },

  // [PURCHASE DASHBOARD - INTERACTION]
  // Các KPI của Tổng quan chỉ điều hướng/lọc sang dữ liệu chi tiết tương ứng.
  // Không cập nhật chứng từ và không thay đổi logic nghiệp vụ Purchase.
  'purchase-pr-dashboard-all': () => { const f=F('purchases'); f.status=''; State.page.purchases=1; delete State.transientFilters.purchases; render(); },
  'purchase-pr-dashboard-pending': () => { const f=F('purchases'); f.status='__PENDING__'; State.page.purchases=1; State.transientFilters.purchases={tab:'pr',filterKey:'purchases',fields:['status'],pageKey:'purchases'}; render(); },
  'purchase-pr-dashboard-approved': () => { const f=F('purchases'); f.status='__APPROVED__'; State.page.purchases=1; State.transientFilters.purchases={tab:'pr',filterKey:'purchases',fields:['status'],pageKey:'purchases'}; render(); },
  'purchase-pr-dashboard-rejected': () => { const f=F('purchases'); f.status='__REJECTED__'; State.page.purchases=1; State.transientFilters.purchases={tab:'pr',filterKey:'purchases',fields:['status'],pageKey:'purchases'}; render(); },
  'purchase-po-dashboard-all': () => { const f=F('purchases'); f.status=''; State.page.purchases=1; render(); },
  'purchase-po-dashboard-waiting': () => { const f=F('purchases'); f.status='__PO_WAITING__'; State.page.purchases=1; render(); },
  'purchase-po-dashboard-inbound': () => { const f=F('purchases'); f.status='__PO_INBOUND__'; State.page.purchases=1; render(); },
  'purchase-po-dashboard-received': () => { const f=F('purchases'); f.status='RECEIVED'; State.page.purchases=1; render(); },

  'purchase-dashboard-open-approval': () => {
    // Dashboard không tạo màn hình mới: mở đúng tab Đề nghị mua hàng hiện có
    // và áp bộ lọc trạng thái Chờ duyệt.
    const f = F('purchases');
    f.status = '__PENDING__';
    f.supplier = '';
    State.page.purchases = 1;

    // Filter này chỉ phục vụ lần drill-down từ Dashboard. Khi người dùng rời
    // tab PR rồi quay lại bằng menu/tab bình thường, filter sẽ tự được xóa.
    State.transientFilters.purchases = {
      tab: 'pr',
      filterKey: 'purchases',
      fields: ['status', 'supplier'],
      pageKey: 'purchases'
    };

    go('purchases', { tab: 'pr' });
  },
  'purchase-dashboard-open-po': () => {
    const f = F('purchases');
    f.status = '';
    f.supplier = '';
    State.page.purchases = 1;
    go('purchases', { tab: 'po' });
  },
  'purchase-dashboard-po-shipping': () => {
    const f = F('purchases');
    f.status = 'SHIPPING';
    State.page.purchases = 1;
    State.transientFilters.purchases = { tab:'po', filterKey:'purchases', fields:['status','supplier'], pageKey:'purchases' };
    go('purchases', { tab: 'po' });
  },
  'purchase-dashboard-po-partial': () => {
    const f = F('purchases');
    f.status = 'PARTIAL_RECEIVED';
    State.page.purchases = 1;
    State.transientFilters.purchases = { tab:'po', filterKey:'purchases', fields:['status','supplier'], pageKey:'purchases' };
    go('purchases', { tab: 'po' });
  },
  'purchase-dashboard-po-received': () => {
    const f = F('purchases');
    f.status = 'RECEIVED';
    State.page.purchases = 1;
    State.transientFilters.purchases = { tab:'po', filterKey:'purchases', fields:['status','supplier'], pageKey:'purchases' };
    go('purchases', { tab: 'po' });
  },
  'purchase-dashboard-open-debts': () => {
    const f = F('purchases');
    f.status = '';
    State.page.purchases = 1;
    go('purchases', { tab: 'debts' });
  },
  'purchase-dashboard-open-suppliers': () => {
    go('purchases', { tab: 'suppliers' });
  },
  'purchase-dashboard-open-low-stock': () => {
    const inventoryFilter = F('inventory', {
      q: '', stockTab: 'raw', warehouse: '', category: '', stockStatus: '', expandedProductId: ''
    });
    inventoryFilter.q = '';
    inventoryFilter.stockTab = 'raw';
    inventoryFilter.warehouse = '';
    inventoryFilter.category = '';
    inventoryFilter.stockStatus = 'LOW';
    inventoryFilter.expandedProductId = '';
    State.page.inventory = 1;
    State.transientFilters.warehouse = {
      tab: 'inventory',
      filterKey: 'inventory',
      fields: ['stockStatus'],
      pageKey: 'inventory'
    };
    go('warehouse', { tab: 'inventory' });
  },
  'purchase-clear-date-range': (d) => {
    const f = F('purchases');
    String(d.fields || '').split(',').filter(Boolean).forEach((field) => { f[field] = ''; });
    State.page.purchases = 1;
    render();
  },
  'purchase-clear-price-history': () => {
    const f = F('purchases');
    f.materialId = '';
    f.priceDateFrom = '';
    f.priceDateTo = '';
    State.page.purchases = 1;
    render();
  },
  'purchase-report-open-pr': () => {
    const f = F('purchases');
    f.status = '';
    f.prDateFrom = f.reportDateFrom || '';
    f.prDateTo = f.reportDateTo || '';
    State.page.purchases = 1;
    go('purchases', { tab: 'pr' });
  },
  'purchase-report-open-pending-pr': () => {
    const f = F('purchases');
    f.status = '__PENDING__';
    f.prDateFrom = f.reportDateFrom || '';
    f.prDateTo = f.reportDateTo || '';
    State.page.purchases = 1;
    go('purchases', { tab: 'pr' });
  },
  'purchase-report-open-po': () => {
    const f = F('purchases');
    f.status = '';
    f.supplier = '';
    f.poDateFrom = f.reportDateFrom || '';
    f.poDateTo = f.reportDateTo || '';
    State.page.purchases = 1;
    go('purchases', { tab: 'po' });
  },
  'purchase-report-open-received-po': () => {
    const f = F('purchases');
    f.status = 'RECEIVED';
    f.supplier = '';
    f.poDateFrom = f.reportDateFrom || '';
    f.poDateTo = f.reportDateTo || '';
    State.page.purchases = 1;
    go('purchases', { tab: 'po' });
  },
  'purchase-report-open-debt': () => {
    const f = F('purchases');
    f.debtDateFrom = f.reportDateFrom || '';
    f.debtDateTo = f.reportDateTo || '';
    go('purchases', { tab: 'debts' });
  },
  'purchase-report-open-price-history': () => {
    const f = F('purchases');
    f.materialId = '';
    f.priceDateFrom = f.reportDateFrom || '';
    f.priceDateTo = f.reportDateTo || '';
    go('purchases', { tab: 'price_history' });
  },
  'purchase-report-open-supplier-po': (d) => {
    const f = F('purchases');
    f.status = '';
    f.supplier = d.id || '';
    f.poDateFrom = f.reportDateFrom || '';
    f.poDateTo = f.reportDateTo || '';
    State.page.purchases = 1;
    go('purchases', { tab: 'po' });
  },
  'open-pr': (d) => switchTo(() => openPRModal(d.id)),
  'new-pr': async () => { await PurchasePRMasterData.ensure(); switchTo(() => { State.prFormDraft = null; State.prEditingExistingPrId = null; openPRForm(null); }); },
  'filter-pr': (d) => { F('purchases').status = d.status; F('purchases').tab = 'pr'; State.page.purchases = 1; render(); },
  'pr-edit': async (d) => {
    if (typeof Auth !== 'undefined' && !Auth.hasPermission('PURCHASE_PR_CREATE')) {
      Toast.err('Không có quyền sửa đề nghị mua hàng', 'Vai trò hiện tại chỉ được xem Đề nghị mua hàng.');
      return;
    }
    await PurchasePRMasterData.ensure();
    const pr = Q.purchase(d.id);
    if (!pr) return;

    const editablePr = PURCHASE_INVENTORY_CONFIG.prStatus.pending.includes(pr.status);
    if (!editablePr) {
      Toast.err('Đề nghị đã khóa', `${pr.id} đã đi qua bước duyệt hoặc các bước mua hàng tiếp theo nên không thể sửa.`);
      return;
    }

    // Đề nghị mua hàng chỉ được sửa khi còn Chờ duyệt và chưa xác nhận NCC.
    // xác nhận lựa chọn nhà cung cấp. Sau mốc này PR bị khóa.
    const supplierSelectionConfirmed = DB.supplierQuotations.some(
      q => q.prId === pr.id && (q.confirmed || q.confirmedAt)
    );

    if (supplierSelectionConfirmed) {
      Toast.err(
        'Không thể sửa đề nghị',
        `${pr.id} đã xác nhận chọn nhà cung cấp nên đề nghị mua hàng đã được khóa. Nếu cần thay đổi sau mốc này, hãy xử lý từ đơn đặt hàng tương ứng.`
      );
      return;
    }
    State.prEditingExistingPrId = pr.id;
    State.prEditingPoId = null;
    State.prEditingPrId = null;
    State.prEditingSupplierId = null;
    State.prFormMaterials = (pr.items || []).map(item => ({
      ...(Q.material(item.materialId) || Q.product(item.materialId) || {}), id: item.materialId, name: item.name, unit: item.unit,
      supplierId: item.supplierId || '', supplierIds: item.supplierIds || (item.supplierId ? [item.supplierId] : [])
    }));
    State.prFormDraft = {
      dept: pr.dept || 'Sản xuất', requester: pr.requesterId || DB.currentUser.id,
      expectedDate: pr.expectedDate || addDays(DB.today, 10), reason: pr.reason || '',
      quantities: Object.fromEntries((pr.items || []).map(i => [i.materialId, i.qty])),
      prices: Object.fromEntries((pr.items || []).map(i => [i.materialId, i.expectedPrice || i.price || 0]))
    };
    openPRForm(null);
  },

  'pr-save': () => {
    if (typeof Auth !== 'undefined' && !Auth.hasPermission('PURCHASE_PR_CREATE')) {
      Toast.err('Không có quyền lưu đề nghị mua hàng', 'Vai trò hiện tại chỉ được xem Đề nghị mua hàng. Dữ liệu không được ghi lên server.');
      return;
    }
    const selectedMaterials =
      State.prFormMaterials || [];

    if (!selectedMaterials.length) {
      Toast.err(
        'Chưa chọn vật tư',
        'Vui lòng tìm kiếm và chọn ít nhất một nguyên liệu cần mua.'
      );
      return;
    }

    const items = selectedMaterials.map(m => {

      const qty =
        Number(
          $(`.pr-qty[data-id="${m.id}"]`)?.value
        ) || 0;

      const expectedPrice =
        parseMoney(
          $(`.pr-expected-price[data-id="${m.id}"]`)?.value
        ) || 0;

      return {
        materialId: m.id,
        name: m.name,
        unit: m.unit,
        qty,
        expectedPrice,
        price: expectedPrice,
        supplierId: m.supplierId || '',
        supplierIds: m.supplierIds || (m.supplierId ? [m.supplierId] : []),
        quotations: [],
        amount: qty * expectedPrice,
      };

    }).filter(i => i.qty > 0);

    if (!items.length) {
      Toast.err(
        'Số lượng không hợp lệ',
        'Vui lòng nhập số lượng lớn hơn 0.'
      );
      return;
    }

    // Mỗi nguyên liệu trong PR phải có ít nhất một nhà cung cấp đề xuất.
    const missingSupplier = items.find((i) => !i.supplierId && !(i.supplierIds || []).length);
    if (missingSupplier) {
      Toast.err(
        'Chưa chọn nhà cung cấp',
        `Vui lòng chọn ít nhất một nhà cung cấp phù hợp cho nguyên liệu "${missingSupplier.name}" trước khi tạo đề nghị mua.`
      );
      return;
    }

    // Kiểm tra giá dự kiến
    const invalidPrice = items.find(
      i => i.expectedPrice <= 0
    );

    if (invalidPrice) {
      Toast.err(
        'Giá dự kiến chưa hợp lệ',
        `Vui lòng nhập giá dự kiến lớn hơn 0 cho vật tư "${invalidPrice.name}".`
      );
      return;
    }

    // Tổng giá trị dự kiến của PR
    const total = items.reduce(
      (sum, i) => sum + i.amount,
      0
    );

    // [PR VALIDATION] Người đề nghị phải là actor ERP đang hoạt động.
    const requesterId = $('#prRequester')?.value || '';
    if (!requesterId) {
      Toast.err('Chưa chọn người đề nghị', 'Vui lòng chọn người đề nghị từ danh sách người dùng ERP.');
      return;
    }
    const requesterUser = (DB.users || []).find(user => user?.state === 'active' && String(user.empId || '') === String(requesterId));
    if (!requesterUser) {
      Toast.err('Người đề nghị không hợp lệ', 'Người đề nghị phải là người đang có tài khoản hoạt động trên hệ thống ERP.');
      return;
    }
    const selectedDept = $('#prDept')?.value || '';
    if (selectedDept) {
      const requesterEmployee = (DB.employees || []).find(e => String(e.id) === String(requesterId));
      if (!requesterEmployee || String(requesterEmployee.dept || '') !== String(selectedDept)) {
        Toast.err('Người đề nghị không thuộc bộ phận', 'Vui lòng chọn người đề nghị thuộc đúng bộ phận đã chọn.');
        return;
      }
    }

    // [PR DATE] Ngày tạo/ngày cần hàng của PR dùng ngày thực tế hiện tại,
    // không dùng DB.today demo (15/08/2026) để tránh sai ngày chứng từ mới.
    const actualToday = typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0, 10);
    const requiredDate = $('#prExpectedDate')?.value || '';
    if (!requiredDate) {
      Toast.err('Chưa chọn ngày cần hàng', 'Vui lòng chọn ngày cần hàng.');
      return;
    }
    if (requiredDate < actualToday) {
      Toast.err('Ngày cần hàng không hợp lệ', `Ngày cần hàng phải từ ${fmtDate(actualToday)} trở về sau.`);
      return;
    }

    // Kiểm tra ngân sách
    const dept =
      $('#prDept')?.value || '';

    const deptBudget = Q.deptBudget(dept);

    if (
      deptBudget &&
      total > deptBudget.remaining
    ) {
      Toast.warn(
        'CẢNH BÁO VƯỢT NGÂN SÁCH',
        `Đề xuất mua ${fmtVND(total)} vượt quá ngân sách còn lại của ${dept} (${fmtVND(deptBudget.remaining)})!`
      );
    }

    const editingPoId = State.prEditingPoId;
    const editingPrId = State.prEditingPrId;
    const editingExistingPrId = State.prEditingExistingPrId;

    if (editingExistingPrId && !editingPoId) {
      const existingPr = Q.purchase(editingExistingPrId);
      if (!existingPr) { Toast.err('Không tìm thấy đề nghị', editingExistingPrId); return; }

      // Kiểm tra lại workflow ở thời điểm lưu. PR đã duyệt/đã tạo PO/đã nhận
      // tuyệt đối không được quay ngược về Chờ duyệt chỉ vì mở form sửa cũ.
      if (!PURCHASE_INVENTORY_CONFIG.prStatus.pending.includes(existingPr.status)) {
        Toast.err('Đề nghị đã khóa', `${existingPr.id} đã đi qua bước duyệt hoặc các bước mua hàng tiếp theo nên không thể sửa.`);
        return;
      }
      const supplierSelectionConfirmed = DB.supplierQuotations.some(
        q => q.prId === existingPr.id && (q.confirmed || q.confirmedAt)
      );
      if (supplierSelectionConfirmed) {
        Toast.err(
          'Không thể lưu thay đổi',
          `${existingPr.id} đã xác nhận chọn nhà cung cấp nên đề nghị mua hàng đã được khóa.`
        );
        return;
      }
      existingPr.requesterId = requesterId;
      existingPr.dept = dept;
      existingPr.items = items;
      existingPr.supplierId = items.find(item => item.supplierId)?.supplierId || '';
      existingPr.reason = $('#prReason').value.trim() || 'Bổ sung vật tư phục vụ sản xuất';
      existingPr.total = total;
      existingPr.expectedDate = requiredDate;
      existingPr.status = 'mh_cho_duyet';
      existingPr.approvedBy = '';
      if (typeof approvalRegisterPendingPrNow === 'function') approvalRegisterPendingPrNow(existingPr);
      DB.supplierQuotations.filter(q => q.prId === existingPr.id).forEach(q => { q.selected = false; q.confirmed = false; q.confirmedAt = ''; });
      State.prEditingExistingPrId = null;
      State.prFormDraft = null;
      State.prFormMaterials = [];
      SEARCH_INDEX = null;
      Modal.close();
      Object.assign(F('purchases'), { q: '', status: '', supplier: '', quoteStatus: '', quoteSupplier: '', prId: existingPr.id });
      State.page.purchases = 1;
      go('purchases', { tab: 'pr' });
      Toast.ok('Đã cập nhật đề nghị mua hàng', `${existingPr.id} · Đã chuyển về Chờ duyệt.`);
      return;
    }

    if (editingPoId && editingPrId) {
      const previousPo = Q.purchaseOrder(editingPoId);
      const sourcePr = Q.purchase(editingPrId);
      if (!previousPo || !sourcePr) {
        Toast.err('Không thể tạo đề nghị thay thế', 'Không tìm thấy PO hoặc PR nguồn liên kết.');
        return;
      }

      // Sau khi PR đã tách thành PO, mỗi PO hoạt động độc lập.
      // Khi sửa một PO: KHÔNG sửa PR gốc. Tạo một PR mới chỉ chứa các dòng của PO đang sửa.
      const editedItems = items.map((item) => ({
        ...item,
        supplierId: item.supplierId || State.prEditingSupplierId || previousPo.supplierId || '',
        supplierIds: item.supplierIds?.length ? item.supplierIds : [State.prEditingSupplierId || previousPo.supplierId].filter(Boolean),
        sourcePrId: sourcePr.id,
        sourcePoId: previousPo.id,
      }));

      const replacementPr = {
        id: nextCode('YCM-2026-', DB.purchases),
        requesterId,
        dept,
        supplierId: editedItems.find((item) => item.supplierId)?.supplierId || previousPo.supplierId || '',
        date: actualToday,
        status: 'mh_cho_duyet',
        items: editedItems,
        reason: $('#prReason').value.trim() || `Điều chỉnh từ ${previousPo.id}`,
        total: editedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0),
        expectedDate: requiredDate,
        receivedDate: '',
        approvedBy: '',
        sourcePrId: sourcePr.id,
        sourcePoId: previousPo.id,
        requestType: 'PO_REPLACEMENT',
        note: `Tạo mới khi cập nhật ${previousPo.id}; PR gốc ${sourcePr.id} được giữ nguyên`,
      };
      DB.purchases.unshift(replacementPr);
      if (typeof approvalRegisterPendingPrNow === 'function') approvalRegisterPendingPrNow(replacementPr);

      // Ghi dấu vết trên từng nguyên liệu của PR gốc, không thay đổi số lượng/giá/trạng thái PR gốc.
      const affectedMaterialIds = new Set((previousPo.items || []).map((item) => String(item.materialId)));
      (sourcePr.items || []).forEach((item) => {
        if (!affectedMaterialIds.has(String(item.materialId))) return;
        item.poHistory = Array.isArray(item.poHistory) ? item.poHistory : [];
        item.poHistory.push({
          action: 'PO_UPDATED',
          poId: previousPo.id,
          date: DB.today,
          replacementPrId: replacementPr.id,
          note: `Đơn ${previousPo.id} đã hủy để cập nhật; tạo đề nghị mới ${replacementPr.id}`,
        });
      });

      // Chỉ hủy PO đang cập nhật. Các PO khác cùng PR hoàn toàn độc lập và giữ nguyên.
      previousPo.status = 'CANCELLED';
      previousPo.cancelledAt = DB.today;
      previousPo.cancelledBy = DB.currentUser.id;
      previousPo.cancelReason = `Hủy để cập nhật và tạo đề nghị thay thế ${replacementPr.id}`;
      previousPo.replacementPrId = replacementPr.id;
      previousPo.revisionOfPrId = sourcePr.id;
      previousPo.revisedAt = DB.today;

      State.prEditingPoId = null;
      State.prEditingPrId = null;
      State.prEditingExistingPrId = null;
      State.prEditingSupplierId = null;
      State.prEditingPoItemIds = null;
      State.prFormDraft = null;
      State.prFormMaterials = [];
      SEARCH_INDEX = null;

      Modal.close();
      Object.assign(F('purchases'), { q: '', status: '', supplier: '', quoteStatus: '', quoteSupplier: '', prId: replacementPr.id });
      State.page.purchases = 1;
      go('purchases', { tab: 'pr' });
      Toast.ok('Đã tạo đề nghị mua hàng mới', `${replacementPr.id} được tạo từ ${previousPo.id}. ${sourcePr.id} vẫn được giữ nguyên.`);
      return;
    }

    const pr = {
      id: nextCode('YCM-2026-', DB.purchases),
      requesterId,
      dept,
      supplierId: items.find((item) => item.supplierId)?.supplierId || '',
      date: actualToday,
      status: 'mh_cho_duyet',
      items,
      reason: $('#prReason').value.trim() || 'Bổ sung vật tư phục vụ sản xuất',
      total,
      expectedDate: requiredDate,
      receivedDate: '',
      approvedBy: '',
      createdByUserId: DB.currentUser.userId || '',
      createdBy: DB.currentUser.id || '',
      createdByName: DB.currentUser.name || '',
      createdAt: new Date().toISOString(),
    };

    DB.purchases.unshift(pr);
    // Tạo approval request ngay trong cùng transaction UI để badge Phê duyệt nhảy số tức thì.
    if (typeof approvalRegisterPendingPrNow === 'function') approvalRegisterPendingPrNow(pr);
    if (typeof SystemAPI !== 'undefined') SystemAPI.audit({module:'PURCHASE',entityType:'PURCHASE_REQUEST',entityId:pr.id,action:'CREATE',description:`${DB.currentUser.name} tạo đề nghị mua hàng ${pr.id}`,newData:{status:pr.status,total:pr.total}});
    State.prFormDraft = null;
    State.prEditingPoId = null;
    State.prEditingPrId = null;
    State.prEditingSupplierId = null;
    State.prEditingPoItemIds = null;
    State.prFormMaterials = [];
    SEARCH_INDEX = null;

    logActivity(
      'tạo yêu cầu mua hàng',
      pr.id,
      `${items.length} vật tư · ${fmtVND(pr.total)}`,
      'fa-cart-plus',
      'orange'
    );

    pushNotification({
      level: 'warning',
      icon: 'fa-cart-shopping',
      title: `Yêu cầu mua hàng ${pr.id} chờ duyệt`,
      desc: `${items.length} vật tư — ${fmtVND(pr.total)}`,
      go: {
        module: 'purchases',
        id: pr.id
      }
    });

    Modal.close();

    F('purchases').prId = pr.id;
    go('purchases', { tab: 'pr' });

    Toast.ok(
      'Đã tạo đề nghị mua hàng',
      `${pr.id} · Chuyển sang nhập báo giá NCC`
    );
  },

  'pr-delete': (d) => {
    if (typeof Auth !== 'undefined' && !Auth.hasPermission('PURCHASE_PR_CREATE')) {
      Toast.err('Không có quyền xóa đề nghị mua hàng', 'Vai trò hiện tại chỉ được xem Đề nghị mua hàng.');
      return;
    }
    const pr = DB.purchases.find((p) => p.id === d.id);
    if (!pr) return;
    const isPending = PURCHASE_INVENTORY_CONFIG.prStatus.pending.includes(pr.status);
    if (!isPending) {
      Toast.err('Không thể xóa đề nghị', `${pr.id} đã được duyệt/từ chối hoặc đã chuyển sang bước tiếp theo. Chỉ PR chưa duyệt mới được xóa.`);
      return;
    }
    confirmBox({
      title: 'Xóa đề nghị mua hàng',
      message: `Bạn có chắc muốn xóa <b>${esc(pr.id)}</b>? Thao tác này chỉ áp dụng khi PR chưa được duyệt và không thể hoàn tác.`,
      okText: 'Xóa đề nghị',
      onOk: async () => {
        try {
          if (typeof PurchaseAPI === 'undefined' || !PurchaseAPI.deleteCollectionKey) throw new Error('PurchaseAPI chưa sẵn sàng');
          const quotationIds = (DB.supplierQuotations || []).filter((q) => q.prId === pr.id).map(q => q.id).filter(Boolean);
          // Xóa server trước; chỉ khi KIO xác nhận mới xóa state UI.
          if (quotationIds.length) await PurchaseAPI.deleteCollectionKey('supplierQuotations', quotationIds);
          await PurchaseAPI.deleteCollectionKey('purchases', pr.id);
          DB.purchases = DB.purchases.filter((p) => p.id !== pr.id);
          DB.supplierQuotations = (DB.supplierQuotations || []).filter((q) => q.prId !== pr.id);
          DB.purchaseApprovals = (DB.purchaseApprovals || []).filter((a) => a.prId !== pr.id);
          SEARCH_INDEX = null;
          render();
          Toast.ok('Đã xóa đề nghị mua hàng', `${pr.id} · đã xóa trên server`);
        } catch (err) {
          Toast.err('Không xóa được đề nghị trên server', err?.message || 'Vui lòng thử lại.');
        }
      }
    });
  },

  'pr-remove-material': ({ id }) => {
    const materialId = String(id);

    // Xóa đúng 1 nguyên liệu khỏi State
    State.prFormMaterials = (State.prFormMaterials || [])
      .filter(m => String(m.id) !== materialId);

    // Render lại từ State
    const container = $('#prSelectedMaterials');
    if (!container) return;

    if (!State.prFormMaterials.length) {
      container.innerHTML = `
        <div class="muted" style="padding:20px;text-align:center">
          Chưa có nguyên liệu nào được chọn.
        </div>
      `;
      return;
    }

    container.innerHTML = State.prFormMaterials
      .map(m => renderPRMaterialItem(m))
      .join('');
  },
  

  'pr-select-material': ({ id }) => {
    const m = Q.material(id);
    if (!m) return;

    if (!Array.isArray(State.prFormMaterials)) {
      State.prFormMaterials = [];
    }

    // Không cho phép trùng nguyên liệu
    const exists = State.prFormMaterials.some(
      x => String(x.id) === String(m.id)
    );

    if (exists) {
      Toast.warn(
        'Nguyên liệu đã được chọn',
        `${m.name} đã có trong danh sách.`
      );
      return;
    }

    // Thêm đúng 1 nguyên liệu vào State
    State.prFormMaterials.push(m);

    // Render lại TOÀN BỘ danh sách
    const container = $('#prSelectedMaterials');
    if (!container) return;

    if (!State.prFormMaterials.length) {
      container.innerHTML = `
        <div class="muted" style="padding:20px;text-align:center">
          Chưa có nguyên liệu nào được chọn.
        </div>
      `;
      return;
    }

    container.innerHTML = State.prFormMaterials
      .map(m => renderPRMaterialItem(m))
      .join('');

    // Xóa nội dung ô tìm kiếm
    const search = $('#prMaterialSearch');
    if (search) {
      search.value = '';
    }

    // Ẩn danh sách gợi ý
    const suggestions = $('#prMaterialSuggestions');
    if (suggestions) {
      suggestions.innerHTML = '';
      suggestions.style.display = 'none';
    }
  },

  'pr-approve-action': (d) => {
    if (!Auth.canApprovePurchase()) {
      Toast.err('Không có quyền phê duyệt', 'Tài khoản hiện tại không có quyền Duyệt báo giá & mua hàng.');
      return;
    }
    const p = Q.purchase(d.id);

    if (!p) return;

    if (p.status === 'PENDING_APPROVAL') {
      const selectedQuote = DB.supplierQuotations.find((quote) => quote.prId === p.id && quote.selected);
      if (!selectedQuote) {
        Toast.err('Chưa chọn nhà cung cấp', 'Vui lòng chọn báo giá trước khi duyệt mua hàng.');
        return;
      }
      Actions['pr-convert-po']({ id: p.id });
      return;
    }

    // Chỉ cho phép duyệt PR đang chờ duyệt
    if (p.status !== 'mh_cho_duyet') {
      Toast.err(
        'Không thể duyệt',
        'Đề nghị mua hàng không ở trạng thái Chờ duyệt.'
      );
      return;
    }

    // Cập nhật trạng thái PR
    p.status = 'mh_da_duyet';
    p.approvedBy = DB.currentUser.id;
    p.approvedByUserId = DB.currentUser.userId || '';
    p.approvedByName = DB.currentUser.name || '';
    p.approvedAt = new Date().toISOString();
    if (typeof SystemAPI !== 'undefined') SystemAPI.audit({module:'PURCHASE',entityType:'PURCHASE_REQUEST',entityId:p.id,action:'APPROVE',description:`${DB.currentUser.name} phê duyệt ${p.id}`,newData:{status:p.status}});

    // Ghi lịch sử phê duyệt
    DB.purchaseApprovals.unshift({
      id: nextCode('PA-', DB.purchaseApprovals),
      prId: p.id,
      approverId: DB.currentUser.id,
      time: DB.today + ' 09:00',
      action: 'approve',
      prevStatus: 'mh_cho_duyet',
      nextStatus: 'mh_da_duyet',
      note: 'Đã phê duyệt đề nghị mua hàng',
    });

    Modal.close();

    // ⭐ Duyệt xong → tự động chuyển sang Báo giá NCC
    F('purchases').prId = p.id;
    go('purchases', { tab: 'quotes' });

    Toast.ok(
      'Đã phê duyệt Đề nghị mua hàng',
      `${p.id} · Chuyển sang Báo giá NCC`
    );
  },

  'pr-reject-modal': (d) => {
    if (!Auth.canApprovePurchase()) {
      Toast.err('Không có quyền phê duyệt', 'Tài khoản hiện tại không có quyền từ chối/phê duyệt đề nghị mua.');
      return;
    }
    openPRRejectModal(d.id);
  },
  'pr-reject-save': (d) => {
    if (!Auth.canApprovePurchase()) {
      Toast.err('Không có quyền phê duyệt', 'Tài khoản hiện tại không có quyền từ chối/phê duyệt đề nghị mua.');
      return;
    }
    const p = Q.purchase(d.id);
    if (!p) return;
    const reason = $('#prRejectReason').value.trim();
    if (!reason) { Toast.err('Thiếu lý do từ chối', 'Vui lòng nhập ghi chú lý do từ chối đề nghị.'); return; }
    p.status = 'mh_tu_choi';
    p.rejectedByUserId = DB.currentUser.userId || '';
    p.rejectedByName = DB.currentUser.name || '';
    p.rejectedAt = new Date().toISOString();
    if (typeof SystemAPI !== 'undefined') SystemAPI.audit({module:'PURCHASE',entityType:'PURCHASE_REQUEST',entityId:p.id,action:'REJECT',description:`${DB.currentUser.name} từ chối ${p.id}: ${reason}`,newData:{status:p.status}});
    DB.purchaseApprovals.unshift({
      id: nextCode('PA-', DB.purchaseApprovals), prId: p.id, approverId: DB.currentUser.id,
      time: DB.today + ' 09:00', action: 'reject', prevStatus: 'mh_cho_duyet', nextStatus: 'mh_tu_choi',
      note: reason,
    });
    Modal.close(); render();
    Toast.warn('Đã từ chối Đề nghị mua', `${p.id} — Lý do: ${reason}`);
  },
  'pr-convert-po': (d) => {
    const p = Q.purchase(d.id);

    if (!p) return;

    // 1. PR phải được duyệt
    if (!['mh_da_duyet', 'PENDING_APPROVAL'].includes(p.status)) {
      Toast.err(
        'Chưa thể tạo PO',
        'Chỉ được tạo PO từ Đề nghị mua hàng đã được duyệt.'
      );
      return;
    }

    // 2. PR phải có vật tư
    if (!Array.isArray(p.items) || !p.items.length) {
      Toast.err(
        'PR chưa có vật tư',
        'Đề nghị mua hàng chưa có danh sách vật tư.'
      );
      return;
    }

    // 3. Tìm báo giá NCC đã được chọn
    const selectedQuote = DB.supplierQuotations.find(
      q => q.prId === p.id && q.selected === true
    );

    if (!selectedQuote) {
      Toast.err(
        'Chưa chọn nhà cung cấp',
        'Vui lòng chọn nhà cung cấp trúng thầu trước khi tạo PO.'
      );
      return;
    }

    // 4. Báo giá phải có vật tư
    if (
      !Array.isArray(selectedQuote.items) ||
      !selectedQuote.items.length
    ) {
      Toast.err(
        'Báo giá không có vật tư',
        'Báo giá NCC chưa có danh sách vật tư.'
      );
      return;
    }

    // 5. Lấy vật tư + giá từ báo giá đã chọn
    const poItems = selectedQuote.items.map(i => {
      const material = Q.material(i.materialId);

      const qty = Number(i.qty || 0);
      const price = Number(i.price || 0);

      return {
        materialId: i.materialId,
        name: i.name || (material ? material.name : '—'),
        unit: i.unit || (material ? material.unit : ''),
        qty,
        price,
        amount: Math.round(qty * price),
        receivedQty: 0,
      };
    });

    // 6. Kiểm tra giá
    if (poItems.some(i => i.qty <= 0 || i.price <= 0)) {
      Toast.err(
        'Dữ liệu báo giá không hợp lệ',
        'Số lượng và đơn giá của tất cả vật tư phải lớn hơn 0.'
      );
      return;
    }

    // 7. Tính tiền
    const subtotal = poItems.reduce(
      (sum, i) => sum + Number(i.amount || 0),
      0
    );

    const vatRate = 10;
    const vat = Math.round(subtotal * vatRate / 100);
    const total = subtotal + vat;

    // 8. Tạo mã PO
    const poId = nextCode(
      'PO-2026-',
      DB.purchaseOrders
    );

    const existingPo = DB.purchaseOrders.find(po => po.quoteId === selectedQuote.id);
    if (existingPo) {
      Toast.info('Báo giá đã chuyển thành đơn', `${existingPo.id} đang ở trạng thái ${statusLabel(existingPo.status)}.`);
      return;
    }

    // 9. Tạo PO từ báo giá NCC đã chọn, chờ duyệt trước khi gửi NCC
    const po = {
      id: poId,

      // Liên kết với PR
      prId: p.id,

      // Liên kết với báo giá
      quoteId: selectedQuote.id,

      // NCC lấy từ báo giá thắng
      supplierId: selectedQuote.supplierId,

      date: DB.today,

      expectedDate: addDays(
        DB.today,
        Number(selectedQuote.leadTimeDays || 7)
      ),

      status: 'READY_TO_SEND',

      paymentTerm:
        selectedQuote.paymentTerm ||
        'Theo báo giá NCC',

      note:
        selectedQuote.note ||
        p.reason ||
        'Tạo từ báo giá NCC',

      createdBy: DB.currentUser.id,

      // Vật tư + giá lấy từ báo giá thắng
      items: poItems,

      subtotal,
      vatRate,
      vat,
      total,
      paid: 0,
    };

    // 10. Lưu PO
    DB.purchaseOrders.unshift(po);

    // 11. Đóng modal nếu có
    Modal.close();

    // 12. Duyệt xong chuyển sang danh sách đơn đặt hàng.
    // Reset filter dùng chung để PO mới không bị ẩn bởi trạng thái/NCC của màn trước.
    Object.assign(F('purchases'), { q: '', status: '', supplier: '', quoteStatus: '', quoteSupplier: '' });
    State.page.purchases = 1;
    go('purchases', { tab: 'po' });

    Toast.ok(
      'Đã tạo đơn mua',
      `${poId} — Chờ gửi NCC · ${Q.supplierName(selectedQuote.supplierId)}`
    );
  },
  'quote-add-supplier': (d) => openQuotationModal(d.id),
  'quote-select-pr': (d) => {
    F('purchases').prId = F('purchases').prId === d.id ? '' : d.id;
    State.page.purchaseQuotePrs = State.page.purchaseQuotePrs || 1;
    render();
  },
  'clear-quote-filters': () => {
    F('purchases').quoteStatus = '';
    F('purchases').quoteSupplier = '';
    F('purchases').quoteDateFrom = '';
    F('purchases').quoteDateTo = '';
    State.page.purchaseQuotePrs = 1;
    render();
  },
  'quote-confirm-pr': (d) => {
    const pr = Q.purchase(d.id);
    if (!pr) return;
    const existingQuotes = DB.supplierQuotations.filter(q => q.prId === pr.id);
    if (existingQuotes.some(q => q.confirmed || q.confirmedAt)) {
      Toast.info('Báo giá đã được xác nhận', `${pr.id} · Báo giá chỉ được xem. Muốn thay đổi, hãy sửa đơn đặt hàng để đưa đề nghị về lại quy trình.`);
      return;
    }
    const selectedItems = [];
    const quotedItems = [];
    for (const item of pr.items || []) {
      const choice = document.querySelector(`input.quote-supplier-choice[data-material-id="${item.materialId}"]:checked`);
      if (!choice) {
        Toast.err('Chưa chọn nhà cung cấp', `Vui lòng chọn một NCC cho ${item.name}.`);
        return;
      }
      const priceInput = document.querySelector(`input.quote-supplier-price[data-material-id="${item.materialId}"][data-supplier-id="${choice.dataset.supplierId}"]`);
      const price = parseMoney(priceInput?.value) || 0;
      if (price <= 0) {
        Toast.err('Thiếu giá báo', `Vui lòng nhập giá NCC cho ${item.name}.`);
        return;
      }
      selectedItems.push({ materialId: item.materialId, name: item.name, unit: item.unit, qty: Number(item.qty) || 0, price, amount: price * (Number(item.qty) || 0), supplierId: choice.dataset.supplierId });
      (item.supplierIds || (item.supplierId ? [item.supplierId] : [])).forEach((supplierId) => {
        const input = document.querySelector(`input.quote-supplier-price[data-material-id="${item.materialId}"][data-supplier-id="${supplierId}"]`);
        const supplierPrice = parseMoney(input?.value) || 0;
        if (supplierPrice > 0) quotedItems.push({ materialId: item.materialId, name: item.name, unit: item.unit, qty: Number(item.qty) || 0, price: supplierPrice, amount: supplierPrice * (Number(item.qty) || 0), supplierId, selected: supplierId === choice.dataset.supplierId });
      });
    }
    const bySupplier = selectedItems.reduce((groups, item) => {
      (groups[item.supplierId] ||= []).push(item);
      return groups;
    }, {});
    const createdPoIds = [];
    const quotedBySupplier = quotedItems.reduce((groups, item) => {
      (groups[item.supplierId] ||= []).push(item);
      return groups;
    }, {});
    Object.entries(quotedBySupplier).forEach(([supplierId, items]) => {
      const quoteId = nextCode('BG-NCC-', DB.supplierQuotations);
      const total = items.reduce((sum, item) => sum + item.amount, 0);
      const selected = items.some((item) => item.selected);
      DB.supplierQuotations.unshift({ id: quoteId, prId: pr.id, supplierId, date: DB.today, createdBy:DB.currentUser?.userId||DB.currentUser?.id||'', createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''), validUntil: addDays(DB.today, 15), leadTimeDays: 7, paymentTerm: 'Theo báo giá nhà cung cấp', selected, confirmed: true, confirmedAt: DB.today, note: 'Báo giá đã được xác nhận theo PR', items, total });
      if (selected) {
        const poId = nextCode('PO-2026-', DB.purchaseOrders);
        const poItems = items.filter((item) => item.selected).map((item) => ({ ...item, receivedQty: 0 }));
        const subtotal = poItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const vatRate = 10;
        const vat = Math.round(subtotal * vatRate / 100);
        // Xác nhận báo giá chỉ tạo PO; PO chưa được tự coi là đã duyệt.
        // Trưởng phòng/role có quyền sẽ duyệt ở tab Đơn đặt hàng.
        DB.purchaseOrders.unshift({ id: poId, prId: pr.id, quoteId, supplierId, date: DB.today, expectedDate: addDays(DB.today, 7), status: 'READY_TO_SEND', paymentTerm: 'Theo báo giá nhà cung cấp', note: pr.reason || 'Tạo từ báo giá nhà cung cấp', createdBy:DB.currentUser?.userId||DB.currentUser?.id||'', createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''), items: poItems, subtotal, vatRate, vat, total: subtotal + vat, paid: 0 });
        createdPoIds.push(poId);
      }
    });
    pr.status = 'mh_da_dat_hang';
    pr.approvedBy = DB.currentUser.id;

    // Đánh dấu các collection là đang chờ ghi TRƯỚC KHI chuyển tab.
    // Nếu go('purchases') chạy trước, tab PO có thể refresh snapshot KIO cũ và
    // ghi đè PO vừa tạo trong DB.purchaseOrders.
    if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.scheduleCollections) {
      PurchaseAPI.scheduleCollections(['supplierQuotations', 'purchaseOrders', 'purchases']);
    }

    Modal.close();
    // Bộ lọc PR/quote dùng chung state với tab PO; xóa chúng để PO vừa tạo luôn hiển thị.
    Object.assign(F('purchases'), { q: '', status: '', supplier: '', quoteStatus: '', quoteSupplier: '' });
    State.page.purchases = 1;
    go('purchases', { tab: 'po' });
    Toast.ok('Đã tạo đơn đặt hàng', `${createdPoIds.join(', ')} · Chờ gửi NCC · ${createdPoIds.length} NCC`);
  },
  'quote-save-supplier': (d) => {
    // 1. Lấy đúng PR từ nút Lưu báo giá
    const prId = d.prid;

    if (!prId) {
      Toast.err(
        'Thiếu Đề nghị mua hàng',
        'Không xác định được PR cần báo giá.'
      );
      return;
    }

    const pr = Q.purchase(prId);

    if (!pr) {
      Toast.err(
        'Không tìm thấy Đề nghị mua hàng',
        `PR ${prId} không tồn tại.`
      );
      return;
    }

    // 2. Chỉ được báo giá cho PR đã được duyệt
    if (pr.status !== 'mh_da_duyet') {
      Toast.err(
        'PR chưa được duyệt',
        'Chỉ có thể tạo báo giá NCC từ Đề nghị mua hàng đã được duyệt.'
      );
      return;
    }

    // 3. Lấy thông tin báo giá
    const supplierId = $('#sqSupplier')?.value;

    if (!supplierId) {
      Toast.err(
        'Chưa chọn nhà cung cấp',
        'Vui lòng chọn nhà cung cấp.'
      );
      return;
    }

    const leadTimeDays = Number($('#sqLeadTime')?.value) || 7;
    const date = $('#sqDate')?.value || DB.today;
    const validUntil =
      $('#sqValid')?.value || addDays(DB.today, 15);

    const paymentTerm =
      $('#sqTerm')?.value?.trim() ||
      '30% tạm ứng';

    // 4. Lấy các dòng vật tư trong báo giá
    const prices = $$('.sq-price');

    if (!prices.length) {
      Toast.err(
        'Không có vật tư',
        'PR chưa có vật tư để báo giá.'
      );
      return;
    }

    const items = prices.map(inp => {
      const m = Q.material(inp.dataset.id);

      const qty = Number(inp.dataset.qty) || 0;
      const price = parseMoney(inp.value) || 0;

      return {
        materialId: m ? m.id : inp.dataset.id,
        name: m ? m.name : inp.dataset.id,
        unit: m ? m.unit : 'Cái',
        qty,
        price,
        amount: qty * price,
      };
    });

    // 5. Kiểm tra số lượng và đơn giá
    const invalidItem = items.find(
      i => i.qty <= 0 || i.price <= 0
    );

    if (invalidItem) {
      Toast.err(
        'Giá báo chưa hợp lệ',
        `Vui lòng nhập đơn giá lớn hơn 0 cho tất cả vật tư.`
      );
      return;
    }

    // 6. Tính tổng giá trị báo giá
    const total = items.reduce(
      (sum, i) => sum + i.amount,
      0
    );

    // 7. Tạo mã báo giá NCC
    const id = nextCode(
      'BG-NCC-',
      DB.supplierQuotations
    );

    // 8. Lưu báo giá
    DB.supplierQuotations.unshift({
      id,
      prId,
      supplierId,
      date,
      validUntil,
      leadTimeDays,
      paymentTerm,
      selected: false,
      note: '',
      items,
      total,
    });

    // 9. Quay về màn hình Báo giá NCC
    Modal.close();

    F('purchases').tab = 'quotes';
    F('purchases').prId = prId;

    render();

    Toast.ok(
      'Đã lưu Báo giá nhà cung cấp',
      `${id} — ${Q.supplierName(supplierId)} (${fmtVND(total)})`
    );
  },
  'quote-select-winner': (d) => {
    const sq = DB.supplierQuotations.find(
      x => x.id === d.id
    );

    if (!sq) return;

    // 1. Bỏ chọn các báo giá khác của cùng PR
    DB.supplierQuotations
      .filter(x => x.prId === sq.prId)
      .forEach(x => {
        x.selected = false;
      });

    // 2. Chọn báo giá này
    sq.selected = true;

    Actions['pr-convert-po']({ id: sq.prId });
  },

  'po-approve-action': (d) => {
    if (!Auth.hasPermission('PURCHASE_PO_APPROVE')) {
      Toast.err('Không có quyền phê duyệt', 'Tài khoản hiện tại không có quyền duyệt PO.');
      return;
    }
    const po = Q.purchaseOrder(d.id);
    if (!po || po.status !== 'PENDING_APPROVAL') return;
    po.status = 'APPROVED';
    const pr = Q.purchase(po.prId);
    if (pr) pr.status = 'mh_da_dat_hang';
    Modal.close();
    go('purchases', { tab: 'po' });
    Toast.ok('Đã duyệt đơn mua hàng', `${po.id} · Có thể gửi cho nhà cung cấp`);
  },

  'open-po': (d) => openPOModal(d.id),
  'po-edit': (d) => openPOEditRequest(d.id),
  'po-cancel': async (d) => {
    if (!Auth.require('PURCHASE_PO_CREATE', 'Chỉ bộ phận Mua hàng được hủy PO.')) return;
    const po = Q.purchaseOrder(d.id);
    if (!po) return;
    if (['RECEIVED', 'PARTIAL_RECEIVED', 'SHIPPING', 'CANCELLED'].includes(po.status)) {
      Toast.err('Không thể hủy đơn', `${po.id} đang ở trạng thái ${statusLabel(po.status)}.`);
      return;
    }

    const poSnapshot = JSON.parse(JSON.stringify(po));
    const sourcePr = Q.purchase(po.prId);
    const prSnapshot = sourcePr ? JSON.parse(JSON.stringify(sourcePr)) : null;

    po.status = 'CANCELLED';
    po.cancelledAt = typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0,10);
    po.cancelledBy = DB.currentUser?.id || '';
    po.cancelledByUserId = DB.currentUser?.userId || '';
    po.cancelledByName = DB.currentUser?.name || '';
    po.cancelledAtIso = new Date().toISOString();
    po.cancelReason = 'Hủy đơn đặt hàng';

    if (sourcePr) {
      const otherActivePos = (DB.purchaseOrders || []).filter(x => x.prId === sourcePr.id && x.id !== po.id && x.status !== 'CANCELLED');
      if (!otherActivePos.length) {
        sourcePr.status = 'CANCELLED';
        sourcePr.cancelledAt = po.cancelledAtIso;
        sourcePr.cancelledByName = po.cancelledByName;
      }
      const affectedMaterialIds = new Set((po.items || []).map((item) => String(item.materialId)));
      (sourcePr.items || []).forEach((item) => {
        if (!affectedMaterialIds.has(String(item.materialId))) return;
        item.poHistory = Array.isArray(item.poHistory) ? item.poHistory : [];
        item.poHistory.push({
          action: 'PO_CANCELLED', poId: po.id, date: po.cancelledAt, replacementPrId: '',
          note: `Đơn ${po.id} đã bị hủy`,
        });
      });
    }

    try {
      if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.syncCollections) {
        await PurchaseAPI.syncCollections(['purchaseOrders','purchases']);
      }
    } catch (err) {
      Object.assign(po, poSnapshot);
      if (sourcePr && prSnapshot) Object.assign(sourcePr, prSnapshot);
      Toast.err('Hủy PO thất bại', `Server chưa lưu được trạng thái hủy. ${String(err?.message || err)}`);
      return;
    }

    Modal.close();
    render();
    Toast.ok('Đã hủy đơn đặt hàng', `${po.id} đã được lưu trạng thái Đã hủy trên server. Hệ thống sẽ không tự tạo lại PO thay thế.`);
  },
  'po-change-status': async (d) => {
    if (d.status === 'SENT_TO_SUPPLIER' && typeof ApprovalsAPI !== 'undefined') {
      await ApprovalsAPI.flushPending();
      await ApprovalsAPI.ensureFresh(['requests'], {force:true});
      await PurchaseAPI.ensureFresh(['purchases'], {force:true});
    }
    const po = Q.purchaseOrder(d.id);
    if (!po) return;
    if (['SENT_TO_SUPPLIER','SHIPPING'].includes(d.status) && !Auth.require('PURCHASE_PO_SEND', 'Tài khoản hiện tại không có quyền gửi/cập nhật PO với nhà cung cấp.')) return;
    if (d.status === 'SENT_TO_SUPPLIER' && !['READY_TO_SEND','APPROVED','PENDING_APPROVAL'].includes(po.status)) {
      Toast.err('Chưa thể gửi NCC', 'PO chưa ở trạng thái sẵn sàng gửi nhà cung cấp.'); return;
    }
    // Hàng rào hồi quy: PR từ 50 triệu trở lên bắt buộc phải có Ban giám đốc duyệt
    // trước khi PO được gửi NCC, kể cả với dữ liệu cũ từng lọt qua luồng cấp 2.
    if (d.status === 'SENT_TO_SUPPLIER') {
      const sourcePr = Q.purchase(po.prId);
      const prAmount = sourcePr ? Math.max(
        Number(sourcePr.total || 0),
        (sourcePr.items || []).reduce((sum, item) => sum + Number(item.amount || (Number(item.qty || 0) * Number(item.expectedPrice || item.price || 0))), 0)
      ) : 0;
      if (prAmount >= 50000000) {
        const directorApproved = typeof approvalPrHasDirectorApproval === 'function' && approvalPrHasDirectorApproval(sourcePr);
        if (!directorApproved) {
          Toast.err('Chưa duyệt cấp 2', `${po.prId} có giá trị ${fmtVND(prAmount)} nên phải được Ban giám đốc duyệt trước khi gửi PO cho NCC.`);
          return;
        }
      }
    }
    if (d.status === 'SHIPPING' && po.status !== 'SENT_TO_SUPPLIER') {
      Toast.err('Sai trạng thái', 'Chỉ PO đã gửi NCC mới được chuyển sang trạng thái NCC đang giao hàng.'); return;
    }
    po.status = d.status;
    render();
    Toast.ok('Đã cập nhật trạng thái PO', `${po.id} ➔ ${statusLabel(d.status)}`);
  },
  'po-evaluate-supplier': (d) => {
    const po = Q.purchaseOrder(d.id);
    if (!po || po.status !== 'RECEIVED') return;
    State.evaluatingPoId = po.id;
    const supplier = Q.supplier(po.supplierId);
    const existing = (DB.supplierEvaluationHistory || []).find(e => e.poId === po.id);
    Modal.open({
      title: 'Đánh giá nhà cung cấp',
      sub: `${po.id} · ${esc(supplier?.name || po.supplierId)}`,
      size: 'sm',
      body: `<div class="form-grid"><div class="field"><label>Điểm đánh giá (0–5) <span class="req">*</span></label><input class="inp num" id="poEvalScore" type="number" min="0" max="5" step="0.1" value="${existing?.score ?? ''}" placeholder="Ví dụ 4.5"></div><div class="field" style="grid-column:1/-1"><label>Nhận xét</label><textarea class="inp" id="poEvalNote" rows="4" placeholder="Chất lượng, giao hàng, thái độ phối hợp…">${esc(existing?.notes || '')}</textarea></div></div>`,
      foot: '<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="po-evaluate-supplier-save" data-id="'+po.id+'"><i class="fa-solid fa-star"></i>Lưu đánh giá</button>'
    });
  },
  'po-evaluate-supplier-save': (d) => {
    const po = Q.purchaseOrder(d.id); if (!po || po.status !== 'RECEIVED') return;
    const score = Number($('#poEvalScore')?.value); const note = $('#poEvalNote')?.value.trim() || '';
    if (!Number.isFinite(score) || score < 0 || score > 5) { Toast.err('Điểm không hợp lệ', 'Vui lòng nhập điểm từ 0 đến 5.'); return; }
    const supplier = Q.supplier(po.supplierId); if (!supplier) return;
    DB.supplierEvaluationHistory = DB.supplierEvaluationHistory || [];
    const idx = DB.supplierEvaluationHistory.findIndex(e => e.poId === po.id);
    const row = { id: idx >= 0 ? DB.supplierEvaluationHistory[idx].id : nextCode('DGNCC-', DB.supplierEvaluationHistory), supplierId: supplier.id, poId: po.id, date: DB.today, score, notes: note };
    if (idx >= 0) DB.supplierEvaluationHistory[idx] = row; else DB.supplierEvaluationHistory.unshift(row);
    let evaluation = Q.supplierEvaluation(supplier.id);
    if (!evaluation) { evaluation = { supplierId: supplier.id, totalScore: score, ratingLabel: '', notes: note }; DB.supplierEvaluations.unshift(evaluation); }
    evaluation.totalScore = score; evaluation.notes = note; evaluation.ratingLabel = score >= 4.6 ? 'Xuất sắc' : score >= 4 ? 'Tốt' : score >= 3 ? 'Khá' : 'Đánh giá thấp';
    supplier.rating = score; supplier.ratingStatus = 'RATED';
    Modal.close(); render(); Toast.ok('Đã đánh giá nhà cung cấp', `${supplier.name} · ${score.toFixed(1)}/5`);
  },
  'supplier-evaluation-save': (d) => {
    const supplier = Q.supplier(d.id);
    if (!supplier) return;
    const score = Number($(`.supplier-rating-input[data-supplier-id="${d.id}"]`)?.value);
    const note = $(`.supplier-rating-note[data-supplier-id="${d.id}"]`)?.value?.trim() || '';
    if (!Number.isFinite(score) || score < 0 || score > 5) {
      Toast.err('Điểm đánh giá không hợp lệ', 'Vui lòng nhập điểm từ 0 đến 5.');
      return;
    }
    let evaluation = Q.supplierEvaluation(d.id);
    if (!evaluation) {
      evaluation = { supplierId: d.id, priceScore: score, deliveryScore: score, qualityScore: score, fulfillmentScore: score, stabilityScore: score, totalScore: score, ratingLabel: '', notes: note };
      DB.supplierEvaluations.unshift(evaluation);
    } else {
      evaluation.totalScore = score;
      evaluation.notes = note;
      evaluation.priceScore = score;
      evaluation.deliveryScore = score;
      evaluation.qualityScore = score;
      evaluation.fulfillmentScore = score;
      evaluation.stabilityScore = score;
    }
    evaluation.ratingLabel = score >= 4.6 ? 'Xuất sắc' : score >= 4.0 ? 'Tốt' : score >= 3.0 ? 'Khá' : 'Đánh giá thấp';
    supplier.rating = score;
    supplier.ratingStatus = 'RATED';
    DB.supplierEvaluationHistory = DB.supplierEvaluationHistory || [];
    const poId = State.evaluatingPoId || '';
    if (poId) DB.supplierEvaluationHistory.unshift({ id: nextCode('DGNCC-', DB.supplierEvaluationHistory), supplierId: supplier.id, poId, date: DB.today, score, notes: note });
    State.evaluatingPoId = null;
    render();
    Toast.ok('Đã cập nhật đánh giá nhà cung cấp', `${supplier.name} · ${score.toFixed(1)}/5`);
  },
  'po-to-receipt': (d) => {
    const po = Q.purchaseOrder(d.id);
    if (!po || !['SHIPPING', 'PARTIAL_RECEIVED'].includes(po.status)) {
      Toast.err('PO chưa sẵn sàng nhập kho', 'Chỉ đơn đang giao hoặc đã nhận một phần mới được lập phiếu nhập kho.');
      return;
    }
    Modal.close();
    go('warehouse', { tab: 'receipts' });
    Toast.info('Đơn hàng đã sẵn sàng nhập kho', `${po.id} đang nằm trong danh sách chờ lập phiếu nhập kho.`);
  },
  'inv-po-receipt-history': (d) => openPoReceiptHistory(d.id),
  'inventory-stock-tab': (d) => { const f=F('inventory'); f.stockTab=d.tab||'raw'; f.category=''; f.stockStatus=''; f.expandedProductId=''; State.page.inventory=1; render(); },
  'inventory-receipt-tab': (d) => { F('inv-receipts').receiptTab = d.tab || 'raw'; State.page['inv-receipts'] = 1; render(); },
  'inventory-issue-tab': (d) => { F('inv-issues').issueTab = d.tab || 'raw'; State.page['inv-issues'] = 1; render(); },
  'inv-stock-product-toggle': async (d) => {
    const f=F('inventory');
    const opening = f.expandedProductId !== d.productid;
    f.expandedProductId = opening ? d.productid : '';
    // Chỉ khi người dùng thực sự mở chi tiết lô mới tải bảng lô/kho/vị trí.
    // Không kéo các bảng này chỉ để hiển thị danh sách Tồn kho.
    if (opening && typeof InventoryAPI !== 'undefined') {
      try { await InventoryAPI.ensureFresh?.(['inventoryLots','warehouses','warehouseLocations'], {force:false}); }
      catch (err) { console.warn('[Warehouse] Không lazy-load được chi tiết lô:', err); }
    }
    render();
  },
  'inv-stock-lot-view': async (d) => {
    // Lịch sử lô là dữ liệu thật trên server. Chỉ khi người dùng mở chi tiết lô
    // mới lazy-load 2 collection cần thiết để không làm chậm màn Tồn kho.
    try {
      const jobs = [];
      if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.ensureFresh)
        jobs.push(PurchaseAPI.ensureFresh(['goodsReceipts'], { force:false }));
      if (typeof InventoryAPI !== 'undefined' && InventoryAPI.ensureFresh)
        jobs.push(InventoryAPI.ensureFresh(['inventoryTransactions'], { force:false }));
      if (jobs.length) await Promise.all(jobs);
    } catch (err) {
      console.warn('[Inventory] Không tải đủ lịch sử lô từ server, dùng dữ liệu hiện có:', err);
    }
    openInventoryStockLotDetail(d.productid, d.lotid);
  },
  'po-goods-receipt-save': () => {
    const poId = $('#poGrPo')?.value || '';
    const po = Q.purchaseOrder(poId);
    if (!po || !['SHIPPING', 'PARTIAL_RECEIVED'].includes(po.status)) { Toast.err('PO không hợp lệ', 'Vui lòng chọn đơn hàng đang giao hoặc nhận một phần.'); return; }
    const date = $('#poGrDate')?.value || DB.today;
    const warehouseId = $('#poGrWarehouse')?.value || '';
    const warehouse = Q.warehouse(warehouseId);
    if (!warehouse || warehouse.type !== 'RAW_MATERIAL') { Toast.err('Sai loại kho', 'Phiếu nhập từ đơn đặt hàng chỉ được nhập vào kho nguyên liệu.'); return; }
    const receiver = DB.currentUser?.id || ''; // [AUDIT] Người nhập kho luôn là actor đang đăng nhập.
    const note = $('#poGrNote')?.value.trim() || `Nhập kho theo đơn ${po.id}`;
    const locationId = $('#poGrLocation')?.value || '';
    const location = Q.warehouseLocation(locationId);
    if (!location || location.warehouseId !== warehouseId) { Toast.err('Chưa chọn kệ / vị trí', 'Vui lòng chọn kệ lưu trữ thuộc đúng kho nhận hàng.'); return; }

    // Pha 1: kiểm tra TOÀN BỘ phiếu trước khi ghi tồn/lô để tránh nhập dở dang.
    const draft = [];
    const draftSystemLots = new Set();
    // [LOT VALIDATION] Mã lô SP/NCC có thể trùng giữa các sản phẩm khác nhau, kể cả cùng danh mục.
    // Chỉ coi là trùng thật khi cùng tên sản phẩm + cùng danh mục + cùng NSX + cùng HSD.
    // Không thay đổi logic tạo lô hệ thống, nhập kho hay QC.
    for (const input of $$('.po-gr-qty')) {
      const mid = input.dataset.mid;
      const qty = Number(input.value) || 0;
      if (qty <= 0) continue;
      const poItem = (po.items || []).find(i => i.materialId === mid);
      if (!poItem) continue;
      const remain = Math.max(0, Number(poItem.qty || 0) - Number(poItem.receivedQty || 0));
      if (qty > remain) { Toast.err('Số lượng vượt PO', `${poItem.name}: còn được nhập tối đa ${fmtN(remain)} ${poItem.unit}.`); return; }
      const lotNumber = $(`.po-gr-lot[data-mid="${mid}"]`)?.value.trim() || '';
      const supplierLot = ''; // Tạm thời chỉ dùng lô hệ thống; không yêu cầu lô NCC.
      const mfgDate = $(`.po-gr-mfg[data-mid="${mid}"]`)?.value || '';
      const expiryDate = $(`.po-gr-exp[data-mid="${mid}"]`)?.value || '';
      if (!lotNumber) { Toast.err('Thiếu lô hệ thống', `${poItem.name} chưa có lô hệ thống.`); return; }
      if (Q.lotByNumber(lotNumber) || draftSystemLots.has(lotNumber.toLowerCase())) { Toast.err('Lô hệ thống bị trùng', `${lotNumber} đã tồn tại hoặc bị lặp trong phiếu. Lô hệ thống phải duy nhất.`); return; }
      draftSystemLots.add(lotNumber.toLowerCase());
      if (!mfgDate || !expiryDate) { Toast.err('Thiếu ngày lô', `${poItem.name}: phải nhập đầy đủ NSX và HSD.`); return; }
      if (expiryDate < mfgDate) { Toast.err('Hạn sử dụng không hợp lệ', `${poItem.name}: HSD phải sau hoặc bằng NSX.`); return; }

      draft.push({ materialId: mid, poItem, qty, lotNumber, supplierLot, mfgDate, expiryDate });
    }
    if (!draft.length) { Toast.err('Chưa nhập số lượng', 'Vui lòng nhập ít nhất một nguyên liệu có số lượng lớn hơn 0.'); return; }

    // Pha 2: chỉ ghi nhận phiếu nhập + lô chờ QC. CHƯA cộng vào tồn kho.
    // Tồn kho chỉ được tạo/cộng sau khi kiểm tra đầu vào xác nhận phần hàng đạt.
    const received = [];
    for (const d of draft) {
      const lot = { id: nextCode('LOT-', DB.inventoryLots), lotNumber: d.lotNumber, productId: d.materialId, productionOrderId: '', mfgDate: d.mfgDate, expiryDate: d.expiryDate, supplierLot: d.supplierLot, supplierId: po.supplierId, qcStatus: 'QC_PENDING', status: 'active', createdAt: `${date} 09:00` };
      DB.inventoryLots.unshift(lot);
      d.poItem.receivedQty = Number(d.poItem.receivedQty || 0) + d.qty;
      // Ghi nhận hàng đã hiện diện vật lý trong kho nhưng chưa được cộng vào tồn khả dụng.
      // Dòng này giúp màn Tồn kho thấy ngay lô đang chờ QC và vẫn tồn tại sau refresh.
      const pendingRow = {
        productId: d.materialId,
        warehouseId,
        locationId: location.id,
        lotId: lot.id,
        qtyOnHand: 0,
        qtyReserved: 0,
        qtyAvailable: 0,
        qtyPending: d.qty,
        qtyRejected: 0,
        receivedQty: d.qty,
        unit: d.poItem.unit || Q.material(d.materialId)?.unit || '',
        lastUpdated: `${date} 09:00`
      };
      DB.inventory.push(pendingRow);
      received.push({ materialId: d.materialId, name: d.poItem.name, unit: d.poItem.unit, qty: d.qty, price: d.poItem.price, amount: d.qty * Number(d.poItem.price || 0), lotId: lot.id, lotNumber: d.lotNumber, supplierLot: d.supplierLot, mfgDate: d.mfgDate, expiryDate: d.expiryDate, locationId: location.id, qcStatus: 'QC_PENDING', stockPostedQty: 0 });
      DB.purchasePriceHistory.unshift({ id: nextCode('PPH-', DB.purchasePriceHistory), materialId: d.materialId, supplierId: po.supplierId, poId: po.id, date, qty: d.qty, price: d.poItem.price, amount: d.qty * Number(d.poItem.price || 0) });
    }
    const allDone = (po.items || []).every(i => Number(i.receivedQty || 0) >= Number(i.qty || 0));
    po.status = allDone ? 'RECEIVED' : 'PARTIAL_RECEIVED';
    const grId = nextCode('PN-2026-', DB.goodsReceipts);
    DB.goodsReceipts.unshift({ id: grId, poId: po.id, prId: po.prId, supplierId: po.supplierId, date, receivedBy: receiver, createdBy:DB.currentUser?.userId||DB.currentUser?.id||'', createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''), warehouse: Q.warehouseName(warehouseId), warehouseId, locationId: location.id, location: Q.locationName(location.id), status: po.status, inspectionStatus: 'PENDING', inspectedAt: '', inspectedBy: '', note, items: received });
    Modal.close();
    go('warehouse', { tab: 'receipts' });
    Toast.ok('Đã lập phiếu nhập kho', `${grId} · ${po.id} · đang chờ kiểm tra đầu vào trước khi cộng tồn kho.`);
  },
  'warehouse-receipt-save': (d) => {
    const receiptTab = d.tab === 'finished' ? 'finished' : 'semi';
    const whType = receiptTab === 'finished' ? 'FINISHED_GOODS' : 'SEMI_FINISHED';
    const warehouseId = $('#whGrWarehouse')?.value || '';
    const warehouse = Q.warehouse(warehouseId);
    const locationId = $('#whGrLocation')?.value || '';
    const location = Q.warehouseLocation(locationId);
    const productId = $('#whGrProduct')?.value || '';
    const product = Q.product(productId);
    const qty = Number($('#whGrQty')?.value) || 0;
    const systemLot = $('#whGrSystemLot')?.value.trim() || '';
    const mfgDate = $('#whGrMfg')?.value || DB.today;
    const expiryDate = $('#whGrExp')?.value || '';
    const date = $('#whGrDate')?.value || DB.today;
    const ref = $('#whGrRef')?.value.trim() || '';
    const note = $('#whGrNote')?.value.trim() || `Nhập kho ${receiptTab === 'finished' ? 'thành phẩm' : 'bán thành phẩm'}`;
    const receiver = $('#whGrReceiver')?.value || DB.currentUser.id;
    if (!warehouse || warehouse.type !== whType) { Toast.err('Sai loại kho', 'Vui lòng chọn kho đúng loại phiếu nhập.'); return; }
    if (!location || location.warehouseId !== warehouseId) { Toast.err('Thiếu kệ / vị trí', 'Vui lòng chọn vị trí thuộc đúng kho.'); return; }
    if (!product || qty <= 0) { Toast.err('Thiếu thông tin', 'Vui lòng chọn sản phẩm và nhập số lượng lớn hơn 0.'); return; }
    if (!systemLot) { Toast.err('Thiếu lô hệ thống', 'Vui lòng nhập mã lô hệ thống.'); return; }
    if (Q.lotByNumber(systemLot)) { Toast.err('Lô hệ thống bị trùng', `${systemLot} đã tồn tại.`); return; }
    if (expiryDate && expiryDate < mfgDate) { Toast.err('HSD không hợp lệ', 'Hạn sử dụng phải sau hoặc bằng ngày sản xuất.'); return; }
    const lot = { id: nextCode('LOT-', DB.inventoryLots), lotNumber: systemLot, productId, productionOrderId: ref, mfgDate, expiryDate, supplierLot: '', supplierId: '', qcStatus: 'PASSED', status: 'active', createdAt: `${date} 09:00` };
    DB.inventoryLots.unshift(lot);
    const posted = InventoryService.apply({ productId, warehouseId, locationId, lotId: lot.id, quantity: qty, type: 'PRODUCTION_RECEIPT', refType: receiptTab === 'finished' ? 'FINISHED_GOODS' : 'SEMI_FINISHED', refId: ref || systemLot, note, userId: receiver });
    if (!posted.ok) { Toast.err('Không thể nhập kho', posted.message); return; }
    const grId = nextCode('PN-2026-', DB.goodsReceipts);
    DB.goodsReceipts.unshift({ id: grId, poId: '', prId: '', date, receivedBy: receiver, createdBy:DB.currentUser?.userId||DB.currentUser?.id||'', createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''), warehouse: Q.warehouseName(warehouseId), warehouseId, locationId, location: Q.locationName(locationId), status: 'RECEIVED', inspectionStatus: 'PASSED', note, items: [{ materialId: productId, name: product.name, unit: product.unit, qty, lotId: lot.id, lotNumber: systemLot, supplierLot: '', mfgDate, expiryDate, locationId }] });
    Modal.close();
    F('inv-receipts').receiptTab = receiptTab;
    go('warehouse', { tab: 'receipts' });
    Toast.ok('Đã nhập kho thành công', `${grId} · ${product.name} · ${fmtN(qty)} ${product.unit}`);
  },
  'iqc-open-inspection': async (d) => {
    // [SERVER-FIRST IQC DETAIL] Luôn lấy phiếu nhập + lô/tồn hiện tại từ server
    // trước khi dựng form, kể cả mở từ Tổng quan QC.
    try {
      const jobs = [];
      if (typeof PurchaseAPI !== 'undefined') {
        await PurchaseAPI.bootstrap?.();
        jobs.push(PurchaseAPI.ensureFresh?.(['goodsReceipts','purchaseOrders','suppliers'], { force: false }));
      }
      if (typeof InventoryAPI !== 'undefined') {
        await InventoryAPI.bootstrap?.();
        jobs.push(InventoryAPI.ensureFresh?.(['materials','inventoryLots','inventory','warehouses','warehouseLocations'], { force: false }));
      }
      await Promise.allSettled(jobs.filter(Boolean));
    } catch (err) {
      console.warn('[IQC] Không tải đủ dữ liệu server:', err);
      Toast.err('Không tải được phiếu kiểm tra', 'Vui lòng thử lại. Không mở dữ liệu cũ để tránh kiểm tra sai.');
      return;
    }
    openIncomingInspectionModal(d.id);
  },
  'iqc-save-inspection': (d) => {
    const receipt = (DB.goodsReceipts || []).find(r => r.id === d.id);
    if (!receipt) return;
    if (receipt.inspectionStatus && receipt.inspectionStatus !== 'PENDING') { Toast.warn('Đợt nhập đã kiểm tra', `${receipt.id} đã có kết quả kiểm tra đầu vào.`); return; }
    // Người kiểm tra luôn là actor đang đăng nhập. Không cho chọn thay người khác để bảo toàn dấu vết audit.
    const inspector = DB.currentUser.id;
    const note = $('#iqcNote')?.value.trim() || '';
    const results = [];
    let failedLines = 0;
    let totalAcceptedQty = 0;

    // Kiểm tra toàn bộ trước khi ghi tồn để tránh tình trạng cập nhật dở dang.
    const plans = [];
    for (const item of (receipt.items || [])) {
      const failQty = Number($(`.iqc-fail-qty[data-mid="${item.materialId}"]`)?.value || 0);
      if (!Number.isFinite(failQty) || failQty < 0 || failQty > Number(item.qty || 0)) {
        Toast.err('Số lượng không hợp lệ', `${item.name}: SL không đạt/trả phải từ 0 đến ${fmtN(item.qty)} ${item.unit || ''}.`);
        return;
      }
      const result = failQty > 0 ? 'FAILED' : 'PASSED';
      const reason = $(`.iqc-reason[data-mid="${item.materialId}"]`)?.value.trim() || '';
      const acceptedQty = Math.max(0, Number(item.qty || 0) - failQty);
      plans.push({ item, result, failQty, acceptedQty, reason });
    }

    // Chỉ phần đạt QC mới được cộng vào tồn kho. Phần lỗi không tạo dòng tồn 0.
    for (const plan of plans) {
      const { item, result, failQty, acceptedQty, reason } = plan;
      const lot = Q.lot(item.lotId);
      if (lot) lot.qcStatus = failQty > 0 ? (acceptedQty > 0 ? 'PARTIAL_FAILED' : 'FAILED') : 'PASSED';
      item.qcStatus = result;
      item.failedQty = failQty;
      item.acceptedQty = acceptedQty;
      item.qcReason = reason;
      const pendingInv = (DB.inventory || []).find(r => r.productId === item.materialId && r.warehouseId === receipt.warehouseId && r.locationId === (item.locationId || receipt.locationId) && r.lotId === item.lotId);
      if (pendingInv) {
        pendingInv.receivedQty = Number(pendingInv.receivedQty || item.qty || 0);
        pendingInv.qtyPending = 0;
        pendingInv.qtyRejected = failQty;
        pendingInv.lastUpdated = `${DB.today} 09:00`;
      }

      if (acceptedQty > 0) {
        const posted = InventoryService.apply({
          productId: item.materialId,
          warehouseId: receipt.warehouseId,
          locationId: item.locationId || receipt.locationId,
          lotId: item.lotId,
          quantity: acceptedQty,
          type: 'RECEIPT',
          refType: 'PO_QC',
          refId: receipt.poId || receipt.id,
          note: `Nhập tồn sau QC đạt · ${receipt.id}`,
          userId: receipt.receivedBy || inspector
        });
        if (!posted.ok) { Toast.err('Không thể cộng tồn sau QC', posted.message); return; }
        posted.row.qtyPending = 0;
        posted.row.qtyRejected = failQty;
        posted.row.receivedQty = Number(posted.row.receivedQty || item.qty || 0);
        posted.row.qtyAvailable = Math.max(0, Number(posted.row.qtyOnHand || 0) - Number(posted.row.qtyReserved || 0));
        item.stockPostedQty = acceptedQty;
        totalAcceptedQty += acceptedQty;
        DB.stockMoves.unshift({
          id: nextCode('PN-2026-', DB.stockMoves.filter(x => x.type === 'in')),
          type: 'in', date: receipt.date || DB.today, materialId: item.materialId, qty: acceptedQty,
          ref: receipt.poId || receipt.id, by: receipt.receivedBy || inspector,
          note: `QC đạt · ${receipt.id}`
        });
      } else {
        item.stockPostedQty = 0;
        if (pendingInv) {
          pendingInv.qtyOnHand = 0;
          pendingInv.qtyAvailable = 0;
          pendingInv.qtyPending = 0;
          pendingInv.qtyRejected = failQty;
          pendingInv.receivedQty = Number(pendingInv.receivedQty || item.qty || 0);
        }
      }

      results.push({ materialId: item.materialId, lotId: item.lotId, qty: item.qty, result, failedQty: failQty, acceptedQty, reason });
      if (failQty > 0) {
        failedLines++;
        const reqId = nextCode('YCT-2026-', DB.materialReturnRequests || []);
        (DB.materialReturnRequests || (DB.materialReturnRequests=[])).unshift({
          id: reqId, receiptId: receipt.id, poId: receipt.poId, supplierId: Q.purchaseOrder(receipt.poId)?.supplierId || '',
          materialId: item.materialId, lotId: item.lotId, supplierLot: item.supplierLot || lot?.supplierLot || '', qty: failQty, unit: item.unit,
          warehouseId: receipt.warehouseId, locationId: item.locationId || receipt.locationId, reason: reason || 'Không đạt kiểm tra đầu vào',
          requestedBy: inspector, requestedDate: currentDateYMD(), status: 'PENDING_WAREHOUSE', issueId: '', stockPosted: false
        });
      }
    }
    receipt.inspectionStatus = failedLines ? (failedLines === (receipt.items || []).length && totalAcceptedQty === 0 ? 'FAILED' : 'PARTIAL_FAILED') : 'PASSED';
    const totalReceiptQty = (receipt.items || []).reduce((n,i)=>n+Number(i.qty||0),0);
    const totalFailedQty = results.reduce((n,i)=>n+Number(i.failedQty||0),0);
    receipt.acceptedQty = totalAcceptedQty;
    receipt.defectType = totalFailedQty > 0 ? (totalFailedQty >= totalReceiptQty ? 'FULL_LOT' : 'PARTIAL') : '';
    receipt.defectNote = receipt.defectType === 'FULL_LOT' ? 'Lỗi nguyên lô' : receipt.defectType === 'PARTIAL' ? 'Lỗi 1 phần' : '';
    const inspectedPo = Q.purchaseOrder(receipt.poId);
    if (inspectedPo && receipt.defectNote) inspectedPo.qualityNote = receipt.defectNote;
    receipt.inspectedAt = new Date().toISOString();
    receipt.inspectedBy = inspector;
    receipt.inspectionNote = note;
    (DB.materialInspections || (DB.materialInspections=[])).unshift({ id: nextCode('KNNL-2026-', DB.materialInspections || []), receiptId: receipt.id, poId: receipt.poId, date: currentDateYMD(), inspectorId: inspector, createdBy:DB.currentUser?.userId||DB.currentUser?.id||'', createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''), status: receipt.inspectionStatus, note, items: results });
    Modal.close(); go('quality', { tab: 'iqc' });
    Toast.ok('Đã lưu kiểm tra nguyên liệu', failedLines
      ? `${receipt.id} · đã cộng ${fmtN(totalAcceptedQty)} hàng đạt vào tồn kho và tạo yêu cầu trả cho phần không đạt.`
      : `${receipt.id} · QC đạt, đã cộng ${fmtN(totalAcceptedQty)} vào tồn kho.`);
  },
  'inv-return-confirm-issue': async (d) => {
    const req = (DB.materialReturnRequests || []).find(r => r.id === d.id);
    if (!req || req.status !== 'PENDING_WAREHOUSE') return;
    // Hàng không đạt QC chưa được cộng vào tồn kho, nên xuất trả không trừ tồn lần nữa.
    // Tương thích dữ liệu cũ: nếu yêu cầu trả đã phát sinh từ lượng từng được ghi tồn, vẫn trừ như trước.
    if (req.stockPosted !== false) {
      const inv = DB.inventory.find(r => r.productId === req.materialId && r.warehouseId === req.warehouseId && r.locationId === req.locationId && r.lotId === req.lotId);
      if (!inv || Number(inv.qtyOnHand || 0) < Number(req.qty || 0)) { Toast.err('Không đủ tồn để trả', `${Q.material(req.materialId)?.name || req.materialId} không còn đủ số lượng tại đúng lô/kệ đã nhập.`); return; }
    }
    const issueId = nextCode('PX-2026-', DB.goodsIssues);
    if (req.stockPosted !== false) {
      const posted = InventoryService.apply({ productId: req.materialId, warehouseId: req.warehouseId, locationId: req.locationId, lotId: req.lotId, quantity: req.qty, type: 'RETURN_OUT', refType: 'RETURN_REQUEST', refId: req.id, note: `Xuất trả NCC theo ${req.id}`, userId: DB.currentUser.id });
      if (!posted.ok) { Toast.err('Không thể xuất trả', posted.message); return; }
    }
    // Với hàng lỗi chưa từng được cộng tồn, chỉ xóa lượng cách ly/không đạt khỏi dòng lô.
    // Sau khi đã trả NCC, ghi chú "không đạt" trên màn Tồn kho phải biến mất.
    const rejectedInv = (DB.inventory || []).find(r => r.productId === req.materialId && r.warehouseId === req.warehouseId && r.locationId === req.locationId && r.lotId === req.lotId);
    if (rejectedInv) {
      rejectedInv.qtyRejected = Math.max(0, Number(rejectedInv.qtyRejected || 0) - Number(req.qty || 0));
      rejectedInv.qtyPending = Math.max(0, Number(rejectedInv.qtyPending || 0));
      rejectedInv.lastUpdated = `${DB.today} 09:00`;
      if (Number(rejectedInv.qtyOnHand || 0) <= 0 && Number(rejectedInv.qtyPending || 0) <= 0 && Number(rejectedInv.qtyRejected || 0) <= 0) {
        const idx = DB.inventory.indexOf(rejectedInv);
        if (idx >= 0) DB.inventory.splice(idx, 1);
      }
    }
    DB.goodsIssues.unshift({ id: issueId, type: 'RETURN_OUT', warehouseId: req.warehouseId, refDoc: req.poId, poId: req.poId, returnRequestId: req.id, receiptId: req.receiptId, date: DB.today, status: 'COMPLETED', createdBy: DB.currentUser.id, note: req.reason || `Xuất trả NCC theo ${req.id}`, items: [{ productId: req.materialId, lotId: req.lotId, qty: req.qty, locationId: req.locationId, unit: req.unit }] });
    req.status = 'COMPLETED'; req.issueId = issueId; req.completedAt = DB.today; req.completedBy = DB.currentUser.id;
    (DB.materialReturnHistory || (DB.materialReturnHistory=[])).unshift({ id: req.id, issueId, receiptId: req.receiptId, poId: req.poId, createdBy:DB.currentUser?.userId||DB.currentUser?.id||'', createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''), materialId: req.materialId, lotId: req.lotId, supplierLot: req.supplierLot, qty: req.qty, unit: req.unit, date: DB.today, reason: req.reason, status: 'RETURNED' });
    const po = Q.purchaseOrder(req.poId);
    if (po) {
      const receipt = (DB.goodsReceipts || []).find(r=>r.id===req.receiptId);
      po.qualityNote = receipt?.defectNote || po.qualityNote || 'Có nguyên liệu trả NCC';
      po.returnedQty = Number(po.returnedQty||0) + Number(req.qty||0);
      // Lưu luôn GIÁ TRỊ trả hàng theo đúng giá PO + VAT trên chính PO.
      // Kế toán chỉ cần đọc lenam_purchase_orders vẫn tính được NCC phải hoàn lại,
      // không phụ thuộc việc user đã mở Kho để hydrate goodsIssues hay chưa.
      const returnPoItem = (po.items || []).find(i => String(i.materialId) === String(req.materialId));
      const returnUnitPrice = Number(returnPoItem?.price || 0);
      const returnVatRate = Number(returnPoItem?.vatRate != null ? returnPoItem.vatRate : (po.vatRate || 0));
      const returnGross = Math.round(Number(req.qty || 0) * returnUnitPrice * (1 + returnVatRate / 100));
      po.returnedGrossValue = Math.max(0, Number(po.returnedGrossValue || 0)) + Math.max(0, returnGross);
      po.returnedAt = new Date().toISOString();
      po.returnedBy = DB.currentUser?.userId || DB.currentUser?.id || '';
      // Không giảm receivedQty và không mở lại quyền lập phiếu nhập nếu PO đã nhận đủ.
      // Persist PO ngay trước khi báo thành công để role Mua hàng/F5 đọc được trạng thái
      // "Đã nhận đủ, trả hàng 1 phần" trực tiếp từ lenam_purchase_orders.
      try {
        // Hoàn tất trả NCC chỉ báo thành công khi cả chứng từ Kho và trạng thái PO
        // đã được ghi thật lên KIO. Kế toán/Mua hàng đổi role ngay sau đó sẽ đọc
        // được cùng dữ liệu server, không phụ thuộc timer/local cache.
        const writes=[];
        if (typeof InventoryAPI !== 'undefined' && InventoryAPI.syncCollections) {
          writes.push(InventoryAPI.syncCollections(['goodsIssues','inventory','inventoryTransactions','materialReturnRequests','materialReturnHistory']));
        }
        if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.syncCollections) {
          writes.push(PurchaseAPI.syncCollections(['purchaseOrders']));
        }
        await Promise.all(writes);
      } catch (err) {
        Toast.err('Chưa lưu được trả NCC lên server', err?.message || 'Vui lòng thử lại.');
        return;
      }
    }
    render(); Toast.ok('Đã xác nhận xuất trả nguyên liệu', `${issueId} · ${req.id} · ${fmtN(req.qty)} ${req.unit || ''}`);
  },
  'po-create-return-pr': async (d) => {
    const po = Q.purchaseOrder(d.id);
    if (!po) return;
    const returned = (DB.goodsIssues || []).filter(x => x.type === 'RETURN_OUT' && (x.refDoc === po.id || x.poId === po.id));
    if (!returned.length) {
      Toast.warn('Chưa có hàng trả', `${po.id} chưa phát sinh phiếu xuất trả nguyên liệu.`);
      return;
    }
    const qtyByMaterial = {};
    returned.forEach(r => (r.items || []).forEach(it => {
      const materialId = it.productId || it.materialId;
      if (!materialId) return;
      qtyByMaterial[materialId] = (qtyByMaterial[materialId] || 0) + Number(it.qty || 0);
    }));
    const materialIds = Object.keys(qtyByMaterial);
    if (!materialIds.length) {
      Toast.warn('Không có nguyên liệu', 'Không tìm thấy nguyên liệu cần mua bù từ lịch sử trả hàng.');
      return;
    }
    await PurchasePRMasterData.ensure();
    const sourcePr = Q.purchase(po.prId);
    State.prEditingExistingPrId = null;
    State.prEditingPoId = null;
    State.prEditingPrId = null;
    State.prEditingSupplierId = null;
    State.prFormMaterials = materialIds.map(materialId => {
      const material = Q.material(materialId) || {};
      const poItem = (po.items || []).find(i => String(i.materialId) === String(materialId)) || {};
      return { ...material, id: materialId, name: poItem.name || material.name || materialId, unit: poItem.unit || material.unit || '', supplierId: '', supplierIds: [] };
    });
    State.prFormDraft = {
      dept: sourcePr?.dept || 'Sản xuất',
      requester: sourcePr?.requesterId || DB.currentUser.id,
      expectedDate: addDays(DB.today, 7),
      reason: `Mua bù nguyên liệu đã trả từ ${po.id}`,
      quantities: Object.fromEntries(materialIds.map(id => [id, qtyByMaterial[id]])),
      prices: Object.fromEntries(materialIds.map(id => {
        const poItem = (po.items || []).find(i => String(i.materialId) === String(id));
        return [id, Number(poItem?.price || Q.material(id)?.price || 0)];
      })),
    };
    Modal.close();
    openPRForm(null);
    Toast.info('Đã chuẩn bị đề nghị mua thêm', `Các nguyên liệu đã trả của ${po.id} đã được đưa vào đề nghị mới. Kiểm tra lại rồi bấm Gửi đề nghị mua.`);
  },
  'po-receive-goods': (d) => Actions['po-to-receipt'](d),
  'goods-receipt-save': (d) => {
    const po = Q.purchaseOrder(d.poid);
    if (!po) return;
    const inputs = $$('.gr-qty');
    let totalCount = 0;
    const itemsReceived = [];
    const planned = [];
    inputs.forEach((inp) => {
      const mid = inp.dataset.id;
      const qty = Number(inp.value) || 0;
      if (qty > 0) {
        totalCount += qty;
        const poItem = po.items.find((i) => i.materialId === mid);
        if (poItem) planned.push({ mid, qty, poItem });
      }
    });

    if (!totalCount) { Toast.err('Chưa nhập số lượng', 'Vui lòng nhập số lượng thực nhận lớn hơn 0.'); return; }
    const warehouseId = $('#grWarehouse')?.value || 'WH-001';
    const location = Q.locationsOf(warehouseId)[0];
    if (!location) { Toast.err('Kho chưa có vị trí', 'Vui lòng cấu hình vị trí lưu trữ trước khi nhập hàng.'); return; }
    const prepared = planned.map(({ mid, qty, poItem }) => {
      let lot = DB.inventoryLots.find((item) => item.productId === mid && item.lotNumber === `LOT-PO-${po.id}-${mid}`);
      if (!lot) {
        lot = { id: nextCode('LOT-', DB.inventoryLots), lotNumber: `LOT-PO-${po.id}-${mid}`, productId: mid, productionOrderId: '', mfgDate: DB.today, expiryDate: addDays(DB.today, 365), supplierLot: '', supplierId: po.supplierId, qcStatus: 'QC_PENDING', status: 'active', createdAt: DB.today + ' 09:00' };
        DB.inventoryLots.unshift(lot);
      }
      return { mid, qty, poItem, lot };
    });
    for (const item of prepared) {
      const posted = InventoryService.apply({ productId: item.mid, warehouseId, locationId: location.id, lotId: item.lot.id, quantity: item.qty, type: 'RECEIPT', refType: 'PO', refId: po.id, note: `Nhập kho theo đơn PO ${po.id}`, userId: $('#grReceiver')?.value || DB.currentUser.id });
      if (!posted.ok) { Toast.err('Không thể nhập kho', posted.message); return; }
      item.poItem.receivedQty = (item.poItem.receivedQty || 0) + item.qty;
      itemsReceived.push({ materialId: item.mid, name: item.poItem.name, unit: item.poItem.unit, qty: item.qty, price: item.poItem.price, amount: item.qty * item.poItem.price, lotId: item.lot.id, lotNumber: item.lot.lotNumber, locationId: location.id });
      const m = Q.material(item.mid);
      if (m) DB.purchasePriceHistory.unshift({ id: nextCode('PPH-', DB.purchasePriceHistory), materialId: item.mid, supplierId: po.supplierId, poId: po.id, date: DB.today, qty: item.qty, price: item.poItem.price, amount: item.qty * item.poItem.price });
      DB.stockMoves.unshift({ id: nextCode('PN-2026-', DB.stockMoves.filter((x) => x.type === 'in')), type: 'in', date: DB.today, materialId: item.mid, qty: item.qty, ref: po.id, by: $('#grReceiver')?.value || DB.currentUser.id, note: `Nhập kho theo đơn PO ${po.id}` });
    }
    const allDone = po.items.every((i) => (i.receivedQty || 0) >= i.qty);
    po.status = allDone ? 'RECEIVED' : 'PARTIAL_RECEIVED';
    const grId = nextCode('PN-2026-', DB.goodsReceipts);
    DB.goodsReceipts.unshift({
      id: grId, poId: po.id, prId: po.prId, date: DB.today,
      receivedBy: $('#grReceiver')?.value || DB.currentUser.id,
      warehouse: $('#grWarehouse')?.value || 'Kho A',
      status: po.status, note: $('#grNote')?.value || `Nhập kho PO ${po.id}`,
      items: itemsReceived,
    });
    Modal.close(); F('purchases').tab = 'receipts'; render();
    Toast.ok('Nhập kho thành công', `${grId} — Đã cộng tồn kho ${totalCount} vật tư`);
  },
  'purchase-clear-debt-filters': () => {
    const f = F('purchases');
    f.debtQ = ''; f.debtSupplier = ''; f.debtStatus = ''; f.debtDateFrom = ''; f.debtDateTo = '';
    State.page.purchases = 1; render();
  },
  'supplier-pay-modal': async (d) => { if(typeof accountingEntriesEnsureFresh==='function') await accountingEntriesEnsureFresh(false); openPaymentModal(d.id); },
  'supplier-pay-save': async (d) => {
    const po = Q.purchaseOrder(d.poid);
    if (!po) return;
    const amount = parseMoney($('#payAmount').value) || 0;
    const remain = typeof purchasePayableRemaining==='function' ? purchasePayableRemaining(po) : Math.max(0, Number(po.total || 0) - Number(po.paid || 0));
    if (amount <= 0) { Toast.err('Số tiền không hợp lệ', 'Vui lòng nhập số tiền lớn hơn 0.'); return; }
    if (amount > remain) { Toast.err('Vượt quá dư nợ', `Số tiền nhập (${fmtVND(amount)}) vượt quá nợ còn lại (${fmtVND(remain)}).`); return; }
    const id = nextCode('TT-2026-', DB.supplierPayments);
    const payerId = $('#payPayer')?.value || '';
    const payer = (DB.employees || []).find(e => String(e.id) === String(payerId));
    const payerName = payer?.name || payer?.fullName || ((String(payerId)===String(DB.currentUser?.userId||DB.currentUser?.id)) ? ((String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||'')) : Q.employeeName(payerId));
    const accountingEntryId = $('#payAccountingEntry')?.value || '';
    const method = $('#payMethod')?.value || 'BANK_TRANSFER';
    const bankId = method === 'BANK_TRANSFER' ? ($('#payBank')?.value || '') : '';
    const bank = (DB.bankAccounts || []).find(b => String(b.id) === String(bankId));
    if (!accountingEntryId) { Toast.err('Chưa chọn định khoản', 'Thanh toán nhà cung cấp bắt buộc phải chọn định khoản.'); return; }
    if (!payerId) { Toast.err('Chưa chọn người thực hiện', 'Vui lòng chọn người thực hiện thanh toán.'); return; }
    if (method === 'BANK_TRANSFER' && !bankId) { Toast.err('Chưa chọn ngân hàng', 'Vui lòng chọn tài khoản ngân hàng dùng để thanh toán.'); return; }
    if (method === 'BANK_TRANSFER' && typeof AccFin !== 'undefined' && AccFin.bankBalance(bankId) < amount) { Toast.err('Số dư ngân hàng không đủ', `Số dư hiện tại ${fmtVND(AccFin.bankBalance(bankId))}, cần thanh toán ${fmtVND(amount)}.`); return; }

    const oldPaid = Number(po.paid || 0);
    const payment = {
      id, poId: po.id, supplierId: po.supplierId, date: $('#payDate')?.value || (typeof currentDateYMD==='function'?currentDateYMD():DB.today), amount,
      method: method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt', bankId, bankName: bank?.name || bank?.bankName || '', bankAccount: bank?.accountNumber || '',
      payerId, payerName, accountingEntryId, bankRef: $('#payRef')?.value || '', note: $('#payNote')?.value || '', createdBy: DB.currentUser?.userId || DB.currentUser?.id || '', createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''), createdAt: new Date().toISOString(),
    };
    po.paid = Math.round(oldPaid + amount);
    DB.supplierPayments.unshift(payment);
    try {
      // Ghi công nợ lên KIO ngay, không chờ timer rồi đổi tài khoản bị mất.
      if (typeof PurchaseAPI !== 'undefined') await PurchaseAPI.syncCollections(['supplierPayments','purchaseOrders']);
      // Chuyển khoản NCC là tiền RA khỏi đúng tài khoản đã chọn.
      if (bankId && typeof AccountingBank !== 'undefined') {
        await AccountingBank.record({ bankId, type:'OUT', date:payment.date, amount, note:`Thanh toán NCC ${po.id} · ${Q.supplierName(po.supplierId)}`, sourceType:'SUPPLIER_PAYMENT', sourceId:id, createdBy:payment.createdBy, accountingEntryId });
      }
      Modal.close(); if(State.module==='accounting') go('accounting',{tab:'ap'}); else go('purchases',{tab:'debts'}); render();
      Toast.ok('Ghi nhận thanh toán thành công', `${id} — ${fmtVND(amount)}`);
    } catch(err) {
      po.paid = oldPaid;
      DB.supplierPayments = (DB.supplierPayments||[]).filter(x=>x.id!==id);
      try { if (typeof PurchaseAPI !== 'undefined') await PurchaseAPI.syncCollections(['supplierPayments','purchaseOrders']); } catch(_) {}
      Toast.err('Không lưu được thanh toán', err?.message || 'Không thể ghi dữ liệu lên server.');
    }
  },
  'export-pr': (d) => Exporter.pdf('Yeu-cau-mua-hang-' + d.id),

  /* --- Nhân sự & hệ thống --- */
  'open-employee': (d) => switchTo(() => openEmployeeModal(d.id)),
  'new-employee': () => switchTo(() => openEmployeeForm()),
  'employee-edit': (d) => switchTo(() => openEmployeeForm(d.id)),
  'employee-save': () => saveEmployeeForm(),
  'employee-admin-reset-password': (d) => adminResetEmployeePassword(d.id),
  'employee-toggle-active': (d) => toggleEmployeeActive(d.id),
  'employee-import': () => openEmployeeImportModal(),
  'hr-download-template': () => Exporter.csv('Mau-import-nhan-su.csv',
    ['Mã NV (để trống nếu thêm mới)', 'Họ tên', 'Phòng ban', 'Chức vụ', 'Giới tính', 'Số điện thoại', 'Email', 'Ngày vào làm (YYYY-MM-DD)', 'Loại hợp đồng', 'Trạng thái làm việc'],
    [['', 'Nguyễn Văn Mẫu', DB.departments[0] || '', 'Công nhân', 'Nam', '0909 000 000', 'mau@lenamfood.vn', currentDateYMD(), (DB.contractTypes || [])[0] || '', statusLabel('ns_dang_lam')]]),
  'new-user': () => Toast.info('Thêm người dùng', 'Cấp tài khoản gắn với hồ sơ nhân sự và vai trò phân quyền.'),
  'user-toggle': async (d) => {
    const u = DB.users.find((x) => x.id === d.id); if (!u) return;
    u.state = u.state === 'active' ? 'locked' : 'active';
    if (typeof SystemAPI !== 'undefined') { await SystemAPI.saveUsers(); await SystemAPI.audit({module:'SYSTEM',entityType:'USER',entityId:u.id,action:u.state==='active'?'UNLOCK':'LOCK',description:`${DB.currentUser.name} ${u.state==='active'?'mở khóa':'khóa'} tài khoản ${u.username}`}); }
    render();
    Toast.ok(u.state === 'active' ? 'Đã mở khóa tài khoản' : 'Đã khóa tài khoản', `${u.username} · ${u.name}`);
  },
  'user-role': (d) => {
    const u = DB.users.find((x) => x.id === d.id);
    Modal.open({
      title: 'Đổi vai trò người dùng',
      sub: `${esc(u.name)} · ${esc(u.username)}`,
      body: `<div class="field"><label>Vai trò</label>
          <select class="inp" id="urRole">${DB.roles.map((r) => `<option value="${r.id}" ${u.roleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        <div style="font-size:12.3px;color:var(--text-3);background:var(--surface-2);border-radius:var(--r);padding:10px 12px">
          <i class="fa-solid fa-circle-info" style="color:var(--primary)"></i> Thay đổi vai trò áp dụng ngay ở lần đăng nhập kế tiếp của người dùng.</div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button>
             <button class="btn btn-primary" data-act="user-role-save" data-id="${u.id}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`,
    });
  },
  'user-role-save': async (d) => {
    const u = DB.users.find((x) => x.id === d.id); if (!u) return;
    const oldRole=u.roleId; u.roleId = $('#urRole').value;
    if (typeof SystemAPI !== 'undefined') { await SystemAPI.saveUsers(); await SystemAPI.audit({module:'SYSTEM',entityType:'USER',entityId:u.id,action:'CHANGE_ROLE',description:`${DB.currentUser.name} đổi vai trò ${u.username}`,oldData:{roleId:oldRole},newData:{roleId:u.roleId}}); }
    Modal.close(); render();
    Toast.ok('Đã đổi vai trò', `${u.name} · ${(DB.roles.find((r) => r.id === u.roleId) || {}).name}`);
  },
  'auth-logout': async () => {
    if (typeof Toast !== 'undefined') Toast.info('Đang đăng xuất', 'Đang kết thúc phiên đăng nhập...');
    if (typeof SystemAPI !== 'undefined') await SystemAPI.logout();
    // Không giữ lại route/tab của tài khoản cũ khi chuyển sang tài khoản khác.
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    location.reload();
  },

  'toggle-setting': (d) => {
    DB.settings[d.key] = !DB.settings[d.key];
    render();
    Toast.ok('Đã cập nhật cài đặt', `${d.key} = ${DB.settings[d.key] ? 'Bật' : 'Tắt'}`);
  },
  'toggle-theme': () => { toggleTheme(); render(); },
  'settings-save': () => {
    $$('[data-set]').forEach((el) => { DB.company[el.dataset.set] = el.value.trim(); });
    $$('[data-cfg]').forEach((el) => { DB.settings[el.dataset.cfg] = Number(el.value) || el.value; });
    Toast.ok('Đã lưu cài đặt hệ thống', 'Thông tin doanh nghiệp và tham số nghiệp vụ đã được cập nhật.');
  },
  'reset-demo': () => confirmBox({
    title: 'Khôi phục dữ liệu demo',
    message: 'Toàn bộ thay đổi trong phiên làm việc này (báo giá mới, đơn hàng, tiến độ sản xuất, tồn kho…) sẽ bị xóa và dữ liệu trở về trạng thái ban đầu.<br/><br/>Bạn có chắc chắn?',
    okText: 'Khôi phục',
    onOk: () => location.reload(),
  }),

  /* --- Import / Export --- */
  'import-data': (d) => Modal.open({
    title: `Import dữ liệu ${esc(d.what)}`,
    sub: 'Hỗ trợ file Excel (.xlsx) và CSV theo mẫu chuẩn',
    body: `<div style="border:2px dashed var(--border-2);border-radius:var(--r-lg);padding:32px 20px;text-align:center;background:var(--surface-2)">
        <div class="empty-ico" style="margin:0 auto 12px"><i class="fa-solid fa-cloud-arrow-up"></i></div>
        <h4 style="font-size:14px;margin-bottom:5px">Kéo thả file vào đây</h4>
        <p style="font-size:12.5px;color:var(--text-3);margin-bottom:12px">hoặc chọn file từ máy tính · tối đa 10MB</p>
        <button class="btn btn-primary btn-sm" data-act="import-run" data-what="${esc(d.what)}"><i class="fa-solid fa-folder-open"></i>Chọn file</button>
      </div>
      <div style="margin-top:14px;font-size:12.4px;color:var(--text-2);line-height:1.7">
        <b>Lưu ý:</b> file import phải theo đúng mẫu của hệ thống. Bạn có thể tải file mẫu để đối chiếu cấu trúc cột trước khi import.
      </div>`,
    foot: `<button class="btn left" data-act="download-template" data-what="${esc(d.what)}"><i class="fa-solid fa-download"></i>Tải file mẫu</button>
           <button class="btn" data-act="modal-close">Đóng</button>`,
  }),
  'import-run': (d) => { Modal.close(); Toast.info('Đang xử lý file…', `Đọc dữ liệu ${d.what}`); setTimeout(() => Toast.ok('Import hoàn tất', `Đã nhập thành công dữ liệu ${d.what} vào hệ thống.`), 1300); },
  'download-template': (d) => Exporter.csv(`Mau-import-${d.what.replace(/\s/g, '-')}.csv`, ['Mã', 'Tên', 'Ghi chú'], [['(ví dụ)', '(ví dụ)', '']]),

  'export-dashboard': () => {
    const f=F('dashboard',{period:'month'}); const M=typeof dashboardMetrics==='function'?dashboardMetrics(f):null;
    const inventoryValue=typeof dashboardInventoryValue==='function'?dashboardInventoryValue():0;
    const receivable=typeof dashboardReceivable==='function'?dashboardReceivable():0;
    const payable=typeof dashboardPayable==='function'?dashboardPayable():0;
    return Exporter.csv('Bao-cao-tong-quan.csv',
      ['Chỉ tiêu','Giá trị','Khoảng dữ liệu'],
      [['Doanh thu',M?M.revenue:0,M?.range?.label||''],['Đơn bán phát sinh',M?(M.sales.length+M.rest.length):0,M?.range?.label||''],
       ['Lệnh SX đang mở',M?M.activeProduction.length:0,'Hiện tại'],['Giá trị tồn NVL',inventoryValue,'Hiện tại'],
       ['Công nợ phải thu',receivable,'Hiện tại'],['Công nợ phải trả',payable,'Hiện tại']]);
  },
  'dashboard-activity-all': async () => {
    if(typeof SystemAPI!=='undefined' && typeof SystemAPI.refreshAuditLogs==='function') await SystemAPI.refreshAuditLogs({force:true});
    if(typeof dashboardOpenAuditModal==='function') dashboardOpenAuditModal({});
  },
  'dashboard-activity-apply': () => {
    if(typeof dashboardOpenAuditModal!=='function') return;
    dashboardOpenAuditModal({q:$('#dashAuditQ')?.value||'',module:$('#dashAuditModule')?.value||'',userId:$('#dashAuditUser')?.value||'',from:$('#dashAuditFrom')?.value||'',to:$('#dashAuditTo')?.value||''});
  },
  'dashboard-activity-reset': () => { if(typeof dashboardOpenAuditModal==='function') dashboardOpenAuditModal({}); },
  'export-customers': () => Exporter.csv('Danh-sach-khach-hang.csv',
    ['Mã KH', 'Tên khách hàng', 'Người liên hệ', 'Điện thoại', 'Email', 'Tỉnh/TP', 'Nhóm', 'Số đơn', 'Doanh số', 'Trạng thái'],
    filterCustomers().map((c) => [c.id, c.name, c.contact, c.phone, c.email, c.province, c.group, Q.ordersOf(c.id).length, Q.revenueOf(c.id), statusLabel(c.status)])),
  'export-quotes': () => Exporter.csv('Danh-sach-bao-gia.csv',
    ['Mã báo giá', 'Khách hàng', 'Ngày', 'Phụ trách', 'Giá trị', 'Hiệu lực đến', 'Trạng thái'],
    DB.quotes.map((q) => [q.id, Q.customerName(q.customerId), fmtDate(q.date), Q.employeeName(q.ownerId), q.total, fmtDate(q.validUntil), statusLabel(q.status)])),
  'export-orders': () => Exporter.csv('Danh-sach-don-hang.csv',
    ['Mã đơn', 'Khách hàng', 'Sản phẩm', 'Ngày đặt', 'Giao dự kiến', 'Giá trị', 'Trạng thái'],
    DB.orders.map((o) => [o.id, Q.customerName(o.customerId), o.items.map((i) => i.name).join(' + '), fmtDate(o.date), fmtDate(o.dueDate), o.total, statusLabel(o.status)])),
  'export-contracts': () => Exporter.csv('Danh-sach-hop-dong.csv',
    ['Mã HĐ', 'Khách hàng', 'Loại', 'Ngày ký', 'Hết hạn', 'Giá trị', 'Đã thu', 'Còn lại', 'Trạng thái'],
    DB.contracts.map((c) => [c.id, Q.customerName(c.customerId), c.type, fmtDate(c.signDate), fmtDate(c.expireDate), c.value, c.paid, c.remain, statusLabel(c.status)])),
  'export-po': () => Exporter.csv('Danh-sach-lenh-san-xuat.csv',
    ['Mã LSX', 'Đơn hàng', 'Sản phẩm', 'Số lượng', 'Bắt đầu', 'Deadline', 'Tiến độ %', 'Trạng thái'],
    DB.productionOrders.map((p) => [p.id, p.orderId, p.productName, p.qty, fmtDate(p.startDate), fmtDate(p.deadline), Q.progress(p), statusLabel(p.status)])),
  'export-progress': () => Exporter.csv('Tien-do-san-xuat.csv',
    ['Mã LSX', 'Sản phẩm', 'Công đoạn hiện tại', 'Tiến độ %', 'Deadline', 'Trạng thái'],
    DB.productionOrders.filter((p) => !['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status)).map((p) => [p.id, p.productName, currentStage(p).name, Q.progress(p), fmtDate(p.deadline), statusLabel(p.status)])),
  'export-materials': () => Exporter.csv('Danh-muc-vat-tu.csv',
    ['Mã VT', 'Tên vật tư', 'Nhóm', 'ĐVT', 'Tồn kho', 'Tồn tối thiểu', 'Vị trí', 'Đơn giá', 'Giá trị tồn', 'Trạng thái'],
    DB.materials.map((m) => [m.id, m.name, m.group, m.unit, m.stock, m.minStock, m.location, m.price, m.value, statusLabel(m.status)])),
  'export-inventory': () => Exporter.csv('Phieu-nhap-xuat-kho.csv',
    ['Số phiếu', 'Loại', 'Ngày', 'Mã VT', 'Tên vật tư', 'Số lượng', 'Tham chiếu', 'Người lập'],
    DB.stockMoves.map((x) => [x.id, x.type === 'in' ? 'Nhập kho' : 'Xuất kho', fmtDate(x.date), x.materialId, Q.material(x.materialId)?.name || '', x.qty, x.ref, Q.employeeName(x.by)])),
  'export-purchases': () => Exporter.csv('Yeu-cau-mua-hang.csv',
    ['Mã YC', 'Người yêu cầu', 'Nhà cung cấp', 'Giá trị', 'Ngày yêu cầu', 'Trạng thái'],
    DB.purchases.map((p) => [p.id, Q.employeeName(p.requesterId), Q.supplierName(p.supplierId), p.total, fmtDate(p.date), statusLabel(p.status)])),
  'export-hr': () => Exporter.csv('Danh-sach-nhan-su.csv',
	['Mã NV', 'Họ tên', 'Phòng ban', 'Chức vụ', 'Giới tính', 'Số điện thoại', 'Email', 'Ngày vào làm (YYYY-MM-DD)', 'Loại hợp đồng', 'Trạng thái làm việc', 'Tình trạng sử dụng'],
    DB.employees.map((e) => [e.id, e.name, e.dept, e.position, e.gender, e.phone, e.email, e.joinDate, e.contractType || '', statusLabel(e.status), e.active === false ? 'Ngừng sử dụng' : 'Đang sử dụng'])),
  'export-attendance': () => Exporter.csv('Bang-cong-thang-08-2026.csv',
    ['Mã NV', 'Họ tên', 'Phòng ban', 'Công chuẩn', 'Đi làm', 'Nghỉ phép', 'Đi muộn', 'Tăng ca (giờ)', 'Tỷ lệ %'],
    DB.attendance.map((a) => [a.empId, a.name, a.dept, a.standard, a.worked, a.leave, a.late, a.ot, a.rate])),
  'export-users': () => Exporter.csv('Danh-sach-nguoi-dung.csv',
    ['Tài khoản', 'Họ tên', 'Phòng ban', 'Vai trò', 'Đăng nhập gần nhất', 'Trạng thái'],
    DB.users.map((u) => [u.username, u.name, u.dept, (DB.roles.find((r) => r.id === u.roleId) || {}).name, u.lastLogin, u.state === 'active' ? 'Hoạt động' : 'Khóa'])),
  'export-report': (d) => {
    const names = { reports: 'Bao-cao-tong-hop', 'rp-product': 'Bao-cao-san-xuat', 'rp-revenue': 'Bao-cao-doanh-thu', 'rp-material': 'Bao-cao-vat-tu' };
    const name = names[d.key] || 'Bao-cao';
    if (d.kind === 'pdf') { Exporter.pdf(name); return; }
    if (d.key === 'rp-product') return Actions['export-po']();
    if (d.key === 'rp-material') return Actions['export-materials']();
    if (d.key === 'rp-revenue') return Actions['export-orders']();
    return Actions['export-dashboard']();
  },

  /* --- Thông báo & kịch bản demo --- */
  'notif-go': (d) => {
    const n = DB.notifications.find((x) => x.id === d.id);
    if (!n) return;
    n.read = true; updateBell(); Pop.close();
    if (n.go) {
      if (n.go.module === 'production' && n.go.id) go('production-detail', { id: n.go.id });
      else if (n.go.module === 'orders' && n.go.id) go('order-detail', { id: n.go.id });
      else { go(n.go.module); if (n.go.id && n.go.module === 'quotes') setTimeout(() => openQuoteModal(n.go.id), 260); }
    }
  },
  'notif-read-all': () => { DB.notifications.forEach((n) => { n.read = true; }); updateBell(); Pop.close(); Toast.ok('Đã đánh dấu tất cả là đã đọc'); },
  'notif-all': () => { DB.notifications.forEach((n) => { n.read = true; }); updateBell(); Pop.close(); Toast.info('Trung tâm thông báo', 'Bản demo hiển thị 7 thông báo gần nhất trong dropdown.'); },
  'open-guide': () => openGuide(),
  'guide-step': (d) => {
    const s = GUIDE_STEPS[Number(d.i)];
    switchTo(() => { if (s.go) go(s.go[0]); else if (s.act) Actions[s.act]({ id: s.id }); });
  },
};

// Không thay đổi logic action hiện có: chỉ bọc các action Purchase có ghi dữ liệu
// để sau khi action chạy xong thì đồng bộ trạng thái DB.* lên KIO server.
if (typeof PurchaseAPI !== 'undefined') {
  PurchaseAPI.wrapActions(Actions);
}
// Persistence Kho bọc toàn bộ action để mọi thay đổi DB.* được ghi lại.
if (typeof InventoryAPI !== 'undefined') {
  InventoryAPI.wrapActions(Actions);
}


/* ============================================================================
 * SALES ORDER DATA PRELOAD
 * ----------------------------------------------------------------------------
 * Form Đơn hàng bán phụ thuộc dữ liệu của HAI phân hệ:
 *   CRM: customers
 *   Kho: products + inventory + inventoryLots + warehouses
 *
 * Sau khi chuyển sang lazy-load để tăng tốc đăng nhập, nếu mở form bán hàng trước
 * khi vào màn Kho thì các collection Kho chưa chắc đã được refresh. Helper này
 * nạp đúng 4 collection tối thiểu và dùng một Promise chung để tránh bấm nhiều
 * lần tạo ra nhiều request list.php trùng nhau.
 * ========================================================================== */
let __salesOrderFormDataPromise = null;
let __salesOrderDataReadyAt = 0;
const SALES_ORDER_DATA_TTL = 2 * 60 * 1000;

async function prepareSalesOrderFormData(triggerEl = null, { background = false } = {}) {
  const now = Date.now();
  if (__salesOrderDataReadyAt && (now - __salesOrderDataReadyAt) < SALES_ORDER_DATA_TTL) return true;
  if (__salesOrderFormDataPromise) {
    try { await __salesOrderFormDataPromise; return true; }
    catch (_) { return false; }
  }

  const oldHtml = triggerEl?.innerHTML;
  const oldDisabled = triggerEl?.disabled;
  if (!background && triggerEl) {
    triggerEl.disabled = true;
    triggerEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>Đang tải tồn kho...';
  }
  if (!background) Toast.info('Đang tải Kho thành phẩm', 'Hệ thống đang đồng bộ tồn khả dụng để tạo đơn hàng chính xác.');

  __salesOrderFormDataPromise = (async () => {
    // Đơn bán phải dùng thông tin khách hàng MỚI NHẤT (đặc biệt địa chỉ giao hàng).
    // Force đọc customers từ KIO mỗi lần chuẩn bị form, không dùng TTL/cache cũ.
    if (typeof CRMAPI !== 'undefined') {
      if (typeof CRMAPI.refreshKeys === 'function') {
        await CRMAPI.refreshKeys(['customers'], { force: true });
      } else if (typeof CRMAPI.ensureFresh === 'function') {
        await CRMAPI.ensureFresh(['customers']);
      }
    }
    // Đây là nguồn dữ liệu quyết định thành phẩm có được phép bán hay không.
    if (typeof InventoryAPI !== 'undefined' && InventoryAPI.ensureFresh) {
      await InventoryAPI.ensureFresh(['products', 'inventory', 'inventoryLots', 'warehouses']);
    }

    // Nếu cả master hoặc cấu trúc kho chưa có dữ liệu thì vẫn cho mở form để
    // hiển thị đúng thông báo "Kho thành phẩm chưa có hàng khả dụng". Không lấy
    // DB.products demo độc lập làm nguồn bán.
    __salesOrderDataReadyAt = Date.now();
    return true;
  })();

  try {
    return await __salesOrderFormDataPromise;
  } catch (err) {
    console.error('[SalesOrder] Không thể nạp dữ liệu Kho thành phẩm:', err);
    if (!background) Toast.err('Không tải được Kho thành phẩm', 'Đang dùng cache hiện có. Hãy thử lại nếu danh sách chưa đúng.');
    // KIO có thể lỗi/abort; cache hiện có vẫn an toàn hơn việc chặn toàn bộ form.
    return true;
  } finally {
    __salesOrderFormDataPromise = null;
    if (!background && triggerEl) {
      triggerEl.disabled = !!oldDisabled;
      triggerEl.innerHTML = oldHtml;
    }
  }
}

function prefetchSalesOrderFormData() {
  // Chạy nền khi vào danh sách Đơn hàng bán để người dùng bấm "Tạo đơn" thì
  // dữ liệu thường đã sẵn sàng. Không chặn render/login.
  prepareSalesOrderFormData(null, { background: true }).catch(() => {});
}


/* ==========================================================================
 * 7B. BOM / KẾ HOẠCH SẢN XUẤT / YÊU CẦU NGUYÊN LIỆU
 * ========================================================================== */

function pfDetailRows(entries) {
  return `<div class="detail-list">${entries.map(([label,value])=>`<div class="detail-row"><span class="muted">${esc(label)}</span><strong>${value==null||value===''?'—':value}</strong></div>`).join('')}</div>`;
}
function pfPlanDetailHtml(plan) {
  const itemRows=(plan.items||[]).map(i=>{const pr=Q.product(i.productId);return `<tr><td><span class="code">${esc(i.productId)}</span></td><td>${esc(pr?.name||i.productId)}</td><td class="right num">${fmtN(i.qty)} ${esc(pr?.unit||'')}</td></tr>`}).join('');
  const request=(DB.productionMaterialRequests||[]).find(r=>r.id===plan.materialRequestId||r.planId===plan.id);
  const preparedMaterialRows=[];
  const operationRows=[];
  for(const it of (plan.items||[])){
    const pr=Q.product(it.productId);
    const mats=(it.preparedMaterials||[]).length?it.preparedMaterials:(pr?.bom||[]).map(([mid,per,lossPct=0])=>({materialId:mid,qty:pfBomRequiredQty(per,it.qty,lossPct),lossPct:Number(lossPct||0),baseQtyPerUnit:Number(per||0)}));
    for(const m of mats){
      const mat=Q.material(m.materialId);
      preparedMaterialRows.push(`<tr><td><span class="code">${esc(it.productId)}</span><div class="cell-sub">${esc(pr?.name||it.productId)}</div></td><td><span class="code">${esc(m.materialId)}</span></td><td>${esc(mat?.name||m.materialId)}</td><td class="right num">${fmtDec(Number(m.qty||0),3)} ${esc(mat?.unit||'')}</td></tr>`);
    }
    const ops=(it.preparedOperations||[]).length?it.preparedOperations:(pr?.routing||[]).map(([oid])=>({operationId:oid,note:''}));
    for(const op of ops){const o=Q.operation(op.operationId);operationRows.push(`<tr><td><span class="code">${esc(it.productId)}</span><div class="cell-sub">${esc(pr?.name||it.productId)}</div></td><td><span class="code">${esc(op.operationId)}</span></td><td>${esc(o?.name||op.operationId)}</td><td>${esc(op.note||'—')}</td></tr>`);}
  }
  let requestBlock='';
  if(request){
    const reqRows=(request.items||[]).map(i=>`<tr><td><span class="code">${esc(i.materialId)}</span></td><td>${esc(restaurantRecipeComponent(i.materialId)?.name||i.materialId)}</td><td class="right num">${fmtDec(Number(i.qty||0),3)} ${esc(Q.material(i.materialId)?.unit||'')}</td><td>${esc(Q.product(i.productId)?.name||i.productId||'—')}</td></tr>`).join('');
    const issues=(request.goodsIssueIds||[]).map(id=>`<button class="btn btn-sm" data-act="inv-issue-view" data-id="${esc(id)}"><i class="fa-solid fa-eye"></i>${esc(id)}</button>`).join(' ')||'<span class="muted">Chưa có phiếu xuất</span>';
    requestBlock=`<div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Yêu cầu NVL của kế hoạch</h3><p>Thông tin phiếu yêu cầu và trạng thái Kho cấp nguyên liệu được theo dõi ngay tại đây.</p></div><div>${pfRequestStatus(request.status)}</div></div><div class="card-body">
      ${pfDetailRows([['Mã phiếu',`<span class="code">${esc(request.id)}</span>`],['Ngày yêu cầu',fmtDate(request.date)],['Người lập',esc(Q.employeeName(request.createdBy)||request.createdBy||'—')],['Phiếu xuất NVL',issues],['Ghi chú',esc(request.note||'—')]])}
      <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-boxes-packing"></i>Nguyên liệu yêu cầu</div>
      ${tableShell([{t:'Mã NVL'},{t:'Nguyên liệu'},{t:'Số lượng',cls:'right'},{t:'Thành phẩm'}],reqRows,{emptyTitle:'Phiếu chưa có nguyên liệu'})}
    </div></div>`;
  }else{
    requestBlock=`<div class="card" style="margin-top:14px"><div class="card-body"><div class="alert warning"><i class="fa-solid fa-boxes-packing"></i><span><b>Chưa lập yêu cầu NVL.</b> Sau khi Sản xuất chuẩn bị nguyên liệu/công đoạn, phiếu yêu cầu NVL sẽ xuất hiện trực tiếp trong chi tiết kế hoạch này.</span></div></div></div>`;
  }
  return `${pfDetailRows([['Mã kế hoạch',`<span class="code">${esc(plan.id)}</span>`],['Nguồn',plan.source==='SALES_ORDER'?`Đơn hàng bán <span class="code">${esc(plan.sourceOrderId||'—')}</span>`:'Kế hoạch từ Kho'],['Ngày lập',fmtDate(plan.date)],['Ngày cần hoàn thành',fmtDate(plan.dueDate)],['Trạng thái',pfPlanStatus(plan.status)],['Người lập',esc(Q.employeeName(plan.createdBy)||plan.createdBy||'—')],['Ghi chú',esc(plan.note||'—')]])}
    <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-box"></i>Thành phẩm</div>${tableShell([{t:'Mã TP'},{t:'Thành phẩm'},{t:'Số lượng',cls:'right'}],itemRows,{emptyTitle:'Không có thành phẩm'})}
    <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-boxes-stacked"></i>Nguyên liệu theo BOM / kế hoạch</div>${tableShell([{t:'Thành phẩm'},{t:'Mã NVL'},{t:'Nguyên liệu'},{t:'Số lượng',cls:'right'}],preparedMaterialRows.join(''),{emptyTitle:'Chưa có nguyên liệu/BOM'})}
    <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-gears"></i>Công đoạn / Gia công</div>${tableShell([{t:'Thành phẩm'},{t:'Mã'},{t:'Công đoạn'},{t:'Ghi chú'}],operationRows.join(''),{emptyTitle:'Chưa có công đoạn'})}
    ${requestBlock}`;
}
Actions['pf-plan-view'] = (d) => { const p=(DB.productionPlans||[]).find(x=>x.id===d.id); if(!p)return; const canEditFromWarehouse=State.module==='warehouse' && p.source!=='SALES_ORDER' && p.status==='WAITING_APPROVAL'; const canPrepare=State.module==='production' && p.status==='APPROVED'; const canRelease=State.module==='production' && p.status==='MATERIAL_ISSUED'; Modal.open({title:`Chi tiết kế hoạch · ${p.id}`,size:'xl',body:pfPlanDetailHtml(p),foot:`<button class="btn" data-act="modal-close">Đóng</button>${canEditFromWarehouse?`<button class="btn btn-primary" data-act="pf-plan-edit" data-id="${esc(p.id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`:''}${canPrepare?`<button class="btn btn-primary" data-act="pf-plan-materials" data-id="${esc(p.id)}"><i class="fa-solid fa-boxes-packing"></i>Chuẩn bị & lập yêu cầu NVL</button>`:''}${canRelease?`<button class="btn btn-primary" data-act="pf-plan-release" data-id="${esc(p.id)}"><i class="fa-solid fa-industry"></i>Tạo lệnh sản xuất</button>`:''}`}); };
function pfOpenPlanEdit(plan) {
  const today=currentDateYMD();
  const rows=(DB.products||[]).map(pr=>{const old=(plan.items||[]).find(i=>i.productId===pr.id);return `<div class="pf-plan-line" style="display:grid;grid-template-columns:32px 1fr 120px;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" name="pick" data-product="${esc(pr.id)}" ${old?'checked':''}><div><b>${esc(pr.name)}</b><div class="cell-sub">${esc(pr.id)} · Tồn ${fmtN(pfFinishedStock(pr.id))} ${esc(pr.unit||'')}</div></div><input class="inp right num" name="qty" type="number" min="1" step="1" value="${Number(old?.qty||0)}"></div>`}).join('');
  Modal.open({title:`Sửa kế hoạch · ${plan.id}`,size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Ngày lập *</label><input class="inp" id="pfPlanDate" type="date" value="${esc(plan.date||today)}" min="${today}"></div><div class="field"><label>Ngày cần hoàn thành *</label><input class="inp" id="pfPlanDue" type="date" value="${esc(plan.dueDate||today)}" min="${today}"></div></div><div class="form-sec-title"><i class="fa-solid fa-box"></i>Thành phẩm</div><div style="max-height:420px;overflow:auto">${rows}</div><div class="field"><label>Ghi chú</label><textarea class="inp" id="pfPlanNote" rows="2">${esc(plan.note||'')}</textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="pf-plan-edit-save" data-id="${esc(plan.id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu thay đổi</button>`});
}
Actions['pf-plan-edit'] = (d) => {const p=(DB.productionPlans||[]).find(x=>x.id===d.id);if(!p)return;if(State.module!=='warehouse'||p.status!=='WAITING_APPROVAL'){Toast.warn('Không thể sửa','Kế hoạch chỉ được sửa tại Kho khi còn ở trạng thái Chờ duyệt. Sau khi duyệt, Sản xuất chỉ tiếp nhận và triển khai kế hoạch.');return;}pfOpenPlanEdit(p);};
Actions['pf-plan-edit-save'] = async (d) => {const p=(DB.productionPlans||[]).find(x=>x.id===d.id);if(!p||State.module!=='warehouse'||p.status!=='WAITING_APPROVAL')return;const today=currentDateYMD(),date=$('#pfPlanDate')?.value||today,due=$('#pfPlanDue')?.value||date;if(date<today||due<today||due<date){Toast.err('Ngày chưa hợp lệ','Ngày không được ở quá khứ và deadline phải từ ngày lập trở đi.');return;}const items=[];document.querySelectorAll('.pf-plan-line').forEach(row=>{const pick=row.querySelector('[name="pick"]'),qty=Number(row.querySelector('[name="qty"]')?.value||0);if(pick?.checked&&qty>0)items.push({productId:pick.dataset.product,qty});});if(!items.length){Toast.err('Chưa chọn thành phẩm','Chọn ít nhất một thành phẩm.');return;}const prev=JSON.parse(JSON.stringify(p));p.date=date;p.dueDate=due;p.items=items;p.note=$('#pfPlanNote')?.value.trim()||'';p.updatedAt=new Date().toISOString();try{await ProductionAPI?.persistCollections?.(['productionPlans']);Modal.close();render();Toast.ok('Đã cập nhật kế hoạch',`${p.id} · Đã lưu server`);}catch(err){Object.assign(p,prev);render();Toast.err('Không lưu được kế hoạch',err?.message||'Server chưa xác nhận dữ liệu.');}};

Actions['pf-bom-view'] = (d) => {const p=Q.product(d.id);if(!p)return;const bom=(p.bom||[]).map(([mid,qty,lossPct=0])=>{const mat=Q.material(mid),effective=pfBomRequiredQty(qty,1,lossPct);return `<tr><td><span class="code">${esc(mid)}</span></td><td>${esc(mat?.name||mid)}</td><td class="right num">${fmtDec(qty,4)} ${esc(mat?.unit||'')}</td><td class="right num">${fmtDec(Number(lossPct||0),2)}%</td><td class="right num"><b>${fmtDec(effective,4)}</b> ${esc(mat?.unit||'')}</td></tr>`;}).join('');const routing=(p.routing||[]).map(([oid])=>`<tr><td><span class="code">${esc(oid)}</span></td><td>${esc(Q.operation(oid)?.name||oid)}</td><td>${esc(Q.operation(oid)?.workshop||'')}</td></tr>`).join('');Modal.open({title:`BOM / Định mức · ${p.id}`,sub:`${p.name} · Định mức cho 1 ${p.unit||'đơn vị'} thành phẩm`,size:'xl',body:`<div class="grid g-2"><div><div class="form-sec-title">Nguyên liệu định mức</div>${tableShell([{t:'Mã NVL'},{t:'Nguyên liệu'},{t:'Định mức / 1 ĐVT',cls:'right'},{t:'Hao hụt',cls:'right'},{t:'Cần cấp / 1 ĐVT',cls:'right'}],bom,{emptyTitle:'Chưa khai báo nguyên liệu'})}</div><div><div class="form-sec-title">Công đoạn / Routing</div>${tableShell([{t:'Mã'},{t:'Công đoạn'},{t:'Xưởng'}],routing,{emptyTitle:'Chưa khai báo công đoạn'})}</div></div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="pf-bom-edit" data-id="${esc(p.id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`});};

function pfMrDetailHtml(r){
  const rows=(r.items||[]).map(i=>`<tr><td><span class="code">${esc(i.materialId)}</span></td><td>${esc(restaurantRecipeComponent(i.materialId)?.name||i.materialId)}</td><td class="right num">${fmtDec(i.qty,3)} ${esc(Q.material(i.materialId)?.unit||'')}</td><td>${esc(Q.product(i.productId)?.name||i.productId||'—')}</td></tr>`).join('');
  const source = r.productionOrderId
    ? `Lệnh sản xuất <span class="code">${esc(r.productionOrderId)}</span>`
    : `Kế hoạch <span class="code">${esc(r.planId||'—')}</span>`;
  const issues=(r.goodsIssueIds||[]).map(id=>`<span class="code" data-act="inv-issue-view" data-id="${esc(id)}" style="cursor:pointer">${esc(id)}</span>`).join(', ') || '—';
  return `${pfDetailRows([['Mã phiếu',`<span class="code">${esc(r.id)}</span>`],['Nguồn',source],['Ngày',fmtDate(r.date)],['Trạng thái',pfRequestStatus(r.status)],['Phiếu xuất kho',issues],['Người lập',esc(Q.employeeName(r.createdBy)||r.createdBy||'—')],['Ghi chú',esc(r.note||'—')]])}<div class="form-sec-title" style="margin-top:16px">Nguyên liệu yêu cầu</div>${tableShell([{t:'Mã NVL'},{t:'Nguyên liệu'},{t:'Số lượng',cls:'right'},{t:'Thành phẩm'}],rows,{emptyTitle:'Không có nguyên liệu'})}`;
}
Actions['pf-mr-view']=(d)=>{const r=(DB.productionMaterialRequests||[]).find(x=>x.id===d.id);if(!r)return;Modal.open({title:`Chi tiết yêu cầu NVL · ${r.id}`,size:'lg',body:pfMrDetailHtml(r),foot:`<button class="btn" data-act="modal-close">Đóng</button>${r.status==='WAITING_WAREHOUSE_APPROVAL'?`<button class="btn btn-primary" data-act="pf-mr-edit" data-id="${esc(r.id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`:''}`});};
Actions['pf-mr-edit']=(d)=>{const r=(DB.productionMaterialRequests||[]).find(x=>x.id===d.id);if(!r||r.status!=='WAITING_WAREHOUSE_APPROVAL'){Toast.warn('Không thể sửa','Chỉ phiếu chưa được Kho duyệt mới được sửa.');return;}const rows=(r.items||[]).map((i,idx)=>`<div class="pf-mr-edit-line" data-index="${idx}" style="display:grid;grid-template-columns:1fr 180px;gap:8px;margin-bottom:8px"><div><b>${esc(restaurantRecipeComponent(i.materialId)?.name||i.materialId)}</b><div class="cell-sub">${esc(i.materialId)} · ${esc(Q.product(i.productId)?.name||i.productId||'')}</div></div><input class="inp right num" name="qty" type="number" min="0.0001" step="0.0001" value="${Number(i.qty||0)}"></div>`).join('');Modal.open({title:`Sửa yêu cầu NVL · ${r.id}`,size:'lg',body:`${rows}<div class="field"><label>Ghi chú</label><textarea class="inp" id="pfMrEditNote" rows="2">${esc(r.note||'')}</textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="pf-mr-edit-save" data-id="${esc(r.id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`});};
Actions['pf-mr-edit-save']=(d)=>{const r=(DB.productionMaterialRequests||[]).find(x=>x.id===d.id);if(!r||r.status!=='WAITING_WAREHOUSE_APPROVAL')return;for(const el of document.querySelectorAll('.pf-mr-edit-line')){const idx=Number(el.dataset.index),qty=Number(el.querySelector('[name="qty"]')?.value||0);if(!(qty>0)){Toast.err('Số lượng không hợp lệ','Số lượng nguyên liệu phải lớn hơn 0.');return;}if(r.items[idx])r.items[idx].qty=qty;}r.note=$('#pfMrEditNote')?.value.trim()||'';r.updatedAt=new Date().toISOString();ProductionAPI?.scheduleSync(80);Modal.close();render();Toast.ok('Đã cập nhật yêu cầu NVL',r.id);};
Actions['pf-mr-delete']=(d)=>{const r=(DB.productionMaterialRequests||[]).find(x=>x.id===d.id);if(!r||r.status!=='WAITING_WAREHOUSE_APPROVAL'){Toast.warn('Không thể xóa','Chỉ phiếu chưa được Kho duyệt mới được xóa.');return;}confirmBox({title:'Xóa yêu cầu NVL',icon:'fa-trash',okText:'Xóa phiếu',message:`Xóa phiếu <b>${esc(r.id)}</b>?`,onOk:()=>{DB.productionMaterialRequests=(DB.productionMaterialRequests||[]).filter(x=>x.id!==r.id);const p=(DB.productionPlans||[]).find(x=>x.id===r.planId);if(p&&p.materialRequestId===r.id){p.materialRequestId='';p.status='APPROVED';}const po=(DB.productionOrders||[]).find(x=>x.id===r.productionOrderId);if(po&&po.materialRequestId===r.id)po.materialRequestId='';ProductionAPI?.scheduleSync(80);render();Toast.ok('Đã xóa yêu cầu NVL',r.id);}});};

Actions['pf-bom-new'] = () => pfOpenBomModal('');
Actions['pf-bom-edit'] = (d) => pfOpenBomModal(d.id);
Actions['pf-bom-delete'] = (d) => { const product=Q.product(d.id); if(!product||!(product.bom||[]).length)return; confirmBox({title:'Xóa BOM / Định mức',icon:'fa-trash',okText:'Xóa BOM',message:`Xóa toàn bộ định mức của <b>${esc(product.id)} · ${esc(product.name)}</b>?`,onOk:()=>{product.bom=[];product.routing=[];InventoryAPI?.scheduleCollections?.(['products'],80);render();Toast.ok('Đã xóa BOM',product.id);}}); };
Actions['pf-bom-add-line'] = () => {
  const host=$('#pfBomLines'); if(!host) return;
  const row=document.createElement('div'); row.className='pf-bom-line'; row.style.cssText='display:grid;grid-template-columns:minmax(280px,1fr) 150px 130px 42px;gap:8px;margin-bottom:8px;align-items:center';
  row.innerHTML=`<select class="inp" name="material">${(DB.materials||[]).map(m=>`<option value="${esc(m.id)}">${esc(m.id)} — ${esc(m.name)} (${esc(m.unit||'')})</option>`).join('')}</select><input class="inp right num" name="qty" type="number" min="0.0001" step="0.0001" value="1"><div style="display:grid;grid-template-columns:1fr 26px;align-items:center;gap:4px"><input class="inp right num" name="lossPct" type="number" min="0" max="99.99" step="0.01" value="0"><span class="muted">%</span></div><button class="btn btn-sm" type="button" data-act="pf-bom-remove-line"><i class="fa-solid fa-trash"></i></button>`;
  host.appendChild(row);
};
Actions['pf-bom-remove-line'] = (d,el) => { const rows=[...document.querySelectorAll('.pf-bom-line')]; if(rows.length<=1){Toast.warn('BOM phải có nguyên liệu','Giữ ít nhất một dòng định mức.');return;} el.closest('.pf-bom-line')?.remove(); };
Actions['pf-bom-add-op'] = () => {
  const host=$('#pfBomOps'); if(!host) return;
  const first=(DB.operations||[])[0]; if(!first){Toast.warn('Chưa có danh mục công đoạn','Hãy khai báo công đoạn sản xuất trước.');return;}
  const row=document.createElement('div'); row.className='pf-bom-op-line'; row.dataset.hours='0.01'; row.style.cssText='display:grid;grid-template-columns:1fr 42px;gap:8px;margin-bottom:8px';
  row.innerHTML=`<select class="inp" name="operation">${(DB.operations||[]).map(o=>`<option value="${esc(o.id)}">${esc(o.id)} — ${esc(o.name)} · ${esc(o.workshop||'')}</option>`).join('')}</select><button class="btn btn-sm" type="button" data-act="pf-bom-remove-op"><i class="fa-solid fa-trash"></i></button>`;
  host.appendChild(row);
};
Actions['pf-bom-remove-op'] = (d,el) => { el.closest('.pf-bom-op-line')?.remove(); };
Actions['pf-bom-save'] = () => {
  const product=Q.product($('#pfBomProduct')?.value); if(!product){Toast.err('Chưa chọn thành phẩm','Vui lòng chọn thành phẩm.');return;}
  const rows=[...document.querySelectorAll('.pf-bom-line')]; const seen=new Set(); const bom=[];
  for(const row of rows){const mid=row.querySelector('[name="material"]')?.value; const qty=Number(row.querySelector('[name="qty"]')?.value||0); const lossPct=Number(row.querySelector('[name="lossPct"]')?.value||0); if(!mid||qty<=0){Toast.err('Định mức chưa hợp lệ','Nguyên liệu và số lượng phải hợp lệ.');return;} if(lossPct<0||lossPct>=100){Toast.err('Hao hụt chưa hợp lệ','% hao hụt phải từ 0 đến nhỏ hơn 100%.');return;} if(seen.has(mid)){Toast.err('Trùng thành phẩm',`Nguyên liệu ${mid} đang được khai báo nhiều lần.`);return;} seen.add(mid); bom.push([mid,qty,lossPct]);}
  const opRows=[...document.querySelectorAll('.pf-bom-op-line')]; const opSeen=new Set(); const routing=[];
  for(const row of opRows){const oid=row.querySelector('[name="operation"]')?.value; const hours=Number(row.dataset.hours||0.01); if(!oid){Toast.err('Công đoạn chưa hợp lệ','Vui lòng chọn công đoạn.');return;} if(opSeen.has(oid)){Toast.err('Trùng công đoạn',`Công đoạn ${oid} đang được khai báo nhiều lần.`);return;} opSeen.add(oid); routing.push([oid,hours>0?hours:0.01]);}
  product.bom=bom; product.routing=routing; InventoryAPI?.scheduleCollections?.(['products'],80); Modal.close(); render(); Toast.ok('Đã lưu BOM / Routing',`${product.id} · ${product.name}`);
};

Actions['pf-plan-from-sales-order'] = async (d) => {
  const o=Q.order(d.id); if(!o)return;
  if(!o.approvedAt||['dh_cho_xu_ly','dh_tu_choi','dh_da_huy','dh_da_giao','dh_hoan_tat'].includes(o.status)){Toast.warn('Không thể lập kế hoạch','Chỉ lập kế hoạch từ đơn bán đã được duyệt và còn hiệu lực.');return;}
  const group=(typeof pfSalesDemandGroups==='function'?pfSalesDemandGroups():[]).find(g=>g.order.id===o.id);
  if(!group){Toast.warn('Không có nhu cầu','Không tìm thấy nhu cầu sản xuất cho đơn hàng này.');return;}
  const items=(group.lines||[]).filter(x=>x.unplanned>0).map(x=>({productId:x.productId,qty:x.unplanned,orderedQty:x.need,availableQty:x.allocated,shortageQty:x.shortage}));
  if(!items.length){Toast.warn('Đã đủ kế hoạch','Phần thiếu của đơn hàng đã được tồn kho hoặc các kế hoạch hiện tại bao phủ.');return;}
  const id=nextCode('KHSX-2026-',DB.productionPlans||[]);
  const today=currentDateYMD();
  DB.productionPlans.unshift({id,date:today,dueDate:o.dueDate||addDays(today,7),items,status:'WAITING_APPROVAL',source:'SALES_ORDER',sourceOrderId:o.id,customerId:o.customerId||'',note:`Kế hoạch phần thiếu của đơn bán ${o.id}`,createdBy:DB.currentUser?.userId||DB.currentUser?.id||'',createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''),createdAt:new Date().toISOString()});
  o.productionPlanId=id;
  o.status='dh_cho_san_xuat';
  if(typeof SalesCRM!=='undefined')SalesCRM.saveLocal(['orders']);
  try{
    await ProductionAPI?.persistCollections?.(['productionPlans']);
    if(typeof SystemAPI!=='undefined')SystemAPI.audit({module:'WAREHOUSE',entityType:'PRODUCTION_PLAN',entityId:id,action:'CREATE',description:`${DB.currentUser?.name||'Người dùng'} lập kế hoạch ${id} cho phần thiếu của đơn ${o.id}`,newData:{orderId:o.id,items,status:'WAITING_APPROVAL'}});
    render(); Toast.ok('Đã lập kế hoạch sản xuất',`${id} · Đã lưu server · Chờ duyệt tại Kho.`);
  }catch(err){
    DB.productionPlans=(DB.productionPlans||[]).filter(x=>x.id!==id);
    if(o.productionPlanId===id)o.productionPlanId='';
    render(); Toast.err('Không lưu được kế hoạch sản xuất',err?.message||'Server chưa xác nhận dữ liệu.');
  }
};

Actions['pf-plan-new'] = () => {
  const today=currentDateYMD();
  const rows=(DB.products||[]).map(p=>{const stock=pfFinishedStock(p.id), zero=stock<=0; return `<div class="pf-plan-line" style="display:grid;grid-template-columns:32px 1fr 120px 150px;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" name="pick" data-product="${esc(p.id)}"><div><b>${esc(p.name)}</b><div class="cell-sub">${esc(p.id)} · Tồn khả dụng ${fmtN(stock)} ${esc(p.unit||'')}</div></div><input class="inp right num" name="qty" type="number" min="1" step="1" value="${zero?100:0}"><span>${zero?'<span class="badge red">Hết hàng</span>':'<span class="badge green">Còn hàng</span>'}</span></div>`}).join('');
  Modal.open({title:'Lập kế hoạch sản xuất',sub:'Ưu tiên các thành phẩm hết hàng; có thể chọn thêm thành phẩm khác khi cần',size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Ngày lập *</label><input class="inp" id="pfPlanDate" type="date" value="${today}" min="${today}"></div><div class="field"><label>Ngày cần hoàn thành *</label><input class="inp" id="pfPlanDue" type="date" value="${addDays(today,7)}" min="${today}"></div></div><div class="form-sec-title"><i class="fa-solid fa-box"></i>Thành phẩm cần sản xuất</div><div style="max-height:420px;overflow:auto">${rows}</div><div class="field"><label>Ghi chú</label><textarea class="inp" id="pfPlanNote" rows="2" placeholder="Lý do / ghi chú kế hoạch"></textarea></div>`,foot:'<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="pf-plan-save"><i class="fa-solid fa-floppy-disk"></i>Lưu kế hoạch</button>'});
};
// Lập kế hoạch sản xuất hàng loạt cho thành phẩm dưới hạn mức tồn (Kho là bên khởi tạo nghiệp vụ SX).
// SL đề xuất = hạn mức − tồn khả dụng − SL đang nằm trong KH chưa phát hành/LSX chưa xong. Lưu qua pf-plan-save.
Actions['pf-plan-low-stock'] = () => {
  const today=currentDateYMD();
  const pendingPlanStatuses=['WAITING_APPROVAL','WAITING_SALES_APPROVAL','APPROVED','MATERIAL_REQUESTED','MATERIAL_ISSUED'];
  const doneLsx=['lsx_hoan_thanh','lsx_da_nhap_kho'];
  const covered=(productId)=>{
    const inPlans=(DB.productionPlans||[]).filter(pl=>pendingPlanStatuses.includes(pl.status)).reduce((s,pl)=>s+(pl.items||[]).filter(i=>i.productId===productId).reduce((x,i)=>x+Number(i.qty||0),0),0);
    const inLsx=(DB.productionOrders||[]).filter(o=>o.productId===productId && !doneLsx.includes(o.status)).reduce((s,o)=>s+Number(o.qty||0),0);
    return inPlans+inLsx;
  };
  const list=(DB.products||[]).map(p=>{
    const min=Number(DB.finishedMinStock?.[p.id]||0), stock=pfFinishedStock(p.id), cov=covered(p.id);
    return {p,min,stock,cov,need:Math.max(0,Math.ceil(min-stock-cov))};
  }).filter(x=>x.min>0 && x.stock<x.min);
  if(!list.length){Toast.info('Không có thành phẩm dưới hạn mức','Tất cả thành phẩm đã khai báo hạn mức tồn tối thiểu đều đủ tồn.');return;}
  const rows=list.map(({p,min,stock,cov,need})=>`<div class="pf-plan-line" style="display:grid;grid-template-columns:32px 1fr 120px 190px;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" name="pick" data-product="${esc(p.id)}" ${need>0?'checked':''}><div><b>${esc(p.name)}</b><div class="cell-sub">${esc(p.id)} · Tồn ${fmtN(stock)} / hạn mức ${fmtN(min)} ${esc(p.unit||'')}</div></div><input class="inp right num" name="qty" type="number" min="0" step="1" value="${need}"><span>${cov>0?`<span class="badge blue">Đã có ${fmtN(cov)} đang KH/SX</span>`:(stock<=0?'<span class="badge red">Hết hàng</span>':'<span class="badge orange">Dưới hạn mức</span>')}</span></div>`).join('');
  Modal.open({title:'Lập kế hoạch sản xuất hàng loạt',sub:`${list.length} thành phẩm dưới hạn mức tồn · SL đề xuất đã trừ phần đang nằm trong kế hoạch/LSX`,size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Ngày lập *</label><input class="inp" id="pfPlanDate" type="date" value="${today}" min="${today}"></div><div class="field"><label>Ngày cần hoàn thành *</label><input class="inp" id="pfPlanDue" type="date" value="${addDays(today,7)}" min="${today}"></div></div><div class="form-sec-title"><i class="fa-solid fa-box"></i>Thành phẩm dưới hạn mức</div><div style="max-height:420px;overflow:auto">${rows}</div><div class="field"><label>Ghi chú</label><textarea class="inp" id="pfPlanNote" rows="2">Bổ sung tồn kho dưới hạn mức</textarea></div>`,foot:'<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="pf-plan-save"><i class="fa-solid fa-floppy-disk"></i>Lập kế hoạch</button>'});
};
Actions['pf-plan-save'] = async () => {
  const date=$('#pfPlanDate')?.value||currentDateYMD(), due=$('#pfPlanDue')?.value||date; if(date<currentDateYMD()||due<currentDateYMD()||due<date){Toast.err('Ngày chưa hợp lệ','Ngày kế hoạch và ngày hoàn thành không được ở quá khứ; deadline phải từ ngày lập trở đi.');return;}
  const items=[]; document.querySelectorAll('.pf-plan-line').forEach(row=>{const pick=row.querySelector('[name="pick"]'); const qty=Number(row.querySelector('[name="qty"]')?.value||0); if(pick?.checked&&qty>0)items.push({productId:pick.dataset.product,qty});});
  if(!items.length){Toast.err('Chưa chọn thành phẩm','Chọn ít nhất một thành phẩm và nhập số lượng lớn hơn 0.');return;}
  const id=nextCode('KHSX-2026-',DB.productionPlans||[]);
  const plan={id,date,dueDate:due,items,status:'WAITING_APPROVAL',note:$('#pfPlanNote')?.value.trim()||'',createdBy:DB.currentUser?.userId||DB.currentUser?.id||'',createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''),createdAt:new Date().toISOString()};
  DB.productionPlans.unshift(plan);
  try{
    await ProductionAPI?.persistCollections?.(['productionPlans']);
    Modal.close(); render(); Toast.ok('Đã lập kế hoạch',`${id} · Đã lưu server · Chờ duyệt tại Kho`);
  }catch(err){
    DB.productionPlans=(DB.productionPlans||[]).filter(x=>x.id!==id);
    render();
    Toast.err('Không lưu được kế hoạch sản xuất',err?.message||'Server chưa xác nhận dữ liệu.');
  }
};
Actions['pf-plan-approve'] = async (d) => {const p=(DB.productionPlans||[]).find(x=>x.id===d.id); if(!p||p.status!=='WAITING_APPROVAL')return; const prev={status:p.status,approvedBy:p.approvedBy,approvedAt:p.approvedAt}; p.status='APPROVED';p.approvedBy=DB.currentUser?.id||'';p.approvedAt=new Date().toISOString();if(p.source==='SALES_ORDER'&&p.sourceOrderId){const o=Q.order(p.sourceOrderId);if(o){o.status='dh_cho_san_xuat';o.productionPlanId=p.id;SalesCRM?.saveLocal(['orders']);}}try{await ProductionAPI?.persistCollections?.(['productionPlans']);render();Toast.ok('Đã duyệt kế hoạch',`${p.id} đã lưu server và chuyển sang Sản xuất → Kế hoạch sản xuất.`);}catch(err){Object.assign(p,prev);render();Toast.err('Không lưu được trạng thái duyệt',err?.message||'Server chưa xác nhận dữ liệu.');}};
Actions['pf-plan-delete'] = (d) => {const p=(DB.productionPlans||[]).find(x=>x.id===d.id); if(!p||p.status!=='WAITING_APPROVAL'){Toast.warn('Không thể xóa','Chỉ kế hoạch chưa duyệt mới được xóa.');return;} confirmBox({title:'Xóa kế hoạch sản xuất',icon:'fa-trash',okText:'Xóa',message:`Xóa kế hoạch <b>${esc(p.id)}</b>?`,onOk:()=>{DB.productionPlans=DB.productionPlans.filter(x=>x.id!==p.id);if(p.source==='SALES_ORDER'&&p.sourceOrderId){const o=Q.order(p.sourceOrderId);if(o&&o.productionPlanId===p.id){o.productionPlanId='';SalesCRM?.saveLocal(['orders']);}}ProductionAPI?.scheduleSync(80);render();Toast.ok('Đã xóa kế hoạch',p.id);}});};

Actions['pf-plan-add-material'] = (d,el) => {
  const host=el.closest('.pf-mat-product')?.querySelector('.pf-plan-material-lines'); if(!host)return;
  const first=(DB.materials||[])[0]; if(!first){Toast.warn('Chưa có nguyên liệu','Danh mục nguyên liệu đang trống.');return;}
  const row=document.createElement('div'); row.className='pf-mat-line'; row.style.cssText='display:grid;grid-template-columns:1fr 170px 42px;gap:8px;margin-bottom:8px';
  row.innerHTML=`<select class="inp" name="material">${(DB.products||[]).map(x=>`<option value="${esc(x.id)}">${esc(x.id)} — ${esc(x.name)} (${esc(x.unit||'')})</option>`).join('')}</select><input class="inp right num" name="qty" type="number" min="0.0001" step="0.0001" value="1"><button class="btn btn-sm" type="button" data-act="pf-plan-remove-material" title="Xóa dòng"><i class="fa-solid fa-trash"></i></button>`;
  host.appendChild(row);
};
Actions['pf-plan-remove-material'] = (d,el) => { el.closest('.pf-mat-line')?.remove(); };
Actions['pf-plan-add-operation'] = (d,el) => {
  const host=el.closest('.pf-mat-product')?.querySelector('.pf-plan-operation-lines'); if(!host)return;
  const first=(DB.operations||[])[0]; if(!first){Toast.warn('Chưa có công đoạn','Danh mục công đoạn sản xuất đang trống.');return;}
  const row=document.createElement('div'); row.className='pf-plan-op-line'; row.dataset.hours='0'; row.style.cssText='display:grid;grid-template-columns:1fr 180px 42px;gap:8px;margin-bottom:8px;align-items:center';
  row.innerHTML=`<select class="inp" name="operation">${(DB.operations||[]).map(o=>`<option value="${esc(o.id)}">${esc(o.id)} — ${esc(o.name)}</option>`).join('')}</select><input class="inp" name="note" placeholder="Ghi chú gia công (không bắt buộc)"><button class="btn btn-sm" type="button" data-act="pf-plan-remove-operation" title="Xóa công đoạn"><i class="fa-solid fa-trash"></i></button>`;
  host.appendChild(row);
};
Actions['pf-plan-remove-operation'] = (d,el) => { el.closest('.pf-plan-op-line')?.remove(); };

Actions['pf-plan-materials'] = (d) => {
  const plan=(DB.productionPlans||[]).find(x=>x.id===d.id); if(!plan||plan.status!=='APPROVED')return;
  const materialOptions=(selected='')=>(DB.materials||[]).map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.id)} — ${esc(x.name)} (${esc(x.unit||'')})</option>`).join('');
  const operationOptions=(selected='')=>(DB.operations||[]).map(o=>`<option value="${esc(o.id)}" ${o.id===selected?'selected':''}>${esc(o.id)} — ${esc(o.name)} · ${esc(o.workshop||'')}</option>`).join('');
  const blocks=(plan.items||[]).map(it=>{
    const p=Q.product(it.productId); const bom=(it.preparedMaterials||[]).length?it.preparedMaterials:(p?.bom||[]).map(([mid,per,lossPct=0])=>({materialId:mid,qty:pfBomRequiredQty(per,it.qty,lossPct),lossPct:Number(lossPct||0),baseQtyPerUnit:Number(per||0)}));
    const routing=(it.preparedOperations||[]).length?it.preparedOperations:(p?.routing||[]).map(([oid,hoursPer])=>({operationId:oid,hoursPer:Number(hoursPer||0),note:''}));
    const matRows=bom.map(r=>{const m=Q.material(r.materialId);const loss=Number(r.lossPct||0);const base=Number(r.baseQtyPerUnit||0);return `<div class="pf-mat-line" style="display:grid;grid-template-columns:1fr 190px 42px;gap:8px;margin-bottom:8px;align-items:start"><div><select class="inp" name="material">${materialOptions(r.materialId)}</select>${base>0?`<div class="cell-sub">ĐM ${fmtDec(base,4)} ${esc(m?.unit||'')}/1 · KH ${fmtN(it.qty)} · Hao hụt ${fmtDec(loss,2)}%</div>`:''}</div><input class="inp right num" name="qty" type="number" min="0.0001" step="0.0001" value="${Number(r.qty||0)}" title="Số lượng NVL hệ thống tự tính từ BOM và hao hụt"><button class="btn btn-sm" type="button" data-act="pf-plan-remove-material" title="Xóa dòng"><i class="fa-solid fa-trash"></i></button></div>`;}).join('');
    const opRows=routing.map(r=>`<div class="pf-plan-op-line" data-hours="${Number(r.hoursPer||0)}" style="display:grid;grid-template-columns:1fr 180px 42px;gap:8px;margin-bottom:8px;align-items:center"><select class="inp" name="operation">${operationOptions(r.operationId)}</select><input class="inp" name="note" value="${esc(r.note||'')}" placeholder="Ghi chú gia công (không bắt buộc)"><button class="btn btn-sm" type="button" data-act="pf-plan-remove-operation" title="Xóa công đoạn"><i class="fa-solid fa-trash"></i></button></div>`).join('');
    return `<div class="card pf-mat-product" data-product="${esc(it.productId)}" style="margin-bottom:12px"><div class="card-head"><div><h3>${esc(p?.name||it.productId)}</h3><p>Số lượng kế hoạch: ${fmtN(it.qty)} ${esc(p?.unit||'')} · Có thể thêm nguyên liệu và công đoạn riêng cho kế hoạch này</p></div></div><div class="card-body">
      <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>Nguyên liệu cần cấp</div><div class="pf-plan-material-lines">${matRows}</div><button class="btn btn-sm" type="button" data-act="pf-plan-add-material"><i class="fa-solid fa-plus"></i>Thêm nguyên liệu</button>
      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-gears"></i>Công đoạn / Gia công</div><div class="pf-plan-operation-lines">${opRows}</div><button class="btn btn-sm" type="button" data-act="pf-plan-add-operation"><i class="fa-solid fa-plus"></i>Thêm công đoạn gia công</button>
    </div></div>`;
  }).join('');
  Modal.open({title:`Chuẩn bị sản xuất · ${plan.id}`,sub:'Hệ thống tự tính NVL từ BOM × số lượng kế hoạch và % hao hụt. Có thể kiểm tra hoặc bổ sung dòng trước khi gửi Kho.',size:'xl',body:`${blocks}<div class="field"><label>Ghi chú yêu cầu</label><textarea class="inp" id="pfMrNote" rows="2"></textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="pf-mr-create" data-id="${esc(plan.id)}"><i class="fa-solid fa-paper-plane"></i>Lưu & lập phiếu yêu cầu NVL</button>`});
};
Actions['pf-mr-create'] = async (d) => {
  const plan=(DB.productionPlans||[]).find(x=>x.id===d.id); if(!plan||plan.status!=='APPROVED')return;
  const items=[];
  for(const group of document.querySelectorAll('.pf-mat-product')){
    const productId=group.dataset.product; const planItem=(plan.items||[]).find(x=>x.productId===productId); const preparedMaterials=[]; const preparedOperations=[]; const seenMat=new Set(); const seenOp=new Set();
    for(const row of group.querySelectorAll('.pf-mat-line')){const mid=row.querySelector('[name="material"]')?.value, qty=Number(row.querySelector('[name="qty"]')?.value||0);if(!mid||qty<=0){Toast.err('Yêu cầu chưa hợp lệ','Tất cả dòng nguyên liệu phải có số lượng lớn hơn 0.');return;}if(seenMat.has(mid)){Toast.err('Trùng thành phẩm',`${Q.material(mid)?.name||mid} đang xuất hiện nhiều lần trong cùng thành phẩm.`);return;}seenMat.add(mid);const bomDef=(Q.product(productId)?.bom||[]).find(([x])=>x===mid);const baseQtyPerUnit=Number(bomDef?.[1]||0),lossPct=Number(bomDef?.[2]||0);preparedMaterials.push({materialId:mid,qty,baseQtyPerUnit,lossPct});items.push({productId,materialId:mid,qty,baseQtyPerUnit,lossPct});}
    for(const row of group.querySelectorAll('.pf-plan-op-line')){const oid=row.querySelector('[name="operation"]')?.value, hoursPer=Number(row.dataset.hours||0), note=row.querySelector('[name="note"]')?.value.trim()||'';if(!oid){Toast.err('Công đoạn chưa hợp lệ','Vui lòng chọn công đoạn.');return;}if(seenOp.has(oid)){Toast.err('Trùng công đoạn',`${Q.operation(oid)?.name||oid} đang xuất hiện nhiều lần trong cùng thành phẩm.`);return;}seenOp.add(oid);preparedOperations.push({operationId:oid,hoursPer,note});}
    if(planItem){planItem.preparedMaterials=preparedMaterials;planItem.preparedOperations=preparedOperations;}
  }
  if(!items.length){Toast.err('Chưa có nguyên liệu','Thêm ít nhất một nguyên liệu trước khi lập phiếu yêu cầu.');return;}
  const id=nextCode('YCNVL-2026-',DB.productionMaterialRequests||[]);
  const request={id,planId:plan.id,date:currentDateYMD(),items,status:'APPROVED',note:$('#pfMrNote')?.value.trim()||'',createdBy:DB.currentUser?.id||'',createdAt:new Date().toISOString()};
  const prevPlan={status:plan.status,materialRequestId:plan.materialRequestId};
  DB.productionMaterialRequests.unshift(request); plan.status='MATERIAL_REQUESTED'; plan.materialRequestId=id;
  try{
    await ProductionAPI?.persistCollections?.(['productionPlans','productionMaterialRequests']);
    Modal.close();render();Toast.ok('Đã tạo yêu cầu NVL',`${id} · Đã lưu server · Kho có thể xuất NVL ngay.`);
  }catch(err){
    DB.productionMaterialRequests=(DB.productionMaterialRequests||[]).filter(x=>x.id!==id);Object.assign(plan,prevPlan);render();Toast.err('Không lưu được yêu cầu NVL',err?.message||'Server chưa xác nhận dữ liệu.');
  }
};
Actions['pf-mr-approve'] = (d) => {const r=(DB.productionMaterialRequests||[]).find(x=>x.id===d.id);if(!r||r.status!=='WAITING_WAREHOUSE_APPROVAL')return;r.status='APPROVED';r.approvedBy=DB.currentUser?.id||'';r.approvedAt=new Date().toISOString();ProductionAPI?.scheduleSync(80);render();Toast.ok('Đã duyệt yêu cầu NVL',`${r.id} có thể xuất kho.`);};

function pfAllocateMaterial(materialId,qty){
  let remain=Number(qty||0); const rows=(DB.inventory||[]).filter(r=>r.productId===materialId&&Number(r.qtyAvailable??r.qtyOnHand??0)>0&&inventoryRowIsUsableForIssue(r)).sort(sortIssueRowsFefoFifo); const alloc=[];
  for(const row of rows){if(remain<=0)break;const avail=Number(row.qtyAvailable??row.qtyOnHand??0);const take=Math.min(remain,avail);if(take>0){alloc.push({row,take});remain-=take;}}
  return {ok:remain<=0.000001,remain,alloc};
}
Actions['pf-mr-issue'] = (d) => {
  const r=(DB.productionMaterialRequests||[]).find(x=>x.id===d.id); if(!r||!['WAITING_WAREHOUSE_APPROVAL','APPROVED'].includes(r.status))return;
  const totals={}; (r.items||[]).forEach(i=>totals[i.materialId]=(totals[i.materialId]||0)+Number(i.qty||0)); const plans=[];
  for(const [mid,qty] of Object.entries(totals)){const a=pfAllocateMaterial(mid,qty);if(!a.ok){Toast.err('Không đủ tồn kho',`${Q.material(mid)?.name||mid} còn thiếu ${fmtDec(a.remain,2)} ${Q.material(mid)?.unit||''}.`);return;}plans.push({mid,qty,alloc:a.alloc});}
  confirmBox({title:'Xuất NVL cho sản xuất',icon:'fa-arrow-up-from-bracket',okText:'Xuất kho',message:`Xuất nguyên liệu theo phiếu <b>${esc(r.id)}</b>? Hệ thống sẽ trừ tồn theo lô khả dụng (ưu tiên FEFO) và tự lưu phiếu vào lịch sử Xuất kho nguyên liệu.`,onOk:()=>{
    const issueGroups={};
    for(const p of plans){
      for(const a of p.alloc){
        const posted=InventoryService.apply({productId:p.mid,warehouseId:a.row.warehouseId,locationId:a.row.locationId,lotId:a.row.lotId,quantity:a.take,type:'PRODUCTION_ISSUE',refType:'PRODUCTION_MATERIAL_REQUEST',refId:r.id,note:`Xuất NVL cho sản xuất theo ${r.id}`});
        if(!posted.ok){Toast.err('Xuất kho thất bại',posted.message);return;}
        const wh=a.row.warehouseId||'WH-001';
        (issueGroups[wh] ||= []).push({productId:p.mid,lotId:a.row.lotId||'',qty:a.take,locationId:a.row.locationId||'',unit:Q.material(p.mid)?.unit||a.row.unit||'',materialRequestId:r.id});
      }
    }
    const issueIds=[];
    Object.entries(issueGroups).forEach(([warehouseId,items])=>{
      const issueId=nextCode('PX-2026-',DB.goodsIssues||[]);
      DB.goodsIssues.unshift({id:issueId,type:'PRODUCTION_ISSUE',warehouseId,refDoc:r.id,productionMaterialRequestId:r.id,planId:r.planId||'',productionOrderId:r.productionOrderId||'',date:currentDateYMD(),status:'COMPLETED',createdBy:DB.currentUser?.id||'',approvedBy:'',note:`Xuất NVL cho sản xuất theo ${r.id}`,items});
      issueIds.push(issueId);
    });
    r.status='ISSUED';r.issuedBy=DB.currentUser?.id||'';r.issuedAt=new Date().toISOString();r.goodsIssueIds=issueIds;
    const plan=(DB.productionPlans||[]).find(x=>x.id===r.planId);if(plan)plan.status='MATERIAL_ISSUED';
    const po=(DB.productionOrders||[]).find(x=>x.id===r.productionOrderId);if(po)po.materialIssuedAt=r.issuedAt;
    ProductionAPI?.scheduleSync(80);
    InventoryAPI?.scheduleCollections?.(['goodsIssues','inventory','inventoryTransactions'],80);
    render();Toast.ok('Đã xuất NVL',`${r.id} · Đã tạo ${issueIds.length} phiếu xuất kho (${issueIds.join(', ')}) và lưu vào lịch sử Kho nguyên liệu.`);
  }});
};

Actions['pf-plan-release'] = async (d) => {
  // Sau khi Kho xuất NVL, role Sản xuất có thể đang giữ master Thành phẩm cũ/rỗng.
  // Hydrate lại KHSX + thành phẩm thật trước khi tạo LSX để TP-0001/SP-* luôn resolve được.
  try {
    await Promise.all([
      ProductionAPI?.bootstrap?.(),
      InventoryAPI?.bootstrap?.(),
      ProductionAPI?.ensureFresh?.(['productionPlans','productionOrders'], { force:true }),
      InventoryAPI?.ensureFresh?.(['products'], { force:true })
    ].filter(Boolean));
  } catch (err) { console.warn('[Production] Không hydrate đủ dữ liệu trước khi tạo LSX:', err); }
  const plan=(DB.productionPlans||[]).find(x=>String(x.id)===String(d.id));if(!plan||plan.status!=='MATERIAL_ISSUED')return;
  const missing=[]; const created=[];(plan.items||[]).forEach(it=>{const product=(DB.products||[]).find(p=>String(p.id).trim()===String(it.productId||'').trim()); if(!product){missing.push(it.productId);return;} const routingOverride=(it.preparedOperations||[]).map(o=>[o.operationId,Number(o.hoursPer||0),o.note||'']); const routingForMo=routingOverride.length?routingOverride:(product.routing||[]); const po={id:nextCode('LSX-2026-',DB.productionOrders),orderId:plan.source==='SALES_ORDER'?(plan.sourceOrderId||''):'',customerId:plan.source==='SALES_ORDER'?(plan.customerId||Q.order(plan.sourceOrderId)?.customerId||''):'',productId:product.id,productName:product.name,spec:product.spec||'',qty:Number(it.qty||0),unit:product.unit||'',startDate:currentDateYMD(),deadline:(plan.dueDate&&plan.dueDate>=currentDateYMD()?plan.dueDate:addDays(currentDateYMD(),7)),managerId:DB.currentUser?.empId||'NV-018',status:'lsx_cho_san_xuat',stages:buildProductionStagesFromRouting(Number(it.qty||0),routingForMo,currentDateYMD()),routingOverride,materialPlan:(it.preparedMaterials||[]).map(m=>({materialId:m.materialId,qty:Number(m.qty||0)})),qcPass:0,qcFail:0,planId:plan.id,materialRequestId:plan.materialRequestId||'',note:`Tạo từ kế hoạch ${plan.id}`,createdBy:DB.currentUser?.userId||DB.currentUser?.id||'',createdByName:(String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||''),createdAt:new Date().toISOString()};DB.productionOrders.unshift(po);created.push(po);});
  if(missing.length){Toast.err('Không tạo được LSX',`Không tìm thấy master thành phẩm: ${missing.join(', ')}. Vui lòng kiểm tra Danh mục thành phẩm.`);return;}
  if(!created.length){Toast.err('Không tạo được LSX','Kế hoạch không có thành phẩm hợp lệ.');return;}
  plan.status='RELEASED';plan.productionOrderIds=created.map(x=>x.id);if(plan.source==='SALES_ORDER'&&plan.sourceOrderId){const so=Q.order(plan.sourceOrderId);if(so){so.status='dh_dang_san_xuat';if(typeof SalesCRM!=='undefined')SalesCRM.saveLocal(['orders']);}}
  try { await ProductionAPI?.persistCollections?.(['productionPlans','productionOrders']); }
  catch(err){ Toast.err('Chưa lưu được LSX',err?.message||'Server chưa xác nhận dữ liệu.'); return; }
  render();Toast.ok('Đã tạo lệnh sản xuất',created.map(x=>x.id).join(', '));
};

/* ============================================================================
 * 8. GẮN SỰ KIỆN (event delegation cho toàn bộ ứng dụng)
 * ==========================================================================*/
const __actionSubmitLocks = new Map();
function actionNeedsSubmitLock(act) {
  return /(?:^|-)(save|confirm|complete|submit|send|release|issue)(?:$|-)/i.test(String(act || ''));
}
function actionSubmitLockKey(act, el) {
  const d = el?.dataset || {};
  return [act, d.id || '', d.poid || d.poId || '', d.prid || d.prId || '', d.type || '', d.tab || ''].join('|');
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (t) {
    const act = t.dataset.act;
    if (Actions[act]) {
      e.preventDefault();
      e.stopPropagation();
      const requiredPermission = typeof Auth !== 'undefined' ? Auth.permissionForAction(act) : null;
      if (requiredPermission && !Auth.require(requiredPermission)) return;

      // Chống double-click tạo 2 record/mã liên tiếp. Khóa theo action + record/form,
      // nên thao tác ở dòng khác vẫn độc lập. Áp dụng cho mọi nút Lưu/Xác nhận/Gửi.
      const shouldLock = actionNeedsSubmitLock(act);
      const lockKey = shouldLock ? actionSubmitLockKey(act, t) : '';
      if (shouldLock && __actionSubmitLocks.has(lockKey)) return;
      if (shouldLock) {
        __actionSubmitLocks.set(lockKey, Date.now());
        t.disabled = true;
        t.setAttribute('aria-busy', 'true');
      }

      try {
        const result = Actions[act]({ ...t.dataset }, t, e);
        if (result && typeof result.then === 'function') await result;
      } catch (err) {
        console.error(`[Action] ${act} thất bại:`, err);
        throw err;
      } finally {
        if (shouldLock) {
          // Giữ khóa đủ lâu để click thứ hai của double-click không lọt qua ngay cả
          // với action đồng bộ đóng modal/render rất nhanh.
          setTimeout(() => {
            __actionSubmitLocks.delete(lockKey);
            if (t?.isConnected) {
              t.disabled = false;
              t.removeAttribute('aria-busy');
            }
          }, 900);
        }
      }
      return;
    }
  }
  // Nhấp ra ngoài => đóng dropdown
  if (!e.target.closest('#pop') && !e.target.closest('#globalSearch')) Pop.close();
});

/** Cập nhật trực tiếp NCC có giá thấp nhất cho từng vật tư ngay khi người dùng nhập giá. */
function updateBestSupplierPrice(materialId) {
  if (!materialId) return;
  const inputs = [...document.querySelectorAll(`input.quote-supplier-price[data-material-id="${CSS.escape(materialId)}"]`)];
  if (!inputs.length) return;

  const validPrices = inputs
    .map((input) => ({ input, price: parseMoney(input.value) || 0 }))
    .filter((entry) => entry.price > 0);
  const lowestPrice = validPrices.length ? Math.min(...validPrices.map((entry) => entry.price)) : 0;

  inputs.forEach((input) => {
    const line = input.closest('.quote-supplier-line');
    if (!line) return;
    const price = parseMoney(input.value) || 0;
    const isLowest = lowestPrice > 0 && price === lowestPrice;

    line.style.borderColor = isLowest ? 'var(--green)' : 'var(--border)';
    line.style.background = isLowest ? 'var(--green-soft)' : 'var(--surface)';
    input.style.borderColor = isLowest ? 'var(--green)' : '';
    input.style.fontWeight = isLowest ? '700' : '';

    let badgeEl = line.querySelector('.quote-best-price-badge');
    if (isLowest) {
      if (!badgeEl) {
        badgeEl = document.createElement('span');
        badgeEl.className = 'badge green quote-best-price-badge';
        badgeEl.style.whiteSpace = 'nowrap';
        badgeEl.innerHTML = '<i class="fa-solid fa-arrow-down"></i> Giá tốt nhất';
        line.appendChild(badgeEl);
      }
    } else if (badgeEl) {
      badgeEl.remove();
    }
  });
}


/* Định dạng tiền trong form: 1200000 -> 1.200.000. */
function setupMoneyInput(el) {
  if (!el || el.dataset.moneyReady === '1') return;
  el.dataset.moneyReady = '1';
  el.type = 'text';
  el.inputMode = 'numeric';
  el.autocomplete = 'off';
  el.value = fmtMoneyInput(el.value);
}
function setupMoneyInputs(root = document) {
  root.querySelectorAll?.('[data-money="1"]').forEach(setupMoneyInput);
}
const moneyObserver = new MutationObserver((mutations) => {
  mutations.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches?.('[data-money="1"]')) setupMoneyInput(n); setupMoneyInputs(n); } }));
});
moneyObserver.observe(document.documentElement, { childList:true, subtree:true });
document.addEventListener('focusin', e => { if (e.target?.matches?.('[data-money="1"]')) setupMoneyInput(e.target); });

/* Ô nhập liệu: bộ lọc module, form báo giá, tìm kiếm toàn cục */
document.addEventListener('input', (e) => {
  const el = e.target;

  // Mọi ô số điện thoại trên form: chỉ cho nhập chữ số và tối đa 10 số.
  if (el instanceof HTMLInputElement) {
    const meta=[el.id,el.name,el.placeholder,el.getAttribute('aria-label'),el.closest('.field')?.querySelector('label')?.textContent].filter(Boolean).join(' ').toLowerCase();
    if (/(số điện thoại|điện thoại|sđt|phone)/i.test(meta)) { el.value=String(el.value||'').replace(/\D/g,'').slice(0,10); el.inputMode='numeric'; el.maxLength=10; }
  }

  if (el?.matches?.('[data-money="1"]')) {
    const digits = String(el.value || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    el.value = digits ? Number(digits).toLocaleString('vi-VN') : '';
  }

  // Tiền master hàng hóa: không để số 0 mặc định dính thành 012000;
  // người dùng gõ 12000 sẽ nhìn thấy 12.000 theo định dạng vi-VN.
  if (el.id === 'invItemPrice') {
    const digits = String(el.value || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    el.value = digits ? Number(digits).toLocaleString('vi-VN') : '';
    return;
  }

  if (el.classList?.contains('quote-supplier-price')) {
    updateBestSupplierPrice(el.dataset.materialId);
    return;
  }

  // Ô tìm mẫu trong popup "Thêm dòng": chỉ vẽ lại popup, không render cả trang
  if (el.dataset.tplsearch) {
    F('tplPicker').q = el.value;
    openTemplatePicker(State.params.id, $('[data-act="qi-add"]'));
    return;
  }

  // Bộ lọc của module: data-f="module.field"
  if (el.dataset.f) {
    const [key, field] = el.dataset.f.split('.');
    F(key)[field] = el.value;
    State.page[key] = 1;
    render();
    return;
  }
  // Form báo giá theo bảng giá sản phẩm
  if (el.dataset.qf) handleQuoteField(el);
  // Báo giá theo tham số đầu vào
  if (el.dataset.qi || el.dataset.qc || el.dataset.qt || el.dataset.qp) handleParamQuoteField(el, false);
  // Trình soạn công thức (YC-05): gõ tới đâu xem trước tới đó
  if (el.dataset.ct) { veXemTruocCongThuc(); return; }
  if (el.dataset.cttest) { CT_TEST[el.dataset.cttest] = el.value; veXemTruocCongThuc(); return; }
  // Bảng đơn giá đầu vào
  if (el.dataset.pb) handlePriceBookField(el);
  // Sửa nhanh đơn giá giờ trong danh mục công đoạn
  if (el.dataset.opRate) {
    const op = Q.operation(el.dataset.opRate);
    if (op) op.rate = Number(el.value) || 0;
  }
  // Tìm kiếm toàn cục
  if (el.id === 'globalSearch') runGlobalSearch(el.value);
});

document.addEventListener('focusout', (e) => {
  const el=e.target; if (!(el instanceof HTMLInputElement)) return;
  const meta=[el.id,el.name,el.placeholder,el.getAttribute('aria-label'),el.closest('.field')?.querySelector('label')?.textContent].filter(Boolean).join(' ').toLowerCase();
  if (/(số điện thoại|điện thoại|sđt|phone)/i.test(meta) && el.value && !/^\d{10}$/.test(el.value)) Toast.warn('Số điện thoại chưa hợp lệ','Số điện thoại phải gồm đúng 10 chữ số.');
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.type === 'date' && !el.dataset.f && el.value && el.value < currentDateYMD()) {
    el.value = currentDateYMD();
    Toast.warn('Ngày không hợp lệ', 'Không được chọn ngày trong quá khứ. Hệ thống đã đưa về ngày hiện tại.');
    return;
  }
  if (el.id === 'pfBomProduct') { pfOpenBomModal(el.value); return; }
  // CRM bán hàng: chọn thành phẩm thì lấy đơn giá bán hiện hành làm mặc định.
  if (el.matches('.crm-order-line select[name="product"]')) {
    const product = typeof Q !== 'undefined' ? Q.product(el.value) : null;
    const row = el.closest('.crm-order-line');
    const priceInput = row?.querySelector('input[name="price"]');
    const vatInput = row?.querySelector('select[name="vatRate"]');
    if (priceInput && product) priceInput.value = priceInput.matches('[data-money="1"]') ? fmtMoneyInput(product.price || 0) : Number(product.price || 0);
    if (vatInput && product && product.vatRate != null && [...vatInput.options].some(o=>Number(o.value)===Number(product.vatRate))) vatInput.value = String(Number(product.vatRate));
    if (typeof updateCrmOrderTotals === 'function') updateCrmOrderTotals(document);
  }
  if (el.dataset.f) {
    const [key, field] = el.dataset.f.split('.');
    F(key)[field] = el.value;
    State.page[key] = 1;
    render();
  }
  if (el.dataset.qf) handleQuoteField(el);
  // Đổi ô chọn (select) trong báo giá tham số => vẽ lại để cập nhật đơn giá/khối lượng
  if (el.dataset.qi || el.dataset.qc || el.dataset.qt || el.dataset.qp) {
    handleParamQuoteField(el, el.tagName === 'SELECT');
  }
  // Trình soạn công thức: đổi cách tính thì tính lại xem trước
  if (el.dataset.ct) veXemTruocCongThuc();
  if (el.dataset.cttest) { CT_TEST[el.dataset.cttest] = el.value; veXemTruocCongThuc(); }
  // PR: khi chọn bộ phận, chỉ hiển thị actor ERP thuộc bộ phận đó.
  // Nếu bộ phận để trống thì hiển thị toàn bộ actor ERP đang hoạt động.
  if (el.id === 'prDept') {
    const requester = $('#prRequester');
    if (requester) {
      const currentValue = requester.value;
      const dept = String(el.value || '').trim();
      const employees = (DB.users || [])
        .filter(user => user?.state === 'active' && user?.empId)
        .map(user => (DB.employees || []).find(emp => emp.id === user.empId))
        .filter(Boolean)
        .filter(emp => !dept || String(emp.dept || '').trim() === dept)
        .filter((emp, index, arr) => arr.findIndex(x => x.id === emp.id) === index)
        .sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
      requester.innerHTML = `<option value="">-- Chọn người đề nghị --</option>` + employees.map(emp =>
        `<option value="${esc(emp.id)}">${esc(emp.name)} — ${esc(emp.dept || '')}</option>`
      ).join('');
      if (employees.some(emp => String(emp.id) === String(currentValue))) requester.value = currentValue;
    }
  }

  if (el.id === 'poGrPo' || el.id === 'poGrDate') {
    const po = Q.purchaseOrder($('#poGrPo')?.value || '');
    const date = $('#poGrDate')?.value || DB.today;
    const host = $('#poGrDetail');
    if (host) host.innerHTML = receiptPoDetailHtml(po, date);
    const note = $('#poGrNote');
    if (note && el.id === 'poGrPo') note.value = po ? `Nhập kho theo đơn ${po.id}` : '';
    const saveBtn = $('#poGrSaveBtn');
    if (saveBtn && el.id === 'poGrPo') saveBtn.disabled = !po;
  }
  if (el.id === 'poGrWarehouse') {
    const host = $('#poGrLocation');
    const locations = Q.locationsOf(el.value);
    if (host) host.innerHTML = locations.length
      ? locations.map(l => `<option value="${l.id}">${esc(l.name)} · ${esc(l.code)}</option>`).join('')
      : '<option value="">Kho chưa có kệ / vị trí</option>';
  }
  if (el.id === 'whGrWarehouse') {
    const host = $('#whGrLocation');
    const locations = Q.locationsOf(el.value);
    if (host) host.innerHTML = locations.length
      ? locations.map(l => `<option value="${l.id}">${esc(l.name)} · ${esc(l.code)}</option>`).join('')
      : '<option value="">Kho chưa có kệ / vị trí</option>';
  }
  if (el.id === 'invItemUnit') {
    const saveBtn=document.querySelector('[data-act="inventory-item-save"]');
    if(saveBtn?.dataset.type==='FINISHED_GOODS'){
      const field=$('#invItemPackedWeightField');
      const isKg=/^\s*kg\s*$/i.test(String(el.value||''));
      if(field) field.style.display=isKg?'none':'';
      if(isKg && $('#invItemPackedWeightG')) $('#invItemPackedWeightG').value='';
    }
  }
  if (el.id === 'invItemCategory') {
    const type = document.querySelector('[data-act="inventory-item-save"]')?.dataset.type || 'RAW_MATERIAL';
    const code = $('#invItemId');
    if (code && !document.querySelector('[data-act="inventory-item-save"]')?.dataset.id) {
      code.value = el.value ? nextInventoryMasterCode(type, el.value) : 'Chọn danh mục để sinh mã';
    }
    if (type === 'RAW_MATERIAL') {
      const supplierSelect = $('#invItemSupplier');
      const matched = inventorySuppliersForCategory(el.value);
      if (supplierSelect) supplierSelect.innerHTML = `<option value="">${el.value ? '-- Chọn nhà cung cấp --' : '-- Chọn danh mục trước --'}</option>` + matched.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} · ${esc(s.id)}</option>`).join('');
      const hint = $('#invItemSupplierHint');
      if (hint) hint.textContent = el.value ? `${matched.length} nhà cung cấp thuộc nhóm ${el.value}.` : 'Chỉ hiển thị NCC thuộc cùng nhóm cung ứng với danh mục nguyên liệu.';
    }
  }
  if (el.id === 'invItemWarehouse') {
    const zone = $('#invItemZone');
    const shelf = $('#invItemLocationId');
    const zones = inventoryZonesOf(el.value);
    if (zone) zone.innerHTML = '<option value="">-- Chọn khu --</option>' + zones.map(z=>`<option value="${esc(z)}">${esc(z)}</option>`).join('');
    if (shelf) shelf.innerHTML = '<option value="">-- Chọn kệ --</option>';
  }
  if (el.id === 'invItemZone') {
    const shelf = $('#invItemLocationId');
    if (shelf) shelf.innerHTML = '<option value="">-- Chọn kệ --</option>' + inventoryShelfOptions($('#invItemWarehouse')?.value || '', el.value, '');
  }
});

/* ---------------------- BÁO GIÁ THEO THAM SỐ ĐẦU VÀO -------------------- */
/**
 * data-qi = trường của dòng tham số (kèm data-i)  |  data-qc = hệ số điều chỉnh
 * data-qt = tham số vận chuyển                    |  data-qp = đơn giá chốt
 * rerender = true khi thay đổi làm đổi cấu trúc bảng (đổi select, đổi hệ số)
 */
function handleParamQuoteField(el, rerender) {
  const q = Q.quote(State.params.id);
  if (!q || !q.inputs) return;
  danhDauChuaLuu(q);

  if (el.dataset.qi) {
    const row = q.inputs[Number(el.dataset.i)];
    if (!row) return;
    const field = el.dataset.qi;
    const val = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    if (field.startsWith('op.')) {
      row.ops = row.ops || {};
      row.ops[field.slice(3)] = Number(el.value) || 0;
    } else {
      row[field] = val;
    }
    // Ô số: chỉ cập nhật lại các ô kết quả để không mất con trỏ đang gõ
    if (rerender) render(); else refreshQuoteInputCells(q);
    return;
  }

  if (el.dataset.qc) {
    const k = el.dataset.qc;
    if (k === 'customerClass') q.customerClass = el.value;
    else if (k === 'productionType') q.productionType = el.value;
    else { q.coeffs = q.coeffs || {}; q.coeffs[k] = Number(el.value) || 0; }
    // Đổi hệ số thì đơn giá đề xuất đổi theo — nếu chưa chốt tay thì cập nhật luôn
    render();
    return;
  }

  if (el.dataset.qt) {
    q.transport = q.transport || {};
    q.transport[el.dataset.qt] = Number(el.value) || 0;
    render();
    return;
  }

  if (el.dataset.qp === 'unitPrice') {
    q.unitPrice = Number(el.value) || 0;
    render();
  }
}

/** Đánh dấu báo giá có thay đổi chưa lưu và cập nhật chỉ báo ngay trên đầu bảng */
function danhDauChuaLuu(q) {
  q.dirty = true;
  const el = $('#qSaveState');
  if (el) {
    el.style.color = 'var(--orange)';
    el.innerHTML = '<i class="fa-solid fa-circle" style="font-size:8px"></i> Có thay đổi chưa lưu';
  }
}

/* ============================================================================
 * YC-01.4 · Bấm "Thêm dòng" thì sổ ra thư viện mẫu cấu kiện
 * ==========================================================================*/
function openTemplatePicker(quoteId, anchor) {
  const q = Q.quote(quoteId || State.params.id);
  if (!q) return;
  const f = F('tplPicker', { q: '' });
  const kw = (f.q || '').toLowerCase().trim();

  const list = [...DB.ckTemplates]
    .filter((t) => !kw || (t.name + ' ' + t.group + ' ' + tomTatMau(t)).toLowerCase().includes(kw))
    .sort((a, b) => b.used - a.used);

  // Gom theo Thông số cấu kiện (YC-01.5)
  const groups = {};
  list.forEach((t) => { (groups[t.group || 'Khác'] = groups[t.group || 'Khác'] || []).push(t); });

  const html = `
    <div style="padding:8px 8px 4px">
      <div class="search-box" style="max-width:none">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input class="inp" type="text" data-f="tplPicker.q" data-tplsearch="1" value="${esc(f.q || '')}"
               placeholder="Tìm mẫu theo tên hoặc nhóm cấu kiện…" autocomplete="off" />
      </div>
    </div>
    <button class="pop-item" data-act="qi-add-blank" data-id="${q.id}" style="border:1px dashed var(--border-2);margin:4px 6px;width:calc(100% - 12px)">
      <i class="fa-solid fa-plus"></i><span style="font-weight:600">Dòng trống</span>
      <span style="margin-left:auto;font-size:11.3px;color:var(--text-3)">khai mới từ đầu</span>
    </button>
    <div class="pop-sep"></div>
    <div style="max-height:min(56vh,420px);overflow-y:auto">
      ${Object.keys(groups).length ? Object.entries(groups).map(([g, items]) => `
        <div class="pop-label">${esc(g)} · ${items.length}</div>
        ${items.map((t) => `<div class="sr-item" data-act="qi-add-tpl" data-id="${t.id}">
            <span class="sr-ico t-blue"><i class="fa-solid fa-clone"></i></span>
            <span style="min-width:0;flex:1 1 auto">
              <div class="sr-title">${esc(t.name)}</div>
              <div class="sr-sub">${esc(tomTatMau(t))}</div>
            </span>
            <span class="sr-right">${t.used ? `đã dùng ${t.used} lần` : 'chưa dùng'}<div style="font-size:10.5px">${t.id}</div></span>
          </div>`).join('')}`).join('')
        : `<div class="empty" style="padding:22px 14px"><div class="empty-ico"><i class="fa-solid fa-clone"></i></div>
             <h4>Chưa có mẫu phù hợp</h4>
             <p>Khai đủ một dòng rồi bấm mũi tên cuối dòng → “Lưu thành mẫu” để dùng lại về sau.</p></div>`}
    </div>`;

  Pop.open(anchor || $('[data-act="qi-add"]'), html, { align: 'right', width: 460 });
  const inp = $('#pop [data-tplsearch]');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

/** Bản sao bảng đơn giá ban đầu để có thể khôi phục */
const PRICEBOOK_GOC = JSON.parse(JSON.stringify(DB.priceBook));

/** Sửa một ô trong bảng đơn giá đầu vào — data-pb="<nhóm>.<khóa>" */
function handlePriceBookField(el) {
  const [group, ...rest] = el.dataset.pb.split('.');
  const key = rest.join('.');
  const val = Number(el.value) || 0;
  if (group === 'customerClass') {
    if (DB.priceBook.customerClass[key]) DB.priceBook.customerClass[key].duPhong = val;
  } else if (group === 'operationRate') {
    // Đơn giá nguyên công nằm trong danh mục nguyên công (nguồn duy nhất)
    const nc = NGUYEN_CONG.find((n) => n.key === key);
    if (nc) nc.rate = val;
  } else if (group === 'surfaceRate') {
    const sv = DB.catalogs.surfaces.find((s) => s.name === key);
    if (sv) sv.rate = val;
  } else if (DB.priceBook[group]) {
    DB.priceBook[group][key] = val;
  }
  // Không vẽ lại ngay để không mất con trỏ đang gõ; mọi báo giá sẽ tính theo
  // giá mới ngay lần hiển thị kế tiếp.
}

/** Hộp chọn kiểu báo giá khi bấm "Tạo báo giá" */
function openNewQuoteChooser() {
  Modal.open({
    title: 'Tạo báo giá mới',
    sub: 'Chọn cách lập giá phù hợp với loại hàng',
    size: 'md',
    body: `<div class="grid g-2">
        <div class="report-card" data-act="new-quote-param" style="padding:18px">
          <span class="rc-ico t-blue"><i class="fa-solid fa-table-list"></i></span>
          <b style="font-size:14px">Bóc tách theo tham số đầu vào</b>
          <span style="line-height:1.6;margin-top:4px">Khai báo từng cấu kiện: kích thước, vật liệu, bề mặt, hao hụt và các nguyên công.
          Hệ thống tự tính khối lượng vật tư / phôi / diện tích rồi lập bảng phân tích giá theo <b>VND/kg</b>.</span>
          <span style="margin-top:8px;color:var(--primary);font-weight:600">Dùng cho thang máng cáp, kết cấu &rarr;</span>
        </div>
        <div class="report-card" data-act="new-quote-product" style="padding:18px">
          <span class="rc-ico t-indigo"><i class="fa-solid fa-cube"></i></span>
          <b style="font-size:14px">Bóc tách theo bảng giá sản phẩm</b>
          <span style="line-height:1.6;margin-top:4px">Chọn sản phẩm có sẵn định mức vật tư (BOM) và công đoạn (routing),
          điều chỉnh số lượng và tỷ lệ lợi nhuận để ra đơn giá.</span>
          <span style="margin-top:8px;color:var(--indigo);font-weight:600">Dùng cho sản phẩm đậu hủ và đồ uống từ đậu nành &rarr;</span>
        </div>
      </div>`,
    foot: '<button class="btn" data-act="modal-close">Đóng</button>',
  });
}

/** Tạo báo giá mới theo tham số đầu vào rồi mở luôn màn nhập */
function createParamQuote(customerId) {
  const id = nextCode('BG-2026-', DB.quotes);
  const q = {
    id, customerId: customerId || DB.customers[0].id,
    date: DB.today, validUntil: addDays(DB.today, DB.settings.quoteValidDays),
    ownerId: 'NV-002', status: 'bg_nhap',
    customerClass: 'Ổn định', productionType: 'Hàng tiêu chuẩn, sản xuất hàng loạt',
    coeffs: { chung: 2, quanLy: 0, loiNhuan: 5, xuLy: 10, duPhong: 0 },
    transport: { chuyenNhanHang: 1, chuyenXuLyNgoai: 0, chuyenGiaoHang: 0, kmGiaoHang: 0, soLuongLapDat: 0 },
    unitPrice: 0, vatRate: 10, discountPct: 0,
    quoteCode: id,
    inputs: [dongThamSoMoi(1, id)],
    items: [], subtotal: 0, discount: 0, vat: 0, total: 0,
    paymentTerm: '30% tạm ứng khi ký hợp đồng, 70% thanh toán sau khi nghiệm thu',
    note: 'Đơn giá tính theo khối lượng phôi sản phẩm (VND/kg) dựa trên tham số đầu vào của từng cấu kiện.',
  };
  DB.quotes.unshift(q);
  SEARCH_INDEX = null;
  State.tab['quote'] = 'input';
  logActivity('tạo báo giá đầu vào', id, 'chờ khai báo tham số cấu kiện', 'fa-table-list', 'blue');
  go('quote-detail', { id });
  Toast.ok('Đã tạo ' + id, 'Khai báo tham số cấu kiện, hệ thống sẽ tự tính khối lượng và giá thành.');
}

/** Cập nhật bản nháp báo giá khi người dùng nhập liệu.
 *  - Thao tác chỉ đổi SỐ  -> chỉ vẽ lại các ô tính toán (giữ con trỏ đang gõ)
 *  - Thao tác đổi CẤU TRÚC -> vẽ lại toàn bộ danh sách dòng                */
function handleQuoteField(el) {
  const kind = el.dataset.qf;
  const i = Number(el.dataset.i);
  const j = Number(el.dataset.j);
  const it = QuoteDraft.items[i];
  let structural = false;

  switch (kind) {
    /* ----- Thông tin chung ----- */
    case 'customer':
      QuoteDraft.customerId = el.value; QuoteDraft.syncCustomer();
      $('#qContact').value = QuoteDraft.contact;
      $('#qPhone').value = QuoteDraft.phone;
      $('#qEmail').value = QuoteDraft.email;
      el.closest('.field')?.classList.remove('invalid');
      return;
    case 'date':  QuoteDraft.date = el.value; return;
    case 'valid': QuoteDraft.validUntil = el.value; return;
    case 'owner': QuoteDraft.ownerId = el.value; return;
    case 'term':  QuoteDraft.paymentTerm = el.value; return;

    /* ----- Dòng sản phẩm ----- */
    case 'product':
      QuoteDraft.loadProduct(i, el.value);
      QuoteDraft.expanded = i;          // mở luôn phần bóc tách cho người dùng thấy
      structural = true;
      break;
    case 'qty':    it.qty = Math.max(1, Number(el.value) || 1); break;
    case 'margin': it.marginPct = Math.max(0, Number(el.value) || 0); break;

    /* ----- Dòng vật tư ----- */
    case 'mat': {
      const m = Q.material(el.value);
      if (m) Object.assign(it.materials[j], { materialId: m.id, name: m.name, unit: m.unit, group: m.group, price: m.price });
      structural = true;
      break;
    }
    case 'matname':  it.materials[j].name = el.value; return;
    case 'matunit':  it.materials[j].unit = el.value; return;
    case 'matgroup': it.materials[j].group = el.value; return;
    case 'matqty':   it.materials[j].qtyPer = Math.max(0, Number(el.value) || 0); break;
    case 'matprice': it.materials[j].price = Math.max(0, Number(el.value) || 0); break;

    /* ----- Dòng công đoạn ----- */
    case 'op': {
      const o = Q.operation(el.value);
      if (o) Object.assign(it.operations[j], { operationId: o.id, name: o.name, workshop: o.workshop, machine: o.machine, rate: o.rate });
      structural = true;
      break;
    }
    case 'opname':    it.operations[j].name = el.value; return;
    case 'opws':      it.operations[j].workshop = el.value; return;
    case 'opmachine': it.operations[j].machine = el.value; return;
    case 'ophours':   it.operations[j].hoursPer = Math.max(0, Number(el.value) || 0); break;
    case 'oprate':    it.operations[j].rate = Math.max(0, Number(el.value) || 0); break;

    /* ----- Tổng hợp ----- */
    case 'overhead': QuoteDraft.overheadPct = Math.max(0, Math.min(50, Number(el.value) || 0)); break;
    case 'discount': QuoteDraft.discountPct = Math.max(0, Math.min(100, Number(el.value) || 0)); break;
    case 'vat':      QuoteDraft.vatRate = Number(el.value) || 0; break;
    default: return;
  }

  if (structural) refreshQuoteForm();
  else updateQuoteNumbers();
}

function updateAuthUserUI() {
  const u=DB.currentUser || {}; const ini=u.initials || initials(u.name || 'ERP');
  document.querySelectorAll('#topUser .avatar,#sideUser .avatar').forEach(el => el.textContent=ini);
  document.querySelectorAll('.top-user-name,.side-user-name').forEach(el => el.textContent=u.name || 'Người dùng');
  document.querySelectorAll('.top-user-role,.side-user-role').forEach(el => el.textContent=u.role || '');
}

/* ---------------------------------------------------- 9. TOPBAR & PHÍM TẮT */
function bindTopbar() {
  $('#hamburger').onclick = openSidebar;
  $('#sidebarClose').onclick = closeSidebar;
  $('#scrim').onclick = closeSidebar;
  $('#overlay').onclick = () => { Modal.close(); Drawer.close(); };
  $('#btnTheme').onclick = toggleTheme;
  // $('#btnHelp').onclick = openGuide;
  $('#btnBell').onclick = (e) => { e.stopPropagation(); Pop.isOpen() ? Pop.close() : openNotifications($('#btnBell')); };

  $('#btnSearchMobile').onclick = () => {
    $('#gsearchBox').classList.toggle('mobile-open');
    if ($('#gsearchBox').classList.contains('mobile-open')) $('#globalSearch').focus();
  };

  const userMenu = (anchor) => (e) => {
    e.stopPropagation();
    Pop.open(anchor, `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 10px">
        <span class="avatar">${esc(DB.currentUser.initials || initials(DB.currentUser.name))}</span>
        <span><div style="font-weight:700;font-size:13px">${esc(DB.currentUser.name)}</div>
        <div style="font-size:11.5px;color:var(--text-3)">${esc(DB.currentUser.email)}</div></span>
      </div>
      <div class="pop-sep"></div>
      <button class="pop-item"><i class="fa-solid fa-user"></i>Hồ sơ cá nhân</button>
      ${Auth.hasPermission('ADMIN_USER_MANAGE') ? `<button class="pop-item" data-act="go" data-id="users"><i class="fa-solid fa-user-shield"></i>Người dùng & phân quyền</button>` : ''}
      <button class="pop-item" data-act="toggle-theme"><i class="fa-solid fa-circle-half-stroke"></i>Đổi giao diện sáng / tối</button>
      <div class="pop-sep"></div>
      <button class="pop-item danger" data-act="auth-logout"><i class="fa-solid fa-right-from-bracket"></i>Đăng xuất</button>`);
  };
  $('#topUser').onclick = userMenu($('#topUser'));
  $('#sideUser').onclick = userMenu($('#sideUser'));

  $('#globalSearch').addEventListener('focus', function () { if (this.value) runGlobalSearch(this.value); });
  $('#globalSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('#globalSearch').blur(); Pop.close(); }
    if (e.key === 'Enter') { const first = $('#pop .sr-item'); if (first) first.click(); }
  });

  // Phím tắt Ctrl+K / Cmd+K để mở tìm kiếm
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#gsearchBox').classList.add('mobile-open');
      $('#globalSearch').focus();
      $('#globalSearch').select();
    }
    if (e.key === 'Escape') { Modal.close(); Drawer.close(); Pop.close(); }
  });

  // Đóng dropdown khi cuộn / đổi kích thước
  window.addEventListener('resize', () => { Pop.close(); if (window.innerWidth > 900) closeSidebar(); });
  $('#view').addEventListener('scroll', () => Pop.close(), true);
}

/* ------------------------------------------------------------ 10. KHỞI ĐỘNG */

/* ============================================================================
 * ROUTE DATA REFRESH - PERFORMANCE
 * ----------------------------------------------------------------------------
 * Chỉ refresh những collection cần cho màn hình đang mở. Không refresh toàn bộ
 * Purchase + Inventory + CRM ngay lúc login, vì KIO list.js phản hồi chậm và có
 * cơ chế abort request. Việc này chỉ thay cách tải dữ liệu, không đổi nghiệp vụ.
 * ========================================================================== */
let __routeRefreshTimer = null;

/* ============================================================================
 * SIDEBAR BADGES - SERVER VERIFIED
 * ----------------------------------------------------------------------------
 * Badge ở sidebar không được lấy từ cache cũ. Chỉ hiện sau khi collection liên
 * quan đã được đọc từ KIO/server ít nhất một lần trong phiên hiện tại.
 * Sau đó mọi action duyệt/hoàn thành cập nhật DB tại chỗ nên renderNav() sẽ
 * tính lại ngay, không cần lưu một biến count riêng.
 * ========================================================================== */
window.SidebarBadges = (() => {
  const ready = { purchases: false, production: false, all: false };
  let refreshPromise = null;

  const normalize = (v) => String(v || '').trim().toLowerCase();

  function purchasePendingCount() {
    return (DB.purchases || []).filter((p) => {
      const st = normalize(p.status);
      return st === 'mh_cho_duyet' || st === 'pending_approval';
    }).length;
  }

  function productionActiveCount() {
    return (DB.productionOrders || []).filter((p) => {
      const st = normalize(p.status);
      // Giữ đúng ý nghĩa badge cũ: chỉ đếm lệnh đang sản xuất.
      return st === 'lsx_dang_san_xuat';
    }).length;
  }

  function approvalPendingCount() {
    return (DB.approvalRequests || []).filter((r) => normalize(r.status) === 'pending').length;
  }

  function isReady(key) { return ready[key] === true; }
  function markReady(key) { if (key in ready) ready[key] = true; }

  async function refreshAll({ force = true } = {}) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const jobs = [];

      if (typeof PurchaseAPI !== 'undefined') {
        jobs.push((async () => {
          try {
            await PurchaseAPI.bootstrap?.();
            await PurchaseAPI.ensureFresh?.(['purchases'], { force });
            ready.purchases = true;
          } catch (err) {
            console.warn('[SidebarBadges] Không xác minh được Purchase:', err);
          }
          return 'purchases';
        })());
      }

      if (typeof ProductionAPI !== 'undefined') {
        jobs.push((async () => {
          try {
            await ProductionAPI.bootstrap?.();
            await ProductionAPI.ensureFresh?.(['productionOrders'], { force });
            ready.production = true;
          } catch (err) {
            console.warn('[SidebarBadges] Không xác minh được Production:', err);
          }
          return 'production';
        })());
      }

      await Promise.allSettled(jobs);
      if (typeof renderNav === 'function') renderNav();
      return { ...ready };
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  return { isReady, markReady, refreshAll, purchasePendingCount, productionActiveCount, approvalPendingCount };
})();


/* ============================================================================
 * DASHBOARD DATA SYNC
 * ----------------------------------------------------------------------------
 * Dashboard tổng dùng dữ liệu từ nhiều phân hệ. Khi F5 trực tiếp vào Dashboard,
 * các API con chưa chắc đã bootstrap nên DB.* có thể đang rỗng và KPI bị 0 giả.
 * Cơ chế dưới đây hydrate snapshot gần nhất trước (nhanh, local), rồi refresh
 * đúng các collection KPI từ KIO/server ở nền và render lại nếu vẫn ở Dashboard.
 * ========================================================================== */
window.DashboardDataSync = (() => {
  let hydrated = false;
  let refreshPromise = null;

  function apis() {
    return [
      typeof PurchaseAPI !== 'undefined' ? PurchaseAPI : null,
      typeof InventoryAPI !== 'undefined' ? InventoryAPI : null,
      typeof CRMAPI !== 'undefined' ? CRMAPI : null,
      typeof ProductionAPI !== 'undefined' ? ProductionAPI : null,
      typeof RestaurantQualityAPI !== 'undefined' ? RestaurantQualityAPI : null,
    ].filter(Boolean);
  }

  async function hydrate() {
    if (hydrated) return true;
    await Promise.allSettled(
      apis().map(api => typeof api.bootstrap === 'function' ? Promise.resolve().then(() => api.bootstrap()) : Promise.resolve())
    );
    hydrated = true;
    return true;
  }

  async function refresh({ force = true } = {}) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      await hydrate();
      const jobs = [];
      if (typeof CRMAPI !== 'undefined')
        jobs.push(CRMAPI.ensureFresh?.(['customers','orders'], { force }));
      if (typeof InventoryAPI !== 'undefined')
        jobs.push(InventoryAPI.ensureFresh?.(['inventory','materials'], { force }));
      if (typeof PurchaseAPI !== 'undefined')
        jobs.push(PurchaseAPI.ensureFresh?.(['purchases','purchaseOrders'], { force }));
      if (typeof ProductionAPI !== 'undefined')
        jobs.push(ProductionAPI.ensureFresh?.(['productionOrders'], { force }));
      if (typeof RestaurantQualityAPI !== 'undefined')
        jobs.push(RestaurantQualityAPI.ensureFresh?.(['orders'], { force }));
      if (typeof SystemAPI !== 'undefined' && typeof SystemAPI.refreshAuditLogs === 'function')
        jobs.push(SystemAPI.refreshAuditLogs({ force }));

      await Promise.allSettled(jobs.filter(Boolean));
      window.SidebarBadges?.markReady?.('purchases');
      window.SidebarBadges?.markReady?.('production');
      if (typeof renderNav === 'function') renderNav();
      if (State.module === 'dashboard' && typeof render === 'function') render();
      return true;
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  return { hydrate, refresh, isHydrated: () => hydrated };
})();

/* ============================================================================
 * MULTI-SOURCE ROUTE DATA
 * ----------------------------------------------------------------------------
 * Một số màn hình (Kế toán, BI, R&D...) cần dữ liệu từ NHIỀU API cùng lúc.
 * routeMultiPlan() gói các API đó thành một "nguồn" duy nhất có bootstrap() /
 * ensureFresh() giống một API đơn, để cả boot() (F5) lẫn scheduleRouteDataRefresh()
 * (chuyển menu) dùng chung mà không cần sửa.
 * ========================================================================== */
function routeApis() {
  return {
    hr: typeof HRAPI !== 'undefined' ? HRAPI : null,
    rnd: typeof RNDApi !== 'undefined' ? RNDApi : null,
    crm: typeof CRMAPI !== 'undefined' ? CRMAPI : null,
    purchase: typeof PurchaseAPI !== 'undefined' ? PurchaseAPI : null,
    inventory: typeof InventoryAPI !== 'undefined' ? InventoryAPI : null,
    production: typeof ProductionAPI !== 'undefined' ? ProductionAPI : null,
    restaurant: typeof RestaurantQualityAPI !== 'undefined' ? RestaurantQualityAPI : null,
  };
}

function routeMultiSource(parts, { after } = {}) {
  const list = (parts || []).filter(p => p && p.api && Array.isArray(p.keys) && p.keys.length);
  return {
    async bootstrap() {
      await Promise.allSettled(list.map(p => (typeof p.api.bootstrap === 'function' ? p.api.bootstrap() : null)));
      return true;
    },
    async ensureFresh(_keys, { force = false } = {}) {
      const results = await Promise.allSettled(list.map(p => p.api.ensureFresh(p.keys, { force })));
      const changed = {};
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value && typeof r.value === 'object') Object.assign(changed, r.value);
      }
      if (typeof after === 'function') { try { after(changed); } catch (_) {} }
      return changed;
    },
  };
}

// spec: { apiName: [keys...] } — apiName là khóa trong routeApis().
function routeMultiPlan(spec, { deferred = true, after } = {}) {
  const apis = routeApis();
  const parts = Object.entries(spec).map(([name, keys]) => ({ api: apis[name], keys }));
  return { api: routeMultiSource(parts, { after }), keys: parts.flatMap(p => p.keys), deferred };
}

function routeRefreshPlan(module, tab) {
  if (module === 'purchases') {
    // PR là màn giao giữa Purchase và Approvals. Approval request/log chỉ do
    // ApprovalsAPI sở hữu; PurchaseAPI không được apply cache approval lên DB nữa.
    // Nhờ vậy mở Đề nghị mua hàng không thể làm rỗng DB.approvalRequests đang đúng.
    if (tab === 'pr') {
      const purchasePrServerSource = {
        async bootstrap() {
          await Promise.allSettled([
            typeof PurchaseAPI !== 'undefined' && PurchaseAPI.bootstrap ? PurchaseAPI.bootstrap() : null,
            typeof ApprovalsAPI !== 'undefined' && ApprovalsAPI.bootstrap ? ApprovalsAPI.bootstrap() : null,
          ].filter(Boolean));
          return true;
        },
        async ensureFresh(_keys, { force = false } = {}) {
          const parts = await Promise.allSettled([
            typeof PurchaseAPI !== 'undefined' && PurchaseAPI.ensureFresh
              ? PurchaseAPI.ensureFresh(['purchases','purchaseOrders','suppliers'], { force }) : null,
            typeof ApprovalsAPI !== 'undefined' && ApprovalsAPI.ensureFresh
              ? ApprovalsAPI.ensureFresh(['requests','logs'], { force }) : null,
          ].filter(Boolean));
          const changed = {};
          for (const part of parts) {
            if (part.status === 'fulfilled' && part.value && typeof part.value === 'object') Object.assign(changed, part.value);
          }
          return changed;
        },
      };
      return { api: purchasePrServerSource, keys: ['purchases','purchaseOrders','suppliers','requests','logs'], deferred: false };
    }
    const map = {
      dashboard: ['purchases', 'purchaseOrders', 'supplierPayments'],
      quotes: ['supplierQuotations', 'purchases', 'suppliers'],
      po: ['purchaseOrders', 'suppliers'],
      debts: ['purchaseOrders', 'supplierPayments', 'suppliers'],
      price_history: ['purchasePriceHistory', 'suppliers'],
      suppliers: ['suppliers', 'supplierEvaluations'],
    };
    return { api: typeof PurchaseAPI !== 'undefined' ? PurchaseAPI : null, keys: map[tab] || map.dashboard };
  }

  if (module === 'approvals') {
    // Phê duyệt dùng đúng 2 nguồn thật. routeMultiPlan nhận tên khóa của routeApis()
    // (purchase/inventory/...), không nhận tên biến global như ApprovalsAPI/PurchaseAPI.
    // Dùng source tường minh để tránh màn "Việc cần duyệt" bị rỗng khi vào thẳng route.
    return {
      api: {
        async bootstrap() {
          await Promise.allSettled([
            typeof ApprovalsAPI !== 'undefined' && ApprovalsAPI.bootstrap ? ApprovalsAPI.bootstrap() : null,
            typeof PurchaseAPI !== 'undefined' && PurchaseAPI.bootstrap ? PurchaseAPI.bootstrap() : null,
            typeof CRMAPI !== 'undefined' && CRMAPI.bootstrap ? CRMAPI.bootstrap() : null,
          ].filter(Boolean));
          // Sau khi dữ liệu nghiệp vụ + Approval đã có từ server, tự phục hồi
          // request bị thiếu cho cả PR và Đơn hàng bán.
          if (typeof approvalReconcilePendingPrs === 'function') await approvalReconcilePendingPrs({ persist: true });
          if (typeof approvalReconcilePendingSalesOrders === 'function') await approvalReconcilePendingSalesOrders({ persist: true });
          return true;
        },
        async ensureFresh(_keys, { force = false } = {}) {
          // Việc cần duyệt là dữ liệu liên thiết bị: luôn hỏi server thật khi vào route.
          // Quan trọng: trả về object changed để scheduleRouteDataRefresh() biết phải
          // render lại ngay sau khi request hoàn tất. Trước đây return true làm UI giữ
          // bảng rỗng cho tới lần click thứ hai dù DB đã được cập nhật ở nền.
          const jobs = [];
          if (typeof ApprovalsAPI !== 'undefined' && ApprovalsAPI.ensureFresh) jobs.push(ApprovalsAPI.ensureFresh(['requests','logs'], { force: true }));
          if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.ensureFresh) jobs.push(PurchaseAPI.ensureFresh(['purchases'], { force: true }));
          if (typeof CRMAPI !== 'undefined' && CRMAPI.ensureFresh) jobs.push(CRMAPI.ensureFresh(['orders'], { force: true }));
          const parts = await Promise.allSettled(jobs);
          const changed = {};
          for (const part of parts) {
            if (part.status === 'fulfilled' && part.value && typeof part.value === 'object') Object.assign(changed, part.value);
          }
          const repaired = typeof approvalReconcilePendingPrs === 'function'
            ? await approvalReconcilePendingPrs({ persist: true }) : {created:0,repaired:0};
          const salesRepaired = typeof approvalReconcilePendingSalesOrders === 'function'
            ? await approvalReconcilePendingSalesOrders({ persist: true }) : {created:0,repaired:0};
          if (repaired?.created || repaired?.repaired || salesRepaired?.created || salesRepaired?.repaired) changed.reconciled = true;
          // Kể cả server trả cùng dữ liệu, renderNav cần dùng DB mới nhất sau force refresh.
          changed.approvalsValidated = true;
          return changed;
        },
      },
      keys: ['requests','logs','purchases','orders'],
      deferred: false,
    };
  }

  if (module === 'warehouse') {
    // Nhập kho nguyên liệu là màn giao nhau giữa Purchase và Inventory:
    // PO/phiếu nhận nằm ở Purchase KIO, còn master kho/vị trí nằm ở Inventory KIO.
    // Không được chỉ refresh InventoryAPI vì khi đăng nhập thẳng bằng Kho,
    // DB.purchaseOrders sẽ rỗng dù PO trên server đã ở trạng thái SHIPPING.
    if (tab === 'receipts') {
      const warehouseReceiptServerSource = {
        async bootstrap() {
          const jobs = [];
          if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.bootstrap) jobs.push(PurchaseAPI.bootstrap());
          if (typeof InventoryAPI !== 'undefined' && InventoryAPI.bootstrap) jobs.push(InventoryAPI.bootstrap());
          await Promise.allSettled(jobs);
          return true;
        },
        async ensureFresh(_keys, { force = false } = {}) {
          const jobs = [];
          if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.ensureFresh) {
            jobs.push(PurchaseAPI.ensureFresh(['purchaseOrders', 'goodsReceipts', 'suppliers'], { force }));
          }
          if (typeof InventoryAPI !== 'undefined' && InventoryAPI.ensureFresh) {
            // Chỉ master tối thiểu cho màn nhập kho; lô/vị trí chi tiết lazy-load khi mở form.
            jobs.push(InventoryAPI.ensureFresh(['warehouses', 'warehouseLocations', 'materials', 'products', 'semiFinishedProducts'], { force }));
          }
          const parts = await Promise.allSettled(jobs);
          const changed = {};
          for (const part of parts) {
            if (part.status === 'fulfilled' && part.value && typeof part.value === 'object') Object.assign(changed, part.value);
          }
          return changed;
        }
      };
      return {
        api: warehouseReceiptServerSource,
        keys: ['purchaseOrders', 'goodsReceipts', 'suppliers', 'warehouses', 'warehouseLocations', 'materials', 'products', 'semiFinishedProducts'],
        deferred: false
      };
    }

    // Xuất NVL sản xuất là màn giao nhau giữa Production và Inventory.
    // YCNVL nằm ở lenam_production_material_requests; tồn/lô/phiếu xuất nằm ở Inventory.
    // Khi Kho đăng nhập trực tiếp phải tự nạp cả hai nguồn, không phụ thuộc việc đã mở Sản xuất trước đó.
    if (tab === 'issues' || tab === 'production_requests') {
      const warehouseIssueServerSource = {
        async bootstrap() {
          const jobs=[];
          if(typeof ProductionAPI!=='undefined' && ProductionAPI.bootstrap) jobs.push(ProductionAPI.bootstrap());
          if(typeof InventoryAPI!=='undefined' && InventoryAPI.bootstrap) jobs.push(InventoryAPI.bootstrap());
          if(typeof CRMAPI!=='undefined' && CRMAPI.bootstrap) jobs.push(CRMAPI.bootstrap());
          await Promise.allSettled(jobs);
          return true;
        },
        async ensureFresh(_keys,{force=false}={}) {
          const jobs=[];
          if(typeof ProductionAPI!=='undefined' && ProductionAPI.ensureFresh)
            jobs.push(ProductionAPI.ensureFresh(['productionMaterialRequests'],{force}));
          if(typeof InventoryAPI!=='undefined' && InventoryAPI.ensureFresh)
            jobs.push(InventoryAPI.ensureFresh(['goodsIssues','inventory','inventoryLots','warehouses','materials','products'],{force}));
          if(typeof CRMAPI!=='undefined' && CRMAPI.ensureFresh)
            jobs.push(CRMAPI.ensureFresh(['orders'],{force}));
          const parts=await Promise.allSettled(jobs);
          const changed={};
          for(const part of parts){if(part.status==='fulfilled'&&part.value&&typeof part.value==='object')Object.assign(changed,part.value);}

          // Sau khi dữ liệu CRM + Kho đã đúng từ server, tạo phiếu SALES_ISSUE
          // còn thiếu cho các đơn Sẵn sàng xuất bán. Không tạo trùng.
          const reconciled = await ensureReadySalesIssuesForWarehouse();
          if (reconciled.created || reconciled.linked) {
            changed.goodsIssues = true;
            changed.inventory = true;
            changed.orders = true;
          }
          return changed;
        }
      };
      return {
        api: warehouseIssueServerSource,
        keys: ['productionMaterialRequests','goodsIssues','inventory','inventoryLots','warehouses','materials','products','orders'],
        deferred: false
      };
    }

    // Duyệt yêu cầu bổ sung cửa hàng là màn giao nhau giữa Nhà hàng/Cửa hàng và Kho.
    // Yêu cầu được lưu ở lenam_restaurant_replenishment_requests, vì vậy Kho phải
    // nạp trực tiếp RestaurantQualityAPI từ server thay vì chỉ dựa vào DB đang có trong RAM.
    if (tab === 'store_replenishment') {
      const warehouseStoreReplenishmentServerSource = {
        async bootstrap() {
          const jobs=[];
          if(typeof RestaurantQualityAPI!=='undefined' && RestaurantQualityAPI.bootstrap) jobs.push(RestaurantQualityAPI.bootstrap());
          if(typeof InventoryAPI!=='undefined' && InventoryAPI.bootstrap) jobs.push(InventoryAPI.bootstrap());
          await Promise.allSettled(jobs);
          return true;
        },
        async ensureFresh(_keys,{force=false}={}) {
          const jobs=[];
          if(typeof RestaurantQualityAPI!=='undefined' && RestaurantQualityAPI.ensureFresh)
            jobs.push(RestaurantQualityAPI.ensureFresh(['stores','replenishments'],{force}));
          if(typeof InventoryAPI!=='undefined' && InventoryAPI.ensureFresh)
            jobs.push(InventoryAPI.ensureFresh(['warehouseSites','materials','products','inventory','inventoryLots','warehouses','warehouseLocations'],{force}));
          const parts=await Promise.allSettled(jobs), changed={};
          for(const part of parts){
            if(part.status==='fulfilled' && part.value && typeof part.value==='object') Object.assign(changed,part.value);
          }
          return changed;
        }
      };
      return {
        api:warehouseStoreReplenishmentServerSource,
        keys:['stores','replenishments','warehouseSites','materials','products','inventory','inventoryLots','warehouses','warehouseLocations'],
        deferred:false
      };
    }

    if (tab === 'production_plan') {
      const warehouseProductionPlanServerSource = {
        async bootstrap() {
          const jobs=[];
          if(typeof ProductionAPI!=='undefined' && ProductionAPI.bootstrap) jobs.push(ProductionAPI.bootstrap());
          if(typeof CRMAPI!=='undefined' && CRMAPI.bootstrap) jobs.push(CRMAPI.bootstrap());
          if(typeof InventoryAPI!=='undefined' && InventoryAPI.bootstrap) jobs.push(InventoryAPI.bootstrap());
          await Promise.allSettled(jobs);
          return true;
        },
        async ensureFresh(_keys,{force=false}={}) {
          const jobs=[];
          if(typeof ProductionAPI!=='undefined' && ProductionAPI.ensureFresh)
            jobs.push(ProductionAPI.ensureFresh(['productionPlans','productionOrders','productionMaterialRequests'],{force}));
          if(typeof CRMAPI!=='undefined' && CRMAPI.ensureFresh)
            jobs.push(CRMAPI.ensureFresh(['orders','customers'],{force}));
          if(typeof InventoryAPI!=='undefined' && InventoryAPI.ensureFresh)
            jobs.push(InventoryAPI.ensureFresh(['products','inventory'],{force}));
          const parts=await Promise.allSettled(jobs), changed={};
          for(const part of parts){if(part.status==='fulfilled'&&part.value&&typeof part.value==='object')Object.assign(changed,part.value);}
          return changed;
        }
      };
      return {api:warehouseProductionPlanServerSource,keys:['productionPlans','productionOrders','productionMaterialRequests','orders','customers','products','inventory'],deferred:false};
    }

    if (tab === 'defects') {
      const warehouseReturnsServerSource = {
        async bootstrap() {
          const jobs=[];
          if(typeof InventoryAPI!=='undefined'&&InventoryAPI.bootstrap) jobs.push(InventoryAPI.bootstrap());
          if(typeof PurchaseAPI!=='undefined'&&PurchaseAPI.bootstrap) jobs.push(PurchaseAPI.bootstrap());
          await Promise.allSettled(jobs);
          return true;
        },
        async ensureFresh(_keys,{force=false}={}) {
          const jobs=[];
          if(typeof InventoryAPI!=='undefined'&&InventoryAPI.ensureFresh) jobs.push(InventoryAPI.ensureFresh(['inventory','inventoryLots','warehouses','warehouseLocations','materials','products','materialReturnRequests','materialReturnHistory'],{force}));
          if(typeof PurchaseAPI!=='undefined'&&PurchaseAPI.ensureFresh) jobs.push(PurchaseAPI.ensureFresh(['purchaseOrders','suppliers'],{force}));
          const parts=await Promise.allSettled(jobs), changed={};
          for(const part of parts){if(part.status==='fulfilled'&&part.value&&typeof part.value==='object')Object.assign(changed,part.value);}
          return changed;
        }
      };
      return {api:warehouseReturnsServerSource,keys:['inventory','inventoryLots','warehouses','warehouseLocations','materials','products','materialReturnRequests','materialReturnHistory','purchaseOrders','suppliers'],deferred:false};
    }

    const map = {
      dashboard: ['inventory', 'inventoryLots', 'warehouses', 'warehouseLocations', 'materials', 'semiFinishedProducts', 'products'],
      // [CROSS-DEVICE CONSISTENCY] View Tồn kho dùng warehouses để lọc theo
      // RAW/BTP/TP và dùng materials/products làm master hiển thị. Chỉ tải
      // `inventory` khiến máy mới/điện thoại (cache rỗng) luôn ra bảng trống.
      // Tải trọn bộ READ cần cho view; vẫn không kéo goodsIssues/Purchase nặng.
      inventory: ['inventory', 'inventoryLots', 'warehouses', 'warehouseLocations', 'materials', 'semiFinishedProducts', 'products', 'itemCategories', 'goodsReceipts', 'goodsIssues', 'materialReturnRequests'],
      issues: ['goodsIssues', 'warehouses', 'inventoryLots'],
      transfers: ['stockTransfers', 'warehouses', 'warehouseLocations', 'inventory', 'inventoryLots', 'products', 'materials'],
      stocktake: ['inventoryCounts', 'warehouses'],
      batches: ['inventoryLots', 'inventory', 'materials', 'semiFinishedProducts', 'products'],
      locations: ['warehouseSites', 'warehouses', 'warehouseLocations', 'inventory', 'inventoryLots', 'materials', 'products'],
      alerts: ['inventory', 'inventoryLots', 'materials', 'semiFinishedProducts', 'products'],
      stock_period: ['inventory', 'inventoryTransactions', 'warehouses', 'materials', 'semiFinishedProducts', 'products'],
      shelf_life: ['inventory', 'inventoryLots', 'materials', 'semiFinishedProducts', 'products'],
    };
    return { api: typeof InventoryAPI !== 'undefined' ? InventoryAPI : null, keys: map[tab] || map.dashboard, deferred: false };
  }

  // Chi tiết đơn hàng cần dữ liệu từ cả CRM, Kho và Sản xuất.
  // Đặc biệt goodsIssues phải có ngay để trạng thái "Xuất kho bán hàng" không
  // phụ thuộc việc người dùng đã mở Kho trước đó hay chưa.
  if (module === 'order-detail') {
    return routeMultiPlan({
      crm: ['customers','orders','crmTickets','customerPayments'],
      inventory: ['goodsIssues','products','inventory','inventoryLots','warehouses'],
      production: ['productionPlans','productionOrders']
    }, { deferred: false });
  }

  if (module === 'crm') {
    const map = {
      dashboard: ['customers', 'orders'],
      customers: ['customers', 'customerCareLogs'],
      care: ['customers', 'customerCareLogs'],
      complaints: ['customers', 'orders', 'crmTickets'],
      transactions: ['customers', 'orders', 'crmTickets', 'customerCareLogs'],
      orders: ['customers', 'orders', 'crmTickets'],
      reports: ['customers', 'orders'],
    };
    return { api: typeof CRMAPI !== 'undefined' ? CRMAPI : null, keys: map[tab] || map.dashboard };
  }


  if (module === 'logistics') {
    const logisticsServerSource = {
      async bootstrap() {
        const jobs=[];
        if(typeof CRMAPI!=='undefined' && CRMAPI.bootstrap) jobs.push(CRMAPI.bootstrap());
        if(typeof InventoryAPI!=='undefined' && InventoryAPI.bootstrap) jobs.push(InventoryAPI.bootstrap());
        await Promise.allSettled(jobs);
        if(typeof LogisticsFleet!=='undefined') LogisticsFleet.load?.();
        return true;
      },
      async ensureFresh(_keys,{force=false}={}) {
        const jobs=[];
        if(typeof CRMAPI!=='undefined' && CRMAPI.ensureFresh) jobs.push(CRMAPI.ensureFresh(['orders','customers'],{force}));
        if(typeof InventoryAPI!=='undefined' && InventoryAPI.ensureFresh) jobs.push(InventoryAPI.ensureFresh(['goodsIssues','products'],{force}));
        if(typeof LogisticsFleet!=='undefined' && LogisticsFleet.ensureFresh) jobs.push(LogisticsFleet.ensureFresh({force}));
        const parts=await Promise.allSettled(jobs), changed={};
        for(const part of parts){
          if(part.status==='fulfilled' && part.value && typeof part.value==='object') Object.assign(changed,part.value);
        }
        // Sau khi CRM + Kho + Logistics đều đã hydrate, bảo đảm mỗi đơn CRM
        // sẵn sàng xuất đã có mã GH thật. Trước khi Kho xuất: WAIT_WAREHOUSE;
        // sau khi Kho xuất: tự chuyển WAIT_DISPATCH để Logistics điều phối.
        if(typeof LogisticsFleet!=='undefined' && LogisticsFleet.reconcileSalesOrders) LogisticsFleet.reconcileSalesOrders();
        // LogisticsFleet trả boolean; CRM/Inventory trả object changed. Khi force lần
        // đầu vẫn coi route đã server-validated dù không có collection changed.
        if(force) changed.__logisticsHydrated = true;
        return changed;
      }
    };
    return {api:logisticsServerSource,keys:['orders','customers','goodsIssues','products','logistics'],deferred:true};
  }


  if (module === 'restaurant') {
    if (tab === 'replenishment') return routeMultiPlan({
      restaurant:['stores','replenishments','storeStocks'],
      inventory:['warehouseSites','materials','products','warehouses','inventory','inventoryLots']
    }, {deferred:false});
    const map = {
      dashboard: ['stores', 'orders', 'recipes'],
      pos: ['stores', 'recipes', 'orders', 'storeStocks'],
      kitchen: ['stores', 'recipes', 'orders', 'storeStocks'],
      tablet: ['stores', 'recipes', 'orders', 'storeStocks'],
      qr: ['stores', 'recipes', 'orders', 'storeStocks'],
      orders: ['stores', 'recipes', 'orders'],
      menu: ['stores', 'recipes', 'orders', 'storeStocks'],
      recipe: ['stores', 'recipes', 'orders', 'storeStocks'],
      branches: ['stores'],
      store_stock: ['stores', 'storeStocks'],
      replenishment: ['stores', 'replenishments', 'storeStocks'],
      issue: ['stores', 'storeStockTransactions'],
      revenue: ['stores', 'orders'],
      reports: ['stores', 'recipes', 'orders'],
    };
    return { api: typeof RestaurantQualityAPI !== 'undefined' ? RestaurantQualityAPI : null, keys: map[tab] || map.dashboard, deferred: true };
  }

  // BI Nhà hàng phải lấy số liệu vận hành thật từ server, không phụ thuộc
  // người dùng đã mở phân hệ Nhà hàng trước đó.
  if (module === 'bi' && tab === 'restaurant') {
    const biRestaurantServerSource = {
      async bootstrap(){
        const jobs=[];
        if(typeof RestaurantQualityAPI!=='undefined' && RestaurantQualityAPI.bootstrap) jobs.push(RestaurantQualityAPI.bootstrap());
        if(typeof InventoryAPI!=='undefined' && InventoryAPI.bootstrap) jobs.push(InventoryAPI.bootstrap());
        await Promise.allSettled(jobs); return true;
      },
      async ensureFresh(_keys,{force=false}={}){
        const jobs=[];
        if(typeof RestaurantQualityAPI!=='undefined' && RestaurantQualityAPI.ensureFresh) jobs.push(RestaurantQualityAPI.ensureFresh(['stores','orders','recipes'],{force}));
        // Giá vốn món có thể dùng cả NVL và thành phẩm nên phải hydrate master giá thật.
        if(typeof InventoryAPI!=='undefined' && InventoryAPI.ensureFresh) jobs.push(InventoryAPI.ensureFresh(['materials','products'],{force}));
        await Promise.allSettled(jobs); return true;
      }
    };
    return {api:biRestaurantServerSource,keys:['stores','orders','recipes','materials','products'],deferred:false};
  }

  // Kế toán: mọi tab dùng loader riêng phía trên, không bootstrap phân hệ khác.
  if (module === 'accounting') {
    const currentTab = tab || 'dashboard';
    const accountingTabSource = {
      async bootstrap(){ return true; },
      async ensureFresh(_keys,{force=false}={}) {
        await AccountingPrimaryData.ensureForTab(currentTab,{force});
        return {};
      }
    };
    return {api:accountingTabSource,keys:[currentTab],deferred:false};
  }

  // ==========================================================================
  // NHÂN SỰ / R&D / BI / KẾ TOÁN
  // --------------------------------------------------------------------------
  // Trước đây routeRefreshPlan KHÔNG có nhánh nào cho 4 phân hệ này (chỉ có
  // accounting/ap và accounting/banking), nên khi F5 boot() không nạp lại dữ
  // liệu từ KIO: DB.* giữ nguyên dữ liệu demo trong data.js / mod-rnd.js /
  // mod-accounting.js — trông như "quay về lúc mở index.html".
  // ==========================================================================
  if (module === 'hr') {
    return routeMultiPlan({ hr: ['employees'] });
  }

  if (module === 'rnd') {
    return routeMultiPlan({
      rnd: Object.keys(KIO_CONFIG?.rndTables || {}),
      hr: ['employees'],                      // tên người phụ trách dự án
      inventory: ['materials', 'products'],   // giá thành công thức
    });
  }


  if (module === 'bi') {
    // BI chỉ đọc: mỗi tab nạp đúng các collection mà hàm tính số liệu của tab đó dùng.
    const specByTab = {
      finance: { crm: ['customers', 'orders', 'customerPayments'], purchase: ['purchaseOrders', 'supplierPayments', 'suppliers'] },
      warehouse: { inventory: ['inventory', 'materials', 'semiFinishedProducts', 'products'] },
      production: { production: ['productionOrders'], inventory: ['products', 'materials'] },
      sales: { crm: ['customers', 'orders'], inventory: ['products'] },
      restaurant: { restaurant: ['stores', 'recipes', 'orders'], inventory: ['materials'], hr: ['employees'] },
      hr: { hr: ['employees'] },
    };
    const spec = specByTab[tab];
    return spec ? routeMultiPlan(spec) : null;
  }

  if (module === 'quality') {
    if (!tab || tab === 'dashboard') {
      const parts=[
        {api:PurchaseAPI,keys:['goodsReceipts','purchaseOrders','suppliers']},
        {api:InventoryAPI,keys:['materials','products','materialReturnRequests']},
        {api:ProductionAPI,keys:['productionOrders','productionFinalInspections']},
        {api:RestaurantQualityAPI,keys:['coa','capa','recalls']}
      ];
      const source=routeMultiSource(parts,{after:changed=>{subcontractHydrate();qualityDashboardMarkLoaded(changed);}});
      return {api:{bootstrap:()=>source.bootstrap(),ensureFresh:(keys,options={})=>source.ensureFresh(keys,{force:true})},keys:parts.flatMap(p=>p.keys),deferred:false};
    }

    // IQC dùng dữ liệu phiếu nhập kho thật. Khi đăng nhập thẳng bằng QC,
    // phải chủ động nạp goodsReceipts thay vì chờ user mở phân hệ Kho trước.
    if (tab === 'pqc') {
      // QC bán thành phẩm lấy trực tiếp các checkpoint PROCESS_QC trong LSX.
      // Chỉ cần bảng lenam_production_orders; kết quả kiểm tra được lưu ngay
      // vào stage.processQc / stage.processQcHistory của chính LSX trên server.
      return {
        api: typeof ProductionAPI !== 'undefined' ? ProductionAPI : null,
        keys: ['productionOrders'],
        deferred: true
      };
    }

    if (tab === 'oqc') {
      return { api: typeof InventoryAPI !== 'undefined' ? InventoryAPI : null, keys: ['goodsIssues','inventory','inventoryLots','warehouses','warehouseLocations'], deferred: false };
    }

    if (tab === 'fqc') {
      // [FQC PERFORMANCE] Màn danh sách chỉ cần dữ liệu Production/FQC.
      // Không tải Kho/Lô/Vị trí ngay khi mở trang; các master này chỉ được
      // lazy-load khi người dùng mở một phiếu FQC cụ thể.
      return {
        api: typeof ProductionAPI !== 'undefined' ? ProductionAPI : null,
        keys: ['productionOrders','productionFinalInspections'],
        deferred: false
      };
    }

    if (tab === 'iqc') {
      const iqcServerSource = {
        async bootstrap() {
          const jobs=[];
          if(typeof PurchaseAPI!=='undefined' && PurchaseAPI.bootstrap) jobs.push(PurchaseAPI.bootstrap());
          if(typeof InventoryAPI!=='undefined' && InventoryAPI.bootstrap) jobs.push(InventoryAPI.bootstrap());
          await Promise.all(jobs);
          return true;
        },
        async ensureFresh(_keys,{force=false}={}) {
          const jobs=[];
          if(typeof PurchaseAPI!=='undefined' && PurchaseAPI.ensureFresh) jobs.push(PurchaseAPI.ensureFresh(['goodsReceipts','purchaseOrders','suppliers'],{force}));
          // Danh sách IQC chỉ cần master NVL để hiện tên hàng. Tồn/lô/kho sẽ
          // lazy-load khi mở chi tiết, tránh 6-9 list.php chỉ để vào danh sách.
          if(typeof InventoryAPI!=='undefined' && InventoryAPI.ensureFresh) jobs.push(InventoryAPI.ensureFresh(['materials'],{force}));
          const parts=await Promise.all(jobs);
          return Object.assign({},...parts);
        }
      };
      return {
        api: iqcServerSource,
        keys: ['goodsReceipts','purchaseOrders','suppliers','materials'],
        deferred: false
      };
    }
    const map = { coa: ['coa'], capa: ['capa'], recall: ['recalls'] };
    const keys = map[tab] || [];
    return keys.length ? { api: typeof RestaurantQualityAPI !== 'undefined' ? RestaurantQualityAPI : null, keys, deferred: true } : null;
  }

  if (module === 'production') {
    // BOM/Định mức phải dùng đúng master Thành phẩm + Nguyên liệu đang có trên KIO.
    // Nếu chỉ bootstrap ProductionAPI, màn BOM giữ DB.products/DB.materials seed cũ
    // nên TP-0001, NLC-..., CDT-... có trong Kho nhưng không xuất hiện ở dropdown.
    if (tab === 'bom') {
      const productionBomServerSource = {
        async bootstrap() {
          const jobs = [];
          if (typeof ProductionAPI !== 'undefined' && ProductionAPI.bootstrap) jobs.push(ProductionAPI.bootstrap());
          if (typeof InventoryAPI !== 'undefined' && InventoryAPI.bootstrap) jobs.push(InventoryAPI.bootstrap());
          await Promise.all(jobs);
          return true;
        },
        async ensureFresh(_keys, { force = false } = {}) {
          const jobs = [];
          if (typeof ProductionAPI !== 'undefined' && ProductionAPI.ensureFresh) {
            jobs.push(ProductionAPI.ensureFresh(['productionOrders'], { force }));
          }
          if (typeof InventoryAPI !== 'undefined' && InventoryAPI.ensureFresh) {
            jobs.push(InventoryAPI.ensureFresh(['products','materials','itemCategories'], { force }));
          }
          const parts = await Promise.all(jobs);
          return Object.assign({}, ...parts);
        }
      };
      return {
        api: productionBomServerSource,
        keys: ['productionOrders','products','materials','itemCategories'],
        deferred: false,
      };
    }

    // [PRODUCTION DASHBOARD PERFORMANCE] Tổng quan/Lệnh SX chỉ dùng LSX.
    // Không tải KHSX + YCNVL chỉ để dựng KPI và bảng lệnh. Các tab nghiệp vụ
    // khác vẫn giữ đúng collection riêng của chúng.
    const productionKeys = {
      dashboard: ['productionOrders'],
      orders: ['productionOrders'],
      progress: ['productionOrders'],
      plan: ['productionOrders', 'productionPlans', 'productionMaterialRequests'],
    };
    return {
      api: typeof ProductionAPI !== 'undefined' ? ProductionAPI : null,
      keys: productionKeys[tab || 'dashboard'] || ['productionOrders'],
      deferred: true,
    };
  }

  if (module === 'production-detail') {
    // Chi tiết LSX phải biết cả FQC và phiếu nhập kho thành phẩm để không hiển thị
    // trạng thái cũ "Đang QC" sau khi QC/Kho đã hoàn tất ở role khác.
    const productionDetailSource = {
      async bootstrap() {
        const jobs = [];
        if (typeof ProductionAPI !== 'undefined' && ProductionAPI.bootstrap) jobs.push(ProductionAPI.bootstrap());
        if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.bootstrap) jobs.push(PurchaseAPI.bootstrap());
        await Promise.all(jobs);
        return true;
      },
      async ensureFresh(_keys, {force=false}={}) {
        const jobs = [];
        if (typeof ProductionAPI !== 'undefined' && ProductionAPI.ensureFresh) {
          jobs.push(ProductionAPI.ensureFresh(['productionOrders','productionMaterialRequests','productionFinalInspections'], {force}));
        }
        if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.ensureFresh) {
          jobs.push(PurchaseAPI.ensureFresh(['goodsReceipts'], {force}));
        }
        const parts = await Promise.all(jobs);
        return Object.assign({}, ...parts);
      }
    };
    return {
      api: productionDetailSource,
      keys: ['productionOrders','productionMaterialRequests','productionFinalInspections','goodsReceipts'],
      deferred: true,
    };
  }

  if (module === 'progress') {
    return {
      api: typeof ProductionAPI !== 'undefined' ? ProductionAPI : null,
      keys: ['productionOrders'],
      deferred: true,
    };
  }

  return null;
}


/* ============================================================================
 * GLOBAL DATA WARMUP
 * ----------------------------------------------------------------------------
 * Sau khi khung app render, hydrate cache của tất cả API ngay và warm dữ liệu
 * server theo 2 tầng. Nhờ vậy người dùng chuyển menu không phải "mồi" dữ liệu
 * bằng cách mở một màn khác trước. KIO vẫn là nguồn dữ liệu chuẩn; localStorage
 * chỉ giữ snapshot server gần nhất để F5/render tức thì.
 * ========================================================================== */
window.ERPDataWarmup = (() => {
  let started = false;
  let promise = null;

  const purchaseKeys = () => Object.keys(KIO_CONFIG?.purchaseTables || {});
  const inventoryKeys = () => Object.keys(KIO_CONFIG?.inventoryTables || {});
  const crmKeys = () => Object.keys(KIO_CONFIG?.crmTables || {});
  const restaurantKeys = ['stores','recipes','orders','replenishments','storeStocks','storeStockTransactions','bankAccounts','cashTransactions','bankTransactions','fixedAssets'];
  const qualityKeys = ['coa','capa','recalls'];

  async function hydrateCaches() {
    const jobs = [];
    for (const api of [
      typeof PurchaseAPI !== 'undefined' ? PurchaseAPI : null,
      typeof InventoryAPI !== 'undefined' ? InventoryAPI : null,
      typeof CRMAPI !== 'undefined' ? CRMAPI : null,
      typeof ProductionAPI !== 'undefined' ? ProductionAPI : null,
      typeof RestaurantQualityAPI !== 'undefined' ? RestaurantQualityAPI : null,
      typeof HRAPI !== 'undefined' ? HRAPI : null,
      typeof RNDApi !== 'undefined' ? RNDApi : null,
    ].filter(Boolean)) {
      if (typeof api.bootstrap === 'function') jobs.push(Promise.resolve().then(() => api.bootstrap()));
    }
    await Promise.allSettled(jobs);
  }

  async function warmCritical() {
    // Các collection dùng xuyên suốt nhiều màn và badge/dashboard được ưu tiên trước.
    const jobs = [];
    if (typeof PurchaseAPI !== 'undefined') jobs.push(PurchaseAPI.ensureFresh(['purchases','purchaseOrders','supplierPayments','suppliers']).then(r=>{ window.SidebarBadges?.markReady?.('purchases'); return r; }));
    if (typeof ProductionAPI !== 'undefined') jobs.push(ProductionAPI.ensureFresh(null).then(r=>{ window.SidebarBadges?.markReady?.('production'); return r; }));
    if (typeof InventoryAPI !== 'undefined') jobs.push(InventoryAPI.ensureFresh(['warehouses','materials','products','inventory','inventoryLots']));
    if (typeof CRMAPI !== 'undefined') jobs.push(CRMAPI.ensureFresh(['customers','orders','customerPayments']));
    if (typeof RestaurantQualityAPI !== 'undefined') jobs.push(RestaurantQualityAPI.ensureFresh(['stores','recipes','orders','storeStocks','bankAccounts','cashTransactions','bankTransactions','fixedAssets']));
    await Promise.allSettled(jobs);
    if (typeof renderNav === 'function') renderNav();
    // Dashboard đang mở thì cập nhật số thật sau khi critical warm xong.
    if (State.module === 'dashboard' && typeof render === 'function') render();
  }

  async function warmRemaining() {
    const jobs = [];
    if (typeof PurchaseAPI !== 'undefined') jobs.push(PurchaseAPI.ensureFresh(purchaseKeys()));
    if (typeof InventoryAPI !== 'undefined') jobs.push(InventoryAPI.ensureFresh(inventoryKeys()));
    if (typeof CRMAPI !== 'undefined') jobs.push(CRMAPI.ensureFresh(crmKeys()));
    if (typeof RestaurantQualityAPI !== 'undefined') {
      jobs.push(RestaurantQualityAPI.ensureFresh(restaurantKeys));
      jobs.push(RestaurantQualityAPI.ensureFresh(qualityKeys));
    }
    if (typeof HRAPI !== 'undefined') jobs.push(HRAPI.ensureFresh(['employees']));
    if (typeof RNDApi !== 'undefined') jobs.push(RNDApi.ensureFresh(Object.keys(KIO_CONFIG?.rndTables || {})));
    await Promise.allSettled(jobs);
    // Chỉ từ thời điểm này badge mới được phép hiện. Như vậy sidebar không
    // bao giờ lóe số từ local cache (ví dụ 2) rồi vài chục ms sau đổi sang số server.
    window.SidebarBadges?.markReady?.('all');
    if (typeof renderNav === 'function') renderNav();
    try { localStorage.setItem(KIO_CONFIG?.storageKeys?.globalWarmupStamp || 'lenam:kio:global-warmup:v1', String(Date.now())); } catch (_) {}
    console.info('[DataWarmup] Dữ liệu ERP đã được warm từ server; badge đã sẵn sàng.');
  }
  function start() {
    if (started) return promise || Promise.resolve(true);
    started = true;
    promise = (async () => {
      await hydrateCaches();              // gần như tức thì: chỉ local snapshot
      await warmCritical();               // ưu tiên dữ liệu dùng nhiều
      // Nhường một frame để UI luôn phản hồi trước khi warm các bảng ít dùng.
      await new Promise(r => setTimeout(r, 80));
      await warmRemaining();
      return true;
    })().catch(err => {
      console.warn('[DataWarmup] Warm dữ liệu nền chưa hoàn tất:', err);
      return false;
    });
    return promise;
  }

  return { start, hydrateCaches, warmCritical, warmRemaining };
})();

async function reconcileCorruptedPurchaseRequestStatuses() {
  if (!Array.isArray(DB.purchases) || !Array.isArray(DB.purchaseOrders)) return false;
  let changed = false;
  for (const pr of DB.purchases) {
    if (!PURCHASE_INVENTORY_CONFIG?.prStatus?.pending?.includes(pr.status)) continue;
    const linked = DB.purchaseOrders.filter(po => po.prId === pr.id && po.status !== 'CANCELLED');
    if (!linked.length) continue;

    const statuses = linked.map(po => String(po.status || ''));
    let restored = 'mh_da_dat_hang';
    if (statuses.length && statuses.every(st => st === 'RECEIVED')) restored = 'mh_hoan_thanh';
    else if (statuses.some(st => st === 'PARTIAL_RECEIVED' || st === 'RECEIVED')) restored = 'mh_da_nhan';
    else if (statuses.some(st => st === 'SHIPPING')) restored = 'mh_dang_giao';

    console.warn(`[Purchase] Khôi phục workflow PR ${pr.id}: ${pr.status} -> ${restored} vì đã có PO downstream.`);
    pr.status = restored;
    pr.workflowRestoredAt = new Date().toISOString();
    pr.workflowRestoredReason = 'PR bị ghi lùi trạng thái trong khi đã có PO liên kết';
    changed = true;
  }
  if (changed && typeof PurchaseAPI !== 'undefined' && PurchaseAPI.syncCollections) {
    await PurchaseAPI.syncCollections(['purchases']);
  }
  return changed;
}

/* ============================================================================
 * APPROVAL PRIMARY DATA - SERVER FIRST
 * ----------------------------------------------------------------------------
 * Badge + màn "Việc cần duyệt" phải đúng ngay sau login/F5. Không render từ
 * DB rỗng rồi chờ refresh nền, vì như vậy Trưởng phòng Mua hàng phải click lại
 * menu mới thấy dữ liệu. Nguồn chuẩn vẫn là KIO; cache chỉ là snapshot phụ.
 * ========================================================================== */
window.ApprovalPrimaryData = (() => {
  let refreshPromise = null;

  async function refresh({ force = true } = {}) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const jobs = [];
      if (typeof ApprovalsAPI !== 'undefined') {
        if (typeof ApprovalsAPI.bootstrap === 'function') await ApprovalsAPI.bootstrap();
        if (typeof ApprovalsAPI.ensureFresh === 'function') jobs.push(ApprovalsAPI.ensureFresh(['requests','logs'], { force }));
      }
      if (typeof PurchaseAPI !== 'undefined') {
        if (typeof PurchaseAPI.bootstrap === 'function') await PurchaseAPI.bootstrap();
        if (typeof PurchaseAPI.ensureFresh === 'function') jobs.push(PurchaseAPI.ensureFresh(['purchases'], { force }));
      }
      if (typeof CRMAPI !== 'undefined') {
        if (typeof CRMAPI.bootstrap === 'function') await CRMAPI.bootstrap();
        if (typeof CRMAPI.ensureFresh === 'function') jobs.push(CRMAPI.ensureFresh(['orders'], { force }));
      }
      await Promise.allSettled(jobs);
      if (typeof approvalReconcilePendingPrs === 'function') {
        await approvalReconcilePendingPrs({ persist: true });
      }
      if (typeof approvalReconcilePendingSalesOrders === 'function') {
        await approvalReconcilePendingSalesOrders({ persist: true });
      }
      // Badge Mua hàng và Phê duyệt đều phụ thuộc PR/request vừa hydrate.
      window.SidebarBadges?.markReady?.('purchases');
      if (typeof renderNav === 'function') renderNav();
      return true;
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  return { refresh };
})();

function scheduleRouteDataRefresh(module = State.module, tab = State.tab) {
  clearTimeout(__routeRefreshTimer);
  const plan = routeRefreshPlan(module, tab);
  if (!plan?.api?.ensureFresh || !plan.keys?.length) return;

  const routeKey = `${module}/${tab || ''}`;

  // Đơn hàng bán cần tồn Kho thành phẩm dù user chưa từng mở phân hệ Kho.
  // Prefetch nền có Promise dedupe; không làm chậm render trang.
  if (module === 'crm' && tab === 'orders' && typeof prefetchSalesOrderFormData === 'function') {
    setTimeout(() => prefetchSalesOrderFormData(), 120);
  }

  __routeRefreshTimer = setTimeout(async () => {
    try {
      // Nếu user đang nhập liệu/mở modal thì chưa chen request KIO vào queue.
      const activeBefore = document.activeElement;
      const busyBefore = (activeBefore && ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeBefore.tagName)) ||
        (typeof Modal !== 'undefined' && Modal.isOpen?.()) ||
        (typeof Drawer !== 'undefined' && Drawer.isOpen?.());
      if (busyBefore) {
        scheduleRouteDataRefresh(module, tab);
        return;
      }

      // Lazy bootstrap: chỉ khởi tạo API của đúng màn hình người dùng đang mở.
      // Không bootstrap Purchase/Inventory/CRM/Production đồng loạt khi F5.
      if (typeof plan.api.bootstrap === 'function') await plan.api.bootstrap();
      // Tồn kho là dữ liệu biến động liên thiết bị. Không dùng TTL 2 phút ở route này:
      // mỗi lần route refresh phải hỏi KIO thật để tab đang mở không giữ snapshot cũ.
      // CRM của role Kinh doanh có thể vừa được warm riêng cho badge ngay sau login.
      // Trong cửa sổ ngắn này không force lại cùng collection lần thứ hai; ensureFresh
      // sẽ chỉ lấy những key màn hình còn thiếu (ví dụ customers của dashboard).
      const crmBadgeWarmRecent = module === 'crm' && (Date.now() - Number(window.__crmRoleBadgeWarmAt || 0) < 2500);
      const forceRouteRefresh = (module === 'warehouse' && tab === 'inventory') || (module === 'crm' && !crmBadgeWarmRecent);
      const changed = await plan.api.ensureFresh(plan.keys, { force: forceRouteRefresh });
      let repairedPurchaseWorkflow = false;
      if (module === 'purchases' && tab === 'pr') {
        repairedPurchaseWorkflow = await reconcileCorruptedPurchaseRequestStatuses();
      }

      // Khi user mở đúng phân hệ, dữ liệu badge đã được server-validated.
      if (module === 'purchases' && plan.keys.includes('purchases')) window.SidebarBadges?.markReady?.('purchases');
      if ((module === 'production' || module === 'production-detail' || module === 'progress') && plan.keys.includes('productionOrders')) window.SidebarBadges?.markReady?.('production');

      if ((!changed || !Object.keys(changed).length) && !repairedPurchaseWorkflow) {
        if (typeof renderNav === 'function') renderNav();
        return;
      }

      // Chỉ render lại nếu user vẫn đang ở đúng màn hình và không nhập liệu/
      // mở modal. Tránh hiện tượng bảng "nhảy" trong lúc user đang thao tác.
      const stillHere = `${State.module}/${State.tab || ''}` === routeKey;
      const active = document.activeElement;
      const editing = active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
      const modalOpen = typeof Modal !== 'undefined' && Modal.isOpen?.();
      const drawerOpen = typeof Drawer !== 'undefined' && Drawer.isOpen?.();
      if (stillHere && !editing && !modalOpen && !drawerOpen && typeof render === 'function') {
        render();
      }
    } catch (err) {
      console.warn('[DataRefresh] Refresh nền thất bại; giữ cache hiện tại:', err);
    }
  }, plan.deferred ? 20 : 80);
}

async function boot() {
  // [REAL DATE] Từ bản này, mọi chứng từ/nghiệp vụ mới dùng ngày thực tế của máy.
  // Dữ liệu lịch sử giữ nguyên ngày đã lưu; chỉ DB.today runtime được cập nhật.
  DB.today = currentDateYMD();
  // Khôi phục theme đã chọn (nếu trình duyệt cho phép lưu)
  let saved = 'light';
  try { saved = localStorage.getItem('vyko-theme') || 'light'; } catch (e) { /* bỏ qua */ }
  setTheme(saved);

  // Ánh xạ URL hash alias với module ID thực tế
  const hashAliases = {
    'input-prices': 'pricebook',
    'categories': 'catalogs',
    'production-plan': 'production',
    'production-orders': 'production',
    'production-progress': 'progress',
    'processes': 'operations',
    'purchasing': 'purchases',
    'employees': 'hr',
    'production-reports': 'rp-product',
    'revenue-reports': 'rp-revenue',
    'material-reports': 'rp-material',
    'users-permissions': 'users'
  };
  const getRouteFromHash = () => {
  const raw = (location.hash || '').replace('#', '').trim();

  if (!raw) {
    return {
      module: null,
      tab: null
    };
  }

  const [moduleRaw, tab] = raw.split('/');
  const module = hashAliases[moduleRaw] || moduleRaw;

  // Chi tiết LSX phải giữ mã lệnh trong URL để F5 có thể khôi phục đúng record
  // rồi hydrate productionOrders từ server. Không dùng RAM của màn danh sách làm nguồn.
  if (module === 'production-detail') {
    return { module, tab: null, id: tab ? decodeURIComponent(tab) : null };
  }

  return { module, tab: tab || null, id: null };
};

const initialRoute = getRouteFromHash();

if (
  initialRoute.module &&
  (Views[initialRoute.module] || META[initialRoute.module])
) {
  State.module = initialRoute.module;
  State.params = initialRoute.module === 'production-detail'
    ? (initialRoute.id ? { id: initialRoute.id } : {})
    : (initialRoute.tab ? { tab: initialRoute.tab } : {});
  State.tab = initialRoute.tab;
}

  // AUTH phải được nạp trước nghiệp vụ để mọi action đều biết chính xác actor đang đăng nhập.
  let freshLogin = false;
  if (typeof SystemAPI !== 'undefined') {
    await SystemAPI.bootstrap();
    if (!SystemAPI.restoreSession()) {
      await SystemAPI.showLogin();
      freshLogin = true;
    }
  }

  // Mỗi lần đăng nhập MỚI phải bắt đầu tại màn mặc định của đúng role hiện tại,
  // tuyệt đối không kế thừa module/tab/hash của tài khoản vừa đăng xuất.
  if (typeof Auth !== 'undefined' && freshLogin) {
    const first = Auth.firstRoute();
    State.module = first.module;
    State.tab = first.tab;
    State.params = first.tab ? {tab:first.tab} : {};
    const nextHash = `#${first.module}${first.tab ? `/${first.tab}` : ''}`;
    try { history.replaceState(null, '', location.pathname + location.search + nextHash); } catch (_) {}
  } else if (typeof Auth !== 'undefined' && !Auth.canAccess(State.module, State.tab)) {
    const first = Auth.firstRoute(); State.module = first.module; State.tab = first.tab; State.params = first.tab ? {tab:first.tab} : {};
  }

  // [APPROVAL SERVER-FIRST LOGIN/F5]
  // Với các role có quyền vào Phê duyệt (đặc biệt Trưởng phòng Mua hàng), badge
  // và danh sách chờ duyệt phải đúng ngay ở first paint. Trước đây boot render
  // DB.approvalRequests rỗng rồi mới refresh nền, nên F5 làm mất badge/danh sách.
  if (typeof Auth !== 'undefined' && Auth.canAccess('approvals', 'pending')) {
    try {
      await window.ApprovalPrimaryData?.refresh?.({ force: true });
    } catch (err) {
      console.warn('[Approvals] Không hydrate được dữ liệu duyệt trước first paint:', err);
    }
  }

  // FAST FIRST PAINT: sau login/F5 không chờ bất kỳ LIST/KRUD nghiệp vụ nào
  // trước khi render. Route hiện tại render từ snapshot/cache đang có; dữ liệu server
  // được refresh NGAY SAU khi UI đã hiện. Điều này chỉ đổi thời điểm tải, không đổi
  // CRUD/logic/trạng thái hay nguồn dữ liệu chuẩn KIO.
  try {
    const initialPlan = routeRefreshPlan(State.module, State.tab);
    if (initialPlan?.api && typeof initialPlan.api.bootstrap === 'function') {
      // bootstrap các API hiện đã là cache-first; không force server ở critical path.
      // Không await để một pending replay/migration cũ không thể giữ màn Login.
      Promise.resolve().then(() => initialPlan.api.bootstrap()).catch(err =>
        console.warn('[DataInit] Bootstrap nền route đầu tiên thất bại:', err));
    }
  } catch (err) {
    console.warn('[DataInit] Không khởi tạo được cache route đầu tiên:', err);
  }

  // Nếu người dùng mở trực tiếp IQC/FQC qua URL/F5 thì initial route vừa được
  // force hydrate từ server ở trên; đánh dấu sẵn để không warm/list lại lần nữa.
  if (State.module === 'quality' && (State.tab === 'iqc' || State.tab === 'fqc')) {
    QualityPrimaryData.markReady();
  }
  // [CRM FIRST PAINT = KIO SERVER]
  // Không render CUSTOMER_ROWS/data.js cũ (ví dụ 25 KH) rồi vài ms sau mới nhảy
  // lên số server thật (ví dụ 26). Khi F5/deep-link vào CRM, hydrate collection
  // của đúng tab từ KIO trước first paint. Không dùng localStorage CRM.
  if (State.module === 'hr') {
    // Không render dữ liệu nhân sự demo/cache trước rồi nhảy số sau vài giây.
    // Route Nhân sự phải hydrate server trước first paint.
    try { await HRAPI?.bootstrap?.(); await HRAPI?.ensureFresh?.(['employees'], { force:true }); }
    catch (err) { console.warn('[HR] Không hydrate được nhân sự KIO trước first paint:', err); }
  }

  if (State.module === 'crm') {
    try {
      const crmInitialMap = {
        dashboard: ['customers','orders'],
        customers: ['customers','customerCareLogs'],
        care: ['customers','customerCareLogs'],
        complaints: ['customers','orders','crmTickets'],
        transactions: ['customers','orders','crmTickets','customerCareLogs'],
        orders: ['customers','orders','crmTickets'],
        reports: ['customers','orders']
      };
      const crmKeys = crmInitialMap[State.tab || 'dashboard'] || crmInitialMap.dashboard;
      await CRMAPI?.bootstrap?.();
      await CRMAPI?.ensureFresh?.(crmKeys, { force: true });
    } catch (err) {
      console.warn('[CRM] Không hydrate được dữ liệu KIO trước first paint:', err);
    }
  }

  if (State.module === 'warehouse' && (State.tab === 'dashboard' || !State.tab)) {
    // Role Kho đăng nhập mặc định vào Tổng quan. Máy/điện thoại mới không có
    // snapshot local nên first paint cũng phải hydrate server trước khi hiện app.
    try {
      await InventoryAPI?.bootstrap?.();
      await InventoryAPI?.ensureFresh?.(
        ['inventory','inventoryLots','warehouses','warehouseLocations','materials','semiFinishedProducts','products'],
        { force:true }
      );
    } catch (err) {
      console.warn('[Warehouse] Không hydrate được Tổng quan Kho trước first paint:', err);
    }
  }

  if (State.module === 'warehouse' && State.tab === 'inventory') {
    // [FIRST PAINT = SERVER DATA] Nếu F5/deep-link thẳng vào Tồn kho, phải đợi
    // KIO hydrate đủ balance + master trước khi render lần đầu. Không markReady
    // giả khi dữ liệu chưa tải xong; điều đó từng làm điện thoại cache sạch bị trống.
    try {
      if (DB.currentUser?.roleId === 'ROLE_SUBCONTRACT') await SubcontractInventoryPrimaryData.ensure();
      else await WarehouseInventoryPrimaryData.ensure();
    } catch (err) {
      console.warn('[Warehouse] Không hydrate được Tồn kho trước first paint:', err);
    }
  }
  if (State.module === 'warehouse' && State.tab === 'production_plan') {
    WarehouseProductionPlanPrimaryData.markReady();
  }
  if (State.module === 'accounting' && State.tab === 'banking') {
    AccountingPrimaryData.markReady('banking');
    if (typeof AccountingBank !== 'undefined') AccountingBank.hydrate();
  }

  if (State.module === 'logistics') {
    LogisticsPrimaryData.markReady();
  }

  updateAuthUserUI();
  bindTopbar();
  updateBell();
  render();
  // Chỉ hiện app sau khi route đầu tiên đã render xong: không còn flash shell trắng.
  document.querySelector('.app')?.classList.remove('hidden');
  document.getElementById('startupMask')?.remove();

  // [BADGE READY FIX]
  // Bản role-badge trước chặn mọi badge cho tới khi SidebarBadges.ready.all=true,
  // nhưng ERPDataWarmup chưa bao giờ được start nên badge luôn bằng 0.
  // Warm toàn bộ collection cần cho badge ở nền sau first paint, sau đó mới cho
  // sidebar hiện số server thật. Như vậy không lóe số cache cũ và cũng không mất badge.
  setTimeout(async () => {
    try {
      const roleId = String(DB.currentUser?.roleId || Auth.currentRole?.()?.id || '');

      // PERFORMANCE: Kinh doanh chỉ có badge nghiệp vụ CRM + Phê duyệt.
      // Không warm Purchase/Kho/Sản xuất/Nhà hàng... chỉ để hiện 1 badge.
      // Trước đây badge đợi ERPDataWarmup.warmRemaining() hoàn tất toàn hệ thống,
      // gây hàng chục/100+ request list.php và badge xuất hiện rất muộn.
      if (roleId === 'ROLE_SALES_MANAGER' || roleId === 'ROLE_SALES') {
        const jobs = [];
        if (typeof CRMAPI !== 'undefined') {
          await CRMAPI.bootstrap?.();
          jobs.push(CRMAPI.ensureFresh?.(['orders'], { force:true }));
        }
        if (roleId === 'ROLE_SALES_MANAGER' && typeof ApprovalsAPI !== 'undefined') {
          await ApprovalsAPI.bootstrap?.();
          jobs.push(ApprovalsAPI.ensureFresh?.(['requests'], { force:true }));
        }
        await Promise.allSettled(jobs.filter(Boolean));

        // Đơn bán cũ đang Chờ duyệt nhưng chưa có request sẽ được bổ sung đúng luồng.
        if (roleId === 'ROLE_SALES_MANAGER' && typeof approvalReconcilePendingSalesOrders === 'function') {
          await approvalReconcilePendingSalesOrders({ persist:true });
        }

        window.__crmRoleBadgeWarmAt = Date.now();
        window.SidebarBadges?.markReady?.('all');
        if (typeof renderNav === 'function') renderNav();
        console.info('[WorkBadges] Đã warm badge theo role Kinh doanh: CRM orders + approvals only.');
        return;
      }

      // Badge phải dựa trên dữ liệu SERVER của chính các collection tạo việc cần xử lý.
      // Không đánh dấu ready từ cache/global warmup vì sẽ gây hiện số cũ rồi nhảy lại.
      const jobs = [];
      if (typeof PurchaseAPI !== 'undefined') jobs.push(PurchaseAPI.ensureFresh?.(['purchases','supplierQuotations','purchaseOrders','goodsReceipts','supplierPayments','supplierRefunds'], {force:true}));
      if (typeof InventoryAPI !== 'undefined') jobs.push(InventoryAPI.ensureFresh?.(['goodsIssues','stockTransfers','inventoryCounts','materialReturnRequests','inventoryLots','inventory'], {force:true}));
      if (typeof ProductionAPI !== 'undefined') jobs.push(ProductionAPI.ensureFresh?.(['productionPlans','productionOrders','productionMaterialRequests','productionFinalInspections'], {force:true}));
      if (typeof CRMAPI !== 'undefined') jobs.push(CRMAPI.ensureFresh?.(['orders','crmTickets','customerPayments'], {force:true}));
      if (typeof RestaurantQualityAPI !== 'undefined') jobs.push(RestaurantQualityAPI.ensureFresh?.(['orders','replenishments','coa','capa','recalls'], {force:true}));
      if (typeof ApprovalsAPI !== 'undefined') jobs.push(ApprovalsAPI.ensureFresh?.(['requests'], {force:true}));
      if (typeof RNDApi !== 'undefined') jobs.push(RNDApi.ensureFresh?.(['rndApprovals'], {force:true}));
      if (typeof LogisticsFleet !== 'undefined' && typeof LogisticsFleet.ensureFresh === 'function') jobs.push(LogisticsFleet.ensureFresh({force:true}));
      await Promise.allSettled(jobs.filter(Boolean));
      window.SidebarBadges?.markReady?.('all');
      if (typeof renderNav === 'function') renderNav();
      console.info('[WorkBadges] Badge server-ready; sidebar đã render lại.');
    } catch (err) {
      console.warn('[WorkBadges] Không hydrate đủ badge công việc:', err);
      window.SidebarBadges?.markReady?.('all');
      if (typeof renderNav === 'function') renderNav();
    }
  }, 20);

  // Login QC thường vào Tổng quan. Warm IQC + FQC ngay sau render ở nền để khi
  // người dùng click vào danh sách thì dữ liệu đã sẵn sàng và hiện đúng ngay.
  if (State.module === 'quality' && State.tab === 'dashboard') {
    QualityPrimaryData.prewarm().catch(err => console.warn('[QC] Warm dữ liệu nền thất bại:', err));
  }
  // PERFORMANCE: không prewarm Tồn kho/KHSX khi đang ở Tổng quan Kho.
  // Người dùng mở tab nào thì route đó mới tải đúng collection cần thiết.
  if (State.module === 'subcontracting' && (State.tab === 'dashboard' || !State.tab) && DB.currentUser?.roleId === 'ROLE_SUBCONTRACT') {
    SubcontractInventoryPrimaryData.prewarm().catch(err => console.warn('[Subcontracting] Warm Tồn kho read-only nền thất bại:', err));
  }
  if (State.module === 'accounting' && State.tab === 'dashboard') {
    // Không prewarm toàn bộ Kế toán: tab nào mở thì tab đó mới tải dữ liệu server.
    AccountingPrimaryData.prewarm('dashboard').catch(err => console.warn('[Accounting] Warm Tổng quan thất bại:', err));
  }

  if (State.module === 'logistics' && (State.tab === 'dashboard' || !State.tab)) {
    LogisticsPrimaryData.prewarm().catch(err => console.warn('[Logistics] Warm dữ liệu giao hàng nền thất bại:', err));
  }

  // Dashboard tự refresh đúng các collection KPI ở nền. Các route khác vẫn
  // refresh theo màn hình đang mở như cũ.
  if (State.module === 'dashboard') {
    // Dashboard hiện ngay từ snapshot; server refresh sau first paint, không chặn login.
    setTimeout(() => window.DashboardDataSync?.refresh?.({ force:true }), 250);
  } else scheduleRouteDataRefresh(State.module, State.tab);

  window.addEventListener('hashchange', async () => {
  const route = getRouteFromHash();

  if (
    route.module &&
    (Views[route.module] || META[route.module])
  ) {
    if (!Auth.canAccess(route.module, route.tab)) { const first=Auth.firstRoute(); go(first.module,{tab:first.tab}); return; }
    const previousModule = State.module;
    State.module = route.module;
    State.params = route.tab
      ? { tab: route.tab }
      : {};
    State.tab = route.tab;

    if (State.module === 'dashboard') {
      window.DashboardDataSync?.hydrate?.().then(() => {
        if (State.module === 'dashboard') render();
        return window.DashboardDataSync?.refresh?.({ force:true });
      });
    } else {
      // [APPROVAL SERVER-FIRST NAVIGATION]
      // Khi click Phê duyệt/Việc cần duyệt, chờ dữ liệu thật xong rồi mới render.
      // Không cho phép first render dùng DB rỗng/cũ rồi vài trăm ms sau mới đổi.
      if (State.module === 'approvals') {
        try { await window.ApprovalPrimaryData?.refresh?.({ force: true }); }
        catch (err) { console.warn('[Approvals] Refresh khi đổi route thất bại:', err); }
      }

      // [WAREHOUSE SERVER-FIRST NAVIGATION]
      // hashchange trước đây render ngay DB rỗng/cũ rồi mới refresh nền. Vì vậy máy
      // sạch cache thấy 0 nguyên liệu; đổi tab browser mới vô tình kích hoạt render lại.
      // Với Tồn kho, chờ KIO hydrate xong rồi mới first-render route.
      if (State.module === 'warehouse' && State.tab === 'inventory' && DB.currentUser?.roleId !== 'ROLE_SUBCONTRACT') {
        try { await WarehouseInventoryPrimaryData.refresh({ force:true }); }
        catch (err) { console.warn('[Warehouse] Refresh Tồn kho khi đổi route thất bại:', err); }
      }

      // [HR SERVER-FIRST NAVIGATION]
      // Role HR đăng nhập thẳng vào HR đã được hydrate server trước first paint ở boot().
      // Nhưng role cấp cao (admin/GĐ/...) vào Dashboard trước, Global Warmup có thể nạp
      // snapshot HR cũ (ví dụ 86 nhân sự) vào DB. Nếu người dùng click Nhân sự trong
      // lúc request server chưa hoàn tất, render() cũ sẽ lóe 86 rồi vài giây sau đổi 51.
      // Khi ĐI VÀO phân hệ HR từ phân hệ khác, chờ đúng lenam_hr_employees trên KIO
      // trước khi render lần đầu. Chuyển tab nội bộ HR không force lại để tránh request thừa.
      if (State.module === 'hr' && previousModule !== 'hr') {
        try {
          await HRAPI?.bootstrap?.();
          await HRAPI?.ensureFresh?.(['employees'], { force:true });
        } catch (err) {
          console.warn('[HR] Không hydrate được nhân sự KIO trước khi vào phân hệ:', err);
        }
      }
      render();
      scheduleRouteDataRefresh(State.module, State.tab);
    }
  }
});

  // [CROSS-DEVICE LIVE STOCK REFRESH]
  // Không có websocket trên KIO nên đồng bộ tab đang mở bằng 3 lớp:
  // 1) quay lại tab/browser -> force LIST ngay; 2) window focus -> force LIST;
  // 3) khi đứng yên tại Tồn kho -> poll nhẹ các bảng biến động mỗi 15 giây.
  // Master đầy đủ vẫn được hydrate khi vào route; poll chỉ lấy bảng hay thay đổi để
  // tránh hàng chục request và không ảnh hưởng chuỗi nghiệp vụ.
  let __warehouseLiveRefreshAt = 0;
  let __warehouseLiveRefreshPromise = null;
  const refreshVisibleWarehouseInventory = async ({ includeMasters = false } = {}) => {
    if (document.hidden || State.module !== 'warehouse' || State.tab !== 'inventory') return false;
    if (DB.currentUser?.roleId === 'ROLE_SUBCONTRACT') return false;
    const now = Date.now();
    if (__warehouseLiveRefreshPromise || now - __warehouseLiveRefreshAt < 1200) return __warehouseLiveRefreshPromise || false;
    __warehouseLiveRefreshAt = now;
    __warehouseLiveRefreshPromise = (async () => {
      try {
        await InventoryAPI?.bootstrap?.();
        const keys = includeMasters
          ? ['inventory','inventoryLots','warehouses','warehouseLocations','materials','semiFinishedProducts','products','itemCategories']
          : ['inventory','inventoryLots'];
        const changed = await InventoryAPI?.ensureFresh?.(keys, { force:true });
        const active = document.activeElement;
        const editing = active && ['INPUT','SELECT','TEXTAREA'].includes(active.tagName);
        const modalOpen = typeof Modal !== 'undefined' && Modal.isOpen?.();
        const drawerOpen = typeof Drawer !== 'undefined' && Drawer.isOpen?.();
        if (State.module === 'warehouse' && State.tab === 'inventory' && !editing && !modalOpen && !drawerOpen) {
          render();
        }
        return changed;
      } catch (err) {
        console.warn('[WarehouseLive] Không refresh được tồn kho từ server:', err);
        return false;
      } finally {
        __warehouseLiveRefreshPromise = null;
      }
    })();
    return __warehouseLiveRefreshPromise;
  };

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshVisibleWarehouseInventory({ includeMasters:true });
  });
  window.addEventListener('focus', () => {
    refreshVisibleWarehouseInventory({ includeMasters:true });
  });
  setInterval(() => {
    refreshVisibleWarehouseInventory({ includeMasters:false });
  }, 15000);

  // Ẩn/hiện nút tìm kiếm trên mobile
  const syncMobile = () => { $('#btnSearchMobile').style.display = window.innerWidth <= 900 ? 'grid' : 'none'; };
  syncMobile();
  window.addEventListener('resize', syncMobile);

}

// F(key, defaults) được định nghĩa duy nhất trong core/app.core.js.
// Không khai báo lại ở app.js để tránh mất default filter/date của các view.

// UI33: chuyển subtab ngang Kế hoạch sản xuất / Kế hoạch gia công trong Kho.
Actions['warehouse-plan-tab'] = (d) => {
  F('warehouse-production-plan').planTab = d.tab === 'subcontracting' ? 'subcontracting' : 'production';
  render();
};

Actions['warehouse-open-subcontract-issue'] = (d) => {
  const f = F('inv-issues');
  f.issueTab = 'raw';
  f.kind = 'subcontract_request';
  f.type = 'SUBCONTRACT_ISSUE';
  f.q = d.id || '';
  State.page['inv-issues'] = 1;
  go('warehouse', { tab:'issues' });
};



/* UI37 — Maintenance action bindings */
Object.assign(Actions, {
  'maintenance-catalog-new': () => openMaintenanceCatalogForm(),
  'maintenance-catalog-open': (d) => openMaintenanceCatalogDetail(d.id),
  'maintenance-catalog-edit': (d) => openMaintenanceCatalogForm(d.id),
  'maintenance-catalog-save': (d) => maintenanceSaveCatalog(d.id || ''),
  'maintenance-catalog-delete': (d) => maintenanceDeleteCatalog(d.id),
  'maintenance-equipment-new': () => openMaintenanceEquipmentForm(),
  'maintenance-equipment-open': (d) => openMaintenanceEquipmentDetail(d.id),
  'maintenance-equipment-edit': (d) => openMaintenanceEquipmentForm(d.id),
  'maintenance-equipment-save': (d) => maintenanceSaveEquipment(d.id || ''),
  'maintenance-equipment-delete': (d) => maintenanceDeleteEquipment(d.id),
  'maintenance-schedule-new': () => openMaintenanceScheduleForm(),
  'maintenance-schedule-open': (d) => openMaintenanceScheduleDetail(d.id),
  'maintenance-schedule-edit': (d) => openMaintenanceScheduleForm(d.id),
  'maintenance-schedule-save': (d) => maintenanceSaveSchedule(d.id || ''),
  'maintenance-schedule-complete': (d) => openMaintenanceScheduleComplete(d.id),
  'maintenance-schedule-complete-save': (d) => maintenanceCompleteSchedule(d.id),
  'maintenance-schedule-delete': (d) => maintenanceDeleteSchedule(d.id),
  'maintenance-wo-new': () => openMaintenanceWoForm(),
  'maintenance-wo-save': () => maintenanceSaveWo(),
  'maintenance-wo-open': (d) => openMaintenanceWoDetail(d.id),
  'maintenance-wo-start': (d) => maintenanceStartWo(d.id),
  'maintenance-wo-complete': (d) => openMaintenanceWoComplete(d.id),
  'maintenance-wo-complete-save': (d) => maintenanceCompleteWo(d.id),
  'maintenance-log-new': () => openMaintenanceLogForm(),
  'maintenance-log-save': () => maintenanceSaveLog(),
  'maintenance-log-open': (d) => openMaintenanceLogDetail(d.id),
});

document.addEventListener('DOMContentLoaded', boot);
