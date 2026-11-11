/* ============================================================================
 * MUA HÀNG — SO SÁNH NHÀ CUNG CẤP THEO NHIỀU TIÊU CHÍ (đợt 6) — nạp SAU mod-purchases.js
 * ----------------------------------------------------------------------------
 * Ngoài giá, bảng so sánh chấm điểm 0–100 theo các tiêu chí có trọng số:
 *   giá báo (chỉ số so với giá thấp nhất từng mặt hàng) · độ phủ mặt hàng · thời gian giao hàng ·
 *   điều khoản thanh toán (tạm ứng / công nợ) · chất lượng · chứng nhận (ISO/HACCP/ATTP) ·
 *   bảo hành / đổi trả · chi phí vận chuyển · lịch sử giao hàng của NCC (từ PO + phiếu nhập kho).
 * Tiêu chí nhập tay được lưu nháp cho đến khi "Xác nhận chọn NCC"; khi xác nhận, tiêu chí, điểm, xếp hạng,
 * trọng số và lý do chọn được ghi vào từng báo giá NCC (BG-NCC) để truy vết.
 * ========================================================================== */
(function () {
  'use strict';
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const r1 = (v) => Math.round(n(v) * 10) / 10;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const money = (v) => (typeof fmtVND === 'function' ? fmtVND(v) : Math.round(n(v)).toLocaleString('vi-VN') + 'đ');

  /* ------------------------------------------------------------------ tiêu chí */
  const CRITERIA = [
    { key: 'price', label: 'Giá báo', hint: 'So với giá thấp nhất của từng mặt hàng', auto: true },
    { key: 'coverage', label: 'Độ phủ mặt hàng', hint: 'Tỷ lệ mặt hàng NCC báo giá', auto: true },
    { key: 'lead', label: 'Thời gian giao hàng', hint: 'Số ngày — càng ngắn càng tốt' },
    { key: 'payment', label: 'Điều khoản thanh toán', hint: 'Tạm ứng thấp và công nợ dài thì điểm cao' },
    { key: 'quality', label: 'Chất lượng', hint: 'Đánh giá 1–5 (mẫu, lô trước, tiêu chuẩn)' },
    { key: 'cert', label: 'Chứng nhận', hint: 'ISO / HACCP / ATTP' },
    { key: 'warranty', label: 'Bảo hành / đổi trả', hint: 'Số ngày đổi trả khi lỗi' },
    { key: 'shipping', label: 'Chi phí vận chuyển', hint: 'NCC chịu = điểm tối đa' },
    { key: 'history', label: 'Lịch sử giao hàng', hint: 'Tự tính từ PO và phiếu nhập kho', auto: true },
  ];
  const DEFAULT_WEIGHTS = { price: 35, coverage: 10, lead: 15, payment: 10, quality: 10, cert: 5, warranty: 3, shipping: 2, history: 10 };
  const BLANK = () => ({ leadTimeDays: '', advancePct: '', creditDays: '', quality: '', certified: false, warrantyDays: '', shippingCost: '', shippingBy: 'BUYER', note: '' });

  /* ------------------------------------------------------------------ lưu trữ trọng số (KIO nếu có) + bản nháp */
  const CFG_TABLE = 'lenam_purchase_compare_config', CFG_LS = 'lenam_po_compare_cfg_v1', DRAFT_LS = 'lenam_po_compare_draft_v1';
  let weights = (() => { try { return { ...DEFAULT_WEIGHTS, ...(JSON.parse(localStorage.getItem(CFG_LS) || '{}') || {}) }; } catch (_) { return { ...DEFAULT_WEIGHTS }; } })();
  let cfgLoaded = false;
  async function loadWeights() {
    if (cfgLoaded) return; cfgLoaded = true;
    try { if (typeof KioStore !== 'undefined') { const rows = await KioStore.listCollection(CFG_TABLE, { force: false }); const r = (rows || []).find((x) => x.id === 'weights'); if (r?.weights) { weights = { ...DEFAULT_WEIGHTS, ...r.weights }; try { localStorage.setItem(CFG_LS, JSON.stringify(weights)); } catch (_) {} if (typeof render === 'function' && State.module === 'purchases') render(); } } } catch (e) { console.warn('[POCompare] không tải được trọng số', e); }
  }
  async function saveWeights(w) {
    weights = { ...DEFAULT_WEIGHTS, ...w }; try { localStorage.setItem(CFG_LS, JSON.stringify(weights)); } catch (_) {}
    if (typeof KioStore !== 'undefined') await KioStore.saveSingleton(CFG_TABLE, 'weights', { id: 'weights', weights, updatedAt: new Date().toISOString(), updatedBy: DB.currentUser?.name || DB.currentUser?.id || '' });
  }
  const drafts = (() => { try { return JSON.parse(localStorage.getItem(DRAFT_LS) || '{}') || {}; } catch (_) { return {}; } })();
  const saveDrafts = () => { try { localStorage.setItem(DRAFT_LS, JSON.stringify(drafts)); } catch (_) {} };
  const draftOf = (prId, supplierId) => ((drafts[prId] = drafts[prId] || {})[supplierId] = { ...BLANK(), ...(drafts[prId]?.[supplierId] || {}) });

  /* ------------------------------------------------------------------ lịch sử giao hàng của NCC */
  function supplierHistory(supplierId) {
    const pos = (DB.purchaseOrders || []).filter((p) => p.supplierId === supplierId && ['RECEIVED', 'PARTIAL_RECEIVED'].includes(p.status));
    if (!pos.length) return { pos: 0, onTime: null, fulfil: null, score: null };
    let rcpts = 0, onTime = 0, ordered = 0, received = 0;
    pos.forEach((po) => {
      (po.items || []).forEach((it) => { ordered += n(it.qty); received += n(it.receivedQty); });
      (DB.goodsReceipts || []).filter((g) => g.poId === po.id).forEach((g) => { rcpts++; if (!po.expectedDate || String(g.date) <= String(po.expectedDate)) onTime++; });
    });
    const onT = rcpts ? onTime / rcpts : null, ful = ordered ? Math.min(1, received / ordered) : null;
    const parts = [onT, ful].filter((v) => v != null);
    return { pos: pos.length, onTime: onT, fulfil: ful, score: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length * 100 : null };
  }

  /* ------------------------------------------------------------------ chấm điểm (thuần logic, có kiểm thử) */
  /**
   * items: [{materialId, qty}]; prices: { supplierId: { materialId: price } }
   * criteria: { supplierId: {...BLANK} }; history: { supplierId: {score,...} }
   */
  function scoreSuppliers(items, prices, criteria, history, w = weights) {
    const sup = Object.keys(prices);
    const out = {};
    const lowest = {}; items.forEach((it) => { const ps = sup.map((s) => n(prices[s]?.[it.materialId])).filter((p) => p > 0); lowest[it.materialId] = ps.length ? Math.min(...ps) : 0; });
    const leads = sup.map((s) => n(criteria[s]?.leadTimeDays)).filter((v) => v > 0), minLead = leads.length ? Math.min(...leads) : 0;
    const ships = sup.map((s) => (criteria[s]?.shippingBy === 'SUPPLIER' ? 0 : n(criteria[s]?.shippingCost))), minShip = Math.min(...ships.filter((v) => v > 0), Infinity);
    sup.forEach((s) => {
      const c = criteria[s] || BLANK(); const quoted = items.filter((it) => n(prices[s]?.[it.materialId]) > 0);
      const total = quoted.reduce((a, it) => a + n(prices[s][it.materialId]) * n(it.qty), 0);
      const idx = quoted.length ? quoted.reduce((a, it) => a + lowest[it.materialId] / n(prices[s][it.materialId]), 0) / quoted.length * 100 : 0;
      const sc = {};
      sc.price = idx; sc.coverage = items.length ? quoted.length / items.length * 100 : 0;
      sc.lead = n(c.leadTimeDays) > 0 ? (minLead / n(c.leadTimeDays)) * 100 : null;
      const hasPay = c.advancePct !== '' && c.advancePct != null || c.creditDays !== '' && c.creditDays != null;
      sc.payment = hasPay ? clamp(Math.min(n(c.creditDays), 60) / 60 * 60 + (100 - clamp(n(c.advancePct), 0, 100)) / 100 * 40, 0, 100) : null;
      sc.quality = n(c.quality) > 0 ? clamp(n(c.quality), 1, 5) * 20 : null;
      sc.cert = c.certified ? 100 : 0;
      sc.warranty = c.warrantyDays !== '' && c.warrantyDays != null ? clamp(n(c.warrantyDays) / 30, 0, 1) * 100 : null;
      const ship = c.shippingBy === 'SUPPLIER' ? 0 : n(c.shippingCost);
      sc.shipping = c.shippingBy === 'SUPPLIER' ? 100 : (c.shippingCost === '' || c.shippingCost == null ? null : (ship === 0 ? 100 : (Number.isFinite(minShip) ? (minShip / ship) * 100 : 100)));
      sc.history = history[s]?.score != null ? history[s].score : null;
      // Tiêu chí chưa có dữ liệu (null) được bỏ ra khỏi mẫu số — không phạt NCC vì thiếu thông tin, nhưng báo "thiếu dữ liệu".
      let num = 0, den = 0, missing = [];
      CRITERIA.forEach((cr) => { const wt = n(w[cr.key]); if (sc[cr.key] == null) { if (wt > 0) missing.push(cr.key); return; } num += wt * clamp(sc[cr.key], 0, 100); den += wt; });
      out[s] = { supplierId: s, total, quotedCount: quoted.length, coverage: sc.coverage, scores: sc, weighted: den > 0 ? num / den : 0, usedWeight: den, missing };
    });
    const ranked = Object.values(out).filter((x) => x.quotedCount > 0).sort((a, b) => b.weighted - a.weighted || a.total - b.total);
    ranked.forEach((x, i) => { x.rank = i + 1; });
    return { bySupplier: out, ranked, best: ranked[0]?.supplierId || '' };
  }

  /* ------------------------------------------------------------------ dữ liệu từ giao diện (giá nhập trực tiếp) */
  const parseM = (v) => (typeof parseMoney === 'function' ? parseMoney(v) : n(String(v || '').replace(/[^\d]/g, '')));
  const prOf = (id) => (typeof Q !== 'undefined' && Q.purchase ? Q.purchase(id) : (DB.purchases || []).find((p) => p.id === id));
  const supplierName = (id) => (typeof Q !== 'undefined' && Q.supplierName ? Q.supplierName(id) : id);
  function pricesFromDom(pr) {
    const prices = {};
    document.querySelectorAll(`input.quote-supplier-price[data-pr-id="${pr.id}"]`).forEach((el) => { const p = parseM(el.value); (prices[el.dataset.supplierId] = prices[el.dataset.supplierId] || {})[el.dataset.materialId] = p; });
    return prices;
  }
  function pricesFromQuotes(pr) {
    const prices = {}; (DB.supplierQuotations || []).filter((q) => q.prId === pr.id).forEach((q) => (q.items || []).forEach((it) => { (prices[q.supplierId] = prices[q.supplierId] || {})[it.materialId] = n(it.price); }));
    return prices;
  }
  const isLocked = (pr) => (DB.supplierQuotations || []).filter((q) => q.prId === pr.id).some((q) => q.confirmed || q.confirmedAt);
  function selectionFromDom(pr) {
    const sel = {}; (pr.items || []).forEach((it) => { const c = document.querySelector(`input.quote-supplier-choice[data-pr-id="${pr.id}"][data-material-id="${it.materialId}"]:checked`); if (c) sel[it.materialId] = c.dataset.supplierId; });
    return sel;
  }
  function compute(pr) {
    const locked = isLocked(pr); const items = (pr.items || []).map((i) => ({ materialId: i.materialId, qty: n(i.qty), name: i.name }));
    const prices = locked ? pricesFromQuotes(pr) : pricesFromDom(pr);
    Object.keys(prices).forEach((s) => { if (!Object.values(prices[s]).some((p) => p > 0)) delete prices[s]; });
    const criteria = {}, history = {};
    Object.keys(prices).forEach((s) => { history[s] = supplierHistory(s); criteria[s] = locked ? { ...BLANK(), ...((DB.supplierQuotations.find((q) => q.prId === pr.id && q.supplierId === s)?.criteria) || {}) } : draftOf(pr.id, s); });
    const useW = locked ? { ...DEFAULT_WEIGHTS, ...((DB.supplierQuotations.find((q) => q.prId === pr.id && q.compareWeights)?.compareWeights) || weights) } : weights;
    return { locked, items, prices, criteria, history, w: useW, result: scoreSuppliers(items, prices, criteria, history, useW) };
  }

  /* ------------------------------------------------------------------ giao diện */
  const esc2 = (v) => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
  const scoreCell = (v) => (v == null ? '<span class="muted" title="Chưa có dữ liệu — không tính vào điểm">—</span>' : `<span class="strong">${r1(v)}</span>`);
  function inputRow(label, hint, supp, ctx, html) { return `<tr><td>${label}<div class="cell-sub">${hint}</div></td>${supp.map((s) => `<td>${html(s, ctx.criteria[s])}${scoreLine(ctx, s, null)}</td>`).join('')}</tr>`; }
  const scoreLine = () => '';
  function panelHtml(pr) {
    const ctx = compute(pr); const supp = Object.keys(ctx.prices); const res = ctx.result; const lock = ctx.locked;
    const dis = lock ? 'disabled' : '';
    const num = (s, key, ph, w = 80) => `<input class="inp right num po-crit" style="width:${w}px" type="number" min="0" data-pr="${pr.id}" data-sup="${s}" data-key="${key}" value="${esc2(ctx.criteria[s][key])}" placeholder="${ph}" ${dis}>`;
    const rows = [];
    rows.push(`<tr><td><b>Giá báo (tổng các mặt hàng đã báo)</b><div class="cell-sub">${CRITERIA[0].hint}</div></td>${supp.map((s) => `<td class="right num"><b>${money(res.bySupplier[s].total)}</b><div class="cell-sub">${res.bySupplier[s].quotedCount}/${ctx.items.length} mặt hàng</div></td>`).join('')}</tr>`);
    rows.push(inputRow('Thời gian giao hàng (ngày)', CRITERIA[2].hint, supp, ctx, (s) => num(s, 'leadTimeDays', 'ngày')));
    rows.push(inputRow('Tạm ứng (%) · Công nợ (ngày)', CRITERIA[3].hint, supp, ctx, (s) => `${num(s, 'advancePct', '%', 62)} <span class="muted">/</span> ${num(s, 'creditDays', 'ngày', 62)}`));
    rows.push(inputRow('Chất lượng (1–5)', CRITERIA[4].hint, supp, ctx, (s) => `<select class="inp po-crit" data-pr="${pr.id}" data-sup="${s}" data-key="quality" ${dis}><option value="">—</option>${[1, 2, 3, 4, 5].map((v) => `<option value="${v}" ${String(ctx.criteria[s].quality) === String(v) ? 'selected' : ''}>${v}</option>`).join('')}</select>`));
    rows.push(inputRow('Chứng nhận ISO / HACCP / ATTP', CRITERIA[5].hint, supp, ctx, (s) => `<label><input type="checkbox" class="po-crit" data-pr="${pr.id}" data-sup="${s}" data-key="certified" ${ctx.criteria[s].certified ? 'checked' : ''} ${dis}> Có</label>`));
    rows.push(inputRow('Bảo hành / đổi trả (ngày)', CRITERIA[6].hint, supp, ctx, (s) => num(s, 'warrantyDays', 'ngày')));
    rows.push(inputRow('Vận chuyển', CRITERIA[7].hint, supp, ctx, (s) => `<select class="inp po-crit" data-pr="${pr.id}" data-sup="${s}" data-key="shippingBy" ${dis}><option value="BUYER" ${ctx.criteria[s].shippingBy !== 'SUPPLIER' ? 'selected' : ''}>Bên mua chịu</option><option value="SUPPLIER" ${ctx.criteria[s].shippingBy === 'SUPPLIER' ? 'selected' : ''}>NCC chịu</option></select> ${ctx.criteria[s].shippingBy !== 'SUPPLIER' ? num(s, 'shippingCost', 'đ', 90) : ''}`));
    rows.push(`<tr><td>Lịch sử giao hàng<div class="cell-sub">${CRITERIA[8].hint}</div></td>${supp.map((s) => { const h = ctx.history[s]; return `<td>${h.pos ? `${h.pos} PO · đúng hạn ${h.onTime != null ? Math.round(h.onTime * 100) + '%' : '—'} · đủ hàng ${h.fulfil != null ? Math.round(h.fulfil * 100) + '%' : '—'}` : '<span class="muted">Chưa có lịch sử</span>'}</td>`; }).join('')}</tr>`);
    const crow = (cr) => `<tr style="background:var(--bg-soft,#f6f8fb)"><td><span class="cell-sub">Điểm — ${cr.label} (trọng số ${n(ctx.w[cr.key])})</span></td>${supp.map((s) => `<td class="right num cell-sub">${res.bySupplier[s].scores[cr.key] == null ? '—' : r1(res.bySupplier[s].scores[cr.key])}</td>`).join('')}</tr>`;
    const detail = F('po-compare', { detail: false }).detail ? CRITERIA.map(crow).join('') : '';
    const rankRow = `<tr style="border-top:2px solid var(--border)"><td><b>TỔNG ĐIỂM (0–100)</b><div class="cell-sub">Tiêu chí chưa có dữ liệu không bị trừ điểm</div></td>${supp.map((s) => { const x = res.bySupplier[s]; const best = res.best === s; return `<td class="right"><span class="badge ${best ? 'green' : 'slate'}" style="font-size:14px">${r1(x.weighted)}</span><div class="cell-sub">${x.rank ? 'Hạng ' + x.rank : ''}${best ? ' · <b style="color:var(--green)">Đề xuất</b>' : ''}</div>${x.missing.length ? `<div class="cell-sub" style="color:var(--orange)">Thiếu: ${x.missing.map((k) => CRITERIA.find((c) => c.key === k).label).join(', ')}</div>` : ''}</td>`; }).join('')}</tr>`;
    const sel = lock ? {} : selectionFromDom(pr); const dev = !lock && res.best && Object.entries(sel).some(([m, s]) => s !== bestForItem(res, ctx, m));
    const reasonQ = lock ? (DB.supplierQuotations.find((q) => q.prId === pr.id && q.selectionReason)?.selectionReason || '') : (drafts[pr.id]?.__reason || '');
    return `<div id="poComparePanel" class="card" style="margin:12px 0 4px;border-left:3px solid var(--blue,#2563eb)" data-pr="${pr.id}">
      <div class="card-head"><div><h3>So sánh nhà cung cấp theo tiêu chí</h3><p>Giá chỉ là một phần: so sánh thêm thời gian giao, thanh toán, chất lượng, chứng nhận, bảo hành, vận chuyển và lịch sử giao hàng</p></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-sm" data-act="poc-detail"><i class="fa-solid fa-list-ol"></i>${F('po-compare').detail ? 'Ẩn' : 'Hiện'} điểm từng tiêu chí</button><button class="btn btn-sm" data-act="poc-weights"><i class="fa-solid fa-sliders"></i>Trọng số</button>${lock ? '' : `<button class="btn btn-sm btn-primary" data-act="poc-pick-best" data-pr="${pr.id}" ${res.best ? '' : 'disabled'}><i class="fa-solid fa-trophy"></i>Chọn NCC điểm cao nhất</button>`}</div></div>
      ${supp.length < 2 && !lock ? '<div class="cell-sub" style="margin:8px 0">Nhập giá của ít nhất 2 nhà cung cấp để so sánh.</div>' : ''}
      <div class="tbl-wrap" style="overflow:auto"><table class="line-tbl"><thead><tr><th style="min-width:230px">Tiêu chí</th>${supp.map((s) => `<th class="right" style="min-width:170px">${esc2(supplierName(s))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}${detail}${rankRow}</tbody></table></div>
      ${dev ? `<div class="alert warning" style="margin-top:10px"><i class="fa-solid fa-triangle-exclamation"></i><span>Bạn đang chọn NCC khác với đề xuất theo điểm. Ghi lý do để lưu vào báo giá.</span></div>` : ''}
      <div class="field" style="margin-top:10px"><label>Lý do chọn NCC ${dev ? '<span class="req">*</span>' : '(nếu khác đề xuất)'}</label><input class="inp" id="pocReason" value="${esc2(reasonQ)}" placeholder="Ví dụ: NCC điểm cao hết hàng, cần giao gấp…" ${dis}></div></div>`;
  }
  function bestForItem(res, ctx, materialId) {
    const cand = res.ranked.filter((x) => n(ctx.prices[x.supplierId]?.[materialId]) > 0); return cand[0]?.supplierId || '';
  }
  window.POCompare = { scoreSuppliers, DEFAULT_WEIGHTS, CRITERIA, supplierHistory, BLANK, drafts };

  /* ------------------------------------------------------------------ gắn vào màn Báo giá (sau mỗi lần render) */
  function inject() {
    const prId = (F('purchases') || {}).prId; document.getElementById('poComparePanel')?.remove();
    if (State.module !== 'purchases' || !prId) return; const pr = prOf(prId); if (!pr) return;
    const anchor = document.querySelector(`input.quote-supplier-price[data-pr-id="${prId}"]`) || document.querySelector('.quote-supplier-line');
    const host = anchor?.closest('div[style*="padding:4px 2px 8px"]') || anchor?.closest('table')?.parentElement; if (!host) return;
    host.insertAdjacentHTML('beforeend', panelHtml(pr));
  }
  function refresh() { const p = document.getElementById('poComparePanel'); if (!p) return; const pr = prOf(p.dataset.pr); if (!pr) return; const active = document.activeElement; const key = active?.dataset?.key, sup = active?.dataset?.sup, pos = active?.selectionStart; p.outerHTML = panelHtml(pr); if (key) { const el = document.querySelector(`#poComparePanel [data-key="${key}"][data-sup="${sup}"]`); if (el) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch (_) {} } } }
  const _after = Views.purchases?.after;
  if (Views.purchases) Views.purchases.after = function () { const r = _after ? _after.apply(this, arguments) : undefined; try { loadWeights(); inject(); } catch (e) { console.warn('[POCompare] inject lỗi', e); } return r; };

  document.addEventListener('input', (e) => {
    const el = e.target; if (!el) return;
    if (el.classList?.contains('po-crit')) { const d = draftOf(el.dataset.pr, el.dataset.sup); const k = el.dataset.key; d[k] = el.type === 'checkbox' ? el.checked : (el.tagName === 'SELECT' || el.type === 'number' ? el.value : el.value); saveDrafts(); refresh(); return; }
    if (el.classList?.contains('quote-supplier-price')) { setTimeout(refresh, 0); return; }
    if (el.id === 'pocReason') { const p = document.getElementById('poComparePanel'); if (p) { drafts[p.dataset.pr] = drafts[p.dataset.pr] || {}; drafts[p.dataset.pr].__reason = el.value; saveDrafts(); } }
  });
  document.addEventListener('change', (e) => { const el = e.target; if (el?.classList?.contains('po-crit') && el.tagName === 'SELECT') { const d = draftOf(el.dataset.pr, el.dataset.sup); d[el.dataset.key] = el.value; saveDrafts(); refresh(); } else if (el?.classList?.contains('quote-supplier-choice')) setTimeout(refresh, 0); });

  /* ------------------------------------------------------------------ hành động */
  function openWeights() {
    const total = () => Object.values(weights).reduce((a, b) => a + n(b), 0);
    Modal.open({ title: 'Trọng số tiêu chí so sánh NCC', sub: 'Điểm tổng = bình quân có trọng số của các tiêu chí có dữ liệu; tổng trọng số không cần bằng 100', size: 'md',
      body: `<div class="form-grid cols-2">${CRITERIA.map((c) => `<div class="field"><label>${c.label}</label><input class="inp right num" data-poc-w="${c.key}" type="number" min="0" max="100" value="${n(weights[c.key])}"><div class="cell-sub">${c.hint}</div></div>`).join('')}</div>`,
      foot: '<button class="btn" data-act="poc-weights-reset">Về mặc định</button><button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="poc-weights-save"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>' });
  }
  const _confirm = Actions['quote-confirm-pr'];
  Actions['quote-confirm-pr'] = function (d) {
    const pr = prOf(d.id); if (!pr || typeof _confirm !== 'function') return _confirm ? _confirm.apply(this, arguments) : undefined;
    if (isLocked(pr)) return _confirm.apply(this, arguments);
    const ctx = compute(pr); const sel = selectionFromDom(pr); const res = ctx.result;
    const deviates = res.best && Object.entries(sel).some(([m, s]) => s !== bestForItem(res, ctx, m));
    const reason = (document.getElementById('pocReason')?.value || drafts[pr.id]?.__reason || '').trim();
    if (deviates && !reason) { Toast.err('Cần ghi lý do chọn NCC', 'NCC được chọn khác với đề xuất theo điểm so sánh. Nhập lý do ở mục "Lý do chọn NCC".'); document.getElementById('pocReason')?.focus(); return; }
    const before = new Set((DB.supplierQuotations || []).map((q) => q.id));
    const ret = _confirm.apply(this, arguments);
    const created = (DB.supplierQuotations || []).filter((q) => !before.has(q.id) && q.prId === pr.id);
    if (created.length) {
      created.forEach((q) => {
        const c = { ...BLANK(), ...(ctx.criteria[q.supplierId] || {}) }; const x = res.bySupplier[q.supplierId];
        q.criteria = c; q.compareWeights = { ...ctx.w }; q.compareAt = new Date().toISOString(); q.selectionReason = reason;
        if (x) { q.score = r1(x.weighted); q.rank = x.rank || null; q.scoreDetail = Object.fromEntries(Object.entries(x.scores).map(([k, v]) => [k, v == null ? null : r1(v)])); q.recommended = res.best === q.supplierId; }
        if (n(c.leadTimeDays) > 0) q.leadTimeDays = n(c.leadTimeDays);
        if (c.advancePct !== '' || c.creditDays !== '') q.paymentTerm = `${n(c.advancePct)}% tạm ứng, còn lại thanh toán sau ${n(c.creditDays)} ngày`;
        if (n(c.warrantyDays) > 0) q.warrantyDays = n(c.warrantyDays);
        q.shippingBy = c.shippingBy; q.shippingCost = c.shippingBy === 'SUPPLIER' ? 0 : n(c.shippingCost);
      });
      try { if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.scheduleCollections) PurchaseAPI.scheduleCollections(['supplierQuotations']); } catch (_) {}
      delete drafts[pr.id]; saveDrafts();
    }
    return ret;
  };
  Object.assign(Actions, {
    'poc-detail': () => { const f = F('po-compare', { detail: false }); f.detail = !f.detail; refresh(); },
    'poc-weights': () => openWeights(),
    'poc-weights-save': async () => {
      const w = {}; document.querySelectorAll('[data-poc-w]').forEach((el) => { w[el.dataset.pocW] = Math.max(0, n(el.value)); });
      if (!Object.values(w).some((v) => v > 0)) { Toast.err('Trọng số không hợp lệ', 'Cần ít nhất một tiêu chí có trọng số lớn hơn 0.'); return; }
      try { await saveWeights(w); } catch (err) { Toast.err('Không lưu được trọng số', err?.message || 'Vui lòng thử lại.'); return; }
      Modal.close(); refresh(); Toast.ok('Đã lưu trọng số tiêu chí', 'Áp dụng cho các lần so sánh mới.');
    },
    'poc-weights-reset': () => { document.querySelectorAll('[data-poc-w]').forEach((el) => { el.value = DEFAULT_WEIGHTS[el.dataset.pocW]; }); },
    'poc-pick-best': (d) => {
      const pr = prOf(d.pr); if (!pr) return; const ctx = compute(pr); const best = ctx.result.best; if (!best) return; let applied = 0;
      (pr.items || []).forEach((it) => { const target = bestForItem(ctx.result, ctx, it.materialId); const el = document.querySelector(`input.quote-supplier-choice[data-pr-id="${pr.id}"][data-material-id="${it.materialId}"][data-supplier-id="${target}"]`); if (el && !el.disabled) { el.checked = true; applied++; } });
      refresh(); Toast.ok('Đã chọn NCC theo điểm', `${applied}/${(pr.items || []).length} mặt hàng · đề xuất ${supplierName(best)}`);
    },
  });
})();
