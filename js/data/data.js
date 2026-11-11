/* ============================================================================
 * DATA LAYER — CONFIG + DEMO SEED
 * --------------------------------------------------------------------------
 * File này giữ config tĩnh và bộ dữ liệu demo dùng để khởi tạo giao diện.
 * Với Purchase/Inventory, dữ liệu runtime sau bootstrap được KIO server nạp
 * vào DB.*; dữ liệu ở đây chỉ là nguồn demo seed theo Option A.
 * Không đặt code gọi API hoặc render UI trong file này.
 * ==========================================================================*/

const PURCHASE_INVENTORY_CONFIG = {

  /* -----------------------------------------------------------------------
   * PURCHASE REQUEST
   * --------------------------------------------------------------------- */

  prFlow: [
    {
      key: 'mh_cho_duyet',
      name: 'Yêu cầu mua',
      icon: 'fa-file-pen'
    },
    {
      key: 'mh_da_duyet',
      name: 'Phê duyệt',
      icon: 'fa-circle-check'
    },
    {
      key: 'mh_da_dat_hang',
      name: 'Đặt hàng NCC',
      icon: 'fa-paper-plane'
    },
    {
      key: 'mh_dang_giao',
      name: 'Đang giao',
      icon: 'fa-truck-fast'
    },
    {
      key: 'mh_da_nhan',
      name: 'Nhận hàng',
      icon: 'fa-box-open'
    },
    {
      key: 'mh_hoan_thanh',
      name: 'Nhập kho xong',
      icon: 'fa-warehouse'
    }
  ],

  prStatus: {
    pending: [
      'mh_cho_duyet',
      'PENDING_APPROVAL'
    ],

    approved: [
      'mh_da_duyet',
      'APPROVED',
      'mh_da_dat_hang',
      'CONVERTED_TO_PO'
    ],

    quoteable: [
      'mh_da_duyet',
      'mh_da_dat_hang',
      'mh_dang_giao',
      'mh_da_nhan',
      'mh_hoan_thanh',
      'APPROVED',
      'CONVERTED_TO_PO'
    ],

    rejected: [
      'mh_tu_choi',
      'REJECTED',
      'CANCELLED'
    ]
  },

  purchaseTabs: [
    {
      id: 'dashboard',
      label: 'Tổng quan'
    },
    {
      id: 'pr',
      label: 'Đề nghị mua hàng'
    },
    {
      id: 'quotes',
      label: 'Báo giá nhà cung cấp'
    },
    {
      id: 'po',
      label: 'Đơn đặt hàng'
    },
    {
      id: 'price_history',
      label: 'Lịch sử giá mua'
    },
    {
      id: 'suppliers',
      label: 'Nhà cung cấp'
    },
  ],

  defaultPR: {
    department: 'Sản xuất',

    requesterId: 'NV-018',

    expectedDays: 10,

    reason:
      'Bổ sung vật tư cho sản xuất & tồn kho tối thiểu',

    fallbackReason:
      'Phục vụ đơn hàng sản xuất quý III'
  },

  /* -----------------------------------------------------------------------
   * SUPPLIER QUOTATION
   * --------------------------------------------------------------------- */

  supplierQuotation: {
    defaultLeadTime: 7,

    validDays: 15,

    defaultPaymentTerm:
      '30% tạm ứng, 70% sau khi giao hàng'
  },

  /* -----------------------------------------------------------------------
   * PURCHASE ORDER
   * --------------------------------------------------------------------- */

  poStatus: {
    draft: 'DRAFT',

    sent: 'SENT_TO_SUPPLIER',

    shipping: 'SHIPPING',

    partialReceived: 'PARTIAL_RECEIVED',

    received: 'RECEIVED',

    cancelled: 'CANCELLED'
  },

  poStatusChart: [
    {
      status: 'DRAFT',
      label: 'Nháp PO',
      color: 'slate'
    },
    {
      status: 'SENT_TO_SUPPLIER',
      label: 'Đã gửi NCC',
      color: 'blue'
    },
    {
      status: 'SHIPPING',
      label: 'Đang giao',
      color: 'teal'
    },
    {
      status: 'PARTIAL_RECEIVED',
      label: 'Nhận 1 phần',
      color: 'orange'
    },
    {
      status: 'RECEIVED',
      label: 'Đã nhận đủ',
      color: 'green'
    }
  ],

  /* -----------------------------------------------------------------------
   * INVENTORY NAVIGATION
   * --------------------------------------------------------------------- */

  inventoryTabs: [
    {
      id: 'overview',
      label: 'Tổng quan',
      route: 'inv-overview'
    },
    {
      id: 'stock',
      label: 'Tồn kho',
      route: 'inventory'
    },
    {
      id: 'receipts',
      label: 'Nhập kho',
      route: 'inv-receipts'
    },
    {
      id: 'issues',
      label: 'Xuất kho',
      route: 'inv-issues'
    },
    {
      id: 'transfers',
      label: 'Chuyển kho',
      route: 'inv-transfers'
    },
    {
      id: 'counts',
      label: 'Kiểm kê',
      route: 'inv-counts'
    },
    {
      id: 'lots',
      label: 'Lô & hạn sử dụng',
      route: 'inv-lots'
    },
    {
      id: 'locations',
      label: 'Quản lý kho',
      route: 'inv-warehouses'
    },
    {
      id: 'alerts',
      label: 'Cảnh báo',
      route: 'inv-alerts'
    }
  ],

  /* -----------------------------------------------------------------------
   * GOODS RECEIPT
   * --------------------------------------------------------------------- */

  receiptStatusOptions: [
    ['RECEIVED', 'Đã nhận đủ'],
    ['PARTIAL_RECEIVED', 'Nhận 1 phần'],
    ['PENDING', 'Chờ nhập']
  ],

  receiptWarehouseTypes: [
    'RAW_MATERIAL',
    'FINISHED_GOODS',
    'SEMI_FINISHED'
  ],

  receiptTypes: [
    {
      value: 'PURCHASE',
      label: 'Nhập từ Mua hàng (PO)'
    },
    {
      value: 'PRODUCTION',
      label: 'Nhập thành phẩm sản xuất'
    },
    {
      value: 'ADJUSTMENT_IN',
      label: 'Nhập điều chỉnh'
    },
    {
      value: 'RETURN_IN',
      label: 'Nhập hàng trả về'
    }
  ],

  purchaseReceiptWarehouses: [
    {
      value: 'WH-001',
      label: 'Kho Nguyên vật liệu chính'
    },
    {
      value: 'WH-002',
      label: 'Kho Phân xưởng sản xuất'
    },
    {
      value: 'WH-004',
      label: 'Kho Thành phẩm lạnh'
    }
  ],

  /* -----------------------------------------------------------------------
   * GOODS ISSUE
   * --------------------------------------------------------------------- */

  issueTypes: {
    PRODUCTION_ISSUE: 'Xuất sản xuất',

    SALES_ISSUE: 'Xuất bán hàng',

    ADJUSTMENT_OUT: 'Xuất điều chỉnh',

    TRANSFER_OUT: 'Xuất chuyển kho',

    DEFECTIVE_ISSUE: 'Xuất hàng lỗi',

    RETURN_OUT: 'Xuất trả NCC'
  },

  issueFormTypes: [
    {
      value: 'PRODUCTION_ISSUE',
      label: 'Xuất sản xuất'
    },
    {
      value: 'SALES_ISSUE',
      label: 'Xuất bán hàng'
    },
    {
      value: 'ADJUSTMENT_OUT',
      label: 'Xuất điều chỉnh'
    },
    {
      value: 'TRANSFER_OUT',
      label: 'Xuất chuyển kho'
    }
  ],

  /* -----------------------------------------------------------------------
   * STOCK TRANSFER
   * --------------------------------------------------------------------- */

  transferStatusOptions: [
    ['DRAFT', 'Nháp'],
    ['IN_TRANSIT', 'Đang đi đường'],
    ['RECEIVED', 'Đã nhận']
  ],

  /* -----------------------------------------------------------------------
   * LOT / QC
   * --------------------------------------------------------------------- */

  qcStatusOptions: [
    ['PASSED', 'Đạt QC'],
    ['QC_PENDING', 'Chờ QC'],
    ['FAILED', 'Không đạt'],
    ['QUARANTINE', 'Cách ly']
  ],

  expiryStatusOptions: [
    ['near_expiry', '⚠ Cận hạn'],
    ['expired', '❌ Hết hạn'],
    ['normal', '✅ Còn xa']
  ],

  /* -----------------------------------------------------------------------
   * INVENTORY ALERT
   * --------------------------------------------------------------------- */

  inventoryStatusOptions: [
    ['near_expiry', '⚠ Cận hạn'],
    ['expired', '❌ Hết hạn'],
    ['low_stock', '⬇ Dưới tồn min']
  ],

  nearExpiryDayOptions: [
    1,
    3,
    7,
    15,
    30
  ],

  slowMovingDayOptions: [
    30,
    60,
    90,
    180
  ],

  /* -----------------------------------------------------------------------
   * PAYMENT
   * --------------------------------------------------------------------- */

  paymentMethods: [
    {
      value: 'Chuyển khoản',
      label: 'Chuyển khoản ngân hàng'
    },
    {
      value: 'Tiền mặt',
      label: 'Tiền mặt'
    }
  ],

  /* -----------------------------------------------------------------------
   * INVENTORY SERVICE
   * --------------------------------------------------------------------- */

  inboundTransactionTypes: [
    'RECEIPT',
    'TRANSFER_IN',
    'ADJUSTMENT_IN',
    'RETURN_IN',
    'PRODUCTION_RECEIPT'
  ],

  defaultWarehouseId: 'WH-001',

  /* -----------------------------------------------------------------------
   * DEMO / FORM DEFAULT
   * Chỉ dùng làm giá trị mặc định trong giao diện demo.
   * --------------------------------------------------------------------- */

  defaults: {
    stockMoveMaterialId: 'VT-001',

    stockMoveReference:
      'LSX-2026-0048 / YCM-2026-0046',

    receiptReference:
      'PO-2026-xxxx / LSX-2026-xxxx',

    issueReference:
      'LSX-2026-xxxx / DH-2026-xxxx',

    receiptQty: 100,

    supplierLeadTime: 7,

    alertWarehouseId: 'WH-001',

    warehouseReceiverId: 'NV-018'
  }

};

const WAREHOUSE_CONFIG = {
  warehouseTabs: [
    { id: 'warehouse', label: 'Tổng quan', tab: 'dashboard' },
    { id: 'warehouse', label: 'Tồn kho', tab: 'inventory' },
    { id: 'warehouse', label: 'Nhập kho', tab: 'receipts' },
    { id: 'warehouse', label: 'Xuất kho', tab: 'issues' },
    { id: 'warehouse', label: 'Chuyển kho', tab: 'transfers' },
    { id: 'warehouse', label: 'Kiểm kê', tab: 'stocktake' },
    { id: 'warehouse', label: 'Lô & Hạn sử dụng', tab: 'batches' },
    { id: 'warehouse', label: 'Vị trí lưu trữ', tab: 'locations' },
    { id: 'warehouse', label: 'Cảnh báo', tab: 'alerts' }
  ]
};

const SUBCONTRACTING_CONFIG = {
  subcontractingTabs: [
    { id: 'subcontracting', label: 'Tổng quan', tab: 'dashboard' },
    { id: 'subcontracting', label: 'Kế hoạch gia công', tab: 'orders' },
    { id: 'subcontracting', label: 'Đối chiếu công nợ', tab: 'debt' },
    { id: 'subcontracting', label: 'Đối tác gia công', tab: 'partners' }
    // Tạm ẩn: Báo cáo gia công. Nhận hàng hoàn thành nằm trong chi tiết kế hoạch.
  ]
};

const CRM_CONFIG = {
  crmTabs: [
    { id: 'crm', label: 'Tổng quan', tab: 'dashboard' },
    { id: 'crm', label: 'Khách hàng', tab: 'customers' },
    { id: 'crm', label: 'Chăm sóc khách hàng', tab: 'care' },
    { id: 'crm', label: 'Khiếu nại', tab: 'complaints' },
    { id: 'crm', label: 'Lịch sử giao dịch', tab: 'transactions' },
    { id: 'crm', label: 'Đơn hàng bán', tab: 'orders' },
    { id: 'crm', label: 'Báo cáo CRM', tab: 'reports' }
  ]
};
/* ---------------------------------------------------------------------------
 * 0. Tiện ích sinh dữ liệu (PRNG có seed => dữ liệu ổn định giữa các lần mở)
 * -------------------------------------------------------------------------*/

const Rand = (function () {
  let seed = 20260815;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return {
    reset: (s) => { seed = s || 20260815; },
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
})();

/** Ngày "hôm nay" của hệ thống demo */
const TODAY = '2026-08-15';

/** Định dạng Date -> 'YYYY-MM-DD' theo giờ địa phương.
 *  (Không dùng toISOString() vì hàm này quy đổi sang UTC, ở múi giờ GMT+7
 *   sẽ làm lùi ngày lại 1 ngày.) */
function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Cộng thêm n ngày vào một chuỗi ngày 'YYYY-MM-DD' */
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toYMD(d);
}

/* ---------------------------------------------------------------------------
 * 1. Danh mục trạng thái dùng chung (nhãn + màu badge)
 * -------------------------------------------------------------------------*/
const STATUS = {
  // Khách hàng
  kh_hoat_dong:    { label: 'Đang hợp tác',  tone: 'green'  },
  kh_tiem_nang:    { label: 'Tiềm năng',     tone: 'blue'   },
  kh_tam_dung:     { label: 'Tạm dừng',      tone: 'slate'  },
  // Báo giá
  bg_nhap:         { label: 'Nháp',            tone: 'slate'  },
  bg_da_gui:       { label: 'Đã gửi',          tone: 'blue'   },
  bg_dam_phan:     { label: 'Đang đàm phán',   tone: 'orange' },
  bg_da_duyet:     { label: 'Đã duyệt',        tone: 'green'  },
  bg_tu_choi:      { label: 'Từ chối',         tone: 'red'    },
  bg_het_han:      { label: 'Hết hạn',         tone: 'slate'  },
  // Đơn hàng
  dh_cho_xu_ly:    { label: 'Chờ xử lý',     tone: 'slate'  },
  dh_cho_san_xuat: { label: 'Chờ sản xuất',  tone: 'orange' },
  dh_dang_san_xuat:{ label: 'Đang sản xuất', tone: 'blue'   },
  dh_hoan_thanh:   { label: 'Hoàn thành',    tone: 'green'  },
  dh_da_giao:      { label: 'Đã giao',       tone: 'teal'   },
  dh_hoan_tat:      { label: 'Hoàn thành',     tone: 'green'  },
  dh_da_huy:       { label: 'Đã hủy',        tone: 'red'    },
  // Lệnh sản xuất
  lsx_cho_duyet:   { label: 'Chờ sản xuất',  tone: 'slate' },
  lsx_cho_san_xuat:{ label: 'Chờ sản xuất',  tone: 'slate'  },
  lsx_dang_san_xuat:{label: 'Đang sản xuất', tone: 'blue'   },
  lsx_dang_qc:     { label: 'Đang QC',       tone: 'orange' },
  lsx_hoan_thanh:  { label: 'Hoàn thành',    tone: 'green'  },
  lsx_da_nhap_kho: { label: 'Đã nhập kho',   tone: 'teal'   },
  lsx_tam_dung:    { label: 'Tạm dừng',      tone: 'red'    },
  // Vật tư
  vt_du_ton:       { label: 'Đủ tồn',        tone: 'green'  },
  vt_sap_het:      { label: 'Sắp hết',       tone: 'orange' },
  vt_het_hang:     { label: 'Hết hàng',      tone: 'red'    },
  // Yêu cầu mua hàng (PR)
  mh_cho_duyet:    { label: 'Chờ duyệt',     tone: 'orange' },
  mh_da_duyet:     { label: 'Đã duyệt',      tone: 'green'  },
  mh_da_dat_hang:  { label: 'Đã đặt hàng',   tone: 'indigo' },
  mh_dang_giao:    { label: 'Đang giao',     tone: 'teal'   },
  mh_da_nhan:      { label: 'Đã nhận',       tone: 'green'  },
  mh_hoan_thanh:   { label: 'Hoàn thành',    tone: 'green'  },
  mh_tu_choi:      { label: 'Từ chối',       tone: 'red'    },
  DRAFT:            { label: 'Nháp PR',        tone: 'slate'  },
  PENDING_APPROVAL: { label: 'Chờ duyệt',      tone: 'orange' },
  APPROVED:         { label: 'Đã phê duyệt',   tone: 'green'  },
  REJECTED:         { label: 'Từ chối',        tone: 'red'    },
  CONVERTED_TO_PO:  { label: 'Đã chuyển PO',   tone: 'indigo' },
  CANCELLED:        { label: 'Đã hủy',         tone: 'slate'  },

  // Đơn đặt hàng (PO)
  po_draft:            { label: 'Nháp PO',            tone: 'slate'  },
  po_sent_to_supplier: { label: 'Đã gửi NCC',          tone: 'blue'   },
  po_shipping:         { label: 'Đang giao hàng',     tone: 'teal'   },
  po_partial_received: { label: 'Nhận 1 phần',        tone: 'orange' },
  po_received:         { label: 'Đã nhận đủ',         tone: 'green'  },
  po_cancelled:        { label: 'Đã hủy PO',          tone: 'red'    },
  READY_TO_SEND:       { label: 'Chờ gửi NCC',         tone: 'orange' },
  SENT_TO_SUPPLIER:    { label: 'Đã gửi NCC',          tone: 'blue'   },
  SHIPPING:            { label: 'Đang giao hàng',     tone: 'teal'   },
  PARTIAL_RECEIVED:    { label: 'Nhận 1 phần',        tone: 'orange' },
  RECEIVED:            { label: 'Đã nhận đủ',         tone: 'green'  },

  // Công nợ & Thanh toán NCC
  pay_unpaid:         { label: 'Chưa thanh toán',   tone: 'red'    },
  pay_partially_paid: { label: 'Thanh toán 1 phần', tone: 'orange' },
  pay_paid:           { label: 'Đã thanh toán đủ',  tone: 'green'  },
  pay_overdue:        { label: 'Quá hạn thanh toán',tone: 'red'    },
  UNPAID:             { label: 'Chưa thanh toán',   tone: 'red'    },
  PARTIALLY_PAID:     { label: 'Thanh toán 1 phần', tone: 'orange' },
  PAID:               { label: 'Đã thanh toán đủ',  tone: 'green'  },
  OVERDUE:            { label: 'Quá hạn thanh toán',tone: 'red'    },
  // Hợp đồng
  hd_cho_ky:       { label: 'Chờ ký',        tone: 'slate'  },
  hd_hieu_luc:     { label: 'Còn hiệu lực',  tone: 'green'  },
  hd_sap_het_han:  { label: 'Sắp hết hạn',   tone: 'orange' },
  hd_het_han:      { label: 'Hết hạn',       tone: 'red'    },
  hd_thanh_ly:     { label: 'Đã thanh lý',   tone: 'slate'  },
  // Nhân sự
  ns_dang_lam:     { label: 'Đang làm việc', tone: 'green'  },
  ns_nghi_phep:    { label: 'Nghỉ phép',     tone: 'orange' },
  ns_thu_viec:     { label: 'Thử việc',      tone: 'blue'   },
  ns_nghi_viec:    { label: 'Đã nghỉ việc',  tone: 'red'    },
  // Lô và hạn sử dụng QC
  QC_PENDING:      { label: 'Chờ QC',        tone: 'orange' },
  PASSED:          { label: 'Đạt chất lượng', tone: 'green' },
  FAILED:          { label: 'Không đạt',     tone: 'red' },
  QUARANTINE:      { label: 'Cách ly',       tone: 'purple' },
  // Chuyển kho
  IN_TRANSIT:      { label: 'Đang đi đường',  tone: 'teal' },
  COMPLETED:       { label: 'Đã hoàn thành',   tone: 'green' },
  ISSUED:          { label: 'Đã xuất kho',     tone: 'blue' },
};

/* ---------------------------------------------------------------------------
 * 2. Khách hàng (30)
 * [mã, tên, người liên hệ, điện thoại, email, tỉnh/TP, mã số thuế, nhóm,
 *  trạng thái, ngày hợp tác, phụ trách, công nợ]
 * -------------------------------------------------------------------------*/
