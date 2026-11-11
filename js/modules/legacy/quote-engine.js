/* ============================================================================
 * VYKO ERP — ENGINE BÁO GIÁ THEO THAM SỐ ĐẦU VÀO
 *
 * Mô hình dựng theo đúng biểu mẫu của xưởng thang máng cáp:
 *   1) Nhập THAM SỐ ĐẦU VÀO cho từng cấu kiện (kích thước, vật liệu, kiểu dáng,
 *      bề mặt, hao hụt, các nguyên công, độ phức tạp, số lượng…)
 *   2) Hệ thống tự tính KHỐI LƯỢNG vật tư / phôi sản phẩm / xử lý ngoài và
 *      DIỆN TÍCH bề mặt, đồng thời kiểm tra điều kiện khai báo
 *   3) Quy toàn bộ chi phí về VND/kg phôi sản phẩm rồi lập BẢNG PHÂN TÍCH GIÁ
 *      để người lập điều chỉnh hệ số và chốt đơn giá
 *
 * Công thức chốt (đã đối chiếu khớp tuyệt đối với bảng phân tích mẫu):
 *   Giá gốc      = (VT + SX + VC nội bộ + VC giao hàng + Lắp đặt + QL) × (1 + Chi phí chung)
 *   Chi phí xử lý = % xử lý × Đơn giá/kg
 *   Đơn giá/kg   = VT + SX + VCnb + VCgh + LĐ + QL + Xử lý + Còn lại
 *   Còn lại      = phần dôi ra sau khi trừ hết chi phí (lợi nhuận thực tế)
 * ==========================================================================*/

/* ------------------------------------------------- 1. DANH MỤC QUY ƯỚC */

/* ============================================================================
 * DANH MỤC QUY ƯỚC — người dùng tự thêm/sửa/xóa ở màn "Danh mục quy ước"
 * Đưa hẳn vào DB để engine và các ô chọn đều đọc từ một nguồn duy nhất.
 * ==========================================================================*/

/** Dạng khai triển quyết định công thức tính khổ phôi của nhóm cấu kiện */
const DANG_KHAI_TRIEN = {
  than: { label: 'Thân máng', formula: 'W + 2×H + 2×W1' },
  nap:  { label: 'Nắp',       formula: 'W + 2×H1' },
  thang:{ label: 'Thang',     formula: '2×(H + 2×W1) + bậc theo Bước' },
  tam:  { label: 'Tấm phẳng', formula: 'W' },
};

/** Cách tính tiết diện theo kiểu dáng (dạng phôi) */
const CACH_TINH_TIET_DIEN = {
  khaiTrien: 'Theo khai triển',
  ong:       'Ống (π × D)',
  vuongDac:  'Vuông đặc (W × H)',
  tronDac:   'Tròn đặc (π/4 × D²)',
};

