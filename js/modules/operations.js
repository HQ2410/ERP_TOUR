/* ============================================================================
 * Phân hệ 4 — ĐIỀU HÀNH TOUR
 * Đơn hàng tạo thành công tự động xuất hiện ở đây. Mỗi tour có:
 *  - Dự trù dịch vụ (tên dịch vụ/loại hình, nội dung, NCC, SL, đơn giá + VAT, số lượt/đêm, thành tiền) + phiếu chi thanh toán NCC
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
      { key: 'summary', label: 'Tổng hợp & Quyết toán', icon: 'scale-balanced' }, { key: 'handover', label: 'Bàn giao tour', icon: 'handshake-angle' }];
    v.innerHTML = '<button class="back-link" data-act="back"><i class="fa-solid fa-arrow-left"></i>Danh sách tour</button>' +
      '<div class="page-head"><div><h1>Tour ' + t.id + ' · ' + U.esc(o.serviceName) + '</h1>' +
      '<div class="tour-meta"><span><i class="fa-solid fa-user"></i>' + U.esc(cu.name) + (cu.phone ? ' · ' + U.esc(cu.phone) : '') + '</span>' + (C.orderRoute(o) ? '<span><i class="fa-solid fa-route"></i>' + U.esc(C.orderRoute(o)) + '</span>' : '') + '<span><i class="fa-solid fa-calendar-days"></i>' + U.fdate(o.start) + ' → ' + U.fdate(o.end) + '</span><span><i class="fa-solid fa-users"></i>' + t.guests + ' khách' + (settled ? '' : ' <button type="button" class="btn btn-ghost btn-icon btn-xs" data-act="guests" title="Sửa số khách"><i class="fa-solid fa-pen"></i></button>') + '</span>' +
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
    pane.innerHTML = ({ budget: paneBudget, booking: paneBooking, summary: paneSummary, handover: paneHandover }[ds.tab] || paneBudget)(t);
  }

  /* ---------------------------------------------------------- TAB DỰ TRÙ */
  const bookBadge = (t, l) => { const k = C.bookingState(t, l); return k === 'cancelled' ? U.badge('Booking đã huỷ', 'red') : k === 'sent' ? U.badge('Đã gửi booking', 'green') : U.badge('Chưa gửi', 'slate'); };
  function dueHtml(t, l) {
    const d = C.lineDue(t, l);
    if (d.kind === 'cancelled') return '<div class="cell-sub">Đã huỷ' + (l.cancelledAt ? ' ngày ' + U.fdate(l.cancelledAt) : '') + '</div>';
    if (d.kind === 'paid') return '<div class="cell-sub money-pos">Đã thanh toán đủ</div>';
    const label = d.kind === 'partial' ? 'Còn ' + U.money(d.remain) + ' · hạn ' : 'Hạn thanh toán: ';
    if (!d.due) return '<div class="cell-sub">' + (d.kind === 'partial' ? 'Còn ' + U.money(d.remain) + ' · ' : '') + '<span class="muted">chưa đặt hạn thanh toán</span></div>';
    return '<div class="cell-sub' + (d.overdue ? ' due-over' : '') + '"><i class="fa-regular fa-calendar"></i> ' + label + '<b>' + U.fdate(d.due) + '</b>' + (d.overdue ? ' · quá hạn' : '') + '</div>';
  }
  function paneBudget(t) {
    const locked = t.status === 'quyettoan', cost = C.tourCost(t), paid = C.tourPaidOut(t);
    const linePaidSum = App.sum(t.budget, l => C.linePaid(t.id, l.id));
    let h = '<div class="toolbar"><div class="muted" style="font-size:12.8px">Dự trù dịch vụ của tour — thành tiền = số lượng × đơn giá × số lượt/đêm. Bấm “Gửi booking” cạnh tên NCC để gửi email đặt dịch vụ; tạo phiếu chi trực tiếp trên từng dòng để thanh toán NCC.</div><div class="spacer"></div>' +
      (locked ? '' : '<button class="btn btn-primary btn-sm" data-act="addLine"><i class="fa-solid fa-plus"></i>Thêm dịch vụ dự trù</button>') + '</div>';
    h += U.table({
      rows: t.budget, st: { page: 1 }, size: 200, nopager: true,
      empty: U.empty('list-check', 'Chưa có dự trù', 'Thêm các dịch vụ NCC (lưu trú, vận chuyển, nhà hàng…) cần cho tour này.'),
      rowCls: l => l.cancelled ? 'row-cancelled' : '',
      cols: [
        { label: '#', cls: 'center', render: l => t.budget.indexOf(l) + 1 },
        { label: 'Tên dịch vụ / Nội dung', render: l => U.badge(l.type || 'Khác', K.tone(l.type), true) + '<div class="cell-main" style="margin-top:3px">' + U.esc(l.service) + '</div><div class="cell-sub">' + (l.from ? U.fdate(l.from) + ' → ' + U.fdate(l.to || l.from) : '') + (l.note ? ' · ' + U.esc(l.note) : '') + '</div>' },
        { label: 'Nhà cung cấp', render: l => { const s = C.supplier(l.supplierId) || {};
          return '<div class="cell-main">' + U.esc(s.name || 'NCC đã xóa') + (s.standard ? ' ' + U.badge(s.standard, 'orange', true) : '') + '</div>' +
            (locked || l.cancelled ? '' : '<button type="button" class="btn btn-xs btn-booking" data-act="bookLine" data-id="' + l.id + '" title="Mở email đặt dịch vụ gửi NCC"><i class="fa-solid fa-paper-plane"></i>Gửi booking</button>'); } },
        { label: 'SL', cls: 'center', render: l => U.fmt(l.qty) },
        { label: 'Đơn giá', cls: 'right', render: l => U.money(l.price) + '<div class="cell-sub">' + (K.VAT_LINE[l.vat] || K.VAT_LINE.none).label + '</div>' },
        { label: 'Lượt/đêm', cls: 'center', render: l => U.fmt(l.times === undefined ? 1 : l.times) },
        { label: 'Thành tiền', cls: 'right', render: l => l.cancelled ? '<s class="muted">' + U.money(C.lineGross(l)) + '</s>' : '<b class="num">' + U.money(C.lineAmount(l)) + '</b>' },
        { label: 'Đã chi', cls: 'right', render: l => U.money(C.linePaid(t.id, l.id)) },
        { label: 'Còn lại', cls: 'right', render: l => { const r = C.lineRemain(t, l), x = C.lineStatus(t, l); return (r ? '<span class="money-neg">' + U.money(r) + '</span>' : '<span class="muted">0 ₫</span>') + '<div style="margin-top:3px">' + U.badge(x.label, x.tone) + '</div>'; } },
        { label: 'Booking / Hạn thanh toán', render: l => bookBadge(t, l) + dueHtml(t, l) },
        { label: '', cls: 'right', render: l => locked ? '' : '<div class="row-actions">' + (l.cancelled ? U.iconBtn('restoreLine', l.id, 'rotate-left', 'Khôi phục booking') : U.iconBtn('payLine', l.id, 'money-bill-wave', 'Tạo phiếu chi (thanh toán NCC)') + U.iconBtn('cancelLine', l.id, 'ban', 'Huỷ booking')) + U.iconBtn('editLine', l.id, 'pen', 'Sửa') + U.iconBtn('delLine', l.id, 'trash', 'Xóa') + '</div>' }
      ],
      foot: t.budget.length ? '<tr><td colspan="7" class="right">Tổng cộng</td><td class="right">' + U.money(cost) + '</td><td class="right">' + U.money(linePaidSum) + '</td><td class="right">' + U.money(Math.max(0, cost - linePaidSum)) + '</td><td colspan="2"></td></tr>' : ''
    });
    if (t.budget.length) {
      const by = {}; t.budget.forEach(l => { const k = l.type || 'Khác', r = by[k] = by[k] || { n: 0, cost: 0, paid: 0 }; r.n++; r.cost += C.lineAmount(l); r.paid += C.linePaid(t.id, l.id); });
      h += '<div class="card-body" style="padding-top:6px"><div class="sec-title"><i class="fa-solid fa-layer-group"></i>Tổng chi phí cho từng dịch vụ</div><div class="card" style="box-shadow:none"><div class="tbl-wrap"><table class="tbl" style="min-width:0"><thead><tr><th>Tên dịch vụ</th><th class="center">Số dòng</th><th class="right">Tổng chi phí</th><th class="right">Đã chi</th><th class="right">Còn lại</th></tr></thead><tbody>' +
        Object.keys(by).map(k => '<tr><td>' + U.badge(k, K.tone(k), true) + '</td><td class="center">' + by[k].n + '</td><td class="right"><b>' + U.money(by[k].cost) + '</b></td><td class="right">' + U.money(by[k].paid) + '</td><td class="right">' + U.money(Math.max(0, by[k].cost - by[k].paid)) + '</td></tr>').join('') +
        '</tbody></table></div></div></div>';
    }
    if (paid - linePaidSum > 0) h += '<div class="card-body" style="padding-top:0"><div class="callout"><i class="fa-solid fa-circle-info"></i><div>Có <b>' + U.money(paid - linePaidSum) + '</b> chi phí phát sinh không gắn dòng dự trù (ví dụ tạm ứng cho hướng dẫn viên) — đã tính vào “Đã chi” của tour.</div></div></div>';
    return h;
  }

  function lineForm(lineId) {
    const t = tourOf(), l = lineId ? t.budget.find(x => x.id === lineId) : null, S = Store.state, o = C.order(t.orderId) || {};
    const paid = l ? C.linePaid(t.id, l.id) : 0, partial = l && paid > 0 && C.lineRemain(t, l) > 0;
    const types = K.serviceTypes().slice(); if (l && l.type && !types.includes(l.type)) types.push(l.type);
    const html = U.field({ id: 'type', label: 'Tên dịch vụ (loại hình)', req: true, html: U.select({ id: 'type', ph: '— Chọn loại hình dịch vụ —', value: l ? l.type : '', options: types.map(x => ({ v: x, l: x })) }) }) +
      U.field({ id: 'service', label: 'Nội dung', req: true, hint: 'VD: đặt dịch vụ Nhà hàng cho buổi ăn tối thì nhập “Ăn tối”.', html: U.input({ id: 'service', value: l ? l.service : '', ph: 'VD: Ăn tối, Khách sạn 3 đêm (5 phòng), Xe 29 chỗ Hà Nội - Sapa…' }) }) +
      U.field({ id: 'supSearch', label: 'Nhà cung cấp', req: true, hint: 'Danh sách tự lọc theo loại hình đã chọn. Gõ tên để tìm rồi bấm chọn.', html: '<div class="row-gap" style="flex-wrap:nowrap"><div class="combo" style="flex:1;min-width:0"><input class="inp" id="supSearch" autocomplete="off" placeholder="Chọn tên dịch vụ trước, rồi gõ để tìm NCC…"><input type="hidden" id="supplierId" value="' + U.esc(l ? l.supplierId : '') + '"><div class="combo-list" id="supList"></div></div><button type="button" class="btn btn-sm" id="btnNewSup" title="Thêm nhanh NCC"><i class="fa-solid fa-plus"></i></button></div>' }) +
      '<div class="form-grid">' +
      U.field({ id: 'from', label: 'Từ ngày', html: U.input({ id: 'from', type: 'date', value: l ? l.from : (o.start || '') }) }) +
      U.field({ id: 'to', label: 'Đến ngày', html: U.input({ id: 'to', type: 'date', value: l ? l.to : (o.end || '') }) }) +
      U.field({ id: 'qty', label: 'Số lượng', req: true, html: U.input({ id: 'qty', type: 'number', value: l ? l.qty : 1, attrs: 'min="1" step="1"' }) }) +
      U.field({ id: 'price', label: 'Đơn giá (₫)', req: true, html: U.input({ id: 'price', money: true, value: l ? l.price : '' }) }) +
      U.field({ id: 'vat', label: 'Thuế VAT', html: U.select({ id: 'vat', value: l ? l.vat : 'none', options: Object.keys(K.VAT_LINE).map(k => ({ v: k, l: K.VAT_LINE[k].label })) }) }) +
      U.field({ id: 'times', label: 'Số lượt / đêm', req: true, html: U.input({ id: 'times', type: 'number', value: l && l.times !== undefined ? l.times : 1, attrs: 'min="1" step="1"' }) }) + '</div>' +
      '<div class="sumbox" id="lsum"></div>' +
      '<div class="form-grid mt">' + U.field({ id: 'payDue', label: 'Thời hạn thanh toán', hint: 'Ngày - tháng - năm phải thanh toán cho NCC.', html: U.input({ id: 'payDue', type: 'date', value: l ? l.payDue : '' }) }) +
      (partial ? U.field({ id: 'remainDue', label: 'Hạn thanh toán số tiền còn lại', hint: 'Đã chi một phần — ngày thanh toán phần còn lại.', html: U.input({ id: 'remainDue', type: 'date', value: l ? l.remainDue : '' }) }) : '<div></div>') + '</div>' +
      U.field({ id: 'note', label: 'Ghi chú', html: U.input({ id: 'note', value: l ? l.note : '' }) }) +
      (paid ? '<div class="callout warn mt"><i class="fa-solid fa-triangle-exclamation"></i><div>Dòng này đã chi <b>' + U.money(paid) + '</b>; thành tiền mới không được nhỏ hơn số đã chi.</div></div>' : '');
    U.modal({
      title: l ? 'Sửa dịch vụ dự trù' : 'Thêm dịch vụ dự trù', sub: 'Tour ' + t.id, size: 'md', static: true, body: html,
      onMount: h => {
        const b = h.body, $ = s => b.querySelector(s);
        const calc = () => {
          const type = U.val(b, 'type'), vatK = U.val(b, 'vat'), r = (K.VAT_LINE[vatK] || K.VAT_LINE.none).rate;
          const amt = (Number(U.val(b, 'qty')) || 0) * U.money$(b, 'price') * (Number(U.val(b, 'times')) || 0);
          const others = App.sum(t.budget.filter(x => (!l || x.id !== l.id) && (x.type || 'Khác') === type), C.lineAmount);
          $('#lsum').innerHTML = '<div class="line total"><span>Thành tiền (SL × đơn giá × lượt/đêm)</span><span>' + U.money(amt) + '</span></div>' +
            (r ? '<div class="line"><span class="muted">Trong đó VAT ' + Math.round(r * 100) + '% đã bao gồm</span><span class="muted">' + U.money(Math.round(amt * r / (1 + r))) + '</span></div>' : '') +
            (type ? '<div class="line"><span>Tổng chi phí dịch vụ ' + U.esc(type) + ' của tour (gồm dòng này)</span><b>' + U.money(others + amt) + '</b></div>' : '');
        };
        b.addEventListener('input', calc); b.addEventListener('change', calc);
        // ---- ô chọn NCC có tìm kiếm, tự lọc theo loại hình
        const inp = $('#supSearch'), hid = $('#supplierId'), list = $('#supList');
        let lastPrice = l ? l.price : 0;
        const curType = () => U.val(b, 'type');
        const pick = s => {
          hid.value = s.id; inp.value = s.name; list.classList.remove('open');
          const pr = $('#price'); if (!U.num(pr.value) || U.num(pr.value) === lastPrice) { pr.value = s.price ? U.fmt(s.price) : ''; lastPrice = s.price; }
          calc();
        };
        const show = () => {
          const ty = curType(); if (!ty) { list.innerHTML = '<div class="combo-empty">Hãy chọn tên dịch vụ (loại hình) trước.</div>'; list.classList.add('open'); return; }
          const q = U.norm(inp.value), sel = hid.value && (C.supplier(hid.value) || {}).name === inp.value;
          const rs = S.suppliers.filter(s => s.type === ty && (sel || !q || U.norm(s.name).includes(q) || U.norm(s.province).includes(q) || U.norm(s.id).includes(q) || U.norm(s.address).includes(q)))
            .sort((a, c) => a.name.localeCompare(c.name, 'vi')).slice(0, 40);
          list.innerHTML = rs.length ? rs.map(s => '<div class="combo-item" data-sid="' + s.id + '"><b>' + U.esc(s.name) + '</b>' + (s.standard ? ' ' + U.badge(s.standard, 'orange', true) : '') + '<span class="cell-sub">' + U.esc(s.province) + (s.phone ? ' · ' + U.esc(s.phone) : '') + (s.price ? ' · ' + U.money(s.price) : '') + '</span></div>').join('')
            : '<div class="combo-empty">Không có NCC loại “' + U.esc(ty) + '” phù hợp. Bấm dấu + bên cạnh để thêm mới.</div>';
          list.classList.add('open');
        };
        inp.addEventListener('focus', show);
        inp.addEventListener('input', () => { hid.value = ''; show(); });
        list.addEventListener('mousedown', e => { const it = e.target.closest('[data-sid]'); if (it) { e.preventDefault(); pick(C.supplier(it.dataset.sid)); } });
        inp.addEventListener('blur', () => setTimeout(() => list.classList.remove('open'), 120));
        $('#type').addEventListener('change', () => { const s = C.supplier(hid.value); if (s && s.type !== curType()) { hid.value = ''; inp.value = ''; } inp.disabled = !curType(); inp.placeholder = curType() ? 'Gõ tên NCC để tìm…' : 'Chọn tên dịch vụ trước, rồi gõ để tìm NCC…'; if (curType()) inp.focus(); });
        const s0 = l ? C.supplier(l.supplierId) : null; if (s0) inp.value = s0.name; inp.disabled = !curType();
        if (inp.disabled) inp.placeholder = 'Chọn tên dịch vụ trước, rồi gõ để tìm NCC…'; else if (!s0) inp.placeholder = 'Gõ tên NCC để tìm…';
        $('#btnNewSup').onclick = () => { if (!curType()) { U.toast('Chọn tên dịch vụ trước', 'NCC mới sẽ có loại hình theo dịch vụ đã chọn.', 'info'); return; } App.mod.suppliers.openForm(null, rec => pick(rec), { type: curType() }); };
        calc();
      },
      foot: [{ label: 'Hủy' }, {
        label: l ? 'Lưu thay đổi' : 'Thêm vào dự trù', icon: 'check', cls: 'btn-primary', onClick: h => {
          const b = h.body; U.clearErr(b); let ok = true;
          const d = { type: U.val(b, 'type'), service: U.val(b, 'service'), supplierId: U.val(b, 'supplierId'), from: U.val(b, 'from'), to: U.val(b, 'to'), qty: Number(U.val(b, 'qty')), price: U.money$(b, 'price'), vat: U.val(b, 'vat') || 'none', times: Number(U.val(b, 'times')), payDue: U.val(b, 'payDue'), note: U.val(b, 'note') };
          if (partial) d.remainDue = U.val(b, 'remainDue');
          if (!d.type) ok = U.invalid(b, 'type', 'Chọn tên dịch vụ (loại hình)');
          if (!d.service) ok = U.invalid(b, 'service', 'Nhập nội dung dịch vụ');
          if (!d.supplierId) ok = U.invalid(b, 'supSearch', 'Chọn nhà cung cấp trong danh sách');
          if (d.from && d.to && d.to < d.from) ok = U.invalid(b, 'to', 'Ngày kết thúc phải sau ngày bắt đầu');
          if (!Number.isInteger(d.qty) || d.qty < 1) ok = U.invalid(b, 'qty', 'Số lượng phải là số nguyên ≥ 1');
          if (!Number.isInteger(d.times) || d.times < 1) ok = U.invalid(b, 'times', 'Số lượt/đêm phải là số nguyên ≥ 1');
          if (d.price <= 0) ok = U.invalid(b, 'price', 'Đơn giá phải lớn hơn 0');
          if (ok && l && d.qty * d.price * d.times < paid) ok = U.invalid(b, 'price', 'Thành tiền nhỏ hơn số đã chi (' + U.money(paid) + ')');
          if (!ok) { U.focusFirstInvalid(b); return; }
          if (l) { Object.assign(l, d); U.toast('Đã cập nhật dịch vụ dự trù', d.service); }
          else { t.budget.push(Object.assign({ id: Store.nextId('L', 3), remainDue: '', cancelled: false }, d)); U.toast('Đã thêm vào dự trù', d.service); }
          Store.save(); h.close(); refresh();
        }
      }]
    });
  }
  async function delLine(id) {
    const t = tourOf(), l = t.budget.find(x => x.id === id); if (!l) return;
    if (C.linePaid(t.id, id) > 0) { U.toast('Không thể xóa', 'Dòng này đã có phiếu chi. Hãy xóa phiếu chi trước.', 'warning'); return; }
    if (!(await U.confirm({ title: 'Xóa dịch vụ khỏi dự trù', message: 'Xóa <b>' + U.esc(l.service) + '</b> khỏi dự trù tour ' + U.esc(t.id) + '?', ok: 'Xóa', danger: true }))) return;
    t.budget = t.budget.filter(x => x.id !== id); t.bookings.forEach(b => { b.lineIds = b.lineIds.filter(x => x !== id); });
    Store.save(); refresh(); U.toast('Đã xóa khỏi dự trù', l.service);
  }
  function payLine(id) {
    const t = tourOf(), l = t.budget.find(x => x.id === id);
    if (C.lineRemain(t, l) <= 0) { U.toast('Đã chi đủ', 'Dịch vụ này đã thanh toán đủ cho NCC.', 'info'); return; }
    App.mod.accounting.openVoucherForm({ kind: 'chi', tourId: t.id, lineId: id, onSaved: refresh });
  }
  async function cancelLine(id) {
    const t = tourOf(), l = t.budget.find(x => x.id === id); if (!l) return;
    const paid = C.linePaid(t.id, id), sent = C.lineBooked(t, l);
    if (!(await U.confirm({ title: 'Huỷ booking', danger: true, ok: 'Huỷ booking', icon: 'ban',
      message: 'Huỷ booking dịch vụ <b>' + U.esc(l.service) + '</b> (' + U.esc((C.supplier(l.supplierId) || {}).name || '') + ')?<br><br>Dòng sẽ hiển thị <b>“Booking đã huỷ”</b> và không còn tính vào chi phí dự trù của tour.' +
        (sent ? '<br>Booking này đã gửi cho NCC — hãy báo huỷ trực tiếp với NCC.' : '') + (paid ? '<br><br><b>Đã chi ' + U.money(paid) + '</b> cho dòng này: số tiền vẫn nằm trong “Đã chi”, cần làm thủ tục hoàn tiền với NCC.' : '') }))) return;
    l.cancelled = true; l.cancelledAt = U.todayISO(); Store.save(); refresh(); U.toast('Đã huỷ booking', l.service, 'info');
  }
  function restoreLine(id) {
    const t = tourOf(), l = t.budget.find(x => x.id === id); if (!l) return;
    l.cancelled = false; l.cancelledAt = ''; Store.save(); refresh(); U.toast('Đã khôi phục booking', l.service);
  }

  /* ---------------------------------------------------------- TAB BOOKING */
  function groupBySupplier(t) { const m = {}; t.budget.forEach(l => { (m[l.supplierId] = m[l.supplierId] || []).push(l); }); return m; }
  function paneBooking(t) {
    const g = groupBySupplier(t), ids = Object.keys(g), locked = t.status === 'quyettoan';
    const live = sid => g[sid].filter(l => !l.cancelled);
    const sent = ids.filter(sid => live(sid).length && live(sid).every(l => C.lineBooked(t, l))).length, active = ids.filter(sid => live(sid).length).length;
    let h = '<div class="tab-pane"><div class="row-gap mb"><div class="muted" style="font-size:12.8px">Đã gửi booking cho <b>' + sent + '/' + active + '</b> nhà cung cấp trong dự trù. Email lấy từ danh mục NCC; bấm “Gửi booking” để mở email đặt dịch vụ.</div></div>';
    if (!ids.length) h += U.empty('envelope', 'Chưa có NCC trong dự trù', 'Thêm dịch vụ ở tab “Dự trù dịch vụ” rồi quay lại để tạo booking.');
    ids.forEach(sid => {
      const s = C.supplier(sid) || { name: 'NCC đã xóa', email: '', type: '' }, ls = g[sid], lv = live(sid);
      const all = lv.length && lv.every(l => C.lineBooked(t, l)), any = lv.some(l => C.lineBooked(t, l));
      const last = t.bookings.filter(b => b.supplierId === sid).sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
      h += '<div class="bk-card"><div class="bk-top"><div style="flex:1;min-width:200px"><div class="cell-main">' + U.esc(s.name) + ' ' + (s.type ? U.badge(s.type, K.tone(s.type), true) : '') + (s.standard ? ' ' + U.badge(s.standard, 'orange', true) : '') + '</div>' +
        '<div class="cell-sub"><i class="fa-regular fa-envelope"></i> ' + (s.email ? U.esc(s.email) : '<span class="money-neg">Chưa có email — bổ sung ở mục Nhà cung cấp</span>') + (s.phone ? ' · ' + U.esc(s.phone) : '') + (s.contactName ? ' · LH: ' + U.esc(s.contactName) + (s.contactPhone ? ' ' + U.esc(s.contactPhone) : '') : '') + '</div></div>' +
        (!lv.length ? U.badge('Booking đã huỷ', 'red') : all ? U.badge('Đã gửi booking', 'green') : any ? U.badge('Gửi một phần', 'orange') : U.badge('Chưa gửi', 'slate')) + (last ? '<span class="cell-sub">Lần cuối: ' + U.fdatetime(last.sentAt) + '</span>' : '') +
        (locked || !lv.length ? '' : '<button class="btn btn-sm ' + (all ? '' : 'btn-primary') + '" data-act="booking" data-id="' + sid + '"><i class="fa-solid fa-paper-plane"></i>' + (all ? 'Gửi lại booking' : 'Gửi booking') + '</button>') + '</div>' +
        '<ul class="bk-lines">' + ls.map(l => '<li>• <b>' + U.esc(l.type || '') + '</b>: ' + U.esc(l.service) + ' — SL ' + U.fmt(l.qty) + ' × ' + U.money(l.price) + ' × ' + U.fmt(l.times === undefined ? 1 : l.times) + ' = <b>' + (l.cancelled ? '<s>' + U.money(C.lineGross(l)) + '</s>' : U.money(C.lineAmount(l))) + '</b> ' + bookBadge(t, l) + dueHtml(t, l) + '</li>').join('') + '</ul></div>';
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
  // Nội dung form booking: chỉ gồm thông tin đặt dịch vụ, không nêu tên khách hàng / tên tour
  function buildMail(s, lines, note) {
    const co = Store.state.settings.company, multi = lines.length > 1;
    const blocks = lines.map((l, i) => (multi ? 'Mục ' + (i + 1) + ':\n' : '') +
      '   * Dịch vụ: ' + (l.type || '') + '\n   * Nội dung: ' + l.service + '\n   * Thời gian: Từ ' + U.fdate(l.from) + ' đến ' + U.fdate(l.to || l.from) +
      '\n   * Số lượng: ' + U.fmt(l.qty) + '\n   * Đơn giá: ' + U.fmt(l.price) + ' ₫' + (l.vat && l.vat !== 'none' ? ' (' + (K.VAT_LINE[l.vat] || {}).label + ')' : '') +
      '\n   * Số đêm/lượt: ' + U.fmt(l.times === undefined ? 1 : l.times) + '\n   Tổng tiền: ' + U.fmt(C.lineAmount(l)) + ' ₫');
    const notes = lines.map(l => l.note).filter(Boolean).concat(note ? [note] : []).join('; ');
    return 'Kính gửi: ' + s.name + '\n\n' + co.name + ' xin đặt dịch vụ theo thông tin bên dưới:\n\n' + blocks.join('\n\n') +
      (multi ? '\n\nTổng cộng: ' + U.fmt(App.sum(lines, C.lineAmount)) + ' ₫' : '') + '\n\nGhi chú: ' + notes +
      '\n\nKính đề nghị Quý đối tác xác nhận booking bằng cách phản hồi email này.\n\nTrân trọng,\n' + co.name + '\nĐT: ' + co.phone + ' · Email: ' + co.email;
  }
  function openBooking(supplierId, preLineId) {
    const t = tourOf(), s = C.supplier(supplierId); if (!s) return;
    const ls = t.budget.filter(l => l.supplierId === supplierId && !l.cancelled), co = Store.state.settings.company;
    if (!ls.length) { U.toast('Không có dịch vụ để đặt', 'Các dòng của NCC này đã huỷ booking.', 'info'); return; }
    const html = '<div class="form-grid">' + U.field({ id: 'to', label: 'Kính gửi (email NCC: ' + U.esc(s.name) + ')', req: true, html: U.input({ id: 'to', type: 'email', value: s.email, ph: 'email@ncc.com' }) }) +
      U.field({ id: 'cc', label: 'CC (tuỳ chọn)', html: U.input({ id: 'cc', type: 'email', value: co.email }) }) + '</div>' +
      U.field({ id: 'subject', label: 'Tiêu đề', req: true, html: U.input({ id: 'subject', value: 'Đặt dịch vụ - ' + co.name }) }) +
      U.field({ id: 'lines', label: 'Dịch vụ cần đặt', html: '<div class="tbl-wrap"><table class="tbl" style="min-width:560px"><thead><tr><th></th><th>Dịch vụ</th><th>Nội dung</th><th>Thời gian</th><th class="center">SL</th><th class="right">Đơn giá</th><th class="center">Lượt/đêm</th><th class="right">Thành tiền</th></tr></thead><tbody>' +
        ls.map(l => '<tr><td><input type="checkbox" class="bk-ck" value="' + l.id + '"' + (!preLineId || preLineId === l.id ? ' checked' : '') + '></td><td>' + U.esc(l.type || '') + '</td><td>' + U.esc(l.service) + '</td><td class="nowrap">' + U.fdate(l.from) + ' → ' + U.fdate(l.to || l.from) + '</td><td class="center">' + U.fmt(l.qty) + '</td><td class="right">' + U.money(l.price) + '</td><td class="center">' + U.fmt(l.times === undefined ? 1 : l.times) + '</td><td class="right">' + U.money(C.lineAmount(l)) + '</td></tr>').join('') + '</tbody></table></div>' }) +
      U.field({ id: 'note', label: 'Ghi chú thêm cho NCC', html: U.input({ id: 'note', ph: 'VD: Đón đoàn lúc 7h, cần phòng liền kề…' }) }) +
      U.field({ id: 'text', label: 'Nội dung email (form booking)', hint: 'Tự cập nhật theo dịch vụ đã chọn; bạn vẫn có thể sửa trực tiếp.', html: U.textarea({ id: 'text', rows: 15 }) }) +
      (Store.state.settings.mailApi ? '' : '<div class="callout"><i class="fa-solid fa-circle-info"></i><div>Chưa cấu hình API gửi email nên khi bấm <b>Gửi Booking</b>, hệ thống sẽ mở ứng dụng email của bạn với nội dung đã soạn sẵn. Cấu hình API tại <b>Hệ thống → Thông tin công ty</b> để gửi tự động.</div></div>');
    U.modal({
      title: 'Form booking — ' + s.name, sub: 'Đặt dịch vụ gửi nhà cung cấp', size: 'lg', static: true, body: html,
      onMount: h => {
        const b = h.body, ta = b.querySelector('#text'); let edited = false;
        const picked = () => { const ids = Array.from(b.querySelectorAll('.bk-ck:checked')).map(x => x.value); return ls.filter(l => ids.includes(l.id)); };
        const regen = () => { if (!edited) ta.value = buildMail(s, picked(), U.val(b, 'note')); };
        ta.addEventListener('input', () => { edited = true; });
        b.addEventListener('change', e => { if (e.target.classList.contains('bk-ck')) regen(); });
        b.querySelector('#note').addEventListener('input', regen); regen();
      },
      foot: [{ label: 'Hủy' }, {
        label: 'Gửi Booking', icon: 'paper-plane', cls: 'btn-primary', onClick: async (h, btn) => {
          const b = h.body; U.clearErr(b); let ok = true;
          const to = U.val(b, 'to'), cc = U.val(b, 'cc'), subject = U.val(b, 'subject'), text = b.querySelector('#text').value;
          const ids = Array.from(b.querySelectorAll('.bk-ck:checked')).map(x => x.value), lines = ls.filter(l => ids.includes(l.id));
          const mailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!mailRe.test(to)) ok = U.invalid(b, 'to', 'Nhập email NCC hợp lệ');
          if (cc && !mailRe.test(cc)) ok = U.invalid(b, 'cc', 'Email CC không hợp lệ');
          if (!subject) ok = U.invalid(b, 'subject', 'Nhập tiêu đề');
          if (!lines.length) ok = U.invalid(b, 'lines', 'Chọn ít nhất một dịch vụ');
          if (!ok) { U.focusFirstInvalid(b); return; }
          const api = Store.state.settings.mailApi; let via = 'mailto';
          if (api) {
            btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>Đang gửi…';
            try {
              const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, cc, subject, text, tourId: t.id, supplierId, supplierName: s.name, lines: lines.map(l => ({ type: l.type, service: l.service, from: l.from, to: l.to, qty: l.qty, times: l.times, price: l.price })) }) });
              if (!r.ok) throw new Error('HTTP ' + r.status); via = 'api';
            } catch (err) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>Gửi Booking'; U.toast('Gửi booking thất bại', 'Không gọi được API gửi email (' + err.message + '). Kiểm tra lại cấu hình.', 'danger'); return; }
          } else {
            const a = document.createElement('a'); a.href = 'mailto:' + encodeURIComponent(to).replace('%40', '@') + '?subject=' + encodeURIComponent(subject) + (cc ? '&cc=' + encodeURIComponent(cc) : '') + '&body=' + encodeURIComponent(text).replace(/%0A/g, '%0D%0A');
            document.body.appendChild(a); a.click(); a.remove();
          }
          t.bookings.push({ id: Store.nextId('BK', 3), supplierId, to, cc, subject, lineIds: lines.map(l => l.id), sentAt: U.nowISO(), via, note: U.val(b, 'note') });
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
    const byType = {}; t.budget.forEach(l => { const ty = l.type || (C.supplier(l.supplierId) || {}).type || 'Khác'; const r = byType[ty] = byType[ty] || { cost: 0, paid: 0 }; r.cost += C.lineAmount(l); r.paid += C.linePaid(t.id, l.id); });
    const margin = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
    let h = '<div class="tab-pane"><div class="grid g-2">';
    h += '<div><div class="sec-title"><i class="fa-solid fa-scale-balanced"></i>Tổng hợp thu – chi – lợi nhuận</div><div class="card" style="box-shadow:none"><div class="tbl-wrap"><table class="tbl" style="min-width:0"><thead><tr><th>Chỉ tiêu</th><th class="right">Kế hoạch</th><th class="right">Thực tế</th></tr></thead><tbody>' +
      '<tr><td>Doanh thu / <b>đã thu</b></td><td class="right">' + U.money(s.revenue) + '</td><td class="right">' + U.money(s.collected) + '</td></tr>' +
      '<tr><td>Chi phí dịch vụ / <b>đã chi</b></td><td class="right">' + U.money(s.cost) + '</td><td class="right">' + U.money(s.paid) + '</td></tr>' +
      '<tr><td><b>Lợi nhuận</b></td><td class="right">' + U.signed(s.planProfit) + '</td><td class="right">' + U.signed(s.realProfit) + '</td></tr>' +
      '<tr><td>Biên lợi nhuận</td><td class="right">' + margin(s.planProfit, s.revenue) + '</td><td class="right">' + margin(s.realProfit, s.collected) + '</td></tr>' +
      '<tr><td>Công nợ còn lại</td><td class="right" colspan="2">Phải thu <b>' + U.money(s.receivable) + '</b> · Phải trả NCC <b>' + U.money(s.payable) + '</b></td></tr></tbody></table></div></div></div>';
    h += '<div><div class="sec-title"><i class="fa-solid fa-layer-group"></i>Tổng hợp dịch vụ theo loại hình</div><div class="card" style="box-shadow:none">' + (Object.keys(byType).length ? '<div class="tbl-wrap"><table class="tbl" style="min-width:0"><thead><tr><th>Loại hình</th><th class="right">Dự trù</th><th class="right">Đã chi</th><th class="right">Còn lại</th></tr></thead><tbody>' +
      Object.keys(byType).map(k => '<tr><td>' + U.badge(k, K.tone(k), true) + '</td><td class="right">' + U.money(byType[k].cost) + '</td><td class="right">' + U.money(byType[k].paid) + '</td><td class="right">' + U.money(byType[k].cost - byType[k].paid) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="card-body muted">Chưa có dự trù.</div>') + '</div></div></div>';
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

  /* ------------------------------------------------------------ TAB BÀN GIAO */
  const hoLines = t => t.budget.filter(l => !l.cancelled);
  const contactOf = s => [s.contactName ? s.contactName + (s.contactRole ? ' (' + s.contactRole + ')' : '') : '', s.contactPhone || s.phone || ''].filter(Boolean).join(' · ');
  function hoInfo(t) {
    const o = C.order(t.orderId) || {}, cu = C.customer(o.customerId) || {};
    return { name: cu.name || '', phone: C.contactPhone(cu), route: C.orderRoute(o), start: o.start, end: o.end };
  }
  function paneHandover(t) {
    const locked = t.status === 'quyettoan', hv = Object.assign({ date: U.todayISO(), receiver: '', phone: '', driverName: '', driverPhone: '', note: '' }, t.handover || {}), dis = locked ? ' disabled' : '';
    const info = hoInfo(t), ls = hoLines(t), total = C.tourLinesPayable(t), adv = C.guideAdvanced(t), need = Math.max(0, total - adv);
    const sumCost = App.sum(ls, C.lineAmount), sumPaid = App.sum(ls, l => C.linePaid(t.id, l.id));
    let h = '<div class="tab-pane"><div class="sec-title"><i class="fa-solid fa-handshake-angle"></i>Thông tin bàn giao</div>' +
      '<dl class="dl mb"><dt>Tên khách / Đoàn</dt><dd>' + (U.esc(info.name) || '—') + ' · SĐT: ' + (U.esc(info.phone) || '—') + '</dd><dt>Tuyến</dt><dd>' + (U.esc(info.route) || '<span class="muted">Chưa nhập điểm khởi hành / điểm đến ở đơn hàng</span>') + '</dd>' +
      '<dt>Ngày bắt đầu — kết thúc</dt><dd>' + U.fdate(info.start) + ' — ' + U.fdate(info.end) + '</dd></dl>' +
      '<div class="form-grid">' +
      U.field({ id: 'hDate', label: 'Ngày bàn giao', html: U.input({ id: 'hDate', type: 'date', value: hv.date, attrs: dis }) }) + '<div></div>' +
      U.field({ id: 'hDriver', label: 'Tên tài xế', html: U.input({ id: 'hDriver', value: hv.driverName, attrs: dis }) }) +
      U.field({ id: 'hDriverPhone', label: 'Số điện thoại tài xế', html: U.input({ id: 'hDriverPhone', type: 'tel', value: hv.driverPhone, attrs: dis }) }) +
      U.field({ id: 'hReceiver', label: 'Người nhận bàn giao (HDV / trưởng đoàn)', req: true, html: U.input({ id: 'hReceiver', value: hv.receiver, attrs: dis }) }) +
      U.field({ id: 'hPhone', label: 'Số điện thoại người nhận', html: U.input({ id: 'hPhone', type: 'tel', value: hv.phone, attrs: dis }) }) + '</div>' +
      U.field({ id: 'hNote', label: 'Ghi chú bàn giao', html: '<textarea class="inp" id="hNote" rows="2"' + dis + '>' + U.esc(hv.note) + '</textarea>' }) +
      (locked ? '' : '<div class="row-gap mb"><button class="btn btn-primary" data-act="handoverConfirm"><i class="fa-solid fa-check"></i>' + (t.status === 'banggiao' ? 'Cập nhật bàn giao' : 'Xác nhận đã bàn giao') + '</button></div>') +
      (t.status === 'banggiao' ? '<div class="callout ok mb"><i class="fa-solid fa-circle-check"></i><div>Tour đã bàn giao ngày <b>' + U.fdate(hv.date) + '</b> cho <b>' + U.esc(hv.receiver) + '</b>.</div></div>' : '') +
      '<div class="row-gap" style="margin:6px 0 10px"><div class="sec-title" style="margin:0"><i class="fa-solid fa-list-check"></i>Bảng thông tin bàn giao (theo dự trù tour)</div><div style="flex:1"></div>' +
      '<button class="btn btn-sm" data-act="handoverXlsx"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button><button class="btn btn-sm btn-primary" data-act="handoverPrint"><i class="fa-solid fa-print"></i>Xuất file bàn giao</button></div>' +
      '<div class="card" style="box-shadow:none">' + U.table({
        rows: ls, st: { page: 1 }, size: 200, nopager: true, empty: U.empty('list-check', 'Chưa có dịch vụ', 'Danh sách bàn giao lấy từ dự trù tour.'),
        cols: [{ label: 'STT', cls: 'center', render: l => ls.indexOf(l) + 1 },
          { label: 'Nhà cung cấp', render: l => '<div class="cell-main">' + U.esc((C.supplier(l.supplierId) || {}).name || '') + '</div>' },
          { label: 'Nội dung', render: l => U.badge(l.type || '', K.tone(l.type), true) + '<div>' + U.esc(l.service) + '</div>' },
          { label: 'Ngày bắt đầu', render: l => '<span class="nowrap">' + U.fdate(l.from) + '</span>' }, { label: 'Ngày kết thúc', render: l => '<span class="nowrap">' + U.fdate(l.to || l.from) + '</span>' },
          { label: 'SL', cls: 'center', render: l => U.fmt(l.qty) + (l.times > 1 ? '<div class="cell-sub">× ' + l.times + '</div>' : '') },
          { label: 'Đơn giá', cls: 'right', render: l => U.money(l.price) }, { label: 'Thành tiền', cls: 'right', render: l => U.money(C.lineAmount(l)) },
          { label: 'Đã chi', cls: 'right', render: l => U.money(C.linePaid(t.id, l.id)) },
          { label: 'Còn phải chi', cls: 'right', render: l => { const r = C.lineRemain(t, l); return r ? '<b class="money-neg">' + U.money(r) + '</b>' : '<span class="muted">0 ₫</span>'; } },
          { label: 'Thông tin liên hệ', render: l => { const s = C.supplier(l.supplierId) || {}; return U.esc(contactOf(s)) || '—'; } },
          { label: 'Ghi chú', render: l => U.esc(l.note) || '<span class="muted">—</span>' }],
        foot: ls.length ? '<tr><td colspan="7" class="right">Tổng cộng</td><td class="right">' + U.money(sumCost) + '</td><td class="right">' + U.money(sumPaid) + '</td><td class="right">' + U.money(total) + '</td><td colspan="2"></td></tr>' : ''
      }) + '</div>' +
      '<div class="ho-total"><div><div class="muted">Tổng chi phí phải chi cho hướng dẫn viên</div><div class="ho-big">' + U.money(total) + '</div>' +
      '<div class="cell-sub">= tổng “Còn phải chi” của các dịch vụ (đã trừ phần đã chi cho NCC)' + (adv ? ' · Đã tạm ứng cho HDV: <b>' + U.money(adv) + '</b> · Còn cần tạm ứng: <b>' + U.money(need) + '</b>' : '') + '</div></div>' +
      (locked ? '' : '<button class="btn btn-danger" data-act="guideVoucher"><i class="fa-solid fa-circle-minus"></i>Tạo phiếu chi cho hướng dẫn viên</button>') + '</div></div>';
    return h;
  }
  function readHandover() { const g = id => (U.$('#' + id, viewEl) || {}).value || ''; return { date: g('hDate') || U.todayISO(), receiver: g('hReceiver').trim(), phone: g('hPhone').trim(), driverName: g('hDriver').trim(), driverPhone: g('hDriverPhone').trim(), note: g('hNote').trim() }; }
  function handoverRows(t) { return hoLines(t).map((l, i) => { const s = C.supplier(l.supplierId) || {}; return { i: i + 1, s, l, amount: C.lineAmount(l), paid: C.linePaid(t.id, l.id), remain: C.lineRemain(t, l) }; }); }
  function handoverDoc(t, hv) {
    const info = hoInfo(t), rows = handoverRows(t), total = App.sum(rows, r => r.remain);
    const dots = '………………', v = x => U.esc(x) || dots;
    const html = U.docHeader('Mã tour: <b>' + U.esc(t.id) + '</b><br>' + U.docDate(hv.date)) + '<div class="doc-title">Biên bản bàn giao tour</div><div class="doc-sub">Tour ' + U.esc(t.id) + '</div>' +
      '<div class="doc-meta"><div><span>Tên khách / Đoàn:</span> <b>' + v(info.name) + '</b></div><div><span>Số điện thoại:</span> ' + v(info.phone) + '</div>' +
      '<div style="grid-column:1/-1"><span>Tuyến:</span> ' + v(info.route) + '</div><div><span>Ngày bắt đầu:</span> ' + U.fdate(info.start) + '</div><div><span>Ngày kết thúc:</span> ' + U.fdate(info.end) + '</div>' +
      '<div><span>Tên tài xế:</span> ' + v(hv.driverName) + '</div><div><span>Số điện thoại:</span> ' + v(hv.driverPhone) + '</div>' +
      '<div><span>Người nhận bàn giao:</span> <b>' + v(hv.receiver) + '</b></div><div><span>Số điện thoại:</span> ' + v(hv.phone) + '</div></div>' +
      '<div class="doc-note b">Bảng thông tin bàn giao:</div><table class="doc-tbl" style="font-size:11px"><thead><tr><th>STT</th><th>Nhà cung cấp</th><th>Nội dung</th><th>Ngày bắt đầu</th><th>Ngày kết thúc</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th><th>Đã chi</th><th>Còn phải chi</th><th>Thông tin liên hệ</th><th>Ghi chú</th></tr></thead><tbody>' +
      (rows.length ? rows.map(r => '<tr><td class="c">' + r.i + '</td><td>' + U.esc(r.s.name || '') + '</td><td><b>' + U.esc(r.l.type || '') + '</b>: ' + U.esc(r.l.service) + '</td><td class="c">' + U.fdate(r.l.from) + '</td><td class="c">' + U.fdate(r.l.to || r.l.from) + '</td><td class="c">' + U.fmt(r.l.qty) + (r.l.times > 1 ? ' × ' + r.l.times : '') + '</td><td class="r">' + U.fmt(r.l.price) + '</td><td class="r">' + U.fmt(r.amount) + '</td><td class="r">' + U.fmt(r.paid) + '</td><td class="r b">' + U.fmt(r.remain) + '</td><td>' + U.esc(contactOf(r.s)) + '</td><td>' + U.esc(r.l.note) + '</td></tr>').join('') +
        '<tr><td colspan="7" class="r b">Tổng cộng</td><td class="r b">' + U.fmt(App.sum(rows, r => r.amount)) + '</td><td class="r b">' + U.fmt(App.sum(rows, r => r.paid)) + '</td><td class="r b">' + U.fmt(total) + '</td><td colspan="2"></td></tr>' : '<tr><td colspan="12" class="c">Chưa có dịch vụ trong dự trù</td></tr>') + '</tbody></table>' +
      '<div class="doc-box"><span class="doc-big">Tổng chi phí phải chi cho hướng dẫn viên: ' + U.fmt(total) + ' ₫</span><br><i>Bằng chữ: ' + U.numWords(total) + '</i><br><i style="font-size:11px">(Các khoản đã chi một phần cho nhà cung cấp đã được trừ ra; chỉ tính phần còn phải chi.)</i></div>' +
      (hv.note ? '<div class="doc-note"><b>Ghi chú:</b> ' + U.esc(hv.note) + '</div>' : '') +
      '<div class="doc-sign" style="grid-template-columns:1fr 1fr"><div><b>Bên giao (Điều hành tour)</b><i>(Ký, ghi rõ họ tên)</i></div><div><b>Bên nhận (HDV / trưởng đoàn)</b><i>(Ký, ghi rõ họ tên)</i></div></div>';
    U.previewDoc('Bàn giao tour ' + t.id, html, { filename: 'Ban-giao-tour-' + t.id, landscape: true, xlsx: () => handoverXlsx(t, hv) });
  }
  function handoverXlsx(t, hv) {
    const info = hoInfo(t), rows = handoverRows(t), total = App.sum(rows, r => r.remain);
    const data = rows.map(r => [r.i, r.s.name || '', (r.l.type || '') + ': ' + r.l.service, U.fdate(r.l.from), U.fdate(r.l.to || r.l.from), r.l.qty * (r.l.times > 1 ? r.l.times : 1), r.l.price, r.amount, r.paid, r.remain, contactOf(r.s), r.l.note || '']);
    data.push([]); data.push(['', '', 'Tổng chi phí phải chi cho hướng dẫn viên', '', '', '', '', '', '', total]);
    U.exportXlsx({ filename: 'ban-giao-tour-' + t.id, sheet: 'Bàn giao tour', title: 'BIÊN BẢN BÀN GIAO TOUR ' + t.id,
      subtitle: ['Khách/Đoàn: ' + info.name + ' ' + info.phone, 'Tuyến: ' + info.route, U.fdate(info.start) + ' → ' + U.fdate(info.end), 'Tài xế: ' + (hv.driverName || '') + ' ' + (hv.driverPhone || ''), 'Nhận bàn giao: ' + (hv.receiver || '') + ' ' + (hv.phone || '')].join(' · '),
      headers: ['STT', 'Nhà cung cấp', 'Nội dung', 'Ngày bắt đầu', 'Ngày kết thúc', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Đã chi', 'Còn phải chi', 'Thông tin liên hệ', 'Ghi chú'], rows: data, moneyCols: [6, 7, 8, 9] });
  }
  function confirmHandover() {
    const t = tourOf(), hv = readHandover(), box = U.$('[data-f="hReceiver"]', viewEl); U.clearErr(viewEl);
    if (!hv.receiver) { U.invalid(viewEl, 'hReceiver', 'Nhập người nhận bàn giao'); box.querySelector('.inp').focus(); return; }
    t.handover = hv; if (t.status === 'dieuhanh') t.status = 'banggiao';
    Store.save(); refresh(); U.toast('Đã xác nhận bàn giao tour', t.id + ' → ' + hv.receiver);
  }
  function guideVoucher() {
    const t = tourOf(), hv = readHandover(), total = C.tourLinesPayable(t), need = Math.max(0, total - C.guideAdvanced(t));
    if (need <= 0) { U.toast('Không còn khoản cần chi', total > 0 ? 'Đã tạm ứng đủ cho hướng dẫn viên.' : 'Các dịch vụ trong dự trù đã chi đủ cho NCC.', 'info'); return; }
    App.mod.accounting.openVoucherForm({ kind: 'chi', tourId: t.id, expenseType: 'hdv', party: hv.receiver, amount: need, content: 'Chi cho hướng dẫn viên' + (hv.receiver ? ' ' + hv.receiver : '') + ' — bàn giao tour ' + t.id, onSaved: refresh });
  }

  /* =============================================================== ROUTE */
  const mod = {
    title: 'Điều hành tour', group: 'Nghiệp vụ', icon: 'route',
    render(view, args) {
      viewEl = view;
      if (args && args[0]) {
        ds.id = args[0]; ds.tab = ['budget', 'booking', 'summary', 'handover'].includes(args[1]) ? args[1] : 'budget';
        view.onclick = detailClick; view.onchange = null; renderDetail(); return;
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
  function guestsForm() {
    const t = tourOf(); if (!t || t.status === 'quyettoan') return;
    U.modal({
      title: 'Số khách của tour', sub: 'Tour ' + t.id, size: 'sm', static: true,
      body: U.field({ id: 'g', label: 'Số khách', req: true, hint: 'Dùng cho form booking và biên bản bàn giao.', html: U.input({ id: 'g', type: 'number', value: t.guests, attrs: 'min="1" step="1"' }) }),
      foot: [{ label: 'Hủy' }, { label: 'Lưu', cls: 'btn-primary', icon: 'check', onClick: h => {
        U.clearErr(h.body); const n = Number(U.val(h.body, 'g'));
        if (!Number.isInteger(n) || n < 1) { U.invalid(h.body, 'g', 'Nhập số nguyên từ 1 trở lên'); return; }
        t.guests = n; Store.save(); h.close(); refresh(); U.toast('Đã cập nhật số khách', n + ' khách');
      } }]
    });
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
      case 'bookLine': { const l = t.budget.find(x => x.id === id); if (l) openBooking(l.supplierId, id); break; }
      case 'cancelLine': cancelLine(id); break;
      case 'restoreLine': restoreLine(id); break;
      case 'guideVoucher': guideVoucher(); break;
      case 'vPrint': App.mod.accounting.printVoucher(id); break;
      case 'settle': settle(); break;
      case 'reopen': reopen(); break;
      case 'guests': guestsForm(); break;
      case 'handoverConfirm': confirmHandover(); break;
      case 'handoverPrint': handoverDoc(t, t.status === 'quyettoan' || t.handover ? Object.assign({}, t.handover || {}, t.status === 'quyettoan' ? {} : readHandover()) : readHandover()); break;
      case 'handoverXlsx': handoverXlsx(t, t.status === 'quyettoan' ? (t.handover || {}) : readHandover()); break;
    }
  }
  App.mod.operations = mod; App.Router.register('operations', mod);
})();
