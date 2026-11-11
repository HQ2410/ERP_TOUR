# Lê Nam ERP

Bản gộp ngày 13/10/2026 từ `ERP_LENAM-main (1).zip` và `lenamfn1018.zip`.

## Chạy local

1. Giải nén thư mục `lenam` vào `C:\xampp\htdocs\`.
2. Mở XAMPP và bật Apache.
3. Truy cập `http://localhost/lenam/`.
4. Nhấn Ctrl + F5 sau khi thay mã nguồn để bỏ cache trình duyệt.

Ứng dụng hiện dùng KIO API của công ty để đọc/ghi dữ liệu, không kèm PHP API
hoặc SQL cho MySQL local. Cần kết nối Internet và quyền truy cập server KIO.
Hai thư viện server đang được nạp trong `index.html`:
`https://kio.dvqt.vn/list.js` và `https://kio.dvqt.vn/krud.js`.
Cấu hình kết nối, tên bảng và payload nằm trong `js/api/kio-config.js`,
`js/api/kio-api.js` và các adapter API tương ứng. Nếu báo lỗi thiếu bảng,
cần quản trị viên server kiểm tra hoặc tạo bảng; frontend không tự tạo bảng.

## Cấu trúc chính

- `index.html`: trang vào ứng dụng và thứ tự nạp script.
- `css/`: giao diện.
- `assets/`: thư viện, font, hình ảnh.
- `js/api/`: kết nối và đồng bộ dữ liệu.
- `js/core/`: tiện ích, điều hướng, render và biểu đồ.
- `js/data/`: dữ liệu và công cụ dữ liệu mẫu.
- `js/modules/`: nghiệp vụ và giao diện các phân hệ.
- `js/modules/legacy/`: các module báo giá/danh mục hiện được index.html sử dụng.
- `docs/`: dữ liệu JSON và tài liệu PDF còn giữ lại.

## Những thay đổi được ghép

- Giữ mọi file dùng chung có nội dung giống nhau giữa hai bản.
- Giữ sửa lỗi đồng bộ phê duyệt trong `approvals-api.js` từ GitHub.
- Giữ module nối các luồng phê duyệt `mod-approvals-flows.js` từ GitHub,
  nạp sau `mod-approvals.js` như bản GitHub.
- Giữ chức năng sửa chấm công, kiểm tra quyền và ghi nhật ký từ GitHub.
- BI: giữ tab, biểu đồ Kinh doanh/Nhà hàng/Nhân sự và nút đổi kỳ từ GitHub;
  giữ logic Nhà hàng của lenamfn1018: doanh thu chỉ gồm đơn PAID,
  giá vốn lấy cả nguyên liệu và thành phẩm.
- Kế toán: giữ thanh tab ở màn Thuế của lenamfn1018.
- Tăng phiên bản URL các script vừa gộp để trình duyệt tải mã mới.
- Gom tài liệu Markdown còn một README; xóa các alias JS chỉ khi trùng byte
  với file trong thư mục con và không được index.html nạp.
- Giữ các file JS khác nội dung, dữ liệu JSON, CSV, PDF và tài nguyên khác.

Module phê duyệt bổ sung là phần đã có trong bản GitHub. Luồng mua hàng gốc
và bộ xử lý PR/PO không được viết lại trong lần gộp này.

## Kiểm tra sau khi chạy với server thật

- Đăng nhập bằng các vai trò đang dùng; mở Mua hàng, CRM và Kho.
- Mở BI Kinh doanh, đổi kỳ xem và kiểm tra biểu đồ.
- Mở BI Nhà hàng: đơn chưa thanh toán không được tính vào doanh thu.
- Với tài khoản đủ quyền HR, sửa chấm công rồi tải lại trang.
- Tạo/duyệt yêu cầu, tải lại trang và kiểm tra dữ liệu còn trên KIO.
- Mở Kế toán / Thuế và kiểm tra thanh tab.

Kiểm tra offline chỉ xác nhận cú pháp, đường dẫn tài nguyên và logic ghép
bằng dữ liệu giả lập. Chưa xác nhận các thao tác đọc/ghi trên server KIO thật.


## Sửa lỗi theo ảnh và Excel ngày 19/10/2026

