/* ============================================================================
 * MODULE: KẾ TOÁN – TÀI CHÍNH (Lê Nam ERP)
 * ----------------------------------------------------------------------------
 * Nạp SAU app.js (xem hướng dẫn tích hợp cuối file). Ghi đè Views.accounting
 * (trước đó chỉ là bảng demo tĩnh trong mod-enterprise.js) bằng một phân hệ
 * đầy đủ, tính toán trực tiếp từ dữ liệu đã có — không tạo sổ kế toán song
 * song phải nhập tay lại từ đầu.
 *
 * LIÊN THÔNG TỰ ĐỘNG (không cần nhập tay):
 *  - Doanh thu & VAT đầu ra  ← DB.orders (đơn đã giao/hoàn thành)
 *  - Giá vốn hàng bán        ← BOM + Routing sản xuất (Q.costOf) theo từng đơn
 *  - Công nợ phải trả & VAT đầu vào ← DB.purchaseOrders
 *  - Công nợ phải trả — thanh toán ← DB.supplierPayments (tái dùng action có sẵn)
 *  - Tồn kho (Balance Sheet) ← DB.inventory / DB.materials
 *  - Ngân sách vs Thực tế    ← DB.budgets + DB.purchases (PR theo bộ phận)
 *
 * NHẬP TAY TỐI THIỂU (không có nguồn tự động trong hệ thống):
 *  - Thu tiền khách hàng (không có module thu ngân riêng)
 *  - Sổ phụ ngân hàng (không kết nối API ngân hàng thật)
 *  - Tài sản cố định & khấu hao
 *  - Chi phí hoạt động khác (lương, điện nước, thuê mặt bằng…)
 * ==========================================================================*/

/* ---------------------------------------------------------------- 0. DATA */
DB.customerPayments = DB.customerPayments || [];
DB.cashTransactions = DB.cashTransactions || [];   // sổ thu-chi thủ công (không phải công nợ NCC/KH)
// Không seed tài khoản ngân hàng trong source. Master ngân hàng phải được
// hydrate từ bảng lenam_restaurant_bank_accounts trên KIO/server.
DB.bankAccounts = DB.bankAccounts || [];
DB.bankTransactions = DB.bankTransactions || [];
DB.accountingEntries = DB.accountingEntries || [];
const ACCOUNTING_ENTRY_TABLE = (typeof KIO_CONFIG!=='undefined' && KIO_CONFIG.accountingTables?.entries) || 'lenam_accounting_entries';
let accountingEntriesLoaded = false;
async function accountingEntriesEnsureFresh(force=false){
  try {
    if (!force && accountingEntriesLoaded) return DB.accountingEntries;
    const rows = await KioStore.listCollection(ACCOUNTING_ENTRY_TABLE,{force});
    DB.accountingEntries = Array.isArray(rows)?rows:[]; accountingEntriesLoaded=true;
    if(State.module==='accounting' && State.tab==='entries') render();
  } catch(err){ console.warn('[Accounting] Không tải được định khoản:',err); DB.accountingEntries=DB.accountingEntries||[]; }
  return DB.accountingEntries;
}
async function accountingEntrySaveRecord(row){ await KioStore.saveSingleton(ACCOUNTING_ENTRY_TABLE,String(row.id),JSON.parse(JSON.stringify(row))); accountingEntriesLoaded=true; return true; }
async function accountingEntryDeleteRecord(id){ await KioStore.deleteKeys(ACCOUNTING_ENTRY_TABLE,[String(id)]); DB.accountingEntries=(DB.accountingEntries||[]).filter(x=>String(x.id)!==String(id)); return true; }
function accountingEntryById(id){ return (DB.accountingEntries||[]).find(x=>String(x.id)===String(id))||null; }
function accountingEntryLabel(id){ const e=accountingEntryById(id); return e?`${e.number||e.id} · ${e.name||''}`:'—'; }
function accountingEntryOptions(flow='',selected=''){
  const type = flow==='THU'?'THU':flow==='CHI'?'CHI':'';
  return `<option value="">-- Chọn định khoản --</option>`+(DB.accountingEntries||[]).filter(e=>e.active!==false && (!type || e.flow==='BOTH' || e.flow===type)).sort((a,b)=>String(a.number||a.id).localeCompare(String(b.number||b.id),'vi',{numeric:true})).map(e=>`<option value="${esc(e.id)}" ${String(e.id)===String(selected)?'selected':''}>${esc((e.number||e.id)+' · '+(e.name||''))}</option>`).join('');
}

const ACCOUNTING_AUTO_USAGE = {
  '': 'Không tự động',
  RESTAURANT_CASH_SALE: 'Nhà hàng · bán hàng thu tiền mặt',
  RESTAURANT_BANK_SALE: 'Nhà hàng · bán hàng chuyển khoản',
};
function accountingAutoUsageLabel(code){ return ACCOUNTING_AUTO_USAGE[String(code||'')] || String(code||'—'); }
function accountingResolveRestaurantEntry(paymentMethod='Tiền mặt'){
  const method=String(paymentMethod||'Tiền mặt');
  const usage=method==='Chuyển khoản'?'RESTAURANT_BANK_SALE':'RESTAURANT_CASH_SALE';
  const active=(DB.accountingEntries||[]).filter(e=>e.active!==false);
  const explicit=active.find(e=>String(e.autoUsage||'')===usage);
  if(explicit) return explicit;
  // Tương thích dữ liệu định khoản cũ: chỉ tự nhận diện khi có đúng MỘT định khoản
  // bán hàng hợp lý (Nợ 111/112 và Có 511). Không bao giờ đoán giữa nhiều lựa chọn.
  const debitNeed=method==='Chuyển khoản'?'112':'111';
  const candidates=active.filter(e=>{
    const debit=String(e.debitAccount||'').replace(/\s/g,'');
    const credit=String(e.creditAccount||'').replace(/\s/g,'');
    return (e.flow==='THU'||e.flow==='BOTH') && debit.split(',').some(x=>x.startsWith(debitNeed)) && credit.split(',').some(x=>x.startsWith('511'));
  });
  return candidates.length===1?candidates[0]:null;
}
window.accountingResolveRestaurantEntry=accountingResolveRestaurantEntry;
function accountingEntryUsage(id){
  const groups=[
    ['customerPayments',DB.customerPayments||[],'THU'],['supplierPayments',DB.supplierPayments||[],'CHI'],['supplierRefunds',DB.supplierRefunds||[],'THU'],['cashTransactions',DB.cashTransactions||[],''],['bankTransactions',(DB.bankTransactions||[]).filter(r=>String(r.sourceType||'')==='MANUAL_BANK'),''],['posOrders',DB.posOrders||[],'THU']
  ];
  // Chỉ tính giao dịch ngân hàng nhập tay. Các dòng ngân hàng sinh tự động từ
  // thu KH/trả NCC/POS là mirror của chứng từ nguồn, nếu cộng lại sẽ bị nhân đôi.
  const rows=[]; for(const [kind,list,flow] of groups) for(const r of list) if(String(r.accountingEntryId||'')===String(id)) rows.push({kind,flow:flow||((r.type==='CHI'||r.type==='OUT')?'CHI':'THU'),amount:Number(r.amount||r.total||r.grandTotal||0),date:r.date||r.paidAt||'',id:r.id||''});
  return rows;
}
window.accountingEntryOptions=accountingEntryOptions; window.accountingEntriesEnsureFresh=accountingEntriesEnsureFresh;
accountingEntriesEnsureFresh(false);

/* ---------------------------------------------------------------------------
 * BANK LEDGER PERSISTENCE
 * ---------------------------------------------------------------------------
 * Không tạo sổ ngân hàng chỉ sống trong RAM. Mỗi tài khoản ngân hàng đã được
 * lưu thật trên KIO (lenam_restaurant_bank_accounts) mang theo mảng
 * `transactions`. DB.bankTransactions chỉ là mirror runtime để các màn hình
 * cũ tiếp tục hoạt động. Nhờ vậy đổi tài khoản/F5 vẫn giữ đúng số dư.
 */
const AccountingBank = (() => {
  function hydrate() {
    const rows = [];
    for (const bank of (DB.bankAccounts || [])) {
      for (const tx of (Array.isArray(bank.transactions) ? bank.transactions : [])) {
        rows.push({ ...tx, bankId: bank.id });
      }
    }
    DB.bankTransactions = rows;
    return rows;
  }

  function findBank(bankId) {
    return (DB.bankAccounts || []).find(b => String(b.id) === String(bankId));
  }

  function makeId() {
    hydrate();
    return nextCode('BTX-2026-', DB.bankTransactions || []);
  }

  async function persist(bank = null) {
    if (typeof RestaurantQualityAPI !== 'undefined') {
      if (bank && typeof RestaurantQualityAPI.saveRestaurantRecord === 'function') await RestaurantQualityAPI.saveRestaurantRecord('bankAccounts', bank);
      else await RestaurantQualityAPI.syncRestaurant(['bankAccounts']);
    }
    hydrate();
    return true;
  }

  async function record({ bankId, type, date, amount, note, sourceType = '', sourceId = '', createdBy = '', accountingEntryId = '' }) {
    const bank = findBank(bankId);
    const value = Math.round(Number(amount || 0));
    if (!bank || !bankId || value <= 0) return null;
    bank.transactions = Array.isArray(bank.transactions) ? bank.transactions : [];

    // Một chứng từ chỉ được cộng/trừ ngân hàng một lần dù user bấm lại hoặc
    // dữ liệu được hydrate lại từ server.
    if (sourceType && sourceId) {
      const existed = bank.transactions.find(t => String(t.sourceType||'') === String(sourceType) && String(t.sourceId||'') === String(sourceId));
      if (existed) { hydrate(); return existed; }
    }

    const tx = {
      id: makeId(), type: type === 'OUT' ? 'OUT' : 'IN',
      date: date || currentDateYMD(), amount: value, note: note || '',
      sourceType, sourceId, accountingEntryId: accountingEntryId || '', createdBy: createdBy || DB.currentUser?.id || '',
      createdAt: new Date().toISOString(),
    };
    bank.transactions.unshift(tx);
    hydrate();
    await persist(bank);
    return tx;
  }

  async function removeBySource(sourceType, sourceId) {
    let changed = false;
    for (const bank of (DB.bankAccounts || [])) {
      const before = Array.isArray(bank.transactions) ? bank.transactions : [];
      const after = before.filter(t => !(String(t.sourceType||'') === String(sourceType) && String(t.sourceId||'') === String(sourceId)));
      if (after.length !== before.length) { bank.transactions = after; changed = true; }
    }
    if (changed) await persist(); else hydrate();
    return changed;
  }

  return { hydrate, record, persist, removeBySource };
})();
window.AccountingBank = AccountingBank;
AccountingBank.hydrate();
// fixedAssets đọc/ghi thật qua RestaurantQualityAPI (bảng lenam_restaurant_fixed_assets).
// Không gán demo cứng ở đây — cùng lý do như bankAccounts ở trên: đoạn này chạy trước khi
// dữ liệu server kịp nạp nên sẽ luôn "nhảy về demo" sau F5.
DB.fixedAssets = DB.fixedAssets || [];
DB.accountingSettings = DB.accountingSettings || { corporateTaxRatePct: 20, opexCategories: ['Lương & BHXH', 'Điện nước', 'Thuê mặt bằng', 'Vận chuyển', 'Marketing', 'Khác'] };

/* Thu tiền khách hàng không được sinh từ hợp đồng/demo trong RAM.
 * DB.customerPayments chỉ nhận dữ liệu thật từ lenam_customer_payments. */

/* ------------------------------------------------------------ 1. TÍNH TOÁN */
const AccFin = {
  monthOf: (d) => String(d || '').slice(0, 7),
  fmtMonthShort: (m) => 'Th' + Number(m.slice(5, 7)) + '/' + m.slice(2, 4),

  recognizedOrders: () => DB.orders.filter((o) => ['dh_da_giao', 'dh_hoan_tat'].includes(o.status)),
  activePOs: () => (DB.purchaseOrders || []).filter((po) => po.status !== 'CANCELLED'),

  cogsOfOrder(o) {
    return o.items.reduce((s, it) => {
      const c = Q.costOf(it.productId);
      return s + (c ? c.unitCost * it.qty : 0);
    }, 0);
  },

  monthlyMap(list, dateField, valueFn) {
    const map = {};
    list.forEach((x) => { const m = AccFin.monthOf(x[dateField]); map[m] = (map[m] || 0) + valueFn(x); });
    return map;
  },
  revenueByMonth() { return AccFin.monthlyMap(AccFin.recognizedOrders(), 'date', (o) => o.subtotal); },
  cogsByMonth() { return AccFin.monthlyMap(AccFin.recognizedOrders(), 'date', (o) => AccFin.cogsOfOrder(o)); },
  vatOutputByMonth() { return AccFin.monthlyMap(AccFin.recognizedOrders(), 'date', (o) => o.vat || 0); },
  vatInputByMonth() { return AccFin.monthlyMap(AccFin.activePOs(), 'date', (po) => po.vat || 0); },
  purchaseValueByMonth() { return AccFin.monthlyMap(AccFin.activePOs(), 'date', (po) => po.subtotal || 0); },
  cashInByMonth() {
    const a = AccFin.monthlyMap((DB.customerPayments || []).filter((p) => String(p.confirmStatus || 'CONFIRMED').toUpperCase() === 'CONFIRMED'), 'date', (p) => p.amount);
    const b = AccFin.monthlyMap(DB.cashTransactions.filter((t) => t.type === 'THU'), 'date', (t) => t.amount);
    const out = { ...a }; Object.keys(b).forEach((m) => { out[m] = (out[m] || 0) + b[m]; }); return out;
  },
  cashOutByMonth() {
    const a = AccFin.monthlyMap(DB.supplierPayments, 'date', (p) => p.amount);
    const b = AccFin.monthlyMap(DB.cashTransactions.filter((t) => t.type === 'CHI'), 'date', (t) => t.amount);
    const out = { ...a }; Object.keys(b).forEach((m) => { out[m] = (out[m] || 0) + b[m]; }); return out;
  },
  opexByMonth() { return AccFin.monthlyMap(DB.cashTransactions.filter((t) => t.type === 'CHI'), 'date', (t) => t.amount); },

  last6Months() {
    const all = new Set([...Object.keys(AccFin.revenueByMonth()), ...Object.keys(AccFin.cashOutByMonth()), AccFin.monthOf(TODAY)]);
    return [...all].sort().slice(-6);
  },
  currentMonth: () => AccFin.monthOf(TODAY),
  prevMonth() { const [y, m] = AccFin.currentMonth().split('-').map(Number); const d = new Date(y, m - 2, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); },

  totalAR() { return AccFin.recognizedOrders().reduce((s,o)=>s+(typeof SalesCRM!=='undefined'?SalesCRM.receivableOfOrder(o):Math.max(0,Number(o.total||0)-Number(o.paid||0))),0); },
  totalAP() { return AccFin.activePOs().reduce((s, po) => s + (typeof purchasePayableRemaining==='function' ? purchasePayableRemaining(po) : Math.max(0, Number(po.total||0) - Number(po.paid||0))), 0); },

  bankBalance(bankId) {
    const acc = (DB.bankAccounts || []).find((b) => String(b.id) === String(bankId));
    if (!acc) return 0;
    const source = Array.isArray(acc.transactions)
      ? acc.transactions
      : (DB.bankTransactions || []).filter((t) => String(t.bankId) === String(bankId));
    const moved = source.reduce((s, t) => s + (t.type === 'IN' ? Number(t.amount||0) : -Number(t.amount||0)), 0);
    return Number(acc.openingBalance || 0) + moved;
  },
  totalBankBalance() { return (DB.bankAccounts || []).reduce((s, b) => s + AccFin.bankBalance(b.id), 0); },

  assetBookValue(a) {
    const years = Math.max(0, (new Date(TODAY) - new Date(a.purchaseDate)) / (365 * 86400000));
    const dep = Math.min(a.cost, (a.cost / a.usefulYears) * years);
    return Math.max(0, Math.round(a.cost - dep));
  },
  assetAccumDep(a) { return Math.round(a.cost - AccFin.assetBookValue(a)); },
  totalAssetsNet() { return (DB.fixedAssets || []).filter((a) => a.status !== 'disposed').reduce((s, a) => s + AccFin.assetBookValue(a), 0); },

  inventoryBookValue() {
    const materialsValue = Q.inventoryValue();
    const finishedValue = DB.inventory.reduce((s, r) => {
      const p = Q.product(r.productId);
      if (!p) return s;
      const c = Q.costOf(p.id);
      return s + (c ? c.unitCost * (r.qtyOnHand || 0) : 0);
    }, 0);
    return materialsValue + finishedValue;
  },

  pnlOf(month) {
    const revenue = AccFin.revenueByMonth()[month] || 0;
    const cogs = AccFin.cogsByMonth()[month] || 0;
    const grossProfit = revenue - cogs;
    const opex = AccFin.opexByMonth()[month] || 0;
    const ebt = grossProfit - opex;
    const tax = Math.max(0, Math.round(ebt * (DB.accountingSettings.corporateTaxRatePct / 100)));
    return { revenue, cogs, grossProfit, opex, ebt, tax, netProfit: ebt - tax };
  },

  deptActualSpend(dept) {
    return (DB.purchases || []).filter((p) => p.dept === dept && p.status !== 'mh_tu_choi').reduce((s, p) => s + (p.total || 0), 0);
  },
};

