/* ============================================================================
 * PHÂN HỆ R&D (NGHIÊN CỨU & PHÁT TRIỂN) — Lê Nam ERP
 * ----------------------------------------------------------------------------
 * File này tự khởi tạo dữ liệu DB.rnd* (nếu chưa có) và đăng ký Views.rnd.
 * Nạp SAU js/core/app.core.js & js/core/charts.js, TRƯỚC js/app.js
 * (đặt cùng nhóm với các file js/modules/mod-*.js khác).
 *
 * Chức năng:
 *   - Dự án nghiên cứu (rndProjects) đi qua 5 giai đoạn (stage-gate)
 *   - Công thức thử nghiệm (rndFormulas) + Phiên bản công thức (rndFormulaVersions)
 *   - Thử nghiệm (rndTrials) ghi nhận kết quả từng mẻ
 *   - Chi phí nghiên cứu (rndCosts)
 *   - Quy trình duyệt sản phẩm mới theo stage-gate (rndApprovals)
 *   - Báo cáo: giá thành SP mới, thời gian phát triển, hiệu quả dự án,
 *     so sánh phiên bản công thức
 * ==========================================================================*/

/* ---------------------------------------------------------------- 1. DATA */
const RND_STAGES = ['CONCEPT', 'FORMULA', 'TRIAL', 'PILOT', 'LAUNCH'];
const RND_STAGE_LABEL = {
  CONCEPT: 'Ý tưởng', FORMULA: 'Xây dựng công thức', TRIAL: 'Thử nghiệm',
  PILOT: 'Sản xuất thử (Pilot)', LAUNCH: 'Tung sản phẩm',
};
const RND_PROJECT_STATUS = {
  ACTIVE:   { label: 'Đang triển khai', tone: 'blue' },
  ON_HOLD:  { label: 'Tạm dừng',        tone: 'orange' },
  LAUNCHED: { label: 'Đã tung sản phẩm',tone: 'green' },
  REJECTED: { label: 'Dừng dự án',      tone: 'red' },
};
const RND_CATEGORIES = ['Sản phẩm mới', 'Cải tiến sản phẩm', 'Nghiên cứu nguyên liệu', 'Cải tiến quy trình'];
const RND_VERSION_STATUS = {
  DRAFT:    { label: 'Nháp',        tone: 'slate' },
  TESTING:  { label: 'Đang thử',    tone: 'orange' },
  APPROVED: { label: 'Đã duyệt',    tone: 'green' },
  REJECTED: { label: 'Không đạt',   tone: 'red' },
};
const RND_TRIAL_RESULT = {
  PASS:    { label: 'Đạt',        tone: 'green' },
  PARTIAL: { label: 'Đạt một phần', tone: 'orange' },
  FAIL:    { label: 'Không đạt',  tone: 'red' },
};
const RND_COST_CATEGORIES = ['Nguyên liệu thử nghiệm', 'Nhân công R&D', 'Kiểm nghiệm bên ngoài', 'Bao bì mẫu', 'Khác'];
const RND_APPROVAL_STATUS = {
  PENDING:  { label: 'Chờ duyệt', tone: 'orange' },
  APPROVED: { label: 'Đã duyệt',  tone: 'green' },
  REJECTED: { label: 'Từ chối',   tone: 'red' },
};

DB.rndProjects = DB.rndProjects || [
  { id: 'RND-2026-001', name: 'Đậu hủ hữu cơ cao cấp', category: 'Sản phẩm mới', ownerId: 'NV-002',
    stage: 'TRIAL', status: 'ACTIVE', startDate: '2026-06-01', targetLaunchDate: '2026-10-01', actualLaunchDate: '',
    budget: 80000000, note: 'Dùng đậu nành hữu cơ đạt chuẩn, hướng tới phân khúc siêu thị cao cấp.' },
  { id: 'RND-2026-002', name: 'Sữa đậu nành ít đường', category: 'Cải tiến sản phẩm', ownerId: 'NV-003',
    stage: 'PILOT', status: 'ACTIVE', startDate: '2026-05-10', targetLaunchDate: '2026-09-01', actualLaunchDate: '',
    budget: 40000000, note: 'Giảm 40% đường so với công thức hiện tại, giữ vị ngọt tự nhiên.' },
  { id: 'RND-2026-003', name: 'Đậu hủ non vị rong biển', category: 'Sản phẩm mới', ownerId: 'NV-004',
    stage: 'LAUNCH', status: 'LAUNCHED', startDate: '2026-01-15', targetLaunchDate: '2026-05-01', actualLaunchDate: '2026-04-20',
    budget: 60000000, note: 'Đã chuyển giao cho sản xuất đại trà, mã thành phẩm dự kiến SP-011.' },
  { id: 'RND-2026-004', name: 'Đậu hủ chiên sả ớt', category: 'Sản phẩm mới', ownerId: 'NV-002',
    stage: 'TRIAL', status: 'REJECTED', startDate: '2026-02-01', targetLaunchDate: '2026-06-01', actualLaunchDate: '',
    budget: 30000000, note: 'Chi phí nguyên liệu vượt ngân sách và điểm cảm quan không đạt — dừng dự án.' },
];

DB.rndFormulas = DB.rndFormulas || [
  { id: 'CT-001', projectId: 'RND-2026-001', name: 'Đậu hủ hữu cơ cao cấp — CT gốc', baseProductId: 'SP-001', currentVersion: 'v2', status: 'TESTING' },
  { id: 'CT-002', projectId: 'RND-2026-002', name: 'Sữa đậu nành ít đường', baseProductId: 'SP-007', currentVersion: 'v2', status: 'TESTING' },
  { id: 'CT-003', projectId: 'RND-2026-003', name: 'Đậu hủ non vị rong biển', baseProductId: 'SP-001', currentVersion: 'v3', status: 'APPROVED' },
  { id: 'CT-004', projectId: 'RND-2026-004', name: 'Đậu hủ chiên sả ớt', baseProductId: 'SP-003', currentVersion: 'v1', status: 'REJECTED' },
];

