/* ============================================================================
 * MODULE: TRUNG TÂM BÁO CÁO (tổng hợp / sản xuất / doanh thu / vật tư)
 * ==========================================================================*/

/** Bộ lọc dùng chung cho các trang báo cáo */
function reportFilterBar(key, extra = '') {
  const f = F(key, { from: '2026-03-01', to: DB.today, dept: '', customer: '', product: '' });
  return `<div class="toolbar">
      <span style="font-size:12.3px;color:var(--text-3);font-weight:600">Từ ngày</span>
      <input class="inp" type="date" data-f="${key}.from" value="${f.from}" style="width:150px" />
      <span style="font-size:12.3px;color:var(--text-3);font-weight:600">Đến ngày</span>
      <input class="inp" type="date" data-f="${key}.to" value="${f.to}" style="width:150px" />
      ${extra}
      <span class="spacer"></span>
      <button class="btn btn-sm" data-act="export-report" data-key="${key}" data-kind="excel"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button>
      <button class="btn btn-sm" data-act="export-report" data-key="${key}" data-kind="pdf"><i class="fa-solid fa-file-pdf"></i>Xuất PDF</button>
    </div>`;
}

/* ------------------------------------------------- TRUNG TÂM BÁO CÁO */
const REPORT_GROUPS = [
  { title: 'Báo cáo kinh doanh', icon: 'fa-briefcase', tone: 'blue', items: [
    { name: 'Doanh thu', desc: 'Doanh thu theo tháng, khách hàng, sản phẩm', go: 'rp-revenue', icon: 'fa-chart-line' },
    { name: 'Báo giá', desc: 'Số lượng, giá trị và tỷ lệ chốt báo giá', go: 'quotes', icon: 'fa-file-invoice-dollar' },
    { name: 'Đơn hàng', desc: 'Đơn hàng theo trạng thái và tiến độ giao', go: 'orders', icon: 'fa-cart-flatbed' },
    { name: 'Khách hàng', desc: 'Xếp hạng khách hàng theo doanh số', go: 'rp-revenue', icon: 'fa-address-book' },
  ]},
  { title: 'Báo cáo sản xuất', icon: 'fa-industry', tone: 'indigo', items: [
    { name: 'Sản lượng', desc: 'Sản lượng theo phân xưởng và công đoạn', go: 'rp-product', icon: 'fa-chart-column' },
    { name: 'Tiến độ', desc: 'Tiến độ thực tế so với kế hoạch', go: 'progress', icon: 'fa-diagram-project' },
    { name: 'Hiệu suất', desc: 'Giờ máy sử dụng / năng lực thiết kế', go: 'rp-product', icon: 'fa-gauge-high' },
    { name: 'Tỷ lệ hoàn thành', desc: 'Lệnh hoàn thành đúng hạn / trễ hạn', go: 'rp-product', icon: 'fa-circle-check' },
  ]},
  { title: 'Báo cáo kho', icon: 'fa-warehouse', tone: 'teal', items: [
    { name: 'Nhập kho', desc: 'Phiếu nhập theo nhà cung cấp', go: 'inventory', icon: 'fa-arrow-right-to-bracket' },
    { name: 'Xuất kho', desc: 'Phiếu xuất theo lệnh sản xuất', go: 'inventory', icon: 'fa-arrow-right-from-bracket' },
    { name: 'Tồn kho', desc: 'Nhập — xuất — tồn và giá trị tồn kho', go: 'rp-material', icon: 'fa-boxes-stacked' },
    { name: 'Vật tư sắp hết', desc: 'Vật tư dưới định mức tồn tối thiểu', go: 'rp-material', icon: 'fa-triangle-exclamation' },
  ]},
  { title: 'Báo cáo tài chính', icon: 'fa-coins', tone: 'green', items: [
    { name: 'Doanh thu', desc: 'Doanh thu ghi nhận theo kỳ kế toán', go: 'rp-revenue', icon: 'fa-sack-dollar' },
    { name: 'Công nợ', desc: 'Công nợ phải thu theo khách hàng', go: 'rp-revenue', icon: 'fa-file-invoice' },
    { name: 'Chi phí mua sắm', desc: 'Chi phí mua vật tư theo nhà cung cấp', go: 'rp-material', icon: 'fa-cart-shopping' },
    { name: 'Giá trị sản xuất', desc: 'Giá trị thành phẩm đã sản xuất', go: 'rp-product', icon: 'fa-industry' },
  ]},
];

