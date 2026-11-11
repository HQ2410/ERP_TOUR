# Luồng duyệt tối giản

Đã bỏ các bước duyệt thừa trong luồng sản xuất/kho:

- Nhập kho: không có bước duyệt riêng; sau QC đạt thì thực hiện nhập kho.
- Yêu cầu NVL sản xuất: sau KHSX đã duyệt, phiếu chuyển thẳng sang trạng thái Chờ xuất NVL.
- Xuất NVL cho sản xuất: Kho thực hiện Xuất kho trực tiếp, không cần Duyệt YCNVL trước.
- Lệnh sản xuất: tạo ở trạng thái Chờ sản xuất, không cần Duyệt LSX; có thể Bắt đầu sản xuất khi NVL đã cấp.
- Giao hàng: giữ luồng Điều phối -> Bắt đầu chuyến -> Xác nhận giao -> Chốt chuyến; không có bước duyệt.

Các bước duyệt quan trọng khác như KHSX, PR/PO... không thay đổi.


## Luồng PO cập nhật 22/09/2026
PR được Trưởng phòng Mua hàng duyệt -> Báo giá NCC -> Chọn NCC -> Tạo PO (Chờ gửi NCC) -> Gửi NCC -> NCC đang giao -> Kho nhận -> QC -> Nhập kho. PO không duyệt lại.


## Quy tắc phân quyền Mua hàng (22/09/2026)

- Nhân viên **Mua hàng**: tạo/sửa PR khi hợp lệ; sau khi PR được duyệt thì nhập báo giá, chọn NCC, tạo PO, gửi NCC và hủy PO khi PO chưa ở trạng thái không cho phép hủy.
- **Trưởng phòng Mua hàng**: chỉ thực hiện phê duyệt PR cấp 1. Không nhập báo giá, không gửi NCC và không duyệt PO.
- **Ban giám đốc**: chỉ phê duyệt PR cấp 2 khi tổng giá trị PR **>= 50.000.000đ**.
- **PO không có bước duyệt**.

Quy trình WF-PR:
1. Cấp 1 — Trưởng phòng Mua hàng — luôn áp dụng.
2. Cấp 2 — Ban giám đốc — chỉ áp dụng khi PR >= 50.000.000đ.
