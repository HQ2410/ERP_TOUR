/* ============================================================================
 * NHÂN SỰ – TIỀN LƯƠNG (đợt 5) — nạp SAU mod-hr.js và hr-payroll-engine.js
 * ----------------------------------------------------------------------------
 * Theo file "quy trình công lương": ca làm việc, máy chấm công MTACO (giờ vào/ra + công X),
 * thang bảng lương, phụ cấp, tăng ca, KPI tài xế/giao hàng, bốc xếp tính tấn, bảng lương,
 * khấu trừ bảo hiểm/công đoàn/thuế. Phần 1: lưu trữ + Cấu hình lương + Hồ sơ lương.
 * ========================================================================== */
(function () {
  'use strict';
  const H = window.HRPay;
  const { n, r0, r2 } = H;
  const todayYmd = () => String(typeof currentDateYMD === 'function' ? currentDateYMD() : (DB.today || new Date().toISOString())).slice(0, 10);
  const canHr = () => { try { return typeof Auth === 'undefined' || Auth.hasPermission('HR_OPERATE'); } catch (_) { return true; } };
  const who = () => DB.currentUser?.name || DB.currentUser?.id || '';
  const money = (v) => (typeof fmtVND === 'function' ? fmtVND(v) : r0(v).toLocaleString('vi-VN') + 'đ');
  const clone = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === Infinity ? '__INF__' : v)), (k, v) => (v === '__INF__' ? Infinity : v));

  /* ------------------------------------------------------------------ lưu trữ (KIO nếu có, localStorage nếu không) */
  const hrTables = (typeof KIO_CONFIG !== 'undefined' && KIO_CONFIG.hrTables) || {};
  const TABLES = {
    config: hrTables.payrollConfig || 'lenam_hr_payroll_config',
    timesheets: hrTables.timesheets || 'lenam_hr_timesheets',
    stats: hrTables.dayStats || 'lenam_hr_day_stats',
    runs: hrTables.payrollRuns || 'lenam_hr_payroll_runs',
  };
  const lsKey = (k) => 'lenam_hr_v2_' + k;
  const mem = { config: null, timesheets: null, stats: null, runs: null };
  const loaded = {};
  const readLocal = (k) => { try { const r = JSON.parse(localStorage.getItem(lsKey(k)) || '[]'); return Array.isArray(r) ? r : []; } catch (_) { return []; } };
  const writeLocal = (k, list) => { try { localStorage.setItem(lsKey(k), JSON.stringify(list)); } catch (e) { console.warn('[HRV2] localStorage:', e); } };
  const jsonSafe = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === Infinity ? '__INF__' : v)));
  const unjson = (o) => JSON.parse(JSON.stringify(o), (k, v) => (v === '__INF__' ? Infinity : v));
  const store = {
    list(kind) { if (!mem[kind]) mem[kind] = readLocal(kind).map(unjson); return mem[kind]; },
    get(kind, id) { return store.list(kind).find((x) => String(x.id) === String(id)); },
    async ensure(kind, force = false) {
      if (!force && loaded[kind]) return store.list(kind);
      try {
        if (typeof KioStore !== 'undefined') { const rows = await KioStore.listCollection(TABLES[kind], { force }); mem[kind] = (Array.isArray(rows) ? rows : []).map(unjson); }
        else mem[kind] = readLocal(kind).map(unjson);
        loaded[kind] = true;
      } catch (err) { console.warn('[HRV2] Không tải được', kind, err); mem[kind] = mem[kind] || readLocal(kind).map(unjson); }
      return mem[kind];
    },
    async save(kind, row) {
      const list = store.list(kind); const i = list.findIndex((x) => String(x.id) === String(row.id)); const safe = jsonSafe(row);
      if (typeof KioStore !== 'undefined') await KioStore.saveSingleton(TABLES[kind], String(row.id), safe);
      const copy = unjson(safe); if (i >= 0) list[i] = copy; else list.push(copy);
      writeLocal(kind, list.map(jsonSafe));
      return row;
    },
    async remove(kind, id) {
      if (typeof KioStore !== 'undefined') await KioStore.deleteKeys(TABLES[kind], [String(id)]);
      mem[kind] = store.list(kind).filter((x) => String(x.id) !== String(id)); writeLocal(kind, mem[kind].map(jsonSafe));
    },
  };
  // Cấu hình: gộp mặc định theo file + bản đã lưu
  function cfg() { const saved = store.get('config', 'cfg'); return H.mergeConfig(saved ? saved.data : null); }
  async function saveCfg(next) { await store.save('config', { id: 'cfg', data: next, updatedAt: new Date().toISOString(), updatedBy: who() }); }
  window.HRV2 = { store, cfg, saveCfg, canHr, who, money, todayYmd, TABLES, clone };

  /* ------------------------------------------------------------------ nhân viên */
  const employees = () => (DB.employees || []);
  const STATUS_LABEL = { ns_dang_lam: 'Đang làm việc', ns_thu_viec: 'Thử việc', ns_nghi_phep: 'Nghỉ phép dài hạn', ns_thai_san: 'Thai sản', ns_nghi_viec: 'Nghỉ việc' };
  if (typeof DB !== 'undefined' && DB.statusMap && !DB.statusMap.ns_thai_san) { try { DB.statusMap.ns_thai_san = { label: 'Thai sản', cls: 'blue' }; } catch (_) {} }
  const isActive = (e) => e.status !== 'ns_nghi_viec';
  const slug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
  window.HRV2.employees = employees; window.HRV2.isActive = isActive; window.HRV2.STATUS_LABEL = STATUS_LABEL;

  /* ========================================================================
   * CẤU HÌNH LƯƠNG (working copy → Lưu)
   * ====================================================================== */
  const SUBS = [['shifts', 'Ca làm việc'], ['groups', 'Thang bảng lương'], ['allow', 'Phụ cấp & thưởng'], ['ot', 'Tăng ca & công'], ['driver', 'Tài xế, giao hàng, bốc xếp'], ['ins', 'Bảo hiểm & thuế'], ['hol', 'Ngày lễ'], ['depts', 'Bộ phận']];
  let work = null, dirty = false;
  const workCfg = () => { if (!work) work = clone(cfg()); return work; };
  function setPath(obj, path, val) {
    const parts = path.split('.'); let o = obj;
    for (let i = 0; i < parts.length - 1; i++) { const k = /^\d+$/.test(parts[i]) ? +parts[i] : parts[i]; o = o[k]; if (o == null) return; }
    const last = parts[parts.length - 1]; o[/^\d+$/.test(last) ? +last : last] = val;
  }
  const inp = (path, val, opts = {}) => `<input class="inp ${opts.cls || 'right num'}" style="${opts.style || 'width:130px'}" type="${opts.type || 'number'}" ${opts.type === 'text' || opts.type === 'time' ? '' : `step="${opts.step || 'any'}" min="${opts.min ?? 0}"`} data-cfg="${path}" value="${esc(val ?? '')}" ${!canHr() ? 'disabled' : ''}>`;
  const chk = (path, val) => `<input type="checkbox" data-cfg="${path}" data-cfg-bool="1" ${val ? 'checked' : ''} ${!canHr() ? 'disabled' : ''}>`;
  const delBtn = (act, data) => `<button class="btn btn-sm" data-act="${act}" ${data} title="Xóa" ${!canHr() ? 'disabled' : ''}><i class="fa-solid fa-trash"></i></button>`;
  const field = (label, html, hint = '') => `<div class="field"><label>${label}</label>${html}${hint ? `<div class="cell-sub">${hint}</div>` : ''}</div>`;
  const card = (title, body, sub = '') => `<div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div></div><div style="padding:4px 2px">${body}</div></div>`;

  function subShifts(c) {
    const rows = c.shifts.map((s, i) => `<tr><td><b>${esc(s.code)}</b></td><td>${inp(`shifts.${i}.start`, s.start, { type: 'time', cls: '', style: 'width:100px' })}</td><td>${inp(`shifts.${i}.end`, s.end, { type: 'time', cls: '', style: 'width:100px' })}</td>
      <td class="right num">${H.shiftSpan(s) ? r2(H.shiftSpan(s).span / 60) + 'h' : '—'}${H.shiftSpan(s)?.crosses ? '<div class="cell-sub">qua đêm</div>' : ''}</td><td>${inp(`shifts.${i}.workHours`, s.workHours, { style: 'width:70px' })}</td>
      <td><input class="inp" style="min-width:320px" data-cfg="shifts.${i}.depts" data-cfg-list="1" value="${esc((s.depts || []).join(', '))}" ${!canHr() ? 'disabled' : ''}></td><td>${delBtn('hrcfg-row-del', `data-list="shifts" data-i="${i}"`)}</td></tr>`).join('');
    return card('Ca làm việc', `${tableShell([{ t: 'Mã' }, { t: 'Giờ vào' }, { t: 'Giờ ra' }, { t: 'Thời lượng', cls: 'right' }, { t: 'Giờ công', cls: 'right' }, { t: 'Bộ phận được xếp ca (cách nhau dấu phẩy)' }, { t: '' }], [rows], { emptyTitle: '' })}
      <button class="btn btn-sm" data-act="hrcfg-shift-add" ${!canHr() ? 'disabled' : ''}><i class="fa-solid fa-plus"></i>Thêm ca</button>
      <div class="cell-sub" style="margin-top:8px">Khi nhập giờ vào/ra từ máy chấm công, hệ thống gán ca có giờ bắt đầu gần giờ vào nhất trong các ca của bộ phận nhân viên; giờ công = số giờ làm thực tế trong ca (đã trừ nghỉ giữa ca).</div>`, '19 ca theo file quy trình công lương; có thể sửa, thêm, xóa');
  }
  function subGroups(c) {
    const kinds = [['DAY', 'Theo ngày công'], ['FLAT', 'Khoán tháng'], ['SEASONAL', 'Thời vụ']];
    return c.payGroups.map((g, gi) => card(`${esc(g.code)} · ${esc(g.name)}`, `<div class="toolbar"><input class="inp" style="min-width:380px" data-cfg="payGroups.${gi}.name" value="${esc(g.name)}" ${!canHr() ? 'disabled' : ''}>
        <select class="inp" data-cfg="payGroups.${gi}.kind" ${!canHr() ? 'disabled' : ''}>${kinds.map(([v, l]) => `<option value="${v}" ${g.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="spacer"></span>${delBtn('hrcfg-row-del', `data-list="payGroups" data-i="${gi}"`)}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">${g.grades.map((b, bi) => `<div style="border:1px solid var(--border,#d9dee7);border-radius:8px;padding:6px 8px"><div class="cell-sub">Bậc <input class="inp" style="width:70px" data-cfg="payGroups.${gi}.grades.${bi}.code" value="${esc(b.code)}" ${!canHr() ? 'disabled' : ''}> ${delBtn('hrcfg-grade-del', `data-g="${gi}" data-i="${bi}"`)}</div>${inp(`payGroups.${gi}.grades.${bi}.rate`, b.rate, { style: 'width:130px;margin-top:4px' })}<div class="cell-sub">${g.kind === 'FLAT' ? 'đ / tháng' : 'đ / ngày công'}</div></div>`).join('')}
        <button class="btn btn-sm" data-act="hrcfg-grade-add" data-g="${gi}" ${!canHr() ? 'disabled' : ''}><i class="fa-solid fa-plus"></i>Thêm bậc</button></div>`)).join('')
      + `<button class="btn" data-act="hrcfg-group-add" ${!canHr() ? 'disabled' : ''}><i class="fa-solid fa-plus"></i>Thêm nhóm thang lương</button>`;
  }
  function subAllow(c) {
    const a = c.allowances;
    const resp = a.responsibility.map((r, i) => `<tr><td>${esc(r.name)}</td><td>${inp(`allowances.responsibility.${i}.amount`, r.amount)}</td><td>${delBtn('hrcfg-row-del', `data-list="allowances.responsibility" data-i="${i}"`)}</td></tr>`).join('');
    const deg = a.degree.map((r, i) => `<tr><td>${esc(r.name)}</td><td>${inp(`allowances.degree.${i}.amount`, r.amount)}</td></tr>`).join('');
    const tiers = a.seniority.tiers.map((t, i) => `<tr><td>Trên ${inp(`allowances.seniority.tiers.${i}.afterYears`, t.afterYears, { style: 'width:70px' })} năm</td><td>${inp(`allowances.seniority.tiers.${i}.rate`, t.rate)}</td><td>${delBtn('hrcfg-row-del', `data-list="allowances.seniority.tiers" data-i="${i}"`)}</td></tr>`).join('');
    return card('Chuyên cần', `<div class="form-grid cols-2">${field('Mức thưởng chuyên cần / tháng (đ)', inp('allowances.attendance.amount', a.attendance.amount))}${field('Số ngày nghỉ tối đa vẫn được nhận', inp('allowances.attendance.maxAbsentDays', a.attendance.maxAbsentDays, { step: '0.5' }), 'Theo file: nghỉ trên 1,5 ngày mất chuyên cần')}${field('Ngày phép năm tính là ngày nghỉ', chk('allowances.attendance.leaveCountsAsAbsent', a.attendance.leaveCountsAsAbsent), 'Cần kế toán xác nhận cách tính nghỉ có phép')}</div>`)
      + card('Phụ cấp thâm niên', `${tableShell([{ t: 'Số năm thâm niên' }, { t: 'Đơn giá / ngày / năm (đ)', cls: 'right' }, { t: '' }], [tiers], { emptyTitle: '' })}<button class="btn btn-sm" data-act="hrcfg-tier-add" ${!canHr() ? 'disabled' : ''}><i class="fa-solid fa-plus"></i>Thêm bậc thâm niên</button>
        <div class="form-grid cols-2" style="margin-top:8px">${field('Số ngày tính / tháng', inp('allowances.seniority.daysPerMonth', a.seniority.daysPerMonth))}</div><div class="cell-sub">Phụ cấp tháng = đơn giá của bậc thâm niên × 26 × số năm (theo file). Bậc cao áp dụng khi số năm vượt mốc (trên 5 năm → 4.807; trên 10 năm → 5.434).</div>`)
      + card('Phụ cấp trách nhiệm (theo chức vụ)', `${tableShell([{ t: 'Chức vụ' }, { t: 'Mức / tháng (đ)', cls: 'right' }, { t: '' }], [resp], { emptyTitle: '' })}<button class="btn btn-sm" data-act="hrcfg-resp-add" ${!canHr() ? 'disabled' : ''}><i class="fa-solid fa-plus"></i>Thêm chức vụ</button><div class="cell-sub">Tính theo số công thực tế ÷ công chuẩn.</div>`)
      + card('Phụ cấp bằng cấp', `${tableShell([{ t: 'Trình độ' }, { t: 'Mức / tháng (đ)', cls: 'right' }], [deg], { emptyTitle: '' })}<div class="cell-sub">Chia theo công chuẩn hàng tháng, nhân với số ngày thực tế đi làm.</div>`)
      + card('Khác', `<div class="form-grid cols-2">${field('Trợ cấp hiếu hỉ / đám tang: số ngày tối đa', inp('allowances.hieuHiMaxDays', a.hieuHiMaxDays), 'Tính theo ngày công thực lãnh (file: 3 ngày)')}${field('Hệ số công dôi', inp('congDoiCoef', c.congDoiCoef, { step: '0.1' }), 'Công dôi = công vượt công chuẩn tháng; cần xác nhận hệ số')}${field('Tiền cơm miễn thuế TNCN', chk('taxExempt.meal', c.taxExempt.meal), 'Tick nếu thuộc diện miễn thuế')}${field('Trợ cấp hiếu hỉ miễn thuế TNCN', chk('taxExempt.hieuHi', c.taxExempt.hieuHi))}</div>`);
  }
  function subOt(c) {
    const o = c.ot;
    return card('Hệ số tăng ca', `<div class="form-grid cols-2">
      ${field('Tăng ca ngày thường — hệ số bậc 1 ("TC 1.2")', inp('ot.tc12', o.tc12, { step: '0.05' }))}${field('Số giờ đầu mỗi ngày áp dụng hệ số bậc 1', inp('ot.tc12Hours', o.tc12Hours, { step: '0.5' }), 'Phần giờ còn lại tính hệ số bậc 2. Cần xác nhận cách phân loại 1.2 / 1.4')}
      ${field('Tăng ca ngày thường — hệ số bậc 2 ("TC 1.4")', inp('ot.tc14', o.tc14, { step: '0.05' }))}${field('Làm ngày Chủ nhật (hệ số)', inp('ot.sunday', o.sunday, { step: '0.1' }), 'Mặc định 200% theo Bộ luật Lao động 2019 — chỉnh theo quy chế công ty')}
      ${field('Làm ngày lễ (hệ số)', inp('ot.holiday', o.holiday, { step: '0.1' }), 'Mặc định 300% theo Bộ luật Lao động 2019')}${field('Đơn vị tính bồi dưỡng đêm', `<select class="inp" data-cfg="ot.nightUnit" ${!canHr() ? 'disabled' : ''}><option value="NIGHT" ${o.nightUnit === 'NIGHT' ? 'selected' : ''}>Theo đêm (ca có giờ ban đêm)</option><option value="HOUR" ${o.nightUnit === 'HOUR' ? 'selected' : ''}>Theo giờ (22:00–06:00)</option></select>`)}
      ${field('Đơn giá bồi dưỡng đêm (đ)', inp('ot.nightRate', o.nightRate), o.nightRate ? '' : 'Chưa có đơn giá trong file — hiện bằng 0')}${field('Ca đêm: số giờ ban đêm tối thiểu', inp('ot.nightMinHours', o.nightMinHours, { step: '0.5' }))}</div>`)
      + card('Quy tắc công', `<div class="form-grid cols-2">${field('Công chuẩn / tháng', inp('standardDays', c.standardDays))}${field('Giờ công / ca', inp('workHoursPerShift', c.workHoursPerShift, { step: '0.5' }))}
      ${field('Dung sai đi trễ / về sớm vẫn đủ 1 công (phút)', inp('fullDayToleranceMin', c.fullDayToleranceMin), 'Vượt dung sai: tính công lẻ ("về giữa ca") theo tỷ lệ giờ làm')}${field('Giờ vào lệch ca tối đa (phút)', inp('shiftMatchMaxMinutes', c.shiftMatchMaxMinutes), 'File: chênh lệch 30 phút đến 2 giờ')}
      ${field('Tăng ca tối thiểu (phút)', inp('otMinMinutes', c.otMinMinutes))}${field('Bước làm tròn tăng ca (phút)', inp('otStepMinutes', c.otStepMinutes))}
      ${field('Bảo vệ khoán: số ngày / tháng', inp('flat.daysPerMonth', c.flat.daysPerMonth))}${field('Bảo vệ khoán: số giờ / ngày', inp('flat.hoursPerDay', c.flat.hoursPerDay))}</div>`);
  }
  function subDriver(c) {
    const d = c.driver;
    const rows = d.cong.map((x, i) => `<tr><td><b>Công ${esc(x.code)}</b></td><td>${inp(`driver.cong.${i}.rate`, x.rate)}</td><td>${inp(`driver.cong.${i}.minOrders`, x.minOrders, { style: 'width:100px' })}</td></tr>`).join('');
    return card('Tài xế và giao hàng — công A / B / C', `${tableShell([{ t: 'Loại công' }, { t: 'Đơn giá / công (đ)', cls: 'right' }, { t: 'Từ số đơn / ngày (gợi ý tự động)', cls: 'right' }], [rows], { emptyTitle: '' })}<div class="cell-sub">Ngưỡng số đơn chưa có trong file: để 0 thì loại công do người dùng chọn tay ở Thống kê ngày; điền ngưỡng để hệ thống gợi ý loại công theo số đơn.</div>`)
      + card('Thưởng KPI không rớt đơn', `<div class="form-grid cols-2">${field('Tổng thưởng (đ)', inp('driver.kpiPool', d.kpiPool))}${field('Tài xế nhận (%)', inp('driver.driverPct', d.driverPct))}${field('Giao hàng nhận (%)', inp('driver.helperPct', d.helperPct))}</div><div class="cell-sub">Tính theo tháng khi bảng lương đánh dấu "không rớt đơn". Cần xác nhận kỳ tính (tháng/chuyến) của khoản 400K.</div>`)
      + card('Bốc xếp', `<div class="form-grid cols-2">${field('Đơn giá bốc xếp / tấn (đ)', inp('loader.ratePerTon', c.loader.ratePerTon), c.loader.ratePerTon ? '' : 'Chưa có đơn giá trong file — hiện bằng 0')}</div>`);
  }
  function subIns(c) {
    const i = c.insurance, t = c.tax;
    const br = t.brackets.map((b, k) => `<tr><td>Bậc ${k + 1}${k > 0 ? ` (trên ${Number(t.brackets[k - 1][0]).toLocaleString('vi-VN')}đ)` : ''}</td><td class="right num">${b[0] === Infinity ? '∞' : inp(`tax.brackets.${k}.0`, b[0], { style: 'width:150px' })}</td><td class="right num">${inp(`tax.brackets.${k}.1`, b[1], { step: '0.01', style: 'width:90px' })}</td></tr>`).join('');
    return card('Bảo hiểm và công đoàn (phần người lao động đóng)', `<div class="form-grid cols-2">${field('BHXH (%)', inp('insurance.bhxh', i.bhxh, { step: '0.1' }))}${field('BHYT (%)', inp('insurance.bhyt', i.bhyt, { step: '0.1' }))}${field('BHTN (%)', inp('insurance.bhtn', i.bhtn, { step: '0.1' }))}${field('Công đoàn (%)', inp('insurance.union', i.union, { step: '0.1' }), 'Tính trên mức lương đóng BHXH, chỉ cho nhân viên là đoàn viên')}
      ${field('Mức tham chiếu / lương cơ sở (đ)', inp('insurance.referenceLevel', i.referenceLevel), 'Trần BHXH, BHYT = 20 lần')}${field('Bội số trần', inp('insurance.capMultiple', i.capMultiple))}${field('Lương tối thiểu vùng (đ)', inp('insurance.regionMinWage', i.regionMinWage), 'Trần BHTN = 20 lần. Vùng I: 5.310.000 (Nghị định 293/2025)')}</div>`)
      + card('Thuế thu nhập cá nhân', `<div class="form-grid cols-2">${field('Giảm trừ bản thân / tháng (đ)', inp('tax.personal', t.personal))}${field('Giảm trừ mỗi người phụ thuộc / tháng (đ)', inp('tax.dependent', t.dependent))}${field('Thuế suất khấu trừ không lũy tiến (thời vụ)', inp('tax.flatRate', t.flatRate, { step: '0.01' }), '0,10 = 10%')}${field('Ngưỡng khấu trừ (đ)', inp('tax.flatThreshold', t.flatThreshold))}</div>
        ${tableShell([{ t: 'Bậc' }, { t: 'Thu nhập tính thuế / tháng đến (đ)', cls: 'right' }, { t: 'Thuế suất', cls: 'right' }], [br], { emptyTitle: '' })}<div class="cell-sub">Biểu 5 bậc 5/10/20/30/35% và mức giảm trừ 15,5 / 6,2 triệu theo Luật Thuế TNCN sửa đổi (tra cứu 10/2026). Kế toán đối chiếu quy định hiện hành.</div>`);
  }
  function subHol(c) {
    const fx = c.holidays.map((h, i) => `<tr><td>${inp(`holidays.${i}.date`, h.date, { type: 'text', cls: '', style: 'width:100px' })}</td><td>${inp(`holidays.${i}.name`, h.name, { type: 'text', cls: '', style: 'width:260px' })}</td><td>${delBtn('hrcfg-row-del', `data-list="holidays" data-i="${i}"`)}</td></tr>`).join('');
    const ex = c.extraHolidays.map((h, i) => `<tr><td>${inp(`extraHolidays.${i}.date`, h.date, { type: 'text', cls: '', style: 'width:130px' })}</td><td>${inp(`extraHolidays.${i}.name`, h.name, { type: 'text', cls: '', style: 'width:260px' })}</td><td>${delBtn('hrcfg-row-del', `data-list="extraHolidays" data-i="${i}"`)}</td></tr>`).join('');
    return card('Ngày lễ cố định hằng năm (MM-DD)', `${tableShell([{ t: 'Ngày (MM-DD)' }, { t: 'Tên' }, { t: '' }], [fx], { emptyTitle: '' })}<button class="btn btn-sm" data-act="hrcfg-hol-add" data-fixed="1" ${!canHr() ? 'disabled' : ''}><i class="fa-solid fa-plus"></i>Thêm ngày lễ cố định</button>`)
      + card('Ngày lễ theo năm (Tết âm lịch, Giỗ Tổ, ngày nghỉ bù…) — nhập dạng YYYY-MM-DD', `${tableShell([{ t: 'Ngày' }, { t: 'Tên' }, { t: '' }], [ex], { emptyTitle: '' })}<button class="btn btn-sm" data-act="hrcfg-hol-add" ${!canHr() ? 'disabled' : ''}><i class="fa-solid fa-plus"></i>Thêm ngày lễ</button><div class="cell-sub">Làm việc ngày lễ tính vào tăng ca lễ; không đi làm ngày lễ có thể đánh dấu "L" để hưởng lương.</div>`);
  }
  function subDepts(c) {
    return card('Bộ phận làm việc (dùng khi xếp ca và tính lương theo bộ phận)', `<div style="display:flex;flex-wrap:wrap;gap:8px">${c.depts.map((d, i) => `<span class="chip">${esc(d)} ${delBtn('hrcfg-row-del', `data-list="depts" data-i="${i}"`)}</span>`).join('')}</div>
      <div class="toolbar" style="margin-top:10px"><input class="inp" id="hrcfgNewDept" placeholder="Tên bộ phận mới" ${!canHr() ? 'disabled' : ''}><button class="btn btn-sm" data-act="hrcfg-dept-add" ${!canHr() ? 'disabled' : ''}><i class="fa-solid fa-plus"></i>Thêm</button></div>`);
  }
  window.hrPayConfigView = function () {
    store.ensure('config').then(() => { if (State.module === 'hr' && State.tab === 'pay_config' && !window.__hrCfgLoaded) { window.__hrCfgLoaded = true; work = null; render(); } });
    const f = F('hr-cfg', { sub: 'shifts' }); const c = workCfg();
    const tabs = `<div class="tabs" style="margin-bottom:14px;flex-wrap:wrap">${SUBS.map(([k, l]) => `<button class="tab ${f.sub === k ? 'active' : ''}" data-act="hrcfg-sub" data-sub="${k}">${l}</button>`).join('')}</div>`;
    const body = { shifts: subShifts, groups: subGroups, allow: subAllow, ot: subOt, driver: subDriver, ins: subIns, hol: subHol, depts: subDepts }[f.sub](c);
    const todo = [];
    if (!n(c.ot.nightRate)) todo.push('đơn giá bồi dưỡng đêm'); if (!n(c.loader.ratePerTon)) todo.push('đơn giá bốc xếp / tấn'); if (!c.driver.cong.some((x) => n(x.minOrders) > 0)) todo.push('ngưỡng số đơn cho công A/B/C');
    return `${pageHead('Cấu hình lương', 'Ca làm việc, thang bảng lương, phụ cấp, hệ số tăng ca, bảo hiểm và thuế — mặc định lấy từ file quy trình công lương', canHr() ? `<button class="btn" data-act="hrcfg-reset"><i class="fa-solid fa-rotate-left"></i>Hủy thay đổi</button><button class="btn btn-primary" data-act="hrcfg-save"><i class="fa-solid fa-floppy-disk"></i>Lưu cấu hình</button>` : '')}
      ${dirty ? '<div class="alert warning" style="margin-bottom:10px"><i class="fa-solid fa-circle-exclamation"></i><span>Có thay đổi chưa lưu. Bấm <b>Lưu cấu hình</b> để áp dụng cho các bảng lương.</span></div>' : ''}
      ${todo.length ? `<div class="alert info" style="margin-bottom:10px"><i class="fa-solid fa-circle-info"></i><span>File quy trình chưa nêu: <b>${todo.join(', ')}</b>. Các khoản này đang bằng 0 cho đến khi bạn nhập.</span></div>` : ''}${tabs}${body}`;
  };
  // Ô nhập cấu hình: cập nhật bản làm việc (không render lại để giữ con trỏ)
  document.addEventListener('change', (e) => {
    const el = e.target; const path = el?.dataset?.cfg; if (!path) return;
    const c = workCfg(); let v;
    if (el.dataset.cfgBool) v = !!el.checked; else if (el.dataset.cfgList) v = String(el.value).split(',').map((x) => x.trim()).filter(Boolean); else if (el.type === 'number') v = el.value === '' ? 0 : Number(el.value); else v = el.value;
    setPath(c, path, v); dirty = true;
    if (/payGroups\.\d+\.kind|payGroups\.\d+\.grades\.\d+\.code|shifts\.\d+\.(start|end)/.test(path)) render();
  });
  const listOf = (c, path) => path.split('.').reduce((o, k) => o[k], c);
  Object.assign(Actions, {
    'hrcfg-sub': (d) => { F('hr-cfg').sub = d.sub; render(); },
    'hrcfg-save': async () => {
      if (!canHr()) { Toast.err('Không có quyền', 'Chỉ bộ phận nhân sự được sửa cấu hình lương.'); return; }
      const c = workCfg();
      for (const s of c.shifts) if (H.parseHM(s.start) == null || H.parseHM(s.end) == null) { Toast.err('Giờ ca không hợp lệ', `Ca ${s.code}: nhập giờ dạng HH:MM.`); return; }
      if (c.payGroups.some((g) => !g.grades.length)) { Toast.err('Nhóm thang lương trống', 'Mỗi nhóm cần ít nhất một bậc lương.'); return; }
      try { await saveCfg(c); } catch (err) { Toast.err('Không lưu được cấu hình', err?.message || 'Vui lòng thử lại.'); return; }
      dirty = false; work = null; window.HRTimesheet?.clearCache?.(); render(); Toast.ok('Đã lưu cấu hình lương', 'Áp dụng cho các bảng công, bảng lương tính lại từ giờ.');
    },
    'hrcfg-reset': () => { work = null; dirty = false; render(); Toast.info('Đã hủy thay đổi', 'Quay lại cấu hình đã lưu.'); },
    'hrcfg-row-del': (d) => { const c = workCfg(); const list = listOf(c, d.list); list.splice(Number(d.i), 1); dirty = true; render(); },
    'hrcfg-shift-add': () => { const c = workCfg(); const k = Math.max(0, ...c.shifts.map((s) => parseInt(String(s.code).replace(/\D/g, ''), 10) || 0)) + 1; c.shifts.push({ code: 'CA' + String(k).padStart(2, '0'), start: '08:00', end: '16:00', workHours: 8, depts: [], note: '' }); dirty = true; render(); },
    'hrcfg-group-add': () => { const c = workCfg(); const k = Math.max(0, ...c.payGroups.map((g) => parseInt(String(g.code).replace(/\D/g, ''), 10) || 0)) + 1; c.payGroups.push({ code: 'G' + String(k).padStart(2, '0'), name: 'Nhóm mới', kind: 'DAY', grades: [{ code: 'A', rate: 0 }] }); dirty = true; render(); },
    'hrcfg-grade-add': (d) => { workCfg().payGroups[Number(d.g)].grades.push({ code: 'B' + (workCfg().payGroups[Number(d.g)].grades.length + 1), rate: 0 }); dirty = true; render(); },
    'hrcfg-grade-del': (d) => { const g = workCfg().payGroups[Number(d.g)]; if (g.grades.length <= 1) { Toast.warn('Không xóa được', 'Mỗi nhóm cần ít nhất một bậc.'); return; } g.grades.splice(Number(d.i), 1); dirty = true; render(); },
    'hrcfg-tier-add': () => { const t = workCfg().allowances.seniority.tiers; t.push({ afterYears: n(t[t.length - 1]?.afterYears) + 5, rate: 0 }); dirty = true; render(); },
    'hrcfg-resp-add': () => { const name = prompt('Tên chức vụ có phụ cấp trách nhiệm:'); if (!name) return; workCfg().allowances.responsibility.push({ code: slug(name) || 'CV' + Date.now(), name: name.trim(), amount: 0 }); dirty = true; render(); },
    'hrcfg-hol-add': (d) => { const c = workCfg(); if (d.fixed) c.holidays.push({ date: '01-01', name: 'Ngày lễ', fixed: true }); else c.extraHolidays.push({ date: todayYmd(), name: 'Ngày lễ' }); dirty = true; render(); },
    'hrcfg-dept-add': () => { const v = ($('#hrcfgNewDept')?.value || '').trim().toUpperCase(); if (!v) return; const c = workCfg(); if (c.depts.includes(v)) { Toast.warn('Đã có bộ phận này', v); return; } c.depts.push(v); dirty = true; render(); },
  });
})();

/* ============================================================================
 * HỒ SƠ LƯƠNG NHÂN VIÊN — nhóm/bậc lương, bộ phận, bằng cấp, chức vụ trách nhiệm, bảo hiểm,
 * thuế, thâm niên, mã chấm công và TRẠNG THÁI LÀM VIỆC (có lịch sử)
 * ========================================================================== */
(function () {
  'use strict';
  const H = window.HRPay, V = window.HRV2; const { n } = H;
  const money = V.money;
  const payTypeOf = (g) => (g?.kind === 'FLAT' ? 'FLAT' : g?.kind === 'SEASONAL' ? 'SEASONAL' : 'DAY');
  const PAY_TYPES = [['DAY', 'Theo ngày công (thang bậc)'], ['DRIVER', 'Tài xế / giao hàng (công A/B/C)'], ['LOADER', 'Bốc xếp (theo tấn)'], ['FLAT', 'Khoán tháng'], ['SEASONAL', 'Thời vụ']];
  const payTypeLabel = (t) => (PAY_TYPES.find((x) => x[0] === t) || ['', 'Theo ngày công'])[1].split(' (')[0];
  const profileOf = (e) => e.payProfile || {};
  function rateText(e, c) { const p = profileOf(e); if (p.payType === 'LOADER') return 'Theo tấn'; const r = H.dayRateOf(e, c); return r.rate ? money(r.rate) + (r.kind === 'FLAT' ? ' /ngày (khoán)' : ' /ngày') : '—'; }

  window.hrPayProfilesView = function () {
    const c = V.cfg(); const f = F('hr-prof', { q: '', dept: '', missing: '' });
    const q = String(f.q || '').toLowerCase().trim();
    let list = V.employees().filter((e) => (!q || [e.id, e.name, e.dept, profileOf(e).workDept].some((v) => String(v || '').toLowerCase().includes(q))) && (!f.dept || profileOf(e).workDept === f.dept) && (!f.missing || (f.missing === 'NO' ? !profileOf(e).payGroup : !!profileOf(e).payGroup)));
    const pg = paged(list, 'hr-prof');
    const noProfile = V.employees().filter((e) => V.isActive(e) && !profileOf(e).payGroup).length;
    const rows = pg.items.map((e) => { const p = profileOf(e); const g = H.findGroup(c, p.payGroup);
      return `<tr><td><span class="code">${esc(e.id)}</span></td><td>${cell2(esc(e.name), esc(e.position || e.dept || ''))}</td><td>${esc(p.workDept || '—')}</td>
        <td>${g ? `${esc(g.name)}<div class="cell-sub">Bậc ${esc(p.grade || g.grades[0].code)}</div>` : '<span class="badge orange">Chưa có nhóm lương</span>'}</td><td>${esc(payTypeLabel(p.payType))}</td><td class="right num">${rateText(e, c)}</td>
        <td>${p.insured ? '<span class="badge green">Có BH</span>' : '<span class="muted">Không</span>'}${p.union ? ' <span class="badge blue">Đoàn viên</span>' : ''}</td>
        <td><span class="badge ${e.status === 'ns_nghi_viec' ? 'red' : e.status === 'ns_dang_lam' ? 'green' : 'orange'}">${esc(V.STATUS_LABEL[e.status] || e.status || '—')}</span></td>
        <td class="right">${V.canHr() ? `<button class="btn btn-sm" data-act="hrprof-edit" data-id="${esc(e.id)}"><i class="fa-solid fa-pen"></i>Hồ sơ lương</button>` : ''}</td></tr>`; });
    return `${pageHead('Hồ sơ lương nhân viên', 'Gắn nhân viên vào nhóm thang lương/bậc, bộ phận làm việc, phụ cấp, bảo hiểm, thuế và theo dõi trạng thái làm việc')}
      <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Nhân viên', V.employees().length, 'fa-users', 'blue')}${mkpi('Chưa có nhóm lương', noProfile, 'fa-triangle-exclamation', 'orange')}${mkpi('Đang làm việc', V.employees().filter((e) => e.status === 'ns_dang_lam').length, 'fa-user-check', 'green')}</div>
      <div class="card"><div class="toolbar">${searchBox('hr-prof', 'Tìm mã, tên, bộ phận…')}${selectFilter('hr-prof', 'dept', c.depts.map((d) => [d, d]), 'Tất cả bộ phận')}${selectFilter('hr-prof', 'missing', [['NO', 'Chưa có nhóm lương'], ['YES', 'Đã có nhóm lương']], 'Tất cả')}</div>
      ${tableShell([{ t: 'Mã' }, { t: 'Nhân viên' }, { t: 'Bộ phận làm việc' }, { t: 'Nhóm thang lương' }, { t: 'Loại lương' }, { t: 'Đơn giá', cls: 'right' }, { t: 'BH / công đoàn' }, { t: 'Trạng thái' }, { t: '', cls: 'right', w: '130px' }], rows, { emptyTitle: 'Không có nhân viên' })}${pagiHTML('hr-prof', pg, 'nhân viên')}</div>`;
  };

  function openProfile(id) {
    const e = V.employees().find((x) => x.id === id); if (!e) return; const c = V.cfg(); const p = profileOf(e);
    const g = H.findGroup(c, p.payGroup) || c.payGroups[0];
    const opt = (list, sel, blank) => (blank ? `<option value="">${blank}</option>` : '') + list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const hist = (e.statusHistory || []).slice().reverse().map((h) => `<tr><td>${fmtDate(h.date)}</td><td>${esc(V.STATUS_LABEL[h.status] || h.status)}</td><td>${esc(h.note || '')}</td><td>${esc(h.by || '')}</td></tr>`).join('');
    Modal.open({
      title: `Hồ sơ lương · ${esc(e.name)}`, sub: `${esc(e.id)} · ${esc(e.position || '')} · vào làm ${fmtDate(e.joinDate)}`, size: 'xl',
      body: `<div class="form-sec-title"><i class="fa-solid fa-id-badge"></i>Bộ phận và thang lương</div><div class="form-grid cols-2">
        ${'<div class="field"><label>Bộ phận làm việc</label><select class="inp" id="hpDept">' + opt(c.depts.map((d) => [d, d]), p.workDept, '— Chọn —') + '</select></div>'}
        <div class="field"><label>Mã chấm công (máy MTACO)</label><input class="inp" id="hpMtaco" value="${esc(p.mtacoId || '')}" placeholder="Để trống = dùng mã nhân viên"></div>
        <div class="field"><label>Nhóm thang lương</label><select class="inp" id="hpGroup">${opt(c.payGroups.map((x) => [x.code, `${x.code} · ${x.name}`]), g.code, '— Chọn —')}</select></div>
        <div class="field"><label>Bậc lương</label><select class="inp" id="hpGrade">${opt(g.grades.map((b) => [b.code, `${b.code} · ${money(b.rate)}`]), p.grade || g.grades[0].code)}</select></div>
        <div class="field"><label>Loại lương</label><select class="inp" id="hpType">${opt(PAY_TYPES, p.payType || payTypeOf(g))}</select></div>
        <div class="field"><label>Đơn giá ngày riêng (ghi đè thang, đ)</label><input class="inp right num" id="hpCustom" type="number" min="0" value="${p.customDayRate || ''}" placeholder="Để trống = theo thang bậc"></div>
        <div class="field"><label>Vai trò (tài xế / giao hàng)</label><select class="inp" id="hpRole">${opt([['DRIVER', 'Tài xế'], ['HELPER', 'Giao hàng']], p.driverRole || 'DRIVER')}</select></div>
        <div class="field"><label>Mã tài xế bên Logistics</label><input class="inp" id="hpLogi" value="${esc(p.logisticsDriverId || '')}" placeholder="Ví dụ TX-001 (để nạp đơn/chuyến tự động)"></div></div>
      <div class="form-sec-title" style="margin-top:12px"><i class="fa-solid fa-hand-holding-dollar"></i>Phụ cấp</div><div class="form-grid cols-2">
        <div class="field"><label>Chức vụ trách nhiệm</label><select class="inp" id="hpResp">${opt(c.allowances.responsibility.map((r) => [r.code, `${r.name} · ${money(r.amount)}`]), p.responsibility, '— Không —')}</select></div>
        <div class="field"><label>Bằng cấp</label><select class="inp" id="hpDegree">${opt(c.allowances.degree.map((r) => [r.code, `${r.name} · ${money(r.amount)}`]), p.degree, '— Không —')}</select></div>
        <div class="field"><label>Hỗ trợ nhà ở / tháng</label><input class="inp right num" id="hpHouse" type="number" min="0" value="${n(p.allowances?.housing) || ''}"></div>
        <div class="field"><label>Tiền xăng / tháng</label><input class="inp right num" id="hpFuel" type="number" min="0" value="${n(p.allowances?.fuel) || ''}"></div>
        <div class="field"><label>Điện thoại / tháng</label><input class="inp right num" id="hpPhone" type="number" min="0" value="${n(p.allowances?.phone) || ''}"></div>
        <div class="field"><label>Tiền cơm / công</label><input class="inp right num" id="hpMeal" type="number" min="0" value="${n(p.mealPerDay) || ''}"></div>
        <div class="field"><label>Thưởng hoàn thành / công</label><input class="inp right num" id="hpDone" type="number" min="0" value="${n(p.completionPerDay) || ''}"></div>
        <div class="field"><label>Ngày tính thâm niên</label><input class="inp" id="hpSenior" type="date" value="${esc(p.seniorityStart || e.joinDate || '')}"></div></div>
      <div class="form-sec-title" style="margin-top:12px"><i class="fa-solid fa-shield-halved"></i>Bảo hiểm, công đoàn, thuế</div><div class="form-grid cols-2">
        <div class="field"><label><input type="checkbox" id="hpIns" ${p.insured ? 'checked' : ''}> Tham gia BHXH, BHYT, BHTN</label></div>
        <div class="field"><label>Mức lương đóng bảo hiểm (đ)</label><input class="inp right num" id="hpInsBase" type="number" min="0" value="${p.insuranceBase || ''}" placeholder="Để trống = đơn giá ngày × 26"></div>
        <div class="field"><label><input type="checkbox" id="hpUnion" ${p.union ? 'checked' : ''}> Đoàn viên công đoàn</label></div>
        <div class="field"><label>Số người phụ thuộc</label><input class="inp right num" id="hpDep" type="number" min="0" step="1" value="${n(p.dependents)}"></div>
        <div class="field"><label>Cách tính thuế TNCN</label><select class="inp" id="hpTax">${opt([['', 'Tự động (lũy tiến; thời vụ khấu trừ 10%)'], ['PROGRESSIVE', 'Lũy tiến từng phần'], ['FLAT', 'Khấu trừ 10%'], ['NONE', 'Không khấu trừ']], p.taxMode || '')}</select></div></div>
      <div class="form-sec-title" style="margin-top:12px"><i class="fa-solid fa-user-clock"></i>Trạng thái làm việc</div><div class="form-grid cols-2">
        <div class="field"><label>Trạng thái</label><select class="inp" id="hpStatus">${opt(Object.entries(V.STATUS_LABEL), e.status || 'ns_dang_lam')}</select></div>
        <div class="field"><label>Có hiệu lực từ ngày</label><input class="inp" id="hpStatusDate" type="date" value="${V.todayYmd()}"></div>
        <div class="field" style="grid-column:1/-1"><label>Ghi chú thay đổi trạng thái</label><input class="inp" id="hpStatusNote" placeholder="Chỉ lưu vào lịch sử khi đổi trạng thái"></div></div>
      ${hist ? `<div class="tbl-wrap" style="max-height:160px;overflow:auto"><table class="line-tbl"><thead><tr><th>Ngày</th><th>Trạng thái</th><th>Ghi chú</th><th>Người đổi</th></tr></thead><tbody>${hist}</tbody></table></div>` : '<div class="cell-sub">Chưa có lịch sử đổi trạng thái.</div>'}`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="hrprof-save" data-id="${esc(e.id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu hồ sơ lương</button>`,
      onMount: () => {
        const gs = $('#hpGroup'), gd = $('#hpGrade'), ty = $('#hpType');
        gs?.addEventListener('change', () => { const gg = H.findGroup(c, gs.value); if (!gg) return; gd.innerHTML = gg.grades.map((b) => `<option value="${esc(b.code)}">${esc(b.code)} · ${money(b.rate)}</option>`).join(''); if (ty && ['DAY', 'FLAT', 'SEASONAL'].includes(ty.value)) ty.value = payTypeOf(gg); });
      },
    });
  }
  async function saveProfile(id) {
    if (!V.canHr()) { Toast.err('Không có quyền', 'Chỉ bộ phận nhân sự được sửa hồ sơ lương.'); return; }
    const e = V.employees().find((x) => x.id === id); if (!e) return; const c = V.cfg();
    const g = $('#hpGroup').value; if (!g) { Toast.err('Chưa chọn nhóm thang lương', 'Chọn nhóm thang lương để tính đơn giá ngày.'); return; }
    const v = (s) => $(s)?.value ?? ''; const num = (s) => Number(v(s)) || 0;
    const before = JSON.parse(JSON.stringify({ payProfile: e.payProfile || null, status: e.status, statusHistory: e.statusHistory || null, workDept: e.workDept }));
    e.payProfile = { workDept: v('#hpDept'), mtacoId: v('#hpMtaco').trim(), payGroup: g, grade: v('#hpGrade'), payType: v('#hpType') || payTypeOf(H.findGroup(c, g)), customDayRate: num('#hpCustom') || 0, driverRole: v('#hpRole') || 'DRIVER', logisticsDriverId: v('#hpLogi').trim(), responsibility: v('#hpResp'), degree: v('#hpDegree'), allowances: { housing: num('#hpHouse'), fuel: num('#hpFuel'), phone: num('#hpPhone') }, mealPerDay: num('#hpMeal'), completionPerDay: num('#hpDone'), seniorityStart: v('#hpSenior'), insured: !!$('#hpIns')?.checked, insuranceBase: num('#hpInsBase') || 0, union: !!$('#hpUnion')?.checked, dependents: Math.max(0, Math.floor(num('#hpDep'))), taxMode: v('#hpTax') };
    e.workDept = e.payProfile.workDept;
    const st = v('#hpStatus');
    if (st && st !== e.status) { (e.statusHistory = e.statusHistory || []).push({ status: st, date: v('#hpStatusDate') || V.todayYmd(), note: v('#hpStatusNote').trim(), by: V.who(), at: new Date().toISOString(), from: e.status }); e.status = st; }
    try { if (typeof HRAPI !== 'undefined' && HRAPI.scheduleSync) HRAPI.scheduleSync(); else if (typeof HRAPI !== 'undefined' && HRAPI.syncEmployees) await HRAPI.syncEmployees(); }
    catch (err) { Object.assign(e, { payProfile: before.payProfile, status: before.status, statusHistory: before.statusHistory, workDept: before.workDept }); Toast.err('Không lưu được hồ sơ lương', err?.message || 'Vui lòng thử lại.'); return; }
    Modal.close(); render(); Toast.ok('Đã lưu hồ sơ lương', `${e.name} · ${H.findGroup(c, g)?.name || ''} · bậc ${e.payProfile.grade}`);
  }
  Object.assign(Actions, { 'hrprof-edit': (d) => openProfile(d.id), 'hrprof-save': (d) => saveProfile(d.id) });
})();

