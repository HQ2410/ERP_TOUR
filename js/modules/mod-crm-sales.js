/* ============================================================================
 * MODULE: CRM – BÁN HÀNG LÊ NAM
 * ----------------------------------------------------------------------------
 * Phạm vi:
 *   - CRM bán thành phẩm/thành phẩm cho khách hàng.
 *   - Tạo đơn hàng trực tiếp, KHÔNG phụ thuộc báo giá legacy.
 *   - Cơ hội bán hàng, CSKH, khiếu nại, lịch sử giao dịch, báo cáo CRM.
 *   - Khi giao hàng bắt buộc phát sinh phiếu SALES_ISSUE từ KHO THÀNH PHẨM.
 *
 * Không thay đổi nghiệp vụ Mua hàng, Kho NVL/BTP, Sản xuất, Nhân sự...
 * ========================================================================== */

const SalesCRM = (() => {
  const orderStatus = {
    dh_cho_xu_ly:     { label: 'Chờ duyệt', tone: 'slate' },
    dh_cho_san_xuat:  { label: 'Chờ thành phẩm', tone: 'orange' },
    dh_dang_san_xuat: { label: 'Đang sản xuất', tone: 'blue' },
    dh_hoan_thanh:    { label: 'Sẵn sàng xuất bán', tone: 'green' },
    dh_cho_van_chuyen:{ label: 'Chờ vận chuyển', tone: 'indigo' },
    dh_dang_giao:     { label: 'Đang giao', tone: 'blue' },
    dh_da_giao:       { label: 'Đã giao', tone: 'teal' },
    dh_hoan_tat:       { label: 'Hoàn thành', tone: 'green' },
    dh_tu_choi:       { label: 'Từ chối', tone: 'red' },
    dh_da_huy:        { label: 'Đã hủy', tone: 'red' },
  };

  const oppStage = {
    NEW:          { label: 'Mới', tone: 'slate', probability: 10 },
    CONTACTED:    { label: 'Đang liên hệ', tone: 'blue', probability: 25 },
    QUALIFICATION:{ label: 'Đang trao đổi', tone: 'indigo', probability: 40 },
    PROPOSAL:     { label: 'Đề xuất phương án', tone: 'orange', probability: 60 },
    NEGOTIATION:  { label: 'Đàm phán', tone: 'orange', probability: 80 },
    CLOSED_WON:   { label: 'Thành công', tone: 'green', probability: 100 },
    CLOSED_LOST:  { label: 'Thất bại', tone: 'red', probability: 0 },
  };

  const STORAGE_KEY = 'lenam:crm-sales:v1';

  const ticketStatus = {
    OPEN:        { label: 'Tiếp nhận', tone: 'orange' },
    IN_PROGRESS: { label: 'Đang xử lý', tone: 'blue' },
    WAITING:     { label: 'Chờ phản hồi KH', tone: 'indigo' },
    RESOLVED:    { label: 'Đã giải quyết', tone: 'green' },
    CLOSED:      { label: 'Đã đóng', tone: 'slate' },
  };

  const badgeFrom = (dict, key) => {
    const item = dict[key] || { label: key || '—', tone: 'slate' };
    return `<span class="badge ${item.tone}">${esc(item.label)}</span>`;
  };

  function finishedWarehouses() {
    return (DB.warehouses || []).filter(w => w.type === 'FINISHED_GOODS' && w.status === 'active');
  }

  function eligibleFinishedRows(productId, warehouseId = '') {
    // Dùng ngày thực tế của hệ thống; không dùng DB.today demo để tránh lọc sai HSD.
    const todayYmd = typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0, 10);
    const today = new Date(todayYmd + 'T00:00:00');
    return (DB.inventory || [])
      .filter(row => {
        if (row.productId !== productId) return false;
        const wh = (DB.warehouses || []).find(w => w.id === row.warehouseId);
        if (!wh || wh.type !== 'FINISHED_GOODS') return false;
        if (warehouseId && row.warehouseId !== warehouseId) return false;
        if (Number(row.qtyAvailable ?? row.qtyOnHand ?? 0) <= 0) return false;
        const lot = (DB.inventoryLots || []).find(l => l.id === row.lotId);
        if (!lot || lot.qcStatus !== 'PASSED') return false;
        if (lot.expiryDate && new Date(lot.expiryDate + 'T00:00:00') <= today) return false;
        return true;
      })
      .sort((a, b) => {
        const ea = (DB.inventoryLots || []).find(l => l.id === a.lotId)?.expiryDate || '9999-12-31';
        const eb = (DB.inventoryLots || []).find(l => l.id === b.lotId)?.expiryDate || '9999-12-31';
        const byExpiry = ea.localeCompare(eb); // FEFO
        if (byExpiry) return byExpiry;
        const la=(DB.inventoryLots||[]).find(l=>l.id===a.lotId), lb=(DB.inventoryLots||[]).find(l=>l.id===b.lotId);
        const ra=(DB.goodsReceipts||[]).find(gr=>(gr.items||[]).some(i=>i.lotId===a.lotId))?.date || la?.createdAt || la?.mfgDate || '9999-12-31';
        const rb=(DB.goodsReceipts||[]).find(gr=>(gr.items||[]).some(i=>i.lotId===b.lotId))?.date || lb?.createdAt || lb?.mfgDate || '9999-12-31';
        return String(ra).localeCompare(String(rb)); // FIFO khi HSD bằng nhau
      });
  }

  function finishedAvailable(productId, warehouseId = '') {
    return eligibleFinishedRows(productId, warehouseId)
      .reduce((sum, row) => sum + Number(row.qtyAvailable ?? row.qtyOnHand ?? 0), 0);
  }

  // [SALES RESERVATION] Duyệt đơn chỉ giữ chỗ tồn kho, chưa trừ qtyOnHand.
  // Kho xác nhận phiếu xuất thì mới trừ tồn thật.
  function findWarehouseForOrder(order) {
    const lat=Number(order?.deliveryLat||0), lng=Number(order?.deliveryLng||0);
    const distance=(wh)=>{const a=Number(wh?.lat||wh?.latitude||0),b=Number(wh?.lng||wh?.longitude||0);if(!lat||!lng||!a||!b)return null;const R=6371,rad=x=>x*Math.PI/180,dLat=rad(a-lat),dLng=rad(b-lng);const h=Math.sin(dLat/2)**2+Math.cos(rad(lat))*Math.cos(rad(a))*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));};
    const eligible=finishedWarehouses().filter(wh =>
      (order?.items || []).every(item => finishedAvailable(item.productId, wh.id) >= Number(item.qty || 0))
    );
    eligible.sort((a,b)=>{const da=distance(a),db=distance(b);if(da==null&&db==null)return String(a.name||'').localeCompare(String(b.name||''),'vi');if(da==null)return 1;if(db==null)return -1;return da-db;});
    return eligible[0] || null;
  }

  function reserveOrderStock(order) {
    if (!order) return { ok:false, message:'Không tìm thấy đơn hàng.' };
    if (Array.isArray(order.reservations) && order.reservations.length) {
      return { ok:true, warehouseId:order.reservedWarehouseId || '', reservations:order.reservations };
    }
    const wh = findWarehouseForOrder(order);
    if (!wh) return { ok:false, message:'Không có một Kho thành phẩm nào đủ toàn bộ số lượng của đơn để giữ chỗ.' };

    const reservations=[];
    for (const item of order.items || []) {
      let remain=Number(item.qty || 0);
      const rows=eligibleFinishedRows(item.productId, wh.id);
      for (const row of rows) {
        if (remain <= 0) break;
        const avail=Number(row.qtyAvailable ?? row.qtyOnHand ?? 0);
        const take=Math.min(remain, avail);
        if (take <= 0) continue;
        row.qtyReserved=Math.round((Number(row.qtyReserved || 0) + take) * 100) / 100;
        row.qtyAvailable=Math.round((Number(row.qtyOnHand || 0) - Number(row.qtyReserved || 0)) * 100) / 100;
        reservations.push({productId:row.productId,warehouseId:row.warehouseId,locationId:row.locationId,lotId:row.lotId,qty:take,unit:row.unit || item.unit || ''});
        remain-=take;
      }
      if (remain > 0) {
        // Rollback nếu phát hiện thiếu ở giữa quá trình giữ chỗ.
        reservations.forEach(r => {
          const row=(DB.inventory || []).find(x => x.productId===r.productId && x.warehouseId===r.warehouseId && x.locationId===r.locationId && x.lotId===r.lotId);
          if (!row) return;
          row.qtyReserved=Math.max(0, Math.round((Number(row.qtyReserved || 0) - Number(r.qty || 0)) * 100) / 100);
          row.qtyAvailable=Math.round((Number(row.qtyOnHand || 0) - Number(row.qtyReserved || 0)) * 100) / 100;
        });
        return { ok:false, message:`Không đủ tồn khả dụng cho ${item.name || item.productId}.` };
      }
    }
    order.reservations=reservations;
    order.reservedWarehouseId=wh.id;
    return { ok:true, warehouseId:wh.id, reservations };
  }

  function releaseOrderReservation(order) {
    (order?.reservations || []).forEach(r => {
      const row=(DB.inventory || []).find(x => x.productId===r.productId && x.warehouseId===r.warehouseId && x.locationId===r.locationId && x.lotId===r.lotId);
      if (!row) return;
      row.qtyReserved=Math.max(0, Math.round((Number(row.qtyReserved || 0) - Number(r.qty || 0)) * 100) / 100);
      row.qtyAvailable=Math.round((Number(row.qtyOnHand || 0) - Number(row.qtyReserved || 0)) * 100) / 100;
    });
  }

  function salesIssuesOf(orderId) {
    return (DB.goodsIssues || []).filter(issue =>
      issue.type === 'SALES_ISSUE' &&
      issue.status === 'COMPLETED' &&
      String(issue.refDoc || issue.orderId || issue.refId || '') === String(orderId)
    );
  }

  function hasSalesIssue(orderId) {
    return salesIssuesOf(orderId).length > 0;
  }

  function orderStockState(order) {
    const lines = (order?.items || []).map(item => ({
      productId: item.productId,
      name: item.name,
      need: Number(item.qty || 0),
      available: finishedAvailable(item.productId),
    }));
    return { lines, enough: lines.every(x => x.available >= x.need) };
  }

  function completedOrders() {
    return (DB.orders || []).filter(o => ['dh_da_giao','dh_hoan_tat'].includes(o.status));
  }

  function revenueOfCustomer(customerId) {
    return completedOrders()
      .filter(o => o.customerId === customerId)
      .reduce((sum, o) => sum + Number(o.subtotal ?? o.total ?? 0), 0);
  }

  function repeatStats() {
    const counts = new Map();
    completedOrders().forEach(o => counts.set(o.customerId, (counts.get(o.customerId) || 0) + 1));
    const buyers = [...counts.values()].filter(v => v > 0).length;
    const repeat = [...counts.values()].filter(v => v >= 2).length;
    return { buyers, repeat, rate: buyers ? (repeat / buyers) * 100 : 0 };
  }

  function customerNameForOpp(o) {
    if (o.customerId) return Q.customerName(o.customerId);
    return o.company || 'Khách hàng tiềm năng';
  }


  // CRM/Bán hàng dùng bảng lenam_* riêng trên KIO server.
  // localStorage chỉ là cache/fallback; KIO là nguồn dữ liệu chuẩn.
  function snapshotState() {
    return {
      orders: DB.orders || [],
      customers: DB.customers || [],
      crmOpportunities: DB.crmOpportunities || [],
      crmTickets: DB.crmTickets || [],
      customerCareLogs: DB.customerCareLogs || [],
      crmActivities: DB.crmActivities || [],
      customerPayments: DB.customerPayments || [],
      updatedAt: new Date().toISOString(),
    };
  }

  function applyState(saved) {
    if (!saved || typeof saved !== 'object') return false;
    ['orders','customers','crmOpportunities','crmTickets','customerCareLogs','crmActivities','customerPayments'].forEach(key => {
      if (Array.isArray(saved?.[key])) DB[key] = saved[key];
    });
    return true;
  }

  function saveLocal(keys = null, options = {}) {
    // [CRM KIO-ONLY] Không còn dùng localStorage làm nguồn/cache nghiệp vụ CRM.
    // Mọi dữ liệu CRM chỉ sống trong DB runtime và các bảng lenam_* trên KIO.
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}

    if (options?.sync === false) return;

    if (typeof CRMAPI !== 'undefined') {
      if (keys) CRMAPI.scheduleCollections(keys, 0);
      else CRMAPI.scheduleSync(0);
    }
  }

  function restoreLocal() {
    // [CRM KIO-ONLY] Tuyệt đối không hydrate DB từ cache cũ vì cache stale/rỗng
    // từng làm danh sách khách hàng nhảy 25 -> 26 hoặc mất dữ liệu khi đổi trang.
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    return false;
  }

  let __salesCrmBooted = false;
  async function bootstrap() {
    if (__salesCrmBooted) return true;
    __salesCrmBooted = true;
    restoreLocal();
    if (typeof CRMAPI === 'undefined') return false;
    return await CRMAPI.bootstrap();
  }

  function nextNumericCode(prefix, list, width = 4) {
    const max = (list || []).reduce((m, item) => {
      const match = String(item?.id || '').match(/(\d+)$/);
      return Math.max(m, match ? Number(match[1]) : 0);
    }, 0);
    return `${prefix}${String(max + 1).padStart(width, '0')}`;
  }


  function customerPaymentsOfOrder(orderId) {
    return (DB.customerPayments || []).filter(p => String(p.orderId || '') === String(orderId || ''));
  }

  // Khoản thu chỉ được tính là ĐÃ NHẬN sau khi kế toán xác nhận. Dữ liệu cũ (chưa có confirmStatus) coi là đã xác nhận.
  function paymentCounted(p) { return String(p?.confirmStatus || 'CONFIRMED').toUpperCase() === 'CONFIRMED'; }
  function paidOfOrder(orderId) {
    return customerPaymentsOfOrder(orderId).filter(paymentCounted).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }
  // Đã ghi nhận nhưng đang chờ kế toán xác nhận đã nhận tiền (vẫn còn là công nợ).
  function pendingOfOrder(orderId) {
    return customerPaymentsOfOrder(orderId).filter(p => String(p.confirmStatus || '').toUpperCase() === 'PENDING').reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }

  function receivableOfOrder(order) {
    if (!order) return 0;
    return Math.max(0, Number(order.total || 0) - paidOfOrder(order.id));
  }

  function receivableStatus(order) {
    const total = Number(order?.total || 0);
    const paid = paidOfOrder(order?.id);
    const remain = Math.max(0, total - paid);
    const dueDate = String(order?.paymentDueDate || order?.dueDate || '').slice(0, 10);
    const today = typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0, 10);
    if (remain <= 0 && total > 0) return 'PAID';
    if (dueDate && dueDate < today && remain > 0) return 'OVERDUE';
    if (paid > 0) return 'PARTIALLY_PAID';
    return 'UNPAID';
  }

  return {
    orderStatus, oppStage, ticketStatus, badgeFrom,
    finishedWarehouses, eligibleFinishedRows, finishedAvailable,
    salesIssuesOf, hasSalesIssue, orderStockState,
    completedOrders, revenueOfCustomer, repeatStats, customerNameForOpp,
    customerPaymentsOfOrder, paidOfOrder, pendingOfOrder, paymentCounted, receivableOfOrder, receivableStatus,
    nextNumericCode, saveLocal, restoreLocal, bootstrap,
    findWarehouseForOrder, reserveOrderStock, releaseOrderReservation,
  };
})();