const CUSTOMER_ROWS = [
  ['KH-001','Nhà hàng Cơm Tấm Bà Năm','Nguyễn Thị Năm','0912 345 678','banamnhahang@gmail.com','TP. Hồ Chí Minh','0300456123','Nhà hàng','kh_hoat_dong','2021-03-12','Trần Thu Hà',12500000],
  ['KH-002','Quán Chay Ánh Dương','Phạm Thị Ánh','0908 221 334','anhduongchay@gmail.com','TP. Hồ Chí Minh','0312884521','Nhà hàng chay','kh_hoat_dong','2020-06-01','Trần Thu Hà',0],
  ['KH-003','Chợ Bình Tây — Quầy 2B','Lê Văn Bình','0987 654 321','chobthai2b@gmail.com','TP. Hồ Chí Minh','0316227845','Chợ / Bán sỉ','kh_hoat_dong','2019-11-20','Nguyễn Đức Anh',8500000],
  ['KH-004','Siêu thị CoopMart Quận 9','Đỗ Quang Sáng','0933 456 789','coop9@coopmart.vn','TP. Hồ Chí Minh','0305442310','Siêu thị','kh_hoat_dong','2022-01-15','Nguyễn Đức Anh',15600000],
  ['KH-005','Bếp Ăn Trường THCS Lê Lợi','Trịnh Thị Phương','0977 112 233','beptruong@lelong.edu.vn','Bình Dương','1101228754','Bếp ăn trường học','kh_hoat_dong','2021-08-30','Lê Thị Bích',4200000],
  ['KH-006','Chuỗi Bún Đậu Mắm Tôm Ông Bảy','Vũ Văn Bảy','0918 334 556','ongbay.bundau@gmail.com','Đồng Nai','3601558423','Nhà hàng','kh_hoat_dong','2020-02-10','Nguyễn Đức Anh',0],
  ['KH-007','Công ty CP Suất Ăn Công Nghiệp Việt Star','Ngô Hoàng Sơn','0965 778 990','vietstar.catering@gmail.com','Bình Dương','2300884512','Bếp ăn CN','kh_hoat_dong','2022-05-18','Lê Thị Bích',22500000],
  ['KH-008','Nhà hàng Thuần Chay Sen Vàng','Bùi Thị Vàng','0902 445 667','senvang.chay@gmail.com','TP. Hồ Chí Minh','0313664788','Nhà hàng chay','kh_hoat_dong','2023-03-07','Trần Thu Hà',0],
  ['KH-009','Chợ Đầu Mối Thủ Đức — Vựa Đậu Hủ','Hoàng Văn Đức','0949 223 118','chdm.dh.thuDuc@gmail.com','TP. Hồ Chí Minh','3701225478','Chợ / Bán sỉ','kh_hoat_dong','2021-12-01','Lê Thị Bích',35000000],
  ['KH-010','Quán Cơm Gia Đình Bà Tám','Đặng Thị Tám','0938 776 554','batam.com@gmail.com','Đồng Nai','3602114788','Quán ăn','kh_hoat_dong','2022-09-22','Trần Thu Hà',0],
  ['KH-011','Hệ thống Circle K Việt Nam (HCM)','Lý Hoàng Phúc','0913 002 456','circlek.hcm@circlek.com.vn','TP. Hồ Chí Minh','1801334215','Chuỗi tiện lợi','kh_tiem_nang','2025-11-05','Nguyễn Đức Anh',0],
  ['KH-012','Vựa Đậu Hủ Chợ Bà Chiểu','Trương Thị Chiều','0906 554 331','dauhu.baChieu@gmail.com','TP. Hồ Chí Minh','0314552210','Chợ / Bán sỉ','kh_hoat_dong','2020-10-14','Lê Thị Bích',6700000],
  ['KH-013','Quán Mì Quảng Đà Nẵng Hương Xưa','Cao Thị Hương','0972 118 447','miquang.huongxua@gmail.com','TP. Hồ Chí Minh','0900442158','Quán ăn','kh_hoat_dong','2023-06-19','Trần Thu Hà',0],
  ['KH-014','Công ty TNHH Thực phẩm Sạch Xanh Lá','Nguyễn Xanh Lá','0988 334 002','xanhla.food@gmail.com','Hà Nội','0106884753','Phân phối thực phẩm','kh_hoat_dong','2019-05-08','Nguyễn Đức Anh',18000000],
  ['KH-015','Cơ sở Chế biến Chay Thiên Phúc','Phan Thị Phúc','0917 665 223','thienphuc.chay@gmail.com','Bình Dương','3700998412','Chế biến thực phẩm','kh_hoat_dong','2022-02-28','Lê Thị Bích',0],
  ['KH-016','Bếp Ăn KCN Sóng Thần (500 công nhân)','Mai Thị Sóng','0903 221 889','bepan.songthan@gmail.com','Bình Dương','5400221547','Bếp ăn CN','kh_hoat_dong','2021-07-11','Trần Thu Hà',9800000],
  ['KH-017','Nhà hàng Buffet Chay Phật Quang','Đinh Thị Quang','0934 887 116','buffetchay.phatquang@gmail.com','Đồng Nai','0600774521','Nhà hàng chay','kh_tiem_nang','2026-01-20','Nguyễn Đức Anh',0],
  ['KH-018','Quán Bánh Canh Cua Bà Hường','Tạ Thị Hường','0967 443 228','banhcanh.bahuong@gmail.com','TP. Hồ Chí Minh','0202114478','Quán ăn','kh_hoat_dong','2020-04-03','Lê Thị Bích',0],
  ['KH-019','Hội Quán Chay Từ Tâm','Võ Thị Tâm','0909 776 331','tutam.hqchay@gmail.com','Long An','1100884752','Nhà hàng chay','kh_hoat_dong','2023-01-09','Trần Thu Hà',3500000],
  ['KH-020','Hệ thống WinMart+ Bình Dương','Hồ Văn Win','0928 114 667','winmart.binh_duong@masan.vn','Bình Dương','3701447852','Siêu thị','kh_hoat_dong','2022-11-25','Lê Thị Bích',0],
  ['KH-021','Công ty CP Cung ứng Thực phẩm Miền Nam','Lâm Phương Nam','0944 228 553','cung.tp.mn@gmail.com','TP. Hồ Chí Minh','0401552247','Phân phối thực phẩm','kh_hoat_dong','2021-05-17','Nguyễn Đức Anh',42000000],
  ['KH-022','Trường Mầm Non Hoa Hướng Dương','Chu Thị Hướng','0916 337 442','mamnon.hoahd@gmail.com','TP. Hồ Chí Minh','0315664120','Bếp ăn trường học','kh_tiem_nang','2026-03-02','Trần Thu Hà',0],
  ['KH-023','Quán Lẩu Chay Hoa Sen 365','Đoàn Văn Sen','0901 883 774','lauchay.hoasen365@gmail.com','Đồng Nai','4000221589','Nhà hàng chay','kh_hoat_dong','2020-08-21','Nguyễn Đức Anh',0],
  ['KH-024','Cơm Bình Dân Quán Dì Ba','Kiều Thị Ba','0973 442 118','quandiba@gmail.com','TP. Hồ Chí Minh','0316775432','Quán ăn','kh_hoat_dong','2023-09-14','Lê Thị Bích',5800000],
  ['KH-025','Nhà hàng Chay Bồ Đề Tâm','Dương Bồ Đề','0935 116 889','bodhetam.chay@gmail.com','Tiền Giang','1200558741','Nhà hàng chay','kh_hoat_dong','2022-06-30','Trần Thu Hà',0],
  ['KH-026','Siêu thị Emart Long Biên','Ninh Văn Long','0968 223 447','emart.longbien@emart.vn','Hà Nội','0900112478','Siêu thị','kh_tam_dung','2019-09-12','Lê Thị Bích',0],
  ['KH-027','Chuỗi Đậu Hủ Ông Già Mũ Trắng','Tống Văn Già','0919 554 002','onggia.dauhu@gmail.com','Bình Dương','2300447851','Bán lẻ / Chuỗi','kh_hoat_dong','2024-02-26','Nguyễn Đức Anh',0],
  ['KH-028','Bếp Ăn Nhà Máy Fujitsu Đồng Nai','Quách Thị Lan','0907 668 224','canteen.fujitsu@gmail.com','Đồng Nai','5400114725','Bếp ăn CN','kh_hoat_dong','2021-10-08','Trần Thu Hà',7500000],
  ['KH-029','Hợp tác xã Rau Sạch Đồng Tháp','Hà Văn Đồng','0946 227 883','htx.rausach.dt@gmail.com','Đồng Tháp','3701774528','Phân phối thực phẩm','kh_hoat_dong','2023-04-11','Lê Thị Bích',0],
  ['KH-030','Quán Phở Chay Bà Cúc','Trần Thị Cúc','0902 118 665','phochay.bacuc@gmail.com','TP. Hồ Chí Minh','3700225874','Quán ăn','kh_tam_dung','2020-12-19','Nguyễn Đức Anh',0],
];

/* ---------------------------------------------------------------------------
 * 3a. Danh mục CÔNG ĐOẠN SẢN XUẤT (routing master)
 * [mã, tên công đoạn, phân xưởng, máy/thiết bị, đơn giá giờ máy + nhân công]
 * Báo giá bóc tách công đoạn nào thì công đoạn đó được lưu về danh mục này.
 * -------------------------------------------------------------------------*/
const OPERATION_ROWS = [
  ['CD-01','Ngâm & làm sạch đậu nành', 'Ngâm đậu',   'Bể ngâm inox 500L',         45000],
  ['CD-02','Xay đậu nành',             'Xay',        'Máy xay công nghiệp XD-200',180000],
  ['CD-03','Lọc bã – tách sữa đậu',   'Lọc',        'Máy lọc rung ép bã LB-01',  120000],
  ['CD-04','Nấu sữa đậu nành',         'Nấu',        'Nồi nấu inox 2 lớp 300L',   160000],
  ['CD-05','Đông tụ – kết tủa',        'Đông tụ',    'Bể đông tụ có khuấy DT-01', 130000],
  ['CD-06','Ép khuôn – tạo hình',      'Ép khuôn',   'Máy ép khuôn thủy lực KH-2',200000],
  ['CD-07','Cắt – định hình sản phẩm', 'Cắt định hình','Dao cắt đa năng CD-05',   80000],
  ['CD-08','Chiên giòn',               'Chiên',      'Chảo chiên công nghiệp CH-3',150000],
  ['CD-09','Hấp – tiệt trùng',         'Hấp',        'Tủ hấp tiệt trùng TP-100',  170000],
  ['CD-10','Kiểm tra chất lượng (QC)', 'QC',         'Phòng kiểm nghiệm KN-01',   90000],
  ['CD-11','Đóng gói hộp nhựa',        'Đóng gói',   'Máy đóng gói bán tự động',  110000],
  ['CD-12','Đóng gói túi hút chân không','Đóng gói',  'Máy hút chân không VC-200', 140000],
  ['CD-13','Dán nhãn – in date',       'Đóng gói',   'Máy dán nhãn tự động DN-01',70000],
  ['CD-14','Nhập kho lạnh',            'Hoàn thành', 'Kho lạnh 0-4°C KL-01',      60000],
];

/* ---------------------------------------------------------------------------
 * 3b. LEGACY COMPATIBILITY — Sản phẩm/cấu trúc báo giá từ source cũ
 *   bom     = định mức vật tư cho 1 đơn vị SP  [mã VT, số lượng]
 *   routing = định mức công đoạn cho 1 đơn vị SP  [mã CĐ, số giờ]
 * Đơn giá bán được giữ cố định; giá thành (vật tư + công đoạn + chi phí quản lý)
 * suy ra từ hai định mức trên, phần chênh lệch chính là lợi nhuận gộp.
 * -------------------------------------------------------------------------*/
const PRODUCTS = [
  { id:'SP-001', name:'Đậu hủ non (đậu phụ mềm)', spec:'Đậu nành nguyên hạt, đông tụ thạch cao, hộp 400g', unit:'Hộp', price: 12000,
    bom:[['VT-001',0.15],['VT-002',0.003],['VT-007',0.001],['VT-008',1]],
    routing:[['CD-01',0.01],['CD-02',0.01],['CD-03',0.01],['CD-04',0.01],['CD-05',0.01],['CD-06',0.01],['CD-10',0.005],['CD-11',0.005],['CD-14',0.002]] },
  { id:'SP-002', name:'Đậu hủ cứng (đậu phụ cứng)',spec:'Đậu nành cao cấp, đông tụ nigari, khối 400g', unit:'Khối', price: 14000,
    bom:[['VT-001',0.18],['VT-003',0.004],['VT-007',0.001],['VT-008',1]],
    routing:[['CD-01',0.01],['CD-02',0.01],['CD-03',0.01],['CD-04',0.01],['CD-05',0.01],['CD-06',0.015],['CD-10',0.005],['CD-11',0.005],['CD-14',0.002]] },
  { id:'SP-003', name:'Đậu hủ chiên giòn',         spec:'Đậu phụ chiên dầu thực vật, gói 200g', unit:'Gói', price: 15000,
    bom:[['VT-001',0.12],['VT-002',0.003],['VT-004',0.02],['VT-009',1]],
    routing:[['CD-01',0.008],['CD-02',0.008],['CD-03',0.008],['CD-04',0.008],['CD-05',0.008],['CD-06',0.01],['CD-07',0.005],['CD-08',0.01],['CD-10',0.005],['CD-11',0.005],['CD-14',0.002]] },
  { id:'SP-004', name:'Tàu hũ nước đường (óc đậu)',spec:'Sữa đậu tươi + đường phèn, ly 250ml', unit:'Ly', price: 10000,
    bom:[['VT-001',0.08],['VT-005',0.02],['VT-006',0.001],['VT-010',1]],
    routing:[['CD-01',0.005],['CD-02',0.01],['CD-03',0.005],['CD-04',0.01],['CD-05',0.008],['CD-10',0.003],['CD-13',0.003],['CD-14',0.002]] },
  { id:'SP-005', name:'Đậu hủ ky (tàu hũ ky)',     spec:'Váng sữa đậu sấy khô, gói 100g', unit:'Gói', price: 28000,
    bom:[['VT-001',0.5],['VT-008',1]],
    routing:[['CD-01',0.02],['CD-02',0.02],['CD-03',0.02],['CD-04',0.03],['CD-10',0.01],['CD-13',0.005],['CD-14',0.003]] },
  { id:'SP-006', name:'Sữa đậu nành tươi không đường',spec:'Nguyên chất 100% đậu nành, chai 500ml', unit:'Chai', price: 16000,
    bom:[['VT-001',0.1],['VT-011',1]],
    routing:[['CD-01',0.01],['CD-02',0.01],['CD-03',0.01],['CD-04',0.01],['CD-10',0.005],['CD-12',0.005],['CD-13',0.003],['CD-14',0.002]] },
  { id:'SP-007', name:'Sữa đậu nành có đường',     spec:'Đậu nành + đường mía, chai 500ml', unit:'Chai', price: 18000,
    bom:[['VT-001',0.1],['VT-005',0.025],['VT-011',1]],
    routing:[['CD-01',0.01],['CD-02',0.01],['CD-03',0.01],['CD-04',0.01],['CD-10',0.005],['CD-12',0.005],['CD-13',0.003],['CD-14',0.002]] },
  { id:'SP-008', name:'Đậu hủ nhồi thịt (đông lạnh)',spec:'Đậu phụ nhồi thịt heo xay, hộp 300g (10 miếng)', unit:'Hộp', price: 35000,
    bom:[['VT-001',0.08],['VT-002',0.002],['VT-004',0.01],['VT-008',1]],
    routing:[['CD-01',0.008],['CD-02',0.008],['CD-03',0.008],['CD-04',0.008],['CD-05',0.008],['CD-06',0.01],['CD-09',0.01],['CD-10',0.008],['CD-11',0.008],['CD-14',0.003]] },
  { id:'SP-009', name:'Đậu hủ trứng (Nhật)',       spec:'Trứng gà + sữa đậu, ống 300g kiểu Nhật', unit:'Ống', price: 22000,
    bom:[['VT-001',0.06],['VT-007',0.001],['VT-008',1]],
    routing:[['CD-02',0.01],['CD-03',0.01],['CD-04',0.01],['CD-05',0.008],['CD-09',0.01],['CD-10',0.005],['CD-11',0.005],['CD-13',0.003],['CD-14',0.002]] },
  { id:'SP-010', name:'Đậu hủ hút chân không',     spec:'Đậu phụ cứng đóng gói MAP, hạn dùng 15 ngày, 350g', unit:'Gói', price: 18000,
    bom:[['VT-001',0.18],['VT-003',0.003],['VT-008',1]],
    routing:[['CD-01',0.008],['CD-02',0.008],['CD-03',0.008],['CD-04',0.008],['CD-05',0.008],['CD-06',0.01],['CD-10',0.005],['CD-12',0.008],['CD-13',0.003],['CD-14',0.002]] },
];

/* ---------------------------------------------------------------------------
 * 4. Vật tư (30) — [mã, tên, nhóm, ĐVT, tồn, tồn tối thiểu, kho, đơn giá, NCC]
 * -------------------------------------------------------------------------*/
const MATERIAL_ROWS = [
  ['VT-001','Đậu nành nguyên hạt (nhập khẩu Mỹ)', 'Nguyên liệu chính','Kg', 2500, 800,'Kho Khô - Kệ A1',  22000,'NCC-01'],
  ['VT-002','Thạch cao thực phẩm (CaSO4)',         'Chất đông tụ',     'Kg',  500, 50, 'Kho Khô - Kệ B1',  85000,'NCC-02'],
  ['VT-003','Muối Nigari (MgCl2 tinh khiết)',      'Chất đông tụ',     'Kg',  500, 30, 'Kho Khô - Kệ B2', 180000,'NCC-02'],
  ['VT-004','Dầu đậu nành tinh luyện',             'Dầu chiên',        'Lít', 500, 100,'Kho Khô - Kệ A2',  38000,'NCC-03'],
  ['VT-005','Đường cát trắng (đường kính)',         'Phụ gia',          'Kg',  500, 100,'Kho Khô - Kệ A3',  22000,'NCC-04'],
  ['VT-006','Gừng tươi',                           'Phụ gia',          'Kg',  500,  15,'Kho Mát - Kệ C1',  35000,'NCC-04'],
  ['VT-007','Muối ăn tinh (muối i-ốt)',             'Phụ gia',          'Kg',  500, 30, 'Kho Khô - Kệ A4',   8000,'NCC-04'],
  ['VT-008','Hộp nhựa PP 400g có nắp',             'Bao bì',           'Cái',18000,5000,'Kho Phụ - Kệ D1',  1800,'NCC-05'],
  ['VT-009','Túi PE thực phẩm 200g',               'Bao bì',           'Túi',24000,6000,'Kho Phụ - Kệ D2',   500,'NCC-05'],
  ['VT-010','Ly nhựa dùng 1 lần 250ml + nắp',      'Bao bì',           'Bộ', 12000,3000,'Kho Phụ - Kệ D3',  1200,'NCC-05'],
  ['VT-011','Chai PET 500ml + nắp vặn',             'Bao bì',           'Cái', 8500,2000,'Kho Phụ - Kệ D4',  3200,'NCC-05'],
  ['VT-012','Nhãn dán (label) đậu hủ non',          'Bao bì',           'Tờ', 25000,8000,'Kho Phụ - Kệ D5',   200,'NCC-06'],
  ['VT-013','Màng co nhiệt (shrink film)',           'Bao bì',           'Kg',  500, 20, 'Kho Phụ - Kệ D6',  48000,'NCC-06'],
  ['VT-014','Thùng carton 60×40×30cm',              'Bao bì',           'Cái', 1200, 300,'Kho Phụ - Kệ D7',  12000,'NCC-06'],
  ['VT-015','Nước lọc tinh khiết (bồn 1000L)',      'Nước',             'Lít',500,   0, 'Bể nước SX',          50,'NCC-07'],
  ['VT-016','Chất tẩy rửa thực phẩm (NaOH 3%)',     'Vệ sinh CN',       'Kg',  500, 20, 'Kho Hóa chất',   145000,'NCC-08'],
  ['VT-017','Cồn công nghiệp 70° khử trùng',        'Vệ sinh CN',       'Lít', 500, 25, 'Kho Hóa chất',    52000,'NCC-08'],
  ['VT-018','Đá lạnh (nước đá cây)',                 'Phụ trợ',          'Kg',  500,  0, 'Phòng lạnh',       8000,'NCC-09'],
  ['VT-019','Thịt heo xay (nhồi đậu hủ)',            'Nguyên liệu chính','Kg',  500, 40,'Kho Mát - Kệ C2',  95000,'NCC-10'],
  ['VT-020','Hành lá tươi',                          'Phụ gia',          'Kg',  500,  5, 'Kho Mát - Kệ C3',  25000,'NCC-04'],
];

/* ---------------------------------------------------------------------------
 * 5. Nhà cung cấp (10)
 * -------------------------------------------------------------------------*/
const SUPPLIERS = [
  { id:'NCC-01', name:'HTX Nông nghiệp Đậu Nành Đồng Tháp',   contact:'Nguyễn Văn Đậu',  phone:'0908 111 222', group:'Nguyên liệu chính', rating:4.8, phone2:'(0277) 3874 456', email:'htx.daunhanh@gmail.com', address:'Xã Mỹ An Hưng, Lấp Vò, Đồng Tháp', paymentTerm:'30 ngày sau giao hàng' },
  { id:'NCC-02', name:'Công ty CP Hóa chất Thực phẩm Minh Đức',contact:'Trần Thị Minh',   phone:'0912 333 444', group:'Chất đông tụ', rating:4.6, phone2:'028 3845 1122', email:'minhduc.food@gmail.com', address:'Số 22 Trường Chinh, Quận Tân Bình, HCM', paymentTerm:'15 ngày COD' },
  { id:'NCC-03', name:'Công ty TNHH Dầu Ăn Cái Lân Miền Nam',  contact:'Lê Văn Cái',      phone:'0933 555 666', group:'Dầu chiên', rating:4.7, phone2:'0271 3620 000', email:'cailan.mn@calofic.com.vn', address:'KCN Sóng Thần, Bình Dương', paymentTerm:'30 ngày cuối tháng' },
  { id:'NCC-04', name:'Công ty TNHH Thực phẩm Phụ gia Tân Phú', contact:'Phạm Thị Ngọc',  phone:'0977 777 888', group:'Phụ gia thực phẩm', rating:4.5, phone2:'028 3810 5678', email:'tanphu.phugia@gmail.com', address:'Lô C5, KCN Tân Bình, HCM', paymentTerm:'30 ngày sau hóa đơn' },
  { id:'NCC-05', name:'Công ty CP Bao bì Nhựa Tín Thành',       contact:'Vũ Thanh Bao',    phone:'0918 999 000', group:'Bao bì nhựa', rating:4.4, phone2:'0274 3629 456', email:'tinthanh.baobinhhua@gmail.com', address:'Lô A8, KCN Mỹ Phước 2, Bình Dương', paymentTerm:'15 ngày COD' },
  { id:'NCC-06', name:'Công ty TNHH In ấn & Bao bì Trung Việt', contact:'Đỗ Trung Việt',   phone:'0902 121 343', group:'Bao bì in ấn', rating:4.3, phone2:'028 3854 2211', email:'trungviet.baobiin@gmail.com', address:'Số 54 Phạm Văn Hai, Tân Bình, HCM', paymentTerm:'30 ngày sau giao hàng' },
  { id:'NCC-07', name:'Công ty Cấp nước Đô thị Bình Dương',     contact:'Hoàng Văn Nước',  phone:'0965 454 767', group:'Nước sạch CN', rating:4.9, phone2:'0274 3829 000', email:'capnuoc.binhduong@biwase.com.vn', address:'Số 8 Phú Lợi, Thủ Dầu Một, Bình Dương', paymentTerm:'Thanh toán tháng' },
  { id:'NCC-08', name:'Công ty TNHH Hóa chất Vệ sinh Sáng Tạo', contact:'Bùi Sáng Tạo',    phone:'0949 878 909', group:'Hóa chất vệ sinh', rating:4.2, phone2:'028 3760 1122', email:'sangtao.hoachat@gmail.com', address:'Số 18 Tân Kỳ Tân Quý, Quận 12, HCM', paymentTerm:'30 ngày sau hóa đơn' },
  { id:'NCC-09', name:'Cơ sở Đá Lạnh & Nước Đá Minh Quang',    contact:'Ngô Minh Quang',  phone:'0938 232 545', group:'Đá lạnh / Phụ trợ', rating:4.6, phone2:'0939 232 545', email:'dalanhmnq@gmail.com', address:'Số 23 ĐHT 17, Đông Hưng Thuận, Quận 12', paymentTerm:'Tiền mặt khi giao' },
  { id:'NCC-10', name:'Công ty TNHH Thực phẩm Tươi Sống An Tâm',contact:'Lý Văn An',       phone:'0906 656 878', group:'Nguyên liệu tươi', rating:4.7, phone2:'0906 756 878', email:'antam.tuoisong@gmail.com', address:'Chợ đầu mối nông sản Thủ Đức, HCM', paymentTerm:'Tiền mặt COD' },
];

