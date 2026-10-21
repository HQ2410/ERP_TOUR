# ERP Du lịch — Điều hành tour

Project web (HTML/CSS/JS thuần, không cần cài đặt) xây theo file **NỘI DUNG YÊU CẦU PM**,
giao diện nền design system **ERP LENAM** (`css/style.css`), phủ thêm `css/theme-tnk.css` để đổi màu/bố cục theo mẫu (sidebar xanh, thẻ KPI đổ màu, trang Tổng quan).

## Đăng nhập
Mở ứng dụng sẽ thấy màn hình đăng nhập. Lần đầu dùng tài khoản **admin / admin123**, hệ thống nhắc đổi mật khẩu ngay sau khi vào.
- Vai trò: **Quản trị viên** (toàn quyền, có mục Hệ thống → tab *Người dùng*) và **Nhân viên** (mọi phân hệ trừ Hệ thống).
- Mật khẩu lưu dạng băm SHA-256 có muối; sai 5 lần liên tiếp bị khóa đăng nhập 60 giây; *Ghi nhớ đăng nhập* giữ phiên 30 ngày (mặc định 8 giờ).
- Người dùng lưu riêng, không mất khi nạp lại dữ liệu mẫu / khôi phục sao lưu.
- **Lưu ý bảo mật:** vì chạy hoàn toàn trên trình duyệt, đăng nhập chỉ ngăn người dùng thông thường, không phải bảo mật thật (ai mở DevTools vẫn đọc được localStorage). Khi nối máy chủ, thay `Auth.login/Auth.current` trong `js/auth.js` bằng API xác thực phía server.

## Kết nối máy chủ KIO
Dữ liệu dùng chung qua **KIO** bằng `js/api/kio-api.js` (adapter `KioStore` của bạn) + `list.js`/`krud.js` của KIO. Nếu không nạp được thư viện KIO hoặc mất mạng, ứng dụng vẫn chạy với dữ liệu lưu trên trình duyệt và tự đồng bộ khi có lại kết nối (chỉ báo "Đã đồng bộ / Chờ gửi / Offline" ở thanh trên cùng).

**Việc cần làm một lần:** nhờ quản trị viên server chạy `sql/kio-tables.sql` để tạo 10 bảng `tnk_tour_*` (frontend không tự tạo bảng). Tiền tố `tnk_tour_` cố ý khác `tnk_*` để không đụng bảng của ERP TNK khác.

| Bảng | Nội dung |
|---|---|
| tnk_tour_users | tài khoản đăng nhập (băm mật khẩu) — dùng chung nhiều máy |
| tnk_tour_config | thông tin công ty, URL API email (1 record `config`) |
| tnk_tour_services / accounts | danh mục dịch vụ / tài khoản ngân hàng |
| tnk_tour_customers / suppliers / orders | khách hàng / NCC / đơn hàng |
| tnk_tour_tours | tour điều hành (dự trù, booking, bàn giao, quyết toán) |
| tnk_tour_vouchers | phiếu thu / chi |
| tnk_tour_quotes | báo giá / tính giá tour (bảng thêm sau: nếu máy chủ chưa có, app vẫn chạy, báo giá tạm lưu trên máy tới khi tạo bảng) |

**Cách hoạt động**
- Mở trang → kết nối KIO, lấy danh sách người dùng → đăng nhập → tải dữ liệu vào bộ nhớ. Máy chủ còn trống: quản trị viên chọn *dữ liệu trong trình duyệt / dữ liệu mẫu / trống* (không tự đẩy gì lên khi chưa chọn).
- Mỗi lần lưu chỉ **đẩy các bản ghi thay đổi** (`syncCollection`) và bản ghi đã xóa (`deleteKeys`). Không bao giờ ghi đè cả bảng, trừ khi quản trị viên chủ động *Nạp lại dữ liệu mẫu / Xóa dữ liệu / Khôi phục* (phải gõ chữ xác nhận; dùng `replaceCollection` + `allowEmpty` + lý do).
- Tự kiểm tra thay đổi của người khác mỗi 60 giây và khi quay lại tab; nút *Đồng bộ ngay* ở thanh trên cùng.
- Hai người cùng tạo một mã (VD DH0008): hệ thống phát hiện, **tự đổi mã bản ghi mới** (kèm cập nhật tour/phiếu liên quan) và báo người dùng, không ghi đè dữ liệu của người kia.
- Đóng trình duyệt khi còn thay đổi chưa gửi: lần sau tự gửi tiếp.

**Giới hạn cần biết**
- Hai người sửa **cùng một bản ghi** gần như đồng thời: người lưu sau thắng (KIO không có khóa bản ghi).
- Mỗi bản ghi bị cắt thành nhiều dòng payload nhỏ nên tour có nhiều dòng dự trù ghi chậm hơn vài giây.
- API KIO chạy từ trình duyệt, không có xác thực riêng: hash mật khẩu nằm trong `tnk_tour_users`. Nên giới hạn quyền truy cập bảng ở phía server.
- Đã kiểm thử bằng máy chủ KIO giả lập cùng hợp đồng hàm (`getKrudList`/`sendFormDataKRUD`/`krud`); cần chạy thử một lượt trên server KIO thật.

