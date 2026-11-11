/* ============================================================================
 * MODULE: QUY TRÌNH PHÊ DUYỆT (APPROVALS)
 * ----------------------------------------------------------------------------
 * File này là một module CỘNG THÊM (additive) — không sửa app.core.js/app.js/
 * data.js hiện có. Chỉ cần thêm 1 dòng <script> để nạp file này SAU
 * js/core/app.core.js và js/app.js đã tồn tại (đặt ngay trước app.js là an
 * toàn nhất — xem hướng dẫn cuối file).
 *
 * Cung cấp:
 *  - Quy trình phê duyệt nhiều cấp cho 9 loại chứng từ:
 *    Đề nghị mua hàng, Đơn đặt hàng, Thanh toán, Chi tiền, Giảm giá,
 *    Hủy đơn hàng, Xuất kho đặc biệt, Sản xuất ngoài định mức, Đổi trả hàng
 *  - Phân quyền theo cấp (mỗi cấp gắn 1 vai trò trong DB.roles, có thể đặt
 *    ngưỡng giá trị để tự thêm cấp duyệt cao hơn)
 *  - Nhật ký phê duyệt (audit log) cho mọi thao tác tạo/duyệt/từ chối/hủy
 *  - Chữ ký điện tử (chữ ký dạng văn bản có mã xác thực + dấu thời gian)
 *  - Cảnh báo quá hạn duyệt (theo SLA giờ cấu hình cho từng quy trình)
 * ==========================================================================*/

/* ---------------------------------------------------------------------------
 * 1. DANH MỤC LOẠI CHỨNG TỪ ÁP DỤNG PHÊ DUYỆT
 * -------------------------------------------------------------------------*/
const APPROVAL_DOC_TYPES = {
  PR:                   { label: 'Đề nghị mua hàng',        icon: 'fa-cart-shopping',       tone: 'orange' },
  PAYMENT:              { label: 'Thanh toán',              icon: 'fa-money-bill-transfer',  tone: 'green'  },
  CASH_OUT:             { label: 'Chi tiền',                icon: 'fa-sack-dollar',          tone: 'red'    },
  DISCOUNT:             { label: 'Giảm giá',                icon: 'fa-tags',                 tone: 'indigo' },
  ORDER_CANCEL:         { label: 'Hủy đơn hàng',             icon: 'fa-ban',                  tone: 'red'    },
  SPECIAL_ISSUE:        { label: 'Xuất kho đặc biệt',        icon: 'fa-dolly',                tone: 'teal'   },
  OVER_NORM_PRODUCTION: { label: 'Sản xuất ngoài định mức',  icon: 'fa-industry',             tone: 'orange' },
  RETURN_EXCHANGE:      { label: 'Đổi trả hàng',             icon: 'fa-rotate-left',          tone: 'slate'  },
  SALES_ORDER:          { label: 'Đơn hàng bán',              icon: 'fa-file-invoice-dollar',  tone: 'blue'   },
};
const APPROVAL_DOC_TYPE_LIST = Object.keys(APPROVAL_DOC_TYPES);

/* ---------------------------------------------------------------------------
 * 2. DỮ LIỆU NỀN — quy trình mặc định + kho lưu trữ runtime
 *    (chỉ khởi tạo nếu chưa có, để không ghi đè khi module load lại)
 * -------------------------------------------------------------------------*/
DB.approvalWorkflows = DB.approvalWorkflows || [
  { id: 'WF-PR',     docType: 'PR',     name: 'Đề nghị mua hàng',       slaHours: 24,
    levels: [
      { level: 1, role: 'ROLE_PURCHASE_MANAGER', label: 'Trưởng phòng Mua hàng duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_DIRECTOR', label: 'Ban giám đốc duyệt (giá trị lớn)', minAmount: 50000000 },
    ] },
  { id: 'WF-PAYMENT', docType: 'PAYMENT', name: 'Thanh toán',          slaHours: 12,
    levels: [
      { level: 1, role: 'ROLE_ACCOUNTING', label: 'Kế toán duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_DIRECTOR', label: 'Ban giám đốc duyệt (giá trị lớn)', minAmount: 20000000 },
    ] },
  { id: 'WF-CASH',   docType: 'CASH_OUT', name: 'Chi tiền',            slaHours: 8,
    levels: [
      { level: 1, role: 'ROLE_ACCOUNTING', label: 'Kế toán duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_DIRECTOR', label: 'Ban giám đốc duyệt (giá trị lớn)', minAmount: 10000000 },
    ] },
  { id: 'WF-DISCOUNT', docType: 'DISCOUNT', name: 'Giảm giá',          slaHours: 24,
    levels: [
      { level: 1, role: 'ROLE_SALES_MANAGER', label: 'Trưởng phòng Kinh doanh duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_DIRECTOR', label: 'Ban giám đốc duyệt (mức giảm lớn)', minAmount: 10 },
    ] },
  { id: 'WF-CANCEL', docType: 'ORDER_CANCEL', name: 'Hủy đơn hàng',    slaHours: 24,
    levels: [
      { level: 1, role: 'ROLE_SALES_MANAGER', label: 'Trưởng phòng Kinh doanh duyệt', minAmount: 0 },
    ] },
  { id: 'WF-ISSUE',  docType: 'SPECIAL_ISSUE', name: 'Xuất kho đặc biệt', slaHours: 12,
    levels: [
      { level: 1, role: 'ROLE_WAREHOUSE', label: 'Kho xác nhận', minAmount: 0 },
      { level: 2, role: 'ROLE_PRODUCTION', label: 'Sản xuất duyệt', minAmount: 0 },
    ] },
  { id: 'WF-OVERNORM', docType: 'OVER_NORM_PRODUCTION', name: 'Sản xuất ngoài định mức', slaHours: 24,
    levels: [
      { level: 1, role: 'ROLE_PRODUCTION', label: 'Sản xuất duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_DIRECTOR', label: 'Ban giám đốc duyệt (chênh lệch lớn)', minAmount: 5000000 },
    ] },
  { id: 'WF-RETURN', docType: 'RETURN_EXCHANGE', name: 'Đổi trả hàng', slaHours: 24,
    levels: [
      { level: 1, role: 'ROLE_SALES_MANAGER', label: 'Trưởng phòng Kinh doanh duyệt', minAmount: 0 },
      { level: 2, role: 'ROLE_ACCOUNTING', label: 'Kế toán đối chiếu công nợ', minAmount: 0 },
    ] },
];

// Đơn hàng bán phải đi qua Trưởng phòng Kinh doanh trước khi Kho/SX xử lý.
// Dùng ensure thay vì chỉ đặt trong mảng mặc định vì approvalWorkflows có thể
// đã được hydrate từ KIO và thiếu workflow mới.
if (!DB.approvalWorkflows.some(w => w && w.docType === 'SALES_ORDER')) {
  DB.approvalWorkflows.push({
    id: 'WF-SALES-ORDER', docType: 'SALES_ORDER', name: 'Duyệt đơn hàng bán', slaHours: 24,
    levels: [{ level: 1, role: 'ROLE_SALES_MANAGER', label: 'Trưởng phòng Kinh doanh duyệt', minAmount: 0 }]
  });
}

DB.approvalRequests = DB.approvalRequests || [];
DB.approvalLogs = DB.approvalLogs || [];
DB.eSignatures = DB.eSignatures || [];

/* ---------------------------------------------------------------------------
 * 3. TIỆN ÍCH DÙNG CHUNG
 * -------------------------------------------------------------------------*/
function approvalRoleName(roleId) { return (DB.roles.find((r) => r.id === roleId) || {}).name || roleId; }
function approvalWorkflowOf(docType) { return DB.approvalWorkflows.find((w) => w.docType === docType); }
function approvalActiveLevels(workflow, amount) {
  return (workflow.levels || []).filter((l) => Number(amount || 0) >= Number(l.minAmount || 0)).sort((a, b) => a.level - b.level);
}

// Giá trị PR dùng cho phân cấp duyệt phải lấy từ dữ liệu nghiệp vụ thật.
// Không chỉ tin p.total vì các PR cũ có thể chưa lưu/đã lưu sai total.
function approvalPrAmount(pr) {
  if (!pr) return 0;
  const itemTotal = (pr.items || []).reduce((sum, item) => {
    const amount = Number(item.amount || 0);
    if (amount > 0) return sum + amount;
    const qty = Number(item.qty || 0);
    const price = Number(item.expectedPrice || item.price || 0);
    return sum + (qty * price);
  }, 0);
  return Math.max(Number(pr.total || 0), itemTotal);
}

// Nếu một yêu cầu PR pending được tạo từ dữ liệu cũ với thiếu cấp duyệt,
// bổ sung lại các cấp theo ngưỡng hiện tại trước khi cho duyệt tiếp.
function approvalEnsurePrLevels(req, pr) {
  if (!req || req.docType !== 'PR' || !pr) return false;
  const wf = approvalWorkflowOf('PR');
  if (!wf) return false;
  const amount = approvalPrAmount(pr);
  req.amount = amount;
  const active = approvalActiveLevels(wf, amount);
  const existing = new Map((req.levels || []).map(l => [Number(l.level), l]));
  let changed = false;
  active.forEach(level => {
    if (existing.has(Number(level.level))) return;
    (req.levels ||= []).push({
      level: level.level, role: level.role, label: level.label, status: 'PENDING',
      approverId: '', approverName: '', time: '', note: '', signature: '',
    });
    changed = true;
  });
  req.levels.sort((a,b)=>Number(a.level)-Number(b.level));
  if (pr.approvalWorkflowRequestId === req.id) {
    for (const saved of (pr.approvalLevels || [])) {
      const level = req.levels.find(l => Number(l.level) === Number(saved.level));
      if (level && saved.status === 'APPROVED' && saved.approverId && saved.time && level.status !== 'APPROVED') {
        Object.assign(level,saved); changed = true;
      }
    }
  }
  const pending = req.levels.find(l => l.status === 'PENDING');
  if (pending && Number(req.currentLevel) !== Number(pending.level)) { req.currentLevel = pending.level; changed = true; }
  return changed;
}


/* Tự chữa dữ liệu PR cũ bị lệch giữa Purchase và Approvals.
 * Nguồn sự thật nghiệp vụ vẫn là PR: nếu PR đang Chờ duyệt thì BẮT BUỘC phải
 * có đúng một approval request PENDING tương ứng. Hàm này chỉ bổ sung liên kết
 * bị thiếu/sửa metadata cấp duyệt; KHÔNG đổi trạng thái PR và KHÔNG thay đổi
 * chuỗi nghiệp vụ PR -> duyệt -> báo giá -> PO. */
