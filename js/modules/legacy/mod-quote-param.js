/* ============================================================================
 * MÀN BÁO GIÁ THEO THAM SỐ ĐẦU VÀO
 *   Tab 1 — Tham số đầu vào : lưới nhập giống biểu mẫu Input Info
 *   Tab 2 — Khối lượng & đơn giá : kết quả tính khối lượng, diện tích, chi phí
 *   Tab 3 — Phân tích giá : bảng cơ cấu giá VND/kg + hệ số điều chỉnh + chốt giá
 * ==========================================================================*/

/* --------------------------------------------------------- Tiện ích nhỏ */
const qiSelect = (i, field, options, value) =>
  `<select class="inp" data-qi="${field}" data-i="${i}" style="width:100%;min-width:118px">
     ${options.map((o) => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
   </select>`;

const qiNum = (i, field, value, { step = 1, w = 84, min = 0 } = {}) =>
  `<input class="inp right num" type="number" min="${min}" step="${step}" data-qi="${field}" data-i="${i}" value="${value}" style="width:${w}px" />`;

const qiText = (i, field, value, w = 150) =>
  `<input class="inp" data-qi="${field}" data-i="${i}" value="${esc(value || '')}" style="width:${w}px" />`;

const qiOp = (i, key, value) =>
  `<input class="inp center num" type="number" min="0" step="1" data-qi="op.${key}" data-i="${i}" value="${value || 0}" style="width:56px" />`;

/* ============================ TAB 1 — THAM SỐ ĐẦU VÀO ==================== */
/** Ô số: để trống khi bằng 0 đúng như biểu mẫu (kích thước không áp dụng) */
const qiDim = (i, field, value, w = 78) =>
  `<input class="inp right num" type="number" min="0" step="0.01" data-qi="${field}" data-i="${i}" value="${value || ''}" style="width:${w}px" />`;

