/* ============================================================================
 * KẾ TOÁN V2 (đợt 4) — nạp SAU mod-accounting.js và mod-crm-sales.js
 * ----------------------------------------------------------------------------
 *  1. Tài sản cố định: ngày bắt đầu sử dụng + khấu hao đường thẳng theo ngày/tháng
 *  2. Ngân hàng: sao kê theo khoảng thời gian (tồn đầu, thu, chi, tồn cuối)
 *  3. Thu tiền khách hàng: kế toán xác nhận đã nhận tiền
 *  4. Doanh thu theo kỳ: đầu kỳ, phát sinh, cuối kỳ, thay đổi (có chốt kỳ)
 *  5. Giá thành: nhân công + khấu hao máy móc thiết bị
 *  6. Thuế GTGT: tờ khai 01/GTGT + bảng kê mua vào / bán ra
 *  7. Hóa đơn: bản thể hiện PDF (in / lưu PDF) + sổ hóa đơn
 *
 * Các hàm view cũ (accFixedAssetsView, accBankingView, ...) là function toàn cục
 * nên được khai báo lại ở đây; Views.accounting gọi theo tên tại thời điểm render.
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ tiện ích */
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const r0 = (v) => Math.round(n(v));
  const todayYmd = () => String(typeof currentDateYMD === 'function' ? currentDateYMD() : (DB.today || new Date().toISOString())).slice(0, 10);
  const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ymdOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const cmpYmd = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const monthStart = (ymd) => String(ymd).slice(0, 7) + '-01';
  const monthEnd = (ymd) => { const p = parseYmd(ymd); return ymdOf(p.y, p.m, dim(p.y, p.m)); };
  const addDaysYmd = (ymd, days) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const money = (v) => (typeof fmtVND === 'function' ? fmtVND(v) : r0(v).toLocaleString('vi-VN') + 'đ');
  const canAccounting = () => { try { return typeof Auth === 'undefined' || Auth.hasPermission('ACCOUNTING_OPERATE'); } catch (_) { return true; } };
  const who = () => DB.currentUser?.name || DB.currentUser?.id || '';
  const stamp = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '');

  /* Bảng lưu mới (KIO nếu có, nếu không dùng localStorage) */
  const TABLES = {
    revenuePeriods: (typeof KIO_CONFIG !== 'undefined' && KIO_CONFIG.accountingTables?.revenuePeriods) || 'lenam_accounting_revenue_periods',
    vatReturns: (typeof KIO_CONFIG !== 'undefined' && KIO_CONFIG.accountingTables?.vatReturns) || 'lenam_accounting_vat_returns',
    invoices: (typeof KIO_CONFIG !== 'undefined' && KIO_CONFIG.accountingTables?.invoices) || 'lenam_accounting_invoices',
  };
  const loaded = {};
  const lsKey = (kind) => 'lenam_acc_v2_' + kind;
  function listLocal(kind) { try { const r = JSON.parse(localStorage.getItem(lsKey(kind)) || '[]'); return Array.isArray(r) ? r : []; } catch (_) { return []; } }
  const store = {
    list(kind) { DB.accV2 = DB.accV2 || {}; if (!DB.accV2[kind]) DB.accV2[kind] = listLocal(kind); return DB.accV2[kind]; },
    async ensure(kind, force = false) {
      DB.accV2 = DB.accV2 || {};
      if (!force && loaded[kind]) return store.list(kind);
      try {
        if (typeof KioStore !== 'undefined') { const rows = await KioStore.listCollection(TABLES[kind], { force }); DB.accV2[kind] = Array.isArray(rows) ? rows : []; }
        else DB.accV2[kind] = listLocal(kind);
        loaded[kind] = true;
      } catch (err) { console.warn('[AccV2] Không tải được', kind, err); DB.accV2[kind] = DB.accV2[kind] || listLocal(kind); }
      return DB.accV2[kind];
    },
    async save(kind, row) {
      const list = store.list(kind); const i = list.findIndex((x) => String(x.id) === String(row.id));
      const copy = JSON.parse(JSON.stringify(row));
      if (typeof KioStore !== 'undefined') await KioStore.saveSingleton(TABLES[kind], String(row.id), copy);
      else localStorage.setItem(lsKey(kind), JSON.stringify(i >= 0 ? list.map((x, k) => (k === i ? copy : x)) : [...list, copy]));
      if (i >= 0) list[i] = copy; else list.push(copy);
      return row;
    },
    async remove(kind, id) {
      if (typeof KioStore !== 'undefined') await KioStore.deleteKeys(TABLES[kind], [String(id)]);
      else localStorage.setItem(lsKey(kind), JSON.stringify(store.list(kind).filter((x) => String(x.id) !== String(id))));
      DB.accV2[kind] = store.list(kind).filter((x) => String(x.id) !== String(id));
    },
  };
  window.AccV2Store = store;

  /* ========================================================================
   * 1. TÀI SẢN CỐ ĐỊNH — KHẤU HAO ĐƯỜNG THẲNG THEO NGÀY BẮT ĐẦU SỬ DỤNG
   * ------------------------------------------------------------------------
   * Theo Thông tư 45/2013/TT-BTC (sửa đổi bởi 147/2016, 28/2017): việc trích khấu hao
   * bắt đầu từ ngày TSCĐ được đưa vào sử dụng, không phải ngày mua.
   *   Mức khấu hao tháng = Nguyên giá ÷ (số năm × 12)
   *   Tháng bắt đầu: tính theo số ngày kể từ ngày bắt đầu sử dụng ÷ số ngày của tháng
   *   Ngày kết thúc = ngày bắt đầu + thời hạn sử dụng − 1 ngày; ngày đó khấu hao đủ nguyên giá.
   * ====================================================================== */
  const assetStart = (a) => String(a?.startUseDate || a?.purchaseDate || '').slice(0, 10);
  const assetMonths = (a) => Math.max(1, Math.round(n(a?.usefulYears) * 12));
  const assetMonthly = (a) => n(a?.cost) / assetMonths(a);
  function assetEndDate(a) {
    const s = parseYmd(assetStart(a)); if (!s) return '';
    const total = (s.y * 12 + (s.m - 1)) + assetMonths(a);
    const y = Math.floor(total / 12), m = (total % 12) + 1;
    const day = Math.min(s.d, dim(y, m));
    return addDaysYmd(ymdOf(y, m, day), -1);
  }
  /** Khấu hao lũy kế đến hết ngày asOf (làm tròn đồng). */
  function assetAccum(a, asOf = todayYmd()) {
    const cost = n(a?.cost); const startStr = assetStart(a); const s = parseYmd(startStr);
    if (!s || cost <= 0) return 0;
    let stop = String(asOf).slice(0, 10);
    if (a.disposedDate && cmpYmd(String(a.disposedDate).slice(0, 10), stop) < 0) stop = String(a.disposedDate).slice(0, 10);
    if (cmpYmd(stop, startStr) < 0) return 0;
    if (cmpYmd(stop, assetEndDate(a)) >= 0) return r0(cost);
    const D = parseYmd(stop), monthly = assetMonthly(a), M = assetMonths(a);
    let y = s.y, mo = s.m, acc = 0;
    for (let k = 0; k <= M; k++) {
      if (y > D.y || (y === D.y && mo > D.m)) break;
      const days = dim(y, mo);
      const from = k === 0 ? s.d : 1;
      let to = (y === D.y && mo === D.m) ? D.d : days;
      if (k === M) to = Math.min(to, s.d - 1);
      if (to >= from) acc += monthly * (to - from + 1) / days;
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    return r0(Math.min(cost, acc));
  }
  const assetBook = (a, asOf) => Math.max(0, r0(n(a?.cost) - assetAccum(a, asOf)));
  /** Khấu hao phát sinh trong tháng yyyy-mm (hiệu hai mốc lũy kế). */
  function assetMonthDep(a, ym) {
    const p = parseYmd(ym + '-01'); if (!p) return 0;
    const prevEnd = addDaysYmd(ym + '-01', -1);
    return assetAccum(a, ymdOf(p.y, p.m, dim(p.y, p.m))) - assetAccum(a, prevEnd);
  }
  function assetState(a, asOf = todayYmd()) {
    const start = assetStart(a), end = assetEndDate(a);
    if (a.status === 'disposed') return { code: 'DISPOSED', label: 'Đã thanh lý', cls: 'slate' };
    if (!start || cmpYmd(start, asOf) > 0) return { code: 'NOT_STARTED', label: 'Chưa đưa vào sử dụng', cls: 'orange' };
    if (cmpYmd(asOf, end) >= 0) return { code: 'FULL', label: 'Đã khấu hao hết', cls: 'slate' };
    return { code: 'DEPRECIATING', label: 'Đang khấu hao', cls: 'green' };
  }
  function assetRemainingMonths(a, asOf = todayYmd()) {
    const e = parseYmd(assetEndDate(a)), t = parseYmd(asOf); if (!e || !t) return 0;
    if (cmpYmd(asOf, assetStart(a)) < 0) return assetMonths(a);
    return Math.max(0, (e.y * 12 + e.m) - (t.y * 12 + t.m));
  }
  /** Bảng khấu hao từng tháng. */
  function assetSchedule(a) {
    const s = parseYmd(assetStart(a)); if (!s) return [];
    const e = parseYmd(assetEndDate(a)); const rows = [];
    let y = s.y, m = s.m, prev = 0;
    while (y < e.y || (y === e.y && m <= e.m)) {
      const acc = assetAccum(a, ymdOf(y, m, dim(y, m)));
      rows.push({ ym: `${y}-${String(m).padStart(2, '0')}`, dep: acc - prev, accum: acc, book: r0(n(a.cost) - acc) });
      prev = acc; m++; if (m > 12) { m = 1; y++; }
    }
    return rows;
  }
  /** Khấu hao tất cả TSCĐ phát sinh trong tháng. */
  function depOfMonth(ym, filterFn) { return (DB.fixedAssets || []).filter((a) => !filterFn || filterFn(a)).reduce((s, a) => s + assetMonthDep(a, ym), 0); }
  window.AccDep = { assetStart, assetEndDate, assetAccum, assetBook, assetMonthDep, assetMonths, assetMonthly, assetState, assetRemainingMonths, assetSchedule, depOfMonth };

  // Thay công thức cũ (tính theo năm 365 ngày kể từ ngày mua) trong toàn bộ báo cáo.
  if (typeof AccFin !== 'undefined') {
    AccFin.assetAccumDep = (a) => assetAccum(a, todayYmd());
    AccFin.assetBookValue = (a) => assetBook(a, todayYmd());
    AccFin.depreciationOfMonth = (ym) => depOfMonth(ym || todayYmd().slice(0, 7));
  }

  const machineOptions = () => [...new Set((DB.operations || []).map((o) => String(o.machine || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));

  window.accFixedAssetsView = function () {
    const f = F('acc-assets', { asOf: '' });
    const asOf = f.asOf || todayYmd();
    const ym = asOf.slice(0, 7);
    const list = DB.fixedAssets || [];
    const sum = (fn) => list.reduce((s, a) => s + fn(a), 0);
    const totalCost = sum((a) => n(a.cost));
    const accum = sum((a) => assetAccum(a, asOf));
    const monthDep = sum((a) => assetMonthDep(a, ym));
    const fullCount = list.filter((a) => assetState(a, asOf).code === 'FULL').length;
    const rows = list.map((a) => {
      const st = assetState(a, asOf); const ac = assetAccum(a, asOf);
      const usingDefault = !a.startUseDate;
      return `<tr>
        <td><span class="code">${esc(a.id)}</span></td>
        <td>${cell2(esc(a.name), esc([a.dept, a.machine ? 'Máy: ' + a.machine : ''].filter(Boolean).join(' · ')))}</td>
        <td class="num">${fmtDate(a.purchaseDate)}</td>
        <td class="num">${fmtDate(assetStart(a))}${usingDefault ? '<div class="cell-sub">mặc định = ngày mua</div>' : ''}</td>
        <td class="num center">${esc(String(a.usefulYears))} năm<div class="cell-sub">đến ${fmtDate(assetEndDate(a))}</div></td>
        <td class="right num">${money(a.cost)}</td>
        <td class="right num">${money(assetMonthDep(a, ym))}<div class="cell-sub">${money(assetMonthly(a))}/tháng</div></td>
        <td class="right num">${money(ac)}</td>
        <td class="right num strong">${money(n(a.cost) - ac)}</td>
        <td><span class="badge ${st.cls}">${esc(st.label)}</span>${st.code === 'DEPRECIATING' ? `<div class="cell-sub">còn ${assetRemainingMonths(a, asOf)} tháng</div>` : ''}</td>
        <td class="right">${rowActions([{ act: 'acc-asset-schedule', data: `data-id="${esc(a.id)}"`, icon: 'fa-table-list', title: 'Bảng khấu hao' }, { act: 'acc-asset-edit', data: `data-id="${esc(a.id)}"`, icon: 'fa-pen', title: 'Sửa' }, { act: 'acc-asset-delete', data: `data-id="${esc(a.id)}"`, icon: 'fa-trash', title: 'Xóa' }])}</td></tr>`;
    });
    return `${pageHead('Tài sản cố định', 'Khấu hao đường thẳng theo thời hạn sử dụng, tính từ ngày bắt đầu sử dụng (tháng đầu tính theo số ngày)', '<button class="btn btn-primary" data-act="acc-asset-add"><i class="fa-solid fa-plus"></i>Thêm tài sản</button>')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Nguyên giá', money(totalCost), 'fa-warehouse', 'blue')}${mkpi('Khấu hao lũy kế', money(accum), 'fa-chart-line', 'orange')}${mkpi('Giá trị còn lại', money(totalCost - accum), 'fa-scale-balanced', 'green')}${mkpi(`Khấu hao tháng ${ym.slice(5)}/${ym.slice(0, 4)}`, money(monthDep), 'fa-calendar-day', 'teal')}${mkpi('Đã khấu hao hết', fullCount, 'fa-circle-check', 'slate')}</div>
    <div class="card"><div class="toolbar"><label class="cell-sub">Tính khấu hao đến hết ngày</label><input class="inp" type="date" data-f="acc-assets.asOf" value="${esc(asOf)}"><button class="btn btn-sm" data-act="acc-asset-today"><i class="fa-solid fa-calendar-day"></i>Hôm nay</button><span class="spacer"></span><span class="chip">${list.length} tài sản</span></div>
    ${tableShell([{ t: 'Mã' }, { t: 'Tài sản' }, { t: 'Ngày mua' }, { t: 'Bắt đầu sử dụng' }, { t: 'Thời hạn sử dụng', cls: 'center' }, { t: 'Nguyên giá', cls: 'right' }, { t: 'KH tháng', cls: 'right' }, { t: 'KH lũy kế', cls: 'right' }, { t: 'Còn lại', cls: 'right' }, { t: 'Trạng thái' }, { t: '', cls: 'right', w: '120px' }], rows, { emptyTitle: 'Chưa có tài sản cố định' })}</div>`;
  };

  window.openFixedAssetForm = function (id = '') {
    const a = id ? (DB.fixedAssets || []).find((x) => x.id === id) : null;
    const dateNow = todayYmd();
    const machOpts = machineOptions().map((m) => `<option ${a?.machine === m ? 'selected' : ''}>${esc(m)}</option>`).join('');
    return Modal.open({
      title: a ? 'Sửa tài sản cố định' : 'Thêm tài sản cố định',
      body: `<div class="form-grid cols-2">
        <div class="field" style="grid-column:1/-1"><label>Tên tài sản <span class="req">*</span></label><input class="inp" id="faName" value="${esc(a?.name || '')}"></div>
        <div class="field"><label>Bộ phận sử dụng</label><select class="inp" id="faDept">${(DB.departments || []).map((d) => `<option ${a?.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
        <div class="field"><label>Nguyên giá <span class="req">*</span></label><input class="inp right num" id="faCost" data-money="1" type="text" inputmode="numeric" value="${a?.cost || ''}"></div>
        <div class="field"><label>Ngày mua</label><input class="inp" id="faDate" type="date" value="${esc(a?.purchaseDate || dateNow)}"></div>
        <div class="field"><label>Ngày bắt đầu sử dụng <span class="req">*</span></label><input class="inp" id="faStart" type="date" value="${esc(a?.startUseDate || a?.purchaseDate || dateNow)}"><div class="cell-sub">Khấu hao tính từ ngày này.</div></div>
        <div class="field"><label>Thời hạn sử dụng (năm) <span class="req">*</span></label><input class="inp right num" id="faYears" type="number" min="0.5" max="50" step="0.5" value="${a?.usefulYears || 8}"></div>
        <div class="field"><label>Ngày kết thúc khấu hao</label><input class="inp" id="faEnd" type="text" readonly value=""></div>
        <div class="field"><label>Máy móc gắn với công đoạn (tính giá thành)</label><select class="inp" id="faMachine"><option value="">— Không phải máy sản xuất —</option>${machOpts}</select></div>
        <div class="field"><label>Giờ chạy chuẩn / tháng</label><input class="inp right num" id="faHours" type="number" min="1" max="744" step="1" value="${a?.workHoursPerMonth || 200}"><div class="cell-sub">Chia khấu hao tháng thành giờ máy khi tính giá thành.</div></div>
      </div>
      <div class="cell-sub" style="margin-top:8px">Mức khấu hao tháng = Nguyên giá ÷ (số năm × 12). Tháng đầu tính theo số ngày kể từ ngày bắt đầu sử dụng (Thông tư 45/2013/TT-BTC).</div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="acc-asset-save" data-id="${esc(id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`,
      onMount: () => {
        const upd = () => { const e = assetEndDate({ startUseDate: $('#faStart')?.value, usefulYears: $('#faYears')?.value }); const el = $('#faEnd'); if (el) el.value = e ? fmtDate(e) : ''; };
        ['#faStart', '#faYears'].forEach((s) => $(s)?.addEventListener('input', upd));
        $('#faDate')?.addEventListener('change', () => { const st = $('#faStart'); if (st && (!a || !a.startUseDate) && st.value < $('#faDate').value) { st.value = $('#faDate').value; upd(); } });
        upd();
      },
    });
  };

  function openAssetSchedule(id) {
    const a = (DB.fixedAssets || []).find((x) => x.id === id); if (!a) return;
    const rows = assetSchedule(a); const cur = todayYmd().slice(0, 7);
    Modal.open({
      title: `Bảng khấu hao · ${esc(a.name)}`, sub: `${esc(a.id)} · nguyên giá ${money(a.cost)} · ${esc(String(a.usefulYears))} năm · ${fmtDate(assetStart(a))} → ${fmtDate(assetEndDate(a))}`, size: 'lg',
      body: `<div class="tbl-wrap" style="max-height:420px;overflow:auto"><table class="line-tbl"><thead><tr><th>Tháng</th><th class="right">Khấu hao trong tháng</th><th class="right">Lũy kế</th><th class="right">Giá trị còn lại</th></tr></thead><tbody>${rows.map((r) => `<tr ${r.ym === cur ? 'style="background:var(--bg-soft,#f1f5f9);font-weight:600"' : ''}><td>${r.ym.slice(5)}/${r.ym.slice(0, 4)}${r.ym === cur ? ' · hiện tại' : ''}</td><td class="right num">${money(r.dep)}</td><td class="right num">${money(r.accum)}</td><td class="right num">${money(r.book)}</td></tr>`).join('')}</tbody></table></div>`,
      foot: `<button class="btn" data-act="acc-asset-schedule-csv" data-id="${esc(a.id)}"><i class="fa-solid fa-file-csv"></i>Xuất CSV</button><button class="btn" data-act="modal-close">Đóng</button>`,
    });
  }

  /* ========================================================================
   * 2. NGÂN HÀNG — SAO KÊ THEO KHOẢNG THỜI GIAN
   * ====================================================================== */
  function bankSource(b) { return Array.isArray(b.transactions) ? b.transactions : (DB.bankTransactions || []).filter((t) => String(t.bankId) === String(b.id)); }
  const signedTx = (t) => (t.type === 'IN' ? n(t.amount) : -n(t.amount));
  /** Tồn đầu / thu / chi / tồn cuối của một tài khoản trong [from, to]. */
  function bankPeriod(b, from, to) {
    const txs = bankSource(b).filter((t) => t.date);
    const before = txs.filter((t) => cmpYmd(String(t.date).slice(0, 10), from) < 0).reduce((s, t) => s + signedTx(t), 0);
    const inRange = txs.filter((t) => { const d = String(t.date).slice(0, 10); return cmpYmd(d, from) >= 0 && cmpYmd(d, to) <= 0; });
    const inAmt = inRange.filter((t) => t.type === 'IN').reduce((s, t) => s + n(t.amount), 0);
    const outAmt = inRange.filter((t) => t.type !== 'IN').reduce((s, t) => s + n(t.amount), 0);
    const opening = n(b.openingBalance) + before;
    return { opening, inAmt, outAmt, closing: opening + inAmt - outAmt, txs: inRange };
  }
  window.AccBankPeriod = bankPeriod;

  function bankStatementHtml() {
    const dNow = todayYmd();
    const f = F('acc-bank-stmt', { bankId: '', from: monthStart(dNow), to: dNow });
    if (!f.from) f.from = monthStart(dNow); if (!f.to) f.to = dNow; if (f.from > f.to) f.to = f.from;
    const banks = (DB.bankAccounts || []).filter((b) => !f.bankId || String(b.id) === String(f.bankId));
    const per = banks.map((b) => ({ b, p: bankPeriod(b, f.from, f.to) }));
    const tot = per.reduce((s, x) => ({ o: s.o + x.p.opening, i: s.i + x.p.inAmt, u: s.u + x.p.outAmt, c: s.c + x.p.closing }), { o: 0, i: 0, u: 0, c: 0 });
    const sumRows = per.map(({ b, p }) => `<tr><td>${cell2(esc(b.name || b.bankName || b.id), esc(b.accountNumber || ''))}</td><td class="right num">${money(p.opening)}</td><td class="right num" style="color:var(--green,#16a34a)">+${money(p.inAmt)}</td><td class="right num" style="color:var(--red)">−${money(p.outAmt)}</td><td class="right strong num">${money(p.closing)}</td></tr>`);
    const lines = [];
    per.forEach(({ b, p }) => {
      let run = p.opening;
      p.txs.slice().sort((x, y) => String(x.date).localeCompare(String(y.date)) || String(x.id || '').localeCompare(String(y.id || ''))).forEach((t) => {
        run += signedTx(t);
        lines.push(`<tr><td class="num">${fmtDate(t.date)}</td><td>${esc(b.name || b.bankName || b.id)}</td><td>${esc(t.note || t.description || '—')}${t.sourceId ? `<div class="cell-sub">${esc(t.sourceType || '')} ${esc(t.sourceId)}</div>` : ''}</td><td class="right num" style="color:var(--green,#16a34a)">${t.type === 'IN' ? money(t.amount) : ''}</td><td class="right num" style="color:var(--red)">${t.type !== 'IN' ? money(t.amount) : ''}</td><td class="right num">${money(run)}</td></tr>`);
      });
    });
    const bankOpts = [['', 'Tất cả tài khoản'], ...(DB.bankAccounts || []).map((b) => [b.id, b.name || b.bankName || b.id])];
    return `<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Sao kê theo khoảng thời gian</h3><p>Tồn đầu kỳ, tổng thu, tổng chi và tồn cuối kỳ; mặc định tháng hiện tại</p></div></div>
      <div class="toolbar"><select class="inp" data-f="acc-bank-stmt.bankId">${bankOpts.map(([v, l]) => `<option value="${esc(v)}" ${String(f.bankId) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <label class="cell-sub">Từ</label><input class="inp" type="date" data-f="acc-bank-stmt.from" value="${esc(f.from)}"><label class="cell-sub">Đến</label><input class="inp" type="date" data-f="acc-bank-stmt.to" value="${esc(f.to)}">
        <button class="btn btn-sm" data-act="acc-bank-stmt-today"><i class="fa-solid fa-calendar-day"></i>Tháng này</button><span class="spacer"></span><button class="btn btn-sm" data-act="acc-bank-stmt-csv"><i class="fa-solid fa-file-csv"></i>Xuất CSV</button></div>
      <div class="grid g-auto-sm" style="margin:12px 0">${mkpi('Tồn đầu kỳ', money(tot.o), 'fa-arrow-right-to-bracket', 'blue')}${mkpi('Tổng thu', money(tot.i), 'fa-arrow-down', 'green')}${mkpi('Tổng chi', money(tot.u), 'fa-arrow-up', 'red')}${mkpi('Tồn cuối kỳ', money(tot.c), 'fa-flag-checkered', 'teal')}</div>
      ${tableShell([{ t: 'Tài khoản' }, { t: 'Tồn đầu kỳ', cls: 'right' }, { t: 'Thu', cls: 'right' }, { t: 'Chi', cls: 'right' }, { t: 'Tồn cuối kỳ', cls: 'right' }], sumRows, { emptyTitle: 'Chưa có tài khoản ngân hàng' })}
      <div class="form-sec-title" style="margin-top:14px">Giao dịch trong kỳ</div>
      ${tableShell([{ t: 'Ngày' }, { t: 'Tài khoản' }, { t: 'Nội dung' }, { t: 'Thu', cls: 'right' }, { t: 'Chi', cls: 'right' }, { t: 'Số dư sau GD', cls: 'right' }], lines, { emptyTitle: 'Không có giao dịch trong kỳ' })}</div>`;
  }
  const _accBankingViewOrig = typeof accBankingView === 'function' ? accBankingView : null;
  window.accBankingView = function () { return (_accBankingViewOrig ? _accBankingViewOrig() : '') + bankStatementHtml(); };

  /* ------------------------------------------------------------------ actions phần 1 */
  Object.assign(Actions, {
    'acc-asset-today': () => { F('acc-assets').asOf = ''; render(); },
    'acc-asset-schedule': (d) => openAssetSchedule(d.id),
    'acc-asset-schedule-csv': (d) => {
      const a = (DB.fixedAssets || []).find((x) => x.id === d.id); if (!a) return;
      Exporter.csv(`Bang-khau-hao-${a.id}.csv`, ['Tháng', 'Khấu hao trong tháng', 'Lũy kế', 'Giá trị còn lại'], assetSchedule(a).map((r) => [r.ym, r.dep, r.accum, r.book]));
    },
    'acc-asset-save': async (d) => {
      const name = ($('#faName')?.value || '').trim();
      const cost = parseMoney($('#faCost')?.value) || 0;
      const purchaseDate = $('#faDate')?.value || todayYmd();
      const startUseDate = $('#faStart')?.value || purchaseDate;
      const years = Number($('#faYears')?.value);
      const hours = Number($('#faHours')?.value) || 200;
      if (!name || cost <= 0) { Toast.err('Thiếu thông tin', 'Vui lòng nhập tên tài sản và nguyên giá lớn hơn 0.'); return; }
      if (!(years >= 0.5 && years <= 50)) { Toast.err('Thời hạn không hợp lệ', 'Thời hạn sử dụng từ 0,5 đến 50 năm.'); return; }
      if (startUseDate < purchaseDate) { Toast.err('Ngày bắt đầu sử dụng không hợp lệ', 'Ngày bắt đầu sử dụng không được trước ngày mua.'); return; }
      const payload = { name, dept: $('#faDept')?.value || '', purchaseDate, startUseDate, cost, usefulYears: years, machine: $('#faMachine')?.value || '', workHoursPerMonth: hours };
      try { if (typeof RestaurantQualityAPI !== 'undefined') await RestaurantQualityAPI.ensureFresh(['fixedAssets'], { force: false }); } catch (_) {}
      const before = JSON.parse(JSON.stringify(DB.fixedAssets || []));
      if (d.id) { const cur = DB.fixedAssets.find((a) => a.id === d.id); if (!cur) return; Object.assign(cur, payload); }
      else DB.fixedAssets.push({ id: nextCode('TS-', DB.fixedAssets), status: 'active', ...payload });
      try {
        if (typeof RestaurantQualityAPI !== 'undefined') await RestaurantQualityAPI.syncRestaurant(['fixedAssets']);
        Modal.close(); render(); Toast.ok(d.id ? 'Đã cập nhật tài sản' : 'Đã thêm tài sản', `${name} · khấu hao đến ${fmtDate(assetEndDate(payload))}`);
      } catch (err) { DB.fixedAssets = before; Toast.err('Không lưu được lên server', err?.message || 'Vui lòng thử lại.'); }
    },
    'acc-bank-stmt-today': () => { const f = F('acc-bank-stmt'); f.from = monthStart(todayYmd()); f.to = todayYmd(); render(); },
    'acc-bank-stmt-csv': () => {
      const f = F('acc-bank-stmt'); const rows = [];
      (DB.bankAccounts || []).filter((b) => !f.bankId || String(b.id) === String(f.bankId)).forEach((b) => {
        const p = bankPeriod(b, f.from, f.to);
        rows.push([b.name || b.bankName || b.id, b.accountNumber || '', 'Tồn đầu kỳ', '', p.opening, '', '']);
        p.txs.slice().sort((x, y) => String(x.date).localeCompare(String(y.date))).forEach((t) => rows.push([b.name || b.bankName || b.id, b.accountNumber || '', t.date, t.note || '', t.type === 'IN' ? n(t.amount) : '', t.type !== 'IN' ? n(t.amount) : '', '']));
        rows.push([b.name || b.bankName || b.id, b.accountNumber || '', 'Tổng thu / chi / Tồn cuối kỳ', '', p.inAmt, p.outAmt, p.closing]);
      });
      Exporter.csv(`Sao-ke-ngan-hang-${f.from}-${f.to}.csv`, ['Tài khoản', 'Số TK', 'Ngày', 'Nội dung', 'Thu', 'Chi', 'Tồn'], rows);
    },
  });

  window.__accV2 = { n, r0, todayYmd, parseYmd, dim, ymdOf, cmpYmd, monthStart, monthEnd, addDaysYmd, money, canAccounting, who, stamp, store, TABLES };
})();

/* ============================================================================
 * 3. THU TIỀN KHÁCH HÀNG — KẾ TOÁN XÁC NHẬN ĐÃ NHẬN TIỀN
 * ----------------------------------------------------------------------------
 * - Người ngoài kế toán ghi nhận thu tiền → confirmStatus = PENDING: chưa tính vào
 *   "đã thu", chưa vào dòng tiền, chưa ghi sổ ngân hàng.
 * - Kế toán (quyền ACCOUNTING_OPERATE) xác nhận đã nhận tiền → CONFIRMED + ghi ngân hàng
 *   (nếu chuyển khoản), hoặc từ chối → REJECTED kèm lý do.
 * - Dữ liệu cũ (chưa có confirmStatus) coi là đã xác nhận.
 * ========================================================================== */
(function () {
  'use strict';
  const { n, todayYmd, money, canAccounting, who } = window.__accV2;
  const st = (p) => String(p?.confirmStatus || 'CONFIRMED').toUpperCase();
  const pendingList = () => (DB.customerPayments || []).filter((p) => st(p) === 'PENDING');
  const findPay = (id) => (DB.customerPayments || []).find((p) => String(p.id) === String(id));

  window.paymentStatusTag = function (p) {
    const s = st(p);
    if (s === 'PENDING') return '<div><span class="badge orange">Chờ KT xác nhận</span></div>';
    if (s === 'REJECTED') return `<div><span class="badge red" title="${esc(p.rejectReason || '')}">KT từ chối</span></div>`;
    return '';
  };

  function pendingCardHtml() {
    const list = pendingList().sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));
    const can = canAccounting();
    const rows = list.map((p) => `<tr>
      <td><span class="code">${esc(p.id)}</span></td><td class="num">${fmtDate(p.date)}</td>
      <td><span class="code">${esc(p.orderId || '—')}</span></td><td>${esc(Q.customerName(p.customerId))}</td>
      <td class="right num strong">${money(p.amount)}</td><td>${esc(p.method || '—')}${p.bankName ? `<div class="cell-sub">${esc(p.bankName)}</div>` : ''}</td>
      <td>${esc(p.payerName || p.createdByName || '—')}<div class="cell-sub">${esc(String(p.createdAt || '').replace('T', ' ').slice(0, 16))}</div></td>
      <td class="muted">${esc(p.reference || p.bankRef || '')}</td>
      <td class="right">${can ? `<button class="btn btn-sm btn-primary" data-act="acc-pay-confirm" data-id="${esc(p.id)}"><i class="fa-solid fa-circle-check"></i>Xác nhận đã nhận</button> <button class="btn btn-sm" data-act="acc-pay-reject" data-id="${esc(p.id)}"><i class="fa-solid fa-xmark"></i>Từ chối</button>` : '<span class="muted">Chờ kế toán</span>'}</td></tr>`);
    const total = list.reduce((s, p) => s + n(p.amount), 0);
    return `<div class="card" style="margin-bottom:14px;${list.length ? 'border-left:3px solid var(--orange)' : ''}"><div class="card-head"><div><h3>Chờ kế toán xác nhận đã nhận tiền</h3><p>Khoản thu do bộ phận khác ghi nhận; chỉ tính vào đã thu và ghi sổ ngân hàng sau khi kế toán xác nhận.${list.length ? ` Tổng chờ xác nhận: <b>${money(total)}</b>` : ''}</p></div></div>
      ${tableShell([{ t: 'Mã thu' }, { t: 'Ngày' }, { t: 'Đơn hàng' }, { t: 'Khách hàng' }, { t: 'Số tiền', cls: 'right' }, { t: 'Phương thức' }, { t: 'Người ghi nhận' }, { t: 'Tham chiếu' }, { t: '', cls: 'right', w: '250px' }], rows, { emptyTitle: 'Không có khoản thu nào chờ xác nhận' })}</div>`;
  }
  const _accArViewOrig = typeof accArView === 'function' ? accArView : null;
  window.accArView = function () {
    const html = _accArViewOrig ? _accArViewOrig() : '';
    const marker = '<div class="card" style="margin-bottom:14px"><div class="toolbar">';
    const i = html.indexOf(marker);
    const card = pendingCardHtml();
    return i >= 0 ? html.slice(0, i) + card + html.slice(i) : html + card;
  };

  // Báo cho người ghi nhận biết khoản thu sẽ chờ kế toán xác nhận.
  const _openPayOrig = typeof openCustomerPaymentModal === 'function' ? openCustomerPaymentModal : null;
  if (_openPayOrig) window.openCustomerPaymentModal = function (orderId) {
    _openPayOrig(orderId);
    setTimeout(() => {
      const grid = document.querySelector('#crmPayAmount')?.closest('.form-grid'); if (!grid || document.querySelector('#crmPayConfirmNote')) return;
      const pend = typeof SalesCRM !== 'undefined' ? SalesCRM.pendingOfOrder(orderId) : 0;
      const html = `<div id="crmPayConfirmNote" class="note-box" style="margin-bottom:10px">${canAccounting() ? 'Bạn thuộc bộ phận kế toán: khoản thu được xác nhận ngay khi lưu.' : '<b>Khoản thu sẽ chờ kế toán xác nhận đã nhận tiền</b> trước khi tính vào đã thu và ghi sổ ngân hàng.'}${pend > 0 ? `<div class="cell-sub">Đơn này đang có ${money(pend)} chờ kế toán xác nhận; số tiền tối đa được ghi thêm đã trừ phần này.</div>` : ''}</div>`;
      grid.insertAdjacentHTML('beforebegin', html);
    }, 0);
  };

  async function persistPayment(p, order) {
    if (typeof CRMAPI !== 'undefined') await CRMAPI.syncCollections(['customerPayments', 'orders']);
    if (typeof SalesCRM !== 'undefined') SalesCRM.saveLocal(['customerPayments', 'orders'], { sync: false });
  }
  function refreshOrder(o) { if (!o || typeof SalesCRM === 'undefined') return; o.paid = SalesCRM.paidOfOrder(o.id); o.receivable = SalesCRM.receivableOfOrder(o); }

  function openConfirm(id) {
    const p = findPay(id); if (!p || st(p) !== 'PENDING') { Toast.warn('Khoản thu đã được xử lý', id || ''); return; }
    if (!canAccounting()) { Toast.err('Không có quyền', 'Chỉ kế toán được xác nhận đã nhận tiền.'); return; }
    const isBank = /chuy[eể]n/i.test(String(p.method || '')) || !!p.bankId;
    const bankOpts = (DB.bankAccounts || []).map((b) => `<option value="${esc(b.id)}" ${String(b.id) === String(p.bankId) ? 'selected' : ''}>${esc(b.name || ((b.bankName || 'Ngân hàng') + ' · ' + (b.accountNumber || '')))}</option>`).join('');
    const dup = p.reference ? (DB.customerPayments || []).find((x) => x.id !== p.id && st(x) === 'CONFIRMED' && String(x.reference || x.bankRef || '') === String(p.reference)) : null;
    Modal.open({
      title: `Xác nhận đã nhận tiền · ${esc(p.id)}`, sub: `${esc(Q.customerName(p.customerId))} · đơn ${esc(p.orderId || '')} · ${money(p.amount)}`, size: 'md',
      body: `<div class="info-grid" style="margin-bottom:12px"><div><span class="cell-sub">Số tiền</span><div><b>${money(p.amount)}</b></div></div><div><span class="cell-sub">Phương thức</span><div>${esc(p.method || '—')}</div></div><div><span class="cell-sub">Người ghi nhận</span><div>${esc(p.payerName || p.createdByName || '—')}</div></div><div><span class="cell-sub">Ngày ghi nhận</span><div>${fmtDate(p.date)}</div></div></div>
      ${dup ? `<div class="alert warning" style="margin-bottom:10px"><i class="fa-solid fa-triangle-exclamation"></i><span>Số tham chiếu "${esc(p.reference)}" đã dùng cho khoản ${esc(dup.id)} đã xác nhận. Kiểm tra tránh ghi trùng.</span></div>` : ''}
      <div class="form-grid cols-2">
        <div class="field"><label>Ngày tiền về thực tế <span class="req">*</span></label><input class="inp" id="payCfDate" type="date" value="${esc(String(p.date || todayYmd()).slice(0, 10))}" max="${todayYmd()}"></div>
        ${isBank ? `<div class="field"><label>Tài khoản ngân hàng nhận <span class="req">*</span></label><select class="inp" id="payCfBank"><option value="">— Chọn —</option>${bankOpts}</select></div>` : '<div class="field"><label>Hình thức</label><input class="inp" disabled value="Tiền mặt"></div>'}
        <div class="field"><label>Số tham chiếu / mã giao dịch</label><input class="inp" id="payCfRef" value="${esc(p.reference || p.bankRef || '')}" placeholder="Theo sao kê ngân hàng"></div>
        <div class="field"><label>Ghi chú</label><input class="inp" id="payCfNote"></div>
      </div>
      <label style="display:flex;gap:8px;margin-top:12px;align-items:flex-start"><input type="checkbox" id="payCfAck" style="margin-top:3px"><span>Tôi xác nhận <b>đã nhận đủ ${money(p.amount)}</b>${isBank ? ' trên sao kê ngân hàng' : ' bằng tiền mặt'}.</span></label>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="acc-pay-confirm-save" data-id="${esc(p.id)}"><i class="fa-solid fa-circle-check"></i>Xác nhận đã nhận tiền</button>`,
    });
  }
  async function confirmSave(id) {
    const p = findPay(id); if (!p || st(p) !== 'PENDING') { Toast.warn('Khoản thu đã được xử lý', id || ''); return; }
    if (!canAccounting()) { Toast.err('Không có quyền', 'Chỉ kế toán được xác nhận đã nhận tiền.'); return; }
    if (!$('#payCfAck')?.checked) { Toast.err('Chưa xác nhận', 'Tích xác nhận đã nhận đủ số tiền.'); return; }
    const receivedDate = $('#payCfDate')?.value || ''; if (!receivedDate) { Toast.err('Thiếu ngày', 'Nhập ngày tiền về thực tế.'); return; }
    const bankEl = $('#payCfBank'); const bankId = bankEl ? bankEl.value : (p.bankId || '');
    if (bankEl && !bankId) { Toast.err('Chưa chọn ngân hàng', 'Chọn tài khoản ngân hàng đã nhận tiền.'); return; }
    const bank = (DB.bankAccounts || []).find((b) => String(b.id) === String(bankId));
    const o = Q.order(p.orderId);
    const before = { ...p }, oPaid = o?.paid, oRec = o?.receivable;
    Object.assign(p, { confirmStatus: 'CONFIRMED', confirmedAt: new Date().toISOString(), confirmedBy: DB.currentUser?.id || '', confirmedByName: who(), receivedDate, confirmNote: ($('#payCfNote')?.value || '').trim(), reference: ($('#payCfRef')?.value || '').trim(), bankId, bankName: bank ? (bank.name || bank.bankName || '') : p.bankName, bankAccount: bank ? (bank.accountNumber || '') : p.bankAccount });
    refreshOrder(o);
    try {
      await persistPayment(p, o);
      if (bankId && typeof AccountingBank !== 'undefined') {
        await AccountingBank.record({ bankId, type: 'IN', date: receivedDate, amount: n(p.amount), note: `Thu công nợ ${p.orderId} · ${Q.customerName(p.customerId)}`, sourceType: 'CUSTOMER_PAYMENT', sourceId: p.id, createdBy: DB.currentUser?.id || '', accountingEntryId: p.accountingEntryId || '' });
      }
    } catch (err) {
      Object.keys(p).forEach((k) => { if (!(k in before)) delete p[k]; }); Object.assign(p, before);
      if (o) { if (oPaid === undefined) delete o.paid; else o.paid = oPaid; if (oRec === undefined) delete o.receivable; else o.receivable = oRec; }
      try { await persistPayment(p, o); } catch (_) {}
      console.error('[AccV2] Xác nhận thu tiền thất bại:', err); Toast.err('Chưa xác nhận được', err?.message || 'Không lưu được lên KIO, dữ liệu đã hoàn tác.'); render(); return;
    }
    if (typeof pushNotification === 'function') pushNotification({ level: 'info', icon: 'fa-circle-check', title: `Kế toán đã xác nhận nhận tiền · ${Q.customerName(p.customerId)}`, desc: `${p.id} · đơn ${p.orderId} · ${money(p.amount)}`, go: { module: 'crm', tab: 'debts' } });
    Modal.close(); render(); Toast.ok('Đã xác nhận đã nhận tiền', `${p.id} · ${money(p.amount)}${o ? ' · còn phải thu ' + money(SalesCRM.receivableOfOrder(o)) : ''}`);
  }
  function openReject(id) {
    const p = findPay(id); if (!p || st(p) !== 'PENDING') return;
    Modal.open({ title: `Từ chối khoản thu · ${esc(p.id)}`, sub: `${esc(Q.customerName(p.customerId))} · ${money(p.amount)}`, size: 'md', body: '<div class="field"><label>Lý do từ chối (chưa nhận được tiền, sai số tiền…) <span class="req">*</span></label><textarea class="inp" id="payRejReason" rows="3"></textarea></div><div class="cell-sub">Khoản bị từ chối không tính vào đã thu; đơn hàng vẫn còn công nợ.</div>', foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="acc-pay-reject-save" data-id="${esc(p.id)}"><i class="fa-solid fa-xmark"></i>Từ chối</button>` });
  }
  async function rejectSave(id) {
    const p = findPay(id); if (!p || st(p) !== 'PENDING') return; if (!canAccounting()) { Toast.err('Không có quyền', 'Chỉ kế toán được từ chối.'); return; }
    const reason = ($('#payRejReason')?.value || '').trim(); if (!reason) { Toast.err('Thiếu lý do', 'Nhập lý do từ chối.'); return; }
    const before = { ...p };
    Object.assign(p, { confirmStatus: 'REJECTED', rejectReason: reason, rejectedAt: new Date().toISOString(), rejectedBy: DB.currentUser?.id || '', rejectedByName: who() });
    try { await persistPayment(p, Q.order(p.orderId)); }
    catch (err) { Object.keys(p).forEach((k) => { if (!(k in before)) delete p[k]; }); Object.assign(p, before); Toast.err('Chưa lưu được', err?.message || 'Vui lòng thử lại.'); render(); return; }
    if (typeof pushNotification === 'function') pushNotification({ level: 'warning', icon: 'fa-xmark', title: `Kế toán từ chối khoản thu · ${Q.customerName(p.customerId)}`, desc: `${p.id} · ${money(p.amount)} · ${reason}`, go: { module: 'crm', tab: 'debts' } });
    Modal.close(); render(); Toast.ok('Đã từ chối khoản thu', `${p.id}`);
  }
  Object.assign(Actions, {
    'acc-pay-confirm': (d) => openConfirm(d.id), 'acc-pay-confirm-save': (d) => confirmSave(d.id),
    'acc-pay-reject': (d) => openReject(d.id), 'acc-pay-reject-save': (d) => rejectSave(d.id),
  });
  window.__accV2.pendingPayments = pendingList;
})();

/* ============================================================================
 * 4. DOANH THU THEO KỲ — đầu kỳ, phát sinh, cuối kỳ, thay đổi; chốt kỳ để lưu lại
 * ----------------------------------------------------------------------------
 * Doanh thu = giá trị trước VAT của đơn bán đã giao / hoàn tất (AccFin.recognizedOrders).
 *  - Đầu kỳ  = doanh thu lũy kế từ đầu năm đến hết ngày trước kỳ
 *  - Phát sinh = doanh thu trong kỳ
 *  - Cuối kỳ = đầu kỳ + phát sinh
 *  - Thay đổi = phát sinh kỳ này − phát sinh kỳ liền trước (cùng độ dài)
 * "Chốt kỳ" lưu bản chụp số liệu; nếu dữ liệu đơn hàng đổi sau khi chốt, hệ thống báo lệch.
 * ========================================================================== */
(function () {
  'use strict';
  const { n, r0, todayYmd, parseYmd, dim, ymdOf, cmpYmd, monthStart, monthEnd, addDaysYmd, money, canAccounting, who, stamp, store } = window.__accV2;
  if (typeof ACC_TAB_GROUPS !== 'undefined') { ACC_TAB_GROUPS.revenue_period = ['sales']; ACC_TAB_GROUPS.invoices = ['sales']; }

  const orderNet = (o) => n(o.subtotal ?? (n(o.total) - n(o.vat)));
  const orderDate = (o) => String(o.date || '').slice(0, 10);
  const orders = () => (typeof AccFin !== 'undefined' ? AccFin.recognizedOrders() : []);
  const sumRange = (from, to) => orders().filter((o) => { const d = orderDate(o); return d && cmpYmd(d, from) >= 0 && cmpYmd(d, to) <= 0; });
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000) + 1;

  function periodOf(type, anchor) {
    const p = parseYmd(anchor || todayYmd());
    if (type === 'DAY') return { from: ymdOf(p.y, p.m, p.d), to: ymdOf(p.y, p.m, p.d) };
    if (type === 'QUARTER') { const q = Math.floor((p.m - 1) / 3); const m1 = q * 3 + 1; return { from: ymdOf(p.y, m1, 1), to: ymdOf(p.y, m1 + 2, dim(p.y, m1 + 2)) }; }
    if (type === 'YEAR') return { from: ymdOf(p.y, 1, 1), to: ymdOf(p.y, 12, 31) };
    return { from: ymdOf(p.y, p.m, 1), to: ymdOf(p.y, p.m, dim(p.y, p.m)) };
  }
  const periodLabel = (from, to) => (from === to ? fmtDate(from) : `${fmtDate(from)} → ${fmtDate(to)}`);
  const shiftYear = (ymd, delta) => { const p = parseYmd(ymd); return ymdOf(p.y + delta, p.m, Math.min(p.d, dim(p.y + delta, p.m))); };
  /** Nhận diện loại kỳ theo ngày để lấy đúng kỳ liền trước (tháng trước, quý trước, năm trước…). */
  function inferType(from, to) {
    if (from === to) return 'DAY';
    const a = parseYmd(from), b = parseYmd(to);
    if (a.d === 1 && a.y === b.y && a.m === b.m && b.d === dim(b.y, b.m)) return 'MONTH';
    if (a.d === 1 && a.y === b.y && a.m % 3 === 1 && b.m === a.m + 2 && b.d === dim(b.y, b.m)) return 'QUARTER';
    if (a.m === 1 && a.d === 1 && b.m === 12 && b.d === 31 && a.y === b.y) return 'YEAR';
    return 'CUSTOM';
  }
  function previousPeriod(from, to) {
    const t = inferType(from, to), a = parseYmd(from);
    if (t === 'MONTH') { const pm = a.m === 1 ? 12 : a.m - 1, py = a.m === 1 ? a.y - 1 : a.y; return { from: ymdOf(py, pm, 1), to: ymdOf(py, pm, dim(py, pm)) }; }
    if (t === 'QUARTER') { const pm = a.m === 1 ? 10 : a.m - 3, py = a.m === 1 ? a.y - 1 : a.y; return { from: ymdOf(py, pm, 1), to: ymdOf(py, pm + 2, dim(py, pm + 2)) }; }
    if (t === 'YEAR') return { from: ymdOf(a.y - 1, 1, 1), to: ymdOf(a.y - 1, 12, 31) };
    const len = daysBetween(from, to); return { from: addDaysYmd(from, -len), to: addDaysYmd(from, -1) };
  }
  /** Tính toàn bộ chỉ tiêu của một kỳ. */
  function calcRevenue(from, to) {
    const yearStart = from.slice(0, 4) + '-01-01';
    const openingOrders = cmpYmd(from, yearStart) > 0 ? sumRange(yearStart, addDaysYmd(from, -1)) : [];
    const periodOrders = sumRange(from, to);
    const pp = previousPeriod(from, to); const prevFrom = pp.from, prevTo = pp.to;
    const prevOrders = sumRange(prevFrom, prevTo);
    const lastYearOrders = sumRange(shiftYear(from, -1), shiftYear(to, -1));
    const opening = openingOrders.reduce((s, o) => s + orderNet(o), 0), inPeriod = periodOrders.reduce((s, o) => s + orderNet(o), 0);
    const prev = prevOrders.reduce((s, o) => s + orderNet(o), 0), lastYear = lastYearOrders.reduce((s, o) => s + orderNet(o), 0);
    return { from, to, yearStart, opening: r0(opening), inPeriod: r0(inPeriod), closing: r0(opening + inPeriod), prevFrom, prevTo, prev: r0(prev), change: r0(inPeriod - prev), changePct: prev > 0 ? (inPeriod - prev) / prev * 100 : null, lastYear: r0(lastYear), orderCount: periodOrders.length, orders: periodOrders };
  }
  window.AccRevenue = { calcRevenue, periodOf };
  const pctText = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);
  const sgn = (v) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
  const snapId = (from, to) => `DT-${from}_${to}`;

  function revenueRows(c) {
    const len = daysBetween(c.from, c.to); const rows = []; let run = c.opening;
    if (len <= 62) {
      for (let i = 0; i < len; i++) {
        const d = addDaysYmd(c.from, i); const os = c.orders.filter((o) => orderDate(o) === d); if (!os.length) continue;
        const v = os.reduce((s, o) => s + orderNet(o), 0); run += v; rows.push({ label: fmtDate(d), n: os.length, v, run });
      }
    } else {
      const byMonth = {}; c.orders.forEach((o) => { const k = orderDate(o).slice(0, 7); (byMonth[k] = byMonth[k] || []).push(o); });
      Object.keys(byMonth).sort().forEach((k) => { const v = byMonth[k].reduce((s, o) => s + orderNet(o), 0); run += v; rows.push({ label: `${k.slice(5)}/${k.slice(0, 4)}`, n: byMonth[k].length, v, run }); });
    }
    return rows;
  }

  function revenuePeriodView() {
    store.ensure('revenuePeriods').then(() => { if (State.module === 'accounting' && State.tab === 'revenue_period' && !window.__revLoaded) { window.__revLoaded = true; render(); } });
    const f = F('acc-revenue', { type: 'MONTH', from: '', to: '' });
    if (!f.from || !f.to) { const p = periodOf(f.type, todayYmd()); f.from = p.from; f.to = p.to; }
    if (cmpYmd(f.from, f.to) > 0) f.to = f.from;
    const c = calcRevenue(f.from, f.to);
    const snaps = store.list('revenuePeriods').slice().sort((a, b) => String(b.from).localeCompare(String(a.from)));
    const cur = snaps.find((s) => s.id === snapId(f.from, f.to));
    const drift = cur ? c.inPeriod - n(cur.inPeriod) : 0;
    const rows = revenueRows(c).map((r) => `<tr><td class="num">${esc(r.label)}</td><td class="center num">${r.n}</td><td class="right num">${money(r.v)}</td><td class="right num">${money(r.run)}</td></tr>`);
    const typeOpts = [['DAY', 'Ngày'], ['MONTH', 'Tháng'], ['QUARTER', 'Quý'], ['YEAR', 'Năm'], ['CUSTOM', 'Tùy chọn']];
    const histRows = snaps.map((s) => {
      const live = calcRevenue(s.from, s.to); const d = live.inPeriod - n(s.inPeriod);
      return `<tr><td>${esc(periodLabel(s.from, s.to))}${s.partial ? '<div><span class="badge orange">Chốt tạm: kỳ chưa kết thúc</span></div>' : ''}${s.revision > 1 ? `<div class="cell-sub">chốt lại lần ${s.revision}</div>` : ''}</td><td class="right num">${money(s.opening)}</td><td class="right num">${money(s.inPeriod)}</td><td class="right num strong">${money(s.closing)}</td><td class="right num" style="color:${n(s.change) >= 0 ? 'var(--green,#16a34a)' : 'var(--red)'}">${sgn(n(s.change))} <span class="cell-sub">${pctText(s.changePct)}</span></td><td>${d === 0 ? '<span class="badge green">Khớp số liệu</span>' : `<span class="badge orange" title="Số liệu hiện tại ${money(live.inPeriod)}">Lệch ${sgn(d)} so với số đã chốt</span>`}<div class="cell-sub">${esc(s.lockedByName || '')} · ${esc(stamp(s.lockedAt))}</div></td><td class="right"><button class="btn btn-sm" data-act="acc-revenue-open" data-id="${esc(s.id)}"><i class="fa-solid fa-eye"></i>Xem</button></td></tr>`;
    });
    return `${pageHead('Doanh thu theo kỳ', 'Doanh thu đầu kỳ, phát sinh, cuối kỳ và mức thay đổi; chốt kỳ để lưu lại số liệu', `<button class="btn" data-act="acc-revenue-csv"><i class="fa-solid fa-file-csv"></i>Xuất CSV</button>${canAccounting() ? `<button class="btn btn-primary" data-act="acc-revenue-lock"><i class="fa-solid fa-lock"></i>${cur ? 'Chốt lại kỳ này' : 'Chốt kỳ này'}</button>` : ''}`)}
    <div class="card"><div class="toolbar"><select class="inp" data-f="acc-revenue.type" data-act-change="acc-revenue-type">${typeOpts.map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="cell-sub">Từ</label><input class="inp" type="date" data-f="acc-revenue.from" value="${esc(f.from)}"><label class="cell-sub">Đến</label><input class="inp" type="date" data-f="acc-revenue.to" value="${esc(f.to)}">
      <button class="btn btn-sm" data-act="acc-revenue-now"><i class="fa-solid fa-calendar-day"></i>Kỳ hiện tại</button><span class="spacer"></span>${cur ? `<span class="badge ${drift === 0 ? 'green' : 'orange'}"><i class="fa-solid fa-lock"></i> Đã chốt ${esc(stamp(cur.lockedAt))}${drift === 0 ? '' : ' · lệch ' + sgn(drift)}</span>` : '<span class="badge slate">Chưa chốt</span>'}</div>
      <div class="grid g-auto-sm" style="margin:12px 0">${mkpi('Doanh thu đầu kỳ', money(c.opening), 'fa-arrow-right-to-bracket', 'blue')}${mkpi('Phát sinh trong kỳ', money(c.inPeriod), 'fa-chart-line', 'green')}${mkpi('Doanh thu cuối kỳ', money(c.closing), 'fa-flag-checkered', 'teal')}${mkpi('Thay đổi so với kỳ trước', sgn(c.change), c.change >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', c.change >= 0 ? 'green' : 'red')}</div>
      <div class="cell-sub" style="margin-bottom:10px">Đầu kỳ/cuối kỳ là doanh thu <b>lũy kế từ ${fmtDate(c.yearStart)}</b>. Kỳ liền trước: ${esc(periodLabel(c.prevFrom, c.prevTo))} = ${money(c.prev)} (${pctText(c.changePct)}). Cùng kỳ năm trước: ${money(c.lastYear)}. ${c.orderCount} đơn hàng đã giao/hoàn tất trong kỳ.</div>
      ${tableShell([{ t: 'Ngày / Tháng' }, { t: 'Số đơn', cls: 'center' }, { t: 'Doanh thu', cls: 'right' }, { t: 'Lũy kế', cls: 'right' }], rows, { emptyTitle: 'Không có doanh thu trong kỳ' })}</div>
    <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Các kỳ đã chốt</h3><p>Bản chụp số liệu tại thời điểm chốt; báo lệch nếu đơn hàng thay đổi sau đó</p></div></div>
      ${tableShell([{ t: 'Kỳ' }, { t: 'Đầu kỳ', cls: 'right' }, { t: 'Phát sinh', cls: 'right' }, { t: 'Cuối kỳ', cls: 'right' }, { t: 'Thay đổi so kỳ trước', cls: 'right' }, { t: 'Tình trạng' }, { t: '', cls: 'right', w: '90px' }], histRows, { emptyTitle: 'Chưa chốt kỳ nào' })}</div>`;
  }

  async function lockPeriod() {
    if (!canAccounting()) { Toast.err('Không có quyền', 'Chỉ kế toán được chốt kỳ doanh thu.'); return; }
    const f = F('acc-revenue'); const c = calcRevenue(f.from, f.to); const id = snapId(f.from, f.to);
    if (cmpYmd(f.from, todayYmd()) > 0) { Toast.warn('Kỳ chưa bắt đầu', 'Không chốt được kỳ trong tương lai.'); return; }
    const partial = cmpYmd(f.to, todayYmd()) > 0; // kỳ chưa kết thúc: số liệu tính đến hôm nay
    const old = store.list('revenuePeriods').find((s) => s.id === id);
    const row = { id, from: c.from, to: c.to, type: f.type, opening: c.opening, inPeriod: c.inPeriod, closing: c.closing, prev: c.prev, change: c.change, changePct: c.changePct, lastYear: c.lastYear, orderCount: c.orderCount, partial, lockedAt: new Date().toISOString(), lockedBy: DB.currentUser?.id || '', lockedByName: who(), revision: (old?.revision || 0) + 1, history: [...(old?.history || []), ...(old ? [{ at: old.lockedAt, by: old.lockedByName, opening: old.opening, inPeriod: old.inPeriod, closing: old.closing }] : [])] };
    try { await store.save('revenuePeriods', row); } catch (err) { Toast.err('Không lưu được', err?.message || 'Vui lòng thử lại.'); return; }
    render(); Toast.ok(old ? 'Đã chốt lại kỳ' : 'Đã chốt kỳ doanh thu', `${periodLabel(c.from, c.to)} · cuối kỳ ${money(c.closing)}`);
  }

  const _accV = Views.accounting || function () { return ''; };
  Views.accounting = function () {
    const tab = State.tab || 'dashboard';
    if (tab === 'revenue_period') { if (typeof accHydrateForTab === 'function') accHydrateForTab(tab); return revenuePeriodView(); }
    if (tab === 'invoices' && typeof window.accInvoicesView === 'function') { if (typeof accHydrateForTab === 'function') accHydrateForTab(tab); return window.accInvoicesView(); }
    return _accV.apply(this, arguments);
  };
  Views.accounting.after = _accV.after;

  Object.assign(Actions, {
    'acc-revenue-lock': () => lockPeriod(),
    'acc-revenue-now': () => { const f = F('acc-revenue'); const p = periodOf(f.type === 'CUSTOM' ? 'MONTH' : f.type, todayYmd()); f.from = p.from; f.to = p.to; render(); },
    'acc-revenue-open': (d) => { const s = store.list('revenuePeriods').find((x) => x.id === d.id); if (!s) return; const f = F('acc-revenue'); f.type = s.type || 'CUSTOM'; f.from = s.from; f.to = s.to; render(); },
    'acc-revenue-csv': () => {
      const f = F('acc-revenue'); const c = calcRevenue(f.from, f.to);
      Exporter.csv(`Doanh-thu-theo-ky-${f.from}-${f.to}.csv`, ['Chỉ tiêu', 'Giá trị'], [['Từ ngày', f.from], ['Đến ngày', f.to], ['Doanh thu đầu kỳ (lũy kế từ đầu năm)', c.opening], ['Phát sinh trong kỳ', c.inPeriod], ['Doanh thu cuối kỳ', c.closing], ['Kỳ liền trước', c.prev], ['Thay đổi so với kỳ trước', c.change], ['Cùng kỳ năm trước', c.lastYear]]);
    },
  });
  // Đổi loại kỳ → tự đặt lại khoảng ngày (listener change gốc đã gán giá trị type vào F)
  document.addEventListener('change', (e) => {
    const el = e.target; if (!el?.dataset || el.dataset.f !== 'acc-revenue.type') return;
    const f = F('acc-revenue'); if (f.type !== 'CUSTOM') { const p = periodOf(f.type, todayYmd()); f.from = p.from; f.to = p.to; }
    render();
  });
})();

