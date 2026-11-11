/* ============================================================================
 * R&D API - KIO PERSISTENCE
 * ----------------------------------------------------------------------------
 * Trách nhiệm duy nhất của file này:
 *   1) Nạp dữ liệu R&D (rndProjects/rndFormulas/rndFormulaVersions/rndTrials/
 *      rndCosts/rndApprovals) từ các bảng lenam_rnd_* trên KIO server vào DB.*
 *   2) Đồng bộ collection R&D bị thay đổi lên đúng bảng server
 *   3) Seed đúng 1 lần: nếu một bảng server đang rỗng, đẩy dữ liệu demo hiện
 *      có trong DB.* (được mod-rnd.js gán bằng `DB.x = DB.x || [demo]`) lên
 *      server — để không mất demo ban đầu, và sau lần seed đó không bao giờ
 *      tự ghi đè dữ liệu thật chỉ vì collection đang rỗng.
 *
 * Trước file này, mod-rnd.js / mod-rnd-actions.js chỉ sửa DB.rnd* trong bộ
 * nhớ — không có API/localStorage/fetch nào ghi lên server, nên mọi dự án,
 * công thức, thử nghiệm, chi phí, phê duyệt R&D bị mất khi tải lại trang vì
 * `DB.x = DB.x || [demo]` luôn chạy lại với DB rỗng ngay sau F5. KHÔNG chứa
 * business logic R&D; luồng nghiệp vụ vẫn nằm nguyên trong mod-rnd.js /
 * mod-rnd-actions.js.
 * ========================================================================== */
