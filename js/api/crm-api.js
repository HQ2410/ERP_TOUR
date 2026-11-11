/* ============================================================================
 * CRM API - KIO PERSISTENCE
 * ----------------------------------------------------------------------------
 * Trách nhiệm duy nhất của file này:
 *   1) Nạp dữ liệu CRM/Bán hàng từ các bảng lenam_* trên KIO server vào DB.*
 *   2) Đồng bộ collection CRM bị thay đổi lên đúng bảng server
 *   3) Migrate dữ liệu từ cơ chế CRM_SALES_STATE/localStorage cũ đúng 1 lần
 *
 * KHÔNG chứa business logic bán hàng. Luồng nghiệp vụ vẫn nằm nguyên trong
 * mod-crm-sales.js / app.js.
 * ========================================================================== */
const CRMAPI = (() => {
  const TABLES = KIO_CONFIG.crmTables;
  const CACHE_KEY = KIO_CONFIG.storageKeys.crmCache;
  const DEMO_SEED_KEY = KIO_CONFIG.storageKeys.crmDemoSeed;
  const PENDING_KEY = `${CACHE_KEY}:pending`; // outbox chống mất dữ liệu khi F5

  // Chỉ dùng để migrate dữ liệu từ bản CRM trước đây; sau migrate không còn
  // ghi CRM vào lenam_inventory_settings nữa.
  const LEGACY_SETTINGS_TABLE = KIO_CONFIG.inventorySettingsTable;
  const LEGACY_STATE_ID = 'CRM_SALES_STATE';
  const LEGACY_LOCAL_KEY = 'lenam:crm-sales:v1';

  const DEMO_DATA = KioDataUtils.snapshotCollections(TABLES);

  let syncTimer = null;
  let syncChain = Promise.resolve();
  const pendingKeys = new Set();
  const localVersion = new Map();
  const lastRefresh = new Map();
  const REFRESH_TTL = 2 * 60 * 1000;
  let booted = false;

  function versionOf(key) { return Number(localVersion.get(key) || 0); }
  function markLocalChange(keys) {
    normalizeKeys(keys).forEach(key => localVersion.set(key, versionOf(key) + 1));
  }

  function normalizeKeys(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return [...new Set(list.filter(key => key && TABLES[key]))];
  }

  function hasAnyData(data) {
    return Object.keys(TABLES).some(
      key => Array.isArray(data?.[key]) && data[key].length > 0
    );
  }

  // CRM không dùng localStorage cache làm nguồn dữ liệu nữa.
  // Chỉ KIO server + DB runtime hiện tại mới quyết định dữ liệu hiển thị.
  // PENDING_KEY vẫn được giữ riêng cho outbox thao tác chưa kịp ghi server.
  function readCache() { return null; }
  function writeCache(_data) { return true; }

  function clearLegacyCrmCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
    try { localStorage.removeItem(LEGACY_LOCAL_KEY); } catch (_) {}
  }

  function snapshotCurrentDb() {
    return KioDataUtils.snapshotCollections(TABLES);
  }

  function apply(data) {
    Object.keys(TABLES).forEach(key => {
      if (Array.isArray(data?.[key])) DB[key] = data[key];
    });
  }

  async function readAll() {
    const entries = Object.entries(TABLES);
    const values = await Promise.all(
      entries.map(([, table]) => KioStore.listCollection(table))
    );
    return Object.fromEntries(
      entries.map(([key], index) => [key, values[index]])
    );
  }

  function readLegacyLocalState() {
    const saved = KioDataUtils.readJson(LEGACY_LOCAL_KEY);
    if (!saved || typeof saved !== 'object') return null;
    return saved;
  }

  async function readLegacyServerState() {
    try {
      return await KioStore.loadSingleton(LEGACY_SETTINGS_TABLE, LEGACY_STATE_ID);
    } catch (err) {
      console.warn('[CRMAPI] Không đọc được CRM_SALES_STATE cũ; bỏ qua migration server:', err);
      return null;
    }
  }

  function chooseMigrationSource(serverLegacy, localLegacy) {
    // Ưu tiên snapshot cũ trên server, sau đó local cache, cuối cùng data.js.
    if (serverLegacy && typeof serverLegacy === 'object') return serverLegacy;
    if (localLegacy && typeof localLegacy === 'object') return localLegacy;
    return DEMO_DATA;
  }

  async function seedMissingCollections(serverData) {
    const serverLegacy = await readLegacyServerState();
    const localLegacy = readLegacyLocalState();
    const source = chooseMigrationSource(serverLegacy, localLegacy);
    const out = { ...serverData };
    const seeded = [];

    for (const [key, table] of Object.entries(TABLES)) {
      const remote = Array.isArray(serverData?.[key]) ? serverData[key] : [];
      if (remote.length > 0) {
        out[key] = remote;
        continue;
      }

      const legacyItems = Array.isArray(source?.[key])
        ? source[key]
        : Array.isArray(DEMO_DATA?.[key])
          ? DEMO_DATA[key]
          : [];

      if (legacyItems.length) {
        await KioStore.syncCollection(table, legacyItems);
        out[key] = KioDataUtils.clone(legacyItems);
        seeded.push(`${key}:${legacyItems.length}`);
      } else {
        out[key] = [];
      }
    }

    if (seeded.length) {
      console.info(`[CRMAPI] Đã migrate/seed CRM sang bảng lenam_*: ${seeded.join(', ')}`);
    }

    KioDataUtils.storageSet(DEMO_SEED_KEY, '1');
    return out;
  }

  async function loadServerAndMigrateIfNeeded() {
    // REAL DATA: chỉ đọc các bảng CRM lenam_*; không tự seed/migrate local demo.
    return readAll();
  }

  async function safeRowsForSync(key) {
    const rows = Array.isArray(DB[key]) ? DB[key] : [];
    if (rows.length > 0) return rows;

    // DATA-SAFE: trạng thái frontend rỗng sau F5/cache lỗi không được coi là
    // yêu cầu xoá collection trên server. CRUD xoá record phải đi qua deleteKeys().
    // Với syncCollection thì [] vốn là no-op, nhưng chặn tại đây để pending/outbox
    // cũ không thể trở thành nguồn dữ liệu nghiệp vụ và để log nguyên nhân rõ ràng.
    try {
      const remote = await KioStore.listCollection(TABLES[key], { force: true });
      if (Array.isArray(remote) && remote.length > 0) {
        console.warn(`[CRMAPI][DATA-SAFE] Bỏ qua sync ${key}=[] vì server đang có ${remote.length} record.`);
      } else {
        console.info(`[CRMAPI][DATA-SAFE] Bỏ qua sync ${key}=[]; xoá collection phải dùng deleteKeys có chủ đích.`);
      }
    } catch (err) {
      console.warn(`[CRMAPI][DATA-SAFE] Không xác minh được server cho ${key}; vẫn bỏ qua payload rỗng.`, err);
    }
    return null;
  }

  function syncCollections(keys) {
    const wanted = normalizeKeys(keys);
    syncChain = syncChain.catch(() => {}).then(async () => {
      for (const key of wanted) {
        const rows = await safeRowsForSync(key);
        if (!rows) {
          pendingKeys.delete(key);
          continue;
        }
        await KioStore.syncCollection(TABLES[key], rows);
      }
      wanted.forEach(key => pendingKeys.delete(key));
      writeCache(snapshotCurrentDb());
      try {
        if (pendingKeys.size) KioDataUtils.writeJson(PENDING_KEY,{keys:[...pendingKeys],at:Date.now()});
        else localStorage.removeItem(PENDING_KEY);
      } catch (_) {}
      if (wanted.length) {
        console.info(`[CRMAPI] Đã đồng bộ lên KIO: ${wanted.join(', ')}`);
      }
      return true;
    }).catch(err => {
      wanted.forEach(key => pendingKeys.add(key));
      try { KioDataUtils.writeJson(PENDING_KEY,{keys:[...pendingKeys],at:Date.now()}); } catch (_) {}
      console.error('[CRMAPI] Đồng bộ KIO thất bại:', err);
      if (typeof Toast !== 'undefined') {
        Toast.err('Không lưu được dữ liệu CRM/Bán hàng', err.message);
      }
      throw err;
    });
    return syncChain;
  }

  function syncAll() {
    return syncCollections(Object.keys(TABLES));
  }

  async function flushPending() {
    clearTimeout(syncTimer);
    const keys = [...pendingKeys];
    if (keys.length) await syncCollections(keys);
    else await syncChain.catch(() => {});
    return true;
  }

  function scheduleCollections(keys, delay = 180) {
    const normalized = normalizeKeys(keys);
    normalized.forEach(key => pendingKeys.add(key));
    markLocalChange(normalized);
    writeCache(snapshotCurrentDb());
    try { KioDataUtils.writeJson(PENDING_KEY,{keys:[...pendingKeys],at:Date.now()}); } catch (_) {}
    // Ghi server gần như ngay sau thao tác. Vẫn gom các thay đổi cùng tick để
    // tránh spam KRUD, nhưng không để timer 80-250ms khiến F5/đổi role mất dữ liệu.
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const keysToSync = [...pendingKeys];
      syncCollections(keysToSync).catch(() => {});
    }, 0);
  }

  function scheduleSync(delay = 180) {
    scheduleCollections(Object.keys(TABLES), delay);
  }

  async function deleteKeys(key, ids) {
    const table = TABLES[key];
    if (!table) throw new Error(`CRM collection không hợp lệ: ${key}`);
    await KioStore.deleteKeys(table, ids);
    writeCache(snapshotCurrentDb());
    console.info(`[CRMAPI] Đã xóa record khỏi ${table}: ${(Array.isArray(ids) ? ids : [ids]).join(', ')}`);
    return true;
  }

  async function bootstrap() {
    if (booted) return true;
    booted = true;
    clearLegacyCrmCache();
    const pendingState = KioDataUtils.readJson(PENDING_KEY);
    // KHÔNG hydrate DB từ cache và cũng KHÔNG reset DB về [].
    // Route CRM sẽ đọc KIO thật ngay khi vào màn hình. Điều này loại bỏ tình trạng
    // cache rỗng ghi đè dữ liệu vừa render sau F5/chuyển trang.
    console.info('[CRMAPI] CRM cache đã vô hiệu hóa; dữ liệu chỉ lấy từ KIO server.');
    // DATA-SAFE: chỉ replay outbox khi cache thực sự còn payload không rỗng.
    // Pending key cũ + DB=[] sau deploy/F5 phải bị loại bỏ, không được đẩy ngược
    // state rỗng lên server.
    const replay = normalizeKeys(pendingState?.keys || []).filter(key => {
      const rows = Array.isArray(DB[key]) ? DB[key] : [];
      if (rows.length > 0) return true;
      console.warn(`[CRMAPI][DATA-SAFE] Bỏ pending rỗng khi bootstrap: ${key}`);
      return false;
    });
    replay.forEach(k => pendingKeys.add(k));
    if (replay.length) await syncCollections(replay);
    try {
      if (pendingKeys.size) KioDataUtils.writeJson(PENDING_KEY,{keys:[...pendingKeys],at:Date.now()});
      else localStorage.removeItem(PENDING_KEY);
    } catch (_) {}
    return true;
  }

  async function refreshKeys(keys, { force = false } = {}) {
    const wanted = normalizeKeys(keys);
    const out = {};
    for (const key of wanted) {
      const startedVersion = versionOf(key);
      try {
        const rows = await KioStore.listCollection(TABLES[key], { force });
        if (versionOf(key) !== startedVersion) continue;
        out[key] = rows;
        DB[key] = rows;
        lastRefresh.set(key, Date.now());
      } catch (err) {
        console.warn(`[CRMAPI] Không refresh được ${key}; tiếp tục dùng cache:`, err);
      }
    }
    if (Object.keys(out).length) writeCache(snapshotCurrentDb());
    return out;
  }

  async function ensureFresh(keys, { force = false } = {}) {
    const wanted = normalizeKeys(keys).filter(key => {
      if (pendingKeys.has(key)) return false;
      if (force) return true;
      return (Date.now() - Number(lastRefresh.get(key) || 0)) >= REFRESH_TTL;
    });
    if (!wanted.length) return {};
    return refreshKeys(wanted, { force });
  }

  async function refreshFromServer() {
    const data = await loadServerAndMigrateIfNeeded();
    apply(data);
    Object.keys(TABLES).forEach(key => lastRefresh.set(key, Date.now()));
    writeCache(data);
    return data;
  }

  return {
    bootstrap,
    refreshFromServer,
    refreshKeys,
    ensureFresh,
    syncAll,
    syncCollections,
    flushPending,
    scheduleSync,
    scheduleCollections,
    deleteKeys,
  };
})();
