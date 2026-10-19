(function () {
  'use strict';
  const App = window.App, U = App.UI;
  const USERS_KEY = 'tourerp.users.v1', SESSION_KEY = 'tourerp.session', FAIL_KEY = 'tourerp.fails';
  const MAX_FAILS = 5, LOCK_MS = 60000, SESSION_MS = 8 * 3600e3, REMEMBER_MS = 30 * 24 * 3600e3, ITER = 2000;
  const ROLES = { admin: 'Quản trị viên', staff: 'Nhân viên' };

  /* ------------------------------------------------------------- SHA-256 */
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(msg) {
    const bytes = new TextEncoder().encode(msg), l = bytes.length, bits = l * 8, padLen = ((l + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(padLen); buf.set(bytes); buf[l] = 0x80;
    const dv = new DataView(buf.buffer); dv.setUint32(padLen - 8, Math.floor(bits / 0x100000000)); dv.setUint32(padLen - 4, bits >>> 0);
    let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const w = new Uint32Array(64);
    for (let o = 0; o < padLen; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = (w[i - 16] + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + w[i - 7] + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10))) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h = [h[0] + a, h[1] + b, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map(x => x >>> 0);
    }
    return h.map(x => x.toString(16).padStart(8, '0')).join('');
  }
  function derive(pw, salt) { let d = sha256(salt + ':' + pw); for (let i = 0; i < ITER; i++) d = sha256(d + salt + pw); return d; }
  function randHex(n) {
    const a = new Uint8Array(n);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a).map(x => x.toString(16).padStart(2, '0')).join('');
  }

  /* -------------------------------------------------------------- NGƯỜI DÙNG */
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* noop */ } };
  let users = read(USERS_KEY, null);
  if (!Array.isArray(users) || !users.length) {
    const salt = randHex(12);
    users = [{ id: 'U001', username: 'admin', name: 'Admin', role: 'admin', salt, hash: derive('admin123', salt), active: true, mustChange: true, lastLogin: '' }];
    write(USERS_KEY, users);
  }
  const save = () => { write(USERS_KEY, users); if (App.TourAPI) App.TourAPI.touch(); };
  const byName = n => users.find(u => u.username === String(n || '').trim().toLowerCase());
  const byId = id => users.find(u => u.id === id);

  const Auth = {
    ROLES, sha256,
    users: () => users,
    rawUsers: () => users,
    setUsers(arr) { users = arr; write(USERS_KEY, users); },
    roleLabel: r => ROLES[r] || r,
    defaultPasswordInUse: () => users.some(u => u.username === 'admin' && u.mustChange && u.active),
    activeAdmins: () => users.filter(u => u.role === 'admin' && u.active).length,

    /* ----- phiên làm việc */
    current() {
      let s = null;
      try { s = JSON.parse(sessionStorage.getItem(SESSION_KEY)) || JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { s = null; }
      if (!s || !s.uid || s.exp < Date.now()) return null;
      const u = byId(s.uid); return u && u.active ? u : null;
    },
    isAdmin() { const u = Auth.current(); return !!u && u.role === 'admin'; },
    startSession(u, remember) {
      const s = JSON.stringify({ uid: u.id, exp: Date.now() + (remember ? REMEMBER_MS : SESSION_MS) });
      Auth.clearSession(); try { (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, s); } catch (e) { /* noop */ }
    },
    clearSession() { try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ } },
    logout() { Auth.clearSession(); },

    /* ----- đăng nhập, khóa tạm khi sai nhiều lần */
    login(username, pw, remember) {
      const key = String(username || '').trim().toLowerCase(), fails = read(FAIL_KEY, {}), f = fails[key] || { n: 0, until: 0 };
      if (f.until > Date.now()) return { ok: false, error: 'Đăng nhập sai quá nhiều lần. Thử lại sau ' + Math.ceil((f.until - Date.now()) / 1000) + ' giây.' };
      const u = byName(key), good = u && derive(pw, u.salt) === u.hash;
      if (!good) {
        f.n = (f.until && f.until <= Date.now() ? 0 : f.n) + 1; if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
        fails[key] = f; write(FAIL_KEY, fails);
        return { ok: false, error: f.until > Date.now() ? 'Đăng nhập sai quá nhiều lần. Tài khoản bị khóa tạm 60 giây.' : 'Tên đăng nhập hoặc mật khẩu không đúng.' };
      }
      if (!u.active) return { ok: false, error: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' };
      delete fails[key]; write(FAIL_KEY, fails);
      u.lastLogin = U.nowISO(); save(); Auth.startSession(u, remember);
      return { ok: true, user: u };
    },

    /* ----- quản lý mật khẩu / người dùng */
    checkPassword(pw) { return String(pw || '').length >= 6 ? '' : 'Mật khẩu tối thiểu 6 ký tự'; },
    setPassword(id, pw, mustChange) { const u = byId(id); u.salt = randHex(12); u.hash = derive(pw, u.salt); u.mustChange = !!mustChange; save(); },
    changePassword(id, oldPw, newPw) {
      const u = byId(id); if (!u || derive(oldPw, u.salt) !== u.hash) return 'Mật khẩu hiện tại không đúng';
      const e = Auth.checkPassword(newPw); if (e) return e; if (newPw === oldPw) return 'Mật khẩu mới phải khác mật khẩu cũ';
      Auth.setPassword(id, newPw, false); return '';
    },
    addUser(d) {
      const username = String(d.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._]{3,30}$/.test(username)) return 'Tên đăng nhập 3–30 ký tự: chữ thường, số, dấu . hoặc _';
      if (byName(username)) return 'Tên đăng nhập đã tồn tại';
      if (!String(d.name || '').trim()) return 'Nhập họ tên';
      const pe = Auth.checkPassword(d.password); if (pe) return pe;
      const n = users.reduce((m, u) => Math.max(m, Number(u.id.slice(1)) || 0), 0) + 1, salt = randHex(12);
      users.push({ id: 'U' + String(n).padStart(3, '0'), username, name: d.name.trim(), role: d.role === 'admin' ? 'admin' : 'staff', salt, hash: derive(d.password, salt), active: true, mustChange: true, lastLogin: '' });
      save(); return '';
    },
    updateUser(id, d) {
      const u = byId(id), me = Auth.current();
      if (!String(d.name || '').trim()) return 'Nhập họ tên';
      if (u.role === 'admin' && (d.role !== 'admin' || d.active === false) && Auth.activeAdmins() <= 1) return 'Phải còn ít nhất một quản trị viên đang hoạt động';
      if (me && me.id === id && d.active === false) return 'Bạn không thể tự khóa tài khoản của mình';
      u.name = d.name.trim(); u.role = d.role === 'admin' ? 'admin' : 'staff'; if (typeof d.active === 'boolean') u.active = d.active; save(); return '';
    },
    deleteUser(id) {
      const u = byId(id), me = Auth.current();
      if (me && me.id === id) return 'Bạn không thể xóa tài khoản đang đăng nhập';
      if (u.role === 'admin' && u.active && Auth.activeAdmins() <= 1) return 'Phải còn ít nhất một quản trị viên đang hoạt động';
      users = users.filter(x => x.id !== id); save(); return '';
    }
  };
  App.Auth = Auth;

  /* ------------------------------------------------------- MÀN HÌNH ĐĂNG NHẬP */
  Auth.bindLogin = function (onSuccess) {
    const form = U.$('#loginForm'), err = U.$('#loginErr'), hint = U.$('#loginHint'), pw = U.$('#lgPass');
    const showErr = m => { err.textContent = m; err.style.display = m ? 'flex' : 'none'; };
    Auth.resetLogin = () => { form.reset(); showErr(''); hint.style.display = Auth.defaultPasswordInUse() ? '' : 'none'; pw.type = 'password'; U.$('#lgEye i').className = 'fa-regular fa-eye'; setTimeout(() => U.$('#lgUser').focus(), 50); };
    U.$('#lgEye').onclick = () => { const show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; U.$('#lgEye i').className = 'fa-regular fa-eye' + (show ? '-slash' : ''); };
    form.onsubmit = e => {
      e.preventDefault(); showErr('');
      const u = U.$('#lgUser').value.trim(), p = pw.value;
      if (!u || !p) { showErr('Vui lòng nhập tên đăng nhập và mật khẩu.'); return; }
      const btn = U.$('#lgBtn'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>Đang đăng nhập…';
      setTimeout(() => { // cho trình duyệt kịp vẽ trạng thái “đang đăng nhập” (băm mật khẩu mất vài chục ms)
        const r = Auth.login(u, p, U.$('#lgRemember').checked);
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i>Đăng nhập';
        if (!r.ok) { showErr(r.error); pw.value = ''; pw.focus(); return; }
        onSuccess(r.user);
      }, 30);
    };
    Auth.resetLogin();
  };

  /* ---------------------------------------------------------- ĐỔI MẬT KHẨU */
  Auth.openChangePassword = function (forced) {
    const me = Auth.current(); if (!me) return;
    const html = (forced ? '<div class="callout warn mb"><i class="fa-solid fa-triangle-exclamation"></i><div>Tài khoản đang dùng <b>mật khẩu mặc định/tạm thời</b>. Hãy đặt mật khẩu mới để bảo vệ dữ liệu.</div></div>' : '') +
      U.field({ id: 'old', label: 'Mật khẩu hiện tại', req: true, html: U.input({ id: 'old', type: 'password', attrs: 'autocomplete="current-password"' }) }) +
      U.field({ id: 'n1', label: 'Mật khẩu mới', req: true, hint: 'Tối thiểu 6 ký tự', html: U.input({ id: 'n1', type: 'password', attrs: 'autocomplete="new-password"' }) }) +
      U.field({ id: 'n2', label: 'Nhập lại mật khẩu mới', req: true, html: U.input({ id: 'n2', type: 'password', attrs: 'autocomplete="new-password"' }) });
    U.modal({
      title: forced ? 'Đổi mật khẩu mặc định' : 'Đổi mật khẩu', sub: me.name + ' · ' + me.username, size: 'sm', static: true, body: html,
      foot: [{ label: forced ? 'Để sau' : 'Hủy' }, {
        label: 'Đổi mật khẩu', icon: 'key', cls: 'btn-primary', onClick: h => {
          const b = h.body; U.clearErr(b); const o = b.querySelector('#old').value, n1 = b.querySelector('#n1').value, n2 = b.querySelector('#n2').value; let ok = true;
          if (!o) ok = U.invalid(b, 'old', 'Nhập mật khẩu hiện tại');
          const pe = Auth.checkPassword(n1); if (pe) ok = U.invalid(b, 'n1', pe); else if (n1 === o) ok = U.invalid(b, 'n1', 'Mật khẩu mới phải khác mật khẩu cũ');
          if (n2 !== n1) ok = U.invalid(b, 'n2', 'Mật khẩu nhập lại không khớp');
          if (!ok) { U.focusFirstInvalid(b); return; }
          const e = Auth.changePassword(me.id, o, n1); if (e) { U.invalid(b, 'old', e); return; }
          h.close(); U.toast('Đã đổi mật khẩu', 'Lần đăng nhập sau hãy dùng mật khẩu mới.');
          const hint = U.$('#loginHint'); if (hint) hint.style.display = Auth.defaultPasswordInUse() ? '' : 'none';
        }
      }]
    });
  };
})();