async function approvalReconcilePendingPrs({ persist = true } = {}) {
  // Never generate approval rows from data.js or an old cache before the real PR list is loaded.
  if (persist && typeof PurchaseAPI !== 'undefined' && PurchaseAPI.hasServerData && !PurchaseAPI.hasServerData('purchases')) return {created:0,repaired:0};
  const pendingStatuses = new Set(['mh_cho_duyet', 'PENDING_APPROVAL']);
  const prs = (DB.purchases || []).filter(pr => pr && pendingStatuses.has(pr.status));
  if (!prs.length) return { created: 0, repaired: 0 };

  let created = 0;
  let repaired = 0;
  const now = new Date();
  const wf = approvalWorkflowOf('PR');
  if (!wf) return { created, repaired };

  for (const pr of prs) {
    let req = (DB.approvalRequests || []).find(r => r.id === pr.approvalRequestId && r.docType === 'PR' && r.docId === pr.id && ['PENDING','APPROVED'].includes(r.status)) ||
      (DB.approvalRequests || []).find(r => r.docType === 'PR' && r.docId === pr.id && r.status === 'PENDING');
    if (req && req.status === 'APPROVED') {
      approvalEnsurePrLevels(req,pr);
      if ((req.levels || []).length && req.levels.every(l=>l.status==='APPROVED')) {
        ApprovalEngine.handlers.PR?.onApproved?.(req); repaired++; continue;
      }
      req.status = 'PENDING';
    }
    const amount = approvalPrAmount(pr);

    if (!req) {
      const levels = approvalActiveLevels(wf, amount).map(l => ({
        level: l.level, role: l.role, label: l.label, status: 'PENDING',
        approverId: '', approverName: '', time: '', note: '', signature: '',
      }));
      if (!levels.length) continue;
      const due = new Date(now.getTime() + Number(wf.slaHours || 24) * 3600000);
      req = {
        id: nextCode('DUYET-2026-', DB.approvalRequests),
        workflowId: wf.id, docType: 'PR', docId: pr.id,
        title: `Đề nghị mua hàng ${pr.id}`,
        amount,
        requestedBy: pr.requestedBy || pr.createdBy || pr.employeeId || '',
        requestedByName: pr.requestedByName || pr.createdByName || pr.employeeName || '',
        requestedAt: pr.requestedAt || pr.createdAt || now.toISOString(),
        status: 'PENDING', currentLevel: levels[0].level, levels,
        dueAt: due.toISOString(), note: pr.reason || '',
        repairedFromPurchase: true,
      };
      DB.approvalRequests.unshift(req);
      created++;
    } else {
      const before = JSON.stringify({ amount:req.amount, levels:req.levels, currentLevel:req.currentLevel });
      approvalEnsurePrLevels(req, pr);
      const nextPending = (req.levels || []).find(l => l.status === 'PENDING');
      if (!nextPending && req.levels.length && req.levels.every(l=>l.status==='APPROVED')) {
        req.status='APPROVED'; req.completedAt=req.levels[req.levels.length-1].time;
        ApprovalEngine.handlers.PR?.onApproved?.(req); repaired++; continue;
      }
      if (nextPending) req.currentLevel = nextPending.level;
      if (before !== JSON.stringify({ amount:req.amount, levels:req.levels, currentLevel:req.currentLevel })) repaired++;
    }

    const lvl = (req.levels || []).find(l => Number(l.level) === Number(req.currentLevel)) || (req.levels || []).find(l => l.status === 'PENDING');
    if (pr.approvalRequestId !== req.id || Number(pr.approvalCurrentLevel || 0) !== Number(lvl?.level || 0) || pr.approvalCurrentRole !== (lvl?.role || '')) repaired++;
    pr.approvalRequestId = req.id;
    pr.approvalCurrentLevel = lvl?.level || '';
    pr.approvalCurrentRole = lvl?.role || '';
    pr.approvalCurrentLabel = lvl?.label || (lvl?.role ? approvalRoleName(lvl.role) : '');
  }

  if (persist && (created || repaired)) {
    // Ghi cả hai phía ngay trong cùng lượt sửa để F5/đổi tài khoản không làm
    // mất liên kết vừa phục hồi. Không tạo audit giả cho dữ liệu lịch sử.
    const jobs = [];
    if (typeof ApprovalsAPI !== 'undefined' && ApprovalsAPI.syncCollections) jobs.push(ApprovalsAPI.syncCollections(['requests']));
    if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.syncCollections) jobs.push(PurchaseAPI.syncCollections(['purchases']));
    const results = await Promise.allSettled(jobs);
    const failed = results.find(r => r.status === 'rejected');
    if (failed) console.warn('[Approvals] Phục hồi liên kết PR/Approval đã cập nhật local nhưng có nguồn KIO chưa lưu được:', failed.reason);
    else console.info(`[Approvals] Đã phục hồi PR chờ duyệt: tạo ${created} approval request, sửa ${repaired} liên kết/cấp duyệt.`);
  }
  return { created, repaired };
}


/* Đồng bộ nghiệp vụ Đơn hàng bán -> Việc cần duyệt.
 * Mọi đơn đang dh_cho_xu_ly bắt buộc có một SALES_ORDER request PENDING ở
 * ROLE_SALES_MANAGER. Hàm này còn tự chữa dữ liệu cũ đã tạo trước bản fix. */
async function approvalReconcilePendingSalesOrders({ persist = true } = {}) {
  const orders = (DB.orders || []).filter(o => o && o.status === 'dh_cho_xu_ly' && !o.approvedAt);
  if (!orders.length) return { created: 0, repaired: 0 };
  const wf = approvalWorkflowOf('SALES_ORDER');
  if (!wf) return { created: 0, repaired: 0 };
  let created = 0, repaired = 0;
  const now = new Date();

  for (const order of orders) {
    let req = (DB.approvalRequests || []).find(r => r.docType === 'SALES_ORDER' && r.docId === order.id && r.status === 'PENDING');
    if (!req) {
      const levels = approvalActiveLevels(wf, Number(order.total || 0)).map(l => ({
        level: l.level, role: l.role, label: l.label, status: 'PENDING',
        approverId: '', approverName: '', time: '', note: '', signature: ''
      }));
      if (!levels.length) continue;
      const requestedAt = order.createdAt || `${order.date || approvalTodayYMD()}T00:00:00`;
      const base = new Date(requestedAt);
      const due = new Date((Number.isNaN(base.getTime()) ? now : base).getTime() + Number(wf.slaHours || 24) * 3600000);
      req = {
        id: nextCode('DUYET-2026-', DB.approvalRequests), workflowId: wf.id,
        docType: 'SALES_ORDER', docId: order.id, title: `Đơn hàng bán ${order.id}`,
        amount: Number(order.total || 0),
        requestedBy: order.createdBy || order.ownerId || '',
        requestedByName: order.createdByName || Q.employeeName?.(order.createdBy || order.ownerId) || '',
        requestedAt: requestedAt,
        status: 'PENDING', currentLevel: levels[0].level, levels,
        dueAt: due.toISOString(), note: order.note || '', repairedFromSalesOrder: true
      };
      DB.approvalRequests.unshift(req);
      created++;
    } else {
      const lvl = (req.levels || []).find(l => l.status === 'PENDING');
      if (!lvl || lvl.role !== 'ROLE_SALES_MANAGER') {
        req.levels = [{ level: 1, role: 'ROLE_SALES_MANAGER', label: 'Trưởng phòng Kinh doanh duyệt', status: 'PENDING', approverId:'', approverName:'', time:'', note:'', signature:'' }];
        req.currentLevel = 1;
        repaired++;
      }
      if (Number(req.amount || 0) !== Number(order.total || 0)) { req.amount = Number(order.total || 0); repaired++; }
    }
    const lvl = (req.levels || []).find(l => Number(l.level) === Number(req.currentLevel)) || (req.levels || []).find(l => l.status === 'PENDING');
    order.approvalRequestId = req.id;
    order.approvalCurrentLevel = lvl?.level || 1;
    order.approvalCurrentRole = lvl?.role || 'ROLE_SALES_MANAGER';
  }

  if (persist && (created || repaired)) {
    const jobs = [];
    if (typeof ApprovalsAPI !== 'undefined' && ApprovalsAPI.syncCollections) jobs.push(ApprovalsAPI.syncCollections(['requests']));
    if (typeof CRMAPI !== 'undefined' && CRMAPI.syncCollections) jobs.push(CRMAPI.syncCollections(['orders']));
    await Promise.allSettled(jobs);
    console.info(`[Approvals] Đã phục hồi đơn bán chờ duyệt: tạo ${created} request, sửa ${repaired}.`);
  }
  return { created, repaired };
}

function approvalRegisterPendingSalesOrderNow(order) {
  if (!order || order.status !== 'dh_cho_xu_ly') return null;
  let req = ApprovalEngine.pendingFor('SALES_ORDER', order.id);
  if (!req) req = ApprovalEngine.create({
    docType: 'SALES_ORDER', docId: order.id, title: `Đơn hàng bán ${order.id}`,
    amount: Number(order.total || 0), note: order.note || ''
  });
  if (!req) return null;
  const lvl = ApprovalEngine.currentLevelOf(req) || (req.levels || []).find(l => l.status === 'PENDING');
  order.approvalRequestId = req.id;
  order.approvalCurrentLevel = lvl?.level || 1;
  order.approvalCurrentRole = lvl?.role || 'ROLE_SALES_MANAGER';
  try { ApprovalsAPI?.scheduleCollections?.(['requests'], 0); } catch (_) {}
  try { CRMAPI?.scheduleCollections?.(['orders'], 0); } catch (_) {}
  try { window.SidebarBadges?.markReady?.('approvals'); window.SidebarBadges?.markReady?.('all'); } catch (_) {}
  try { if (typeof renderNav === 'function') renderNav(); } catch (_) {}
  return req;
}

async function persistApprovalServer(keys = ['approvalRequests','approvalLogs']) {
  const list = Array.isArray(keys) ? keys : [keys];
  const approvalMap = {
    approvalRequests: 'requests',
    approvalLogs: 'logs',
    approvalWorkflows: 'workflows',
    eSignatures: 'signatures',
  };
  const approvalKeys = [...new Set(list.map(k => approvalMap[k]).filter(Boolean))];
  const purchaseKeys = [...new Set(list.filter(k => k === 'purchases'))];
  const jobs = [];
  if (approvalKeys.length && typeof ApprovalsAPI !== 'undefined' && typeof ApprovalsAPI.syncCollections === 'function') {
    jobs.push(ApprovalsAPI.syncCollections(approvalKeys));
  }
  if (purchaseKeys.length && typeof PurchaseAPI !== 'undefined' && typeof PurchaseAPI.syncCollections === 'function') {
    jobs.push(PurchaseAPI.syncCollections(purchaseKeys));
  }
  if (jobs.length) await Promise.all(jobs);
  return true;
}
function approvalDjb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().slice(0, 6);
}
function approvalSignText(name) {
  const stamp = new Date().toLocaleString('vi-VN');
  const code = approvalDjb2(name + stamp + Math.random());
  return `${name} — ký điện tử lúc ${stamp} — mã xác thực #${code}`;
}
function approvalMySignature() {
  const uid = DB.currentUser?.userId || DB.currentUser?.id || '';
  return (DB.eSignatures || []).find((s) => s.userId === uid);
}
function approvalLog(requestId, docType, docId, level, action, note, extra = {}) {
  const entry = {
    id: nextCode('NKPD-', DB.approvalLogs),
    requestId, docType, docId, level, action,
    actorId: DB.currentUser?.userId || DB.currentUser?.id || '',
    actorName: DB.currentUser?.name || '',
    time: new Date().toISOString(),
    note: note || '',
    signature: extra.signature || '',
    roleId: (Auth.currentRole() || {}).id || '',
    roleName: (Auth.currentRole() || {}).name || '',
  };
  DB.approvalLogs.unshift(entry);

  // Persistence thật: nhật ký phê duyệt là append-only nên ghi thẳng record
  // mới lên KIO, không cần đồng bộ lại toàn bộ collection.
  if (typeof ApprovalsAPI !== 'undefined') ApprovalsAPI.appendLogs([entry]).catch(() => {});

  // Đồng thời đưa vào nhật ký chung của hệ thống (giống Purchases/CRM) để
  // Quản trị viên xem được mọi hành động phê duyệt trong 1 màn Audit Log.
  if (typeof SystemAPI !== 'undefined') {
    SystemAPI.audit({
      module: 'APPROVALS', entityType: 'APPROVAL_REQUEST', entityId: requestId,
      action, description: `${entry.actorName || 'Người dùng'} ${approvalActionLabel(action)} — ${docId || requestId}${note ? ': ' + note : ''}`,
      newData: { docType, docId, level, action },
    }).catch(() => {});
  }
}
function approvalIsOverdue(req) {
  return req.status === 'PENDING' && new Date() > new Date(req.dueAt);
}
function approvalOverdueHours(req) {
  return Math.max(0, Math.round((new Date() - new Date(req.dueAt)) / 3600000));
}
function approvalStatusBadge(s) {
  const map = { PENDING: ['Đang chờ duyệt', 'orange'], APPROVED: ['Đã duyệt', 'green'], REJECTED: ['Từ chối', 'red'], CANCELLED: ['Đã hủy', 'slate'] };
  const [label, tone] = map[s] || [s, 'slate'];
  return `<span class="badge ${tone}">${esc(label)}</span>`;
}
function approvalDocTypeChip(docType) {
  const t = APPROVAL_DOC_TYPES[docType] || { label: docType, icon: 'fa-file', tone: 'slate' };
  return `<span class="chip"><i class="fa-solid ${t.icon}" style="color:var(--${t.tone})"></i>${esc(t.label)}</span>`;
}

/* ---------------------------------------------------------------------------
 * 4. ENGINE PHÊ DUYỆT
 * -------------------------------------------------------------------------*/