/* ---------------------------------------------------------------------------
 * 6. Nhân sự — 26 nhân sự chủ chốt + sinh thêm cho đủ 86 người
 * -------------------------------------------------------------------------*/
const DEPARTMENTS = [
  'Ban giám đốc','Kinh doanh','Sản xuất','QC/ATTP','Kho vận','Mua hàng','Kế toán','Hành chính - Nhân sự','Bảo trì - Vệ sinh',
];

/** Loại hợp đồng lao động áp dụng cho hồ sơ nhân sự */
const EMPLOYEE_CONTRACT_TYPES = [
  'Không xác định thời hạn',
  'Xác định thời hạn',
  'Thời vụ / theo công việc',
  'Thử việc',
];

const KEY_EMPLOYEES = [
  ['NV-001','Hà Minh Tú','Ban giám đốc','Giám đốc điều hành','0909 000 001','2016-01-04','ns_dang_lam','Nữ'],
  ['NV-002','Nguyễn Đức Anh','Kinh doanh','Trưởng phòng Kinh doanh','0909 000 002','2017-03-15','ns_dang_lam','Nam'],
  ['NV-003','Trần Thu Hà','Kinh doanh','Nhân viên kinh doanh sỉ','0909 000 003','2019-06-10','ns_dang_lam','Nữ'],
  ['NV-004','Lê Thị Bích','Kinh doanh','Nhân viên kinh doanh lẻ','0909 000 004','2020-08-01','ns_dang_lam','Nữ'],
  ['NV-005','Phạm Quốc Bảo','Sản xuất','Quản đốc xưởng sản xuất','0909 000 005','2017-09-20','ns_dang_lam','Nam'],
  ['NV-006','Vũ Văn Xay','Sản xuất','Tổ trưởng tổ Xay — Lọc','0909 000 006','2021-02-08','ns_dang_lam','Nam'],
  ['NV-007','Đỗ Thị Hiền','Sản xuất','Tổ trưởng tổ Nấu — Đông tụ','0909 000 007','2020-11-16','ns_dang_lam','Nữ'],
  ['NV-008','Nguyễn Văn Hùng','Sản xuất','Tổ trưởng tổ Đóng gói','0909 000 008','2016-05-04','ns_dang_lam','Nam'],
  ['NV-009','Trần Thị Chiên','Sản xuất','Công nhân tổ Chiên','0909 000 009','2018-07-02','ns_dang_lam','Nữ'],
  ['NV-010','Lê Văn Hấp','Sản xuất','Công nhân tổ Hấp — Tiệt trùng','0909 000 010','2018-10-11','ns_dang_lam','Nam'],
  ['NV-011','Phạm Thị Dung','Sản xuất','Công nhân tổ Xay','0909 000 011','2019-01-21','ns_dang_lam','Nữ'],
  ['NV-012','Hoàng Thị Nấu','Sản xuất','Công nhân tổ Nấu','0909 000 012','2019-04-15','ns_dang_lam','Nữ'],
  ['NV-013','Đặng Văn Ép','Sản xuất','Công nhân tổ Ép khuôn','0909 000 013','2020-03-09','ns_dang_lam','Nam'],
  ['NV-014','Bùi Thị Gói','Sản xuất','Công nhân tổ Đóng gói','0909 000 014','2020-06-22','ns_dang_lam','Nữ'],
  ['NV-015','Ngô Thị Lan','QC/ATTP','Trưởng bộ phận QC - ATTP','0909 000 015','2018-02-05','ns_dang_lam','Nữ'],
  ['NV-016','Trịnh Văn Kiểm','QC/ATTP','Nhân viên KCS sản phẩm','0909 000 016','2021-08-30','ns_dang_lam','Nam'],
  ['NV-017','Lý Thị Mai','QC/ATTP','Nhân viên vệ sinh ATTP','0909 000 017','2022-04-18','ns_nghi_phep','Nữ'],
  ['NV-018','Cao Văn Thắng','Kho vận','Thủ kho nguyên liệu & TP','0909 000 018','2018-12-03','ns_dang_lam','Nam'],
  ['NV-019','Đinh Thị Hương','Kho vận','Nhân viên giao hàng','0909 000 019','2021-05-17','ns_dang_lam','Nữ'],
  ['NV-020','Tạ Văn Lợi','Mua hàng','Trưởng phòng Mua hàng','0909 000 020','2019-08-26','ns_dang_lam','Nam'],
  ['NV-021','Võ Thị Kim Ngân','Mua hàng','Chuyên viên Mua nguyên liệu','0909 000 021','2022-01-10','ns_dang_lam','Nữ'],
  ['NV-022','Chu Thị Thanh Thảo','Kế toán','Kế toán trưởng','0909 000 022','2017-11-06','ns_dang_lam','Nữ'],
  ['NV-023','Dương Thị Ngọc','Kế toán','Kế toán công nợ','0909 000 023','2021-09-13','ns_dang_lam','Nữ'],
  ['NV-024','Mai Thị Hồng Nhung','Hành chính - Nhân sự','Trưởng phòng HCNS','0909 000 024','2018-05-21','ns_dang_lam','Nữ'],
  ['NV-025','Lâm Văn Trí','Bảo trì - Vệ sinh','Tổ trưởng Bảo trì máy','0909 000 025','2019-10-07','ns_dang_lam','Nam'],
  ['NV-026','Quách Văn Định','Bảo trì - Vệ sinh','Kỹ thuật viên bảo trì','0909 000 026','2022-07-25','ns_dang_lam','Nam'],
];

/** Sinh thêm công nhân/nhân viên cho đủ 86 người (dữ liệu ổn định nhờ PRNG có seed) */
function buildEmployees() {
  const HO = ['Nguyễn','Trần','Lê','Phạm','Hoàng','Huỳnh','Phan','Vũ','Võ','Đặng','Bùi','Đỗ','Hồ','Ngô','Dương','Lý','Đinh','Tạ','Mai','Cao'];
  const DEM_NAM = ['Văn','Hữu','Đức','Quang','Minh','Thanh','Công','Tiến','Xuân','Bá'];
  const DEM_NU  = ['Thị','Thu','Ngọc','Kim','Thanh','Mỹ','Hồng','Diệu','Phương','Bích'];
  const TEN_NAM = ['An','Bình','Cường','Dũng','Đạt','Giang','Hải','Hoàng','Khánh','Lâm','Long','Nam','Nghĩa','Phúc','Quân','Sang','Tài','Thành','Toàn','Trung','Tuấn','Vinh','Vũ','Duy','Kiệt'];
  const TEN_NU  = ['Anh','Chi','Dung','Hà','Hạnh','Hiền','Hoa','Huyền','Lan','Linh','Loan','Mai','Nga','Ngân','Nhung','Oanh','Phương','Quyên','Thảo','Trang','Tuyết','Vân','Yến','Xuân','Hằng'];
  const WORKER_ROLES = [
    ['Sản xuất','Công nhân tổ Ngâm — Xay'], ['Sản xuất','Công nhân tổ Lọc bã'], ['Sản xuất','Công nhân tổ Nấu'],
    ['Sản xuất','Công nhân tổ Đông tụ'], ['Sản xuất','Công nhân tổ Ép khuôn'], ['Sản xuất','Công nhân tổ Chiên giòn'],
    ['Sản xuất','Công nhân tổ Đóng gói hộp'], ['Sản xuất','Công nhân tổ Dán nhãn'], ['Sản xuất','Lái xe giao hàng'],
    ['QC/ATTP','Nhân viên KCS sản phẩm'], ['Kho vận','Nhân viên kho nguyên liệu'], ['Kho vận','Nhân viên kho thành phẩm'],
    ['Sản xuất','Công nhân vệ sinh thiết bị'], ['Bảo trì - Vệ sinh','Kỹ thuật viên bảo trì'],
    ['Hành chính - Nhân sự','Nhân viên hành chính'], ['Kế toán','Kế toán viên'], ['Mua hàng','Nhân viên mua nguyên liệu'],
  ];

  Rand.reset(20260815);
  const list = KEY_EMPLOYEES.map(([id, name, dept, position, phone, joinDate, status, gender]) => ({
    id, name, dept, position, phone, joinDate, status, gender,
    email: 'nv' + id.slice(3) + '@dauhumetu.vn',
    salary: 0,
  }));

  // 60 nhân sự còn lại: 2 người đã nghỉ việc, 2 nghỉ phép, 3 thử việc, còn lại đang làm
  for (let i = 27; i <= 86; i++) {
    const isNam = Rand.chance(0.72);
    const ho = Rand.pick(HO);
    const dem = isNam ? Rand.pick(DEM_NAM) : Rand.pick(DEM_NU);
    const ten = isNam ? Rand.pick(TEN_NAM) : Rand.pick(TEN_NU);
    const [dept, position] = Rand.pick(WORKER_ROLES);
    let status = 'ns_dang_lam';
    if (i === 84 || i === 85) status = 'ns_nghi_viec';
    else if (i === 80 || i === 81) status = 'ns_nghi_phep';
    else if (i >= 77 && i <= 79) status = 'ns_thu_viec';
    const id = 'NV-' + String(i).padStart(3, '0');
    list.push({
      id,
      name: `${ho} ${dem} ${ten}`,
      dept, position,
      phone: `09${Rand.int(10, 89)} ${Rand.int(100, 999)} ${Rand.int(100, 999)}`,
      email: 'nv' + id.slice(3) + '@dauhumetu.vn',
      joinDate: `${Rand.int(2018, 2026)}-${String(Rand.int(1, 12)).padStart(2, '0')}-${String(Rand.int(1, 28)).padStart(2, '0')}`,
      status, gender: isNam ? 'Nam' : 'Nữ',
      salary: 0,
    });
  }

  // Mức lương tham chiếu theo chức danh (dùng cho báo cáo nhân sự)
  list.forEach((e) => {
    const base = e.position.includes('Giám đốc điều hành') ? 65 :
      e.position.includes('Quản đốc') ? 42 :
      e.position.includes('Trưởng phòng') ? 35 :
      e.position.includes('Tổ trưởng') ? 20 :
      e.position.includes('Chuyên viên') || e.position.includes('Kế toán') ? 18 :
      e.position.includes('Kỹ thuật viên') ? 17 : 12;
    e.salary = (base + Rand.int(0, 4)) * 1000000;
  });

  // Loại hợp đồng lao động: nhân sự chủ chốt gắn bó lâu năm mặc định ký
  // hợp đồng không xác định thời hạn; người đang thử việc luôn có loại
  // hợp đồng "Thử việc" khớp với trạng thái làm việc; còn lại random có seed.
  list.forEach((e) => {
    if (e.status === 'ns_thu_viec') e.contractType = 'Thử việc';
    else if (KEY_EMPLOYEES.some((row) => row[0] === e.id)) e.contractType = 'Không xác định thời hạn';
    else e.contractType = Rand.pick(['Không xác định thời hạn', 'Không xác định thời hạn', 'Xác định thời hạn', 'Xác định thời hạn', 'Thời vụ / theo công việc']);
  });

  // Khóa/ngừng sử dụng: cờ độc lập với trạng thái làm việc — nhân sự đã
  // nghỉ việc mặc định bị ngừng sử dụng, các trường hợp khác vẫn đang dùng.
  list.forEach((e) => { e.active = e.status !== 'ns_nghi_viec'; });

  return list;
}

/* ---------------------------------------------------------------------------
 * 7. Báo giá (20) — [mã, KH, ngày, hiệu lực đến, phụ trách, trạng thái, dòng hàng]
 *    Dòng hàng: [mã SP, số lượng, đơn giá]
 * -------------------------------------------------------------------------*/
const QUOTE_ROWS = [
  ['BG-2026-0090','KH-007','2026-08-08','2026-09-08','NV-002','bg_da_duyet', [['SP-001',1000,12000],['SP-002',500,14000]], 8, 0],
  ['BG-2026-0089','KH-003','2026-08-07','2026-09-07','NV-004','bg_da_duyet', [['SP-003',800,15000]], 8, 0],
  ['BG-2026-0088','KH-004','2026-08-06','2026-09-06','NV-003','bg_da_duyet', [['SP-001',2000,12000],['SP-006',500,16000]], 8, 0],
  ['BG-2026-0087','KH-021','2026-08-05','2026-09-05','NV-002','bg_dam_phan', [['SP-001',5000,11000],['SP-002',3000,13000],['SP-003',2000,14000]], 8, 3],
  ['BG-2026-0086','KH-009','2026-08-04','2026-09-04','NV-004','bg_da_gui',   [['SP-005',200,28000],['SP-004',1000,10000]], 8, 0],
  ['BG-2026-0085','KH-014','2026-08-03','2026-09-03','NV-002','bg_da_duyet', [['SP-010',300,18000]], 8, 2],
  ['BG-2026-0084','KH-001','2026-08-01','2026-09-01','NV-003','bg_da_duyet', [['SP-001',500,12000],['SP-004',300,10000]], 8, 0],
  ['BG-2026-0083','KH-012','2026-07-30','2026-08-30','NV-004','bg_dam_phan', [['SP-006',600,16000]], 8, 5],
  ['BG-2026-0082','KH-016','2026-07-28','2026-08-28','NV-002','bg_da_duyet', [['SP-001',1500,12000],['SP-002',1000,14000]], 8, 0],
  ['BG-2026-0081','KH-025','2026-07-26','2026-08-26','NV-003','bg_da_gui',   [['SP-008',200,35000]], 8, 0],
  ['BG-2026-0080','KH-019','2026-07-24','2026-08-24','NV-003','bg_tu_choi',  [['SP-009',500,22000]], 8, 0],
  ['BG-2026-0079','KH-006','2026-07-22','2026-08-22','NV-002','bg_da_duyet', [['SP-003',1200,15000]], 8, 0],
  ['BG-2026-0078','KH-024','2026-07-20','2026-08-20','NV-004','bg_da_duyet', [['SP-004',2000,10000],['SP-007',1000,18000]], 8, 0],
  ['BG-2026-0077','KH-028','2026-07-18','2026-08-18','NV-003','bg_dam_phan', [['SP-001',3000,11500],['SP-002',2000,13500]], 8, 4],
  ['BG-2026-0076','KH-023','2026-07-15','2026-08-15','NV-002','bg_da_duyet', [['SP-004',1500,10000]], 8, 0],
  ['BG-2026-0075','KH-013','2026-07-12','2026-08-12','NV-004','bg_het_han',  [['SP-003',600,15000]], 8, 0],
  ['BG-2026-0074','KH-010','2026-07-10','2026-08-10','NV-003','bg_het_han',  [['SP-006',400,16000]], 8, 0],
  ['BG-2026-0073','KH-005','2026-07-08','2026-08-08','NV-002','bg_da_duyet', [['SP-001',800,12000]], 8, 0],
  ['BG-2026-0072','KH-011','2026-08-11','2026-09-11','NV-002','bg_da_gui',   [['SP-005',100,28000],['SP-010',200,18000]], 8, 0],
  ['BG-2026-0071','KH-017','2026-08-12','2026-09-12','NV-004','bg_nhap',     [['SP-001',400,12000],['SP-004',200,10000]], 8, 0],
];

/* ---------------------------------------------------------------------------
 * 8. Đơn hàng (30)
 * [mã, KH, ngày đặt, ngày giao dự kiến, phụ trách, trạng thái, mã báo giá, dòng hàng]
 * -------------------------------------------------------------------------*/
const ORDER_ROWS = [
  ['DH-2026-0088','KH-007','2026-08-15','2026-08-18','NV-002','dh_dang_san_xuat','BG-2026-0090',[['SP-001',1000,12000],['SP-002',500,14000]]],
  ['DH-2026-0087','KH-003','2026-08-14','2026-08-17','NV-004','dh_cho_san_xuat','BG-2026-0089',[['SP-003',800,15000]]],
  ['DH-2026-0086','KH-004','2026-08-13','2026-08-16','NV-003','dh_hoan_thanh','BG-2026-0088',[['SP-001',2000,12000],['SP-006',500,16000]]],
  ['DH-2026-0085','KH-014','2026-08-11','2026-08-14','NV-002','dh_dang_san_xuat','BG-2026-0085',[['SP-010',300,18000]]],
  ['DH-2026-0084','KH-001','2026-08-10','2026-08-13','NV-003','dh_dang_san_xuat','BG-2026-0084',[['SP-001',500,12000],['SP-004',300,10000]]],
  ['DH-2026-0083','KH-016','2026-08-08','2026-08-11','NV-002','dh_dang_san_xuat','BG-2026-0082',[['SP-001',1500,12000],['SP-002',1000,14000]]],
  ['DH-2026-0082','KH-006','2026-08-06','2026-08-10','NV-002','dh_dang_san_xuat','BG-2026-0079',[['SP-003',1200,15000]]],
  ['DH-2026-0081','KH-024','2026-08-05','2026-08-08','NV-004','dh_dang_san_xuat','BG-2026-0078',[['SP-004',2000,10000],['SP-007',1000,18000]]],
  ['DH-2026-0080','KH-023','2026-08-03','2026-08-06','NV-002','dh_dang_san_xuat','BG-2026-0076',[['SP-004',1500,10000]]],
  ['DH-2026-0079','KH-005','2026-08-01','2026-08-04','NV-002','dh_dang_san_xuat','BG-2026-0073',[['SP-001',800,12000]]],
  ['DH-2026-0078','KH-009','2026-07-30','2026-08-02','NV-004','dh_dang_san_xuat',null,[['SP-004',1000,10000],['SP-001',500,12000]]],
  ['DH-2026-0077','KH-021','2026-07-28','2026-08-01','NV-002','dh_dang_san_xuat',null,[['SP-001',5000,11000],['SP-002',3000,13000]]],
  ['DH-2026-0076','KH-012','2026-07-26','2026-07-29','NV-004','dh_hoan_thanh',null,[['SP-006',600,16000]]],
  ['DH-2026-0075','KH-015','2026-07-24','2026-07-27','NV-004','dh_da_giao',null,[['SP-010',200,18000]]],
  ['DH-2026-0074','KH-018','2026-07-22','2026-07-25','NV-003','dh_da_giao',null,[['SP-003',500,15000]]],
  ['DH-2026-0073','KH-020','2026-07-20','2026-07-23','NV-004','dh_da_giao',null,[['SP-005',150,28000]]],
  ['DH-2026-0072','KH-002','2026-07-18','2026-07-21','NV-003','dh_da_giao',null,[['SP-001',800,12000]]],
  ['DH-2026-0071','KH-027','2026-07-16','2026-07-19','NV-002','dh_da_giao',null,[['SP-004',1200,10000],['SP-007',600,18000]]],
  ['DH-2026-0070','KH-028','2026-07-14','2026-07-17','NV-003','dh_da_giao',null,[['SP-001',2000,12000]]],
  ['DH-2026-0069','KH-013','2026-07-12','2026-07-15','NV-003','dh_da_giao',null,[['SP-003',700,15000]]],
  ['DH-2026-0068','KH-016','2026-07-10','2026-07-13','NV-003','dh_da_giao',null,[['SP-006',500,16000]]],
  ['DH-2026-0067','KH-029','2026-07-08','2026-07-11','NV-004','dh_da_giao',null,[['SP-009',300,22000]]],
  ['DH-2026-0066','KH-010','2026-07-06','2026-07-09','NV-003','dh_da_giao',null,[['SP-002',800,14000]]],
  ['DH-2026-0065','KH-025','2026-07-04','2026-07-07','NV-003','dh_da_giao',null,[['SP-008',150,35000]]],
  ['DH-2026-0064','KH-019','2026-07-02','2026-07-05','NV-003','dh_da_huy',null,[['SP-001',200,12000]]],
  ['DH-2026-0063','KH-008','2026-06-30','2026-07-03','NV-003','dh_da_giao',null,[['SP-006',400,16000]]],
  ['DH-2026-0062','KH-001','2026-06-28','2026-07-01','NV-003','dh_da_giao',null,[['SP-001',600,12000]]],
  ['DH-2026-0061','KH-004','2026-06-26','2026-06-29','NV-002','dh_da_giao',null,[['SP-004',800,10000]]],
  ['DH-2026-0060','KH-014','2026-06-24','2026-06-27','NV-002','dh_da_giao',null,[['SP-010',150,18000]]],
  // Đơn hàng đậu hủ ky — Cần đậu nành số lượng lớn, dùng để minh họa tình huống SẮP HẾT VẬT TƯ
  ['DH-2026-0059','KH-022','2026-08-12','2026-08-16','NV-003','dh_cho_san_xuat',null,[['SP-005',500,28000]]],
];

/* ---------------------------------------------------------------------------
 * 9. Lệnh sản xuất (20)
 * [mã, đơn hàng, mã SP, số lượng, bắt đầu, deadline, phụ trách, trạng thái,
 *  số công đoạn đã xong, số lượng đang làm dở ở công đoạn kế tiếp]
 * -------------------------------------------------------------------------*/
const PO_STAGES = ['Ngâm đậu', 'Xay — Lọc', 'Nấu sữa', 'Đông tụ', 'Ép khuôn', 'Cắt — Đóng gói', 'QC — ATTP', 'Hoàn thành'];
const STAGE_MACHINE = {
  'Ngâm đậu':      ['Bể ngâm inox 500L — Dây A', 'Bể ngâm inox 500L — Dây B'],
  'Xay — Lọc':    ['Máy xay công nghiệp XD-200', 'Máy lọc rung ép bã LB-01'],
  'Nấu sữa':      ['Nồi nấu inox 2 lớp 300L — Lò 1', 'Nồi nấu inox 2 lớp 300L — Lò 2'],
  'Đông tụ':       ['Bể đông tụ có khuấy DT-01', 'Bể đông tụ có khuấy DT-02'],
  'Ép khuôn':      ['Máy ép khuôn thủy lực KH-2', 'Khuôn ép tay KH-05'],
  'Cắt — Đóng gói':['Dao cắt đa năng + máy đóng gói bán tự động', 'Máy hút chân không VC-200'],
  'QC — ATTP':    ['Phòng kiểm nghiệm KN-01', 'Bàn kiểm QC-02'],
  'Hoàn thành':   ['Kho lạnh 0-4°C KL-01'],
};
const STAGE_LEAD = {
  'Ngâm đậu':'NV-006','Xay — Lọc':'NV-006','Nấu sữa':'NV-007','Đông tụ':'NV-007',
  'Ép khuôn':'NV-013','Cắt — Đóng gói':'NV-014','QC — ATTP':'NV-015','Hoàn thành':'NV-018',
};

