/* ============================================================================
 * PHÂN HỆ QUẢN TRỊ DOANH NGHIỆP — BI (Business Intelligence)
 * --------------------------------------------------------------------------
 * Giai đoạn 1: mảng TÀI CHÍNH (tab "finance").
 * Các mảng còn lại (Kho, Sản xuất, Kinh doanh, Nhà hàng, Nhân sự, Mua hàng,
 * Chất lượng, Logistics, Phân tích chuyên sâu) chưa triển khai ở bước này —
 * router sẽ tự rơi về màn "đang phát triển" chuẩn UI của hệ thống
 * (renderPlaceholderView trong app.core.js), không cần xử lý gì thêm ở đây.
 *
 * File này CHỈ đọc dữ liệu có sẵn trong DB (data.js) — không suy diễn số
 * liệu tài chính mà hệ thống demo chưa lưu (ví dụ: không có sổ thu tiền
 * khách hàng theo từng ngày, nên "tiền vào" được ước lượng theo số tiền đã
 * thu ghi trên hợp đồng ký trong kỳ — có ghi chú rõ trong giao diện).
 * ==========================================================================*/

const BI_CONFIG = {
  financePeriods: [
    ['today', 'Hôm nay'],
    ['month', 'Tháng này'],
    ['year', 'Năm nay'],
  ],
};

/* ---------------------------------------------------------------------------
 * Lấy cấu hình tab con của phân hệ BI trực tiếp từ NAV (app.core.js) để
 * thanh tab trong trang luôn khớp với menu bên trái, không khai báo trùng.
 * -------------------------------------------------------------------------*/
function biTabsConfig() {
  const nav = NAV.flatMap((g) => g.items).find((i) => i.id === 'bi');
  return (nav?.children || []).map((c) => ({ id: 'bi', label: c.label, tab: c.tab || c.id }));
}

/* ---------------------------------------------------------------------------
 * TÍNH TOÁN SỐ LIỆU TÀI CHÍNH TỪ DB HIỆN CÓ
 * -------------------------------------------------------------------------*/
function biSum(list, pick) { return list.reduce((s, x) => s + (Number(pick(x)) || 0), 0); }

/** Đơn hàng hợp lệ để tính doanh thu (loại đơn đã hủy) */
function biRevenueOrders(filterFn) {
  return DB.orders.filter((o) => o.status !== 'dh_da_huy').filter(filterFn);
}

/** Lợi nhuận gộp của 1 đơn hàng = Σ (đơn giá − giá thành đơn vị) × số lượng từng dòng.
 *  Giá thành đơn vị đã được tính sẵn trong item.unitCost khi build đơn hàng (data.js). */
function biOrderProfit(order) {
  return (order.items || []).reduce((s, it) => s + (Number(it.profit) || 0) * Number(it.qty || 0), 0);
}

/* ---------------------------------------------------------------------------
 * DOANH THU THEO 6 TUẦN / 6 THÁNG / 6 QUÝ
 * -------------------------------------------------------------------------*/

/** Chuyển YYYY-MM-DD thành Date theo múi giờ local */
function biParseDate(dateStr) {
  if (!dateStr) return null;

  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;

  return new Date(y, m - 1, d);
}

/** Format tháng: 2026-09 */
function biMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Format quý: 2026-Q3 */
function biQuarterKey(date) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${q}`;
}

/** Lấy ngày đầu tuần, quy ước tuần bắt đầu từ Thứ 2 */
function biStartOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  const day = d.getDay(); // CN = 0, T2 = 1...
  const diff = day === 0 ? -6 : 1 - day;

  d.setDate(d.getDate() + diff);
  return d;
}

/** Key tuần dạng 2026-W38 */
function biWeekKey(date) {
  const start = biStartOfWeek(date);

  // Dùng ngày Thứ 4 của tuần để xác định ISO week/year
  const isoDate = new Date(start);
  isoDate.setDate(start.getDate() + 3);

  const firstThursday = new Date(isoDate.getFullYear(), 0, 4);
  const firstWeekStart = biStartOfWeek(firstThursday);

  const weekNo = Math.floor(
    (start - firstWeekStart) / (7 * 24 * 60 * 60 * 1000)
  ) + 1;

  return `${isoDate.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Label hiển thị cho tuần */
function biWeekLabel(date) {
  const start = biStartOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const f = (d) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

  return `${f(start)}-${f(end)}`;
}

/** Label hiển thị cho tháng */
function biMonthLabel(date) {
  return `T${date.getMonth() + 1}/${date.getFullYear()}`;
}

/** Label hiển thị cho quý */
function biQuarterLabel(date) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `Q${q}/${date.getFullYear()}`;
}

/**
 * Tạo dữ liệu biểu đồ doanh thu.
 *
 * mode:
 *   - week    = 6 tuần
 *   - month   = 6 tháng
 *   - quarter = 6 quý
 */
function biRevenueTrend(mode = 'month') {
  const today = biParseDate(DB.today) || new Date();

  const periods = [];

  if (mode === 'week') {
    const currentWeek = biStartOfWeek(today);

    for (let i = 5; i >= 0; i--) {
      const start = new Date(currentWeek);
      start.setDate(start.getDate() - i * 7);

      periods.push({
        key: biWeekKey(start),
        label: biWeekLabel(start),
        start,
        end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
      });
    }
  }

  else if (mode === 'quarter') {
    const currentQuarterMonth = Math.floor(today.getMonth() / 3) * 3;

    for (let i = 5; i >= 0; i--) {
      const start = new Date(
        today.getFullYear(),
        currentQuarterMonth - i * 3,
        1
      );

      const end = new Date(
        start.getFullYear(),
        start.getMonth() + 3,
        0
      );

      periods.push({
        key: biQuarterKey(start),
        label: biQuarterLabel(start),
        start,
        end
      });
    }
  }

  else {
    // Mặc định: 6 tháng
    const currentMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    for (let i = 5; i >= 0; i--) {
      const start = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth() - i,
        1
      );

      const end = new Date(
        start.getFullYear(),
        start.getMonth() + 1,
        0
      );

      periods.push({
        key: biMonthKey(start),
        label: biMonthLabel(start),
        start,
        end
      });
    }
  }

  const orders = biRevenueOrders(() => true);

  return periods.map((period) => {
    const value = biSum(
      orders.filter((o) => {
        const date = biParseDate(o.date);
        if (!date) return false;

        return date >= period.start && date <= period.end;
      }),
      (o) => o.subtotal
    );

    return {
      key: period.key,
      label: period.label,
      value
    };
  });
}