const ApprovalEngine = {
  /* Đăng ký nghiệp vụ thật sự cần thực thi khi một yêu cầu duyệt xong hết cấp
   * (onApproved) hoặc bị từ chối ở bất kỳ cấp nào (onRejected). Đây là điểm
   * nối để PR/Thanh toán (hoặc bất kỳ chứng từ nào khác) áp dụng thay đổi
   * thật vào DB chỉ SAU KHI đã đi hết quy trình phê duyệt — xem mục 8 cuối
   * file để biết cách đăng ký cho PR/PO/Thanh toán. */
  handlers: {},
  registerHandler(docType, { onApproved, onRejected } = {}) {
    this.handlers[docType] = { onApproved, onRejected };
  },

  create({ docType, docId, title, amount, note }) {
    const workflow = approvalWorkflowOf(docType);
    if (!workflow) {
      Toast.err('Chưa cấu hình quy trình', `Chưa có quy trình phê duyệt cho loại "${(APPROVAL_DOC_TYPES[docType] || {}).label || docType}".`);
      return null;
    }
    const levels = approvalActiveLevels(workflow, amount).map((l) => ({
      level: l.level, role: l.role, label: l.label, status: 'PENDING',
      approverId: '', approverName: '', time: '', note: '', signature: '',
    }));
    if (!levels.length) {
      Toast.err('Không xác định được cấp duyệt', 'Vui lòng kiểm tra lại cấu hình mức ngưỡng của quy trình.');
      return null;
    }
    const now = new Date();
    const due = new Date(now.getTime() + (workflow.slaHours || 24) * 3600 * 1000);
    const req = {
      id: nextCode('DUYET-2026-', DB.approvalRequests),
      workflowId: workflow.id, docType, docId: docId || '',
      title: title || `${(APPROVAL_DOC_TYPES[docType] || {}).label || docType}${docId ? ' — ' + docId : ''}`,
      amount: Number(amount || 0),
      requestedBy: DB.currentUser?.userId || DB.currentUser?.id || '',
      requestedByName: DB.currentUser?.name || '',
      requestedAt: now.toISOString(),
      status: 'PENDING', currentLevel: levels[0].level,
      levels, dueAt: due.toISOString(), note: note || '',
    };
    DB.approvalRequests.unshift(req);
    approvalLog(req.id, docType, req.docId, levels[0].level, 'CREATE', `Tạo yêu cầu phê duyệt${req.amount ? ' — ' + fmtVND(req.amount) : ''}`);
    if (typeof ApprovalsAPI !== 'undefined') ApprovalsAPI.scheduleCollections(['requests']);
    return req;
  },

  currentLevelOf(req) {
    if (!req) return null;
    const levels = (req.levels || []).slice().sort((a,b)=>Number(a.level)-Number(b.level));
    if (req.status === 'PENDING') {
      const pending=levels.find(l=>l.status==='PENDING');
      if (pending) { req.currentLevel=pending.level; return pending; }
      return null;
    }
    return levels.find(l=>Number(l.level)===Number(req.currentLevel)) || levels[levels.length-1];
  },

  /** Tìm yêu cầu đang chờ duyệt (nếu có) gắn với một chứng từ cụ thể — dùng
   * để không tạo trùng yêu cầu khi người dùng bấm "Duyệt" nhiều lần. */
  pendingFor(docType, docId) {
    return DB.approvalRequests.find((r) => r.docType === docType && r.docId === docId && r.status === 'PENDING');
  },

  canAct(req) {
    const lvl = this.currentLevelOf(req);
    if (!lvl || !approvalRequestIsCurrent(req)) return false;
    const role = Auth.currentRole();
    if (!role) return false;
    // Approval follows the assigned level. Directors do not approve a manager's level again.
    return req.status === 'PENDING' && (role.id === lvl.role || role.id === 'ROLE_ADMIN');
  },

  approve(requestId, { note = '', signature = '' } = {}) {
    const req = DB.approvalRequests.find((r) => r.id === requestId);
    if (!req || req.status !== 'PENDING') { Toast.err('Không thể duyệt', 'Yêu cầu không ở trạng thái chờ duyệt.'); return false; }
    // PR cũ có thể được tạo request khi total chưa chính xác. Trước mỗi lần duyệt
    // phải đối chiếu lại giá trị thật để không bỏ sót cấp Ban giám đốc >= 50 triệu.
    if (req.docType === 'PR') approvalEnsurePrLevels(req, Q.purchase(req.docId));
    if (!this.canAct(req)) { Toast.err('Không có quyền duyệt', 'Vai trò hiện tại không thuộc cấp duyệt hiện tại của yêu cầu này.'); return false; }
    const lvl = this.currentLevelOf(req);
    lvl.status = 'APPROVED';
    lvl.approverId = DB.currentUser?.userId || DB.currentUser?.id || '';
    lvl.approverName = DB.currentUser?.name || '';
    lvl.time = new Date().toISOString();
    lvl.note = note;
    lvl.signature = signature || approvalSignText(DB.currentUser?.name || '');
    approvalLog(req.id, req.docType, req.docId, lvl.level, 'APPROVE', note, { signature: lvl.signature });
    if (req.docType === 'PR') {
      const pr=Q.purchase(req.docId);
      if (pr) {
        pr.approvalWorkflowRequestId=req.id; pr.approvalLevels=JSON.parse(JSON.stringify(req.levels));
        if (typeof PurchaseAPI !== 'undefined') PurchaseAPI.scheduleCollections(['purchases'],0);
      }
    }
    const remaining = (req.levels || []).filter((l) => l.status === 'PENDING').sort((a,b)=>Number(a.level)-Number(b.level));
    if (remaining.length) {
      req.currentLevel = remaining[0].level;
      if (req.docType === 'PR') {
        const pr = Q.purchase(req.docId);
        if (pr) {
          pr.approvalRequestId = req.id;
          pr.approvalCurrentLevel = remaining[0].level;
          pr.approvalCurrentRole = remaining[0].role;
          pr.approvalCurrentLabel = remaining[0].label || approvalRoleName(remaining[0].role);
        }
      }
      Toast.ok('Đã duyệt cấp ' + lvl.level, `Chuyển sang cấp duyệt tiếp theo: ${approvalRoleName(remaining[0].role)}`);
    } else {
      req.status = 'APPROVED';
      req.completedAt = new Date().toISOString();
      approvalLog(req.id, req.docType, req.docId, lvl.level, 'FINALIZE', 'Hoàn tất tất cả các cấp phê duyệt');
      Toast.ok('Đã phê duyệt hoàn tất', req.title);
      try { this.handlers[req.docType]?.onApproved?.(req); }
      catch (err) { console.error('[ApprovalEngine] onApproved lỗi:', err); Toast.err('Duyệt xong nhưng áp dụng thất bại', String(err?.message || err)); }
    }
    if (typeof ApprovalsAPI !== 'undefined') ApprovalsAPI.scheduleCollections(['requests']);
    return true;
  },

  reject(requestId, { reason = '' } = {}) {
    const req = DB.approvalRequests.find((r) => r.id === requestId);
    if (!req || req.status !== 'PENDING') { Toast.err('Không thể từ chối', 'Yêu cầu không ở trạng thái chờ duyệt.'); return false; }
    if (!this.canAct(req)) { Toast.err('Không có quyền từ chối', 'Vai trò hiện tại không thuộc cấp duyệt hiện tại của yêu cầu này.'); return false; }
    if (!reason.trim()) { Toast.err('Thiếu lý do', 'Vui lòng nhập lý do từ chối.'); return false; }
    const lvl = this.currentLevelOf(req);
    lvl.status = 'REJECTED';
    lvl.approverId = DB.currentUser?.userId || DB.currentUser?.id || '';
    lvl.approverName = DB.currentUser?.name || '';
    lvl.time = new Date().toISOString();
    lvl.note = reason;
    req.status = 'REJECTED';
    req.completedAt = new Date().toISOString();
    approvalLog(req.id, req.docType, req.docId, lvl.level, 'REJECT', reason);
    Toast.warn('Đã từ chối yêu cầu', req.title);
    try { this.handlers[req.docType]?.onRejected?.(req); }
    catch (err) { console.error('[ApprovalEngine] onRejected lỗi:', err); }
    if (typeof ApprovalsAPI !== 'undefined') ApprovalsAPI.scheduleCollections(['requests']);
    return true;
  },

  cancel(requestId, reason) {
    const req = DB.approvalRequests.find((r) => r.id === requestId);
    if (!req || req.status !== 'PENDING') return false;
    req.status = 'CANCELLED';
    req.completedAt = new Date().toISOString();
    approvalLog(req.id, req.docType, req.docId, req.currentLevel, 'CANCEL', reason || '');
    if (typeof ApprovalsAPI !== 'undefined') ApprovalsAPI.scheduleCollections(['requests']);
    return true;
  },
};


// Khi duyệt/từ chối tại "Việc cần duyệt", áp dụng lại đúng action nghiệp vụ CRM
// để trạng thái đơn, giữ tồn và phiếu xuất vẫn đi theo chuỗi cũ.
ApprovalEngine.registerHandler('SALES_ORDER', {
  onApproved(req) {
    const order = (DB.orders || []).find(o => o.id === req.docId);
    if (!order || order.status !== 'dh_cho_xu_ly') return;
    if (typeof Actions !== 'undefined' && Actions['crm-order-approve']) {
      Actions['crm-order-approve']({ id: order.id });
    }
  },
  onRejected(req) {
    const order = (DB.orders || []).find(o => o.id === req.docId);
    if (!order || order.status !== 'dh_cho_xu_ly') return;
    // Không gọi prompt của action cũ; lưu lý do từ approval request nếu có.
    const rejected = (req.levels || []).find(l => l.status === 'REJECTED');
    order.status = 'dh_tu_choi';
    order.rejectedBy = rejected?.approverId || DB.currentUser?.userId || DB.currentUser?.id || '';
    order.rejectedByName = rejected?.approverName || DB.currentUser?.name || '';
    order.rejectedAt = rejected?.time || new Date().toISOString();
    order.rejectReason = rejected?.note || 'Từ chối tại Việc cần duyệt';
    try { SalesCRM?.saveLocal?.(['orders']); } catch (_) {}
    try { CRMAPI?.scheduleCollections?.(['orders'], 0); } catch (_) {}
  }
});

/* Đăng ký PR vào hàng chờ phê duyệt NGAY tại thời điểm tạo PR.
 * Không chờ người dùng mở menu Phê duyệt mới reconcile, nhờ vậy badge đổi số
 * ngay trong cùng lần click "Gửi đề nghị mua". */
function approvalRegisterPendingPrNow(pr) {
  if (!pr || pr.status !== 'mh_cho_duyet') return null;
  let req = ApprovalEngine.pendingFor('PR', pr.id);
  if (!req) {
    req = ApprovalEngine.create({
      docType: 'PR', docId: pr.id, title: `Đề nghị mua hàng ${pr.id}`,
      amount: approvalPrAmount(pr), note: pr.reason || ''
    });
  } else {
    approvalEnsurePrLevels(req, pr);
  }
  if (!req) return null;
  const lvl = ApprovalEngine.currentLevelOf(req) || (req.levels || []).find(l => l.status === 'PENDING');
  pr.approvalRequestId = req.id;
  pr.approvalCurrentLevel = lvl?.level || '';
  pr.approvalCurrentRole = lvl?.role || '';
  pr.approvalCurrentLabel = lvl?.label || (lvl?.role ? approvalRoleName(lvl.role) : '');
  // schedule 0ms: ghi server ngay nhưng không chặn UI; state local đã có request nên badge tăng tức thì.
  try { ApprovalsAPI?.scheduleCollections?.(['requests'], 0); } catch (_) {}
  try { PurchaseAPI?.scheduleCollections?.(['purchases'], 0); } catch (_) {}
  try { window.SidebarBadges?.markReady?.('approvals'); } catch (_) {}
  return req;
}

/* Gắn đếm "đang chờ duyệt" + cảnh báo quá hạn lên sidebar (mục Approvals đã có sẵn trong NAV) */
(function attachApprovalsNavCount() {
  const item = (typeof NAV !== 'undefined' ? NAV : []).flatMap((g) => g.items).find((i) => i.id === 'approvals');
  if (item) {
    item.count = () => DB.approvalRequests.filter((r) => r.status === 'PENDING').length;
    item.alert = () => DB.approvalRequests.some((r) => approvalIsOverdue(r));
  }
})();

/* ---------------------------------------------------------------------------
 * 5. GIAO DIỆN — Views.approvals
 * -------------------------------------------------------------------------*/
const APPROVALS_TABS = [
  { id: 'approvals', label: 'Tổng quan', tab: 'dashboard' },
  { id: 'approvals', label: 'Việc cần duyệt', tab: 'pending' },
  { id: 'approvals', label: 'Quy trình phê duyệt', tab: 'workflows' },
  { id: 'approvals', label: 'Cảnh báo quá hạn', tab: 'overdue' },
  { id: 'approvals', label: 'Chữ ký điện tử', tab: 'signature' },
];

function approvalsHeadActions() {
  return `<button class="btn btn-primary btn-sm" data-act="approval-new"><i class="fa-solid fa-plus"></i>Tạo yêu cầu phê duyệt</button>`;
}

