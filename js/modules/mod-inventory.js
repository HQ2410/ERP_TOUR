function inventoryPendingSupplierReturnQty(row) {
  const matches = (DB.materialReturnRequests || []).filter(r =>
    String(r.materialId || r.productId || '') === String(row.productId || '') &&
    row.lotId && String(r.lotId || '') === String(row.lotId) &&
    (!r.warehouseId || !row.warehouseId || r.warehouseId === row.warehouseId) &&
    (!r.locationId || !row.locationId || r.locationId === row.locationId));
  if (matches.length) return matches.filter(r => ['PENDING_WAREHOUSE','WAITING_WAREHOUSE','WAITING_WAREHOUSE_CONFIRMATION'].includes(r.status))
    .reduce((n,r) => n + Math.max(0, Number(r.qty || 0)), 0);
  const receipts = (DB.goodsReceipts || []).flatMap(r => r.items || []).filter(i =>
    row.lotId && i.lotId === row.lotId && (i.materialId || i.productId) === row.productId && Number.isFinite(Number(i.failedQty)));
  if (!receipts.length) return Math.max(0, Number(row.qtyRejected || 0));
  const rejected = receipts.reduce((n,i) => n + Number(i.failedQty || 0),0);
  const returned = (DB.goodsIssues || []).filter(i => i.type === 'RETURN_OUT' && i.status === 'COMPLETED')
    .flatMap(i => i.items || []).filter(i => i.lotId === row.lotId && (i.productId || i.materialId) === row.productId)
    .reduce((n,i) => n + Number(i.qty || i.quantity || 0),0);
  return Math.max(0,rejected-returned);
}

/* ============================================================================
 * MODULE: VẬT TƯ — TỒN KHO — MUA SẮM
 * ==========================================================================*/

function inventoryMasterItem(id) {
  return Q.material(id) || (DB.semiFinishedProducts || []).find((x) => x.id === id) || Q.product(id);
}

function inventoryCanOperate() {
  return typeof Auth === 'undefined' || Auth.hasPermission('INVENTORY_OPERATE');
}

// Lô hết hạn vẫn được giữ nguyên trong DB để truy vết/audit, nhưng không còn
// được tính vào tồn khả dụng trên màn Tồn kho chính. Các lô này được hiển thị
// tại Hàng lỗi với phân loại "Hết hạn". Màn chi tiết master vẫn xem đủ mọi lô.
function inventoryLotIsExpired(lotOrId) {
  const lot = typeof lotOrId === 'string' ? Q.lot(lotOrId) : lotOrId;
  const expiry = String(lot?.expiryDate || '').slice(0, 10);
  if (!expiry) return false;
  const base = String(DB.today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return expiry < base;
}

function inventoryLotStateHtml(lotOrId) {
  const lot = typeof lotOrId === 'string' ? Q.lot(lotOrId) : lotOrId;
  if (inventoryLotIsExpired(lot)) return '<span class="badge red"><i class="fa-solid fa-calendar-xmark"></i> Hết hạn</span>';
  if (String(lot?.qcStatus || '').toUpperCase() === 'FAILED') return '<span class="badge red">QC không đạt</span>';
  return '<span class="badge green">Còn hiệu lực</span>';
}
/* ------------------------------------------------------------ HẠN DÙNG (dùng chung)
 * Một nguồn duy nhất để tính số ngày còn lại và hiển thị HSD ở mọi màn hình.
 * Cấu hình theo mặt hàng: item.shelfLifeDays (HSD mặc định, ngày) và
 * item.expiryWarnDays (cảnh báo cận hạn trước N ngày).
 * -------------------------------------------------------------------------- */
const INVENTORY_DEFAULT_EXPIRY_WARN_DAYS = 7;
function inventoryExpiryWarnDays(productId) {
  const item = inventoryMasterItem(productId);
  const n = Number(item?.expiryWarnDays || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : INVENTORY_DEFAULT_EXPIRY_WARN_DAYS;
}
function inventoryExpiryInfo(lotOrId) {
  const lot = typeof lotOrId === 'string' ? Q.lot(lotOrId) : lotOrId;
  const expiry = String(lot?.expiryDate || '').slice(0, 10);
  if (!expiry) return { state: 'none', date: '', days: null };
  const base = String(DB.today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const days = Math.round((new Date(expiry + 'T00:00:00Z') - new Date(base + 'T00:00:00Z')) / 86400000);
  const warn = inventoryExpiryWarnDays(lot?.productId);
  const state = days < 0 ? 'expired' : (days <= warn ? 'soon' : 'ok');
  return { state, date: expiry, days, warn };
}
// Ngày HSD + số ngày còn lại/quá hạn, có màu theo trạng thái.
function inventoryExpiryHtml(lotOrId, opts = {}) {
  const info = inventoryExpiryInfo(lotOrId);
  if (info.state === 'none') return '<span class="muted">Chưa có HSD</span>';
  const color = info.state === 'expired' ? 'var(--red)' : info.state === 'soon' ? 'var(--orange)' : 'var(--green, #16a34a)';
  const text = info.state === 'expired'
    ? `Quá hạn ${fmtN(Math.abs(info.days))} ngày`
    : info.days === 0 ? 'Hết hạn hôm nay' : `Còn ${fmtN(info.days)} ngày`;
  return `<span class="num">${fmtDate(info.date)}</span>${opts.compact ? '' : `<div class="cell-sub" style="color:${color};font-weight:600">${text}</div>`}`;
}
// HSD gần nhất trong các dòng tồn còn số lượng của một mặt hàng.
function inventoryNearestExpiry(rows) {
  let best = null;
  (rows || []).forEach((r) => {
    if (Math.max(Number(r.qtyOnHand || 0), Number(r.qtyPending || 0)) <= 0.000001) return;
    const lot = Q.lot(r.lotId);
    if (!lot?.expiryDate) return;
    if (!best || String(lot.expiryDate) < String(best.expiryDate)) best = lot;
  });
  return best;
}
function inventoryItemCategory(item, type) {
  if (!item) return '';
  if (type === 'RAW_MATERIAL') return item.group || item.category || '';
  return item.category || (type === 'SEMI_FINISHED' ? 'Bán thành phẩm' : 'Thành phẩm');
}
function inventoryCategories(type) {
  // Danh mục đã khai báo trên server là master duy nhất cho dropdown/filter.
  // Không tự biến group/category cũ của dữ liệu seed thành một danh mục mới
  // (ví dụ VT-004 có group "Dầu chiên" nhưng server không có CAT tương ứng).
  const configured = (DB.itemCategories || [])
    .filter((c) => c.type === type && c.status !== 'inactive' && c.name)
    .map((c) => c.name);
  if (configured.length) {
    return [...new Set(configured)].sort((a,b)=>String(a).localeCompare(String(b),'vi'));
  }
  // Chỉ fallback dữ liệu cũ khi server chưa có master danh mục nào.
  const derived = type === 'RAW_MATERIAL'
    ? (DB.materials || []).map((x) => x.group)
    : type === 'SEMI_FINISHED'
      ? (DB.semiFinishedProducts || []).map((x) => x.category)
      : (DB.products || []).map((x) => x.category);
  return [...new Set(derived.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'vi'));
}

/* ------------------------------------------------------------ VẬT TƯ (LEGACY ROUTE)
 * Màn Quản lý vật tư cũ đã được hợp nhất vào Views.inventory().
 * Giữ alias này để route/code cũ không bị gãy; không còn UI trùng lặp.
 * -------------------------------------------------------------------------- */
Views.materials = () => Views.inventory();

function openMaterialModal(id) {
  const m = Q.material(id);
  if (!m) return;
  const moves = DB.stockMoves.filter((x) => x.materialId === id);
  const usedIn = DB.products.filter((p) => (p.bom || []).some(([mid]) => mid === id));
  const stockRows = (DB.inventory || []).filter((r) => r.productId === id && Number(r.qtyOnHand || 0) !== 0);

  Modal.open({
    title: `${esc(m.name)}`,
    sub: `${m.id} · ${esc(m.group || 'Chưa phân loại')}`,
    size: 'md',
    body: `
      <div class="grid g-auto-sm" style="margin-bottom:16px">
        ${mkpi('Tồn kho hiện tại', fmtDec(Number(m.stock||0), 2) + ' ' + m.unit, 'fa-boxes-stacked', Number(m.stock||0) <= 0 ? 'red' : Number(m.stock||0) < Number(m.minStock||0) ? 'orange' : 'green')}
        ${mkpi('Tồn tối thiểu', fmtDec(Number(m.minStock||0), 2) + ' ' + m.unit, 'fa-arrow-down-short-wide', 'slate')}
        ${mkpi('Đơn giá tham chiếu', fmtVND(Number(m.price||0)), 'fa-tag', 'blue')}
        ${mkpi('Giá trị tồn', fmtShort(Number(m.value||0)), 'fa-sack-dollar', 'teal')}
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-circle-info"></i>Thông tin master</div>
      <div class="info-grid" style="margin-bottom:18px">
        ${infoItem('Danh mục', esc(m.group || '—'))}
        ${infoItem('Đơn vị tính', esc(m.unit || '—'))}
        ${infoItem('Tình trạng', badge(m.status))}
        ${infoItem('Dùng cho', usedIn.length ? usedIn.map((p) => esc(p.name)).join(', ') : '<span class="muted">Chưa gắn định mức</span>')}
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-location-dot"></i>Vị trí tồn thực tế</div>
      ${tableShell([{t:'Kho'},{t:'Vị trí'},{t:'Lô'},{t:'HSD'},{t:'Trạng thái'},{t:'Số lượng',cls:'right'}], stockRows.map(r=>{const lot=Q.lot(r.lotId);return `<tr><td>${esc(Q.warehouseName(r.warehouseId))}</td><td>${esc(Q.locationName(r.locationId)||'—')}</td><td><span class="code">${esc(lot?.lotNumber||r.lotId||'—')}</span></td><td>${lot?.expiryDate?fmtDate(lot.expiryDate):'—'}</td><td>${inventoryLotStateHtml(lot)}</td><td class="right num">${fmtN(Number(r.qtyOnHand||0))} ${esc(r.unit||m.unit)}</td></tr>`}), {emptyTitle:'Chưa có tồn kho',emptyDesc:'Vị trí chỉ được xác định khi hàng được nhập kho.'})}
      <div class="form-sec-title" style="margin-top:18px"><i class="fa-solid fa-right-left"></i>Lịch sử nhập xuất gần đây</div>
      ${tableShell(
        [{ t: 'Chứng từ' }, { t: 'Loại' }, { t: 'Ngày' }, { t: 'Số lượng', cls: 'right' }, { t: 'Tham chiếu' }],
        moves.map((x) => `<tr>
          <td><span class="code">${x.id}</span></td>
          <td>${x.type === 'in' ? '<span class="badge green">Nhập kho</span>' : '<span class="badge orange">Xuất kho</span>'}</td>
          <td class="num">${fmtDate(x.date)}</td>
          <td class="right strong num" style="color:${x.type === 'in' ? 'var(--green)' : 'var(--orange)'}">${x.type === 'in' ? '+' : '−'}${fmtN(x.qty)}</td>
          <td class="muted">${esc(x.ref)}</td></tr>`),
        { emptyTitle: 'Chưa có giao dịch', emptyDesc: 'Vật tư này chưa phát sinh nhập xuất trong kỳ.' })}`,
    foot: `<button class="btn" data-act="modal-close">Đóng</button>
           ${inventoryCanOperate() ? `<button class="btn" data-act="inventory-item-edit" data-type="RAW_MATERIAL" data-id="${m.id}"><i class="fa-solid fa-pen"></i>Sửa</button>
           <button class="btn" data-act="stock-move" data-id="${m.id}"><i class="fa-solid fa-right-left"></i>Nhập / xuất kho</button>` : ''}
           ${inventoryCanOperate() && Number(m.stock||0) < Number(m.minStock||0) && (typeof Auth === 'undefined' || Auth.hasPermission('PURCHASE_PR_CREATE')) ? `<button class="btn btn-primary" data-act="material-request" data-id="${m.id}"><i class="fa-solid fa-cart-plus"></i>Tạo yêu cầu mua</button>` : ''}`,
  });
}


function inventoryCategoryCodePrefix(type, categoryName) {
  const cat = (DB.itemCategories || []).find((c) => c.type === type && String(c.name) === String(categoryName));
  if (cat?.codePrefix) return String(cat.codePrefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const normalized = String(categoryName || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return type === 'RAW_MATERIAL' ? 'NVL' : type === 'SEMI_FINISHED' ? 'BTP' : 'TP';
  const prefix = words.length === 1 ? words[0].slice(0, 3) : words.map((w) => w[0]).join('').slice(0, 6);
  return prefix || (type === 'RAW_MATERIAL' ? 'NVL' : type === 'SEMI_FINISHED' ? 'BTP' : 'TP');
}

function nextInventoryMasterCode(type, categoryName) {
  const prefix = inventoryCategoryCodePrefix(type, categoryName);
  const all = [
    ...(DB.materials || []),
    ...(DB.semiFinishedProducts || []),
    ...(DB.products || []),
  ];
  let max = 0;
  const rx = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}-(\\d+)$`, 'i');
  all.forEach((x) => {
    const m = String(x.id || '').match(rx);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  });
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

function supplierMatchesCategory(supplier, categoryName) {
  if (!supplier || !categoryName) return false;
  const groups = Array.isArray(supplier.groups) ? supplier.groups : [supplier.group];
  return groups.filter(Boolean).some((g) => String(g).trim().toLowerCase() === String(categoryName).trim().toLowerCase());
}

function inventorySuppliersForCategory(categoryName) {
  return (DB.suppliers || []).filter((supplier) => supplierMatchesCategory(supplier, categoryName));
}

function locationZoneLabel(location) {
  if (!location) return '';
  if (location.zone) return String(location.zone);
  if (location.parentLocation) {
    const parent = (DB.warehouseLocations || []).find((x) => x.id === location.parentLocation);
    if (parent) return parent.name || parent.code || parent.id;
  }
  const code = String(location.code || '');
  const m = code.match(/-([A-Z]+)\d*$/i);
  if (m) return `Khu ${m[1].toUpperCase()}`;
  const name = String(location.name || '');
  const n = name.match(/Kệ\s+([A-Z]+)/i);
  return n ? `Khu ${n[1].toUpperCase()}` : 'Khu chung';
}

function inventoryZonesOf(warehouseId) {
  return [...new Set((Q.locationsOf(warehouseId) || []).map(locationZoneLabel).filter(Boolean))];
}

function inventoryShelfOptions(warehouseId, zone, selectedLocationId = '') {
  return (Q.locationsOf(warehouseId) || [])
    .filter((l) => !zone || locationZoneLabel(l) === zone)
    .map((l) => `<option value="${esc(l.id)}" ${String(selectedLocationId) === String(l.id) ? 'selected' : ''}>${esc(l.name)} · ${esc(l.code || '')}</option>`)
    .join('');
}

function openInventoryItemForm(type = 'RAW_MATERIAL', id = '') {
  const isRaw = type === 'RAW_MATERIAL';
  const isSemi = type === 'SEMI_FINISHED';
  const source = isRaw ? DB.materials : isSemi ? [...(DB.semiFinishedProducts || []), ...(DB.products || [])] : DB.products;
  const item = id ? source.find((x) => x.id === id) : null;
  const typeLabel = isRaw ? 'nguyên liệu' : isSemi ? 'bán thành phẩm' : 'thành phẩm';
  const cats = inventoryCategories(type);
  const category = inventoryItemCategory(item, type);
  const generatedCode = item?.id || (category ? nextInventoryMasterCode(type, category) : 'Chọn danh mục để sinh mã');

  Modal.open({
    title: item ? `Sửa ${typeLabel}` : `Thêm ${typeLabel}`,
    sub: item ? `${item.id} · Cập nhật thông tin master` : `Chỉ khai báo master hàng hóa; tồn kho chỉ phát sinh khi nhập kho thực tế`,
    size: 'md',
    body: `<div class="form-grid">
      <div class="field"><label>Mã ${typeLabel}</label><input class="inp code" id="invItemId" value="${esc(generatedCode)}" disabled><div class="cell-sub" style="margin-top:5px">Mã tự sinh theo mã viết tắt của danh mục, ví dụ BB-0001, NLC-0001.</div></div>
      <div class="field"><label>Tên ${typeLabel} <span class="req">*</span></label><input class="inp" id="invItemName" value="${esc(item?.name || '')}" placeholder="Ví dụ: Ly nhựa 500ml"></div>
      <div class="field"><label>Danh mục <span class="req">*</span></label><select class="inp" id="invItemCategory"><option value="">-- Chọn danh mục --</option>${cats.map(c=>`<option value="${esc(c)}" ${category===c?'selected':''}>${esc(c)}</option>`).join('')}</select><div class="cell-sub" style="margin-top:6px">Chưa có danh mục? Đóng form và chọn nút <b>Danh mục nguyên liệu</b> trên màn hình Quản lý vật tư.</div></div>
      <div class="field"><label>Đơn vị tính <span class="req">*</span></label><input class="inp" id="invItemUnit" value="${esc(item?.unit || '')}" placeholder="Kg / Cái / Hộp..."></div>
      <div class="field"><label>Đơn giá tham chiếu</label><input class="inp right num" id="invItemPrice" type="text" inputmode="numeric" autocomplete="off" value="${item ? fmtN(Number(item?.price || 0)) : ''}" placeholder="Ví dụ: 12.000"><div class="cell-sub" style="margin-top:5px">Nhập 12000, hệ thống sẽ hiển thị 12.000. Giá mua thực tế lấy theo báo giá/PO.</div></div>
      <div class="field"><label>Tồn kho tối thiểu</label><input class="inp right num" id="invItemMinStock" type="number" min="0" value="${item ? Number(isRaw ? item?.minStock || 0 : type==='FINISHED_GOODS' ? DB.finishedMinStock?.[item?.id] || 0 : item?.minStock || 0) : ''}" placeholder="0"></div>
      <div class="field"><label>Hạn sử dụng mặc định (ngày)</label><input class="inp right num" id="invItemShelfLifeDays" type="number" min="0" step="1" value="${item ? Number(item?.shelfLifeDays || 0) || '' : ''}" placeholder="Ví dụ: 7"><div class="cell-sub" style="margin-top:5px">HSD = Ngày sản xuất/nhập + số ngày này. 0/để trống = chưa quy định. Có thể chỉnh hàng loạt ở Kho → Cấu hình hạn dùng.</div></div>
      <div class="field"><label>Cảnh báo cận hạn trước (ngày)</label><input class="inp right num" id="invItemExpiryWarnDays" type="number" min="0" step="1" value="${item ? Number(item?.expiryWarnDays || 0) || '' : ''}" placeholder="Mặc định ${INVENTORY_DEFAULT_EXPIRY_WARN_DAYS}"></div>
      ${!item && (isRaw || type === 'FINISHED_GOODS') ? `<div class="field"><label>Số lượng ban đầu</label><input class="inp right num" id="invItemOpeningQty" type="number" min="0" step="any" value="" placeholder="0"><div class="cell-sub" style="margin-top:5px">Nếu nhập &gt; 0, hệ thống ghi nhận là <b>tồn đầu kỳ</b>. ${type === 'FINISHED_GOODS' ? 'Thành phẩm được đưa vào Kho thành phẩm và tạo lô mở đầu để có thể theo dõi/xuất bán.' : 'Không tạo PR/PO hay phiếu nhập mua hàng.'}</div></div>` : ''}
      ${!isRaw ? `<div class="field" style="grid-column:1/-1"><label>Quy cách / mô tả</label><input class="inp" id="invItemSpec" value="${esc(item?.spec || '')}" placeholder="Quy cách sản phẩm"></div>` : ''}
      ${type === 'FINISHED_GOODS' ? `<div class="field" id="invItemPackedWeightField" style="${/^\s*kg\s*$/i.test(String(item?.unit||''))?'display:none;':''}"><label>Khối lượng đóng gói / 1 ${esc(item?.unit || 'ĐVT bán')} (g)</label><input class="inp right num" id="invItemPackedWeightG" type="number" inputmode="decimal" min="0" step="0.01" value="${item ? Number(item?.packedWeightG || (Number(item?.packedWeightKg || 0) * 1000) || 0) || '' : ''}" placeholder="Ví dụ: 400"><div class="cell-sub" style="margin-top:5px">Chỉ cần khai báo khi ĐVT không phải Kg. Logistics tự quy đổi sang kg để tính tải xe.</div></div>` : ''}
    </div>
    <div class="alert info" style="margin-top:12px"><i class="fa-solid fa-circle-info"></i><span>${item ? 'Sửa master không tự thay đổi số lượng tồn kho.' : `Nếu không nhập số lượng ban đầu thì ${typeLabel} mới có tồn = 0. Nguyên liệu và thành phẩm có thể khai báo tồn đầu kỳ khi tạo mới; các luồng mua hàng/sản xuất hiện tại vẫn giữ nguyên.`}</span></div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="inventory-item-save" data-type="${type}" data-id="${esc(item?.id || '')}"><i class="fa-solid fa-floppy-disk"></i>Lưu ${typeLabel}</button>`
  });
}

function openInventoryMasterDetail(type, id) {
  if (type === 'RAW_MATERIAL') return openMaterialModal(id);
  const item = inventoryMasterItem(id); if (!item) return;
  const rows = DB.inventory.filter((r)=>r.productId===id);
  const qty = rows.reduce((sum,r)=>sum+Number(r.qtyOnHand||0),0);
  const typeLabel = type === 'SEMI_FINISHED' ? 'Bán thành phẩm' : 'Thành phẩm';
  Modal.open({
    title: esc(item.name || id), sub: `${id} · ${typeLabel} · ${esc(inventoryItemCategory(item,type)||'Chưa phân loại')}`, size:'md',
    body:`<div class="info-grid">${infoItem('Mã hàng',`<span class="code">${esc(id)}</span>`)}${infoItem('Danh mục',esc(inventoryItemCategory(item,type)||'—'))}${infoItem('Đơn vị tính',esc(item.unit||'—'))}${infoItem('Đơn giá',fmtVND(Number(item.price||0)))}${infoItem('Tổng tồn',`<b class="num">${fmtN(qty)} ${esc(item.unit||'')}</b>`)}${type === 'FINISHED_GOODS' ? infoItem('Khối lượng đóng gói', Number(item.packedWeightG||0)>0 || Number(item.packedWeightKg||0)>0 ? `<b class="num">${fmtDec(Number(item.packedWeightG||0) || Number(item.packedWeightKg||0)*1000,2)} g / ${esc(item.unit||'ĐVT')}</b>` : '<span class="muted">Chưa khai báo</span>') : ''}${infoItem('Quy cách',esc(item.spec||'—'))}${infoItem('Hạn sử dụng mặc định', Number(item.shelfLifeDays||0)>0 ? `<b>${fmtN(Number(item.shelfLifeDays))} ngày</b> · cảnh báo trước ${fmtN(inventoryExpiryWarnDays(id))} ngày` : '<span class="muted">Chưa quy định</span>')}</div>
      <div class="form-sec-title"><i class="fa-solid fa-warehouse"></i>Tồn theo kho/lô</div>${tableShell([{t:'Kho'},{t:'Lô'},{t:'HSD'},{t:'Trạng thái'},{t:'Số lượng',cls:'right'}],rows.map(r=>{const lot=Q.lot(r.lotId);return `<tr><td>${esc(Q.warehouseName(r.warehouseId))}</td><td><span class="code">${esc(lot?.lotNumber||'—')}</span></td><td>${lot?.expiryDate?fmtDate(lot.expiryDate):'—'}</td><td>${inventoryLotStateHtml(lot)}</td><td class="right num">${fmtN(r.qtyOnHand)} ${esc(r.unit||item.unit||'')}</td></tr>`}),{emptyTitle:'Chưa phát sinh tồn kho'})}`,
    foot:`<button class="btn" data-act="modal-close">Đóng</button>${inventoryCanOperate() ? `<button class="btn btn-primary" data-act="inventory-item-edit" data-type="${type}" data-id="${esc(id)}"><i class="fa-solid fa-pen"></i>Sửa</button>` : ''}`
  });
}

function openItemCategoryManager(type='RAW_MATERIAL') {
  const labels={RAW_MATERIAL:'Danh mục nguyên liệu',SEMI_FINISHED:'Danh mục bán thành phẩm',FINISHED_GOODS:'Danh mục thành phẩm'};
  // [DATA CONSISTENCY] Mỗi tên danh mục chỉ hiển thị một lần trong master.
  // InventoryAPI cũng dọn record trùng trên KIO, nhưng UI vẫn tự bảo vệ để cache
  // cũ không làm xuất hiện 2 dòng Bao bì / Phụ gia trong lúc server refresh.
  const seenCategoryNames = new Set();
  const cats=(DB.itemCategories||[])
    .filter(c=>c.type===type && c.status!=='inactive')
    .sort((a,b)=>String(a.id||'').localeCompare(String(b.id||''),'vi',{numeric:true}))
    .filter(c=>{ const key=String(c.name||'').trim().toLocaleLowerCase('vi'); if(!key||seenCategoryNames.has(key)) return false; seenCategoryNames.add(key); return true; });
  Modal.open({title:labels[type]||'Danh mục hàng hóa',sub:'Tạo danh mục trước, sau đó hệ thống dùng mã viết tắt để tự sinh mã hàng.',size:'lg',body:`
    <div data-category-manager-type="${type}"></div>
    <div class="form-grid" style="align-items:end;margin-bottom:14px">
      <div class="field"><label>Tên danh mục</label><input class="inp" id="newItemCategoryName" placeholder="Ví dụ: Bao bì"></div>
      <div class="field"><label>Mã viết tắt</label><input class="inp" id="newItemCategoryPrefix" maxlength="8" placeholder="Ví dụ: BB"><div class="cell-sub" style="margin-top:5px">Có thể để trống để hệ thống tự gợi ý.</div></div>
      <div class="field"><button type="button" class="btn btn-primary" data-act="item-category-add" data-type="${type}"><i class="fa-solid fa-plus"></i>Thêm danh mục</button></div>
    </div>
    ${tableShell([{t:'Mã danh mục'},{t:'Tên danh mục'},{t:'Mã viết tắt'},{t:'Ví dụ mã hàng'},{t:'',cls:'right'}],cats.map(c=>{const prefix=inventoryCategoryCodePrefix(type,c.name);return `<tr><td><span class="code">${esc(c.id)}</span></td><td class="strong">${esc(c.name)}</td><td><input class="inp category-prefix-input" data-id="${esc(c.id)}" value="${esc(prefix)}" maxlength="8" style="width:100px;text-transform:uppercase"></td><td><span class="code">${esc(prefix)}-0001</span></td><td class="right">${rowActions([{act:'item-category-prefix-save',data:`data-id="${esc(c.id)}"`,icon:'fa-floppy-disk',title:'Lưu mã viết tắt'},{act:'item-category-delete',data:`data-id="${esc(c.id)}"`,icon:'fa-trash',title:'Xóa danh mục'}])}</td></tr>`}),{emptyTitle:'Chưa có danh mục'})}`,
    foot:'<button class="btn" data-act="modal-close">Đóng</button>'});
}

/** Phiếu nhập / xuất kho thủ công. Giữ nguyên nghiệp vụ cũ; chỉ khôi phục hàm
 * đã bị comment để action stock-move không trỏ tới function undefined. */
function openStockMoveModal(id) {
  const m = Q.material(id);
  if (!m) return;
  Modal.open({
    title: 'Phiếu nhập / xuất kho',
    sub: `${m.id} · ${esc(m.name)} · Tồn hiện tại ${fmtDec(m.stock, 2)} ${esc(m.unit)}`,
    body: `<div class="form-grid">
        <div class="field"><label>Loại phiếu</label>
          <select class="inp" id="smType"><option value="in">Nhập kho</option><option value="out">Xuất kho</option></select></div>
        <div class="field"><label>Số lượng (${esc(m.unit)}) <span class="req">*</span></label>
          <input class="inp num" type="number" id="smQty" min="0" step="0.01" value="" placeholder="0" /></div>
        <div class="field"><label>Ngày chứng từ</label><input class="inp" type="date" id="smDate" value="${currentDateYMD()}" min="${currentDateYMD()}" /></div>
        <div class="field"><label>Tham chiếu</label><input class="inp" id="smRef" placeholder="LSX-2026-0048 / YCM-2026-0046" /></div>
      </div>
      <div class="field"><label>Diễn giải</label><textarea class="inp" id="smNote" rows="2" placeholder="Xuất vật tư cho lệnh sản xuất…"></textarea></div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-primary" data-act="stock-move-save" data-id="${m.id}"><i class="fa-solid fa-floppy-disk"></i>Ghi phiếu</button>`,
  });
}

/* ------------------------------------------------------------ TỒN KHO */
// [FILTER THỜI GIAN KHO] Chỉ lọc dữ liệu hiển thị theo ngày chứng từ/cập nhật.
// Không thay đổi tồn kho, lô, phiếu hay bất kỳ logic InventoryService nào.
function inventoryInDateRange(dateValue, fromValue, toValue) {
  const d = String(dateValue || '').slice(0, 10);
  if (!d) return !(fromValue || toValue);
  if (fromValue && d < fromValue) return false;
  if (toValue && d > toValue) return false;
  return true;
}
function inventoryDateRangeInputs(key, f, fromField = 'dateFrom', toField = 'dateTo') {
  return `<label style="display:flex;align-items:center;gap:5px"><span class="muted" style="font-size:11px;white-space:nowrap">Từ ngày</span><input class="inp" type="date" data-f="${key}.${fromField}" value="${esc(f[fromField] || '')}" style="width:140px" /></label>
    <label style="display:flex;align-items:center;gap:5px"><span class="muted" style="font-size:11px;white-space:nowrap">Đến ngày</span><input class="inp" type="date" data-f="${key}.${toField}" value="${esc(f[toField] || '')}" style="width:140px" /></label>`;
}

Views.inventory = function () {
  const f = F('inventory', { q: '', stockTab: 'raw', warehouse: '', category: '', stockStatus: '', expandedProductId: '', dateFrom: '', dateTo: '' });
  const q = (f.q || '').toLowerCase().trim();
  const stockTab = f.stockTab || 'raw';
  const stockTabConfig = {
    raw: { label: 'Kho nguyên liệu', type: 'RAW_MATERIAL', icon: 'fa-seedling', itemLabel: 'Nguyên liệu' },
    semi: { label: 'Kho bán thành phẩm', type: 'SEMI_FINISHED', icon: 'fa-cubes-stacked', itemLabel: 'Bán thành phẩm' },
    finished: { label: 'Kho thành phẩm', type: 'FINISHED_GOODS', icon: 'fa-box', itemLabel: 'Thành phẩm' },
  };
  const cfg = stockTabConfig[stockTab] || stockTabConfig.raw;
  const finishedMinStock = DB.finishedMinStock || {};
  // Chỉ đổi nhãn hiển thị trong Tồn kho: Kho = địa điểm vật lý, Kệ = Khu + Kệ.
  // Không thay đổi warehouseId/locationId hay logic nghiệp vụ đang dùng ở các màn khác.
  const inventoryWarehouseLabel = (warehouseId) => {
    const wh = Q.warehouse(warehouseId);
    if (!wh) return '—';
    const place = String(wh.name || '')
      .replace(/^Kho\s+Nguyên liệu\s*-\s*/i, '')
      .replace(/^Kho\s+Bán thành phẩm\s*-\s*/i, '')
      .replace(/^Kho\s+Thành phẩm\s*-\s*/i, '')
      .trim();
    return place ? `Kho ${place}` : (wh.name || '—');
  };
  const inventoryLocationLabel = (locationId) => {
    const raw = String(Q.locationName(locationId) || '—');
    const m = raw.match(/^Kệ\s+([^\s]+)\s*-\s*(.+)$/i);
    if (!m) return raw;
    const shelf = m[1];
    let area = m[2].trim();
    area = area
      .replace(/^Nguyên liệu\s+/i, '')
      .replace(/^BTP\s+/i, '')
      .replace(/^Thành phẩm\s+/i, '');
    return `Khu ${area.charAt(0).toLowerCase()}${area.slice(1)} - Kệ ${shelf}`;
  };
  const warehouseIds = new Set(DB.warehouses.filter(w => w.type === cfg.type).map(w => w.id));
  const rowsSource = (DB.inventory || []).filter(row => warehouseIds.has(row.warehouseId));

  // Tồn kho là màn hình trạng thái của TOÀN BỘ master hàng hóa, không chỉ các mã đã phát sinh tồn.
  // Vì vậy nguyên liệu/BTP/TP vừa tạo vẫn phải xuất hiện với số lượng 0 sau khi refresh.
  const masterSource = cfg.type === 'RAW_MATERIAL'
    ? (DB.materials || [])
    : cfg.type === 'SEMI_FINISHED'
      ? (DB.semiFinishedProducts || [])
      : (DB.products || []);

  const masterIds = new Set(masterSource.map(item => item.id));

  const validRowsSource = rowsSource.filter(row =>
    masterIds.has(row.productId)
  );

  const groupMap = new Map();
  masterSource.forEach(item => {
    if (f.category && inventoryItemCategory(item, cfg.type) !== f.category) return;
    if (q && ![item.id, item.name, inventoryItemCategory(item, cfg.type), item.unit].some(v => String(v || '').toLowerCase().includes(q))) return;
    groupMap.set(item.id, { productId: item.id, qtyOnHand: 0, qtyPending: 0, qtyRejected: 0, qtyReserved: 0, rows: [], expiredRows: [] });
  });

  // Bổ sung các lô/tồn thực tế. Nếu tìm theo lô/PO/kho/kệ thì vẫn đưa đúng mã hàng vào kết quả.
  validRowsSource.forEach(originalRow => {
      const row = {...originalRow, qtyRejected: inventoryPendingSupplierReturnQty(originalRow)};

      // Tồn kho chỉ được gắn vào master hàng hóa đang tồn tại.
      // Inventory cũ không còn master sẽ không tự tạo thêm dòng trên UI.
      if (!groupMap.has(row.productId)) return;

      const item = inventoryMasterItem(row.productId);
      const lot = Q.lot(row.lotId);

      const receipt = (DB.goodsReceipts || []).find(r =>
        (r.items || []).some(i =>
          i.lotId === row.lotId ||
          i.lotNumber === lot?.lotNumber
        )
      );

      if (f.warehouse && row.warehouseId !== f.warehouse) return;

      if (
        f.category &&
        inventoryItemCategory(item, cfg.type) !== f.category
      ) return;

      const rowMatchesQ = !q || [
        row.productId,
        item?.name,
        lot?.lotNumber,
        lot?.supplierLot,
        receipt?.poId,
        Q.warehouseName(row.warehouseId),
        Q.locationName(row.locationId)
      ].some(v =>
        String(v || '').toLowerCase().includes(q)
      );

      const masterMatchesQ = !q || [
        row.productId,
        item?.name,
        inventoryItemCategory(item, cfg.type),
        item?.unit
      ].some(v =>
        String(v || '').toLowerCase().includes(q)
      );

      if (!rowMatchesQ && !masterMatchesQ) return;

      const g = groupMap.get(row.productId);

      // Lô hết hạn không còn nằm trong tồn khả dụng/tổng tồn trên danh sách chính.
      // Không xóa DB: vẫn giữ tại expiredRows để chi tiết master và Hàng lỗi truy vết.
      if (inventoryLotIsExpired(lot) && Number(row.qtyOnHand || 0) > 0) {
        g.expiredRows.push(row);
        return;
      }

      g.qtyOnHand += Number(row.qtyOnHand || 0);
      g.qtyPending += Number(row.qtyPending || 0);
      g.qtyRejected += Number(row.qtyRejected || 0);
      g.qtyReserved += Number(row.qtyReserved || 0);

      g.rows.push(row);
  });
  // [UI ONLY] Trạng thái tồn được tính từ số lượng thực tế, không thay đổi nghiệp vụ kho.
  // Hết hàng phải tách riêng khỏi Sắp hết: qty <= 0 => OUT; 0 < qty < min => LOW.
  const inventoryStockState = (group) => {
    const item = inventoryMasterItem(group.productId);
    const minimumStock = stockTab === 'raw'
      ? Number(item?.minStock || 0)
      : (stockTab === 'finished' ? Number(finishedMinStock[group.productId] || 0) : Number(item?.minStock || 0));
    const qty = Number(group.qtyOnHand || 0);
    if (qty <= 0) return 'OUT';
    if (minimumStock > 0 && qty < minimumStock) return 'LOW';
    return 'IN';
  };

  const dashboardGroups = [...groupMap.values()].sort((a,b) => {
    const ai = inventoryMasterItem(a.productId);
    const bi = inventoryMasterItem(b.productId);
    return String(ai?.name || a.productId).localeCompare(String(bi?.name || b.productId), 'vi', { sensitivity:'base', numeric:true });
  });

  // Nếu lọc thời gian, chỉ giữ mặt hàng có bản ghi tồn được cập nhật trong khoảng đã chọn.
  // Không có lọc thời gian thì vẫn hiển thị toàn bộ master như trước.
  const dashboardScopeGroups = dashboardGroups.filter((group) => {
    if (!f.dateFrom && !f.dateTo) return true;
    return group.rows.some((row) => inventoryInDateRange(row.lastUpdated, f.dateFrom, f.dateTo));
  });

  // Lọc trạng thái chỉ tác động danh sách hiển thị; master và tồn kho gốc không bị thay đổi.
  const groups = dashboardScopeGroups.filter(group => !f.stockStatus || inventoryStockState(group) === f.stockStatus);
  const pg = paged(groups, 'inventory');

  // [SALES TRACE] Tìm các đơn bán đang giữ chỗ đúng theo product + lot.
  // Click vào dòng giữ chỗ sẽ mở thẳng chi tiết đơn hàng tương ứng.
  const salesReservationsFor = (productId, lotId = '') => (DB.goodsIssues || [])
    .filter(gi => gi.type === 'SALES_ISSUE' && gi.status === 'PENDING_CONFIRMATION' && (gi.orderId || gi.refDoc))
    .flatMap(gi => (gi.items || [])
      .filter(it => String(it.productId || '') === String(productId || '') && (!lotId || String(it.lotId || '') === String(lotId || '')))
      .map(it => ({ orderId: gi.orderId || gi.refDoc, issueId: gi.id, qty: Number(it.qty || 0) })));

  const reservationLinks = (productId, lotId, unit) => {
    const rows = salesReservationsFor(productId, lotId);
    if (!rows.length) return '';
    const byOrder = new Map();
    rows.forEach(r => byOrder.set(r.orderId, Number(byOrder.get(r.orderId) || 0) + r.qty));
    return [...byOrder.entries()].map(([orderId, qty]) =>
      `<button type="button" class="btn btn-link btn-sm" style="padding:0;color:var(--blue);font-size:11px" data-act="open-order" data-id="${esc(orderId)}" title="Mở đơn hàng ${esc(orderId)}"><i class="fa-solid fa-cart-flatbed"></i> Giữ chỗ: ${fmtN(qty)} ${esc(unit || '')} · ${esc(orderId)}</button>`
    ).join('<br>');
  };

  const rows = pg.items.map(group => {
    const item = inventoryMasterItem(group.productId);
    const expanded = f.expandedProductId === group.productId;
    // Không hiển thị balance đã cạn sau xuất/chuyển kho. Chỉ còn nhiều dòng
    // khi thực sự còn tồn ở các lô/vị trí tương ứng.
    const lotRows = [...group.rows].filter((row) => {
      const visibleQty = Math.max(Number(row.qtyOnHand||0), Number(row.qtyPending||0));
      return visibleQty > 0.000001;
    }).sort((a,b) => {
      const al = Q.lot(a.lotId), bl = Q.lot(b.lotId);
      return String(al?.lotNumber || '').localeCompare(String(bl?.lotNumber || ''), 'vi', { numeric:true });
    });
    const minimumStock = stockTab === 'raw'
      ? Number(item?.minStock || 0)
      : (stockTab === 'finished' ? Number(finishedMinStock[group.productId] || 0) : 0);
    const qtyOnHand = Number(group.qtyOnHand || 0);
    const outOfStock = qtyOnHand <= 0;
    const lowStock = !outOfStock && minimumStock > 0 && qtyOnHand < minimumStock;
    const stockBadge = outOfStock
      ? ` · <span class="badge red"><i class="fa-solid fa-circle-xmark"></i> Hết hàng</span>`
      : lowStock
        ? ` · <span class="badge orange"><i class="fa-solid fa-triangle-exclamation"></i> Sắp hết hàng</span>`
        : ` · <span class="badge green"><i class="fa-solid fa-circle-check"></i> Còn hàng</span>`;
    const parent = `<tr class="clickable ${expanded ? 'inventory-group-selected' : ''} ${lowStock ? 'inventory-low-stock' : ''}" data-act="inv-stock-product-toggle" data-productid="${group.productId}" style="${expanded ? 'background:var(--teal-soft);box-shadow:inset 5px 0 0 var(--teal)' : ''}">
      <td>${cell2(esc(item?.name || group.productId), `${esc(group.productId)}${stockBadge}${group.expiredRows?.length ? `<div class="cell-sub" style="margin-top:4px;color:var(--red)"><i class="fa-solid fa-calendar-xmark"></i> ${fmtN(group.expiredRows.length)} lô hết hạn đã ẩn khỏi tồn khả dụng · xem đầy đủ trong Chi tiết/Hàng lỗi</div>` : ''}${Number(group.qtyPending||0)>0 ? `<div class="cell-sub" style="margin-top:4px;color:var(--orange)"><i class="fa-solid fa-flask-vial"></i> Đang chờ kiểm tra chất lượng</div>` : ''}${Number(group.qtyRejected||0)>0 ? `<div class="cell-sub" style="margin-top:4px;color:var(--red)"><i class="fa-solid fa-triangle-exclamation"></i> Có ${fmtN(group.qtyRejected)} ${esc(item?.unit || '')} không đạt QC · chờ xuất trả NCC</div>` : ''}${stockTab!=='finished' && Number(group.qtyReserved||0)>0 ? `<div class="cell-sub" style="margin-top:4px;color:var(--blue)">${reservationLinks(group.productId, '', item?.unit || '') || `<i class="fa-solid fa-cart-flatbed"></i> ${fmtN(group.qtyReserved)} ${esc(item?.unit || '')} đang chờ xác nhận xuất bán`}</div>` : ''}`)}</td>
      <td class="right strong num">${fmtN(group.qtyOnHand)} ${esc(item?.unit || lotRows[0]?.unit || '')}${Number(group.qtyPending||0)>0 ? `<div class="cell-sub" style="margin-top:4px;color:var(--orange)">Chờ QC: ${fmtN(group.qtyPending)} ${esc(item?.unit || lotRows[0]?.unit || '')} · chưa tính vào tồn</div>` : ''}${stockTab!=='finished' && Number(group.qtyReserved||0)>0 ? `<div class="cell-sub" style="margin-top:4px;color:var(--blue)">${reservationLinks(group.productId, '', item?.unit || lotRows[0]?.unit || '') || `Giữ chỗ bán: ${fmtN(group.qtyReserved)} ${esc(item?.unit || lotRows[0]?.unit || '')} · chưa trừ tồn thật`}</div>` : ''}${minimumStock > 0 ? `<div class="cell-sub">Tối thiểu: ${fmtN(minimumStock)}</div>` : ''}</td>
      <td class="center"><span class="chip"><i class="fa-solid fa-layer-group"></i> ${lotRows.length} lô</span></td>
      <td>${(() => { const nl = inventoryNearestExpiry(lotRows); return nl ? inventoryExpiryHtml(nl) : '<span class="muted">—</span>'; })()}</td>
      <td>${esc([...new Set(lotRows.map(r=>inventoryWarehouseLabel(r.warehouseId)).filter(Boolean))].join(', '))}</td>
      <td class="right" style="white-space:nowrap">${rowActions([
        { act:'inventory-item-view', data:`data-type="${cfg.type}" data-id="${group.productId}"`, icon:'fa-eye', title:`Xem ${cfg.itemLabel.toLowerCase()}` },
        { act:'inventory-item-edit', data:`data-type="${cfg.type}" data-id="${group.productId}"`, icon:'fa-pen', title:'Sửa master' },
        { act:'inventory-item-delete', data:`data-type="${cfg.type}" data-id="${group.productId}"`, icon:'fa-trash', title:'Xóa master' },
      ])}<button class="btn btn-sm" data-act="inv-stock-product-toggle" data-productid="${group.productId}"><i class="fa-solid ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>${expanded ? 'Thu gọn' : 'Xem lô'}</button></td>
    </tr>`;
    if (!expanded) return parent;
    const child = `<tr class="inventory-lot-child"><td colspan="6" style="padding:0 14px 14px 28px;background:var(--surface-2)">
      <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-top:10px">
      ${tableShell(
        [{t:'Lô hệ thống'},{t:'Số lượng',cls:'right'},{t:'Ngày nhập'},{t:'Hạn sử dụng'},{t:stockTab==='raw'?'Tham chiếu PO':'Tham chiếu'},{t:'Kho'},{t:'Kệ / vị trí'},{t:'',cls:'right',w:'70px'}],
        lotRows.map(row => {
          const lot = Q.lot(row.lotId);
          const receipt = (DB.goodsReceipts || []).find(r => (r.items || []).some(i => i.lotId === row.lotId || i.lotNumber === lot?.lotNumber));
          const receiptDate = receipt?.date || String(row.lastUpdated||'').slice(0,10);
          return `<tr class="clickable" data-act="inv-stock-lot-view" data-productid="${row.productId}" data-lotid="${row.lotId}">
            <td><span class="code">${esc(lot?.lotNumber || '—')}</span></td>
            <td class="right strong num">${fmtN(Number(row.qtyPending||0)>0 && Number(row.qtyOnHand||0)<=0 ? Number(row.qtyPending||0) : Number(row.qtyOnHand||0))} ${esc(row.unit || item?.unit || '')}${Number(row.qtyPending||0)>0 ? `<div class="cell-sub" style="margin-top:4px;color:var(--orange)">${Number(row.qtyOnHand||0)>0 ? `Chờ QC: ${fmtN(row.qtyPending)} ${esc(row.unit || item?.unit || '')} · chưa tính vào tồn` : 'Đang chờ kiểm tra chất lượng · chưa tính vào tồn'}</div>` : ''}${Number(row.qtyRejected||0)>0 ? `<div class="cell-sub" style="margin-top:4px;color:var(--red)">Lô nhập ${fmtN(Number(row.receivedQty||0) || (Number(row.qtyOnHand||0)+Number(row.qtyRejected||0)))} ${esc(row.unit || item?.unit || '')} có ${fmtN(row.qtyRejected)} không đạt · chờ trả NCC</div>` : ''}${stockTab!=='finished' && Number(row.qtyReserved||0)>0 ? `<div class="cell-sub" style="margin-top:4px;color:var(--blue)">${reservationLinks(row.productId, row.lotId, row.unit || item?.unit || '') || `${fmtN(row.qtyReserved)} ${esc(row.unit || item?.unit || '')} đang giữ chỗ · chờ xác nhận xuất bán`}</div>` : ''}</td>
            <td class="num">${fmtDate(receiptDate)}</td>
            <td>${lot?.expiryDate ? inventoryExpiryHtml(lot) : '—'}</td>
            <td>${receipt?.poId ? `<span class="code" style="color:var(--primary)">${esc(receipt.poId)}</span>` : `<span class="muted">${esc(lot?.productionOrderId || '—')}</span>`}</td>
            <td>${esc(inventoryWarehouseLabel(row.warehouseId))}</td>
            <td>${esc(inventoryLocationLabel(row.locationId))}</td>
            <td>${rowActions([{ act:'inv-stock-lot-view', data:`data-productid="${row.productId}" data-lotid="${row.lotId}"`, icon:'fa-eye', title:'Xem chi tiết' }])}</td>
          </tr>`;
        }), { emptyTitle:'Không có lô tồn kho' })}
      </div></td></tr>`;
    return parent + child;
  });

  return `
  ${pageHead('Tồn kho', 'Theo dõi tồn kho tổng hợp theo mặt hàng; click để xem chi tiết từng lô ngay bên dưới', `
    <button class="btn" data-act="inv-export-stock"><i class="fa-solid fa-file-export"></i>Export</button>
    ${inventoryCanOperate() ? `<button class="btn" data-act="item-category-manager" data-type="${cfg.type}"><i class="fa-solid fa-tags"></i>Danh mục</button>
    <button class="btn btn-primary" data-act="inventory-item-add" data-type="${cfg.type}"><i class="fa-solid fa-plus"></i>Thêm ${cfg.itemLabel.toLowerCase()}</button>` : ''}
  `)}
  <div class="tabs" style="margin-bottom:14px">
    <button class="tab ${stockTab === 'raw' ? 'active' : ''}" data-act="inventory-stock-tab" data-tab="raw"><i class="fa-solid fa-seedling"></i>Kho nguyên liệu</button>
    <button class="tab ${stockTab === 'finished' ? 'active' : ''}" data-act="inventory-stock-tab" data-tab="finished"><i class="fa-solid fa-box"></i>Kho thành phẩm</button>
  </div>
  <!-- Dashboard riêng của subtab tồn kho hiện tại. Chỉ tổng hợp dữ liệu, không thay đổi nghiệp vụ. -->
  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi(`Tổng ${cfg.itemLabel.toLowerCase()}`, dashboardScopeGroups.length, 'fa-box', 'blue', 'inventory-dashboard-all')}
    ${mkpi('Còn hàng', dashboardScopeGroups.filter(g => inventoryStockState(g) === 'IN').length, 'fa-circle-check', 'green', 'inventory-dashboard-in')}
    ${mkpi('Sắp hết hàng', dashboardScopeGroups.filter(g => inventoryStockState(g) === 'LOW').length, 'fa-triangle-exclamation', 'orange', 'inventory-dashboard-low')}
    ${mkpi('Hết hàng', dashboardScopeGroups.filter(g => inventoryStockState(g) === 'OUT').length, 'fa-circle-xmark', 'red', 'inventory-dashboard-out')}
    ${mkpi('Tổng số lượng tồn', fmtN(dashboardScopeGroups.reduce((sum,g)=>sum+Number(g.qtyOnHand||0),0)), 'fa-boxes-stacked', 'teal', 'inventory-dashboard-all')}
  </div>
  <div class="card">
    <div class="toolbar">
      ${searchBox('inventory', `Tìm ${cfg.itemLabel.toLowerCase()}, lô, khu, kệ…`)}
      ${selectFilter('inventory','category',inventoryCategories(cfg.type).map(c=>[c,c]),'Tất cả danh mục')}
      ${selectFilter('inventory','stockStatus',[['IN','Còn hàng'],['LOW','Sắp hết hàng'],['OUT','Hết hàng']],'Tất cả trạng thái')}
      ${selectFilter('inventory','warehouse',DB.warehouses.filter(w=>w.type===cfg.type).map(w=>[w.id,w.name]),'Tất cả kho')}
      ${inventoryDateRangeInputs('inventory', f)}
      ${(f.q || f.category || f.stockStatus || f.warehouse || f.dateFrom || f.dateTo) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="inventory"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span><span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(groups.length)} ${cfg.itemLabel.toLowerCase()}</span>
    </div>
    ${tableShell(
      [{t:cfg.itemLabel},{t:'Tổng số lượng',cls:'right'},{t:'Số lô',cls:'center'},{t:'HSD gần nhất'},{t:'Kho đang lưu'},{t:'Thao tác',cls:'right',w:'110px'}],
      rows, { emptyTitle: `Chưa có ${cfg.itemLabel.toLowerCase()} trong kho` })}
    ${pagiHTML('inventory', pg, cfg.itemLabel.toLowerCase())}
  </div>`;
};

function openInventoryStockLotDetail(productId, lotId) {
  const row = DB.inventory.find(r => r.productId === productId && r.lotId === lotId);
  if (!row) return;
  const material = Q.material(productId);
  const product = Q.product(productId);
  const item = material || product;
  const lot = Q.lot(lotId);
  const receipts = (DB.goodsReceipts || []).filter(r => (r.items || []).some(i => i.lotId === lotId || i.lotNumber === lot?.lotNumber));

  // Lịch sử nhập lô phải tồn tại sau F5/đổi role. Nguồn ưu tiên là phiếu nhập thật
  // (goodsReceipts); đồng thời dùng ledger inventoryTransactions làm fallback cho
  // nhập SX, nhập TP sau QC, chuyển kho vào hoặc dữ liệu cũ không có goodsReceipt.
  const receiptHistory = [];
  const receiptKeys = new Set();
  for (const r of receipts) {
    for (const i of (r.items || []).filter(i => i.lotId === lotId || i.lotNumber === lot?.lotNumber)) {
      const key = `${r.id}|${i.lotId || i.lotNumber || ''}|${Number(i.qty||0)}`;
      receiptKeys.add(key);
      receiptHistory.push({
        docId:r.id, date:r.date, ref:r.poId || r.refId || '—', qty:Number(i.qty||0),
        unit:i.unit || row.unit || item?.unit || '', source:'Phiếu nhập kho', userId:r.receivedBy || r.createdBy || ''
      });
    }
  }
  const inboundTx = (DB.inventoryTransactions || [])
    .filter(t => t.productId === productId && t.lotId === lotId && Number(t.qty || 0) > 0)
    .sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')));
  for (const t of inboundTx) {
    // Nếu ledger trùng đúng phiếu nhập đã có thì không lặp dòng.
    const duplicate = receiptHistory.some(h =>
      (h.docId === t.transactionNumber || h.docId === t.refId) && Math.abs(Number(h.qty||0)-Number(t.qty||0)) < 1e-9
    );
    if (duplicate) continue;
    receiptHistory.push({
      docId:t.transactionNumber || t.id, date:t.date, ref:t.refId || t.refType || '—', qty:Number(t.qty||0),
      unit:row.unit || item?.unit || '', source:'Sổ giao dịch kho', userId:t.userId || ''
    });
  }
  receiptHistory.sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.docId || '').localeCompare(String(a.docId || '')));

  // Tìm người đã kiểm tra đúng lô này. Ưu tiên materialInspections vì đây là dấu vết QC chi tiết.
  const inspections = (DB.materialInspections || [])
    .filter(ins => (ins.items || []).some(i => i.lotId === lotId && i.materialId === productId))
    .sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));
  const latestInspection = inspections[0] || null;
  const receiptInspection = receipts.find(r => r.inspectedBy) || null;
  const inspectorId = latestInspection?.inspectorId || receiptInspection?.inspectedBy || '';

  // Lịch sử trả NCC của đúng lô. Phiếu RETURN_OUT là chứng từ xuất trả thực tế.
  const returnIssues = (DB.goodsIssues || [])
    .filter(g => g.type === 'RETURN_OUT' && (g.items || []).some(i => i.productId === productId && i.lotId === lotId))
    .sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));

  // Lịch sử xuất/sử dụng lấy từ sổ giao dịch tồn kho vì đây mới là dấu vết xuất thực tế.
  // goodsIssues chỉ dùng để bổ sung mã phiếu/diễn giải. Cách này bao phủ cả xuất bán thành phẩm
  // và cấp hàng cửa hàng, kể cả dữ liệu cũ từng bị thiếu chứng từ goodsIssues.
  const usageTx = (DB.inventoryTransactions || [])
    .filter(t => t.productId === productId && t.lotId === lotId && Number(t.qty || 0) < 0 && t.type !== 'RETURN_OUT')
    .sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')));
  const usageRows = usageTx.map(t => {
    const gi = (DB.goodsIssues || []).find(g => g.id === t.refId || g.transferId === t.refId || ((g.items || []).some(i => i.productId===productId && i.lotId===lotId) && String(g.date||'')===String(t.date||'')));
    return { tx:t, gi };
  });

  const issuePurpose = type => ({
    PRODUCTION_ISSUE:'Xuất sản xuất', SALES_ISSUE:'Xuất bán hàng', ADJUSTMENT_OUT:'Xuất điều chỉnh',
    TRANSFER_OUT:'Xuất chuyển kho', SUBCONTRACT_ISSUE:'Xuất gia công', RETURN_OUT:'Xuất trả NCC'
  }[type] || type || 'Xuất kho');

  Modal.open({
    title: `${item?.name || productId}`,
    sub: `${productId} · Lô ${lot?.lotNumber || lotId}`,
    size: 'lg',
    body: `
      <div class="info-grid" style="margin-bottom:16px">
        ${infoItem('Số lượng tồn', `<b class="num">${fmtDec(row.qtyOnHand,3)} ${esc(row.unit || item?.unit || '')}</b>`)}
        ${infoItem('Lô hệ thống', `<span class="code">${esc(lot?.lotNumber || '—')}</span>`)}
        ${infoItem('Ngày sản xuất', lot?.mfgDate ? fmtDate(lot.mfgDate) : '—')}
        ${infoItem('Hạn sử dụng', lot?.expiryDate ? inventoryExpiryHtml(lot, { compact: false }) : '—')}
        ${infoItem('Khu', esc(Q.warehouseName(row.warehouseId)))}
        ${infoItem('Vị trí', esc(Q.locationName(row.locationId)))}
        ${infoItem('PO tham chiếu', receipts[0]?.poId ? `<span class="code">${esc(receipts[0].poId)}</span>` : '—')}
        ${infoItem('Ngày nhập gần nhất', receipts[0]?.date ? fmtDate(receipts[0].date) : fmtDate(String(row.lastUpdated||'').slice(0,10)))}
        ${infoItem('Người kiểm tra QC', inspectorId ? esc(Q.employeeName(inspectorId)) : 'Chưa kiểm tra / không áp dụng')}
        ${infoItem('Kết quả QC', latestInspection?.status ? statusLabel(latestInspection.status) : (lot?.qcStatus ? statusLabel(lot.qcStatus) : '—'))}
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-clock-rotate-left"></i>Lịch sử nhập của lô</div>
      ${tableShell([{t:'Chứng từ nhập'},{t:'Ngày'},{t:'Tham chiếu'},{t:'Số lượng',cls:'right'},{t:'Nguồn'},{t:'Người nhập'}], receiptHistory.map(h => `<tr><td><span class="code">${esc(h.docId||'—')}</span></td><td>${fmtDate(h.date)}</td><td>${h.ref && h.ref!=='—' ? `<span class="code">${esc(h.ref)}</span>` : '—'}</td><td class="right num strong">${fmtDec(h.qty,3)} ${esc(h.unit||'')}</td><td>${esc(h.source||'—')}</td><td>${esc(Q.employeeName(h.userId)||h.userId||'—')}</td></tr>`), {emptyTitle:'Chưa có lịch sử nhập được ghi nhận cho lô này'})}

      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-rotate-left"></i>Lịch sử trả nhà cung cấp</div>
      ${tableShell(
        [{t:'Phiếu trả'},{t:'Ngày'},{t:'Tham chiếu'},{t:'Số lượng trả',cls:'right'},{t:'Người lập'},{t:'Trạng thái'}],
        returnIssues.flatMap(g => (g.items||[]).filter(i=>i.productId===productId && i.lotId===lotId).map(i => `<tr><td><span class="code">${esc(g.id)}</span></td><td>${fmtDate(g.date)}</td><td>${esc(g.refDoc||g.poId||g.returnRequestId||'—')}</td><td class="right num strong">${fmtDec(i.qty,3)} ${esc(i.unit||row.unit||'')}</td><td>${esc(Q.employeeName(g.createdBy))}</td><td>${badge(g.status)}</td></tr>`)),
        {emptyTitle:'Lô này chưa phát sinh trả nhà cung cấp'}
      )}

      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-arrow-up-from-bracket"></i>Lịch sử xuất / sử dụng của lô</div>
      ${tableShell(
        [{t:'Phiếu xuất'},{t:'Ngày'},{t:'Mục đích sử dụng'},{t:'Chứng từ tham chiếu'},{t:'Số lượng',cls:'right'},{t:'Người lập'}],
        usageRows.map(({tx,gi}) => `<tr><td><span class="code">${esc(gi?.id || tx.transactionNumber || tx.refId || tx.id)}</span></td><td>${fmtDate(tx.date)}</td><td>${esc(gi?.replenishmentId||gi?.storeId?'Cấp hàng cửa hàng':issuePurpose(gi?.type||tx.type))}</td><td>${(gi?.refDoc||tx.refId) ? `<span class="code">${esc(gi?.refDoc||tx.refId)}</span>` : '—'}</td><td class="right num strong">${fmtDec(Math.abs(Number(tx.qty||0)),3)} ${esc(row.unit||item?.unit||'')}</td><td>${esc(Q.employeeName(gi?.confirmedBy||gi?.createdBy||tx.userId))}</td></tr>`),
        {emptyTitle:'Lô này chưa phát sinh xuất kho / sử dụng'}
      )}`,
    foot: '<button class="btn" data-act="modal-close">Đóng</button>'
  });
}

