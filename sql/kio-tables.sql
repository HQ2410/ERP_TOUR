-- ============================================================================
-- Bảng cho ERP Du lịch / Điều hành tour trên server KIO (MySQL)
-- Frontend KHÔNG tự tạo bảng. Nhờ quản trị viên server chạy file này một lần.
--
-- Mỗi bảng chỉ cần 2 cột: id (khóa chính tự tăng) và payload.
-- kio-api.js cắt mỗi bản ghi thành nhiều dòng payload nhỏ (~120 ký tự dữ liệu),
-- nên VARCHAR(255) vẫn dùng được; TEXT an toàn hơn nếu server cho phép.
-- Tiền tố tnk_tour_ cố ý khác tnk_* để không trùng bảng của ERP TNK khác.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tnk_tour_users     (id INT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tnk_tour_config    (id INT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tnk_tour_services  (id INT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tnk_tour_accounts  (id INT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tnk_tour_customers (id INT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tnk_tour_suppliers (id INT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tnk_tour_orders    (id INT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tnk_tour_tours     (id INT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tnk_tour_vouchers  (id INT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tnk_tour_quotes    (id INT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL) DEFAULT CHARSET=utf8mb4;