function biFinanceData() {
  const todayStr = DB.today;
  const monthKey = todayStr.slice(0, 7);
  const yearKey = todayStr.slice(0, 4);

  const ordersToday = biRevenueOrders((o) => o.date === todayStr);
  const ordersMonth = biRevenueOrders((o) => o.date.slice(0, 7) === monthKey);
  const ordersYear  = biRevenueOrders((o) => o.date.slice(0, 4) === yearKey);

  const revenue = {
    today: biSum(ordersToday, (o) => o.subtotal),
    month: biSum(ordersMonth, (o) => o.subtotal),
    year:  biSum(ordersYear, (o) => o.subtotal),
  };
  const profit = {
    today: biSum(ordersToday, biOrderProfit),
    month: biSum(ordersMonth, biOrderProfit),
    year:  biSum(ordersYear, biOrderProfit),
  };
  const orderCount = { today: ordersToday.length, month: ordersMonth.length, year: ordersYear.length };

  /* Dòng tiền tháng này — ước lượng từ 2 sổ đang có trong demo:
   *   + Tiền vào: số tiền đã thu ghi trên các hợp đồng KÝ trong tháng (DB.contracts.paid)
   *   - Tiền ra:  các khoản đã trả nhà cung cấp trong tháng (DB.supplierPayments) */
  const paymentsOutMonth = (DB.supplierPayments || []).filter((p) => (p.date || '').slice(0, 7) === monthKey);
  const cashOutMonth = biSum(paymentsOutMonth, (p) => p.amount);
  const contractsSignedMonth = (DB.contracts || []).filter((c) => (c.signDate || '').slice(0, 7) === monthKey);
  const cashInMonth = biSum(contractsSignedMonth, (c) => c.paid);
  const netCashMonth = cashInMonth - cashOutMonth;

  /* Công nợ phải thu — theo khách hàng còn dư nợ */
  const receivables = (DB.customers || [])
    .filter((c) => Number(c.debt) > 0)
    .sort((a, b) => b.debt - a.debt);
  const totalReceivable = biSum(receivables, (c) => c.debt);

  /* Công nợ phải trả — theo đơn đặt hàng (PO) chưa thanh toán hết */
  const payablePOs = (DB.purchaseOrders || [])
    .map((po) => ({ po, remain: Math.max(0, Number(po.total || 0) - Number(po.paid || 0)) }))
    .filter((x) => x.remain > 0)
    .sort((a, b) => b.remain - a.remain);
  const totalPayable = biSum(payablePOs, (x) => x.remain);

  /* Dòng tiền gần đây — gộp 2 sổ để hiển thị 1 danh sách theo thời gian */
  const cashMovements = [
    ...contractsSignedMonth.filter((c) => c.paid > 0).map((c) => ({
      date: c.signDate, amount: c.paid, dir: 'in',
      label: `Thu theo hợp đồng ${c.id}`, act: 'open-contract', id: c.id,
    })),
    ...paymentsOutMonth.map((p) => ({
      date: p.date, amount: p.amount, dir: 'out',
      label: `Trả NCC — ${Q.supplierName(p.supplierId)}`, act: 'supplier-detail', id: p.supplierId,
    })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return {
    monthKey, yearKey,
    revenue, profit, orderCount,
    cashInMonth, cashOutMonth, netCashMonth,
    receivables, totalReceivable,
    payablePOs, totalPayable,
    cashMovements,
  };
}

/* ---------------------------------------------------------------------------
 * GIAO DIỆN — TAB TÀI CHÍNH
 * -------------------------------------------------------------------------*/
function biFinanceView() {
  const period = State.biFinancePeriod || 'month';
  const d = biFinanceData();
  const periodLabel = { today: 'hôm nay', month: 'tháng này', year: 'năm nay' }[period];

  const periodToggle = `
    <div style="display:flex;gap:6px;background:var(--surface-2);padding:4px;border-radius:10px;border:1px solid var(--border)">
      ${BI_CONFIG.financePeriods.map(([key, label]) => `
        <button type="button" class="btn btn-sm ${period === key ? 'btn-primary' : 'btn-ghost'}" data-bi-period="${key}">${esc(label)}</button>
      `).join('')}
    </div>`;

  const kpis = `
    <div class="grid g-4" style="margin-bottom:16px">
      ${mkpi(`Doanh thu ${periodLabel}`, fmtVND(d.revenue[period]), 'fa-sack-dollar', 'blue', null,
        `${fmtN(d.orderCount[period])} đơn hàng`)}
      ${mkpi(`Lợi nhuận gộp ${periodLabel}`, fmtVND(d.profit[period]), 'fa-chart-line', 'green', null,
        d.revenue[period] ? `Biên LN ${fmtDec((d.profit[period] / d.revenue[period]) * 100, 1)}%` : '')}
      ${mkpi('Dòng tiền ròng tháng này', (d.netCashMonth >= 0 ? '+' : '') + fmtVND(d.netCashMonth), 'fa-money-bill-transfer', d.netCashMonth >= 0 ? 'green' : 'red', null,
        `Vào ${fmtShort(d.cashInMonth)} · Ra ${fmtShort(d.cashOutMonth)}`)}
      ${mkpi('Công nợ phải thu / phải trả', fmtVND(d.totalReceivable) + ' / ' + fmtVND(d.totalPayable), 'fa-scale-balanced', 'orange', null,
        `${d.receivables.length} khách hàng · ${d.payablePOs.length} đơn mua`)}
    </div>`;

  const receivableRows = d.receivables.slice(0, 8).map((c) => `
    <tr class="clickable" data-act="open-customer" data-id="${esc(c.id)}">
      <td>${cell2(esc(c.name), esc(c.id) + ' · ' + esc(c.group || ''))}</td>
      <td>${esc(c.province || '—')}</td>
      <td class="right num strong" style="color:var(--red)">${fmtVND(c.debt)}</td>
      <td class="right">${rowActions([{ act: 'open-customer', data: `data-id="${esc(c.id)}"`, icon: 'fa-arrow-right', title: 'Xem khách hàng' }])}</td>
    </tr>`);

  const payableRows = d.payablePOs.slice(0, 8).map(({ po, remain }) => `
    <tr class="clickable" data-act="open-po" data-id="${esc(po.id)}">
      <td>${cell2(`<span class="code">${esc(po.id)}</span>`, fmtDate(po.date))}</td>
      <td>${esc(Q.supplierName(po.supplierId))}</td>
      <td class="right num">${fmtVND(po.total)}</td>
      <td class="right num" style="color:var(--red)">${fmtVND(remain)}</td>
      <td>${badge(po.status)}</td>
      <td class="right">${rowActions([{ act: 'open-po', data: `data-id="${esc(po.id)}"`, icon: 'fa-arrow-right', title: 'Xem đơn mua' }])}</td>
    </tr>`);

  const cashRows = d.cashMovements.slice(0, 10).map((m) => `
    <div class="alert-item" data-act="${m.act}" data-id="${esc(m.id)}">
      <span class="alert-ico t-${m.dir === 'in' ? 'green' : 'red'}"><i class="fa-solid ${m.dir === 'in' ? 'fa-arrow-down' : 'fa-arrow-up'}"></i></span>
      <span style="min-width:0;flex:1 1 auto">
        <div class="alert-title">${esc(m.label)}</div>
        <div class="alert-sub">${fmtDate(m.date)}</div>
      </span>
      <span class="num strong" style="color:var(--${m.dir === 'in' ? 'green' : 'red'})">${m.dir === 'in' ? '+' : '−'}${fmtVND(m.amount)}</span>
    </div>`);

  return `
    ${pageHead('Tài chính', 'Doanh thu, lợi nhuận, dòng tiền và công nợ — cập nhật theo dữ liệu hệ thống hiện có', periodToggle)}
    ${moduleTabs(biTabsConfig(), 'finance')}
    ${kpis}
    <div class="grid g-21" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head">
			<div>
				<h3 id="biRevenueTrendTitle">Xu hướng doanh thu 6 tháng gần nhất</h3>
				<p id="biRevenueTrendDesc">Doanh thu thuần theo tháng (chưa VAT)</p>
			</div>

			<div style="display:flex;gap:6px;background:var(--surface-2);padding:4px;border-radius:10px;border:1px solid var(--border)">
				${[
				['week', '6 tuần'],
				['month', '6 tháng'],
				['quarter', '6 quý']
				].map(([key, label]) => `
				<button
					type="button"
					class="btn btn-sm ${((State.biRevenueTrendMode || 'month') === key) ? 'btn-primary' : 'btn-ghost'}"
					data-bi-revenue-trend="${key}">
					${label}
				</button>
				`).join('')}
			</div>
		</div>

		<div class="card-body">
			<div class="chart-box">
				<canvas id="biRevenueTrendChart"></canvas>
			</div>
		</div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Cơ cấu công nợ</h3><p>Phải thu so với phải trả</p></div></div>
        <div class="card-body"><div class="chart-box sm"><canvas id="biDebtDonutChart"></canvas></div></div>
      </div>
    </div>
    <div class="grid g-21" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><div><h3>Công nợ phải thu theo khách hàng</h3><p>Top khách hàng còn dư nợ, bấm để xem hồ sơ</p></div>
          <div class="right"><span class="chip">Tổng ${fmtVND(d.totalReceivable)}</span></div></div>
        ${tableShell(
          [{ t: 'Khách hàng' }, { t: 'Tỉnh/TP' }, { t: 'Công nợ', cls: 'right' }, { t: '', w: '48px' }],
          receivableRows, { emptyTitle: 'Không có công nợ phải thu', emptyDesc: 'Tất cả khách hàng hiện đều không còn dư nợ.' }
        )}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Công nợ phải trả theo đơn mua hàng</h3><p>Các PO chưa thanh toán hết cho nhà cung cấp</p></div>
          <div class="right"><span class="chip">Tổng ${fmtVND(d.totalPayable)}</span></div></div>
        ${tableShell(
          [{ t: 'Đơn mua' }, { t: 'Nhà cung cấp' }, { t: 'Giá trị', cls: 'right' }, { t: 'Còn nợ', cls: 'right' }, { t: 'Trạng thái' }, { t: '', w: '48px' }],
          payableRows, { emptyTitle: 'Không có công nợ phải trả', emptyDesc: 'Tất cả đơn mua hàng hiện đã thanh toán đủ.' }
        )}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Dòng tiền gần đây trong tháng</h3><p>Ghi nhận từ thanh toán hợp đồng (vào) và thanh toán nhà cung cấp (ra)</p></div></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:9px">
        ${cashRows.length ? cashRows.join('') : `<div class="empty"><div class="empty-ico"><i class="fa-solid fa-money-bill-wave"></i></div><h4>Chưa có giao dịch tiền trong tháng</h4><p>Chưa ghi nhận khoản thu hoặc chi nào trong tháng hiện tại.</p></div>`}
      </div>
    </div>`;
}

/* ---------------------------------------------------------------------------
 * TÍNH TOÁN SỐ LIỆU KHO TỪ DB HIỆN CÓ
 * -------------------------------------------------------------------------*/
function biLotDetail(lot) {
  const invRows = DB.inventory.filter((r) => r.lotId === lot.id);
  const qty = invRows.reduce((s, r) => s + Number(r.qtyOnHand || 0), 0);
  const product = Q.product(lot.productId) || Q.material(lot.productId) ||
    (DB.semiFinishedProducts || []).find((x) => x.id === lot.productId);
  const warehouseNames = [...new Set(invRows.map((r) => Q.warehouseName(r.warehouseId)))].filter(Boolean).join(', ');
  const daysLeft = Math.round((new Date(lot.expiryDate + 'T00:00:00') - new Date(DB.today + 'T00:00:00')) / 86400000);
  return { lot, product, qty, warehouseNames, daysLeft, invRow: invRows[0] };
}

function biWarehouseData(nearDays) {
  const materialsValue = Q.inventoryValue();
  const lowStock = Q.lowStock().filter((m) => m.stock > 0);
  const outOfStock = DB.materials.filter((m) => m.stock <= 0);

  const productIds = new Set(DB.products.map((p) => p.id));
  const semiIds = new Set((DB.semiFinishedProducts || []).map((p) => p.id));
  let finishedValue = 0, semiValue = 0;
  DB.inventory.forEach((row) => {
    if (productIds.has(row.productId)) {
      finishedValue += Number(row.qtyOnHand || 0) * Number(Q.product(row.productId)?.price || 0);
    } else if (semiIds.has(row.productId)) {
      const sp = (DB.semiFinishedProducts || []).find((x) => x.id === row.productId);
      semiValue += Number(row.qtyOnHand || 0) * Number(sp?.price || 0);
    }
  });
  const totalValue = materialsValue + finishedValue + semiValue;

  const nearExpiryLots = Q.nearExpiryLots(nearDays);
  const expiredLots = Q.expiredLots();
  const watchLots = [...expiredLots, ...nearExpiryLots]
    .map(biLotDetail)
    .sort((a, b) => a.lot.expiryDate.localeCompare(b.lot.expiryDate));

  const slowMoving = Q.slowMoving(30).sort((a, b) => (b.daysSinceIssue ?? 9999) - (a.daysSinceIssue ?? 9999));

  return {
    materialsValue, finishedValue, semiValue, totalValue,
    lowStock, outOfStock,
    nearExpiryLots, expiredLots, watchLots,
    slowMoving,
  };
}

/* ---------------------------------------------------------------------------
 * GIAO DIỆN — TAB KHO
 * -------------------------------------------------------------------------*/
function biWarehouseView() {
  const nearDays = State.biWarehouseNearDays || 15;
  const d = biWarehouseData(nearDays);

  const nearDaysToggle = `
    <div style="display:flex;gap:6px;background:var(--surface-2);padding:4px;border-radius:10px;border:1px solid var(--border)">
      ${[7, 15, 30].map((n) => `
        <button type="button" class="btn btn-sm ${nearDays === n ? 'btn-primary' : 'btn-ghost'}" data-bi-near-days="${n}">≤ ${n} ngày</button>
      `).join('')}
    </div>`;

  const kpis = `
    <div class="grid g-4" style="margin-bottom:16px">
      ${mkpi('Tổng giá trị tồn kho', fmtVND(d.totalValue), 'fa-warehouse', 'blue', null,
        `NL ${fmtShort(d.materialsValue)} · BTP ${fmtShort(d.semiValue)} · TP ${fmtShort(d.finishedValue)}`)}
      ${mkpi('Vật tư cần bổ sung', fmtN(d.lowStock.length + d.outOfStock.length), 'fa-triangle-exclamation', 'orange', null,
        `${fmtN(d.lowStock.length)} sắp hết · ${fmtN(d.outOfStock.length)} hết hàng`)}
      ${mkpi(`Lô cận hạn / hết hạn`, fmtN(d.nearExpiryLots.length) + ' / ' + fmtN(d.expiredLots.length), 'fa-calendar-xmark', 'red', null,
        `Trong ${nearDays} ngày tới`)}
      ${mkpi('Hàng chậm luân chuyển', fmtN(d.slowMoving.length), 'fa-hourglass-half', 'slate', null,
        'Không phát sinh xuất > 30 ngày')}
    </div>`;

  const watchRows = d.watchLots.slice(0, 10).map(({ lot, product, qty, warehouseNames, daysLeft, invRow }) => `
    <tr class="clickable" data-act="inv-stock-lot-view" data-productid="${esc(lot.productId)}" data-lotid="${esc(lot.id)}">
      <td>${cell2(esc(product?.name || lot.productId), `${esc(lot.lotNumber)} · ${esc(warehouseNames || '—')}`)}</td>
      <td class="right num">${fmtDec(qty, 2)} ${esc(invRow?.unit || product?.unit || '')}</td>
      <td class="right num">${fmtDate(lot.expiryDate)}</td>
      <td>${daysLeft < 0
        ? `<span class="badge red">Hết hạn ${fmtN(Math.abs(daysLeft))} ngày</span>`
        : `<span class="badge orange">Còn ${fmtN(daysLeft)} ngày</span>`}</td>
      <td class="right">${rowActions([{ act: 'inv-stock-lot-view', data: `data-productid="${esc(lot.productId)}" data-lotid="${esc(lot.id)}"`, icon: 'fa-arrow-right', title: 'Xem lô hàng' }])}</td>
    </tr>`);

  const restockRows = [...d.outOfStock, ...d.lowStock].slice(0, 10).map((m) => `
    <tr class="clickable" data-act="open-material" data-id="${esc(m.id)}">
      <td>${cell2(esc(m.name), esc(m.id) + ' · ' + esc(m.group || ''))}</td>
      <td class="right num">${fmtDec(m.stock, 2)} ${esc(m.unit)}</td>
      <td class="right num">${fmtDec(m.minStock, 2)} ${esc(m.unit)}</td>
      <td>${badge(m.status)}</td>
      <td class="right">${rowActions([{ act: 'open-material', data: `data-id="${esc(m.id)}"`, icon: 'fa-arrow-right', title: 'Xem vật tư' }])}</td>
    </tr>`);

  const slowRows = d.slowMoving.slice(0, 10).map(({ material, lastIssueDate, daysSinceIssue }) => `
    <tr class="clickable" data-act="open-material" data-id="${esc(material.id)}">
      <td>${cell2(esc(material.name), esc(material.id) + ' · ' + esc(material.group || ''))}</td>
      <td class="right num">${fmtDec(material.stock, 2)} ${esc(material.unit)}</td>
      <td class="right num">${lastIssueDate ? fmtDate(lastIssueDate) : 'Chưa từng xuất'}</td>
      <td class="right num strong">${daysSinceIssue == null ? '—' : fmtN(daysSinceIssue) + ' ngày'}</td>
      <td class="right">${rowActions([{ act: 'open-material', data: `data-id="${esc(material.id)}"`, icon: 'fa-arrow-right', title: 'Xem vật tư' }])}</td>
    </tr>`);

  return `
    ${pageHead('Kho', 'Giá trị tồn kho, hàng cận hạn và hàng chậm luân chuyển — cập nhật theo dữ liệu hệ thống hiện có', nearDaysToggle)}
    ${moduleTabs(biTabsConfig(), 'warehouse')}
    ${kpis}
    <div class="grid g-21" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><div><h3>Giá trị tồn kho theo nhóm</h3><p>Nguyên liệu · Bán thành phẩm · Thành phẩm</p></div></div>
        <div class="card-body"><div class="chart-box"><canvas id="biWarehouseValueChart"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Trạng thái tồn vật tư</h3><p>Đủ tồn · Sắp hết · Hết hàng</p></div></div>
        <div class="card-body"><div class="chart-box sm"><canvas id="biMaterialStatusDonut"></canvas></div></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h3>Lô cận hạn / đã hết hạn</h3><p>Ưu tiên xử lý theo hạn dùng gần nhất (FEFO)</p></div>
        <div class="right"><span class="chip">${fmtN(d.watchLots.length)} lô cần chú ý</span></div></div>
      ${tableShell(
        [{ t: 'Sản phẩm / Lô' }, { t: 'Số lượng', cls: 'right' }, { t: 'Hạn dùng', cls: 'right' }, { t: 'Tình trạng' }, { t: '', w: '48px' }],
        watchRows, { emptyTitle: 'Không có lô nào cận hạn hoặc hết hạn', emptyDesc: `Không có lô nào hết hạn trong ${nearDays} ngày tới.` }
      )}
    </div>
    <div class="grid g-21">
      <div class="card">
        <div class="card-head"><div><h3>Vật tư cần bổ sung</h3><p>Sắp hết hoặc đã hết hàng</p></div></div>
        ${tableShell(
          [{ t: 'Vật tư' }, { t: 'Tồn hiện tại', cls: 'right' }, { t: 'Tồn tối thiểu', cls: 'right' }, { t: 'Trạng thái' }, { t: '', w: '48px' }],
          restockRows, { emptyTitle: 'Vật tư đang đủ tồn', emptyDesc: 'Không có vật tư nào dưới định mức tồn tối thiểu.' }
        )}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Hàng chậm luân chuyển</h3><p>Vật tư không phát sinh xuất kho hơn 30 ngày</p></div></div>
        ${tableShell(
          [{ t: 'Vật tư' }, { t: 'Tồn hiện tại', cls: 'right' }, { t: 'Lần xuất gần nhất', cls: 'right' }, { t: 'Số ngày', cls: 'right' }, { t: '', w: '48px' }],
          slowRows, { emptyTitle: 'Không có hàng chậm luân chuyển', emptyDesc: 'Mọi vật tư đều đã phát sinh xuất kho trong 30 ngày qua.' }
        )}
      </div>
    </div>`;
}


/* ---------------------------------------------------------------------------
 * TÍNH TOÁN SỐ LIỆU SẢN XUẤT TỪ DB HIỆN CÓ
 * -------------------------------------------------------------------------*/
function biPoCompletionDate(po) {
  const last = po.stages[po.stages.length - 1];
  return last?.end || po.deadline;
}

function biProductionData() {
  const monthKey = DB.today.slice(0, 7);
  const allPOs = DB.productionOrders;
  const completedPOs = allPOs.filter((p) => p.status === 'lsx_hoan_thanh');
  const activePOs = allPOs.filter((p) => p.status !== 'lsx_hoan_thanh');
  const lateOrders = Q.lateProduction();

  const completedThisMonth = completedPOs.filter((p) => (biPoCompletionDate(p) || '').slice(0, 7) === monthKey);
  const outputMonth = biSum(completedThisMonth, (p) => p.qty);

  /* Hiệu suất dây chuyền — dùng sản lượng/công suất theo tháng đã có sẵn trong DB.workshops
   * (dữ liệu tổng hợp do phòng sản xuất báo cáo, không suy diễn thêm). */
  const workshopOutput = biSum(DB.workshops, (w) => w.output);
  const workshopCapacity = biSum(DB.workshops, (w) => w.capacity);
  const efficiencyPct = workshopCapacity ? (workshopOutput / workshopCapacity) * 100 : 0;

  /* Hao hụt — tỷ lệ số lượng không đạt QC trên tổng số lượng đã nghiệm thu của mọi lệnh sản xuất. */
  const qcPassTotal = biSum(allPOs, (p) => p.qcPass);
  const qcFailTotal = biSum(allPOs, (p) => p.qcFail);
  const scrapRate = (qcPassTotal + qcFailTotal) ? (qcFailTotal / (qcPassTotal + qcFailTotal)) * 100 : 0;

  const statusCounts = {};
  allPOs.forEach((p) => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1; });

  const byProduct = {};
  completedPOs.forEach((p) => {
    const row = (byProduct[p.productId] ||= { productId: p.productId, name: p.productName, unit: p.unit, qty: 0, count: 0 });
    row.qty += p.qty;
    row.count += 1;
  });
  const topProducts = Object.values(byProduct).sort((a, b) => b.qty - a.qty);
  const totalCompletedQty = biSum(topProducts, (x) => x.qty);

  const runningPOs = activePOs
    .map((p) => ({ po: p, progress: Q.progress(p) }))
    .sort((a, b) => b.progress - a.progress);

  return {
    monthKey, outputMonth, completedThisMonth,
    workshopOutput, workshopCapacity, efficiencyPct,
    qcPassTotal, qcFailTotal, scrapRate,
    statusCounts, topProducts, totalCompletedQty,
    runningPOs, lateOrders,
  };
}

/* ---------------------------------------------------------------------------
 * GIAO DIỆN — TAB SẢN XUẤT
 * -------------------------------------------------------------------------*/
function biProductionView() {
  const d = biProductionData();

  const kpis = `
    <div class="grid g-4" style="margin-bottom:16px">
      ${mkpi('Sản lượng hoàn thành tháng này', fmtN(d.outputMonth), 'fa-boxes-packing', 'blue', null,
        `${fmtN(d.completedThisMonth.length)} lệnh sản xuất`)}
      ${mkpi('Hiệu suất dây chuyền', fmtDec(d.efficiencyPct, 1) + '%', 'fa-gauge-high', d.efficiencyPct >= 90 ? 'green' : d.efficiencyPct >= 75 ? 'orange' : 'red', null,
        `${fmtN(d.workshopOutput)}/${fmtN(d.workshopCapacity)} mẻ sản xuất trong tháng`)}
      ${mkpi('Tỷ lệ hao hụt (không đạt QC)', fmtDec(d.scrapRate, 2) + '%', 'fa-triangle-exclamation', d.scrapRate > 2 ? 'red' : 'orange', null,
        `${fmtN(d.qcFailTotal)} / ${fmtN(d.qcPassTotal + d.qcFailTotal)} sản lượng không đạt`)}
      ${mkpi('Lệnh trễ hạn / sắp trễ', fmtN(d.lateOrders.length), 'fa-clock', 'red', null,
        'Còn ≤ 5 ngày tới deadline hoặc đã quá hạn')}
    </div>`;

  const runningRows = d.runningPOs.slice(0, 8).map(({ po, progress }) => `
    <tr class="clickable" data-bi-po-id="${esc(po.id)}">
      <td>${cell2(`<span class="code">${esc(po.id)}</span> ${esc(po.productName)}`, `${fmtN(po.qty)} ${esc(po.unit)} · ${esc(Q.customerName(po.customerId))}`)}</td>
      <td>${progressBar(progress)}</td>
      <td>${badge(po.status)}</td>
      <td class="right num">${fmtDate(po.deadline)}</td>
      <td class="right">${rowActions([{ act: '', icon: 'fa-arrow-right', title: 'Xem lệnh sản xuất' }])}</td>
    </tr>`);

  const lateRows = d.lateOrders.slice(0, 8).map((po) => {
    const diff = daysTo(po.deadline);
    return `
    <tr class="clickable" data-bi-po-id="${esc(po.id)}">
      <td>${cell2(`<span class="code">${esc(po.id)}</span> ${esc(po.productName)}`, `${fmtN(po.qty)} ${esc(po.unit)} · ${Q.progress(po)}% hoàn thành`)}</td>
      <td class="right num">${fmtDate(po.deadline)}</td>
      <td>${diff < 0 ? `<span class="badge red">Trễ ${fmtN(Math.abs(diff))} ngày</span>` : `<span class="badge orange">Còn ${fmtN(diff)} ngày</span>`}</td>
      <td class="right">${rowActions([{ act: '', icon: 'fa-arrow-right', title: 'Xem lệnh sản xuất' }])}</td>
    </tr>`;
  });

  const productRows = d.topProducts.slice(0, 8).map((x) => `
    <tr class="clickable" data-act="pf-bom-view" data-id="${esc(x.productId)}">
      <td>${cell2(esc(x.name), esc(x.productId))}</td>
      <td class="right num">${fmtN(x.count)}</td>
      <td class="right num strong">${fmtN(x.qty)} ${esc(x.unit)}</td>
      <td class="right num">${d.totalCompletedQty ? fmtDec((x.qty / d.totalCompletedQty) * 100, 1) : 0}%</td>
      <td class="right">${rowActions([{ act: 'pf-bom-view', data: `data-id="${esc(x.productId)}"`, icon: 'fa-arrow-right', title: 'Xem BOM / Định mức' }])}</td>
    </tr>`);

  return `
    ${pageHead('Sản xuất', 'Sản lượng, hao hụt và hiệu suất dây chuyền — cập nhật theo dữ liệu hệ thống hiện có')}
    ${moduleTabs(biTabsConfig(), 'production')}
    ${kpis}
    <div class="grid g-21" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><div><h3>Sản lượng theo dây chuyền</h3><p>So sánh sản lượng thực tế với công suất trong tháng</p></div></div>
        <div class="card-body"><div class="chart-box"><canvas id="biWorkshopChart"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Cơ cấu lệnh sản xuất theo trạng thái</h3><p>Toàn bộ lệnh sản xuất hiện có</p></div></div>
        <div class="card-body"><div class="chart-box sm"><canvas id="biProductionStatusDonut"></canvas></div></div>
      </div>
    </div>
    <div class="grid g-21" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><div><h3>Lệnh sản xuất đang chạy</h3><p>Sắp theo tiến độ hoàn thành giảm dần</p></div></div>
        ${tableShell(
          [{ t: 'Lệnh sản xuất' }, { t: 'Tiến độ', w: '160px' }, { t: 'Trạng thái' }, { t: 'Deadline', cls: 'right' }, { t: '', w: '48px' }],
          runningRows, { emptyTitle: 'Không có lệnh đang chạy', emptyDesc: 'Tất cả lệnh sản xuất hiện đều đã hoàn thành hoặc chưa bắt đầu.' }
        )}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Lệnh trễ hạn / sắp trễ</h3><p>Deadline trong 5 ngày tới hoặc đã quá hạn</p></div></div>
        ${tableShell(
          [{ t: 'Lệnh sản xuất' }, { t: 'Deadline', cls: 'right' }, { t: 'Tình trạng' }, { t: '', w: '48px' }],
          lateRows, { emptyTitle: 'Không có lệnh trễ hạn', emptyDesc: 'Mọi lệnh sản xuất đều đang bám sát tiến độ.' }
        )}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Sản lượng theo thành phẩm</h3><p>Tổng hợp từ các lệnh sản xuất đã hoàn thành</p></div>
        <div class="right"><span class="chip">Tổng ${fmtN(d.totalCompletedQty)}</span></div></div>
      ${tableShell(
        [{ t: 'Thành phẩm' }, { t: 'Số lệnh', cls: 'right' }, { t: 'Sản lượng', cls: 'right' }, { t: 'Tỷ trọng', cls: 'right' }, { t: '', w: '48px' }],
        productRows, { emptyTitle: 'Chưa có lệnh sản xuất hoàn thành', emptyDesc: 'Chưa có dữ liệu sản lượng theo thành phẩm.' }
      )}
    </div>`;
}

/* ---------------------------------------------------------------------------
 * TÍNH TOÁN SỐ LIỆU KINH DOANH TỪ DB HIỆN CÓ
 * -------------------------------------------------------------------------*/
function biSalesInPeriod(dateStr, period, monthKey, yearKey) {
  if (!dateStr) return false;
  if (period === 'month') return dateStr.slice(0, 7) === monthKey;
  if (period === 'year') return dateStr.slice(0, 4) === yearKey;
  return true; // 'all'
}

function biSalesData(period) {
  const monthKey = DB.today.slice(0, 7);
  const yearKey = DB.today.slice(0, 4);
  const inPeriod = (dateStr) => biSalesInPeriod(dateStr, period, monthKey, yearKey);

  const orders = DB.orders.filter((o) => o.status !== 'dh_da_huy' && inPeriod(o.date));
  const revenueTotal = biSum(orders, (o) => o.subtotal);
  const orderCount = orders.length;
  const aov = orderCount ? revenueTotal / orderCount : 0;
  const newCustomers = (DB.customers || []).filter((c) => inPeriod(c.since));

  const byCustomer = {};
  orders.forEach((o) => {
    const row = (byCustomer[o.customerId] ||= { customerId: o.customerId, revenue: 0, orders: 0 });
    row.revenue += o.subtotal;
    row.orders += 1;
  });
  const topCustomers = Object.values(byCustomer)
    .map((r) => ({ ...r, customer: Q.customer(r.customerId) }))
    .filter((r) => r.customer)
    .sort((a, b) => b.revenue - a.revenue);

  const byProduct = {};
  orders.forEach((o) => {
    (o.items || []).forEach((it) => {
      const row = (byProduct[it.productId] ||= { productId: it.productId, name: it.name, unit: it.unit, qty: 0, revenue: 0 });
      row.qty += it.qty;
      row.revenue += it.amount;
    });
  });
  const topProducts = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue);

  const byProvince = {};
  orders.forEach((o) => {
    const c = Q.customer(o.customerId);
    const province = c?.province || 'Không xác định';
    const row = (byProvince[province] ||= { province, revenue: 0, customerIds: new Set() });
    row.revenue += o.subtotal;
    row.customerIds.add(o.customerId);
  });
  const topProvinces = Object.values(byProvince)
    .map((r) => ({ province: r.province, revenue: r.revenue, customers: r.customerIds.size }))
    .sort((a, b) => b.revenue - a.revenue);

  return { period, monthKey, yearKey, revenueTotal, orderCount, aov, newCustomers, topCustomers, topProducts, topProvinces };
}