/* ============================================================================
 * BẢNG CÔNG NGÀY — nhập từ máy chấm công MTACO (giờ vào/ra + công "X"), sửa tay, kiểm tra
 * ========================================================================== */
(function () {
  'use strict';
  const H = window.HRPay, V = window.HRV2; const { n } = H;
  const store = V.store;
  const curMonth = () => V.todayYmd().slice(0, 7);
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const wdName = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const FLAG_TEXT = { MISSING_IN: 'Thiếu giờ vào', MISSING_OUT: 'Thiếu giờ ra', NO_PUNCH: 'Có công "X" nhưng không có giờ chấm', NO_MARK: 'Có giờ vào/ra nhưng chưa có công "X"', NO_SHIFT: 'Không gán được ca', SHIFT_DIFF: 'Giờ vào lệch ca từ 30 phút', BAD_MARK: 'Ký hiệu công không hợp lệ' };

  /* ---- dữ liệu bảng công của nhân viên theo tháng */
  const tsId = (month, empId) => `${month}|${empId}`;
  const tsDoc = (month, empId) => store.get('timesheets', tsId(month, empId));
  const tsRecords = (month, empId) => { const d = tsDoc(month, empId); return d ? Object.entries(d.days || {}).map(([date, r]) => ({ date, ...r })) : []; };
  function ctxOf(e, cfg, month) { return { cfg, shifts: cfg.shifts, holidays: H.holidaySet(cfg, Number(month.slice(0, 4))), workDept: e.payProfile?.workDept || e.workDept || '' }; }
  const summaryCache = new Map();
  function summaryOf(e, cfg, month) {
    const d = tsDoc(month, e.id); const key = `${month}|${e.id}|${d?.updatedAt || ''}|${cfg.__v || ''}|${e.payProfile?.workDept || ''}`;
    if (summaryCache.get(key)) return summaryCache.get(key);
    const s = H.summarizeMonth(month, tsRecords(month, e.id), ctxOf(e, cfg, month)); summaryCache.set(key, s); if (summaryCache.size > 3000) summaryCache.clear(); return s;
  }
  function activeInMonth(e, month) {
    if (e.status !== 'ns_nghi_viec') return true;
    const last = (e.statusHistory || []).filter((h) => h.status === 'ns_nghi_viec').pop();
    return last ? String(last.date).slice(0, 7) >= month : !!tsDoc(month, e.id);
  }
  const monthEmployees = (month) => V.employees().filter((e) => activeInMonth(e, month));
  async function saveDoc(month, empId, mutate) {
    let d = tsDoc(month, empId) || { id: tsId(month, empId), month, empId, days: {} };
    d = JSON.parse(JSON.stringify(d)); mutate(d); d.updatedAt = new Date().toISOString(); d.updatedBy = V.who();
    await store.save('timesheets', d); summaryCache.clear(); return d;
  }
  window.HRTimesheet = { tsRecords, summaryOf, monthEmployees, ctxOf, saveDoc, tsDoc, activeInMonth, norm, clearCache: () => summaryCache.clear() };
  const ensureMonth = (month) => Promise.all([store.ensure('timesheets'), store.ensure('config')]).then(() => { if (State.module === 'hr' && !window.__hrTsLoaded) { window.__hrTsLoaded = true; render(); } });

  /* ---- ký hiệu hiển thị trong lưới */
  function cellOf(day, rec) {
    if (day.mark === 'P' || day.leave) return ['P', 'badge blue', 'Phép năm'];
    if (day.mark === 'L') return ['L', 'badge green', 'Nghỉ lễ hưởng lương'];
    if (day.mark === 'N' || day.mark === 'KP') return ['N', 'badge slate', 'Nghỉ không lương / không phép'];
    if (day.otLe) return ['Lễ', 'badge purple', `Làm lễ ${day.otLe}h`];
    if (day.otCn) return ['CN', 'badge purple', `Làm Chủ nhật ${day.otCn}h`];
    if (day.cong >= 1) return [day.ot12 + day.ot14 > 0 ? 'X+' : 'X', 'badge green', `${day.shift || ''} ${rec?.in || ''}–${rec?.out || ''}${day.ot12 + day.ot14 ? ` · tăng ca ${day.ot12 + day.ot14}h` : ''}`];
    if (day.cong > 0) return ['½', 'badge orange', 'Nửa công'];
    if (day.vgc > 0) return ['~', 'badge orange', `Công lẻ ${day.vgc}`];
    if (day.dayType === 'HOLIDAY') return ['lễ', 'muted', day.holiday];
    if (day.dayType === 'SUNDAY') return ['', 'muted', 'Chủ nhật'];
    return rec ? ['?', 'badge red', 'Thiếu giờ'] : ['·', 'muted', 'Không có dữ liệu'];
  }

  window.hrTimesheetView = function () {
    ensureMonth();
    const f = F('hr-ts', { month: curMonth(), dept: '', q: '', sub: 'grid' }); const cfg = V.cfg(); const month = f.month || curMonth();
    const days = H.monthDays(month);
    let list = monthEmployees(month).filter((e) => (!f.dept || (e.payProfile?.workDept || '') === f.dept) && (!f.q || [e.id, e.name].some((v) => String(v || '').toLowerCase().includes(String(f.q).toLowerCase())))).filter((e) => V.isActive(e) || tsDoc(month, e.id));
    const tabs = `<div class="tabs" style="margin-bottom:14px"><button class="tab ${f.sub === 'grid' ? 'active' : ''}" data-act="hrts-sub" data-sub="grid"><i class="fa-solid fa-table-cells"></i>Bảng công</button><button class="tab ${f.sub === 'check' ? 'active' : ''}" data-act="hrts-sub" data-sub="check"><i class="fa-solid fa-triangle-exclamation"></i>Kiểm tra chấm công</button></div>`;
    const toolbar = `<div class="toolbar"><input class="inp" type="month" data-f="hr-ts.month" value="${esc(month)}">${selectFilter('hr-ts', 'dept', cfg.depts.map((d) => [d, d]), 'Tất cả bộ phận')}<input class="inp" data-f="hr-ts.q" value="${esc(f.q || '')}" placeholder="Tìm mã, tên…" style="min-width:160px"><span class="spacer"></span>${V.canHr() ? `<button class="btn btn-sm" data-act="hrts-import" data-kind="punch"><i class="fa-solid fa-file-import"></i>Nhập giờ vào/ra</button><button class="btn btn-sm" data-act="hrts-import" data-kind="matrix"><i class="fa-solid fa-table"></i>Nhập công "X"</button>` : ''}<button class="btn btn-sm" data-act="hrts-csv"><i class="fa-solid fa-file-csv"></i>Xuất CSV</button></div>`;
    const sums = list.map((e) => ({ e, s: summaryOf(e, cfg, month) }));
    const anomalies = sums.reduce((a, x) => a + x.s.anomalies.length, 0);
    const head = (pageTitle) => `${pageHead(pageTitle, 'Dữ liệu từ máy chấm công MTACO 5000A (giờ vào/ra, công "X") hoặc nhập tay; ca được gán theo giờ vào', '')}${tabs}
      <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Nhân viên', list.length, 'fa-users', 'blue')}${mkpi('Có dữ liệu chấm công', sums.filter((x) => x.s.hasData).length, 'fa-fingerprint', 'green')}${mkpi('Chưa có dữ liệu', sums.filter((x) => !x.s.hasData).length, 'fa-circle-question', 'orange')}${mkpi('Điểm cần kiểm', anomalies, 'fa-triangle-exclamation', anomalies ? 'red' : 'slate')}</div>`;
    if (f.sub === 'check') {
      const rows = []; sums.forEach(({ e, s }) => s.anomalies.forEach((a) => rows.push(`<tr class="clickable" data-act="hrts-day" data-emp="${esc(e.id)}" data-date="${a.date}"><td><span class="code">${esc(e.id)}</span></td><td>${esc(e.name)}</td><td>${esc(e.payProfile?.workDept || '—')}</td><td class="num">${fmtDate(a.date)} <span class="muted">${wdName[H.weekday(a.date)]}</span></td><td>${a.flags.map((k) => `<span class="badge orange">${esc(FLAG_TEXT[k] || k)}</span>`).join(' ')}</td><td class="right"><button class="btn btn-sm"><i class="fa-solid fa-pen"></i>Sửa</button></td></tr>`)));
      return `${head('Kiểm tra chấm công')}<div class="card">${toolbar}<div class="cell-sub" style="margin:8px 0">Theo quy trình: người có giờ chấm nhưng chưa có công "X" (hoặc ngược lại) phải kiểm tra lại giờ trước khi tính lương.</div>${tableShell([{ t: 'Mã' }, { t: 'Nhân viên' }, { t: 'Bộ phận' }, { t: 'Ngày' }, { t: 'Vấn đề' }, { t: '', cls: 'right' }], rows, { emptyTitle: 'Không có điểm nào cần kiểm tra' })}</div>`;
    }
    const r2s = (v) => (v ? String(v) : '');
    const pg = paged(sums, 'hr-ts', 25);
    const th = days.map((d) => { const w = H.weekday(d); return `<th class="center" style="min-width:30px;padding:2px 3px;${w === 0 ? 'background:#fde8e8' : ''}">${+d.slice(8)}<div class="cell-sub" style="font-size:10px">${wdName[w]}</div></th>`; }).join('');
    const rows = pg.items.map(({ e, s }) => {
      const tds = s.days.map((day) => { const rec = tsRecords(month, e.id).find((r) => r.date === day.date); const [t, cls, tip] = cellOf(day, rec); const bad = s.anomalies.some((a) => a.date === day.date);
        return `<td class="center" style="padding:2px;${bad ? 'outline:1px solid var(--orange)' : ''}" ${V.canHr() ? `data-act="hrts-day" data-emp="${esc(e.id)}" data-date="${day.date}" style="cursor:pointer"` : ''} title="${esc(tip)}"><span class="${cls}" style="padding:1px 4px">${esc(t)}</span></td>`; }).join('');
      return `<tr><td style="position:sticky;left:0;background:var(--bg,#fff);min-width:190px"><a data-act="hrts-emp" data-emp="${esc(e.id)}" style="cursor:pointer"><b>${esc(e.name)}</b></a><div class="cell-sub">${esc(e.id)} · ${esc(e.payProfile?.workDept || '—')}</div></td>${tds}<td class="right num strong">${s.cong}</td><td class="right num">${s.leave || ''}</td><td class="right num">${r2s(s.ot12 + s.ot14 + s.otCn + s.otLe)}</td></tr>`;
    });
    return `${head('Bảng chấm công ngày')}<div class="card">${toolbar}
      <div class="tbl-wrap" style="overflow:auto;margin-top:8px"><table class="line-tbl" style="font-size:12px"><thead><tr><th style="position:sticky;left:0;background:var(--bg,#fff)">Nhân viên</th>${th}<th class="right">Công</th><th class="right">Phép</th><th class="right">TC (giờ)</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="40" class="cell-sub">Không có nhân viên</td></tr>'}</tbody></table></div>${pagiHTML('hr-ts', pg, 'nhân viên')}
      <div class="cell-sub" style="margin-top:8px">X = đi làm · X+ = có tăng ca · ½ = nửa công · ~ = công lẻ (về giữa ca/trễ) · P = phép năm · L = nghỉ lễ hưởng lương · N = nghỉ không lương · CN/Lễ = làm Chủ nhật/ngày lễ (tính tăng ca) · ? = thiếu giờ · viền cam = cần kiểm</div></div>`;
  };

  /* ---- chi tiết một nhân viên trong tháng */
  function openEmp(empId) {
    const f = F('hr-ts'); const month = f.month || curMonth(); const e = V.employees().find((x) => x.id === empId); if (!e) return; const cfg = V.cfg(); const s = summaryOf(e, cfg, month);
    const recs = new Map(tsRecords(month, e.id).map((r) => [r.date, r]));
    const rows = s.days.filter((d) => recs.has(d.date) || d.dayType !== 'NORMAL' || d.cong || d.leave).map((d) => { const r = recs.get(d.date) || {};
      return `<tr ${V.canHr() ? `class="clickable" data-act="hrts-day" data-emp="${esc(e.id)}" data-date="${d.date}"` : ''}><td class="num">${fmtDate(d.date)} <span class="muted">${wdName[H.weekday(d.date)]}</span>${d.holiday ? `<div class="cell-sub">${esc(d.holiday)}</div>` : ''}</td><td>${esc(r.in || '')}</td><td>${esc(r.out || '')}</td><td>${esc(d.shift || '')}</td><td class="right num">${d.workedHours || ''}</td><td class="right num">${d.cong || d.vgc || ''}</td><td class="right num">${d.ot12 + d.ot14 || ''}</td><td class="right num">${d.otCn || d.otLe || ''}</td><td>${esc(r.mark || '')}</td><td>${d.flags.map((k) => `<span class="badge orange">${esc(FLAG_TEXT[k] || (k === 'LATE' ? 'Trễ ' + d.lateMin + "'" : k === 'EARLY_LEAVE' ? 'Về sớm ' + d.earlyMin + "'" : k === 'PARTIAL' ? 'Công lẻ' : k))}</span>`).join(' ')}</td></tr>`; }).join('');
    Modal.open({ title: `Chấm công · ${esc(e.name)}`, sub: `${esc(e.id)} · ${esc(e.payProfile?.workDept || '—')} · tháng ${month.slice(5)}/${month.slice(0, 4)} · ${s.cong} công, ${s.leave} phép, tăng ca ${r2(s.ot12 + s.ot14)}h + CN ${s.otCn}h + lễ ${s.otLe}h`, size: 'xl',
      body: `<div class="tbl-wrap" style="max-height:480px;overflow:auto"><table class="line-tbl"><thead><tr><th>Ngày</th><th>Giờ vào</th><th>Giờ ra</th><th>Ca</th><th class="right">Giờ làm</th><th class="right">Công</th><th class="right">TC thường (h)</th><th class="right">TC CN/lễ (h)</th><th>Ký hiệu</th><th>Ghi chú</th></tr></thead><tbody>${rows || '<tr><td colspan="10" class="cell-sub">Chưa có dữ liệu</td></tr>'}</tbody></table></div>`, foot: '<button class="btn" data-act="modal-close">Đóng</button>' });
  }
  const r2 = H.r2;

  /* ---- sửa một ngày */
  function openDay(empId, date) {
    if (!V.canHr()) return; const e = V.employees().find((x) => x.id === empId); if (!e) return; const month = date.slice(0, 7); const cfg = V.cfg();
    const rec = tsRecords(month, empId).find((r) => r.date === date) || {}; const day = H.calcDay({ date, ...rec }, ctxOf(e, cfg, month));
    const shiftOpts = ['<option value="">Tự gán theo giờ vào</option>'].concat(cfg.shifts.map((s) => `<option value="${s.code}" ${rec.shiftCode === s.code ? 'selected' : ''}>${s.code} · ${s.start}–${s.end}</option>`)).join('');
    const marks = [['', '— Không —'], ...Object.entries(H.MARKS).map(([k, v]) => [k, `${k} · ${v.label}`])].map(([v, l]) => `<option value="${v}" ${(rec.mark || '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
    Modal.open({ title: `Chấm công ${fmtDate(date)} (${wdName[H.weekday(date)]}) · ${esc(e.name)}`, sub: day.holiday ? `Ngày lễ: ${esc(day.holiday)}` : (day.dayType === 'SUNDAY' ? 'Chủ nhật: giờ làm tính tăng ca CN' : ''), size: 'md',
      body: `<div class="form-grid cols-2"><div class="field"><label>Giờ vào (HH:MM)</label><input class="inp" id="tsIn" value="${esc(rec.in || '')}" placeholder="05:00"></div><div class="field"><label>Giờ ra (HH:MM)</label><input class="inp" id="tsOut" value="${esc(rec.out || '')}" placeholder="13:00"></div>
        <div class="field"><label>Ca làm việc</label><select class="inp" id="tsShift">${shiftOpts}</select></div><div class="field"><label>Ký hiệu công</label><select class="inp" id="tsMark">${marks}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><input class="inp" id="tsNote" value="${esc(rec.note || '')}"></div></div>
        <div class="cell-sub" style="margin-top:8px">Kết quả hiện tại: ca ${esc(day.shift || '—')} · ${day.cong || day.vgc || 0} công · tăng ca ${H.r2(day.ot12 + day.ot14 + day.otCn + day.otLe)}h${day.flags.length ? ' · ' + day.flags.map((k) => FLAG_TEXT[k] || k).join(', ') : ''}</div>`,
      foot: `<button class="btn" data-act="hrts-day-del" data-emp="${esc(empId)}" data-date="${date}"><i class="fa-solid fa-eraser"></i>Xóa dòng</button><button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="hrts-day-save" data-emp="${esc(empId)}" data-date="${date}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>` });
  }
  async function saveDay(empId, date) {
    const inV = ($('#tsIn')?.value || '').trim(), outV = ($('#tsOut')?.value || '').trim();
    if ((inV && H.parseHM(inV) == null) || (outV && H.parseHM(outV) == null)) { Toast.err('Giờ không hợp lệ', 'Nhập giờ dạng HH:MM (ví dụ 05:00).'); return; }
    const rec = { in: inV, out: outV, shiftCode: $('#tsShift')?.value || '', mark: $('#tsMark')?.value || '', note: ($('#tsNote')?.value || '').trim(), source: 'MANUAL' };
    try { await saveDoc(date.slice(0, 7), empId, (d) => { if (!rec.in && !rec.out && !rec.mark && !rec.note) delete d.days[date]; else d.days[date] = { ...(d.days[date] || {}), ...rec }; }); } catch (err) { Toast.err('Không lưu được', err?.message || 'Vui lòng thử lại.'); return; }
    Modal.close(); render(); Toast.ok('Đã lưu chấm công', `${fmtDate(date)}`);
  }

  /* ---- đọc file (CSV/Excel) */
  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false; const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : (text.split('\n')[0].includes('\t') ? '\t' : ',');
    for (let i = 0; i < text.length; i++) { const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((c) => String(c).trim() !== '')) rows.push(row); row = []; } else cur += ch; }
    row.push(cur); if (row.some((c) => String(c).trim() !== '')) rows.push(row); return rows;
  }
  let xlsxPromise = null;
  const loadXlsx = () => { if (window.XLSX) return Promise.resolve(window.XLSX); if (!xlsxPromise) xlsxPromise = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => { xlsxPromise = null; rej(new Error('Không tải được thư viện đọc Excel')); }; document.head.appendChild(s); }); return xlsxPromise; };
  async function readSheet(file) {
    if (/\.(xlsx|xls)$/i.test(file.name)) { const X = await loadXlsx(); const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: false }); const ws = wb.Sheets[wb.SheetNames[0]]; return X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }); }
    return parseCsv(await file.text());
  }
  /* chuẩn hóa ngày / giờ từ ô Excel hoặc chuỗi */
  function toYmd(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
    const s = String(v).trim(); let m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/.exec(s); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  }
  function toHM(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { const frac = v - Math.floor(v); if (frac === 0 && v >= 1) return ''; const mins = Math.round(frac * 1440); return H.fmtHM(mins); }
    const m = /(\d{1,2})\s*[:hH.]\s*(\d{2})/.exec(String(v)); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
  }
  function findCol(header, res) { for (let i = 0; i < header.length; i++) { const h = norm(header[i]); if (res.some((r) => r.test(h))) return i; } return -1; }
  function matchEmp(idOrName, nameCell) {
    const ids = norm(idOrName), nm = norm(nameCell);
    return V.employees().find((e) => (e.payProfile?.mtacoId && norm(e.payProfile.mtacoId) === ids) || norm(e.id) === ids || (ids && norm(e.id).endsWith(ids) && ids.length >= 3 && /^\d+$/.test(ids)) || (nm && norm(e.name) === nm) || (ids && norm(e.name) === ids)) || null;
  }
  /** Máy chấm công xuất mỗi dòng 1 lần quẹt, hoặc 1 dòng/ngày có cột vào, ra. Trả về [{emp, date, in, out}] + cảnh báo. */
  function parsePunches(rows) {
    if (rows.length < 2) return { items: [], unmatched: [], error: 'File không có dữ liệu.' };
    let hi = rows.findIndex((r) => r.some((c) => /gio|time|ngay|date|ma|id/.test(norm(c))));
    if (hi < 0) hi = 0; const head = rows[hi]; const body = rows.slice(hi + 1);
    const cId = findCol(head, [/^id$/, /manv/, /machamcong/, /mans/, /^ma$/, /userid/, /^no$/, /manhanvien/, /ms/]), cName = findCol(head, [/^ten/, /hoten/, /^name$/]);
    const cDate = findCol(head, [/^ngay/, /^date$/, /ngaychamcong/]), cIn = findCol(head, [/giovao/, /checkin/, /^in$/, /^vao$/, /giovaoca/]), cOut = findCol(head, [/giora/, /checkout/, /^out$/, /^ra$/]);
    const cTime = findCol(head, [/thoigian/, /datetime/, /^time$/, /giochamcong/, /^gio$/]);
    const unmatched = new Set(); const items = [];
    const getEmp = (r) => matchEmp(cId >= 0 ? r[cId] : '', cName >= 0 ? r[cName] : '');
    if (cIn >= 0 && cOut >= 0 && cDate >= 0) {
      body.forEach((r) => { const date = toYmd(r[cDate]); if (!date) return; const e = getEmp(r); if (!e) { unmatched.add(String(r[cId] ?? r[cName] ?? '').trim()); return; }
        items.push({ emp: e, date, in: toHM(r[cIn]), out: toHM(r[cOut]) }); });
      return { items: items.filter((x) => x.in || x.out), unmatched: [...unmatched].filter(Boolean), mode: 'in-out' };
    }
    if (cTime >= 0 || cDate >= 0) {
      const punches = new Map();
      body.forEach((r) => { let date = '', hm = '';
        if (cTime >= 0) { const raw = r[cTime]; if (typeof raw === 'number' && raw > 20000) { date = toYmd(raw); hm = toHM(raw); } else { date = toYmd(raw) || (cDate >= 0 ? toYmd(r[cDate]) : ''); hm = toHM(raw); } }
        else { date = toYmd(r[cDate]); hm = toHM(r[cDate + 1]); }
        if (!date || !hm) return; const e = getEmp(r); if (!e) { unmatched.add(String(r[cId] ?? r[cName] ?? '').trim()); return; }
        const k = e.id; if (!punches.has(k)) punches.set(k, { e, list: [] }); punches.get(k).list.push(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5)) / 60000); });
      punches.forEach(({ e, list }) => { list.sort((a, b) => a - b); const uniq = list.filter((t, i) => i === 0 || t - list[i - 1] > 2); let i = 0;
        const ymdOf = (t) => new Date(t * 60000).toISOString().slice(0, 10), hmOf = (t) => new Date(t * 60000).toISOString().slice(11, 16);
        while (i < uniq.length) { const a = uniq[i], b = uniq[i + 1]; if (b != null && b - a <= 16 * 60) { items.push({ emp: e, date: ymdOf(a), in: hmOf(a), out: hmOf(b) }); i += 2; } else { items.push({ emp: e, date: ymdOf(a), in: hmOf(a), out: '' }); i += 1; } } });
      return { items, unmatched: [...unmatched].filter(Boolean), mode: 'punches' };
    }
    return { items: [], unmatched: [], error: 'Không nhận ra cột ngày / giờ vào / giờ ra. Cần có cột Mã NV, Ngày, Giờ vào, Giờ ra (hoặc Thời gian quẹt thẻ).' };
  }
  /** Ma trận công "X": mỗi nhân viên một dòng, các cột là ngày 1..31. */
  function parseMatrix(rows, month) {
    let hi = rows.findIndex((r) => r.filter((c) => /^\d{1,2}$/.test(String(c).trim()) || (typeof c === 'number' && c >= 1 && c <= 31)).length >= 20);
    if (hi < 0) return { items: [], unmatched: [], error: 'Không tìm thấy dòng tiêu đề có các cột ngày 1…31.' };
    const head = rows[hi]; const dayCols = []; head.forEach((c, i) => { const d = Number(String(c).trim()); if (Number.isInteger(d) && d >= 1 && d <= 31) dayCols.push([i, d]); });
    const first = dayCols[0][0]; const cId = findCol(head.slice(0, first), [/manv/, /^ma$/, /^id$/, /machamcong/, /mans/]), cName = findCol(head.slice(0, first), [/^ten/, /hoten/]);
    const items = [], unmatched = new Set(); const mk = (v) => { const s = String(v ?? '').trim().toUpperCase(); if (!s) return ''; if (s === '1' || s === 'X') return 'X'; if (s === '0.5' || s === '0,5' || s === 'X/2' || s === '1/2') return 'X/2'; if (['P', 'L', 'N', 'KP'].includes(s)) return s; if (s === 'PN') return 'P'; return ''; };
    rows.slice(hi + 1).forEach((r) => { const e = matchEmp(cId >= 0 ? r[cId] : (cName < 0 ? r[0] : ''), cName >= 0 ? r[cName] : ''); if (!r.some((c) => String(c).trim())) return; if (!e) { unmatched.add(String((cId >= 0 ? r[cId] : r[0]) ?? '').trim() || String(r[cName] ?? '').trim()); return; }
      dayCols.forEach(([ci, d]) => { const m = mk(r[ci]); const dim = H.dim(+month.slice(0, 4), +month.slice(5)); if (m && d <= dim) items.push({ emp: e, date: `${month}-${String(d).padStart(2, '0')}`, mark: m }); }); });
    return { items, unmatched: [...unmatched].filter(Boolean), mode: 'matrix' };
  }
  let pending = null;
  function openImport(kind) {
    const f = F('hr-ts'); const month = f.month || curMonth();
    pending = null;
    Modal.open({ title: kind === 'punch' ? 'Nhập giờ vào/ra từ máy chấm công' : 'Nhập công "X" từ Excel', sub: `Tháng ${month.slice(5)}/${month.slice(0, 4)} · file .csv hoặc .xlsx xuất từ máy MTACO 5000A`, size: 'lg',
      body: `<div class="field"><label>Chọn file</label><input class="inp" id="tsFile" type="file" accept=".csv,.xlsx,.xls,.txt"></div>
        <div class="cell-sub" style="margin:6px 0">${kind === 'punch' ? 'Cột cần có: Mã NV (hoặc Tên), Ngày, Giờ vào, Giờ ra — hoặc một cột Thời gian quẹt thẻ (mỗi lần quẹt một dòng; hệ thống ghép giờ vào/ra, kể cả ca qua đêm).' : 'Mỗi nhân viên một dòng; tiêu đề có các cột ngày 1…31; ô là X, 1, 0.5, X/2, P, L, N.'} Mã nhân viên khớp theo "Mã chấm công" trong hồ sơ lương, mã nhân viên hoặc họ tên.</div>
        <div id="tsPreview" class="cell-sub">Chưa chọn file.</div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" id="tsImportGo" data-act="hrts-import-go" data-kind="${kind}" disabled><i class="fa-solid fa-file-import"></i>Nhập dữ liệu</button>`,
      onMount: () => {
        $('#tsFile')?.addEventListener('change', async (ev) => {
          const file = ev.target.files?.[0]; const pv = $('#tsPreview'); if (!file) return; pv.textContent = 'Đang đọc file…';
          try {
            const rows = await readSheet(file); const res = kind === 'punch' ? parsePunches(rows) : parseMatrix(rows, month);
            if (res.error) { pv.innerHTML = `<span style="color:var(--red)">${esc(res.error)}</span>`; return; }
            const inMonth = res.items.filter((x) => x.date.slice(0, 7) === month); const out = res.items.length - inMonth.length;
            pending = { kind, month, items: inMonth };
            const emps = new Set(inMonth.map((x) => x.emp.id)).size;
            pv.innerHTML = `<div class="alert info"><i class="fa-solid fa-circle-info"></i><span>Đọc được <b>${inMonth.length}</b> dòng của <b>${emps}</b> nhân viên trong tháng ${month.slice(5)}/${month.slice(0, 4)}${out ? ` (bỏ ${out} dòng thuộc tháng khác)` : ''}.</span></div>${res.unmatched.length ? `<div class="alert warning" style="margin-top:8px"><i class="fa-solid fa-triangle-exclamation"></i><span>Không khớp nhân viên: ${res.unmatched.slice(0, 15).map(esc).join(', ')}${res.unmatched.length > 15 ? '…' : ''}. Đặt "Mã chấm công" trong Hồ sơ lương rồi nhập lại.</span></div>` : ''}<div class="cell-sub" style="margin-top:6px">Dữ liệu đã có cùng ngày sẽ được cập nhật ${kind === 'punch' ? 'giờ vào/ra' : 'ký hiệu công'}, các thông tin khác giữ nguyên.</div>`;
            $('#tsImportGo').disabled = inMonth.length === 0;
          } catch (err) { pv.innerHTML = `<span style="color:var(--red)">Không đọc được file: ${esc(err.message || err)}. Thử lưu sang CSV.</span>`; }
        });
      } });
  }
  async function importGo() {
    if (!pending || !pending.items.length) return; const { kind, month, items } = pending; const btn = $('#tsImportGo'); if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu…'; }
    const byEmp = new Map(); items.forEach((x) => { if (!byEmp.has(x.emp.id)) byEmp.set(x.emp.id, []); byEmp.get(x.emp.id).push(x); });
    try {
      const ids = [...byEmp.keys()];
      for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map((id) => saveDoc(month, id, (d) => { byEmp.get(id).forEach((x) => { const cur = d.days[x.date] || {}; d.days[x.date] = kind === 'punch' ? { ...cur, in: x.in || cur.in || '', out: x.out || cur.out || '', source: 'MTACO' } : { ...cur, mark: x.mark, markSource: 'XLS' }; }); })));
    } catch (err) { Toast.err('Không lưu được dữ liệu chấm công', err?.message || 'Vui lòng thử lại.'); if (btn) { btn.disabled = false; btn.textContent = 'Nhập dữ liệu'; } return; }
    pending = null; Modal.close(); render(); Toast.ok('Đã nhập dữ liệu chấm công', `${items.length} dòng · ${byEmp.size} nhân viên`);
  }
  function exportCsv() {
    const f = F('hr-ts'); const month = f.month || curMonth(); const cfg = V.cfg(); const rows = [];
    monthEmployees(month).forEach((e) => { const s = summaryOf(e, cfg, month); const recs = new Map(tsRecords(month, e.id).map((r) => [r.date, r]));
      s.days.forEach((d) => { const r = recs.get(d.date); if (!r && !d.cong && !d.leave) return; rows.push([e.id, e.name, e.payProfile?.workDept || '', d.date, r?.in || '', r?.out || '', d.shift, d.workedHours, d.cong, d.vgc, d.ot12, d.ot14, d.otCn, d.otLe, d.leave, d.nightUnits, r?.mark || '', d.flags.join('|')]); }); });
    Exporter.csv(`Bang-cong-ngay-${month}.csv`, ['Mã NV', 'Họ tên', 'Bộ phận', 'Ngày', 'Giờ vào', 'Giờ ra', 'Ca', 'Giờ làm', 'Công', 'Công lẻ', 'TC 1.2', 'TC 1.4', 'TC CN', 'TC lễ', 'Phép', 'Đêm', 'Ký hiệu', 'Cảnh báo'], rows);
  }
  window.HRTimesheet.parsePunches = parsePunches; window.HRTimesheet.parseMatrix = parseMatrix; window.HRTimesheet.parseCsv = parseCsv;
  Object.assign(Actions, {
    'hrts-sub': (d) => { F('hr-ts').sub = d.sub; render(); }, 'hrts-emp': (d) => openEmp(d.emp), 'hrts-day': (d) => openDay(d.emp, d.date),
    'hrts-day-save': (d) => saveDay(d.emp, d.date),
    'hrts-day-del': async (d) => { try { await saveDoc(d.date.slice(0, 7), d.emp, (x) => { delete x.days[d.date]; }); } catch (err) { Toast.err('Không xóa được', err?.message || ''); return; } Modal.close(); render(); Toast.ok('Đã xóa dòng chấm công', fmtDate(d.date)); },
    'hrts-import': (d) => openImport(d.kind), 'hrts-import-go': () => importGo(), 'hrts-csv': () => exportCsv(),
  });
})();

