/* ============================================================================
 * SẢN XUẤT — THÊM CÔNG ĐOẠN MỚI HOÀN TOÀN (đợt 6) — nạp SAU mod-production.js
 * ----------------------------------------------------------------------------
 * Trước đây danh mục công đoạn (DB.operations) chỉ có dữ liệu mẫu và công đoạn bóc tách từ báo giá, không có
 * cách tạo công đoạn từ đầu và mọi chỉnh sửa mất khi tải lại trang. Mô-đun này:
 *  - Thêm / sửa / xóa công đoạn tự tạo: tên, phân xưởng (chọn có sẵn hoặc tạo phân xưởng mới), máy, ĐVT,
 *    đơn giá, tổ trưởng, ghi chú; mã CD-NN tự cấp.
 *  - Lưu bền: KIO (bảng lenam_production_operations) nếu có, nếu không dùng localStorage. Công đoạn có sẵn
 *    chỉ lưu phần chỉnh sửa (ghi đè), không xóa được.
 *  - Phân xưởng mới được thêm vào danh sách phân xưởng và các cột của bảng tiến độ LSX.
 *  - Công đoạn mới xuất hiện ngay trong BOM / Routing của sản phẩm.
 * ========================================================================== */
(function () {
  'use strict';
  const LS = 'lenam_prod_ops_v1';
  const TABLE = (typeof KIO_CONFIG !== 'undefined' && KIO_CONFIG.productionTables?.operations) || 'lenam_production_operations';
  const canEdit = () => { try { return typeof Auth === 'undefined' || Auth.hasPermission('PRODUCTION_OPERATE') || Auth.hasPermission('PRODUCTION_MANAGE'); } catch (_) { return true; } };
  const who = () => DB.currentUser?.name || DB.currentUser?.id || '';
  const money = (v) => (typeof fmtVND === 'function' ? fmtVND(v) : Math.round(Number(v) || 0).toLocaleString('vi-VN') + 'đ');
  const readLocal = () => { try { const r = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(r) ? r : []; } catch (_) { return []; } };
  let records = readLocal(); let kioLoaded = false;
  const writeLocal = () => { try { localStorage.setItem(LS, JSON.stringify(records)); } catch (e) { console.warn('[Ops] localStorage:', e); } };

  /* ---- áp bản ghi vào DB.operations / danh sách phân xưởng ---- */
  const lastFixed = (list) => { const i = list.findIndex((x) => /QC|Hoàn thành|ATTP/i.test(String(x))); return i < 0 ? list.length : i; };
  function ensureWorkshop(ws) {
    if (!ws) return;
    if (Array.isArray(DB.workshopNames) && !DB.workshopNames.includes(ws)) DB.workshopNames.splice(lastFixed(DB.workshopNames), 0, ws);
    if (Array.isArray(DB.stageNames) && DB.stageNames !== DB.workshopNames && !DB.stageNames.includes(ws)) DB.stageNames.splice(lastFixed(DB.stageNames), 0, ws);
    try { if (typeof STAGE_ICON !== 'undefined' && !STAGE_ICON[ws]) STAGE_ICON[ws] = 'fa-gear'; } catch (_) {}
  }
  const FIELDS = ['name', 'workshop', 'machine', 'unit', 'rate', 'leadId', 'note'];
  function applyRecord(r) {
    if (r.deleted) { const i = DB.operations.findIndex((o) => o.id === r.id && o.origin === 'MANUAL'); if (i >= 0) DB.operations.splice(i, 1); return; }
    ensureWorkshop(r.workshop);
    const cur = DB.operations.find((o) => o.id === r.id);
    if (cur) { FIELDS.forEach((k) => { if (r[k] !== undefined) cur[k] = r[k]; }); if (r.origin === 'MANUAL') cur.origin = 'MANUAL'; }
    else DB.operations.push({ id: r.id, name: r.name, workshop: r.workshop, machine: r.machine || '', rate: Number(r.rate) || 0, unit: r.unit || 'giờ', leadId: r.leadId || '', source: '', note: r.note || '', origin: 'MANUAL', createdAt: r.createdAt, createdBy: r.createdBy });
  }
  const applyAll = () => records.forEach(applyRecord);
  applyAll(); // đồng bộ ngay từ bộ nhớ trình duyệt để Routing/BOM luôn tìm thấy công đoạn

  async function pullKio() {
    if (kioLoaded) return; kioLoaded = true;
    try {
      if (typeof KioStore === 'undefined') return;
      const rows = await KioStore.listCollection(TABLE, { force: false });
      if (Array.isArray(rows)) { const byId = new Map(records.map((r) => [r.id, r])); rows.forEach((r) => byId.set(r.id, r)); records = [...byId.values()]; writeLocal(); applyAll(); if (typeof render === 'function' && State.module === 'production') render(); }
    } catch (e) { console.warn('[Ops] Không tải được công đoạn từ KIO', e); }
  }
  async function saveRecord(r) {
    const i = records.findIndex((x) => x.id === r.id); const before = i >= 0 ? JSON.parse(JSON.stringify(records[i])) : null;
    if (i >= 0) records[i] = r; else records.push(r); writeLocal();
    try { if (typeof KioStore !== 'undefined') await KioStore.saveSingleton(TABLE, r.id, JSON.parse(JSON.stringify(r))); }
    catch (err) { if (before) records[i] = before; else records = records.filter((x) => x.id !== r.id); writeLocal(); throw err; }
  }
  async function dropRecord(id) {
    const old = records.find((r) => r.id === id);
    records = records.filter((r) => r.id !== id); writeLocal();
    try { if (typeof KioStore !== 'undefined') await KioStore.deleteKeys(TABLE, [id]); } catch (err) { if (old) { records.push(old); writeLocal(); } throw err; }
  }
  const usedBy = (id) => (typeof Q !== 'undefined' && Q.productsUsingOp ? Q.productsUsingOp(id) : (DB.products || []).filter((p) => (p.routing || []).some((r) => (Array.isArray(r) ? r[0] : r.operationId) === id)));
  const nextId = () => { const nums = DB.operations.map((o) => parseInt(String(o.id).replace(/\D/g, ''), 10)).filter((x) => Number.isFinite(x)); const k = (nums.length ? Math.max(...nums) : 0) + 1; return 'CD-' + String(k).padStart(2, '0'); };
  window.ProductionOps = { nextId, applyAll, records: () => records, usedBy };

  /* ---- Giao diện ---- */
  const workshops = () => (Array.isArray(DB.workshopNames) ? DB.workshopNames : [...new Set(DB.operations.map((o) => o.workshop).filter(Boolean))]);
  const machineSuggestions = () => [...new Set([...(DB.operations || []).map((o) => o.machine), ...(DB.fixedAssets || []).map((a) => a.machine)].filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'vi'));
  function openForm(id = '') {
    if (!canEdit()) { Toast.err('Không có quyền', 'Bạn không có quyền sửa danh mục công đoạn.'); return; }
    const op = id ? DB.operations.find((o) => o.id === id) : null; if (id && !op) return;
    const wsOpts = workshops().map((w) => `<option ${op?.workshop === w ? 'selected' : ''}>${esc(w)}</option>`).join('');
    const leadOpts = (DB.employees || []).filter((e) => e.status !== 'ns_nghi_viec').map((e) => `<option value="${esc(e.id)}" ${op?.leadId === e.id ? 'selected' : ''}>${esc(e.id)} · ${esc(e.name)}</option>`).join('');
    Modal.open({
      title: op ? `Sửa công đoạn · ${esc(op.id)}` : 'Thêm công đoạn mới', sub: op ? (op.origin === 'MANUAL' ? 'Công đoạn tự tạo' : 'Công đoạn có sẵn: chỉnh sửa được lưu lại, không xóa được') : `Mã tự cấp: ${nextId()}`, size: 'md',
      body: `<div class="form-grid cols-2">
        <div class="field" style="grid-column:1/-1"><label>Tên công đoạn <span class="req">*</span></label><input class="inp" id="opName" value="${esc(op?.name || '')}" placeholder="Ví dụ: Làm nguội & ủ"></div>
        <div class="field"><label>Phân xưởng <span class="req">*</span></label><select class="inp" id="opWs"><option value="">— Chọn —</option>${wsOpts}<option value="__NEW__">➕ Phân xưởng mới…</option></select></div>
        <div class="field" id="opWsNewBox" style="display:none"><label>Tên phân xưởng mới <span class="req">*</span></label><input class="inp" id="opWsNew" placeholder="Ví dụ: Ủ men"></div>
        <div class="field"><label>Máy / thiết bị</label><input class="inp" id="opMachine" list="opMachineList" value="${esc(op?.machine || '')}" placeholder="Chọn hoặc nhập tên máy"><datalist id="opMachineList">${machineSuggestions().map((m) => `<option value="${esc(m)}">`).join('')}</datalist></div>
        <div class="field"><label>Đơn vị tính</label><input class="inp" id="opUnit" value="${esc(op?.unit || 'giờ')}"></div>
        <div class="field"><label>Đơn giá / ${esc(op?.unit || 'giờ')} (đ)</label><input class="inp right num" id="opRate" type="number" min="0" step="1" value="${op?.rate ?? ''}" placeholder="0"></div>
        <div class="field"><label>Tổ trưởng phụ trách</label><select class="inp" id="opLead"><option value="">— Chưa chọn —</option>${leadOpts}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><input class="inp" id="opNote" value="${esc(op?.note || '')}"></div></div>
        <div class="cell-sub" style="margin-top:8px">Sau khi tạo, thêm công đoạn vào quy trình của sản phẩm ở BOM / Routing. Phân xưởng mới sẽ có cột riêng trong bảng tiến độ LSX.</div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="op-save" data-id="${esc(id)}"><i class="fa-solid fa-floppy-disk"></i>${op ? 'Lưu' : 'Thêm công đoạn'}</button>`,
      onMount: () => { const sel = $('#opWs'), box = $('#opWsNewBox'); sel?.addEventListener('change', () => { box.style.display = sel.value === '__NEW__' ? '' : 'none'; if (sel.value === '__NEW__') $('#opWsNew')?.focus(); }); },
    });
  }
  async function saveOp(id) {
    if (!canEdit()) return; const v = (s) => ($(s)?.value ?? '').trim();
    const name = v('#opName'); let ws = v('#opWs'); const isNewWs = ws === '__NEW__'; if (isNewWs) ws = v('#opWsNew');
    const rate = Number($('#opRate')?.value || 0);
    if (!name) { Toast.err('Thiếu tên công đoạn', 'Nhập tên công đoạn.'); return; }
    if (!ws) { Toast.err('Thiếu phân xưởng', isNewWs ? 'Nhập tên phân xưởng mới.' : 'Chọn phân xưởng.'); return; }
    if (!(rate >= 0)) { Toast.err('Đơn giá không hợp lệ', 'Đơn giá phải lớn hơn hoặc bằng 0.'); return; }
    if (DB.operations.some((o) => o.id !== id && o.workshop === ws && String(o.name).trim().toLowerCase() === name.toLowerCase())) { Toast.err('Trùng công đoạn', `Phân xưởng "${ws}" đã có công đoạn "${name}".`); return; }
    const old = id ? DB.operations.find((o) => o.id === id) : null; const exists = records.find((r) => r.id === id);
    const rec = { ...(exists || {}), id: id || nextId(), name, workshop: ws, machine: v('#opMachine'), unit: v('#opUnit') || 'giờ', rate, leadId: $('#opLead')?.value || '', note: v('#opNote'), origin: old ? (old.origin === 'MANUAL' ? 'MANUAL' : 'OVERRIDE') : 'MANUAL', workshopNew: isNewWs || exists?.workshopNew || false, updatedAt: new Date().toISOString(), updatedBy: who(), ...(id ? {} : { createdAt: new Date().toISOString(), createdBy: who() }) };
    const snapshot = old ? JSON.parse(JSON.stringify(old)) : null;
    try { await saveRecord(rec); } catch (err) { Toast.err('Không lưu được công đoạn', err?.message || 'Vui lòng thử lại.'); return; }
    applyRecord(rec);
    if (snapshot && snapshot.workshop !== ws) { /* đổi phân xưởng: các LSX cũ giữ nguyên tên công đoạn đã dựng */ }
    Modal.close(); render(); Toast.ok(id ? 'Đã lưu công đoạn' : 'Đã thêm công đoạn mới', `${rec.id} · ${name} · ${ws}`);
  }
  async function deleteOp(id) {
    const op = DB.operations.find((o) => o.id === id); if (!op || !canEdit()) return;
    if (op.origin !== 'MANUAL') { Toast.warn('Không xóa được', 'Công đoạn có sẵn của hệ thống chỉ được sửa, không xóa.'); return; }
    const used = usedBy(id); if (used.length) { Toast.err('Công đoạn đang được dùng', `Đang nằm trong quy trình của ${used.length} sản phẩm (${used.slice(0, 3).map((p) => p.name).join(', ')}${used.length > 3 ? '…' : ''}). Gỡ khỏi Routing trước khi xóa.`); return; }
    if (!confirm(`Xóa công đoạn ${op.id} · ${op.name}?`)) return;
    try { await dropRecord(id); } catch (err) { Toast.err('Không xóa được', err?.message || 'Vui lòng thử lại.'); return; }
    DB.operations.splice(DB.operations.findIndex((o) => o.id === id), 1); Modal.close(); render(); Toast.ok('Đã xóa công đoạn', id);
  }

  /* ---- Gắn vào màn Công đoạn (danh mục) ---- */
  function manageCard() {
    const f = F('ops-manage', { q: '' }); const q = String(f.q || '').toLowerCase().trim();
    const list = DB.operations.filter((o) => !q || [o.id, o.name, o.workshop, o.machine].some((x) => String(x || '').toLowerCase().includes(q)));
    const rows = list.map((o) => { const u = usedBy(o.id).length;
      return `<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.name)}</td><td>${esc(o.workshop)}</td><td>${esc(o.machine || '—')}</td><td class="right num">${money(o.rate)} / ${esc(o.unit || 'giờ')}</td><td class="center">${u ? `<span class="badge blue">${u} SP</span>` : '<span class="muted">Chưa dùng</span>'}</td><td>${o.origin === 'MANUAL' ? '<span class="badge green">Tự tạo</span>' : o.source ? '<span class="badge purple">Từ báo giá</span>' : '<span class="badge slate">Có sẵn</span>'}</td>
        <td class="right">${canEdit() ? `<button class="btn btn-sm" data-act="op-edit" data-id="${esc(o.id)}" title="Sửa"><i class="fa-solid fa-pen"></i></button>${o.origin === 'MANUAL' ? ` <button class="btn btn-sm" data-act="op-del" data-id="${esc(o.id)}" title="Xóa"><i class="fa-solid fa-trash"></i></button>` : ''}` : ''}</td></tr>`; }).join('');
    return `<div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Quản lý công đoạn</h3><p>Thêm công đoạn mới hoàn toàn, sửa đơn giá/máy/phân xưởng; dữ liệu được lưu lại sau khi tải lại trang</p></div>${canEdit() ? '<button class="btn btn-primary" data-act="op-add"><i class="fa-solid fa-plus"></i>Thêm công đoạn mới</button>' : ''}</div>
      <div class="toolbar"><input class="inp" data-f="ops-manage.q" value="${esc(f.q || '')}" placeholder="Tìm mã, tên, phân xưởng, máy…" style="min-width:260px"></div>${tableShell([{ t: 'Mã' }, { t: 'Công đoạn' }, { t: 'Phân xưởng' }, { t: 'Máy / thiết bị' }, { t: 'Đơn giá', cls: 'right' }, { t: 'Dùng trong', cls: 'center' }, { t: 'Nguồn' }, { t: '', cls: 'right', w: '100px' }], rows, { emptyTitle: 'Không có công đoạn' })}</div>`;
  }
  const _ops = Views.operations;
  if (typeof _ops === 'function') { Views.operations = function () { pullKio(); applyAll(); return manageCard() + _ops.apply(this, arguments); }; Views.operations.after = _ops.after; }
  // Mọi màn sản xuất cần danh mục công đoạn đã nạp (BOM, kế hoạch…)
  const _prod = Views.production; if (typeof _prod === 'function') { Views.production = function () { pullKio(); return _prod.apply(this, arguments); }; Views.production.after = _prod.after; }
  // Chi tiết công đoạn: thêm nút Sửa / Xóa vào footer modal
  const _openOp = window.openOperationModal;
  if (typeof _openOp === 'function') window.openOperationModal = function (id) {
    _openOp.apply(this, arguments);
    setTimeout(() => { const foot = document.querySelector('.modal-foot, .modal-footer, .modal .foot'); const op = DB.operations.find((o) => o.id === id); if (!foot || !op || !canEdit() || foot.querySelector('[data-act="op-edit"]')) return;
      foot.insertAdjacentHTML('afterbegin', `<button class="btn" data-act="op-edit" data-id="${esc(id)}"><i class="fa-solid fa-pen"></i>Sửa</button>${op.origin === 'MANUAL' ? `<button class="btn" data-act="op-del" data-id="${esc(id)}"><i class="fa-solid fa-trash"></i>Xóa</button>` : ''}`); }, 0);
  };
  Object.assign(Actions, { 'op-add': () => openForm(''), 'op-edit': (d) => openForm(d.id), 'op-save': (d) => saveOp(d.id || ''), 'op-del': (d) => deleteOp(d.id) });
  setTimeout(pullKio, 0);
})();