/* ============================================================================
 * 5. GIÁ THÀNH SẢN XUẤT — NHÂN CÔNG + KHẤU HAO MÁY MÓC THIẾT BỊ
 * ----------------------------------------------------------------------------
 *  Giá thành LSX = NVL + Nhân công (đơn giá công đoạn × giờ) + Khấu hao máy + Chi phí chung
 *  - Khấu hao máy / giờ = khấu hao tháng của TSCĐ gắn với máy ÷ giờ chạy chuẩn / tháng
 *    (chỉ tính khi TSCĐ đang khấu hao; TSCĐ đã hết khấu hao hoặc chưa đưa vào sử dụng = 0).
 *  - Chi phí chung vẫn tính theo % trên NVL + nhân công như trước đây.
 *  - Cơ sở "Thực tế": nhân công và khấu hao máy được điều chỉnh theo giờ máy thực tế ghi
 *    ở các công đoạn của LSX so với giờ định mức.
 * ========================================================================== */
(function () {
  'use strict';
  const { n, r0, todayYmd, money } = window.__accV2;
  const D = window.AccDep;

  function machineRates(asOf = todayYmd()) {
    const map = {};
    (DB.fixedAssets || []).forEach((a) => {
      const m = String(a.machine || '').trim(); if (!m) return;
      const st = D.assetState(a, asOf); const active = st.code === 'DEPRECIATING';
      const hours = Math.max(1, n(a.workHoursPerMonth) || 200);
      const monthly = active ? D.assetMonthly(a) : 0;
      const g = map[m] || (map[m] = { machine: m, assets: [], monthly: 0, perHour: 0 });
      g.assets.push({ id: a.id, name: a.name, monthly, hours, state: st });
      g.monthly += monthly; g.perHour += monthly / hours;
    });
    return map;
  }
  /** Chi phí một lệnh sản xuất theo cơ sở STD (định mức) hoặc ACT (giờ thực tế). */
  function lsxCost(po, basis, rates) {
    const c = Q.costOf(po.productId); if (!c) return null;
    const qty = n(po.qty);
    const stdHours = c.operations.reduce((s, o) => s + n(o.hoursPer), 0) * qty;
    const actHours = (po.stages || []).reduce((s, st) => s + n(st.hours), 0);
    const ratio = basis === 'ACT' && actHours > 0 && stdHours > 0 ? actHours / stdHours : 1;
    const material = c.materialCost * qty;
    const labor = c.laborCost * qty * ratio;
    let dep = 0; const missing = [];
    c.operations.forEach((o) => {
      const m = String(o.machine || '').trim(); if (!m) return;
      const r = rates[m]; if (!r) { if (!missing.includes(m)) missing.push(m); return; }
      dep += n(o.hoursPer) * qty * ratio * r.perHour;
    });
    const overhead = Math.round(((material + labor) * c.overheadPct) / 100);
    const total = material + labor + dep + overhead;
    const sell = n(c.product.price) * qty;
    return { c, qty, material: r0(material), labor: r0(labor), dep: r0(dep), overhead, total: r0(total), unit: qty > 0 ? r0(total / qty) : 0, sell: r0(sell), profit: r0(sell - total), stdHours, actHours, ratio, missing, hasActual: actHours > 0 };
  }
  window.AccCosting = { machineRates, lsxCost };

  window.accCostingView = function () {
    const f = F('acc-costing', { status: 'lsx_hoan_thanh', basis: 'STD' });
    let list = (DB.productionOrders || []).slice();
    if (f.status) list = list.filter((p) => p.status === f.status);
    const rates = machineRates(); const act = f.basis === 'ACT';
    const calc = list.map((po) => ({ po, r: lsxCost(po, f.basis, rates) })).filter((x) => x.r);
    const tot = calc.reduce((s, x) => ({ m: s.m + x.r.material, l: s.l + x.r.labor, d: s.d + x.r.dep, o: s.o + x.r.overhead, t: s.t + x.r.total }), { m: 0, l: 0, d: 0, o: 0, t: 0 });
    const rows = calc.map(({ po, r }) => `<tr>
      <td><span class="code" data-act="open-po" data-id="${esc(po.id)}" style="cursor:pointer">${esc(po.id)}</span><div class="cell-sub">${esc(po.productName)}</div></td>
      <td class="num">${fmtN(po.qty)} ${esc(po.unit)}${act ? `<div class="cell-sub">${r.hasActual ? `${fmtDec(r.actHours, 1)}/${fmtDec(r.stdHours, 1)} giờ (TT/ĐM)` : 'chưa có giờ thực tế'}</div>` : ''}</td>
      <td class="right num">${money(r.material)}</td><td class="right num">${money(r.labor)}</td>
      <td class="right num">${money(r.dep)}${r.missing.length ? `<div class="cell-sub" style="color:var(--orange)" title="Chưa khai báo TSCĐ cho máy">thiếu TSCĐ: ${esc(r.missing.join(', '))}</div>` : ''}</td>
      <td class="right num">${money(r.overhead)}</td><td class="right num strong">${money(r.total)}<div class="cell-sub">${money(r.unit)} / ${esc(po.unit)}</div></td>
      <td class="right num">${money(r.sell)}</td><td class="right num strong" style="color:${r.profit >= 0 ? 'var(--green)' : 'var(--red)'}">${money(r.profit)}</td></tr>`).join('');
    const machRows = Object.values(rates).sort((a, b) => a.machine.localeCompare(b.machine, 'vi')).map((g) => `<tr><td>${esc(g.machine)}</td><td>${g.assets.map((a) => `${esc(a.name)} <span class="badge ${a.state.cls}">${esc(a.state.label)}</span>`).join('<br>')}</td><td class="right num">${money(g.monthly)}</td><td class="right num">${money(g.perHour)}</td></tr>`).join('');
    const opMachines = [...new Set((DB.operations || []).map((o) => String(o.machine || '').trim()).filter(Boolean))];
    const unlinked = opMachines.filter((m) => !rates[m]);
    return `${pageHead('Giá thành sản xuất', 'NVL + nhân công + khấu hao máy móc thiết bị + chi phí chung, tính từ định mức BOM/Routing và TSCĐ gắn với máy', '')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Nguyên vật liệu', money(tot.m), 'fa-boxes-stacked', 'blue')}${mkpi('Nhân công', money(tot.l), 'fa-people-group', 'green')}${mkpi('Khấu hao máy móc', money(tot.d), 'fa-gears', 'orange')}${mkpi('Chi phí chung', money(tot.o), 'fa-building', 'slate')}${mkpi('Tổng giá thành', money(tot.t), 'fa-calculator', 'teal')}</div>
    <div class="card">
      <div class="toolbar">${selectFilter('acc-costing', 'status', statusOptions('lsx_'), 'Tất cả trạng thái')}
        <select class="inp" data-f="acc-costing.basis"><option value="STD" ${!act ? 'selected' : ''}>Cơ sở: Định mức</option><option value="ACT" ${act ? 'selected' : ''}>Cơ sở: Giờ máy thực tế</option></select><span class="spacer"></span><span class="chip">${calc.length} lệnh sản xuất</span></div>
      ${tableShell([{ t: 'Lệnh SX' }, { t: 'SL' }, { t: 'NVL', cls: 'right' }, { t: 'Nhân công', cls: 'right' }, { t: 'Khấu hao máy', cls: 'right' }, { t: 'CP chung', cls: 'right' }, { t: 'Giá thành', cls: 'right' }, { t: 'Doanh thu', cls: 'right' }, { t: 'Lợi nhuận gộp', cls: 'right' }], rows, { emptyTitle: 'Không có lệnh sản xuất phù hợp' })}
    </div>
    <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Khấu hao máy móc theo giờ máy</h3><p>Khấu hao tháng của TSCĐ gắn với máy ÷ giờ chạy chuẩn tháng (khai báo ở Tài sản cố định)</p></div></div>
      ${tableShell([{ t: 'Máy / thiết bị' }, { t: 'Tài sản cố định' }, { t: 'Khấu hao tháng', cls: 'right' }, { t: 'Khấu hao / giờ máy', cls: 'right' }], machRows, { emptyTitle: 'Chưa gắn tài sản cố định nào với máy sản xuất' })}
      ${unlinked.length ? `<div class="cell-sub" style="margin-top:8px;color:var(--orange)"><i class="fa-solid fa-triangle-exclamation"></i> Máy trong công đoạn chưa gắn TSCĐ (khấu hao = 0): ${esc(unlinked.join(', '))}.</div>` : ''}</div>`;
  };
})();

