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

  const SUPPLIER_TYPES = ['Nhà hàng', 'Khách sạn', 'Vận chuyển', 'Hàng không', 'HDV', 'Điểm tham quan'];
  const SUPPLIER_TONE = {
    'Nhà hàng': 'orange', 'Khách sạn': 'indigo', 'Vận chuyển': 'teal',
    'Hàng không': 'blue', 'HDV': 'green', 'Điểm tham quan': 'slate'
  };
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
        services: [], accounts: []
      },
      customers: [], orders: [], suppliers: [], tours: [], vouchers: []
    };
  }

  /* ------------------------------------------------------------ DỮ LIỆU MẪU */
  function seed() {
    const s = blank();
    s.settings.services = [
      { id: 'DV01', name: 'Tour Đà Nẵng - Hội An 4N3Đ', group: 'Tour trọn gói', unit: 'khách', price: 5500000, active: true },
      { id: 'DV02', name: 'Tour Phú Quốc 3N2Đ', group: 'Tour trọn gói', unit: 'khách', price: 5200000, active: true },
      { id: 'DV03', name: 'Tour Hà Nội - Sapa - Hạ Long 5N4Đ', group: 'Tour trọn gói', unit: 'khách', price: 7800000, active: true },
      { id: 'DV04', name: 'Tour Nhật Bản (Tokyo - Osaka) 6N5Đ', group: 'Tour trọn gói', unit: 'khách', price: 32000000, active: true },
      { id: 'DV05', name: 'Vé máy bay nội địa', group: 'Vé máy bay', unit: 'vé', price: 1800000, active: true },
      { id: 'DV06', name: 'Dịch vụ làm Visa', group: 'Visa', unit: 'hồ sơ', price: 2500000, active: true },
      { id: 'DV07', name: 'Thuê xe du lịch 29 chỗ (ngày)', group: 'Vận chuyển', unit: 'ngày', price: 3800000, active: true }
    ];
    s.settings.accounts = [
      { id: 'TK01', kind: 'company', bank: 'Vietcombank', number: '0071000123456', holder: 'CÔNG TY TNHH DU LỊCH & LỮ HÀNH MẪU', opening: 150000000 },
      { id: 'TK02', kind: 'company', bank: 'Techcombank', number: '19031234567890', holder: 'CÔNG TY TNHH DU LỊCH & LỮ HÀNH MẪU', opening: 50000000 },
      { id: 'TK03', kind: 'personal', bank: 'MB Bank', number: '0123456789012', holder: 'NGUYEN VAN A', opening: 20000000 }
    ];
    s.customers = [
      { id: 'KH0001', name: 'Nguyễn Thị Lan', birthYear: 1985, phone: '0903123456', cccd: '079185001234', address: '25 Lê Lợi, Quận 1, TP. Hồ Chí Minh' },
      { id: 'KH0002', name: 'Công ty TNHH Thương mại Phát Đạt', birthYear: null, phone: '0283822777', cccd: '', address: '88 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh' },
      { id: 'KH0003', name: 'Trần Quốc Bảo', birthYear: 1978, phone: '0912345678', cccd: '001078005678', address: '14 Hàng Bài, Hoàn Kiếm, Hà Nội' },
      { id: 'KH0004', name: 'Lê Hoàng Yến', birthYear: 1990, phone: '0938765432', cccd: '079190009876', address: '56 Phan Xích Long, Phú Nhuận, TP. Hồ Chí Minh' },
      { id: 'KH0005', name: 'Phạm Minh Tuấn', birthYear: 1993, phone: '0977001122', cccd: '048093004321', address: '102 Bạch Đằng, Hải Châu, Đà Nẵng' },
      { id: 'KH0006', name: 'Võ Thị Hương', birthYear: 1982, phone: '0966554433', cccd: '075182007654', address: '7 Nguyễn Ái Quốc, Biên Hòa, Đồng Nai' },
      { id: 'KH0007', name: 'Đặng Văn Khoa', birthYear: 1975, phone: '0944112233', cccd: '079075003210', address: '39 Cách Mạng Tháng 8, Quận 3, TP. Hồ Chí Minh' },
      { id: 'KH0008', name: 'Hoàng Thu Trang', birthYear: 1996, phone: '0355667788', cccd: '', address: '21 Trần Phú, Nha Trang, Khánh Hòa' }
    ];
    s.suppliers = [
      { id: 'NCC001', name: 'Nhà hàng Biển Xanh', address: '12 Võ Nguyên Giáp, Sơn Trà', province: 'Đà Nẵng', phone: '02363888111', email: 'bienxanh@example.com', type: 'Nhà hàng', price: 180000 },
      { id: 'NCC002', name: 'Khách sạn Sơn Trà Riverside', address: '45 Bạch Đằng, Hải Châu', province: 'Đà Nẵng', phone: '02363777222', email: 'booking@sontra-riverside.example', type: 'Khách sạn', price: 700000 },
      { id: 'NCC003', name: 'Vận tải Du lịch Hải Vân', address: '9 Nguyễn Văn Linh, Thanh Khê', province: 'Đà Nẵng', phone: '0905111222', email: 'dieuxe@haivan.example', type: 'Vận chuyển', price: 3200000 },
      { id: 'NCC004', name: 'Khu du lịch Đồi Mây (vé tham quan)', address: 'Hòa Vang', province: 'Đà Nẵng', phone: '02363666333', email: 've@doimay.example', type: 'Điểm tham quan', price: 900000 },
      { id: 'NCC005', name: 'HDV Trần Minh Khoa', address: 'Sơn Trà', province: 'Đà Nẵng', phone: '0912888999', email: 'khoa.hdv@example.com', type: 'HDV', price: 800000 },
      { id: 'NCC006', name: 'Đại lý vé Đại Việt Air', address: '66 Hai Bà Trưng, Quận 1', province: 'TP. Hồ Chí Minh', phone: '02838221234', email: 've@daivietair.example', type: 'Hàng không', price: 1650000 },
      { id: 'NCC007', name: 'Resort Dương Đông', address: 'Dương Đông, Phú Quốc', province: 'An Giang', phone: '02973999000', email: 'sales@duongdong-resort.example', type: 'Khách sạn', price: 1200000 },
      { id: 'NCC008', name: 'Nhà hàng Hải Sản Ông Lang', address: 'Ông Lang, Phú Quốc', province: 'An Giang', phone: '0297388777', email: 'datban@onglang.example', type: 'Nhà hàng', price: 250000 },
      { id: 'NCC009', name: 'Khách sạn Sapa Mountain View', address: 'Cầu Mây, Sa Pa', province: 'Lào Cai', phone: '02143888444', email: 'reservation@sapamv.example', type: 'Khách sạn', price: 950000 },
      { id: 'NCC010', name: 'Vận tải Tây Bắc Express', address: '3 Hoàng Liên, Lào Cai', province: 'Lào Cai', phone: '0914222333', email: 'xe@taybac-express.example', type: 'Vận chuyển', price: 4000000 },
      { id: 'NCC011', name: 'Xe đưa đón Phú Quốc Tiện Lợi', address: 'Dương Tơ, Phú Quốc', province: 'An Giang', phone: '0919333444', email: 'xe@pqtienloi.example', type: 'Vận chuyển', price: 2500000 },
      { id: 'NCC012', name: 'Du thuyền Hạ Long Bay Star', address: 'Bãi Cháy, Hạ Long', province: 'Quảng Ninh', phone: '02033888555', email: 'sales@baystar.example', type: 'Khách sạn', price: 2200000 },
      { id: 'NCC013', name: 'HDV Phạm Thu Hà', address: 'Sa Pa', province: 'Lào Cai', phone: '0987111222', email: 'ha.hdv@example.com', type: 'HDV', price: 900000 },
      { id: 'NCC014', name: 'Đại lý vé quốc tế Phương Đông', address: '15 Nguyễn Thị Minh Khai, Quận 3', province: 'TP. Hồ Chí Minh', phone: '02839301111', email: 'quocte@phuongdong.example', type: 'Hàng không', price: 12500000 },
      { id: 'NCC015', name: 'Đối tác Land Tour Nhật Bản', address: 'Tokyo, Japan', province: 'Nước ngoài', phone: '+81312345678', email: 'ops@landjp.example', type: 'Vận chuyển', price: 13500000 },
      { id: 'NCC016', name: 'HDV Lê Hoàng Nam', address: 'Quận 7', province: 'TP. Hồ Chí Minh', phone: '0903555666', email: 'nam.hdv@example.com', type: 'HDV', price: 1200000 }
    ];

    // --- đơn hàng + tour điều hành + dự trù + phiếu
    let lineSeq = 0, bkSeq = 0, ptSeq = 0, pcSeq = 0;
    const line = (supplierId, service, qty, price) => ({ id: 'L' + String(++lineSeq).padStart(3, '0'), supplierId, service, qty, price, note: '' });
    const svc = id => s.settings.services.find(x => x.id === id);
    const order = (id, customerId, serviceId, start, end, qty, discountValue, discountUnit, date, price) => {
      const sv = svc(serviceId);
      s.orders.push({ id, customerId, serviceId, serviceName: sv.name, start, end, price: price || sv.price, qty,
        discountValue, discountUnit, date, note: '' });
    };
    const tour = (orderId, status, lines, extra) => {
      const o = s.orders.find(x => x.id === orderId);
      const t = Object.assign({ id: orderId, orderId, guests: o.qty, status, budget: lines, bookings: [], handover: null, settlement: null }, extra || {});
      s.tours.push(t); return t;
    };
    const booking = (t, supplierId, lineIds, sentAt) => {
      const sp = s.suppliers.find(x => x.id === supplierId);
      t.bookings.push({ id: 'BK' + String(++bkSeq).padStart(3, '0'), supplierId, to: sp.email, subject: 'Booking dịch vụ - Tour ' + t.id,
        lineIds, sentAt, via: 'mailto', note: '' });
    };
    const voucher = (kind, date, accountId, amount, party, content, link) => {
      const n = kind === 'thu' ? ++ptSeq : ++pcSeq;
      s.vouchers.push(Object.assign({ id: (kind === 'thu' ? 'PT' : 'PC') + String(n).padStart(4, '0'), kind, date, accountId, amount, party, content,
        orderId: '', tourId: '', lineId: '', supplierId: '' }, link || {}));
    };
    const paySupplier = (t, ln, date, accountId, amount) => {
      const sp = s.suppliers.find(x => x.id === ln.supplierId);
      voucher('chi', date, accountId, amount, sp.name, 'Thanh toán ' + ln.service + ' - Tour ' + t.id, { tourId: t.id, lineId: ln.id, supplierId: sp.id, orderId: t.id });
    };
    const custName = id => s.customers.find(c => c.id === id).name;

    // DH0001 — đã quyết toán
    order('DH0001', 'KH0001', 'DV01', '2026-09-12', '2026-09-15', 10, 5, 'percent', '2026-08-20', 5500000);
    const t1 = tour('DH0001', 'quyettoan', [
      line('NCC002', 'Khách sạn 3 đêm (5 phòng)', 15, 700000), line('NCC003', 'Xe 29 chỗ', 4, 3200000),
      line('NCC001', 'Ăn chính', 60, 180000), line('NCC004', 'Vé tham quan Đồi Mây', 10, 900000), line('NCC005', 'Hướng dẫn viên', 4, 800000)]);
    voucher('thu', '2026-08-22', 'TK01', 26000000, custName('KH0001'), 'Thu cọc đơn DH0001', { orderId: 'DH0001' });
    voucher('thu', '2026-09-10', 'TK01', 26250000, custName('KH0001'), 'Thu nốt đơn DH0001', { orderId: 'DH0001' });
    t1.budget.forEach(l => booking(t1, l.supplierId, [l.id], '2026-09-01T09:30:00'));
    paySupplier(t1, t1.budget[0], '2026-09-16', 'TK01', 10500000); paySupplier(t1, t1.budget[1], '2026-09-16', 'TK01', 12800000);
    paySupplier(t1, t1.budget[2], '2026-09-16', 'TK02', 10800000); paySupplier(t1, t1.budget[3], '2026-09-12', 'TK02', 9000000);
    paySupplier(t1, t1.budget[4], '2026-09-16', 'TK03', 3200000);
    t1.handover = { date: '2026-09-11', receiver: 'Trần Minh Khoa', phone: '0912888999', note: 'Đã giao danh sách đoàn và voucher dịch vụ.' };
    t1.settlement = { date: '2026-09-25', revenue: 52250000, cost: 46300000, collected: 52250000, paid: 46300000, profit: 5950000 };

    // DH0002 — đã bàn giao, đã kết thúc
    order('DH0002', 'KH0002', 'DV02', '2026-10-02', '2026-10-04', 20, 0, 'amount', '2026-09-05', 5200000);
    const t2 = tour('DH0002', 'banggiao', [
      line('NCC007', 'Resort 2 đêm (10 phòng)', 20, 1200000), line('NCC008', 'Ăn chính', 80, 250000), line('NCC006', 'Vé máy bay khứ hồi', 20, 1650000),
      line('NCC005', 'Hướng dẫn viên', 3, 800000), line('NCC011', 'Xe đưa đón sân bay', 3, 2500000)]);
    voucher('thu', '2026-09-06', 'TK01', 50000000, custName('KH0002'), 'Thu cọc đơn DH0002', { orderId: 'DH0002' });
    voucher('thu', '2026-09-28', 'TK01', 54000000, custName('KH0002'), 'Thu nốt đơn DH0002', { orderId: 'DH0002' });
    [0, 1, 2, 3, 4].forEach(i => booking(t2, t2.budget[i].supplierId, [t2.budget[i].id], '2026-09-07T10:00:00'));
    paySupplier(t2, t2.budget[0], '2026-09-10', 'TK01', 24000000); paySupplier(t2, t2.budget[2], '2026-09-12', 'TK02', 33000000);
    paySupplier(t2, t2.budget[1], '2026-10-02', 'TK02', 10000000);
    t2.handover = { date: '2026-10-01', receiver: 'Trần Minh Khoa', phone: '0912888999', note: 'Bàn giao danh sách phòng và lịch ăn.' };

    // DH0003 — đang điều hành, sắp khởi hành
    order('DH0003', 'KH0003', 'DV03', '2026-10-20', '2026-10-24', 8, 2000000, 'amount', '2026-10-01', 7800000);
    const t3 = tour('DH0003', 'dieuhanh', [
      line('NCC009', 'Khách sạn Sapa 3 đêm (4 phòng)', 12, 950000), line('NCC010', 'Xe 29 chỗ Hà Nội - Sapa - Hạ Long', 5, 4000000),
      line('NCC012', 'Du thuyền Hạ Long 1 đêm', 8, 2200000), line('NCC013', 'Hướng dẫn viên', 5, 900000)]);
    voucher('thu', '2026-10-02', 'TK01', 20000000, custName('KH0003'), 'Thu cọc đơn DH0003', { orderId: 'DH0003' });
    booking(t3, 'NCC009', [t3.budget[0].id], '2026-10-04T14:20:00'); booking(t3, 'NCC010', [t3.budget[1].id], '2026-10-04T14:25:00');
    paySupplier(t3, t3.budget[0], '2026-10-05', 'TK01', 5000000);

    // DH0004 — Nhật Bản
    order('DH0004', 'KH0004', 'DV04', '2026-11-15', '2026-11-20', 12, 3, 'percent', '2026-10-05', 32000000);
    const t4 = tour('DH0004', 'dieuhanh', [
      line('NCC014', 'Vé máy bay quốc tế khứ hồi', 12, 12500000), line('NCC015', 'Land tour Tokyo - Osaka (khách sạn, xe, ăn)', 12, 13500000),
      line('NCC016', 'Hướng dẫn viên suốt tuyến', 6, 1200000)]);
    voucher('thu', '2026-10-06', 'TK01', 120000000, custName('KH0004'), 'Thu cọc đơn DH0004', { orderId: 'DH0004' });

    // DH0005 — vé máy bay
    order('DH0005', 'KH0005', 'DV05', '2026-10-25', '2026-10-25', 4, 0, 'amount', '2026-10-10', 1800000);
    const t5 = tour('DH0005', 'dieuhanh', [line('NCC006', 'Vé máy bay SGN - HAN', 4, 1650000)]);
    voucher('thu', '2026-10-10', 'TK02', 7200000, custName('KH0005'), 'Thu đủ đơn DH0005', { orderId: 'DH0005' });

    // DH0006 — mới tạo, chưa dự trù
    order('DH0006', 'KH0006', 'DV02', '2026-12-05', '2026-12-07', 6, 5, 'percent', '2026-10-12', 5200000);
    tour('DH0006', 'dieuhanh', []);

    // phiếu lẻ
    voucher('thu', '2026-10-08', 'TK03', 2000000, 'Đại lý Minh Phát', 'Thu hoa hồng giới thiệu khách');
    voucher('chi', '2026-09-30', 'TK03', 3000000, 'Nguyễn Văn A', 'Chi phí tiếp khách đối tác');

    s.seq = { KH: 8, DH: 6, NCC: 16, DV: 7, TK: 3, PT: ptSeq, PC: pcSeq, L: lineSeq, BK: bkSeq };
    return s;
  }

  /* ------------------------------------------------------------------ STORE */
  // Số lớn nhất đang dùng của một loại mã (để sinh mã tiếp theo không trùng, kể cả khi nhiều người cùng làm việc)
  function maxExisting(st, key) {
    const nums = (arr, pre) => arr.map(x => String(x.id)).filter(id => id.startsWith(pre) && /^\d+$/.test(id.slice(pre.length))).map(id => Number(id.slice(pre.length)));
    let a = [];
    switch (key) {
      case 'KH': a = nums(st.customers, 'KH'); break;
      case 'DH': a = nums(st.orders, 'DH'); break;
      case 'NCC': a = nums(st.suppliers, 'NCC'); break;
      case 'DV': a = nums(st.settings.services, 'DV'); break;
      case 'TK': a = nums(st.settings.accounts, 'TK'); break;
      case 'PT': case 'PC': a = nums(st.vouchers, key); break;
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
      this.state = s;
    },
    // persist: chỉ ghi bản lưu trên trình duyệt. save: ghi + báo cho TourAPI đẩy thay đổi lên KIO.
    persist() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { console.warn('Không lưu được dữ liệu', e); } },
    save() { this.persist(); if (App.TourAPI) App.TourAPI.touch(); },
    useSeed() { this.state = seed(); this.persist(); },
    useBlank() { this.state = seed(); this.clear(true); },
    reset() { this.state = seed(); this.save(); if (App.TourAPI) App.TourAPI.requestReplace('Quản trị viên nạp lại dữ liệu mẫu'); },
    clear(silent) {
      const b = blank(); const keep = this.state.settings;
      b.settings.company = keep.company; b.settings.mailApi = keep.mailApi;
      b.settings.services = keep.services; b.settings.accounts = keep.accounts.map(a => Object.assign({}, a));
      b.seq = { DV: keep.services.length, TK: keep.accounts.length };
      this.state = b;
      if (silent) { this.persist(); return; }
      this.save(); if (App.TourAPI) App.TourAPI.requestReplace('Quản trị viên xóa toàn bộ dữ liệu nghiệp vụ');
    },
    replace(obj) {
      if (!obj || !obj.version || !obj.settings) throw new Error('File sao lưu không hợp lệ');
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
    total: o => C.gross(o) - C.discount(o),
    orderPaid: id => sum(S().vouchers.filter(v => v.kind === 'thu' && v.orderId === id), v => v.amount),
    orderRemain: o => Math.max(0, C.total(o) - C.orderPaid(o.id)),
    orderStatus(o) {
      const paid = C.orderPaid(o.id), t = C.total(o);
      if (paid <= 0) return { key: 'none', label: 'Chưa thu', tone: 'red' };
      if (paid >= t) return { key: 'full', label: 'Đã thu đủ', tone: 'green' };
      return { key: 'part', label: 'Thu một phần', tone: 'orange' };
    },
    customerRevenue: id => sum(S().orders.filter(o => o.customerId === id), C.total),

    lineAmount: l => (Number(l.qty) || 0) * (Number(l.price) || 0),
    tourCost: t => sum(t.budget, C.lineAmount),
    linePaid: (tourId, lineId) => sum(S().vouchers.filter(v => v.kind === 'chi' && v.tourId === tourId && v.lineId === lineId), v => v.amount),
    lineRemain: (t, l) => Math.max(0, C.lineAmount(l) - C.linePaid(t.id, l.id)),
    lineStatus(t, l) {
      const p = C.linePaid(t.id, l.id), a = C.lineAmount(l);
      if (p <= 0) return { label: 'Chưa chi', tone: 'red' };
      if (p >= a) return { label: 'Đã chi đủ', tone: 'green' };
      return { label: 'Chi một phần', tone: 'orange' };
    },
    lineBooked: (t, l) => t.bookings.some(b => b.lineIds.includes(l.id)),
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
  App.CONST = { SUPPLIER_TYPES, SUPPLIER_TONE, SERVICE_GROUPS, ACCOUNT_KINDS, TOUR_STATUS, PROVINCES };
  Store.load();
})();
