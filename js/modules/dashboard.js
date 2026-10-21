/* ============================================================================
 * TỔNG QUAN — trang mở đầu: 3 thẻ KPI, doanh thu theo tháng, tình trạng đơn.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store;
  const pad = n => String(n).padStart(2, '0');
  const short = v => { const a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(1).replace('.', ',').replace(',0', '') + ' Tỷ'; if (a >= 1e6) return Math.round(v / 1e6).toLocaleString('vi-VN') + 'Tr'; return U.fmt(v); };
  const trend = (a, b, unit) => {
    if (!b) return a > 0 ? '<i class="fa-solid fa-arrow-up"></i> Mới phát sinh' : '—';
    const p = Math.round((a - b) / b * 100); return '<i class="fa-solid fa-arrow-' + (p >= 0 ? 'up' : 'down') + '"></i> ' + Math.abs(p) + '%<span>so với tháng trước</span>';
  };

  // “Xem chi tiết” ở ô Đơn hàng: danh sách các đơn mới (tạo trong tháng này; nếu chưa có thì 5 đơn gần nhất)
  function newOrders(kThis) {
    const S = Store.state, srt = a => a.slice().sort((x, y) => (y.date + y.id).localeCompare(x.date + x.id));
    let rows = srt(S.orders.filter(o => U.monthKey(o.date) === kThis)), note = 'Các đơn tạo trong tháng ' + U.monthLabel(kThis) + '.';
    if (!rows.length) { rows = srt(S.orders).slice(0, 5); note = 'Tháng này chưa có đơn mới — hiển thị ' + rows.length + ' đơn gần nhất.'; }
    const body = '<p class="muted" style="margin:0 0 10px;font-size:12.8px">' + note + ' Bấm vào một đơn để xem chi tiết.</p>' + (rows.length ? '<div class="tbl-wrap"><table class="tbl tbl-stack" style="min-width:560px"><thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Dịch vụ</th><th>Ngày tạo</th><th class="right">Phải thu</th><th>Thu tiền</th></tr></thead><tbody>' +
      rows.map(o => { const c = C.customer(o.customerId) || {}, s = C.orderStatus(o); return '<tr class="clickable" data-oid="' + U.esc(o.id) + '"><td data-label="Mã đơn"><span class="code">' + U.esc(o.id) + '</span></td><td data-label="Khách hàng"><div class="td-v">' + U.esc(c.name || '—') + '</div></td><td data-label="Dịch vụ"><div class="td-v">' + U.esc(o.serviceName) + '</div></td><td data-label="Ngày tạo"><div class="td-v">' + U.fdate(o.date) + '</div></td><td data-label="Phải thu" class="right"><div class="td-v"><b>' + U.money(C.total(o)) + '</b></div></td><td data-label="Thu tiền"><div class="td-v">' + U.badge(s.label, s.tone) + '</div></td></tr>'; }).join('') + '</tbody></table></div>' : U.empty('file-circle-xmark', 'Chưa có đơn hàng', ''));
    U.modal({ title: 'Đơn hàng mới', sub: rows.length + ' đơn', size: 'lg', body,
      onMount: h => { h.body.onclick = e => { const tr = e.target.closest('[data-oid]'); if (tr) { const id = tr.dataset.oid; h.close(); App.mod.orders.openView(id); } }; },
      foot: [{ label: 'Mở danh sách đơn hàng', icon: 'list', left: true, onClick: h => { h.close(); App.Router.go('#/orders'); } }, { label: 'Đóng' }] });
  }

  const mod = {
    title: 'Tổng quan', group: 'Tổng quan', icon: 'house',
    render(view) {
      const S = Store.state, now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
      const kThis = y + '-' + pad(m), kPrev = m === 1 ? (y - 1) + '-12' : y + '-' + pad(m - 1);
      const inM = (o, k) => U.monthKey(o.date) === k, rev = k => App.sum(S.orders.filter(o => inM(o, k)), C.total), cnt = k => S.orders.filter(o => inM(o, k)).length;
      const activeCust = new Set(S.orders.filter(o => inM(o, kThis)).map(o => o.customerId)).size;
      const today = U.todayISO(), soon = S.tours.filter(t => { const o = C.order(t.orderId); return t.status !== 'quyettoan' && o && o.end >= today; })
        .sort((a, b) => C.order(a.orderId).start.localeCompare(C.order(b.orderId).start)).slice(0, 5);
      const al = App.alerts ? App.alerts().slice(0, 5) : [];
      view.innerHTML = '<div class="page-head"><div><h1>Tổng quan</h1><p>Tháng ' + m + '/' + y + ' · tính theo ngày tạo đơn hàng</p></div></div>' +
        '<div class="kcards">' +
        '<div class="kcard green"><div class="kc-label">Doanh thu</div><div class="kc-value" title="' + U.money(rev(kThis)) + '">' + short(rev(kThis)) + '</div><div class="kc-trend">' + trend(rev(kThis), rev(kPrev)) + '</div><i class="fa-solid fa-sack-dollar kc-bg"></i></div>' +
        '<div class="kcard blue"><div class="kc-label">Đơn hàng</div><div class="kc-value">' + U.fmt(cnt(kThis)) + '</div><div class="kc-trend">' + trend(cnt(kThis), cnt(kPrev)) + '</div><button type="button" class="kc-more" data-more="orders">Xem chi tiết <i class="fa-solid fa-arrow-right"></i></button><i class="fa-solid fa-file-invoice-dollar kc-bg"></i></div>' +
        '<div class="kcard orange"><div class="kc-label">Khách hàng</div><div class="kc-value">' + U.fmt(S.customers.length) + '</div><div class="kc-trend"><i class="fa-solid fa-user-check"></i> ' + activeCust + '<span>khách có đơn trong tháng</span></div><i class="fa-solid fa-users kc-bg"></i></div></div>' +
        '<div class="dash-grid"><div class="card"><div class="card-head"><h3>Doanh thu theo tháng</h3></div><div class="card-body"><div class="chart-box"><canvas id="dLine"></canvas></div></div></div>' +
        '<div class="card"><div class="card-head"><h3>Tình trạng đơn hàng</h3></div><div class="card-body"><div class="chart-box"><canvas id="dPie"></canvas></div></div></div></div>' +
        '<div class="dash-grid two"><div class="card"><div class="card-head"><h3>Tour sắp khởi hành</h3></div>' +
        (soon.length ? '<ul class="dash-list">' + soon.map(t => { const o = C.order(t.orderId), d = U.daysBetween(today, o.start); return '<li data-go="#/operations/' + t.id + '"><div class="ico t-blue"><i class="fa-solid fa-route"></i></div><div style="flex:1;min-width:0"><div class="cell-main">' + t.id + ' · ' + U.esc(o.serviceName) + '</div><div class="cell-sub">' + U.esc((C.customer(o.customerId) || {}).name || '') + ' · ' + t.guests + ' khách</div></div><div class="nowrap">' + U.fdate(o.start) + '<div class="cell-sub" style="text-align:right">' + (d <= 0 ? 'Đang diễn ra' : 'Còn ' + d + ' ngày') + '</div></div></li>'; }).join('') + '</ul>' : '<div class="card-body muted">Không có tour sắp khởi hành.</div>') + '</div>' +
        '<div class="card"><div class="card-head"><h3>Cần chú ý</h3></div>' + (al.length ? '<ul class="dash-list">' + al.map(a => '<li data-go="' + a.go + '"><div class="ico t-' + a.tone + '"><i class="fa-solid fa-' + a.ico + '"></i></div><div><div class="cell-main">' + U.esc(a.title) + '</div><div class="cell-sub">' + U.esc(a.desc) + '</div></div></li>').join('') + '</ul>' : '<div class="card-body muted">Không có cảnh báo nào.</div>') + '</div></div>';
      view.onclick = e => {
        if (e.target.closest('[data-more="orders"]')) { newOrders(kThis); return; }
        const li = e.target.closest('[data-go]'); if (li) App.Router.go(li.dataset.go);
      };
      // biểu đồ đường: doanh thu theo tháng trong năm
      const labels = [], data = [];
      for (let i = 1; i <= m; i++) { labels.push('T' + i); data.push(Math.round(rev(y + '-' + pad(i)) / 1e6)); }
      const cv = U.$('#dLine'), g = cv.getContext('2d').createLinearGradient(0, 0, 0, 260); g.addColorStop(0, 'rgba(37,99,235,.28)'); g.addColorStop(1, 'rgba(37,99,235,0)');
      U.chart(cv, { type: 'line', data: { labels, datasets: [{ label: 'Doanh thu (triệu ₫)', data, borderColor: '#2563eb', backgroundColor: g, fill: true, tension: .35, pointRadius: 4, pointBackgroundColor: '#2563eb', borderWidth: 2.5 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + U.fmt(c.parsed.y) + ' triệu ₫' } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v } } } } });
      const st = { full: 0, part: 0, none: 0 }; S.orders.forEach(o => { st[C.orderStatus(o).key]++; });
      U.chart(U.$('#dPie'), { type: 'doughnut', data: { labels: ['Đã thu đủ', 'Thu một phần', 'Chưa thu'], datasets: [{ data: [st.full, st.part, st.none], backgroundColor: ['#2f6fe4', '#f59e0b', '#8ab4ff'], borderWidth: 2, borderColor: '#fff' }] },
        options: { cutout: '58%', plugins: { legend: { position: 'right', labels: { usePointStyle: true, padding: 14, generateLabels: ch => ch.data.labels.map((l, i) => ({ text: l + ' (' + ch.data.datasets[0].data[i] + ')', fillStyle: ch.data.datasets[0].backgroundColor[i], strokeStyle: ch.data.datasets[0].backgroundColor[i], pointStyle: 'circle', index: i })) } } } } });
    }
  };
  App.mod.dashboard = mod; App.Router.register('dashboard', mod);
})();