/* ---------------------------------------------------------------------------
 * GIAO DIỆN — TAB KINH DOANH
 * -------------------------------------------------------------------------*/
function biSalesView() {
  const period = State.biSalesPeriod || 'month';
  const d = biSalesData(period);

  const periodOptions = [['month', 'Tháng này'], ['year', 'Năm nay'], ['all', 'Toàn bộ']];
  const periodToggle = `
    <div style="display:flex;gap:6px;background:var(--surface-2);padding:4px;border-radius:10px;border:1px solid var(--border)">
      ${periodOptions.map(([key, label]) => `
        <button type="button" class="btn btn-sm ${period === key ? 'btn-primary' : 'btn-ghost'}" data-bi-sales-period="${key}">${esc(label)}</button>
      `).join('')}
    </div>`;

  const kpis = `
    <div class="grid g-4" style="margin-bottom:16px">
      ${mkpi('Doanh thu kỳ đã chọn', fmtVND(d.revenueTotal), 'fa-chart-column', 'blue', null,
        `${fmtN(d.orderCount)} đơn hàng`)}
      ${mkpi('Giá trị đơn hàng trung bình', fmtVND(d.aov), 'fa-receipt', 'indigo', null, '')}
      ${mkpi('Khách hàng phát sinh doanh thu', fmtN(d.topCustomers.length), 'fa-users', 'green', null,
        `trên tổng ${fmtN(DB.customers.length)} khách hàng`)}
      ${mkpi('Khách hàng mới trong kỳ', fmtN(d.newCustomers.length), 'fa-user-plus', 'orange', null,
        'Theo ngày bắt đầu hợp tác')}
    </div>`;

  const customerRows = d.topCustomers.slice(0, 10).map((r, i) => `
    <tr class="clickable" data-act="open-customer" data-id="${esc(r.customerId)}">
      <td class="num muted">${i + 1}</td>
      <td>${cell2(esc(r.customer.name), esc(r.customerId) + ' · ' + esc(r.customer.group || ''))}</td>
      <td class="right num">${fmtN(r.orders)}</td>
      <td class="right num strong">${fmtVND(r.revenue)}</td>
      <td class="right num">${d.revenueTotal ? fmtDec((r.revenue / d.revenueTotal) * 100, 1) : 0}%</td>
      <td class="right">${rowActions([{ act: 'open-customer', data: `data-id="${esc(r.customerId)}"`, icon: 'fa-arrow-right', title: 'Xem khách hàng' }])}</td>
    </tr>`);

  const productRows = d.topProducts.slice(0, 10).map((r, i) => `
    <tr class="clickable" data-act="pf-bom-view" data-id="${esc(r.productId)}">
      <td class="num muted">${i + 1}</td>
      <td>${cell2(esc(r.name), esc(r.productId))}</td>
      <td class="right num">${fmtN(r.qty)} ${esc(r.unit)}</td>
      <td class="right num strong">${fmtVND(r.revenue)}</td>
      <td class="right num">${d.revenueTotal ? fmtDec((r.revenue / d.revenueTotal) * 100, 1) : 0}%</td>
      <td class="right">${rowActions([{ act: 'pf-bom-view', data: `data-id="${esc(r.productId)}"`, icon: 'fa-arrow-right', title: 'Xem BOM / Định mức' }])}</td>
    </tr>`);

  const provinceRows = d.topProvinces.slice(0, 8).map((r, i) => `
    <tr>
      <td class="num muted">${i + 1}</td>
      <td>${esc(r.province)}</td>
      <td class="right num">${fmtN(r.customers)}</td>
      <td class="right num strong">${fmtVND(r.revenue)}</td>
      <td class="right num">${d.revenueTotal ? fmtDec((r.revenue / d.revenueTotal) * 100, 1) : 0}%</td>
    </tr>`);

  return `
    ${pageHead('Kinh doanh', 'Top khách hàng, sản phẩm và khu vực — cập nhật theo dữ liệu hệ thống hiện có', periodToggle)}
    ${moduleTabs(biTabsConfig(), 'sales')}
    ${kpis}
    <div class="grid g-21" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><div><h3>Top 5 khách hàng theo doanh thu</h3><p>Trong kỳ đã chọn</p></div></div>
        <div class="card-body"><div class="chart-box"><canvas id="biTopCustomersChart"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Cơ cấu doanh thu theo khu vực</h3><p>Top 5 tỉnh/thành, phần còn lại gộp "Khác"</p></div></div>
        <div class="card-body"><div class="chart-box sm"><canvas id="biTopProvinceDonut"></canvas></div></div>
      </div>
    </div>
    <div class="grid g-21" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><div><h3>Top khách hàng theo doanh thu</h3><p>Bấm để xem hồ sơ khách hàng</p></div></div>
        ${tableShell(
          [{ t: '#', w: '32px' }, { t: 'Khách hàng' }, { t: 'Số đơn', cls: 'right' }, { t: 'Doanh thu', cls: 'right' }, { t: 'Tỷ trọng', cls: 'right' }, { t: '', w: '48px' }],
          customerRows, { emptyTitle: 'Chưa có doanh thu trong kỳ', emptyDesc: 'Không có đơn hàng nào trong khoảng thời gian đã chọn.' }
        )}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Top sản phẩm theo doanh thu</h3><p>Bấm để xem BOM / định mức</p></div></div>
        ${tableShell(
          [{ t: '#', w: '32px' }, { t: 'Sản phẩm' }, { t: 'Sản lượng bán', cls: 'right' }, { t: 'Doanh thu', cls: 'right' }, { t: 'Tỷ trọng', cls: 'right' }, { t: '', w: '48px' }],
          productRows, { emptyTitle: 'Chưa có sản phẩm bán ra trong kỳ', emptyDesc: 'Không có dòng hàng nào trong khoảng thời gian đã chọn.' }
        )}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Top khu vực theo doanh thu</h3><p>Tổng hợp theo tỉnh/thành của khách hàng</p></div></div>
      ${tableShell(
        [{ t: '#', w: '32px' }, { t: 'Tỉnh/TP' }, { t: 'Số khách hàng', cls: 'right' }, { t: 'Doanh thu', cls: 'right' }, { t: 'Tỷ trọng', cls: 'right' }],
        provinceRows, { emptyTitle: 'Chưa có dữ liệu khu vực', emptyDesc: 'Không có đơn hàng nào trong khoảng thời gian đã chọn.' }
      )}
    </div>`;
}

