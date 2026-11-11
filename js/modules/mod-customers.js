/* ============================================================================
 * MODULE: KHÁCH HÀNG & HỢP ĐỒNG
 * ==========================================================================*/

/* ------------------------------------------------------- KHÁCH HÀNG */

const CUSTOMER_OPPORTUNITY_OPTIONS = [
  ['UNDEFINED', 'Chưa xác định'],
  ['HAS_OPPORTUNITY', 'Có cơ hội'],
  ['FOLLOWING', 'Đang theo dõi'],
  ['NO_OPPORTUNITY', 'Không còn cơ hội'],
];

function customerOpportunityLabel(value) {
  return (CUSTOMER_OPPORTUNITY_OPTIONS.find(([id]) => id === value) || CUSTOMER_OPPORTUNITY_OPTIONS[0])[1];
}

function customerOpportunityBadge(value) {
  const tone = value === 'HAS_OPPORTUNITY' ? 'green' : value === 'FOLLOWING' ? 'orange' : value === 'NO_OPPORTUNITY' ? 'red' : 'slate';
  return `<span class="badge ${tone}">${esc(customerOpportunityLabel(value))}</span>`;
}
function filterCustomers() {
  const f = F('customers', { q: '', group: '', status: '', owner: '', opportunity: '' });
  const q = (f.q || '').toLowerCase().trim();
  return DB.customers.filter((c) => {
    if (f.group && c.group !== f.group) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.owner && c.owner !== f.owner) return false;
    if (f.opportunity && (c.opportunityStatus || 'UNDEFINED') !== f.opportunity) return false;
    if (q && ![c.id, c.name, c.contact, c.phone, c.email, c.province].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  });
}

