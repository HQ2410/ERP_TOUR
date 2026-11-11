/* ============================================================================
 * MODULE: ĐƠN GIÁ ĐẦU VÀO
 * Dựng theo 3 sheet nhập của biểu mẫu: Input VL · Input LD-DT · Input VC.
 * Toàn bộ đơn giá và hệ số dùng để tính giá thành đều nhập tay tại đây —
 * engine không giữ con số cố định nào trong code.
 * ==========================================================================*/

const PB_TABS = [
  { id: 'material', label: 'Vật liệu', icon: 'fa-layer-group' },
  { id: 'surface',  label: 'Xử lý bề mặt', icon: 'fa-spray-can-sparkles' },
  { id: 'operation',label: 'Nguyên công & hệ số', icon: 'fa-gears' },
  { id: 'transport',label: 'Vận chuyển & lắp đặt', icon: 'fa-truck' },
];

/** Ô nhập đơn giá: data-pb="<nhóm>.<khóa>" */
const pbInput = (group, key, value, { step = 1000, w = 150, suffix = '' } = {}) =>
  `<div style="display:flex;align-items:center;gap:7px;justify-content:flex-end">
     <input class="inp right num" type="number" min="0" step="${step}" data-pb="${group}.${esc(key)}" value="${value}" style="width:${w}px" />
     ${suffix ? `<span class="muted" style="font-size:11.5px;min-width:52px">${esc(suffix)}</span>` : ''}
   </div>`;

/** Đếm số cấu kiện đang dùng một mác vật liệu / bề mặt / nguyên công */
function pbUsage(kind, key) {
  let n = 0;
  DB.quotes.filter((q) => q.inputs).forEach((q) => q.inputs.forEach((r) => {
    if (kind === 'material' && r.property === key) n++;
    if (kind === 'materialBase' && r.material === key) n++;
    if (kind === 'surface' && r.surface === key) n++;
    if (kind === 'operation' && Number(r.ops?.[key]) > 0) n++;
    if (kind === 'complexity' && r.complexity === key) n++;
  }));
  return n;
}

