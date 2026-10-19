/* ============================================================================
 * Phân hệ 3 — NHÀ CUNG CẤP
 * Mã NCC, tên NCC, địa chỉ, tỉnh thành, số ĐT, email, loại hình
 * (Nhà hàng, KS, Vận chuyển, Hàng không, HDV, Điểm tham quan), giá tiền.
 * Tìm kiếm theo Mã NCC / tên NCC / tỉnh thành; xuất dữ liệu ra file.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store, K = App.CONST;
  const st = { q: '', page: 1, type: '' };
  let body, kpi;

  function filtered() {
    const q = U.norm(st.q);
    return Store.state.suppliers.filter(s => (!st.type || s.type === st.type) &&
      (!q || U.norm(s.id).includes(q) || U.norm(s.name).includes(q) || U.norm(s.province).includes(q) || U.norm(s.address).includes(q))).slice().reverse();
  }
  const usage = id => { let n = 0; Store.state.tours.forEach(t => { n += t.budget.filter(l => l.supplierId === id).length; }); return n; };

  function renderList() {
    const all = Store.state.suppliers, rows = filtered();
    const byType = {}; all.forEach(s => { byType[s.type] = (byType[s.type] || 0) + 1; });
    kpi.innerHTML = U.mkpi({ icon: 'handshake', tone: 'blue', label: 'Tổng nhà cung cấp', value: U.fmt(all.length) }) +
      U.mkpi({ icon: 'hotel', tone: 'indigo', label: 'Khách sạn', value: byType['Khách sạn'] || 0 }) +
      U.mkpi({ icon: 'utensils', tone: 'orange', label: 'Nhà hàng', value: byType['Nhà hàng'] || 0 }) +
      U.mkpi({ icon: 'bus', tone: 'teal', label: 'Vận chuyển / Hàng không', value: (byType['Vận chuyển'] || 0) + (byType['Hàng không'] || 0) });
    body.innerHTML = U.table({
      rows, st, size: 10,
      empty: U.empty('building-circle-xmark', st.q || st.type ? 'Không tìm thấy nhà cung cấp' : 'Chưa có nhà cung cấp', st.q || st.type ? 'Thử tìm theo mã, tên hoặc tỉnh thành khác.' : 'Bấm “Thêm NCC” để tạo mới.'),
      cols: [
        { label: 'Mã NCC', render: s => '<span class="code">' + s.id + '</span>' },
        { label: 'Tên NCC', render: s => '<div class="cell-main">' + U.esc(s.name) + '</div><div class="cell-sub">' + U.esc(s.address) + '</div>' },
        { label: 'Loại hình', render: s => U.badge(s.type, K.SUPPLIER_TONE[s.type], true) },
        { label: 'Tỉnh thành', render: s => U.esc(s.province) },
        { label: 'Điện thoại', render: s => '<span class="nowrap">' + U.esc(s.phone) + '</span>' },
        { label: 'Email', render: s => s.email ? '<a href="mailto:' + U.esc(s.email) + '" style="color:var(--primary)">' + U.esc(s.email) + '</a>' : '<span class="muted">—</span>' },
        { label: 'Giá tiền', cls: 'right', render: s => '<b class="num">' + U.money(s.price) + '</b>' },
        { label: '', cls: 'right', render: s => '<div class="row-actions">' + U.iconBtn('edit', s.id, 'pen', 'Sửa') + U.iconBtn('del', s.id, 'trash', 'Xóa') + '</div>' }
      ]
    });
  }

  function exportData() {
    const rows = filtered().reverse();
    U.exportXlsx({
      filename: 'nha-cung-cap', sheet: 'Nhà cung cấp', title: 'DANH SÁCH NHÀ CUNG CẤP', subtitle: st.type ? 'Loại hình: ' + st.type : '',
      headers: ['Mã NCC', 'Tên NCC', 'Địa chỉ', 'Tỉnh thành', 'Điện thoại', 'Email', 'Loại hình', 'Giá tiền (₫)'],
      rows: rows.map(s => [s.id, s.name, s.address, s.province, s.phone, s.email, s.type, s.price]), moneyCols: [7]
    });
  }

  function openForm(id, onSaved) {
    const s = id ? C.supplier(id) : null;
    const code = s ? s.id : Store.peekId('NCC', 3);
    const html = '<div class="form-grid">' +
      U.field({ id: 'name', label: 'Tên nhà cung cấp', req: true, html: U.input({ id: 'name', value: s ? s.name : '', ph: 'VD: Khách sạn Biển Xanh' }) }) +
      U.field({ id: 'code', label: 'Mã NCC', html: U.input({ id: 'code', value: code, attrs: 'disabled' }) }) +
      U.field({ id: 'type', label: 'Loại hình', req: true, html: U.select({ id: 'type', ph: '— Chọn loại hình —', value: s ? s.type : '', options: K.SUPPLIER_TYPES.map(t => ({ v: t, l: t })) }) }) +
      U.field({ id: 'province', label: 'Tỉnh thành', req: true, html: U.input({ id: 'province', value: s ? s.province : '', ph: 'Chọn hoặc nhập tỉnh/thành', attrs: 'list="provList"' }) + '<datalist id="provList">' + K.PROVINCES.map(p => '<option value="' + p + '">').join('') + '</datalist>' }) +
      U.field({ id: 'phone', label: 'Số điện thoại', req: true, html: U.input({ id: 'phone', type: 'tel', value: s ? s.phone : '' }) }) +
      U.field({ id: 'email', label: 'Email', hint: 'Dùng để gửi booking cho NCC', html: U.input({ id: 'email', type: 'email', value: s ? s.email : '', ph: 'booking@example.com' }) }) +
      '</div>' +
      U.field({ id: 'address', label: 'Địa chỉ', html: U.input({ id: 'address', value: s ? s.address : '' }) }) +
      U.field({ id: 'price', label: 'Giá tiền (₫)', hint: 'Đơn giá tham chiếu — tự điền khi thêm vào dự trù tour, vẫn sửa được.', html: U.input({ id: 'price', money: true, value: s ? s.price : '' }) });
    U.modal({
      title: s ? 'Sửa nhà cung cấp ' + s.id : 'Thêm nhà cung cấp', size: 'md', static: true, body: html,
      foot: [{ label: 'Hủy' }, {
        label: s ? 'Lưu thay đổi' : 'Thêm NCC', icon: 'check', cls: 'btn-primary', onClick: h => {
          const b = h.body; U.clearErr(b); let ok = true;
          const d = { name: U.val(b, 'name'), type: U.val(b, 'type'), province: U.val(b, 'province'), phone: U.val(b, 'phone'), email: U.val(b, 'email'), address: U.val(b, 'address'), price: U.money$(b, 'price') };
          if (!d.name) ok = U.invalid(b, 'name', 'Vui lòng nhập tên NCC');
          if (!d.type) ok = U.invalid(b, 'type', 'Chọn loại hình');
          if (!d.province) ok = U.invalid(b, 'province', 'Nhập tỉnh thành');
          if (!/^\+?[\d\s.\-()]{8,16}$/.test(d.phone)) ok = U.invalid(b, 'phone', 'Số điện thoại không hợp lệ');
          if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) ok = U.invalid(b, 'email', 'Email không hợp lệ');
          if (!ok) { U.focusFirstInvalid(b); return; }
          let rec;
          if (s) { Object.assign(s, d); rec = s; U.toast('Đã cập nhật nhà cung cấp', s.id + ' – ' + s.name); }
          else { rec = Object.assign({ id: Store.nextId('NCC', 3) }, d); Store.state.suppliers.push(rec); U.toast('Đã thêm nhà cung cấp', rec.id + ' – ' + rec.name); }
          Store.save(); h.close(); if (onSaved) onSaved(rec); else if (body) renderList();
        }
      }]
    });
  }

  async function del(id) {
    const s = C.supplier(id); if (!s) return;
    const n = usage(id);
    if (n) { U.toast('Không thể xóa', s.name + ' đang được dùng trong ' + n + ' dòng dự trù tour.', 'warning'); return; }
    if (!(await U.confirm({ title: 'Xóa nhà cung cấp', message: 'Xóa nhà cung cấp <b>' + U.esc(s.name) + '</b> (' + s.id + ')?', ok: 'Xóa', danger: true }))) return;
    Store.state.suppliers = Store.state.suppliers.filter(x => x.id !== id); Store.save(); renderList(); U.toast('Đã xóa nhà cung cấp', id);
  }

  const mod = {
    title: 'Nhà cung cấp', group: 'Nghiệp vụ', icon: 'handshake',
    openForm,
    render(view) {
      st.q = App.Router.takeQ() || ''; st.page = 1; st.type = '';
      view.innerHTML = '<div class="page-head"><div><h1>Nhà cung cấp</h1><p>Nhà hàng, khách sạn, vận chuyển, hàng không, HDV và điểm tham quan.</p></div><div class="page-head-actions">' +
        '<button class="btn" id="sExport"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button>' +
        '<button class="btn btn-primary" id="sAdd"><i class="fa-solid fa-plus"></i>Thêm NCC</button></div></div>' +
        '<div class="kpi-row" id="sKpi"></div>' +
        '<div class="card"><div class="toolbar"><div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" id="sSearch" placeholder="Tìm theo mã NCC, tên NCC, tỉnh thành…" value="' + U.esc(st.q) + '"></div>' +
        '<select class="inp status-sel" id="sType"><option value="">Tất cả loại hình</option>' + K.SUPPLIER_TYPES.map(t => '<option>' + t + '</option>').join('') + '</select></div><div id="sBody"></div></div>';
      body = U.$('#sBody', view); kpi = U.$('#sKpi', view);
      U.$('#sSearch', view).oninput = e => { st.q = e.target.value; st.page = 1; renderList(); };
      U.$('#sType', view).onchange = e => { st.type = e.target.value; st.page = 1; renderList(); };
      U.$('#sAdd', view).onclick = () => openForm();
      U.$('#sExport', view).onclick = exportData;
      body.onclick = e => {
        if (U.pagerClick(e, st)) { renderList(); return; }
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'edit') openForm(b.dataset.id); else if (b.dataset.act === 'del') del(b.dataset.id);
      };
      renderList();
    }
  };
  App.mod.suppliers = mod; App.Router.register('suppliers', mod);
})();