const PO_ROWS = [
  ['LSX-2026-0048','DH-2026-0088','SP-001',1000,'2026-08-15','2026-08-18','NV-005','lsx_dang_san_xuat',5,800],
  ['LSX-2026-0047','DH-2026-0085','SP-010', 300,'2026-08-12','2026-08-15','NV-005','lsx_dang_san_xuat',4,180],
  ['LSX-2026-0046','DH-2026-0084','SP-001', 500,'2026-08-11','2026-08-14','NV-005','lsx_dang_san_xuat',3,280],
  ['LSX-2026-0045','DH-2026-0084','SP-004', 300,'2026-08-11','2026-08-14','NV-005','lsx_dang_san_xuat',5,220],
  ['LSX-2026-0044','DH-2026-0083','SP-001',1500,'2026-08-09','2026-08-12','NV-005','lsx_dang_san_xuat',2,900],
  ['LSX-2026-0043','DH-2026-0082','SP-003',1200,'2026-08-07','2026-08-10','NV-005','lsx_dang_san_xuat',3,700],
  ['LSX-2026-0042','DH-2026-0081','SP-004',2000,'2026-08-06','2026-08-09','NV-005','lsx_dang_san_xuat',4,1500],
  ['LSX-2026-0041','DH-2026-0080','SP-004',1500,'2026-08-04','2026-08-07','NV-005','lsx_dang_san_xuat',3,1000],
  ['LSX-2026-0040','DH-2026-0079','SP-001', 800,'2026-08-02','2026-08-05','NV-005','lsx_dang_qc',      6,650],
  ['LSX-2026-0039','DH-2026-0078','SP-001', 500,'2026-07-31','2026-08-03','NV-005','lsx_dang_qc',      6,480],
  ['LSX-2026-0038','DH-2026-0077','SP-001',5000,'2026-07-29','2026-08-02','NV-005','lsx_dang_san_xuat',2,3000],
  ['LSX-2026-0037','DH-2026-0076','SP-006', 600,'2026-07-27','2026-07-30','NV-005','lsx_hoan_thanh',   8, 0],
  ['LSX-2026-0036','DH-2026-0075','SP-010', 200,'2026-07-25','2026-07-28','NV-005','lsx_hoan_thanh',   8, 0],
  ['LSX-2026-0035','DH-2026-0074','SP-003', 500,'2026-07-23','2026-07-26','NV-005','lsx_hoan_thanh',   8, 0],
  ['LSX-2026-0034','DH-2026-0073','SP-005', 150,'2026-07-21','2026-07-24','NV-005','lsx_hoan_thanh',   8, 0],
  ['LSX-2026-0033','DH-2026-0072','SP-001', 800,'2026-07-19','2026-07-22','NV-005','lsx_hoan_thanh',   8, 0],
  ['LSX-2026-0032','DH-2026-0071','SP-004',1200,'2026-07-17','2026-07-20','NV-005','lsx_hoan_thanh',   8, 0],
  ['LSX-2026-0031','DH-2026-0070','SP-001',2000,'2026-07-15','2026-07-18','NV-005','lsx_hoan_thanh',   8, 0],
  ['LSX-2026-0030','DH-2026-0087','SP-003', 800,'2026-08-18','2026-08-21','NV-005','lsx_cho_san_xuat', 0, 0],
  // Lệnh này chưa chạy được vì thiếu đậu nành (VT-001 gần hết) — điểm nhấn demo
  ['LSX-2026-0029','DH-2026-0059','SP-005', 500,'2026-08-16','2026-08-20','NV-005','lsx_cho_san_xuat', 0, 0],
];

/* ---------------------------------------------------------------------------
 * 10. Yêu cầu mua hàng (15)
 * [mã, người yêu cầu, NCC, ngày yêu cầu, trạng thái, dòng hàng [mã VT, SL, đơn giá], lý do]
 * -------------------------------------------------------------------------*/
const PR_ROWS = [
  // Cần bổ sung đậu nành gấp cho LSX-2026-0029 (đậu hủ ky) + tồn kho sắp hết
  ['YCM-2026-0046','NV-018','NCC-01','2026-08-14','mh_cho_duyet',[['VT-001',2000,22000]],'Bổ sung đậu nành nguyên hạt khẩn cấp — tồn kho sắp hết (còn 2.500kg, đơn sản xuất cần thêm 3.500kg)'],
  ['YCM-2026-0045','NV-018','NCC-05','2026-08-14','mh_cho_duyet',[['VT-008',10000,1800],['VT-009',8000,500]],'Bổ sung hộp nhựa 400g và túi PE — đủ dùng cho 2 tuần sản xuất'],
  ['YCM-2026-0044','NV-021','NCC-02','2026-08-13','mh_cho_duyet',[['VT-002',100,85000],['VT-003',60,180000]],'Thạch cao + Nigari phục vụ đơn đậu hủ cứng tháng 8'],
  ['YCM-2026-0043','NV-018','NCC-03','2026-08-12','mh_da_duyet',[['VT-004',200,38000]],'Dầu đậu nành tinh luyện cho dây chuyền chiên — bình thường định kỳ 2 tuần'],
  ['YCM-2026-0042','NV-021','NCC-04','2026-08-11','mh_da_duyet',[['VT-005',300,22000],['VT-007',60,8000]],'Đường cát + muối ăn bổ sung định kỳ tháng 8'],
  ['YCM-2026-0041','NV-018','NCC-06','2026-08-10','mh_da_dat_hang',[['VT-012',15000,200],['VT-014',5000,12000]],'Nhãn dán tháng 8 + Thùng carton giao hàng'],
  ['YCM-2026-0040','NV-021','NCC-01','2026-08-08','mh_da_dat_hang',[['VT-001',3000,22000]],'Đậu nành nhập tháng 8 theo kế hoạch sản xuất'],
  ['YCM-2026-0039','NV-018','NCC-08','2026-08-06','mh_dang_giao',[['VT-016',30,145000],['VT-017',40,52000]],'Chất tẩy rửa + cồn khử trùng tháng 8 theo quy trình ATTP'],
  ['YCM-2026-0038','NV-021','NCC-10','2026-08-04','mh_dang_giao',[['VT-019',80,95000],['VT-020',10,25000]],'Thịt heo xay + hành lá cho dây chuyền đậu hủ nhồi thịt'],
  ['YCM-2026-0037','NV-018','NCC-05','2026-08-01','mh_da_nhan',[['VT-011',5000,3200],['VT-010',3000,1200]],'Chai PET + ly nhựa bổ sung kịp giao đơn sữa đậu tháng 8'],
  ['YCM-2026-0036','NV-021','NCC-01','2026-07-29','mh_hoan_thanh',[['VT-001',4000,22000]],'Đậu nành nhập tháng 7 theo kế hoạch — đã nhận đủ'],
  ['YCM-2026-0035','NV-018','NCC-02','2026-07-26','mh_hoan_thanh',[['VT-002',80,85000]],'Thạch cao tháng 7 — đã nhập kho xong'],
  ['YCM-2026-0034','NV-021','NCC-03','2026-07-22','mh_hoan_thanh',[['VT-004',150,38000]],'Dầu ăn tháng 7 — đã thanh toán và lưu kho'],
  ['YCM-2026-0033','NV-018','NCC-04','2026-07-18','mh_hoan_thanh',[['VT-005',200,22000],['VT-006',15,35000]],'Đường cát + gừng tháng 7 — hoàn thành'],
  ['YCM-2026-0032','NV-021','NCC-06','2026-07-15','mh_tu_choi',[['VT-013',50000,200]],'Đề xuất mua màng co nhiệt số lượng lớn — tồn kho hiện tại vẫn đủ dùng 3 tháng'],
];

/* ---------------------------------------------------------------------------
 * 11. Hợp đồng (15)
 * [mã, KH, loại, ngày ký, hết hạn, giá trị, trạng thái, đã thanh toán]
 * -------------------------------------------------------------------------*/
const CONTRACT_ROWS = [
  ['HD-2026-015','KH-007','Hợp đồng cung cấp đậu hủ','2026-08-08','2026-12-31',324000000,'hd_hieu_luc',150000000],
  ['HD-2026-014','KH-021','Hợp đồng nguyên tắc phân phối','2026-08-01','2027-07-31',720000000,'hd_hieu_luc',280000000],
  ['HD-2026-013','KH-004','Hợp đồng cung cấp siêu thị','2026-07-28','2026-09-15',185000000,'hd_sap_het_han',95000000],
  ['HD-2026-012','KH-014','Hợp đồng cung cấp','2026-07-20','2026-09-10',210000000,'hd_sap_het_han',105000000],
  ['HD-2026-011','KH-002','Hợp đồng nguyên tắc','2026-07-15','2027-07-14',480000000,'hd_hieu_luc',240000000],
  ['HD-2026-010','KH-009','Hợp đồng cung cấp chợ sỉ','2026-07-10','2026-09-08',156000000,'hd_sap_het_han',80000000],
  ['HD-2026-009','KH-006','Hợp đồng cung cấp nhà hàng','2026-07-02','2026-11-30',180000000,'hd_hieu_luc',90000000],
  ['HD-2026-008','KH-001','Hợp đồng nguyên tắc nhà hàng','2026-06-25','2027-06-24',360000000,'hd_hieu_luc',180000000],
  ['HD-2026-007','KH-023','Hợp đồng cung cấp','2026-06-18','2026-09-12',120000000,'hd_sap_het_han',60000000],
  ['HD-2026-006','KH-012','Hợp đồng cung cấp chợ sỉ','2026-06-05','2026-12-05',96000000,'hd_hieu_luc',48000000],
  ['HD-2026-005','KH-016','Hợp đồng bếp ăn KCN','2026-05-20','2026-08-10',144000000,'hd_het_han',144000000],
  ['HD-2026-004','KH-028','Hợp đồng cung cấp bếp ăn','2026-05-12','2027-05-11',216000000,'hd_hieu_luc',108000000],
  ['HD-2026-003','KH-020','Hợp đồng nguyên tắc siêu thị','2026-04-28','2027-04-27',480000000,'hd_hieu_luc',240000000],
  ['HD-2026-002','KH-025','Hợp đồng cung cấp','2026-03-15','2026-07-30',84000000,'hd_thanh_ly',84000000],
  ['HD-2026-001','KH-022','Hợp đồng cung cấp trường học','2026-03-02','2026-09-01',72000000,'hd_cho_ky',0],
];

/* ---------------------------------------------------------------------------
 * 12. Người dùng & phân quyền
 * -------------------------------------------------------------------------*/
const ROLES = [
  { id:'R01', name:'Quản trị viên',        desc:'Toàn quyền hệ thống, quản lý người dùng & cấu hình', users:2,
    perms:['Xem tất cả module','Thêm/sửa/xóa dữ liệu','Duyệt báo giá & mua hàng','Quản lý người dùng','Cấu hình hệ thống','Xuất báo cáo'] },
  { id:'R02', name:'Ban giám đốc',          desc:'Xem toàn bộ số liệu, phê duyệt hợp đồng & mua sắm', users:2,
    perms:['Xem tất cả module','Duyệt báo giá & mua hàng','Duyệt hợp đồng','Xuất báo cáo'] },
  { id:'R03', name:'Trưởng phòng Kinh doanh',desc:'Quản lý khách hàng, báo giá, đơn hàng, hợp đồng', users:1,
    perms:['Khách hàng','Báo giá','Đơn hàng','Hợp đồng','Duyệt báo giá','Xuất báo cáo kinh doanh'] },
  { id:'R04', name:'Nhân viên Kinh doanh',   desc:'Tạo báo giá, đơn hàng cho khách được phân công', users:4,
    perms:['Khách hàng (được phân công)','Tạo báo giá','Tạo đơn hàng','Xem hợp đồng'] },
  { id:'R05', name:'Quản đốc Sản xuất',      desc:'Điều hành lệnh sản xuất, phân công công đoạn',   users:3,
    perms:['Lệnh sản xuất','Tiến độ sản xuất','Cập nhật công đoạn','Xem vật tư','Báo cáo sản xuất'] },
  { id:'R06', name:'Thủ kho',                desc:'Quản lý vật tư, nhập xuất tồn, đề xuất mua hàng', users:3,
    perms:['Vật tư','Tồn kho','Nhập/xuất kho','Tạo yêu cầu mua hàng'] },
  { id:'R07', name:'Mua hàng',               desc:'Xử lý yêu cầu mua, đặt hàng nhà cung cấp',        users:2,
    perms:['Mua sắm','Nhà cung cấp','Vật tư (xem)','Báo cáo mua hàng'] },
  { id:'R08', name:'Kế toán',                desc:'Theo dõi công nợ, doanh thu, chi phí',            users:3,
    perms:['Công nợ','Doanh thu','Chi phí mua sắm','Hợp đồng (xem)','Báo cáo tài chính'] },
];

const USER_ROWS = [
  ['U01','NV-001','tu.ha','R01','2026-08-15 08:12','active'],
  ['U02','NV-008','hung.nv','R05','2026-08-15 07:45','active'],
  ['U03','NV-002','anh.nd','R03','2026-08-15 08:30','active'],
  ['U04','NV-003','ha.tt','R04','2026-08-15 08:05','active'],
  ['U05','NV-004','bich.lt','R04','2026-08-14 17:22','active'],
  ['U06','NV-005','bao.pq','R02','2026-08-15 07:58','active'],
  ['U07','NV-015','lan.nt','R05','2026-08-15 08:01','active'],
  ['U08','NV-018','thang.cv','R06','2026-08-15 06:55','active'],
  ['U09','NV-019','huong.dt','R06','2026-08-14 16:40','active'],
  ['U10','NV-020','loi.tv','R07','2026-08-15 08:20','active'],
  ['U11','NV-021','ngan.vtk','R07','2026-08-14 15:10','active'],
  ['U12','NV-022','thao.ctt','R08','2026-08-15 08:15','active'],
  ['U13','NV-023','ngoc.dt','R08','2026-08-14 17:05','active'],
  ['U14','NV-024','nhung.mth','R01','2026-08-13 09:30','active'],
  ['U15','NV-009','nam.tv','R05','2026-08-15 06:48','active'],
  ['U16','NV-016','kien.tv','R05','2026-08-14 14:20','locked'],
];

/* ---------------------------------------------------------------------------
 * 13. Xây dựng DB — chuyển các bảng dữ liệu thô thành object nghiệp vụ
 * -------------------------------------------------------------------------*/
const DB = {
  today: TODAY,
  company: {
    name: 'CÔNG TY TNHH SX TM DV LÊ NAM',
    short: 'Lê Nam',
    address: 'Số 128 Lê Văn Việt, Phường Hiệp Phú, Quận 9, TP. Hồ Chí Minh',
    tax: '0316875432',
    phone: '028 3896 5678',
    email: 'info@lenamfood.vn',
    website: 'lenamfood.vn',
  },
  currentUser: { id:'NV-001', name:'Hà Minh Tú', role:'Quản trị viên', initials:'HT', email:'tu.ha@lenamfood.vn' },

  // KPI công ty (số liệu chốt tháng 8/2026 do phòng kế toán tổng hợp)
  kpi: {
    revenueMonth: 486000000,
    revenueChange: 14.2,
    ordersYtd: 128,
    ordersChange: 10.4,
    poYtd: 47,
    poChange: 8.2,
    inProduction: 20,
    inventoryValue: 85000000,
    inventoryChange: 5.1,
    receivable: 128000000,
    receivableChange: 3.8,
  },
  revenueTrend: [
    { month:'T3/2026', value: 320000000 },
    { month:'T4/2026', value: 368000000 },
    { month:'T5/2026', value: 395000000 },
    { month:'T6/2026', value: 420000000 },
    { month:'T7/2026', value: 455000000 },
    { month:'T8/2026', value: 486000000 },
  ],
  // Sản lượng theo dây chuyền trong tháng (đơn vị: mẻ sản xuất)
  workshops: [
    { name:'Ngâm — Xay', output: 280, capacity: 300 },
    { name:'Nấu — Đông tụ', output: 265, capacity: 300 },
    { name:'Ép khuôn',  output: 250, capacity: 280 },
    { name:'Chiên',     output: 180, capacity: 200 },
    { name:'Đóng gói',  output: 270, capacity: 300 },
    { name:'QC — Kho',  output: 260, capacity: 280 },
  ],
  products: PRODUCTS,
  suppliers: SUPPLIERS,
  workshopNames: ['Ngâm đậu', 'Xay — Lọc', 'Nấu sữa', 'Đông tụ', 'Ép khuôn', 'Cắt — Đóng gói', 'QC — ATTP', 'Hoàn thành'],
  departments: DEPARTMENTS,
  contractTypes: EMPLOYEE_CONTRACT_TYPES,
  roles: ROLES,
  statusMap: STATUS,
  stageNames: PO_STAGES,
  settings: {
    vatRate: 10,
    overheadPct: 8,      // chi phí quản lý phân bổ vào giá thành
    defaultMargin: 18,   // lợi nhuận mặc định khi bóc tách báo giá mới
    quoteValidDays: 30,
    currency: 'VND',
    fiscalYear: 2026,
    lowStockAlert: true,
    dueSoonDays: 7,
    emailNotify: true,
    autoCreatePO: true,
  },
  activities: [],
  notifications: [],
  stockMoves: [],
};

/* Ngưỡng tồn tối thiểu cho thành phẩm — dùng riêng cho cảnh báo tồn kho.
 * Khai báo sau khi DB đã được khởi tạo để tránh ReferenceError khi tải trang. */
DB.finishedMinStock = {
  'SP-001': 900, 'SP-002': 600, 'SP-003': 450, 'SP-004': 120, 'SP-005': 80,
  'SP-006': 200, 'SP-007': 100, 'SP-008': 70, 'SP-009': 80, 'SP-010': 100,
};

/* ---- Khách hàng ---- */
const ADDR_PREFIX = ['Lô A2, KCN Sóng Thần', 'Lô C7, KCN Amata', 'Số 128 Nguyễn Văn Linh', 'Lô B5, KCN Tân Tạo', 'Số 45 Lý Thường Kiệt', 'Lô D12, KCN VSIP'];
DB.customers = CUSTOMER_ROWS.map(([id, name, contact, phone, email, province, tax, group, status, since, owner, debt], i) => ({
  id, name, contact, phone, email, province, tax, group, status, since, owner, debt,
  address: `${ADDR_PREFIX[i % ADDR_PREFIX.length]}, ${province}`,
  note: '',
}));

DB.customerCareLogs = [
  {id: 1,customerId: 'KH-001',date: '2026-09-04',method: 'phone',staff: 'Nguyễn Đức Anh',content: 'Trao đổi về nhu cầu đặt hàng tháng 9.'},
  {id: 2,customerId: 'KH-001',date: '2026-08-28',method: 'meeting',staff: 'Lê Thị Bích',content: 'Trao đổi về chính sách giá.'}
];

/* ---- Vật tư ---- */
DB.materials = MATERIAL_ROWS.map(([id, name, group, unit, stock, minStock, location, price, supplier]) => ({
  id, name, group, unit, stock, minStock, location, price, supplier,
  get status() {
    if (this.stock <= 0) return 'vt_het_hang';
    if (this.stock < this.minStock) return 'vt_sap_het';
    return 'vt_du_ton';
  },
  get value() { return this.stock * this.price; },
}));


/* ---- Danh mục hàng hóa dùng chung cho Mua hàng & Kho ----
 * type: RAW_MATERIAL | SEMI_FINISHED | FINISHED_GOODS
 * Dữ liệu này được InventoryAPI đồng bộ lên KIO server để các dropdown/lọc không còn hard-code. */
const DEFAULT_CATEGORY_PREFIX = {
  'Nguyên liệu chính':'NLC', 'Chất đông tụ':'CDT', 'Dầu chiên':'DC', 'Phụ gia':'PG',
  'Phụ gia thực phẩm':'PGTP', 'Bao bì':'BB', 'Nước':'NUOC', 'Vệ sinh CN':'VSCN', 'Phụ trợ':'PT',
  'Bán thành phẩm':'BTP', 'Thành phẩm':'TP'
};
DB.itemCategories = [
  ...[...new Set(DB.materials.map((m) => m.group).filter(Boolean))].map((name, i) => ({ id: `CAT-RAW-${String(i + 1).padStart(3, '0')}`, type: 'RAW_MATERIAL', name, codePrefix: DEFAULT_CATEGORY_PREFIX[name] || `NL${i+1}`, status: 'active' })),
  { id: 'CAT-SEMI-001', type: 'SEMI_FINISHED', name: 'Bán thành phẩm', codePrefix: 'BTP', status: 'active' },
  { id: 'CAT-FIN-001', type: 'FINISHED_GOODS', name: 'Thành phẩm', codePrefix: 'TP', status: 'active' },
];

/* BTP chưa có danh mục master trong source cũ. Tạo mảng riêng để có thể CRUD mà không
 * đưa BTP vào DB.products (tránh ảnh hưởng luồng bán hàng/BOM hiện có). */
DB.semiFinishedProducts = DB.semiFinishedProducts || [];
DB.products.forEach((p) => { if (!p.category) p.category = 'Thành phẩm'; });

/* ---- Nhân sự ---- */
DB.employees = buildEmployees();

/* ---- Danh mục công đoạn sản xuất ----
 * source = '' nghĩa là công đoạn có sẵn trong danh mục;
 * nếu công đoạn được khai báo lần đầu từ một báo giá thì source = mã báo giá đó. */
DB.operations = OPERATION_ROWS.map(([id, name, workshop, machine, rate]) => ({
  id, name, workshop, machine, rate,
  unit: 'giờ',
  leadId: STAGE_LEAD[workshop] || 'NV-008',
  source: '',
  note: '',
}));

/* ---- Người dùng ---- */
DB.users = USER_ROWS.map(([id, empId, username, roleId, lastLogin, state]) => {
  const emp = DB.employees.find((e) => e.id === empId);
  return { id, empId, username, roleId, lastLogin, state, name: emp ? emp.name : username, dept: emp ? emp.dept : '' };
});

