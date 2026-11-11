/* ============================================================================
 * MODULE: ĐƠN HÀNG — danh sách + trang chi tiết có timeline quy trình
 * ==========================================================================*/

Views.orders = function () {
  const f = F('orders', { q: '', status: '', owner: '' });
  if (State.params.filter) { f.status = State.params.filter; State.params.filter = null; }
  const q = (f.q || '').toLowerCase().trim();
  const list = DB.orders.filter((o) => {
    if (f.status && o.status !== f.status) return false;
    if (f.owner && o.ownerId !== f.owner) return false;
    if (q && ![o.id, Q.customerName(o.customerId), o.items.map((i) => i.name).join(' ')].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => b.id.localeCompare(a.id));
  const pg = paged(list, 'orders');
  const owners = [...new Set(DB.orders.map((o) => o.ownerId))].map((id) => [id, Q.employeeName(id)]);
  const cnt = (s) => DB.orders.filter((o) => o.status === s).length;

  const rows = pg.items.map((o) => {
    const pos = Q.posOfOrder(o.id);
    const prog = pos.length ? Math.round(pos.reduce((s, p) => s + Q.progress(p), 0) / pos.length) : 0;
    const late = daysTo(o.dueDate) < 0 && !['dh_da_giao', 'dh_hoan_thanh', 'dh_da_huy'].includes(o.status);
    return `<tr class="clickable" data-act="open-order" data-id="${o.id}">
      <td><span class="code">${o.id}</span>${o.quoteId ? `<div class="cell-sub">từ ${o.quoteId}</div>` : ''}</td>
      <td>${cell2(esc(Q.customerName(o.customerId)), esc(Q.customer(o.customerId)?.province || ''))}</td>
      <td class="hide-sm">${cell2(esc(o.items[0].name), o.items.length > 1 ? `+ ${o.items.length - 1} sản phẩm khác` : `${fmtN(o.items[0].qty)} ${esc(o.items[0].unit)}`)}</td>
      <td class="num">${fmtDT(o.orderedAt||o.date)}</td>
      <td class="num hide-sm">${cell2(fmtDate(o.dueDate), late ? '<span style="color:var(--red)">trễ hẹn giao</span>' : '')}</td>
      <td style="min-width:120px">${pos.length ? progressBar(prog) : '<span class="muted">Chưa có LSX</span>'}</td>
      <td class="right strong num">${fmtVND(o.total)}</td>
      <td>${badge(o.status)}</td>
      <td class="right">${rowActions([
        { act:'open-order', data:`data-id="${o.id}"`, icon:'fa-eye', title:'Xem chi tiết' },
        ...(o.status === 'dh_cho_xu_ly' && typeof Auth !== 'undefined' && Auth.hasPermission('SALES_APPROVE') ? [
          { act:'crm-order-approve', data:`data-id="${o.id}"`, icon:'fa-check', title:'Duyệt đơn hàng' },
          { act:'crm-order-reject', data:`data-id="${o.id}"`, icon:'fa-xmark', title:'Từ chối đơn hàng' },
        ] : []),
        ...(o.status === 'dh_hoan_thanh' && o.pendingIssueId ? [
          { act:'crm-order-deliver', data:`data-id="${o.id}"`, icon:'fa-truck-fast', title:'Giao hàng / mở yêu cầu xuất kho' },
        ] : []),
      ])}</td>
    </tr>`;
  });

  return `
  ${pageHead('Quản lý đơn hàng', `${DB.orders.length} đơn hàng · Tổng giá trị ${fmtShort(DB.orders.filter((o) => o.status !== 'dh_da_huy').reduce((s, o) => s + o.total, 0))}`, `
    <button class="btn" data-act="export-orders"><i class="fa-solid fa-file-export"></i>Export</button>
    <button class="btn btn-primary" data-act="new-order"><i class="fa-solid fa-plus"></i>Tạo đơn hàng</button>
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng đơn hàng', DB.orders.length, 'fa-cart-flatbed', 'blue', 'clear-filter-orders')}
    ${mkpi('Chờ xử lý', cnt('dh_cho_xu_ly') + cnt('dh_cho_san_xuat'), 'fa-hourglass-start', 'orange', 'filter-order-wait')}
    ${mkpi('Đang sản xuất', cnt('dh_dang_san_xuat'), 'fa-gears', 'indigo', 'filter-order-doing')}
    ${mkpi('Hoàn thành', cnt('dh_hoan_thanh'), 'fa-circle-check', 'green', 'filter-order-done')}
    ${mkpi('Đã giao', cnt('dh_da_giao'), 'fa-truck-fast', 'teal', 'filter-order-delivered')}
  </div>

  <div class="card">
    <div class="toolbar">
      ${searchBox('orders', 'Tìm mã đơn, khách hàng, sản phẩm…')}
      ${selectFilter('orders', 'status', statusOptions('dh_'), 'Tất cả trạng thái')}
      ${selectFilter('orders', 'owner', owners, 'Tất cả nhân viên')}
      ${(f.q || f.status || f.owner) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="orders"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} đơn hàng</span>
    </div>
    ${tableShell(
      [{ t: 'Mã đơn hàng', w: '134px' }, { t: 'Khách hàng' }, { t: 'Sản phẩm', cls: 'hide-sm' }, { t: 'Ngày đặt' },
       { t: 'Giao dự kiến', cls: 'hide-sm' }, { t: 'Tiến độ SX', w: '150px' }, { t: 'Giá trị', cls: 'right' }, { t: 'Trạng thái', w: '132px' }, { t: 'Thao tác', cls: 'right', w: '118px' }],
      rows, { emptyTitle: 'Không tìm thấy đơn hàng' })}
    ${pagiHTML('orders', pg, 'đơn hàng')}
  </div>`;
};

/* --------------------------------------------------- TRANG CHI TIẾT ĐƠN */

/** Trạng thái 7 bước của quy trình đơn hàng */
function orderFlow(o) {
  const pos = Q.posOfOrder(o.id);
  const allDone = pos.length > 0 && pos.every((p) => ['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status));
  const anyQC = pos.some((p) => p.status === 'lsx_dang_qc');
  const anyRun = pos.some((p) => p.status === 'lsx_dang_san_xuat');
  const done = {
    quote: !!o.quoteId,
    order: true,
    po: pos.length > 0,
    running: anyRun || anyQC || allDone,
    qc: anyQC || allDone,
    finish: allDone || ['dh_hoan_thanh', 'dh_da_giao', 'dh_hoan_tat'].includes(o.status),
    deliver: o.status === 'dh_da_giao',
  };
  const steps = [
    { key: 'quote',   name: 'Báo giá',        icon: 'fa-file-invoice-dollar', date: o.quoteId ? fmtDate(Q.quote(o.quoteId)?.date) : 'Không qua báo giá' },
    { key: 'order',   name: 'Đơn hàng',       icon: 'fa-file-signature',      date: fmtDT(o.orderedAt||o.date) },
    { key: 'po',      name: 'Lệnh sản xuất',  icon: 'fa-industry',            date: pos.length ? pos.map((p) => p.id).join(', ') : 'Chưa phát hành' },
    { key: 'running', name: 'Đang sản xuất',  icon: 'fa-gears',               date: pos.length ? Math.round(pos.reduce((s, p) => s + Q.progress(p), 0) / pos.length) + '% hoàn thành' : '—' },
    { key: 'qc',      name: 'Kiểm tra QC',    icon: 'fa-clipboard-check',     date: anyQC ? 'Đang nghiệm thu' : (allDone ? 'Đã đạt' : '—') },
    { key: 'finish',  name: 'Hoàn thành',     icon: 'fa-circle-check',        date: done.finish ? 'Sẵn sàng giao' : '—' },
    { key: 'deliver', name: 'Giao hàng',      icon: 'fa-truck-fast',          date: done.deliver ? fmtDate(o.dueDate) : 'Dự kiến ' + fmtDate(o.dueDate) },
  ];
  // Bước đang chạy = bước chưa hoàn tất đầu tiên sau các bước đã xong
  let cur = steps.findIndex((s) => !done[s.key]);
  return steps.map((s, i) => ({ ...s, state: done[s.key] ? 'done' : (i === cur ? 'doing' : 'pending') }));
}

Views['order-detail'] = function (params) {
  const o = Q.order(params.id);
  if (!o) return `<div class="empty"><div class="empty-ico"><i class="fa-solid fa-file-circle-xmark"></i></div><h4>Không tìm thấy đơn hàng</h4><p>Đơn hàng có thể đã bị xóa.</p><button class="btn btn-primary btn-sm" data-act="go" data-id="orders">Về danh sách đơn hàng</button></div>`;

  const c = Q.customer(o.customerId);
  const pos = Q.posOfOrder(o.id);
  const flow = orderFlow(o);
  const prog = pos.length ? Math.round(pos.reduce((s, p) => s + Q.progress(p), 0) / pos.length) : 0;
  const late = daysTo(o.dueDate);

  return `
  ${pageHead(`Đơn hàng ${o.id}`, `${esc(c.name)} · Đặt lúc ${fmtDT(o.orderedAt||o.date)} · Giao dự kiến ${fmtDate(o.dueDate)}`, `
    <button class="btn" data-act="go" data-id="orders"><i class="fa-solid fa-arrow-left"></i>Danh sách</button>
    <button class="btn" data-act="export-order-pdf" data-id="${o.id}"><i class="fa-solid fa-file-pdf"></i>Xuất PDF</button>
    ${o.status === 'dh_cho_xu_ly' && typeof Auth !== 'undefined' && Auth.hasPermission('SALES_APPROVE') ? `<button class="btn" data-act="crm-order-reject" data-id="${o.id}"><i class="fa-solid fa-xmark"></i>Từ chối</button><button class="btn btn-primary" data-act="crm-order-approve" data-id="${o.id}"><i class="fa-solid fa-check"></i>Duyệt đơn</button>` : ''}
    ${o.status === 'dh_hoan_thanh' && o.pendingIssueId ? `<span class="chip"><i class="fa-solid fa-box-open"></i> ${esc(o.pendingIssueId)} · Chờ kho xác nhận xuất</span><button class="btn btn-primary" data-act="crm-order-deliver" data-id="${o.id}"><i class="fa-solid fa-truck-fast"></i>Giao hàng</button>` : ''}
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Trạng thái', `<span style="font-size:14px">${typeof SalesCRM !== 'undefined' ? SalesCRM.badgeFrom(SalesCRM.orderStatus,o.status) : badge(o.status)}</span>`, 'fa-flag', statusTone(o.status))}
    ${mkpi('Giá trị đơn hàng', fmtShort(o.total), 'fa-sack-dollar', 'green')}
    ${mkpi('Tiến độ sản xuất', prog + '%', 'fa-gauge-high', prog >= 100 ? 'green' : 'blue')}
    ${mkpi('Hạn giao hàng', late >= 0 ? `còn ${late} ngày` : `trễ ${-late} ngày`, 'fa-calendar-day', late < 0 ? 'red' : late <= 5 ? 'orange' : 'slate')}
    ${mkpi('Lệnh sản xuất', pos.length, 'fa-industry', 'indigo')}
  </div>

  <!-- QUY TRÌNH XỬ LÝ -->
  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div><h3>Tiến trình xử lý đơn hàng</h3><p>Từ tạo đơn, duyệt, giữ chỗ tồn kho đến xuất giao cho khách hàng</p></div>
      <div class="right"><span class="chip"><i class="fa-solid fa-circle-check" style="color:var(--green)"></i> ${flow.filter((s) => s.state === 'done').length}/${flow.length} bước hoàn tất</span></div></div>
    <div class="card-body">
      <div class="flow">
        ${flow.map((s) => `<div class="flow-step ${s.state}">
          <div class="flow-ico"><i class="fa-solid ${s.icon}"></i></div>
          <div class="flow-name">${esc(s.name)}</div>
          <div class="flow-date">${esc(s.date)}</div>
        </div>`).join('')}
      </div>
    </div>
  </div>

  <div class="grid g-31" style="margin-bottom:14px">
    <!-- SẢN PHẨM -->
    <div class="card">
      <div class="card-head"><div><h3>Sản phẩm đặt hàng</h3><p>${o.items.length} dòng sản phẩm</p></div></div>
      ${tableShell(
        [{ t: 'STT', cls: 'center', w: '52px' }, { t: 'Mã SP', w: '84px' }, { t: 'Tên sản phẩm' }, { t: 'Quy cách', cls: 'hide-sm' },
         { t: 'SL', cls: 'right' }, { t: 'ĐVT' }, { t: 'Đơn giá', cls: 'right' }, { t: 'Thành tiền', cls: 'right' }],
        o.items.map((it) => `<tr>
          <td class="center muted">${it.no}</td>
          <td><span class="code">${it.productId}</span></td>
          <td class="strong">${esc(it.name)}</td>
          <td class="muted hide-sm">${esc(it.spec)}</td>
          <td class="right num">${fmtN(it.qty)}</td>
          <td>${esc(it.unit)}</td>
          <td class="right num">${fmtVND(it.price)}</td>
          <td class="right strong num">${fmtVND(it.amount)}</td></tr>`))}
      <div class="card-foot" style="display:flex;justify-content:flex-end">
        <div style="flex:0 1 320px">
          <div class="doc-total-row"><span>Tạm tính</span><b class="num">${fmtVND(o.subtotal)}</b></div>
          <div class="doc-total-row"><span>VAT (${o.vatRate}%)</span><b class="num">${fmtVND(o.vat)}</b></div>
          <div class="doc-total-row grand"><span>Tổng cộng</span><b class="num">${fmtVND(o.total)}</b></div>
        </div>
      </div>
    </div>

    <!-- THÔNG TIN CHUNG -->
    <div class="card">
      <div class="card-head"><div><h3>Thông tin chung</h3><p>Khách hàng & phụ trách</p></div></div>
      <div class="card-body">
        <div style="display:flex;align-items:center;gap:11px;padding-bottom:13px;margin-bottom:13px;border-bottom:1px solid var(--border)">
          ${avatarHTML(c.name, 'lg')}
          <div style="min-width:0">
            <div style="font-weight:700;font-size:13.6px">${esc(c.name)}</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:2px">${esc(c.contact)} · ${esc(c.phone)}</div>
          </div>
        </div>
        <dl class="dl">
          <dt>Mã đơn hàng</dt><dd><span class="code">${o.id}</span></dd>
          <dt>Báo giá gốc</dt><dd>${o.quoteId ? `<span class="code" data-act="open-quote" data-id="${o.quoteId}" style="cursor:pointer">${o.quoteId}</span>` : '<span class="muted">Không qua báo giá</span>'}</dd>
          <dt>Ngày giờ đặt hàng</dt><dd>${fmtDT(o.orderedAt||o.date)}</dd>
          <dt>Giao dự kiến</dt><dd>${fmtDate(o.dueDate)}</dd>
          <dt>Người tạo</dt><dd>${esc(o.createdByName || Q.employeeName(o.createdBy) || '—')}</dd>
          <dt>Thời gian tạo</dt><dd>${esc(o.createdAt ? String(o.createdAt).replace('T',' ').slice(0,19) : '—')}</dd>
          <dt>Người duyệt</dt><dd>${esc(o.approvedByName || Q.employeeName(o.approvedBy) || '—')}</dd>
          <dt>Thời gian duyệt</dt><dd>${esc(o.approvedAt ? String(o.approvedAt).replace('T',' ').slice(0,19) : '—')}</dd>
          ${o.status==='dh_tu_choi' ? `<dt>Lý do từ chối</dt><dd style="color:var(--red)">${esc(o.rejectReason||'—')}</dd>` : ''}
          <dt>NV phụ trách</dt><dd>${esc(Q.employeeName(o.ownerId))}</dd>
          <dt>Địa chỉ giao</dt><dd style="font-weight:500">${esc(c.address)}</dd>
          <dt>Mã số thuế</dt><dd>${esc(c.tax)}</dd>
        </dl>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm" data-act="open-customer" data-id="${c.id}"><i class="fa-solid fa-address-book"></i>Hồ sơ khách hàng</button>
          ${typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin() ? `<button class="btn btn-sm" data-act="order-status" data-id="${o.id}"><i class="fa-solid fa-arrows-rotate"></i>Đổi trạng thái</button>` : ''}
        </div>
      </div>
    </div>
  </div>

  <!-- LỆNH SẢN XUẤT LIÊN QUAN -->
  <div class="card">
    <div class="card-head">
      <div><h3>Liên kết sản xuất của đơn hàng</h3><p>${pos.length ? `${pos.length} lệnh đang theo dõi` : 'Nếu thiếu thành phẩm, Kho sẽ lập và duyệt Kế hoạch sản xuất trước khi chuyển sang Sản xuất'}</p></div>
    </div>
    ${tableShell(
      [{ t: 'Mã LSX', w: '140px' }, { t: 'Sản phẩm' }, { t: 'Số lượng', cls: 'right' }, { t: 'Bắt đầu' }, { t: 'Deadline' },
       { t: 'Tiến độ', w: '160px' }, { t: 'Trạng thái', w: '132px' }],
      pos.map((p) => `<tr class="clickable" data-act="open-production-order" data-id="${p.id}">
        <td><span class="code">${p.id}</span></td>
        <td>${cell2(esc(p.productName), esc(p.spec))}</td>
        <td class="right num">${fmtN(p.qty)} ${esc(p.unit)}</td>
        <td class="num">${fmtDate(p.startDate)}</td>
        <td class="num">${fmtDate(p.deadline)}</td>
        <td>${progressBar(Q.progress(p))}</td>
        <td>${badge(p.status)}</td></tr>`),
      { emptyTitle: 'Chưa có lệnh sản xuất', emptyDesc: 'Thiếu thành phẩm sẽ được Kho lập Kế hoạch sản xuất → Sản xuất yêu cầu NVL → Kho cấp NVL trước khi tạo LSX.' })}
  </div>`;
};

/* ------------------------------------------------- ĐỔI TRẠNG THÁI ĐƠN */
function openOrderStatusModal(id) {
  const o = Q.order(id);
  if (!o) return;
  Modal.open({
    title: 'Cập nhật trạng thái đơn hàng',
    sub: `${o.id} · ${esc(Q.customerName(o.customerId))}`,
    body: `<div class="field"><label>Trạng thái mới</label>
        <select class="inp" id="ordStatus">
          ${statusOptions('dh_').map(([v, l]) => `<option value="${v}" ${o.status === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Ghi chú thay đổi</label>
        <textarea class="inp" id="ordNote" rows="3" placeholder="Ví dụ: khách hàng đề nghị lùi lịch giao 3 ngày…"></textarea></div>
      <div style="font-size:12.3px;color:var(--text-3);background:var(--surface-2);border-radius:var(--r);padding:10px 12px">
        <i class="fa-solid fa-circle-info" style="color:var(--primary)"></i>
        Thay đổi trạng thái sẽ được ghi vào nhật ký hoạt động và cập nhật ngay trên dashboard.
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-primary" data-act="order-status-save" data-id="${o.id}"><i class="fa-solid fa-floppy-disk"></i>Cập nhật</button>`,
  });
}

/* ---------------------------------------------------- TẠO ĐƠN HÀNG MỚI */
function openOrderForm() {
  const approved = DB.quotes.filter((q) => q.status === 'bg_da_duyet' && !DB.orders.some((o) => o.quoteId === q.id));
  Modal.open({
    title: 'Tạo đơn hàng',
    sub: 'Đơn hàng được tạo từ báo giá đã được khách hàng duyệt',
    size: 'md',
    body: approved.length ? `
      <div style="font-size:12.8px;color:var(--text-2);margin-bottom:13px">
        Chọn một báo giá đã duyệt để chuyển thành đơn hàng. Toàn bộ dòng sản phẩm, đơn giá và giá trị hợp đồng sẽ được sao chép sang đơn hàng mới.
      </div>
      <div style="display:flex;flex-direction:column;gap:9px">
        ${approved.map((q) => `<div class="alert-item" data-act="quote-to-order" data-id="${q.id}">
          <span class="alert-ico t-green"><i class="fa-solid fa-file-invoice-dollar"></i></span>
          <span style="min-width:0">
            <span class="alert-title">${q.id} · ${esc(Q.customerName(q.customerId))}</span>
            <div class="alert-sub">${esc(q.items.map((i) => i.name).join(', '))} · ${fmtVND(q.total)}</div>
          </span>
          <i class="fa-solid fa-chevron-right"></i>
        </div>`).join('')}
      </div>`
      : `<div class="empty"><div class="empty-ico"><i class="fa-solid fa-file-circle-question"></i></div>
         <h4>Không có báo giá đã duyệt</h4>
         <p>Hãy tạo báo giá và đánh dấu khách hàng đã duyệt, sau đó chuyển thành đơn hàng.</p>
         <button class="btn btn-primary btn-sm" data-act="new-quote"><i class="fa-solid fa-plus"></i>Tạo báo giá</button></div>`,
    foot: '<button class="btn" data-act="modal-close">Đóng</button>',
  });
}

Views.crm = function (params = {}) {

  const tab = params.tab || State.tab || 'dashboard';

  switch (tab) {

    case 'dashboard':
      return Views['crm-dashboard']
        ? Views['crm-dashboard'](params)
        : Views.dashboard
          ? Views.dashboard(params)
          : '';

    case 'customers':
      return Views.customers
        ? Views.customers(params)
        : '';

    case 'leads':
      return Views.leads
        ? Views.leads(params)
        : '';

    case 'opportunities':
      return Views.opportunities
        ? Views.opportunities(params)
        : '';

    case 'appointments':
      return Views.appointments
        ? Views.appointments(params)
        : '';

    case 'tickets':
      return Views.tickets
        ? Views.tickets(params)
        : '';

    case 'orders':
      return Views.orders
        ? Views.orders(params)
        : '';

    case 'transactions':
      return Views.transactions
        ? Views.transactions(params)
        : '';

    case 'debts':
      return Views.debts
        ? Views.debts(params)
        : '';

    case 'reports':
      return Views['crm-reports']
        ? Views['crm-reports'](params)
        : '';

    default:
      return '';
  }
};