1. Tổng quan: bỏ dải năm chỉ số ở giữa trang theo ảnh 1.
2. Báo giá NCC: badge đếm số PR đã duyệt còn chờ chốt báo giá; bỏ trạng thái Đang báo giá. PR đang nhập giá nhưng chưa chốt vẫn thuộc Chờ báo giá.
3. Việc cần duyệt: chỉ hiển thị yêu cầu hiện hành gắn với chứng từ thật; không tự tạo yêu cầu từ dữ liệu mẫu/cache trước khi nạp PR thật. Giữ lịch sử cũ, không xóa chứng từ trên server.
4. Bộ lọc PO: bỏ ba lựa chọn gộp; giữ từng trạng thái riêng, gồm Nhận hàng một phần.
5. Gửi PO: đọc lại kết quả duyệt hiện hành, đối chiếu dấu vết cấp 2 đã lưu cùng PR. PO chưa đủ duyệt vẫn bị chặn.
6. Kho: ẩn menu con Kiểm kê. Không xóa dữ liệu hay các phiếu kiểm kê cũ.
7. Quản lý kho: bỏ tab Lịch sử nhập xuất; dữ liệu giao dịch vẫn được giữ.
8. Tồn kho: cảnh báo chờ trả NCC dựa trên lượng còn chờ của đúng lô; phần đã trả không còn hiện như đang chờ.
9. Vai trò Kho: xem Đơn đặt hàng trong Mua hàng, không xem Đề nghị mua hàng.
10. Tổng quan sản xuất: màn tổng quan riêng, dùng dữ liệu lệnh/kế hoạch hiện có; danh sách Lệnh sản xuất vẫn ở menu riêng.
11. Bổ sung cửa hàng: hiển thị kho nguồn theo địa điểm và chọn nguyên liệu/thành phẩm của kho đó bằng dropdown có tìm kiếm; tiếp tục qua các bước kho xuất và cửa hàng nhận.

### Duyệt hai cấp

PR dưới 50 triệu: Trưởng phòng Mua hàng duyệt cấp 1 là hoàn tất.
PR từ 50 triệu trở lên: Trưởng phòng duyệt cấp 1, sau đó Giám đốc duyệt cấp 2.
Giám đốc không phải duyệt lại cấp 1. Dấu vết từng cấp được lưu cùng PR và yêu cầu
phê duyệt; tải lại/đổi tài khoản không tạo lại quy trình từ đầu.
Giữ quyền hỗ trợ của quản trị viên.

### Bổ sung nguyên liệu cho cửa hàng

Trong form Yêu cầu bổ sung hàng, kho nguồn được hiển thị theo liên kết của
cửa hàng. Dropdown Hàng hóa cho tìm theo mã/tên và chọn cả nguyên liệu lẫn
thành phẩm thuộc kho nguồn trên cùng phiếu. Kho xuất đúng khu và lô thực tế,
cửa hàng xác nhận nhận để cộng tồn.

### Chạy và kiểm tra

Giải nén vào thư mục mới, chạy qua Apache/XAMPP và nhấn Ctrl+F5.
Nên đăng xuất rồi đăng nhập lại để nạp quyền mới của vai trò Kho.
Không cần xóa dữ liệu server để sử dụng bản sửa này. Không có lệnh xóa
chứng từ lịch sử hoặc di chuyển tồn kho khi chỉ mở trang.

Đã kiểm thử tự động bằng dữ liệu giả lập: nạp toàn bộ script, luồng duyệt
một/hai cấp và ngưỡng 50 triệu, tải lại, gửi PO, dữ liệu cũ, hai phiên làm việc,
request đang đọc trong lúc duyệt, cảnh báo trả NCC, menu/bộ lọc,
và nguyên liệu từ kho nguồn tới tồn cửa hàng. Chưa kiểm thử đọc/ghi trên KIO thật
và chưa xác nhận giao diện bằng trình duyệt thật trong môi trường này.


## Cập nhật phiếu kiểm tra nguyên liệu

Bỏ cột/ô chọn Kết quả. Chỉ nhập SL không đạt/trả cho mỗi nguyên liệu:
- 0 hoặc để trống: toàn bộ số lượng nhập đạt.
- Lớn hơn 0: tự xác định có hàng không đạt, tạo yêu cầu trả cho đúng số lượng này.
- Bằng SL nhập: cả dòng hàng không đạt.
- Số âm, không hợp lệ hoặc vượt SL nhập: chặn lưu, không thay đổi tồn.

Phần đạt vẫn được cộng tồn theo luồng QC hiện tại. Phiếu đã kiểm tra vẫn chỉ xem.
Đã giữ các sửa lỗi trong bản lenam_1910_fixed_20261019.zip.


## Cập nhật yêu cầu bổ sung hàng: kho nguồn theo địa điểm

