/* ============================================================================
 * Phân hệ 5 — KẾ TOÁN
 * Tạo phiếu thu / chi, mã phiếu. Tìm theo mã phiếu. Bắt buộc chọn tài khoản
 * ngân hàng cá nhân hoặc tài khoản công ty. Xuất PDF hoặc in.
 * Form phiếu (openVoucherForm) cũng được Đơn hàng và Điều hành tour gọi lại.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store, K = App.CONST;
  const st = { q: '', page: 1, tab: 'all', kind: '' };
  let body, kpi, tabsEl;

  const accLabel = a => a ? a.bank + ' · ' + a.number : '—';
  const isSettled = tid => { const t = tid && C.tour(tid); return !!(t && t.status === 'quyettoan'); };

  /* ---------------------------------------------------------------- DANH SÁCH */
  function base() {
    const q = U.norm(st.q);
    return Store.state.vouchers.filter(v => (!st.kind || (C.account(v.accountId) || {}).kind === st.kind) &&
      (!q || U.norm(v.id).includes(q) || U.norm(v.content).includes(q) || U.norm(v.party).includes(q) || U.norm(v.orderId).includes(q) || U.norm(v.tourId).includes(q)));
  }
  const sortDesc = arr => arr.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));

  function renderList() {
    const b = base(), rows = sortDesc(b.filter(v => st.tab === 'all' || v.kind === st.tab));
    const thu = App.sum(rows.filter(v => v.kind === 'thu'), v => v.amount), chi = App.sum(rows.filter(v => v.kind === 'chi'), v => v.amount);
    kpi.innerHTML = U.mkpi({ icon: 'arrow-trend-up', tone: 'green', label: 'Tổng thu', value: U.money(thu) }) +
      U.mkpi({ icon: 'arrow-trend-down', tone: 'red', label: 'Tổng chi', value: U.money(chi) }) +
      U.mkpi({ icon: 'scale-balanced', tone: 'blue', label: 'Chênh lệch thu – chi', value: U.signed(thu - chi) }) +
      U.mkpi({ icon: 'receipt', tone: 'slate', label: 'Số phiếu', value: rows.length });
    tabsEl.innerHTML = U.tabs([{ key: 'all', label: 'Tất cả', cnt: b.length }, { key: 'thu', label: 'Phiếu thu', cnt: b.filter(v => v.kind === 'thu').length }, { key: 'chi', label: 'Phiếu chi', cnt: b.filter(v => v.kind === 'chi').length }], st.tab);
    body.innerHTML = U.table({
      rows, st, size: 12,
      empty: U.empty('receipt', st.q ? 'Không tìm thấy phiếu' : 'Chưa có phiếu', st.q ? 'Thử tìm lại theo mã phiếu (VD: PT0001, PC0003).' : 'Bấm “Tạo phiếu thu” hoặc “Tạo phiếu chi”.'),
      cols: [
        { label: 'Mã phiếu', render: v => '<span class="code">' + v.id + '</span>' },
        { label: 'Ngày', render: v => '<span class="nowrap">' + U.fdate(v.date) + '</span>' },
        { label: 'Loại', render: v => v.kind === 'thu' ? U.badge('Thu', 'green') : U.badge('Chi', 'red') },
        { label: 'Người nộp / nhận', render: v => '<span class="cell-main">' + U.esc(v.party) + '</span>' },
        { label: 'Nội dung', render: v => '<span style="display:block;max-width:300px">' + U.esc(v.content) + '</span>' + (C.voucherLinkLabel(v) ? '<div class="cell-sub">' + C.voucherLinkLabel(v) + '</div>' : '') },
        { label: 'Tài khoản', render: v => { const a = C.account(v.accountId); return a ? '<div class="cell-main">' + U.esc(a.bank) + '</div><div class="cell-sub">' + U.esc(a.number) + ' · ' + (a.kind === 'company' ? 'Công ty' : 'Cá nhân') + '</div>' : '<span class="muted">—</span>'; } },
        { label: 'Số tiền', cls: 'right', render: v => '<b class="num ' + (v.kind === 'thu' ? 'money-pos' : 'money-neg') + '">' + (v.kind === 'thu' ? '+' : '−') + U.money(v.amount) + '</b>' },
        { label: '', cls: 'right', render: v => '<div class="row-actions">' + U.iconBtn('print', v.id, 'print', 'In / Xuất PDF') + U.iconBtn('edit', v.id, 'pen', 'Sửa') + U.iconBtn('del', v.id, 'trash', 'Xóa') + '</div>' }
      ]
    });
  }

  function exportData() {
    const rows = sortDesc(base().filter(v => st.tab === 'all' || v.kind === st.tab));
    U.exportXlsx({
      filename: 'phieu-thu-chi', sheet: 'Phiếu thu chi', title: 'SỔ PHIẾU THU / CHI',
      headers: ['Mã phiếu', 'Ngày', 'Loại', 'Người nộp / nhận', 'Nội dung', 'Chứng từ liên quan', 'Ngân hàng', 'Số tài khoản', 'Loại tài khoản', 'Thu (₫)', 'Chi (₫)'],
      rows: rows.map(v => { const a = C.account(v.accountId) || {}; return [v.id, U.fdate(v.date), v.kind === 'thu' ? 'Thu' : 'Chi', v.party, v.content, C.voucherLinkLabel(v), a.bank || '', a.number || '', a.kind ? K.ACCOUNT_KINDS[a.kind] : '', v.kind === 'thu' ? v.amount : '', v.kind === 'chi' ? v.amount : '']; }),
      moneyCols: [9, 10]
    });
  }

  /* ----------------------------------------------------------------- FORM PHIẾU */
  function openVoucherForm(opts) {
    opts = opts || {};
    const S = Store.state, rec = opts.id ? C.voucher(opts.id) : null, kind = rec ? rec.kind : opts.kind;
    if (rec && (isSettled(rec.tourId) || isSettled(rec.orderId))) { U.toast('Không thể sửa phiếu', 'Tour liên quan đã quyết toán.', 'warning'); return; }
    if (!rec && (isSettled(opts.tourId) || isSettled(opts.orderId))) { U.toast('Tour đã quyết toán', 'Không thể lập thêm phiếu cho tour này.', 'warning'); return; }
    const isThu = kind === 'thu';
    const v = rec || { kind, date: U.todayISO(), accountId: '', amount: 0, party: '', content: '', orderId: opts.orderId || '', tourId: opts.tourId || '', lineId: opts.lineId || '', supplierId: '' };
    const locked = !rec && !!(opts.orderId || opts.tourId);
    const curAcc = C.account(v.accountId);
    const code = rec ? rec.id : (isThu ? 'PT' : 'PC') + String(((S.seq[isThu ? 'PT' : 'PC']) || 0) + 1).padStart(4, '0');
    const custOf = o => (C.customer(o.customerId) || {}).name || '';

    const orderOpts = () => S.orders.filter(o => o.id === v.orderId || (!isSettled(o.id) && C.orderRemain(o) > 0)).map(o => ({ v: o.id, l: o.id + ' — ' + custOf(o) + ' — còn phải thu ' + U.money(C.orderRemain(o)) }));
    const tourOpts = () => S.tours.filter(t => t.id === v.tourId || t.status !== 'quyettoan').map(t => { const o = C.order(t.orderId) || {}; return { v: t.id, l: t.id + ' — ' + (o.serviceName || '') + ' — ' + custOf(o) }; });

    const link = isThu
      ? U.field({ id: 'orderId', label: 'Đơn hàng liên quan', hint: 'Không bắt buộc. Chọn đơn để ghi nhận khách đã thanh toán.', html: U.select({ id: 'orderId', ph: '— Phiếu thu lẻ (không gắn đơn) —', value: v.orderId, options: orderOpts(), attrs: locked ? 'disabled' : '' }) })
      : '<div class="form-grid">' + U.field({ id: 'tourId', label: 'Tour liên quan', html: U.select({ id: 'tourId', ph: '— Phiếu chi lẻ (không gắn tour) —', value: v.tourId, options: tourOpts(), attrs: locked ? 'disabled' : '' }) }) +
        U.field({ id: 'lineId', label: 'Dịch vụ NCC trong dự trù', html: '<select class="inp" id="lineId"' + (locked && opts.lineId ? ' disabled' : '') + '></select>' }) + '</div>';

    const html = '<div class="form-grid">' +
      U.field({ id: 'date', label: 'Ngày lập phiếu', req: true, html: U.input({ id: 'date', type: 'date', value: v.date }) }) +
      U.field({ id: 'code', label: 'Mã phiếu', html: U.input({ id: 'code', value: code, attrs: 'disabled' }) }) + '</div>' + link +
      '<div class="form-sec-title"><i class="fa-solid fa-building-columns"></i>Tài khoản ngân hàng ' + (isThu ? 'nhận tiền' : 'chi tiền') + '</div>' +
      U.field({ id: 'akind', label: 'Loại tài khoản', req: true, hint: 'Bắt buộc chọn tài khoản cá nhân hoặc tài khoản công ty.', html: '<div class="seg">' +
        ['company', 'personal'].map(k => '<label><input type="radio" name="akind" value="' + k + '"' + (curAcc && curAcc.kind === k ? ' checked' : '') + '><span><i class="fa-solid fa-' + (k === 'company' ? 'building' : 'user') + '"></i>' + K.ACCOUNT_KINDS[k] + '</span></label>').join('') + '</div>' }) +
      U.field({ id: 'accountId', label: 'Tài khoản', req: true, html: '<select class="inp" id="accountId"></select>' }) +
      '<div class="form-sec-title"><i class="fa-solid fa-pen-to-square"></i>Nội dung phiếu</div>' +
      '<div class="form-grid">' +
      U.field({ id: 'amount', label: 'Số tiền (₫)', req: true, html: U.input({ id: 'amount', money: true, value: v.amount || '' }) }) +
      U.field({ id: 'party', label: isThu ? 'Người nộp tiền' : 'Người nhận tiền', req: true, html: U.input({ id: 'party', value: v.party }) }) + '</div>' +
      U.field({ id: 'content', label: isThu ? 'Lý do thu' : 'Lý do chi', req: true, html: U.input({ id: 'content', value: v.content }) }) +
      '<div class="cell-sub" id="vHint"></div>';

    U.modal({
      title: rec ? 'Sửa phiếu ' + (isThu ? 'thu ' : 'chi ') + rec.id : (isThu ? 'Tạo phiếu thu' : 'Tạo phiếu chi'), size: 'md', static: true, body: html,
      onMount: h => {
        const b = h.body, $ = s => b.querySelector(s);
        const selKind = () => { const r = b.querySelector('input[name="akind"]:checked'); return r ? r.value : ''; };
        const fillAcc = (keep) => {
          const k = selKind(), sel = $('#accountId'), list = S.settings.accounts.filter(a => a.kind === k);
          sel.innerHTML = !k ? '<option value="">— Chọn loại tài khoản trước —</option>' : list.length ? '<option value="">— Chọn tài khoản —</option>' + list.map(a => '<option value="' + a.id + '">' + U.esc(a.bank + ' · ' + a.number + ' — số dư ' + U.money(C.accountBalance(a.id))) + '</option>').join('') : '<option value="">Chưa có tài khoản loại này (thêm ở Hệ thống)</option>';
          sel.disabled = !k || !list.length; if (keep) sel.value = keep;
        };
        fillAcc(v.accountId);
        b.querySelectorAll('input[name="akind"]').forEach(r => r.addEventListener('change', () => fillAcc('')));

        const hint = t => { $('#vHint').innerHTML = t || ''; };
        const limitOf = () => {
          if (isThu) { const o = C.order($('#orderId').value); if (!o) return null; return { max: C.orderRemain(o) + (rec && rec.orderId === o.id && rec.kind === 'thu' ? rec.amount : 0), label: 'số còn phải thu của đơn ' + o.id }; }
          const t = C.tour($('#tourId').value), lid = $('#lineId').value; if (!t || !lid) return null; const l = t.budget.find(x => x.id === lid); if (!l) return null;
          return { max: C.lineRemain(t, l) + (rec && rec.lineId === lid && rec.kind === 'chi' ? rec.amount : 0), label: 'số còn phải trả NCC của dòng dự trù này' };
        };
        const showHint = () => { const l = limitOf(); hint(l ? '<i class="fa-solid fa-circle-info"></i> Tối đa ' + U.money(l.max) + ' (' + l.label + ').' : ''); };

        if (isThu) {
          $('#orderId').addEventListener('change', e => {
            const o = C.order(e.target.value); if (!o) { hint(''); return; }
            $('#party').value = custOf(o); $('#content').value = 'Thu tiền đơn ' + o.id + ' - ' + o.serviceName; $('#amount').value = U.fmt(C.orderRemain(o)); showHint();
          });
          if (!rec && v.orderId) { const o = C.order(v.orderId); if (o) { $('#party').value = custOf(o); $('#content').value = 'Thu tiền đơn ' + o.id + ' - ' + o.serviceName; $('#amount').value = U.fmt(C.orderRemain(o)); } }
        } else {
          const fillLines = (tid, cur) => {
            const t = C.tour(tid), sel = $('#lineId');
            if (!t) { sel.innerHTML = '<option value="">— Chọn tour trước —</option>'; sel.disabled = true; return; }
            const ls = t.budget.filter(l => l.id === cur || C.lineRemain(t, l) > 0);
            sel.innerHTML = '<option value="">— Chi phí khác (không theo dòng dự trù) —</option>' + ls.map(l => { const s = C.supplier(l.supplierId) || {}; return '<option value="' + l.id + '">' + U.esc((s.name || '') + ' — ' + l.service + ' — còn ' + U.money(C.lineRemain(t, l))) + '</option>'; }).join('');
            sel.disabled = !!(locked && opts.lineId); if (cur) sel.value = cur;
          };
          fillLines(v.tourId, v.lineId);
          $('#tourId').addEventListener('change', e => { fillLines(e.target.value, ''); hint(''); });
          $('#lineId').addEventListener('change', e => {
            const t = C.tour($('#tourId').value), l = t && t.budget.find(x => x.id === e.target.value); if (!l) { hint(''); return; }
            const s = C.supplier(l.supplierId) || {}; $('#party').value = s.name || ''; $('#content').value = 'Thanh toán ' + l.service + ' - Tour ' + t.id; $('#amount').value = U.fmt(C.lineRemain(t, l)); showHint();
          });
          if (!rec && v.lineId) { const t = C.tour(v.tourId), l = t && t.budget.find(x => x.id === v.lineId); if (l) { const s = C.supplier(l.supplierId) || {}; $('#party').value = s.name || ''; $('#content').value = 'Thanh toán ' + l.service + ' - Tour ' + t.id; $('#amount').value = U.fmt(C.lineRemain(t, l)); } }
        }
        showHint();
      },
      foot: [{ label: 'Hủy' }, {
        label: rec ? 'Lưu thay đổi' : (isThu ? 'Lập phiếu thu' : 'Lập phiếu chi'), icon: 'check', cls: 'btn-primary', onClick: async h => {
          const b = h.body, $ = s => b.querySelector(s); U.clearErr(b); let ok = true;
          const orderId = isThu ? $('#orderId').value : '', tourId = isThu ? '' : $('#tourId').value, lineId = isThu ? '' : $('#lineId').value;
          const k = (b.querySelector('input[name="akind"]:checked') || {}).value, accId = $('#accountId').value, amount = U.money$(b, 'amount');
          if (!U.val(b, 'date')) ok = U.invalid(b, 'date', 'Chọn ngày lập phiếu');
          if (!k) ok = U.invalid(b, 'akind', 'Vui lòng chọn tài khoản cá nhân hoặc tài khoản công ty'); else if (!accId) ok = U.invalid(b, 'accountId', 'Vui lòng chọn tài khoản cụ thể');
          if (amount <= 0) ok = U.invalid(b, 'amount', 'Số tiền phải lớn hơn 0');
          if (!U.val(b, 'party')) ok = U.invalid(b, 'party', isThu ? 'Nhập người nộp tiền' : 'Nhập người nhận tiền');
          if (!U.val(b, 'content')) ok = U.invalid(b, 'content', 'Nhập lý do');
          if (ok) {
            if (isThu && orderId) { const o = C.order(orderId); const max = C.orderRemain(o) + (rec && rec.orderId === orderId ? rec.amount : 0); if (isSettled(orderId)) ok = U.invalid(b, 'orderId', 'Tour của đơn này đã quyết toán'); else if (amount > max) ok = U.invalid(b, 'amount', 'Vượt quá số còn phải thu của đơn (' + U.money(max) + ')'); }
            if (!isThu && tourId && isSettled(tourId)) ok = U.invalid(b, 'tourId', 'Tour đã quyết toán');
            if (!isThu && tourId && lineId) { const t = C.tour(tourId), l = t.budget.find(x => x.id === lineId); const max = C.lineRemain(t, l) + (rec && rec.lineId === lineId ? rec.amount : 0); if (amount > max) ok = U.invalid(b, 'amount', 'Vượt quá số còn phải trả NCC (' + U.money(max) + ')'); }
          }
          if (!ok) { U.focusFirstInvalid(b); return; }
          if (!isThu) {
            const bal = C.accountBalance(accId) + (rec && rec.accountId === accId ? rec.amount : 0);
            if (amount > bal && !(await U.confirm({ title: 'Số dư không đủ', message: 'Tài khoản <b>' + U.esc(accLabel(C.account(accId))) + '</b> chỉ còn <b>' + U.money(bal) + '</b>, nhỏ hơn số tiền chi <b>' + U.money(amount) + '</b>. Vẫn lập phiếu chi?', ok: 'Vẫn lập phiếu', danger: true }))) return;
          }
          let supplierId = '', linkOrder = orderId;
          if (!isThu && tourId) { const t = C.tour(tourId); linkOrder = t.orderId; if (lineId) supplierId = (t.budget.find(x => x.id === lineId) || {}).supplierId || ''; }
          const data = { date: U.val(b, 'date'), accountId: accId, amount, party: U.val(b, 'party'), content: U.val(b, 'content'), orderId: linkOrder, tourId, lineId, supplierId };
          let saved;
          if (rec) { Object.assign(rec, data); saved = rec; U.toast('Đã cập nhật phiếu', rec.id); }
          else { saved = Object.assign({ id: Store.nextId(isThu ? 'PT' : 'PC', 4), kind }, data); Store.state.vouchers.push(saved);
            U.toast('Đã lập phiếu ' + (isThu ? 'thu ' : 'chi ') + saved.id, U.money(amount) + ' · ' + accLabel(C.account(accId)), 'success', { label: 'In / Xuất PDF →', fn: () => printVoucher(saved.id) }); }
          Store.save(); h.close();
          if (opts.onSaved) opts.onSaved(saved); if (body) renderList(); if (App.refreshChrome) App.refreshChrome();
        }
      }]
    });
  }

  /* -------------------------------------------------------------- IN / PDF PHIẾU */
  function printVoucher(id) {
    const v = C.voucher(id); if (!v) return;
    const a = C.account(v.accountId) || {}, isThu = v.kind === 'thu';
    const o = C.order(v.orderId), cu = o ? C.customer(o.customerId) : null, sp = v.supplierId ? C.supplier(v.supplierId) : null;
    const addr = isThu ? (cu && cu.address) : (sp && sp.address);
    const html = U.docHeader('Số phiếu: <b>' + v.id + '</b>') +
      '<div class="doc-title">Phiếu ' + (isThu ? 'thu' : 'chi') + '</div><div class="doc-sub">' + U.docDate(v.date) + ' · Số: ' + v.id + '</div>' +
      '<div class="doc-meta" style="grid-template-columns:1fr">' +
      '<div><span>Họ tên người ' + (isThu ? 'nộp' : 'nhận') + ' tiền:</span> <b>' + U.esc(v.party) + '</b></div>' +
      (addr ? '<div><span>Địa chỉ:</span> ' + U.esc(addr) + '</div>' : '') +
      '<div><span>Lý do ' + (isThu ? 'nộp' : 'chi') + ':</span> ' + U.esc(v.content) + '</div>' +
      '<div><span>Số tiền:</span> <span class="doc-big">' + U.fmt(v.amount) + ' đồng</span></div>' +
      '<div><span>Viết bằng chữ:</span> <i>' + U.numWords(v.amount) + '</i></div>' +
      '<div><span>Tài khoản ' + (isThu ? 'nhận' : 'chi') + ' (' + (a.kind ? K.ACCOUNT_KINDS[a.kind] : '') + '):</span> ' + U.esc((a.bank || '') + ' — STK ' + (a.number || '') + ' — ' + (a.holder || '')) + '</div>' +
      (C.voucherLinkLabel(v) ? '<div><span>Chứng từ kèm theo:</span> ' + C.voucherLinkLabel(v) + '</div>' : '') + '</div>' +
      '<div class="doc-sign" style="grid-template-columns:repeat(4,1fr)"><div><b>Giám đốc</b><i>(Ký, đóng dấu)</i></div><div><b>Kế toán trưởng</b><i>(Ký, ghi rõ họ tên)</i></div>' +
      '<div><b>Người lập phiếu</b><i>(Ký, ghi rõ họ tên)</i></div><div><b>Người ' + (isThu ? 'nộp' : 'nhận') + ' tiền</b><i>(Ký, ghi rõ họ tên)</i></div></div>';
    U.previewDoc('Phiếu ' + (isThu ? 'thu ' : 'chi ') + id, html, { filename: (isThu ? 'Phieu-thu-' : 'Phieu-chi-') + id });
  }

  async function del(id) {
    const v = C.voucher(id); if (!v) return;
    if (isSettled(v.tourId) || isSettled(v.orderId)) { U.toast('Không thể xóa', 'Tour liên quan đã quyết toán.', 'warning'); return; }
    if (!(await U.confirm({ title: 'Xóa phiếu', message: 'Xóa phiếu ' + (v.kind === 'thu' ? 'thu' : 'chi') + ' <b>' + v.id + '</b> (' + U.money(v.amount) + ')?<br>Số dư tài khoản và công nợ sẽ được tính lại.', ok: 'Xóa phiếu', danger: true }))) return;
    Store.state.vouchers = Store.state.vouchers.filter(x => x.id !== id); Store.save(); renderList(); U.toast('Đã xóa phiếu', id); if (App.refreshChrome) App.refreshChrome();
  }

  const mod = {
    title: 'Kế toán', group: 'Tài chính', icon: 'calculator',
    openVoucherForm, printVoucher,
    render(view) {
      st.q = App.Router.takeQ() || ''; st.page = 1; st.tab = 'all'; st.kind = '';
      view.innerHTML = '<div class="page-head"><div><h1>Kế toán</h1><p>Lập phiếu thu / phiếu chi và theo dõi số dư các tài khoản.</p></div><div class="page-head-actions">' +
        '<button class="btn" id="aExport"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button>' +
        '<button class="btn btn-success" id="aThu"><i class="fa-solid fa-circle-plus"></i>Tạo phiếu thu</button>' +
        '<button class="btn btn-danger" id="aChi"><i class="fa-solid fa-circle-minus"></i>Tạo phiếu chi</button></div></div>' +
        '<div class="kpi-row" id="aKpi"></div>' +
        '<div class="card"><div id="aTabs"></div><div class="toolbar"><div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" id="aSearch" placeholder="Tìm theo mã phiếu (PT0001, PC0003…)" value="' + U.esc(st.q) + '"></div>' +
        '<select class="inp status-sel" id="aKind"><option value="">Mọi tài khoản</option><option value="company">Tài khoản công ty</option><option value="personal">Tài khoản cá nhân</option></select></div><div id="aBody"></div></div>';
      body = U.$('#aBody', view); kpi = U.$('#aKpi', view); tabsEl = U.$('#aTabs', view);
      U.$('#aSearch', view).oninput = e => { st.q = e.target.value; st.page = 1; renderList(); };
      U.$('#aKind', view).onchange = e => { st.kind = e.target.value; st.page = 1; renderList(); };
      U.$('#aThu', view).onclick = () => openVoucherForm({ kind: 'thu' });
      U.$('#aChi', view).onclick = () => openVoucherForm({ kind: 'chi' });
      U.$('#aExport', view).onclick = exportData;
      tabsEl.onclick = e => { const t = e.target.closest('[data-tab]'); if (t) { st.tab = t.dataset.tab; st.page = 1; renderList(); } };
      body.onclick = e => {
        if (U.pagerClick(e, st)) { renderList(); return; }
        const bt = e.target.closest('[data-act]'); if (!bt) return;
        if (bt.dataset.act === 'print') printVoucher(bt.dataset.id); else if (bt.dataset.act === 'edit') openVoucherForm({ id: bt.dataset.id }); else if (bt.dataset.act === 'del') del(bt.dataset.id);
      };
      renderList();
    }
  };
  App.mod.accounting = mod; App.Router.register('accounting', mod);
})();