DB.rndFormulaVersions = DB.rndFormulaVersions || [
  { id: 'CT-001-v1', formulaId: 'CT-001', version: 'v1', date: '2026-06-10', author: 'NV-007', yieldQty: 100, yieldUnit: 'Hộp',
    ingredients: [{ materialId: 'VT-001', qty: 20 }, { materialId: 'VT-002', qty: 0.4 }, { materialId: 'VT-008', qty: 100 }],
    operations: [{ operationId: 'CD-01', hoursPer: 0.02 }, { operationId: 'CD-04', hoursPer: 0.02 }, { operationId: 'CD-06', hoursPer: 0.02 }],
    sensoryScore: 7.2, status: 'REJECTED', note: 'Vị nhạt, kết cấu chưa mịn — cần tăng tỉ lệ đông tụ.' },
  { id: 'CT-001-v2', formulaId: 'CT-001', version: 'v2', date: '2026-07-05', author: 'NV-007', yieldQty: 100, yieldUnit: 'Hộp',
    ingredients: [{ materialId: 'VT-001', qty: 22 }, { materialId: 'VT-002', qty: 0.5 }, { materialId: 'VT-008', qty: 100 }],
    operations: [{ operationId: 'CD-01', hoursPer: 0.02 }, { operationId: 'CD-04', hoursPer: 0.025 }, { operationId: 'CD-06', hoursPer: 0.02 }],
    sensoryScore: 8.4, status: 'TESTING', note: 'Cải thiện rõ rệt, đang chờ thử nghiệm mẻ lớn.' },

  { id: 'CT-002-v1', formulaId: 'CT-002', version: 'v1', date: '2026-05-20', author: 'NV-012', yieldQty: 200, yieldUnit: 'Chai',
    ingredients: [{ materialId: 'VT-001', qty: 20 }, { materialId: 'VT-005', qty: 3 }, { materialId: 'VT-011', qty: 200 }],
    operations: [{ operationId: 'CD-01', hoursPer: 0.015 }, { operationId: 'CD-04', hoursPer: 0.015 }],
    sensoryScore: 6.8, status: 'REJECTED', note: 'Giảm đường quá tay, khách thử không thích vị nhạt.' },
  { id: 'CT-002-v2', formulaId: 'CT-002', version: 'v2', date: '2026-06-18', author: 'NV-012', yieldQty: 200, yieldUnit: 'Chai',
    ingredients: [{ materialId: 'VT-001', qty: 20 }, { materialId: 'VT-005', qty: 4.5 }, { materialId: 'VT-011', qty: 200 }],
    operations: [{ operationId: 'CD-01', hoursPer: 0.015 }, { operationId: 'CD-04', hoursPer: 0.015 }],
    sensoryScore: 8.1, status: 'TESTING', note: 'Giảm 40% đường so với công thức chuẩn, cảm quan tốt.' },

  { id: 'CT-003-v1', formulaId: 'CT-003', version: 'v1', date: '2026-01-25', author: 'NV-007', yieldQty: 100, yieldUnit: 'Hộp',
    ingredients: [{ materialId: 'VT-001', qty: 15 }, { materialId: 'VT-007', qty: 0.1 }, { materialId: 'VT-008', qty: 100 }],
    operations: [{ operationId: 'CD-01', hoursPer: 0.01 }, { operationId: 'CD-04', hoursPer: 0.01 }],
    sensoryScore: 7.0, status: 'REJECTED', note: 'Vị rong biển chưa rõ.' },
  { id: 'CT-003-v2', formulaId: 'CT-003', version: 'v2', date: '2026-02-20', author: 'NV-007', yieldQty: 100, yieldUnit: 'Hộp',
    ingredients: [{ materialId: 'VT-001', qty: 15 }, { materialId: 'VT-007', qty: 0.15 }, { materialId: 'VT-008', qty: 100 }],
    operations: [{ operationId: 'CD-01', hoursPer: 0.01 }, { operationId: 'CD-04', hoursPer: 0.012 }],
    sensoryScore: 8.0, status: 'REJECTED', note: 'Khá hơn nhưng màu chưa đẹp.' },
  { id: 'CT-003-v3', formulaId: 'CT-003', version: 'v3', date: '2026-03-18', author: 'NV-007', yieldQty: 100, yieldUnit: 'Hộp',
    ingredients: [{ materialId: 'VT-001', qty: 15 }, { materialId: 'VT-007', qty: 0.18 }, { materialId: 'VT-008', qty: 100 }],
    operations: [{ operationId: 'CD-01', hoursPer: 0.01 }, { operationId: 'CD-04', hoursPer: 0.012 }, { operationId: 'CD-10', hoursPer: 0.005 }],
    sensoryScore: 8.9, status: 'APPROVED', note: 'Đạt yêu cầu cảm quan & ATTP, chuyển giao sản xuất.' },

  { id: 'CT-004-v1', formulaId: 'CT-004', version: 'v1', date: '2026-02-15', author: 'NV-009', yieldQty: 150, yieldUnit: 'Gói',
    ingredients: [{ materialId: 'VT-001', qty: 18 }, { materialId: 'VT-004', qty: 3 }, { materialId: 'VT-006', qty: 2 }, { materialId: 'VT-009', qty: 150 }],
    operations: [{ operationId: 'CD-01', hoursPer: 0.012 }, { operationId: 'CD-08', hoursPer: 0.015 }],
    sensoryScore: 5.5, status: 'REJECTED', note: 'Giá thành cao hơn dự kiến 30%, cảm quan chưa đạt.' },
];

