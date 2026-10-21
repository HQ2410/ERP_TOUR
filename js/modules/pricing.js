/* ============================================================================
 * TÍNH GIÁ TOUR (BÁO GIÁ) — độc lập với tour đang điều hành
 *
 * Thông tin: Mã báo giá, Tuyến, Thời gian (3N2Đ), Ngày KH / kết thúc, Tiêu chuẩn,
 * Số lượng khách, Hoa hồng / khách.
 * Dự trù dịch vụ:
 *   - Lưu trú: tìm khách sạn trong Nhà cung cấp để lấy giá phòng; số lượng
 *     phòng/người × số đêm/lượt × đơn giá; VAT (đã gồm 8% / 10% / không VAT)
 *   - Dịch vụ khác: số lượng × số lượt × đơn giá (cũng chọn được từ Nhà cung cấp)
 * Tổng hợp:
 *   Tổng chi phí      = Σ thành tiền các dịch vụ
 *   Tổng hoa hồng     = số khách × hoa hồng / khách
 *   Giá tour / khách  = (Tổng chi phí + Tổng hoa hồng) ÷ số khách
 * Ghi chú VAT: đơn giá nhập là giá ĐÃ GỒM VAT (nếu chọn 8% / 10%) nên VAT không
 * cộng thêm vào thành tiền; hệ thống chỉ tách ra phần VAT đã bao gồm để tham khảo.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store;
  const VAT = { none: { label: 'Không VAT', rate: 0 }, inc8: { label: 'Đã gồm VAT 8%', rate: 0.08 }, inc10: { label: 'Đã gồm VAT 10%', rate: 0.10 } };
  const clone = o => JSON.parse(JSON.stringify(o));
  const lst = { q: '', page: 1 };
  // Bản đang soạn được giữ lại khi chuyển sang mục khác rồi quay lại
  let q = null, isNew = true, dirty = false, endManual = false, root = null, sug = null, sugIdx = -1;

  const newLine = type => ({ type, name: '', supplierId: '', qty: 1, times: 1, price: 0, vat: 'none' });
  const blank = () => ({ id: '', route: '', duration: '', start: '', end: '', standard: '', guests: 1, commission: 0, note: '', lines: [newLine('stay')] });
  const amt = l => (Number(l.qty) || 0) * (Number(l.times) || 0) * (Number(l.price) || 0);
  const vatIn = l => { const r = (VAT[l.vat] || VAT.none).rate; return r ? Math.round(amt(l) * r / (1 + r)) : 0; };
  function totals(x) {
    const sum = f => x.lines.reduce((t, l) => t + f(l), 0);
    const stay = sum(l => l.type === 'stay' ? amt(l) : 0), other = sum(l => l.type === 'other' ? amt(l) : 0), cost = stay + other;
    const guests = Math.max(0, Math.floor(Number(x.guests) || 0)), comm = Number(x.commission) || 0, hh = guests * comm, total = cost + hh;
    return { stay, other, cost, vat: sum(vatIn), guests, comm, hh, total, per: guests ? Math.round(total / guests) : 0 };
  }
  const calcQuote = x => totals(x);                 // dùng cho danh sách
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const nights = x => { const m = /(\d+)\s*N/i.exec(x.duration || ''); return m ? Number(m[1]) : 0; };

  /* ------------------------------------------------------------------ DÒNG DỊCH VỤ */
  const lineHtml = (l, i) => {
    const stay = l.type === 'stay', s = l.supplierId ? C.supplier(l.supplierId) : null;
    return '<div class="qrow" data-i="' + i + '">' +
      '<div class="qf q-name-wrap"><label>' + (stay ? 'Khách sạn' : 'Dịch vụ') + '</label><input class="inp q-name" data-k="name" autocomplete="off" value="' + U.esc(l.name) + '" placeholder="' + (stay ? 'Tìm tên khách sạn trong Nhà cung cấp…' : 'Tìm NCC hoặc nhập tên dịch vụ…') + '">' +
      '<div class="cell-sub q-hint">' + (s ? U.esc(s.id + ' · ' + s.province + ' · giá NCC ' + U.money(s.price)) : '') + '</div></div>' +
      '<div class="qf"><label>' + (stay ? 'Số lượng phòng/người' : 'Số lượng') + '</label><input class="inp" type="number" min="1" step="1" data-k="qty" value="' + l.qty + '"></div>' +
      '<div class="qf"><label>' + (stay ? 'Số đêm/lượt' : 'Số lượt') + '</label><input class="inp" type="number" min="1" step="1" data-k="times" value="' + l.times + '"></div>' +
      '<div class="qf"><label>Đơn giá (₫)</label><input class="inp" data-money inputmode="numeric" data-k="price" value="' + (l.price ? U.fmt(l.price) : '') + '" placeholder="0"></div>' +
      '<div class="qf"><label>Thuế VAT</label><select class="inp" data-k="vat">' + Object.keys(VAT).map(k => '<option value="' + k + '"' + (l.vat === k ? ' selected' : '') + '>' + VAT[k].label + '</option>').join('') + '</select></div>' +
      '<div class="qf"><label>Thành tiền</label><div class="q-amt">' + U.money(amt(l)) + '</div></div>' +
      '<button type="button" class="btn btn-ghost btn-icon q-del" data-act="delLine" data-i="' + i + '" title="Xóa dòng"><i class="fa-solid fa-trash"></i></button></div>';
  };
  function renderLines() {
    ['stay', 'other'].forEach(type => {
      const rows = q.lines.map((l, i) => l.type === type ? lineHtml(l, i) : '').join('');
      root.querySelector(type === 'stay' ? '#qStay' : '#qOther').innerHTML = rows || '<div class="muted" style="font-size:13px;padding:4px 2px">' + (type === 'stay' ? 'Chưa có khách sạn. Bấm “Thêm khách sạn”.' : 'Chưa có dịch vụ khác. Bấm “Thêm dịch vụ”.') + '</div>';
    });
  }
  function renderSummary() {
    const t = totals(q);
    root.querySelector('#qSum').innerHTML = '<div class="card-head"><h3>Tổng hợp báo giá</h3></div><div class="card-body">' +
      '<div class="sumbox"><div class="line"><span>Chi phí lưu trú</span><b>' + U.money(t.stay) + '</b></div><div class="line"><span>Chi phí dịch vụ khác</span><b>' + U.money(t.other) + '</b></div>' +
      '<div class="line total"><span>Tổng chi phí</span><span>' + U.money(t.cost) + '</span></div><div class="line"><span class="muted">Trong đó VAT đã bao gồm</span><span class="muted">' + U.money(t.vat) + '</span></div></div>' +
      '<div class="sumbox mt"><div class="line"><span>Hoa hồng / khách</span><b>' + U.money(t.comm) + '</b></div><div class="line"><span>Số khách</span><b>' + U.fmt(t.guests) + '</b></div>' +
      '<div class="line total"><span>Tổng hoa hồng</span><span>' + U.money(t.hh) + '</span></div></div>' +
      '<div class="price-hero mt" style="flex-direction:column;align-items:flex-start;gap:4px"><div class="cap">Giá tour cho 1 khách</div><div class="big">' + U.money(t.per) + '</div>' +
      '<div class="formula">= (Tổng chi phí + Tổng hoa hồng) ÷ số khách<br>= (' + U.fmt(t.cost) + ' + ' + U.fmt(t.hh) + ') ÷ ' + (t.guests || '—') + '</div></div>' +
      '<div class="line mt" style="font-size:12.5px"><span class="muted">Tổng giá trị báo giá (giá/khách × số khách)</span><b>' + U.money(t.per * t.guests) + '</b></div></div>';
  }
  function renderForm() {
    const set = (id, v) => { const e = root.querySelector('#' + id); if (e) e.value = v == null ? '' : v; };
    set('qCode', q.id || Store.peekId('BG', 4) + ' (tự cấp khi lưu)'); set('qRoute', q.route); set('qDuration', q.duration); set('qStandard', q.standard);
    set('qStart', q.start); set('qEnd', q.end); set('qGuests', q.guests); set('qComm', q.commission ? U.fmt(q.commission) : ''); set('qNote', q.note);
    root.querySelector('#qStatus').innerHTML = isNew ? U.badge('Báo giá mới · chưa lưu', 'orange') : (dirty ? U.badge(q.id + ' · có thay đổi chưa lưu', 'orange') : U.badge(q.id + ' · đã lưu', 'green'));
  }
  function setDirty(v) {
    dirty = v; const e = root && root.querySelector('#qStatus');
    if (e) e.innerHTML = isNew ? U.badge('Báo giá mới · chưa lưu', 'orange') : (dirty ? U.badge(q.id + ' · có thay đổi chưa lưu', 'orange') : U.badge(q.id + ' · đã lưu', 'green'));
  }
  const renderAll = () => { renderForm(); renderLines(); renderSummary(); renderList(); U.$('#qErrs', root).innerHTML = ''; };

  /* ----------------------------------------------------------- GỢI Ý NHÀ CUNG CẤP */
  function ensureSug() {
    if (sug) return sug;
    sug = document.createElement('div'); sug.className = 'q-sug'; document.body.appendChild(sug);
    sug.addEventListener('mousedown', e => { const it = e.target.closest('[data-sid]'); if (it) { e.preventDefault(); pick(it.dataset.sid); } });
    window.addEventListener('scroll', hideSug, true); window.addEventListener('resize', hideSug);
    return sug;
  }
  function hideSug() { if (sug) sug.style.display = 'none'; sugIdx = -1; }
  function showSug(inp, i) {
    const l = q.lines[i], query = U.norm(inp.value); sugIdx = i; ensureSug();
    let list = Store.state.suppliers.filter(s => l.type === 'stay' ? s.type === App.CONST.STAY : s.type !== App.CONST.STAY);
    if (query) list = list.filter(s => U.norm([s.name, s.province, s.address, s.type, s.id].join(' ')).includes(query));
    const total = list.length; list = list.slice(0, 8);
    sug.innerHTML = list.length ? list.map(s => '<div class="q-sug-item" data-sid="' + s.id + '"><b>' + U.esc(s.name) + '<br><span>' + U.esc(s.province + (l.type === 'other' ? ' · ' + s.type : '')) + '</span></b><em>' + U.money(s.price) + '</em></div>').join('') + (total > 8 ? '<div class="cell-sub" style="padding:6px 10px">Còn ' + (total - 8) + ' kết quả — gõ thêm để lọc</div>' : '')
      : '<div class="cell-sub" style="padding:10px">Không có ' + (l.type === 'stay' ? 'khách sạn' : 'nhà cung cấp') + ' phù hợp trong mục Nhà cung cấp. Bạn vẫn có thể nhập tên và đơn giá thủ công.</div>';
    const r = inp.getBoundingClientRect(), w = Math.max(r.width, 340), left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    sug.style.cssText = 'display:block;left:' + left + 'px;top:' + (r.bottom + 4) + 'px;width:' + w + 'px';
  }
  function pick(sid) {
    const s = C.supplier(sid), l = q.lines[sugIdx]; if (!s || !l) return;
    l.name = s.name; l.supplierId = s.id; l.price = s.price;
    const row = root.querySelector('.qrow[data-i="' + sugIdx + '"]');
    row.querySelector('[data-k="name"]').value = s.name; row.querySelector('[data-k="price"]').value = U.fmt(s.price);
    row.querySelector('.q-hint').textContent = s.id + ' · ' + s.province + ' · giá NCC ' + U.money(s.price);
    updateRow(sugIdx); hideSug(); setDirty(true);
  }
  function updateRow(i) {
    const row = root.querySelector('.qrow[data-i="' + i + '"]'); if (row) row.querySelector('.q-amt').textContent = U.money(amt(q.lines[i]));
    renderSummary();
  }

  /* ------------------------------------------------------------------ SỰ KIỆN FORM */
  function onInput(e) {
    const t = e.target, row = t.closest('.qrow');
    if (row) {
      const i = Number(row.dataset.i), l = q.lines[i], k = t.dataset.k; if (!l || !k) return;
      if (k === 'name') { l.name = t.value; if (l.supplierId && (C.supplier(l.supplierId) || {}).name !== t.value) { l.supplierId = ''; row.querySelector('.q-hint').textContent = ''; } showSug(t, i); }
      else if (k === 'price') l.price = U.num(t.value);
      else if (k === 'qty' || k === 'times') l[k] = Number(t.value);
      updateRow(i); setDirty(true); return;
    }
    const map = { qRoute: 'route', qDuration: 'duration', qStandard: 'standard', qNote: 'note', qStart: 'start', qEnd: 'end' };
    if (map[t.id]) {
      q[map[t.id]] = t.value; if (t.id === 'qEnd') endManual = true;
      if ((t.id === 'qStart' || t.id === 'qDuration') && !endManual && q.start && nights(q) > 0) { q.end = addDays(q.start, nights(q) - 1); root.querySelector('#qEnd').value = q.end; }
      setDirty(true);
    } else if (t.id === 'qGuests') { q.guests = Number(t.value); renderSummary(); setDirty(true); }
    else if (t.id === 'qComm') { q.commission = U.num(t.value); renderSummary(); setDirty(true); }
  }
  function onChange(e) {
    const t = e.target, row = t.closest('.qrow');
    if (row && t.dataset.k === 'vat') { q.lines[Number(row.dataset.i)].vat = t.value; renderSummary(); setDirty(true); }
    if (t.id === 'qStart' || t.id === 'qEnd') { if (t.id === 'qStart' && q.start && q.end && q.end < q.start) { q.end = q.start; root.querySelector('#qEnd').value = q.end; } setDirty(true); }
  }

  /* ----------------------------------------------------------------- KIỂM TRA & LƯU */
  function validate() {
    const errs = []; U.clearErr(root);
    const bad = (id, m) => { U.invalid(root, id, m); errs.push(m); };
    if (!q.route.trim()) bad('qRoute', 'Nhập tuyến');
    if (!Number.isInteger(Number(q.guests)) || Number(q.guests) < 1) bad('qGuests', 'Số khách phải là số nguyên ≥ 1');
    if (q.start && q.end && q.end < q.start) bad('qEnd', 'Ngày kết thúc phải sau ngày khởi hành');
    if (!q.lines.length) errs.push('Cần ít nhất một dịch vụ trong dự trù');
    q.lines.forEach((l, i) => {
      const n = (i + 1) + '. ' + (l.name || (l.type === 'stay' ? 'Khách sạn' : 'Dịch vụ'));
      if (!l.name.trim()) errs.push('Dòng ' + (i + 1) + ': chưa nhập tên ' + (l.type === 'stay' ? 'khách sạn' : 'dịch vụ'));
      if (!Number.isInteger(Number(l.qty)) || Number(l.qty) < 1) errs.push(n + ': số lượng phải là số nguyên ≥ 1');
      if (!Number.isInteger(Number(l.times)) || Number(l.times) < 1) errs.push(n + ': số ' + (l.type === 'stay' ? 'đêm/lượt' : 'lượt') + ' phải là số nguyên ≥ 1');
      if (!(Number(l.price) > 0)) errs.push(n + ': chưa nhập đơn giá');
    });
    U.$('#qErrs', root).innerHTML = errs.length ? '<div class="callout warn mt"><i class="fa-solid fa-triangle-exclamation"></i><div><b>Chưa lưu được báo giá:</b><ul style="margin:6px 0 0 16px;padding:0">' + errs.map(m => '<li>' + U.esc(m) + '</li>').join('') + '</ul></div></div>' : '';
    if (errs.length) U.focusFirstInvalid(root);
    return !errs.length;
  }
  function save() {
    if (!validate()) return false;
    const rec = clone(q); rec.guests = Number(rec.guests); rec.updatedAt = U.nowISO();
    if (isNew) { rec.id = Store.nextId('BG', 4); rec.createdAt = rec.updatedAt; Store.state.quotes.push(rec); }
    else { const i = Store.state.quotes.findIndex(x => x.id === rec.id); rec.createdAt = (Store.state.quotes[i] || {}).createdAt || rec.updatedAt; if (i >= 0) Store.state.quotes[i] = rec; else Store.state.quotes.push(rec); }
    Store.save(); q.id = rec.id; isNew = false; setDirty(false);
    history.replaceState(null, '', '#/pricing/' + q.id); renderForm(); renderList();
    U.toast('Đã lưu báo giá ' + q.id, 'Giá tour cho 1 khách: ' + U.money(totals(q).per), 'success'); return true;
  }
  const guard = fn => dirty ? U.confirm({ title: 'Bỏ thay đổi chưa lưu?', message: 'Báo giá đang soạn có thay đổi chưa lưu. Tiếp tục sẽ <b>mất các thay đổi này</b>.', ok: 'Bỏ thay đổi', danger: true }).then(ok => { if (ok) fn(); }) : fn();
  function load(id) { const x = Store.state.quotes.find(v => v.id === id); if (!x) return false; q = clone(x); isNew = false; dirty = false; endManual = true; return true; }
  function startNew(src) {
    q = src ? Object.assign(clone(src), { id: '' }) : blank(); isNew = true; dirty = !!src; endManual = !!(src && src.end);
    history.replaceState(null, '', '#/pricing'); renderAll();
    if (src) { setDirty(true); U.toast('Đã tạo bản sao', 'Chỉnh sửa rồi bấm “Lưu báo giá” để lưu thành báo giá mới.', 'info'); }
  }

  /* --------------------------------------------------------------- DANH SÁCH ĐÃ LƯU */
  function renderList() {
    const body = root.querySelector('#qList'); if (!body) return;
    const qs = U.norm(lst.q), rows = Store.state.quotes.filter(x => !qs || U.norm(x.id + ' ' + x.route + ' ' + x.standard).includes(qs)).slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    body.innerHTML = U.table({
      rows, st: lst, size: 8, empty: U.empty('file-invoice', lst.q ? 'Không tìm thấy báo giá' : 'Chưa có báo giá nào', lst.q ? 'Thử mã báo giá hoặc tuyến khác.' : 'Lập báo giá ở phía trên rồi bấm “Lưu báo giá”.'),
      rowCls: x => 'clickable' + (!isNew && q && q.id === x.id ? ' row-active' : ''), rowAttr: x => 'data-act="open" data-id="' + x.id + '"',
      cols: [{ label: 'Mã báo giá', render: x => '<span class="code">' + x.id + '</span>' }, { label: 'Tuyến', render: x => '<div class="cell-main">' + U.esc(x.route) + '</div><div class="cell-sub">' + U.esc([x.duration, x.standard].filter(Boolean).join(' · ')) + '</div>' },
        { label: 'Ngày khởi hành', render: x => x.start ? U.fdate(x.start) + (x.end ? '<div class="cell-sub">→ ' + U.fdate(x.end) + '</div>' : '') : '<span class="muted">—</span>' }, { label: 'Khách', cls: 'center', render: x => x.guests },
        { label: 'Tổng chi phí', cls: 'right', render: x => U.money(calcQuote(x).cost) }, { label: 'Giá / khách', cls: 'right', render: x => '<b class="num">' + U.money(calcQuote(x).per) + '</b>' },
        { label: 'Cập nhật', render: x => '<span class="nowrap">' + U.fdate(x.updatedAt) + '</span>' },
        { label: '', cls: 'right act-col', render: x => '<div class="row-actions">' + U.iconBtn('dup', x.id, 'copy', 'Nhân bản') + U.iconBtn('delQ', x.id, 'trash', 'Xóa') + '</div>' }]
    });
  }

  /* ------------------------------------------------------------- IN / PDF / EXCEL */
  const infoRows = x => '<div class="doc-meta"><div><span>Tuyến:</span> <b>' + U.esc(x.route) + '</b></div><div><span>Thời gian:</span> ' + (U.esc(x.duration) || '—') + '</div>' +
    '<div><span>Ngày khởi hành:</span> ' + U.fdate(x.start) + '</div><div><span>Ngày kết thúc:</span> ' + U.fdate(x.end) + '</div><div><span>Tiêu chuẩn:</span> ' + (U.esc(x.standard) || '—') + '</div><div><span>Số lượng khách:</span> <b>' + x.guests + '</b></div></div>';
  function internalDoc() {
    const x = q, t = totals(x), code = x.id || 'Bản nháp';
    const tbl = (type, title) => { const ls = x.lines.filter(l => l.type === type); if (!ls.length) return '';
      return '<div class="doc-note b">' + title + '</div><table class="doc-tbl"><thead><tr><th>STT</th><th>' + (type === 'stay' ? 'Khách sạn' : 'Dịch vụ') + '</th><th>' + (type === 'stay' ? 'SL phòng/người' : 'Số lượng') + '</th><th>' + (type === 'stay' ? 'Số đêm/lượt' : 'Số lượt') + '</th><th>Đơn giá</th><th>VAT</th><th>Thành tiền</th></tr></thead><tbody>' +
        ls.map((l, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + U.esc(l.name) + '</td><td class="c">' + U.fmt(l.qty) + '</td><td class="c">' + U.fmt(l.times) + '</td><td class="r">' + U.fmt(l.price) + '</td><td class="c">' + (VAT[l.vat] || VAT.none).label + '</td><td class="r">' + U.fmt(amt(l)) + '</td></tr>').join('') +
        '<tr><td colspan="6" class="r b">Cộng ' + title.toLowerCase() + '</td><td class="r b">' + U.fmt(type === 'stay' ? t.stay : t.other) + '</td></tr></tbody></table>'; };
    const html = U.docHeader('Mã báo giá: <b>' + U.esc(code) + '</b><br>' + U.docDate()) + '<div class="doc-title">Bảng tính giá tour</div><div class="doc-sub">Tài liệu nội bộ · ' + U.esc(code) + '</div>' + infoRows(x) +
      tbl('stay', 'Dự trù lưu trú') + tbl('other', 'Dự trù dịch vụ khác') +
      '<table class="doc-tbl" style="margin-top:12px"><tbody><tr><td class="r b">TỔNG CHI PHÍ</td><td class="r b" style="width:28%">' + U.fmt(t.cost) + '</td></tr><tr><td class="r">Trong đó VAT đã bao gồm</td><td class="r">' + U.fmt(t.vat) + '</td></tr>' +
      '<tr><td class="r">Tổng hoa hồng = ' + t.guests + ' khách × ' + U.fmt(t.comm) + '</td><td class="r">' + U.fmt(t.hh) + '</td></tr><tr><td class="r b">TỔNG CHI PHÍ + HOA HỒNG</td><td class="r b">' + U.fmt(t.total) + '</td></tr></tbody></table>' +
      '<div class="doc-box"><div>Giá tour cho 1 khách = (Tổng chi phí + Tổng hoa hồng) ÷ số khách = (' + U.fmt(t.cost) + ' + ' + U.fmt(t.hh) + ') ÷ ' + t.guests + '</div><div class="doc-big">GIÁ TOUR CHO 1 KHÁCH: ' + U.fmt(t.per) + ' đồng</div></div>' +
      (x.note ? '<div class="doc-note"><b>Ghi chú:</b> ' + U.esc(x.note) + '</div>' : '') + '<div class="doc-sign" style="grid-template-columns:1fr 1fr"><div><b>Người lập</b><i>(Ký, ghi rõ họ tên)</i></div><div><b>Giám đốc duyệt</b><i>(Ký, ghi rõ họ tên)</i></div></div>';
    U.previewDoc('Bảng tính giá ' + code, html, { filename: 'Bang-tinh-gia-' + (x.id || 'nhap'), xlsx: exportXlsx });
  }
  function customerDoc() {
    const x = q, t = totals(x), code = x.id || 'Bản nháp';
    const inc = x.lines.map(l => '<li>' + U.esc(l.name) + (l.type === 'stay' ? ' — ' + l.qty + ' phòng/người × ' + l.times + ' đêm/lượt' : (l.times > 1 || l.qty > 1 ? ' (' + l.qty + ' × ' + l.times + ' lượt)' : '')) + '</li>').join('');
    const anyVat = x.lines.some(l => l.vat !== 'none');
    const html = U.docHeader('Mã báo giá: <b>' + U.esc(code) + '</b><br>' + U.docDate()) + '<div class="doc-title">Báo giá tour</div><div class="doc-sub">Tuyến ' + U.esc(x.route) + (x.duration ? ' · ' + U.esc(x.duration) : '') + '</div>' + infoRows(x) +
      '<div class="doc-box" style="text-align:center"><div>Giá tour cho 1 khách</div><div class="doc-big" style="font-size:24px">' + U.fmt(t.per) + ' đồng</div><div>Tổng giá trị cho ' + t.guests + ' khách: <b>' + U.fmt(t.per * t.guests) + ' đồng</b></div><i>(Bằng chữ: ' + U.numWords(t.per * t.guests) + ')</i></div>' +
      '<div class="doc-note b">Giá bao gồm:</div><ul style="margin:4px 0 8px 18px;padding:0;font-size:12.5px;line-height:1.7">' + inc + '</ul>' +
      (anyVat ? '<div class="doc-note"><i>Một số dịch vụ đã bao gồm thuế VAT theo quy định.</i></div>' : '') + (x.note ? '<div class="doc-note"><b>Ghi chú:</b> ' + U.esc(x.note) + '</div>' : '') +
      '<div class="doc-sign" style="grid-template-columns:1fr 1fr"><div><b>Khách hàng xác nhận</b><i>(Ký, ghi rõ họ tên)</i></div><div><b>Đại diện công ty</b><i>(Ký, đóng dấu)</i></div></div>';
    U.previewDoc('Báo giá khách ' + code, html, { filename: 'Bao-gia-' + (x.id || 'nhap') });
  }
  function exportXlsx() {
    const x = q, t = totals(x), rows = [];
    ['stay', 'other'].forEach(type => x.lines.filter(l => l.type === type).forEach((l, i) => rows.push([i + 1, type === 'stay' ? 'Lưu trú' : 'Dịch vụ khác', l.name, l.qty, l.times, l.price, (VAT[l.vat] || VAT.none).label, amt(l)])));
    rows.push([]); rows.push(['', '', 'Tổng chi phí', '', '', '', '', t.cost]); rows.push(['', '', 'Trong đó VAT đã bao gồm', '', '', '', '', t.vat]);
    rows.push(['', '', 'Tổng hoa hồng (' + t.guests + ' khách × ' + t.comm + ')', '', '', '', '', t.hh]); rows.push(['', '', 'Tổng chi phí + hoa hồng', '', '', '', '', t.total]); rows.push(['', '', 'GIÁ TOUR / 1 KHÁCH', '', '', '', '', t.per]);
    U.exportXlsx({ filename: 'tinh-gia-tour-' + (x.id || 'nhap'), sheet: 'Tính giá tour', title: 'BẢNG TÍNH GIÁ TOUR ' + (x.id || ''), subtitle: [x.route, x.duration, x.standard, x.guests + ' khách'].filter(Boolean).join(' · '),
      headers: ['STT', 'Nhóm', 'Tên khách sạn / dịch vụ', 'Số lượng', 'Số đêm/lượt', 'Đơn giá', 'VAT', 'Thành tiền'], rows, moneyCols: [5, 7] });
  }

  /* ---------------------------------------------------------------------- ROUTE */
  async function delQuote(id) {
    const x = Store.state.quotes.find(v => v.id === id); if (!x) return;
    if (!(await U.confirm({ title: 'Xóa báo giá', message: 'Xóa báo giá <b>' + id + '</b> (' + U.esc(x.route) + ')?', ok: 'Xóa', danger: true }))) return;
    Store.state.quotes = Store.state.quotes.filter(v => v.id !== id); Store.save(); U.toast('Đã xóa báo giá', id);
    if (!isNew && q && q.id === id) startNew(); else renderList();
  }
  const mod = {
    title: 'Tính giá tour', group: 'Nghiệp vụ', icon: 'coins',
    render(view, args) {
      if (args && args[0]) { if (!(q && q.id === args[0] && !isNew)) { if (!load(args[0])) { U.toast('Không tìm thấy báo giá', args[0], 'warning'); q = blank(); isNew = true; dirty = false; endManual = false; } } }
      else if (!q) { q = blank(); isNew = true; dirty = false; endManual = false; }
      const dl = ['3*', '4*', '5*', 'Tiêu chuẩn', 'Cao cấp'].map(v => '<option value="' + v + '">').join('');
      view.innerHTML = '<div id="qRoot"><div class="page-head"><div><h1>Tính giá tour</h1><p>Lập báo giá cho khách: dự trù dịch vụ → giá tour cho 1 khách.</p></div><div class="page-head-actions">' +
        '<button class="btn" data-act="new"><i class="fa-solid fa-plus"></i>Báo giá mới</button><button class="btn" data-act="xlsx"><i class="fa-solid fa-file-excel"></i>Excel</button>' +
        '<button class="btn" data-act="printInternal"><i class="fa-solid fa-table-list"></i>Bảng tính (PDF)</button><button class="btn" data-act="printCustomer"><i class="fa-solid fa-file-pdf"></i>Báo giá khách (PDF)</button>' +
        '<button class="btn btn-primary" data-act="save"><i class="fa-solid fa-floppy-disk"></i>Lưu báo giá</button></div></div>' +
        '<div class="q-layout"><div class="q-main">' +
        '<div class="card mb"><div class="card-head"><h3>Thông tin báo giá</h3><span id="qStatus"></span></div><div class="card-body"><div class="q-grid">' +
        U.field({ id: 'qCode', label: 'Mã báo giá', html: '<input class="inp" id="qCode" disabled>' }) + U.field({ id: 'qRoute', label: 'Tuyến', req: true, cls: 'span2', html: '<input class="inp" id="qRoute" placeholder="VD: Đà Lạt" autocomplete="off">' }) +
        U.field({ id: 'qDuration', label: 'Thời gian', html: '<input class="inp" id="qDuration" placeholder="VD: 3N2Đ" autocomplete="off">' }) +
        U.field({ id: 'qStart', label: 'Ngày khởi hành', html: '<input class="inp" id="qStart" type="date">' }) + U.field({ id: 'qEnd', label: 'Ngày kết thúc', html: '<input class="inp" id="qEnd" type="date">' }) +
        U.field({ id: 'qStandard', label: 'Tiêu chuẩn', html: '<input class="inp" id="qStandard" list="qStdList" placeholder="VD: 5*" autocomplete="off"><datalist id="qStdList">' + dl + '</datalist>' }) +
        U.field({ id: 'qGuests', label: 'Số lượng khách', req: true, html: '<input class="inp" id="qGuests" type="number" min="1" step="1">' }) +
        U.field({ id: 'qComm', label: 'Hoa hồng / khách (VNĐ)', html: '<input class="inp" id="qComm" data-money inputmode="numeric" placeholder="VD: 200.000">' }) +
        U.field({ id: 'qNote', label: 'Ghi chú (hiện trong báo giá)', cls: 'span4', html: '<input class="inp" id="qNote" placeholder="VD: Giá đã gồm ăn sáng; chưa gồm vé tham quan ngoài chương trình" autocomplete="off">' }) + '</div></div></div>' +
        '<div class="card mb"><div class="card-head"><h3><i class="fa-solid fa-bed" style="color:var(--primary);margin-right:8px"></i>Dự trù dịch vụ · Lưu trú</h3><button class="btn btn-sm btn-primary" data-act="addStay"><i class="fa-solid fa-plus"></i>Thêm khách sạn</button></div><div class="card-body" id="qStay"></div></div>' +
        '<div class="card"><div class="card-head"><h3><i class="fa-solid fa-van-shuttle" style="color:var(--primary);margin-right:8px"></i>Dự trù dịch vụ · Dịch vụ khác</h3><button class="btn btn-sm btn-primary" data-act="addOther"><i class="fa-solid fa-plus"></i>Thêm dịch vụ khác</button></div><div class="card-body" id="qOther"></div></div>' +
        '</div><aside class="q-side"><div class="card" id="qSum"></div><div id="qErrs"></div></aside></div>' +
        '<div class="card mt"><div class="card-head"><h3>Báo giá đã lưu</h3></div><div class="toolbar"><div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" id="qSearch" placeholder="Tìm theo mã báo giá hoặc tuyến…"></div></div><div id="qList"></div></div></div>';
      root = U.$('#qRoot', view); lst.q = ''; lst.page = 1;
      root.oninput = e => { if (e.target.id === 'qSearch') { lst.q = e.target.value; lst.page = 1; renderList(); } else onInput(e); };
      root.onchange = onChange;
      root.addEventListener('focusin', e => { const t = e.target; if (t.classList && t.classList.contains('q-name')) showSug(t, Number(t.closest('.qrow').dataset.i)); });
      root.addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('q-name')) setTimeout(hideSug, 160); });
      root.addEventListener('keydown', e => { if (e.key === 'Escape') hideSug(); });
      root.onclick = e => {
        if (U.pagerClick(e, lst)) { renderList(); return; }
        const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act, id = b.dataset.id;
        switch (act) {
          case 'save': save(); break;
          case 'new': guard(() => startNew()); break;
          case 'addStay': q.lines.push(newLine('stay')); renderLines(); setDirty(true); { const r = root.querySelectorAll('#qStay .qrow'); const f = r[r.length - 1]; if (f) f.querySelector('.q-name').focus(); } break;
          case 'addOther': q.lines.push(newLine('other')); renderLines(); setDirty(true); { const r = root.querySelectorAll('#qOther .qrow'); const f = r[r.length - 1]; if (f) f.querySelector('.q-name').focus(); } break;
          case 'delLine': q.lines.splice(Number(b.dataset.i), 1); renderLines(); renderSummary(); setDirty(true); break;
          case 'open': if (!(!isNew && q.id === id)) guard(() => { load(id); history.replaceState(null, '', '#/pricing/' + id); renderAll(); window.scrollTo({ top: 0, behavior: 'smooth' }); }); break;
          case 'dup': { e.stopPropagation(); const src = Store.state.quotes.find(v => v.id === id); if (src) guard(() => { startNew(src); window.scrollTo({ top: 0, behavior: 'smooth' }); }); break; }
          case 'delQ': e.stopPropagation(); delQuote(id); break;
          case 'xlsx': exportXlsx(); break;
          case 'printInternal': internalDoc(); break;
          case 'printCustomer': customerDoc(); break;
        }
      };
      renderAll();
    }
  };
  App.mod.pricing = mod; App.Router.register('pricing', mod);
})();
