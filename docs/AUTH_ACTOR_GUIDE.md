# Phân quyền Lê Nam ERP — bộ tài khoản demo dễ nhớ

## Nguyên tắc

- Tài khoản được đặt theo **phòng ban/chức năng**, không đặt theo tên cá nhân để dễ demo.
- Mỗi tài khoản nghiệp vụ chỉ thấy các module/tab cần thiết (least privilege).
- `admin` là tài khoản duy nhất quản trị toàn hệ thống và người dùng.
- `giamdoc` có phạm vi xem rộng và quyền phê duyệt cấp cao nhưng không dùng để quản trị tài khoản.
- Audit vẫn lưu `userId`, username, họ tên actor, vai trò, phòng ban và thời gian thao tác.
- Mật khẩu demo mặc định: `123456`.

## Tài khoản

| Username | Vai trò | Phạm vi chính |
|---|---|---|
| `admin` | Quản trị hệ thống | Toàn bộ hệ thống + người dùng/phân quyền |
| `giamdoc` | Ban giám đốc | Dashboard, toàn bộ nghiệp vụ, phê duyệt cấp cao |
| `muahang` | Mua hàng | PR, báo giá NCC, PO, công nợ NCC, NCC, xem tồn |
| `kho` | Kho | Nhập/xuất/chuyển/kiểm kê/tồn/lô/kế hoạch kho |
| `sanxuat` | Sản xuất | Kế hoạch, LSX, BOM, tiến độ, xem tồn |
| `qc` | QC / QA | IQC/PQC/FQC, hồ sơ chất lượng, dữ liệu kho liên quan |
| `kinhdoanh` | Kinh doanh | CRM, khách hàng, đơn bán, công nợ khách hàng |
| `ketoan` | Kế toán | Kế toán tài chính, PO/công nợ NCC, công nợ KH |
| `nhansu` | Nhân sự | Nhân sự, chấm công, ca, KPI, lương |
| `baotri` | Bảo trì | Thiết bị, lịch bảo trì, phiếu sửa chữa, nhật ký |
| `logistics` | Logistics | Điều phối/giao hàng, xe, tài xế, lịch giao |
| `cuahang` | Nhà hàng / Cửa hàng | POS, bếp, menu, tồn cửa hàng, bổ sung, doanh thu |
| `giacong` | Gia công | Kế hoạch gia công, công nợ, đối tác, kho/QC liên quan |
| `rnd` | R&D | Dự án, công thức, phiên bản, thử nghiệm, chi phí |

## Kiểm tra nhanh

1. Đăng nhập `kho / 123456`: sidebar chỉ nên có Kho, PR liên quan và Thông tin phân quyền.
2. Đăng nhập `sanxuat / 123456`: không được thấy Kế toán/HR/CRM; chỉ Sản xuất + dữ liệu tồn cần thiết.
3. Đăng nhập `kinhdoanh / 123456`: chỉ CRM/Bán hàng; không được duyệt PO hay điều chỉnh kho.
4. Đăng nhập `giamdoc / 123456`: xem rộng và duyệt cấp cao nhưng không có màn quản trị user.
5. Đăng nhập `admin / 123456`: truy cập toàn bộ, bao gồm Hệ thống người dùng/phân quyền.

> Bộ phân quyền mới dùng cache/session `v2` để trình duyệt không tái sử dụng tài khoản/role cũ.

## Phân tách người tạo và người duyệt Mua hàng

- `muahang / 123456`: tạo và xử lý nghiệp vụ mua hàng; **không có quyền duyệt PR/PO**.
- `truongmuahang / 123456`: Trưởng phòng Mua hàng; duyệt/từ chối PR và PO cấp 1.
- `giamdoc / 123456`: chỉ duyệt cấp cao khi quy trình phát sinh cấp Giám đốc theo ngưỡng giá trị.
- Giao diện chỉ hiển thị nút Duyệt/Từ chối cho tài khoản đang có quyền ở cấp hiện tại.