Form hiển thị tên kho nguồn của cửa hàng (ví dụ Kho Thủ Đức), không yêu cầu
người dùng tách kho nguyên liệu/thành phẩm. Danh sách hàng lấy từ các dòng tồn
thuộc khu nguyên liệu và thành phẩm của đúng kho nguồn, gồm cả dòng có tồn bằng 0.
Có thể gõ mã hoặc tên có/không dấu để lọc, bấm để chọn hoặc dùng phím mũi tên/Enter.
Đổi cửa hàng sẽ cập nhật kho nguồn và bỏ lựa chọn không thuộc kho mới.

Một yêu cầu mới có thể gồm nguyên liệu và thành phẩm. Kho kiểm tra đủ toàn bộ
phần còn thiếu trước khi xuất. Phiếu xuất được tách theo khu thực tế, liên kết
cùng yêu cầu; cửa hàng xác nhận nhận một đợt gồm các dòng hàng đó.
Các yêu cầu cũ tiếp tục lấy đúng khu nguồn đã lưu trước đây.
Giữ nguyên các sửa lỗi duyệt hai cấp và phiếu kiểm tra nguyên liệu ở bản v2.


## Tổng quan chất lượng chi tiết

Thay bảng mẫu cố định bằng dữ liệu IQC từ phiếu nhập mua hàng, PQC từ checkpoint
QC đã đến bước kiểm trong lệnh sản xuất, FQC từ phiếu kiểm thành phẩm, QC gia công
từ đợt nhận hàng của kế hoạch gia công, cùng hồ sơ COA/CAPA/thu hồi trên KIO.
Gia công trong source hiện tại vẫn lưu ở trình duyệt; tổng quan ghi rõ phạm vi này.

Có thống kê công việc hiện tại theo loại, chờ sửa/tái kiểm, CAPA quá hạn, thu hồi
đang mở, kết quả hoàn tất theo ngày kiểm, danh sách cần xử lý và kết quả gần đây.
Mở trực tiếp chứng từ từ tổng quan và cập nhật dữ liệu bằng nút trên đầu trang.

Mỗi phiếu nhập/checkpoint/phiếu FQC/đợt nhận gia công tính một bản ghi; không cộng
nhân đôi lịch sử tái kiểm của cùng checkpoint. Tỷ lệ đạt toàn bộ tính trên số
bản ghi đã hoàn tất, không phải số lượng hàng. Không cộng kg với gói/cái.
Không có kết quả hoàn tất thì tỷ lệ hiện —. Dữ liệu thiếu ngày kiểm không được
gán ngày giả; khi lọc ngày, bản ghi thiếu ngày được loại và có thông báo.

Ngày lọc áp dụng cho kết quả đã hoàn tất; danh sách đang chờ vẫn hiển thị công
việc hiện tại để không bỏ sót yêu cầu cũ. Nguồn không tải được hiển thị cảnh báo
và dấu —, không mặc định là 0. Tổng quan chỉ đọc dữ liệu. Khi lưu IQC mới, ngày
kiểm được lưu theo thời điểm kiểm thực tế thay vì ngày demo DB.today.
Giữ lại các cập nhật IQC và dropdown bổ sung hàng của các bản trước.

### Bản v5 — sửa thao tác thẻ tổng quan chất lượng
- Bỏ dòng thuộc tính điều hướng bị hiện nhầm dưới 6 thẻ công việc.
- Bấm từng thẻ mở đúng tab IQC, PQC, FQC, gia công, CAPA hoặc thu hồi.
- Giữ các chỉnh sửa và nghiệp vụ của bản v4.

### Bản v6 — badge kiểm tra đầu vào
- Badge đếm phiếu nhập từ đơn mua đang chờ kiểm, kể cả phiếu chưa có inspectionStatus.
- Không tính phiếu đã kiểm, đã hủy, phiếu ngoài mua hàng hoặc phiếu trùng mã.
- Badge và danh sách IQC dùng chung nguồn dữ liệu.


## Cập nhật 26/10/2026 — Đợt 1 (Kho): Hạn dùng

- Form Nguyên liệu / Bán thành phẩm / Thành phẩm: thêm **Hạn sử dụng mặc định (ngày)** và **Cảnh báo cận hạn trước (ngày)** (`shelfLifeDays`, `expiryWarnDays`). Trước đây chỉ Thành phẩm có HSD.
- Kho → **Cấu hình hạn dùng** (menu mới): sửa nhanh HSD/ngưỡng cảnh báo cho cả ba loại hàng, lọc theo đã/chưa cấu hình, xem HSD gần nhất đang tồn.
- Tồn kho: thêm cột **HSD gần nhất**; HSD ở lô, chi tiết lô hiện kèm "Còn N ngày / Quá hạn N ngày" theo màu. Hàm dùng chung: `inventoryExpiryInfo`, `inventoryExpiryHtml`.
- HSD mặc định chỉ áp dụng cho lô tạo/nhập sau khi lưu; lô cũ giữ nguyên.
- Chưa kiểm tra đọc/ghi trên KIO thật; cần xác nhận bảng nguyên liệu/BTP lưu được 2 field mới.