function approvalsDashboardView() {
  const all = DB.approvalRequests;
  const pending = all.filter((r) => r.status === 'PENDING');
  const overdue = pending.filter(approvalIsOverdue);
  const thisMonth = (new Date()).toISOString().slice(0, 7);
  const approvedMonth = all.filter((r) => r.status === 'APPROVED' && String(r.completedAt || '').slice(0, 7) === thisMonth).length;
  const rejectedMonth = all.filter((r) => r.status === 'REJECTED' && String(r.completedAt || '').slice(0, 7) === thisMonth).length;

  const byType = APPROVAL_DOC_TYPE_LIST.map((dt) => ({
    dt, count: pending.filter((r) => r.docType === dt).length,
  })).filter((x) => x.count > 0);

  const recentLogs = DB.approvalLogs.slice(0, 8);

  return `
    <div class="grid g-4" style="margin-bottom:16px">
      ${mkpi('Đang chờ duyệt', fmtN(pending.length), 'fa-hourglass-half', 'orange', 'approval-filter-pending')}
      ${mkpi('Quá hạn duyệt', fmtN(overdue.length), 'fa-triangle-exclamation', 'red', 'approval-filter-overdue')}
      ${mkpi('Đã duyệt tháng này', fmtN(approvedMonth), 'fa-circle-check', 'green')}
      ${mkpi('Từ chối tháng này', fmtN(rejectedMonth), 'fa-circle-xmark', 'slate')}
    </div>
    <div class="grid g-21">
      <div class="card">
        <div class="card-head"><div><h3>Việc cần duyệt theo loại chứng từ</h3><p>Bấm để lọc nhanh sang danh sách chờ duyệt</p></div></div>
        <div class="card-body">
          ${byType.length ? byType.map((x) => {
            const t = APPROVAL_DOC_TYPES[x.dt];
            return `<button type="button" class="alert-item" style="width:100%;text-align:left;margin-bottom:9px" data-act="approval-filter-type" data-type="${x.dt}">
              <span class="alert-ico t-${t.tone}"><i class="fa-solid ${t.icon}"></i></span>
              <span style="min-width:0;flex:1"><span class="alert-title">${esc(t.label)}</span><div class="alert-sub">${x.count} yêu cầu đang chờ duyệt</div></span>
              <i class="fa-solid fa-chevron-right"></i>
            </button>`;
          }).join('') : `<div class="empty" style="padding:20px"><div class="empty-ico"><i class="fa-solid fa-check"></i></div><h4>Không có việc cần duyệt</h4><p>Mọi yêu cầu phê duyệt hiện đã được xử lý.</p></div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Hoạt động phê duyệt gần đây</h3></div></div>
        <div class="card-body">
          <div class="tline">
            ${recentLogs.length ? recentLogs.map((l) => `
              <div class="tline-item ${l.action === 'APPROVE' || l.action === 'FINALIZE' ? 'done' : ''} ${l.action === 'CREATE' ? 'doing' : ''}">
                <span class="tline-dot"><i class="fa-solid ${l.action === 'REJECT' ? 'fa-xmark' : l.action === 'CREATE' ? 'fa-plus' : 'fa-check'}"></i></span>
                <div class="tline-title">${esc(l.actorName || '—')} ${esc(approvalActionLabel(l.action))}</div>
                <div class="tline-sub">${approvalDocTypeChip(l.docType)} ${esc(l.docId)} · ${esc(l.note || '')} · ${fmtDateTimeVN(l.time)}</div>
              </div>`).join('') : `<div class="empty" style="padding:16px"><p>Chưa có hoạt động nào.</p></div>`}
          </div>
        </div>
      </div>
    </div>`;
}

function approvalActionLabel(action) {
  return { CREATE: 'đã tạo yêu cầu', APPROVE: 'đã duyệt', REJECT: 'đã từ chối', FINALIZE: 'đã hoàn tất phê duyệt', CANCEL: 'đã hủy yêu cầu' }[action] || action;
}
function fmtDateTimeVN(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN');
}

function approvalDateYMDLocal(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function approvalTodayYMD() {
  if (typeof currentDateYMD === 'function') return currentDateYMD();
  return approvalDateYMDLocal(new Date());
}

/* Lịch sử phê duyệt được gộp ngay trong "Việc cần duyệt".
 * Mặc định chỉ hiển thị ngày hiện tại; lịch sử ngày cũ vẫn được giữ nguyên
 * trên KIO và chỉ xuất hiện khi người dùng chọn khoảng ngày tương ứng. */
function approvalsInlineHistoryView() {
  const today = approvalTodayYMD();
  const f = F('approvalsHistory', { q: '', docType: '', from: today, to: today });
  // Sau khi state cũ đã tồn tại nhưng chưa có from/to, vẫn mặc định về hôm nay.
  if (!f.from && !f.to && !f.__dateInitialized) {
    f.from = today; f.to = today; f.__dateInitialized = true;
  }
  let list = [...(DB.approvalLogs || [])];
  if (f.docType) list = list.filter(l => l.docType === f.docType);
  if (f.from) list = list.filter(l => approvalDateYMDLocal(l.time) >= f.from);
  if (f.to) list = list.filter(l => approvalDateYMDLocal(l.time) <= f.to);
  if (f.q) {
    const q = String(f.q).toLowerCase();
    list = list.filter(l => [l.requestId,l.docId,l.actorName,l.roleName,l.note,approvalActionLabel(l.action)]
      .join(' ').toLowerCase().includes(q));
  }
  list.sort((a,b) => new Date(b.time || 0) - new Date(a.time || 0));
  const pg = paged(list, 'approvalsHistory', 15);
  const rows = pg.items.map(l => {
    const req = (DB.approvalRequests || []).find(r => r.id === l.requestId);
    return `<tr>
      <td class="num">${fmtDateTimeVN(l.time)}</td>
      <td>${cell2(esc(l.actorName || '—'), esc(l.roleName || approvalRoleName(l.roleId) || '—'))}</td>
      <td>${approvalDocTypeChip(l.docType)}</td>
      <td>${cell2(l.requestId ? `<span class="code">${esc(l.requestId)}</span>` : '—', l.docId ? `Tham chiếu: <span class="code">${esc(l.docId)}</span>` : '')}</td>
      <td>${cell2(esc(approvalActionLabel(l.action)), esc(l.note || ''))}</td>
      <td>${req ? approvalStatusBadge(req.status) : '—'}</td>
      <td class="right">${l.requestId ? rowActions([{act:'approval-view',data:`data-id="${esc(l.requestId)}"`,icon:'fa-eye',title:'Xem chi tiết phê duyệt'}]) : ''}</td>
    </tr>`;
  });
  return `<div class="card" style="margin-top:16px">
    <div class="card-head"><div><h3>Lịch sử phê duyệt</h3><p>Mặc định hiển thị hoạt động ngày hiện tại; chọn ngày khác để xem lịch sử cũ.</p></div><span class="chip"><i class="fa-regular fa-calendar"></i>${esc(f.from === today && f.to === today ? 'Hôm nay' : 'Đã lọc theo ngày')}</span></div>
    <div class="toolbar">
      ${searchBox('approvalsHistory', 'Tìm mã yêu cầu, chứng từ, người duyệt…')}
      ${selectFilter('approvalsHistory', 'docType', APPROVAL_DOC_TYPE_LIST.map(dt => [dt, APPROVAL_DOC_TYPES[dt].label]), 'Tất cả loại chứng từ')}
      <label style="display:flex;align-items:center;gap:5px"><span class="muted" style="font-size:11px;white-space:nowrap">Từ ngày</span><input class="inp" type="date" data-f="approvalsHistory.from" value="${esc(f.from || today)}" style="width:145px"></label>
      <label style="display:flex;align-items:center;gap:5px"><span class="muted" style="font-size:11px;white-space:nowrap">Đến ngày</span><input class="inp" type="date" data-f="approvalsHistory.to" value="${esc(f.to || today)}" style="width:145px"></label>
    </div>
    ${tableShell([
      {t:'Thời gian',w:'165px'},{t:'Người thực hiện'},{t:'Loại chứng từ'},{t:'Yêu cầu / Tham chiếu'},
      {t:'Hành động / Ghi chú'},{t:'Trạng thái'},{t:'',w:'70px'}
    ], rows, {emptyTitle:'Không có lịch sử phê duyệt trong ngày đã chọn', emptyDesc:'Chọn ngày khác để xem lịch sử cũ.'})}
    ${pagiHTML('approvalsHistory', pg, 'hoạt động')}
  </div>`;
}

function approvalRequestActivityTime(r) {
  if (!r) return '';
  // Với yêu cầu đã xử lý, dùng thời điểm hành động cuối cùng để phần
  // "Việc cần duyệt" đồng thời đóng vai trò lịch sử phê duyệt.
  const levelTimes = (r.levels || []).map(l => l && l.time).filter(Boolean);
  const candidates = [r.updatedAt, r.approvedAt, r.rejectedAt, r.cancelledAt, ...levelTimes, r.requestedAt].filter(Boolean);
  if (!candidates.length) return '';
  return candidates.sort((a,b) => new Date(b||0) - new Date(a||0))[0];
}

function approvalRequestIsCurrent(req) {
  if (!req || req.status !== 'PENDING') return !!req;
  if (req.docType === 'PR') {
    if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.hasServerData && !PurchaseAPI.hasServerData('purchases')) return false;
    const pr=(DB.purchases || []).find(p=>p.id===req.docId);
    if (!pr || !['mh_cho_duyet','PENDING_APPROVAL'].includes(pr.status)) return false;
    if (pr.approvalRequestId && pr.approvalRequestId!==req.id) return false;
  }
  if (req.docType === 'SALES_ORDER') {
    const order=(DB.orders || []).find(o=>o.id===req.docId);
    if (!order || order.status!=='dh_cho_xu_ly' || order.approvedAt) return false;
    if (order.approvalRequestId && order.approvalRequestId!==req.id) return false;
  }
  return true;
}

function approvalPrHasDirectorApproval(pr) {
  if (!pr) return false;
  const req=(DB.approvalRequests || []).find(r=>r.id===pr.approvalRequestId && r.docType==='PR' && r.docId===pr.id) ||
    (DB.approvalRequests || []).filter(r=>r.docType==='PR' && r.docId===pr.id).sort((a,b)=>new Date(b.requestedAt||0)-new Date(a.requestedAt||0))[0];
  if (req && req.status==='APPROVED' && (req.levels || []).some(l=>l.role==='ROLE_DIRECTOR' && l.status==='APPROVED')) return true;
  return pr.approvalWorkflowRequestId===pr.approvalRequestId && !!pr.approvalRequestId &&
    ['mh_da_duyet','APPROVED','mh_da_dat_hang','CONVERTED_TO_PO','mh_dang_giao','mh_da_nhan','mh_hoan_thanh'].includes(pr.status) &&
    (pr.approvalLevels || []).some(l=>l.role==='ROLE_DIRECTOR' && l.status==='APPROVED' && l.approverId && l.time);
}

function approvalsPendingView() {
  const today = approvalTodayYMD();
  const f = F('approvals', { q: '', docType: '', status: 'PENDING', from: today, to: today });
  // State cũ có thể chưa có bộ lọc ngày. Lần đầu mở luôn mặc định hôm nay.
  if (!f.from && !f.to && !f.__dateInitialized) {
    f.from = today; f.to = today; f.__dateInitialized = true;
  }

  let list = [...(DB.approvalRequests || [])].filter((r) =>
    (!f.status || r.status === f.status) && (!f.docType || r.docType === f.docType) &&
    (r.status !== 'PENDING' || (approvalRequestIsCurrent(r) && ((Auth.currentRole() || {}).id === 'ROLE_ADMIN' || ApprovalEngine.canAct(r))))
  );

  if (f.from) list = list.filter(r => approvalDateYMDLocal(approvalRequestActivityTime(r)) >= f.from);
  if (f.to) list = list.filter(r => approvalDateYMDLocal(approvalRequestActivityTime(r)) <= f.to);

  if (f.q) {
    const q = String(f.q).toLowerCase();
    list = list.filter((r) => [r.title, r.docId, r.requestedByName, r.id]
      .join(' ').toLowerCase().includes(q));
  }

  list.sort((a, b) =>
    (approvalIsOverdue(b) - approvalIsOverdue(a)) ||
    (new Date(approvalRequestActivityTime(b) || 0) - new Date(approvalRequestActivityTime(a) || 0))
  );
  const pg = paged(list, 'approvals', 10);

  const rows = pg.items.map((r) => {
    const lvl = ApprovalEngine.currentLevelOf(r);
    const canAct = r.status === 'PENDING' && ApprovalEngine.canAct(r);
    const overdue = approvalIsOverdue(r);
    const activityTime = approvalRequestActivityTime(r);
    return `<tr>
      <td>${cell2(`<span class="code">${esc(r.id)}</span>`, approvalDocTypeChip(r.docType))}</td>
      <td>${cell2(esc(r.title), r.docId ? `Tham chiếu: <span class="code">${esc(r.docId)}</span>` : '')}</td>
      <td>${cell2(esc(r.requestedByName || '—'), fmtDateTimeVN(activityTime || r.requestedAt))}</td>
      <td class="right num">${r.amount ? fmtVND(r.amount) : '—'}</td>
      <td>${r.status === 'PENDING' && lvl ? `Cấp ${lvl.level}/${r.levels.length}<div class="cell-sub">${esc(approvalRoleName(lvl.role))}</div>` : '—'}</td>
      <td>${approvalStatusBadge(r.status)}${overdue ? `<div class="cell-sub" style="color:var(--red);font-weight:700">Quá hạn ${approvalOverdueHours(r)} giờ</div>` : ''}</td>
      <td>${rowActions([
        { act: 'approval-view', data: `data-id="${r.id}"`, icon: 'fa-eye', title: 'Xem chi tiết' },
        ...(canAct ? [
          { act: 'approval-approve', data: `data-id="${r.id}"`, icon: 'fa-check', title: 'Duyệt' },
          { act: 'approval-reject', data: `data-id="${r.id}"`, icon: 'fa-xmark', title: 'Từ chối' },
        ] : []),
      ])}</td>
    </tr>`;
  });

  return `<div class="card">
    <div class="toolbar">
      ${searchBox('approvals', 'Tìm theo tiêu đề, mã tham chiếu, người đề nghị…')}
      ${selectFilter('approvals', 'docType', APPROVAL_DOC_TYPE_LIST.map((dt) => [dt, APPROVAL_DOC_TYPES[dt].label]), 'Tất cả loại chứng từ')}
      ${selectFilter('approvals', 'status', [['PENDING', 'Đang chờ duyệt'], ['APPROVED', 'Đã duyệt'], ['REJECTED', 'Từ chối'], ['CANCELLED', 'Đã hủy']], 'Tất cả trạng thái')}
      <label style="display:flex;align-items:center;gap:5px"><span class="muted" style="font-size:11px;white-space:nowrap">Từ ngày</span><input class="inp" type="date" data-f="approvals.from" value="${esc(f.from || today)}" style="width:145px"></label>
      <label style="display:flex;align-items:center;gap:5px"><span class="muted" style="font-size:11px;white-space:nowrap">Đến ngày</span><input class="inp" type="date" data-f="approvals.to" value="${esc(f.to || today)}" style="width:145px"></label>
    </div>
    ${tableShell([
      { t: 'Mã yêu cầu' }, { t: 'Nội dung' }, { t: 'Người đề nghị / Thời gian' }, { t: 'Giá trị', cls: 'right' },
      { t: 'Cấp hiện tại' }, { t: 'Trạng thái' }, { t: '', w: '120px' },
    ], rows, { emptyTitle: 'Không có yêu cầu phù hợp trong khoảng ngày đã chọn', emptyDesc: 'Đổi trạng thái hoặc khoảng ngày để xem lịch sử cũ.' })}
    ${pagiHTML('approvals', pg, 'yêu cầu')}
  </div>`;
}

function approvalsWorkflowsView() {
  const canEdit = ['ROLE_ADMIN', 'ROLE_DIRECTOR'].includes((Auth.currentRole() || {}).id);
  const rows = DB.approvalWorkflows.map((w) => {
    const t = APPROVAL_DOC_TYPES[w.docType] || { label: w.docType };
    return `<tr>
      <td>${cell2(esc(t.label), `Mã quy trình: <span class="code">${esc(w.id)}</span>`)}</td>
      <td>${(w.levels || []).map((l) => `<div class="cell-sub">Cấp ${l.level}: <b>${esc(approvalRoleName(l.role))}</b>${l.minAmount ? ` — áp dụng khi ≥ ${fmtVND(l.minAmount)}` : ' — luôn áp dụng'}</div>`).join('')}</td>
      <td class="center">${w.slaHours} giờ</td>
      <td>${rowActions([{ act: 'approval-wf-edit', data: `data-id="${w.id}"`, icon: canEdit ? 'fa-pen' : 'fa-eye', title: canEdit ? 'Sửa quy trình' : 'Xem quy trình' }])}</td>
    </tr>`;
  });
  return `<div class="card">${tableShell([
    { t: 'Loại chứng từ' }, { t: 'Các cấp phê duyệt' }, { t: 'Hạn xử lý (SLA)', cls: 'center', w: '140px' }, { t: '', w: '70px' },
  ], rows)}</div>
  ${!canEdit ? `<div class="alert info" style="margin-top:12px;padding:12px 14px;border-radius:var(--r);background:var(--surface-2);border:1px solid var(--border);display:flex;gap:10px;align-items:center"><i class="fa-solid fa-circle-info" style="color:var(--primary)"></i><span style="font-size:12.5px;color:var(--text-2)">Chỉ Quản trị viên hoặc Ban giám đốc mới có quyền chỉnh sửa cấu hình quy trình phê duyệt.</span></div>` : ''}`;
}

function approvalsLogsView() {
  const f = F('approvalsLogs', { q: '', docType: '' });
  // Một yêu cầu duyệt chỉ hiển thị một dòng. Chi tiết các cấp/hành động xem bằng nút mắt.
  const groups = new Map();
  (DB.approvalLogs || []).forEach((l) => {
    const key = l.requestId || `${l.docType}:${l.docId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  });
  let list = [...groups.entries()].map(([key, logs]) => {
    logs.sort((a,b) => new Date(b.time || 0) - new Date(a.time || 0));
    const latest = logs[0] || {};
    const req = (DB.approvalRequests || []).find(r => r.id === latest.requestId);
    const approvers = [...new Set(logs.filter(x => x.action === 'APPROVE').map(x => x.actorName).filter(Boolean))];
    return { key, latest, req, logs, approvers };
  });
  if (f.docType) list = list.filter(x => x.latest.docType === f.docType);
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter(x => [x.latest.docId, x.latest.requestId, x.req?.title, ...x.approvers, ...x.logs.map(l=>l.note)].join(' ').toLowerCase().includes(q));
  }
  list.sort((a,b) => new Date(b.latest.time || 0) - new Date(a.latest.time || 0));
  const pg = paged(list, 'approvalsLogs', 15);
  const rows = pg.items.map((x) => {
    const l=x.latest, req=x.req;
    return `<tr>
      <td class="num">${fmtDateTimeVN(req?.requestedAt || x.logs[x.logs.length-1]?.time || l.time)}</td>
      <td>${cell2(esc(req?.requestedByName || x.logs[x.logs.length-1]?.actorName || '—'), x.approvers.length ? `Đã duyệt: ${esc(x.approvers.join(', '))}` : approvalActionLabel(l.action))}</td>
      <td>${approvalDocTypeChip(l.docType)}</td>
      <td>${l.requestId ? `<span class="code">${esc(l.requestId)}</span>` : '—'}${l.docId ? `<div class="cell-sub">${esc(l.docId)}</div>` : ''}</td>
      <td>${req ? approvalStatusBadge(req.status) : esc(l.note || '—')}</td>
      <td class="right">${l.requestId ? rowActions([{act:'approval-view',data:`data-id="${esc(l.requestId)}"`,icon:'fa-eye',title:'Xem chi tiết phê duyệt'}]) : ''}</td>
    </tr>`;
  });
  return `<div class="card">
    <div class="toolbar">
      ${searchBox('approvalsLogs', 'Tìm theo mã chứng từ, người thực hiện, ghi chú…')}
      ${selectFilter('approvalsLogs', 'docType', APPROVAL_DOC_TYPE_LIST.map((dt) => [dt, APPROVAL_DOC_TYPES[dt].label]), 'Tất cả loại chứng từ')}
    </div>
    ${tableShell([{ t: 'Thời gian tạo', w: '160px' }, { t: 'Người đề nghị / Người duyệt' }, { t: 'Loại chứng từ' }, { t: 'Yêu cầu / Tham chiếu' }, { t: 'Trạng thái' }, {t:'',w:'70px'}], rows, { emptyTitle: 'Chưa có nhật ký phê duyệt' })}
    ${pagiHTML('approvalsLogs', pg, 'yêu cầu phê duyệt')}
  </div>`;
}