function quoteInputGrid(q) {
  const rows = (q.inputs || []).map((r, i) => {
    const c = tinhDongThamSo(r);
    return `<tr>
      <td class="center"><span class="code" style="font-size:11.5px">${esc(r.id || '')}</span></td>
      <td class="center muted" style="font-size:11.5px">${esc(r.quoteCode || q.quoteCode || '')}</td>
      <td class="center muted">${r.stt || i + 1}</td>
      <td>${qiText(i, 'name', r.name, 250)}</td>
      <td>${qiSelect(i, 'productGroup', nhomSanPham(), r.productGroup)}</td>
      <td>${qiSelect(i, 'material', tenVatLieu(), r.material)}</td>
      <td>${qiSelect(i, 'shape', tenKieuDang(), r.shape)}</td>
      <td>${qiSelect(i, 'property', tenDacTinh(), r.property)}</td>
      <td>${qiSelect(i, 'surface', tenBeMat(), r.surface)}</td>
      <td>${qiDim(i, 'L', r.L)}</td>
      <td>${qiDim(i, 'W', r.W)}</td>
      <td>${qiDim(i, 'H', r.H)}</td>
      <td>${qiDim(i, 'D', r.D)}</td>
      <td>${qiDim(i, 'W1', r.W1, 70)}</td>
      <td>${qiDim(i, 'H1', r.H1, 70)}</td>
      <td>${qiDim(i, 'step', r.step, 70)}</td>
      <td>${qiNum(i, 'thickness', r.thickness, { step: 0.1, w: 74 })}</td>
      <td class="muted" style="min-width:240px;font-size:11.5px">${esc(c.summary)}</td>
      <td class="center num">${fmtDec(r.wastePct, 1)}%</td>
      ${NGUYEN_CONG.map((n) => `<td class="center">${qiOp(i, n.key, r.ops?.[n.key])}</td>`).join('')}
      <td class="center">${qiNum(i, 'pieceQty', r.pieceQty, { w: 62, min: 1 })}</td>
      <td>${qiSelect(i, 'complexity', Object.keys(DO_PHUC_TAP), r.complexity)}</td>
      <td>${qiDim(i, 'qty', r.qty, 88)}</td>
      <td>${qiSelect(i, 'unit', [''].concat(tenDonVi()), r.unit)}</td>
      <td class="right num strong" data-cell="w-mat-${i}">${fmtDec(c.materialWeight, 2)}</td>
      <td class="right num strong" data-cell="w-blank-${i}">${fmtDec(c.blankWeight, 2)}</td>
      <td class="right num" data-cell="w-out-${i}">${c.outsourceWeight ? fmtDec(c.outsourceWeight, 2) : '—'}</td>
      <td class="center num">${fmtDec(r.auxPct, 0)}%</td>
      <td data-cell="w-check-${i}" title="${esc(c.checkDetail)}">${c.checkOk ? '<span class="badge green">OK</span>' : '<span class="badge orange">Thiếu kích thước</span>'}</td>
      <td>${qiDim(i, 'specialWeight', r.specialWeight, 84)}</td>
      <td class="right num" data-cell="w-area-${i}">${fmtDec(c.surfaceArea, 2)}</td>
      <td>${qiText(i, 'note', r.note, 160)}</td>
      <td class="center" style="white-space:nowrap">
        <button class="btn btn-icon btn-xs" data-act="qi-open" data-i="${i}" title="Xem chi tiết dòng"><i class="fa-solid fa-chevron-right"></i></button>
        <button class="btn btn-icon btn-xs" data-act="qi-del" data-i="${i}" title="Xóa dòng"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  });

  // Thứ tự cột giữ đúng như bảng "Tham số đầu vào" của khách
  const head = [
    { t: 'ID', cls: 'center', w: '76px' }, { t: 'Mã báo giá', cls: 'center', w: '84px' }, { t: 'STT', cls: 'center', w: '52px' },
    { t: 'Tên sản phẩm' }, { t: 'Thông số cấu kiện' },
    { t: 'Vật liệu' }, { t: 'Kiểu dáng' }, { t: 'Đặc tính' }, { t: 'Hoàn thiện bề mặt' },
    { t: 'Chiều dài mm', cls: 'right' }, { t: 'Chiều rộng mm', cls: 'right' }, { t: 'Chiều cao H mm', cls: 'right' }, { t: 'Đường kính mm', cls: 'right' },
    { t: 'Tham số W1_mm', cls: 'right' }, { t: 'Tham số H1_mm', cls: 'right' }, { t: 'Bước', cls: 'right' }, { t: 'Chiều dày mm', cls: 'right' },
    { t: 'Tổng hợp thông tin cấu kiện' }, { t: 'Hao hụt', cls: 'center' },
    ...NGUYEN_CONG.map((n) => ({ t: 'Nguyên công ' + n.name.toLowerCase(), cls: 'center' })),
    { t: 'Số lượng cấu kiện', cls: 'center' }, { t: 'Độ phức tạp cấu kiện' }, { t: 'Số lượng sản phẩm', cls: 'right' }, { t: 'Đơn vị' },
    { t: 'Khối lượng vật tư', cls: 'right' }, { t: 'Khối lượng sản phẩm', cls: 'right' }, { t: 'Khối lượng xử lý', cls: 'right' },
    { t: 'Vật tư phụ', cls: 'center' }, { t: 'Kiểm tra điều kiện khai báo' }, { t: 'Khối lượng phôi đặc thù kg/m', cls: 'right' },
    { t: 'Diện tích bề mặt m²', cls: 'right' }, { t: 'Ghi chú' }, { t: '', cls: 'center', w: '72px' },
  ];

  return `<div class="tbl-wrap" style="max-height:64vh;overflow:auto">
      <table class="tbl" style="min-width:3560px">
        <thead><tr>${head.map((h) => `<th class="${h.cls || ''}" ${h.w ? `style="width:${h.w}"` : ''}>${esc(h.t)}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('') || `<tr><td colspan="${head.length}" style="padding:0"><div class="empty"><div class="empty-ico"><i class="fa-solid fa-table-list"></i></div><h4>Chưa có cấu kiện nào</h4><p>Bấm “Thêm dòng” để khai báo cấu kiện đầu tiên của báo giá.</p></div></td></tr>`}</tbody>
      </table>
    </div>`;
}

/** Drawer chi tiết 1 dòng cấu kiện — mở bằng nút mũi tên cuối dòng */
function openInputRowDrawer(q, i) {
  const r = q.inputs[i];
  const c = tinhDongThamSo(r);
  Drawer.open({
    title: `${esc(r.id)} · ${esc(r.name || r.productGroup)}`,
    sub: `${esc(c.summary)} · ${esc(r.quoteCode || '')}`,
    body: `<div style="padding:17px 18px">
      <div class="grid g-auto-sm" style="margin-bottom:16px">
        ${mkpi('Khối lượng phôi', fmtDec(c.blankWeight, 2) + ' kg', 'fa-cube', 'teal')}
        ${mkpi('Khối lượng vật tư', fmtDec(c.materialWeight, 2) + ' kg', 'fa-weight-hanging', 'blue')}
        ${mkpi('Diện tích bề mặt', fmtDec(c.surfaceArea, 2) + ' m²', 'fa-vector-square', 'indigo')}
        ${mkpi('Kiểm tra', c.check, 'fa-clipboard-check', c.checkOk ? 'green' : 'orange')}
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-ruler-combined"></i>Cách quy ra khối lượng
        <button class="btn btn-xs" data-act="cat-edit" data-list="productGroups" data-name="${esc(r.productGroup)}" style="margin-left:auto">
          <i class="fa-solid fa-calculator"></i>Sửa công thức nhóm</button>
      </div>
      <div class="card" style="background:var(--surface-2);margin-bottom:16px"><div class="card-body" style="font-size:12.8px;line-height:1.9">
        ${c.ctMode === 'dacThu'
          ? `<div>Dùng <b>khối lượng phôi đặc thù</b> đã khai: <b>${fmtDec(r.specialWeight, 2)} kg/m</b> — ưu tiên hơn công thức của nhóm.</div>`
          : `<div>Nhóm <b>${esc(r.productGroup)}</b> · cách tính <b>${esc(c.ctModeLabel)}</b></div>
             <div>Công thức: <code style="background:var(--surface);padding:2px 7px;border-radius:5px">${esc(c.ctFormula)}</code>
               = <b>${fmtDec(c.ctRaw, 3)} ${esc(c.ctUnit)}</b></div>
             ${c.ctError ? `<div style="color:var(--red)"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(c.ctError)}</div>` : ''}
             <div>Quy ra: ${esc((CACH_TINH_KHOI_LUONG[c.ctMode] || {}).desc || '')} · tỷ trọng ${fmtN(c.density)} kg/m³ → <b>${fmtDec(c.kgPerM, 3)} kg/m</b></div>`}
        <div>Khối lượng phôi = ${fmtDec(c.kgPerM, 3)} kg/m × ${r.unit === 'm' ? '1 m' : fmtDec(r.L / 1000, 3) + ' m'} × ${r.pieceQty} cấu kiện × ${fmtDec(r.qty, 2)} ${esc(r.unit || 'đv')} = <b>${fmtDec(c.blankWeight, 2)} kg</b></div>
        <div>Khối lượng vật tư = ${fmtDec(c.blankWeight, 2)} × (1 + ${fmtDec(r.wastePct, 1)}% hao hụt) × (1 + ${fmtDec(r.auxPct, 0)}% vật tư phụ) = <b>${fmtDec(c.materialWeight, 2)} kg</b></div>
        <div>Diện tích bề mặt = ${fmtDec(c.blankWeight, 2)} kg ÷ (${fmtDec(r.thickness, 2)}mm × ${fmtN(c.density)}) = <b>${fmtDec(c.surfaceArea, 2)} m²</b></div>
      </div></div>

      <div class="form-sec-title"><i class="fa-solid fa-coins"></i>Chi phí của cấu kiện</div>
      <div class="stat-strip" style="margin-bottom:12px">
        <div><div class="l">Vật tư (${fmtVND(c.matPriceUsed)}/kg)</div><div class="v" style="font-size:15px;color:var(--teal)">${fmtVND(c.costMaterial)}</div></div>
        <div><div class="l">Xử lý bề mặt</div><div class="v" style="font-size:15px">${fmtVND(c.costSurface)}</div></div>
        <div><div class="l">Gia công (${c.soLanNC} NC × ${fmtDec(c.heSoPhucTap, 2)})</div><div class="v" style="font-size:15px;color:var(--indigo)">${fmtVND(c.costProduction)}</div></div>
      </div>

      <!-- YC-04.8 — chỉ rõ đang áp cơ sở tính nào, bậc giá nào -->
      <div class="card" style="background:var(--surface-2);margin-bottom:16px"><div class="card-body" style="font-size:12.7px;line-height:1.9">
        <div><b>${esc(r.surface)}</b>
          ${c.surfaceOutsource ? '<span class="badge orange" style="margin-left:6px">Thuê ngoài</span>' : '<span class="badge slate no-dot" style="margin-left:6px">Làm tại xưởng</span>'}
          <span class="chip" style="margin-left:6px">${esc(c.surfaceBasisLabel)}</span></div>
        ${c.surfaceTier
          ? `<div>Chiều dày <b>${fmtDec(r.thickness, 2)} mm</b> rơi vào bậc
             <b>${fmtDec(c.surfaceTier.from, 1)} – ${c.surfaceTier.to ? fmtDec(c.surfaceTier.to, 1) + ' mm' : 'trở lên'}</b>
             → đơn giá <b>${fmtVND(c.surfacePriceUsed)}/kg</b></div>`
          : ''}
        <div>Chi phí = ${fmtDec(c.surfaceQty, 2)} ${esc(c.surfaceUnit.replace('đ/', ''))} × ${fmtVND(c.surfacePriceUsed)}
          ${c.surfacePriceIsOverride ? '<span class="badge blue no-dot" style="margin-left:4px;font-size:10px">Ghi đè riêng</span>' : ''}
          = <b>${fmtVND(c.costSurface)}</b></div>
        ${c.volume ? `<div class="muted">Thể tích khối phôi: ${fmtDec(c.volume, 4)} m³</div>` : ''}
      </div></div>

      <div class="form-sec-title"><i class="fa-solid fa-gears"></i>Nguyên công đã khai</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${NGUYEN_CONG.filter((n) => Number(r.ops?.[n.key]) > 0).map((n) => `<span class="chip"><i class="fa-solid fa-check" style="color:var(--green)"></i>${esc(n.name)} × ${r.ops[n.key]} · ${fmtVND(n.dg)}</span>`).join('') || '<span class="muted">Chưa khai nguyên công nào</span>'}
      </div>

      ${r.note ? `<div class="form-sec-title" style="margin-top:18px"><i class="fa-solid fa-note-sticky"></i>Ghi chú</div><div style="font-size:13px;color:var(--text-2)">${esc(r.note)}</div>` : ''}
    </div>`,
    foot: `<button class="btn" data-act="drawer-close">Đóng</button>
           <button class="btn btn-primary" data-act="qi-save-tpl" data-i="${i}"><i class="fa-solid fa-clone"></i>Lưu thành mẫu</button>`,
  });
}

/* ==================== TAB 2 — KHỐI LƯỢNG & ĐƠN GIÁ ĐẦU VÀO =============== */
function quoteWeightTab(q) {
  const pt = phanTichGia(q);
  return `
  <div class="grid g-auto-sm" style="margin:16px 18px">
    ${mkpi('Khối lượng vật tư', fmtDec(pt.materialWeight, 2) + ' kg', 'fa-weight-hanging', 'blue')}
    ${mkpi('Khối lượng phôi SP', fmtDec(pt.blankWeight, 2) + ' kg', 'fa-cube', 'teal')}
    ${mkpi('Khối lượng xử lý ngoài', fmtDec(pt.outsourceWeight, 2) + ' kg', 'fa-truck-ramp-box', pt.outsourceWeight ? 'orange' : 'slate')}
    ${mkpi('Diện tích bề mặt', fmtDec(pt.surfaceArea, 2) + ' m²', 'fa-vector-square', 'indigo')}
    ${mkpi('Hao hụt bình quân', pt.blankWeight ? fmtDec((pt.materialWeight / pt.blankWeight - 1) * 100, 1) + '%' : '—', 'fa-scissors', 'red')}
  </div>

  <div style="padding:0 18px 18px">
    <div class="form-sec-title"><i class="fa-solid fa-calculator"></i>Chi tiết tính khối lượng từng cấu kiện</div>
    ${tableShell(
      [{ t: 'Cấu kiện' }, { t: 'Khai triển', cls: 'right' }, { t: 'kg/m', cls: 'right' }, { t: 'SL' },
       { t: 'Klg phôi kg', cls: 'right' }, { t: 'Hao hụt', cls: 'right' }, { t: 'VT phụ', cls: 'right' },
       { t: 'Klg vật tư kg', cls: 'right' }, { t: 'Diện tích m²', cls: 'right' }, { t: 'Kiểm tra' }],
      pt.rows.map((r) => `<tr>
        <td>${cell2(esc(r.productGroup), esc(r.summary))}</td>
        <td class="right num">${r.khaiTrienMm ? fmtDec(r.khaiTrienMm, 1) + ' mm' : '—'}</td>
        <td class="right num">${fmtDec(r.kgPerM, 3)}</td>
        <td class="num">${fmtDec(r.qty, 2)} ${esc(r.unit)}${r.pieceQty > 1 ? ` × ${r.pieceQty} ck` : ''}</td>
        <td class="right num strong">${fmtDec(r.blankWeight, 2)}</td>
        <td class="right num muted">${fmtDec(r.wastePct, 1)}%</td>
        <td class="right num muted">${fmtDec(r.auxPct, 1)}%</td>
        <td class="right num strong">${fmtDec(r.materialWeight, 2)}</td>
        <td class="right num">${fmtDec(r.surfaceArea, 2)}</td>
        <td>${r.checkOk ? '<span class="badge green">OK</span>' : `<span class="badge orange" title="${esc(r.checkDetail)}">Thiếu</span>`}</td>
      </tr>`))}

    <div class="form-sec-title" style="margin-top:20px">
      <i class="fa-solid fa-tags"></i>Đơn giá đầu vào áp dụng — sửa được cho từng cấu kiện
      <span style="margin-left:auto;display:flex;align-items:center;gap:8px">
        <span style="font-size:11.4px;color:var(--text-3);text-transform:none;letter-spacing:0">Bỏ trống = lấy theo bảng đơn giá chung</span>
        <button class="btn btn-xs" data-act="go" data-id="pricebook"><i class="fa-solid fa-tags"></i>Bảng đơn giá chung</button>
      </span>
    </div>
    ${tableShell(
      [{ t: 'Cấu kiện' }, { t: 'Vật liệu / mác' }, { t: 'ĐG vật liệu VND/kg', cls: 'right', w: '160px' }, { t: 'Chi phí vật tư', cls: 'right' },
       { t: 'Bề mặt' }, { t: 'ĐG bề mặt VND/m²', cls: 'right', w: '160px' }, { t: 'Chi phí bề mặt', cls: 'right' },
       { t: 'NC', cls: 'center' }, { t: 'Hệ số PT', cls: 'center' }, { t: 'CP khác/cấu kiện', cls: 'right', w: '150px' }, { t: 'Chi phí sản xuất', cls: 'right' }],
      pt.rows.map((r, i) => `<tr>
        <td class="strong">${esc(r.productGroup)}<div class="cell-sub">${esc(r.id || '')}</div></td>
        <td>${esc(r.material)} · ${esc(r.property)}</td>
        <td class="right"><input class="inp right num" type="number" min="0" step="500" data-qi="matPrice" data-i="${i}"
              value="${r.matPrice || ''}" placeholder="${fmtN(r.matPriceUsed)}" style="width:140px" title="${r.matPriceIsOverride ? 'Đơn giá riêng của dòng này' : 'Đang lấy theo bảng đơn giá chung'}" /></td>
        <td class="right num strong" style="color:var(--teal)" data-cell="c-mat-${i}">${fmtVND(r.costMaterial)}</td>
        <td>${esc(r.surface)}</td>
        <td class="right"><input class="inp right num" type="number" min="0" step="500" data-qi="surfacePrice" data-i="${i}"
              value="${r.surfacePrice === '' || r.surfacePrice == null ? '' : r.surfacePrice}" placeholder="${fmtN(r.surfacePriceUsed)}" style="width:140px" /></td>
        <td class="right num" data-cell="c-sur-${i}">${fmtVND(r.costSurface)}</td>
        <td class="center num">${r.soLanNC}</td>
        <td class="center num">×${fmtDec(r.heSoPhucTap, 2)}</td>
        <td class="right"><input class="inp right num" type="number" min="0" step="1000" data-qi="otherCost" data-i="${i}"
              value="${r.otherCost || ''}" placeholder="0" style="width:130px" title="Chi phí chi tiết khác cho 1 cấu kiện" /></td>
        <td class="right num strong" style="color:var(--indigo)" data-cell="c-pro-${i}">${fmtVND(r.costProduction)}</td>
      </tr>`))}

    <div class="form-sec-title" style="margin-top:20px"><i class="fa-solid fa-truck"></i>Vận chuyển & lắp đặt</div>
    <div class="card" style="background:var(--surface-2)"><div class="card-body">
      <div class="form-grid">
        <div class="field"><label>Số chuyến nhận vật tư về xưởng (${fmtVND(DG_VAN_CHUYEN.nhanHang)}/chuyến)</label>
          <input class="inp num" type="number" min="0" data-qt="chuyenNhanHang" value="${q.transport?.chuyenNhanHang || 0}" /></div>
        <div class="field"><label>Số chuyến đi xử lý bề mặt thuê ngoài (${fmtVND(DG_VAN_CHUYEN.xuLyNgoai)}/chuyến)</label>
          <input class="inp num" type="number" min="0" data-qt="chuyenXuLyNgoai" value="${q.transport?.chuyenXuLyNgoai || 0}" /></div>
        <div class="field"><label>Số chuyến giao hàng</label>
          <input class="inp num" type="number" min="0" data-qt="chuyenGiaoHang" value="${q.transport?.chuyenGiaoHang || 0}" /></div>
        <div class="field"><label>Quãng đường giao hàng (km × ${fmtVND(DG_VAN_CHUYEN.giaoHang)})</label>
          <input class="inp num" type="number" min="0" data-qt="kmGiaoHang" value="${q.transport?.kmGiaoHang || 0}" /></div>
        <div class="field"><label>Số lượng lắp đặt tại công trình (${fmtVND(DG_VAN_CHUYEN.lapDat)}/đơn vị)</label>
          <input class="inp num" type="number" min="0" data-qt="soLuongLapDat" value="${q.transport?.soLuongLapDat || 0}" /></div>
      </div>
      <div class="stat-strip">
        <div><div class="l">Vận chuyển nội bộ</div><div class="v" style="font-size:15px">${fmtVND(pt.cpVcNoiBo)}</div></div>
        <div><div class="l">Vận chuyển giao hàng</div><div class="v" style="font-size:15px">${fmtVND(pt.cpVcGiaoHang)}</div></div>
        <div><div class="l">Lắp đặt</div><div class="v" style="font-size:15px">${fmtVND(pt.cpLapDat)}</div></div>
      </div>
    </div></div>
  </div>`;
}

/* ======================== TAB 3 — PHÂN TÍCH GIÁ ========================== */
function quoteAnalysisTab(q) {
  const pt = phanTichGia(q);
  const co = q.coeffs || {};

  /** 1 dòng trong bảng phân tích: nội dung | đơn giá VND/kg | thành tiền */
  const line = (id, label, dgVal, ttVal, opt = {}) => `
    <tr ${opt.hl ? 'style="background:var(--primary-soft)"' : ''}>
      <td class="center muted">${id}</td>
      <td class="${opt.hl ? 'strong' : ''}">${label}</td>
      <td class="right num ${opt.hl ? 'strong' : ''}" ${opt.color ? `style="color:${opt.color}"` : ''}>${dgVal}</td>
      <td class="right num ${opt.hl ? 'strong' : ''}" ${opt.color ? `style="color:${opt.color}"` : ''}>${ttVal}</td>
    </tr>`;

  const money = (v) => fmtN(Math.round(v * 100) / 100);

  return `
  <div style="padding:16px 18px">
    <!-- HỆ SỐ ĐIỀU CHỈNH -->
    <div class="card" style="margin-bottom:14px;border-left:3px solid var(--primary)">
      <div class="card-head">
        <span class="mkpi-ico t-blue"><i class="fa-solid fa-sliders"></i></span>
        <div><h3>Hệ số điều chỉnh</h3><p>Thay đổi hệ số để xem giá biến động ngay trước khi chốt báo giá</p></div>
        <div class="right"><button class="btn btn-sm" data-act="quote-reset-coeff" data-id="${q.id}"><i class="fa-solid fa-rotate-left"></i>Về mặc định</button></div>
      </div>
      <div class="card-body">
        <div class="grid g-auto-sm">
          <div class="field" style="margin:0"><label>Chi phí chung (%)</label>
            <input class="inp num" type="number" step="0.5" min="0" data-qc="chung" value="${co.chung ?? 0}" /></div>
          <div class="field" style="margin:0"><label>Chi phí quản lý (%)</label>
            <input class="inp num" type="number" step="0.5" min="0" data-qc="quanLy" value="${co.quanLy ?? 0}" /></div>
          <div class="field" style="margin:0"><label>Lợi nhuận (%)</label>
            <input class="inp num" type="number" step="0.5" min="0" data-qc="loiNhuan" value="${co.loiNhuan ?? 0}" /></div>
          <div class="field" style="margin:0"><label>Chi phí xử lý (%)</label>
            <input class="inp num" type="number" step="0.5" min="0" data-qc="xuLy" value="${co.xuLy ?? 0}" /></div>
          <div class="field" style="margin:0"><label>Dự phòng giảm giá (%)</label>
            <input class="inp num" type="number" step="0.5" min="0" data-qc="duPhong" value="${co.duPhong ?? 0}" /></div>
          <div class="field" style="margin:0"><label>Phân loại KH</label>
            <select class="inp" data-qc="customerClass">
              ${Object.keys(PHAN_LOAI_KH).map((k) => `<option ${q.customerClass === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}
            </select></div>
          <div class="field" style="margin:0;grid-column:span 2"><label>Đặc thù sản xuất</label>
            <select class="inp" data-qc="productionType">
              ${Object.keys(DAC_THU_SX).map((k) => `<option ${q.productionType === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}
            </select></div>
        </div>
        <div style="margin-top:11px;font-size:12.2px;color:var(--text-3);display:flex;gap:16px;flex-wrap:wrap">
          <span><i class="fa-solid fa-user-tag"></i> Phân loại “${esc(q.customerClass)}” cộng thêm <b>${pt.duPhongKH >= 0 ? '+' : ''}${pt.duPhongKH}%</b> dự phòng</span>
          <span><i class="fa-solid fa-industry"></i> Đặc thù sản xuất nhân hệ số chi phí SX <b>×${fmtDec(pt.heSoDacThu, 2)}</b></span>
        </div>
      </div>
    </div>

    <!-- BẢNG PHÂN TÍCH -->
    <div class="grid g-31">
      <div class="card">
        <div class="card-head"><div><h3>Bảng phân tích giá</h3><p>Toàn bộ chi phí quy về VND trên 1 kg phôi sản phẩm</p></div></div>
        <div class="tbl-wrap"><table class="tbl" style="min-width:640px">
          <thead><tr>
            <th class="center" style="width:52px">ID</th><th>Nội dung chi phí</th>
            <th class="right" style="width:180px">Đơn giá theo tính toán</th>
            <th class="right" style="width:200px">Thành tiền theo tính toán</th>
          </tr></thead>
          <tbody>
            ${line(2, 'Chi phí chung', fmtDec((co.chung || 0) / 100, 2), '')}
            ${line(3, 'Chi phí quản lý', fmtDec((co.quanLy || 0) / 100, 2), '')}
            ${line(4, 'Lợi nhuận', fmtDec((co.loiNhuan || 0) / 100, 2), '')}
            ${line(5, 'Chi phí xử lý', fmtDec((co.xuLy || 0) / 100, 2), '')}
            ${line(6, 'Dự phòng giảm giá', fmtDec((co.duPhong || 0) / 100, 2), '')}
            ${line(7, 'Phân loại KH', esc(q.customerClass), '<span class="muted">Diện tích tương ứng</span>')}
            ${line(8, 'Đặc thù sản xuất', esc(q.productionType), '')}
            ${line(9, 'Khối lượng vật tư', money(pt.materialWeight), fmtDec(pt.matAreaEquiv, 2))}
            ${line(10, 'Khối lượng phôi sản phẩm', money(pt.blankWeight), fmtDec(pt.surfaceArea, 2))}
            ${line(11, 'Đơn vị', '<span class="muted">VND/kg</span>', '<span class="muted">Thành tiền</span>')}
            ${line(12, 'Giá gốc', money(pt.dgGiaGoc), money(pt.giaGoc))}
            ${line(13, 'Đơn giá/kg (phôi sản phẩm)', money(pt.donGiaChot), money(pt.thanhTien), { hl: true, color: 'var(--primary)' })}
            ${line(14, 'Chi phí vật tư (Chính + phụ)', money(pt.dgVatTu), money(pt.cpVatTu))}
            ${line(15, 'Chi phí sản xuất', money(pt.dgSanXuat), money(pt.cpSanXuat))}
            ${line(16, 'Chi phí vận chuyển nội bộ', money(pt.dgVcNoiBo), money(pt.cpVcNoiBo))}
            ${line(17, 'Chi phí vận chuyển giao hàng', money(pt.dgVcGiaoHang), money(pt.cpVcGiaoHang))}
            ${line(18, 'Chi phí lắp đặt', money(pt.dgLapDat), money(pt.cpLapDat))}
            ${line(19, 'Chi phí quản lý', money(pt.dgQuanLy), money(pt.cpQuanLy))}
            ${line(20, 'Chi phí xử lý', money(pt.dgXuLy), money(pt.cpXuLy))}
            ${line(21, 'Còn lại', money(pt.dgConLai), money(pt.conLai), { color: pt.conLai >= 0 ? 'var(--green)' : 'var(--red)' })}
          </tbody>
        </table></div>
        <div class="card-foot" style="font-size:12.2px;color:var(--text-3);line-height:1.7">
          <b>Cách tính:</b> Giá gốc = (Vật tư + Sản xuất + Vận chuyển + Lắp đặt + Quản lý) × (1 + Chi phí chung).
          Chi phí xử lý = %&nbsp;xử lý × Đơn giá/kg. Đơn giá/kg = tổng các dòng 14 → 21.
          <b>Còn lại</b> chính là phần dôi ra sau khi trừ hết chi phí — đây là lợi nhuận thực của báo giá.
        </div>
      </div>

      <!-- CHỐT GIÁ -->
      <div class="card">
        <div class="card-head"><div><h3>Chốt đơn giá</h3><p>Nhập đơn giá bán hoặc lấy theo đề xuất</p></div></div>
        <div class="card-body">
          <div class="field"><label>Đơn giá đề xuất theo hệ số (VND/kg)</label>
            <div style="display:flex;gap:8px">
              <input class="inp num right" value="${money(pt.donGiaDeXuat)}" disabled style="flex:1" />
              <button class="btn btn-sm" data-act="quote-use-suggest" data-id="${q.id}" title="Áp dụng"><i class="fa-solid fa-arrow-down"></i></button>
            </div>
          </div>
          <div class="field"><label>Đơn giá chốt (VND/kg) <span class="req">*</span></label>
            <input class="inp num right" type="number" step="100" min="0" data-qp="unitPrice" value="${Math.round(pt.donGiaChot)}" /></div>

          <div class="stat-strip" style="margin-bottom:12px">
            <div><div class="l">Giá trị hàng (chưa VAT)</div><div class="v" style="font-size:16px;color:var(--primary)">${fmtVND(pt.thanhTien)}</div></div>
          </div>
          <div class="doc-total-row"><span>Tạm tính</span><b class="num">${fmtVND(pt.thanhTien)}</b></div>
          <div class="doc-total-row"><span>VAT ${q.vatRate || 10}%</span><b class="num">${fmtVND(pt.thanhTien * ((q.vatRate || 10) / 100))}</b></div>
          <div class="doc-total-row grand"><span>Tổng cộng</span><b class="num">${fmtVND(pt.thanhTien * (1 + (q.vatRate || 10) / 100))}</b></div>

          <div style="margin-top:14px" class="${pt.duoiGiaGoc ? '' : 'hidden'}">
            <div class="alert-item" style="cursor:default;border-color:var(--red)">
              <span class="alert-ico t-red"><i class="fa-solid fa-triangle-exclamation"></i></span>
              <span><span class="alert-title">Đơn giá chốt thấp hơn giá gốc</span>
              <div class="alert-sub">Đang bán dưới giá thành ${fmtVND(pt.giaGoc - pt.thanhTien)} — cần tăng đơn giá hoặc giảm hệ số.</div></span>
            </div>
          </div>
          <div style="margin-top:14px" class="${pt.duoiGiaGoc ? 'hidden' : ''}">
            <div class="alert-item" style="cursor:default;border-color:var(--green)">
              <span class="alert-ico t-green"><i class="fa-solid fa-circle-check"></i></span>
              <span><span class="alert-title">Lợi nhuận thực ${fmtDec(pt.loiNhuanThuc, 1)}%</span>
              <div class="alert-sub">Còn lại ${fmtVND(pt.conLai)} sau khi trừ toàn bộ chi phí.</div></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- HẠNG MỤC BÁO GIÁ SUY RA TỪ ĐƠN GIÁ CHỐT -->
    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div><h3>Hạng mục báo giá gửi khách</h3><p>Đơn giá từng hạng mục quy đổi từ đơn giá ${money(pt.donGiaChot)} VND/kg</p></div>
        <div class="right"><button class="btn btn-sm" data-act="export-quote-lines" data-id="${q.id}"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button></div>
      </div>
      ${tableShell(
        [{ t: 'STT', cls: 'center', w: '52px' }, { t: 'Hạng mục' }, { t: 'Quy cách' }, { t: 'ĐVT' },
         { t: 'Số lượng', cls: 'right' }, { t: 'Klg phôi kg', cls: 'right' }, { t: 'Đơn giá', cls: 'right' }, { t: 'Thành tiền', cls: 'right' }],
        quoteLinesFromInputs(q).map((l) => `<tr>
          <td class="center muted">${l.no}</td>
          <td class="strong">${esc(l.name)}</td>
          <td class="muted">${esc(l.spec)}</td>
          <td>${esc(l.unit)}</td>
          <td class="right num">${fmtDec(l.qty, 2)}</td>
          <td class="right num">${fmtDec(l.blankWeight, 2)}</td>
          <td class="right num">${fmtVND(l.price)}</td>
          <td class="right strong num">${fmtVND(l.amount)}</td></tr>`))}
    </div>
  </div>`;
}

/* ===================== TRANG CHI TIẾT BÁO GIÁ (3 TAB) ==================== */
const QUOTE_TABS = [
  { id: 'input', label: 'Tham số đầu vào', icon: 'fa-table-list' },
  { id: 'weight', label: 'Khối lượng & đơn giá', icon: 'fa-weight-hanging' },
  { id: 'analysis', label: 'Phân tích giá', icon: 'fa-chart-pie' },
];

Views['quote-detail'] = function (params) {
  const q = Q.quote(params.id);
  if (!q) return `<div class="empty"><div class="empty-ico"><i class="fa-solid fa-file-circle-xmark"></i></div><h4>Không tìm thấy báo giá</h4><button class="btn btn-primary btn-sm" data-act="go" data-id="quotes">Về danh sách báo giá</button></div>`;

  // Báo giá kiểu cũ (theo bảng giá sản phẩm) vẫn mở bằng modal bóc tách
  if (!q.inputs) { setTimeout(() => { go('quotes'); openQuoteModal(q.id); }, 0); return ''; }

  const c = Q.customer(q.customerId);
  const pt = phanTichGia(q);
  const tab = State.tab['quote'] || 'input';
  const linkedOrder = DB.orders.find((o) => o.quoteId === q.id);
  const thieu = pt.rows.filter((r) => !r.checkOk).length;

  return `
  ${pageHead(`Báo giá ${q.id}`, `${esc(c.name)} · ${q.inputs.length} cấu kiện · ${fmtDec(pt.blankWeight, 2)} kg phôi · Phụ trách ${esc(Q.employeeName(q.ownerId))}`, `
    <button class="btn" data-act="go" data-id="quotes"><i class="fa-solid fa-arrow-left"></i>Danh sách</button>
    <button class="btn" data-act="quote-preview-param" data-id="${q.id}"><i class="fa-regular fa-eye"></i>Xem trước bản in</button>
    <button class="btn" data-act="quote-sync-catalog" data-id="${q.id}"><i class="fa-solid fa-database"></i>Đồng bộ danh mục</button>
    ${['bg_nhap', 'bg_da_gui', 'bg_dam_phan'].includes(q.status) ? `<button class="btn btn-success" data-act="quote-approve" data-id="${q.id}"><i class="fa-solid fa-circle-check"></i>Khách duyệt</button>` : ''}
    ${q.status === 'bg_da_duyet' && !linkedOrder ? `<button class="btn btn-primary" data-act="quote-to-order" data-id="${q.id}"><i class="fa-solid fa-cart-plus"></i>Chuyển thành đơn hàng</button>` : ''}
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Trạng thái', `<span style="font-size:14px">${badge(q.status)}</span>`, 'fa-flag', statusTone(q.status))}
    ${mkpi('Khối lượng phôi', fmtDec(pt.blankWeight, 2) + ' kg', 'fa-cube', 'teal')}
    ${mkpi('Giá gốc', money0(pt.dgGiaGoc) + ' đ/kg', 'fa-tag', 'slate')}
    ${mkpi('Đơn giá chốt', money0(pt.donGiaChot) + ' đ/kg', 'fa-hand-holding-dollar', 'blue')}
    ${mkpi('Giá trị (chưa VAT)', fmtShort(pt.thanhTien), 'fa-sack-dollar', 'green')}
    ${mkpi('Lợi nhuận thực', fmtDec(pt.loiNhuanThuc, 1) + '%', 'fa-percent', pt.loiNhuanThuc >= 5 ? 'green' : pt.loiNhuanThuc >= 0 ? 'orange' : 'red')}
  </div>

  ${thieu ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--orange)">
    <div class="card-head">
      <span class="mkpi-ico t-orange"><i class="fa-solid fa-triangle-exclamation"></i></span>
      <div><h3>${thieu} cấu kiện chưa đủ điều kiện khai báo</h3><p>Các dòng thiếu kích thước vẫn được tính nhưng khối lượng có thể sai — nên bổ sung trước khi gửi khách</p></div>
    </div></div>` : ''}

  <div class="card">
    <div class="tabs">
      ${QUOTE_TABS.map((t) => `<button class="tab ${tab === t.id ? 'active' : ''}" data-act="quote-tab" data-tab="${t.id}" data-id="${q.id}">
        <i class="fa-solid ${t.icon}"></i> ${esc(t.label)}</button>`).join('')}
      <span style="margin-left:auto;display:flex;align-items:center;gap:8px;padding:6px 10px">
        <span id="qSaveState" style="font-size:11.8px;color:${q.dirty ? 'var(--orange)' : 'var(--green)'};white-space:nowrap">
          <i class="fa-solid ${q.dirty ? 'fa-circle' : 'fa-circle-check'}" style="font-size:8px"></i>
          ${q.dirty ? 'Có thay đổi chưa lưu' : (q.lastSaved ? 'Đã lưu lúc ' + esc(q.lastSaved) : 'Chưa có thay đổi')}
        </span>
        ${tab === 'input' ? `<button class="btn btn-sm btn-primary" data-act="qi-add" data-id="${q.id}"><i class="fa-solid fa-plus"></i>Thêm dòng</button>` : ''}
        <button class="btn btn-sm btn-success" data-act="quote-save-inputs" data-id="${q.id}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>
        ${tab === 'input' ? `<button class="btn btn-sm" data-act="export-quote-inputs" data-id="${q.id}"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button>` : ''}
      </span>
    </div>
    ${tab === 'input' ? quoteInputGrid(q) : tab === 'weight' ? quoteWeightTab(q) : quoteAnalysisTab(q)}
  </div>`;
};

/** Định dạng số tiền gọn không có chữ đ (dùng trong KPI) */
function money0(v) { return fmtN(Math.round(v)); }

/* ------------------------------- Cập nhật ô tính toán không vẽ lại lưới */
function refreshQuoteInputCells(q) {
  (q.inputs || []).forEach((r, i) => {
    const c = tinhDongThamSo(r);
    const set = (k, v) => { const el = document.querySelector(`[data-cell="${k}-${i}"]`); if (el) el.innerHTML = v; };
    // Tab tham số đầu vào
    set('w-mat', fmtDec(c.materialWeight, 2));
    set('w-blank', fmtDec(c.blankWeight, 2));
    set('w-out', c.outsourceWeight ? fmtDec(c.outsourceWeight, 2) : '—');
    set('w-area', fmtDec(c.surfaceArea, 2));
    set('w-check', c.checkOk ? '<span class="badge green">OK</span>' : '<span class="badge orange">Thiếu kích thước</span>');
    // Tab khối lượng & đơn giá
    set('c-mat', fmtVND(c.costMaterial));
    set('c-sur', fmtVND(c.costSurface));
    set('c-pro', fmtVND(c.costProduction));
  });
}

/* --------------------------------------------- Bản in gửi khách hàng */
function previewParamQuote(id) {
  const q = Q.quote(id);
  const c = Q.customer(q.customerId);
  const pt = phanTichGia(q);
  const lines = quoteLinesFromInputs(q);
  const vat = pt.thanhTien * ((q.vatRate || 10) / 100);

  Modal.open({
    title: 'Xem trước báo giá',
    sub: 'Bản in gửi khách hàng — đơn giá quy đổi từ khối lượng phôi sản phẩm',
    size: 'lg',
    body: `<div style="background:var(--surface);padding:6px 2px">
      <div style="display:flex;gap:14px;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid var(--primary)">
        <div class="brand-logo" style="width:44px;height:44px;font-size:19px"><i class="fa-solid fa-gear"></i></div>
        <div style="flex:1 1 auto">
          <div style="font-size:15px;font-weight:800">${esc(DB.company.name)}</div>
          <div style="font-size:11.8px;color:var(--text-3);margin-top:2px">${esc(DB.company.address)}</div>
          <div style="font-size:11.8px;color:var(--text-3)">MST: ${esc(DB.company.tax)} · ĐT: ${esc(DB.company.phone)} · ${esc(DB.company.website)}</div>
        </div>
        <div style="text-align:right">
          <div class="doc-title">BẢNG BÁO GIÁ</div>
          <div class="doc-meta">Số: ${q.id}</div>
          <div class="doc-meta">Ngày ${fmtDate(q.date)} · Hiệu lực đến ${fmtDate(q.validUntil)}</div>
        </div>
      </div>
      <div style="padding:14px 0;font-size:13px">
        <div><b>Kính gửi:</b> ${esc(c.name)}</div>
        <div style="color:var(--text-2);margin-top:3px">Người liên hệ: ${esc(c.contact)} · ĐT: ${esc(c.phone)} · Email: ${esc(c.email)}</div>
        <div style="color:var(--text-2);margin-top:6px">Trân trọng cảm ơn Quý khách đã quan tâm tới sản phẩm của chúng tôi. Chúng tôi xin gửi bảng báo giá như sau:</div>
      </div>
      <div class="tbl-wrap" style="border:1px solid var(--border);border-radius:var(--r)">
        <table class="tbl" style="min-width:700px">
          <thead><tr>
            <th class="center" style="width:46px">STT</th><th>Hạng mục / quy cách</th>
            <th style="width:58px">ĐVT</th><th class="right" style="width:86px">SL</th>
            <th class="right" style="width:118px">Đơn giá</th><th class="right" style="width:132px">Thành tiền</th>
          </tr></thead>
          <tbody>${lines.map((l) => `<tr>
            <td class="center muted">${l.no}</td>
            <td><div class="strong">${esc(l.name)}</div><div class="muted" style="font-size:11.5px">${esc(l.spec)}</div></td>
            <td>${esc(l.unit)}</td>
            <td class="right num">${fmtDec(l.qty, 2)}</td>
            <td class="right num">${fmtVND(l.price)}</td>
            <td class="right strong num">${fmtVND(l.amount)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <div style="flex:0 1 340px">
          <div class="doc-total-row"><span>Tổng GT chưa bao gồm VAT</span><b class="num">${fmtVND(pt.thanhTien)}</b></div>
          <div class="doc-total-row"><span>VAT ${q.vatRate || 10}%</span><b class="num">${fmtVND(vat)}</b></div>
          <div class="doc-total-row grand"><span>TỔNG GT BAO GỒM VAT</span><b class="num">${fmtVND(pt.thanhTien + vat)}</b></div>
        </div>
      </div>
      <div style="margin-top:16px;font-size:12.4px;color:var(--text-2);line-height:1.8">
        <div><b>1.</b> Đơn giá tính theo khối lượng phôi sản phẩm: <b>${money0(pt.donGiaChot)} VND/kg</b> · tổng khối lượng <b>${fmtDec(pt.blankWeight, 2)} kg</b>.</div>
        <div><b>2.</b> Báo giá có hiệu lực 07 ngày kể từ ngày phát hành, hoặc khi giá vật tư đầu vào biến động quá 5%.</div>
        <div><b>3.</b> Hàng mới 100%, chưa qua sử dụng, nguồn gốc xuất xứ rõ ràng theo đúng yêu cầu.</div>
        <div><b>4.</b> ${esc(q.paymentTerm || '')}</div>
        <div><b>5.</b> Đơn giá chưa bao gồm chi phí vận chuyển ngoài phạm vi thỏa thuận, hàng giao tại kho bên bán.</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:22px;font-size:12.5px;text-align:center">
        <div style="flex:1"><b>ĐẠI DIỆN KHÁCH HÀNG</b><div style="color:var(--text-3);margin-top:2px">(Ký, ghi rõ họ tên)</div></div>
        <div style="flex:1"><b>ĐẠI DIỆN VYKO</b><div style="color:var(--text-3);margin-top:2px">${esc(Q.employeeName(q.ownerId))}</div></div>
      </div>
    </div>`,
    foot: `<button class="btn" data-act="modal-close">Đóng</button>
           <button class="btn" data-act="export-quote-pdf" data-id="${q.id}"><i class="fa-solid fa-file-pdf"></i>Xuất PDF</button>`,
  });
}

/* ================= ĐỒNG BỘ VỀ DANH MỤC VẬT TƯ & CÔNG ĐOẠN ================ */
/**
 * Từ tham số đầu vào của báo giá:
 *   • mỗi tổ hợp "vật liệu + mác + chiều dày" -> 1 mã vật tư trong DANH MỤC VẬT TƯ
 *   • mỗi nguyên công có phát sinh          -> 1 công đoạn trong CÔNG ĐOẠN SẢN XUẤT
 */
function syncQuoteToCatalog(quoteId) {
  const q = Q.quote(quoteId);
  if (!q || !q.inputs) return;
  const pt = phanTichGia(q);
  const newMat = [], newOp = [], usedMat = [], usedOp = [];

  pt.rows.forEach((r) => {
    /* --- Vật tư --- */
    const tenVT = `${r.material} ${r.shape === 'Ống' ? 'ống' : 'tấm'} ${r.property} dày ${fmtDec(r.thickness, 2)}mm`;
    let mat = DB.materials.find((m) => m.name.toLowerCase() === tenVT.toLowerCase());
    if (!mat) {
      const id = nextCode('VT-', DB.materials, 3);
      mat = {
        id, name: tenVT,
        group: r.material === 'Thép' ? 'Thép & Inox' : r.material === 'Inox' ? 'Thép & Inox' : 'Kim loại màu',
        unit: 'Kg', stock: 0, minStock: Math.max(50, Math.ceil(r.materialWeight * 0.3)),
        location: 'Kho A - Chờ xếp vị trí', price: r.matPriceUsed,
        supplier: r.material === 'Inox' ? 'NCC-03' : r.material === 'Thép' ? 'NCC-01' : 'NCC-02',
        source: q.id,
        get status() { if (this.stock <= 0) return 'vt_het_hang'; if (this.stock < this.minStock) return 'vt_sap_het'; return 'vt_du_ton'; },
        get value() { return this.stock * this.price; },
      };
      DB.materials.push(mat);
      newMat.push(mat);
    } else usedMat.push(mat);
    r.materialId = mat.id;

    /* --- Công đoạn --- */
    NGUYEN_CONG.forEach((n) => {
      if (!(Number(r.ops?.[n.key]) > 0)) return;
      let op = DB.operations.find((o) => n.ops.includes(o.id)) || DB.operations.find((o) => o.name === n.name);
      if (!op) {
        const id = nextCode('CD-', DB.operations, 2);
        op = {
          id, name: n.name,
          workshop: { catTam: 'Cắt', catOng: 'Cắt', chan: 'Cắt', uon: 'Cắt', han: 'Hàn', mai: 'Sơn', lamSach: 'Sơn', khac: 'Lắp ráp' }[n.key] || 'Lắp ráp',
          machine: 'Chưa gán thiết bị', rate: n.dg, unit: 'lần',
          leadId: 'NV-008', source: q.id, note: 'Khai báo từ nguyên công trong báo giá',
        };
        DB.operations.push(op);
        newOp.push(op);
      } else if (!usedOp.includes(op)) usedOp.push(op);
    });
  });

  SEARCH_INDEX = null;
  logActivity('đồng bộ báo giá về danh mục', q.id, `${newMat.length} vật tư mới · ${newOp.length} công đoạn mới`, 'fa-database', 'indigo');

  const parts = [];
  if (newMat.length) parts.push(`${newMat.length} vật tư mới (${newMat.map((m) => m.id).join(', ')})`);
  if (usedMat.length) parts.push(`${usedMat.length} vật tư khớp danh mục sẵn có`);
  if (newOp.length) parts.push(`${newOp.length} công đoạn mới (${newOp.map((o) => o.id).join(', ')})`);
  if (usedOp.length) parts.push(`${usedOp.length} công đoạn khớp danh mục sẵn có`);

  Toast.ok('Đã đồng bộ về danh mục', parts.join(' · ') || 'Không có mục nào cần bổ sung');
  if (newMat.length) {
    pushNotification({ level: 'info', icon: 'fa-layer-group', title: `${newMat.length} vật tư mới từ ${q.id}`,
      desc: newMat.map((m) => `${m.id} ${m.name}`).join(', ') + ' — tồn kho 0, cần lập kế hoạch mua', go: { module: 'materials' } });
  }
  if (newOp.length) {
    pushNotification({ level: 'info', icon: 'fa-gears', title: `${newOp.length} công đoạn mới từ ${q.id}`,
      desc: newOp.map((o) => `${o.id} ${o.name}`).join(', '), go: { module: 'operations' } });
  }
  render();
}
