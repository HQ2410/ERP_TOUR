# Bộ dữ liệu test Nhà hàng & Cửa hàng

Đây là dữ liệu mô phỏng thực tế để kiểm tra nghiệp vụ Restaurant. Dữ liệu có mã `TEST` riêng và không tự ghi server khi mở trang.

## Thành phần
- 3 chi nhánh: Lê Văn Việt, Phan Xích Long, Dĩ An.
- 11 món/recipe: món chính, combo, đồ uống, tráng miệng.
- 22 đơn hàng: 18 đã thanh toán, 4 đơn Tablet/QR đang chờ POS.
- 30 dòng tồn cửa hàng.
- 46 giao dịch xuất kho phát sinh từ các đơn đã thanh toán.
- 2 yêu cầu bổ sung hàng ở các trạng thái khác nhau.

## Nạp lên server KIO
1. Mở ERP bằng XAMPP/server như bình thường.
2. Nhấn F12 > Console.
3. Chạy:

```js
await RestaurantSalesTestData.seedToServer()
```

Hàm này merge theo ID test và dùng `RestaurantQualityAPI.syncRestaurant(...)`, do đó dữ liệu được ghi vào các bảng `lenam_restaurant_*` trên server. Không xóa dữ liệu Restaurant đang có.

## Các case nên test
1. POS: xem doanh thu và các đơn tại quầy.
2. Tablet/QR: 4 đơn OPEN ngày 18/09/2026 phải xuất hiện ở POS để xử lý.
3. Đơn nhiều món: mở chi tiết đơn Tablet/QR để kiểm tra `items[]`.
4. Thanh toán đơn OPEN: hệ thống phải kiểm tra tồn, trừ theo Recipe và tạo `POS_ISSUE`.
5. Doanh thu: chỉ tính đơn `PAID`, không tính 4 đơn OPEN.
6. Lọc doanh thu theo cửa hàng / ca / kênh.
7. Yêu cầu bổ sung: có case đang REQUESTED và case đã RECEIVED.
8. Thiếu tồn: STORE-TEST-003/SP-005 và STORE-TEST-002/SP-008 được cố ý để thấp.

## Số liệu kỳ vọng trước khi thanh toán 4 đơn OPEN
- Đơn hàng: 22
- Đã thanh toán: 18
- Chờ POS: 4
- Tổng doanh thu từ 18 đơn PAID: 3.587.000đ

Lưu ý: ngưỡng `DB.finishedMinStock` hiện là ngưỡng kho thành phẩm trung tâm và Restaurant đang tái sử dụng nó cho cửa hàng. Vì vậy cảnh báo thiếu tồn có thể cao bất thường. Đây là một logic cần tách thành tồn tối thiểu theo từng cửa hàng trong bước hoàn thiện tiếp theo.