const RNDApi = (() => {
  const TABLES = KIO_CONFIG.rndTables;
  const CACHE_KEY = KIO_CONFIG.storageKeys.rndCache;
  const SEED_KEY = KIO_CONFIG.storageKeys.rndDemoSeed;

  let booted = false;
  let seedPromise = null;
  let syncChain = Promise.resolve();
  let syncTimer = null;
  const pendingKeys = new Set();
  const lastLoaded = new Map();
  const REFRESH_TTL = 2 * 60 * 1000;

  function clone(v) {
    return typeof KioDataUtils !== 'undefined' ? KioDataUtils.clone(v) : JSON.parse(JSON.stringify(v));
  }
  function normalizeKeys(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return [...new Set(list.filter(key => key && TABLES[key]))];
  }
  function readCache() {
    return typeof KioDataUtils !== 'undefined' ? KioDataUtils.readJson(CACHE_KEY) : null;
  }
  function snapshotCurrentDb() {
    const out = {};
    Object.keys(TABLES).forEach(key => { out[key] = clone(Array.isArray(DB[key]) ? DB[key] : []); });
    return out;
  }
  function writeCache() {
    if (typeof KioDataUtils !== 'undefined') KioDataUtils.writeJson(CACHE_KEY, snapshotCurrentDb());
  }
  function apply(data) {
    Object.keys(TABLES).forEach(key => { if (Array.isArray(data?.[key])) DB[key] = data[key]; });
  }
  function hasAnyData(data) {
    return Object.keys(TABLES).some(key => Array.isArray(data?.[key]) && data[key].length > 0);
  }
  function storageGet(key) {
    return typeof KioDataUtils !== 'undefined' ? KioDataUtils.storageGet(key) : (() => { try { return localStorage.getItem(key); } catch (_) { return null; } })();
  }
  function storageSet(key, val) {
    if (typeof KioDataUtils !== 'undefined') KioDataUtils.storageSet(key, val);
    else try { localStorage.setItem(key, val); } catch (_) {}
  }

  async function readAll() {
    const entries = Object.entries(TABLES);
    const values = await Promise.all(entries.map(([, table]) => KioStore.listCollection(table)));
    return Object.fromEntries(entries.map(([key], i) => [key, values[i]]));
  }

  // Seed đúng 1 lần: bảng nào server đang rỗng thì đẩy demo hiện có trong
  // DB.* (đã được mod-rnd.js gán sẵn) lên; bảng đã có dữ liệu thì giữ nguyên
  // dữ liệu server và nạp về DB. Sau lần seed này, một bảng rỗng là trạng
  // thái hợp lệ (VD: chưa có chi phí nào) — không tự seed lại.
  async function seedMissingCollections(serverData) {
    const out = { ...serverData };
    const seeded = [];
    for (const [key, table] of Object.entries(TABLES)) {
      const remote = Array.isArray(serverData?.[key]) ? serverData[key] : [];
      if (remote.length > 0) { out[key] = remote; continue; }
      const demo = Array.isArray(DB[key]) ? DB[key] : [];
      if (demo.length) {
        await KioStore.syncCollection(table, clone(demo));
        out[key] = clone(demo);
        seeded.push(`${key}:${demo.length}`);
      } else {
        out[key] = [];
      }
    }
    if (seeded.length) console.info(`[RNDApi] Đã seed demo R&D lên KIO (lần đầu): ${seeded.join(', ')}`);
    storageSet(SEED_KEY, '1');
    return out;
  }

  async function loadServerAndSeedIfNeeded() {
    let data = await readAll();
    if (storageGet(SEED_KEY) !== '1') data = await seedMissingCollections(data);
    return data;
  }

  async function bootstrap() {
    if (booted) return true;
    booted = true;
    const cached = readCache();
    if (cached && hasAnyData(cached)) {
      apply(cached);
      console.info('[RNDApi] Đã nạp cache R&D gần nhất.');
    }
    return true;
  }

  // Promise dùng chung: các lời gọi đồng thời phải đợi cùng một lần nạp/seed, không
  // được đọc bảng rỗng rồi ghi đè demo đang được seed. Trả về true khi DB.* vừa được
  // thay bằng dữ liệu server (caller dùng để biết cần render lại).
  function seedIfNeeded() {
    if (seedPromise) return seedPromise;
    seedPromise = (async () => {
      try {
        const data = await loadServerAndSeedIfNeeded();
        apply(data);
        Object.keys(TABLES).forEach(key => lastLoaded.set(key, Date.now()));
        writeCache();
        return true;
      } catch (err) {
        seedPromise = null; // thử lại ở lần gọi sau
        console.warn('[RNDApi] Seed R&D lần đầu thất bại; giữ dữ liệu hiện tại:', err);
        return false;
      }
    })();
    return seedPromise;
  }

  async function refreshKeys(keys, { force = false } = {}) {
    const wanted = normalizeKeys(keys);
    const out = {};
    for (const key of wanted) {
      try {
        const rows = await KioStore.listCollection(TABLES[key], { force });
        DB[key] = rows;
        lastLoaded.set(key, Date.now());
        out[key] = true;
      } catch (err) {
        console.warn(`[RNDApi] Không refresh được ${key}; giữ dữ liệu hiện tại:`, err);
      }
    }
    if (Object.keys(out).length) writeCache();
    return out;
  }

  async function ensureFresh(keys, { force = false } = {}) {
    await bootstrap();
    const seeded = await seedIfNeeded();
    // Lần nạp đầu tiên (seedIfNeeded) đã thay DB.* bằng dữ liệu server, nên phải báo
    // "changed" để scheduleRouteDataRefresh render lại — nếu không, màn hình vẫn giữ
    // dữ liệu demo cho tới lần render kế tiếp.
    const changed = {};
    if (seeded) normalizeKeys(keys).forEach(key => { changed[key] = true; });
    const wanted = normalizeKeys(keys).filter(key => {
      if (force) return true;
      return (Date.now() - Number(lastLoaded.get(key) || 0)) >= REFRESH_TTL;
    });
    if (!wanted.length) return changed;
    return Object.assign(changed, await refreshKeys(wanted, { force }));
  }

  function syncCollections(keys) {
    const wanted = normalizeKeys(keys);
    syncChain = syncChain.catch(() => {}).then(async () => {
      for (const key of wanted) {
        await KioStore.syncCollection(TABLES[key], clone(Array.isArray(DB[key]) ? DB[key] : []));
        lastLoaded.set(key, Date.now());
      }
      writeCache();
      if (wanted.length) console.info(`[RNDApi] Đã đồng bộ lên KIO: ${wanted.join(', ')}`);
      return true;
    }).catch(err => {
      console.error('[RNDApi] Đồng bộ KIO thất bại:', err);
      if (typeof Toast !== 'undefined') Toast.err('Không lưu được dữ liệu R&D lên server', err.message);
      throw err;
    });
    return syncChain;
  }

  function scheduleSync(keys, delay = 180) {
    normalizeKeys(keys).forEach(key => pendingKeys.add(key));
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const wanted = [...pendingKeys];
      pendingKeys.clear();
      syncCollections(wanted).catch(() => {});
    }, delay);
  }

  // Xóa thật trên server: syncCollections chỉ thêm/thay, KHÔNG tự xóa record
  // server chỉ vì frontend không còn record đó — nên xóa dự án cần gọi riêng.
  async function remove(key, ids) {
    const table = TABLES[key];
    if (!table) throw new Error(`R&D collection không hợp lệ: ${key}`);
    await KioStore.deleteKeys(table, ids);
    writeCache();
    console.info(`[RNDApi] Đã xóa record khỏi ${table}: ${(Array.isArray(ids) ? ids : [ids]).join(', ')}`);
    return true;
  }

  return { bootstrap, ensureFresh, sync: syncCollections, scheduleSync, remove };
})();
