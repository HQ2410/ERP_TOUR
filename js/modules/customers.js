/* ============================================================================
 * Phân hệ 1 — KHÁCH HÀNG
 * Mã KH, Họ tên, Năm sinh, ĐT, Số CCCD, Địa chỉ, Doanh thu.
 * Tìm kiếm theo họ tên / số điện thoại; xuất dữ liệu ra file Excel.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store;
  const st = { q: '', page: 1 };
  let body, kpi;

  function filtered() {
    const q = U.norm(st.q), digits = st.q.replace(/\D/g, '');
    return Store.state.customers.filter(c => !q ||
      U.norm(c.name).includes(q) || U.norm(c.id).includes(q) ||
      (digits.length >= 3 && String(c.phone).replace(/\D/g, '').includes(digits))).slice().reverse();
  }

  function renderList() {
    const all = Store.state.customers, rows = filtered();
    const totalRev = App.sum(all, c => C.customerRevenue(c.id));
    kpi.innerHTML = U.mkpi({ icon: 'users', tone: 'blue', label: 'Tổng khách hàng', value: U.fmt(all.length) }) +
      U.mkpi({ icon: 'sack-dollar', tone: 'green', label: 'Tổng doanh thu', value: U.money(totalRev) }) +
      U.mkpi({ icon: 'chart-line', tone: 'indigo', label: 'Doanh thu trung bình / KH', value: U.money(all.length ? Math.round(totalRev / all.length) : 0) });
    body.innerHTML = U.table({
      rows, st, size: 10,
      empty: U.empty('user-slash', st.q ? 'Không tìm thấy khách hàng' : 'Chưa có khách hàng', st.q ? 'Thử tìm lại bằng họ tên hoặc số điện thoại khác.' : 'Bấm “Thêm khách hàng” để tạo mới.'),
      rowCls: () => 'clickable', rowAttr: r => 'data-act="view" data-id="' + r.id + '"',
      cols: [
        { label: 'Mã KH', render: r => '<span class="code">' + r.id + '</span>' },
        { label: 'Họ tên', render: r => '<div class="cell-main">' + U.esc(r.name) + '</div>' },
        { label: 'Năm sinh', cls: 'center', render: r => r.birthYear || '<span class="muted">—</span>' },
        { label: 'Điện thoại', render: r => '<span class="nowrap">' + U.esc(r.phone) + '</span>' },
        { label: 'Số CCCD', render: r => r.cccd ? U.esc(r.cccd) : '<span class="muted">—</span>' },
        { label: 'Địa chỉ', render: r => '<span style="display:block;max-width:260px">' + (U.esc(r.address) || '<span class="muted">—</span>') + '</span>' },
        { label: 'Doanh thu', cls: 'right', render: r => { const v = C.customerRevenue(r.id); return v ? '<b class="num">' + U.money(v) + '</b>' : '<span class="muted">0 ₫</span>'; } },
        { label: '', cls: 'right', render: r => '<div class="row-actions">' + U.iconBtn('edit', r.id, 'pen', 'Sửa') + U.iconBtn('del', r.id, 'trash', 'Xóa') + '</div>' }
      ]
    });
  }

  function exportData() {
    const rows = filtered().reverse();
    U.exportXlsx({
      filename: 'khach-hang', sheet: 'Khách hàng', title: 'DANH SÁCH KHÁCH HÀNG',
      subtitle: st.q ? 'Lọc: “' + st.q + '”' : '',
      headers: ['Mã KH', 'Họ tên', 'Năm sinh', 'Điện thoại', 'Số CCCD', 'Địa chỉ', 'Doanh thu (₫)'],
      rows: rows.map(c => [c.id, c.name, c.birthYear || '', c.phone, c.cccd || '', c.address || '', C.customerRevenue(c.id)]),
      moneyCols: [6]
    });
  }

  /* ---------------------------------------------------------- FORM THÊM/SỬA */
  function openForm(id, onSaved) {
    const c = id ? C.customer(id) : null;
    const newId = c ? c.id : 'KH' + String((Store.state.seq.KH || 0) + 1).padStart(4, '0');
    const html = '<div class="form-grid">' +
      U.field({ id: 'name', label: 'Họ tên', req: true, html: U.input({ id: 'name', value: c ? c.name : '', ph: 'VD: Nguyễn Văn A' }) }) +
      U.field({ id: 'code', label: 'Mã khách hàng', html: U.input({ id: 'code', value: newId, attrs: 'disabled' }) }) +
      U.field({ id: 'phone', label: 'Điện thoại', req: true, html: U.input({ id: 'phone', value: c ? c.phone : '', ph: '09xx xxx xxx', type: 'tel' }) }) +
      U.field({ id: 'birthYear', label: 'Năm sinh', html: U.input({ id: 'birthYear', value: c && c.birthYear ? c.birthYear : '', ph: 'VD: 1990', type: 'number', attrs: 'min="1900" max="' + new Date().getFullYear() + '"' }) }) +
      U.field({ id: 'cccd', label: 'Số CCCD', hint: '12 số (hoặc 9 số CMND cũ)', html: U.input({ id: 'cccd', value: c ? c.cccd : '', ph: '12 chữ số', attrs: 'inputmode="numeric" maxlength="12"' }) }) +
      '<div></div></div>' +
      U.field({ id: 'address', label: 'Địa chỉ', html: U.input({ id: 'address', value: c ? c.address : '', ph: 'Số nhà, đường, phường/xã, tỉnh/thành' }) });
    U.modal({
      title: c ? 'Sửa khách hàng ' + c.id : 'Thêm khách hàng', sub: c ? '' : 'Mã khách hàng được tạo tự động', size: 'md', static: true, body: html,
      foot: [{ label: 'Hủy' }, {
        label: c ? 'Lưu thay đổi' : 'Thêm khách hàng', cls: 'btn-primary', icon: 'check', onClick: h => {
          const b = h.body; U.clearErr(b);
          const name = U.val(b, 'name'), phone = U.val(b, 'phone').replace(/[\s.\-()]/g, ''), cccd = U.val(b, 'cccd').replace(/\s/g, ''), by = U.val(b, 'birthYear');
          let ok = true;
          if (name.length < 2) ok = U.invalid(b, 'name', 'Vui lòng nhập họ tên');
          if (!/^\+?\d{9,13}$/.test(phone)) ok = U.invalid(b, 'phone', 'Số điện thoại không hợp lệ (9–13 chữ số)');
          else { const dup = Store.state.customers.find(x => x.phone.replace(/[\s.\-()]/g, '') === phone && (!c || x.id !== c.id)); if (dup) ok = U.invalid(b, 'phone', 'Số điện thoại đã thuộc khách hàng ' + dup.id + ' – ' + dup.name); }
          if (cccd && !/^(\d{9}|\d{12})$/.test(cccd)) ok = U.invalid(b, 'cccd', 'CCCD gồm 12 số (hoặc CMND 9 số)');
          if (by && (Number(by) < 1900 || Number(by) > new Date().getFullYear())) ok = U.invalid(b, 'birthYear', 'Năm sinh không hợp lệ');
          if (!ok) { U.focusFirstInvalid(b); return; }
          const data = { name, phone: U.val(b, 'phone'), cccd, birthYear: by ? Number(by) : null, address: U.val(b, 'address') };
          let rec;
          if (c) { Object.assign(c, data); rec = c; U.toast('Đã cập nhật khách hàng', c.id + ' – ' + c.name); }
          else { rec = Object.assign({ id: Store.nextId('KH', 4) }, data); Store.state.customers.push(rec); U.toast('Đã thêm khách hàng', rec.id + ' – ' + rec.name); }
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
    const info = '<dl class="dl mb">' +
      '<dt>Mã khách hàng</dt><dd>' + c.id + '</dd><dt>Họ tên</dt><dd>' + U.esc(c.name) + '</dd><dt>Năm sinh</dt><dd>' + (c.birthYear || '—') + '</dd>' +
      '<dt>Điện thoại</dt><dd>' + U.esc(c.phone) + '</dd><dt>Số CCCD</dt><dd>' + (U.esc(c.cccd) || '—') + '</dd><dt>Địa chỉ</dt><dd>' + (U.esc(c.address) || '—') + '</dd></dl>';
    const kp = '<div class="kpi-row cols3">' + U.mkpi({ icon: 'file-invoice-dollar', tone: 'blue', label: 'Số đơn hàng', value: orders.length }) +
      U.mkpi({ icon: 'sack-dollar', tone: 'green', label: 'Doanh thu', value: U.money(rev) }) + U.mkpi({ icon: 'hand-holding-dollar', tone: 'orange', label: 'Còn phải thu', value: U.money(Math.max(0, rev - paid)) }) + '</div>';
    const tbl = orders.length ? '<div class="tbl-wrap"><table class="tbl" style="min-width:560px"><thead><tr><th>Mã đơn</th><th>Dịch vụ</th><th>Khởi hành</th><th class="right">Phải thu</th><th>Thu tiền</th></tr></thead><tbody>' +
      orders.map(o => { const s = C.orderStatus(o); return '<tr><td><span class="code">' + o.id + '</span></td><td>' + U.esc(o.serviceName) + '</td><td>' + U.fdate(o.start) + '</td><td class="right">' + U.money(C.total(o)) + '</td><td>' + U.badge(s.label, s.tone) + '</td></tr>'; }).join('') +
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
      st.q = App.Router.takeQ() || ''; st.page = 1;
      view.innerHTML = '<div class="page-head"><div><h1>Khách hàng</h1><p>Quản lý hồ sơ và doanh thu theo từng khách hàng.</p></div><div class="page-head-actions">' +
        '<button class="btn" id="cExport"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button>' +
        '<button class="btn btn-primary" id="cAdd"><i class="fa-solid fa-plus"></i>Thêm khách hàng</button></div></div>' +
        '<div class="kpi-row" id="cKpi"></div>' +
        '<div class="card"><div class="toolbar"><div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" id="cSearch" placeholder="Tìm theo họ tên hoặc số điện thoại…" value="' + U.esc(st.q) + '"></div></div><div id="cBody"></div></div>';
      body = U.$('#cBody', view); kpi = U.$('#cKpi', view);
      U.$('#cSearch', view).oninput = e => { st.q = e.target.value; st.page = 1; renderList(); };
      U.$('#cAdd', view).onclick = () => openForm();
      U.$('#cExport', view).onclick = exportData;
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
