/* ============================================================================
 * core.js — Tiện ích dùng chung: định dạng, modal, toast, bảng + phân trang,
 * xuất Excel, xem trước / in PDF, biểu đồ, router.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App;
  const U = (App.UI = {});

  /* ------------------------------------------------------------- ĐỊNH DẠNG */
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  U.$ = (s, r = document) => r.querySelector(s);
  U.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  U.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.fmt = n => (Number(n) || 0).toLocaleString('vi-VN');
  U.money = n => U.fmt(n) + ' ₫';
  U.num = v => Number(String(v == null ? '' : v).replace(/\D/g, '')) || 0;
  U.todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  U.fdate = iso => { if (!iso) return '—'; const p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
  U.nowISO = () => { const d = new Date(); return U.todayISO() + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  U.fdatetime = iso => { if (!iso) return '—'; return U.fdate(iso) + ' ' + String(iso).slice(11, 16); };
  U.norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
  U.monthKey = iso => String(iso || '').slice(0, 7);
  U.monthLabel = k => { const p = k.split('-'); return p[1] + '/' + p[0]; };
  U.daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  U.signed = n => '<span class="' + (n < 0 ? 'money-neg' : n > 0 ? 'money-pos' : '') + '">' + U.money(n) + '</span>';

  const DG = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  function read3(x, full) {
    const tr = Math.floor(x / 100), ch = Math.floor((x % 100) / 10), dv = x % 10, p = [];
    if (tr > 0 || full) p.push(DG[tr] + ' trăm');
    if (ch > 1) { p.push(DG[ch] + ' mươi'); if (dv === 1) p.push('mốt'); else if (dv === 5) p.push('lăm'); else if (dv > 0) p.push(DG[dv]); }
    else if (ch === 1) { p.push('mười'); if (dv === 5) p.push('lăm'); else if (dv > 0) p.push(DG[dv]); }
    else if (dv > 0) { if (tr > 0 || full) p.push('linh'); p.push(DG[dv]); }
    return p.join(' ');
  }
  U.numWords = function (n) {
    n = Math.round(Number(n) || 0);
    if (n <= 0) return 'Không đồng';
    const groups = []; let x = n;
    while (x > 0) { groups.push(x % 1000); x = Math.floor(x / 1000); }
    const out = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i] === 0) continue;
      const s = read3(groups[i], i < groups.length - 1);
      out.push(s + (UNITS[i] ? ' ' + UNITS[i] : ''));
    }
    const t = out.join(' ');
    return t.charAt(0).toUpperCase() + t.slice(1) + ' đồng chẵn';
  };

  // Ô nhập tiền: tự thêm dấu chấm ngăn cách hàng nghìn
  document.addEventListener('input', e => {
    const t = e.target;
    if (t && t.matches && t.matches('input[data-money]')) {
      const raw = t.value.replace(/\D/g, '');
      t.value = raw ? Number(raw).toLocaleString('vi-VN') : '';
    }
  });

  /* ------------------------------------------------------------ THÀNH PHẦN */
  U.badge = (text, tone, nodot) => '<span class="badge ' + (tone || 'slate') + (nodot ? ' no-dot' : '') + '">' + U.esc(text) + '</span>';
  U.mkpi = o => '<div class="mkpi"><div class="mkpi-ico t-' + (o.tone || 'blue') + '"><i class="fa-solid fa-' + o.icon + '"></i></div><div style="min-width:0"><div class="mkpi-label">' +
    U.esc(o.label) + '</div><div class="mkpi-value">' + o.value + '</div>' + (o.sub ? '<div class="cell-sub">' + o.sub + '</div>' : '') + '</div></div>';
  U.tabs = (items, active) => '<div class="tabs">' + items.map(t => '<button type="button" class="tab' + (t.key === active ? ' active' : '') + '" data-tab="' + t.key + '">' +
    (t.icon ? '<i class="fa-solid fa-' + t.icon + '" style="margin-right:6px"></i>' : '') + U.esc(t.label) + (t.cnt != null ? '<span class="cnt">' + t.cnt + '</span>' : '') + '</button>').join('') + '</div>';
  U.empty = (icon, title, text) => '<div class="empty"><div class="empty-ico"><i class="fa-solid fa-' + icon + '"></i></div><h4>' + U.esc(title) + '</h4><p>' + U.esc(text || '') + '</p></div>';
  U.iconBtn = (act, id, icon, title, extra) => '<button type="button" class="btn btn-ghost btn-icon' + (extra ? ' ' + extra : '') + '" data-act="' + act + '" data-id="' + U.esc(id) + '" title="' + U.esc(title) + '"><i class="fa-solid fa-' + icon + '"></i></button>';

  // Trường form
  U.field = o => '<div class="field' + (o.cls ? ' ' + o.cls : '') + '" data-f="' + o.id + '"><label>' + o.label + (o.req ? ' <span class="req">*</span>' : '') + '</label>' + o.html +
    (o.hint ? '<div class="cell-sub" style="margin-top:4px">' + o.hint + '</div>' : '') + '<div class="err"></div></div>';
  U.input = o => '<input class="inp" id="' + o.id + '" type="' + (o.type || 'text') + '"' + (o.money ? ' data-money inputmode="numeric"' : '') +
    ' value="' + U.esc(o.value == null ? '' : (o.money ? U.fmt(o.value) : o.value)) + '"' + (o.ph ? ' placeholder="' + U.esc(o.ph) + '"' : '') + (o.attrs ? ' ' + o.attrs : '') + '>';
  U.select = o => '<select class="inp" id="' + o.id + '"' + (o.attrs ? ' ' + o.attrs : '') + '>' + (o.ph ? '<option value="">' + U.esc(o.ph) + '</option>' : '') +
    o.options.map(x => '<option value="' + U.esc(x.v) + '"' + (String(x.v) === String(o.value) ? ' selected' : '') + '>' + U.esc(x.l) + '</option>').join('') + '</select>';
  U.textarea = o => '<textarea class="inp" id="' + o.id + '" rows="' + (o.rows || 3) + '"' + (o.ph ? ' placeholder="' + U.esc(o.ph) + '"' : '') + '>' + U.esc(o.value || '') + '</textarea>';
  U.invalid = (root, id, msg) => { const f = root.querySelector('[data-f="' + id + '"]'); if (f) { f.classList.add('invalid'); f.querySelector('.err').textContent = msg; } return false; };
  U.clearErr = root => root.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
  U.val = (root, id) => { const e = root.querySelector('#' + id); return e ? e.value.trim() : ''; };
  U.money$ = (root, id) => U.num(U.val(root, id));
  U.focusFirstInvalid = root => { const f = root.querySelector('.field.invalid .inp'); if (f) f.focus(); };

  /* --------------------------------------------------------------- BẢNG */
  U.table = function (o) {
    const size = o.size || 10, st = o.st || { page: 1 }, total = o.rows.length;
    const pages = Math.max(1, Math.ceil(total / size));
    st.page = Math.min(Math.max(1, st.page || 1), pages);
    const slice = o.rows.slice((st.page - 1) * size, st.page * size);
    if (!total) return '<div class="card-body">' + (o.empty || U.empty('inbox', 'Chưa có dữ liệu', '')) + '</div>';
    const head = '<tr>' + o.cols.map(c => '<th class="' + (c.cls || '') + '">' + c.label + '</th>').join('') + '</tr>';
    const body = slice.map(r => '<tr class="' + (o.rowCls ? o.rowCls(r) : '') + '" ' + (o.rowAttr ? o.rowAttr(r) : '') + '>' +
      o.cols.map(c => '<td class="' + (c.cls || '') + '" data-label="' + U.esc(String(c.label).replace(/<[^>]*>/g, '')) + '"><div class="td-v">' + c.render(r) + '</div></td>').join('') + '</tr>').join('');
    const foot = o.foot ? '<tfoot>' + o.foot + '</tfoot>' : '';
    let pager = '';
    if (total > size) {
      const a = (st.page - 1) * size + 1, b = Math.min(total, st.page * size);
      const nums = [];
      for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - st.page) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
      pager = '<div class="pagi"><div class="pagi-info">Hiển thị ' + a + '–' + b + ' / ' + total + '</div><div class="pagi-btns">' +
        '<button class="pg" data-pg="prev"' + (st.page === 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>' +
        nums.map(n => n === '…' ? '<button class="pg dots" disabled>…</button>' : '<button class="pg' + (n === st.page ? ' active' : '') + '" data-pg="' + n + '">' + n + '</button>').join('') +
        '<button class="pg" data-pg="next"' + (st.page === pages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button></div></div>';
    } else pager = o.nopager ? '' : '<div class="pagi"><div class="pagi-info">Tổng ' + total + ' bản ghi</div></div>';
    return '<div class="tbl-wrap"><table class="tbl tbl-stack"><thead>' + head + '</thead><tbody>' + body + '</tbody>' + foot + '</table></div>' + pager;
  };
  // Trả về true nếu sự kiện click là bấm nút phân trang (đã đổi trang trong st)
  U.pagerClick = function (e, st) {
    const b = e.target.closest('[data-pg]'); if (!b || b.disabled) return false;
    const v = b.dataset.pg; st.page = v === 'prev' ? st.page - 1 : v === 'next' ? st.page + 1 : Number(v);
    return true;
  };

  /* ------------------------------------------------------------- TOAST */
  U.toast = function (title, msg, type, act) {
    type = type || 'success';
    const ico = { success: ['check', 'green'], warning: ['triangle-exclamation', 'orange'], danger: ['xmark', 'red'], info: ['info', 'blue'] }[type] || ['info', 'blue'];
    const t = document.createElement('div');
    t.className = 'toast ' + (type === 'info' ? '' : type);
    t.innerHTML = '<span class="toast-ico t-' + ico[1] + '"><i class="fa-solid fa-' + ico[0] + '"></i></span><div><b>' + U.esc(title) + '</b>' + (msg ? '<p>' + U.esc(msg) + '</p>' : '') +
      (act ? '<button type="button" class="toast-act">' + U.esc(act.label) + '</button>' : '') + '</div><button type="button" class="x" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button>';
    $('#toasts').appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    const close = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); };
    t.querySelector('.x').onclick = close;
    if (act) t.querySelector('.toast-act').onclick = () => { act.fn(); close(); };
    setTimeout(close, act ? 7000 : 4200);
  };
  const $ = U.$;

  /* ------------------------------------------------------------- MODAL */
  let zc = 0; const stack = [];
  U.modal = function (o) {
    const n = ++zc;
    const ov = document.createElement('div'); ov.className = 'overlay'; ov.style.zIndex = 80 + n * 2;
    const host = document.createElement('div'); host.className = 'modal-host'; host.style.zIndex = 81 + n * 2;
    const m = document.createElement('div'); m.className = 'modal ' + (o.size || '');
    m.innerHTML = '<div class="modal-head"><div style="min-width:0"><h3>' + U.esc(o.title) + '</h3>' + (o.sub ? '<p>' + o.sub + '</p>' : '') + '</div>' +
      '<button type="button" class="btn btn-ghost btn-icon x" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button></div><div class="modal-body">' + (o.body || '') + '</div>' +
      ((o.foot && o.foot.length) ? '<div class="modal-foot">' + o.foot.map((b, i) => '<button type="button" class="btn ' + (b.cls || '') + (b.left ? ' left' : '') + '" data-foot="' + i + '">' +
        (b.icon ? '<i class="fa-solid fa-' + b.icon + '"></i>' : '') + U.esc(b.label) + '</button>').join('') + '</div>' : '');
    host.appendChild(m); document.body.appendChild(ov); document.body.appendChild(host);
    const h = {
      el: m, body: m.querySelector('.modal-body'), closed: false,
      $: s => m.querySelector(s),
      close() {
        if (h.closed) return; h.closed = true;
        const i = stack.indexOf(h); if (i >= 0) stack.splice(i, 1);
        m.classList.remove('show'); ov.classList.remove('show');
        setTimeout(() => { ov.remove(); host.remove(); }, 220);
        if (o.onClose) o.onClose();
      }
    };
    stack.push(h);
    m.querySelector('.x').onclick = h.close;
    if (!o.static) ov.onclick = h.close;
    host.onclick = e => { if (e.target === host && !o.static) h.close(); };
    (o.foot || []).forEach((b, i) => {
      const btn = m.querySelector('[data-foot="' + i + '"]');
      btn.onclick = () => { if (b.onClick) b.onClick(h, btn); else h.close(); };
    });
    requestAnimationFrame(() => { ov.classList.add('show'); m.classList.add('show'); });
    if (o.onMount) o.onMount(h);
    const first = m.querySelector('.modal-body .inp:not([disabled])'); if (first && !o.noFocus) setTimeout(() => first.focus(), 60);
    return h;
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) { const t = stack[stack.length - 1]; t.close(); } });
  U.confirm = o => new Promise(res => {
    U.modal({
      title: o.title || 'Xác nhận', size: 'sm', static: true, body: '<p style="font-size:13.5px;line-height:1.6">' + o.message + '</p>',
      foot: [{ label: o.cancel || 'Hủy', onClick: h => { res(false); h.close(); } },
        { label: o.ok || 'Đồng ý', cls: o.danger ? 'btn-danger' : 'btn-primary', icon: o.icon, onClick: h => { res(true); h.close(); } }],
      onClose: () => res(false), noFocus: true
    });
  });

  /* ---------------------------------------------------------- POPUP MENU */
  U.pop = function (anchor, html, opt) {
    const p = $('#pop'); p.innerHTML = html; p.className = 'pop' + (opt && opt.cls ? ' ' + opt.cls : '');
    const r = anchor.getBoundingClientRect(); p.style.top = (r.bottom + 8) + 'px'; p.style.left = 'auto'; p.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    if (opt && opt.left) { p.style.left = r.left + 'px'; p.style.right = 'auto'; }
    requestAnimationFrame(() => p.classList.add('show'));
    return p;
  };
  U.popClose = () => { const p = $('#pop'); if (p) p.classList.remove('show'); };
  document.addEventListener('click', e => { if (!e.target.closest('#pop') && !e.target.closest('[data-pop]')) U.popClose(); });

  /* ------------------------------------------------------- XUẤT EXCEL / CSV */
  U.download = function (filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  U.exportXlsx = function (o) {
    const co = App.Store.state.settings.company;
    const aoa = [];
    if (o.title) { aoa.push([o.title]); aoa.push([co.name + (o.subtitle ? ' — ' + o.subtitle : '') + ' — Xuất ngày ' + U.fdate(U.todayISO())]); aoa.push([]); }
    const headRow = aoa.length; aoa.push(o.headers); o.rows.forEach(r => aoa.push(r));
    if (o.totals) aoa.push(o.totals);
    const name = o.filename + '-' + U.todayISO();
    if (window.XLSX) {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = o.headers.map((h, i) => ({ wch: Math.min(48, Math.max(String(h).length + 2, ...o.rows.slice(0, 200).map(r => String(r[i] == null ? '' : r[i]).length + 2))) }));
      (o.moneyCols || []).forEach(ci => { for (let r = headRow + 1; r < aoa.length; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: ci })]; if (c && c.t === 'n') c.z = '#,##0'; } });
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, String(o.sheet || 'Dữ liệu').slice(0, 31));
      XLSX.writeFile(wb, name + '.xlsx');
    } else {
      const csv = '\ufeff' + aoa.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
      U.download(name + '.csv', csv, 'text/csv;charset=utf-8');
    }
    U.toast('Đã xuất file', name + (window.XLSX ? '.xlsx' : '.csv'), 'success');
  };

  /* --------------------------------------------------- XEM TRƯỚC / IN / PDF */
  const DOC_CSS = '@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:"Times New Roman",Times,serif;font-size:13px;color:#111;line-height:1.5;margin:0;padding:6px}' +
    '.doc-head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px;font-size:12px}.doc-head b{font-size:14px;text-transform:uppercase}' +
    '.doc-title{text-align:center;font-size:21px;font-weight:700;text-transform:uppercase;margin:10px 0 2px;letter-spacing:.02em}.doc-sub{text-align:center;font-style:italic;margin-bottom:12px}' +
    '.doc-meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 22px;margin:8px 0 12px}.doc-meta div{padding:1px 0}.doc-meta span{color:#555}' +
    'table.doc-tbl{width:100%;border-collapse:collapse;margin:8px 0}table.doc-tbl th,table.doc-tbl td{border:1px solid #444;padding:5px 7px;font-size:12px;vertical-align:top}' +
    'table.doc-tbl th{background:#eee;text-align:center}.r{text-align:right}.c{text-align:center}.b{font-weight:700}' +
    '.doc-sign{display:grid;gap:10px;margin-top:26px;text-align:center}.doc-sign div{min-height:92px}.doc-sign i{display:block;font-size:11px;color:#555}' +
    '.doc-note{margin:8px 0;font-size:12px}.doc-big{font-size:16px;font-weight:700}.doc-box{border:1px solid #444;padding:8px 10px;margin:8px 0}';
  U.docHeader = function (right) {
    const c = App.Store.state.settings.company;
    return '<div class="doc-head"><div><b>' + U.esc(c.name) + '</b><br>' + U.esc(c.address) + '<br>ĐT: ' + U.esc(c.phone) + ' · Email: ' + U.esc(c.email) + (c.taxCode ? ' · MST: ' + U.esc(c.taxCode) : '') +
      '</div>' + (right ? '<div style="text-align:right">' + right + '</div>' : '') + '</div>';
  };
  U.docDate = iso => { const p = (iso || U.todayISO()).slice(0, 10).split('-'); return 'Ngày ' + p[2] + ' tháng ' + p[1] + ' năm ' + p[0]; };
  U.previewDoc = function (title, bodyHtml, o) {
    o = o || {};
    const full = '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>' + U.esc(o.filename || title) + '</title><style>' + DOC_CSS + '</style></head><body>' + bodyHtml + '</body></html>';
    const foot = [{ label: 'Đóng', onClick: h => h.close() }];
    if (o.xlsx) foot.splice(0, 0, { label: 'Xuất Excel', icon: 'file-excel', left: true, onClick: () => o.xlsx() });
    foot.push({ label: 'Lưu PDF', icon: 'file-pdf', onClick: (h) => doPrint(h) });
    foot.push({ label: 'In', icon: 'print', cls: 'btn-primary', onClick: (h) => doPrint(h) });
    const doPrint = h => { const f = h.$('iframe'); try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { U.toast('Không mở được hộp thoại in', 'Hãy thử bấm Ctrl+P trong khung xem trước.', 'warning'); } };
    U.modal({
      title: title, sub: 'Xem trước · bấm <b>Lưu PDF</b> rồi chọn “Lưu dưới dạng PDF / Save as PDF” trong hộp thoại in', size: 'lg', static: true, noFocus: true,
      body: '<iframe class="doc-frame" title="Xem trước"></iframe>', foot,
      onMount: h => { const f = h.$('iframe'); f.srcdoc = full; }
    });
  };

  /* ---------------------------------------------------------- BIỂU ĐỒ */
  U.charts = [];
  U.destroyCharts = () => { U.charts.forEach(c => { try { c.destroy(); } catch (e) { /* noop */ } }); U.charts = []; };
  U.chart = function (canvas, cfg) {
    if (!window.Chart || !canvas) return null;
    const cs = getComputedStyle(document.documentElement);
    Chart.defaults.color = cs.getPropertyValue('--text-2').trim() || '#4b5a70';
    Chart.defaults.borderColor = cs.getPropertyValue('--border').trim() || '#e4e9f0';
    Chart.defaults.font.family = 'Inter, Segoe UI, system-ui, sans-serif';
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options || {});
    const c = new Chart(canvas, cfg); U.charts.push(c); return c;
  };
  U.compactMoney = v => { const a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(1).replace('.0', '') + ' tỷ'; if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace('.0', '') + ' tr'; if (a >= 1e3) return Math.round(v / 1e3) + 'k'; return String(v); };

  /* ------------------------------------------------------------- ROUTER */
  const R = (App.Router = { routes: {}, preQ: '', current: null });
  R.register = (name, mod) => { R.routes[name] = mod; };
  R.go = function (hash, q) {
    if (q != null) R.preQ = q;
    if (location.hash === hash) R.render(); else location.hash = hash;
  };
  R.takeQ = () => { const q = R.preQ; R.preQ = ''; return q; };
  R.parse = () => { const h = (location.hash || '').replace(/^#\/?/, ''); const p = h.split('/').filter(Boolean).map(decodeURIComponent); return { name: p[0] || 'dashboard', args: p.slice(1) }; };
  R.render = function () {
    const { name, args } = R.parse();
    const mod = R.routes[name] || R.routes.dashboard;
    U.destroyCharts(); U.popClose();
    R.current = name;
    const view = $('#view'); view.innerHTML = '';
    $('#crumbTitle').textContent = mod.title; $('#crumb').innerHTML = '<span>' + U.esc(mod.group || 'Hệ thống') + '</span><i class="fa-solid fa-chevron-right"></i><b>' + U.esc(mod.title) + '</b>';
    document.title = mod.title + ' — ' + App.Store.state.settings.company.name;
    mod.render(view, args);
    if (App.refreshChrome) App.refreshChrome();
    window.scrollTo(0, 0);
    $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show');
  };
  R.refresh = () => R.render();
})();