Views.customers = function () {
  const canOperateCustomer = typeof Auth === 'undefined' || Auth.hasPermission('CRM_OPERATE');
  const f = F('customers', { q: '', group: '', status: '', owner: '', opportunity: '' });
  const list = filterCustomers();
  const pg = paged(list, 'customers');

  const groups = [...new Set(DB.customers.map((c) => c.group))].sort().map((g) => [g, g]);
  const owners = [...new Set(DB.customers.map((c) => c.owner))].sort().map((o) => [o, o]);

  const rows = pg.items.map((c) => {
    const orders = Q.ordersOf(c.id);
    const careCount = getCustomerCareCount(c.id);
    return `<tr class="clickable" data-act="open-customer" data-id="${c.id}">
      <td><span class="code">${c.id}</span></td>
      <td><div style="display:flex;align-items:center;gap:9px">${avatarHTML(c.name)}<span style="min-width:0">${cell2(esc(c.name), esc(c.group + ' · ' + c.province))}</span></div></td>
      <td class="hide-sm">${esc(c.contact)}</td>
      <td class="num">${esc(c.phone)}</td>
      <td class="hide-sm muted">${esc(c.email)}</td>
      <td class="center num">${orders.length}</td>
      <td class="right strong num">${fmtVND(typeof SalesCRM !== 'undefined' ? SalesCRM.revenueOfCustomer(c.id) : Q.revenueOf(c.id))}</td>
      <td>${customerOpportunityBadge(c.opportunityStatus || 'UNDEFINED')}<div class="cell-sub">${esc(c.opportunityNote || '')}</div></td>
      <td>${badge(c.status)}</td>
      <td class="center">
        ${canOperateCustomer ? `<button
          class="btn btn-sm btn-cskh"
          data-act="customer-care"
          data-customer-id="${c.id}"
          type="button"
          title="Nhật ký chăm sóc khách hàng">
          <i class="fa-solid fa-comments"></i>
          ${careCount > 0 ? `${careCount} lượt` : 'Chưa có'}
        </button>` : `<span class="muted">${careCount > 0 ? `${careCount} lượt` : '—'}</span>`}
      </td>
      <td>${rowActions([
        { act: 'open-customer', data: `data-id="${c.id}"`, icon: 'fa-eye', title: 'Xem chi tiết' },
        { act: 'edit-customer', data: `data-id="${c.id}"`, icon: 'fa-pen', title: 'Sửa thông tin' },
        { act: 'new-order-for', data: `data-id="${c.id}"`, icon: 'fa-cart-plus', title: 'Tạo đơn hàng bán' },
        ...(orders.length === 0 ? [{ act: 'delete-customer', data: `data-id="${c.id}"`, icon: 'fa-trash', title: 'Xóa khách hàng chưa có đơn hàng' }] : []),
      ])}</td>
    </tr>`;
  });

  return `
  ${pageHead('Quản lý khách hàng', `Tổng ${DB.customers.length} khách hàng · Doanh số lũy kế ${fmtShort(DB.customers.reduce((s, c) => s + (typeof SalesCRM !== 'undefined' ? SalesCRM.revenueOfCustomer(c.id) : Q.revenueOf(c.id)), 0))}`, `
    ${canOperateCustomer ? '<button class="btn" data-act="import-data" data-what="khách hàng"><i class="fa-solid fa-file-import"></i>Import</button>' : ''}
    <button class="btn" data-act="export-customers"><i class="fa-solid fa-file-export"></i>Export</button>
    ${canOperateCustomer ? '<button class="btn btn-primary" data-act="edit-customer"><i class="fa-solid fa-plus"></i>Thêm khách hàng</button>' : ''}
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Đang hợp tác', fmtN(DB.customers.filter((c) => c.status === 'kh_hoat_dong').length), 'fa-handshake', 'green')}
    ${mkpi('Khách tiềm năng', fmtN(DB.customers.filter((c) => c.status === 'kh_tiem_nang').length), 'fa-user-plus', 'blue')}
    ${mkpi('Tạm dừng', fmtN(DB.customers.filter((c) => c.status === 'kh_tam_dung').length), 'fa-user-slash', 'slate')}
    ${mkpi('Có cơ hội bán hàng', fmtN(DB.customers.filter((c) => ['HAS_OPPORTUNITY','FOLLOWING'].includes(c.opportunityStatus)).length), 'fa-bullseye', 'orange')}
    ${mkpi('Công nợ phải thu', fmtShort(DB.customers.reduce((s, c) => s + c.debt, 0)), 'fa-file-invoice-dollar', 'red')}
  </div>

  <div class="card">
    <div class="toolbar">
      ${searchBox('customers', 'Tìm theo mã, tên, người liên hệ, SĐT…')}
      ${selectFilter('customers', 'group', groups, 'Tất cả nhóm ngành')}
      ${selectFilter('customers', 'status', statusOptions('kh_'), 'Tất cả trạng thái')}
      ${selectFilter('customers', 'owner', owners, 'Tất cả nhân viên phụ trách')}
      ${selectFilter('customers', 'opportunity', CUSTOMER_OPPORTUNITY_OPTIONS, 'Tất cả cơ hội bán hàng')}
      ${(f.q || f.group || f.status || f.owner || f.opportunity) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="customers"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} kết quả</span>
    </div>
    ${tableShell(
      [{ t: 'Mã KH', w: '92px' }, { t: 'Tên khách hàng' }, { t: 'Người liên hệ', cls: 'hide-sm' }, { t: 'Số điện thoại' },
       { t: 'Email', cls: 'hide-sm' }, { t: 'Đơn hàng', cls: 'center', w: '86px' }, { t: 'Doanh số', cls: 'right' },
       { t: 'Cơ hội bán hàng', w: '170px' }, { t: 'Trạng thái', w: '130px' }, { t: 'CSKH', cls: 'center', w: '100px' }, { t: 'Thao tác', cls: 'right', w: '118px' }],
      rows, { emptyTitle: 'Không tìm thấy khách hàng', emptyAction: '<button class="btn btn-primary btn-sm" data-act="clear-filter" data-key="customers">Xóa bộ lọc</button>' })}
    ${pagiHTML('customers', pg, 'khách hàng')}
  </div>`;
};

/* ------------------------------------------- DRAWER CHI TIẾT KHÁCH HÀNG */
const CUST_TABS = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'orders',   label: 'Đơn hàng' },
  { id: 'contracts',label: 'Hợp đồng' },
  { id: 'debt',     label: 'Công nợ' },
  { id: 'history',  label: 'Lịch sử giao dịch' },
];

function getCustomerCareLogs(customerId) {
  return (DB.customerCareLogs || [])
    .filter(x => x.customerId === customerId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getCustomerCareCount(customerId) {
  return getCustomerCareLogs(customerId).length;
}

function saveCustomerCare(customerId) {
  const form = document.querySelector('#customerCareForm');
  if (!form) return;

  const date = form.querySelector('[name="careDate"]')?.value || '';
  const method = form.querySelector('[name="method"]')?.value || 'other';
  const content = form.querySelector('[name="content"]')?.value.trim() || '';

  // Validate
  const field = form.querySelector('[data-field="content"]');

  if (!content) {
    field?.classList.add('invalid');
    form.querySelector('[name="content"]')?.focus();
    return;
  }

  field?.classList.remove('invalid');

  // Khởi tạo nếu DB chưa có
  if (!Array.isArray(DB.customerCareLogs)) {
    DB.customerCareLogs = [];
  }

  // Tạo mã nhật ký
  const nextId = DB.customerCareLogs.length + 1;

  DB.customerCareLogs.push({
    id: `CSKH-${String(nextId).padStart(3, '0')}`,
    customerId,
    date,
    method,
    staff: 'Nguyễn Đức Anh',
    content
  });
  if (typeof SalesCRM !== 'undefined') SalesCRM.saveLocal();
  // Đóng modal
  Modal.close();
  // Vẽ lại màn hình hiện tại
  render();
}

function openCustomerCareModal(customerId) {
  const c = Q.customer(customerId);
  if (!c) return;

  const logs = getCustomerCareLogs(customerId);

  const methodLabels = {
    phone: 'Gọi điện',
    meeting: 'Gặp mặt',
    email: 'Email',
    zalo: 'Zalo',
    message: 'Tin nhắn',
    other: 'Khác'
  };

  const timelineHTML = logs.length
    ? `
      <div class="care-timeline">
        ${logs.map(log => `
          <div class="care-item">
            <div class="care-item-head">
              <span class="care-date">${fmtDate(log.date)}</span>
              <span class="chip">
                <i class="fa-solid fa-comments"></i>
                ${esc(methodLabels[log.method] || log.method || 'Khác')}
              </span>
            </div>

            <div class="care-staff">
              <i class="fa-solid fa-user"></i>
              ${esc(log.staff || 'Nhân viên')}
            </div>

            <div class="care-content">
              ${esc(log.content || '')}
            </div>
          </div>
        `).join('')}
      </div>
    `
    : `
      <div class="empty">
        <div class="empty-ico">
          <i class="fa-solid fa-comments"></i>
        </div>
        <h4>Chưa có lịch sử chăm sóc</h4>
        <p>Hãy ghi nhận lần chăm sóc đầu tiên cho khách hàng này.</p>
      </div>
    `;

  Modal.open({
    title: 'Nhật ký chăm sóc khách hàng',
    sub: `${esc(c.name)} · ${c.id}`,
    size: 'md',

    body: `
      <div class="care-customer-info">
        <div class="care-customer-name">
          ${avatarHTML(c.name)}
          <div>
            <strong>${esc(c.name)}</strong>
            <div class="muted">
              ${esc(c.contact || '')} · ${esc(c.phone || '')}
            </div>
          </div>
        </div>
      </div>

      <div class="form-sec-title">
        <i class="fa-solid fa-plus"></i>
        Ghi nhận chăm sóc
      </div>

      <form id="customerCareForm" novalidate>
        <div class="form-grid">

          <div class="field">
            <label>Ngày chăm sóc <span class="req">*</span></label>
            <input
              class="inp"
              type="date"
              name="careDate"
              value="${new Date().toISOString().slice(0, 10)}"
            />
          </div>

          <div class="field">
            <label>Hình thức</label>
            <select class="inp" name="method">
              <option value="phone">Gọi điện</option>
              <option value="meeting">Gặp mặt</option>
              <option value="email">Email</option>
              <option value="zalo">Zalo</option>
              <option value="message">Tin nhắn</option>
              <option value="other">Khác</option>
            </select>
          </div>

        </div>

        <div class="field" data-field="content">
          <label>Nội dung chăm sóc <span class="req">*</span></label>
          <textarea
            class="inp"
            name="content"
            rows="4"
            placeholder="Nhập nội dung trao đổi, nhu cầu, phản hồi của khách hàng..."
          ></textarea>
          <div class="err">Vui lòng nhập nội dung chăm sóc</div>
        </div>
      </form>

      <div class="form-sec-title" style="margin-top:22px">
        <i class="fa-solid fa-clock-rotate-left"></i>
        Lịch sử chăm sóc
        <span class="chip">${logs.length} lượt</span>
      </div>

      ${timelineHTML}
    `,

    foot: `
      <button class="btn" data-act="modal-close">
        Đóng
      </button>

      <button
        class="btn btn-primary"
        data-act="save-customer-care"
        data-customer-id="${c.id}">
        <i class="fa-solid fa-floppy-disk"></i>
        Lưu nhật ký
      </button>
    `
  });
}


function customerDrawerBody(c) {
  const tab = State.customerTab || 'overview';
  const orders = Q.ordersOf(c.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')));
  const contracts = Q.contractsOf(c.id);
  const revenue = typeof SalesCRM !== 'undefined' ? SalesCRM.revenueOfCustomer(c.id) : Q.revenueOf(c.id);
  const debtOrders = orders.filter((o) => ['dh_da_giao', 'dh_hoan_tat'].includes(o.status));
  const customerPaidTotal = typeof SalesCRM !== 'undefined'
    ? debtOrders.reduce((s, o) => s + SalesCRM.paidOfOrder(o.id), 0)
    : 0;
  const customerReceivable = typeof SalesCRM !== 'undefined'
    ? debtOrders.reduce((s, o) => s + SalesCRM.receivableOfOrder(o), 0)
    : Number(c.debt || 0);
  const customerOverdue = typeof SalesCRM !== 'undefined'
    ? debtOrders.reduce((s, o) => s + (SalesCRM.receivableStatus(o) === 'OVERDUE' ? SalesCRM.receivableOfOrder(o) : 0), 0)
    : Number(c.debt || 0);

  const counts = { orders: orders.length, contracts: contracts.length };

  const tabsHTML = `<div class="tabs">${CUST_TABS.map((t) => `
    <button class="tab ${tab === t.id ? 'active' : ''}" data-act="cust-tab" data-tab="${t.id}" data-id="${c.id}">
      ${esc(t.label)}${counts[t.id] != null ? `<span class="cnt">${counts[t.id]}</span>` : ''}
    </button>`).join('')}</div>`;

  let inner = '';

  if (tab === 'overview') {
    inner = `
      <div class="grid g-auto-sm" style="margin-bottom:16px">
        ${mkpi('Tổng đơn hàng', orders.length, 'fa-cart-flatbed', 'blue')}
        ${mkpi('Doanh số lũy kế', fmtShort(revenue), 'fa-sack-dollar', 'green')}
        ${mkpi('Công nợ', fmtShort(customerReceivable), 'fa-file-invoice', customerReceivable > 0 ? 'red' : 'slate')}
        ${mkpi('Hợp đồng', contracts.length, 'fa-file-contract', 'indigo')}
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-building"></i>Thông tin doanh nghiệp</div>
      <div class="info-grid" style="margin-bottom:18px">
        ${infoItem('Mã khách hàng', `<span class="code">${c.id}</span>`)}
        ${infoItem('Tên đầy đủ', esc(c.name))}
        ${infoItem('Mã số thuế', esc(c.tax))}
        ${infoItem('Nhóm ngành', esc(c.group))}
        ${infoItem('Địa chỉ', esc(c.address))}
        ${infoItem('Hợp tác từ', fmtDate(c.since))}
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-address-card"></i>Đầu mối liên hệ</div>
      <div class="info-grid" style="margin-bottom:18px">
        ${infoItem('Người liên hệ', esc(c.contact))}
        ${infoItem('Số điện thoại', esc(c.phone))}
        ${infoItem('Email', esc(c.email))}
        ${infoItem('NV phụ trách', esc(c.owner))}
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-bullseye"></i>Cơ hội bán hàng</div>
      <div class="info-grid" style="margin-bottom:18px">
        ${infoItem('Trạng thái cơ hội', customerOpportunityBadge(c.opportunityStatus || 'UNDEFINED'))}
        ${infoItem('Ghi chú cơ hội', esc(c.opportunityNote || 'Chưa có ghi chú'))}
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-chart-line"></i>Doanh số 6 tháng gần nhất</div>
      <div class="chart-box sm"><canvas id="chCustRevenue"></canvas></div>`;
  }

  if (tab === 'orders') {
    inner = tableShell(
      [{ t: 'Mã đơn' }, { t: 'Sản phẩm' }, { t: 'Ngày đặt' }, { t: 'Giá trị', cls: 'right' }, { t: 'Trạng thái' }],
      orders.map((o) => `<tr class="clickable" data-act="open-order" data-id="${o.id}">
        <td><span class="code">${o.id}</span></td>
        <td>${cell2(esc(o.items[0].name), o.items.length > 1 ? `+${o.items.length - 1} SP` : `${o.items[0].qty} ${esc(o.items[0].unit)}`)}</td>
        <td class="num">${fmtDate(o.date)}</td>
        <td class="right strong num">${fmtVND(o.total)}</td>
        <td>${badge(o.status)}</td></tr>`),
      { emptyTitle: 'Chưa có đơn hàng', emptyDesc: 'Khách hàng này chưa phát sinh đơn hàng nào.' });
  }


  if (tab === 'contracts') {
    inner = tableShell(
      [{ t: 'Mã HĐ' }, { t: 'Loại' }, { t: 'Ngày ký' }, { t: 'Hết hạn' }, { t: 'Giá trị', cls: 'right' }, { t: 'Trạng thái' }],
      contracts.map((ct) => `<tr class="clickable" data-act="open-contract" data-id="${ct.id}">
        <td><span class="code">${ct.id}</span></td>
        <td>${esc(ct.type)}</td>
        <td class="num">${fmtDate(ct.signDate)}</td>
        <td class="num">${fmtDate(ct.expireDate)}</td>
        <td class="right strong num">${fmtVND(ct.value)}</td>
        <td>${badge(ct.status)}</td></tr>`),
      { emptyTitle: 'Chưa có hợp đồng', emptyDesc: 'Khách hàng này chưa ký hợp đồng nào.' });
  }

  if (tab === 'debt') {
    const statusBadge = (st) => ({
      UNPAID: '<span class="badge slate">Chưa thanh toán</span>',
      PARTIALLY_PAID: '<span class="badge orange">Thanh toán một phần</span>',
      PAID: '<span class="badge green">Đã thanh toán</span>',
      OVERDUE: '<span class="badge red">Quá hạn</span>'
    }[st] || '<span class="badge slate">—</span>');

    const totalReceivable = debtOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    const debtRows = debtOrders.map((o) => {
      const paid = SalesCRM.paidOfOrder(o.id);
      const remain = SalesCRM.receivableOfOrder(o);
      const status = SalesCRM.receivableStatus(o);
      const due = o.paymentDueDate || o.dueDate || '';
      return `<tr class="clickable" data-act="open-order" data-id="${esc(o.id)}">
        <td><span class="code">${esc(o.id)}</span></td>
        <td class="num">${fmtDate(o.date)}</td>
        <td class="num">${due ? fmtDate(due) : '—'}</td>
        <td class="right num">${fmtVND(Number(o.total || 0))}</td>
        <td class="right num" style="color:var(--green)">${fmtVND(paid)}</td>
        <td class="right strong num" style="color:${remain > 0 ? 'var(--red)' : 'var(--text-3)'}">${fmtVND(remain)}</td>
        <td>${statusBadge(status)}</td>
      </tr>`;
    });

    const paymentRows = [...(DB.customerPayments || [])]
      .filter((p) => String(p.customerId || '') === String(c.id || ''))
      .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')))
      .map((p) => `<tr>
        <td><span class="code">${esc(p.id)}</span>${typeof paymentStatusTag==='function'?paymentStatusTag(p):''}</td>
        <td class="num">${fmtDate(p.date)}</td>
        <td><span class="code">${esc(p.orderId || '—')}</span></td>
        <td class="right strong num">${fmtVND(Number(p.amount || 0))}</td>
        <td>${esc(p.method || '—')}</td>
        <td>${esc(p.bankName || '—')}</td>
        <td>${esc(p.payerName || p.collectedByName || '—')}</td>
        <td class="muted">${esc(p.reference || p.bankRef || '')}</td>
      </tr>`);

    inner = `
      <div class="grid g-auto-sm" style="margin-bottom:16px">
        ${mkpi('Tổng phải thu', fmtShort(totalReceivable), 'fa-file-invoice-dollar', 'blue')}
        ${mkpi('Đã thu', fmtShort(customerPaidTotal), 'fa-money-bill-transfer', 'green')}
        ${mkpi('Còn phải thu', fmtShort(customerReceivable), 'fa-hourglass-half', customerReceivable > 0 ? 'orange' : 'slate')}
        ${mkpi('Quá hạn', fmtShort(customerOverdue), 'fa-triangle-exclamation', customerOverdue > 0 ? 'red' : 'slate')}
      </div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-head"><div><h3>Công nợ theo đơn hàng</h3><p>Đồng bộ trực tiếp với Công nợ khách hàng trong CRM.</p></div></div>
        ${tableShell(
          [{ t: 'Đơn hàng' }, { t: 'Ngày đơn' }, { t: 'Hạn thanh toán' }, { t: 'Tổng phải thu', cls: 'right' }, { t: 'Đã thu', cls: 'right' }, { t: 'Còn phải thu', cls: 'right' }, { t: 'Trạng thái' }],
          debtRows,
          { emptyTitle: 'Không có công nợ', emptyDesc: 'Khách hàng chưa có đơn hàng đã giao hoặc hoàn tất.' })}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Lịch sử thu tiền</h3><p>Các lần thanh toán của khách hàng, giao dịch mới nhất hiển thị trước.</p></div></div>
        ${tableShell(
          [{ t: 'Mã thu' }, { t: 'Ngày' }, { t: 'Đơn hàng' }, { t: 'Số tiền', cls: 'right' }, { t: 'Phương thức' }, { t: 'Ngân hàng' }, { t: 'Người thực hiện' }, { t: 'Tham chiếu' }],
          paymentRows,
          { emptyTitle: 'Chưa có lịch sử thu tiền', emptyDesc: 'Các lần thu công nợ sẽ tự động xuất hiện tại đây.' })}
      </div>`;
  }

  if (tab === 'history') {
    const events = [];
    orders.forEach((o) => events.push({ d: o.date, icon: 'fa-cart-flatbed', tone: 'blue', t: `Đặt đơn hàng ${o.id}`, s: `${o.items.map((i) => i.name).join(', ')} · ${fmtVND(o.total)}` }));
    contracts.forEach((ct) => events.push({ d: ct.signDate, icon: 'fa-file-signature', tone: 'indigo', t: `Ký hợp đồng ${ct.id}`, s: `${ct.type} · ${fmtVND(ct.value)}` }));
    DB.productionOrders.filter((p) => p.customerId === c.id).forEach((p) => events.push({ d: p.startDate, icon: 'fa-industry', tone: 'orange', t: `Phát hành lệnh sản xuất ${p.id}`, s: `${p.productName} · SL ${fmtN(p.qty)} ${p.unit}` }));
    events.sort((a, b) => b.d.localeCompare(a.d));
    inner = events.length ? `<div class="tline">${events.map((e) => `
        <div class="tline-item done">
          <span class="tline-dot" style="background:var(--surface);border-color:var(--${e.tone})"><i class="fa-solid ${e.icon}" style="color:var(--${e.tone})"></i></span>
          <div class="tline-title">${esc(e.t)}</div>
          <div class="tline-sub">${esc(e.s)} · ${fmtDate(e.d)}</div>
        </div>`).join('')}</div>`
      : '<div class="empty"><div class="empty-ico"><i class="fa-solid fa-clock-rotate-left"></i></div><h4>Chưa có giao dịch</h4><p>Lịch sử sẽ hiển thị khi phát sinh đơn hàng, chăm sóc, xuất bán hoặc hợp đồng.</p></div>';
  }

  return tabsHTML + `<div style="padding:17px 18px">${inner}</div>`;
}

function openCustomerDrawer(id) {
  const c = Q.customer(id);
  if (!c) return;
  State.customerTab = State.customerTab || 'overview';
  Drawer.open({
    title: `<div style="display:flex;align-items:center;gap:11px">${avatarHTML(c.name, 'lg')}<span>${esc(c.name)}<div style="font-size:12.5px;font-weight:500;color:var(--text-3);margin-top:2px">${c.id} · ${esc(c.group)} · ${esc(c.province)}</div></span></div>`,
    wide: true,
    body: customerDrawerBody(c),
    foot: `<button class="btn" data-act="drawer-close">Đóng</button>
           ${(typeof Auth === 'undefined' || Auth.hasPermission('CRM_OPERATE')) ? `<button class="btn" data-act="edit-customer" data-id="${c.id}"><i class="fa-solid fa-pen"></i>Sửa thông tin</button>` : ''}
           ${(typeof Auth === 'undefined' || Auth.hasPermission('SALES_ORDER_OPERATE')) ? `<button class="btn btn-primary" data-act="new-order-for" data-id="${c.id}"><i class="fa-solid fa-cart-plus"></i>Tạo đơn hàng bán</button>` : ''}`,
    onMount: () => drawCustomerChart(c),
  });
}

function drawCustomerChart(c) {
  if (!document.getElementById('chCustRevenue')) return;
  // Doanh số theo tháng của riêng khách hàng (tính từ đơn hàng thực tế)
  const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
  const data = months.map((m) => Q.ordersOf(c.id).filter((o) => o.date.startsWith(m) && o.status !== 'dh_da_huy').reduce((s, o) => s + o.total, 0));
  Charts.bar('chCustRevenue', months.map((m) => 'T' + Number(m.slice(5)) + '/26'), [{ label: 'Doanh số', data, color: 'blue' }], { money: true });
}

/* ---------------------------------------------- FORM THÊM/SỬA KHÁCH HÀNG */
function openCustomerForm(id) {
  const c = id ? Q.customer(id) : null;
  const groups = [...new Set(DB.customers.map((x) => x.group))].sort();
  const owners = [...new Set(DB.customers.map((x) => x.owner))].sort();

  Modal.open({
    title: c ? 'Cập nhật khách hàng' : 'Thêm khách hàng mới',
    sub: c ? `Mã khách hàng ${c.id}` : 'Mã khách hàng sẽ được cấp tự động',
    size: 'md',
    body: `<form id="custForm" novalidate>
      <div class="form-sec-title"><i class="fa-solid fa-building"></i>Thông tin doanh nghiệp</div>
      <div class="form-grid">
        <div class="field" data-field="name"><label>Tên khách hàng <span class="req">*</span></label>
          <input class="inp" name="name" value="${esc(c?.name || '')}" placeholder="Công ty TNHH …" /><div class="err">Vui lòng nhập tên khách hàng</div></div>
        <div class="field"><label>Mã số thuế</label>
          <input class="inp" name="tax" value="${esc(c?.tax || '')}" placeholder="0312345678" /></div>
        <div class="field"><label>Nhóm ngành</label>
          <select class="inp" name="group">${groups.map((g) => `<option ${c?.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>
        <div class="field"><label>Tỉnh / Thành phố <span class="req">*</span></label>
          <select class="inp" name="province" id="custProvince"><option value="">-- Chọn Tỉnh/Thành phố --</option></select></div>
        <div class="field"><label>Phường / Xã / Đặc khu <span class="req">*</span></label>
          <select class="inp" name="ward" id="custWard"><option value="">-- Chọn Phường/Xã/Đặc khu --</option></select></div>
      </div>
      <div class="field"><label>Địa chỉ chi tiết <span class="req">*</span></label><input class="inp" name="addressDetail" id="custAddressDetail" value="${esc(c?.addressDetail || (!c?.ward ? (c?.address || '') : ''))}" placeholder="Số nhà, tên đường, tòa nhà..." /><div class="cell-sub">Địa chỉ mới sau sáp nhập dùng 2 cấp: Tỉnh/Thành phố → Phường/Xã/Đặc khu.</div></div>

      <div class="form-sec-title"><i class="fa-solid fa-address-card"></i>Đầu mối liên hệ</div>
      <div class="form-grid">
        <div class="field" data-field="contact"><label>Người liên hệ <span class="req">*</span></label>
          <input class="inp" name="contact" value="${esc(c?.contact || '')}" placeholder="Nguyễn Văn A" /><div class="err">Vui lòng nhập người liên hệ</div></div>
        <div class="field" data-field="phone"><label>Số điện thoại <span class="req">*</span></label>
          <input class="inp" name="phone" type="tel" inputmode="numeric" maxlength="10" pattern="[0-9]{10}" value="${esc(String(c?.phone || '').replace(/\D/g, '').slice(0, 10))}" placeholder="0912345678" oninput="this.value=this.value.replace(/\D/g,'').slice(0,10)" /><div class="err">Số điện thoại phải đúng 10 chữ số</div></div>
        <div class="field" data-field="email"><label>Email</label>
          <input class="inp" name="email" value="${esc(c?.email || '')}" placeholder="lienhe@congty.vn" /><div class="err">Email không hợp lệ</div></div>
        <div class="field"><label>Nhân viên phụ trách</label>
          <select class="inp" name="owner">${owners.map((o) => `<option ${c?.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Trạng thái</label>
          <select class="inp" name="status">${statusOptions('kh_').map(([v, l]) => `<option value="${v}" ${c?.status === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label>Hạn mức công nợ (đ)</label>
          <input class="inp num" name="debt" value="${c?.debt || 0}" /></div>
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-bullseye"></i>Cơ hội bán hàng</div>
      <div class="form-grid">
        <div class="field"><label>Trạng thái cơ hội</label>
          <select class="inp" name="opportunityStatus">${CUSTOMER_OPPORTUNITY_OPTIONS.map(([v,l]) => `<option value="${v}" ${(c?.opportunityStatus || 'UNDEFINED') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label>Ghi chú cơ hội</label>
          <textarea class="inp" name="opportunityNote" rows="3" placeholder="Ví dụ: Quan tâm đậu hũ trắng 300g, đậu hũ chiên...">${esc(c?.opportunityNote || '')}</textarea></div>
      </div>
    </form>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-primary" data-act="save-customer" data-id="${c?.id || ''}"><i class="fa-solid fa-floppy-disk"></i>${c ? 'Lưu thay đổi' : 'Thêm khách hàng'}</button>`,
  });
  if (typeof VNAddress !== 'undefined') {
    VNAddress.init({provinceId:'custProvince',wardId:'custWard',province:c?.province||'',ward:c?.ward||''});
  }
}

/** Kiểm tra dữ liệu form khách hàng — trả về object hoặc null nếu lỗi */
function validateCustomerForm(form) {
  const get = (n) => form.querySelector(`[name="${n}"]`);
  const data = {};
  ['name', 'tax', 'group', 'province', 'ward', 'addressDetail', 'contact', 'phone', 'email', 'owner', 'status', 'debt', 'opportunityStatus', 'opportunityNote'].forEach((n) => { data[n] = get(n) ? get(n).value.trim() : ''; });
  let ok = true;
  const fail = (field) => { const f = form.querySelector(`[data-field="${field}"]`); if (f) f.classList.add('invalid'); ok = false; };
  form.querySelectorAll('.field').forEach((f) => f.classList.remove('invalid'));
  if (!data.name) fail('name');
  if (!data.contact) fail('contact');
  if (!data.province || !data.ward || !data.addressDetail) { Toast.err('Thiếu địa chỉ', 'Vui lòng chọn Tỉnh/Thành phố, Phường/Xã/Đặc khu và nhập địa chỉ chi tiết theo địa giới sau sáp nhập.'); ok = false; }
  data.district = '';
  data.address = (typeof VNAddress !== 'undefined') ? VNAddress.compose(data.addressDetail, data.ward, '', data.province) : [data.addressDetail,data.ward,data.province].filter(Boolean).join(', ');
  data.phone = data.phone.replace(/\D/g, '');
  if (!/^\d{10}$/.test(data.phone)) fail('phone');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail('email');
  if (!ok) return null;
  data.debt = Number(String(data.debt).replace(/\D/g, '')) || 0;
  return data;
}

/* ---------------------------------------------------------- HỢP ĐỒNG */
Views.contracts = function () {
  const f = F('contracts', { q: '', status: '', type: '' });
  if (State.params.filter === 'expiring') { f.status = 'hd_sap_het_han'; State.params.filter = null; }
  const q = (f.q || '').toLowerCase().trim();
  const list = DB.contracts.filter((c) => {
    if (f.status && c.status !== f.status) return false;
    if (f.type && c.type !== f.type) return false;
    if (q && ![c.id, Q.customerName(c.customerId), c.type].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  });
  const pg = paged(list, 'contracts');
  const expiring = Q.expiringContracts(45);
  const types = [...new Set(DB.contracts.map((c) => c.type))].map((t) => [t, t]);

  const rows = pg.items.map((c) => {
    const d = daysTo(c.expireDate);
    return `<tr class="clickable" data-act="open-contract" data-id="${c.id}">
      <td><span class="code">${c.id}</span></td>
      <td>${cell2(esc(Q.customerName(c.customerId)), esc(c.customerId))}</td>
      <td class="hide-sm">${esc(c.type)}</td>
      <td class="num">${fmtDate(c.signDate)}</td>
      <td class="num">${cell2(fmtDate(c.expireDate), d >= 0 && d <= 45 ? `<span style="color:var(--orange)">còn ${d} ngày</span>` : (d < 0 ? '<span style="color:var(--red)">đã hết hạn</span>' : ''))}</td>
      <td class="right strong num">${fmtVND(c.value)}</td>
      <td class="right num hide-sm">${c.remain > 0 ? `<span style="color:var(--orange)">${fmtVND(c.remain)}</span>` : '<span style="color:var(--green)">Đã tất toán</span>'}</td>
      <td>${badge(c.status)}</td>
      <td>${rowActions([
        { act: 'open-contract', data: `data-id="${c.id}"`, icon: 'fa-eye', title: 'Xem chi tiết' },
        { act: 'export-contract', data: `data-id="${c.id}"`, icon: 'fa-file-pdf', title: 'Xuất PDF' },
      ])}</td>
    </tr>`;
  });

  return `
  ${pageHead('Quản lý hợp đồng', `${DB.contracts.length} hợp đồng · Tổng giá trị ${fmtShort(DB.contracts.reduce((s, c) => s + c.value, 0))}`, `
    <button class="btn" data-act="export-contracts"><i class="fa-solid fa-file-export"></i>Export</button>
    <button class="btn btn-primary" data-act="new-contract"><i class="fa-solid fa-plus"></i>Thêm hợp đồng</button>
  `)}

  ${expiring.length ? `
  <div class="card" style="margin-bottom:14px;border-left:3px solid var(--orange)">
    <div class="card-head">
      <span class="mkpi-ico t-orange"><i class="fa-solid fa-bell"></i></span>
      <div><h3>Hợp đồng sắp hết hạn</h3><p>${expiring.length} hợp đồng hết hiệu lực trong 45 ngày tới — cần gia hạn hoặc thanh lý</p></div>
      <div class="right"><button class="btn btn-sm" data-act="filter-expiring">Xem danh sách</button></div>
    </div>
    <div class="card-body" style="display:flex;gap:9px;flex-wrap:wrap">
      ${expiring.map((c) => `<div class="alert-item" style="flex:1 1 260px" data-act="open-contract" data-id="${c.id}">
        <span class="alert-ico t-orange"><i class="fa-solid fa-file-contract"></i></span>
        <span style="min-width:0"><span class="alert-title">${c.id} · ${esc(Q.customerName(c.customerId))}</span>
        <div class="alert-sub">Hết hạn ${fmtDate(c.expireDate)} · còn ${daysTo(c.expireDate)} ngày · ${fmtVND(c.value)}</div></span>
        <i class="fa-solid fa-chevron-right"></i></div>`).join('')}
    </div>
  </div>` : ''}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng hợp đồng', DB.contracts.length, 'fa-file-contract', 'blue')}
    ${mkpi('Còn hiệu lực', DB.contracts.filter((c) => c.status === 'hd_hieu_luc').length, 'fa-circle-check', 'green')}
    ${mkpi('Sắp hết hạn', DB.contracts.filter((c) => c.status === 'hd_sap_het_han').length, 'fa-hourglass-half', 'orange')}
    ${mkpi('Chờ ký', DB.contracts.filter((c) => c.status === 'hd_cho_ky').length, 'fa-pen-nib', 'slate')}
    ${mkpi('Còn phải thu', fmtShort(DB.contracts.reduce((s, c) => s + c.remain, 0)), 'fa-money-bill-wave', 'red')}
  </div>

  <div class="card">
    <div class="toolbar">
      ${searchBox('contracts', 'Tìm mã hợp đồng, khách hàng…')}
      ${selectFilter('contracts', 'type', types, 'Tất cả loại hợp đồng')}
      ${selectFilter('contracts', 'status', statusOptions('hd_'), 'Tất cả trạng thái')}
      ${(f.q || f.type || f.status) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="contracts"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} hợp đồng</span>
    </div>
    ${tableShell(
      [{ t: 'Mã hợp đồng', w: '112px' }, { t: 'Khách hàng' }, { t: 'Loại hợp đồng', cls: 'hide-sm' }, { t: 'Ngày ký' }, { t: 'Ngày hết hạn' },
       { t: 'Giá trị', cls: 'right' }, { t: 'Còn phải thu', cls: 'right hide-sm' }, { t: 'Trạng thái', w: '124px' }, { t: 'Thao tác', cls: 'right', w: '86px' }],
      rows, { emptyTitle: 'Không tìm thấy hợp đồng' })}
    ${pagiHTML('contracts', pg, 'hợp đồng')}
  </div>`;
};

function openContractModal(id) {
  const c = Q.contract(id);
  if (!c) return;
  const cus = Q.customer(c.customerId);
  const pct = c.value ? Math.round((c.paid / c.value) * 100) : 0;
  Modal.open({
    title: `Hợp đồng ${c.id}`,
    sub: `${esc(c.type)} · ${esc(cus.name)}`,
    size: 'md',
    body: `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px">
        ${badge(c.status)}
        <span class="chip"><i class="fa-solid fa-calendar"></i> ${fmtDate(c.signDate)} → ${fmtDate(c.expireDate)}</span>
        ${daysTo(c.expireDate) >= 0 ? `<span class="chip"><i class="fa-solid fa-hourglass-half"></i> Còn ${daysTo(c.expireDate)} ngày</span>` : '<span class="chip" style="color:var(--red)"><i class="fa-solid fa-triangle-exclamation"></i> Đã hết hạn</span>'}
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-circle-info"></i>Thông tin hợp đồng</div>
      <div class="info-grid" style="margin-bottom:18px">
        ${infoItem('Khách hàng', esc(cus.name))}
        ${infoItem('Mã số thuế', esc(cus.tax))}
        ${infoItem('Người đại diện', esc(cus.contact))}
        ${infoItem('Phụ trách', esc(Q.employeeName(c.owner)))}
        ${infoItem('Phạm vi', esc(c.scope))}
        ${infoItem('Giá trị hợp đồng', `<span style="color:var(--primary)">${fmtVND(c.value)}</span>`)}
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-money-bill-transfer"></i>Tiến độ thanh toán</div>
      <div style="margin-bottom:10px">${progressBar(pct)}</div>
      <div class="stat-strip">
        <div><div class="l">Giá trị</div><div class="v">${fmtVND(c.value)}</div></div>
        <div><div class="l">Đã thanh toán</div><div class="v" style="color:var(--green)">${fmtVND(c.paid)}</div></div>
        <div><div class="l">Còn lại</div><div class="v" style="color:var(--orange)">${fmtVND(c.remain)}</div></div>
      </div>`,
    foot: `<button class="btn left" data-act="open-customer" data-id="${c.customerId}"><i class="fa-solid fa-address-book"></i>Hồ sơ khách hàng</button>
           <button class="btn" data-act="modal-close">Đóng</button>
           <button class="btn" data-act="export-contract" data-id="${c.id}"><i class="fa-solid fa-file-pdf"></i>Xuất PDF</button>
           ${c.remain > 0 ? `<button class="btn btn-primary" data-act="pay-contract" data-id="${c.id}"><i class="fa-solid fa-money-bill-transfer"></i>Ghi nhận thanh toán</button>` : ''}`,
  });
}
