/* ============================================================================
 * SYSTEM API — AUTH / ROLE / PERMISSION / AUDIT
 * ----------------------------------------------------------------------------
 * Không thay đổi business logic nghiệp vụ. File này chỉ cung cấp identity,
 * phân quyền truy cập và dấu vết thao tác cho các action hiện có.
 *
 * Nguyên tắc:
 *   - DB.employees: toàn bộ nhân sự (không đồng nghĩa có tài khoản ERP).
 *   - DB.users: chỉ actor thực sự đăng nhập/thao tác trên ERP.
 *   - Mỗi actor có username riêng để Audit biết chính xác ai tạo/duyệt.
 * ========================================================================== */
const SystemAPI = (() => {
  const TABLES = KIO_CONFIG.systemTables;
  const CACHE_KEY = KIO_CONFIG.storageKeys.systemCache;
  const SESSION_KEY = KIO_CONFIG.storageKeys.authSession;

  const ROLE_DEFS = [
    // Quyền theo nguyên tắc tối thiểu: mỗi tài khoản nghiệp vụ chỉ thấy đúng
    // phân hệ cần làm việc. Admin/Giám đốc là hai vai trò duy nhất có phạm vi rộng.
    { id:'ROLE_ADMIN', name:'Quản trị hệ thống', permissions:['*'], modules:{'*':'*'} },
    { id:'ROLE_DIRECTOR', name:'Ban giám đốc', permissions:['VIEW_ALL','PURCHASE_VIEW','INVENTORY_VIEW','QC_VIEW','PRODUCTION_VIEW','CRM_VIEW','ACCOUNTING_VIEW','HR_VIEW','MAINTENANCE_VIEW','APPROVE_HIGH_LEVEL','PAYMENT_APPROVE','VIEW_AUDIT'], modules:{dashboard:'*',purchases:'*',warehouse:'*',production:'*',subcontracting:'*',restaurant:'*',accounting:'*',hr:'*',quality:'*',maintenance:'*',crm:'*',logistics:'*',rnd:'*',approvals:'*',bi:'*'} },

    { id:'ROLE_PURCHASE', name:'Mua hàng', permissions:['PURCHASE_VIEW','PURCHASE_PR_CREATE','PURCHASE_PO_CREATE','PURCHASE_PO_SEND','PURCHASE_SUPPLIER_MANAGE','PURCHASE_REPORT','INVENTORY_VIEW'], modules:{purchases:'*',warehouse:['inventory']} },
    // Trưởng phòng Mua hàng KẾ THỪA toàn bộ quyền nghiệp vụ của Mua hàng và
    // có thêm quyền duyệt PR. Trưởng phòng vẫn có thể nhập báo giá, chọn NCC,
    // tạo/gửi/hủy PO khi cần; nhân viên Mua hàng cũng làm các bước này bình thường.
    { id:'ROLE_PURCHASE_MANAGER', name:'Trưởng phòng Mua hàng', permissions:['PURCHASE_VIEW','PURCHASE_PR_CREATE','PURCHASE_PO_CREATE','PURCHASE_PO_SEND','PURCHASE_SUPPLIER_MANAGE','PURCHASE_REPORT','INVENTORY_VIEW','PURCHASE_PR_APPROVE'], modules:{purchases:'*',warehouse:['inventory'],approvals:'*'} },
    { id:'ROLE_WAREHOUSE', name:'Kho', permissions:['INVENTORY_VIEW','INVENTORY_OPERATE','INVENTORY_ADJUST','PURCHASE_VIEW','CRM_VIEW'], modules:{warehouse:'*',purchases:['po'],crm:['orders'],bi:['warehouse']} },
    { id:'ROLE_PRODUCTION', name:'Sản xuất', permissions:['PRODUCTION_VIEW','PRODUCTION_OPERATE','PRODUCTION_APPROVE','INVENTORY_VIEW','PURCHASE_PR_CREATE'], modules:{production:'*',warehouse:['inventory'],purchases:['pr'],bi:['production']} },
    { id:'ROLE_QC', name:'QC / QA', permissions:['QC_VIEW','QC_INSPECT','QC_APPROVE','INVENTORY_VIEW'], modules:{quality:'*',warehouse:['inventory','batches','defects','receipts']} },
    // Kinh doanh làm toàn bộ nghiệp vụ bán hàng hằng ngày nhưng KHÔNG duyệt.
    // Trưởng phòng Kinh doanh kế thừa toàn bộ quyền Kinh doanh và có thêm quyền duyệt,
    // tương tự mô hình Mua hàng / Trưởng phòng Mua hàng.
    { id:'ROLE_SALES', name:'Kinh doanh', permissions:['CRM_VIEW','CRM_OPERATE','CRM_DELETE_CUSTOMER','SALES_ORDER_OPERATE'], modules:{crm:'*',bi:['sales']} },
    { id:'ROLE_SALES_MANAGER', name:'Trưởng phòng Kinh doanh', permissions:['CRM_VIEW','CRM_OPERATE','CRM_DELETE_CUSTOMER','SALES_ORDER_OPERATE','SALES_APPROVE'], modules:{crm:'*',approvals:'*',bi:['sales']} },
    { id:'ROLE_ACCOUNTING', name:'Kế toán', permissions:['ACCOUNTING_VIEW','ACCOUNTING_OPERATE','PAYMENT_APPROVE','PURCHASE_VIEW'], modules:{accounting:'*',purchases:['po','debts','suppliers'],crm:['debts','customers'],bi:['finance']} },
    { id:'ROLE_HR', name:'Nhân sự', permissions:['HR_VIEW','HR_OPERATE'], modules:{hr:'*',bi:['hr']} },
    { id:'ROLE_MAINTENANCE', name:'Bảo trì', permissions:['MAINTENANCE_VIEW','MAINTENANCE_OPERATE'], modules:{maintenance:'*'} },
    { id:'ROLE_LOGISTICS', name:'Logistics', permissions:['LOGISTICS_VIEW','LOGISTICS_OPERATE','CRM_VIEW'], modules:{logistics:'*',crm:['orders']} },
    { id:'ROLE_RESTAURANT', name:'Quản lý Nhà hàng / Cửa hàng', permissions:['RESTAURANT_VIEW','RESTAURANT_OPERATE','INVENTORY_VIEW'], modules:{restaurant:'*',bi:['restaurant']} },
    { id:'ROLE_RESTAURANT_STAFF', name:'Nhân viên cửa hàng', permissions:['RESTAURANT_VIEW','RESTAURANT_OPERATE','INVENTORY_VIEW'], modules:{restaurant:['dashboard','pos','tablet','qr','kitchen','orders','store_stock','replenishment','issue','revenue']} },
    { id:'ROLE_SUBCONTRACT', name:'Gia công', permissions:['SUBCONTRACT_VIEW','SUBCONTRACT_OPERATE','INVENTORY_VIEW'], modules:{subcontracting:'*',warehouse:['inventory']} },
    { id:'ROLE_RND', name:'R&D', permissions:['RND_VIEW','RND_OPERATE','INVENTORY_VIEW'], modules:{rnd:'*',warehouse:['inventory']} },
  ];

  // Tài khoản demo cố ý đặt theo PHÒNG BAN thay vì tên cá nhân để dễ nhớ,
  // dễ trình bày và dễ kiểm tra phân quyền. Tất cả dùng mật khẩu demo 123456.
  const ACTORS = [
    { id:'USR-ADMIN',       empId:'',       username:'admin',      fullName:'Quản trị hệ thống',      dept:'Hệ thống',              roleId:'ROLE_ADMIN' },
    { id:'USR-DIRECTOR',    empId:'NV-001', username:'giamdoc',    fullName:'Hà Minh Tú',             dept:'Ban giám đốc',          roleId:'ROLE_DIRECTOR' },
    { id:'USR-PURCHASE',    empId:'NV-020', username:'muahang',    fullName:'Tạ Văn Lợi',             dept:'Mua hàng',               roleId:'ROLE_PURCHASE' },
    { id:'USR-PURCHASE-MGR',empId:'NV-021', username:'truongmuahang',fullName:'Võ Thị Kim Ngân',          dept:'Mua hàng',               roleId:'ROLE_PURCHASE_MANAGER' },
    { id:'USR-WAREHOUSE',   empId:'NV-018', username:'kho',        fullName:'Cao Văn Thắng',          dept:'Kho vận',                roleId:'ROLE_WAREHOUSE' },
    { id:'USR-PRODUCTION',  empId:'NV-005', username:'sanxuat',    fullName:'Phạm Quốc Bảo',          dept:'Sản xuất',               roleId:'ROLE_PRODUCTION' },
    { id:'USR-QC',          empId:'NV-015', username:'qc',         fullName:'Ngô Thị Lan',            dept:'QC/ATTP',                roleId:'ROLE_QC' },
    { id:'USR-SALES',       empId:'NV-003', username:'kinhdoanh',  fullName:'Trần Thu Hà',            dept:'Kinh doanh',             roleId:'ROLE_SALES' },
    { id:'USR-SALES-MGR',   empId:'NV-002', username:'truongkinhdoanh', fullName:'Nguyễn Đức Anh',     dept:'Kinh doanh',             roleId:'ROLE_SALES_MANAGER' },
    { id:'USR-ACCOUNTING',  empId:'NV-022', username:'ketoan',     fullName:'Chu Thị Thanh Thảo',     dept:'Kế toán',                roleId:'ROLE_ACCOUNTING' },
    { id:'USR-HR',          empId:'NV-024', username:'nhansu',     fullName:'Mai Thị Hồng Nhung',     dept:'Hành chính - Nhân sự',   roleId:'ROLE_HR' },
    { id:'USR-MAINTENANCE', empId:'NV-025', username:'baotri',     fullName:'Lâm Văn Trí',            dept:'Bảo trì - Vệ sinh',      roleId:'ROLE_MAINTENANCE' },
    { id:'USR-LOGISTICS',   empId:'NV-019', username:'logistics',  fullName:'Đinh Thị Hương',         dept:'Kho vận',                roleId:'ROLE_LOGISTICS' },
    { id:'USR-RESTAURANT',  empId:'',       username:'cuahang',    fullName:'Quản lý Nhà hàng & Cửa hàng', dept:'Nhà hàng & Cửa hàng', roleId:'ROLE_RESTAURANT' },
    { id:'USR-STORE-LVV',   empId:'',       username:'cuahang_lvv', fullName:'Nhân viên cửa hàng Lê Văn Việt', dept:'Nhà hàng & Cửa hàng', roleId:'ROLE_RESTAURANT_STAFF', storeId:'STORE-TEST-001' },
    { id:'USR-STORE-PXL',   empId:'',       username:'cuahang_pxl', fullName:'Nhân viên cửa hàng Phan Xích Long', dept:'Nhà hàng & Cửa hàng', roleId:'ROLE_RESTAURANT_STAFF', storeId:'STORE-TEST-002' },
    { id:'USR-STORE-BD',    empId:'',       username:'cuahang_bd', fullName:'Nhân viên cửa hàng Dĩ An', dept:'Nhà hàng & Cửa hàng', roleId:'ROLE_RESTAURANT_STAFF', storeId:'STORE-TEST-003' },
    { id:'USR-SUBCONTRACT', empId:'',       username:'giacong',    fullName:'Điều phối gia công',     dept:'Gia công',               roleId:'ROLE_SUBCONTRACT' },
    { id:'USR-RND',         empId:'',       username:'rnd',        fullName:'Nhân viên R&D',           dept:'R&D',                    roleId:'ROLE_RND' },
  ];

  const PERMISSIONS = [...new Set(ROLE_DEFS.flatMap(r => r.permissions).filter(p => p !== '*'))]
    .map(code => ({ id:`PERM-${code}`, code, name:code }));
  const ROLE_PERMISSIONS = ROLE_DEFS.flatMap(role => role.permissions.filter(p => p !== '*').map(code => ({ id:`${role.id}::${code}`, roleId:role.id, permissionCode:code })));

  const nowText = () => {
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
  }

  async function buildDefaultUsers() {
    const hash = await sha256('123456');
    return ACTORS.map(u => ({ ...u, name:u.fullName, passwordHash:hash, state:'active', lastLogin:'', createdAt:'2026-09-11' }));
  }

  function cacheWrite(data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) {} }
  const SYSTEM_REFRESH_TTL = 5 * 60 * 1000;
  function cacheRead() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) { return null; } }

  async function loadTable(key) { return KioStore.listCollection(TABLES[key]); }
  async function syncTable(key, rows) { return KioStore.syncCollection(TABLES[key], rows); }

  // Tài khoản KHÔNG nằm trong danh sách actor demo (ACTORS) — ví dụ tài khoản
  // được tạo kèm hồ sơ nhân sự tại màn Nhân sự (mod-hr.js: DB.users.push(...)).
  function isCustomAccount(u, defaultIds) { return !defaultIds.has(u.id); }

  // Trộn danh sách actor mặc định (ACTORS) với dữ liệu users thật (server hoặc
  // cache): actor mặc định giữ nguyên username/role/dept theo code (đây là bộ
  // phân quyền chuẩn, không cho dữ liệu cũ ghi đè), chỉ kế thừa state/lastLogin/
  // passwordHash đã lưu. Tài khoản KHÔNG thuộc actor mặc định (tài khoản tạo
  // qua hồ sơ nhân sự) được giữ nguyên như trên server/cache — trước bản này,
  // bootstrap()/refreshFromServer() luôn dựng lại DB.users CHỈ từ ACTORS nên
  // mọi tài khoản mới tạo bị "biến mất" ngay khi F5, dù đã ghi lên KIO.
  function mergeUsers(defaults, source) {
    const byId = new Map((source || []).map(u => [u.id, u]));
    const defaultIds = new Set(defaults.map(d => d.id));
    const mergedDefaults = defaults.map(d => {
      const old = byId.get(d.id) || {};
      return { ...d, state: old.state || d.state, lastLogin: old.lastLogin || '', passwordHash: old.passwordHash || d.passwordHash };
    });
    const customUsers = (source || []).filter(u => isCustomAccount(u, defaultIds));
    return [...mergedDefaults, ...customUsers];
  }

  function applyUsers(users, auditLogs) {
    DB.users = users;
    DB.roles = ROLE_DEFS.map(r => ({...r, perms:r.permissions || [], desc:r.desc || r.name, users:users.filter(u => u.roleId === r.id).length}));
    DB.auditLogs = Array.isArray(auditLogs) ? auditLogs : [];
  }

  let bootUsersRefresh = null;

  async function bootstrap() {
    const defaults = await buildDefaultUsers();
    const cache = cacheRead();

    // PERFORMANCE: dựng AUTH ngay từ actor mặc định + cache local. Màn Login
    // không phải chờ list lenam_users từ server. Việc đọc server vẫn chạy nền
    // để giữ nguyên tài khoản tạo từ Nhân sự và trạng thái khóa/mở tài khoản.
    const cachedUsers = Array.isArray(cache?.users) ? cache.users : [];
    const auditLogs = Array.isArray(cache?.auditLogs) ? cache.auditLogs : [];
    const initialUsers = mergeUsers(defaults, cachedUsers);
    applyUsers(initialUsers, auditLogs);

    bootUsersRefresh = (async () => {
      try {
        const remoteUsers = await KioStore.listCollection(TABLES.users);
        const source = (Array.isArray(remoteUsers) && remoteUsers.length) ? remoteUsers : cachedUsers;
        const users = mergeUsers(defaults, source);
        applyUsers(users, auditLogs);
        cacheWrite({users, roles:ROLE_DEFS, auditLogs, syncedAt:Date.now()});
        if (!(Array.isArray(remoteUsers) && remoteUsers.length)) {
          syncTable('users', users).catch(err => console.warn('[SystemAPI] Seed actor demo lần đầu thất bại:', err));
        }
        return true;
      } catch (err) {
        console.warn('[SystemAPI] Không đọc được lenam_users ở nền; dùng cache:', err);
        return false;
      }
    })();
    return true;
  }

  // Chỉ gọi khi thật sự cần làm mới cấu hình người dùng/quyền (ví dụ màn
  // Quản trị người dùng), không tự chạy mỗi lần login.
  async function refreshFromServer() {
    const defaults = await buildDefaultUsers();
    const [remoteUsers, remoteRoles, remotePerms, remoteRP, remoteAudit] = await Promise.all([
      loadTable('users'), loadTable('roles'), loadTable('permissions'), loadTable('rolePermissions'), loadTable('auditLogs')
    ]);

    // Cùng logic trộn với bootstrap(): giữ lại tài khoản tạo qua hồ sơ nhân sự
    // (không có trong ACTORS) thay vì chỉ dựng lại từ danh sách actor demo.
    const mergedUsers = mergeUsers(defaults, remoteUsers || []);
    const mergedRoles = ROLE_DEFS.map(d => ({ ...d }));
    const mergedAudit = Array.isArray(remoteAudit) ? remoteAudit : [];

    applyUsers(mergedUsers, mergedAudit);
    cacheWrite({users:mergedUsers, roles:mergedRoles, auditLogs:mergedAudit, syncedAt:Date.now()});

    const seeds = [];
    if (!(remoteUsers || []).length) seeds.push(syncTable('users', mergedUsers));
    if (!(remoteRoles || []).length) seeds.push(syncTable('roles', mergedRoles));
    if (!(remotePerms || []).length) seeds.push(syncTable('permissions', PERMISSIONS));
    if (!(remoteRP || []).length) seeds.push(syncTable('rolePermissions', ROLE_PERMISSIONS));
    if (seeds.length) await Promise.all(seeds);

    console.info('[SystemAPI] Đã refresh actor/role/permission từ KIO server.');
    return true;
  }

  function sessionGet() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; } }
  function sessionSet(v) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch (_) {} }
  function sessionClear() { try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }

  function setCurrentUser(user) {
    const role = (DB.roles || []).find(r => r.id === user.roleId);
    DB.currentUser = {
      id: user.empId || user.id,
      userId: user.id,
      username: user.username,
      name: user.fullName || user.name || user.username,
      roleId: user.roleId,
      role: role?.name || user.roleId,
      dept: user.dept || '',
      initials: typeof initials === 'function' ? initials(user.fullName || user.username) : '',
      email: user.empId ? ((DB.employees || []).find(e => e.id === user.empId)?.email || '') : '',
      storeId: user.storeId || '',
    };
  }

  function restoreSession() {
    const sess = sessionGet();
    if (!sess?.userId) return false;
    const user = (DB.users || []).find(u => u.id === sess.userId && u.state === 'active');
    if (!user) return false;
    setCurrentUser(user);
    return true;
  }

  async function login(username, password) {
    // FAST LOGIN: tài khoản đã có trong actor/cache được xác thực ngay, không chờ
    // request lenam_users đang chạy nền. Chỉ tài khoản chưa có local (VD tài khoản
    // nhân sự mới tạo trên máy khác) mới cần chờ server một lần.
    const normalizedUsername = String(username).trim().toLowerCase();
    let u = (DB.users || []).find(x => String(x.username).toLowerCase() === normalizedUsername);
    if (!u && bootUsersRefresh) {
      await bootUsersRefresh;
      u = (DB.users || []).find(x => String(x.username).toLowerCase() === normalizedUsername);
    }
    if (!u || u.state !== 'active') return {ok:false,message:'Tài khoản không tồn tại hoặc đã bị khóa.'};
    const hash = await sha256(password);
    if (hash !== u.passwordHash) return {ok:false,message:'Mật khẩu không đúng.'};
    u.lastLogin = nowText();
    sessionSet({userId:u.id,loginAt:u.lastLogin});
    setCurrentUser(u);
    // Session có hiệu lực ngay. Không sync toàn bộ lenam_users mỗi lần login
    // vì thao tác đó phải đọc lại cả bảng và từng làm chậm các request nghiệp vụ.
    cacheWrite({users:DB.users||[], roles:DB.roles||[], auditLogs:DB.auditLogs||[]});
    // Nhật ký đăng nhập vẫn được lưu, nhưng tuyệt đối không chen KRUD vào đường
    // chuyển màn hình ngay sau login. Ghi khi browser rảnh để UI/route ưu tiên trước.
    const writeLoginAudit = () => audit({module:'AUTH',entityType:'USER',entityId:u.id,action:'LOGIN',description:`${u.fullName} đăng nhập hệ thống`}).catch(() => {});
    if (typeof requestIdleCallback === 'function') requestIdleCallback(writeLoginAudit, {timeout:8000});
    else setTimeout(writeLoginAudit, 3000);
    return {ok:true,user:u};
  }

  async function flushBusinessDataBeforeRoleSwitch() {
    // Chỉ flush những API có cơ chế pending/changed thực sự. Chạy song song để
    // đăng xuất không bị chặn tuần tự bởi nhiều request không liên quan.
    // Restaurant/Quality lưu trực tiếp ở action nên không ép sync toàn bộ bảng lúc logout.
    const jobs = [];
    if (typeof ApprovalsAPI !== 'undefined' && ApprovalsAPI.flushPending) jobs.push(['Phê duyệt', ApprovalsAPI.flushPending()]);
    if (typeof PurchaseAPI !== 'undefined' && PurchaseAPI.flushPending) jobs.push(['Mua hàng', PurchaseAPI.flushPending()]);
    if (typeof InventoryAPI !== 'undefined' && InventoryAPI.flushPending) jobs.push(['Kho', InventoryAPI.flushPending()]);
    if (typeof CRMAPI !== 'undefined' && CRMAPI.flushPending) jobs.push(['CRM/Bán hàng', CRMAPI.flushPending()]);
    if (typeof ProductionAPI !== 'undefined' && ProductionAPI.syncNow) jobs.push(['Sản xuất', ProductionAPI.syncNow()]);
    if (typeof LogisticsFleet !== 'undefined' && LogisticsFleet.flush) jobs.push(['Logistics', LogisticsFleet.flush()]);

    if (!jobs.length) return true;
    const results = await Promise.allSettled(jobs.map(([, promise]) => Promise.resolve(promise)));
    const failed = results
      .map((r, i) => r.status === 'rejected' ? `${jobs[i][0]}: ${r.reason?.message || r.reason}` : '')
      .filter(Boolean);
    if (failed.length) throw new Error(failed.join(' | '));
    return true;
  }

  async function logout() {
    // Logout chỉ xử lý phiên đăng nhập. Dữ liệu nghiệp vụ phải được lưu ngay
    // tại action tạo/sửa/duyệt/thanh toán, không dồn việc đồng bộ tới lúc logout.
    const user = currentUser();
    if (user) {
      audit({module:'AUTH',entityType:'USER',entityId:user.id,action:'LOGOUT',description:`${user.fullName} đăng xuất hệ thống`}).catch(() => {});
    }
    sessionClear();
    DB.currentUser = null;
    return true;
  }

  function currentUser() {
    const id = DB.currentUser?.userId;
    return (DB.users || []).find(u => u.id === id) || null;
  }

  async function audit({module='SYSTEM',entityType='ACTION',entityId='',action='ACTION',description='',oldData=null,newData=null}={}) {
    const user = currentUser();
    if (!user) return null;
    const role = (DB.roles || []).find(r => r.id === user.roleId);
    const item = {
      id:`AUD-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      userId:user.id, employeeId:user.empId || '', username:user.username,
      fullName:user.fullName || user.name || user.username,
      roleId:user.roleId, roleName:role?.name || user.roleId, department:user.dept || '',
      module, entityType, entityId:String(entityId || ''), action,
      description, oldData, newData, createdAt:nowText(),
    };
    DB.auditLogs = Array.isArray(DB.auditLogs) ? DB.auditLogs : [];
    DB.auditLogs.unshift(item);
    try {
      if (typeof KioStore.appendCollection === 'function') await KioStore.appendCollection(TABLES.auditLogs, [item]);
      else await syncTable('auditLogs', [item]);
    } catch (err) { console.warn('[Audit] Chưa ghi được KIO:', err); }
    return item;
  }

  function auditFor(entityId, entityType='') {
    return (DB.auditLogs || []).filter(a => String(a.entityId) === String(entityId) && (!entityType || a.entityType === entityType)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function refreshAuditLogs({force=true}={}) {
    try {
      const remote = await KioStore.listCollection(TABLES.auditLogs, {force});
      DB.auditLogs = Array.isArray(remote) ? remote : [];
      cacheWrite({users:DB.users||[], roles:DB.roles||[], auditLogs:DB.auditLogs, syncedAt:Date.now()});
      return DB.auditLogs;
    } catch (err) {
      console.warn('[SystemAPI] Không tải được audit log từ KIO:', err);
      return DB.auditLogs || [];
    }
  }


  function showLogin() {
    return new Promise(resolve => {
      document.getElementById('startupMask')?.remove();
      document.querySelector('.app')?.classList.add('hidden');
      let host=document.getElementById('authLoginHost');
      if (!host) { host=document.createElement('div'); host.id='authLoginHost'; document.body.appendChild(host); }
      host.innerHTML=`<div class="auth-screen"><form class="auth-card" id="authLoginForm">
        <div class="auth-logo"><i class="fa-solid fa-shield-halved"></i></div>
        <h2>Lê Nam ERP</h2><p>Đăng nhập bằng tài khoản actor được cấp để mọi thao tác có dấu vết.</p>
        <label>Tên đăng nhập</label><input class="inp" id="authUsername" autocomplete="username" required placeholder="Ví dụ: kho, sanxuat, ketoan">
        <label>Mật khẩu</label><input class="inp" id="authPassword" type="password" autocomplete="current-password" required placeholder="123456">
        <div class="auth-error" id="authError"></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" type="submit"><i class="fa-solid fa-right-to-bracket"></i> Đăng nhập</button>
        <div class="cell-sub" style="margin-top:12px;text-align:center">Tài khoản demo dùng mật khẩu <b>123456</b></div>
        <div class="auth-quick-title">Tài khoản dễ nhớ</div>
        <div class="auth-quick">
          ${['admin','giamdoc','muahang','truongmuahang','kho','sanxuat','qc','kinhdoanh','truongkinhdoanh','ketoan','nhansu','baotri','logistics','cuahang','cuahang_lvv','cuahang_pxl','cuahang_bd','giacong','rnd'].map(u=>`<button type="button" class="auth-account" data-user="${u}">${u}</button>`).join('')}
        </div>
      </form></div>`;
      const style=document.createElement('style'); style.id='authStyle'; style.textContent=`
        .auth-screen{position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,var(--surface-2),var(--bg));display:flex;align-items:center;justify-content:center;padding:20px}
        .auth-card{width:min(420px,100%);background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:30px;box-shadow:0 24px 60px rgba(0,0,0,.16)}
        .auth-card h2{text-align:center;margin:8px 0}.auth-card>p{text-align:center;color:var(--text-3);font-size:13px;line-height:1.5;margin-bottom:22px}.auth-card label{display:block;font-size:12px;font-weight:700;margin:12px 0 6px}.auth-card .inp{width:100%;max-width:none;box-sizing:border-box}.auth-logo{width:56px;height:56px;margin:auto;border-radius:16px;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px}.auth-error{min-height:30px;color:var(--red);font-size:12px;padding-top:7px}.auth-quick-title{margin-top:16px;font-size:12px;font-weight:700;color:var(--text-2);text-align:center}.auth-quick{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:8px}.auth-account{border:1px solid var(--border);background:var(--surface-2);color:var(--text);border-radius:999px;padding:5px 9px;font-size:11px;cursor:pointer}.auth-account:hover{border-color:var(--primary);color:var(--primary)}`;
      if (!document.getElementById('authStyle')) document.head.appendChild(style);
      const form=document.getElementById('authLoginForm');
      form.querySelectorAll('.auth-account').forEach(btn => btn.addEventListener('click', () => {
        document.getElementById('authUsername').value = btn.dataset.user || '';
        document.getElementById('authPassword').value = '123456';
        document.getElementById('authPassword').focus();
      }));
      form.addEventListener('submit', async e => {
        e.preventDefault(); const btn=form.querySelector('button'); btn.disabled=true;
        const res=await login(document.getElementById('authUsername').value,document.getElementById('authPassword').value);
        btn.disabled=false;
        if (!res.ok) { document.getElementById('authError').textContent=res.message; return; }
        // Không hiện app shell tại đây. boot() sẽ render route hoàn chỉnh trước rồi
        // mới chuyển Login -> ERP, tránh flash sidebar/header + vùng trắng.
        host.remove(); resolve(true);
      });
      setTimeout(()=>document.getElementById('authUsername')?.focus(),0);
    });
  }

  async function saveUsers() { await syncTable('users', DB.users || []); cacheWrite({users:DB.users||[],roles:DB.roles||[],auditLogs:DB.auditLogs||[],syncedAt:Date.now()}); return true; }

  // Dùng chung đúng 1 thuật toán hash với login(): mọi nơi tạo tài khoản mới
  // (VD: mod-hr.js khi thêm nhân sự kèm tài khoản) PHẢI hash qua đây để ghi vào
  // `passwordHash` — ghi thẳng chuỗi thô vào DB.users sẽ khiến tài khoản không
  // bao giờ đăng nhập được, vì login() luôn so sánh bằng SHA-256.
  const hashPassword = sha256;

  return {bootstrap,refreshFromServer,refreshAuditLogs,restoreSession,showLogin,login,logout,flushBusinessDataBeforeRoleSwitch,audit,auditFor,currentUser,saveUsers,hashPassword,ROLE_DEFS,ACTORS,SESSION_KEY};
})();