## Cập nhật 26/10/2026 — Đợt 1 (Kho + LSX), phần 2

**Kho**
- Hàng lỗi: thêm cột **Phương án xử lý / Ghi chú** + nút *Xử lý* (Chờ xử lý, Tái chế, Hạ cấp/bán giảm giá, Trả NCC, Tiêu hủy, Khác); lưu trên dòng tồn (`defectDisposition`, `defectNote`).
- **Thống kê tồn theo kỳ** (menu Kho): tồn đầu / nhập / xuất / cuối, mặc định 1 ngày, chỉnh khoảng ngày, theo NL / BTP / TP. Tính ngược từ tồn hiện tại và `inventoryTransactions`.
- Kế hoạch SX: nút **Lập KH hàng loạt (dưới hạn mức)** — đề xuất SL = hạn mức − tồn − phần đang trong KH/LSX; vẫn đi qua luồng Kho → duyệt → yêu cầu NVL → LSX.

**LSX**
- Ngưỡng **báo sắp hết hạn** chỉnh được (ô trên danh sách LSX, lưu `inventoryAlertConfig.lsxNearDeadlineDays`, mặc định 3 ngày) — áp dụng cho danh sách, lọc, dashboard, chi tiết.
- **Giờ chi tiết**: bắt đầu/hoàn thành thực tế, thời gian chạy (chi tiết LSX), giờ bắt đầu/kết thúc từng công đoạn (`actualStartedAt`, `actualEndedAt`).
- **Sản lượng thực tế** (user LSX nhập): thiếu/thừa + lý do; số này cập nhật phiếu QC thành phẩm nên phần thừa được QC và nhập kho; Kho thấy "Thực tế (LSX nhập)" ở màn Kế hoạch sản xuất.
- Nút **Hoàn thành toàn bộ công đoạn**: hoàn tất các công đoạn SX còn lại, dừng trước QC bán thành phẩm / QC thành phẩm; công đoạn đầu vẫn bắt buộc Kho đã cấp NVL.
- Chưa kiểm tra đọc/ghi KIO thật và chưa chạy giao diện trên trình duyệt.

## Cập nhật 26/10/2026 — Đợt 2 (QC/QA), phần 1

- **Tự tính đạt/không đạt**: QC đầu vào (hiện "Đạt: N" theo SL không đạt), QC bán thành phẩm và QC thành phẩm (nhập ô nào, ô còn lại = tổng − giá trị vừa nhập).
- **QC xuất kho (OQC)** — luồng xuất bán mới: *Đơn hàng → QC → Kho → Logistics*.
  - Menu mới: Kiểm tra chất lượng → **Kiểm tra xuất kho**. Phiếu `SALES_ISSUE` chờ xác nhận có `qcStatus` (PENDING / PASSED / FAILED), lưu kèm `qcLines`, `qcNote`, `qcHistory`.
  - Kho chỉ được **Xác nhận xuất** khi QC đạt; QC không đạt → Kho xử lý hàng lỗi rồi bấm *Yêu cầu QC kiểm tra lại*.
  - Phiếu chờ xác nhận cũ chưa có `qcStatus` được coi là *Chờ QC*.
  - Đã chặn đường xuất trực tiếp từ CRM (`crm-order-issue-confirm`) vì bỏ qua QC. Phiếu xuất tay của Kho (không gắn đơn) chưa đi qua QC.

## Cập nhật 27/10/2026 — Đợt 2 (QC/QA + Gia công), phần 2: Gia công cho khách

**Định nghĩa mới:** gia công = công ty gia công GIÙM khách hàng; có đủ máy móc, nhân công, quy trình nhưng không có nguyên vật liệu (NVL do khách gửi). Luồng gia công ngoài (gửi NVL cho đối tác) đã bị thay hẳn.

