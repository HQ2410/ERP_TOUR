/* ============================================================================
 * Phân hệ 7 — HỆ THỐNG
 * Cài đặt, chỉnh sửa, thêm, bớt các dịch vụ; tài khoản ngân hàng (cá nhân /
 * công ty); thông tin công ty (in chứng từ, API gửi email); sao lưu dữ liệu.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store, K = App.CONST;
  let host, tab = 'services';
  const TABS = [{ key: 'services', label: 'Danh mục dịch vụ', icon: 'tags' }, { key: 'settings', label: 'Cài đặt', icon: 'sliders' }, { key: 'accounts', label: 'Tài khoản ngân hàng', icon: 'building-columns' }, { key: 'users', label: 'Người dùng', icon: 'user-shield' }, { key: 'company', label: 'Thông tin công ty', icon: 'building' }, { key: 'data', label: 'Dữ liệu & sao lưu', icon: 'database' }];
  const draw = () => { U.$('#syTabs', host).innerHTML = U.tabs(TABS, tab); const b = U.$('#syBody', host); b.innerHTML = ({ services: paneServices, settings: paneSettings, accounts: paneAccounts, users: paneUsers, company: paneCompany, data: paneData }[tab])(); };

  /* ------------------------------------------------------------- DỊCH VỤ */
  function paneServices() {
    const list = Store.state.settings.services;
    return '<div class="toolbar"><div class="muted" style="font-size:12.8px">Danh mục dùng khi tạo đơn hàng (đơn giá nhập trực tiếp trên từng đơn, không cố định theo dịch vụ). Có thể thêm, sửa, ngừng sử dụng hoặc xóa dịch vụ.</div><div class="spacer"></div><button class="btn btn-primary btn-sm" data-act="addSvc"><i class="fa-solid fa-plus"></i>Thêm dịch vụ</button></div>' +
      U.table({ rows: list.slice().reverse(), st: { page: 1 }, size: 500, nopager: true, empty: U.empty('tags', 'Chưa có dịch vụ', 'Thêm dịch vụ để bắt đầu tạo đơn hàng.'),
        cols: [{ label: 'Mã', render: s => '<span class="code">' + s.id + '</span>' }, { label: 'Tên dịch vụ', render: s => '<span class="cell-main">' + U.esc(s.name) + '</span>' }, { label: 'Nhóm', render: s => U.badge(s.group, 'slate', true) }, { label: 'Đơn vị', render: s => U.esc(s.unit) },
          { label: 'Số đơn', cls: 'center', render: s => Store.state.orders.filter(o => o.serviceId === s.id).length },
          { label: 'Trạng thái', render: s => '<button class="btn btn-xs" data-act="toggleSvc" data-id="' + s.id + '">' + (s.active ? U.badge('Đang dùng', 'green') : U.badge('Ngừng', 'slate')) + '</button>' },
          { label: '', cls: 'right', render: s => '<div class="row-actions">' + U.iconBtn('editSvc', s.id, 'pen', 'Sửa') + U.iconBtn('delSvc', s.id, 'trash', 'Xóa') + '</div>' }] });
  }
  function svcForm(id) {
    const s = id ? C.service(id) : null;
    U.modal({ title: s ? 'Sửa dịch vụ ' + s.id : 'Thêm dịch vụ', size: 'md', static: true,
      body: U.field({ id: 'name', label: 'Tên dịch vụ', req: true, html: U.input({ id: 'name', value: s ? s.name : '' }) }) + '<div class="form-grid">' +
        U.field({ id: 'group', label: 'Nhóm dịch vụ', req: true, html: U.select({ id: 'group', value: s ? s.group : K.SERVICE_GROUPS[0], options: K.SERVICE_GROUPS.map(g => ({ v: g, l: g })) }) }) +
        U.field({ id: 'unit', label: 'Đơn vị tính', req: true, html: U.input({ id: 'unit', value: s ? s.unit : 'khách', ph: 'khách, vé, ngày…' }) }) + '</div>',
      foot: [{ label: 'Hủy' }, { label: s ? 'Lưu thay đổi' : 'Thêm dịch vụ', icon: 'check', cls: 'btn-primary', onClick: h => {
        const b = h.body; U.clearErr(b); let ok = true; const d = { name: U.val(b, 'name'), group: U.val(b, 'group'), unit: U.val(b, 'unit') };
        if (!d.name) ok = U.invalid(b, 'name', 'Nhập tên dịch vụ'); else if (Store.state.settings.services.some(x => U.norm(x.name) === U.norm(d.name) && (!s || x.id !== s.id))) ok = U.invalid(b, 'name', 'Dịch vụ này đã tồn tại');
        if (!d.unit) ok = U.invalid(b, 'unit', 'Nhập đơn vị');
        if (!ok) { U.focusFirstInvalid(b); return; }
        if (s) { Object.assign(s, d); } else Store.state.settings.services.push(Object.assign({ id: Store.nextId('DV', 2), active: true }, d));
        Store.save(); h.close(); draw(); U.toast(s ? 'Đã cập nhật dịch vụ' : 'Đã thêm dịch vụ', d.name);
      } }] });
  }


  /* ------------------------------------------------------------- CÀI ĐẶT */
  const typeUse = name => ({ sup: Store.state.suppliers.filter(x => x.type === name).length, lines: Store.state.tours.reduce((n, t) => n + t.budget.filter(l => l.type === name).length, 0) });
  function paneSettings() {
    const types = Store.state.settings.serviceTypes;
    return '<div class="tab-pane" style="max-width:760px"><div class="sec-title"><i class="fa-solid fa-sliders"></i>Loại hình dịch vụ</div>' +
      '<div class="muted" style="font-size:12.8px;margin-bottom:12px">Danh sách này dùng cho loại hình của nhà cung cấp và ô “Tên dịch vụ” khi lập dự trù tour (Lưu trú, Vận chuyển, Nhà hàng, Hướng dẫn viên, Vé tham quan…). Loại hình đang được sử dụng thì không xóa được.</div>' +
      '<div class="row-gap mb" style="flex-wrap:nowrap"><input class="inp" id="newType" placeholder="Tên loại hình mới, VD: Visa, Bảo hiểm…" maxlength="40" style="flex:1;min-width:0"><button class="btn btn-primary" data-act="addType"><i class="fa-solid fa-plus"></i>Thêm loại hình</button></div><div class="field" data-f="newType"><div class="err"></div></div>' +
      U.table({ rows: types.map(n => Object.assign({ n }, typeUse(n))), st: { page: 1 }, size: 200, nopager: true, empty: U.empty('tags', 'Chưa có loại hình', 'Thêm loại hình dịch vụ đầu tiên.'),
        cols: [{ label: 'Loại hình dịch vụ', render: r => U.badge(r.n, K.tone(r.n), true) }, { label: 'Số NCC', cls: 'center', render: r => r.sup }, { label: 'Dòng dự trù', cls: 'center', render: r => r.lines },
          { label: '', cls: 'right', render: r => '<div class="row-actions">' + U.iconBtn('delType', r.n, 'trash', r.sup || r.lines ? 'Đang được sử dụng' : 'Xóa loại hình') + '</div>' }] }) + '</div>';
  }
  function addType() {
    const inp = U.$('#newType', host), name = inp.value.trim().replace(/\s+/g, ' ');
    U.clearErr(host);
    if (name.length < 2) { U.invalid(host, 'newType', 'Nhập tên loại hình (tối thiểu 2 ký tự)'); return; }
    if (Store.state.settings.serviceTypes.some(x => U.norm(x) === U.norm(name))) { U.invalid(host, 'newType', 'Loại hình “' + name + '” đã tồn tại'); return; }
    Store.state.settings.serviceTypes.push(name); Store.save(); draw(); U.toast('Đã thêm loại hình dịch vụ', name);
  }
  async function delType(name) {
    const u = typeUse(name);
    if (u.sup || u.lines) { U.toast('Không thể xóa', '“' + name + '” đang dùng cho ' + u.sup + ' nhà cung cấp và ' + u.lines + ' dòng dự trù.', 'warning'); return; }
    if (!(await U.confirm({ title: 'Xóa loại hình dịch vụ', message: 'Xóa loại hình <b>' + U.esc(name) + '</b>?', ok: 'Xóa', danger: true }))) return;
    Store.state.settings.serviceTypes = Store.state.settings.serviceTypes.filter(x => x !== name); Store.save(); draw(); U.toast('Đã xóa loại hình dịch vụ', name);
  }

  /* ------------------------------------------------------------ NGƯỜI DÙNG */
  function paneUsers() {
    const A = App.Auth, me = A.current();
    return '<div class="toolbar"><div class="muted" style="font-size:12.8px">Tài khoản đăng nhập hệ thống. <b>Quản trị viên</b>: toàn quyền. <b>Nhân viên</b>: dùng mọi phân hệ nghiệp vụ, tài chính, trừ mục Hệ thống.</div><div class="spacer"></div><button class="btn btn-primary btn-sm" data-act="addUser"><i class="fa-solid fa-user-plus"></i>Thêm người dùng</button></div>' +
      U.table({ rows: A.users(), st: { page: 1 }, size: 200, nopager: true,
        cols: [{ label: 'Tên đăng nhập', render: u => '<span class="code">' + U.esc(u.username) + '</span>' + (me && me.id === u.id ? ' ' + U.badge('Bạn', 'blue', true) : '') },
          { label: 'Họ tên', render: u => '<span class="cell-main">' + U.esc(u.name) + '</span>' }, { label: 'Vai trò', render: u => u.role === 'admin' ? U.badge('Quản trị viên', 'indigo') : U.badge('Nhân viên', 'slate') },
          { label: 'Trạng thái', render: u => (u.active ? U.badge('Hoạt động', 'green') : U.badge('Đã khóa', 'red')) + (u.mustChange ? '<div class="cell-sub">Chưa đổi mật khẩu</div>' : '') },
          { label: 'Đăng nhập gần nhất', render: u => u.lastLogin ? U.fdatetime(u.lastLogin) : '<span class="muted">Chưa đăng nhập</span>' },
          { label: '', cls: 'right', render: u => '<div class="row-actions">' + U.iconBtn('editUser', u.id, 'pen', 'Sửa') + U.iconBtn('resetUser', u.id, 'key', 'Đặt lại mật khẩu') + U.iconBtn('toggleUser', u.id, u.active ? 'lock' : 'lock-open', u.active ? 'Khóa tài khoản' : 'Mở khóa') + U.iconBtn('delUser', u.id, 'trash', 'Xóa') + '</div>' }] });
  }
  function userForm(id) {
    const A = App.Auth, u = id ? A.users().find(x => x.id === id) : null;
    U.modal({ title: u ? 'Sửa người dùng ' + u.username : 'Thêm người dùng', size: 'md', static: true,
      body: '<div class="form-grid">' + U.field({ id: 'username', label: 'Tên đăng nhập', req: true, hint: u ? 'Không đổi được' : 'Chữ thường, số, dấu . hoặc _ (3–30 ký tự)', html: U.input({ id: 'username', value: u ? u.username : '', attrs: (u ? 'disabled ' : '') + 'autocapitalize="none" autocomplete="off"' }) }) +
        U.field({ id: 'name', label: 'Họ tên', req: true, html: U.input({ id: 'name', value: u ? u.name : '' }) }) +
        U.field({ id: 'role', label: 'Vai trò', req: true, html: U.select({ id: 'role', value: u ? u.role : 'staff', options: [{ v: 'staff', l: 'Nhân viên' }, { v: 'admin', l: 'Quản trị viên' }] }) }) +
        (u ? '<div></div>' : U.field({ id: 'password', label: 'Mật khẩu tạm', req: true, hint: 'Người dùng sẽ được nhắc đổi sau lần đăng nhập đầu', html: U.input({ id: 'password', type: 'password', attrs: 'autocomplete="new-password"' }) })) + '</div>',
      foot: [{ label: 'Hủy' }, { label: u ? 'Lưu thay đổi' : 'Thêm người dùng', icon: 'check', cls: 'btn-primary', onClick: h => {
        const b = h.body; U.clearErr(b);
        const e = u ? A.updateUser(u.id, { name: U.val(b, 'name'), role: U.val(b, 'role') }) : A.addUser({ username: U.val(b, 'username'), name: U.val(b, 'name'), role: U.val(b, 'role'), password: b.querySelector('#password').value });
        if (e) { U.invalid(b, /đăng nhập|Tên/.test(e) ? 'username' : /Mật khẩu|mật khẩu/.test(e) ? 'password' : /họ tên/.test(e) ? 'name' : 'role', e); return; }
        h.close(); draw(); U.toast(u ? 'Đã cập nhật người dùng' : 'Đã thêm người dùng', U.val(b, 'name')); if (App.refreshChrome) App.refreshChrome();
      } }] });
  }
  function resetForm(id) {
    const A = App.Auth, u = A.users().find(x => x.id === id);
    U.modal({ title: 'Đặt lại mật khẩu', sub: u.name + ' · ' + u.username, size: 'sm', static: true,
      body: U.field({ id: 'pw', label: 'Mật khẩu mới (tạm thời)', req: true, hint: 'Người dùng sẽ được nhắc đổi mật khẩu ở lần đăng nhập tiếp theo', html: U.input({ id: 'pw', type: 'password', attrs: 'autocomplete="new-password"' }) }),
      foot: [{ label: 'Hủy' }, { label: 'Đặt lại', icon: 'key', cls: 'btn-primary', onClick: h => {
        const b = h.body; U.clearErr(b); const e = A.checkPassword(b.querySelector('#pw').value); if (e) { U.invalid(b, 'pw', e); return; }
        A.setPassword(id, b.querySelector('#pw').value, true); h.close(); draw(); U.toast('Đã đặt lại mật khẩu', u.username);
      } }] });
  }

  /* ------------------------------------------------------------ TÀI KHOẢN */
  function paneAccounts() {
    return '<div class="toolbar"><div class="muted" style="font-size:12.8px">Tài khoản được chọn khi lập phiếu thu / phiếu chi (bắt buộc chọn cá nhân hoặc công ty).</div><div class="spacer"></div><button class="btn btn-primary btn-sm" data-act="addAcc"><i class="fa-solid fa-plus"></i>Thêm tài khoản</button></div>' +
      U.table({ rows: Store.state.settings.accounts, st: { page: 1 }, size: 100, nopager: true, empty: U.empty('building-columns', 'Chưa có tài khoản', 'Thêm tài khoản ngân hàng công ty hoặc cá nhân.'),
        cols: [{ label: 'Mã', render: a => '<span class="code">' + a.id + '</span>' }, { label: 'Loại', render: a => a.kind === 'company' ? U.badge('Công ty', 'blue') : U.badge('Cá nhân', 'indigo') }, { label: 'Ngân hàng', render: a => '<span class="cell-main">' + U.esc(a.bank) + '</span>' },
          { label: 'Số tài khoản', render: a => U.esc(a.number) }, { label: 'Chủ tài khoản', render: a => U.esc(a.holder) }, { label: 'Số dư đầu kỳ', cls: 'right', render: a => U.money(a.opening) }, { label: 'Số dư hiện tại', cls: 'right', render: a => '<b>' + U.money(C.accountBalance(a.id)) + '</b>' },
          { label: '', cls: 'right', render: a => '<div class="row-actions">' + U.iconBtn('editAcc', a.id, 'pen', 'Sửa') + U.iconBtn('delAcc', a.id, 'trash', 'Xóa') + '</div>' }] });
  }
  function accForm(id) {
    const a = id ? C.account(id) : null;
    U.modal({ title: a ? 'Sửa tài khoản ' + a.id : 'Thêm tài khoản ngân hàng', size: 'md', static: true,
      body: '<div class="form-grid">' + U.field({ id: 'kind', label: 'Loại tài khoản', req: true, html: U.select({ id: 'kind', value: a ? a.kind : 'company', options: [{ v: 'company', l: 'Tài khoản công ty' }, { v: 'personal', l: 'Tài khoản cá nhân' }] }) }) +
        U.field({ id: 'bank', label: 'Ngân hàng', req: true, html: U.input({ id: 'bank', value: a ? a.bank : '', ph: 'VD: Vietcombank' }) }) +
        U.field({ id: 'number', label: 'Số tài khoản', req: true, html: U.input({ id: 'number', value: a ? a.number : '', attrs: 'inputmode="numeric"' }) }) +
        U.field({ id: 'holder', label: 'Chủ tài khoản', req: true, html: U.input({ id: 'holder', value: a ? a.holder : '' }) }) + '</div>' +
        U.field({ id: 'opening', label: 'Số dư đầu kỳ (₫)', html: U.input({ id: 'opening', money: true, value: a ? a.opening : 0 }) }),
      foot: [{ label: 'Hủy' }, { label: a ? 'Lưu thay đổi' : 'Thêm tài khoản', icon: 'check', cls: 'btn-primary', onClick: h => {
        const b = h.body; U.clearErr(b); let ok = true; const d = { kind: U.val(b, 'kind'), bank: U.val(b, 'bank'), number: U.val(b, 'number').replace(/\s/g, ''), holder: U.val(b, 'holder'), opening: U.money$(b, 'opening') };
        if (!d.bank) ok = U.invalid(b, 'bank', 'Nhập tên ngân hàng'); if (!/^\d{6,20}$/.test(d.number)) ok = U.invalid(b, 'number', 'Số tài khoản gồm 6–20 chữ số');
        else if (Store.state.settings.accounts.some(x => x.bank === d.bank && x.number === d.number && (!a || x.id !== a.id))) ok = U.invalid(b, 'number', 'Tài khoản này đã tồn tại');
        if (!d.holder) ok = U.invalid(b, 'holder', 'Nhập chủ tài khoản'); if (!ok) { U.focusFirstInvalid(b); return; }
        if (a) Object.assign(a, d); else Store.state.settings.accounts.push(Object.assign({ id: Store.nextId('TK', 2) }, d));
        Store.save(); h.close(); draw(); U.toast(a ? 'Đã cập nhật tài khoản' : 'Đã thêm tài khoản', d.bank + ' · ' + d.number);
      } }] });
  }

  /* -------------------------------------------------------------- CÔNG TY */
  function paneCompany() {
    const c = Store.state.settings.company, api = Store.state.settings.mailApi;
    return '<div class="tab-pane" style="max-width:820px"><div class="sec-title"><i class="fa-solid fa-building"></i>Thông tin công ty (hiển thị trên chứng từ in / PDF)</div><div class="form-grid">' +
      U.field({ id: 'cName', label: 'Tên công ty', req: true, html: U.input({ id: 'cName', value: c.name }) }) + U.field({ id: 'cRep', label: 'Người đại diện', html: U.input({ id: 'cRep', value: c.representative }) }) +
      U.field({ id: 'cPhone', label: 'Điện thoại', html: U.input({ id: 'cPhone', value: c.phone }) }) + U.field({ id: 'cEmail', label: 'Email', html: U.input({ id: 'cEmail', type: 'email', value: c.email }) }) +
      U.field({ id: 'cTax', label: 'Mã số thuế', html: U.input({ id: 'cTax', value: c.taxCode }) }) + '<div></div></div>' + U.field({ id: 'cAddr', label: 'Địa chỉ', html: U.input({ id: 'cAddr', value: c.address }) }) +
      '<div class="sec-title" style="margin-top:18px"><i class="fa-solid fa-envelope"></i>Gửi booking cho NCC</div>' +
      U.field({ id: 'mailApi', label: 'URL API gửi email (tuỳ chọn)', hint: 'Để trống: hệ thống mở ứng dụng email của bạn. Nếu nhập URL, nút “Gửi Booking” sẽ POST JSON {to, cc, subject, text, tourId, supplierId, lines[]} tới URL này để máy chủ gửi email.', html: U.input({ id: 'mailApi', value: api, ph: 'https://your-server/api/send-booking' }) }) +
      '<button class="btn btn-primary" data-act="saveCompany"><i class="fa-solid fa-check"></i>Lưu thông tin</button></div>';
  }
  function saveCompany() {
    U.clearErr(host); const g = id => U.val(host, id), api = g('mailApi');
    if (!g('cName')) { U.invalid(host, 'cName', 'Nhập tên công ty'); return; }
    if (g('cEmail') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g('cEmail'))) { U.invalid(host, 'cEmail', 'Email không hợp lệ'); return; }
    if (api && !/^https?:\/\//i.test(api)) { U.invalid(host, 'mailApi', 'URL phải bắt đầu bằng http:// hoặc https://'); return; }
    Object.assign(Store.state.settings.company, { name: g('cName'), representative: g('cRep'), phone: g('cPhone'), email: g('cEmail'), taxCode: g('cTax'), address: g('cAddr') });
    Store.state.settings.mailApi = api; Store.save(); U.toast('Đã lưu thông tin công ty'); if (App.refreshChrome) App.refreshChrome();
  }

  /* ------------------------------------------------------------------ DỮ LIỆU */
  function paneData() {
    const S = Store.state, T = App.TourAPI, i = T.info();
    const M = { online: ['green', 'Đã kết nối máy chủ KIO'], connecting: ['blue', 'Đang kết nối…'], offline: ['red', 'Mất kết nối — đang dùng dữ liệu trên máy'], local: ['slate', 'Chế độ cục bộ (chưa nạp thư viện KIO)'] }[i.mode] || ['slate', i.mode];
    const ST = { synced: 'Đã đồng bộ', syncing: 'Đang đồng bộ…', waiting: 'Có thay đổi chờ gửi', error: 'Lỗi đồng bộ', offline: 'Offline', local: 'Cục bộ', connecting: 'Đang kết nối' }[i.status] || '';
    const server = '<div class="card mb" style="box-shadow:none"><div class="card-head"><h3><i class="fa-solid fa-server" style="color:var(--primary);margin-right:8px"></i>Máy chủ KIO</h3><div class="row-gap">' +
      '<button class="btn btn-sm btn-primary" data-act="syncNow"><i class="fa-solid fa-rotate"></i>Đồng bộ ngay</button><button class="btn btn-sm" data-act="reconnect"><i class="fa-solid fa-plug"></i>Kết nối lại</button></div></div><div class="card-body">' +
      '<dl class="dl mb"><dt>Kết nối</dt><dd>' + U.badge(M[1], M[0]) + '</dd><dt>Trạng thái</dt><dd>' + ST + (i.pending ? ' · <b>' + i.pending + '</b> thay đổi chờ gửi' : '') + '</dd><dt>Đồng bộ lần cuối</dt><dd>' + (i.lastSync ? U.fdatetime(i.lastSync) : '—') + '</dd>' +
      (i.lastError ? '<dt>Lỗi gần nhất</dt><dd class="money-neg" style="font-weight:600">' + U.esc(i.lastError) + '</dd>' : '') + '</dl>' +
      '<div class="tbl-wrap"><table class="tbl" style="min-width:0"><thead><tr><th>Dữ liệu</th><th>Bảng KIO</th><th class="right">Số bản ghi (máy này)</th></tr></thead><tbody>' +
      T.localCounts().map(x => '<tr><td>' + U.esc(x.label) + '</td><td><span class="code">' + U.esc(x.table) + '</span></td><td class="right">' + x.count + '</td></tr>').join('') + '</tbody></table></div>' +
      ((i.unavailable || []).length ? '<div class="callout warn mt"><i class="fa-solid fa-triangle-exclamation"></i><div>Máy chủ <b>chưa có bảng ' + i.unavailable.map(U.esc).join(', ') + '</b> nên dữ liệu này tạm chỉ lưu trên máy. Nhờ quản trị viên chạy <b>sql/kio-tables.sql</b> rồi bấm “Kết nối lại”.</div></div>' : '') +
      (i.hasBackup ? '<div class="callout warn mt"><i class="fa-solid fa-box-archive"></i><div>Có <b>bản sao dữ liệu cũ</b> của trình duyệt này (được giữ lại khi tải dữ liệu từ máy chủ lần đầu). <button class="btn btn-xs" data-act="oldBackup">Tải về (JSON)</button></div></div>' : '') + '</div></div>';
    return '<div class="tab-pane">' + server + '<div class="kpi-row">' + U.mkpi({ icon: 'users', tone: 'blue', label: 'Khách hàng', value: S.customers.length }) + U.mkpi({ icon: 'file-invoice-dollar', tone: 'indigo', label: 'Đơn hàng', value: S.orders.length }) +
      U.mkpi({ icon: 'handshake', tone: 'teal', label: 'Nhà cung cấp', value: S.suppliers.length }) + U.mkpi({ icon: 'receipt', tone: 'orange', label: 'Phiếu thu/chi', value: S.vouchers.length }) + '</div>' +
      '<div class="callout mb"><i class="fa-solid fa-circle-info"></i><div>' + (i.mode === 'online' ? 'Dữ liệu được lưu trên <b>máy chủ KIO</b> và dùng chung cho mọi người đăng nhập; máy này giữ thêm một bản đệm để chạy khi mất mạng.' : 'Dữ liệu hiện lưu trong <b>trình duyệt này</b> (localStorage). Khi kết nối được KIO, phần chưa gửi sẽ tự đồng bộ lên máy chủ.') + ' Nên <b>sao lưu</b> JSON định kỳ.</div></div>' +
      '<div class="row-gap"><button class="btn btn-primary" data-act="backup"><i class="fa-solid fa-download"></i>Sao lưu (tải JSON)</button><label class="btn" style="cursor:pointer"><i class="fa-solid fa-upload"></i>Khôi phục từ file<input type="file" id="restoreFile" accept=".json,application/json" style="display:none"></label>' +
      '<button class="btn" data-act="reset"><i class="fa-solid fa-rotate-left"></i>Nạp lại dữ liệu mẫu</button><button class="btn btn-danger" data-act="clear"><i class="fa-solid fa-trash"></i>Xóa toàn bộ dữ liệu nghiệp vụ</button></div></div>';
  }
  // Ở chế độ online các thao tác này THAY THẾ dữ liệu dùng chung trên máy chủ → bắt gõ chữ xác nhận
  async function confirmDanger(title, message, ok, word) {
    if (App.TourAPI.isOnline()) return U.confirmType({ title, message: message + '<br><br><b>Dữ liệu trên máy chủ KIO sẽ bị thay thế — ảnh hưởng tất cả người dùng.</b>', word: word || 'XÓA', ok });
    return U.confirm({ title, message, ok, danger: true });
  }

  async function onAct(b) {
    const S = Store.state, id = b.dataset.id;
    switch (b.dataset.act) {
      case 'addSvc': svcForm(); break; case 'editSvc': svcForm(id); break;
      case 'toggleSvc': { const s = C.service(id); s.active = !s.active; Store.save(); draw(); break; }
      case 'delSvc': { const s = C.service(id), n = S.orders.filter(o => o.serviceId === id).length;
        if (!(await U.confirm({ title: 'Xóa dịch vụ', message: 'Xóa dịch vụ <b>' + U.esc(s.name) + '</b>?' + (n ? '<br>' + n + ' đơn hàng đang dùng dịch vụ này vẫn giữ nguyên tên dịch vụ đã lưu.' : ''), ok: 'Xóa', danger: true }))) break;
        S.settings.services = S.settings.services.filter(x => x.id !== id); Store.save(); draw(); U.toast('Đã xóa dịch vụ', s.name); break; }
      case 'addType': addType(); break; case 'delType': delType(id); break;
      case 'addUser': userForm(); break; case 'editUser': userForm(id); break; case 'resetUser': resetForm(id); break;
      case 'toggleUser': { const u = App.Auth.users().find(x => x.id === id), e = App.Auth.updateUser(id, { name: u.name, role: u.role, active: !u.active }); if (e) U.toast('Không thực hiện được', e, 'warning'); else { draw(); U.toast(u.active ? 'Đã mở khóa tài khoản' : 'Đã khóa tài khoản', u.username); } break; }
      case 'delUser': { const u = App.Auth.users().find(x => x.id === id), why = (() => { const me = App.Auth.current(); if (me && me.id === id) return 'Bạn không thể xóa tài khoản đang đăng nhập'; if (u.role === 'admin' && u.active && App.Auth.activeAdmins() <= 1) return 'Phải còn ít nhất một quản trị viên đang hoạt động'; return ''; })();
        if (why) { U.toast('Không thể xóa', why, 'warning'); break; }
        if (!(await U.confirm({ title: 'Xóa người dùng', message: 'Xóa tài khoản <b>' + U.esc(u.username) + '</b> (' + U.esc(u.name) + ')?', ok: 'Xóa', danger: true }))) break;
        App.Auth.deleteUser(id); draw(); U.toast('Đã xóa người dùng', u.username); break; }
      case 'addAcc': accForm(); break; case 'editAcc': accForm(id); break;
      case 'delAcc': { const a = C.account(id);
        if (S.vouchers.some(v => v.accountId === id)) { U.toast('Không thể xóa', 'Tài khoản đã có phiếu thu/chi.', 'warning'); break; }
        if (!(await U.confirm({ title: 'Xóa tài khoản', message: 'Xóa tài khoản <b>' + U.esc(a.bank + ' · ' + a.number) + '</b>?', ok: 'Xóa', danger: true }))) break;
        S.settings.accounts = S.settings.accounts.filter(x => x.id !== id); Store.save(); draw(); U.toast('Đã xóa tài khoản'); break; }
      case 'saveCompany': saveCompany(); break;
      case 'backup': U.download('tour-erp-backup-' + U.todayISO() + '.json', JSON.stringify(S, null, 2), 'application/json'); U.toast('Đã tải file sao lưu'); break;
      case 'syncNow': { const btn = b; btn.disabled = true; await App.TourAPI.syncNow(); draw(); break; }
      case 'reconnect': { await App.TourAPI.reconnect(); draw(); break; }
      case 'oldBackup': U.download('tour-erp-du-lieu-cu-' + U.todayISO() + '.json', App.TourAPI.backupJSON() || '{}', 'application/json'); break;
      case 'reset': if (await confirmDanger('Nạp lại dữ liệu mẫu', 'Toàn bộ dữ liệu hiện tại sẽ bị <b>thay bằng dữ liệu mẫu</b>. Không thể hoàn tác.', 'Nạp lại', 'NAP LAI')) { Store.reset(); draw(); U.toast('Đã nạp lại dữ liệu mẫu'); if (App.refreshChrome) App.refreshChrome(); } break;
      case 'clear': if (await confirmDanger('Xóa dữ liệu nghiệp vụ', 'Xóa <b>toàn bộ khách hàng, đơn hàng, NCC, tour, phiếu thu/chi</b>? Danh mục dịch vụ, tài khoản và thông tin công ty được giữ lại. Nên sao lưu trước.', 'Xóa hết', 'XOA HET')) { Store.clear(); draw(); U.toast('Đã xóa dữ liệu nghiệp vụ'); if (App.refreshChrome) App.refreshChrome(); } break;
    }
  }

  const mod = {
    title: 'Hệ thống', group: 'Quản trị', icon: 'gear', adminOnly: true,
    render(view, args) {
      host = view; tab = args && TABS.find(t => t.key === args[0]) ? args[0] : 'services';
      view.innerHTML = '<div class="page-head"><div><h1>Hệ thống</h1><p>Cài đặt dịch vụ, tài khoản ngân hàng, thông tin công ty và dữ liệu.</p></div></div><div class="card"><div id="syTabs"></div><div id="syBody"></div></div>';
      view.onclick = e => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; history.replaceState(null, '', '#/system/' + tab); draw(); return; } const b = e.target.closest('[data-act]'); if (b) onAct(b); };
      view.onchange = e => {
        if (e.target.id !== 'restoreFile' || !e.target.files[0]) return;
        const f = e.target.files[0], r = new FileReader();
        r.onload = async () => { try { const o = JSON.parse(r.result); if (!(await confirmDanger('Khôi phục dữ liệu', 'Thay toàn bộ dữ liệu hiện tại bằng nội dung file <b>' + U.esc(f.name) + '</b>?', 'Khôi phục', 'KHOI PHUC'))) return; Store.replace(o); draw(); U.toast('Đã khôi phục dữ liệu'); if (App.refreshChrome) App.refreshChrome(); } catch (err) { U.toast('File không hợp lệ', err.message, 'danger'); } };
        r.readAsText(f);
      };
      draw();
    }
  };
  App.mod.system = mod; App.Router.register('system', mod);
})();
