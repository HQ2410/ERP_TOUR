/* ============================================================================
 * KIO CONFIG — ERP Du lịch / Điều hành tour
 * ----------------------------------------------------------------------------
 * Chỉ chứa cấu hình persistence (tên bảng). Không chứa business logic.
 *
 * Tiền tố `tnk_tour_` được chọn RIÊNG để KHÔNG trùng các bảng của ERP TNK khác
 * trên cùng server (tnk_customers, tnk_users, tnk_sales_orders…).
 * Mỗi bảng chỉ cần: id (khóa chính tự tăng) + payload (TEXT hoặc VARCHAR).
 * Xem sql/kio-tables.sql để tạo bảng.
 * ========================================================================== */
const TOUR_KIO_CONFIG = Object.freeze({
  tables: Object.freeze({
    users:     'tnk_tour_users',      // tài khoản đăng nhập (băm mật khẩu, không lưu mật khẩu thô)
    config:    'tnk_tour_config',     // 1 record id=config: thông tin công ty, URL API email
    services:  'tnk_tour_services',   // danh mục dịch vụ
    accounts:  'tnk_tour_accounts',   // tài khoản ngân hàng cá nhân / công ty
    customers: 'tnk_tour_customers',
    suppliers: 'tnk_tour_suppliers',
    orders:    'tnk_tour_orders',
    tours:     'tnk_tour_tours',      // tour điều hành (kèm dự trù, booking, bàn giao, quyết toán)
    vouchers:  'tnk_tour_vouchers',   // phiếu thu / chi
    quotes:    'tnk_tour_quotes'      // báo giá / tính giá tour
  }),
  pollMs: 60000,        // tự kiểm tra thay đổi từ người khác mỗi 60 giây
  pushDebounceMs: 400   // gom các thao tác lưu liên tiếp trước khi gửi lên server
});
