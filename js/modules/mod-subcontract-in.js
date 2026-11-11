/* ============================================================================
 * GIA CÔNG CHO KHÁCH (thay thế hẳn luồng gia công ngoài cũ)
 * ----------------------------------------------------------------------------
 * Định nghĩa: công ty gia công GIÙM khách hàng. Công ty có đủ máy móc, nhân công,
 * quy trình nhưng KHÔNG có nguyên vật liệu — NVL do khách gửi tới.
 *
 * Luồng:  Nháp → Duyệt đơn → Nhận NVL khách gửi → QC NVL → Sản xuất
 *         → QC thành phẩm → Trả hàng (+ NVL dư) → Thu phí gia công → Hoàn tất
 *
 * - NVL khách gửi được theo dõi RIÊNG trong từng đơn, KHÔNG cộng vào tồn kho công ty.
 * - Phí gia công = SL thành phẩm đạt QC × đơn giá gia công + phụ phí.
 * - Dữ liệu lưu localStorage (cùng cách lưu của module gia công cũ): 'lenam_gc_customer_v1'.
 * - Đơn gia công ngoài (đối tác) của bản cũ không còn dùng và không hiển thị.
 * ========================================================================== */
(function () {
  'use strict';

  const KEY = 'lenam_gc_customer_v1';
  const EPS = 0.000001;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const r4 = (n) => Math.round(num(n) * 10000) / 10000;
  const today = () => (typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0, 10));
  const nowIso = () => new Date().toISOString();
  const who = () => DB.currentUser?.name || DB.currentUser?.id || '';
  const dt = (iso) => {
    if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return fmtDate(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  /* ------------------------------------------------------------------ dữ liệu */
  let hydrated = false;
  function orders() {
    if (!hydrated) {
      hydrated = true;
      try { const raw = JSON.parse(localStorage.getItem(KEY) || 'null'); DB.gcOrders = Array.isArray(raw?.orders) ? raw.orders : []; }
      catch (err) { console.warn('[GC] Không đọc được dữ liệu gia công:', err); DB.gcOrders = []; }
    }
    if (!Array.isArray(DB.gcOrders)) DB.gcOrders = [];
    return DB.gcOrders;
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ orders: DB.gcOrders || [] })); }
    catch (err) { console.warn('[GC] Không lưu được dữ liệu gia công:', err); Toast.err('Không lưu được dữ liệu', 'Bộ nhớ trình duyệt đầy hoặc bị chặn.'); }
  }
  const find = (id) => orders().find((o) => o.id === id);
  function log(o, text) { (o.history = o.history || []).push({ at: nowIso(), by: who(), text }); }
  function audit(o, action, desc) {
    try { SystemAPI?.audit?.({ module: 'SUBCONTRACTING', entityType: 'GC_ORDER', entityId: o.id, action, description: desc, newData: { status: o.status } }); } catch (_) {}
  }

  /* ------------------------------------------------------------------ trạng thái */
  const STATUS = {
    DRAFT: ['Nháp', 'slate'], WAIT_MATERIAL: ['Chờ nhận NVL', 'orange'], MATERIAL_QC: ['Chờ QC NVL', 'purple'],
    READY: ['Sẵn sàng sản xuất', 'blue'], IN_PRODUCTION: ['Đang sản xuất', 'blue'], WAIT_FQC: ['Chờ QC thành phẩm', 'purple'],
    READY_RETURN: ['Chờ trả hàng', 'orange'], RETURNED: ['Đã trả hàng', 'blue'], COMPLETED: ['Hoàn tất', 'green'], CANCELLED: ['Đã hủy', 'red'],
  };
  const statusHtml = (s) => { const x = STATUS[s] || [s, 'slate']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`; };
  const STEPS = ['Nhận đơn', 'Nhận NVL', 'QC NVL', 'Sản xuất', 'QC thành phẩm', 'Trả hàng', 'Thu phí'];
  const STEP_OF = { DRAFT: 0, WAIT_MATERIAL: 1, MATERIAL_QC: 2, READY: 3, IN_PRODUCTION: 3, WAIT_FQC: 4, READY_RETURN: 5, RETURNED: 6, COMPLETED: 7, CANCELLED: -1 };
  const isOpen = (o) => !['DRAFT', 'COMPLETED', 'CANCELLED'].includes(o.status);

  /* ------------------------------------------------------------------ tính toán */
  const mats = (o) => (o.materials = Array.isArray(o.materials) ? o.materials : []);
  const held = (m) => r4(num(m.qtyReceived) - num(m.qtyUsed) - num(m.qtyReturned));
  const heldTotal = (o) => mats(o).reduce((s, m) => s + Math.max(0, held(m)), 0);
  const pendingQc = (o) => mats(o).reduce((s, m) => s + num(m.qtyPendingQc), 0);
  const passTotal = (o) => (o.finalQcs || []).reduce((s, q) => s + num(q.passQty), 0);
  const returnedGood = (o) => (o.returns || []).reduce((s, r) => s + num(r.qty), 0);
  const feeTotal = (o) => (['WAIT_FQC', 'READY_RETURN', 'RETURNED', 'COMPLETED'].includes(o.status) && (o.finalQcs || []).length ? passTotal(o) : num(o.qty)) * num(o.feePerUnit) + num(o.extraFee);
  // Khoản thu do người ngoài kế toán ghi nhận ở trạng thái PENDING chưa tính vào "đã thu" cho tới khi kế toán xác nhận đã nhận tiền (giống thu tiền khách hàng).
  const isConfirmed = (p) => String(p.confirmStatus || 'CONFIRMED').toUpperCase() === 'CONFIRMED';
  const paidTotal = (o) => (o.payments || []).filter(isConfirmed).reduce((s, p) => s + num(p.amount), 0);
  const pendingPaid = (o) => (o.payments || []).filter((p) => !isConfirmed(p)).reduce((s, p) => s + num(p.amount), 0);
  const debtOf = (o) => Math.max(0, Math.round(feeTotal(o) - paidTotal(o)));
  const collectable = (o) => Math.max(0, debtOf(o) - Math.round(pendingPaid(o)));
  const canConfirmMoney = () => typeof Auth === 'undefined' || Auth.hasPermission('ACCOUNTING_OPERATE');
  function maybeComplete(o) {
    if (o.status === 'RETURNED' && debtOf(o) <= 0 && heldTotal(o) <= EPS && (paidTotal(o) > 0 || feeTotal(o) <= 0)) {
      o.status = 'COMPLETED'; o.completedAt = nowIso(); log(o, 'Hoàn tất đơn gia công (đã thu đủ phí, đã trả hết hàng và NVL).');
    }
  }
  const daysLeft = (o) => (o.dueDate ? Math.round((new Date(o.dueDate + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000) : null);
  const nearDays = () => (typeof lsxNearDeadlineDays === 'function' ? lsxNearDeadlineDays() : 3);
  function dueHtml(o) {
    if (!o.dueDate) return '—';
    const d = daysLeft(o); let note = '';
    if (isOpen(o) && d !== null) note = d < 0 ? `<div class="cell-sub" style="color:var(--red);font-weight:600">Trễ ${-d} ngày</div>` : d <= nearDays() ? `<div class="cell-sub" style="color:var(--orange);font-weight:600">Còn ${d} ngày</div>` : '';
    return `<span class="num">${fmtDate(o.dueDate)}</span>${note}`;
  }
  const custName = (o) => o.customerName || (o.customerId ? Q.customerName(o.customerId) : '—');

  /* ------------------------------------------------------------------ danh mục dùng chung: ĐVT (chỉ chọn) · công đoạn · lệnh sản xuất */
  const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
  const money = (v) => (typeof parseMoney === 'function' ? parseMoney(v) : num(String(v || '').replace(/[^\d.-]/g, '')));
  const DEFAULT_UNITS = ['Kg', 'Gram', 'Tấn', 'Lít', 'Cái', 'Hộp', 'Gói', 'Túi', 'Bao', 'Thùng', 'Chai', 'Khay', 'Bịch'];
  function unitList(extra = []) {
    const seen = new Map();
    [...DEFAULT_UNITS, ...(DB.products || []).map((x) => x.unit), ...(DB.materials || []).map((x) => x.unit), ...[].concat(extra)]
      .forEach((u) => { const t = String(u || '').trim(); if (t && !seen.has(norm(t))) seen.set(norm(t), t); });
    return [...seen.values()];
  }
  // ĐVT chỉ cần chọn (không gõ tìm) → data-no-search
  const unitSelect = (cls, value, id = '') => `<select class="inp ${cls}" ${id ? `id="${id}"` : ''} data-no-search="1"><option value="">— Chọn ĐVT —</option>${unitList(value).map((u) => `<option value="${esc(u)}" ${norm(u) === norm(value) ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>`;
  function setUnit(selEl, unit) {
    if (!selEl || !unit) return;
    if (![...selEl.options].some((op) => norm(op.value) === norm(unit))) selEl.insertAdjacentHTML('beforeend', `<option value="${esc(unit)}">${esc(unit)}</option>`);
    const hit = [...selEl.options].find((op) => norm(op.value) === norm(unit)); if (hit) selEl.value = hit.value;
  }

  const stageCatalog = () => {
    const skip = /hoàn thành|QC\s*[—–-]\s*ATTP/i, seen = new Set(), out = [];
    const add = (id, name) => { name = String(name || '').trim(); id = String(id || name).trim(); if (!name || skip.test(name) || seen.has(id)) return; seen.add(id); out.push({ id, name }); };
    (DB.operations || []).forEach((op) => add(op.id, op.name || op.workshop));
    if (!out.length) (DB.stageNames || []).forEach((n) => add(n, n));
    return out;
  };
  function stagePickerHtml(selected = []) {
    const cat = stageCatalog(), chosen = new Map((selected || []).map((x) => [String(x.operationId), x]));
    const extra = (selected || []).filter((x) => !cat.some((c) => c.id === String(x.operationId))).map((x) => ({ id: String(x.operationId), name: x.name || x.operationId }));
    const item = (c) => `<label class="gc-stage-item ${chosen.has(c.id) ? 'is-on' : ''}" data-q="${esc(norm(c.name))}"><input type="checkbox" class="gc-stage-cb" value="${esc(c.id)}" data-name="${esc(c.name)}" ${chosen.has(c.id) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`;
    return `<div class="gc-stage-picker" id="gcStagePicker">
      <div class="gc-stage-tools"><input class="inp" id="gcStageSearch" type="search" placeholder="Gõ để tìm công đoạn…" autocomplete="off"><button type="button" class="btn btn-sm" data-act="gc-stage-all">Chọn tất cả</button><button type="button" class="btn btn-sm" data-act="gc-stage-none">Bỏ chọn</button></div>
      <div class="gc-stage-list" id="gcStageList">${[...cat, ...extra].map(item).join('') || '<div class="cell-sub">Chưa có danh mục công đoạn — nhập công đoạn mới bên dưới.</div>'}</div>
      <div class="gc-stage-add"><input class="inp" id="gcStageCustom" placeholder="Công đoạn khác (nhập tên mới)…" autocomplete="off"><button type="button" class="btn btn-sm" data-act="gc-stage-add"><i class="fa-solid fa-plus"></i>Thêm</button></div>
      <div class="cell-sub gc-stage-count" id="gcStageCount"></div></div>`;
  }
  const readStages = () => [...document.querySelectorAll('#gcStagePicker .gc-stage-cb:checked')].map((cb) => ({ operationId: cb.value, name: cb.dataset.name || cb.value }));
  function stageCount() {
    const n = readStages().length, el = document.getElementById('gcStageCount');
    if (el) el.textContent = n ? `Đã chọn ${n} công đoạn — công đoạn QC thành phẩm và Hoàn thành tự động được thêm ở cuối lệnh sản xuất.` : 'Chưa chọn công đoạn nào.';
    document.querySelectorAll('#gcStagePicker .gc-stage-item').forEach((l) => l.classList.toggle('is-on', !!l.querySelector('input')?.checked));
  }
  document.addEventListener('input', (e) => {
    if (e.target?.id !== 'gcStageSearch') return;
    const q = norm(e.target.value);
    document.querySelectorAll('#gcStageList .gc-stage-item').forEach((l) => { l.hidden = !!q && !(l.dataset.q || '').includes(q); });
  });
  document.addEventListener('change', (e) => {
    const t = e.target; if (!t?.classList) return;
    if (t.classList.contains('gc-stage-cb')) stageCount();
    // Chọn NVL có trong danh mục → tự điền ĐVT
    if (t.classList.contains('gc-mat-name')) {
      const m = (DB.materials || []).find((x) => norm(x.name) === norm(t.value));
      if (m?.unit) setUnit(t.closest('.gc-mat')?.querySelector('.gc-mat-unit'), m.unit);
    }
  });

  const linkedPo = (o) => (o.productionOrderId ? (DB.productionOrders || []).find((x) => x.id === o.productionOrderId) || null : null);
  /** Đưa đơn gia công sang LỆNH SẢN XUẤT (module Sản xuất) với các công đoạn đã chọn. */
  function createLsx(o, stages) {
    if (typeof buildProductionStagesFromRouting !== 'function' || !Array.isArray(DB.productionOrders)) throw new Error('Module Sản xuất chưa sẵn sàng, tải lại trang rồi thử lại.');
    if (linkedPo(o)) throw new Error(`Đơn đã có lệnh sản xuất ${o.productionOrderId}.`);
    const start = today(), deadline = o.dueDate && o.dueDate >= start ? o.dueDate : start;
    const routing = stages.map((x) => [x.operationId, 0, '']);
    const po = {
      id: nextCode('LSX-2026-', DB.productionOrders), orderId: '', gcOrderId: o.id,
      productId: '', productName: o.productName, spec: o.spec || '', unit: o.unit || '',
      customerId: o.customerId || '', customerName: o.customerName || '',
      qty: num(o.qty), startDate: start, deadline, managerId: DB.currentUser?.id || 'NV-008',
      status: 'lsx_cho_san_xuat', routingOverride: routing,
      stages: buildProductionStagesFromRouting(num(o.qty), routing, start),
      qcPass: 0, qcFail: 0, materialPlan: [],
      note: `Gia công cho khách ${custName(o)} · đơn ${o.id}${o.spec ? ' · ' + o.spec : ''}`, source: 'SUBCONTRACT_IN',
    };
    DB.productionOrders.unshift(po);
    o.stages = stages; o.productionOrderId = po.id;
    try { SEARCH_INDEX = null; } catch (e) { /* chưa khởi tạo */ }
    try { if (typeof ProductionAPI !== 'undefined') ProductionAPI.scheduleSync(120); } catch (e) { console.warn('[GC] sync LSX:', e); }
    try { if (typeof logActivity === 'function') logActivity('tạo lệnh sản xuất từ đơn gia công', po.id, `${po.productName} · ${fmtDec(po.qty, 2)} ${po.unit}`, 'fa-industry', 'indigo'); } catch (e) { /* noop */ }
    return po;
  }
  function lsxSectionHtml(o) {
    const st = o.stages || [], po = linkedPo(o);
    const chips = st.length ? `<div class="gc-stage-chips">${st.map((x, i) => `<span class="badge slate no-dot">${i + 1}. ${esc(x.name)}</span>`).join('')}</div>` : '<div class="cell-sub">Chưa chọn công đoạn gia công.</div>';
    const lsx = po
      ? `<div class="info-grid" style="margin-top:10px">${infoItem('Lệnh sản xuất', `<a class="ref-link" data-act="open-production-order" data-id="${esc(po.id)}" style="cursor:pointer"><b>${esc(po.id)}</b> <i class="fa-solid fa-arrow-up-right-from-square"></i></a>`)}${infoItem('Trạng thái LSX', esc(typeof statusLabel === 'function' ? statusLabel(po.status) : po.status))}${infoItem('Tiến độ', typeof Q?.progress === 'function' ? `<b>${fmtDec(Q.progress(po), 0)}%</b>` : '—')}</div>`
      : `<div class="cell-sub" style="margin-top:8px">${o.productionOrderId ? 'Lệnh sản xuất đã liên kết nhưng không còn trong danh sách.' : 'Lệnh sản xuất sẽ được tạo khi bắt đầu sản xuất.'}</div>`;
    return chips + lsx;
  }

  /* ------------------------------------------------------------------ hành động theo trạng thái */
  function actionsFor(o) {
    const A = (act, label, icon, primary) => ({ act, label, icon, primary: !!primary });
    switch (o.status) {
      case 'DRAFT': return [A('subcontracting-approve', 'Duyệt đơn', 'fa-circle-check', true), A('subcontracting-edit', 'Sửa', 'fa-pen'), A('subcontracting-delete', 'Xóa', 'fa-trash')];
      case 'WAIT_MATERIAL': return [A('gc-receive', 'Nhận NVL khách gửi', 'fa-box-open', true), A('gc-cancel', 'Hủy đơn', 'fa-ban')];
      case 'MATERIAL_QC': return [A('gc-mqc', 'QC nguyên vật liệu', 'fa-vial-circle-check', true), A('gc-receive', 'Nhận thêm NVL', 'fa-box-open')];
      case 'READY': return [A('gc-start', 'Bắt đầu sản xuất', 'fa-play', true), A('gc-receive', 'Nhận thêm NVL', 'fa-box-open')];
      case 'IN_PRODUCTION': return [A('gc-finish', 'Hoàn thành sản xuất', 'fa-flag-checkered', true), linkedPo(o) ? A('gc-open-lsx', 'Xem lệnh sản xuất', 'fa-industry') : A('gc-make-lsx', 'Tạo lệnh sản xuất', 'fa-industry')];
      case 'WAIT_FQC': return [A('gc-fqc', 'QC thành phẩm', 'fa-clipboard-check', true)];
      case 'READY_RETURN': return [A('gc-return', 'Trả hàng cho khách', 'fa-truck-ramp-box', true)];
      case 'RETURNED': return [collectable(o) > 0 ? A('gc-pay', 'Thu phí gia công', 'fa-money-bill-wave', true) : null, heldTotal(o) > EPS ? A('gc-return', 'Trả NVL dư', 'fa-rotate-left', collectable(o) <= 0) : null].filter(Boolean);
      default: return [];
    }
  }

  /* ------------------------------------------------------------------ danh sách / tổng quan */
  function progressHtml(o) {
    const cur = STEP_OF[o.status]; if (cur < 0) return '<span class="muted">—</span>';
    return `<div class="cell-sub">Bước ${Math.min(cur + 1, STEPS.length)}/${STEPS.length}: <b>${esc(STEPS[Math.min(cur, STEPS.length - 1)])}</b></div>`;
  }
  function orderRow(o) {
    const acts = [{ act: 'subcontracting-open', data: `data-id="${esc(o.id)}"`, icon: 'fa-eye', title: 'Xem chi tiết' }];
    const first = actionsFor(o)[0];
    if (first && first.act !== 'subcontracting-delete') acts.push({ act: first.act, data: `data-id="${esc(o.id)}"`, icon: first.icon, title: first.label });
    return `<tr class="clickable" data-act="subcontracting-open" data-id="${esc(o.id)}">
      <td>${cell2(`<span class="code">${esc(o.id)}</span>`, fmtDate(o.receivedDate))}</td>
      <td>${esc(custName(o))}</td>
      <td>${esc(o.productName || '—')}<div class="cell-sub">SL ${fmtDec(o.qty, 2)} ${esc(o.unit || '')}</div></td>
      <td>${dueHtml(o)}</td>
      <td>${statusHtml(o.status)}${progressHtml(o)}</td>
      <td class="right num">${fmtVND(feeTotal(o))}${debtOf(o) > 0 && ['RETURNED', 'COMPLETED'].includes(o.status) ? `<div class="cell-sub" style="color:var(--red)">Còn nợ ${fmtVND(debtOf(o))}</div>` : ''}</td>
      <td class="right">${rowActions(acts)}</td></tr>`;
  }
  const ORDER_HEAD = [{ t: 'Mã đơn' }, { t: 'Khách hàng' }, { t: 'Sản phẩm gia công' }, { t: 'Hạn trả hàng' }, { t: 'Trạng thái' }, { t: 'Phí gia công', cls: 'right' }, { t: '', cls: 'right', w: '90px' }];

  function viewOverview() {
    const all = orders();
    const n = (...st) => all.filter((o) => st.includes(o.status)).length;
    const todo = all.filter(isOpen).sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))).slice(0, 10);
    const debt = all.filter((o) => o.status !== 'CANCELLED' && o.status !== 'DRAFT').reduce((s, o) => s + (['RETURNED', 'COMPLETED'].includes(o.status) ? debtOf(o) : 0), 0);
    const late = all.filter((o) => isOpen(o) && daysLeft(o) !== null && daysLeft(o) < 0).length;
    return `${pageHead('Gia công cho khách', 'Công ty gia công giùm khách hàng: khách gửi nguyên vật liệu, công ty sản xuất, trả hàng và thu phí gia công',
      `<button class="btn btn-primary" data-act="subcontracting-new"><i class="fa-solid fa-plus"></i>Tạo đơn gia công</button>`)}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Đơn đang xử lý', all.filter(isOpen).length, 'fa-gears', 'blue')}
      ${mkpi('Chờ nhận NVL', n('WAIT_MATERIAL'), 'fa-box-open', 'orange')}
      ${mkpi('Chờ QC', n('MATERIAL_QC', 'WAIT_FQC'), 'fa-vial-circle-check', 'purple')}
      ${mkpi('Đang sản xuất', n('READY', 'IN_PRODUCTION'), 'fa-industry', 'blue')}
      ${mkpi('Chờ trả hàng', n('READY_RETURN'), 'fa-truck-ramp-box', 'orange')}
      ${mkpi('Trễ hạn trả', late, 'fa-triangle-exclamation', 'red')}
      ${mkpi('Phí chờ thu', fmtVND(debt), 'fa-money-bill-wave', 'teal')}
    </div>
    <div class="card"><div class="card-head"><div><h3>Đơn cần xử lý</h3><p>Sắp theo hạn trả hàng</p></div></div>
      ${tableShell(ORDER_HEAD, todo.map(orderRow), { emptyTitle: 'Chưa có đơn gia công nào đang xử lý' })}</div>`;
  }
  function viewOrders() {
    const f = F('gc-orders', { q: '', status: '' });
    const q = String(f.q || '').toLowerCase().trim();
    const list = orders().filter((o) => (!f.status || o.status === f.status) && (!q || [o.id, custName(o), o.productName].some((v) => String(v || '').toLowerCase().includes(q))))
      .sort((a, b) => String(b.id).localeCompare(String(a.id), 'vi', { numeric: true }));
    const pg = paged(list, 'gc-orders');
    return `${pageHead('Đơn gia công', 'Danh sách đơn gia công cho khách hàng', `<button class="btn btn-primary" data-act="subcontracting-new"><i class="fa-solid fa-plus"></i>Tạo đơn gia công</button>`)}
    <div class="card"><div class="toolbar">${searchBox('gc-orders', 'Tìm mã đơn, khách hàng, sản phẩm…')}${selectFilter('gc-orders', 'status', Object.entries(STATUS).map(([k, v]) => [k, v[0]]), 'Tất cả trạng thái')}</div>
    ${tableShell(ORDER_HEAD, pg.items.map(orderRow), { emptyTitle: 'Chưa có đơn gia công' })}${pagiHTML('gc-orders', pg, 'đơn')}</div>`;
  }
  function viewMaterials() {
    const f = F('gc-materials', { q: '', onlyHeld: '1' });
    const q = String(f.q || '').toLowerCase().trim();
    const rows = [];
    orders().filter((o) => o.status !== 'DRAFT' && o.status !== 'CANCELLED').forEach((o) => mats(o).forEach((m) => {
      if (q && ![o.id, custName(o), m.name].some((v) => String(v || '').toLowerCase().includes(q))) return;
      if (f.onlyHeld === '1' && held(m) <= EPS && num(m.qtyPendingQc) <= EPS) return;
      rows.push({ o, m });
    }));
    const pg = paged(rows, 'gc-materials');
    const body = pg.items.map(({ o, m }) => `<tr class="clickable" data-act="subcontracting-open" data-id="${esc(o.id)}">
      <td>${cell2(esc(m.name), esc(m.unit || ''))}</td><td>${cell2(`<span class="code">${esc(o.id)}</span>`, esc(custName(o)))}</td>
      <td class="right num">${fmtDec(m.qtyPlan, 2)}</td><td class="right num">${fmtDec(m.qtyReceived, 2)}</td>
      <td class="right num" style="color:var(--green,#16a34a)">${fmtDec(m.qtyAccepted, 2)}</td><td class="right num" style="color:var(--red)">${fmtDec(m.qtyRejected, 2)}</td>
      <td class="right num">${fmtDec(m.qtyUsed, 2)}</td><td class="right num">${fmtDec(m.qtyReturned, 2)}</td>
      <td class="right strong num">${fmtDec(held(m), 2)}</td></tr>`);
    return `${pageHead('NVL khách gửi', 'Nguyên vật liệu của khách đang giữ tại công ty — theo dõi riêng, không tính vào tồn kho công ty')}
    <div class="card"><div class="toolbar">${searchBox('gc-materials', 'Tìm NVL, khách hàng, mã đơn…')}
      ${selectFilter('gc-materials', 'onlyHeld', [['1', 'Chỉ NVL đang giữ']], 'Tất cả NVL')}</div>
    ${tableShell([{ t: 'Nguyên vật liệu' }, { t: 'Đơn / Khách' }, { t: 'Khách cam kết', cls: 'right' }, { t: 'Đã nhận', cls: 'right' }, { t: 'Đạt QC', cls: 'right' }, { t: 'Không đạt', cls: 'right' }, { t: 'Đã dùng', cls: 'right' }, { t: 'Đã trả', cls: 'right' }, { t: 'Đang giữ', cls: 'right' }], body, { emptyTitle: 'Không có NVL khách gửi' })}${pagiHTML('gc-materials', pg, 'dòng')}</div>`;
  }
  function viewCustomers() {
    const map = new Map();
    orders().filter((o) => o.status !== 'CANCELLED' && o.status !== 'DRAFT').forEach((o) => {
      const k = custName(o); const g = map.get(k) || { name: k, orders: 0, open: 0, fee: 0, paid: 0, held: 0 };
      g.orders++; if (isOpen(o)) g.open++; g.fee += feeTotal(o); g.paid += paidTotal(o); g.held += heldTotal(o); map.set(k, g);
    });
    const rows = [...map.values()].sort((a, b) => b.fee - a.fee).map((g) => `<tr><td><b>${esc(g.name)}</b></td><td class="right num">${g.orders}</td><td class="right num">${g.open}</td><td class="right num">${fmtVND(g.fee)}</td><td class="right num">${fmtVND(g.paid)}</td><td class="right num" style="color:${g.fee - g.paid > 0 ? 'var(--red)' : 'inherit'}">${fmtVND(Math.max(0, g.fee - g.paid))}</td><td class="right num">${fmtDec(g.held, 2)}</td></tr>`);
    return `${pageHead('Khách hàng gia công', 'Tổng hợp theo khách hàng đã giao NVL gia công')}
    <div class="card">${tableShell([{ t: 'Khách hàng' }, { t: 'Số đơn', cls: 'right' }, { t: 'Đang xử lý', cls: 'right' }, { t: 'Phí gia công', cls: 'right' }, { t: 'Đã thu', cls: 'right' }, { t: 'Còn phải thu', cls: 'right' }, { t: 'NVL đang giữ', cls: 'right' }], rows, { emptyTitle: 'Chưa có khách hàng gia công' })}</div>`;
  }
  Views.subcontracting = function () {
    const tab = State.tab || 'dashboard';
    if (tab === 'orders') return viewOrders();
    if (tab === 'materials') return viewMaterials();
    if (tab === 'customers' || tab === 'partners') return viewCustomers();
    return viewOverview();
  };
  ['overview', 'orders', 'materials', 'partners'].forEach((k) => {
    Views['subcontracting-' + k] = { overview: viewOverview, orders: viewOrders, materials: viewMaterials, partners: viewCustomers }[k];
  });

  /* ------------------------------------------------------------------ form tạo / sửa đơn */
  function matRowHtml(m = {}) {
    return `<div class="gc-mat" style="display:grid;grid-template-columns:1fr 110px 130px 36px;gap:8px;margin-bottom:8px;align-items:center">
      <input class="inp gc-mat-name" list="gcMatList" autocomplete="off" placeholder="Gõ để tìm / nhập tên NVL" value="${esc(m.name || '')}">
      ${unitSelect('gc-mat-unit', m.unit || '')}
      <input class="inp right num gc-mat-qty" type="number" min="0" step="any" placeholder="SL khách cung cấp" value="${m.qtyPlan ? esc(m.qtyPlan) : ''}">
      <button type="button" class="btn btn-sm" data-act="gc-mat-del" title="Xóa dòng"><i class="fa-solid fa-xmark"></i></button></div>`;
  }
  function openForm(id = '') {
    const o = id ? find(id) : null;
    if (id && (!o || o.status !== 'DRAFT')) { Toast.warn('Không thể sửa', 'Chỉ sửa được đơn ở trạng thái Nháp.'); return; }
    const custOpts = (DB.customers || []).map((c) => `<option value="${esc(c.id)}" ${o?.customerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    Modal.open({
      title: o ? `Sửa đơn gia công · ${o.id}` : 'Tạo đơn gia công cho khách', sub: 'Khách hàng gửi nguyên vật liệu, công ty gia công và thu phí', size: 'lg',
      body: `<div class="form-grid cols-2">
        <div class="field"><label>Khách hàng (trong danh bạ)</label><select class="inp" id="gcCustomer" data-search="1"><option value="">— Khách ngoài danh bạ —</option>${custOpts}</select></div>
        <div class="field"><label>Tên khách hàng <span class="req">*</span></label><input class="inp" id="gcCustomerName" value="${esc(o?.customerName || '')}" placeholder="Tự điền khi chọn từ danh bạ"></div>
        <div class="field"><label>Sản phẩm gia công <span class="req">*</span></label><input class="inp" id="gcProduct" list="gcProductList" autocomplete="off" value="${esc(o?.productName || '')}" placeholder="Gõ để tìm sản phẩm hoặc nhập tên mới"></div>
        <div class="field"><label>Quy cách / yêu cầu kỹ thuật</label><input class="inp" id="gcSpec" value="${esc(o?.spec || '')}"></div>
        <div class="field"><label>Số lượng thành phẩm <span class="req">*</span></label><input class="inp right num" id="gcQty" type="number" min="0" step="any" value="${o ? esc(o.qty) : ''}"></div>
        <div class="field"><label>Đơn vị tính <span class="req">*</span></label>${unitSelect('', o?.unit || '', 'gcUnit')}</div>
        <div class="field"><label>Đơn giá gia công / ĐVT (đ) <span class="req">*</span></label><input class="inp right num" id="gcFee" type="number" min="0" step="any" value="${o ? esc(o.feePerUnit) : ''}"></div>
        <div class="field"><label>Phụ phí khác (đ)</label><input class="inp right num" id="gcExtra" type="number" min="0" step="any" value="${o ? esc(o.extraFee || 0) : ''}"></div>
        <div class="field"><label>Hạn trả hàng <span class="req">*</span></label><input class="inp" id="gcDue" type="date" value="${esc(o?.dueDate || '')}" min="${today()}"></div>
        <div class="field"><label>Liên hệ khách</label><input class="inp" id="gcContact" value="${esc(o?.contact || '')}" placeholder="Người liên hệ / SĐT"></div>
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>Nguyên vật liệu khách sẽ gửi <span class="req">*</span></div>
      <div id="gcMatRows">${(o?.materials?.length ? o.materials : [{}]).map(matRowHtml).join('')}</div>
      <button type="button" class="btn btn-sm" data-act="gc-mat-add"><i class="fa-solid fa-plus"></i>Thêm nguyên vật liệu</button>
      <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-diagram-project"></i>Công đoạn gia công</div>
      ${stagePickerHtml(o?.stages)}
      <div class="field" style="margin-top:12px"><label>Ghi chú</label><textarea class="inp" id="gcNote" rows="2">${esc(o?.note || '')}</textarea></div>
      <datalist id="gcProductList">${(DB.products || []).map((x) => `<option value="${esc(x.name)}">${esc([x.id, x.spec].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
      <datalist id="gcMatList">${(DB.materials || []).map((x) => `<option value="${esc(x.name)}">${esc([x.id, x.unit].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>`,
      onMount: stageCount,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-save" data-id="${esc(o?.id || '')}"><i class="fa-solid fa-floppy-disk"></i>Lưu đơn</button>`,
    });
    setTimeout(() => {
      const sel = $('#gcCustomer'), nm = $('#gcCustomerName');
      const pr = $('#gcProduct');
      pr?.addEventListener('change', () => {
        const pd = (DB.products || []).find((x) => norm(x.name) === norm(pr.value)); if (!pd) return;
        if (pd.unit) setUnit($('#gcUnit'), pd.unit);
        const sp = $('#gcSpec'); if (sp && !sp.value) sp.value = pd.spec || '';
        if (!readStages().length) { (pd.routing || []).forEach((r) => { const id = Array.isArray(r) ? r[0] : r?.operationId; const cb = [...document.querySelectorAll('.gc-stage-cb')].find((c) => c.value === id); if (cb) cb.checked = true; }); stageCount(); }
      });
      sel?.addEventListener('change', () => { const c = (DB.customers || []).find((x) => x.id === sel.value); if (c && nm) { nm.value = c.name || ''; const ct = $('#gcContact'); if (ct && !ct.value) ct.value = [c.contact, c.phone].filter(Boolean).join(' · '); } });
    }, 0);
  }
  function saveOrder(id) {
    const old = id ? find(id) : null; if (id && (!old || old.status !== 'DRAFT')) return;
    const customerId = $('#gcCustomer')?.value || ''; const customerName = ($('#gcCustomerName')?.value || '').trim() || (customerId ? Q.customerName(customerId) : '');
    const productName = ($('#gcProduct')?.value || '').trim(); const unit = ($('#gcUnit')?.value || '').trim();
    const qty = num($('#gcQty')?.value), feePerUnit = num($('#gcFee')?.value), extraFee = num($('#gcExtra')?.value), dueDate = $('#gcDue')?.value || '';
    const materials = [...document.querySelectorAll('.gc-mat')].map((r) => ({ name: r.querySelector('.gc-mat-name')?.value.trim() || '', unit: r.querySelector('.gc-mat-unit')?.value.trim() || '', qtyPlan: num(r.querySelector('.gc-mat-qty')?.value) })).filter((m) => m.name || m.qtyPlan);
    if (!customerName) { Toast.err('Thiếu khách hàng', 'Chọn hoặc nhập tên khách hàng.'); return; }
    if (!productName || !unit) { Toast.err('Thiếu thông tin sản phẩm', 'Nhập tên sản phẩm gia công và đơn vị tính.'); return; }
    if (!(qty > 0)) { Toast.err('Số lượng không hợp lệ', 'Số lượng thành phẩm phải lớn hơn 0.'); return; }
    if (!(feePerUnit >= 0) || $('#gcFee')?.value === '') { Toast.err('Thiếu đơn giá', 'Nhập đơn giá gia công (có thể bằng 0).'); return; }
    if (!dueDate) { Toast.err('Thiếu hạn trả hàng', 'Chọn hạn trả hàng cho khách.'); return; }
    if (!materials.length || materials.some((m) => !m.name || !(m.qtyPlan > 0))) { Toast.err('Nguyên vật liệu chưa đủ', 'Mỗi dòng NVL cần có tên và số lượng lớn hơn 0.'); return; }
    const o = old || { id: nextCode(`GC-${today().slice(0, 4)}-`, orders()), status: 'DRAFT', receivedDate: today(), createdBy: DB.currentUser?.id || '', history: [] };
    Object.assign(o, { customerId, customerName, contact: ($('#gcContact')?.value || '').trim(), productName, spec: ($('#gcSpec')?.value || '').trim(), qty, unit, feePerUnit, extraFee, dueDate, note: ($('#gcNote')?.value || '').trim() });
    o.materials = materials.map((m) => ({ ...m, qtyReceived: 0, qtyPendingQc: 0, qtyAccepted: 0, qtyRejected: 0, qtyUsed: 0, qtyReturned: 0 }));
    o.stages = readStages();
    if (!old) { orders().unshift(o); log(o, 'Tạo đơn gia công (nháp).'); } else log(o, 'Cập nhật đơn gia công.');
    persist(); Modal.close(); render(); Toast.ok(old ? 'Đã cập nhật đơn' : 'Đã tạo đơn gia công', o.id);
  }

  /* ------------------------------------------------------------------ chi tiết đơn */
  function stepper(o) {
    const cur = STEP_OF[o.status];
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${STEPS.map((s, i) => {
      const done = cur > i, active = cur === i && o.status !== 'CANCELLED';
      return `<span class="badge ${done ? 'green' : active ? 'blue' : 'slate'}" style="opacity:${done || active ? 1 : .55}">${done ? '<i class="fa-solid fa-check"></i> ' : ''}${i + 1}. ${esc(s)}</span>`;
    }).join('')}</div>`;
  }
  function openDetail(id) {
    const o = find(id); if (!o) return;
    const matRows = mats(o).map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.unit || '')}</td><td class="right num">${fmtDec(m.qtyPlan, 2)}</td><td class="right num">${fmtDec(m.qtyReceived, 2)}</td><td class="right num">${fmtDec(m.qtyAccepted, 2)}</td><td class="right num" style="color:var(--red)">${fmtDec(m.qtyRejected, 2)}</td><td class="right num">${fmtDec(m.qtyUsed, 2)}</td><td class="right num">${fmtDec(m.qtyReturned, 2)}</td><td class="right strong num">${fmtDec(held(m), 2)}</td></tr>`).join('');
    const p = o.production || {};
    const sec = (title, icon, html) => `<div class="form-sec-title" style="margin-top:16px"><i class="fa-solid ${icon}"></i>${title}</div>${html}`;
    const list = (arr, fn, head) => arr && arr.length ? tableShell(head, arr.map(fn), { emptyTitle: '' }) : '<div class="cell-sub">Chưa có.</div>';
    const acts = actionsFor(o).filter((a) => a.act !== 'subcontracting-delete' || o.status === 'DRAFT');
    Modal.open({
      title: `Đơn gia công · ${esc(o.id)}`, sub: `${esc(custName(o))} · ${esc(o.productName)}`, size: 'xl',
      body: `${stepper(o)}
      <div class="info-grid">
        ${infoItem('Trạng thái', statusHtml(o.status))}${infoItem('Khách hàng', esc(custName(o)) + (o.contact ? `<div class="cell-sub">${esc(o.contact)}</div>` : ''))}
        ${infoItem('Sản phẩm gia công', esc(o.productName) + (o.spec ? `<div class="cell-sub">${esc(o.spec)}</div>` : ''))}${infoItem('Số lượng', `<b>${fmtDec(o.qty, 2)}</b> ${esc(o.unit)}`)}
        ${infoItem('Ngày nhận đơn', fmtDate(o.receivedDate))}${infoItem('Hạn trả hàng', dueHtml(o))}
        ${infoItem('Đơn giá gia công', fmtVND(o.feePerUnit) + ' / ' + esc(o.unit))}${infoItem('Phí gia công', `<b>${fmtVND(feeTotal(o))}</b>${o.extraFee ? `<div class="cell-sub">Gồm phụ phí ${fmtVND(o.extraFee)}</div>` : ''}`)}
        ${infoItem('Đã thu', fmtVND(paidTotal(o)))}${infoItem('Còn phải thu', `<span style="color:${debtOf(o) > 0 ? 'var(--red)' : 'inherit'}">${fmtVND(debtOf(o))}</span>`)}
      </div>
      ${o.note ? `<div class="cell-sub" style="margin-top:8px">Ghi chú: ${esc(o.note)}</div>` : ''}
      ${sec('Nguyên vật liệu khách gửi', 'fa-boxes-stacked', `<div class="tbl-wrap"><table class="line-tbl"><thead><tr><th>NVL</th><th>ĐVT</th><th class="right">Khách cam kết</th><th class="right">Đã nhận</th><th class="right">Đạt QC</th><th class="right">Không đạt</th><th class="right">Đã dùng</th><th class="right">Đã trả</th><th class="right">Đang giữ</th></tr></thead><tbody>${matRows}</tbody></table></div>`)}
      ${sec('Phiếu nhận NVL', 'fa-box-open', list(o.materialReceipts, (r) => `<tr><td>${esc(r.id)}</td><td>${dt(r.at)}</td><td>${esc(r.deliverer || '—')}</td><td>${(r.items || []).map((i) => `${esc(mats(o)[i.mi]?.name || '')}: <b>${fmtDec(i.qty, 2)}</b>`).join('<br>')}</td><td>${esc(r.note || '')}</td></tr>`, [{ t: 'Phiếu' }, { t: 'Thời gian' }, { t: 'Người giao' }, { t: 'NVL nhận' }, { t: 'Ghi chú' }]))}
      ${sec('Kết quả QC nguyên vật liệu', 'fa-vial-circle-check', list(o.materialQcs, (r) => `<tr><td>${dt(r.at)}</td><td>${esc(r.byName || '')}</td><td>${(r.items || []).map((i) => `${esc(mats(o)[i.mi]?.name || '')}: đạt <b>${fmtDec(i.passQty, 2)}</b> / không đạt <b style="color:var(--red)">${fmtDec(i.failQty, 2)}</b>${i.reason ? ` (${esc(i.reason)})` : ''}`).join('<br>')}</td></tr>`, [{ t: 'Thời gian' }, { t: 'QC' }, { t: 'Kết quả' }]))}
      ${sec('Công đoạn gia công & lệnh sản xuất', 'fa-diagram-project', lsxSectionHtml(o))}
      ${sec('Sản xuất', 'fa-industry', p.startedAt ? `<div class="info-grid">${infoItem('Bắt đầu', dt(p.startedAt))}${infoItem('Hoàn thành', p.completedAt ? dt(p.completedAt) : '<span class="muted">Đang sản xuất</span>')}${infoItem('Thời gian chạy', p.elapsedH != null ? fmtDec(p.elapsedH, 1) + ' giờ' : '—')}${infoItem('Tổ trưởng / máy', esc([p.lead, p.machine].filter(Boolean).join(' · ') || '—'))}${infoItem('Sản lượng / phế', p.qtyProduced != null ? `<b>${fmtDec(p.qtyProduced, 2)}</b> / ${fmtDec(p.qtyDefect || 0, 2)} ${esc(o.unit)}` : '—')}${infoItem('Giờ máy / giờ công', p.qtyProduced != null ? `${fmtDec(p.machineHours || 0, 1)} / ${fmtDec(p.laborHours || 0, 1)} giờ` : '—')}</div>${p.shortageNote ? `<div class="cell-sub">Thiếu NVL khi bắt đầu: ${esc(p.shortageNote)}</div>` : ''}` : '<div class="cell-sub">Chưa bắt đầu.</div>')}
      ${sec('QC thành phẩm', 'fa-clipboard-check', list(o.finalQcs, (r) => `<tr><td>${dt(r.at)}</td><td>${esc(r.byName || '')}</td><td class="right num">${fmtDec(r.qty, 2)}</td><td class="right num" style="color:var(--green,#16a34a)">${fmtDec(r.passQty, 2)}</td><td class="right num" style="color:var(--red)">${fmtDec(r.failQty, 2)}</td><td>${r.failQty > 0 ? esc((r.disposition === 'SCRAP' ? 'Hủy theo thỏa thuận' : 'Trả khách kèm biên bản') + (r.reason ? ' · ' + r.reason : '')) : ''}</td></tr>`, [{ t: 'Thời gian' }, { t: 'QC' }, { t: 'SL kiểm', cls: 'right' }, { t: 'Đạt', cls: 'right' }, { t: 'Không đạt', cls: 'right' }, { t: 'Xử lý hàng lỗi' }]))}
      ${sec('Trả hàng cho khách', 'fa-truck-ramp-box', list(o.returns, (r) => `<tr><td>${esc(r.id)}</td><td>${dt(r.at)}</td><td class="right num">${fmtDec(r.qty, 2)} ${esc(o.unit)}</td><td>${(r.materials || []).filter((m) => m.qty > 0).map((m) => `${esc(mats(o)[m.mi]?.name || '')}: ${fmtDec(m.qty, 2)}`).join('<br>') || '—'}</td><td>${esc(r.receiver || '—')}${r.vehicle ? `<div class="cell-sub">${esc(r.vehicle)}</div>` : ''}</td></tr>`, [{ t: 'Phiếu' }, { t: 'Thời gian' }, { t: 'Thành phẩm trả', cls: 'right' }, { t: 'NVL trả lại' }, { t: 'Người nhận / xe' }]))}
      ${sec('Thu phí gia công', 'fa-money-bill-wave', list(o.payments, (r) => `<tr><td>${esc(r.id)}</td><td>${fmtDate(r.date)}</td><td class="right num">${fmtVND(r.amount)}</td><td>${esc(r.method || '')}${r.bankName ? `<div class="cell-sub">${esc(r.bankName)}${r.bankAccount ? ' · ' + esc(r.bankAccount) : ''}</div>` : ''}</td><td>${esc(r.payerName || '—')}</td><td>${esc(typeof accountingEntryLabel === 'function' && r.accountingEntryId ? accountingEntryLabel(r.accountingEntryId) : '—')}</td><td>${esc(r.reference || '')}${r.note ? `<div class="cell-sub">${esc(r.note)}</div>` : ''}</td><td>${isConfirmed(r) ? '<span class="badge green">Đã nhận tiền</span>' : `<span class="badge orange">Chờ kế toán xác nhận</span>${canConfirmMoney() ? `<div style="margin-top:4px"><button class="btn btn-xs btn-primary" data-act="gc-pay-confirm" data-id="${esc(o.id)}" data-pid="${esc(r.id)}"><i class="fa-solid fa-check"></i>Xác nhận đã nhận</button></div>` : ''}`}</td></tr>`, [{ t: 'Phiếu' }, { t: 'Ngày' }, { t: 'Số tiền', cls: 'right' }, { t: 'Hình thức / Ngân hàng' }, { t: 'Người thực hiện' }, { t: 'Định khoản' }, { t: 'Tham chiếu / Ghi chú' }, { t: 'Trạng thái' }]))}
      ${sec('Lịch sử', 'fa-clock-rotate-left', list((o.history || []).slice().reverse(), (h) => `<tr><td>${dt(h.at)}</td><td>${esc(h.by || '')}</td><td>${esc(h.text)}</td></tr>`, [{ t: 'Thời gian' }, { t: 'Người' }, { t: 'Nội dung' }]))}`,
      foot: `<button class="btn" data-act="modal-close">Đóng</button>${acts.map((a) => `<button class="btn ${a.primary ? 'btn-primary' : ''}" data-act="${a.act}" data-id="${esc(o.id)}"><i class="fa-solid ${a.icon}"></i>${esc(a.label)}</button>`).join('')}`,
    });
  }

  /* ------------------------------------------------------------------ các bước nghiệp vụ */
  const gcFoot = (act, id, label, icon = 'fa-floppy-disk') => `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="${act}" data-id="${esc(id)}"><i class="fa-solid ${icon}"></i>${esc(label)}</button>`;
  const need = (o, st, msg) => { if (!o || !st.includes(o.status)) { Toast.warn('Không thể thực hiện', msg || 'Đơn không ở trạng thái phù hợp.'); return false; } return true; };
  const done = (o, title, sub) => { persist(); audit(o, title, `${o.id}: ${title}`); Modal.close(); render(); Toast.ok(title, sub || o.id); };

  function approve(id) {
    const o = find(id); if (!need(o, ['DRAFT'])) return;
    o.status = 'WAIT_MATERIAL'; o.approvedAt = nowIso(); log(o, 'Duyệt đơn gia công. Chờ khách gửi nguyên vật liệu.'); done(o, 'Đã duyệt đơn gia công');
  }
  function del(id) {
    const o = find(id); if (!need(o, ['DRAFT'], 'Chỉ xóa được đơn nháp.')) return;
    DB.gcOrders = orders().filter((x) => x.id !== id); persist(); Modal.close(); render(); Toast.ok('Đã xóa đơn nháp', id);
  }
  function openCancel(id) {
    const o = find(id); if (!need(o, ['WAIT_MATERIAL'])) return;
    if (mats(o).some((m) => num(m.qtyReceived) > 0)) { Toast.warn('Đã nhận NVL', 'Đơn đã nhận NVL của khách. Hãy trả hết NVL trước khi hủy.'); return; }
    Modal.open({ title: `Hủy đơn ${esc(o.id)}`, size: 'md', body: `<div class="field"><label>Lý do hủy <span class="req">*</span></label><textarea class="inp" id="gcCancelReason" rows="3"></textarea></div>`, foot: gcFoot('gc-cancel-save', id, 'Xác nhận hủy', 'fa-ban') });
  }
  function cancelSave(id) {
    const o = find(id); if (!need(o, ['WAIT_MATERIAL'])) return; const r = ($('#gcCancelReason')?.value || '').trim();
    if (!r) { Toast.err('Thiếu lý do', 'Nhập lý do hủy đơn.'); return; }
    o.status = 'CANCELLED'; o.cancelReason = r; log(o, 'Hủy đơn: ' + r); done(o, 'Đã hủy đơn gia công');
  }

  // --- Nhận NVL khách gửi
  function openReceive(id) {
    const o = find(id); if (!need(o, ['WAIT_MATERIAL', 'MATERIAL_QC', 'READY'], 'Chỉ nhận NVL trước khi bắt đầu sản xuất.')) return;
    const rows = mats(o).map((m, i) => `<tr data-i="${i}"><td>${esc(m.name)}</td><td>${esc(m.unit || '')}</td><td class="right num">${fmtDec(m.qtyPlan, 2)}</td><td class="right num">${fmtDec(m.qtyReceived, 2)}</td><td><input class="inp right num gc-recv" type="number" min="0" step="any" value="${Math.max(0, r4(num(m.qtyPlan) - num(m.qtyReceived))) || ''}"></td></tr>`).join('');
    Modal.open({ title: `Nhận NVL khách gửi · ${esc(o.id)}`, sub: `${esc(custName(o))} · NVL được theo dõi riêng, không cộng vào tồn kho công ty`, size: 'lg',
      body: `<div class="tbl-wrap"><table class="line-tbl"><thead><tr><th>NVL</th><th>ĐVT</th><th class="right">Khách cam kết</th><th class="right">Đã nhận</th><th class="right">Nhận lần này</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="form-grid cols-2" style="margin-top:12px"><div class="field"><label>Người giao / biển số xe</label><input class="inp" id="gcDeliverer"></div><div class="field"><label>Ghi chú (chứng từ, tình trạng bao bì…)</label><input class="inp" id="gcRecvNote"></div></div>
      <div class="cell-sub">Sau khi nhận, NVL chuyển sang trạng thái chờ QC.</div>`, foot: gcFoot('gc-receive-save', id, 'Xác nhận nhận NVL', 'fa-box-open') });
  }
  function receiveSave(id) {
    const o = find(id); if (!need(o, ['WAIT_MATERIAL', 'MATERIAL_QC', 'READY'])) return;
    const items = [...document.querySelectorAll('tr[data-i]')].map((tr) => ({ mi: Number(tr.dataset.i), qty: num(tr.querySelector('.gc-recv')?.value) })).filter((x) => x.qty > 0);
    if (!items.length) { Toast.err('Chưa nhập số lượng', 'Nhập số lượng nhận cho ít nhất một nguyên vật liệu.'); return; }
    items.forEach((i) => { const m = mats(o)[i.mi]; m.qtyReceived = r4(num(m.qtyReceived) + i.qty); m.qtyPendingQc = r4(num(m.qtyPendingQc) + i.qty); });
    (o.materialReceipts = o.materialReceipts || []).push({ id: `NVL-${o.id.split('-').slice(1).join('')}-${String((o.materialReceipts || []).length + 1).padStart(2, '0')}`, at: nowIso(), by: who(), deliverer: ($('#gcDeliverer')?.value || '').trim(), note: ($('#gcRecvNote')?.value || '').trim(), items });
    o.status = 'MATERIAL_QC'; log(o, `Nhận NVL khách gửi (${items.length} loại). Chờ QC.`);
    pushNotification({ level: 'warning', icon: 'fa-vial-circle-check', title: `${o.id} có NVL khách gửi chờ QC`, desc: custName(o), go: { module: 'quality', tab: 'subcontracting_qc' } });
    done(o, 'Đã nhận NVL khách gửi', `${o.id} · chuyển QC kiểm tra`);
  }

  // --- QC NVL
  function openMqc(id) {
    const o = find(id); if (!need(o, ['MATERIAL_QC'], 'Đơn không có NVL chờ QC.')) return;
    const can = Auth.hasPermission('QC_INSPECT');
    const rows = mats(o).map((m, i) => num(m.qtyPendingQc) > EPS ? `<tr data-i="${i}"><td>${esc(m.name)}</td><td class="right num"><b>${fmtDec(m.qtyPendingQc, 2)}</b> ${esc(m.unit || '')}</td>
      <td><input class="inp right num gc-pass" type="number" min="0" max="${num(m.qtyPendingQc)}" step="any" value="${num(m.qtyPendingQc)}" ${can ? '' : 'disabled'}></td>
      <td><input class="inp right num gc-fail" type="number" min="0" max="${num(m.qtyPendingQc)}" step="any" value="0" ${can ? '' : 'disabled'}></td>
      <td><input class="inp gc-reason" placeholder="Ẩm mốc, lẫn tạp chất, sai chủng loại…" ${can ? '' : 'disabled'}></td></tr>` : '').join('');
    Modal.open({ title: `QC nguyên vật liệu khách gửi · ${esc(o.id)}`, sub: `${esc(custName(o))} · ${esc(o.productName)}`, size: 'xl',
      body: `<div class="tbl-wrap"><table class="line-tbl"><thead><tr><th>NVL</th><th class="right">SL chờ kiểm</th><th class="right">SL đạt</th><th class="right">SL không đạt</th><th>Lý do</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="cell-sub" style="margin-top:6px">SL đạt + SL không đạt = SL chờ kiểm; nhập một ô, ô còn lại tự tính. Phần không đạt sẽ được trả lại khách.</div>
      <div class="field" style="margin-top:12px"><label>Ghi chú QC</label><textarea class="inp" id="gcQcNote" rows="2" ${can ? '' : 'disabled'}></textarea></div>`,
      foot: can ? gcFoot('gc-mqc-save', id, 'Xác nhận kết quả QC', 'fa-clipboard-check') : '<button class="btn" data-act="modal-close">Đóng</button>' });
    setTimeout(() => document.querySelectorAll('tr[data-i]').forEach((tr) => { const p = tr.querySelector('.gc-pass'); qcBindComplementEls(p, tr.querySelector('.gc-fail'), num(p?.max)); }), 0);
  }
  function mqcSave(id) {
    const o = find(id); if (!need(o, ['MATERIAL_QC'])) return; if (!Auth.hasPermission('QC_INSPECT')) { Toast.err('Không có quyền', 'Chỉ QC được xác nhận kết quả.'); return; }
    const items = [];
    for (const tr of document.querySelectorAll('tr[data-i]')) {
      const mi = Number(tr.dataset.i), m = mats(o)[mi]; const pass = num(tr.querySelector('.gc-pass')?.value), fail = num(tr.querySelector('.gc-fail')?.value), reason = (tr.querySelector('.gc-reason')?.value || '').trim();
      if (pass < 0 || fail < 0 || Math.abs(pass + fail - num(m.qtyPendingQc)) > 1e-6) { Toast.err('Số lượng không khớp', `${m.name}: đạt + không đạt phải bằng ${fmtDec(m.qtyPendingQc, 2)}.`); return; }
      if (fail > 0 && !reason) { Toast.err('Thiếu lý do', `${m.name}: ghi lý do cho phần không đạt.`); return; }
      items.push({ mi, passQty: pass, failQty: fail, reason });
    }
    items.forEach((i) => { const m = mats(o)[i.mi]; m.qtyAccepted = r4(num(m.qtyAccepted) + i.passQty); m.qtyRejected = r4(num(m.qtyRejected) + i.failQty); m.qtyPendingQc = 0; });
    (o.materialQcs = o.materialQcs || []).push({ at: nowIso(), by: DB.currentUser?.id || '', byName: who(), note: ($('#gcQcNote')?.value || '').trim(), items });
    const ready = mats(o).every((m) => num(m.qtyAccepted) > EPS);
    o.status = ready ? 'READY' : 'WAIT_MATERIAL';
    const short = mats(o).filter((m) => num(m.qtyAccepted) + EPS < num(m.qtyPlan)).map((m) => m.name);
    log(o, `QC NVL: ${ready ? 'đủ điều kiện sản xuất' : 'còn thiếu NVL đạt chất lượng'}${short.length ? ` (chưa đủ cam kết: ${short.join(', ')})` : ''}.`);
    pushNotification({ level: ready ? 'info' : 'warning', icon: 'fa-boxes-stacked', title: `${o.id}: QC NVL ${ready ? 'xong' : 'cần bổ sung NVL'}`, desc: custName(o), go: { module: 'subcontracting', tab: 'orders' } });
    done(o, 'Đã ghi nhận QC nguyên vật liệu', ready ? 'Sẵn sàng sản xuất' : 'Còn thiếu NVL đạt, chờ khách bổ sung');
  }

  // --- Sản xuất
  function openStart(id) {
    const o = find(id); if (!need(o, ['READY'])) return;
    const short = mats(o).filter((m) => num(m.qtyAccepted) + EPS < num(m.qtyPlan));
    Modal.open({ title: `Bắt đầu sản xuất · ${esc(o.id)}`, sub: `${esc(o.productName)} · ${fmtDec(o.qty, 2)} ${esc(o.unit)}`, size: 'lg', onMount: stageCount,
      body: `<div class="form-grid cols-2"><div class="field"><label>Tổ trưởng / người phụ trách</label><input class="inp" id="gcLead"></div><div class="field"><label>Máy / dây chuyền</label><input class="inp" id="gcMachine"></div></div>
      <div class="form-sec-title"><i class="fa-solid fa-diagram-project"></i>Công đoạn gia công <span class="req">*</span></div>
      <div class="cell-sub" style="margin:-4px 0 8px">Các công đoạn đã chọn sẽ được chuyển thành <b>lệnh sản xuất</b> để theo dõi tiến độ ở module Sản xuất.</div>
      ${stagePickerHtml(o.stages)}
      ${short.length ? `<div class="alert warning" style="margin-top:12px"><i class="fa-solid fa-triangle-exclamation"></i><span>NVL đạt QC chưa đủ so với cam kết của khách: <b>${short.map((m) => `${esc(m.name)} (${fmtDec(m.qtyAccepted, 2)}/${fmtDec(m.qtyPlan, 2)} ${esc(m.unit || '')})`).join(', ')}</b>.</span></div>
      <div class="field" style="margin-top:8px"><label><input type="checkbox" id="gcShortAck"> Vẫn bắt đầu sản xuất với NVL hiện có (đã thỏa thuận với khách)</label></div>` : '<div class="cell-sub" style="margin-top:12px">NVL đã đủ theo cam kết của khách.</div>'}`,
      foot: gcFoot('gc-start-save', id, 'Bắt đầu & tạo lệnh sản xuất', 'fa-play') });
  }
  function startSave(id) {
    const o = find(id); if (!need(o, ['READY'])) return;
    const short = mats(o).filter((m) => num(m.qtyAccepted) + EPS < num(m.qtyPlan));
    if (short.length && !$('#gcShortAck')?.checked) { Toast.err('NVL chưa đủ', 'Tick xác nhận nếu vẫn sản xuất với NVL hiện có.'); return; }
    const stages = readStages();
    if (!stages.length) { Toast.err('Chưa chọn công đoạn', 'Chọn ít nhất một công đoạn gia công để tạo lệnh sản xuất.'); return; }
    let po; try { po = createLsx(o, stages); } catch (err) { Toast.err('Chưa tạo được lệnh sản xuất', err?.message || ''); return; }
    o.production = { startedAt: nowIso(), lead: ($('#gcLead')?.value || '').trim(), machine: ($('#gcMachine')?.value || '').trim(), lsxId: po.id, shortageNote: short.map((m) => `${m.name} ${fmtDec(m.qtyAccepted, 2)}/${fmtDec(m.qtyPlan, 2)}`).join('; ') };
    o.status = 'IN_PRODUCTION'; log(o, `Bắt đầu sản xuất. Đã tạo lệnh sản xuất ${po.id} (${stages.length} công đoạn gia công).`); done(o, 'Đã bắt đầu sản xuất', `Lệnh sản xuất ${po.id}`);
  }
  // Đơn đang sản xuất nhưng chưa có LSX (tạo từ phiên bản trước) → tạo bổ sung
  function openMakeLsx(id) {
    const o = find(id); if (!need(o, ['IN_PRODUCTION'])) return;
    if (linkedPo(o)) { openLsx(id); return; }
    Modal.open({ title: `Tạo lệnh sản xuất · ${esc(o.id)}`, sub: `${esc(o.productName)} · ${fmtDec(o.qty, 2)} ${esc(o.unit)}`, size: 'lg', onMount: stageCount,
      body: `<div class="form-sec-title"><i class="fa-solid fa-diagram-project"></i>Công đoạn gia công <span class="req">*</span></div>${stagePickerHtml(o.stages)}`,
      foot: gcFoot('gc-make-lsx-save', id, 'Tạo lệnh sản xuất', 'fa-industry') });
  }
  function makeLsxSave(id) {
    const o = find(id); if (!need(o, ['IN_PRODUCTION'])) return;
    const stages = readStages(); if (!stages.length) { Toast.err('Chưa chọn công đoạn', 'Chọn ít nhất một công đoạn gia công.'); return; }
    let po; try { po = createLsx(o, stages); } catch (err) { Toast.err('Chưa tạo được lệnh sản xuất', err?.message || ''); return; }
    (o.production = o.production || {}).lsxId = po.id;
    log(o, `Tạo lệnh sản xuất ${po.id} (${stages.length} công đoạn gia công).`); done(o, 'Đã tạo lệnh sản xuất', po.id);
  }
  function openLsx(id) {
    const o = find(id), po = o && linkedPo(o);
    if (!po) { Toast.warn('Chưa có lệnh sản xuất', 'Đơn này chưa được liên kết với lệnh sản xuất.'); return; }
    Modal.close(); Actions['open-production-order']?.({ id: po.id });
  }
  function openFinish(id) {
    const o = find(id); if (!need(o, ['IN_PRODUCTION'])) return;
    const rows = mats(o).map((m, i) => `<tr data-i="${i}"><td>${esc(m.name)}</td><td class="right num">${fmtDec(num(m.qtyAccepted) - num(m.qtyUsed), 2)} ${esc(m.unit || '')}</td><td><input class="inp right num gc-used" type="number" min="0" step="any" value="${Math.max(0, Math.min(num(m.qtyAccepted) - num(m.qtyUsed), num(m.qtyPlan)))}"></td></tr>`).join('');
    Modal.open({ title: `Hoàn thành sản xuất · ${esc(o.id)}`, sub: `${esc(o.productName)} · kế hoạch ${fmtDec(o.qty, 2)} ${esc(o.unit)}`, size: 'lg',
      body: `<div class="form-grid cols-2"><div class="field"><label>Sản lượng sản xuất được (${esc(o.unit)}) <span class="req">*</span></label><input class="inp right num" id="gcProduced" type="number" min="0" step="any" value="${num(o.qty)}"></div>
        <div class="field"><label>Phế phẩm trong sản xuất (${esc(o.unit)})</label><input class="inp right num" id="gcDefect" type="number" min="0" step="any" value="0"></div>
        <div class="field"><label>Giờ máy</label><input class="inp right num" id="gcMachineH" type="number" min="0" step="any"></div><div class="field"><label>Giờ công (nhân công)</label><input class="inp right num" id="gcLaborH" type="number" min="0" step="any"></div></div>
      <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>NVL khách đã dùng</div>
      <div class="tbl-wrap"><table class="line-tbl"><thead><tr><th>NVL</th><th class="right">Còn khả dụng (đạt QC)</th><th class="right">Đã dùng lần này</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="field" style="margin-top:12px"><label>Ghi chú sản xuất</label><textarea class="inp" id="gcFinishNote" rows="2"></textarea></div>`, foot: gcFoot('gc-finish-save', id, 'Hoàn thành sản xuất', 'fa-flag-checkered') });
  }
  function finishSave(id) {
    const o = find(id); if (!need(o, ['IN_PRODUCTION'])) return;
    const produced = num($('#gcProduced')?.value), defect = num($('#gcDefect')?.value);
    if (!(produced > 0)) { Toast.err('Sản lượng không hợp lệ', 'Sản lượng phải lớn hơn 0.'); return; }
    if (defect < 0 || defect > produced) { Toast.err('Phế phẩm không hợp lệ', 'Phế phẩm không được vượt sản lượng.'); return; }
    const used = [];
    for (const tr of document.querySelectorAll('tr[data-i]')) {
      const mi = Number(tr.dataset.i), m = mats(o)[mi], u = num(tr.querySelector('.gc-used')?.value);
      if (u < 0 || u > num(m.qtyAccepted) - num(m.qtyUsed) + EPS) { Toast.err('NVL dùng vượt tồn', `${m.name}: chỉ còn ${fmtDec(num(m.qtyAccepted) - num(m.qtyUsed), 2)} ${m.unit || ''} đạt QC.`); return; }
      used.push({ mi, u });
    }
    used.forEach((x) => { const m = mats(o)[x.mi]; m.qtyUsed = r4(num(m.qtyUsed) + x.u); });
    const p = o.production || (o.production = {});
    Object.assign(p, { completedAt: nowIso(), qtyProduced: produced, qtyDefect: defect, qtyGood: r4(produced - defect), machineHours: num($('#gcMachineH')?.value), laborHours: num($('#gcLaborH')?.value), note: ($('#gcFinishNote')?.value || '').trim() });
    p.elapsedH = p.startedAt ? Math.max(0, (new Date(p.completedAt) - new Date(p.startedAt)) / 3600000) : null;
    o.status = 'WAIT_FQC'; log(o, `Hoàn thành sản xuất: ${fmtDec(produced, 2)} ${o.unit}, phế ${fmtDec(defect, 2)}. Chờ QC thành phẩm.`);
    pushNotification({ level: 'warning', icon: 'fa-clipboard-check', title: `${o.id} chờ QC thành phẩm`, desc: `${o.productName} · ${fmtDec(p.qtyGood, 2)} ${o.unit}`, go: { module: 'quality', tab: 'subcontracting_qc' } });
    done(o, 'Đã hoàn thành sản xuất', 'Chuyển QC thành phẩm');
  }

  // --- QC thành phẩm
  function openFqc(id) {
    const o = find(id); if (!need(o, ['WAIT_FQC'])) return; const can = Auth.hasPermission('QC_INSPECT'); const total = num(o.production?.qtyGood);
    Modal.open({ title: `QC thành phẩm gia công · ${esc(o.id)}`, sub: `${esc(custName(o))} · ${esc(o.productName)}`, size: 'md',
      body: `<div class="info-grid" style="margin-bottom:12px">${infoItem('SL cần kiểm', `<b>${fmtDec(total, 2)}</b> ${esc(o.unit)}`)}${infoItem('Khách', esc(custName(o)))}</div>
      <div class="form-grid cols-2"><div class="field"><label>SL đạt</label><input class="inp right num" id="gcFPass" type="number" min="0" max="${total}" step="any" value="${total}" ${can ? '' : 'disabled'}></div>
        <div class="field"><label>SL không đạt</label><input class="inp right num" id="gcFFail" type="number" min="0" max="${total}" step="any" value="0" ${can ? '' : 'disabled'}></div>
        <div class="field"><label>Xử lý hàng không đạt</label><select class="inp" id="gcFDisp" ${can ? '' : 'disabled'}><option value="RETURN">Trả khách kèm biên bản</option><option value="SCRAP">Hủy theo thỏa thuận</option></select></div>
        <div class="field"><label>Lý do không đạt</label><input class="inp" id="gcFReason" ${can ? '' : 'disabled'}></div></div>
      <div class="cell-sub">SL đạt + không đạt = SL cần kiểm; nhập một ô, ô còn lại tự tính. Phí gia công tính theo SL đạt.</div>`,
      foot: can ? gcFoot('gc-fqc-save', id, 'Xác nhận kết quả QC', 'fa-clipboard-check') : '<button class="btn" data-act="modal-close">Đóng</button>' });
    qcBindComplement('#gcFPass', '#gcFFail', total);
  }
  function fqcSave(id) {
    const o = find(id); if (!need(o, ['WAIT_FQC'])) return; if (!Auth.hasPermission('QC_INSPECT')) { Toast.err('Không có quyền', 'Chỉ QC được xác nhận kết quả.'); return; }
    const total = num(o.production?.qtyGood), pass = num($('#gcFPass')?.value), fail = num($('#gcFFail')?.value), reason = ($('#gcFReason')?.value || '').trim();
    if (pass < 0 || fail < 0 || Math.abs(pass + fail - total) > 1e-6) { Toast.err('Số lượng không khớp', `Đạt + không đạt phải bằng ${fmtDec(total, 2)}.`); return; }
    if (fail > 0 && !reason) { Toast.err('Thiếu lý do', 'Ghi lý do cho phần không đạt.'); return; }
    (o.finalQcs = o.finalQcs || []).push({ at: nowIso(), by: DB.currentUser?.id || '', byName: who(), qty: total, passQty: pass, failQty: fail, disposition: $('#gcFDisp')?.value || 'RETURN', reason });
    o.status = pass > EPS ? 'READY_RETURN' : 'RETURNED';
    log(o, `QC thành phẩm: đạt ${fmtDec(pass, 2)}, không đạt ${fmtDec(fail, 2)} ${o.unit}.`);
    maybeComplete(o); done(o, 'Đã ghi nhận QC thành phẩm', pass > EPS ? 'Sẵn sàng trả hàng cho khách' : 'Không có hàng đạt để trả');
  }

  // --- Trả hàng / NVL dư
  function openReturn(id) {
    const o = find(id); if (!need(o, ['READY_RETURN', 'RETURNED'], 'Chỉ trả hàng sau khi QC thành phẩm.')) return;
    const goodLeft = Math.max(0, r4(passTotal(o) - returnedGood(o)));
    const rows = mats(o).map((m, i) => `<tr data-i="${i}"><td>${esc(m.name)}</td><td class="right num">${fmtDec(held(m), 2)} ${esc(m.unit || '')}</td><td><input class="inp right num gc-mret" type="number" min="0" step="any" value="${Math.max(0, held(m))}"></td></tr>`).join('');
    Modal.open({ title: `Trả hàng cho khách · ${esc(o.id)}`, sub: `${esc(custName(o))}`, size: 'lg',
      body: `<div class="form-grid cols-2"><div class="field"><label>Thành phẩm trả lần này (${esc(o.unit)}) — còn ${fmtDec(goodLeft, 2)}</label><input class="inp right num" id="gcRetQty" type="number" min="0" max="${goodLeft}" step="any" value="${goodLeft}"></div>
        <div class="field"><label>Người nhận hàng</label><input class="inp" id="gcReceiver"></div><div class="field"><label>Xe / vận chuyển</label><input class="inp" id="gcVehicle"></div><div class="field"><label>Ghi chú</label><input class="inp" id="gcRetNote"></div></div>
      <div class="form-sec-title"><i class="fa-solid fa-rotate-left"></i>NVL dư / không đạt trả lại khách</div>
      <div class="tbl-wrap"><table class="line-tbl"><thead><tr><th>NVL</th><th class="right">Đang giữ</th><th class="right">Trả lại</th></tr></thead><tbody>${rows}</tbody></table></div>`, foot: gcFoot('gc-return-save', id, 'Xác nhận trả hàng', 'fa-truck-ramp-box') });
  }
  function returnSave(id) {
    const o = find(id); if (!need(o, ['READY_RETURN', 'RETURNED'])) return;
    const goodLeft = Math.max(0, r4(passTotal(o) - returnedGood(o))), qty = num($('#gcRetQty')?.value);
    if (qty < 0 || qty > goodLeft + EPS) { Toast.err('Số lượng trả không hợp lệ', `Chỉ còn ${fmtDec(goodLeft, 2)} ${o.unit} đạt QC chưa trả.`); return; }
    const ml = [];
    for (const tr of document.querySelectorAll('tr[data-i]')) {
      const mi = Number(tr.dataset.i), m = mats(o)[mi], q = num(tr.querySelector('.gc-mret')?.value);
      if (q < 0 || q > held(m) + EPS) { Toast.err('NVL trả vượt số đang giữ', `${m.name}: đang giữ ${fmtDec(held(m), 2)} ${m.unit || ''}.`); return; }
      ml.push({ mi, qty: q });
    }
    if (qty <= 0 && !ml.some((x) => x.qty > 0)) { Toast.err('Chưa có gì để trả', 'Nhập thành phẩm hoặc NVL trả lại.'); return; }
    ml.forEach((x) => { const m = mats(o)[x.mi]; m.qtyReturned = r4(num(m.qtyReturned) + x.qty); });
    (o.returns = o.returns || []).push({ id: `TH-${o.id.split('-').slice(1).join('')}-${String((o.returns || []).length + 1).padStart(2, '0')}`, at: nowIso(), by: DB.currentUser?.id || '', qty, materials: ml, receiver: ($('#gcReceiver')?.value || '').trim(), vehicle: ($('#gcVehicle')?.value || '').trim(), note: ($('#gcRetNote')?.value || '').trim() });
    if (returnedGood(o) + EPS >= passTotal(o)) o.status = 'RETURNED';
    log(o, `Trả khách ${fmtDec(qty, 2)} ${o.unit} thành phẩm${ml.some((x) => x.qty > 0) ? ' và NVL dư' : ''}.`);
    maybeComplete(o);
    if (qty > 0) pushNotification({ level: 'info', icon: 'fa-truck-ramp-box', title: `${o.id} đã trả hàng cho khách`, desc: `${custName(o)} · ${fmtDec(qty, 2)} ${o.unit}`, go: { module: 'subcontracting', tab: 'orders' } });
    done(o, 'Đã trả hàng cho khách', o.status === 'COMPLETED' ? 'Đơn hoàn tất' : (debtOf(o) > 0 ? 'Tiếp theo: thu phí gia công' : o.id));
  }

  // --- Thu phí
  function openPay(id) {
    const o = find(id); if (!need(o, ['RETURNED'], 'Chỉ thu phí sau khi trả hàng.')) return;
    const room = collectable(o), pend = pendingPaid(o);
    if (room <= 0) { Toast.info(pend > 0 ? 'Đang chờ kế toán xác nhận' : 'Đã thu đủ', pend > 0 ? `Còn ${fmtVND(pend)} đã ghi nhận nhưng chưa được kế toán xác nhận đã nhận tiền.` : 'Không còn phí gia công cần thu.'); return; }
    // Các thành phần giống hệt "Ghi nhận thu tiền khách hàng" bên Kế toán / CRM
    const actorId = DB.currentUser?.userId || DB.currentUser?.id || '';
    const actorName = (String(DB.currentUser?.username || '').toLowerCase() === 'admin' || DB.currentUser?.roleId === 'ROLE_ADMIN') ? 'Admin' : (DB.currentUser?.name || Q.employeeName(DB.currentUser?.id));
    const hasActor = (DB.employees || []).some((e) => String(e.id) === String(DB.currentUser?.id) || String(e.id) === String(actorId));
    const people = `${hasActor ? '' : `<option value="${esc(actorId)}" selected>${esc(actorName)}</option>`}${(DB.employees || []).map((e) => `<option value="${esc(e.id)}" ${String(e.id) === String(DB.currentUser?.id) ? 'selected' : ''}>${esc(e.id + ' · ' + (e.name || e.fullName || ''))}</option>`).join('')}`;
    const banks = (DB.bankAccounts || []).map((b) => `<option value="${esc(b.id)}">${esc(b.name || ((b.bankName || 'Ngân hàng') + ' · ' + (b.accountNumber || '')))}</option>`).join('');
    Modal.open({ title: `Ghi nhận thu phí gia công · ${esc(o.id)}`, sub: `${esc(custName(o))} · phải thu ${fmtVND(feeTotal(o))} · còn ${fmtVND(room)}${pend > 0 ? ` (đang chờ xác nhận ${fmtVND(pend)})` : ''}`, size: 'md',
      body: `<div class="form-grid">
        <div class="field"><label>Số tiền thu (VND) <span class="req">*</span></label><input class="inp right num" type="text" inputmode="numeric" id="gcPayAmt" data-money="1" value="${room}"></div>
        <div class="field"><label>Ngày thanh toán</label><input class="inp" type="date" id="gcPayDate" value="${today()}"></div>
        <div class="field"><label>Phương thức</label><select class="inp" id="gcPayMethod"><option value="BANK_TRANSFER">Chuyển khoản ngân hàng</option><option value="CASH">Tiền mặt</option></select></div>
        <div class="field"><label>Người thực hiện <span class="req">*</span></label><select class="inp" id="gcPayPayer" data-search="1"><option value="">-- Chọn người thực hiện --</option>${people}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Định khoản <span class="req">*</span></label><select class="inp" id="gcPayEntry" data-search="1">${typeof accountingEntryOptions === 'function' ? accountingEntryOptions('THU') : '<option value="">-- Chọn định khoản --</option>'}</select></div>
      </div>
      <div id="gcPayBankWrap" class="form-grid">
        <div class="field"><label>Ngân hàng nhận tiền <span class="req">*</span></label><select class="inp" id="gcPayBank" data-search="1"><option value="">-- Chọn ngân hàng --</option>${banks}</select></div>
        <div class="field"><label>Mã giao dịch / tham chiếu</label><input class="inp" id="gcPayRef" placeholder="VD: FT12345678"></div>
      </div>
      <div class="field"><label>Ghi chú</label><input class="inp" id="gcPayNote" value="Thu phí gia công đơn ${esc(o.id)}"></div>
      ${canConfirmMoney() ? '' : '<div class="cell-sub">Khoản thu sẽ ở trạng thái <b>Chờ kế toán xác nhận</b> và chỉ tính vào “đã thu” sau khi kế toán xác nhận đã nhận tiền.</div>'}`,
      foot: gcFoot('gc-pay-save', id, 'Lưu lần thanh toán', 'fa-floppy-disk'),
      onMount: () => { const m = $('#gcPayMethod'), w = $('#gcPayBankWrap'); const sync = () => { if (w) w.style.display = m?.value === 'BANK_TRANSFER' ? 'grid' : 'none'; }; m?.addEventListener('change', sync); sync(); } });
  }
  async function paySave(id) {
    const o = find(id); if (!need(o, ['RETURNED'])) return;
    const room = collectable(o), amt = Math.round(money($('#gcPayAmt')?.value));
    const method = $('#gcPayMethod')?.value || 'BANK_TRANSFER', payerId = $('#gcPayPayer')?.value || '', entryId = $('#gcPayEntry')?.value || '';
    const bankId = method === 'BANK_TRANSFER' ? ($('#gcPayBank')?.value || '') : '';
    const payer = (DB.employees || []).find((e) => String(e.id) === String(payerId));
    const bank = (DB.bankAccounts || []).find((b) => String(b.id) === String(bankId));
    const date = $('#gcPayDate')?.value || today();
    if (!(amt > 0)) { Toast.err('Số tiền không hợp lệ', 'Vui lòng nhập số tiền lớn hơn 0.'); return; }
    if (amt > room) { Toast.err('Vượt quá số còn phải thu', `Số tiền thu ${fmtVND(amt)} lớn hơn số còn phải thu ${fmtVND(room)}${pendingPaid(o) > 0 ? ` (đã trừ ${fmtVND(pendingPaid(o))} đang chờ kế toán xác nhận)` : ''}.`); return; }
    if (!entryId) { Toast.err('Chưa chọn định khoản', 'Thu tiền bắt buộc phải chọn định khoản.'); return; }
    if (!payerId) { Toast.err('Chưa chọn người thực hiện', 'Vui lòng chọn người ghi nhận/thu khoản thanh toán này.'); return; }
    if (method === 'BANK_TRANSFER' && !bankId) { Toast.err('Chưa chọn ngân hàng', 'Vui lòng chọn tài khoản ngân hàng nhận tiền.'); return; }
    const autoConfirm = canConfirmMoney();
    const pid = `TT-${o.id.split('-').slice(1).join('')}-${String((o.payments || []).length + 1).padStart(2, '0')}`;
    const payment = {
      id: pid, date, amount: amt, method: method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt',
      bankId, bankName: bank?.name || bank?.bankName || '', bankAccount: bank?.accountNumber || '',
      payerId, payerName: payer?.name || payer?.fullName || (String(payerId) === String(DB.currentUser?.userId || DB.currentUser?.id) ? (DB.currentUser?.name || '') : Q.employeeName(payerId)),
      accountingEntryId: entryId, reference: ($('#gcPayRef')?.value || '').trim(), note: ($('#gcPayNote')?.value || '').trim(),
      by: DB.currentUser?.id || '', createdBy: DB.currentUser?.id || '', createdByName: DB.currentUser?.name || '', createdAt: nowIso(),
      confirmStatus: autoConfirm ? 'CONFIRMED' : 'PENDING',
      ...(autoConfirm ? { confirmedAt: nowIso(), confirmedBy: DB.currentUser?.id || '', confirmedByName: DB.currentUser?.name || '', receivedDate: date } : {}),
    };
    const btn = document.querySelector('[data-act="gc-pay-save"]'); if (btn) btn.disabled = true;
    try {
      if (autoConfirm && bankId && typeof AccountingBank !== 'undefined') {
        await AccountingBank.record({ bankId, type: 'IN', date, amount: amt, note: `Thu phí gia công ${o.id} · ${custName(o)}`, sourceType: 'SUBCONTRACT_PAYMENT', sourceId: pid, createdBy: payment.createdBy, accountingEntryId: entryId });
      }
    } catch (err) {
      console.error('[GC] Ghi sổ ngân hàng thất bại:', err); Toast.err('Chưa ghi nhận được thu tiền', err?.message || 'Không ghi được vào sổ ngân hàng.'); if (btn) btn.disabled = false; return;
    }
    (o.payments = o.payments || []).push(payment);
    if (autoConfirm) {
      log(o, `Thu phí gia công ${fmtVND(amt)} (${pid}).`); maybeComplete(o);
      done(o, 'Đã ghi nhận thu tiền', o.status === 'COMPLETED' ? 'Đơn hoàn tất' : `Còn phải thu ${fmtVND(debtOf(o))}`);
    } else {
      log(o, `Ghi nhận thu phí gia công ${fmtVND(amt)} (${pid}) — chờ kế toán xác nhận đã nhận tiền.`);
      try { if (typeof pushNotification === 'function') pushNotification({ level: 'warning', icon: 'fa-hand-holding-dollar', title: `Chờ xác nhận đã nhận tiền · ${custName(o)}`, desc: `${pid} · đơn gia công ${o.id} · ${fmtVND(amt)}`, go: { module: 'subcontracting' } }); } catch (e) { /* noop */ }
      done(o, 'Đã gửi kế toán xác nhận', `${pid} · ${fmtVND(amt)} · chưa tính vào đã thu cho đến khi kế toán xác nhận`);
    }
  }
  async function payConfirm(id, pid) {
    const o = find(id), p = (o?.payments || []).find((x) => x.id === pid); if (!p || isConfirmed(p)) return;
    if (!canConfirmMoney()) { Toast.err('Không đủ quyền', 'Chỉ kế toán mới xác nhận đã nhận tiền.'); return; }
    try {
      if (p.bankId && typeof AccountingBank !== 'undefined') await AccountingBank.record({ bankId: p.bankId, type: 'IN', date: p.date, amount: p.amount, note: `Thu phí gia công ${o.id} · ${custName(o)}`, sourceType: 'SUBCONTRACT_PAYMENT', sourceId: p.id, createdBy: p.createdBy || '', accountingEntryId: p.accountingEntryId || '' });
    } catch (err) { Toast.err('Chưa xác nhận được', err?.message || 'Không ghi được vào sổ ngân hàng.'); return; }
    Object.assign(p, { confirmStatus: 'CONFIRMED', confirmedAt: nowIso(), confirmedBy: DB.currentUser?.id || '', confirmedByName: DB.currentUser?.name || '', receivedDate: p.date });
    log(o, `Kế toán xác nhận đã nhận ${fmtVND(p.amount)} (${p.id}).`); maybeComplete(o); persist(); audit(o, 'Xác nhận đã nhận tiền', `${o.id}: ${p.id}`);
    Modal.close(); render(); openDetail(o.id); Toast.ok('Đã xác nhận đã nhận tiền', `${p.id} · ${fmtVND(p.amount)}`);
  }

  /* ------------------------------------------------------------------ QC (menu Kiểm tra chất lượng → Kiểm tra gia công) */
  window.gcQcPendingCount = () => orders().filter((o) => o.status === 'MATERIAL_QC' || o.status === 'WAIT_FQC').length;
  window.subcontractingInspectionView = function () {
    const list = orders().filter((o) => ['MATERIAL_QC', 'WAIT_FQC'].includes(o.status));
    const rows = list.map((o) => {
      const isM = o.status === 'MATERIAL_QC';
      return `<tr class="clickable" data-act="${isM ? 'gc-mqc' : 'gc-fqc'}" data-id="${esc(o.id)}"><td>${cell2(`<span class="code">${esc(o.id)}</span>`, esc(custName(o)))}</td>
        <td>${isM ? '<span class="badge purple">QC nguyên vật liệu</span>' : '<span class="badge purple">QC thành phẩm</span>'}</td>
        <td>${isM ? mats(o).filter((m) => num(m.qtyPendingQc) > EPS).map((m) => `${esc(m.name)}: <b>${fmtDec(m.qtyPendingQc, 2)}</b> ${esc(m.unit || '')}`).join('<br>') : `${esc(o.productName)}: <b>${fmtDec(o.production?.qtyGood, 2)}</b> ${esc(o.unit)}`}</td>
        <td>${dueHtml(o)}</td><td class="right">${rowActions([{ act: isM ? 'gc-mqc' : 'gc-fqc', data: `data-id="${esc(o.id)}"`, icon: 'fa-vial-circle-check', title: 'Kiểm tra' }])}</td></tr>`;
    });
    const hist = [];
    orders().forEach((o) => { (o.materialQcs || []).forEach((q) => hist.push({ at: q.at, o, kind: 'NVL', q })); (o.finalQcs || []).forEach((q) => hist.push({ at: q.at, o, kind: 'Thành phẩm', q })); });
    hist.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const hrows = hist.slice(0, 15).map((h) => {
      const fail = h.kind === 'NVL' ? (h.q.items || []).reduce((s, i) => s + num(i.failQty), 0) : num(h.q.failQty);
      return `<tr><td>${dt(h.at)}</td><td><span class="code">${esc(h.o.id)}</span><div class="cell-sub">${esc(custName(h.o))}</div></td><td>${h.kind}</td><td>${esc(h.q.byName || '')}</td><td>${fail > 0 ? `<span class="badge red">Không đạt ${fmtDec(fail, 2)}</span>` : '<span class="badge green">Đạt</span>'}</td></tr>`;
    });
    return `${pageHead('Kiểm tra gia công', 'QC nguyên vật liệu khách gửi trước khi sản xuất và QC thành phẩm gia công trước khi trả khách')}
      <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Chờ QC NVL', list.filter((o) => o.status === 'MATERIAL_QC').length, 'fa-boxes-stacked', 'orange')}${mkpi('Chờ QC thành phẩm', list.filter((o) => o.status === 'WAIT_FQC').length, 'fa-clipboard-check', 'purple')}</div>
      <div class="card"><div class="card-head"><div><h3>Chờ kiểm tra</h3></div></div>${tableShell([{ t: 'Đơn / Khách' }, { t: 'Loại QC' }, { t: 'Nội dung kiểm' }, { t: 'Hạn trả' }, { t: '', cls: 'right', w: '80px' }], rows, { emptyTitle: 'Không có đơn gia công chờ QC' })}</div>
      <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Lịch sử kiểm tra gần đây</h3></div></div>${tableShell([{ t: 'Thời gian' }, { t: 'Đơn' }, { t: 'Loại' }, { t: 'QC' }, { t: 'Kết quả' }], hrows, { emptyTitle: 'Chưa có lịch sử kiểm tra' })}</div>`;
  };

  /* ------------------------------------------------------------------ Kho: tab "Kế hoạch gia công" */
  window.gcWarehousePlanTab = function (tabsHtml) {
    const list = orders().filter((o) => !['DRAFT', 'CANCELLED'].includes(o.status));
    const rows = list.map((o) => `<tr class="clickable" data-act="subcontracting-open" data-id="${esc(o.id)}"><td><span class="code">${esc(o.id)}</span></td><td>${esc(custName(o))}</td><td>${esc(o.productName)}<div class="cell-sub">SL ${fmtDec(o.qty, 2)} ${esc(o.unit)}</div></td>
      <td>${mats(o).map((m) => `${esc(m.name)}: ${fmtDec(held(m), 2)} ${esc(m.unit || '')}`).join('<br>') || '—'}</td><td>${dueHtml(o)}</td><td>${statusHtml(o.status)}</td></tr>`);
    return `${pageHead('Kế hoạch sản xuất & gia công', 'Gia công cho khách: NVL do khách gửi, theo dõi riêng, không cộng vào tồn kho công ty')}${tabsHtml}
      <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Đơn gia công', list.length, 'fa-clipboard-list', 'blue')}${mkpi('Chờ nhận NVL', list.filter((o) => o.status === 'WAIT_MATERIAL').length, 'fa-box-open', 'orange')}${mkpi('Đang xử lý', list.filter(isOpen).length, 'fa-gears', 'green')}</div>
      <div class="card">${tableShell([{ t: 'Đơn' }, { t: 'Khách hàng' }, { t: 'Sản phẩm / SL' }, { t: 'NVL khách đang giữ' }, { t: 'Hạn trả' }, { t: 'Trạng thái' }], rows, { emptyTitle: 'Chưa có đơn gia công' })}</div>`;
  };

  /* ------------------------------------------------------------------ vô hiệu hoá luồng cũ + đăng ký action */
  // Kho / module khác từng đọc đơn gia công ngoài cũ: trả rỗng để không còn phiếu xuất NVL/nhập TP cho đối tác.
  window.subcontractV3Orders = () => [];
  window.subcontractV3Receipts = () => [];
  window.openSubcontractingDetail = openDetail;
  window.openSubcontractingForm = openForm;

  const guard = (fn) => (d) => fn(d.id || '');
  Object.assign(Actions, {
    'subcontracting-new': () => openForm(''),
    'subcontracting-open': (d) => openDetail(d.id),
    'subcontracting-edit': (d) => openForm(d.id),
    'subcontracting-save': (d) => saveOrder(d.id || ''),
    'subcontracting-delete': guard(del),
    'subcontracting-approve': guard(approve),
    'gc-mat-add': () => { $('#gcMatRows')?.insertAdjacentHTML('beforeend', matRowHtml()); },
    'gc-mat-del': (d, el) => { const row = (el || document.activeElement)?.closest?.('.gc-mat'); if (row && document.querySelectorAll('.gc-mat').length > 1) row.remove(); },
    'gc-receive': guard(openReceive), 'gc-receive-save': guard(receiveSave),
    'gc-mqc': guard(openMqc), 'gc-mqc-save': guard(mqcSave),
    'gc-start': guard(openStart), 'gc-start-save': guard(startSave),
    'gc-make-lsx': guard(openMakeLsx), 'gc-make-lsx-save': guard(makeLsxSave), 'gc-open-lsx': guard(openLsx),
    'gc-finish': guard(openFinish), 'gc-finish-save': guard(finishSave),
    'gc-fqc': guard(openFqc), 'gc-fqc-save': guard(fqcSave),
    'gc-return': guard(openReturn), 'gc-return-save': guard(returnSave),
    'gc-pay': async (d) => { if (typeof accountingEntriesEnsureFresh === 'function') { try { await accountingEntriesEnsureFresh(false); } catch (e) { /* dùng cache */ } } openPay(d.id || ''); },
    'gc-pay-save': (d) => paySave(d.id || ''), 'gc-pay-confirm': (d) => payConfirm(d.id || '', d.pid || ''),
    'gc-stage-all': () => { document.querySelectorAll('#gcStageList .gc-stage-item:not([hidden]) .gc-stage-cb').forEach((c) => { c.checked = true; }); stageCount(); },
    'gc-stage-none': () => { document.querySelectorAll('#gcStageList .gc-stage-cb').forEach((c) => { c.checked = false; }); stageCount(); },
    'gc-stage-add': () => {
      const inp = $('#gcStageCustom'), name = (inp?.value || '').trim(); if (!name) return;
      const ex = [...document.querySelectorAll('.gc-stage-cb')].find((c) => norm(c.dataset.name) === norm(name));
      if (ex) { ex.checked = true; ex.closest('.gc-stage-item')?.removeAttribute('hidden'); }
      else { const list = $('#gcStageList'); list?.querySelector(':scope > .cell-sub')?.remove(); list?.insertAdjacentHTML('beforeend', `<label class="gc-stage-item is-on" data-q="${esc(norm(name))}"><input type="checkbox" class="gc-stage-cb" value="${esc(name)}" data-name="${esc(name)}" checked><span>${esc(name)}</span></label>`); }
      if (inp) inp.value = ''; stageCount();
    },
    'gc-cancel': guard(openCancel), 'gc-cancel-save': guard(cancelSave),
  });
  // Các action của luồng gia công ngoài cũ: không còn áp dụng.
  ['subcontracting-issue', 'subcontracting-issue-confirm', 'subcontracting-handover', 'subcontracting-handover-confirm', 'subcontracting-progress-update', 'subcontracting-progress-save',
    'subcontracting-receive', 'subcontracting-receive-confirm', 'subcontracting-qc', 'subcontracting-qc-confirm', 'subcontracting-warehouse', 'subcontracting-warehouse-confirm',
    'subcontracting-reconcile', 'subcontracting-reconcile-confirm', 'subcontracting-pay', 'subcontracting-pay-save', 'subcontracting-partner-new', 'subcontracting-partner-edit',
    'subcontracting-partner-save', 'subcontracting-partner-detail', 'subcontracting-partner-delete', 'warehouse-open-subcontract-issue']
    .forEach((k) => { Actions[k] = () => Toast.info('Luồng gia công đã thay đổi', 'Gia công nay là gia công cho khách: khách gửi NVL, công ty sản xuất và thu phí.'); });
  Actions['subcontracting-go-qc'] = () => go('quality', { tab: 'subcontracting_qc' });
})();
