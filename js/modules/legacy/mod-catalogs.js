/* ============================================================================
 * MODULE: DANH MỤC QUY ƯỚC  (SRS · YC-02)
 * Quản lý các danh mục dùng làm ô chọn trong bảng Tham số đầu vào:
 * Thông số cấu kiện · Vật liệu · Đặc tính · Kiểu dáng · Hoàn thiện bề mặt ·
 * Đơn vị tính · Mẫu cấu kiện.
 * ==========================================================================*/

const CAT_TABS = [
  { id: 'productGroups', label: 'Thông số cấu kiện', icon: 'fa-shapes' },
  { id: 'materials',     label: 'Vật liệu',          icon: 'fa-cubes' },
  { id: 'properties',    label: 'Đặc tính / mác',    icon: 'fa-certificate' },
  { id: 'shapes',        label: 'Kiểu dáng',         icon: 'fa-vector-square' },
  { id: 'surfaces',      label: 'Hoàn thiện bề mặt', icon: 'fa-spray-can-sparkles' },
  { id: 'works',         label: 'Công việc gia công', icon: 'fa-screwdriver-wrench' },
  { id: 'units',         label: 'Đơn vị tính',       icon: 'fa-ruler' },
  { id: 'templates',     label: 'Mẫu cấu kiện',      icon: 'fa-clone' },
];

/** YC-02.9 — Đếm số cấu kiện đang dùng một giá trị của danh mục */
function catUsage(list, name) {
  const field = { productGroups: 'productGroup', materials: 'material', properties: 'property',
                  shapes: 'shape', surfaces: 'surface', units: 'unit' }[list];
  if (!field) return 0;
  let n = 0;
  DB.quotes.filter((q) => q.inputs).forEach((q) => q.inputs.forEach((r) => { if (r[field] === name) n++; }));
  return n;
}

/** Bảng danh mục dùng chung cho các tab */
function catTable(list, cols, rowsHTML) {
  return `<div style="padding:0">
    ${tableShell(cols.concat([{ t: 'Đang dùng', cls: 'center', w: '110px' }, { t: 'Thao tác', cls: 'right', w: '104px' }]), rowsHTML,
      { emptyTitle: 'Danh mục trống', emptyDesc: 'Bấm “Thêm mới” để bổ sung giá trị đầu tiên.' })}
  </div>`;
}

const catActions = (list, name) => rowActions([
  { act: 'cat-edit', data: `data-list="${list}" data-name="${esc(name)}"`, icon: 'fa-pen', title: 'Sửa' },
  { act: 'cat-del', data: `data-list="${list}" data-name="${esc(name)}"`, icon: 'fa-trash', title: 'Xóa' },
]);