// CRM/Bán hàng được bootstrap cùng Purchase/Inventory trong app.js.
// KIO server là nguồn dùng chung giữa các bản source; localStorage chỉ là cache dự phòng.

/* -------------------------------------------------------------------------
 * TỔNG QUAN CRM
 * ---------------------------------------------------------------------- */
Views['crm-dashboard'] = function () {
  const delivered = SalesCRM.completedOrders();
  // Cơ hội bán hàng được quản lý trực tiếp trên hồ sơ khách hàng.
  // Không dùng pipeline/cơ hội độc lập làm nguồn chính nữa.
  const customers = DB.customers || [];
  const opportunityCustomers = customers.filter(c => ['HAS_OPPORTUNITY', 'FOLLOWING'].includes(c.opportunityStatus));
  const followingCustomers = customers.filter(c => c.opportunityStatus === 'FOLLOWING');
  const lostOpportunityCustomers = customers.filter(c => c.opportunityStatus === 'NO_OPPORTUNITY');
  const repeat = SalesCRM.repeatStats();
  const revenue = delivered.reduce((s, o) => s + Number(o.subtotal ?? o.total ?? 0), 0);

  const byProvince = new Map();
  delivered.forEach(o => {
    const province = Q.customer(o.customerId)?.province || 'Chưa xác định';
    byProvince.set(province, (byProvince.get(province) || 0) + Number(o.subtotal ?? o.total ?? 0));
  });
  const regions = [...byProvince.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);

  const ownerIds=[...new Set((DB.orders||[]).map(o=>o.ownerId).filter(Boolean))];
  const sales=ownerIds.map(id=>{
    const done=delivered.filter(o=>o.ownerId===id);
    const ownerName=Q.employeeName(id);
    const oppCount=customers.filter(c => c.owner === ownerName && ['HAS_OPPORTUNITY','FOLLOWING'].includes(c.opportunityStatus)).length;
    return {id,name:ownerName,revenue:done.reduce((s,o)=>s+Number(o.subtotal??o.total??0),0),orders:done.length,opps:oppCount};
  }).sort((a,b)=>b.revenue-a.revenue);

  // [CRM REPORT] Tổng quan và Báo cáo CRM dùng chung một màn hình.
  // Tìm kiếm chỉ lọc bảng doanh số khách hàng, không làm thay đổi dữ liệu.
  const rf = F('crmRevenue', { q: '' });
  const rq = String(rf.q || '').toLowerCase().trim();
  const byCustomer=(DB.customers||[])
    .map(c=>({id:c.id,name:c.name,region:c.province,orders:delivered.filter(o=>o.customerId===c.id).length,revenue:SalesCRM.revenueOfCustomer(c.id)}))
    .filter(x=>x.orders>0)
    .filter(x=>!rq || [x.id,x.name,x.region].some(v=>String(v||'').toLowerCase().includes(rq)))
    .sort((a,b)=>b.revenue-a.revenue);

  return `
    ${pageHead('Tổng quan CRM – Bán hàng', 'Khách hàng → Đơn hàng thành phẩm → Xuất kho → Giao hàng → Chăm sóc sau bán')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Khách hàng', DB.customers.length, 'fa-users', 'blue', 'crm-go-customers')}
      ${mkpi('Doanh số đã giao', fmtShort(revenue), 'fa-sack-dollar', 'green', 'crm-go-orders-delivered')}
      ${mkpi('Khách có cơ hội', opportunityCustomers.length, 'fa-bullseye', 'orange', 'crm-go-customers')}
      ${mkpi('Đang theo dõi', followingCustomers.length, 'fa-eye', 'indigo', 'crm-go-customers')}
      ${mkpi('Không còn cơ hội', lostOpportunityCustomers.length, 'fa-circle-xmark', 'slate', 'crm-go-customers')}
      ${mkpi('KH quay lại', `${repeat.rate.toFixed(1)}%`, 'fa-rotate', 'green', 'crm-go-transactions')}
    </div>

    <div class="grid g-2" style="margin-bottom:14px">
      <div class="card">
        <div class="card-head"><div><h3>Doanh số theo khu vực</h3><p>Chỉ tính đơn đã giao</p></div></div>
        ${tableShell([{t:'Khu vực'},{t:'Đơn',cls:'right'},{t:'Doanh số',cls:'right'}], regions.map(([region,value])=>`<tr><td class="strong">${esc(region)}</td><td class="right num">${delivered.filter(o=>(Q.customer(o.customerId)?.province||'Chưa xác định')===region).length}</td><td class="right strong num">${fmtVND(value)}</td></tr>`), {emptyTitle:'Chưa có doanh số'})}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Hiệu quả nhân viên sale</h3><p>Doanh số và số khách hàng đang có cơ hội</p></div></div>
        ${tableShell([{t:'Sale'},{t:'Đơn giao',cls:'right'},{t:'Doanh số',cls:'right'},{t:'Khách có cơ hội',cls:'right'}], sales.map(x=>`<tr><td>${esc(x.name)}</td><td class="right num">${x.orders}</td><td class="right strong num">${fmtVND(x.revenue)}</td><td class="right num">${x.opps}</td></tr>`), {emptyTitle:'Chưa có dữ liệu sale'})}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Doanh số từng khách hàng</h3><p>Click khách hàng để xem đúng các đơn hàng đã mua</p></div></div>
      <div class="toolbar">
        ${searchBox('crmRevenue', 'Tìm mã, tên khách hàng, khu vực…')}
        ${rf.q ? '<button class="btn btn-sm" data-act="clear-filter" data-key="crmRevenue"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa tìm kiếm</button>' : ''}
        <span class="spacer"></span><span class="chip">${fmtN(byCustomer.length)} khách đã mua</span>
      </div>
      ${tableShell([{t:'Khách hàng'},{t:'Khu vực'},{t:'Đơn đã giao',cls:'right'},{t:'Doanh số',cls:'right'},{t:'Phân loại'}], byCustomer.map(x=>`<tr class="clickable" data-act="crm-customer-orders" data-id="${esc(x.id)}"><td>${cell2(esc(x.name), `<span class="code">${esc(x.id)}</span>`)}</td><td>${esc(x.region||'')}</td><td class="right num">${x.orders}</td><td class="right strong num">${fmtVND(x.revenue)}</td><td>${x.orders>=2?'<span class="badge green">Khách quay lại</span>':'<span class="badge slate">Mua lần đầu</span>'}</td></tr>`), {emptyTitle:'Không có khách hàng phù hợp'})}
    </div>`;
};

/* -------------------------------------------------------------------------
 * ĐƠN HÀNG BÁN – TẠO TRỰC TIẾP, KHÔNG QUA BÁO GIÁ
 * ---------------------------------------------------------------------- */