function approvalsOverdueView() {
  const list = DB.approvalRequests.filter(approvalIsOverdue).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  const rows = list.map((r) => {
    const lvl = ApprovalEngine.currentLevelOf(r);
    const canAct = ApprovalEngine.canAct(r);
    return `<tr>
      <td>${cell2(`<span class="code">${esc(r.id)}</span>`, approvalDocTypeChip(r.docType))}</td>
      <td>${cell2(esc(r.title), esc(r.requestedByName || ''))}</td>
      <td>${cell2(`Cấp ${lvl ? lvl.level : '—'}`, esc(approvalRoleName(lvl ? lvl.role : '')))}</td>
      <td class="num">${fmtDateTimeVN(r.dueAt)}</td>
      <td><span class="badge red">Quá hạn ${approvalOverdueHours(r)} giờ</span></td>
      <td>${rowActions([
        { act: 'approval-view', data: `data-id="${r.id}"`, icon: 'fa-eye', title: 'Xem chi tiết' },
        { act: 'approval-remind', data: `data-id="${r.id}"`, icon: 'fa-bell', title: 'Nhắc duyệt' },
        ...(canAct ? [{ act: 'approval-approve', data: `data-id="${r.id}"`, icon: 'fa-check', title: 'Duyệt ngay' }] : []),
      ])}</td>
    </tr>`;
  });
  return `<div class="card">${tableShell([
    { t: 'Mã yêu cầu' }, { t: 'Nội dung' }, { t: 'Đang chờ ở cấp' }, { t: 'Hạn duyệt', w: '160px' }, { t: 'Tình trạng' }, { t: '', w: '110px' },
  ], rows, { emptyTitle: 'Không có yêu cầu nào quá hạn', emptyDesc: 'Tất cả yêu cầu đang chờ duyệt vẫn còn trong hạn xử lý.' })}</div>`;
}

function approvalsSignatureView() {
  const mine = approvalMySignature();
  const myName = DB.currentUser?.name || '';
  return `<div class="grid g-21">
    <div class="card">
      <div class="card-head"><div><h3>Đăng ký chữ ký điện tử</h3><p>Chữ ký dùng để xác thực khi bạn phê duyệt các chứng từ</p></div></div>
      <div class="card-body">
        <div class="field"><label>Họ tên hiển thị trên chữ ký *</label><input class="inp" id="apSignName" value="${esc(mine ? mine.fullName : myName)}"></div>
        <label style="display:flex;gap:9px;align-items:flex-start;font-size:12.5px;color:var(--text-2);margin-bottom:14px">
          <input type="checkbox" id="apSignConsent" style="margin-top:3px" ${mine ? 'checked' : ''}>
          <span>Tôi xác nhận đây là chữ ký điện tử cá nhân, có giá trị pháp lý tương đương chữ ký tay khi phê duyệt chứng từ trên hệ thống Lê Nam ERP.</span>
        </label>
        <button class="btn btn-primary" data-act="approval-sign-save"><i class="fa-solid fa-signature"></i>Lưu chữ ký điện tử</button>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Chữ ký hiện tại</h3></div></div>
      <div class="card-body">
        ${mine ? `<div class="detail-list">
          <div class="detail-row"><span class="muted">Họ tên</span><strong>${esc(mine.fullName)}</strong></div>
          <div class="detail-row"><span class="muted">Mã xác thực</span><strong class="code">${esc(mine.code)}</strong></div>
          <div class="detail-row"><span class="muted">Đăng ký lúc</span><strong>${fmtDateTimeVN(mine.createdAt)}</strong></div>
          <div class="detail-row"><span class="muted">Mẫu chữ ký</span><strong style="font-style:italic">${esc(mine.preview)}</strong></div>
        </div>` : `<div class="empty" style="padding:20px"><div class="empty-ico"><i class="fa-solid fa-signature"></i></div><h4>Chưa đăng ký chữ ký</h4><p>Đăng ký chữ ký điện tử để có thể phê duyệt chứng từ trên hệ thống.</p></div>`}
      </div>
    </div>
  </div>`;
}