/* ============================================================================
 * THỐNG KÊ NGÀY: tài xế / giao hàng (đơn, chuyến, loại công A/B/C) và bốc xếp (tấn)
 * ========================================================================== */
(function () {
  'use strict';
  const H = window.HRPay, V = window.HRV2, T = window.HRTimesheet; const { n } = H;
  const store = V.store; const curMonth = () => V.todayYmd().slice(0, 7);
  const statsId = (m) => `ST-${m}`;
  const statsRows = (m) => (store.get('stats', statsId(m))?.rows || []);
  async function saveStats(month, mutate) {
    const old = store.get('stats', statsId(month)); const doc = JSON.parse(JSON.stringify(old || { id: statsId(month), month, rows: [] })); mutate(doc.rows);
    doc.updatedAt = new Date().toISOString(); doc.updatedBy = V.who(); await store.save('stats', doc);
  }
  window.HRStats = { statsRows, saveStats };
  const TYPE_LABEL = { DELIVERY: 'Giao hàng', LOADING: 'Bốc xếp' };
  const rid = () => 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const empOf = (id) => V.employees().find((e) => e.id === id);

  window.hrDayStatsView = function () {
    Promise.all([store.ensure('stats'), store.ensure('config')]).then(() => { if (State.module === 'hr' && State.tab === 'daystats' && !window.__hrStLoaded) { window.__hrStLoaded = true; render(); } });
    const f = F('hr-st', { month: curMonth(), type: '', q: '' }); const month = f.month || curMonth(); const cfg = V.cfg();
    const rows = statsRows(month).filter((r) => (!f.type || r.type === f.type) && (!f.q || [r.empId, empOf(r.empId)?.name].some((v) => String(v || '').toLowerCase().includes(String(f.q).toLowerCase())))).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.empId).localeCompare(String(b.empId)));
    const byEmp = new Map(); statsRows(month).forEach((r) => { const k = r.empId; const g = byEmp.get(k) || { orders: 0, trips: 0, tons: 0, days: new Set(), lv: { A: 0, B: 0, C: 0 }, failed: 0 }; g.orders += n(r.orders); g.trips += n(r.trips); g.tons += n(r.tons); g.failed += n(r.failed); g.days.add(r.date); if (g.lv[r.level] != null) g.lv[r.level]++; byEmp.set(k, g); });
    const sumRows = [...byEmp.entries()].map(([id, g]) => `<tr><td><span class="code">${esc(id)}</span> ${esc(empOf(id)?.name || '')}</td><td class="right num">${g.days.size}</td><td class="right num">${g.orders || ''}</td><td class="right num">${g.trips || ''}</td><td class="right num">${g.tons ? H.r2(g.tons) : ''}</td><td class="num">A:${g.lv.A} · B:${g.lv.B} · C:${g.lv.C}</td><td>${g.failed ? `<span class="badge red">${g.failed} đơn rớt</span>` : '<span class="badge green">Không rớt đơn</span>'}</td></tr>`).join('');
    const body = rows.map((r) => `<tr><td class="num">${fmtDate(r.date)}</td><td><span class="code">${esc(r.empId)}</span> ${esc(empOf(r.empId)?.name || '—')}</td><td>${esc(TYPE_LABEL[r.type] || r.type)}</td><td class="right num">${r.orders || ''}</td><td class="right num">${r.trips || ''}</td><td class="right num">${r.tons || ''}</td><td>${r.level ? `<span class="badge blue">Công ${esc(r.level)}</span>` : '<span class="muted">—</span>'}</td><td>${r.failed ? `<span class="badge red">${r.failed} rớt</span>` : ''}</td><td>${esc(r.note || '')}${r.source ? `<div class="cell-sub">${esc(r.source)}</div>` : ''}</td><td class="right">${V.canHr() ? `<button class="btn btn-sm" data-act="hrst-edit" data-id="${esc(r.id)}"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm" data-act="hrst-del" data-id="${esc(r.id)}"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`);
    return `${pageHead('Thống kê chuyến, đơn và tấn', 'Tài xế, giao hàng tính công A/B/C theo số đơn; bốc xếp tính theo tấn — dùng cho bảng lương', V.canHr() ? `<button class="btn" data-act="hrst-logi"><i class="fa-solid fa-truck-fast"></i>Nạp từ Logistics</button><button class="btn" data-act="hrst-import"><i class="fa-solid fa-file-import"></i>Nhập CSV</button><button class="btn btn-primary" data-act="hrst-add"><i class="fa-solid fa-plus"></i>Thêm dòng</button>` : '')}
      <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Tổng hợp theo nhân viên</h3><p>Loại công theo ngày dùng để tính tiền công tài xế / giao hàng</p></div></div>${tableShell([{ t: 'Nhân viên' }, { t: 'Số ngày', cls: 'right' }, { t: 'Đơn', cls: 'right' }, { t: 'Chuyến', cls: 'right' }, { t: 'Tấn', cls: 'right' }, { t: 'Số ngày theo loại công' }, { t: 'Rớt đơn' }], [sumRows], { emptyTitle: 'Chưa có thống kê trong tháng' })}</div>
      <div class="card"><div class="toolbar"><input class="inp" type="month" data-f="hr-st.month" value="${esc(month)}">${selectFilter('hr-st', 'type', [['DELIVERY', 'Giao hàng'], ['LOADING', 'Bốc xếp']], 'Tất cả loại')}<input class="inp" data-f="hr-st.q" value="${esc(f.q || '')}" placeholder="Tìm mã, tên…"></div>${tableShell([{ t: 'Ngày' }, { t: 'Nhân viên' }, { t: 'Loại' }, { t: 'Số đơn', cls: 'right' }, { t: 'Số chuyến', cls: 'right' }, { t: 'Tấn', cls: 'right' }, { t: 'Loại công' }, { t: 'Rớt đơn' }, { t: 'Ghi chú' }, { t: '', cls: 'right' }], body, { emptyTitle: 'Chưa có dòng thống kê' })}</div>`;
  };

  function openStat(id) {
    const month = F('hr-st').month || curMonth(); const r = id ? statsRows(month).find((x) => x.id === id) : null; const cfg = V.cfg();
    const emps = V.employees().filter((e) => V.isActive(e)); const opt = emps.map((e) => `<option value="${esc(e.id)}" ${r?.empId === e.id ? 'selected' : ''}>${esc(e.id)} · ${esc(e.name)}</option>`).join('');
    const sug = (o) => H.suggestLevel(o, cfg);
    Modal.open({ title: r ? 'Sửa thống kê' : 'Thêm thống kê ngày', size: 'md',
      body: `<div class="form-grid cols-2"><div class="field"><label>Ngày <span class="req">*</span></label><input class="inp" id="stDate" type="date" value="${esc(r?.date || V.todayYmd())}"></div><div class="field"><label>Nhân viên <span class="req">*</span></label><select class="inp" id="stEmp"><option value="">— Chọn —</option>${opt}</select></div>
        <div class="field"><label>Loại</label><select class="inp" id="stType"><option value="DELIVERY" ${r?.type !== 'LOADING' ? 'selected' : ''}>Giao hàng (tài xế / giao hàng)</option><option value="LOADING" ${r?.type === 'LOADING' ? 'selected' : ''}>Bốc xếp</option></select></div>
        <div class="field"><label>Số đơn</label><input class="inp right num" id="stOrders" type="number" min="0" value="${r?.orders ?? ''}"></div><div class="field"><label>Số chuyến</label><input class="inp right num" id="stTrips" type="number" min="0" value="${r?.trips ?? ''}"></div>
        <div class="field"><label>Tấn hàng</label><input class="inp right num" id="stTons" type="number" min="0" step="0.01" value="${r?.tons ?? ''}"></div>
        <div class="field"><label>Loại công (A/B/C)</label><select class="inp" id="stLevel"><option value="">${sug(r?.orders) ? 'Tự gợi ý theo số đơn' : '— Chưa chọn —'}</option>${cfg.driver.cong.map((c) => `<option value="${c.code}" ${r?.level === c.code ? 'selected' : ''}>Công ${c.code} · ${V.money(c.rate)}</option>`).join('')}</select></div>
        <div class="field"><label>Số đơn rớt</label><input class="inp right num" id="stFailed" type="number" min="0" value="${r?.failed ?? ''}"></div>
        <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><input class="inp" id="stNote" value="${esc(r?.note || '')}"></div></div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="hrst-save" data-id="${esc(id || '')}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>` });
  }
  async function saveStat(id) {
    const date = $('#stDate')?.value, empId = $('#stEmp')?.value; if (!date || !empId) { Toast.err('Thiếu thông tin', 'Chọn ngày và nhân viên.'); return; }
    const cfg = V.cfg(); const type = $('#stType').value; const orders = n($('#stOrders').value);
    const row = { id: id || rid(), date, empId, type, orders, trips: n($('#stTrips').value), tons: n($('#stTons').value), failed: n($('#stFailed').value), level: $('#stLevel').value || (type === 'DELIVERY' ? H.suggestLevel(orders, cfg) : ''), note: ($('#stNote').value || '').trim(), source: 'MANUAL' };
    try { await saveStats(date.slice(0, 7), (rows) => { const i = rows.findIndex((x) => x.id === row.id); if (i >= 0) rows[i] = row; else rows.push(row); }); } catch (err) { Toast.err('Không lưu được', err?.message || ''); return; }
    F('hr-st').month = date.slice(0, 7); Modal.close(); render(); Toast.ok('Đã lưu thống kê', `${fmtDate(date)} · ${empId}`);
  }
  /** Nạp đơn / chuyến của tài xế từ dữ liệu Logistics (đơn giao đã hoàn thành). */
  function fromLogistics() {
    const month = F('hr-st').month || curMonth(); let L = null;
    try { L = JSON.parse(localStorage.getItem('lenam_logistics_v2') || 'null'); } catch (_) {}
    if (!L || !Array.isArray(L.deliveries)) { Toast.warn('Chưa có dữ liệu Logistics', 'Mở mô-đun Logistics để nạp dữ liệu đơn giao trước.'); return; }
    const driverEmp = (dr) => V.employees().find((e) => e.payProfile?.logisticsDriverId === dr.id) || V.employees().find((e) => T.norm(e.name) === T.norm(dr.name));
    const DONE = ['DELIVERED', 'PARTIAL', 'CLOSED'], cfg = V.cfg(); const acc = new Map(); const missing = new Set();
    L.deliveries.forEach((d) => { const date = String(d.actualDelivered || d.promisedDate || '').slice(0, 10); if (date.slice(0, 7) !== month) return; const failed = d.status === 'FAILED'; if (!DONE.includes(d.status) && !failed) return;
      const dr = (L.drivers || []).find((x) => x.id === d.driverId); if (!dr) return; const e = driverEmp(dr); if (!e) { missing.add(dr.name || dr.id); return; }
      const k = `${e.id}|${date}`; const g = acc.get(k) || { empId: e.id, date, orders: 0, trips: new Set(), failed: 0 }; if (failed) g.failed++; else { g.orders++; g.trips.add(d.tripId || d.id); } acc.set(k, g); });
    if (!acc.size) { Toast.info('Không có đơn để nạp', missing.size ? `Chưa liên kết tài xế với nhân viên: ${[...missing].join(', ')}. Điền "Mã tài xế bên Logistics" trong Hồ sơ lương.` : 'Tháng này chưa có đơn giao hoàn thành.'); return; }
    Modal.open({ title: 'Nạp thống kê từ Logistics', sub: `Tháng ${month.slice(5)}/${month.slice(0, 4)} · ${acc.size} ngày-tài xế`, size: 'md',
      body: `<div class="cell-sub">Đếm đơn giao hoàn thành theo tài xế và ngày; số chuyến = số mã chuyến khác nhau. Dòng đã có sẽ được cập nhật số đơn, chuyến, rớt đơn; <b>loại công và ghi chú giữ nguyên</b>.</div>${missing.size ? `<div class="alert warning" style="margin-top:10px"><i class="fa-solid fa-triangle-exclamation"></i><span>Bỏ qua tài xế chưa liên kết nhân viên: ${[...missing].map(esc).join(', ')}.</span></div>` : ''}`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" id="stLogiGo"><i class="fa-solid fa-truck-fast"></i>Nạp ${acc.size} dòng</button>`,
      onMount: () => { $('#stLogiGo')?.addEventListener('click', async () => {
        try { await saveStats(month, (rows) => { acc.forEach((g) => { const cur = rows.find((r) => r.type === 'DELIVERY' && r.empId === g.empId && r.date === g.date); const orders = g.orders, trips = g.trips.size; if (cur) Object.assign(cur, { orders, trips, failed: g.failed, source: 'Logistics' }); else rows.push({ id: rid(), date: g.date, empId: g.empId, type: 'DELIVERY', orders, trips, failed: g.failed, tons: 0, level: H.suggestLevel(orders, cfg), note: '', source: 'Logistics' }); }); }); } catch (err) { Toast.err('Không lưu được', err?.message || ''); return; }
        Modal.close(); render(); Toast.ok('Đã nạp thống kê từ Logistics', `${acc.size} dòng`); }); } });
  }
  function openImportStats() {
    const month = F('hr-st').month || curMonth();
    Modal.open({ title: 'Nhập thống kê từ CSV', size: 'md', body: `<div class="field"><label>File CSV / Excel</label><input class="inp" id="stFile" type="file" accept=".csv,.txt,.xlsx,.xls"></div><div class="cell-sub">Cột: Ngày, Mã NV (hoặc Tên), Loại (Giao hàng / Bốc xếp), Số đơn, Số chuyến, Tấn, Loại công (A/B/C), Rớt đơn.</div><div id="stPv" class="cell-sub" style="margin-top:8px"></div>`, foot: '<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" id="stImpGo" disabled>Nhập</button>',
      onMount: () => { let items = [];
        $('#stFile')?.addEventListener('change', async (ev) => { const file = ev.target.files?.[0]; if (!file) return; const pv = $('#stPv');
          try { let rows; if (/\.xls/i.test(file.name)) { const X = await (window.XLSX ? Promise.resolve(window.XLSX) : new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('Không tải được thư viện Excel')); document.head.appendChild(s); })); const wb = X.read(await file.arrayBuffer(), { type: 'array' }); rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }); } else rows = T.parseCsv(await file.text());
            const head = rows[0].map(T.norm); const col = (res) => head.findIndex((h) => res.some((r) => r.test(h)));
            const cD = col([/ngay/, /date/]), cE = col([/manv/, /^ma$/, /^id$/, /ten/, /name/]), cT = col([/loai$/, /type/]), cO = col([/sodon/, /orders/]), cTr = col([/sochuyen/, /trips/]), cTn = col([/tan/, /tons/]), cL = col([/loaicong/, /level/, /^cong$/]), cF = col([/rot/, /failed/]);
            const miss = new Set(); items = [];
            rows.slice(1).forEach((r) => { const date = (() => { const v = r[cD]; if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); const s = String(v).trim(); let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(s); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; })(); if (!date) return;
              const key = T.norm(r[cE]); const e = V.employees().find((x) => T.norm(x.id) === key || T.norm(x.name) === key || (x.payProfile?.mtacoId && T.norm(x.payProfile.mtacoId) === key)); if (!e) { miss.add(String(r[cE])); return; }
              const tt = T.norm(r[cT]); const type = /boc|xep|load/.test(tt) ? 'LOADING' : 'DELIVERY'; items.push({ id: rid(), date, empId: e.id, type, orders: n(r[cO]), trips: n(r[cTr]), tons: n(r[cTn]), level: String(r[cL] || '').trim().toUpperCase().slice(0, 1), failed: n(r[cF]), note: '', source: 'CSV' }); });
            pv.innerHTML = `Đọc được <b>${items.length}</b> dòng.${miss.size ? ` <span style="color:var(--orange)">Không khớp nhân viên: ${[...miss].slice(0, 10).map(esc).join(', ')}</span>` : ''}`; $('#stImpGo').disabled = !items.length;
          } catch (err) { pv.innerHTML = `<span style="color:var(--red)">${esc(err.message || err)}</span>`; } });
        $('#stImpGo')?.addEventListener('click', async () => { const byMonth = {}; items.forEach((x) => (byMonth[x.date.slice(0, 7)] = byMonth[x.date.slice(0, 7)] || []).push(x));
          try { for (const [m, list] of Object.entries(byMonth)) await saveStats(m, (rows) => list.forEach((x) => { const i = rows.findIndex((r) => r.type === x.type && r.empId === x.empId && r.date === x.date); if (i >= 0) rows[i] = { ...rows[i], ...x, id: rows[i].id }; else rows.push(x); })); } catch (err) { Toast.err('Không lưu được', err?.message || ''); return; }
          Modal.close(); render(); Toast.ok('Đã nhập thống kê', `${items.length} dòng`); }); } });
  }
  Object.assign(Actions, {
    'hrst-add': () => openStat(''), 'hrst-edit': (d) => openStat(d.id), 'hrst-save': (d) => saveStat(d.id),
    'hrst-del': async (d) => { const month = F('hr-st').month || curMonth(); try { await saveStats(month, (rows) => { const i = rows.findIndex((r) => r.id === d.id); if (i >= 0) rows.splice(i, 1); }); } catch (err) { Toast.err('Không xóa được', err?.message || ''); return; } render(); Toast.ok('Đã xóa dòng thống kê', ''); },
    'hrst-logi': () => fromLogistics(), 'hrst-import': () => openImportStats(),
  });
})();

