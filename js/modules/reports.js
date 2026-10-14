/* ============================================================================
 * Phân hệ 6 — BÁO CÁO
 * Tổng quan, doanh thu, lợi nhuận, dòng tiền, quỹ. Xuất dữ liệu; lọc theo mốc
 * thời gian. Quy ước: doanh thu & lợi nhuận tính theo NGÀY TẠO ĐƠN; dòng tiền
 * và quỹ tính theo NGÀY LẬP PHIẾU thu/chi.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store;
  const st = { tab: 'overview', from: '', to: '', view: 'order', preset: 'year' };
  let host, exp = null;
  const COL = { blue: '#2563eb', green: '#15a34a', red: '#dc2626', orange: '#ea6a0c', teal: '#0d9488', indigo: '#5b48d6', slate: '#64748b' };
  const PAL = [COL.blue, COL.teal, COL.orange, COL.indigo, COL.green, COL.red, COL.slate];

  function applyPreset(p) {
    const d = new Date(), y = d.getFullYear(), m = d.getMonth(), iso = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    st.preset = p;
    if (p === 'month') { st.from = iso(new Date(y, m, 1)); st.to = iso(new Date(y, m + 1, 0)); }
    else if (p === 'quarter') { const q = Math.floor(m / 3) * 3; st.from = iso(new Date(y, q, 1)); st.to = iso(new Date(y, q + 3, 0)); }
    else if (p === 'year') { st.from = y + '-01-01'; st.to = y + '-12-31'; }
    else { st.from = ''; st.to = ''; }
  }
  const inR = d => (!st.from || d >= st.from) && (!st.to || d <= st.to);
  const orders = () => Store.state.orders.filter(o => inR(o.date));
  const vouchers = () => Store.state.vouchers.filter(v => inR(v.date));
  const period = () => (st.from || st.to) ? (st.from ? U.fdate(st.from) : '…') + ' → ' + (st.to ? U.fdate(st.to) : '…') : 'Toàn bộ thời gian';
  const months = keys => Array.from(new Set(keys)).filter(Boolean).sort();
  const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';

  function tbl(cols, rows, foot) { return '<div class="card" style="box-shadow:none"><div class="tbl-wrap">' + U.table({ rows, st: { page: 1 }, size: 1000, nopager: true, cols, foot, empty: U.empty('chart-column', 'Không có dữ liệu', 'Không có số liệu trong khoảng thời gian đã chọn.') }) + '</div></div>'; }
  const num = (label, f, extra) => Object.assign({ label, cls: 'right', render: r => U.money(f(r)) }, extra || {});
  const canvas = id => '<div class="chart-box"><canvas id="' + id + '"></canvas></div>';
  const moneyAxis = { ticks: { callback: v => U.compactMoney(v) } };

  /* ---- số liệu theo đơn / tour */
  function orderRows() {
    return orders().map(o => { const t = C.tour(o.id), cost = t ? C.tourCost(t) : 0, rev = C.total(o); return { o, t, cu: C.customer(o.customerId) || {}, gross: C.gross(o), disc: C.discount(o), rev, paid: C.orderPaid(o.id), cost, profit: rev - cost }; });
  }

  /* ================================================================ TỔNG QUAN */
  function tabOverview() {
    const rs = orderRows(), vs = vouchers();
    const rev = App.sum(rs, r => r.rev), cost = App.sum(rs, r => r.cost), profit = rev - cost;
    const thu = App.sum(vs.filter(v => v.kind === 'thu'), v => v.amount), chi = App.sum(vs.filter(v => v.kind === 'chi'), v => v.amount);
    const fund = App.sum(Store.state.settings.accounts, a => C.accountFlow(a.id, '', st.to).close);
    const recv = App.sum(rs, r => Math.max(0, r.rev - r.paid)), pay = App.sum(rs.filter(r => r.t), r => C.tourSummary(r.t).payable);
    const today = U.todayISO(), soon = Store.state.tours.filter(t => { const o = C.order(t.orderId); return t.status !== 'quyettoan' && o && o.start >= today; }).sort((a, b) => C.order(a.orderId).start.localeCompare(C.order(b.orderId).start)).slice(0, 5);
    const topC = {}; rs.forEach(r => { topC[r.cu.name || '—'] = (topC[r.cu.name || '—'] || 0) + r.rev; });
    const top = Object.keys(topC).map(k => ({ name: k, v: topC[k] })).sort((a, b) => b.v - a.v).slice(0, 5);
    exp = { filename: 'bao-cao-tong-quan', sheet: 'Tổng quan', title: 'BÁO CÁO TỔNG QUAN', subtitle: period(), headers: ['Chỉ tiêu', 'Giá trị (₫)'], moneyCols: [1],
      rows: [['Doanh thu', rev], ['Chi phí dịch vụ (dự trù)', cost], ['Lợi nhuận', profit], ['Tổng thu (phiếu thu)', thu], ['Tổng chi (phiếu chi)', chi], ['Số dư quỹ cuối kỳ', fund], ['Công nợ phải thu khách', recv], ['Công nợ phải trả NCC', pay], ['Số đơn hàng', rs.length]] };
    let h = '<div class="kpi-row">' + U.mkpi({ icon: 'sack-dollar', tone: 'indigo', label: 'Doanh thu', value: U.money(rev), sub: rs.length + ' đơn hàng' }) +
      U.mkpi({ icon: 'receipt', tone: 'orange', label: 'Chi phí dịch vụ', value: U.money(cost) }) +
      U.mkpi({ icon: 'chart-line', tone: profit >= 0 ? 'green' : 'red', label: 'Lợi nhuận', value: U.signed(profit), sub: 'Biên ' + pct(profit, rev) }) +
      U.mkpi({ icon: 'vault', tone: 'blue', label: 'Số dư quỹ', value: U.money(fund) }) +
      U.mkpi({ icon: 'arrow-trend-up', tone: 'green', label: 'Tổng thu', value: U.money(thu) }) + U.mkpi({ icon: 'arrow-trend-down', tone: 'red', label: 'Tổng chi', value: U.money(chi) }) +
      U.mkpi({ icon: 'hand-holding-dollar', tone: 'teal', label: 'Phải thu khách', value: U.money(recv) }) + U.mkpi({ icon: 'truck-ramp-box', tone: 'slate', label: 'Phải trả NCC', value: U.money(pay) }) + '</div>';
    h += '<div class="grid g-21 mb"><div class="card"><div class="card-head"><h3>Doanh thu – Chi phí – Lợi nhuận theo tháng</h3></div><div class="card-body">' + canvas('chOv1') + '</div></div>' +
      '<div class="card"><div class="card-head"><h3>Cơ cấu doanh thu theo dịch vụ</h3></div><div class="card-body">' + canvas('chOv2') + '</div></div></div>';
    h += '<div class="grid g-2"><div class="card"><div class="card-head"><h3>Top khách hàng theo doanh thu</h3></div>' + (top.length ? '<div class="tbl-wrap"><table class="tbl" style="min-width:0"><tbody>' + top.map((x, i) => '<tr><td class="center" style="width:40px">' + (i + 1) + '</td><td class="cell-main">' + U.esc(x.name) + '</td><td class="right"><b>' + U.money(x.v) + '</b></td></tr>').join('') + '</tbody></table></div>' : '<div class="card-body muted">Chưa có dữ liệu.</div>') + '</div>' +
      '<div class="card"><div class="card-head"><h3>Tour sắp khởi hành</h3></div>' + (soon.length ? '<div class="tbl-wrap"><table class="tbl" style="min-width:0"><tbody>' + soon.map(t => { const o = C.order(t.orderId); return '<tr class="clickable" onclick="App.Router.go(\'#/operations/' + t.id + '\')"><td class="code">' + t.id + '</td><td><div class="cell-main">' + U.esc(o.serviceName) + '</div><div class="cell-sub">' + U.esc((C.customer(o.customerId) || {}).name || '') + '</div></td><td class="right nowrap">' + U.fdate(o.start) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="card-body muted">Không có tour sắp khởi hành.</div>') + '</div></div>';
    return { html: h, after() {
      const ms = months(rs.map(r => U.monthKey(r.o.date))), by = k => rs.filter(r => U.monthKey(r.o.date) === k);
      U.chart(U.$('#chOv1'), { type: 'bar', data: { labels: ms.map(U.monthLabel), datasets: [
        { label: 'Doanh thu', data: ms.map(k => App.sum(by(k), r => r.rev)), backgroundColor: COL.blue, borderRadius: 5 }, { label: 'Chi phí', data: ms.map(k => App.sum(by(k), r => r.cost)), backgroundColor: COL.orange, borderRadius: 5 },
        { label: 'Lợi nhuận', type: 'line', data: ms.map(k => App.sum(by(k), r => r.profit)), borderColor: COL.green, backgroundColor: COL.green, tension: .3 }] }, options: { scales: { y: moneyAxis }, plugins: { legend: { position: 'bottom' } } } });
      const sv = {}; rs.forEach(r => { sv[r.o.serviceName] = (sv[r.o.serviceName] || 0) + r.rev; });
      U.chart(U.$('#chOv2'), { type: 'doughnut', data: { labels: Object.keys(sv), datasets: [{ data: Object.values(sv), backgroundColor: PAL }] }, options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } } });
    } };
  }

  /* ================================================================ DOANH THU */
  function tabRevenue() {
    const rs = orderRows(); let cols, rows, foot, headers, data;
    if (st.view === 'order') {
      rows = rs; cols = [{ label: 'Mã đơn', render: r => '<span class="code">' + r.o.id + '</span>' }, { label: 'Ngày tạo', render: r => U.fdate(r.o.date) }, { label: 'Khách hàng', render: r => U.esc(r.cu.name || '') }, { label: 'Dịch vụ', render: r => U.esc(r.o.serviceName) },
        num('Thành tiền', r => r.gross), num('Giảm giá / HH', r => r.disc), num('Doanh thu', r => r.rev, { render: r => '<b>' + U.money(r.rev) + '</b>' }), num('Đã thu', r => r.paid), num('Còn phải thu', r => Math.max(0, r.rev - r.paid))];
      foot = rows.length ? '<tr><td colspan="4" class="right">Tổng cộng</td>' + [r => r.gross, r => r.disc, r => r.rev, r => r.paid, r => Math.max(0, r.rev - r.paid)].map(f => '<td class="right">' + U.money(App.sum(rows, f)) + '</td>').join('') + '</tr>' : '';
      headers = ['Mã đơn', 'Ngày tạo', 'Khách hàng', 'Dịch vụ', 'Thành tiền', 'Giảm giá / HH', 'Doanh thu', 'Đã thu', 'Còn phải thu'];
      data = rows.map(r => [r.o.id, U.fdate(r.o.date), r.cu.name || '', r.o.serviceName, r.gross, r.disc, r.rev, r.paid, Math.max(0, r.rev - r.paid)]);
    } else {
      const key = st.view === 'service' ? r => r.o.serviceName : r => r.cu.name || '—', m = {};
      rs.forEach(r => { const k = key(r), x = m[k] = m[k] || { name: k, n: 0, gross: 0, disc: 0, rev: 0, paid: 0 }; x.n++; x.gross += r.gross; x.disc += r.disc; x.rev += r.rev; x.paid += r.paid; });
      rows = Object.values(m).sort((a, b) => b.rev - a.rev); const lab = st.view === 'service' ? 'Dịch vụ' : 'Khách hàng';
      cols = [{ label: lab, render: r => '<span class="cell-main">' + U.esc(r.name) + '</span>' }, { label: 'Số đơn', cls: 'center', render: r => r.n }, num('Thành tiền', r => r.gross), num('Giảm giá / HH', r => r.disc), num('Doanh thu', r => r.rev, { render: r => '<b>' + U.money(r.rev) + '</b>' }), num('Đã thu', r => r.paid)];
      foot = rows.length ? '<tr><td class="right">Tổng cộng</td><td class="center">' + App.sum(rows, r => r.n) + '</td>' + [r => r.gross, r => r.disc, r => r.rev, r => r.paid].map(f => '<td class="right">' + U.money(App.sum(rows, f)) + '</td>').join('') + '</tr>' : '';
      headers = [lab, 'Số đơn', 'Thành tiền', 'Giảm giá / HH', 'Doanh thu', 'Đã thu']; data = rows.map(r => [r.name, r.n, r.gross, r.disc, r.rev, r.paid]);
    }
    const mc = st.view === 'order' ? [4, 5, 6, 7, 8] : [2, 3, 4, 5];
    exp = { filename: 'bao-cao-doanh-thu', sheet: 'Doanh thu', title: 'BÁO CÁO DOANH THU', subtitle: period(), headers, rows: data, moneyCols: mc };
    const h = '<div class="row-gap mb"><div class="field" style="margin:0"><label>Xem theo</label><select class="inp" id="rView"><option value="order">Đơn hàng</option><option value="service">Dịch vụ</option><option value="customer">Khách hàng</option></select></div></div>' +
      '<div class="card mb"><div class="card-head"><h3>Doanh thu theo tháng</h3></div><div class="card-body">' + canvas('chRv') + '</div></div>' + tbl(cols, rows, foot);
    return { html: h, after() {
      U.$('#rView').value = st.view; const ms = months(rs.map(r => U.monthKey(r.o.date)));
      U.chart(U.$('#chRv'), { type: 'bar', data: { labels: ms.map(U.monthLabel), datasets: [{ label: 'Doanh thu', data: ms.map(k => App.sum(rs.filter(r => U.monthKey(r.o.date) === k), r => r.rev)), backgroundColor: COL.indigo, borderRadius: 5 }] }, options: { scales: { y: moneyAxis }, plugins: { legend: { display: false } } } });
    } };
  }

  /* ================================================================ LỢI NHUẬN */
  function tabProfit() {
    const rs = orderRows().filter(r => r.t), rev = App.sum(rs, r => r.rev), cost = App.sum(rs, r => r.cost);
    const cols = [{ label: 'Mã tour', render: r => '<span class="code">' + r.o.id + '</span>' }, { label: 'Dịch vụ', render: r => U.esc(r.o.serviceName) + '<div class="cell-sub">' + U.esc(r.cu.name || '') + '</div>' }, { label: 'Ngày tạo', render: r => U.fdate(r.o.date) },
      num('Doanh thu', r => r.rev), num('Chi phí dịch vụ', r => r.cost), num('Lợi nhuận', r => r.profit, { render: r => '<b>' + U.signed(r.profit) + '</b>' }), { label: 'Biên LN', cls: 'right', render: r => pct(r.profit, r.rev) },
      { label: 'Trạng thái', render: r => U.badge(App.CONST.TOUR_STATUS[r.t.status].label, App.CONST.TOUR_STATUS[r.t.status].tone) }];
    const foot = rs.length ? '<tr><td colspan="3" class="right">Tổng cộng</td><td class="right">' + U.money(rev) + '</td><td class="right">' + U.money(cost) + '</td><td class="right">' + U.signed(rev - cost) + '</td><td class="right">' + pct(rev - cost, rev) + '</td><td></td></tr>' : '';
    exp = { filename: 'bao-cao-loi-nhuan', sheet: 'Lợi nhuận', title: 'BÁO CÁO LỢI NHUẬN THEO TOUR', subtitle: period() + ' · Lợi nhuận = Doanh thu − Chi phí dự trù', headers: ['Mã tour', 'Dịch vụ', 'Khách hàng', 'Ngày tạo', 'Doanh thu', 'Chi phí dịch vụ', 'Lợi nhuận', 'Biên LN', 'Trạng thái'],
      rows: rs.map(r => [r.o.id, r.o.serviceName, r.cu.name || '', U.fdate(r.o.date), r.rev, r.cost, r.profit, pct(r.profit, r.rev), App.CONST.TOUR_STATUS[r.t.status].label]), moneyCols: [4, 5, 6] };
    return { html: '<div class="callout mb"><i class="fa-solid fa-circle-info"></i><div>Lợi nhuận = Doanh thu đơn hàng − Chi phí dịch vụ trong dự trù tour. Lợi nhuận <b>thực tế bằng tiền</b> xem ở báo cáo Dòng tiền.</div></div><div class="card mb"><div class="card-head"><h3>Lợi nhuận theo tour</h3></div><div class="card-body">' + canvas('chPf') + '</div></div>' + tbl(cols, rs, foot),
      after() { U.chart(U.$('#chPf'), { type: 'bar', data: { labels: rs.map(r => r.o.id), datasets: [{ label: 'Lợi nhuận', data: rs.map(r => r.profit), backgroundColor: rs.map(r => r.profit >= 0 ? COL.green : COL.red), borderRadius: 5 }] }, options: { scales: { y: moneyAxis }, plugins: { legend: { display: false } } } }); } };
  }

  /* ================================================================ DÒNG TIỀN */
  function tabCash() {
    const vs = vouchers(), ms = months(vs.map(v => U.monthKey(v.date))); let run = 0;
    const rows = ms.map(k => { const a = vs.filter(v => U.monthKey(v.date) === k), thu = App.sum(a.filter(v => v.kind === 'thu'), v => v.amount), chi = App.sum(a.filter(v => v.kind === 'chi'), v => v.amount); run += thu - chi; return { k, thu, chi, net: thu - chi, run, n: a.length }; });
    const cols = [{ label: 'Tháng', render: r => '<b>' + U.monthLabel(r.k) + '</b>' }, { label: 'Số phiếu', cls: 'center', render: r => r.n }, num('Tổng thu', r => r.thu), num('Tổng chi', r => r.chi), num('Dòng tiền ròng', r => r.net, { render: r => '<b>' + U.signed(r.net) + '</b>' }), num('Lũy kế', r => r.run)];
    const foot = rows.length ? '<tr><td class="right">Tổng cộng</td><td class="center">' + App.sum(rows, r => r.n) + '</td><td class="right">' + U.money(App.sum(rows, r => r.thu)) + '</td><td class="right">' + U.money(App.sum(rows, r => r.chi)) + '</td><td class="right">' + U.signed(App.sum(rows, r => r.net)) + '</td><td></td></tr>' : '';
    exp = { filename: 'bao-cao-dong-tien', sheet: 'Dòng tiền', title: 'BÁO CÁO DÒNG TIỀN', subtitle: period(), headers: ['Tháng', 'Số phiếu', 'Tổng thu', 'Tổng chi', 'Dòng tiền ròng', 'Lũy kế'], rows: rows.map(r => [U.monthLabel(r.k), r.n, r.thu, r.chi, r.net, r.run]), moneyCols: [2, 3, 4, 5] };
    return { html: '<div class="card mb"><div class="card-head"><h3>Thu – chi theo tháng</h3></div><div class="card-body">' + canvas('chCf') + '</div></div>' + tbl(cols, rows, foot),
      after() { U.chart(U.$('#chCf'), { type: 'bar', data: { labels: rows.map(r => U.monthLabel(r.k)), datasets: [{ label: 'Thu', data: rows.map(r => r.thu), backgroundColor: COL.green, borderRadius: 5 }, { label: 'Chi', data: rows.map(r => r.chi), backgroundColor: COL.red, borderRadius: 5 }, { label: 'Lũy kế', type: 'line', data: rows.map(r => r.run), borderColor: COL.blue, backgroundColor: COL.blue, tension: .3 }] }, options: { scales: { y: moneyAxis }, plugins: { legend: { position: 'bottom' } } } }); } };
  }

  /* ===================================================================== QUỸ */
  function tabFund() {
    const rows = Store.state.settings.accounts.map(a => Object.assign({ a }, C.accountFlow(a.id, st.from, st.to)));
    const kinds = { company: 0, personal: 0 }; rows.forEach(r => { kinds[r.a.kind] += r.close; });
    const cols = [{ label: 'Tài khoản', render: r => '<div class="cell-main">' + U.esc(r.a.bank) + ' · ' + U.esc(r.a.number) + '</div><div class="cell-sub">' + U.esc(r.a.holder) + '</div>' }, { label: 'Loại', render: r => r.a.kind === 'company' ? U.badge('Công ty', 'blue', true) : U.badge('Cá nhân', 'indigo', true) },
      num('Số dư đầu kỳ', r => r.open), num('Thu trong kỳ', r => r.thu), num('Chi trong kỳ', r => r.chi), num('Số dư cuối kỳ', r => r.close, { render: r => '<b>' + U.money(r.close) + '</b>' })];
    const foot = rows.length ? '<tr><td colspan="2" class="right">Tổng quỹ</td>' + [r => r.open, r => r.thu, r => r.chi, r => r.close].map(f => '<td class="right">' + U.money(App.sum(rows, f)) + '</td>').join('') + '</tr>' : '';
    exp = { filename: 'bao-cao-quy', sheet: 'Quỹ', title: 'BÁO CÁO QUỸ', subtitle: period(), headers: ['Ngân hàng', 'Số tài khoản', 'Chủ tài khoản', 'Loại', 'Số dư đầu kỳ', 'Thu trong kỳ', 'Chi trong kỳ', 'Số dư cuối kỳ'], rows: rows.map(r => [r.a.bank, r.a.number, r.a.holder, App.CONST.ACCOUNT_KINDS[r.a.kind], r.open, r.thu, r.chi, r.close]), moneyCols: [4, 5, 6, 7] };
    return { html: '<div class="kpi-row">' + U.mkpi({ icon: 'building', tone: 'blue', label: 'Quỹ tài khoản công ty', value: U.money(kinds.company) }) + U.mkpi({ icon: 'user', tone: 'indigo', label: 'Quỹ tài khoản cá nhân', value: U.money(kinds.personal) }) + U.mkpi({ icon: 'vault', tone: 'green', label: 'Tổng quỹ', value: U.money(kinds.company + kinds.personal) }) + '</div>' +
      '<div class="card mb"><div class="card-head"><h3>Số dư cuối kỳ theo tài khoản</h3></div><div class="card-body">' + canvas('chFd') + '</div></div>' + tbl(cols, rows, foot),
      after() { U.chart(U.$('#chFd'), { type: 'bar', data: { labels: rows.map(r => r.a.bank), datasets: [{ label: 'Số dư cuối kỳ', data: rows.map(r => r.close), backgroundColor: rows.map(r => r.a.kind === 'company' ? COL.blue : COL.indigo), borderRadius: 5 }] }, options: { scales: { y: moneyAxis }, plugins: { legend: { display: false } } } }); } };
  }

  const TABS = [{ key: 'overview', label: 'Tổng quan', icon: 'gauge-high', fn: tabOverview }, { key: 'revenue', label: 'Doanh thu', icon: 'sack-dollar', fn: tabRevenue }, { key: 'profit', label: 'Lợi nhuận', icon: 'chart-line', fn: tabProfit },
    { key: 'cash', label: 'Dòng tiền', icon: 'money-bill-transfer', fn: tabCash }, { key: 'fund', label: 'Quỹ', icon: 'vault', fn: tabFund }];

  function draw() {
    U.destroyCharts();
    const t = TABS.find(x => x.key === st.tab) || TABS[0], r = t.fn();
    U.$('#rpTabs', host).innerHTML = U.tabs(TABS, st.tab); U.$('#rpBody', host).innerHTML = r.html; if (r.after) r.after();
    U.$('#rpPeriod', host).textContent = period();
    ['month', 'quarter', 'year', 'all'].forEach(p => U.$('[data-preset="' + p + '"]', host).classList.toggle('btn-primary', st.preset === p));
    U.$('#rFrom', host).value = st.from; U.$('#rTo', host).value = st.to;
  }

  const mod = {
    title: 'Báo cáo', group: 'Tài chính', icon: 'chart-pie',
    render(view, args) {
      host = view; if (args && TABS.find(t => t.key === args[0])) st.tab = args[0]; else st.tab = 'overview';
      if (!st.from && !st.to && st.preset !== 'all') applyPreset(st.preset);
      view.innerHTML = '<div class="page-head"><div><h1>Báo cáo</h1><p>Kỳ báo cáo: <b id="rpPeriod"></b></p></div><div class="page-head-actions"><button class="btn btn-primary" id="rpExport"><i class="fa-solid fa-file-excel"></i>Xuất dữ liệu</button></div></div>' +
        '<div class="card"><div class="filter-bar"><div class="field"><label>Từ ngày</label><input class="inp" type="date" id="rFrom"></div><div class="field"><label>Đến ngày</label><input class="inp" type="date" id="rTo"></div>' +
        '<div class="preset"><button class="btn btn-sm" data-preset="month">Tháng này</button><button class="btn btn-sm" data-preset="quarter">Quý này</button><button class="btn btn-sm" data-preset="year">Năm nay</button><button class="btn btn-sm" data-preset="all">Tất cả</button></div></div>' +
        '<div id="rpTabs"></div><div class="tab-pane" id="rpBody"></div></div>';
      view.onclick = e => {
        const tb = e.target.closest('[data-tab]'); if (tb) { st.tab = tb.dataset.tab; history.replaceState(null, '', '#/reports/' + st.tab); draw(); return; }
        const p = e.target.closest('[data-preset]'); if (p) { applyPreset(p.dataset.preset); draw(); }
      };
      view.onchange = e => {
        if (e.target.id === 'rFrom' || e.target.id === 'rTo') { st.from = U.$('#rFrom', view).value; st.to = U.$('#rTo', view).value; if (st.from && st.to && st.from > st.to) { U.toast('Khoảng thời gian không hợp lệ', '“Từ ngày” phải trước “Đến ngày”.', 'warning'); return; } st.preset = ''; draw(); }
        else if (e.target.id === 'rView') { st.view = e.target.value; draw(); }
      };
      U.$('#rpExport', view).onclick = () => { if (exp) U.exportXlsx(exp); };
      draw();
    }
  };
  App.mod.reports = mod; App.Router.register('reports', mod);
})();