Views.approvals = function approvalsMainView() {
  // bootstrap() áp cache approval/purchase ngay phần đồng bộ trước await đầu tiên,
  // nên lần render đầu khi chuyển menu không còn bị một frame rỗng do data.js/cache cũ.
  try { ApprovalsAPI?.bootstrap?.(); } catch (_) {}
  try { PurchaseAPI?.bootstrap?.(); } catch (_) {}
  const tab = State.tab || 'dashboard';
  const bodyFn = {
    dashboard: approvalsDashboardView,
    pending: approvalsPendingView,
    workflows: approvalsWorkflowsView,
    logs: approvalsPendingView, // route cũ: gộp Nhật ký vào Việc cần duyệt
    overdue: approvalsOverdueView,
    signature: approvalsSignatureView,
  }[tab] || approvalsDashboardView;
  return `${pageHead('Quy trình phê duyệt', 'Phân quyền theo cấp · Lịch sử duyệt · Chữ ký điện tử · Cảnh báo quá hạn', approvalsHeadActions())}
    ${bodyFn()}`;
};

/* ---------------------------------------------------------------------------
 * 6. MODAL / FORM
 * -------------------------------------------------------------------------*/
function openApprovalNewForm() {
  const options = APPROVAL_DOC_TYPE_LIST.map((dt) => `<option value="${dt}">${esc(APPROVAL_DOC_TYPES[dt].label)}</option>`).join('');
  Modal.open({
    title: 'Tạo yêu cầu phê duyệt',
    sub: 'Yêu cầu sẽ được chuyển lần lượt qua các cấp theo quy trình đã cấu hình',
    body: `<div class="form-grid cols-2">
        <div class="field"><label>Loại chứng từ *</label><select class="inp" id="apNewType">${options}</select></div>
        <div class="field"><label>Mã tham chiếu (nếu có)</label><input class="inp" id="apNewDocId" placeholder="VD: YCM-2026-0046, DH-2026-0088…"></div>
        <div class="field" style="grid-column:1/-1"><label>Tiêu đề</label><input class="inp" id="apNewTitle" placeholder="Để trống sẽ tự sinh theo loại chứng từ"></div>
        <div class="field"><label>Giá trị liên quan (VND, hoặc % nếu là giảm giá)</label><input class="inp right num" id="apNewAmount" type="number" min="0" value="0"></div>
        <div class="field" style="grid-column:1/-1"><label>Ghi chú / lý do đề nghị</label><textarea class="inp" id="apNewNote" rows="3"></textarea></div>
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="approval-new-save"><i class="fa-solid fa-paper-plane"></i>Gửi yêu cầu</button>`,
  });
}

function approvalDetailBody(req) {
  const steps = (req.levels || []).map((l) => {
    const cls = l.status === 'APPROVED' ? 'done' : (l.status === 'REJECTED' ? 'done' : (req.currentLevel === l.level && req.status === 'PENDING' ? 'doing' : ''));
    return `<div class="tline-item ${cls}">
      <span class="tline-dot"><i class="fa-solid ${l.status === 'APPROVED' ? 'fa-check' : l.status === 'REJECTED' ? 'fa-xmark' : 'fa-clock'}"></i></span>
      <div class="tline-title">Cấp ${l.level} — ${esc(l.label)} (${esc(approvalRoleName(l.role))})</div>
      <div class="tline-sub">
        ${l.status === 'PENDING' ? 'Đang chờ duyệt' : `${l.status === 'APPROVED' ? 'Đã duyệt' : 'Từ chối'} bởi <b>${esc(l.approverName || '—')}</b> · ${fmtDateTimeVN(l.time)}`}
        ${l.note ? `<br>Ghi chú: ${esc(l.note)}` : ''}
        ${l.signature ? `<br><i style="font-style:italic">${esc(l.signature)}</i>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="detail-list" style="margin-bottom:16px">
      <div class="detail-row"><span class="muted">Loại chứng từ</span><strong>${approvalDocTypeChip(req.docType)}</strong></div>
      <div class="detail-row"><span class="muted">Mã tham chiếu</span><strong>${esc(req.docId || '—')}</strong></div>
      <div class="detail-row"><span class="muted">Người đề nghị</span><strong>${esc(req.requestedByName || '—')} · ${fmtDateTimeVN(req.requestedAt)}</strong></div>
      <div class="detail-row"><span class="muted">Giá trị</span><strong>${req.amount ? fmtVND(req.amount) : '—'}</strong></div>
      <div class="detail-row"><span class="muted">Hạn xử lý</span><strong>${fmtDateTimeVN(req.dueAt)}${approvalIsOverdue(req) ? ` <span class="badge red">Quá hạn ${approvalOverdueHours(req)} giờ</span>` : ''}</strong></div>
      <div class="detail-row"><span class="muted">Trạng thái</span><strong>${approvalStatusBadge(req.status)}</strong></div>
      <div class="detail-row"><span class="muted">Ghi chú đề nghị</span><strong>${esc(req.note || '—')}</strong></div>
    </div>
    <div class="form-sec-title"><i class="fa-solid fa-route"></i>Luồng phê duyệt</div>
    <div class="tline">${steps}</div>`;
}

function openApprovalDetail(id) {
  const req = DB.approvalRequests.find((r) => r.id === id);
  if (!req) return;
  const canAct = req.status === 'PENDING' && ApprovalEngine.canAct(req);
  Modal.open({
    title: `Chi tiết yêu cầu · ${req.id}`, sub: req.title, size: 'lg',
    body: approvalDetailBody(req),
    foot: `<button class="btn" data-act="modal-close">Đóng</button>
      ${canAct ? `<button class="btn btn-danger" data-act="approval-reject" data-id="${esc(req.id)}"><i class="fa-solid fa-xmark"></i>Từ chối</button>
        <button class="btn btn-primary" data-act="approval-approve" data-id="${esc(req.id)}"><i class="fa-solid fa-check"></i>Duyệt</button>` : ''}`,
  });
}

function openApprovalActionModal(id, kind) {
  const req = DB.approvalRequests.find((r) => r.id === id);
  if (!req) return;
  if (!ApprovalEngine.canAct(req)) { Toast.err('Không có quyền', 'Vai trò hiện tại không thuộc cấp duyệt hiện tại.'); return; }
  const lvl = ApprovalEngine.currentLevelOf(req);
  const mine = approvalMySignature();
  if (kind === 'approve') {
    Modal.open({
      title: `Duyệt yêu cầu · ${req.id}`, sub: `Cấp ${lvl.level} — ${lvl.label}`,
      body: `<div class="alert info" style="margin-bottom:12px;padding:11px 13px;border-radius:var(--r);background:var(--surface-2);border:1px solid var(--border);font-size:12.5px;color:var(--text-2)">${esc(req.title)}${req.amount ? ' · ' + fmtVND(req.amount) : ''}</div>
        <div class="field"><label>Ghi chú (không bắt buộc)</label><textarea class="inp" id="apNote" rows="2"></textarea></div>
        <div class="field"><label>Chữ ký điện tử</label><input class="inp" id="apSigText" value="${esc(mine ? approvalSignText(mine.fullName) : approvalSignText(DB.currentUser?.name || ''))}"></div>
        <label style="display:flex;gap:9px;align-items:flex-start;font-size:12.3px;color:var(--text-2)">
          <input type="checkbox" id="apSigConfirm" style="margin-top:3px">
          <span>Tôi xác nhận sử dụng chữ ký điện tử trên để phê duyệt chứng từ này.</span>
        </label>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="approval-approve-save" data-id="${esc(req.id)}" data-level="${esc(lvl.level)}"><i class="fa-solid fa-check"></i>Xác nhận duyệt</button>`,
    });
  } else {
    Modal.open({
      title: `Từ chối yêu cầu · ${req.id}`, sub: `Cấp ${lvl.level} — ${lvl.label}`,
      body: `<div class="field"><label>Lý do từ chối *</label><textarea class="inp" id="apReason" rows="3"></textarea></div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-danger" data-act="approval-reject-save" data-id="${esc(req.id)}" data-level="${esc(lvl.level)}"><i class="fa-solid fa-xmark"></i>Xác nhận từ chối</button>`,
    });
  }
}


function openApprovalLogDetail(id) {
  const log = (DB.approvalLogs || []).find((x) => x.id === id);
  if (!log) return;
  const req = (DB.approvalRequests || []).find((r) => r.id === log.requestId);
  Modal.open({
    title: `Chi tiết nhật ký · ${esc(log.id)}`,
    sub: `${approvalActionLabel(log.action)} · ${esc(log.actorName || '—')}`,
    body: `<div class="detail-list">
      <div class="detail-row"><span class="muted">Thời gian</span><strong>${fmtDateTimeVN(log.time)}</strong></div>
      <div class="detail-row"><span class="muted">Người thực hiện</span><strong>${esc(log.actorName || '—')}</strong></div>
      <div class="detail-row"><span class="muted">Vai trò</span><strong>${esc(log.roleName || approvalRoleName(log.roleId) || '—')}</strong></div>
      <div class="detail-row"><span class="muted">Hành động</span><strong>${esc(approvalActionLabel(log.action))}</strong></div>
      <div class="detail-row"><span class="muted">Cấp duyệt</span><strong>${log.level ? `Cấp ${log.level}` : '—'}</strong></div>
      <div class="detail-row"><span class="muted">Yêu cầu</span><strong>${log.requestId ? `<span class="code">${esc(log.requestId)}</span>` : '—'}</strong></div>
      <div class="detail-row"><span class="muted">Chứng từ</span><strong>${esc(log.docId || '—')}</strong></div>
      <div class="detail-row"><span class="muted">Ghi chú</span><strong>${esc(log.note || '—')}</strong></div>
      ${log.signature ? `<div class="detail-row"><span class="muted">Chữ ký điện tử</span><strong style="font-style:italic">${esc(log.signature)}</strong></div>` : ''}
    </div>`,
    foot: `<button class="btn" data-act="modal-close">Đóng</button>${req ? `<button class="btn btn-primary" data-act="approval-view" data-id="${esc(req.id)}"><i class="fa-solid fa-file-lines"></i>Xem yêu cầu</button>` : ''}`
  });
}

function openWorkflowEditForm(id) {
  const w = DB.approvalWorkflows.find((x) => x.id === id);
  if (!w) return;
  const canEdit = ['ROLE_ADMIN', 'ROLE_DIRECTOR'].includes((Auth.currentRole() || {}).id);
  const roleOptions = (sel) => DB.roles.map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const levelRows = (w.levels || []).map((l) => `<div class="ap-wf-level-line" style="display:grid;grid-template-columns:70px 1fr 1fr 160px 34px;gap:8px;margin-bottom:8px;align-items:center">
      <div class="cell-sub" style="text-align:center">Cấp ${l.level}</div>
      <select class="inp" name="role">${roleOptions(l.role)}</select>
      <input class="inp" name="label" value="${esc(l.label)}" placeholder="Diễn giải cấp duyệt">
      <input class="inp right num" name="minAmount" type="number" min="0" value="${Number(l.minAmount || 0)}" title="Áp dụng khi giá trị ≥ số này (0 = luôn áp dụng)">
      <button class="btn btn-sm" type="button" data-act="approval-wf-remove-level" ${!canEdit ? 'disabled' : ''}><i class="fa-solid fa-trash"></i></button>
    </div>`).join('');
  Modal.open({
    title: `Quy trình phê duyệt · ${(APPROVAL_DOC_TYPES[w.docType] || {}).label || w.docType}`,
    sub: canEdit ? 'Thêm/xóa cấp duyệt, đổi vai trò phụ trách và ngưỡng áp dụng' : 'Chỉ xem — không có quyền chỉnh sửa',
    size: 'lg',
    body: `<div class="form-grid cols-2" style="margin-bottom:10px">
        <div class="field"><label>Hạn xử lý (SLA — giờ)</label><input class="inp right num" id="apWfSla" type="number" min="1" value="${w.slaHours}" ${!canEdit ? 'disabled' : ''}></div>
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-sitemap"></i>Các cấp phê duyệt (theo thứ tự)</div>
      <div id="apWfLevels">${levelRows}</div>
      ${canEdit ? `<button class="btn btn-sm" type="button" data-act="approval-wf-add-level"><i class="fa-solid fa-plus"></i>Thêm cấp duyệt</button>` : ''}`,
    foot: `<button class="btn" data-act="modal-close">Đóng</button>${canEdit ? `<button class="btn btn-primary" data-act="approval-wf-save" data-id="${esc(w.id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu quy trình</button>` : ''}`,
  });
}