/* ---------------------------------------------------------------------------
 * BÓC TÁCH GIÁ THÀNH — dùng chung cho báo giá và cho màn định mức sản phẩm
 * Giá thành 1 đơn vị SP = vật tư + công đoạn + chi phí quản lý (%)
 * Lợi nhuận = đơn giá bán − giá thành
 * -------------------------------------------------------------------------*/

/** Nở định mức vật tư của sản phẩm thành danh sách dòng có tên, ĐVT, thành tiền */
function expandBom(bom) {
  return (bom || []).map(([mid, qtyPer]) => {
    const m = DB.materials.find((x) => x.id === mid) || { name: mid, unit: '', price: 0, group: '' };
    return { materialId: mid, name: m.name, unit: m.unit, group: m.group, qtyPer, price: m.price, amount: Math.round(qtyPer * m.price) };
  });
}

/** Nở định mức công đoạn của sản phẩm thành danh sách dòng có máy, đơn giá giờ */
function expandRouting(routing) {
  return (routing || []).map(([oid, hoursPer]) => {
    const o = DB.operations.find((x) => x.id === oid) || { name: oid, workshop: '', machine: '', rate: 0 };
    return { operationId: oid, name: o.name, workshop: o.workshop, machine: o.machine, hoursPer, rate: o.rate, amount: Math.round(hoursPer * o.rate) };
  });
}

/** Tổng hợp giá thành từ 2 danh sách đã nở + đơn giá bán */
function rollupCost(materials, operations, price, overheadPct) {
  const oh = overheadPct == null ? DB.settings.overheadPct : overheadPct;
  const materialCost = materials.reduce((s, m) => s + m.amount, 0);
  const laborCost = operations.reduce((s, o) => s + o.amount, 0);
  const directCost = materialCost + laborCost;
  const overhead = Math.round((directCost * oh) / 100);
  const unitCost = directCost + overhead;
  const profit = (price || 0) - unitCost;
  return {
    materialCost, laborCost, directCost, overhead, unitCost, overheadPct: oh,
    profit, marginPct: unitCost ? Math.round((profit / unitCost) * 1000) / 10 : 0,
    totalHours: operations.reduce((s, o) => s + o.hoursPer, 0),
  };
}

/** Giá bán suy ra từ giá thành và tỷ lệ lợi nhuận (làm tròn nghìn đồng) */
function priceFromCost(unitCost, marginPct) {
  return Math.round((unitCost * (1 + (Number(marginPct) || 0) / 100)) / 1000) * 1000;
}

/* ---- Hàm tính tiền dùng chung cho báo giá / đơn hàng ---- */
function calcDocTotals(items, vatRate = 10, discountPct = 0) {
  const subtotal = items.reduce((s, it) => s + it.qty * it.price, 0);
  const discount = Math.round((subtotal * discountPct) / 100);
  const vat = Math.round(((subtotal - discount) * vatRate) / 100);
  return { subtotal, discount, vat, total: subtotal - discount + vat };
}

/** Dòng chứng từ kèm bóc tách vật tư + công đoạn lấy từ định mức sản phẩm */
function buildItems(rows) {
  return rows.map(([sp, qty, price], i) => {
    const p = PRODUCTS.find((x) => x.id === sp);
    const materials = expandBom(p.bom);
    const operations = expandRouting(p.routing);
    const cost = rollupCost(materials, operations, price);
    return {
      no: i + 1, productId: sp, name: p.name, spec: p.spec, unit: p.unit, qty, price,
      amount: qty * price, materials, operations, ...cost,
    };
  });
}

/* ---- Báo giá ----
 * Hai kiểu cùng tồn tại trong hệ thống:
 *   • Báo giá theo THAM SỐ ĐẦU VÀO (có mảng inputs) — dùng cho thang máng cáp,
 *     tính giá theo VND/kg qua bảng phân tích giá.
 *   • Báo giá theo BẢNG GIÁ SẢN PHẨM (có mảng items) — dùng cho sản phẩm đậu hủ.
 */
/* ---- Báo giá sản phẩm ----
 * Báo giá được lập theo danh mục sản phẩm đậu hũ/thực phẩm,
 * sử dụng BOM + Routing để bóc tách giá thành nhưng giữ nguyên công thức tính hiện có.
 */
DB.quotes = QUOTE_ROWS.map(
  ([id, customerId, date, validUntil, ownerId, status, rows, vatRate, discountPct]) => {
    const items = buildItems(rows);
    const t = calcDocTotals(items, vatRate, discountPct);

    return {
      id,
      customerId,
      date,
      validUntil,
      ownerId,
      status,
      items,
      vatRate,
      discountPct,
      ...t,

      paymentTerm:
        'Thanh toán COD hoặc chuyển khoản trong ngày giao hàng',

      note:
        'Giá chưa bao gồm phí vận chuyển. Sản phẩm đảm bảo an toàn thực phẩm, có kiểm nghiệm ATTP.',
    };
  }
);

/* ---------------------------------------------------------------------------
 * BÁO GIÁ SẢN PHẨM LÊ NAM
 *
 * Không sử dụng mô hình báo giá theo cấu kiện cơ khí, kích thước,
 * khối lượng phôi hoặc VND/kg.
 *
 * Báo giá được xây dựng dựa trên:
 * Sản phẩm -> BOM -> Routing -> Giá thành -> Giá bán.
 *
 * Giữ biến PARAM_QUOTES để tương thích với các module cũ nếu vẫn tham chiếu.
 * -------------------------------------------------------------------------*/
const PARAM_QUOTES = [];
/* ---- Báo giá sản phẩm ----
 * Báo giá được lập theo danh mục sản phẩm đậu hũ/thực phẩm,
 * sử dụng BOM + Routing để bóc tách giá thành nhưng giữ nguyên công thức tính hiện có.
 */
DB.quotes = QUOTE_ROWS.map(
  ([id, customerId, date, validUntil, ownerId, status, rows, vatRate, discountPct]) => {
    const items = buildItems(rows);
    const t = calcDocTotals(items, vatRate, discountPct);

    return {
      id,
      customerId,
      date,
      validUntil,
      ownerId,
      status,
      items,
      vatRate,
      discountPct,
      ...t,

      paymentTerm:
        'Thanh toán COD hoặc chuyển khoản trong ngày giao hàng',

      note:
        'Giá chưa bao gồm phí vận chuyển. Sản phẩm đảm bảo an toàn thực phẩm, có kiểm nghiệm ATTP.',
    };
  }
);
/* ---- Đơn hàng ---- */
DB.orders = ORDER_ROWS.map(([id, customerId, date, dueDate, ownerId, status, quoteId, rows]) => {
  const items = buildItems(rows);
  const t = calcDocTotals(items, 10, 0);
  return { id, customerId, date, dueDate, ownerId, status, quoteId, items, vatRate: 10, discountPct: 0, ...t, deliveryAddress: '' };
});

/* ---- Lệnh sản xuất: dựng chi tiết 8 công đoạn ---- */
function buildStages(qty, doneCount, wipQty, startDate) {
  return PO_STAGES.map((name, i) => {
    const isDone = i < doneCount;
    const isWip = i === doneCount && wipQty > 0;
    const d0 = addDays(startDate, i);
    const d1 = addDays(startDate, i + 1);
    return {
      name,
      leadId: STAGE_LEAD[name],
      machine: STAGE_MACHINE[name][i % STAGE_MACHINE[name].length],
      qtyPlan: qty,
      qtyDone: isDone ? qty : (isWip ? wipQty : 0),
      hours: isDone ? 6 + (i % 3) * 2 : (isWip ? 3 : 0),
      status: isDone ? 'done' : (isWip ? 'doing' : 'pending'),
      start: isDone || isWip ? d0 : '',
      end: isDone ? d1 : '',
      note: '',
    };
  });
}

DB.productionOrders = PO_ROWS.map(([id, orderId, productId, qty, startDate, deadline, managerId, status, doneCount, wipQty]) => {
  const p = PRODUCTS.find((x) => x.id === productId);
  const order = DB.orders.find((o) => o.id === orderId);
  return {
    id, orderId, productId, productName: p.name, spec: p.spec, unit: p.unit,
    customerId: order ? order.customerId : '',
    qty, startDate, deadline, managerId, status,
    stages: buildStages(qty, doneCount, wipQty, startDate),
    qcPass: status === 'lsx_hoan_thanh' ? qty : 0,
    qcFail: 0,
    note: '',
  };
});

/** Tiến độ = tổng số lượng đã qua các công đoạn / (số lượng × số công đoạn) */
function poProgress(po) {
  const total = po.qty * po.stages.length;
  const done = po.stages.reduce((s, st) => s + st.qtyDone, 0);
  return total ? Math.round((done / total) * 100) : 0;
}

/* ---- Yêu cầu mua hàng ---- */
DB.purchases = PR_ROWS.map(([id, requesterId, supplierId, date, status, rows, reason]) => {
  const items = rows.map(([vt, qty, price]) => {
    const m = DB.materials.find((x) => x.id === vt);
    return { materialId: vt, name: m ? m.name : vt, unit: m ? m.unit : '', qty, price, amount: qty * price, requiredDate: addDays(date, 7) };
  });
  return {
    id, requesterId, dept: 'Sản xuất', supplierId, date, status, items, reason,
    total: items.reduce((s, it) => s + it.amount, 0),
    expectedDate: addDays(date, 10),
    receivedDate: ['mh_da_nhan', 'mh_hoan_thanh'].includes(status) ? addDays(date, 8) : '',
    approvedBy: ['mh_cho_duyet', 'mh_tu_choi'].includes(status) ? '' : 'NV-001',
    note: '',
  };
});

/* ---- Đơn đặt hàng (Purchase Order - PO) ---- */
DB.purchaseOrders = [
  {
    id: 'PO-2026-0038', prId: 'YCM-2026-0041', supplierId: 'NCC-10', date: '2026-08-11', expectedDate: '2026-08-20',
    status: 'SHIPPING', paymentTerm: 'Thanh toán 100% trong 30 ngày sau khi nhận đủ hàng',
    note: 'Giao chai PET và ly nhựa về kho nguyên vật liệu', createdBy: 'NV-020',
    items: [{ materialId: 'VT-011', name: 'Chai PET 500ml + nắp vặn', unit: 'Cái', qty: 5000, price: 3200, amount: 16000000, receivedQty: 0 }, { materialId: 'VT-010', name: 'Ly nhựa dùng 1 lần 250ml + nắp', unit: 'Bộ', qty: 3000, price: 1200, amount: 3600000, receivedQty: 0 }],
    subtotal: 19600000, vatRate: 10, vat: 1960000, total: 21560000, paid: 0,
  },
  {
    id: 'PO-2026-0037', prId: 'YCM-2026-0039', supplierId: 'NCC-08', date: '2026-08-08', expectedDate: '2026-08-18',
    status: 'PARTIAL_RECEIVED', paymentTerm: 'Tạm ứng 30%, 70% sau khi nghiệm thu',
    note: 'Hóa chất vệ sinh và cồn khử trùng theo quy trình ATTP', createdBy: 'NV-021',
    items: [
      { materialId: 'VT-016', name: 'Chất tẩy rửa thực phẩm (NaOH 3%)', unit: 'Kg', qty: 30, price: 145000, amount: 4350000, receivedQty: 18 },
      { materialId: 'VT-017', name: 'Cồn công nghiệp 70° khử trùng', unit: 'Lít', qty: 40, price: 52000, amount: 2080000, receivedQty: 40 },
    ],
    subtotal: 6430000, vatRate: 10, vat: 643000, total: 7073000, paid: 2000000,
  },
  {
    id: 'PO-2026-0036', prId: 'YCM-2026-0037', supplierId: 'NCC-06', date: '2026-08-02', expectedDate: '2026-08-10',
    status: 'RECEIVED', paymentTerm: 'Thanh toán 100% khi nhận hàng',
    note: 'Bổ sung chai PET và bao bì đóng gói', createdBy: 'NV-020',
    items: [
      { materialId: 'VT-011', name: 'Chai PET 500ml + nắp vặn', unit: 'Cái', qty: 10000, price: 3200, amount: 32000000, receivedQty: 10000 },
      { materialId: 'VT-013', name: 'Màng co nhiệt đóng gói', unit: 'Kg', qty: 120, price: 48000, amount: 5760000, receivedQty: 120 },
    ],
    subtotal: 37760000, vatRate: 10, vat: 3776000, total: 41536000, paid: 41536000,
  },
  {
    id: 'PO-2026-0035', prId: 'YCM-2026-0036', supplierId: 'NCC-01', date: '2026-07-30', expectedDate: '2026-08-07',
    status: 'RECEIVED', paymentTerm: 'Chuyển khoản theo hợp đồng khung',
    note: 'Nhập đậu nành nguyên hạt cho kế hoạch sản xuất mới', createdBy: 'NV-021',
    items: [{ materialId: 'VT-001', name: 'Đậu nành nguyên hạt (nhập khẩu Mỹ)', unit: 'Kg', qty: 5000, price: 22000, amount: 110000000, receivedQty: 5000 }],
    subtotal: 110000000, vatRate: 10, vat: 11000000, total: 121000000, paid: 121000000,
  },
];

/* ---- Báo giá nhà cung cấp (Supplier Quotations) ---- */
DB.supplierQuotations = [
  {
    id: 'BG-NCC-001',
    prId: 'YCM-2026-0046',
    supplierId: 'NCC-01',
    date: '2026-08-14',
    validUntil: '2026-08-30',
    leadTimeDays: 7,

    paymentTerm: '30% tạm ứng, 70% sau khi giao hàng',
    selected: true,

    note: 'Báo giá đậu nành nguyên hạt giao theo đợt',

    items: [
      {
        materialId: 'VT-001',
        name: 'Đậu nành nguyên hạt (nhập khẩu Mỹ)',
        unit: 'Kg',
        qty: 2000,
        price: 22000,
        amount: 44000000,
      },
    ],

    total: 44000000,
  },

  {
    id: 'BG-NCC-002',
    prId: 'YCM-2026-0046',
    supplierId: 'NCC-01',
    date: '2026-08-14',
    validUntil: '2026-08-28',
    leadTimeDays: 10,

    paymentTerm: 'Thanh toán 100% khi nhận hàng',
    selected: false,

    note: 'Báo giá đậu nành theo giá hợp tác xã',

    items: [
      {
        materialId: 'VT-001',
        name: 'Đậu nành nguyên hạt (nhập khẩu Mỹ)',
        unit: 'Kg',
        qty: 2000,
        price: 22500,
        amount: 45000000,
      },
    ],

    total: 45000000,
  },

  {
    id: 'BG-NCC-003',
    prId: 'YCM-2026-0045',
    supplierId: 'NCC-05',
    date: '2026-08-14',
    validUntil: '2026-08-31',
    leadTimeDays: 5,

    paymentTerm: 'Tạm ứng 50%',
    selected: true,

    note: 'Báo giá bao bì nhựa đạt chuẩn tiếp xúc thực phẩm',

    items: [
      {
        materialId: 'VT-008',
        name: 'Hộp nhựa PP 400g có nắp',
        unit: 'Cái',
        qty: 10000,
        price: 1800,
        amount: 18000000,
      },
      {
        materialId: 'VT-009',
        name: 'Túi PE thực phẩm 200g',
        unit: 'Túi',
        qty: 8000,
        price: 500,
        amount: 4000000,
      },
    ],

    total: 22000000,
  },

  {
    id: 'BG-NCC-004',
    prId: 'YCM-2026-0045',
    supplierId: 'NCC-06',
    date: '2026-08-14',
    validUntil: '2026-08-25',
    leadTimeDays: 8,

    paymentTerm: 'Thanh toán sau 30 ngày',
    selected: false,

    note: 'Báo giá bao bì và vật tư đóng gói',

    items: [
      {
        materialId: 'VT-008',
        name: 'Hộp nhựa PP 400g có nắp',
        unit: 'Cái',
        qty: 10000,
        price: 1900,
        amount: 19000000,
      },
      {
        materialId: 'VT-009',
        name: 'Túi PE thực phẩm 200g',
        unit: 'Túi',
        qty: 8000,
        price: 550,
        amount: 4400000,
      },
    ],

    total: 23400000,
  },
];

DB.supplierQuotations.unshift(
  {
    id: 'BG-NCC-005',
    prId: 'YCM-2026-0043',
    supplierId: 'NCC-03',
    date: '2026-08-15',
    validUntil: '2026-08-30',
    leadTimeDays: 4,

    paymentTerm: '30 ngày sau giao hàng',
    selected: true,

    note: 'Báo giá dầu đậu nành tinh luyện',

    items: [
      {
        materialId: 'VT-004',
        name: 'Dầu đậu nành tinh luyện',
        unit: 'Lít',
        qty: 200,
        price: 38000,
        amount: 7600000,
      },
    ],

    total: 7600000,
  },

  {
    id: 'BG-NCC-006',
    prId: 'YCM-2026-0042',
    supplierId: 'NCC-04',
    date: '2026-08-15',
    validUntil: '2026-08-29',
    leadTimeDays: 3,

    paymentTerm: 'Thanh toán COD',
    selected: true,

    note: 'Báo giá đường và muối ăn',

    items: [
      {
        materialId: 'VT-005',
        name: 'Đường cát trắng',
        unit: 'Kg',
        qty: 300,
        price: 22000,
        amount: 6600000,
      },
      {
        materialId: 'VT-007',
        name: 'Muối ăn tinh',
        unit: 'Kg',
        qty: 60,
        price: 8000,
        amount: 480000,
      },
    ],

    total: 7080000,
  }
);

/* Bổ sung báo giá theo đúng các PR đã duyệt của nguyên liệu đậu hủ. */
DB.supplierQuotations.unshift(
  { id: 'BG-NCC-005', prId: 'YCM-2026-0043', supplierId: 'NCC-03', date: '2026-08-15', validUntil: '2026-08-30', leadTimeDays: 4, paymentTerm: '30 ngày sau giao hàng', selected: true, note: 'Báo giá dầu đậu nành tinh luyện', items: [{ materialId: 'VT-004', name: 'Dầu đậu nành tinh luyện', unit: 'Lít', qty: 200, price: 38000, amount: 7600000 }], total: 7600000 },
  { id: 'BG-NCC-006', prId: 'YCM-2026-0042', supplierId: 'NCC-04', date: '2026-08-15', validUntil: '2026-08-29', leadTimeDays: 3, paymentTerm: 'Thanh toán COD', selected: true, note: 'Báo giá đường và muối ăn', items: [{ materialId: 'VT-005', name: 'Đường cát trắng', unit: 'Kg', qty: 300, price: 22000, amount: 6600000 }, { materialId: 'VT-007', name: 'Muối ăn tinh', unit: 'Kg', qty: 60, price: 8000, amount: 480000 }], total: 7080000 }
);

/* ---- Kho vật lý (địa điểm) -----------------------------------------------
 * `warehouseSites` là danh sách kho theo địa điểm thực tế: Thủ Đức, Bình Dương,
 * Đồng Nai... Đây là master hiển thị trong menu Quản lý kho.
 *
 * `warehouses` bên dưới được giữ nguyên làm các KHU NGHIỆP VỤ nội bộ để không
 * thay đổi logic nhập/xuất/QC hiện hữu. Mỗi khu trỏ về một kho vật lý bằng siteId.
 * ------------------------------------------------------------------------- */
DB.warehouseSites = [
  { id:'SITE-TD', code:'TD', name:'Kho Thủ Đức', address:'128 Lê Văn Việt, TP. Thủ Đức, TP.HCM', province:'Thành phố Hồ Chí Minh', district:'TP. Thủ Đức', ward:'', addressDetail:'128 Lê Văn Việt', managerId:'NV-018', status:'active', note:'Kho trung tâm Thủ Đức' },
  { id:'SITE-BD', code:'BD', name:'Kho Bình Dương', address:'KCN Sóng Thần, Dĩ An, Bình Dương', province:'Bình Dương', district:'Dĩ An', ward:'', addressDetail:'KCN Sóng Thần', managerId:'NV-018', status:'active', note:'Kho khu vực Bình Dương' },
  { id:'SITE-DN', code:'DN', name:'Kho Đồng Nai', address:'KCN Biên Hòa 2, Đồng Nai', province:'Đồng Nai', district:'Biên Hòa', ward:'', addressDetail:'KCN Biên Hòa 2', managerId:'NV-018', status:'active', note:'Kho khu vực Đồng Nai' },
];

/* ---- Khu nghiệp vụ bên trong từng kho vật lý -----------------------------
 * Giữ nguyên id/type để toàn bộ chứng từ và tồn kho cũ tiếp tục hoạt động.
 * UI Quản lý kho sẽ gọi các record này là KHU thay vì Kho.
 * ------------------------------------------------------------------------- */
