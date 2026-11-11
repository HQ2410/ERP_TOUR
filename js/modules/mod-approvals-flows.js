/* ============================================================================
 * MODULE: NỐI CÁC LUỒNG PHÊ DUYỆT CÒN LẠI VÀO NGHIỆP VỤ THẬT + LƯU DATABASE (KIO)
 * ----------------------------------------------------------------------------
 * Bối cảnh: mod-approvals.js chỉ đăng ký handler "duyệt xong thì áp dụng vào
 * dữ liệu thật" cho 2 loại chứng từ: Đề nghị mua hàng (PR) và Đơn hàng bán.
 * 8 loại còn lại (Đơn đặt hàng, Thanh toán, Chi tiền, Giảm giá, Hủy đơn hàng,
 * Xuất kho đặc biệt, Sản xuất ngoài định mức, Đổi trả hàng) chỉ tạo được một
 * "yêu cầu trống": duyệt xong KHÔNG có gì xảy ra với dữ liệu nghiệp vụ.
 *
 * File này làm đúng khuôn mẫu của PR:
 *   tạo yêu cầu (kèm payload thật, kiểm tra hợp lệ) -> duyệt đủ các cấp
 *   -> onApproved áp dụng vào DB.* -> ghi lên KIO bằng đúng API của module đó
 *   (CRMAPI / InventoryAPI / PurchaseAPI / ProductionAPI / RestaurantQualityAPI).
 *   Từ chối -> không đổi dữ liệu nghiệp vụ.
 *
 * Nạp SAU mod-approvals.js (xem index.html).
 * ==========================================================================*/