/* ---------------------------------------------------------------------------
 * TÍNH TOÁN SỐ LIỆU NHÀ HÀNG TỪ DB HIỆN CÓ
 * -------------------------------------------------------------------------*/
/** Giá vốn nguyên liệu cho 1 phần món, tính từ recipe.items (BOM của món ăn) */
function biRecipeUnitCost(recipe) {
  return (recipe.items || []).reduce((s, it) => { const item=Q.material(it.materialId)||Q.product(it.materialId); return s + Number(it.quantity || 0) * Number(item?.price || item?.cost || 0); }, 0);
}

/** Chi phí nhân công ƯỚC TÍNH cho các đơn của 1 cửa hàng: hệ thống demo chưa có
 *  bảng chấm công/lương theo từng cửa hàng, nên số này được suy ra từ dữ liệu
 *  thật đang có — lương tháng của nhân viên (DB.employees.salary) chia cho số
 *  công chuẩn (26 ngày) — nhân với số NGÀY CÔNG thực tế mà nhân viên đó xuất
 *  hiện trên phiếu bán hàng (POS) của cửa hàng. Không phải số liệu chấm công
 *  thực tế, chỉ là ước lượng theo phương pháp phân bổ lương phổ biến. */
function biLaborCostEstimate(storeOrders) {
  const workDays = new Set();
  storeOrders.forEach((o) => { if (o.employeeId && o.date) workDays.add(o.employeeId + '|' + o.date); });
  let cost = 0;
  workDays.forEach((key) => {
    const emp = Q.employee(key.split('|')[0]);
    if (emp) cost += (Number(emp.salary) || 0) / 26;
  });
  return { cost, workDays: workDays.size };
}