## Chạy
Mở `index.html` bằng trình duyệt (hoặc đặt vào thư mục XAMPP/htdocs). Không cần backend.
Khi chưa kết nối được KIO, dữ liệu lưu trong localStorage của trình duyệt; lần đầu tự nạp dữ liệu mẫu.
Hệ thống → *Dữ liệu & sao lưu* để sao lưu/khôi phục JSON hoặc nạp lại dữ liệu mẫu.

## Đối chiếu yêu cầu
| # | Hạng mục | File | Đã làm |
|---|----------|------|--------|
| 1 | Khách hàng | `js/modules/customers.js` | Mã KH, họ tên, năm sinh, ĐT, CCCD, địa chỉ, doanh thu (tự tính từ đơn); tìm theo họ tên/SĐT; xuất Excel |
| 2 | Đơn hàng | `orders.js` | Đủ các trường yêu cầu; tạo đơn → tự sinh tour bên Điều hành; tìm theo mã đơn/dịch vụ/KH/SĐT; tạo phiếu thu (bắt buộc chọn TK cá nhân hoặc công ty); in / xuất PDF |
| 3 | Nhà cung cấp | `suppliers.js` | Mã NCC, tên, địa chỉ, tỉnh thành, ĐT, email, 6 loại hình, giá tiền; tìm theo mã/tên/tỉnh; xuất Excel |
| 4 | Điều hành tour | `operations.js` | Dự trù (SL, đơn giá, thành tiền); phiếu chi trên dự trù (chọn TK); form booking lấy email NCC + nút **Gửi Booking**; tổng hợp đã thu/đã chi/lợi nhuận; quyết toán; bàn giao tour; xuất file bàn giao (PDF/in + Excel) |
| 4b | Tính giá tour (báo giá) | `pricing.js` | Mục riêng dưới Điều hành tour: mã báo giá, tuyến, thời gian, ngày KH/KT, tiêu chuẩn, số khách, hoa hồng/khách; dự trù **lưu trú** (tìm khách sạn trong NCC lấy giá phòng) và **dịch vụ khác**: SL × số đêm/lượt × đơn giá, VAT (đã gồm 8% / 10% / không VAT); lưu/nhân bản/xóa báo giá; in PDF (bảng tính nội bộ + báo giá khách), Excel |
| 5 | Kế toán | `accounting.js` | Phiếu thu/chi có mã (PT0001/PC0001); tìm theo mã phiếu; bắt buộc chọn TK cá nhân/công ty; in/PDF (có số tiền bằng chữ) |
| 6 | Báo cáo | `reports.js` | Tổng quan, doanh thu, lợi nhuận, dòng tiền, quỹ; lọc theo mốc thời gian; xuất dữ liệu Excel |
| 7 | Hệ thống | `system.js` | Thêm/sửa/ngừng/xóa dịch vụ; tài khoản ngân hàng; thông tin công ty; sao lưu |