/* ============================================================================
 * BẢNG LƯƠNG THÁNG (24 cột theo file) — tính từ bảng công, thống kê ngày, hồ sơ lương và cấu hình
 * ========================================================================== */
(function () {
  'use strict';
  const H = window.HRPay, V = window.HRV2, T = window.HRTimesheet, S = window.HRStats; const { n, r0 } = H;
  const store = V.store; const money = V.money; const curMonth = () => V.todayYmd().slice(0, 7);
  const runOf = (m) => store.get('runs', m);
  const isLocked = (m) => runOf(m)?.status === 'LOCKED';
  const unjsonRow = (r) => r;

  /** Tính toàn bộ bảng lương của tháng (hoặc lấy bản chốt). */
  function computeMonth(month) {
    const run = runOf(month);
    if (run?.status === 'LOCKED' && Array.isArray(run.rows)) return { rows: run.rows, locked: true, run };
    const cfg = V.cfg(); const stats = S.statsRows(month); const adjAll = run?.adj || {}; const rows = [];
    T.monthEmployees(month).forEach((e) => {
      const p = e.payProfile || {}; if (!p.payGroup && p.payType !== 'LOADER') { if (!T.tsDoc(month, e.id)) return; }
      const summary = T.summarizeMonth ? T.summarizeMonth(e, cfg, month) : T.summaryOf(e, cfg, month);
      const mine = stats.filter((s) => s.empId === e.id); const adj = { ...(adjAll[e.id] || {}) };
      if (adj.noDropOrders === undefined || adj.noDropOrders === 'AUTO') adj.noDropOrders = mine.some((s) => s.type === 'DELIVERY') && !mine.some((s) => n(s.failed) > 0);
      else adj.noDropOrders = adj.noDropOrders === true || adj.noDropOrders === 'YES';
      const r = H.calcPayroll(e, { cfg, month, summary, stats, adj });
      r.workDept = p.workDept || 'Chưa phân bộ phận'; r.position = e.position || ''; r.hasData = summary.hasData || mine.length > 0; r.anomalies = summary.anomalies.length; r.adj = adjAll[e.id] || {};
      r.payTypeLabel = p.payType || r.payType; if (!r.hasData && r.payType !== 'FLAT') r.warnings.unshift('Chưa có dữ liệu chấm công trong tháng.');
      if (summary.anomalies.length) r.warnings.push(`${summary.anomalies.length} điểm chấm công cần kiểm.`);
      rows.push(r);
    });
    return { rows, locked: false, run };
  }
  window.HRPayroll = { computeMonth, isLocked };

  const COLS = [
    ['amtCong', 'Thành tiền công'], ['amtCongDoi', 'Công dôi'], ['amtHieuHi', 'Hiếu hỉ'], ['amtVgc', 'Về giữa ca'], ['amtOt12', 'TC 1.2'], ['amtOt14', 'TC 1.4'], ['amtOtCn', 'TC Chủ nhật'], ['amtOtLe', 'TC lễ'], ['amtPhepNam', 'Phép năm'],
    ['amtResp', 'Trách nhiệm'], ['amtCompletion', 'Thưởng hoàn thành'], ['amtHousing', 'Nhà ở'], ['amtFuel', 'Xăng'], ['amtPhone', 'Điện thoại'], ['amtSeniority', 'Thâm niên'], ['amtMeal', 'Tiền cơm'], ['amtNight', 'Bồi dưỡng đêm'],
    ['amtAttendance', 'Chuyên cần'], ['amtDegree', 'Bằng cấp'], ['amtKpiDriver', 'KPI TX/GH'], ['amtKpiStore', 'KPI cửa hàng'], ['amtOtherBonus', 'Thưởng khác'],
  ];
  const DEDS = [['bhxh', 'BHXH'], ['bhyt', 'BHYT'], ['bhtn', 'BHTN'], ['union', 'Công đoàn'], ['tax', 'Thuế TNCN'], ['kpiDeduct', 'Trừ KPI'], ['truyThuBH', 'Truy thu BH'], ['otherDeduct', 'Khoản trừ khác']];
  const sumBy = (rows, k) => rows.reduce((s, r) => s + n(r[k]), 0);
  const cellMoney = (v) => (n(v) ? r0(v).toLocaleString('vi-VN') : '');
  const qty = (v, d = 2) => (n(v) ? String(H.r2(v)) : '');

  function pageData() {
    const f = F('hr-pay', { month: curMonth(), dept: '', q: '', sub: 'sheet' }); const month = f.month || curMonth();
    const { rows, locked, run } = computeMonth(month);
    const list = rows.filter((r) => (!f.dept || r.workDept === f.dept) && (!f.q || [r.empId, r.name].some((v) => String(v || '').toLowerCase().includes(String(f.q).toLowerCase()))));
    return { f, month, rows, list, locked, run };
  }

  window.hrPayrollView = function () {
    Promise.all([store.ensure('runs'), store.ensure('timesheets'), store.ensure('stats'), store.ensure('config')]).then(() => { if (State.module === 'hr' && State.tab === 'payroll' && !window.__hrPayLoaded) { window.__hrPayLoaded = true; render(); } });
    const { f, month, rows, list, locked, run } = pageData(); const cfg = V.cfg();
    const tot = (k) => sumBy(list, k);
    const tabs = `<div class="tabs" style="margin-bottom:14px"><button class="tab ${f.sub === 'sheet' ? 'active' : ''}" data-act="hrpay-sub" data-sub="sheet"><i class="fa-solid fa-table"></i>Bảng lương</button><button class="tab ${f.sub === 'dept' ? 'active' : ''}" data-act="hrpay-sub" data-sub="dept"><i class="fa-solid fa-building-user"></i>Theo bộ phận</button></div>`;
    const warn = rows.filter((r) => r.warnings.length).length;
    const head = `${pageHead('Tính lương', 'Bảng lương tháng tính từ bảng công ngày, thống kê chuyến/tấn, hồ sơ lương và cấu hình', `<button class="btn" data-act="hrpay-csv"><i class="fa-solid fa-file-csv"></i>Xuất CSV</button><button class="btn" data-act="hrpay-slips"><i class="fa-solid fa-print"></i>In phiếu lương</button>${V.canHr() ? (locked ? '<button class="btn" data-act="hrpay-unlock"><i class="fa-solid fa-lock-open"></i>Mở lại</button>' : '<button class="btn btn-primary" data-act="hrpay-lock"><i class="fa-solid fa-lock"></i>Chốt bảng lương</button>') : ''}`)}${tabs}
      ${locked ? `<div class="alert info" style="margin-bottom:10px"><i class="fa-solid fa-lock"></i><span>Bảng lương tháng ${month.slice(5)}/${month.slice(0, 4)} đã chốt ${esc(String(run?.lockedAt || '').replace('T', ' ').slice(0, 16))} bởi ${esc(run?.lockedBy || '')}. Số liệu là bản chụp tại thời điểm chốt.</span></div>` : ''}
      <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Nhân viên', list.length, 'fa-users', 'blue')}${mkpi('Tổng thu nhập', money(tot('gross')), 'fa-sack-dollar', 'green')}${mkpi('Tổng khấu trừ', money(tot('totalDeduct')), 'fa-scissors', 'orange')}${mkpi('Thực lãnh', money(tot('net')), 'fa-money-bill-wave', 'teal')}${mkpi('Cần kiểm tra', warn, 'fa-triangle-exclamation', warn ? 'red' : 'slate')}</div>`;
    const toolbar = `<div class="toolbar"><input class="inp" type="month" data-f="hr-pay.month" value="${esc(month)}">${selectFilter('hr-pay', 'dept', [...new Set(rows.map((r) => r.workDept))].sort().map((d) => [d, d]), 'Tất cả bộ phận')}<input class="inp" data-f="hr-pay.q" value="${esc(f.q || '')}" placeholder="Tìm mã, tên…" style="min-width:160px"></div>`;
    if (f.sub === 'dept') {
      const byDept = {}; list.forEach((r) => { (byDept[r.workDept] = byDept[r.workDept] || []).push(r); });
      const body = Object.entries(byDept).sort((a, b) => a[0].localeCompare(b[0], 'vi')).map(([d, rs]) => `<tr><td><b>${esc(d)}</b></td><td class="right num">${rs.length}</td><td class="right num">${money(sumBy(rs, 'amtCong') + sumBy(rs, 'amtCongDoi'))}</td><td class="right num">${money(sumBy(rs, 'amtOt12') + sumBy(rs, 'amtOt14') + sumBy(rs, 'amtOtCn') + sumBy(rs, 'amtOtLe'))}</td><td class="right num">${money(sumBy(rs, 'gross'))}</td><td class="right num">${money(sumBy(rs, 'totalDeduct'))}</td><td class="right num strong">${money(sumBy(rs, 'net'))}</td><td class="right num">${money(sumBy(rs, 'gross') / rs.length)}</td></tr>`).join('');
      return `${head}<div class="card">${toolbar}${tableShell([{ t: 'Bộ phận' }, { t: 'Số NV', cls: 'right' }, { t: 'Lương công', cls: 'right' }, { t: 'Tăng ca', cls: 'right' }, { t: 'Tổng thu nhập', cls: 'right' }, { t: 'Khấu trừ', cls: 'right' }, { t: 'Thực lãnh', cls: 'right' }, { t: 'Thu nhập BQ / NV', cls: 'right' }], body, { emptyTitle: 'Chưa có dữ liệu' })}</div>`;
    }
    const th = `<tr><th rowspan="2" style="position:sticky;left:0;background:var(--bg,#fff);min-width:190px">Nhân viên</th><th rowspan="2">Đơn giá ngày</th><th colspan="2" class="center">Công</th>${COLS.slice(1).map(([k, l]) => `<th rowspan="2" class="right">${l}</th>`).join('')}<th rowspan="2" class="right">TỔNG THU NHẬP</th>${DEDS.map(([k, l]) => `<th rowspan="2" class="right">${l}</th>`).join('')}<th rowspan="2" class="right">TỔNG TRỪ</th><th rowspan="2" class="right">THỰC LÃNH</th><th rowspan="2"></th></tr><tr><th class="right">Số công</th><th class="right">Thành tiền</th></tr>`;
    const byDept = {}; list.forEach((r) => { (byDept[r.workDept] = byDept[r.workDept] || []).push(r); });
    const rowHtml = (r) => `<tr ${r.warnings.length ? 'style="background:#fffaf0"' : ''}><td style="position:sticky;left:0;background:${r.warnings.length ? '#fffaf0' : 'var(--bg,#fff)'}"><a data-act="hrpay-slip" data-emp="${esc(r.empId)}" style="cursor:pointer"><b>${esc(r.name)}</b></a><div class="cell-sub">${esc(r.empId)} · ${esc(r.groupName ? r.groupName.slice(0, 28) : 'Chưa có nhóm')} ${esc(r.grade)}${r.warnings.length ? ` <i class="fa-solid fa-triangle-exclamation" style="color:var(--orange)" title="${esc(r.warnings.join(' | '))}"></i>` : ''}</div></td>
      <td class="right num">${cellMoney(r.dayRate)}</td><td class="right num">${r.payType === 'LOADER' ? qty(r.tons) + ' tấn' : qty(r.cong)}</td><td class="right num">${cellMoney(r.amtCong)}</td>
      ${COLS.slice(1).map(([k]) => `<td class="right num">${cellMoney(r[k])}</td>`).join('')}<td class="right num strong">${cellMoney(r.gross)}</td>${DEDS.map(([k]) => `<td class="right num">${cellMoney(r[k])}</td>`).join('')}<td class="right num">${cellMoney(r.totalDeduct)}</td><td class="right num strong" style="color:var(--green,#16a34a)">${cellMoney(r.net)}</td>
      <td class="right">${V.canHr() && !locked ? `<button class="btn btn-sm" data-act="hrpay-adj" data-emp="${esc(r.empId)}" title="Điều chỉnh tháng"><i class="fa-solid fa-sliders"></i></button>` : ''}</td></tr>`;
    const subtotal = (label, rs) => `<tr style="background:var(--bg-soft,#eef2f7);font-weight:600"><td style="position:sticky;left:0;background:var(--bg-soft,#eef2f7)">${esc(label)} (${rs.length})</td><td></td><td></td><td class="right num">${cellMoney(sumBy(rs, 'amtCong'))}</td>${COLS.slice(1).map(([k]) => `<td class="right num">${cellMoney(sumBy(rs, k))}</td>`).join('')}<td class="right num">${cellMoney(sumBy(rs, 'gross'))}</td>${DEDS.map(([k]) => `<td class="right num">${cellMoney(sumBy(rs, k))}</td>`).join('')}<td class="right num">${cellMoney(sumBy(rs, 'totalDeduct'))}</td><td class="right num">${cellMoney(sumBy(rs, 'net'))}</td><td></td></tr>`;
    const body = Object.entries(byDept).sort((a, b) => a[0].localeCompare(b[0], 'vi')).map(([d, rs]) => rs.map(rowHtml).join('') + subtotal('Cộng ' + d, rs)).join('') + (list.length ? subtotal('TỔNG CỘNG', list) : '');
    return `${head}<div class="card">${toolbar}<div class="tbl-wrap" style="overflow:auto;margin-top:8px;max-height:70vh"><table class="line-tbl" style="font-size:12px;white-space:nowrap"><thead>${th}</thead><tbody>${body || '<tr><td colspan="40" class="cell-sub">Chưa có nhân viên nào có hồ sơ lương hoặc dữ liệu chấm công trong tháng. Vào Hồ sơ lương để gắn nhóm thang lương.</td></tr>'}</tbody></table></div>
      <div class="cell-sub" style="margin-top:8px">Dòng nền vàng: có cảnh báo (rê chuột vào dấu ⚠). Bấm tên để xem phiếu lương; nút ⚙ để nhập điều chỉnh tháng (hiếu hỉ, KPI cửa hàng, trừ KPI, truy thu bảo hiểm…). Công đủ ${cfg.standardDays} ngày/tháng; khấu trừ bảo hiểm trên mức lương đóng BH, thuế TNCN theo biểu lũy tiến.</div></div>`;
  };

  /* ---- điều chỉnh tháng */
  function openAdj(empId) {
    const { month } = pageData(); if (isLocked(month)) { Toast.warn('Bảng lương đã chốt', 'Mở lại trước khi điều chỉnh.'); return; }
    const e = V.employees().find((x) => x.id === empId); if (!e) return; const a = runOf(month)?.adj?.[empId] || {};
    Modal.open({ title: `Điều chỉnh tháng · ${esc(e.name)}`, sub: `${esc(empId)} · tháng ${month.slice(5)}/${month.slice(0, 4)}`, size: 'md',
      body: `<div class="form-grid cols-2"><div class="field"><label>Trợ cấp hiếu hỉ / đám tang (số ngày)</label><input class="inp right num" id="adjHH" type="number" min="0" step="0.5" value="${a.hieuHiDays ?? ''}"></div>
        <div class="field"><label>KPI cửa hàng (đ)</label><input class="inp right num" id="adjKS" type="number" min="0" value="${a.kpiStore ?? ''}"></div>
        <div class="field"><label>Thưởng khác (đ)</label><input class="inp right num" id="adjOB" type="number" min="0" value="${a.otherBonus ?? ''}"></div>
        <div class="field"><label>Trừ KPI (đ)</label><input class="inp right num" id="adjKD" type="number" min="0" value="${a.kpiDeduct ?? ''}"></div>
        <div class="field"><label>Truy thu bảo hiểm (đ)</label><input class="inp right num" id="adjTT" type="number" min="0" value="${a.truyThuBH ?? ''}"></div>
        <div class="field"><label>Khoản trừ khác (đ)</label><input class="inp right num" id="adjOD" type="number" min="0" value="${a.otherDeduct ?? ''}"></div>
        <div class="field"><label>Không rớt đơn (KPI tài xế / giao hàng)</label><select class="inp" id="adjND"><option value="AUTO" ${(a.noDropOrders ?? 'AUTO') === 'AUTO' ? 'selected' : ''}>Tự động theo thống kê</option><option value="YES" ${a.noDropOrders === 'YES' ? 'selected' : ''}>Có</option><option value="NO" ${a.noDropOrders === 'NO' ? 'selected' : ''}>Không</option></select></div>
        <div class="field"><label>Ghi chú</label><input class="inp" id="adjNote" value="${esc(a.note || '')}"></div></div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="hrpay-adj-save" data-emp="${esc(empId)}"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>` });
  }
  async function saveAdj(empId) {
    const { month } = pageData(); if (isLocked(month)) return; const val = (id) => { const v = $(id)?.value; return v === '' || v == null ? undefined : Number(v); };
    const adj = { hieuHiDays: val('#adjHH'), kpiStore: val('#adjKS'), otherBonus: val('#adjOB'), kpiDeduct: val('#adjKD'), truyThuBH: val('#adjTT'), otherDeduct: val('#adjOD'), noDropOrders: $('#adjND').value, note: ($('#adjNote').value || '').trim() };
    Object.keys(adj).forEach((k) => adj[k] === undefined && delete adj[k]);
    const run = JSON.parse(JSON.stringify(runOf(month) || { id: month, month, status: 'DRAFT', adj: {} })); run.adj = run.adj || {}; run.adj[empId] = adj; run.updatedAt = new Date().toISOString();
    try { await store.save('runs', run); } catch (err) { Toast.err('Không lưu được', err?.message || ''); return; }
    Modal.close(); render(); Toast.ok('Đã lưu điều chỉnh', empId);
  }
  async function lockPayroll() {
    const { month, rows } = pageData(); if (!V.canHr()) { Toast.err('Không có quyền', 'Chỉ bộ phận nhân sự được chốt bảng lương.'); return; }
    const warn = rows.filter((r) => r.warnings.length).length;
    if (warn && !confirm(`Còn ${warn} nhân viên có cảnh báo (thiếu dữ liệu, điểm chấm công cần kiểm…). Vẫn chốt bảng lương tháng ${month}?`)) return;
    const old = runOf(month) || { id: month, month, adj: {} };
    const run = { ...JSON.parse(JSON.stringify(old)), status: 'LOCKED', rows: JSON.parse(JSON.stringify(rows)), cfg: JSON.parse(JSON.stringify(V.cfg(), (k, v) => (v === Infinity ? '__INF__' : v))), lockedAt: new Date().toISOString(), lockedBy: V.who(), totals: { gross: sumBy(rows, 'gross'), deduct: sumBy(rows, 'totalDeduct'), net: sumBy(rows, 'net'), count: rows.length } };
    try { await store.save('runs', run); } catch (err) { Toast.err('Không chốt được', err?.message || ''); return; }
    render(); Toast.ok('Đã chốt bảng lương', `${month} · ${rows.length} nhân viên · thực lãnh ${money(run.totals.net)}`);
  }
  async function unlockPayroll() {
    const { month } = pageData(); const run = runOf(month); if (!run || !V.canHr()) return; if (!confirm('Mở lại bảng lương đã chốt? Số liệu sẽ tính lại theo dữ liệu hiện tại.')) return;
    const next = { ...JSON.parse(JSON.stringify(run)), status: 'DRAFT', reopenedAt: new Date().toISOString(), reopenedBy: V.who() }; delete next.rows; delete next.cfg;
    try { await store.save('runs', next); } catch (err) { Toast.err('Không mở lại được', err?.message || ''); return; } render(); Toast.ok('Đã mở lại bảng lương', month);
  }

  /* ---- phiếu lương */
  function slipHtml(r, month) {
    const co = DB.company || {}; const line = (l, v, sub) => (n(v) ? `<tr><td>${esc(l)}${sub ? `<div style="font-size:11px;color:#555">${esc(sub)}</div>` : ''}</td><td style="text-align:right">${r0(v).toLocaleString('vi-VN')}</td></tr>` : '');
    const inc = [
      line('Lương công', r.amtCong, r.payType === 'LOADER' ? `${qty(r.tons)} tấn` : `${qty(r.cong)} công × ${cellMoney(r.dayRate)}`), line('Công dôi', r.amtCongDoi, `${qty(r.congDoi)} công`), line('Trợ cấp hiếu hỉ', r.amtHieuHi, `${qty(r.hieuHiDays)} ngày`), line('Về giữa ca / công lẻ', r.amtVgc, `${qty(r.vgc)} công`),
      line('Tăng ca 1.2', r.amtOt12, `${qty(r.ot12)} giờ`), line('Tăng ca 1.4', r.amtOt14, `${qty(r.ot14)} giờ`), line('Tăng ca Chủ nhật', r.amtOtCn, `${qty(r.otCn)} giờ`), line('Tăng ca ngày lễ', r.amtOtLe, `${qty(r.otLe)} giờ`), line('Phép năm', r.amtPhepNam, `${qty(r.phepNam)} ngày`),
      line('Phụ cấp trách nhiệm', r.amtResp), line('Thưởng hoàn thành', r.amtCompletion), line('Hỗ trợ nhà ở', r.amtHousing), line('Tiền xăng', r.amtFuel), line('Điện thoại', r.amtPhone), line('Phụ cấp thâm niên', r.amtSeniority, `${r.seniorityYears} năm`), line('Tiền cơm', r.amtMeal), line('Bồi dưỡng đêm', r.amtNight, `${qty(r.nightUnits)} đơn vị`),
      line('Chuyên cần', r.amtAttendance), line('Phụ cấp bằng cấp', r.amtDegree), line('Thưởng KPI tài xế / giao hàng', r.amtKpiDriver), line('KPI cửa hàng', r.amtKpiStore), line('Thưởng khác', r.amtOtherBonus)].join('');
    const ded = [line('BHXH (8%)', r.bhxh), line('BHYT (1,5%)', r.bhyt), line('BHTN (1%)', r.bhtn), line('Công đoàn', r.union), line('Thuế TNCN', r.tax, r.taxableIncome ? `Thu nhập tính thuế ${r0(r.taxableIncome).toLocaleString('vi-VN')}` : ''), line('Trừ KPI', r.kpiDeduct), line('Truy thu bảo hiểm', r.truyThuBH), line('Khoản trừ khác', r.otherDeduct)].join('');
    return `<div style="font-family:Arial,sans-serif;font-size:13px;width:180mm;margin:0 auto;page-break-after:always"><div style="text-align:center"><b>${esc(co.name || '')}</b><div style="font-size:11px">${esc(co.address || '')}</div><h2 style="margin:8px 0 2px">PHIẾU LƯƠNG THÁNG ${month.slice(5)}/${month.slice(0, 4)}</h2></div>
      <table style="width:100%;margin:8px 0"><tr><td>Họ tên: <b>${esc(r.name)}</b></td><td>Mã NV: ${esc(r.empId)}</td></tr><tr><td>Bộ phận: ${esc(r.workDept)}</td><td>Nhóm lương: ${esc(r.groupName)} · bậc ${esc(r.grade)}</td></tr></table>
      <table style="width:100%;border-collapse:collapse" border="1" cellpadding="4"><thead><tr style="background:#eee"><th style="text-align:left">Khoản thu nhập</th><th style="width:130px">Số tiền (đ)</th></tr></thead><tbody>${inc}<tr style="background:#f6f6f6"><td><b>TỔNG THU NHẬP</b></td><td style="text-align:right"><b>${r0(r.gross).toLocaleString('vi-VN')}</b></td></tr></tbody>
      <thead><tr style="background:#eee"><th style="text-align:left">Khoản khấu trừ</th><th>Số tiền (đ)</th></tr></thead><tbody>${ded}<tr style="background:#f6f6f6"><td><b>TỔNG KHẤU TRỪ</b></td><td style="text-align:right"><b>${r0(r.totalDeduct).toLocaleString('vi-VN')}</b></td></tr><tr style="background:#e8f5e9"><td><b>THỰC LÃNH</b></td><td style="text-align:right"><b>${r0(r.net).toLocaleString('vi-VN')}</b></td></tr></tbody></table>
      <div style="margin-top:6px;font-size:11px">Số tiền bằng chữ: <i>${esc(window.AccInvoice?.vndWords ? window.AccInvoice.vndWords(r.net) : '')}</i></div><div style="display:flex;justify-content:space-between;margin-top:26px;text-align:center"><div style="width:45%"><b>Người lập</b></div><div style="width:45%"><b>Người nhận</b></div></div></div>`;
  }
  function printHtml(title, body) { const w = window.open('', '_blank'); if (!w) { Toast.err('Trình duyệt chặn cửa sổ in', 'Cho phép pop-up cho trang này.'); return; } w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4;margin:10mm}body{margin:0;padding:6mm}</style></head><body>${body}</body></html>`); w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (_) {} }, 350); }
  function openSlip(empId) {
    const { month, rows } = pageData(); const r = rows.find((x) => x.empId === empId); if (!r) return;
    Modal.open({ title: `Phiếu lương · ${esc(r.name)}`, sub: `${month.slice(5)}/${month.slice(0, 4)} · thực lãnh ${money(r.net)}`, size: 'lg', body: `${r.warnings.length ? `<div class="alert warning" style="margin-bottom:10px"><i class="fa-solid fa-triangle-exclamation"></i><span>${r.warnings.map(esc).join('<br>')}</span></div>` : ''}${slipHtml(r, month).replace('page-break-after:always', '')}`, foot: `<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="hrpay-slip-print" data-emp="${esc(empId)}"><i class="fa-solid fa-print"></i>In / Lưu PDF</button>` });
  }
  function csv() {
    const { month, list } = pageData();
    const head = ['Mã NV', 'Họ tên', 'Bộ phận', 'Nhóm lương', 'Bậc', 'Đơn giá ngày', 'Số công', ...COLS.map(([, l]) => l), 'TỔNG THU NHẬP', ...DEDS.map(([, l]) => l), 'TỔNG TRỪ', 'THỰC LÃNH', 'Cảnh báo'];
    Exporter.csv(`Bang-luong-${month}.csv`, head, list.map((r) => [r.empId, r.name, r.workDept, r.groupName, r.grade, r.dayRate, r.cong, ...COLS.map(([k]) => r[k] || 0), r.gross, ...DEDS.map(([k]) => r[k] || 0), r.totalDeduct, r.net, r.warnings.join(' | ')]));
  }
  Object.assign(Actions, {
    'hrpay-sub': (d) => { F('hr-pay').sub = d.sub; render(); }, 'hrpay-adj': (d) => openAdj(d.emp), 'hrpay-adj-save': (d) => saveAdj(d.emp),
    'hrpay-lock': () => lockPayroll(), 'hrpay-unlock': () => unlockPayroll(), 'hrpay-csv': () => csv(), 'hrpay-slip': (d) => openSlip(d.emp),
    'hrpay-slip-print': (d) => { const { month, rows } = pageData(); const r = rows.find((x) => x.empId === d.emp); if (r) printHtml(`Phieu-luong-${r.empId}-${month}`, slipHtml(r, month)); },
    'hrpay-slips': () => { const { month, list } = pageData(); if (!list.length) { Toast.info('Không có phiếu lương', ''); return; } printHtml(`Phieu-luong-${month}`, list.map((r) => slipHtml(r, month)).join('')); },
  });
})();

/* ============================================================================
 * HIỆU QUẢ LAO ĐỘNG — thời gian làm việc và hiệu quả sản xuất từng nhân viên
 * ========================================================================== */
(function () {
  'use strict';
  const H = window.HRPay, V = window.HRV2, T = window.HRTimesheet, S = window.HRStats; const { n, r2 } = H;
  const curMonth = () => V.todayYmd().slice(0, 7);
  window.hrEfficiencyView = function () {
    Promise.all([V.store.ensure('timesheets'), V.store.ensure('stats'), V.store.ensure('config')]).then(() => { if (State.module === 'hr' && State.tab === 'efficiency' && !window.__hrEffLoaded) { window.__hrEffLoaded = true; render(); } });
    const f = F('hr-eff', { month: curMonth(), dept: '', q: '' }); const month = f.month || curMonth(); const cfg = V.cfg(); const stats = S.statsRows(month);
    const rows = T.monthEmployees(month).filter((e) => V.isActive(e) && (!f.dept || e.payProfile?.workDept === f.dept) && (!f.q || [e.id, e.name].some((v) => String(v || '').toLowerCase().includes(String(f.q).toLowerCase())))).map((e) => {
      const s = T.summaryOf(e, cfg, month); const prod = typeof hrEmpProduction === 'function' ? hrEmpProduction(e) : { done: 0, plan: 0, stages: [] };
      const stageHours = prod.stages.reduce((a, x) => a + n(x.s.hours), 0); const mine = stats.filter((x) => x.empId === e.id);
      const orders = mine.reduce((a, x) => a + n(x.orders), 0), tons = mine.reduce((a, x) => a + n(x.tons), 0), days = new Set(mine.map((x) => x.date)).size;
      const hours = s.workedHours; const ot = s.ot12 + s.ot14 + s.otCn + s.otLe;
      return { e, s, hours, ot, orders, tons, days, done: n(prod.done), plan: n(prod.plan), stageHours, perHour: hours > 0 && prod.done ? prod.done / hours : 0, tonsPerHour: hours > 0 && tons ? tons / hours : 0, ordersPerDay: days ? orders / days : 0, attend: s.scheduledDays ? Math.min(100, (s.cong + s.leave) / s.scheduledDays * 100) : 0 };
    }).sort((a, b) => b.hours - a.hours);
    const body = rows.map((r) => `<tr><td><span class="code">${esc(r.e.id)}</span> ${esc(r.e.name)}<div class="cell-sub">${esc(r.e.payProfile?.workDept || r.e.dept || '')}</div></td><td class="right num">${r.s.cong}</td><td class="right num">${r.hours || ''}</td><td class="right num">${r.ot || ''}</td><td class="right num">${r.s.lateDays || ''}</td><td class="right num">${r.s.earlyDays || ''}</td><td class="right num">${r.attend ? r2(r.attend) + '%' : ''}</td>
      <td class="right num">${r.done ? `${r.done}/${r.plan}` : ''}</td><td class="right num">${r.stageHours ? r2(r.stageHours) : ''}</td><td class="right num">${r.perHour ? r2(r.perHour) : ''}</td><td class="right num">${r.orders ? `${r.orders} (${r2(r.ordersPerDay)}/ngày)` : ''}</td><td class="right num">${r.tons ? `${r2(r.tons)}${r.tonsPerHour ? ` (${r2(r.tonsPerHour)} tấn/giờ)` : ''}` : ''}</td></tr>`);
    const tot = rows.reduce((a, r) => ({ h: a.h + r.hours, ot: a.ot + r.ot, c: a.c + r.s.cong }), { h: 0, ot: 0, c: 0 });
    return `${pageHead('Hiệu quả lao động', 'Thời gian làm việc thực tế từ máy chấm công và kết quả sản xuất / giao hàng / bốc xếp của từng nhân viên')}
      <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Nhân viên', rows.length, 'fa-users', 'blue')}${mkpi('Tổng công', r2(tot.c), 'fa-calendar-check', 'green')}${mkpi('Giờ làm thực tế', r2(tot.h), 'fa-clock', 'teal')}${mkpi('Giờ tăng ca', r2(tot.ot), 'fa-business-time', 'orange')}</div>
      <div class="card"><div class="toolbar"><input class="inp" type="month" data-f="hr-eff.month" value="${esc(month)}">${selectFilter('hr-eff', 'dept', cfg.depts.map((d) => [d, d]), 'Tất cả bộ phận')}<input class="inp" data-f="hr-eff.q" value="${esc(f.q || '')}" placeholder="Tìm mã, tên…"></div>
      ${tableShell([{ t: 'Nhân viên' }, { t: 'Công', cls: 'right' }, { t: 'Giờ làm', cls: 'right' }, { t: 'Tăng ca (h)', cls: 'right' }, { t: 'Ngày trễ', cls: 'right' }, { t: 'Ngày về sớm', cls: 'right' }, { t: 'Chuyên cần', cls: 'right' }, { t: 'SL LSX (đạt/KH)', cls: 'right' }, { t: 'Giờ máy LSX', cls: 'right' }, { t: 'SL / giờ làm', cls: 'right' }, { t: 'Đơn giao', cls: 'right' }, { t: 'Bốc xếp (tấn)', cls: 'right' }], body, { emptyTitle: 'Chưa có dữ liệu chấm công trong tháng' })}
      <div class="cell-sub" style="margin-top:8px">Giờ làm lấy từ giờ vào/ra thực tế (đã trừ nghỉ giữa ca). Sản lượng lấy từ các công đoạn lệnh sản xuất do nhân viên phụ trách (tổ trưởng). Số liệu giao hàng, bốc xếp lấy từ Thống kê chuyến/tấn.</div></div>`;
  };
})();

/* ============================================================================
 * NỐI VÀO MENU & ROUTER NHÂN SỰ
 * ========================================================================== */
(function () {
  'use strict';
  const _hrView = Views.hr;
  Views.hr = function () {
    const tab = State.tab || (State.params && State.params.tab);
    const m = { timesheet: 'hrTimesheetView', daystats: 'hrDayStatsView', payroll: 'hrPayrollView', pay_config: 'hrPayConfigView', pay_profiles: 'hrPayProfilesView', efficiency: 'hrEfficiencyView' };
    if (m[tab] && typeof window[m[tab]] === 'function') return window[m[tab]]();
    return _hrView ? _hrView.apply(this, arguments) : '';
  };
  Views.hr.after = _hrView?.after;
  if (typeof Views.payroll === 'function') { const _p = Views.payroll; Views.payroll = function () { return window.hrPayrollView(); }; Views.payroll.after = _p.after; }
})();