DB.rndTrials = DB.rndTrials || [
  { id: 'TN-2026-001', projectId: 'RND-2026-001', formulaVersionId: 'CT-001-v1', date: '2026-06-12', batchQty: 50, batchUnit: 'Hộp', result: 'FAIL', sensoryScore: 7.2, costActual: 1250000, testerId: 'NV-015', note: 'Kết cấu chưa mịn.' },
  { id: 'TN-2026-002', projectId: 'RND-2026-001', formulaVersionId: 'CT-001-v2', date: '2026-07-08', batchQty: 80, batchUnit: 'Hộp', result: 'PARTIAL', sensoryScore: 8.4, costActual: 2100000, testerId: 'NV-015', note: 'Đạt cảm quan, cần thử mẻ lớn hơn để xác nhận ổn định.' },
  { id: 'TN-2026-003', projectId: 'RND-2026-002', formulaVersionId: 'CT-002-v1', date: '2026-05-25', batchQty: 100, batchUnit: 'Chai', result: 'FAIL', sensoryScore: 6.8, costActual: 1800000, testerId: 'NV-016', note: 'Vị nhạt, khách không thích.' },
  { id: 'TN-2026-004', projectId: 'RND-2026-002', formulaVersionId: 'CT-002-v2', date: '2026-06-22', batchQty: 150, batchUnit: 'Chai', result: 'PASS', sensoryScore: 8.1, costActual: 2600000, testerId: 'NV-016', note: 'Đạt yêu cầu, chuyển sang sản xuất thử.' },
  { id: 'TN-2026-005', projectId: 'RND-2026-003', formulaVersionId: 'CT-003-v3', date: '2026-03-22', batchQty: 200, batchUnit: 'Hộp', result: 'PASS', sensoryScore: 8.9, costActual: 3200000, testerId: 'NV-015', note: 'Đạt ATTP, sẵn sàng pilot.' },
  { id: 'TN-2026-006', projectId: 'RND-2026-004', formulaVersionId: 'CT-004-v1', date: '2026-02-20', batchQty: 60, batchUnit: 'Gói', result: 'FAIL', sensoryScore: 5.5, costActual: 1500000, testerId: 'NV-015', note: 'Không đạt, dừng thử nghiệm tiếp.' },
];

DB.rndCosts = DB.rndCosts || [
  { id: 'CPNC-2026-001', projectId: 'RND-2026-001', date: '2026-06-05', category: 'Nguyên liệu thử nghiệm', amount: 3500000, note: 'Đậu nành hữu cơ nhập mẫu', recordedBy: 'NV-018' },
  { id: 'CPNC-2026-002', projectId: 'RND-2026-001', date: '2026-06-12', category: 'Nhân công R&D', amount: 1800000, note: 'Giờ công tổ thử nghiệm', recordedBy: 'NV-005' },
  { id: 'CPNC-2026-003', projectId: 'RND-2026-001', date: '2026-07-10', category: 'Kiểm nghiệm bên ngoài', amount: 4200000, note: 'Kiểm nghiệm ATTP mẫu v2', recordedBy: 'NV-015' },
  { id: 'CPNC-2026-004', projectId: 'RND-2026-002', date: '2026-05-22', category: 'Nguyên liệu thử nghiệm', amount: 2100000, note: 'Đường & phụ gia thử nghiệm', recordedBy: 'NV-018' },
  { id: 'CPNC-2026-005', projectId: 'RND-2026-002', date: '2026-06-20', category: 'Bao bì mẫu', amount: 1200000, note: 'Chai PET mẫu in nhãn thử', recordedBy: 'NV-018' },
  { id: 'CPNC-2026-006', projectId: 'RND-2026-003', date: '2026-02-01', category: 'Nguyên liệu thử nghiệm', amount: 5200000, note: 'Rong biển nhập mẫu 3 đợt', recordedBy: 'NV-018' },
  { id: 'CPNC-2026-007', projectId: 'RND-2026-003', date: '2026-03-25', category: 'Kiểm nghiệm bên ngoài', amount: 6000000, note: 'Kiểm nghiệm công bố sản phẩm mới', recordedBy: 'NV-015' },
  { id: 'CPNC-2026-008', projectId: 'RND-2026-004', date: '2026-02-10', category: 'Nguyên liệu thử nghiệm', amount: 2800000, note: 'Sả, ớt, dầu chiên thử nghiệm', recordedBy: 'NV-018' },
  { id: 'CPNC-2026-009', projectId: 'RND-2026-004', date: '2026-02-22', category: 'Nhân công R&D', amount: 1400000, note: 'Giờ công thử nghiệm chiên', recordedBy: 'NV-005' },
];

DB.rndApprovals = DB.rndApprovals || [
  { id: 'DUYET-2026-001', projectId: 'RND-2026-003', stage: 'CONCEPT', status: 'APPROVED', approverId: 'NV-001', date: '2026-01-18', note: 'Duyệt ý tưởng.' },
  { id: 'DUYET-2026-002', projectId: 'RND-2026-003', stage: 'FORMULA', status: 'APPROVED', approverId: 'NV-001', date: '2026-02-25', note: 'Duyệt công thức v2, yêu cầu cải thiện màu.' },
  { id: 'DUYET-2026-003', projectId: 'RND-2026-003', stage: 'TRIAL', status: 'APPROVED', approverId: 'NV-001', date: '2026-03-24', note: 'Kết quả thử nghiệm v3 đạt yêu cầu.' },
  { id: 'DUYET-2026-004', projectId: 'RND-2026-003', stage: 'PILOT', status: 'APPROVED', approverId: 'NV-001', date: '2026-04-18', note: 'Sản xuất thử đạt, cho phép tung sản phẩm.' },
  { id: 'DUYET-2026-005', projectId: 'RND-2026-001', stage: 'CONCEPT', status: 'APPROVED', approverId: 'NV-001', date: '2026-06-03', note: '' },
  { id: 'DUYET-2026-006', projectId: 'RND-2026-001', stage: 'FORMULA', status: 'APPROVED', approverId: 'NV-001', date: '2026-07-06', note: 'Duyệt công thức v2 để thử nghiệm mẻ lớn.' },
  { id: 'DUYET-2026-007', projectId: 'RND-2026-002', stage: 'CONCEPT', status: 'APPROVED', approverId: 'NV-001', date: '2026-05-12', note: '' },
  { id: 'DUYET-2026-008', projectId: 'RND-2026-002', stage: 'FORMULA', status: 'APPROVED', approverId: 'NV-001', date: '2026-06-24', note: '' },
  { id: 'DUYET-2026-009', projectId: 'RND-2026-002', stage: 'TRIAL', status: 'APPROVED', approverId: 'NV-001', date: '2026-07-01', note: 'Cho phép chuyển sang sản xuất thử pilot.' },
  { id: 'DUYET-2026-010', projectId: 'RND-2026-004', stage: 'TRIAL', status: 'REJECTED', approverId: 'NV-001', date: '2026-02-24', note: 'Không đạt cảm quan & giá thành, dừng dự án.' },
];

