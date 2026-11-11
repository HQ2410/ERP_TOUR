/* ============================================================================
 * HR PAYROLL ENGINE — bộ máy tính công & lương (thuần logic, không đụng DOM)
 * ----------------------------------------------------------------------------
 * Dựa trên file "quy trình công lương" của công ty:
 *   - 19 ca làm việc, máy chấm công MTACO 5000A (giờ vào/ra, công "X")
 *   - Thang bảng lương theo bộ phận & bậc (đơn giá ngày)
 *   - Phụ cấp: chuyên cần, thâm niên, trách nhiệm, bằng cấp, nhà ở, xăng, điện thoại, tiền cơm,
 *     bồi dưỡng đêm; tăng ca 1.2 / 1.4 / CN / lễ; công dôi; về giữa ca; phép năm; hiếu hỉ
 *   - Tài xế / giao hàng tính theo công A/B/C và KPI; bốc xếp tính tấn
 *   - Trừ: KPI, bảo hiểm (BHXH+BHYT+BHTN), công đoàn, thuế TNCN, truy thu bảo hiểm
 * Các điểm file chưa nêu rõ được đặt thành tham số trong DEFAULT_CONFIG (đánh dấu ASSUMPTION)
 * để kế toán chỉnh trong màn Cấu hình lương.
 * ========================================================================== */