/* ============================================================================
 * 6–7. HÓA ĐƠN (PDF) + THUẾ GTGT (TỜ KHAI 01/GTGT, BẢNG KÊ MUA VÀO / BÁN RA)
 * ----------------------------------------------------------------------------
 * Căn cứ tham khảo (tra cứu 10/2026):
 *  - Hóa đơn điện tử: Nghị định 254/2026/NĐ-CP (Điều 10 nội dung hóa đơn), Thông tư 91/2026/TT-BTC.
 *  - Tờ khai 01/GTGT (phương pháp khấu trừ) chỉ tiêu [21]–[43]; PL bảng kê 01-1/01-2.
 *  - Giảm thuế GTGT 10% → 8%: NQ 204/2025/QH15, NĐ 174/2025/NĐ-CP, đến hết 31/12/2026; kê khai kèm phụ lục giảm thuế.
 * LƯU Ý: bản PDF trong hệ thống là BẢN THỂ HIỆN. Hóa đơn có giá trị pháp lý phải lập, ký số và (nếu có mã)
 * nhận mã cơ quan thuế trên hệ thống hóa đơn điện tử; số hóa đơn/ký hiệu nhập vào đây để đối chiếu và in.
 * ========================================================================== */
(function () {
  'use strict';
  const { n, r0, todayYmd, parseYmd, dim, ymdOf, cmpYmd, monthStart, monthEnd, addDaysYmd, money, canAccounting, who, stamp, store } = window.__accV2;
  if (typeof ACC_TAB_GROUPS !== 'undefined') { ACC_TAB_GROUPS.tax = ['sales', 'purchase']; }

  /* ------------------------------------------------------------------ số tiền bằng chữ */
  const DIGIT = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  function read3(v, full) {
    const h = Math.floor(v / 100), t = Math.floor((v % 100) / 10), u = v % 10; const out = [];
    if (h > 0 || full) out.push(DIGIT[h] + ' trăm');
    if (t === 0) { if (u > 0) out.push((h > 0 || full ? 'linh ' : '') + DIGIT[u]); }
    else if (t === 1) out.push('mười' + (u === 0 ? '' : u === 5 ? ' lăm' : ' ' + DIGIT[u]));
    else out.push(DIGIT[t] + ' mươi' + (u === 0 ? '' : u === 1 ? ' mốt' : (u === 4 && t < 4) ? ' tư' : u === 5 ? ' lăm' : ' ' + DIGIT[u]));
    return out.join(' ');
  }
  function vndWords(value) {
    let v = Math.round(Math.abs(Number(value) || 0));
    if (v === 0) return 'Không đồng';
    const groups = []; while (v > 0) { groups.push(v % 1000); v = Math.floor(v / 1000); }
    const UNIT = ['', ' nghìn', ' triệu', ' tỷ'];
    const parts = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i]; if (g === 0) continue;
      const full = i < groups.length - 1;
      const unit = i < 4 ? UNIT[i] : (i === 4 ? ' nghìn tỷ' : i === 5 ? ' triệu tỷ' : ' tỷ tỷ');
      parts.push(read3(g, full) + unit);
    }
    const s = parts.join(' ').replace(/\s+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1) + ' đồng chẵn';
  }

  /* ------------------------------------------------------------------ dòng hàng & thuế suất */
  const rateOf = (v) => { if (v === '' || v == null) return 10; const r = Number(v); return Number.isFinite(r) ? r : 10; };
  function orderLines(o) {
    const disc = n(o.discountPct) / 100; const items = o.items || [];
    if (!items.length) { const net = n(o.subtotal ?? (n(o.total) - n(o.vat))); const rate = rateOf(o.vatRate); return [{ name: `Hàng hóa theo đơn ${o.id}`, unit: '', qty: 1, price: net, gross: net, net, rate, vat: n(o.vat) || net * rate / 100 }]; }
    return items.map((it) => {
      const gross = n(it.amount ?? n(it.qty) * n(it.price)); const net = gross * (1 - disc); const rate = rateOf(it.vatRate ?? o.vatRate);
      return { productId: it.productId, name: it.name || it.productId || '', unit: it.unit || '', qty: n(it.qty), price: n(it.price), gross, net, rate, vat: net * rate / 100 };
    });
  }
  const rateNote = (rate) => (rate === 8 ? 'Thuế suất 8% theo Nghị quyết 204/2025/QH15 (giảm 2%)' : '');
  const orders = () => (typeof AccFin !== 'undefined' ? AccFin.recognizedOrders() : []);
  const pos = () => (typeof AccFin !== 'undefined' ? AccFin.activePOs() : []);
  const findOrder = (id) => (DB.orders || []).find((o) => String(o.id) === String(id));
  const findPO = (id) => (DB.purchaseOrders || []).find((p) => String(p.id) === String(id));
  const custOf = (o) => (DB.customers || []).find((c) => String(c.id) === String(o?.customerId));
  const supOf = (po) => (DB.suppliers || []).find((s) => String(s.id) === String(po?.supplierId));
  const taxOfParty = (p) => String(p?.taxCode || p?.tax || p?.mst || p?.taxNo || '').trim();

  /* ------------------------------------------------------------------ sổ hóa đơn (bán ra OUT / mua vào IN) */
  const invList = () => store.list('invoices');
  const invOut = (orderId, includeCancelled = false) => invList().find((i) => i.kind === 'OUT' && String(i.refId) === String(orderId) && (includeCancelled || i.status !== 'CANCELLED'));
  const invIn = (poId) => invList().find((i) => i.kind === 'IN' && String(i.refId) === String(poId));
  const invStatusBadge = (i) => !i ? '<span class="badge slate">Chưa lập</span>' : i.status === 'CANCELLED' ? '<span class="badge red">Đã hủy</span>' : i.status === 'ISSUED' ? '<span class="badge green">Đã phát hành</span>' : '<span class="badge orange">Bản nháp</span>';

  function buildInvoiceModel(inv) {
    const o = findOrder(inv.refId); const lines = o ? orderLines(o) : (inv.lines || []);
    const byRate = {}; lines.forEach((l) => { const g = byRate[l.rate] || (byRate[l.rate] = { rate: l.rate, net: 0, vat: 0 }); g.net += l.net; g.vat += l.vat; });
    const groups = Object.values(byRate).sort((a, b) => a.rate - b.rate).map((g) => ({ rate: g.rate, net: r0(g.net), vat: r0(g.vat) }));
    const net = groups.reduce((s, g) => s + g.net, 0), vat = groups.reduce((s, g) => s + g.vat, 0);
    return { lines, groups, net, vat, total: net + vat };
  }
  const x = (v) => esc(String(v ?? ''));
  const dmy = (ymd) => { const p = parseYmd(ymd); return p ? { d: String(p.d).padStart(2, '0'), m: String(p.m).padStart(2, '0'), y: p.y } : { d: '..', m: '..', y: '....' }; };

  /** HTML hóa đơn A4 (bản thể hiện) — dùng cho in / lưu PDF. */
  function invoiceHtml(inv) {
    const m = buildInvoiceModel(inv); const co = DB.company || {}; const dt = dmy(inv.issueDate || todayYmd());
    const draft = inv.status !== 'ISSUED'; const cancelled = inv.status === 'CANCELLED';
    const lineRows = m.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${x(l.name)}${rateNote(l.rate) ? `<div class="sm">${x(rateNote(l.rate))}</div>` : ''}</td><td class="c">${x(l.unit)}</td><td class="r">${fmtN(l.qty)}</td><td class="r">${fmtN(r0(l.price))}</td><td class="r">${fmtN(r0(l.gross ?? l.net))}</td></tr>`).join('');
    const o = findOrder(inv.refId); const discount = o && n(o.discountPct) > 0 ? m.lines.reduce((s, l) => s + n(l.gross ?? l.net), 0) - m.net : 0;
    const taxRows = m.groups.map((g) => `<tr><td colspan="5" class="r">Thuế GTGT ${g.rate}% (tiền hàng ${fmtN(g.net)})</td><td class="r">${fmtN(g.vat)}</td></tr>`).join('');
    return `<div class="inv">
      <style>
        .inv{font-family:"Times New Roman",Times,serif;color:#111;width:190mm;margin:0 auto;position:relative;font-size:13px;line-height:1.45}
        .inv h1{font-size:22px;text-align:center;margin:6px 0 0;letter-spacing:.5px}.inv .sub{text-align:center;font-style:italic;margin-bottom:6px}
        .inv .top{display:flex;justify-content:space-between;gap:16px}.inv .meta{text-align:right;font-size:12.5px}
        .inv table{width:100%;border-collapse:collapse;margin-top:8px}.inv th,.inv td{border:1px solid #555;padding:4px 6px;vertical-align:top}
        .inv th{background:#f2f2f2;text-align:center}.inv .r{text-align:right}.inv .c{text-align:center}.inv .sm{font-size:11px;font-style:italic}
        .inv .box{border:1px solid #555;padding:6px 8px;margin-top:8px}.inv .box div{margin:1px 0}
        .inv .sig{display:flex;justify-content:space-between;margin-top:14px;text-align:center}.inv .sig div{width:48%}
        .inv .wm{position:absolute;top:35%;left:8%;font-size:46px;color:rgba(200,0,0,.13);transform:rotate(-24deg);font-weight:700;pointer-events:none;white-space:nowrap}
        .inv .legal{margin-top:14px;font-size:11px;color:#444;border-top:1px dashed #888;padding-top:6px}
      </style>
      ${draft ? `<div class="wm">${cancelled ? 'HÓA ĐƠN ĐÃ HỦY' : 'BẢN NHÁP — CHƯA PHÁT HÀNH'}</div>` : ''}
      <div class="top"><div><b>${x(co.name || '')}</b><div>Mã số thuế: ${x(co.tax || '')}</div><div>Địa chỉ: ${x(co.address || '')}</div><div>Điện thoại: ${x(co.phone || '')}${co.email ? ' · ' + x(co.email) : ''}</div></div>
        <div class="meta"><div>Ký hiệu mẫu số: <b>${x(inv.templateCode || '—')}</b></div><div>Ký hiệu hóa đơn: <b>${x(inv.series || '—')}</b></div><div>Số: <b>${x(inv.number || '........')}</b></div></div></div>
      <h1>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</h1><div class="sub">(Bản thể hiện của hóa đơn điện tử) · Ngày ${dt.d} tháng ${dt.m} năm ${dt.y}</div>
      <div class="box"><div>Họ tên người mua hàng: ${x(inv.buyerPerson || '')}</div><div>Tên đơn vị: <b>${x(inv.partyName)}</b></div><div>Mã số thuế: ${x(inv.partyTax || '')}</div><div>Địa chỉ: ${x(inv.partyAddress || '')}</div><div>Hình thức thanh toán: ${x(inv.paymentMethod || 'TM/CK')}${inv.partyBank ? ' · Số tài khoản: ' + x(inv.partyBank) : ''}</div></div>
      <table><thead><tr><th style="width:36px">STT</th><th>Tên hàng hóa, dịch vụ</th><th style="width:56px">ĐVT</th><th style="width:70px">Số lượng</th><th style="width:90px">Đơn giá</th><th style="width:110px">Thành tiền</th></tr></thead><tbody>${lineRows}
        ${discount > 0 ? `<tr><td colspan="5" class="r">Chiết khấu thương mại</td><td class="r">−${fmtN(r0(discount))}</td></tr>` : ''}
        <tr><td colspan="5" class="r"><b>Cộng tiền hàng (chưa thuế GTGT)</b></td><td class="r"><b>${fmtN(m.net)}</b></td></tr>${taxRows}
        <tr><td colspan="5" class="r"><b>Tổng cộng tiền thuế GTGT</b></td><td class="r"><b>${fmtN(m.vat)}</b></td></tr>
        <tr><td colspan="5" class="r"><b>Tổng cộng tiền thanh toán</b></td><td class="r"><b>${fmtN(m.total)}</b></td></tr></tbody></table>
      <div style="margin-top:6px">Số tiền viết bằng chữ: <b><i>${x(vndWords(m.total))}</i></b></div>
      <div class="sig"><div><b>Người mua hàng</b><div class="sm">(Ký, ghi rõ họ tên)</div></div><div><b>Người bán hàng</b><div class="sm">(Ký, đóng dấu, ghi rõ họ tên)</div>${inv.status === 'ISSUED' ? `<div style="margin-top:8px;text-align:left;border:1px solid #2a7;padding:4px 6px;font-size:11.5px"><b style="color:#186">Đã phát hành trên hệ thống hóa đơn điện tử</b><div>Ký bởi: ${x(co.name || '')}</div><div>Thời điểm ký số: ${x(inv.signedAt ? String(inv.signedAt).replace('T', ' ').slice(0, 16) : '—')}</div>${inv.cqtCode ? `<div>Mã của cơ quan thuế: ${x(inv.cqtCode)}</div>` : ''}</div>` : ''}</div></div>
      <div class="legal">${draft ? 'Bản nháp để kiểm tra nội dung, chưa phải hóa đơn điện tử đã phát hành. ' : ''}Đây là bản thể hiện của hóa đơn điện tử; hóa đơn có giá trị pháp lý là dữ liệu đã được ký số${inv.cqtCode ? ' và có mã của cơ quan thuế' : ''} trên hệ thống hóa đơn điện tử. Tra cứu hóa đơn tại cổng của nhà cung cấp dịch vụ hóa đơn điện tử.</div></div>`;
  }
  window.AccInvoice = { vndWords, orderLines, invoiceHtml, buildInvoiceModel, invOut, invIn };

  function printHtml(title, bodyHtml) {
    const w = window.open('', '_blank');
    if (!w) { Toast.err('Trình duyệt chặn cửa sổ in', 'Cho phép pop-up cho trang này rồi thử lại.'); return false; }
    w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4;margin:10mm}body{margin:0;padding:6mm;background:#fff}@media print{body{padding:0}}</style></head><body>${bodyHtml}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (_) {} }, 350); return true;
  }
  let pdfLibPromise = null;
  function loadPdfLib() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (!pdfLibPromise) pdfLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js'; s.onload = () => resolve(window.html2pdf); s.onerror = () => { pdfLibPromise = null; reject(new Error('Không tải được thư viện PDF')); }; document.head.appendChild(s);
    });
    return pdfLibPromise;
  }
  async function downloadPdf(filename, bodyHtml) {
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;width:210mm;padding:8mm'; host.innerHTML = bodyHtml; document.body.appendChild(host);
    try { const lib = await loadPdfLib(); await lib().set({ margin: 0, filename, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(host).save(); return true; }
    finally { host.remove(); }
  }

  /* ------------------------------------------------------------------ màn Hóa đơn */
  function invoicesView() {
    store.ensure('invoices').then(() => { if (State.module === 'accounting' && State.tab === 'invoices' && !window.__invLoaded) { window.__invLoaded = true; render(); } });
    const f = F('acc-inv', { kind: 'OUT', q: '', status: '', from: monthStart(todayYmd()), to: todayYmd() });
    const q = String(f.q || '').toLowerCase().trim();
    const inRange = (d) => { const s = String(d || '').slice(0, 10); return (!f.from || cmpYmd(s, f.from) >= 0) && (!f.to || cmpYmd(s, f.to) <= 0); };
    const tabs = `<div class="tabs" style="margin-bottom:14px"><button class="tab ${f.kind === 'OUT' ? 'active' : ''}" data-act="acc-inv-kind" data-kind="OUT"><i class="fa-solid fa-file-invoice"></i>Hóa đơn bán ra</button><button class="tab ${f.kind === 'IN' ? 'active' : ''}" data-act="acc-inv-kind" data-kind="IN"><i class="fa-solid fa-file-import"></i>Hóa đơn mua vào</button></div>`;
    let body = '', kpis = '';
    if (f.kind === 'OUT') {
      const list = orders().filter((o) => inRange(o.date)).filter((o) => { const i = invOut(o.id); const st = !i ? 'NONE' : i.status; return (!f.status || st === f.status) && (!q || [o.id, Q.customerName(o.customerId), i?.number].some((v) => String(v || '').toLowerCase().includes(q))); }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const cnt = (s) => orders().filter((o) => inRange(o.date)).filter((o) => { const i = invOut(o.id); return (i ? i.status : 'NONE') === s; }).length;
      kpis = `<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Đơn chưa lập hóa đơn', cnt('NONE'), 'fa-file-circle-exclamation', 'orange')}${mkpi('Bản nháp', cnt('DRAFT'), 'fa-file-pen', 'blue')}${mkpi('Đã phát hành', cnt('ISSUED'), 'fa-file-circle-check', 'green')}</div>`;
      const rows = list.map((o) => { const i = invOut(o.id); const m = i ? buildInvoiceModel(i) : { total: n(o.total), vat: n(o.vat) };
        return `<tr><td><span class="code">${esc(o.id)}</span><div class="cell-sub">${fmtDate(o.date)}</div></td><td>${cell2(esc(Q.customerName(o.customerId)), esc(taxOfParty(custOf(o)) || 'Chưa có MST'))}</td><td class="right num">${money(m.vat)}</td><td class="right num strong">${money(m.total)}</td><td>${invStatusBadge(i)}${i?.number ? `<div class="cell-sub">${esc(i.series || '')} · số ${esc(i.number)}</div>` : ''}</td>
        <td class="right">${i && i.status !== 'CANCELLED' ? `<button class="btn btn-sm" data-act="acc-inv-pdf" data-id="${esc(i.id)}" title="Tải PDF"><i class="fa-solid fa-file-pdf"></i>PDF</button> <button class="btn btn-sm" data-act="acc-inv-print" data-id="${esc(i.id)}"><i class="fa-solid fa-print"></i>In</button> <button class="btn btn-sm" data-act="acc-inv-edit" data-id="${esc(i.id)}"><i class="fa-solid fa-pen"></i></button>` : canAccounting() ? `<button class="btn btn-sm btn-primary" data-act="acc-inv-new" data-order="${esc(o.id)}"><i class="fa-solid fa-plus"></i>Lập hóa đơn</button>` : ''}</td></tr>`; });
      body = tableShell([{ t: 'Đơn hàng' }, { t: 'Khách hàng' }, { t: 'Thuế GTGT', cls: 'right' }, { t: 'Tổng thanh toán', cls: 'right' }, { t: 'Hóa đơn' }, { t: '', cls: 'right', w: '230px' }], rows, { emptyTitle: 'Không có đơn hàng đã giao trong kỳ' });
    } else {
      const list = pos().filter((p) => { const i = invIn(p.id); return inRange(i?.issueDate || p.date); }).filter((p) => { const i = invIn(p.id); return (!f.status || (f.status === 'NONE' ? !i : !!i)) && (!q || [p.id, Q.supplierName(p.supplierId), i?.number].some((v) => String(v || '').toLowerCase().includes(q))); }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      kpis = `<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('PO chưa nhập hóa đơn', list.filter((p) => !invIn(p.id)).length, 'fa-file-circle-exclamation', 'orange')}${mkpi('Đã nhập hóa đơn', list.filter((p) => invIn(p.id)).length, 'fa-file-circle-check', 'green')}</div>`;
      const rows = list.map((p) => { const i = invIn(p.id); return `<tr><td><span class="code">${esc(p.id)}</span><div class="cell-sub">${fmtDate(p.date)}</div></td><td>${cell2(esc(Q.supplierName(p.supplierId)), esc(i?.partyTax || taxOfParty(supOf(p)) || 'Chưa có MST'))}</td><td class="right num">${money(p.vat)}</td><td class="right num strong">${money(p.total)}</td><td>${i ? `<span class="badge green">Đã nhập</span><div class="cell-sub">${esc(i.series || '')} · số ${esc(i.number || '')} · ${fmtDate(i.issueDate)}</div>${i.deductible === false ? '<div><span class="badge red">Không khấu trừ</span></div>' : ''}` : '<span class="badge slate">Chưa nhập</span>'}</td><td class="right">${canAccounting() ? `<button class="btn btn-sm ${i ? '' : 'btn-primary'}" data-act="acc-inv-in" data-id="${esc(p.id)}"><i class="fa-solid fa-pen"></i>${i ? 'Sửa' : 'Nhập hóa đơn'}</button>` : ''}</td></tr>`; });
      body = tableShell([{ t: 'Đơn mua' }, { t: 'Nhà cung cấp' }, { t: 'Thuế GTGT', cls: 'right' }, { t: 'Tổng thanh toán', cls: 'right' }, { t: 'Hóa đơn đầu vào' }, { t: '', cls: 'right', w: '150px' }], rows, { emptyTitle: 'Không có đơn mua trong kỳ' });
    }
    const statusOpts = f.kind === 'OUT' ? [['NONE', 'Chưa lập'], ['DRAFT', 'Bản nháp'], ['ISSUED', 'Đã phát hành']] : [['NONE', 'Chưa nhập'], ['HAS', 'Đã nhập']];
    return `${pageHead('Hóa đơn', 'Lập bản thể hiện hóa đơn bán ra (PDF) và ghi nhận hóa đơn mua vào để kê khai thuế GTGT', '')}${tabs}${kpis}
      <div class="card"><div class="toolbar">${searchBox('acc-inv', 'Tìm đơn, khách hàng/NCC, số hóa đơn…')}${selectFilter('acc-inv', 'status', statusOpts, 'Tất cả')}<label class="cell-sub">Từ</label><input class="inp" type="date" data-f="acc-inv.from" value="${esc(f.from || '')}"><label class="cell-sub">Đến</label><input class="inp" type="date" data-f="acc-inv.to" value="${esc(f.to || '')}"></div>${body}</div>
      <div class="cell-sub" style="margin-top:8px">Bản PDF là bản thể hiện. Hóa đơn hợp lệ phải được lập và ký số trên hệ thống hóa đơn điện tử (Nghị định 254/2026/NĐ-CP, Thông tư 91/2026/TT-BTC); hãy nhập số/ký hiệu hóa đơn và đổi sang "Đã phát hành" sau khi phát hành.</div>`;
  }
  window.accInvoicesView = invoicesView;

  function openInvoiceForm(orderId, invId) {
    const old = invId ? invList().find((i) => i.id === invId) : null; const o = findOrder(old ? old.refId : orderId); if (!o) return;
    if (!canAccounting()) { Toast.err('Không có quyền', 'Chỉ kế toán được lập hóa đơn.'); return; }
    const c = custOf(o); const issued = old?.status === 'ISSUED';
    const y = String((parseYmd(todayYmd()) || { y: 2026 }).y).slice(2);
    Modal.open({
      title: old ? `Hóa đơn · ${esc(old.id)}` : `Lập hóa đơn · đơn ${esc(o.id)}`, sub: `${esc(Q.customerName(o.customerId))} · ${money(o.total)}`, size: 'lg',
      body: `<div class="form-grid cols-2">
        <div class="field"><label>Tên đơn vị mua <span class="req">*</span></label><input class="inp" id="invParty" value="${esc(old?.partyName || c?.name || Q.customerName(o.customerId) || '')}"></div>
        <div class="field"><label>Mã số thuế người mua</label><input class="inp" id="invTax" value="${esc(old?.partyTax || taxOfParty(c))}" placeholder="10 hoặc 13 chữ số"></div>
        <div class="field" style="grid-column:1/-1"><label>Địa chỉ</label><input class="inp" id="invAddr" value="${esc(old?.partyAddress || c?.address || '')}"></div>
        <div class="field"><label>Họ tên người mua hàng</label><input class="inp" id="invBuyer" value="${esc(old?.buyerPerson || c?.contact || c?.contactName || '')}"></div>
        <div class="field"><label>Hình thức thanh toán</label><select class="inp" id="invPay">${['TM/CK', 'Tiền mặt', 'Chuyển khoản'].map((v) => `<option ${((old?.paymentMethod) || 'TM/CK') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Ngày lập hóa đơn <span class="req">*</span></label><input class="inp" id="invDate" type="date" value="${esc(old?.issueDate || todayYmd())}"></div>
        <div class="field"><label>Trạng thái</label><select class="inp" id="invStatus"><option value="DRAFT" ${!issued ? 'selected' : ''}>Bản nháp (chưa phát hành)</option><option value="ISSUED" ${issued ? 'selected' : ''}>Đã phát hành trên hệ thống HĐĐT</option></select></div>
        <div class="field"><label>Ký hiệu mẫu số</label><input class="inp" id="invTpl" value="${esc(old?.templateCode || '1')}" maxlength="1"><div class="cell-sub">1 = Hóa đơn GTGT</div></div>
        <div class="field"><label>Ký hiệu hóa đơn</label><input class="inp" id="invSeries" value="${esc(old?.series || 'C' + y + 'TAA')}" placeholder="Ví dụ C26TAA"></div>
        <div class="field"><label>Số hóa đơn (do hệ thống HĐĐT cấp)</label><input class="inp" id="invNo" value="${esc(old?.number || '')}" placeholder="8 chữ số"></div>
        <div class="field"><label>Mã của cơ quan thuế (nếu có)</label><input class="inp" id="invCqt" value="${esc(old?.cqtCode || '')}"></div>
      </div>
      <label style="display:flex;gap:8px;margin-top:10px"><input type="checkbox" id="invSaveTax" checked><span>Lưu mã số thuế vào hồ sơ khách hàng</span></label>
      <div class="cell-sub" style="margin-top:6px">Nội dung hàng hóa, thuế suất và số tiền lấy tự động từ đơn hàng ${esc(o.id)}.</div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button>${old ? `<button class="btn" data-act="acc-inv-cancel" data-id="${esc(old.id)}"><i class="fa-solid fa-ban"></i>Hủy hóa đơn</button>` : ''}<button class="btn" data-act="acc-inv-save" data-order="${esc(o.id)}" data-id="${esc(old?.id || '')}" data-after="pdf"><i class="fa-solid fa-file-pdf"></i>Lưu &amp; tải PDF</button><button class="btn btn-primary" data-act="acc-inv-save" data-order="${esc(o.id)}" data-id="${esc(old?.id || '')}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`,
    });
  }
  async function saveInvoice(d) {
    if (!canAccounting()) { Toast.err('Không có quyền', 'Chỉ kế toán được lập hóa đơn.'); return null; }
    const o = findOrder(d.order); if (!o) return null;
    const partyName = ($('#invParty')?.value || '').trim(); const issueDate = $('#invDate')?.value || '';
    const status = $('#invStatus')?.value || 'DRAFT'; const number = ($('#invNo')?.value || '').trim(); const series = ($('#invSeries')?.value || '').trim();
    const tax = ($('#invTax')?.value || '').replace(/\s/g, '');
    if (!partyName) { Toast.err('Thiếu tên đơn vị mua', 'Nhập tên đơn vị/người mua.'); return null; }
    if (!issueDate) { Toast.err('Thiếu ngày lập', 'Chọn ngày lập hóa đơn.'); return null; }
    if (tax && !/^\d{10}(-?\d{3})?$/.test(tax)) { Toast.err('Mã số thuế không hợp lệ', 'MST gồm 10 chữ số hoặc 13 chữ số (10 số - 3 số).'); return null; }
    if (status === 'ISSUED') {
      if (!number || !series) { Toast.err('Thiếu số / ký hiệu hóa đơn', 'Hóa đơn "Đã phát hành" cần có ký hiệu và số hóa đơn từ hệ thống HĐĐT.'); return null; }
      const dup = invList().find((i) => i.kind === 'OUT' && i.id !== d.id && i.status === 'ISSUED' && String(i.number) === number && String(i.series) === series); if (dup) { Toast.err('Trùng số hóa đơn', `${series} số ${number} đã dùng cho đơn ${dup.refId}.`); return null; }
    }
    const old = d.id ? invList().find((i) => i.id === d.id) : null;
    const base = `HDB-${o.id}`; let id = old?.id; if (!id) { id = base; let k = 2; while (invList().some((i) => i.id === id)) id = `${base}-${k++}`; }
    const model = buildInvoiceModel({ refId: o.id });
    const row = { ...(old || {}), id, kind: 'OUT', refType: 'ORDER', refId: o.id, partyName, partyTax: tax, partyAddress: ($('#invAddr')?.value || '').trim(), buyerPerson: ($('#invBuyer')?.value || '').trim(), paymentMethod: $('#invPay')?.value || 'TM/CK', issueDate, status, templateCode: ($('#invTpl')?.value || '1').trim(), series, number, cqtCode: ($('#invCqt')?.value || '').trim(), net: model.net, vat: model.vat, total: model.total, customerId: o.customerId, signedAt: status === 'ISSUED' ? (old?.signedAt || new Date().toISOString()) : '', updatedAt: new Date().toISOString(), updatedBy: who(), createdAt: old?.createdAt || new Date().toISOString(), createdBy: old?.createdBy || who() };
    try { await store.save('invoices', row); } catch (err) { Toast.err('Không lưu được hóa đơn', err?.message || 'Vui lòng thử lại.'); return null; }
    if ($('#invSaveTax')?.checked && tax) {
      const c = custOf(o); if (c && taxOfParty(c) !== tax) { c.taxCode = tax; try { if (typeof CRMAPI !== 'undefined') await CRMAPI.syncCollections(['customers']); } catch (_) { Toast.warn('Chưa lưu MST vào khách hàng', 'Hóa đơn đã lưu; MST sẽ không đồng bộ được lên hồ sơ khách.'); } }
    }
    return row;
  }

  /* ------------------------------------------------------------------ nhập hóa đơn mua vào */
  function openInvoiceIn(poId) {
    const p = findPO(poId); if (!p) return; if (!canAccounting()) { Toast.err('Không có quyền', 'Chỉ kế toán được nhập hóa đơn mua vào.'); return; }
    const old = invIn(poId); const s = supOf(p);
    const cash = hasCashRisk(p);
    Modal.open({ title: `Hóa đơn mua vào · ${esc(p.id)}`, sub: `${esc(Q.supplierName(p.supplierId))} · ${money(p.total)} (thuế ${money(p.vat)})`, size: 'md',
      body: `<div class="form-grid cols-2">
        <div class="field"><label>Mã số thuế người bán</label><input class="inp" id="invInTax" value="${esc(old?.partyTax || taxOfParty(s))}"></div>
        <div class="field"><label>Ngày hóa đơn <span class="req">*</span></label><input class="inp" id="invInDate" type="date" value="${esc(old?.issueDate || p.date || todayYmd())}"></div>
        <div class="field"><label>Ký hiệu hóa đơn <span class="req">*</span></label><input class="inp" id="invInSeries" value="${esc(old?.series || '')}" placeholder="Ví dụ 1C26TAA"></div>
        <div class="field"><label>Số hóa đơn <span class="req">*</span></label><input class="inp" id="invInNo" value="${esc(old?.number || '')}"></div></div>
      ${cash ? '<div class="alert warning" style="margin-top:10px"><i class="fa-solid fa-triangle-exclamation"></i><span>Đơn từ 5 triệu đồng có thanh toán tiền mặt: thuế GTGT đầu vào có thể không được khấu trừ.</span></div>' : ''}
      <label style="display:flex;gap:8px;margin-top:10px"><input type="checkbox" id="invInDed" ${old?.deductible === false || (cash && old?.deductible !== true) ? '' : 'checked'}><span>Thuế GTGT của hóa đơn này đủ điều kiện khấu trừ</span></label>
      <div class="field" style="margin-top:8px"><label>Ghi chú</label><input class="inp" id="invInNote" value="${esc(old?.note || '')}"></div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="acc-inv-in-save" data-id="${esc(poId)}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>` });
  }
  async function saveInvoiceIn(poId) {
    const p = findPO(poId); if (!p || !canAccounting()) return;
    const series = ($('#invInSeries')?.value || '').trim(), number = ($('#invInNo')?.value || '').trim(), issueDate = $('#invInDate')?.value || '';
    if (!series || !number || !issueDate) { Toast.err('Thiếu thông tin hóa đơn', 'Nhập ký hiệu, số và ngày hóa đơn.'); return; }
    const tax = ($('#invInTax')?.value || '').replace(/\s/g, ''); if (tax && !/^\d{10}(-?\d{3})?$/.test(tax)) { Toast.err('Mã số thuế không hợp lệ', 'MST gồm 10 chữ số hoặc 13 chữ số.'); return; }
    const dup = invList().find((i) => i.kind === 'IN' && i.refId !== poId && String(i.series) === series && String(i.number) === number && String(i.partyTax || '') === tax); if (dup) { Toast.err('Trùng hóa đơn', `Hóa đơn này đã nhập cho ${dup.refId}.`); return; }
    const old = invIn(poId); const row = { ...(old || {}), id: old?.id || `HDM-${poId}`, kind: 'IN', refType: 'PO', refId: poId, partyName: Q.supplierName(p.supplierId), partyTax: tax, supplierId: p.supplierId, series, number, issueDate, deductible: !!$('#invInDed')?.checked, note: ($('#invInNote')?.value || '').trim(), net: r0(p.subtotal ?? (n(p.total) - n(p.vat))), vat: r0(p.vat), total: r0(p.total), status: 'ISSUED', updatedAt: new Date().toISOString(), updatedBy: who(), createdAt: old?.createdAt || new Date().toISOString() };
    try { await store.save('invoices', row); } catch (err) { Toast.err('Không lưu được', err?.message || 'Vui lòng thử lại.'); return; }
    const s = supOf(p); if (s && tax && taxOfParty(s) !== tax) { s.taxCode = tax; }
    Modal.close(); render(); Toast.ok('Đã ghi nhận hóa đơn mua vào', `${series} · số ${number}`);
  }
  const CASH_LIMIT = 5000000;
  function hasCashRisk(po) {
    if (n(po.total) < CASH_LIMIT) return false;
    return (DB.supplierPayments || []).some((p) => String(p.poId) === String(po.id) && /ti[eề]n m[aặ]t/i.test(String(p.method || '')) );
  }

  /* ------------------------------------------------------------------ TỜ KHAI 01/GTGT */
  function periodRange(f) {
    if (f.type === 'QUARTER') { const m1 = (f.quarter - 1) * 3 + 1; return { from: ymdOf(f.year, m1, 1), to: ymdOf(f.year, m1 + 2, dim(f.year, m1 + 2)), id: `VAT-Q-${f.year}-${f.quarter}`, label: `Quý ${f.quarter}/${f.year}` }; }
    return { from: ymdOf(f.year, f.month, 1), to: ymdOf(f.year, f.month, dim(f.year, f.month)), id: `VAT-M-${f.year}-${String(f.month).padStart(2, '0')}`, label: `Tháng ${String(f.month).padStart(2, '0')}/${f.year}` };
  }
  function prevPeriodId(f) {
    if (f.type === 'QUARTER') { const q = f.quarter === 1 ? 4 : f.quarter - 1, y = f.quarter === 1 ? f.year - 1 : f.year; return `VAT-Q-${y}-${q}`; }
    const m = f.month === 1 ? 12 : f.month - 1, y = f.month === 1 ? f.year - 1 : f.year; return `VAT-M-${y}-${String(m).padStart(2, '0')}`;
  }
  const savedReturn = (id) => store.list('vatReturns').find((r) => r.id === id);

  /** Tính toàn bộ chỉ tiêu tờ khai cho một kỳ. */
  function vatCalc(f, inputs = {}) {
    const per = periodRange(f); const inP = (d) => { const s = String(d || '').slice(0, 10); return s && cmpYmd(s, per.from) >= 0 && cmpYmd(s, per.to) <= 0; };
    const onlyInv = !!f.onlyInvoiced;
    // ---- bán ra
    const outRows = []; const warnOut = [];
    orders().forEach((o) => {
      const inv = invOut(o.id); const date = inv?.issueDate || o.date; if (!inP(date)) return;
      if (onlyInv && !(inv && inv.status === 'ISSUED')) return;
      if (!inv || inv.status !== 'ISSUED') warnOut.push(o.id);
      const c = custOf(o);
      orderLines(o).forEach((l) => outRows.push({ orderId: o.id, date: String(date).slice(0, 10), invoice: inv, party: inv?.partyName || Q.customerName(o.customerId), tax: inv?.partyTax || taxOfParty(c), net: l.net, rate: l.rate, vat: l.vat, exempt: !!l.exempt }));
    });
    const sumOut = (fn) => outRows.filter(fn).reduce((a, r) => ({ net: a.net + r.net, vat: a.vat + r.vat }), { net: 0, vat: 0 });
    const exempt = sumOut((r) => r.exempt), r0o = sumOut((r) => !r.exempt && r.rate === 0), r5 = sumOut((r) => !r.exempt && r.rate === 5), r8 = sumOut((r) => !r.exempt && r.rate === 8), r10 = sumOut((r) => !r.exempt && r.rate === 10);
    const r10x = { net: r10.net + r8.net, vat: r10.vat + r8.vat }; // 8% khai trong dòng 10% của tờ khai chính, kèm phụ lục giảm thuế
    // ---- mua vào
    const inRows = []; const warnIn = []; const nonDed = [];
    pos().forEach((po) => {
      const inv = invIn(po.id); const date = inv?.issueDate || po.date; if (!inP(date)) return;
      if (onlyInv && !inv) return;
      if (!inv) warnIn.push(po.id);
      const net = n(po.subtotal ?? (n(po.total) - n(po.vat))), vat = n(po.vat);
      let deductible = true, reason = '';
      if (inv && inv.deductible === false) { deductible = false; reason = 'Đánh dấu không đủ điều kiện'; }
      else if ((!inv || inv.deductible !== true) && hasCashRisk(po)) { deductible = false; reason = 'Từ 5 triệu đồng thanh toán tiền mặt'; }
      if (!deductible) nonDed.push({ id: po.id, vat, reason });
      inRows.push({ poId: po.id, date: String(date).slice(0, 10), invoice: inv, party: inv?.partyName || Q.supplierName(po.supplierId), tax: inv?.partyTax || taxOfParty(supOf(po)), net, vat, rate: n(po.vatRate), deductible, reason });
    });
    const c23 = inRows.reduce((s, r) => s + r.net, 0), c24 = inRows.reduce((s, r) => s + r.vat, 0), c25 = inRows.filter((r) => r.deductible).reduce((s, r) => s + r.vat, 0);
    const prev = savedReturn(prevPeriodId(f)); const carryAuto = n(prev?.values?.[43]);
    const c22 = inputs.c22 != null && inputs.c22 !== '' ? n(inputs.c22) : carryAuto;
    const c37 = n(inputs.c37), c38 = n(inputs.c38), c39a = n(inputs.c39a), c40b = n(inputs.c40b), c42 = n(inputs.c42);
    const v = {};
    v[22] = r0(c22); v[23] = r0(c23); v[24] = r0(c24); v[25] = r0(c25);
    v[26] = r0(exempt.net); v[29] = r0(r0o.net); v[30] = r0(r5.net); v[31] = r0(r5.vat); v[32] = r0(r10x.net); v[33] = r0(r10x.vat);
    v[27] = v[29] + v[30] + v[32]; v[28] = v[31] + v[33]; v[34] = v[26] + v[27]; v[35] = v[28]; v[36] = v[35] - v[25];
    v[37] = r0(c37); v[38] = r0(c38); v[39] = r0(c39a);
    const x2 = v[36] - v[22] + v[37] - v[38] - v[39];
    v['40a'] = Math.max(0, x2); v['40b'] = r0(c40b); v[40] = Math.max(0, v['40a'] - v['40b']);
    v[41] = Math.max(0, -x2); v[42] = Math.min(r0(c42), v[41]); v[43] = v[41] - v[42];
    v[21] = outRows.length === 0 && inRows.length === 0 ? 1 : 0;
    const reduction = { net: r0(r8.net), reduced: r0(r8.net * 0.02) };
    return { per, v, outRows, inRows, warnOut: [...new Set(warnOut)], warnIn: [...new Set(warnIn)], nonDed, carryAuto, hasPrev: !!prev, reduction };
  }
  window.AccVat = { vatCalc, periodRange, vndWords };

  const FORM_ROWS = [
    ['', 'A. Không phát sinh hoạt động mua, bán trong kỳ', 21, null, 'flag'],
    ['B', 'B. Thuế GTGT còn được khấu trừ kỳ trước chuyển sang', 22, null, 'tax-input'],
    ['C', 'C. Kê khai thuế GTGT phải nộp ngân sách nhà nước', null, null, 'head'],
    ['I', 'I. Hàng hóa, dịch vụ (HHDV) mua vào trong kỳ', null, null, 'head2'],
    ['1', '1. Giá trị và thuế GTGT của HHDV mua vào', 23, 24, 'pair'],
    ['2', '2. Tổng số thuế GTGT được khấu trừ kỳ này', null, 25, 'tax'],
    ['II', 'II. Hàng hóa, dịch vụ bán ra trong kỳ', null, null, 'head2'],
    ['1', '1. HHDV bán ra không chịu thuế GTGT', 26, null, 'base'],
    ['2', '2. HHDV bán ra chịu thuế GTGT ([27]=[29]+[30]+[32]; [28]=[31]+[33])', 27, 28, 'pair'],
    ['a', 'a. Hàng hóa, dịch vụ bán ra chịu thuế suất 0%', 29, null, 'base'],
    ['b', 'b. Hàng hóa, dịch vụ bán ra chịu thuế suất 5%', 30, 31, 'pair'],
    ['c', 'c. Hàng hóa, dịch vụ bán ra chịu thuế suất 10% (gồm hàng được giảm còn 8%)', 32, 33, 'pair'],
    ['3', '3. Tổng doanh thu và thuế GTGT của HHDV bán ra ([34]=[26]+[27]; [35]=[28])', 34, 35, 'pair'],
    ['III', 'III. Thuế GTGT phát sinh trong kỳ ([36]=[35]−[25])', null, 36, 'tax'],
    ['IV', 'IV. Điều chỉnh tăng, giảm thuế GTGT còn được khấu trừ của các kỳ trước', null, null, 'head2'],
    ['1', '1. Điều chỉnh giảm', null, 37, 'tax-input'],
    ['2', '2. Điều chỉnh tăng', null, 38, 'tax-input'],
    ['V', 'V. Thuế GTGT đã nộp ở địa phương khác của hoạt động kinh doanh xây dựng, lắp đặt, bán hàng, bất động sản ngoại tỉnh', null, 39, 'tax-input'],
    ['VI', 'VI. Xác định nghĩa vụ thuế GTGT phải nộp trong kỳ', null, null, 'head2'],
    ['1', '1. Thuế GTGT phải nộp của hoạt động sản xuất kinh doanh trong kỳ ([40a]=[36]−[22]+[37]−[38]−[39] ≥ 0)', null, '40a', 'tax'],
    ['2', '2. Thuế GTGT mua vào của dự án đầu tư được bù trừ với thuế GTGT còn phải nộp của hoạt động SXKD cùng kỳ tính thuế', null, '40b', 'tax-input'],
    ['3', '3. Thuế GTGT còn phải nộp trong kỳ ([40]=[40a]−[40b])', null, 40, 'tax-strong'],
    ['4', '4. Thuế GTGT chưa khấu trừ hết kỳ này ([41] = −([36]−[22]+[37]−[38]−[39]) nếu âm)', null, 41, 'tax'],
    ['4.1', '4.1. Tổng số thuế GTGT đề nghị hoàn', null, 42, 'tax-input'],
    ['4.2', '4.2. Thuế GTGT còn được khấu trừ chuyển kỳ sau ([43]=[41]−[42])', null, 43, 'tax-strong'],
  ];
  const INPUT_KEY = { 22: 'c22', 37: 'c37', 38: 'c38', 39: 'c39a', '40b': 'c40b', 42: 'c42' };

  function taxView() {
    store.ensure('vatReturns').then(() => store.ensure('invoices')).then(() => { if (State.module === 'accounting' && State.tab === 'tax' && !window.__taxLoaded) { window.__taxLoaded = true; render(); } });
    const dNow = parseYmd(todayYmd());
    const f = F('acc-tax', { sub: 'vat', type: 'MONTH', year: dNow.y, month: dNow.m, quarter: Math.ceil(dNow.m / 3), onlyInvoiced: false, draft: null });
    const subs = [['vat', 'Tờ khai 01/GTGT'], ['out', 'Bảng kê bán ra'], ['in', 'Bảng kê mua vào'], ['detail', 'Chi tiết theo hàng hóa']];
    const tabs = `<div class="tabs" style="margin-bottom:14px">${subs.map(([k, l]) => `<button class="tab ${f.sub === k ? 'active' : ''}" data-act="acc-tax-sub" data-sub="${k}">${l}</button>`).join('')}</div>`;
    if (f.sub === 'detail') return tabs + (typeof _accTaxViewOrig === 'function' ? _accTaxViewOrig() : '');
    const per = periodRange(f); const saved = savedReturn(per.id); const locked = saved?.status === 'FILED';
    if (!f.draft || f.draft.id !== per.id) f.draft = { id: per.id, inputs: { ...(saved?.inputs || {}) } };
    const inputs = f.draft.inputs; const calc = vatCalc(f, inputs); const v = calc.v;
    const yearOpts = [dNow.y - 2, dNow.y - 1, dNow.y, dNow.y + 1].map((y) => `<option ${f.year === y ? 'selected' : ''}>${y}</option>`).join('');
    const head = `<div class="toolbar"><select class="inp" data-f="acc-tax.type"><option value="MONTH" ${f.type === 'MONTH' ? 'selected' : ''}>Kê khai theo tháng</option><option value="QUARTER" ${f.type === 'QUARTER' ? 'selected' : ''}>Kê khai theo quý</option></select>
      ${f.type === 'QUARTER' ? `<select class="inp" data-f="acc-tax.quarter">${[1, 2, 3, 4].map((q) => `<option value="${q}" ${f.quarter === q ? 'selected' : ''}>Quý ${q}</option>`).join('')}</select>` : `<select class="inp" data-f="acc-tax.month">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${f.month === i + 1 ? 'selected' : ''}>Tháng ${i + 1}</option>`).join('')}</select>`}
      <select class="inp" data-f="acc-tax.year">${yearOpts}</select>
      <label class="cell-sub"><input type="checkbox" data-act="acc-tax-toggle" ${f.onlyInvoiced ? 'checked' : ''}> Chỉ tính hóa đơn đã phát hành/đã nhập</label><span class="spacer"></span>
      ${saved ? `<span class="badge ${locked ? 'green' : 'blue'}">${locked ? 'Đã chốt ' : 'Bản nháp đã lưu '}${esc(stamp(saved.filedAt || saved.updatedAt))}</span>` : '<span class="badge slate">Chưa lưu</span>'}</div>`;
    const cell = (code, kind) => {
      const val = v[code]; const key = INPUT_KEY[code];
      if (kind === 'flag') return `<span class="num">${val ? '☑' : '☐'}</span>`;
      if (key && (kind === 'tax-input')) return `<input class="inp right num" style="width:150px" type="number" step="1" data-vat-input="${key}" value="${inputs[key] != null && inputs[key] !== '' ? esc(inputs[key]) : (code === 22 ? v[22] : '')}" ${locked ? 'disabled' : ''} placeholder="0">`;
      return money(val);
    };
    const rows = FORM_ROWS.map(([stt, label, baseCode, taxCode, kind]) => {
      if (kind === 'head') return `<tr style="background:var(--bg-soft,#eef2f7)"><td colspan="6"><b>${esc(label)}</b></td></tr>`;
      if (kind === 'head2') return `<tr><td class="center"><b>${esc(stt)}</b></td><td colspan="5"><b>${esc(label.replace(/^[IVX]+\.\s*/, ''))}</b></td></tr>`;
      const strong = kind === 'tax-strong' ? 'strong' : '';
      const baseCell = baseCode != null ? (kind === 'flag' ? cell(baseCode, 'flag') : (kind === 'tax-input' ? cell(baseCode, kind) : money(v[baseCode]))) : '';
      const taxCellHtml = taxCode != null ? (kind === 'tax-input' ? cell(taxCode, kind) : money(v[taxCode])) : '';
      return `<tr><td class="center">${esc(stt)}</td><td>${esc(label)}</td><td class="center num">${baseCode != null ? '[' + baseCode + ']' : ''}</td><td class="right num ${strong}">${baseCell}</td><td class="center num">${taxCode != null ? '[' + taxCode + ']' : ''}</td><td class="right num ${strong}">${taxCellHtml}</td></tr>`;
    }).join('');
    const warns = [];
    if (calc.warnOut.length) warns.push(`<b>${calc.warnOut.length}</b> đơn bán chưa có hóa đơn đã phát hành trong kỳ (${calc.warnOut.slice(0, 6).map(esc).join(', ')}${calc.warnOut.length > 6 ? '…' : ''}). Vào Kế toán → Hóa đơn để lập.`);
    if (calc.warnIn.length) warns.push(`<b>${calc.warnIn.length}</b> đơn mua chưa nhập hóa đơn đầu vào (${calc.warnIn.slice(0, 6).map(esc).join(', ')}${calc.warnIn.length > 6 ? '…' : ''}); thuế đầu vào chỉ được khấu trừ khi có hóa đơn hợp lệ.`);
    if (calc.nonDed.length) warns.push(`<b>${calc.nonDed.length}</b> hóa đơn mua vào không đủ điều kiện khấu trừ, đã loại ${money(calc.nonDed.reduce((s, r) => s + r.vat, 0))} khỏi [25]: ${calc.nonDed.map((r) => `${esc(r.id)} (${esc(r.reason)})`).join('; ')}.`);
    if (!calc.hasPrev && v[22] === 0 && !inputs.c22) warns.push('Chưa có tờ khai kỳ trước được lưu: [22] = 0. Nhập tay nếu kỳ trước còn thuế được khấu trừ chuyển sang.');
    return `${pageHead('Thuế', 'Tờ khai 01/GTGT tính tự động từ đơn bán, đơn mua và sổ hóa đơn; bảng kê đối chiếu từng hóa đơn', `<button class="btn" data-act="acc-vat-csv"><i class="fa-solid fa-file-csv"></i>Xuất CSV</button><button class="btn" data-act="acc-vat-print"><i class="fa-solid fa-print"></i>In / PDF</button>`)}${tabs}
    <div class="card">${head}
      <div style="margin:12px 0 6px"><b>TỜ KHAI THUẾ GIÁ TRỊ GIA TĂNG</b> (Mẫu số 01/GTGT — phương pháp khấu trừ) · Kỳ tính thuế: <b>${esc(per.label)}</b> · ${esc(DB.company?.name || '')} · MST ${esc(DB.company?.tax || '')}</div>
      ${warns.length ? `<div class="alert warning" style="margin-bottom:10px"><i class="fa-solid fa-triangle-exclamation"></i><span>${warns.join('<br>')}</span></div>` : ''}
      ${tableShell([{ t: 'STT', cls: 'center', w: '50px' }, { t: 'Chỉ tiêu' }, { t: 'Mã', cls: 'center', w: '60px' }, { t: 'Giá trị HHDV (chưa có thuế GTGT)', cls: 'right', w: '210px' }, { t: 'Mã', cls: 'center', w: '60px' }, { t: 'Số thuế GTGT', cls: 'right', w: '210px' }], [rows], { emptyTitle: '' })}
      ${calc.reduction.net > 0 ? `<div class="note-box" style="margin-top:10px"><b>Phụ lục giảm thuế GTGT (NQ 204/2025/QH15, NĐ 174/2025/NĐ-CP — đến hết 31/12/2026):</b> giá trị HHDV bán ra chịu thuế 8%: ${money(calc.reduction.net)} · thuế GTGT được giảm (2%): ${money(calc.reduction.reduced)}. Kê khai kèm Mẫu số 01 Phụ lục III NĐ 174/2025/NĐ-CP; phần 8% đã nằm trong dòng 10% của tờ khai chính.</div>` : ''}
      <div class="cell-sub" style="margin-top:8px">Số liệu là bản tính tham khảo từ dữ liệu hệ thống. Đối chiếu mẫu 01/GTGT hiện hành (Thông tư 89/2026/TT-BTC) và ứng dụng khai thuế trước khi nộp.</div>
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">${canAccounting() ? (locked ? `<button class="btn" data-act="acc-vat-reopen"><i class="fa-solid fa-lock-open"></i>Mở lại tờ khai</button>` : `<button class="btn" data-act="acc-vat-save" data-status="DRAFT"><i class="fa-solid fa-floppy-disk"></i>Lưu nháp</button><button class="btn btn-primary" data-act="acc-vat-save" data-status="FILED"><i class="fa-solid fa-lock"></i>Chốt tờ khai</button>`) : ''}</div></div>`;
  }

  function vatListView(kind) {
    const dNow = parseYmd(todayYmd()); const f = F('acc-tax', { sub: kind, type: 'MONTH', year: dNow.y, month: dNow.m, quarter: Math.ceil(dNow.m / 3), onlyInvoiced: false, draft: null });
    const subs = [['vat', 'Tờ khai 01/GTGT'], ['out', 'Bảng kê bán ra'], ['in', 'Bảng kê mua vào'], ['detail', 'Chi tiết theo hàng hóa']];
    const tabs = `<div class="tabs" style="margin-bottom:14px">${subs.map(([k, l]) => `<button class="tab ${f.sub === k ? 'active' : ''}" data-act="acc-tax-sub" data-sub="${k}">${l}</button>`).join('')}</div>`;
    const calc = vatCalc(f, f.draft?.inputs || {}); const per = calc.per;
    const yearOpts = [dNow.y - 2, dNow.y - 1, dNow.y, dNow.y + 1].map((y) => `<option ${f.year === y ? 'selected' : ''}>${y}</option>`).join('');
    const filters = `<div class="toolbar"><select class="inp" data-f="acc-tax.type"><option value="MONTH" ${f.type === 'MONTH' ? 'selected' : ''}>Theo tháng</option><option value="QUARTER" ${f.type === 'QUARTER' ? 'selected' : ''}>Theo quý</option></select>${f.type === 'QUARTER' ? `<select class="inp" data-f="acc-tax.quarter">${[1, 2, 3, 4].map((q) => `<option value="${q}" ${f.quarter === q ? 'selected' : ''}>Quý ${q}</option>`).join('')}</select>` : `<select class="inp" data-f="acc-tax.month">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${f.month === i + 1 ? 'selected' : ''}>Tháng ${i + 1}</option>`).join('')}</select>`}<select class="inp" data-f="acc-tax.year">${yearOpts}</select><span class="spacer"></span><button class="btn btn-sm" data-act="acc-vat-csv"><i class="fa-solid fa-file-csv"></i>Xuất CSV</button></div>`;
    const rowsOf = (list, isOut) => list.map((r, i) => `<tr><td class="center">${i + 1}</td><td>${esc(r.invoice?.templateCode || '')}${esc(r.invoice?.series || '')}${r.invoice ? '' : '<span class="muted">—</span>'}</td><td class="num">${esc(r.invoice?.number || '')}${r.invoice ? '' : '<span class="badge slate">Chưa có HĐ</span>'}</td><td class="num">${fmtDate(r.date)}</td><td>${esc(r.party)}</td><td class="num">${esc(r.tax || '')}</td><td class="right num">${money(r.net)}</td><td class="center">${r.rate}%</td><td class="right num">${money(r.vat)}</td><td>${isOut ? esc(r.orderId) : esc(r.poId)}${!isOut && !r.deductible ? `<div class="cell-sub" style="color:var(--red)">Không khấu trừ: ${esc(r.reason)}</div>` : ''}</td></tr>`);
    const list = kind === 'out' ? calc.outRows : calc.inRows; const total = list.reduce((a, r) => ({ net: a.net + r.net, vat: a.vat + r.vat }), { net: 0, vat: 0 });
    const head = [{ t: 'STT', cls: 'center' }, { t: 'Ký hiệu hóa đơn' }, { t: 'Số hóa đơn' }, { t: 'Ngày' }, { t: kind === 'out' ? 'Tên người mua' : 'Tên người bán' }, { t: 'MST' }, { t: 'Doanh thu / giá trị chưa thuế', cls: 'right' }, { t: 'Thuế suất', cls: 'center' }, { t: 'Thuế GTGT', cls: 'right' }, { t: 'Chứng từ gốc / ghi chú' }];
    return `${pageHead('Thuế', kind === 'out' ? 'Bảng kê hóa đơn, chứng từ HHDV bán ra (PL 01-1/GTGT)' : 'Bảng kê hóa đơn, chứng từ HHDV mua vào (PL 01-2/GTGT)', '')}${tabs}<div class="card">${filters}<div class="cell-sub" style="margin:8px 0">Kỳ ${esc(per.label)} · ${list.length} dòng · Tổng chưa thuế <b>${money(total.net)}</b> · Thuế <b>${money(total.vat)}</b></div>${tableShell(head, rowsOf(list, kind === 'out'), { emptyTitle: 'Không có hóa đơn trong kỳ' })}</div>`;
  }

  const _accTaxViewOrig = typeof accTaxView === 'function' ? accTaxView : null;
  window.accTaxView = function () { const f = F('acc-tax', { sub: 'vat' }); if (f.sub === 'out' || f.sub === 'in') return vatListView(f.sub); return taxView(); };

  function csvOfReturn() {
    const f = F('acc-tax'); const calc = vatCalc(f, f.draft?.inputs || {}); const rows = [];
    FORM_ROWS.forEach(([stt, label, a, b]) => { if (a == null && b == null) return; rows.push([a != null ? `[${a}]` : '', b != null ? `[${b}]` : '', label, a != null ? calc.v[a] ?? '' : '', b != null ? calc.v[b] ?? '' : '']); });
    return { calc, rows };
  }

  Object.assign(Actions, {
    'acc-inv-kind': (d) => { F('acc-inv').kind = d.kind; F('acc-inv').status = ''; render(); },
    'acc-inv-new': (d) => openInvoiceForm(d.order, ''), 'acc-inv-edit': (d) => openInvoiceForm('', d.id),
    'acc-inv-save': async (d) => { const row = await saveInvoice(d); if (!row) return; Modal.close(); render(); Toast.ok(row.status === 'ISSUED' ? 'Đã lưu hóa đơn đã phát hành' : 'Đã lưu hóa đơn nháp', `${row.id}${row.number ? ' · số ' + row.number : ''}`); if (d.after === 'pdf') Actions['acc-inv-pdf']({ id: row.id }); },
    'acc-inv-cancel': async (d) => {
      const i = invList().find((x) => x.id === d.id); if (!i || !canAccounting()) return; if (!confirm('Hủy hóa đơn này? Hóa đơn đã phát hành phải hủy/điều chỉnh trên hệ thống HĐĐT theo quy định.')) return;
      try { await store.save('invoices', { ...i, status: 'CANCELLED', cancelledAt: new Date().toISOString(), cancelledBy: who() }); } catch (err) { Toast.err('Không hủy được', err?.message || ''); return; }
      Modal.close(); render(); Toast.ok('Đã hủy hóa đơn', i.id);
    },
    'acc-inv-print': (d) => { const i = invList().find((x) => x.id === d.id); if (i) printHtml(`Hoa-don-${i.number || i.id}`, invoiceHtml(i)); },
    'acc-inv-pdf': async (d) => {
      const i = invList().find((x) => x.id === d.id); if (!i) return;
      const name = `Hoa-don-${(i.series || '').replace(/\W/g, '')}-${i.number || i.refId}.pdf`;
      try { Toast.info('Đang tạo PDF…', name); await downloadPdf(name, invoiceHtml(i)); Toast.ok('Đã tạo PDF hóa đơn', name); }
      catch (err) { console.warn('[AccV2] PDF lỗi, chuyển sang in:', err); Toast.warn('Không tạo được PDF trực tiếp', 'Mở hộp thoại in: chọn "Lưu dưới dạng PDF".'); printHtml(name.replace('.pdf', ''), invoiceHtml(i)); }
    },
    // Từ chi tiết đơn hàng (CRM): có hóa đơn → tải PDF; chưa có → kế toán lập, người khác xem bản nháp.
    'crm-order-invoice': async (d) => {
      await store.ensure('invoices');
      const inv = invOut(d.id);
      if (inv) { Actions['acc-inv-pdf']({ id: inv.id }); return; }
      if (canAccounting()) { openInvoiceForm(d.id, ''); return; }
      const o = findOrder(d.id); if (!o) return; const c = custOf(o);
      const draft = { id: `HDB-${o.id}`, kind: 'OUT', refType: 'ORDER', refId: o.id, partyName: c?.name || Q.customerName(o.customerId), partyTax: taxOfParty(c), partyAddress: c?.address || '', buyerPerson: c?.contact || '', paymentMethod: 'TM/CK', issueDate: todayYmd(), status: 'DRAFT', templateCode: '1', series: '', number: '' };
      Toast.info('Chỉ kế toán lập hóa đơn chính thức', 'Đang tạo bản nháp để tham khảo.');
      try { await downloadPdf(`Hoa-don-nhap-${o.id}.pdf`, invoiceHtml(draft)); } catch (_) { printHtml(`Hoa-don-nhap-${o.id}`, invoiceHtml(draft)); }
    },
    'acc-inv-in': (d) => openInvoiceIn(d.id), 'acc-inv-in-save': (d) => saveInvoiceIn(d.id),
    'acc-tax-sub': (d) => { F('acc-tax').sub = d.sub; render(); },
    'acc-tax-toggle': (d, el) => { F('acc-tax').onlyInvoiced = !!el?.checked; render(); },
    'acc-vat-csv': () => {
      const f = F('acc-tax'); const per = periodRange(f);
      if (f.sub === 'out' || f.sub === 'in') { const calc = vatCalc(f, f.draft?.inputs || {}); const list = f.sub === 'out' ? calc.outRows : calc.inRows; Exporter.csv(`Bang-ke-${f.sub === 'out' ? 'ban-ra' : 'mua-vao'}-${per.id}.csv`, ['STT', 'Ký hiệu mẫu', 'Ký hiệu HĐ', 'Số HĐ', 'Ngày', f.sub === 'out' ? 'Người mua' : 'Người bán', 'MST', 'Giá trị chưa thuế', 'Thuế suất', 'Thuế GTGT', 'Chứng từ gốc'], list.map((r, i) => [i + 1, r.invoice?.templateCode || '', r.invoice?.series || '', r.invoice?.number || '', r.date, r.party, r.tax || '', Math.round(r.net), r.rate, Math.round(r.vat), r.orderId || r.poId])); return; }
      const { rows } = csvOfReturn(); Exporter.csv(`To-khai-01-GTGT-${per.id}.csv`, ['Mã (giá trị)', 'Mã (thuế)', 'Chỉ tiêu', 'Giá trị HHDV', 'Số thuế GTGT'], rows);
    },
    'acc-vat-print': () => {
      const f = F('acc-tax'); const calc = vatCalc(f, f.draft?.inputs || {}); const per = calc.per;
      const body = FORM_ROWS.map(([stt, label, a, b, kind]) => kind === 'head' || kind === 'head2' ? `<tr><td colspan="6" style="background:#eee"><b>${esc(label)}</b></td></tr>` : `<tr><td style="text-align:center">${esc(stt)}</td><td>${esc(label)}</td><td style="text-align:center">${a != null ? '[' + a + ']' : ''}</td><td style="text-align:right">${a != null ? (kind === 'flag' ? (calc.v[a] ? '☑' : '☐') : fmtN(calc.v[a])) : ''}</td><td style="text-align:center">${b != null ? '[' + b + ']' : ''}</td><td style="text-align:right">${b != null ? fmtN(calc.v[b]) : ''}</td></tr>`).join('');
      printHtml(`To-khai-01-GTGT-${per.id}`, `<div style="font-family:'Times New Roman',serif;font-size:13px"><div style="text-align:center"><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br>Độc lập - Tự do - Hạnh phúc</div><h2 style="text-align:center;margin:10px 0 2px">TỜ KHAI THUẾ GIÁ TRỊ GIA TĂNG</h2><div style="text-align:center">(Mẫu số 01/GTGT — dành cho người nộp thuế tính thuế theo phương pháp khấu trừ)<br>Kỳ tính thuế: <b>${esc(per.label)}</b></div><div style="margin:8px 0">Người nộp thuế: <b>${esc(DB.company?.name || '')}</b> · Mã số thuế: ${esc(DB.company?.tax || '')}<br>Địa chỉ: ${esc(DB.company?.address || '')}</div><table style="width:100%;border-collapse:collapse" border="1" cellpadding="4"><thead><tr><th>STT</th><th>Chỉ tiêu</th><th>Mã</th><th>Giá trị HHDV (chưa thuế)</th><th>Mã</th><th>Số thuế GTGT</th></tr></thead><tbody>${body}</tbody></table><div style="margin-top:10px;font-size:12px"><i>Bản in từ hệ thống quản trị, số liệu tham khảo; đối chiếu trên ứng dụng khai thuế trước khi nộp.</i></div></div>`);
    },
    'acc-vat-save': async (d) => {
      if (!canAccounting()) { Toast.err('Không có quyền', 'Chỉ kế toán được lưu tờ khai.'); return; }
      const f = F('acc-tax'); const per = periodRange(f); const status = d.status === 'FILED' ? 'FILED' : 'DRAFT';
      const calc = vatCalc(f, f.draft?.inputs || {}); const old = savedReturn(per.id);
      if (old?.status === 'FILED') { Toast.warn('Tờ khai đã chốt', 'Mở lại tờ khai trước khi sửa.'); return; }
      if (status === 'FILED' && calc.warnIn.length && !confirm(`Còn ${calc.warnIn.length} đơn mua chưa có hóa đơn đầu vào. Vẫn chốt tờ khai?`)) return;
      const row = { ...(old || {}), id: per.id, type: f.type, year: f.year, month: f.type === 'MONTH' ? f.month : null, quarter: f.type === 'QUARTER' ? f.quarter : null, from: per.from, to: per.to, label: per.label, status, inputs: f.draft?.inputs || {}, values: calc.v, onlyInvoiced: !!f.onlyInvoiced, updatedAt: new Date().toISOString(), updatedBy: who(), ...(status === 'FILED' ? { filedAt: new Date().toISOString(), filedBy: who() } : {}) };
      try { await store.save('vatReturns', row); } catch (err) { Toast.err('Không lưu được tờ khai', err?.message || 'Vui lòng thử lại.'); return; }
      render(); Toast.ok(status === 'FILED' ? 'Đã chốt tờ khai' : 'Đã lưu nháp tờ khai', `${per.label} · [40] ${money(calc.v[40])} · [43] chuyển kỳ sau ${money(calc.v[43])}`);
    },
    'acc-vat-reopen': async () => {
      if (!canAccounting()) return; const f = F('acc-tax'); const per = periodRange(f); const old = savedReturn(per.id); if (!old) return;
      if (!confirm('Mở lại tờ khai đã chốt? Số chuyển kỳ sau sẽ tính lại khi chốt lại.')) return;
      try { await store.save('vatReturns', { ...old, status: 'DRAFT', reopenedAt: new Date().toISOString(), reopenedBy: who() }); } catch (err) { Toast.err('Không mở lại được', err?.message || ''); return; }
      render(); Toast.ok('Đã mở lại tờ khai', per.label);
    },
  });
  // Ô nhập tay trên tờ khai (22, 37, 38, 39, 40b, 42)
  document.addEventListener('change', (e) => {
    const el = e.target; const key = el?.dataset?.vatInput; if (!key) return;
    const f = F('acc-tax'); f.draft = f.draft || { inputs: {} }; f.draft.inputs[key] = el.value === '' ? '' : Number(el.value);
    render(); // tính lại các chỉ tiêu phụ thuộc khi rời ô nhập
  });
})();