Views.catalogs = function () {
  const tab = State.tab['catalogs'] || 'productGroups';
  const C = DB.catalogs;
  const f = F('catalogs', { q: '' });
  const q = (f.q || '').toLowerCase().trim();
  const hit = (s) => !q || String(s).toLowerCase().includes(q);

  let body = '';

  /* ---------- Thông số cấu kiện ---------- */
  if (tab === 'productGroups') {
    const list = C.productGroups.filter((x) => hit(x.name) || hit(x.formula));
    body = catTable('productGroups',
      [{ t: 'Thông số cấu kiện' }, { t: 'Cách tính khối lượng' }, { t: 'Công thức' }],
      list.map((x) => `<tr>
        <td class="strong">${esc(x.name)}</td>
        <td><span class="chip"><i class="fa-solid fa-calculator"></i>${esc((CACH_TINH_KHOI_LUONG[x.mode] || {}).label || '')}</span>
          <span class="muted" style="font-size:11px"> → ${esc((CACH_TINH_KHOI_LUONG[x.mode] || {}).unit || '')}</span></td>
        <td><code style="font-size:11.6px;background:var(--surface-3);padding:2px 7px;border-radius:5px">${esc(x.formula || '')}</code></td>
        <td class="center num">${catUsage('productGroups', x.name)}</td>
        <td>${catActions('productGroups', x.name)}</td></tr>`));
  }

  /* ---------- Vật liệu ---------- */
  if (tab === 'materials') {
    const list = C.materials.filter((x) => hit(x.name));
    body = catTable('materials',
      [{ t: 'Vật liệu' }, { t: 'Khối lượng riêng', cls: 'right' }, { t: 'Đơn giá đang áp dụng', cls: 'right' }],
      list.map((x) => `<tr>
        <td class="strong">${esc(x.name)}</td>
        <td class="right num">${fmtN(x.density)} kg/m³</td>
        <td class="right num">${fmtVND(DB.priceBook.materialBase[x.name] || 0)}/kg</td>
        <td class="center num">${catUsage('materials', x.name)}</td>
        <td>${catActions('materials', x.name)}</td></tr>`));
  }

  /* ---------- Đặc tính / mác ---------- */
  if (tab === 'properties') {
    const list = C.properties.filter((x) => hit(x.name) || hit(x.material));
    body = catTable('properties',
      [{ t: 'Đặc tính / mác vật liệu' }, { t: 'Thuộc vật liệu' }, { t: 'Đơn giá đang áp dụng', cls: 'right' }],
      list.map((x) => `<tr>
        <td class="strong">${esc(x.name)}</td>
        <td><span class="chip">${esc(x.material)}</span></td>
        <td class="right num">${fmtVND(DB.priceBook.material[x.name] || 0)}/kg</td>
        <td class="center num">${catUsage('properties', x.name)}</td>
        <td>${catActions('properties', x.name)}</td></tr>`));
  }

  /* ---------- Kiểu dáng ---------- */
  if (tab === 'shapes') {
    const list = C.shapes.filter((x) => hit(x.name));
    body = catTable('shapes',
      [{ t: 'Kiểu dáng (dạng phôi)' }, { t: 'Cách tính tiết diện' }],
      list.map((x) => `<tr>
        <td class="strong">${esc(x.name)}</td>
        <td><span class="chip">${esc(CACH_TINH_TIET_DIEN[x.section])}</span></td>
        <td class="center num">${catUsage('shapes', x.name)}</td>
        <td>${catActions('shapes', x.name)}</td></tr>`));
  }

  /* ---------- Hoàn thiện bề mặt (danh mục đầy đủ) ---------- */
  if (tab === 'surfaces') {
    const list = C.surfaces.filter((x) => hit(x.name));
    const dg = (s) => (s.basis === 'thickness'
      ? `<span class="chip"><i class="fa-solid fa-layer-group"></i>${(s.tiers || []).length} bậc theo chiều dày</span>`
      : `<b class="num">${fmtVND(s.rate)}</b> <span class="muted">${esc((CO_SO_TINH[s.basis] || {}).unit || '')}</span>`);
    body = catTable('surfaces',
      [{ t: 'Hoàn thiện bề mặt' }, { t: 'Hình thức' }, { t: 'Cơ sở tính đơn giá' }, { t: 'Đơn giá áp dụng', cls: 'right' }],
      list.map((x) => `<tr class="clickable" data-act="cat-open-service" data-name="${esc(x.name)}">
        <td class="strong">${esc(x.name)}</td>
        <td>${x.outsource ? '<span class="badge orange">Thuê ngoài</span>' : '<span class="badge slate no-dot">Làm tại xưởng</span>'}</td>
        <td><span class="chip">${esc((CO_SO_TINH[x.basis] || {}).label || '')}</span></td>
        <td class="right">${dg(x)}</td>
        <td class="center num">${catUsage('surfaces', x.name)}</td>
        <td>${catActions('surfaces', x.name)}</td></tr>`));
  }

  /* ---------- Công việc gia công: NỘI BỘ và THUÊ NGOÀI (YC-03 + YC-04) ---------- */
  if (tab === 'works') {
    const noiBo = C.operations.filter((x) => hit(x.name) || hit(x.workshop));
    const thueNgoai = C.surfaces.filter((x) => x.outsource && hit(x.name));
    const tuXuong = C.surfaces.filter((x) => !x.outsource && hit(x.name));

    // Đếm số cấu kiện đang khai một nguyên công
    const opUsage = (key) => {
      let n = 0;
      DB.quotes.filter((q) => q.inputs).forEach((q) => q.inputs.forEach((r) => { if (Number(r.ops?.[key]) > 0) n++; }));
      return n;
    };

    const dgCell = (s) => (s.basis === 'thickness'
      ? `<span class="chip"><i class="fa-solid fa-layer-group"></i>${(s.tiers || []).length} bậc · ${fmtVND(Math.min(...(s.tiers || [{ rate: s.rate }]).map((b) => Number(b.rate))))} – ${fmtVND(Math.max(...(s.tiers || [{ rate: s.rate }]).map((b) => Number(b.rate))))}/kg</span>`
      : `<b class="num">${fmtVND(s.rate)}</b> <span class="muted">${esc((CO_SO_TINH[s.basis] || {}).unit || '')}</span>`);

    body = `<div style="padding:16px 18px">

      <!-- ===== MỤC LỚN 1: SẢN XUẤT NỘI BỘ ===== -->
      <div class="card" style="margin-bottom:16px;border-left:3px solid var(--indigo)">
        <div class="card-head">
          <span class="mkpi-ico t-indigo"><i class="fa-solid fa-industry"></i></span>
          <div><h3>Sản xuất nội bộ</h3><p>Các nguyên công làm tại xưởng — mỗi loại là một cột trong bảng tham số đầu vào</p></div>
          <div class="right"><button class="btn btn-sm btn-primary" data-act="op-add"><i class="fa-solid fa-plus"></i>Thêm nguyên công</button></div>
        </div>
        ${tableShell(
          [{ t: 'Nguyên công' }, { t: 'Phân xưởng' }, { t: 'Cơ sở tính đơn giá' }, { t: 'Đơn giá', cls: 'right' },
           { t: 'Công đoạn tương ứng' }, { t: 'Đang dùng', cls: 'center' }, { t: 'Thao tác', cls: 'right', w: '104px' }],
          noiBo.map((n) => `<tr>
            <td class="strong">${esc(n.name)}</td>
            <td><span class="chip"><i class="fa-solid ${STAGE_ICON[n.workshop] || 'fa-gear'}"></i>${esc(n.workshop || '—')}</span></td>
            <td><span class="chip">${esc((CO_SO_TINH[n.basis] || {}).label || '')}</span></td>
            <td class="right"><b class="num">${fmtVND(n.rate)}</b> <span class="muted">${esc((CO_SO_TINH[n.basis] || {}).unit || '')}</span></td>
            <td>${(n.ops || []).map((id) => { const o = Q.operation(id); return o ? `<span class="chip" title="${esc(o.machine)}">${esc(o.id)}</span>` : ''; }).join(' ') || '<span class="muted">—</span>'}</td>
            <td class="center num">${opUsage(n.key)}</td>
            <td>${rowActions([
              { act: 'op-edit', data: `data-key="${esc(n.key)}"`, icon: 'fa-pen', title: 'Sửa' },
              { act: 'op-del', data: `data-key="${esc(n.key)}"`, icon: 'fa-trash', title: 'Xóa' },
            ])}</td></tr>`),
          { emptyTitle: 'Chưa có nguyên công nào' })}
      </div>

      <!-- ===== MỤC LỚN 2: THUÊ BÊN NGOÀI ===== -->
      <div class="card" style="margin-bottom:16px;border-left:3px solid var(--orange)">
        <div class="card-head">
          <span class="mkpi-ico t-orange"><i class="fa-solid fa-truck-ramp-box"></i></span>
          <div><h3>Thuê bên ngoài</h3><p>Mạ điện, mạ kẽm nhúng nóng, sơn ngoài… — đơn giá phụ thuộc khối lượng, độ dày hoặc thể tích</p></div>
          <div class="right"><button class="btn btn-sm btn-primary" data-act="sv-add" data-outsource="1"><i class="fa-solid fa-plus"></i>Thêm dịch vụ</button></div>
        </div>
        ${tableShell(
          [{ t: 'Dịch vụ thuê ngoài' }, { t: 'Cơ sở tính đơn giá' }, { t: 'Đơn giá áp dụng', cls: 'right' },
           { t: 'Cách tính chi phí' }, { t: 'Đang dùng', cls: 'center' }, { t: 'Thao tác', cls: 'right', w: '104px' }],
          thueNgoai.map((s) => `<tr class="clickable" data-act="cat-open-service" data-name="${esc(s.name)}">
            <td class="strong">${esc(s.name)}</td>
            <td><span class="chip"><i class="fa-solid fa-scale-balanced"></i>${esc((CO_SO_TINH[s.basis] || {}).label || '')}</span></td>
            <td class="right">${dgCell(s)}</td>
            <td class="muted" style="font-size:11.8px">${esc({
              kg: 'Đơn giá × khối lượng phôi (kg)',
              m2: 'Đơn giá × diện tích bề mặt (m²)',
              m3: 'Đơn giá × thể tích khối phôi (m³)',
              thickness: 'Chọn bậc theo chiều dày rồi × khối lượng phôi',
              lan: 'Đơn giá × số cấu kiện',
            }[s.basis] || '')}</td>
            <td class="center num">${catUsage('surfaces', s.name)}</td>
            <td>${rowActions([
              { act: 'cat-open-service', data: `data-name="${esc(s.name)}"`, icon: 'fa-eye', title: 'Xem / sửa bậc giá' },
              { act: 'cat-del', data: `data-list="surfaces" data-name="${esc(s.name)}"`, icon: 'fa-trash', title: 'Xóa' },
            ])}</td></tr>`),
          { emptyTitle: 'Chưa có dịch vụ thuê ngoài' })}
      </div>

      <!-- ===== Hoàn thiện bề mặt làm tại xưởng ===== -->
      <div class="card">
        <div class="card-head">
          <span class="mkpi-ico t-teal"><i class="fa-solid fa-spray-can-sparkles"></i></span>
          <div><h3>Hoàn thiện bề mặt làm tại xưởng</h3><p>${tuXuong.length} loại — sơn tĩnh điện, sơn phủ, sơn chống gỉ… thực hiện trong xưởng</p></div>
          <div class="right"><button class="btn btn-sm" data-act="cat-tab" data-tab="surfaces"><i class="fa-solid fa-arrow-right"></i>Quản lý ở tab Hoàn thiện bề mặt</button></div>
        </div>
      </div>
    </div>`;
  }

  /* ---------- Đơn vị tính ---------- */
  if (tab === 'units') {
    const list = C.units.filter((x) => hit(x.name));
    body = catTable('units', [{ t: 'Đơn vị tính' }],
      list.map((x) => `<tr>
        <td class="strong">${esc(x.name)}</td>
        <td class="center num">${catUsage('units', x.name)}</td>
        <td>${catActions('units', x.name)}</td></tr>`));
  }

  /* ---------- Mẫu cấu kiện (YC-01.10) ---------- */
  if (tab === 'templates') {
    const list = DB.ckTemplates.filter((t) => hit(t.name) || hit(t.group));
    body = `<div style="padding:0">
      ${tableShell(
        [{ t: 'Mã mẫu', w: '96px' }, { t: 'Tên mẫu' }, { t: 'Thông số cấu kiện' }, { t: 'Quy cách tóm tắt' },
         { t: 'Số lần dùng', cls: 'center' }, { t: 'Ngày tạo' }, { t: 'Thao tác', cls: 'right', w: '104px' }],
        [...list].sort((a, b) => b.used - a.used).map((t) => `<tr class="clickable" data-act="tpl-view" data-id="${t.id}">
          <td><span class="code">${t.id}</span></td>
          <td class="strong">${esc(t.name)}</td>
          <td><span class="chip">${esc(t.group)}</span></td>
          <td class="muted">${esc(tomTatMau(t))}</td>
          <td class="center num">${t.used}</td>
          <td class="num">${fmtDate(t.createdAt)}</td>
          <td>${rowActions([
            { act: 'tpl-view', data: `data-id="${t.id}"`, icon: 'fa-eye', title: 'Xem tham số' },
            { act: 'tpl-rename', data: `data-id="${t.id}"`, icon: 'fa-pen', title: 'Đổi tên' },
            { act: 'tpl-del', data: `data-id="${t.id}"`, icon: 'fa-trash', title: 'Xóa mẫu' },
          ])}</td></tr>`),
        { emptyTitle: 'Chưa có mẫu nào', emptyDesc: 'Mở một báo giá, bấm mũi tên cuối dòng cấu kiện rồi chọn “Lưu thành mẫu”.' })}
    </div>`;
  }

  const canAdd = tab !== 'templates';

  return `
  ${pageHead('Danh mục quy ước', 'Quản lý các danh mục dùng làm ô chọn trong bảng tham số đầu vào của báo giá', `
    <button class="btn" data-act="export-catalogs"><i class="fa-solid fa-file-export"></i>Export</button>
    ${canAdd ? `<button class="btn btn-primary" data-act="cat-add" data-list="${tab}"><i class="fa-solid fa-plus"></i>Thêm mới</button>` : ''}
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Thông số cấu kiện', C.productGroups.length, 'fa-shapes', 'blue')}
    ${mkpi('Vật liệu', C.materials.length, 'fa-cubes', 'teal')}
    ${mkpi('Đặc tính / mác', C.properties.length, 'fa-certificate', 'indigo')}
    ${mkpi('Kiểu dáng', C.shapes.length, 'fa-vector-square', 'orange')}
    ${mkpi('Hoàn thiện bề mặt', C.surfaces.length, 'fa-spray-can-sparkles', 'green')}
    ${mkpi('Mẫu cấu kiện', DB.ckTemplates.length, 'fa-clone', 'red', 'cat-tab-templates')}
  </div>

  <div class="card">
    <div class="tabs">
      ${CAT_TABS.map((t) => `<button class="tab ${tab === t.id ? 'active' : ''}" data-act="cat-tab" data-tab="${t.id}">
        <i class="fa-solid ${t.icon}"></i> ${esc(t.label)}
        <span class="cnt">${t.id === 'templates' ? DB.ckTemplates.length
          : t.id === 'works' ? NGUYEN_CONG.length + C.surfaces.length
          : C[t.id].length}</span></button>`).join('')}
    </div>
    <div class="toolbar">
      ${searchBox('catalogs', 'Tìm trong danh mục…')}
      ${f.q ? '<button class="btn btn-sm" data-act="clear-filter" data-key="catalogs"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-circle-info"></i> Giá trị thêm mới xuất hiện ngay trong ô chọn của bảng tham số đầu vào</span>
    </div>
    ${body}
  </div>`;
};

/* ------------------------------ FORM THÊM / SỬA DANH MỤC ---------------- */
/* ------------- YC-05.3 · Xem trước kết quả công thức khi đang gõ ---------- */
let CT_TEST = { L: 1000, W: 300, H: 50, D: 0, W1: 20, H1: 12, S: 0, T: 1.5, material: 'Thép' };

function veXemTruocCongThuc() {
  const box = $('#ctPreview');
  if (!box) return;
  const mode = $('#catMode').value;
  const ct = $('#catFormula').value;
  const field = $('#modalHost [data-field="formula"]');
  const desc = $('#catModeDesc');
  if (desc) desc.textContent = (CACH_TINH_KHOI_LUONG[mode] || {}).desc || '';

  const rho = tyTrong(CT_TEST.material);
  const vars = {
    L: +CT_TEST.L || 0, W: +CT_TEST.W || 0, H: +CT_TEST.H || 0, D: +CT_TEST.D || 0,
    W1: +CT_TEST.W1 || 0, H1: +CT_TEST.H1 || 0, S: +CT_TEST.S || 0, T: +CT_TEST.T || 0,
    RHO: rho, N: 1, Q: 1, PI: Math.PI,
  };
  const kq = thuCongThuc(ct, vars);

  if (!kq.ok) {
    field.classList.add('invalid');
    $('#catFormulaErr').textContent = kq.error;
    box.innerHTML = `<div class="alert-item" style="cursor:default;border-color:var(--red)">
        <span class="alert-ico t-red"><i class="fa-solid fa-triangle-exclamation"></i></span>
        <span><span class="alert-title">Công thức chưa hợp lệ</span>
        <div class="alert-sub">${esc(kq.error)}</div></span></div>`;
    return;
  }
  field.classList.remove('invalid');

  const daiM = (vars.L || 0) / 1000;
  const t = vars.T;
  let kg = 0;
  switch (mode) {
    case 'tietDien': kg = (kq.value / 1e6) * rho * daiM; break;
    case 'kgm':      kg = kq.value * daiM; break;
    case 'theTich':  kg = kq.value * rho; break;
    case 'kgCk':     kg = kq.value; break;
    default:         kg = (kq.value / 1000) * (t / 1000) * rho * daiM;
  }
  const unit = (CACH_TINH_KHOI_LUONG[mode] || {}).unit || '';

  box.innerHTML = `
    <div class="stat-strip">
      <div><div class="l">Kết quả công thức</div><div class="v" style="font-size:15px;color:var(--primary)">${fmtDec(kq.value, 3)} ${esc(unit)}</div></div>
      <div><div class="l">Khối lượng ${vars.L ? '1 cấu kiện dài ' + fmtDec(daiM, 3) + ' m' : '1 cấu kiện'}</div>
        <div class="v" style="font-size:15px;color:var(--teal)">${fmtDec(kg, 3)} kg</div></div>
      <div><div class="l">Quy đổi trên 1 mét</div><div class="v" style="font-size:15px">${daiM ? fmtDec(kg / daiM, 3) : '—'} kg/m</div></div>
    </div>
    <div style="margin-top:9px;font-size:12.2px;color:var(--text-3);line-height:1.7">
      Cách quy đổi: ${esc((CACH_TINH_KHOI_LUONG[mode] || {}).desc || '')} · tỷ trọng ${esc(CT_TEST.material)} = ${fmtN(rho)} kg/m³
    </div>`;
}

/** Lưu danh mục — YC-02.11 đổi tên cập nhật dây chuyền, YC-02.12 chặn trùng tên */
function saveCatalog(list, oldName) {
  const nameEl = $('#catName');
  const name = nameEl.value.trim();
  const field = $('#modalHost [data-field="name"]');
  field.classList.remove('invalid');

  const trung = DB.catalogs[list].some((x) => x.name.toLowerCase() === name.toLowerCase() && x.name !== oldName);
  if (!name || trung) {
    field.classList.add('invalid');
    Toast.err(trung ? 'Tên bị trùng' : 'Thiếu tên', trung ? `“${name}” đã có trong danh mục.` : 'Vui lòng nhập tên.');
    return;
  }

  const item = oldName ? DB.catalogs[list].find((x) => x.name === oldName) : {};
  if (list === 'productGroups') {
    /* YC-05.5 — công thức sai cú pháp thì không cho lưu */
    const ct = $('#catFormula').value.trim();
    const thu = thuCongThuc(ct, { L: 1000, W: 300, H: 50, D: 100, W1: 20, H1: 12, S: 300, T: 1.5, RHO: 7850, N: 1, Q: 1, PI: Math.PI });
    if (!thu.ok) {
      $('#modalHost [data-field="formula"]').classList.add('invalid');
      $('#catFormulaErr').textContent = thu.error;
      Toast.err('Công thức không hợp lệ', thu.error + ' — chưa lưu được, công thức cũ giữ nguyên.');
      return;
    }
    item.mode = $('#catMode').value;
    item.formula = ct;
    item.kind = item.kind || 'than';
  }
  if (list === 'materials') item.density = Number($('#catDensity').value) || 7850;
  if (list === 'properties') item.material = $('#catMaterial').value;
  if (list === 'shapes') item.section = $('#catSection').value;
  if (list === 'surfaces') item.outsource = $('#catOutsource').value === '1';
  item.name = name;

  /* YC-02.13 — phát sinh dòng đơn giá tương ứng */
  const price = $('#catPrice') ? Number($('#catPrice').value) || 0 : 0;
  if (list === 'materials') { if (oldName) delete DB.priceBook.materialBase[oldName]; DB.priceBook.materialBase[name] = price; }
  if (list === 'properties') { if (oldName) delete DB.priceBook.material[oldName]; DB.priceBook.material[name] = price; }
  if (list === 'surfaces') { if (oldName) delete DB.priceBook.surface[oldName]; DB.priceBook.surface[name] = price; }

  let capNhat = 0;
  if (oldName) {
    /* YC-02.11 — đổi tên thì cập nhật toàn bộ dòng tham số đang tham chiếu */
    if (oldName !== name) {
      const f = { productGroups: 'productGroup', materials: 'material', properties: 'property',
                  shapes: 'shape', surfaces: 'surface', units: 'unit' }[list];
      DB.quotes.filter((q) => q.inputs).forEach((q) => q.inputs.forEach((r) => {
        if (r[f] === oldName) { r[f] = name; capNhat++; }
      }));
      DB.ckTemplates.forEach((t) => { if (t.data[f] === oldName) { t.data[f] = name; if (f === 'productGroup') t.group = name; } });
    }
  } else {
    DB.catalogs[list].push(item);
  }

  Modal.close();
  render();
  Toast.ok(oldName ? 'Đã cập nhật danh mục' : 'Đã thêm vào danh mục',
    oldName
      ? (capNhat ? `“${name}” · đã cập nhật ${capNhat} cấu kiện đang dùng` : `“${name}”`)
      : `“${name}” đã sẵn sàng để chọn trong bảng tham số đầu vào`);
}

/** Xóa danh mục — YC-02.10 chặn nếu đang được sử dụng */
function deleteCatalog(list, name) {
  const dung = catUsage(list, name);
  if (dung) {
    Toast.err('Không xóa được', `“${name}” đang được ${dung} cấu kiện sử dụng. Hãy đổi các cấu kiện đó sang giá trị khác trước.`);
    return;
  }
  confirmBox({
    title: 'Xóa khỏi danh mục',
    message: `Xóa <b>“${esc(name)}”</b> khỏi danh mục ${esc(CAT_META[list].title.toLowerCase())}?<br/>Giá trị này hiện không được cấu kiện nào sử dụng.`,
    okText: 'Xóa',
    onOk: () => {
      DB.catalogs[list] = DB.catalogs[list].filter((x) => x.name !== name);
      if (list === 'materials') delete DB.priceBook.materialBase[name];
      if (list === 'properties') delete DB.priceBook.material[name];
      if (list === 'surfaces') delete DB.priceBook.surface[name];
      render();
      Toast.ok('Đã xóa', name);
    },
  });
}

// /* ================= YC-03 · THÊM / SỬA / XÓA LOẠI NGUYÊN CÔNG ============= */
// function openOperationForm(key) {
//   const n = key ? NGUYEN_CONG.find((x) => x.key === key) : null;
//   const coSoNoiBo = Object.entries(CO_SO_TINH).filter(([, v]) => v.noiBo);

//   Modal.open({
//     title: n ? 'Sửa loại nguyên công' : 'Thêm loại nguyên công',
//     sub: n ? `Mã trường: ${n.key}` : 'Nguyên công mới sẽ thành một cột mới trong bảng tham số đầu vào',
//     body: `<div class="field" data-field="name"><label>Tên nguyên công <span class="req">*</span></label>
//         <input class="inp" id="opName" value="${esc(n?.name || '')}" placeholder="Ví dụ: Đột lỗ CNC" />
//         <div class="err">Tên không được để trống hoặc trùng nguyên công đã có</div></div>
//       <div class="form-grid">
//         <div class="field"><label>Phân xưởng thực hiện</label>
//           <select class="inp" id="opWorkshop">
//             ${DB.workshopNames.map((w) => `<option ${n?.workshop === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}
//           </select></div>
//         <div class="field"><label>Cơ sở tính đơn giá <span class="req">*</span></label>
//           <select class="inp" id="opBasis">
//             ${coSoNoiBo.map(([k, v]) => `<option value="${k}" ${n?.basis === k ? 'selected' : ''}>${esc(v.label)} (${esc(v.unit)})</option>`).join('')}
//           </select></div>
//       </div>
//       <div class="field"><label>Đơn giá</label>
//         <input class="inp num right" type="number" min="0" step="1000" id="opRate" data-money="1" value="${n?.rate || 0}" /></div>
//       <div style="font-size:12.3px;color:var(--text-3);background:var(--surface-2);border-radius:var(--r);padding:10px 12px;line-height:1.7">
//         <i class="fa-solid fa-circle-info" style="color:var(--primary)"></i>
//         <b>Theo lần</b>: đơn giá × số lần khai × số cấu kiện × số lượng sản phẩm.
//         <b>Theo kg</b>: đơn giá × khối lượng phôi. <b>Theo m²</b>: đơn giá × diện tích bề mặt.
//       </div>`,
//     foot: `<button class="btn" data-act="modal-close">Hủy</button>
//            <button class="btn btn-primary" data-act="op-save" data-key="${esc(key || '')}"><i class="fa-solid fa-floppy-disk"></i>${n ? 'Lưu thay đổi' : 'Thêm nguyên công'}</button>`,
//   });
// }

function saveOperation(key) {
  const name = $('#opName').value.trim();
  const field = $('#modalHost [data-field="name"]');
  field.classList.remove('invalid');
  const trung = NGUYEN_CONG.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.key !== key);
  if (!name || trung) {
    field.classList.add('invalid');
    Toast.err(trung ? 'Tên bị trùng' : 'Thiếu tên', trung ? `“${name}” đã có trong danh mục nguyên công.` : 'Vui lòng nhập tên nguyên công.');
    return;
  }
  const data = { name, workshop: $('#opWorkshop').value, basis: $('#opBasis').value, rate: Number($('#opRate').value) || 0 };

  if (key) {
    Object.assign(NGUYEN_CONG.find((x) => x.key === key), data);
  } else {
    // Sinh khóa trường không dấu, không trùng
    const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
      .replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/)
      .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('');
    let k = base || 'nc';
    let i = 2;
    while (NGUYEN_CONG.some((x) => x.key === k)) k = base + i++;
    NGUYEN_CONG.push({ key: k, ops: [], ...data });
  }
  Modal.close();
  render();
  Toast.ok(key ? 'Đã cập nhật nguyên công' : 'Đã thêm nguyên công',
    key ? name : `“${name}” đã thành một cột mới trong bảng tham số đầu vào`);
}