function biRestaurantData() {
  const stores = DB.stores || [];
  // Doanh thu BI chỉ ghi nhận đơn đã thanh toán thật trên server.
  const orders = (DB.posOrders || []).filter(o => o.status === 'PAID');

  const perStore = stores.map((store) => {
    const storeOrders = orders.filter((o) => o.storeId === store.id);
    let revenue = 0, foodCost = 0;
    storeOrders.forEach((o) => {
      (o.items || []).forEach((it) => {
        const recipe = (DB.restaurantRecipes || []).find((r) => r.id === it.recipeId);
        revenue += Number(it.quantity || 0) * Number(it.price || 0);
        if (recipe) foodCost += Number(it.quantity || 0) * biRecipeUnitCost(recipe);
      });
    });
    const labor = biLaborCostEstimate(storeOrders);
    const primeCost = foodCost + labor.cost;
    return {
      store, orderCount: storeOrders.length, revenue, foodCost,
      foodCostPct: revenue ? (foodCost / revenue) * 100 : 0,
      laborCost: labor.cost, laborDays: labor.workDays,
      laborCostPct: revenue ? (labor.cost / revenue) * 100 : 0,
      primeCost, primeCostPct: revenue ? (primeCost / revenue) * 100 : 0,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = biSum(perStore, (x) => x.revenue);
  const totalFoodCost = biSum(perStore, (x) => x.foodCost);
  const totalLaborCost = biSum(perStore, (x) => x.laborCost);
  const totalPrimeCost = totalFoodCost + totalLaborCost;

  const byRecipe = {};
  orders.forEach((o) => (o.items || []).forEach((it) => {
    const recipe = (DB.restaurantRecipes || []).find((r) => r.id === it.recipeId);
    const row = (byRecipe[it.recipeId] ||= { recipeId: it.recipeId, name: recipe?.name || it.recipeId, unit: recipe?.unit || '', qty: 0, revenue: 0, cost: 0 });
    row.qty += it.quantity;
    row.revenue += it.quantity * it.price;
    if (recipe) row.cost += it.quantity * biRecipeUnitCost(recipe);
  }));
  const topRecipes = Object.values(byRecipe).sort((a, b) => b.revenue - a.revenue);

  return {
    perStore, totalRevenue, totalFoodCost, totalLaborCost, totalPrimeCost,
    foodCostPct: totalRevenue ? (totalFoodCost / totalRevenue) * 100 : 0,
    laborCostPct: totalRevenue ? (totalLaborCost / totalRevenue) * 100 : 0,
    primeCostPct: totalRevenue ? (totalPrimeCost / totalRevenue) * 100 : 0,
    topRecipes, orderCount: orders.length,
  };
}

/* ---------------------------------------------------------------------------
 * GIAO DIỆN — TAB NHÀ HÀNG
 * -------------------------------------------------------------------------*/
function biRestaurantView() {
  const d = biRestaurantData();

  const kpis = `
    <div class="grid g-4" style="margin-bottom:16px">
      ${mkpi('Doanh thu nhà hàng', fmtVND(d.totalRevenue), 'fa-utensils', 'blue', null,
        `${fmtN(d.orderCount)} đơn · ${fmtN(d.perStore.length)} cửa hàng`)}
      ${mkpi('Food Cost', fmtDec(d.foodCostPct, 1) + '%', d.foodCostPct <= 32 ? 'green' : d.foodCostPct <= 38 ? 'orange' : 'red', null,
        fmtVND(d.totalFoodCost))}
      ${mkpi('Labor Cost (ước tính)', fmtDec(d.laborCostPct, 1) + '%', d.laborCostPct <= 30 ? 'green' : d.laborCostPct <= 35 ? 'orange' : 'red', null,
        fmtVND(d.totalLaborCost))}
      ${mkpi('Prime Cost', fmtDec(d.primeCostPct, 1) + '%', d.primeCostPct <= 65 ? 'green' : d.primeCostPct <= 75 ? 'orange' : 'red', null,
        fmtVND(d.totalPrimeCost))}
    </div>
    <div class="alert info" style="margin-bottom:16px;font-size:12.3px">
      <i class="fa-solid fa-circle-info"></i>
      <span>Doanh thu chỉ lấy đơn đã thanh toán trên server. Food Cost tính trực tiếp từ định mức nguyên liệu/thành phẩm và đơn giá hiện tại. Labor Cost hiện chưa có bảng chấm công theo cửa hàng, nên được <b>ước tính</b> bằng lương tháng của nhân viên (÷ 26 ngày công) nhân với số ngày nhân viên đó có phát sinh bán hàng tại cửa hàng — không phải số liệu chấm công thực tế.</span>
    </div>`;

  const storeRows = d.perStore.map((x) => `
    <tr class="clickable" data-act="restaurant-store-view" data-id="${esc(x.store.id)}">
      <td>${cell2(esc(x.store.name), esc(x.store.code) + ' · ' + esc(x.store.address || ''))}</td>
      <td class="right num">${fmtN(x.orderCount)}</td>
      <td class="right num strong">${fmtVND(x.revenue)}</td>
      <td class="right num">${fmtDec(x.foodCostPct, 1)}%</td>
      <td class="right num">${fmtDec(x.laborCostPct, 1)}%</td>
      <td class="right num strong">${fmtDec(x.primeCostPct, 1)}%</td>
      <td class="right">${rowActions([{ act: 'restaurant-store-view', data: `data-id="${esc(x.store.id)}"`, icon: 'fa-arrow-right', title: 'Xem chi nhánh' }])}</td>
    </tr>`);

  const recipeRows = d.topRecipes.slice(0, 10).map((r) => `
    <tr class="clickable" data-act="restaurant-recipe-view" data-id="${esc(r.recipeId)}">
      <td>${cell2(esc(r.name), esc(r.recipeId))}</td>
      <td class="right num">${fmtN(r.qty)} ${esc(r.unit)}</td>
      <td class="right num strong">${fmtVND(r.revenue)}</td>
      <td class="right num">${r.revenue ? fmtDec((r.cost / r.revenue) * 100, 1) : 0}%</td>
      <td class="right">${rowActions([{ act: 'restaurant-recipe-view', data: `data-id="${esc(r.recipeId)}"`, icon: 'fa-arrow-right', title: 'Xem công thức món' }])}</td>
    </tr>`);

  return `
    ${pageHead('Nhà hàng', 'Doanh thu từng cửa hàng, Food Cost, Labor Cost và Prime Cost — cập nhật theo dữ liệu hệ thống hiện có')}
    ${moduleTabs(biTabsConfig(), 'restaurant')}
    ${kpis}
    <div class="grid g-21" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><div><h3>Doanh thu theo cửa hàng</h3><p>Tổng hợp từ các đơn đã thanh toán trên server</p></div></div>
        <div class="card-body"><div class="chart-box"><canvas id="biStoreRevenueChart"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Cơ cấu chi phí trên doanh thu</h3><p>Food Cost · Labor Cost · Lợi nhuận còn lại</p></div></div>
        <div class="card-body"><div class="chart-box sm"><canvas id="biCostBreakdownDonut"></canvas></div></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h3>Hiệu quả theo cửa hàng</h3><p>Bấm dòng để xem chi tiết chi nhánh</p></div></div>
      ${tableShell(
        [{ t: 'Cửa hàng' }, { t: 'Số đơn', cls: 'right' }, { t: 'Doanh thu', cls: 'right' }, { t: 'Food Cost', cls: 'right' }, { t: 'Labor Cost', cls: 'right' }, { t: 'Prime Cost', cls: 'right' }, { t: '', w: '48px' }],
        storeRows, { emptyTitle: 'Chưa có cửa hàng', emptyDesc: 'Hệ thống chưa khai báo chi nhánh nhà hàng nào.' }
      )}
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Top món theo doanh thu</h3><p>Bấm để xem công thức / định mức món</p></div></div>
      ${tableShell(
        [{ t: 'Món' }, { t: 'Số lượng bán', cls: 'right' }, { t: 'Doanh thu', cls: 'right' }, { t: 'Food Cost', cls: 'right' }, { t: '', w: '48px' }],
        recipeRows, { emptyTitle: 'Chưa có món nào bán ra', emptyDesc: 'Chưa ghi nhận phiếu bán hàng nào cho các món trong thực đơn.' }
      )}
    </div>`;
}

/* ---------------------------------------------------------------------------
 * TÍNH TOÁN SỐ LIỆU NHÂN SỰ TỪ DB HIỆN CÓ
 * -------------------------------------------------------------------------*/
function biHRData() {
  const employees = DB.employees || [];
  const employed = employees.filter((e) => e.status !== 'ns_nghi_viec');
  const activeEmployees = employees.filter((e) => e.status === 'ns_dang_lam');
  const onLeave = employees.filter((e) => e.status === 'ns_nghi_phep');
  const probation = employees.filter((e) => e.status === 'ns_thu_viec');
  const resigned = employees.filter((e) => e.status === 'ns_nghi_viec');

  const totalSalaryCost = biSum(employed, (e) => e.salary);

  const byDept = {};
  employed.forEach((e) => {
    const row = (byDept[e.dept] ||= { dept: e.dept, count: 0, salaryCost: 0 });
    row.count += 1;
    row.salaryCost += Number(e.salary) || 0;
  });
  const deptRows = Object.values(byDept).sort((a, b) => b.salaryCost - a.salaryCost);
  const totalDeptCost = biSum(deptRows, (x) => x.salaryCost);

  const attendance = DB.attendance || [];
  const avgAttendanceRate = attendance.length ? biSum(attendance, (a) => a.rate) / attendance.length : 0;
  const totalOT = biSum(attendance, (a) => a.ot);
  const totalLate = biSum(attendance, (a) => a.late);

  /* Năng suất lao động — 2 chỉ số suy ra từ dữ liệu thật đang có:
   *   • Doanh thu bình quân/nhân sự = doanh thu tháng (DB.kpi) ÷ số nhân sự đang làm việc
   *   • Sản lượng bình quân/nhân sự Sản xuất = sản lượng hoàn thành tháng (mảng Sản xuất) ÷ số nhân sự phòng Sản xuất */
  const revenuePerEmployee = activeEmployees.length ? DB.kpi.revenueMonth / activeEmployees.length : 0;
  const prod = biProductionData();
  const productionHeadcount = (byDept['Sản xuất']?.count) || 0;
  const outputPerProductionWorker = productionHeadcount ? prod.outputMonth / productionHeadcount : 0;

  const lowAttendance = [...attendance].sort((a, b) => a.rate - b.rate).slice(0, 10);

  return {
    employees, employed, activeEmployees, onLeave, probation, resigned,
    totalSalaryCost, deptRows, totalDeptCost,
    avgAttendanceRate, totalOT, totalLate,
    revenuePerEmployee, outputPerProductionWorker, productionHeadcount,
    lowAttendance,
  };
}

/* ---------------------------------------------------------------------------
 * GIAO DIỆN — TAB NHÂN SỰ
 * -------------------------------------------------------------------------*/
function biHRView() {
  const d = biHRData();

  const kpis = `
    <div class="grid g-4" style="margin-bottom:12px">
      ${mkpi('Nhân sự đang làm việc', fmtN(d.activeEmployees.length), 'fa-users', 'blue', null,
        `${fmtN(d.employees.length)} tổng · ${fmtN(d.onLeave.length)} nghỉ phép · ${fmtN(d.probation.length)} thử việc`)}
      ${mkpi('Chi phí lương tháng', fmtVND(d.totalSalaryCost), 'fa-money-check-dollar', 'red', null,
        `Bình quân ${fmtVND(d.employed.length ? d.totalSalaryCost / d.employed.length : 0)}/người`)}
      ${mkpi('Tỷ lệ chấm công bình quân', fmtDec(d.avgAttendanceRate, 1) + '%', d.avgAttendanceRate >= 95 ? 'green' : d.avgAttendanceRate >= 90 ? 'orange' : 'red', null,
        `${fmtN(d.totalLate)} lượt trễ · ${fmtN(d.totalOT)} giờ tăng ca`)}
      ${mkpi('Doanh thu bình quân / nhân sự', fmtVND(d.revenuePerEmployee), 'fa-chart-simple', 'indigo', null,
        'Doanh thu tháng ÷ số nhân sự đang làm việc')}
    </div>
    <div class="stat-strip" style="margin-bottom:16px">
      <div><div class="l">Sản lượng SX bình quân / nhân sự Sản xuất</div><div class="v">${fmtN(d.outputPerProductionWorker)}</div></div>
      <div><div class="l">Nhân sự phòng Sản xuất</div><div class="v">${fmtN(d.productionHeadcount)}</div></div>
      <div><div class="l">Nhân sự thử việc</div><div class="v">${fmtN(d.probation.length)}</div></div>
      <div><div class="l">Nhân sự đã nghỉ việc</div><div class="v">${fmtN(d.resigned.length)}</div></div>
    </div>`;

  const deptRows = d.deptRows.map((x) => `
    <tr>
      <td>${esc(x.dept)}</td>
      <td class="right num">${fmtN(x.count)}</td>
      <td class="right num strong">${fmtVND(x.salaryCost)}</td>
      <td class="right num">${fmtVND(x.count ? x.salaryCost / x.count : 0)}</td>
      <td class="right num">${d.totalDeptCost ? fmtDec((x.salaryCost / d.totalDeptCost) * 100, 1) : 0}%</td>
    </tr>`);

  const lowAttendanceRows = d.lowAttendance.map((a) => `
    <tr class="clickable" data-act="open-employee" data-id="${esc(a.empId)}">
      <td>${cell2(esc(a.name), esc(a.empId) + ' · ' + esc(a.position || ''))}</td>
      <td>${esc(a.dept)}</td>
      <td class="right num">${fmtN(a.worked)}/${fmtN(a.standard)}</td>
      <td class="right num strong" style="color:${a.rate < 90 ? 'var(--red)' : 'var(--orange)'}">${fmtDec(a.rate, 1)}%</td>
      <td class="right">${rowActions([{ act: 'open-employee', data: `data-id="${esc(a.empId)}"`, icon: 'fa-arrow-right', title: 'Xem hồ sơ nhân sự' }])}</td>
    </tr>`);

  return `
    ${pageHead('Nhân sự', 'KPI, năng suất lao động và chi phí nhân sự — cập nhật theo dữ liệu hệ thống hiện có')}
    ${moduleTabs(biTabsConfig(), 'hr')}
    ${kpis}
    <div class="grid g-21" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><div><h3>Chi phí lương theo phòng ban</h3><p>Tính trên nhân sự đang còn làm việc (không gồm đã nghỉ việc)</p></div></div>
        <div class="card-body"><div class="chart-box"><canvas id="biDeptSalaryChart"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Cơ cấu trạng thái nhân sự</h3><p>Toàn bộ nhân sự trong hệ thống</p></div></div>
        <div class="card-body"><div class="chart-box sm"><canvas id="biEmployeeStatusDonut"></canvas></div></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h3>Chi phí &amp; nhân sự theo phòng ban</h3><p>Sắp theo chi phí lương giảm dần</p></div>
        <div class="right"><span class="chip">Tổng ${fmtVND(d.totalDeptCost)}</span></div></div>
      ${tableShell(
        [{ t: 'Phòng ban' }, { t: 'Số nhân sự', cls: 'right' }, { t: 'Chi phí lương', cls: 'right' }, { t: 'Bình quân/người', cls: 'right' }, { t: 'Tỷ trọng', cls: 'right' }],
        deptRows, { emptyTitle: 'Chưa có dữ liệu phòng ban', emptyDesc: 'Không có nhân sự nào đang làm việc.' }
      )}
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Chấm công thấp nhất trong tháng</h3><p>10 nhân sự có tỷ lệ đi làm thấp nhất, cần theo dõi</p></div></div>
      ${tableShell(
        [{ t: 'Nhân sự' }, { t: 'Phòng ban' }, { t: 'Công đi làm', cls: 'right' }, { t: 'Tỷ lệ', cls: 'right' }, { t: '', w: '48px' }],
        lowAttendanceRows, { emptyTitle: 'Không có dữ liệu chấm công', emptyDesc: 'Chưa có bảng chấm công trong hệ thống.' }
      )}
    </div>`;
}

/* ---------------------------------------------------------------------------
 * ĐĂNG KÝ VIEW + VẼ BIỂU ĐỒ SAU KHI RENDER
 * -------------------------------------------------------------------------*/
Views.bi = function (params) {
  const tab = State.tab || 'dashboard';
  if (tab === 'finance') return biFinanceView();
  if (tab === 'warehouse') return biWarehouseView();
  if (tab === 'production') return biProductionView();
  if (tab === 'sales') return biSalesView();
  if (tab === 'restaurant') return biRestaurantView();
  if (tab === 'hr') return biHRView();
  return ''; // các tab khác: rơi về renderPlaceholderView() chuẩn UI của hệ thống
};

Views.bi.after = function (params) {
  const tab = State.tab || 'dashboard';

  if (tab === 'finance') {
    const d = biFinanceData();

  /* -----------------------------------------------------------------------
   * BIỂU ĐỒ DOANH THU: 6 TUẦN / 6 THÁNG / 6 QUÝ
   * ---------------------------------------------------------------------*/
  const revenueTrendMode = State.biRevenueTrendMode || 'month';

  const revenueTrend = biRevenueTrend(revenueTrendMode);

  Charts.line(
    'biRevenueTrendChart',
    revenueTrend.map((r) => r.label),
    revenueTrend.map((r) => r.value),
    {
      money: true,
      label: 'Doanh thu'
    }
  );

  /* Cập nhật tiêu đề / mô tả */
  const trendTitle = document.getElementById('biRevenueTrendTitle');
  const trendDesc = document.getElementById('biRevenueTrendDesc');

  if (trendTitle && trendDesc) {
    const titles = {
      week: 'Xu hướng doanh thu 6 tuần gần nhất',
      month: 'Xu hướng doanh thu 6 tháng gần nhất',
      quarter: 'Xu hướng doanh thu 6 quý gần nhất'
    };

    const descriptions = {
      week: 'Doanh thu thuần theo tuần (chưa VAT)',
      month: 'Doanh thu thuần theo tháng (chưa VAT)',
      quarter: 'Doanh thu thuần theo quý (chưa VAT)'
    };

    trendTitle.textContent = titles[revenueTrendMode];
    trendDesc.textContent = descriptions[revenueTrendMode];
  }

  /* Toggle 6 tuần / 6 tháng / 6 quý */
  document.querySelectorAll('[data-bi-revenue-trend]').forEach((btn) => {
    btn.addEventListener('click', () => {
      State.biRevenueTrendMode = btn.dataset.biRevenueTrend;
      render();
    });
  });

    Charts.donut(
      'biDebtDonutChart',
      ['Phải thu', 'Phải trả'],
      [d.totalReceivable, d.totalPayable],
      ['orange', 'red']
    );

    // Toggle Hôm nay / Tháng này / Năm nay — gắn trực tiếp, không qua data-act
    // toàn cục vì đây là trạng thái hiển thị cục bộ của màn Tài chính.
    document.querySelectorAll('[data-bi-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        State.biFinancePeriod = btn.dataset.biPeriod;
        render();
      });
    });
    return;
  }

  if (tab === 'warehouse') {
    const nearDays = State.biWarehouseNearDays || 15;
    const d = biWarehouseData(nearDays);

    Charts.bar(
      'biWarehouseValueChart',
      ['Nguyên liệu', 'Bán thành phẩm', 'Thành phẩm'],
      [{ label: 'Giá trị tồn kho', data: [d.materialsValue, d.semiValue, d.finishedValue], color: 'blue' }],
      { money: true }
    );

    const statusCounts = { vt_du_ton: 0, vt_sap_het: 0, vt_het_hang: 0 };
    DB.materials.forEach((m) => { statusCounts[m.status] = (statusCounts[m.status] || 0) + 1; });
    Charts.donut(
      'biMaterialStatusDonut',
      ['Đủ tồn', 'Sắp hết', 'Hết hàng'],
      [statusCounts.vt_du_ton, statusCounts.vt_sap_het, statusCounts.vt_het_hang],
      ['green', 'orange', 'red']
    );

    document.querySelectorAll('[data-bi-near-days]').forEach((btn) => {
      btn.addEventListener('click', () => {
        State.biWarehouseNearDays = Number(btn.dataset.biNearDays);
        render();
      });
    });
    return;
  }

  if (tab === 'production') {
    const d = biProductionData();

    Charts.bar(
      'biWorkshopChart',
      DB.workshops.map((w) => w.name),
      [
        { label: 'Sản lượng thực tế', data: DB.workshops.map((w) => w.output), color: 'blue' },
        { label: 'Công suất', data: DB.workshops.map((w) => w.capacity), color: 'slate' },
      ]
    );

    const statusKeys = Object.keys(d.statusCounts);
    Charts.donut(
      'biProductionStatusDonut',
      statusKeys.map((k) => statusLabel(k)),
      statusKeys.map((k) => d.statusCounts[k]),
      statusKeys.map((k) => statusTone(k))
    );

    // Drill-down mở đúng chi tiết lệnh sản xuất — gắn trực tiếp thay vì qua
    // data-act toàn cục vì khóa 'open-po' đã được dùng cho Đơn đặt hàng mua.
    document.querySelectorAll('[data-bi-po-id]').forEach((row) => {
      row.addEventListener('click', () => switchTo(() => go('production-detail', { id: row.dataset.biPoId })));
    });
    return;
  }

  if (tab === 'sales') {
    const period = State.biSalesPeriod || 'month';
    const d = biSalesData(period);

    const top5Customers = d.topCustomers.slice(0, 5);
    Charts.bar(
      'biTopCustomersChart',
      top5Customers.map((r) => r.customer?.name || r.customerId),
      [{ label: 'Doanh thu', data: top5Customers.map((r) => r.revenue), color: 'blue' }],
      { money: true }
    );

    const top5Provinces = d.topProvinces.slice(0, 5);
    const otherProvinceRevenue = biSum(d.topProvinces.slice(5), (r) => r.revenue);
    const provinceLabels = top5Provinces.map((r) => r.province);
    const provinceValues = top5Provinces.map((r) => r.revenue);
    const provinceColorNames = ['blue', 'teal', 'indigo', 'orange', 'green'];
    if (otherProvinceRevenue > 0) {
      provinceLabels.push('Khác');
      provinceValues.push(otherProvinceRevenue);
      provinceColorNames.push('slate');
    }
    Charts.donut('biTopProvinceDonut', provinceLabels, provinceValues, provinceColorNames.slice(0, provinceLabels.length));

    // Toggle Tháng này / Năm nay / Toàn bộ — trước đây thiếu đoạn gắn sự kiện này
    // nên bấm nút không đổi được kỳ xem của tab Kinh doanh.
    document.querySelectorAll('[data-bi-sales-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        State.biSalesPeriod = btn.dataset.biSalesPeriod;
        render();
      });
    });
    return;
  }

  if (tab === 'restaurant') {
    const d = biRestaurantData();

    Charts.bar(
      'biStoreRevenueChart',
      d.perStore.map((x) => x.store.name),
      [{ label: 'Doanh thu', data: d.perStore.map((x) => x.revenue), color: 'blue' }],
      { money: true }
    );

    const remainingProfit = Math.max(0, d.totalRevenue - d.totalFoodCost - d.totalLaborCost);
    Charts.donut(
      'biCostBreakdownDonut',
      ['Food Cost', 'Labor Cost', 'Lợi nhuận còn lại'],
      [d.totalFoodCost, d.totalLaborCost, remainingProfit],
      ['orange', 'red', 'green']
    );
    return;
  }

  if (tab === 'hr') {
    const d = biHRData();

    Charts.bar(
      'biDeptSalaryChart',
      d.deptRows.map((x) => x.dept),
      [{ label: 'Chi phí lương', data: d.deptRows.map((x) => x.salaryCost), color: 'blue' }],
      { money: true }
    );

    Charts.donut(
      'biEmployeeStatusDonut',
      ['Đang làm việc', 'Nghỉ phép', 'Thử việc', 'Đã nghỉ việc'],
      [d.activeEmployees.length, d.onLeave.length, d.probation.length, d.resigned.length],
      ['green', 'orange', 'blue', 'red']
    );
  }
};