- File mới `js/modules/mod-subcontract-in.js` (nạp cuối cùng trong `index.html`) thay toàn bộ view/action `subcontracting-*`.
- Luồng: Nháp → Duyệt → **Nhận NVL khách gửi** → **QC NVL** → Sản xuất → **QC thành phẩm** → Trả hàng (+ NVL dư/không đạt) → Thu phí → Hoàn tất.
- NVL khách gửi theo dõi riêng trong từng đơn (menu Gia công → *NVL khách gửi*), **không cộng vào tồn kho công ty**.
- Phí gia công = SL thành phẩm đạt QC × đơn giá + phụ phí; ghi nhận thu tiền theo đợt, hoàn tất khi thu đủ và trả hết hàng/NVL.
- Menu: Gia công → Tổng quan / Đơn gia công / NVL khách gửi / Khách hàng gia công. Kiểm tra chất lượng → *Kiểm tra gia công* gom QC NVL và QC thành phẩm (có số đơn chờ). Kho → Kế hoạch gia công chuyển sang xem đơn gia công cho khách.
- QC NVL và QC thành phẩm dùng cách tự tính đạt/không đạt theo chỉ số còn lại.
- Lưu `localStorage` khóa `lenam_gc_customer_v1` (giống cách lưu module gia công cũ, chưa lên KIO). Đơn gia công ngoài cũ không còn hiển thị (dữ liệu cũ vẫn nằm trong khóa `lenam_subcontracting_v2`, không bị xóa).
- Chưa làm: gắn thu phí gia công với Kế toán xác nhận tiền (thuộc đợt Kế toán); chưa đẩy lên server KIO.

## Cập nhật 28/10/2026 — Đợt 3 (Logistics)

- **Khách đã nhận hàng**: khi xác nhận giao, nhập *người nhận* và *thời điểm khách nhận*; hệ thống lưu vào đơn giao (`customerReceiver`, `customerReceivedAt`), đơn bán và phát thông báo "Khách đã nhận hàng".
- **Nhiên liệu đề xuất so với thực tế**: đề xuất = km × định mức xe ÷ 100 (lít), chi phí = lít × đơn giá nhiên liệu (đ/lít, nhớ theo trình duyệt; nếu chưa có thì lấy trung bình các chuyến đã chốt). Bảng so sánh Đề xuất / Thực tế / Chênh lệch tính trực tiếp khi nhập; **lệch quá 10% bắt buộc ghi chú**. Lưu trên đơn: `fuelProposedLiters`, `fuelProposedCost`, `fuelPrice`, `fuelVarianceNote`; chi tiết đơn giao có mục so sánh.
- **Tạo chuyến** (Logistics → Đơn giao hàng → *Tạo chuyến*): tích chọn từ 2 đơn lẻ đã hoàn thành cùng một xe, nhập chung công-tơ-mét đầu/cuối ngày (tự tính tổng km) hoặc tổng km, nhiên liệu, cầu đường, bãi xe, chi phí khác. Km và chi phí phân bổ cho từng đơn theo khối lượng hàng, đơn được chốt; công-tơ-mét xe chỉ cộng phần chênh (không cộng trùng).
- **Đơn lẻ ↔ đơn theo chuyến**: danh sách có nhãn và bộ lọc *Loại đơn*. Chi tiết đơn có *Tách khỏi chuyến* (bắt buộc lý do) và *Chuyển sang đơn theo chuyến* (chọn chuyến cùng xe, nhập lại tổng km/chi phí).
- **Nhật ký chuyến** (`tripHistory` trên từng đơn): mỗi lần vào/rời/phân bổ lại lưu ảnh chụp trạng thái chuyến lúc đó (mã chuyến, các đơn cùng chuyến, km phân bổ, tổng km, chi phí, lý do). Khi một đơn rời chuyến, các đơn còn lại được phân bổ lại và ghi "đơn khác rời chuyến".
- Dữ liệu logistics tiếp tục lưu qua cơ chế KIO/cache sẵn có của module. Chưa kiểm tra trên KIO thật và trình duyệt thật.

## Cập nhật 29/10/2026 — Đợt 4 (Kế toán, Ngân hàng, TSCĐ, Thuế, Hóa đơn)

Mã mới nằm ở `js/modules/mod-accounting-v2.js` (nạp sau `mod-accounting.js`; ghi đè các view cũ). Bảng KIO mới trong `kio-config.js`: `revenuePeriods`, `vatReturns`, `invoices`.

**Tài sản cố định & khấu hao**
- Form có *Ngày bắt đầu sử dụng*, *Thời hạn sử dụng (năm, bước 0,5)*, *Ngày kết thúc khấu hao* (tự tính), *Máy gắn với công đoạn* và *Giờ chạy chuẩn/tháng*. Tài sản cũ không có ngày bắt đầu dùng ngày mua.
- Khấu hao đường thẳng theo Thông tư 45/2013/TT-BTC: mức tháng = nguyên giá ÷ (năm × 12), **tháng đầu tính theo số ngày** từ ngày bắt đầu sử dụng; khấu hao đủ nguyên giá vào ngày kết thúc (= ngày bắt đầu + thời hạn − 1 ngày). Hỗ trợ `disposedDate` để dừng khấu hao.
- Màn TSCĐ hiện KH tháng, lũy kế, còn lại, số tháng còn lại, trạng thái (chưa đưa vào sử dụng / đang khấu hao / đã hết), chọn ngày tính, **bảng khấu hao từng tháng** (xuất CSV). `AccFin.assetBookValue/assetAccumDep` (bảng cân đối, v.v.) dùng engine mới.
- Chưa đưa khấu hao vào P&L (hiện P&L chưa có dòng khấu hao); cần xác nhận cách hạch toán trước.

