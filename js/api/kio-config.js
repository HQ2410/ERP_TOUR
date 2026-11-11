/* ============================================================================
 * KIO CONFIG
 * ----------------------------------------------------------------------------
 * Chỉ chứa cấu hình persistence. Không chứa business logic.
 * Mọi tên bảng KIO của dự án Lê Nam được tập trung tại đây để tránh khai báo
 * rải rác ở nhiều module.
 * ========================================================================== */
const KIO_CONFIG = Object.freeze({
  demoVersion: '20260910-refactor1',

  purchaseTables: Object.freeze({
    suppliers: 'lenam_suppliers',
    purchases: 'lenam_purchase_requests',
    supplierQuotations: 'lenam_supplier_quotations',
    purchaseOrders: 'lenam_purchase_orders',
    goodsReceipts: 'lenam_goods_receipts',
    supplierPayments: 'lenam_supplier_payments',
    supplierRefunds: 'lenam_supplier_refunds',
    purchasePriceHistory: 'lenam_purchase_price_history',
    supplierEvaluations: 'lenam_supplier_evaluations',
  }),

  inventoryTables: Object.freeze({
    warehouseSites: 'lenam_warehouse_sites',
    warehouses: 'lenam_warehouses',
    warehouseLocations: 'lenam_warehouse_locations',
    inventoryLots: 'lenam_inventory_lots',
    inventory: 'lenam_inventory_balances',
    stockTransfers: 'lenam_stock_transfers',
    inventoryCounts: 'lenam_inventory_counts',
    inventoryTransactions: 'lenam_inventory_transactions',
    goodsIssues: 'lenam_goods_issues',
    stockMoves: 'lenam_stock_moves',
    inventoryAuditLogs: 'lenam_inventory_audit_logs',
    materialReturnRequests: 'lenam_material_return_requests',
    materialReturnHistory: 'lenam_material_return_history',
    materialInspections: 'lenam_material_inspections',
    itemCategories: 'lenam_item_categories',
    materials: 'lenam_materials',
    semiFinishedProducts: 'lenam_semi_finished_products',
    products: 'lenam_finished_products',
  }),


  // SẢN XUẤT — tách collection khỏi lenam_inventory_settings để mỗi màn chỉ
  // đọc đúng dữ liệu cần thiết, tránh tải singleton Production rất lớn.
  productionTables: Object.freeze({
    productionOrders: 'lenam_production_orders',
    productionPlans: 'lenam_production_plans',
    productionMaterialRequests: 'lenam_production_material_requests',
    productionFinalInspections: 'lenam_production_final_inspections',
    operations: 'lenam_production_operations',
  }),


  // CRM – Bán hàng dùng bảng riêng trên KIO server.
  // Giữ prefix lenam_ để không lẫn với các dự án khác trên cùng server.
  crmTables: Object.freeze({
    customers: 'lenam_customers',
    orders: 'lenam_sales_orders',
    crmOpportunities: 'lenam_crm_opportunities',
    customerCareLogs: 'lenam_customer_care_logs',
    crmTickets: 'lenam_crm_complaints',
    crmActivities: 'lenam_crm_activities',
    customerPayments: 'lenam_customer_payments',
  }),

  // LOGISTICS & FLEET — persistence thật trên KIO; localStorage chỉ là cache.
  logisticsTables: Object.freeze({
    vehicleTypes: 'lenam_logistics_vehicle_types',
    vehicles: 'lenam_logistics_vehicles',
    drivers: 'lenam_logistics_drivers',
    deliveries: 'lenam_logistics_deliveries',
    maintenance: 'lenam_logistics_maintenance',
  }),



  // NHÀ HÀNG & CỬA HÀNG — dữ liệu nghiệp vụ thật trên KIO server.
  restaurantTables: Object.freeze({
    stores: 'lenam_restaurant_stores',
    recipes: 'lenam_restaurant_recipes',
    orders: 'lenam_restaurant_pos_orders',
    replenishments: 'lenam_restaurant_replenishment_requests',
    storeStocks: 'lenam_restaurant_store_stock',
    storeStockTransactions: 'lenam_restaurant_store_stock_transactions',
    bankAccounts: 'lenam_restaurant_bank_accounts',
	    // Kế toán – Tài chính: trước bản này 3 bảng dưới đây không có tên bảng KIO
    // nào cả, nên acc-cash-save/acc-bank-tx-save/acc-asset-save chỉ ghi vào
    // DB trong bộ nhớ rồi mất sạch mỗi khi F5.
    cashTransactions: 'lenam_restaurant_cash_transactions',
    bankTransactions: 'lenam_restaurant_bank_transactions',
    fixedAssets: 'lenam_restaurant_fixed_assets',
  }),

  // KẾ TOÁN – TÀI CHÍNH — master định khoản do kế toán khai báo.
  accountingTables: Object.freeze({
    entries: 'lenam_accounting_entries',
    // Đợt 4: chốt kỳ doanh thu, tờ khai thuế GTGT, sổ hóa đơn (bán ra / mua vào).
    revenuePeriods: 'lenam_accounting_revenue_periods',
    vatReturns: 'lenam_accounting_vat_returns',
    invoices: 'lenam_accounting_invoices',
  }),

  // NHÂN SỰ (HR) — persistence thật trên KIO; trước bản này DB.employees chỉ
  // sống trong bộ nhớ nên mọi thay đổi (thêm/sửa/khóa/import NV) mất khi F5.
  hrTables: Object.freeze({
    employees: 'lenam_hr_employees',
    // Đợt 5: cấu hình lương, bảng công ngày, thống kê chuyến/tấn, bảng lương đã chốt.
    payrollConfig: 'lenam_hr_payroll_config',
    timesheets: 'lenam_hr_timesheets',
    dayStats: 'lenam_hr_day_stats',
    payrollRuns: 'lenam_hr_payroll_runs',
  }),

  // R&D — dự án nghiên cứu, công thức thử nghiệm, thử nghiệm, chi phí, duyệt.
  rndTables: Object.freeze({
    rndProjects: 'lenam_rnd_projects',
    rndFormulas: 'lenam_rnd_formulas',
    rndFormulaVersions: 'lenam_rnd_formula_versions',
    rndTrials: 'lenam_rnd_trials',
    rndCosts: 'lenam_rnd_costs',
    rndApprovals: 'lenam_rnd_approvals',

  }),

  // QC/QA — hồ sơ kiểm nghiệm, CAPA, thu hồi sản phẩm.
  qualityTables: Object.freeze({
    coa: 'lenam_quality_inspection_records',
    capa: 'lenam_quality_capa',
    recalls: 'lenam_quality_product_recalls',
  }),

  // PHÊ DUYỆT (APPROVALS) — quy trình nhiều cấp, nhật ký, chữ ký điện tử.
  approvalTables: Object.freeze({
    workflows: 'lenam_approval_workflows',
    requests: 'lenam_approval_requests',
    logs: 'lenam_approval_logs',
    signatures: 'lenam_approval_signatures',
  }),

  // AUTH / PHÂN QUYỀN / AUDIT — chỉ những actor thực sự thao tác ERP mới có tài khoản.
  systemTables: Object.freeze({
    users: 'lenam_users',
    roles: 'lenam_roles',
    permissions: 'lenam_permissions',
    rolePermissions: 'lenam_role_permissions',
    auditLogs: 'lenam_audit_logs',
  }),

  inventorySettingsTable: 'lenam_inventory_settings',

  storageKeys: Object.freeze({
    purchaseCache: 'lenam:kio:purchase-cache:v3-real-server',
    inventoryCache: 'lenam:kio:inventory-cache:v3-real-server',
    purchaseDemoSeed: 'lenam:kio:purchase-demo-seeded:20260910-refactor1',
    inventoryDemoSeed: 'lenam:kio:inventory-demo-seeded:20260910-refactor1',
    crmCache: 'lenam:kio:crm-cache:v2-real-server',
    crmDemoSeed: 'lenam:kio:crm-demo-seeded:20260911-crm-tables-v1',
    logisticsCache: 'lenam_logistics_v3_real_server',
    systemCache: 'lenam:kio:system-cache:v2',
    restaurantCache: 'lenam:kio:restaurant-cache:v1',
    qualityCache: 'lenam:kio:quality-cache:v1',
	approvalCache: 'lenam:kio:approval-cache:v1',
    approvalDemoSeed: 'lenam:kio:approval-demo-seeded:20260923-approvals-v1',
    hrCache: 'lenam:kio:hr-cache:v1',
    hrDemoSeed: 'lenam:kio:hr-demo-seeded:20260923-hr-tables-v1',
    rndCache: 'lenam:kio:rnd-cache:v1',
    rndDemoSeed: 'lenam:kio:rnd-demo-seeded:20260923-rnd-tables-v1',
    globalWarmupStamp: 'lenam:kio:global-warmup:v1',
    authSession: 'lenam:auth:session:v2',
  }),
});
