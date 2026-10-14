/* ============================================================================
 * Phân hệ 4 — ĐIỀU HÀNH TOUR
 * Đơn hàng tạo thành công tự động xuất hiện ở đây. Mỗi tour có:
 *  - Dự trù dịch vụ (số lượng, đơn giá, thành tiền) + tạo phiếu chi thanh toán NCC
 *  - Form booking: lấy email NCC, bấm “Gửi Booking” để gửi cho NCC
 *  - Tổng hợp (đã thu / đã chi / lợi nhuận) + Quyết toán
 *  - Tính giá tour = Tổng chi phí dịch vụ ÷ số khách
 *  - Bàn giao tour (liệt kê dịch vụ trong dự trù) + xuất file
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store, K = App.CONST;
  const st = { q: '', page: 1, tab: 'all' };
  const ds = { id: '', tab: 'budget' };
  let listBody, listKpi, listTabs, viewEl;

  const DEFAULT_SVC = { 'Khách sạn': 'Lưu trú', 'Nhà hàng': 'Ăn uống', 'Vận chuyển': 'Xe vận chuyển', 'Hàng không': 'Vé máy bay', 'HDV': 'Hướng dẫn viên', 'Điểm tham quan': 'Vé tham quan' };
  const custName = o => ((o && C.customer(o.customerId)) || {}).name || '—';
  const stat = t => K.TOUR_STATUS[t.status] || K.TOUR_STATUS.dieuhanh;
  const timing = (t, o) => {
    const today = U.todayISO(); if (!o || t.status === 'quyettoan') return null;
    if (o.end < today) return { text: 'Đã kết thúc', tone: 'slate' };
    if (o.start <= today) return { text: 'Đang diễn ra', tone: 'green' };
    const d = U.daysBetween(today, o.start); return d <= 7 ? { text: 'Còn ' + d + ' ngày', tone: 'orange' } : null;
  };

  /* =============================================================== DANH SÁCH */
  function listRows() {
    const q = U.norm(st.q);
    return Store.state.tours.filter(t => {
      if (st.tab !== 'all' && t.status !== st.tab) return false;
      if (!q) return true;
      const o = C.order(t.orderId) || {}, cu = C.customer(o.customerId) || {};
      return U.norm(t.id).includes(q) || U.norm(o.serviceName).includes(q) || U.norm(cu.name).includes(q) || U.norm(cu.phone).includes(q.replace(/\s/g, ''));
    }).slice().sort((a, b) => ((C.order(a.orderId) || {}).start || '').localeCompare((C.order(b.orderId) || {}).start || ''));
  }
  function renderList() {
    const all = Store.state.tours, rows = listRows(), today = U.todayISO();
    const active = all.filter(t => t.status !== 'quyettoan');
    const soon = active.filter(t => { const o = C.order(t.orderId); return o && o.start >= today && U.daysBetween(today, o.start) <= 7; }).length;
    const plan = App.sum(all, t => C.tourSummary(t).planProfit);
    listKpi.innerHTML = U.mkpi({ icon: 'route', tone: 'blue', label: 'Tour chưa quyết toán', value: active.length }) +
      U.mkpi({ icon: 'plane-departure', tone: 'orange', label: 'Khởi hành trong 7 ngày', value: soon }) +
      U.mkpi({ icon: 'receipt', tone: 'indigo', label: 'Dự trù chi phí (tour đang chạy)', value: U.money(App.sum(active, C.tourCost)) }) +
      U.mkpi({ icon: 'chart-line', tone: plan >= 0 ? 'green' : 'red', label: 'Lợi nhuận dự kiến (tất cả)', value: U.signed(plan) });
    const cnt = k => all.filter(t => k === 'all' || t.status === k).length;
    listTabs.innerHTML = U.tabs([{ key: 'all', label: 'Tất cả', cnt: cnt('all') }, { key: 'dieuhanh', label: 'Đang điều hành', cnt: cnt('dieuhanh') }, { key: 'banggiao', label: 'Đã bàn giao', cnt: cnt('banggiao') }, { key: 'quyettoan', label: 'Đã quyết toán', cnt: cnt('quyettoan') }], st.tab);
    listBody.innerHTML = U.table({
      rows, st, size: 10,
      empty: U.empty('route', st.q ? 'Không tìm thấy tour' : 'Chưa có tour', st.q ? 'Thử tìm theo mã đơn, tên dịch vụ, tên KH hoặc số điện thoại.' : 'Tạo đơn hàng ở mục Đơn hàng — tour sẽ tự động xuất hiện tại đây.'),
      rowCls: () => 'clickable', rowAttr: t => 'data-go="' + t.id + '"',
      cols: [
        { label: 'Mã tour', render: t => '<span class="code">' + t.id + '</span>' },
        { label: 'Dịch vụ / Khách hàng', render: t => { const o = C.order(t.orderId) || {}; return '<div class="cell-main" style="max-width:260px">' + U.esc(o.serviceName) + '</div><div class="cell-sub">' + U.esc(custName(o)) + '</div>'; } },
        { label: 'Thời gian', render: t => { const o = C.order(t.orderId) || {}, tm = timing(t, o); return '<span class="nowrap">' + U.fdate(o.start) + ' → ' + U.fdate(o.end) + '</span>' + (tm ? '<div style="margin-top:3px">' + U.badge(tm.text, tm.tone, true) + '</div>' : ''); } },
        { label: 'Khách', cls: 'center', render: t => t.guests },
        { label: 'Phải thu', cls: 'right', render: t => U.money(C.tourSummary(t).revenue) },
        { label: 'Đã thu', cls: 'right', render: t => U.money(C.tourSummary(t).collected) },
        { label: 'Dự trù chi', cls: 'right', render: t => U.money(C.tourCost(t)) },
        { label: 'Đã chi', cls: 'right', render: t => U.money(C.tourPaidOut(t)) },
        { label: 'LN dự kiến', cls: 'right', render: t => '<b>' + U.signed(C.tourSummary(t).planProfit) + '</b>' },
        { label: 'Trạng thái', render: t => U.badge(stat(t).label, stat(t).tone) }
      ]
    });
  }
  function exportList() {
    const rows = listRows();
    U.exportXlsx({
      filename: 'dieu-hanh-tour', sheet: 'Điều hành tour', title: 'DANH SÁCH TOUR ĐIỀU HÀNH',
      headers: ['Mã tour', 'Dịch vụ', 'Khách hàng', 'Khởi hành', 'Kết thúc', 'Số khách', 'Phải thu', 'Đã thu', 'Dự trù chi', 'Đã chi', 'Lợi nhuận dự kiến', 'Trạng thái'],
      rows: rows.map(t => { const o = C.order(t.orderId) || {}, s = C.tourSummary(t); return [t.id, o.serviceName, custName(o), U.fdate(o.start), U.fdate(o.end), t.guests, s.revenue, s.collected, s.cost, s.paid, s.planProfit, stat(t).label]; }),
      moneyCols: [6, 7, 8, 9, 10]
    });
  }

  /* ================================================================ CHI TIẾT */
  const refresh = () => { if (viewEl && ds.id) renderDetail(); if (App.refreshChrome) App.refreshChrome(); };
  const tourOf = () => C.tour(ds.id);
  const setHash = () => history.replaceState(null, '', '#/operations/' + ds.id + '/' + ds.tab);

  function renderDetail() {
    const t = tourOf(), v = viewEl;
    if (!t) { v.innerHTML = '<button class="back-link" data-act="back"><i class="fa-solid fa-arrow-left"></i>Danh sách tour</button>' + '<div class="card"><div class="card-body">' + U.empty('route', 'Không tìm thấy tour', 'Tour ' + U.esc(ds.id) + ' không tồn tại hoặc đã bị xóa.') + '</div></div>'; return; }
    const o = C.order(t.orderId) || {}, cu = C.customer(o.customerId) || {}, s = C.tourSummary(t), settled = t.status === 'quyettoan', tm = timing(t, o);
    const tabs = [{ key: 'budget', label: 'Dự trù dịch vụ', icon: 'list-check', cnt: t.budget.length }, { key: 'booking', label: 'Booking NCC', icon: 'envelope', cnt: t.bookings.length },
      { key: 'summary', label: 'Tổng hợp & Quyết toán', icon: 'scale-balanced' }, { key: 'pricing', label: 'Tính giá tour', icon: 'calculator' }, { key: 'handover', label: 'Bàn giao tour', icon: 'handshake-angle' }];
    v.innerHTML = '<button class="back-link" data-act="back"><i class="fa-solid fa-arrow-left"></i>Danh sách tour</button>' +
      '<div class="page-head"><div><h1>Tour ' + t.id + ' · ' + U.esc(o.serviceName) + '</h1>' +
      '<div class="tour-meta"><span><i class="fa-solid fa-user"></i>' + U.esc(cu.name) + (cu.phone ? ' · ' + U.esc(cu.phone) : '') + '</span><span><i class="fa-solid fa-calendar-days"></i>' + U.fdate(o.start) + ' → ' + U.fdate(o.end) + '</span><span><i class="fa-solid fa-users"></i>' + t.guests + ' khách</span>' +
      U.badge(stat(t).label, stat(t).tone) + (tm ? ' ' + U.badge(tm.text, tm.tone, true) : '') + '</div></div>' +
      '<div class="page-head-actions"><button class="btn" data-act="printOrder"><i class="fa-solid fa-print"></i>Đơn hàng</button>' +
      (settled ? '' : '<button class="btn btn-success" data-act="thu"' + (s.receivable <= 0 ? ' disabled title="Đơn đã thu đủ"' : '') + '><i class="fa-solid fa-hand-holding-dollar"></i>Tạo phiếu thu</button>') + '</div></div>' +
      (settled ? '<div class="callout ok mb"><i class="fa-solid fa-lock"></i><div>Tour đã <b>quyết toán ngày ' + U.fdate(t.settlement && t.settlement.date) + '</b> nên đang ở chế độ chỉ xem. Vào tab “Tổng hợp & Quyết toán” → “Mở lại quyết toán” nếu cần chỉnh sửa.</div></div>' : '') +
      '<div class="kpi-row">' + U.mkpi({ icon: 'sack-dollar', tone: 'indigo', label: 'Phải thu (đơn hàng)', value: U.money(s.revenue) }) +
      U.mkpi({ icon: 'circle-check', tone: 'green', label: 'Đã thu', value: U.money(s.collected), sub: s.receivable ? 'Còn thu ' + U.money(s.receivable) : 'Đã thu đủ' }) +
      U.mkpi({ icon: 'receipt', tone: 'orange', label: 'Dự trù chi phí', value: U.money(s.cost) }) +
      U.mkpi({ icon: 'money-bill-transfer', tone: 'red', label: 'Đã chi NCC', value: U.money(s.paid), sub: s.payable ? 'Còn trả ' + U.money(s.payable) : (s.cost ? 'Đã trả đủ' : '') }) +
      U.mkpi({ icon: 'chart-line', tone: s.planProfit >= 0 ? 'green' : 'red', label: 'Lợi nhuận dự kiến', value: U.signed(s.planProfit), sub: s.revenue ? 'Biên ' + (s.planProfit / s.revenue * 100).toFixed(1) + '%' : '' }) + '</div>' +
      '<div class="card">' + U.tabs(tabs, ds.tab) + '<div id="pane"></div></div>';
    renderPane();
  }
  function renderPane() {
    const t = tourOf(), pane = U.$('#pane', viewEl); if (!t || !pane) return;
    pane.innerHTML = ({ budget: paneBudget, booking: paneBooking, summary: paneSummary, pricing: panePricing, handover: paneHandover }[ds.tab] || paneBudget)(t);
  }

  /* ---------------------------------------------------------- TAB DỰ TRÙ */
  function paneBudget(t) {
    const locked = t.status === 'quyettoan', cost = C.tourCost(t), paid = C.tourPaidOut(t);
    const linePaidSum = App.sum(t.budget, l => C.linePaid(t.id, l.id));
    let h = '<div class="toolbar"><div class="muted" style="font-size:12.8px">Dự trù dịch vụ của tour — thành tiền = số lượng × đơn giá. Tạo phiếu chi trực tiếp trên từng dòng để thanh toán NCC.</div><div class="spacer"></div>' +
      (locked ? '' : '<button class="btn btn-primary btn-sm" data-act="addLine"><i class="fa-solid fa-plus"></i>Thêm dịch vụ dự trù</button>') + '</div>';
    h += U.table({
      rows: t.budget, st: { page: 1 }, size: 200, nopager: true,
      empty: U.empty('list-check', 'Chưa có dự trù', 'Thêm các dịch vụ NCC (khách sạn, xe, nhà hàng…) cần cho tour này.'),
      cols: [
        { label: '#', cls: 'center', render: l => t.budget.indexOf(l) + 1 },
        { label: 'Nhà cung cấp', render: l => { const s = C.supplier(l.supplierId) || {}; return '<div class="cell-main">' + U.esc(s.name || 'NCC đã xóa') + '</div><div class="cell-sub">' + (s.type ? U.badge(s.type, K.SUPPLIER_TONE[s.type], true) : '') + '</div>'; } },
        { label: 'Dịch vụ', render: l => U.esc(l.service) + (l.note ? '<div class="cell-sub">' + U.esc(l.note) + '</div>' : '') },
        { label: 'SL', cls: 'center', render: l => U.fmt(l.qty) },
        { label: 'Đơn giá', cls: 'right', render: l => U.money(l.price) },
        { label: 'Thành tiền', cls: 'right', render: l => '<b class="num">' + U.money(C.lineAmount(l)) + '</b>' },
        { label: 'Đã chi', cls: 'right', render: l => U.money(C.linePaid(t.id, l.id)) },
        { label: 'Còn lại', cls: 'right', render: l => { const r = C.lineRemain(t, l); return r ? '<span class="money-neg">' + U.money(r) + '</span>' : '<span class="muted">0 ₫</span>'; } },
        { label: 'Thanh toán', render: l => { const x = C.lineStatus(t, l); return U.badge(x.label, x.tone); } },
        { label: 'Booking', render: l => C.lineBooked(t, l) ? U.badge('Đã gửi', 'green') : U.badge('Chưa gửi', 'slate') },
        { label: '', cls: 'right', render: l => locked ? '' : '<div class="row-actions">' + U.iconBtn('payLine', l.id, 'money-bill-wave', 'Tạo phiếu chi (thanh toán NCC)') + U.iconBtn('editLine', l.id, 'pen', 'Sửa') + U.iconBtn('delLine', l.id, 'trash', 'Xóa') + '</div>' }
      ],
      foot: t.budget.length ? '<tr><td colspan="5" class="right">Tổng cộng</td><td class="right">' + U.money(cost) + '</td><td class="right">' + U.money(linePaidSum) + '</td><td class="right">' + U.money(Math.max(0, cost - linePaidSum)) + '</td><td colspan="3"></td></tr>' : ''
    });
    if (paid - linePaidSum > 0) h += '<div class="card-body" style="padding-top:0"><div class="callout"><i class="fa-solid fa-circle-info"></i><div>Có <b>' + U.money(paid - linePaidSum) + '</b> chi phí phát sinh không gắn dòng dự trù (đã tính vào “Đã chi” của tour).</div></div></div>';
    return h;
  }
  function lineForm(lineId) {
    const t = tourOf(), l = lineId ? t.budget.find(x => x.id === lineId) : null, S = Store.state;
    const paid = l ? C.linePaid(t.id, l.id) : 0;
    const sups = S.suppliers.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    const html = U.field({ id: 'supplierId', label: 'Nhà cung cấp', req: true, html: '<div class="row-gap" style="flex-wrap:nowrap"><div style="flex:1;min-width:0">' + U.select({ id: 'supplierId', ph: '— Chọn nhà cung cấp —', value: l ? l.supplierId : '', options: sups.map(s => ({ v: s.id, l: s.name + ' — ' + s.type + ' — ' + s.province })) }) + '</div><button type="button" class="btn btn-sm" id="btnNewSup" title="Thêm nhanh NCC"><i class="fa-solid fa-plus"></i></button></div>' }) +
      U.field({ id: 'service', label: 'Tên dịch vụ', req: true, html: U.input({ id: 'service', value: l ? l.service : '', ph: 'VD: Khách sạn 3 đêm (5 phòng)' }) }) +
      '<div class="form-grid">' + U.field({ id: 'qty', label: 'Số lượng', req: true, html: U.input({ id: 'qty', type: 'number', value: l ? l.qty : 1, attrs: 'min="1" step="1"' }) }) +
      U.field({ id: 'price', label: 'Đơn giá (₫)', req: true, html: U.input({ id: 'price', money: true, value: l ? l.price : '' }) }) + '</div>' +
      U.field({ id: 'note', label: 'Ghi chú', html: U.input({ id: 'note', value: l ? l.note : '' }) }) +
      '<div class="sumbox" id="lsum"></div>' + (paid ? '<div class="callout warn mt"><i class="fa-solid fa-triangle-exclamation"></i><div>Dòng này đã chi <b>' + U.money(paid) + '</b>; thành tiền mới không được nhỏ hơn số đã chi.</div></div>' : '');
    U.modal({
      title: l ? 'Sửa dịch vụ dự trù' : 'Thêm dịch vụ dự trù', sub: 'Tour ' + t.id, size: 'md', static: true, body: html,
      onMount: h => {
        const b = h.body, calc = () => { const a = (Number(U.val(b, 'qty')) || 0) * U.money$(b, 'price'); b.querySelector('#lsum').innerHTML = '<div class="line total"><span>Thành tiền</span><span>' + U.money(a) + '</span></div>'; };
        let lastDefault = l ? '' : '';
        b.addEventListener('input', calc);
        b.querySelector('#supplierId').addEventListener('change', e => {
          const s = C.supplier(e.target.value); if (!s) return;
          const sv = b.querySelector('#service'); if (!sv.value || sv.value === lastDefault) { sv.value = DEFAULT_SVC[s.type] || ''; lastDefault = sv.value; }
          b.querySelector('#price').value = U.fmt(s.price); calc();
        });
        b.querySelector('#btnNewSup').onclick = () => App.mod.suppliers.openForm(null, rec => { const sel = b.querySelector('#supplierId'); const op = document.createElement('option'); op.value = rec.id; op.textContent = rec.name + ' — ' + rec.type + ' — ' + rec.province; sel.appendChild(op); sel.value = rec.id; sel.dispatchEvent(new Event('change')); });
        calc();
      },
      foot: [{ label: 'Hủy' }, {
        label: l ? 'Lưu thay đổi' : 'Thêm vào dự trù', icon: 'check', cls: 'btn-primary', onClick: h => {
          const b = h.body; U.clearErr(b); let ok = true;
          const d = { supplierId: U.val(b, 'supplierId'), service: U.val(b, 'service'), qty: Number(U.val(b, 'qty')), price: U.money$(b, 'price'), note: U.val(b, 'note') };
          if (!d.supplierId) ok = U.invalid(b, 'supplierId', 'Chọn nhà cung cấp');
          if (!d.service) ok = U.invalid(b, 'service', 'Nhập tên dịch vụ');
          if (!Number.isInteger(d.qty) || d.qty < 1) ok = U.invalid(b, 'qty', 'Số lượng phải là số nguyên ≥ 1');
          if (d.price <= 0) ok = U.invalid(b, 'price', 'Đơn giá phải lớn hơn 0');
          if (ok && l && d.qty * d.price < paid) ok = U.invalid(b, 'price', 'Thành tiền nhỏ hơn số đã chi (' + U.money(paid) + ')');
          if (!ok) { U.focusFirstInvalid(b); return; }
          if (l) { Object.assign(l, d); U.toast('Đã cập nhật dịch vụ dự trù', d.service); }
          else { t.budget.push(Object.assign({ id: Store.nextId('L', 3) }, d)); U.toast('Đã thêm vào dự trù', d.service); }
          Store.save(); h.close(); refresh();
        }
      }]
    });
  }
  async function delLine(id) {
    const t = tourOf(), l = t.budget.find(x => x.id === id); if (!l) return;
    if (C.linePaid(t.id, id) > 0) { U.toast('Không thể xóa', 'Dòng này đã có phiếu chi. Hãy xóa phiếu chi trước.', 'warning'); return; }
    if (!(await U.confirm({ title: 'Xóa dịch vụ khỏi dự trù', message: 'Xóa <b>' + U.esc(l.service) + '</b> khỏi dự trù tour ' + t.id + '?', ok: 'Xóa', danger: true }))) return;
    t.budget = t.budget.filter(x => x.id !== id); t.bookings.forEach(b => { b.lineIds = b.lineIds.filter(x => x !== id); });
    Store.save(); refresh(); U.toast('Đã xóa khỏi dự trù', l.service);
  }
  function payLine(id) {
    const t = tourOf(), l = t.budget.find(x => x.id === id);
    if (C.lineRemain(t, l) <= 0) { U.toast('Đã chi đủ', 'Dịch vụ này đã thanh toán đủ cho NCC.', 'info'); return; }
    App.mod.accounting.openVoucherForm({ kind: 'chi', tourId: t.id, lineId: id, onSaved: refresh });
  }

  /* ---------------------------------------------------------- TAB BOOKING */
  function groupBySupplier(t) { const m = {}; t.budget.forEach(l => { (m[l.supplierId] = m[l.supplierId] || []).push(l); }); return m; }
  function paneBooking(t) {
    const g = groupBySupplier(t), ids = Object.keys(g), locked = t.status === 'quyettoan';
    const sent = ids.filter(sid => g[sid].every(l => C.lineBooked(t, l))).length;
    let h = '<div class="tab-pane"><div class="row-gap mb"><div class="muted" style="font-size:12.8px">Đã gửi booking cho <b>' + sent + '/' + ids.length + '</b> nhà cung cấp trong dự trù. Email lấy từ danh mục NCC; bấm “Gửi Booking” để gửi.</div></div>';
    if (!ids.length) h += U.empty('envelope', 'Chưa có NCC trong dự trù', 'Thêm dịch vụ ở tab “Dự trù dịch vụ” rồi quay lại để tạo booking.');
    ids.forEach(sid => {
      const s = C.supplier(sid) || { name: 'NCC đã xóa', email: '', type: '' }, ls = g[sid];
      const all = ls.every(l => C.lineBooked(t, l)), any = ls.some(l => C.lineBooked(t, l));
      const last = t.bookings.filter(b => b.supplierId === sid).sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
      h += '<div class="bk-card"><div class="bk-top"><div style="flex:1;min-width:200px"><div class="cell-main">' + U.esc(s.name) + ' ' + (s.type ? U.badge(s.type, K.SUPPLIER_TONE[s.type], true) : '') + '</div>' +
        '<div class="cell-sub"><i class="fa-regular fa-envelope"></i> ' + (s.email ? U.esc(s.email) : '<span class="money-neg">Chưa có email — bổ sung ở mục Nhà cung cấp</span>') + (s.phone ? ' · ' + U.esc(s.phone) : '') + '</div></div>' +
        (all ? U.badge('Đã gửi booking', 'green') : any ? U.badge('Gửi một phần', 'orange') : U.badge('Chưa gửi', 'slate')) + (last ? '<span class="cell-sub">Lần cuối: ' + U.fdatetime(last.sentAt) + '</span>' : '') +
        (locked ? '' : '<button class="btn btn-sm ' + (all ? '' : 'btn-primary') + '" data-act="booking" data-id="' + sid + '"><i class="fa-solid fa-paper-plane"></i>' + (all ? 'Gửi lại booking' : 'Tạo form booking') + '</button>') + '</div>' +
        '<ul class="bk-lines">' + ls.map(l => '<li>• ' + U.esc(l.service) + ' — SL ' + U.fmt(l.qty) + ' × ' + U.money(l.price) + ' = <b>' + U.money(C.lineAmount(l)) + '</b> ' + (C.lineBooked(t, l) ? '<i class="fa-solid fa-check" style="color:var(--green)"></i>' : '') + '</li>').join('') + '</ul></div>';
    });
    if (t.bookings.length) {
      h += '<div class="sec-title mt" style="margin-top:20px"><i class="fa-solid fa-clock-rotate-left"></i>Lịch sử gửi booking</div><div class="card" style="box-shadow:none">' + U.table({
        rows: t.bookings.slice().sort((a, b) => b.sentAt.localeCompare(a.sentAt)), st: { page: 1 }, size: 200, nopager: true,
        cols: [{ label: 'Thời gian', render: b => '<span class="nowrap">' + U.fdatetime(b.sentAt) + '</span>' }, { label: 'NCC', render: b => U.esc((C.supplier(b.supplierId) || {}).name || '—') },
          { label: 'Gửi tới', render: b => U.esc(b.to) }, { label: 'Tiêu đề', render: b => U.esc(b.subject) }, { label: 'Hình thức', render: b => b.via === 'api' ? U.badge('Gửi qua API', 'green', true) : U.badge('Mở ứng dụng email', 'blue', true) }]
      }) + '</div>';
    }
    return h + '</div>';
  }
  function buildMail(t, s, lines, note) {
    const o = C.order(t.orderId) || {}, co = Store.state.settings.company;
    const rows = lines.map((l, i) => (i + 1) + '. ' + l.service + ' — SL: ' + U.fmt(l.qty) + ' — Đơn giá: ' + U.fmt(l.price) + ' ₫ — Thành tiền: ' + U.fmt(C.lineAmount(l)) + ' ₫').join('\n');
    return 'Kính gửi Quý đối tác ' + s.name + ',\n\n' + co.name + ' xin gửi booking dịch vụ cho tour ' + t.id + ':\n\n' +
      '- Khách hàng / đoàn: ' + custName(o) + '\n- Tour: ' + o.serviceName + '\n- Thời gian: ' + U.fdate(o.start) + ' → ' + U.fdate(o.end) + '\n- Số khách: ' + t.guests + '\n\n' +
      'Chi tiết dịch vụ đặt:\n' + rows + '\n' + (note ? '\nGhi chú: ' + note + '\n' : '') +
      '\nKính đề nghị Quý đối tác xác nhận booking bằng cách phản hồi email này.\n\nTrân trọng,\n' + co.name + '\nĐT: ' + co.phone + ' · Email: ' + co.email;
  }
  function openBooking(supplierId) {
    const t = tourOf(), s = C.supplier(supplierId); if (!s) return;
    const o = C.order(t.orderId) || {}, ls = t.budget.filter(l => l.supplierId === supplierId);
    const html = '<div class="form-grid">' + U.field({ id: 'to', label: 'Gửi tới (email NCC)', req: true, html: U.input({ id: 'to', type: 'email', value: s.email, ph: 'email@ncc.com' }) }) +
      U.field({ id: 'cc', label: 'CC (tuỳ chọn)', html: U.input({ id: 'cc', type: 'email', value: Store.state.settings.company.email }) }) + '</div>' +
      U.field({ id: 'subject', label: 'Tiêu đề', req: true, html: U.input({ id: 'subject', value: 'Booking dịch vụ - Tour ' + t.id + ' - ' + U.fdate(o.start) + ' - ' + Store.state.settings.company.name }) }) +
      '<div class="sumbox mb"><div class="line"><span>Khách hàng / đoàn</span><b>' + U.esc(custName(o)) + '</b></div><div class="line"><span>Tour</span><b>' + U.esc(o.serviceName) + '</b></div>' +
      '<div class="line"><span>Thời gian</span><b>' + U.fdate(o.start) + ' → ' + U.fdate(o.end) + '</b></div><div class="line"><span>Số khách</span><b>' + t.guests + '</b></div></div>' +
      U.field({ id: 'lines', label: 'Dịch vụ cần đặt', html: '<div class="tbl-wrap"><table class="tbl" style="min-width:480px"><thead><tr><th></th><th>Dịch vụ</th><th class="center">SL</th><th class="right">Đơn giá</th><th class="right">Thành tiền</th></tr></thead><tbody>' +
        ls.map(l => '<tr><td><input type="checkbox" class="bk-ck" value="' + l.id + '" checked></td><td>' + U.esc(l.service) + '</td><td class="center">' + U.fmt(l.qty) + '</td><td class="right">' + U.money(l.price) + '</td><td class="right">' + U.money(C.lineAmount(l)) + '</td></tr>').join('') + '</tbody></table></div>' }) +
      U.field({ id: 'note', label: 'Ghi chú thêm cho NCC', html: U.textarea({ id: 'note', rows: 2, ph: 'VD: Đón đoàn lúc 7h, cần phòng liền kề…' }) }) +
      (Store.state.settings.mailApi ? '' : '<div class="callout"><i class="fa-solid fa-circle-info"></i><div>Chưa cấu hình API gửi email nên khi bấm <b>Gửi Booking</b>, hệ thống sẽ mở ứng dụng email của bạn với nội dung đã soạn sẵn. Cấu hình API tại <b>Hệ thống → Thông tin công ty</b> để gửi tự động.</div></div>');
    U.modal({
      title: 'Form booking — ' + s.name, sub: 'Tour ' + t.id, size: 'md', static: true, body: html,
      foot: [{ label: 'Hủy' }, {
        label: 'Gửi Booking', icon: 'paper-plane', cls: 'btn-primary', onClick: async (h, btn) => {
          const b = h.body; U.clearErr(b); let ok = true;
          const to = U.val(b, 'to'), cc = U.val(b, 'cc'), subject = U.val(b, 'subject'), note = U.val(b, 'note');
          const picked = Array.from(b.querySelectorAll('.bk-ck:checked')).map(x => x.value), lines = ls.filter(l => picked.includes(l.id));
          const mailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!mailRe.test(to)) ok = U.invalid(b, 'to', 'Nhập email NCC hợp lệ');
          if (cc && !mailRe.test(cc)) ok = U.invalid(b, 'cc', 'Email CC không hợp lệ');
          if (!subject) ok = U.invalid(b, 'subject', 'Nhập tiêu đề');
          if (!lines.length) ok = U.invalid(b, 'lines', 'Chọn ít nhất một dịch vụ');
          if (!ok) { U.focusFirstInvalid(b); return; }
          const text = buildMail(t, s, lines, note), api = Store.state.settings.mailApi; let via = 'mailto';
          if (api) {
            btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>Đang gửi…';
            try {
              const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, cc, subject, text, tourId: t.id, supplierId, supplierName: s.name, lines: lines.map(l => ({ service: l.service, qty: l.qty, price: l.price })) }) });
              if (!r.ok) throw new Error('HTTP ' + r.status); via = 'api';
            } catch (err) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>Gửi Booking'; U.toast('Gửi booking thất bại', 'Không gọi được API gửi email (' + err.message + '). Kiểm tra lại cấu hình.', 'danger'); return; }
          } else {
            const a = document.createElement('a'); a.href = 'mailto:' + encodeURIComponent(to).replace('%40', '@') + '?subject=' + encodeURIComponent(subject) + (cc ? '&cc=' + encodeURIComponent(cc) : '') + '&body=' + encodeURIComponent(text).replace(/%0A/g, '%0D%0A');
            document.body.appendChild(a); a.click(); a.remove();
          }
          t.bookings.push({ id: Store.nextId('BK', 3), supplierId, to, cc, subject, lineIds: lines.map(l => l.id), sentAt: U.nowISO(), via, note });
          Store.save(); h.close(); refresh();
          U.toast(via === 'api' ? 'Đã gửi booking cho ' + s.name : 'Đã mở email booking cho ' + s.name, via === 'api' ? 'NCC sẽ nhận booking qua email ' + to : 'Hãy bấm Gửi trong ứng dụng email để hoàn tất.', via === 'api' ? 'success' : 'info');
        }
      }]
    });
  }

  /* ----------------------------------------------- TAB TỔNG HỢP & QUYẾT TOÁN */
  function paneSummary(t) {
    const s = C.tourSummary(t), locked = t.status === 'quyettoan';
    const vs = Store.state.vouchers.filter(v => v.tourId === t.id || (v.kind === 'thu' && v.orderId === t.orderId)).sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
    const byType = {}; t.budget.forEach(l => { const ty = (C.supplier(l.supplierId) || {}).type || 'Khác'; const r = byType[ty] = byType[ty] || { cost: 0, paid: 0 }; r.cost += C.lineAmount(l); r.paid += C.linePaid(t.id, l.id); });
    const margin = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
    let h = '<div class="tab-pane"><div class="grid g-2">';
    h += '<div><div class="sec-title"><i class="fa-solid fa-scale-balanced"></i>Tổng hợp thu – chi – lợi nhuận</div><div class="card" style="box-shadow:none"><div class="tbl-wrap"><table class="tbl" style="min-width:0"><thead><tr><th>Chỉ tiêu</th><th class="right">Kế hoạch</th><th class="right">Thực tế</th></tr></thead><tbody>' +
      '<tr><td>Doanh thu / <b>đã thu</b></td><td class="right">' + U.money(s.revenue) + '</td><td class="right">' + U.money(s.collected) + '</td></tr>' +
      '<tr><td>Chi phí dịch vụ / <b>đã chi</b></td><td class="right">' + U.money(s.cost) + '</td><td class="right">' + U.money(s.paid) + '</td></tr>' +
      '<tr><td><b>Lợi nhuận</b></td><td class="right">' + U.signed(s.planProfit) + '</td><td class="right">' + U.signed(s.realProfit) + '</td></tr>' +
      '<tr><td>Biên lợi nhuận</td><td class="right">' + margin(s.planProfit, s.revenue) + '</td><td class="right">' + margin(s.realProfit, s.collected) + '</td></tr>' +
      '<tr><td>Công nợ còn lại</td><td class="right" colspan="2">Phải thu <b>' + U.money(s.receivable) + '</b> · Phải trả NCC <b>' + U.money(s.payable) + '</b></td></tr></tbody></table></div></div></div>';
    h += '<div><div class="sec-title"><i class="fa-solid fa-layer-group"></i>Tổng hợp dịch vụ theo loại hình</div><div class="card" style="box-shadow:none">' + (Object.keys(byType).length ? '<div class="tbl-wrap"><table class="tbl" style="min-width:0"><thead><tr><th>Loại hình</th><th class="right">Dự trù</th><th class="right">Đã chi</th><th class="right">Còn lại</th></tr></thead><tbody>' +
      Object.keys(byType).map(k => '<tr><td>' + U.badge(k, K.SUPPLIER_TONE[k], true) + '</td><td class="right">' + U.money(byType[k].cost) + '</td><td class="right">' + U.money(byType[k].paid) + '</td><td class="right">' + U.money(byType[k].cost - byType[k].paid) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="card-body muted">Chưa có dự trù.</div>') + '</div></div></div>';
    h += '<div class="sec-title" style="margin-top:20px"><i class="fa-solid fa-money-bill-transfer"></i>Phiếu thu / chi của tour</div><div class="card" style="box-shadow:none">' + U.table({
      rows: vs, st: { page: 1 }, size: 200, nopager: true, empty: '<div class="muted" style="padding:6px 2px">Chưa có phiếu thu/chi nào.</div>',
      cols: [{ label: 'Mã phiếu', render: v => '<span class="code">' + v.id + '</span>' }, { label: 'Ngày', render: v => U.fdate(v.date) }, { label: 'Loại', render: v => v.kind === 'thu' ? U.badge('Thu', 'green') : U.badge('Chi', 'red') },
        { label: 'Nội dung', render: v => U.esc(v.content) }, { label: 'Tài khoản', render: v => { const a = C.account(v.accountId) || {}; return U.esc(a.bank || '') + ' <span class="cell-sub">' + (a.kind === 'company' ? 'Công ty' : 'Cá nhân') + '</span>'; } },
        { label: 'Số tiền', cls: 'right', render: v => '<b class="' + (v.kind === 'thu' ? 'money-pos' : 'money-neg') + '">' + (v.kind === 'thu' ? '+' : '−') + U.money(v.amount) + '</b>' }, { label: '', cls: 'right', render: v => U.iconBtn('vPrint', v.id, 'print', 'In / Xuất PDF') }]
    }) + '</div>';
    // Quyết toán
    const checks = [['Đã thu đủ tiền khách', s.receivable <= 0 && s.revenue > 0], ['Đã thanh toán đủ NCC', s.payable <= 0 && s.cost > 0], ['Đã bàn giao tour', t.status === 'banggiao' || locked], ['Dự trù có ít nhất một dịch vụ', t.budget.length > 0]];
    h += '<div class="sec-title" style="margin-top:20px"><i class="fa-solid fa-flag-checkered"></i>Quyết toán tour</div><div class="card" style="box-shadow:none"><div class="card-body">';
    if (locked && t.settlement) {
      const z = t.settlement;
      h += '<div class="callout ok mb"><i class="fa-solid fa-circle-check"></i><div>Đã quyết toán ngày <b>' + U.fdate(z.date) + '</b>. Số liệu chốt: doanh thu ' + U.money(z.revenue) + ', chi phí ' + U.money(z.cost) + ', lợi nhuận <b>' + U.money(z.profit) + '</b>.</div></div><button class="btn" data-act="reopen"><i class="fa-solid fa-lock-open"></i>Mở lại quyết toán</button>';
    } else {
      h += '<ul class="check-list mb">' + checks.map(c => '<li><span class="ck ' + (c[1] ? 'ok' : 'no') + '"><i class="fa-solid fa-' + (c[1] ? 'check' : 'exclamation') + '"></i></span>' + c[0] + '</li>').join('') + '</ul>' +
        '<button class="btn btn-primary" data-act="settle"><i class="fa-solid fa-flag-checkered"></i>Quyết toán tour</button><span class="cell-sub" style="margin-left:10px">Sau quyết toán, tour bị khóa không cho sửa dự trù và phiếu.</span>';
    }
    return h + '</div></div></div>';
  }
  async function settle() {
    const t = tourOf(), s = C.tourSummary(t), miss = [];
    if (s.receivable > 0) miss.push('còn phải thu khách ' + U.money(s.receivable)); if (s.payable > 0) miss.push('còn phải trả NCC ' + U.money(s.payable));
    if (t.status !== 'banggiao') miss.push('chưa bàn giao tour'); if (!t.budget.length) miss.push('chưa có dự trù dịch vụ');
    const msg = miss.length ? 'Tour <b>' + t.id + '</b> vẫn ' + miss.join('; ') + '.<br><br>Bạn có chắc muốn quyết toán và khóa tour?' : 'Quyết toán tour <b>' + t.id + '</b>? Tour sẽ bị khóa chỉnh sửa. Lợi nhuận thực tế: <b>' + U.money(s.realProfit) + '</b>.';
    if (!(await U.confirm({ title: 'Quyết toán tour', message: msg, ok: 'Quyết toán', danger: miss.length > 0, icon: 'flag-checkered' }))) return;
    t.settlement = { date: U.todayISO(), revenue: s.revenue, cost: s.cost, collected: s.collected, paid: s.paid, profit: s.realProfit };
    t.status = 'quyettoan'; Store.save(); refresh(); U.toast('Đã quyết toán tour ' + t.id, 'Lợi nhuận thực tế ' + U.money(s.realProfit));
  }
  async function reopen() {
    const t = tourOf();
    if (!(await U.confirm({ title: 'Mở lại quyết toán', message: 'Mở lại tour <b>' + t.id + '</b> để chỉnh sửa? Số liệu quyết toán đã chốt sẽ bị xóa.', ok: 'Mở lại' }))) return;
    t.status = t.handover && t.handover.confirmed !== false ? 'banggiao' : 'dieuhanh'; t.settlement = null; Store.save(); refresh(); U.toast('Đã mở lại tour', t.id);
  }

  /* ---------------------------------------------------------- TAB TÍNH GIÁ */
  function pricingData(t) {
    const guests = Math.max(1, Number(t.guests) || 1), cost = C.tourCost(t), o = C.order(t.orderId) || {}, rev = C.total(o) || 0;
    return { guests, cost, per: Math.round(cost / guests), sell: Math.round(rev / guests), rev, o };
  }
  function panePricing(t) {
    const p = pricingData(t), locked = t.status === 'quyettoan', diff = p.sell - p.per;
    let h = '<div class="tab-pane"><div class="row-gap mb"><div class="field" style="margin:0"><label>Số khách</label><input class="inp" id="guests" type="number" min="1" step="1" value="' + t.guests + '" style="width:120px"' + (locked ? ' disabled' : '') + '></div>' +
      '<div class="spacer" style="flex:1"></div><button class="btn" data-act="priceXlsx"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button><button class="btn btn-primary" data-act="pricePrint"><i class="fa-solid fa-print"></i>In / Xuất PDF</button></div>';
    h += '<div class="price-hero mb"><div><div class="cap">Giá tour cho 1 khách (giá vốn)</div><div class="big">' + U.money(p.per) + '</div><div class="formula">= Tổng chi phí dịch vụ ' + U.money(p.cost) + ' ÷ ' + p.guests + ' khách</div></div>' +
      '<div style="margin-left:auto;text-align:right"><div class="cap">Giá bán thực tế / khách (từ đơn hàng)</div><div style="font-size:19px;font-weight:800">' + U.money(p.sell) + '</div><div class="formula">Chênh lệch ' + U.signed(diff) + ' / khách' + (p.per ? ' (' + (diff / p.per * 100).toFixed(1) + '% so với giá vốn)' : '') + '</div></div></div>';
    h += '<div class="card" style="box-shadow:none">' + U.table({
      rows: t.budget, st: { page: 1 }, size: 200, nopager: true, empty: U.empty('calculator', 'Chưa có dự trù', 'Thêm dịch vụ ở tab “Dự trù dịch vụ” để tính giá tour.'),
      cols: [{ label: '#', cls: 'center', render: l => t.budget.indexOf(l) + 1 }, { label: 'Dịch vụ', render: l => U.esc(l.service) + '<div class="cell-sub">' + U.esc((C.supplier(l.supplierId) || {}).name || '') + '</div>' },
        { label: 'Thành tiền', cls: 'right', render: l => U.money(C.lineAmount(l)) }, { label: 'Chia cho ' + p.guests + ' khách', cls: 'right', render: l => U.money(Math.round(C.lineAmount(l) / p.guests)) }],
      foot: t.budget.length ? '<tr><td colspan="2" class="right">Tổng chi phí dịch vụ</td><td class="right">' + U.money(p.cost) + '</td><td class="right">' + U.money(p.per) + '</td></tr>' : ''
    }) + '</div></div>';
    return h;
  }
  function pricingExport(t) {
    const p = pricingData(t);
    const rows = t.budget.map((l, i) => { const s = C.supplier(l.supplierId) || {}; return [i + 1, s.name || '', s.type || '', l.service, l.qty, l.price, C.lineAmount(l), Math.round(C.lineAmount(l) / p.guests)]; });
    rows.push([]); rows.push(['', '', '', 'Tổng chi phí dịch vụ', '', '', p.cost, p.per]); rows.push(['', '', '', 'Số khách', '', '', p.guests, '']); rows.push(['', '', '', 'GIÁ TOUR / 1 KHÁCH', '', '', p.per, '']);
    U.exportXlsx({ filename: 'tinh-gia-tour-' + t.id, sheet: 'Tính giá tour', title: 'BẢNG TÍNH GIÁ TOUR ' + t.id, subtitle: (p.o.serviceName || ''), headers: ['STT', 'Nhà cung cấp', 'Loại hình', 'Dịch vụ', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Chia mỗi khách'], rows, moneyCols: [5, 6, 7] });
  }
  function pricingPrint(t) {
    const p = pricingData(t), o = p.o;
    const html = U.docHeader('Mã tour: <b>' + t.id + '</b><br>' + U.docDate()) + '<div class="doc-title">Bảng tính giá tour</div><div class="doc-sub">Tour ' + t.id + ' — ' + U.esc(o.serviceName) + '</div>' +
      '<div class="doc-meta"><div><span>Khách hàng:</span> <b>' + U.esc(custName(o)) + '</b></div><div><span>Số khách:</span> <b>' + p.guests + '</b></div><div><span>Khởi hành:</span> ' + U.fdate(o.start) + '</div><div><span>Kết thúc:</span> ' + U.fdate(o.end) + '</div></div>' +
      '<table class="doc-tbl"><thead><tr><th>STT</th><th>Nhà cung cấp</th><th>Dịch vụ</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th><th>Chia ' + p.guests + ' khách</th></tr></thead><tbody>' +
      t.budget.map((l, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + U.esc((C.supplier(l.supplierId) || {}).name || '') + '</td><td>' + U.esc(l.service) + '</td><td class="c">' + U.fmt(l.qty) + '</td><td class="r">' + U.fmt(l.price) + '</td><td class="r">' + U.fmt(C.lineAmount(l)) + '</td><td class="r">' + U.fmt(Math.round(C.lineAmount(l) / p.guests)) + '</td></tr>').join('') +
      '<tr><td colspan="5" class="r b">TỔNG CHI PHÍ DỊCH VỤ</td><td class="r b">' + U.fmt(p.cost) + '</td><td class="r b">' + U.fmt(p.per) + '</td></tr></tbody></table>' +
      '<div class="doc-box"><div>Công thức: Tổng chi phí dịch vụ ÷ Số khách = ' + U.fmt(p.cost) + ' ÷ ' + p.guests + '</div><div class="doc-big">GIÁ TOUR CHO 1 KHÁCH: ' + U.fmt(p.per) + ' đồng</div><div>Giá bán thực tế theo đơn hàng: ' + U.fmt(p.sell) + ' đồng / khách</div></div>' +
      '<div class="doc-sign" style="grid-template-columns:1fr 1fr"><div><b>Người lập</b><i>(Ký, ghi rõ họ tên)</i></div><div><b>Giám đốc duyệt</b><i>(Ký, ghi rõ họ tên)</i></div></div>';
    U.previewDoc('Bảng tính giá tour ' + t.id, html, { filename: 'Tinh-gia-tour-' + t.id, xlsx: () => pricingExport(t) });
  }

  /* ------------------------------------------------------------ TAB BÀN GIAO */
  function paneHandover(t) {
    const locked = t.status === 'quyettoan', hv = t.handover || { date: U.todayISO(), receiver: '', phone: '', note: '' }, dis = locked ? ' disabled' : '';
    let h = '<div class="tab-pane"><div class="grid g-12" style="grid-template-columns:minmax(260px,1fr) 2fr;align-items:start"><div>' +
      '<div class="sec-title"><i class="fa-solid fa-handshake-angle"></i>Thông tin bàn giao</div>' +
      U.field({ id: 'hDate', label: 'Ngày bàn giao', html: U.input({ id: 'hDate', type: 'date', value: hv.date, attrs: dis }) }) +
      U.field({ id: 'hReceiver', label: 'Người nhận bàn giao (HDV / trưởng đoàn)', req: true, html: U.input({ id: 'hReceiver', value: hv.receiver, attrs: dis }) }) +
      U.field({ id: 'hPhone', label: 'Số điện thoại', html: U.input({ id: 'hPhone', type: 'tel', value: hv.phone, attrs: dis }) }) +
      U.field({ id: 'hNote', label: 'Ghi chú bàn giao', html: '<textarea class="inp" id="hNote" rows="3"' + dis + '>' + U.esc(hv.note) + '</textarea>' }) +
      (locked ? '' : '<div class="row-gap"><button class="btn btn-primary" data-act="handoverConfirm"><i class="fa-solid fa-check"></i>' + (t.status === 'banggiao' ? 'Cập nhật bàn giao' : 'Xác nhận đã bàn giao') + '</button></div>') +
      (t.status === 'banggiao' ? '<div class="callout ok mt"><i class="fa-solid fa-circle-check"></i><div>Tour đã bàn giao ngày <b>' + U.fdate(hv.date) + '</b> cho <b>' + U.esc(hv.receiver) + '</b>.</div></div>' : '') +
      '</div><div><div class="row-gap" style="margin-bottom:10px"><div class="sec-title" style="margin:0"><i class="fa-solid fa-list-check"></i>Dịch vụ bàn giao (theo dự trù tour)</div><div style="flex:1"></div>' +
      '<button class="btn btn-sm" data-act="handoverXlsx"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button><button class="btn btn-sm btn-primary" data-act="handoverPrint"><i class="fa-solid fa-print"></i>Xuất file bàn giao</button></div>' +
      '<div class="card" style="box-shadow:none">' + U.table({
        rows: t.budget, st: { page: 1 }, size: 200, nopager: true, empty: U.empty('list-check', 'Chưa có dịch vụ', 'Danh sách bàn giao lấy từ dự trù tour.'),
        cols: [{ label: '#', cls: 'center', render: l => t.budget.indexOf(l) + 1 }, { label: 'Nhà cung cấp', render: l => { const s = C.supplier(l.supplierId) || {}; return '<div class="cell-main">' + U.esc(s.name || '') + '</div><div class="cell-sub">' + U.esc(s.phone || '') + '</div>'; } },
          { label: 'Dịch vụ', render: l => U.esc(l.service) }, { label: 'SL', cls: 'center', render: l => U.fmt(l.qty) }, { label: 'Booking', render: l => C.lineBooked(t, l) ? U.badge('Đã gửi', 'green') : U.badge('Chưa gửi', 'orange') }]
      }) + '</div></div></div></div>';
    return h;
  }
  function readHandover() { const g = id => (U.$('#' + id, viewEl) || {}).value || ''; return { date: g('hDate') || U.todayISO(), receiver: g('hReceiver').trim(), phone: g('hPhone').trim(), note: g('hNote').trim() }; }
  function handoverDoc(t, hv) {
    const o = C.order(t.orderId) || {};
    const html = U.docHeader('Mã tour: <b>' + t.id + '</b><br>' + U.docDate(hv.date)) + '<div class="doc-title">Biên bản bàn giao tour</div><div class="doc-sub">Tour ' + t.id + ' — ' + U.esc(o.serviceName) + '</div>' +
      '<div class="doc-meta"><div><span>Khách hàng / đoàn:</span> <b>' + U.esc(custName(o)) + '</b></div><div><span>Số khách:</span> <b>' + t.guests + '</b></div><div><span>Khởi hành:</span> ' + U.fdate(o.start) + '</div><div><span>Kết thúc:</span> ' + U.fdate(o.end) + '</div>' +
      '<div><span>Người nhận bàn giao:</span> <b>' + (U.esc(hv.receiver) || '………………') + '</b></div><div><span>Điện thoại:</span> ' + (U.esc(hv.phone) || '………………') + '</div></div>' +
      '<div class="doc-note b">Danh sách dịch vụ bàn giao (theo dự trù tour):</div><table class="doc-tbl"><thead><tr><th>STT</th><th>Nhà cung cấp</th><th>Loại hình</th><th>Dịch vụ</th><th>SL</th><th>Liên hệ NCC</th><th>Booking</th></tr></thead><tbody>' +
      (t.budget.length ? t.budget.map((l, i) => { const s = C.supplier(l.supplierId) || {}; return '<tr><td class="c">' + (i + 1) + '</td><td>' + U.esc(s.name || '') + '</td><td>' + U.esc(s.type || '') + '</td><td>' + U.esc(l.service) + '</td><td class="c">' + U.fmt(l.qty) + '</td><td>' + U.esc(s.phone || '') + '</td><td class="c">' + (C.lineBooked(t, l) ? 'Đã gửi' : 'Chưa gửi') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="c">Chưa có dịch vụ trong dự trù</td></tr>') + '</tbody></table>' +
      (hv.note ? '<div class="doc-note"><b>Ghi chú:</b> ' + U.esc(hv.note) + '</div>' : '') +
      '<div class="doc-sign" style="grid-template-columns:1fr 1fr"><div><b>Bên giao (Điều hành tour)</b><i>(Ký, ghi rõ họ tên)</i></div><div><b>Bên nhận (HDV / trưởng đoàn)</b><i>(Ký, ghi rõ họ tên)</i></div></div>';
    U.previewDoc('Bàn giao tour ' + t.id, html, {
      filename: 'Ban-giao-tour-' + t.id, xlsx: () => U.exportXlsx({
        filename: 'ban-giao-tour-' + t.id, sheet: 'Bàn giao tour', title: 'BIÊN BẢN BÀN GIAO TOUR ' + t.id, subtitle: (o.serviceName || '') + ' · ' + t.guests + ' khách',
        headers: ['STT', 'Nhà cung cấp', 'Loại hình', 'Dịch vụ', 'Số lượng', 'Điện thoại NCC', 'Email NCC', 'Booking'],
        rows: t.budget.map((l, i) => { const s = C.supplier(l.supplierId) || {}; return [i + 1, s.name || '', s.type || '', l.service, l.qty, s.phone || '', s.email || '', C.lineBooked(t, l) ? 'Đã gửi' : 'Chưa gửi']; })
      })
    });
  }
  function confirmHandover() {
    const t = tourOf(), hv = readHandover(), box = U.$('[data-f="hReceiver"]', viewEl); U.clearErr(viewEl);
    if (!hv.receiver) { U.invalid(viewEl, 'hReceiver', 'Nhập người nhận bàn giao'); box.querySelector('.inp').focus(); return; }
    t.handover = hv; if (t.status === 'dieuhanh') t.status = 'banggiao';
    Store.save(); refresh(); U.toast('Đã xác nhận bàn giao tour', t.id + ' → ' + hv.receiver);
  }

  /* =============================================================== ROUTE */
  const mod = {
    title: 'Điều hành tour', group: 'Nghiệp vụ', icon: 'route',
    render(view, args) {
      viewEl = view;
      if (args && args[0]) {
        ds.id = args[0]; ds.tab = ['budget', 'booking', 'summary', 'pricing', 'handover'].includes(args[1]) ? args[1] : 'budget';
        view.onclick = detailClick; view.onchange = detailChange; renderDetail(); return;
      }
      ds.id = ''; st.q = App.Router.takeQ() || ''; st.page = 1; st.tab = 'all';
      view.innerHTML = '<div class="page-head"><div><h1>Điều hành tour</h1><p>Đơn hàng tạo thành công tự động chuyển vào đây để lập dự trù, booking NCC, quyết toán và bàn giao.</p></div><div class="page-head-actions">' +
        '<button class="btn" id="tExport"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button><button class="btn btn-primary" id="tAdd"><i class="fa-solid fa-plus"></i>Tạo đơn hàng</button></div></div>' +
        '<div class="kpi-row" id="tKpi"></div><div class="card"><div id="tTabs"></div><div class="toolbar"><div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" id="tSearch" placeholder="Tìm theo mã đơn, tên dịch vụ, tên KH, số điện thoại…" value="' + U.esc(st.q) + '"></div></div><div id="tBody"></div></div>';
      listBody = U.$('#tBody', view); listKpi = U.$('#tKpi', view); listTabs = U.$('#tTabs', view);
      U.$('#tSearch', view).oninput = e => { st.q = e.target.value; st.page = 1; renderList(); };
      U.$('#tExport', view).onclick = exportList; U.$('#tAdd', view).onclick = () => App.mod.orders.openForm();
      view.onchange = null;
      view.onclick = e => {
        const tb = e.target.closest('[data-tab]'); if (tb) { st.tab = tb.dataset.tab; st.page = 1; renderList(); return; }
        if (U.pagerClick(e, st)) { renderList(); return; }
        const r = e.target.closest('[data-go]'); if (r) App.Router.go('#/operations/' + r.dataset.go);
      };
      renderList();
    }
  };
  function detailChange(e) {
    if (e.target.id === 'guests') {
      const t = tourOf(), n = Number(e.target.value);
      if (!Number.isInteger(n) || n < 1) { U.toast('Số khách không hợp lệ', 'Nhập số nguyên từ 1 trở lên.', 'warning'); e.target.value = t.guests; return; }
      t.guests = n; Store.save(); renderDetail();
    }
  }
  function detailClick(e) {
    const tb = e.target.closest('[data-tab]');
    if (tb) { ds.tab = tb.dataset.tab; setHash(); renderDetail(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const t = tourOf(), id = b.dataset.id;
    switch (b.dataset.act) {
      case 'back': App.Router.go('#/operations'); break;
      case 'printOrder': App.mod.orders.printOrder(t.id); break;
      case 'thu': App.mod.accounting.openVoucherForm({ kind: 'thu', orderId: t.orderId, onSaved: refresh }); break;
      case 'addLine': lineForm(); break;
      case 'editLine': lineForm(id); break;
      case 'delLine': delLine(id); break;
      case 'payLine': payLine(id); break;
      case 'booking': openBooking(id); break;
      case 'vPrint': App.mod.accounting.printVoucher(id); break;
      case 'settle': settle(); break;
      case 'reopen': reopen(); break;
      case 'priceXlsx': pricingExport(t); break;
      case 'pricePrint': pricingPrint(t); break;
      case 'handoverConfirm': confirmHandover(); break;
      case 'handoverPrint': handoverDoc(t, t.status === 'quyettoan' || t.handover ? Object.assign({}, t.handover || {}, t.status === 'quyettoan' ? {} : readHandover()) : readHandover()); break;
      case 'handoverXlsx': { handoverDoc(t, readHandover()); break; }
    }
  }
  App.mod.operations = mod; App.Router.register('operations', mod);
})();