/* ---------------------------------------------------------------------------
 * 7. ACTIONS
 * -------------------------------------------------------------------------*/
Object.assign(Actions, {
  'approval-new': () => openApprovalNewForm(),
  'approval-new-save': async () => {
    const docType = $('#apNewType')?.value || '';
    const docId = $('#apNewDocId')?.value.trim() || '';
    const title = $('#apNewTitle')?.value.trim() || '';
    const amount = Number($('#apNewAmount')?.value || 0);
    const note = $('#apNewNote')?.value.trim() || '';
    const req = ApprovalEngine.create({ docType, docId, title, amount, note });
    if (!req) return;
    try {
      await persistApprovalServer(['approvalRequests','approvalLogs']);
    } catch (err) {
      DB.approvalRequests = (DB.approvalRequests || []).filter(r => r.id !== req.id);
      DB.approvalLogs = (DB.approvalLogs || []).filter(l => l.requestId !== req.id);
      Toast.err('Không lưu được yêu cầu duyệt', String(err?.message || err));
      return;
    }
    Modal.close();
    go('approvals', { tab: 'pending' });
    Toast.ok('Đã tạo yêu cầu phê duyệt', `${req.id} · Cấp duyệt đầu tiên: ${approvalRoleName(req.levels[0].role)}`);
  },
  'approval-view': (d) => openApprovalDetail(d.id),
  'approval-log-view': (d) => openApprovalLogDetail(d.id),
  'approval-approve': (d) => openApprovalActionModal(d.id, 'approve'),
  'approval-reject': (d) => openApprovalActionModal(d.id, 'reject'),
  'approval-approve-save': async (d) => {
    await ApprovalsAPI.flushPending();
    await ApprovalsAPI.ensureFresh(['requests'],{force:true});
    const live=(DB.approvalRequests || []).find(r=>r.id===d.id);
    if (live?.docType==='PR') approvalEnsurePrLevels(live,Q.purchase(live.docId));
    if (!live || live.status!=='PENDING' || (d.level && Number(ApprovalEngine.currentLevelOf(live)?.level)!==Number(d.level))) {
      Modal.close(); render(); Toast.warn('Yêu cầu đã được cập nhật','Vui lòng mở lại để xử lý đúng cấp hiện tại.'); return;
    }

    if (!$('#apSigConfirm')?.checked) { Toast.err('Chưa xác nhận chữ ký', 'Vui lòng tick xác nhận sử dụng chữ ký điện tử trước khi duyệt.'); return; }
    const note = $('#apNote')?.value.trim() || '';
    const signature = $('#apSigText')?.value.trim() || '';
    const req = (DB.approvalRequests || []).find(r => r.id === d.id);
    const reqSnapshot = req ? JSON.parse(JSON.stringify(req)) : null;
    const pr = req?.docType === 'PR' ? Q.purchase(req.docId) : null;
    const prSnapshot = pr ? JSON.parse(JSON.stringify(pr)) : null;
    if (!ApprovalEngine.approve(d.id, { note, signature })) return;
    // Phản hồi UI ngay; việc ghi server vẫn được await và rollback nếu thất bại.
    Modal.close(); render();
    try {
      await persistApprovalServer(['approvalRequests','approvalLogs','purchases']);
    } catch (err) {
      if (req && reqSnapshot) Object.assign(req, reqSnapshot);
      if (pr && prSnapshot) Object.assign(pr, prSnapshot);
      render();
      Toast.err('Không lưu được kết quả duyệt', String(err?.message || err));
      return;
    }
  },
  'approval-reject-save': async (d) => {
    await ApprovalsAPI.flushPending();
    await ApprovalsAPI.ensureFresh(['requests'],{force:true});
    const live=(DB.approvalRequests || []).find(r=>r.id===d.id);
    if (live?.docType==='PR') approvalEnsurePrLevels(live,Q.purchase(live.docId));
    if (!live || live.status!=='PENDING' || (d.level && Number(ApprovalEngine.currentLevelOf(live)?.level)!==Number(d.level))) {
      Modal.close(); render(); Toast.warn('Yêu cầu đã được cập nhật','Vui lòng mở lại để xử lý đúng cấp hiện tại.'); return;
    }

    const reason = $('#apReason')?.value.trim() || '';
    const req = (DB.approvalRequests || []).find(r => r.id === d.id);
    const reqSnapshot = req ? JSON.parse(JSON.stringify(req)) : null;
    const pr = req?.docType === 'PR' ? Q.purchase(req.docId) : null;
    const prSnapshot = pr ? JSON.parse(JSON.stringify(pr)) : null;
    if (!ApprovalEngine.reject(d.id, { reason })) return;
    Modal.close(); render();
    try {
      await persistApprovalServer(['approvalRequests','approvalLogs','purchases']);
    } catch (err) {
      if (req && reqSnapshot) Object.assign(req, reqSnapshot);
      if (pr && prSnapshot) Object.assign(pr, prSnapshot);
      render();
      Toast.err('Không lưu được kết quả từ chối', String(err?.message || err));
      return;
    }
  },
  'approval-cancel': (d) => {
    confirmBox({
      title: 'Hủy yêu cầu phê duyệt', icon: 'fa-ban', okText: 'Hủy yêu cầu',
      message: `Hủy yêu cầu <b>${esc(d.id)}</b>? Yêu cầu sẽ không thể tiếp tục xử lý.`,
      onOk: async () => {
        const req = (DB.approvalRequests || []).find(r => r.id === d.id);
        const snap = req ? JSON.parse(JSON.stringify(req)) : null;
        if (!ApprovalEngine.cancel(d.id, 'Người đề nghị hủy yêu cầu')) return;
        try { await persistApprovalServer(['approvalRequests','approvalLogs']); }
        catch (err) { if (req && snap) Object.assign(req, snap); Toast.err('Không lưu được trạng thái hủy', String(err?.message || err)); return; }
        render(); Toast.ok('Đã hủy yêu cầu', d.id);
      },
    });
  },
  'approval-remind': (d) => Toast.info('Đã gửi nhắc duyệt', `Thông báo nhắc duyệt cho yêu cầu ${d.id} đã được ghi nhận (bản demo).`),
  'approval-filter-pending': () => { const f = F('approvals'); f.status = 'PENDING'; f.docType = ''; State.page.approvals = 1; go('approvals', { tab: 'pending' }); },
  'approval-filter-overdue': () => go('approvals', { tab: 'overdue' }),
  'approval-filter-type': (d) => { const f = F('approvals'); f.status = 'PENDING'; f.docType = d.type; State.page.approvals = 1; go('approvals', { tab: 'pending' }); },
  'approval-wf-edit': (d) => openWorkflowEditForm(d.id),
  'approval-wf-add-level': () => {
    const host = $('#apWfLevels'); if (!host) return;
    const n = host.querySelectorAll('.ap-wf-level-line').length + 1;
    const roleOptions = DB.roles.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    const row = document.createElement('div');
    row.className = 'ap-wf-level-line';
    row.style.cssText = 'display:grid;grid-template-columns:70px 1fr 1fr 160px 34px;gap:8px;margin-bottom:8px;align-items:center';
    row.innerHTML = `<div class="cell-sub" style="text-align:center">Cấp ${n}</div><select class="inp" name="role">${roleOptions}</select><input class="inp" name="label" placeholder="Diễn giải cấp duyệt"><input class="inp right num" name="minAmount" type="number" min="0" value="0"><button class="btn btn-sm" type="button" data-act="approval-wf-remove-level"><i class="fa-solid fa-trash"></i></button>`;
    host.appendChild(row);
  },
  'approval-wf-remove-level': (d, el) => {
    const host = $('#apWfLevels');
    if (!host || host.querySelectorAll('.ap-wf-level-line').length <= 1) { Toast.warn('Cần ít nhất 1 cấp duyệt', 'Quy trình phải có tối thiểu một cấp phê duyệt.'); return; }
    el.closest('.ap-wf-level-line')?.remove();
    host.querySelectorAll('.ap-wf-level-line').forEach((row, i) => { row.querySelector('.cell-sub').textContent = 'Cấp ' + (i + 1); });
  },
  'approval-wf-save': (d) => {
    const w = DB.approvalWorkflows.find((x) => x.id === d.id); if (!w) return;
    const sla = Number($('#apWfSla')?.value || 24);
    const levels = [];
    document.querySelectorAll('.ap-wf-level-line').forEach((row, i) => {
      levels.push({
        level: i + 1,
        role: row.querySelector('[name="role"]')?.value || 'R01',
        label: row.querySelector('[name="label"]')?.value.trim() || `Cấp ${i + 1} duyệt`,
        minAmount: Number(row.querySelector('[name="minAmount"]')?.value || 0),
      });
    });
    if (!levels.length) { Toast.err('Thiếu cấp duyệt', 'Quy trình phải có ít nhất một cấp phê duyệt.'); return; }
    w.slaHours = sla > 0 ? sla : 24;
    w.levels = levels;
	if (typeof ApprovalsAPI !== 'undefined') ApprovalsAPI.scheduleCollections(['workflows']);
    if (typeof SystemAPI !== 'undefined') {
      SystemAPI.audit({
        module: 'APPROVALS', entityType: 'APPROVAL_WORKFLOW', entityId: w.id, action: 'UPDATE',
        description: `${DB.currentUser?.name || 'Người dùng'} cập nhật quy trình phê duyệt ${(APPROVAL_DOC_TYPES[w.docType] || {}).label || w.docType}`,
        newData: { slaHours: w.slaHours, levels: w.levels },
      }).catch(() => {});
    }
    Modal.close(); render();
    Toast.ok('Đã lưu quy trình phê duyệt', `${(APPROVAL_DOC_TYPES[w.docType] || {}).label || w.docType}`);
  },
  'approval-sign-save': () => {
    const fullName = $('#apSignName')?.value.trim() || '';
    if (!fullName) { Toast.err('Thiếu họ tên', 'Vui lòng nhập họ tên hiển thị trên chữ ký.'); return; }
    if (!$('#apSignConsent')?.checked) { Toast.err('Chưa xác nhận', 'Vui lòng tick xác nhận trước khi lưu chữ ký điện tử.'); return; }
    const uid = DB.currentUser?.userId || DB.currentUser?.id || '';
    let sig = (DB.eSignatures || []).find((s) => s.userId === uid);
    const code = approvalDjb2(fullName + uid + Date.now());
    const preview = approvalSignText(fullName);
    const isNew = !sig;
    if (sig) { Object.assign(sig, { fullName, code, preview }); }
    else { sig = { userId: uid, fullName, code, preview, createdAt: new Date().toISOString() }; DB.eSignatures.unshift(sig); }
    if (typeof ApprovalsAPI !== 'undefined') ApprovalsAPI.scheduleCollections(['signatures']);
    if (typeof SystemAPI !== 'undefined') {
      SystemAPI.audit({
        module: 'APPROVALS', entityType: 'E_SIGNATURE', entityId: uid, action: isNew ? 'CREATE' : 'UPDATE',
        description: `${DB.currentUser?.name || 'Người dùng'} ${isNew ? 'đăng ký' : 'cập nhật'} chữ ký điện tử: ${fullName}`,
      }).catch(() => {});
    }
    render();
    Toast.ok('Đã lưu chữ ký điện tử', fullName);
  },
});

/* ---------------------------------------------------------------------------
 * 8. NỐI PR / PO / THANH TOÁN VÀO QUY TRÌNH PHÊ DUYỆT NHIỀU CẤP
 * ----------------------------------------------------------------------------
 * Nguyên tắc: nút "Duyệt" gốc KHÔNG còn đổi trạng thái ngay — nó chỉ TẠO
 * (hoặc mở lại) một yêu cầu trong ApprovalEngine. Việc đổi trạng thái thật
 * (PR -> mh_da_duyet, PO -> APPROVED, ghi nhận thanh toán vào
 * DB.supplierPayments…) chỉ chạy trong onApproved — tức là SAU KHI đã đi hết
 * mọi cấp duyệt đã cấu hình. Nếu bị từ chối ở bất kỳ cấp nào, onRejected sẽ
 * đưa chứng từ về đúng trạng thái "đã từ chối" như luồng cũ.
 *
 * File này ghi đè (override) 3 action đã có sẵn trong app.js:
 *   Actions['pr-approve-action'], Actions['supplier-pay-save']
 * Việc override chỉ có tác dụng nếu mod-approvals.js được nạp SAU app.js
 * (xem mục 9 — hướng dẫn thứ tự nạp — ngay bên dưới).
 *
 * Muốn TẮT phần tích hợp này (chỉ giữ quy trình phê duyệt độc lập ở mục
 * "Tạo yêu cầu phê duyệt" như trước, không đụng vào PR/PO/Thanh toán) thì
 * đổi APPROVAL_INTEGRATE_PURCHASE_FLOW thành false.
 * -------------------------------------------------------------------------*/