Views.reports = function () {
  const revenue = DB.orders.filter((o) => o.status !== 'dh_da_huy').reduce((s, o) => s + o.total, 0);
  return `
  ${pageHead('Trung tâm báo cáo', 'Kho báo cáo kinh doanh, sản xuất, kho và tài chính', `
    <button class="btn" data-act="export-report" data-key="reports" data-kind="excel"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button>
    <button class="btn" data-act="export-report" data-key="reports" data-kind="pdf"><i class="fa-solid fa-file-pdf"></i>Xuất PDF</button>
  `)}

  ${reportFilterBar('reports', `
    ${selectFilter('reports', 'dept', DB.departments.map((d) => [d, d]), 'Tất cả phòng ban')}
    ${selectFilter('reports', 'customer', DB.customers.slice(0, 15).map((c) => [c.id, c.name]), 'Tất cả khách hàng')}
    ${selectFilter('reports', 'product', DB.products.map((p) => [p.id, p.name]), 'Tất cả sản phẩm')}`).replace('class="toolbar"', 'class="toolbar card" style="margin-bottom:14px;border-radius:var(--r-lg)"')}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Doanh thu kỳ báo cáo', fmtShort(revenue), 'fa-sack-dollar', 'green')}
    ${mkpi('Đơn hàng', DB.orders.length, 'fa-cart-flatbed', 'blue')}
    ${mkpi('Lệnh sản xuất', DB.productionOrders.length, 'fa-industry', 'indigo')}
    ${mkpi('Giá trị tồn kho', fmtShort(Q.inventoryValue()), 'fa-warehouse', 'teal')}
    ${mkpi('Chi phí mua hàng', fmtShort(DB.purchases.filter((p) => p.status !== 'mh_tu_choi').reduce((s, p) => s + p.total, 0)), 'fa-cart-shopping', 'orange')}
    ${mkpi('Công nợ phải thu', fmtShort(DB.contracts.reduce((s, c) => s + c.remain, 0)), 'fa-file-invoice', 'red')}
  </div>

  <div class="grid g-2">
    ${REPORT_GROUPS.map((g) => `
      <div class="card">
        <div class="card-head">
          <span class="mkpi-ico t-${g.tone}"><i class="fa-solid ${g.icon}"></i></span>
          <div><h3>${esc(g.title)}</h3><p>${g.items.length} báo cáo có sẵn</p></div>
        </div>
        <div class="card-body">
          <div class="grid g-2">
            ${g.items.map((it) => `
              <div class="report-card" data-act="go" data-id="${it.go}">
                <span class="rc-ico t-${g.tone}"><i class="fa-solid ${it.icon}"></i></span>
                <b>${esc(it.name)}</b>
                <span>${esc(it.desc)}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>`).join('')}
  </div>`;
};

/* --------------------------------------------------- BÁO CÁO SẢN XUẤT */
Views['rp-product'] = function () {
  const pos = DB.productionOrders;
  const done = pos.filter((p) => ['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status));
  const onTime = done.filter((p) => {
    const last = p.stages[p.stages.length - 1];
    return !last.end || last.end <= p.deadline;
  });
  const outputByProduct = {};
  pos.forEach((p) => { outputByProduct[p.productName] = (outputByProduct[p.productName] || 0) + p.qty * (Q.progress(p) / 100); });
  const topProducts = Object.entries(outputByProduct).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return `
  ${pageHead('Báo cáo sản xuất', 'Sản lượng, tiến độ, hiệu suất và tỷ lệ hoàn thành', `
    <button class="btn" data-act="go" data-id="reports"><i class="fa-solid fa-arrow-left"></i>Trung tâm báo cáo</button>
  `)}
  <div class="card" style="margin-bottom:14px">${reportFilterBar('rp-product', selectFilter('rp-product', 'product', DB.products.map((p) => [p.id, p.name]), 'Tất cả sản phẩm'))}</div>

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng lệnh SX', pos.length, 'fa-industry', 'blue')}
    ${mkpi('Đã hoàn thành', done.length, 'fa-circle-check', 'green')}
    ${mkpi('Tỷ lệ hoàn thành', Math.round((done.length / pos.length) * 100) + '%', 'fa-gauge-high', 'teal')}
    ${mkpi('Đúng hạn', done.length ? Math.round((onTime.length / done.length) * 100) + '%' : '—', 'fa-clock', 'indigo')}
    ${mkpi('Sản lượng (giờ máy)', fmtN(DB.workshops.reduce((s, w) => s + w.output, 0)), 'fa-gears', 'orange')}
    ${mkpi('Hiệu suất xưởng', Math.round((DB.workshops.reduce((s, w) => s + w.output, 0) / DB.workshops.reduce((s, w) => s + w.capacity, 0)) * 100) + '%', 'fa-bolt', 'green')}
  </div>

  <div class="grid g-2" style="margin-bottom:14px">
    <div class="card">
      <div class="card-head"><div><h3>Sản lượng theo phân xưởng</h3><p>Giờ máy thực hiện / năng lực tháng</p></div></div>
      <div class="card-body"><div class="chart-box"><canvas id="chRpWorkshop"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Sản lượng theo sản phẩm</h3><p>Quy đổi theo tiến độ thực tế của lệnh sản xuất</p></div></div>
      <div class="card-body"><div class="chart-box"><canvas id="chRpProduct"></canvas></div></div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <div><h3>Chi tiết lệnh sản xuất trong kỳ</h3><p>${pos.length} lệnh · sắp xếp theo tiến độ</p></div>
      <div class="right"><button class="btn btn-sm" data-act="export-report" data-key="rp-product" data-kind="excel"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button></div>
    </div>
    ${tableShell(
      [{ t: 'Mã LSX', w: '148px' }, { t: 'Sản phẩm' }, { t: 'Khách hàng', cls: 'hide-sm' }, { t: 'SL kế hoạch', cls: 'right' },
       { t: 'SL đã qua CĐ', cls: 'right hide-sm' }, { t: 'Công đoạn hiện tại' }, { t: 'Tiến độ', w: '150px' }, { t: 'Trạng thái', w: '130px' }],
      [...pos].sort((a, b) => Q.progress(b) - Q.progress(a)).map((p) => `
        <tr class="clickable" data-act="open-production-order" data-id="${p.id}">
          <td><span class="code">${p.id}</span></td>
          <td>${cell2(esc(p.productName), esc(p.orderId))}</td>
          <td class="hide-sm">${esc(Q.customerName(p.customerId))}</td>
          <td class="right num">${fmtN(p.qty)} ${esc(p.unit)}</td>
          <td class="right num hide-sm">${fmtN(p.stages.reduce((s, x) => s + x.qtyDone, 0))}</td>
          <td><span class="chip">${esc(currentStage(p).name)}</span></td>
          <td>${progressBar(Q.progress(p))}</td>
          <td>${badge(p.status)}</td></tr>`))}
  </div>`;
};

Views['rp-product'].after = function () {
  Charts.bar('chRpWorkshop', DB.workshops.map((w) => w.name), [
    { label: 'Thực hiện', data: DB.workshops.map((w) => w.output), color: 'blue' },
    { label: 'Năng lực', data: DB.workshops.map((w) => w.capacity), color: 'slate' },
  ]);
  const out = {};
  DB.productionOrders.forEach((p) => { out[p.productName] = (out[p.productName] || 0) + Math.round(p.qty * (Q.progress(p) / 100)); });
  const top = Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 8);
  Charts.bar('chRpProduct', top.map((t) => t[0]), [{ label: 'Sản lượng', data: top.map((t) => t[1]), color: 'indigo' }], { horizontal: true });
};

/* -------------------------------------------------- BÁO CÁO DOANH THU */
Views['rp-revenue'] = function () {
  const valid = DB.orders.filter((o) => o.status !== 'dh_da_huy');
  const revenue = valid.reduce((s, o) => s + o.total, 0);

  // Xếp hạng khách hàng
  const topCus = DB.customers.map((c) => ({ c, v: Q.revenueOf(c.id) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 10);
  // Doanh thu theo sản phẩm
  const byProduct = {};
  valid.forEach((o) => o.items.forEach((i) => { byProduct[i.name] = (byProduct[i.name] || 0) + i.amount; }));
  const topProd = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 8);
  // Công nợ
  const debtors = DB.contracts.filter((c) => c.remain > 0).sort((a, b) => b.remain - a.remain);

  return `
  ${pageHead('Báo cáo doanh thu', 'Doanh thu theo tháng, khách hàng, sản phẩm và công nợ phải thu', `
    <button class="btn" data-act="go" data-id="reports"><i class="fa-solid fa-arrow-left"></i>Trung tâm báo cáo</button>
  `)}
  <div class="card" style="margin-bottom:14px">${reportFilterBar('rp-revenue', selectFilter('rp-revenue', 'customer', DB.customers.slice(0, 20).map((c) => [c.id, c.name]), 'Tất cả khách hàng'))}</div>

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Doanh thu lũy kế', fmtShort(revenue), 'fa-sack-dollar', 'green')}
    ${mkpi('Doanh thu tháng 8', fmtShort(DB.kpi.revenueMonth), 'fa-calendar-day', 'blue')}
    ${mkpi('Giá trị TB/đơn', fmtShort(valid.length ? revenue / valid.length : 0), 'fa-scale-balanced', 'indigo')}
    ${mkpi('Khách hàng có DS', topCus.length, 'fa-address-book', 'teal')}
    ${mkpi('Công nợ phải thu', fmtShort(DB.contracts.reduce((s, c) => s + c.remain, 0)), 'fa-file-invoice', 'red')}
    ${mkpi('Tăng trưởng', '+' + DB.kpi.revenueChange.toFixed(1).replace('.', ',') + '%', 'fa-arrow-trend-up', 'green')}
  </div>

  <div class="grid g-2" style="margin-bottom:14px">
    <div class="card">
      <div class="card-head"><div><h3>Doanh thu 6 tháng gần nhất</h3><p>Đơn vị: tỷ đồng</p></div></div>
      <div class="card-body"><div class="chart-box"><canvas id="chRpRevenue"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Doanh thu theo sản phẩm</h3><p>Top 8 sản phẩm đóng góp doanh thu lớn nhất</p></div></div>
      <div class="card-body"><div class="chart-box"><canvas id="chRpProdRev"></canvas></div></div>
    </div>
  </div>

  <div class="grid g-2">
    <div class="card">
      <div class="card-head"><div><h3>Xếp hạng khách hàng</h3><p>Top 10 theo doanh số lũy kế</p></div>
        <div class="right"><button class="btn btn-sm" data-act="export-report" data-key="rp-revenue" data-kind="excel"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button></div></div>
      ${tableShell(
        [{ t: '#', cls: 'center', w: '46px' }, { t: 'Khách hàng' }, { t: 'Đơn hàng', cls: 'center' }, { t: 'Doanh số', cls: 'right' }, { t: 'Tỷ trọng', cls: 'right' }],
        topCus.map((x, i) => `<tr class="clickable" data-act="open-customer" data-id="${x.c.id}">
          <td class="center"><span class="chip" style="width:24px;justify-content:center">${i + 1}</span></td>
          <td><div style="display:flex;align-items:center;gap:9px">${avatarHTML(x.c.name)}<span>${cell2(esc(x.c.name), esc(x.c.id + ' · ' + x.c.province))}</span></div></td>
          <td class="center num">${Q.ordersOf(x.c.id).length}</td>
          <td class="right strong num">${fmtVND(x.v)}</td>
          <td class="right num">${((x.v / revenue) * 100).toFixed(1).replace('.', ',')}%</td></tr>`))}
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Công nợ phải thu</h3><p>${debtors.length} hợp đồng còn dư nợ</p></div></div>
      ${tableShell(
        [{ t: 'Hợp đồng' }, { t: 'Khách hàng' }, { t: 'Giá trị', cls: 'right' }, { t: 'Đã thu', cls: 'right hide-sm' }, { t: 'Còn lại', cls: 'right' }],
        debtors.map((c) => `<tr class="clickable" data-act="open-contract" data-id="${c.id}">
          <td><span class="code">${c.id}</span></td>
          <td>${esc(Q.customerName(c.customerId))}</td>
          <td class="right num">${fmtVND(c.value)}</td>
          <td class="right num hide-sm" style="color:var(--green)">${fmtVND(c.paid)}</td>
          <td class="right strong num" style="color:var(--orange)">${fmtVND(c.remain)}</td></tr>`))}
    </div>
  </div>`;
};

Views['rp-revenue'].after = function () {
  Charts.line('chRpRevenue', DB.revenueTrend.map((t) => t.month), DB.revenueTrend.map((t) => t.value), { label: 'Doanh thu' });
  const byProduct = {};
  DB.orders.filter((o) => o.status !== 'dh_da_huy').forEach((o) => o.items.forEach((i) => { byProduct[i.name] = (byProduct[i.name] || 0) + i.amount; }));
  const top = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 8);
  Charts.bar('chRpProdRev', top.map((t) => t[0]), [{ label: 'Doanh thu', data: top.map((t) => t[1]), color: 'green' }], { money: true, horizontal: true });
};

/* ---------------------------------------------------- BÁO CÁO VẬT TƯ */
Views['rp-material'] = function () {
  const low = Q.lowStock();
  const byGroup = {};
  DB.materials.forEach((m) => { byGroup[m.group] = (byGroup[m.group] || 0) + m.value; });
  const groups = Object.entries(byGroup).sort((a, b) => b[1] - a[1]);

  const inVal = DB.stockMoves.filter((x) => x.type === 'in').reduce((s, x) => s + x.qty * (Q.material(x.materialId)?.price || 0), 0);
  const outVal = DB.stockMoves.filter((x) => x.type === 'out').reduce((s, x) => s + x.qty * (Q.material(x.materialId)?.price || 0), 0);
  const purchaseCost = DB.purchases.filter((p) => ['mh_da_nhan', 'mh_hoan_thanh'].includes(p.status)).reduce((s, p) => s + p.total, 0);

  return `
  ${pageHead('Báo cáo vật tư', 'Nhập — xuất — tồn, giá trị tồn kho và vật tư dưới định mức', `
    <button class="btn" data-act="go" data-id="reports"><i class="fa-solid fa-arrow-left"></i>Trung tâm báo cáo</button>
  `)}
  <div class="card" style="margin-bottom:14px">${reportFilterBar('rp-material', selectFilter('rp-material', 'group', [...new Set(DB.materials.map((m) => m.group))].map((g) => [g, g]), 'Tất cả nhóm vật tư'))}</div>

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Mã vật tư', DB.materials.length, 'fa-layer-group', 'blue')}
    ${mkpi('Giá trị tồn kho', fmtShort(Q.inventoryValue()), 'fa-warehouse', 'teal')}
    ${mkpi('Giá trị nhập kỳ', fmtShort(inVal), 'fa-arrow-right-to-bracket', 'green')}
    ${mkpi('Giá trị xuất kỳ', fmtShort(outVal), 'fa-arrow-right-from-bracket', 'orange')}
    ${mkpi('Chi phí mua hàng', fmtShort(purchaseCost), 'fa-cart-shopping', 'indigo')}
    ${mkpi('Vật tư dưới định mức', low.length, 'fa-triangle-exclamation', low.length ? 'red' : 'green')}
  </div>

  <div class="grid g-2" style="margin-bottom:14px">
    <div class="card">
      <div class="card-head"><div><h3>Giá trị tồn theo nhóm vật tư</h3><p>Cơ cấu vốn nằm trong kho</p></div></div>
      <div class="card-body">
        <div class="chart-box"><canvas id="chRpMatGroup"></canvas></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Top 10 vật tư giá trị cao</h3><p>Theo giá trị tồn kho hiện tại</p></div></div>
      <div class="card-body"><div class="chart-box"><canvas id="chRpMatTop"></canvas></div></div>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px;${low.length ? 'border-left:3px solid var(--orange)' : ''}">
    <div class="card-head">
      <span class="mkpi-ico t-${low.length ? 'orange' : 'green'}"><i class="fa-solid fa-triangle-exclamation"></i></span>
      <div><h3>Vật tư cần bổ sung</h3><p>${low.length} mã đang dưới mức tồn tối thiểu</p></div>
      <div class="right"><button class="btn btn-sm btn-primary" data-act="new-pr"><i class="fa-solid fa-cart-plus"></i>Tạo yêu cầu mua</button></div>
    </div>
    ${tableShell(
      [{ t: 'Mã VT', w: '92px' }, { t: 'Tên vật tư' }, { t: 'Nhóm', cls: 'hide-sm' }, { t: 'Tồn kho', cls: 'right' },
       { t: 'Tồn tối thiểu', cls: 'right' }, { t: 'Cần bổ sung', cls: 'right' }, { t: 'NCC', cls: 'hide-sm' }, { t: 'Tình trạng', w: '118px' }],
      low.map((m) => `<tr class="clickable" data-act="open-material" data-id="${m.id}">
        <td><span class="code">${m.id}</span></td>
        <td class="strong">${esc(m.name)}</td>
        <td class="hide-sm"><span class="chip">${esc(m.group)}</span></td>
        <td class="right num">${fmtDec(m.stock, 2)} ${esc(m.unit)}</td>
        <td class="right num muted">${fmtDec(m.minStock, 2)} ${esc(m.unit)}</td>
        <td class="right strong num" style="color:var(--red)">${fmtDec(m.minStock - m.stock, 2)} ${esc(m.unit)}</td>
        <td class="hide-sm muted">${esc(Q.supplierName(m.supplier))}</td>
        <td>${badge(m.status)}</td></tr>`),
      { emptyTitle: 'Tồn kho an toàn', emptyDesc: 'Tất cả vật tư đều trên mức tồn tối thiểu.' })}
  </div>

  <div class="card">
    <div class="card-head">
      <div><h3>Bảng nhập — xuất — tồn</h3><p>Toàn bộ ${DB.materials.length} mã vật tư trong kỳ</p></div>
      <div class="right"><button class="btn btn-sm" data-act="export-report" data-key="rp-material" data-kind="excel"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button></div>
    </div>
    ${tableShell(
      [{ t: 'Mã VT', w: '92px' }, { t: 'Tên vật tư' }, { t: 'ĐVT', cls: 'center' }, { t: 'Nhập trong kỳ', cls: 'right' },
       { t: 'Xuất trong kỳ', cls: 'right' }, { t: 'Tồn cuối kỳ', cls: 'right' }, { t: 'Đơn giá', cls: 'right hide-sm' }, { t: 'Giá trị tồn', cls: 'right' }],
      DB.materials.map((m) => {
        const i = DB.stockMoves.filter((x) => x.materialId === m.id && x.type === 'in').reduce((s, x) => s + x.qty, 0);
        const o = DB.stockMoves.filter((x) => x.materialId === m.id && x.type === 'out').reduce((s, x) => s + x.qty, 0);
        return `<tr class="clickable" data-act="open-material" data-id="${m.id}">
          <td><span class="code">${m.id}</span></td>
          <td class="strong">${esc(m.name)}</td>
          <td class="center">${esc(m.unit)}</td>
          <td class="right num" style="color:${i ? 'var(--green)' : 'var(--text-3)'}">${i ? '+' + fmtN(i) : '—'}</td>
          <td class="right num" style="color:${o ? 'var(--orange)' : 'var(--text-3)'}">${o ? '−' + fmtN(o) : '—'}</td>
          <td class="right strong num">${fmtDec(m.stock, 2)}</td>
          <td class="right num hide-sm muted">${fmtVND(m.price)}</td>
          <td class="right strong num">${fmtVND(m.value)}</td></tr>`;
      }))}
  </div>`;
};

Views['rp-material'].after = function () {
  const byGroup = {};
  DB.materials.forEach((m) => { byGroup[m.group] = (byGroup[m.group] || 0) + m.value; });
  const groups = Object.entries(byGroup).sort((a, b) => b[1] - a[1]);
  Charts.donut('chRpMatGroup', groups.map((g) => g[0]), groups.map((g) => Math.round(g[1] / 1e6)),
    ['blue', 'green', 'orange', 'indigo', 'teal', 'red', 'slate', 'blue', 'green']);
  const top = [...DB.materials].sort((a, b) => b.value - a.value).slice(0, 10);
  Charts.bar('chRpMatTop', top.map((m) => m.name.length > 22 ? m.name.slice(0, 21) + '…' : m.name),
    [{ label: 'Giá trị tồn', data: top.map((m) => m.value), color: 'teal' }], { money: true, horizontal: true });
};
