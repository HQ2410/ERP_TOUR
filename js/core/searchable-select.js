/* ============================================================================
 * SEARCHABLE SELECT — cho phép GÕ để tìm rồi chọn ở các ô có nhiều dữ liệu
 * (khách hàng, sản phẩm, nguyên vật liệu, nhân viên, định khoản, ngân hàng…).
 *
 * Cách hoạt động: tự động "nâng cấp" thẻ <select> gốc (giữ nguyên thẻ gốc, chỉ
 * ẩn đi) nên toàn bộ code cũ vẫn đọc .value / lắng nghe 'change' như bình thường.
 *
 * Quy tắc:
 *  - Chỉ nâng cấp khi có từ MIN_OPTIONS lựa chọn trở lên (hoặc có data-search="1").
 *  - KHÔNG nâng cấp: ĐVT (đơn vị tính), trạng thái, phân trang, tháng/năm,
 *    phương thức… (chỉ chọn là đủ) hoặc thẻ có data-no-search="1" / multiple.
 *  - Tìm không phân biệt hoa/thường và dấu tiếng Việt ("nguyen" → "Nguyễn").
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__searchableSelectInstalled) return;
  window.__searchableSelectInstalled = true;

  const MIN_OPTIONS = 8;      // từ ngần này lựa chọn trở lên mới có ô gõ tìm
  const MAX_RENDER = 80;      // số dòng tối đa vẽ ra cùng lúc (gõ thêm để thu hẹp)
  const SKIP_RE = /(unit|uom|dvt|donvi|status|trangthai|pagesize|perpage|page-size|currency|paymethod)/i;
  const SKIP_LABEL_RE = /đơn vị tính|đvt|trạng thái|phương thức|hình thức|số dòng|sắp xếp|tháng|năm\b|quý\b/i;

  const norm = (s) => String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const indexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

  let openInst = null;   // dropdown đang mở (chỉ 1 cái tại một thời điểm)

  function labelTextOf(sel) {
    let t = '';
    if (sel.id) { const l = document.querySelector(`label[for="${CSS.escape(sel.id)}"]`); if (l) t += ' ' + l.textContent; }
    const field = sel.closest('.field, label, .field-inline');
    if (field) { const l = field.querySelector(':scope > label') || (field.tagName === 'LABEL' ? field : null); if (l) t += ' ' + l.textContent; }
    t += ' ' + (sel.getAttribute('aria-label') || '') + ' ' + (sel.getAttribute('title') || '');
    return t;
  }

  function eligible(sel) {
    if (sel.dataset.ssel === '1' || sel.dataset.noSearch != null || sel.multiple || sel.size > 1) return false;
    if (sel.closest('.ssel')) return false;
    if (sel.dataset.search === '1') return true;
    const ident = [sel.id, sel.name, sel.dataset.f, sel.dataset.key, sel.dataset.field, sel.className].join(' ');
    if (SKIP_RE.test(ident)) return false;
    if (SKIP_LABEL_RE.test(labelTextOf(sel))) return false;
    let n = 0; for (const o of sel.options) { if (o.value !== '') n++; if (n >= MIN_OPTIONS) return true; }
    return false;
  }

  function enhance(sel) {
    if (!eligible(sel)) return;
    sel.dataset.ssel = '1';

    const wrap = document.createElement('span');
    wrap.className = 'ssel';
    const input = document.createElement('input');
    input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false;
    input.className = (sel.className || 'inp').replace(/\binp\b/, '').trim() + ' inp ssel-input';
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocapitalize', 'off'); input.setAttribute('enterkeyhint', 'search');
    const caret = document.createElement('i'); caret.className = 'fa-solid fa-chevron-down ssel-caret'; caret.setAttribute('aria-hidden', 'true');
    wrap.append(input, caret);
    sel.insertAdjacentElement('afterend', wrap);
    sel.classList.add('ssel-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    // Giữ kích thước người dùng đã đặt inline trên select gốc
    ['width', 'minWidth', 'maxWidth', 'flex'].forEach((k) => { if (sel.style[k]) wrap.style[k] = sel.style[k]; });

    const inst = { sel, wrap, input, list: null, items: [], active: -1, typing: false };
    wrap._ssel = inst; sel._sselInst = inst;

    const placeholderOf = () => { const e = [...sel.options].find((o) => o.value === ''); return e ? e.textContent.trim() : 'Gõ để tìm…'; };
    const refresh = () => {
      const o = sel.options[sel.selectedIndex];
      input.value = o && o.value !== '' ? o.textContent.trim() : '';
      input.placeholder = placeholderOf() || 'Gõ để tìm…';
      input.disabled = sel.disabled;
      wrap.classList.toggle('is-disabled', sel.disabled);
      wrap.classList.toggle('is-invalid', !!sel.closest('.field.invalid'));
    };
    inst.refresh = refresh;

    // Khi code khác gán select.value = '...' / selectedIndex thì ô gõ tự cập nhật theo
    try {
      Object.defineProperty(sel, 'value', { configurable: true, get() { return valueDesc.get.call(this); }, set(v) { valueDesc.set.call(this, v); refresh(); } });
      Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return indexDesc.get.call(this); }, set(v) { indexDesc.set.call(this, v); refresh(); } });
    } catch (e) { /* trình duyệt không cho override: đã có đồng bộ theo sự kiện bên dưới */ }
    sel.addEventListener('change', refresh);
    new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'] });

    const choices = () => [...sel.options].map((o, i) => ({ i, value: o.value, text: o.textContent.trim(), n: norm(o.textContent), disabled: o.disabled }));

    function filtered(q) {
      const nq = norm(q), words = nq.split(' ').filter(Boolean);
      const all = choices();
      if (!words.length) return all;
      return all.filter((c) => c.value === '' ? false : words.every((w) => c.n.includes(w)))
        .sort((a, b) => (a.n.startsWith(nq) ? 0 : 1) - (b.n.startsWith(nq) ? 0 : 1));
    }

    function render() {
      if (!inst.list) return;
      const q = inst.typing ? input.value : '';
      const rows = filtered(q);
      const cur = sel.selectedIndex;
      const shown = rows.slice(0, MAX_RENDER);
      inst.items = shown.filter((c) => !c.disabled);
      inst.active = Math.max(0, inst.items.findIndex((c) => c.i === cur));
      if (q && inst.items.length) inst.active = 0;
      inst.list.innerHTML = shown.length
        ? shown.map((c) => `<div class="ssel-opt${c.i === cur ? ' is-selected' : ''}${c.value === '' ? ' is-empty' : ''}${c.disabled ? ' is-disabled' : ''}" role="option" data-i="${c.i}">${hilite(c.text, q)}</div>`).join('')
          + (rows.length > MAX_RENDER ? `<div class="ssel-more">Còn ${rows.length - MAX_RENDER} kết quả — gõ thêm để thu hẹp</div>` : '')
        : `<div class="ssel-none">Không tìm thấy “${escHtml(q)}”</div>`;
      paintActive(true);
    }
    function hilite(text, q) {
      const words = norm(q).split(' ').filter(Boolean); if (!words.length) return escHtml(text);
      const nt = norm(text); let out = '', i = 0;
      // norm() giữ nguyên độ dài ký tự với tiếng Việt đã dựng sẵn (NFC) trong hầu hết trường hợp
      if (nt.length !== text.length) return escHtml(text);
      const marks = new Array(text.length).fill(false);
      words.forEach((w) => { let p = nt.indexOf(w); while (p !== -1) { for (let k = p; k < p + w.length; k++) marks[k] = true; p = nt.indexOf(w, p + w.length); } });
      while (i < text.length) { let j = i; while (j < text.length && marks[j] === marks[i]) j++; const part = escHtml(text.slice(i, j)); out += marks[i] ? `<mark>${part}</mark>` : part; i = j; }
      return out;
    }
    function paintActive(scroll) {
      if (!inst.list) return;
      const cur = inst.items[inst.active];
      inst.list.querySelectorAll('.ssel-opt').forEach((el) => {
        const on = cur && Number(el.dataset.i) === cur.i; el.classList.toggle('is-active', !!on);
        if (on && scroll) el.scrollIntoView && el.scrollIntoView({ block: 'nearest' });
      });
    }
    function place() {
      if (!inst.list) return;
      const r = input.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
      const mobile = vw <= 700;
      const below = vh - r.bottom - 8, above = r.top - 8;
      const l = inst.list;
      if (mobile) { // trên điện thoại: hiện dạng danh sách dưới ô, rộng bằng ô nhưng không tràn mép
        l.style.left = Math.max(8, Math.min(r.left, vw - 8 - Math.min(r.width, vw - 16))) + 'px';
        l.style.width = Math.min(r.width, vw - 16) + 'px';
      } else { l.style.left = r.left + 'px'; l.style.width = Math.max(r.width, 220) + 'px'; }
      const maxH = Math.max(140, Math.min(320, (below >= 180 || below >= above) ? below : above));
      l.style.maxHeight = maxH + 'px';
      if (below >= 180 || below >= above) { l.style.top = (r.bottom + 4) + 'px'; l.style.bottom = 'auto'; }
      else { l.style.bottom = (vh - r.top + 4) + 'px'; l.style.top = 'auto'; }
    }
    function open() {
      if (sel.disabled || inst.list) return;
      if (openInst && openInst !== inst) openInst.close();
      const l = document.createElement('div'); l.className = 'ssel-list'; l.setAttribute('role', 'listbox');
      document.body.appendChild(l); inst.list = l; openInst = inst;
      input.setAttribute('aria-expanded', 'true'); wrap.classList.add('is-open');
      render(); place();
      l.addEventListener('mousedown', (e) => e.preventDefault());               // giữ focus ở ô gõ
      l.addEventListener('click', (e) => { const o = e.target.closest('.ssel-opt'); if (o && !o.classList.contains('is-disabled')) pick(Number(o.dataset.i)); });
    }
    function close(restore = true) {
      if (!inst.list) return;
      inst.list.remove(); inst.list = null; inst.typing = false;
      input.setAttribute('aria-expanded', 'false'); wrap.classList.remove('is-open');
      if (openInst === inst) openInst = null;
      if (restore) refresh();
    }
    inst.close = close; inst.place = place;
    function pick(i) {
      const changed = sel.selectedIndex !== i;
      indexDesc.set.call(sel, i);
      close(); refresh();
      if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }

    input.addEventListener('focus', () => { open(); try { input.select(); } catch (e) { /* noop */ } });
    input.addEventListener('click', () => { if (!inst.list) open(); });
    caret.addEventListener('mousedown', (e) => { e.preventDefault(); if (sel.disabled) return; if (inst.list) close(); else { input.focus(); open(); } });
    input.addEventListener('input', () => { inst.typing = true; if (!inst.list) open(); render(); place(); });
    input.addEventListener('blur', () => setTimeout(() => close(true), 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!inst.list) { open(); return; }
        const n = inst.items.length; if (!n) return;
        inst.active = (inst.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; paintActive(true);
      } else if (e.key === 'Enter') {
        if (inst.list) { e.preventDefault(); const c = inst.items[inst.active]; if (c) pick(c.i); }
      } else if (e.key === 'Escape') {
        if (inst.list) { e.stopPropagation(); close(true); }
      } else if (e.key === 'Tab') { close(true); }
    });

    refresh();
  }

  function scan(root) {
    const list = [];
    if (root.nodeType === 1 && root.tagName === 'SELECT') list.push(root);
    if (root.querySelectorAll) root.querySelectorAll('select:not([data-ssel])').forEach((s) => list.push(s));
    list.forEach((s) => { try { enhance(s); } catch (err) { console.warn('[ssel]', err); } });
  }
  function sweep() {
    // Dọn các ô gõ "mồ côi" khi select gốc đã bị render lại / gỡ khỏi trang
    document.querySelectorAll('.ssel').forEach((w) => { const s = w._ssel && w._ssel.sel; if (!s || !s.isConnected) { w._ssel?.close?.(false); w.remove(); } });
    document.querySelectorAll('.ssel-list').forEach((l) => { if (!openInst || openInst.list !== l) l.remove(); });
  }

  let queued = false; const pending = new Set();
  function schedule(nodes) {
    nodes.forEach((n) => pending.add(n));
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; const list = [...pending]; pending.clear(); sweep(); list.forEach((n) => { if (n.isConnected) scan(n); }); });
  }

  function start() {
    scan(document.body);
    new MutationObserver((muts) => {
      const nodes = [];
      muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !(n.classList && (n.classList.contains('ssel') || n.classList.contains('ssel-list')))) nodes.push(n); }));
      if (nodes.length || muts.some((m) => m.removedNodes.length)) schedule(nodes);
    }).observe(document.body, { childList: true, subtree: true });
  }
  // Đặt lại vị trí danh sách khi cuộn / đổi kích thước (đóng nếu ô gõ đã cuộn khỏi màn hình)
  const repos = (e) => {
    const i = openInst; if (!i || !i.list) return;
    if (e && e.target && e.target.closest && e.target.closest('.ssel-list')) return;
    const r = i.input.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { i.close(true); return; }
    i.place();
  };
  window.addEventListener('scroll', repos, true); window.addEventListener('resize', () => repos());

  // API công khai để module khác ép nâng cấp / làm mới
  window.SearchableSelect = { scan, refresh: (sel) => sel && sel._sselInst && sel._sselInst.refresh() };

  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