const APPROVAL_INTEGRATE_PURCHASE_FLOW = true;

if (APPROVAL_INTEGRATE_PURCHASE_FLOW) {

  /* ---- 8.1 Đề nghị mua hàng (PR) ------------------------------------- */
  ApprovalEngine.registerHandler('PR', {
    onApproved(req) {
      const p = Q.purchase(req.docId);
      if (!p || !['mh_cho_duyet','PENDING_APPROVAL'].includes(p.status)) return; // chỉ áp dụng chu kỳ đang chờ
      const lastLvl = req.levels[req.levels.length - 1];
      p.status = 'mh_da_duyet';
      p.approvedBy = lastLvl.approverId;
      p.approvedByUserId = lastLvl.approverId;
      p.approvedByName = lastLvl.approverName;
      p.approvedAt = lastLvl.time;
      p.approvalRequestId = req.id;
      p.approvalWorkflowRequestId = req.id;
      p.approvalLevels = JSON.parse(JSON.stringify(req.levels));
      p.approvalCurrentLevel = '';
      p.approvalCurrentRole = '';
      p.approvalCurrentLabel = '';
      if (typeof SystemAPI !== 'undefined') {
        SystemAPI.audit({ module: 'PURCHASE', entityType: 'PURCHASE_REQUEST', entityId: p.id, action: 'APPROVE', description: `${lastLvl.approverName} phê duyệt ${p.id} qua quy trình ${req.levels.length} cấp`, newData: { status: p.status } });
      }
      DB.purchaseApprovals.unshift({ id: nextCode('PA-', DB.purchaseApprovals), prId: p.id, approverId: lastLvl.approverId, time: DB.today + ' 09:00', action: 'approve', prevStatus: 'mh_cho_duyet', nextStatus: 'mh_da_duyet', note: 'Đã phê duyệt qua quy trình phê duyệt nhiều cấp' });

      // IMPORTANT: mod-approvals override action duyệt sau khi PurchaseAPI đã wrap
      // các action Purchase, vì vậy thay đổi PR ở đây phải tự đánh dấu dirty +
      // đồng bộ KIO. Nếu không, đổi tài khoản/refresh sẽ nạp snapshot server cũ
      // và PR quay lại Chờ duyệt.
      if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.scheduleCollections) {
        PurchaseAPI.scheduleCollections(['purchases'], 0);
      }

      F('purchases').prId = p.id;
      render();
    },
    onRejected(req) {
      const p = Q.purchase(req.docId);
      if (!p || p.status !== 'mh_cho_duyet') return;
      const rejectedLvl = req.levels.find((l) => l.status === 'REJECTED');
      p.status = 'mh_tu_choi';
      p.rejectedByUserId = rejectedLvl?.approverId || '';
      p.rejectedByName = rejectedLvl?.approverName || '';
      p.rejectedAt = rejectedLvl?.time || new Date().toISOString();
      p.approvalCurrentLevel = '';
      p.approvalCurrentRole = '';
      p.approvalCurrentLabel = '';
      DB.purchaseApprovals.unshift({ id: nextCode('PA-', DB.purchaseApprovals), prId: p.id, approverId: rejectedLvl?.approverId || '', time: DB.today + ' 09:00', action: 'reject', prevStatus: 'mh_cho_duyet', nextStatus: 'mh_tu_choi', note: rejectedLvl?.note || '' });
      if (typeof SystemAPI !== 'undefined') SystemAPI.audit({ module: 'PURCHASE', entityType: 'PURCHASE_REQUEST', entityId: p.id, action: 'REJECT', description: `${rejectedLvl?.approverName || ''} từ chối ${p.id}: ${rejectedLvl?.note || ''}`, newData: { status: p.status } });
      if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.scheduleCollections) {
        PurchaseAPI.scheduleCollections(['purchases'], 0);
      }
      render();
    },
  });

  (function overridePrApprove() {
    const originalPrApprove = Actions['pr-approve-action'];
    Actions['pr-approve-action'] = async function (d, el, e) {
      const p = Q.purchase(d.id);
      if (!p) return;
      // Nhánh trạng thái legacy giữ nguyên.
      if (p.status === 'PENDING_APPROVAL') { return originalPrApprove.call(this, d, el, e); }
      if (p.status !== 'mh_cho_duyet') { Toast.err('Không thể duyệt', 'Đề nghị mua hàng không ở trạng thái Chờ duyệt.'); return; }

      const amount = approvalPrAmount(p);
      let req = ApprovalEngine.pendingFor('PR', p.id);
      let created = false;
      if (!req) {
        req = ApprovalEngine.create({ docType: 'PR', docId: p.id, title: `Đề nghị mua hàng ${p.id}`, amount, note: p.reason });
        if (!req) return;
        p.approvalRequestId = req.id;
        created = true;
      } else {
        approvalEnsurePrLevels(req, p);
      }

      // Với PR >= 50 triệu, request bắt buộc phải có cấp Ban giám đốc.
      if (amount >= 50000000 && !(req.levels || []).some(l => l.role === 'ROLE_DIRECTOR')) {
        Toast.err('Thiếu cấp duyệt Ban giám đốc', `${p.id} có giá trị ${fmtVND(amount)} nhưng chưa tạo được cấp duyệt 2. Vui lòng thử lại.`);
        return;
      }

      try {
        await persistApprovalServer(['approvalRequests','approvalLogs','purchases']);
      } catch (err) {
        if (created) {
          DB.approvalRequests = (DB.approvalRequests || []).filter(r => r.id !== req.id);
          DB.approvalLogs = (DB.approvalLogs || []).filter(l => l.requestId !== req.id);
          if (p.approvalRequestId === req.id) p.approvalRequestId = '';
        }
        Toast.err('Không lưu được yêu cầu duyệt', String(err?.message || err));
        return;
      }

      Modal.close();
      go('approvals', { tab: 'pending' });
      const lvl = ApprovalEngine.currentLevelOf(req);
      Toast.info('Đã chuyển sang quy trình phê duyệt', `${req.id} · ${fmtVND(amount)} · Đang chờ: ${approvalRoleName(lvl.role)}`);
    };
  })();

  /* Nút "Từ chối" cũ của PR vẫn thao tác trực tiếp trên PR — nếu PR đó đang
   * có một yêu cầu phê duyệt PENDING thì hủy luôn yêu cầu đó để tránh treo
   * một yêu cầu không còn ý nghĩa trong danh sách "Việc cần duyệt". */
  (function overridePrRejectSave() {
    const originalPrRejectSave = Actions['pr-reject-save'];
    Actions['pr-reject-save'] = function (d, el, e) {
      const before = Q.purchase(d.id)?.status;
      const result = originalPrRejectSave.call(this, d, el, e);
      const p = Q.purchase(d.id);
      if (p && before === 'mh_cho_duyet' && p.status === 'mh_tu_choi') {
        const req = ApprovalEngine.pendingFor('PR', p.id);
        if (req) ApprovalEngine.cancel(req.id, 'PR bị từ chối trực tiếp ngoài quy trình nhiều cấp');
      }
      return result;
    };
  })();

  /* ---- 8.2 Đơn đặt hàng (PO) ------------------------------------------ */
  /* PO không dùng quy trình phê duyệt riêng. Sau khi PR đã được duyệt và
   * Mua hàng xác nhận báo giá/chọn NCC, PO đi thẳng vào READY_TO_SEND.
   * Bộ phận Mua hàng có thể Gửi NCC hoặc Hủy PO theo trạng thái hợp lệ. */

  /* ---- 8.3 Thanh toán nhà cung cấp ------------------------------------ */
  /* Kế toán là bộ phận ghi nhận thanh toán. Không ép PAYMENT đi qua một vòng
   * phê duyệt khác, vì chính role Kế toán lại không có module Approvals và điều
   * đó tạo lỗi "Không có quyền truy cập". Action supplier-pay-save đã được
   * PurchaseAPI.wrapActions bọc để persistence KIO và app.js tự ghi sổ ngân hàng.
   * Nếu sau này cần ngưỡng thanh toán lớn phải duyệt, hãy thiết kế workflow riêng
   * có role người duyệt khác Kế toán thay vì chặn mọi khoản thanh toán. */

}

/* ============================================================================
 * 9. HƯỚNG DẪN TÍCH HỢP VÀO DỰ ÁN (THỨ TỰ NẠP SCRIPT LÀ ĐIỂM QUAN TRỌNG NHẤT)
 * ----------------------------------------------------------------------------
 * QUAN TRỌNG — SỬA LẠI so với hướng dẫn trước: file này PHẢI được nạp SAU
 * js/app.js, KHÔNG phải trước. Lý do: biến `Actions` được khai báo bằng
 * `const Actions = {...}` bên trong app.js; các dòng `Object.assign(Actions,
 * ...)` và việc override Actions['pr-approve-action'] / ['po-approve-action']
 * / ['supplier-pay-save'] ở mục 7 và mục 8 phía trên chỉ chạy được khi
 * `Actions` đã tồn tại. Nếu nạp trước app.js sẽ bị lỗi
 * "Cannot access 'Actions' before initialization" và toàn bộ app không chạy.
 *
 * 1) Lưu file này vào: js/modules/mod-approvals.js
 * 2) Trong index.html, thêm đúng MỘT dòng — đặt SAU dòng nạp js/app.js
 *    (đặt cạnh các file cùng kiểu "gắn thêm sau app.js" đã có sẵn trong dự án
 *    là js/modules/mod-accounting.js, mod-logistics.js, mod-rnd-actions.js):
 *
 *      <script src="js/app.js?v=20260915-lg46"></script>
 *
 *      <script src="js/modules/mod-approvals.js?v=20260930-unifiedapproval1"></script>
 *      <script src="js/modules/mod-accounting.js?v=20260915-bomflow1"></script>
 *      <script src="js/modules/mod-logistics.js?v=20260915-lg46"></script>
 *      <script src="js/modules/mod-rnd-actions.js?v=20260915-rnd1"></script>
 *
 *    (Thứ tự giữa mod-approvals.js và 3 file mod-accounting/mod-logistics/
 *    mod-rnd-actions không quan trọng — chúng độc lập với nhau. Chỉ cần cả 4
 *    file này nằm SAU app.js.)
 * 3) Không cần sửa gì thêm ở app.core.js — mục "Phê duyệt" đã có sẵn trong
 *    NAV với đúng 6 tab con: Tổng quan / Việc cần duyệt / Quy trình phê
 *    duyệt / Nhật ký phê duyệt / Cảnh báo quá hạn / Chữ ký điện tử.
 * 4) Phạm vi đã nối sẵn (mục 8, bật bằng APPROVAL_INTEGRATE_PURCHASE_FLOW):
 *      - Nút "Duyệt" của Đề nghị mua hàng (PR) → tạo/mở yêu cầu phê duyệt
 *        thay vì đổi trạng thái ngay; PR chỉ chuyển "Đã duyệt" sau khi xong
 *        hết các cấp. Từ chối ở PR module cũ cũng tự hủy yêu cầu đang treo.
 *      - Nút "Duyệt" của Đơn đặt hàng (PO) → tương tự PR.
 *      - Nút lưu Thanh toán NCC (modal "Ghi nhận thanh toán" ở PO) → không
 *        ghi thẳng vào DB.supplierPayments nữa mà tạo yêu cầu duyệt; số
 *        tiền/PO/hình thức thanh toán được lưu tạm trong `req.payload` và
 *        chỉ thực sự cộng vào công nợ NCC khi duyệt xong tất cả các cấp.
 *    Các luồng khác (Giảm giá, Chi tiền, Hủy đơn hàng, Xuất kho đặc biệt,
 *    Sản xuất ngoài định mức, Đổi trả hàng) chưa có nút bấm riêng trong các
 *    module tương ứng của dự án hiện tại, nên vẫn dùng qua nút chung "Tạo
 *    yêu cầu phê duyệt" ở màn Phê duyệt. Muốn nối trực tiếp vào một nút cụ
 *    thể (ví dụ nút "Hủy đơn hàng" trong CRM), làm đúng khuôn mẫu ở mục 8:
 *    lưu action gốc lại, viết action mới gọi ApprovalEngine.create(...) thay
 *    vì đổi trạng thái ngay, rồi ApprovalEngine.registerHandler(docType, {
 *    onApproved, onRejected }) để thực thi thay đổi thật khi duyệt xong.
 * ==========================================================================*/
