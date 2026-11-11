/* ============================================================================
 * MODULE: NHÂN SỰ — CHẤM CÔNG — NGƯỜI DÙNG & PHÂN QUYỀN — CÀI ĐẶT
 * ==========================================================================*/

/* ------------------------------------------------------------ NHÂN SỰ */
Views.hr = function () {
  const tab = State.tab || (State.params && State.params.tab);
  if (
    tab === 'attendance'
  ) {
    return Views.attendance
      ? Views.attendance(State.params)
      : '';
  }

  if (
    tab === 'shifts'
  ) {
    return Views.hrShifts
      ? Views.hrShifts(State.params)
      : '';
  }

  if (
    tab === 'kpi'
  ) {
    return Views.hrKPI
      ? Views.hrKPI(State.params)
      : '';
  }

  if (
    tab === 'evaluations'
  ) {
    return Views.hrevaluations
      ? Views.hrevaluations(State.params)
      : '';
  }

  if (
    tab === 'payroll'
  ) {
    return Views.payroll
      ? Views.payroll(State.params)
      : '';
  }

  if (
    tab &&
    ![
      'dashboard',
      'profile'
    ].includes(tab)
  ) {
    return '';
  }

  const f = F('hr', { q: '', dept: '', status: '', position: '', contractType: '', active: '' });
  const q = (f.q || '').toLowerCase().trim();
  const list = DB.employees.filter((e) => {
    if (f.dept && e.dept !== f.dept) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.position && e.position !== f.position) return false;
    if (f.contractType && e.contractType !== f.contractType) return false;
    if (f.active === '1' && !e.active) return false;
    if (f.active === '0' && e.active) return false;
    if (q && ![e.id, e.name, e.dept, e.position, e.phone].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  });
  const pg = paged(list, 'hr');
  const positions = [...new Set(DB.employees.map((e) => e.position))].sort().map((p) => [p, p]);
  const cnt = (s) => DB.employees.filter((e) => e.status === s).length;
  const working = cnt('ns_dang_lam') + cnt('ns_thu_viec');
  const lockedCount = DB.employees.filter((e) => !e.active).length;

  const rows = pg.items.map((e) => `
    <tr class="clickable" data-act="open-employee" data-id="${e.id}">
      <td><span class="code">${e.id}</span></td>
      <td><div style="display:flex;align-items:center;gap:9px">${avatarHTML(e.name)}<span style="min-width:0">${cell2(esc(e.name), esc(e.gender + ' · ' + e.email))}</span></div></td>
      <td class="hide-sm"><span class="chip">${esc(e.dept)}</span></td>
      <td>${esc(e.position)}</td>
      <td class="hide-sm"><span class="chip">${esc(e.contractType || '—')}</span></td>
      <td class="num">${esc(e.phone)}</td>
      <td class="num hide-sm">${fmtDate(e.joinDate)}</td>
      <td>${!e.active ? '<span class="badge red">Ngừng sử dụng</span>' : badge(e.status)}</td>
      <td>${rowActions([
        { act: 'employee-edit', data: `data-id="${e.id}"`, icon: 'fa-user-pen', title: 'Sửa hồ sơ' },
        { act: 'employee-toggle-active', data: `data-id="${e.id}"`, icon: e.active ? 'fa-lock' : 'fa-lock-open', title: e.active ? 'Khóa / ngừng sử dụng' : 'Mở khóa' },
      ])}</td>
    </tr>`);

  /* --- Báo cáo quản trị nhân sự (gộp từ tab "Báo cáo nhân sự" cũ) --- */
  const rptEmps = hrEmployees();
  const rptByDept = (DB.departments || []).map((dept) => {
    const es = rptEmps.filter((e) => e.dept === dept);
    const payroll = es.reduce((n, e) => n + hrPayrollRow(e, 'time').total, 0);
    const prod = es.reduce((n, e) => n + hrEmpProduction(e).done, 0);
    return { dept, count: es.length, payroll, prod };
  }).filter((x) => x.count);
  const rptTotalPayroll = rptByDept.reduce((n, x) => n + x.payroll, 0);
  const rptTotalProd = rptByDept.reduce((n, x) => n + x.prod, 0);
  const rptDeptRows = rptByDept.map((x) => `
    <tr>
      <td><span class="chip">${esc(x.dept)}</span></td>
      <td class="num">${fmtN(x.count)}</td>
      <td class="num">${fmtVND(x.payroll)}</td>
      <td class="num">${fmtN(x.prod)}</td>
      <td class="num">${x.count ? fmtVND(x.payroll / x.count) : '—'}</td>
    </tr>`);

  const rptProductMap = {};
  hrProduction().forEach((po) => {
    const name = po.productName || po.product || 'Không xác định';
    const labor = (po.stages || []).reduce((n, st) => {
      const e = rptEmps.find((x) => x.id === st.leadId);
      if (!e) return n;
      const ratio = hrNum(st.qtyDone) / Math.max(1, hrNum(st.qtyPlan));
      return n + hrPayrollRow(e, 'time').total * ratio;
    }, 0);
    rptProductMap[name] = (rptProductMap[name] || 0) + labor;
  });
  const rptProductRows = Object.entries(rptProductMap).map(([name, cost]) => `
    <tr>
      <td>${esc(name)}</td>
      <td class="num">${fmtVND(cost)}</td>
      <td class="num">${rptTotalPayroll ? (cost / Math.max(1, rptTotalPayroll) * 100).toFixed(1) + '%' : '—'}</td>
    </tr>`);

  return `
  ${pageHead('Quản lý nhân sự', `${DB.employees.length} nhân sự thuộc ${DB.departments.length} phòng ban`, `
    <button class="btn" data-act="employee-import"><i class="fa-solid fa-file-import"></i>Import</button>
    <button class="btn" data-act="export-hr"><i class="fa-solid fa-file-export"></i>Export</button>
    <button class="btn btn-primary" data-act="new-employee"><i class="fa-solid fa-user-plus"></i>Thêm nhân sự</button>
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng nhân sự', DB.employees.length, 'fa-users', 'blue')}
    ${mkpi('Đang làm việc', working, 'fa-user-check', 'green')}
    ${mkpi('Nghỉ phép', cnt('ns_nghi_phep'), 'fa-umbrella-beach', 'orange')}
    ${mkpi('Nghỉ việc', cnt('ns_nghi_viec'), 'fa-user-slash', 'red')}
    ${mkpi('Ngừng sử dụng', lockedCount, 'fa-lock', 'slate')}
    ${mkpi('Quỹ lương tháng', fmtShort(DB.employees.filter((e) => e.status !== 'ns_nghi_viec').reduce((s, e) => s + e.salary, 0)), 'fa-money-check-dollar', 'indigo')}
  </div>

  <div class="grid g-2" style="margin-bottom:14px">
    <div class="card">
      <div class="card-head"><div><h3>Cơ cấu nhân sự theo phòng ban</h3><p>Số lượng nhân sự đang làm việc</p></div></div>
      <div class="card-body"><div class="chart-box sm"><canvas id="chHrDept"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Phân bổ theo trạng thái</h3><p>Tình trạng làm việc toàn công ty</p></div></div>
      <div class="card-body">
        <div class="chart-box sm"><canvas id="chHrStatus"></canvas></div>
        <div class="legend">
          ${['ns_dang_lam', 'ns_thu_viec', 'ns_nghi_phep', 'ns_nghi_viec'].map((s) => `
            <span class="legend-item"><span class="legend-dot" style="background:var(--${statusTone(s)})"></span>${esc(statusLabel(s))} · <b>${cnt(s)}</b></span>`).join('')}
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="toolbar">
      ${searchBox('hr', 'Tìm mã NV, họ tên, số điện thoại…')}
      ${selectFilter('hr', 'dept', DB.departments.map((d) => [d, d]), 'Tất cả phòng ban')}
      ${selectFilter('hr', 'position', positions, 'Tất cả chức vụ')}
      ${selectFilter('hr', 'status', statusOptions('ns_'), 'Tất cả trạng thái')}
      ${selectFilter('hr', 'contractType', DB.contractTypes.map((c) => [c, c]), 'Tất cả loại hợp đồng')}
      ${selectFilter('hr', 'active', [['1', 'Đang sử dụng'], ['0', 'Ngừng sử dụng']], 'Tất cả tình trạng sử dụng')}
      ${(f.q || f.dept || f.status || f.position || f.contractType || f.active) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="hr"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} nhân sự</span>
    </div>
    ${tableShell(
      [{ t: 'Mã NV', w: '92px' }, { t: 'Họ tên' }, { t: 'Phòng ban', cls: 'hide-sm' }, { t: 'Chức vụ' },
       { t: 'Loại HĐ', cls: 'hide-sm' }, { t: 'Số điện thoại' }, { t: 'Ngày vào làm', cls: 'hide-sm' },
       { t: 'Trạng thái', w: '130px' }, { t: 'Thao tác', cls: 'right', w: '84px' }],
      rows, { emptyTitle: 'Không tìm thấy nhân sự' })}
    ${pagiHTML('hr', pg, 'nhân sự')}
  </div>

  <div class="form-sec-title" style="margin-top:18px"><i class="fa-solid fa-chart-column"></i>Báo cáo quản trị nhân sự</div>

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng chi phí nhân công', fmtVND(rptTotalPayroll), 'fa-money-bill-trend-up', 'indigo')}
    ${mkpi('Sản lượng thực hiện', fmtN(rptTotalProd), 'fa-industry', 'green')}
    ${mkpi('Phòng ban', rptByDept.length, 'fa-building', 'blue')}
    ${mkpi('Chi phí/NV bình quân', fmtVND(rptEmps.length ? rptTotalPayroll / rptEmps.length : 0), 'fa-user-tag', 'orange')}
  </div>

  <div class="grid g-2">
    <div class="card">
      <div class="card-head"><div><h3>Chi phí nhân công theo phòng ban</h3><p>So sánh quy mô nhân sự, chi phí và chi phí bình quân</p></div></div>
      ${tableShell(
        [{ t: 'Phòng ban' }, { t: 'Nhân sự', cls: 'right' }, { t: 'Chi phí nhân công', cls: 'right' }, { t: 'Sản lượng', cls: 'right' }, { t: 'CP/NV', cls: 'right' }],
        rptDeptRows,
        { emptyTitle: 'Chưa có dữ liệu' }
      )}
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Chi phí nhân công theo sản phẩm</h3><p>Phân bổ chi phí nhân công từ các công đoạn sản xuất</p></div></div>
      ${tableShell(
        [{ t: 'Sản phẩm' }, { t: 'Chi phí nhân công', cls: 'right' }, { t: 'Tỷ trọng', cls: 'right' }],
        rptProductRows,
        { emptyTitle: 'Chưa có dữ liệu sản xuất' }
      )}
    </div>
  </div>`;
};

Views.hr.after = function () {
  const depts = DB.departments.filter((d) => DB.employees.some((e) => e.dept === d));
  Charts.bar('chHrDept', depts, [{ label: 'Nhân sự', data: depts.map((d) => DB.employees.filter((e) => e.dept === d && e.status !== 'ns_nghi_viec').length), color: 'blue' }], { horizontal: true });
  const sts = ['ns_dang_lam', 'ns_thu_viec', 'ns_nghi_phep', 'ns_nghi_viec'];
  Charts.donut('chHrStatus', sts.map(statusLabel), sts.map((s) => DB.employees.filter((e) => e.status === s).length), sts.map(statusTone));
};

function openEmployeeModal(id) {
  const e = Q.employee(id);
  if (!e) return;
  const att = DB.attendance.find((a) => a.empId === id);
  const user = DB.users.find((u) => u.empId === id);
  const stages = DB.productionOrders.flatMap((p) => p.stages.filter((s) => s.leadId === id).map((s) => ({ po: p, s })));

  Modal.open({
    title: `<div style="display:flex;align-items:center;gap:11px">${avatarHTML(e.name, 'lg')}<span>${esc(e.name)}<div style="font-size:12.5px;font-weight:500;color:var(--text-3);margin-top:2px">${e.id} · ${esc(e.position)}</div></span></div>`,
    size: 'md',
    body: `
      ${!e.active ? `<div class="alert" style="background:var(--red-soft);color:var(--red);border-radius:var(--r);padding:10px 12px;margin-bottom:14px;font-size:12.8px;display:flex;align-items:center;gap:8px"><i class="fa-solid fa-lock"></i><span>Hồ sơ này đang <b>bị khóa / ngừng sử dụng</b>.</span></div>` : ''}
      <div class="info-grid" style="margin-bottom:18px">
        ${infoItem('Phòng ban', esc(e.dept))}
        ${infoItem('Chức vụ', esc(e.position))}
        ${infoItem('Giới tính', esc(e.gender))}
        ${infoItem('Số điện thoại', esc(e.phone))}
        ${infoItem('Email', esc(e.email))}
        ${infoItem('Ngày vào làm', fmtDate(e.joinDate))}
        ${infoItem('Thâm niên', Math.max(0, Math.floor((new Date(DB.today) - new Date(e.joinDate)) / 31536000000)) + ' năm')}
        ${infoItem('Loại hợp đồng', esc(e.contractType || '—'))}
        ${infoItem('Trạng thái làm việc', badge(e.status))}
        ${infoItem('Tình trạng sử dụng', e.active ? '<span class="badge green">Đang sử dụng</span>' : '<span class="badge red">Ngừng sử dụng</span>')}
        ${infoItem('Mức lương', fmtVND(e.salary) + '/tháng')}
        ${infoItem('Tài khoản hệ thống', user ? `<span class="code">${esc(user.username)}</span> — ${esc((DB.roles.find((r) => r.id === user.roleId) || {}).name || '')}` : '<span class="muted">Chưa cấp tài khoản</span>')}
      </div>
      ${att ? `
      <div class="form-sec-title"><i class="fa-solid fa-calendar-check"></i>Bảng công tháng 08/2026</div>
      <div class="stat-strip" style="margin-bottom:16px">
        <div><div class="l">Công chuẩn</div><div class="v">${att.standard}</div></div>
        <div><div class="l">Đi làm</div><div class="v" style="color:var(--green)">${att.worked}</div></div>
        <div><div class="l">Nghỉ phép</div><div class="v" style="color:var(--orange)">${att.leave}</div></div>
        <div><div class="l">Đi muộn</div><div class="v">${att.late}</div></div>
        <div><div class="l">Tăng ca (giờ)</div><div class="v" style="color:var(--indigo)">${att.ot}</div></div>
      </div>` : ''}
      ${stages.length ? `
      <div class="form-sec-title"><i class="fa-solid fa-industry"></i>Công đoạn đang phụ trách</div>
      ${tableShell(
        [{ t: 'Lệnh SX' }, { t: 'Sản phẩm' }, { t: 'Công đoạn' }, { t: 'Sản lượng', cls: 'right' }, { t: 'Trạng thái' }],
        stages.slice(0, 8).map(({ po, s }) => `<tr class="clickable" data-act="open-po" data-id="${po.id}">
          <td><span class="code">${po.id}</span></td>
          <td>${esc(po.productName)}</td>
          <td class="strong">${esc(s.name)}</td>
          <td class="right num">${fmtN(s.qtyDone)}/${fmtN(s.qtyPlan)}</td>
          <td>${s.status === 'done' ? '<span class="badge green">Xong</span>' : s.status === 'doing' ? '<span class="badge blue">Đang làm</span>' : '<span class="badge slate">Chờ</span>'}</td></tr>`))}` : ''}`,
    foot: `<button class="btn" data-act="modal-close">Đóng</button>
           <button class="btn" data-act="go" data-id="attendance"><i class="fa-solid fa-calendar-check"></i>Xem chấm công</button>
           <button class="btn ${e.active ? '' : 'btn-success'}" data-act="employee-toggle-active" data-id="${e.id}"><i class="fa-solid ${e.active ? 'fa-lock' : 'fa-lock-open'}"></i>${e.active ? 'Khóa / ngừng sử dụng' : 'Mở khóa'}</button>
           <button class="btn btn-primary" data-act="employee-edit" data-id="${e.id}"><i class="fa-solid fa-user-pen"></i>Sửa hồ sơ</button>`,
  });
}

/* --------------------------------------- TÀI KHOẢN ĐĂNG NHẬP KÈM HỒ SƠ NV
 * Khi thêm nhân sự mới, form cho phép tick "Tạo tài khoản đăng nhập" và tự
 * gợi ý tên đăng nhập (theo đúng quy ước đang dùng trong hệ thống: tên +
 * "." + chữ cái đầu họ/đệm, ví dụ "Nguyễn Đức Anh" -> "anh.nd") cùng vai trò
 * phân quyền mặc định theo phòng ban. Người dùng vẫn có thể sửa lại trước
 * khi lưu. */
const HR_DEPT_DEFAULT_ROLE = {
  'Ban giám đốc': 'R02',
  'Kinh doanh': 'R04',
  'Sản xuất': 'R05',
  'Kho vận': 'R06',
  'Mua hàng': 'R07',
  'Kế toán': 'R08',
};

/** Chuyển chữ có dấu tiếng Việt sang không dấu, chữ thường, dùng để sinh username */
function hrStripDiacritics(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

/** Sinh gợi ý tên đăng nhập kiểu "ten.hodem" và tự thêm số nếu đã trùng */
function hrSuggestUsername(fullName) {
  const words = hrStripDiacritics(fullName).split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const last = words[words.length - 1];
  const initials = words.slice(0, -1).map((w) => w[0]).join('');
  const base = initials ? `${last}.${initials}` : last;
  let candidate = base, n = 1;
  while ((DB.users || []).some((u) => String(u.username || '').toLowerCase() === candidate)) {
    n += 1;
    candidate = `${base}${n}`;
  }
  return candidate;
}

/** Vai trò được phép theo đúng phòng ban. Không cho gán role chéo phòng ban. */
const HR_DEPT_ROLE_IDS = {
  'Ban giám đốc': ['ROLE_DIRECTOR','R02'],
  'Kinh doanh': ['ROLE_SALES_MANAGER','ROLE_SALES','R03','R04'],
  'Sản xuất': ['ROLE_PRODUCTION','R05'],
  'Kho vận': ['ROLE_WAREHOUSE','ROLE_LOGISTICS','R06'],
  'Mua hàng': ['ROLE_PURCHASE_MANAGER','ROLE_PURCHASE','R07'],
  'Kế toán': ['ROLE_ACCOUNTING','R08'],
  'Hành chính - Nhân sự': ['ROLE_HR'],
  'QC/ATTP': ['ROLE_QC'],
  'Bảo trì - Vệ sinh': ['ROLE_MAINTENANCE'],
  'Nhà hàng & Cửa hàng': ['ROLE_RESTAURANT','ROLE_RESTAURANT_STAFF'],
  'Gia công': ['ROLE_SUBCONTRACT'],
  'R&D': ['ROLE_RND'],
  'Hệ thống': ['ROLE_ADMIN','R01'],
};
function hrRolesForDept(dept) {
  const ids = HR_DEPT_ROLE_IDS[String(dept||'')] || [];
  return (DB.roles || []).filter(r => ids.includes(String(r.id)));
}
function hrPositionsForDept(dept) {
  return [...new Set((DB.employees||[]).filter(e => String(e.dept||'') === String(dept||'') && e.position).map(e => e.position))].sort((a,b)=>String(a).localeCompare(String(b),'vi'));
}
function hrSuggestRoleId(dept, position) {
  const roles = hrRolesForDept(dept);
  if (dept === 'Kinh doanh' && /trưởng phòng/i.test(String(position || ''))) {
    const mgr = roles.find(r => ['ROLE_SALES_MANAGER','R03'].includes(String(r.id))); if (mgr) return mgr.id;
  }
  if (dept === 'Mua hàng' && /trưởng phòng/i.test(String(position || ''))) {
    const mgr = roles.find(r => String(r.id)==='ROLE_PURCHASE_MANAGER'); if (mgr) return mgr.id;
  }
  return roles[0]?.id || '';
}
function hrRefreshPositionAndRoleOptions({keepPosition=true}={}) {
  const dept = $('#empDept')?.value || '';
  const posEl = $('#empPosition');
  const roleEl = $('#empAccountRole');
  if (posEl) {
    const oldPos = keepPosition ? posEl.value : '';
    const positions = hrPositionsForDept(dept);
    posEl.innerHTML = `<option value="">-- Chọn chức vụ --</option>${positions.map(p=>`<option value="${esc(p)}" ${String(p)===String(oldPos)?'selected':''}>${esc(p)}</option>`).join('')}`;
    if (!positions.includes(oldPos)) posEl.value = '';
  }
  if (roleEl) {
    const oldRole = roleEl.value;
    const roles = hrRolesForDept(dept);
    roleEl.innerHTML = `<option value="">-- Chọn vai trò thuộc phòng ban --</option>${roles.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}`;
    if (roles.some(r=>String(r.id)===String(oldRole))) roleEl.value=oldRole; else roleEl.value=hrSuggestRoleId(dept,posEl?.value||'');
    roleEl.dataset.touched='0';
  }
}
function hrSyncSuggestedRole() {
  const roleSelect = $('#empAccountRole');
  if (!roleSelect) return;
  const suggested = hrSuggestRoleId($('#empDept')?.value || '', $('#empPosition')?.value || '');
  if (suggested && hrRolesForDept($('#empDept')?.value||'').some(r=>r.id===suggested)) roleSelect.value = suggested;
}

/** Gõ họ tên thì tự gợi ý tên đăng nhập, trừ khi người dùng đã tự sửa ô này */
function hrSyncSuggestedUsername() {
  const el = $('#empUsername');
  if (!el || el.dataset.touched === '1') return;
  el.value = hrSuggestUsername($('#empName')?.value || '');
}

/* --------------------------------------- THÊM MỚI / SỬA HỒ SƠ NHÂN SỰ */
function openEmployeeForm(id) {
  const editing = id ? Q.employee(id) : null;
  if (id && !editing) { Toast.err('Không tìm thấy nhân sự', id); return; }
  const contractTypes = DB.contractTypes || [];
  const today = currentDateYMD();
  const existingAccount = editing ? (DB.users || []).find((u) => u.empId === editing.id) : null;
  const currentActor = (typeof SystemAPI !== 'undefined' && typeof SystemAPI.currentUser === 'function') ? SystemAPI.currentUser() : null;
  const canAdminResetPassword = !!editing && !!existingAccount && currentActor?.roleId === 'ROLE_ADMIN';
  const createAccountDefault = !editing; // Mặc định tick khi thêm nhân sự mới
  const suggestedRoleId = hrSuggestRoleId(editing ? editing.dept : '', editing ? editing.position : '');
  const suggestedUsername = editing ? hrSuggestUsername(editing.name) : '';

  Modal.open({
    title: editing ? `Sửa hồ sơ nhân sự · ${esc(editing.id)}` : 'Thêm nhân sự mới',
    sub: editing ? esc(editing.name) : 'Khai báo hồ sơ nhân sự mới',
    size: 'lg',
    body: `
      <input type="hidden" id="empFormId" value="${editing ? esc(editing.id) : ''}">
      <div class="form-grid">
        <div class="field"><label>Họ và tên <span class="req">*</span></label>
          <input class="inp" id="empName" value="${editing ? esc(editing.name) : ''}" placeholder="Nguyễn Văn A" oninput="hrSyncSuggestedUsername()"></div>
        <div class="field"><label>Giới tính</label>
          <select class="inp" id="empGender">
            <option value="Nam" ${(!editing || editing.gender === 'Nam') ? 'selected' : ''}>Nam</option>
            <option value="Nữ" ${editing?.gender === 'Nữ' ? 'selected' : ''}>Nữ</option>
          </select></div>
        <div class="field"><label>Phòng ban <span class="req">*</span></label>
          <select class="inp" id="empDept" onchange="hrRefreshPositionAndRoleOptions({keepPosition:false})">
            <option value="">-- Chọn phòng ban --</option>
            ${DB.departments.map((d) => `<option value="${esc(d)}" ${editing?.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Chức vụ <span class="req">*</span></label>
          <select class="inp" id="empPosition" onchange="hrSyncSuggestedRole()">
            <option value="">-- Chọn chức vụ --</option>
            ${hrPositionsForDept(editing?.dept || '').map((p) => `<option value="${esc(p)}" ${editing?.position===p?'selected':''}>${esc(p)}</option>`).join('')}
          </select>
          <div class="cell-sub" style="margin-top:4px">Chỉ hiển thị chức vụ thuộc phòng ban đã chọn.</div></div>
        <div class="field"><label>Loại hợp đồng <span class="req">*</span></label>
          <select class="inp" id="empContractType">
            ${contractTypes.map((c) => `<option value="${esc(c)}" ${editing ? (editing.contractType === c ? 'selected' : '') : (c === contractTypes[0] ? 'selected' : '')}>${esc(c)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Trạng thái làm việc</label>
          <select class="inp" id="empStatus">
            ${statusOptions('ns_').map(([k, l]) => `<option value="${k}" ${(editing ? editing.status === k : k === 'ns_thu_viec') ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Số điện thoại <span class="req">*</span></label>
          <input class="inp" id="empPhone" value="${editing ? esc(editing.phone) : ''}" placeholder="09xx xxx xxx"></div>
        <div class="field"><label>Email</label>
          <input class="inp" id="empEmail" type="email" value="${editing ? esc(editing.email) : ''}" placeholder="ten@lenamfood.vn"></div>
        <div class="field"><label>Ngày vào làm <span class="req">*</span></label>
          <input class="inp" id="empJoinDate" type="date" data-allow-past="1" value="${editing ? esc(editing.joinDate) : today}"></div>
        <div class="field"><label>Mức lương (VNĐ/tháng)</label>
          <input class="inp right num" id="empSalary" type="number" min="0" step="500000" value="${editing ? Number(editing.salary || 0) : 0}"></div>
      </div>
      ${existingAccount ? `
        <div class="form-sec-title" style="margin-top:18px"><i class="fa-solid fa-key"></i>Tài khoản đăng nhập</div>
        <div class="chip" style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;font-size:12.5px;white-space:normal">
          <i class="fa-solid fa-circle-check" style="color:var(--green)"></i>
          <span>Đã có tài khoản <span class="code">${esc(existingAccount.username)}</span> — vai trò <b>${esc((DB.roles.find((r) => r.id === existingAccount.roleId) || {}).name || '—')}</b>. Đổi vai trò tại menu "Người dùng &amp; phân quyền".</span>
        </div>
        ${canAdminResetPassword ? `
          <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-unlock-keyhole"></i>Admin cấp lại mật khẩu</div>
          <div class="form-grid">
            <div class="field"><label>Mật khẩu mới <span class="req">*</span></label>
              <input class="inp" id="empAdminNewPassword" type="password" minlength="6" autocomplete="new-password" placeholder="Tối thiểu 6 ký tự"></div>
            <div class="field"><label>Nhập lại mật khẩu mới <span class="req">*</span></label>
              <input class="inp" id="empAdminNewPassword2" type="password" minlength="6" autocomplete="new-password" placeholder="Nhập lại mật khẩu"></div>
            <div class="field" style="grid-column:1/-1">
              <div class="cell-sub" style="margin-bottom:8px">Chỉ Quản trị hệ thống được cấp lại mật khẩu. Mật khẩu mới có hiệu lực ngay sau khi xác nhận.</div>
              <button class="btn btn-warning" type="button" data-act="employee-admin-reset-password" data-id="${esc(editing.id)}"><i class="fa-solid fa-key"></i>Cấp lại mật khẩu</button>
            </div>
          </div>` : ''}
      ` : `
        <div class="form-sec-title" style="margin-top:18px"><i class="fa-solid fa-key"></i>Tài khoản đăng nhập</div>
        <div class="field" style="margin-bottom:10px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
            <input type="checkbox" id="empCreateAccount" ${createAccountDefault ? 'checked' : ''}
              onchange="document.getElementById('empAccountFields').style.display=this.checked?'':'none'">
            Tạo tài khoản đăng nhập cùng vai trò cho nhân sự này
          </label>
        </div>
        <div id="empAccountFields" class="form-grid" style="${createAccountDefault ? '' : 'display:none'}">
          <div class="field"><label>Tên đăng nhập <span class="req">*</span></label>
            <input class="inp" id="empUsername" value="${esc(suggestedUsername)}" placeholder="vd: tu.ha" oninput="this.dataset.touched='1'"></div>
          <div class="field"><label>Mật khẩu tạm thời <span class="req">*</span></label>
            <input class="inp" id="empPassword" type="text" value="123456" placeholder="Mật khẩu ban đầu"></div>
          <div class="field" style="grid-column:1/-1"><label>Vai trò phân quyền <span class="req">*</span></label>
            <select class="inp" id="empAccountRole" onchange="this.dataset.touched='1'">
              <option value="">-- Chọn vai trò thuộc phòng ban --</option>
              ${hrRolesForDept(editing?.dept || '').map((r) => `<option value="${esc(r.id)}" ${r.id === suggestedRoleId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
            </select>
            <div class="cell-sub" style="margin-top:4px">Chỉ hiển thị vai trò phân quyền thuộc đúng phòng ban đã chọn.</div>
          </div>
        </div>
      `}`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-primary" data-act="employee-save"><i class="fa-solid fa-floppy-disk"></i>${editing ? 'Lưu thay đổi' : 'Thêm nhân sự'}</button>`,
  });
}

async function saveEmployeeForm() {
  const formId = $('#empFormId')?.value || '';
  const name = $('#empName')?.value.trim() || '';
  const dept = $('#empDept')?.value || '';
  const position = $('#empPosition')?.value.trim() || '';
  const contractType = $('#empContractType')?.value || '';
  const status = $('#empStatus')?.value || 'ns_thu_viec';
  const phone = String($('#empPhone')?.value || '').replace(/\D/g,'').slice(0,10);
  const email = $('#empEmail')?.value.trim() || '';
  const joinDate = $('#empJoinDate')?.value || currentDateYMD();
  const gender = $('#empGender')?.value || 'Nam';
  const salary = Math.max(0, Number($('#empSalary')?.value) || 0);

  if (!name || !dept || !position || !contractType || !phone) {
    Toast.err('Thiếu thông tin', 'Vui lòng nhập đầy đủ họ tên, phòng ban, chức vụ, loại hợp đồng và số điện thoại.');
    return;
  }
  if (!/^\d{10}$/.test(phone)) { Toast.err('Số điện thoại không hợp lệ','Số điện thoại nhân sự phải gồm đúng 10 chữ số.'); return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { Toast.err('Email không hợp lệ','Vui lòng nhập đúng địa chỉ email cá nhân của nhân sự.'); return; }
  if (!hrPositionsForDept(dept).includes(position)) { Toast.err('Chức vụ không thuộc phòng ban', 'Vui lòng chọn đúng chức vụ trong danh sách của phòng ban đã chọn.'); return; }

  /* Tài khoản đăng nhập đi kèm (chỉ có mặt trên form khi nhân sự chưa có tài khoản) */
  const accountCheckbox = $('#empCreateAccount');
  const createAccount = !!accountCheckbox?.checked;
  let accUsername = '', accPassword = '', accRoleId = '';
  if (createAccount) {
    accUsername = ($('#empUsername')?.value || '').trim() || hrSuggestUsername(name);
    accPassword = ($('#empPassword')?.value || '').trim();
    accRoleId = $('#empAccountRole')?.value || '';
    if (!accUsername) { Toast.err('Thiếu tên đăng nhập', 'Vui lòng nhập tên đăng nhập cho tài khoản mới.'); return; }
    if ((DB.users || []).some((u) => String(u.username || '').toLowerCase() === accUsername.toLowerCase())) {
      Toast.err('Trùng tên đăng nhập', `Tên đăng nhập "${accUsername}" đã được sử dụng. Vui lòng chọn tên khác.`);
      return;
    }
    if (!accPassword) { Toast.err('Thiếu mật khẩu', 'Vui lòng nhập mật khẩu tạm thời cho tài khoản mới.'); return; }
    if (!accRoleId || !(DB.roles || []).some((r) => r.id === accRoleId)) { Toast.err('Chưa chọn vai trò', 'Vui lòng chọn vai trò phân quyền cho tài khoản mới.'); return; }
    if (!hrRolesForDept(dept).some(r => String(r.id) === String(accRoleId))) { Toast.err('Vai trò không thuộc phòng ban', 'Tài khoản chỉ được chọn vai trò phân quyền thuộc đúng phòng ban của nhân sự.'); return; }
  }

  let empRecord;
  let empId = formId;
  if (formId) {
    empRecord = Q.employee(formId);
    if (!empRecord) { Toast.err('Không tìm thấy nhân sự', formId); return; }
    Object.assign(empRecord, { name, dept, position, contractType, status, phone, email, joinDate, gender, salary });
  } else {
    empId = nextCode('NV-', DB.employees, 3);
    empRecord = { id: empId, name, dept, position, contractType, status, phone, email, joinDate, gender, salary, active: true };
    DB.employees.push(empRecord);
  }

  let createdAccount = null;
  if (createAccount) {
    // SystemAPI.login() so sánh mật khẩu bằng SHA-256 vào `passwordHash`, không
    // phải chuỗi thô — trước đây field ghi ở đây là `password` (chuỗi thô), nên
    // tài khoản tạo ra không bao giờ đăng nhập được (passwordHash luôn undefined
    // -> luôn sai mật khẩu), kể cả khi đã lưu lên server đúng cách.
    const accPasswordHash = typeof SystemAPI !== 'undefined' && typeof SystemAPI.hashPassword === 'function'
      ? await SystemAPI.hashPassword(accPassword)
      : accPassword;
    createdAccount = {
      id: nextCode('U', DB.users, 2), empId, username: accUsername, roleId: accRoleId,
      passwordHash: accPasswordHash, lastLogin: '', state: 'active', name: empRecord.name, dept: empRecord.dept, email: empRecord.email,
    };
    DB.users.push(createdAccount);
  }

  const linkedAccount=(DB.users||[]).find(u=>String(u.empId||'')===String(empId));
  if(linkedAccount){ linkedAccount.name=empRecord.name; linkedAccount.fullName=empRecord.name; linkedAccount.dept=empRecord.dept; linkedAccount.email=empRecord.email||''; }

  SEARCH_INDEX = null;
  if (typeof HRAPI !== 'undefined') HRAPI.scheduleSync();
  if (createdAccount && typeof SystemAPI !== 'undefined' && typeof SystemAPI.saveUsers === 'function') {
    // Phải CHỜ ghi lên KIO rồi mới đóng modal/toast "đã thêm nhân sự mới": trước
    // đây saveUsers() không được await nên nếu request lỗi (mất mạng, KIO lỗi...)
    // người dùng vẫn thấy "đã lưu thành công" trong khi tài khoản chưa hề lên
    // server — và F5 ngay sau đó (trước khi debounce sync khác kịp chạy) sẽ mất
    // tài khoản vừa tạo dù giao diện báo lưu OK.
    try {
      await SystemAPI.saveUsers();
      if (typeof SystemAPI.audit === 'function') {
        await SystemAPI.audit({
          module: 'SYSTEM', entityType: 'USER', entityId: createdAccount.id, action: 'CREATE',
          description: `${DB.currentUser?.name || 'Người dùng'} tạo tài khoản ${createdAccount.username} theo hồ sơ nhân sự ${empId}`,
          newData: { empId, username: createdAccount.username, roleId: createdAccount.roleId },
        });
      }
    } catch (err) {
      DB.users = DB.users.filter((u) => u.id !== createdAccount.id);
      console.warn('[HR] Không lưu được tài khoản mới lên server:', err);
      Toast.err('Không lưu được tài khoản đăng nhập', err?.message || 'Đã lưu hồ sơ nhân sự nhưng tài khoản chưa được tạo. Vui lòng thử lại tại đây hoặc ở màn Người dùng & phân quyền.');
      createdAccount = null;
    }
  }

  Modal.close();
  render();

  const roleName = createdAccount ? ((DB.roles.find((r) => r.id === createdAccount.roleId) || {}).name || '') : '';
  const accountNote = createdAccount ? ` · Tài khoản ${createdAccount.username} (${roleName})` : '';
  Toast.ok(formId ? 'Đã cập nhật hồ sơ nhân sự' : 'Đã thêm nhân sự mới', `${empId} · ${name}${accountNote}`);
}

async function adminResetEmployeePassword(empId) {
  const actor = (typeof SystemAPI !== 'undefined' && typeof SystemAPI.currentUser === 'function') ? SystemAPI.currentUser() : null;
  if (!actor || actor.roleId !== 'ROLE_ADMIN') {
    Toast.err('Không có quyền', 'Chỉ Quản trị hệ thống được cấp lại mật khẩu cho nhân viên.');
    return;
  }

  const emp = Q.employee(empId);
  const account = (DB.users || []).find((u) => String(u.empId || '') === String(empId || ''));
  if (!emp || !account) {
    Toast.err('Không tìm thấy tài khoản', 'Nhân sự này chưa có tài khoản đăng nhập ERP.');
    return;
  }

  const p1 = String($('#empAdminNewPassword')?.value || '');
  const p2 = String($('#empAdminNewPassword2')?.value || '');
  if (p1.length < 6) { Toast.err('Mật khẩu chưa hợp lệ', 'Mật khẩu mới phải có ít nhất 6 ký tự.'); return; }
  if (p1 !== p2) { Toast.err('Mật khẩu chưa khớp', 'Hai lần nhập mật khẩu mới chưa giống nhau.'); return; }

  confirmBox({
    title: 'Cấp lại mật khẩu?',
    tone: 'warning',
    icon: 'fa-key',
    okText: 'Cấp lại mật khẩu',
    message: `Tài khoản <b>${esc(account.username)}</b> của <b>${esc(emp.name)}</b> sẽ dùng mật khẩu mới ngay sau khi xác nhận.`,
    onOk: async () => {
      try {
        account.passwordHash = (typeof SystemAPI !== 'undefined' && typeof SystemAPI.hashPassword === 'function')
          ? await SystemAPI.hashPassword(p1)
          : p1;
        account.updatedAt = new Date().toISOString();
        await SystemAPI.saveUsers();
        if (typeof SystemAPI.audit === 'function') {
          await SystemAPI.audit({
            module: 'SYSTEM', entityType: 'USER', entityId: account.id, action: 'ADMIN_RESET_PASSWORD',
            description: `${actor.fullName || actor.name || actor.username} cấp lại mật khẩu cho tài khoản ${account.username} · ${emp.id} · ${emp.name}`,
            newData: { empId: emp.id, username: account.username, resetBy: actor.id || actor.username },
          });
        }
        const a = $('#empAdminNewPassword'); if (a) a.value = '';
        const b = $('#empAdminNewPassword2'); if (b) b.value = '';
        Toast.ok('Đã cấp lại mật khẩu', `${emp.name} có thể đăng nhập bằng mật khẩu mới.`);
      } catch (err) {
        console.warn('[HR] Cấp lại mật khẩu thất bại:', err);
        Toast.err('Không cấp lại được mật khẩu', err?.message || 'Không lưu được tài khoản lên server.');
      }
    },
  });
}

/* -------------------------------------------------- KHÓA / NGỪNG SỬ DỤNG */
function toggleEmployeeActive(id) {
  const e = Q.employee(id);
  if (!e) return;
  const willLock = e.active !== false;
  confirmBox({
    title: willLock ? 'Khóa / ngừng sử dụng nhân sự' : 'Mở khóa nhân sự',
    tone: willLock ? 'danger' : 'primary',
    icon: willLock ? 'fa-lock' : 'fa-lock-open',
    okText: willLock ? 'Khóa hồ sơ' : 'Mở khóa',
    message: willLock
      ? `Khóa hồ sơ <b>${esc(e.id)} · ${esc(e.name)}</b>? Hồ sơ bị khóa vẫn được giữ lại lịch sử nhưng sẽ được đánh dấu ngừng sử dụng.`
      : `Mở khóa hồ sơ <b>${esc(e.id)} · ${esc(e.name)}</b> để tiếp tục sử dụng bình thường?`,
    onOk: () => {
      e.active = !willLock;
      if (typeof HRAPI !== 'undefined') HRAPI.scheduleSync();
      render();
      Toast.ok(e.active ? 'Đã mở khóa nhân sự' : 'Đã khóa / ngừng sử dụng nhân sự', `${e.id} · ${e.name}`);
    },
  });
}

/* --------------------------------------------------- IMPORT TỪ EXCEL (CSV) */
function openEmployeeImportModal() {
  Modal.open({
    title: 'Import danh sách nhân sự',
    sub: 'Nhập nhân sự hàng loạt từ file Excel đã lưu dạng CSV theo đúng mẫu của hệ thống',
    body: `
      <div style="border:2px dashed var(--border-2);border-radius:var(--r-lg);padding:28px 18px;text-align:center;background:var(--surface-2)">
        <div class="empty-ico" style="margin:0 auto 12px"><i class="fa-solid fa-file-csv"></i></div>
        <h4 style="font-size:14px;margin-bottom:5px">Chọn file CSV đã xuất từ Excel</h4>
        <p style="font-size:12.5px;color:var(--text-3);margin-bottom:14px;line-height:1.6">
          Cột bắt buộc: Họ tên, Phòng ban, Chức vụ, Số điện thoại, Loại hợp đồng.<br>
          Để trống cột <b>Mã NV</b> khi thêm mới — dòng có Mã NV trùng hồ sơ hiện có sẽ được cập nhật.
        </p>
        <input type="file" id="empImportFile" accept=".csv" style="display:block;margin:0 auto" />
      </div>
      <div id="empImportResult" style="margin-top:14px;font-size:12.5px;color:var(--text-2)"></div>`,
    foot: `<button class="btn left" data-act="hr-download-template"><i class="fa-solid fa-download"></i>Tải file mẫu</button>
           <button class="btn" data-act="modal-close">Đóng</button>`,
    onMount: (m) => {
      const input = m.querySelector('#empImportFile');
      if (input) {
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          if (file) importEmployeesFromFile(file);
        });
      }
    },
  });
}

function parseHrCsv(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  return clean.split(/\r\n|\n/).filter((l) => l.length > 0).map((line) => {
    const cells = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ';') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

function importEmployeesFromCSVText(text) {
  const rows = parseHrCsv(text);
  if (rows.length < 2) return { created: 0, updated: 0, skipped: 0, errors: ['File rỗng hoặc thiếu dữ liệu.'] };

  const dataRows = rows.slice(1); // bỏ dòng tiêu đề
  const statusByLabel = {};
  Object.keys(DB.statusMap).filter((k) => k.startsWith('ns_')).forEach((k) => { statusByLabel[DB.statusMap[k].label.toLowerCase()] = k; });

  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  dataRows.forEach((cols, idx) => {
    const rowNo = idx + 2;
    const [idRaw, name, dept, position, gender, phone, email, joinDateRaw, contractTypeRaw, statusLabelText] = cols.map((c) => String(c || '').trim());
    if (!name || !dept || !position || !phone) {
      skipped++; errors.push(`Dòng ${rowNo}: thiếu họ tên / phòng ban / chức vụ / số điện thoại.`); return;
    }
    if (!DB.departments.includes(dept)) {
      skipped++; errors.push(`Dòng ${rowNo}: phòng ban "${dept}" không hợp lệ.`); return;
    }
    const status = statusByLabel[statusLabelText.toLowerCase()] || 'ns_thu_viec';
    const joinDate = /^\d{4}-\d{2}-\d{2}$/.test(joinDateRaw) ? joinDateRaw : currentDateYMD();
    const contractType = (DB.contractTypes || []).includes(contractTypeRaw) ? contractTypeRaw : (DB.contractTypes || [])[0] || '';

    const existing = idRaw ? Q.employee(idRaw) : null;
    if (existing) {
      Object.assign(existing, { name, dept, position, gender: gender || existing.gender, phone, email, joinDate, contractType: contractType || existing.contractType, status });
      updated++;
    } else {
      const newId = idRaw && !Q.employee(idRaw) ? idRaw : nextCode('NV-', DB.employees, 3);
      DB.employees.push({ id: newId, name, dept, position, gender: gender || 'Nam', phone, email, joinDate, contractType, status, salary: 0, active: true });
      created++;
    }
  });

  return { created, updated, skipped, errors };
}

function importEmployeesFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let result;
    try {
      result = importEmployeesFromCSVText(String(reader.result || ''));
    } catch (err) {
      Toast.err('Không đọc được file', 'Vui lòng kiểm tra định dạng CSV theo đúng mẫu.');
      return;
    }
    const box = $('#empImportResult');
    if (box) {
      box.innerHTML = `Đã thêm mới <b>${result.created}</b> · cập nhật <b>${result.updated}</b> · bỏ qua <b>${result.skipped}</b> dòng lỗi.`
        + (result.errors.length ? `<div style="margin-top:6px;color:var(--red)">${result.errors.slice(0, 5).map(esc).join('<br>')}</div>` : '');
    }
    if (result.created || result.updated) {
      SEARCH_INDEX = null;
      if (typeof HRAPI !== 'undefined') HRAPI.scheduleSync();
      render();
    }
    Toast.ok('Đã xử lý file import', `Thêm mới ${result.created} · Cập nhật ${result.updated} · Lỗi ${result.skipped}`);
  };
  reader.onerror = () => Toast.err('Không đọc được file', 'Vui lòng thử lại.');
  reader.readAsText(file, 'utf-8');
}

/* ---------------------------------------------------------- CHẤM CÔNG */
Views.attendance = function () {
  const f = F('attendance', { q: '', dept: '', month: '2026-08' });
  const q = (f.q || '').toLowerCase().trim();
  const list = DB.attendance.filter((a) => {
    if (f.dept && a.dept !== f.dept) return false;
    if (q && ![a.empId, a.name, a.dept, a.position].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  });
  const pg = paged(list, 'attendance');

  const totalWorked = DB.attendance.reduce((s, a) => s + a.worked, 0);
  const totalStd = DB.attendance.reduce((s, a) => s + a.standard, 0);
  const totalOt = DB.attendance.reduce((s, a) => s + a.ot, 0);
  const totalLeave = DB.attendance.reduce((s, a) => s + a.leave, 0);
  const totalLate = DB.attendance.filter((a) => a.late > 0).length;

  const canEditAtt = hrAttEditAllowed();
  const rows = pg.items.map((a) => `
    <tr class="clickable" data-act="open-employee" data-id="${a.empId}">
      <td><span class="code">${a.empId}</span></td>
      <td><div style="display:flex;align-items:center;gap:9px">${avatarHTML(a.name)}<span>${cell2(esc(a.name), esc(a.position))}</span></div></td>
      <td class="hide-sm"><span class="chip">${esc(a.dept)}</span></td>
      <td class="center num">${a.standard}</td>
      <td class="center num strong" style="color:var(--green)">${a.worked}</td>
      <td class="center num" style="color:${a.leave ? 'var(--orange)' : 'var(--text-3)'}">${a.leave || '—'}</td>
      <td class="center num hide-sm" style="color:${a.late ? 'var(--red)' : 'var(--text-3)'}">${a.late || '—'}</td>
      <td class="center num hide-sm" style="color:${a.ot ? 'var(--indigo)' : 'var(--text-3)'}">${a.ot || '—'}</td>
      <td style="min-width:120px">${progressBar(a.rate)}</td>
      <td class="center">${canEditAtt ? `<button class="btn btn-sm" data-act="attendance-edit" data-id="${a.empId}" title="Sửa chấm công"><i class="fa-solid fa-pen"></i></button>` : ''}</td>
    </tr>`);

  return `
  ${pageHead('Chấm công', `Bảng công ${fmtMonth(f.month + '-01')} · ${DB.attendance.length} nhân sự`, `
    <input class="inp" type="month" data-f="attendance.month" value="${f.month}" style="width:160px" />
    <button class="btn" data-act="export-attendance"><i class="fa-solid fa-file-export"></i>Xuất bảng công</button>
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng công chuẩn', fmtN(totalStd), 'fa-calendar', 'slate')}
    ${mkpi('Tổng công thực tế', fmtN(totalWorked), 'fa-calendar-check', 'green')}
    ${mkpi('Tỷ lệ chuyên cần', (totalStd ? Math.round((totalWorked / totalStd) * 1000) / 10 : 0) + '%', 'fa-gauge-high', 'blue')}
    ${mkpi('Ngày nghỉ phép', fmtN(totalLeave), 'fa-umbrella-beach', 'orange')}
    ${mkpi('Giờ tăng ca', fmtN(totalOt), 'fa-clock', 'indigo')}
    ${mkpi('NV đi muộn', fmtN(totalLate), 'fa-person-running', 'red')}
  </div>

  <div class="card">
    <div class="toolbar">
      ${searchBox('attendance', 'Tìm mã NV, họ tên…')}
      ${selectFilter('attendance', 'dept', DB.departments.map((d) => [d, d]), 'Tất cả phòng ban')}
      ${(f.q || f.dept) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="attendance"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} nhân sự</span>
    </div>
    ${tableShell(
      [{ t: 'Mã NV', w: '92px' }, { t: 'Họ tên' }, { t: 'Phòng ban', cls: 'hide-sm' }, { t: 'Công chuẩn', cls: 'center' },
       { t: 'Đi làm', cls: 'center' }, { t: 'Nghỉ phép', cls: 'center' }, { t: 'Đi muộn', cls: 'center hide-sm' },
       { t: 'Tăng ca (h)', cls: 'center hide-sm' }, { t: 'Tỷ lệ', w: '150px' }, { t: '', w: '56px', cls: 'center' }],
      rows, { emptyTitle: 'Không có dữ liệu chấm công' })}
    ${pagiHTML('attendance', pg, 'nhân sự')}
  </div>`;
};

/* ------------------------------------------------ SỬA BẢNG CÔNG */
function hrAttEditAllowed() {
  try {
    if (typeof Auth === 'undefined' || typeof Auth.currentRole !== 'function') return true;
    const role = Auth.currentRole();
    if (!role) return true;
    const perms = role.permissions || role.perms || [];
    return perms.includes('*') || perms.includes('HR_OPERATE');
  } catch (e) { return true; }
}

function hrAttRate(worked, standard) {
  return standard > 0 ? Math.round((worked / standard) * 1000) / 10 : 0;
}

function openAttendanceEdit(empId) {
  if (!hrAttEditAllowed()) { Toast.err('Không đủ quyền', 'Bạn không có quyền chỉnh sửa chấm công.'); return; }
  const a = DB.attendance.find((x) => x.empId === empId);
  if (!a) { Toast.err('Không tìm thấy dữ liệu chấm công', empId); return; }
  const month = (typeof F === 'function' ? F('attendance', { month: '2026-08' }).month : '') || '';

  Modal.open({
    title: `Sửa chấm công · ${esc(a.empId)}`,
    sub: `${esc(a.name)} · ${esc(a.dept)}${month ? ' · ' + esc(fmtMonth(month + '-01')) : ''}`,
    size: 'md',
    body: `
      <input type="hidden" id="attEmpId" value="${esc(a.empId)}">
      <div class="form-grid">
        <div class="field"><label>Công chuẩn (ngày) <span class="req">*</span></label>
          <input class="inp right num" id="attStandard" type="number" min="0" step="0.5" value="${Number(a.standard) || 0}" oninput="hrAttPreview()"></div>
        <div class="field"><label>Công thực tế (ngày) <span class="req">*</span></label>
          <input class="inp right num" id="attWorked" type="number" min="0" step="0.5" value="${Number(a.worked) || 0}" oninput="hrAttPreview()"></div>
        <div class="field"><label>Nghỉ phép (ngày)</label>
          <input class="inp right num" id="attLeave" type="number" min="0" step="0.5" value="${Number(a.leave) || 0}"></div>
        <div class="field"><label>Số lần đi muộn</label>
          <input class="inp right num" id="attLate" type="number" min="0" step="1" value="${Number(a.late) || 0}"></div>
        <div class="field"><label>Tăng ca (giờ)</label>
          <input class="inp right num" id="attOt" type="number" min="0" step="0.5" value="${Number(a.ot) || 0}"></div>
        <div class="field"><label>Tỷ lệ chuyên cần</label>
          <div class="chip" id="attRatePreview" style="padding:9px 12px;font-weight:700">${hrAttRate(Number(a.worked) || 0, Number(a.standard) || 0)}%</div></div>
      </div>
      <div class="cell-sub" style="margin-top:10px">Tỷ lệ chuyên cần được tính tự động = công thực tế ÷ công chuẩn.</div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button>
           <button class="btn btn-primary" data-act="attendance-save"><i class="fa-solid fa-floppy-disk"></i>Lưu thay đổi</button>`,
  });
}

function hrAttPreview() {
  const el = $('#attRatePreview');
  if (!el) return;
  el.textContent = hrAttRate(Number($('#attWorked')?.value) || 0, Number($('#attStandard')?.value) || 0) + '%';
}

async function saveAttendanceEdit() {
  if (!hrAttEditAllowed()) { Toast.err('Không đủ quyền', 'Bạn không có quyền chỉnh sửa chấm công.'); return; }
  const empId = $('#attEmpId')?.value || '';
  const a = DB.attendance.find((x) => x.empId === empId);
  if (!a) { Toast.err('Không tìm thấy dữ liệu chấm công', empId); return; }

  const read = (id) => { const v = $('#' + id)?.value; return v === '' || v == null ? NaN : Number(v); };
  const standard = read('attStandard');
  const worked = read('attWorked');
  const leave = read('attLeave');
  const late = read('attLate');
  const ot = read('attOt');

  if ([standard, worked, leave, late, ot].some((n) => !Number.isFinite(n) || n < 0)) {
    Toast.err('Dữ liệu không hợp lệ', 'Vui lòng nhập số không âm cho tất cả các ô.');
    return;
  }
  if (standard <= 0) { Toast.err('Công chuẩn không hợp lệ', 'Công chuẩn phải lớn hơn 0.'); return; }
  if (worked > standard) { Toast.err('Công thực tế vượt công chuẩn', 'Giờ làm thêm vui lòng nhập vào ô Tăng ca.'); return; }

  const oldData = { standard: a.standard, worked: a.worked, leave: a.leave, late: a.late, ot: a.ot, rate: a.rate };
  const newData = { standard, worked, leave, late: Math.round(late), ot, rate: hrAttRate(worked, standard) };
  Object.assign(a, newData);

  SEARCH_INDEX = null;
  if (typeof HRAPI !== 'undefined') HRAPI.scheduleSync();
  try {
    if (typeof SystemAPI !== 'undefined' && typeof SystemAPI.audit === 'function') {
      await SystemAPI.audit({
        module: 'HR', entityType: 'ATTENDANCE', entityId: empId, action: 'UPDATE',
        description: `${DB.currentUser?.name || 'Người dùng'} sửa chấm công ${empId} · ${a.name}`,
        oldData, newData,
      });
    }
  } catch (err) {
    console.warn('[HR] Không ghi được nhật ký sửa chấm công:', err);
  }

  Modal.close();
  render();
  Toast.ok('Đã cập nhật chấm công', `${empId} · ${a.name} · Công ${worked}/${standard} (${newData.rate}%)`);
}

// Đăng ký xử lý nút (capture phase) để không phụ thuộc bộ điều phối action ở file lõi
if (!window.__hrAttendanceEditBound) {
  window.__hrAttendanceEditBound = true;
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-act="attendance-edit"], [data-act="attendance-save"]');
    if (!el) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (el.dataset.act === 'attendance-edit') openAttendanceEdit(el.dataset.id);
    else saveAttendanceEdit();
  }, true);
}

/* --------------------------------------------- THÔNG TIN PHÂN QUYỀN CÁ NHÂN */
Views['my-access'] = function () {
  const account = Auth.currentAccount();
  const role = Auth.currentRole();
  if (!account || !role) return pageHead('Thông tin phân quyền', 'Chưa xác định được tài khoản đăng nhập');

  const permissionLabels = {
    VIEW_ALL:'Xem toàn bộ phân hệ nghiệp vụ', VIEW_AUDIT:'Xem nhật ký thao tác', APPROVE_HIGH_LEVEL:'Phê duyệt cấp cao',
    PURCHASE_VIEW:'Xem Mua hàng', PURCHASE_PR_CREATE:'Tạo/sửa đề nghị mua hàng', PURCHASE_PR_APPROVE:'Duyệt/từ chối đề nghị mua hàng',
    PURCHASE_PO_CREATE:'Tạo đơn đặt hàng', PURCHASE_PO_APPROVE:'Duyệt/trạng thái đơn đặt hàng', PURCHASE_SUPPLIER_MANAGE:'Quản lý nhà cung cấp', PURCHASE_REPORT:'Xem báo cáo mua hàng',
    INVENTORY_VIEW:'Xem Kho', INVENTORY_OPERATE:'Nhập/xuất/chuyển/kiểm kê kho', INVENTORY_ADJUST:'Điều chỉnh tồn kho',
    QC_VIEW:'Xem QC/ATTP', QC_INSPECT:'Thực hiện kiểm tra chất lượng', QC_APPROVE:'Xác nhận nghiệp vụ QC',
    PRODUCTION_VIEW:'Xem Sản xuất', PRODUCTION_OPERATE:'Thao tác sản xuất', PRODUCTION_APPROVE:'Duyệt/xác nhận sản xuất',
    CRM_VIEW:'Xem CRM – Bán hàng', CRM_OPERATE:'Quản lý khách hàng/CSKH', CRM_DELETE_CUSTOMER:'Xóa khách hàng đủ điều kiện',
    SALES_ORDER_OPERATE:'Tạo/xử lý đơn hàng bán', SALES_APPROVE:'Duyệt nghiệp vụ bán hàng',
    ACCOUNTING_VIEW:'Xem Kế toán – Tài chính', ACCOUNTING_OPERATE:'Thao tác kế toán', PAYMENT_APPROVE:'Duyệt thanh toán',
    HR_VIEW:'Xem Nhân sự', HR_OPERATE:'Thao tác nhân sự', MAINTENANCE_VIEW:'Xem Bảo trì', MAINTENANCE_OPERATE:'Thao tác bảo trì',
    ADMIN_USER_MANAGE:'Quản lý tài khoản và vai trò'
  };

  const navName = new Map();
  NAV.forEach(group => (group.items || []).forEach(item => navName.set(item.id, item)));
  const modules = role.modules || {};
  const moduleRows = [];
  if (modules['*'] === '*') {
    NAV.flatMap(g => g.items || []).filter(i => i.id !== 'users' && i.id !== 'my-access').forEach(item => {
      moduleRows.push(`<tr><td><b>${esc(item.label)}</b></td><td>Tất cả màn hình</td><td><span class="badge green">Được truy cập</span></td></tr>`);
    });
  } else {
    Object.entries(modules).forEach(([moduleId, tabs]) => {
      const item = navName.get(moduleId);
      if (!item) return;
      let screens = 'Tất cả màn hình';
      if (Array.isArray(tabs)) {
        screens = tabs.map(tab => (item.children || []).find(c => (c.tab || c.id) === tab)?.label || tab).join(', ');
      }
      moduleRows.push(`<tr><td><b>${esc(item.label)}</b></td><td>${esc(screens)}</td><td><span class="badge green">Được truy cập</span></td></tr>`);
    });
  }
  moduleRows.push(`<tr><td><b>Thông tin phân quyền</b></td><td>Thông tin tài khoản hiện tại</td><td><span class="badge green">Được truy cập</span></td></tr>`);

  const perms = role.permissions || role.perms || [];
  const permRows = perms.includes('*')
    ? [`<tr><td><span class="code">*</span></td><td>Toàn quyền hệ thống</td><td><span class="badge green">Cho phép</span></td></tr>`]
    : perms.map(code => `<tr><td><span class="code">${esc(code)}</span></td><td>${esc(permissionLabels[code] || code)}</td><td><span class="badge green">Cho phép</span></td></tr>`);

  return `
    ${pageHead('Thông tin phân quyền', 'Bảng quyền của tài khoản đang đăng nhập — chỉ để xem, không thay đổi phân quyền tại đây')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Người dùng', esc(account.fullName || account.name || account.username), 'fa-user', 'blue')}
      ${mkpi('Vai trò', esc(role.name || account.roleId), 'fa-user-shield', 'indigo')}
      ${mkpi('Phòng ban', esc(account.dept || '—'), 'fa-building', 'teal')}
      ${mkpi('Tên đăng nhập', `<span class="code">${esc(account.username || '')}</span>`, 'fa-key', 'orange')}
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><div><h3>Phạm vi menu được truy cập</h3><p>Hiển thị dạng bảng để dễ đối chiếu theo vai trò</p></div></div>
      ${tableShell([{t:'Phân hệ',w:'220px'},{t:'Màn hình được truy cập'},{t:'Trạng thái',w:'150px'}], moduleRows, {emptyTitle:'Chưa có phân hệ được cấp'})}
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Quyền thao tác</h3><p>Các quyền nghiệp vụ hiện được gán cho vai trò ${esc(role.name || '')}</p></div></div>
      ${tableShell([{t:'Mã quyền',w:'260px'},{t:'Diễn giải'},{t:'Trạng thái',w:'150px'}], permRows, {emptyTitle:'Chưa có quyền thao tác'})}
    </div>`;
};

/* --------------------------------------------- NGƯỜI DÙNG & PHÂN QUYỀN */
Views.users = function () {
  const f = F('users', { q: '', role: '' });
  const q = (f.q || '').toLowerCase().trim();
  const list = DB.users.filter((u) => {
    if (f.role && u.roleId !== f.role) return false;
    if (q && ![u.username, u.name, u.dept].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  });

  const rows = list.map((u) => {
    const role = DB.roles.find((r) => r.id === u.roleId);
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:9px">${avatarHTML(u.name)}<span>${cell2(esc(u.name), esc(u.empId + ' · ' + u.dept))}</span></div></td>
      <td><span class="code">${esc(u.username)}</span></td>
      <td><span class="chip"><i class="fa-solid fa-user-shield"></i>${esc(role ? role.name : '')}</span></td>
      <td class="num hide-sm muted">${esc(u.lastLogin)}</td>
      <td>${u.state === 'active' ? '<span class="badge green">Đang hoạt động</span>' : '<span class="badge red">Đã khóa</span>'}</td>
      <td>${rowActions([
        { act: 'user-role', data: `data-id="${u.id}"`, icon: 'fa-user-pen', title: 'Đổi vai trò' },
        { act: 'user-toggle', data: `data-id="${u.id}"`, icon: u.state === 'active' ? 'fa-lock' : 'fa-lock-open', title: u.state === 'active' ? 'Khóa tài khoản' : 'Mở khóa' },
      ])}</td>
    </tr>`;
  });

  return `
  ${pageHead('Người dùng & phân quyền', `${DB.users.length} tài khoản · ${DB.roles.length} vai trò`, `
    <button class="btn" data-act="export-users"><i class="fa-solid fa-file-export"></i>Export</button>
    <button class="btn btn-primary" data-act="new-user"><i class="fa-solid fa-user-plus"></i>Thêm người dùng</button>
  `)}

  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Tổng tài khoản', DB.users.length, 'fa-users-gear', 'blue')}
    ${mkpi('Đang hoạt động', DB.users.filter((u) => u.state === 'active').length, 'fa-circle-check', 'green')}
    ${mkpi('Đã khóa', DB.users.filter((u) => u.state !== 'active').length, 'fa-lock', 'red')}
    ${mkpi('Vai trò', DB.roles.length, 'fa-user-shield', 'indigo')}
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="toolbar">
      ${searchBox('users', 'Tìm tên đăng nhập, họ tên…')}
      ${selectFilter('users', 'role', DB.roles.map((r) => [r.id, r.name]), 'Tất cả vai trò')}
      ${(f.q || f.role) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="users"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}
      <span class="spacer"></span>
      <span class="chip"><i class="fa-solid fa-list"></i> ${fmtN(list.length)} tài khoản</span>
    </div>
    ${tableShell(
      [{ t: 'Người dùng' }, { t: 'Tên đăng nhập', w: '150px' }, { t: 'Vai trò' }, { t: 'Đăng nhập gần nhất', cls: 'hide-sm' },
       { t: 'Trạng thái', w: '150px' }, { t: 'Thao tác', cls: 'right', w: '92px' }],
      rows, { emptyTitle: 'Không tìm thấy tài khoản' })}
  </div>

  <div class="card">
    <div class="card-head"><div><h3>Ma trận vai trò & quyền hạn</h3><p>Quyền truy cập từng nhóm chức năng trong hệ thống</p></div></div>
    <div class="card-body">
      <div class="grid g-auto-lg">
        ${DB.roles.map((r) => `
          <div class="card" style="background:var(--surface-2)">
            <div class="card-body">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
                <span class="mkpi-ico t-indigo"><i class="fa-solid fa-user-shield"></i></span>
                <div style="min-width:0">
                  <div style="font-weight:700;font-size:13.4px">${esc(r.name)}</div>
                  <div style="font-size:11.6px;color:var(--text-3)">${r.users} người dùng</div>
                </div>
              </div>
              <div style="font-size:12.2px;color:var(--text-2);margin-bottom:10px;line-height:1.55">${esc(r.desc)}</div>
              <div style="display:flex;flex-wrap:wrap;gap:5px">
                ${r.perms.map((p) => `<span class="chip" style="font-size:11px"><i class="fa-solid fa-check" style="color:var(--green)"></i>${esc(p)}</span>`).join('')}
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <div class="card-head"><div><h3>Nhật ký thao tác hệ thống</h3><p>100 dấu vết gần nhất — ai thao tác, trên chứng từ nào, thời điểm nào</p></div></div>
    ${tableShell(
      [{t:'Thời gian',w:'150px'},{t:'Người thao tác'},{t:'Vai trò'},{t:'Module',w:'110px'},{t:'Hành động',w:'110px'},{t:'Đối tượng'},{t:'Mô tả'}],
      (DB.auditLogs || []).slice(0,100).map(a => `<tr><td class="muted">${esc(a.createdAt || '')}</td><td>${cell2(esc(a.fullName || a.username || ''), esc(a.username || ''))}</td><td>${esc(a.roleName || '')}</td><td><span class="code">${esc(a.module || '')}</span></td><td><span class="badge blue">${esc(a.action || '')}</span></td><td>${a.entityId ? `<span class="code">${esc(a.entityId)}</span>` : '—'}</td><td>${esc(a.description || '')}</td></tr>`),
      {emptyTitle:'Chưa có nhật ký thao tác'}
    )}
  </div>`;
};

/* ------------------------------------------------------------ CÀI ĐẶT */
Views.settings = function () {
  const s = DB.settings;
  const c = DB.company;
  return `
  ${pageHead('Cài đặt hệ thống', 'Thông tin doanh nghiệp và tham số vận hành', `
    <button class="btn" data-act="reset-demo"><i class="fa-solid fa-rotate-left"></i>Khôi phục dữ liệu demo</button>
    <button class="btn btn-primary" data-act="settings-save"><i class="fa-solid fa-floppy-disk"></i>Lưu thay đổi</button>
  `)}

  <div class="grid g-2" style="margin-bottom:14px">
    <div class="card">
      <div class="card-head"><span class="mkpi-ico t-blue"><i class="fa-solid fa-building"></i></span>
        <div><h3>Thông tin doanh nghiệp</h3><p>Hiển thị trên báo giá, hợp đồng và chứng từ in</p></div></div>
      <div class="card-body">
        <div class="field"><label>Tên công ty</label><input class="inp" data-set="name" value="${esc(c.name)}" /></div>
        <div class="form-grid">
          <div class="field"><label>Mã số thuế</label><input class="inp" data-set="tax" value="${esc(c.tax)}" /></div>
          <div class="field"><label>Điện thoại</label><input class="inp" data-set="phone" value="${esc(c.phone)}" /></div>
          <div class="field"><label>Email</label><input class="inp" data-set="email" value="${esc(c.email)}" /></div>
          <div class="field"><label>Website</label><input class="inp" data-set="website" value="${esc(c.website)}" /></div>
        </div>
        <div class="field"><label>Địa chỉ</label><input class="inp" data-set="address" value="${esc(c.address)}" /></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="mkpi-ico t-indigo"><i class="fa-solid fa-sliders"></i></span>
        <div><h3>Tham số nghiệp vụ</h3><p>Áp dụng cho báo giá, đơn hàng và cảnh báo</p></div></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field"><label>Thuế VAT mặc định (%)</label>
            <select class="inp" data-cfg="vatRate">${[0, 5, 8, 10].map((v) => `<option value="${v}" ${s.vatRate === v ? 'selected' : ''}>${v}%</option>`).join('')}</select></div>
          <div class="field"><label>Hiệu lực báo giá (ngày)</label><input class="inp num" type="number" data-cfg="quoteValidDays" value="${s.quoteValidDays}" /></div>
          <div class="field"><label>Cảnh báo tới hạn trước (ngày)</label><input class="inp num" type="number" data-cfg="dueSoonDays" value="${s.dueSoonDays}" /></div>
          <div class="field"><label>Năm tài chính</label><input class="inp num" type="number" data-cfg="fiscalYear" value="${s.fiscalYear}" /></div>
        </div>
        <div class="setting-row">
          <div><div class="st">Cảnh báo vật tư dưới định mức</div><div class="ss">Hiển thị trên dashboard và menu Vật tư</div></div>
          <div class="sa"><button class="toggle ${s.lowStockAlert ? 'on' : ''}" data-act="toggle-setting" data-key="lowStockAlert"></button></div>
        </div>
        <div class="setting-row">
          <div><div class="st">Tự động tạo lệnh sản xuất</div><div class="ss">Khi đơn hàng chuyển sang trạng thái chờ sản xuất</div></div>
          <div class="sa"><button class="toggle ${s.autoCreatePO ? 'on' : ''}" data-act="toggle-setting" data-key="autoCreatePO"></button></div>
        </div>
        <div class="setting-row">
          <div><div class="st">Gửi email thông báo</div><div class="ss">Thông báo duyệt báo giá, yêu cầu mua hàng</div></div>
          <div class="sa"><button class="toggle ${s.emailNotify ? 'on' : ''}" data-act="toggle-setting" data-key="emailNotify"></button></div>
        </div>
      </div>
    </div>
  </div>

  <div class="grid g-2">
    <div class="card">
      <div class="card-head"><span class="mkpi-ico t-teal"><i class="fa-solid fa-palette"></i></span>
        <div><h3>Giao diện</h3><p>Tùy chọn hiển thị của người dùng hiện tại</p></div></div>
      <div class="card-body">
        <div class="setting-row">
          <div><div class="st">Chế độ tối (Dark mode)</div><div class="ss">Áp dụng cho toàn bộ sidebar, bảng, biểu đồ và popup</div></div>
          <div class="sa"><button class="toggle ${document.documentElement.dataset.theme === 'dark' ? 'on' : ''}" data-act="toggle-theme"></button></div>
        </div>
        <div class="setting-row">
          <div><div class="st">Ngôn ngữ hiển thị</div><div class="ss">Giao diện và chứng từ in</div></div>
          <div class="sa"><select class="inp" style="width:180px"><option>Tiếng Việt</option><option>English</option></select></div>
        </div>
        <div class="setting-row">
          <div><div class="st">Định dạng tiền tệ</div><div class="ss">Áp dụng cho toàn bộ số liệu</div></div>
          <div class="sa"><select class="inp" style="width:180px"><option>VND (₫) — 1.000.000đ</option><option>USD ($)</option></select></div>
        </div>
        <div class="setting-row">
          <div><div class="st">Số dòng mỗi trang</div><div class="ss">Áp dụng cho tất cả bảng dữ liệu</div></div>
          <div class="sa"><select class="inp" style="width:180px"><option>10 dòng</option><option>20 dòng</option><option>50 dòng</option></select></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="mkpi-ico t-orange"><i class="fa-solid fa-database"></i></span>
        <div><h3>Dữ liệu & hệ thống</h3><p>Thông tin phiên bản và dữ liệu demo</p></div></div>
      <div class="card-body">
        <dl class="dl">
          <dt>Phiên bản</dt><dd>VYKO ERP 2.4.0 (bản demo)</dd>
          <dt>Ngày hệ thống</dt><dd>${fmtDate(DB.today)}</dd>
          <dt>Khách hàng</dt><dd>${DB.customers.length} bản ghi</dd>
          <dt>Đơn hàng</dt><dd>${DB.orders.length} bản ghi</dd>
          <dt>Lệnh sản xuất</dt><dd>${DB.productionOrders.length} bản ghi</dd>
          <dt>Vật tư</dt><dd>${DB.materials.length} bản ghi</dd>
          <dt>Nhân sự</dt><dd>${DB.employees.length} bản ghi</dd>
        </dl>
        <div style="margin-top:14px;font-size:12.3px;color:var(--text-3);background:var(--surface-2);border-radius:var(--r);padding:11px 13px;line-height:1.6">
          <i class="fa-solid fa-circle-info" style="color:var(--primary)"></i>
          Bản demo chạy hoàn toàn trên trình duyệt, không kết nối máy chủ. Mọi thay đổi bạn thực hiện (tạo báo giá, duyệt mua hàng, cập nhật tiến độ…) chỉ tồn tại trong phiên làm việc hiện tại — tải lại trang là dữ liệu trở về trạng thái ban đầu.
        </div>
      </div>
    </div>
  </div>`;
};

/* ============================================================
 * BỔ SUNG PHÂN HỆ HR
 * - Phân ca
 * - KPI
 * - Đánh giá hiệu quả
 * - Tính lương: thời gian / sản lượng / doanh số / KPI
 * - Báo cáo năng suất & chi phí nhân công
 * ========================================================== */

function hrNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hrEmployees() {
  return Array.isArray(DB.employees) ? DB.employees : [];
}

function hrAttendance() {
  return Array.isArray(DB.attendance) ? DB.attendance : [];
}

function hrProduction() {
  return Array.isArray(DB.productionOrders)
    ? DB.productionOrders
    : [];
}

function hrOrders() {
  return Array.isArray(DB.orders) ? DB.orders : [];
}


/* ============================================================
 * DỮ LIỆU TỔNG HỢP
 * ========================================================== */

function hrEmpAttendance(e) {
  return hrAttendance().find(a => a.empId === e.id) || {};
}

function hrEmpProduction(e) {

  const stages = hrProduction().flatMap(p =>
    (p.stages || [])
      .filter(s => s.leadId === e.id)
      .map(s => ({
        po: p,
        s
      }))
  );

  const plan = stages.reduce(
    (n, x) => n + hrNum(x.s.qtyPlan),
    0
  );

  const done = stages.reduce(
    (n, x) => n + hrNum(x.s.qtyDone),
    0
  );

  return {
    stages,
    plan,
    done,
    rate: plan
      ? Math.min(100, done / plan * 100)
      : 0
  };
}


function hrEmpSales(e) {

  return hrOrders()
    .filter(o =>
      o.salesPersonId === e.id ||
      o.employeeId === e.id ||
      o.createdByEmpId === e.id
    )
    .reduce(
      (n, o) =>
        n +
        hrNum(
          o.total ||
          o.grandTotal ||
          o.amount ||
          o.value
        ),
      0
    );
}


/* ============================================================
 * KPI
 * ========================================================== */

function hrKpiScore(e) {

  const a = hrEmpAttendance(e);
  const p = hrEmpProduction(e);

  const attendanceRate =
    hrNum(
      a.rate ||
      (
        a.standard
          ? a.worked / a.standard * 100
          : 0
      )
    );

  const productivityRate =
    p.rate;

  const sales =
    hrEmpSales(e);

  /*
   * Có thể thay 100.000.000 bằng chỉ tiêu
   * doanh số thực tế của từng nhân viên.
   */
  const salesScore =
    sales
      ? Math.min(
          120,
          sales / 100000000 * 100
        )
      : 0;

  /*
   * Trọng số KPI:
   * - Chuyên cần: 25%
   * - Năng suất: 45%
   * - Doanh số: 30%
   */

  const score =
    (
      attendanceRate * 0.25 +
      productivityRate * 0.45 +
      salesScore * 0.30
    );

  return {

    attendanceRate,

    productivityRate,

    sales,

    score:
      Math.min(
        120,
        Math.round(score * 10) / 10
      )

  };
}


function hrGrade(score) {

  if (score >= 100) {
    return [
      'Xuất sắc',
      'green'
    ];
  }

  if (score >= 85) {
    return [
      'Tốt',
      'blue'
    ];
  }

  if (score >= 70) {
    return [
      'Đạt',
      'orange'
    ];
  }

  return [
    'Cần cải thiện',
    'red'
  ];
}


/* ============================================================
 * THANH ĐIỀU HƯỚNG HR
 * ========================================================== */

function hrTabHead(
  title,
  desc,
  active
) {

  const tabs = [

    ['attendance', 'Hồ sơ nhân sự & Chấm công'],

    ['shifts', 'Phân ca'],

    ['kpi', 'KPI'],

    ['evaluations', 'Đánh giá hiệu quả'],

    ['payroll', 'Tính lương']

  ];

  return `

    ${pageHead(
      title,
      desc,
      `
        <button
          class="btn"
          data-act="export-hr"
        >
          <i class="fa-solid fa-file-export"></i>
          Export
        </button>
      `
    )}

    <div
      class="card"
      style="margin-bottom:14px"
    >

    </div>

  `;
}


/* ============================================================
 * PHÂN CA
 * ========================================================== */

Views.hrShifts = function () {

  const f = F(
    'shifts',
    {
      q: '',
      dept: '',
      shift: 'all'
    }
  );

  const q =
    String(f.q || '')
      .toLowerCase()
      .trim();

  const shifts = [

    'Ca sáng',
    'Ca chiều',
    'Ca đêm',
    'Hành chính'

  ];

  const list =
    hrEmployees()
      .filter(e => {

        if (
          f.dept &&
          e.dept !== f.dept
        ) {
          return false;
        }

        const shift =
          e.shift ||
          e.workShift ||
          (
            e.position &&
            /quản lý|kế toán|nhân sự/i
              .test(e.position)
              ? 'Hành chính'
              : 'Ca sáng'
          );

        if (
          f.shift !== 'all' &&
          f.shift &&
          shift !== f.shift
        ) {
          return false;
        }

        return !q ||
          [
            e.id,
            e.name,
            e.dept,
            e.position,
            shift
          ].some(v =>
            String(v || '')
              .toLowerCase()
              .includes(q)
          );

      });

  const counts =
    Object.fromEntries(
      shifts.map(x => [
        x,
        list.filter(
          e =>
            (
              e.shift ||
              e.workShift ||
              'Ca sáng'
            ) === x
        ).length
      ])
    );

  const times = {

    'Ca sáng':
      '06:00 – 14:00',

    'Ca chiều':
      '14:00 – 22:00',

    'Ca đêm':
      '22:00 – 06:00',

    'Hành chính':
      '08:00 – 17:00'

  };

  const rows =
    list.map(e => {

      const shift =
        e.shift ||
        e.workShift ||
        (
          e.position &&
          /quản lý|kế toán|nhân sự/i
            .test(e.position)
            ? 'Hành chính'
            : 'Ca sáng'
        );

      return `

        <tr>

          <td>
            <span class="code">
              ${esc(e.id)}
            </span>
          </td>

          <td>
            ${cell2(
              esc(e.name),
              esc(e.position || '')
            )}
          </td>

          <td>
            ${esc(e.dept || '—')}
          </td>

          <td>
            <span class="chip">
              ${esc(shift)}
            </span>
          </td>

          <td>
            ${times[shift] || '—'}
          </td>

          <td>
            ${badge(e.status)}
          </td>

        </tr>

      `;

    });

  return `

    ${hrTabHead(
      'Phân ca',
      'Quản lý ca làm việc theo nhân sự và phòng ban',
      'shifts'
    )}

    <div
      class="grid g-auto-sm"
      style="margin-bottom:14px"
    >

      ${
        shifts.map(
          (x, i) =>
            mkpi(
              x,
              counts[x] || 0,
              [
                'fa-sun',
                'fa-cloud-sun',
                'fa-moon',
                'fa-building'
              ][i],
              'blue'
            )
        ).join('')
      }

    </div>

    <div class="card">

      <div class="toolbar">

        ${searchBox(
          'shifts',
          'Tìm mã NV, họ tên…'
        )}

        ${selectFilter(
          'shifts',
          'dept',
          DB.departments.map(
            d => [d, d]
          ),
          'Tất cả phòng ban'
        )}

        ${selectFilter(
          'shifts',
          'shift',
          shifts.map(
            x => [x, x]
          ),
          'Tất cả ca'
        )}

      </div>

      ${tableShell(

        [
          { t: 'Mã NV' },
          { t: 'Nhân sự' },
          { t: 'Phòng ban' },
          { t: 'Ca làm việc' },
          { t: 'Khung giờ' },
          { t: 'Trạng thái' }
        ],

        rows,

        {
          emptyTitle:
            'Không có nhân sự'
        }

      )}

    </div>

  `;
};


/* ============================================================
 * KPI
 * ========================================================== */

Views.hrKPI = function () {

  const employees =
    hrEmployees();

  const rows =
    employees.map(e => {

      const k =
        hrKpiScore(e);

      const [
        grade,
        tone
      ] =
        hrGrade(k.score);

      return `

        <tr>

          <td>
            <span class="code">
              ${esc(e.id)}
            </span>
          </td>

          <td>
            ${cell2(
              esc(e.name),
              esc(e.position || '')
            )}
          </td>

          <td>
            ${esc(e.dept || '—')}
          </td>

          <td class="num">
            ${
              Math.round(
                k.attendanceRate * 10
              ) / 10
            }%
          </td>

          <td class="num">
            ${
              Math.round(
                k.productivityRate * 10
              ) / 10
            }%
          </td>

          <td class="num">
            ${fmtVND(k.sales)}
          </td>

          <td class="num strong">
            ${k.score}
          </td>

          <td>
            <span class="badge ${tone}">
              ${grade}
            </span>
          </td>

        </tr>

      `;

    });

  const scores =
    employees.map(
      e => hrKpiScore(e).score
    );

  const avg =
    scores.length
      ? Math.round(
          scores.reduce(
            (a, b) => a + b,
            0
          ) /
          scores.length *
          10
        ) / 10
      : 0;

  return `

    ${hrTabHead(
      'KPI nhân sự',
      'Theo dõi mức độ hoàn thành KPI theo chuyên cần, năng suất và doanh số',
      'kpi'
    )}

    <div
      class="grid g-auto-sm"
      style="margin-bottom:14px"
    >

      ${mkpi(
        'KPI bình quân',
        avg,
        'fa-gauge-high',
        'indigo'
      )}

      ${mkpi(
        'Đạt từ 85 điểm',
        scores.filter(
          x => x >= 85
        ).length,
        'fa-circle-check',
        'green'
      )}

      ${mkpi(
        'Cần cải thiện',
        scores.filter(
          x => x < 70
        ).length,
        'fa-triangle-exclamation',
        'red'
      )}

      ${mkpi(
        'Nhân sự đánh giá',
        scores.length,
        'fa-users',
        'blue'
      )}

    </div>

    <div class="card">

      <div class="toolbar">

        ${searchBox(
          'kpi',
          'Tìm mã NV, họ tên…'
        )}

        <span class="spacer"></span>

        <span class="chip">
          Trọng số:
          Chuyên cần 25%
          · Năng suất 45%
          · Doanh số 30%
        </span>

      </div>

      ${tableShell(

        [
          { t: 'Mã NV' },
          { t: 'Nhân sự' },
          { t: 'Phòng ban' },
          { t: 'Chuyên cần' },
          { t: 'Năng suất' },
          { t: 'Doanh số' },
          { t: 'Điểm KPI' },
          { t: 'Xếp loại' }
        ],

        rows,

        {
          emptyTitle:
            'Chưa có dữ liệu KPI'
        }

      )}

    </div>

  `;
};


/* ============================================================
 * ĐÁNH GIÁ HIỆU QUẢ
 * ========================================================== */

Views.hrevaluations = function () {

  const rows =
    hrEmployees().map(e => {

      const k =
        hrKpiScore(e);

      const [
        grade,
        tone
      ] =
        hrGrade(k.score);

      const p =
        hrEmpProduction(e);

      return `

        <tr>

          <td>
            <span class="code">
              ${esc(e.id)}
            </span>
          </td>

          <td>
            ${cell2(
              esc(e.name),
              esc(e.position || '')
            )}
          </td>

          <td>
            ${esc(e.dept || '—')}
          </td>

          <td class="num">
            ${k.score}
          </td>

          <td>
            ${progressBar(
              Math.min(
                100,
                k.score
              )
            )}
          </td>

          <td class="num">
            ${fmtN(p.done)}
            /
            ${fmtN(p.plan)}
          </td>

          <td>
            <span class="badge ${tone}">
              ${grade}
            </span>
          </td>

          <td>

            ${rowActions([
              {
                act:
                  'open-employee',

                data:
                  `data-id="${e.id}"`,

                icon:
                  'fa-eye',

                title:
                  'Xem hồ sơ'
              }
            ])}

          </td>

        </tr>

      `;

    });

  return `

    ${hrTabHead(
      'Đánh giá hiệu quả',
      'Đánh giá định kỳ dựa trên KPI và kết quả thực hiện công việc',
      'evaluations'
    )}

    <div
      class="card"
      style="margin-bottom:14px"
    >

      <div class="card-head">

        <div>

          <h3>
            Tiêu chí đánh giá
          </h3>

          <p>
            Chuyên cần · Năng suất ·
            Doanh số · Mức độ hoàn thành công việc
          </p>

        </div>

      </div>

      <div class="card-body">

        <div class="grid g-2">

          ${infoItem(
            'KPI tổng hợp',
            '25% chuyên cần + 45% năng suất + 30% doanh số'
          )}

          ${infoItem(
            'Xếp loại',
            '≥100 Xuất sắc · 85–99 Tốt · 70–84 Đạt · <70 Cần cải thiện'
          )}

        </div>

      </div>

    </div>

    <div class="card">

      ${tableShell(

        [
          { t: 'Mã NV' },
          { t: 'Nhân sự' },
          { t: 'Phòng ban' },
          { t: 'Điểm' },
          { t: 'Tiến độ' },
          { t: 'Sản lượng' },
          { t: 'Xếp loại' },
          { t: 'Thao tác' }
        ],

        rows,

        {
          emptyTitle:
            'Chưa có dữ liệu đánh giá'
        }

      )}

    </div>

  `;
};


/* ============================================================
 * TÍNH LƯƠNG
 * ========================================================== */

function hrPayrollRow(
  e,
  mode
) {

  const a =
    hrEmpAttendance(e);

  const k =
    hrKpiScore(e);

  const p =
    hrEmpProduction(e);

  const standard =
    hrNum(a.standard) || 26;

  const worked =
    hrNum(a.worked);

  const ot =
    hrNum(a.ot);

  const base =
    hrNum(e.salary);

  let total =
    base;

  let basis =
    '';

  /* --------------------------------
   * 1. THEO THỜI GIAN
   * -------------------------------- */

  if (mode === 'time') {

    total =
      standard
        ? (
            base *
            worked /
            standard
          ) +
          (
            base /
            standard /
            8
          ) *
          ot *
          1.5

        : base;

    basis =
      `${worked}/${standard} công + ${ot}h OT`;

  }

  /* --------------------------------
   * 2. THEO SẢN LƯỢNG
   * -------------------------------- */

  else if (
    mode === 'quantity'
  ) {

    const unit =
      hrNum(
        e.unitPrice ||
        e.productUnitPrice ||
        e.pieceRate
      );

    total =
      unit
        ? p.done * unit
        : base *
          Math.min(
            1.2,
            p.rate / 100
          );

    basis =
      `${fmtN(p.done)} sản lượng`;

  }

  /* --------------------------------
   * 3. THEO DOANH SỐ
   * -------------------------------- */

  else if (
    mode === 'sales'
  ) {

    const rate =
      hrNum(
        e.commissionRate ||
        e.salesRate
      ) || 0.01;

    total =
      base +
      k.sales * rate;

    basis =
      `${fmtVND(k.sales)} × ${(rate * 100).toFixed(2)}%`;

  }

  /* --------------------------------
   * 4. THEO KPI
   * -------------------------------- */

  else if (
    mode === 'kpi'
  ) {

    total =
      base *
      (
        0.7 +
        Math.min(
          1.3,
          Math.max(
            0,
            k.score
          ) / 100
        ) *
        0.3
      );

    basis =
      `${k.score} điểm KPI`;

  }

  return {

    e,

    base,

    total,

    basis

  };

}


Views.payroll = function () {

  const f =
    F(
      'payroll',
      {
        month:
          '2026-08',

        mode:
          'time',

        dept:
          ''
      }
    );

  const modeLabels = {

    time:
      'Theo thời gian',

    quantity:
      'Theo sản lượng',

    sales:
      'Theo doanh số',

    kpi:
      'Theo KPI'

  };

  const data =
    hrEmployees()

      .filter(e =>
        !f.dept ||
        e.dept === f.dept
      )

      .map(e =>
        hrPayrollRow(
          e,
          f.mode || 'time'
        )
      );

  const total =
    data.reduce(
      (n, x) =>
        n + x.total,
      0
    );

  const avg =
    data.length
      ? total / data.length
      : 0;

  const rows =
    data.map(x => `

      <tr>

        <td>
          <span class="code">
            ${esc(x.e.id)}
          </span>
        </td>

        <td>
          ${cell2(
            esc(x.e.name),
            esc(x.e.position || '')
          )}
        </td>

        <td>
          ${esc(x.e.dept || '—')}
        </td>

        <td class="num">
          ${fmtVND(x.base)}
        </td>

        <td>
          ${esc(x.basis)}
        </td>

        <td class="num strong">
          ${fmtVND(x.total)}
        </td>

      </tr>

    `);

  return `

    ${hrTabHead(
      'Tính lương',
      'Tính lương theo thời gian, sản lượng, doanh số hoặc KPI',
      'payroll'
    )}

    <div
      class="card"
      style="margin-bottom:14px"
    >

      <div class="toolbar">

        <input
          class="inp"
          type="month"
          data-f="payroll.month"
          value="${esc(f.month)}"
          style="width:150px"
        />

        <select
          class="inp"
          data-f="payroll.mode"
          style="width:190px"
        >

          ${
            Object.entries(
              modeLabels
            )
            .map(
              ([v, l]) => `

                <option
                  value="${v}"
                  ${
                    f.mode === v
                      ? 'selected'
                      : ''
                  }
                >
                  ${l}
                </option>

              `
            )
            .join('')
          }

        </select>

        ${selectFilter(
          'payroll',
          'dept',
          DB.departments.map(
            d => [d, d]
          ),
          'Tất cả phòng ban'
        )}

        <span class="spacer"></span>

        <button
          class="btn btn-primary"
          data-act="export-hr"
        >
          <i class="fa-solid fa-file-export"></i>
          Xuất bảng lương
        </button>

      </div>

    </div>


    <div
      class="grid g-auto-sm"
      style="margin-bottom:14px"
    >

      ${mkpi(
        'Tổng quỹ lương',
        fmtVND(total),
        'fa-money-check-dollar',
        'indigo'
      )}

      ${mkpi(
        'Bình quân/NV',
        fmtVND(avg),
        'fa-calculator',
        'blue'
      )}

      ${mkpi(
        'Số nhân sự',
        data.length,
        'fa-users',
        'green'
      )}

      ${mkpi(
        'Phương pháp',
        modeLabels[f.mode] ||
          modeLabels.time,
        'fa-scale-balanced',
        'orange'
      )}

    </div>


    <div class="card">

      ${tableShell(

        [
          { t: 'Mã NV' },
          { t: 'Nhân sự' },
          { t: 'Phòng ban' },
          { t: 'Lương cơ bản' },
          { t: 'Căn cứ tính' },
          { t: 'Thực lĩnh dự kiến' }
        ],

        rows,

        {
          emptyTitle:
            'Không có dữ liệu tính lương'
        }

      )}

    </div>

  `;
};