DB.catalogs = {
  /* 28 nhóm cấu kiện theo sheet "Quy uoc" — kind quyết định công thức khai triển */
  productGroups: [
    ['Máng cáp', 'than'], ['Nắp máng cáp', 'nap'], ['Thang cáp', 'thang'], ['Nắp thang cáp', 'nap'],
    ['Cút ngang máng', 'than'], ['Chữ T máng', 'than'], ['Chữ thập máng', 'than'],
    ['Cút lên xuống máng', 'than'], ['Côn thu máng', 'than'],
    ['Cút ngang thang', 'thang'], ['Chữ T thang', 'thang'], ['Chữ thập thang', 'thang'],
    ['Cút lên xuống thang', 'thang'], ['Côn thu thang', 'thang'],
    ['Nắp cút ngang máng', 'nap'], ['Nắp chữ T máng', 'nap'], ['Nắp chữ thập máng', 'nap'],
    ['Nắp cút lên xuống máng', 'nap'], ['Nắp côn thu máng', 'nap'],
    ['Nắp cút ngang thang', 'nap'], ['Nắp chữ T thang', 'nap'], ['Nắp chữ thập thang', 'nap'],
    ['Nắp cút lên xuống thang', 'nap'], ['Nắp côn thu thang', 'nap'],
    ['Nối thang máng', 'tam'], ['Kẹp Z thang máng', 'tam'], ['Thanh U, V thang máng', 'tam'],
    ['Chi tiết cơ khí', 'tam'],
  ].map(([name, kind]) => ({
    name, kind,
    // YC-05 — công thức tính khối lượng riêng của từng nhóm, người dùng sửa được
    ...{
      than:  { mode: 'khaiTrien', formula: 'W + 2*H + 2*W1' },
      nap:   { mode: 'khaiTrien', formula: 'W + 2*H1' },
      thang: { mode: 'kgm',       formula: '2*(H+2*W1)/1000*T/1000*RHO + DIV0(1000,S)*(W1+2*H1)/1000*W/1000*T/1000*RHO' },
      tam:   { mode: 'khaiTrien', formula: 'W' },
    }[kind],
  })),

  /* Vật liệu + khối lượng riêng kg/m³ */
  materials: [
    { name: 'Thép', density: 7850 },
    { name: 'Inox', density: 7930 },
    { name: 'Nhôm', density: 2700 },
    { name: 'Đồng', density: 8960 },
  ],

  /* Kiểu dáng = dạng phôi */
  shapes: [
    { name: 'Tấm', section: 'khaiTrien' }, { name: 'Hộp', section: 'khaiTrien' },
    { name: 'U', section: 'khaiTrien' }, { name: 'C', section: 'khaiTrien' },
    { name: 'H', section: 'khaiTrien' }, { name: 'I', section: 'khaiTrien' },
    { name: 'L', section: 'khaiTrien' }, { name: 'V', section: 'khaiTrien' },
    { name: 'Ống', section: 'ong' },
    { name: 'Vuông đặc', section: 'vuongDac' }, { name: 'Tròn đặc', section: 'tronDac' },
  ],

  /* Đặc tính / mác vật liệu — thuộc vật liệu gốc nào (đơn giá nằm ở bảng đơn giá) */
  properties: [
    ['cán nóng', 'Thép'], ['mạ kẽm', 'Thép'], ['mạ kẽm Z08', 'Thép'], ['mạ kẽm Z12', 'Thép'],
    ['mạ kẽm Z18', 'Thép'], ['Zam', 'Thép'], ['đúc', 'Thép'], ['hàn', 'Thép'],
    ['Inox 201', 'Inox'], ['Inox 304', 'Inox'], ['Inox 304 bóng', 'Inox'],
    ['Inox 304 xước', 'Inox'], ['Inox 316', 'Inox'],
  ].map(([name, material]) => ({ name, material })),

  /* Hoàn thiện bề mặt / dịch vụ xử lý — YC-04
   * basis: cơ sở tính đơn giá — 'm2' | 'kg' | 'm3' | 'thickness' (bậc theo chiều dày)
   * tiers: bảng bậc giá theo chiều dày, chỉ dùng khi basis = 'thickness' */
  surfaces: [
    { name: 'Không',           outsource: false, basis: 'm2', rate: 0,     tiers: [] },
    { name: 'Sơn chống gỉ',    outsource: false, basis: 'm2', rate: 8000,  tiers: [] },
    { name: 'Sơn phủ 1 lớp',   outsource: false, basis: 'm2', rate: 12000, tiers: [] },
    { name: 'Sơn phủ 2 lớp',   outsource: false, basis: 'm2', rate: 18000, tiers: [] },
    { name: 'Sơn phủ 3 lớp',   outsource: false, basis: 'm2', rate: 24000, tiers: [] },
    { name: 'Sơn tĩnh điện',   outsource: false, basis: 'm2', rate: 10000, tiers: [] },
    { name: 'Sơn Epoxy',       outsource: false, basis: 'm2', rate: 26000, tiers: [] },
    { name: 'Mạ điện',         outsource: true,  basis: 'm2', rate: 45000, tiers: [] },
    { name: 'Mạ nhúng nóng',   outsource: true,  basis: 'thickness', rate: 8200,
      tiers: [{ from: 0, to: 1.5, rate: 9500 }, { from: 1.5, to: 3, rate: 8200 },
              { from: 3, to: 6, rate: 7400 }, { from: 6, to: 0, rate: 6800 }] },
    { name: 'Mạ kẽm điện phân', outsource: true, basis: 'kg', rate: 6500, tiers: [] },
    { name: 'Khác',            outsource: false, basis: 'm2', rate: 15000, tiers: [] },
  ],

  /* Nguyên công sản xuất nội bộ — YC-03
   * basis: 'lan' (VND/lần trên 1 cấu kiện) | 'kg' | 'm2' */
  operations: [
    { key: 'catTam',  name: 'Cắt tấm',  workshop: 'Cắt',     basis: 'lan', rate: 45000, ops: ['CD-01', 'CD-02'] },
    { key: 'catOng',  name: 'Cắt ống',  workshop: 'Cắt',     basis: 'lan', rate: 38000, ops: ['CD-03'] },
    { key: 'chan',    name: 'Chấn',     workshop: 'Cắt',     basis: 'lan', rate: 52000, ops: ['CD-04'] },
    { key: 'uon',     name: 'Uốn',      workshop: 'Cắt',     basis: 'lan', rate: 58000, ops: ['CD-04'] },
    { key: 'han',     name: 'Hàn',      workshop: 'Hàn',     basis: 'lan', rate: 75000, ops: ['CD-11', 'CD-12', 'CD-13'] },
    { key: 'mai',     name: 'Mài',      workshop: 'Sơn',     basis: 'lan', rate: 32000, ops: ['CD-14'] },
    { key: 'lamSach', name: 'Làm sạch', workshop: 'Sơn',     basis: 'lan', rate: 18000, ops: ['CD-14'] },
    { key: 'khac',    name: 'Khác',     workshop: 'Lắp ráp', basis: 'lan', rate: 25000, ops: ['CD-16'] },
  ],

  /* Đơn vị tính */
  units: ['m', 'm2', 'm3', 'Cái', 'Cụm', 'Thanh', 'Tấm', 'Bộ'].map((name) => ({ name })),
};

/* ============================================================================
 * YC-05 · BỘ TÍNH BIỂU THỨC CHO CÔNG THỨC DO NGƯỜI DÙNG TỰ ĐỊNH NGHĨA
 * Tự phân tích cú pháp (shunting-yard), KHÔNG dùng eval để an toàn tuyệt đối
 * với nội dung người dùng gõ vào.
 * ==========================================================================*/

/** Biến dùng được trong công thức — hiển thị cho người dùng chọn */
const BIEN_CONG_THUC = [
  { k: 'L',   t: 'Chiều dài (mm)' },
  { k: 'W',   t: 'Chiều rộng (mm)' },
  { k: 'H',   t: 'Chiều cao (mm)' },
  { k: 'D',   t: 'Đường kính (mm)' },
  { k: 'W1',  t: 'Tham số W1 (mm)' },
  { k: 'H1',  t: 'Tham số H1 (mm)' },
  { k: 'S',   t: 'Bước (mm)' },
  { k: 'T',   t: 'Chiều dày (mm)' },
  { k: 'RHO', t: 'Khối lượng riêng (kg/m³)' },
  { k: 'N',   t: 'Số lượng cấu kiện' },
  { k: 'Q',   t: 'Số lượng sản phẩm' },
  { k: 'PI',  t: 'Hằng số Pi' },
];

const HAM_CONG_THUC = {
  MIN: (...a) => Math.min(...a),
  MAX: (...a) => Math.max(...a),
  ROUND: (x, n = 0) => Math.round(x * Math.pow(10, n)) / Math.pow(10, n),
  SQRT: (x) => Math.sqrt(x),
  ABS: (x) => Math.abs(x),
  DIV0: (a, b) => (Number(b) ? a / b : 0),   // chia an toàn khi mẫu bằng 0
};

/** Cách tính — kiểu kết quả mà công thức trả về */
const CACH_TINH_KHOI_LUONG = {
  khaiTrien: { label: 'Khổ khai triển', unit: 'mm',   desc: 'khổ/1000 × dày/1000 × tỷ trọng × chiều dài' },
  tietDien:  { label: 'Tiết diện ngang', unit: 'mm²', desc: 'tiết diện/1.000.000 × tỷ trọng × chiều dài' },
  kgm:       { label: 'Khối lượng trên mét', unit: 'kg/m', desc: 'kết quả × chiều dài' },
  theTich:   { label: 'Thể tích 1 cấu kiện', unit: 'm³', desc: 'thể tích × tỷ trọng (không nhân chiều dài)' },
  kgCk:      { label: 'Khối lượng 1 cấu kiện', unit: 'kg', desc: 'dùng thẳng kết quả' },
};