DB.warehouses = [
  // KHO NGUYÊN LIỆU
  { id: 'WH-001', siteId: 'SITE-TD', code: 'RAW_TD', name: 'Kho Nguyên liệu - Thủ Đức', type: 'RAW_MATERIAL', address: '128 Lê Văn Việt, TP. Thủ Đức, TP.HCM', managerId: 'NV-018', status: 'active', note: 'Kho nguyên liệu trung tâm phục vụ nhà máy Thủ Đức' },
  { id: 'WH-008', siteId: 'SITE-BD', code: 'RAW_BD', name: 'Kho Nguyên liệu - Bình Dương', type: 'RAW_MATERIAL', address: 'KCN Sóng Thần, Dĩ An, Bình Dương', managerId: 'NV-018', status: 'active', note: 'Kho vệ tinh nguyên liệu phục vụ sản xuất Bình Dương' },
  { id: 'WH-009', siteId: 'SITE-DN', code: 'RAW_DN', name: 'Kho Nguyên liệu - Đồng Nai', type: 'RAW_MATERIAL', address: 'KCN Biên Hòa 2, Đồng Nai', managerId: 'NV-018', status: 'active', note: 'Kho dự trữ nguyên liệu khu vực Đồng Nai' },

  // KHO BÁN THÀNH PHẨM
  { id: 'WH-003', siteId: 'SITE-TD', code: 'SEMI_TD', name: 'Kho Bán thành phẩm - Thủ Đức', type: 'SEMI_FINISHED', address: 'Xưởng sản xuất Thủ Đức, TP.HCM', managerId: 'NV-007', status: 'active', note: 'BTP sau đông tụ/ép khuôn chờ công đoạn tiếp theo' },
  { id: 'WH-011', siteId: 'SITE-BD', code: 'SEMI_BD', name: 'Kho Bán thành phẩm - Bình Dương', type: 'SEMI_FINISHED', address: 'Xưởng Bình Dương, Dĩ An, Bình Dương', managerId: 'NV-007', status: 'active', note: 'BTP điều phối giữa các dây chuyền Bình Dương' },
  { id: 'WH-014', siteId: 'SITE-DN', code: 'SEMI_DN', name: 'Kho Bán thành phẩm - Đồng Nai', type: 'SEMI_FINISHED', address: 'KCN Biên Hòa 2, Đồng Nai', managerId: 'NV-007', status: 'active', note: 'Kho BTP dự phòng cho điểm sản xuất Đồng Nai' },

  // KHO THÀNH PHẨM
  { id: 'WH-004', siteId: 'SITE-TD', code: 'FIN_TD', name: 'Kho Thành phẩm - Thủ Đức', type: 'FINISHED_GOODS', address: '128 Lê Văn Việt, TP. Thủ Đức, TP.HCM', managerId: 'NV-018', status: 'active', note: 'Kho thành phẩm trung tâm, bảo quản theo điều kiện sản phẩm' },
  { id: 'WH-012', siteId: 'SITE-BD', code: 'FIN_BD', name: 'Kho Thành phẩm - Bình Dương', type: 'FINISHED_GOODS', address: 'KCN Sóng Thần, Dĩ An, Bình Dương', managerId: 'NV-018', status: 'active', note: 'Kho thành phẩm khu vực Bình Dương' },
  { id: 'WH-013', siteId: 'SITE-DN', code: 'FIN_DN', name: 'Kho Thành phẩm - Đồng Nai', type: 'FINISHED_GOODS', address: 'KCN Biên Hòa 2, Đồng Nai', managerId: 'NV-018', status: 'active', note: 'Kho thành phẩm khu vực Đồng Nai' },

  // KHO PHỤ TRỢ - giữ nguyên cho các nghiệp vụ hiện có
  { id: 'WH-002', siteId: 'SITE-TD', code: 'PRODUCTION', name: 'Kho Phân xưởng sản xuất', type: 'PRODUCTION', address: 'Khu A - Phân xưởng sản xuất', managerId: 'NV-005', status: 'active', note: 'Kho đệm trung chuyển tại khu sản xuất' },
  { id: 'WH-005', siteId: 'SITE-TD', code: 'STORE_LVV', name: 'Kho Cửa hàng Lê Văn Việt', type: 'STORE', address: '128 Lê Văn Việt, TP. Thủ Đức, TP.HCM', managerId: 'NV-004', status: 'active', note: 'Kho riêng của Cửa hàng Lê Văn Việt' },
  { id: 'WH-015', siteId: 'SITE-TD', code: 'STORE_BD_TD', name: 'Kho Quầy Bún Đậu Thủ Đức', type: 'STORE', address: 'TP. Thủ Đức, TP.HCM', managerId: 'NV-004', status: 'active', note: 'Kho riêng của Quầy Bún Đậu Thủ Đức' },
  { id: 'WH-006', siteId: 'SITE-TD', code: 'DEFECTIVE', name: 'Kho Hàng lỗi / Tiêu hủy', type: 'DEFECTIVE', address: 'Khu xử lý phế phẩm', managerId: 'NV-015', status: 'active', note: 'Chứa hàng lỗi chờ xử lý' },
  { id: 'WH-007', siteId: 'SITE-TD', code: 'RETURNED', name: 'Kho Hàng trả về', type: 'RETURNED', address: 'Khu tiếp nhận trả hàng', managerId: 'NV-019', status: 'active', note: 'Tiếp nhận hàng trả từ khách hàng' }
];

/* ---- Vị trí/kệ trong từng kho ------------------------------------------- */
DB.warehouseLocations = [
  // Nguyên liệu - Thủ Đức
  { id: 'LOC-001', warehouseId: 'WH-001', code: 'TD-RAW-A1', name: 'Kệ A1 - Hàng khô', parentLocation: '', locationType: 'SHELF', capacity: 10000, currentUsage: 2500, status: 'active' },
  { id: 'LOC-002', warehouseId: 'WH-001', code: 'TD-RAW-A2', name: 'Kệ A2 - Phụ gia', parentLocation: '', locationType: 'SHELF', capacity: 4000, currentUsage: 780, status: 'active' },
  { id: 'LOC-003', warehouseId: 'WH-001', code: 'TD-RAW-M1', name: 'Kệ M1 - Nguyên liệu mát', parentLocation: '', locationType: 'SHELF', capacity: 2500, currentUsage: 420, status: 'active' },
  { id: 'LOC-004', warehouseId: 'WH-001', code: 'TD-RAW-B1', name: 'Kệ B1 - Bao bì', parentLocation: '', locationType: 'SHELF', capacity: 8000, currentUsage: 1700, status: 'active' },
  // Nguyên liệu - Bình Dương
  { id: 'LOC-013', warehouseId: 'WH-008', code: 'BD-RAW-A1', name: 'Kệ A1 - Nguyên liệu chính', parentLocation: '', locationType: 'SHELF', capacity: 8000, currentUsage: 1800, status: 'active' },
  { id: 'LOC-014', warehouseId: 'WH-008', code: 'BD-RAW-A2', name: 'Kệ A2 - Phụ gia', parentLocation: '', locationType: 'SHELF', capacity: 5000, currentUsage: 900, status: 'active' },
  // Nguyên liệu - Đồng Nai
  { id: 'LOC-015', warehouseId: 'WH-009', code: 'DN-RAW-A1', name: 'Kệ A1 - Nguyên liệu chính', parentLocation: '', locationType: 'SHELF', capacity: 7000, currentUsage: 1200, status: 'active' },
  { id: 'LOC-016', warehouseId: 'WH-009', code: 'DN-RAW-M1', name: 'Kệ M1 - Nguyên liệu mát', parentLocation: '', locationType: 'SHELF', capacity: 2200, currentUsage: 350, status: 'active' },

  // Bán thành phẩm
  { id: 'LOC-011', warehouseId: 'WH-003', code: 'TD-SEMI-S1', name: 'Kệ S1 - BTP chờ ép', parentLocation: '', locationType: 'SHELF', capacity: 3000, currentUsage: 780, status: 'active' },
  { id: 'LOC-012', warehouseId: 'WH-003', code: 'TD-SEMI-S2', name: 'Kệ S2 - BTP chờ đóng gói', parentLocation: '', locationType: 'SHELF', capacity: 3000, currentUsage: 520, status: 'active' },
  { id: 'LOC-017', warehouseId: 'WH-011', code: 'BD-SEMI-S1', name: 'Kệ S1 - BTP điều phối', parentLocation: '', locationType: 'SHELF', capacity: 2800, currentUsage: 620, status: 'active' },
  { id: 'LOC-018', warehouseId: 'WH-011', code: 'BD-SEMI-S2', name: 'Kệ S2 - BTP chờ hoàn thiện', parentLocation: '', locationType: 'SHELF', capacity: 2800, currentUsage: 350, status: 'active' },
  { id: 'LOC-022', warehouseId: 'WH-014', code: 'DN-SEMI-S1', name: 'Kệ S1 - BTP dự phòng', parentLocation: '', locationType: 'SHELF', capacity: 2500, currentUsage: 240, status: 'active' },

  // Thành phẩm
  { id: 'LOC-007', warehouseId: 'WH-004', code: 'TD-FIN-T1', name: 'Kệ T1 - Thành phẩm mát', parentLocation: '', locationType: 'SHELF', capacity: 5000, currentUsage: 1500, status: 'active' },
  { id: 'LOC-008', warehouseId: 'WH-004', code: 'TD-FIN-T2', name: 'Kệ T2 - Thành phẩm chờ giao', parentLocation: '', locationType: 'SHELF', capacity: 5000, currentUsage: 900, status: 'active' },
  { id: 'LOC-019', warehouseId: 'WH-012', code: 'BD-FIN-T1', name: 'Kệ T1 - Thành phẩm mát', parentLocation: '', locationType: 'SHELF', capacity: 4500, currentUsage: 1350, status: 'active' },
  { id: 'LOC-020', warehouseId: 'WH-012', code: 'BD-FIN-T2', name: 'Kệ T2 - Thành phẩm phân phối', parentLocation: '', locationType: 'SHELF', capacity: 4500, currentUsage: 920, status: 'active' },
  { id: 'LOC-021', warehouseId: 'WH-013', code: 'DN-FIN-T1', name: 'Kệ T1 - Thành phẩm', parentLocation: '', locationType: 'SHELF', capacity: 4000, currentUsage: 480, status: 'active' },

  // Kho phụ trợ
  { id: 'LOC-009', warehouseId: 'WH-005', code: 'LVV-M1', name: 'Kệ/Tủ M1 - Cửa hàng Lê Văn Việt', parentLocation: '', locationType: 'SHELF', capacity: 1000, currentUsage: 350, status: 'active' },
  { id: 'LOC-024', warehouseId: 'WH-015', code: 'BDTD-M1', name: 'Kệ/Tủ M1 - Quầy Bún Đậu Thủ Đức', parentLocation: '', locationType: 'SHELF', capacity: 1000, currentUsage: 0, status: 'active' },
  { id: 'LOC-010', warehouseId: 'WH-006', code: 'DEF-D1', name: 'Kệ D1 - Chờ xử lý', parentLocation: '', locationType: 'SHELF', capacity: 1000, currentUsage: 50, status: 'active' },
  { id: 'LOC-023', warehouseId: 'WH-007', code: 'RET-R1', name: 'Kệ R1 - Hàng khách trả', parentLocation: '', locationType: 'SHELF', capacity: 2000, currentUsage: 0, status: 'active' }
];

/* ---- Danh mục Lô sản phẩm / nguyên liệu ---- */
DB.inventoryLots = [
  // Nguyên liệu
  { id: 'LOT-VT001-001', lotNumber: 'LOT-DN-260801', productId: 'VT-001', productionOrderId: '', mfgDate: '2026-08-01', expiryDate: '2027-08-01', supplierLot: 'US-SOY-9988', supplierId: 'NCC-01', qcStatus: 'PASSED', status: 'active', createdAt: '2026-08-01 09:00' },
  { id: 'LOT-VT001-002', lotNumber: 'LOT-DN-260810', productId: 'VT-001', productionOrderId: '', mfgDate: '2026-08-10', expiryDate: '2027-08-10', supplierLot: 'US-SOY-0021', supplierId: 'NCC-01', qcStatus: 'PASSED', status: 'active', createdAt: '2026-08-10 14:00' },
  { id: 'LOT-VT002-001', lotNumber: 'LOT-TC-260720', productId: 'VT-002', productionOrderId: '', mfgDate: '2026-07-20', expiryDate: '2028-07-20', supplierLot: 'MD-CASO4-332', supplierId: 'NCC-02', qcStatus: 'PASSED', status: 'active', createdAt: '2026-07-20 10:30' },
  { id: 'LOT-VT003-001', lotNumber: 'LOT-NG-260725', productId: 'VT-003', productionOrderId: '', mfgDate: '2026-07-25', expiryDate: '2028-07-25', supplierLot: 'MD-NIGARI-441', supplierId: 'NCC-02', qcStatus: 'PASSED', status: 'active', createdAt: '2026-07-25 11:00' },
  { id: 'LOT-VT004-001', lotNumber: 'LOT-DA-260805', productId: 'VT-004', productionOrderId: '', mfgDate: '2026-08-05', expiryDate: '2027-02-05', supplierLot: 'CL-OIL-7711', supplierId: 'NCC-03', qcStatus: 'PASSED', status: 'active', createdAt: '2026-08-05 08:30' },
  
  // Thành phẩm
  { id: 'LOT-SP001-001', lotNumber: 'LOT-DHN-260827', productId: 'SP-001', productionOrderId: 'LSX-2026-0048', mfgDate: '2026-08-27', expiryDate: '2026-08-30', supplierLot: '', supplierId: '', qcStatus: 'PASSED', status: 'active', createdAt: '2026-08-27 16:00' }, // Cận hạn
  { id: 'LOT-SP001-002', lotNumber: 'LOT-DHN-260820', productId: 'SP-001', productionOrderId: 'LSX-2026-0040', mfgDate: '2026-08-20', expiryDate: '2026-08-23', supplierLot: '', supplierId: '', qcStatus: 'PASSED', status: 'active', createdAt: '2026-08-20 16:00' }, // Đã hết hạn
  { id: 'LOT-SP002-001', lotNumber: 'LOT-DHC-260826', productId: 'SP-002', productionOrderId: 'LSX-2026-0044', mfgDate: '2026-08-26', expiryDate: '2026-08-31', supplierLot: '', supplierId: '', qcStatus: 'PASSED', status: 'active', createdAt: '2026-08-26 15:30' },
  { id: 'LOT-SP003-001', lotNumber: 'LOT-DHC-260825', productId: 'SP-003', productionOrderId: 'LSX-2026-0043', mfgDate: '2026-08-25', expiryDate: '2026-09-01', supplierLot: '', supplierId: '', qcStatus: 'PASSED', status: 'active', createdAt: '2026-08-25 14:00' },
  { id: 'LOT-SP006-001', lotNumber: 'LOT-SDA-260827', productId: 'SP-006', productionOrderId: 'LSX-2026-0037', mfgDate: '2026-08-27', expiryDate: '2026-08-30', supplierLot: '', supplierId: '', qcStatus: 'PASSED', status: 'active', createdAt: '2026-08-27 16:30' },
  { id: 'LOT-VT005-001', lotNumber: 'PO0039-VT005-260828-01', productId: 'VT-005', productionOrderId: '', mfgDate: '2026-08-20', expiryDate: '2027-08-20', supplierLot: 'SUGAR-0820-A', supplierId: 'NCC-04', qcStatus: 'PASSED', status: 'active', createdAt: '2026-08-28 09:10' },
  { id: 'LOT-VT007-001', lotNumber: 'PO0039-VT007-260828-01', productId: 'VT-007', productionOrderId: '', mfgDate: '2026-08-18', expiryDate: '2028-08-18', supplierLot: 'SALT-0818-B', supplierId: 'NCC-04', qcStatus: 'PASSED', status: 'active', createdAt: '2026-08-28 09:15' },
  { id: 'LOT-SP001-003', lotNumber: 'LOT-DHN-260905', productId: 'SP-001', productionOrderId: 'LSX-2026-0051', mfgDate: '2026-09-05', expiryDate: '2026-09-10', supplierLot: '', supplierId: '', qcStatus: 'PASSED', status: 'active', createdAt: '2026-09-05 16:00' }
];

/* ---- Tồn kho chi tiết ---- */
DB.inventory = [
  // Đậu nành Mỹ
  { productId: 'VT-001', warehouseId: 'WH-001', locationId: 'LOC-001', lotId: 'LOT-VT001-001', qtyOnHand: 2000, qtyReserved: 500, qtyAvailable: 1500, unit: 'Kg', lastUpdated: '2026-08-14 10:00' },
  { productId: 'VT-001', warehouseId: 'WH-001', locationId: 'LOC-001', lotId: 'LOT-VT001-002', qtyOnHand: 500, qtyReserved: 0, qtyAvailable: 500, unit: 'Kg', lastUpdated: '2026-08-14 10:00' },
  
  // Chất đông tụ
  { productId: 'VT-002', warehouseId: 'WH-001', locationId: 'LOC-002', lotId: 'LOT-VT002-001', qtyOnHand: 500, qtyReserved: 0, qtyAvailable: 500, unit: 'Kg', lastUpdated: '2026-08-14 10:00' },
  { productId: 'VT-003', warehouseId: 'WH-001', locationId: 'LOC-003', lotId: 'LOT-VT003-001', qtyOnHand: 500, qtyReserved: 0, qtyAvailable: 500, unit: 'Kg', lastUpdated: '2026-08-14 10:00' },
  
  // Dầu ăn
  { productId: 'VT-004', warehouseId: 'WH-001', locationId: 'LOC-004', lotId: 'LOT-VT004-001', qtyOnHand: 500, qtyReserved: 0, qtyAvailable: 500, unit: 'Lít', lastUpdated: '2026-08-14 10:00' },
  { productId: 'VT-005', warehouseId: 'WH-008', locationId: 'LOC-013', lotId: 'LOT-VT005-001', qtyOnHand: 760, qtyReserved: 100, qtyAvailable: 660, unit: 'Kg', lastUpdated: '2026-08-28 09:10' },
  { productId: 'VT-007', warehouseId: 'WH-008', locationId: 'LOC-014', lotId: 'LOT-VT007-001', qtyOnHand: 500, qtyReserved: 0, qtyAvailable: 500, unit: 'Kg', lastUpdated: '2026-08-28 09:15' },
  
  // Thành phẩm đậu hủ non
  { productId: 'SP-001', warehouseId: 'WH-004', locationId: 'LOC-007', lotId: 'LOT-SP001-001', qtyOnHand: 500, qtyReserved: 100, qtyAvailable: 400, unit: 'Hộp', lastUpdated: '2026-08-27 16:00' },
  { productId: 'SP-001', warehouseId: 'WH-012', locationId: 'LOC-019', lotId: 'LOT-SP001-003', qtyOnHand: 650, qtyReserved: 120, qtyAvailable: 530, unit: 'Hộp', lastUpdated: '2026-09-05 16:00' },
  { productId: 'SP-001', warehouseId: 'WH-004', locationId: 'LOC-007', lotId: 'LOT-SP001-002', qtyOnHand: 200, qtyReserved: 0, qtyAvailable: 200, unit: 'Hộp', lastUpdated: '2026-08-20 16:00' },
  
  // Thành phẩm đậu hủ cứng & chiên
  { productId: 'SP-002', warehouseId: 'WH-004', locationId: 'LOC-008', lotId: 'LOT-SP002-001', qtyOnHand: 300, qtyReserved: 50, qtyAvailable: 250, unit: 'Khối', lastUpdated: '2026-08-26 15:30' },
  { productId: 'SP-003', warehouseId: 'WH-004', locationId: 'LOC-008', lotId: 'LOT-SP003-001', qtyOnHand: 400, qtyReserved: 120, qtyAvailable: 280, unit: 'Gói', lastUpdated: '2026-08-25 14:00' },
  
  // Sữa đậu nành cửa hàng
  { productId: 'SP-006', warehouseId: 'WH-005', locationId: 'LOC-009', lotId: 'LOT-SP006-001', qtyOnHand: 150, qtyReserved: 0, qtyAvailable: 150, unit: 'Chai', lastUpdated: '2026-08-27 16:30' }
];


/* Tồn test cố định để kiểm thử sản xuất. Đây chỉ là dữ liệu seed của source,
 * KHÔNG có cơ chế tự bù lại sau refresh / sau khi xuất kho. */
[
  ['VT-006','Kg'],['VT-008','Cái'],['VT-009','Túi'],['VT-010','Bộ'],['VT-011','Cái'],['VT-012','Tờ'],
  ['VT-013','Kg'],['VT-014','Cái'],['VT-015','Lít'],['VT-016','Kg'],['VT-017','Lít'],['VT-018','Kg'],['VT-019','Kg'],['VT-020','Kg']
].forEach(([productId,unit],idx)=>{
  const lotId=`LOT-SEED-${productId}`;
  DB.inventoryLots.push({ id:lotId, lotNumber:`TEST-${productId}-500`, productId, productionOrderId:'', mfgDate:'2026-09-14', expiryDate:'2027-12-31', supplierLot:'TEST-STOCK', supplierId:(DB.materials.find(m=>m.id===productId)||{}).supplier||'', qcStatus:'PASSED', status:'active', createdAt:'2026-09-14 08:00' });
  DB.inventory.push({ productId, warehouseId:'WH-001', locationId:'LOC-001', lotId, qtyOnHand:500, qtyReserved:0, qtyAvailable:500, unit, lastUpdated:'2026-09-14 08:00' });
});

/* Tồn mẫu phân bổ tại nhiều kho vật lý để kiểm thử chuyển kho nội bộ. */
DB.inventory.push(
  // Nguyên liệu: cùng một lô có thể nằm ở nhiều kho vật lý
  { productId: 'VT-001', warehouseId: 'WH-008', locationId: 'LOC-013', lotId: 'LOT-VT001-002', qtyOnHand: 320, qtyReserved: 20, qtyAvailable: 300, unit: 'Kg', lastUpdated: '2026-09-06 08:20' },
  { productId: 'VT-001', warehouseId: 'WH-009', locationId: 'LOC-015', lotId: 'LOT-VT001-002', qtyOnHand: 180, qtyReserved: 0, qtyAvailable: 180, unit: 'Kg', lastUpdated: '2026-09-06 09:10' },
  { productId: 'VT-005', warehouseId: 'WH-009', locationId: 'LOC-015', lotId: 'LOT-VT005-001', qtyOnHand: 240, qtyReserved: 0, qtyAvailable: 240, unit: 'Kg', lastUpdated: '2026-09-06 09:15' },

  // Bán thành phẩm: dùng các mã SP hiện có làm hàng đang ở công đoạn trung gian để demo điều phối kho
  { productId: 'SP-001', warehouseId: 'WH-003', locationId: 'LOC-011', lotId: 'LOT-SP001-003', qtyOnHand: 180, qtyReserved: 20, qtyAvailable: 160, unit: 'Hộp', lastUpdated: '2026-09-06 13:20' },
  { productId: 'SP-001', warehouseId: 'WH-011', locationId: 'LOC-017', lotId: 'LOT-SP001-003', qtyOnHand: 120, qtyReserved: 0, qtyAvailable: 120, unit: 'Hộp', lastUpdated: '2026-09-06 14:00' },
  { productId: 'SP-002', warehouseId: 'WH-014', locationId: 'LOC-022', lotId: 'LOT-SP002-001', qtyOnHand: 90, qtyReserved: 0, qtyAvailable: 90, unit: 'Khối', lastUpdated: '2026-09-06 14:30' },

  // Thành phẩm
  { productId: 'SP-001', warehouseId: 'WH-013', locationId: 'LOC-021', lotId: 'LOT-SP001-003', qtyOnHand: 210, qtyReserved: 10, qtyAvailable: 200, unit: 'Hộp', lastUpdated: '2026-09-07 07:45' },
  { productId: 'SP-002', warehouseId: 'WH-012', locationId: 'LOC-020', lotId: 'LOT-SP002-001', qtyOnHand: 160, qtyReserved: 20, qtyAvailable: 140, unit: 'Khối', lastUpdated: '2026-09-07 08:00' }
);