(function (root) {
  'use strict';

  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const r0 = (v) => Math.round(n(v));
  const r2 = (v) => Math.round(n(v) * 100) / 100;
  const roundHalf = (v) => Math.round(n(v) * 2) / 2;

  /* ------------------------------------------------------------------ thời gian */
  function parseHM(s) {
    const m = /^\s*(\d{1,2})\s*(?:h|H|:|giờ)\s*(\d{1,2})?\s*$/.exec(String(s ?? '').replace('.', ':'));
    if (!m) return null;
    const h = +m[1], mi = m[2] ? +m[2] : 0;
    if (h > 47 || mi > 59) return null;
    return h * 60 + mi;
  }
  const fmtHM = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const weekday = (s) => { const p = parseYmd(s); return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : -1; }; // 0 = CN
  const monthDays = (month) => { const p = parseYmd(month + '-01'); return p ? Array.from({ length: dim(p.y, p.m) }, (_, i) => ymd(p.y, p.m, i + 1)) : []; };

  /* ------------------------------------------------------------------ cấu hình mặc định (theo file) */
  const SHIFT_ROWS = [
    ['05:00', '13:00', 'ĐẬU HỦ, NẤU DẦU, NHÀ ĂN'],
    ['05:30', '13:30', 'ĐÓNG GÓI, ĐẬU HỦ, NẤU DẦU, NHÀ ĂN, KHO, CƠ KHÍ, TẠP VỤ, TRỘN CÁI'],
    ['06:00', '14:00', 'ĐẬU HỦ, NẤU DẦU, KHO, NHÀ ĂN, TẠP VỤ, VƯƠNG QUỐC'],
    ['06:30', '14:30', 'ĐẬU HỦ'],
    ['07:00', '15:00', 'NẤU DẦU'],
    ['07:30', '16:00', 'KẾ TOÁN, NHÂN SỰ, QUẢN LÝ, KINH DOANH, KHO, RD, KCS, ĐÓNG GÓI, ĐẬU HỦ, CƠ KHÍ, TẠP VỤ'],
    ['08:00', '16:00', 'NẤU DẦU'],
    ['09:00', '17:00', 'KCS'],
    ['09:30', '17:30', 'NẤU DẦU, ĐẬU HỦ'],
    ['11:30', '19:30', 'NẤU DẦU'],
    ['13:00', '21:00', 'NẤU DẦU, VƯƠNG QUỐC'],
    ['13:30', '21:30', 'ĐÓNG GÓI, ĐẬU HỦ, NẤU DẦU, NHÀ ĂN, KHO, CƠ KHÍ'],
    ['14:00', '22:00', 'NHÀ ĂN'],
    ['15:00', '23:00', 'NHÀ ĂN'],
    ['17:30', '01:30', 'ĐÓNG GÓI, ĐẬU HỦ, CƠ KHÍ, KHO'],
    ['18:30', '02:30', 'ĐẬU HỦ'],
    ['19:30', '03:30', 'ĐẬU HỦ'],
    ['20:30', '04:30', 'ĐẬU HỦ'],
    ['21:30', '05:30', 'ĐẬU HỦ, ĐÓNG GÓI, CƠ KHÍ, KCS'],
  ];
  const DEPTS = ['ĐẬU HỦ', 'NẤU DẦU', 'NHÀ ĂN', 'ĐÓNG GÓI', 'KHO', 'CƠ KHÍ', 'TẠP VỤ', 'TRỘN CÁI', 'VƯƠNG QUỐC', 'KẾ TOÁN', 'NHÂN SỰ', 'QUẢN LÝ', 'KINH DOANH', 'RD', 'KCS', 'TÀI XẾ', 'GIAO HÀNG', 'BỐC XẾP', 'BẢO VỆ', 'THỜI VỤ'];
  const G = (code, name, kind, grades) => ({ code, name, kind, grades });
  const std4 = (a1, a, b, c) => [{ code: 'A1', rate: a1 }, { code: 'A', rate: a }, { code: 'B', rate: b }, { code: 'C', rate: c }];
  const std5 = (a1, a, b, c, d) => [...std4(a1, a, b, c), { code: 'D', rate: d }];
  const PAY_GROUPS = [
    G('G01', 'Bộ phận phục vụ xưởng đóng gói - đậu hũ', 'DAY', std4(230000, 220000, 210000, 200000)),
    G('G02', 'Bộ phận phục vụ xưởng nấu dầu', 'DAY', std4(230000, 220000, 210000, 200000)),
    G('G03', 'Bộ phận sản xuất trực tiếp nhà ăn', 'DAY', std4(230000, 220000, 210000, 200000)),
    G('G04', 'Bộ phận phục vụ xưởng tạp vụ đóng gói', 'DAY', std4(230000, 220000, 210000, 200000)),
    G('G05', 'Bộ phận phục vụ xưởng tạp vụ nấu dầu', 'DAY', std4(230000, 220000, 210000, 200000)),
    G('G06', 'Cơ điện — trung cấp, cao đẳng', 'DAY', std5(270000, 260000, 250000, 240000, 230000)),
    G('G07', 'Cơ điện — đại học', 'DAY', std5(275000, 265000, 255000, 245000, 235000)),
    G('G08', 'Kế toán - nhân sự - kế hoạch kho (hành chính) — đại học', 'DAY', std5(275000, 265000, 255000, 245000, 235000)),
    G('G09', 'Kế toán - nhân sự - kế hoạch kho (hành chính) — trung cấp, cao đẳng', 'DAY', std5(270000, 260000, 250000, 240000, 230000)),
    G('G10', 'QLSX - KCS - RD — đại học', 'DAY', [{ code: 'DHA1', rate: 275000 }, { code: 'DHA', rate: 265000 }, { code: 'DHB', rate: 255000 }, { code: 'DHC', rate: 245000 }, { code: 'DHD', rate: 235000 }]),
    G('G11', 'QLSX - KCS - RD — trung cấp, cao đẳng', 'DAY', std5(270000, 260000, 250000, 240000, 230000)),
    G('G12', 'Tài xế', 'DAY', [{ code: 'A1', rate: 270000 }, { code: 'A', rate: 255000 }, { code: 'B', rate: 240000 }]),
    G('G13', 'Bộ phận kinh doanh — đại học', 'DAY', std5(275000, 265000, 255000, 245000, 235000)),
    G('G14', 'Bộ phận kinh doanh — trung cấp, cao đẳng', 'DAY', std5(270000, 260000, 250000, 240000, 230000)),
    G('G15', 'Thời vụ', 'SEASONAL', [{ code: 'TV', rate: 230809 }]),
    G('G16', 'Giao hàng', 'DAY', std4(250000, 230000, 220000, 210000)),
    G('G17', 'Bảo vệ (khoán tháng)', 'FLAT', [{ code: 'KHOAN', rate: 8000000 }]),
  ];
  const RESPONSIBILITY = [
    ['TRUONG_PHONG', 'Trưởng phòng', 2000000], ['CHUYEN_VIEN', 'Chuyên viên', 2000000], ['PHO_PHONG', 'Phó phòng', 1200000],
    ['TRUONG_BO_PHAN', 'Trưởng bộ phận', 1000000], ['TRUONG_CA', 'Trưởng ca', 800000], ['TO_TRUONG_CK_KHO', 'Tổ trưởng cơ khí, kho', 700000],
    ['PHO_CA', 'Phó ca', 700000], ['NV_QLSX', 'Nhân viên QLSX', 800000], ['KE_TOAN_NHAN_SU', 'Kế toán, nhân sự', 450000],
  ];

  function defaultConfig() {
    return {
      version: 1,
      standardDays: 26,                 // công chuẩn tháng (file: "x 26")
      workHoursPerShift: 8,
      fullDayToleranceMin: 30,          // ASSUMPTION: trễ/sớm trong 30' vẫn tính đủ 1 công (chỉ cảnh báo). File: "chênh lệch 30 phút đến 2h"
      shiftMatchMaxMinutes: 120,        // giờ vào lệch ca tối đa 2h thì vẫn gán ca gần nhất
      otMinMinutes: 30, otStepMinutes: 30,
      shifts: SHIFT_ROWS.map(([s, e, d], i) => ({ code: 'CA' + String(i + 1).padStart(2, '0'), start: s, end: e, workHours: 8, depts: d.split(',').map((x) => x.trim()), note: '' })),
      depts: DEPTS.slice(),
      payGroups: JSON.parse(JSON.stringify(PAY_GROUPS)),
      flat: { hoursPerDay: 12, daysPerMonth: 30 },        // bảo vệ: 8.000.000 / 30 ngày / 12 giờ
      congDoiCoef: 1.0,                                    // ASSUMPTION: công dôi (vượt công chuẩn) trả theo đơn giá ngày × hệ số
      allowances: {
        attendance: { amount: 500000, maxAbsentDays: 1.5, leaveCountsAsAbsent: true },
        seniority: { tiers: [{ afterYears: 0, rate: 4180 }, { afterYears: 5, rate: 4807 }, { afterYears: 10, rate: 5434 }], daysPerMonth: 26 }, // PC tháng = đơn giá × 26 × số năm
        responsibility: RESPONSIBILITY.map(([code, name, amount]) => ({ code, name, amount })),
        degree: [{ code: 'UNIVERSITY', name: 'Đại học', amount: 1000000 }, { code: 'COLLEGE', name: 'Cao đẳng + trung cấp', amount: 500000 }],
        hieuHiMaxDays: 3,                                  // trợ cấp hiếu hỉ/đám tang: 3 ngày theo ngày công thực lãnh
      },
      ot: {
        tc12: 1.2, tc14: 1.4, tc12Hours: 2,                // ASSUMPTION: 2 giờ đầu mỗi ngày hệ số 1.2, phần còn lại 1.4
        sunday: 2.0, holiday: 3.0,                         // ASSUMPTION: mức tối thiểu BLLĐ 2019 (200% / 300%)
        nightUnit: 'NIGHT', nightRate: 0, nightMinHours: 3, // bồi dưỡng đêm: đơn giá chưa có trong file → 0
      },
      driver: {
        cong: [{ code: 'A', rate: 300000, minOrders: 0 }, { code: 'B', rate: 250000, minOrders: 0 }, { code: 'C', rate: 200000, minOrders: 0 }],
        kpiPool: 400000, driverPct: 28, helperPct: 22,     // thưởng KPI không rớt đơn: tài xế 28%, giao hàng 22% trên tổng 400K
      },
      loader: { ratePerTon: 0 },                           // bốc xếp tính tấn; đơn giá chưa có trong file
      insurance: { bhxh: 8, bhyt: 1.5, bhtn: 1, union: 1, referenceLevel: 2340000, capMultiple: 20, regionMinWage: 5310000 },
      tax: { personal: 15500000, dependent: 6200000, brackets: [[10e6, 0.05], [30e6, 0.10], [60e6, 0.20], [100e6, 0.30], [Infinity, 0.35]], flatRate: 0.10, flatThreshold: 2000000 },
      taxExempt: { meal: false, hieuHi: false },           // mặc định chịu thuế; kế toán tick nếu thuộc diện miễn
      holidays: [{ date: '01-01', name: 'Tết Dương lịch', fixed: true }, { date: '04-30', name: 'Ngày Giải phóng miền Nam', fixed: true }, { date: '05-01', name: 'Quốc tế Lao động', fixed: true }, { date: '09-02', name: 'Quốc khánh', fixed: true }],
      extraHolidays: [],                                   // [{date:'2026-02-17', name:'Tết âm lịch'}] — ngày lễ không cố định
    };
  }
  const deepMerge = (base, over) => {
    if (Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || base === null || typeof over !== 'object' || over === null) return over === undefined ? base : over;
    const out = { ...base }; Object.keys(over).forEach((k) => { out[k] = k in base ? deepMerge(base[k], over[k]) : over[k]; }); return out;
  };
  const mergeConfig = (saved) => deepMerge(defaultConfig(), saved || {});

  function holidaySet(cfg, year) {
    const s = new Map();
    (cfg.holidays || []).forEach((h) => { if (h.fixed) s.set(`${year}-${h.date}`, h.name); else s.set(h.date, h.name); });
    (cfg.extraHolidays || []).forEach((h) => s.set(h.date, h.name));
    return s;
  }

  /* ------------------------------------------------------------------ ca làm việc */
  function shiftSpan(sh) {
    const s = parseHM(sh.start), e0 = parseHM(sh.end); if (s == null || e0 == null) return null;
    const e = e0 <= s ? e0 + 1440 : e0;
    return { start: s, end: e, span: e - s, crosses: e > 1440 };
  }
  /** Gán ca theo giờ vào: ca có giờ bắt đầu gần nhất (ưu tiên ca thuộc bộ phận của nhân viên). */
  function matchShift(inMin, shifts, workDept, maxDiff) {
    const pool = (workDept ? shifts.filter((s) => (s.depts || []).includes(workDept)) : []);
    const tryPool = (list) => {
      let best = null;
      list.forEach((s) => {
        const sp = shiftSpan(s); if (!sp) return;
        let d = Math.abs(inMin - sp.start); d = Math.min(d, 1440 - d);
        if (!best || d < best.d) best = { s, sp, d };
      });
      return best && best.d <= maxDiff ? best : null;
    };
    return tryPool(pool) || tryPool(shifts);
  }

  /* ------------------------------------------------------------------ công theo ngày */
  const MARKS = { X: { label: 'Đi làm', cong: 1 }, 'X/2': { label: 'Nửa công', cong: 0.5 }, P: { label: 'Phép năm', leave: 1 }, L: { label: 'Nghỉ lễ hưởng lương', cong: 1, holiday: true }, N: { label: 'Nghỉ không lương', cong: 0 }, KP: { label: 'Nghỉ không phép', cong: 0 } };

  /**
   * rec: { date, in:'05:02', out:'13:10', shiftCode?, mark?, note? }
   * ctx: { cfg, shifts, holidays:Map, workDept }
   * Trả về các đại lượng của một ngày, kèm danh sách cảnh báo (flags).
   */
  function calcDay(rec, ctx) {
    const cfg = ctx.cfg, date = rec.date, flags = [];
    const wd = weekday(date), hol = ctx.holidays.get(date);
    const dayType = hol ? 'HOLIDAY' : wd === 0 ? 'SUNDAY' : 'NORMAL';
    const out = { date, dayType, holiday: hol || '', mark: rec.mark || '', shift: '', cong: 0, leave: 0, vgc: 0, ot12: 0, ot14: 0, otCn: 0, otLe: 0, nightUnits: 0, workedHours: 0, lateMin: 0, earlyMin: 0, scheduled: dayType === 'NORMAL', flags };
    const inMin = parseHM(rec.in), outMin = parseHM(rec.out);
    const hasIn = inMin != null, hasOut = outMin != null;
    const mark = rec.mark ? String(rec.mark).toUpperCase() : '';

    if (hasIn !== hasOut) flags.push(hasIn ? 'MISSING_OUT' : 'MISSING_IN');
    if (mark && !MARKS[mark]) flags.push('BAD_MARK');

    // Đánh dấu thủ công (X, X/2, P, L, N, KP) khi không có đủ giờ vào/ra
    if (!(hasIn && hasOut)) {
      const mk = MARKS[mark];
      if (mk) {
        out.cong = mk.cong || 0; out.leave = mk.leave || 0;
        if (mark === 'X' || mark === 'X/2') flags.push('NO_PUNCH'); // có công nhưng thiếu giờ → kế toán phải kiểm giờ
      }
      return out;
    }

    // Có đủ giờ vào/ra
    let best = null;
    if (rec.shiftCode) { const s = ctx.shifts.find((x) => x.code === rec.shiftCode); const sp = s && shiftSpan(s); if (sp) best = { s, sp, d: 0 }; }
    if (!best) best = matchShift(inMin, ctx.shifts, ctx.workDept, cfg.shiftMatchMaxMinutes);
    let start, end, workHours, shiftCode = '';
    if (best) { start = best.sp.start; end = best.sp.end; workHours = n(best.s.workHours) || cfg.workHoursPerShift; shiftCode = best.s.code; if (best.d >= 30) flags.push('SHIFT_DIFF'); }
    else { start = inMin; end = inMin + cfg.workHoursPerShift * 60; workHours = cfg.workHoursPerShift; flags.push('NO_SHIFT'); }
    out.shift = shiftCode;
    let tIn = inMin, tOut = outMin;
    if (start >= 1440) { /* không xảy ra */ }
    // ca qua đêm: giờ ra nhỏ hơn giờ vào → cộng 24h; vào sau nửa đêm của ca qua đêm cũng quy về cùng trục
    if (tOut <= tIn) tOut += 1440;
    if (best && best.sp.crosses && tIn < start - 720) { tIn += 1440; tOut += 1440; }
    const span = end - start, breakMin = Math.max(0, span - workHours * 60);
    const winIn = Math.max(tIn, start), winOut = Math.min(tOut, end);
    const winWorked = Math.max(0, winOut - winIn);
    const late = Math.max(0, tIn - start), early = Math.max(0, end - tOut), after = Math.max(0, tOut - end);
    out.lateMin = late; out.earlyMin = early;
    out.workedHours = r2(Math.max(0, (tOut - tIn) - (tOut - tIn >= span - 60 ? breakMin : 0)) / 60);
    if (late > cfg.fullDayToleranceMin) flags.push('LATE');
    if (early > cfg.fullDayToleranceMin) flags.push('EARLY_LEAVE');

    // Thời gian ban đêm 22:00–06:00
    const nightOverlap = (a, b) => { let t = 0; for (let k = -1; k <= 2; k++) { const ns = 1320 + k * 1440, ne = ns + 480; t += Math.max(0, Math.min(b, ne) - Math.max(a, ns)); } return t; };
    const nightH = nightOverlap(tIn, tOut) / 60;
    if (cfg.ot.nightUnit === 'HOUR') out.nightUnits = r2(nightH); else out.nightUnits = nightH >= n(cfg.ot.nightMinHours) ? 1 : 0;

    const otHours = (mins) => { const m = n(cfg.otMinMinutes), st = Math.max(1, n(cfg.otStepMinutes)); return mins >= m ? Math.floor(mins / st) * st / 60 : 0; };
    if (dayType === 'SUNDAY' || dayType === 'HOLIDAY') {
      const paid = Math.max(0, (tOut - tIn) - (tOut - tIn >= span - 60 ? breakMin : 0));
      const h = otHours(paid);
      if (dayType === 'HOLIDAY') out.otLe = h; else out.otCn = h;
      out.cong = 0; out.scheduled = false;
      return out;
    }
    // Ngày thường
    if (late + early <= cfg.fullDayToleranceMin) out.cong = 1;
    else { out.vgc = r2(Math.min(0.99, winWorked / span)); flags.push('PARTIAL'); }
    const ot = otHours(after);
    if (ot > 0) { const h12 = Math.min(ot, n(cfg.ot.tc12Hours)); out.ot12 = h12; out.ot14 = ot - h12; }
    return out;
  }

  /* ------------------------------------------------------------------ tổng hợp tháng của một nhân viên */
  function summarizeMonth(month, records, ctx) {
    const days = monthDays(month); const map = new Map((records || []).map((r) => [r.date, r]));
    const res = [];
    days.forEach((d) => { const rec = map.get(d) || { date: d }; res.push(calcDay(rec, ctx)); });
    const hasRec = (d) => map.has(d);
    const sum = (k) => r2(res.reduce((s, x) => s + n(x[k]), 0));
    const scheduledDays = res.filter((x) => x.scheduled).length;
    const worked = res.filter((x) => x.dayType === 'NORMAL');
    const holidayPaid = res.filter((x) => x.dayType === 'HOLIDAY' && x.mark === 'L').length;
    const t = {
      days: res, scheduledDays, cong: r2(worked.reduce((s, x) => s + x.cong, 0) + holidayPaid), vgc: sum('vgc'), leave: sum('leave'),
      ot12: sum('ot12'), ot14: sum('ot14'), otCn: sum('otCn'), otLe: sum('otLe'), nightUnits: sum('nightUnits'),
      lateDays: res.filter((x) => x.flags.includes('LATE')).length, earlyDays: res.filter((x) => x.flags.includes('EARLY_LEAVE')).length,
      workedHours: sum('workedHours'), punchedDays: res.filter((x) => x.workedHours > 0).length,
      anomalies: [],
    };
    res.forEach((x) => { const f = x.flags.filter((k) => ['MISSING_IN', 'MISSING_OUT', 'NO_PUNCH', 'NO_SHIFT', 'SHIFT_DIFF', 'BAD_MARK'].includes(k)); if (f.length) t.anomalies.push({ date: x.date, flags: f }); });
    // Có giờ vào/ra nhưng chưa có công "X" (file: kiểm giờ những người không đổ công)
    res.forEach((x) => { const rec = map.get(x.date); if (rec && parseHM(rec.in) != null && parseHM(rec.out) != null && !rec.mark) t.anomalies.push({ date: x.date, flags: ['NO_MARK'] }); });
    t.hasData = (records || []).length > 0;
    return t;
  }

  /* ------------------------------------------------------------------ thâm niên */
  function seniorityYears(startYmd, month) {
    const s = parseYmd(startYmd), e = parseYmd(month + '-01'); if (!s || !e) return 0;
    const endM = { y: e.y, m: e.m, d: dim(e.y, e.m) };
    let y = endM.y - s.y; if (endM.m < s.m || (endM.m === s.m && endM.d < s.d)) y--;
    return Math.max(0, y);
  }
  function seniorityRate(years, tiers) { let rate = 0; (tiers || []).slice().sort((a, b) => a.afterYears - b.afterYears).forEach((t) => { if (years > t.afterYears) rate = t.rate; }); return rate; }

  /* ------------------------------------------------------------------ thuế TNCN */
  function progressiveTax(taxable, brackets) {
    let left = Math.max(0, taxable), prev = 0, tax = 0;
    for (const [cap, rate] of brackets) { const slice = Math.min(left, cap - prev); if (slice <= 0) break; tax += slice * rate; left -= slice; prev = cap; if (left <= 0) break; }
    return Math.round(tax);
  }

  /* ------------------------------------------------------------------ lương tháng */
  function findGroup(cfg, code) { return (cfg.payGroups || []).find((g) => g.code === code); }
  function dayRateOf(emp, cfg) {
    const p = emp.payProfile || {}; const g = findGroup(cfg, p.payGroup); if (!g) return { rate: n(p.customDayRate), kind: p.payType || 'DAY', group: null };
    const grade = g.grades.find((x) => x.code === p.grade) || g.grades[0];
    if (g.kind === 'FLAT') return { rate: n(grade?.rate) / n(cfg.flat.daysPerMonth), kind: 'FLAT', monthly: n(grade?.rate), group: g };
    return { rate: n(p.customDayRate) || n(grade?.rate), kind: g.kind, group: g };
  }
  const ADJ = ['hieuHiDays', 'kpiStore', 'kpiDeduct', 'truyThuBH', 'otherBonus', 'otherDeduct', 'noDropOrders'];

  /**
   * emp: nhân viên (có payProfile)
   * ctx: { cfg, month, summary (từ summarizeMonth), stats:[{date,type,orders,tons,level}], adj:{hieuHiDays,...} }
   */
  function calcPayroll(emp, ctx) {
    const cfg = ctx.cfg, p = emp.payProfile || {}, sm = ctx.summary || summarizeMonth(ctx.month, [], ctx.monthCtx), adj = ctx.adj || {};
    const dr = dayRateOf(emp, cfg); const payType = p.payType || (dr.kind === 'FLAT' ? 'FLAT' : dr.kind === 'SEASONAL' ? 'SEASONAL' : 'DAY');
    const flat = payType === 'FLAT'; const std = flat ? n(cfg.flat.daysPerMonth) : n(cfg.standardDays);
    const hourly = dr.rate / (flat ? n(cfg.flat.hoursPerDay) : n(cfg.workHoursPerShift));
    const r = { empId: emp.id, name: emp.name, payType, dayRate: r0(dr.rate), std, groupName: dr.group?.name || '', grade: p.grade || '', warnings: [] };
    if (!dr.rate && payType !== 'LOADER') r.warnings.push('Chưa chọn nhóm/bậc lương (đơn giá ngày = 0).');

    const cong = sm.cong;
    // --- 2/3 Số công, thành tiền (và 4/5 công dôi)
    const stats = (ctx.stats || []).filter((s) => s.empId === emp.id);
    let congPaid = Math.min(cong, std), congDoi = Math.max(0, r2(cong - std)), amt3 = 0, avgRate = dr.rate;
    if (payType === 'DRIVER') {
      const lv = Object.fromEntries((cfg.driver.cong || []).map((c) => [c.code, n(c.rate)]));
      const byDay = new Map(stats.filter((s) => s.type === 'DELIVERY').map((s) => [s.date, s]));
      let total = 0, counted = 0;
      sm.days.filter((d) => d.dayType === 'NORMAL' && d.cong > 0).forEach((d) => { const st = byDay.get(d.date); const rate = st && lv[st.level] ? lv[st.level] : dr.rate; total += rate * d.cong; counted += d.cong; });
      if (counted > 0) { avgRate = total / counted; amt3 = avgRate * congPaid; } else amt3 = dr.rate * congPaid;
      const missing = sm.days.filter((d) => d.dayType === 'NORMAL' && d.cong > 0 && !byDay.get(d.date)).length;
      if (missing) r.warnings.push(`${missing} ngày chưa có thống kê đơn/chuyến → tính theo đơn giá thang bậc.`);
    } else if (payType === 'LOADER') {
      const tons = stats.filter((s) => s.type === 'LOADING').reduce((a, s) => a + n(s.tons), 0);
      r.tons = r2(tons); amt3 = tons * n(cfg.loader.ratePerTon); congPaid = 0; congDoi = 0;
      if (!n(cfg.loader.ratePerTon)) r.warnings.push('Chưa cấu hình đơn giá bốc xếp theo tấn.');
    } else amt3 = dr.rate * congPaid;
    r.cong = cong; r.congPaid = congPaid; r.amtCong = r0(amt3);
    r.congDoi = congDoi; r.amtCongDoi = r0(congDoi * avgRate * n(cfg.congDoiCoef));
    // --- 6/7 Trợ cấp hiếu hỉ
    const hh = Math.min(n(adj.hieuHiDays), n(cfg.allowances.hieuHiMaxDays)); r.hieuHiDays = hh; r.amtHieuHi = r0(hh * dr.rate);
    // --- 9 Về giữa ca
    r.vgc = sm.vgc; r.amtVgc = r0(sm.vgc * dr.rate);
    // --- 11–14 Tăng ca
    r.ot12 = sm.ot12; r.amtOt12 = r0(sm.ot12 * hourly * n(cfg.ot.tc12));
    r.ot14 = sm.ot14; r.amtOt14 = r0(sm.ot14 * hourly * n(cfg.ot.tc14));
    r.otCn = sm.otCn; r.amtOtCn = r0(sm.otCn * hourly * n(cfg.ot.sunday));
    r.otLe = sm.otLe; r.amtOtLe = r0(sm.otLe * hourly * n(cfg.ot.holiday));
    // --- 15 Phép năm
    r.phepNam = sm.leave; r.amtPhepNam = r0(sm.leave * dr.rate);
    // --- công tính phụ cấp theo số công (đi làm + phép + công lẻ), tối đa công chuẩn
    const paidCong = Math.min(std, cong + sm.leave + sm.vgc);
    const factor = std > 0 ? paidCong / std : 0;
    // --- 16 Trách nhiệm
    const resp = (cfg.allowances.responsibility || []).find((x) => x.code === p.responsibility);
    r.amtResp = r0(n(resp?.amount) * factor);
    // --- 17 Thưởng hoàn thành (số công)
    r.amtCompletion = r0(n(p.completionPerDay) * Math.min(cong, std));
    // --- 18–20 Nhà ở, xăng, điện thoại
    const al = p.allowances || {};
    r.amtHousing = r0(n(al.housing) * factor); r.amtFuel = r0(n(al.fuel) * factor); r.amtPhone = r0(n(al.phone) * factor);
    // --- 22 Thâm niên
    const yrs = seniorityYears(p.seniorityStart || emp.joinDate, ctx.month); r.seniorityYears = yrs;
    r.amtSeniority = r0(seniorityRate(yrs, cfg.allowances.seniority.tiers) * n(cfg.allowances.seniority.daysPerMonth) * yrs);
    // --- 23 Tiền cơm
    r.amtMeal = r0(n(p.mealPerDay) * Math.min(cong + sm.vgc, std));
    // --- 24 Bồi dưỡng đêm
    r.nightUnits = sm.nightUnits; r.amtNight = r0(sm.nightUnits * n(cfg.ot.nightRate));
    if (sm.nightUnits > 0 && !n(cfg.ot.nightRate)) r.warnings.push('Có ca đêm nhưng chưa cấu hình đơn giá bồi dưỡng đêm.');
    // --- Chuyên cần
    const absent = Math.max(0, r2(sm.scheduledDays - (cong + sm.vgc + (cfg.allowances.attendance.leaveCountsAsAbsent ? 0 : sm.leave))));
    r.absentDays = absent;
    r.amtAttendance = (payType !== 'LOADER' && payType !== 'SEASONAL' && sm.hasData !== false && absent <= n(cfg.allowances.attendance.maxAbsentDays)) ? r0(n(cfg.allowances.attendance.amount)) : 0;
    if (!sm.hasData) r.amtAttendance = 0;
    // --- Bằng cấp
    const deg = (cfg.allowances.degree || []).find((x) => x.code === p.degree);
    r.amtDegree = r0(n(deg?.amount) * factor);
    // --- KPI tài xế / giao hàng (không rớt đơn)
    let kpiDriver = 0;
    if ((payType === 'DRIVER') && adj.noDropOrders) { const pct = p.driverRole === 'HELPER' ? n(cfg.driver.helperPct) : n(cfg.driver.driverPct); kpiDriver = n(cfg.driver.kpiPool) * pct / 100; }
    r.amtKpiDriver = r0(kpiDriver);
    r.amtKpiStore = r0(n(adj.kpiStore)); r.amtOtherBonus = r0(n(adj.otherBonus));

    const parts = ['amtCong', 'amtCongDoi', 'amtHieuHi', 'amtVgc', 'amtOt12', 'amtOt14', 'amtOtCn', 'amtOtLe', 'amtPhepNam', 'amtResp', 'amtCompletion', 'amtHousing', 'amtFuel', 'amtPhone', 'amtSeniority', 'amtMeal', 'amtNight', 'amtAttendance', 'amtDegree', 'amtKpiDriver', 'amtKpiStore', 'amtOtherBonus'];
    r.gross = parts.reduce((s, k) => s + n(r[k]), 0);

    // --- Khấu trừ: bảo hiểm, công đoàn
    const ins = cfg.insurance; const hasIns = !!p.insured;
    const baseRaw = n(p.insuranceBase) || (hasIns ? dr.rate * n(cfg.standardDays) : 0);
    const capSocial = n(ins.capMultiple) * n(ins.referenceLevel), capUi = n(ins.capMultiple) * n(ins.regionMinWage);
    r.insuranceBase = r0(hasIns ? Math.min(baseRaw, capSocial) : 0);
    r.bhxh = r0(r.insuranceBase * n(ins.bhxh) / 100); r.bhyt = r0(r.insuranceBase * n(ins.bhyt) / 100);
    r.bhtn = r0((hasIns ? Math.min(baseRaw, capUi) : 0) * n(ins.bhtn) / 100);
    r.union = p.union ? r0(r.insuranceBase * n(ins.union) / 100) : 0;
    // --- Thuế TNCN
    const otExempt = [['amtOt12', cfg.ot.tc12], ['amtOt14', cfg.ot.tc14], ['amtOtCn', cfg.ot.sunday], ['amtOtLe', cfg.ot.holiday]].reduce((s, [k, c]) => s + (n(c) > 1 ? n(r[k]) * (1 - 1 / n(c)) : 0), 0);
    const exempt = otExempt + (cfg.taxExempt.meal ? n(r.amtMeal) : 0) + (cfg.taxExempt.hieuHi ? n(r.amtHieuHi) : 0);
    r.taxableGross = r0(Math.max(0, r.gross - exempt)); r.otExempt = r0(otExempt);
    const taxMode = p.taxMode || (payType === 'SEASONAL' ? 'FLAT' : 'PROGRESSIVE');
    const siEmp = r.bhxh + r.bhyt + r.bhtn;
    r.taxMode = taxMode;
    if (taxMode === 'PROGRESSIVE') {
      const ded = n(cfg.tax.personal) + n(p.dependents) * n(cfg.tax.dependent);
      r.taxableIncome = Math.max(0, r.taxableGross - siEmp - ded);
      r.tax = progressiveTax(r.taxableIncome, cfg.tax.brackets);
    } else if (taxMode === 'FLAT') { r.taxableIncome = r.taxableGross; r.tax = r.taxableGross >= n(cfg.tax.flatThreshold) ? r0(r.taxableGross * n(cfg.tax.flatRate)) : 0; }
    else { r.taxableIncome = 0; r.tax = 0; }
    r.kpiDeduct = r0(n(adj.kpiDeduct)); r.truyThuBH = r0(n(adj.truyThuBH)); r.otherDeduct = r0(n(adj.otherDeduct));
    r.totalDeduct = r.bhxh + r.bhyt + r.bhtn + r.union + r.tax + r.kpiDeduct + r.truyThuBH + r.otherDeduct;
    r.net = r.gross - r.totalDeduct;
    r.nightRate = n(cfg.ot.nightRate);
    return r;
  }

  /** Gợi ý loại công A/B/C theo số đơn trong ngày (chỉ khi đã cấu hình ngưỡng minOrders > 0). */
  function suggestLevel(orders, cfg) {
    const lv = (cfg.driver.cong || []).filter((c) => n(c.minOrders) > 0).sort((a, b) => b.minOrders - a.minOrders);
    for (const c of lv) if (n(orders) >= c.minOrders) return c.code;
    return '';
  }

  const api = { n, r0, r2, parseHM, fmtHM, parseYmd, dim, ymd, weekday, monthDays, defaultConfig, mergeConfig, holidaySet, shiftSpan, matchShift, MARKS, calcDay, summarizeMonth, seniorityYears, seniorityRate, progressiveTax, findGroup, dayRateOf, calcPayroll, suggestLevel, ADJ, DEPTS, RESPONSIBILITY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HRPay = api;
})(typeof window !== 'undefined' ? window : globalThis);