Views.warehouse = function () {
  const tab = State.tab || 'dashboard';
  switch (tab) {

    case 'dashboard':
      return Views['inv-overview']
        ? Views['inv-overview']()
        : '';

    case 'inventory':
      return Views.inventory
        ? Views.inventory()
        : '';

    case 'warehouse_view':
      return Views['inv-warehouse-browser']
        ? Views['inv-warehouse-browser']()
        : '';

    case 'receipts':
      return Views['inv-receipts']
        ? Views['inv-receipts']()
        : '';

    case 'issues':
      return Views['inv-issues']
        ? Views['inv-issues']()
        : '';

    case 'transfers':
      return Views['inv-transfers']
        ? Views['inv-transfers']()
        : '';

    case 'stocktake':
      return Views['inv-counts']
        ? Views['inv-counts']()
        : '';

    case 'batches':
      return Views['inv-lots']
        ? Views['inv-lots']()
        : '';

    case 'defects':
      return Views['inv-defects']
        ? Views['inv-defects']()
        : '';

    case 'locations':
      return Views['inv-warehouses']
        ? Views['inv-warehouses']()
        : '';

    case 'alerts':
      return Views['inv-alerts']
        ? Views['inv-alerts']()
        : '';

    default:
      return '';
  }
};

/** Modal Xem Chi tiết Đơn đặt hàng PO */

/** Modal Nhập kho nguyên vật liệu từ PO (Hỗ trợ Nhập kho từng phần - Partial Receipt) */

/** Modal Ghi nhận Thanh toán Công nợ Nhà cung cấp */

/* ============================================================================
 * MODULE: PHÂN HỆ KHO (INVENTORY)
 * inv-overview | inv-receipts | inv-issues | inv-transfers | inv-counts | inv-lots
 * ==========================================================================*/

/* ------------- Màn 1: TỔNG QUAN TỒN KHO --------------------------------- */
Views['inv-overview'] = function () {
  const f = F('inv-overview', { q: '', warehouseId: '', status: '', dateFrom: '', dateTo: '' });
  const q = (f.q || '').toLowerCase().trim();
  const today = new Date(DB.today + 'T00:00:00');
  const nearDays = DB.inventoryAlertConfig.nearExpiryDays;

  // [DASHBOARD CONSISTENCY] KPI lấy cùng nguồn DB.inventory đang dùng để
  // render bảng tồn thực tế. Không dùng material.stock/value cache vì có thể lệch
  // sau nhập kho/QC/chuyển kho hoặc khi vừa refresh từ server.
  const inventoryRows = DB.inventory || [];
  const inventoryRowsScope = inventoryRows.filter((row) => inventoryInDateRange(row.lastUpdated, f.dateFrom, f.dateTo));
  const totalSKU = new Set(inventoryRowsScope.filter(i => Number(i.qtyOnHand || 0) !== 0).map((i) => i.productId)).size;
  const totalOnHand = inventoryRowsScope.reduce((s, i) => s + Number(i.qtyOnHand || 0), 0);
  const inventoryVal = inventoryRowsScope.reduce((sum, row) => {
    const master = (DB.materials || []).find(m => m.id === row.productId) || (DB.products || []).find(p => p.id === row.productId);
    return sum + Number(row.qtyOnHand || 0) * Number(master?.price || 0);
  }, 0);
  const scopeProductIds = new Set(inventoryRowsScope.map((row) => row.productId));
  const scopeLotIds = new Set(inventoryRowsScope.map((row) => row.lotId).filter(Boolean));
  const lowStockCnt = Q.lowStockAlerts().filter((x) => !f.dateFrom && !f.dateTo ? true : scopeProductIds.has(x.material?.id)).length;
  const nearExpiryCnt = Q.nearExpiryLots().filter((lot) => !f.dateFrom && !f.dateTo ? true : scopeLotIds.has(lot.id)).length;
  const expiredCnt = Q.expiredLots().filter((lot) => !f.dateFrom && !f.dateTo ? true : scopeLotIds.has(lot.id)).length;

  // Lọc danh sách tồn kho
  const list = DB.inventory.filter((inv) => {
    if (f.warehouseId && inv.warehouseId !== f.warehouseId) return false;
    if (!inventoryInDateRange(inv.lastUpdated, f.dateFrom, f.dateTo)) return false;
    const lot = DB.inventoryLots.find((l) => l.id === inv.lotId);
    const mat = DB.materials.find((m) => m.id === inv.productId) || DB.products.find((p) => p.id === inv.productId);
    if (q && ![(mat ? mat.name : ''), inv.productId, inv.warehouseId, inv.locationId].some((v) => String(v).toLowerCase().includes(q))) return false;
    const exp = lot ? new Date(lot.expiryDate + 'T00:00:00') : null;
    if (f.status === 'near_expiry') return exp && exp >= today && (exp - today) / 86400000 <= nearDays;
    if (f.status === 'expired') return exp && exp < today;
    if (f.status === 'low_stock') {
      const m = DB.materials.find((x) => x.id === inv.productId);
      const actual = inventoryRows.filter(r => r.productId === inv.productId).reduce((sum,r)=>sum+Number(r.qtyOnHand||0),0);
      return m && actual < Number(m.minStock || 0);
    }
    return true;
  });
  const pg = paged(list, 'inv-overview');

  const warehouses = DB.warehouses.map((w) => [w.id, w.name]);

  const rows = pg.items.map((inv) => {
    const lot = DB.inventoryLots.find((l) => l.id === inv.lotId);
    const mat = DB.materials.find((m) => m.id === inv.productId) || DB.products.find((p) => p.id === inv.productId);
    const wh = DB.warehouses.find((w) => w.id === inv.warehouseId);
    const loc = DB.warehouseLocations.find((l) => l.id === inv.locationId);
    const exp = lot ? new Date(lot.expiryDate + 'T00:00:00') : null;
    const daysLeft = exp ? Math.round((exp - today) / 86400000) : null;
    let expBadge = '';
    if (exp) {
      if (daysLeft < 0) expBadge = `<span class="badge red">Hết hạn ${Math.abs(daysLeft)} ngày</span>`;
      else if (daysLeft <= nearDays) expBadge = `<span class="badge orange">Còn ${daysLeft} ngày</span>`;
      else expBadge = `<span class="badge green">Còn ${daysLeft} ngày</span>`;
    }
    return `<tr class="clickable" data-act="inv-lot-detail" data-lotid="${inv.lotId}">
      <td><span class="code">${inv.productId}</span></td>
      <td>${cell2(esc(mat ? mat.name : inv.productId), '')}</td>
      <td><span class="chip">${esc(wh ? wh.name : inv.warehouseId)}</span></td>
      <td class="muted" style="font-size:12px">${esc(loc ? loc.name : inv.locationId)}</td>
      <td>${lot ? `<span class="code" style="font-size:11px">${lot.lotNumber}</span>` : '—'}</td>
      <td class="num">${lot ? fmtDate(lot.mfgDate) : '—'}</td>
      <td>${expBadge || (lot ? fmtDate(lot.expiryDate) : '—')}</td>
      <td class="right strong num">${fmtDec(inv.qtyOnHand, 2)} ${esc(inv.unit)}</td>
      <td class="right num muted">${fmtDec(inv.qtyReserved, 2)}</td>
      <td class="right strong num" style="color:${inv.qtyAvailable <= 0 ? 'var(--red)' : 'var(--green)'}">${fmtDec(inv.qtyAvailable, 2)}</td>
    </tr>`;
  });

  return `
  ${pageHead('Tổng quan tồn kho', `${totalSKU} SKU · Tổng tồn ${fmtShort(inventoryVal)}`, `
    <button class="btn" data-act="inv-export-stock"><i class="fa-solid fa-file-export"></i>Xuất Excel</button>
    <button class="btn btn-primary" data-act="inv-new-receipt"><i class="fa-solid fa-plus"></i>Lập phiếu nhập</button>
  `)}
  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng SKU', totalSKU, 'fa-boxes-stacked', 'blue', 'warehouse-dashboard-open-inventory')}
    ${mkpi('Tồn kho thực tế', fmtN(totalOnHand), 'fa-warehouse', 'teal', 'warehouse-dashboard-open-inventory')}
    ${mkpi('Giá trị tồn kho', fmtShort(inventoryVal), 'fa-sack-dollar', 'indigo', 'warehouse-dashboard-open-inventory')}
    ${mkpi('Dưới tồn tối thiểu', lowStockCnt, 'fa-triangle-exclamation', 'orange', 'warehouse-dashboard-open-low')}
    ${mkpi('Lô cận hạn ≤' + nearDays + ' ngày', nearExpiryCnt, 'fa-calendar-minus', 'orange', 'warehouse-dashboard-open-near-expiry')}
    ${mkpi('Lô đã hết hạn', expiredCnt, 'fa-circle-xmark', 'red', 'warehouse-dashboard-open-expired')}
  </div>

  ${expiredCnt > 0 ? `
  <div class="alert-item" style="border-color:var(--red);background:var(--red-soft);margin-bottom:14px">
    <span class="alert-ico t-red"><i class="fa-solid fa-circle-xmark"></i></span>
    <span style="min-width:0">
      <span class="alert-title" style="color:var(--red)">CÓ ${expiredCnt} LÔ ĐÃ HẾT HẠN SỬ DỤNG</span>
      <div class="alert-sub">Cần xử lý ngay — chuyển sang kho hàng lỗi hoặc tiêu hủy theo quy trình</div>
    </span>
    <button class="btn btn-sm" data-act="inv-tab" data-tab="lots" style="flex-shrink:0">Xem lô hết hạn</button>
  </div>` : ''}

  <div class="card">
    <div class="toolbar">
      ${searchBox('inv-overview', 'Tìm mã hàng, tên hàng, kho…')}
      ${selectFilter('inv-overview', 'warehouseId', warehouses, 'Tất cả kho')}
      ${selectFilter('inv-overview', 'status', [['near_expiry', '⚠ Cận hạn'], ['expired', '❌ Hết hạn'], ['low_stock', '⬇ Dưới tồn min']], 'Tất cả tình trạng')}
      ${inventoryDateRangeInputs('inv-overview', f)}
      ${(f.q || f.warehouseId || f.status || f.dateFrom || f.dateTo) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="inv-overview"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} bản ghi</span>
    </div>
    ${tableShell(
      [{ t: 'Mã hàng', w: '90px' }, { t: 'Tên hàng' }, { t: 'Kho' }, { t: 'Vị trí', cls: 'hide-sm' },
       { t: 'Lô hệ thống', cls: 'hide-sm' }, { t: 'NSX' }, { t: 'HSD / Còn lại' },
       { t: 'On Hand', cls: 'right' }, { t: 'Reserved', cls: 'right hide-sm' }, { t: 'Available', cls: 'right' }],
      rows, { emptyTitle: 'Không có dữ liệu tồn kho', emptyDesc: 'Hãy nhập kho để bắt đầu theo dõi tồn kho.' })}
    ${pagiHTML('inv-overview', pg, 'bản ghi')}
  </div>`;
};

