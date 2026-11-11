// One status calculation for the quotation list and sidebar badge.
function purchaseQuoteProcessStatus(pr) {
  if ((DB.purchaseOrders || []).some(po => po.prId === pr.id && po.status !== 'CANCELLED')) return 'PO_CREATED';
  if ((DB.supplierQuotations || []).some(q => q.prId === pr.id && (q.confirmed || q.confirmedAt || q.status === 'CONFIRMED'))) return 'SUPPLIER_SELECTED';
  return 'WAITING_QUOTE';
}

/* ------------------------------------------------------------ MUA SẮM */


Views.purchases = function (params = {}) {
  // Chỉ vai trò có permission "Duyệt báo giá & mua hàng" mới thấy nút Duyệt/Từ chối.
  // Action bên app.js vẫn kiểm tra lại quyền để tránh gọi trực tiếp bằng console/UI cũ.
  const canApprovePurchase = Auth.canApprovePurchase();
  const currentTab = params.tab || State.tab || 'pr';
  const f = F('purchases', {
    q: '',
    status: '',
    supplier: '',
    tab: currentTab,
    prId: '',
    materialId: ''
  });

  f.tab = currentTab;
  State.tab = currentTab;

  const handledTabs = ['dashboard', 'pr', 'approval', 'quotes', 'po', 'debts', 'price_history', 'suppliers'];
  if (!handledTabs.includes(currentTab)) return '';

  if (State.params && State.params.filter === 'pending') {
    f.status = 'mh_cho_duyet';
    f.tab = 'pr';
    State.tab = 'pr';
    State.params.filter = null;
  }

  const q = (f.q || '').toLowerCase().trim();

  // [FILTER THỜI GIAN] Chỉ dùng để lọc dữ liệu hiển thị, không thay đổi chứng từ/nghiệp vụ.
  const inDateRange = (dateValue, fromValue, toValue) => {
    const d = String(dateValue || '').slice(0, 10);
    if (!d) return !(fromValue || toValue);
    if (fromValue && d < fromValue) return false;
    if (toValue && d > toValue) return false;
    return true;
  };
  const dateRangeInputs = (fromField, toField) => `
    <label style="display:flex;align-items:center;gap:5px"><span class="muted" style="font-size:11px;white-space:nowrap">Từ ngày</span><input class="inp" type="date" data-f="purchases.${fromField}" value="${esc(f[fromField] || '')}" style="width:140px" /></label>
    <label style="display:flex;align-items:center;gap:5px"><span class="muted" style="font-size:11px;white-space:nowrap">Đến ngày</span><input class="inp" type="date" data-f="purchases.${toField}" value="${esc(f[toField] || '')}" style="width:140px" /></label>`;


const purchaseTabCounts = {
  pr: DB.purchases.length,

  quotes:
    (DB.purchases || []).filter(p => PURCHASE_INVENTORY_CONFIG.prStatus.approved.includes(p.status) && purchaseQuoteProcessStatus(p)==='WAITING_QUOTE').length,

  po:
    DB.purchaseOrders.length,


  debts:
    DB.supplierPayments.length,

  price_history:
    DB.purchasePriceHistory.length,

  suppliers:
    DB.suppliers.length
};


const tabs =
  PURCHASE_INVENTORY_CONFIG.purchaseTabs.map(
    (tab) => ({
      ...tab,

      count:
        tab.id === 'dashboard'
          ? ''
          : purchaseTabCounts[tab.id] ?? ''
    })
  );

  /* -------------------------------------------------- TAB 1: PR (YÊU CẦU MUA) */
  const renderPrTab = () => {
    // [PR STATUS VIEW]
    // Chỉ chuẩn hóa cách HIỂN THỊ/LỌC trạng thái PR.
    // Không sửa giá trị status thật trên chứng từ và không thay đổi luồng nghiệp vụ.
    const prViewStatus = {
      pending: ['mh_cho_duyet', 'PENDING_APPROVAL'],
      approved: ['mh_da_duyet', 'APPROVED'],
      ordered: ['mh_da_dat_hang', 'CONVERTED_TO_PO'],
      shipping: ['mh_dang_giao'],
      received: ['mh_da_nhan'],
      completed: ['mh_hoan_thanh'],
      rejected: ['mh_tu_choi', 'REJECTED', 'CANCELLED'],
    };

    const matchPrViewStatus = (status, filter) => {
      if (!filter) return true;
      const map = {
        __PENDING__: prViewStatus.pending,
        __APPROVED__: prViewStatus.approved,
        __ORDERED__: prViewStatus.ordered,
        __SHIPPING__: prViewStatus.shipping,
        __RECEIVED__: prViewStatus.received,
        __COMPLETED__: prViewStatus.completed,
        __REJECTED__: prViewStatus.rejected,
      };
      return (map[filter] || [filter]).includes(status);
    };

    const list = DB.purchases.filter((p) => {
      if (!matchPrViewStatus(p.status, f.status)) return false;
      if (!inDateRange(p.date, f.prDateFrom, f.prDateTo)) return false;
        const itemSupplierIds = (p.items || []).flatMap((item) => item.supplierIds || (item.supplierId ? [item.supplierId] : []));
        if (f.supplier && p.supplierId !== f.supplier && !itemSupplierIds.includes(f.supplier)) return false;
        const supplierText = itemSupplierIds.map((supplierId) => Q.supplierName(supplierId)).join(' ');
        if (q && ![p.id, supplierText, Q.employeeName(p.requesterId), p.reason].some((v) => String(v).toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')));
    const pg = paged(list, 'purchases');
    const suppliers = DB.suppliers.map((s) => [s.id, s.name]);
    const cnt = (s) => DB.purchases.filter((p) => p.status === s).length;

    const rows = pg.items.map((p) => {
  // Dữ liệu cũ có thể còn status Đã đặt hàng dù toàn bộ PO của PR đã bị hủy.
  // Chỉ chuẩn hóa trạng thái HIỂN THỊ; không thay đổi luồng nghiệp vụ hay tự tạo/xóa chứng từ.
  const linkedPos = (DB.purchaseOrders || []).filter(po => po.prId === p.id);
  const allLinkedPosCancelled = linkedPos.length > 0 && linkedPos.every(po => po.status === 'CANCELLED');
  const effectivePrStatus = (['mh_da_dat_hang','CONVERTED_TO_PO'].includes(p.status) && allLinkedPosCancelled) ? 'CANCELLED' : p.status;
  const pView = effectivePrStatus === p.status ? p : { ...p, status: effectivePrStatus };
  const isApproved =
  PURCHASE_INVENTORY_CONFIG
    .prStatus
    .approved
    .includes(p.status);

  const isPending =
  PURCHASE_INVENTORY_CONFIG
    .prStatus
    .pending
    .includes(p.status);
  const canManagePr = typeof Auth === 'undefined' || Auth.hasPermission('PURCHASE_PR_CREATE');

  const pendingApprovalReq = (DB.approvalRequests || []).find(r => r.docType === 'PR' && r.docId === p.id && r.status === 'PENDING');
  const pendingApprovalLevel = pendingApprovalReq ? (pendingApprovalReq.levels || []).find(l => Number(l.level) === Number(pendingApprovalReq.currentLevel)) : null;

  /* Danh sách vật tư thuộc PR */
  const materialHtml = (p.items || []).length
    ? p.items.map((it) => `
        <div style="
          display:flex;
          align-items:center;
          gap:7px;
          margin-bottom:5px;
        ">
          <span class="code">${esc(it.materialId)}</span>

          <span style="flex:1">
            ${esc(it.name)}
          </span>

          <span class="num muted" style="white-space:nowrap">
            ${fmtDec(it.qty, 2)} ${esc(it.unit)}
          </span>
          ${Array.isArray(it.poHistory) && it.poHistory.length ? (() => {
            const event = it.poHistory[it.poHistory.length - 1];
            return `<span class="chip" title="${esc(event.note || '')}" style="font-size:10.5px"><i class="fa-solid fa-ban"></i>${esc(event.poId)} đã hủy${event.replacementPrId ? ` → ${esc(event.replacementPrId)}` : ''}</span>`;
          })() : ''}
        </div>
      `).join('')
    : `
      <span class="muted">
        Chưa có vật tư
      </span>
    `;

  return `
    <tr
      class="clickable"
      data-act="open-pr"
      data-id="${p.id}"
    >

      <td>
        <span class="code">${p.id}</span>

        <div class="cell-sub">
          ${esc(p.reason || '')}
        </div>
      </td>

      <td class="hide-sm">
        <div style="
          display:flex;
          align-items:center;
          gap:8px
        ">
          ${avatarHTML(Q.employeeName(p.requesterId))}

          <span>
            ${esc(Q.employeeName(p.requesterId))}
          </span>
        </div>
      </td>

      <!-- NGUYÊN LIỆU ĐỀ NGHỊ MUA -->
      <td>
        ${materialHtml}
      </td>

      <!-- NHÀ CUNG CẤP -->
      <td>
          ${(p.items || []).map((it) => `<div style="margin-bottom:5px"><span class="muted">${esc(it.name)}:</span> <span class="strong">${(it.supplierIds || (it.supplierId ? [it.supplierId] : [])).map((supplierId) => esc(Q.supplierName(supplierId))).join(', ') || 'Chưa chọn NCC'}</span></div>`).join('')}
      </td>

      <td class="right strong num">
        ${fmtVND(p.total)}
      </td>

      <td class="num">
        ${fmtDate(p.date)}
      </td>

      <td class="num hide-sm">
        ${fmtDate(p.expectedDate)}
      </td>

      <td>
        ${badge(pView.status)}
        ${pendingApprovalLevel ? `<div class="cell-sub" style="margin-top:4px;color:var(--orange);font-weight:700">Chờ cấp ${pendingApprovalLevel.level}: ${esc(approvalRoleName(pendingApprovalLevel.role))}</div>` : ''}
      </td>

      <td>
        ${rowActions([
          {
            act: 'open-pr',
            data: `data-id="${p.id}"`,
            icon: 'fa-eye',
            title: 'Xem chi tiết'
          },
          ...(canManagePr && isPending && !DB.supplierQuotations.some(q => q.prId === p.id && (q.confirmed || q.confirmedAt)) ? [{
            act: 'pr-edit',
            data: `data-id="${p.id}"`,
            icon: 'fa-pen-to-square',
            title: 'Sửa đề nghị mua hàng'
          }] : []),

          ...(isPending ? [
            ...(canApprovePurchase ? [{
              act: 'pr-approve-action',
              data: `data-id="${p.id}"`,
              icon: 'fa-check',
              title: 'Duyệt đề nghị mua hàng'
            }, {
              act: 'pr-reject-modal',
              data: `data-id="${p.id}"`,
              icon: 'fa-xmark',
              title: 'Từ chối đề nghị mua hàng'
            }] : []),
            ...(canManagePr ? [{
              act: 'pr-delete',
              data: `data-id="${p.id}"`,
              icon: 'fa-trash',
              title: 'Xóa PR chưa duyệt'
            }] : [])
          ] : []),
        ])}
      </td>

    </tr>
  `;
});

    return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><div><h3>Quy trình Đề nghị mua hàng</h3><p>Số yêu cầu đang xử lý theo từng giai đoạn</p></div></div>
      <div class="card-body">
        <div class="flow">
          ${PR_FLOW.map((s) => {
            const n = cnt(s.key);
            return `<div class="flow-step ${n ? 'doing' : 'pending'}" data-act="filter-pr" data-status="${s.key}" style="cursor:pointer">
              <div class="flow-ico"><i class="fa-solid ${s.icon}"></i></div>
              <div class="flow-name">${esc(s.name)}</div>
              <div class="flow-date">${n} yêu cầu</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng đề nghị', DB.purchases.length, 'fa-cart-shopping', 'blue', 'purchase-pr-dashboard-all')}
      ${mkpi('Chờ duyệt', DB.purchases.filter(p=>prViewStatus.pending.includes(p.status)).length, 'fa-hourglass-half', 'orange', 'purchase-pr-dashboard-pending')}
      ${mkpi('Đã duyệt', DB.purchases.filter(p=>prViewStatus.approved.includes(p.status)).length, 'fa-circle-check', 'green', 'purchase-pr-dashboard-approved')}
      ${mkpi('Từ chối / Hủy', DB.purchases.filter(p=>prViewStatus.rejected.includes(p.status)).length, 'fa-circle-xmark', 'red', 'purchase-pr-dashboard-rejected')}
      ${mkpi('Giá trị đề xuất', fmtShort(DB.purchases
  .filter((p) =>
    !PURCHASE_INVENTORY_CONFIG
      .prStatus
      .rejected
      .includes(p.status)).reduce((s, p) => s + Number(p.total || 0), 0)), 'fa-sack-dollar', 'indigo')}
    </div>

    <div class="card">
      <div class="toolbar">
        ${searchBox('purchases', 'Tìm mã đề nghị, nhà cung cấp, người yêu cầu…')}
        ${selectFilter('purchases', 'status', [
          ['__PENDING__', 'Chờ duyệt'],
          ['__APPROVED__', 'Đã duyệt'],
          ['__ORDERED__', 'Đã đặt hàng'],
          ['__SHIPPING__', 'Đang giao'],
          ['__RECEIVED__', 'Đã nhận'],
          ['__COMPLETED__', 'Hoàn thành'],
          ['__REJECTED__', 'Từ chối / Hủy'],
        ], 'Tất cả trạng thái')}
        ${selectFilter('purchases', 'supplier', suppliers, 'Tất cả nhà cung cấp')}
        ${dateRangeInputs('prDateFrom', 'prDateTo')}
        ${(f.q || f.status || f.supplier || f.prDateFrom || f.prDateTo) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="purchases"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
        <span class="spacer"></span>
        <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} yêu cầu</span>
        <button class="btn btn-primary" data-act="create-pr">
          <i class="fa-solid fa-plus"></i>
          Tạo đề nghị mua
        </button>
      </div>
      ${tableShell(
        [{ t: 'Mã đề nghị', w: '130px' }, { t: 'Người yêu cầu', cls: 'hide-sm' }, { t: 'Nguyên liệu' }, { t: 'Nhà cung cấp' }, { t: 'Giá trị', cls: 'right' },
         { t: 'Ngày yêu cầu' }, { t: 'Dự kiến về', cls: 'hide-sm' }, { t: 'Trạng thái', w: '128px' }, { t: 'Thao tác', cls: 'right', w: '130px' },],
        rows, { emptyTitle: 'Không tìm thấy đề nghị mua hàng' })}
      ${pagiHTML('purchases', pg, 'yêu cầu')}
    </div>`;
  };

  /* -------------------------------------------------- TAB 2: DUYỆT MUA HÀNG */
  const renderApprovalTab = () => {
    const pending = DB.purchases
      .filter((p) => PURCHASE_INVENTORY_CONFIG.prStatus.pending.includes(p.status))
      .sort((a, b) => b.id.localeCompare(a.id));
    const pendingValue = pending.reduce((sum, p) => sum + Number(p.total || 0), 0);
    const approved = DB.purchases.filter((p) => PURCHASE_INVENTORY_CONFIG.prStatus.approved.includes(p.status)).length;
    const rejected = DB.purchases.filter((p) => PURCHASE_INVENTORY_CONFIG.prStatus.rejected.includes(p.status)).length;
    const rows = pending.map((p) => `<tr class="clickable" data-act="open-pr" data-id="${p.id}">
      <td><span class="code">${p.id}</span><div class="cell-sub">${esc(p.reason || '')}</div></td>
      <td>${avatarHTML(Q.employeeName(p.requesterId))} ${esc(Q.employeeName(p.requesterId))}<div class="cell-sub">${esc(p.dept || 'Sản xuất')}</div></td>
      <td>${(p.items || []).map((item) => `<div>${esc(item.name)} <span class="muted">(${fmtDec(item.qty, 2)} ${esc(item.unit)})</span></div>`).join('')}</td>
      <td class="right strong num">${fmtVND(p.total)}</td>
      <td class="num">${fmtDate(p.expectedDate)}</td>
      <td>${badge(p.status)}</td>
      <td class="right">${rowActions([
        { act: 'open-pr', data: `data-id="${p.id}"`, icon: 'fa-eye', title: canApprovePurchase ? 'Xem và duyệt đề nghị' : 'Xem đề nghị' },
        ...(canApprovePurchase ? [
          { act: 'pr-approve-action', data: `data-id="${p.id}"`, icon: 'fa-check', title: 'Phê duyệt đề nghị' },
          { act: 'pr-reject-modal', data: `data-id="${p.id}"`, icon: 'fa-xmark', title: 'Từ chối đề nghị' },
        ] : []),
      ])}</td>
    </tr>`);
    // PO không áp dụng bước duyệt riêng; PR là điểm kiểm soát phê duyệt.


    return `<div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Chờ duyệt', pending.length, 'fa-hourglass-half', 'orange')}
      ${mkpi('Giá trị chờ duyệt', fmtShort(pendingValue), 'fa-sack-dollar', 'blue')}
      ${mkpi('Đã phê duyệt', approved, 'fa-circle-check', 'green')}
      ${mkpi('Đã từ chối', rejected, 'fa-circle-xmark', 'red')}
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Danh sách duyệt mua hàng</h3><p>Kiểm tra nhu cầu, ngân sách và vật tư trước khi chuyển sang bước báo giá nhà cung cấp.</p></div><span class="chip"><i class="fa-solid fa-list-check"></i> ${pending.length} đề nghị chờ xử lý</span></div>
      ${tableShell([
        { t: 'Mã đề nghị', w: '140px' }, { t: 'Người đề nghị' }, { t: 'Vật tư' }, { t: 'Giá trị', cls: 'right' },
        { t: 'Ngày cần hàng' }, { t: 'Trạng thái' }, { t: 'Thao tác', cls: 'right', w: '150px' },
      ], rows, { emptyTitle: 'Không có đề nghị mua hàng chờ duyệt' })}
    </div>
    </div>`;
  };

  /* -------------------------------------------------- TAB 3: BÁO GIÁ NCC */
  const renderQuotesTab = () => {
    const approvedStatuses = PURCHASE_INVENTORY_CONFIG.prStatus.approved;
    const quoteStatus = f.quoteStatus === 'QUOTING' ? 'WAITING_QUOTE' : (f.quoteStatus || '');
    const quoteSupplier = f.quoteSupplier || '';

    // Trạng thái tại màn Báo giá phải phản ánh đúng tiến độ báo giá,
    // không dùng trực tiếp status của PR/PO vì sẽ sinh các nhãn trùng nghĩa
    // như "Đã duyệt / Đã phê duyệt / Đã duyệt PO".
    const quoteProcessStatus = purchaseQuoteProcessStatus;
    if (f.quoteStatus === 'QUOTING') f.quoteStatus = 'WAITING_QUOTE';
    const quoteProcessBadge = (status) => ({
      WAITING_QUOTE: '<span class="badge slate">Chờ báo giá</span>',
      SUPPLIER_SELECTED: '<span class="badge blue">Đã chọn NCC</span>',
      PO_CREATED: '<span class="badge green">Đã tạo PO</span>',
    }[status] || '<span class="badge slate">Chờ báo giá</span>');

    const approvedPrs = DB.purchases.filter((p) => {
      if (!approvedStatuses.includes(p.status)) return false;
      if (!inDateRange(p.date, f.quoteDateFrom, f.quoteDateTo)) return false;
      if (quoteStatus && quoteProcessStatus(p) !== quoteStatus) return false;
      const supplierIds = (p.items || []).flatMap((item) => item.supplierIds || (item.supplierId ? [item.supplierId] : []));
      return !quoteSupplier || supplierIds.includes(quoteSupplier);
    }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

    const quotePage = paged(approvedPrs, 'purchaseQuotePrs', 5);
    const quoteStatuses = [
      ['WAITING_QUOTE', 'Chờ báo giá'],
      ['SUPPLIER_SELECTED', 'Đã chọn nhà cung cấp'],
      ['PO_CREATED', 'Đã tạo đơn đặt hàng'],
    ];
    const quoteSuppliers = DB.suppliers.map((supplier) => [supplier.id, supplier.name]);

    const renderInlineQuote = (pr) => {
      const prQuotes = DB.supplierQuotations.filter((quote) => quote.prId === pr.id);
      const quotationLocked = prQuotes.some((quote) => quote.confirmed || quote.confirmedAt);

      const itemRows = (pr.items || []).map((item) => {
        const existingSupplierIds = prQuotes
          .flatMap((quote) => (quote.items || [])
            .filter((quoteItem) => quoteItem.materialId === item.materialId)
            .map(() => quote.supplierId));
        const supplierIds = [...new Set([...(item.supplierIds || (item.supplierId ? [item.supplierId] : [])), ...existingSupplierIds])];
        const savedItems = prQuotes.flatMap((quote) => (quote.items || []).map((quoteItem) => ({
          ...quoteItem,
          supplierId: quoteItem.supplierId || quote.supplierId,
          quoteSelected: quote.selected,
        })));
        const enteredPrices = supplierIds.map((supplierId) => ({
          supplierId,
          price: Number(savedItems.find((savedItem) => savedItem.materialId === item.materialId && savedItem.supplierId === supplierId)?.price || 0),
        })).filter((entry) => entry.price > 0);
        const lowestPrice = enteredPrices.length ? Math.min(...enteredPrices.map((entry) => entry.price)) : 0;
        const selectedSupplierId = savedItems.find((savedItem) => savedItem.materialId === item.materialId && savedItem.selected)?.supplierId
          || savedItems.find((savedItem) => savedItem.materialId === item.materialId && savedItem.quoteSelected)?.supplierId
          || '';

        return `<tr>
          <td><div class="strong">${esc(item.name)}</div><div class="cell-sub">${esc(item.materialId)}</div></td>
          <td class="right num">${fmtN(item.qty)} ${esc(item.unit)}</td>
          <td class="right strong num">${fmtVND(item.expectedPrice || item.price || 0)}</td>
          <td>${supplierIds.length ? supplierIds.map((supplierId) => {
            const oldItem = savedItems.find((quoteItem) => quoteItem.materialId === item.materialId && quoteItem.supplierId === supplierId);
            const price = Number(oldItem?.price || 0);
            const isLowest = price > 0 && price === lowestPrice;
            const isSelected = selectedSupplierId === supplierId;
            return `<div class="quote-supplier-line" style="display:grid;grid-template-columns:minmax(220px,1fr) 150px auto;align-items:center;gap:10px;padding:9px 11px;margin:5px 0;border:1px solid ${quotationLocked || isLowest ? 'var(--green)' : 'var(--border)'};border-radius:var(--r);background:${quotationLocked || isLowest ? 'var(--green-soft)' : 'var(--surface)'}">
              <label style="display:flex;align-items:center;gap:7px;min-width:0"><input type="radio" class="quote-supplier-choice" name="quoteSupplier_${pr.id}_${item.materialId}" data-pr-id="${pr.id}" data-material-id="${item.materialId}" data-supplier-id="${supplierId}" ${isSelected ? 'checked' : ''} ${quotationLocked ? 'disabled' : ''}/><span class="strong">${esc(Q.supplierName(supplierId))}</span></label>
              <input class="inp right num quote-supplier-price" data-money="1" data-pr-id="${pr.id}" data-material-id="${item.materialId}" data-supplier-id="${supplierId}" type="text" inputmode="numeric" min="1" value="${price ? fmtMoneyInput(price) : ''}" placeholder="Nhập giá" ${quotationLocked ? 'disabled' : ''} style="width:150px;${quotationLocked || isLowest ? 'border-color:var(--green);font-weight:700;' : ''}" />
              ${quotationLocked ? '<span class="badge green"><i class="fa-solid fa-lock"></i> Đã xác nhận</span>' : (isLowest ? '<span class="badge green"><i class="fa-solid fa-arrow-down"></i> Giá tốt nhất</span>' : '<span></span>')}
            </div>`;
          }).join('') : '<span class="muted">Chưa có NCC được chọn trong đề nghị</span>'}</td>
        </tr>`;
      });

      return `<div style="padding:4px 2px 8px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:4px 0 10px">
          <div><div class="strong" style="font-size:13.5px">Báo giá cho ${esc(pr.id)}</div><div class="muted">Nhập giá và chọn nhà cung cấp theo từng nguyên liệu ngay tại đây.</div></div>
          ${quotationLocked ? '<span class="chip"><i class="fa-solid fa-lock"></i> Chỉ xem</span>' : `<button class="btn btn-sm btn-primary" data-act="quote-confirm-pr" data-id="${pr.id}"><i class="fa-solid fa-check"></i>Xác nhận chọn NCC</button>`}
        </div>
        ${tableShell([{ t: 'Nguyên liệu' }, { t: 'Số lượng', cls: 'right' }, { t: 'Giá dự kiến', cls: 'right' }, { t: 'Nhà cung cấp và giá báo' }], itemRows, { emptyTitle: 'Đề nghị chưa có nguyên liệu' })}
      </div>`;
    };

    const prRows = quotePage.items.map((p) => {
      const supplierIds = [...new Set((p.items || []).flatMap((item) => item.supplierIds || (item.supplierId ? [item.supplierId] : [])))];
      const expanded = f.prId === p.id;
      return `<tr class="clickable quote-parent-row ${expanded ? 'quote-parent-selected' : ''}" data-act="quote-select-pr" data-id="${p.id}">
        <td><span class="code">${p.id}</span><div class="cell-sub">${esc(p.reason || '')}</div></td>
        <td>${(p.items || []).length} sản phẩm</td>
        <td>${supplierIds.map((id) => `<span class="chip" style="margin:2px">${esc(Q.supplierName(id))}</span>`).join('') || '<span class="muted">Chưa có NCC</span>'}</td>
        <td class="right strong num">${fmtVND(p.total)}</td>
        <td class="num">${fmtDate(p.date)}</td>
        <td style="white-space:nowrap">${quoteProcessBadge(quoteProcessStatus(p))} <i class="fa-solid fa-chevron-${expanded ? 'up' : 'down'} muted" style="margin-left:6px"></i></td>
      </tr>
      ${expanded ? `<tr class="quote-inline-detail"><td colspan="6" style="padding:0 14px 14px 28px;background:var(--surface-2);border-top:0"><div class="quote-child-panel">${renderInlineQuote(p)}</div></td></tr>` : ''}`;
    });

    return `<div class="card">
      <div class="card-head"><div><h3>Báo giá nhà cung cấp theo đề nghị mua</h3><p>Click vào từng đề nghị để mở báo giá ngay bên dưới dòng đó. Click lại để thu gọn.</p></div><span class="chip"><i class="fa-solid fa-list"></i> ${approvedPrs.length} đề nghị</span></div>
      <div class="toolbar">
        ${selectFilter('purchases', 'quoteStatus', quoteStatuses, 'Tất cả trạng thái báo giá')}
        ${selectFilter('purchases', 'quoteSupplier', quoteSuppliers, 'Tất cả nhà cung cấp')}
        ${dateRangeInputs('quoteDateFrom', 'quoteDateTo')}
        ${(quoteStatus || quoteSupplier || f.quoteDateFrom || f.quoteDateTo) ? '<button class="btn btn-sm" data-act="clear-quote-filters"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      </div>
      ${tableShell([{ t: 'Mã đề nghị', w: '150px' }, { t: 'Sản phẩm' }, { t: 'Nhà cung cấp đã chọn' }, { t: 'Giá trị dự kiến', cls: 'right' }, { t: 'Ngày tạo' }, { t: 'Trạng thái' }], prRows, { emptyTitle: 'Chưa có đề nghị mua hàng đã duyệt' })}
      ${pagiHTML('purchaseQuotePrs', quotePage, 'đề nghị')}
    </div>`;
  };

  /* -------------------------------------------------- TAB 3: PO (ĐƠN ĐẶT HÀNG) */
  const renderPoTab = () => {
    // Quy trình mới: PR đã được duyệt trước khi báo giá, vì vậy PO không duyệt lại.
    // Chuyển các PO cũ còn Chờ duyệt/Đã duyệt sang Chờ gửi NCC để tiếp tục luồng mới.
    let normalizedOldPo = false;
    (DB.purchaseOrders || []).forEach((po) => {
      if (['PENDING_APPROVAL','APPROVED'].includes(po.status)) {
        po.status = 'READY_TO_SEND';
        normalizedOldPo = true;
      }
    });
    if (normalizedOldPo && typeof PurchaseAPI !== 'undefined' && PurchaseAPI.scheduleCollections) {
      PurchaseAPI.scheduleCollections(['purchaseOrders']);
    }
    // [REAL SERVER] Chỉ render dữ liệu PO đã tồn tại trên server.
    // Không tự tạo/khôi phục PO từ báo giá khi mở màn hình; đặc biệt PO đã hủy
    // phải giữ nguyên Đã hủy và không được sinh một PO mới ngoài ý muốn.

    const list = DB.purchaseOrders.filter((po) => {
      const returnedQty = (DB.goodsIssues || [])
        .filter(x => x.type === 'RETURN_OUT' && (x.refDoc === po.id || x.poId === po.id))
        .reduce((sum, issue) => sum + (issue.items || []).reduce((n, item) => n + Number(item.qty || 0), 0), 0);
      if (f.status === '__PO_WAITING__' && !['DRAFT','READY_TO_SEND','SENT_TO_SUPPLIER'].includes(po.status)) return false;
      else if (f.status === '__PO_INBOUND__' && !['SHIPPING','PARTIAL_RECEIVED'].includes(po.status)) return false;
      else if (f.status === '__RECEIVED_RETURNED__' && !(po.status === 'RECEIVED' && returnedQty > 0)) return false;
      else if (f.status && !['__PO_WAITING__','__PO_INBOUND__','__RECEIVED_RETURNED__'].includes(f.status) && po.status !== f.status) return false;
      if (f.supplier && po.supplierId !== f.supplier) return false;
      if (!inDateRange(po.date, f.poDateFrom, f.poDateTo)) return false;
      if (q && ![po.id, po.prId, Q.supplierName(po.supplierId), po.note].some((v) => String(v).toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')));
    const pg = paged(list, 'purchases');
    const suppliers = DB.suppliers.map((s) => [s.id, s.name]);

    const poReturnQty = (po) => {
      const issuedQty = (DB.goodsIssues || [])
        .filter(x => x.type === 'RETURN_OUT' && (x.refDoc === po.id || x.poId === po.id))
        .reduce((sum, issue) => sum + (issue.items || []).reduce((n, item) => n + Number(item.qty || 0), 0), 0);
      // returnedQty được ghi ngay trên PO và persist vào lenam_purchase_orders khi Kho
      // xác nhận xuất trả. Nhờ vậy Mua hàng/F5 không phụ thuộc việc đã mở Tồn kho
      // để hydrate goodsIssues trước đó.
      return Math.max(Number(po.returnedQty || 0), issuedQty);
    };
    const poReceivedQty = (po) => (po.items || []).reduce((sum, item) => sum + Number(item.receivedQty || 0), 0);
    const poStatusHtml = (po) => {
      const returned = poReturnQty(po);
      const received = poReceivedQty(po);
      if (po.status === 'RECEIVED' && returned > 0 && returned < Math.max(received, 0.000001)) {
        return '<span class="badge orange">Đã nhận đủ, trả hàng 1 phần</span>';
      }
      return badge(po.status);
    };

    const rows = pg.items.map((po) => `
      <tr class="clickable" data-act="open-po" data-id="${po.id}">
        <td><span class="code">${po.id}</span><div class="cell-sub">từ ${po.prId}</div></td>
        <td>${cell2(esc(Q.supplierName(po.supplierId)), esc((po.items || []).map((i) => i.name || i.materialId || '').filter(Boolean).join(', ')))}</td>
        <td class="num">${fmtDate(po.date)}</td>
        <td class="num hide-sm">${fmtDate(po.expectedDate)}</td>
        <td class="right strong num">${fmtVND(Number(po.total || 0))}</td>
        <td class="right num hide-sm" style="color:var(--green)">${fmtVND(Number(po.paid || 0))}</td>
        <td>${poStatusHtml(po)}</td>
        <td>${rowActions([
          { act: 'open-po', data: `data-id="${po.id}"`, icon: 'fa-eye', title: 'Xem chi tiết PO' },
          ...(['DRAFT', 'READY_TO_SEND'].includes(po.status) && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_PO_CREATE') ? [{ act: 'po-edit', data: `data-id="${po.id}"`, icon: 'fa-pen-to-square', title: 'Sửa và chuyển lại thành đề nghị mua' }] : []),
          ...(po.status === 'READY_TO_SEND' && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_PO_SEND') ? [{ act: 'po-change-status', data: `data-id="${po.id}" data-status="SENT_TO_SUPPLIER"`, icon: 'fa-paper-plane', title: 'Gửi cho Nhà cung cấp' }] : []),
          ...(po.status === 'SENT_TO_SUPPLIER' && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_PO_SEND') ? [{ act: 'po-change-status', data: `data-id="${po.id}" data-status="SHIPPING"`, icon: 'fa-truck-fast', title: 'Xác nhận NCC đang giao hàng' }] : []),
          ...(po.status === 'RECEIVED' && !(DB.supplierEvaluationHistory || []).some(e => e.poId === po.id) && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_SUPPLIER_MANAGE') ? [{ act: 'po-evaluate-supplier', data: `data-id="${po.id}"`, icon: 'fa-star', title: 'Đánh giá nhà cung cấp' }] : []),
          ...((DB.goodsIssues || []).some(x => x.type === 'RETURN_OUT' && (x.refDoc === po.id || x.poId === po.id)) && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_PR_CREATE') ? [{ act: 'po-create-return-pr', data: `data-id="${po.id}"`, icon: 'fa-cart-plus', title: 'Gửi đề nghị mua thêm cho hàng đã trả' }] : []),
          ...(!['RECEIVED', 'PARTIAL_RECEIVED', 'CANCELLED', 'SHIPPING'].includes(po.status) && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_PO_CREATE') ? [{ act: 'po-cancel', data: `data-id="${po.id}"`, icon: 'fa-ban', title: 'Hủy đơn đặt hàng' }] : []),
        ])}</td>
      </tr>`);

    // [DASHBOARD CONSISTENCY] KPI PO lấy đúng collection đang render bảng.
    // Dùng Number(...) để dữ liệu từ KIO dạng chuỗi không làm sai phép cộng.
    const poSource = DB.purchaseOrders || [];
    const poActive = poSource.filter(p => p.status !== 'CANCELLED');
    const poTotalValue = poActive.reduce((s,p)=>s+Number(p.total||0),0);
    const poOutstanding = poActive.reduce((s,p)=>s+Math.max(0,Number(p.total||0)-Number(p.paid||0)),0);

    return `
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng đơn đặt hàng', poSource.length, 'fa-file-invoice-dollar', 'blue', 'purchase-po-dashboard-all')}
      ${mkpi('Chờ / đã gửi NCC', poSource.filter((p) => ['DRAFT','READY_TO_SEND','SENT_TO_SUPPLIER'].includes(p.status)).length, 'fa-paper-plane', 'slate', 'purchase-po-dashboard-waiting')}
      ${mkpi('Đang giao / nhận một phần', poSource.filter((p) => ['SHIPPING','PARTIAL_RECEIVED'].includes(p.status)).length, 'fa-truck-fast', 'orange', 'purchase-po-dashboard-inbound')}
      ${mkpi('Đã nhận đủ', poSource.filter((p) => p.status === 'RECEIVED').length, 'fa-circle-check', 'green', 'purchase-po-dashboard-received')}
      ${mkpi('Giá trị PO hiệu lực', fmtShort(poTotalValue), 'fa-sack-dollar', 'indigo')}
      ${mkpi('Công nợ PO', fmtShort(poOutstanding), 'fa-file-invoice-dollar', 'red')}
    </div>

    <div class="card">
      <div class="toolbar">
        ${searchBox('purchases', 'Tìm mã đơn hàng, mã đề nghị, nhà cung cấp…')}
        ${selectFilter('purchases', 'status', [['DRAFT','Nháp'],['READY_TO_SEND','Chờ gửi NCC'],['SENT_TO_SUPPLIER','Đã gửi NCC'],['SHIPPING','Đang giao hàng'],['PARTIAL_RECEIVED','Nhận hàng một phần'],['RECEIVED','Đã nhận đủ'],['CANCELLED','Đã hủy']], 'Tất cả trạng thái đơn hàng')}
        ${selectFilter('purchases', 'supplier', suppliers, 'Tất cả nhà cung cấp')}
        ${dateRangeInputs('poDateFrom', 'poDateTo')}
        ${(f.q || f.status || f.supplier || f.poDateFrom || f.poDateTo) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="purchases"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
        <span class="spacer"></span>
        <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} đơn PO</span>
      </div>
      ${tableShell(
        [{ t: 'Mã đơn hàng', w: '130px' }, { t: 'Nhà cung cấp' }, { t: 'Ngày đặt' }, { t: 'Giao dự kiến', cls: 'hide-sm' },
         { t: 'Tổng giá trị đơn hàng', cls: 'right' }, { t: 'Đã thanh toán', cls: 'right hide-sm' }, { t: 'Trạng thái đơn hàng', w: '140px' }, { t: 'Thao tác', cls: 'right', w: '120px' }],
        rows, { emptyTitle: 'Chưa có đơn đặt hàng nào' })}
      ${pagiHTML('purchases', pg, 'đơn hàng')}
    </div>`;
  };

  /* -------------------------------------------------- TAB 4: NHẬP KHO (GOODS RECEIPTS) */
  const renderReceiptsTab = () => {
    const list = [...DB.goodsReceipts].sort((a, b) => b.date.localeCompare(a.date));
    const rows = list.map((g) => `
      <tr>
        <td><span class="code">${g.id}</span></td>
        <td><span class="code" style="color:var(--primary)">${g.poId}</span></td>
        <td class="num">${fmtDate(g.date)}</td>
        <td>${esc(Q.employeeName(g.receivedBy))}</td>
        <td><span class="chip">${esc(g.warehouse)}</span></td>
        <td>${esc(g.items.map((i) => `${i.name} (+${fmtN(i.qty)} ${i.unit})`).join(', '))}</td>
        <td>${badge(g.status)}</td>
        <td class="muted">${esc(g.note)}</td>
      </tr>`);

    return `
    <div class="card">
      <div class="toolbar">
        ${searchBox('purchases', 'Tìm phiếu nhập, mã PO, người nhận…')}
        <span class="spacer"></span>
        <span class="chip"><i class="fa-solid fa-warehouse"></i> ${list.length} lượt nhập kho</span>
      </div>
      ${tableShell(
        [{ t: 'Số phiếu nhập', w: '130px' }, { t: 'Mã PO', w: '120px' }, { t: 'Ngày nhận' }, { t: 'Người nhận' },
         { t: 'Kho nhận' }, { t: 'Vật tư nhận' }, { t: 'Trạng thái' }, { t: 'Ghi chú' }],
        rows, { emptyTitle: 'Chưa có lượt nhập kho nào' })}
    </div>`;
  };

  /* -------------------------------------------------- TAB 5: CÔNG NỢ NCC */
  const renderDebtsTab = () => {
    const debtQ = String(f.debtQ || '').trim().toLowerCase();
    const debtSupplier = String(f.debtSupplier || '');
    const debtStatus = String(f.debtStatus || '');
    const suppliers = (DB.suppliers || []).map(s => [s.id, s.name]);
    const debtStatuses = [['UNPAID','Chưa thanh toán'],['PARTIALLY_PAID','Thanh toán một phần'],['PAID','Đã thanh toán'],['REFUND_DUE','NCC phải hoàn lại']];

    const pos = (DB.purchaseOrders || []).filter((po) => {
      if (po.status === 'CANCELLED') return false;
      if (!inDateRange(po.date, f.debtDateFrom, f.debtDateTo)) return false;
      if (debtSupplier && po.supplierId !== debtSupplier) return false;
      const paid = purchasePaidAmount(po), remain = purchasePayableRemaining(po), refund = purchaseSupplierRefundDue(po);
      const payStatus = refund > 0 ? 'REFUND_DUE' : remain <= 0 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
      if (debtStatus && payStatus !== debtStatus) return false;
      if (debtQ && ![po.id, po.prId, Q.supplierName(po.supplierId), po.note].some(v => String(v || '').toLowerCase().includes(debtQ))) return false;
      return true;
    }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')));

    const totalPoVal = pos.reduce((s, p) => s + Number(p.total || 0), 0);
    const totalPaidVal = pos.reduce((s, p) => s + purchasePaidAmount(p), 0);
    const remainingDebt = pos.reduce((s,p)=>s+purchasePayableRemaining(p),0);
    const supplierRefundTotal = pos.reduce((s,p)=>s+purchaseSupplierRefundDue(p),0);

    const rows = pos.map((p) => {
      const paid = purchasePaidAmount(p), remain = purchasePayableRemaining(p), refund = purchaseSupplierRefundDue(p);
      const payStatus = refund > 0 ? 'REFUND_DUE' : remain <= 0 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
      const statusHtml = refund > 0 ? '<span class="badge orange">NCC phải hoàn lại</span>' : badge(payStatus);
      return `<tr>
        <td><span class="code">${p.id}</span></td>
        <td><div class="strong">${esc(Q.supplierName(p.supplierId))}</div></td>
        <td class="num hide-sm">${fmtDate(p.date)}</td>
        <td class="right num strong">${fmtVND(p.total)}</td>
        <td class="right num" style="color:var(--green)">${fmtVND(paid)}</td>
        <td class="right num strong" style="color:${remain > 0 ? 'var(--red)' : 'var(--text-3)'}">${fmtVND(remain)}</td>
        <td class="right num strong" style="color:${refund > 0 ? 'var(--orange)' : 'var(--text-3)'}">${fmtVND(refund)}</td>
        <td>${statusHtml}</td>
        <td class="right">${remain > 0 ? `<button class="btn btn-xs btn-primary" data-act="supplier-pay-modal" data-id="${p.id}"><i class="fa-solid fa-hand-holding-dollar"></i>Thanh toán</button>` : (refund>0?`<button class="btn btn-xs btn-primary" data-act="supplier-refund-modal" data-id="${p.id}"><i class="fa-solid fa-rotate-left"></i>Ghi nhận hoàn tiền</button>`:'<span class="muted">Tất toán</span>')}</td>
      </tr>`;
    });

    const paymentList = (DB.supplierPayments || []).filter(p => {
      if (!inDateRange(p.date, f.debtDateFrom, f.debtDateTo)) return false;
      if (debtSupplier && p.supplierId !== debtSupplier) return false;
      if (debtQ && ![p.id, p.poId, Q.supplierName(p.supplierId), p.payerName, p.bankName, p.reference, p.bankRef].some(v => String(v || '').toLowerCase().includes(debtQ))) return false;
      return true;
    }).sort((a,b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')));

    const paymentRows = paymentList.slice(0,100).map(p => `<tr>
      <td><span class="code">${esc(p.id)}</span></td>
      <td class="num">${fmtDate(p.date)}</td>
      <td><span class="code">${esc(p.poId || '—')}</span></td>
      <td>${esc(Q.supplierName(p.supplierId))}</td>
      <td class="right strong num">${fmtVND(Number(p.amount || 0))}</td>
      <td>${esc(p.method || '—')}</td>
      <td>${esc(p.bankName || '—')}</td>
      <td>${esc(p.payerName || p.paidByName || '—')}</td>
      <td class="muted">${esc(p.reference || p.bankRef || '')}</td>
    </tr>`);

    const refundList=(DB.supplierRefunds||[]).filter(r=>{ if(!inDateRange(r.date,f.debtDateFrom,f.debtDateTo))return false; if(debtSupplier&&r.supplierId!==debtSupplier)return false; if(debtQ&&![r.id,r.poId,Q.supplierName(r.supplierId),r.receivedByName,r.bankName,r.reference].some(v=>String(v||'').toLowerCase().includes(debtQ)))return false; return true; }).sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||'')));
    const refundRows=refundList.slice(0,100).map(r=>`<tr><td><span class="code">${esc(r.id)}</span></td><td>${fmtDate(r.date)}</td><td><span class="code">${esc(r.poId||'—')}</span></td><td>${esc(Q.supplierName(r.supplierId))}</td><td class="right strong num" style="color:var(--green)">${fmtVND(r.amount)}</td><td>${esc(r.method==='BANK_TRANSFER'?'Chuyển khoản ngân hàng':r.method==='CASH'?'Tiền mặt':r.method||'—')}</td><td>${esc(r.bankName||'—')}</td><td>${esc(r.receivedByName||r.createdByName||'—')}</td><td>${esc(r.reference||'')}</td></tr>`);

    const hasDebtFilter = debtQ || debtSupplier || debtStatus || f.debtDateFrom || f.debtDateTo;
    return `
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng giá trị mua PO', fmtShort(totalPoVal), 'fa-sack-dollar', 'blue')}
      ${mkpi('Đã thanh toán', fmtShort(totalPaidVal), 'fa-circle-check', 'green')}
      ${mkpi('Công nợ còn lại', fmtShort(remainingDebt), 'fa-file-invoice-dollar', 'red')}
      ${mkpi('NCC phải hoàn lại', fmtShort(supplierRefundTotal), 'fa-rotate-left', 'orange')}
      ${mkpi('Số đợt thanh toán', paymentList.length, 'fa-receipt', 'indigo')}
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><div><h3>Sổ theo dõi công nợ nhà cung cấp theo PO</h3><p>Mặc định hiển thị PO mới nhất trước. Công nợ phải trả được tính sau khi trừ giá trị hàng trả; nếu đã trả dư, hệ thống chuyển phần chênh lệch thành NCC phải hoàn lại.</p></div></div>
      <div class="toolbar">
        <div class="search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" data-f="purchases.debtQ" value="${esc(f.debtQ || '')}" placeholder="Tìm mã PO, PR, nhà cung cấp…" /></div>
        ${selectFilter('purchases','debtSupplier',suppliers,'Tất cả nhà cung cấp')}
        ${selectFilter('purchases','debtStatus',debtStatuses,'Tất cả trạng thái công nợ')}
        ${dateRangeInputs('debtDateFrom', 'debtDateTo')}
        ${hasDebtFilter ? '<button class="btn btn-sm" data-act="purchase-clear-debt-filters"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
        <span class="spacer"></span><span class="chip">${fmtN(pos.length)} PO</span>
      </div>
      ${tableShell(
        [{ t: 'Mã PO', w: '120px' }, { t: 'Nhà cung cấp' }, { t: 'Ngày PO', cls: 'hide-sm' },
         { t: 'Tổng PO', cls: 'right' }, { t: 'Đã thanh toán', cls: 'right' }, { t: 'Còn phải trả', cls: 'right' }, { t: 'NCC phải hoàn lại', cls: 'right' }, { t: 'Trạng thái', w: '150px' }, { t: 'Thao tác', cls: 'right' }],
        rows, { emptyTitle: 'Không có dữ liệu công nợ phù hợp' })}
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><div><h3>Lịch sử thanh toán nhà cung cấp</h3><p>Mới nhất hiển thị trước; mỗi lần thanh toán được lưu thành một giao dịch riêng.</p></div><span class="chip">${fmtN(paymentList.length)} giao dịch</span></div>
      ${tableShell([{t:'Mã chi'},{t:'Ngày'},{t:'Mã PO'},{t:'Nhà cung cấp'},{t:'Số tiền',cls:'right'},{t:'Phương thức'},{t:'Ngân hàng'},{t:'Người thực hiện'},{t:'Tham chiếu'}], paymentRows, {emptyTitle:'Chưa có lịch sử thanh toán phù hợp'})}
    </div><div class="card"><div class="card-head"><div><h3>Lịch sử NCC hoàn tiền</h3><p>Các khoản doanh nghiệp nhận lại từ NCC sau khi trả hàng hoặc thanh toán dư.</p></div><span class="chip">${fmtN(refundList.length)} giao dịch</span></div>${tableShell([{t:'Mã nhận hoàn'},{t:'Ngày'},{t:'Mã PO'},{t:'Nhà cung cấp'},{t:'Số tiền',cls:'right'},{t:'Phương thức'},{t:'Ngân hàng nhận'},{t:'Người ghi nhận'},{t:'Tham chiếu'}],refundRows,{emptyTitle:'Chưa có lịch sử NCC hoàn tiền'})}</div>`;
  };

  /* -------------------------------------------------- TAB 6: LỊCH SỬ GIÁ MUA */
  const renderPriceHistoryTab = () => {
    const list = [...DB.purchasePriceHistory].filter((x) => inDateRange(x.date, f.priceDateFrom, f.priceDateTo)).sort((a, b) => b.date.localeCompare(a.date));
    const matList = DB.materials.map((m) => [m.id, m.name]);
    const selMatId = f.materialId || '';
    const filtered = selMatId ? list.filter((x) => x.materialId === selMatId) : list;
    const totalAmount = filtered.reduce((sum, x) => sum + Number(x.amount || (Number(x.qty || 0) * Number(x.price || 0))), 0);
    const totalQty = filtered.reduce((sum, x) => sum + Number(x.qty || 0), 0);
    const avgPrice = totalQty > 0 ? totalAmount / totalQty : 0;
    const supplierCount = new Set(filtered.map((x) => x.supplierId).filter(Boolean)).size;
    const materialCount = new Set(filtered.map((x) => x.materialId).filter(Boolean)).size;

    // Cảnh báo tăng giá > 10%
    let alertHtml = '';
    if (selMatId && filtered.length >= 2) {
      const newest = filtered[0];
      const prev = filtered[1];
      const pct = prev.price ? Math.round(((newest.price - prev.price) / prev.price) * 1000) / 10 : 0;
      if (pct > 10) {
        alertHtml = `
        <div class="alert-item" style="border-color:var(--red);background:var(--red-soft);margin-bottom:14px">
          <span class="alert-ico t-red"><i class="fa-solid fa-arrow-trend-up"></i></span>
          <span style="min-width:0">
            <span class="alert-title" style="color:var(--red)">CẢNH BÁO TĂNG GIÁ MUA VƯỢT NGƯỠNG 10%</span>
            <div class="alert-sub">Sản phẩm <b>${esc(Q.material(selMatId)?.name)}</b> tăng <b>+${pct}%</b> (từ ${fmtVND(prev.price)} lên ${fmtVND(newest.price)}) vào ngày ${fmtDate(newest.date)}</div>
          </span>
        </div>`;
      }
    }

    const rows = filtered.map((x) => `
      <tr>
        <td><span class="code">${x.materialId}</span></td>
        <td><div class="strong">${esc(Q.material(x.materialId)?.name)}</div></td>
        <td>${esc(Q.supplierName(x.supplierId))}</td>
        <td><span class="code" style="color:var(--primary)">${x.poId}</span></td>
        <td class="num">${fmtDate(x.date)}</td>
        <td class="right num">${fmtN(x.qty)}</td>
        <td class="right strong num" style="color:var(--primary)">${fmtVND(x.price)}</td>
        <td class="right strong num">${fmtVND(x.amount)}</td>
      </tr>`);

    return `
    ${alertHtml}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Lượt mua có giá', filtered.length, 'fa-tags', 'blue')}
      ${mkpi('Nguyên liệu', materialCount, 'fa-seedling', 'teal')}
      ${mkpi('Nhà cung cấp', supplierCount, 'fa-handshake', 'indigo')}
      ${mkpi('Đơn giá trung bình', filtered.length ? fmtVND(avgPrice) : '—', 'fa-coins', 'orange')}
      ${mkpi('Tổng giá trị theo dõi', fmtShort(totalAmount), 'fa-sack-dollar', 'green')}
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><div><h3>${selMatId ? 'Xu hướng đơn giá mua' : 'Giá trị mua theo nguyên liệu'}</h3><p>${selMatId ? 'Biến động đơn giá của nguyên liệu đang chọn theo thời gian' : 'Top nguyên liệu theo tổng giá trị lịch sử mua trong phạm vi lọc'}</p></div></div>
      <div class="card-body"><div class="chart-box"><canvas id="chPurchasePriceHistory"></canvas></div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        ${selectFilter('purchases', 'materialId', matList, 'Tất cả vật tư')}
        ${dateRangeInputs('priceDateFrom', 'priceDateTo')}
        ${(f.materialId || f.priceDateFrom || f.priceDateTo) ? '<button class="btn btn-sm" data-act="purchase-clear-price-history"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
        <span class="spacer"></span>
        <span class="chip"><i class="fa-solid fa-chart-line"></i> ${filtered.length} lượt theo dõi giá</span>
      </div>
      ${tableShell(
        [{ t: 'Mã VT', w: '90px' }, { t: 'Tên nguyên vật liệu' }, { t: 'Nhà cung cấp' }, { t: 'Đơn PO', w: '110px' },
         { t: 'Ngày mua' }, { t: 'Số lượng', cls: 'right' }, { t: 'Đơn giá mua', cls: 'right' }, { t: 'Thành tiền', cls: 'right' }],
        rows, { emptyTitle: 'Chưa có lịch sử giá mua nào' })}
    </div>`;
  };

  /* -------------------------------------------------- TAB 7: ĐÁNH GIÁ NCC */
  const renderEvaluationsTab = () => {
    const ef = F('supplierEvaluations', { q: '', sort: 'high' });
    const q = (ef.q || '').toLowerCase().trim();
    const sort = ef.sort || 'high';
    let list = DB.suppliers.filter((supplier) => {
      return !q || [supplier.id, supplier.name, supplier.contact, supplier.group].some((value) => String(value || '').toLowerCase().includes(q));
    });
    const scoreOf = (supplier) => Number(Q.supplierEvaluation(supplier.id)?.totalScore ?? supplier.rating ?? 0);
    list = list.sort((a, b) => {
      if (sort === 'low') return scoreOf(a) - scoreOf(b);
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'vi');
      return scoreOf(b) - scoreOf(a);
    });
    const rows = list.map((supplier) => {
      const e = Q.supplierEvaluation(supplier.id) || {};
      const score = scoreOf(supplier);
      const low = score > 0 && score < 4;
      const rowStyle = low ? 'background:var(--red-soft);' : '';
      return `<tr style="${rowStyle}">
        <td><span class="code">${esc(supplier.id)}</span></td>
        <td><div class="strong">${esc(supplier.name)}</div><div class="cell-sub">${esc(supplier.group || '')}</div></td>
        <td class="center strong num" style="${low ? 'color:var(--red);' : ''}">${score ? score.toFixed(1) : '—'} / 5${low ? ' <span class="badge red" style="margin-left:5px">Đánh giá thấp</span>' : ''}</td>
        <td class="center"><input class="inp right num supplier-rating-input" data-supplier-id="${supplier.id}" type="number" min="0" max="5" step="0.1" value="${score ? score : ''}" placeholder="0–5" style="width:95px;${low ? 'border-color:var(--red);' : ''}" /></td>
        <td><input class="inp supplier-rating-note" data-supplier-id="${supplier.id}" value="${esc(e.notes || '')}" placeholder="Nhận xét / ghi chú" style="min-width:180px" /></td>
        <td class="right"><button class="btn btn-sm btn-primary" data-act="supplier-evaluation-save" data-id="${supplier.id}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button></td>
      </tr>`;
    });
    return `
    <div class="card">
      <div class="card-head"><div><h3>Đánh giá nhà cung cấp</h3><p>Danh sách toàn bộ nhà cung cấp, tìm kiếm, sắp xếp theo điểm và cập nhật đánh giá trực tiếp.</p></div></div>
      <div class="toolbar">
        ${searchBox('supplierEvaluations', 'Tìm theo mã hoặc tên nhà cung cấp…')}
        ${selectFilter('supplierEvaluations', 'sort', [['high', 'Đánh giá cao → thấp'], ['low', 'Đánh giá thấp → cao'], ['name', 'Tên nhà cung cấp A → Z']], 'Sắp xếp')}
        <span class="spacer"></span><span class="chip"><i class="fa-solid fa-list"></i> ${list.length} nhà cung cấp</span>
      </div>
      ${tableShell(
        [{ t: 'Mã NCC', w: '90px' }, { t: 'Nhà cung cấp' }, { t: 'Đánh giá hiện tại', cls: 'center' }, { t: 'Nhập đánh giá', cls: 'center' }, { t: 'Nhận xét' }, { t: 'Thao tác', cls: 'right' }],
        rows, { emptyTitle: 'Không tìm thấy nhà cung cấp' })}
    </div>`;
  };

  /* -------------------------------------------------- BÁO CÁO MUA HÀNG */
  const renderReportsTab = (embedded = false) => {
    // [REPORT READ-ONLY] Chỉ tổng hợp dữ liệu Purchase hiện có; không tạo/sửa chứng từ.
    const reportPOs = (DB.purchaseOrders || []).filter((po) =>
      po.status !== 'CANCELLED' && inDateRange(po.date, f.reportDateFrom, f.reportDateTo)
    );
    const reportPRs = (DB.purchases || []).filter((pr) =>
      inDateRange(pr.date, f.reportDateFrom, f.reportDateTo)
    );
    const reportHistory = (DB.purchasePriceHistory || []).filter((x) =>
      inDateRange(x.date, f.reportDateFrom, f.reportDateTo)
    );

    const poValue = reportPOs.reduce((sum, po) => sum + Number(po.total || 0), 0);
    const paidValue = reportPOs.reduce((sum, po) => sum + Number(po.paid || 0), 0);
    const debtValue = reportPOs.reduce((sum, po) => sum + Math.max(0, Number(po.total || 0) - Number(po.paid || 0)), 0);
    const receivedPOs = reportPOs.filter((po) => po.status === 'RECEIVED').length;
    const pendingPRs = reportPRs.filter((pr) => PURCHASE_INVENTORY_CONFIG.prStatus.pending.includes(pr.status)).length;

    const supplierRows = (DB.suppliers || []).map((supplier) => {
      const pos = reportPOs.filter((po) => po.supplierId === supplier.id);
      const value = pos.reduce((sum, po) => sum + Number(po.total || 0), 0);
      const paid = pos.reduce((sum, po) => sum + Number(po.paid || 0), 0);
      return { supplier, count: pos.length, value, debt: Math.max(0, value - paid) };
    }).filter((x) => x.count > 0).sort((a, b) => b.value - a.value);

    const supplierTable = supplierRows.map((x) => `<tr>
      <td><span class="code">${esc(x.supplier.id)}</span></td>
      <td><div class="strong">${esc(x.supplier.name)}</div><div class="cell-sub">${esc(x.supplier.group || '')}</div></td>
      <td class="center num">${fmtN(x.count)}</td>
      <td class="right strong num">${fmtVND(x.value)}</td>
      <td class="right num" style="color:${x.debt > 0 ? 'var(--red)' : 'var(--green)'}">${fmtVND(x.debt)}</td>
      <td class="right"><button class="btn btn-xs" data-act="purchase-report-open-supplier-po" data-id="${esc(x.supplier.id)}"><i class="fa-solid fa-arrow-up-right-from-square"></i>Xem PO</button></td>
    </tr>`);

    return `
      ${embedded ? `
        <div class="card-head" style="margin-bottom:10px">
          <div><h3>Báo cáo mua hàng</h3><p>Tổng hợp PR, PO, thanh toán và lịch sử giá từ chính dữ liệu đang vận hành</p></div>
          <button class="btn" data-act="export-purchases"><i class="fa-solid fa-file-export"></i>Xuất dữ liệu PR</button>
        </div>` : pageHead('Báo cáo mua hàng', 'Tổng hợp PR, PO, thanh toán và lịch sử giá từ chính dữ liệu đang vận hành', `
        <button class="btn" data-act="export-purchases"><i class="fa-solid fa-file-export"></i>Xuất dữ liệu PR</button>
      `)}
      <div class="card" style="margin-bottom:14px">
        <div class="toolbar">
          ${dateRangeInputs('reportDateFrom', 'reportDateTo')}
          ${(f.reportDateFrom || f.reportDateTo) ? '<button class="btn btn-sm" data-act="purchase-clear-date-range" data-fields="reportDateFrom,reportDateTo"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
          <span class="spacer"></span><span class="chip"><i class="fa-solid fa-calendar-days"></i> Theo ngày chứng từ</span>
        </div>
      </div>
      <div class="grid g-auto-sm" style="margin-bottom:14px">
        ${mkpi('PR trong kỳ', reportPRs.length, 'fa-cart-shopping', 'blue', 'purchase-report-open-pr')}
        ${mkpi('PR chờ duyệt', pendingPRs, 'fa-hourglass-half', 'orange', 'purchase-report-open-pending-pr')}
        ${mkpi('PO hiệu lực', reportPOs.length, 'fa-file-invoice-dollar', 'teal', 'purchase-report-open-po')}
        ${mkpi('PO đã nhận đủ', receivedPOs, 'fa-circle-check', 'green', 'purchase-report-open-received-po')}
        ${mkpi('Giá trị mua', fmtShort(poValue), 'fa-sack-dollar', 'indigo', 'purchase-report-open-po')}
        ${mkpi('Đã thanh toán', fmtShort(paidValue), 'fa-money-check-dollar', 'green', 'purchase-report-open-debt')}
        ${mkpi('Công nợ còn lại', fmtShort(debtValue), 'fa-file-invoice-dollar', 'red', 'purchase-report-open-debt')}
        ${mkpi('Lượt lịch sử giá', reportHistory.length, 'fa-chart-line', 'orange', 'purchase-report-open-price-history')}
      </div>
      <div class="grid g-21" style="margin-bottom:14px">
        <div class="card"><div class="card-head"><div><h3>Giá trị mua theo Nhà cung cấp</h3><p>Top NCC theo PO hiệu lực trong khoảng thời gian đang chọn</p></div></div><div class="card-body"><div class="chart-box"><canvas id="chPurchaseReportSupplier"></canvas></div></div></div>
        <div class="card"><div class="card-head"><div><h3>Trạng thái PO</h3><p>Phân bổ trạng thái các đơn đặt hàng trong kỳ</p></div></div><div class="card-body"><div class="chart-box sm"><canvas id="chPurchaseReportStatus"></canvas></div></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Tổng hợp theo Nhà cung cấp</h3><p>Click “Xem PO” để chuyển sang màn Đơn đặt hàng có sẵn và lọc đúng NCC.</p></div><span class="chip">${fmtN(supplierRows.length)} NCC có phát sinh</span></div>
        ${tableShell([{t:'Mã NCC',w:'100px'},{t:'Nhà cung cấp'},{t:'Số PO',cls:'center'},{t:'Giá trị mua',cls:'right'},{t:'Công nợ',cls:'right'},{t:'',cls:'right',w:'95px'}], supplierTable, {emptyTitle:'Chưa có dữ liệu mua hàng trong khoảng thời gian này'})}
      </div>`;
  };

  /* -------------------------------------------------- TAB 8: DASHBOARD MUA HÀNG */
  const renderDashboardTab = () => {
    // [PURCHASE DASHBOARD - DATA CONSISTENCY]
    // Dashboard chỉ đọc đúng các collection đang được từng tab Purchase sử dụng.
    // Không dùng số demo/hard-code và không thay đổi bất kỳ trạng thái nghiệp vụ nào.
    const purchases = DB.purchases || [];
    const purchaseOrders = DB.purchaseOrders || [];
    const suppliers = DB.suppliers || [];

    const pendingPR = purchases.filter((p) =>
      PURCHASE_INVENTORY_CONFIG.prStatus.pending.includes(p.status)
    ).length;

    const shippingPO = purchaseOrders.filter((p) => p.status === 'SHIPPING').length;
    const partialPO = purchaseOrders.filter((p) => p.status === 'PARTIAL_RECEIVED').length;
    const fullPO = purchaseOrders.filter((p) => p.status === 'RECEIVED').length;

    // Cùng công thức với tab Đơn đặt hàng / Công nợ NCC:
    // PO đã hủy không tham gia giá trị mua và công nợ.
    const effectivePOs = purchaseOrders.filter((po) => po.status !== 'CANCELLED');
    const totalPoVal = effectivePOs.reduce((sum, po) => sum + Number(po.total || 0), 0);
    const totalPaidVal = effectivePOs.reduce((sum, po) => sum + Number(po.paid || 0), 0);
    const remainingDebt = effectivePOs.reduce(
      (sum, po) => sum + Math.max(0, Number(po.total || 0) - Number(po.paid || 0)),
      0
    );

    // Tính "Sắp hết" từ tồn thực tế DB.inventory, cùng nguồn với màn Tồn kho.
    // qty <= 0 là HẾT HÀNG nên không bị tính nhầm vào "Sắp hết".
    const rawWarehouseIds = new Set(
      (DB.warehouses || [])
        .filter((warehouse) => warehouse.type === 'RAW_MATERIAL')
        .map((warehouse) => warehouse.id)
    );
    const rawQtyByMaterial = new Map();
    (DB.inventory || []).forEach((row) => {
      if (!rawWarehouseIds.has(row.warehouseId)) return;
      rawQtyByMaterial.set(
        row.productId,
        Number(rawQtyByMaterial.get(row.productId) || 0) + Number(row.qtyOnHand || 0)
      );
    });
    const lowStockCount = (DB.materials || []).filter((material) => {
      const qty = Number(rawQtyByMaterial.get(material.id) || 0);
      const minStock = Number(material.minStock || 0);
      return qty > 0 && minStock > 0 && qty < minStock;
    }).length;

    return `
    <div class="grid g-4" style="margin-bottom:14px">
      ${mkpi('PR chờ duyệt', pendingPR, 'fa-hourglass-half', 'orange', 'purchase-dashboard-open-approval')}
      ${mkpi('PO đang giao', shippingPO, 'fa-truck-fast', 'teal', 'purchase-dashboard-po-shipping')}
      ${mkpi('PO nhận 1 phần', partialPO, 'fa-boxes-packing', 'indigo', 'purchase-dashboard-po-partial')}
      ${mkpi('PO đã nhận đủ', fullPO, 'fa-circle-check', 'green', 'purchase-dashboard-po-received')}
      ${mkpi('Tổng giá trị mua PO', fmtShort(totalPoVal), 'fa-sack-dollar', 'blue', 'purchase-dashboard-open-po')}
      ${mkpi('Nợ phải trả NCC', fmtShort(remainingDebt), 'fa-file-invoice-dollar', 'red', 'purchase-dashboard-open-debts')}
      ${mkpi('Vật tư sắp hết tồn', lowStockCount, 'fa-triangle-exclamation', 'orange', 'purchase-dashboard-open-low-stock')}
      ${mkpi('Nhà cung cấp', suppliers.length, 'fa-handshake', 'teal', 'purchase-dashboard-open-suppliers')}
    </div>

    <div class="grid g-21" style="margin-bottom:14px">
      <div class="card">
        <div class="card-head"><div><h3>Phân bổ giá trị mua hàng theo Nhà cung cấp</h3><p>Top nhà cung cấp theo tổng giá trị PO hiệu lực</p></div></div>
        <div class="card-body"><div class="chart-box"><canvas id="chPurchaseSupplier"></canvas></div></div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Trạng thái các Đơn đặt hàng (PO)</h3><p>Tổng ${purchaseOrders.length} đơn PO đang theo dõi</p></div></div>
        <div class="card-body"><div class="chart-box sm"><canvas id="chPoStatus"></canvas></div></div>
      </div>
    </div>
`;
  };

  /* --- RENDER CHÍNH THEO TAB --- */
  let tabContent = '';
  if (f.tab === 'quotes') tabContent = renderQuotesTab();
  else if (f.tab === 'approval') tabContent = renderApprovalTab();
  else if (f.tab === 'po') tabContent = renderPoTab();
  else if (f.tab === 'debts') tabContent = renderDebtsTab();
  else if (f.tab === 'price_history') tabContent = renderPriceHistoryTab();
  else if (f.tab === 'dashboard') tabContent = renderDashboardTab();
  else if (f.tab === 'suppliers') tabContent = Views.suppliers ? Views.suppliers() : '';
  else tabContent = renderPrTab();

  return `
    ${tabContent}
  `;
};

Views.purchases.after = function () {

  const f = F('purchases', { tab: 'pr' });

  if (f.tab === 'price_history') {
    const rows = (DB.purchasePriceHistory || [])
      .filter((x) => {
        const d = String(x.date || '').slice(0,10);
        if (f.priceDateFrom && d < f.priceDateFrom) return false;
        if (f.priceDateTo && d > f.priceDateTo) return false;
        if (f.materialId && x.materialId !== f.materialId) return false;
        return true;
      })
      .sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
    if (f.materialId) {
      Charts.line('chPurchasePriceHistory', rows.map(x=>fmtDate(x.date)), rows.map(x=>Number(x.price||0)), { money:true, fill:false, label:'Đơn giá mua' });
    } else {
      const byMaterial = new Map();
      rows.forEach((x) => byMaterial.set(x.materialId, Number(byMaterial.get(x.materialId)||0) + Number(x.amount || (Number(x.qty||0)*Number(x.price||0)))));
      const top = [...byMaterial.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
      Charts.bar('chPurchasePriceHistory', top.map(([id])=>String(Q.material(id)?.name || id).slice(0,18)), [{ label:'Giá trị mua (VND)', data:top.map(([,v])=>v), color:'orange' }]);
    }
  }

  if (f.tab === 'reports') {
    const inRange = (dateValue) => {
      const d = String(dateValue || '').slice(0, 10);
      if (!d) return !(f.reportDateFrom || f.reportDateTo);
      if (f.reportDateFrom && d < f.reportDateFrom) return false;
      if (f.reportDateTo && d > f.reportDateTo) return false;
      return true;
    };
    const reportPOs = (DB.purchaseOrders || []).filter((po) => po.status !== 'CANCELLED' && inRange(po.date));
    const supplierRows = (DB.suppliers || []).map((supplier) => ({
      supplier,
      value: reportPOs.filter((po) => po.supplierId === supplier.id).reduce((sum, po) => sum + Number(po.total || 0), 0)
    })).filter((x) => x.value > 0).sort((a,b)=>b.value-a.value).slice(0,8);
    Charts.bar('chPurchaseReportSupplier', supplierRows.map(x => String(x.supplier.name || x.supplier.id).slice(0,20)), [{ label:'Giá trị mua (VND)', data:supplierRows.map(x=>x.value), color:'blue' }], { money:true });
    const statuses = ['DRAFT','READY_TO_SEND','SENT_TO_SUPPLIER','SHIPPING','PARTIAL_RECEIVED','RECEIVED'];
    Charts.donut('chPurchaseReportStatus', ['Nháp','Chờ gửi NCC','Đã gửi NCC','Đang giao','Nhận 1 phần','Đã nhận đủ'], statuses.map(st => reportPOs.filter(po=>po.status===st).length), ['slate','orange','blue','teal','orange','green']);
  }

  if (f.tab === 'dashboard') {

    // [PURCHASE DASHBOARD - DATA CONSISTENCY]
    // Không lấy 5 NCC đầu tiên trong master nữa. Biểu đồ phải hiển thị đúng
    // Top 5 NCC theo tổng giá trị PO hiệu lực (loại PO đã hủy).
    const supplierPurchaseValues = (DB.suppliers || [])
      .map((supplier) => ({
        supplier,
        value: (DB.purchaseOrders || [])
          .filter((po) => po.supplierId === supplier.id && po.status !== 'CANCELLED')
          .reduce((sum, po) => sum + Number(po.total || 0), 0)
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    Charts.bar(
      'chPurchaseSupplier',
      supplierPurchaseValues.map(({ supplier }) => {
        const name = String(supplier.name || supplier.id || 'NCC');
        return name.length > 18 ? `${name.slice(0, 18)}…` : name;
      }),
      [
        {
          label: 'Giá trị mua (VND)',
          data: supplierPurchaseValues.map((row) => row.value),
          color: 'blue'
        }
      ]
    );

    // [DASHBOARD CONSISTENCY] Gom đầy đủ mọi trạng thái PO đang có trong dữ liệu,
    // tránh biểu đồ có tổng nhỏ hơn số PO trên bảng do bỏ sót APPROVED/CANCELLED.
    const poCounts = [
      DB.purchaseOrders.filter(p => ['DRAFT','READY_TO_SEND'].includes(p.status)).length,
      DB.purchaseOrders.filter(p => p.status === 'SENT_TO_SUPPLIER').length,
      DB.purchaseOrders.filter(p => p.status === 'SHIPPING').length,
      DB.purchaseOrders.filter(p => p.status === 'PARTIAL_RECEIVED').length,
      DB.purchaseOrders.filter(p => p.status === 'RECEIVED').length,
      DB.purchaseOrders.filter(p => p.status === 'CANCELLED').length,
    ];

    Charts.donut(
      'chPoStatus',
      ['Chờ phát hành', 'Đã gửi NCC', 'Đang giao', 'Nhận 1 phần', 'Đã nhận đủ', 'Đã hủy'],
      poCounts,
      ['slate', 'blue', 'teal', 'orange', 'green', 'red']
    );

  }

};

/* ------------------------------------------------------------ MODALS MUA HÀNG */

/** Modal xem chi tiết Đề nghị mua hàng (PR) */
function openPRModal(id) {
  const p = Q.purchase(id);
  if (!p) return;
  const canApprovePurchase = Auth.canApprovePurchase();
  const canManagePr = typeof Auth === 'undefined' || Auth.hasPermission('PURCHASE_PR_CREATE');
  // PR không còn chọn NCC ở bước này
  const s = p.supplierId
    ? Q.supplier(p.supplierId)
    : null;
  const supplierLabel = s ? s.name : 'Chưa chọn nhà cung cấp';
  const isPending =
  PURCHASE_INVENTORY_CONFIG
    .prStatus
    .pending
    .includes(p.status);


const isApproved =
  PURCHASE_INVENTORY_CONFIG
    .prStatus
    .approved
    .includes(p.status);
  const approvals = DB.purchaseApprovals.filter((a) => a.prId === id);
  const auditRows = typeof SystemAPI !== 'undefined' ? SystemAPI.auditFor(p.id, 'PURCHASE_REQUEST') : [];

  Modal.open({
    title: `Đề nghị mua hàng (PR) ${p.id}`,
    sub: `${esc(supplierLabel)} · Người yêu cầu ${esc(Q.employeeName(p.requesterId))}`,
    size: 'md',
    body: `
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px">
        ${badge(p.status)}
        <span class="chip"><i class="fa-regular fa-calendar"></i> Ngày tạo: ${fmtDate(p.createdAt || p.date)}</span>
        <span class="chip"><i class="fa-solid fa-truck"></i> Ngày cần hàng: ${fmtDate(p.expectedDate)}</span>
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-circle-info"></i>Thông tin đề nghị</div>
      <div class="info-grid" style="margin-bottom:16px">
        ${infoItem('Bộ phận đề nghị', esc(p.dept || 'Sản xuất'))}
        ${infoItem('Người đề nghị', esc(Q.employeeName(p.requesterId) || '—'))}
        ${infoItem('Nhà cung cấp dự kiến', esc(supplierLabel))}
        ${infoItem('Người tạo', esc(p.createdByName || Q.employeeName(p.createdBy) || '—'))}
        ${infoItem('Thời gian tạo', p.createdAt ? esc(String(p.createdAt).replace('T',' ').slice(0,19)) : fmtDate(p.date))}
        ${infoItem('Người phê duyệt', (() => { const req=(DB.approvalRequests||[]).filter(r=>r.docType==='PR'&&r.docId===p.id).sort((a,b)=>new Date(b.requestedAt||0)-new Date(a.requestedAt||0))[0]; const names=(req?.levels||[]).filter(l=>l.status==='APPROVED'&&l.approverName).map(l=>`Cấp ${l.level}: ${esc(l.approverName)}`); return names.length ? names.join('<br>') : (p.approvedBy ? esc(p.approvedByName || Q.employeeName(p.approvedBy)) : '<span class="muted">Chưa duyệt</span>'); })())}
        ${infoItem('Thời gian phê duyệt', p.approvedAt ? esc(String(p.approvedAt).replace('T',' ').slice(0,19)) : '<span class="muted">—</span>')}
        ${infoItem('Tổng giá trị đề xuất', `<b class="num" style="color:var(--primary);font-size:15px">${fmtVND(p.total)}</b>`)}
      </div>

      <div style="font-size:12.8px;color:var(--text-2);background:var(--surface-2);border-radius:var(--r);padding:10px 12px;margin-bottom:16px">
        <b>Mục đích / Lý do đề xuất:</b> ${esc(p.reason)}
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-list-check"></i>Danh sách vật tư đề nghị</div>
      ${tableShell(
        [{ t: 'Mã VT', w: '88px' }, { t: 'Tên vật tư' }, { t: 'Số lượng', cls: 'right' }, { t: 'ĐVT' }, { t: 'Đơn giá dự kiến', cls: 'right' }, { t: 'Thành tiền', cls: 'right' }, { t: 'Xử lý PO' }],
        p.items.map((it) => {
          const history = Array.isArray(it.poHistory) ? it.poHistory : [];
          const poTrace = history.length
            ? history.slice().reverse().map((event) => `<div style="margin-bottom:5px">
                <span class="chip" style="font-size:11px"><i class="fa-solid fa-ban"></i> ${esc(event.poId || 'PO')} đã hủy</span>
                ${event.replacementPrId ? `<div class="cell-sub" style="margin-top:3px">Đề nghị thay thế: <span class="code">${esc(event.replacementPrId)}</span></div>` : ''}
              </div>`).join('')
            : '<span class="muted">—</span>';
          return `<tr>
          <td><span class="code">${it.materialId}</span></td>
          <td class="strong">${esc(it.name)}</td>
          <td class="right num strong">${fmtN(it.qty)}</td>
          <td>${esc(it.unit)}</td>
          <td class="right num">${fmtVND(it.price)}</td>
          <td class="right strong num">${fmtVND(it.amount)}</td>
          <td>${poTrace}</td></tr>`;
        }))}

      ${approvals.length ? `
      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-clock-rotate-left"></i>Lịch sử phê duyệt</div>
      <div class="tline" style="margin-bottom:16px">
        ${approvals.map((a) => `<div class="tline-item done">
          <span class="tline-dot t-${a.action === 'approve' ? 'green' : 'red'}"><i class="fa-solid fa-${a.action === 'approve' ? 'check' : 'xmark'}"></i></span>
          <div class="tline-title">${esc(Q.employeeName(a.approverId))} — <span style="color:var(--${a.action === 'approve' ? 'green' : 'red'})">${a.action === 'approve' ? 'Phê duyệt' : 'Từ chối'}</span></div>
          <div class="tline-sub">${esc(a.note)} · ${fmtDate(a.time)}</div>
        </div>`).join('')}
      </div>` : ''}

      ${auditRows.length ? `<div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-fingerprint"></i>Dấu vết thao tác</div>
      <div class="tline">${auditRows.map(a => `<div class="tline-item done"><span class="tline-dot t-blue"><i class="fa-solid fa-user-shield"></i></span><div class="tline-title">${esc(a.fullName)} — ${esc(a.action)}</div><div class="tline-sub">${esc(a.description || '')} · ${esc(a.createdAt || '')}</div></div>`).join('')}</div>` : ''}`,
        foot: `${isPending ? `${canManagePr ? `<button class="btn btn-danger left" data-act="pr-delete" data-id="${p.id}"><i class="fa-solid fa-trash"></i>Xóa PR</button>` : ''}
          ${canApprovePurchase ? `<button class="btn" data-act="pr-reject-modal" data-id="${p.id}"><i class="fa-solid fa-xmark"></i>Từ chối PR</button>
          <button class="btn btn-success" data-act="pr-approve-action" data-id="${p.id}"><i class="fa-solid fa-check"></i>Duyệt PR</button>` : `<span class="muted" style="margin-right:auto"><i class="fa-solid fa-lock"></i> Tài khoản chỉ có quyền xem, không có quyền phê duyệt</span>`}` : ''}
          <button class="btn" data-act="modal-close">Đóng</button>`,
  });
}

/** Modal Form Tạo Đề nghị mua hàng (PR) — Kiểm soát Ngân sách & Tồn kho tối thiểu */

function openPRForm(materialId) {

  const cfg = PURCHASE_INVENTORY_CONFIG.defaultPR;
  // [PR DATE] Chỉ form PR mới dùng ngày thực tế hiện tại. Không đổi DB.today demo toàn hệ thống.
  const actualToday = typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0, 10);
  const draft = State.prFormDraft || {};
  const isResuming = !materialId && Array.isArray(State.prFormMaterials) && Object.keys(draft).length > 0;

  // [PR ACTOR FILTER]
  // Người đề nghị chỉ lấy từ các actor đang có tài khoản ERP (DB.users),
  // KHÔNG lấy toàn bộ DB.employees. Khi đã chọn bộ phận thì chỉ hiển thị
  // actor thuộc bộ phận đó; nếu chưa chọn bộ phận thì hiển thị toàn bộ actor.
  const prActorEmployees = (dept = '') => {
    const wantedDept = String(dept || '').trim();
    const seen = new Set();
    return (DB.users || [])
      .filter(user => user?.state === 'active' && user?.empId)
      .map(user => {
        const employee = (DB.employees || []).find(e => e.id === user.empId);
        return employee ? { ...employee, userId: user.id, username: user.username } : null;
      })
      .filter(Boolean)
      .filter(employee => !wantedDept || String(employee.dept || '').trim() === wantedDept)
      .filter(employee => {
        if (seen.has(employee.id)) return false;
        seen.add(employee.id);
        return true;
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
  };

  const selectedPrDept = String(draft.dept || '').trim();
  const requesterCandidates = prActorEmployees(selectedPrDept);
  const selectedRequesterId = String(draft.requester || DB.currentUser?.id || '').trim();

  // [DATA CONSISTENCY] PR và Tồn kho dùng cùng master nguyên liệu: DB.materials.
  // Số tồn trong form PR cũng lấy từ DB.inventory giống màn Tồn kho.
  const prMaterialCategory = (m) => String(m?.category || m?.group || '');
  const prMaterialStock = (materialId) => (DB.inventory || [])
    .filter(row => String(row.productId) === String(materialId))
    .reduce((sum, row) => sum + Number(row.qtyOnHand || 0), 0);
  const prMaterialCategories = [...new Set([
    ...(DB.itemCategories || []).filter(c => c.type === 'RAW_MATERIAL' && c.status !== 'inactive').map(c => c.name),
    ...(DB.materials || []).map(prMaterialCategory),
  ].filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'vi'));
  State.prMaterialCategoryFilter = State.prMaterialCategoryFilter || '';

  // =========================================================
  // DANH SÁCH NGUYÊN LIỆU ĐƯỢC CHỌN TRONG FORM
  // =========================================================

  const normalizePurchaseItem = (base) => {
    if (!base) return null;
    const isFinished = !Q.material(base.id) && !!Q.product(base.id);
    const stock = isFinished
      ? DB.inventory.filter(row => row.productId === base.id).reduce((sum, row) => sum + Number(row.qtyOnHand || 0), 0)
      : prMaterialStock(base.id);
    return {
      ...base,
      group: base.group || (isFinished ? 'Thành phẩm' : ''),
      stock,
      minStock: isFinished ? Number(DB.finishedMinStock?.[base.id] || 0) : Number(base.minStock || 0),
      supplierId: base.supplierId || base.supplier || null,
    };
  };

  State.prFormMaterials = materialId
    ? [normalizePurchaseItem(Q.material(materialId) || Q.product(materialId))].filter(Boolean)
    : (isResuming ? State.prFormMaterials : []);


  // =========================================================
  // NGÂN SÁCH
  // =========================================================

  const deptBudget =
    Q.deptBudget(cfg.department) || {
      totalBudget: 2500000000,
      usedBudget: 1850000000,
      remaining: 650000000
    };


  // =========================================================
  // CẢNH BÁO TỒN KHO
  // =========================================================

  let minStockWarn = '';

  if (materialId) {

    const m = Q.material(materialId);

    if (m && m.stock >= m.minStock) {

      minStockWarn = `
        <div
          class="alert-item"
          style="
            border-color:var(--orange);
            background:var(--orange-soft);
            margin-bottom:14px
          "
        >

          <span class="alert-ico t-orange">
            <i class="fa-solid fa-triangle-exclamation"></i>
          </span>

          <span style="min-width:0">

            <span
              class="alert-title"
              style="color:var(--orange)"
            >
              CẢNH BÁO TỒN KHO TRÊN MỨC TỐI THIỂU
            </span>

            <div class="alert-sub">
              Vật tư <b>${esc(m.name)}</b>
              hiện đang có tồn kho

              <b>
                ${fmtDec(m.stock, 2)} ${m.unit}
              </b>

              (>= Định mức tối thiểu
              ${fmtDec(m.minStock, 2)} ${m.unit}).

              Cân nhắc xem có thực sự cần mua thêm không.
            </div>

          </span>

        </div>
      `;
    }
  }


  // =========================================================
  // MODAL
  // =========================================================

  Modal.open({

    title: State.prEditingExistingPrId ? `Sửa Đề nghị mua hàng (PR) ${State.prEditingExistingPrId}` : 'Tạo Đề nghị mua hàng (Purchase Request)',

    sub:
      State.prEditingExistingPrId ? 'Cập nhật đề nghị mua hàng gốc rồi thực hiện lại quy trình phê duyệt.' : 'Điền thông tin nguyên liệu cần mua sắm phục vụ sản xuất / dự phòng tồn kho',

    size: 'md',


    body: `

      ${minStockWarn}


      <!-- ===================================================
           THÔNG TIN CHUNG
      ==================================================== -->

      <div class="form-grid">

        <div class="field">

          <label>
            Bộ phận đề nghị
          </label>

          <select class="inp" id="prDept">
            <option value="" ${!selectedPrDept ? 'selected' : ''}>-- Chưa chọn bộ phận --</option>
            ${DB.departments.map(d => `
              <option
                value="${esc(d)}"
                ${d === selectedPrDept ? 'selected' : ''}
              >
                ${esc(d)}
              </option>
            `).join('')}
          </select>
          <div class="cell-sub" style="margin-top:5px">Chọn bộ phận để lọc danh sách người đề nghị; để trống thì hiển thị tất cả người dùng ERP.</div>

        </div>


        <div class="field">

          <label>
            Người đề nghị
            <span class="req">*</span>
          </label>

          <select class="inp" id="prRequester">
            <option value="">-- Chọn người đề nghị --</option>
            ${requesterCandidates.map(e => `
              <option
                value="${e.id}"
                ${e.id === selectedRequesterId ? 'selected' : ''}
              >
                ${esc(e.name)} — ${esc(e.dept)}
              </option>
            `).join('')}
          </select>
          <div class="cell-sub" style="margin-top:5px">Danh sách chỉ gồm những người có tài khoản và đang làm việc trên hệ thống ERP.</div>

        </div>

      </div>


      <div class="form-grid">

        <div class="field">

          <label>
            Ngày cần hàng
            <span class="req">*</span>
          </label>

          <input
            class="inp"
            type="date"
            id="prExpectedDate"
            min="${actualToday}"
            value="${draft.expectedDate || addDays(actualToday, cfg.expectedDays)}"
          />
          <div class="cell-sub" style="margin-top:5px">Ngày cần hàng không được nhỏ hơn ngày hiện tại.</div>

        </div>

      </div>


      <div class="field">

        <label>
          Mục đích / Lý do đề nghị mua
          <span class="req">*</span>
        </label>

        <input
          class="inp"
          id="prReason"
          value="${esc(draft.reason || 'Bổ sung vật tư phục vụ sản xuất / dự phòng tồn kho')}"
          placeholder="Nhập lý do mua sắm…"
        />

      </div>


      <!-- ===================================================
           DANH SÁCH NGUYÊN LIỆU
      ==================================================== -->

      <div class="form-sec-title">

        <i class="fa-solid fa-list-check"></i>

        DANH SÁCH NGUYÊN LIỆU ĐỀ NGHỊ MUA

      </div>


      <!-- DANH MỤC + SEARCH -->
      <div class="form-grid" style="grid-template-columns:minmax(180px,.7fr) minmax(260px,1.3fr);align-items:end;margin-bottom:12px">
        <div class="field" style="margin:0">
          <label>Danh mục nguyên liệu</label>
          <select class="inp" id="prMaterialCategory">
            <option value="">Tất cả danh mục</option>
            ${prMaterialCategories.map(category => `<option value="${esc(category)}" ${State.prMaterialCategoryFilter===category?'selected':''}>${esc(category)}</option>`).join('')}
          </select>
          <div class="cell-sub" style="margin-top:5px">Chọn danh mục để chỉ hiển thị nguyên liệu thuộc nhóm đó.</div>
        </div>

        <div style="position:relative">

        <i
          class="fa-solid fa-magnifying-glass"
          style="
            position:absolute;
            left:12px;
            top:50%;
            transform:translateY(-50%);
            color:var(--text-3)
          "
        ></i>


        <input
          class="inp"
          id="prMaterialSearch"
          type="text"
          placeholder="Tìm kiếm & chọn nguyên liệu cần đề nghị mua..."
          autocomplete="off"
          style="padding-left:36px"
        />


        <!-- DANH SÁCH GỢI Ý -->

        <div
          id="prMaterialSuggestions"
          style="
            position:absolute;
            left:0;
            right:0;
            top:calc(100% + 4px);
            z-index:100;
            display:none;
            background:var(--surface);
            border:1px solid var(--border);
            border-radius:var(--r);
            box-shadow:var(--shadow);
            max-height:240px;
            overflow:auto;
          "
        ></div>

        </div>
      </div>


      <!-- ===================================================
           DANH SÁCH ĐÃ CHỌN
      ==================================================== -->

      <div id="prSelectedMaterials">

      ${

        State.prFormMaterials.length
          ? State.prFormMaterials
              .map(m => renderPRMaterialItem(m))
              .join('')
          : `
            <div
              id="prEmptyState"
              style="
                padding:32px 20px;
                text-align:center;
                border:1px dashed var(--border);
                border-radius:var(--r);
                color:var(--text-3);
              "
            >
              <i
                class="fa-solid fa-box-open"
                style="
                  font-size:30px;
                  margin-bottom:10px;
                  display:block;
                "
              ></i>

              <div class="strong">
                Chưa có nguyên liệu nào được chọn.
              </div>

              <div
                style="
                  margin-top:4px;
                  font-size:12px
                "
              >
                Vui lòng tìm kiếm để thêm nguyên liệu.
              </div>
            </div>
          `
      }

      </div>

    `,


    // =======================================================
    // FOOTER
    // =======================================================

    foot: `

      <button
        class="btn"
        data-act="modal-close"
      >
        Hủy
      </button>

      <button
        class="btn btn-primary"
        data-act="pr-save"
      >
        <i class="fa-solid fa-paper-plane"></i>
        ${State.prEditingExistingPrId ? 'Lưu thay đổi' : 'Gửi đề nghị mua'}
      </button>

    `
  });


  // =========================================================
  // SEARCH NGUYÊN LIỆU
  // =========================================================

  const categoryInput =
    document.getElementById('prMaterialCategory');

  const searchInput =
    document.getElementById('prMaterialSearch');

  const suggestions =
    document.getElementById('prMaterialSuggestions');

  const selectedContainer =
    document.getElementById('prSelectedMaterials');


  if (!categoryInput || !searchInput || !suggestions || !selectedContainer) {
    return;
  }


  // =========================================================
  // RENDER DANH SÁCH NGUYÊN LIỆU ĐÃ CHỌN
  // =========================================================

  const renderSelectedMaterials = () => {

    const materials = State.prFormMaterials || [];

    if (!materials.length) {

      selectedContainer.innerHTML = `
        <div
          id="prEmptyState"
          style="
            padding:32px 20px;
            text-align:center;
            border:1px dashed var(--border);
            border-radius:var(--r);
            color:var(--text-3);
          "
        >
          <i
            class="fa-solid fa-box-open"
            style="
              font-size:30px;
              margin-bottom:10px;
              display:block;
            "
          ></i>

          <div class="strong">
            Chưa có nguyên liệu nào được chọn.
          </div>

          <div
            style="
              margin-top:4px;
              font-size:12px
            "
          >
            Vui lòng tìm kiếm để thêm nguyên liệu.
          </div>
        </div>
      `;

      return;
    }

    selectedContainer.innerHTML =
      materials
        .map(m => renderPRMaterialItem(m))
        .join('');
  };


  // =========================================================
  // LỌC DANH MỤC + TÌM NGUYÊN LIỆU
  // =========================================================

  const renderMaterialSuggestions = () => {
    const keyword = searchInput.value.trim().toLowerCase();
    const selectedCategory = categoryInput.value || '';
    State.prMaterialCategoryFilter = selectedCategory;
    const selectedIds = new Set((State.prFormMaterials || []).map(m => String(m.id)));

    // [DATA CONSISTENCY] Không dùng danh sách riêng cho PR.
    // Nguồn lựa chọn ở đây chính là DB.materials đang dùng tại Kho nguyên liệu.
    const results = (DB.materials || [])
      .filter(m => {
        if (selectedIds.has(String(m.id))) return false;
        if (selectedCategory && prMaterialCategory(m) !== selectedCategory) return false;
        const text = `${m.id} ${m.name} ${prMaterialCategory(m)}`.toLowerCase();
        return !keyword || text.includes(keyword);
      })
      .slice(0, 20);

    if (!results.length) {
      suggestions.innerHTML = `<div style="padding:14px;color:var(--text-3);font-size:12px">Không tìm thấy nguyên liệu phù hợp${selectedCategory ? ` trong danh mục <b>${esc(selectedCategory)}</b>` : ''}.</div>`;
      suggestions.style.display = 'block';
      return;
    }

    suggestions.innerHTML = results.map(m => {
      const stock = prMaterialStock(m.id);
      const category = prMaterialCategory(m);
      return `<div class="pr-material-suggestion" data-id="${m.id}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border)">
        <div class="strong">${esc(m.name)}</div>
        <div class="muted" style="font-size:11.5px;margin-top:3px">${esc(m.id)} · ${esc(category || 'Chưa phân loại')} · Tồn: ${fmtDec(stock, 2)} ${esc(m.unit)}</div>
      </div>`;
    }).join('');

    suggestions.style.display = 'block';

    suggestions.querySelectorAll('.pr-material-suggestion').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        const m = Q.material(id);
        if (!m) return;
        const materials = State.prFormMaterials || [];
        if (materials.some(x => String(x.id) === String(m.id))) return;

        State.prFormMaterials.push({
          ...m,
          stock: prMaterialStock(m.id),
          supplierId: null
        });

        searchInput.value = '';
        suggestions.innerHTML = '';
        suggestions.style.display = 'none';
        renderSelectedMaterials();
      });
    });
  };

  searchInput.addEventListener('input', renderMaterialSuggestions);
  searchInput.addEventListener('focus', renderMaterialSuggestions);
  categoryInput.addEventListener('change', () => {
    searchInput.value = '';
    renderMaterialSuggestions();
  });

  // =========================================================
  // CLICK RA NGOÀI → ĐÓNG GỢI Ý
  // =========================================================

  document.addEventListener(
    'click',
    function closePRSuggestions(e) {

      if (
        !e.target.closest('#prMaterialSearch') &&
        !e.target.closest('#prMaterialSuggestions')
      ) {

        suggestions.style.display = 'none';

      }

    }
  );

}

function renderPRMaterialItem(m) {

  const supplierIds = m.supplierIds || (m.supplierId ? [m.supplierId] : []);
  const suppliers = supplierIds
    .map(id => (DB.suppliers || []).find(s => String(s.id) === String(id)))
    .filter(Boolean);

  return `
    <div
      class="pr-material-item"
      data-material-id="${m.id}"
      style="
        border:1px solid var(--border);
        border-radius:var(--r);
        margin-bottom:12px;
        background:var(--surface);
        overflow:hidden;
      "
    >

      <!-- Header nguyên liệu -->
      <div
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding:12px 14px;
          background:var(--surface-2);
          border-bottom:1px solid var(--border);
        "
      >
        <div>
          <div class="strong">
            ${esc(m.name)}
          </div>

          <div
            class="muted"
            style="font-size:11.5px;margin-top:3px"
          >
            ${esc(m.id)} · ${esc(m.group || '')}
          </div>
        </div>

        <!-- GIỮ NGUYÊN NÚT XÓA -->
        <button
          type="button"
          class="btn btn-danger"
          data-act="pr-remove-material"
          data-id="${m.id}"
        >
          <i class="fa-solid fa-trash"></i>
          Xóa
        </button>
      </div>


      <!-- Thông tin yêu cầu -->
      <div style="padding:14px">

        <div class="form-grid">

          <div class="field">
            <label>
              Số lượng yêu cầu
              <span class="req">*</span>
            </label>

            <input
              class="inp right num pr-qty"
              data-id="${m.id}"
              type="number"
              min="1"
              value="${esc(State.prFormDraft?.quantities?.[m.id] || Math.max(m.minStock * 2 - m.stock, m.minStock))}"
            />
          </div>


          <div class="field">
            <label>
              Giá dự kiến
              <span
                class="muted"
                style="font-weight:normal"
              >
                (giá tham chiếu)
              </span>
            </label>

            <input
              class="inp right num pr-expected-price" data-money="1"
              data-id="${m.id}"
              type="number"
              min="0"
              value="${esc(State.prFormDraft?.prices?.[m.id] || Number(m.price || 0))}"
              placeholder="Nhập giá dự kiến"
            />
          </div>

        </div>


        <!-- NCC -->
        <div
          class="form-sec-title"
          style="margin-top:14px"
        >
          <i class="fa-solid fa-truck-field"></i>
          Nhà cung cấp đề xuất
        </div>


        <div
          class="pr-suppliers"
          data-material-id="${m.id}"
        >

          ${
            suppliers.length
              ? `
                <div
                  style="
                    display:flex;
                    align-items:center;
                    justify-content:space-between;
                    gap:10px;
                    padding:10px 12px;
                    border:1px solid var(--border);
                    border-radius:var(--r);
                    background:var(--surface-2);
                  "
                >

                  <div style="min-width:0">

                    <div
                      class="strong"
                      style="font-size:12.8px"
                    >
                      <i
                        class="fa-solid fa-building"
                        style="color:var(--primary);margin-right:5px"
                      ></i>
                      ${suppliers.map(supplier => `<span style="display:block;margin-bottom:4px"><i class="fa-solid fa-building" style="color:var(--primary);margin-right:5px"></i>${esc(supplier.name)}</span>`).join('')}
                    </div>

                    <div
                      class="muted"
                      style="
                        font-size:11.5px;
                        margin-top:4px;
                      "
                    >
                      ${suppliers.map(supplier => `${esc(supplier.id)} · ${esc(supplier.contact || '')} · ${esc(supplier.phone || '')}`).join('<br>')}
                    </div>

                  </div>

                  <span class="badge green">
                    Đã chọn
                  </span>

                </div>
              `
              : `
                <div
                  class="muted"
                  style="font-size:12px"
                >
                  Chưa có nhà cung cấp nào.
                </div>
              `
          }

        </div>


        <!-- NÚT THÊM / ĐỔI NCC -->
        <button
          type="button"
          class="btn"
          style="margin-top:10px"
          data-act="pr-add-supplier"
          data-id="${m.id}"
        >
          <i class="fa-solid fa-${suppliers.length ? 'arrows-rotate' : 'plus'}"></i>
          ${suppliers.length ? 'Chọn lại nhà cung cấp' : 'Thêm nhà cung cấp'}
        </button>

      </div>

    </div>
  `;
}

function openPRSupplierModal(materialId) {
  const material = Q.material(materialId) || Q.product(materialId);
  if (!material) return;

  const currentSupplierIds = State.prFormMaterials
    ?.find(m => String(m.id) === String(materialId))
    ?.supplierIds || [];
  const category = material.group || material.category || 'Chưa phân loại';
  const matchedSuppliers = (DB.suppliers || []).filter((supplier) => supplierMatchesCategory(supplier, category));
  const supplierCards = matchedSuppliers.length ? matchedSuppliers.map((s) => {
    const selected = currentSupplierIds.includes(s.id);
    const rating = Number(s.rating || Q.supplierEvaluation?.(s.id)?.totalScore || 0);
    return `<label class="pr-supplier-card" style="display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:14px;border:1px solid ${selected ? 'var(--primary)' : 'var(--border)'};border-radius:14px;cursor:pointer;background:${selected ? 'var(--primary-soft)' : 'var(--surface)'};transition:.15s ease">
      <input type="checkbox" name="prSupplier" value="${esc(s.id)}" ${selected ? 'checked' : ''} style="width:17px;height:17px">
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="strong" style="font-size:13.5px">${esc(s.name)}</span>
          <span class="chip" style="font-size:10.5px"><i class="fa-solid fa-tags"></i>${esc(s.group || category)}</span>
        </div>
        <div class="muted" style="font-size:11.5px;margin-top:5px">${esc(s.id)} · ${esc(s.contact || 'Chưa có người liên hệ')} · ${esc(s.phone || 'Chưa có SĐT')}</div>
        <div class="muted" style="font-size:11px;margin-top:4px"><i class="fa-regular fa-envelope" style="margin-right:4px"></i>${esc(s.email || 'Chưa có email')} ${s.paymentTerm ? ` · ${esc(s.paymentTerm)}` : ''}</div>
      </div>
      <div style="text-align:right;white-space:nowrap">
        <div style="font-weight:700;color:${rating >= 4 ? 'var(--green)' : rating ? 'var(--orange)' : 'var(--text-3)'}">★ ${rating ? rating.toFixed(1) : '—'}</div>
        <div class="muted" style="font-size:10.5px;margin-top:5px">${selected ? 'Đang chọn' : 'Có thể chọn'}</div>
      </div>
    </label>`;
  }).join('') : `<div class="empty" style="padding:26px 16px"><div class="empty-ico"><i class="fa-solid fa-building-circle-exclamation"></i></div><h4>Chưa có nhà cung cấp phù hợp</h4><p>Nguyên liệu này thuộc danh mục <b>${esc(category)}</b>, nhưng chưa có nhà cung cấp nào thuộc cùng nhóm cung ứng.</p><button class="btn btn-primary" data-act="supplier-add"><i class="fa-solid fa-plus"></i>Thêm nhà cung cấp</button></div>`;

  Modal.open({
    title: 'Chọn nhà cung cấp cho đề nghị mua',
    sub: `${material.id} · ${esc(material.name)}`,
    size: 'lg',
    body: `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;margin-bottom:14px;padding:12px 14px;border:1px solid var(--border);border-radius:14px;background:var(--surface-2)">
      <div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">Danh mục nguyên liệu</div><div class="strong" style="margin-top:3px">${esc(category)}</div></div>
      <span class="chip"><i class="fa-solid fa-filter"></i>${matchedSuppliers.length} NCC phù hợp</span>
    </div>
    <div class="alert info" style="margin-bottom:12px"><i class="fa-solid fa-circle-info"></i><span>Hệ thống chỉ hiển thị nhà cung cấp có <b>Nhóm cung ứng = ${esc(category)}</b>. Bạn có thể chọn một hoặc nhiều NCC để lấy báo giá.</span></div>
    <div id="prSupplierList" style="display:flex;flex-direction:column;gap:9px;max-height:460px;overflow:auto;padding-right:3px">${supplierCards}</div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>${matchedSuppliers.length ? `<button class="btn btn-primary" data-act="pr-select-supplier" data-material-id="${esc(materialId)}"><i class="fa-solid fa-check"></i>Xác nhận nhà cung cấp</button>` : ''}`
  });
}
/** Modal Từ chối PR kèm ghi lý do */
function openPRRejectModal(prId) {
  Modal.open({
    title: 'Từ chối Đề nghị mua hàng',
    sub: `Mã PR: ${prId} — Nhập lý do từ chối để gửi thông báo cho người đề xuất`,
    body: `<div class="field"><label>Lý do từ chối <span class="req">*</span></label>
      <textarea class="inp" id="prRejectReason" rows="3" placeholder="Nhập lý do từ chối cụ thể (ví dụ: tồn kho hiện tại vẫn đủ dùng, đề xuất vượt ngân sách…)"></textarea></div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-danger" data-act="pr-reject-save" data-id="${prId}"><i class="fa-solid fa-xmark"></i>Xác nhận từ chối</button>`,
  });
}

/** Modal Thêm Báo giá Nhà cung cấp cho 1 PR */
// function openQuotationModal(prId) {
//   const pr = Q.purchase(prId);

//   if (!pr) {
//     Toast.err('Không tìm thấy Đề nghị mua hàng', `PR ${prId} không tồn tại.`);
//     return;
//   }
//   Modal.open({
//     title: 'Thêm Báo giá Nhà cung cấp',
//     sub: `Báo giá cho Đề nghị mua ${pr ? pr.id : ''}`,
//     size: 'md',
//     body: `
//       <div class="form-grid">
//         <div class="field"><label>Nhà cung cấp <span class="req">*</span></label>
//           <select class="inp" id="sqSupplier">
//             ${DB.suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
//           </select></div>
//         <div class="field"><label>Thời gian giao hàng (Lead time)</label>
//           <input class="inp num" type="number" id="sqLeadTime" value="7" placeholder="Số ngày giao hàng" /></div>
//       </div>
//       <div class="form-grid">
//         <div class="field"><label>Ngày báo giá</label><input class="inp" type="date" id="sqDate" value="${currentDateYMD()}" min="${currentDateYMD()}" /></div>
//         <div class="field"><label>Thời hạn hiệu lực</label><input class="inp" type="date" id="sqValid" value="${addDays(currentDateYMD(), 15)}" min="${currentDateYMD()}" /></div>
//       </div>
//       <div class="field"><label>Điều khoản thanh toán</label>
//         <input class="inp" id="sqTerm" value="30% tạm ứng, 70% sau khi giao hàng" /></div>

//       <div class="form-sec-title"><i class="fa-solid fa-tags"></i>Đơn giá báo cho các vật tư</div>
//       <div class="tbl-wrap" style="border:1px solid var(--border);border-radius:var(--r)">
//         <table class="line-tbl">
//           <thead><tr><th>Nguyên liệu</th><th class="right">SL yêu cầu</th><th class="right">Đơn giá báo (VND)</th></tr></thead>
//           <tbody>
//             ${pr.items.map((it) => `<tr>
//               <td><div class="strong">${esc(it.name)}</div><div class="cell-sub">${it.materialId}</div></td>
//               <td class="right num">${fmtN(it.qty)} ${esc(it.unit)}</td>
//               <td class="right"><input class="inp right num sq-price" data-money="1" data-id="${it.materialId}" data-qty="${it.qty}" type="number" value="" style="width:130px" /></td>
//             </tr>`).join('')}
//           </tbody>
//         </table>
//       </div>`,
//     foot: `<button class="btn" data-act="modal-close">Hủy</button>
//            <button class="btn btn-primary" data-act="quote-save-supplier" data-prid="${pr ? pr.id : ''}"><i class="fa-solid fa-floppy-disk"></i>Lưu báo giá NCC</button>`,
//   });
// }

function openQuotationModal(prId) {
  const pr = Q.purchase(prId);

  if (!pr) {
    Toast.err(
      'Không tìm thấy Đề nghị mua hàng',
      `PR ${prId} không tồn tại.`
    );
    return;
  }

  // Chỉ cho phép báo giá từ PR đã được duyệt
  if (pr.status !== 'mh_da_duyet') {
    Toast.err(
      'PR chưa được duyệt',
      'Chỉ có thể tạo báo giá NCC từ Đề nghị mua hàng đã được duyệt.'
    );
    return;
  }

  const proposedSupplierIds = [...new Set((pr.items || []).flatMap((item) => item.supplierIds || (item.supplierId ? [item.supplierId] : [])))];
  const quotationSuppliers = proposedSupplierIds.length
    ? DB.suppliers.filter((supplier) => proposedSupplierIds.includes(supplier.id))
    : DB.suppliers;

  Modal.open({
    title: 'Thêm Báo giá Nhà cung cấp',
    sub: `Báo giá cho Đề nghị mua ${pr.id}`,
    size: 'md',

    body: `
      <div class="form-grid">

        <div class="field">
          <label>
            Nhà cung cấp <span class="req">*</span>
          </label>

          <select class="inp" id="sqSupplier">
            ${quotationSuppliers.map(s => `
              <option value="${s.id}">
                ${esc(s.name)}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="field">
          <label>Thời gian giao hàng (Lead time)</label>

          <input
            class="inp num"
            type="number"
            id="sqLeadTime"
            value="7"
            min="1"
            placeholder="Số ngày giao hàng"
          />
        </div>

      </div>

      <div class="form-grid">

        <div class="field">
          <label>Ngày báo giá</label>

          <input
            class="inp"
            type="date"
            id="sqDate"
            value="${currentDateYMD()}" min="${currentDateYMD()}"
          />
        </div>

        <div class="field">
          <label>Thời hạn hiệu lực</label>

          <input
            class="inp"
            type="date"
            id="sqValid"
            value="${addDays(currentDateYMD(), 15)}" min="${currentDateYMD()}"
          />
        </div>

      </div>

      <div class="field">
        <label>Điều khoản thanh toán</label>

        <input
          class="inp"
          id="sqTerm"
          value="30% tạm ứng, 70% sau khi giao hàng"
        />
      </div>

      <div class="form-sec-title">
        <i class="fa-solid fa-tags"></i>
        Đơn giá báo cho các vật tư
      </div>

      <div class="tbl-wrap"
           style="border:1px solid var(--border);border-radius:var(--r)">

        <table class="line-tbl">

          <thead>
            <tr>
              <th>Vật tư</th>
              <th class="right">SL yêu cầu</th>
              <th class="right">Giá dự kiến</th>
              <th class="right">Giá NCC cung cấp (VND)</th>
            </tr>
          </thead>

          <tbody>

            ${pr.items.map(it => `
              <tr>

                <td>
                  <div class="strong">
                    ${esc(it.name)}
                  </div>

                  <div class="cell-sub">
                    ${esc(it.materialId)}
                  </div>
                </td>

                <td class="right num">
                  ${fmtN(it.qty)} ${esc(it.unit)}
                </td>

                <td class="right num">
                  ${fmtVND(it.expectedPrice || it.price || 0)}
                </td>

                <td class="right">

                  <input
                    class="inp right num sq-price" data-money="1"
                    data-id="${it.materialId}"
                    data-qty="${it.qty}"
                    type="number"
                    min="0"
                    value="${Number(it.supplierPrice || 0) || ''}"
                    placeholder="Nhập giá"
                    style="width:130px"
                  />

                </td>

              </tr>
            `).join('')}

          </tbody>

        </table>
      </div>
    `,

    foot: `
      <button
        class="btn"
        data-act="modal-close">
        Hủy
      </button>

      <button
        class="btn btn-primary"
        data-act="quote-save-supplier"
        data-prid="${pr.id}">
        <i class="fa-solid fa-floppy-disk"></i>
        Lưu báo giá NCC
      </button>
    `,
  });
}

async function openPOEditRequest(id) {
  const po = Q.purchaseOrder(id);
  if (!po) return;
  if (!['DRAFT', 'READY_TO_SEND'].includes(po.status)) {
    Toast.err('Không thể sửa PO', 'Chỉ PO chưa gửi Nhà cung cấp mới được chuyển về Đề nghị mua hàng.');
    return;
  }
  const sourcePr = Q.purchase(po.prId);
  if (!sourcePr) {
    Toast.err('Không tìm thấy đề nghị gốc', `PO ${po.id} không còn liên kết với đề nghị mua hàng.`);
    return;
  }

  // Giữ PR gốc làm lịch sử. Khi lưu sẽ tạo một PR mới chỉ cho các dòng của PO đang sửa.
  if (typeof PurchasePRMasterData !== 'undefined') await PurchasePRMasterData.ensure();

  State.prEditingPoId = po.id;
  State.prEditingPrId = sourcePr.id;
  State.prEditingSupplierId = po.supplierId || '';
  State.prEditingPoItemIds = (po.items || []).map((item) => String(item.materialId));

  State.prFormMaterials = (po.items || []).map((item) => {
    const material = Q.material(item.materialId) || {};
    return {
      ...material,
      id: item.materialId,
      name: item.name,
      unit: item.unit,
      supplierId: po.supplierId || '',
      supplierIds: [po.supplierId].filter(Boolean),
    };
  });
  State.prFormDraft = {
    dept: sourcePr.dept || 'Sản xuất',
    requester: sourcePr.requesterId || DB.currentUser.id,
    expectedDate: sourcePr.expectedDate || po.expectedDate,
    reason: sourcePr.reason || po.note || `Chỉnh sửa đơn ${po.id}`,
    quantities: Object.fromEntries((po.items || []).map((item) => [item.materialId, item.qty])),
    prices: Object.fromEntries((po.items || []).map((item) => [item.materialId, item.price])),
  };
  Modal.close();
  openPRForm();
  Toast.info('Đang tạo đề nghị thay thế', `${po.id} · Khi lưu sẽ tạo YCM mới; ${sourcePr.id} vẫn giữ nguyên.`);
}


/* Giá trị hàng trả NCC theo đúng giá PO (gồm VAT của dòng/PO).
 * Đây là khoản giảm giá trị phải trả; nếu đã thanh toán vượt giá trị mua sau trả
 * thì phần chênh lệch trở thành khoản NCC phải hoàn lại cho doanh nghiệp. */
function purchaseReturnGrossValue(po) {
  if (!po) return 0;
  const returns = (DB.goodsIssues || []).filter(x => x.type === 'RETURN_OUT' && (x.refDoc === po.id || x.poId === po.id));
  let total = 0;
  for (const r of returns) for (const line of (r.items || [])) {
    const materialId = line.productId || line.materialId;
    const item = (po.items || []).find(i => String(i.materialId) === String(materialId));
    if (!item) continue;
    const qty = Number(line.qty || 0);
    const price = Number(item.price || 0);
    const vatRate = Number(item.vatRate != null ? item.vatRate : (po.vatRate || 0));
    total += qty * price * (1 + vatRate / 100);
  }
  // Kho ghi tổng giá trị trả ngay trên PO và persist vào lenam_purchase_orders.
  // Nhờ vậy Kế toán tính được NCC phải hoàn lại ngay cả khi goodsIssues chưa được hydrate.
  return Math.max(Math.round(total), Math.round(Number(po.returnedGrossValue || 0)));
}
function purchasePaidAmount(po) {
  const hist = (DB.supplierPayments || []).filter(p => String(p.poId) === String(po?.id)).reduce((s,p)=>s+Number(p.amount||0),0);
  return Math.max(Number(po?.paid || 0), hist);
}
function purchaseAdjustedTotal(po) { return Math.max(0, Number(po?.total || 0) - purchaseReturnGrossValue(po)); }
function purchasePayableRemaining(po) { return Math.max(0, purchaseAdjustedTotal(po) - purchasePaidAmount(po)); }
function purchaseSupplierRefundedAmount(po) {
  return (DB.supplierRefunds || []).filter(r => String(r.poId) === String(po?.id)).reduce((s,r)=>s+Number(r.amount||0),0);
}
function purchaseSupplierRefundGrossDue(po) { return Math.max(0, purchasePaidAmount(po) - purchaseAdjustedTotal(po)); }
function purchaseSupplierRefundDue(po) { return Math.max(0, purchaseSupplierRefundGrossDue(po) - purchaseSupplierRefundedAmount(po)); }

/** Modal Xem Chi tiết Đơn đặt hàng PO */
function openPOModal(id) {
  const po = Q.purchaseOrder(id);
  if (!po) return;
  const s = Q.supplier(po.supplierId);
  const receipts = [...Q.receiptsOfPo(id)].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || String(b.id||'').localeCompare(String(a.id||'')));
  const payments = [...Q.paymentsOfPo(id)].sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||'')) || String(b.id||'').localeCompare(String(a.id||'')));
  const returns = (DB.goodsIssues || []).filter(x => x.type === 'RETURN_OUT' && (x.refDoc === id || x.poId === id)).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || String(b.id||'').localeCompare(String(a.id||'')));
  const returnedQtyFromIssues = returns.reduce((sum,r)=>sum+(r.items||[]).reduce((n,it)=>n+Number(it.qty||0),0),0);
  const returnedQty = Math.max(Number(po.returnedQty || 0), returnedQtyFromIssues);
  const receivedQty = (po.items||[]).reduce((sum,it)=>sum+Number(it.receivedQty||0),0);
  const returnedValue = purchaseReturnGrossValue(po);
  const paidValue = purchasePaidAmount(po);
  const adjustedTotal = purchaseAdjustedTotal(po);
  const payableRemain = purchasePayableRemaining(po);
  const supplierRefundDue = purchaseSupplierRefundDue(po);
  const poModalStatus = po.status === 'RECEIVED' && returnedQty > 0 && returnedQty < Math.max(receivedQty,0.000001)
    ? '<span class="badge orange">Đã nhận đủ, trả hàng 1 phần</span>'
    : badge(po.status);

  Modal.open({
    title: `Đơn đặt hàng (Purchase Order) ${po.id}`,
    sub: `${esc(s.name)} · Khởi tạo từ ${po.prId}`,
    size: 'md',
    body: `
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px">
        ${poModalStatus}
        <span class="chip"><i class="fa-regular fa-calendar"></i> Ngày PO: ${fmtDate(po.date)}</span>
        <span class="chip"><i class="fa-solid fa-truck"></i> Dự kiến giao: ${fmtDate(po.expectedDate)}</span>
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-circle-info"></i>Thông tin đơn PO</div>
      <div class="info-grid" style="margin-bottom:16px">
        ${infoItem('Nhà cung cấp', esc(s.name))}
        ${infoItem('Đầu mối liên hệ', `${esc(s.contact)} · ${esc(s.phone)}`)}
        ${infoItem('Điều khoản thanh toán', esc(po.paymentTerm))}
        ${infoItem('Tổng tiền PO', `<b class="num" style="color:var(--primary);font-size:15px">${fmtVND(Number(po.total || 0))}</b>`)}
        ${returnedValue > 0 ? infoItem('Giá trị hàng đã trả', `<b class="num" style="color:var(--orange)">− ${fmtVND(returnedValue)}</b>`) : ''}
        ${returnedValue > 0 ? infoItem('Giá trị mua sau trả hàng', `<b class="num">${fmtVND(adjustedTotal)}</b>`) : ''}
        ${infoItem('Đã thanh toán', `<b class="num" style="color:var(--green)">${fmtVND(paidValue)}</b>`)}
        ${infoItem('Còn phải trả NCC', `<b class="num" style="color:${payableRemain > 0 ? 'var(--red)' : 'var(--text-3)'}">${fmtVND(payableRemain)}</b>`)}
        ${purchaseSupplierRefundGrossDue(po) > 0 ? infoItem('NCC phát sinh phải hoàn', `<b class="num" style="color:var(--orange);font-size:15px">${fmtVND(purchaseSupplierRefundGrossDue(po))}</b>`) : ''}
        ${purchaseSupplierRefundedAmount(po) > 0 ? infoItem('NCC đã hoàn', `<b class="num" style="color:var(--green);font-size:15px">${fmtVND(purchaseSupplierRefundedAmount(po))}</b>`) : ''}
        ${supplierRefundDue > 0 ? infoItem('NCC còn phải hoàn', `<b class="num" style="color:var(--orange);font-size:15px">${fmtVND(supplierRefundDue)}</b>`) : ''}
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>Danh sách vật tư đặt hàng</div>
      ${tableShell(
        [{ t: 'Mã VT', w: '88px' }, { t: 'Tên vật tư' }, { t: 'SL Đặt', cls: 'right' }, { t: 'SL Đã nhận', cls: 'right' }, { t: 'Đơn giá', cls: 'right' }, { t: 'Thành tiền', cls: 'right' }],
        po.items.map((it) => `<tr>
          <td><span class="code">${it.materialId}</span></td>
          <td class="strong">${esc(it.name)}</td>
          <td class="right num strong">${fmtN(it.qty)} ${esc(it.unit)}</td>
          <td class="right num" style="color:${it.receivedQty >= it.qty ? 'var(--green)' : 'var(--orange)'}">${fmtN(it.receivedQty || 0)} ${esc(it.unit)}</td>
          <td class="right num">${fmtVND(it.price)}</td>
          <td class="right strong num">${fmtVND(it.amount)}</td></tr>`))}

      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-warehouse"></i>Lịch sử nhập kho</div>
      ${tableShell(
        [{ t: 'Phiếu nhập' }, { t: 'Ngày nhận' }, { t: 'Nguyên liệu' }, { t: 'Số lượng nhập', cls: 'right' }, { t: 'Kho / Kệ' }, { t: 'Người nhận' }],
        receipts.flatMap((r) => (r.items || []).map((it) => `<tr><td><span class="code">${r.id}</span></td><td class="num">${fmtDate(r.date)}</td><td>${cell2(esc(it.name || Q.material(it.materialId)?.name || it.materialId), esc(it.materialId || ''))}</td><td class="right num strong">${fmtN(it.qty)} ${esc(it.unit || '')}</td><td>${cell2(esc(r.warehouse || Q.warehouseName(r.warehouseId)), esc(r.location || Q.locationName(it.locationId || r.locationId) || '—'))}</td><td>${esc(Q.employeeName(r.receivedBy))}</td></tr>`)),
        { emptyTitle: 'Chưa có lịch sử nhập kho' })}

      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-rotate-left"></i>Lịch sử trả hàng</div>
      ${tableShell(
        [{ t: 'Phiếu xuất trả' }, { t: 'Ngày trả' }, { t: 'Nguyên liệu' }, { t: 'Số lượng trả', cls: 'right' }, { t: 'Lô hệ thống' }, { t: 'Lý do' }],
        returns.flatMap((r) => (r.items || []).map((it) => `<tr><td><span class="code">${r.id}</span></td><td class="num">${fmtDate(r.date)}</td><td>${esc(Q.material(it.productId)?.name || it.productId)}</td><td class="right num strong">${fmtN(it.qty)} ${esc(it.unit || '')}</td><td><span class="code">${esc(Q.lot(it.lotId)?.lotNumber || it.lotId || '—')}</span></td><td class="muted">${esc(r.note || '')}</td></tr>`)),
        { emptyTitle: 'Chưa có lịch sử trả hàng' })}`,
        foot: `          ${po.status === 'READY_TO_SEND' && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_PO_SEND') ? `<button class="btn btn-primary" data-act="po-change-status" data-id="${po.id}" data-status="SENT_TO_SUPPLIER"><i class="fa-solid fa-paper-plane"></i>Gửi NCC</button>` : ''}
          ${['DRAFT', 'READY_TO_SEND'].includes(po.status) && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_PO_CREATE') ? `<button class="btn btn-warning" data-act="po-edit" data-id="${po.id}"><i class="fa-solid fa-pen-to-square"></i>Sửa đơn</button>` : ''}
          ${!['RECEIVED', 'PARTIAL_RECEIVED', 'CANCELLED', 'SHIPPING'].includes(po.status) && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_PO_CREATE') ? `<button class="btn btn-danger" data-act="po-cancel" data-id="${po.id}"><i class="fa-solid fa-ban"></i>Hủy PO</button>` : ''}
          ${returns.length && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_PR_CREATE') ? `<button class="btn btn-success left" data-act="po-create-return-pr" data-id="${po.id}"><i class="fa-solid fa-cart-plus"></i>Gửi đề nghị mua thêm</button>` : ''}
          ${po.status === 'RECEIVED' && !(DB.supplierEvaluationHistory || []).some(e => e.poId === po.id) && typeof Auth !== 'undefined' && Auth.hasPermission('PURCHASE_SUPPLIER_MANAGE') ? `<button class="btn btn-primary" data-act="po-evaluate-supplier" data-id="${po.id}"><i class="fa-solid fa-star"></i>Đánh giá NCC</button>` : ''}
           <button class="btn" data-act="modal-close">Đóng</button>`,
  });
}

/** Modal Nhập kho nguyên vật liệu từ PO (Hỗ trợ Nhập kho từng phần - Partial Receipt) */
function openGoodsReceiptModal(poId) {
  const po = Q.purchaseOrder(poId);
  if (!po) return;

  Modal.open({
    title: `Phiếu Nhập kho hàng mua (Goods Receipt)`,
    sub: `Nhập kho theo Đơn hàng ${po.id} — Nhà cung cấp ${esc(Q.supplierName(po.supplierId))}`,
    size: 'md',
    body: `
      <div class="form-grid">
        <div class="field"><label>Kho nhận hàng <span class="req">*</span></label>
          <select class="inp" id="grWarehouse">
            <option value="WH-001">Kho Nguyên vật liệu chính</option>
            <option value="WH-002">Kho Phân xưởng sản xuất</option>
            <option value="WH-004">Kho Thành phẩm lạnh</option>
          </select></div>
        <div class="field"><label>Người nhận hàng</label>
          <select class="inp" id="grReceiver">
            ${DB.employees.filter((e) => e.dept === 'Kho vận').map((e) => `<option value="${e.id}" ${e.id === 'NV-018' ? 'selected' : ''}>${esc(e.name)} — Thủ kho</option>`).join('')}
          </select></div>
      </div>
      <div class="field"><label>Ghi chú nhập kho</label>
        <input class="inp" id="grNote" value="Nhập kho nguyên vật liệu theo đơn PO ${po.id}" placeholder="Ghi chú phiếu nhập…" /></div>

      <div class="form-sec-title"><i class="fa-solid fa-boxes-packing"></i>Số lượng thực nhận đợt này</div>
      <div class="tbl-wrap" style="border:1px solid var(--border);border-radius:var(--r)">
        <table class="line-tbl">
          <thead><tr><th>Vật tư</th><th class="right">SL Đặt</th><th class="right">Đã nhận trước</th><th class="right">SL Nhập đợt này</th></tr></thead>
          <tbody>
            ${po.items.map((it) => {
              const remain = Math.max(0, it.qty - (it.receivedQty || 0));
              return `<tr>
                <td><div class="strong">${esc(it.name)}</div><div class="cell-sub">${it.materialId}</div></td>
                <td class="right num">${fmtN(it.qty)} ${esc(it.unit)}</td>
                <td class="right num muted">${fmtN(it.receivedQty || 0)} ${esc(it.unit)}</td>
                <td class="right"><input class="inp right num gr-qty" data-id="${it.materialId}" data-max="${remain}" type="number" min="0" max="${remain}" value="${remain}" style="width:120px" /></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-success" data-act="goods-receipt-save" data-poid="${po.id}"><i class="fa-solid fa-warehouse"></i>Xác nhận Nhập kho</button>`,
  });
}

/** Modal Ghi nhận Thanh toán Công nợ Nhà cung cấp */
function openPaymentModal(poId) {
  const po = Q.purchaseOrder(poId);
  if (!po) return;
  const paid = purchasePaidAmount(po);
  const remain = purchasePayableRemaining(po);
  const actorId = DB.currentUser?.userId || DB.currentUser?.id || '';
  const actorName = (String(DB.currentUser?.username||'').toLowerCase()==='admin' || DB.currentUser?.roleId==='ROLE_ADMIN') ? 'Admin' : (DB.currentUser?.name || Q.employeeName(DB.currentUser?.id));
  const employeePeople = (DB.employees || []).map(e => `<option value="${esc(e.id)}" ${String(e.id)===String(DB.currentUser?.id)?'selected':''}>${esc(e.id+' · '+(e.name||e.fullName||''))}</option>`).join('');
  const hasActor = (DB.employees || []).some(e => String(e.id)===String(DB.currentUser?.id) || String(e.id)===String(actorId));
  const people = `${hasActor?'':`<option value="${esc(actorId)}" selected>${esc(actorName)}</option>`}${employeePeople}`;
  const banks = (DB.bankAccounts || []).map(b => `<option value="${esc(b.id)}">${esc(b.name || ((b.bankName||'Ngân hàng')+' · '+(b.accountNumber||'')))}</option>`).join('');

  Modal.open({
    title: 'Ghi nhận Thanh toán Công nợ NCC',
    sub: `Đơn PO ${po.id} — Nợ còn lại: ${fmtVND(remain)}`,
    body: `
      <div class="form-grid">
        <div class="field"><label>Số tiền thanh toán (VND) <span class="req">*</span></label>
          <input class="inp right num" type="text" inputmode="numeric" id="payAmount" data-money="1" value="${remain}" /></div>
        <div class="field"><label>Ngày thanh toán</label><input class="inp" type="date" id="payDate" value="${typeof currentDateYMD==='function'?currentDateYMD():DB.today}" /></div>
        <div class="field"><label>Hình thức thanh toán</label>
          <select class="inp" id="payMethod"><option value="BANK_TRANSFER">Chuyển khoản ngân hàng</option><option value="CASH">Tiền mặt</option></select></div>
        <div class="field"><label>Người thực hiện</label><select class="inp" id="payPayer"><option value="">-- Chọn người thực hiện --</option>${people}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Định khoản <span class="req">*</span></label><select class="inp" id="payAccountingEntry">${typeof accountingEntryOptions==='function'?accountingEntryOptions('CHI'):''}</select></div>
      </div>
      <div class="form-grid" id="payBankWrap">
        <div class="field"><label>Tài khoản ngân hàng thanh toán</label><select class="inp" id="payBank"><option value="">-- Chọn ngân hàng --</option>${banks}</select></div>
        <div class="field"><label>Mã giao dịch / Số chứng từ bank</label><input class="inp" id="payRef" value="FT${Date.now().toString().slice(-8)}" /></div>
      </div>
      <div class="field"><label>Ghi chú thanh toán</label><input class="inp" id="payNote" value="Thanh toán công nợ PO ${po.id}" /></div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-primary" data-act="supplier-pay-save" data-poid="${po.id}"><i class="fa-solid fa-floppy-disk"></i>Lưu thanh toán</button>`,
    onMount: () => {
      const method = $('#payMethod'); const wrap = $('#payBankWrap');
      const sync = () => { if (wrap) wrap.style.display = method?.value === 'BANK_TRANSFER' ? 'grid' : 'none'; };
      method?.addEventListener('change', sync); sync();
    }
  });
}


/* ==================== NCC HOÀN TIỀN ==================== */
function openSupplierRefundModal(poId) {
  const po = Q.purchaseOrder(poId); if (!po) return;
  const due = purchaseSupplierRefundDue(po);
  if (due <= 0) { Toast.ok('Khoản hoàn đã tất toán', 'Nhà cung cấp không còn số tiền phải hoàn cho PO này.'); return; }
  const supplier = Q.supplier(po.supplierId) || {};
  const banks=(DB.bankAccounts||[]).map(b=>`<option value="${esc(b.id)}">${esc(b.bankName||b.name||'Ngân hàng')} · ${esc(b.accountNumber||'')}</option>`).join('');
  Modal.open({title:'Ghi nhận NCC hoàn tiền',sub:`${esc(po.id)} · ${esc(supplier.name||po.supplierId)}`,size:'md',body:`
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('NCC phát sinh phải hoàn',fmtVND(purchaseSupplierRefundGrossDue(po)),'fa-rotate-left','orange')}
      ${mkpi('Đã hoàn',fmtVND(purchaseSupplierRefundedAmount(po)),'fa-circle-check','green')}
      ${mkpi('Còn phải hoàn',fmtVND(due),'fa-hourglass-half','red')}
    </div>
    <div class="form-grid">
      <div class="field"><label>Ngày nhận tiền <span class="req">*</span></label><input class="inp" id="supplierRefundDate" type="date" value="${currentDateYMD()}"></div>
      <div class="field"><label>Số tiền NCC hoàn <span class="req">*</span></label><input class="inp money-input" id="supplierRefundAmount" inputmode="numeric" value="${fmtN(due)}"></div>
      <div class="field"><label>Phương thức <span class="req">*</span></label><select class="inp" id="supplierRefundMethod"><option value="BANK_TRANSFER">Chuyển khoản ngân hàng</option><option value="CASH">Tiền mặt</option></select></div>
      <div class="field" id="supplierRefundBankField"><label>Tài khoản nhận tiền <span class="req">*</span></label><select class="inp" id="supplierRefundBank"><option value="">-- Chọn tài khoản ngân hàng --</option>${banks}</select></div>
      <div class="field"><label>Mã giao dịch / tham chiếu</label><input class="inp" id="supplierRefundRef" placeholder="VD: FT260917..." /></div>
      <div class="field"><label>Người ghi nhận</label><input class="inp" value="${esc((String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN')?'Admin':(DB.currentUser?.name||'Người dùng'))}" disabled></div>
      <div class="field span-2"><label>Định khoản <span class="req">*</span></label><select class="inp" id="supplierRefundAccountingEntry">${typeof accountingEntryOptions==='function'?accountingEntryOptions('THU'):''}</select></div>
      <div class="field span-2"><label>Ghi chú</label><textarea class="inp" id="supplierRefundNote" rows="2" placeholder="Nội dung NCC hoàn tiền..."></textarea></div>
    </div>`,
    foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="supplier-refund-save" data-id="${esc(po.id)}"><i class="fa-solid fa-floppy-disk"></i>Ghi nhận hoàn tiền</button>`,
    onMount:()=>{ const m=$('#supplierRefundMethod'); const bank=$('#supplierRefundBankField'); if(m) m.onchange=()=>{bank.style.display=m.value==='BANK_TRANSFER'?'':'none'}; }
  });
}

function saveSupplierRefund(poId) {
  const po=Q.purchaseOrder(poId); if(!po)return;
  const due=purchaseSupplierRefundDue(po);
  const raw=String($('#supplierRefundAmount')?.value||'').replace(/\./g,'').replace(/,/g,'');
  const amount=Number(raw||0), method=$('#supplierRefundMethod')?.value||'BANK_TRANSFER', bankId=$('#supplierRefundBank')?.value||'', accountingEntryId=$('#supplierRefundAccountingEntry')?.value||'';
  if(!amount||amount<=0){Toast.err('Thiếu số tiền','Vui lòng nhập số tiền NCC hoàn.');return;}
  if(!accountingEntryId){Toast.err('Chưa chọn định khoản','Khoản NCC hoàn tiền bắt buộc phải chọn định khoản.');return;}
  if(amount>due+0.001){Toast.err('Số tiền vượt khoản phải hoàn',`NCC hiện chỉ còn phải hoàn ${fmtVND(due)}.`);return;}
  if(method==='BANK_TRANSFER'&&!bankId){Toast.err('Chưa chọn tài khoản nhận','Vui lòng chọn tài khoản ngân hàng nhận tiền.');return;}
  const bank=(DB.bankAccounts||[]).find(b=>String(b.id)===String(bankId));
  DB.supplierRefunds=DB.supplierRefunds||[];
  const id=nextCode('HTNCC-2026-',DB.supplierRefunds);
  const isAdmin=String(DB.currentUser?.username||'').toLowerCase()==='admin'||DB.currentUser?.roleId==='ROLE_ADMIN';
  DB.supplierRefunds.unshift({id,poId:po.id,supplierId:po.supplierId,date:$('#supplierRefundDate')?.value||currentDateYMD(),amount,method,accountingEntryId,bankId,bankName:bank?(bank.bankName||bank.name||''):'',accountNumber:bank?.accountNumber||'',reference:$('#supplierRefundRef')?.value.trim()||'',note:$('#supplierRefundNote')?.value.trim()||'',receivedBy:DB.currentUser?.userId||DB.currentUser?.id||'',receivedByName:isAdmin?'Admin':(DB.currentUser?.name||DB.currentUser?.fullName||''),createdBy:DB.currentUser?.userId||DB.currentUser?.id||'',createdByName:isAdmin?'Admin':(DB.currentUser?.name||DB.currentUser?.fullName||''),createdAt:new Date().toISOString()});
  po.updatedAt=new Date().toISOString(); po.updatedBy=DB.currentUser?.userId||DB.currentUser?.id||'';
  if(typeof SystemAPI!=='undefined')SystemAPI.audit({module:'PURCHASE',entityType:'SUPPLIER_REFUND',entityId:id,action:'CREATE',description:`Ghi nhận ${Q.supplierName(po.supplierId)} hoàn ${fmtVND(amount)} cho ${po.id}`,newData:{poId:po.id,amount}});
  Modal.close(); render(); Toast.ok('Đã ghi nhận NCC hoàn tiền',`${id} · ${fmtVND(amount)} · Còn phải hoàn ${fmtVND(purchaseSupplierRefundDue(po))}`);
}
