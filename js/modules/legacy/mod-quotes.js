/* ============================================================================
 * MODULE: BÁO GIÁ
 * Báo giá được lập theo cách của xưởng cơ khí: mỗi sản phẩm được BÓC TÁCH
 * thành (1) chủng loại vật tư tiêu hao và (2) các công đoạn gia công.
 * Giá thành = vật tư + công đoạn + chi phí quản lý; đơn giá bán = giá thành + lợi nhuận.
 *
 * Khi lưu báo giá:
 *   - vật tư mới khai báo  -> lưu về DANH MỤC VẬT TƯ  (DB.materials)
 *   - công đoạn mới khai báo -> lưu về CÔNG ĐOẠN SẢN XUẤT (DB.operations)
 *   - định mức của sản phẩm (BOM + routing) được cập nhật theo báo giá mới nhất
 * ==========================================================================*/

Views.quotes = function () {
  const f = F('quotes', { q: '', status: '', owner: '' });
  const q = (f.q || '').toLowerCase().trim();
  const list = DB.quotes.filter((x) => {
    if (f.status && x.status !== f.status) return false;
    if (f.owner && x.ownerId !== f.owner) return false;
    if (q && ![x.id, Q.customerName(x.customerId), Q.employeeName(x.ownerId)].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => b.id.localeCompare(a.id));
  const pg = paged(list, 'quotes');

  const owners = [...new Set(DB.quotes.map((x) => x.ownerId))].map((id) => [id, Q.employeeName(id)]);
  const approved = DB.quotes.filter((x) => x.status === 'bg_da_duyet').length;
  const sent = DB.quotes.filter((x) => ['bg_da_gui', 'bg_dam_phan', 'bg_da_duyet', 'bg_tu_choi'].includes(x.status)).length;
  const winRate = sent ? Math.round((approved / sent) * 100) : 0;

  const rows = pg.items.map((x) => {
    const d = daysTo(x.validUntil);
    const bd = quoteBreakdownCount(x);
    const moTa = x.inputs
      ? `${x.inputs.length} cấu kiện · ${fmtDec(phanTichGia(x).blankWeight, 1)} kg phôi`
      : x.items.map((i) => i.name).join(', ');
    return `<tr class="clickable" data-act="open-quote" data-id="${x.id}">
      <td><span class="code">${x.id}</span>${x.inputs ? '<div class="cell-sub"><i class="fa-solid fa-table-list"></i> Tham số đầu vào</div>' : ''}</td>
      <td>${cell2(esc(Q.customerName(x.customerId)), esc(moTa))}</td>
      <td class="hide-sm"><span class="chip" title="Chủng loại vật tư đã bóc tách"><i class="fa-solid fa-layer-group"></i>${bd.mat}</span>
        <span class="chip" title="Nguyên công / công đoạn đã bóc tách"><i class="fa-solid fa-gears"></i>${bd.op}</span></td>
      <td class="num">${fmtDate(x.date)}</td>
      <td class="hide-sm"><div style="display:flex;align-items:center;gap:8px">${avatarHTML(Q.employeeName(x.ownerId))}<span>${esc(Q.employeeName(x.ownerId))}</span></div></td>
      <td class="right strong num">${fmtVND(quoteSubtotal(x))}</td>
      <td class="num hide-sm">${cell2(fmtDate(x.validUntil), d < 0 ? '<span style="color:var(--red)">đã hết hiệu lực</span>' : `còn ${d} ngày`)}</td>
      <td>${badge(x.status)}</td>
      <td>${rowActions([
        { act: 'open-quote', data: `data-id="${x.id}"`, icon: 'fa-eye', title: 'Xem bóc tách báo giá' },
        ...(x.status === 'bg_da_duyet' ? [{ act: 'quote-to-order', data: `data-id="${x.id}"`, icon: 'fa-cart-plus', title: 'Chuyển thành đơn hàng' }] : []),
        ...(['bg_nhap', 'bg_da_gui', 'bg_dam_phan'].includes(x.status) ? [{ act: 'quote-approve', data: `data-id="${x.id}"`, icon: 'fa-circle-check', title: 'Đánh dấu đã duyệt' }] : []),
        { act: 'quote-delete', data: `data-id="${x.id}"`, icon: 'fa-trash', title: 'Xóa báo giá' },
      ])}</td>
    </tr>`;
  });

  // Tổng hợp giá thành toàn bộ báo giá để cho thấy chiều sâu nghiệp vụ
  const allMat = DB.quotes.reduce((s, x) => s + (x.inputs ? phanTichGia(x).cpVatTu : x.items.reduce((t, i) => t + i.materialCost * i.qty, 0)), 0);
  const allLab = DB.quotes.reduce((s, x) => s + (x.inputs ? phanTichGia(x).cpSanXuat : x.items.reduce((t, i) => t + i.laborCost * i.qty, 0)), 0);
  const soThamSo = DB.quotes.filter((x) => x.inputs).length;

  return `
  ${pageHead('Quản lý báo giá', 'Bóc tách vật tư và công đoạn gia công cho từng sản phẩm trước khi chốt giá', `
    <button class="btn" data-act="export-quotes"><i class="fa-solid fa-file-export"></i>Export</button>
    <button class="btn btn-primary" data-act="new-quote"><i class="fa-solid fa-plus"></i>Tạo báo giá</button>
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng báo giá', DB.quotes.length, 'fa-file-invoice-dollar', 'blue')}
    ${mkpi('Đã gửi khách', DB.quotes.filter((x) => x.status === 'bg_da_gui').length, 'fa-paper-plane', 'indigo')}
    ${mkpi('Đang đàm phán', DB.quotes.filter((x) => x.status === 'bg_dam_phan').length, 'fa-comments', 'orange')}
    ${mkpi('Đã duyệt', approved, 'fa-circle-check', 'green')}
    ${mkpi('Tỷ lệ chốt', winRate + '%', 'fa-bullseye', 'teal')}
    ${mkpi('Giá trị báo giá', fmtShort(DB.quotes.reduce((s, x) => s + quoteSubtotal(x), 0)), 'fa-sack-dollar', 'green')}
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="card-head">
      <span class="mkpi-ico t-indigo"><i class="fa-solid fa-scale-balanced"></i></span>
      <div><h3>Cơ cấu giá thành trong các báo giá</h3><p>${soThamSo} báo giá lập theo tham số đầu vào (tính VND/kg) · ${DB.quotes.length - soThamSo} báo giá theo bảng giá sản phẩm</p></div>
      <div class="right">
        <button class="btn btn-sm" data-act="go" data-id="materials"><i class="fa-solid fa-layer-group"></i>Danh mục vật tư</button>
        <button class="btn btn-sm" data-act="go" data-id="operations"><i class="fa-solid fa-gears"></i>Công đoạn sản xuất</button>
      </div>
    </div>
    <div class="card-body">
      <div class="stat-strip">
        <div><div class="l">Chi phí vật tư</div><div class="v" style="color:var(--teal)">${fmtShort(allMat)}</div></div>
        <div><div class="l">Chi phí gia công</div><div class="v" style="color:var(--indigo)">${fmtShort(allLab)}</div></div>
        <div><div class="l">Chủng loại vật tư đã dùng</div><div class="v">${new Set(DB.quotes.flatMap((x) => x.items.flatMap((i) => (i.materials || []).map((m) => m.materialId)))).size}</div></div>
        <div><div class="l">Công đoạn đã dùng</div><div class="v">${new Set(DB.quotes.flatMap((x) => x.items.flatMap((i) => (i.operations || []).map((o) => o.operationId)))).size}</div></div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="toolbar">
      ${searchBox('quotes', 'Tìm mã báo giá, khách hàng, người phụ trách…')}
      ${selectFilter('quotes', 'status', statusOptions('bg_'), 'Tất cả trạng thái')}
      ${selectFilter('quotes', 'owner', owners, 'Tất cả người phụ trách')}
      ${(f.q || f.status || f.owner) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="quotes"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} báo giá</span>
    </div>
    ${tableShell(
      [{ t: 'Mã báo giá', w: '124px' }, { t: 'Khách hàng / sản phẩm' }, { t: 'Bóc tách', cls: 'hide-sm', w: '110px' }, { t: 'Ngày báo giá' },
       { t: 'Người phụ trách', cls: 'hide-sm' }, { t: 'Giá trị', cls: 'right' }, { t: 'Hiệu lực đến', cls: 'hide-sm' },
       { t: 'Trạng thái', w: '134px' }, { t: 'Thao tác', cls: 'right', w: '140px' }],
      rows, { emptyTitle: 'Không tìm thấy báo giá', emptyAction: '<button class="btn btn-primary btn-sm" data-act="new-quote"><i class="fa-solid fa-plus"></i>Tạo báo giá mới</button>' })}
    ${pagiHTML('quotes', pg, 'báo giá')}
  </div>`;
};

/* ------------------------------------------------- XEM CHI TIẾT BÁO GIÁ */
function openQuoteModal(id) {
  const x = Q.quote(id);
  if (!x) return;
  const c = Q.customer(x.customerId);
  const linkedOrder = DB.orders.find((o) => o.quoteId === x.id);
  const totMat = x.items.reduce((s, i) => s + i.materialCost * i.qty, 0);
  const totLab = x.items.reduce((s, i) => s + i.laborCost * i.qty, 0);
  const totOh = x.items.reduce((s, i) => s + i.overhead * i.qty, 0);
  const totProfit = x.subtotal - totMat - totLab - totOh;

  Modal.open({
    title: `Báo giá ${x.id}`,
    sub: `${esc(c.name)} · Người phụ trách ${esc(Q.employeeName(x.ownerId))}`,
    size: 'xl',
    body: `
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px">
        ${badge(x.status)}
        <span class="chip"><i class="fa-regular fa-calendar"></i> Ngày báo giá ${fmtDate(x.date)}</span>
        <span class="chip"><i class="fa-solid fa-hourglass-half"></i> Hiệu lực đến ${fmtDate(x.validUntil)}</span>
        ${linkedOrder ? `<span class="chip" style="color:var(--green)"><i class="fa-solid fa-link"></i> Đã tạo đơn hàng ${linkedOrder.id}</span>` : ''}
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-address-card"></i>Thông tin khách hàng</div>
      <div class="info-grid" style="margin-bottom:18px">
        ${infoItem('Khách hàng', esc(c.name))}
        ${infoItem('Người liên hệ', esc(c.contact))}
        ${infoItem('Số điện thoại', esc(c.phone))}
        ${infoItem('Email', esc(c.email))}
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-diagram-project"></i>Bóc tách theo từng sản phẩm</div>
      ${x.items.map((it) => `
        <div class="card" style="margin-bottom:14px;background:var(--surface-2)">
          <div class="card-head" style="background:var(--surface)">
            <span class="mkpi-ico t-blue"><i class="fa-solid fa-cube"></i></span>
            <div style="min-width:0">
              <h3>${it.no}. ${esc(it.name)}</h3>
              <p>${esc(it.spec)} · Số lượng <b>${fmtN(it.qty)} ${esc(it.unit)}</b></p>
            </div>
            <div class="right" style="text-align:right">
              <div style="font-size:11.5px;color:var(--text-3)">Đơn giá bán</div>
              <div style="font-size:16px;font-weight:800;color:var(--primary)">${fmtVND(it.price)}</div>
            </div>
          </div>
          <div class="card-body">
            <div class="grid g-2">
              <div>
                <div class="form-sec-title" style="margin-top:0"><i class="fa-solid fa-layer-group"></i>Chủng loại vật tư · định mức cho 1 ${esc(it.unit)}</div>
                ${tableShell(
                  [{ t: 'Mã VT', w: '84px' }, { t: 'Tên vật tư' }, { t: 'Định mức', cls: 'right' }, { t: 'Đơn giá', cls: 'right' }, { t: 'Thành tiền', cls: 'right' }],
                  (it.materials || []).map((m) => `<tr>
                    <td><span class="code">${m.materialId}</span></td>
                    <td class="strong">${esc(m.name)}</td>
                    <td class="right num">${fmtDec(m.qtyPer, 3)} ${esc(m.unit)}</td>
                    <td class="right num muted">${fmtVND(m.price)}</td>
                    <td class="right strong num">${fmtVND(m.amount)}</td></tr>`),
                  { emptyTitle: 'Chưa bóc tách vật tư' })}
                <div class="doc-total-row" style="padding:9px 4px 0"><span>Cộng chi phí vật tư</span><b class="num" style="color:var(--teal)">${fmtVND(it.materialCost)}</b></div>
              </div>

              <div>
                <div class="form-sec-title" style="margin-top:0"><i class="fa-solid fa-gears"></i>Công đoạn gia công · định mức cho 1 ${esc(it.unit)}</div>
                ${tableShell(
                  [{ t: 'Mã CĐ', w: '78px' }, { t: 'Công đoạn' }, { t: 'Phân xưởng' }, { t: 'Giờ', cls: 'right' }, { t: 'Đơn giá giờ', cls: 'right' }, { t: 'Thành tiền', cls: 'right' }],
                  (it.operations || []).map((o) => `<tr>
                    <td><span class="code">${o.operationId}</span></td>
                    <td class="strong">${esc(o.name)}<div class="cell-sub">${esc(o.machine)}</div></td>
                    <td><span class="chip">${esc(o.workshop)}</span></td>
                    <td class="right num">${fmtDec(o.hoursPer, 2)}</td>
                    <td class="right num muted">${fmtVND(o.rate)}</td>
                    <td class="right strong num">${fmtVND(o.amount)}</td></tr>`),
                  { emptyTitle: 'Chưa bóc tách công đoạn' })}
                <div class="doc-total-row" style="padding:9px 4px 0"><span>Cộng chi phí gia công (${fmtDec(it.totalHours, 2)} giờ)</span><b class="num" style="color:var(--indigo)">${fmtVND(it.laborCost)}</b></div>
              </div>
            </div>

            <div class="stat-strip" style="margin-top:14px">
              <div><div class="l">Vật tư</div><div class="v" style="font-size:15px">${fmtVND(it.materialCost)}</div></div>
              <div><div class="l">Gia công</div><div class="v" style="font-size:15px">${fmtVND(it.laborCost)}</div></div>
              <div><div class="l">Chi phí QL (${it.overheadPct}%)</div><div class="v" style="font-size:15px">${fmtVND(it.overhead)}</div></div>
              <div><div class="l">Giá thành / ${esc(it.unit)}</div><div class="v" style="font-size:15px">${fmtVND(it.unitCost)}</div></div>
              <div><div class="l">Lợi nhuận</div><div class="v" style="font-size:15px;color:${it.profit >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtVND(it.profit)} · ${fmtDec(it.marginPct, 1)}%</div></div>
              <div><div class="l">Thành tiền</div><div class="v" style="font-size:15px;color:var(--primary)">${fmtVND(it.amount)}</div></div>
            </div>
          </div>
        </div>`).join('')}

      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <div style="flex:1 1 320px">
          <div class="form-sec-title"><i class="fa-solid fa-chart-pie"></i>Cơ cấu giá thành toàn báo giá</div>
          <div class="doc-total-row"><span>Chi phí vật tư</span><b class="num">${fmtVND(totMat)}</b></div>
          <div class="doc-total-row"><span>Chi phí gia công</span><b class="num">${fmtVND(totLab)}</b></div>
          <div class="doc-total-row"><span>Chi phí quản lý</span><b class="num">${fmtVND(totOh)}</b></div>
          <div class="doc-total-row"><span>Lợi nhuận gộp</span><b class="num" style="color:${totProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtVND(totProfit)}</b></div>
          <div style="margin-top:12px;font-size:12.6px;color:var(--text-2);line-height:1.7">
            <b>Điều khoản:</b> ${esc(x.paymentTerm)}
          </div>
        </div>
        <div style="flex:0 1 340px;min-width:280px">
          <div class="card" style="background:var(--surface-2)"><div class="card-body">
            <div class="doc-total-row"><span>Tạm tính</span><b class="num">${fmtVND(x.subtotal)}</b></div>
            <div class="doc-total-row"><span>Chiết khấu (${x.discountPct}%)</span><b class="num" style="color:var(--orange)">- ${fmtVND(x.discount)}</b></div>
            <div class="doc-total-row"><span>Thuế VAT (${x.vatRate}%)</span><b class="num">${fmtVND(x.vat)}</b></div>
            <div class="doc-total-row grand"><span>Tổng cộng</span><b class="num">${fmtVND(x.total)}</b></div>
          </div></div>
        </div>
      </div>`,
    foot: `
      <button class="btn left" data-act="open-customer" data-id="${c.id}"><i class="fa-solid fa-address-book"></i>Hồ sơ khách hàng</button>
      <button class="btn" data-act="modal-close">Đóng</button>
      <button class="btn" data-act="export-quote-pdf" data-id="${x.id}"><i class="fa-solid fa-file-pdf"></i>Xuất PDF</button>
      ${['bg_nhap', 'bg_da_gui', 'bg_dam_phan'].includes(x.status) ? `<button class="btn btn-success" data-act="quote-approve" data-id="${x.id}"><i class="fa-solid fa-circle-check"></i>Khách hàng duyệt</button>` : ''}
      ${x.status === 'bg_da_duyet' && !linkedOrder ? `<button class="btn btn-primary" data-act="quote-to-order" data-id="${x.id}"><i class="fa-solid fa-cart-plus"></i>Chuyển thành đơn hàng</button>` : ''}
      ${linkedOrder ? `<button class="btn btn-primary" data-act="open-order" data-id="${linkedOrder.id}"><i class="fa-solid fa-arrow-right"></i>Xem đơn hàng ${linkedOrder.id}</button>` : ''}`,
  });
}

/* ============================================================================
 * FORM LẬP BÁO GIÁ — bóc tách vật tư & công đoạn cho từng sản phẩm
 * ==========================================================================*/
const QuoteDraft = {
  customerId: '', contact: '', phone: '', email: '',
  date: DB.today, validUntil: '', ownerId: 'NV-002',
  paymentTerm: '30% tạm ứng khi ký hợp đồng, 70% thanh toán sau khi nghiệm thu',
  vatRate: 10, discountPct: 0, overheadPct: 8,
  items: [],
  expanded: 0,   // chỉ mở bóc tách của 1 sản phẩm tại một thời điểm cho dễ đọc

  reset(customerId) {
    Object.assign(this, {
      customerId: customerId || '', date: DB.today, validUntil: addDays(DB.today, DB.settings.quoteValidDays),
      ownerId: 'NV-002', vatRate: DB.settings.vatRate, discountPct: 0, overheadPct: DB.settings.overheadPct,
      paymentTerm: '30% tạm ứng khi ký hợp đồng, 70% thanh toán sau khi nghiệm thu',
      items: [this.blankItem()],
      expanded: 0,
    });
    this.syncCustomer();
  },

  blankItem() {
    return { productId: '', qty: 1, materials: [], operations: [], marginPct: DB.settings.defaultMargin };
  },

  /** Nạp định mức có sẵn của sản phẩm vào dòng báo giá */
  loadProduct(i, pid) {
    const it = this.items[i];
    it.productId = pid;
    const p = Q.product(pid);
    if (!p) { it.materials = []; it.operations = []; return; }
    it.materials = expandBom(p.bom).map((m) => ({ ...m, isNew: false }));
    it.operations = expandRouting(p.routing).map((o) => ({ ...o, isNew: false }));
    // Lấy đúng tỷ lệ lợi nhuận đang áp dụng cho sản phẩm để giá bán khớp bảng giá
    const c = rollupCost(it.materials, it.operations, p.price, this.overheadPct);
    it.marginPct = Math.max(0, c.marginPct);
  },

  syncCustomer() {
    const c = Q.customer(this.customerId);
    this.contact = c ? c.contact : '';
    this.phone = c ? c.phone : '';
    this.email = c ? c.email : '';
  },

  /** Giá thành + đơn giá bán của 1 dòng */
  lineCost(it) {
    const materials = it.materials.map((m) => ({ ...m, amount: Math.round((Number(m.qtyPer) || 0) * (Number(m.price) || 0)) }));
    const operations = it.operations.map((o) => ({ ...o, amount: Math.round((Number(o.hoursPer) || 0) * (Number(o.rate) || 0)) }));
    const c = rollupCost(materials, operations, 0, this.overheadPct);
    const price = priceFromCost(c.unitCost, it.marginPct);
    return { ...c, materials, operations, price, amount: price * (Number(it.qty) || 0) };
  },

  totals() {
    const lines = this.items.filter((i) => i.productId).map((i) => this.lineCost(i));
    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const discount = Math.round((subtotal * this.discountPct) / 100);
    const vat = Math.round(((subtotal - discount) * this.vatRate) / 100);
    const materialCost = this.items.filter((i) => i.productId).reduce((s, i, k) => s + lines[k].materialCost * (Number(i.qty) || 0), 0);
    const laborCost = this.items.filter((i) => i.productId).reduce((s, i, k) => s + lines[k].laborCost * (Number(i.qty) || 0), 0);
    return { subtotal, discount, vat, total: subtotal - discount + vat, count: lines.length, materialCost, laborCost };
  },
};

/* ------------------------------------------------------- Render dòng hàng */
const WORKSHOP_OPTS = ['Cắt', 'Tiện', 'Phay', 'Hàn', 'Sơn', 'Lắp ráp', 'QC', 'Hoàn thành'];

function qMaterialRows(i, it) {
  const unitOf = (m) => m.unit || '';
  return it.materials.map((m, j) => {
    const amount = Math.round((Number(m.qtyPer) || 0) * (Number(m.price) || 0));
    return `<tr>
      <td style="min-width:210px">
        ${m.isNew
          ? `<input class="inp" data-qf="matname" data-i="${i}" data-j="${j}" value="${esc(m.name)}" placeholder="Tên vật tư mới…" style="width:100%" />`
          : `<select class="inp" data-qf="mat" data-i="${i}" data-j="${j}" style="width:100%">
               ${DB.materials.map((x) => `<option value="${x.id}" ${m.materialId === x.id ? 'selected' : ''}>${esc(x.id + ' · ' + x.name)}</option>`).join('')}
             </select>`}
      </td>
      <td style="width:96px">
        ${m.isNew
          ? `<input class="inp" data-qf="matunit" data-i="${i}" data-j="${j}" value="${esc(m.unit)}" placeholder="Kg" />`
          : `<span class="muted">${esc(unitOf(m))}</span>`}
      </td>
      <td style="width:120px">
        ${m.isNew ? `<input class="inp" data-qf="matgroup" data-i="${i}" data-j="${j}" value="${esc(m.group || '')}" placeholder="Nhóm VT" />` : `<span class="chip">${esc(m.group || '—')}</span>`}
      </td>
      <td style="width:110px"><input class="inp right num" type="number" min="0" step="0.01" data-qf="matqty" data-i="${i}" data-j="${j}" value="${m.qtyPer}" /></td>
      <td style="width:130px"><input class="inp right num" type="number" min="0" step="1000" data-qf="matprice" data-i="${i}" data-j="${j}" value="${m.price}" /></td>
      <td class="right strong num" style="width:130px" data-cell="mat-${i}-${j}">${fmtVND(amount)}</td>
      <td style="width:38px">
        ${m.isNew ? '<span class="badge blue no-dot" style="font-size:10px">Mới</span>' : ''}
        <button class="btn btn-icon btn-xs" data-act="qmat-del" data-i="${i}" data-j="${j}" title="Xóa"><i class="fa-solid fa-xmark"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function qOperationRows(i, it) {
  return it.operations.map((o, j) => {
    const amount = Math.round((Number(o.hoursPer) || 0) * (Number(o.rate) || 0));
    return `<tr>
      <td style="min-width:200px">
        ${o.isNew
          ? `<input class="inp" data-qf="opname" data-i="${i}" data-j="${j}" value="${esc(o.name)}" placeholder="Tên công đoạn mới…" style="width:100%" />`
          : `<select class="inp" data-qf="op" data-i="${i}" data-j="${j}" style="width:100%">
               ${DB.operations.map((x) => `<option value="${x.id}" ${o.operationId === x.id ? 'selected' : ''}>${esc(x.id + ' · ' + x.name)}</option>`).join('')}
             </select>`}
      </td>
      <td style="width:120px">
        ${o.isNew
          ? `<select class="inp" data-qf="opws" data-i="${i}" data-j="${j}">${WORKSHOP_OPTS.map((w) => `<option ${o.workshop === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select>`
          : `<span class="chip">${esc(o.workshop)}</span>`}
      </td>
      <td style="min-width:150px">
        ${o.isNew
          ? `<input class="inp" data-qf="opmachine" data-i="${i}" data-j="${j}" value="${esc(o.machine)}" placeholder="Máy / thiết bị" style="width:100%" />`
          : `<span class="muted" style="font-size:11.8px">${esc(o.machine)}</span>`}
      </td>
      <td style="width:100px"><input class="inp right num" type="number" min="0" step="0.01" data-qf="ophours" data-i="${i}" data-j="${j}" value="${o.hoursPer}" /></td>
      <td style="width:130px"><input class="inp right num" type="number" min="0" step="10000" data-qf="oprate" data-i="${i}" data-j="${j}" value="${o.rate}" /></td>
      <td class="right strong num" style="width:130px" data-cell="op-${i}-${j}">${fmtVND(amount)}</td>
      <td style="width:38px">
        ${o.isNew ? '<span class="badge blue no-dot" style="font-size:10px">Mới</span>' : ''}
        <button class="btn btn-icon btn-xs" data-act="qop-del" data-i="${i}" data-j="${j}" title="Xóa"><i class="fa-solid fa-xmark"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function quoteLinesHTML() {
  return QuoteDraft.items.map((it, i) => {
    const p = Q.product(it.productId);
    const c = QuoteDraft.lineCost(it);
    const open = QuoteDraft.expanded === i;
    return `
    <div class="card" style="margin-bottom:10px;${open ? 'border-color:var(--primary)' : ''}">
      <div class="card-head" style="cursor:pointer;background:${open ? 'var(--primary-soft)' : 'var(--surface-2)'}" data-act="qline-toggle" data-i="${i}">
        <span class="n" style="width:24px;height:24px;border-radius:7px;background:var(--surface);border:1px solid var(--border);display:grid;place-items:center;font-size:11.5px;font-weight:700;flex:0 0 24px">${i + 1}</span>
        <div style="flex:1 1 240px;min-width:200px" onclick="event.stopPropagation()">
          <select class="inp" data-qf="product" data-i="${i}" style="width:100%">
            <option value="">— Chọn sản phẩm —</option>
            ${DB.products.map((x) => `<option value="${x.id}" ${it.productId === x.id ? 'selected' : ''}>${esc(x.id + ' · ' + x.name)}</option>`).join('')}
          </select>
        </div>
        <div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11.8px;color:var(--text-3)">SL</span>
          <input class="inp right num" type="number" min="1" data-qf="qty" data-i="${i}" value="${it.qty}" style="width:84px" />
          <span style="font-size:11.8px;color:var(--text-3);min-width:30px">${esc(p ? p.unit : '')}</span>
        </div>
        <div style="text-align:right;min-width:120px">
          <div style="font-size:11px;color:var(--text-3)">Đơn giá</div>
          <div class="num" style="font-weight:700" data-cell="price-${i}">${fmtVND(c.price)}</div>
        </div>
        <div style="text-align:right;min-width:130px">
          <div style="font-size:11px;color:var(--text-3)">Thành tiền</div>
          <div class="num" style="font-weight:800;color:var(--primary)" data-cell="amount-${i}">${fmtVND(c.amount)}</div>
        </div>
        <div style="display:flex;gap:5px" onclick="event.stopPropagation()">
          <button class="btn btn-icon btn-sm" data-act="qline-toggle" data-i="${i}" title="Bóc tách chi tiết"><i class="fa-solid fa-chevron-${open ? 'up' : 'down'}"></i></button>
          <button class="btn btn-icon btn-sm" data-act="qline-del" data-i="${i}" title="Xóa sản phẩm"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>

      ${!open ? `<div style="padding:8px 16px;font-size:11.8px;color:var(--text-3);display:flex;gap:14px;flex-wrap:wrap">
          <span><i class="fa-solid fa-layer-group" style="color:var(--teal)"></i> ${it.materials.length} chủng loại vật tư · <b>${fmtVND(c.materialCost)}</b></span>
          <span><i class="fa-solid fa-gears" style="color:var(--indigo)"></i> ${it.operations.length} công đoạn · ${fmtDec(c.totalHours, 2)} giờ · <b>${fmtVND(c.laborCost)}</b></span>
          <span><i class="fa-solid fa-percent"></i> Lợi nhuận <b>${fmtDec(it.marginPct, 1)}%</b></span>
        </div>` : `
      <div class="card-body">
        <!-- ===== VẬT TƯ ===== -->
        <div class="form-sec-title" style="margin-top:0">
          <i class="fa-solid fa-layer-group"></i>Chủng loại vật tư — định mức cho 1 ${esc(p ? p.unit : 'đơn vị')}
          <span style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-xs" data-act="qmat-add" data-i="${i}"><i class="fa-solid fa-plus"></i>Chọn từ kho</button>
            <button class="btn btn-xs btn-primary" data-act="qmat-new" data-i="${i}"><i class="fa-solid fa-wand-magic-sparkles"></i>Vật tư mới</button>
          </span>
        </div>
        <div class="tbl-wrap" style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:14px">
          <table class="line-tbl" style="min-width:780px">
            <thead><tr><th>Vật tư</th><th>ĐVT</th><th>Nhóm</th><th class="right">Định mức</th><th class="right">Đơn giá</th><th class="right">Thành tiền</th><th></th></tr></thead>
            <tbody>${it.materials.length ? qMaterialRows(i, it) : '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--text-3);font-size:12.3px">Chưa bóc tách vật tư — bấm “Chọn từ kho” hoặc “Vật tư mới”</td></tr>'}</tbody>
          </table>
        </div>

        <!-- ===== CÔNG ĐOẠN ===== -->
        <div class="form-sec-title">
          <i class="fa-solid fa-gears"></i>Công đoạn gia công — định mức cho 1 ${esc(p ? p.unit : 'đơn vị')}
          <span style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-xs" data-act="qop-add" data-i="${i}"><i class="fa-solid fa-plus"></i>Chọn công đoạn</button>
            <button class="btn btn-xs btn-primary" data-act="qop-new" data-i="${i}"><i class="fa-solid fa-wand-magic-sparkles"></i>Công đoạn mới</button>
          </span>
        </div>
        <div class="tbl-wrap" style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:14px">
          <table class="line-tbl" style="min-width:830px">
            <thead><tr><th>Công đoạn</th><th>Phân xưởng</th><th>Máy / thiết bị</th><th class="right">Giờ / SP</th><th class="right">Đơn giá giờ</th><th class="right">Thành tiền</th><th></th></tr></thead>
            <tbody>${it.operations.length ? qOperationRows(i, it) : '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--text-3);font-size:12.3px">Chưa bóc tách công đoạn — bấm “Chọn công đoạn” hoặc “Công đoạn mới”</td></tr>'}</tbody>
          </table>
        </div>

        <!-- ===== TỔNG HỢP GIÁ THÀNH DÒNG ===== -->
        <div class="stat-strip">
          <div><div class="l">Chi phí vật tư</div><div class="v" style="font-size:15px;color:var(--teal)" data-cell="lmat-${i}">${fmtVND(c.materialCost)}</div></div>
          <div><div class="l">Chi phí gia công</div><div class="v" style="font-size:15px;color:var(--indigo)" data-cell="llab-${i}">${fmtVND(c.laborCost)}</div></div>
          <div><div class="l">Chi phí QL (${QuoteDraft.overheadPct}%)</div><div class="v" style="font-size:15px" data-cell="loh-${i}">${fmtVND(c.overhead)}</div></div>
          <div><div class="l">Giá thành / ${esc(p ? p.unit : 'đv')}</div><div class="v" style="font-size:15px" data-cell="lcost-${i}">${fmtVND(c.unitCost)}</div></div>
          <div>
            <div class="l">Lợi nhuận (%)</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
              <input class="inp right num" type="number" min="0" max="200" step="0.5" data-qf="margin" data-i="${i}" value="${it.marginPct}" style="width:76px;height:30px" />
              <span style="color:var(--text-3)">%</span>
            </div>
          </div>
          <div><div class="l">Đơn giá bán</div><div class="v" style="font-size:15px;color:var(--primary)" data-cell="lprice-${i}">${fmtVND(c.price)}</div></div>
        </div>
      </div>`}
    </div>`;
  }).join('');
}

function quoteTotalsHTML() {
  const t = QuoteDraft.totals();
  return `
    <div class="doc-total-row"><span>Chi phí vật tư</span><b class="num" style="color:var(--teal)">${fmtVND(t.materialCost)}</b></div>
    <div class="doc-total-row"><span>Chi phí gia công</span><b class="num" style="color:var(--indigo)">${fmtVND(t.laborCost)}</b></div>
    <div class="doc-total-row" style="border-top:1px solid var(--border);margin-top:4px;padding-top:9px"><span>Tạm tính (${t.count} sản phẩm)</span><b class="num">${fmtVND(t.subtotal)}</b></div>
    <div class="doc-total-row"><span>Chiết khấu</span>
      <span style="display:flex;align-items:center;gap:7px">
        <input class="inp right num" type="number" min="0" max="100" data-qf="discount" value="${QuoteDraft.discountPct}" style="width:66px;height:30px" />
        <span style="color:var(--text-3)">%</span>
        <b class="num" style="color:var(--orange);min-width:96px;text-align:right">- ${fmtVND(t.discount)}</b>
      </span></div>
    <div class="doc-total-row"><span>Thuế VAT</span>
      <span style="display:flex;align-items:center;gap:7px">
        <select class="inp" data-qf="vat" style="width:74px;height:30px">
          ${[0, 5, 8, 10].map((v) => `<option value="${v}" ${QuoteDraft.vatRate === v ? 'selected' : ''}>${v}%</option>`).join('')}
        </select>
        <b class="num" style="min-width:96px;text-align:right">${fmtVND(t.vat)}</b>
      </span></div>
    <div class="doc-total-row grand"><span>Tổng cộng</span><b class="num">${fmtVND(t.total)}</b></div>`;
}

/** Vẽ lại toàn bộ phần động (khi thêm/xóa dòng, đổi sản phẩm/vật tư/công đoạn) */
function refreshQuoteForm() {
  const lines = document.getElementById('qLines');
  const totals = document.getElementById('qTotals');
  if (lines) lines.innerHTML = quoteLinesHTML();
  if (totals) totals.innerHTML = quoteTotalsHTML();
}

/** Chỉ cập nhật các ô số — giữ nguyên con trỏ khi người dùng đang gõ */
function updateQuoteNumbers() {
  const set = (sel, val) => { const el = document.querySelector(`[data-cell="${sel}"]`); if (el) el.textContent = val; };
  QuoteDraft.items.forEach((it, i) => {
    const c = QuoteDraft.lineCost(it);
    c.materials.forEach((m, j) => set(`mat-${i}-${j}`, fmtVND(m.amount)));
    c.operations.forEach((o, j) => set(`op-${i}-${j}`, fmtVND(o.amount)));
    set(`lmat-${i}`, fmtVND(c.materialCost));
    set(`llab-${i}`, fmtVND(c.laborCost));
    set(`loh-${i}`, fmtVND(c.overhead));
    set(`lcost-${i}`, fmtVND(c.unitCost));
    set(`lprice-${i}`, fmtVND(c.price));
    set(`price-${i}`, fmtVND(c.price));
    set(`amount-${i}`, fmtVND(c.amount));
  });
  const totals = document.getElementById('qTotals');
  if (totals) {
    // Giữ nguyên ô chiết khấu / VAT đang thao tác, chỉ vẽ lại nếu không có focus bên trong
    if (!totals.contains(document.activeElement)) totals.innerHTML = quoteTotalsHTML();
    else {
      const t = QuoteDraft.totals();
      const rows = totals.querySelectorAll('.doc-total-row b.num');
      if (rows[0]) rows[0].textContent = fmtVND(t.materialCost);
      if (rows[1]) rows[1].textContent = fmtVND(t.laborCost);
      if (rows[2]) rows[2].textContent = fmtVND(t.subtotal);
      if (rows[3]) rows[3].textContent = '- ' + fmtVND(t.discount);
      if (rows[4]) rows[4].textContent = fmtVND(t.vat);
      if (rows[5]) rows[5].textContent = fmtVND(t.total);
    }
  }
}

/** keep = true: giữ nguyên dữ liệu đang soạn (khi quay lại từ màn xem trước) */
function openQuoteForm(customerId, keep = false) {
  if (!keep) QuoteDraft.reset(customerId);
  Modal.open({
    title: 'Lập báo giá — bóc tách vật tư & công đoạn',
    sub: 'Mỗi sản phẩm được bóc tách tới từng chủng loại vật tư và từng công đoạn gia công. Vật tư / công đoạn khai báo mới sẽ được lưu về danh mục.',
    size: 'xl',
    body: `
      <div class="form-sec-title"><i class="fa-solid fa-address-card"></i>Thông tin khách hàng</div>
      <div class="form-grid">
        <div class="field" data-field="customer"><label>Khách hàng <span class="req">*</span></label>
          <select class="inp" data-qf="customer">
            <option value="">— Chọn khách hàng —</option>
            ${DB.customers.map((c) => `<option value="${c.id}" ${QuoteDraft.customerId === c.id ? 'selected' : ''}>${esc(c.id + ' · ' + c.name)}</option>`).join('')}
          </select><div class="err">Vui lòng chọn khách hàng</div></div>
        <div class="field"><label>Người liên hệ</label><input class="inp" id="qContact" value="${esc(QuoteDraft.contact)}" placeholder="Tự động điền theo khách hàng" /></div>
        <div class="field"><label>Số điện thoại</label><input class="inp" id="qPhone" value="${esc(QuoteDraft.phone)}" /></div>
        <div class="field"><label>Email</label><input class="inp" id="qEmail" value="${esc(QuoteDraft.email)}" /></div>
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-file-lines"></i>Thông tin báo giá</div>
      <div class="form-grid">
        <div class="field"><label>Ngày báo giá</label><input class="inp" type="date" data-qf="date" value="${QuoteDraft.date}" /></div>
        <div class="field"><label>Hiệu lực đến</label><input class="inp" type="date" data-qf="valid" value="${QuoteDraft.validUntil}" /></div>
        <div class="field"><label>Người phụ trách</label>
          <select class="inp" data-qf="owner">
            ${DB.employees.filter((e) => e.dept === 'Kinh doanh').map((e) => `<option value="${e.id}" ${QuoteDraft.ownerId === e.id ? 'selected' : ''}>${esc(e.name)} — ${esc(e.position)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Điều khoản thanh toán</label>
          <select class="inp" data-qf="term">
            <option>30% tạm ứng khi ký hợp đồng, 70% thanh toán sau khi nghiệm thu</option>
            <option>50% tạm ứng, 50% trước khi giao hàng</option>
            <option>Thanh toán 100% sau khi nghiệm thu, công nợ 30 ngày</option>
            <option>Thanh toán ngay khi nhận hàng</option>
          </select></div>
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-diagram-project"></i>Bóc tách giá thành theo sản phẩm
        <span style="margin-left:auto;display:flex;align-items:center;gap:8px">
          <span style="font-size:11.5px;color:var(--text-3);text-transform:none;letter-spacing:0">Chi phí quản lý</span>
          <input class="inp right num" type="number" min="0" max="50" step="0.5" data-qf="overhead" value="${QuoteDraft.overheadPct}" style="width:68px;height:28px" />
          <span style="color:var(--text-3)">%</span>
          <button class="btn btn-xs" data-act="qline-add"><i class="fa-solid fa-plus"></i>Thêm sản phẩm</button>
        </span>
      </div>
      <div id="qLines">${quoteLinesHTML()}</div>

      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <div style="flex:0 1 420px;min-width:300px">
          <div class="card" style="background:var(--surface-2)"><div class="card-body" id="qTotals">${quoteTotalsHTML()}</div></div>
        </div>
      </div>`,
    foot: `<button class="btn left" data-act="modal-close">Hủy</button>
           <button class="btn" data-act="quote-save" data-mode="draft"><i class="fa-solid fa-floppy-disk"></i>Lưu nháp</button>
           <button class="btn" data-act="quote-preview"><i class="fa-regular fa-eye"></i>Xem trước</button>
           <button class="btn btn-primary" data-act="quote-save" data-mode="send"><i class="fa-solid fa-paper-plane"></i>Gửi báo giá</button>`,
  });
}

/* ============================================================================
 * LƯU BÁO GIÁ — đồng thời cập nhật danh mục vật tư & công đoạn sản xuất
 * ==========================================================================*/
function saveQuote(mode) {
  const modal = $('#modalHost .modal');
  const fieldCustomer = modal ? modal.querySelector('[data-field="customer"]') : null;
  if (fieldCustomer) fieldCustomer.classList.remove('invalid');

  if (!QuoteDraft.customerId) {
    if (fieldCustomer) fieldCustomer.classList.add('invalid');
    Toast.err('Thiếu thông tin', 'Vui lòng chọn khách hàng trước khi lưu báo giá.');
    return;
  }
  const valid = QuoteDraft.items.filter((i) => i.productId && Number(i.qty) > 0);
  if (!valid.length) {
    Toast.err('Chưa có sản phẩm', 'Báo giá cần ít nhất 1 dòng sản phẩm với số lượng lớn hơn 0.');
    return;
  }
  const missing = valid.find((i) => !i.materials.length && !i.operations.length);
  if (missing) {
    Toast.err('Chưa bóc tách giá thành', `Sản phẩm "${Q.product(missing.productId).name}" chưa có vật tư hoặc công đoạn nào.`);
    return;
  }

  const quoteId = nextCode('BG-2026-', DB.quotes);
  const newMaterials = [];
  const newOperations = [];

  /* --- 1. Lưu vật tư mới về DANH MỤC VẬT TƯ --- */
  valid.forEach((it) => {
    it.materials.forEach((m) => {
      if (!m.isNew) return;
      const name = (m.name || '').trim();
      if (!name) return;
      const dup = DB.materials.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (dup) { m.materialId = dup.id; m.isNew = false; return; }
      const id = nextCode('VT-', DB.materials, 3);
      const mat = {
        id, name,
        group: (m.group || '').trim() || 'Vật tư khác',
        unit: (m.unit || '').trim() || 'Cái',
        stock: 0,
        minStock: Math.max(1, Math.ceil((Number(m.qtyPer) || 0) * (Number(it.qty) || 1))),
        location: 'Kho A - Chờ xếp vị trí',
        price: Number(m.price) || 0,
        supplier: 'NCC-08',
        source: quoteId,
        get status() { if (this.stock <= 0) return 'vt_het_hang'; if (this.stock < this.minStock) return 'vt_sap_het'; return 'vt_du_ton'; },
        get value() { return this.stock * this.price; },
      };
      DB.materials.push(mat);
      newMaterials.push(mat);
      m.materialId = id; m.isNew = false;
    });
  });

  /* --- 2. Lưu công đoạn mới về CÔNG ĐOẠN SẢN XUẤT --- */
  valid.forEach((it) => {
    it.operations.forEach((o) => {
      if (!o.isNew) return;
      const name = (o.name || '').trim();
      if (!name) return;
      const dup = DB.operations.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (dup) { o.operationId = dup.id; o.isNew = false; return; }
      const id = nextCode('CD-', DB.operations, 2);
      const op = {
        id, name,
        workshop: o.workshop || 'Lắp ráp',
        machine: (o.machine || '').trim() || 'Chưa gán thiết bị',
        rate: Number(o.rate) || 0,
        unit: 'giờ',
        leadId: STAGE_LEAD[o.workshop] || 'NV-008',
        source: quoteId,
        note: '',
      };
      DB.operations.push(op);
      newOperations.push(op);
      o.operationId = id; o.isNew = false;
    });
  });

  /* --- 3. Dựng dòng báo giá đã chốt --- */
  const items = valid.map((it, idx) => {
    const p = Q.product(it.productId);
    const c = QuoteDraft.lineCost(it);
    return {
      no: idx + 1, productId: p.id, name: p.name, spec: p.spec, unit: p.unit,
      qty: Number(it.qty), price: c.price, amount: c.amount,
      materials: c.materials.map((m) => ({ materialId: m.materialId, name: m.name, unit: m.unit, group: m.group, qtyPer: Number(m.qtyPer) || 0, price: Number(m.price) || 0, amount: m.amount })),
      operations: c.operations.map((o) => ({ operationId: o.operationId, name: o.name, workshop: o.workshop, machine: o.machine, hoursPer: Number(o.hoursPer) || 0, rate: Number(o.rate) || 0, amount: o.amount })),
      materialCost: c.materialCost, laborCost: c.laborCost, directCost: c.directCost,
      overhead: c.overhead, overheadPct: c.overheadPct, unitCost: c.unitCost,
      profit: c.price - c.unitCost,
      marginPct: c.unitCost ? Math.round(((c.price - c.unitCost) / c.unitCost) * 1000) / 10 : 0,
      totalHours: c.totalHours,
    };
  });

  const t = calcDocTotals(items, QuoteDraft.vatRate, QuoteDraft.discountPct);
  const quote = {
    id: quoteId,
    customerId: QuoteDraft.customerId,
    date: QuoteDraft.date,
    validUntil: QuoteDraft.validUntil,
    ownerId: QuoteDraft.ownerId,
    status: mode === 'send' ? 'bg_da_gui' : 'bg_nhap',
    items, vatRate: QuoteDraft.vatRate, discountPct: QuoteDraft.discountPct, ...t,
    paymentTerm: QuoteDraft.paymentTerm,
    note: 'Giá đã bao gồm gia công, xử lý bề mặt và vận chuyển tới kho khách hàng trong bán kính 50km.',
  };
  DB.quotes.unshift(quote);

  /* --- 4. Cập nhật định mức sản phẩm theo báo giá mới nhất --- */
  let updatedProducts = 0;
  items.forEach((it) => {
    const p = Q.product(it.productId);
    if (!p) return;
    if (it.materials.length) p.bom = it.materials.map((m) => [m.materialId, m.qtyPer]);
    if (it.operations.length) p.routing = it.operations.map((o) => [o.operationId, o.hoursPer]);
    if (it.materials.length || it.operations.length) updatedProducts++;
  });

  SEARCH_INDEX = null;
  logActivity('lập báo giá bóc tách', quote.id, `${items.length} SP · ${newMaterials.length} vật tư mới · ${newOperations.length} công đoạn mới`, 'fa-file-invoice-dollar', 'slate');
  Modal.close();
  go('quotes');

  Toast.ok(mode === 'send' ? 'Đã gửi báo giá tới khách hàng' : 'Đã lưu báo giá nháp', `${quote.id} · ${fmtVND(quote.subtotal)} (chưa VAT)`);

  // Báo rõ những gì đã được lưu về danh mục — đây là điểm nhấn nghiệp vụ
  const saved = [];
  if (newMaterials.length) saved.push(`${newMaterials.length} vật tư mới → Danh mục vật tư (${newMaterials.map((m) => m.id).join(', ')})`);
  if (newOperations.length) saved.push(`${newOperations.length} công đoạn mới → Công đoạn sản xuất (${newOperations.map((o) => o.id).join(', ')})`);
  if (updatedProducts) saved.push(`cập nhật định mức cho ${updatedProducts} sản phẩm`);
  if (saved.length) {
    setTimeout(() => Toast.show('Đã đồng bộ về danh mục', { type: 'info', desc: saved.join(' · '), timeout: 7000 }), 700);
  }
  if (newMaterials.length) {
    pushNotification({ level: 'info', icon: 'fa-layer-group', title: `${newMaterials.length} vật tư mới được khai báo từ ${quote.id}`, desc: newMaterials.map((m) => `${m.id} ${m.name}`).join(', ') + ' — tồn kho 0, cần lập kế hoạch mua', go: { module: 'materials' } });
  }
  if (newOperations.length) {
    pushNotification({ level: 'info', icon: 'fa-gears', title: `${newOperations.length} công đoạn mới được bổ sung từ ${quote.id}`, desc: newOperations.map((o) => `${o.id} ${o.name}`).join(', '), go: { module: 'operations' } });
  }
  if (mode === 'send') {
    pushNotification({ level: 'info', icon: 'fa-paper-plane', title: `Báo giá ${quote.id} đã gửi tới khách hàng`, desc: `${Q.customerName(quote.customerId)} — ${fmtVND(quote.subtotal)}`, go: { module: 'quotes', id: quote.id } });
  }
}

/* ------------------------------------------------ XEM TRƯỚC BẢN IN GỬI KHÁCH */
function previewQuote() {
  if (!QuoteDraft.customerId) { Toast.err('Chưa chọn khách hàng', 'Hãy chọn khách hàng để xem trước bản báo giá.'); return; }
  const c = Q.customer(QuoteDraft.customerId);
  const t = QuoteDraft.totals();
  const items = QuoteDraft.items.filter((i) => i.productId);

  Modal.open({
    title: 'Xem trước báo giá',
    sub: 'Bản in gửi khách hàng — có bóc tách vật tư và công đoạn gia công',
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
          <div class="doc-title">BÁO GIÁ</div>
          <div class="doc-meta">Ngày ${fmtDate(QuoteDraft.date)}</div>
          <div class="doc-meta">Hiệu lực đến ${fmtDate(QuoteDraft.validUntil)}</div>
        </div>
      </div>
      <div style="padding:14px 0;font-size:13px">
        <div><b>Kính gửi:</b> ${esc(c.name)}</div>
        <div style="color:var(--text-2);margin-top:3px">Người liên hệ: ${esc(QuoteDraft.contact)} · ĐT: ${esc(QuoteDraft.phone)} · Email: ${esc(QuoteDraft.email)}</div>
        <div style="color:var(--text-2);margin-top:6px">Công ty chúng tôi trân trọng gửi Quý khách bảng báo giá gia công cơ khí, có bóc tách chi tiết vật tư sử dụng và các công đoạn gia công như sau:</div>
      </div>
      <div class="tbl-wrap" style="border:1px solid var(--border);border-radius:var(--r)">
        <table class="tbl" style="min-width:700px">
          <thead><tr>
            <th class="center" style="width:48px">STT</th><th>Hạng mục</th>
            <th class="right" style="width:80px">SL</th><th style="width:58px">ĐVT</th>
            <th class="right" style="width:120px">Đơn giá</th><th class="right" style="width:130px">Thành tiền</th>
          </tr></thead>
          <tbody>
          ${items.map((i, k) => {
            const p = Q.product(i.productId);
            const cc = QuoteDraft.lineCost(i);
            return `<tr>
                <td class="center muted">${k + 1}</td>
                <td>
                  <div class="strong">${esc(p.name)}</div>
                  <div class="muted" style="font-size:11.6px">${esc(p.spec)}</div>
                  ${cc.materials.length ? `<div style="font-size:11.4px;color:var(--text-2);margin-top:5px"><b>Vật tư:</b> ${cc.materials.map((m) => `${esc(m.name)} ${fmtDec(m.qtyPer, 3)} ${esc(m.unit)}`).join('; ')}</div>` : ''}
                  ${cc.operations.length ? `<div style="font-size:11.4px;color:var(--text-2);margin-top:2px"><b>Gia công:</b> ${cc.operations.map((o) => `${esc(o.name)} ${fmtDec(o.hoursPer, 2)}h`).join('; ')}</div>` : ''}
                </td>
                <td class="right num">${fmtN(i.qty)}</td>
                <td>${esc(p.unit)}</td>
                <td class="right num">${fmtVND(cc.price)}</td>
                <td class="right strong num">${fmtVND(cc.amount)}</td>
              </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <div style="flex:0 1 340px">
          <div class="doc-total-row"><span>Tạm tính</span><b class="num">${fmtVND(t.subtotal)}</b></div>
          <div class="doc-total-row"><span>Chiết khấu (${QuoteDraft.discountPct}%)</span><b class="num">- ${fmtVND(t.discount)}</b></div>
          <div class="doc-total-row"><span>VAT (${QuoteDraft.vatRate}%)</span><b class="num">${fmtVND(t.vat)}</b></div>
          <div class="doc-total-row grand"><span>TỔNG CỘNG</span><b class="num">${fmtVND(t.total)}</b></div>
        </div>
      </div>
      <div style="margin-top:16px;font-size:12.5px;color:var(--text-2);line-height:1.8">
        <div><b>Điều khoản thanh toán:</b> ${esc(QuoteDraft.paymentTerm)}</div>
        <div><b>Thời gian giao hàng:</b> 15 – 30 ngày kể từ ngày ký hợp đồng và nhận tạm ứng.</div>
        <div><b>Bảo hành:</b> 12 tháng cho lỗi kỹ thuật và gia công.</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:22px;font-size:12.5px;text-align:center">
        <div style="flex:1"><b>ĐẠI DIỆN KHÁCH HÀNG</b><div style="color:var(--text-3);margin-top:2px">(Ký, ghi rõ họ tên)</div></div>
        <div style="flex:1"><b>ĐẠI DIỆN VYKO</b><div style="color:var(--text-3);margin-top:2px">${esc(Q.employeeName(QuoteDraft.ownerId))}</div></div>
      </div>
    </div>`,
    foot: `<button class="btn" data-act="back-quote-form"><i class="fa-solid fa-arrow-left"></i>Quay lại chỉnh sửa</button>
           <button class="btn btn-primary" data-act="quote-save" data-mode="send"><i class="fa-solid fa-paper-plane"></i>Gửi báo giá</button>`,
  });
}