## Cập nhật đợt 2 (theo file yêu cầu bổ sung của PM)
| Hạng mục | Đã làm |
|---|---|
| Tổng quan → ô Đơn hàng | Chữ **Xem chi tiết** → hộp thoại các đơn mới (tạo trong tháng; chưa có thì 5 đơn gần nhất), bấm vào đơn để xem chi tiết |
| Khách hàng | Hai loại: **cá nhân** (mã KL01, KL02…: họ tên, giới tính, ngày sinh, ĐT, email, địa chỉ, CCCD/Hộ chiếu) và **doanh nghiệp** (mã DN01…: tên công ty, địa chỉ, ĐT, MST, người liên hệ + SĐT). Có tab lọc theo loại |
| Nhà cung cấp | Thêm **Tiêu chuẩn 1*–5***, **Người liên hệ / Chức vụ / SĐT người liên hệ**; bộ lọc kết hợp Loại hình + Tiêu chuẩn + Tỉnh/thành (VD Lưu trú · 4* · Hà Nội) |
| Tạo đơn hàng | Mã đơn nhập tay (bỏ trống → tự tạo), điểm khởi hành / điểm đến, **VAT** (đã gồm / chưa gồm 8%, 10%), **Người phụ trách** (chọn từ danh sách nhân viên), nội dung dịch vụ in trên PDF |
| Chi tiết đơn hàng | Bấm vào đơn: có dòng **Số tiền đã thu** và ngay dưới là **Số tiền còn lại** |
| PDF đơn hàng | Hiện nội dung dịch vụ (VD “Tour ghép đoàn” → Tour Nhật 5N4Đ (Osaka-Kyoto-Tokyo)), tuyến, VAT, nhân viên phụ trách |
| Báo cáo | Tab mới **Theo nhân viên** (doanh thu, đã thu, còn thu, lợi nhuận; bấm tên để xem từng đơn). Từ danh sách đơn bấm tên “Phụ trách” để nhảy tới báo cáo của người đó |
| Kế toán – phiếu chi | Chọn **Loại chi**: Lương, Thuê nhà, Văn phòng (Điện/Nước/Internet/Văn phòng phẩm), Tiếp khách, Thuế, Chi phí khác (thêm 2 loại: Thanh toán NCC, Chi cho HDV) |
| Hệ thống | Bỏ giá cố định của dịch vụ; tab **Cài đặt** để thêm/xóa **Loại hình dịch vụ** |
| Điều hành tour – dự trù | Tên dịch vụ (loại hình) → Nội dung → NCC (lọc theo loại hình, có ô tìm) → SL → Đơn giá (+VAT đã gồm 8%/10%/không VAT) → Số lượt/đêm → Thành tiền → Tổng chi phí từng dịch vụ → Ghi chú. Thêm Từ ngày/Đến ngày (mặc định theo tour) và Thời hạn thanh toán |
| Booking | Nút **Gửi booking** cạnh tên NCC (mở email); trạng thái Đã gửi / Chưa gửi / **Đã huỷ**; **Thời hạn thanh toán**, và hạn thanh toán phần còn lại khi đã chi một phần; cảnh báo sắp/quá hạn ở chuông thông báo |
| Form booking | Đúng mẫu: Kính gửi NCC → Dịch vụ, Nội dung, Thời gian, SL, Đơn giá, Số đêm/lượt, Tổng tiền, Ghi chú (không có tên khách/tour) |
| Bàn giao tour | Tên khách/đoàn + SĐT, Tuyến, ngày bắt đầu/kết thúc, tài xế, người nhận; bảng NCC–Nội dung–Ngày–SL–Đơn giá–Thành tiền–**Đã chi–Còn phải chi**–Liên hệ–Ghi chú; **Tổng chi phí phải chi cho HDV**; nút **Tạo phiếu chi cho hướng dẫn viên** |

**Quy ước mới:** phải thu của đơn = thành tiền − giảm giá (+ VAT nếu giá *chưa* gồm VAT). Huỷ booking → dòng đó không còn tính vào chi phí dự trù (số đã chi, nếu có, vẫn giữ trong “Đã chi”). Dữ liệu cũ (localStorage/KIO) tự được nâng cấp khi mở, mã khách cũ KH0001… được giữ nguyên; loại hình cũ Khách sạn/HDV/Điểm tham quan đổi thành Lưu trú/Hướng dẫn viên/Vé tham quan. Danh sách loại hình lưu trong bản ghi `config` (không cần thêm bảng KIO).

## Quy ước nghiệp vụ (có thể chỉnh trong code)
- **Tính giá tour:** Tổng chi phí = Σ(SL × số đêm/lượt × đơn giá); Tổng hoa hồng = số khách × hoa hồng/khách; **Giá tour/khách = (Tổng chi phí + Tổng hoa hồng) ÷ số khách** (làm tròn đến đồng). Đơn giá nhập là giá **đã gồm VAT** (nếu chọn 8%/10%), VAT không cộng thêm — hệ thống chỉ tách phần VAT đã bao gồm để tham khảo. Báo giá gửi khách không hiện tổng chi phí và hoa hồng.
- Thành tiền = đơn giá × số lượng; **phải thu = thành tiền − giảm giá/hoa hồng** (nhập theo % hoặc ₫).
- Số khách của tour mặc định = số lượng của đơn, sửa bằng nút bút chì cạnh “… khách” ở đầu trang chi tiết tour.
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
css/login.css         màn hình đăng nhập
css/theme-tnk.css     màu sắc/bố cục theo mẫu (đổi màu chủ đạo ở đây)
js/data.js            kho dữ liệu, dữ liệu mẫu, hàm tính nghiệp vụ (App.Store, App.Calc)
js/core.js            modal, toast, bảng, xuất Excel, in/PDF, router
js/modules/*.js       7 phân hệ + dashboard.js (trang Tổng quan)        js/api/  kio-config.js (tên bảng) · kio-api.js (adapter KIO) · tour-api.js (đồng bộ)   js/auth.js  đăng nhập/phân quyền   js/app.js  khởi động, menu, tìm kiếm Ctrl+K, thông báo
assets/               Font Awesome, Chart.js, SheetJS (chạy offline)
```
Chuyển sang CSDL thật: thay `Store.load()/save()` trong `data.js` bằng gọi API; các phân hệ giữ nguyên.

## Đổi thương hiệu
Tên/logo "TNK" nằm ở `index.html` (khối `.brand`). Màu sidebar: biến `--side-bg`, `--side-bg-2` đầu file `theme-tnk.css`.

## Giao diện điện thoại
Dưới 700px: bảng tự chuyển thành dạng thẻ (mỗi dòng một thẻ, nhãn cột bên trái), thẻ KPI 2 cột, hộp thoại trượt từ dưới lên, ô tìm kiếm nằm hàng riêng. Thanh tab vuốt ngang, không có thanh cuộn.