function deleteOperation(key) {
  const n = NGUYEN_CONG.find((x) => x.key === key);
  if (!n) return;
  let dung = 0;
  DB.quotes.filter((q) => q.inputs).forEach((q) => q.inputs.forEach((r) => { if (Number(r.ops?.[key]) > 0) dung++; }));
  if (dung) { Toast.err('Không xóa được', `“${n.name}” đang được ${dung} cấu kiện khai số lần. Hãy đưa các cấu kiện đó về 0 trước.`); return; }
  confirmBox({
    title: 'Xóa loại nguyên công',
    message: `Xóa nguyên công <b>“${esc(n.name)}”</b> khỏi danh mục? Cột tương ứng trong bảng tham số đầu vào sẽ biến mất.`,
    okText: 'Xóa',
    onOk: () => {
      const i = NGUYEN_CONG.findIndex((x) => x.key === key);
      NGUYEN_CONG.splice(i, 1);
      render();
      Toast.ok('Đã xóa nguyên công', n.name);
    },
  });
}

/* ============ YC-04 · DỊCH VỤ XỬ LÝ: CƠ SỞ TÍNH & BẬC THEO CHIỀU DÀY ===== */
// function openServiceForm(name, forceOutsource) {
//   const s = name ? DB.catalogs.surfaces.find((x) => x.name === name) : null;
//   const outsource = s ? s.outsource : forceOutsource === '1';
//   const basis = s ? s.basis : (outsource ? 'kg' : 'm2');
//   const tiers = s ? (s.tiers || []) : [];