Views.orders = function () {
  const f = F('orders', { q: '', status: '', statusGroup: '', owner: '', customerId: '', from: '', to: '' });
  if (State.params.filter) { f.status = State.params.filter; State.params.filter = null; }
  const q = String(f.q || '').toLowerCase().trim();
  const list = (DB.orders || []).filter(o => {
    if (f.statusGroup === 'production' && !['dh_cho_san_xuat','dh_dang_san_xuat'].includes(o.status)) return false;
    if (!f.statusGroup && f.status && o.status !== f.status) return false;
    if (f.owner && o.ownerId !== f.owner) return false;
    if (f.customerId && o.customerId !== f.customerId) return false;
    const date = String(o.date || '').slice(0,10);
    if (f.from && date < f.from) return false;
    if (f.to && date > f.to) return false;
    if (q && ![o.id, Q.customerName(o.customerId), ...(o.items||[]).map(i=>i.name)].some(v=>String(v||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || String(b.id).localeCompare(String(a.id)));
  const pg = paged(list, 'orders');
  const owners = [...new Set((DB.orders||[]).map(o=>o.ownerId).filter(Boolean))].map(id=>[id,Q.employeeName(id)]);
  const statuses = Object.entries(SalesCRM.orderStatus).map(([k,v])=>[k,v.label]);
  const customers = (DB.customers||[]).map(c=>[c.id, `${c.id} · ${c.name}`]);

  const rows = pg.items.map(o => {
    return `<tr class="clickable" data-act="open-order" data-id="${o.id}">
      <td>${cell2(`<span class="code">${o.id}</span>`, o.opportunityId ? `Cơ hội ${esc(o.opportunityId)}` : 'Đơn trực tiếp')}</td>
      <td>${cell2(esc(Q.customerName(o.customerId)), esc(Q.customer(o.customerId)?.province||''))}</td>
      <td class="hide-sm">${(o.items||[]).length ? cell2(esc(o.items[0].name), (o.items||[]).length>1?`+ ${(o.items||[]).length-1} sản phẩm`:`${fmtN(o.items[0].qty)} ${esc(o.items[0].unit)}`) : '—'}</td>
      <td class="num">${fmtDT(o.orderedAt||o.date)}</td><td class="num hide-sm">${fmtDate(o.dueDate)}</td>
      <td class="right strong num">${fmtVND(o.total)}</td>
      <td>${SalesCRM.badgeFrom(SalesCRM.orderStatus,o.status)}</td>
      <td class="right">${rowActions([
        {act:'open-order',data:`data-id="${o.id}"`,icon:'fa-eye',title:'Xem chi tiết'},
        {act:'crm-order-edit',data:`data-id="${o.id}"`,icon:'fa-pen',title:'Sửa đơn hàng'},
        ...(o.status==='dh_cho_xu_ly' && !o.approvedAt ? [{act:'crm-order-delete',data:`data-id="${o.id}"`,icon:'fa-trash',title:'Xóa đơn hàng'}] : []),
      ])}</td>
    </tr>`;
  });

  return `${pageHead('Đơn hàng bán', `${DB.orders.length} đơn · Bán thành phẩm cho khách hàng`, `
    <button class="btn btn-primary" data-act="new-order"><i class="fa-solid fa-plus"></i>Tạo đơn hàng</button>`)}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng đơn', DB.orders.length, 'fa-cart-flatbed', 'blue', 'crm-order-filter-all')}
      ${mkpi('Mới / chờ xác nhận', DB.orders.filter(o=>o.status==='dh_cho_xu_ly').length, 'fa-hourglass-start', 'slate', 'crm-order-filter-new')}
      ${mkpi('Chờ thành phẩm', DB.orders.filter(o=>['dh_cho_san_xuat','dh_dang_san_xuat'].includes(o.status)).length, 'fa-industry', 'orange', 'crm-order-filter-production')}
      ${mkpi('Sẵn sàng xuất', DB.orders.filter(o=>o.status==='dh_hoan_thanh').length, 'fa-box-open', 'green', 'crm-order-filter-ready')}
      ${mkpi('Đã giao', DB.orders.filter(o=>o.status==='dh_da_giao').length, 'fa-truck-fast', 'teal', 'crm-order-filter-delivered')}
    </div>
    <div class="card"><div class="toolbar">
      ${searchBox('orders','Tìm mã đơn, khách hàng, thành phẩm…')}
      ${selectFilter('orders','status',statuses,'Tất cả trạng thái')}
      ${selectFilter('orders','owner',owners,'Tất cả sale')}
      ${selectFilter('orders','customerId',customers,'Tất cả khách hàng')}
      <label class="field-inline">Từ <input class="inp" type="date" data-f="orders.from" value="${esc(f.from||'')}"></label>
      <label class="field-inline">Đến <input class="inp" type="date" data-f="orders.to" value="${esc(f.to||'')}"></label>
      ${(f.q||f.status||f.statusGroup||f.owner||f.customerId||f.from||f.to)?'<button class="btn btn-sm" data-act="clear-filter" data-key="orders"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}
      <span class="spacer"></span><span class="chip">${fmtN(list.length)} đơn</span>
    </div>
    ${tableShell([{t:'Mã đơn',w:'135px'},{t:'Khách hàng'},{t:'Thành phẩm',cls:'hide-sm'},{t:'Ngày giờ đặt'},{t:'Giao dự kiến',cls:'hide-sm'},{t:'Giá trị',cls:'right'},{t:'Trạng thái'},{t:'Thao tác',cls:'right',w:'118px'}],rows,{emptyTitle:'Không có đơn hàng phù hợp'})}
    ${pagiHTML('orders',pg,'đơn hàng')}</div>`;
};

function openOrderForm(customerId = '', opportunityId = '') {
  const customerOptions = (DB.customers||[]).map(c=>`<option value="${c.id}" ${c.id===customerId?'selected':''}>${esc(c.id+' · '+c.name)}</option>`).join('');
  const salesEmployees = (DB.employees||[])
    .filter(e => String(e.dept||'').trim().toLowerCase() === 'kinh doanh' && String(e.status||'ns_dang_lam') !== 'ns_nghi_viec');
  // Tài khoản nhân sự mới có thể đăng nhập trước khi DB.employees refresh xong.
  // Vì vậy phải lấy empId/department từ actor đang đăng nhập làm nguồn chính,
  // không phụ thuộc việc hồ sơ nhân sự đã kịp xuất hiện trong salesEmployees hay chưa.
  const authUser = (typeof SystemAPI !== 'undefined' && typeof SystemAPI.currentUser === 'function') ? SystemAPI.currentUser() : null;
  const loggedEmpId = String(authUser?.empId || DB.currentUser?.id || '').trim();
  const loggedDept = String(authUser?.dept || DB.currentUser?.dept || '').trim().toLowerCase();
  const loggedRole = String(authUser?.roleId || DB.currentUser?.roleId || '').trim();
  const isLoggedSales = !!loggedEmpId && (loggedDept === 'kinh doanh' || loggedRole === 'ROLE_SALES' || loggedRole === 'ROLE_SALES_MANAGER');
  const currentSalesId = isLoggedSales ? loggedEmpId : '';
  const loggedEmployee = salesEmployees.find(e=>String(e.id)===currentSalesId);
  const loggedSalesName = loggedEmployee?.name || authUser?.fullName || authUser?.name || DB.currentUser?.name || currentSalesId;
  const ownerOptions = currentSalesId
    ? `<option value="${esc(currentSalesId)}" selected>${esc(currentSalesId+' · '+loggedSalesName)}</option>`
    : salesEmployees.map(e=>`<option value="${e.id}">${esc(e.id+' · '+e.name)}</option>`).join('');
  // Cho phép chọn toàn bộ thành phẩm trong master, kể cả đang hết/thiếu tồn.
  // Tạo đơn chỉ ghi nhận nhu cầu bán; sau khi duyệt, Kho sẽ kiểm tra tồn và lập
  // Kế hoạch sản xuất cho phần thiếu theo luồng Đơn bán → Kho → Sản xuất.
  const sellableProducts = (DB.products || []);
  const productOptions = sellableProducts.map(p=>{
    const available = Number(SalesCRM.finishedAvailable(p.id) || 0);
    const stockText = available > 0
      ? `tồn TP ${fmtN(available)} ${p.unit||''}`
      : 'HẾT HÀNG';
    return `<option value="${p.id}" data-price="${Number(p.price||0)}">${esc(p.id+' · '+p.name+' · '+stockText)}</option>`;
  }).join('');
  const opp = (DB.crmOpportunities||[]).find(o=>o.id===opportunityId);
  Modal.open({
    title:'Tạo đơn hàng bán',
    sub:'Bán thành phẩm trực tiếp cho khách hàng · Không phụ thuộc báo giá legacy', size:'lg',
    body:`<form id="crmOrderForm" novalidate>
      <div class="grid g-2">
        <div class="field"><label>Khách hàng <b>*</b></label><select class="inp" id="crmOrderCustomer"><option value="">-- Chọn khách hàng --</option>${customerOptions}</select></div>
        <div class="field"><label>Nhân viên sale</label><select class="inp" id="crmOrderOwner" ${currentSalesId?'disabled':''}>${ownerOptions}</select>${currentSalesId?`<input type="hidden" id="crmOrderOwnerLocked" value="${esc(currentSalesId)}">`:''}<div class="cell-sub">${currentSalesId?'Tự động lấy nhân viên Kinh doanh đang đăng nhập và không cho chọn người khác.':'Chỉ hiển thị nhân sự thuộc phòng Kinh doanh.'}</div></div>
        <div class="field"><label>Ngày giờ đặt hàng <b>*</b></label><input class="inp" type="datetime-local" id="crmOrderDate" value="${nowLocalDT()}" min="${currentDateYMD()}T00:00"></div>
        <div class="field"><label>Ngày giao dự kiến <b>*</b></label><input class="inp" type="date" id="crmOrderDue" value="${currentDateYMD()}" min="${currentDateYMD()}"></div>
        <div class="field"><label>Hạn thanh toán</label><input class="inp" type="date" id="crmPaymentDue" value="${currentDateYMD()}" min="${currentDateYMD()}"><div class="cell-sub">Dùng để cảnh báo công nợ quá hạn.</div></div>
        <div class="field"><label>Tỉnh / Thành phố <b>*</b></label><select class="inp" id="crmDeliveryProvince"><option value="">-- Chọn Tỉnh/Thành phố --</option></select></div>
        <div class="field" style="display:none"><label>Quận / Huyện</label><select class="inp" id="crmDeliveryDistrict"><option value=""></option></select></div>
        <div class="field"><label>Phường / Xã / Đặc khu <b>*</b></label><select class="inp" id="crmDeliveryWard"><option value="">-- Chọn Phường/Xã/Đặc khu --</option></select></div>
        <div class="field"><label>Địa chỉ chi tiết <b>*</b></label><input class="inp" id="crmDeliveryAddressDetail" placeholder="Số nhà, tên đường, tòa nhà..."> <div class="cell-sub" id="crmDeliveryAddressNote">Hệ thống tự ghép thành địa chỉ giao hàng đầy đủ; nhân viên không cần nhập tọa độ.</div></div>
        <input type="hidden" id="crmDeliveryLat" value="">
        <input type="hidden" id="crmDeliveryLng" value="">
        <div class="field"><label>Người nhận</label><input class="inp" id="crmDeliveryRecipient" placeholder="Tên người nhận"></div>
        <div class="field"><label>Số điện thoại nhận hàng</label><input class="inp" id="crmDeliveryPhone" placeholder="SĐT người nhận"></div>
      </div>
      ${opportunityId?`<input type="hidden" id="crmOrderOpportunity" value="${esc(opportunityId)}"><div class="note-box" style="margin-bottom:12px">Tạo từ cơ hội <b>${esc(opportunityId)}</b>${opp?` · ${esc(SalesCRM.customerNameForOpp(opp))}`:''}</div>`:'<input type="hidden" id="crmOrderOpportunity" value="">'}
      <div class="form-sec-title"><i class="fa-solid fa-box"></i>Thành phẩm bán</div>
      ${sellableProducts.length ? `
      <div id="crmOrderLines" data-options="${encodeURIComponent(productOptions)}">
        ${crmOrderLineHTML(productOptions, true)}
      </div>
      <button type="button" class="btn btn-sm" data-act="crm-order-add-line"><i class="fa-solid fa-plus"></i>Thêm thành phẩm</button>` : `
      <div class="note-box" style="border-color:var(--orange);background:var(--orange-soft)">
        <b>Chưa có danh mục thành phẩm.</b><br>Vui lòng khai báo thành phẩm trước khi tạo đơn bán.
      </div>`}
      <div class="grid g-2" style="margin-top:14px">
        <div class="field"><label>Phí vận chuyển thu khách</label><input class="inp right num" type="text" inputmode="numeric" id="crmShippingFee" data-money="1" value="0"><div class="cell-sub">Số tiền vận chuyển khách đồng ý thanh toán; được cộng vào tổng thanh toán của đơn hàng.</div></div>
        <div class="field" style="grid-column:1/-1"><label>Chi phí khác</label><div id="crmOtherCosts">${crmOtherCostLineHTML({}, true)}</div><button type="button" class="btn btn-sm" data-act="crm-order-add-cost"><i class="fa-solid fa-plus"></i>Thêm chi phí</button><div class="cell-sub">Có thể thêm nhiều khoản chi phí; mỗi khoản ghi rõ nội dung và số tiền.</div></div>
        <div class="field"><label>Ghi chú đơn hàng</label><input class="inp" id="crmOrderNote" placeholder="Ghi chú bán hàng"></div>
        <div class="field"><label>Ghi chú giao hàng</label><input class="inp" id="crmDeliveryNote" placeholder="Giờ nhận, cổng giao, yêu cầu liên hệ…"></div>
      </div>
      <div class="note-box" id="crmOrderTotals" style="margin-top:10px">
        <div style="display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:10px">
          <div><span class="cell-sub">Tạm tính</span><div class="strong" data-total="subtotal">0 ₫</div></div>
          <div><span class="cell-sub">VAT</span><div class="strong" data-total="vat">0 ₫</div></div>
          <div><span class="cell-sub">Phí vận chuyển</span><div class="strong" data-total="shipping">0 ₫</div></div>
          <div><span class="cell-sub">Chi phí khác</span><div class="strong" data-total="other">0 ₫</div></div>
          <div><span class="cell-sub">Tổng thanh toán</span><div class="strong" data-total="grand" style="font-size:16px">0 ₫</div></div>
        </div>
      </div>
      <div class="note-box"><b>Nguyên tắc kho:</b> Có thể đặt cả thành phẩm đang hết/thiếu tồn. Tạo đơn không trừ tồn. Sau khi đơn được duyệt, Kho kiểm tra tồn: phần thiếu sẽ xuất hiện tại <b>Kho → Kế hoạch sản xuất → Nhu cầu từ đơn bán</b> để lập kế hoạch sản xuất; phần đủ tồn chỉ trừ khi Kho xác nhận xuất bán.</div>
    </form>`,
    foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="crm-order-save" ${sellableProducts.length ? '' : 'disabled'}><i class="fa-solid fa-floppy-disk"></i>Lưu đơn hàng</button>`
  });
  const initDeliveryAddress = async (values={}) => {
    if (typeof VNAddress !== 'undefined') await VNAddress.init({provinceId:'crmDeliveryProvince',districtId:'crmDeliveryDistrict',wardId:'crmDeliveryWard',noteId:'crmDeliveryAddressNote',province:values.province||'',district:values.district||'',ward:values.ward||''});
  };
  const fillDeliveryFromCustomer = async () => {
    const c = Q.customer(document.querySelector('#crmOrderCustomer')?.value || '');
    const detail = document.querySelector('#crmDeliveryAddressDetail');
    const recipient = document.querySelector('#crmDeliveryRecipient');
    const phone = document.querySelector('#crmDeliveryPhone');
    if (!c) { await initDeliveryAddress({}); return; }

    // Ưu tiên cấu trúc địa chỉ mới nếu khách hàng đã có province/district/ward/addressDetail.
    // Với dữ liệu khách hàng legacy chỉ có `address` đầy đủ, không ghép thêm tỉnh lần nữa.
    const hasStructured = !!(c.addressDetail || c.ward);
    const structured = hasStructured
      ? {province:c.province||'', district:'', ward:c.ward||''}
      : {province:'', district:'', ward:''};
    await initDeliveryAddress(structured);

    if (detail && (!detail.value || detail.dataset.auto === '1')) {
      detail.value = hasStructured ? (c.addressDetail || '') : (c.address || '');
      detail.dataset.auto = '1';
    }
    if (recipient && (!recipient.value || recipient.dataset.auto === '1')) { recipient.value = c.contact || c.name || ''; recipient.dataset.auto = '1'; }
    if (phone && (!phone.value || phone.dataset.auto === '1')) { phone.value = String(c.phone || '').replace(/\D/g, '').slice(0,10); phone.dataset.auto = '1'; }
  };
  document.querySelector('#crmOrderCustomer')?.addEventListener('change', fillDeliveryFromCustomer);
  ['#crmDeliveryAddressDetail','#crmDeliveryRecipient','#crmDeliveryPhone'].forEach(sel => document.querySelector(sel)?.addEventListener('input', ev => { ev.currentTarget.dataset.auto = '0'; }));
  fillDeliveryFromCustomer();
  setTimeout(() => { bindCrmOrderWeightEvents(document); bindCrmOtherCostEvents(document); document.getElementById('crmShippingFee')?.addEventListener('input',()=>updateCrmOrderTotals(document)); updateCrmOrderTotals(document); }, 0);
}

function crmUnitIsKg(unit) {
  const u = String(unit || '').trim().toLowerCase().replace(/\s+/g, '');
  return ['kg','kgs','kilogram','kilograms','kilôgam','kilogam'].includes(u);
}

function crmIsKgProduct(productOrId) {
  const p = typeof productOrId === 'string' ? Q.product(productOrId) : productOrId;
  return !!p && crmUnitIsKg(p.unit);
}

function crmPackedWeightKg(productId) {
  const p = Q.product(productId);
  // Thành phẩm có ĐVT = Kg: số lượng chính là khối lượng vận chuyển (1 đơn vị = 1 kg).
  if (crmIsKgProduct(p)) return 1;
  return Math.max(0, Number(p?.packedWeightG||0)>0 ? Number(p.packedWeightG)/1000 : Number(p?.packedWeightKg || 0));
}

function applyCrmOrderQtyRule(row) {
  if (!row) return;
  const productId = row.querySelector('select[name="product"]')?.value || '';
  const p = Q.product(productId);
  const input = row.querySelector('input[name="qty"]');
  if (!input) return;
  const isKg = crmIsKgProduct(p);
  input.min = isKg ? '0.001' : '1';
  input.step = isKg ? '0.001' : '1';
  input.inputMode = isKg ? 'decimal' : 'numeric';
}

function updateCrmOrderLineWeight(row) {
  if (!row) return;
  const productId = row.querySelector('select[name="product"]')?.value || '';
  const qty = Math.max(0, Number(row.querySelector('input[name="qty"]')?.value || 0));
  const perUnit = crmPackedWeightKg(productId);
  const out = row.querySelector('[data-role="line-weight"]');
  const hint = row.querySelector('[data-role="weight-hint"]');
  if (out) out.value = perUnit > 0 && qty > 0 ? (perUnit * qty).toFixed(3).replace(/\.?0+$/, '') : '';
  const p = Q.product(productId);
  if (hint) hint.textContent = productId
    ? (crmIsKgProduct(p) ? 'ĐVT Kg: khối lượng = số lượng đã nhập.' : (perUnit > 0 ? `${perUnit.toLocaleString('vi-VN',{maximumFractionDigits:3})} kg / ${p?.unit || 'ĐVT'}` : 'Chưa khai báo khối lượng đóng gói'))
    : '';
}

function crmOtherCostLineHTML(item={}, first=false) {
  const name = esc(item.name || item.label || '');
  const amount = Number(item.amount || item.value || 0);
  return `<div class="crm-other-cost-line" style="display:grid;grid-template-columns:minmax(220px,2fr) 170px 44px;gap:8px;align-items:end;margin-bottom:8px">
    <div class="field" style="margin:0"><label>Nội dung chi phí</label><input class="inp" name="otherCostName" value="${name}" placeholder="Ví dụ: Phí đóng gói đặc biệt"></div>
    <div class="field" style="margin:0"><label>Số tiền</label><input class="inp right num" name="otherCostAmount" data-money="1" type="text" inputmode="numeric" value="${amount}" placeholder="0"></div>
    <button type="button" class="btn btn-sm" data-act="crm-order-remove-cost" ${first?'disabled':''}><i class="fa-solid fa-trash"></i></button>
  </div>`;
}

function crmReadOtherCosts(root=document) {
  return [...(root.querySelectorAll?.('.crm-other-cost-line') || [])].map(row=>({
    name:(row.querySelector('input[name="otherCostName"]')?.value||'').trim(),
    amount:Math.max(0, parseMoney(row.querySelector('input[name="otherCostAmount"]')?.value)||0)
  })).filter(x=>x.name || x.amount>0);
}

function bindCrmOtherCostEvents(root=document) {
  root.querySelectorAll?.('.crm-other-cost-line').forEach(row=>{
    if(row.dataset.costBound==='1') return;
    row.dataset.costBound='1';
    row.querySelector('input[name="otherCostAmount"]')?.addEventListener('input',()=>updateCrmOrderTotals(document));
  });
}

function updateCrmOrderTotals(root=document) {
  const box = root.querySelector?.('#crmOrderTotals') || document.querySelector('#crmOrderTotals');
  const wrap = root.querySelector?.('#crmOrderLines') || document.querySelector('#crmOrderLines');
  if (!box || !wrap) return;
  let subtotal=0, vat=0;
  wrap.querySelectorAll('.crm-order-line').forEach(row=>{
    const qty=Math.max(0,Number(row.querySelector('input[name="qty"]')?.value||0));
    const product=Q.product(row.querySelector('select[name="product"]')?.value||'');
    const price=parseMoney(row.querySelector('input[name="price"]')?.value)||Number(product?.price||0);
    const rate=Math.max(0,Number(row.querySelector('select[name="vatRate"]')?.value||0));
    const amount=qty*price; subtotal+=amount; vat+=Math.round(amount*rate/100);
  });
  const shipping=Math.max(0,parseMoney(document.querySelector('#crmShippingFee')?.value)||0);
  const other=crmReadOtherCosts(document).reduce((sum,x)=>sum+Number(x.amount||0),0);
  const values={subtotal,vat,shipping,other,grand:subtotal+vat+shipping+other};
  Object.entries(values).forEach(([k,v])=>{const el=box.querySelector(`[data-total="${k}"]`);if(el)el.textContent=fmtVND(v);});
}

function bindCrmOrderWeightEvents(root=document) {
  root.querySelectorAll?.('.crm-order-line').forEach(row => {
    if (row.dataset.weightBound === '1') { updateCrmOrderLineWeight(row); return; }
    row.dataset.weightBound = '1';
    row.querySelector('select[name="product"]')?.addEventListener('change', () => { applyCrmOrderQtyRule(row); updateCrmOrderLineWeight(row); updateCrmOrderTotals(document); });
    row.querySelector('input[name="qty"]')?.addEventListener('input', () => { updateCrmOrderLineWeight(row); updateCrmOrderTotals(document); });
    row.querySelector('input[name="price"]')?.addEventListener('input', () => updateCrmOrderTotals(document));
    row.querySelector('select[name="vatRate"]')?.addEventListener('change', () => updateCrmOrderTotals(document));
    applyCrmOrderQtyRule(row);
    updateCrmOrderLineWeight(row);
    updateCrmOrderTotals(document);
  });
}

function crmOrderLineHTML(options, first=false) {
  return `<div class="crm-order-line" style="display:grid;grid-template-columns:minmax(230px,2fr) 125px 125px 92px 125px 44px;gap:8px;align-items:end;margin-bottom:8px">
    <div class="field" style="margin:0"><label>Thành phẩm</label><select class="inp" name="product"><option value="">-- Chọn thành phẩm --</option>${options}</select></div>
    <div class="field" style="margin:0"><label>Số lượng</label><input class="inp right num" name="qty" type="number" min="1" step="1"></div>
    <div class="field" style="margin:0"><label>Đơn giá</label><input class="inp right num" name="price" data-money="1" type="text" inputmode="numeric"></div>
    <div class="field" style="margin:0"><label>VAT</label><select class="inp" name="vatRate"><option value="0">0%</option><option value="5">5%</option><option value="8">8%</option><option value="10" selected>10%</option></select></div>
    <div class="field" style="margin:0"><label>Khối lượng (kg)</label><input class="inp right num" data-role="line-weight" readonly placeholder="0"></div>
    <button type="button" class="btn btn-sm" data-act="crm-order-remove-line" ${first?'disabled':''}><i class="fa-solid fa-trash"></i></button>
  </div>`;
}


function openOrderEditForm(id) {
  const o = Q.order(id); if (!o) return;
  const customerOptions = (DB.customers||[]).map(c=>`<option value="${c.id}" ${c.id===o.customerId?'selected':''}>${esc(c.id+' · '+c.name)}</option>`).join('');
  const ownerOptions = (DB.employees||[])
    .filter(e => String(e.dept||'').trim().toLowerCase() === 'kinh doanh' && String(e.status||'ns_dang_lam') !== 'ns_nghi_viec')
    .map(e=>`<option value="${e.id}" ${e.id===o.ownerId?'selected':''}>${esc(e.id+' · '+e.name)}</option>`).join('');
  const products = (DB.products||[]);
  const productOptions = products.map(p=>{
    const available = Number(SalesCRM.finishedAvailable(p.id) || 0);
    const stockText = available > 0 ? `tồn TP ${fmtN(available)} ${p.unit||''}` : 'HẾT HÀNG';
    return `<option value="${p.id}" data-price="${Number(p.price||0)}">${esc(p.id+' · '+p.name+' · '+stockText)}</option>`;
  }).join('');
  const rows = (o.items||[]).map((it,idx)=>`<div class="crm-order-line" style="display:grid;grid-template-columns:minmax(230px,2fr) 125px 125px 92px 125px 44px;gap:8px;align-items:end;margin-bottom:8px">
    <div class="field" style="margin:0"><label>Thành phẩm</label><select class="inp" name="product"><option value="">-- Chọn thành phẩm --</option>${products.map(p=>{const av=Number(SalesCRM.finishedAvailable(p.id)||0);return `<option value="${p.id}" ${p.id===it.productId?'selected':''}>${esc(p.id+' · '+p.name+' · '+(av>0?`tồn TP ${fmtN(av)} ${p.unit||''}`:'HẾT HÀNG'))}</option>`;}).join('')}</select></div>
    <div class="field" style="margin:0"><label>Số lượng</label><input class="inp right num" name="qty" type="number" min="1" step="1" value="${Number(it.qty||0)}"></div>
    <div class="field" style="margin:0"><label>Đơn giá</label><input class="inp right num" name="price" data-money="1" type="text" inputmode="numeric" value="${Number(it.price||0)}"></div>
    <div class="field" style="margin:0"><label>VAT</label><select class="inp" name="vatRate">${[0,5,8,10].map(v=>`<option value="${v}" ${Number(it.vatRate ?? o.vatRate ?? 10)===v?'selected':''}>${v}%</option>`).join('')}</select></div>
    <div class="field" style="margin:0"><label>Khối lượng</label><input class="inp right num" data-role="line-weight" readonly value="${Number(it.shippingWeightKg||0)>0?Number(it.shippingWeightKg).toFixed(3).replace(/\.?0+$/,''):''}"><div class="cell-sub" data-role="weight-hint"></div></div>
    <button type="button" class="btn btn-sm" data-act="crm-order-remove-line" ${(o.items||[]).length===1?'disabled':''}><i class="fa-solid fa-trash"></i></button>
  </div>`).join('');
  Modal.open({title:`Cập nhật đơn hàng ${o.id}`,sub:'Cập nhật thông tin đơn hàng bán; trạng thái duyệt được giữ nguyên.',size:'lg',body:`<form id="crmOrderEditForm" novalidate>
    <div class="grid g-2">
      <div class="field"><label>Khách hàng *</label><select class="inp" id="crmOrderCustomer">${customerOptions}</select></div>
      <div class="field"><label>Nhân viên sale</label><select class="inp" id="crmOrderOwner">${ownerOptions}</select></div>
      <div class="field"><label>Ngày giờ đặt hàng *</label><input class="inp" type="datetime-local" id="crmOrderDate" value="${esc(toLocalDT(o.orderedAt) || ((o.date||currentDateYMD())+'T00:00'))}"></div>
      <div class="field"><label>Ngày giao dự kiến *</label><input class="inp" type="date" id="crmOrderDue" value="${esc(o.dueDate||currentDateYMD())}"></div>
      <div class="field"><label>Hạn thanh toán</label><input class="inp" type="date" id="crmPaymentDue" value="${esc(o.paymentDueDate||o.dueDate||currentDateYMD())}"><div class="cell-sub">Dùng để cảnh báo công nợ quá hạn.</div></div>
      <div class="field"><label>Tỉnh / Thành phố *</label><select class="inp" id="crmDeliveryProvince"><option value="${esc(o.deliveryProvince||'')}">${esc(o.deliveryProvince||'-- Chọn Tỉnh/Thành phố --')}</option></select></div>
      <div class="field" style="display:none"><label>Quận / Huyện</label><select class="inp" id="crmDeliveryDistrict"><option value=""></option></select></div>
      <div class="field"><label>Phường / Xã / Đặc khu *</label><select class="inp" id="crmDeliveryWard"><option value="${esc(o.deliveryWard||'')}">${esc(o.deliveryWard||'-- Chọn Phường/Xã/Đặc khu --')}</option></select></div>
      <div class="field"><label>Địa chỉ chi tiết *</label><input class="inp" id="crmDeliveryAddressDetail" value="${esc(o.deliveryAddressDetail || (!o.deliveryProvince ? (o.deliveryAddress||Q.customer(o.customerId)?.address||'') : ''))}" placeholder="Số nhà, tên đường, tòa nhà..."><div class="cell-sub" id="crmDeliveryAddressNote">Tọa độ được xử lý nội bộ khi Logistics cần tính tuyến.</div></div>
      <input type="hidden" id="crmDeliveryLat" value="${Number(o.deliveryLat||0)||''}">
      <input type="hidden" id="crmDeliveryLng" value="${Number(o.deliveryLng||0)||''}">
      <div class="field"><label>Người nhận</label><input class="inp" id="crmDeliveryRecipient" value="${esc(o.deliveryRecipient||Q.customer(o.customerId)?.contact||Q.customerName(o.customerId)||'')}"></div>
      <div class="field"><label>Số điện thoại nhận hàng</label><input class="inp" id="crmDeliveryPhone" value="${esc(o.deliveryPhone||Q.customer(o.customerId)?.phone||'')}"></div>
    </div>
    <div class="form-sec-title"><i class="fa-solid fa-box"></i>Thành phẩm bán</div>
    <div id="crmOrderLines" data-options="${encodeURIComponent(productOptions)}">${rows}</div>
    <button type="button" class="btn btn-sm" data-act="crm-order-add-line"><i class="fa-solid fa-plus"></i>Thêm thành phẩm</button>
    <div class="grid g-2" style="margin-top:14px"><div class="field"><label>Phí vận chuyển thu khách</label><input class="inp right num" type="text" inputmode="numeric" id="crmShippingFee" data-money="1" value="${Number(o.shippingFee||0)}"></div><div class="field" style="grid-column:1/-1"><label>Chi phí khác</label><div id="crmOtherCosts">${((o.otherCosts&&o.otherCosts.length)?o.otherCosts:[...(Number(o.otherCost||0)>0?[{name:'Chi phí khác',amount:Number(o.otherCost||0)}]:[{}])]).map((x,i)=>crmOtherCostLineHTML(x,i===0)).join('')}</div><button type="button" class="btn btn-sm" data-act="crm-order-add-cost"><i class="fa-solid fa-plus"></i>Thêm chi phí</button><div class="cell-sub">Mỗi khoản ghi rõ nội dung và số tiền.</div></div><div class="field"><label>Ghi chú đơn hàng</label><input class="inp" id="crmOrderNote" value="${esc(o.note||'')}"></div><div class="field"><label>Ghi chú giao hàng</label><input class="inp" id="crmDeliveryNote" value="${esc(o.deliveryNote||'')}"></div></div>
    <div class="note-box" id="crmOrderTotals" style="margin-top:10px"><div style="display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:10px"><div><span class="cell-sub">Tạm tính</span><div class="strong" data-total="subtotal">0 ₫</div></div><div><span class="cell-sub">VAT</span><div class="strong" data-total="vat">0 ₫</div></div><div><span class="cell-sub">Phí vận chuyển</span><div class="strong" data-total="shipping">0 ₫</div></div><div><span class="cell-sub">Chi phí khác</span><div class="strong" data-total="other">0 ₫</div></div><div><span class="cell-sub">Tổng thanh toán</span><div class="strong" data-total="grand" style="font-size:16px">0 ₫</div></div></div></div>
  </form>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="crm-order-edit-save" data-id="${esc(o.id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu thay đổi</button>`});
  if (typeof VNAddress !== 'undefined') VNAddress.init({provinceId:'crmDeliveryProvince',districtId:'crmDeliveryDistrict',wardId:'crmDeliveryWard',noteId:'crmDeliveryAddressNote',province:o.deliveryProvince||'',district:o.deliveryDistrict||'',ward:o.deliveryWard||''});
  setTimeout(() => { bindCrmOrderWeightEvents(document); bindCrmOtherCostEvents(document); document.getElementById('crmShippingFee')?.addEventListener('input',()=>updateCrmOrderTotals(document)); updateCrmOrderTotals(document); }, 0);
}

function crmReadDeliveryAddressForm(){
  const x = (typeof VNAddress !== 'undefined') ? VNAddress.read('crmDelivery') : {province:document.querySelector('#crmDeliveryProvince')?.value?.trim()||'',district:document.querySelector('#crmDeliveryDistrict')?.value?.trim()||'',ward:document.querySelector('#crmDeliveryWard')?.value?.trim()||'',addressDetail:document.querySelector('#crmDeliveryAddressDetail')?.value?.trim()||''};
  if(!x.address) x.address=[x.addressDetail,x.ward,x.province].filter(Boolean).join(', ');
  return x;
}

Views['order-detail'] = function (params) {
  const o = Q.order(params.id);
  if (!o) return `<div class="empty"><h4>Không tìm thấy đơn hàng</h4></div>`;
  const customer = Q.customer(o.customerId);
  const stock = SalesCRM.orderStockState(o);
  const issues = SalesCRM.salesIssuesOf(o.id);
  // Đơn đã giao/hoàn tất về nghiệp vụ bắt buộc đã qua Xuất kho bán hàng.
  // Fallback trạng thái cuối giúp summary không hiển thị sai "Chưa xuất" trong lúc
  // goodsIssues vừa được hydrate từ server hoặc với dữ liệu lịch sử cũ.
  const issued = issues.length > 0 || ['dh_da_giao','dh_hoan_tat','dh_hoan_thanh'].includes(o.status);
  const pos = Q.posOfOrder(o.id);
  const productionPlans = (DB.productionPlans || []).filter(p => p.source === 'SALES_ORDER' && p.sourceOrderId === o.id && p.status !== 'CANCELLED');
  const canIssue = !['dh_da_huy','dh_da_giao','dh_hoan_tat','dh_cho_xu_ly','dh_hoan_thanh'].includes(o.status) && stock.enough && !issued;
  const complaints = (DB.crmTickets || []).filter(t => t.type === 'COMPLAINT' && t.orderId === o.id);
  const paidAmount = SalesCRM.paidOfOrder(o.id);
  const receivableAmount = SalesCRM.receivableOfOrder(o);
  const canCrmOperate = typeof Auth === 'undefined' || Auth.hasPermission('CRM_OPERATE');
  const canSalesOperate = typeof Auth === 'undefined' || Auth.hasPermission('SALES_ORDER_OPERATE');
  const canSalesApprove = typeof Auth !== 'undefined' && Auth.hasPermission('SALES_APPROVE');
  const canInventoryOperate = typeof Auth !== 'undefined' && Auth.hasPermission('INVENTORY_OPERATE');
  const canLogisticsView = typeof Auth !== 'undefined' && Auth.hasPermission('LOGISTICS_VIEW');

  return `${pageHead(`Đơn hàng ${o.id}`, `${esc(Q.customerName(o.customerId))} · Giao dự kiến ${fmtDate(o.dueDate)}`, `
    <button class="btn" data-act="crm-go-orders"><i class="fa-solid fa-arrow-left"></i>Danh sách</button>
    ${canCrmOperate ? `<button class="btn" data-act="crm-order-complaint" data-id="${o.id}"><i class="fa-solid fa-triangle-exclamation"></i>Thêm khiếu nại</button>` : ''}
    ${canSalesOperate ? `<button class="btn" data-act="crm-order-edit" data-id="${o.id}"><i class="fa-solid fa-pen"></i>Sửa</button>` : ''}
    ${canSalesOperate && o.status==='dh_cho_xu_ly' && !o.approvedAt ? `<button class="btn" data-act="crm-order-delete" data-id="${o.id}"><i class="fa-solid fa-trash"></i>Xóa</button>` : ''}
    ${o.status==='dh_cho_xu_ly' && canSalesApprove ? `<button class="btn" data-act="crm-order-reject" data-id="${o.id}"><i class="fa-solid fa-xmark"></i>Từ chối</button><button class="btn btn-primary" data-act="crm-order-approve" data-id="${o.id}"><i class="fa-solid fa-check"></i>Duyệt đơn</button>` : ''}
    ${canLogisticsView ? `<button class="btn btn-primary" data-act="crm-order-deliver" data-id="${o.id}"><i class="fa-solid fa-truck-fast"></i>${o.logisticsDeliveryId?'Mở đơn giao':(o.status==='dh_hoan_thanh'&&o.pendingIssueId?'Theo dõi giao hàng':'Về Logistics')}</button>` : ''}
    ${['dh_da_giao','dh_hoan_tat'].includes(o.status) ? `<button class="btn" data-act="crm-order-invoice" data-id="${o.id}"><i class="fa-solid fa-file-invoice"></i>Hóa đơn (PDF)</button>` : ''}
    ${canCrmOperate && ['dh_da_giao','dh_hoan_tat'].includes(o.status) && SalesCRM.receivableOfOrder(o)>0 ? `<button class="btn" data-act="crm-customer-pay-modal" data-id="${o.id}"><i class="fa-solid fa-hand-holding-dollar"></i>Thu tiền</button>` : ''}
    ${canSalesOperate && o.status==='dh_da_giao' ? `<button class="btn btn-primary" data-act="crm-order-complete-open" data-id="${o.id}"><i class="fa-solid fa-circle-check"></i>Xác nhận hoàn thành đơn hàng</button>` : ''}`)}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Giá trị đơn', fmtShort(o.total), 'fa-sack-dollar','blue')}
      ${mkpi('Đã thanh toán', fmtShort(paidAmount), 'fa-circle-check','green')}
      ${mkpi('Còn phải thu', fmtShort(receivableAmount), 'fa-hand-holding-dollar', receivableAmount>0?'red':'green')}
      ${mkpi('Phí vận chuyển thu khách', fmtShort(Number(o.shippingFee||0)), 'fa-truck','indigo')}
      ${mkpi('Khối lượng vận chuyển', `${Number(o.shippingWeightKg||0).toLocaleString('vi-VN',{maximumFractionDigits:3})} kg`, 'fa-weight-hanging','slate')}
      ${mkpi('Số dòng hàng', (o.items||[]).length, 'fa-boxes-stacked','indigo')}
      ${mkpi('Tình trạng tồn TP', stock.enough?'Đủ':'Thiếu', stock.enough?'fa-circle-check':'fa-triangle-exclamation', stock.enough?'green':'orange')}
      ${mkpi('Xuất kho bán hàng', issued?'Đã xuất':'Chưa xuất', 'fa-arrow-up-from-bracket', issued?'green':'slate')}
      ${mkpi('Trạng thái', SalesCRM.orderStatus[o.status]?.label||o.status, 'fa-flag','teal')}
    </div>
    <div class="grid g-2" style="margin-bottom:14px">
      <div class="card"><div class="card-head"><div><h3>Thành phẩm đặt mua</h3><p>Tồn chỉ đọc từ Kho thành phẩm đạt QC / còn hạn</p></div></div>
        ${tableShell([{t:'Thành phẩm'},{t:'SL đặt',cls:'right'},{t:'Tồn khả dụng',cls:'right'},{t:'KL đóng gói',cls:'right'},{t:'Khối lượng',cls:'right'},{t:'Đơn giá',cls:'right'},{t:'VAT',cls:'right'},{t:'Tiền VAT',cls:'right'},{t:'Thành tiền',cls:'right'}], (o.items||[]).map(it=>{
          const av=SalesCRM.finishedAvailable(it.productId);
          const p=Q.product(it.productId);
          const per=Number(it.packedWeightKg || (Number(p?.packedWeightG||0)>0 ? Number(p.packedWeightG)/1000 : p?.packedWeightKg) || 0);
          const line=Number(it.shippingWeightKg||Number(it.qty||0)*per);
          const vatRate=Number(it.vatRate ?? o.vatRate ?? 0);
          const vatAmount=Number(it.vatAmount ?? Math.round(Number(it.amount||0)*vatRate/100));
          const lineTotal=Number(it.lineTotal ?? (Number(it.amount||0)+vatAmount));
          return `<tr><td>${cell2(esc(it.name),`<span class="code">${esc(it.productId)}</span> · ${esc(it.unit||'')}`)}</td><td class="right num">${fmtN(it.qty)}</td><td class="right num" style="color:${av>=Number(it.qty)?'var(--green)':'var(--orange)'}">${fmtN(av)}</td><td class="right num">${per>0?(per*1000).toLocaleString('vi-VN',{maximumFractionDigits:2})+' g':'—'}</td><td class="right num">${line>0?line.toLocaleString('vi-VN',{maximumFractionDigits:3})+' kg':'—'}</td><td class="right num">${fmtVND(it.price)}</td><td class="right num">${vatRate}%</td><td class="right num">${fmtVND(vatAmount)}</td><td class="right strong num">${fmtVND(lineTotal)}</td></tr>`;
        }),{emptyTitle:'Đơn chưa có thành phẩm'})}
      </div>
      <div class="card"><div class="card-head"><div><h3>Thông tin bán hàng</h3></div></div><div class="card-body"><dl class="dl">
        <dt>Khách hàng</dt><dd>${esc(customer?.name||'—')}</dd><dt>Khu vực</dt><dd>${esc(customer?.province||'—')}</dd>
        <dt>Sale phụ trách</dt><dd>${esc(Q.employeeName(o.ownerId))}</dd><dt>Ngày giờ đặt</dt><dd>${fmtDT(o.orderedAt||o.date)}</dd><dt>Ngày giao</dt><dd>${fmtDate(o.dueDate)}</dd>
        <dt>Địa chỉ giao</dt><dd>${esc(o.deliveryAddress||customer?.address||'—')}</dd><dt>Người nhận</dt><dd>${esc(o.deliveryRecipient||customer?.contact||'—')} ${o.deliveryPhone?`· ${esc(o.deliveryPhone)}`:''}</dd>
        <dt>VAT theo sản phẩm</dt><dd><b>${fmtVND(Number(o.vat||0))}</b></dd><dt>Phí vận chuyển thu khách</dt><dd>${Number(o.shippingFee||0)>0?`<b>${fmtVND(Number(o.shippingFee||0))}</b>`:'<span class="muted">Chưa xác định</span>'}</dd><dt>Chi phí khác</dt><dd><b>${fmtVND(Number(o.otherCost||0))}</b>${(o.otherCosts||[]).length?`<div class="cell-sub" style="margin-top:4px">${(o.otherCosts||[]).map(x=>`${esc(x.name||'Chi phí khác')}: ${fmtVND(Number(x.amount||0))}`).join('<br>')}</div>`:''}</dd><dt>Chi phí vận chuyển thực tế</dt><dd>${Number(o.actualTransportCost||0)>0?`<b>${fmtVND(Number(o.actualTransportCost||0))}</b>`:'<span class="muted">Chưa quyết toán</span>'}</dd>
        <dt>Chính sách phí vận chuyển</dt><dd>${Number(o.actualTransportCost||0)>0&&Number(o.shippingFee||0)>0?(()=>{const diff=Number(o.shippingFee||0)-Number(o.actualTransportCost||0);if(Math.abs(diff)<0.5)return '<span class="badge green">Thu đúng chi phí</span>';if(diff<0)return `<span class="badge orange">Doanh nghiệp hỗ trợ ${fmtVND(Math.abs(diff))}</span>`;return `<span class="badge green">Thu cao hơn chi phí ${fmtVND(diff)}</span>`;})():'<span class="muted">Chờ quyết toán / xác định phí thu khách</span>'}</dd>
        <dt>Trạng thái vận chuyển</dt><dd>${esc(o.logisticsStatus||'Chưa chuyển Logistics')}</dd><dt>Đơn giao</dt><dd>${o.logisticsDeliveryId?`<span class="code">${esc(o.logisticsDeliveryId)}</span>`:'—'}</dd>
        <dt>Người tạo</dt><dd>${esc(o.createdByName || Q.employeeName(o.createdBy) || '—')}</dd><dt>Người duyệt</dt><dd>${esc(o.approvedByName || Q.employeeName(o.approvedBy) || '—')}</dd><dt>Nguồn đơn</dt><dd>${o.opportunityId?`Cơ hội ${esc(o.opportunityId)}`:'Tạo trực tiếp'}</dd><dt>Phiếu xuất bán</dt><dd>${issues.length?issues.map(x=>`<span class="code">${esc(x.id)}</span>`).join(', '):'<span class="muted">Chưa có</span>'}</dd>
        <dt>Hoàn thành đơn</dt><dd>${o.completedAt?fmtDate(String(o.completedAt).slice(0,10)):'—'}</dd><dt>Hàng trả về</dt><dd>${(o.returnedItems||[]).length?(o.returnedItems||[]).map(x=>`${esc(Q.product(x.productId)?.name||x.productId)}: <b>${fmtN(x.qty)}</b>`).join('<br>'):'Không có'}</dd>
      </dl><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${!issued&&!stock.enough&&o.approvedAt&&!['dh_da_huy','dh_da_giao','dh_hoan_tat'].includes(o.status)?`<span class="badge orange"><i class="fa-solid fa-warehouse"></i> Chờ Kho lập kế hoạch SX</span>`:''}
        ${canIssue && canInventoryOperate?`<button class="btn btn-sm btn-primary" data-act="crm-order-issue" data-id="${o.id}"><i class="fa-solid fa-arrow-up-from-bracket"></i>Xuất kho bán hàng</button>`:''}
        ${canSalesOperate && !['dh_da_huy','dh_da_giao','dh_hoan_tat'].includes(o.status)?`<button class="btn btn-sm" data-act="order-status" data-id="${o.id}"><i class="fa-solid fa-arrows-rotate"></i>Đổi trạng thái</button>`:''}
      </div></div></div>
    </div>
    ${(productionPlans.length || pos.length) ? `<div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Liên kết sản xuất</h3><p>Đơn bán → Kho kiểm tra tồn → Kế hoạch sản xuất → Yêu cầu NVL → LSX</p></div></div>
      ${productionPlans.length ? `<div class="form-sec-title">Kế hoạch sản xuất từ Kho</div>
      ${tableShell([{t:'Kế hoạch'},{t:'Thành phẩm / SL'},{t:'Deadline'},{t:'Trạng thái'},{t:'Thao tác'}],productionPlans.map(p=>`<tr><td><span class="code">${esc(p.id)}</span><div class="cell-sub">Từ ${esc(o.id)}</div></td><td>${(p.items||[]).map(i=>`${esc(Q.product(i.productId)?.name||i.productId)} · <b>${fmtN(i.qty)}</b>`).join('<br>')}</td><td>${fmtDate(p.dueDate)}</td><td>${pfPlanStatus(p.status)}</td><td>${rowActions([{act:'pf-plan-view',data:`data-id="${esc(p.id)}"`,icon:'fa-eye',title:'Xem chi tiết'}])}</td></tr>`),{})}` : ''}
      ${pos.length ? `<div class="form-sec-title" style="margin-top:${productionPlans.length?'14px':'0'}">Lệnh sản xuất</div>
      ${tableShell([{t:'LSX'},{t:'Thành phẩm'},{t:'SL',cls:'right'},{t:'Deadline'},{t:'Trạng thái'}],pos.map(p=>`<tr class="clickable" data-act="open-production-order" data-id="${p.id}"><td><span class="code">${p.id}</span></td><td>${esc(p.productName)}</td><td class="right num">${fmtN(p.qty)} ${esc(p.unit)}</td><td>${fmtDate(p.deadline)}</td><td>${badge(p.status)}</td></tr>`),{})}` : ''}
    </div>` : ''}
    ${complaints.length ? `<div class="card"><div class="card-head"><div><h3>Khiếu nại liên quan đơn hàng</h3><p>Khiếu nại được quản lý ngay trong đơn bán, không cần menu riêng</p></div>${canCrmOperate?`<button class="btn btn-sm" data-act="crm-order-complaint" data-id="${o.id}"><i class="fa-solid fa-plus"></i>Thêm khiếu nại</button>`:''}</div>
      ${tableShell([{t:'Mã'},{t:'Tiêu đề'},{t:'Mức độ'},{t:'Trạng thái'},{t:'Ngày tiếp nhận'},{t:'Thao tác'}],complaints.map(c=>`<tr><td><span class="code">${esc(c.id)}</span></td><td>${esc(c.title)}</td><td>${esc(c.priority||'')}</td><td>${SalesCRM.badgeFrom(SalesCRM.ticketStatus,c.status)}</td><td>${fmtDate(c.createdAt)}</td><td>${rowActions([{act:'crm-complaint-edit',data:`data-id="${c.id}"`,icon:'fa-pen',title:'Cập nhật khiếu nại'}])}</td></tr>`),{})}
    </div>` : ''}`;
};

function crmGeoDistanceKm(lat1,lng1,lat2,lng2){
  lat1=Number(lat1||0);lng1=Number(lng1||0);lat2=Number(lat2||0);lng2=Number(lng2||0);if(!lat1||!lng1||!lat2||!lng2)return null;
  const R=6371,rad=x=>x*Math.PI/180,dLat=rad(lat2-lat1),dLng=rad(lng2-lng1);const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function orderWarehouseAvailability(o,w){
  let ok=true,total=0;for(const item of o.items||[]){const rows=SalesCRM.eligibleFinishedRows(item.productId,w.id);const av=rows.reduce((s,r)=>s+Number(r.qtyAvailable??r.qtyOnHand??0),0);total+=av;if(av<Number(item.qty||0))ok=false;}return {ok,total};
}
function openSalesIssueModal(orderId) {
  const o = Q.order(orderId); if (!o) return;
  const whs = SalesCRM.finishedWarehouses();
  const stock = SalesCRM.orderStockState(o);
  const ranked=whs.map(w=>{const a=orderWarehouseAvailability(o,w);const dist=crmGeoDistanceKm(o.deliveryLat,o.deliveryLng,w.lat||w.latitude,w.lng||w.longitude);return {w,...a,dist};}).sort((a,b)=>(b.ok-a.ok)||((a.dist??1e9)-(b.dist??1e9))||String(a.w.name).localeCompare(String(b.w.name),'vi'));
  const options=ranked.map((x,i)=>`<option value="${x.w.id}" ${i===0&&x.ok?'selected':''}>${x.ok?'✓ ':'⚠ '}${esc(x.w.name)}${x.dist!=null?` · ~${x.dist.toLocaleString('vi-VN',{maximumFractionDigits:1})} km`:''}${!x.ok?' · thiếu hàng':''}</option>`).join('');
  Modal.open({title:'Xuất kho bán hàng',sub:`${o.id} · ${esc(Q.customerName(o.customerId))}`,size:'md',body:`
    <div class="note-box" style="margin-bottom:12px">Hệ thống <b>gợi ý kho thành phẩm còn đủ hàng và gần điểm giao hơn</b> nếu cả Kho và Đơn hàng đã có tọa độ. Người dùng vẫn là người xác nhận kho xuất thực tế.</div>
    <div class="field"><label>Kho thành phẩm xuất <b>*</b></label><select class="inp" id="crmSalesWarehouse"><option value="">-- Chọn kho thành phẩm --</option>${options}</select><div class="cell-sub">✓ đủ toàn bộ đơn · ⚠ thiếu ít nhất một thành phẩm</div></div>
    ${tableShell([{t:'Thành phẩm'},{t:'SL cần',cls:'right'},{t:'Tồn tất cả kho TP',cls:'right'}],stock.lines.map(x=>`<tr><td>${esc(x.name)}</td><td class="right num">${fmtN(x.need)}</td><td class="right num">${fmtN(x.available)}</td></tr>`))}
    <div class="field"><label>Ghi chú xuất hàng</label><textarea class="inp" id="crmSalesIssueNote" rows="2" placeholder="Xuất bán theo đơn ${esc(o.id)}"></textarea></div>`,
    foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="crm-order-issue-confirm" data-id="${o.id}"><i class="fa-solid fa-arrow-up-from-bracket"></i>Xác nhận xuất kho</button>`});
}


function openOrderStatusModal(id) {
  const o = Q.order(id); if (!o) return;
  Modal.open({
    title: 'Cập nhật trạng thái đơn hàng bán',
    sub: `${o.id} · ${esc(Q.customerName(o.customerId))}`,
    body: `<div class="field"><label>Trạng thái mới</label><select class="inp" id="ordStatus">
      ${Object.entries(SalesCRM.orderStatus).map(([key, cfg]) => `<option value="${key}" ${o.status===key?'selected':''}>${esc(cfg.label)}</option>`).join('')}
    </select></div>
    <div class="note-box"><b>Lưu ý:</b> Không thể chuyển sang “Đã giao” nếu đơn chưa có phiếu <b>Xuất kho bán hàng</b> hoàn tất.</div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="order-status-save" data-id="${o.id}"><i class="fa-solid fa-floppy-disk"></i>Cập nhật</button>`
  });
}

/* -------------------------------------------------------------------------
 * CƠ HỘI BÁN HÀNG
 * ---------------------------------------------------------------------- */
Views.opportunities = function () {
  const f=F('crmOpportunities',{q:'',stage:'',owner:''}); const q=String(f.q||'').toLowerCase();
  const list=(DB.crmOpportunities||[]).filter(o=>{if(f.stage&&o.stage!==f.stage)return false;if(f.owner&&o.ownerId!==f.owner)return false;if(q&&![o.id,SalesCRM.customerNameForOpp(o),o.contact].some(v=>String(v||'').toLowerCase().includes(q)))return false;return true;});
  const stages=Object.entries(SalesCRM.oppStage).map(([k,v])=>[k,v.label]);
  const owners=[...new Set((DB.crmOpportunities||[]).map(o=>o.ownerId).filter(Boolean))].map(id=>[id,Q.employeeName(id)]);
  const rows=list.map(o=>`<tr><td><span class="code">${o.id}</span></td><td>${cell2(esc(SalesCRM.customerNameForOpp(o)),esc(o.contact||''))}</td><td>${SalesCRM.badgeFrom(SalesCRM.oppStage,o.stage)}</td><td class="right num">${fmtVND(o.value)}</td><td class="right num">${Number(o.probability||0)}%</td><td>${fmtDate(o.expectedCloseDate)}</td><td>${esc(Q.employeeName(o.ownerId))}</td><td>${rowActions([{act:'crm-opportunity-view',data:`data-id="${o.id}"`,icon:'fa-eye',title:'Xem chi tiết'},{act:'crm-opportunity-edit',data:`data-id="${o.id}"`,icon:'fa-pen',title:'Sửa' },{act:'crm-opportunity-delete',data:`data-id="${o.id}"`,icon:'fa-trash',title:'Xóa'},...(o.stage==='CLOSED_WON'?[{act:'crm-opportunity-order',data:`data-id="${o.id}"`,icon:'fa-cart-plus',title:'Tạo đơn hàng'}]:[])])}</td></tr>`);
  const open=(DB.crmOpportunities||[]).filter(o=>!['CLOSED_WON','CLOSED_LOST'].includes(o.stage));
  return `${pageHead('Cơ hội bán hàng','Theo dõi nhu cầu, giá trị pipeline và khả năng chốt đơn','<button class="btn btn-primary" data-act="crm-opportunity-edit"><i class="fa-solid fa-plus"></i>Thêm cơ hội</button>')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Cơ hội mở',open.length,'fa-bullseye','orange')}${mkpi('Giá trị pipeline',fmtShort(open.reduce((s,o)=>s+Number(o.value||0),0)),'fa-chart-line','indigo')}${mkpi('Thành công',(DB.crmOpportunities||[]).filter(o=>o.stage==='CLOSED_WON').length,'fa-trophy','green')}${mkpi('Thất bại',(DB.crmOpportunities||[]).filter(o=>o.stage==='CLOSED_LOST').length,'fa-circle-xmark','red')}</div>
    <div class="card"><div class="toolbar">${searchBox('crmOpportunities','Tìm mã, khách hàng…')}${selectFilter('crmOpportunities','stage',stages,'Tất cả giai đoạn')}${selectFilter('crmOpportunities','owner',owners,'Tất cả sale')}${(f.q||f.stage||f.owner)?'<button class="btn btn-sm" data-act="clear-filter" data-key="crmOpportunities">Xóa lọc</button>':''}</div>${tableShell([{t:'Mã cơ hội'},{t:'Khách hàng'},{t:'Giai đoạn'},{t:'Giá trị',cls:'right'},{t:'Xác suất',cls:'right'},{t:'Dự kiến chốt'},{t:'Sale'},{t:'Thao tác'}],rows,{emptyTitle:'Chưa có cơ hội bán hàng'})}</div>`;
};

function openOpportunityForm(id='') {
  const o=(DB.crmOpportunities||[]).find(x=>x.id===id)||{};
  Modal.open({title:id?'Cập nhật cơ hội':'Thêm cơ hội bán hàng',size:'md',body:`<div class="grid g-2">
    <div class="field"><label>Khách hàng</label><select class="inp" id="crmOppCustomer"><option value="">-- Khách tiềm năng chưa có master --</option>${(DB.customers||[]).map(c=>`<option value="${c.id}" ${o.customerId===c.id?'selected':''}>${esc(c.id+' · '+c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Tên công ty / nhu cầu</label><input class="inp" id="crmOppCompany" value="${esc(o.company||'')}"></div>
    <div class="field"><label>Người liên hệ</label><input class="inp" id="crmOppContact" value="${esc(o.contact||'')}"></div>
    <div class="field"><label>Sale phụ trách</label><select class="inp" id="crmOppOwner">${(DB.employees||[]).slice(0,30).map(e=>`<option value="${e.id}" ${o.ownerId===e.id?'selected':''}>${esc(e.id+' · '+e.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Giai đoạn</label><select class="inp" id="crmOppStage">${Object.entries(SalesCRM.oppStage).map(([k,v])=>`<option value="${k}" ${o.stage===k?'selected':''}>${esc(v.label)}</option>`).join('')}</select></div>
    <div class="field"><label>Giá trị dự kiến</label><input class="inp right num" type="number" id="crmOppValue" data-money="1" value="${Number(o.value||0)}"></div>
    <div class="field"><label>Ngày dự kiến chốt</label><input class="inp" type="date" id="crmOppClose" value="${esc(o.expectedCloseDate||currentDateYMD())}" min="${currentDateYMD()}"></div>
    <div class="field"><label>Nguồn</label><input class="inp" id="crmOppSource" value="${esc(o.source||'')}"></div>
  </div><div class="field"><label>Ghi chú</label><textarea class="inp" id="crmOppNote" rows="3">${esc(o.note||'')}</textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="crm-opportunity-save" data-id="${esc(id)}">Lưu</button>`});
}

/* -------------------------------------------------------------------------
 * CHĂM SÓC KHÁCH HÀNG
 * ---------------------------------------------------------------------- */
Views['crm-care'] = function () {
  const logs=(DB.customerCareLogs||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const rows=logs.map((l,idx)=>`<tr><td>${fmtDate(l.date)}</td><td>${cell2(esc(Q.customerName(l.customerId)),`<span class="code">${esc(l.customerId)}</span>`)}</td><td>${esc(({phone:'Gọi điện',meeting:'Gặp mặt',email:'Email',zalo:'Zalo',message:'Tin nhắn'}[l.method]||l.method||'Khác'))}</td><td>${esc(l.staff||'')}</td><td>${esc(l.content||'')}</td><td class="right">${rowActions([{act:'crm-care-view',data:`data-id="${esc(l.id||'CARE-'+idx)}"`,icon:'fa-eye',title:'Xem chi tiết'},{act:'crm-care-edit',data:`data-id="${esc(l.id||'CARE-'+idx)}"`,icon:'fa-pen',title:'Sửa'},{act:'crm-care-delete',data:`data-id="${esc(l.id||'CARE-'+idx)}"`,icon:'fa-trash',title:'Xóa'}])}</td></tr>`);
  return `${pageHead('Chăm sóc khách hàng','Nhật ký gọi điện, gặp mặt, email và chăm sóc sau bán','<button class="btn btn-primary" data-act="crm-care-new"><i class="fa-solid fa-plus"></i>Ghi nhận chăm sóc</button>')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Tổng lượt CSKH',logs.length,'fa-comments','blue')}${mkpi('Trong tháng',logs.filter(l=>String(l.date||'').slice(0,7)===String(DB.today||'').slice(0,7)).length,'fa-calendar','teal')}${mkpi('Khách đã được chăm sóc',new Set(logs.map(l=>l.customerId)).size,'fa-users','green')}</div>
    <div class="card">${tableShell([{t:'Ngày'},{t:'Khách hàng'},{t:'Kênh'},{t:'Nhân viên'},{t:'Nội dung'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có lịch sử chăm sóc'})}</div>`;
};


function openCrmCarePicker() {
  Modal.open({
    title: 'Ghi nhận chăm sóc khách hàng',
    sub: 'Chọn khách hàng để mở nhật ký chăm sóc',
    body: `<div class="field"><label>Khách hàng</label><select class="inp" id="crmCareCustomer"><option value="">-- Chọn khách hàng --</option>${(DB.customers||[]).map(c=>`<option value="${c.id}">${esc(c.id+' · '+c.name)}</option>`).join('')}</select></div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="crm-care-pick"><i class="fa-solid fa-comments"></i>Mở nhật ký</button>`
  });
}

/* -------------------------------------------------------------------------
 * KHIẾU NẠI
 * ---------------------------------------------------------------------- */
Views['crm-complaints'] = function () {
  const list=(DB.crmTickets||[]).filter(t=>t.type==='COMPLAINT');
  const rows=list.map(t=>`<tr><td><span class="code">${t.id}</span></td><td>${esc(t.customerId?Q.customerName(t.customerId):t.customerName||'')}</td><td>${esc(t.title)}</td><td>${esc(t.priority||'')}</td><td>${SalesCRM.badgeFrom(SalesCRM.ticketStatus,t.status)}</td><td>${fmtDate(t.createdAt)}</td><td>${fmtDate(t.dueDate)}</td><td>${rowActions([{act:'crm-complaint-view',data:`data-id="${t.id}"`,icon:'fa-eye',title:'Xem chi tiết'},{act:'crm-complaint-edit',data:`data-id="${t.id}"`,icon:'fa-pen',title:'Cập nhật'},{act:'crm-complaint-delete',data:`data-id="${t.id}"`,icon:'fa-trash',title:'Xóa'}])}</td></tr>`);
  return `${pageHead('Khiếu nại khách hàng','Tiếp nhận → xử lý → phản hồi → đóng khiếu nại','<button class="btn btn-primary" data-act="crm-complaint-edit"><i class="fa-solid fa-plus"></i>Tiếp nhận khiếu nại</button>')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Đang mở',list.filter(t=>['OPEN','IN_PROGRESS','WAITING'].includes(t.status)).length,'fa-triangle-exclamation','orange')}${mkpi('Đã giải quyết',list.filter(t=>['RESOLVED','CLOSED'].includes(t.status)).length,'fa-circle-check','green')}${mkpi('Ưu tiên cao',list.filter(t=>t.priority==='HIGH').length,'fa-fire','red')}</div>
    <div class="card">${tableShell([{t:'Mã'},{t:'Khách hàng'},{t:'Nội dung'},{t:'Mức độ'},{t:'Trạng thái'},{t:'Tiếp nhận'},{t:'Hạn xử lý'},{t:'Thao tác'}],rows,{emptyTitle:'Chưa có khiếu nại'})}</div>`;
};

function openComplaintForm(id='', orderId='') {
  const t=(DB.crmTickets||[]).find(x=>x.id===id)||{};
  const linkedOrder = orderId ? Q.order(orderId) : null;
  if (!id && linkedOrder) { t.orderId = linkedOrder.id; t.customerId = linkedOrder.customerId; }
  Modal.open({title:id?'Cập nhật khiếu nại':'Tiếp nhận khiếu nại',size:'md',body:`<div class="grid g-2"><div class="field"><label>Khách hàng</label><select class="inp" id="crmTicketCustomer"><option value="">-- Chọn khách hàng --</option>${(DB.customers||[]).map(c=>`<option value="${c.id}" ${t.customerId===c.id?'selected':''}>${esc(c.id+' · '+c.name)}</option>`).join('')}</select></div><div class="field"><label>Đơn hàng liên quan</label><select class="inp" id="crmTicketOrder"><option value="">-- Không bắt buộc --</option>${(DB.orders||[]).map(o=>`<option value="${o.id}" ${t.orderId===o.id?'selected':''}>${esc(o.id+' · '+Q.customerName(o.customerId))}</option>`).join('')}</select></div><div class="field"><label>Mức độ</label><select class="inp" id="crmTicketPriority">${['LOW','MEDIUM','HIGH'].map(x=>`<option ${t.priority===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Trạng thái</label><select class="inp" id="crmTicketStatus">${Object.entries(SalesCRM.ticketStatus).map(([k,v])=>`<option value="${k}" ${t.status===k?'selected':''}>${esc(v.label)}</option>`).join('')}</select></div><div class="field"><label>Hạn xử lý</label><input class="inp" type="date" id="crmTicketDue" value="${esc(t.dueDate||currentDateYMD())}" min="${currentDateYMD()}"></div></div><div class="field"><label>Tiêu đề</label><input class="inp" id="crmTicketTitle" value="${esc(t.title||'')}"></div><div class="field"><label>Mô tả</label><textarea class="inp" id="crmTicketDesc" rows="3">${esc(t.description||'')}</textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="crm-complaint-save" data-id="${esc(id)}">Lưu</button>`});
}

/* -------------------------------------------------------------------------
 * LỊCH SỬ GIAO DỊCH
 * ---------------------------------------------------------------------- */
Views.transactions = function () {
  const f = F('crmTransactions', { q: '', customerId: '', type: '', from: '', to: '' });
  const events = [];

  const orderDate = o => String(o?.date || o?.orderDate || o?.createdAt || '').slice(0, 10);
  const itemName = item => item?.name || (DB.products || []).find(p => p.id === item?.productId)?.name || item?.productId || '';

  // 1) Đơn hàng: ngày đặt hàng, giá trị đơn và trạng thái đơn hiện tại.
  (DB.orders || []).forEach(o => {
    events.push({
      date: orderDate(o),
      type: 'ORDER',
      typeLabel: 'Đơn hàng',
      customerId: o.customerId || '',
      ref: o.id,
      orderId: o.id,
      desc: (o.items || []).map(i => `${itemName(i)}${Number(i.qty || 0) ? ` (${fmtN(i.qty)} ${i.unit || ''})` : ''}`).join(', '),
      amount: Number(o.total || o.subtotal || 0),
      status: SalesCRM.orderStatus[o.status]?.label || o.status || '—',
    });
  });

  // 2) Phiếu xuất bán: chỉ SALES_ISSUE đã phát sinh thật từ Kho thành phẩm.
  (DB.goodsIssues || [])
    .filter(x => x.type === 'SALES_ISSUE')
    .forEach(x => {
      const orderId = x.orderId || x.refDoc || x.refId || '';
      const o = Q.order(orderId);
      const qty = (x.items || []).reduce((sum, i) => sum + Number(i.qty || 0), 0);
      events.push({
        date: String(x.date || x.createdAt || '').slice(0, 10),
        type: 'SALES_ISSUE',
        typeLabel: 'Xuất bán',
        customerId: o?.customerId || '',
        ref: x.id,
        orderId,
        desc: `${orderId ? `Theo đơn ${orderId}` : 'Xuất bán'} · ${fmtN(qty)} đơn vị`,
        amount: 0,
        status: x.status || '—',
      });
    });

  // 3) Nhật ký CSKH: lấy đúng khách hàng và nội dung chăm sóc đã ghi nhận.
  (DB.customerCareLogs || []).forEach(x => {
    events.push({
      date: String(x.date || x.createdAt || '').slice(0, 10),
      type: 'CARE',
      typeLabel: 'CSKH',
      customerId: x.customerId || '',
      ref: x.id || '—',
      desc: x.content || x.note || x.description || 'Ghi nhận chăm sóc khách hàng',
      amount: 0,
      status: x.method || x.type || '—',
    });
  });

  // 4) Khiếu nại: chỉ khiếu nại khách hàng và gắn đơn hàng nếu có.
  (DB.crmTickets || [])
    .filter(x => x.type === 'COMPLAINT')
    .forEach(x => {
      events.push({
        date: String(x.createdAt || x.date || '').slice(0, 10),
        type: 'COMPLAINT',
        typeLabel: 'Khiếu nại',
        customerId: x.customerId || Q.order(x.orderId)?.customerId || '',
        ref: x.id,
        orderId: x.orderId || '',
        desc: `${x.title || 'Khiếu nại'}${x.orderId ? ` · Đơn ${x.orderId}` : ''}`,
        amount: 0,
        status: SalesCRM.ticketStatus[x.status]?.label || x.status || '—',
      });
    });

  const q = String(f.q || '').toLowerCase().trim();
  const list = events
    .filter(e => {
      if (f.customerId && e.customerId !== f.customerId) return false;
      if (f.type && e.type !== f.type) return false;
      if (f.from && String(e.date || '') < f.from) return false;
      if (f.to && String(e.date || '') > f.to) return false;
      if (q && ![
        e.ref,
        e.orderId,
        e.desc,
        e.typeLabel,
        e.status,
        e.customerId,
        e.customerId ? Q.customerName(e.customerId) : ''
      ].some(v => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.ref || '').localeCompare(String(a.ref || '')));

  const pg = paged(list, 'crmTransactions');
  const customers = (DB.customers || []).map(c => [c.id, `${c.id} · ${c.name}`]);
  const types = [
    ['ORDER', 'Đơn hàng'],
    ['SALES_ISSUE', 'Xuất bán'],
    ['CARE', 'CSKH'],
    ['COMPLAINT', 'Khiếu nại'],
  ];

  const rows = pg.items.map(e => `<tr ${e.orderId ? `class="clickable" data-act="open-order" data-id="${esc(e.orderId)}"` : ''}>
    <td>${fmtDate(e.date)}</td>
    <td><span class="chip">${esc(e.typeLabel)}</span></td>
    <td>${e.customerId ? cell2(esc(Q.customerName(e.customerId)), `<span class="code">${esc(e.customerId)}</span>`) : '—'}</td>
    <td>${e.ref ? `<span class="code">${esc(e.ref)}</span>` : '—'}</td>
    <td>${esc(e.desc || '')}</td>
    <td class="right num">${e.amount ? fmtVND(e.amount) : '—'}</td>
    <td>${esc(e.status || '—')}</td>
  </tr>`);

  return `${pageHead('Lịch sử giao dịch khách hàng', 'Tổng hợp đúng dữ liệu Đơn hàng → Xuất kho bán → CSKH → Khiếu nại')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng giao dịch', list.length, 'fa-clock-rotate-left', 'blue')}
      ${mkpi('Đơn hàng', list.filter(x=>x.type==='ORDER').length, 'fa-cart-shopping', 'indigo')}
      ${mkpi('Xuất bán', list.filter(x=>x.type==='SALES_ISSUE').length, 'fa-arrow-up-from-bracket', 'green')}
      ${mkpi('CSKH', list.filter(x=>x.type==='CARE').length, 'fa-comments', 'teal')}
      ${mkpi('Khiếu nại', list.filter(x=>x.type==='COMPLAINT').length, 'fa-triangle-exclamation', 'orange')}
    </div>
    <div class="card">
      <div class="toolbar">
        ${searchBox('crmTransactions', 'Tìm khách hàng, chứng từ, nội dung…')}
        ${selectFilter('crmTransactions', 'customerId', customers, 'Tất cả khách hàng')}
        ${selectFilter('crmTransactions', 'type', types, 'Tất cả giao dịch')}
        <label class="field-inline">Từ <input class="inp" type="date" data-f="crmTransactions.from" value="${esc(f.from||'')}"></label>
        <label class="field-inline">Đến <input class="inp" type="date" data-f="crmTransactions.to" value="${esc(f.to||'')}"></label>
        ${(f.q||f.customerId||f.type||f.from||f.to)?'<button class="btn btn-sm" data-act="clear-filter" data-key="crmTransactions"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}
        <span class="spacer"></span><span class="chip">${fmtN(list.length)} giao dịch</span>
      </div>
      ${tableShell([{t:'Ngày'},{t:'Loại'},{t:'Khách hàng'},{t:'Chứng từ'},{t:'Diễn giải'},{t:'Giá trị',cls:'right'},{t:'Trạng thái'}], rows, {emptyTitle:'Chưa có giao dịch phù hợp'})}
      ${pagiHTML('crmTransactions', pg, 'giao dịch')}
    </div>`;
};


/* -------------------------------------------------------------------------
 * CÔNG NỢ KHÁCH HÀNG
 * ---------------------------------------------------------------------- */
Views['crm-debts'] = function () {
  DB.customerPayments = DB.customerPayments || [];
  const f = F('crmDebts', { q:'', status:'', customerId:'', from:'', to:'' });
  const q = String(f.q || '').trim().toLowerCase();
  const debtOrders = (DB.orders || []).filter(o => ['dh_da_giao','dh_hoan_tat'].includes(o.status));
  const customers = (DB.customers || []).map(c => [c.id, `${c.id} · ${c.name}`]);
  const statusOptions = [['UNPAID','Chưa thanh toán'],['PARTIALLY_PAID','Thanh toán một phần'],['PAID','Đã thanh toán'],['OVERDUE','Quá hạn']];

  const list = debtOrders.filter(o => {
    const status = SalesCRM.receivableStatus(o);
    const d = String(o.date || '').slice(0,10);
    if (f.status && status !== f.status) return false;
    if (f.customerId && o.customerId !== f.customerId) return false;
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (q && ![o.id, Q.customerName(o.customerId)].some(v => String(v || '').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')) || String(b.id||'').localeCompare(String(a.id||'')));

  const total = list.reduce((s,o)=>s+Number(o.total||0),0);
  const paid = list.reduce((s,o)=>s+SalesCRM.paidOfOrder(o.id),0);
  const remain = list.reduce((s,o)=>s+SalesCRM.receivableOfOrder(o),0);
  const overdue = list.reduce((s,o)=>s+(SalesCRM.receivableStatus(o)==='OVERDUE'?SalesCRM.receivableOfOrder(o):0),0);

  const statusBadge = (st) => ({
    UNPAID:'<span class="badge slate">Chưa thanh toán</span>',
    PARTIALLY_PAID:'<span class="badge orange">Thanh toán một phần</span>',
    PAID:'<span class="badge green">Đã thanh toán</span>',
    OVERDUE:'<span class="badge red">Quá hạn</span>'
  }[st] || `<span class="badge slate">${esc(st)}</span>`);

  const rows = list.map(o => {
    const paidAmt = SalesCRM.paidOfOrder(o.id);
    const remainAmt = SalesCRM.receivableOfOrder(o);
    const st = SalesCRM.receivableStatus(o);
    const due = o.paymentDueDate || o.dueDate || '';
    return `<tr>
      <td><span class="code">${esc(o.id)}</span></td>
      <td>${cell2(esc(Q.customerName(o.customerId)), `<span class="code">${esc(o.customerId)}</span>`)}</td>
      <td class="num">${fmtDate(o.date)}</td>
      <td class="num">${due ? fmtDate(due) : '—'}</td>
      <td class="right strong num">${fmtVND(Number(o.total||0))}</td>
      <td class="right num" style="color:var(--green)">${fmtVND(paidAmt)}</td>
      <td class="right strong num" style="color:${remainAmt>0?'var(--red)':'var(--text-3)'}">${fmtVND(remainAmt)}</td>
      <td>${statusBadge(st)}</td>
      <td class="right">${remainAmt>0?`<button class="btn btn-xs btn-primary" data-act="crm-customer-pay-modal" data-id="${esc(o.id)}"><i class="fa-solid fa-hand-holding-dollar"></i>Thu tiền</button>`:'<span class="muted">Tất toán</span>'}</td>
    </tr>`;
  });

  const paymentRows = [...(DB.customerPayments || [])]
    .filter(p => {
      const d=String(p.date||'').slice(0,10);
      if (f.from && d<f.from) return false;
      if (f.to && d>f.to) return false;
      if (f.customerId && p.customerId!==f.customerId) return false;
      return true;
    })
    .sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||'')))
    .slice(0,100)
    .map(p => `<tr>
      <td><span class="code">${esc(p.id)}</span>${typeof paymentStatusTag==='function'?paymentStatusTag(p):''}</td><td class="num">${fmtDate(p.date)}</td>
      <td><span class="code">${esc(p.orderId||'—')}</span></td><td>${esc(Q.customerName(p.customerId))}</td>
      <td class="right strong num">${fmtVND(Number(p.amount||0))}</td><td>${esc(p.method||'—')}</td>
      <td>${esc(p.bankName||'—')}</td><td>${esc(p.payerName||p.collectedByName||'—')}</td><td class="muted">${esc(p.reference||p.bankRef||'')}</td>
    </tr>`);

  return `${pageHead('Công nợ khách hàng','Theo dõi phải thu theo từng đơn hàng; mặc định hiển thị chứng từ mới nhất trước','')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng phải thu',fmtShort(total),'fa-file-invoice-dollar','blue')}
      ${mkpi('Đã thu',fmtShort(paid),'fa-circle-check','green')}
      ${mkpi('Còn phải thu',fmtShort(remain),'fa-hand-holding-dollar','red')}
      ${mkpi('Quá hạn',fmtShort(overdue),'fa-triangle-exclamation','orange')}
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="toolbar">
        ${searchBox('crmDebts','Tìm mã đơn hoặc khách hàng…')}
        ${selectFilter('crmDebts','customerId',customers,'Tất cả khách hàng')}
        ${selectFilter('crmDebts','status',statusOptions,'Tất cả trạng thái')}
        <label class="field-inline">Từ <input class="inp" type="date" data-f="crmDebts.from" value="${esc(f.from||'')}"></label>
        <label class="field-inline">Đến <input class="inp" type="date" data-f="crmDebts.to" value="${esc(f.to||'')}"></label>
        ${(f.q||f.customerId||f.status||f.from||f.to)?'<button class="btn btn-sm" data-act="clear-filter" data-key="crmDebts"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}
        <span class="spacer"></span><span class="chip">${fmtN(list.length)} đơn có phát sinh phải thu</span>
      </div>
      ${tableShell([{t:'Đơn hàng'},{t:'Khách hàng'},{t:'Ngày đơn'},{t:'Hạn thanh toán'},{t:'Tổng phải thu',cls:'right'},{t:'Đã thu',cls:'right'},{t:'Còn phải thu',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}], rows, {emptyTitle:'Chưa có công nợ khách hàng'})}
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Lịch sử thu tiền khách hàng</h3><p>Mỗi lần thu được lưu thành một giao dịch riêng; một đơn có thể thanh toán nhiều lần.</p></div></div>
      ${tableShell([{t:'Mã thu'},{t:'Ngày'},{t:'Đơn hàng'},{t:'Khách hàng'},{t:'Số tiền',cls:'right'},{t:'Phương thức'},{t:'Ngân hàng'},{t:'Người thực hiện'},{t:'Tham chiếu'}], paymentRows, {emptyTitle:'Chưa có lịch sử thu tiền'})}
    </div>`;
};

function openCustomerPaymentModal(orderId) {
  const o = Q.order(orderId); if (!o) return;
  const remain = SalesCRM.receivableOfOrder(o);
  if (remain <= 0) { Toast.info('Đơn hàng đã tất toán', `${o.id} không còn công nợ.`); return; }
  const actorId = DB.currentUser?.userId || DB.currentUser?.id || '';
  const actorName = (String(DB.currentUser?.username||'').toLowerCase()==='admin' || DB.currentUser?.roleId==='ROLE_ADMIN') ? 'Admin' : (DB.currentUser?.name || Q.employeeName(DB.currentUser?.id));
  const employeePeople = (DB.employees || []).map(e => `<option value="${esc(e.id)}" ${String(e.id)===String(DB.currentUser?.id)?'selected':''}>${esc(e.id+' · '+(e.name||e.fullName||''))}</option>`).join('');
  const hasActor = (DB.employees || []).some(e => String(e.id)===String(DB.currentUser?.id) || String(e.id)===String(actorId));
  const people = `${hasActor?'':`<option value="${esc(actorId)}" selected>${esc(actorName)}</option>`}${employeePeople}`;
  const banks = (DB.bankAccounts || []).map(b => `<option value="${esc(b.id)}">${esc(b.name || ((b.bankName||'Ngân hàng')+' · '+(b.accountNumber||'')))}</option>`).join('');
  Modal.open({
    title:'Ghi nhận thu tiền khách hàng', sub:`${o.id} · ${esc(Q.customerName(o.customerId))} · Còn phải thu ${fmtVND(remain)}`, size:'md',
    body:`<div class="form-grid">
      <div class="field"><label>Số tiền thu (VND) <span class="req">*</span></label><input class="inp right num" type="text" inputmode="numeric" id="crmPayAmount" data-money="1" value="${remain}"></div>
      <div class="field"><label>Ngày thanh toán</label><input class="inp" type="date" id="crmPayDate" value="${typeof currentDateYMD==='function'?currentDateYMD():new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label>Phương thức</label><select class="inp" id="crmPayMethod"><option value="BANK_TRANSFER">Chuyển khoản ngân hàng</option><option value="CASH">Tiền mặt</option></select></div>
      <div class="field"><label>Người thực hiện</label><select class="inp" id="crmPayPayer"><option value="">-- Chọn người thực hiện --</option>${people}</select></div>
      <div class="field" style="grid-column:1/-1"><label>Định khoản <span class="req">*</span></label><select class="inp" id="crmPayAccountingEntry">${typeof accountingEntryOptions==='function'?accountingEntryOptions('THU'):''}</select></div>
    </div>
    <div id="crmPayBankWrap" class="form-grid">
      <div class="field"><label>Ngân hàng nhận tiền</label><select class="inp" id="crmPayBank"><option value="">-- Chọn ngân hàng --</option>${banks}</select></div>
      <div class="field"><label>Mã giao dịch / tham chiếu</label><input class="inp" id="crmPayRef" placeholder="VD: FT12345678"></div>
    </div>
    <div class="field"><label>Ghi chú</label><input class="inp" id="crmPayNote" value="Thu công nợ đơn ${esc(o.id)}"></div>`,
    foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="crm-customer-pay-save" data-orderid="${esc(o.id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu lần thanh toán</button>`,
    onMount:()=>{ const method=$('#crmPayMethod'), wrap=$('#crmPayBankWrap'); const sync=()=>{if(wrap)wrap.style.display=method?.value==='BANK_TRANSFER'?'grid':'none';}; method?.addEventListener('change',sync); sync(); }
  });
}

/* -------------------------------------------------------------------------
 * BÁO CÁO CRM
 * ---------------------------------------------------------------------- */
Views['crm-reports'] = () => Views['crm-dashboard']();

/* -------------------------------------------------------------------------
 * ROUTER CRM
 * ---------------------------------------------------------------------- */
Views.crm = function(params={}) {
  const tab=params.tab||State.tab||'dashboard';
  switch(tab){
    case 'dashboard': return Views['crm-dashboard']();
    case 'customers': return Views.customers();
    case 'opportunities': return Views.customers();
    case 'care': return Views['crm-care']();
    case 'complaints': return Views['crm-complaints']();
    case 'transactions': return Views.transactions();
    case 'orders': return Views.orders();
    case 'debts': return Views['crm-debts']();
    case 'reports': return Views['crm-reports']();
    default: return Views['crm-dashboard']();
  }
};
