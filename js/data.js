/* ============================================================================
 * data.js — Kho dữ liệu (localStorage) + dữ liệu mẫu + các hàm tính nghiệp vụ
 *
 * Toàn bộ đọc/ghi dữ liệu đi qua App.Store. Muốn chuyển sang API/CSDL thật
 * chỉ cần thay phần load()/save() bên dưới, các module giao diện không đổi.
 * ==========================================================================*/
(function () {
  'use strict';
  const App = (window.App = window.App || { mod: {} });
  const KEY = 'tourerp.data.v1';

  // Loại hình dịch vụ (cũng là loại hình của nhà cung cấp) — danh sách này chỉnh được ở Hệ thống → Cài đặt.
  const STAY = 'Lưu trú';
  const DEFAULT_SERVICE_TYPES = ['Lưu trú', 'Vận chuyển', 'Nhà hàng', 'Hướng dẫn viên', 'Vé tham quan', 'Hàng không'];
  // Tên cũ (bản trước) → tên mới. Chỉ đổi khi danh sách loại hình KHÔNG có sẵn tên cũ (xem migrate).
  const TYPE_ALIAS = { 'Khách sạn': 'Lưu trú', 'HDV': 'Hướng dẫn viên', 'Điểm tham quan': 'Vé tham quan' };
  const BASE_TONE = { 'Lưu trú': 'indigo', 'Nhà hàng': 'orange', 'Vận chuyển': 'teal', 'Hàng không': 'blue', 'Hướng dẫn viên': 'green', 'Vé tham quan': 'slate' };
  const TONE_POOL = ['indigo', 'teal', 'orange', 'blue', 'green', 'slate'];
  const typeTone = t => BASE_TONE[t] || TONE_POOL[Array.from(String(t || '')).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % TONE_POOL.length];
  const STANDARDS = ['1*', '2*', '3*', '4*', '5*'];
  const GENDERS = ['Nam', 'Nữ', 'Khác'];
  // Thuế VAT trên đơn hàng (giá đã gồm / chưa gồm VAT) và trên dòng dự trù (đã gồm / không VAT)
  const VAT_ORDER = {
    none: { label: 'Không VAT', rate: 0, mode: '' },
    inc8: { label: 'Giá đã bao gồm VAT 8%', rate: 0.08, mode: 'inc' }, inc10: { label: 'Giá đã bao gồm VAT 10%', rate: 0.10, mode: 'inc' },
    exc8: { label: 'Giá chưa bao gồm VAT 8%', rate: 0.08, mode: 'exc' }, exc10: { label: 'Giá chưa bao gồm VAT 10%', rate: 0.10, mode: 'exc' }
  };
  const VAT_LINE = { none: { label: 'Không VAT', rate: 0 }, inc8: { label: 'Đã bao gồm VAT 8%', rate: 0.08 }, inc10: { label: 'Đã bao gồm VAT 10%', rate: 0.10 } };
  // Loại chi khi lập phiếu chi
  const EXPENSE_TYPES = [
    { k: 'ncc', l: 'Thanh toán nhà cung cấp (dịch vụ tour)' }, { k: 'hdv', l: 'Chi cho hướng dẫn viên (bàn giao tour)' },
    { k: 'luong', l: 'Lương' }, { k: 'thuenha', l: 'Thuê nhà' }, { k: 'vanphong', l: 'Văn phòng' },
    { k: 'tiepkhach', l: 'Tiếp khách' }, { k: 'thue', l: 'Thuế' }, { k: 'khac', l: 'Chi phí khác' }
  ];
  const OFFICE_ITEMS = ['Điện', 'Nước', 'Internet', 'Văn phòng phẩm'];
  const SERVICE_GROUPS = ['Tour trọn gói', 'Vé máy bay', 'Khách sạn', 'Visa', 'Vận chuyển', 'Vé tham quan', 'Dịch vụ khác'];
  const ACCOUNT_KINDS = { company: 'Tài khoản công ty', personal: 'Tài khoản cá nhân' };
  const TOUR_STATUS = {
    dieuhanh: { label: 'Đang điều hành', tone: 'blue' },
    banggiao: { label: 'Đã bàn giao', tone: 'orange' },
    quyettoan: { label: 'Đã quyết toán', tone: 'green' }
  };
  // Danh sách tỉnh/thành gợi ý (34 đơn vị hành chính cấp tỉnh sau sáp nhập 2025) — vẫn cho nhập tự do.
  const PROVINCES = ['Hà Nội', 'TP. Hồ Chí Minh', 'Hải Phòng', 'Đà Nẵng', 'Cần Thơ', 'Huế', 'Tuyên Quang', 'Lào Cai',
    'Thái Nguyên', 'Phú Thọ', 'Bắc Ninh', 'Hưng Yên', 'Ninh Bình', 'Quảng Trị', 'Quảng Ngãi', 'Gia Lai', 'Khánh Hòa',
    'Lâm Đồng', 'Đắk Lắk', 'Đồng Nai', 'Tây Ninh', 'Vĩnh Long', 'Đồng Tháp', 'Cà Mau', 'An Giang', 'Cao Bằng',
    'Lạng Sơn', 'Điện Biên', 'Lai Châu', 'Sơn La', 'Quảng Ninh', 'Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Nước ngoài'];

  function blank() {
    return {
      version: 1,
      seq: {},
      settings: {
        company: { name: 'CÔNG TY TNHH DU LỊCH & LỮ HÀNH MẪU', address: '123 Đường Mẫu, Quận 1, TP. Hồ Chí Minh',
          phone: '028 3822 0000', email: 'info@dulichmau.example', taxCode: '0300000000', representative: 'Nguyễn Văn A' },
        mailApi: '',
        serviceTypes: DEFAULT_SERVICE_TYPES.slice(),
        services: [], accounts: []
      },
      customers: [], orders: [], suppliers: [], tours: [], vouchers: [], quotes: []
    };
  }

  /* ------------------------------------------------------------ DỮ LIỆU MẪU */
  const CUSTOMER_DEFAULTS = { type: 'personal', gender: '', birthDate: '', email: '', cccd: '', taxCode: '', contactName: '', contactPhone: '' };
  const SUPPLIER_DEFAULTS = { standard: '', contactName: '', contactRole: '', contactPhone: '' };
  const ORDER_DEFAULTS = { vat: 'none', departure: '', destination: '', content: '', ownerId: '', ownerName: '' };
  const shiftDay = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  function seed() {
    const s = blank();
    s.settings.services = [
      { id: 'DV01', name: 'Tour Đà Nẵng - Hội An 4N3Đ', group: 'Tour trọn gói', unit: 'khách', active: true },
      { id: 'DV02', name: 'Tour Phú Quốc 3N2Đ', group: 'Tour trọn gói', unit: 'khách', active: true },
      { id: 'DV03', name: 'Tour Hà Nội - Sapa - Hạ Long 5N4Đ', group: 'Tour trọn gói', unit: 'khách', active: true },
      { id: 'DV04', name: 'Tour Nhật Bản (Tokyo - Osaka) 6N5Đ', group: 'Tour trọn gói', unit: 'khách', active: true },
      { id: 'DV05', name: 'Vé máy bay nội địa', group: 'Vé máy bay', unit: 'vé', active: true },
      { id: 'DV06', name: 'Dịch vụ làm Visa', group: 'Visa', unit: 'hồ sơ', active: true },
      { id: 'DV07', name: 'Thuê xe du lịch 29 chỗ (ngày)', group: 'Vận chuyển', unit: 'ngày', active: true },
      { id: 'DV08', name: 'Tour ghép đoàn', group: 'Tour trọn gói', unit: 'khách', active: true }
    ];
    s.settings.accounts = [
      { id: 'TK01', kind: 'company', bank: 'Vietcombank', number: '0071000123456', holder: 'CÔNG TY TNHH DU LỊCH & LỮ HÀNH MẪU', opening: 150000000 },
      { id: 'TK02', kind: 'company', bank: 'Techcombank', number: '19031234567890', holder: 'CÔNG TY TNHH DU LỊCH & LỮ HÀNH MẪU', opening: 50000000 },
      { id: 'TK03', kind: 'personal', bank: 'MB Bank', number: '0123456789012', holder: 'NGUYEN VAN A', opening: 20000000 }
    ];
    const cust = o => Object.assign({}, CUSTOMER_DEFAULTS, o);
    s.customers = [
      cust({ id: 'KL01', name: 'Nguyễn Thị Lan', gender: 'Nữ', birthDate: '1985-03-12', phone: '0903123456', email: 'lan.nguyen@example.com', cccd: '079185001234', address: '25 Lê Lợi, Quận 1, TP. Hồ Chí Minh' }),
      cust({ id: 'DN01', type: 'business', name: 'Công ty TNHH Thương mại Phát Đạt', phone: '0283822777', taxCode: '0312345678', contactName: 'Nguyễn Hữu Phát', contactPhone: '0903777888', address: '88 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh' }),
      cust({ id: 'KL02', name: 'Trần Quốc Bảo', gender: 'Nam', birthDate: '1978-07-02', phone: '0912345678', cccd: '001078005678', address: '14 Hàng Bài, Hoàn Kiếm, Hà Nội' }),
      cust({ id: 'KL03', name: 'Lê Hoàng Yến', gender: 'Nữ', birthDate: '1990-11-25', phone: '0938765432', email: 'yen.le@example.com', cccd: '079190009876', address: '56 Phan Xích Long, Phú Nhuận, TP. Hồ Chí Minh' }),
      cust({ id: 'KL04', name: 'Phạm Minh Tuấn', gender: 'Nam', birthDate: '1993-05-18', phone: '0977001122', cccd: '048093004321', address: '102 Bạch Đằng, Hải Châu, Đà Nẵng' }),
      cust({ id: 'KL05', name: 'Võ Thị Hương', gender: 'Nữ', birthDate: '1982-09-09', phone: '0966554433', cccd: '075182007654', address: '7 Nguyễn Ái Quốc, Biên Hòa, Đồng Nai' }),
      cust({ id: 'KL06', name: 'Đặng Văn Khoa', gender: 'Nam', birthDate: '1975-01-30', phone: '0944112233', cccd: '079075003210', address: '39 Cách Mạng Tháng 8, Quận 3, TP. Hồ Chí Minh' }),
      cust({ id: 'KL07', name: 'Hoàng Thu Trang', gender: 'Nữ', birthDate: '1996-12-04', phone: '0355667788', address: '21 Trần Phú, Nha Trang, Khánh Hòa' }),
      cust({ id: 'DN02', type: 'business', name: 'Công ty CP Sự kiện & Truyền thông Hòa Bình', phone: '0243976555', taxCode: '0108765432', contactName: 'Lê Thanh Hòa', contactPhone: '0987654321', address: '15 Láng Hạ, Ba Đình, Hà Nội' })
    ];
    const sup = o => Object.assign({}, SUPPLIER_DEFAULTS, o);
    s.suppliers = [
      sup({ id: 'NCC001', name: 'Nhà hàng Biển Xanh', address: '12 Võ Nguyên Giáp, Sơn Trà', province: 'Đà Nẵng', phone: '02363888111', email: 'bienxanh@example.com', type: 'Nhà hàng', price: 180000, contactName: 'Lê Văn Hải', contactRole: 'Quản lý nhà hàng', contactPhone: '0905888111' }),
      sup({ id: 'NCC002', name: 'Khách sạn Sơn Trà Riverside', address: '45 Bạch Đằng, Hải Châu', province: 'Đà Nẵng', phone: '02363777222', email: 'booking@sontra-riverside.example', type: 'Lưu trú', standard: '4*', price: 700000, contactName: 'Trần Thị Mai', contactRole: 'Trưởng phòng kinh doanh', contactPhone: '0905777222' }),
      sup({ id: 'NCC003', name: 'Vận tải Du lịch Hải Vân', address: '9 Nguyễn Văn Linh, Thanh Khê', province: 'Đà Nẵng', phone: '0905111222', email: 'dieuxe@haivan.example', type: 'Vận chuyển', price: 3200000, contactName: 'Phan Văn Tài', contactRole: 'Điều hành xe', contactPhone: '0905111222' }),
      sup({ id: 'NCC004', name: 'Khu du lịch Đồi Mây (vé tham quan)', address: 'Hòa Vang', province: 'Đà Nẵng', phone: '02363666333', email: 've@doimay.example', type: 'Vé tham quan', price: 900000 }),
      sup({ id: 'NCC005', name: 'HDV Trần Minh Khoa', address: 'Sơn Trà', province: 'Đà Nẵng', phone: '0912888999', email: 'khoa.hdv@example.com', type: 'Hướng dẫn viên', price: 800000, contactName: 'Trần Minh Khoa', contactRole: 'Hướng dẫn viên', contactPhone: '0912888999' }),
      sup({ id: 'NCC006', name: 'Đại lý vé Đại Việt Air', address: '66 Hai Bà Trưng, Quận 1', province: 'TP. Hồ Chí Minh', phone: '02838221234', email: 've@daivietair.example', type: 'Hàng không', price: 1650000, contactName: 'Ngô Thị Thu', contactRole: 'Nhân viên bán vé', contactPhone: '0908221234' }),
      sup({ id: 'NCC007', name: 'Resort Dương Đông', address: 'Dương Đông, Phú Quốc', province: 'An Giang', phone: '02973999000', email: 'sales@duongdong-resort.example', type: 'Lưu trú', standard: '5*', price: 1200000, contactName: 'Hồ Ngọc Anh', contactRole: 'Giám đốc kinh doanh', contactPhone: '0919999000' }),
      sup({ id: 'NCC008', name: 'Nhà hàng Hải Sản Ông Lang', address: 'Ông Lang, Phú Quốc', province: 'An Giang', phone: '0297388777', email: 'datban@onglang.example', type: 'Nhà hàng', price: 250000 }),
      sup({ id: 'NCC009', name: 'Khách sạn Sapa Mountain View', address: 'Cầu Mây, Sa Pa', province: 'Lào Cai', phone: '02143888444', email: 'reservation@sapamv.example', type: 'Lưu trú', standard: '3*', price: 950000, contactName: 'Giàng A Páo', contactRole: 'Lễ tân trưởng', contactPhone: '0914888444' }),
      sup({ id: 'NCC010', name: 'Vận tải Tây Bắc Express', address: '3 Hoàng Liên, Lào Cai', province: 'Lào Cai', phone: '0914222333', email: 'xe@taybac-express.example', type: 'Vận chuyển', price: 4000000 }),
      sup({ id: 'NCC011', name: 'Xe đưa đón Phú Quốc Tiện Lợi', address: 'Dương Tơ, Phú Quốc', province: 'An Giang', phone: '0919333444', email: 'xe@pqtienloi.example', type: 'Vận chuyển', price: 2500000 }),
      sup({ id: 'NCC012', name: 'Du thuyền Hạ Long Bay Star', address: 'Bãi Cháy, Hạ Long', province: 'Quảng Ninh', phone: '02033888555', email: 'sales@baystar.example', type: 'Lưu trú', standard: '5*', price: 2200000, contactName: 'Vũ Quang Huy', contactRole: 'Quản lý đặt chỗ', contactPhone: '0903888555' }),
      sup({ id: 'NCC013', name: 'HDV Phạm Thu Hà', address: 'Sa Pa', province: 'Lào Cai', phone: '0987111222', email: 'ha.hdv@example.com', type: 'Hướng dẫn viên', price: 900000 }),
      sup({ id: 'NCC014', name: 'Đại lý vé quốc tế Phương Đông', address: '15 Nguyễn Thị Minh Khai, Quận 3', province: 'TP. Hồ Chí Minh', phone: '02839301111', email: 'quocte@phuongdong.example', type: 'Hàng không', price: 12500000 }),
      sup({ id: 'NCC015', name: 'Đối tác Land Tour Nhật Bản', address: 'Tokyo, Japan', province: 'Nước ngoài', phone: '+81312345678', email: 'ops@landjp.example', type: 'Vận chuyển', price: 13500000 }),
      sup({ id: 'NCC016', name: 'HDV Lê Hoàng Nam', address: 'Quận 7', province: 'TP. Hồ Chí Minh', phone: '0903555666', email: 'nam.hdv@example.com', type: 'Hướng dẫn viên', price: 1200000 }),
      sup({ id: 'NCC017', name: 'Khách sạn Đà Lạt Sunrise 5*', address: 'Phường Xuân Hương, Đà Lạt', province: 'Lâm Đồng', phone: '02633822111', email: 'sales@dalatsunrise.example', type: 'Lưu trú', standard: '5*', price: 1850000 }),
      sup({ id: 'NCC018', name: 'Khách sạn Đà Lạt Hoa Mai 4*', address: 'Phường Lâm Viên, Đà Lạt', province: 'Lâm Đồng', phone: '02633822222', email: 'booking@dalathoamai.example', type: 'Lưu trú', standard: '4*', price: 1200000 }),
      sup({ id: 'NCC019', name: 'Nhà hàng Đà Lạt Phố Núi', address: 'Đường Phan Đình Phùng, Đà Lạt', province: 'Lâm Đồng', phone: '02633822333', email: 'datban@phonui.example', type: 'Nhà hàng', price: 220000 }),
      sup({ id: 'NCC020', name: 'Xe du lịch Đà Lạt Xanh', address: 'Đường 3/4, Đà Lạt', province: 'Lâm Đồng', phone: '0918222333', email: 'xe@dalatxanh.example', type: 'Vận chuyển', price: 3500000 }),
      sup({ id: 'NCC021', name: 'Khách sạn Hồ Tây Lakeview', address: '12 Quảng An, Tây Hồ', province: 'Hà Nội', phone: '02438281111', email: 'sales@hotaylakeview.example', type: 'Lưu trú', standard: '4*', price: 1500000, contactName: 'Đỗ Thị Hà', contactRole: 'Sales Manager', contactPhone: '0904281111' }),
      sup({ id: 'NCC022', name: 'Khách sạn Phố Cổ Heritage', address: '28 Hàng Bạc, Hoàn Kiếm', province: 'Hà Nội', phone: '02439361122', email: 'booking@phocoheritage.example', type: 'Lưu trú', standard: '4*', price: 1300000, contactName: 'Nguyễn Minh Đức', contactRole: 'Lễ tân trưởng', contactPhone: '0904361122' }),
      sup({ id: 'NCC023', name: 'Khách sạn Thăng Long Grand', address: '1 Lê Thái Tổ, Hoàn Kiếm', province: 'Hà Nội', phone: '02438255555', email: 'reservation@thanglonggrand.example', type: 'Lưu trú', standard: '5*', price: 2600000, contactName: 'Bùi Thu Phương', contactRole: 'Giám đốc kinh doanh', contactPhone: '0904255555' }),
      sup({ id: 'NCC024', name: 'Khách sạn Hà Thành Mini', address: '5 Tạ Hiện, Hoàn Kiếm', province: 'Hà Nội', phone: '02439260033', email: 'info@hathanhmini.example', type: 'Lưu trú', standard: '3*', price: 650000 })
    ];

    // --- đơn hàng + tour điều hành + dự trù + phiếu
    let lineSeq = 0, bkSeq = 0, ptSeq = 0, pcSeq = 0;
    const line = (supplierId, type, service, qty, times, price, vat) => ({ id: 'L' + String(++lineSeq).padStart(3, '0'), supplierId, type, service, qty, times, price, vat: vat || 'none', from: '', to: '', payDue: '', remainDue: '', cancelled: false, note: '' });
    const svc = id => s.settings.services.find(x => x.id === id);
    const OWNER = { ownerId: 'U001', ownerName: 'Admin' };
    const order = (id, customerId, serviceId, start, end, qty, discountValue, discountUnit, date, price, extra) => {
      const sv = svc(serviceId);
      s.orders.push(Object.assign({ id, customerId, serviceId, serviceName: sv.name, start, end, price, qty, discountValue, discountUnit, date, note: '' }, ORDER_DEFAULTS, OWNER, extra));
    };
    const tour = (orderId, status, lines, extra) => {
      const o = s.orders.find(x => x.id === orderId);
      lines.forEach(l => { l.from = o.start; l.to = o.end; l.payDue = shiftDay(o.start, -2); });
      const t = Object.assign({ id: orderId, orderId, guests: o.qty, status, budget: lines, bookings: [], handover: null, settlement: null }, extra || {});
      s.tours.push(t); return t;
    };
    const booking = (t, supplierId, lineIds, sentAt) => {
      const sp = s.suppliers.find(x => x.id === supplierId);
      t.bookings.push({ id: 'BK' + String(++bkSeq).padStart(3, '0'), supplierId, to: sp.email, subject: 'Booking dịch vụ - ' + s.settings.company.name, lineIds, sentAt, via: 'mailto', note: '' });
    };
    const voucher = (kind, date, accountId, amount, party, content, link, expenseType) => {
      const n = kind === 'thu' ? ++ptSeq : ++pcSeq;
      s.vouchers.push(Object.assign({ id: (kind === 'thu' ? 'PT' : 'PC') + String(n).padStart(4, '0'), kind, date, accountId, amount, party, content,
        orderId: '', tourId: '', lineId: '', supplierId: '' }, kind === 'chi' ? { expenseType: expenseType || 'ncc', expenseSub: '' } : {}, link || {}));
    };
    const paySupplier = (t, ln, date, accountId, amount) => {
      const sp = s.suppliers.find(x => x.id === ln.supplierId);
      voucher('chi', date, accountId, amount, sp.name, 'Thanh toán ' + ln.service + ' - Tour ' + t.id, { tourId: t.id, lineId: ln.id, supplierId: sp.id, orderId: t.id });
    };
    const custName = id => s.customers.find(c => c.id === id).name;

    // DH0001 — đã quyết toán
    order('DH0001', 'KL01', 'DV01', '2026-09-12', '2026-09-15', 10, 5, 'percent', '2026-08-20', 5500000,
      { departure: 'TP. Hồ Chí Minh', destination: 'Đà Nẵng - Hội An', content: 'Tour Đà Nẵng - Hội An 4N3Đ: Bà Nà Hills, phố cổ Hội An, bán đảo Sơn Trà' });
    const t1 = tour('DH0001', 'quyettoan', [
      line('NCC002', 'Lưu trú', 'Khách sạn 3 đêm (5 phòng)', 5, 3, 700000, 'inc10'), line('NCC003', 'Vận chuyển', 'Xe 29 chỗ (4 ngày)', 1, 4, 3200000),
      line('NCC001', 'Nhà hàng', 'Ăn chính (10 khách × 6 bữa)', 10, 6, 180000, 'inc8'), line('NCC004', 'Vé tham quan', 'Vé tham quan Đồi Mây', 10, 1, 900000), line('NCC005', 'Hướng dẫn viên', 'Hướng dẫn viên 4 ngày', 1, 4, 800000)]);
    voucher('thu', '2026-08-22', 'TK01', 26000000, custName('KL01'), 'Thu cọc đơn DH0001', { orderId: 'DH0001' });
    voucher('thu', '2026-09-10', 'TK01', 26250000, custName('KL01'), 'Thu nốt đơn DH0001', { orderId: 'DH0001' });
    t1.budget.forEach(l => booking(t1, l.supplierId, [l.id], '2026-09-01T09:30:00'));
    paySupplier(t1, t1.budget[0], '2026-09-16', 'TK01', 10500000); paySupplier(t1, t1.budget[1], '2026-09-16', 'TK01', 12800000);
    paySupplier(t1, t1.budget[2], '2026-09-16', 'TK02', 10800000); paySupplier(t1, t1.budget[3], '2026-09-12', 'TK02', 9000000);
    paySupplier(t1, t1.budget[4], '2026-09-16', 'TK03', 3200000);
    t1.handover = { date: '2026-09-11', receiver: 'Trần Minh Khoa', phone: '0912888999', driverName: 'Phan Văn Tài', driverPhone: '0905111222', note: 'Đã giao danh sách đoàn và voucher dịch vụ.' };
    t1.settlement = { date: '2026-09-25', revenue: 52250000, cost: 46300000, collected: 52250000, paid: 46300000, profit: 5950000 };

    // DH0002 — đã bàn giao, đã kết thúc (khách doanh nghiệp)
    order('DH0002', 'DN01', 'DV02', '2026-10-02', '2026-10-04', 20, 0, 'amount', '2026-09-05', 5200000,
      { vat: 'inc8', departure: 'TP. Hồ Chí Minh', destination: 'Phú Quốc', content: 'Tour Phú Quốc 3N2Đ cho đoàn công ty: VinWonders, câu cá, lặn ngắm san hô' });
    const t2 = tour('DH0002', 'banggiao', [
      line('NCC007', 'Lưu trú', 'Resort 2 đêm (10 phòng)', 10, 2, 1200000, 'inc10'), line('NCC008', 'Nhà hàng', 'Ăn chính (20 khách × 4 bữa)', 20, 4, 250000, 'inc8'),
      line('NCC006', 'Hàng không', 'Vé máy bay khứ hồi', 20, 1, 1650000), line('NCC005', 'Hướng dẫn viên', 'Hướng dẫn viên 3 ngày', 1, 3, 800000), line('NCC011', 'Vận chuyển', 'Xe đưa đón sân bay (3 chuyến)', 1, 3, 2500000)]);
    t2.budget[1].remainDue = '2026-10-04';
    voucher('thu', '2026-09-06', 'TK01', 50000000, custName('DN01'), 'Thu cọc đơn DH0002', { orderId: 'DH0002' });
    voucher('thu', '2026-09-28', 'TK01', 54000000, custName('DN01'), 'Thu nốt đơn DH0002', { orderId: 'DH0002' });
    [0, 1, 2, 3, 4].forEach(i => booking(t2, t2.budget[i].supplierId, [t2.budget[i].id], '2026-09-07T10:00:00'));
    paySupplier(t2, t2.budget[0], '2026-09-10', 'TK01', 24000000); paySupplier(t2, t2.budget[2], '2026-09-12', 'TK02', 33000000);
    paySupplier(t2, t2.budget[1], '2026-10-02', 'TK02', 10000000);
    t2.handover = { date: '2026-10-01', receiver: 'Trần Minh Khoa', phone: '0912888999', driverName: 'Nguyễn Văn Sáu', driverPhone: '0919333444', note: 'Bàn giao danh sách phòng và lịch ăn.' };

    // DH0003 — đang điều hành, sắp khởi hành
    order('DH0003', 'KL02', 'DV03', '2026-10-20', '2026-10-24', 8, 2000000, 'amount', '2026-10-01', 7800000,
      { vat: 'inc10', departure: 'Hà Nội', destination: 'Sapa - Hạ Long', content: 'Tour Hà Nội - Sapa - Hạ Long 5N4Đ, trọn gói xe, khách sạn, du thuyền' });
    const t3 = tour('DH0003', 'dieuhanh', [
      line('NCC009', 'Lưu trú', 'Khách sạn Sapa 3 đêm (4 phòng)', 4, 3, 950000, 'inc10'), line('NCC010', 'Vận chuyển', 'Xe 29 chỗ Hà Nội - Sapa - Hạ Long', 1, 5, 4000000),
      line('NCC012', 'Lưu trú', 'Du thuyền Hạ Long 1 đêm', 8, 1, 2200000, 'inc10'), line('NCC013', 'Hướng dẫn viên', 'Hướng dẫn viên 5 ngày', 1, 5, 900000)]);
    t3.budget[0].remainDue = '2026-10-19';
    voucher('thu', '2026-10-02', 'TK01', 20000000, custName('KL02'), 'Thu cọc đơn DH0003', { orderId: 'DH0003' });
    booking(t3, 'NCC009', [t3.budget[0].id], '2026-10-04T14:20:00'); booking(t3, 'NCC010', [t3.budget[1].id], '2026-10-04T14:25:00');
    paySupplier(t3, t3.budget[0], '2026-10-05', 'TK01', 5000000);

    // DH0004 — Nhật Bản, tour ghép đoàn
    order('DH0004', 'KL03', 'DV08', '2026-11-15', '2026-11-20', 12, 3, 'percent', '2026-10-05', 32000000,
      { departure: 'TP. Hồ Chí Minh', destination: 'Nhật Bản', content: 'Tour Nhật 6N5Đ (Tokyo - Osaka - Kyoto)' });
    const t4 = tour('DH0004', 'dieuhanh', [
      line('NCC014', 'Hàng không', 'Vé máy bay quốc tế khứ hồi', 12, 1, 12500000), line('NCC015', 'Vận chuyển', 'Land tour Tokyo - Osaka - Kyoto (khách sạn, xe, ăn)', 12, 1, 13500000),
      line('NCC016', 'Hướng dẫn viên', 'Hướng dẫn viên suốt tuyến (6 ngày)', 1, 6, 1200000)]);
    voucher('thu', '2026-10-06', 'TK01', 120000000, custName('KL03'), 'Thu cọc đơn DH0004', { orderId: 'DH0004' });

    // DH0005 — vé máy bay
    order('DH0005', 'KL04', 'DV05', '2026-10-25', '2026-10-25', 4, 0, 'amount', '2026-10-10', 1800000,
      { departure: 'TP. Hồ Chí Minh', destination: 'Hà Nội', content: 'Vé máy bay nội địa SGN - HAN (1 chiều)' });
    tour('DH0005', 'dieuhanh', [line('NCC006', 'Hàng không', 'Vé máy bay SGN - HAN', 4, 1, 1650000)]);
    voucher('thu', '2026-10-10', 'TK02', 7200000, custName('KL04'), 'Thu đủ đơn DH0005', { orderId: 'DH0005' });

    // DH0006 — mới tạo, chưa dự trù, giá chưa gồm VAT 10%
    order('DH0006', 'KL05', 'DV02', '2026-12-05', '2026-12-07', 6, 5, 'percent', '2026-10-12', 5200000,
      { vat: 'exc10', departure: 'TP. Hồ Chí Minh', destination: 'Phú Quốc', content: 'Tour Phú Quốc 3N2Đ' });
    tour('DH0006', 'dieuhanh', []);

    // phiếu lẻ
    voucher('thu', '2026-10-08', 'TK03', 2000000, 'Đại lý Minh Phát', 'Thu hoa hồng giới thiệu khách');
    voucher('chi', '2026-09-30', 'TK03', 3000000, 'Nguyễn Văn A', 'Chi phí tiếp khách đối tác', null, 'tiepkhach');
    voucher('chi', '2026-10-05', 'TK01', 25000000, 'Nhân viên văn phòng', 'Chi lương tháng 9/2026', null, 'luong');
    voucher('chi', '2026-10-06', 'TK01', 1850000, 'Công ty Điện lực', 'Tiền điện văn phòng tháng 9/2026', { expenseSub: 'Điện' }, 'vanphong');

    s.quotes = [{
      id: 'BG0001', route: 'Đà Lạt', duration: '3N2Đ', start: '2026-11-20', end: '2026-11-22', standard: '5*', guests: 20, commission: 200000, note: 'Giá đã gồm ăn sáng; chưa gồm vé tham quan ngoài chương trình.',
      lines: [
        { type: 'stay', name: 'Khách sạn Đà Lạt Sunrise 5*', supplierId: 'NCC017', qty: 10, times: 2, price: 1850000, vat: 'inc10' },
        { type: 'other', name: 'Nhà hàng Đà Lạt Phố Núi', supplierId: 'NCC019', qty: 20, times: 5, price: 220000, vat: 'inc8' },
        { type: 'other', name: 'Xe du lịch Đà Lạt Xanh', supplierId: 'NCC020', qty: 1, times: 3, price: 3500000, vat: 'none' }
      ], createdAt: '2026-10-12T09:00:00', updatedAt: '2026-10-12T09:00:00'
    }];
    s.seq = { KL: 7, DN: 2, DH: 6, NCC: 24, DV: 8, TK: 3, PT: ptSeq, PC: pcSeq, L: lineSeq, BK: bkSeq, BG: 1 };
    return s;
  }

  /* --------------------------------------------------------------- MIGRATE */
  // Nâng cấp dữ liệu cũ (từ localStorage hoặc KIO) lên cấu trúc mới. Idempotent: chỉ điền trường còn thiếu,
  // nên chạy lại nhiều lần / trên nhiều máy đều cho cùng kết quả (không tạo thay đổi giả khi đồng bộ).
  const BIZ_RE = /^(công ty|cty|tnhh|doanh nghiệp|dn |cổ phần|tập đoàn|chi nhánh)/i;
  function migrate(st) {
    if (!st) return st;
    st.settings = st.settings || {};
    const cfg = st.settings;
    if (!Array.isArray(cfg.serviceTypes) || !cfg.serviceTypes.length) cfg.serviceTypes = DEFAULT_SERVICE_TYPES.slice();
    const types = cfg.serviceTypes;
    const mapType = t => (TYPE_ALIAS[t] && !types.includes(t)) ? TYPE_ALIAS[t] : t;
    const fill = (o, d) => { Object.keys(d).forEach(k => { if (o[k] === undefined) o[k] = d[k]; }); };
    (st.suppliers || []).forEach(sp => {
      fill(sp, SUPPLIER_DEFAULTS);
      sp.type = mapType(sp.type);
      if (sp.type && !types.includes(sp.type)) types.push(sp.type);
    });
    (st.customers || []).forEach(c => {
      if (c.type === undefined) c.type = BIZ_RE.test(String(c.name || '').trim()) ? 'business' : 'personal';
      fill(c, CUSTOMER_DEFAULTS);
    });
    (st.orders || []).forEach(o => fill(o, ORDER_DEFAULTS));
    (st.tours || []).forEach(t => {
      const o = (st.orders || []).find(x => x.id === t.orderId) || {};
      (t.budget || []).forEach(l => {
        const sp = (st.suppliers || []).find(x => x.id === l.supplierId);
        if (l.type === undefined) l.type = (sp && sp.type) || 'Khác';
        else l.type = mapType(l.type);
        fill(l, { times: 1, vat: 'none', from: o.start || '', to: o.end || '', payDue: '', remainDue: '', cancelled: false });
      });
    });
    (st.vouchers || []).forEach(v => {
      if (v.kind !== 'chi') return;
      if (v.expenseType === undefined) v.expenseType = v.lineId ? 'ncc' : 'khac';
      if (v.expenseSub === undefined) v.expenseSub = '';
    });
    return st;
  }

  /* ------------------------------------------------------------------ STORE */
  // Số lớn nhất đang dùng của một loại mã (để sinh mã tiếp theo không trùng, kể cả khi nhiều người cùng làm việc)
  function maxExisting(st, key) {
    const nums = (arr, pre) => arr.map(x => String(x.id)).filter(id => id.startsWith(pre) && /^\d+$/.test(id.slice(pre.length))).map(id => Number(id.slice(pre.length)));
    let a = [];
    switch (key) {
      case 'KH': a = nums(st.customers, 'KH'); break;
      case 'KL': a = nums(st.customers, 'KL'); break;
      case 'DN': a = nums(st.customers, 'DN'); break;
      case 'DH': a = nums(st.orders, 'DH'); break;
      case 'NCC': a = nums(st.suppliers, 'NCC'); break;
      case 'DV': a = nums(st.settings.services, 'DV'); break;
      case 'TK': a = nums(st.settings.accounts, 'TK'); break;
      case 'PT': case 'PC': a = nums(st.vouchers, key); break;
      case 'BG': a = nums(st.quotes || [], 'BG'); break;
      case 'L': st.tours.forEach(t => { a = a.concat(nums(t.budget, 'L')); }); break;
      case 'BK': st.tours.forEach(t => { a = a.concat(nums(t.bookings, 'BK')); }); break;
    }
    return a.length ? Math.max.apply(null, a) : 0;
  }

  const Store = {
    state: null,
    makeSeed: seed,
    load() {
      let s = null;
      try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { s = null; }
      if (!s || !s.version) { s = seed(); this.state = s; this.persist(); }
      if (!s.quotes) s.quotes = [];
      migrate(s);
      this.state = s;
    },
    migrate() { migrate(this.state); },
    // persist: chỉ ghi bản lưu trên trình duyệt. save: ghi + báo cho TourAPI đẩy thay đổi lên KIO.
    persist() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { console.warn('Không lưu được dữ liệu', e); } },
    save() { this.persist(); if (App.TourAPI) App.TourAPI.touch(); },
    useSeed() { this.state = seed(); this.persist(); },
    useBlank() { this.state = seed(); this.clear(true); },
    reset() { this.state = seed(); this.save(); if (App.TourAPI) App.TourAPI.requestReplace('Quản trị viên nạp lại dữ liệu mẫu'); },
    clear(silent) {
      const b = blank(); const keep = this.state.settings;
      b.settings.company = keep.company; b.settings.mailApi = keep.mailApi; b.settings.serviceTypes = (keep.serviceTypes || DEFAULT_SERVICE_TYPES).slice();
      b.settings.services = keep.services; b.settings.accounts = keep.accounts.map(a => Object.assign({}, a));
      b.seq = { DV: keep.services.length, TK: keep.accounts.length };
      this.state = b;
      if (silent) { this.persist(); return; }
      this.save(); if (App.TourAPI) App.TourAPI.requestReplace('Quản trị viên xóa toàn bộ dữ liệu nghiệp vụ');
    },
    replace(obj) {
      if (!obj || !obj.version || !obj.settings) throw new Error('File sao lưu không hợp lệ');
      if (!obj.quotes) obj.quotes = [];
      migrate(obj);
      this.state = obj; this.save(); if (App.TourAPI) App.TourAPI.requestReplace('Quản trị viên khôi phục dữ liệu từ file sao lưu');
    },
    peekId(key, width) { return key + String(Math.max((this.state.seq || {})[key] || 0, maxExisting(this.state, key)) + 1).padStart(width, '0'); },
    nextId(key, width) {
      const q = this.state.seq || (this.state.seq = {});
      const n = Math.max(q[key] || 0, maxExisting(this.state, key)) + 1; q[key] = n;
      return key + String(n).padStart(width, '0');
    }
  };

  /* ---------------------------------------------------------------- NGHIỆP VỤ */
  const S = () => Store.state;
  const sum = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);
  const C = {
    customer: id => S().customers.find(c => c.id === id),
    supplier: id => S().suppliers.find(c => c.id === id),
    order: id => S().orders.find(c => c.id === id),
    tour: id => S().tours.find(c => c.id === id),
    account: id => S().settings.accounts.find(c => c.id === id),
    voucher: id => S().vouchers.find(c => c.id === id),
    service: id => S().settings.services.find(c => c.id === id),

    gross: o => (Number(o.price) || 0) * (Number(o.qty) || 0),
    discount(o) {
      const g = C.gross(o), v = Number(o.discountValue) || 0;
      const d = o.discountUnit === 'percent' ? Math.round(g * v / 100) : v;
      return Math.min(Math.max(d, 0), g);
    },
    // Thuế VAT của đơn: 'exc' (giá chưa gồm VAT) → VAT cộng thêm vào số khách phải trả; 'inc' (đã gồm) → chỉ tách ra để tham khảo.
    vatCfg: o => VAT_ORDER[o.vat] || VAT_ORDER.none,
    net: o => C.gross(o) - C.discount(o),
    vat(o) {
      const c = C.vatCfg(o), n = C.net(o);
      if (c.mode === 'exc') return Math.round(n * c.rate);
      if (c.mode === 'inc') return Math.round(n * c.rate / (1 + c.rate));
      return 0;
    },
    total: o => C.net(o) + (C.vatCfg(o).mode === 'exc' ? C.vat(o) : 0),
    ownerName(o) {
      if (!o.ownerId) return o.ownerName || '';
      const u = App.Auth && App.Auth.users ? App.Auth.users().find(x => x.id === o.ownerId) : null;
      return (u && u.name) || o.ownerName || '';
    },
    orderRoute: o => [o.departure, o.destination].filter(Boolean).join(' → '),
    isBusiness: c => !!c && c.type === 'business',
    // Số điện thoại để liên hệ: doanh nghiệp ưu tiên số người liên hệ
    contactPhone: c => !c ? '' : (c.type === 'business' ? (c.contactPhone || c.phone) : c.phone) || '',
    birthLabel(c) { if (c && c.birthDate) { const p = c.birthDate.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; } return (c && c.birthYear) ? String(c.birthYear) : ''; },
    orderPaid: id => sum(S().vouchers.filter(v => v.kind === 'thu' && v.orderId === id), v => v.amount),
    orderRemain: o => Math.max(0, C.total(o) - C.orderPaid(o.id)),
    orderStatus(o) {
      const paid = C.orderPaid(o.id), t = C.total(o);
      if (paid <= 0) return { key: 'none', label: 'Chưa thu', tone: 'red' };
      if (paid >= t) return { key: 'full', label: 'Đã thu đủ', tone: 'green' };
      return { key: 'part', label: 'Thu một phần', tone: 'orange' };
    },
    customerRevenue: id => sum(S().orders.filter(o => o.customerId === id), C.total),

    // Thành tiền = số lượng × đơn giá × số lượt/đêm. Dòng đã huỷ booking không còn tính vào chi phí dự trù.
    lineGross: l => (Number(l.qty) || 0) * (Number(l.price) || 0) * (l.times === undefined || l.times === '' ? 1 : (Number(l.times) || 0)),
    lineAmount: l => l.cancelled ? 0 : C.lineGross(l),
    lineVat(l) { const r = (VAT_LINE[l.vat] || VAT_LINE.none).rate; return r ? Math.round(C.lineAmount(l) * r / (1 + r)) : 0; },
    tourCost: t => sum(t.budget, C.lineAmount),
    linePaid: (tourId, lineId) => sum(S().vouchers.filter(v => v.kind === 'chi' && v.tourId === tourId && v.lineId === lineId), v => v.amount),
    lineRemain: (t, l) => Math.max(0, C.lineAmount(l) - C.linePaid(t.id, l.id)),
    lineStatus(t, l) {
      const p = C.linePaid(t.id, l.id), a = C.lineAmount(l);
      if (l.cancelled) return p > 0 ? { label: 'Đã huỷ · đã chi ' + p.toLocaleString('vi-VN') + ' ₫', tone: 'orange' } : { label: 'Đã huỷ', tone: 'slate' };
      if (p <= 0) return { label: 'Chưa chi', tone: 'red' };
      if (p >= a) return { label: 'Đã chi đủ', tone: 'green' };
      return { label: 'Chi một phần', tone: 'orange' };
    },
    lineBooked: (t, l) => t.bookings.some(b => b.lineIds.includes(l.id)),
    // Trạng thái booking của dòng dự trù: cancelled (đã huỷ) | sent (đã gửi) | none (chưa gửi)
    bookingState: (t, l) => l.cancelled ? 'cancelled' : (C.lineBooked(t, l) ? 'sent' : 'none'),
    // Thời hạn thanh toán: nếu đã chi một phần thì dùng hạn của phần còn lại.
    lineDue(t, l) {
      const today = new Date(), iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      if (l.cancelled) return { kind: 'cancelled', due: '', remain: 0, overdue: false };
      const a = C.lineAmount(l), p = C.linePaid(t.id, l.id), remain = Math.max(0, a - p);
      if (a > 0 && remain <= 0) return { kind: 'paid', due: '', remain: 0, overdue: false };
      const partial = p > 0, due = partial ? (l.remainDue || l.payDue || '') : (l.payDue || '');
      return { kind: partial ? 'partial' : 'unpaid', due, remain, overdue: !!due && due < iso };
    },
    guideAdvanced: t => sum(S().vouchers.filter(v => v.kind === 'chi' && v.tourId === t.id && v.expenseType === 'hdv'), v => v.amount),
    // Tổng còn phải chi theo các dòng dự trù (số HDV cần cầm theo khi nhận bàn giao tour)
    tourLinesPayable: t => sum(t.budget, l => C.lineRemain(t, l)),
    expenseLabel(v) {
      if (!v || v.kind !== 'chi') return '';
      const e = EXPENSE_TYPES.find(x => x.k === v.expenseType);
      return e ? (e.l + (v.expenseSub ? ' · ' + v.expenseSub : '')) : '';
    },
    tourPaidOut: t => sum(S().vouchers.filter(v => v.kind === 'chi' && v.tourId === t.id), v => v.amount),
    tourSummary(t) {
      const o = C.order(t.orderId);
      const revenue = o ? C.total(o) : 0, collected = o ? C.orderPaid(o.id) : 0;
      const cost = C.tourCost(t), paid = C.tourPaidOut(t);
      return { revenue, collected, receivable: Math.max(0, revenue - collected), cost, paid, payable: Math.max(0, cost - paid),
        planProfit: revenue - cost, realProfit: collected - paid };
    },
    accountFlow(accId, from, to) {
      const vs = S().vouchers.filter(v => v.accountId === accId);
      const inR = v => (!from || v.date >= from) && (!to || v.date <= to);
      const before = from ? vs.filter(v => v.date < from) : [];
      const acc = C.account(accId) || { opening: 0 };
      const net = arr => sum(arr, v => (v.kind === 'thu' ? 1 : -1) * v.amount);
      const inRange = vs.filter(inR);
      const thu = sum(inRange.filter(v => v.kind === 'thu'), v => v.amount);
      const chi = sum(inRange.filter(v => v.kind === 'chi'), v => v.amount);
      const open = (Number(acc.opening) || 0) + net(before);
      return { open, thu, chi, close: open + thu - chi };
    },
    accountBalance: accId => C.accountFlow(accId, '', '').close,
    voucherLinkLabel(v) {
      if (v.tourId) return 'Tour ' + v.tourId;
      if (v.orderId) return 'Đơn ' + v.orderId;
      return '';
    }
  };

  App.Store = Store; App.Calc = C; App.sum = sum;
  App.CONST = {
    STAY, STANDARDS, GENDERS, VAT_ORDER, VAT_LINE, EXPENSE_TYPES, OFFICE_ITEMS, DEFAULT_SERVICE_TYPES,
    SERVICE_GROUPS, ACCOUNT_KINDS, TOUR_STATUS, PROVINCES,
    serviceTypes: () => (Store.state && Store.state.settings && Store.state.settings.serviceTypes) || DEFAULT_SERVICE_TYPES,
    tone: typeTone
  };
  Store.load();
})();