/* ---------------------------------------------------------------------------
 * HYDRATE DỮ LIỆU THEO TAB (áp dụng cho mọi tab TRỪ "Công nợ phải chi")
 * ---------------------------------------------------------------------------
 * Tab "Công nợ phải chi" (accApEnsureFreshOnce) render ngay bằng snapshot hiện có,
 * đồng thời tải ngầm các collection nguồn từ server rồi render lại. Các tab còn lại
 * trước đây chỉ đọc DB trong RAM nên sau F5 số liệu lệch với dữ liệu thật.
 * Cơ chế dưới đây áp dụng đúng mô hình đó cho từng tab:
 *   - Mỗi tab khai báo cần những "nhóm nguồn" nào (ACC_TAB_GROUPS).
 *   - Mỗi nhóm nguồn = một API + danh sách collection (ACC_SOURCES).
 *   - Mỗi nhóm chỉ tải 1 lần / lần mở trang, tab khác dùng chung kết quả.
 *   - Tải xong → đồng bộ lại mirror sổ ngân hàng → render lại nếu vẫn đang ở tab đó.
 * API nào chưa tồn tại sẽ bị bỏ qua (chỉ console.warn), không làm vỡ giao diện.
 */
const ACC_SOURCES = {
  // Mua hàng: PO, thanh toán / hoàn tiền NCC, master NCC  (đã dùng ở tab Phải chi)
  purchase:   { apis: [() => typeof PurchaseAPI !== 'undefined' ? PurchaseAPI : null],
                cols: ['purchaseOrders', 'supplierPayments', 'supplierRefunds', 'suppliers'] },
  // Ngân sách + PR theo bộ phận (DB.budgets, DB.purchases)
  budget:     { apis: [() => typeof PurchaseAPI !== 'undefined' ? PurchaseAPI : null],
                cols: ['purchases', 'budgets'] },
  // Kho: tồn kho NVL/thành phẩm  (bootstrap nạp DB.inventory / DB.materials)
  inventory:  { apis: [() => typeof InventoryAPI !== 'undefined' ? InventoryAPI : null],
                cols: ['goodsIssues', 'materialReturnHistory'] },
  // Sổ quỹ, ngân hàng, tài sản cố định, cửa hàng  (lenam_restaurant_*)
  restaurant: { apis: [() => typeof RestaurantQualityAPI !== 'undefined' ? RestaurantQualityAPI : null],
                cols: ['stores', 'bankAccounts', 'cashTransactions', 'fixedAssets'] },
  // Bán hàng / CRM: đơn hàng, khách hàng, thu tiền khách hàng (DB.orders, DB.customerPayments)
  // ⚠ Tên API chưa xác nhận được từ file này — sửa lại cho khớp app.js nếu cần.
  sales:      { apis: [() => typeof SalesAPI !== 'undefined' ? SalesAPI : null,
                       () => typeof CRMAPI !== 'undefined' ? CRMAPI : null,
                       () => typeof SalesCRMAPI !== 'undefined' ? SalesCRMAPI : null],
                cols: ['orders', 'customers', 'customerPayments'] },
  // Sản xuất: lệnh SX, BOM, Routing (Q.costOf dùng để tính giá vốn)
  // ⚠ Tên API chưa xác nhận được từ file này — sửa lại cho khớp app.js nếu cần.
  production: { apis: [() => typeof ProductionAPI !== 'undefined' ? ProductionAPI : null,
                       () => typeof ManufacturingAPI !== 'undefined' ? ManufacturingAPI : null],
                cols: ['productionOrders', 'boms', 'routings'] },
};

// Tab nào cần nhóm nguồn nào. Tab 'ap' cố ý KHÔNG có ở đây (đã có cơ chế riêng).
const ACC_TAB_GROUPS = {
  dashboard:      ['sales', 'purchase', 'inventory', 'production', 'restaurant'],
  cashflow_inout: ['sales', 'purchase', 'restaurant'],
  banking:        ['restaurant'],
  ar:             ['sales'],
  costing:        ['production', 'sales'],
  fixed_assets:   ['restaurant'],
  tax:            ['sales', 'purchase'],
  budget:         ['budget'],
  pnl:            ['sales', 'production', 'restaurant'],
  balance_sheet:  ['sales', 'purchase', 'inventory', 'production', 'restaurant'],
  cashflow:       ['sales', 'purchase', 'restaurant'],
  general_ledger: ['sales', 'purchase', 'restaurant'],
};

const __accHyd = {}; // group -> { state: 'loading'|'done', promise }

function accHydrateGroup(group) {
  if (__accHyd[group]) return __accHyd[group].promise;
  const cfg = ACC_SOURCES[group];
  const entry = { state: 'loading', promise: null };
  entry.promise = (async () => {
    if (!cfg) return;
    let api = null;
    for (const get of cfg.apis) { try { api = get(); } catch (_) { api = null; } if (api) break; }
    if (!api) { console.warn(`[Accounting] Không tìm thấy API nguồn cho nhóm "${group}" — giữ snapshot hiện tại.`); return; }
    try {
      await api.bootstrap?.();
      if (cfg.cols.length) await api.ensureFresh?.(cfg.cols, { force: true });
    } catch (err) {
      console.warn(`[Accounting] Không tải được nhóm "${group}" từ KIO; giữ snapshot hiện tại:`, err);
    }
  })().finally(() => { entry.state = 'done'; });
  __accHyd[group] = entry;
  return entry.promise;
}

function accHydrateForTab(tab) {
  const groups = ACC_TAB_GROUPS[tab];
  if (!groups) return;
  const waiting = groups.filter((g) => __accHyd[g]?.state !== 'done');
  if (!waiting.length) return; // mọi nguồn đã tải xong → render ngay bằng dữ liệu mới nhất
  Promise.allSettled(waiting.map(accHydrateGroup)).then(() => {
    try { AccountingBank.hydrate(); } catch (_) {}   // DB.bankTransactions là mirror của bankAccounts[].transactions
    if (typeof State !== 'undefined' && State.module === 'accounting' && (State.tab || 'dashboard') === tab && typeof render === 'function') render();
  });
}

/* -------------------------------------------------------------- 2. GIAO DIỆN */
const ACCOUNTING_TABS = [
  ['budget', 'Ngân sách'],
  ['pnl', 'P&L'],
  ['balance_sheet', 'Balance Sheet'],
  ['cashflow', 'Cashflow'],
];

function accTabsBar(active) {
  return `<div class="tabs module-tabs" style="margin-bottom:16px">
    ${ACCOUNTING_TABS.map(([id, label]) => `<button class="tab ${active === id ? 'active' : ''}" data-act="nav" data-id="accounting" data-tab="${id}">${esc(label)}</button>`).join('')}
  </div>`;
}

function pctDelta(cur, prev) {
  if (!prev) return '';
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  const tone = d >= 0 ? 'green' : 'red';
  const arrow = d >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
  return `<span class="kpi-delta ${tone === 'green' ? 'up' : 'down'}"><i class="fa-solid ${arrow}"></i>${Math.abs(d).toFixed(1)}%</span> so với tháng trước`;
}

/* ----------------------------------------------------------------
 * ACCOUNTING FILTER HELPERS
 * ---------------------------------------------------------------- */

function accDateInRange(date, from, to) {
  if (!date) return false;
  if (from && String(date) < String(from)) return false;
  if (to && String(date) > String(to)) return false;
  return true;
}

function accTextMatch(values, keyword) {
  if (!keyword) return true;
  const q = String(keyword).trim().toLowerCase();
  if (!q) return true;

  return values.some((v) =>
    String(v ?? '').toLowerCase().includes(q)
  );
}

