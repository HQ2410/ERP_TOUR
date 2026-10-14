/* ============================================================================
 * Phân hệ 7 — HỆ THỐNG
 * Cài đặt, chỉnh sửa, thêm, bớt các dịch vụ; tài khoản ngân hàng (cá nhân /
 * công ty); thông tin công ty (in chứng từ, API gửi email); sao lưu dữ liệu.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store, K = App.CONST;
  let host, tab = 'services';
  const TABS = [{ key: 'services', label: 'Danh mục dịch vụ', icon: 'tags' }, { key: 'accounts', label: 'Tài khoản ngân hàng', icon: 'building-columns' }, { key: 'company', label: 'Thông tin công ty', icon: 'building' }, { key: 'data', label: 'Dữ liệu & sao lưu', icon: 'database' }];
  const draw = () => { U.$('#syTabs', host).innerHTML = U.tabs(TABS, tab); const b = U.$('#syBody', host); b.innerHTML = ({ services: paneServices, accounts: paneAccounts, company: paneCompany, data: paneData }[tab])(); };

  /* ------------------------------------------------------------- DỊCH VỤ */
  function paneServices() {
    const list = Store.state.settings.services;
    return '<div class="toolbar"><div class="muted" style="font-size:12.8px">Danh mục dùng khi tạo đơn hàng. Có thể thêm, sửa, ngừng sử dụng hoặc xóa dịch vụ.</div><div class="spacer"></div><button class="btn btn-primary btn-sm" data-act="addSvc"><i class="fa-solid fa-plus"></i>Thêm dịch vụ</button></div>' +
      U.table({ rows: list.slice().reverse(), st: { page: 1 }, size: 500, nopager: true, empty: U.empty('tags', 'Chưa có dịch vụ', 'Thêm dịch vụ để bắt đầu tạo đơn hàng.'),
        cols: [{ label: 'Mã', render: s => '<span class="code">' + s.id + '</span>' }, { label: 'Tên dịch vụ', render: s => '<span class="cell-main">' + U.esc(s.name) + '</span>' }, { label: 'Nhóm', render: s => U.badge(s.group, 'slate', true) }, { label: 'Đơn vị', render: s => U.esc(s.unit) },
          { label: 'Đơn giá', cls: 'right', render: s => '<b>' + U.money(s.price) + '</b>' }, { label: 'Số đơn', cls: 'center', render: s => Store.state.orders.filter(o => o.serviceId === s.id).length },
          { label: 'Trạng thái', render: s => '<button class="btn btn-xs" data-act="toggleSvc" data-id="' + s.id + '">' + (s.active ? U.badge('Đang dùng', 'green') : U.badge('Ngừng', 'slate')) + '</button>' },
          { label: '', cls: 'right', render: s => '<div class="row-actions">' + U.iconBtn('editSvc', s.id, 'pen', 'Sửa') + U.iconBtn('delSvc', s.id, 'trash', 'Xóa') + '</div>' }] });
  }
  function svcForm(id) {
    const s = id ? C.service(id) : null;
    U.modal({ title: s ? 'Sửa dịch vụ ' + s.id : 'Thêm dịch vụ', size: 'md', static: true,
      body: U.field({ id: 'name', label: 'Tên dịch vụ', req: true, html: U.input({ id: 'name', value: s ? s.name : '' }) }) + '<div class="form-grid">' +
        U.field({ id: 'group', label: 'Nhóm dịch vụ', req: true, html: U.select({ id: 'group', value: s ? s.group : K.SERVICE_GROUPS[0], options: K.SERVICE_GROUPS.map(g => ({ v: g, l: g })) }) }) +
        U.field({ id: 'unit', label: 'Đơn vị tính', req: true, html: U.input({ id: 'unit', value: s ? s.unit : 'khách', ph: 'khách, vé, ngày…' }) }) + '</div>' +
        U.field({ id: 'price', label: 'Đơn giá mặc định (₫)', req: true, html: U.input({ id: 'price', money: true, value: s ? s.price : '' }) }),
      foot: [{ label: 'Hủy' }, { label: s ? 'Lưu thay đổi' : 'Thêm dịch vụ', icon: 'check', cls: 'btn-primary', onClick: h => {
        const b = h.body; U.clearErr(b); let ok = true; const d = { name: U.val(b, 'name'), group: U.val(b, 'group'), unit: U.val(b, 'unit'), price: U.money$(b, 'price') };
        if (!d.name) ok = U.invalid(b, 'name', 'Nhập tên dịch vụ'); else if (Store.state.settings.services.some(x => U.norm(x.name) === U.norm(d.name) && (!s || x.id !== s.id))) ok = U.invalid(b, 'name', 'Dịch vụ này đã tồn tại');
        if (!d.unit) ok = U.invalid(b, 'unit', 'Nhập đơn vị'); if (d.price <= 0) ok = U.invalid(b, 'price', 'Đơn giá phải lớn hơn 0');
        if (!ok) { U.focusFirstInvalid(b); return; }
        if (s) { Object.assign(s, d); } else Store.state.settings.services.push(Object.assign({ id: Store.nextId('DV', 2), active: true }, d));
        Store.save(); h.close(); draw(); U.toast(s ? 'Đã cập nhật dịch vụ' : 'Đã thêm dịch vụ', d.name);
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
    const S = Store.state;
    return '<div class="tab-pane"><div class="kpi-row">' + U.mkpi({ icon: 'users', tone: 'blue', label: 'Khách hàng', value: S.customers.length }) + U.mkpi({ icon: 'file-invoice-dollar', tone: 'indigo', label: 'Đơn hàng', value: S.orders.length }) +
      U.mkpi({ icon: 'handshake', tone: 'teal', label: 'Nhà cung cấp', value: S.suppliers.length }) + U.mkpi({ icon: 'receipt', tone: 'orange', label: 'Phiếu thu/chi', value: S.vouchers.length }) + '</div>' +
      '<div class="callout mb"><i class="fa-solid fa-circle-info"></i><div>Dữ liệu hiện được lưu trong <b>trình duyệt này</b> (localStorage). Hãy <b>sao lưu</b> thường xuyên bằng file JSON; có thể khôi phục trên máy khác.</div></div>' +
      '<div class="row-gap"><button class="btn btn-primary" data-act="backup"><i class="fa-solid fa-download"></i>Sao lưu (tải JSON)</button><label class="btn" style="cursor:pointer"><i class="fa-solid fa-upload"></i>Khôi phục từ file<input type="file" id="restoreFile" accept=".json,application/json" style="display:none"></label>' +
      '<button class="btn" data-act="reset"><i class="fa-solid fa-rotate-left"></i>Nạp lại dữ liệu mẫu</button><button class="btn btn-danger" data-act="clear"><i class="fa-solid fa-trash"></i>Xóa toàn bộ dữ liệu nghiệp vụ</button></div></div>';
  }

  async function onAct(b) {
    const S = Store.state, id = b.dataset.id;
    switch (b.dataset.act) {
      case 'addSvc': svcForm(); break; case 'editSvc': svcForm(id); break;
      case 'toggleSvc': { const s = C.service(id); s.active = !s.active; Store.save(); draw(); break; }
      case 'delSvc': { const s = C.service(id), n = S.orders.filter(o => o.serviceId === id).length;
        if (!(await U.confirm({ title: 'Xóa dịch vụ', message: 'Xóa dịch vụ <b>' + U.esc(s.name) + '</b>?' + (n ? '<br>' + n + ' đơn hàng đang dùng dịch vụ này vẫn giữ nguyên tên dịch vụ đã lưu.' : ''), ok: 'Xóa', danger: true }))) break;
        S.settings.services = S.settings.services.filter(x => x.id !== id); Store.save(); draw(); U.toast('Đã xóa dịch vụ', s.name); break; }
      case 'addAcc': accForm(); break; case 'editAcc': accForm(id); break;
      case 'delAcc': { const a = C.account(id);
        if (S.vouchers.some(v => v.accountId === id)) { U.toast('Không thể xóa', 'Tài khoản đã có phiếu thu/chi.', 'warning'); break; }
        if (!(await U.confirm({ title: 'Xóa tài khoản', message: 'Xóa tài khoản <b>' + U.esc(a.bank + ' · ' + a.number) + '</b>?', ok: 'Xóa', danger: true }))) break;
        S.settings.accounts = S.settings.accounts.filter(x => x.id !== id); Store.save(); draw(); U.toast('Đã xóa tài khoản'); break; }
      case 'saveCompany': saveCompany(); break;
      case 'backup': U.download('tour-erp-backup-' + U.todayISO() + '.json', JSON.stringify(S, null, 2), 'application/json'); U.toast('Đã tải file sao lưu'); break;
      case 'reset': if (await U.confirm({ title: 'Nạp lại dữ liệu mẫu', message: 'Toàn bộ dữ liệu hiện tại sẽ bị <b>thay bằng dữ liệu mẫu</b>. Không thể hoàn tác.', ok: 'Nạp lại', danger: true })) { Store.reset(); draw(); U.toast('Đã nạp lại dữ liệu mẫu'); if (App.refreshChrome) App.refreshChrome(); } break;
      case 'clear': if (await U.confirm({ title: 'Xóa dữ liệu nghiệp vụ', message: 'Xóa <b>toàn bộ khách hàng, đơn hàng, NCC, tour, phiếu thu/chi</b>? Danh mục dịch vụ, tài khoản và thông tin công ty được giữ lại. Nên sao lưu trước.', ok: 'Xóa hết', danger: true })) { Store.clear(); draw(); U.toast('Đã xóa dữ liệu nghiệp vụ'); if (App.refreshChrome) App.refreshChrome(); } break;
    }
  }

  const mod = {
    title: 'Hệ thống', group: 'Quản trị', icon: 'gear',
    render(view, args) {
      host = view; tab = args && TABS.find(t => t.key === args[0]) ? args[0] : 'services';
      view.innerHTML = '<div class="page-head"><div><h1>Hệ thống</h1><p>Cài đặt dịch vụ, tài khoản ngân hàng, thông tin công ty và dữ liệu.</p></div></div><div class="card"><div id="syTabs"></div><div id="syBody"></div></div>';
      view.onclick = e => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; history.replaceState(null, '', '#/system/' + tab); draw(); return; } const b = e.target.closest('[data-act]'); if (b) onAct(b); };
      view.onchange = e => {
        if (e.target.id !== 'restoreFile' || !e.target.files[0]) return;
        const f = e.target.files[0], r = new FileReader();
        r.onload = async () => { try { const o = JSON.parse(r.result); if (!(await U.confirm({ title: 'Khôi phục dữ liệu', message: 'Thay toàn bộ dữ liệu hiện tại bằng nội dung file <b>' + U.esc(f.name) + '</b>?', ok: 'Khôi phục', danger: true }))) return; Store.replace(o); draw(); U.toast('Đã khôi phục dữ liệu'); if (App.refreshChrome) App.refreshChrome(); } catch (err) { U.toast('File không hợp lệ', err.message, 'danger'); } };
        r.readAsText(f);
      };
      draw();
    }
  };
  App.mod.system = mod; App.Router.register('system', mod);
})();