/* ------------------------------------------------------------ 2. HELPERS */
function rndProject(id) { return DB.rndProjects.find((p) => p.id === id); }
function rndFormula(id) { return DB.rndFormulas.find((f) => f.id === id); }
function rndFormulaVersion(id) { return DB.rndFormulaVersions.find((v) => v.id === id); }
function rndFormulasOfProject(pid) { return DB.rndFormulas.filter((f) => f.projectId === pid); }
function rndVersionsOfFormula(fid) { return DB.rndFormulaVersions.filter((v) => v.formulaId === fid).sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })); }
function rndTrialsOfProject(pid) { return DB.rndTrials.filter((t) => t.projectId === pid).sort((a, b) => b.date.localeCompare(a.date)); }
function rndCostsOfProject(pid) { return DB.rndCosts.filter((c) => c.projectId === pid).sort((a, b) => b.date.localeCompare(a.date)); }
function rndApprovalsOfProject(pid) { return DB.rndApprovals.filter((a) => a.projectId === pid).sort((a, b) => a.date.localeCompare(b.date)); }
function rndProjectCostTotal(pid) { return rndCostsOfProject(pid).reduce((s, c) => s + Number(c.amount || 0), 0); }
function rndProjectDevDays(p) {
  const end = p.actualLaunchDate || currentDateYMD();
  return Math.max(0, Math.round((new Date(end + 'T00:00:00') - new Date(p.startDate + 'T00:00:00')) / 86400000));
}
function rndStageIndex(stage) { return RND_STAGES.indexOf(stage); }
function rndNextStage(stage) { const i = rndStageIndex(stage); return i >= 0 && i < RND_STAGES.length - 1 ? RND_STAGES[i + 1] : null; }
function rndPendingApproval(pid, stage) { return DB.rndApprovals.find((a) => a.projectId === pid && a.stage === stage && a.status === 'PENDING'); }

/** Giá thành ước tính / 1 đơn vị thành phẩm của 1 phiên bản công thức, dựa trên
 *  đơn giá vật tư hiện hành (Q.material) và đơn giá giờ công đoạn (Q.operation). */