/* Khoảng ngày mặc định cho báo cáo */
function accDefaultReportFilter(key) {
  const today = currentDateYMD ? currentDateYMD() : String(TODAY);

  const d = new Date(today);
  const y = d.getFullYear();
  const m = d.getMonth();

  if (key === 'acc-report-pnl' || key === 'acc-report-tax') {
    return {
      period: 'month',
      year: y,
      month: String(m + 1).padStart(2, '0'),
      from: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      to: today
    };
  }

  if (key === 'acc-report-cashflow') {
    const from = new Date(y, m - 5, 1);

    return {
      period: 'month',
      from: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`,
      to: today
    };
  }

  if (key === 'acc-report-bs') {
    return {
      asOf: today
    };
  }

  return {};
}

function accReportPeriodLabel(period, from, to) {
  if (period === 'month') {
    return `Theo tháng · ${fmtDate(from)} → ${fmtDate(to)}`;
  }

  if (period === 'quarter') {
    return `Theo quý · ${fmtDate(from)} → ${fmtDate(to)}`;
  }

  if (period === 'year') {
    return `Theo năm · ${fmtDate(from)} → ${fmtDate(to)}`;
  }

  return `${fmtDate(from)} → ${fmtDate(to)}`;
}

/* Gom dữ liệu theo tháng / quý / năm */
function accGroupKey(date, groupBy = 'month') {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  const y = d.getFullYear();
  const m = d.getMonth() + 1;

  if (groupBy === 'year') {
    return String(y);
  }

  if (groupBy === 'quarter') {
    return `${y}-Q${Math.ceil(m / 3)}`;
  }

  return `${y}-${String(m).padStart(2, '0')}`;
}

function accGroupLabel(key, groupBy = 'month') {
  if (groupBy === 'year') {
    return `Năm ${key}`;
  }

  if (groupBy === 'quarter') {
    return key.replace('-', ' / ');
  }

  const [y, m] = key.split('-');
  return `Th${Number(m)}/${String(y).slice(2)}`;
}

/* ---- 2.1 Tổng quan ---- */
function accDashboardView() {
  const m = AccFin.currentMonth(), pm = AccFin.prevMonth();
  const rev = AccFin.revenueByMonth()[m] || 0, prevRev = AccFin.revenueByMonth()[pm] || 0;
  const cogs = AccFin.cogsByMonth()[m] || 0, prevCogs = AccFin.cogsByMonth()[pm] || 0;
  const gp = rev - cogs, prevGp = prevRev - prevCogs;
  const ar = AccFin.totalAR(), ap = AccFin.totalAP();
  const cash = AccFin.totalBankBalance();
  const assetNet = AccFin.totalAssetsNet();
  const invValue = AccFin.inventoryBookValue();

  const months = AccFin.last6Months();
  const revMap = AccFin.revenueByMonth(), cogsMap = AccFin.cogsByMonth();

  return `${pageHead('Tổng quan tài chính', 'Số liệu tổng hợp tự động từ Bán hàng, Sản xuất, Kho và Mua hàng', '<button class="btn btn-sm" data-act="nav" data-id="accounting" data-tab="reports_hub"><i class="fa-solid fa-file-export"></i>Xem báo cáo</button>')}
  <div class="grid g-auto" style="margin-bottom:14px">
    ${mkpi('Doanh thu thuần tháng', fmtVND(rev), 'fa-sack-dollar', 'blue', null, pctDelta(rev, prevRev))}
    ${mkpi('Giá vốn hàng bán', fmtVND(cogs), 'fa-cubes', 'orange', null, pctDelta(cogs, prevCogs))}
    ${mkpi('Lợi nhuận gộp', fmtVND(gp), 'fa-chart-line', 'green', null, pctDelta(gp, prevGp))}
    ${mkpi('Tồn quỹ ngân hàng', fmtVND(cash), 'fa-building-columns', 'indigo')}
    ${mkpi('Công nợ phải thu', fmtVND(ar), 'fa-hand-holding-dollar', 'teal', 'nav', )}
    ${mkpi('Công nợ phải chi', fmtVND(ap), 'fa-file-invoice-dollar', 'red')}
    ${mkpi('Giá trị tồn kho', fmtVND(invValue), 'fa-boxes-stacked', 'slate')}
    ${mkpi('Tài sản cố định (còn lại)', fmtVND(assetNet), 'fa-warehouse', 'blue')}
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div><h3>Doanh thu &amp; Giá vốn 6 tháng gần nhất</h3><p>Doanh thu ghi nhận theo đơn hàng đã giao; giá vốn tính theo định mức BOM/Routing hiện hành</p></div></div>
    <div class="card-body"><div class="chart-box"><canvas id="accTrendChart"></canvas></div></div>
  </div>
  <div class="grid g-2">
    <div class="card">
      <div class="card-head"><h3>Thu – Chi gần đây</h3><div class="right"><button class="btn btn-sm" data-act="nav" data-id="accounting" data-tab="cashflow_inout">Xem tất cả</button></div></div>
      ${accRecentCashRows()}
    </div>
    <div class="card">
      <div class="card-head"><h3>Công nợ cần chú ý</h3></div>
      ${accTopDebtRows()}
    </div>
  </div>`;
}
accDashboardView.months = null;

function accRecentCashRows() {
  const rows = accAllCashRows().slice(0, 6);
  return tableShell([{ t: 'Ngày' }, { t: 'Loại' }, { t: 'Diễn giải' }, { t: 'Số tiền', cls: 'right' }],
    rows.map((r) => `<tr><td class="num">${fmtDate(r.date)}</td><td>${r.type === 'THU' ? '<span class="badge green">Thu</span>' : '<span class="badge red">Chi</span>'}</td><td>${cell2(esc(r.note), esc(r.source))}</td><td class="right num strong">${fmtVND(r.amount)}</td></tr>`),
    { emptyTitle: 'Chưa có giao dịch' });
}

function accTopDebtRows() {
  const arRows = AccFin.recognizedOrders().map(o=>({o,remain:typeof SalesCRM!=='undefined'?SalesCRM.receivableOfOrder(o):Math.max(0,Number(o.total||0)-Number(o.paid||0))})).filter(x=>x.remain>0).sort((a,b)=>b.remain-a.remain).slice(0,4)
    .map(({o,remain}) => `<tr><td>${cell2(esc(Q.customerName(o.customerId)), 'Phải thu · ' + esc(o.id))}</td><td class="right num strong" style="color:var(--teal)">${fmtVND(remain)}</td></tr>`);
  const apRows = AccFin.activePOs().map(po=>{const remain=typeof purchasePayableRemaining==='function'?purchasePayableRemaining(po):Math.max(0,Number(po.total||0)-Number(po.paid||0));return {po,remain};}).filter(x=>x.remain>0).sort((a,b)=>b.remain-a.remain).slice(0,4)
    .map(({po,remain}) => `<tr><td>${cell2(esc(Q.supplierName(po.supplierId)), 'Phải chi · ' + esc(po.id))}</td><td class="right num strong" style="color:var(--red)">${fmtVND(remain)}</td></tr>`);
  return tableShell([{ t: 'Đối tượng' }, { t: '', cls: 'right' }], [...arRows, ...apRows], { emptyTitle: 'Không có công nợ đáng chú ý' });
}

/** Toàn bộ dòng thu-chi (tự động + thủ công), sắp xếp mới nhất trước */
function accAllCashRows() {
  const rows = [];
  DB.customerPayments.filter((p) => String(p.confirmStatus || 'CONFIRMED').toUpperCase() === 'CONFIRMED').forEach((p) => rows.push({ date: p.date, type: 'THU', amount: p.amount, note: p.note || `Thu tiền ${Q.customerName(p.customerId)}`, source: 'Tự động · Hợp đồng/Đơn hàng', ref: p.contractId || '', editable: false, id: p.id, kind: 'customerPayment', accountingEntryId:p.accountingEntryId||'' }));
  DB.supplierPayments.forEach((p) => rows.push({ date: p.date, type: 'CHI', amount: p.amount, note: p.note || `Trả NCC ${Q.supplierName(p.supplierId)}`, source: 'Tự động · Mua hàng', ref: p.poId || '', editable: false, id: p.id, kind: 'supplierPayment', accountingEntryId:p.accountingEntryId||'' }));
  (DB.supplierRefunds || []).forEach((r) => rows.push({ date: r.date, type: 'THU', amount: r.amount, note: r.note || `NCC hoàn tiền ${Q.supplierName(r.supplierId)}`, source: 'Tự động · Hoàn tiền NCC', ref: r.poId || '', editable: false, id: r.id, kind: 'supplierRefund', accountingEntryId:r.accountingEntryId||'' }));
  DB.cashTransactions.forEach((t) => rows.push({ date: t.date, type: t.type, amount: t.amount, note: t.note || t.category, source: 'Thủ công · ' + (t.category || ''), ref: '', editable: true, id: t.id, kind: 'manual', accountingEntryId:t.accountingEntryId||'' }));
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
accDashboardView.after = function () {
  const months = AccFin.last6Months();
  const revMap = AccFin.revenueByMonth(), cogsMap = AccFin.cogsByMonth();
  if (typeof Charts !== 'undefined') {
    Charts.bar('accTrendChart', months.map(AccFin.fmtMonthShort), [
      { label: 'Doanh thu', data: months.map((m) => revMap[m] || 0), color: 'blue' },
      { label: 'Giá vốn', data: months.map((m) => cogsMap[m] || 0), color: 'orange' },
    ], { money: true });
  }
};

/* ---- 2.2 Thu – Chi ---- */

function accEntrySubtab(){ return F('acc-entry-ui',{subtab:'summary',q:'',flow:''}); }
function accEntriesTabs(){ const f=accEntrySubtab(); return `<div class="tabs" style="margin-bottom:14px"><button class="tab ${f.subtab==='summary'?'active':''}" data-act="acc-entry-subtab" data-id="summary">Tổng hợp định khoản</button><button class="tab ${f.subtab==='master'?'active':''}" data-act="acc-entry-subtab" data-id="master">Khai báo định khoản</button></div>`; }
function accEntrySummaryView(){
  const entries=DB.accountingEntries||[];
  const rows=entries.map(e=>{ const use=accountingEntryUsage(e.id); const thu=use.filter(x=>x.flow==='THU').reduce((s,x)=>s+x.amount,0), chi=use.filter(x=>x.flow==='CHI').reduce((s,x)=>s+x.amount,0); return `<tr><td><span class="code">${esc(e.number||e.id)}</span></td><td><b>${esc(e.name||'—')}</b><div class="cell-sub">Nợ ${esc(e.debitAccount||'—')} / Có ${esc(e.creditAccount||'—')}</div></td><td>${e.flow==='THU'?'<span class="badge green">Thu</span>':e.flow==='CHI'?'<span class="badge red">Chi</span>':'<span class="badge blue">Thu & Chi</span>'}</td><td class="right num">${fmtN(use.length)}</td><td class="right num" style="color:var(--green)">${fmtVND(thu)}</td><td class="right num" style="color:var(--red)">${fmtVND(chi)}</td><td class="right strong num">${fmtVND(thu-chi)}</td></tr>`; });
  const totalUse=entries.reduce((s,e)=>s+accountingEntryUsage(e.id).length,0), totalThu=entries.reduce((s,e)=>s+accountingEntryUsage(e.id).filter(x=>x.flow==='THU').reduce((a,x)=>a+x.amount,0),0), totalChi=entries.reduce((s,e)=>s+accountingEntryUsage(e.id).filter(x=>x.flow==='CHI').reduce((a,x)=>a+x.amount,0),0);
  return `<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Định khoản đang dùng',entries.filter(e=>e.active!==false).length,'fa-book','blue')}${mkpi('Giao dịch đã gắn',totalUse,'fa-link','indigo')}${mkpi('Tổng thu đã gắn',fmtVND(totalThu),'fa-arrow-down','green')}${mkpi('Tổng chi đã gắn',fmtVND(totalChi),'fa-arrow-up','red')}</div><div class="card"><div class="card-head"><div><h3>Tổng hợp định khoản</h3><p>Tổng tiền lấy từ các giao dịch Thu – Chi/Công nợ/Ngân hàng đã chọn định khoản.</p></div></div>${tableShell([{t:'Số định khoản'},{t:'Tên định khoản'},{t:'Áp dụng'},{t:'Số GD',cls:'right'},{t:'Tổng thu',cls:'right'},{t:'Tổng chi',cls:'right'},{t:'Chênh lệch',cls:'right'}],rows,{emptyTitle:'Chưa khai báo định khoản'})}</div>`;
}
function accEntryMasterView(){
  const f=accEntrySubtab(), q=String(f.q||'').toLowerCase().trim(); let list=[...(DB.accountingEntries||[])]; if(q)list=list.filter(e=>[e.number,e.name,e.debitAccount,e.creditAccount,e.description].some(v=>String(v||'').toLowerCase().includes(q))); if(f.flow)list=list.filter(e=>e.flow===f.flow||e.flow==='BOTH');
  const rows=list.map(e=>{const used=accountingEntryUsage(e.id).length; return `<tr><td><span class="code">${esc(e.number||e.id)}</span></td><td><b>${esc(e.name||'—')}</b><div class="cell-sub">${esc(e.description||'')}</div></td><td>${esc(e.debitAccount||'—')}</td><td>${esc(e.creditAccount||'—')}</td><td>${e.flow==='THU'?'<span class="badge green">Thu</span>':e.flow==='CHI'?'<span class="badge red">Chi</span>':'<span class="badge blue">Thu & Chi</span>'}</td><td>${e.autoUsage?`<span class="chip">${esc(accountingAutoUsageLabel(e.autoUsage))}</span>`:'<span class="muted">Thủ công</span>'}</td><td>${e.active===false?'<span class="badge gray">Ngừng dùng</span>':'<span class="badge green">Đang dùng</span>'}</td><td class="right"><button class="btn btn-sm" data-act="acc-entry-edit" data-id="${esc(e.id)}"><i class="fa-solid fa-pen"></i>Sửa</button> <button class="btn btn-sm" data-act="acc-entry-delete" data-id="${esc(e.id)}" ${used?'disabled title="Đã phát sinh giao dịch"':''}><i class="fa-solid fa-trash"></i>Xóa</button>${used?`<div class="cell-sub">${used} giao dịch · không được xóa</div>`:''}</td></tr>`;});
  return `<div class="card"><div class="toolbar">${searchBox('acc-entry-ui','Tìm số, tên, tài khoản…')}${selectFilter('acc-entry-ui','flow',[['THU','Thu'],['CHI','Chi'],['BOTH','Thu & Chi']],'Tất cả loại')}<span class="spacer"></span><button class="btn btn-primary" data-act="acc-entry-new"><i class="fa-solid fa-plus"></i>Khai báo định khoản</button></div>${tableShell([{t:'Số định khoản'},{t:'Tên định khoản'},{t:'TK Nợ'},{t:'TK Có'},{t:'Áp dụng'},{t:'Tự động dùng cho'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có định khoản'})}</div>`;
}
function accEntriesView(){ const f=accEntrySubtab(); if(!accountingEntriesLoaded) accountingEntriesEnsureFresh(false); return `${pageHead('Định khoản','Khai báo master định khoản và tổng hợp số tiền phát sinh theo từng định khoản','')}${accEntriesTabs()}${f.subtab==='master'?accEntryMasterView():accEntrySummaryView()}`; }
function openAccountingEntryForm(id=''){
  const e=id?accountingEntryById(id):null; Modal.open({title:e?'Sửa định khoản':'Khai báo định khoản',sub:'Kế toán khai báo định khoản. Nhân viên bán hàng chỉ chọn nghiệp vụ/thanh toán; hệ thống tự áp định khoản đã cấu hình.',size:'md',body:`<div class="form-grid"><div class="field"><label>Số định khoản <span class="req">*</span></label><input class="inp" id="aeNumber" value="${esc(e?.number||'')}" placeholder="VD: DK-001 hoặc 111/511"></div><div class="field"><label>Tên định khoản <span class="req">*</span></label><input class="inp" id="aeName" value="${esc(e?.name||'')}" placeholder="VD: Thu tiền bán hàng"></div><div class="field"><label>Tài khoản Nợ <span class="req">*</span></label><input class="inp" id="aeDebit" value="${esc(e?.debitAccount||'')}" placeholder="VD: 111, 112"></div><div class="field"><label>Tài khoản Có <span class="req">*</span></label><input class="inp" id="aeCredit" value="${esc(e?.creditAccount||'')}" placeholder="VD: 131, 331, 511, 33311"></div><div class="field"><label>Áp dụng <span class="req">*</span></label><select class="inp" id="aeFlow"><option value="THU" ${e?.flow==='THU'?'selected':''}>Thu</option><option value="CHI" ${e?.flow==='CHI'?'selected':''}>Chi</option><option value="BOTH" ${(!e||e?.flow==='BOTH')?'selected':''}>Thu & Chi</option></select></div><div class="field"><label>Trạng thái</label><select class="inp" id="aeActive"><option value="1" ${e?.active!==false?'selected':''}>Đang dùng</option><option value="0" ${e?.active===false?'selected':''}>Ngừng dùng</option></select></div><div class="field" style="grid-column:1/-1"><label>Tự động áp cho nghiệp vụ</label><select class="inp" id="aeAutoUsage">${Object.entries(ACCOUNTING_AUTO_USAGE).map(([k,v])=>`<option value="${esc(k)}" ${String(e?.autoUsage||'')===k?'selected':''}>${esc(v)}</option>`).join('')}</select><div class="cell-sub">Chỉ Kế toán cấu hình. Ví dụ chọn “Nhà hàng · bán hàng thu tiền mặt”; nhân viên cửa hàng sẽ không phải tự chọn định khoản.</div></div><div class="field" style="grid-column:1/-1"><label>Mô tả</label><textarea class="inp" id="aeDescription" rows="2">${esc(e?.description||'')}</textarea></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="acc-entry-save" ${e?`data-id="${esc(e.id)}"`:''}><i class="fa-solid fa-floppy-disk"></i>Lưu định khoản</button>`});
}

function accCashflowInOutView() {
  const f = F('acc-cash', { type: '', from: '', to: '' });
  let rows = accAllCashRows();
  if (f.type) rows = rows.filter((r) => r.type === f.type);
  if (f.from) rows = rows.filter((r) => r.date >= f.from);
  if (f.to) rows = rows.filter((r) => r.date <= f.to);
  const totalIn = rows.filter((r) => r.type === 'THU').reduce((s, r) => s + r.amount, 0);
  const totalOut = rows.filter((r) => r.type === 'CHI').reduce((s, r) => s + r.amount, 0);
  const pg = paged(rows, 'acc-cash', 15);

  return `${pageHead('Thu – Chi', 'Sổ quỹ tổng hợp: tự động từ công nợ khách hàng/nhà cung cấp + ghi nhận thủ công', `
      <button class="btn" data-act="acc-cash-add" data-type="THU"><i class="fa-solid fa-arrow-down"></i>Ghi nhận thu</button>
      <button class="btn btn-primary" data-act="acc-cash-add" data-type="CHI"><i class="fa-solid fa-arrow-up"></i>Ghi nhận chi</button>`)}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng thu (theo lọc)', fmtVND(totalIn), 'fa-arrow-down', 'green')}
      ${mkpi('Tổng chi (theo lọc)', fmtVND(totalOut), 'fa-arrow-up', 'red')}
      ${mkpi('Chênh lệch', fmtVND(totalIn - totalOut), 'fa-scale-balanced', totalIn >= totalOut ? 'blue' : 'orange')}
    </div>
    <div class="card">
      <div class="toolbar">
        ${selectFilter('acc-cash', 'type', [['THU', 'Thu'], ['CHI', 'Chi']], 'Tất cả loại')}
        <span class="muted" style="font-size:13px;white-space:nowrap">Từ ngày</span><input class="inp" type="date" data-f="acc-cash.from" value="${esc(f.from || '')}">
        <span class="muted" style="font-size:13px;white-space:nowrap">Đến ngày</span><input class="inp" type="date" data-f="acc-cash.to" value="${esc(f.to || '')}">
        ${(f.type || f.from || f.to) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="acc-cash"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
        <span class="spacer"></span><span class="chip">${rows.length} giao dịch</span>
      </div>
      ${tableShell([{ t: 'Ngày' }, { t: 'Loại' }, { t: 'Diễn giải' }, { t: 'Định khoản' }, { t: 'Chứng từ / Nguồn' }, { t: 'Số tiền', cls: 'right' }, { t: '', cls: 'right' }],
        pg.items.map((r) => `<tr>
          <td class="num">${fmtDate(r.date)}</td>
          <td>${r.type === 'THU' ? '<span class="badge green">Thu</span>' : '<span class="badge red">Chi</span>'}</td>
          <td>${esc(r.note)}</td>
          <td>${r.accountingEntryId?`<span class="code">${esc(accountingEntryLabel(r.accountingEntryId))}</span>`:'<span class="muted">Chưa gắn</span>'}</td>
          <td class="muted">${esc(r.ref || r.source)}</td>
          <td class="right num strong" style="color:${r.type === 'THU' ? 'var(--green)' : 'var(--red)'}">${r.type === 'THU' ? '+' : '−'}${fmtVND(r.amount)}</td>
          <td class="right">${r.editable ? `<button class="btn btn-icon btn-sm" data-act="acc-cash-delete" data-id="${esc(r.id)}" title="Xóa"><i class="fa-solid fa-trash"></i></button>` : `<span class="cell-sub">Tự động</span>`}</td>
        </tr>`), { emptyTitle: 'Chưa có giao dịch thu chi' })}
      ${pagiHTML('acc-cash', pg, 'giao dịch')}
    </div>`;
}

function openCashTxForm(type) {
  Modal.open({
    title: type === 'THU' ? 'Ghi nhận khoản thu' : 'Ghi nhận khoản chi',
    sub: 'Dùng cho các khoản không tự sinh ra từ Bán hàng/Mua hàng, ví dụ lương, điện nước, thu khác…',
    body: `<div class="form-grid">
        <div class="field"><label>Ngày <span class="req">*</span></label><input class="inp" id="ctxDate" type="date" value="${currentDateYMD()}"></div>
        <div class="field"><label>Số tiền <span class="req">*</span></label><input class="inp right num" id="ctxAmount" data-money="1" type="text" inputmode="numeric" min="0" step="1000"></div>
        <div class="field"><label>Hình thức</label><select class="inp" id="ctxMethod" onchange="accountingCashMethodChanged()"><option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản ngân hàng</option></select></div>
        <div class="field" id="ctxBankWrap" style="display:none"><label>Tài khoản ngân hàng</label><select class="inp" id="ctxBank"><option value="">-- Chọn tài khoản --</option>${(DB.bankAccounts||[]).filter(b=>b.active!==false).map(b=>`<option value="${esc(b.id)}">${esc(b.name)} · ${esc(b.accountNumber||'')}</option>`).join('')}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Định khoản <span class="req">*</span></label><select class="inp" id="ctxAccountingEntry">${accountingEntryOptions(type)}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Khoản mục</label><select class="inp" id="ctxCategory">${DB.accountingSettings.opexCategories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Diễn giải</label><textarea class="inp" id="ctxNote" rows="2" placeholder="Nội dung khoản thu/chi"></textarea></div>
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="acc-cash-save" data-type="${type}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`,
  });
}
function accountingCashMethodChanged(){
  const wrap=$('#ctxBankWrap'); if(wrap) wrap.style.display=$('#ctxMethod')?.value==='BANK_TRANSFER'?'':'none';
}

/* ---- 2.3 Ngân hàng ---- */
function accBankingView() {
  AccountingBank.hydrate();
  const accRows = (DB.bankAccounts || []).map((b) => {
    const store = (DB.stores || []).find(s => String(s.id) === String(b.storeId));
    const scope = b.scopeType === 'STORE' ? (store?.name || b.storeId || 'Chi nhánh / Cửa hàng') : 'Công ty';
    return `<tr>
      <td>${cell2(esc(b.name), esc(b.bankName || '') + ' · ' + esc(b.accountNumber || ''))}</td>
      <td>${esc(scope)}${b.isDefault ? '<div class="cell-sub">Tài khoản mặc định</div>' : ''}</td>
      <td>${b.active === false ? '<span class="badge gray">Ngừng dùng</span>' : '<span class="badge green">Đang dùng</span>'}</td>
      <td class="right num strong">${fmtVND(AccFin.bankBalance(b.id))}</td>
      <td class="right">${Math.abs(AccFin.bankBalance(b.id)) < 0.5 && !(Array.isArray(b.transactions) && b.transactions.length) ? `<button class="btn btn-sm" data-act="acc-bank-edit" data-id="${esc(b.id)}"><i class="fa-solid fa-pen"></i>Sửa</button> <button class="btn btn-sm" data-act="acc-bank-delete" data-id="${esc(b.id)}"><i class="fa-solid fa-trash"></i>Xóa</button>` : ''}<button class="btn btn-sm" data-act="acc-bank-tx-add" data-id="${esc(b.id)}"><i class="fa-solid fa-plus"></i>Giao dịch</button></td>
    </tr>`;
  });
  const txRows = (DB.bankTransactions || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 30)
    .map((t) => `<tr><td class="num">${fmtDate(t.date)}</td><td>${esc((DB.bankAccounts.find((b) => b.id === t.bankId) || {}).name || '—')}</td><td>${esc(t.note)}</td><td class="right num strong" style="color:${t.type === 'IN' ? 'var(--green)' : 'var(--red)'}">${t.type === 'IN' ? '+' : '−'}${fmtVND(t.amount)}</td></tr>`);

  return `${pageHead('Ngân hàng', 'Số dư tài khoản ghi nhận thủ công theo sao kê — hệ thống chưa kết nối trực tiếp API ngân hàng', '<button class="btn btn-primary" data-act="acc-bank-add"><i class="fa-solid fa-plus"></i>Thêm tài khoản</button>')}
    <div class="alert-item" style="margin-bottom:14px;cursor:default"><span class="alert-ico t-orange"><i class="fa-solid fa-circle-info"></i></span><div><b class="alert-title">Chưa kết nối API ngân hàng</b><div class="alert-sub">Số dư dưới đây được cập nhật thủ công theo sao kê định kỳ. Khi có API Open Banking, phần này sẽ tự đồng bộ mà không đổi cấu trúc dữ liệu.</div></div></div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><h3>Tài khoản ngân hàng</h3></div>
      ${tableShell([{ t: 'Tài khoản' }, { t: 'Phạm vi sử dụng' }, { t: 'Trạng thái' }, { t: 'Số dư hiện tại', cls: 'right' }, { t: '', cls: 'right' }], accRows, { emptyTitle: 'Chưa có tài khoản ngân hàng' })}
    </div>
    <div class="card">
      <div class="card-head"><h3>Sổ phụ / Giao dịch gần đây</h3></div>
      ${tableShell([{ t: 'Ngày' }, { t: 'Tài khoản' }, { t: 'Nội dung' }, { t: 'Số tiền', cls: 'right' }], txRows, { emptyTitle: 'Chưa có giao dịch ngân hàng' })}
    </div>`;
}

function openBankAccountForm(bankId = '') {
  const stores = (DB.stores || []).filter(s => s.status !== 'inactive');
  const b = bankId ? (DB.bankAccounts || []).find(x => String(x.id) === String(bankId)) : null;
  if (bankId && !b) return;
  if (b && (Math.abs(AccFin.bankBalance(b.id)) >= 0.5 || (Array.isArray(b.transactions) && b.transactions.length))) {
    Toast.warn('Không thể chỉnh sửa', 'Tài khoản đã có số dư hoặc đã phát sinh giao dịch.'); return;
  }
  const scopeType = b?.scopeType || 'COMPANY';
  Modal.open({
    title: b ? 'Sửa tài khoản ngân hàng' : 'Thêm tài khoản ngân hàng',
    body: `<div class="form-grid cols-2">
        <div class="field" style="grid-column:1/-1"><label>Tên gợi nhớ <span class="req">*</span></label><input class="inp" id="bkName" value="${esc(b?.name||'')}" placeholder="VD: Vietcombank – TK thanh toán"></div>
        <div class="field"><label>Ngân hàng <span class="req">*</span></label><input class="inp" id="bkBankName" value="${esc(b?.bankName||'')}" placeholder="Vietcombank, ACB…"></div>
        <div class="field"><label>Số tài khoản <span class="req">*</span></label><input class="inp" id="bkNumber" value="${esc(b?.accountNumber||'')}"></div>
        <div class="field" style="grid-column:1/-1"><label>Chủ tài khoản</label><input class="inp" id="bkAccountName" value="${esc(b?.accountName||'')}" placeholder="CÔNG TY TNHH ..."></div>
        <div class="field"><label>Phạm vi sử dụng *</label><select class="inp" id="bkScope" onchange="accountingBankScopeChanged()"><option value="COMPANY" ${scopeType==='COMPANY'?'selected':''}>Công ty</option><option value="STORE" ${scopeType==='STORE'?'selected':''}>Chi nhánh / Cửa hàng</option></select></div>
        <div class="field" id="bkStoreWrap" style="display:${scopeType==='STORE'?'':'none'}"><label>Chi nhánh / Cửa hàng *</label><select class="inp" id="bkStore"><option value="">-- Chọn chi nhánh / cửa hàng --</option>${stores.map(st=>`<option value="${esc(st.id)}" ${String(st.id)===String(b?.storeId||'')?'selected':''}>${esc(st.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Trạng thái</label><select class="inp" id="bkActive"><option value="1" ${b?.active!==false?'selected':''}>Đang sử dụng</option><option value="0" ${b?.active===false?'selected':''}>Ngừng sử dụng</option></select></div>
        <div class="field"><label>Số dư ban đầu</label><input class="inp right num" id="bkOpening" data-money="1" type="text" inputmode="numeric" min="0" step="1000" value="${Number(b?.openingBalance||0)}"></div>
        <div class="field" style="grid-column:1/-1"><label class="check"><input type="checkbox" id="bkDefault" ${b?.isDefault?'checked':''}> Tài khoản mặc định trong phạm vi này</label></div>
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="acc-bank-save" ${b?`data-id="${esc(b.id)}"`:''}><i class="fa-solid fa-floppy-disk"></i>Lưu tài khoản</button>`,
  });
}
function accountingBankScopeChanged(){
  const wrap=$('#bkStoreWrap'); if(wrap) wrap.style.display=$('#bkScope')?.value==='STORE'?'':'none';
}

function openBankTxForm(bankId) {
  const b = DB.bankAccounts.find((x) => x.id === bankId);
  if (!b) return;
  Modal.open({
    title: `Ghi nhận giao dịch · ${b.name}`,
    body: `<div class="form-grid">
        <div class="field"><label>Loại</label><select class="inp" id="bkTxType"><option value="IN">Tiền vào</option><option value="OUT">Tiền ra</option></select></div>
        <div class="field"><label>Ngày</label><input class="inp" id="bkTxDate" type="date" value="${currentDateYMD()}"></div>
        <div class="field" style="grid-column:1/-1"><label>Số tiền <span class="req">*</span></label><input class="inp right num" id="bkTxAmount" data-money="1" type="text" inputmode="numeric" min="0" step="1000"></div>
        <div class="field" style="grid-column:1/-1"><label>Định khoản <span class="req">*</span></label><select class="inp" id="bkTxAccountingEntry">${accountingEntryOptions('')}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Nội dung</label><input class="inp" id="bkTxNote" placeholder="Nội dung theo sao kê"></div>
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="acc-bank-tx-save" data-id="${esc(bankId)}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`,
  });
}

/* ---- Danh sách đối tác để Kế toán đối chiếu công nợ ---- */
function accSuppliersView() {
  const f=F('acc-suppliers',{q:''});
  const q=String(f.q||'').trim().toLowerCase();
  const list=(DB.suppliers||[]).filter(x=>!q||[x.id,x.name,x.contact,x.phone,x.email,x.taxCode].some(v=>String(v||'').toLowerCase().includes(q)));
  const rows=list.map(x=>`<tr><td><span class="code">${esc(x.id||'—')}</span></td><td><b>${esc(x.name||'—')}</b></td><td>${esc(x.contact||x.contactName||'—')}</td><td>${esc(x.phone||'—')}</td><td>${esc(x.email||'—')}</td><td>${esc(x.taxCode||x.tax_code||'—')}</td><td>${x.active===false?'<span class="badge gray">Ngừng dùng</span>':'<span class="badge green">Đang giao dịch</span>'}</td></tr>`);
  return `${pageHead('Danh sách nhà cung cấp','Kế toán xem master NCC dùng chung với Mua hàng để đối chiếu công nợ','')}
    <div class="card"><div class="toolbar">${searchBox('acc-suppliers','Tìm mã, tên, MST, liên hệ…')}<span class="spacer"></span><span class="chip">${fmtN(list.length)} NCC</span></div>
    ${tableShell([{t:'Mã NCC'},{t:'Nhà cung cấp'},{t:'Liên hệ'},{t:'Điện thoại'},{t:'Email'},{t:'MST'},{t:'Trạng thái'}],rows,{emptyTitle:'Chưa có nhà cung cấp'})}</div>`;
}

function accCustomersView() {
  const f=F('acc-customers',{q:''});
  const q=String(f.q||'').trim().toLowerCase();
  const list=(DB.customers||[]).filter(x=>!q||[x.id,x.name,x.contact,x.phone,x.email,x.taxCode].some(v=>String(v||'').toLowerCase().includes(q)));
  const rows=list.map(x=>`<tr><td><span class="code">${esc(x.id||'—')}</span></td><td><b>${esc(x.name||'—')}</b></td><td>${esc(x.contact||x.contactName||'—')}</td><td>${esc(x.phone||'—')}</td><td>${esc(x.email||'—')}</td><td>${esc(x.taxCode||x.tax_code||'—')}</td><td>${x.active===false?'<span class="badge gray">Ngừng dùng</span>':'<span class="badge green">Đang giao dịch</span>'}</td></tr>`);
  return `${pageHead('Danh sách khách hàng','Kế toán xem master khách hàng dùng chung với CRM để đối chiếu công nợ phải thu','')}
    <div class="card"><div class="toolbar">${searchBox('acc-customers','Tìm mã, tên, MST, liên hệ…')}<span class="spacer"></span><span class="chip">${fmtN(list.length)} khách hàng</span></div>
    ${tableShell([{t:'Mã KH'},{t:'Khách hàng'},{t:'Liên hệ'},{t:'Điện thoại'},{t:'Email'},{t:'MST'},{t:'Trạng thái'}],rows,{emptyTitle:'Chưa có khách hàng'})}</div>`;
}

/* ---- 2.4 Phải thu — dùng chung dữ liệu CRM, không tạo sổ công nợ song song ---- */
function accArView() {
  const f = F('acc-ar', {q:'',customerId:'',status:'',from:'',to:''});
  const q = String(f.q||'').trim().toLowerCase();
  const statusOpts=[['UNPAID','Chưa thanh toán'],['PARTIALLY_PAID','Thanh toán một phần'],['PAID','Đã thanh toán'],['OVERDUE','Quá hạn']];
  const customerOpts=(DB.customers||[]).map(c=>[c.id,`${c.id} · ${c.name}`]);
  let list=AccFin.recognizedOrders().filter(o=>{
    const st=typeof SalesCRM!=='undefined'?SalesCRM.receivableStatus(o):'';
    const d=String(o.date||'').slice(0,10);
    if(f.customerId&&o.customerId!==f.customerId)return false;
    if(f.status&&st!==f.status)return false;
    if(f.from&&d<f.from)return false;
    if(f.to&&d>f.to)return false;
    if(q&&![o.id,Q.customerName(o.customerId)].some(v=>String(v||'').toLowerCase().includes(q)))return false;
    return true;
  }).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.id||'').localeCompare(String(a.id||'')));
  const paidOf=o=>typeof SalesCRM!=='undefined'?SalesCRM.paidOfOrder(o.id):Number(o.paid||0);
  const remainOf=o=>typeof SalesCRM!=='undefined'?SalesCRM.receivableOfOrder(o):Math.max(0,Number(o.total||0)-paidOf(o));
  const statusOf=o=>typeof SalesCRM!=='undefined'?SalesCRM.receivableStatus(o):(remainOf(o)>0?'UNPAID':'PAID');
  const total=list.reduce((s,o)=>s+remainOf(o),0);
  const overdue=list.reduce((s,o)=>s+(statusOf(o)==='OVERDUE'?remainOf(o):0),0);
  const customersInDebt=new Set(list.filter(o=>remainOf(o)>0).map(o=>o.customerId)).size;
  const badgeAr=st=>({UNPAID:'<span class="badge slate">Chưa thanh toán</span>',PARTIALLY_PAID:'<span class="badge orange">Thanh toán một phần</span>',PAID:'<span class="badge green">Đã thanh toán</span>',OVERDUE:'<span class="badge red">Quá hạn</span>'}[st]||esc(st));
  const rows=list.map(o=>{const paid=paidOf(o),remain=remainOf(o),st=statusOf(o);return `<tr>
    <td><span class="code">${esc(o.id)}</span><div class="cell-sub">${fmtDate(o.date)}</div></td>
    <td>${cell2(esc(Q.customerName(o.customerId)),esc(o.customerId||''))}</td>
    <td>${fmtDate(o.paymentDueDate||o.dueDate)}</td>
    <td class="right num">${fmtVND(Number(o.total||0))}</td><td class="right num" style="color:var(--green)">${fmtVND(paid)}</td>
    <td class="right num strong" style="color:${remain>0?'var(--red)':'var(--text-3)'}">${fmtVND(remain)}</td><td>${badgeAr(st)}</td>
    <td class="right">${remain>0?`<button class="btn btn-sm btn-primary" data-act="crm-customer-pay-modal" data-id="${esc(o.id)}"><i class="fa-solid fa-hand-holding-dollar"></i>Thu tiền</button>`:'<span class="muted">Tất toán</span>'}</td></tr>`;});
  const paymentRows=[...(DB.customerPayments||[])].filter(p=>{const d=String(p.date||'').slice(0,10);if(f.customerId&&p.customerId!==f.customerId)return false;if(f.from&&d<f.from)return false;if(f.to&&d>f.to)return false;return true;}).sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||''))).slice(0,100).map(p=>`<tr><td><span class="code">${esc(p.id)}</span>${typeof paymentStatusTag==='function'?paymentStatusTag(p):''}</td><td>${fmtDate(p.date)}</td><td><span class="code">${esc(p.orderId||'—')}</span></td><td>${esc(Q.customerName(p.customerId))}</td><td class="right num strong">${fmtVND(Number(p.amount||0))}</td><td>${esc(p.method||'—')}</td><td>${esc(p.bankName||'—')}</td><td>${esc(p.payerName||p.collectedByName||Q.employeeName(p.createdBy)||'—')}</td></tr>`);
  return `${pageHead('Công nợ phải thu','Nguồn duy nhất từ Đơn hàng bán + lịch sử thu tiền CRM; không nhập công nợ trùng ở CRM','')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Tổng còn phải thu',fmtVND(total),'fa-hand-holding-dollar','teal')}${mkpi('Khách hàng còn nợ',customersInDebt,'fa-users','blue')}${mkpi('Quá hạn',fmtVND(overdue),'fa-triangle-exclamation','orange')}</div>
    <div class="card" style="margin-bottom:14px"><div class="toolbar">${searchBox('acc-ar','Tìm đơn hàng, khách hàng…')}${selectFilter('acc-ar','customerId',customerOpts,'Tất cả khách hàng')}${selectFilter('acc-ar','status',statusOpts,'Tất cả trạng thái')}${(f.q||f.customerId||f.status||f.from||f.to)?'<button class="btn btn-sm" data-act="clear-filter" data-key="acc-ar"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}<label class="field-inline">Từ <input class="inp" type="date" data-f="acc-ar.from" value="${esc(f.from||'')}"></label><label class="field-inline">Đến <input class="inp" type="date" data-f="acc-ar.to" value="${esc(f.to||'')}"></label><span class="spacer"></span><span class="chip">${fmtN(list.length)} đơn</span></div>${tableShell([{t:'Đơn bán'},{t:'Khách hàng'},{t:'Hạn thanh toán'},{t:'Tổng phải thu',cls:'right'},{t:'Đã thu',cls:'right'},{t:'Còn phải thu',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Không có công nợ phải thu phù hợp'})}</div>
    <div class="card"><div class="card-head"><div><h3>Lịch sử thu tiền</h3><p>Dùng chung dữ liệu với đơn hàng và chi tiết khách hàng.</p></div></div>${tableShell([{t:'Mã thu'},{t:'Ngày'},{t:'Đơn hàng'},{t:'Khách hàng'},{t:'Số tiền',cls:'right'},{t:'Phương thức'},{t:'Ngân hàng'},{t:'Người thực hiện'}],paymentRows,{emptyTitle:'Chưa có lịch sử thu tiền'})}</div>`;
}

