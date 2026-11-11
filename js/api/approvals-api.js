/* ============================================================================
 * APPROVALS API - KIO PERSISTENCE
 * ----------------------------------------------------------------------------
 * Trách nhiệm duy nhất của file này:
 *   1) Nạp dữ liệu Quy trình phê duyệt từ các bảng lenam_approval_* trên KIO
 *      server vào DB.* (workflows / requests / logs / signatures).
 *   2) Đồng bộ collection bị thay đổi lên đúng bảng server.
 *   3) Seed đúng 1 lần các quy trình mặc định (định nghĩa trong
 *      mod-approvals.js) lên server nếu server đang trống — giống cơ chế
 *      migrate/seed của CRMAPI.
 *
 * KHÔNG chứa business logic phê duyệt. Luồng nghiệp vụ (tạo/duyệt/từ chối/
 * hủy yêu cầu, ký điện tử) vẫn nằm nguyên trong mod-approvals.js.
 * ========================================================================== */
const ApprovalsAPI = (() => {
  const TABLES = KIO_CONFIG.approvalTables;
  const CACHE_KEY = KIO_CONFIG.storageKeys.approvalCache;
  const DEMO_SEED_KEY = KIO_CONFIG.storageKeys.approvalDemoSeed;

  const REFRESH_TTL = 2 * 60 * 1000;
  const DB_KEYS = { workflows: 'approvalWorkflows', requests: 'approvalRequests', logs: 'approvalLogs', signatures: 'eSignatures' };
  const dbKey = (key) => DB_KEYS[key] || key;

  let syncChain = Promise.resolve();
  const localVersion = new Map();
  let lastRefreshAt = 0;
  let bootPromise = null;
  let booted = false;
  let scheduleTimer = null;
  let scheduledKeys = new Set();
  // [FIX reload mất yêu cầu] Số thay đổi cục bộ CHƯA được xác nhận lưu lên server theo từng key.
  // Khi đang > 0, dữ liệu đọc từ server (có thể cũ hơn) KHÔNG được ghi đè DB.* tương ứng.
  const pendingLocal = new Map();
  const baseline = new Map();
  const pendingOf = (key) => Number(pendingLocal.get(key) || 0);
  const pendingInc = (keys) => keys.forEach(k => pendingLocal.set(k, pendingOf(k) + 1));
  const pendingDec = (keys) => keys.forEach(k => pendingLocal.set(k, Math.max(0, pendingOf(k) - 1)));

  function versionOf(key) { return Number(localVersion.get(key) || 0); }
  function markLocalChange(keys) {
    normalizeKeys(keys).forEach(key => localVersion.set(key, versionOf(key) + 1));
  }
  function normalizeKeys(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return [...new Set(list.filter(key => key && TABLES[key]))];
  }

  function readCache() { return KioDataUtils.readJson(CACHE_KEY); }
  function writeCache() { const snap={}; Object.keys(TABLES).forEach(key => snap[key]=KioDataUtils.clone(DB[dbKey(key)] || [])); KioDataUtils.writeJson(CACHE_KEY, snap); }

  function apply(data, skipKeys = null) {
    Object.keys(TABLES).forEach(key => {
      if (skipKeys && skipKeys.has(key)) return;
      if (Array.isArray(data?.[key])) {
        DB[dbKey(key)] = data[key];
        baseline.set(key, new Map(data[key].map(row => [String(row.id), JSON.stringify(row)])));
      }
    });
  }

  async function readAll(keys = Object.keys(TABLES), force = false) {
    const entries = Object.entries(TABLES).filter(([key]) => keys.includes(key));
    const values = await Promise.all(entries.map(([, table]) => KioStore.listCollection(table, { force })));
    return Object.fromEntries(entries.map(([key], index) => [key, values[index]]));
  }

  // Quy trình mặc định (9 loại chứng từ) được mod-approvals.js khởi tạo vào
  // DB.approvalWorkflows ngay khi file đó load (trước khi app boot gọi tới
  // đây). Nếu server chưa có gì, đẩy đúng bản đang có trong DB lên làm seed —
  // KHÔNG tự seed lại nếu collection đã từng được migrate (tương tự CRMAPI:
  // một request/log rỗng sau đó là trạng thái hợp lệ, không phải thiếu dữ liệu).
  async function seedMissingCollections(serverData) {
    const demo = {}; Object.keys(TABLES).forEach(key => demo[key]=KioDataUtils.clone(DB[dbKey(key)] || []));
    const out = { ...serverData };
    const seeded = [];

    for (const [key, table] of Object.entries(TABLES)) {
      const remote = Array.isArray(serverData?.[key]) ? serverData[key] : [];
      if (remote.length > 0) { out[key] = remote; continue; }

      const items = Array.isArray(demo?.[key]) ? demo[key] : [];
      if (items.length) {
        await KioStore.syncCollection(table, items);
        out[key] = KioDataUtils.clone(items);
        seeded.push(`${key}:${items.length}`);
      } else {
        out[key] = [];
      }
    }

    if (seeded.length) console.info(`[ApprovalsAPI] Đã seed dữ liệu mặc định lên KIO: ${seeded.join(', ')}`);
    KioDataUtils.storageSet(DEMO_SEED_KEY, '1');
    return out;
  }

  async function loadServerAndMigrateIfNeeded() {
    let data = await readAll(Object.keys(TABLES), true);
    const migrated = KioDataUtils.storageGet(DEMO_SEED_KEY) === '1';
    if (!migrated) data = await seedMissingCollections(data);
    return data;
  }

  function syncCollections(keys) {
    const wanted = normalizeKeys(keys);
    markLocalChange(wanted);
    pendingInc(wanted);
    syncChain = syncChain.catch(() => {}).then(async () => {
      for (const key of wanted) {
        // Never write untouched stale requests from this browser over another approver's work.
        const rows = JSON.parse(JSON.stringify(DB[dbKey(key)] || []));
        const before = baseline.get(key);
        const changed = before ? rows.filter(row => before.get(String(row.id)) !== JSON.stringify(row)) : rows;
        if (changed.length) await KioStore.syncCollection(TABLES[key], changed);
        const next = new Map(before || []);
        rows.forEach(row => next.set(String(row.id), JSON.stringify(row)));
        baseline.set(key,next);
      }
      writeCache();
      if (wanted.length) console.info(`[ApprovalsAPI] Đã đồng bộ lên KIO: ${wanted.join(', ')}`);
      return true;
    }).catch(err => {
      console.error('[ApprovalsAPI] Đồng bộ KIO thất bại:', err);
      if (typeof Toast !== 'undefined') Toast.err('Không lưu được dữ liệu phê duyệt', err.message);
      throw err;
    }).finally(() => pendingDec(wanted));
    return syncChain;
  }

  function scheduleCollections(keys, delay = 180) {
    markLocalChange(keys);
    normalizeKeys(keys).forEach(key => {
      if (!scheduledKeys.has(key)) pendingInc([key]);
      scheduledKeys.add(key);
    });
    writeCache();
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(() => {
      const wanted = [...scheduledKeys];
      scheduledKeys = new Set();
      syncCollections(wanted).catch(() => {}); // syncCollections đã tự đếm pending trước khi nhả bộ đếm của lịch
      pendingDec(wanted);
    }, delay);
  }

  // Nhật ký phê duyệt là append-only (không sửa lại dòng cũ) — ghi thẳng
  // record mới lên server, không cần đọc lại toàn bảng như syncCollection.
  async function appendLogs(items) {
    const list = Array.isArray(items) ? items : [items];
    if (!list.length) return true;
    try {
      await KioStore.appendCollection(TABLES.logs, list);
      writeCache();
    } catch (err) {
      console.error('[ApprovalsAPI] Không ghi được nhật ký phê duyệt lên KIO:', err);
    }
    return true;
  }

  async function deleteKeys(key, ids) {
    if (!TABLES[key]) return false;
    return KioStore.deleteKeys(TABLES[key], ids);
  }

  async function ensureFresh(keys = null, { force = false } = {}) {
    if (!force && (Date.now() - lastRefreshAt) < REFRESH_TTL) return false;
    try {
      const wanted = keys == null ? Object.keys(TABLES) : normalizeKeys(keys);
      const versions = new Map(wanted.map(key => [key,versionOf(key)]));
      const data = await readAll(wanted, force);
      // A new server may not have stored workflow configuration yet. Keep code-defined
      // workflows available, without importing cached/demo approval requests.
      if (wanted.includes('workflows') && !data.workflows?.length) {
        data.workflows = KioDataUtils.clone(DB.approvalWorkflows || []);
      }
      // Đọc server mất vài giây; trong lúc đó người dùng có thể vừa tạo/duyệt yêu cầu.
      // Key nào còn thay đổi chưa lưu thì giữ nguyên dữ liệu cục bộ, không ghi đè bằng bản server cũ.
      const skip = new Set(Object.keys(TABLES).filter(key => pendingOf(key) > 0 || (versions.has(key) && versionOf(key) !== versions.get(key))));
      const changed = {};
      Object.keys(TABLES).forEach(key => {
        if (skip.has(key) || !Array.isArray(data?.[key])) return;
        const before = JSON.stringify(DB[dbKey(key)] || []);
        const after = JSON.stringify(data[key]);
        if (before !== after) changed[key] = data[key];
      });
      apply(data, skip);
      lastRefreshAt = Date.now();
      writeCache();
      return changed;
    } catch (err) {
      console.warn('[ApprovalsAPI] Không refresh được từ server; giữ dữ liệu hiện tại:', err);
      return {};
    }
  }

  async function bootstrap() {
    if (booted) return true;
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      const cached = readCache();
      if (cached) apply(cached, new Set(Object.keys(TABLES).filter(key => pendingOf(key) > 0)));
      try { await ensureFresh(null, { force: true }); } catch (_) {}
      booted = true;
      return true;
    })().finally(() => { bootPromise = null; });
    return bootPromise;
  }

  // Đọc lại từ server (bỏ qua cache) để xác nhận một record đã thật sự nằm trong DB.
  async function existsOnServer(key, id) {
    if (!TABLES[key]) return false;
    const rows = await KioStore.listCollection(TABLES[key], { force: true });
    return rows.some(r => String(r?.id) === String(id));
  }

  async function flushPending() {
    clearTimeout(scheduleTimer);
    const wanted = [...scheduledKeys];
    scheduledKeys.clear();
    if (wanted.length) {
      const job = syncCollections(wanted);
      pendingDec(wanted);
      await job;
    } else await syncChain;
    return true;
  }

  return { flushPending, bootstrap, ensureFresh, syncCollections, scheduleCollections, appendLogs, deleteKeys, existsOnServer };
})();
