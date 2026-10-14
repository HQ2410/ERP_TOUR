/* ============================================================================
 * Phân hệ 2 — ĐƠN HÀNG
 * Mã đơn, tên KH, tên dịch vụ, ngày khởi hành/kết thúc, đơn giá, số lượng,
 * thành tiền, giảm giá/hoa hồng. Tạo đơn thành công => tự động có tour trong
 * phân hệ Điều hành. Tạo phiếu thu (chọn TK cá nhân/cty), xuất PDF hoặc in.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = window.App, U = App.UI, C = App.Calc, Store = App.Store;
  const st = { q: '', page: 1, status: '' };
  let body, kpi;

  function filtered() {
    const q = U.norm(st.q), digits = st.q.replace(/\D/g, '');
    return Store.state.orders.filter(o => {
      const cu = C.customer(o.customerId) || { name: '', phone: '' };
      if (st.status && C.orderStatus(o).key !== st.status) return false;
      if (!q) return true;
      return U.norm(o.id).includes(q) || U.norm(o.serviceName).includes(q) || U.norm(cu.name).includes(q) ||
        (digits.length >= 3 && String(cu.phone).replace(/\D/g, '').includes(digits));
    }).slice().reverse();
  }

  function renderList() {
    const all = Store.state.orders, rows = filtered();
    const rev = App.sum(all, C.total), paid = App.sum(all, o => C.orderPaid(o.id));
    kpi.innerHTML = U.mkpi({ icon: 'file-invoice-dollar', tone: 'blue', label: 'Tổng số đơn', value: U.fmt(all.length) }) +
      U.mkpi({ icon: 'sack-dollar', tone: 'indigo', label: 'Tổng phải thu', value: U.money(rev) }) +
      U.mkpi({ icon: 'circle-check', tone: 'green', label: 'Đã thu', value: U.money(paid) }) +
      U.mkpi({ icon: 'hourglass-half', tone: 'orange', label: 'Còn phải thu', value: U.money(Math.max(0, rev - paid)) });
    body.innerHTML = U.table({
      rows, st, size: 10,
      empty: U.empty('file-circle-xmark', st.q || st.status ? 'Không tìm thấy đơn hàng' : 'Chưa có đơn hàng', st.q || st.status ? 'Thử đổi từ khóa hoặc bộ lọc.' : 'Bấm “Tạo đơn hàng” để bắt đầu.'),
      cols: [
        { label: 'Mã đơn', render: o => '<span class="code">' + o.id + '</span><div class="cell-sub">Tạo ' + U.fdate(o.date) + '</div>' },
        { label: 'Khách hàng', render: o => { const c = C.customer(o.customerId); return c ? '<div class="cell-main">' + U.esc(c.name) + '</div><div class="cell-sub">' + U.esc(c.phone) + '</div>' : '<span class="muted">—</span>'; } },
        { label: 'Tên dịch vụ', render: o => '<span style="display:block;max-width:170px">' + U.esc(o.serviceName) + '</span>' },
        { label: 'Khởi hành / Kết thúc', render: o => '<span class="nowrap">' + U.fdate(o.start) + '</span><div class="cell-sub nowrap">→ ' + U.fdate(o.end) + '</div>' },
        { label: 'Đơn giá', cls: 'right', render: o => U.money(o.price) },
        { label: 'SL', cls: 'center', render: o => U.fmt(o.qty) },
        { label: 'Thành tiền', cls: 'right', render: o => U.money(C.gross(o)) },
        { label: 'Giảm giá / HH', cls: 'right', render: o => { const d = C.discount(o); return d ? '<span class="money-neg">−' + U.money(d) + '</span>' + (o.discountUnit === 'percent' ? '<div class="cell-sub">' + o.discountValue + '%</div>' : '') : '<span class="muted">—</span>'; } },
        { label: 'Phải thu / Thu tiền', cls: 'right', render: o => { const s = C.orderStatus(o); return '<b class="num">' + U.money(C.total(o)) + '</b><div style="margin-top:3px">' + U.badge(s.label, s.tone) + '</div><div class="cell-sub">Đã thu ' + U.money(C.orderPaid(o.id)) + '</div>'; } },
        { label: '', cls: 'right act-col', render: o => '<div class="row-actions">' + U.iconBtn('thu', o.id, 'hand-holding-dollar', 'Tạo phiếu thu') + U.iconBtn('tour', o.id, 'route', 'Mở điều hành tour') +
          U.iconBtn('print', o.id, 'print', 'In / Xuất PDF') + U.iconBtn('edit', o.id, 'pen', 'Sửa') + U.iconBtn('del', o.id, 'trash', 'Xóa') + '</div>' }
      ]
    });
  }

  function exportData() {
    const rows = filtered().reverse();
    U.exportXlsx({
      filename: 'don-hang', sheet: 'Đơn hàng', title: 'DANH SÁCH ĐƠN HÀNG',
      headers: ['Mã đơn', 'Ngày tạo', 'Khách hàng', 'Điện thoại', 'Tên dịch vụ', 'Ngày khởi hành', 'Ngày kết thúc', 'Đơn giá', 'Số lượng', 'Thành tiền', 'Giảm giá / Hoa hồng', 'Phải thu', 'Đã thu', 'Còn lại', 'Trạng thái thu'],
      rows: rows.map(o => { const c = C.customer(o.customerId) || {}; return [o.id, U.fdate(o.date), c.name || '', c.phone || '', o.serviceName, U.fdate(o.start), U.fdate(o.end), o.price, o.qty, C.gross(o), C.discount(o), C.total(o), C.orderPaid(o.id), C.orderRemain(o), C.orderStatus(o).label]; }),
      moneyCols: [7, 9, 10, 11, 12, 13]
    });
  }

  /* ------------------------------------------------------------- FORM ĐƠN */
  function openForm(id, preset) {
    const o = id ? C.order(id) : null, S = Store.state;
    const t = o ? C.tour(o.id) : null;
    if (o && t && t.status === 'quyettoan') { U.toast('Không thể sửa', 'Tour ' + o.id + ' đã quyết toán. Hãy mở lại quyết toán trong mục Điều hành tour.', 'warning'); return; }
    preset = preset || {};
    const cust = S.customers.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    const svcs = S.settings.services.filter(x => x.active || (o && x.id === o.serviceId));
    const svcOpts = svcs.map(x => ({ v: x.id, l: x.name + ' — ' + U.fmt(x.price) + ' ₫/' + x.unit }));
    if (o && !svcs.find(x => x.id === o.serviceId)) svcOpts.unshift({ v: o.serviceId, l: o.serviceName + ' (đã bỏ khỏi danh mục)' });
    const v = o || { customerId: preset.customerId || '', serviceId: '', start: '', end: '', price: 0, qty: 1, discountValue: 0, discountUnit: 'amount', date: U.todayISO(), note: '' };
    const html =
      '<div class="form-sec-title"><i class="fa-solid fa-user"></i>Khách hàng &amp; dịch vụ</div>' +
      '<div class="form-grid">' +
      U.field({ id: 'customerId', label: 'Khách hàng', req: true, html: '<div class="row-gap" style="flex-wrap:nowrap"><div style="flex:1;min-width:0">' + U.select({ id: 'customerId', ph: '— Chọn khách hàng —', value: v.customerId, options: cust.map(c => ({ v: c.id, l: c.name + ' · ' + c.phone })) }) + '</div><button type="button" class="btn btn-sm" id="btnNewCust" title="Thêm nhanh khách hàng"><i class="fa-solid fa-user-plus"></i></button></div>' }) +
      U.field({ id: 'serviceId', label: 'Tên dịch vụ', req: true, html: U.select({ id: 'serviceId', ph: '— Chọn dịch vụ —', value: v.serviceId, options: svcOpts }) }) +
      U.field({ id: 'start', label: 'Ngày khởi hành', req: true, html: U.input({ id: 'start', type: 'date', value: v.start }) }) +
      U.field({ id: 'end', label: 'Ngày kết thúc', req: true, html: U.input({ id: 'end', type: 'date', value: v.end }) }) +
      '</div>' +
      '<div class="form-sec-title"><i class="fa-solid fa-calculator"></i>Giá &amp; số lượng</div>' +
      '<div class="form-grid">' +
      U.field({ id: 'price', label: 'Đơn giá (₫)', req: true, html: U.input({ id: 'price', money: true, value: v.price || '' }) }) +
      U.field({ id: 'qty', label: 'Số lượng', req: true, hint: 'Với tour: số khách', html: U.input({ id: 'qty', type: 'number', value: v.qty, attrs: 'min="1" step="1"' }) }) +
      U.field({ id: 'discountValue', label: 'Giảm giá / hoa hồng', html: '<div class="row-gap" style="flex-wrap:nowrap"><input class="inp" id="discountValue" inputmode="decimal" value="' + U.esc(v.discountUnit === 'percent' ? v.discountValue : (v.discountValue ? U.fmt(v.discountValue) : '')) + '" placeholder="0" style="flex:1;min-width:0"><div style="width:96px">' +
        U.select({ id: 'discountUnit', value: v.discountUnit, options: [{ v: 'amount', l: '₫' }, { v: 'percent', l: '%' }] }) + '</div></div>' }) +
      U.field({ id: 'date', label: 'Ngày tạo đơn', html: U.input({ id: 'date', type: 'date', value: v.date }) }) +
      '</div>' +
      U.field({ id: 'note', label: 'Ghi chú', html: U.textarea({ id: 'note', rows: 2, value: v.note, ph: 'Yêu cầu đặc biệt, lịch trình, ghi chú nội bộ…' }) }) +
      '<div class="sumbox" id="sum"></div>' +
      (o ? '' : '<div class="callout mt"><i class="fa-solid fa-circle-info"></i><div>Sau khi tạo đơn thành công, đơn sẽ <b>tự động chuyển sang mục Điều hành tour</b> để lập dự trù dịch vụ.</div></div>');

    U.modal({
      title: o ? 'Sửa đơn hàng ' + o.id : 'Tạo đơn hàng', sub: o ? '' : 'Mã đơn được tạo tự động', size: 'md', static: true, body: html,
      onMount: h => {
        const b = h.body;
        const calc = () => {
          const price = U.money$(b, 'price'), qty = Math.max(0, Number(U.val(b, 'qty')) || 0), unit = U.val(b, 'discountUnit');
          const raw = unit === 'percent' ? Number(String(U.val(b, 'discountValue')).replace(',', '.')) || 0 : U.num(U.val(b, 'discountValue'));
          const g = price * qty, d = unit === 'percent' ? Math.round(g * Math.min(100, raw) / 100) : Math.min(raw, g);
          b.querySelector('#sum').innerHTML = '<div class="line"><span>Thành tiền (đơn giá × số lượng)</span><b>' + U.money(g) + '</b></div>' +
            '<div class="line"><span>Giảm giá / hoa hồng' + (unit === 'percent' ? ' (' + raw + '%)' : '') + '</span><b class="money-neg">−' + U.money(d) + '</b></div>' +
            '<div class="line total"><span>Khách phải thanh toán</span><span>' + U.money(g - d) + '</span></div>';
          return { g, d, price, qty, raw, unit };
        };
        b.addEventListener('input', calc); b.addEventListener('change', calc);
        b.querySelector('#discountUnit').addEventListener('change', e => { const f = b.querySelector('#discountValue'); f.value = ''; f.removeAttribute('data-money'); if (e.target.value === 'amount') f.setAttribute('data-money', ''); calc(); });
        if (!o || v.discountUnit === 'amount') b.querySelector('#discountValue').setAttribute('data-money', '');
        b.querySelector('#serviceId').addEventListener('change', e => { const sv = C.service(e.target.value); if (sv) { const p = b.querySelector('#price'); p.value = U.fmt(sv.price); calc(); } });
        b.querySelector('#start').addEventListener('change', e => { const en = b.querySelector('#end'); en.min = e.target.value; if (!en.value || en.value < e.target.value) en.value = e.target.value; });
        b.querySelector('#btnNewCust').onclick = () => App.mod.customers.openForm(null, rec => {
          const sel = b.querySelector('#customerId'); const opt = document.createElement('option'); opt.value = rec.id; opt.textContent = rec.name + ' · ' + rec.phone; sel.appendChild(opt); sel.value = rec.id;
        });
        calc();
      },
      foot: [{ label: 'Hủy' }, {
        label: o ? 'Lưu thay đổi' : 'Tạo đơn hàng', icon: 'check', cls: 'btn-primary', onClick: h => {
          const b = h.body; U.clearErr(b);
          const cid = U.val(b, 'customerId'), sid = U.val(b, 'serviceId'), start = U.val(b, 'start'), end = U.val(b, 'end');
          const price = U.money$(b, 'price'), qty = Number(U.val(b, 'qty')), unit = U.val(b, 'discountUnit');
          const dRaw = unit === 'percent' ? Number(String(U.val(b, 'discountValue')).replace(',', '.')) || 0 : U.num(U.val(b, 'discountValue'));
          let ok = true;
          if (!cid) ok = U.invalid(b, 'customerId', 'Vui lòng chọn khách hàng');
          if (!sid) ok = U.invalid(b, 'serviceId', 'Vui lòng chọn dịch vụ');
          if (!start) ok = U.invalid(b, 'start', 'Chọn ngày khởi hành');
          if (!end) ok = U.invalid(b, 'end', 'Chọn ngày kết thúc'); else if (start && end < start) ok = U.invalid(b, 'end', 'Ngày kết thúc phải sau ngày khởi hành');
          if (price <= 0) ok = U.invalid(b, 'price', 'Đơn giá phải lớn hơn 0');
          if (!Number.isInteger(qty) || qty < 1) ok = U.invalid(b, 'qty', 'Số lượng phải là số nguyên ≥ 1');
          if (dRaw < 0 || (unit === 'percent' && dRaw > 100)) ok = U.invalid(b, 'discountValue', unit === 'percent' ? 'Phần trăm từ 0 đến 100' : 'Giá trị không hợp lệ');
          const draft = { price, qty, discountValue: dRaw, discountUnit: unit };
          if (ok && o && C.total(draft) < C.orderPaid(o.id)) ok = U.invalid(b, 'price', 'Tổng đơn (' + U.money(C.total(draft)) + ') nhỏ hơn số đã thu (' + U.money(C.orderPaid(o.id)) + ')');
          if (!ok) { U.focusFirstInvalid(b); return; }
          const sv = C.service(sid);
          const data = { customerId: cid, serviceId: sid, serviceName: sv ? sv.name : (o ? o.serviceName : ''), start, end, price, qty, discountValue: dRaw, discountUnit: unit, date: U.val(b, 'date') || U.todayISO(), note: U.val(b, 'note') };
          if (o) {
            const oldQty = o.qty; Object.assign(o, data);
            if (t && t.guests === oldQty) t.guests = qty;
            Store.save(); h.close(); U.toast('Đã cập nhật đơn hàng', o.id);
          } else {
            const rec = Object.assign({ id: Store.nextId('DH', 4) }, data);
            Store.state.orders.push(rec);
            Store.state.tours.push({ id: rec.id, orderId: rec.id, guests: qty, status: 'dieuhanh', budget: [], bookings: [], handover: null, settlement: null });
            Store.save(); h.close();
            U.toast('Đã tạo đơn ' + rec.id, 'Đơn đã được chuyển sang mục Điều hành tour.', 'success', { label: 'Mở điều hành tour →', fn: () => App.Router.go('#/operations/' + rec.id) });
          }
          if (body) renderList();
          if (App.refreshChrome) App.refreshChrome();
        }
      }]
    });
  }

  async function del(id) {
    const o = C.order(id); if (!o) return;
    const t = C.tour(id);
    if (Store.state.vouchers.some(v => v.orderId === id)) { U.toast('Không thể xóa', 'Đơn ' + id + ' đã có phiếu thu/chi. Hãy xóa các phiếu liên quan trước.', 'warning'); return; }
    const hasBudget = t && t.budget.length;
    if (!(await U.confirm({ title: 'Xóa đơn hàng', message: 'Xóa đơn <b>' + id + '</b>?' + (hasBudget ? '<br><br>Tour điều hành và <b>' + t.budget.length + ' dòng dự trù</b> của đơn này cũng sẽ bị xóa.' : '<br>Tour điều hành đi kèm cũng sẽ bị xóa.'), ok: 'Xóa đơn', danger: true }))) return;
    Store.state.orders = Store.state.orders.filter(x => x.id !== id);
    Store.state.tours = Store.state.tours.filter(x => x.id !== id);
    Store.save(); renderList(); U.toast('Đã xóa đơn hàng', id); if (App.refreshChrome) App.refreshChrome();
  }

  /* ---------------------------------------------------------- IN / PDF ĐƠN */
  function printOrder(id) {
    const o = C.order(id); if (!o) return;
    const c = C.customer(o.customerId) || { name: '', phone: '', address: '', cccd: '' };
    const paid = C.orderPaid(id), total = C.total(o), pts = Store.state.vouchers.filter(v => v.kind === 'thu' && v.orderId === id);
    const html = U.docHeader('Mã đơn: <b>' + o.id + '</b><br>' + U.docDate(o.date)) +
      '<div class="doc-title">Đơn hàng dịch vụ</div><div class="doc-sub">Số: ' + o.id + '</div>' +
      '<div class="doc-meta"><div><span>Khách hàng:</span> <b>' + U.esc(c.name) + '</b></div><div><span>Điện thoại:</span> ' + U.esc(c.phone) + '</div>' +
      '<div><span>Số CCCD:</span> ' + (U.esc(c.cccd) || '—') + '</div><div><span>Địa chỉ:</span> ' + (U.esc(c.address) || '—') + '</div></div>' +
      '<table class="doc-tbl"><thead><tr><th>STT</th><th>Tên dịch vụ</th><th>Khởi hành</th><th>Kết thúc</th><th>Đơn giá</th><th>SL</th><th>Thành tiền</th></tr></thead><tbody><tr><td class="c">1</td><td>' + U.esc(o.serviceName) +
      '</td><td class="c">' + U.fdate(o.start) + '</td><td class="c">' + U.fdate(o.end) + '</td><td class="r">' + U.fmt(o.price) + '</td><td class="c">' + U.fmt(o.qty) + '</td><td class="r">' + U.fmt(C.gross(o)) + '</td></tr>' +
      '<tr><td colspan="6" class="r">Giảm giá / hoa hồng' + (o.discountUnit === 'percent' ? ' (' + o.discountValue + '%)' : '') + '</td><td class="r">−' + U.fmt(C.discount(o)) + '</td></tr>' +
      '<tr><td colspan="6" class="r b">TỔNG THANH TOÁN</td><td class="r b">' + U.fmt(total) + '</td></tr>' +
      '<tr><td colspan="6" class="r">Đã thanh toán</td><td class="r">' + U.fmt(paid) + '</td></tr><tr><td colspan="6" class="r b">CÒN LẠI</td><td class="r b">' + U.fmt(Math.max(0, total - paid)) + '</td></tr></tbody></table>' +
      '<div class="doc-note"><i>Bằng chữ: ' + U.numWords(total) + '</i></div>' +
      (pts.length ? '<div class="doc-note b">Các lần thanh toán:</div><table class="doc-tbl"><thead><tr><th>Phiếu</th><th>Ngày</th><th>Tài khoản</th><th>Số tiền</th></tr></thead><tbody>' +
        pts.map(v => { const a = C.account(v.accountId); return '<tr><td class="c">' + v.id + '</td><td class="c">' + U.fdate(v.date) + '</td><td>' + (a ? U.esc(a.bank + ' - ' + a.number) : '') + '</td><td class="r">' + U.fmt(v.amount) + '</td></tr>'; }).join('') + '</tbody></table>' : '') +
      (o.note ? '<div class="doc-note"><b>Ghi chú:</b> ' + U.esc(o.note) + '</div>' : '') +
      '<div class="doc-sign" style="grid-template-columns:1fr 1fr"><div><b>Khách hàng</b><i>(Ký, ghi rõ họ tên)</i></div><div><b>Người lập đơn</b><i>(Ký, ghi rõ họ tên)</i></div></div>';
    U.previewDoc('Đơn hàng ' + id, html, { filename: 'Don-hang-' + id });
  }

  const mod = {
    title: 'Đơn hàng', group: 'Nghiệp vụ', icon: 'file-invoice-dollar',
    openForm, printOrder,
    render(view) {
      st.q = App.Router.takeQ() || ''; st.page = 1; st.status = '';
      view.innerHTML = '<div class="page-head"><div><h1>Đơn hàng</h1><p>Tạo đơn, thu tiền và chuyển tour sang điều hành.</p></div><div class="page-head-actions">' +
        '<button class="btn" id="oExport"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button>' +
        '<button class="btn btn-primary" id="oAdd"><i class="fa-solid fa-plus"></i>Tạo đơn hàng</button></div></div>' +
        '<div class="kpi-row" id="oKpi"></div>' +
        '<div class="card"><div class="toolbar"><div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" id="oSearch" placeholder="Tìm theo mã đơn, tên dịch vụ, tên KH, số điện thoại…" value="' + U.esc(st.q) + '"></div>' +
        '<select class="inp status-sel" id="oStatus"><option value="">Tất cả trạng thái thu</option><option value="none">Chưa thu</option><option value="part">Thu một phần</option><option value="full">Đã thu đủ</option></select></div><div id="oBody"></div></div>';
      body = U.$('#oBody', view); kpi = U.$('#oKpi', view);
      U.$('#oSearch', view).oninput = e => { st.q = e.target.value; st.page = 1; renderList(); };
      U.$('#oStatus', view).onchange = e => { st.status = e.target.value; st.page = 1; renderList(); };
      U.$('#oAdd', view).onclick = () => openForm();
      U.$('#oExport', view).onclick = exportData;
      body.onclick = e => {
        if (U.pagerClick(e, st)) { renderList(); return; }
        const b = e.target.closest('[data-act]'); if (!b) return; const id = b.dataset.id;
        switch (b.dataset.act) {
          case 'edit': openForm(id); break;
          case 'del': del(id); break;
          case 'print': printOrder(id); break;
          case 'tour': App.Router.go('#/operations/' + id); break;
          case 'thu': {
            const o = C.order(id), t = C.tour(id);
            if (t && t.status === 'quyettoan') { U.toast('Tour đã quyết toán', 'Không thể tạo thêm phiếu thu cho đơn này.', 'warning'); break; }
            if (C.orderRemain(o) <= 0) { U.toast('Đơn đã thu đủ', 'Không còn số tiền phải thu cho đơn ' + id + '.', 'info'); break; }
            App.mod.accounting.openVoucherForm({ kind: 'thu', orderId: id, onSaved: renderList });
            break;
          }
        }
      };
      renderList();
    }
  };
  App.mod.orders = mod; App.Router.register('orders', mod);
})();