/* ---- 2.5 Phải chi — dùng chung dữ liệu Mua hàng ---- */
// Khi vào tab này, render ngay bằng snapshot hiện có (giống Công nợ phải thu),
// đồng thời hydrate ngầm các collection nguồn từ server rồi render lại khi xong.
let __accApHydrated = false;
let __accApHydrating = false;

function accApEnsureFreshOnce() {
  if (__accApHydrated || __accApHydrating || typeof PurchaseAPI === 'undefined') return;
  __accApHydrating = true;
  Promise.resolve()
    .then(() => PurchaseAPI.bootstrap?.())
    .then(async () => {
      const jobs=[PurchaseAPI.ensureFresh?.(
        ['purchaseOrders', 'supplierPayments', 'supplierRefunds', 'suppliers'],
        { force: true }
      )];
      if (typeof InventoryAPI !== 'undefined') {
        await InventoryAPI.bootstrap?.();
        jobs.push(InventoryAPI.ensureFresh?.(['goodsIssues','materialReturnHistory'], { force:true }));
      }
      await Promise.all(jobs.filter(Boolean));
    })
    .catch((err) => {
      console.warn('[Accounting/AP] Không tải được dữ liệu KIO; giữ snapshot hiện tại:', err);
    })
    .finally(() => {
      __accApHydrated = true;
      __accApHydrating = false;
      if (State.module === 'accounting' && (State.tab || 'dashboard') === 'ap' && typeof render === 'function') render();
    });
}

