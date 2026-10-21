/* ============================================================================
 * Phân hệ 1 — KHÁCH HÀNG
 * Hai loại khách hàng:
 *  - KH cá nhân (mã KL01, KL02…): họ và tên, giới tính, ngày tháng năm sinh, số ĐT, email, địa chỉ, số CCCD/Hộ chiếu.
 *  - KH doanh nghiệp (mã DN01, DN02…): tên công ty, địa chỉ, ĐT, mã số thuế, họ tên + số ĐT người liên hệ.
 * Tìm kiếm theo tên / số điện thoại / mã số thuế…; xuất dữ liệu ra file Excel.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store, K = App.CONST;
  const st = { q: '', page: 1, kind: 'all' };
  let body, kpi, tabsEl;
  const PREFIX = { personal: ['KL', 2], business: ['DN', 2] };
  const KIND_LABEL = { personal: 'Cá nhân', business: 'Doanh nghiệp' };

  const digits = v => String(v == null ? '' : v).replace(/\D/g, '');
  function filtered() {
    const q = U.norm(st.q), dg = digits(st.q);
    return Store.state.customers.filter(c => {
      if (st.kind !== 'all' && (c.type || 'personal') !== st.kind) return false;
      if (!q) return true;
      return U.norm(c.name).includes(q) || U.norm(c.id).includes(q) || U.norm(c.email).includes(q) || U.norm(c.contactName).includes(q) ||
        U.norm(c.cccd).includes(q) || U.norm(c.taxCode).includes(q) ||
        (dg.length >= 3 && (digits(c.phone).includes(dg) || digits(c.contactPhone).includes(dg) || digits(c.taxCode).includes(dg)));
    }).slice().reverse();
  }
  const dash = '<span class="muted">—</span>';
  const kindBadge = c => U.badge(KIND_LABEL[c.type] || KIND_LABEL.personal, c.type === 'business' ? 'indigo' : 'blue', true);

  function renderList() {
    const all = Store.state.customers, rows = filtered();
    const nBiz = all.filter(c => c.type === 'business').length, totalRev = App.sum(all, c => C.customerRevenue(c.id));
    kpi.innerHTML = U.mkpi({ icon: 'users', tone: 'blue', label: 'Tổng khách hàng', value: U.fmt(all.length), sub: U.fmt(all.length - nBiz) + ' cá nhân · ' + U.fmt(nBiz) + ' doanh nghiệp' }) +
      U.mkpi({ icon: 'sack-dollar', tone: 'green', label: 'Tổng doanh thu', value: U.money(totalRev) }) +
      U.mkpi({ icon: 'chart-line', tone: 'indigo', label: 'Doanh thu trung bình / KH', value: U.money(all.length ? Math.round(totalRev / all.length) : 0) });
    const cnt = k => all.filter(c => k === 'all' || (c.type || 'personal') === k).length;
    tabsEl.innerHTML = U.tabs([{ key: 'all', label: 'Tất cả', cnt: cnt('all') }, { key: 'personal', label: 'KH cá nhân', cnt: cnt('personal') }, { key: 'business', label: 'KH doanh nghiệp', cnt: cnt('business') }], st.kind);
    body.innerHTML = U.table({
      rows, st, size: 10,
      empty: U.empty('user-slash', st.q ? 'Không tìm thấy khách hàng' : 'Chưa có khách hàng', st.q ? 'Thử tìm lại bằng tên, số điện thoại hoặc mã số thuế khác.' : 'Bấm “Thêm khách hàng” để tạo mới.'),
      rowCls: () => 'clickable', rowAttr: r => 'data-act="view" data-id="' + r.id + '"',
      cols: [
        { label: 'Mã KH', render: r => '<span class="code">' + U.esc(r.id) + '</span>' },
        { label: 'Khách hàng', render: r => '<div class="cell-main">' + U.esc(r.name) + '</div><div class="cell-sub">' + kindBadge(r) + (r.type === 'business' && r.contactName ? ' Liên hệ: ' + U.esc(r.contactName) : '') + '</div>' },
        { label: 'Thông tin', render: r => r.type === 'business'
          ? (r.taxCode ? '<span class="nowrap">MST: ' + U.esc(r.taxCode) + '</span>' : dash)
          : ([r.gender, C.birthLabel(r)].filter(Boolean).map(U.esc).join(' · ') || dash) },
        { label: 'Điện thoại', render: r => '<span class="nowrap">' + U.esc(r.phone) + '</span>' + (r.type === 'business' ? (r.contactPhone ? '<div class="cell-sub nowrap">LH: ' + U.esc(r.contactPhone) + '</div>' : '') : (r.email ? '<div class="cell-sub">' + U.esc(r.email) + '</div>' : '')) },
        { label: 'CCCD / Hộ chiếu', render: r => r.type !== 'business' && r.cccd ? U.esc(r.cccd) : dash },
        { label: 'Địa chỉ', render: r => '<span style="display:block;max-width:240px">' + (U.esc(r.address) || dash) + '</span>' },
        { label: 'Doanh thu', cls: 'right', render: r => { const v = C.customerRevenue(r.id); return v ? '<b class="num">' + U.money(v) + '</b>' : '<span class="muted">0 ₫</span>'; } },
        { label: '', cls: 'right', render: r => '<div class="row-actions">' + U.iconBtn('edit', r.id, 'pen', 'Sửa') + U.iconBtn('del', r.id, 'trash', 'Xóa') + '</div>' }
      ]
    });
  }

  function exportData() {
    const rows = filtered().reverse();
    U.exportXlsx({
      filename: 'khach-hang', sheet: 'Khách hàng', title: 'DANH SÁCH KHÁCH HÀNG',
      subtitle: [st.kind !== 'all' ? 'Loại: ' + KIND_LABEL[st.kind] : '', st.q ? 'Lọc: “' + st.q + '”' : ''].filter(Boolean).join(' · '),
      headers: ['Mã KH', 'Loại KH', 'Họ tên / Tên công ty', 'Giới tính', 'Ngày sinh', 'Điện thoại', 'Email', 'CCCD / Hộ chiếu', 'Mã số thuế', 'Người liên hệ', 'SĐT người liên hệ', 'Địa chỉ', 'Doanh thu (₫)'],
      rows: rows.map(c => [c.id, KIND_LABEL[c.type] || KIND_LABEL.personal, c.name, c.gender || '', C.birthLabel(c), c.phone, c.email || '', c.cccd || '', c.taxCode || '', c.contactName || '', c.contactPhone || '', c.address || '', C.customerRevenue(c.id)]),
      moneyCols: [12]
    });
  }

  /* ---------------------------------------------------------- FORM THÊM/SỬA */
  function fieldsFor(type, v, locked) {
    const today = U.todayISO();
    if (type === 'business') {
      return U.field({ id: 'name', label: 'Tên công ty', req: true, html: U.input({ id: 'name', value: v.name, ph: 'VD: Công ty TNHH Du lịch ABC' }) }) +
        '<div class="form-grid">' +
        U.field({ id: 'taxCode', label: 'Mã số thuế', req: true, hint: '10 số, hoặc 13 số (mã đơn vị phụ thuộc)', html: U.input({ id: 'taxCode', value: v.taxCode, ph: '0312345678', attrs: 'inputmode="numeric" maxlength="14"' }) }) +
        U.field({ id: 'phone', label: 'Điện thoại', req: true, html: U.input({ id: 'phone', value: v.phone, ph: '028 xxxx xxxx', type: 'tel' }) }) +
        U.field({ id: 'contactName', label: 'Họ tên người liên hệ', html: U.input({ id: 'contactName', value: v.contactName, ph: 'VD: Nguyễn Văn A' }) }) +
        U.field({ id: 'contactPhone', label: 'Số điện thoại người liên hệ', html: U.input({ id: 'contactPhone', value: v.contactPhone, ph: '09xx xxx xxx', type: 'tel' }) }) + '</div>' +
        U.field({ id: 'address', label: 'Địa chỉ', html: U.input({ id: 'address', value: v.address, ph: 'Số nhà, đường, phường/xã, tỉnh/thành' }) });
    }
    return '<div class="form-grid">' +
      U.field({ id: 'name', label: 'Họ và tên', req: true, html: U.input({ id: 'name', value: v.name, ph: 'VD: Nguyễn Văn A' }) }) +
      U.field({ id: 'gender', label: 'Giới tính', html: U.select({ id: 'gender', ph: '— Chọn —', value: v.gender, options: K.GENDERS.map(g => ({ v: g, l: g })) }) }) +
      U.field({ id: 'birthDate', label: 'Ngày tháng năm sinh', html: U.input({ id: 'birthDate', type: 'date', value: v.birthDate, attrs: 'min="1900-01-01" max="' + today + '"' }) }) +
      U.field({ id: 'phone', label: 'Số điện thoại', req: true, html: U.input({ id: 'phone', value: v.phone, ph: '09xx xxx xxx', type: 'tel' }) }) +
      U.field({ id: 'email', label: 'Email', html: U.input({ id: 'email', type: 'email', value: v.email, ph: 'email@example.com' }) }) +
      U.field({ id: 'cccd', label: 'Số CCCD / Hộ chiếu', hint: 'CCCD 12 số, CMND 9 số hoặc số hộ chiếu', html: U.input({ id: 'cccd', value: v.cccd, ph: '12 chữ số hoặc số hộ chiếu', attrs: 'maxlength="15" autocapitalize="characters"' }) }) + '</div>' +
      U.field({ id: 'address', label: 'Địa chỉ', html: U.input({ id: 'address', value: v.address, ph: 'Số nhà, đường, phường/xã, tỉnh/thành' }) });
  }

  function openForm(id, onSaved) {
    const c = id ? C.customer(id) : null;
    const blank = { type: 'personal', name: '', gender: '', birthDate: '', phone: '', email: '', cccd: '', taxCode: '', contactName: '', contactPhone: '', address: '' };
    // Khách cũ chỉ có năm sinh: đưa vào ô ngày sinh khi sửa nếu chưa có ngày đầy đủ (để trống, giữ nguyên năm sinh cũ)
    const v = Object.assign({}, blank, c || {}), startType = v.type === 'business' ? 'business' : 'personal';
    const codeOf = t => c ? c.id : Store.peekId(PREFIX[t][0], PREFIX[t][1]);
    const html = U.field({ id: 'ctype', label: 'Loại khách hàng', req: true, hint: c ? 'Không đổi loại khách hàng sau khi đã tạo (mã khách hàng gắn với loại).' : 'Chọn loại để nhập đúng thông tin; mã được tạo tự động theo loại.',
      html: '<div class="seg">' + ['personal', 'business'].map(k => '<label><input type="radio" name="ctype" value="' + k + '"' + (startType === k ? ' checked' : '') + (c ? ' disabled' : '') + '><span><i class="fa-solid fa-' + (k === 'business' ? 'building' : 'user') + '"></i>' + (k === 'business' ? 'Khách hàng doanh nghiệp' : 'Khách hàng cá nhân') + '</span></label>').join('') + '</div>' }) +
      U.field({ id: 'code', label: 'Mã khách hàng', html: U.input({ id: 'code', value: codeOf(startType), attrs: 'disabled' }) }) +
      '<div id="cFields">' + fieldsFor(startType, v) + '</div>';
    U.modal({
      title: c ? 'Sửa khách hàng ' + c.id : 'Thêm khách hàng', sub: c ? '' : 'Mã khách hàng được tạo tự động', size: 'md', static: true, body: html,
      onMount: h => {
        const b = h.body, kind = () => (b.querySelector('input[name="ctype"]:checked') || {}).value || 'personal';
        b.querySelectorAll('input[name="ctype"]').forEach(r => r.addEventListener('change', () => {
          // giữ lại các ô dùng chung khi đổi loại
          const keep = { name: U.val(b, 'name'), phone: U.val(b, 'phone'), address: U.val(b, 'address') };
          const t = kind(); b.querySelector('#cFields').innerHTML = fieldsFor(t, Object.assign({}, blank, keep)); b.querySelector('#code').value = codeOf(t);
          const f = b.querySelector('#name'); if (f) f.focus();
        }));
      },
      foot: [{ label: 'Hủy' }, {
        label: c ? 'Lưu thay đổi' : 'Thêm khách hàng', cls: 'btn-primary', icon: 'check', onClick: h => {
          const b = h.body; U.clearErr(b);
          const type = c ? (c.type === 'business' ? 'business' : 'personal') : ((b.querySelector('input[name="ctype"]:checked') || {}).value || 'personal');
          const name = U.val(b, 'name'), phoneRaw = U.val(b, 'phone'), phone = phoneRaw.replace(/[\s.\-()]/g, '');
          let ok = true;
          if (name.length < 2) ok = U.invalid(b, 'name', type === 'business' ? 'Vui lòng nhập tên công ty' : 'Vui lòng nhập họ và tên');
          if (!/^\+?\d{9,13}$/.test(phone)) ok = U.invalid(b, 'phone', 'Số điện thoại không hợp lệ (9–13 chữ số)');
          else { const dup = Store.state.customers.find(x => String(x.phone).replace(/[\s.\-()]/g, '') === phone && (!c || x.id !== c.id)); if (dup) ok = U.invalid(b, 'phone', 'Số điện thoại đã thuộc khách hàng ' + dup.id + ' – ' + dup.name); }
          const data = { type, name, phone: phoneRaw, address: U.val(b, 'address') };
          if (type === 'business') {
            const tax = U.val(b, 'taxCode').replace(/\s/g, ''), cp = U.val(b, 'contactPhone').replace(/[\s.\-()]/g, '');
            if (!/^\d{10}(-?\d{3})?$/.test(tax)) ok = U.invalid(b, 'taxCode', 'Mã số thuế gồm 10 số (hoặc 13 số)');
            else { const dup = Store.state.customers.find(x => x.type === 'business' && String(x.taxCode).replace(/\D/g, '') === tax.replace(/\D/g, '') && (!c || x.id !== c.id)); if (dup) ok = U.invalid(b, 'taxCode', 'Mã số thuế đã thuộc ' + dup.id + ' – ' + dup.name); }
            if (cp && !/^\+?\d{9,13}$/.test(cp)) ok = U.invalid(b, 'contactPhone', 'Số điện thoại người liên hệ không hợp lệ');
            Object.assign(data, { taxCode: tax, contactName: U.val(b, 'contactName'), contactPhone: U.val(b, 'contactPhone'), gender: '', birthDate: '', email: '', cccd: '' });
          } else {
            const cccd = U.val(b, 'cccd').replace(/\s/g, '').toUpperCase(), email = U.val(b, 'email'), bd = U.val(b, 'birthDate');
            if (cccd && !/^[A-Z0-9]{6,15}$/.test(cccd)) ok = U.invalid(b, 'cccd', 'CCCD (12 số), CMND (9 số) hoặc số hộ chiếu (6–15 ký tự chữ/số)');
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ok = U.invalid(b, 'email', 'Email không hợp lệ');
            if (bd && (bd < '1900-01-01' || bd > U.todayISO())) ok = U.invalid(b, 'birthDate', 'Ngày sinh không hợp lệ');
            Object.assign(data, { gender: U.val(b, 'gender'), birthDate: bd, email, cccd, taxCode: '', contactName: '', contactPhone: '' });
            if (c && c.birthYear && !bd) data.birthYear = c.birthYear;   // giữ năm sinh cũ nếu chưa nhập ngày đầy đủ
          }
          if (!ok) { U.focusFirstInvalid(b); return; }
          let rec;
          if (c) { Object.assign(c, data); rec = c; U.toast('Đã cập nhật khách hàng', c.id + ' – ' + c.name); }
          else { rec = Object.assign({ id: Store.nextId(PREFIX[type][0], PREFIX[type][1]) }, data); Store.state.customers.push(rec); U.toast('Đã thêm khách hàng', rec.id + ' – ' + rec.name); }
          Store.save(); h.close();
          if (onSaved) onSaved(rec); else if (body) renderList();
          if (App.refreshChrome) App.refreshChrome();
        }
      }]
    });
  }

  function openView(id) {
    const c = C.customer(id); if (!c) return;
    const orders = Store.state.orders.filter(o => o.customerId === id).slice().reverse();
    const rev = C.customerRevenue(id), paid = App.sum(orders, o => C.orderPaid(o.id));
    const row = (k, v) => '<dt>' + k + '</dt><dd>' + (v ? U.esc(v) : '—') + '</dd>';
    const info = '<dl class="dl mb">' + row('Mã khách hàng', c.id) + '<dt>Loại khách hàng</dt><dd>' + kindBadge(c) + '</dd>' +
      (c.type === 'business'
        ? row('Tên công ty', c.name) + row('Mã số thuế', c.taxCode) + row('Điện thoại', c.phone) + row('Người liên hệ', c.contactName) + row('SĐT người liên hệ', c.contactPhone) + row('Địa chỉ', c.address)
        : row('Họ và tên', c.name) + row('Giới tính', c.gender) + row('Ngày tháng năm sinh', C.birthLabel(c)) + row('Số điện thoại', c.phone) + row('Email', c.email) + row('Số CCCD / Hộ chiếu', c.cccd) + row('Địa chỉ', c.address)) + '</dl>';
    const kp = '<div class="kpi-row cols3">' + U.mkpi({ icon: 'file-invoice-dollar', tone: 'blue', label: 'Số đơn hàng', value: orders.length }) +
      U.mkpi({ icon: 'sack-dollar', tone: 'green', label: 'Doanh thu', value: U.money(rev) }) + U.mkpi({ icon: 'hand-holding-dollar', tone: 'orange', label: 'Còn phải thu', value: U.money(Math.max(0, rev - paid)) }) + '</div>';
    const tbl = orders.length ? '<div class="tbl-wrap"><table class="tbl" style="min-width:560px"><thead><tr><th>Mã đơn</th><th>Dịch vụ</th><th>Khởi hành</th><th class="right">Phải thu</th><th>Thu tiền</th></tr></thead><tbody>' +
      orders.map(o => { const s = C.orderStatus(o); return '<tr><td><span class="code">' + U.esc(o.id) + '</span></td><td>' + U.esc(o.serviceName) + '</td><td>' + U.fdate(o.start) + '</td><td class="right">' + U.money(C.total(o)) + '</td><td>' + U.badge(s.label, s.tone) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' : U.empty('file-circle-question', 'Chưa có đơn hàng', 'Khách hàng này chưa phát sinh đơn.');
    U.modal({
      title: 'Chi tiết khách hàng', sub: U.esc(c.name), size: 'md', body: info + kp + '<div class="sec-title"><i class="fa-solid fa-list"></i>Đơn hàng của khách</div>' + tbl,
      foot: [{ label: 'Sửa', icon: 'pen', left: true, onClick: h => { h.close(); openForm(id); } }, { label: 'Tạo đơn hàng', icon: 'plus', cls: 'btn-primary', onClick: h => { h.close(); App.mod.orders.openForm(null, { customerId: id }); } }, { label: 'Đóng' }]
    });
  }

  async function del(id) {
    const c = C.customer(id); if (!c) return;
    if (Store.state.orders.some(o => o.customerId === id)) { U.toast('Không thể xóa', 'Khách hàng ' + c.id + ' đã có đơn hàng.', 'warning'); return; }
    if (!(await U.confirm({ title: 'Xóa khách hàng', message: 'Bạn chắc chắn muốn xóa khách hàng <b>' + U.esc(c.name) + '</b> (' + c.id + ')?', ok: 'Xóa', danger: true }))) return;
    Store.state.customers = Store.state.customers.filter(x => x.id !== id); Store.save(); renderList(); U.toast('Đã xóa khách hàng', c.id);
  }

  const mod = {
    title: 'Khách hàng', group: 'Nghiệp vụ', icon: 'users',
    openForm, openView,
    render(view) {
      st.q = App.Router.takeQ() || ''; st.page = 1; st.kind = 'all';
      view.innerHTML = '<div class="page-head"><div><h1>Khách hàng</h1><p>Quản lý hồ sơ khách hàng cá nhân, doanh nghiệp và doanh thu theo từng khách hàng.</p></div><div class="page-head-actions">' +
        '<button class="btn" id="cExport"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button>' +
        '<button class="btn btn-primary" id="cAdd"><i class="fa-solid fa-plus"></i>Thêm khách hàng</button></div></div>' +
        '<div class="kpi-row" id="cKpi"></div>' +
        '<div class="card"><div id="cTabs"></div><div class="toolbar"><div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" id="cSearch" placeholder="Tìm theo tên, số điện thoại, mã số thuế…" value="' + U.esc(st.q) + '"></div></div><div id="cBody"></div></div>';
      body = U.$('#cBody', view); kpi = U.$('#cKpi', view); tabsEl = U.$('#cTabs', view);
      U.$('#cSearch', view).oninput = e => { st.q = e.target.value; st.page = 1; renderList(); };
      U.$('#cAdd', view).onclick = () => openForm();
      U.$('#cExport', view).onclick = exportData;
      tabsEl.onclick = e => { const t = e.target.closest('[data-tab]'); if (t) { st.kind = t.dataset.tab; st.page = 1; renderList(); } };
      body.onclick = e => {
        if (U.pagerClick(e, st)) { renderList(); return; }
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act, id = b.dataset.id;
        if (act === 'edit') { e.stopPropagation(); openForm(id); } else if (act === 'del') { e.stopPropagation(); del(id); } else if (act === 'view') openView(id);
      };
      renderList();
    }
  };
  App.mod.customers = mod; App.Router.register('customers', mod);
})();
