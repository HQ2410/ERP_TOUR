# ERP Du lịch — Điều hành tour

Project web (HTML/CSS/JS thuần, không cần cài đặt) xây theo file **NỘI DUNG YÊU CẦU PM**,
giao diện nền design system **ERP LENAM** (`css/style.css`), phủ thêm `css/theme-tnk.css` để đổi màu/bố cục theo mẫu (sidebar xanh, thẻ KPI đổ màu, trang Tổng quan).

## Chạy
Mở `index.html` bằng trình duyệt (hoặc đặt vào thư mục XAMPP/htdocs). Không cần backend.
Dữ liệu lưu trong localStorage của trình duyệt; lần đầu tự nạp dữ liệu mẫu.
Hệ thống → *Dữ liệu & sao lưu* để sao lưu/khôi phục JSON hoặc nạp lại dữ liệu mẫu.

## Đối chiếu yêu cầu
| # | Hạng mục | File | Đã làm |
|---|----------|------|--------|
| 1 | Khách hàng | `js/modules/customers.js` | Mã KH, họ tên, năm sinh, ĐT, CCCD, địa chỉ, doanh thu (tự tính từ đơn); tìm theo họ tên/SĐT; xuất Excel |
| 2 | Đơn hàng | `orders.js` | Đủ các trường yêu cầu; tạo đơn → tự sinh tour bên Điều hành; tìm theo mã đơn/dịch vụ/KH/SĐT; tạo phiếu thu (bắt buộc chọn TK cá nhân hoặc công ty); in / xuất PDF |
| 3 | Nhà cung cấp | `suppliers.js` | Mã NCC, tên, địa chỉ, tỉnh thành, ĐT, email, 6 loại hình, giá tiền; tìm theo mã/tên/tỉnh; xuất Excel |
| 4 | Điều hành tour | `operations.js` | Dự trù (SL, đơn giá, thành tiền); phiếu chi trên dự trù (chọn TK); form booking lấy email NCC + nút **Gửi Booking**; tổng hợp đã thu/đã chi/lợi nhuận; quyết toán; tính giá tour = tổng chi phí ÷ số khách; bàn giao tour; xuất file giá tour & bàn giao (PDF/in + Excel) |
| 5 | Kế toán | `accounting.js` | Phiếu thu/chi có mã (PT0001/PC0001); tìm theo mã phiếu; bắt buộc chọn TK cá nhân/công ty; in/PDF (có số tiền bằng chữ) |
| 6 | Báo cáo | `reports.js` | Tổng quan, doanh thu, lợi nhuận, dòng tiền, quỹ; lọc theo mốc thời gian; xuất dữ liệu Excel |
| 7 | Hệ thống | `system.js` | Thêm/sửa/ngừng/xóa dịch vụ; tài khoản ngân hàng; thông tin công ty; sao lưu |

## Quy ước nghiệp vụ (có thể chỉnh trong code)
- Thành tiền = đơn giá × số lượng; **phải thu = thành tiền − giảm giá/hoa hồng** (nhập theo % hoặc ₫).
- Số khách của tour mặc định = số lượng của đơn, sửa được ở tab *Tính giá tour*.
- Lợi nhuận dự kiến = phải thu − tổng dự trù; lợi nhuận thực tế = đã thu − đã chi.
- Báo cáo doanh thu/lợi nhuận tính theo **ngày tạo đơn**; dòng tiền/quỹ theo **ngày lập phiếu**.
- Quyết toán sẽ khóa tour (không sửa dự trù/phiếu); có nút *Mở lại quyết toán*.
- "Xuất PDF" mở khung xem trước rồi dùng hộp thoại in của trình duyệt → chọn *Save as PDF*.

## Gửi booking cho NCC
Trình duyệt không tự gửi email được. Hai chế độ:
1. **Mặc định:** mở ứng dụng email (mailto) với nội dung đã soạn, bấm Gửi trong đó.
2. **Tự động:** nhập *URL API gửi email* ở Hệ thống → Thông tin công ty. Nút *Gửi Booking* sẽ
   `POST` JSON `{to, cc, subject, text, tourId, supplierId, supplierName, lines[]}`; server của bạn gửi mail (SMTP/SendGrid…) và trả HTTP 200.

## Cấu trúc
```
index.html            khung giao diện (sidebar + topbar) như LENAM
css/style.css         design system LENAM        css/tour.css  phần bổ sung
css/theme-tnk.css     màu sắc/bố cục theo mẫu (đổi màu chủ đạo ở đây)
js/data.js            kho dữ liệu, dữ liệu mẫu, hàm tính nghiệp vụ (App.Store, App.Calc)
js/core.js            modal, toast, bảng, xuất Excel, in/PDF, router
js/modules/*.js       7 phân hệ + dashboard.js (trang Tổng quan)        js/app.js  khởi động, menu, tìm kiếm Ctrl+K, thông báo
assets/               Font Awesome, Chart.js, SheetJS (chạy offline)
```
Chuyển sang CSDL thật: thay `Store.load()/save()` trong `data.js` bằng gọi API; các phân hệ giữ nguyên.

## Đổi thương hiệu
Tên/logo "TNK" nằm ở `index.html` (khối `.brand`). Màu sidebar: biến `--side-bg`, `--side-bg-2` đầu file `theme-tnk.css`.
