/* ============================================================================
 * app.js — Khởi động: menu bên trái (theo đúng 7 hạng mục), tìm kiếm toàn cục,
 * thông báo, giao diện sáng/tối, điều hướng.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store, R = App.Router, $ = U.$;

  const NAV = [
    { group: 'Tổng quan', items: [['dashboard', 'Tổng quan', 'house']] },
    { group: 'Nghiệp vụ', items: [['customers', 'Khách hàng', 'users'], ['orders', 'Đơn hàng', 'file-invoice-dollar'], ['suppliers', 'Nhà cung cấp', 'handshake'], ['operations', 'Điều hành tour', 'route']] },
    { group: 'Tài chính', items: [['accounting', 'Kế toán', 'calculator'], ['reports', 'Báo cáo', 'chart-pie']] },
    { group: 'Quản trị', items: [['system', 'Hệ thống', 'gear']] }
  ];

  /* ------------------------------------------------------------ THÔNG BÁO */
  function alerts() {
    const out = [], today = U.todayISO();
    Store.state.tours.filter(t => t.status !== 'quyettoan').forEach(t => {
      const o = C.order(t.orderId); if (!o) return; const s = C.tourSummary(t), d = U.daysBetween(today, o.start);
      if (o.end < today) out.push({ ico: 'flag-checkered', tone: 'orange', title: 'Tour ' + t.id + ' đã kết thúc, chưa quyết toán', desc: (s.receivable ? 'Còn thu ' + U.money(s.receivable) + '. ' : '') + (s.payable ? 'Còn trả NCC ' + U.money(s.payable) + '.' : ''), go: '#/operations/' + t.id + '/summary' });
      else if (d >= 0 && d <= 7) {
        const unb = t.budget.filter(l => !C.lineBooked(t, l)).length;
        out.push({ ico: 'plane-departure', tone: 'blue', title: 'Tour ' + t.id + ' khởi hành ' + (d === 0 ? 'hôm nay' : 'sau ' + d + ' ngày'), desc: !t.budget.length ? 'Chưa lập dự trù dịch vụ.' : (unb ? unb + ' dịch vụ chưa gửi booking. ' : '') + (s.receivable ? 'Còn thu khách ' + U.money(s.receivable) + '.' : ''), go: '#/operations/' + t.id + (unb ? '/booking' : '') });
      }
    });
    return out;
  }

  /* ------------------------------------------------------------ MENU + CHROME */
  function buildNav() {
    $('#nav').innerHTML = NAV.map(g => '<div class="nav-group">' + g.group + '</div>' + g.items.map(i => '<a class="nav-item" data-nav="' + i[0] + '" href="#/' + i[0] + '"><i class="fa-solid fa-' + i[2] + '"></i><span>' + i[1] + '</span><span class="nav-count" data-cnt="' + i[0] + '" style="display:none"></span></a>').join('')).join('');
  }
  App.alerts = alerts;
  App.refreshChrome = function () {
    const S = Store.state, set = (k, n, alert) => { const e = $('[data-cnt="' + k + '"]'); if (!e) return; e.textContent = n; e.style.display = n ? '' : 'none'; e.classList.toggle('alert', !!alert); };
    set('orders', S.orders.length); set('operations', S.tours.filter(t => t.status !== 'quyettoan').length);
    document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.nav === R.current));
    const n = alerts().length, b = $('#bellCount'); b.textContent = n; b.style.display = n ? '' : 'none';
  };

  /* ---------------------------------------------------- TÌM KIẾM TOÀN CỤC */
  function search(qRaw) {
    const q = U.norm(qRaw), digits = qRaw.replace(/\D/g, ''), S = Store.state, res = [];
    if (!q) return res;
    S.customers.forEach(c => { if (U.norm(c.name).includes(q) || U.norm(c.id).includes(q) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))) res.push({ ico: 'user', t: c.name, s: c.id + ' · ' + c.phone, go: '#/customers', q: c.name }); });
    S.orders.forEach(o => { const cu = C.customer(o.customerId) || {}; if (U.norm(o.id).includes(q) || U.norm(o.serviceName).includes(q) || U.norm(cu.name).includes(q)) res.push({ ico: 'file-invoice-dollar', t: o.id + ' — ' + o.serviceName, s: cu.name, go: '#/orders', q: o.id }); });
    S.tours.forEach(t => { const o = C.order(t.orderId) || {}, cu = C.customer(o.customerId) || {}; if (U.norm(t.id).includes(q) || U.norm(o.serviceName).includes(q)) res.push({ ico: 'route', t: 'Tour ' + t.id, s: (o.serviceName || '') + ' · ' + (cu.name || ''), go: '#/operations/' + t.id }); });
    S.suppliers.forEach(s => { if (U.norm(s.name).includes(q) || U.norm(s.id).includes(q) || U.norm(s.province).includes(q)) res.push({ ico: 'handshake', t: s.name, s: s.id + ' · ' + s.type + ' · ' + s.province, go: '#/suppliers', q: s.name }); });
    S.vouchers.forEach(v => { if (U.norm(v.id).includes(q) || U.norm(v.content).includes(q)) res.push({ ico: 'receipt', t: v.id + ' — ' + U.money(v.amount), s: v.content, go: '#/accounting', q: v.id }); });
    return res.slice(0, 9);
  }
  let found = [];
  function bindGlobalSearch() {
    const inp = $('#globalSearch');
    inp.addEventListener('input', () => {
      found = search(inp.value);
      if (!inp.value.trim()) { U.popClose(); return; }
      const p = U.pop(inp.parentElement, found.length ? found.map((r, i) => '<div class="pop-item" data-gs="' + i + '"><i class="fa-solid fa-' + r.ico + '"></i><span style="min-width:0"><b style="display:block">' + U.esc(r.t) + '</b><span class="cell-sub">' + U.esc(r.s) + '</span></span></div>').join('') : '<div class="pop-label">Không tìm thấy kết quả</div>', { left: true });
      p.style.minWidth = Math.max(320, inp.parentElement.offsetWidth) + 'px';
    });
    $('#pop').addEventListener('click', e => { const it = e.target.closest('[data-gs]'); if (!it) return; const r = found[Number(it.dataset.gs)]; U.popClose(); inp.value = ''; R.go(r.go, r.q || ''); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && found[0]) { const r = found[0]; U.popClose(); inp.value = ''; R.go(r.go, r.q || ''); } });
    document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inp.focus(); inp.select(); } });
  }

  /* --------------------------------------------------------------- GIAO DIỆN */
  function setTheme(t) {
    document.documentElement.dataset.theme = t; try { localStorage.setItem('tourerp.theme', t); } catch (e) { /* noop */ }
    $('#btnTheme').innerHTML = '<i class="fa-solid fa-' + (t === 'dark' ? 'sun' : 'moon') + '"></i>';
  }

  function init() {
    buildNav();
    let th = 'light'; try { th = localStorage.getItem('tourerp.theme') || 'light'; } catch (e) { /* noop */ }
    setTheme(th);
    $('#btnTheme').onclick = () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); R.render(); };
    $('#hamburger').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
    const closeSide = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };
    $('#scrim').onclick = closeSide; $('#sidebarClose').onclick = closeSide;

    $('#btnBell').onclick = e => {
      e.stopPropagation(); const a = alerts();
      U.pop(e.currentTarget, '<div class="pop-label">Cần chú ý (' + a.length + ')</div>' + (a.length ? a.map((x, i) => '<div class="notif-item" data-al="' + i + '"><div class="notif-ico t-' + x.tone + '"><i class="fa-solid fa-' + x.ico + '"></i></div><div><div class="notif-title">' + U.esc(x.title) + '</div><div class="notif-desc">' + U.esc(x.desc) + '</div></div></div>').join('') : '<div class="notif-desc" style="padding:12px">Không có cảnh báo nào.</div>'), { cls: 'pop-notif' });
      $('#pop').onclick = ev => { const it = ev.target.closest('[data-al]'); if (it) { const x = a[Number(it.dataset.al)]; U.popClose(); R.go(x.go); } };
    };
    const userMenu = e => {
      e.stopPropagation();
      const p = U.pop(e.currentTarget, '<div class="pop-label">Tài khoản</div><div class="pop-item" data-m="system"><i class="fa-solid fa-gear"></i>Cài đặt hệ thống</div><div class="pop-item" data-m="data"><i class="fa-solid fa-database"></i>Sao lưu dữ liệu</div><div class="pop-sep"></div><div class="pop-item" data-m="theme"><i class="fa-solid fa-circle-half-stroke"></i>Đổi giao diện sáng/tối</div>');
      p.onclick = ev => { const it = ev.target.closest('[data-m]'); if (!it) return; U.popClose(); if (it.dataset.m === 'system') R.go('#/system'); else if (it.dataset.m === 'data') R.go('#/system/data'); else $('#btnTheme').click(); };
    };
    $('#topUser').onclick = userMenu; $('#sideUser').onclick = userMenu;
    bindGlobalSearch();

    R.start = () => { window.addEventListener('hashchange', R.render); if (!location.hash) location.hash = '#/dashboard'; else R.render(); };
    R.start();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