function accApView() {
  // Giống công nợ phải thu: render ngay bằng dữ liệu hiện có, không chặn bằng màn hình "đang tải".
  // Dữ liệu mới từ server được đồng bộ ngầm, xong sẽ tự render lại.
  accApEnsureFreshOnce();
  const f=F('acc-ap',{q:'',supplierId:'',status:'',from:'',to:''});
  const q=String(f.q||'').trim().toLowerCase();
  const supplierOpts=(DB.suppliers||[]).map(x=>[x.id,`${x.id} · ${x.name}`]);
  const statusOpts=[['UNPAID','Chưa thanh toán'],['PARTIAL','Thanh toán một phần'],['PAID','Đã thanh toán'],['REFUND_DUE','NCC phải hoàn lại']];
  const paidOf=po=>typeof purchasePaidAmount==='function'?purchasePaidAmount(po):Math.max(Number(po.paid||0),(DB.supplierPayments||[]).filter(p=>String(p.poId)===String(po.id)).reduce((s,p)=>s+Number(p.amount||0),0));
  const remainOf=po=>typeof purchasePayableRemaining==='function'?purchasePayableRemaining(po):Math.max(0,Number(po.total||0)-paidOf(po));
  const refundOf=po=>typeof purchaseSupplierRefundDue==='function'?purchaseSupplierRefundDue(po):0;
  const statusOf=po=>{const paid=paidOf(po),remain=remainOf(po),refund=refundOf(po);return refund>0?'REFUND_DUE':remain<=0?'PAID':paid>0?'PARTIAL':'UNPAID';};
  let list=AccFin.activePOs().filter(po=>{const d=String(po.date||'').slice(0,10);if(f.supplierId&&po.supplierId!==f.supplierId)return false;if(f.status&&statusOf(po)!==f.status)return false;if(f.from&&d<f.from)return false;if(f.to&&d>f.to)return false;if(q&&![po.id,Q.supplierName(po.supplierId)].some(v=>String(v||'').toLowerCase().includes(q)))return false;return true;}).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.id||'').localeCompare(String(a.id||'')));
  const total=list.reduce((s,po)=>s+remainOf(po),0);
  const refundTotal=list.reduce((s,po)=>s+refundOf(po),0);
  const suppliersInDebt=new Set(list.filter(po=>remainOf(po)>0).map(po=>po.supplierId)).size;
  const badgeAp=st=>({UNPAID:'<span class="badge slate">Chưa thanh toán</span>',PARTIAL:'<span class="badge orange">Thanh toán một phần</span>',PAID:'<span class="badge green">Đã thanh toán</span>',REFUND_DUE:'<span class="badge orange">NCC phải hoàn lại</span>'}[st]||esc(st));
  const rows=list.map(po=>{const paid=paidOf(po),remain=remainOf(po),refund=refundOf(po),st=statusOf(po);return `<tr><td><span class="code">${esc(po.id)}</span><div class="cell-sub">${fmtDate(po.date)}</div></td><td>${esc(Q.supplierName(po.supplierId))}</td><td class="right num">${fmtVND(po.total)}</td><td class="right num" style="color:var(--green)">${fmtVND(paid)}</td><td class="right num strong" style="color:${remain>0?'var(--red)':'var(--text-3)'}">${fmtVND(remain)}</td><td class="right num strong" style="color:${refund>0?'var(--orange)':'var(--text-3)'}">${fmtVND(refund)}</td><td>${badgeAp(st)}</td><td class="right">${remain>0?`<button class="btn btn-sm btn-primary" data-act="supplier-pay-modal" data-id="${esc(po.id)}"><i class="fa-solid fa-money-bill-transfer"></i>Thanh toán</button>`:(refund>0?`<button class="btn btn-sm btn-primary" data-act="supplier-refund-modal" data-id="${esc(po.id)}"><i class="fa-solid fa-rotate-left"></i>Nhận hoàn tiền</button>`:'<span class="muted">Tất toán</span>')}</td></tr>`;});
  const paymentRows=[...(DB.supplierPayments||[])].filter(p=>{const d=String(p.date||'').slice(0,10);if(f.supplierId&&p.supplierId!==f.supplierId)return false;if(f.from&&d<f.from)return false;if(f.to&&d>f.to)return false;return true;}).sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||''))).slice(0,100).map(p=>`<tr><td><span class="code">${esc(p.id)}</span></td><td>${fmtDate(p.date)}</td><td><span class="code">${esc(p.poId||'—')}</span></td><td>${esc(Q.supplierName(p.supplierId))}</td><td class="right num strong">${fmtVND(Number(p.amount||0))}</td><td>${esc(p.method||'—')}</td><td>${esc(p.bankName||'—')}</td><td>${esc(p.payerName||Q.employeeName(p.createdBy)||'—')}</td></tr>`);
  const refundRows=[...(DB.supplierRefunds||[])].filter(r=>{const d=String(r.date||'').slice(0,10);if(f.supplierId&&r.supplierId!==f.supplierId)return false;if(f.from&&d<f.from)return false;if(f.to&&d>f.to)return false;return true;}).sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||''))).slice(0,100).map(r=>`<tr><td><span class="code">${esc(r.id)}</span></td><td>${fmtDate(r.date)}</td><td><span class="code">${esc(r.poId||'—')}</span></td><td>${esc(Q.supplierName(r.supplierId))}</td><td class="right num strong" style="color:var(--green)">${fmtVND(Number(r.amount||0))}</td><td>${esc(r.method==='BANK_TRANSFER'?'Chuyển khoản ngân hàng':r.method==='CASH'?'Tiền mặt':r.method||'—')}</td><td>${esc(r.bankName||'—')}</td><td>${esc(r.receivedByName||r.createdByName||'—')}</td></tr>`);
  return `${pageHead('Công nợ phải chi','Nguồn duy nhất từ Đơn đặt hàng mua + lịch sử thanh toán nhà cung cấp','')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Tổng còn phải chi',fmtVND(total),'fa-file-invoice-dollar','red')}${mkpi('NCC phải hoàn lại',fmtVND(refundTotal),'fa-rotate-left','orange')}${mkpi('Nhà cung cấp còn nợ',suppliersInDebt,'fa-building','orange')}</div>
    <div class="card" style="margin-bottom:14px"><div class="toolbar">${searchBox('acc-ap','Tìm PO, nhà cung cấp…')}${selectFilter('acc-ap','supplierId',supplierOpts,'Tất cả nhà cung cấp')}${selectFilter('acc-ap','status',statusOpts,'Tất cả trạng thái')}${(f.q||f.supplierId||f.status||f.from||f.to)?'<button class="btn btn-sm" data-act="clear-filter" data-key="acc-ap"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}<label class="field-inline">Từ <input class="inp" type="date" data-f="acc-ap.from" value="${esc(f.from||'')}"></label><label class="field-inline">Đến <input class="inp" type="date" data-f="acc-ap.to" value="${esc(f.to||'')}"></label><span class="spacer"></span><span class="chip">${fmtN(list.length)} PO</span></div>${tableShell([{t:'Đơn mua'},{t:'Nhà cung cấp'},{t:'Giá trị',cls:'right'},{t:'Đã trả',cls:'right'},{t:'Còn phải chi',cls:'right'},{t:'NCC phải hoàn lại',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Không có công nợ phải chi phù hợp'})}</div>
    <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Lịch sử thanh toán nhà cung cấp</h3><p>Dùng chung dữ liệu với Mua hàng.</p></div></div>${tableShell([{t:'Mã chi'},{t:'Ngày'},{t:'PO'},{t:'Nhà cung cấp'},{t:'Số tiền',cls:'right'},{t:'Phương thức'},{t:'Ngân hàng'},{t:'Người thực hiện'}],paymentRows,{emptyTitle:'Chưa có lịch sử thanh toán'})}</div><div class="card"><div class="card-head"><div><h3>Lịch sử NCC hoàn tiền</h3><p>Khoản doanh nghiệp đã nhận lại sau trả hàng hoặc thanh toán dư.</p></div></div>${tableShell([{t:'Mã nhận hoàn'},{t:'Ngày'},{t:'PO'},{t:'Nhà cung cấp'},{t:'Số tiền nhận',cls:'right'},{t:'Phương thức'},{t:'Ngân hàng nhận'},{t:'Người ghi nhận'}],refundRows,{emptyTitle:'Chưa có NCC hoàn tiền'})}</div>`;
}

/* ---- 2.6 Giá thành ---- */
function accCostingView() {
  const f = F('acc-costing', { status: 'lsx_hoan_thanh' });
  let list = DB.productionOrders.slice();
  if (f.status) list = list.filter((p) => p.status === f.status);
  const rows = list.map((po) => {
    const c = Q.costOf(po.productId);
    if (!c) return '';
    const material = Math.round(c.materialCost * po.qty), labor = Math.round(c.laborCost * po.qty), overhead = Math.round(c.overhead * po.qty);
    const totalCost = material + labor + overhead;
    const sellPrice = c.product.price * po.qty;
    const profit = sellPrice - totalCost;
    return `<tr>
        <td><span class="code" data-act="open-po" data-id="${esc(po.id)}" style="cursor:pointer">${esc(po.id)}</span><div class="cell-sub">${esc(po.productName)}</div></td>
        <td class="num">${fmtN(po.qty)} ${esc(po.unit)}</td>
        <td class="right num">${fmtVND(material)}</td>
        <td class="right num">${fmtVND(labor)}</td>
        <td class="right num">${fmtVND(overhead)}</td>
        <td class="right num strong">${fmtVND(totalCost)}</td>
        <td class="right num">${fmtVND(sellPrice)}</td>
        <td class="right num strong" style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtVND(profit)}</td>
      </tr>`;
  }).join('');

  return `${pageHead('Giá thành sản xuất', 'Tính tự động từ định mức BOM/Routing của từng lệnh sản xuất theo đơn giá hiện hành', '')}
    <div class="card">
      <div class="toolbar">${selectFilter('acc-costing', 'status', statusOptions('lsx_'), 'Tất cả trạng thái')}<span class="spacer"></span><span class="chip">${list.length} lệnh sản xuất</span></div>
      ${tableShell([{ t: 'Lệnh SX' }, { t: 'SL' }, { t: 'CP nguyên liệu', cls: 'right' }, { t: 'CP công đoạn', cls: 'right' }, { t: 'CP quản lý PB', cls: 'right' }, { t: 'Giá thành', cls: 'right' }, { t: 'Doanh thu', cls: 'right' }, { t: 'Lợi nhuận gộp', cls: 'right' }], rows, { emptyTitle: 'Không có lệnh sản xuất phù hợp' })}
    </div>`;
}

/* ---- 2.7 Tài sản cố định ---- */
function accFixedAssetsView() {
  const rows = (DB.fixedAssets || []).map((a) => `<tr>
      <td><span class="code">${esc(a.id)}</span></td>
      <td>${cell2(esc(a.name), esc(a.dept))}</td>
      <td class="num">${fmtDate(a.purchaseDate)}</td>
      <td class="right num">${fmtVND(a.cost)}</td>
      <td class="num center">${a.usefulYears} năm</td>
      <td class="right num">${fmtVND(AccFin.assetAccumDep(a))}</td>
      <td class="right num strong">${fmtVND(AccFin.assetBookValue(a))}</td>
      <td>${a.status === 'disposed' ? badge('vt_het_hang') : badge('vt_du_ton')}</td>
      <td class="right">${rowActions([{ act: 'acc-asset-edit', data: `data-id="${a.id}"`, icon: 'fa-pen', title: 'Sửa' }, { act: 'acc-asset-delete', data: `data-id="${a.id}"`, icon: 'fa-trash', title: 'Xóa' }])}</td>
    </tr>`);
  const totalCost = (DB.fixedAssets || []).reduce((s, a) => s + a.cost, 0);
  const totalNet = AccFin.totalAssetsNet();
  return `${pageHead('Tài sản cố định', 'Khấu hao đường thẳng theo số năm sử dụng, tự tính lại theo ngày hiện tại', '<button class="btn btn-primary" data-act="acc-asset-add"><i class="fa-solid fa-plus"></i>Thêm tài sản</button>')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Nguyên giá', fmtVND(totalCost), 'fa-warehouse', 'blue')}${mkpi('Giá trị còn lại', fmtVND(totalNet), 'fa-scale-balanced', 'green')}${mkpi('Khấu hao lũy kế', fmtVND(totalCost - totalNet), 'fa-chart-line', 'orange')}</div>
    <div class="card">${tableShell([{ t: 'Mã' }, { t: 'Tài sản' }, { t: 'Ngày mua' }, { t: 'Nguyên giá', cls: 'right' }, { t: 'Thời gian KH', cls: 'center' }, { t: 'Khấu hao lũy kế', cls: 'right' }, { t: 'Giá trị còn lại', cls: 'right' }, { t: 'Trạng thái' }, { t: '', cls: 'right' }], rows, { emptyTitle: 'Chưa có tài sản cố định' })}</div>`;
}

