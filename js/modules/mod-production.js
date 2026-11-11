function productionDashboardView() {
  const orders = DB.productionOrders || [], plans = DB.productionPlans || [];
  const done = o => ['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(o.status);
  const late = o => !done(o) && o.deadline && daysTo(o.deadline) < 0;
  const rows = orders.slice().sort((a,b) => String(b.id).localeCompare(String(a.id))).slice(0,6).map(o => `<tr>
    <td><span class="code">${esc(o.id)}</span></td><td>${esc(o.productName || Q.product(o.productId)?.name || o.productId || '—')}</td>
    <td class="right">${fmtN(o.qty || o.quantity || 0)}</td><td>${badge(o.status)}</td><td>${fmtDate(o.deadline)}</td>
    <td>${rowActions([{act:'open-production-order',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem lệnh sản xuất'}])}</td></tr>`);
  return `${pageHead('Tổng quan sản xuất','Theo dõi kế hoạch, lệnh sản xuất và công việc cần xử lý', '<button class="btn" data-act="go" data-id="production" data-tab="orders">Xem lệnh sản xuất</button>')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng lệnh sản xuất',orders.length,'fa-industry','blue')}
    ${mkpi('Chờ sản xuất',orders.filter(o=>o.status==='lsx_cho_san_xuat').length,'fa-clock','orange')}
    ${mkpi('Đang sản xuất',orders.filter(o=>o.status==='lsx_dang_san_xuat').length,'fa-gears','indigo')}
    ${mkpi('Đang QC',orders.filter(o=>o.status==='lsx_dang_qc').length,'fa-flask-vial','teal')}
    ${mkpi('Hoàn thành',orders.filter(done).length,'fa-circle-check','green')}
    ${mkpi('Quá hạn',orders.filter(late).length,'fa-triangle-exclamation','red')}</div>
    <div class="grid g-21" style="margin-bottom:14px">
      <div class="card"><div class="card-head"><div><h3>Kế hoạch sản xuất</h3><p>${fmtN(plans.length)} kế hoạch đang được theo dõi</p></div></div>
      <div class="card-body"><p>Chờ duyệt: <b>${fmtN(plans.filter(p=>p.status==='WAITING_APPROVAL').length)}</b></p><p>Đã duyệt / đã cấp nguyên liệu: <b>${fmtN(plans.filter(p=>['APPROVED','MATERIAL_ISSUED'].includes(p.status)).length)}</b></p>
      <button class="btn" data-act="go" data-id="production" data-tab="plan">Mở kế hoạch sản xuất</button></div></div>
      <div class="card"><div class="card-head"><h3>Theo dõi tiến độ</h3></div><div class="card-body"><p>${fmtN(orders.filter(o=>!done(o)).length)} lệnh chưa hoàn thành, ${fmtN(orders.filter(late).length)} lệnh quá hạn.</p><button class="btn" data-act="go" data-id="production" data-tab="progress">Xem tiến độ sản xuất</button></div></div>
    </div><div class="card"><div class="card-head"><h3>Lệnh sản xuất gần đây</h3></div>${tableShell([{t:'Mã lệnh'},{t:'Thành phẩm'},{t:'Số lượng',cls:'right'},{t:'Trạng thái'},{t:'Hạn hoàn thành'},{t:'Thao tác'}],rows,{emptyTitle:'Chưa có lệnh sản xuất'})}</div>`;
}

/* ============================================================================
 * MODULE: LỆNH SẢN XUẤT & TIẾN ĐỘ SẢN XUẤT
 * Đây là phần lõi nghiệp vụ: mỗi lệnh chạy qua 8 công đoạn, tiến độ được
 * tính từ số lượng thực tế đã qua từng công đoạn.
 * ==========================================================================*/

const STAGE_ICON = {
  'Cắt': 'fa-scissors', 'Tiện': 'fa-circle-notch', 'Phay': 'fa-gear', 'Hàn': 'fa-fire',
  'Sơn': 'fa-spray-can-sparkles', 'Lắp ráp': 'fa-screwdriver-wrench', 'QC': 'fa-clipboard-check', 'Hoàn thành': 'fa-box-open',
};

/** Công đoạn đang chạy của một lệnh */
function currentStage(po) {
  const doing = po.stages.find((s) => s.status === 'doing');
  if (doing) return doing;
  const pending = po.stages.find((s) => s.status === 'pending');
  return pending || po.stages[po.stages.length - 1];
}

/** Phân biệt QC công đoạn với QC thành phẩm cuối.
 * Legacy order chưa có stageType vẫn được nhận diện bằng vị trí: Final QC luôn
 * là công đoạn áp chót và ngay sau nó là Hoàn thành.
 */
function isFinalQcStage(po, stageOrIndex) {
  const stages = po?.stages || [];
  const i = typeof stageOrIndex === 'number' ? stageOrIndex : stages.indexOf(stageOrIndex);
  const s = i >= 0 ? stages[i] : stageOrIndex;
  if (!s) return false;
  if (s.stageType === 'FINAL_QC' || s.operationId === 'FINAL_QC') return true;
  const next = stages[i + 1];
  return i === stages.length - 2 && /QC|KCS|ATTP|kiểm tra chất lượng/i.test(String(s.name || '')) && /hoàn thành/i.test(String(next?.name || ''));
}
function isProcessQcStage(po, stageOrIndex) {
  const stages = po?.stages || [];
  const i = typeof stageOrIndex === 'number' ? stageOrIndex : stages.indexOf(stageOrIndex);
  const s = i >= 0 ? stages[i] : stageOrIndex;
  return !!s && !isFinalQcStage(po, i) && (s.stageType === 'PROCESS_QC' || /QC|KCS|kiểm tra chất lượng/i.test(String(s.name || '')));
}


/** Dựng công đoạn LSX từ routing đã khai báo trong BOM.
 * QC và Hoàn thành luôn bắt buộc, không phụ thuộc routing của BOM.
 */
function buildProductionStagesFromRouting(qty, routing, startDate) {
  const rows = Array.isArray(routing) ? routing : [];
  const stages = [];
  rows.forEach((r, idx) => {
    const operationId = Array.isArray(r) ? r[0] : r?.operationId;
    if (!operationId) return;
    const op = (DB.operations || []).find(x => x.id === operationId) || {};
    const name = String(op.name || op.workshop || operationId).trim();
    // Giữ nguyên QC nằm giữa routing. Chỉ loại công đoạn Hoàn thành vì
    // hệ thống luôn bổ sung Final QC + Hoàn thành ở cuối quy trình.
    if (!name || /hoàn thành/i.test(name)) return;
    const isProcessQc = /(^|\s)QC(\s|$)|KCS|kiểm tra chất lượng/i.test(name);
    stages.push({
      operationId,
      name,
      stageType: isProcessQc ? 'PROCESS_QC' : 'PROCESS',
      leadId: op.leadId || '',
      machine: op.machine || '',
      qtyPlan: Number(qty || 0), qtyDone: 0, hours: 0,
      status: 'pending', start: '', end: '', note: '',
      plannedHoursPerUnit: Number(Array.isArray(r) ? r[1] : r?.hoursPer || 0),
      routingNote: String(Array.isArray(r) ? (r[2] || '') : (r?.note || ''))
    });
  });
  const qcOp = (DB.operations || []).find(o => /(^|\s)QC(\s|$)|KCS|ATTP/i.test(String(o.name || o.workshop || '')));
  stages.push({operationId:'FINAL_QC', sourceOperationId:qcOp?.id||'', stageType:'FINAL_QC', name:'QC — ATTP', leadId:qcOp?.leadId||'NV-015', machine:qcOp?.machine||'Phòng kiểm nghiệm / bàn QC', qtyPlan:Number(qty||0), qtyDone:0, hours:0, status:'pending', start:'', end:'', note:''});
  stages.push({operationId:'COMPLETE', stageType:'COMPLETE', name:'Hoàn thành', leadId:'NV-018', machine:'Kho thành phẩm', qtyPlan:Number(qty||0), qtyDone:0, hours:0, status:'pending', start:'', end:'', note:''});
  return stages;
}

function ensureProductionOrderStageSchema(po) {
  if (!po || productionOrderStarted(po)) return po;
  const product = Q.product(po.productId);
  const routing = (po.routingOverride && po.routingOverride.length) ? po.routingOverride : (product?.routing || []);
  const expected = buildProductionStagesFromRouting(po.qty, routing, po.startDate || currentDateYMD());
  const currentSig = (po.stages || []).map(x => x.operationId || x.name).join('|');
  const expectedSig = expected.map(x => x.operationId || x.name).join('|');
  if (currentSig !== expectedSig) po.stages = expected;
  return po;
}

function productionOrderStarted(po) {
  return (po?.stages || []).some((s) => s.status !== 'pending' || Number(s.qtyDone || 0) > 0);
}

function productionOrderCanDelete(po) {
  return !!po && ['lsx_cho_duyet','lsx_cho_san_xuat'].includes(po.status) && !productionOrderStarted(po);
}

function productionOrderCanEdit(po) { return false; }


function productionOrderMaterialRequest(po) {
  return (DB.productionMaterialRequests || []).find((r) => r.id === po?.materialRequestId || r.productionOrderId === po?.id) || null;
}

function productionOrderMaterialState(po) {
  const bom = (Q.product(po?.productId)?.bom || []);
  if (!bom.length && !(po?.materialPlan || []).length) return { code:'NOT_REQUIRED', label:'Không yêu cầu NVL', tone:'slate' };
  const req = productionOrderMaterialRequest(po);
  if (!req) return { code:'MISSING', label:'Chưa lập yêu cầu NVL', tone:'orange' };
  if (req.status === 'ISSUED' || po?.materialIssuedAt) return { code:'ISSUED', label:'Đã cấp NVL', tone:'green', req };
  if (req.status === 'APPROVED') return { code:'APPROVED', label:'Chờ Kho xuất NVL', tone:'blue', req };
  return { code:'WAITING', label:'Chờ xuất NVL', tone:'orange', req };
}

function productionOrderFinishedReceipt(po) {
  if (po?.finishedReceiptId) return (DB.goodsReceipts || []).find((r) => r.id === po.finishedReceiptId) || null;
  return (DB.goodsReceipts || []).find((r) => (r.items || []).some((i) => i.productionOrderId === po?.id) || r.productionOrderId === po?.id) || null;
}


// Đồng bộ trạng thái hiển thị của LSX từ chứng từ thật đã có trong DB.
// Không tạo dữ liệu mới; chỉ sửa state local nếu FQC/phiếu nhập đã chứng minh
// lệnh đã qua QC/đã nhập kho nhưng productionOrders còn status cũ.
function reconcileProductionOrderFinalState(po) {
  if (!po) return false;
  const ins = (DB.productionFinalInspections || []).find(x => x.productionOrderId === po.id);
  const receipt = productionOrderFinishedReceipt(po);
  let changed = false;
  const finalQcIdx = (po.stages || []).findIndex((st, idx) => typeof isFinalQcStage === 'function' ? isFinalQcStage(po, idx) : /QC — ATTP/i.test(String(st?.name||'')));

  if (ins && (ins.status || 'PENDING') !== 'PENDING') {
    const total = Number(ins.qty || po.qty || 0);
    po.qcPass = Number(ins.passQty || 0);
    po.qcFail = Number(ins.failQty || 0);
    po.qcNote = ins.note || po.qcNote || '';
    po.qcAt = ins.inspectedAt || po.qcAt || '';
    po.qcBy = ins.inspectedBy || po.qcBy || '';
    po.qcByName = ins.inspectedByName || po.qcByName || '';
    if (finalQcIdx >= 0) {
      const st = po.stages[finalQcIdx];
      if (st.status !== 'done' || Number(st.qtyDone||0) !== total) {
        st.status = 'done'; st.qtyDone = total; st.end = (ins.inspectedAt || '').slice(0,10) || currentDateYMD();
        changed = true;
      }
      const done = po.stages[finalQcIdx + 1];
      if (done && done.status !== 'done') {
        done.status = 'done'; done.qtyPlan = Number(ins.passQty || po.qty || 0); done.qtyDone = Number(ins.passQty || 0);
        done.start = done.start || currentDateYMD(); done.end = done.end || currentDateYMD();
        changed = true;
      }
    }
  }

  if (receipt) {
    if (po.finishedReceiptId !== receipt.id) { po.finishedReceiptId = receipt.id; changed = true; }
    if (po.status !== 'lsx_da_nhap_kho') { po.status = 'lsx_da_nhap_kho'; changed = true; }
    const received = Number(po.qcPass || (receipt.items || []).reduce((s,i)=>s+Number(i.qty||0),0));
    if (Number(po.receivedQty||0) !== received) { po.receivedQty = received; changed = true; }
    po.receivedAt = po.receivedAt || receipt.createdAt || receipt.date || new Date().toISOString();
  } else if (ins && (ins.status || 'PENDING') !== 'PENDING' && po.status === 'lsx_dang_qc') {
    po.status = Number(ins.passQty || 0) > 0 ? 'lsx_hoan_thanh' : 'lsx_hoan_thanh';
    changed = true;
  }
  return changed;
}

function openProductionOrderEditForm(id) {
  const po = Q.po(id); if (!po) return;
  const started = productionOrderStarted(po);
  const lockCore = !!po.approvedAt || started;
  const productOptions = (DB.products || []).map((x) => `<option value="${esc(x.id)}" ${x.id===po.productId?'selected':''}>${esc(x.id)} — ${esc(x.name)}</option>`).join('');
  const managers = (DB.employees || []).map((e) => `<option value="${esc(e.id)}" ${e.id===po.managerId?'selected':''}>${esc(e.id)} — ${esc(e.name)}</option>`).join('');
  Modal.open({
    title: `Cập nhật lệnh sản xuất ${po.id}`,
    sub: lockCore ? 'Lệnh đã bắt đầu: khóa thành phẩm và số lượng, chỉ cập nhật thông tin điều hành.' : 'Lệnh đang chờ sản xuất.',
    size: 'md',
    body: `<div class="form-grid cols-2">
      <div class="field"><label>Thành phẩm *</label><select class="inp" id="poEditProduct" ${lockCore?'disabled':''}>${productOptions}</select></div>
      <div class="field"><label>Số lượng *</label><input class="inp right num" id="poEditQty" type="number" min="0.01" step="0.01" value="${Number(po.qty||0)}" ${lockCore?'disabled':''}></div>
      <div class="field"><label>Ngày bắt đầu</label><input class="inp" id="poEditStart" type="date" min="${currentDateYMD()}" value="${esc((po.startDate&&po.startDate>=currentDateYMD())?po.startDate:currentDateYMD())}"></div>
      <div class="field"><label>Deadline</label><input class="inp" id="poEditDeadline" type="date" min="${currentDateYMD()}" value="${esc((po.deadline&&po.deadline>=currentDateYMD())?po.deadline:currentDateYMD())}"></div>
      <div class="field" style="grid-column:1/-1"><label>Người phụ trách</label><select class="inp" id="poEditManager">${managers}</select></div>
      <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea class="inp" id="poEditNote" rows="3">${esc(po.note||'')}</textarea></div>
    </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="po-edit-save" data-id="${esc(po.id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu thay đổi</button>`
  });
}

/* ------------------------------------------------------------ LSX: ngưỡng báo, giờ chi tiết, sản lượng thực tế */
// Số ngày trước deadline thì LSX bị coi là "sắp hết hạn". Lưu trong inventoryAlertConfig (đã đồng bộ server).
function lsxNearDeadlineDays() {
  const n = Number(DB.inventoryAlertConfig?.lsxNearDeadlineDays);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3;
}
function lsxDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function lsxStageTimes(p) {
  const st = p?.stages || [];
  const starts = st.map((s) => s.actualStartedAt).filter(Boolean).sort();
  const ends = st.map((s) => s.actualEndedAt).filter(Boolean).sort();
  const start = starts[0] || '';
  const end = p?.completedAt || ((st.length && st.every((s) => s.status === 'done')) ? (ends[ends.length - 1] || '') : '');
  const finish = end || '';
  const lastTs = finish ? new Date(finish) : new Date();
  const elapsedH = start ? Math.max(0, (lastTs - new Date(start)) / 3600000) : 0;
  return { start, end: finish, elapsedH };
}
function lsxVarianceHtml(p) {
  const actual = Number(p?.actualQty);
  if (!(Number.isFinite(actual) && p?.actualQty !== undefined && p?.actualQty !== '' && p?.actualQty !== null)) return '';
  const diff = Math.round((actual - Number(p.qty || 0)) * 10000) / 10000;
  if (diff === 0) return '<span class="badge green">Đủ kế hoạch</span>';
  return diff < 0 ? `<span class="badge red">Thiếu ${fmtN(-diff)} ${esc(p.unit || '')}</span>` : `<span class="badge blue">Thừa ${fmtN(diff)} ${esc(p.unit || '')}</span>`;
}

// Các công đoạn sản xuất (không phải QC) còn lại, tính từ công đoạn đang chạy đến trước QC gần nhất.
function lsxCompleteAllEligible(p) {
  if (!p || !['lsx_cho_san_xuat', 'lsx_dang_san_xuat'].includes(p.status)) return [];
  const out = [];
  for (let i = 0; i < (p.stages || []).length; i++) {
    const s = p.stages[i];
    if (s.status === 'done') continue;
    if ((typeof isFinalQcStage === 'function' && isFinalQcStage(p, i)) || (typeof isProcessQcStage === 'function' && isProcessQcStage(p, i))) break;
    out.push(i);
  }
  return out;
}
function lsxCanRecordActual(p) {
  if (!p || !['lsx_dang_san_xuat', 'lsx_dang_qc'].includes(p.status)) return false;
  const ins = typeof finalInspectionOfPO === 'function' ? finalInspectionOfPO(p.id) : null;
  return !ins || (ins.status || 'PENDING') === 'PENDING';
}

Views.production = function () {
  const tab = State.tab || (State.params && State.params.tab);
  if (!tab || tab === 'dashboard') return productionDashboardView();
  if (tab === 'bom') return Views.operations ? Views.operations(State.params) : '';
  if (tab === 'routing' || tab === 'progress') return Views.progress ? Views.progress(State.params) : '';
  if (tab && !['dashboard', 'orders'].includes(tab)) return '';

  const f = F('production', { q: '', status: '', stage: '' });
  if (State.params.filter === 'late') { f.status = ''; State.params.filter = 'late'; }
  const q = (f.q || '').toLowerCase().trim();
  const onlyLate = State.params.filter === 'late';

  (DB.productionOrders || []).forEach(ensureProductionOrderStageSchema);
  let list = DB.productionOrders.filter((p) => {
    if (f.status && p.status !== f.status) return false;
    if (f.stage && currentStage(p).name !== f.stage) return false;
    if (q && ![p.id, p.orderId, p.productName, Q.customerName(p.customerId)].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  });
  if (onlyLate) list = list.filter((p) => !['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status) && daysTo(p.deadline) <= lsxNearDeadlineDays());
  list.sort((a, b) => b.id.localeCompare(a.id));

  const pg = paged(list, 'production');
  const cnt = (s) => DB.productionOrders.filter((p) => p.status === s).length;

  const rows = pg.items.map((p) => {
    const prog = Q.progress(p);
    const d = daysTo(p.deadline);
    const st = currentStage(p);
    return `<tr class="clickable" data-act="open-production-order" data-id="${p.id}">
      <td><span class="code">${p.id}</span><div class="cell-sub">${esc(st.name)}</div></td>
      <td class="hide-sm"><span class="code" style="color:var(--text-2)">${p.orderId}</span><div class="cell-sub">${esc(Q.customerName(p.customerId))}</div></td>
      <td>${cell2(esc(p.productName), esc(p.spec))}</td>
      <td class="right num">${fmtN(p.qty)} ${esc(p.unit)}</td>
      <td class="num hide-sm">${cell2(fmtDate(p.startDate), lsxStageTimes(p).start ? `Thực tế ${lsxDateTime(lsxStageTimes(p).start)}` : '')}</td>
      <td class="num">${cell2(fmtDate(p.deadline), !['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status) ? (d < 0 ? `<span style="color:var(--red)">trễ ${-d} ngày</span>` : d <= lsxNearDeadlineDays() ? `<span style="color:var(--orange)">còn ${d} ngày</span>` : `còn ${d} ngày`) : '')}</td>
      <td style="min-width:150px">${progressBar(prog)}</td>
      <td>${badge(p.status)}</td>
      <td class="right">${rowActions([
        { act:'open-production-order', data:`data-id="${p.id}"`, icon:'fa-eye', title:'Xem chi tiết' },
        ...(['lsx_cho_duyet','lsx_cho_san_xuat'].includes(p.status) ? [{ act:'po-advance', data:`data-id="${p.id}"`, icon:'fa-play', title:'Bắt đầu sản xuất' }] : []),
        ...(p.status==='lsx_dang_san_xuat' ? [{ act:'po-advance', data:`data-id="${p.id}"`, icon:'fa-gears', title:'Cập nhật công đoạn' }] : []),
        ...(p.status==='lsx_dang_qc' ? [{ act:'po-qc', data:`data-id="${p.id}"`, icon:'fa-clipboard-check', title:'Đi đến QC thành phẩm' }] : []),
        ...(productionOrderCanDelete(p) ? [{ act:'po-delete', data:`data-id="${p.id}"`, icon:'fa-trash', title:'Xóa lệnh sản xuất' }] : []),
      ])}</td>
    </tr>`;
  });

  return `
  ${pageHead('Lệnh sản xuất', 'Điều hành lệnh sản xuất theo từng công đoạn của xưởng', `
    <span class="chip" title="Số ngày trước deadline thì LSX hiện cảnh báo sắp hết hạn"><i class="fa-solid fa-bell"></i>Báo sắp hết hạn trước <input class="inp right num" id="lsxNearDays" type="number" min="0" max="60" step="1" style="width:58px;padding:2px 6px" value="${lsxNearDeadlineDays()}"> ngày <button class="btn btn-sm" data-act="lsx-near-days-save"><i class="fa-solid fa-floppy-disk"></i></button></span>
    <button class="btn" data-act="export-po"><i class="fa-solid fa-file-export"></i>Export</button>
    <button class="btn" data-act="go" data-id="progress"><i class="fa-solid fa-diagram-project"></i>Bảng điều hành</button>
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng lệnh', DB.productionOrders.length, 'fa-industry', 'blue')}
    ${mkpi('Chờ sản xuất', DB.productionOrders.filter(p=>['lsx_cho_duyet','lsx_cho_san_xuat'].includes(p.status)).length, 'fa-hourglass-start', 'slate')}
    ${mkpi('Đang sản xuất', cnt('lsx_dang_san_xuat'), 'fa-gears', 'indigo')}
    ${mkpi('Đang QC', cnt('lsx_dang_qc'), 'fa-clipboard-check', 'orange')}
    ${mkpi('Hoàn thành', cnt('lsx_hoan_thanh'), 'fa-circle-check', 'green')}
    ${mkpi('Đã nhập kho', cnt('lsx_da_nhap_kho'), 'fa-warehouse', 'teal')}
  </div>

  ${onlyLate ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--orange)">
    <div class="card-head">
      <span class="mkpi-ico t-orange"><i class="fa-solid fa-clock"></i></span>
      <div><h3>Đang lọc: lệnh sắp/đã trễ tiến độ</h3><p>${list.length} lệnh có deadline trong ${lsxNearDeadlineDays()} ngày tới hoặc đã quá hạn</p></div>
      <div class="right"><button class="btn btn-sm" data-act="clear-filter" data-key="production">Bỏ lọc</button></div>
    </div></div>` : ''}

  <div class="card">
    <div class="toolbar">
      ${searchBox('production', 'Tìm mã LSX, đơn hàng, sản phẩm…')}
      ${selectFilter('production', 'status', statusOptions('lsx_'), 'Tất cả trạng thái')}
      ${selectFilter('production', 'stage', [...new Set([...(DB.stageNames||[]), ...(DB.productionOrders||[]).flatMap(po=>(po.stages||[]).map(st=>st.name)).filter(Boolean)])].map((s) => [s, s]), 'Tất cả công đoạn')}
      ${(f.q || f.status || f.stage || onlyLate) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="production"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} lệnh</span>
    </div>
    ${tableShell(
      [{ t: 'Mã LSX', w: '150px' }, { t: 'Đơn hàng', cls: 'hide-sm' }, { t: 'Sản phẩm' }, { t: 'Số lượng', cls: 'right' },
       { t: 'Bắt đầu', cls: 'hide-sm' }, { t: 'Deadline' }, { t: 'Tiến độ', w: '170px' }, { t: 'Trạng thái', w: '132px' }, { t: 'Thao tác', cls:'right', w:'130px' }],
      rows, { emptyTitle: 'Không tìm thấy lệnh sản xuất' })}
    ${pagiHTML('production', pg, 'lệnh sản xuất')}
  </div>`;
};

/* ------------------------------------------- CHI TIẾT LỆNH SẢN XUẤT */
Views['production-detail'] = function (params) {
  const p = Q.po(params.id);
  // [ACTIVE DATE MIGRATION] Các công đoạn đang chạy từ dữ liệu demo cũ (15/08)
  // được chuyển sang ngày hiện tại đúng một lần. Công đoạn đã hoàn tất giữ nguyên lịch sử.
  if (p) {
    const today = currentDateYMD();
    const activeStage = (p.stages || []).find(s => s.status === 'doing');
    if (activeStage && activeStage.start && activeStage.start < today && !activeStage.actualStartedAt) {
      activeStage.start = today;
      activeStage.actualStartedAt = new Date().toISOString();
      if (typeof ProductionAPI !== 'undefined') ProductionAPI.scheduleSync(250);
    }
  }
  if (p) {
    ensureProductionOrderStageSchema(p);
    const repaired = reconcileProductionOrderFinalState(p);
    if (repaired) {
      // Chỉ persist đúng LSX đã được đối soát; stage progress được cập nhật để
      // lần refresh sau không bị record tiến độ cũ kéo status ngược về Đang QC.
      requestAnimationFrame(() => setTimeout(() => {
        try {
          const finalQcIdx = (p.stages || []).findIndex((st, idx) => isFinalQcStage(p, idx));
          ProductionAPI?.scheduleCollections?.(['productionOrders']);
          if (finalQcIdx >= 0) ProductionAPI?.persistStageProgress?.(p, [finalQcIdx, finalQcIdx + 1]).catch?.(()=>{});
        } catch (_) {}
      }, 0));
    }
  }
  if (!p) return `<div class="empty"><div class="empty-ico"><i class="fa-solid fa-file-circle-xmark"></i></div><h4>Không tìm thấy lệnh sản xuất</h4><button class="btn btn-primary btn-sm" data-act="go" data-id="production">Về danh sách</button></div>`;

  const prog = Q.progress(p);
  const check = Q.materialCheck(p);
  const lacking = check.filter((m) => !m.ok);
  const d = daysTo(p.deadline);
  const order = Q.order(p.orderId);
  const materialRequest = productionOrderMaterialRequest(p);
  const materialState = productionOrderMaterialState(p);
  const finishedReceipt = productionOrderFinishedReceipt(p);
  const productBom = (Q.product(p.productId)?.bom || []);
  const doneQty = p.stages.reduce((s, st) => s + st.qtyDone, 0);
  const totalHours = p.stages.reduce((s, st) => s + st.hours, 0);

  return `
  ${pageHead(`Lệnh sản xuất ${p.id}`, `${esc(p.productName)} · Đơn hàng ${p.orderId} · ${esc(Q.customerName(p.customerId))}`, `
    <button class="btn" data-act="go" data-id="production"><i class="fa-solid fa-arrow-left"></i>Danh sách</button>
    <button class="btn" data-act="export-po-detail" data-id="${p.id}"><i class="fa-solid fa-print"></i>In phiếu SX</button>
    ${['lsx_cho_duyet','lsx_cho_san_xuat'].includes(p.status) ? `<button class="btn btn-primary" data-act="po-advance" data-id="${p.id}"><i class="fa-solid fa-play"></i>Bắt đầu sản xuất</button>` : ''}
    ${p.status==='lsx_dang_san_xuat' ? `<button class="btn btn-primary" data-act="po-advance" data-id="${p.id}"><i class="fa-solid fa-gears"></i>Cập nhật công đoạn</button>` : ''}
    ${p.status==='lsx_dang_qc' ? `<button class="btn btn-primary" data-act="po-qc" data-id="${p.id}"><i class="fa-solid fa-clipboard-check"></i>Đi đến QC thành phẩm</button>` : ''}
    ${lsxCompleteAllEligible(p).length ? `<button class="btn" data-act="po-complete-all" data-id="${p.id}"><i class="fa-solid fa-forward-fast"></i>Hoàn thành toàn bộ công đoạn</button>` : ''}
    ${lsxCanRecordActual(p) ? `<button class="btn" data-act="po-actual-qty" data-id="${p.id}"><i class="fa-solid fa-scale-balanced"></i>Ghi nhận sản lượng thực tế</button>` : ''}
    ${productionOrderCanDelete(p) ? `<button class="btn" data-act="po-delete" data-id="${p.id}"><i class="fa-solid fa-trash"></i>Xóa</button>` : ''}
    ${finishedReceipt ? `<button class="btn" data-act="inv-receipt-view" data-id="${esc(finishedReceipt.id)}"><i class="fa-solid fa-warehouse"></i>${esc(finishedReceipt.id)}</button>` : ''}
  `)}

  <div class="grid g-31" style="margin-bottom:14px">
    <!-- THÔNG TIN SẢN XUẤT -->
    <div class="card">
      <div class="card-head"><div><h3>Thông tin sản xuất</h3><p>Thông số lệnh và người chịu trách nhiệm</p></div>
        <div class="right">${badge(p.status)}</div></div>
      <div class="card-body">
        <div class="info-grid">
          ${infoItem('Mã lệnh', `<span class="code">${p.id}</span>`)}
          ${infoItem('Đơn hàng', `<span class="code" data-act="open-order" data-id="${p.orderId}" style="cursor:pointer">${p.orderId}</span>`)}
          ${infoItem('Khách hàng', esc(Q.customerName(p.customerId)))}
          ${infoItem('Sản phẩm', esc(p.productName))}
          ${infoItem('Quy cách', esc(p.spec))}
          ${infoItem('Số lượng', `${fmtN(p.qty)} ${esc(p.unit)}`)}
          ${infoItem('Ngày bắt đầu', fmtDate(p.startDate))}
          ${infoItem('Deadline', `${fmtDate(p.deadline)} ${!['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status) ? (d < 0 ? `<span style="color:var(--red);font-weight:700">(trễ ${-d} ngày)</span>` : `<span style="color:${d <= lsxNearDeadlineDays() ? 'var(--orange)' : 'var(--text-3)'}">(còn ${d} ngày)</span>`) : ''}`)}
          ${infoItem('Người phụ trách', esc(Q.employeeName(p.managerId)))}
          ${infoItem('Cấp nguyên liệu', `<span class="badge ${materialState.tone}">${esc(materialState.label)}</span>${materialState.req ? `<div class="cell-sub"><span class="code">${esc(materialState.req.id)}</span></div>` : ''}`)}
          ${infoItem('Nguồn lệnh', p.planId ? `Kế hoạch <span class="code">${esc(p.planId)}</span>` : p.orderId ? `Đơn bán <span class="code">${esc(p.orderId)}</span>` : 'Tạo thủ công')}
          ${infoItem('Nhập kho TP', finishedReceipt ? `<span class="badge green">Đã nhập kho</span><div class="cell-sub"><span class="code">${esc(finishedReceipt.id)}</span></div>` : (p.status==='lsx_da_nhap_kho' ? '<span class="badge green">Đã nhập kho</span>' : p.status==='lsx_dang_qc' ? '<span class="badge orange">Chờ QC · chưa tính tồn</span>' : p.status==='lsx_hoan_thanh' ? '<span class="badge orange">Chờ nhập kho</span>' : '<span class="badge slate">Chưa đến bước</span>'))}
          ${infoItem('Tổng giờ máy', fmtDec(totalHours) + ' giờ')}
          ${(() => { const t = lsxStageTimes(p); return infoItem('Bắt đầu thực tế', t.start ? lsxDateTime(t.start) : '<span class="muted">Chưa bắt đầu</span>') + infoItem('Hoàn thành thực tế', t.end ? lsxDateTime(t.end) : '<span class="muted">Chưa hoàn thành</span>') + infoItem('Thời gian chạy', t.start ? `${fmtDec(t.elapsedH, 1)} giờ${t.end ? '' : ' (đang chạy)'}` : '—'); })()}
          ${infoItem('Sản lượng thực tế', p.actualQty !== undefined && p.actualQty !== '' && p.actualQty !== null ? `<b>${fmtN(p.actualQty)} ${esc(p.unit || '')}</b> ${lsxVarianceHtml(p)}${p.actualQtyNote ? `<div class="cell-sub">${esc(p.actualQtyNote)}</div>` : ''}` : '<span class="muted">Chưa ghi nhận</span>')}
        </div>
      </div>
    </div>

    <!-- TIẾN ĐỘ TỔNG -->
    <div class="card">
      <div class="card-head"><div><h3>Tiến độ tổng</h3><p>Tính theo sản lượng qua từng công đoạn</p></div></div>
      <div class="card-body" style="display:flex;flex-direction:column;align-items:center;gap:12px">
        <div class="ring-wrap">
          ${Charts.ring(prog)}
          <div class="ring-val"><b>${prog}%</b><span>hoàn thành</span></div>
        </div>
        <div style="text-align:center;font-size:12.6px;color:var(--text-2)">
          Đã qua <b>${fmtN(doneQty)}</b> / ${fmtN(p.qty * p.stages.length)} lượt công đoạn<br/>
          Công đoạn hiện tại: <b style="color:var(--primary)">${esc(currentStage(p).name)}</b>
        </div>
        <div class="stat-strip" style="width:100%">
          <div><div class="l">Đạt QC</div><div class="v" style="color:var(--green)">${fmtN(p.qcPass)}</div></div>
          <div><div class="l">Lỗi</div><div class="v" style="color:${p.qcFail ? 'var(--red)' : 'var(--text-3)'}">${fmtN(p.qcFail)}</div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- NGUYÊN LIỆU ĐÃ ĐƯỢC CẤP TỪ KẾ HOẠCH SẢN XUẤT -->
  <div class="card" style="margin-bottom:14px">
    <div class="card-head">
      <span class="mkpi-ico t-${materialState.code==='ISSUED' ? 'green' : 'orange'}"><i class="fa-solid fa-boxes-packing"></i></span>
      <div><h3>Nguyên liệu cấp cho lệnh sản xuất</h3>
        <p>${materialRequest ? `Theo phiếu ${esc(materialRequest.id)} của kế hoạch ${esc(p.planId||'—')} · ${esc(materialState.label)}` : 'Lệnh chưa có phiếu cấp NVL từ Kế hoạch sản xuất'}</p></div>
    </div>
    ${materialRequest ? tableShell(
      [{ t:'Mã NVL', w:'100px' }, { t:'Nguyên liệu' }, { t:'Số lượng cấp', cls:'right' }, { t:'Trạng thái', w:'150px' }],
      (materialRequest.items||[]).map(i=>`<tr><td><span class="code">${esc(i.materialId)}</span></td><td class="strong">${esc(Q.material(i.materialId)?.name||i.materialId)}</td><td class="right num">${fmtDec(i.qty,2)} ${esc(Q.material(i.materialId)?.unit||'')}</td><td><span class="badge ${materialState.code==='ISSUED'?'green':'orange'}">${esc(materialState.label)}</span></td></tr>`),
      {emptyTitle:'Phiếu chưa có nguyên liệu'}) : `<div class="card-body"><div class="alert warning"><i class="fa-solid fa-triangle-exclamation"></i><span>LSX chuẩn phải được tạo từ Kế hoạch sản xuất sau khi Kho đã cấp NVL. Không lập yêu cầu NVL lại tại Lệnh sản xuất.</span></div></div>`}
  </div>

  <!-- ĐỊNH MỨC CÔNG ĐOẠN LẤY TỪ BÁO GIÁ -->
  ${(() => {
    const routing = expandRouting((p.routingOverride && p.routingOverride.length) ? p.routingOverride : (Q.product(p.productId) || {}).routing);
    if (!routing.length) return '';
    const totalHours = routing.reduce((s, o) => s + o.hoursPer, 0);
    const totalCost = routing.reduce((s, o) => s + o.amount, 0);
    return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <span class="mkpi-ico t-indigo"><i class="fa-solid fa-gears"></i></span>
        <div><h3>Định mức công đoạn (routing)</h3>
          <p>${p.routingOverride?.length ? 'Theo kế hoạch sản xuất' : 'Theo BOM / định mức chuẩn'} — ${routing.length} công đoạn thực hiện theo thứ tự</p></div>
        <div class="right"><button class="btn btn-sm" data-act="go" data-id="operations"><i class="fa-solid fa-list"></i>Danh mục công đoạn</button></div>
      </div>
      ${tableShell(
        [{ t: 'Mã CĐ', w: '80px' }, { t: 'Công đoạn' }, { t: 'Phân xưởng' }, { t: 'Máy / thiết bị', cls: 'hide-sm' },
         { t: 'Giờ/SP', cls: 'right' }, { t: 'Tổng giờ', cls: 'right' }, { t: 'Đơn giá giờ', cls: 'right hide-sm' }, { t: 'Chi phí lệnh', cls: 'right' }],
        routing.map((o) => `<tr class="clickable" data-act="open-operation" data-id="${o.operationId}">
          <td><span class="code">${o.operationId}</span></td>
          <td class="strong">${esc(o.name)}</td>
          <td><span class="chip"><i class="fa-solid ${STAGE_ICON[o.workshop] || 'fa-gear'}"></i>${esc(o.workshop)}</span></td>
          <td class="muted hide-sm">${esc(o.machine)}</td>
          <td class="right num">${fmtDec(o.hoursPer, 2)}</td>
          <td class="right num strong">${fmtDec(o.hoursPer * p.qty, 1)}</td>
          <td class="right num muted hide-sm">${fmtVND(o.rate)}</td>
          <td class="right strong num">${fmtVND(o.amount * p.qty)}</td></tr>`))}
      <div class="card-foot" style="display:flex;justify-content:flex-end;gap:24px;font-size:13px">
        <span>Tổng giờ máy định mức: <b class="num">${fmtDec(totalHours * p.qty, 1)} giờ</b></span>
        <span>Chi phí gia công: <b class="num" style="color:var(--indigo)">${fmtVND(totalCost * p.qty)}</b></span>
      </div>
    </div>`;
  })()}

  <!-- QUY TRÌNH SẢN XUẤT DẠNG KANBAN -->
  <div class="card">
    <div class="card-head">
      <div><h3>Quy trình sản xuất — ${p.stages.length} công đoạn</h3><p>Công đoạn lấy từ BOM / routing; QC và Hoàn thành luôn bắt buộc</p></div>
      <div class="right"><span class="chip"><i class="fa-solid fa-check"></i> ${p.stages.filter((s) => s.status === 'done').length}/${p.stages.length} công đoạn xong</span></div>
    </div>
    <div class="card-body">
      <div class="kanban">
        ${p.stages.map((s, i) => {
          const pct = p.qty ? (isProcessQcStage(p,i) ? Math.round((s.qtyDone / p.qty) * 1000) / 10 : Math.round((s.qtyDone / p.qty) * 100)) : 0;
          const canStart = s.status === 'pending' && (i === 0 || p.stages[i - 1].status === 'done');
          return `<div class="kcol ${s.status}">
            <div class="kcol-head">
              <span class="n">${i + 1}</span>
              <b>${esc(s.name)}</b>
              <span style="margin-left:auto"><i class="fa-solid ${STAGE_ICON[s.name]}" style="color:var(--text-3)"></i></span>
            </div>
            <div class="kcol-body">
              <div>${s.status === 'done' ? '<span class="badge green">Hoàn tất</span>' : s.status === 'doing' ? (()=>{ const q=s.processQc||{}; const pending=Number(q.pendingReworkQty||(q.status==='FAILED'?q.lastFailQty:0)||0); const ready=Number(q.readyRetestQty||0); return isProcessQcStage(p,i) && pending>0 ? `<span class="badge red">Chờ sửa/tái chế ${fmtN(pending)} ${esc(p.unit||'')}</span>` : isProcessQcStage(p,i) && ready>0 ? `<span class="badge orange">Chờ QC tái kiểm ${fmtN(ready)} ${esc(p.unit||'')}</span>` : '<span class="badge blue">Đang chạy</span>'; })() : '<span class="badge slate">Chờ</span>'}</div>
              <div class="kfield"><i class="fa-solid fa-user"></i>${esc(Q.employeeName(s.leadId))}</div>
              <div class="kfield"><i class="fa-solid fa-robot"></i>${esc(s.machine)}</div>
              ${(() => {
                // Các công đoạn trong định mức thuộc phân xưởng này (đến từ báo giá)
                const ops = Q.opsOfStage(p.productId, s.name);
                if (!ops.length) return '';
                const h = ops.reduce((t, o) => t + o.hoursPer, 0);
                return `<div style="background:var(--surface);border:1px dashed var(--border-2);border-radius:7px;padding:6px 8px;font-size:11px;line-height:1.5">
                    <div style="color:var(--text-3);font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:9.5px;margin-bottom:3px">Định mức từ báo giá</div>
                    ${ops.map((o) => `<div style="color:var(--text-2)">• ${esc(o.name)} — ${fmtDec(o.hoursPer, 2)}h/${esc(p.unit)}</div>`).join('')}
                    <div style="color:var(--indigo);font-weight:700;margin-top:2px">Σ ${fmtDec(h * p.qty, 1)} giờ cho ${fmtN(p.qty)} ${esc(p.unit)}</div>
                  </div>`;
              })()}
              <div class="kfield"><i class="fa-regular fa-clock"></i>${s.hours ? fmtDec(s.hours) + ' giờ máy thực tế' : 'Chưa phát sinh'}</div>
              <div class="kfield"><i class="fa-solid fa-cubes"></i>${fmtN(s.qtyDone)} / ${fmtN(s.qtyPlan)} ${esc(p.unit)}</div>
              ${s.start ? `<div class="kfield"><i class="fa-regular fa-calendar"></i>${s.actualStartedAt ? lsxDateTime(s.actualStartedAt) : fmtDate(s.start)}${s.end ? ' → ' + (s.actualEndedAt ? lsxDateTime(s.actualEndedAt) : fmtDate(s.end)) : ''}</div>` : ''}
              <div style="margin-top:2px">${progressBar(pct)}</div>
            </div>
            <div class="kcol-foot">
              ${s.status === 'done' ? '<button class="btn btn-xs" disabled style="width:100%"><i class="fa-solid fa-check"></i>Đã xong</button>'
                : s.status === 'doing' ? (isFinalQcStage(p, i) ? `<button class="btn btn-xs btn-primary" style="width:100%" data-act="po-qc" data-id="${p.id}"><i class="fa-solid fa-clipboard-check"></i>Mở QC thành phẩm</button>` : isProcessQcStage(p,i) ? (()=>{ const q=s.processQc||{}; const pending=Number(q.pendingReworkQty||(q.status==='FAILED'?q.lastFailQty:0)||0); const ready=Number(q.readyRetestQty||0); return pending>0 ? `<button class="btn btn-xs btn-warning" style="width:100%" data-act="pqc-rework-done" data-id="${p.id}" data-i="${i}"><i class="fa-solid fa-screwdriver-wrench"></i>Xác nhận đã sửa/tái chế ${fmtN(pending)}</button>` : ready>0 ? `<button class="btn btn-xs" disabled style="width:100%"><i class="fa-solid fa-rotate"></i>Chờ QC tái kiểm ${fmtN(ready)}</button>` : `<button class="btn btn-xs" disabled style="width:100%"><i class="fa-solid fa-vial-circle-check"></i>Chờ QC bán thành phẩm</button>`; })() : `<button class="btn btn-xs btn-primary" style="width:100%" data-act="stage-update" data-id="${p.id}" data-i="${i}"><i class="fa-solid fa-pen"></i>Ghi nhận sản lượng</button>`)
                : canStart ? `<button class="btn btn-xs" style="width:100%" data-act="stage-start" data-id="${p.id}" data-i="${i}"><i class="fa-solid fa-play"></i>${isProcessQcStage(p,i)?'Chuyển QC bán thành phẩm':'Bắt đầu'}</button>`
                : '<button class="btn btn-xs" disabled style="width:100%">Chờ công đoạn trước</button>'}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ${(() => {
      const finalQcIdx = (p.stages || []).findIndex((st, idx) => isFinalQcStage(p, idx));
      const finalQcReady = finalQcIdx >= 0 && (p.stages || []).slice(0, finalQcIdx).every(st => st.status === 'done');
      return (order || finalQcReady) ? `<div class="card-foot" style="display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end">
        ${order ? `<button class="btn btn-sm" data-act="open-order" data-id="${order.id}"><i class="fa-solid fa-cart-flatbed"></i>Xem đơn hàng ${order.id}</button>` : ''}
        ${finalQcReady ? `<button class="btn btn-sm btn-success" data-act="po-qc" data-id="${p.id}"><i class="fa-solid fa-clipboard-check"></i>Mở kiểm tra thành phẩm</button>` : ''}
      </div>` : '';
    })()}
  </div>`;
};

/* ------------------------------------------ MODAL GHI NHẬN SẢN LƯỢNG */
function openProductionReceiptModal(poId) {
  const po = Q.po(poId); if (!po) return;
  const existing = productionOrderFinishedReceipt(po);
  if (existing) { Toast.info('Đã nhập kho thành phẩm', existing.id); return; }
  if (po.status !== 'lsx_hoan_thanh') { Toast.warn('Lệnh chưa hoàn thành', 'Chỉ lệnh sản xuất đã hoàn thành mới được nhập kho thành phẩm.'); return; }
  const qty = Number(po.qcPass || po.qty || 0);
  if (!(qty > 0)) { Toast.warn('Không có sản lượng đạt', 'Không có thành phẩm đạt QC để nhập kho.'); return; }
  const warehouses = (DB.warehouses || []).filter(w => w.type === 'FINISHED_GOODS' && w.status !== 'inactive');
  if (!warehouses.length) { Toast.err('Chưa có Kho thành phẩm', 'Hãy khai báo ít nhất một kho FINISHED_GOODS trước khi nhập kho.'); return; }
  const defaultWh = warehouses[0];
  const locations = (DB.warehouseLocations || []).filter(l => warehouses.some(w => w.id === l.warehouseId) && l.status !== 'inactive');
  const today = currentDateYMD();
  Modal.open({
    title: `Nhập kho thành phẩm · ${po.id}`,
    sub: `${po.productName} · Sản lượng đạt QC ${fmtN(qty)} ${po.unit}`,
    size: 'md',
    body: `<div class="form-grid cols-2">
      <div class="field"><label>Kho thành phẩm *</label><select class="inp" id="poFgWarehouse">${warehouses.map(w=>`<option value="${esc(w.id)}" ${w.id===defaultWh.id?'selected':''}>${esc(w.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Kệ / vị trí *</label><select class="inp" id="poFgLocation"><option value="">-- Chọn vị trí --</option>${locations.map(l=>`<option value="${esc(l.id)}">${esc(Q.warehouseName(l.warehouseId))} · ${esc(l.code||l.name||l.id)}</option>`).join('')}</select></div>
      <div class="field"><label>Số lượng nhập *</label><input class="inp right num" id="poFgQty" type="number" min="0.0001" max="${qty}" step="0.0001" value="${qty}"></div>
      <div class="field"><label>Mã lô thành phẩm *</label><input class="inp" id="poFgLot" value="LOT-${esc(po.id)}"></div>
      <div class="field"><label>Ngày sản xuất</label><input class="inp" id="poFgMfg" type="date" min="${today}" value="${today}"></div>
      <div class="field"><label>Hạn sử dụng</label><input class="inp" id="poFgExp" type="date" min="${today}" value="${addDays(today,7)}"></div>
      <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea class="inp" id="poFgNote" rows="2">Nhập kho thành phẩm từ ${esc(po.id)}</textarea></div>
    </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="po-fg-receipt-save" data-id="${esc(po.id)}"><i class="fa-solid fa-box-open"></i>Xác nhận nhập kho</button>`
  });
}

function openStageModal(poId, index) {
  const p = Q.po(poId);
  const s = p.stages[index];
  const qtyPlan = Number(s.qtyPlan || 0);
  const qtyDone = Number(s.qtyDone || 0);
  const qtyRemain = Math.max(0, qtyPlan - qtyDone);
  Modal.open({
    title: `Ghi nhận công đoạn: ${esc(s.name)}`,
    sub: `${p.id} · ${esc(p.productName)} · Kế hoạch ${fmtN(qtyPlan)} ${esc(p.unit)}`,
    body: `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
        <div class="mini-stat"><div class="muted">Đã hoàn thành</div><b>${fmtN(qtyDone)} ${esc(p.unit)}</b></div>
        <div class="mini-stat"><div class="muted">Kế hoạch</div><b>${fmtN(qtyPlan)} ${esc(p.unit)}</b></div>
        <div class="mini-stat"><div class="muted">Còn lại</div><b>${fmtN(qtyRemain)} ${esc(p.unit)}</b></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Sản lượng bổ sung lần này (${esc(p.unit)}) <span class="req">*</span></label>
          <input class="inp num" type="number" id="stQty" min="0.0001" max="${qtyRemain}" step="0.0001" value="" placeholder="Tối đa ${fmtN(qtyRemain)}" /></div>
        <div class="field"><label>Giờ máy phát sinh lần này <span class="req">*</span></label>
          <input class="inp num" type="number" id="stHours" min="0.0001" step="0.5" value="" /></div>
        <div class="field"><label>Người phụ trách <span class="req">*</span></label>
          <select class="inp" id="stLead">
            ${DB.employees.filter((e) => ['Sản xuất', 'QC/KCS', 'Kho vận'].includes(e.dept) && e.status !== 'ns_nghi_viec').slice(0, 40)
              .map((e) => `<option value="${e.id}" ${s.leadId === e.id ? 'selected' : ''}>${esc(e.name)} — ${esc(e.position)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Máy / trạm <span class="req">*</span></label>
          <input class="inp" id="stMachine" value="${esc(s.machine)}" /></div>
      </div>
      <div class="field"><label>Ghi chú <span class="muted">(không bắt buộc)</span></label>
        <textarea class="inp" id="stNote" rows="2" placeholder="Ví dụ: dừng 30 phút thay dao phay…"></textarea></div>
      <div style="font-size:12.3px;color:var(--text-3);background:var(--surface-2);border-radius:var(--r);padding:10px 12px">
        <i class="fa-solid fa-circle-info" style="color:var(--primary)"></i>
        Mỗi lần ghi nhận sẽ <b>cộng dồn</b> vào sản lượng đã hoàn thành. Chỉ khi tổng đạt đúng <b>${fmtN(qtyPlan)} ${esc(p.unit)}</b> thì công đoạn mới hoàn tất.
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-primary" data-act="stage-save" data-id="${p.id}" data-i="${index}"><i class="fa-solid fa-floppy-disk"></i>Lưu sản lượng</button>`,
  });
}

/* ============================================================================
 * DANH MỤC CÔNG ĐOẠN SẢN XUẤT
 * Nơi các công đoạn bóc tách từ báo giá được lưu về và tái sử dụng làm định mức.
 * ==========================================================================*/
Views.operations = function () {
  const f = F('operations', { q: '', workshop: '', source: '' });
  if (State.params.filter === 'new') { f.source = 'quote'; State.params.filter = null; }
  const q = (f.q || '').toLowerCase().trim();

  const list = DB.operations.filter((o) => {
    if (f.workshop && o.workshop !== f.workshop) return false;
    if (f.source === 'quote' && !o.source) return false;
    if (f.source === 'base' && o.source) return false;
    if (q && ![o.id, o.name, o.workshop, o.machine].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  });
  const pg = paged(list, 'operations');

  const fromQuote = DB.operations.filter((o) => o.source).length;
  const avgRate = DB.operations.length ? Math.round(DB.operations.reduce((s, o) => s + o.rate, 0) / DB.operations.length) : 0;

  /** Tổng giờ định mức của một công đoạn trên toàn bộ lệnh sản xuất đang chạy */
  const plannedHours = (oid) => DB.productionOrders.reduce((s, po) => {
    const r = (Q.product(po.productId) || {}).routing || [];
    const hit = r.find(([id]) => id === oid);
    return s + (hit ? hit[1] * po.qty : 0);
  }, 0);

  const rows = pg.items.map((o) => {
    const used = Q.productsUsingOp(o.id);
    return `<tr class="clickable" data-act="open-operation" data-id="${o.id}">
      <td><span class="code">${o.id}</span></td>
      <td>${cell2(esc(o.name), esc(o.machine))}</td>
      <td><span class="chip"><i class="fa-solid ${STAGE_ICON[o.workshop] || 'fa-gear'}"></i>${esc(o.workshop)}</span></td>
      <td class="center">${esc(o.unit)}</td>
      <td class="right" onclick="event.stopPropagation()">
        <input class="inp right num" type="number" min="0" step="10000" data-op-rate="${o.id}" value="${o.rate}" style="width:130px" title="Sửa trực tiếp đơn giá giờ" /></td>
      <td class="center num hide-sm">${used.length}</td>
      <td class="right num hide-sm">${fmtDec(plannedHours(o.id), 1)} giờ</td>
      <td class="hide-sm">${esc(Q.employeeName(o.leadId))}</td>
      <td>${o.source
        ? `<span class="badge blue" title="Được khai báo khi lập báo giá ${o.source}">Từ ${esc(o.source)}</span>`
        : '<span class="badge slate">Danh mục gốc</span>'}</td>
    </tr>`;
  });

  return `
  ${pageHead('Công đoạn sản xuất', 'Danh mục công đoạn gia công — nguồn định mức cho báo giá và lệnh sản xuất', `
    <button class="btn" data-act="export-operations"><i class="fa-solid fa-file-export"></i>Export</button>
    <button class="btn btn-primary" data-act="new-quote"><i class="fa-solid fa-file-invoice-dollar"></i>Bóc tách từ báo giá</button>
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng công đoạn', DB.operations.length, 'fa-gears', 'indigo')}
    ${mkpi('Phân xưởng', new Set(DB.operations.map((o) => o.workshop)).size, 'fa-industry', 'blue')}
    ${mkpi('Đơn giá giờ TB', fmtVND(avgRate), 'fa-tag', 'teal')}
    ${mkpi('Khai báo từ báo giá', fromQuote, 'fa-file-invoice-dollar', fromQuote ? 'green' : 'slate', fromQuote ? 'filter-op-new' : '')}
    ${mkpi('Sản phẩm có định mức', DB.products.filter((p) => (p.routing || []).length).length, 'fa-cube', 'orange')}
  </div>

  <div class="grid g-2" style="margin-bottom:14px">
    <div class="card">
      <div class="card-head"><div><h3>Đơn giá giờ theo công đoạn</h3><p>Giá giờ máy + nhân công dùng để tính giá thành trong báo giá</p></div></div>
      <div class="card-body"><div class="chart-box"><canvas id="chOpRate"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Khối lượng giờ định mức theo phân xưởng</h3><p>Tổng giờ của toàn bộ lệnh sản xuất đang theo dõi</p></div></div>
      <div class="card-body"><div class="chart-box"><canvas id="chOpWorkshop"></canvas></div></div>
    </div>
  </div>

  <div class="card">
    <div class="toolbar">
      ${searchBox('operations', 'Tìm mã, tên công đoạn, máy…')}
      ${selectFilter('operations', 'workshop', DB.workshopNames.map((w) => [w, w]), 'Tất cả phân xưởng')}
      ${selectFilter('operations', 'source', [['base', 'Danh mục gốc'], ['quote', 'Khai báo từ báo giá']], 'Tất cả nguồn')}
      ${(f.q || f.workshop || f.source) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="operations"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} công đoạn</span>
    </div>
    ${tableShell(
      [{ t: 'Mã CĐ', w: '84px' }, { t: 'Công đoạn / thiết bị' }, { t: 'Phân xưởng', w: '140px' }, { t: 'ĐVT', cls: 'center', w: '62px' },
       { t: 'Đơn giá giờ', cls: 'right' }, { t: 'SP áp dụng', cls: 'center hide-sm' }, { t: 'Giờ định mức', cls: 'right hide-sm' },
       { t: 'Tổ trưởng', cls: 'hide-sm' }, { t: 'Nguồn', w: '140px' }],
      rows, { emptyTitle: 'Không tìm thấy công đoạn' })}
    ${pagiHTML('operations', pg, 'công đoạn')}
  </div>`;
};

Views.operations.after = function () {
  const ops = [...DB.operations].sort((a, b) => b.rate - a.rate).slice(0, 12);
  Charts.bar('chOpRate', ops.map((o) => o.name.length > 20 ? o.name.slice(0, 19) + '…' : o.name),
    [{ label: 'Đơn giá giờ', data: ops.map((o) => o.rate), color: 'indigo' }], { money: true, horizontal: true });

  const byWs = {};
  DB.productionOrders.forEach((po) => {
    ((Q.product(po.productId) || {}).routing || []).forEach(([oid, h]) => {
      const o = Q.operation(oid);
      if (!o) return;
      byWs[o.workshop] = (byWs[o.workshop] || 0) + h * po.qty;
    });
  });
  const names = DB.workshopNames.filter((w) => byWs[w]);
  Charts.bar('chOpWorkshop', names, [{ label: 'Giờ định mức', data: names.map((w) => Math.round(byWs[w])), color: 'blue' }]);
};

function openOperationModal(id) {
  const o = Q.operation(id);
  if (!o) return;
  const used = Q.productsUsingOp(id);
  const pos = DB.productionOrders.filter((p) => ((Q.product(p.productId) || {}).routing || []).some(([x]) => x === id));

  Modal.open({
    title: `${esc(o.name)}`,
    sub: `${o.id} · Phân xưởng ${esc(o.workshop)} · ${esc(o.machine)}`,
    size: 'md',
    body: `
      <div class="grid g-auto-sm" style="margin-bottom:16px">
        ${mkpi('Đơn giá giờ', fmtVND(o.rate), 'fa-tag', 'indigo')}
        ${mkpi('Sản phẩm áp dụng', used.length, 'fa-cube', 'blue')}
        ${mkpi('Lệnh SX liên quan', pos.length, 'fa-industry', 'orange')}
        ${mkpi('Nguồn', o.source ? 'Báo giá' : 'Danh mục gốc', 'fa-file-invoice-dollar', o.source ? 'green' : 'slate')}
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-circle-info"></i>Thông tin công đoạn</div>
      <div class="info-grid" style="margin-bottom:18px">
        ${infoItem('Mã công đoạn', `<span class="code">${o.id}</span>`)}
        ${infoItem('Phân xưởng', esc(o.workshop))}
        ${infoItem('Máy / thiết bị', esc(o.machine))}
        ${infoItem('Đơn vị tính', esc(o.unit))}
        ${infoItem('Tổ trưởng phụ trách', esc(Q.employeeName(o.leadId)))}
        ${infoItem('Nguồn khai báo', o.source ? `Bóc tách từ báo giá <span class="code">${esc(o.source)}</span>` : 'Danh mục ban đầu của hệ thống')}
      </div>

      <div class="form-sec-title"><i class="fa-solid fa-cube"></i>Sản phẩm đang dùng công đoạn này</div>
      ${tableShell(
        [{ t: 'Mã SP', w: '84px' }, { t: 'Sản phẩm' }, { t: 'Giờ / SP', cls: 'right' }, { t: 'Chi phí / SP', cls: 'right' }],
        used.map((p) => {
          const h = (p.routing.find(([x]) => x === id) || [0, 0])[1];
          return `<tr>
            <td><span class="code">${p.id}</span></td>
            <td class="strong">${esc(p.name)}</td>
            <td class="right num">${fmtDec(h, 2)} giờ</td>
            <td class="right strong num">${fmtVND(h * o.rate)}</td></tr>`;
        }),
        { emptyTitle: 'Chưa sản phẩm nào dùng', emptyDesc: 'Công đoạn này sẽ được gắn vào sản phẩm khi bóc tách báo giá.' })}`,
    foot: `<button class="btn" data-act="modal-close">Đóng</button>
           <button class="btn" data-act="go" data-id="production"><i class="fa-solid fa-industry"></i>Lệnh sản xuất</button>`,
  });
}

/* ------------------------------------------------- TIẾN ĐỘ SẢN XUẤT */
Views.progress = function () {
  const f = F('progress', { stage: '', status: '' });
  const active = DB.productionOrders.filter((p) => !['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status));
  const late = active.filter((p) => daysTo(p.deadline) < 0);
  const soon = active.filter((p) => { const d = daysTo(p.deadline); return d >= 0 && d <= lsxNearDeadlineDays(); });
  const avg = active.length ? Math.round(active.reduce((s, p) => s + Q.progress(p), 0) / active.length) : 0;

  // Nhóm các lệnh đang chạy theo công đoạn hiện tại
  const byStage = DB.stageNames.map((name) => ({
    name,
    items: active.filter((p) => currentStage(p).name === name),
  }));

  return `
  ${pageHead('Tiến độ sản xuất', 'Bảng điều hành xưởng theo công đoạn và năng lực máy', `
    <button class="btn" data-act="go" data-id="production"><i class="fa-solid fa-list"></i>Danh sách lệnh</button>
    <button class="btn" data-act="export-progress"><i class="fa-solid fa-file-export"></i>Xuất tiến độ</button>
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Lệnh đang chạy', active.length, 'fa-gears', 'blue')}
    ${mkpi('Tiến độ trung bình', avg + '%', 'fa-gauge-high', avg >= 60 ? 'green' : 'orange')}
    ${mkpi(`Sắp tới hạn (≤${lsxNearDeadlineDays()} ngày)`, soon.length, 'fa-hourglass-half', 'orange')}
    ${mkpi('Đã trễ deadline', late.length, 'fa-triangle-exclamation', late.length ? 'red' : 'slate')}
    ${mkpi('Sản lượng tháng', fmtN(DB.workshops.reduce((s, w) => s + w.output, 0)) + ' giờ máy', 'fa-industry', 'indigo')}
  </div>

  <div class="grid g-2" style="margin-bottom:14px">
    <div class="card">
      <div class="card-head"><div><h3>Năng lực phân xưởng</h3><p>Giờ máy đã dùng / năng lực tối đa tháng 08/2026</p></div></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:13px">
        ${DB.workshops.map((w) => {
          const pct = Math.round((w.output / w.capacity) * 100);
          return `<div>
            <div style="display:flex;justify-content:space-between;font-size:12.6px;margin-bottom:5px">
              <b>${esc(w.name)}</b>
              <span class="muted num">${fmtN(w.output)} / ${fmtN(w.capacity)} giờ · <b style="color:${pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--orange)' : 'var(--green)'}">${pct}%</b></span>
            </div>
            <div class="bar ${pct >= 90 ? 'red' : pct >= 75 ? 'orange' : 'green'}"><span style="width:${pct}%"></span></div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Tiến độ các lệnh đang chạy</h3><p>So sánh % hoàn thành giữa các lệnh sản xuất</p></div></div>
      <div class="card-body"><div class="chart-box"><canvas id="chProgress"></canvas></div></div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <div><h3>Bảng điều hành theo công đoạn</h3><p>Lệnh sản xuất đang nằm ở từng công đoạn của xưởng</p></div>
      <div class="right"><span class="chip"><i class="fa-solid fa-industry"></i> ${active.length} lệnh đang chạy</span></div>
    </div>
    <div class="card-body">
      <div class="kanban">
        ${byStage.map((col, i) => `
          <div class="kcol ${col.items.length ? 'doing' : ''}">
            <div class="kcol-head">
              <span class="n">${col.items.length}</span><b>${esc(col.name)}</b>
              <span style="margin-left:auto"><i class="fa-solid ${STAGE_ICON[col.name]}" style="color:var(--text-3)"></i></span>
            </div>
            <div class="kcol-body">
              ${col.items.length ? col.items.map((p) => {
                const d = daysTo(p.deadline);
                return `<div class="alert-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:10px" data-act="open-production-order" data-id="${p.id}">
                  <div style="display:flex;align-items:center;gap:7px">
                    <span class="code" style="font-size:12px">${p.id}</span>
                    ${d < 0 ? '<span class="badge red no-dot" style="margin-left:auto;font-size:10px">Trễ</span>' : d <= 3 ? '<span class="badge orange no-dot" style="margin-left:auto;font-size:10px">Gấp</span>' : ''}
                  </div>
                  <div style="font-size:12px;font-weight:600;line-height:1.35">${esc(p.productName)}</div>
                  <div style="font-size:11.2px;color:var(--text-3)">${fmtN(p.qty)} ${esc(p.unit)} · ${esc(Q.customerName(p.customerId))}</div>
                  ${progressBar(Q.progress(p))}
                </div>`;
              }).join('') : '<div style="text-align:center;padding:16px 0;font-size:11.8px;color:var(--text-3)">Không có lệnh</div>'}
            </div>
          </div>`).join('')}
      </div>
    </div>
  </div>`;
};

Views.progress.after = function () {
  const active = DB.productionOrders.filter((p) => !['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status)).slice(0, 12);
  Charts.bar('chProgress', active.map((p) => p.id.replace('LSX-2026-', '#')), [
    // Màu theo mức độ hoàn thành: đỏ (chậm) → cam → xanh
    { label: '% hoàn thành', data: active.map((p) => Q.progress(p)),
      colorFn: (pal) => active.map((p) => { const v = Q.progress(p); return v >= 70 ? pal.green : v >= 40 ? pal.blue : pal.orange; }) },
  ], { horizontal: true });
};

/* ==========================================================================
 * PRODUCTION FLOW V2: BOM / KẾ HOẠCH SX / YÊU CẦU NVL
 * Bổ sung theo luồng Kho -> duyệt kế hoạch -> Sản xuất -> yêu cầu NVL -> Kho xuất.
 * Không thay đổi các lệnh sản xuất/công đoạn hiện hữu.
 * ========================================================================== */
DB.productionPlans = DB.productionPlans || [];
DB.productionMaterialRequests = DB.productionMaterialRequests || [];

function pfFinishedStock(productId) {
  return (DB.inventory || []).filter(r => r.productId === productId)
    .reduce((s,r) => s + Number(r.qtyAvailable ?? r.qtyOnHand ?? 0), 0);
}
function pfPlanStatus(status) {
  const map = {
    WAITING_APPROVAL:['Chờ duyệt Kho','orange'], WAITING_SALES_APPROVAL:['Chờ duyệt yêu cầu SX','orange'], APPROVED:['Đã duyệt','green'],
    MATERIAL_REQUESTED:['Đã yêu cầu NVL','blue'], MATERIAL_ISSUED:['Đã xuất NVL','indigo'],
    RELEASED:['Đã tạo LSX','green'], CANCELLED:['Đã hủy','slate']
  };
  const x=map[status]||[status||'—','slate']; return `<span class="badge ${x[1]}">${x[0]}</span>`;
}
function pfRequestStatus(status) {
  const map={WAITING_WAREHOUSE_APPROVAL:['Chờ xuất NVL','orange'],APPROVED:['Chờ xuất NVL','blue'],ISSUED:['Đã xuất NVL','green'],COMPLETED:['Đã hoàn thành','green'],REJECTED:['Từ chối','red']};
  const x=map[status]||[status||'—','slate']; return `<span class="badge ${x[1]}">${x[0]}</span>`;
}
function pfBomRequiredQty(qtyPerUnit, productionQty, lossPct=0) {
  const base=Number(qtyPerUnit||0)*Number(productionQty||0);
  const loss=Math.max(0,Math.min(99.99,Number(lossPct||0)));
  return loss>0 ? base/(1-loss/100) : base;
}
function pfBomText(product) {
  const rows=(product?.bom||[]).map(([mid,qty,lossPct=0])=>{
    const m=Q.material(mid);
    const loss=Number(lossPct||0);
    return `${m?.name||mid}: ${fmtDec(Number(qty||0),3)} ${m?.unit||''}/1${loss>0?` · hao hụt ${fmtDec(loss,2)}%`:''}`;
  });
  return rows.length?rows.join(' · '):'Chưa khai báo định mức';
}

Views.productionBom = function () {
  const rows=(DB.products||[]).map(p=>`<tr>
    <td><span class="code">${esc(p.id)}</span></td><td class="strong">${esc(p.name)}</td><td>${esc(p.unit||'')}</td>
    <td class="right num">${(p.bom||[]).length}</td><td class="right num">${(p.routing||[]).length}</td><td class="muted">${esc(pfBomText(p))}</td>
    <td class="right">${rowActions([{act:'pf-bom-view',data:`data-id="${esc(p.id)}"`,icon:'fa-eye',title:'Xem chi tiết BOM'},{act:'pf-bom-edit',data:`data-id="${esc(p.id)}"`,icon:'fa-pen',title:'Khai báo / sửa BOM'},...((p.bom||[]).length?[{act:'pf-bom-delete',data:`data-id="${esc(p.id)}"`,icon:'fa-trash',title:'Xóa BOM'}]:[])])}</td></tr>`);
  return `${pageHead('BOM / Định mức','Khai báo nguyên liệu và lượng tiêu hao chuẩn cho 1 đơn vị thành phẩm',
    '<button class="btn btn-primary" data-act="pf-bom-new"><i class="fa-solid fa-plus"></i>Khai báo BOM</button>')}
    <div class="card">${tableShell([{t:'Mã TP'},{t:'Thành phẩm'},{t:'ĐVT'},{t:'Số NVL',cls:'right'},{t:'Số công đoạn',cls:'right'},{t:'Định mức hiện tại'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có thành phẩm'})}</div>`;
};

function pfOpenBomModal(productId='') {
  const products=DB.products||[];
  const selected=Q.product(productId)||products[0];
  const makeLines=(p)=>((p?.bom||[]).length?p.bom:[[DB.materials?.[0]?.id||'',1,0]]).map(([mid,qty,lossPct=0])=>`<div class="pf-bom-line" style="display:grid;grid-template-columns:minmax(0,1fr) 132px 112px 40px;gap:8px;margin-bottom:8px;align-items:center;min-width:0">
    <select class="inp" name="material" style="min-width:0;width:100%">${(DB.materials||[]).map(m=>`<option value="${esc(m.id)}" ${m.id===mid?'selected':''}>${esc(m.id)} — ${esc(m.name)} (${esc(m.unit||'')})</option>`).join('')}</select>
    <input class="inp right num" name="qty" type="number" min="0.0001" step="0.0001" value="${Number(qty||0)}" title="Định mức cho 1 đơn vị thành phẩm">
    <div style="display:grid;grid-template-columns:1fr 26px;align-items:center;gap:4px"><input class="inp right num" name="lossPct" type="number" min="0" max="99.99" step="0.01" value="${Number(lossPct||0)}" title="Tỷ lệ hao hụt"><span class="muted">%</span></div>
    <button class="btn btn-sm" type="button" data-act="pf-bom-remove-line"><i class="fa-solid fa-trash"></i></button></div>`).join('');
  const makeRouting=(p)=>((p?.routing||[]).length?p.routing:[[DB.operations?.[0]?.id||'',0.01]]).map(([oid,hours])=>`<div class="pf-bom-op-line" data-hours="${Number(hours||0.01)}" style="display:grid;grid-template-columns:1fr 42px;gap:8px;margin-bottom:8px">
    <select class="inp" name="operation">${(DB.operations||[]).map(o=>`<option value="${esc(o.id)}" ${o.id===oid?'selected':''}>${esc(o.id)} — ${esc(o.name)} · ${esc(o.workshop||'')}</option>`).join('')}</select>
    <button class="btn btn-sm" type="button" data-act="pf-bom-remove-op"><i class="fa-solid fa-trash"></i></button></div>`).join('');
  Modal.open({title:'Khai báo BOM / Định mức',sub:'Khai báo nguyên liệu và công đoạn chuẩn cho 1 đơn vị thành phẩm',size:'xl',body:`
    <div class="field"><label>Thành phẩm *</label><select class="inp" id="pfBomProduct">${products.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?.id?'selected':''}>${esc(p.id)} — ${esc(p.name)}</option>`).join('')}</select></div>
    <div class="grid g-2" style="align-items:start">
      <div class="card" style="min-width:0"><div class="card-head"><div><h3>Nguyên liệu định mức</h3><p>Định mức cho 1 ${esc(selected?.unit||'đơn vị')} thành phẩm. Hao hụt được dùng để tự tính lượng NVL cần cấp khi lập kế hoạch.</p></div><button class="btn btn-sm" type="button" data-act="pf-bom-add-line"><i class="fa-solid fa-plus"></i>Thêm nguyên liệu</button></div><div class="card-body" style="min-width:0;overflow-x:auto"><div style="display:grid;grid-template-columns:minmax(0,1fr) 132px 112px 40px;gap:8px;margin:0 0 6px;font-size:12px;font-weight:700;color:var(--muted);min-width:560px"><span>Nguyên liệu</span><span class="right">Định mức / 1 ĐVT</span><span class="right">Hao hụt %</span><span></span></div><div id="pfBomLines" style="min-width:560px">${makeLines(selected)}</div><div class="alert info" style="margin-top:12px"><i class="fa-solid fa-calculator"></i><span>Khi lập kế hoạch: <b>NVL cần cấp = định mức × số lượng kế hoạch ÷ (1 − % hao hụt)</b>.</span></div></div></div>
      <div class="card" style="min-width:0"><div class="card-head"><div><h3>Công đoạn / Gia công</h3><p>Chọn các công đoạn áp dụng cho thành phẩm</p></div><button class="btn btn-sm" type="button" data-act="pf-bom-add-op"><i class="fa-solid fa-plus"></i>Thêm công đoạn</button></div><div class="card-body" style="min-width:0"><div id="pfBomOps">${makeRouting(selected)}</div></div></div>
    </div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="pf-bom-save"><i class="fa-solid fa-floppy-disk"></i>Lưu BOM / Routing</button>`});
}

Views.productionPlanFlow = function () {
  const plans=(DB.productionPlans||[]).filter(p=>['APPROVED','MATERIAL_REQUESTED','MATERIAL_ISSUED','RELEASED'].includes(p.status));
  const rows=plans.map(p=>`<tr><td><span class="code">${esc(p.id)}</span></td><td>${fmtDate(p.date)}</td>
    <td>${(p.items||[]).map(i=>`${esc(Q.product(i.productId)?.name||i.productId)} <b>${fmtN(i.qty)}</b>`).join('<br>')}</td>
    <td>${pfPlanStatus(p.status)}${p.source==='SALES_ORDER'?`<div class="cell-sub">Từ đơn bán ${esc(p.sourceOrderId||'')}</div>`:''}</td><td>${esc(Q.employeeName(p.createdBy)||p.createdBy||'—')}</td>
    <td class="right">${rowActions([
      {act:'pf-plan-view',data:`data-id="${esc(p.id)}"`,icon:'fa-eye',title:'Xem chi tiết kế hoạch'},
      ...(p.status==='APPROVED'?[{act:'pf-plan-materials',data:`data-id="${esc(p.id)}"`,icon:'fa-boxes-packing',title:'Chuẩn bị NVL / công đoạn và lập phiếu yêu cầu'}]:[]),
      ...(p.status==='MATERIAL_ISSUED'?[{act:'pf-plan-release',data:`data-id="${esc(p.id)}"`,icon:'fa-industry',title:'Tạo lệnh sản xuất'}]:[])
    ])}</td></tr>`);
  return `${pageHead('Kế hoạch sản xuất','Kế hoạch đã được Kho duyệt; thông tin BOM, yêu cầu NVL, trạng thái cấp NVL và lệnh sản xuất được theo dõi ngay tại từng kế hoạch')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Đã duyệt',plans.filter(p=>p.status==='APPROVED').length,'fa-circle-check','green')}
      ${mkpi('Chờ kho cấp NVL',plans.filter(p=>p.status==='MATERIAL_REQUESTED').length,'fa-boxes-packing','orange')}
      ${mkpi('Đã cấp NVL',plans.filter(p=>p.status==='MATERIAL_ISSUED').length,'fa-truck-ramp-box','indigo')}
      ${mkpi('Đã tạo LSX',plans.filter(p=>p.status==='RELEASED').length,'fa-industry','blue')}
    </div><div class="card">${tableShell([{t:'Kế hoạch'},{t:'Ngày'},{t:'Thành phẩm / SL'},{t:'Trạng thái'},{t:'Người lập'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch được duyệt',emptyDesc:'Kế hoạch được lập và duyệt tại phân hệ Kho.'})}</div>`;
};

Views.productionMaterialRequests = function () {
  const rows=(DB.productionMaterialRequests||[]).map(r=>`<tr><td><span class="code">${esc(r.id)}</span><div class="cell-sub">${esc(r.productionOrderId ? `LSX ${r.productionOrderId}` : `KH ${r.planId||'—'}`)}</div></td><td>${fmtDate(r.date)}</td>
    <td>${(r.items||[]).map(i=>`${esc(Q.material(i.materialId)?.name||i.materialId)} · <b>${fmtDec(i.qty,2)} ${esc(Q.material(i.materialId)?.unit||'')}</b>`).join('<br>')}</td>
    <td>${pfRequestStatus(r.status)}</td><td>${esc(Q.employeeName(r.createdBy)||r.createdBy||'—')}</td>
    <td class="right">${rowActions([{act:'pf-mr-view',data:`data-id="${esc(r.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},...(r.status==='WAITING_WAREHOUSE_APPROVAL'?[{act:'pf-mr-edit',data:`data-id="${esc(r.id)}"`,icon:'fa-pen',title:'Sửa phiếu'},{act:'pf-mr-delete',data:`data-id="${esc(r.id)}"`,icon:'fa-trash',title:'Xóa phiếu'}]:[])])}</td></tr>`);
  return `${pageHead('Yêu cầu NVL sản xuất','Theo dõi phiếu yêu cầu nguyên liệu đã gửi Kho')}
    <div class="card">${tableShell([{t:'Phiếu'},{t:'Ngày'},{t:'Nguyên liệu / SL'},{t:'Trạng thái'},{t:'Người lập'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có phiếu yêu cầu NVL'})}</div>`;
};

const _productionViewBeforeFlow = Views.production;
Views.production = function () {
  const tab=State.tab || (State.params&&State.params.tab);
  if(tab==='bom') {
    // InventoryAPI.bootstrap() nạp snapshot master trong cache đồng bộ trước await,
    // vì vậy BOM render ngay master mới nhất đã có thay vì hiện data.js cũ vài ms.
    try { InventoryAPI?.bootstrap?.(); } catch (_) {}
    return Views.productionBom();
  }
  if(tab==='plan') return Views.productionPlanFlow();
  if(tab==='issue_nvl') return Views.productionPlanFlow(); // route cũ: YCNVL đã gộp vào Kế hoạch sản xuất
  return _productionViewBeforeFlow ? _productionViewBeforeFlow(State.params) : '';
};
