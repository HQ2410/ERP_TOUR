# REAL SERVER DATA V2

- KIO / các bảng `lenam_*` là nguồn dữ liệu nghiệp vụ chuẩn.
- Purchase / Inventory / CRM không tự seed hoặc merge dữ liệu demo vào server khi tải màn hình.
- Cache local chỉ là snapshot gần nhất; cache key đã đổi phiên bản để không nạp lại snapshot demo cũ.
- Mỗi route chỉ tải collection cần thiết; lần đăng nhập/F5 đầu tiên force đọc đúng dữ liệu server của route hiện tại.
- Create/Update dùng outbox local tức thời + ghi KIO ngay. Nếu F5 đúng lúc request đang chạy, lần boot sau replay thay đổi đang chờ trước khi refresh server.
- Delete các master/action đã hỗ trợ delete server-first tiếp tục xóa thật trên KIO.
- Production đã tách thành:
  - lenam_production_orders
  - lenam_production_plans
  - lenam_production_material_requests
  - lenam_production_final_inspections
  Dữ liệu singleton Production cũ trong lenam_inventory_settings được migrate một lần nếu các bảng mới chưa có dữ liệu.
- Logistics không tự seed xe/tài xế/demo khi mở hệ thống nữa; chỉ đọc bảng lenam_logistics_*.