**Ngân hàng**: thêm *Sao kê theo khoảng thời gian* (mặc định tháng hiện tại): tồn đầu, thu, chi, tồn cuối từng tài khoản và tổng, danh sách giao dịch kèm số dư sau giao dịch, xuất CSV.

**Kế toán xác nhận đã nhận tiền**
- Khoản thu khách hàng do người **không có quyền kế toán** ghi nhận → `confirmStatus = PENDING`: chưa tính vào đã thu, chưa vào dòng tiền, chưa ghi ngân hàng; đơn hàng vẫn còn công nợ. Kế toán (`ACCOUNTING_OPERATE`) ghi nhận thì xác nhận ngay.
- Công nợ phải thu có khối *Chờ kế toán xác nhận đã nhận tiền*: **Xác nhận đã nhận** (ngày tiền về thực tế, tài khoản nhận, số tham chiếu, cảnh báo trùng tham chiếu; ghi sổ ngân hàng đúng ngày) hoặc **Từ chối** kèm lý do. Lỗi lưu → hoàn tác. Menu hiện số khoản chờ xác nhận. Dữ liệu cũ (chưa có `confirmStatus`) coi là đã xác nhận.

**Doanh thu theo kỳ** (menu mới): chọn ngày/tháng/quý/năm/tùy chọn → doanh thu đầu kỳ (lũy kế từ đầu năm), phát sinh, cuối kỳ, thay đổi so với kỳ trước (tháng trước/quý trước/năm trước theo lịch) và cùng kỳ năm trước. *Chốt kỳ* lưu bản chụp (kỳ chưa kết thúc = chốt tạm); báo **lệch** nếu đơn hàng thay đổi sau khi chốt; chốt lại giữ lịch sử.

**Giá thành**: NVL + nhân công + **khấu hao máy móc thiết bị** + chi phí chung. Khấu hao/giờ máy = KH tháng của TSCĐ gắn với máy ÷ giờ chạy chuẩn/tháng (chỉ khi đang khấu hao). Cơ sở *Định mức* hoặc *Giờ máy thực tế* (điều chỉnh theo giờ ghi ở công đoạn LSX). Cảnh báo máy chưa gắn TSCĐ.

**Thuế GTGT** (menu Thuế): *Tờ khai 01/GTGT* theo chỉ tiêu [21]–[43] (kỳ tháng/quý), tính từ đơn bán, đơn mua và sổ hóa đơn; ô nhập tay [22], [37], [38], [39], [40b], [42]; **[22] tự lấy [43] của tờ khai kỳ trước đã lưu**; lưu nháp/chốt/mở lại; in/PDF, CSV. *Bảng kê bán ra / mua vào* (PL 01-1, 01-2). Thuế suất 8% (NQ 204/2025/QH15, NĐ 174/2025/NĐ-CP, đến hết 31/12/2026) khai trong dòng 10% kèm khối *phụ lục giảm thuế*. Thuế đầu vào của đơn mua ≥ 5 triệu thanh toán tiền mặt bị loại khỏi [25] (kế toán có thể xác nhận ngược lại). Tab *Chi tiết theo hàng hóa* giữ view cũ.

**Hóa đơn** (menu mới + nút *Hóa đơn (PDF)* ở chi tiết đơn hàng): lập bản thể hiện hóa đơn GTGT bán ra từ đơn (MST/địa chỉ khách, ký hiệu mẫu số/ký hiệu/số do hệ thống HĐĐT cấp, mã CQT nếu có, thuế suất từng dòng, số tiền bằng chữ, chữ ký, watermark *bản nháp*), **Tải PDF** hoặc **In**; nhập *hóa đơn mua vào* cho từng PO. Nội dung theo Nghị định 254/2026/NĐ-CP, Thông tư 91/2026/TT-BTC. **PDF là bản thể hiện, không thay thế hóa đơn điện tử đã ký số/có mã CQT trên hệ thống HĐĐT.**