Views.pricebook = function () {
  const pb = DB.priceBook;
  const tab = State.tab['pricebook'] || 'material';

  /* ---------------- Tab Vật liệu ---------------- */
  const materialTab = () => `
    <div style="padding:16px 18px">
      <div class="form-sec-title"><i class="fa-solid fa-coins"></i>Đơn giá vật liệu gốc — VND/kg</div>
      ${tableShell(
        [{ t: 'Vật liệu' }, { t: 'Khối lượng riêng', cls: 'right' }, { t: 'Số cấu kiện đang dùng', cls: 'center' }, { t: 'Đơn giá VND/kg', cls: 'right', w: '240px' }],
        DB.catalogs.materials.map((m) => `<tr>
          <td class="strong">${esc(m.name)}</td>
          <td class="right num muted">${fmtN(m.density)} kg/m³</td>
          <td class="center num">${pbUsage('materialBase', m.name)}</td>
          <td class="right">${pbInput('materialBase', m.name, pb.materialBase[m.name] || 0, { suffix: 'đ/kg' })}</td>
        </tr>`))}

      <div class="form-sec-title" style="margin-top:20px"><i class="fa-solid fa-tags"></i>Đơn giá theo mác vật liệu — VND/kg
        <span style="margin-left:auto;font-size:11.5px;color:var(--text-3);text-transform:none;letter-spacing:0">Ưu tiên áp dụng khi mác khớp với vật liệu đã chọn</span>
      </div>
      ${tableShell(
        [{ t: 'Mác / đặc tính' }, { t: 'Thuộc vật liệu' }, { t: 'Số cấu kiện đang dùng', cls: 'center' }, { t: 'Đơn giá VND/kg', cls: 'right', w: '240px' }],
        DB.catalogs.properties.map((p) => `<tr>
          <td class="strong">${esc(p.name)}</td>
          <td><span class="chip">${esc(p.material)}</span></td>
          <td class="center num">${pbUsage('material', p.name)}</td>
          <td class="right">${pbInput('material', p.name, pb.material[p.name] || 0, { suffix: 'đ/kg' })}</td>
        </tr>`))}
    </div>`;

  /* ---------------- Tab Bề mặt ---------------- */
  const surfaceTab = () => `
    <div style="padding:16px 18px">
      <div class="form-sec-title"><i class="fa-solid fa-brush"></i>Đơn giá xử lý bề mặt
        <span style="margin-left:auto;font-size:11.5px;color:var(--text-3);text-transform:none;letter-spacing:0">
          Cơ sở tính và bậc giá khai ở <b>Danh mục quy ước → Công việc gia công</b></span>
      </div>
      ${tableShell(
        [{ t: 'Loại hoàn thiện bề mặt' }, { t: 'Hình thức' }, { t: 'Cơ sở tính' }, { t: 'Số cấu kiện đang dùng', cls: 'center' }, { t: 'Đơn giá', cls: 'right', w: '230px' }],
        DB.catalogs.surfaces.map((s) => `<tr>
          <td class="strong">${esc(s.name)}</td>
          <td>${s.outsource
            ? '<span class="badge orange">Thuê ngoài</span>'
            : '<span class="badge slate no-dot">Làm tại xưởng</span>'}</td>
          <td><span class="chip">${esc((CO_SO_TINH[s.basis] || {}).label || '')}</span></td>
          <td class="center num">${pbUsage('surface', s.name)}</td>
          <td class="right">${s.basis === 'thickness'
            ? `<span class="muted" style="font-size:12px">${(s.tiers || []).length} bậc theo chiều dày</span>
               <button class="btn btn-xs" data-act="cat-open-service" data-name="${esc(s.name)}" style="margin-left:6px"><i class="fa-solid fa-layer-group"></i>Xem bậc</button>`
            : pbInput('surfaceRate', s.name, s.rate, { step: 500, suffix: (CO_SO_TINH[s.basis] || {}).unit || '' })}</td>
        </tr>`))}
      <div style="margin-top:12px;font-size:12.3px;color:var(--text-3);background:var(--surface-2);border-radius:var(--r);padding:11px 13px;line-height:1.7">
        <i class="fa-solid fa-circle-info" style="color:var(--primary)"></i>
        Các loại đánh dấu <b>Thuê ngoài</b> được cộng vào cột <b>Khối lượng xử lý ngoài</b> của cấu kiện
        và phát sinh thêm chuyến vận chuyển đi xử lý bề mặt.
      </div>
    </div>`;

  /* ---------------- Tab Nguyên công ---------------- */
  const operationTab = () => `
    <div style="padding:16px 18px">
      <div class="form-sec-title"><i class="fa-solid fa-gears"></i>Đơn giá nguyên công sản xuất nội bộ
        <span style="margin-left:auto;display:flex;align-items:center;gap:8px">
          <button class="btn btn-xs" data-act="go" data-id="catalogs"><i class="fa-solid fa-list-check"></i>Quản lý loại nguyên công</button>
        </span>
      </div>
      ${tableShell(
        [{ t: 'Nguyên công' }, { t: 'Phân xưởng' }, { t: 'Cơ sở tính' }, { t: 'Công đoạn tương ứng' }, { t: 'Đang dùng', cls: 'center' }, { t: 'Đơn giá', cls: 'right', w: '220px' }],
        NGUYEN_CONG.map((n) => `<tr>
          <td class="strong">${esc(n.name)}</td>
          <td><span class="chip">${esc(n.workshop || '')}</span></td>
          <td><span class="chip">${esc((CO_SO_TINH[n.basis] || {}).label || '')}</span></td>
          <td>${(n.ops || []).map((id) => { const o = Q.operation(id); return o ? `<span class="chip" title="${esc(o.machine)}">${esc(o.id)}</span>` : ''; }).join(' ')}</td>
          <td class="center num">${pbUsage('operation', n.key)}</td>
          <td class="right">${pbInput('operationRate', n.key, n.rate, { suffix: (CO_SO_TINH[n.basis] || {}).unit || '' })}</td>
        </tr>`))}

      <div class="grid g-2" style="margin-top:20px">
        <div>
          <div class="form-sec-title"><i class="fa-solid fa-diagram-project"></i>Hệ số độ phức tạp cấu kiện</div>
          ${tableShell(
            [{ t: 'Mức độ' }, { t: 'Số cấu kiện', cls: 'center' }, { t: 'Hệ số nhân', cls: 'right', w: '170px' }],
            Object.keys(pb.complexity).map((k) => `<tr>
              <td class="strong">${esc(k)}</td>
              <td class="center num">${pbUsage('complexity', k)}</td>
              <td class="right">${pbInput('complexity', k, pb.complexity[k], { step: 0.05, w: 96, suffix: '×' })}</td>
            </tr>`))}
        </div>
        <div>
          <div class="form-sec-title"><i class="fa-solid fa-industry"></i>Hệ số đặc thù sản xuất</div>
          ${tableShell(
            [{ t: 'Đặc thù' }, { t: 'Hệ số nhân', cls: 'right', w: '170px' }],
            Object.keys(pb.productionType).map((k) => `<tr>
              <td class="strong" style="font-size:12.5px">${esc(k)}</td>
              <td class="right">${pbInput('productionType', k, pb.productionType[k], { step: 0.05, w: 96, suffix: '×' })}</td>
            </tr>`))}
        </div>
      </div>

      <div class="form-sec-title" style="margin-top:20px"><i class="fa-solid fa-user-tag"></i>Phân loại khách hàng — cộng vào dự phòng giảm giá</div>
      ${tableShell(
        [{ t: 'Phân loại' }, { t: 'Diễn giải' }, { t: 'Cộng dự phòng (%)', cls: 'right', w: '190px' }],
        Object.keys(pb.customerClass).map((k) => `<tr>
          <td class="strong">${esc(k)}</td>
          <td class="muted">${esc(pb.customerClass[k].note)}</td>
          <td class="right"><div style="display:flex;align-items:center;gap:7px;justify-content:flex-end">
            <input class="inp right num" type="number" step="0.5" data-pb="customerClass.${esc(k)}" value="${pb.customerClass[k].duPhong}" style="width:96px" />
            <span class="muted" style="font-size:11.5px;min-width:52px">%</span></div></td>
        </tr>`))}
    </div>`;

  /* ---------------- Tab Vận chuyển ---------------- */
  const transportTab = () => `
    <div style="padding:16px 18px">
      <div class="form-sec-title"><i class="fa-solid fa-truck-fast"></i>Đơn giá vận chuyển & lắp đặt</div>
      ${tableShell(
        [{ t: 'Khoản mục' }, { t: 'Cách tính' }, { t: 'Đơn giá', cls: 'right', w: '240px' }],
        [
          ['nhanHang', 'Vận chuyển nhận vật tư về xưởng', 'Số chuyến × đơn giá', 'đ/chuyến', 50000],
          ['xuLyNgoai', 'Vận chuyển đi xử lý bề mặt thuê ngoài', 'Số chuyến × đơn giá', 'đ/chuyến', 50000],
          ['giaoHang', 'Vận chuyển giao hàng', 'Số chuyến × số km × đơn giá', 'đ/km', 1000],
          ['lapDat', 'Lắp đặt tại công trình', 'Số lượng lắp đặt × đơn giá', 'đ/đơn vị', 10000],
        ].map(([k, label, how, suffix, step]) => `<tr>
          <td class="strong">${esc(label)}</td>
          <td class="muted">${esc(how)}</td>
          <td class="right">${pbInput('transport', k, pb.transport[k], { step, suffix })}</td>
        </tr>`))}

      <div class="form-sec-title" style="margin-top:20px"><i class="fa-solid fa-ruler"></i>Khổ phôi tiêu chuẩn dùng tính hao hụt</div>
      <div class="card" style="background:var(--surface-2)"><div class="card-body">
        <div class="stat-strip">
          <div><div class="l">Chiều dài tấm phôi</div><div class="v">${fmtN(KHO_PHOI.dai)} mm</div></div>
          <div><div class="l">Chiều rộng tấm phôi</div><div class="v">${fmtN(KHO_PHOI.rong)} mm</div></div>
          <div><div class="l">Diện tích 1 tấm</div><div class="v">${fmtDec((KHO_PHOI.dai * KHO_PHOI.rong) / 1e6, 2)} m²</div></div>
        </div>
        <div style="margin-top:11px;font-size:12.3px;color:var(--text-3);line-height:1.7">
          Hao hụt của từng cấu kiện được khai trực tiếp ở cột <b>Hao hụt</b> trong bảng tham số đầu vào.
          Khổ phôi tiêu chuẩn ở đây dùng để đối chiếu khi cần tính lại % hao hụt theo cách cắt.
        </div>
      </div></div>
    </div>`;

  const nQuotes = DB.quotes.filter((q) => q.inputs).length;

  return `
  ${pageHead('Đơn giá đầu vào', 'Bảng đơn giá và hệ số dùng chung cho toàn bộ báo giá — sửa ở đây là mọi báo giá tính lại ngay', `
    <button class="btn" data-act="export-pricebook"><i class="fa-solid fa-file-export"></i>Export</button>
    <button class="btn" data-act="pricebook-reset"><i class="fa-solid fa-rotate-left"></i>Về giá gốc</button>
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Mác vật liệu', Object.keys(pb.material).length, 'fa-layer-group', 'blue')}
    ${mkpi('Loại bề mặt', Object.keys(pb.surface).length, 'fa-spray-can-sparkles', 'teal')}
    ${mkpi('Nguyên công', NGUYEN_CONG.length, 'fa-gears', 'indigo')}
    ${mkpi('ĐG thép cán nóng', fmtVND(pb.material['cán nóng']) + '/kg', 'fa-tag', 'orange')}
    ${mkpi('Báo giá áp dụng', nQuotes, 'fa-file-invoice-dollar', 'green')}
  </div>

  <div class="card" style="margin-bottom:14px;border-left:3px solid var(--primary)">
    <div class="card-head">
      <span class="mkpi-ico t-blue"><i class="fa-solid fa-circle-info"></i></span>
      <div><h3>Không có đơn giá nào cố định trong hệ thống</h3>
        <p>Mọi con số dùng để tính giá thành đều lấy từ bảng này. Sửa một ô là toàn bộ báo giá, bảng phân tích và giá bán tính lại tức thì.</p></div>
    </div>
  </div>

  <div class="card">
    <div class="tabs">
      ${PB_TABS.map((t) => `<button class="tab ${tab === t.id ? 'active' : ''}" data-act="pricebook-tab" data-tab="${t.id}">
        <i class="fa-solid ${t.icon}"></i> ${esc(t.label)}</button>`).join('')}
    </div>
    ${tab === 'material' ? materialTab() : tab === 'surface' ? surfaceTab() : tab === 'operation' ? operationTab() : transportTab()}
  </div>`;
};
