/* ============================================================================
 * app.js — Khởi động: menu bên trái (theo đúng 7 hạng mục), tìm kiếm toàn cục,
 * thông báo, giao diện sáng/tối, điều hướng.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store, R = App.Router, $ = U.$;

  const NAV = [
    { group: 'Tổng quan', items: [['dashboard', 'Tổng quan', 'house']] },
    { group: 'Nghiệp vụ', items: [['customers', 'Khách hàng', 'users'], ['orders', 'Đơn hàng', 'file-invoice-dollar'], ['suppliers', 'Nhà cung cấp', 'handshake'], ['operations', 'Điều hành tour', 'route'], ['pricing', 'Tính giá tour', 'coins']] },
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
    // Hạn thanh toán NCC (trong 3 ngày tới hoặc đã quá hạn)
    Store.state.tours.filter(t => t.status !== 'quyettoan').forEach(t => t.budget.forEach(l => {
      const d = C.lineDue(t, l); if (!d.due || d.remain <= 0) return; const left = U.daysBetween(today, d.due);
      if (left > 3) return; const sp = C.supplier(l.supplierId) || {};
      out.push({ ico: 'money-bill-wave', tone: left < 0 ? 'red' : 'orange', title: (left < 0 ? 'Quá hạn thanh toán NCC ' : 'Sắp đến hạn thanh toán NCC ') + (sp.name || '') + ' — Tour ' + t.id, desc: 'Còn ' + U.money(d.remain) + ' · hạn ' + U.fdate(d.due), go: '#/operations/' + t.id + '/budget' });
    }));
    return out;
  }

  /* ------------------------------------------------------------ MENU + CHROME */
  function buildNav() {
    const admin = App.Auth.isAdmin();
    $('#nav').innerHTML = NAV.map(g => {
      const items = g.items.filter(i => i[0] !== 'system' || admin); if (!items.length) return '';
      return '<div class="nav-group">' + g.group + '</div>' + items.map(i => '<a class="nav-item" data-nav="' + i[0] + '" href="#/' + i[0] + '"><i class="fa-solid fa-' + i[2] + '"></i><span>' + i[1] + '</span><span class="nav-count" data-cnt="' + i[0] + '" style="display:none"></span></a>').join('');
    }).join('');
  }
  const initials = n => { const w = String(n || '?').trim().split(/\s+/); return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase(); };
  function renderUser() {
    const u = App.Auth.current(); if (!u) return;
    $('.side-user-name').textContent = u.name; $('.side-user-role').textContent = App.Auth.roleLabel(u.role);
    $('.top-user-name').textContent = u.name; $('.top-user-role').textContent = App.Auth.roleLabel(u.role);
    $('#sideUser .avatar').textContent = initials(u.name);
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
    S.customers.forEach(c => { if (U.norm(c.name).includes(q) || U.norm(c.id).includes(q) || U.norm(c.taxCode).includes(q) || (digits.length >= 3 && [c.phone, c.contactPhone].some(x => String(x || '').replace(/\D/g, '').includes(digits)))) res.push({ ico: 'user', t: c.name, s: c.id + ' · ' + c.phone, go: '#/customers', q: c.name }); });
    S.orders.forEach(o => { const cu = C.customer(o.customerId) || {}; if (U.norm(o.id).includes(q) || U.norm(o.serviceName).includes(q) || U.norm(cu.name).includes(q)) res.push({ ico: 'file-invoice-dollar', t: o.id + ' — ' + o.serviceName, s: cu.name, go: '#/orders', q: o.id }); });
    S.tours.forEach(t => { const o = C.order(t.orderId) || {}, cu = C.customer(o.customerId) || {}; if (U.norm(t.id).includes(q) || U.norm(o.serviceName).includes(q)) res.push({ ico: 'route', t: 'Tour ' + t.id, s: (o.serviceName || '') + ' · ' + (cu.name || ''), go: '#/operations/' + t.id }); });
    S.suppliers.forEach(s => { if (U.norm(s.name).includes(q) || U.norm(s.id).includes(q) || U.norm(s.province).includes(q)) res.push({ ico: 'handshake', t: s.name, s: s.id + ' · ' + s.type + ' · ' + s.province, go: '#/suppliers', q: s.name }); });
    (S.quotes || []).forEach(x => { if (U.norm(x.id).includes(q) || U.norm(x.route).includes(q)) res.push({ ico: 'coins', t: x.id + ' — Báo giá ' + x.route, s: [x.duration, x.standard, x.guests + ' khách'].filter(Boolean).join(' · '), go: '#/pricing/' + x.id }); });
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

  /* ------------------------------------------------- ĐĂNG NHẬP / ĐĂNG XUẤT */
  let started = false;
  /* ---------------------------------------------- MÀN HÌNH CHỜ / TRẠNG THÁI KIO */
  const showLoading = t => { $('#blText').textContent = t || 'Đang tải dữ liệu…'; $('#bootLoading').classList.add('show'); };
  const hideLoading = () => $('#bootLoading').classList.remove('show');
  function setConn(i) {
    const el = $('#lgConn'), retry = $('#lgRetry'); if (!el) return;
    const T = App.TourAPI.info(); i = i || T;
    const map = { online: ['ok', 'circle-check', 'Đã kết nối máy chủ KIO'], local: ['warn', 'hard-drive', 'Chế độ cục bộ: dữ liệu chỉ lưu trên trình duyệt này (chưa nạp được thư viện KIO)'],
      offline: ['warn', 'plug-circle-xmark', 'Không kết nối được máy chủ KIO — đang dùng dữ liệu lưu trên máy này'], connecting: ['', 'spinner fa-spin', 'Đang kết nối máy chủ KIO…'] };
    const m = map[i.mode] || map.local;
    el.className = 'lg-conn ' + m[0]; el.querySelector('i').className = 'fa-solid fa-' + m[1]; el.querySelector('span').textContent = m[2]; el.title = i.lastError || '';
    retry.style.display = (i.mode === 'offline' || i.mode === 'local') ? '' : 'none';
    $('#lgBtn').disabled = i.mode === 'connecting';
  }
  function renderPill(i) {
    const pill = $('#syncPill'); if (!pill) return;
    const M = { synced: ['ok', 'cloud', 'Đã đồng bộ'], syncing: ['busy', 'rotate fa-spin', 'Đang đồng bộ…'], waiting: ['warn', 'cloud-arrow-up', 'Chờ gửi (' + i.pending + ')'], error: ['bad', 'triangle-exclamation', 'Lỗi đồng bộ'],
      offline: ['bad', 'plug-circle-xmark', 'Offline'], local: ['', 'hard-drive', 'Cục bộ'], connecting: ['busy', 'spinner fa-spin', 'Đang kết nối…'] };
    const m = M[i.status] || M.local;
    pill.className = 'sync-pill ' + m[0]; pill.querySelector('i').className = 'fa-solid fa-' + m[1]; pill.querySelector('.sp-text').textContent = m[2];
    pill.title = (i.lastError ? i.lastError + '\n' : '') + (i.lastSync ? 'Đồng bộ lần cuối: ' + U.fdatetime(i.lastSync) : 'Bấm để đồng bộ ngay');
    if ($('body').classList.contains('locked')) setConn(i);
  }
  // Máy chủ KIO còn trống: để quản trị viên chọn nguồn dữ liệu khởi tạo (không tự đẩy dữ liệu mẫu lên máy chủ)
  function chooseInit(user) {
    const T = App.TourAPI;
    return new Promise(res => {
      if (user.role !== 'admin') { T.initServer('blank'); U.toast('Máy chủ chưa có dữ liệu', 'Đã khởi tạo dữ liệu trống. Quản trị viên có thể nạp dữ liệu mẫu ở Hệ thống.', 'info'); res(); return; }
      const hasLocal = !T.localIsDemo(); let chosen = false;
      const opt = (v, t, d) => '<label class="init-opt"><input type="radio" name="initc" value="' + v + '"><span><b>' + t + '</b><small>' + d + '</small></span></label>';
      U.modal({
        title: 'Máy chủ KIO chưa có dữ liệu', sub: 'Chọn cách khởi tạo dữ liệu cho hệ thống', size: 'md', static: true, noFocus: true,
        body: '<div class="callout mb"><i class="fa-solid fa-circle-info"></i><div>Các bảng <b>tnk_tour_*</b> đang trống. Dữ liệu bạn chọn sẽ được <b>đẩy lên máy chủ</b> và dùng chung cho mọi người đăng nhập.</div></div><div class="init-opts" data-f="initc">' +
          (hasLocal ? opt('local', 'Dùng dữ liệu đang có trong trình duyệt này', 'Đưa khách hàng, đơn hàng, tour… đã nhập trên máy này lên máy chủ.') : '') +
          opt('demo', 'Nạp dữ liệu mẫu', 'Phù hợp để chạy thử, đào tạo. Có thể xóa sau ở Hệ thống.') + opt('blank', 'Bắt đầu với dữ liệu trống', 'Chỉ giữ danh mục dịch vụ và tài khoản ngân hàng mặc định.') + '<div class="err"></div></div>',
        foot: [{ label: 'Khởi tạo', cls: 'btn-primary', icon: 'cloud-arrow-up', onClick: h => {
          const c = h.body.querySelector('input[name="initc"]:checked'); U.clearErr(h.body);
          if (!c) { U.invalid(h.body, 'initc', 'Vui lòng chọn một cách khởi tạo'); return; }
          chosen = true; h.close(); showLoading('Đang khởi tạo dữ liệu trên máy chủ…'); T.initServer(c.value).then(() => { hideLoading(); res(); });
        } }],
        onClose: () => { if (!chosen) { U.toast('Chưa khởi tạo dữ liệu trên máy chủ', 'Thay đổi tạm thời chỉ lưu trên máy này. Đăng nhập lại để chọn cách khởi tạo.', 'warning'); res(); } }
      });
    });
  }
  async function enterApp(user, fresh) {
    document.body.classList.remove('locked');
    buildNav(); renderUser();
    showLoading('Đang tải dữ liệu từ máy chủ…');
    let r = {}; try { r = await App.TourAPI.loadData(); } catch (e) { r = {}; }
    hideLoading();
    if (r.empty) await chooseInit(user);
    if (!started) { started = true; window.addEventListener('hashchange', () => { if (App.Auth.current()) R.render(); else lockApp(); }); }
    buildNav(); renderUser();
    if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/dashboard'; else R.render();
    if (r.mode === 'offline') U.toast('Đang dùng dữ liệu lưu trên máy', App.TourAPI.info().lastError || 'Không kết nối được máy chủ KIO.', 'warning');
    if (fresh) {
      U.toast('Xin chào, ' + user.name, 'Bạn đang đăng nhập với vai trò ' + App.Auth.roleLabel(user.role) + '.', 'success');
      if (user.mustChange) setTimeout(() => App.Auth.openChangePassword(true), 400);
    }
  }
  function lockApp(msg) {
    App.Auth.logout(); U.popClose(); U.destroyCharts();
    document.body.classList.add('locked'); $('#view').innerHTML = ''; document.title = 'Đăng nhập — TNK Travel & Tour ERP';
    if (App.Auth.resetLogin) App.Auth.resetLogin();
    if (msg) U.toast(msg, '', 'info');
  }
  // Tự khóa khi phiên hết hạn (kiểm tra mỗi phút) hoặc bị đăng xuất ở tab khác
  setInterval(() => { if (!document.body.classList.contains('locked') && !App.Auth.current()) lockApp('Phiên đăng nhập đã hết hạn'); }, 60000);
  window.addEventListener('storage', e => { if (e.key === 'tourerp.session' && !App.Auth.current() && !document.body.classList.contains('locked')) lockApp('Bạn đã đăng xuất'); });

  function init() {
    let th = 'light'; try { th = localStorage.getItem('tourerp.theme') || 'light'; } catch (e) { /* noop */ }
    setTheme(th);
    $('#btnTheme').onclick = () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); if (App.Auth.current()) R.render(); };
    $('#hamburger').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
    const closeSide = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };
    $('#scrim').onclick = closeSide; $('#sidebarClose').onclick = closeSide;

    $('#btnBell').onclick = e => {
      e.stopPropagation(); const a = alerts();
      U.pop(e.currentTarget, '<div class="pop-label">Cần chú ý (' + a.length + ')</div>' + (a.length ? a.map((x, i) => '<div class="notif-item" data-al="' + i + '"><div class="notif-ico t-' + x.tone + '"><i class="fa-solid fa-' + x.ico + '"></i></div><div><div class="notif-title">' + U.esc(x.title) + '</div><div class="notif-desc">' + U.esc(x.desc) + '</div></div></div>').join('') : '<div class="notif-desc" style="padding:12px">Không có cảnh báo nào.</div>'), { cls: 'pop-notif' });
      $('#pop').onclick = ev => { const it = ev.target.closest('[data-al]'); if (it) { const x = a[Number(it.dataset.al)]; U.popClose(); R.go(x.go); } };
    };
    const userMenu = e => {
      e.stopPropagation(); const u = App.Auth.current(); if (!u) return; const admin = u.role === 'admin';
      const p = U.pop(e.currentTarget, '<div class="pop-label">' + U.esc(u.name) + ' · ' + App.Auth.roleLabel(u.role) + '</div>' +
        '<div class="pop-item" data-m="pw"><i class="fa-solid fa-key"></i>Đổi mật khẩu</div>' +
        (admin ? '<div class="pop-item" data-m="users"><i class="fa-solid fa-user-shield"></i>Quản lý người dùng</div><div class="pop-item" data-m="system"><i class="fa-solid fa-gear"></i>Cài đặt hệ thống</div><div class="pop-item" data-m="data"><i class="fa-solid fa-database"></i>Sao lưu dữ liệu</div>' : '') +
        '<div class="pop-item" data-m="theme"><i class="fa-solid fa-circle-half-stroke"></i>Đổi giao diện sáng/tối</div><div class="pop-sep"></div>' +
        '<div class="pop-item" data-m="logout" style="color:var(--red)"><i class="fa-solid fa-right-from-bracket" style="color:var(--red)"></i>Đăng xuất</div>');
      p.onclick = ev => {
        const it = ev.target.closest('[data-m]'); if (!it) return; U.popClose(); const m = it.dataset.m;
        if (m === 'pw') App.Auth.openChangePassword(false); else if (m === 'system') R.go('#/system'); else if (m === 'data') R.go('#/system/data'); else if (m === 'users') R.go('#/system/users');
        else if (m === 'theme') $('#btnTheme').click();
        else if (m === 'logout') U.confirm({ title: 'Đăng xuất', message: 'Bạn muốn đăng xuất khỏi hệ thống?', ok: 'Đăng xuất', icon: 'right-from-bracket' }).then(ok => { if (ok) { history.replaceState(null, '', location.pathname); lockApp(); } });
      };
    };
    $('#topUser').onclick = userMenu; $('#sideUser').onclick = userMenu;
    bindGlobalSearch();

    App.Auth.bindLogin(u => enterApp(u, true));
    App.TourAPI.onStatus(renderPill); renderPill(App.TourAPI.info());
    $('#syncPill').onclick = async () => {
      const T = App.TourAPI, i = T.info();
      if (i.mode === 'local') { U.toast('Chế độ cục bộ', 'Chưa nạp được thư viện KIO (list.js / krud.js). Kiểm tra kết nối mạng rồi tải lại trang.', 'info'); return; }
      const changed = await T.syncNow(); if (T.info().status === 'synced' && !changed) U.toast('Đã đồng bộ', 'Dữ liệu trên máy và máy chủ đã khớp.', 'success');
    };
    $('#lgRetry').onclick = async () => { setConn({ mode: 'connecting' }); const i = await App.TourAPI.reconnect(); setConn(i); };

    // Kết nối KIO trước (để lấy danh sách người dùng chung), rồi mới cho đăng nhập / khôi phục phiên
    const hadSession = !!App.Auth.current();
    if (hadSession) showLoading('Đang kết nối máy chủ KIO…');
    setConn({ mode: 'connecting' });
    App.TourAPI.connect().then(async i => {
      setConn(i); hideLoading();
      const me = App.Auth.current();
      if (me) await enterApp(me, false); else lockApp();
    });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