Lưu ý kỹ thuật: tải PDF trực tiếp dùng thư viện html2pdf nạp từ cdnjs (nếu không tải được sẽ mở hộp thoại in để *Lưu dưới dạng PDF*). Công thức/biểu mẫu tờ khai tham khảo từ các nguồn thứ cấp; cần đối chiếu mẫu 01/GTGT hiện hành (Thông tư 89/2026/TT-BTC) trước khi nộp.

## Cập nhật 30/10/2026 — Đợt 5 (Nhân sự – Công lương theo file quy trình)

Mã mới: `js/modules/hr-payroll-engine.js` (bộ máy tính công–lương, thuần logic, có kiểm thử) và `js/modules/mod-hr-payroll.js` (giao diện + lưu trữ). Bảng KIO mới (`hrTables`): `payrollConfig`, `timesheets`, `dayStats`, `payrollRuns`. Menu Nhân sự có thêm: *Bảng công ngày*, *Thống kê chuyến / tấn*, *Hiệu quả lao động*, *Hồ sơ lương*, *Cấu hình lương*; *Tính lương* được thay bằng bảng lương mới.

**Cấu hình lương** (mặc định lấy từ file): 19 ca làm việc (có ca qua đêm) gán theo bộ phận; 17 nhóm thang lương/bậc (đơn giá ngày; bảo vệ khoán 8.000.000/30 ngày; thời vụ 230.809); chuyên cần 500.000, thâm niên (4.180 / 4.807 / 5.434 × 26 × số năm), trách nhiệm theo chức vụ, bằng cấp (ĐH 1.000.000, CĐ/TC 500.000); hệ số tăng ca; công tài xế/giao hàng A/B/C (300.000/250.000/200.000), KPI không rớt đơn (28% / 22% trên 400.000); bảo hiểm, công đoàn, thuế TNCN; ngày lễ; bộ phận.

**Hồ sơ lương**: bộ phận làm việc, mã chấm công MTACO, nhóm/bậc, loại lương (ngày/tài xế/bốc xếp/khoán/thời vụ), phụ cấp, bảo hiểm, đoàn viên, người phụ thuộc, cách tính thuế, **trạng thái làm việc có lịch sử**.

**Bảng công ngày**: nhập giờ vào/ra từ máy MTACO (CSV/Excel; mỗi lần quẹt 1 dòng hoặc cột vào/ra; ghép cả ca qua đêm, gộp quẹt trùng), nhập công "X" dạng ma trận, sửa tay từng ngày. Ca gán theo giờ vào; tính công, công lẻ (về giữa ca), tăng ca 1.2/1.4, Chủ nhật, ngày lễ, ca đêm. Trang **Kiểm tra chấm công** liệt kê: có giờ nhưng chưa có công X, có công X nhưng thiếu giờ, thiếu giờ vào/ra, không gán được ca.

**Thống kê chuyến/tấn**: số đơn, chuyến, tấn, loại công A/B/C theo ngày; nạp tự động từ đơn giao Logistics (liên kết qua *Mã tài xế bên Logistics*); nhập CSV.

**Bảng lương**: các cột theo file (công, công dôi, hiếu hỉ, về giữa ca, tăng ca 1.2/1.4/CN/lễ, phép năm, trách nhiệm, thưởng hoàn thành, nhà ở, xăng, điện thoại, thâm niên, tiền cơm, bồi dưỡng đêm, chuyên cần, bằng cấp, KPI) → tổng thu nhập → trừ BHXH/BHYT/BHTN, công đoàn, thuế TNCN, trừ KPI, truy thu bảo hiểm → thực lãnh. Nhóm theo bộ phận + tab tổng hợp theo bộ phận; điều chỉnh tháng; **chốt bảng lương** (lưu bản chụp cả cấu hình, mở lại được); phiếu lương (in/PDF, in hàng loạt); CSV. Bảo hiểm 8% + 1,5% + 1% trên mức lương đóng (trần 20 lần mức tham chiếu 2.340.000 / lương tối thiểu vùng 5.310.000); thuế TNCN biểu 5 bậc 5/10/20/30/35%, giảm trừ 15,5 và 6,2 triệu; thời vụ khấu trừ 10%; phần tăng ca vượt đơn giá thường được miễn thuế.

**Hiệu quả lao động**: giờ làm thực tế, tăng ca, đi trễ/về sớm, chuyên cần, sản lượng LSX do nhân viên phụ trách, sản lượng/giờ, đơn/ngày, tấn/giờ.

