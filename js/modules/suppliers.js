/* ============================================================================
 * Phân hệ 3 — NHÀ CUNG CẤP
 * Mã NCC, tên NCC, địa chỉ, tỉnh thành, số ĐT, email, loại hình dịch vụ (Lưu trú, Vận chuyển,
 * Nhà hàng, Hướng dẫn viên, Vé tham quan… — chỉnh ở Hệ thống → Cài đặt), tiêu chuẩn 1*–5*,
 * người liên hệ (họ tên, chức vụ, số ĐT), giá tiền.
 * Bộ lọc kết hợp: loại hình + tiêu chuẩn + tỉnh/thành (VD: Lưu trú · 4* · Hà Nội).
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store, K = App.CONST;
  const st = { q: '', page: 1, type: '', standard: '', province: '' };
  let body, kpi, host;
  const dash = '<span class="muted">—</span>';

  function filtered() {
    const q = U.norm(st.q);
    return Store.state.suppliers.filter(s => (!st.type || s.type === st.type) && (!st.standard || s.standard === st.standard) && (!st.province || s.province === st.province) &&
      (!q || U.norm(s.id).includes(q) || U.norm(s.name).includes(q) || U.norm(s.province).includes(q) || U.norm(s.address).includes(q) || U.norm(s.contactName).includes(q))).slice().reverse();
  }
  const usage = id => { let n = 0; Store.state.tours.forEach(t => { n += t.budget.filter(l => l.supplierId === id).length; }); return n; };
  const provinces = () => Array.from(new Set(Store.state.suppliers.map(s => s.province).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi'));
  const typeOptions = () => { const set = K.serviceTypes().slice(); Store.state.suppliers.forEach(s => { if (s.type && !set.includes(s.type)) set.push(s.type); }); return set; };

  // Dựng lại các ô lọc (loại hình / tỉnh) khi dữ liệu đổi, giữ nguyên giá trị đang chọn nếu còn hợp lệ
  function fillFilters() {
    if (!host) return;
    const t = U.$('#sType', host), p = U.$('#sProv', host); if (!t || !p) return;
    const pv = provinces(), tv = typeOptions();
    if (st.type && !tv.includes(st.type)) st.type = ''; if (st.province && !pv.includes(st.province)) st.province = '';
    t.innerHTML = '<option value="">Tất cả loại hình</option>' + tv.map(x => '<option' + (x === st.type ? ' selected' : '') + '>' + U.esc(x) + '</option>').join('');
    p.innerHTML = '<option value="">Tất cả tỉnh/thành</option>' + pv.map(x => '<option' + (x === st.province ? ' selected' : '') + '>' + U.esc(x) + '</option>').join('');
  }

  function renderList() {
    const all = Store.state.suppliers, rows = filtered();
    const byType = {}; all.forEach(s => { byType[s.type] = (byType[s.type] || 0) + 1; });
    kpi.innerHTML = U.mkpi({ icon: 'handshake', tone: 'blue', label: 'Tổng nhà cung cấp', value: U.fmt(all.length), sub: rows.length !== all.length ? 'Đang lọc: ' + U.fmt(rows.length) : '' }) +
      U.mkpi({ icon: 'hotel', tone: 'indigo', label: K.STAY, value: byType[K.STAY] || 0 }) +
      U.mkpi({ icon: 'utensils', tone: 'orange', label: 'Nhà hàng', value: byType['Nhà hàng'] || 0 }) +
      U.mkpi({ icon: 'bus', tone: 'teal', label: 'Vận chuyển / Hàng không', value: (byType['Vận chuyển'] || 0) + (byType['Hàng không'] || 0) });
    const filtering = st.q || st.type || st.standard || st.province;
    body.innerHTML = U.table({
      rows, st, size: 10,
      empty: U.empty('building-circle-xmark', filtering ? 'Không tìm thấy nhà cung cấp' : 'Chưa có nhà cung cấp', filtering ? 'Thử đổi bộ lọc loại hình, tiêu chuẩn, tỉnh/thành hoặc từ khóa.' : 'Bấm “Thêm NCC” để tạo mới.'),
      cols: [
        { label: 'Mã NCC', render: s => '<span class="code">' + U.esc(s.id) + '</span>' },
        { label: 'Tên NCC', render: s => '<div class="cell-main">' + U.esc(s.name) + '</div><div class="cell-sub">' + U.esc(s.address) + '</div>' },
        { label: 'Loại hình', render: s => U.badge(s.type, K.tone(s.type), true) },
        { label: 'Tiêu chuẩn', cls: 'center', render: s => s.standard ? U.badge(s.standard, 'orange', true) : dash },
        { label: 'Tỉnh thành', render: s => U.esc(s.province) },
        { label: 'Điện thoại', render: s => '<span class="nowrap">' + U.esc(s.phone) + '</span>' },
        { label: 'Người liên hệ', render: s => s.contactName || s.contactPhone ? '<div class="cell-main">' + (U.esc(s.contactName) || dash) + '</div><div class="cell-sub">' + [U.esc(s.contactRole), s.contactPhone ? '<span class="nowrap">' + U.esc(s.contactPhone) + '</span>' : ''].filter(Boolean).join(' · ') + '</div>' : dash },
        { label: 'Email', render: s => s.email ? '<a href="mailto:' + U.esc(s.email) + '" style="color:var(--primary)">' + U.esc(s.email) + '</a>' : dash },
        { label: 'Giá tiền', cls: 'right', render: s => '<b class="num">' + U.money(s.price) + '</b>' },
        { label: '', cls: 'right', render: s => '<div class="row-actions">' + U.iconBtn('edit', s.id, 'pen', 'Sửa') + U.iconBtn('del', s.id, 'trash', 'Xóa') + '</div>' }
      ]
    });
  }

  function exportData() {
    const rows = filtered().reverse();
    U.exportXlsx({
      filename: 'nha-cung-cap', sheet: 'Nhà cung cấp', title: 'DANH SÁCH NHÀ CUNG CẤP',
      subtitle: [st.type ? 'Loại hình: ' + st.type : '', st.standard ? 'Tiêu chuẩn: ' + st.standard : '', st.province ? 'Tỉnh/thành: ' + st.province : ''].filter(Boolean).join(' · '),
      headers: ['Mã NCC', 'Tên NCC', 'Địa chỉ', 'Tỉnh thành', 'Loại hình', 'Tiêu chuẩn', 'Điện thoại', 'Email', 'Người liên hệ', 'Chức vụ', 'SĐT người liên hệ', 'Giá tiền (₫)'],
      rows: rows.map(s => [s.id, s.name, s.address, s.province, s.type, s.standard || '', s.phone, s.email, s.contactName || '', s.contactRole || '', s.contactPhone || '', s.price]), moneyCols: [11]
    });
  }

  // preset: { type } — dùng khi thêm nhanh NCC từ form dự trù (đã chọn sẵn loại hình)
  function openForm(id, onSaved, preset) {
    const s = id ? C.supplier(id) : null;
    const code = s ? s.id : Store.peekId('NCC', 3);
    const types = typeOptions(); if (s && s.type && !types.includes(s.type)) types.push(s.type);
    const startType = s ? s.type : ((preset && preset.type) || '');
    const html = '<div class="form-grid">' +
      U.field({ id: 'name', label: 'Tên nhà cung cấp', req: true, html: U.input({ id: 'name', value: s ? s.name : '', ph: 'VD: Khách sạn Biển Xanh' }) }) +
      U.field({ id: 'code', label: 'Mã NCC', html: U.input({ id: 'code', value: code, attrs: 'disabled' }) }) +
      U.field({ id: 'type', label: 'Loại hình dịch vụ', req: true, html: U.select({ id: 'type', ph: '— Chọn loại hình —', value: startType, options: types.map(t => ({ v: t, l: t })) }) }) +
      U.field({ id: 'standard', label: 'Tiêu chuẩn', hint: 'Số sao — dùng cho khách sạn / lưu trú', html: U.select({ id: 'standard', ph: '— Không áp dụng —', value: s ? s.standard : '', options: K.STANDARDS.map(x => ({ v: x, l: x })) }) }) +
      U.field({ id: 'province', label: 'Tỉnh thành', req: true, html: U.input({ id: 'province', value: s ? s.province : '', ph: 'Chọn hoặc nhập tỉnh/thành', attrs: 'list="provList"' }) + '<datalist id="provList">' + K.PROVINCES.map(p => '<option value="' + p + '">').join('') + '</datalist>' }) +
      U.field({ id: 'phone', label: 'Số điện thoại', req: true, html: U.input({ id: 'phone', type: 'tel', value: s ? s.phone : '' }) }) +
      U.field({ id: 'email', label: 'Email', hint: 'Dùng để gửi booking cho NCC', html: U.input({ id: 'email', type: 'email', value: s ? s.email : '', ph: 'booking@example.com' }) }) +
      U.field({ id: 'price', label: 'Giá tiền (₫)', hint: 'Đơn giá tham chiếu — tự điền khi thêm vào dự trù tour, vẫn sửa được.', html: U.input({ id: 'price', money: true, value: s ? s.price : '' }) }) + '</div>' +
      U.field({ id: 'address', label: 'Địa chỉ', html: U.input({ id: 'address', value: s ? s.address : '' }) }) +
      '<div class="form-sec-title"><i class="fa-solid fa-address-book"></i>Người liên hệ</div><div class="form-grid">' +
      U.field({ id: 'contactName', label: 'Người liên hệ', html: U.input({ id: 'contactName', value: s ? s.contactName : '', ph: 'Họ tên' }) }) +
      U.field({ id: 'contactRole', label: 'Chức vụ', html: U.input({ id: 'contactRole', value: s ? s.contactRole : '', ph: 'VD: Trưởng phòng kinh doanh' }) }) +
      U.field({ id: 'contactPhone', label: 'Số điện thoại người liên hệ', html: U.input({ id: 'contactPhone', type: 'tel', value: s ? s.contactPhone : '' }) }) + '</div>';
    U.modal({
      title: s ? 'Sửa nhà cung cấp ' + s.id : 'Thêm nhà cung cấp', size: 'md', static: true, body: html,
      foot: [{ label: 'Hủy' }, {
        label: s ? 'Lưu thay đổi' : 'Thêm NCC', icon: 'check', cls: 'btn-primary', onClick: h => {
          const b = h.body; U.clearErr(b); let ok = true;
          const d = { name: U.val(b, 'name'), type: U.val(b, 'type'), standard: U.val(b, 'standard'), province: U.val(b, 'province'), phone: U.val(b, 'phone'), email: U.val(b, 'email'), address: U.val(b, 'address'), price: U.money$(b, 'price'),
            contactName: U.val(b, 'contactName'), contactRole: U.val(b, 'contactRole'), contactPhone: U.val(b, 'contactPhone') };
          if (!d.name) ok = U.invalid(b, 'name', 'Vui lòng nhập tên NCC');
          if (!d.type) ok = U.invalid(b, 'type', 'Chọn loại hình');
          if (!d.province) ok = U.invalid(b, 'province', 'Nhập tỉnh thành');
          if (!/^\+?[\d\s.\-()]{8,16}$/.test(d.phone)) ok = U.invalid(b, 'phone', 'Số điện thoại không hợp lệ');
          if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) ok = U.invalid(b, 'email', 'Email không hợp lệ');
          if (d.contactPhone && !/^\+?[\d\s.\-()]{8,16}$/.test(d.contactPhone)) ok = U.invalid(b, 'contactPhone', 'Số điện thoại người liên hệ không hợp lệ');
          if (!ok) { U.focusFirstInvalid(b); return; }
          let rec;
          if (s) { Object.assign(s, d); rec = s; U.toast('Đã cập nhật nhà cung cấp', s.id + ' – ' + s.name); }
          else { rec = Object.assign({ id: Store.nextId('NCC', 3) }, d); Store.state.suppliers.push(rec); U.toast('Đã thêm nhà cung cấp', rec.id + ' – ' + rec.name); }
          Store.save(); h.close(); fillFilters(); if (onSaved) onSaved(rec); else if (body) renderList();
        }
      }]
    });
  }

  async function del(id) {
    const s = C.supplier(id); if (!s) return;
    const n = usage(id);
    if (n) { U.toast('Không thể xóa', s.name + ' đang được dùng trong ' + n + ' dòng dự trù tour.', 'warning'); return; }
    if (!(await U.confirm({ title: 'Xóa nhà cung cấp', message: 'Xóa nhà cung cấp <b>' + U.esc(s.name) + '</b> (' + s.id + ')?', ok: 'Xóa', danger: true }))) return;
    Store.state.suppliers = Store.state.suppliers.filter(x => x.id !== id); Store.save(); fillFilters(); renderList(); U.toast('Đã xóa nhà cung cấp', id);
  }

  const mod = {
    title: 'Nhà cung cấp', group: 'Nghiệp vụ', icon: 'handshake',
    openForm,
    render(view) {
      host = view; st.q = App.Router.takeQ() || ''; st.page = 1; st.type = ''; st.standard = ''; st.province = '';
      view.innerHTML = '<div class="page-head"><div><h1>Nhà cung cấp</h1><p>Lưu trú, nhà hàng, vận chuyển, hướng dẫn viên, vé tham quan… Lọc theo loại hình, tiêu chuẩn và tỉnh/thành.</p></div><div class="page-head-actions">' +
        '<button class="btn" id="sExport"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button>' +
        '<button class="btn btn-primary" id="sAdd"><i class="fa-solid fa-plus"></i>Thêm NCC</button></div></div>' +
        '<div class="kpi-row" id="sKpi"></div>' +
        '<div class="card"><div class="toolbar"><div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" id="sSearch" placeholder="Tìm theo mã NCC, tên NCC, người liên hệ…" value="' + U.esc(st.q) + '"></div>' +
        '<select class="inp status-sel" id="sType" title="Loại hình dịch vụ"></select>' +
        '<select class="inp status-sel" id="sStd" title="Tiêu chuẩn"><option value="">Tất cả tiêu chuẩn</option>' + K.STANDARDS.map(x => '<option>' + x + '</option>').join('') + '</select>' +
        '<select class="inp status-sel" id="sProv" title="Tỉnh/thành"></select>' +
        '<button class="btn btn-sm" id="sReset" title="Xóa bộ lọc"><i class="fa-solid fa-filter-circle-xmark"></i>Bỏ lọc</button></div><div id="sBody"></div></div>';
      body = U.$('#sBody', view); kpi = U.$('#sKpi', view); fillFilters();
      U.$('#sSearch', view).oninput = e => { st.q = e.target.value; st.page = 1; renderList(); };
      U.$('#sType', view).onchange = e => { st.type = e.target.value; st.page = 1; renderList(); };
      U.$('#sStd', view).onchange = e => { st.standard = e.target.value; st.page = 1; renderList(); };
      U.$('#sProv', view).onchange = e => { st.province = e.target.value; st.page = 1; renderList(); };
      U.$('#sReset', view).onclick = () => { st.q = st.type = st.standard = st.province = ''; st.page = 1; U.$('#sSearch', view).value = ''; U.$('#sStd', view).value = ''; fillFilters(); renderList(); };
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