function openFixedAssetForm(id = '') {
  const a = id ? (DB.fixedAssets || []).find((x) => x.id === id) : null;
  return Modal.open({
    title: a ? 'Sửa tài sản cố định' : 'Thêm tài sản cố định',
    body: `<div class="form-grid">
        <div class="field" style="grid-column:1/-1"><label>Tên tài sản <span class="req">*</span></label><input class="inp" id="faName" value="${esc(a?.name || '')}"></div>
        <div class="field"><label>Bộ phận sử dụng</label><select class="inp" id="faDept">${DB.departments.map((d) => `<option ${a?.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
        <div class="field"><label>Ngày mua</label><input class="inp" id="faDate" type="date" value="${esc(a?.purchaseDate || currentDateYMD())}"></div>
        <div class="field"><label>Nguyên giá <span class="req">*</span></label><input class="inp right num" id="faCost" data-money="1" type="text" inputmode="numeric" min="0" step="1000" value="${a?.cost || ''}"></div>
        <div class="field"><label>Số năm khấu hao</label><input class="inp right num" id="faYears" type="number" min="1" max="30" value="${a?.usefulYears || 8}"></div>
      </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="acc-asset-save" data-id="${esc(id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`,
  });
}

/* ---- 2.8 Thuế ---- */

/** Bóc tách VAT đầu ra theo từng sản phẩm, có lọc theo sản phẩm + loại sản phẩm (ĐVT) + tên + thời gian */
function accTaxOutputRows(f) {
  const rows = {};
  const q = (f.q || '').toLowerCase().trim();
  AccFin.recognizedOrders().forEach((o) => {
    if (f.from && o.date < f.from) return;
    if (f.to && o.date > f.to) return;
    (o.items || []).forEach((it) => {
      if (f.productId && it.productId !== f.productId) return;
      if (f.unit && it.unit !== f.unit) return;
      if (q && !((it.productId + ' ' + it.name).toLowerCase().includes(q))) return;
      const net = (it.amount || 0) * (1 - (o.discountPct || 0) / 100);
      const vat = net * (o.vatRate || 0) / 100;
      const r = rows[it.productId] || (rows[it.productId] = { productId: it.productId, name: it.name, unit: it.unit, qty: 0, net: 0, vat: 0, count: 0 });
      r.qty += it.qty; r.net += net; r.vat += vat; r.count += 1;
    });
  });
  return Object.values(rows).sort((a, b) => b.vat - a.vat);
}

/** Bóc tách VAT đầu vào theo từng vật tư/nhóm vật tư, có lọc theo nhóm + khoảng thời gian */
function accTaxInputRows(f) {
  const rows = {};
  AccFin.activePOs().forEach((po) => {
    if (f.from && po.date < f.from) return;
    if (f.to && po.date > f.to) return;
    (po.items || []).forEach((it) => {
      const m = Q.material(it.materialId);
      const group = m?.group || '—';
      if (f.group && group !== f.group) return;
      const vat = (it.amount || 0) * (po.vatRate || 0) / 100;
      const r = rows[it.materialId] || (rows[it.materialId] = { materialId: it.materialId, name: it.name, unit: it.unit, group, qty: 0, net: 0, vat: 0 });
      r.qty += it.qty; r.net += it.amount || 0; r.vat += vat;
    });
  });
  return Object.values(rows).sort((a, b) => b.vat - a.vat);
}

function accTaxView() {
  const months = AccFin.last6Months();
  const outMap = AccFin.vatOutputByMonth(), inMap = AccFin.vatInputByMonth();
  let totalOut = 0, totalIn = 0;
  const monthRows = months.map((m) => {
    const out = outMap[m] || 0, inp = inMap[m] || 0;
    totalOut += out; totalIn += inp;
    const payable = out - inp;
    return `<tr><td>${AccFin.fmtMonthShort(m)}/${m.slice(0, 4)}</td><td class="right num">${fmtVND(out)}</td><td class="right num">${fmtVND(inp)}</td><td class="right num strong" style="color:${payable >= 0 ? 'var(--red)' : 'var(--green)'}">${payable >= 0 ? fmtVND(payable) : 'Được khấu trừ ' + fmtVND(-payable)}</td></tr>`;
  });

  const fOut = F('acc-tax-out', { productId: '', unit: '', q: '', from: '', to: '' });
  const outRows = accTaxOutputRows(fOut);
  const outTotalVat = outRows.reduce((s, r) => s + r.vat, 0);
  const productOptions = DB.products.map((p) => `<option value="${esc(p.id)}" ${fOut.productId === p.id ? 'selected' : ''}>${esc(p.id)} — ${esc(p.name)}</option>`).join('');
  const outUnitOptions = [...new Set(DB.products.map((p) => p.unit).filter(Boolean))];

  const fIn = F('acc-tax-in', { group: '', from: '', to: '' });
  const inRows = accTaxInputRows(fIn);
  const inTotalVat = inRows.reduce((s, r) => s + r.vat, 0);
  const materialGroups = [...new Set(DB.materials.map((m) => m.group).filter(Boolean))];

  return `${pageHead('Thuế', 'VAT đầu ra tính theo Đơn hàng bán, VAT đầu vào tính theo Đơn đặt hàng mua — không cần khai báo tay', '<button class="btn" data-act="acc-tax-export"><i class="fa-solid fa-file-export"></i>Xuất chi tiết (theo lọc)</button>')}
    ${accTabsBar('tax')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('VAT đầu ra (6 tháng)', fmtVND(totalOut), 'fa-arrow-up', 'red')}${mkpi('VAT đầu vào (6 tháng)', fmtVND(totalIn), 'fa-arrow-down', 'green')}${mkpi('Thuế TNDN ước tính tháng này', fmtVND(AccFin.pnlOf(AccFin.currentMonth()).tax), 'fa-landmark', 'indigo')}</div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><h3>Tổng hợp theo tháng</h3></div>
      ${tableShell([{ t: 'Tháng' }, { t: 'VAT đầu ra', cls: 'right' }, { t: 'VAT đầu vào', cls: 'right' }, { t: 'Phải nộp / Được khấu trừ', cls: 'right' }], monthRows, { emptyTitle: 'Chưa có dữ liệu' })}
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><div><h3>VAT đầu ra theo sản phẩm</h3><p>Bóc tách từ dòng hàng của các đơn đã giao / hoàn thành</p></div></div>
      <div class="toolbar">
        <input class="inp" type="text" data-f="acc-tax-out.q" value="${esc(fOut.q)}" placeholder="Tìm theo mã/tên sản phẩm…" style="min-width:200px">
        <select class="inp" data-f="acc-tax-out.productId"><option value="">Tất cả sản phẩm</option>${productOptions}</select>
        <select class="inp" data-f="acc-tax-out.unit"><option value="">Tất cả loại sản phẩm (ĐVT)</option>${outUnitOptions.map((u) => `<option value="${esc(u)}" ${fOut.unit === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
        <input class="inp" type="date" data-f="acc-tax-out.from" value="${esc(fOut.from)}" title="Từ ngày">
        <input class="inp" type="date" data-f="acc-tax-out.to" value="${esc(fOut.to)}" title="Đến ngày">
        ${(fOut.productId || fOut.unit || fOut.q || fOut.from || fOut.to) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="acc-tax-out"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
        <span class="spacer"></span><span class="chip">${outRows.length} sản phẩm · VAT ${fmtVND(outTotalVat)}</span>
      </div>
      ${tableShell([{ t: 'Sản phẩm' }, { t: 'Loại (ĐVT)' }, { t: 'Số lượt bán', cls: 'center' }, { t: 'Số lượng bán', cls: 'right' }, { t: 'Doanh thu trước VAT', cls: 'right' }, { t: 'VAT đầu ra', cls: 'right' }, { t: 'Tổng thanh toán', cls: 'right' }],
        outRows.map((r) => `<tr><td>${cell2(esc(r.name), esc(r.productId))}</td><td>${esc(r.unit)}</td><td class="center num">${r.count}</td><td class="right num">${fmtN(r.qty)} ${esc(r.unit)}</td><td class="right num">${fmtVND(r.net)}</td><td class="right num strong" style="color:var(--red)">${fmtVND(r.vat)}</td><td class="right num">${fmtVND(r.net + r.vat)}</td></tr>`),
        { emptyTitle: 'Không có dữ liệu phù hợp bộ lọc' })}
    </div>

    <div class="card">
      <div class="card-head"><div><h3>VAT đầu vào theo nhóm vật tư</h3><p>Bóc tách từ dòng hàng của các đơn đặt hàng mua</p></div></div>
      <div class="toolbar">
        <select class="inp" data-f="acc-tax-in.group"><option value="">Tất cả nhóm vật tư</option>${materialGroups.map((g) => `<option value="${esc(g)}" ${fIn.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
        <input class="inp" type="date" data-f="acc-tax-in.from" value="${esc(fIn.from)}">
        <input class="inp" type="date" data-f="acc-tax-in.to" value="${esc(fIn.to)}">
        ${(fIn.group || fIn.from || fIn.to) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="acc-tax-in"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
        <span class="spacer"></span><span class="chip">${inRows.length} vật tư · VAT ${fmtVND(inTotalVat)}</span>
      </div>
      ${tableShell([{ t: 'Vật tư' }, { t: 'Nhóm' }, { t: 'Số lượng mua', cls: 'right' }, { t: 'Giá trị trước VAT', cls: 'right' }, { t: 'VAT đầu vào', cls: 'right' }],
        inRows.map((r) => `<tr><td>${cell2(esc(r.name), esc(r.materialId))}</td><td>${esc(r.group)}</td><td class="right num">${fmtN(r.qty)} ${esc(r.unit)}</td><td class="right num">${fmtVND(r.net)}</td><td class="right num strong" style="color:var(--green)">${fmtVND(r.vat)}</td></tr>`),
        { emptyTitle: 'Không có dữ liệu phù hợp bộ lọc' })}
    </div>`;
}

/* ---- 2.9 Ngân sách vs Thực tế ---- */
function accBudgetView() {
  const rows = (DB.budgets || []).map((b) => {
    const actual = AccFin.deptActualSpend(b.dept);
    const pct = b.totalBudget ? Math.round((actual / b.totalBudget) * 100) : 0;
    return `<tr><td class="strong">${esc(b.dept)}</td><td class="right num">${fmtVND(b.totalBudget)}</td><td class="right num">${fmtVND(actual)}</td><td class="right num" style="color:${b.totalBudget - actual >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtVND(b.totalBudget - actual)}</td><td style="min-width:160px">${progressBar(pct)}</td></tr>`;
  });
  return `${pageHead('Ngân sách vs Thực tế', 'Thực chi lấy trực tiếp từ Đề nghị mua hàng (PR) đã duyệt/chờ duyệt theo từng bộ phận', '')}
    ${accTabsBar('budget')}
    <div class="card">${tableShell([{ t: 'Bộ phận' }, { t: 'Ngân sách', cls: 'right' }, { t: 'Thực chi', cls: 'right' }, { t: 'Còn lại', cls: 'right' }, { t: '% sử dụng' }], rows, { emptyTitle: 'Chưa cấu hình ngân sách' })}</div>`;
}

/* ---- 2.10 P&L ---- */
function accPnlView() {
  const f = F(
    'acc-report-pnl',
    accDefaultReportFilter('acc-report-pnl')
  );

  const today = currentDateYMD();
  let from = f.from;
  let to = f.to;

  /* Nếu chọn tháng */
  if (f.period === 'month' && f.year && f.month) {
    from =
      `${f.year}-${String(f.month).padStart(2, '0')}-01`;

    const lastDay =
      new Date(
        Number(f.year),
        Number(f.month),
        0
      ).getDate();

    to =
      `${f.year}-${String(f.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }

  /* Quý */
  if (f.period === 'quarter' && f.year && f.quarter) {
    const q = Number(f.quarter);
    const startMonth = (q - 1) * 3 + 1;

    from =
      `${f.year}-${String(startMonth).padStart(2, '0')}-01`;

    const endMonth = startMonth + 2;

    const lastDay =
      new Date(
        Number(f.year),
        endMonth,
        0
      ).getDate();

    to =
      `${f.year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }

  /* Năm */
  if (f.period === 'year' && f.year) {
    from = `${f.year}-01-01`;
    to = `${f.year}-12-31`;
  }

  from = from || `${today.slice(0, 7)}-01`;
  to = to || today;

  const months = Object.keys(AccFin.revenueByMonth())
    .filter((m) => {
      const start = `${m}-01`;
      return start >= from.slice(0, 7) &&
             start <= to.slice(0, 7);
    });

  const revenueMap = AccFin.revenueByMonth();
  const cogsMap = AccFin.cogsByMonth();
  const opexMap = AccFin.opexByMonth();

  let revenue = 0;
  let cogs = 0;
  let opex = 0;

  months.forEach((m) => {
    revenue += revenueMap[m] || 0;
    cogs += cogsMap[m] || 0;
    opex += opexMap[m] || 0;
  });

  const grossProfit = revenue - cogs;
  const ebt = grossProfit - opex;

  const taxRate =
    Number(DB.accountingSettings.corporateTaxRatePct || 0);

  const tax =
    Math.max(
      0,
      Math.round(ebt * taxRate / 100)
    );

  const netProfit = ebt - tax;

  return `${pageHead(
    'Báo cáo Lãi lỗ (P&L)',
    `Kỳ báo cáo: ${fmtDate(from)} → ${fmtDate(to)}`,
    '<button class="btn" data-act="export-report" data-key="pnl"><i class="fa-solid fa-file-export"></i>Xuất báo cáo</button>'
  )}
  ${accTabsBar('pnl')}
  <div class="card" style="margin-bottom:14px">
    <div class="toolbar">
      <select class="inp" data-f="acc-report-pnl.period">
        <option value="month" ${f.period === 'month' ? 'selected' : ''}>Theo tháng</option>
        <option value="quarter" ${f.period === 'quarter' ? 'selected' : ''}>Theo quý</option>
        <option value="year" ${f.period === 'year' ? 'selected' : ''}>Theo năm</option>
        <option value="custom" ${f.period === 'custom' ? 'selected' : ''}>Tùy chọn ngày</option>
      </select>

      ${
        f.period !== 'custom'
          ? `<input class="inp" type="number" min="2020" max="2100" data-f="acc-report-pnl.year" value="${esc(f.year || new Date().getFullYear())}" style="width:110px">`
          : ''
      }

      ${
        f.period === 'month'
          ? `<select class="inp" data-f="acc-report-pnl.month">
              ${Array.from({ length: 12 }, (_, i) => {
                const v = String(i + 1).padStart(2, '0');
                return `<option value="${v}" ${f.month === v ? 'selected' : ''}>Tháng ${i + 1}</option>`;
              }).join('')}
            </select>`
          : ''
      }

      ${
        f.period === 'quarter'
          ? `<select class="inp" data-f="acc-report-pnl.quarter">
              ${[1, 2, 3, 4].map((q) =>
                `<option value="${q}" ${Number(f.quarter) === q ? 'selected' : ''}>Quý ${q}</option>`
              ).join('')}
            </select>`
          : ''
      }

      ${
        f.period === 'custom'
          ? `<input class="inp" type="date" data-f="acc-report-pnl.from" value="${esc(f.from || '')}">
            <input class="inp" type="date" data-f="acc-report-pnl.to" value="${esc(f.to || '')}">`
          : ''
      }

      <span class="spacer"></span>
      <span class="chip">
        ${accReportPeriodLabel(f.period, from, to)}
      </span>
    </div>
  </div>

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi(
      'Doanh thu thuần',
      fmtVND(revenue),
      'fa-sack-dollar',
      'blue'
    )}

    ${mkpi(
      'Giá vốn',
      fmtVND(cogs),
      'fa-cubes',
      'orange'
    )}

    ${mkpi(
      'Lợi nhuận gộp',
      fmtVND(grossProfit),
      'fa-chart-line',
      'green'
    )}

    ${mkpi(
      'Chi phí hoạt động',
      fmtVND(opex),
      'fa-receipt',
      'red'
    )}

    ${mkpi(
      'Lợi nhuận sau thuế',
      fmtVND(netProfit),
      'fa-money-bill-trend-up',
      netProfit >= 0 ? 'green' : 'red'
    )}

  </div>

  <div class="card">
    <div class="card-body">

      ${tableShell(
        [
          { t: 'Chỉ tiêu' },
          { t: 'Kỳ báo cáo', cls: 'right' }
        ],

        [
          `<tr>
            <td>Doanh thu thuần</td>
            <td class="right num">${fmtVND(revenue)}</td>
          </tr>`,

          `<tr>
            <td>Giá vốn hàng bán</td>
            <td class="right num">${fmtVND(-cogs)}</td>
          </tr>`,

          `<tr style="font-weight:700;background:var(--surface-2)">
            <td>Lợi nhuận gộp</td>
            <td class="right num">${fmtVND(grossProfit)}</td>
          </tr>`,

          `<tr>
            <td>Chi phí hoạt động</td>
            <td class="right num">${fmtVND(-opex)}</td>
          </tr>`,

          `<tr style="font-weight:700">
            <td>Lợi nhuận trước thuế</td>
            <td class="right num">${fmtVND(ebt)}</td>
          </tr>`,

          `<tr>
            <td>Thuế TNDN ước tính (${taxRate}%)</td>
            <td class="right num">${fmtVND(-tax)}</td>
          </tr>`,

          `<tr style="font-weight:700;background:var(--surface-2)">
            <td>Lợi nhuận sau thuế</td>
            <td class="right num">${fmtVND(netProfit)}</td>
          </tr>`
        ]
      )}

    </div>
  </div>`;
}

/* ---- 2.11 Balance Sheet ---- */
function accBalanceSheetView() {
  const cash = AccFin.totalBankBalance();
  const ar = AccFin.totalAR();
  const inv = AccFin.inventoryBookValue();
  const assets = AccFin.totalAssetsNet();
  const totalAssets = cash + ar + inv + assets;
  const ap = AccFin.totalAP();
  const equity = totalAssets - ap; // cân đối kế toán: Vốn CSH = Tổng TS - Nợ phải trả
  return `${pageHead('Bảng cân đối kế toán (Balance Sheet)', `Số liệu tại ngày ${fmtDate(TODAY)}`, '')}
    ${accTabsBar('balance_sheet')}
    <div class="grid g-2">
      <div class="card">
        <div class="card-head"><h3>TÀI SẢN</h3></div>
        ${tableShell([{ t: '' }, { t: '', cls: 'right' }], [
          `<tr><td>Tiền &amp; tương đương tiền (ngân hàng)</td><td class="right num">${fmtVND(cash)}</td></tr>`,
          `<tr><td>Phải thu khách hàng</td><td class="right num">${fmtVND(ar)}</td></tr>`,
          `<tr><td>Hàng tồn kho (NVL + thành phẩm)</td><td class="right num">${fmtVND(inv)}</td></tr>`,
          `<tr><td>Tài sản cố định (giá trị còn lại)</td><td class="right num">${fmtVND(assets)}</td></tr>`,
          `<tr style="font-weight:700;background:var(--surface-2)"><td>TỔNG TÀI SẢN</td><td class="right num">${fmtVND(totalAssets)}</td></tr>`,
        ])}
      </div>
      <div class="card">
        <div class="card-head"><h3>NGUỒN VỐN</h3></div>
        ${tableShell([{ t: '' }, { t: '', cls: 'right' }], [
          `<tr><td>Phải trả nhà cung cấp</td><td class="right num">${fmtVND(ap)}</td></tr>`,
          `<tr style="font-weight:700"><td>TỔNG NỢ PHẢI TRẢ</td><td class="right num">${fmtVND(ap)}</td></tr>`,
          `<tr><td>Vốn chủ sở hữu (cân đối)</td><td class="right num">${fmtVND(equity)}</td></tr>`,
          `<tr style="font-weight:700;background:var(--surface-2)"><td>TỔNG NGUỒN VỐN</td><td class="right num">${fmtVND(ap + equity)}</td></tr>`,
        ])}
      </div>
    </div>
    <p class="cell-sub" style="margin-top:10px">Vốn chủ sở hữu được suy ra để cân đối (Tổng tài sản − Nợ phải trả) vì hệ thống demo chưa có sổ vốn góp/lợi nhuận giữ lại riêng.</p>`;
}

/* ---- 2.12 Cashflow statement ---- */
function accCashflowStatementView() {
  const f = F(
    'acc-report-cashflow',
    accDefaultReportFilter('acc-report-cashflow')
  );

  const from =
    f.from ||
    `${AccFin.currentMonth()}-01`;

  const to =
    f.to ||
    currentDateYMD();

  const groupBy =
    f.groupBy || 'month';

  let rows = accAllCashRows().filter((r) =>
    accDateInRange(r.date, from, to)
  );

  if (f.type) {
    rows = rows.filter((r) =>
      r.type === f.type
    );
  }

  const groups = {};

  rows.forEach((r) => {
    const key =
      accGroupKey(r.date, groupBy);

    if (!groups[key]) {
      groups[key] = {
        in: 0,
        out: 0
      };
    }

    if (r.type === 'THU') {
      groups[key].in += Number(r.amount || 0);
    } else {
      groups[key].out += Number(r.amount || 0);
    }
  });

  const keys =
    Object.keys(groups).sort();

  let running = 0;

  const totalIn = rows
    .filter((r) => r.type === 'THU')
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  const totalOut = rows
    .filter((r) => r.type === 'CHI')
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  const htmlRows = keys.map((key) => {
    const inn = groups[key].in;
    const out = groups[key].out;
    const net = inn - out;

    running += net;

    return `
      <tr>

        <td>
          ${esc(accGroupLabel(key, groupBy))}
        </td>

        <td class="right num"
          style="color:var(--green)">
          ${fmtVND(inn)}
        </td>

        <td class="right num"
          style="color:var(--red)">
          ${fmtVND(out)}
        </td>

        <td
          class="right num strong"
          style="color:${net >= 0
            ? 'var(--green)'
            : 'var(--red)'}"
        >
          ${net >= 0 ? '+' : ''}
          ${fmtVND(net)}
        </td>

        <td class="right num">
          ${fmtVND(running)}
        </td>

      </tr>
    `;
  });

  return `${pageHead(
    'Báo cáo lưu chuyển tiền tệ (Cashflow)',
    `Kỳ báo cáo: ${fmtDate(from)} → ${fmtDate(to)}`,
    '<button class="btn" data-act="export-report" data-key="cashflow"><i class="fa-solid fa-file-export"></i>Xuất báo cáo</button>'
  )}

  ${accTabsBar('cashflow')}

  <div class="card" style="margin-bottom:14px">

    <div class="toolbar">

      <select
        class="inp"
        data-f="acc-report-cashflow.groupBy"
      >
        <option value="month" ${groupBy === 'month' ? 'selected' : ''}>
          Gom theo tháng
        </option>

        <option value="quarter" ${groupBy === 'quarter' ? 'selected' : ''}>
          Gom theo quý
        </option>

        <option value="year" ${groupBy === 'year' ? 'selected' : ''}>
          Gom theo năm
        </option>
      </select>

      ${selectFilter(
        'acc-report-cashflow',
        'type',
        [
          ['THU', 'Thu'],
          ['CHI', 'Chi']
        ],
        'Tất cả Thu / Chi'
      )}

      <input
        class="inp"
        type="date"
        data-f="acc-report-cashflow.from"
        value="${esc(from)}"
      >

      <input
        class="inp"
        type="date"
        data-f="acc-report-cashflow.to"
        value="${esc(to)}"
      >

      <span class="spacer"></span>

      <span class="chip">
        ${rows.length} giao dịch
      </span>

    </div>

  </div>

  <div
    class="grid g-auto-sm"
    style="margin-bottom:14px"
  >

    ${mkpi(
      'Tổng thu',
      fmtVND(totalIn),
      'fa-arrow-down',
      'green'
    )}

    ${mkpi(
      'Tổng chi',
      fmtVND(totalOut),
      'fa-arrow-up',
      'red'
    )}

    ${mkpi(
      'Dòng tiền thuần',
      fmtVND(totalIn - totalOut),
      'fa-scale-balanced',
      totalIn >= totalOut ? 'blue' : 'orange'
    )}

    ${mkpi(
      'Tồn quỹ hiện tại',
      fmtVND(AccFin.totalBankBalance()),
      'fa-building-columns',
      'indigo'
    )}

  </div>

  <div class="card">

    ${tableShell(
      [
        { t: 'Kỳ' },
        { t: 'Thu', cls: 'right' },
        { t: 'Chi', cls: 'right' },
        { t: 'Dòng tiền thuần', cls: 'right' },
        { t: 'Lũy kế', cls: 'right' }
      ],
      htmlRows,
      {
        emptyTitle:
          'Không có dữ liệu dòng tiền trong kỳ'
      }
    )}

  </div>`;
}

/* ---- 2.13 Sổ nhật ký chung / Hạch toán ---- */
function accLedgerView() {
  const f = F('acc-ledger', {
    type: '',
    from: '',
    to: '',
    source: '',
    q: ''
  });

  let rows = accAllCashRows();

  /* Lọc Thu / Chi */
  if (f.type) {
    rows = rows.filter((r) => r.type === f.type);
  }

  /* Lọc khoảng ngày */
  if (f.from || f.to) {
    rows = rows.filter((r) =>
      accDateInRange(r.date, f.from, f.to)
    );
  }

  /* Lọc nguồn */
  if (f.source) {
    rows = rows.filter((r) => {
      const source = String(r.source || '').toLowerCase();
      return source.includes(String(f.source).toLowerCase());
    });
  }

  /* Tìm kiếm */
  if (f.q) {
    rows = rows.filter((r) =>
      accTextMatch(
        [
          r.id,
          r.ref,
          r.note,
          r.source,
          r.kind,
          r.date
        ],
        f.q
      )
    );
  }

  const totalIn = rows
    .filter((r) => r.type === 'THU')
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  const totalOut = rows
    .filter((r) => r.type === 'CHI')
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  const pg = paged(rows, 'acc-ledger', 20);

  const sourceOptions = [
    ['', 'Tất cả nguồn'],
    ['Tự động', 'Tự động'],
    ['Thủ công', 'Thủ công']
  ];

  return `${pageHead(
    'Sổ nhật ký chung',
    'Tổng hợp các nghiệp vụ thu – chi từ công nợ, mua hàng, bán hàng và giao dịch thủ công',
    '<button class="btn" data-act="export-report" data-key="general-ledger"><i class="fa-solid fa-file-export"></i>Xuất sổ</button>'
  )}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi(
      'Tổng thu',
      fmtVND(totalIn),
      'fa-arrow-down',
      'green'
    )}

    ${mkpi(
      'Tổng chi',
      fmtVND(totalOut),
      'fa-arrow-up',
      'red'
    )}

    ${mkpi('Dòng tiền thuần',fmtVND(totalIn - totalOut),'fa-scale-balanced',totalIn >= totalOut ? 'blue' : 'orange')}
    ${mkpi('Số nghiệp vụ',fmtN(rows.length),'fa-list-check','indigo')}
  </div>

  <div class="card">
    <div class="toolbar">
      ${selectFilter('acc-ledger','type',
        [
          ['THU', 'Thu'],
          ['CHI', 'Chi']
        ],
        'Tất cả Thu / Chi'
      )}

      <select class="inp" data-f="acc-ledger.source" style="min-width:150px">
        ${sourceOptions.map(([v, label]) =>
          `<option value="${esc(v)}" ${f.source === v ? 'selected' : ''}>
            ${esc(label)}
          </option>`
        ).join('')}
      </select>
	  <span class="muted" style="font-size:13px;white-space:nowrap">Từ ngày</span>
      <input class="inp" type="date" data-f="acc-ledger.from" value="${esc(f.from || '')}">
	  <span class="muted" style="font-size:13px;white-space:nowrap">Đến ngày</span>
      <input class="inp" type="date" data-f="acc-ledger.to" value="${esc(f.to || '')}">
      <input class="inp" type="search" data-f="acc-ledger.q" value="${esc(f.q || '')}" placeholder="Tìm mã, diễn giải, chứng từ..." style="min-width:230px">

      ${(f.type || f.source || f.from || f.to || f.q)
        ? `<button class="btn btn-sm" data-act="clear-filter" data-key="acc-ledger">
            <i class="fa-solid fa-filter-circle-xmark"></i>
            Xóa lọc
          </button>`
        : ''
      }

      <span class="spacer"></span>
      <span class="chip">
        ${rows.length} nghiệp vụ
      </span>
    </div>

    ${tableShell(
      [
        { t: 'Ngày' },
        { t: 'Loại' },
        { t: 'Diễn giải' },
        { t: 'Định khoản' },
        { t: 'Chứng từ' },
        { t: 'Nguồn' },
        { t: 'Số tiền', cls: 'right' }
      ],
      pg.items.map((r) => `
        <tr>
          <td class="num">
            ${fmtDate(r.date)}
          </td>
          <td>
            ${
              r.type === 'THU'
                ? '<span class="badge green">Thu</span>'
                : '<span class="badge red">Chi</span>'
            }
          </td>
          <td>
            ${cell2(esc(r.note),esc(r.kind || ''))}
          </td>
          <td>${r.accountingEntryId ? `<span class="code">${esc(accountingEntryLabel(r.accountingEntryId))}</span>` : '<span class="muted">Chưa gắn</span>'}</td>
          <td>
            ${
              r.ref
                ? `<span class="code">${esc(r.ref)}</span>`
                : '<span class="muted">—</span>'
            }
          </td>
          <td class="muted">
            ${esc(r.source || '')}
          </td>
          <td class="right num strong"
            style="color:${r.type === 'THU'
              ? 'var(--green)'
              : 'var(--red)'}">
            ${r.type === 'THU' ? '+' : '−'}${fmtVND(r.amount)}
          </td>
        </tr>
      `),

      {
        emptyTitle: 'Không có nghiệp vụ phù hợp với bộ lọc'
      }
    )}

    ${pagiHTML(
      'acc-ledger',
      pg,
      'nghiệp vụ'
    )}

  </div>`;
}

/* ---- 2.14 Hub báo cáo ---- */
function accReportsHubView() {
  const cards = [
    ['pnl', 'fa-chart-line', 't-blue', 'Báo cáo Lãi lỗ (P&L)', 'Doanh thu, giá vốn, chi phí và lợi nhuận theo tháng'],
    ['balance_sheet', 'fa-scale-balanced', 't-indigo', 'Bảng cân đối kế toán', 'Tài sản, nợ phải trả và vốn chủ sở hữu tại một thời điểm'],
    ['cashflow', 'fa-money-bill-trend-up', 't-green', 'Lưu chuyển tiền tệ', 'Dòng tiền vào/ra và tồn quỹ lũy kế theo tháng'],
    ['budget', 'fa-bullseye', 't-orange', 'Ngân sách vs Thực tế', 'So sánh ngân sách được cấp với thực chi mua hàng'],
  ];
  return `${pageHead('Báo cáo tài chính', 'Chọn báo cáo quản trị đa chiều cần xem', '')}
    ${accTabsBar('reports_hub')}
    <div class="grid g-3">${cards.map(([tab, icon, tone, title, sub]) => `<div class="report-card" data-act="nav" data-id="accounting" data-tab="${tab}"><span class="rc-ico ${tone}"><i class="fa-solid ${icon}"></i></span><b>${esc(title)}</b><span>${esc(sub)}</span></div>`).join('')}</div>`;
}

/* --------------------------------------------------------------- 3. ROUTER */
Views.accounting = function () {
  const tab = State.tab || 'dashboard';
  // Tab 'ap' tự hydrate trong accApView(); các tab còn lại hydrate ngầm tại đây.
  if (tab !== 'ap') accHydrateForTab(tab);
  switch (tab) {
    case 'dashboard': return accDashboardView();
    case 'entries': return accEntriesView();
    case 'cashflow_inout': return accCashflowInOutView();
    case 'banking': return accBankingView();
    case 'ar': return accArView();
    case 'ap': return accApView();
    case 'costing': return accCostingView();
    case 'fixed_assets': return accFixedAssetsView();
    case 'tax': return accTaxView();
    case 'budget': return accBudgetView();
    case 'pnl': return accPnlView();
    case 'balance_sheet': return accBalanceSheetView();
    case 'cashflow': return accCashflowStatementView();
    case 'general_ledger': return accLedgerView();
    case 'reports': case 'reports_hub': return accReportsHubView();
    default: return accDashboardView();
  }
};
Views.accounting.after = function () { if ((State.tab || 'dashboard') === 'dashboard') accDashboardView.after(); };

/* --------------------------------------------------------------- 4. ACTIONS
 * Gắn thêm vào Actions toàn cục (đã được app.js khởi tạo trước khi file này
 * chạy — xem hướng dẫn nạp script cuối file). */
Object.assign(Actions, {
  'acc-entry-subtab': (d) => { accEntrySubtab().subtab=d.id==='master'?'master':'summary'; render(); },
  'acc-entry-new': () => openAccountingEntryForm(),
  'acc-entry-edit': (d) => openAccountingEntryForm(d.id),
  'acc-entry-save': async (d={}) => { const number=$('#aeNumber')?.value.trim()||'', name=$('#aeName')?.value.trim()||'', debitAccount=$('#aeDebit')?.value.trim()||'', creditAccount=$('#aeCredit')?.value.trim()||'', flow=$('#aeFlow')?.value||'BOTH', active=$('#aeActive')?.value!=='0', autoUsage=$('#aeAutoUsage')?.value||'', description=$('#aeDescription')?.value.trim()||''; if(!number||!name||!debitAccount||!creditAccount){Toast.err('Thiếu thông tin','Số định khoản, tên, tài khoản Nợ và tài khoản Có là bắt buộc.');return;} const duplicate=(DB.accountingEntries||[]).find(x=>String(x.number||'').toLowerCase()===number.toLowerCase()&&String(x.id)!==String(d.id||'')); if(duplicate){Toast.err('Trùng số định khoản',`Định khoản ${number} đã tồn tại.`);return;} if(autoUsage && active){ const occupied=(DB.accountingEntries||[]).find(x=>x.active!==false&&String(x.autoUsage||'')===autoUsage&&String(x.id)!==String(d.id||'')); if(occupied){Toast.err('Nghiệp vụ đã có định khoản mặc định',`${accountingAutoUsageLabel(autoUsage)} đang dùng ${occupied.number||occupied.id} · ${occupied.name||''}. Hãy sửa hoặc ngừng dùng định khoản đó trước.`);return;} } let row=d.id?accountingEntryById(d.id):null; if(!row){row={id:nextCode('DK-2026-',DB.accountingEntries||[]),createdAt:new Date().toISOString(),createdBy:DB.currentUser?.id||''}; DB.accountingEntries.unshift(row);} Object.assign(row,{number,name,debitAccount,creditAccount,flow,active,autoUsage,description,updatedAt:new Date().toISOString(),updatedBy:DB.currentUser?.id||''}); try{await accountingEntrySaveRecord(row); Modal.close(); render(); Toast.ok('Đã lưu định khoản',`${number} · ${name}`);}catch(err){Toast.err('Không lưu được định khoản',err?.message||'Vui lòng thử lại.');} },
  'acc-entry-delete': async (d) => { const e=accountingEntryById(d.id); if(!e)return; const used=accountingEntryUsage(e.id); if(used.length){Toast.warn('Không thể xóa',`Định khoản ${e.number||e.id} đã có ${used.length} giao dịch thu/chi ghi nhận.`);return;} if(!confirm(`Xóa định khoản “${e.number||e.id} · ${e.name||''}”?`))return; try{await accountingEntryDeleteRecord(e.id);render();Toast.ok('Đã xóa định khoản');}catch(err){Toast.err('Không xóa được định khoản',err?.message||'Vui lòng thử lại.');} },
  'acc-cash-add': async (d) => { await accountingEntriesEnsureFresh(false); openCashTxForm(d.type); },
  'acc-cash-save': async (d) => {
    const date = $('#ctxDate')?.value || currentDateYMD();
    const amount = parseMoney($('#ctxAmount')?.value) || 0;
    if (amount <= 0) { Toast.err('Số tiền không hợp lệ', 'Vui lòng nhập số tiền lớn hơn 0.'); return; }
    const accountingEntryId = $('#ctxAccountingEntry')?.value || '';
    if (!accountingEntryId) { Toast.err('Chưa chọn định khoản','Mọi khoản thu/chi bắt buộc phải chọn định khoản đã khai báo.'); return; }
    const category = $('#ctxCategory')?.value || '';
    const note = $('#ctxNote')?.value.trim() || category;
    const method = $('#ctxMethod')?.value || 'CASH';
    const bankId = method === 'BANK_TRANSFER' ? ($('#ctxBank')?.value || '') : '';
    if (method === 'BANK_TRANSFER' && !bankId) { Toast.err('Chưa chọn ngân hàng','Vui lòng chọn tài khoản ngân hàng cho khoản chuyển khoản.'); return; }
    // Phải có danh sách thật từ server trước khi sinh mã: nếu DB.cashTransactions còn rỗng
    // thì mã SQ-2026-001 sẽ trùng bản ghi đã có trên server và bị ghi đè khi đồng bộ.
    try { if (typeof RestaurantQualityAPI !== 'undefined') await RestaurantQualityAPI.ensureFresh(['cashTransactions','bankAccounts'], {force:false}); } catch(err) {}
    const row = { id: nextCode('SQ-2026-', DB.cashTransactions), type: d.type, date, amount, accountingEntryId, category, note, method: method==='BANK_TRANSFER'?'Chuyển khoản':'Tiền mặt', bankId, createdBy: DB.currentUser?.id || '' };
    DB.cashTransactions.unshift(row);
    try {
      if (bankId) await AccountingBank.record({ bankId, type:d.type==='THU'?'IN':'OUT', date, amount, note, sourceType:'CASH_TX', sourceId:row.id, accountingEntryId });
      // Trước đây bước này bị thiếu: sổ thu-chi chỉ nằm trong RAM nên mất khi F5.
      if (typeof RestaurantQualityAPI !== 'undefined') await RestaurantQualityAPI.syncRestaurant(['cashTransactions']);
      Modal.close(); render();
      Toast.ok('Đã ghi nhận', `${d.type === 'THU' ? 'Thu' : 'Chi'} ${fmtVND(amount)} · ${note}`);
    } catch(err) {
      DB.cashTransactions = (DB.cashTransactions||[]).filter(x=>x.id!==row.id);
      if (bankId) { try { await AccountingBank.removeBySource('CASH_TX', row.id); } catch(_) {} }
      Toast.err('Không lưu được giao dịch', err?.message || 'Vui lòng thử lại.');
    }
  },
  'acc-cash-delete': async (d) => {
    const before = JSON.parse(JSON.stringify(DB.cashTransactions || []));
    const target = before.find((t) => t.id === d.id);
    if (!target) return;
    try {
      if (typeof RestaurantQualityAPI !== 'undefined') await RestaurantQualityAPI.deleteRestaurant('cashTransactions', d.id);
      else DB.cashTransactions = DB.cashTransactions.filter((t) => t.id !== d.id);
      // Khoản thu/chi chuyển khoản đã ghi một dòng vào sổ ngân hàng — xóa cùng.
      if (target.bankId) await AccountingBank.removeBySource('CASH_TX', d.id);
      render(); Toast.ok('Đã xóa giao dịch');
    } catch (err) {
      DB.cashTransactions = before;
      Toast.err('Không xóa được trên server', err?.message || 'Vui lòng thử lại.');
    }
  },

  'acc-bank-add': async () => {
    try { if (typeof RestaurantQualityAPI !== 'undefined') await RestaurantQualityAPI.ensureFresh(['stores','bankAccounts'], {force:false}); } catch(err) {}
    openBankAccountForm();
  },
  'acc-bank-save': async (d = {}) => {
    const name = $('#bkName')?.value.trim() || '';
    const bankName = $('#bkBankName')?.value.trim() || '';
    const accountNumber = $('#bkNumber')?.value.trim() || '';
    const accountName = $('#bkAccountName')?.value.trim() || '';
    const scopeType = $('#bkScope')?.value || 'COMPANY';
    const storeId = scopeType === 'STORE' ? ($('#bkStore')?.value || '') : '';
    if (!name || !bankName || !accountNumber) { Toast.err('Thiếu thông tin tài khoản', 'Tên gợi nhớ, ngân hàng và số tài khoản là bắt buộc.'); return; }
    if (scopeType === 'STORE' && !storeId) { Toast.err('Chưa chọn chi nhánh / cửa hàng', 'Tài khoản theo chi nhánh phải được gắn với một cửa hàng cụ thể.'); return; }
    const before = JSON.parse(JSON.stringify(DB.bankAccounts || []));
    const isDefault = !!$('#bkDefault')?.checked;
    if (isDefault) {
      for (const x of DB.bankAccounts || []) {
        if (x.scopeType === scopeType && (scopeType === 'COMPANY' || String(x.storeId) === String(storeId))) x.isDefault = false;
      }
    }
    const editing = d.id ? (DB.bankAccounts || []).find(x => String(x.id) === String(d.id)) : null;
    if (d.id && !editing) { Toast.err('Không tìm thấy tài khoản'); return; }
    if (editing && (Math.abs(AccFin.bankBalance(editing.id)) >= 0.5 || (Array.isArray(editing.transactions) && editing.transactions.length))) { Toast.warn('Không thể chỉnh sửa', 'Tài khoản đã có số dư hoặc đã phát sinh giao dịch.'); return; }
    const payload = { name, bankName, accountNumber, accountName, openingBalance: parseMoney($('#bkOpening')?.value) || 0, scopeType, storeId, active: $('#bkActive')?.value !== '0', isDefault, updatedAt: new Date().toISOString() };
    if (editing) Object.assign(editing, payload);
    else DB.bankAccounts.push({ id: nextCode('BANK-', DB.bankAccounts, 2), ...payload, transactions: [], createdAt: new Date().toISOString() });
    try {
      if (typeof RestaurantQualityAPI !== 'undefined') {
        const saved = editing || DB.bankAccounts[DB.bankAccounts.length-1];
        // Chỉ khi đổi tài khoản mặc định mới cần đồng bộ nhiều record; trường hợp
        // thường chỉ ghi đúng tài khoản vừa thêm/sửa để nút Lưu phản hồi nhanh.
        if (isDefault) await RestaurantQualityAPI.syncRestaurant(['bankAccounts']);
        else if (typeof RestaurantQualityAPI.saveRestaurantRecord === 'function') await RestaurantQualityAPI.saveRestaurantRecord('bankAccounts', saved);
        else await RestaurantQualityAPI.syncRestaurant(['bankAccounts']);
      }
      Modal.close(); render(); Toast.ok(editing ? 'Đã cập nhật tài khoản ngân hàng' : 'Đã thêm tài khoản ngân hàng', `${name} · ${scopeType === 'STORE' ? ((DB.stores||[]).find(s=>String(s.id)===String(storeId))?.name||storeId) : 'Công ty'}`);
    } catch (err) {
      DB.bankAccounts = before;
      Toast.err('Không lưu được lên server', err?.message || 'Vui lòng thử lại.');
    }
  },
  'acc-bank-edit': (d) => openBankAccountForm(d.id),
  'acc-bank-delete': async (d) => {
    const b = (DB.bankAccounts || []).find(x => String(x.id) === String(d.id));
    if (!b) return;
    if (Math.abs(AccFin.bankBalance(b.id)) >= 0.5 || (Array.isArray(b.transactions) && b.transactions.length)) { Toast.warn('Không thể xóa', 'Tài khoản đã có số dư hoặc đã phát sinh giao dịch.'); return; }
    if (!confirm(`Xóa tài khoản ngân hàng “${b.name}”?`)) return;
    const before = JSON.parse(JSON.stringify(DB.bankAccounts || []));
    try {
      if (typeof RestaurantQualityAPI !== 'undefined' && typeof RestaurantQualityAPI.deleteRestaurant === 'function') await RestaurantQualityAPI.deleteRestaurant('bankAccounts', b.id);
      else { DB.bankAccounts = (DB.bankAccounts || []).filter(x => String(x.id) !== String(b.id)); if (typeof RestaurantQualityAPI !== 'undefined') await RestaurantQualityAPI.syncRestaurant(['bankAccounts']); }
      DB.bankAccounts = (DB.bankAccounts || []).filter(x => String(x.id) !== String(b.id)); AccountingBank.hydrate(); render(); Toast.ok('Đã xóa tài khoản ngân hàng');
    } catch(err) { DB.bankAccounts = before; AccountingBank.hydrate(); Toast.err('Không xóa được tài khoản', err?.message || 'Vui lòng thử lại.'); }
  },
  'acc-bank-tx-add': async (d) => { await accountingEntriesEnsureFresh(false); openBankTxForm(d.id); },
  'acc-bank-tx-save': async (d) => {
    const amount = parseMoney($('#bkTxAmount')?.value) || 0;
    if (amount <= 0) { Toast.err('Số tiền không hợp lệ', 'Vui lòng nhập số tiền lớn hơn 0.'); return; }
    const accountingEntryId=$('#bkTxAccountingEntry')?.value||''; if(!accountingEntryId){Toast.err('Chưa chọn định khoản','Giao dịch ngân hàng bắt buộc phải chọn định khoản.');return;}
    try {
      await AccountingBank.record({ bankId:d.id, type:$('#bkTxType')?.value || 'IN', date:$('#bkTxDate')?.value || currentDateYMD(), amount, note:$('#bkTxNote')?.value.trim() || '', sourceType:'MANUAL_BANK', sourceId:`${d.id}-${Date.now()}`, accountingEntryId });
      Modal.close(); render(); Toast.ok('Đã ghi nhận giao dịch ngân hàng');
    } catch(err) { Toast.err('Không lưu được giao dịch ngân hàng', err?.message || 'Vui lòng thử lại.'); }
  },

  'acc-ar-collect': (d) => { const o=AccFin.recognizedOrders().find(x=>x.customerId===d.id && (typeof SalesCRM==='undefined'||SalesCRM.receivableOfOrder(x)>0)); if(o) openCustomerPaymentModal(o.id); },
  'acc-ar-collect-save': () => { Toast.warn('Đã chuyển chức năng','Vui lòng thu tiền trực tiếp theo từng đơn tại Công nợ phải thu.'); },

  'acc-asset-add': () => openFixedAssetForm(),
  'acc-asset-edit': (d) => openFixedAssetForm(d.id),
  'acc-asset-save': async (d) => {
    const name = $('#faName')?.value.trim();
    const cost = parseMoney($('#faCost')?.value) || 0;
    if (!name || cost <= 0) { Toast.err('Thiếu thông tin', 'Vui lòng nhập tên tài sản và nguyên giá lớn hơn 0.'); return; }
    const payload = { name, dept: $('#faDept')?.value || '', purchaseDate: $('#faDate')?.value || currentDateYMD(), cost, usefulYears: Number($('#faYears')?.value) || 8 };
    // Cần danh sách thật từ server trước khi sinh mã TS-xxx / tìm tài sản để sửa.
    try { if (typeof RestaurantQualityAPI !== 'undefined') await RestaurantQualityAPI.ensureFresh(['fixedAssets'], {force:false}); } catch(err) {}
    const before = JSON.parse(JSON.stringify(DB.fixedAssets || []));
    if (d.id) {
      Object.assign(DB.fixedAssets.find((a) => a.id === d.id), payload);
    } else {
      DB.fixedAssets.push({ id: nextCode('TS-', DB.fixedAssets), status: 'active', ...payload });
    }
    try {
      if (typeof RestaurantQualityAPI !== 'undefined') await RestaurantQualityAPI.syncRestaurant(['fixedAssets']);
      Modal.close(); render(); Toast.ok(d.id ? 'Đã cập nhật tài sản' : 'Đã thêm tài sản', name);
    } catch (err) {
      DB.fixedAssets = before;
      Toast.err('Không lưu được lên server', err?.message || 'Vui lòng thử lại.');
    }
  },
  'acc-asset-delete': (d) => {
    const a = DB.fixedAssets.find((x) => x.id === d.id); if (!a) return;
    confirmBox({ title: 'Xóa tài sản cố định', icon: 'fa-trash', okText: 'Xóa', message: `Xóa tài sản <b>${esc(a.name)}</b>?`, onOk: async () => {
      const before = JSON.parse(JSON.stringify(DB.fixedAssets || []));
      try {
        if (typeof RestaurantQualityAPI !== 'undefined') await RestaurantQualityAPI.deleteRestaurant('fixedAssets', d.id);
        else DB.fixedAssets = DB.fixedAssets.filter((x) => x.id !== d.id);
        render(); Toast.ok('Đã xóa tài sản', a.name);
      } catch (err) {
        DB.fixedAssets = before;
        Toast.err('Không xóa được trên server', err?.message || 'Vui lòng thử lại.');
      }
    } });
  },
   'acc-tax-export': () => {
    const fOut = F('acc-tax-out', { productId: '', unit: '', q: '', from: '', to: '' });
    const outRows = accTaxOutputRows(fOut);
    const fIn = F('acc-tax-in', { group: '', from: '', to: '' });
    const inRows = accTaxInputRows(fIn);
    Exporter.csv('Chi-tiet-thue-VAT.csv',
      ['Chiều', 'Mã hàng', 'Tên hàng', 'Loại/Nhóm', 'Số lượng', 'Giá trị trước VAT', 'VAT'],
      [...outRows.map((r) => ['Đầu ra', r.productId, r.name, r.unit, r.qty, Math.round(r.net), Math.round(r.vat)]),
        ...inRows.map((r) => ['Đầu vào', r.materialId, r.name, r.group, r.qty, Math.round(r.net), Math.round(r.vat)]),]);
  },
});

/* ============================================================================
 * LƯU Ý TÍCH HỢP
 * ----------------------------------------------------------------------------
 *    Trong index.html, thêm MỘT dòng script NGAY SAU app.js (bắt buộc sau,
 *    vì file này dùng Actions/Views/DB/Q/AccFin đã được app.js khởi tạo):
 *
 *      <script src="js/app.js?v=20260914-restaurant1"></script>
 *      <script src="js/modules/mod-accounting.js?v=1"></script>
 * ==========================================================================*/