DB.subcontractingOrders = [
  { id: 'GC-2026-001', partner: 'Cơ sở Đậu Hủ Tân Phúc', productId: 'SP-002', plannedQty: 500, issuedQty: 300, receivedQty: 0, goodQty: 0, defectQty: 0, issueDate: '2026-08-20', dueDate: '2026-08-30', status: 'IN_PROGRESS', unitCost: 2500, paid: 0 },
  { id: 'GC-2026-002', partner: 'Xưởng Đóng Gói An Bình', productId: 'SP-003', plannedQty: 2000, issuedQty: 2000, receivedQty: 1980, goodQty: 1970, defectQty: 10, issueDate: '2026-08-18', dueDate: '2026-08-25', status: 'COMPLETED', unitCost: 800, paid: 1200000 },
];

/* ---- Nhập kho hàng mua (Goods Receipts) ---- */
DB.goodsReceipts = [
  {
    id: 'PN-2026-0142', poId: 'PO-2026-0036', prId: 'YCM-2026-0037', date: '2026-08-14', receivedBy: 'NV-018', warehouse: 'Kho Nguyên vật liệu chính', status: 'RECEIVED', note: 'Nhập đậu nành Đồng Tháp theo PO-2026-0036',
    items: [
      { materialId: 'VT-001', name: 'Đậu nành nguyên hạt (nhập khẩu Mỹ)', unit: 'Kg', qty: 4000, price: 22000, amount: 88000000, lotNumber: 'LOT-DN-260810', mfgDate: '2026-08-10', expiryDate: '2027-08-10', locationId: 'LOC-001' }
    ]
  },
  {
    id: 'PN-2026-0143', poId: 'PO-2026-0037', prId: 'YCM-2026-0039', date: '2026-08-12', receivedBy: 'NV-019', warehouse: 'Kho Nguyên vật liệu chính', status: 'PARTIAL_RECEIVED', note: 'Nhập thạch cao Minh Đức đợt 1',
    items: [
      { materialId: 'VT-002', name: 'Thạch cao thực phẩm (CaSO4)', unit: 'Kg', qty: 100, price: 85000, amount: 8500000, lotNumber: 'LOT-TC-260720', mfgDate: '2026-07-20', expiryDate: '2028-07-20', locationId: 'LOC-002' }
    ]
  }
];

/* ---- Phiếu xuất kho (Goods Issues) ---- */
DB.goodsIssues = [
  {
    id: 'PX-2026-0318', type: 'PRODUCTION_ISSUE', warehouseId: 'WH-001', refDoc: 'LSX-2026-0048', date: '2026-08-15', status: 'COMPLETED', createdBy: 'NV-018', note: 'Xuất đậu nành cho mẻ ngâm xay LSX-0048',
    items: [
      { productId: 'VT-001', lotId: 'LOT-VT001-001', qty: 150, locationId: 'LOC-001', unit: 'Kg' }
    ]
  },
  {
    id: 'PX-2026-0319', type: 'SALES_ISSUE', warehouseId: 'WH-004', refDoc: 'DH-2026-0086', date: '2026-08-14', status: 'COMPLETED', createdBy: 'NV-018', note: 'Xuất bán đậu hủ non cho WinMart',
    items: [
      { productId: 'SP-001', lotId: 'LOT-SP001-001', qty: 200, locationId: 'LOC-007', unit: 'Hộp' }
    ]
  }
];

/* ---- Kiểm tra đầu vào theo từng đợt nhập & yêu cầu trả nguyên liệu ---- */
DB.materialInspections = [];
DB.materialReturnRequests = [];
DB.materialReturnHistory = [];

/* ---- Phiếu chuyển kho nội bộ: dữ liệu mẫu theo 3 nhóm kho ---- */
DB.stockTransfers = [
  {
    id: 'CK-2026-0001', transferType: 'RAW_MATERIAL', fromWarehouseId: 'WH-001', toWarehouseId: 'WH-008', date: '2026-09-05', status: 'RECEIVED', note: 'Điều phối đậu nành từ Thủ Đức sang Bình Dương',
    items: [{ productId: 'VT-001', lotId: 'LOT-VT001-002', qty: 120, fromLocationId: 'LOC-001', toLocationId: 'LOC-013', unit: 'Kg' }]
  },
  {
    id: 'CK-2026-0002', transferType: 'SEMI_FINISHED', fromWarehouseId: 'WH-003', toWarehouseId: 'WH-011', date: '2026-09-06', status: 'RECEIVED', note: 'Điều phối bán thành phẩm sang điểm hoàn thiện Bình Dương',
    items: [{ productId: 'SP-001', lotId: 'LOT-SP001-003', qty: 80, fromLocationId: 'LOC-011', toLocationId: 'LOC-017', unit: 'Hộp' }]
  },
  {
    id: 'CK-2026-0003', transferType: 'FINISHED_GOODS', fromWarehouseId: 'WH-004', toWarehouseId: 'WH-012', date: '2026-09-07', status: 'RECEIVED', note: 'Điều phối thành phẩm từ Thủ Đức sang Bình Dương',
    items: [{ productId: 'SP-001', lotId: 'LOT-SP001-003', qty: 100, fromLocationId: 'LOC-007', toLocationId: 'LOC-019', unit: 'Hộp' }]
  }
];

/* ---- Phiếu kiểm kê kho ---- */
DB.inventoryCounts = [
  {
    id: 'KK-2026-0001', warehouseId: 'WH-004', date: '2026-08-14', status: 'COMPLETED', note: 'Kiểm kê định kỳ giữa tháng 8 kho lạnh thành phẩm',
    items: [
      { productId: 'SP-001', lotId: 'LOT-SP001-001', locationId: 'LOC-007', systemQty: 505, actualQty: 500, difference: -5, reason: 'Mất mát do hỏng khi đóng gói' }
    ]
  }
];

/* ---- Cấu hình Cảnh báo kho ---- */
DB.inventoryAlertConfig = {
  nearExpiryDays: 3,
  slowMovingDays: 30
};

/* ---- Nhật ký sổ chi tiết giao dịch kho (Ledger) ---- */
DB.inventoryTransactions = [
  { id: 'TX-001', transactionNumber: 'PN-2026-0142', type: 'RECEIPT', productId: 'VT-001', warehouseId: 'WH-001', locationId: 'LOC-001', lotId: 'LOT-VT001-002', qty: 4000, qtyBefore: 0, qtyAfter: 4000, refType: 'PO', refId: 'PO-2026-0036', userId: 'NV-018', date: '2026-08-14', note: 'Nhập đậu nành mua hàng' },
  { id: 'TX-002', transactionNumber: 'PX-2026-0318', type: 'PRODUCTION_ISSUE', productId: 'VT-001', warehouseId: 'WH-001', locationId: 'LOC-001', lotId: 'LOT-VT001-001', qty: -150, qtyBefore: 2150, qtyAfter: 2000, refType: 'LSX', refId: 'LSX-2026-0048', userId: 'NV-018', date: '2026-08-15', note: 'Xuất ngâm nấu' },
  { id: 'TX-003', transactionNumber: 'CK-2026-0001', type: 'TRANSFER_IN', productId: 'SP-006', warehouseId: 'WH-005', locationId: 'LOC-009', lotId: 'LOT-SP006-001', qty: 50, qtyBefore: 100, qtyAfter: 150, refType: 'CK', refId: 'CK-2026-0001', userId: 'NV-018', date: '2026-08-14', note: 'Nhận chuyển kho ra cửa hàng' }
];

/* ---- Nhật ký kiểm toán thao tác kho (Audit Logs) ---- */
DB.inventoryAuditLogs = [
  { user: 'Hà Minh Tú', action: 'Tạo phiếu nhập kho', documentType: 'RECEIPT', documentId: 'PN-2026-0142', time: '2026-08-14 10:15' },
  { user: 'Cao Văn Thắng', action: 'Xác nhận xuất kho sản xuất', documentType: 'ISSUE', documentId: 'PX-2026-0318', time: '2026-08-15 08:30' }
];

/* ---- Thanh toán & Công nợ NCC ---- */
DB.supplierPayments = [
  { id: 'TT-2026-0089', poId: 'PO-2026-0036', supplierId: 'NCC-06', date: '2026-08-14', amount: 41536000, method: 'Chuyển khoản', bankRef: 'FT2608149812', note: 'Thanh toán dứt điểm PO-0036 bao bì', createdBy: 'NV-022' },
  { id: 'TT-2026-0088', poId: 'PO-2026-0037', supplierId: 'NCC-08', date: '2026-08-09', amount: 2000000, method: 'Chuyển khoản', bankRef: 'FT2608091122', note: 'Tạm ứng PO-0037 hóa chất vệ sinh', createdBy: 'NV-023' },
  { id: 'TT-2026-0087', poId: 'PO-2026-0035', supplierId: 'NCC-01', date: '2026-08-05', amount: 121000000, method: 'Chuyển khoản', bankRef: 'FT2608053421', note: 'Tất toán PO-0035 đậu nành', createdBy: 'NV-022' },
];

/* ---- Hoàn tiền từ Nhà cung cấp do trả hàng / trả dư ---- */
DB.supplierRefunds = DB.supplierRefunds || [];


/* ---- Lịch sử giá mua nguyên vật liệu ---- */
DB.purchasePriceHistory = [
  {
    id: 'PPH-001',
    materialId: 'VT-001',
    supplierId: 'NCC-01',
    poId: 'PO-2026-0035',
    date: '2026-07-30',
    qty: 5000,
    price: 22000,
    amount: 110000000,
  },

  {
    id: 'PPH-002',
    materialId: 'VT-001',
    supplierId: 'NCC-01',
    poId: 'PO-2026-0012',
    date: '2026-05-15',
    qty: 4000,
    price: 21500,
    amount: 86000000,
  },

  {
    id: 'PPH-003',
    materialId: 'VT-009',
    supplierId: 'NCC-05',
    poId: 'PO-2026-0028',
    date: '2026-06-20',
    qty: 10000,
    price: 480,
    amount: 4800000,
  },

  {
    id: 'PPH-004',
    materialId: 'VT-009',
    supplierId: 'NCC-05',
    poId: 'PO-2026-0039',
    date: '2026-08-14',
    qty: 8000,
    price: 500,
    amount: 4000000,
  },

  {
    id: 'PPH-005',
    materialId: 'VT-002',
    supplierId: 'NCC-02',
    poId: 'PO-2026-0022',
    date: '2026-06-01',
    qty: 80,
    price: 82000,
    amount: 6560000,
  },

  {
    id: 'PPH-006',
    materialId: 'VT-002',
    supplierId: 'NCC-02',
    poId: 'PO-2026-0040',
    date: '2026-08-14',
    qty: 100,
    price: 85000,
    amount: 8500000,
  },
];

/* ---- Đánh giá nhà cung cấp ---- */
DB.supplierEvaluations = [
  { supplierId: 'NCC-01', priceScore: 4.8, deliveryScore: 4.9, qualityScore: 4.9, fulfillmentScore: 5.0, stabilityScore: 4.8, totalScore: 4.88, ratingLabel: 'Xuất sắc', notes: 'Đối tác chiến lược cung cấp đậu nành nguyên liệu' },
  { supplierId: 'NCC-02', priceScore: 4.5, deliveryScore: 4.4, qualityScore: 4.6, fulfillmentScore: 4.5, stabilityScore: 4.5, totalScore: 4.50, ratingLabel: 'Tốt', notes: 'Giao hàng đúng hẹn, giá cả cạnh tranh' },
  { supplierId: 'NCC-03', priceScore: 4.6, deliveryScore: 4.7, qualityScore: 4.8, fulfillmentScore: 4.7, stabilityScore: 4.6, totalScore: 4.68, ratingLabel: 'Xuất sắc', notes: 'Nhà cung cấp dầu ăn thực vật ổn định cho sản xuất' },
  { supplierId: 'NCC-06', priceScore: 4.3, deliveryScore: 4.2, qualityScore: 4.4, fulfillmentScore: 4.3, stabilityScore: 4.3, totalScore: 4.30, ratingLabel: 'Khá', notes: 'Giao nhãn và vật tư đóng gói đúng kế hoạch' },
  { supplierId: 'NCC-07', priceScore: 4.9, deliveryScore: 4.9, qualityScore: 5.0, fulfillmentScore: 4.9, stabilityScore: 4.8, totalScore: 4.90, ratingLabel: 'Xuất sắc', notes: 'Cung cấp nước sạch đạt chuẩn cho chế biến thực phẩm' },
];

/* ---- Ngân sách mua sắm theo phòng ban ---- */
DB.budgets = [
  { dept: 'Kho vận', totalBudget: 500000000, usedBudget: 285000000 },
  { dept: 'Mua hàng', totalBudget: 1200000000, usedBudget: 890000000 },
  { dept: 'Sản xuất', totalBudget: 2500000000, usedBudget: 1850000000 },
  { dept: 'Kỹ thuật', totalBudget: 400000000, usedBudget: 120000000 },
  { dept: 'Kế toán', totalBudget: 200000000, usedBudget: 45000000 },
];

/* ---- Lịch sử nhật ký phê duyệt PR ---- */
DB.purchaseApprovals = [
  {
    id: 'PA-001',
    prId: 'YCM-2026-0043',
    approverId: 'NV-001',
    time: '2026-08-12 14:30',
    action: 'approve',
    prevStatus: 'mh_cho_duyet',
    nextStatus: 'mh_da_duyet',

    note:
      'Đã duyệt mua dầu đậu nành tinh luyện phục vụ dây chuyền chiên',
  },

  {
    id: 'PA-002',
    prId: 'YCM-2026-0042',
    approverId: 'NV-001',
    time: '2026-08-11 10:15',
    action: 'approve',
    prevStatus: 'mh_cho_duyet',
    nextStatus: 'mh_da_duyet',

    note:
      'Duyệt mua bổ sung đường cát trắng và muối ăn cho kế hoạch sản xuất tháng 8',
  },

  {
    id: 'PA-003',
    prId: 'YCM-2026-0032',
    approverId: 'NV-001',
    time: '2026-07-15 16:45',
    action: 'reject',
    prevStatus: 'mh_cho_duyet',
    nextStatus: 'mh_tu_choi',

    note:
      'Từ chối do tồn kho màng co nhiệt vẫn đủ dùng cho kế hoạch hiện tại',
  },
];

/* ---- Hợp đồng ---- */
DB.contracts = CONTRACT_ROWS.map(([id, customerId, type, signDate, expireDate, value, status, paid]) => ({
  id, customerId, type, signDate, expireDate, value, status, paid,
  remain: value - paid,
  owner: 'NV-002',
  scope:
    'Cung cấp, phân phối các sản phẩm đậu hũ và thực phẩm từ đậu nành theo thỏa thuận với khách hàng',}));

/* ---- Chấm công tháng 8/2026 (sinh theo PRNG có seed) ---- */
DB.attendance = (function () {
  Rand.reset(880826);
  const standard = 26;
  return DB.employees
    .filter((e) => e.status !== 'ns_nghi_viec')
    .map((e) => {
      const leave = e.status === 'ns_nghi_phep' ? Rand.int(4, 8) : Rand.chance(0.25) ? Rand.int(1, 2) : 0;
      const late = Rand.chance(0.3) ? Rand.int(1, 3) : 0;
      const worked = standard - leave;
      const ot = Rand.chance(0.6) ? Rand.int(4, 32) : 0;
      return {
        empId: e.id, name: e.name, dept: e.dept, position: e.position,
        standard, worked, leave, late, ot,
        rate: Math.round((worked / standard) * 1000) / 10,
      };
    });
})();

/* ---- Phiếu nhập / xuất kho gần đây ---- */
DB.stockMoves = [
  {
    id: 'PN-2026-0142',
    type: 'in',
    date: '2026-08-14',
    materialId: 'VT-001',
    qty: 4000,
    ref: 'YCM-2026-0036',
    by: 'NV-018',
    note: 'Nhập đậu nành nguyên hạt theo kế hoạch sản xuất tháng 8',
  },

  {
    id: 'PX-2026-0318',
    type: 'out',
    date: '2026-08-15',
    materialId: 'VT-001',
    qty: 150,
    ref: 'LSX-2026-0048',
    by: 'NV-018',
    note: 'Xuất đậu nành cho LSX-2026-0048',
  },

  {
    id: 'PX-2026-0317',
    type: 'out',
    date: '2026-08-13',
    materialId: 'VT-003',
    qty: 4.2,
    ref: 'LSX-2026-0045',
    by: 'NV-019',
    note: 'Xuất muối Nigari cho LSX-2026-0045',
  },

  {
    id: 'PN-2026-0141',
    type: 'in',
    date: '2026-08-12',
    materialId: 'VT-005',
    qty: 600,
    ref: 'YCM-2026-0042',
    by: 'NV-018',
    note: 'Nhập đường cát trắng cho sản xuất',
  },

  {
    id: 'PX-2026-0316',
    type: 'out',
    date: '2026-08-12',
    materialId: 'VT-014',
    qty: 36,
    ref: 'LSX-2026-0040',
    by: 'NV-019',
    note: 'Xuất thùng carton phục vụ đóng gói thành phẩm',
  },

  {
    id: 'PX-2026-0315',
    type: 'out',
    date: '2026-08-11',
    materialId: 'VT-002',
    qty: 2.16,
    ref: 'LSX-2026-0046',
    by: 'NV-018',
    note: 'Xuất thạch cao thực phẩm cho công đoạn đông tụ',
  },

  {
    id: 'PN-2026-0140',
    type: 'in',
    date: '2026-08-10',
    materialId: 'VT-008',
    qty: 10000,
    ref: 'YCM-2026-0045',
    by: 'NV-018',
    note: 'Nhập hộp nhựa PP 400g có nắp',
  },

  {
    id: 'PX-2026-0314',
    type: 'out',
    date: '2026-08-09',
    materialId: 'VT-004',
    qty: 64,
    ref: 'LSX-2026-0043',
    by: 'NV-019',
    note: 'Xuất dầu đậu nành tinh luyện cho dây chuyền chiên',
  },

  {
    id: 'PN-2026-0139',
    type: 'in',
    date: '2026-08-07',
    materialId: 'VT-001',
    qty: 5000,
    ref: 'YCM-2026-0036',
    by: 'NV-018',
    note: 'Nhập đậu nành nguyên hạt',
  },

  {
    id: 'PX-2026-0313',
    type: 'out',
    date: '2026-08-06',
    materialId: 'VT-009',
    qty: 1200,
    ref: 'LSX-2026-0043',
    by: 'NV-018',
    note: 'Xuất túi PE thực phẩm cho đóng gói đậu hủ chiên',
  },
];

/* ---- Thông báo ---- */
DB.notifications = [
  {
    id: 'N1',
    level: 'danger',
    icon: 'fa-triangle-exclamation',

    title: 'Lệnh sản xuất LSX-2026-0039 quá hạn',

    desc:
      'Công đoạn QC/ATTP chưa hoàn tất theo kế hoạch',

    time: '10 phút trước',
    read: false,

    go: {
      module: 'production',
      id: 'LSX-2026-0039',
    },
  },

  {
    id: 'N2',
    level: 'warning',
    icon: 'fa-boxes-stacked',

    title: 'Đậu nành sắp chạm mức tồn tối thiểu',

    desc:
      'Cần bổ sung nguyên liệu để đáp ứng kế hoạch sản xuất tuần tới',

    time: '42 phút trước',
    read: false,

    go: {
      module: 'materials',
    },
  },

  {
    id: 'N3',
    level: 'info',
    icon: 'fa-file-signature',

    title: 'Báo giá BG-2026-0090 được khách hàng duyệt',

    desc:
      'Công ty CP Suất Ăn Công Nghiệp Việt Star — đơn đậu hủ non và đậu hủ cứng',

    time: '2 giờ trước',
    read: false,

    go: {
      module: 'quotes',
      id: 'BG-2026-0090',
    },
  },

  {
    id: 'N4',
    level: 'success',
    icon: 'fa-circle-check',

    title: 'Đơn hàng DH-2026-0086 đã hoàn thành',

    desc:
      'Đậu hủ non và sữa đậu nành đã hoàn tất sản xuất, chờ giao hàng',

    time: '4 giờ trước',
    read: false,

    go: {
      module: 'orders',
      id: 'DH-2026-0086',
    },
  },

  {
    id: 'N5',
    level: 'warning',
    icon: 'fa-cart-shopping',

    title: '3 yêu cầu mua hàng đang chờ duyệt',

    desc:
      'YCM-2026-0044, YCM-2026-0045, YCM-2026-0046 cần xử lý',

    time: '6 giờ trước',
    read: true,

    go: {
      module: 'purchases',
    },
  },

  {
    id: 'N6',
    level: 'info',
    icon: 'fa-file-contract',

    title: '4 hợp đồng sắp hết hạn trong 30 ngày',

    desc:
      'HD-2026-013, HD-2026-012, HD-2026-010, HD-2026-007',

    time: 'Hôm qua',
    read: true,

    go: {
      module: 'contracts',
    },
  },

  {
    id: 'N7',
    level: 'success',
    icon: 'fa-truck-fast',

    title: 'Phiếu nhập PN-2026-0142 đã vào kho',

    desc:
      '4.000 kg đậu nành nguyên hạt — Kho nguyên vật liệu chính',

    time: 'Hôm qua',
    read: true,

    go: {
      module: 'inventory',
    },
  },
];

/* ---- Nhật ký hoạt động ---- */
DB.activities = [
  {
    time: '08:42',
    user: 'Nguyễn Đức Anh',
    action: 'đã chuyển báo giá',
    target: 'BG-2026-0090',
    extra: 'thành đơn hàng DH-2026-0088',
    icon: 'fa-file-invoice',
    tone: 'blue',
  },

  {
    time: '08:20',
    user: 'Nguyễn Văn Hùng',
    action: 'cập nhật tiến độ',
    target: 'LSX-2026-0048',

    extra:
      'đã hoàn tất ép khuôn, chuyển sang QC/đóng gói',

    icon: 'fa-gears',
    tone: 'indigo',
  },

  {
    time: '07:55',
    user: 'Cao Văn Thắng',
    action: 'tạo yêu cầu mua hàng',
    target: 'YCM-2026-0046',

    extra:
      '2.000 kg đậu nành nguyên hạt — 44.000.000đ',

    icon: 'fa-cart-shopping',
    tone: 'orange',
  },

  {
    time: '07:30',
    user: 'Ngô Thị Lan',
    action: 'nghiệm thu QC',
    target: 'LSX-2026-0037',

    extra:
      '600/600 chai đạt yêu cầu ATTP',

    icon: 'fa-clipboard-check',
    tone: 'green',
  },

  {
    time: 'Hôm qua 17:10',
    user: 'Trần Thu Hà',
    action: 'tạo báo giá',
    target: 'BG-2026-0071',

    extra:
      'Quán Phở Chay Bà Cúc',

    icon: 'fa-file-lines',
    tone: 'slate',
  },

  {
    time: 'Hôm qua 16:25',
    user: 'Chu Thị Thanh Thảo',
    action: 'ghi nhận thanh toán',
    target: 'HD-2026-015',

    extra:
      '150.000.000đ đợt 1',

    icon: 'fa-money-bill-transfer',
    tone: 'green',
  },
];