/** Mẫu công thức dựng sẵn để chọn nhanh (YC-05.4) */
const MAU_CONG_THUC = [
  { ten: 'Thân máng (U có gờ)', mode: 'khaiTrien', ct: 'W + 2*H + 2*W1' },
  { ten: 'Nắp có gờ',           mode: 'khaiTrien', ct: 'W + 2*H1' },
  { ten: 'Thang cáp (2 biên + bậc)', mode: 'kgm',  ct: '2*(H+2*W1)/1000*T/1000*RHO + DIV0(1000,S)*(W1+2*H1)/1000*W/1000*T/1000*RHO' },
  { ten: 'Tấm phẳng',           mode: 'khaiTrien', ct: 'W' },
  { ten: 'Hộp 4 mặt',           mode: 'khaiTrien', ct: '2*(W+H)' },
  { ten: 'Ống tròn',            mode: 'khaiTrien', ct: 'PI*D' },
  { ten: 'Thanh tròn đặc',      mode: 'tietDien',  ct: 'PI/4*D^2' },
  { ten: 'Thanh vuông đặc',     mode: 'tietDien',  ct: 'W*H' },
  { ten: 'Khối hộp theo thể tích', mode: 'theTich', ct: 'L/1000*W/1000*H/1000' },
];

/** Tách biểu thức thành các token */
function tachToken(expr) {
  const out = [];
  const s = String(expr || '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = Number(s.slice(i, j));
      if (isNaN(num)) throw new Error(`Số không hợp lệ: “${s.slice(i, j)}”`);
      out.push({ t: 'num', v: num }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      out.push({ t: 'name', v: s.slice(i, j).toUpperCase() }); i = j; continue;
    }
    if ('+-*/^(),'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error(`Ký tự không hợp lệ: “${c}”`);
  }
  return out;
}

/** Chuyển sang hậu tố rồi tính — trả về số, ném lỗi nếu cú pháp sai */
function evalFormula(expr, vars) {
  const tokens = tachToken(expr);
  if (!tokens.length) throw new Error('Công thức đang để trống');

  const uu = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
  const out = [], ops = [];
  let truocLaToanTu = true;   // để nhận diện dấu âm đứng đầu

  tokens.forEach((tk) => {
    if (tk.t === 'num') { out.push(tk); truocLaToanTu = false; return; }
    if (tk.t === 'name') {
      if (HAM_CONG_THUC[tk.v]) ops.push({ t: 'func', v: tk.v });
      else {
        if (!(tk.v in vars)) throw new Error(`Không có biến “${tk.v}”`);
        out.push({ t: 'num', v: Number(vars[tk.v]) || 0 });
      }
      truocLaToanTu = false; return;
    }
    if (tk.t === ',') {
      while (ops.length && ops[ops.length - 1].t !== '(') out.push(ops.pop());
      if (!ops.length) throw new Error('Dấu phẩy nằm ngoài lời gọi hàm');
      ops[ops.length - 1].argc++;          // thêm một đối số cho hàm đang mở
      truocLaToanTu = true; return;
    }
    if (tk.t === '(') {
      // Ngoặc này mở cho một hàm hay chỉ để nhóm biểu thức?
      const laHam = ops.length > 0 && ops[ops.length - 1].t === 'func';
      ops.push({ t: '(', laHam, argc: 1 });
      truocLaToanTu = true; return;
    }
    if (tk.t === ')') {
      while (ops.length && ops[ops.length - 1].t !== '(') out.push(ops.pop());
      if (!ops.length) throw new Error('Thiếu dấu mở ngoặc');
      const ngoac = ops.pop();
      if (ngoac.laHam) {
        const f = ops.pop();
        out.push({ t: 'func', v: f.v, argc: ngoac.argc });
      }
      truocLaToanTu = false; return;
    }
    // Toán tử
    if (tk.t === '-' && truocLaToanTu) { out.push({ t: 'num', v: 0 }); }   // dấu âm một ngôi
    while (ops.length) {
      const top = ops[ops.length - 1];
      if (top.t === '(' || top.t === 'func') break;
      if (uu[top.t] >= uu[tk.t] && tk.t !== '^') out.push(ops.pop());
      else break;
    }
    ops.push({ t: tk.t });
    truocLaToanTu = true;
  });
  while (ops.length) {
    const op = ops.pop();
    if (op.t === '(') throw new Error('Thiếu dấu đóng ngoặc');
    out.push(op);
  }

  const st = [];
  out.forEach((tk) => {
    if (tk.t === 'num') { st.push(tk.v); return; }
    if (tk.t === 'func') {
      const f = HAM_CONG_THUC[tk.v];
      const n = tk.argc || 1;
      if (st.length < n) throw new Error(`Hàm ${tk.v} thiếu tham số`);
      const args = st.splice(st.length - n, n);
      st.push(Number(f(...args)) || 0);
      return;
    }
    const b = st.pop(), a = st.pop();
    if (a === undefined || b === undefined) throw new Error('Biểu thức thiếu toán hạng');
    st.push(tk.t === '+' ? a + b : tk.t === '-' ? a - b : tk.t === '*' ? a * b
      : tk.t === '/' ? (b ? a / b : 0) : Math.pow(a, b));
  });
  if (st.length !== 1) throw new Error('Biểu thức không hợp lệ');
  const kq = st[0];
  if (!isFinite(kq)) throw new Error('Kết quả không hữu hạn — kiểm tra phép chia cho 0');
  return kq;
}

/** Bộ biến của một dòng tham số để đưa vào công thức */
function bienCuaDong(row) {
  return {
    L: Number(row.L) || 0, W: Number(row.W) || 0, H: Number(row.H) || 0, D: Number(row.D) || 0,
    W1: Number(row.W1) || 0, H1: Number(row.H1) || 0, S: Number(row.step) || 0,
    T: Number(row.thickness) || 0, RHO: tyTrong(row.material),
    N: Number(row.pieceQty) || 1, Q: Number(row.qty) || 0, PI: Math.PI,
  };
}

/** Kiểm tra công thức có chạy được không — dùng cho ô xem trước */
function thuCongThuc(expr, vars) {
  try { return { ok: true, value: evalFormula(expr, vars) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

/* ---- Bí danh đọc nhanh, luôn phản ánh danh mục hiện hành ---- */
const CAT = () => DB.catalogs;
const catFind = (list, name) => CAT()[list].find((x) => x.name === name);

/* Danh sách tên dùng cho các ô chọn — luôn lấy từ danh mục hiện hành */
const nhomSanPham = () => CAT().productGroups.map((x) => x.name);
const tenVatLieu  = () => CAT().materials.map((x) => x.name);
const tenKieuDang = () => CAT().shapes.map((x) => x.name);
const tenDacTinh  = () => CAT().properties.map((x) => x.name);
const tenBeMat    = () => CAT().surfaces.map((x) => x.name);
const tenDonVi    = () => CAT().units.map((x) => x.name);
/** Khối lượng riêng của vật liệu */
const tyTrong = (name) => (catFind('materials', name) || {}).density || 7850;
/** Dạng khai triển của nhóm cấu kiện */
const dangKhaiTrien = (group) => (catFind('productGroups', group) || {}).kind || 'than';
/** Cách tính tiết diện của kiểu dáng */
const cachTinhTietDien = (shape) => (catFind('shapes', shape) || {}).section || 'khaiTrien';
/** Bề mặt này có phải thuê ngoài không */
const laThueNgoai = (surface) => !!(catFind('surfaces', surface) || {}).outsource;
/** Mác vật liệu thuộc vật liệu gốc nào */
const macThuocVatLieu = (prop) => (catFind('properties', prop) || {}).material || '';

/** Danh sách nguyên công nội bộ — tham chiếu sống tới danh mục (mảng được sửa tại chỗ) */
const NGUYEN_CONG = DB.catalogs.operations;

/** Cơ sở tính đơn giá cho công việc gia công (YC-04.2) */
const CO_SO_TINH = {
  lan:       { label: 'Theo lần trên cấu kiện', unit: 'đ/lần', noiBo: true },
  kg:        { label: 'Theo khối lượng',        unit: 'đ/kg',  noiBo: true },
  m2:        { label: 'Theo diện tích bề mặt',  unit: 'đ/m²',  noiBo: true },
  m3:        { label: 'Theo thể tích',          unit: 'đ/m³',  noiBo: false },
  thickness: { label: 'Bậc theo chiều dày',     unit: 'đ/kg',  noiBo: false },
};

/** Đơn vị tính */
const DON_VI = ['m', 'm2', 'm3', 'Cái', 'Cụm', 'Thanh', 'Tấm', 'Bộ'];

/** Khổ phôi tiêu chuẩn dùng để tính hao hụt (sheet "% hao hụt") */
const KHO_PHOI = { dai: 3000, rong: 1250 };

/* ============================================================================
 * BẢNG ĐƠN GIÁ ĐẦU VÀO — TOÀN BỘ NHẬP TAY ĐƯỢC
 * Tương ứng 3 sheet nhập của biểu mẫu: Input VL · Input LD-DT · Input VC.
 * Engine luôn đọc từ đây nên không có con số nào bị "chôn" trong code.
 * ==========================================================================*/
DB.priceBook = {
  /* Đơn giá vật liệu VND/kg — theo mác cụ thể (sheet Input VL) */
  material: {
    'cán nóng': 17727, 'mạ kẽm': 19500, 'mạ kẽm Z08': 20200, 'mạ kẽm Z12': 21000,
    'mạ kẽm Z18': 22500, 'Zam': 23800, 'đúc': 26000, 'hàn': 21000,
    'Inox 201': 52000, 'Inox 304': 78000, 'Inox 304 bóng': 84000,
    'Inox 304 xước': 82000, 'Inox 316': 118000,
  },
  /* Đơn giá vật liệu gốc VND/kg — dùng khi mác không khớp vật liệu đã chọn */
  materialBase: { 'Thép': 17727, 'Inox': 52000, 'Nhôm': 68000, 'Đồng': 245000 },

  /* Đơn giá xử lý bề mặt VND/m² (sheet Input VL) */
  surface: {
    'Không': 0, 'Sơn chống gỉ': 8000, 'Sơn phủ 1 lớp': 12000, 'Sơn phủ 2 lớp': 18000,
    'Sơn phủ 3 lớp': 24000, 'Sơn tĩnh điện': 10000, 'Sơn Epoxy': 26000,
    'Mạ điện': 45000, 'Mạ nhúng nóng': 38000, 'Khác': 15000,
  },

  /* Đơn giá nguyên công VND cho 1 lần trên 1 cấu kiện */
  operation: { catTam: 45000, catOng: 38000, chan: 52000, uon: 58000, han: 75000, mai: 32000, lamSach: 18000, khac: 25000 },

  /* Hệ số nhân chi phí sản xuất theo độ phức tạp cấu kiện */
  complexity: { 'Đơn giản': 1.00, 'Trung bình': 1.30, 'Phức tạp': 1.70, 'Rất phức tạp': 2.20 },

  /* Hệ số nhân chi phí sản xuất theo đặc thù sản xuất */
  productionType: {
    'Hàng tiêu chuẩn, sản xuất hàng loạt': 1.00,
    'Hàng tiêu chuẩn, sản xuất đơn chiếc': 1.15,
    'Hàng phi tiêu chuẩn, sản xuất hàng loạt': 1.25,
    'Hàng phi tiêu chuẩn, sản xuất đơn chiếc': 1.45,
  },

  /* Phân loại khách hàng — cộng thêm vào dự phòng giảm giá (%) */
  customerClass: {
    'VIP':     { duPhong: -2, note: 'Khách VIP — ưu tiên giữ giá cạnh tranh' },
    'Ổn định': { duPhong: 0,  note: 'Khách hàng ổn định, thanh toán đúng hạn' },
    'Mới':     { duPhong: 2,  note: 'Khách mới — dự phòng rủi ro thanh toán' },
    'Khó':     { duPhong: 5,  note: 'Khách khó tính, nhiều yêu cầu phát sinh' },
    'Rủi ro':  { duPhong: 8,  note: 'Khách rủi ro công nợ — cần dự phòng cao' },
  },

  /* Vận chuyển & lắp đặt (sheet Input VC / Input LD-DT) */
  transport: {
    nhanHang: 400000,   // VND / chuyến — chở vật tư về xưởng
    xuLyNgoai: 400000,  // VND / chuyến — chở đi mạ/sơn thuê ngoài
    giaoHang: 20000,    // VND / km
    lapDat: 170000,     // VND / đơn vị sản phẩm
  },
};

/* Bí danh đọc nhanh — luôn trỏ vào bảng đơn giá đang hiệu lực */
const PB = () => DB.priceBook;
const DO_PHUC_TAP = new Proxy({}, { get: (_, k) => PB().complexity[k], ownKeys: () => Object.keys(DB.priceBook.complexity), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
const DAC_THU_SX = new Proxy({}, { get: (_, k) => PB().productionType[k], ownKeys: () => Object.keys(DB.priceBook.productionType), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
const PHAN_LOAI_KH = new Proxy({}, { get: (_, k) => PB().customerClass[k], ownKeys: () => Object.keys(DB.priceBook.customerClass), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
const DG_VAN_CHUYEN = new Proxy({}, { get: (_, k) => PB().transport[k] });

/* --------------------------------------- 2. TÍNH TOÁN CHO 1 DÒNG THAM SỐ */

/**
 * Khổ khai triển (mm) — bề rộng tấm phôi cần dùng để chấn/uốn ra cấu kiện.
 *
 * Lưu ý theo đúng cách khai của xưởng:
 *   • "Kiểu dáng" mô tả DẠNG PHÔI (Tấm / Ống / Vuông đặc…), không phải hình
 *     dạng thành phẩm — trong biểu mẫu hầu hết cấu kiện đều là "Tấm".
 *   • Hình dạng thành phẩm suy ra từ "Thông số cấu kiện" (nhóm cấu kiện).
 *   • W1 là gờ mép của thân máng/thang, H1 là gờ của nắp.
 */
function khaiTrien(row) {
  const W = Number(row.W) || 0, H = Number(row.H) || 0, D = Number(row.D) || 0;
  const W1 = Number(row.W1) || 0, H1 = Number(row.H1) || 0;

  const tietDien = cachTinhTietDien(row.shape);
  if (tietDien === 'ong') return Math.PI * D;
  if (tietDien === 'vuongDac' || tietDien === 'tronDac') return 0;

  // Công thức lấy theo "Dạng khai triển" khai trong danh mục nhóm cấu kiện
  switch (dangKhaiTrien(row.productGroup)) {
    case 'nap':   return W + 2 * (H1 || 12);            // nắp: bản rộng W gấp 2 gờ H1
    case 'thang': return 2 * (H + 2 * (W1 || 20));      // thang: 2 thanh biên cao H, mỗi biên 2 gờ W1
    case 'tam':   return W;                             // bản mã, kẹp Z: tấm phẳng
    default:      return W + 2 * H + 2 * (W1 || 20);    // thân máng: lòng W, 2 thành H, 2 gờ mép W1
  }
}

/** Đơn giá vật liệu VND/kg — ưu tiên mác cụ thể, nếu không lấy theo vật liệu gốc */
function dgVatLieu(row) {
  if (macThuocVatLieu(row.property) === row.material && PB().material[row.property] != null) {
    return PB().material[row.property];
  }
  return PB().materialBase[row.material] || 0;
}

/** Dịch vụ xử lý bề mặt trong danh mục */
const dichVuBeMat = (name) => catFind('surfaces', name) || { basis: 'm2', rate: 0, tiers: [] };

/** Bậc giá áp dụng theo chiều dày (YC-04.3) */
function bacTheoDoDay(sv, thickness) {
  const t = Number(thickness) || 0;
  const tiers = sv.tiers || [];
  return tiers.find((b) => t >= Number(b.from) && (!Number(b.to) || t < Number(b.to))) || null;
}

/** Đơn giá xử lý bề mặt đang áp dụng + cơ sở tính */
function dgBeMat(surface, thickness) {
  const sv = dichVuBeMat(surface);
  if (sv.basis === 'thickness') {
    const bac = bacTheoDoDay(sv, thickness);
    return { rate: bac ? Number(bac.rate) : Number(sv.rate) || 0, basis: 'thickness', tier: bac };
  }
  return { rate: Number(sv.rate) || 0, basis: sv.basis || 'm2', tier: null };
}

/** Đơn giá 1 đơn vị của nguyên công nội bộ */
function dgNguyenCong(key) {
  const nc = NGUYEN_CONG.find((n) => n.key === key);
  return nc ? Number(nc.rate) || 0 : 0;
}

/**
 * Áp công thức của nhóm cấu kiện (YC-05) — trả về khối lượng cho MỘT cấu kiện
 * (hoặc cho 1 mét nếu đơn vị tính là mét), kèm diễn giải để hiển thị.
 */
function kgMotCauKien(row) {
  const rho = tyTrong(row.material);
  const t = Number(row.thickness) || 0;
  // Đơn vị là mét thì mỗi "cấu kiện" là 1 mét dài; ngược lại lấy theo chiều dài khai
  const daiM = row.unit === 'm' ? 1 : (Number(row.L) || 0) / 1000;

  // YC-05.7 — khối lượng phôi đặc thù luôn được ưu tiên hơn công thức
  if (Number(row.specialWeight) > 0) {
    return { kg: Number(row.specialWeight) * daiM, daiM, mode: 'dacThu', raw: Number(row.specialWeight), err: '' };
  }

  const g = catFind('productGroups', row.productGroup);
  const mode = (g && g.mode) || 'khaiTrien';
  const ct = (g && g.formula) || 'W + 2*H + 2*W1';

  let raw = 0, err = '';
  try { raw = evalFormula(ct, bienCuaDong(row)); }
  catch (e) { err = e.message; }

  let kg = 0;
  switch (mode) {
    case 'tietDien': kg = (raw / 1e6) * rho * daiM; break;
    case 'kgm':      kg = raw * daiM; break;
    case 'theTich':  kg = raw * rho; break;            // thể tích cả cấu kiện
    case 'kgCk':     kg = raw; break;                  // đã là kg cả cấu kiện
    default:         kg = (raw / 1000) * (t / 1000) * rho * daiM;  // khaiTrien
  }
  return { kg, daiM, mode, raw, formula: ct, err };
}

/** Khối lượng trên 1 mét dài (giữ cho các màn hiển thị cũ) */
function kgTrenMet(row) {
  const r = kgMotCauKien(row);
  return r.daiM > 0 ? r.kg / r.daiM : r.kg;
}

/** Tổng hợp thông tin cấu kiện — chuỗi định danh dùng để tra đơn giá vật liệu.
 *  Ghép đúng thứ tự trong biểu mẫu: <cấu kiện> - <vật liệu> - <kiểu dáng> - <đặc tính> - <bề mặt> */
function tongHopThongTin(row) {
  return [row.productGroup, row.material, row.shape, row.property, row.surface]
    .filter(Boolean).join(' - ');
}

/** Kiểm tra điều kiện khai báo — cột "Kiem_tra_dieu_kien_khai_bao".
 *  Chỉ soát các KÍCH THƯỚC cần để quy ra khối lượng; thiếu chiều dài là lỗi
 *  phổ biến nhất vì không quy đổi được ra mét dài. Số lượng không thuộc phạm vi
 *  kiểm tra này (được soát riêng ở bước tính khối lượng). */
function kiemTraKhaiBao(row) {
  const thieu = [];
  const tietDien = cachTinhTietDien(row.shape);
  if (!(Number(row.thickness) > 0)) thieu.push('chiều dày');
  if (tietDien === 'ong' || tietDien === 'tronDac') {
    if (!(Number(row.D) > 0)) thieu.push('đường kính');
  } else if (!(Number(row.W) > 0)) {
    thieu.push('chiều rộng');
  }
  if (!(Number(row.L) > 0) && !(Number(row.specialWeight) > 0)) thieu.push('chiều dài');
  return thieu.length
    ? { ok: false, label: 'Thiếu kích thước', detail: 'Chưa khai: ' + thieu.join(', ') }
    : { ok: true, label: 'OK', detail: 'Đủ kích thước để quy ra khối lượng' };
}

/**
 * Tính toàn bộ chỉ tiêu của 1 dòng tham số đầu vào.
 * Trả về khối lượng, diện tích và các cấu phần chi phí của riêng dòng đó.
 */
function tinhDongThamSo(row) {
  const rho = tyTrong(row.material);
  const dgVL = dgVatLieu(row);
  const t = Number(row.thickness) || 0;

  const check = kiemTraKhaiBao(row);
  const ct = kgMotCauKien(row);        // áp công thức riêng của nhóm cấu kiện
  const daiM = ct.daiM;
  const kgM = daiM > 0 ? ct.kg / daiM : ct.kg;

  const soCauKien = Number(row.pieceQty) || 1;
  const soLuong = Number(row.qty) || 0;

  // Khối lượng phôi sản phẩm (kg) — phần vật liệu thực nằm trong sản phẩm
  const blankWeight = ct.kg * soCauKien * soLuong;

  // Khối lượng vật tư (kg) = phôi × (1 + hao hụt) × (1 + vật tư phụ)
  const waste = (Number(row.wastePct) || 0) / 100;
  const aux = (Number(row.auxPct) || 0) / 100;
  const materialWeight = blankWeight * (1 + waste) * (1 + aux);

  // Diện tích bề mặt (m²) — quy đổi từ khối lượng phôi theo chiều dày
  const kgPerM2 = (t / 1000) * rho;
  const surfaceArea = kgPerM2 > 0 ? blankWeight / kgPerM2 : 0;

  // Khối lượng gửi đi xử lý bề mặt thuê ngoài (mạ điện / mạ nhúng nóng)
  const outsourceWeight = laThueNgoai(row.surface) ? blankWeight : 0;

  /* ---- Chi phí của dòng ---- */
  const costMaterial = materialWeight * (Number(row.matPrice) || dgVL);

  // Thể tích khối phôi (m³) — dùng cho dịch vụ tính theo m³
  const volume = rho > 0 ? blankWeight / rho : 0;

  /* Xử lý bề mặt (YC-04.5): đơn giá phụ thuộc cơ sở tính đã khai trong danh mục */
  const sv = dichVuBeMat(row.surface);
  const bm = dgBeMat(row.surface, t);
  const ghiDeBM = row.surfacePrice !== '' && row.surfacePrice != null;
  const dgBM = ghiDeBM ? Number(row.surfacePrice) : bm.rate;
  const luongTinhBM = { kg: blankWeight, m3: volume, thickness: blankWeight, m2: surfaceArea }[bm.basis] ?? surfaceArea;
  const costSurface = luongTinhBM * dgBM;

  /* Nguyên công nội bộ (YC-03/YC-04.5): mỗi loại có cơ sở tính riêng */
  const heSoPhucTap = DO_PHUC_TAP[row.complexity] || 1;
  const soLanNC = NGUYEN_CONG.reduce((s, nc) => s + (Number(row.ops?.[nc.key]) || 0), 0);
  let tienNC = 0;
  NGUYEN_CONG.forEach((nc) => {
    const n = Number(row.ops?.[nc.key]) || 0;
    if (!n) return;
    const dg = dgNguyenCong(nc.key);
    if (nc.basis === 'kg') tienNC += n * dg * blankWeight;
    else if (nc.basis === 'm2') tienNC += n * dg * surfaceArea;
    else tienNC += n * dg * soCauKien * soLuong;      // 'lan'
  });
  const costOther = (Number(row.otherCost) || 0) * soCauKien * soLuong;   // DG_chi_tiet_khac
  const costProduction = tienNC * heSoPhucTap + costOther;

  return {
    ...row,
    summary: tongHopThongTin(row),
    check: check.label, checkOk: check.ok, checkDetail: check.detail,
    density: rho,
    khaiTrienMm: Math.round(khaiTrien(row) * 100) / 100,
    kgPerM: Math.round(kgM * 1000) / 1000,
    // Thông tin công thức đang áp dụng (YC-05.8)
    ctMode: ct.mode, ctFormula: ct.formula || '', ctRaw: ct.raw, ctError: ct.err,
    ctModeLabel: (CACH_TINH_KHOI_LUONG[ct.mode] || {}).label || 'Khối lượng phôi đặc thù',
    ctUnit: (CACH_TINH_KHOI_LUONG[ct.mode] || {}).unit || 'kg/m',
    blankWeight, materialWeight, outsourceWeight, surfaceArea,
    matPriceUsed: Number(row.matPrice) || dgVL,
    matPriceIsOverride: !!Number(row.matPrice),
    surfacePriceUsed: dgBM,
    surfacePriceIsOverride: ghiDeBM,
    surfaceBasis: bm.basis,
    surfaceBasisLabel: (CO_SO_TINH[bm.basis] || {}).label || '',
    surfaceUnit: (CO_SO_TINH[bm.basis] || {}).unit || '',
    surfaceTier: bm.tier,
    surfaceOutsource: !!sv.outsource,
    surfaceQty: luongTinhBM,
    volume,
    soLanNC, heSoPhucTap,
    costMaterial, costSurface, costProduction, costOther,
  };
}

/* ----------------------------------- 3. BẢNG PHÂN TÍCH GIÁ CỦA BÁO GIÁ */

/**
 * Tổng hợp toàn bộ dòng tham số + hệ số điều chỉnh thành bảng phân tích giá.
 * Tất cả chỉ tiêu được quy về VND/kg phôi sản phẩm, đúng như biểu mẫu.
 */
function phanTichGia(quote) {
  const rows = (quote.inputs || []).map(tinhDongThamSo);
  const co = quote.coeffs || {};
  const tr = quote.transport || {};

  const blankWeight = rows.reduce((s, r) => s + r.blankWeight, 0);
  const materialWeight = rows.reduce((s, r) => s + r.materialWeight, 0);
  const outsourceWeight = rows.reduce((s, r) => s + r.outsourceWeight, 0);
  const surfaceArea = rows.reduce((s, r) => s + r.surfaceArea, 0);
  const matAreaEquiv = rows.reduce((s, r) => s + (r.surfaceArea * (r.materialWeight / (r.blankWeight || 1))), 0);

  const heSoDacThu = DAC_THU_SX[quote.productionType] || 1;

  /* --- Các cấu phần chi phí (thành tiền) --- */
  const cpVatTu = rows.reduce((s, r) => s + r.costMaterial + r.costSurface, 0);
  const cpSanXuat = rows.reduce((s, r) => s + r.costProduction, 0) * heSoDacThu;
  const cpVcNoiBo = (Number(tr.chuyenNhanHang) || 0) * DG_VAN_CHUYEN.nhanHang
                  + (Number(tr.chuyenXuLyNgoai) || 0) * DG_VAN_CHUYEN.xuLyNgoai;
  const cpVcGiaoHang = (Number(tr.kmGiaoHang) || 0) * DG_VAN_CHUYEN.giaoHang * (Number(tr.chuyenGiaoHang) || 0);
  const cpLapDat = (Number(tr.soLuongLapDat) || 0) * DG_VAN_CHUYEN.lapDat;
  const cpQuanLy = (cpVatTu + cpSanXuat) * ((Number(co.quanLy) || 0) / 100);

  // Giá gốc = tổng chi phí trực tiếp × (1 + chi phí chung)
  const truocChung = cpVatTu + cpSanXuat + cpVcNoiBo + cpVcGiaoHang + cpLapDat + cpQuanLy;
  const giaGoc = truocChung * (1 + (Number(co.chung) || 0) / 100);

  /* --- Đơn giá đề xuất từ hệ số ---
     Đơn giá phải gánh cả chi phí xử lý (tính theo % doanh thu), lợi nhuận
     và dự phòng giảm giá:  P = Giá gốc × (1+LN) / (1 − Xử lý − Dự phòng)  */
  const pXuLy = (Number(co.xuLy) || 0) / 100;
  const duPhongKH = (PHAN_LOAI_KH[quote.customerClass] || {}).duPhong || 0;
  const pDuPhong = ((Number(co.duPhong) || 0) + duPhongKH) / 100;
  const pLoiNhuan = (Number(co.loiNhuan) || 0) / 100;
  const mauSo = Math.max(0.05, 1 - pXuLy - pDuPhong);
  const donGiaDeXuat = blankWeight > 0 ? (giaGoc * (1 + pLoiNhuan)) / mauSo / blankWeight : 0;

  // Đơn giá chốt: người lập nhập tay, mặc định lấy theo đề xuất
  const donGiaChot = Number(quote.unitPrice) > 0 ? Number(quote.unitPrice) : donGiaDeXuat;

  const thanhTien = donGiaChot * blankWeight;
  const cpXuLy = thanhTien * pXuLy;
  const conLai = thanhTien - (cpVatTu + cpSanXuat + cpVcNoiBo + cpVcGiaoHang + cpLapDat + cpQuanLy + cpXuLy);

  const perKg = (v) => (blankWeight > 0 ? v / blankWeight : 0);

  return {
    rows, blankWeight, materialWeight, outsourceWeight, surfaceArea, matAreaEquiv,
    heSoDacThu, duPhongKH,
    // thành tiền
    cpVatTu, cpSanXuat, cpVcNoiBo, cpVcGiaoHang, cpLapDat, cpQuanLy, cpXuLy, conLai,
    giaGoc, thanhTien, donGiaChot, donGiaDeXuat,
    // đơn giá VND/kg
    dgVatTu: perKg(cpVatTu), dgSanXuat: perKg(cpSanXuat), dgVcNoiBo: perKg(cpVcNoiBo),
    dgVcGiaoHang: perKg(cpVcGiaoHang), dgLapDat: perKg(cpLapDat), dgQuanLy: perKg(cpQuanLy),
    dgXuLy: perKg(cpXuLy), dgConLai: perKg(conLai), dgGiaGoc: perKg(giaGoc),
    // chỉ tiêu đánh giá
    loiNhuanThuc: thanhTien > 0 ? (conLai / thanhTien) * 100 : 0,
    duoiGiaGoc: thanhTien < giaGoc,
  };
}

/** Quy bảng phân tích thành các dòng hạng mục để in báo giá / chuyển đơn hàng */
function quoteLinesFromInputs(quote) {
  const pt = phanTichGia(quote);
  return pt.rows.map((r, i) => {
    const amount = pt.donGiaChot * r.blankWeight;
    const qty = Number(r.qty) || 0;
    return {
      no: i + 1,
      productId: r.productId || '',
      name: r.name || r.productGroup || 'Hạng mục ' + (i + 1),
      spec: [r.productGroup, r.summary].filter(Boolean).join(' · '),
      unit: r.unit || 'Cái',
      qty,
      price: qty > 0 ? Math.round(amount / qty) : 0,
      amount: Math.round(amount),
      blankWeight: r.blankWeight,
      materialWeight: r.materialWeight,
      surfaceArea: r.surfaceArea,
    };
  });
}

/** Giá trị hàng hóa (chưa VAT) của một báo giá — dùng chung cho cả 2 kiểu lập giá */
function quoteSubtotal(q) {
  if (!q) return 0;
  return q.inputs ? Math.round(phanTichGia(q).thanhTien) : (q.subtotal || 0);
}

/** Số chủng loại vật tư / công đoạn đã bóc tách trong báo giá */
function quoteBreakdownCount(q) {
  if (q.inputs) {
    const mats = new Set(q.inputs.map((r) => `${r.material}|${r.property}|${r.thickness}`));
    const ops = new Set();
    q.inputs.forEach((r) => NGUYEN_CONG.forEach((n) => { if (Number(r.ops?.[n.key]) > 0) ops.add(n.key); }));
    return { mat: mats.size, op: ops.size };
  }
  return {
    mat: new Set((q.items || []).flatMap((i) => (i.materials || []).map((m) => m.materialId))).size,
    op: new Set((q.items || []).flatMap((i) => (i.operations || []).map((o) => o.operationId))).size,
  };
}

/** Dòng tham số rỗng để thêm mới.
 *  name = Tên sản phẩm (tự do) · productGroup = Thông số cấu kiện (chọn danh mục) */
function dongThamSoMoi(stt, quoteCode) {
  return {
    id: 'IF' + String(stt).padStart(4, '0'),
    quoteCode: quoteCode || '', stt,
    name: '', productGroup: nhomSanPham()[0] || 'Máng cáp',
    material: 'Thép', shape: 'Tấm', property: 'cán nóng', surface: 'Sơn tĩnh điện',
    L: 1000, W: 200, H: 50, D: 0, W1: 20, H1: 12, step: 0, thickness: 1.5,
    wastePct: 5,
    ops: { catTam: 1, catOng: 0, chan: 1, uon: 0, han: 1, mai: 0, lamSach: 0, khac: 0 },
    pieceQty: 1, complexity: 'Đơn giản',
    qty: 0, unit: 'm',
    auxPct: 3, specialWeight: 0,
    matPrice: '', surfacePrice: '', otherCost: '',
    note: '',
  };
}

/* ============================================================================
 * YC-01 — THƯ VIỆN MẪU CẤU KIỆN
 * Lưu nguyên một dòng tham số đã khai thành mẫu, lần sau chọn 1 phát là ra
 * đầy đủ tên sản phẩm và toàn bộ tham số giống hệt.
 * ==========================================================================*/

/** Các trường của dòng tham số được ghi vào mẫu (bỏ ID/STT/mã báo giá) */
const TRUONG_MAU = [
  'name', 'productGroup', 'material', 'shape', 'property', 'surface',
  'L', 'W', 'H', 'D', 'W1', 'H1', 'step', 'thickness', 'wastePct',
  'pieceQty', 'complexity', 'qty', 'unit', 'auxPct', 'specialWeight',
  'matPrice', 'surfacePrice', 'otherCost', 'note',
];

DB.ckTemplates = [];

/** Tạo mẫu từ một dòng tham số */
function taoMauCauKien(row, tenMau) {
  const data = {};
  TRUONG_MAU.forEach((k) => { data[k] = row[k] !== undefined ? row[k] : ''; });
  data.ops = { ...(row.ops || {}) };
  const id = 'MCK-' + String(DB.ckTemplates.reduce((m, t) => Math.max(m, Number(String(t.id).split('-')[1]) || 0), 0) + 1).padStart(3, '0');
  const tpl = {
    id,
    name: (tenMau || row.name || row.productGroup || 'Mẫu cấu kiện').trim(),
    group: row.productGroup || '',
    used: 0,
    createdAt: DB.today,
    data,
  };
  DB.ckTemplates.push(tpl);
  return tpl;
}

/** Dựng một dòng tham số mới từ mẫu — mọi trường giống hệt, chỉ cấp lại ID/STT */
function dongTuMau(tpl, stt, quoteCode) {
  const row = dongThamSoMoi(stt, quoteCode);
  TRUONG_MAU.forEach((k) => { if (tpl.data[k] !== undefined) row[k] = tpl.data[k]; });
  row.ops = { ...(tpl.data.ops || {}) };
  return row;
}

/** Tóm tắt quy cách của mẫu để hiển thị trong danh sách chọn */
function tomTatMau(tpl) {
  const d = tpl.data;
  const kt = [d.W && d.H ? `${fmtDec(d.W, 0)}×${fmtDec(d.H, 0)}` : d.W ? `W${fmtDec(d.W, 0)}` : '', d.thickness ? `dày ${fmtDec(d.thickness, 2)}` : '']
    .filter(Boolean).join(' · ');
  return [d.productGroup, kt, d.material, d.surface !== 'Không' ? d.surface : ''].filter(Boolean).join(' · ');
}

/* YC-01.11 — Nạp sẵn một số mẫu thông dụng lấy từ chính báo giá BG001
 * để người dùng chọn được ngay mà không phải khai từ đầu. */
(function napMauMacDinh() {
  const bg = DB.quotes.find((q) => q.quoteCode === 'BG001');
  if (!bg) return;
  const stts = [1, 5, 8, 11, 12, 13, 17, 19, 21, 31];
  stts.forEach((s) => {
    const r = bg.inputs.find((x) => x.stt === s);
    if (!r) return;
    // Không dùng hàm định dạng của app.core ở đây vì file này nạp trước
    const ten = r.name || `${r.productGroup} ${r.W}${r.H ? '×' + r.H : ''} dày ${String(r.thickness).replace('.', ',')}mm`;
    const tpl = taoMauCauKien(r, ten);
    tpl.used = [12, 9, 7, 6, 6, 4, 3, 3, 2, 1][stts.indexOf(s)] || 0;
  });
})();