function rndVersionUnitCost(v) {
  const matCost = (v.ingredients || []).reduce((s, i) => s + Number(Q.material(i.materialId)?.price || 0) * Number(i.qty || 0), 0);
  const opCost = (v.operations || []).reduce((s, o) => s + Number(Q.operation(o.operationId)?.rate || 0) * Number(o.hoursPer || 0), 0);
  const yieldQty = Number(v.yieldQty || 0) || 1;
  return Math.round((matCost + opCost) / yieldQty);
}
function rndVersionBatchCost(v) {
  const matCost = (v.ingredients || []).reduce((s, i) => s + Number(Q.material(i.materialId)?.price || 0) * Number(i.qty || 0), 0);
  const opCost = (v.operations || []).reduce((s, o) => s + Number(Q.operation(o.operationId)?.rate || 0) * Number(o.hoursPer || 0), 0);
  return Math.round(matCost + opCost);
}
function rndBadge(map, key) {
  const s = map[key];
  return s ? `<span class="badge ${s.tone}">${esc(s.label)}</span>` : `<span class="badge slate">${esc(key || '—')}</span>`;
}
function rndEmployeeOptions(selected) {
  return DB.employees.map((e) => `<option value="${esc(e.id)}" ${e.id === selected ? 'selected' : ''}>${esc(e.name)} — ${esc(e.dept)}</option>`).join('');
}
function rndProjectOptions(selected) {
  return DB.rndProjects.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.id)} — ${esc(p.name)}</option>`).join('');
}

/* -------------------------------------------------------------- 3. TABS */
function rndTabsHTML(active) {
  const tabs = [
    ['dashboard', 'Tổng quan R&D'], ['projects', 'Dự án nghiên cứu'], ['formula', 'Công thức'],
    ['versions', 'Phiên bản công thức'], ['trials', 'Thử nghiệm'], ['costs', 'Chi phí nghiên cứu'],
    ['approvals', 'Quy trình duyệt'], ['reports', 'Báo cáo R&D'],
  ];
  return `<div class="tabs module-tabs" style="margin-bottom:16px">${tabs.map(([id, label]) =>
    `<button class="tab ${active === id ? 'active' : ''}" data-act="nav" data-id="rnd" data-tab="${id}">${esc(label)}</button>`).join('')}</div>`;
}

/* =========================================================== 4. VIEWS === */
Views.rnd = function () {
  const tab = State.tab || 'dashboard';
  const renderers = {
    dashboard: rndDashboardView, projects: rndProjectsView, formula: rndFormulaViewTab,
    versions: rndVersionsViewTab, trials: rndTrialsViewTab, costs: rndCostsViewTab,
    npd: rndNpdViewTab, approvals: rndNpdViewTab, reports: rndReportsViewTab,
  };
  const fn = renderers[tab] || rndDashboardView;
  return rndTabsHTML(tab) + fn();
};

/* ---- 4.1 Dashboard ---- */
function rndDashboardView() {
  const projects = DB.rndProjects;
  const active = projects.filter((p) => p.status === 'ACTIVE').length;
  const launched = projects.filter((p) => p.status === 'LAUNCHED');
  const rejected = projects.filter((p) => p.status === 'REJECTED');
  const totalCost = DB.rndCosts.reduce((s, c) => s + Number(c.amount || 0), 0);
  const avgDevDays = launched.length ? Math.round(launched.reduce((s, p) => s + rndProjectDevDays(p), 0) / launched.length) : 0;
  const successRate = (launched.length + rejected.length) ? Math.round((launched.length / (launched.length + rejected.length)) * 100) : 0;

  const kpis = [
    mkpi('Dự án đang triển khai', active, 'fa-flask', 'blue', 'nav', ''),
    mkpi('Tổng chi phí R&D', fmtVND(totalCost), 'fa-sack-dollar', 'orange'),
    mkpi('Sản phẩm đã tung ra', launched.length, 'fa-rocket', 'green'),
    mkpi('Thời gian phát triển TB', avgDevDays + ' ngày', 'fa-hourglass-half', 'indigo'),
    mkpi('Tỷ lệ thành công dự án', successRate + '%', 'fa-chart-line', successRate >= 50 ? 'green' : 'red'),
  ].join('');

  const rows = projects.map((p) => `<tr class="clickable" data-act="rnd-project-view" data-id="${p.id}">
      <td><span class="code">${p.id}</span></td>
      <td>${cell2(esc(p.name), esc(RND_CATEGORIES.includes(p.category) ? p.category : p.category))}</td>
      <td>${esc(Q.employeeName(p.ownerId))}</td>
      <td>${esc(RND_STAGE_LABEL[p.stage] || p.stage)}</td>
      <td>${rndBadge(RND_PROJECT_STATUS, p.status)}</td>
      <td class="right num">${fmtVND(rndProjectCostTotal(p.id))}</td>
      <td class="right num">${rndProjectDevDays(p)} ngày</td>
    </tr>`);

  return `
    ${pageHead('Tổng quan R&D', 'Theo dõi các dự án nghiên cứu & phát triển sản phẩm mới', '<button class="btn btn-primary btn-sm" data-act="rnd-project-new"><i class="fa-solid fa-plus"></i>Dự án R&D mới</button>')}
    <div class="grid g-auto" style="margin-bottom:16px">${kpis}</div>
    <div class="card">
      <div class="card-head"><div><h3>Danh sách dự án</h3><p>Tổng quan giai đoạn, chi phí và thời gian phát triển</p></div></div>
      ${tableShell([{ t: 'Mã dự án' }, { t: 'Tên dự án' }, { t: 'Phụ trách' }, { t: 'Giai đoạn' }, { t: 'Trạng thái' }, { t: 'Chi phí' }, { t: 'Thời gian' }], rows, { emptyTitle: 'Chưa có dự án R&D' })}
    </div>`;
}

/* ---- 4.2 Dự án nghiên cứu ---- */
function rndProjectsView() {
  const f = F('rndProjects', { q: '', status: '', category: '' });
  let list = DB.rndProjects.slice();
  if (f.q) { const t = f.q.toLowerCase(); list = list.filter((p) => (p.id + p.name).toLowerCase().includes(t)); }
  if (f.status) list = list.filter((p) => p.status === f.status);
  if (f.category) list = list.filter((p) => p.category === f.category);
  list.sort((a, b) => b.startDate.localeCompare(a.startDate));

  const pg = paged(list, 'rndProjects', 10);
  const rows = pg.items.map((p) => `<tr class="clickable" data-act="rnd-project-view" data-id="${p.id}">
      <td><span class="code">${p.id}</span></td>
      <td>${cell2(esc(p.name), esc(p.category))}</td>
      <td>${esc(Q.employeeName(p.ownerId))}</td>
      <td>${esc(RND_STAGE_LABEL[p.stage] || p.stage)}</td>
      <td>${rndBadge(RND_PROJECT_STATUS, p.status)}</td>
      <td class="right num">${fmtVND(p.budget)}</td>
      <td class="right num">${fmtVND(rndProjectCostTotal(p.id))}</td>
      <td class="right num">${rndProjectDevDays(p)} ngày</td>
      <td>${rowActions([
        { act: 'rnd-project-view', data: `data-id="${p.id}"`, icon: 'fa-eye', title: 'Xem chi tiết' },
        { act: 'rnd-project-edit', data: `data-id="${p.id}"`, icon: 'fa-pen', title: 'Sửa' },
        { act: 'rnd-project-delete', data: `data-id="${p.id}"`, icon: 'fa-trash', title: 'Xóa' },
      ])}</td>
    </tr>`);

  return `
    ${pageHead('Dự án nghiên cứu', 'Danh sách dự án R&D và tiến độ theo giai đoạn', '<button class="btn btn-primary btn-sm" data-act="rnd-project-new"><i class="fa-solid fa-plus"></i>Dự án mới</button>')}
    <div class="card">
      <div class="toolbar">
        ${searchBox('rndProjects', 'Tìm theo mã hoặc tên dự án…')}
        ${selectFilter('rndProjects', 'status', Object.entries(RND_PROJECT_STATUS).map(([k, v]) => [k, v.label]), 'Tất cả trạng thái')}
        ${selectFilter('rndProjects', 'category', RND_CATEGORIES.map((c) => [c, c]), 'Tất cả danh mục')}
      </div>
      ${tableShell([{ t: 'Mã dự án' }, { t: 'Tên dự án' }, { t: 'Phụ trách' }, { t: 'Giai đoạn' }, { t: 'Trạng thái' }, { t: 'Ngân sách' }, { t: 'Chi phí thực tế' }, { t: 'Thời gian' }, { t: '', w: '110px' }], rows)}
      ${pagiHTML('rndProjects', pg, 'dự án')}
    </div>`;
}

/* ---- 4.3 Công thức ---- */
function rndFormulaViewTab() {
  const f = F('rndFormula', { q: '' });
  let list = DB.rndFormulas.slice();
  if (f.q) { const t = f.q.toLowerCase(); list = list.filter((x) => (x.id + x.name).toLowerCase().includes(t)); }

  const rows = list.map((fm) => {
    const versions = rndVersionsOfFormula(fm.id);
    const cur = versions.find((v) => v.version === fm.currentVersion) || versions[versions.length - 1];
    return `<tr>
      <td><span class="code">${fm.id}</span></td>
      <td>${cell2(esc(fm.name), 'Dự án: ' + esc(rndProject(fm.projectId)?.name || fm.projectId))}</td>
      <td>${esc(fm.currentVersion)}</td>
      <td>${rndBadge(RND_VERSION_STATUS, cur?.status)}</td>
      <td class="right num">${cur ? fmtVND(rndVersionUnitCost(cur)) : '—'}</td>
      <td class="right num">${cur ? fmtDec(cur.sensoryScore, 1) + '/10' : '—'}</td>
      <td>${rowActions([
        { act: 'rnd-formula-versions', data: `data-id="${fm.id}"`, icon: 'fa-code-compare', title: 'Xem & so sánh phiên bản' },
        { act: 'rnd-version-new', data: `data-formulaid="${fm.id}"`, icon: 'fa-plus', title: 'Thêm phiên bản mới' },
      ])}</td>
    </tr>`;
  });

  return `
    ${pageHead('Công thức thử nghiệm', 'Mỗi công thức có thể có nhiều phiên bản trong quá trình nghiên cứu', '<button class="btn btn-primary btn-sm" data-act="rnd-formula-new"><i class="fa-solid fa-plus"></i>Công thức mới</button>')}
    <div class="card">
      <div class="toolbar">${searchBox('rndFormula', 'Tìm theo mã hoặc tên công thức…')}</div>
      ${tableShell([{ t: 'Mã CT' }, { t: 'Tên công thức' }, { t: 'Phiên bản hiện tại' }, { t: 'Trạng thái' }, { t: 'Giá thành/đv' }, { t: 'Điểm cảm quan' }, { t: '', w: '110px' }], rows, { emptyTitle: 'Chưa có công thức nào' })}
    </div>`;
}

/* ---- 4.4 Phiên bản công thức (danh sách phẳng toàn hệ thống) ---- */
function rndVersionsViewTab() {
  const f = F('rndVersions', { formulaId: '', status: '' });
  let list = DB.rndFormulaVersions.slice();
  if (f.formulaId) list = list.filter((v) => v.formulaId === f.formulaId);
  if (f.status) list = list.filter((v) => v.status === f.status);
  list.sort((a, b) => b.date.localeCompare(a.date));

  const rows = list.map((v) => `<tr>
      <td><span class="code">${v.id}</span></td>
      <td>${esc(rndFormula(v.formulaId)?.name || v.formulaId)}</td>
      <td>${fmtDate(v.date)}</td>
      <td>${esc(Q.employeeName(v.author))}</td>
      <td class="right num">${fmtN(v.yieldQty)} ${esc(v.yieldUnit)}</td>
      <td class="right num">${fmtVND(rndVersionUnitCost(v))}</td>
      <td class="right num">${fmtDec(v.sensoryScore, 1)}/10</td>
      <td>${rndBadge(RND_VERSION_STATUS, v.status)}</td>
      <td>${rowActions([
		{ act: 'rnd-version-edit', data: `data-id="${v.id}"`, icon: 'fa-pen', title: 'Sửa chi tiết'},
		{ act: 'rnd-formula-versions', data: `data-id="${v.formulaId}"`, icon: 'fa-code-compare', title: 'So sánh các phiên bản' }
	])}</td>
    </tr>`);

  return `
    ${pageHead('Phiên bản công thức', 'So sánh chi phí, sản lượng và điểm cảm quan giữa các phiên bản')}
    <div class="card">
      <div class="toolbar">
        ${selectFilter('rndVersions', 'formulaId', DB.rndFormulas.map((x) => [x.id, x.id + ' — ' + x.name]), 'Tất cả công thức')}
        ${selectFilter('rndVersions', 'status', Object.entries(RND_VERSION_STATUS).map(([k, v]) => [k, v.label]), 'Tất cả trạng thái')}
      </div>
      ${tableShell([{ t: 'Mã PB' }, { t: 'Công thức' }, { t: 'Ngày' }, { t: 'Người thực hiện' }, { t: 'Sản lượng mẻ' }, { t: 'Giá thành/đv' }, { t: 'Cảm quan' }, { t: 'Trạng thái' }, { t: '', w: '60px' }], rows, { emptyTitle: 'Chưa có phiên bản công thức' })}
    </div>`;
}

/* ---- 4.5 Thử nghiệm ---- */
function rndTrialsViewTab() {
  const f = F('rndTrials', { projectId: '', result: '' });
  let list = DB.rndTrials.slice();
  if (f.projectId) list = list.filter((t) => t.projectId === f.projectId);
  if (f.result) list = list.filter((t) => t.result === f.result);
  list.sort((a, b) => b.date.localeCompare(a.date));

  const rows = list.map((t) => {
    const v = rndFormulaVersion(t.formulaVersionId);
    return `<tr>
      <td><span class="code">${t.id}</span></td>
      <td>${cell2(esc(rndProject(t.projectId)?.name || t.projectId), 'Phiên bản ' + esc(v?.version || t.formulaVersionId))}</td>
      <td>${fmtDate(t.date)}</td>
      <td class="right num">${fmtN(t.batchQty)} ${esc(t.batchUnit)}</td>
      <td>${rndBadge(RND_TRIAL_RESULT, t.result)}</td>
      <td class="right num">${fmtDec(t.sensoryScore, 1)}/10</td>
      <td class="right num">${fmtVND(t.costActual)}</td>
      <td>${esc(Q.employeeName(t.testerId))}</td>
    </tr>`;
  });

  return `
    ${pageHead('Thử nghiệm sản phẩm', 'Ghi nhận kết quả thử nghiệm từng mẻ theo công thức', '<button class="btn btn-primary btn-sm" data-act="rnd-trial-new"><i class="fa-solid fa-plus"></i>Ghi nhận thử nghiệm</button>')}
    <div class="card">
      <div class="toolbar">
        ${selectFilter('rndTrials', 'projectId', DB.rndProjects.map((p) => [p.id, p.id + ' — ' + p.name]), 'Tất cả dự án')}
        ${selectFilter('rndTrials', 'result', Object.entries(RND_TRIAL_RESULT).map(([k, v]) => [k, v.label]), 'Tất cả kết quả')}
      </div>
      ${tableShell([{ t: 'Mã TN' }, { t: 'Dự án / Phiên bản' }, { t: 'Ngày' }, { t: 'Số lượng mẻ' }, { t: 'Kết quả' }, { t: 'Cảm quan' }, { t: 'Chi phí thực tế' }, { t: 'Người thử' }], rows, { emptyTitle: 'Chưa có thử nghiệm nào' })}
    </div>`;
}

/* ---- 4.6 Chi phí nghiên cứu ---- */
function rndCostsViewTab() {
  const f = F('rndCosts', { projectId: '', category: '' });
  let list = DB.rndCosts.slice();
  if (f.projectId) list = list.filter((c) => c.projectId === f.projectId);
  if (f.category) list = list.filter((c) => c.category === f.category);
  list.sort((a, b) => b.date.localeCompare(a.date));

  const total = list.reduce((s, c) => s + Number(c.amount || 0), 0);
  const byCat = RND_COST_CATEGORIES.map((cat) => ({ cat, amount: list.filter((c) => c.category === cat).reduce((s, c) => s + Number(c.amount || 0), 0) }));

  const rows = list.map((c) => `<tr>
      <td><span class="code">${c.id}</span></td>
      <td>${esc(rndProject(c.projectId)?.name || c.projectId)}</td>
      <td>${fmtDate(c.date)}</td>
      <td>${esc(c.category)}</td>
      <td class="right num">${fmtVND(c.amount)}</td>
      <td>${esc(c.note || '—')}</td>
      <td>${esc(Q.employeeName(c.recordedBy))}</td>
    </tr>`);

  return `
    ${pageHead('Chi phí nghiên cứu', 'Theo dõi chi phí phát sinh của từng dự án R&D', `<button class="btn btn-sm" data-act="rnd-export-costs"><i class="fa-solid fa-download"></i>Xuất Excel</button><button class="btn btn-primary btn-sm" data-act="rnd-cost-new"><i class="fa-solid fa-plus"></i>Ghi nhận chi phí</button>`)}
    <div class="grid g-auto" style="margin-bottom:16px">
      ${mkpi('Tổng chi phí (theo bộ lọc)', fmtVND(total), 'fa-sack-dollar', 'orange')}
      ${byCat.map((x) => mkpi(x.cat, fmtVND(x.amount), 'fa-tag', 'slate')).join('')}
    </div>
    <div class="card">
      <div class="toolbar">
        ${selectFilter('rndCosts', 'projectId', DB.rndProjects.map((p) => [p.id, p.id + ' — ' + p.name]), 'Tất cả dự án')}
        ${selectFilter('rndCosts', 'category', RND_COST_CATEGORIES.map((c) => [c, c]), 'Tất cả loại chi phí')}
      </div>
      ${tableShell([{ t: 'Mã CP' }, { t: 'Dự án' }, { t: 'Ngày' }, { t: 'Loại chi phí' }, { t: 'Số tiền' }, { t: 'Ghi chú' }, { t: 'Người ghi nhận' }], rows, { emptyTitle: 'Chưa có chi phí nào được ghi nhận' })}
    </div>`;
}

/* ---- 4.7 Phát triển sản phẩm mới (NPD) — quy trình duyệt theo giai đoạn ---- */
function rndNpdViewTab() {
  const cards = DB.rndProjects.map((p) => {
    const steps = RND_STAGES.map((st, i) => {
      const idx = rndStageIndex(p.stage);
      const cls = i < idx || (i === idx && p.status === 'LAUNCHED') ? 'done' : (i === idx ? 'doing' : 'pending');
      const appr = DB.rndApprovals.filter((a) => a.projectId === p.id && a.stage === st).sort((a, b) => b.date.localeCompare(a.date))[0];
      return `<div class="flow-step ${cls}">
          <div class="flow-ico"><i class="fa-solid ${cls === 'done' ? 'fa-check' : cls === 'doing' ? 'fa-flask' : 'fa-clock'}"></i></div>
          <div class="flow-name">${esc(RND_STAGE_LABEL[st])}</div>
          <div class="flow-date">${appr ? (appr.status === 'PENDING' ? 'Chờ duyệt' : fmtDate(appr.date)) : ''}</div>
        </div>`;
    }).join('');

    const pending = rndPendingApproval(p.id, p.stage);
    const nextStage = rndNextStage(p.stage);
    let actionHtml = '';
    if (p.status === 'REJECTED' || p.status === 'LAUNCHED') {
      actionHtml = `<span class="cell-sub">Dự án đã kết thúc quy trình duyệt.</span>`;
    } else if (pending) {
      actionHtml = `<button class="btn btn-sm btn-primary" data-act="rnd-approval-decide" data-id="${pending.id}" data-decision="APPROVED"><i class="fa-solid fa-check"></i>Duyệt qua "${esc(RND_STAGE_LABEL[nextStage] || 'Tung sản phẩm')}"</button>
        <button class="btn btn-sm btn-danger" data-act="rnd-approval-decide" data-id="${pending.id}" data-decision="REJECTED"><i class="fa-solid fa-xmark"></i>Từ chối / Dừng dự án</button>`;
    } else if (nextStage) {
      actionHtml = `<button class="btn btn-sm" data-act="rnd-approval-request" data-id="${p.id}"><i class="fa-solid fa-paper-plane"></i>Gửi yêu cầu duyệt qua "${esc(RND_STAGE_LABEL[nextStage])}"</button>`;
    } else {
      actionHtml = `<button class="btn btn-sm btn-primary" data-act="rnd-project-launch" data-id="${p.id}"><i class="fa-solid fa-rocket"></i>Xác nhận tung sản phẩm</button>`;
    }

    return `<div class="card" style="margin-bottom:14px">
        <div class="card-head"><div><h3>${esc(p.id)} — ${esc(p.name)}</h3><p>${esc(rndProject(p.id) ? Q.employeeName(p.ownerId) : '')} · ${rndBadge(RND_PROJECT_STATUS, p.status)}</p></div>
          <div class="right">${actionHtml}</div></div>
        <div class="card-body"><div class="flow">${steps}</div></div>
      </div>`;
  }).join('');

  const logRows = DB.rndApprovals.slice().sort((a, b) => b.date.localeCompare(a.date)).map((a) => `<tr>
      <td><span class="code">${a.id}</span></td>
      <td>${esc(rndProject(a.projectId)?.name || a.projectId)}</td>
      <td>${esc(RND_STAGE_LABEL[a.stage] || a.stage)}</td>
      <td>${rndBadge(RND_APPROVAL_STATUS, a.status)}</td>
      <td>${fmtDate(a.date)}</td>
      <td>${esc(Q.employeeName(a.approverId))}</td>
      <td>${esc(a.note || '—')}</td>
    </tr>`);

  return `
    ${pageHead('Phát triển sản phẩm mới (NPD)', 'Quy trình stage-gate: Ý tưởng → Công thức → Thử nghiệm → Sản xuất thử → Tung sản phẩm')}
    ${cards}
    <div class="card">
      <div class="card-head"><div><h3>Nhật ký phê duyệt</h3><p>Lịch sử duyệt qua từng giai đoạn của tất cả dự án</p></div></div>
      ${tableShell([{ t: 'Mã duyệt' }, { t: 'Dự án' }, { t: 'Giai đoạn' }, { t: 'Trạng thái' }, { t: 'Ngày' }, { t: 'Người duyệt' }, { t: 'Ghi chú' }], logRows, { emptyTitle: 'Chưa có lượt duyệt nào' })}
    </div>`;
}

/* ---- 4.8 Báo cáo R&D ---- */
function rndReportsViewTab() {
  const projects = DB.rndProjects;
  const launched = projects.filter((p) => p.status === 'LAUNCHED');
  const rejected = projects.filter((p) => p.status === 'REJECTED');
  const totalCost = DB.rndCosts.reduce((s, c) => s + Number(c.amount || 0), 0);
  const avgCostLaunched = launched.length ? Math.round(launched.reduce((s, p) => s + rndProjectCostTotal(p.id), 0) / launched.length) : 0;
  const avgCostRejected = rejected.length ? Math.round(rejected.reduce((s, p) => s + rndProjectCostTotal(p.id), 0) / rejected.length) : 0;
  const avgDevDays = launched.length ? Math.round(launched.reduce((s, p) => s + rndProjectDevDays(p), 0) / launched.length) : 0;
  const successRate = (launched.length + rejected.length) ? Math.round((launched.length / (launched.length + rejected.length)) * 100) : 0;

  const projectRows = projects.map((p) => `<tr>
      <td><span class="code">${p.id}</span></td>
      <td>${esc(p.name)}</td>
      <td>${rndBadge(RND_PROJECT_STATUS, p.status)}</td>
      <td class="right num">${rndProjectDevDays(p)} ngày</td>
      <td class="right num">${fmtVND(p.budget)}</td>
      <td class="right num">${fmtVND(rndProjectCostTotal(p.id))}</td>
      <td class="right num" style="${rndProjectCostTotal(p.id) > p.budget ? 'color:var(--red);font-weight:700' : ''}">${p.budget ? Math.round((rndProjectCostTotal(p.id) / p.budget) * 100) : 0}%</td>
    </tr>`);

  const fid = F('rndCompareFormula', { id: DB.rndFormulas[0]?.id || '' }).id;
  const versions = rndVersionsOfFormula(fid);
  const compareRows = versions.map((v) => {
    const unitCost = rndVersionUnitCost(v);
    const best = versions.reduce((b, x) => (rndVersionUnitCost(x) < rndVersionUnitCost(b) ? x : b), versions[0]);
    const bestSensory = versions.reduce((b, x) => (Number(x.sensoryScore) > Number(b.sensoryScore) ? x : b), versions[0]);
    return `<tr>
      <td><span class="code">${v.version}</span></td>
      <td>${fmtDate(v.date)}</td>
      <td class="right num">${fmtN(v.yieldQty)} ${esc(v.yieldUnit)}</td>
      <td class="right num" style="${v.id === best.id ? 'color:var(--green);font-weight:700' : ''}">${fmtVND(unitCost)}${v.id === best.id ? ' <i class="fa-solid fa-star" title="Giá thành thấp nhất"></i>' : ''}</td>
      <td class="right num" style="${v.id === bestSensory.id ? 'color:var(--green);font-weight:700' : ''}">${fmtDec(v.sensoryScore, 1)}/10${v.id === bestSensory.id ? ' <i class="fa-solid fa-star" title="Điểm cảm quan cao nhất"></i>' : ''}</td>
      <td>${rndBadge(RND_VERSION_STATUS, v.status)}</td>
    </tr>`;
  });

  return `
    ${pageHead('Báo cáo R&D', 'Giá thành sản phẩm mới, thời gian phát triển, hiệu quả dự án và so sánh phiên bản công thức', '<button class="btn btn-sm" data-act="rnd-export-projects"><i class="fa-solid fa-download"></i>Xuất Excel</button>')}

    <div class="grid g-auto" style="margin-bottom:16px">
      ${mkpi('Tổng chi phí R&D', fmtVND(totalCost), 'fa-sack-dollar', 'orange')}
      ${mkpi('Chi phí TB / SP tung ra', fmtVND(avgCostLaunched), 'fa-box-open', 'green')}
      ${mkpi('Chi phí TB / dự án dừng', fmtVND(avgCostRejected), 'fa-ban', 'red')}
      ${mkpi('Thời gian phát triển TB', avgDevDays + ' ngày', 'fa-hourglass-half', 'indigo')}
      ${mkpi('Tỷ lệ thành công', successRate + '%', 'fa-chart-line', successRate >= 50 ? 'green' : 'red')}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h3>Giá thành & thời gian phát triển theo dự án</h3><p>So sánh ngân sách với chi phí thực tế đã ghi nhận</p></div></div>
      ${tableShell([{ t: 'Mã dự án' }, { t: 'Tên dự án' }, { t: 'Trạng thái' }, { t: 'Thời gian' }, { t: 'Ngân sách' }, { t: 'Chi phí thực tế' }, { t: '% Ngân sách' }], projectRows)}
    </div>

    <div class="card">
      <div class="card-head">
        <div><h3>So sánh phiên bản công thức</h3><p>Chọn công thức để so sánh giá thành, sản lượng và điểm cảm quan giữa các phiên bản</p></div>
        <div class="right">${selectFilter('rndCompareFormula', 'id', DB.rndFormulas.map((x) => [x.id, x.id + ' — ' + x.name]), '-- Chọn công thức --')}</div>
      </div>
      ${tableShell([{ t: 'Phiên bản' }, { t: 'Ngày' }, { t: 'Sản lượng mẻ' }, { t: 'Giá thành/đv' }, { t: 'Điểm cảm quan' }, { t: 'Trạng thái' }], compareRows, { emptyTitle: 'Công thức này chưa có phiên bản nào' })}
    </div>`;
}