/* --------------------------------------------------------------------------
 * Các alias ngắn để module hiện tại dễ sử dụng.
 * ------------------------------------------------------------------------*/

const PR_FLOW =
  PURCHASE_INVENTORY_CONFIG.prFlow;

const PR_ORDER =
  PURCHASE_INVENTORY_CONFIG.prFlow.map(
    (item) => item.key
  );

const ISSUE_TYPES =
  PURCHASE_INVENTORY_CONFIG.issueTypes;

/* ---------------------------------------------------------------------------
 * 14. Hàm tra cứu & tính toán dùng chung
 * -------------------------------------------------------------------------*/
const Q = {
  customer: (id) => DB.customers.find((c) => c.id === id),
  customerName: (id) => (Q.customer(id) || {}).name || '—',
  employee: (id) => DB.employees.find((e) => e.id === id),
  employeeName: (id) => {
    const emp = Q.employee(id);
    if (emp?.name) return emp.name;
    const user = (DB.users || []).find(u => String(u.id) === String(id) || String(u.empId || '') === String(id));
    if (user) return String(user.username || '').toLowerCase() === 'admin' || user.roleId === 'ROLE_ADMIN' ? 'Admin' : (user.fullName || user.name || user.username || '—');
    return '—';
  },
  product: (id) => DB.products.find((p) => p.id === id),
  material: (id) => DB.materials.find((m) => m.id === id),
  supplier: (id) => DB.suppliers.find((s) => s.id === id),
  supplierName: (id) => (Q.supplier(id) || {}).name || '—',
  operation: (id) => DB.operations.find((o) => o.id === id),
  operationName: (id) => (Q.operation(id) || {}).name || '—',
  order: (id) => DB.orders.find((o) => o.id === id),
  quote: (id) => DB.quotes.find((q) => q.id === id),
  po: (id) => DB.productionOrders.find((p) => p.id === id),
  contract: (id) => DB.contracts.find((c) => c.id === id),
  purchase: (id) => DB.purchases.find((p) => p.id === id),
  purchaseOrder: (id) => DB.purchaseOrders.find((po) => po.id === id),
  quotationsOfPr: (prId) => DB.supplierQuotations.filter((sq) => sq.prId === prId),
  receiptsOfPo: (poId) => DB.goodsReceipts.filter((gr) => gr.poId === poId),
  paymentsOfPo: (poId) => DB.supplierPayments.filter((sp) => sp.poId === poId),
  priceHistoryOfMaterial: (mid) => DB.purchasePriceHistory.filter((ph) => ph.materialId === mid),
  supplierEvaluation: (sid) => DB.supplierEvaluations.find((se) => se.supplierId === sid),
  deptBudget: (dept) => DB.budgets.find((b) => b.dept === dept),
  progress: poProgress,

  /** Đơn hàng của 1 khách */
  ordersOf: (cid) => DB.orders.filter((o) => o.customerId === cid),
  quotesOf: (cid) => DB.quotes.filter((q) => q.customerId === cid),
  contractsOf: (cid) => DB.contracts.filter((c) => c.customerId === cid),
  posOfOrder: (oid) => DB.productionOrders.filter((p) => p.orderId === oid),

  /** Doanh số 1 khách — tính theo giá trị hàng hóa chưa VAT (doanh thu thuần) */
  revenueOf: (cid) => Q.ordersOf(cid).filter((o) => o.status !== 'dh_da_huy').reduce((s, o) => s + o.subtotal, 0),

  /** Định mức đầy đủ của 1 sản phẩm: vật tư + công đoạn + giá thành */
  costOf: (pid) => {
    const p = Q.product(pid);
    if (!p) return null;
    const materials = expandBom(p.bom);
    const operations = expandRouting(p.routing);
    return { product: p, materials, operations, ...rollupCost(materials, operations, p.price) };
  },

  /** Các sản phẩm đang dùng một công đoạn */
  productsUsingOp: (oid) => DB.products.filter((p) => (p.routing || []).some(([id]) => id === oid)),
  /** Các sản phẩm đang dùng một vật tư */
  productsUsingMaterial: (mid) => DB.products.filter((p) => (p.bom || []).some(([id]) => id === mid)),

  /** Công đoạn của 1 sản phẩm thuộc về một phân xưởng (dùng ở chi tiết lệnh SX) */
  opsOfStage: (pid, workshop) => expandRouting((Q.product(pid) || {}).routing).filter((o) => o.workshop === workshop),

  /** Kiểm tra vật tư cho 1 lệnh sản xuất theo định mức BOM */
  materialCheck: (po) => {
    const p = Q.product(po.productId);
    if (!p) return [];
    return p.bom.map(([mid, per, lossPct = 0]) => {
      const m = Q.material(mid);
      const baseNeed = Number(per || 0) * Number(po.qty || 0);
      const loss = Math.max(0, Math.min(99.99, Number(lossPct || 0)));
      const needRaw = loss > 0 ? baseNeed / (1 - loss / 100) : baseNeed;
      const need = Math.round(needRaw * 100) / 100;
      return {
        materialId: mid, name: m.name, unit: m.unit, per, lossPct: loss,
        need, stock: m.stock,
        lack: Math.max(0, Math.round((need - m.stock) * 100) / 100),
        ok: m.stock >= need,
      };
    });
  },

  /** Vật tư dưới định mức tồn */
  lowStock: () => DB.materials.filter((m) => m.stock < m.minStock),

  /**
 * Danh sách vật tư phục vụ lập Đề nghị mua hàng
 * Có đầy đủ tồn kho và trạng thái tồn
 */
  materialsForPurchaseRequest: () => DB.materials.map(m => {

    const stock = Number(m.stock || 0);
    const minStock = Number(m.minStock || 0);

    let stockStatus;

    if (stock <= 0) {
      stockStatus = 'OUT_OF_STOCK';
    } else if (stock < minStock) {
      stockStatus = 'LOW_STOCK';
    } else {
      stockStatus = 'IN_STOCK';
    }

    return {
      ...m,
      stock,
      minStock,
      stockStatus
    };

  }),

  /** Hợp đồng sắp hết hạn trong N ngày */
  expiringContracts: (days = 45) => DB.contracts.filter((c) => {
    if (['hd_het_han', 'hd_thanh_ly'].includes(c.status)) return false;
    const diff = (new Date(c.expireDate) - new Date(TODAY)) / 86400000;
    return diff >= 0 && diff <= days;
  }),

  /** Lệnh sản xuất trễ hoặc sắp trễ deadline */
  lateProduction: () => DB.productionOrders.filter((p) => {
    if (['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status)) return false;
    const diff = (new Date(p.deadline) - new Date(TODAY)) / 86400000;
    return diff <= 5;
  }),

  /** Tổng giá trị tồn kho thực tế */
  inventoryValue: () => DB.materials.reduce((s, m) => s + m.value, 0),

  /* --------------------------------------------------------------- INVENTORY HELPERS */
  /** Lấy thông tin kho theo ID */
  warehouse: (id) => DB.warehouses.find((w) => w.id === id),
  warehouseName: (id) => (DB.warehouses.find((w) => w.id === id) || {}).name || '—',

  /** Lấy vị trí kho theo ID */
  warehouseLocation: (id) => DB.warehouseLocations.find((l) => l.id === id),
  locationName: (id) => (DB.warehouseLocations.find((l) => l.id === id) || {}).name || '—',

  /** Lấy vị trí kho thuộc kho cụ thể */
  locationsOf: (warehouseId) => DB.warehouseLocations.filter((l) => l.warehouseId === warehouseId),

  /** Lấy thông tin lô theo ID */
  lot: (id) => DB.inventoryLots.find((l) => l.id === id),
  lotByNumber: (num) => DB.inventoryLots.find((l) => l.lotNumber === num),

  /** Lấy tổng tồn khả dụng cho 1 sản phẩm (tất cả kho, tất cả lô) */
  totalAvailable: (productId) => DB.inventory.filter((inv) => inv.productId === productId).reduce((s, inv) => s + (inv.qtyAvailable || 0), 0),
  totalOnHand: (productId) => DB.inventory.filter((inv) => inv.productId === productId).reduce((s, inv) => s + (inv.qtyOnHand || 0), 0),

  /** Tồn khả dụng theo product + warehouse cụ thể */
  stockOf: (productId, warehouseId) => DB.inventory.filter((inv) => inv.productId === productId && (!warehouseId || inv.warehouseId === warehouseId)),

  /** FEFO – lấy danh sách lô theo FEFO (hạn sử dụng gần nhất trước) cho 1 sản phẩm */
  fefoLotsOf: (productId, warehouseId) => {
    const today = new Date(TODAY + 'T00:00:00');
    return DB.inventory
      .filter((inv) => inv.productId === productId && (!warehouseId || inv.warehouseId === warehouseId) && inv.qtyAvailable > 0)
      .map((inv) => {
        const lot = DB.inventoryLots.find((l) => l.id === inv.lotId);
        return { ...inv, lot };
      })
      .filter((inv) => inv.lot && new Date(inv.lot.expiryDate + 'T00:00:00') > today && inv.lot.qcStatus !== 'FAILED' && inv.lot.qcStatus !== 'QUARANTINE')
      .sort((a, b) => { const e=a.lot.expiryDate.localeCompare(b.lot.expiryDate); if(e) return e; const ra=(DB.goodsReceipts||[]).find(gr=>(gr.items||[]).some(i=>i.lotId===a.lotId))?.date || a.lot.createdAt || a.lot.mfgDate || '9999-12-31'; const rb=(DB.goodsReceipts||[]).find(gr=>(gr.items||[]).some(i=>i.lotId===b.lotId))?.date || b.lot.createdAt || b.lot.mfgDate || '9999-12-31'; return String(ra).localeCompare(String(rb)); });
  },

  /** Các lô cận ngày hết hạn */
  nearExpiryLots: (days) => {
    const n = days || DB.inventoryAlertConfig.nearExpiryDays;
    const today = new Date(TODAY + 'T00:00:00');
    const limit = new Date(today); limit.setDate(limit.getDate() + n);
    return DB.inventoryLots.filter((l) => {
      const exp = new Date(l.expiryDate + 'T00:00:00');
      return exp >= today && exp <= limit;
    });
  },

  /** Các lô đã hết hạn */
  expiredLots: () => {
    const today = new Date(TODAY + 'T00:00:00');
    return DB.inventoryLots.filter((l) => new Date(l.expiryDate + 'T00:00:00') < today);
  },

  /** Cảnh báo tồn kho thấp (dựa trên DB.materials.minStock) */
  lowStockAlerts: () => DB.materials.filter((m) => m.stock < m.minStock).map((m) => ({ material: m, available: m.stock, minimum: m.minStock })),

  /** Hàng chậm luân chuyển (số ngày không phát sinh xuất) */
  slowMoving: (days) => {
    const d = days || DB.inventoryAlertConfig.slowMovingDays;
    const cutoff = addDays(TODAY, -d);
    return DB.materials.map((m) => {
      const lastIssue = DB.stockMoves.filter((x) => x.materialId === m.id && x.type === 'out').sort((a, b) => b.date.localeCompare(a.date))[0];
      const daysSinceIssue = lastIssue ? Math.round((new Date(TODAY) - new Date(lastIssue.date)) / 86400000) : null;
      return { material: m, lastIssueDate: lastIssue ? lastIssue.date : null, daysSinceIssue };
    }).filter((x) => !x.lastIssueDate || x.lastIssueDate < cutoff);
  },

  /** Danh sách giao dịch kho cho 1 sản phẩm / lô / kho */
  txOf: (filters = {}) => DB.inventoryTransactions.filter((tx) => {
    if (filters.productId && tx.productId !== filters.productId) return false;
    if (filters.lotId && tx.lotId !== filters.lotId) return false;
    if (filters.warehouseId && tx.warehouseId !== filters.warehouseId) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date)),
};

/* Sinh mã chứng từ mới theo tiền tố (dùng khi người dùng tạo mới trong demo).
 * Mọi mã đều có dạng <TIỀN TỐ><số thứ tự> với số thứ tự nằm sau dấu "-" cuối. */
function nextCode(prefix, list, pad = 4) {
  const nums = list
    .map((x) => parseInt(String(x.id).split('-').pop(), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}${String(max + 1).padStart(pad, '0')}`;
}


// ============================================================
// CRM – MOCK DATA
// Không tạo lại customers / orders.
// CRM chỉ lưu dữ liệu về Lead, Opportunity, Activity, Ticket.
// ============================================================


// ------------------------------------------------------------
// CRM LEADS
// ------------------------------------------------------------

DB.crmLeads = [
  {
    id: 'LEAD-2026-001',
    company: 'Công ty Thực phẩm Minh Phát',
    contact: 'Nguyễn Minh Phát',
    phone: '0903123456',
    email: 'minhphat@example.com',
    province: 'TP. Hồ Chí Minh',

    source: 'Website',
    industry: 'Thực phẩm',
    estimatedValue: 120000000,

    ownerId: 'NV-001',

    status: 'NEW',

    createdAt: '2026-08-25',
    lastContactAt: null,

    note: 'Khách hàng đang quan tâm đến sản phẩm và cần tư vấn thêm.'
  },

  {
    id: 'LEAD-2026-002',
    company: 'Công ty TNHH An Phú',
    contact: 'Trần Quốc Huy',
    phone: '0912345678',
    email: 'anphu@example.com',
    province: 'Đồng Nai',

    source: 'Giới thiệu',
    industry: 'Phân phối',
    estimatedValue: 85000000,

    ownerId: 'NV-002',

    status: 'QUALIFIED',

    createdAt: '2026-08-20',
    lastContactAt: '2026-08-28',

    note: 'Đã xác nhận nhu cầu và đang trao đổi về giá.'
  },

  {
    id: 'LEAD-2026-003',
    company: 'Cửa hàng Thực phẩm Tân Thành',
    contact: 'Lê Hoàng Nam',
    phone: '0987654321',
    email: 'tanthanh@example.com',
    province: 'Bình Dương',

    source: 'Facebook',
    industry: 'Bán lẻ',
    estimatedValue: 45000000,

    ownerId: 'NV-003',

    status: 'CONTACTED',

    createdAt: '2026-08-29',
    lastContactAt: '2026-09-02',

    note: 'Đã gọi điện lần đầu, khách hàng yêu cầu gửi báo giá.'
  },

  {
    id: 'LEAD-2026-004',
    company: 'Công ty CP Đại Thành',
    contact: 'Phạm Thanh Bình',
    phone: '0934567890',
    email: 'daithanh@example.com',
    province: 'Long An',

    source: 'Hội chợ',
    industry: 'Thực phẩm',
    estimatedValue: 160000000,

    ownerId: 'NV-004',

    status: 'NEW',

    createdAt: '2026-09-01',
    lastContactAt: null,

    note: 'Lead mới thu thập từ hội chợ.'
  }
];


// ------------------------------------------------------------
// CRM OPPORTUNITIES
// ------------------------------------------------------------

DB.crmOpportunities = [
  {
    id: 'OPP-2026-001',

    leadId: 'LEAD-2026-001',
    customerId: null,

    company: 'Công ty Thực phẩm Minh Phát',
    contact: 'Nguyễn Minh Phát',

    ownerId: 'NV-001',

    stage: 'PROPOSAL',

    value: 120000000,

    probability: 70,

    expectedCloseDate: '2026-09-15',

    source: 'Website',

    createdAt: '2026-08-25',
    updatedAt: '2026-09-03',

    note: 'Đã xác định nhu cầu, đang chuẩn bị báo giá.'
  },

  {
    id: 'OPP-2026-002',

    leadId: 'LEAD-2026-002',
    customerId: null,

    company: 'Công ty TNHH An Phú',
    contact: 'Trần Quốc Huy',

    ownerId: 'NV-002',

    stage: 'NEGOTIATION',

    value: 85000000,

    probability: 80,

    expectedCloseDate: '2026-09-10',

    source: 'Giới thiệu',

    createdAt: '2026-08-20',
    updatedAt: '2026-09-02',

    note: 'Khách hàng đang thương lượng về giá và số lượng.'
  },

  {
    id: 'OPP-2026-003',

    leadId: null,

    customerId: null,

    company: 'Công ty TNHH Phú Hưng',
    contact: 'Nguyễn Thành Công',

    ownerId: 'NV-003',

    stage: 'QUALIFICATION',

    value: 65000000,

    probability: 40,

    expectedCloseDate: '2026-09-25',

    source: 'Khách hàng cũ',

    createdAt: '2026-08-30',
    updatedAt: '2026-09-01',

    note: 'Khách hàng cũ phát sinh nhu cầu mới.'
  },

  {
    id: 'OPP-2026-004',

    leadId: null,

    customerId: null,

    company: 'Công ty CP Thành Công',
    contact: 'Hoàng Minh Đức',

    ownerId: 'NV-005',

    stage: 'CLOSED_WON',

    value: 150000000,

    probability: 100,

    expectedCloseDate: '2026-08-28',

    source: 'Giới thiệu',

    createdAt: '2026-08-10',
    updatedAt: '2026-08-28',

    note: 'Đã chốt thành công và chuyển sang đơn hàng.'
  },

  {
    id: 'OPP-2026-005',

    leadId: null,

    customerId: null,

    company: 'Công ty TNHH Việt Hưng',
    contact: 'Võ Quốc Toàn',

    ownerId: 'NV-006',

    stage: 'CLOSED_LOST',

    value: 70000000,

    probability: 0,

    expectedCloseDate: '2026-08-25',

    source: 'Website',

    createdAt: '2026-08-05',
    updatedAt: '2026-08-25',

    note: 'Khách hàng lựa chọn nhà cung cấp khác.'
  }
];


// ------------------------------------------------------------
// CRM ACTIVITIES
// ------------------------------------------------------------

DB.crmActivities = [
  {
    id: 'ACT-2026-001',

    customerId: null,
    leadId: 'LEAD-2026-001',
    opportunityId: 'OPP-2026-001',

    type: 'CALL',

    subject: 'Gọi điện tư vấn nhu cầu',

    content: 'Trao đổi nhu cầu và số lượng dự kiến của khách hàng.',

    ownerId: 'NV-001',

    status: 'COMPLETED',

    scheduledAt: '2026-09-01 09:30',

    completedAt: '2026-09-01 10:00'
  },

  {
    id: 'ACT-2026-002',

    customerId: null,
    leadId: 'LEAD-2026-001',
    opportunityId: 'OPP-2026-001',

    type: 'MEETING',

    subject: 'Hẹn gặp khách hàng',

    content: 'Trao đổi trực tiếp về nhu cầu và phương án cung cấp.',

    ownerId: 'NV-001',

    status: 'SCHEDULED',

    scheduledAt: '2026-09-08 14:00',

    completedAt: null
  },

  {
    id: 'ACT-2026-003',

    customerId: null,
    leadId: 'LEAD-2026-002',
    opportunityId: 'OPP-2026-002',

    type: 'EMAIL',

    subject: 'Gửi báo giá',

    content: 'Đã gửi báo giá theo yêu cầu của khách hàng.',

    ownerId: 'NV-002',

    status: 'COMPLETED',

    scheduledAt: '2026-08-29 15:00',

    completedAt: '2026-08-29 15:15'
  },

  {
    id: 'ACT-2026-004',

    customerId: null,
    leadId: 'LEAD-2026-003',
    opportunityId: null,

    type: 'CALL',

    subject: 'Gọi điện lần đầu',

    content: 'Khách hàng yêu cầu được gửi bảng giá sản phẩm.',

    ownerId: 'NV-003',

    status: 'COMPLETED',

    scheduledAt: '2026-09-02 10:00',

    completedAt: '2026-09-02 10:20'
  },

  {
    id: 'ACT-2026-005',

    customerId: null,
    leadId: 'LEAD-2026-001',
    opportunityId: 'OPP-2026-001',

    type: 'NOTE',

    subject: 'Ghi chú khách hàng',

    content: 'Khách hàng ưu tiên thời gian giao hàng nhanh.',

    ownerId: 'NV-001',

    status: 'COMPLETED',

    scheduledAt: '2026-09-03 11:00',

    completedAt: '2026-09-03 11:00'
  }
];


// ------------------------------------------------------------
// CRM TICKETS / KHIẾU NẠI & HỖ TRỢ
// ------------------------------------------------------------

DB.crmTickets = [
  {
    id: 'TKT-2026-001',

    customerId: null,
    customerName: 'Công ty Thực phẩm Minh Phát',

    title: 'Yêu cầu kiểm tra tình trạng giao hàng',

    description: 'Khách hàng yêu cầu kiểm tra tiến độ giao đơn hàng.',

    type: 'SUPPORT',

    priority: 'HIGH',

    status: 'OPEN',

    ownerId: 'NV-001',

    createdAt: '2026-09-02',

    dueDate: '2026-09-04',

    resolvedAt: null
  },

  {
    id: 'TKT-2026-002',

    customerId: null,
    customerName: 'Công ty TNHH An Phú',

    title: 'Sai thông tin trên báo giá',

    description: 'Khách hàng yêu cầu điều chỉnh lại thông tin báo giá.',

    type: 'COMPLAINT',

    priority: 'MEDIUM',

    status: 'IN_PROGRESS',

    ownerId: 'NV-002',

    createdAt: '2026-09-01',

    dueDate: '2026-09-05',

    resolvedAt: null
  },

  {
    id: 'TKT-2026-003',

    customerId: null,
    customerName: 'Công ty CP Thành Công',

    title: 'Xác nhận hoàn tất hỗ trợ',

    description: 'Khách hàng xác nhận vấn đề đã được xử lý.',

    type: 'SUPPORT',

    priority: 'LOW',

    status: 'RESOLVED',

    ownerId: 'NV-005',

    createdAt: '2026-08-27',

    dueDate: '2026-08-30',

    resolvedAt: '2026-08-29'
  }
];