//   const tierRows = (list) => list.map((b, i) => `<tr>
//       <td><input class="inp right num" type="number" min="0" step="0.1" data-tier="from" data-i="${i}" value="${b.from}" style="width:100%" /></td>
//       <td><input class="inp right num" type="number" min="0" step="0.1" data-tier="to" data-i="${i}" value="${b.to || ''}" placeholder="∞" style="width:100%" /></td>
//       <td><input class="inp right num" type="number" min="0" step="100" data-tier="rate" data-i="${i}" value="${b.rate}" style="width:100%" /></td>
//       <td class="center"><button class="btn btn-icon btn-xs" data-act="sv-tier-del" data-i="${i}"><i class="fa-solid fa-xmark"></i></button></td>
//     </tr>`).join('');

//   Modal.open({
//     title: s ? `Sửa ${outsource ? 'dịch vụ thuê ngoài' : 'loại hoàn thiện bề mặt'}` : `Thêm ${outsource ? 'dịch vụ thuê ngoài' : 'loại hoàn thiện bề mặt'}`,
//     sub: s ? `Đang có ${catUsage('surfaces', s.name)} cấu kiện sử dụng` : 'Xuất hiện ngay trong ô chọn Hoàn thiện bề mặt của bảng tham số đầu vào',
//     size: 'md',
//     body: `<div class="field" data-field="name"><label>Tên ${outsource ? 'dịch vụ' : 'loại hoàn thiện'} <span class="req">*</span></label>
//         <input class="inp" id="svName" value="${esc(s?.name || '')}" placeholder="${outsource ? 'Ví dụ: Mạ crom cứng' : 'Ví dụ: Sơn PU 2 thành phần'}" />
//         <div class="err">Tên không được để trống hoặc trùng giá trị đã có</div></div>

