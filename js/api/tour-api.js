/* ============================================================================
 * tour-api.js — Nối ERP Du lịch với KIO qua KioStore (js/api/kio-api.js)
 *
 * Mô hình:
 *  - App.Store.state vẫn là bản làm việc trong bộ nhớ (các phân hệ không đổi).
 *  - Sau đăng nhập: TẢI toàn bộ từ KIO vào state (loadData).
 *  - Mỗi lần Store.save(): so sánh với ảnh chụp lần đồng bộ trước (snapshot,
 *    băm từng bản ghi) → chỉ ĐẨY bản ghi mới/đã sửa (syncCollection) và bản ghi
 *    đã xóa (deleteKeys). Không bao giờ ghi đè cả bảng trừ khi người dùng chủ
 *    động “nạp lại / xóa / khôi phục” (replaceCollection + allowEmpty + lý do).
 *  - Mất mạng / KIO lỗi: vẫn chạy với dữ liệu trên máy (localStorage), cờ dirty
 *    + snapshot được lưu để lần sau đẩy tiếp phần chưa gửi (không mất dữ liệu).
 *  - Hai người cùng tạo một mã (VD cùng DH0007): phát hiện trước khi ghi, tự đổi
 *    mã bản ghi mới và cập nhật các tham chiếu, không ghi đè dữ liệu người kia.
 *  - Tự kiểm tra thay đổi của người khác mỗi 60 giây / khi quay lại tab.
 *
 * Giới hạn (cần biết): sửa CÙNG MỘT bản ghi trên hai máy gần như đồng thời →
 * người lưu sau thắng (last-write-wins). KIO không có khóa/phiên bản bản ghi.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, Store = App.Store;
  const CFG = window.TOUR_KIO_CONFIG || (typeof TOUR_KIO_CONFIG !== 'undefined' ? TOUR_KIO_CONFIG : null);
  const SNAP_KEY = 'tourerp.synced.v1', DIRTY_KEY = 'tourerp.dirty', BACKUP_KEY = 'tourerp.localbackup';
  const S = () => Store.state;

  const DATA_NAMES = ['config', 'services', 'accounts', 'customers', 'suppliers', 'orders', 'tours', 'vouchers'];
  const PUSH_ORDER = DATA_NAMES.concat('users');
  const REG = {
    users: { get: () => App.Auth.rawUsers(), set: v => App.Auth.setUsers(v) },
    config: { get: () => [{ id: 'config', company: S().settings.company, mailApi: S().settings.mailApi || '' }], set: v => { const c = v[0]; if (c) { if (c.company) S().settings.company = c.company; S().settings.mailApi = c.mailApi || ''; } } },
    services: { get: () => S().settings.services, set: v => { S().settings.services = v; } },
    accounts: { get: () => S().settings.accounts, set: v => { S().settings.accounts = v; } },
    customers: { get: () => S().customers, set: v => { S().customers = v; } },
    suppliers: { get: () => S().suppliers, set: v => { S().suppliers = v; } },
    orders: { get: () => S().orders, set: v => { S().orders = v; } },
    tours: { get: () => S().tours, set: v => { S().tours = v; } },
    vouchers: { get: () => S().vouchers, set: v => { S().vouchers = v; } }
  };
  const LABEL = { users: 'Người dùng', config: 'Cấu hình', services: 'Dịch vụ', accounts: 'Tài khoản NH', customers: 'Khách hàng', suppliers: 'Nhà cung cấp', orders: 'Đơn hàng', tours: 'Tour', vouchers: 'Phiếu thu/chi' };
  const PREFIX = { customers: () => ['KH', 4], suppliers: () => ['NCC', 3], orders: () => ['DH', 4], services: () => ['DV', 2], accounts: () => ['TK', 2], vouchers: r => [r.kind === 'thu' ? 'PT' : 'PC', 4] };
  const MISSING = /doesn'?t exist|does not exist|not exist|không tồn tại|1146|42S02|unknown table|no such table|chưa có bảng/i;

  /* ----------------------------------------------------------- TIỆN ÍCH */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clone = o => JSON.parse(JSON.stringify(o));
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + '.' + s.length; };
  const sig = r => hash(JSON.stringify(r));
  const mapOf = arr => { const m = {}; arr.forEach(r => { m[String(r.id)] = sig(r); }); return m; };
  const sameMap = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => a[k] === b[k]); };
  const natCmp = (a, b) => { const pa = /^(\D*)(\d+)?/.exec(String(a.id)), pb = /^(\D*)(\d+)?/.exec(String(b.id)); return pa[1] === pb[1] ? (Number(pa[2] || 0) - Number(pb[2] || 0)) : pa[1].localeCompare(pb[1]); };
  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'Hết thời gian chờ máy chủ KIO')), ms))]);
  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const isAvailable = () => typeof KioStore !== 'undefined' && typeof getKrudList === 'function' && typeof sendFormDataKRUD === 'function' && typeof krud === 'function';
  const friendly = e => {
    const m = String((e && e.message) || e || 'Lỗi không xác định');
    if (MISSING.test(m)) return 'Máy chủ KIO chưa có bảng cần thiết (' + m.slice(0, 80) + '). Nhờ quản trị viên chạy sql/kio-tables.sql.';
    return m.length > 160 ? m.slice(0, 160) + '…' : m;
  };

  /* ------------------------------------------------------------ TRẠNG THÁI */
  let snap = readJSON(SNAP_KEY, {});
  let mode = 'local';                // local (chưa nạp thư viện KIO) | connecting | online | offline
  let busy = false, lastSync = '', lastError = '', pendingReplace = '', timer = null, retryTimer = null, lastToast = 0;
  const listeners = [];
  // Chỉ đồng bộ những nhóm dữ liệu đã có đường cơ sở với máy chủ (sau khi tải hoặc khởi tạo). Tránh đẩy dữ liệu mẫu cục bộ lên máy chủ trước khi người dùng chọn.
  const ready = new Set();
  const saveSnap = () => { try { localStorage.setItem(SNAP_KEY, JSON.stringify(snap)); } catch (e) { /* noop */ } };
  const isDirty = () => localStorage.getItem(DIRTY_KEY) === '1';
  const setDirty = v => { try { v ? localStorage.setItem(DIRTY_KEY, '1') : localStorage.removeItem(DIRTY_KEY); } catch (e) { /* noop */ } };

  function diffOf(name) {
    if (!ready.has(name)) return { upsert: [], added: [], remove: [] };
    const cur = mapOf(REG[name].get()), old = snap[name] || {}, upsert = [], added = [], remove = [];
    Object.keys(cur).forEach(id => { if (!(id in old)) { added.push(id); upsert.push(id); } else if (old[id] !== cur[id]) upsert.push(id); });
    Object.keys(old).forEach(id => { if (!(id in cur)) remove.push(id); });
    return { upsert, added, remove };
  }
  const pending = () => PUSH_ORDER.reduce((n, k) => { const d = diffOf(k); return n + d.upsert.length + d.remove.length; }, 0);
  function info() {
    const p = mode === 'online' || Object.keys(snap).length ? pending() : 0;
    let status = 'local';
    if (mode === 'connecting') status = 'connecting'; else if (mode === 'offline') status = 'offline';
    else if (mode === 'online') status = busy ? 'syncing' : lastError ? 'error' : p > 0 ? 'waiting' : 'synced';
    return { mode, status, pending: p, lastSync, lastError, tables: CFG ? CFG.tables : {}, hasBackup: !!localStorage.getItem(BACKUP_KEY) };
  }
  const emit = () => { const i = info(); listeners.forEach(f => { try { f(i); } catch (e) { /* noop */ } }); };
  const toastErr = (title, e) => { if (Date.now() - lastToast > 20000) { lastToast = Date.now(); U.toast(title, friendly(e), 'danger'); } };

  /* ------------------------------------------------------------- ĐỌC KIO */
  async function readTable(name) {
    const rows = await withTimeout(KioStore.listCollection(CFG.tables[name], { force: true }), 30000);
    return (rows || []).filter(r => r && r.id != null);
  }
  async function readAll(names) { const out = {}; for (const n of names) out[n] = await readTable(n); return out; }

  // Áp dữ liệu máy chủ vào state. recover=true: giữ lại thay đổi cục bộ chưa gửi (so với snapshot).
  function applyRemote(remotes, recover) {
    Object.keys(remotes).forEach(n => {
      const R = REG[n], remote = remotes[n].slice().sort(natCmp); let result = remote;
      if (recover && snap[n]) {
        const local = R.get(), cur = mapOf(local), old = snap[n], m = new Map(remote.map(r => [String(r.id), r]));
        Object.keys(old).forEach(id => { if (!(id in cur)) m.delete(id); });
        local.forEach(r => { const id = String(r.id); if (!(id in old) || old[id] !== cur[id]) m.set(id, r); });
        result = Array.from(m.values()).sort(natCmp);
      }
      R.set(result); snap[n] = mapOf(remote);
    });
    saveSnap();
  }

  /* ---------------------------------------------------------------- KẾT NỐI */
  async function connect() {
    if (!CFG || !isAvailable()) { mode = 'local'; lastError = 'Chưa nạp được thư viện KIO (list.js / krud.js) — đang chạy cục bộ trên trình duyệt này.'; emit(); return info(); }
    mode = 'connecting'; lastError = ''; emit();
    try {
      const rem = await withTimeout(readAll(['users']), 20000, 'Không kết nối được máy chủ KIO (quá thời gian chờ)');
      if (rem.users.length) applyRemote(rem, isDirty() && !!snap.users);
      ready.add('users'); mode = 'online'; emit(); schedule(200);     // nếu máy chủ chưa có người dùng: đẩy tài khoản admin mặc định lên
    } catch (e) { goOffline(e); }
    return info();
  }
  function goOffline(e) { mode = 'offline'; lastError = friendly(e); emit(); }
  const localIsDemo = () => JSON.stringify(S()) === JSON.stringify(Store.makeSeed());

  // Sau đăng nhập: tải dữ liệu nghiệp vụ. Trả { empty:true } nếu máy chủ chưa có gì (để người dùng chọn cách khởi tạo).
  async function loadData() {
    if (mode !== 'online') return { mode };
    try {
      const remotes = await withTimeout(readAll(DATA_NAMES), 60000, 'Tải dữ liệu từ KIO quá thời gian chờ');
      if (DATA_NAMES.every(n => !remotes[n].length)) return { mode, empty: true };
      const everSynced = DATA_NAMES.some(n => snap[n] && Object.keys(snap[n]).length);
      if (!everSynced && !localIsDemo()) { try { localStorage.setItem(BACKUP_KEY, JSON.stringify(S())); U.toast('Đã giữ bản sao dữ liệu cũ của trình duyệt', 'Xem lại ở Hệ thống → Dữ liệu & sao lưu.', 'info'); } catch (e) { /* noop */ } }
      applyRemote(remotes, isDirty() && everSynced);
      DATA_NAMES.forEach(n => ready.add(n)); Store.persist(); setDirty(pending() > 0); lastError = ''; lastSync = U.nowISO(); emit(); schedule(300);
      return { mode };
    } catch (e) { goOffline(e); return { mode: 'offline', error: e }; }
  }
  // Máy chủ trống: chọn nguồn dữ liệu khởi tạo (local = dùng dữ liệu đang có trong trình duyệt)
  function initServer(choice) {
    if (choice === 'demo') Store.useSeed(); else if (choice === 'blank') Store.useBlank();
    DATA_NAMES.forEach(n => { snap[n] = {}; ready.add(n); }); saveSnap(); Store.persist(); setDirty(true);
    return flush();
  }

  /* ------------------------------------------------------------- ĐẨY LÊN KIO */
  function schedule(ms) {
    if (mode !== 'online') return;
    clearTimeout(timer); timer = setTimeout(flush, ms == null ? CFG.pushDebounceMs : ms); emit();
  }
  function touch() {
    if (mode === 'online') { setDirty(true); schedule(); }
    else { if (Object.keys(snap).length) setDirty(true); emit(); }
  }
  async function retry(fn) {
    let last;
    for (let i = 0; i < 3; i++) { try { return await fn(); } catch (e) { last = e; if (MISSING.test(String(e && e.message))) throw e; await sleep(500 * (i + 1)); } }
    throw last;
  }

  function renumber(name, oldId, remote, local) {
    const rec = local.find(x => String(x.id) === oldId), pf = PREFIX[name](rec), pre = pf[0];
    const nums = remote.concat(local).map(x => String(x.id)).filter(id => id.startsWith(pre) && /^\d+$/.test(id.slice(pre.length))).map(id => Number(id.slice(pre.length)));
    const nid = pre + String(Math.max(0, ...nums) + 1).padStart(pf[1], '0');
    rec.id = nid;
    const st = S();
    if (name === 'customers') st.orders.forEach(o => { if (o.customerId === oldId) o.customerId = nid; });
    if (name === 'suppliers') { st.tours.forEach(t => { t.budget.forEach(l => { if (l.supplierId === oldId) l.supplierId = nid; }); t.bookings.forEach(b => { if (b.supplierId === oldId) b.supplierId = nid; }); }); st.vouchers.forEach(v => { if (v.supplierId === oldId) v.supplierId = nid; }); }
    if (name === 'orders') { st.tours.forEach(t => { if (t.orderId === oldId) { t.orderId = nid; if (t.id === oldId) t.id = nid; } }); st.vouchers.forEach(v => { if (v.orderId === oldId) v.orderId = nid; if (v.tourId === oldId) v.tourId = nid; }); }
    if (name === 'services') st.orders.forEach(o => { if (o.serviceId === oldId) o.serviceId = nid; });
    if (name === 'accounts') st.vouchers.forEach(v => { if (v.accountId === oldId) v.accountId = nid; });
    U.toast('Mã ' + oldId + ' đã được người khác dùng', 'Hệ thống tự đổi mã của bạn thành ' + nid + ' để không ghi đè dữ liệu của họ.', 'warning');
  }
  // true nếu có bản ghi bị đổi mã (cần tính lại diff)
  async function resolveConflicts(name, d) {
    const remote = await readTable(name), rm = new Map(remote.map(r => [String(r.id), r])), local = REG[name].get();
    let changed = false;
    d.added.forEach(id => {
      const rr = rm.get(id); if (!rr) return;
      const lr = local.find(x => String(x.id) === id);
      if (JSON.stringify(rr) === JSON.stringify(lr)) { (snap[name] || (snap[name] = {}))[id] = sig(lr); return; }   // đã có đúng bản này trên máy chủ
      renumber(name, id, remote, local); changed = true;
    });
    if (changed) Store.persist(); saveSnap();
    return changed;
  }
  async function pushName(name) {
    const d = diffOf(name); if (!d.upsert.length && !d.remove.length) return '';
    if (d.added.length && PREFIX[name] && await resolveConflicts(name, d)) return 'restart';
    const table = CFG.tables[name], recs = REG[name].get(), byId = new Map(recs.map(r => [String(r.id), r]));
    const items = d.upsert.map(id => byId.get(id)).filter(Boolean), sigs = {}; items.forEach(r => { sigs[String(r.id)] = sig(r); });
    if (items.length) await retry(() => KioStore.syncCollection(table, clone(items)));
    if (d.remove.length) await retry(() => KioStore.deleteKeys(table, d.remove));
    const old = snap[name] || (snap[name] = {});
    Object.keys(sigs).forEach(id => { old[id] = sigs[id]; }); d.remove.forEach(id => { delete old[id]; });
    saveSnap(); return '';
  }
  async function replaceAllNow(reason) {
    for (const name of DATA_NAMES) {
      const items = clone(REG[name].get());
      await retry(() => KioStore.replaceCollection(CFG.tables[name], items, { allowEmpty: true, reason }));
      snap[name] = mapOf(items); ready.add(name);
    }
    saveSnap();
  }
  async function flush() {
    if (mode !== 'online') return;
    if (busy) { schedule(300); return; }
    busy = true; lastError = ''; clearTimeout(retryTimer); emit();
    try {
      if (pendingReplace) { const why = pendingReplace; pendingReplace = ''; await replaceAllNow(why); }
      for (let guard = 0; guard < 30; guard++) {
        let restart = false;
        for (const n of PUSH_ORDER) { if (await pushName(n) === 'restart') { restart = true; break; } }
        if (!restart) break;
        if (guard === 29) throw new Error('Quá nhiều xung đột mã, hãy tải lại dữ liệu từ máy chủ');
      }
      lastSync = U.nowISO(); setDirty(pending() > 0);
    } catch (e) {
      lastError = friendly(e); toastErr('Đồng bộ lên máy chủ thất bại', e);
      retryTimer = setTimeout(flush, 15000);
    } finally { busy = false; emit(); }
  }
  const requestReplace = reason => { pendingReplace = (reason && reason.length >= 8) ? reason : 'Thay thế dữ liệu theo yêu cầu của quản trị viên'; setDirty(true); schedule(50); };

  /* ------------------------------------------------- KIỂM TRA THAY ĐỔI TỪ NGƯỜI KHÁC */
  async function refresh(manual) {
    if (mode !== 'online' || busy || !ready.has('orders')) return false;
    if (!manual && (isDirty() || pending() > 0 || document.hidden || document.querySelector('.modal.show'))) return false;
    try {
      const remotes = await readAll(DATA_NAMES.concat('users')); let changed = false;
      Object.keys(remotes).forEach(n => { if (!sameMap(mapOf(remotes[n].slice().sort(natCmp)), mapOf(REG[n].get()))) changed = true; });
      if (changed) {
        applyRemote(remotes, pending() > 0); Store.persist();
        if (App.Router && App.Auth.current()) App.Router.refresh();
        if (App.refreshChrome) App.refreshChrome();
        if (manual) U.toast('Đã cập nhật dữ liệu mới từ máy chủ', '', 'info');
      }
      lastSync = U.nowISO(); lastError = ''; emit(); return changed;
    } catch (e) { lastError = friendly(e); emit(); if (manual) toastErr('Không tải được dữ liệu mới', e); return false; }
  }
  async function syncNow() {
    if (mode !== 'online') return reconnect();
    clearTimeout(timer); await flush();
    while (busy) await sleep(100);
    return refresh(true);
  }
  async function reconnect() {
    const i = await connect();
    if (i.mode === 'online' && App.Auth.current()) { const r = await loadData(); if (r.empty) return r; if (App.Router) App.Router.refresh(); if (App.refreshChrome) App.refreshChrome(); }
    return i;
  }

  window.addEventListener('beforeunload', e => { if (mode === 'online' && (busy || pending() > 0)) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
  setInterval(() => { if (CFG) refresh(false); }, (CFG && CFG.pollMs) || 60000);

  App.TourAPI = {
    connect, loadData, initServer, flush, refresh, syncNow, reconnect, touch, requestReplace, info, localIsDemo,
    onStatus: f => { listeners.push(f); },
    isOnline: () => mode === 'online',
    labels: LABEL,
    localCounts: () => PUSH_ORDER.map(n => ({ name: n, label: LABEL[n], table: CFG ? CFG.tables[n] : '', count: REG[n].get().length })),
    backupJSON: () => localStorage.getItem(BACKUP_KEY)
  };
})();