/* ------------- Màn 2: NHẬP KHO ------------------------------------------ */
Views['inv-receipts'] = function () {
  const f = F('inv-receipts', { q: '', status: '', supplier: '', receiptTab: 'raw', dateFrom: '', dateTo: '' });
  const q = (f.q || '').toLowerCase().trim();
  const receiptTab = f.receiptTab || 'raw';
  const cfgs = {
    raw: { label:'Kho nguyên liệu', type:'RAW_MATERIAL', icon:'fa-seedling' },
    semi:{ label:'Kho bán thành phẩm', type:'SEMI_FINISHED', icon:'fa-cubes-stacked' },
    finished:{ label:'Kho thành phẩm', type:'FINISHED_GOODS', icon:'fa-box' }
  };
  const cfg = cfgs[receiptTab] || cfgs.raw;
  const whIds = new Set(DB.warehouses.filter(w=>w.type===cfg.type).map(w=>w.id));
  let rowsData = [];
  if (receiptTab === 'raw') {
    rowsData = DB.purchaseOrders.filter(po => ['SHIPPING','PARTIAL_RECEIVED','RECEIVED'].includes(po.status)).map(po => {
      const receipts = Q.receiptsOfPo(po.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
      const ordered = (po.items||[]).reduce((n,i)=>n+Number(i.qty||0),0);
      const received = (po.items||[]).reduce((n,i)=>n+Number(i.receivedQty||0),0);
      const defectReceipts = receipts.filter(r=>['FAILED','PARTIAL_FAILED'].includes(r.inspectionStatus));
      const defectNote = defectReceipts.some(r=>r.defectType==='FULL_LOT') ? 'Lỗi nguyên lô' : defectReceipts.length ? 'Lỗi 1 phần' : '';
      return { kind:'po', id:po.id, po, receipts, ordered, received, defectNote, date:receipts[0]?.date || po.expectedDate || po.date };
    });
  } else {
    rowsData = (DB.goodsReceipts||[]).filter(r=>whIds.has(r.warehouseId)).map(r=>({kind:'receipt',id:r.id,r,date:r.date}));
    // Hàng gia công sau QC được chuyển cho Kho nhập, tương tự thành phẩm sản xuất.
    if (receiptTab === 'finished' && typeof subcontractV3Orders === 'function') {
      subcontractV3Orders().forEach(o => {
        const receipts = typeof subcontractV3Receipts === 'function' ? subcontractV3Receipts(o) : (o.receipts||[]);
        receipts.filter(r=>r.qcStatus==='DONE' && !r.warehoused).forEach(r=>rowsData.push({kind:'subcontract_receipt',id:r.id,o,r,date:r.qcAt?String(r.qcAt).slice(0,10):(r.date||DB.today)}));
      });
    }
  }
  rowsData = rowsData.filter(x=>{
    if (!inventoryInDateRange(x.date, f.dateFrom, f.dateTo)) return false;
    const text = x.kind==='po'
      ? [x.po.id,x.po.prId,Q.supplierName(x.po.supplierId),x.defectNote].join(' ')
      : x.kind==='subcontract_receipt'
        ? [x.r.id,x.o.id,x.o.partner,Q.product(x.o.productId)?.name,'gia công','chờ nhập kho'].join(' ')
        : [x.r.id,x.r.poId,x.r.note,Q.warehouseName(x.r.warehouseId)].join(' ');
    if (q && !text.toLowerCase().includes(q)) return false;
    if (receiptTab === 'raw' && x.kind === 'po') {
      if (f.status && x.po.status !== f.status) return false;
      if (f.supplier && x.po.supplierId !== f.supplier) return false;
    }
    return true;
  }).sort((a,b)=>{
    const hasFilter = Boolean(q || f.status || f.supplier);
    // Mặc định: giữ thứ tự cố định theo mã PO / mã phiếu, không bị thay đổi sau khi nhập kho.
    if (!hasFilter) return String(b.id||'').localeCompare(String(a.id||''), 'vi', { numeric:true, sensitivity:'base' });
    // Khi người dùng lọc/tìm kiếm, ưu tiên bản ghi có hoạt động mới hơn trong tập kết quả.
    const byDate = String(b.date||'').localeCompare(String(a.date||''));
    if (byDate) return byDate;
    return String(a.id||'').localeCompare(String(b.id||''), 'vi', { numeric:true, sensitivity:'base' });
  });
  const pg = paged(rowsData,'inv-receipts');
  const rows = pg.items.map(x=>{
    if (x.kind==='po') {
      const po=x.po; const canReceipt=['SHIPPING','PARTIAL_RECEIVED'].includes(po.status) && x.received < x.ordered;
      return `<tr>
        <td><span class="code">${po.id}</span><div class="cell-sub">${esc(po.prId||'')}</div></td>
        <td>${cell2(esc(Q.supplierName(po.supplierId)),esc((po.items||[]).map(i=>i.name).join(', ')))}</td>
        <td class="right num">${fmtN(x.received)} / ${fmtN(x.ordered)}</td>
        <td>${badge(po.status)}${x.defectNote?`<div style="margin-top:5px"><span class="badge red">${x.defectNote}</span></div>`:''}</td>
        <td class="num">${x.receipts[0]?fmtDate(x.receipts[0].date):'—'}</td>
        <td class="center">${x.receipts.length}</td>
        <td class="right">${rowActions([
          {act:'inv-po-receipt-history',data:`data-id="${po.id}"`,icon:'fa-eye',title:'Xem chi tiết'},
          ...(canReceipt?[{act:'inv-new-receipt',data:`data-poid="${po.id}"`,icon:'fa-file-circle-plus',title:'Lập phiếu nhập'}]:[])
        ])}</td>
      </tr>`;
    }
    if (x.kind==='subcontract_receipt') {
      const r=x.r,o=x.o,p=Q.product(o.productId);
      return `<tr class="clickable" data-act="subcontracting-open" data-id="${esc(o.id)}"><td>${cell2(`<span class="code">${esc(r.id)}</span>`,`<span class="code">${esc(o.id)}</span> · Gia công`)}</td><td>${fmtDate(x.date)}</td><td>${cell2('Kho thành phẩm','Chờ Kho xác nhận nhập')}</td><td>${cell2(esc(p?.name||o.productId),`QC đạt ${fmtN(r.goodQty||0)} · lỗi ${fmtN(r.defectQty||0)} ${esc(p?.unit||'')}`)}</td><td>QC/QA</td><td><span class="badge orange">Chờ nhập kho</span></td><td class="right">${rowActions([{act:'subcontracting-warehouse',data:`data-id="${esc(o.id)}" data-receipt="${esc(r.id)}"`,icon:'fa-warehouse',title:'Nhập kho hàng gia công'}])}</td></tr>`;
    }
    const r=x.r;
    return `<tr><td><span class="code">${r.id}</span></td><td>${fmtDate(r.date)}</td><td>${cell2(esc(Q.warehouseName(r.warehouseId)),esc(Q.locationName(r.locationId)))}</td><td>${esc((r.items||[]).map(i=>`${i.name||i.materialId}: ${fmtN(i.qty)} ${i.unit||''}`).join(', '))}</td><td>${esc(Q.employeeName(r.receivedBy))}</td><td>${badge(r.status)}</td><td></td></tr>`;
  });
  return `${pageHead('Nhập kho','Danh sách nhập kho theo từng loại kho; thao tác được thực hiện trực tiếp tại từng dòng',`
    <button class="btn" data-act="inv-export-receipts"><i class="fa-solid fa-file-export"></i>Xuất Excel</button>
    ${inventoryCanOperate() ? `<button class="btn btn-primary" data-act="inv-new-receipt" data-tab="${receiptTab}"><i class="fa-solid fa-plus"></i>${receiptTab==='raw'?'Phiếu nhập kho nguyên liệu':receiptTab==='semi'?'Phiếu nhập kho bán thành phẩm':'Phiếu nhập kho thành phẩm'}</button>` : ''}`)}
    <div class="tabs" style="margin-bottom:14px">
      <button class="tab ${receiptTab==='raw'?'active':''}" data-act="inventory-receipt-tab" data-tab="raw"><i class="fa-solid fa-seedling"></i>Kho nguyên liệu</button>
      <button class="tab ${receiptTab==='finished'?'active':''}" data-act="inventory-receipt-tab" data-tab="finished"><i class="fa-solid fa-box"></i>Kho thành phẩm</button>
    </div>
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Chứng từ / PO', rowsData.length, 'fa-file-arrow-down', 'blue', 'inventory-receipts-all')}
      ${mkpi('Đã nhận đủ', receiptTab==='raw' ? rowsData.filter(x=>x.kind==='po' && x.po.status==='RECEIVED').length : rowsData.filter(x=>x.kind==='receipt').length, 'fa-circle-check', 'green', 'inventory-receipts-received')}
      ${mkpi(receiptTab==='finished'?'Chờ nhập kho':'Nhận một phần', receiptTab==='finished' ? rowsData.filter(x=>x.kind==='subcontract_receipt').length : (receiptTab==='raw' ? rowsData.filter(x=>x.kind==='po' && x.po.status==='PARTIAL_RECEIVED').length : 0), 'fa-box-open', 'orange', 'inventory-receipts-partial')}
      ${mkpi('Tổng SL đã nhập', fmtN(rowsData.reduce((sum,x)=>sum+(x.kind==='po'?Number(x.received||0):x.kind==='subcontract_receipt'?0:(x.r.items||[]).reduce((n,i)=>n+Number(i.qty||0),0)),0)), 'fa-boxes-stacked', 'teal')}
    </div>
    <div class="card"><div class="toolbar">${searchBox('inv-receipts','Tìm PO, phiếu nhập, NCC, khu…')}
      ${receiptTab==='raw' ? `${selectFilter('inv-receipts','status',[['SHIPPING','Đang giao hàng'],['PARTIAL_RECEIVED','Nhận một phần'],['RECEIVED','Đã nhận đủ']],'Tất cả trạng thái')}${selectFilter('inv-receipts','supplier',DB.suppliers.map(s=>[s.id,s.name]),'Tất cả NCC')}` : ''}
      ${inventoryDateRangeInputs('inv-receipts', f)}
      ${(f.q||f.status||f.supplier||f.dateFrom||f.dateTo)?'<button class="btn btn-sm" data-act="clear-filter" data-key="inv-receipts"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}
      <span class="spacer"></span><span class="chip">${fmtN(rowsData.length)} dòng</span></div>
    ${receiptTab==='raw' ? tableShell([{t:'Mã PO'},{t:'NCC / Nguyên liệu'},{t:'Đã nhập / Đặt',cls:'right'},{t:'Trạng thái / QC'},{t:'Nhập gần nhất'},{t:'Số đợt',cls:'center'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có đơn hàng nhập kho'}) : tableShell([{t:'Phiếu nhập'},{t:'Ngày'},{t:'Khu / Kệ'},{t:'Nội dung'},{t:'Người nhập'},{t:'Trạng thái'},{t:'Thao tác'}],rows,{emptyTitle:`Chưa có dữ liệu ${cfg.label.toLowerCase()}`})}
    ${pagiHTML('inv-receipts',pg,'dòng')}</div>`;
};

/* ------------- Màn 3: XUẤT KHO ------------------------------------------ */
Views['inv-issues'] = function () {
  const f = F('inv-issues', { q:'', type:'', kind:'', issueTab:'raw', dateFrom:'', dateTo:'' });
  const q=(f.q||'').toLowerCase().trim();
  const issueTab=(f.issueTab==='production_requests'?'raw':(f.issueTab||'raw'));
  if(f.issueTab==='production_requests') f.issueTab='raw';
  const cfgs={raw:{label:'Kho nguyên liệu',type:'RAW_MATERIAL',icon:'fa-seedling'},semi:{label:'Kho bán thành phẩm',type:'SEMI_FINISHED',icon:'fa-cubes-stacked'},finished:{label:'Kho thành phẩm',type:'FINISHED_GOODS',icon:'fa-box'}};
  const cfg=cfgs[issueTab]||cfgs.raw;
  const whIds=new Set(DB.warehouses.filter(w=>w.type===cfg.type).map(w=>w.id));
  const ISSUE_TYPES={PRODUCTION_ISSUE:'Xuất sản xuất',SUBCONTRACT_ISSUE:'Xuất gia công',SALES_ISSUE:'Xuất bán hàng',ADJUSTMENT_OUT:'Xuất điều chỉnh',TRANSFER_OUT:'Xuất chuyển kho',DEFECTIVE_ISSUE:'Xuất hàng lỗi',RETURN_OUT:'Xuất trả NCC'};
  // Ở tab Kho nguyên liệu, ưu tiên tên nguyên liệu thay vì mã để người dùng dễ nhận biết.
  // Nếu tổng tồn khả dụng tại toàn bộ Kho nguyên liệu đã hết, tên được tô đỏ để cảnh báo ngay trên danh sách xuất.
  const rawAvailableQty=(productId)=>(DB.inventory||[]).filter(r=>whIds.has(r.warehouseId)&&r.productId===productId).reduce((sum,r)=>sum+Number(r.qtyAvailable??r.qtyOnHand??0),0);
  const issueItemLabel=(productId,qty,unit='',lotId='',warnOut=false)=>{
    const item=Q.material(productId)||Q.product(productId); const name=item?.name||productId;
    const available=rawAvailableQty(productId);
    // Chỉ các yêu cầu xuất chưa hoàn tất mới cảnh báo thiếu.
    // Thiếu = tồn khả dụng của toàn bộ kho nguyên liệu < số lượng đang yêu cầu xuất.
    const shortage=warnOut&&issueTab==='raw'&&available<Number(qty||0);
    const lot=lotId?Q.lot(lotId):null;
    return `<span ${shortage?'style="font-weight:700"':''}>${esc(name)}</span><div class="cell-sub" ${shortage?'style="font-weight:700"':''}>${fmtDec(qty,3)} ${esc(unit||item?.unit||'')}${lotId?` · Lô ${esc(lot?.lotNumber||lotId)}`:''}</div>`;
  };
  let entries=(DB.goodsIssues||[]).filter(gi=>whIds.has(gi.warehouseId)).map(gi=>({kind:'issue',date:gi.date,id:gi.id,gi}));
  if(issueTab==='raw') {
    entries.push(...(DB.materialReturnRequests||[]).filter(r=>r.status==='PENDING_WAREHOUSE').map(r=>({kind:'return',date:r.requestedDate,id:r.id,r})));
    // Yêu cầu NVL sản xuất là một nguồn yêu cầu xuất của Kho nguyên liệu,
    // nên hiển thị ngay trong tab này thay vì tách thành một màn riêng.
    entries.push(...(DB.productionMaterialRequests||[]).map(r=>({kind:'production_request',date:r.date||String(r.createdAt||'').slice(0,10),id:r.id,r})));
    // Đơn gia công đã duyệt trở thành yêu cầu xuất NVL của Kho nguyên liệu.
    // Sau khi đã xuất nhưng chưa giao đối tác, dòng vẫn ở đây để Kho xác nhận giao.
    if(typeof subcontractV3Orders==='function') {
      entries.push(...subcontractV3Orders()
        .filter(o=>['APPROVED','MATERIAL_ISSUED'].includes(o.status))
        .map(o=>({kind:'subcontract_request',date:o.issueDate||String(o.approvedAt||'').slice(0,10)||DB.today,id:o.id,o})));
    }
  }
  entries=entries.filter(x=>{
    if(!inventoryInDateRange(x.date, f.dateFrom, f.dateTo)) return false;
    if(f.kind && x.kind !== f.kind) return false;
    if(f.type && x.kind==='issue' && x.gi.type!==f.type) return false;
    if(f.type && x.kind==='return' && f.type!=='RETURN_OUT') return false;
    if(f.type && x.kind==='production_request' && f.type!=='PRODUCTION_ISSUE') return false;
    if(f.type && x.kind==='subcontract_request' && f.type!=='SUBCONTRACT_ISSUE') return false;
    const text=x.kind==='issue'
      ? [x.gi.id,x.gi.refDoc,x.gi.note,ISSUE_TYPES[x.gi.type]].join(' ')
      : x.kind==='production_request'
        ? [x.r.id,x.r.planId,x.r.productionOrderId,x.r.note,'Yêu cầu NVL sản xuất',...(x.r.items||[]).map(i=>`${i.materialId} ${Q.material(i.materialId)?.name||''}`)].join(' ')
        : x.kind==='subcontract_request'
          ? [x.o.id,x.o.partner,Q.product(x.o.productId)?.name,'Yêu cầu xuất NVL gia công'].join(' ')
          : [x.r.id,x.r.poId,Q.supplierName(x.r.supplierId),x.r.reason].join(' ');
    return !q||text.toLowerCase().includes(q);
  }).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const pg=paged(entries,'inv-issues');
  const rows=pg.items.map(x=>{
    if(x.kind==='subcontract_request'){
      const o=x.o;
      const lines=typeof subcontractBomLines==='function' ? subcontractBomLines(o) : [];
      const acts=[{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết đơn gia công'}];
      if(o.status==='APPROVED') acts.push({act:'subcontracting-issue',data:`data-id="${esc(o.id)}"`,icon:'fa-arrow-up-from-bracket',title:'Xuất NVL gia công'});
      if(o.status==='MATERIAL_ISSUED') acts.push({act:'subcontracting-handover',data:`data-id="${esc(o.id)}"`,icon:'fa-handshake',title:'Xác nhận giao đối tác'});
      const materials=lines.map(i=>issueItemLabel(i.materialId,i.qty,Q.material(i.materialId)?.unit||'','',o.status==='APPROVED')).join('<br>');
      return `<tr><td><span class="code">${esc(o.id)}</span><div class="cell-sub">Yêu cầu NVL gia công</div></td><td><span class="badge indigo">Xuất gia công</span></td><td>${fmtDate(x.date)}</td><td>Kho nguyên liệu</td><td>${esc(o.partner||'—')}</td><td>${materials||'Theo BOM'}</td><td class="right num">—</td><td>${o.status==='APPROVED'?'<span class="badge orange">Chờ xuất NVL</span>':'<span class="badge blue">Đã xuất · chờ giao đối tác</span>'}</td><td class="right">${rowActions(acts)}</td></tr>`;
    }
    if(x.kind==='production_request'){
      const r=x.r;
      const total=(r.items||[]).reduce((n,i)=>n+Number(i.qty||0),0);
      const source=r.productionOrderId ? `LSX ${r.productionOrderId}` : `Kế hoạch ${r.planId||'—'}`;
      const acts=[{act:'pf-mr-view',data:`data-id="${esc(r.id)}"`,icon:'fa-eye',title:'Xem chi tiết yêu cầu NVL'}];
      if(['WAITING_WAREHOUSE_APPROVAL','APPROVED'].includes(r.status)) acts.push({act:'pf-mr-issue',data:`data-id="${esc(r.id)}"`,icon:'fa-arrow-up-from-bracket',title:'Xuất NVL cho sản xuất'});
      return `<tr><td><span class="code">${esc(r.id)}</span><div class="cell-sub">Yêu cầu NVL sản xuất</div></td><td><span class="badge blue">Xuất sản xuất</span></td><td>${fmtDate(r.date)}</td><td>Kho nguyên liệu</td><td><span class="code">${esc(source)}</span></td><td>${(r.items||[]).map(i=>issueItemLabel(i.materialId,i.qty,Q.material(i.materialId)?.unit||'','',['WAITING_WAREHOUSE_APPROVAL','APPROVED'].includes(r.status))).join('<br>')||'—'}</td><td class="right num">${fmtDec(total,3)}</td><td>${pfRequestStatus(r.status)}</td><td class="right">${rowActions(acts)}</td></tr>`;
    }
    if(x.kind==='return'){
      const r=x.r;const lot=Q.lot(r.lotId);
      return `<tr><td><span class="code">${esc(r.id)}</span><div class="cell-sub">Yêu cầu trả</div></td><td><span class="badge red">Chờ xuất trả NCC</span></td><td>${fmtDate(r.requestedDate)}</td><td>${esc(Q.warehouseName(r.warehouseId))}</td><td><span class="code">${esc(r.poId)}</span></td><td>${cell2(esc(Q.material(r.materialId)?.name||r.materialId),`Lô HT: ${esc(lot?.lotNumber||'—')}`)}</td><td class="right strong num">${fmtN(r.qty)} ${esc(r.unit||'')}</td><td><span class="badge orange">Chờ kho xác nhận</span></td><td class="right">${rowActions([{act:'open-po',data:`data-id="${r.poId}"`,icon:'fa-eye',title:'Xem chi tiết đơn hàng'},{act:'inv-return-confirm-issue',data:`data-id="${r.id}"`,icon:'fa-arrow-right-from-bracket',title:'Xác nhận xuất trả'}])}</td></tr>`;
    }
    const gi=x.gi;const total=(gi.items||[]).reduce((n,i)=>n+Number(i.qty||0),0);
    const pendingSales = gi.type==='SALES_ISSUE' && gi.status==='PENDING_CONFIRMATION';
    const oqc = salesIssueQcStatus(gi);
    const statusHtml = pendingSales ? (oqc==='PASSED' ? '<span class="badge orange">Chờ xác nhận xuất</span><div class="cell-sub">QC đạt</div>' : oqc==='FAILED' ? '<span class="badge red">QC không đạt</span>' : '<span class="badge purple">Chờ QC xuất kho</span>') : badge(gi.status);
    const acts=[{act:'inv-issue-view',data:`data-id="${gi.id}"`,icon:'fa-eye',title:'Xem chi tiết'}];
    if(pendingSales && oqc==='PASSED') acts.push({act:'inv-sales-issue-confirm',data:`data-id="${gi.id}"`,icon:'fa-circle-check',title:'Xác nhận xuất kho'});
    if(pendingSales && oqc==='FAILED') acts.push({act:'oqc-request-recheck',data:`data-id="${gi.id}"`,icon:'fa-rotate-right',title:'Yêu cầu QC kiểm tra lại'});
    return `<tr><td><span class="code">${esc(gi.id)}</span>${pendingSales?'<div class="cell-sub">Yêu cầu từ đơn bán</div>':''}</td><td><span class="badge blue">${esc(ISSUE_TYPES[gi.type]||gi.type)}</span></td><td>${fmtDate(gi.date)}</td><td>${esc(Q.warehouseName(gi.warehouseId))}</td><td><span class="code">${esc(gi.refDoc||'—')}</span></td><td>${(gi.items||[]).map(i=>issueItemLabel(i.productId,i.qty,i.unit||'',i.lotId||'')).join('<br>')||'—'}</td><td class="right num">${fmtDec(total,3)}</td><td>${statusHtml}</td><td class="right">${rowActions(acts)}</td></tr>`;
  });
  return `${pageHead('Xuất kho','Danh sách phiếu và yêu cầu xuất được quản lý chung theo từng loại kho',`
    <button class="btn" data-act="inv-export-issues"><i class="fa-solid fa-file-export"></i>Xuất Excel</button>
    <button class="btn btn-primary" data-act="inv-new-issue" data-tab="${issueTab}"><i class="fa-solid fa-plus"></i>Lập phiếu xuất ${cfg.label.toLowerCase()}</button>`)}
    <div class="tabs" style="margin-bottom:14px">
      <button class="tab ${issueTab==='raw'?'active':''}" data-act="inventory-issue-tab" data-tab="raw"><i class="fa-solid fa-seedling"></i>Kho nguyên liệu</button>
      <button class="tab ${issueTab==='finished'?'active':''}" data-act="inventory-issue-tab" data-tab="finished"><i class="fa-solid fa-box"></i>Kho thành phẩm</button>
    </div>
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng chứng từ', entries.length, 'fa-file-arrow-up', 'blue', 'inventory-issues-all')}
      ${issueTab==='finished' ? mkpi('Chờ xác nhận xuất (QC đạt)', entries.filter(x=>x.kind==='issue' && x.gi.type==='SALES_ISSUE' && x.gi.status==='PENDING_CONFIRMATION' && salesIssueQcStatus(x.gi)==='PASSED').length, 'fa-hourglass-half', 'orange') : mkpi('Chờ trả NCC', entries.filter(x=>x.kind==='return').length, 'fa-rotate-left', 'orange', 'inventory-issues-return')}
      ${mkpi('Đã hoàn tất xuất', entries.filter(x=>x.kind==='issue' && x.gi.status==='COMPLETED').length, 'fa-circle-check', 'green', 'inventory-issues-posted')}
      ${mkpi('Tổng SL xuất', fmtDec(entries.reduce((sum,x)=>{ if(x.kind==='return') return sum+Number(x.r?.qty||0); if(x.kind==='production_request') return sum+(x.r?.items||[]).reduce((n,i)=>n+Number(i.qty||0),0); if(x.kind==='subcontract_request') return sum; return sum+(x.gi?.items||[]).reduce((n,i)=>n+Number(i.qty||0),0); },0),3), 'fa-boxes-stacked', 'teal')}
    </div>
    <div class="card"><div class="toolbar">${searchBox('inv-issues','Tìm phiếu, PO, chứng từ tham chiếu…')}${selectFilter('inv-issues','kind',[['production_request','Yêu cầu NVL sản xuất'],['subcontract_request','Yêu cầu NVL gia công'],['issue','Đã lập phiếu xuất'],['return','Chờ xuất trả NCC']],'Tất cả chứng từ')}${selectFilter('inv-issues','type',Object.entries(ISSUE_TYPES).map(([k,v])=>[k,v]),'Tất cả loại xuất')}${inventoryDateRangeInputs('inv-issues', f)}${(f.q||f.kind||f.type||f.dateFrom||f.dateTo)?'<button class="btn btn-sm" data-act="clear-filter" data-key="inv-issues"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}<span class="spacer"></span><span class="chip">${fmtN(entries.length)} dòng</span></div>
    ${tableShell([{t:'Phiếu / Yêu cầu'},{t:'Loại'},{t:'Ngày'},{t:'Khu xuất'},{t:'Tham chiếu'},{t:'Hàng hóa / Lô'},{t:'Số lượng',cls:'right'},{t:'Trạng thái'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:`Chưa có dữ liệu xuất tại ${cfg.label.toLowerCase()}`})}
    ${pagiHTML('inv-issues',pg,'dòng')}</div>`;
};

/* ------------- Màn 4: CHUYỂN KHO ----------------------------------------- */
Views['inv-transfers'] = function () {
  const TYPE_META = {
    RAW_MATERIAL: { label: 'Chuyển kho nguyên liệu', short: 'Nguyên liệu', icon: 'fa-seedling' },
    SEMI_FINISHED: { label: 'Chuyển kho bán thành phẩm', short: 'Bán thành phẩm', icon: 'fa-layer-group' },
    FINISHED_GOODS: { label: 'Chuyển kho thành phẩm', short: 'Thành phẩm', icon: 'fa-box' },
    STORE: { label: 'Cấp hàng cửa hàng', short: 'Cửa hàng', icon: 'fa-store' },
  };
  if (!['RAW_MATERIAL','FINISHED_GOODS'].includes(State.invTransferType)) State.invTransferType = 'RAW_MATERIAL';
  const activeType = State.invTransferType;
  const meta = TYPE_META[activeType];
  const f = F('inv-transfers', { q: '', status: '', dateFrom: '', dateTo: '' });
  const q = (f.q || '').toLowerCase().trim();
  const inferType = (t) => t.transferType || (Q.warehouse(t.fromWarehouseId)?.type || 'RAW_MATERIAL');
  const typedTransfers = DB.stockTransfers.filter((t) => inferType(t) === activeType);
  const list = [...typedTransfers].filter((t) => {
    if (f.status && t.status !== f.status) return false;
    if (!inventoryInDateRange(t.date, f.dateFrom, f.dateTo)) return false;
    const fromWh = Q.warehouse(t.fromWarehouseId);
    const toWh = Q.warehouse(t.toWarehouseId);
    if (q && ![t.id, t.note, fromWh?.name, toWh?.name].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const pg = paged(list, 'inv-transfers');

  const rows = pg.items.map((t) => {
    const fromWh = Q.warehouse(t.fromWarehouseId);
    const toWh = Q.warehouse(t.toWarehouseId);
    const totalQty = (t.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
    return `<tr>
      <td><span class="code">${esc(t.id)}</span></td>
      <td class="num">${fmtDate(t.date)}</td>
      <td>${cell2(esc(fromWh?.name || t.fromWarehouseId), esc(fromWh?.address || ''))}</td>
      <td>${cell2(esc(toWh?.name || t.toWarehouseId), esc(toWh?.address || ''))}</td>
      <td class="center num strong">${fmtN((t.items || []).length)}</td>
      <td class="right num strong">${fmtN(totalQty)}</td>
      <td>${badge(t.status)}</td>
      <td class="muted">${esc(t.note || '')}</td>
      <td>${rowActions([{ act: 'inv-transfer-view', data: `data-id="${t.id}"`, icon: 'fa-eye', title: 'Xem phiếu chuyển kho' }])}</td>
    </tr>`;
  });

  const tabs = Object.entries(TYPE_META).filter(([type]) => ['RAW_MATERIAL','FINISHED_GOODS'].includes(type)).map(([type, m]) => `
    <button class="tab ${activeType === type ? 'active' : ''}" data-act="inv-transfer-tab" data-type="${type}">
      <i class="fa-solid ${m.icon}"></i>${m.label}
    </button>`).join('');

  return `
  ${pageHead('Chuyển kho nội bộ', 'Điều phối hàng giữa các kho vật lý cùng loại tại các địa điểm khác nhau', '')}
  <div class="tabs" style="margin-bottom:14px">${tabs}</div>
  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng phiếu', list.length, 'fa-right-left', 'blue', 'inventory-transfers-all')}
    ${mkpi('Nháp', list.filter(t=>t.status==='DRAFT').length, 'fa-file', 'slate', 'inventory-transfers-draft')}
    ${mkpi('Đang vận chuyển', list.filter(t=>t.status==='IN_TRANSIT').length, 'fa-truck', 'orange', 'inventory-transfers-transit')}
    ${mkpi('Đã nhận', list.filter(t=>t.status==='RECEIVED').length, 'fa-circle-check', 'green', 'inventory-transfers-received')}
  </div>

  <div class="card">
    <div class="toolbar">
      ${searchBox('inv-transfers', 'Tìm số phiếu, kho nguồn, kho đích…')}
      ${selectFilter('inv-transfers', 'status', [['DRAFT', 'Nháp'], ['IN_TRANSIT', 'Đang đi đường'], ['RECEIVED', 'Đã nhận']], 'Tất cả trạng thái')}
      ${inventoryDateRangeInputs('inv-transfers', f)}
      ${(f.q || f.status || f.dateFrom || f.dateTo) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="inv-transfers"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <button class="btn btn-primary" data-act="inv-new-transfer" data-type="${activeType}"><i class="fa-solid fa-plus"></i>Lập phiếu ${meta.short.toLowerCase()}</button>
    </div>
    ${tableShell(
      [{ t: 'Số phiếu', w: '125px' }, { t: 'Ngày' }, { t: 'Kho nguồn' }, { t: 'Kho đích' }, { t: 'Số dòng', cls: 'center' },
       { t: 'Tổng SL', cls: 'right' }, { t: 'Trạng thái', w: '125px' }, { t: 'Ghi chú' }, { t: '', cls: 'right', w: '70px' }],
      rows, { emptyTitle: `Chưa có phiếu ${meta.label.toLowerCase()}` })}
    ${pagiHTML('inv-transfers', pg, 'phiếu')}
  </div>`;
};

/* ------------- Màn 5: KIỂM KÊ -------------------------------------------- */
Views['inv-counts'] = function () {
  const f = F('inv-counts', { q: '', warehouseId: '', status: '', dateFrom: '', dateTo: '' });
  const q = (f.q || '').toLowerCase().trim();
  const list = [...DB.inventoryCounts].filter((c) => {
    if (f.warehouseId && c.warehouseId !== f.warehouseId) return false;
    if (f.status && c.status !== f.status) return false;
    if (!inventoryInDateRange(c.date, f.dateFrom, f.dateTo)) return false;
    if (q && ![c.id, c.note].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));
  const pg = paged(list, 'inv-counts');
  const warehouses = DB.warehouses.map((w) => [w.id, w.name]);

  const rows = pg.items.map((c) => {
    const wh = DB.warehouses.find((w) => w.id === c.warehouseId);
    const totalDiff = c.items.reduce((s, i) => s + i.difference, 0);
    return `<tr>
      <td><span class="code">${c.id}</span></td>
      <td class="num">${fmtDate(c.date)}</td>
      <td><span class="chip">${esc(wh ? wh.name : c.warehouseId)}</span></td>
      <td class="center num">${c.items.length}</td>
      <td class="right strong num" style="color:${totalDiff < 0 ? 'var(--red)' : totalDiff > 0 ? 'var(--green)' : 'var(--text-3)'}">
        ${totalDiff > 0 ? '+' : ''}${fmtN(totalDiff)}
      </td>
      <td>${badge(c.status)}</td>
      <td class="muted">${esc(c.note || '')}</td>
      <td>${rowActions([
        { act: 'inv-count-view', data: `data-id="${c.id}"`, icon: 'fa-eye', title: 'Xem chi tiết kiểm kê' },
        ...(c.status !== 'COMPLETED' ? [{ act: 'inv-count-complete', data: `data-id="${c.id}"`, icon: 'fa-check-double', title: 'Xác nhận & điều chỉnh tồn' }] : []),
      ])}</td>
    </tr>`;
  });

  return `
  ${pageHead('Kiểm kê kho', 'Tạo phiếu kiểm kê, đối chiếu và điều chỉnh tồn kho thực tế', `
    <button class="btn btn-primary" data-act="inv-new-count"><i class="fa-solid fa-plus"></i>Tạo phiếu kiểm kê</button>
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng phiếu kiểm kê', list.length, 'fa-clipboard-list', 'blue', 'inventory-counts-all')}
    ${mkpi('Đã hoàn tất', list.filter((c) => c.status === 'COMPLETED').length, 'fa-circle-check', 'green', 'inventory-counts-completed')}
    ${mkpi('Đang kiểm kê', list.filter((c) => c.status !== 'COMPLETED').length, 'fa-spinner', 'orange', 'inventory-counts-open')}
  </div>

  <div class="card">
    <div class="toolbar">
      ${searchBox('inv-counts', 'Tìm số phiếu, kho kiểm kê…')}
      ${selectFilter('inv-counts', 'warehouseId', warehouses, 'Tất cả kho')}
      ${selectFilter('inv-counts', 'status', [['DRAFT','Đang kiểm kê'],['COMPLETED','Đã hoàn tất']], 'Tất cả trạng thái')}
      ${inventoryDateRangeInputs('inv-counts', f)}
      ${(f.q || f.warehouseId || f.status || f.dateFrom || f.dateTo) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="inv-counts"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} phiếu</span>
    </div>
    ${tableShell(
      [{ t: 'Số phiếu KK', w: '120px' }, { t: 'Ngày KK' }, { t: 'Kho' }, { t: 'Số dòng', cls: 'center' },
       { t: 'Chênh lệch', cls: 'right' }, { t: 'Trạng thái', w: '120px' }, { t: 'Ghi chú' }, { t: '', cls: 'right', w: '90px' }],
      rows, { emptyTitle: 'Chưa có phiếu kiểm kê nào' })}
    ${pagiHTML('inv-counts', pg, 'phiếu')}
  </div>`;
};

/* ------------- Màn 6: LÔ & HẠN SỬ DỤNG ---------------------------------- */
Views['inv-lots'] = function () {
  const f = F('inv-lots', { q: '', qcStatus: '', expStatus: '', dateFrom: '', dateTo: '' });
  const q = (f.q || '').toLowerCase().trim();
  const today = new Date(DB.today + 'T00:00:00');
  const nearDays = DB.inventoryAlertConfig.nearExpiryDays;

  const list = DB.inventoryLots.filter((lot) => {
    if (f.qcStatus && lot.qcStatus !== f.qcStatus) return false;
    if (!inventoryInDateRange(lot.mfgDate, f.dateFrom, f.dateTo)) return false;
    const exp = new Date(lot.expiryDate + 'T00:00:00');
    const daysLeft = Math.round((exp - today) / 86400000);
    if (f.expStatus === 'expired' && daysLeft >= 0) return false;
    if (f.expStatus === 'near_expiry' && (daysLeft < 0 || daysLeft > nearDays)) return false;
    if (f.expStatus === 'normal' && daysLeft <= nearDays) return false;
    if (q && ![lot.lotNumber, lot.productId, lot.supplierId].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const pg = paged(list, 'inv-lots');

  const expiredLots = Q.expiredLots();
  const nearExpiryLots = Q.nearExpiryLots();

  const rows = pg.items.map((lot) => {
    const mat = DB.materials.find((m) => m.id === lot.productId) || DB.products.find((p) => p.id === lot.productId);
    const exp = new Date(lot.expiryDate + 'T00:00:00');
    const daysLeft = Math.round((exp - today) / 86400000);
    const inv = DB.inventory.find((i) => i.lotId === lot.id);
    let expBadge = '';
    if (daysLeft < 0) expBadge = `<span class="badge red">HẾT HẠN ${Math.abs(daysLeft)} ngày</span>`;
    else if (daysLeft <= nearDays) expBadge = `<span class="badge orange">Cận hạn: còn ${daysLeft} ngày</span>`;
    else expBadge = `<span class="badge green">Còn ${daysLeft} ngày</span>`;
    return `<tr>
      <td><span class="code" style="font-size:11px">${lot.lotNumber}</span></td>
      <td>${cell2(esc(mat ? mat.name : lot.productId), esc(lot.productId))}</td>
      <td class="num">${fmtDate(lot.mfgDate)}</td>
      <td>${expBadge}</td>
      <td class="right strong num">${inv ? fmtDec(inv.qtyOnHand, 2) + ' ' + esc(inv.unit) : '<span class="muted">—</span>'}</td>
      <td class="right num muted">${inv ? fmtDec(inv.qtyAvailable, 2) : '—'}</td>
      <td>${badge(lot.qcStatus)}</td>
      <td>${esc(Q.supplierName(lot.supplierId) || '—')}</td>
      <td>${rowActions([
        { act: 'inv-lot-detail', data: `data-lotid="${lot.id}"`, icon: 'fa-eye', title: 'Xem chi tiết lô' },
        ...(daysLeft < 0 || lot.qcStatus === 'FAILED' ? [{ act: 'inv-lot-quarantine', data: `data-lotid="${lot.id}"`, icon: 'fa-ban', title: 'Chuyển sang kho hàng lỗi' }] : []),
      ])}</td>
    </tr>`;
  });

  return `
  ${pageHead('Quản lý Lô & Hạn sử dụng', `Theo dõi lô hàng, HSD và trạng thái QC cho từng lô đậu hủ`, `
    ${inventoryCanOperate() ? `<button class="btn" data-act="inv-lot-config"><i class="fa-solid fa-sliders"></i>Cấu hình cảnh báo</button>` : ''}
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng số lô', list.length, 'fa-barcode', 'blue', 'inventory-lots-all')}
    ${mkpi(`Cận hạn ≤${nearDays} ngày`, list.filter(l => { const d=Math.round((new Date(l.expiryDate+'T00:00:00')-today)/86400000); return d>=0 && d<=nearDays; }).length, 'fa-calendar-minus', 'orange', 'inventory-lots-near')}
    ${mkpi('Đã hết hạn', list.filter(l => new Date(l.expiryDate+'T00:00:00') < today).length, 'fa-circle-xmark', 'red', 'inventory-lots-expired')}
    ${mkpi('Đạt QC', list.filter((l) => l.qcStatus === 'PASSED').length, 'fa-circle-check', 'green', 'inventory-lots-passed')}
    ${mkpi('Cách ly / Lỗi', list.filter((l) => ['FAILED', 'QUARANTINE'].includes(l.qcStatus)).length, 'fa-triangle-exclamation', 'red', 'inventory-lots-failed')}
  </div>

  ${expiredLots.length > 0 ? `
  <div class="card" style="margin-bottom:14px;border-left:3px solid var(--red)">
    <div class="card-head"><span class="mkpi-ico t-red"><i class="fa-solid fa-circle-xmark"></i></span>
      <div><h3>Lô đã hết hạn sử dụng — cần xử lý ngay</h3><p>Các lô bên dưới đã hết HSD, không được xuất bán. Cần chuyển sang kho hàng lỗi hoặc tiêu hủy.</p></div></div>
    <div class="card-body" style="display:flex;flex-wrap:wrap;gap:8px">
      ${expiredLots.map((lot) => {
        const mat = DB.materials.find((m) => m.id === lot.productId) || {};
        const daysExpired = Math.abs(Math.round((new Date(lot.expiryDate) - today) / 86400000));
        return `<div class="alert-item" style="flex:1 1 240px;border-color:var(--red)">
          <span class="alert-ico t-red"><i class="fa-solid fa-calendar-xmark"></i></span>
          <span><span class="alert-title" style="color:var(--red)">${lot.lotNumber}</span>
          <div class="alert-sub">${esc(mat.name || lot.productId)} · Hết hạn ${fmtDate(lot.expiryDate)} (${daysExpired} ngày trước)</div></span>
          <button class="btn btn-sm" data-act="inv-lot-quarantine" data-lotid="${lot.id}" style="flex-shrink:0">Chuyển kho lỗi</button>
        </div>`;
      }).join('')}
    </div>
  </div>` : ''}

  <div class="card">
    <div class="toolbar">
      ${searchBox('inv-lots', 'Tìm số lô, mã hàng, nhà cung cấp…')}
      ${selectFilter('inv-lots', 'qcStatus', [['PASSED', 'Đạt QC'], ['QC_PENDING', 'Chờ QC'], ['FAILED', 'Không đạt'], ['QUARANTINE', 'Cách ly']], 'Tất cả QC')}
      ${selectFilter('inv-lots', 'expStatus', [['near_expiry', '⚠ Cận hạn'], ['expired', '❌ Hết hạn'], ['normal', '✅ Còn xa']], 'Tất cả HSD')}
      ${inventoryDateRangeInputs('inv-lots', f)}
      ${(f.q || f.qcStatus || f.expStatus || f.dateFrom || f.dateTo) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="inv-lots"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} lô</span>
    </div>
    ${tableShell(
      [{ t: 'Số lô' }, { t: 'Tên hàng' }, { t: 'NSX' }, { t: 'HSD / Còn lại' },
       { t: 'On Hand', cls: 'right' }, { t: 'Available', cls: 'right' }, { t: 'QC', w: '100px' }, { t: 'Nhà cung cấp', cls: 'hide-sm' }, { t: '', cls: 'right', w: '80px' }],
      rows, { emptyTitle: 'Không tìm thấy lô hàng nào' })}
    ${pagiHTML('inv-lots', pg, 'lô')}
  </div>`;
};

/* ---- Modal cấu hình cảnh báo kho ---- */
function openInventoryAlertConfig() {
  Modal.open({
    title: 'Cấu hình cảnh báo tồn kho',
    sub: 'Điều chỉnh ngưỡng cảnh báo hạn sử dụng và hàng chậm luân chuyển',
    body: `<div class="form-grid">
      <div class="field"><label>Số ngày cảnh báo cận hạn <span class="req">*</span></label>
        <select class="inp" id="alertNearExpiry">
          ${[1, 3, 7, 15, 30].map((d) => `<option value="${d}" ${DB.inventoryAlertConfig.nearExpiryDays === d ? 'selected' : ''}>${d} ngày</option>`).join('')}
        </select></div>
      <div class="field"><label>Hàng chậm luân chuyển sau (ngày)</label>
        <select class="inp" id="alertSlowMoving">
          ${[30, 60, 90, 180].map((d) => `<option value="${d}" ${DB.inventoryAlertConfig.slowMovingDays === d ? 'selected' : ''}>${d} ngày</option>`).join('')}
        </select></div>
    </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-primary" data-act="inv-save-alert-config"><i class="fa-solid fa-floppy-disk"></i>Lưu cấu hình</button>`,
  });
}

/* ---- Modal tạo phiếu nhập kho ---- */
function receiptLotCode(poId, materialId, date, roundNo) {
  const compactPo = String(poId || 'PO').replace(/-/g, '');
  const compactMat = String(materialId || 'SP').replace(/-/g, '');
  const ymd = String(date || DB.today).replace(/-/g, '').slice(2);
  return `${compactPo}-${compactMat}-${ymd}-${String(roundNo || 1).padStart(2, '0')}`;
}

function receiptRoundOfPo(poId) {
  return (DB.goodsReceipts || []).filter(r => r.poId === poId).length + 1;
}

function receiptPoDetailHtml(po, date) {
  if (!po) return '<div class="empty-mini">Chọn đơn hàng để hiển thị chi tiết.</div>';
  const roundNo = receiptRoundOfPo(po.id);
  return `
    <div class="card" style="margin-bottom:14px;background:var(--surface-2)">
      <div class="card-body">
        <div class="info-grid">
          ${infoItem('Mã đơn hàng', `<span class="code">${esc(po.id)}</span>`)}
          ${infoItem('Đề nghị mua', `<span class="code">${esc(po.prId || '—')}</span>`)}
          ${infoItem('Nhà cung cấp', esc(Q.supplierName(po.supplierId)))}
          ${infoItem('Ngày đặt', fmtDate(po.date))}
          ${infoItem('Giao dự kiến', fmtDate(po.expectedDate))}
          ${infoItem('Trạng thái', badge(po.status))}${po.qualityNote ? infoItem('Ghi chú chất lượng', `<span class="badge red">${esc(po.qualityNote)}</span>`) : ''}
        </div>
      </div>
    </div>
    <div class="form-sec-title"><i class="fa-solid fa-boxes-packing"></i>Nguyên liệu nhập kho</div>
    <div class="tbl-wrap" style="border:1px solid var(--border);border-radius:var(--r)">
      <table class="line-tbl">
        <thead><tr><th>Nguyên liệu</th><th class="right">SL đặt</th><th class="right">Đã nhập</th><th class="right">Nhập lần này</th><th>Lô hệ thống</th><th>NSX</th><th>HSD</th></tr></thead>
        <tbody>
          ${(po.items || []).map((it) => {
            const remain = Math.max(0, Number(it.qty || 0) - Number(it.receivedQty || 0));
            const lotNo = receiptLotCode(po.id, it.materialId, date, roundNo);
            return `<tr>
              <td><div class="strong">${esc(it.name)}</div><div class="cell-sub">${esc(it.materialId)} · ${esc(it.unit)}</div></td>
              <td class="right num">${fmtN(it.qty)}</td>
              <td class="right num muted">${fmtN(it.receivedQty || 0)}</td>
              <td class="right"><input class="inp right num po-gr-qty" data-mid="${esc(it.materialId)}" type="number" min="0" max="${remain}" value="${remain}" style="width:100px" ${remain <= 0 ? 'disabled' : ''}></td>
              <td><input class="inp po-gr-lot" data-mid="${esc(it.materialId)}" value="${esc(lotNo)}" style="min-width:190px;background:var(--surface-2)" readonly title="Lô hệ thống tự sinh, không được chỉnh sửa"></td>
              <td><input class="inp po-gr-mfg" data-mid="${esc(it.materialId)}" type="date" value="${date}" style="width:135px"></td>
              <td><input class="inp po-gr-exp" data-mid="${esc(it.materialId)}" type="date" value="${addDays(date, 365)}" style="width:135px"></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="muted" style="font-size:11.8px;margin-top:8px"><i class="fa-solid fa-circle-info"></i> <b>Lô hệ thống</b> tự sinh theo Mã PO - Mã SP - YYMMDD - Đợt và bị khóa. Tạm thời hệ thống chỉ sử dụng lô hệ thống.</div>`;
}

function openNewReceiptModal(preselectedPoId = '') {
  const eligiblePos = DB.purchaseOrders.filter((po) => ['SHIPPING', 'PARTIAL_RECEIVED'].includes(po.status));
  const selectedId = preselectedPoId && eligiblePos.some(p => p.id === preselectedPoId) ? preselectedPoId : '';
  const po = Q.purchaseOrder(selectedId);
  const warehouse = DB.warehouses.find(w => w.type === 'RAW_MATERIAL') || DB.warehouses[0];
  const locations = warehouse ? Q.locationsOf(warehouse.id) : [];
  Modal.open({
    title: 'Lập phiếu nhập kho từ đơn đặt hàng',
    sub: 'Chỉ các PO đang giao hoặc đã nhận một phần mới được phép lập phiếu nhập',
    size: 'lg',
    body: `
      ${eligiblePos.length ? '' : '<div class="alert-item" style="margin-bottom:14px"><i class="fa-solid fa-circle-info"></i><div><b>Chưa có PO chờ nhập kho</b><div class="muted">Hãy xác nhận giao hàng ở Đơn đặt hàng trước.</div></div></div>'}
      <div class="form-grid">
        <div class="field"><label>Đơn đặt hàng <span class="req">*</span></label>
          <select class="inp" id="poGrPo">
            <option value="">-- Chọn đơn đặt hàng --</option>${eligiblePos.map(p => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.id} · ${esc(Q.supplierName(p.supplierId))} · ${statusLabel(p.status)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Kho nhận hàng <span class="req">*</span></label>
          <select class="inp" id="poGrWarehouse">
            ${DB.warehouses.filter(w => w.type === 'RAW_MATERIAL').map(w => `<option value="${w.id}" ${warehouse && w.id === warehouse.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Kệ / vị trí lưu trữ <span class="req">*</span></label>
          <select class="inp" id="poGrLocation">
            ${locations.map(l => `<option value="${l.id}">${esc(l.name)} · ${esc(l.code)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Người nhập kho</label>
          <input class="inp" value="${esc(DB.currentUser?.name || '—')}" readonly title="Người nhập kho được lấy từ tài khoản đang đăng nhập">
          <div class="cell-sub" style="margin-top:5px">Tự động lấy theo tài khoản đang đăng nhập, không được chọn người khác.</div>
        </div>
        <div class="field"><label>Ngày nhập</label><input class="inp" id="poGrDate" type="date" value="${currentDateYMD()}" min="${currentDateYMD()}"></div>
      </div>
      <div class="field"><label>Ghi chú</label><textarea class="inp" id="poGrNote" rows="2" placeholder="Ghi chú nhận hàng / tình trạng hàng…">${po ? `Nhập kho theo đơn ${po.id}` : ''}</textarea></div>
      <div id="poGrDetail">${receiptPoDetailHtml(po, DB.today)}</div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-success" id="poGrSaveBtn" data-act="po-goods-receipt-save" ${(eligiblePos.length && selectedId) ? '' : 'disabled'}><i class="fa-solid fa-warehouse"></i>Xác nhận nhập kho</button>`,
  });
}


function openWarehouseReceiptModal(receiptTab = 'semi') {
  const cfg = receiptTab === 'finished'
    ? { label: 'thành phẩm', type: 'FINISHED_GOODS', defaultRef: 'LSX-' }
    : { label: 'bán thành phẩm', type: 'SEMI_FINISHED', defaultRef: 'LSX-' };
  const warehouses = DB.warehouses.filter(w => w.type === cfg.type);
  const warehouse = warehouses[0];
  const locations = warehouse ? Q.locationsOf(warehouse.id) : [];
  const products = DB.products || [];
  Modal.open({
    title: `Lập phiếu nhập kho ${cfg.label}`,
    sub: `Phiếu nhập nội bộ vào ${cfg.label}; chỉ hiển thị kho đúng loại`,
    size: 'lg',
    body: `
      ${receiptTab === 'finished' ? `<div class="note-box" style="margin-bottom:12px"><b>Nguồn sản phẩm:</b> danh sách bên dưới lấy từ <b>Danh mục thành phẩm (DB.products)</b>, không phải từ số lượng tồn kho. Vì vậy thành phẩm chưa có tồn vẫn xuất hiện để bạn có thể nhập kho.</div>` : ''}
      <div class="form-grid">
        <div class="field"><label>Kho nhận <span class="req">*</span></label><select class="inp" id="whGrWarehouse">${warehouses.map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Kệ / vị trí <span class="req">*</span></label><select class="inp" id="whGrLocation">${locations.map(l=>`<option value="${l.id}">${esc(l.name)} · ${esc(l.code)}</option>`).join('')}</select></div>
        <div class="field"><label>Ngày nhập</label><input class="inp" id="whGrDate" type="date" value="${currentDateYMD()}" min="${currentDateYMD()}"></div>
        <div class="field"><label>Người nhập</label><select class="inp" id="whGrReceiver">${DB.employees.filter(e=>e.dept==='Kho vận').map(e=>`<option value="${e.id}" ${e.id===DB.currentUser.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Sản phẩm <span class="req">*</span></label><select class="inp" id="whGrProduct"><option value="">-- Chọn sản phẩm --</option>${products.map(p=>`<option value="${p.id}">${esc(p.id)} · ${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Số lượng <span class="req">*</span></label><input class="inp right num" id="whGrQty" type="number" min="0" value="0"></div>
        <div class="field"><label>Lô hệ thống <span class="req">*</span></label><input class="inp" id="whGrSystemLot" placeholder="VD: LSX0048-SP001-260908-01"></div>
        <div class="field"><label>Ngày sản xuất</label><input class="inp" id="whGrMfg" type="date" value="${currentDateYMD()}" min="${currentDateYMD()}"></div>
        <div class="field"><label>Hạn sử dụng</label><input class="inp" id="whGrExp" type="date" value="${addDays(currentDateYMD(), 7)}" min="${currentDateYMD()}"></div>
        <div class="field"><label>Chứng từ tham chiếu</label><input class="inp" id="whGrRef" placeholder="${cfg.defaultRef}..."></div>
      </div>
      <div class="field"><label>Ghi chú</label><textarea class="inp" id="whGrNote" rows="2" placeholder="Ghi chú nhập ${cfg.label}…"></textarea></div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-success" data-act="warehouse-receipt-save" data-tab="${receiptTab}"><i class="fa-solid fa-warehouse"></i>Xác nhận nhập kho</button>`
  });
}

function openPoReceiptHistory(poId) {
  const po = Q.purchaseOrder(poId);
  if (!po) return;
  const receipts = Q.receiptsOfPo(poId).sort((a,b) => String(b.date).localeCompare(String(a.date)));
  const returns = (DB.goodsIssues || []).filter(x => x.type === 'RETURN_OUT' && (x.refDoc === poId || x.poId === poId));
  Modal.open({
    title: `Nhập kho theo ${po.id}`,
    sub: `${esc(Q.supplierName(po.supplierId))} · ${statusLabel(po.status)}`,
    size: 'lg',
    body: `
      <div class="form-sec-title"><i class="fa-solid fa-box"></i>Chi tiết nguyên liệu</div>
      ${tableShell([{t:'Nguyên liệu'},{t:'SL đặt',cls:'right'},{t:'Đã nhập',cls:'right'}], (po.items||[]).map(i => `<tr><td>${cell2(esc(i.name), esc(i.materialId))}</td><td class="right num">${fmtN(i.qty)} ${esc(i.unit)}</td><td class="right num strong">${fmtN(i.receivedQty||0)} ${esc(i.unit)}</td></tr>`))}
      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-clock-rotate-left"></i>Lịch sử nhập kho</div>
      ${tableShell([{t:'Phiếu nhập'},{t:'Ngày'},{t:'Người nhập'},{t:'Nguyên liệu'},{t:'Số lượng nhập',cls:'right'},{t:'Lô hệ thống'},{t:'QC'}], receipts.flatMap(r => (r.items||[]).map(i => `<tr><td><span class="code">${r.id}</span></td><td class="num">${fmtDate(r.date)}</td><td>${esc(Q.employeeName(r.receivedBy))}</td><td>${esc(i.name)}</td><td class="right num strong">${fmtN(i.qty)} ${esc(i.unit)}</td><td><span class="code">${esc(i.lotNumber||'—')}</span></td><td>${r.inspectionStatus === 'PASSED' ? '<span class="badge green">Đạt</span>' : r.inspectionStatus === 'FAILED' || r.inspectionStatus === 'PARTIAL_FAILED' ? '<span class="badge red">Có lỗi</span>' : '<span class="badge orange">Chờ kiểm</span>'}</td></tr>`)), {emptyTitle:'Chưa có lịch sử nhập kho'})}
      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-rotate-left"></i>Lịch sử đổi trả</div>
      ${tableShell([{t:'Phiếu xuất trả'},{t:'Ngày'},{t:'Nguyên liệu'},{t:'Số lượng trả',cls:'right'},{t:'Lô hệ thống'},{t:'Lý do'}], returns.flatMap(r => (r.items||[]).map(i => `<tr><td><span class="code">${r.id}</span></td><td>${fmtDate(r.date)}</td><td>${esc(Q.material(i.productId)?.name || i.productId)}</td><td class="right num">${fmtN(i.qty)} ${esc(i.unit||'')}</td><td><span class="code">${esc(Q.lot(i.lotId)?.lotNumber || i.lotId || '—')}</span></td><td class="muted">${esc(r.note||'')}</td></tr>`)), {emptyTitle:'Chưa phát sinh đổi trả'})}`,
    foot: `<button class="btn" data-act="modal-close">Đóng</button>${po.status === 'PARTIAL_RECEIVED' ? `<button class="btn btn-primary" data-act="inv-new-receipt" data-poid="${po.id}"><i class="fa-solid fa-plus"></i>Nhập tiếp</button>` : ''}`,
  });
}

/* ---- Modal tạo phiếu xuất kho với FEFO ----- */
function openNewIssueModal(issueTab = 'raw') {
  const tabType = { raw:'RAW_MATERIAL', semi:'SEMI_FINISHED', finished:'FINISHED_GOODS' }[issueTab] || 'RAW_MATERIAL';
  const warehouses = DB.warehouses.filter(w => w.type === tabType);
  const allowedIds = new Set(warehouses.map(w=>w.id));
  const stockProducts = [...new Set(DB.inventory.filter(i=>allowedIds.has(i.warehouseId) && Number(i.qtyAvailable ?? i.qtyOnHand ?? 0) > 0).map(i=>i.productId))]
    .map(id=>Q.material(id)||Q.product(id)).filter(Boolean)
    .sort((a,b)=>String(a.name||a.id).localeCompare(String(b.name||b.id),'vi',{sensitivity:'base'}));
  const productOptions = `<option value="">-- Chọn hàng xuất kho --</option>${stockProducts.map(m=>`<option value="${m.id}">${esc(m.name)} (${m.id})</option>`).join('')}`;
  const itemLabel = issueTab === 'raw' ? 'Nguyên liệu' : issueTab === 'semi' ? 'Bán thành phẩm' : 'Thành phẩm';
  Modal.open({
    title: `Lập phiếu xuất ${itemLabel.toLowerCase()}`,
    sub: 'Có thể chọn nhiều mặt hàng trong cùng một phiếu; hệ thống lấy lô phù hợp theo FEFO trong khu đã chọn',
    size: 'lg',
    body: `
      <div class="form-sec-title"><i class="fa-solid fa-file-lines"></i>Thông tin chung</div>
      <div class="form-grid">
        <div class="field"><label>Người lập phiếu</label><input class="inp" value="${esc(Q.employeeName(DB.currentUser.id))}" disabled></div>
        <div class="field"><label>Ngày xuất</label><input class="inp" type="date" id="giNewDate" value="${currentDateYMD()}" min="${currentDateYMD()}" /></div>
        <div class="field"><label>Loại hàng</label><input class="inp" id="giItemCategory" value="${itemLabel}" disabled></div>
        <div class="field"><label>Loại xuất <span class="req">*</span></label>
          <select class="inp" id="giNewType">
            ${issueTab !== 'finished' ? '<option value="PRODUCTION_ISSUE">Xuất sản xuất</option>' : ''}
            ${issueTab === 'finished' ? '<option value="SALES_ISSUE">Xuất bán hàng</option>' : ''}
            <option value="ADJUSTMENT_OUT">Xuất điều chỉnh</option>
            <option value="TRANSFER_OUT">Xuất chuyển kho</option>
          </select></div>
        <div class="field"><label>Khu xuất <span class="req">*</span></label>
          <select class="inp" id="giNewWarehouse">${warehouses.map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Chứng từ tham chiếu</label><input class="inp" id="giNewRef" placeholder="LSX-2026-xxxx / DH-2026-xxxx" /></div>
      </div>
      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-box-open"></i>Hàng xuất kho</div>
      <div style="display:grid;grid-template-columns:minmax(280px,2fr) minmax(150px,1fr) 44px;gap:10px;padding:0 2px 6px;color:var(--text-muted);font-size:12px;font-weight:700">
        <div>${itemLabel}</div><div>Số lượng xuất</div><div></div>
      </div>
      <div id="giNewItems" data-options="${encodeURIComponent(productOptions)}">
        <div class="gi-issue-line" style="display:grid;grid-template-columns:minmax(280px,2fr) minmax(150px,1fr) 44px;gap:10px;align-items:center;margin-bottom:8px">
          <select class="inp" name="product">${productOptions}</select>
          <input class="inp right num" name="qty" type="number" min="0.01" step="0.01" placeholder="Nhập số lượng" />
          <button type="button" class="btn btn-sm" data-act="inv-issue-remove-line" title="Xóa dòng" disabled><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <button type="button" class="btn btn-sm" data-act="inv-issue-add-line" style="margin-bottom:14px"><i class="fa-solid fa-plus"></i>Thêm ${itemLabel.toLowerCase()}</button>
      <div class="field"><label>Ghi chú</label><textarea class="inp" id="giNewNote" rows="2" placeholder="Diễn giải lý do xuất kho…"></textarea></div>
      <div class="alert-item" style="border-color:var(--primary);background:var(--surface-2);margin-top:12px">
        <span class="alert-ico t-blue"><i class="fa-solid fa-circle-info"></i></span>
        <span><div class="alert-sub">Phiếu xuất mới không dùng cho trả NCC. Hàng trả NCC được xử lý riêng từ yêu cầu trả nguyên liệu ở tab Kho nguyên liệu.</div></span>
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="inv-issue-save-new"><i class="fa-solid fa-floppy-disk"></i>Xác nhận xuất kho</button>`,
  });
}

function openIssueDetailModal(id) {
  const gi=(DB.goodsIssues||[]).find(x=>x.id===id); if(!gi) return;
  Modal.open({title:`Chi tiết phiếu xuất ${gi.id}`,sub:`${Q.warehouseName(gi.warehouseId)} · ${fmtDate(gi.date)}`,size:'lg',body:`
    <div class="info-grid">${infoItem('Loại xuất',esc(({PRODUCTION_ISSUE:'Xuất sản xuất',SUBCONTRACT_ISSUE:'Xuất gia công',SALES_ISSUE:'Xuất bán hàng',ADJUSTMENT_OUT:'Xuất điều chỉnh',TRANSFER_OUT:'Xuất chuyển kho',RETURN_OUT:'Xuất trả NCC'}[gi.type]||gi.type)))}${infoItem('Khu xuất',esc(Q.warehouseName(gi.warehouseId)))}${infoItem('Chứng từ tham chiếu',esc(gi.refDoc||'—'))}${infoItem('Người lập',esc(Q.employeeName(gi.createdBy)))}</div>
    <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-box-open"></i>Chi tiết hàng xuất</div>
    ${tableShell([{t:'Mã hàng'},{t:'Tên hàng'},{t:'Lô hệ thống'},{t:'Kệ'},{t:'Số lượng',cls:'right'}],(gi.items||[]).map(i=>{const lot=Q.lot(i.lotId);const item=Q.material(i.productId)||Q.product(i.productId);return `<tr><td><span class="code">${esc(i.productId)}</span></td><td>${esc(item?.name||i.productId)}</td><td><span class="code">${esc(lot?.lotNumber||'—')}</span></td><td>${esc(Q.locationName(i.locationId)||'—')}</td><td class="right strong num">${fmtDec(i.qty,3)} ${esc(i.unit||'')}</td></tr>`; }))}
    <div class="field" style="margin-top:14px"><label>Ghi chú</label><div class="inp" style="height:auto;min-height:42px">${esc(gi.note||'—')}</div></div>`,foot:'<button class="btn" data-act="modal-close">Đóng</button>'});
}

/* ---- Modal tạo phiếu chuyển kho ----- */
function openNewTransferModal(transferType = 'RAW_MATERIAL') {
  const TYPE_META = {
    RAW_MATERIAL: { label: 'nguyên liệu', title: 'Phiếu chuyển kho nguyên liệu' },
    SEMI_FINISHED: { label: 'bán thành phẩm', title: 'Phiếu chuyển kho bán thành phẩm' },
    FINISHED_GOODS: { label: 'thành phẩm', title: 'Phiếu chuyển kho thành phẩm' },
    STORE: { label: 'hàng cấp cửa hàng', title: 'Phiếu cấp hàng cho cửa hàng' },
  };
  const meta = TYPE_META[transferType] || TYPE_META.RAW_MATERIAL;
  const sourceWarehouses = transferType === 'STORE'
    ? DB.warehouses.filter((w) => ['RAW_MATERIAL','SEMI_FINISHED','FINISHED_GOODS'].includes(w.type) && w.status === 'active')
    : DB.warehouses.filter((w) => w.type === transferType && w.status === 'active');
  const destinationWarehouses = transferType === 'STORE'
    ? DB.warehouses.filter((w) => w.type === 'STORE' && w.status === 'active')
    : DB.warehouses.filter((w) => w.type === transferType && w.status === 'active');
  Modal.open({
    title: meta.title,
    sub: transferType === 'STORE' ? 'Cấp nguyên liệu / thành phẩm từ kho trung tâm sang kho cửa hàng' : `Chuyển ${meta.label} giữa các kho vật lý cùng loại`,
    size: 'lg',
    body: `
      <input type="hidden" id="ckTransferType" value="${transferType}" />
      <div class="form-sec-title"><i class="fa-solid fa-circle-info"></i>Thông tin chung</div>
      <div class="form-grid">
        <div class="field"><label>Kho nguồn <span class="req">*</span></label>
          <select class="inp" id="ckFromWh">
            <option value="">-- Chọn kho nguồn --</option>
            ${sourceWarehouses.map((w) => `<option value="${w.id}">${esc(w.name)} · ${esc(w.address)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Kho đích <span class="req">*</span></label>
          <select class="inp" id="ckToWh"><option value="">-- Chọn kho đích --</option></select></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Ngày chuyển</label><input class="inp" type="date" id="ckDate" value="${currentDateYMD()}" min="${currentDateYMD()}" /></div>
        <div class="field"><label>Ghi chú</label><input class="inp" id="ckNote" placeholder="Lý do điều phối hàng giữa các kho…" /></div>
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>Hàng hóa chuyển kho</div>
      <div id="ckItemsArea">
        <div class="muted" style="padding:16px;text-align:center;border:1px dashed var(--border);border-radius:var(--r)">Chọn kho nguồn để thêm hàng hóa cần chuyển.</div>
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-primary" data-act="inv-transfer-save-new"><i class="fa-solid fa-right-left"></i>Tạo phiếu chuyển kho</button>`,
  });

  let lineSeq = 0;
  const sourceRows = () => {
    const fromId = $('#ckFromWh')?.value || '';
    return DB.inventory
      .filter((inv) => inv.warehouseId === fromId && Number(inv.qtyAvailable ?? inv.qtyOnHand ?? 0) > 0)
      .sort((a,b) => {
        const ai = Q.material(a.productId) || Q.product(a.productId);
        const bi = Q.material(b.productId) || Q.product(b.productId);
        return String(ai?.name || a.productId).localeCompare(String(bi?.name || b.productId), 'vi', { numeric:true, sensitivity:'base' });
      });
  };
  const stockKey = (inv) => [inv.productId, inv.lotId, inv.locationId].join('|');
  const stockOptions = () => sourceRows().map((inv) => {
    const lot = Q.lot(inv.lotId);
    const item = Q.material(inv.productId) || Q.product(inv.productId);
    const available = Number(inv.qtyAvailable ?? inv.qtyOnHand ?? 0);
    return `<option value="${esc(stockKey(inv))}">${esc(item?.name || inv.productId)} · ${esc(lot?.lotNumber || '—')} · ${esc(Q.locationName(inv.locationId))} · Còn ${fmtDec(available,2)} ${esc(inv.unit||'')}</option>`;
  }).join('');

  const renderDestinationOptions = () => {
    const fromId = $('#ckFromWh')?.value || '';
    const to = $('#ckToWh');
    if (!to) return;
    const current = to.value;
    to.innerHTML = `<option value="">-- Chọn kho đích --</option>` + destinationWarehouses
      .filter(w => w.id !== fromId)
      .map(w => `<option value="${w.id}">${esc(w.name)} · ${esc(w.address)}</option>`).join('');
    if (current && current !== fromId && destinationWarehouses.some(w => w.id === current)) to.value = current;
  };

  const attachLineEvents = (row) => {
    row.querySelector('.ck-remove-line')?.addEventListener('click', () => {
      row.remove();
      const body = $('#ckTransferLines');
      if (body && !body.children.length) addLine();
    });
  };
  const addLine = () => {
    const body = $('#ckTransferLines');
    if (!body) return;
    const opts = stockOptions();
    if (!opts) return Toast.err('Không có tồn khả dụng', 'Kho nguồn hiện không có hàng để chuyển.');
    lineSeq += 1;
    const tr = document.createElement('tr');
    tr.className = 'ck-transfer-row';
    tr.innerHTML = `
      <td><select class="inp ck-stock-select"><option value="">-- Chọn ${meta.label} --</option>${opts}</select></td>
      <td class="right"><input class="inp right num ck-transfer-qty" type="number" min="0" step="0.01" value="0" style="width:130px" /></td>
      <td class="center"><button type="button" class="btn btn-sm ck-remove-line" title="Xóa dòng"><i class="fa-solid fa-trash"></i></button></td>`;
    body.appendChild(tr);
    attachLineEvents(tr);
  };
  const renderTransferItems = () => {
    const fromId = $('#ckFromWh')?.value || '';
    const area = $('#ckItemsArea');
    if (!area) return;
    if (!fromId) {
      area.innerHTML = '<div class="muted" style="padding:16px;text-align:center;border:1px dashed var(--border);border-radius:var(--r)">Chọn kho nguồn để thêm hàng hóa cần chuyển.</div>';
      return;
    }
    if (!sourceRows().length) {
      area.innerHTML = '<div class="muted" style="padding:16px;text-align:center;border:1px dashed var(--border);border-radius:var(--r)">Kho nguồn hiện không có tồn khả dụng để chuyển.</div>';
      return;
    }
    area.innerHTML = `
      <div class="tbl-wrap" style="border:1px solid var(--border);border-radius:var(--r)">
        <table class="line-tbl">
          <thead><tr><th>${meta.label.charAt(0).toUpperCase()+meta.label.slice(1)} / Lô / Vị trí nguồn</th><th class="right" style="width:150px">SL chuyển</th><th style="width:54px"></th></tr></thead>
          <tbody id="ckTransferLines"></tbody>
        </table>
      </div>
      <button type="button" class="btn btn-sm" id="ckAddLine" style="margin-top:10px"><i class="fa-solid fa-plus"></i>Thêm ${meta.label}</button>`;
    $('#ckAddLine')?.addEventListener('click', addLine);
    addLine();
  };

  $('#ckFromWh')?.addEventListener('change', () => {
    renderDestinationOptions();
    renderTransferItems();
  });
  renderDestinationOptions();
  renderTransferItems();
}
function openTransferDetailModal(id) {
  const t = DB.stockTransfers.find((x) => x.id === id);
  if (!t) return Toast.err('Không tìm thấy phiếu', id);
  const fromWh = Q.warehouse(t.fromWarehouseId);
  const toWh = Q.warehouse(t.toWarehouseId);
  Modal.open({
    title: `Phiếu chuyển kho ${t.id}`,
    sub: `${esc(fromWh?.name || t.fromWarehouseId)} → ${esc(toWh?.name || t.toWarehouseId)}`,
    size: 'lg',
    body: `
      <div class="form-grid">
        <div>${cell2('Ngày chuyển', fmtDate(t.date))}</div>
        <div>${cell2('Trạng thái', badge(t.status))}</div>
        <div>${cell2('Kho nguồn', esc(fromWh?.name || t.fromWarehouseId))}</div>
        <div>${cell2('Kho đích', esc(toWh?.name || t.toWarehouseId))}</div>
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>Chi tiết hàng chuyển</div>
      ${tableShell([{t:'Mã'},{t:'Hàng hóa'},{t:'Lô'},{t:'Vị trí nguồn'},{t:'Vị trí đích'},{t:'Số lượng',cls:'right'}],
        (t.items || []).map((i) => {
          const item = DB.materials.find((m) => m.id === i.productId) || DB.products.find((p) => p.id === i.productId);
          return `<tr><td><span class="code">${esc(i.productId)}</span></td><td>${esc(item?.name || i.productId)}</td><td>${esc(Q.lot(i.lotId)?.lotNumber || '—')}</td><td>${esc(Q.locationName(i.fromLocationId))}</td><td>${esc(Q.locationName(i.toLocationId))}</td><td class="right num strong">${fmtN(i.qty)} ${esc(i.unit || '')}</td></tr>`;
        }), {emptyTitle:'Không có dòng hàng'})}
      ${t.note ? `<div class="muted" style="margin-top:12px"><strong>Ghi chú:</strong> ${esc(t.note)}</div>` : ''}`,
    foot: `<button class="btn btn-primary" data-act="modal-close">Đóng</button>`,
  });
}

/* ---------------- SỔ GIAO DỊCH VÀ CẢNH BÁO THEO TÀI LIỆU ERP ---------------- */
const InventoryService = {
  apply({ productId, warehouseId = 'WH-001', locationId = '', lotId = '', quantity, type, refType = 'MANUAL', refId = '', note = '', userId = DB.currentUser.id, updateMaterial = true }) {
    const qty = Number(quantity);
    if (!productId || !Number.isFinite(qty) || qty <= 0) return { ok: false, message: 'Số lượng phải lớn hơn 0.' };
    const inbound = ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN', 'PRODUCTION_RECEIPT'].includes(type);
    const delta = inbound ? qty : -qty;
    let row = DB.inventory.find((x) => x.productId === productId && x.warehouseId === warehouseId && x.locationId === locationId && x.lotId === lotId);
    if (!row) {
      if (!inbound) return { ok: false, message: 'Không tìm thấy tồn kho theo lô và vị trí đã chọn.' };
      const material = Q.material(productId); const product = Q.product(productId);
      row = { productId, warehouseId, locationId, lotId, qtyOnHand: 0, qtyReserved: 0, qtyAvailable: 0, unit: material?.unit || product?.unit || '', lastUpdated: DB.today };
      DB.inventory.push(row);
    }
    if (!inbound && qty > row.qtyAvailable) return { ok: false, message: `Không đủ tồn kho. Tồn khả dụng: ${fmtDec(row.qtyAvailable, 2)}, yêu cầu xuất: ${fmtDec(qty, 2)}.` };
    const before = row.qtyOnHand;
    row.qtyOnHand = Math.round((row.qtyOnHand + delta) * 100) / 100;
    row.qtyAvailable = Math.round((row.qtyOnHand - row.qtyReserved) * 100) / 100;
    row.lastUpdated = DB.today + ' 09:00';
    DB.inventoryTransactions.unshift({ id: nextCode('TX-', DB.inventoryTransactions), transactionNumber: refId || nextCode('TX-', DB.inventoryTransactions), type, productId, warehouseId, locationId, lotId, qty: delta, qtyBefore: before, qtyAfter: row.qtyOnHand, refType, refId, userId, date: DB.today, createdAt: new Date().toISOString(), note });
    if (updateMaterial) { const material = Q.material(productId); if (material) material.stock = Math.round((material.stock + delta) * 100) / 100; }
    return { ok: true, row };
  },
};

function warehouseTypeLabel(type){
  return ({RAW_MATERIAL:'Kho nguyên liệu',SEMI_FINISHED:'Kho bán thành phẩm',FINISHED_GOODS:'Kho thành phẩm',PRODUCTION:'Kho sản xuất',STORE:'Kho cửa hàng',DEFECTIVE:'Kho hàng lỗi',RETURNED:'Kho hàng trả về'}[type]||type||'—');
}
function warehouseZoneTypeLabel(type){
  return ({RAW_MATERIAL:'Khu Nguyên liệu',SEMI_FINISHED:'Khu Bán thành phẩm',FINISHED_GOODS:'Khu Thành phẩm',PRODUCTION:'Khu Sản xuất',STORE:'Khu Cửa hàng',DEFECTIVE:'Khu Hàng lỗi',RETURNED:'Khu Hàng trả về'}[type]||type||'Khu khác');
}
function warehouseSiteIdOf(zone){
  if(!zone)return '';
  if(zone.siteId)return zone.siteId;
  const id=String(zone.id||'');
  if(['WH-001','WH-002','WH-003','WH-004','WH-005','WH-006','WH-007'].includes(id))return 'SITE-TD';
  if(['WH-008','WH-011','WH-012'].includes(id))return 'SITE-BD';
  if(['WH-009','WH-013','WH-014'].includes(id))return 'SITE-DN';
  const text=[zone.code,zone.name,zone.address].join(' ').toLowerCase();
  if(text.includes('_td')||text.includes('thủ đức')||text.includes('thu duc')||text.includes('quận 9'))return 'SITE-TD';
  if(text.includes('_bd')||text.includes('bình dương')||text.includes('binh duong')||text.includes('dĩ an'))return 'SITE-BD';
  if(text.includes('_dn')||text.includes('đồng nai')||text.includes('dong nai')||text.includes('biên hòa'))return 'SITE-DN';
  return '';
}
function warehouseSitesList(){
  DB.warehouseSites=DB.warehouseSites||[];
  return DB.warehouseSites.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'vi'));
}
function warehouseZonesOfSite(siteId){
  return (DB.warehouses||[]).filter(w=>warehouseSiteIdOf(w)===siteId);
}
function warehouseZoneStock(zoneId){
  const rows=(DB.inventory||[]).filter(r=>r.warehouseId===zoneId);
  return {
    onHand:rows.reduce((s,r)=>s+Number(r.qtyOnHand||0),0),
    reserved:rows.reduce((s,r)=>s+Number(r.qtyReserved||0),0),
    pending:rows.reduce((s,r)=>s+Number(r.qtyPending||0),0),
    available:rows.reduce((s,r)=>s+Number(r.qtyAvailable!=null?r.qtyAvailable:(Number(r.qtyOnHand||0)-Number(r.qtyReserved||0))),0),
  };
}
function warehouseCoordText(w){const lat=Number(w?.lat||w?.latitude||0),lng=Number(w?.lng||w?.longitude||0);return lat&&lng?`${lat.toFixed(6)}, ${lng.toFixed(6)}`:'Chưa khai báo';}
function openWarehouseMasterForm(id=''){
  const w=(DB.warehouseSites||[]).find(x=>x.id===id)||{};
  const oldAddressDetail=w.addressDetail || (!w.province ? (w.address||'') : '');
  Modal.open({title:id?'Cập nhật kho':'Thêm kho',sub:'Kho là địa điểm vật lý. Nguyên liệu, bán thành phẩm và thành phẩm được quản lý theo các khu bên trong kho.',size:'lg',body:`
    <div class="form-grid cols-2">
      <div class="field"><label>Mã kho *</label><input class="inp" id="whMasterCode" value="${esc(w.code||'')}" ${id?'disabled':''} placeholder="VD: TD, BD"></div>
      <div class="field"><label>Tên kho *</label><input class="inp" id="whMasterName" value="${esc(w.name||'')}" placeholder="VD: Kho Thủ Đức"></div>
      <div class="field"><label>Trạng thái</label><select class="inp" id="whMasterStatus"><option value="active" ${w.status!=='inactive'?'selected':''}>Đang hoạt động</option><option value="inactive" ${w.status==='inactive'?'selected':''}>Ngừng hoạt động</option></select></div>
      <div class="field"><label>Người phụ trách</label><input class="inp" id="whMasterManager" value="${esc(w.managerId||'')}"></div>
      <div class="field"><label>Tỉnh / Thành phố *</label><select class="inp" id="whMasterProvince"><option value="${esc(w.province||'')}">${esc(w.province||'-- Chọn Tỉnh/Thành phố --')}</option></select></div>
      <div class="field"><label>Quận / Huyện *</label><select class="inp" id="whMasterDistrict"><option value="${esc(w.district||'')}">${esc(w.district||'-- Chọn Quận/Huyện --')}</option></select></div>
      <div class="field"><label>Phường / Xã</label><select class="inp" id="whMasterWard"><option value="${esc(w.ward||'')}">${esc(w.ward||'-- Chọn Phường/Xã --')}</option></select></div>
      <div class="field"><label>Địa chỉ chi tiết *</label><input class="inp" id="whMasterAddressDetail" value="${esc(oldAddressDetail)}" placeholder="Số nhà, tên đường, khu công nghiệp..."><div class="cell-sub" id="whMasterAddressNote">Địa chỉ này dùng chung cho các khu bên trong kho.</div></div>
      <input type="hidden" id="whMasterLat" value="${Number(w.lat||w.latitude||0)||''}">
      <input type="hidden" id="whMasterLng" value="${Number(w.lng||w.longitude||0)||''}">
      <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><input class="inp" id="whMasterNote" value="${esc(w.note||'')}"></div>
    </div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="inv-warehouse-save" data-id="${esc(id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu kho</button>`});
  if(typeof VNAddress!=='undefined') VNAddress.init({provinceId:'whMasterProvince',districtId:'whMasterDistrict',wardId:'whMasterWard',noteId:'whMasterAddressNote',province:w.province||'',district:w.district||'',ward:w.ward||''});
}
function saveWarehouseMaster(id=''){
  DB.warehouseSites=DB.warehouseSites||[];
  const code=String(document.querySelector('#whMasterCode')?.value||'').trim().toUpperCase();
  const name=String(document.querySelector('#whMasterName')?.value||'').trim();
  const addr=(typeof VNAddress!=='undefined')?VNAddress.read('whMaster'):{province:document.querySelector('#whMasterProvince')?.value?.trim()||'',district:document.querySelector('#whMasterDistrict')?.value?.trim()||'',ward:document.querySelector('#whMasterWard')?.value?.trim()||'',addressDetail:document.querySelector('#whMasterAddressDetail')?.value?.trim()||''};
  if(!addr.address)addr.address=[addr.addressDetail,addr.ward,addr.district,addr.province].filter(Boolean).join(', ');
  if(!code||!name||!addr.address){Toast.err('Thiếu thông tin','Mã kho, tên kho và địa chỉ là bắt buộc.');return;}
  if(!id&&DB.warehouseSites.some(x=>String(x.code||'').toUpperCase()===code)){Toast.err('Mã kho đã tồn tại',code);return;}
  let w=DB.warehouseSites.find(x=>x.id===id);
  if(!w){const nums=DB.warehouseSites.map(x=>Number(String(x.id||'').match(/(\d+)$/)?.[1]||0));const next=Math.max(0,...nums)+1;w={id:`SITE-${String(next).padStart(3,'0')}`};DB.warehouseSites.push(w);}
  Object.assign(w,{code,name,address:addr.address,province:addr.province||'',district:addr.district||'',ward:addr.ward||'',addressDetail:addr.addressDetail||'',managerId:String(document.querySelector('#whMasterManager')?.value||'').trim(),status:document.querySelector('#whMasterStatus')?.value||'active',note:String(document.querySelector('#whMasterNote')?.value||'').trim()});
  // Đồng bộ địa chỉ kho vật lý xuống các khu cũ để Logistics/nhập-xuất hiện hữu vẫn dùng đúng địa điểm.
  warehouseZonesOfSite(w.id).forEach(z=>{z.siteId=w.id;z.address=w.address;z.province=w.province;z.district=w.district;z.ward=w.ward;z.addressDetail=w.addressDetail;});
  if(typeof InventoryAPI!=='undefined')InventoryAPI.scheduleCollections(['warehouseSites','warehouses'],40);
  Modal.close();render();Toast.ok('Đã lưu kho',`${w.code} · ${w.name}`);
}
async function deleteWarehouseMaster(id=''){
  const w=(DB.warehouseSites||[]).find(x=>x.id===id); if(!w)return;
  const zones=warehouseZonesOfSite(id);
  if(zones.length){Toast.err('Không thể xóa kho',`Kho ${w.name} đang có ${zones.length} khu. Hãy ngừng hoạt động kho hoặc xử lý các khu trước để bảo toàn lịch sử.`);return;}
  if(!confirm(`Xóa ${w.code} · ${w.name}?`))return;
  DB.warehouseSites=(DB.warehouseSites||[]).filter(x=>x.id!==id);
  if(typeof InventoryAPI!=='undefined') await InventoryAPI.syncCollections(['warehouseSites']);
  render(); Toast.ok('Đã xóa kho',`${w.code} · ${w.name}`);
}
function openWarehouseMasterDetail(id){
  const w=(DB.warehouseSites||[]).find(x=>x.id===id);if(!w)return;
  const zones=warehouseZonesOfSite(w.id); const stock=zones.reduce((s,z)=>s+warehouseZoneStock(z.id).onHand,0);
  State.filters['inv-warehouses']=Object.assign(F('inv-warehouses'),{siteId:w.id,zoneId:'',itemType:'',q:''}); Modal.close(); render();
}
function openWarehouseZoneForm(siteId,zoneId=''){
  const site=(DB.warehouseSites||[]).find(x=>x.id===siteId); if(!site)return;
  const z=(DB.warehouses||[]).find(x=>x.id===zoneId)||{};
  const types=['RAW_MATERIAL','SEMI_FINISHED','FINISHED_GOODS','PRODUCTION','STORE','DEFECTIVE','RETURNED'];
  Modal.open({title:zoneId?'Cập nhật khu':'Thêm khu',sub:`${site.name} · Khu là vùng nghiệp vụ bên trong kho`,body:`<div class="form-grid cols-2">
    <div class="field"><label>Loại khu *</label><select class="inp" id="whZoneType">${types.map(t=>`<option value="${t}" ${z.type===t?'selected':''}>${warehouseZoneTypeLabel(t)}</option>`).join('')}</select></div>
    <div class="field"><label>Tên khu</label><input class="inp" id="whZoneName" value="${esc(z.zoneName||'')}" placeholder="Để trống để dùng tên theo loại khu"></div>
    <div class="field"><label>Trạng thái</label><select class="inp" id="whZoneStatus"><option value="active" ${z.status!=='inactive'?'selected':''}>Hoạt động</option><option value="inactive" ${z.status==='inactive'?'selected':''}>Ngừng hoạt động</option></select></div>
    <div class="field"><label>Ghi chú</label><input class="inp" id="whZoneNote" value="${esc(z.note||'')}"></div>
  </div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="inv-warehouse-zone-save" data-site="${esc(siteId)}" data-id="${esc(zoneId)}"><i class="fa-solid fa-floppy-disk"></i>Lưu khu</button>`});
}
function saveWarehouseZone(siteId,zoneId=''){
  const site=(DB.warehouseSites||[]).find(x=>x.id===siteId);if(!site)return;
  const type=document.querySelector('#whZoneType')?.value||''; if(!type)return;
  const custom=String(document.querySelector('#whZoneName')?.value||'').trim();
  let z=(DB.warehouses||[]).find(x=>x.id===zoneId);
  if(!z){
    const nums=(DB.warehouses||[]).map(x=>Number(String(x.id||'').match(/(\d+)$/)?.[1]||0));const next=Math.max(0,...nums)+1;
    const prefix=({RAW_MATERIAL:'RAW',SEMI_FINISHED:'SEMI',FINISHED_GOODS:'FIN',PRODUCTION:'PROD',STORE:'STORE',DEFECTIVE:'DEF',RETURNED:'RET'}[type]||'ZONE');
    z={id:`WH-${String(next).padStart(3,'0')}`,code:`${prefix}_${site.code}`,siteId:site.id};DB.warehouses.push(z);
  }
  Object.assign(z,{siteId:site.id,type,zoneName:custom,name:custom||`${warehouseZoneTypeLabel(type)} - ${site.name.replace(/^Kho\s+/i,'')}`,address:site.address,province:site.province||'',district:site.district||'',ward:site.ward||'',addressDetail:site.addressDetail||'',managerId:site.managerId||'',status:document.querySelector('#whZoneStatus')?.value||'active',note:String(document.querySelector('#whZoneNote')?.value||'').trim()});
  if(typeof InventoryAPI!=='undefined')InventoryAPI.scheduleCollections(['warehouses'],40);
  Modal.close();State.filters['inv-warehouses']=Object.assign(F('inv-warehouses'),{siteId:site.id,zoneId:z.id});render();Toast.ok('Đã lưu khu',warehouseZoneTypeLabel(type));
}

function warehouseRackUsage(locationId){
  const rows=(DB.inventory||[]).filter(r=>r.locationId===locationId);
  return rows.reduce((sum,r)=>sum+Number(r.qtyOnHand||0),0);
}
function warehouseRacksOfZone(zoneId){
  return (DB.warehouseLocations||[]).filter(l=>l.warehouseId===zoneId).sort((a,b)=>String(a.code||a.name||'').localeCompare(String(b.code||b.name||''),'vi'));
}
function openWarehouseRackForm(siteId,zoneId,rackId=''){
  const site=(DB.warehouseSites||[]).find(x=>x.id===siteId), zone=(DB.warehouses||[]).find(x=>x.id===zoneId);
  if(!site||!zone)return;
  const r=(DB.warehouseLocations||[]).find(x=>x.id===rackId)||{};
  Modal.open({title:rackId?'Cập nhật kệ':'Thêm kệ',sub:`${site.name} · ${zone.zoneName||warehouseZoneTypeLabel(zone.type)}`,body:`<div class="form-grid cols-2">
    <div class="field"><label>Mã kệ *</label><input class="inp" id="whRackCode" value="${esc(r.code||'')}" ${rackId?'disabled':''} placeholder="VD: A1, TP-B2"></div>
    <div class="field"><label>Tên kệ *</label><input class="inp" id="whRackName" value="${esc(r.name||'')}" placeholder="VD: Kệ A1"></div>
    <div class="field"><label>Sức chứa tối đa</label><input class="inp" id="whRackCapacity" type="number" min="0" step="0.001" value="${Number(r.capacity||0)||''}" placeholder="VD: 1000"></div>
    <div class="field"><label>Đơn vị sức chứa</label><input class="inp" id="whRackCapacityUnit" value="${esc(r.capacityUnit||((zone.type==='RAW_MATERIAL')?'kg':'đơn vị'))}" placeholder="kg, hộp, thùng..."></div>
    <div class="field"><label>Trạng thái</label><select class="inp" id="whRackStatus"><option value="active" ${r.status!=='inactive'?'selected':''}>Đang sử dụng</option><option value="inactive" ${r.status==='inactive'?'selected':''}>Ngừng sử dụng</option></select></div>
    <div class="field"><label>Ghi chú</label><input class="inp" id="whRackNote" value="${esc(r.note||'')}"></div>
    <div class="field" style="grid-column:1/-1"><div class="hint"><i class="fa-solid fa-circle-info"></i> Loại hàng của kệ được kế thừa từ <strong>${esc(zone.zoneName||warehouseZoneTypeLabel(zone.type))}</strong>, không cần khai báo lại để tránh xếp sai loại hàng.</div></div>
  </div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="inv-warehouse-rack-save" data-site="${esc(siteId)}" data-zone="${esc(zoneId)}" data-id="${esc(rackId)}"><i class="fa-solid fa-floppy-disk"></i>Lưu kệ</button>`});
}
function saveWarehouseRack(siteId,zoneId,rackId=''){
  const site=(DB.warehouseSites||[]).find(x=>x.id===siteId), zone=(DB.warehouses||[]).find(x=>x.id===zoneId);if(!site||!zone)return;
  DB.warehouseLocations=DB.warehouseLocations||[];
  const code=String(document.querySelector('#whRackCode')?.value||'').trim().toUpperCase();
  const name=String(document.querySelector('#whRackName')?.value||'').trim();
  if(!code||!name){Toast.err('Thiếu thông tin','Mã kệ và tên kệ là bắt buộc.');return;}
  if(!rackId&&DB.warehouseLocations.some(x=>x.warehouseId===zoneId&&String(x.code||'').toUpperCase()===code)){Toast.err('Mã kệ đã tồn tại',`${code} đã có trong khu này.`);return;}
  let r=DB.warehouseLocations.find(x=>x.id===rackId);
  if(!r){const nums=DB.warehouseLocations.map(x=>Number(String(x.id||'').match(/(\d+)$/)?.[1]||0));const next=Math.max(0,...nums)+1;r={id:`LOC-${String(next).padStart(3,'0')}`,warehouseId:zoneId,parentLocation:'',locationType:'SHELF'};DB.warehouseLocations.push(r);}
  Object.assign(r,{warehouseId:zoneId,code,name,capacity:Math.max(0,Number(document.querySelector('#whRackCapacity')?.value||0)),capacityUnit:String(document.querySelector('#whRackCapacityUnit')?.value||'').trim(),status:document.querySelector('#whRackStatus')?.value||'active',note:String(document.querySelector('#whRackNote')?.value||'').trim(),locationType:'SHELF'});
  if(typeof InventoryAPI!=='undefined')InventoryAPI.scheduleCollections(['warehouseLocations'],40);
  Modal.close();const f=F('inv-warehouses');Object.assign(f,{siteId,zoneId,rackId:r.id,tab:'zones'});render();Toast.ok('Đã lưu kệ',`${r.code} · ${r.name}`);
}
async function deleteWarehouseRack(rackId=''){
  const r=(DB.warehouseLocations||[]).find(x=>x.id===rackId);if(!r)return;
  const hasStock=(DB.inventory||[]).some(x=>x.locationId===rackId&&(Number(x.qtyOnHand||0)!==0||Number(x.qtyReserved||0)!==0||Number(x.qtyPending||0)!==0));
  if(hasStock){Toast.err('Không thể xóa kệ','Kệ vẫn đang có tồn kho/giữ chỗ/chờ QC. Hãy chuyển hết hàng trước.');return;}
  if(!confirm(`Xóa ${r.code||''} · ${r.name||''}?`))return;
  DB.warehouseLocations=(DB.warehouseLocations||[]).filter(x=>x.id!==rackId);
  if(typeof InventoryAPI!=='undefined')await InventoryAPI.syncCollections(['warehouseLocations']);
  const f=F('inv-warehouses');if(f.rackId===rackId)f.rackId='';render();Toast.ok('Đã xóa kệ',r.name||r.code||rackId);
}


function warehouseInventoryItemType(productId) {
  if ((DB.materials || []).some(x => x.id === productId)) return 'RAW_MATERIAL';
  if ((DB.semiFinishedProducts || []).some(x => x.id === productId)) return 'SEMI_FINISHED';
  if ((DB.products || []).some(x => x.id === productId)) return 'FINISHED_GOODS';
  return 'OTHER';
}
function warehouseInventoryTypeLabel(type) {
  return ({
    RAW_MATERIAL: 'Nguyên liệu',
    SEMI_FINISHED: 'Bán thành phẩm',
    FINISHED_GOODS: 'Thành phẩm',
    OTHER: 'Khác',
  })[type] || type || 'Khác';
}
function warehouseInventoryItem(productId) {
  return Q.material(productId)
    || (DB.semiFinishedProducts || []).find(x => x.id === productId)
    || Q.product(productId)
    || null;
}

Views['inv-warehouse-browser'] = function () {
  const f = F('inv-warehouse-browser', { warehouseId: '', itemType: '', q: '' });
  const warehouses = (DB.warehouses || []).filter(w => w.status !== 'inactive');
  const warehouseOptions = warehouses.map(w => [w.id, `${w.code || w.id} · ${w.name}`]);
  const selectedWarehouse = (DB.warehouses || []).find(w => w.id === f.warehouseId) || null;
  const q = String(f.q || '').toLowerCase().trim();

  let rowsSource = (DB.inventory || []).filter(r => Number(r.qtyOnHand || 0) !== 0 || Number(r.qtyReserved || 0) !== 0 || Number(r.qtyPending || 0) !== 0);
  if (f.warehouseId) rowsSource = rowsSource.filter(r => r.warehouseId === f.warehouseId);
  if (f.itemType) rowsSource = rowsSource.filter(r => warehouseInventoryItemType(r.productId) === f.itemType);

  const grouped = new Map();
  rowsSource.forEach(r => {
    const item = warehouseInventoryItem(r.productId);
    const wh = Q.warehouse(r.warehouseId);
    const lot = Q.lot(r.lotId);
    const loc = Q.warehouseLocation(r.locationId);
    const type = warehouseInventoryItemType(r.productId);
    const searchable = [r.productId, item?.name, item?.unit, warehouseInventoryTypeLabel(type), wh?.name, wh?.code, lot?.lotNumber, loc?.name].join(' ').toLowerCase();
    if (q && !searchable.includes(q)) return;
    const key = `${r.warehouseId}::${r.productId}`;
    if (!grouped.has(key)) grouped.set(key, {
      warehouseId: r.warehouseId,
      productId: r.productId,
      type,
      qtyOnHand: 0,
      qtyReserved: 0,
      qtyAvailable: 0,
      qtyPending: 0,
      lotIds: new Set(),
      locationIds: new Set(),
    });
    const g = grouped.get(key);
    g.qtyOnHand += Number(r.qtyOnHand || 0);
    g.qtyReserved += Number(r.qtyReserved || 0);
    g.qtyAvailable += Number(r.qtyAvailable != null ? r.qtyAvailable : (Number(r.qtyOnHand || 0) - Number(r.qtyReserved || 0)));
    g.qtyPending += Number(r.qtyPending || 0);
    if (r.lotId) g.lotIds.add(r.lotId);
    if (r.locationId) g.locationIds.add(r.locationId);
  });

  const groups = [...grouped.values()].sort((a,b) => {
    const aw = Q.warehouseName(a.warehouseId), bw = Q.warehouseName(b.warehouseId);
    if (aw !== bw) return String(aw).localeCompare(String(bw),'vi');
    const ai = warehouseInventoryItem(a.productId), bi = warehouseInventoryItem(b.productId);
    return String(ai?.name || a.productId).localeCompare(String(bi?.name || b.productId),'vi');
  });

  const totalOnHand = groups.reduce((s,g)=>s+g.qtyOnHand,0);
  const totalAvailable = groups.reduce((s,g)=>s+g.qtyAvailable,0);
  const totalReserved = groups.reduce((s,g)=>s+g.qtyReserved,0);
  const skuCount = new Set(groups.map(g=>g.productId)).size;

  const whInfo = selectedWarehouse ? (() => {
    const locs = Q.locationsOf(selectedWarehouse.id);
    const whRows = (DB.inventory || []).filter(r => r.warehouseId === selectedWarehouse.id);
    const whOnHand = whRows.reduce((s,r)=>s+Number(r.qtyOnHand||0),0);
    const whAvailable = whRows.reduce((s,r)=>s+Number(r.qtyAvailable != null ? r.qtyAvailable : Number(r.qtyOnHand||0)-Number(r.qtyReserved||0)),0);
    const manager = (DB.employees || []).find(e => e.id === selectedWarehouse.managerId);
    return `<div class="card" style="margin-bottom:14px">
      <div class="card-head"><div><div class="card-title"><i class="fa-solid fa-warehouse"></i>${esc(selectedWarehouse.code || selectedWarehouse.id)} · ${esc(selectedWarehouse.name)}</div><div class="card-sub">Thông tin kho đang chọn</div></div></div>
      <div class="info-grid">
        ${infoItem('Loại kho', esc(warehouseTypeLabel(selectedWarehouse.type)))}
        ${infoItem('Trạng thái', selectedWarehouse.status === 'active' ? '<span class="badge green">Đang hoạt động</span>' : '<span class="badge slate">Ngừng hoạt động</span>')}
        ${infoItem('Địa chỉ', esc(selectedWarehouse.address || 'Chưa khai báo'))}
        ${infoItem('Người phụ trách', esc(manager?.name || selectedWarehouse.managerId || 'Chưa khai báo'))}
        ${infoItem('Số vị trí lưu trữ', String(locs.length))}
        ${infoItem('Tổng tồn thực tế', fmtDec(whOnHand, 3))}
        ${infoItem('Tồn khả dụng', fmtDec(whAvailable, 3))}
      </div>
      ${selectedWarehouse.note ? `<div class="cell-sub" style="margin-top:10px"><i class="fa-solid fa-note-sticky"></i> ${esc(selectedWarehouse.note)}</div>` : ''}
    </div>`;
  })() : `<div class="alert-item" style="margin-bottom:14px"><span class="alert-ico t-blue"><i class="fa-solid fa-circle-info"></i></span><span><span class="alert-title">Chọn một kho để xem đầy đủ thông tin kho</span><div class="alert-sub">Bạn vẫn có thể để “Tất cả kho” để so sánh tồn giữa nhiều địa điểm.</div></span></div>`;

  const rows = groups.map(g => {
    const item = warehouseInventoryItem(g.productId);
    const wh = Q.warehouse(g.warehouseId);
    const locations = [...g.locationIds].map(id => Q.locationName(id)).filter(Boolean);
    const unit = item?.unit || '';
    return `<tr>
      <td>${cell2(`<span class="code">${esc(g.productId)}</span>`, esc(item?.name || g.productId))}</td>
      <td><span class="badge ${g.type === 'RAW_MATERIAL' ? 'blue' : g.type === 'SEMI_FINISHED' ? 'indigo' : 'green'}">${esc(warehouseInventoryTypeLabel(g.type))}</span></td>
      <td>${cell2(esc(wh?.name || g.warehouseId), esc(wh?.address || ''))}</td>
      <td>${esc(locations.join(', ') || '—')}</td>
      <td class="center num">${g.lotIds.size}</td>
      <td class="right strong num">${fmtDec(g.qtyOnHand,3)} ${esc(unit)}</td>
      <td class="right num">${fmtDec(g.qtyReserved,3)} ${esc(unit)}</td>
      <td class="right strong num">${fmtDec(g.qtyAvailable,3)} ${esc(unit)}</td>
      <td class="right num">${fmtDec(g.qtyPending,3)} ${esc(unit)}</td>
    </tr>`;
  });

  return `${pageHead('Kho', 'Xem tồn kho theo từng địa điểm vật lý và lọc theo loại hàng hóa. Dữ liệu lấy từ tồn kho hiện tại trên server.')}
    <div class="card" style="margin-bottom:14px">
      <div class="toolbar">
        ${selectFilter('inv-warehouse-browser','warehouseId',warehouseOptions,'Tất cả kho')}
        ${selectFilter('inv-warehouse-browser','itemType',[
          ['RAW_MATERIAL','Nguyên liệu'],
          ['SEMI_FINISHED','Bán thành phẩm'],
          ['FINISHED_GOODS','Thành phẩm']
        ],'Tất cả loại tồn')}
        ${searchBox('inv-warehouse-browser','Tìm mã, tên hàng, lô, vị trí…')}
        ${(f.warehouseId || f.itemType || f.q) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="inv-warehouse-browser"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
        <span class="spacer"></span><span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(groups.length)} dòng</span>
      </div>
    </div>
    ${whInfo}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Mã hàng', skuCount, 'fa-barcode', 'blue')}
      ${mkpi('Tổng tồn', fmtDec(totalOnHand,3), 'fa-boxes-stacked', 'teal')}
      ${mkpi('Đang giữ chỗ', fmtDec(totalReserved,3), 'fa-cart-flatbed', 'orange')}
      ${mkpi('Khả dụng', fmtDec(totalAvailable,3), 'fa-circle-check', 'green')}
    </div>
    <div class="card">${tableShell([
      {t:'Mã / Tên hàng'}, {t:'Loại tồn'}, {t:'Kho'}, {t:'Vị trí'}, {t:'Số lô',cls:'center'},
      {t:'Tồn thực tế',cls:'right'}, {t:'Giữ chỗ',cls:'right'}, {t:'Khả dụng',cls:'right'}, {t:'Chờ QC',cls:'right'}
    ], rows, {emptyTitle:'Không có tồn kho phù hợp', emptyDesc:'Thử chọn kho hoặc loại tồn khác.'})}</div>`;
};

Views['inv-warehouses'] = function () {
  const f = F('inv-warehouses', { siteId:'', zoneId:'', rackId:'', itemType:'', q:'', tab:'overview' });
  const q=String(f.q||'').trim().toLowerCase();
  const sites=warehouseSitesList();
  const selectedSite=sites.find(x=>x.id===f.siteId)||null;
  const allZones=(DB.warehouses||[]);

  const siteRows=sites.map(site=>{
    const zones=warehouseZonesOfSite(site.id), zoneIds=new Set(zones.map(z=>z.id));
    const stockRows=(DB.inventory||[]).filter(r=>zoneIds.has(r.warehouseId));
    const onHand=stockRows.reduce((s,r)=>s+Number(r.qtyOnHand||0),0);
    const available=stockRows.reduce((s,r)=>s+Number(r.qtyAvailable!=null?r.qtyAvailable:(Number(r.qtyOnHand||0)-Number(r.qtyReserved||0))),0);
    const shelves=(DB.warehouseLocations||[]).filter(l=>zoneIds.has(l.warehouseId)&&l.status!=='inactive').length;
    const skuCount=new Set(stockRows.filter(r=>Number(r.qtyOnHand||0)!==0).map(r=>r.productId)).size;
    const lotCount=new Set(stockRows.filter(r=>r.lotId).map(r=>r.lotId)).size;
    return `<tr class="clickable" data-act="inv-warehouse-site-open" data-id="${esc(site.id)}">
      <td><span class="code">${esc(site.code||site.id)}</span></td>
      <td class="strong">${esc(site.name)}<div class="cell-sub">${esc(site.address||'Chưa khai báo địa chỉ')}</div></td>
      <td class="center num">${zones.length}</td><td class="center num">${shelves}</td><td class="center num">${skuCount}</td><td class="center num">${lotCount}</td>
      <td class="right num">${fmtDec(onHand,3)}</td><td>${site.status==='active'?'<span class="badge green">Đang hoạt động</span>':'<span class="badge slate">Ngừng hoạt động</span>'}</td>
      <td class="right" onclick="event.stopPropagation()">${rowActions([
        {act:'inv-warehouse-site-open',data:`data-id="${esc(site.id)}"`,icon:'fa-eye',title:'Mở kho'},
        {act:'inv-warehouse-edit',data:`data-id="${esc(site.id)}"`,icon:'fa-pen',title:'Sửa kho'},
        ...(zones.length===0?[{act:'inv-warehouse-delete',data:`data-id="${esc(site.id)}"`,icon:'fa-trash',title:'Xóa kho'}]:[])
      ])}</td></tr>`;
  });

  if(!selectedSite){
    const totalShelves=(DB.warehouseLocations||[]).filter(x=>x.status!=='inactive').length;
    return `${pageHead('Quản lý kho','Danh sách kho vật lý. Bấm vào một kho để quản lý khu, kệ, tồn kho, lô và lịch sử.',inventoryCanOperate() ? '<button class="btn btn-primary" data-act="inv-warehouse-new"><i class="fa-solid fa-plus"></i>Thêm kho</button>' : '')}
      <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Tổng kho',sites.length,'fa-warehouse','blue')}${mkpi('Đang hoạt động',sites.filter(x=>x.status==='active').length,'fa-circle-check','green')}${mkpi('Tổng khu',allZones.length,'fa-border-all','indigo')}${mkpi('Tổng kệ',totalShelves,'fa-layer-group','teal')}</div>
      <div class="card"><div class="card-head"><div><div class="card-title"><i class="fa-solid fa-warehouse"></i>Danh sách kho</div><div class="card-sub">Kho là địa điểm vật lý như Kho Thủ Đức, Kho Bình Dương, Kho Đồng Nai.</div></div></div>
      ${tableShell([{t:'Mã kho'},{t:'Tên kho / Địa chỉ'},{t:'Khu',cls:'center'},{t:'Kệ',cls:'center'},{t:'Mặt hàng',cls:'center'},{t:'Lô',cls:'center'},{t:'Tổng tồn',cls:'right'},{t:'Trạng thái'},{t:'Thao tác',cls:'right',w:'115px'}],siteRows,{emptyTitle:'Chưa có kho',emptyDesc:'Bấm Thêm kho để khai báo địa điểm kho đầu tiên.'})}</div>`;
  }

  const siteZones=warehouseZonesOfSite(selectedSite.id), siteZoneIds=new Set(siteZones.map(z=>z.id));
  const siteInv=(DB.inventory||[]).filter(r=>siteZoneIds.has(r.warehouseId));
  const siteStock=siteInv.reduce((s,r)=>s+Number(r.qtyOnHand||0),0);
  const siteAvailable=siteInv.reduce((s,r)=>s+Number(r.qtyAvailable!=null?r.qtyAvailable:(Number(r.qtyOnHand||0)-Number(r.qtyReserved||0))),0);
  const activeShelves=(DB.warehouseLocations||[]).filter(l=>siteZoneIds.has(l.warehouseId)&&l.status!=='inactive');
  const skuCount=new Set(siteInv.filter(r=>Number(r.qtyOnHand||0)!==0).map(r=>r.productId)).size;
  const lotCount=new Set(siteInv.filter(r=>r.lotId).map(r=>r.lotId)).size;
  const selectedZone=siteZones.find(z=>z.id===f.zoneId)||null;
  const selectedRack=(DB.warehouseLocations||[]).find(r=>r.id===f.rackId&&siteZoneIds.has(r.warehouseId))||null;
  const tab=f.tab==='history'?'overview':(f.tab||'overview');
  const tabs=[['overview','Tổng quan','fa-chart-pie'],['zones','Khu & Kệ','fa-layer-group'],['stock','Tồn kho','fa-boxes-stacked'],['lots','Lô & HSD','fa-calendar-days']];
  const topBack=`<div style="display:flex;align-items:center;margin:0 0 10px"><button class="btn" data-act="inv-warehouse-site-back"><i class="fa-solid fa-arrow-left"></i>Trở về danh sách kho</button></div>`;
  const tabBar=`<div class="card" style="padding:8px;margin-bottom:14px"><div style="display:flex;gap:6px;flex-wrap:wrap">${tabs.map(([id,label,icon])=>`<button class="btn ${tab===id?'btn-primary':''}" data-act="inv-warehouse-tab" data-tab="${id}"><i class="fa-solid ${icon}"></i>${label}</button>`).join('')}</div></div>`;
  const header=`${topBack}${pageHead('Quản lý kho',`${selectedSite.name} · ${selectedSite.address||'Chưa khai báo địa chỉ'}`,inventoryCanOperate() ? `<button class="btn" data-act="inv-warehouse-edit" data-id="${esc(selectedSite.id)}"><i class="fa-solid fa-pen"></i>Sửa thông tin kho</button>` : '')}`;

  let content='';
  if(tab==='overview'){
    const zoneSummary=siteZones.map(z=>{const st=warehouseZoneStock(z.id), racks=warehouseRacksOfZone(z.id).filter(r=>r.status!=='inactive');return `<tr class="clickable" data-act="inv-warehouse-zone-open" data-site="${esc(selectedSite.id)}" data-id="${esc(z.id)}"><td class="strong">${esc(z.zoneName||warehouseZoneTypeLabel(z.type))}<div class="cell-sub">${esc(warehouseInventoryTypeLabel(z.type))}</div></td><td class="center num">${racks.length}</td><td class="right num">${fmtDec(st.onHand,3)}</td><td class="right num">${fmtDec(st.available,3)}</td><td>${z.status==='inactive'?'<span class="badge slate">Ngừng hoạt động</span>':'<span class="badge green">Hoạt động</span>'}</td></tr>`;});
    content=`<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Số khu',siteZones.length,'fa-border-all','indigo')}${mkpi('Số kệ',activeShelves.length,'fa-layer-group','teal')}${mkpi('Mặt hàng đang lưu',skuCount,'fa-box','blue')}${mkpi('Số lô',lotCount,'fa-tags','orange')}${mkpi('Tổng tồn',fmtDec(siteStock,3),'fa-cubes','blue')}${mkpi('Khả dụng',fmtDec(siteAvailable,3),'fa-circle-check','green')}</div>
      <div class="card"><div class="card-head"><div><div class="card-title"><i class="fa-solid fa-border-all"></i>Tổng quan các khu</div><div class="card-sub">Bấm vào khu để chuyển sang quản lý Khu & Kệ.</div></div><button class="btn btn-primary" data-act="inv-warehouse-zone-new" data-site="${esc(selectedSite.id)}"><i class="fa-solid fa-plus"></i>Thêm khu</button></div>${tableShell([{t:'Khu'},{t:'Số kệ',cls:'center'},{t:'Tồn',cls:'right'},{t:'Khả dụng',cls:'right'},{t:'Trạng thái'}],zoneSummary,{emptyTitle:'Chưa có khu',emptyDesc:'Bấm Thêm khu để tạo khu đầu tiên.'})}</div>`;
  }

  if(tab==='zones'){
    let zoneList=siteZones;
    if(f.itemType)zoneList=zoneList.filter(z=>z.type===f.itemType);
    const zoneButtons=zoneList.map(z=>{const st=warehouseZoneStock(z.id),racks=warehouseRacksOfZone(z.id),active=selectedZone?.id===z.id;return `<button type="button" class="card clickable" data-act="inv-warehouse-zone-open" data-site="${esc(selectedSite.id)}" data-id="${esc(z.id)}" style="width:100%;text-align:left;padding:12px;margin-bottom:8px;border:${active?'2px solid var(--blue)':'1px solid var(--border)'}"><div class="strong">${esc(z.zoneName||warehouseZoneTypeLabel(z.type))}</div><div class="cell-sub">${racks.length} kệ · Tồn ${fmtDec(st.onHand,3)}</div></button>`;}).join('');
    let rackPanel=`<div class="empty"><i class="fa-solid fa-arrow-left"></i><div class="empty-title">Chọn một khu</div><div class="empty-desc">Chọn khu bên trái để xem và quản lý các kệ.</div></div>`;
    if(selectedZone){
      const racks=warehouseRacksOfZone(selectedZone.id);
      const rackCards=racks.map(r=>{const used=warehouseRackUsage(r.id),cap=Number(r.capacity||0),pct=cap>0?Math.min(100,(used/cap)*100):0,active=selectedRack?.id===r.id;const free=cap>0?Math.max(0,cap-used):null;const state=cap>0?(pct>=100?'Đầy':pct>=80?'Gần đầy':'Còn chỗ'):'Chưa đặt sức chứa';return `<div class="card" style="padding:12px;border:${active?'2px solid var(--blue)':'1px solid var(--border)'}"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><button class="clickable" style="border:0;background:none;text-align:left;padding:0;min-width:0;flex:1" data-act="inv-warehouse-rack-open" data-id="${esc(r.id)}"><div class="strong"><i class="fa-solid fa-layer-group"></i> ${esc(r.code||'')} · ${esc(r.name||'')}</div><div class="cell-sub">${esc(state)}${cap>0?` · ${fmtDec(used,3)} / ${fmtDec(cap,3)} ${esc(r.capacityUnit||'')}`:''}</div></button><div>${rowActions([{act:'inv-warehouse-rack-edit',data:`data-site="${esc(selectedSite.id)}" data-zone="${esc(selectedZone.id)}" data-id="${esc(r.id)}"`,icon:'fa-pen',title:'Sửa kệ'},{act:'inv-warehouse-rack-delete',data:`data-id="${esc(r.id)}"`,icon:'fa-trash',title:'Xóa kệ'}])}</div></div>${cap>0?`<div style="height:7px;background:var(--surface-2);border-radius:99px;overflow:hidden;margin-top:10px"><div style="height:100%;width:${pct}%;background:${pct>=100?'var(--red)':pct>=80?'var(--orange)':'var(--green)'}"></div></div><div class="cell-sub" style="margin-top:5px">Đã dùng ${pct.toFixed(1).replace('.',',')}%${free!=null?` · Còn ${fmtDec(free,3)} ${esc(r.capacityUnit||'')}`:''}</div>`:''}</div>`;}).join('');
      rackPanel=`<div class="card-head"><div><div class="card-title">${esc(selectedZone.zoneName||warehouseZoneTypeLabel(selectedZone.type))}</div><div class="card-sub">Kệ kế thừa loại hàng của khu: ${esc(warehouseInventoryTypeLabel(selectedZone.type))}</div></div><div style="display:flex;gap:8px"><button class="btn btn-sm" data-act="inv-warehouse-zone-edit" data-site="${esc(selectedSite.id)}" data-id="${esc(selectedZone.id)}"><i class="fa-solid fa-pen"></i>Sửa khu</button><button class="btn btn-primary btn-sm" data-act="inv-warehouse-rack-new" data-site="${esc(selectedSite.id)}" data-zone="${esc(selectedZone.id)}"><i class="fa-solid fa-plus"></i>Thêm kệ</button></div></div><div class="grid g-auto-sm" style="gap:10px">${rackCards||'<div class="empty" style="grid-column:1/-1"><i class="fa-solid fa-layer-group"></i><div class="empty-title">Khu chưa có kệ</div><div class="empty-desc">Bấm Thêm kệ để khai báo vị trí chứa hàng.</div></div>'}</div>`;
      if(selectedRack){
        const rows=siteInv.filter(x=>x.locationId===selectedRack.id&&(Number(x.qtyOnHand||0)!==0||Number(x.qtyReserved||0)!==0||Number(x.qtyPending||0)!==0));
        const body=rows.map(r=>{const item=warehouseInventoryItem(r.productId),lot=Q.lot(r.lotId),unit=item?.unit||r.unit||'';return `<tr><td>${cell2(`<span class="code">${esc(r.productId)}</span>`,esc(item?.name||r.productId))}</td><td><span class="code">${esc(lot?.lotNumber||'—')}</span>${lot?.expiryDate?`<div class="cell-sub">HSD ${fmtDate(lot.expiryDate)}</div>`:''}</td><td class="right strong num">${fmtDec(r.qtyOnHand,3)} ${esc(unit)}</td><td class="right num">${fmtDec(r.qtyAvailable!=null?r.qtyAvailable:(Number(r.qtyOnHand||0)-Number(r.qtyReserved||0)),3)} ${esc(unit)}</td></tr>`;});
        rackPanel+=`<div class="card" style="margin-top:14px"><div class="card-head"><div><div class="card-title"><i class="fa-solid fa-box-open"></i>Hàng trong ${esc(selectedRack.code||selectedRack.name)}</div><div class="card-sub">${esc(selectedRack.name||'')} · ${rows.length} dòng tồn</div></div><button class="btn btn-sm" data-act="inv-warehouse-rack-close"><i class="fa-solid fa-arrow-left"></i>Trở về danh sách kệ</button></div>${tableShell([{t:'Mặt hàng'},{t:'Lô / HSD'},{t:'Tồn',cls:'right'},{t:'Khả dụng',cls:'right'}],body,{emptyTitle:'Kệ đang trống'})}</div>`;
      }
    }
    content=`<div class="card"><div class="card-head"><div><div class="card-title"><i class="fa-solid fa-layer-group"></i>Khu & Kệ</div><div class="card-sub">Chọn khu bên trái, quản lý kệ bên phải, sau đó bấm kệ để xem hàng đang chứa.</div></div><button class="btn btn-primary" data-act="inv-warehouse-zone-new" data-site="${esc(selectedSite.id)}"><i class="fa-solid fa-plus"></i>Thêm khu</button></div><div class="toolbar">${selectFilter('inv-warehouses','itemType',[['RAW_MATERIAL','Nguyên liệu'],['SEMI_FINISHED','Bán thành phẩm'],['FINISHED_GOODS','Thành phẩm'],['STORE','Kho cửa hàng']],'Tất cả loại khu')}</div><div style="display:grid;grid-template-columns:minmax(230px,30%) 1fr;gap:14px"><div style="min-width:0">${zoneButtons||'<div class="empty"><div class="empty-title">Chưa có khu</div></div>'}</div><div style="min-width:0">${rackPanel}</div></div></div>`;
  }

  if(tab==='stock'){
    let rows=siteInv.filter(r=>Number(r.qtyOnHand||0)!==0||Number(r.qtyReserved||0)!==0||Number(r.qtyPending||0)!==0);
    if(f.zoneId)rows=rows.filter(r=>r.warehouseId===f.zoneId);
    if(f.rackId)rows=rows.filter(r=>r.locationId===f.rackId);
    if(f.itemType)rows=rows.filter(r=>warehouseInventoryItemType(r.productId)===f.itemType);
    if(q)rows=rows.filter(r=>{const item=warehouseInventoryItem(r.productId),loc=Q.warehouseLocation(r.locationId),lot=Q.lot(r.lotId);return [r.productId,item?.name,loc?.code,loc?.name,lot?.lotNumber].join(' ').toLowerCase().includes(q);});
    const body=rows.map(r=>{const item=warehouseInventoryItem(r.productId),loc=Q.warehouseLocation(r.locationId),lot=Q.lot(r.lotId),zone=(DB.warehouses||[]).find(z=>z.id===r.warehouseId),type=warehouseInventoryItemType(r.productId),unit=item?.unit||r.unit||'';return `<tr><td>${cell2(`<span class="code">${esc(r.productId)}</span>`,esc(item?.name||r.productId))}</td><td>${esc(zone?.zoneName||warehouseZoneTypeLabel(zone?.type))}</td><td>${cell2(esc(loc?.code||'—'),esc(loc?.name||'Chưa gán kệ'))}</td><td><span class="code">${esc(lot?.lotNumber||'—')}</span>${lot?.expiryDate?`<div class="cell-sub">HSD ${fmtDate(lot.expiryDate)}</div>`:''}</td><td class="right strong num">${fmtDec(r.qtyOnHand,3)} ${esc(unit)}</td><td class="right num">${fmtDec(r.qtyReserved||0,3)}</td><td class="right strong num">${fmtDec(r.qtyAvailable!=null?r.qtyAvailable:(Number(r.qtyOnHand||0)-Number(r.qtyReserved||0)),3)}</td></tr>`;});
    const zoneOpts=siteZones.map(z=>[z.id,z.zoneName||warehouseZoneTypeLabel(z.type)]), rackOpts=(f.zoneId?warehouseRacksOfZone(f.zoneId):activeShelves).map(r=>[r.id,`${r.code} · ${r.name}`]);
    content=`<div class="card"><div class="card-head"><div><div class="card-title"><i class="fa-solid fa-boxes-stacked"></i>Tồn kho</div><div class="card-sub">Lọc từ Kho → Khu → Kệ để xem đúng vị trí hàng hóa.</div></div></div><div class="toolbar">${selectFilter('inv-warehouses','zoneId',zoneOpts,'Tất cả khu')}${selectFilter('inv-warehouses','rackId',rackOpts,'Tất cả kệ')}${selectFilter('inv-warehouses','itemType',[['RAW_MATERIAL','Nguyên liệu'],['SEMI_FINISHED','Bán thành phẩm'],['FINISHED_GOODS','Thành phẩm']],'Tất cả loại')}${searchBox('inv-warehouses','Tìm mã hàng, tên hàng, lô, kệ…')}</div>${tableShell([{t:'Mặt hàng'},{t:'Khu'},{t:'Kệ'},{t:'Lô / HSD'},{t:'Tồn',cls:'right'},{t:'Giữ chỗ',cls:'right'},{t:'Khả dụng',cls:'right'}],body,{emptyTitle:'Không có tồn kho phù hợp'})}</div>`;
  }

  if(tab==='lots'){
    const lotIds=new Set(siteInv.filter(r=>r.lotId).map(r=>r.lotId));
    let lots=(DB.inventoryLots||[]).filter(l=>lotIds.has(l.id));
    if(q)lots=lots.filter(l=>{const item=warehouseInventoryItem(l.productId);return [l.lotNumber,l.productId,item?.name].join(' ').toLowerCase().includes(q);});
    const body=lots.map(l=>{const item=warehouseInventoryItem(l.productId);const invRows=siteInv.filter(r=>r.lotId===l.id);const qty=invRows.reduce((s,r)=>s+Number(r.qtyOnHand||0),0);const locNames=[...new Set(invRows.map(r=>Q.warehouseLocation(r.locationId)?.code).filter(Boolean))].join(', ');return `<tr><td><span class="code">${esc(l.lotNumber||l.id)}</span></td><td>${cell2(`<span class="code">${esc(l.productId||'')}</span>`,esc(item?.name||''))}</td><td>${fmtDate(l.productionDate||l.manufactureDate||l.createdDate||'')}</td><td>${l.expiryDate?fmtDate(l.expiryDate):'—'}</td><td>${esc(locNames||'—')}</td><td class="right strong num">${fmtDec(qty,3)} ${esc(item?.unit||'')}</td></tr>`;});
    content=`<div class="card"><div class="card-head"><div><div class="card-title"><i class="fa-solid fa-calendar-days"></i>Lô & HSD</div><div class="card-sub">Các lô hiện đang có tồn trong ${esc(selectedSite.name)}.</div></div></div><div class="toolbar">${searchBox('inv-warehouses','Tìm số lô, mã hoặc tên hàng…')}</div>${tableShell([{t:'Số lô'},{t:'Mặt hàng'},{t:'Ngày sản xuất'},{t:'Hạn sử dụng'},{t:'Kệ đang chứa'},{t:'Tồn',cls:'right'}],body,{emptyTitle:'Chưa có lô trong kho'})}</div>`;
  }

  if(tab==='history'){
    let tx=(DB.inventoryTransactions||[]).filter(t=>siteZoneIds.has(t.warehouseId));
    if(q)tx=tx.filter(t=>[t.id,t.transactionNumber,t.productId,t.note].join(' ').toLowerCase().includes(q));
    tx=tx.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,300);
    const body=tx.map(t=>{const item=warehouseInventoryItem(t.productId),zone=(DB.warehouses||[]).find(z=>z.id===t.warehouseId),lot=Q.lot(t.lotId);return `<tr><td>${fmtDT(t.createdAt||t.date)}</td><td>${esc(t.type||'')}</td><td>${cell2(`<span class="code">${esc(t.productId||'')}</span>`,esc(item?.name||''))}</td><td>${esc(zone?.zoneName||warehouseZoneTypeLabel(zone?.type))}</td><td><span class="code">${esc(lot?.lotNumber||'—')}</span></td><td class="right num" style="color:${Number(t.qty||0)<0?'var(--orange)':'var(--green)'}">${Number(t.qty||0)>0?'+':''}${fmtDec(t.qty||0,3)}</td><td>${esc(t.note||'')}</td></tr>`;});
    content=`<div class="card"><div class="card-head"><div><div class="card-title"><i class="fa-solid fa-clock-rotate-left"></i>Lịch sử nhập xuất</div><div class="card-sub">Tối đa 300 giao dịch gần nhất của các khu thuộc kho này.</div></div></div><div class="toolbar">${searchBox('inv-warehouses','Tìm mã hàng, giao dịch, ghi chú…')}</div>${tableShell([{t:'Ngày'},{t:'Loại'},{t:'Mặt hàng'},{t:'Khu'},{t:'Lô'},{t:'SL',cls:'right'},{t:'Diễn giải'}],body,{emptyTitle:'Chưa có lịch sử giao dịch'})}</div>`;
  }

  return `${header}${tabBar}${content}`;
};

Views['inv-transactions'] = function () {
  const rows = Q.txOf().map((tx) => `<tr><td><span class="code">${esc(tx.id)}</span><div class="cell-sub">${esc(tx.transactionNumber)}</div></td><td>${esc(tx.type)}</td><td><span class="code">${esc(tx.productId)}</span><div class="cell-sub">${esc(Q.material(tx.productId)?.name || Q.product(tx.productId)?.name || '')}</div></td><td>${esc(Q.warehouseName(tx.warehouseId))}</td><td>${esc(Q.lot(tx.lotId)?.lotNumber || '—')}</td><td class="right num" style="color:${tx.qty < 0 ? 'var(--orange)' : 'var(--green)'}">${tx.qty > 0 ? '+' : ''}${fmtDec(tx.qty, 2)}</td><td class="right num">${fmtDec(tx.qtyBefore, 2)} → ${fmtDec(tx.qtyAfter, 2)}</td><td class="num">${fmtDT(tx.createdAt||tx.date)}</td><td class="muted">${esc(tx.note || '')}</td><td class="right">${rowActions([{act:'inv-tx-view',data:`data-id="${esc(tx.id)}"`,icon:'fa-eye',title:'Xem chi tiết giao dịch'}])}</td></tr>`);
  const txs = Q.txOf();
  const totalIn = txs.filter(tx=>Number(tx.qty||0)>0).reduce((sum,tx)=>sum+Number(tx.qty||0),0);
  const totalOut = Math.abs(txs.filter(tx=>Number(tx.qty||0)<0).reduce((sum,tx)=>sum+Number(tx.qty||0),0));
  return `${pageHead('Sổ giao dịch kho', 'Ledger bất biến của mọi biến động nhập, xuất, chuyển kho, sản xuất và điều chỉnh', '<button class="btn" data-act="inv-export-transactions"><i class="fa-solid fa-file-export"></i>Xuất Excel</button>')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng giao dịch', txs.length, 'fa-book', 'blue')}
      ${mkpi('Tổng nhập', fmtN(totalIn), 'fa-arrow-down', 'green')}
      ${mkpi('Tổng xuất', fmtN(totalOut), 'fa-arrow-up', 'orange')}
      ${mkpi('Giao dịch hôm nay', txs.filter(tx=>String(tx.date||'').slice(0,10)===String(DB.today||'').slice(0,10)).length, 'fa-calendar-day', 'indigo')}
    </div>
    <div class="card">${tableShell([{ t: 'Giao dịch' }, { t: 'Loại' }, { t: 'Sản phẩm' }, { t: 'Kho' }, { t: 'Lô' }, { t: 'Số lượng', cls: 'right' }, { t: 'Trước → Sau', cls: 'right' }, { t: 'Ngày' }, { t: 'Diễn giải' }, {t:'Thao tác',cls:'right'}], rows, { emptyTitle: 'Chưa có giao dịch kho' })}</div>`;
};

Views['inv-alerts'] = function () {
  const low = Q.lowStockAlerts();
  const over = DB.materials.filter((m) => m.maxStock != null && m.stock >= m.maxStock);
  const near = Q.nearExpiryLots();
  const expired = Q.expiredLots();
  const slow = Q.slowMoving();
  const rows = [
    ...low.map((x) => `<tr><td><span class="badge orange">LOW STOCK</span></td><td>${esc(x.material.id)} · ${esc(x.material.name)}</td><td class="right num">${fmtDec(x.available, 2)} / ${fmtDec(x.minimum, 2)} ${esc(x.material.unit)}</td><td>Đề nghị mua hàng</td></tr>`),
    ...over.map((m) => `<tr><td><span class="badge red">OVER STOCK</span></td><td>${esc(m.id)} · ${esc(m.name)}</td><td class="right num">${fmtDec(m.stock, 2)} / ${fmtDec(m.maxStock, 2)} ${esc(m.unit)}</td><td>Kiểm tra mức tồn tối đa</td></tr>`),
    ...near.map((lot) => `<tr><td><span class="badge orange">NEAR EXPIRY</span></td><td>${esc(lot.productId)} · ${esc(lot.lotNumber)}</td><td class="num">HSD ${fmtDate(lot.expiryDate)}</td><td>Ưu tiên FEFO</td></tr>`),
    ...expired.map((lot) => `<tr><td><span class="badge red">EXPIRED</span></td><td>${esc(lot.productId)} · ${esc(lot.lotNumber)}</td><td class="num">HSD ${fmtDate(lot.expiryDate)}</td><td>Chuyển kho lỗi / tiêu hủy</td></tr>`),
    ...slow.map((x) => `<tr><td><span class="badge slate">SLOW MOVING</span></td><td>${esc(x.material.id)} · ${esc(x.material.name)}</td><td class="num">${x.daysSinceIssue == null ? 'Chưa xuất' : x.daysSinceIssue + ' ngày không xuất'}</td><td>Rà soát kế hoạch sử dụng</td></tr>`),
  ];
  return `${pageHead('Cảnh báo tồn kho', 'Theo dõi tồn tối thiểu/tối đa, hạn sử dụng và hàng chậm luân chuyển theo cấu hình')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Tồn dưới min', low.length, 'fa-arrow-down', 'orange', 'warehouse-alert-open-low')}${mkpi('Tồn trên max', over.length, 'fa-arrow-up', 'red', 'warehouse-alert-open-inventory')}${mkpi('Lô cận hạn', near.length, 'fa-calendar-minus', 'orange', 'warehouse-dashboard-open-near-expiry')}${mkpi('Lô hết hạn', expired.length, 'fa-circle-xmark', 'red', 'warehouse-dashboard-open-expired')}${mkpi('Chậm luân chuyển', slow.length, 'fa-hourglass-half', 'slate', 'warehouse-alert-open-inventory')}</div>
    <div class="card">${tableShell([{ t: 'Loại cảnh báo' }, { t: 'Đối tượng' }, { t: 'Thông tin' }, { t: 'Khuyến nghị' }], rows, { emptyTitle: 'Không có cảnh báo' })}</div>`;
};

/* ==========================================================================
 * KHO -> HÀNG LỖI & HÀNG TRẢ VỀ
 * ========================================================================== */
Views['inv-defects'] = function () {
  const f = F('inv-defects', { subtab:'defective', q:'' });
  const subtab = f.subtab || 'defective';
  const q = String(f.q || '').toLowerCase().trim();
  const defectWhIds = new Set((DB.warehouses||[]).filter(w=>w.type==='DEFECTIVE').map(w=>w.id));
  const returnWhIds = new Set((DB.warehouses||[]).filter(w=>w.type==='RETURNED').map(w=>w.id));
  const sourceIds = subtab === 'returned' ? returnWhIds : defectWhIds;
  let rowsData = (DB.inventory||[]).filter(r=>sourceIds.has(r.warehouseId) && Number(r.qtyOnHand||0)>0);
  if (q) rowsData = rowsData.filter(r=>{
    const p=Q.product(r.productId)||Q.material(r.productId), lot=Q.lot(r.lotId), wh=(DB.warehouses||[]).find(w=>w.id===r.warehouseId);
    return [r.productId,p?.name,lot?.lotNumber,r.sourceId,r.productionOrderId,wh?.name].some(v=>String(v||'').toLowerCase().includes(q));
  });
  rowsData.sort((a,b)=>String(b.lastUpdated||'').localeCompare(String(a.lastUpdated||'')));
  const rows = rowsData.map(r=>{
    const p=Q.product(r.productId)||Q.material(r.productId), lot=Q.lot(r.lotId), wh=(DB.warehouses||[]).find(w=>w.id===r.warehouseId), loc=(DB.warehouseLocations||[]).find(l=>l.id===r.locationId);
    const ref = subtab==='returned' ? (r.sourceId||lot?.salesOrderId||'—') : (r.productionOrderId||r.sourceId||lot?.productionOrderId||'—');
    const refAct = ref && ref!=='—' ? (subtab==='returned'?'open-order':'open-production-order') : '';
    const refHtml = refAct ? `<button type="button" class="ref-link compact" data-act="${refAct}" data-id="${esc(ref)}" title="Mở ${subtab==='returned'?'đơn hàng':'lệnh sản xuất'} ${esc(ref)}"><span class="code">${esc(ref)}</span><i class="fa-solid fa-arrow-up-right-from-square"></i></button>` : '<span class="muted">—</span>';
    const typeBadge = subtab==='returned' ? '<span class="badge orange">Hàng trả về</span>' : '<span class="badge red">Hàng lỗi</span>';
    return `<tr class="clickable" data-act="inv-exception-detail" data-product="${esc(r.productId)}" data-lotid="${esc(r.lotId||'')}" data-warehouse="${esc(r.warehouseId)}">
      <td>${cell2(`<span class="code">${esc(r.productId)}</span>`,esc(p?.name||r.productId))}</td>
      <td>${typeBadge}</td><td><span class="code">${esc(lot?.lotNumber||'—')}</span></td><td>${esc(wh?.name||'—')}<div class="cell-sub">${esc(loc?.name||'')}</div></td>
      <td class="right strong num">${fmtN(r.qtyOnHand||0)} ${esc(r.unit||p?.unit||'')}</td><td>${refHtml}</td>
      <td>${fmtDate(String(r.lastUpdated||'').slice(0,10))}</td><td class="right">${rowActions([{act:'inv-exception-detail',data:`data-product="${esc(r.productId)}" data-lotid="${esc(r.lotId||'')}" data-warehouse="${esc(r.warehouseId)}"`,icon:'fa-eye',title:'Xem chi tiết'}])}</td>
    </tr>`;
  });
  const defectQty=(DB.inventory||[]).filter(r=>defectWhIds.has(r.warehouseId)&&!inventoryLotIsExpired(Q.lot(r.lotId))).reduce((s,r)=>s+Number(r.qtyOnHand||0),0);
  const expiredQty=expiredRows.reduce((s,e)=>s+Number(e.inventory?.qtyOnHand||0),0);
  const returnQty=(DB.inventory||[]).filter(r=>returnWhIds.has(r.warehouseId)).reduce((s,r)=>s+Number(r.qtyOnHand||0),0);
  const activeQty = subtab==='returned' ? returnQty : defectQty;
  const activeCount = rowsData.length;
  return `${pageHead('Hàng lỗi & hàng trả về','Quản lý tồn cách ly theo lô, vị trí và chứng từ nguồn; không tính vào tồn thành phẩm khả dụng.')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Hàng lỗi',fmtN(defectQty),'fa-triangle-exclamation','red')}${mkpi('Hàng trả về',fmtN(returnQty),'fa-rotate-left','orange')}${mkpi(subtab==='returned'?'Lô hàng trả':'Lô hàng lỗi',fmtN(activeCount),'fa-boxes-stacked','blue')}</div>
    <div class="card inventory-exception-card">
      <div class="toolbar inventory-exception-toolbar"><div class="tabs" style="margin:0"><button class="tab ${subtab==='defective'?'active':''}" data-act="inv-exception-tab" data-tab="defective"><i class="fa-solid fa-triangle-exclamation"></i> Hàng lỗi <span class="tab-count">${fmtN(defectQty)}</span></button><button class="tab ${subtab==='returned'?'active':''}" data-act="inv-exception-tab" data-tab="returned"><i class="fa-solid fa-rotate-left"></i> Hàng trả về <span class="tab-count">${fmtN(returnQty)}</span></button></div><span class="spacer"></span>${searchBox('inv-defects','Tìm mã hàng, lô, đơn hàng, LSX…')}</div>
      <div class="inventory-exception-summary"><div><span>${subtab==='returned'?'Tồn hàng trả hiện tại':'Tồn hàng lỗi hiện tại'}</span><b>${fmtN(activeQty)}</b></div><p>${subtab==='returned'?'Hàng khách trả được lưu riêng để chờ kiểm tra/xử lý.':'Thành phẩm QC không đạt được cách ly khỏi kho thành phẩm.'} Bấm mã tham chiếu để mở chứng từ nguồn.</p></div>
      ${tableShell([{t:'Thành phẩm'},{t:'Phân loại'},{t:'Lô'},{t:'Kho / vị trí'},{t:'Số lượng',cls:'right'},{t:subtab==='returned'?'Tham chiếu đơn bán':'Tham chiếu LSX'},{t:'Ngày ghi nhận'},{t:'',cls:'right'}],rows,{emptyTitle:subtab==='returned'?'Chưa có hàng khách trả':'Chưa có thành phẩm lỗi',emptyDesc:subtab==='returned'?'Hàng trả sẽ xuất hiện khi hoàn thành đơn bán và khai báo số lượng khách trả.':'Sản phẩm QC không đạt sẽ tự chuyển vào đây.'})}
    </div>`;
};

/* ==========================================================================
 * KHO -> KẾ HOẠCH SẢN XUẤT / DUYỆT YÊU CẦU NVL
 * ========================================================================== */
function pfSalesDemandGroups(){
  // Màn lập KHSX chỉ theo dõi các đơn còn ở giai đoạn chuẩn bị/đang sản xuất.
  // Đơn đã sẵn sàng xuất, đang vận chuyển, đã giao hoặc hoàn tất tuyệt đối không
  // được quay lại tính nhu cầu theo tồn kho hiện tại.
  const excluded=new Set([
    'dh_cho_xu_ly','dh_hoan_thanh','dh_cho_van_chuyen','dh_dang_giao',
    'dh_da_giao','dh_hoan_tat','dh_tu_choi','dh_da_huy'
  ]);
  const orders=(DB.orders||[])
    .filter(o=>o.approvedAt&&!excluded.has(o.status))
    .slice();
  const remaining=new Map();
  const getAvailable=(pid)=>{
    if(!remaining.has(pid)){
      const qty=(typeof SalesCRM!=='undefined'&&SalesCRM.finishedAvailable)?Number(SalesCRM.finishedAvailable(pid)||0):Number(pfFinishedStock(pid)||0);
      remaining.set(pid,qty);
    }
    return Number(remaining.get(pid)||0);
  };
  const activePlans=(DB.productionPlans||[]).filter(p=>p.source==='SALES_ORDER'&&p.status!=='CANCELLED');
  const groups=orders.map(o=>{
    const orderPlans=activePlans.filter(p=>String(p.sourceOrderId||'')===String(o.id||''));
    const lines=(o.items||[]).map(it=>{
      const need=Number(it.qty||0);
      const avail=getAvailable(it.productId);
      const allocated=Math.min(need,avail);
      remaining.set(it.productId,Math.max(0,avail-allocated));
      const shortage=Math.max(0,need-allocated);
      const planned=orderPlans.reduce((sum,p)=>sum+(p.items||[]).filter(x=>String(x.productId||'')===String(it.productId||'')).reduce((s,x)=>s+Number(x.qty||0),0),0);
      return {productId:it.productId,name:it.name||Q.product(it.productId)?.name||it.productId,unit:it.unit||Q.product(it.productId)?.unit||'',need,allocated,shortage,planned,unplanned:Math.max(0,shortage-planned)};
    });
    const shortage=lines.reduce((s,x)=>s+x.shortage,0);
    const planned=lines.reduce((s,x)=>s+x.planned,0);
    const unplanned=lines.reduce((s,x)=>s+x.unplanned,0);
    const hasPlan=orderPlans.length>0;
    const inProduction=o.status==='dh_dang_san_xuat';
    const state=unplanned>0?'NEED_PLAN':inProduction?'IN_PRODUCTION':hasPlan?'PLANNED':shortage<=0?'AVAILABLE':'PLANNED';
    return {order:o,lines,shortage,planned,unplanned,hasPlan,inProduction,state,planIds:orderPlans.map(p=>p.id)};
  });
  // Ưu tiên nghiệp vụ: cần lập KH -> đang SX -> đã có KH -> đủ tồn.
  // Trong cùng nhóm, đơn có ngày giao gần hơn đứng trước; nếu trùng thì đơn mới hơn đứng trước.
  const rank={NEED_PLAN:0,IN_PRODUCTION:1,PLANNED:2,AVAILABLE:3};
  return groups.sort((a,b)=>{
    const r=(rank[a.state]??9)-(rank[b.state]??9); if(r) return r;
    const da=String(a.order.dueDate||'9999-12-31'), db=String(b.order.dueDate||'9999-12-31');
    if(da!==db) return da.localeCompare(db);
    return String(b.order.date||b.order.createdAt||b.order.id||'').localeCompare(String(a.order.date||a.order.createdAt||a.order.id||''));
  });
}
function pfDemandStatusHtml(g){
  if(g.state==='NEED_PLAN') return '<span class="badge orange">Thiếu · Chưa lập đủ KH</span>';
  if(g.state==='IN_PRODUCTION') return '<span class="badge blue">Đang sản xuất</span>';
  if(g.state==='PLANNED') return '<span class="badge indigo">Đã lập kế hoạch</span>';
  return '<span class="badge green">Đủ tồn · Không cần SX</span>';
}
function pfPlanDerivedStatus(p){
  if(!p) return '';
  if(p.status==='RELEASED'){
    const ids=new Set((p.productionOrderIds||[]).map(String));
    const pos=(DB.productionOrders||[]).filter(po=>ids.has(String(po.id))||String(po.planId||'')===String(p.id||''));
    if(pos.length&&pos.every(po=>['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(po.status))) return '<span class="badge green">Sản xuất hoàn thành</span>';
    if(pos.some(po=>['lsx_dang_san_xuat','lsx_dang_qc'].includes(po.status))) return '<span class="badge blue">Đang sản xuất</span>';
  }
  return pfPlanStatus(p.status);
}
Views['warehouse-production-plan'] = function () {
  const plans=(DB.productionPlans||[]).filter(p=>p.status!=='CANCELLED');
  const zero=(DB.products||[]).filter(p=>pfFinishedStock(p.id)<=0);
  const demands=pfSalesDemandGroups();
  const demandRows=demands.map(g=>{
    const o=g.order;
    const planIds=(DB.productionPlans||[]).filter(p=>p.source==='SALES_ORDER'&&p.sourceOrderId===o.id&&p.status!=='CANCELLED').map(p=>p.id);
    const status=g.shortage<=0?'<span class="badge green">Đủ tồn khả dụng</span>':g.unplanned>0?'<span class="badge orange">Thiếu · Chưa lập đủ KH</span>':'<span class="badge blue">Đã lập kế hoạch</span>';
    return `<tr><td><span class="code">${esc(o.id)}</span><div class="cell-sub">${esc(Q.customerName(o.customerId)||'')}</div></td>
      <td>${(g.lines||[]).map(x=>`${esc(x.name)}<div class="cell-sub">Đặt ${fmtN(x.need)} · khả dụng ${fmtN(x.allocated)} · thiếu ${fmtN(x.shortage)} ${esc(x.unit)}</div>`).join('<br>')}</td>
      <td>${fmtDate(o.dueDate)}</td><td>${status}${planIds.length?`<div class="cell-sub">${planIds.map(id=>esc(id)).join(', ')}</div>`:''}</td>
      <td class="right">${rowActions([{act:'open-order',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết đơn hàng'},...(g.unplanned>0?[{act:'pf-plan-from-sales-order',data:`data-id="${esc(o.id)}"`,icon:'fa-industry',title:'Lập kế hoạch sản xuất phần thiếu'}]:[])])}</td></tr>`;
  });
  const rows=plans.map(p=>`<tr><td><span class="code">${esc(p.id)}</span>${p.source==='SALES_ORDER'?`<div class="cell-sub">Đơn ${esc(p.sourceOrderId||'')}</div>`:''}</td><td>${fmtDate(p.date)}</td>
    <td>${(p.items||[]).map(i=>`${esc(Q.product(i.productId)?.name||i.productId)} · <b>${fmtN(i.qty)}</b>`).join('<br>')}</td>
    <td>${pfPlanStatus(p.status)}</td><td>${esc(Q.employeeName(p.createdBy)||p.createdBy||'—')}</td>
    <td class="right">${rowActions([
      {act:'pf-plan-view',data:`data-id="${esc(p.id)}"`,icon:'fa-eye',title:'Xem chi tiết kế hoạch'},
      ...(p.status==='WAITING_APPROVAL'?[...(p.source!=='SALES_ORDER'?[{act:'pf-plan-edit',data:`data-id="${esc(p.id)}"`,icon:'fa-pen',title:'Sửa kế hoạch'}]:[]),{act:'pf-plan-approve',data:`data-id="${esc(p.id)}"`,icon:'fa-check',title:'Duyệt kế hoạch'},{act:'pf-plan-delete',data:`data-id="${esc(p.id)}"`,icon:'fa-trash',title:'Xóa kế hoạch'}]:[])
    ])}</td></tr>`);
  return `${pageHead('Kế hoạch sản xuất','Kho theo dõi đơn bán đã duyệt, kiểm tra tồn thành phẩm và lập kế hoạch cho phần thiếu trước khi chuyển sang Sản xuất.',
    '<button class="btn btn-primary" data-act="pf-plan-new"><i class="fa-solid fa-plus"></i>Lập kế hoạch nội bộ</button>')}
    ${zero.length?`<div class="card" style="margin-bottom:14px;border-left:3px solid var(--orange)"><div class="card-head"><span class="mkpi-ico t-orange"><i class="fa-solid fa-triangle-exclamation"></i></span><div><h3>${zero.length} thành phẩm đang hết tồn</h3><p>${zero.map(p=>esc(p.name)).join(' · ')}</p></div></div></div>`:''}
    <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Nhu cầu từ đơn bán</h3><p>Kho chỉ lập kế hoạch khi đơn đã duyệt và phần tồn khả dụng không đủ đáp ứng. Sản phẩm và số lượng thiếu được tính tự động.</p></div></div>
      ${tableShell([{t:'Đơn hàng'},{t:'Thành phẩm / Nhu cầu'},{t:'Ngày giao'},{t:'Tình trạng'},{t:'Thao tác',cls:'right'}],demandRows,{emptyTitle:'Không có đơn bán đang chờ thành phẩm'})}</div>
    <div class="card"><div class="card-head"><div><h3>Kế hoạch sản xuất</h3><p>Kế hoạch từ đơn bán hoặc kế hoạch nội bộ của Kho.</p></div></div>${tableShell([{t:'Kế hoạch'},{t:'Ngày lập'},{t:'Thành phẩm / SL'},{t:'Trạng thái'},{t:'Người lập'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch sản xuất'})}</div>`;
};

Views['warehouse-production-requests'] = function () {
  const reqs=DB.productionMaterialRequests||[];
  const rows=reqs.map(r=>`<tr><td><span class="code">${esc(r.id)}</span><div class="cell-sub">${esc(r.planId)}</div></td><td>${fmtDate(r.date)}</td>
    <td>${(r.items||[]).map(i=>`${esc(Q.material(i.materialId)?.name||i.materialId)} · <b>${fmtDec(i.qty,2)} ${esc(Q.material(i.materialId)?.unit||'')}</b>`).join('<br>')}</td>
    <td>${pfRequestStatus(r.status)}</td><td>${esc(Q.employeeName(r.createdBy)||r.createdBy||'—')}</td>
    <td class="right">${rowActions([
      {act:'pf-mr-view',data:`data-id="${esc(r.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},
      ...(['WAITING_WAREHOUSE_APPROVAL','APPROVED'].includes(r.status)?[{act:'pf-mr-issue',data:`data-id="${esc(r.id)}"`,icon:'fa-arrow-up-from-bracket',title:'Xuất NVL cho sản xuất'}]:[])
    ])}</td></tr>`);
  return `${pageHead('Yêu cầu NVL sản xuất','Phiếu từ kế hoạch sản xuất được chuyển thẳng sang Kho để xuất nguyên liệu')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Chờ xuất NVL',reqs.filter(r=>['WAITING_WAREHOUSE_APPROVAL','APPROVED'].includes(r.status)).length,'fa-hourglass-half','orange')}
      ${mkpi('Đã xuất',reqs.filter(r=>r.status==='ISSUED').length,'fa-truck-ramp-box','green')}
    </div><div class="card">${tableShell([{t:'Phiếu'},{t:'Ngày'},{t:'Nguyên liệu / SL'},{t:'Trạng thái'},{t:'Người yêu cầu'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có yêu cầu NVL sản xuất'})}</div>`;
};

Views['warehouse-store-replenishment'] = function () {
  const f=F('warehouse-store-replenishment',{q:'',status:'ACTION',storeId:''});
  const q=String(f.q||'').trim().toLowerCase();
  const stores=(DB.stores||[]).filter(x=>x.status!=='inactive');
  let list=[...(DB.storeReplenishmentRequests||[])].filter(r=>{
    const derived=typeof restaurantReplenishmentDerivedStatus==='function'?restaurantReplenishmentDerivedStatus(r):r.status;
    if(f.status==='ACTION'&&!['REQUESTED','PARTIAL_RECEIVED'].includes(derived))return false;
    if(f.status&&f.status!=='ACTION'&&derived!==f.status)return false;
    if(f.storeId&&r.storeId!==f.storeId)return false;
    const st=(typeof restaurantStore==='function'?restaurantStore(r.storeId):stores.find(x=>x.id===r.storeId));
    const items=typeof restaurantRequestItems==='function'?restaurantRequestItems(r):(r.items||[]);
    const hay=[r.id,st?.name,r.transferId,...items.map(x=>inventoryMasterItem(x.productId)?.name||x.productId)].join(' ').toLowerCase();
    return !q||hay.includes(q);
  }).sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||''))||String(b.id||'').localeCompare(String(a.id||'')));
  const rows=list.map(r=>{
    const store=typeof restaurantStore==='function'?restaurantStore(r.storeId):stores.find(x=>x.id===r.storeId);
    const progress=typeof restaurantReplenishmentProgress==='function'?restaurantReplenishmentProgress(r):null;
    const derived=progress?.status||r.status;
    const items=typeof restaurantRequestItems==='function'?restaurantRequestItems(r):(r.items||[]);
    const itemText=items.slice(0,2).map(it=>esc(Q.product(it.productId)?.name||it.productId)).join('<br>')+(items.length>2?`<div class="cell-sub">+${items.length-2} mặt hàng</div>`:'');
    const qtyText=(progress?.items||items.map(it=>({productId:it.productId,requestedQty:Number(it.quantity||0),remainingToIssue:Number(it.quantity||0)}))).slice(0,2).map(it=>{const unit=inventoryMasterItem(it.productId)?.unit||'';return `${fmtDec(Number(it.requestedQty??it.quantity??0),3)} ${esc(unit)}${Number(it.remainingToIssue||0)>1e-6?`<div class="cell-sub">Còn thiếu ${fmtDec(it.remainingToIssue,3)} ${esc(unit)}</div>`:''}`}).join('<br>');
    const acts=[{act:'restaurant-replenishment-view',data:`data-id="${esc(r.id)}"`,icon:'fa-eye',title:'Xem yêu cầu'}];
    if(['REQUESTED','PARTIAL_RECEIVED'].includes(derived))acts.push({act:'restaurant-replenishment-fulfill',data:`data-id="${esc(r.id)}"`,icon:'fa-check',title:derived==='PARTIAL_RECEIVED'?'Xuất tiếp phần còn thiếu':'Kho duyệt và xuất hàng'});
    const issueRefs=progress?.batches?.map(b=>b.goodsIssueId).filter(Boolean).join(', ')||r.goodsIssueId||r.transferId||'';
    return `<tr><td><span class="code">${esc(r.id)}</span><div class="cell-sub">${fmtDate(r.date)}</div></td><td>${esc(store?.name||r.storeId)}</td><td>${itemText||'—'}</td><td class="right num">${qtyText||'—'}</td><td>${typeof restaurantReplenishmentStatus==='function'?restaurantReplenishmentStatus(derived):esc(derived)}</td><td>${issueRefs?`<span class="code">${esc(issueRefs)}</span>`:'—'}</td><td class="right">${rowActions(acts)}</td></tr>`;
  }).join('');
  const all=DB.storeReplenishmentRequests||[];
  const statuses=all.map(r=>typeof restaurantReplenishmentDerivedStatus==='function'?restaurantReplenishmentDerivedStatus(r):r.status);
  return `${pageHead('Duyệt bổ sung hàng cửa hàng','Kho là bộ phận duyệt yêu cầu bổ sung và thực hiện xuất hàng cho cửa hàng','')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Cần Kho xử lý',statuses.filter(x=>['REQUESTED','PARTIAL_RECEIVED'].includes(x)).length,'fa-hourglass-half','orange')}
      ${mkpi('Chờ cửa hàng nhận',statuses.filter(x=>x==='ISSUED').length,'fa-truck-ramp-box','blue')}
      ${mkpi('Đã nhận đủ',statuses.filter(x=>x==='RECEIVED').length,'fa-circle-check','green')}
    </div>
    <div class="card"><div class="toolbar">
      ${searchBox('warehouse-store-replenishment','Tìm mã yêu cầu, cửa hàng, thành phẩm…')}
      ${selectFilter('warehouse-store-replenishment','storeId',stores.map(x=>[x.id,x.name]),'Tất cả cửa hàng')}
      ${selectFilter('warehouse-store-replenishment','status',[['ACTION','Cần Kho xử lý'],['REQUESTED','Chờ kho duyệt'],['PARTIAL_RECEIVED','Đã nhận một phần · còn thiếu'],['ISSUED','Kho đã xuất · chờ nhận'],['RECEIVED','Cửa hàng đã nhận đủ']],'Tất cả trạng thái')}
      ${(f.q||f.storeId||f.status)?'<button class="btn btn-sm" data-act="clear-filter" data-key="warehouse-store-replenishment"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}
      <span class="spacer"></span><span class="chip">${fmtN(list.length)} yêu cầu</span>
    </div>${tableShell([{t:'Yêu cầu'},{t:'Cửa hàng'},{t:'Thành phẩm'},{t:'SL yêu cầu / còn thiếu',cls:'right'},{t:'Trạng thái'},{t:'Phiếu xuất'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Không có yêu cầu bổ sung phù hợp'})}</div>`;
};

const _warehouseViewBeforeProductionFlow = Views.warehouse;

// Trạng thái QC xuất kho của phiếu xuất bán (chưa có field = chờ QC).
function salesIssueQcStatus(gi) { return String(gi?.qcStatus || 'PENDING').toUpperCase(); }

/* ------------------------------------------------------------ HÀNG LỖI: PHƯƠNG ÁN XỬ LÝ + GHI CHÚ
 * Lưu trên dòng tồn (DB.inventory): defectDisposition, defectNote, defectUpdatedAt/By.
 * ------------------------------------------------------------------------- */
const INVENTORY_DEFECT_DISPOSITIONS = [
  ['PENDING', 'Chờ xử lý', 'orange'],
  ['REWORK', 'Tái chế / sản xuất lại', 'blue'],
  ['DOWNGRADE', 'Hạ cấp / bán giảm giá', 'purple'],
  ['RETURN_SUPPLIER', 'Trả nhà cung cấp', 'purple'],
  ['DESTROY', 'Tiêu hủy', 'red'],
  ['OTHER', 'Phương án khác', 'gray'],
];
function inventoryDefectDispositionBadge(row) {
  const code = String(row?.defectDisposition || '');
  const d = INVENTORY_DEFECT_DISPOSITIONS.find((x) => x[0] === code);
  const badge = d ? `<span class="badge ${d[2]}">${esc(d[1])}</span>` : '<span class="badge orange">Chưa chọn phương án</span>';
  const note = String(row?.defectNote || '').trim();
  return badge + (note ? `<div class="cell-sub" title="${esc(note)}" style="max-width:240px;white-space:normal"><i class="fa-regular fa-note-sticky"></i> ${esc(note.length > 80 ? note.slice(0, 80) + '…' : note)}</div>` : '');
}
function openInventoryDefectHandleModal(productId, lotId, warehouseId) {
  const row = (DB.inventory || []).find((r) => r.productId === productId && String(r.lotId || '') === String(lotId || '') && r.warehouseId === warehouseId);
  if (!row) return;
  const item = inventoryMasterItem(productId);
  const lot = Q.lot(row.lotId);
  Modal.open({
    title: 'Phương án xử lý hàng lỗi',
    sub: `${esc(productId)} · ${esc(item?.name || productId)} · Lô ${esc(lot?.lotNumber || '—')}`,
    size: 'md',
    body: `<div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Phương án xử lý <span class="req">*</span></label>
        <select class="inp" id="defectDisposition">${INVENTORY_DEFECT_DISPOSITIONS.map(([v, l]) => `<option value="${v}" ${(row.defectDisposition || 'PENDING') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field" style="grid-column:1/-1"><label>Ghi chú (nguyên nhân / chi tiết xử lý)</label>
        <textarea class="inp" id="defectNote" rows="4" placeholder="Ví dụ: Móp méo bao bì, đề xuất bán giảm 30%...">${esc(row.defectNote || '')}</textarea></div>
    </div>
    ${row.defectUpdatedAt ? `<div class="cell-sub" style="margin-top:8px">Cập nhật lần cuối: ${esc(String(row.defectUpdatedAt).replace('T', ' ').slice(0, 16))}${row.defectUpdatedBy ? ` · ${esc(row.defectUpdatedBy)}` : ''}</div>` : ''}`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="inv-defect-save" data-product="${esc(productId)}" data-lotid="${esc(lotId || '')}" data-warehouse="${esc(warehouseId)}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`
  });
}


// SL thực tế do user Sản xuất (LSX) nhập, gom theo kế hoạch + thành phẩm để Kho đối chiếu.
function pfPlanActualHtml(plan, item) {
  const ids = new Set((plan?.productionOrderIds || []).map(String));
  const pos = (DB.productionOrders || []).filter((po) => (ids.has(String(po.id)) || String(po.planId || '') === String(plan?.id || '')) && po.productId === item.productId && po.actualQty !== undefined && po.actualQty !== '' && po.actualQty !== null);
  if (!pos.length) return '';
  const actual = pos.reduce((s, po) => s + Number(po.actualQty || 0), 0);
  const planned = pos.reduce((s, po) => s + Number(po.qty || 0), 0);
  const diff = Math.round((actual - planned) * 10000) / 10000;
  const tag = diff === 0 ? '<span class="badge green">Đủ</span>' : diff < 0 ? `<span class="badge red">Thiếu ${fmtN(-diff)}</span>` : `<span class="badge blue">Thừa ${fmtN(diff)}</span>`;
  return `<div class="cell-sub">Thực tế (LSX nhập): <b>${fmtN(actual)}</b> ${tag}</div>`;
}

/* ========================================================================== 
 * Kho — Thống kê tồn đầu kỳ / nhập / xuất / cuối kỳ (mặc định 1 ngày, chỉnh được).
 * Tồn cuối kỳ = tồn hiện tại − biến động sau ngày kết thúc; tồn đầu = cuối − (nhập − xuất).
 * Chuyển kho giữa 2 kho cùng loại được tính cả nhập và xuất.
 * ======================================================================= */
function inventoryTxDelta(t) {
  const q = Number(t?.qty ?? t?.quantity ?? 0);
  if (!Number.isFinite(q)) return 0;
  const type = String(t?.type || '').toUpperCase();
  if (/(_IN|RECEIPT)$/.test(type)) return Math.abs(q);
  if (/(_OUT|ISSUE)$/.test(type)) return -Math.abs(q);
  return q;
}
function inventoryStockPeriodToday() {
  return String(typeof currentDateYMD === 'function' ? currentDateYMD() : (DB.today || new Date().toISOString())).slice(0, 10);
}
function inventoryStockPeriodRows(tabType, whFilter, from, to, q) {
  const whIds = new Set((DB.warehouses || []).filter((w) => w.type === tabType && (!whFilter || w.id === whFilter)).map((w) => w.id));
  const master = tabType === 'RAW_MATERIAL' ? (DB.materials || []) : tabType === 'SEMI_FINISHED' ? (DB.semiFinishedProducts || []) : (DB.products || []);
  const map = new Map();
  master.forEach((it) => {
    if (q && ![it.id, it.name, it.unit].some((v) => String(v || '').toLowerCase().includes(q))) return;
    map.set(it.id, { id: it.id, item: it, current: 0, inQty: 0, outQty: 0, after: 0 });
  });
  (DB.inventory || []).forEach((r) => { if (whIds.has(r.warehouseId) && map.has(r.productId)) map.get(r.productId).current += Number(r.qtyOnHand || 0); });
  (DB.inventoryTransactions || []).forEach((t) => {
    if (!whIds.has(t.warehouseId) || !map.has(t.productId)) return;
    const d = String(t.date || '').slice(0, 10); if (!d) return;
    const delta = inventoryTxDelta(t); const g = map.get(t.productId);
    if (d > to) g.after += delta;
    else if (d >= from) { if (delta > 0) g.inQty += delta; else g.outQty += -delta; }
  });
  return [...map.values()].map((g) => {
    const closing = g.current - g.after;
    return { ...g, closing, opening: closing - (g.inQty - g.outQty) };
  }).sort((a, b) => String(a.item.name || a.id).localeCompare(String(b.item.name || b.id), 'vi', { numeric: true }));
}
Views['inv-stock-period'] = function () {
  const today = inventoryStockPeriodToday();
  const f = F('invPeriod', { q: '', tab: 'RAW_MATERIAL', warehouse: '', dateFrom: today, dateTo: today });
  if (!f.dateFrom) f.dateFrom = today; if (!f.dateTo) f.dateTo = f.dateFrom;
  if (f.dateFrom > f.dateTo) f.dateTo = f.dateFrom;
  const tabs = { RAW_MATERIAL: ['Nguyên liệu', 'fa-seedling'], SEMI_FINISHED: ['Bán thành phẩm', 'fa-cubes-stacked'], FINISHED_GOODS: ['Thành phẩm', 'fa-box'] };
  const label = (tabs[f.tab] || tabs.RAW_MATERIAL)[0];
  const all = inventoryStockPeriodRows(f.tab, f.warehouse, f.dateFrom, f.dateTo, String(f.q || '').toLowerCase().trim());
  const active = all.filter((g) => g.opening || g.inQty || g.outQty || g.closing);
  const pg = paged(active, 'invPeriod');
  const sum = (k) => active.reduce((s, g) => s + g[k], 0);
  const rows = pg.items.map((g) => `<tr>
    <td>${cell2(esc(g.item.name || g.id), `<span class="code">${esc(g.id)}</span>`)}</td>
    <td>${esc(g.item.unit || '—')}</td>
    <td class="right num">${fmtN(g.opening)}</td>
    <td class="right num" style="color:var(--green,#16a34a)">${g.inQty ? '+' + fmtN(g.inQty) : '—'}</td>
    <td class="right num" style="color:var(--red)">${g.outQty ? '−' + fmtN(g.outQty) : '—'}</td>
    <td class="right strong num">${fmtN(g.closing)}</td></tr>`);
  const single = f.dateFrom === f.dateTo;
  return `
  ${pageHead('Thống kê tồn theo kỳ', `Kỳ: ${single ? fmtDate(f.dateFrom) : `${fmtDate(f.dateFrom)} → ${fmtDate(f.dateTo)}`} · mặc định 1 ngày, chỉnh khoảng thời gian ở bộ lọc`)}
  <div class="tabs" style="margin-bottom:14px">${Object.entries(tabs).map(([k, [l, ic]]) => `<button class="tab ${f.tab === k ? 'active' : ''}" data-act="stock-period-tab" data-type="${k}"><i class="fa-solid ${ic}"></i>${l}</button>`).join('')}</div>
  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tồn đầu kỳ', fmtN(sum('opening')), 'fa-arrow-right-to-bracket', 'blue')}
    ${mkpi('Nhập trong kỳ', fmtN(sum('inQty')), 'fa-arrow-down', 'green')}
    ${mkpi('Xuất trong kỳ', fmtN(sum('outQty')), 'fa-arrow-up', 'red')}
    ${mkpi('Tồn cuối kỳ', fmtN(sum('closing')), 'fa-flag-checkered', 'teal')}
  </div>
  <div class="card">
    <div class="toolbar">
      ${searchBox('invPeriod', `Tìm ${label.toLowerCase()}…`)}
      ${selectFilter('invPeriod', 'warehouse', (DB.warehouses || []).filter((w) => w.type === f.tab).map((w) => [w.id, w.name]), 'Tất cả kho')}
      <label class="cell-sub">Từ</label><input class="inp" type="date" data-f="invPeriod.dateFrom" value="${esc(f.dateFrom)}">
      <label class="cell-sub">Đến</label><input class="inp" type="date" data-f="invPeriod.dateTo" value="${esc(f.dateTo)}">
      <button class="btn btn-sm" data-act="stock-period-today"><i class="fa-solid fa-calendar-day"></i>Hôm nay</button>
      <span class="spacer"></span><span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(active.length)} ${label.toLowerCase()} có phát sinh/tồn</span>
    </div>
    ${tableShell([{ t: label }, { t: 'ĐVT' }, { t: 'Tồn đầu kỳ', cls: 'right' }, { t: 'Nhập', cls: 'right' }, { t: 'Xuất', cls: 'right' }, { t: 'Tồn cuối kỳ', cls: 'right' }], rows, { emptyTitle: 'Không có phát sinh hoặc tồn trong kỳ' })}
    ${pagiHTML('invPeriod', pg, label.toLowerCase())}
  </div>
  <div class="cell-sub" style="margin-top:8px">Số liệu tính ngược từ tồn hiện tại và lịch sử giao dịch kho; nếu có giao dịch cũ chưa được ghi lại, tồn đầu kỳ có thể lệch tương ứng.</div>`;
};

/* ========================================================================== 
 * Kho — Cấu hình hạn dùng theo từng mặt hàng (nguyên liệu / BTP / thành phẩm).
 * Lưu item.shelfLifeDays + item.expiryWarnDays; không đổi HSD của lô đã tạo.
 * ======================================================================= */
Views['inv-shelf-life'] = function () {
  const f = F('shelfLife', { q: '', type: 'RAW_MATERIAL', status: '' });
  const types = {
    RAW_MATERIAL: { label: 'Nguyên liệu', icon: 'fa-seedling', src: DB.materials || [] },
    SEMI_FINISHED: { label: 'Bán thành phẩm', icon: 'fa-cubes-stacked', src: DB.semiFinishedProducts || [] },
    FINISHED_GOODS: { label: 'Thành phẩm', icon: 'fa-box', src: DB.products || [] },
  };
  const cfg = types[f.type] || types.RAW_MATERIAL;
  const q = String(f.q || '').toLowerCase().trim();
  const all = cfg.src.filter((it) => !q || [it.id, it.name, it.unit, inventoryItemCategory(it, f.type)].some((v) => String(v || '').toLowerCase().includes(q)));
  const configured = (it) => Number(it.shelfLifeDays || 0) > 0;
  const list = all.filter((it) => !f.status || (f.status === 'SET' ? configured(it) : !configured(it)));
  const pg = paged(list, 'shelfLife');
  const canEdit = inventoryCanOperate();
  const rows = pg.items.map((it) => {
    const nearest = inventoryNearestExpiry((DB.inventory || []).filter((r) => r.productId === it.id));
    return `<tr>
      <td>${cell2(esc(it.name || it.id), `<span class="code">${esc(it.id)}</span>`)}</td>
      <td>${esc(inventoryItemCategory(it, f.type) || '—')}</td>
      <td>${esc(it.unit || '—')}</td>
      <td class="right"><input class="inp right num" style="width:96px" type="number" min="0" step="1" data-sl-days="${esc(it.id)}" value="${Number(it.shelfLifeDays || 0) || ''}" placeholder="Chưa đặt" ${canEdit ? '' : 'disabled'}></td>
      <td class="right"><input class="inp right num" style="width:96px" type="number" min="0" step="1" data-sl-warn="${esc(it.id)}" value="${Number(it.expiryWarnDays || 0) || ''}" placeholder="${INVENTORY_DEFAULT_EXPIRY_WARN_DAYS}" ${canEdit ? '' : 'disabled'}></td>
      <td>${nearest ? inventoryExpiryHtml(nearest) : '<span class="muted">Không có lô còn tồn</span>'}</td>
      <td class="right">${canEdit ? `<button class="btn btn-sm btn-primary" data-act="shelf-life-save" data-type="${f.type}" data-id="${esc(it.id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>` : ''}</td>
    </tr>`;
  });
  const setCount = all.filter(configured).length;
  return `
  ${pageHead('Cấu hình hạn dùng', 'Khai báo hạn sử dụng mặc định và ngưỡng cảnh báo cận hạn cho từng mặt hàng')}
  <div class="tabs" style="margin-bottom:14px">
    ${Object.entries(types).map(([k, t]) => `<button class="tab ${f.type === k ? 'active' : ''}" data-act="shelf-life-tab" data-type="${k}"><i class="fa-solid ${t.icon}"></i>${t.label}</button>`).join('')}
  </div>
  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi(`Tổng ${cfg.label.toLowerCase()}`, all.length, 'fa-box', 'blue')}
    ${mkpi('Đã cấu hình HSD', setCount, 'fa-circle-check', 'green')}
    ${mkpi('Chưa cấu hình', all.length - setCount, 'fa-triangle-exclamation', 'orange')}
  </div>
  <div class="alert info" style="margin-bottom:12px"><i class="fa-solid fa-circle-info"></i><span>HSD mặc định chỉ áp dụng cho lô tạo/nhập <b>từ sau khi lưu</b>. Lô đã có giữ nguyên HSD. 0 hoặc để trống = chưa quy định.</span></div>
  <div class="card">
    <div class="toolbar">
      ${searchBox('shelfLife', `Tìm ${cfg.label.toLowerCase()}…`)}
      ${selectFilter('shelfLife', 'status', [['SET', 'Đã cấu hình'], ['UNSET', 'Chưa cấu hình']], 'Tất cả trạng thái')}
      <span class="spacer"></span><span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} ${cfg.label.toLowerCase()}</span>
    </div>
    ${tableShell([{ t: cfg.label }, { t: 'Danh mục' }, { t: 'ĐVT' }, { t: 'HSD mặc định (ngày)', cls: 'right' }, { t: 'Cảnh báo trước (ngày)', cls: 'right' }, { t: 'HSD gần nhất đang tồn' }, { t: '', cls: 'right', w: '90px' }], rows, { emptyTitle: `Chưa có ${cfg.label.toLowerCase()}` })}
    ${pagiHTML('shelfLife', pg, cfg.label.toLowerCase())}
  </div>`;
};

Views.warehouse = function () {
  const tab=State.tab||'dashboard';
  if(tab==='shelf_life') return Views['inv-shelf-life']();
  if(tab==='stock_period') return Views['inv-stock-period']();
  if(tab==='production_plan') return Views['warehouse-production-plan']();
  if(tab==='store_replenishment') return Views['warehouse-store-replenishment']();
  if(tab==='production_requests'){ F('inv-issues').issueTab='raw'; return Views['inv-issues'](); }
  return _warehouseViewBeforeProductionFlow ? _warehouseViewBeforeProductionFlow(State.params) : '';
};


/* ========================================================================== 
 * UI33 — Kho: Kế hoạch sản xuất & gia công với 2 subtab ngang.
 * ======================================================================= */
Views['warehouse-production-plan'] = function () {
  const f=F('warehouse-production-plan',{planTab:'production'});
  const planTab=f.planTab==='subcontracting'?'subcontracting':'production';
  const tabs=`<div class="tabs" style="margin-bottom:14px">
    <button class="tab ${planTab==='production'?'active':''}" data-act="warehouse-plan-tab" data-tab="production"><i class="fa-solid fa-industry"></i>Kế hoạch sản xuất</button>
    <button class="tab ${planTab==='subcontracting'?'active':''}" data-act="warehouse-plan-tab" data-tab="subcontracting"><i class="fa-solid fa-screwdriver-wrench"></i>Kế hoạch gia công</button>
  </div>`;

  if(planTab==='subcontracting' && typeof gcWarehousePlanTab==='function') return gcWarehousePlanTab(tabs);
  if(planTab==='subcontracting'){
    const all=(typeof subcontractV3Orders==='function'?subcontractV3Orders():(DB.subcontractingOrders||[]));
    // Kho chỉ nhận kế hoạch đã được bộ phận Gia công duyệt.
    const plans=all.filter(o=>o.status!=='DRAFT' && o.status!=='CANCELLED');
    const waiting=plans.filter(o=>o.status==='APPROVED').length;
    const issued=plans.filter(o=>!!o.issueId).length;
    const rows=plans.map(o=>{
      const acts=[];
      if(o.status==='APPROVED') acts.push({act:'warehouse-open-subcontract-issue',data:`data-id="${esc(o.id)}"`,icon:'fa-arrow-up-from-bracket',title:'Mở tại Xuất kho nguyên liệu'});
      return `<tr class="clickable" data-act="subcontracting-open" data-id="${esc(o.id)}"><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner||'—')}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}<div class="cell-sub">SL ${fmtDec(o.plannedQty,2)} ${esc(Q.product(o.productId)?.unit||o.unit||'')}</div></td><td>${fmtDate(o.issueDate)}</td><td>${fmtDate(o.dueDate)}</td><td>${typeof subcontractV3StatusHtml==='function'?subcontractV3StatusHtml(o.status):badge(o.status)}</td><td>${o.issueId?`<span class="code">${esc(o.issueId)}</span>`:'—'}</td><td class="right">${rowActions(acts)}</td></tr>`;
    }).join('');
    return `${pageHead('Kế hoạch sản xuất & gia công','Kho theo dõi kế hoạch nội bộ và kế hoạch gia công đã được duyệt. Xuất NVL gia công được thực hiện tại Kho → Xuất kho → Kho nguyên liệu.')}
      ${tabs}
      <div class="grid g-auto-sm" style="margin-bottom:14px">
        ${mkpi('Kế hoạch đã nhận',plans.length,'fa-clipboard-list','blue')}
        ${mkpi('Chờ xuất NVL',waiting,'fa-box-open','orange')}
        ${mkpi('Đã có phiếu xuất',issued,'fa-arrow-up-from-bracket','green')}
      </div>
      <div class="card"><div class="card-head"><div><h3>Kế hoạch gia công</h3><p>Thông tin từ phân hệ Gia công sau khi kế hoạch được duyệt. Kho theo dõi và thực hiện xuất nguyên liệu ở màn Xuất kho.</p></div></div>
        ${tableShell([{t:'Kế hoạch'},{t:'Đối tác'},{t:'Thành phẩm / SL'},{t:'Ngày giao NVL'},{t:'Hạn hoàn thành'},{t:'Trạng thái'},{t:'Phiếu xuất'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch gia công đã duyệt'})}
      </div>`;
  }

  const fDemand=F('warehouse-production-plan',{planTab:'production',demand:'ACTION',planStatus:''});
  const allPlans=(DB.productionPlans||[]).filter(p=>p.status!=='CANCELLED');
  let plans=allPlans.slice().sort((a,b)=>String(b.createdAt||b.date||b.id||'').localeCompare(String(a.createdAt||a.date||a.id||'')));
  if(fDemand.planStatus) plans=plans.filter(p=>p.status===fDemand.planStatus);
  const zero=(DB.products||[]).filter(p=>pfFinishedStock(p.id)<=0);
  const allDemands=pfSalesDemandGroups();
  let demands=allDemands;
  if(fDemand.demand==='ACTION') demands=allDemands.filter(g=>g.state!=='AVAILABLE');
  else if(fDemand.demand) demands=allDemands.filter(g=>g.state===fDemand.demand);
  const needCount=allDemands.filter(g=>g.state==='NEED_PLAN').length;
  const runningCount=allDemands.filter(g=>g.state==='IN_PRODUCTION').length;
  const plannedCount=allDemands.filter(g=>g.state==='PLANNED').length;
  const availableCount=allDemands.filter(g=>g.state==='AVAILABLE').length;
  const demandRows=demands.map(g=>{
    const o=g.order;
    const status=pfDemandStatusHtml(g);
    return `<tr><td><span class="code">${esc(o.id)}</span><div class="cell-sub">${esc(Q.customerName(o.customerId)||'')}</div></td><td>${(g.lines||[]).map(x=>`${esc(x.name)}<div class="cell-sub">Đặt ${fmtN(x.need)} · khả dụng ${fmtN(x.allocated)} · thiếu ${fmtN(x.shortage)} ${esc(x.unit)}</div>`).join('<br>')}</td><td>${fmtDate(o.dueDate)}</td><td>${status}${g.planIds.length?`<div class="cell-sub">${g.planIds.map(id=>esc(id)).join(', ')}</div>`:''}</td><td class="right">${rowActions([{act:'open-order',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết đơn hàng'},...(g.unplanned>0?[{act:'pf-plan-from-sales-order',data:`data-id="${esc(o.id)}"`,icon:'fa-industry',title:'Lập kế hoạch sản xuất phần thiếu'}]:[])])}</td></tr>`;
  }).join('');
  const rows=plans.map(p=>`<tr><td><span class="code">${esc(p.id)}</span>${p.source==='SALES_ORDER'?`<div class="cell-sub">Đơn ${esc(p.sourceOrderId||'')}</div>`:''}</td><td>${fmtDate(p.date)}</td><td>${(p.items||[]).map(i=>`${esc(Q.product(i.productId)?.name||i.productId)} · <b>${fmtN(i.qty)}</b>${pfPlanActualHtml(p,i)}`).join('<br>')}</td><td>${pfPlanDerivedStatus(p)}</td><td>${esc(Q.employeeName(p.createdBy)||p.createdBy||'—')}</td><td class="right">${rowActions([{act:'pf-plan-view',data:`data-id="${esc(p.id)}"`,icon:'fa-eye',title:'Xem chi tiết kế hoạch'},...(p.status==='WAITING_APPROVAL'?[...(p.source!=='SALES_ORDER'?[{act:'pf-plan-edit',data:`data-id="${esc(p.id)}"`,icon:'fa-pen',title:'Sửa kế hoạch'}]:[]),{act:'pf-plan-approve',data:`data-id="${esc(p.id)}"`,icon:'fa-check',title:'Duyệt kế hoạch'},{act:'pf-plan-delete',data:`data-id="${esc(p.id)}"`,icon:'fa-trash',title:'Xóa kế hoạch'}]:[])])}</td></tr>`).join('');
  return `${pageHead('Kế hoạch sản xuất & gia công','Kho theo dõi nhu cầu thành phẩm thực sự còn phải xử lý; đơn đã hoàn tất/giao hàng không quay lại danh sách lập kế hoạch.',`<button class="btn" data-act="pf-plan-low-stock"><i class="fa-solid fa-layer-group"></i>Lập KH hàng loạt (dưới hạn mức)</button><button class="btn btn-primary" data-act="pf-plan-new"><i class="fa-solid fa-plus"></i>Lập kế hoạch sản xuất</button>`)}
    ${tabs}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Cần lập KH',needCount,'fa-triangle-exclamation','orange')}
      ${mkpi('Đang sản xuất',runningCount,'fa-gears','blue')}
      ${mkpi('Đã có kế hoạch',plannedCount,'fa-clipboard-check','indigo')}
      ${mkpi('Đủ tồn',availableCount,'fa-boxes-stacked','green')}
    </div>
    ${zero.length?`<div class="card" style="margin-bottom:14px;border-left:3px solid var(--orange)"><div class="card-head"><span class="mkpi-ico t-orange"><i class="fa-solid fa-triangle-exclamation"></i></span><div><h3>${zero.length} thành phẩm đang hết tồn</h3><p>${zero.map(p=>esc(p.name)).join(' · ')}</p></div></div></div>`:''}
    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><div><h3>Nhu cầu từ đơn bán</h3><p>Mặc định chỉ hiện đơn cần xử lý. Đơn đủ tồn nhưng không cần sản xuất được ẩn để tránh nhiễu; đơn đã hoàn thành/giao hàng bị loại khỏi nguồn dữ liệu.</p></div></div>
      <div class="toolbar"><span class="muted">Ưu tiên: cần lập KH → đang SX → đã có KH; trong cùng nhóm xếp theo ngày giao gần nhất.</span><span class="spacer"></span>
        ${selectFilter('warehouse-production-plan','demand',[['ACTION','Cần xử lý'],['NEED_PLAN','Chưa lập đủ KH'],['IN_PRODUCTION','Đang sản xuất'],['PLANNED','Đã lập kế hoạch'],['AVAILABLE','Đủ tồn']], 'Tất cả nhu cầu')}
      </div>
      ${tableShell([{t:'Đơn hàng'},{t:'Thành phẩm / Nhu cầu'},{t:'Ngày giao'},{t:'Tình trạng'},{t:'Thao tác',cls:'right'}],demandRows,{emptyTitle:fDemand.demand==='ACTION'?'Không có đơn nào cần lập/theo dõi sản xuất':'Không có dữ liệu phù hợp bộ lọc'})}
    </div>
    <div class="card"><div class="card-head"><div><h3>Kế hoạch sản xuất</h3><p>Kế hoạch mới nhất hiển thị trước; trạng thái hoàn thành được suy ra từ các LSX liên kết.</p></div></div>
      <div class="toolbar"><span class="spacer"></span>${selectFilter('warehouse-production-plan','planStatus',[['WAITING_APPROVAL','Chờ duyệt'],['APPROVED','Đã duyệt'],['MATERIAL_REQUESTED','Đã yêu cầu NVL'],['MATERIAL_ISSUED','Đã xuất NVL'],['RELEASED','Đã tạo LSX']], 'Tất cả trạng thái')}</div>
      ${tableShell([{t:'Kế hoạch'},{t:'Ngày lập'},{t:'Thành phẩm / SL'},{t:'Trạng thái'},{t:'Người lập'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch sản xuất'})}
    </div>`;
};

/* ========================================================================== 
 * UI34 — Hàng lỗi & hàng trả về.
 * Hàng trả về gồm cả:
 *   1) hàng khách trả đang nằm tại kho RETURNED;
 *   2) nguyên liệu QC đầu vào không đạt đang/chờ xuất trả NCC.
 * Dữ liệu yêu cầu trả NCC lấy trực tiếp từ lenam_material_return_requests/history.
 * ======================================================================= */
Views['inv-defects'] = function () {
  const f = F('inv-defects', { subtab:'defective', q:'' });
  const subtab = f.subtab || 'defective';
  const q = String(f.q || '').toLowerCase().trim();
  const defectWhIds = new Set((DB.warehouses||[]).filter(w=>w.type==='DEFECTIVE').map(w=>w.id));
  const returnWhIds = new Set((DB.warehouses||[]).filter(w=>w.type==='RETURNED').map(w=>w.id));

  // Lô hết hạn được tự động phân loại vào Hàng lỗi nhưng KHÔNG di chuyển/xóa
  // balance gốc trong DB. Như vậy giữ nguyên truy vết kho/lô, đồng thời loại khỏi
  // tồn khả dụng và luôn xuất hiện ở đây với phân loại "Hết hạn".
  const expiredRows=(DB.inventory||[])
    .filter(r=>Number(r.qtyOnHand||0)>0 && !returnWhIds.has(r.warehouseId) && inventoryLotIsExpired(Q.lot(r.lotId)))
    .map(r=>({kind:'expired',date:String(Q.lot(r.lotId)?.expiryDate||r.lastUpdated||''),inventory:r}));

  const defectRows=(DB.inventory||[])
    .filter(r=>defectWhIds.has(r.warehouseId)&&Number(r.qtyOnHand||0)>0&&!inventoryLotIsExpired(Q.lot(r.lotId)))
    .map(r=>({kind:'defective',date:String(r.lastUpdated||''),inventory:r}));

  // Hàng khách trả: tồn vật lý trong kho RETURNED.
  const customerReturnRows=(DB.inventory||[])
    .filter(r=>returnWhIds.has(r.warehouseId)&&Number(r.qtyOnHand||0)>0)
    .map(r=>({kind:'customer_return',date:String(r.lastUpdated||''),inventory:r}));

  // Hàng QC đầu vào không đạt: vẫn phải xuất hiện tại Hàng trả về ngay từ lúc tạo YCT,
  // kể cả khi Kho chưa xác nhận xuất trả NCC.
  const supplierReqIds=new Set();
  const supplierReturnRows=(DB.materialReturnRequests||[]).map(r=>{
    supplierReqIds.add(r.id);
    return {kind:'supplier_return',date:String(r.completedAt||r.requestedDate||''),request:r};
  });
  // Tương thích dữ liệu lịch sử cũ: nếu đã có history nhưng request không còn trong RAM/server snapshot.
  (DB.materialReturnHistory||[]).forEach(h=>{
    if(!supplierReqIds.has(h.id)) supplierReturnRows.push({kind:'supplier_return_history',date:String(h.date||''),history:h});
  });

  let rowsData=subtab==='returned'?[...supplierReturnRows,...customerReturnRows]:[...expiredRows,...defectRows];

  if(q) rowsData=rowsData.filter(entry=>{
    if(entry.kind==='supplier_return'||entry.kind==='supplier_return_history'){
      const r=entry.request||entry.history||{};
      const mat=Q.material(r.materialId), lot=Q.lot(r.lotId), po=Q.purchaseOrder(r.poId);
      const supplier=(DB.suppliers||[]).find(s=>s.id===(r.supplierId||po?.supplierId));
      return [r.id,r.poId,r.receiptId,r.issueId,r.materialId,mat?.name,lot?.lotNumber,r.supplierLot,supplier?.name,r.reason,r.status]
        .some(v=>String(v||'').toLowerCase().includes(q));
    }
    const r=entry.inventory||{};
    const p=Q.product(r.productId)||Q.material(r.productId),lot=Q.lot(r.lotId),wh=(DB.warehouses||[]).find(w=>w.id===r.warehouseId);
    return [r.productId,p?.name,lot?.lotNumber,r.sourceId,r.productionOrderId,wh?.name].some(v=>String(v||'').toLowerCase().includes(q));
  });
  rowsData.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));

  const rows=rowsData.map(entry=>{
    if(entry.kind==='supplier_return'||entry.kind==='supplier_return_history'){
      const r=entry.request||entry.history||{};
      const mat=Q.material(r.materialId), lot=Q.lot(r.lotId), po=Q.purchaseOrder(r.poId);
      const supplier=(DB.suppliers||[]).find(s=>s.id===(r.supplierId||po?.supplierId));
      const wh=(DB.warehouses||[]).find(w=>w.id===r.warehouseId);
      const loc=(DB.warehouseLocations||[]).find(l=>l.id===r.locationId);
      const done=(r.status==='COMPLETED'||r.status==='RETURNED'||!!r.issueId);
      const statusHtml=done?'<span class="badge green">Đã xuất trả NCC</span>':'<span class="badge orange">Chờ kho xác nhận</span>';
      const lotText=`Lô HT: ${esc(lot?.lotNumber||'—')}`;
      const poHtml=r.poId?`<button type="button" class="ref-link compact" data-act="open-po" data-id="${esc(r.poId)}" title="Mở PO ${esc(r.poId)}"><span class="code">${esc(r.poId)}</span><i class="fa-solid fa-arrow-up-right-from-square"></i></button>`:'<span class="muted">—</span>';
      return `<tr class="clickable" data-act="inv-supplier-return-detail" data-id="${esc(r.id||'')}">
        <td>${cell2(`<span class="code">${esc(r.materialId||'—')}</span>`,esc(mat?.name||r.materialId||'—'))}</td>
        <td><span class="badge purple">Trả NCC</span><div class="cell-sub">${esc(supplier?.name||'Nhà cung cấp')}</div></td>
        <td>${cell2(`<span class="code">${esc(lot?.lotNumber||'—')}</span>`,lotText)}</td>
        <td>${esc(wh?.name||Q.warehouseName(r.warehouseId)||'—')}<div class="cell-sub">${esc(loc?.name||'')}</div></td>
        <td class="right strong num">${fmtN(r.qty||0)} ${esc(r.unit||mat?.unit||'')}</td>
        <td>${poHtml}<div class="cell-sub">${esc(r.id||'')}</div></td>
        <td>${statusHtml}</td><td>${fmtDate(String(r.completedAt||r.requestedDate||r.date||'').slice(0,10))}</td></tr>`;
    }

    const r=entry.inventory||{};
    const p=Q.product(r.productId)||Q.material(r.productId), lot=Q.lot(r.lotId), wh=(DB.warehouses||[]).find(w=>w.id===r.warehouseId), loc=(DB.warehouseLocations||[]).find(l=>l.id===r.locationId);
    const isReturned=entry.kind==='customer_return';
    const isExpired=entry.kind==='expired';
    const ref=isReturned?(r.sourceId||lot?.salesOrderId||'—'):(r.productionOrderId||r.sourceId||lot?.productionOrderId||'—');
    const refAct=ref&&ref!=='—'?(isReturned?'open-order':'open-production-order'):'';
    const refHtml=refAct?`<button type="button" class="ref-link compact" data-act="${refAct}" data-id="${esc(ref)}" title="Mở ${isReturned?'đơn hàng':'lệnh sản xuất'} ${esc(ref)}"><span class="code">${esc(ref)}</span><i class="fa-solid fa-arrow-up-right-from-square"></i></button>`:'<span class="muted">—</span>';
    const typeBadge=isReturned?'<span class="badge orange">Khách trả</span>':isExpired?'<span class="badge red"><i class="fa-solid fa-calendar-xmark"></i> Hết hạn</span>':'<span class="badge red">Hàng lỗi</span>';
    const stateHtml=isReturned?'<span class="badge blue">Đang lưu kho</span>':isExpired?'<span class="badge orange">Chờ xử lý</span>':'<span class="badge red">Cách ly</span>';
    const recordedDate=isExpired?(lot?.expiryDate||String(r.lastUpdated||'').slice(0,10)):String(r.lastUpdated||'').slice(0,10);
    return `<tr class="clickable" data-act="inv-exception-detail" data-product="${esc(r.productId)}" data-lotid="${esc(r.lotId||'')}" data-warehouse="${esc(r.warehouseId)}">
      <td>${cell2(`<span class="code">${esc(r.productId)}</span>`,esc(p?.name||r.productId))}</td><td>${typeBadge}</td><td><span class="code">${esc(lot?.lotNumber||'—')}</span>${isExpired&&lot?.expiryDate?`<div class="cell-sub" style="color:var(--red)">HSD ${fmtDate(lot.expiryDate)}</div>`:''}</td>
      <td>${esc(wh?.name||'—')}<div class="cell-sub">${esc(loc?.name||'')}</div></td><td class="right strong num">${fmtN(r.qtyOnHand||0)} ${esc(r.unit||p?.unit||'')}</td>
      <td>${refHtml}</td><td>${stateHtml}</td><td>${fmtDate(recordedDate)}</td></tr>`;
  }).join('');

  const defectQty=(DB.inventory||[]).filter(r=>defectWhIds.has(r.warehouseId)).reduce((s,r)=>s+Number(r.qtyOnHand||0),0);
  const customerReturnQty=(DB.inventory||[]).filter(r=>returnWhIds.has(r.warehouseId)).reduce((s,r)=>s+Number(r.qtyOnHand||0),0);
  const supplierReturnQty=(DB.materialReturnRequests||[]).reduce((s,r)=>s+Number(r.qty||0),0);
  const pendingSupplierReturns=(DB.materialReturnRequests||[]).filter(r=>r.status==='PENDING_WAREHOUSE').length;
  const tabs=`<div class="tabs" style="margin-bottom:14px"><button class="tab ${subtab==='defective'?'active':''}" data-act="inv-exception-tab" data-tab="defective"><i class="fa-solid fa-triangle-exclamation"></i>Hàng lỗi</button><button class="tab ${subtab==='returned'?'active':''}" data-act="inv-exception-tab" data-tab="returned"><i class="fa-solid fa-rotate-left"></i>Hàng trả về</button></div>`;

  const kpis=subtab==='returned'
    ? `${mkpi('Khách trả đang lưu kho',fmtN(customerReturnQty),'fa-box-open','orange')}${mkpi('SL trả NCC',fmtN(supplierReturnQty),'fa-truck-arrow-right','purple')}${mkpi('Chờ xuất trả NCC',fmtN(pendingSupplierReturns),'fa-clock','blue')}`
    : `${mkpi('Hàng lỗi / QC',fmtN(defectQty),'fa-triangle-exclamation','red')}${mkpi('Hết hạn',fmtN(expiredQty),'fa-calendar-xmark','orange')}${mkpi('Lô cần xử lý',fmtN(rowsData.length),'fa-boxes-stacked','blue')}`;

  return `${pageHead('Hàng lỗi & hàng trả về','Theo dõi hàng cách ly, lô hết hạn, hàng khách trả và nguyên liệu QC không đạt cần/đã xuất trả nhà cung cấp.')}
    ${tabs}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${kpis}</div>
    <div class="card"><div class="card-head"><div><h3>${subtab==='returned'?'Hàng trả về':'Hàng lỗi'}</h3><p>${subtab==='returned'?'Yêu cầu trả NCC xuất hiện ngay sau QC không đạt. Thao tác xuất trả vẫn thực hiện tại Kho → Xuất kho.':'Click vào dòng để xem chi tiết hàng lỗi.'}</p></div><div>${searchBox('inv-defects','Tìm mã hàng, lô, PO, YCT, đơn bán…')}</div></div>
      ${tableShell([{t:'Hàng hóa'},{t:'Phân loại'},{t:'Lô'},{t:'Kho / vị trí'},{t:'Số lượng',cls:'right'},{t:subtab==='returned'?'Tham chiếu':'Tham chiếu LSX'},{t:'Trạng thái'},{t:'Ngày ghi nhận'}],rows,{emptyTitle:subtab==='returned'?'Chưa có hàng trả về':'Chưa có thành phẩm lỗi',emptyDesc:subtab==='returned'?'Hàng khách trả và nguyên liệu QC không đạt cần trả NCC sẽ xuất hiện tại đây.':'Sản phẩm QC không đạt sẽ tự chuyển vào đây.'})}
    </div>`;
};
/* ========================================================================== 
 * FIX 2026-10-01 — Safe renderer for Kho > Hàng lỗi & hàng trả về.
 * Mục tiêu: route #warehouse/defects luôn render được, không để lỗi dữ liệu
 * phụ làm render() dừng giữa chừng và giữ lại màn Kiểm kê cũ.
 * Không thay đổi nghiệp vụ / dữ liệu KIO.
 * ======================================================================= */
Views['inv-defects'] = function () {
  const f = F('inv-defects', { subtab:'defective', q:'' });
  const subtab = f.subtab === 'returned' ? 'returned' : 'defective';
  const q = String(f.q || '').toLowerCase().trim();
  const warehouses = Array.isArray(DB.warehouses) ? DB.warehouses : [];
  const locations = Array.isArray(DB.warehouseLocations) ? DB.warehouseLocations : [];
  const inventory = Array.isArray(DB.inventory) ? DB.inventory : [];
  const lots = Array.isArray(DB.inventoryLots) ? DB.inventoryLots : [];
  const materials = Array.isArray(DB.materials) ? DB.materials : [];
  const products = Array.isArray(DB.products) ? DB.products : [];
  const suppliers = Array.isArray(DB.suppliers) ? DB.suppliers : [];
  const purchaseOrders = Array.isArray(DB.purchaseOrders) ? DB.purchaseOrders : [];
  const returnReqs = Array.isArray(DB.materialReturnRequests) ? DB.materialReturnRequests : [];
  const returnHist = Array.isArray(DB.materialReturnHistory) ? DB.materialReturnHistory : [];
  const productionOrders = Array.isArray(DB.productionOrders) ? DB.productionOrders : [];
  const productionOrderIds = new Set(productionOrders.map(x => String(x?.id || x?.code || '')).filter(Boolean));

  const lotOf = (id) => lots.find(x => x.id === id) || null;
  const itemOf = (id) => products.find(x => x.id === id) || materials.find(x => x.id === id) || null;
  const whOf = (id) => warehouses.find(x => x.id === id) || null;
  const locOf = (id) => locations.find(x => x.id === id) || null;
  const isExpired = (lot) => {
    const exp = String(lot?.expiryDate || '').slice(0,10);
    if (!exp) return false;
    const base = String(DB.today || new Date().toISOString().slice(0,10)).slice(0,10);
    return exp < base;
  };
  const defectWhIds = new Set(warehouses.filter(w => w.type === 'DEFECTIVE').map(w => w.id));
  const returnWhIds = new Set(warehouses.filter(w => w.type === 'RETURNED').map(w => w.id));

  const expiredEntries = inventory
    .filter(r => Number(r.qtyOnHand || 0) > 0 && !returnWhIds.has(r.warehouseId) && isExpired(lotOf(r.lotId)))
    .map(r => ({ kind:'expired', inventory:r, date:String(lotOf(r.lotId)?.expiryDate || r.lastUpdated || '') }));
  const defectEntries = inventory
    .filter(r => Number(r.qtyOnHand || 0) > 0 && defectWhIds.has(r.warehouseId) && !isExpired(lotOf(r.lotId)))
    .map(r => ({ kind:'defective', inventory:r, date:String(r.lastUpdated || '') }));
  const customerReturnEntries = inventory
    .filter(r => Number(r.qtyOnHand || 0) > 0 && returnWhIds.has(r.warehouseId))
    .map(r => ({ kind:'customer_return', inventory:r, date:String(r.lastUpdated || '') }));

  const reqIds = new Set(returnReqs.map(r => r.id));
  const supplierEntries = [
    ...returnReqs.map(r => ({ kind:'supplier_return', request:r, date:String(r.completedAt || r.requestedDate || r.date || '') })),
    ...returnHist.filter(h => !reqIds.has(h.id)).map(h => ({ kind:'supplier_return_history', history:h, date:String(h.date || '') }))
  ];

  let entries = subtab === 'returned'
    ? [...supplierEntries, ...customerReturnEntries]
    : [...expiredEntries, ...defectEntries];

  if (q) {
    entries = entries.filter(e => {
      if (e.request || e.history) {
        const r = e.request || e.history || {};
        const mat = itemOf(r.materialId);
        const lot = lotOf(r.lotId);
        const po = purchaseOrders.find(x => x.id === r.poId);
        const supplier = suppliers.find(x => x.id === (r.supplierId || po?.supplierId));
        return [r.id,r.poId,r.receiptId,r.issueId,r.materialId,mat?.name,lot?.lotNumber,r.supplierLot,supplier?.name,r.reason,r.status]
          .some(v => String(v || '').toLowerCase().includes(q));
      }
      const r = e.inventory || {};
      const item = itemOf(r.productId), lot = lotOf(r.lotId), wh = whOf(r.warehouseId);
      return [r.productId,item?.name,lot?.lotNumber,r.sourceId,r.productionOrderId,wh?.name]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }
  entries.sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));

  const rows = entries.map(e => {
    if (e.request || e.history) {
      const r = e.request || e.history || {};
      const item = itemOf(r.materialId), lot = lotOf(r.lotId), po = purchaseOrders.find(x => x.id === r.poId);
      const supplier = suppliers.find(x => x.id === (r.supplierId || po?.supplierId));
      const wh = whOf(r.warehouseId), loc = locOf(r.locationId);
      const done = ['COMPLETED','RETURNED'].includes(String(r.status || '').toUpperCase()) || !!r.issueId;
      const poHtml = r.poId
        ? `<button type="button" class="ref-link compact" data-act="open-po" data-id="${esc(r.poId)}"><span class="code">${esc(r.poId)}</span><i class="fa-solid fa-arrow-up-right-from-square"></i></button>`
        : '<span class="muted">—</span>';
      return `<tr class="clickable" data-act="inv-supplier-return-detail" data-id="${esc(r.id || '')}">
        <td>${cell2(`<span class="code">${esc(r.materialId || '—')}</span>`,esc(item?.name || r.materialId || '—'))}</td>
        <td><span class="badge purple">Trả NCC</span><div class="cell-sub">${esc(supplier?.name || 'Nhà cung cấp')}</div></td>
        <td><span class="code">${esc(lot?.lotNumber || '—')}</span></td>
        <td>${esc(wh?.name || '—')}<div class="cell-sub">${esc(loc?.name || '')}</div></td>
        <td class="right strong num">${fmtN(r.qty || 0)} ${esc(r.unit || item?.unit || '')}</td>
        <td>${poHtml}<div class="cell-sub">${esc(r.id || '')}</div></td>
        <td>${done ? '<span class="badge green">Đã xuất trả NCC</span>' : '<span class="badge orange">Chờ kho xác nhận</span>'}</td>
        <td>${r.reason ? `<span class="cell-sub">${esc(r.reason)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${fmtDate(String(r.completedAt || r.requestedDate || r.date || '').slice(0,10))}</td><td></td></tr>`;
    }

    const r = e.inventory || {};
    const item = itemOf(r.productId), lot = lotOf(r.lotId), wh = whOf(r.warehouseId), loc = locOf(r.locationId);
    const expired = e.kind === 'expired';
    const returned = e.kind === 'customer_return';
    const ref = returned ? (r.sourceId || lot?.salesOrderId || '—') : (r.productionOrderId || r.sourceId || lot?.productionOrderId || '—');
    const productionRefExists = returned || ref === '—' || productionOrderIds.has(String(ref));
    const refAct = ref !== '—' && productionRefExists ? (returned ? 'open-order' : 'open-production-order') : '';
    const refHtml = refAct
      ? `<button type="button" class="ref-link compact" data-act="${refAct}" data-id="${esc(ref)}"><span class="code">${esc(ref)}</span><i class="fa-solid fa-arrow-up-right-from-square"></i></button>`
      : ref !== '—'
        ? `<span class="code">${esc(ref)}</span>${!returned && !productionRefExists ? '<div class="cell-sub" style="color:var(--orange)"><i class="fa-solid fa-triangle-exclamation"></i> LSX không còn trên server</div>' : ''}`
        : '<span class="muted">—</span>';
    const typeBadge = returned
      ? '<span class="badge orange">Khách trả</span>'
      : expired
        ? '<span class="badge red"><i class="fa-solid fa-calendar-xmark"></i> Hết hạn</span>'
        : '<span class="badge red">Hàng lỗi</span>';
    const statusBadge = returned
      ? '<span class="badge blue">Đang lưu kho</span>'
      : expired
        ? '<span class="badge orange">Chờ xử lý</span>'
        : '<span class="badge red">Cách ly</span>';
    return `<tr class="clickable" data-act="inv-exception-detail" data-product="${esc(r.productId)}" data-lotid="${esc(r.lotId || '')}" data-warehouse="${esc(r.warehouseId)}">
      <td>${cell2(`<span class="code">${esc(r.productId || '—')}</span>`,esc(item?.name || r.productId || '—'))}</td>
      <td>${typeBadge}</td>
      <td><span class="code">${esc(lot?.lotNumber || '—')}</span>${expired && lot?.expiryDate ? `<div class="cell-sub" style="color:var(--red)">HSD ${fmtDate(lot.expiryDate)}</div>` : ''}</td>
      <td>${esc(wh?.name || '—')}<div class="cell-sub">${esc(loc?.name || '')}</div></td>
      <td class="right strong num">${fmtN(r.qtyOnHand || 0)} ${esc(r.unit || item?.unit || '')}</td>
      <td>${refHtml}</td><td>${statusBadge}</td>
      <td>${inventoryDefectDispositionBadge(r)}</td>
      <td>${fmtDate(String(expired ? (lot?.expiryDate || r.lastUpdated || '') : (r.lastUpdated || '')).slice(0,10))}</td>
      <td class="right">${inventoryCanOperate() ? `<button type="button" class="btn btn-sm" data-act="inv-defect-handle" data-product="${esc(r.productId)}" data-lotid="${esc(r.lotId || '')}" data-warehouse="${esc(r.warehouseId)}"><i class="fa-solid fa-screwdriver-wrench"></i>Xử lý</button>` : ''}</td></tr>`;
  }).join('');

  const expiredQty = expiredEntries.reduce((s,e) => s + Number(e.inventory?.qtyOnHand || 0), 0);
  const defectQty = defectEntries.reduce((s,e) => s + Number(e.inventory?.qtyOnHand || 0), 0);
  const customerReturnQty = customerReturnEntries.reduce((s,e) => s + Number(e.inventory?.qtyOnHand || 0), 0);
  const supplierReturnQty = returnReqs.reduce((s,r) => s + Number(r.qty || 0), 0);
  const pendingSupplierReturns = returnReqs.filter(r => String(r.status || '').toUpperCase() === 'PENDING_WAREHOUSE').length;

  const tabs = `<div class="tabs" style="margin-bottom:14px">
    <button class="tab ${subtab==='defective'?'active':''}" data-act="inv-exception-tab" data-tab="defective"><i class="fa-solid fa-triangle-exclamation"></i> Hàng lỗi</button>
    <button class="tab ${subtab==='returned'?'active':''}" data-act="inv-exception-tab" data-tab="returned"><i class="fa-solid fa-rotate-left"></i> Hàng trả về</button>
  </div>`;
  const kpis = subtab === 'returned'
    ? `${mkpi('Khách trả đang lưu kho',fmtN(customerReturnQty),'fa-box-open','orange')}${mkpi('SL trả NCC',fmtN(supplierReturnQty),'fa-truck-arrow-right','purple')}${mkpi('Chờ xuất trả NCC',fmtN(pendingSupplierReturns),'fa-clock','blue')}`
    : `${mkpi('Hàng lỗi / QC',fmtN(defectQty),'fa-triangle-exclamation','red')}${mkpi('Hết hạn',fmtN(expiredQty),'fa-calendar-xmark','orange')}${mkpi('Lô cần xử lý',fmtN(entries.length),'fa-boxes-stacked','blue')}`;

  return `${pageHead('Hàng lỗi & hàng trả về','Theo dõi hàng cách ly, lô hết hạn, hàng khách trả và nguyên liệu QC không đạt cần/đã xuất trả nhà cung cấp.')}
    ${tabs}<div class="grid g-auto-sm" style="margin-bottom:14px">${kpis}</div>
    <div class="card"><div class="card-head"><div><h3>${subtab==='returned'?'Hàng trả về':'Hàng lỗi'}</h3><p>${subtab==='returned'?'Yêu cầu trả NCC và hàng khách trả được theo dõi tại đây.':'Lô hết hạn được phân loại Hết hạn và không tính vào tồn khả dụng.'}</p></div><div>${searchBox('inv-defects','Tìm mã hàng, lô, PO, YCT, đơn bán…')}</div></div>
      ${tableShell([{t:'Hàng hóa'},{t:'Phân loại'},{t:'Lô'},{t:'Kho / vị trí'},{t:'Số lượng',cls:'right'},{t:subtab==='returned'?'Tham chiếu':'Tham chiếu LSX'},{t:'Trạng thái'},{t:'Phương án xử lý / Ghi chú'},{t:'Ngày ghi nhận'},{t:'',w:'80px'}],rows,{emptyTitle:subtab==='returned'?'Chưa có hàng trả về':'Chưa có hàng lỗi / lô hết hạn'})}
    </div>`;
};