//       <div class="form-grid">
//         <div class="field"><label>Hình thức thực hiện</label>
//           <select class="inp" id="svOutsource">
//             <option value="0" ${!outsource ? 'selected' : ''}>Làm tại xưởng</option>
//             <option value="1" ${outsource ? 'selected' : ''}>Thuê bên ngoài</option>
//           </select></div>
//         <div class="field"><label>Cơ sở tính đơn giá <span class="req">*</span></label>
//           <select class="inp" id="svBasis" data-act="sv-basis-change">
//             ${Object.entries(CO_SO_TINH).filter(([k]) => k !== 'lan').map(([k, v]) => `<option value="${k}" ${basis === k ? 'selected' : ''}>${esc(v.label)} (${esc(v.unit)})</option>`).join('')}
//           </select></div>
//       </div>

//       <div class="field ${basis === 'thickness' ? 'hidden' : ''}" id="svRateBox"><label>Đơn giá</label>
//         <input class="inp num right" type="number" min="0" step="500" id="svRate" data-money="1" value="${s?.rate || 0}" /></div>

//       <div id="svTierBox" class="${basis === 'thickness' ? '' : 'hidden'}">
//         <div class="form-sec-title"><i class="fa-solid fa-layer-group"></i>Bậc giá theo chiều dày
//           <button class="btn btn-xs" data-act="sv-tier-add" style="margin-left:auto"><i class="fa-solid fa-plus"></i>Thêm bậc</button>
//         </div>
//         <div class="tbl-wrap" style="border:1px solid var(--border);border-radius:var(--r)">
//           <table class="line-tbl" style="min-width:420px">
//             <thead><tr><th class="right">Từ dày (mm)</th><th class="right">Đến dày (mm)</th><th class="right">Đơn giá (đ/kg)</th><th style="width:42px"></th></tr></thead>
//             <tbody id="svTiers">${tierRows(tiers)}</tbody>
//           </table>
//         </div>
//         <div style="font-size:12.2px;color:var(--text-3);margin-top:8px;line-height:1.7">
//           Để trống ô <b>Đến dày</b> ở bậc cuối nghĩa là “trở lên”. Hệ thống chọn bậc theo chiều dày thực tế của cấu kiện,
//           rồi nhân đơn giá bậc đó với khối lượng phôi.
//         </div>
//       </div>`,
//     foot: `<button class="btn" data-act="modal-close">Hủy</button>
//            <button class="btn btn-primary" data-act="sv-save" data-old="${esc(s?.name || '')}"><i class="fa-solid fa-floppy-disk"></i>${s ? 'Lưu thay đổi' : 'Thêm mới'}</button>`,
//     onMount: () => { SV_TIERS = tiers.map((b) => ({ ...b })); },
//   });
// }