**Điểm file chưa nêu rõ — đang là giả định, chỉnh trong Cấu hình lương:** tăng ca 1.2 vs 1.4 (2 giờ đầu 1.2, còn lại 1.4); hệ số Chủ nhật 200% / lễ 300% (BLLĐ 2019); công dôi = công vượt 26 ngày × hệ số 1; chuyên cần mất khi nghỉ trên 1,5 ngày (ngày phép năm tính là nghỉ); thâm niên bậc cao áp cho toàn bộ số năm; KPI 400K tính theo tháng; **đơn giá bồi dưỡng đêm, đơn giá bốc xếp/tấn, ngưỡng số đơn cho công A/B/C = 0 (chưa có trong file)**; trợ cấp tiền cơm/hiếu hỉ chịu thuế trừ khi tick miễn; trễ/về sớm ≤ 30 phút vẫn đủ 1 công. Các điểm "13, 14, 15" trong mục chuyên cần của file chưa hiểu rõ nên chưa áp dụng.
Excel (.xlsx) đọc bằng thư viện SheetJS nạp từ cdnjs (cần mạng); nếu lỗi, lưu file sang CSV. Chưa thử với KIO thật và trình duyệt thật.

## Cập nhật 31/10/2026 — Đợt 6 (Báo giá NCC, công đoạn mới, ngày giờ CRM)

**Báo giá nhà cung cấp — so sánh theo nhiều tiêu chí** (`mod-purchase-compare.js`, gắn vào màn Mua hàng → Báo giá của từng đề nghị mua):
- Ngoài giá, bảng so sánh có thêm: thời gian giao hàng, điều khoản thanh toán (tạm ứng %, công nợ ngày), chất lượng 1–5, chứng nhận ISO/HACCP/ATTP, bảo hành/đổi trả, vận chuyển (bên mua hay NCC chịu, chi phí), độ phủ mặt hàng và **lịch sử giao hàng của NCC tự tính** từ PO và phiếu nhập kho (đúng hạn, đủ hàng).
- Mỗi tiêu chí chấm 0–100, tổng điểm có trọng số (mặc định giá 35, giao hàng 15, độ phủ 10, thanh toán 10, chất lượng 10, lịch sử 10, chứng nhận 5, bảo hành 3, vận chuyển 2; chỉnh được, lưu KIO `lenam_purchase_compare_config`). Tiêu chí chưa có dữ liệu không bị trừ điểm nhưng được báo "thiếu".
- Có nút **Chọn NCC điểm cao nhất**; nếu chọn NCC khác đề xuất, bắt buộc ghi **lý do**. Khi xác nhận, tiêu chí, điểm, hạng, trọng số và lý do được ghi vào từng báo giá NCC (`criteria`, `score`, `rank`, `compareWeights`, `selectionReason`); sau xác nhận bảng chỉ xem. Tiêu chí nhập tay được lưu nháp cho đến khi xác nhận.

**Thêm công đoạn mới hoàn toàn** (`mod-production-ops.js`, Sản xuất → Công đoạn): khối *Quản lý công đoạn* với nút *Thêm công đoạn mới* (tên, phân xưởng có sẵn hoặc **phân xưởng mới**, máy, ĐVT, đơn giá, tổ trưởng, ghi chú; mã CD-NN tự cấp), sửa, xóa. Chặn trùng tên trong phân xưởng, chặn xóa công đoạn đang dùng trong Routing sản phẩm; công đoạn có sẵn chỉ sửa. Trước đây danh mục công đoạn không được lưu — nay lưu KIO (`lenam_production_operations`) + localStorage nên còn sau khi tải lại. Phân xưởng mới có cột riêng ở bảng tiến độ LSX; công đoạn mới dùng được ngay trong BOM/Routing.

**CRM — ngày giờ chi tiết** (`mod-datetime-v6.js` + chỉnh `mod-crm-sales.js`, `mod-orders.js`, `app.js`, `mod-inventory.js`):
- Đơn hàng bán: ô *Ngày giờ đặt hàng* (datetime-local) lúc tạo/sửa, lưu `orderedAt` (ISO) song song `date` (các báo cáo cũ không đổi); danh sách, chi tiết, timeline hiển thị ngày giờ.
- **Lịch sử trạng thái sản phẩm** trong chi tiết đơn: từng lần sản phẩm đổi trạng thái kèm ngày giờ — đặt hàng, duyệt, LSX (tạo/duyệt/cấp NVL/bắt đầu/QC/hoàn thành), nhập kho, QC xuất kho, xuất kho, xe giao, giao thành công, khách nhận hàng. Giao dịch kho nay ghi `createdAt`; phiếu xuất ghi `confirmedAt`; lịch sử giao dịch kho hiện giờ. Dữ liệu cũ chưa có giờ vẫn hiện theo ngày.
