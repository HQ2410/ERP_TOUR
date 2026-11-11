/* ============================================================================
 * HR API - KIO PERSISTENCE
 * ----------------------------------------------------------------------------
 * Trách nhiệm duy nhất của file này:
 *   1) Nạp danh sách nhân sự (DB.employees) từ bảng lenam_hr_employees trên
 *      KIO server
 *   2) Đồng bộ DB.employees lên đúng bảng đó khi có thay đổi
 *   3) Seed đúng 1 lần: nếu server chưa có nhân sự nào, đẩy dữ liệu demo
 *      hiện có trong DB.employees (từ js/data/data.js) lên server, để không
 *      mất dữ liệu demo ban đầu nhưng cũng không ghi đè dữ liệu thật sau này.
 *
 * Trước file này, mod-hr.js chỉ sửa DB.employees trong bộ nhớ — không có
 * API/localStorage/fetch nào ghi lên server, nên thêm/sửa/khóa/import nhân sự
 * bị mất mỗi khi tải lại trang. KHÔNG chứa business logic nhân sự; luồng
 * nghiệp vụ vẫn nằm nguyên trong mod-hr.js.
 * ========================================================================== */
const HRAPI = (() => {
  const TABLE = KIO_CONFIG.hrTables.employees;
  const CACHE_KEY = KIO_CONFIG.storageKeys.hrCache;
  const SEED_KEY = KIO_CONFIG.storageKeys.hrDemoSeed;

  let booted = false;
  let seedPromise = null;
  let syncChain = Promise.resolve();
  let syncTimer = null;
  let lastLoaded = 0;
  const REFRESH_TTL = 2 * 60 * 1000;

  function clone(v) {
    return typeof KioDataUtils !== 'undefined' ? KioDataUtils.clone(v) : JSON.parse(JSON.stringify(v));
  }
  function readCache() {
    return typeof KioDataUtils !== 'undefined' ? KioDataUtils.readJson(CACHE_KEY) : null;
  }
  function writeCache() {
    const payload = { employees: clone(Array.isArray(DB.employees) ? DB.employees : []) };
    if (typeof KioDataUtils !== 'undefined') KioDataUtils.writeJson(CACHE_KEY, payload);
  }
  function storageGet(key) {
    return typeof KioDataUtils !== 'undefined' ? KioDataUtils.storageGet(key) : (() => { try { return localStorage.getItem(key); } catch (_) { return null; } })();
  }
  function storageSet(key, val) {
    if (typeof KioDataUtils !== 'undefined') KioDataUtils.storageSet(key, val);
    else try { localStorage.setItem(key, val); } catch (_) {}
  }

  // Migration/seed chỉ chạy một lần. Nếu server đã có nhân sự (dù chỉ 1 người),
  // KHÔNG tự seed lại demo — server rỗng lúc đó là trạng thái hợp lệ.
  // Trả về true nếu lần gọi này đã thay DB.employees (để caller biết cần render lại).
  // Dùng một Promise dùng chung: nếu 2 nơi gọi ensureFresh cùng lúc trong lần chạy
  // đầu tiên thì nơi thứ hai phải ĐỢI seed xong, không được đọc bảng rỗng rồi ghi
  // đè mảng demo đang được seed.
  function seedIfNeeded() {
    if (seedPromise) return seedPromise;
    seedPromise = (async () => {
      if (storageGet(SEED_KEY) === '1') return false;
      try {
        let applied = false;
        const remote = await KioStore.listCollection(TABLE);
        if (Array.isArray(remote) && remote.length) {
          DB.employees = remote;
          lastLoaded = Date.now();
          applied = true;
        } else if (Array.isArray(DB.employees) && DB.employees.length) {
          await KioStore.syncCollection(TABLE, clone(DB.employees));
          lastLoaded = Date.now();
          console.info(`[HRAPI] Đã seed ${DB.employees.length} nhân sự demo lên KIO (lần đầu).`);
        }
        storageSet(SEED_KEY, '1');
        writeCache();
        return applied;
      } catch (err) {
        // Không đánh dấu đã seed nếu request lỗi — thử lại ở lần gọi sau.
        seedPromise = null;
        console.warn('[HRAPI] Seed nhân sự lần đầu thất bại; giữ dữ liệu hiện tại:', err);
        return false;
      }
    })();
    return seedPromise;
  }

  async function bootstrap() {
    if (booted) return true;
    booted = true;
    const cached = readCache();
    if (cached && Array.isArray(cached.employees) && cached.employees.length) {
      DB.employees = cached.employees;
      console.info('[HRAPI] Đã nạp cache nhân sự gần nhất.');
    }
    return true;
  }

  // Chữ ký (keys, opts) giữ để tương thích với routeRefreshPlan/DataWarmup
  // dùng chung cho mọi API — HR chỉ có một collection nên keys không dùng tới.
  async function ensureFresh(keys, { force = false } = {}) {
    await bootstrap();
    const seeded = await seedIfNeeded();
    if (!force && lastLoaded && Date.now() - lastLoaded < REFRESH_TTL) return seeded ? { employees: true } : {};
    try {
      const rows = await KioStore.listCollection(TABLE, { force });
      if (Array.isArray(rows)) {
        DB.employees = rows;
        lastLoaded = Date.now();
        writeCache();
        return { employees: true };
      }
    } catch (err) {
      console.warn('[HRAPI] Không đọc được danh sách nhân sự từ KIO; giữ dữ liệu hiện tại:', err);
    }
    return {};
  }

  function sync() {
    syncChain = syncChain.catch(() => {}).then(async () => {
      await KioStore.syncCollection(TABLE, clone(Array.isArray(DB.employees) ? DB.employees : []));
      lastLoaded = Date.now();
      writeCache();
      console.info('[HRAPI] Đã đồng bộ nhân sự lên KIO.');
      return true;
    }).catch(err => {
      console.error('[HRAPI] Đồng bộ nhân sự lên KIO thất bại:', err);
      if (typeof Toast !== 'undefined') Toast.err('Không lưu được dữ liệu nhân sự lên server', err.message);
      throw err;
    });
    return syncChain;
  }

  function scheduleSync(delay = 180) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { sync().catch(() => {}); }, delay);
  }

  return { bootstrap, ensureFresh, sync, scheduleSync };
})();
