/* ============================================================================
 * PURCHASE API - KIO PERSISTENCE
 * ----------------------------------------------------------------------------
 * Trách nhiệm duy nhất của file này:
 *   1) Nạp dữ liệu Purchase từ KIO vào DB.*
 *   2) Seed dữ liệu demo còn thiếu đúng 1 lần theo phiên bản demo
 *   3) Đồng bộ các thay đổi Purchase lên KIO
 *
 * Business logic PR -> duyệt -> báo giá -> PO -> nhập kho -> công nợ vẫn nằm
 * nguyên trong app.js / mod-purchases.js và KHÔNG được thay đổi tại đây.
 * ========================================================================== */
const PurchaseAPI = (() => {
  const TABLES = KIO_CONFIG.purchaseTables;
  const CACHE_KEY = KIO_CONFIG.storageKeys.purchaseCache;
  const DEMO_SEED_KEY = KIO_CONFIG.storageKeys.purchaseDemoSeed;
  const PENDING_KEY = `${CACHE_KEY}:pending`; // outbox chống mất dữ liệu khi F5

  // Snapshot demo lấy đúng một lần sau data.js. Đây chỉ là nguồn seed ban đầu.
  const DEMO_DATA = KioDataUtils.snapshotCollections(TABLES);

  let syncTimer = null;
  let syncChain = Promise.resolve();
  const pendingKeys = new Set();
  // dirty/syncing giúp không cho refresh server cũ ghi đè thay đổi vừa thao tác.
  const dirtyKeys = new Set();
  const syncingKeys = new Set();
  const localVersion = new Map();
  const lastRefresh = new Map();
  const serverLoaded = new Set();
  const REFRESH_TTL = 2 * 60 * 1000;
  let booted = false;

  function versionOf(key) { return Number(localVersion.get(key) || 0); }
  function markLocalChange(keys) {
    normalizeKeys(keys).forEach(key => {
      localVersion.set(key, versionOf(key) + 1);
      dirtyKeys.add(key);
    });
  }

  function hasData(result) {
    return Object.values(result || {}).some(arr => Array.isArray(arr) && arr.length > 0);
  }

  function readCache() {
    return KioDataUtils.readJson(CACHE_KEY);
  }

  function writeCache(data) {
    KioDataUtils.writeJson(CACHE_KEY, data);
  }

  function snapshotCurrentDb() {
    return KioDataUtils.snapshotCollections(TABLES);
  }

  async function readAll() {
    const entries = Object.entries(TABLES);
    const values = await Promise.all(
      entries.map(([, table]) => KioStore.listCollection(table))
    );
    return Object.fromEntries(entries.map(([key], index) => [key, values[index]]));
  }

  function apply(data) {
    Object.keys(TABLES).forEach(key => {
      if (Array.isArray(data?.[key])) DB[key] = data[key];
    });
  }

  // OPTION A: chỉ thêm demo còn thiếu; không xóa và không ghi đè dữ liệu server.
  async function seedMissingDemo(serverData) {
    const merged = { ...serverData };
    const seeded = [];

    for (const [key, table] of Object.entries(TABLES)) {
      const remote = Array.isArray(serverData?.[key]) ? serverData[key] : [];
      const demo = Array.isArray(DEMO_DATA[key]) ? DEMO_DATA[key] : [];
      const remoteKeys = new Set(
        remote.map((item, index) => KioDataUtils.recordKey(item, index))
      );
      const missing = demo.filter(
        (item, index) => !remoteKeys.has(KioDataUtils.recordKey(item, index))
      );

      if (missing.length) {
        await KioStore.syncCollection(table, missing);
        seeded.push(`${key}:${missing.length}`);
      }

      merged[key] = KioDataUtils.mergeServerOverDemo(remote, demo);
    }

    if (seeded.length) {
      console.info(`[PurchaseAPI] Đã seed demo còn thiếu: ${seeded.join(', ')}`);
    }
    return merged;
  }

  function normalizeKeys(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return [...new Set(list.filter(key => TABLES[key]))];
  }

  function syncCollections(keys) {
    clearTimeout(syncTimer);
    const wanted = normalizeKeys(keys);

    syncChain = syncChain.catch(() => {}).then(async () => {
      for (const key of wanted) {
        const startedVersion = versionOf(key);
        syncingKeys.add(key);
        try {
          await KioStore.syncCollection(TABLES[key], Array.isArray(DB[key]) ? DB[key] : []);
          // Chỉ đánh dấu sạch nếu trong lúc sync không phát sinh chỉnh sửa mới.
          if (versionOf(key) === startedVersion) { dirtyKeys.delete(key); pendingKeys.delete(key); }
        } finally {
          syncingKeys.delete(key);
        }
      }
      writeCache(snapshotCurrentDb());
      try {
        if (pendingKeys.size) KioDataUtils.writeJson(PENDING_KEY, {keys:[...pendingKeys], at:Date.now()});
        else localStorage.removeItem(PENDING_KEY);
      } catch (_) {}
      if (wanted.length) console.info(`[PurchaseAPI] Đã đồng bộ: ${wanted.join(', ')}`);
      return true;
    }).catch(err => {
      wanted.forEach(key => { pendingKeys.add(key); dirtyKeys.add(key); });
      try { KioDataUtils.writeJson(PENDING_KEY,{keys:[...pendingKeys],at:Date.now()}); } catch (_) {}
      console.error('[PurchaseAPI] Đồng bộ KIO thất bại:', err);
      if (typeof Toast !== 'undefined') Toast.err('Không lưu được dữ liệu Purchase', err.message);
      throw err;
    });

    return syncChain;
  }

  function syncAll() {
    return syncCollections(Object.keys(TABLES));
  }

  // Xóa thật theo khóa nghiệp vụ trên KIO. syncCollection() cố ý không suy luận
  // record bị xóa, nên các thao tác Delete phải gọi helper này để F5 không hồi lại.
  async function deleteCollectionKey(key, ids) {
    const table = TABLES[key];
    if (!table) throw new Error(`Purchase collection không hợp lệ: ${key}`);
    await KioStore.deleteKeys(table, Array.isArray(ids) ? ids : [ids]);
    writeCache(snapshotCurrentDb());
    return true;
  }

  // Ghi ngay các collection đang chờ đồng bộ. Dùng khi đổi tài khoản/đăng xuất
  // để không mất dữ liệu do timer chưa kịp chạy trước khi reload trang.
  async function flushPending() {
    clearTimeout(syncTimer);
    const keys = [...new Set([...pendingKeys, ...dirtyKeys])];
    pendingKeys.clear();
    if (keys.length) await syncCollections(keys);
    else await syncChain.catch(() => {});
    return true;
  }

  function scheduleCollections(keys, delay = 120) {
    const normalized = normalizeKeys(keys);
    normalized.forEach(key => pendingKeys.add(key));
    markLocalChange(normalized);
    // Ghi snapshot + outbox ngay trước request server để F5 không làm mất thao tác.
    writeCache(snapshotCurrentDb());
    try { KioDataUtils.writeJson(PENDING_KEY, {keys:[...pendingKeys], at:Date.now()}); } catch (_) {}
    // Ghi server gần như ngay sau thao tác. Vẫn gom các thay đổi cùng tick để
    // tránh spam KRUD, nhưng không để timer 80-250ms khiến F5/đổi role mất dữ liệu.
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const keysToSync = [...pendingKeys];
      syncCollections(keysToSync).catch(() => {});
    }, 0);
  }

  function scheduleSync(delay = 120) {
    scheduleCollections(Object.keys(TABLES), delay);
  }

  async function loadServerAndSeedIfNeeded() {
    // REAL DATA: không seed/merge data.js. Server lenam_* là nguồn duy nhất.
    return readAll();
  }

  async function bootstrap() {
    if (booted) return true;
    booted = true;
    const cached = readCache();
    const pendingState = KioDataUtils.readJson(PENDING_KEY);

    // [PERFORMANCE] Bootstrap chỉ nạp cache/data.js. Không tự đọc toàn bộ 8 bảng
    // Purchase ngay khi đăng nhập. Server sẽ refresh đúng bảng của tab người dùng
    // đang mở qua ensureFresh(), tránh hàng chục list.php nối đuôi nhau.
    if (cached && hasData(cached)) {
      apply(cached);
      console.info('[PurchaseAPI] Đã nạp cache local; chờ refresh theo màn hình đang mở.');
    } else {
      Object.keys(TABLES).forEach(key => { DB[key] = []; });
      console.info('[PurchaseAPI] Chưa có cache server; chờ tải dữ liệu thật từ KIO.');
    }
    // Replay thay đổi chưa kịp lên server ở lần chạy trước trước khi refresh.
    const replay = normalizeKeys(pendingState?.keys || []);
    replay.forEach(key => { pendingKeys.add(key); dirtyKeys.add(key); });
    if (replay.length) await syncCollections(replay);
    return true;
  }

  async function refreshKeys(keys, { force = false } = {}) {
    const wanted = normalizeKeys(keys);
    if (!wanted.length) return {};

    const out = {};
    for (const key of wanted) {
      const startedVersion = versionOf(key);
      try {
        const rows = await KioStore.listCollection(TABLES[key], { force });
        // Nếu user vừa sửa dữ liệu trong lúc request đang chạy thì không cho
        // server snapshot cũ ghi đè DB.* vừa thay đổi.
        if (versionOf(key) !== startedVersion) continue;
        out[key] = rows;
        DB[key] = rows;
        serverLoaded.add(key);
        lastRefresh.set(key, Date.now());
      } catch (err) {
        console.warn(`[PurchaseAPI] Không refresh được ${key}; tiếp tục dùng cache:`, err);
      }
    }
    if (Object.keys(out).length) writeCache(snapshotCurrentDb());
    return out;
  }

  async function ensureFresh(keys, { force = false } = {}) {
    const wanted = normalizeKeys(keys).filter(key => {
      // Không đọc snapshot server khi collection vừa thay đổi hoặc đang ghi;
      // nếu không PO vừa tạo có thể biến mất trước khi KIO sync xong.
      if (dirtyKeys.has(key) || syncingKeys.has(key) || pendingKeys.has(key)) return false;
      if (force) return true;
      return (Date.now() - Number(lastRefresh.get(key) || 0)) >= REFRESH_TTL;
    });
    if (!wanted.length) return {};
    return refreshKeys(wanted, { force });
  }

  async function refreshFromServer() {
    const data = await readAll();
    apply(data);
    Object.keys(TABLES).forEach(key => lastRefresh.set(key, Date.now()));
    writeCache(snapshotCurrentDb());
    return data;
  }

  // Mapping persistence theo action. Chỉ giảm số request KIO; không thay đổi
  // logic nghiệp vụ trong action gốc.
  const ACTION_KEYS = {
    'supplier-save': () => ['suppliers'],
    'pr-save': () => ['purchases'],
    'pr-add-supplier': () => ['purchases'],
    'pr-select-supplier': () => ['purchases'],
    'pr-approve-action': () => ['purchases'],
    'pr-reject-save': () => ['purchases'],
    'pr-convert-po': () => ['purchases', 'purchaseOrders'],
    'quote-confirm-pr': () => ['supplierQuotations', 'purchaseOrders', 'purchases'],
    'quote-save-supplier': () => ['supplierQuotations'],
    'quote-select-winner': () => ['supplierQuotations', 'purchases', 'purchaseOrders'],
    'po-approve-action': () => ['purchaseOrders'],
    'po-change-status': () => ['purchaseOrders'],
    'po-evaluate-supplier-save': () => ['supplierEvaluations'],
    'supplier-evaluation-save': () => ['supplierEvaluations'],
    'po-goods-receipt-save': () => ['goodsReceipts', 'purchaseOrders', 'purchasePriceHistory'],
    'goods-receipt-save': () => ['goodsReceipts', 'purchaseOrders', 'purchasePriceHistory'],
    'supplier-pay-save': () => ['supplierPayments', 'purchaseOrders'],
    'supplier-refund-save': () => ['supplierRefunds', 'purchaseOrders'],
  };

  function wrapActions(actions) {
    if (!actions || actions.__purchaseApiWrapped) return;

    Object.entries(ACTION_KEYS).forEach(([name, resolver]) => {
      const original = actions[name];
      if (typeof original !== 'function') return;

      actions[name] = function (...args) {
        const result = original.apply(this, args);
        Promise.resolve(result).then(() => {
          scheduleCollections(resolver(args[0] || {}));
        }).catch(() => {});
        return result;
      };
    });

    Object.defineProperty(actions, '__purchaseApiWrapped', { value: true });
  }

  return { hasServerData: key => serverLoaded.has(key), bootstrap, refreshFromServer, refreshKeys, ensureFresh, syncAll, syncCollections, deleteCollectionKey, flushPending, scheduleSync, scheduleCollections, wrapActions };
})();