/** Bậc giá đang soạn trong form dịch vụ */
let SV_TIERS = [];

function svRedrawTiers() {
  const tb = $('#svTiers');
  if (!tb) return;
  tb.innerHTML = SV_TIERS.map((b, i) => `<tr>
      <td><input class="inp right num" type="number" min="0" step="0.1" data-tier="from" data-i="${i}" value="${b.from}" style="width:100%" /></td>
      <td><input class="inp right num" type="number" min="0" step="0.1" data-tier="to" data-i="${i}" value="${b.to || ''}" placeholder="∞" style="width:100%" /></td>
      <td><input class="inp right num" type="number" min="0" step="100" data-tier="rate" data-i="${i}" value="${b.rate}" style="width:100%" /></td>
      <td class="center"><button class="btn btn-icon btn-xs" data-act="sv-tier-del" data-i="${i}"><i class="fa-solid fa-xmark"></i></button></td>
    </tr>`).join('');
}

function saveService(oldName) {
  const name = $('#svName').value.trim();
  const field = $('#modalHost [data-field="name"]');
  field.classList.remove('invalid');
  const trung = DB.catalogs.surfaces.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.name !== oldName);
  if (!name || trung) {
    field.classList.add('invalid');
    Toast.err(trung ? 'Tên bị trùng' : 'Thiếu tên', trung ? `“${name}” đã có trong danh mục.` : 'Vui lòng nhập tên.');
    return;
  }
  const basis = $('#svBasis').value;
  const data = {
    name,
    outsource: $('#svOutsource').value === '1',
    basis,
    rate: basis === 'thickness' ? (SV_TIERS[0]?.rate || 0) : (Number($('#svRate').value) || 0),
    tiers: basis === 'thickness' ? SV_TIERS.map((b) => ({ from: Number(b.from) || 0, to: Number(b.to) || 0, rate: Number(b.rate) || 0 })) : [],
  };

  let capNhat = 0;
  if (oldName) {
    const s = DB.catalogs.surfaces.find((x) => x.name === oldName);
    Object.assign(s, data);
    if (oldName !== name) {
      DB.quotes.filter((q) => q.inputs).forEach((q) => q.inputs.forEach((r) => { if (r.surface === oldName) { r.surface = name; capNhat++; } }));
      DB.ckTemplates.forEach((t) => { if (t.data.surface === oldName) t.data.surface = name; });
    }
  } else {
    DB.catalogs.surfaces.push(data);
  }
  Modal.close();
  render();
  Toast.ok(oldName ? 'Đã cập nhật' : 'Đã thêm mới',
    `“${name}” · ${(CO_SO_TINH[basis] || {}).label}${capNhat ? ` · cập nhật ${capNhat} cấu kiện` : ''}`);
}