(function () {
  'use strict';
  if (typeof ApprovalEngine === 'undefined' || typeof Actions === 'undefined' || typeof APPROVAL_DOC_TYPES === 'undefined') {
    console.warn('[ApprovalFlows] Thiếu mod-approvals.js — bỏ qua.');
    return;
  }

  /* ------------------------------------------------------------------ tiện ích */
  const val = (id) => document.getElementById(id)?.value ?? '';
  const today = () => (typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0, 10));
  const nowIso = () => new Date().toISOString();
  const num = (v) => Number(v || 0);
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const field = (label, inner, full) => `<div class="field" ${full ? 'style="grid-column:1/-1"' : ''}><label>${label}</label>${inner}</div>`;
  const restore = (target, snap) => { Object.keys(target).forEach((k) => { if (!(k in snap)) delete target[k]; }); Object.assign(target, JSON.parse(JSON.stringify(snap))); };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const matPrice = (id) => num(Q.material?.(id)?.price) || num(Q.costOf?.(id)?.unitCost);
  const itemName = (id) => (Q.material?.(id) || Q.product?.(id) || {}).name || id;
  const PAID_LOCK = ['dh_da_giao', 'dh_hoan_tat', 'dh_da_huy', 'dh_tu_choi'];

  /* ------------------------------------------- loại chứng từ + quy trình mặc định */
  APPROVAL_DOC_TYPES.PO = { label: 'Đơn đặt hàng', icon: 'fa-file-signature', tone: 'blue' };
  if (!APPROVAL_DOC_TYPE_LIST.includes('PO')) APPROVAL_DOC_TYPE_LIST.splice(1, 0, 'PO');

  const DEFAULT_WF = [
    { id: 'WF-PO', docType: 'PO', name: 'Đơn đặt hàng', slaHours: 24, levels: [
      { level: 1, role: 'ROLE_PURCHASE_MANAGER', label: 'Trưởng phòng Mua hàng duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_DIRECTOR', label: 'Ban giám đốc duyệt (giá trị lớn)', minAmount: 50000000 } ] },
    { id: 'WF-PAYMENT', docType: 'PAYMENT', name: 'Thanh toán', slaHours: 12, levels: [
      { level: 1, role: 'ROLE_ACCOUNTING', label: 'Kế toán duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_DIRECTOR', label: 'Ban giám đốc duyệt (giá trị lớn)', minAmount: 20000000 } ] },
    { id: 'WF-CASH', docType: 'CASH_OUT', name: 'Chi tiền', slaHours: 8, levels: [
      { level: 1, role: 'ROLE_ACCOUNTING', label: 'Kế toán duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_DIRECTOR', label: 'Ban giám đốc duyệt (giá trị lớn)', minAmount: 10000000 } ] },
    { id: 'WF-DISCOUNT', docType: 'DISCOUNT', name: 'Giảm giá', slaHours: 24, levels: [
      { level: 1, role: 'ROLE_SALES_MANAGER', label: 'Trưởng phòng Kinh doanh duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_DIRECTOR', label: 'Ban giám đốc duyệt (mức giảm lớn)', minAmount: 10 } ] },
    { id: 'WF-CANCEL', docType: 'ORDER_CANCEL', name: 'Hủy đơn hàng', slaHours: 24, levels: [
      { level: 1, role: 'ROLE_SALES_MANAGER', label: 'Trưởng phòng Kinh doanh duyệt', minAmount: 0 } ] },
    { id: 'WF-ISSUE', docType: 'SPECIAL_ISSUE', name: 'Xuất kho đặc biệt', slaHours: 12, levels: [
      { level: 1, role: 'ROLE_WAREHOUSE', label: 'Kho xác nhận', minAmount: 0 },
      { level: 2, role: 'ROLE_PRODUCTION', label: 'Sản xuất duyệt', minAmount: 0 } ] },
    { id: 'WF-OVERNORM', docType: 'OVER_NORM_PRODUCTION', name: 'Sản xuất ngoài định mức', slaHours: 24, levels: [
      { level: 1, role: 'ROLE_PRODUCTION', label: 'Sản xuất duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_DIRECTOR', label: 'Ban giám đốc duyệt (chênh lệch lớn)', minAmount: 5000000 } ] },
    { id: 'WF-RETURN', docType: 'RETURN_EXCHANGE', name: 'Đổi trả hàng', slaHours: 24, levels: [
      { level: 1, role: 'ROLE_SALES_MANAGER', label: 'Trưởng phòng Kinh doanh duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_ACCOUNTING', label: 'Kế toán đối chiếu công nợ', minAmount: 0 } ] },
  ];
  // Dữ liệu workflow hydrate từ KIO có thể thiếu loại mới (vd. PO) -> bổ sung và lưu lại.
  function ensureWorkflows() {
    DB.approvalWorkflows = DB.approvalWorkflows || [];
    let added = 0;
    DEFAULT_WF.forEach((wf) => {
      if (!DB.approvalWorkflows.some((w) => w && w.docType === wf.docType)) { DB.approvalWorkflows.push(clone(wf)); added++; }
    });
    if (added) { try { ApprovalsAPI?.scheduleCollections?.(['workflows'], 0); } catch (_) {} }
    return added;
  }
  ensureWorkflows();

  /* ----------------------------------------------------------- định nghĩa luồng */
  const FLOWS = {};

  /* ---- 1. Đơn đặt hàng (PO) ---- */
  FLOWS.PO = {
    fields() {
      const list = (DB.purchaseOrders || []).filter((po) => !['CANCELLED', 'RECEIVED'].includes(po.status));
      return field('Đơn đặt hàng (PO) *', `<select class="inp" id="apfPo"><option value="">-- Chọn PO --</option>${list.map((po) =>
        opt(po.id, `${po.id} · ${Q.supplierName?.(po.supplierId) || po.supplierId} · ${fmtVND(po.total)}`)).join('')}</select>`, true);
    },
    collect() {
      const po = Q.purchaseOrder(val('apfPo'));
      if (!po) return { error: 'Vui lòng chọn đơn đặt hàng.' };
      return { docId: po.id, amount: num(po.total), title: `Đơn đặt hàng ${po.id}`, payload: { poId: po.id } };
    },
    validate(p) {
      const po = Q.purchaseOrder(p.poId);
      if (!po) return 'Không tìm thấy đơn đặt hàng.';
      if (['CANCELLED', 'RECEIVED'].includes(po.status)) return `${po.id} đang ở trạng thái ${statusLabel(po.status)}.`;
      return '';
    },
    describe: (p) => [['PO', p.poId]],
    async apply(req) {
      const po = Q.purchaseOrder(req.payload.poId);
      const err = this.validate(req.payload); if (err) throw new Error(err);
      const last = req.levels[req.levels.length - 1];
      const snap = clone(po); const pr = Q.purchase(po.prId); const prSnap = pr ? clone(pr) : null;
      Object.assign(po, { approvalRequestId: req.id, approvalStatus: 'APPROVED', approvedAt: last.time || nowIso(), approvedByUserId: last.approverId, approvedByName: last.approverName });
      if (po.status === 'PENDING_APPROVAL') { po.status = 'APPROVED'; if (pr) pr.status = 'mh_da_dat_hang'; }
      try { await PurchaseAPI.syncCollections(['purchaseOrders', 'purchases']); }
      catch (e) { restore(po, snap); if (pr && prSnap) restore(pr, prSnap); throw e; }
      return `${po.id} đã được phê duyệt`;
    },
    async onRejected(req) {
      const po = Q.purchaseOrder(req.payload?.poId); if (!po) return;
      const rej = (req.levels || []).find((l) => l.status === 'REJECTED');
      Object.assign(po, { approvalRequestId: req.id, approvalStatus: 'REJECTED', approvalRejectReason: rej?.note || '' });
      try { await PurchaseAPI.syncCollections(['purchaseOrders']); } catch (e) { console.warn('[ApprovalFlows] Không lưu được từ chối PO', e); }
    },
  };

  /* ---- 2. Thanh toán nhà cung cấp ---- */
  function bankFields(prefix) {
    const banks = DB.bankAccounts || [];
    return `${field('Hình thức *', `<select class="inp" id="${prefix}Method"><option value="BANK_TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option></select>`)}
      <div class="field" id="${prefix}BankWrap"><label>Ngân hàng *</label><select class="inp" id="${prefix}Bank"><option value="">-- Chọn tài khoản --</option>${banks.map((b) =>
        opt(b.id, `${b.name || b.bankName || b.id} · ${b.accountNumber || ''}`)).join('')}</select></div>`;
  }
  function entryField(prefix, flow) {
    return field('Định khoản *', `<select class="inp" id="${prefix}Entry">${typeof accountingEntryOptions === 'function' ? accountingEntryOptions(flow) : '<option value="">--</option>'}</select>`, true);
  }
  function checkMoneySource(p) {
    if (!p.accountingEntryId) return 'Bắt buộc chọn định khoản.';
    if (p.method === 'BANK_TRANSFER') {
      if (!p.bankId) return 'Vui lòng chọn tài khoản ngân hàng.';
      if (typeof AccFin !== 'undefined' && AccFin.bankBalance(p.bankId) < p.amount) return `Số dư ngân hàng không đủ (${fmtVND(AccFin.bankBalance(p.bankId))}).`;
    }
    return '';
  }

  FLOWS.PAYMENT = {
    fields() {
      const list = (DB.purchaseOrders || []).filter((po) => po.status !== 'CANCELLED' && purchasePayableRemaining(po) > 0);
      return field('Đơn đặt hàng cần thanh toán *', `<select class="inp" id="apfPo"><option value="">-- Chọn PO còn dư nợ --</option>${list.map((po) =>
        opt(po.id, `${po.id} · ${Q.supplierName?.(po.supplierId) || po.supplierId} · còn nợ ${fmtVND(purchasePayableRemaining(po))}`)).join('')}</select>`, true)
        + field('Số tiền thanh toán (VND) *', `<input class="inp right num" id="apfAmount" type="number" min="1" step="1">`)
        + field('Ngày thanh toán', `<input class="inp" id="apfDate" type="date" value="${today()}">`)
        + bankFields('apf') + entryField('apf', 'CHI')
        + field('Số tham chiếu / ghi chú', `<input class="inp" id="apfRef" placeholder="Mã giao dịch ngân hàng, ghi chú…">`, true);
    },
    collect() {
      const po = Q.purchaseOrder(val('apfPo')); if (!po) return { error: 'Vui lòng chọn đơn đặt hàng.' };
      const amount = Math.round(parseMoney(val('apfAmount')) || 0);
      const method = val('apfMethod') || 'BANK_TRANSFER';
      return { docId: po.id, amount, title: `Thanh toán NCC ${po.id} — ${fmtVND(amount)}`,
        payload: { poId: po.id, amount, method, bankId: method === 'BANK_TRANSFER' ? val('apfBank') : '', accountingEntryId: val('apfEntry'), date: val('apfDate') || today(), ref: val('apfRef').trim() } };
    },
    validate(p) {
      const po = Q.purchaseOrder(p.poId); if (!po) return 'Không tìm thấy đơn đặt hàng.';
      if (!(p.amount > 0)) return 'Số tiền phải lớn hơn 0.';
      const remain = purchasePayableRemaining(po);
      if (p.amount > remain + 0.5) return `Số tiền ${fmtVND(p.amount)} vượt dư nợ còn lại ${fmtVND(remain)}.`;
      return checkMoneySource(p);
    },
    describe: (p) => [['PO', p.poId], ['Số tiền', fmtVND(p.amount)], ['Hình thức', p.method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt'], ['Định khoản', typeof accountingEntryLabel === 'function' ? accountingEntryLabel(p.accountingEntryId) : p.accountingEntryId]],
    async apply(req) {
      const p = req.payload;
      const dup = (DB.supplierPayments || []).find((x) => x.approvalRequestId === req.id);
      if (dup) { await PurchaseAPI.syncCollections(['supplierPayments', 'purchaseOrders']); return `${dup.id} đã ghi nhận`; }
      try { await PurchaseAPI.ensureFresh?.(['purchaseOrders', 'supplierPayments'], { force: false }); } catch (_) {}
      const err = this.validate(p); if (err) throw new Error(err);
      const po = Q.purchaseOrder(p.poId);
      const bank = (DB.bankAccounts || []).find((b) => String(b.id) === String(p.bankId));
      DB.supplierPayments = DB.supplierPayments || [];
      const id = nextCode('TT-2026-', DB.supplierPayments);
      const oldPaid = num(po.paid);
      const payment = { id, poId: po.id, supplierId: po.supplierId, date: p.date, amount: p.amount,
        method: p.method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt', bankId: p.bankId || '', bankName: bank?.name || bank?.bankName || '', bankAccount: bank?.accountNumber || '',
        payerId: req.requestedBy, payerName: req.requestedByName, accountingEntryId: p.accountingEntryId, bankRef: p.ref || '', note: p.ref || '',
        createdBy: req.requestedBy, createdByName: req.requestedByName, approvalRequestId: req.id };
      po.paid = Math.round(oldPaid + p.amount);
      DB.supplierPayments.unshift(payment);
      try {
        await PurchaseAPI.syncCollections(['supplierPayments', 'purchaseOrders']);
        if (p.bankId && typeof AccountingBank !== 'undefined') {
          await AccountingBank.record({ bankId: p.bankId, type: 'OUT', date: p.date, amount: p.amount, note: `Thanh toán NCC ${po.id} · ${Q.supplierName?.(po.supplierId) || ''}`,
            sourceType: 'SUPPLIER_PAYMENT', sourceId: id, createdBy: req.requestedBy, accountingEntryId: p.accountingEntryId });
        }
      } catch (e) {
        po.paid = oldPaid; DB.supplierPayments = DB.supplierPayments.filter((x) => x.id !== id);
        try { await PurchaseAPI.syncCollections(['supplierPayments', 'purchaseOrders']); } catch (_) {}
        throw e;
      }
      return `${id} · ${fmtVND(p.amount)}`;
    },
  };

  /* ---- 3. Chi tiền (sổ thu-chi) ---- */
  FLOWS.CASH_OUT = {
    fields() {
      const cats = (DB.accountingSettings?.opexCategories || ['Khác']);
      return field('Số tiền chi (VND) *', `<input class="inp right num" id="apfAmount" type="number" min="1" step="1">`)
        + field('Ngày chi', `<input class="inp" id="apfDate" type="date" value="${today()}">`)
        + field('Nhóm chi phí', `<select class="inp" id="apfCategory">${cats.map((c) => opt(c, c)).join('')}</select>`)
        + bankFields('apf') + entryField('apf', 'CHI')
        + field('Nội dung chi *', `<input class="inp" id="apfRef" placeholder="Diễn giải khoản chi">`, true);
    },
    collect() {
      const amount = Math.round(parseMoney(val('apfAmount')) || 0);
      const note = val('apfRef').trim();
      if (!note) return { error: 'Vui lòng nhập nội dung chi.' };
      const method = val('apfMethod') || 'BANK_TRANSFER';
      return { docId: '', amount, title: `Chi tiền — ${note} — ${fmtVND(amount)}`,
        payload: { amount, method, bankId: method === 'BANK_TRANSFER' ? val('apfBank') : '', accountingEntryId: val('apfEntry'), date: val('apfDate') || today(), category: val('apfCategory'), note } };
    },
    validate(p) { if (!(p.amount > 0)) return 'Số tiền phải lớn hơn 0.'; return checkMoneySource(p); },
    describe: (p) => [['Số tiền', fmtVND(p.amount)], ['Nội dung', p.note], ['Nhóm', p.category], ['Hình thức', p.method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt']],
    async apply(req) {
      const p = req.payload;
      DB.cashTransactions = DB.cashTransactions || [];
      const dup = DB.cashTransactions.find((x) => x.approvalRequestId === req.id);
      if (dup) { await RestaurantQualityAPI.syncRestaurant(['cashTransactions']); return `${dup.id} đã ghi nhận`; }
      try { await RestaurantQualityAPI.ensureFresh(['cashTransactions', 'bankAccounts'], { force: false }); } catch (_) {}
      const err = this.validate(p); if (err) throw new Error(err);
      const row = { id: nextCode('SQ-2026-', DB.cashTransactions), type: 'CHI', date: p.date, amount: p.amount, accountingEntryId: p.accountingEntryId,
        category: p.category, note: p.note, method: p.method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt', bankId: p.bankId || '', createdBy: req.requestedBy, approvalRequestId: req.id };
      DB.cashTransactions.unshift(row);
      try {
        if (p.bankId) await AccountingBank.record({ bankId: p.bankId, type: 'OUT', date: p.date, amount: p.amount, note: p.note, sourceType: 'CASH_TX', sourceId: row.id, accountingEntryId: p.accountingEntryId });
        await RestaurantQualityAPI.syncRestaurant(['cashTransactions']);
      } catch (e) {
        DB.cashTransactions = DB.cashTransactions.filter((x) => x.id !== row.id);
        if (p.bankId) { try { await AccountingBank.removeBySource('CASH_TX', row.id); } catch (_) {} }
        throw e;
      }
      return `${row.id} · chi ${fmtVND(p.amount)}`;
    },
  };

  /* ---- 4. Giảm giá đơn hàng bán ---- */
  const DISCOUNTABLE = ['dh_cho_xu_ly', 'dh_cho_san_xuat', 'dh_dang_san_xuat', 'dh_hoan_thanh', 'dh_cho_van_chuyen', 'dh_dang_giao'];
  FLOWS.DISCOUNT = {
    fields() {
      const list = (DB.orders || []).filter((o) => DISCOUNTABLE.includes(o.status) && !o.discountRequestId);
      return field('Đơn hàng bán *', `<select class="inp" id="apfOrder"><option value="">-- Chọn đơn hàng --</option>${list.map((o) =>
        opt(o.id, `${o.id} · ${Q.customerName?.(o.customerId) || ''} · ${fmtVND(o.total)}`)).join('')}</select>`, true)
        + field('Mức giảm (% trên tiền hàng) *', `<input class="inp right num" id="apfPct" type="number" min="0.1" max="100" step="0.1">`)
        + field('Lý do giảm giá *', `<input class="inp" id="apfReason">`);
    },
    collect() {
      const o = Q.order(val('apfOrder')); if (!o) return { error: 'Vui lòng chọn đơn hàng.' };
      const pct = Number(val('apfPct')); const reason = val('apfReason').trim();
      if (!reason) return { error: 'Vui lòng nhập lý do giảm giá.' };
      return { docId: o.id, amount: pct, title: `Giảm giá ${pct}% — đơn ${o.id}`, payload: { orderId: o.id, pct, reason } };
    },
    newTotals(o, pct) {
      const sub0 = num(o.subtotalBeforeDiscount ?? o.subtotal); const vat0 = num(o.vatBeforeDiscount ?? o.vat);
      const disc = Math.round(sub0 * pct / 100); const vat1 = Math.round(vat0 * (100 - pct) / 100);
      return { sub0, vat0, disc, vat1, sub1: sub0 - disc, total: (sub0 - disc) + vat1 + num(o.shippingFee) + num(o.otherCost) };
    },
    validate(p, req) {
      const o = Q.order(p.orderId); if (!o) return 'Không tìm thấy đơn hàng.';
      if (o.discountRequestId && o.discountRequestId !== req?.id) return `Đơn ${o.id} đã được áp dụng giảm giá (${o.discountRequestId}).`;
      if (!DISCOUNTABLE.includes(o.status) && o.discountRequestId !== req?.id) return `Đơn ${o.id} ở trạng thái "${SalesCRM?.orderStatus?.[o.status]?.label || o.status}" — không thể giảm giá.`;
      if (!(p.pct > 0 && p.pct <= 100)) return 'Mức giảm phải trong khoảng (0, 100]%.';
      const t = this.newTotals(o, p.pct);
      if (t.total <= 0) return 'Tổng đơn sau giảm giá phải lớn hơn 0.';
      const paid = typeof SalesCRM !== 'undefined' ? SalesCRM.paidOfOrder(o.id) : num(o.paid);
      if (t.total < paid) return `Tổng sau giảm (${fmtVND(t.total)}) thấp hơn số khách đã thanh toán (${fmtVND(paid)}).`;
      return '';
    },
    describe: (p) => [['Đơn hàng', p.orderId], ['Mức giảm', `${p.pct}%`], ['Lý do', p.reason]],
    async apply(req) {
      const p = req.payload; const o = Q.order(p.orderId);
      if (o && o.discountRequestId === req.id) { await CRMAPI.syncCollections(['orders']); return `${o.id} đã áp dụng giảm ${p.pct}%`; }
      const err = this.validate(p, req); if (err) throw new Error(err);
      const snap = clone(o); const t = this.newTotals(o, p.pct);
      Object.assign(o, { subtotalBeforeDiscount: t.sub0, vatBeforeDiscount: t.vat0, totalBeforeDiscount: num(o.total),
        discountPct: p.pct, discount: t.disc, subtotal: t.sub1, vat: t.vat1, total: t.total,
        discountRequestId: req.id, discountReason: p.reason, discountApprovedAt: nowIso() });
      try { await CRMAPI.syncCollections(['orders']); } catch (e) { restore(o, snap); throw e; }
      return `${o.id}: giảm ${p.pct}% (${fmtVND(t.disc)}) · tổng mới ${fmtVND(t.total)}`;
    },
  };

  /* ---- 5. Hủy đơn hàng bán ---- */
  FLOWS.ORDER_CANCEL = {
    fields() {
      const list = (DB.orders || []).filter((o) => !PAID_LOCK.includes(o.status));
      return field('Đơn hàng cần hủy *', `<select class="inp" id="apfOrder"><option value="">-- Chọn đơn hàng --</option>${list.map((o) =>
        opt(o.id, `${o.id} · ${Q.customerName?.(o.customerId) || ''} · ${fmtVND(o.total)}`)).join('')}</select>`, true)
        + field('Lý do hủy *', `<input class="inp" id="apfReason">`, true);
    },
    collect() {
      const o = Q.order(val('apfOrder')); if (!o) return { error: 'Vui lòng chọn đơn hàng.' };
      const reason = val('apfReason').trim(); if (!reason) return { error: 'Vui lòng nhập lý do hủy.' };
      return { docId: o.id, amount: num(o.total), title: `Hủy đơn hàng ${o.id}`, payload: { orderId: o.id, reason } };
    },
    blockers(o) {
      if (typeof SalesCRM !== 'undefined' && SalesCRM.hasSalesIssue(o.id)) return `Đơn ${o.id} đã xuất kho bán hàng — dùng luồng Đổi trả hàng.`;
      const paid = typeof SalesCRM !== 'undefined' ? SalesCRM.paidOfOrder(o.id) : 0;
      if (paid > 0) return `Đơn ${o.id} khách đã thanh toán ${fmtVND(paid)} — cần hoàn tiền trước khi hủy.`;
      if (o.logisticsDeliveryId) return `Đơn ${o.id} đã có chuyến giao hàng (${o.logisticsDeliveryId}) — xử lý Logistics trước.`;
      const lsx = (DB.productionOrders || []).filter((x) => x.orderId === o.id && (x.approvedAt || x.status !== 'lsx_cho_san_xuat'));
      if (lsx.length) return `Đơn ${o.id} đã có lệnh sản xuất được duyệt/đang chạy (${lsx[0].id}) — xử lý lệnh sản xuất trước.`;
      const plans = (DB.productionPlans || []).filter((x) => x.source === 'SALES_ORDER' && x.sourceOrderId === o.id && !['CANCELLED', 'WAITING_APPROVAL', 'WAITING_SALES_APPROVAL'].includes(x.status));
      if (plans.length) return `Đơn ${o.id} đã có kế hoạch sản xuất được duyệt (${plans[0].id}) — xử lý kế hoạch trước.`;
      return '';
    },
    validate(p, req) {
      const o = Q.order(p.orderId); if (!o) return 'Không tìm thấy đơn hàng.';
      if (o.status === 'dh_da_huy' && o.cancelRequestId === req?.id) return '';
      if (PAID_LOCK.includes(o.status)) return `Đơn ${o.id} đang ở trạng thái "${SalesCRM?.orderStatus?.[o.status]?.label || o.status}" — không thể hủy.`;
      return this.blockers(o);
    },
    describe: (p) => [['Đơn hàng', p.orderId], ['Lý do', p.reason]],
    async apply(req) {
      const p = req.payload; const o = Q.order(p.orderId);
      const persist = async () => {
        await CRMAPI.syncCollections(['orders']);
        await InventoryAPI.syncCollections(['goodsIssues', 'inventory']);
        await ProductionAPI.persistCollections(['productionPlans']);
      };
      if (o && o.status === 'dh_da_huy' && o.cancelRequestId === req.id) { await persist(); return `${o.id} đã hủy`; }
      const err = this.validate(p, req); if (err) throw new Error(err);
      SalesCRM.releaseOrderReservation(o);
      (DB.goodsIssues || []).filter((g) => g.type === 'SALES_ISSUE' && g.status === 'PENDING_CONFIRMATION' && (g.orderId === o.id || g.refDoc === o.id))
        .forEach((g) => { g.status = 'CANCELLED'; g.cancelledAt = nowIso(); g.cancelReason = `Hủy đơn ${o.id}`; });
      (DB.productionPlans || []).filter((x) => x.source === 'SALES_ORDER' && x.sourceOrderId === o.id && ['WAITING_APPROVAL', 'WAITING_SALES_APPROVAL'].includes(x.status))
        .forEach((x) => { x.status = 'CANCELLED'; x.cancelledAt = nowIso(); });
      const pend = ApprovalEngine.pendingFor('SALES_ORDER', o.id); if (pend) ApprovalEngine.cancel(pend.id, 'Đơn hàng bị hủy');
      Object.assign(o, { status: 'dh_da_huy', reservations: [], pendingIssueId: '', cancelReason: p.reason, cancelledAt: nowIso(), cancelledBy: req.requestedBy, cancelRequestId: req.id });
      await persist();
      return `${o.id} đã hủy · tồn kho giữ chỗ đã được nhả`;
    },
  };

  /* ---- 6. Xuất kho đặc biệt ---- */
  function stockRows(whId, productId) {
    return (DB.inventory || []).filter((r) => r.warehouseId === whId && (!productId || r.productId === productId)
      && num(r.qtyAvailable ?? r.qtyOnHand) > 0 && inventoryRowIsUsableForIssue(r)).sort(sortIssueRowsFefoFifo);
  }
  FLOWS.SPECIAL_ISSUE = {
    productOptions(whId) {
      const ids = [...new Set(stockRows(whId).map((r) => r.productId))];
      return `<option value="">-- Chọn hàng xuất --</option>${ids.map((id) => opt(id, `${itemName(id)} (${id})`)).join('')}`;
    },
    fields() {
      const whs = (DB.warehouses || []).filter((w) => w.status !== 'inactive');
      const first = whs[0]?.id || '';
      return field('Khu xuất kho *', `<select class="inp" id="apfWh">${whs.map((w) => opt(w.id, w.name)).join('')}</select>`)
        + field('Hàng xuất *', `<select class="inp" id="apfProd">${this.productOptions(first)}</select>`)
        + field('Số lượng xuất *', `<input class="inp right num" id="apfQty" type="number" min="0.01" step="0.01">`)
        + field('Chứng từ tham chiếu', `<input class="inp" id="apfRef">`)
        + field('Lý do xuất đặc biệt *', `<input class="inp" id="apfReason">`, true);
    },
    collect() {
      const warehouseId = val('apfWh'), productId = val('apfProd'), qty = Number(val('apfQty')), reason = val('apfReason').trim();
      if (!warehouseId || !productId) return { error: 'Vui lòng chọn khu xuất và hàng xuất.' };
      if (!reason) return { error: 'Vui lòng nhập lý do xuất đặc biệt.' };
      return { docId: val('apfRef').trim(), amount: Math.round(qty * matPrice(productId)), title: `Xuất kho đặc biệt — ${itemName(productId)} × ${qty}`,
        payload: { warehouseId, productId, qty, reason, ref: val('apfRef').trim() } };
    },
    validate(p) {
      if (!(p.qty > 0)) return 'Số lượng phải lớn hơn 0.';
      const total = stockRows(p.warehouseId, p.productId).reduce((s, r) => s + num(r.qtyAvailable ?? r.qtyOnHand), 0);
      if (total < p.qty) return `${itemName(p.productId)}: tồn khả dụng chỉ còn ${fmtN(total)}, cần xuất ${fmtN(p.qty)}.`;
      return '';
    },
    describe: (p) => [['Khu xuất', Q.warehouseName?.(p.warehouseId) || p.warehouseId], ['Hàng', `${itemName(p.productId)} × ${fmtN(p.qty)}`], ['Lý do', p.reason]],
    async apply(req) {
      const p = req.payload;
      const persist = () => InventoryAPI.syncCollections(['materials', 'goodsIssues', 'inventory', 'inventoryTransactions']);
      DB.goodsIssues = DB.goodsIssues || [];
      const dup = DB.goodsIssues.find((g) => g.approvalRequestId === req.id);
      if (dup) { await persist(); return `${dup.id} đã xuất kho`; }
      const err = this.validate(p); if (err) throw new Error(err);
      const issueId = nextCode('PX-2026-', DB.goodsIssues);
      const note = `Xuất kho đặc biệt (${req.id}): ${p.reason}`;
      let remain = p.qty; const items = [];
      for (const row of stockRows(p.warehouseId, p.productId)) {
        if (remain <= 0) break;
        const take = Math.min(remain, num(row.qtyAvailable ?? row.qtyOnHand)); if (!take) continue;
        const posted = InventoryService.apply({ productId: row.productId, warehouseId: p.warehouseId, locationId: row.locationId, lotId: row.lotId, quantity: take,
          type: 'ADJUSTMENT_OUT', refType: 'SPECIAL_ISSUE', refId: p.ref || issueId, note, userId: req.requestedBy || DB.currentUser?.id });
        if (!posted.ok) throw new Error(posted.message);
        items.push({ productId: row.productId, lotId: row.lotId, qty: take, locationId: row.locationId, unit: row.unit });
        remain -= take;
      }
      DB.goodsIssues.unshift({ id: issueId, type: 'ADJUSTMENT_OUT', warehouseId: p.warehouseId, refDoc: p.ref || req.id, date: today(), status: 'COMPLETED',
        createdBy: req.requestedBy, note, items, specialIssue: true, approvalRequestId: req.id });
      await persist();
      return `${issueId} · ${itemName(p.productId)} × ${fmtN(p.qty)}`;
    },
  };

  /* ---- 7. Sản xuất ngoài định mức (cấp thêm NVL ngoài BOM) ---- */
  const PO_DONE = /huy|cancel|nhap_kho|hoan_thanh/i;
  FLOWS.OVER_NORM_PRODUCTION = {
    fields() {
      const lsx = (DB.productionOrders || []).filter((x) => !PO_DONE.test(String(x.status || '')));
      return field('Lệnh sản xuất *', `<select class="inp" id="apfLsx"><option value="">-- Chọn LSX --</option>${lsx.map((x) =>
        opt(x.id, `${x.id} · ${Q.product?.(x.productId)?.name || x.productName || ''}`)).join('')}</select>`, true)
        + field('Nguyên liệu cấp thêm *', `<select class="inp" id="apfMat"><option value="">-- Chọn NVL --</option>${(DB.materials || []).map((m) => opt(m.id, `${m.name} (${m.id})`)).join('')}</select>`)
        + field('Số lượng cấp thêm *', `<input class="inp right num" id="apfQty" type="number" min="0.01" step="0.01">`)
        + field('Lý do vượt định mức *', `<input class="inp" id="apfReason">`, true);
    },
    collect() {
      const lsx = (DB.productionOrders || []).find((x) => x.id === val('apfLsx')); const mid = val('apfMat'); const qty = Number(val('apfQty')); const reason = val('apfReason').trim();
      if (!lsx || !mid) return { error: 'Vui lòng chọn lệnh sản xuất và nguyên liệu.' };
      if (!reason) return { error: 'Vui lòng nhập lý do vượt định mức.' };
      return { docId: lsx.id, amount: Math.round(qty * matPrice(mid)), title: `Ngoài định mức ${lsx.id} — ${itemName(mid)} × ${qty}`, payload: { productionOrderId: lsx.id, materialId: mid, qty, reason } };
    },
    validate(p) {
      const lsx = (DB.productionOrders || []).find((x) => x.id === p.productionOrderId); if (!lsx) return 'Không tìm thấy lệnh sản xuất.';
      if (PO_DONE.test(String(lsx.status || ''))) return `${lsx.id} đã kết thúc/hủy — không thể cấp thêm NVL.`;
      if (!Q.material(p.materialId)) return 'Không tìm thấy nguyên liệu.';
      if (!(p.qty > 0)) return 'Số lượng phải lớn hơn 0.';
      return '';
    },
    describe: (p) => [['LSX', p.productionOrderId], ['NVL', `${itemName(p.materialId)} × ${fmtN(p.qty)}`], ['Lý do', p.reason]],
    async apply(req) {
      const p = req.payload;
      const persist = () => ProductionAPI.persistCollections(['productionMaterialRequests', 'productionOrders']);
      DB.productionMaterialRequests = DB.productionMaterialRequests || [];
      const dup = DB.productionMaterialRequests.find((r) => r.approvalRequestId === req.id);
      if (dup) { await persist(); return `${dup.id} đã tạo`; }
      const err = this.validate(p); if (err) throw new Error(err);
      const lsx = DB.productionOrders.find((x) => x.id === p.productionOrderId); const m = Q.material(p.materialId);
      const id = nextCode('YCNVL-2026-', DB.productionMaterialRequests);
      // planId để trống có chủ đích: pf-mr-issue sẽ đặt lại trạng thái kế hoạch nếu tìm thấy plan.
      DB.productionMaterialRequests.unshift({ id, productionOrderId: lsx.id, planId: '', refPlanId: lsx.planId || '', date: today(),
        items: [{ materialId: m.id, qty: p.qty, unit: m.unit, note: 'Ngoài định mức' }], status: 'APPROVED',
        note: `NVL ngoài định mức (${req.id}): ${p.reason}`, createdBy: req.requestedBy, createdByName: req.requestedByName, createdAt: nowIso(),
        source: 'OVER_NORM_APPROVAL', overNorm: true, approvalRequestId: req.id });
      lsx.overNormRequests = [...(lsx.overNormRequests || []), { requestId: id, approvalRequestId: req.id, materialId: m.id, qty: p.qty, reason: p.reason, at: nowIso() }];
      await persist();
      return `${id} · Kho có thể xuất ${fmtN(p.qty)} ${m.unit || ''} ${m.name}`;
    },
  };

  /* ---- 8. Đổi trả hàng ---- */
  FLOWS.RETURN_EXCHANGE = {
    itemOptions(orderId) {
      const o = Q.order(orderId);
      return `<option value="">-- Chọn sản phẩm --</option>${(o?.items || []).map((it) => opt(it.productId, `${it.name || itemName(it.productId)} (đã giao ${fmtN(it.qty)})`)).join('')}`;
    },
    fields() {
      const list = (DB.orders || []).filter((o) => ['dh_da_giao', 'dh_hoan_tat'].includes(o.status));
      return field('Đơn hàng đã giao *', `<select class="inp" id="apfOrder"><option value="">-- Chọn đơn hàng --</option>${list.map((o) =>
        opt(o.id, `${o.id} · ${Q.customerName?.(o.customerId) || ''}`)).join('')}</select>`)
        + field('Hình thức *', `<select class="inp" id="apfMode"><option value="RETURN">Trả hàng</option><option value="EXCHANGE">Đổi hàng</option></select>`)
        + field('Sản phẩm *', `<select class="inp" id="apfProd">${this.itemOptions('')}</select>`)
        + field('Số lượng *', `<input class="inp right num" id="apfQty" type="number" min="0.01" step="0.01">`)
        + field('Lý do đổi trả *', `<input class="inp" id="apfReason">`, true);
    },
    returnedQty(o, pid) { return (o.returnedItems || []).filter((r) => r.productId === pid).reduce((s, r) => s + num(r.qty), 0); },
    collect() {
      const o = Q.order(val('apfOrder')); const pid = val('apfProd'); const qty = Number(val('apfQty')); const reason = val('apfReason').trim();
      if (!o || !pid) return { error: 'Vui lòng chọn đơn hàng và sản phẩm.' };
      if (!reason) return { error: 'Vui lòng nhập lý do đổi trả.' };
      const it = (o.items || []).find((x) => x.productId === pid); const unitPrice = it && num(it.qty) ? num(it.amount) / num(it.qty) : 0;
      const mode = val('apfMode') || 'RETURN';
      return { docId: o.id, amount: Math.round(qty * unitPrice), title: `${mode === 'EXCHANGE' ? 'Đổi' : 'Trả'} hàng ${o.id} — ${it?.name || pid} × ${qty}`, payload: { orderId: o.id, productId: pid, qty, mode, reason } };
    },
    validate(p, req) {
      const o = Q.order(p.orderId); if (!o) return 'Không tìm thấy đơn hàng.';
      if ((o.returnExchanges || []).some((x) => x.requestId === req?.id)) return '';
      if (!['dh_da_giao', 'dh_hoan_tat'].includes(o.status)) return `Đơn ${o.id} chưa giao — chỉ đơn đã giao mới đổi trả được.`;
      const it = (o.items || []).find((x) => x.productId === p.productId); if (!it) return 'Sản phẩm không thuộc đơn hàng.';
      if (!(p.qty > 0)) return 'Số lượng phải lớn hơn 0.';
      const left = num(it.qty) - this.returnedQty(o, p.productId);
      if (p.qty > left + 0.0001) return `Số lượng trả (${fmtN(p.qty)}) vượt số còn trả được (${fmtN(left)}).`;
      if (!(DB.warehouses || []).find((w) => w.type === 'RETURNED' && w.status !== 'inactive')) return 'Chưa khai báo Kho Hàng trả về.';
      return '';
    },
    describe: (p) => [['Đơn hàng', p.orderId], ['Hình thức', p.mode === 'EXCHANGE' ? 'Đổi hàng' : 'Trả hàng'], ['Sản phẩm', `${itemName(p.productId)} × ${fmtN(p.qty)}`], ['Lý do', p.reason]],
    async apply(req) {
      const p = req.payload; const o = Q.order(p.orderId);
      const persist = async () => {
        await InventoryAPI.syncCollections(['goodsReceipts', 'inventoryLots', 'inventory', 'inventoryTransactions']);
        await CRMAPI.syncCollections(['orders']);
      };
      if (o && (o.returnExchanges || []).some((x) => x.requestId === req.id)) { await persist(); return `${o.id} đã ghi nhận đổi trả`; }
      const err = this.validate(p, req); if (err) throw new Error(err);
      const it = o.items.find((x) => x.productId === p.productId);
      const wh = DB.warehouses.find((w) => w.type === 'RETURNED' && w.status !== 'inactive');
      const loc = (DB.warehouseLocations || []).find((l) => l.warehouseId === wh.id && l.status !== 'inactive');
      if (!loc) throw new Error('Kho Hàng trả về chưa có vị trí lưu trữ.');
      DB.goodsReceipts = DB.goodsReceipts || []; DB.inventory = DB.inventory || []; DB.inventoryLots = DB.inventoryLots || []; DB.inventoryTransactions = DB.inventoryTransactions || [];
      const unit = it.unit || Q.product(p.productId)?.unit || '';
      const receiptId = nextCode('PNTR-2026-', DB.goodsReceipts);
      const lot = { id: nextCode('LOT-', DB.inventoryLots), lotNumber: `RET-${o.id}-${p.productId}-${receiptId.split('-').pop()}`, productId: p.productId, salesOrderId: o.id, mfgDate: today(), expiryDate: '', qcStatus: 'RETURNED', status: 'active', createdAt: nowIso() };
      DB.inventoryLots.unshift(lot);
      DB.inventory.unshift({ productId: p.productId, warehouseId: wh.id, locationId: loc.id, lotId: lot.id, qtyOnHand: p.qty, qtyPending: 0, qtyRejected: 0, qtyReserved: 0, qtyAvailable: 0, unit, sourceType: 'SALES_RETURN', sourceId: o.id, lastUpdated: nowIso() });
      DB.inventoryTransactions.unshift({ id: nextCode('TX-', DB.inventoryTransactions), transactionNumber: receiptId, type: 'SALES_RETURN_RECEIPT', productId: p.productId, warehouseId: wh.id, locationId: loc.id, lotId: lot.id, qty: p.qty, qtyBefore: 0, qtyAfter: p.qty, refType: 'SALES_ORDER', refId: o.id, userId: req.requestedBy, date: today(), note: `${p.mode === 'EXCHANGE' ? 'Đổi' : 'Trả'} hàng ${o.id} (${req.id}): ${p.reason}` });
      DB.goodsReceipts.unshift({ id: receiptId, type: 'SALES_RETURN_RECEIPT', salesOrderId: o.id, refDoc: o.id, date: today(), receivedBy: req.requestedBy, warehouse: wh.name, warehouseId: wh.id, locationId: loc.id, location: loc.name, status: 'RECEIVED', note: `${p.reason} (${req.id})`, approvalRequestId: req.id,
        items: [{ materialId: p.productId, productId: p.productId, name: it.name || itemName(p.productId), unit, qty: p.qty, lotId: lot.id, lotNumber: lot.lotNumber, locationId: loc.id }] });
      const map = new Map(); [...(o.returnedItems || []), { productId: p.productId, name: it.name || p.productId, unit, qty: p.qty }].forEach((r) => {
        const cur = map.get(r.productId) || { productId: r.productId, name: r.name || r.productId, unit: r.unit || '', qty: 0 };
        cur.qty = Math.round((num(cur.qty) + num(r.qty)) * 1000) / 1000; map.set(r.productId, cur); });
      o.returnedItems = [...map.values()];
      o.returnReceiptIds = [...new Set([...(o.returnReceiptIds || []), receiptId])]; o.returnReceiptId = receiptId;
      o.returnExchanges = [...(o.returnExchanges || []), { requestId: req.id, mode: p.mode, productId: p.productId, qty: p.qty, reason: p.reason, receiptId, at: nowIso() }];
      await persist();
      return `${receiptId} · ${itemName(p.productId)} × ${fmtN(p.qty)} nhập Kho Hàng trả về${p.mode === 'EXCHANGE' ? ' · cần lập đơn giao hàng thay thế' : ''}`;
    },
  };

  /* ---------------------------------------------- chạy áp dụng sau khi duyệt xong */
  async function runApply(req) {
    const f = FLOWS[req.docType]; if (!f || !req.payload) return;
    if (req.applied?.ok) return;
    try {
      const summary = await f.apply(req);
      req.applied = { ok: true, at: nowIso(), summary: summary || '' }; delete req.applyError;
      Toast.ok('Đã áp dụng vào dữ liệu', summary || req.title);
    } catch (err) {
      req.applied = { ok: false, at: nowIso() }; req.applyError = String(err?.message || err);
      console.error('[ApprovalFlows] Áp dụng thất bại', req.id, err);
      Toast.err('Duyệt xong nhưng chưa áp dụng được', req.applyError);
    }
    try { await ApprovalsAPI.syncCollections(['requests']); } catch (_) { Toast.err('Chưa lưu được trạng thái yêu cầu', 'Kiểm tra kết nối rồi bấm Áp dụng lại.'); }
    try { render(); } catch (_) {}
  }

  Object.keys(FLOWS).forEach((type) => {
    ApprovalEngine.registerHandler(type, {
      onApproved: (req) => { runApply(req); },
      onRejected: (req) => { try { FLOWS[type].onRejected?.(req); } catch (e) { console.error(e); } },
    });
  });

  // Chặn duyệt cấp cuối nếu dữ liệu không còn hợp lệ (hết tồn, vượt dư nợ…) để không tạo request "đã duyệt" mà không áp dụng được.
  const originalApprove = ApprovalEngine.approve.bind(ApprovalEngine);
  ApprovalEngine.approve = function (requestId, opts) {
    const req = (DB.approvalRequests || []).find((r) => r.id === requestId);
    const f = req && FLOWS[req.docType];
    if (f && req.status === 'PENDING' && req.payload) {
      const isFinal = !(req.levels || []).some((l) => l.level > req.currentLevel);
      if (isFinal) { const err = f.validate(req.payload, req); if (err) { Toast.err('Không thể duyệt', err); return false; } }
    }
    return originalApprove(requestId, opts);
  };

  /* --------------------------------------------------------------- FORM TẠO MỚI */
  const GENERIC_FIELDS = `${field('Mã tham chiếu', '<input class="inp" id="apNewDocId" placeholder="VD: YCM-2026-0046, DH-2026-0088…">')}
    ${field('Giá trị liên quan (VND)', '<input class="inp right num" id="apNewAmount" type="number" min="0" value="0">')}
    ${field('Tiêu đề', '<input class="inp" id="apNewTitle" placeholder="Để trống sẽ tự sinh">', true)}`;

  function renderFields() {
    const host = document.getElementById('apNewFields'); if (!host) return;
    const f = FLOWS[val('apNewType')];
    host.innerHTML = f ? f.fields() : GENERIC_FIELDS;
    syncBankVisibility();
  }
  function syncBankVisibility() {
    const m = document.getElementById('apfMethod'); const w = document.getElementById('apfBankWrap');
    if (m && w) w.style.display = m.value === 'BANK_TRANSFER' ? '' : 'none';
  }
  document.addEventListener('change', (e) => {
    const id = e.target?.id;
    if (id === 'apNewType') renderFields();
    else if (id === 'apfMethod') syncBankVisibility();
    else if (id === 'apfWh') { const s = document.getElementById('apfProd'); if (s) s.innerHTML = FLOWS.SPECIAL_ISSUE.productOptions(e.target.value); }
    else if (id === 'apfOrder' && document.getElementById('apNewType')?.value === 'RETURN_EXCHANGE') { const s = document.getElementById('apfProd'); if (s) s.innerHTML = FLOWS.RETURN_EXCHANGE.itemOptions(e.target.value); }
  });

  async function openForm() {
    ensureWorkflows();
    // Nạp dữ liệu nguồn mới nhất trước khi cho chọn chứng từ.
    const warm = [];
    try { if (typeof accountingEntriesEnsureFresh === 'function') warm.push(accountingEntriesEnsureFresh(false)); } catch (_) {}
    try { if (typeof PurchaseAPI !== 'undefined') warm.push(PurchaseAPI.ensureFresh(['purchaseOrders', 'supplierPayments'], { force: false })); } catch (_) {}
    try { if (typeof RestaurantQualityAPI !== 'undefined') warm.push(RestaurantQualityAPI.ensureFresh(['bankAccounts', 'cashTransactions'], { force: false })); } catch (_) {}
    await Promise.allSettled(warm);
    const types = APPROVAL_DOC_TYPE_LIST.map((dt) => `<option value="${dt}">${esc(APPROVAL_DOC_TYPES[dt].label)}</option>`).join('');
    Modal.open({
      title: 'Tạo yêu cầu phê duyệt',
      sub: 'Yêu cầu đi qua các cấp theo quy trình; chỉ khi duyệt xong hết các cấp mới áp dụng vào dữ liệu thật',
      size: 'lg',
      body: `<div class="form-grid cols-2">
        ${field('Loại chứng từ *', `<select class="inp" id="apNewType">${types}</select>`, true)}
        <div id="apNewFields" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:12px"></div>
        ${field('Ghi chú / lý do đề nghị', '<textarea class="inp" id="apNewNote" rows="2"></textarea>', true)}
      </div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="approval-new-save"><i class="fa-solid fa-paper-plane"></i>Gửi yêu cầu</button>`,
    });
    renderFields();
  }
  Actions['approval-new'] = () => { openForm(); };

  Actions['approval-new-save'] = async () => {
    // Không có ApprovalsAPI thì yêu cầu chỉ nằm trong bộ nhớ và MẤT khi tải lại trang -> chặn và báo rõ.
    if (typeof ApprovalsAPI === 'undefined' || typeof ApprovalsAPI.syncCollections !== 'function') {
      Toast.err('Không thể lưu yêu cầu', 'Chưa nạp js/api/approvals-api.js trong index.html nên yêu cầu sẽ mất khi tải lại trang.'); return;
    }
    const docType = val('apNewType'); const f = FLOWS[docType]; const note = val('apNewNote').trim();
    // Đọc form trước khi await (modal vẫn mở nhưng lấy sớm cho chắc).
    const c = f ? f.collect() : null;
    const generic = f ? null : { docId: val('apNewDocId').trim(), amount: Number(val('apNewAmount') || 0), title: val('apNewTitle').trim() };
    if (c && c.error) { Toast.err('Thiếu thông tin', c.error); return; }
    ensureWorkflows();
    // Nạp danh sách yêu cầu mới nhất từ server TRƯỚC khi sinh mã DUYET-xxxx: tránh trùng mã
    // (trùng mã làm ghi đè yêu cầu cũ) khi danh sách cục bộ chưa tải xong hoặc đã cũ.
    try { await ApprovalsAPI.bootstrap?.(); await ApprovalsAPI.ensureFresh(['requests', 'logs'], { force: true }); } catch (_) {}
    let { docId = '', amount = 0, title = '' } = c || generic; const payload = c ? c.payload : null;
    if (f) {
      const err = f.validate(payload); if (err) { Toast.err('Không thể tạo yêu cầu', err); return; }
      if (docId && (DB.approvalRequests || []).some((r) => r.status === 'PENDING' && r.docType === docType && r.docId === docId)) {
        Toast.err('Đã có yêu cầu đang chờ duyệt', `${docId} đã có yêu cầu ${docType} đang chờ duyệt.`); return;
      }
    } else {
      if (docId && docType === 'PR' && !Q.purchase(docId)) { Toast.err('Mã tham chiếu không tồn tại', `Không tìm thấy đề nghị mua hàng ${docId}.`); return; }
      if (docId && docType === 'SALES_ORDER' && !Q.order(docId)) { Toast.err('Mã tham chiếu không tồn tại', `Không tìm thấy đơn hàng ${docId}.`); return; }
    }
    const req = ApprovalEngine.create({ docType, docId, title, amount, note });
    if (!req) return;
    if (payload) req.payload = payload;
    const rollback = () => {
      DB.approvalRequests = (DB.approvalRequests || []).filter((r) => r.id !== req.id);
      DB.approvalLogs = (DB.approvalLogs || []).filter((l) => l.requestId !== req.id);
    };
    try {
      await persistApprovalServer(['approvalRequests', 'approvalLogs']);
      // Đọc lại từ server để chắc chắn yêu cầu đã nằm trong database (không tin vào việc "gọi lưu không lỗi").
      let saved = false;
      try { saved = await ApprovalsAPI.existsOnServer('requests', req.id); } catch (_) {}
      if (!saved) { await ApprovalsAPI.syncCollections(['requests', 'logs']); saved = await ApprovalsAPI.existsOnServer('requests', req.id); }
      if (!saved) throw new Error('Server chưa xác nhận đã lưu yêu cầu.');
    } catch (err) {
      rollback();
      Toast.err('Không lưu được yêu cầu duyệt', String(err?.message || err)); return;
    }
    Modal.close(); go('approvals', { tab: 'pending' });
    Toast.ok('Đã tạo yêu cầu phê duyệt', `${req.id} · Đã lưu vào database · Cấp duyệt đầu tiên: ${approvalRoleName(req.levels[0].role)}`);
  };

  Actions['approval-reapply'] = async (d) => {
    const req = (DB.approvalRequests || []).find((r) => r.id === d.id);
    if (!req || req.status !== 'APPROVED' || req.applied?.ok) return;
    const roleId = (Auth.currentRole() || {}).id;
    const allowed = ['ROLE_ADMIN', 'ROLE_DIRECTOR'].includes(roleId) || (req.levels || []).some((l) => l.role === roleId);
    if (!allowed) { Toast.err('Không có quyền', 'Chỉ người thuộc quy trình duyệt này hoặc Ban giám đốc mới áp dụng lại được.'); return; }
    Modal.close();
    await runApply(req);
  };

  /* ------------------------------------- hiển thị payload + kết quả trong chi tiết */
  const originalDetailBody = window.approvalDetailBody;
  if (typeof originalDetailBody === 'function') {
    window.approvalDetailBody = function (req) {
      let html = originalDetailBody(req);
      const f = FLOWS[req.docType];
      if (f && req.payload) {
        const rowsHtml = (f.describe(req.payload) || []).map(([k, v]) => `<div class="detail-row"><span class="muted">${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
        html += `<div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-file-lines"></i>Nội dung đề nghị</div><div class="detail-list">${rowsHtml}</div>`;
        if (req.status === 'APPROVED') {
          if (req.applied?.ok) html += `<div class="alert info" style="margin-top:12px;padding:11px 13px;border-radius:var(--r);background:var(--surface-2);border:1px solid var(--border)"><i class="fa-solid fa-circle-check" style="color:var(--green)"></i> Đã áp dụng vào dữ liệu: ${esc(req.applied.summary || '')}</div>`;
          else html += `<div class="alert" style="margin-top:12px;padding:11px 13px;border-radius:var(--r);background:var(--surface-2);border:1px solid var(--red)"><i class="fa-solid fa-triangle-exclamation" style="color:var(--red)"></i> Đã duyệt nhưng CHƯA áp dụng vào dữ liệu${req.applyError ? ': ' + esc(req.applyError) : ' (đang xử lý).'}
            ${req.applyError ? `<div style="margin-top:8px"><button class="btn btn-sm btn-primary" data-act="approval-reapply" data-id="${esc(req.id)}"><i class="fa-solid fa-rotate"></i>Áp dụng lại</button></div>` : ''}</div>`;
        }
      }
      return html;
    };
  }

  console.info('[ApprovalFlows] Đã nối 8 luồng phê duyệt: PO, Thanh toán, Chi tiền, Giảm giá, Hủy đơn, Xuất kho đặc biệt, SX ngoài định mức, Đổi trả.');
})();