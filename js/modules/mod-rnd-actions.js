/* ============================================================================
 * ACTIONS CHO PHÂN HỆ R&D
 * ----------------------------------------------------------------------------
 * File này PHẢI được nạp SAU js/app.js (Actions là const khai báo trong app.js,
 * ở đây chỉ gán thêm thuộc tính vào object đó — giống cách app.js tự làm với
 * các action 'pf-plan-*' ở cuối file của nó).
 * ==========================================================================*/

/* ------------------------------------------------------------ DỰ ÁN R&D */
Actions['rnd-project-new'] = () => {
  Modal.open({
    title: 'Tạo dự án R&D mới', size: 'md',
    body: `<div class="form-grid">
        <div class="field" style="grid-column:1/-1"><label>Tên dự án *</label><input class="inp" id="rndPName" placeholder="VD: Đậu hủ vị matcha"></div>
        <div class="field"><label>Danh mục</label><select class="inp" id="rndPCategory">${RND_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label>Phụ trách</label><select class="inp" id="rndPOwner">${rndEmployeeOptions('NV-002')}</select></div>
        <div class="field"><label>Ngày bắt đầu</label><input class="inp" type="date" id="rndPStart" value="${currentDateYMD()}"></div>
        <div class="field"><label>Ngày dự kiến tung SP</label><input class="inp" type="date" id="rndPTarget" value="${addDays(currentDateYMD(), 90)}"></div>
        <div class="field" style="grid-column:1/-1"><label>Ngân sách dự kiến (VNĐ)</label><input class="inp right num" type="number" min="0" id="rndPBudget" value="30000000"></div>
        <div class="field" style="grid-column:1/-1"><label>Ghi chú / mục tiêu</label><textarea class="inp" id="rndPNote" rows="2"></textarea></div>
      </div>`,
    foot: '<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="rnd-project-save"><i class="fa-solid fa-floppy-disk"></i>Tạo dự án</button>',
  });
};
Actions['rnd-project-edit'] = (d) => {
  const p = rndProject(d.id); if (!p) return;
  confirmBox({
    title: 'Sửa dự án nghiên cứu',
    icon: 'fa-pen',
    okText: 'Tiếp tục sửa',
    message: `
      <div style="line-height:1.6">
        Bạn đang sửa dự án
        <b>${esc(p.id)} · ${esc(p.name)}</b>.
        <br><br>
        <span style="color:var(--orange);font-weight:700">
          <i class="fa-solid fa-triangle-exclamation"></i>
          Sau khi sửa thì dự án sẽ đếm ngày lại từ đầu.
        </span>
      </div>
    `,
    onOk: () => {
  	  Modal.open({
		title: `Sửa dự án · ${p.id}`, size: 'md',
		body: `<div class="form-grid">
			<div class="field" style="grid-column:1/-1"><label>Tên dự án *</label><input class="inp" id="rndPName" value="${esc(p.name)}"></div>
			<div class="field"><label>Danh mục</label><select class="inp" id="rndPCategory">${RND_CATEGORIES.map((c) => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
			<div class="field"><label>Phụ trách</label><select class="inp" id="rndPOwner">${rndEmployeeOptions(p.ownerId)}</select></div>
			<div class="field"><label>Ngày bắt đầu</label><input class="inp" type="date" id="rndPStart" value="${esc(p.startDate)}"></div>
			<div class="field"><label>Ngày dự kiến tung SP</label><input class="inp" type="date" id="rndPTarget" value="${esc(p.targetLaunchDate)}"></div>
			<div class="field" style="grid-column:1/-1"><label>Ngân sách dự kiến (VNĐ)</label><input class="inp right num" type="number" min="0" id="rndPBudget" value="${Number(p.budget) || 0}"></div>
			<div class="field" style="grid-column:1/-1"><label>Ghi chú / mục tiêu</label><textarea class="inp" id="rndPNote" rows="2">${esc(p.note || '')}</textarea></div>
		</div>`,
		foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="rnd-project-save" data-id="${p.id}"><i class="fa-solid fa-floppy-disk"></i>Lưu thay đổi</button>`,
  	  });
	},
  });
};
Actions['rnd-project-save'] = (d) => {
  const name = $('#rndPName')?.value.trim() || '';
  if (!name) { Toast.err('Thiếu tên dự án', 'Vui lòng nhập tên dự án R&D.'); return; }
  const startDate = $('#rndPStart')?.value || currentDateYMD();
  const targetLaunchDate = $('#rndPTarget')?.value || addDays(startDate, 90);
  if (targetLaunchDate < startDate) { Toast.err('Ngày không hợp lệ', 'Ngày dự kiến tung sản phẩm phải sau ngày bắt đầu.'); return; }
  const payload = {
    name, category: $('#rndPCategory')?.value || RND_CATEGORIES[0], ownerId: $('#rndPOwner')?.value || 'NV-001',
    startDate, targetLaunchDate, budget: Number($('#rndPBudget')?.value) || 0, note: $('#rndPNote')?.value.trim() || '',
  };
  if (d.id) {
	const project = rndProject(d.id);
	if (!project) return;
	/*
	* Sửa dự án = khởi động lại bộ đếm thời gian phát triển.
	* Ngày bắt đầu mới chính là ngày được nhập trong form.
	*/
	Object.assign(project, payload, {
	  startDate,
	});
	Toast.ok('Đã cập nhật dự án',`${d.id} · ${name} — thời gian phát triển được tính lại từ ${fmtDate(startDate)}`);
  } else {
    const id = nextCode('RND-2026-', DB.rndProjects);
    DB.rndProjects.unshift({ id, ...payload, stage: 'CONCEPT', status: 'ACTIVE', actualLaunchDate: '' });
    DB.rndApprovals.unshift({ id: nextCode('DUYET-2026-', DB.rndApprovals), projectId: id, stage: 'CONCEPT', status: 'PENDING', approverId: '', date: currentDateYMD(), note: 'Chờ duyệt ý tưởng ban đầu.' });
    if (typeof RNDApi !== 'undefined') RNDApi.scheduleSync(['rndProjects', 'rndApprovals']);
    Toast.ok('Đã tạo dự án R&D', `${id} · ${name}`);
  }
  if (d.id && typeof RNDApi !== 'undefined') RNDApi.scheduleSync(['rndProjects']);
  Modal.close(); go('rnd', { tab: 'projects' });
};
Actions['rnd-project-delete'] = (d) => {
  const p = rndProject(d.id); if (!p) return;
  const hasData = rndFormulasOfProject(p.id).length || rndTrialsOfProject(p.id).length || rndCostsOfProject(p.id).length;
  if (hasData) { Toast.err('Không thể xóa dự án', 'Dự án đã có công thức/thử nghiệm/chi phí liên quan. Hãy chuyển trạng thái Tạm dừng hoặc Dừng dự án thay vì xóa.'); return; }
  confirmBox({
    title: 'Xóa dự án R&D', icon: 'fa-trash', okText: 'Xóa dự án',
    message: `Xóa dự án <b>${esc(p.id)} · ${esc(p.name)}</b>?`,
    onOk: () => {
      const removedApprovalIds = DB.rndApprovals.filter((a) => a.projectId === p.id).map((a) => a.id);
      DB.rndProjects = DB.rndProjects.filter((x) => x.id !== p.id);
      DB.rndApprovals = DB.rndApprovals.filter((a) => a.projectId !== p.id);
      if (typeof RNDApi !== 'undefined') {
        RNDApi.remove('rndProjects', [p.id]).catch(() => {});
        if (removedApprovalIds.length) RNDApi.remove('rndApprovals', removedApprovalIds).catch(() => {});
      }
      render();
      Toast.ok('Đã xóa dự án', p.id);
    },
  });
};
Actions['rnd-project-view'] = (d) => {
  const p = rndProject(d.id); if (!p) return;
  const formulas = rndFormulasOfProject(p.id);
  const trials = rndTrialsOfProject(p.id);
  const costs = rndCostsOfProject(p.id);
  const approvals = rndApprovalsOfProject(p.id);
  Modal.open({
    title: `${p.id} — ${esc(p.name)}`, size: 'xl',
    sub: `${esc(p.category)} · Phụ trách ${esc(Q.employeeName(p.ownerId))}`,
    body: `
      <div class="info-grid" style="margin-bottom:16px">
        ${infoItem('Giai đoạn hiện tại', esc(RND_STAGE_LABEL[p.stage] || p.stage))}
        ${infoItem('Trạng thái', rndBadge(RND_PROJECT_STATUS, p.status))}
        ${infoItem('Ngày bắt đầu', fmtDate(p.startDate))}
        ${infoItem('Dự kiến tung SP', fmtDate(p.targetLaunchDate))}
        ${infoItem('Ngày tung SP thực tế', p.actualLaunchDate ? fmtDate(p.actualLaunchDate) : '—')}
        ${infoItem('Thời gian phát triển', rndProjectDevDays(p) + ' ngày')}
        ${infoItem('Ngân sách', fmtVND(p.budget))}
        ${infoItem('Chi phí thực tế', fmtVND(rndProjectCostTotal(p.id)))}
      </div>
      <div class="field"><label>Ghi chú / mục tiêu</label><div class="inp" style="height:auto;min-height:40px">${esc(p.note || '—')}</div></div>

      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-flask"></i>Công thức (${formulas.length})</div>
      ${tableShell([{ t: 'Mã CT' }, { t: 'Tên công thức' }, { t: 'Phiên bản hiện tại' }, { t: 'Trạng thái' }],
        formulas.map((fm) => { const cur = rndVersionsOfFormula(fm.id).find((v) => v.version === fm.currentVersion);
          return `<tr><td><span class="code">${fm.id}</span></td><td>${esc(fm.name)}</td><td>${esc(fm.currentVersion)}</td><td>${rndBadge(RND_VERSION_STATUS, cur?.status)}</td></tr>`; }),
        { emptyTitle: 'Chưa có công thức' })}

      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-vial"></i>Thử nghiệm gần đây (${trials.length})</div>
      ${tableShell([{ t: 'Mã TN' }, { t: 'Ngày' }, { t: 'Kết quả' }, { t: 'Cảm quan' }, { t: 'Chi phí' }],
        trials.slice(0, 5).map((t) => `<tr><td><span class="code">${t.id}</span></td><td>${fmtDate(t.date)}</td><td>${rndBadge(RND_TRIAL_RESULT, t.result)}</td><td class="right num">${fmtDec(t.sensoryScore, 1)}/10</td><td class="right num">${fmtVND(t.costActual)}</td></tr>`),
        { emptyTitle: 'Chưa có thử nghiệm' })}

      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-route"></i>Quy trình duyệt</div>
      ${tableShell([{ t: 'Giai đoạn' }, { t: 'Trạng thái' }, { t: 'Ngày' }, { t: 'Ghi chú' }],
        approvals.map((a) => `<tr><td>${esc(RND_STAGE_LABEL[a.stage] || a.stage)}</td><td>${rndBadge(RND_APPROVAL_STATUS, a.status)}</td><td>${fmtDate(a.date)}</td><td>${esc(a.note || '—')}</td></tr>`),
        { emptyTitle: 'Chưa có lượt duyệt' })}
    `,
    foot: `<button class="btn" data-act="modal-close">Đóng</button>
           <button class="btn" data-act="rnd-project-edit" data-id="${p.id}"><i class="fa-solid fa-pen"></i>Sửa dự án</button>
           <button class="btn btn-primary" data-act="nav" data-id="rnd" data-tab="npd"><i class="fa-solid fa-route"></i>Xem quy trình duyệt</button>`,
  });
};

/* -------------------------------------------------------------- CÔNG THỨC */
Actions['rnd-formula-new'] = () => {
  Modal.open({
    title: 'Tạo công thức mới', size: 'md',
    body: `<div class="form-grid">
        <div class="field" style="grid-column:1/-1"><label>Dự án *</label><select class="inp" id="rndFProject">${rndProjectOptions('')}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Tên công thức *</label><input class="inp" id="rndFName" placeholder="VD: Đậu hủ vị matcha — CT gốc"></div>
        <div class="field" style="grid-column:1/-1"><label>Sản phẩm tham chiếu (nếu cải tiến từ SP hiện có)</label>
          <select class="inp" id="rndFBaseProduct"><option value="">-- Không có --</option>${DB.products.map((p) => `<option value="${esc(p.id)}">${esc(p.id)} — ${esc(p.name)}</option>`).join('')}</select></div>
      </div>`,
    foot: '<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="rnd-formula-save"><i class="fa-solid fa-floppy-disk"></i>Tạo công thức</button>',
  });
};
Actions['rnd-formula-save'] = () => {
  const projectId = $('#rndFProject')?.value || '';
  const name = $('#rndFName')?.value.trim() || '';
  if (!projectId || !name) { Toast.err('Thiếu thông tin', 'Vui lòng chọn dự án và nhập tên công thức.'); return; }
  const id = nextCode('CT-', DB.rndFormulas, 3);
  DB.rndFormulas.unshift({ id, projectId, name, baseProductId: $('#rndFBaseProduct')?.value || '', currentVersion: '', status: 'DRAFT' });
  if (typeof RNDApi !== 'undefined') RNDApi.scheduleSync(['rndFormulas']);
  Modal.close();
  Toast.ok('Đã tạo công thức', `${id} · ${name} — hãy thêm phiên bản đầu tiên.`);
  Actions['rnd-version-new']({ formulaid: id });
};

/* -------------------------------------------------------- PHIÊN BẢN CT */
function rndVersionIngredientRow(materialId, qty) {
  return `<div class="rnd-ver-ing-line" style="display:grid;grid-template-columns:1fr 130px 36px;gap:8px;margin-bottom:8px">
      <select class="inp" name="material">${DB.materials.map((m) => `<option value="${esc(m.id)}" ${m.id === materialId ? 'selected' : ''}>${esc(m.id)} — ${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select>
      <input class="inp right num" name="qty" type="number" min="0" step="0.001" value="${Number(qty) || 0}">
      <button class="btn btn-sm" type="button" data-act="rnd-version-remove-line" data-kind="ing"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}
function rndVersionOperationRow(operationId, hoursPer) {
  return `<div class="rnd-ver-op-line" style="display:grid;grid-template-columns:1fr 130px 36px;gap:8px;margin-bottom:8px">
      <select class="inp" name="operation">${DB.operations.map((o) => `<option value="${esc(o.id)}" ${o.id === operationId ? 'selected' : ''}>${esc(o.id)} — ${esc(o.name)}</option>`).join('')}</select>
      <input class="inp right num" name="hours" type="number" min="0" step="0.001" value="${Number(hoursPer) || 0}">
      <button class="btn btn-sm" type="button" data-act="rnd-version-remove-line" data-kind="op"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}
Actions['rnd-version-new'] = (d) => {
  const fm = rndFormula(d.formulaid); if (!fm) return;
  const last = rndVersionsOfFormula(fm.id).slice(-1)[0];
  Modal.open({
    title: `Thêm phiên bản mới · ${fm.name}`, size: 'lg',
    sub: 'Kế thừa nguyên liệu/công đoạn của phiên bản gần nhất (nếu có), có thể chỉnh sửa trước khi lưu',
    body: `
      <div class="form-grid">
        <div class="field"><label>Ngày thử nghiệm</label><input class="inp" type="date" id="rndVDate" value="${currentDateYMD()}"></div>
        <div class="field"><label>Người thực hiện</label><select class="inp" id="rndVAuthor">${rndEmployeeOptions('NV-007')}</select></div>
        <div class="field"><label>Sản lượng mẻ</label><input class="inp right num" type="number" min="1" id="rndVYieldQty" value="${last?.yieldQty || 100}"></div>
        <div class="field"><label>Đơn vị</label><input class="inp" id="rndVYieldUnit" value="${esc(last?.yieldUnit || 'Hộp')}"></div>
        <div class="field"><label>Điểm cảm quan (0–10)</label><input class="inp right num" type="number" min="0" max="10" step="0.1" id="rndVSensory" value="0"></div>
        <div class="field"><label>Trạng thái</label><select class="inp" id="rndVStatus">${Object.entries(RND_VERSION_STATUS).map(([k, v]) => `<option value="${k}" ${k === 'DRAFT' ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-leaf"></i>Nguyên liệu (định mức cho cả mẻ)</div>
      <div id="rndVerIngredients">${(last?.ingredients || [{ materialId: DB.materials[0]?.id, qty: 1 }]).map((i) => rndVersionIngredientRow(i.materialId, i.qty)).join('')}</div>
      <button class="btn btn-sm" type="button" data-act="rnd-version-add-line" data-kind="ing"><i class="fa-solid fa-plus"></i>Thêm nguyên liệu</button>

      <div class="form-sec-title" style="margin-top:16px"><i class="fa-solid fa-gears"></i>Công đoạn (giờ công cho cả mẻ)</div>
      <div id="rndVerOperations">${(last?.operations || [{ operationId: DB.operations[0]?.id, hoursPer: 0.01 }]).map((o) => rndVersionOperationRow(o.operationId, o.hoursPer)).join('')}</div>
      <button class="btn btn-sm" type="button" data-act="rnd-version-add-line" data-kind="op"><i class="fa-solid fa-plus"></i>Thêm công đoạn</button>

      <div class="field" style="margin-top:16px"><label>Ghi chú</label><textarea class="inp" id="rndVNote" rows="2" placeholder="Nhận xét về kết cấu, vị, màu sắc…"></textarea></div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="rnd-version-save" data-formulaid="${fm.id}"><i class="fa-solid fa-floppy-disk"></i>Lưu phiên bản</button>`,
  });
};
/* -------------------------------------------------------- SỬA PHIÊN BẢN CT */
Actions['rnd-version-edit'] = (d) => {
  const v = rndFormulaVersion(d.id);
  if (!v) return;

  const fm = rndFormula(v.formulaId);
  if (!fm) return;

  Modal.open({
    title: `Sửa chi tiết công thức thử nghiệm · ${v.id}`,
    size: 'md',
    sub: `${fm.name} · ${v.version}`,
    body: `
      <div class="form-grid">

        <div class="field">
          <label>Sản lượng mẻ *</label>
          <input
            class="inp right num"
            type="number"
            min="1"
            step="1"
            id="rndVEYieldQty"
            value="${Number(v.yieldQty) || 1}"
          >
        </div>

        <div class="field">
          <label>Đơn vị</label>
          <input
            class="inp"
            id="rndVEYieldUnit"
            value="${esc(v.yieldUnit || 'Đơn vị')}"
          >
        </div>

        <div class="field">
          <label>Giá thành/đv</label>
          <input
            class="inp right num"
            type="text"
            value="${fmtVND(rndVersionUnitCost(v))}"
            readonly
            style="background:var(--bg-soft);font-weight:700"
          >
          <div class="cell-sub">
            Giá thành được tính tự động theo định mức nguyên liệu,
            công đoạn và sản lượng mẻ.
          </div>
        </div>

        <div class="field">
          <label>Cảm quan (0–10) *</label>
          <input
            class="inp right num"
            type="number"
            min="0"
            max="10"
            step="0.1"
            id="rndVESensory"
            value="${Math.min(10, Math.max(0, Number(v.sensoryScore) || 0))}"
          >
        </div>

        <div class="field" style="grid-column:1/-1">
          <label>Trạng thái</label>
          <select class="inp" id="rndVEStatus">
            ${Object.entries(RND_VERSION_STATUS).map(([k, s]) =>
              `<option value="${k}" ${k === v.status ? 'selected' : ''}>${esc(s.label)}</option>`
            ).join('')}
          </select>
        </div>

      </div>

      <div style="
        margin-top:14px;
        padding:10px 12px;
        border-radius:8px;
        background:var(--bg-soft);
        font-size:13px;
        color:var(--text-muted);
      ">
        <i class="fa-solid fa-circle-info"></i>
        Chỉ sửa các thông tin chi tiết của phiên bản hiện tại.
        Mã phiên bản và ngày thử nghiệm được giữ nguyên.
      </div>
    `,
    foot: `
      <button class="btn" data-act="modal-close">Hủy</button>
      <button
        class="btn btn-primary"
        data-act="rnd-version-edit-save"
        data-id="${v.id}"
      >
        <i class="fa-solid fa-floppy-disk"></i>
        Lưu thay đổi
      </button>
    `,
  });

  /* Khóa điểm cảm quan tuyệt đối trong khoảng 0–10 */
  const sensoryInput = $('#rndVESensory');

  if (sensoryInput) {
    sensoryInput.addEventListener('input', () => {
      let value = Number(sensoryInput.value);

      if (!Number.isFinite(value)) {
        sensoryInput.value = '';
        return;
      }

      if (value < 0) sensoryInput.value = 0;
      if (value > 10) sensoryInput.value = 10;
    });

    sensoryInput.addEventListener('blur', () => {
      let value = Number(sensoryInput.value);

      if (!Number.isFinite(value)) value = 0;
      value = Math.min(10, Math.max(0, value));

      sensoryInput.value = value;
    });
  }
};
Actions['rnd-version-edit-save'] = (d) => {
  const v = rndFormulaVersion(d.id);
  if (!v) return;
  const fm = rndFormula(v.formulaId);
  if (!fm) return;
  const yieldQty = Number($('#rndVEYieldQty')?.value);
  const yieldUnit = $('#rndVEYieldUnit')?.value.trim() || 'Đơn vị';
  let sensoryScore = Number($('#rndVESensory')?.value);
  /* Không cho phép điểm cảm quan ngoài 0–10 */
  if (!Number.isFinite(sensoryScore)) sensoryScore = 0;
  sensoryScore = Math.min(10, Math.max(0, sensoryScore));
  if (!Number.isFinite(yieldQty) || yieldQty <= 0) {
    Toast.err(
      'Sản lượng không hợp lệ',
      'Sản lượng mẻ phải lớn hơn 0.'
    );
    return;
  }
  Object.assign(v, {yieldQty,yieldUnit,sensoryScore,status: $('#rndVEStatus')?.value || v.status,});
  /*
   * Nếu đang sửa phiên bản hiện tại thì đồng bộ trạng thái
   * của công thức với phiên bản vừa sửa.
   */
  if (fm.currentVersion === v.version) {
    fm.status = v.status;
  }
  if (typeof RNDApi !== 'undefined') RNDApi.scheduleSync(['rndFormulaVersions', 'rndFormulas']);
  const newUnitCost = rndVersionUnitCost(v);
  Modal.close();
  render();
  Toast.ok(
    'Đã cập nhật công thức thử nghiệm',
    `${v.id} · Giá thành ${fmtVND(newUnitCost)}/đv · Cảm quan ${fmtDec(sensoryScore, 1)}/10`
  );
};
Actions['rnd-version-add-line'] = (d, el) => {
  if (d.kind === 'ing') $('#rndVerIngredients').insertAdjacentHTML('beforeend', rndVersionIngredientRow(DB.materials[0]?.id, 1));
  else $('#rndVerOperations').insertAdjacentHTML('beforeend', rndVersionOperationRow(DB.operations[0]?.id, 0.01));
};
Actions['rnd-version-remove-line'] = (d, el) => {
  const wrapSel = d.kind === 'ing' ? '#rndVerIngredients .rnd-ver-ing-line' : '#rndVerOperations .rnd-ver-op-line';
  const rows = document.querySelectorAll(wrapSel);
  if (rows.length <= 1) { Toast.warn('Cần ít nhất một dòng', d.kind === 'ing' ? 'Công thức phải có ít nhất một nguyên liệu.' : 'Công thức phải có ít nhất một công đoạn.'); return; }
  el.closest(d.kind === 'ing' ? '.rnd-ver-ing-line' : '.rnd-ver-op-line')?.remove();
};
Actions['rnd-version-save'] = (d) => {
  const fm = rndFormula(d.formulaid); if (!fm) return;
  const ingredients = [...document.querySelectorAll('.rnd-ver-ing-line')].map((row) => ({ materialId: row.querySelector('[name="material"]').value, qty: Number(row.querySelector('[name="qty"]').value) || 0 })).filter((i) => i.qty > 0);
  const operations = [...document.querySelectorAll('.rnd-ver-op-line')].map((row) => ({ operationId: row.querySelector('[name="operation"]').value, hoursPer: Number(row.querySelector('[name="hours"]').value) || 0 })).filter((o) => o.hoursPer > 0);
  if (!ingredients.length) { Toast.err('Thiếu nguyên liệu', 'Vui lòng nhập ít nhất một nguyên liệu với số lượng > 0.'); return; }
  const yieldQty = Number($('#rndVYieldQty')?.value) || 1;
  let sensoryScore = Number($('#rndVSensory')?.value);
  if (!Number.isFinite(sensoryScore)) sensoryScore = 0;
  if (sensoryScore < 0 || sensoryScore > 10) {
	Toast.err('Điểm cảm quan không hợp lệ', 'Điểm cảm quan phải nằm trong khoảng từ 0 đến 10.');
	return;
  }
  sensoryScore = Math.round(sensoryScore * 10) / 10;
  const versionNo = rndVersionsOfFormula(fm.id).length + 1;
  const id = `${fm.id}-v${versionNo}`;
  const status = $('#rndVStatus')?.value || 'DRAFT';
  DB.rndFormulaVersions.push({
    id, formulaId: fm.id, version: 'v' + versionNo, date: $('#rndVDate')?.value || currentDateYMD(), author: $('#rndVAuthor')?.value || 'NV-001',
    yieldQty, yieldUnit: $('#rndVYieldUnit')?.value.trim() || 'Đơn vị', ingredients, operations,
    sensoryScore, status, note: $('#rndVNote')?.value.trim() || '',
  });
  fm.currentVersion = 'v' + versionNo;
  fm.status = status;
  if (typeof RNDApi !== 'undefined') RNDApi.scheduleSync(['rndFormulaVersions', 'rndFormulas']);
  Modal.close(); render();
  Toast.ok('Đã lưu phiên bản công thức', `${id} — Giá thành ước tính ${fmtVND(rndVersionUnitCost(DB.rndFormulaVersions[DB.rndFormulaVersions.length - 1]))}/đv`);
};
Actions['rnd-formula-versions'] = (d) => {
  const fm = rndFormula(d.id); if (!fm) return;
  const versions = rndVersionsOfFormula(fm.id);
  const bestCost = versions.length ? versions.reduce((b, v) => (rndVersionUnitCost(v) < rndVersionUnitCost(b) ? v : b), versions[0]) : null;
  const bestSensory = versions.length ? versions.reduce((b, v) => (Number(v.sensoryScore) > Number(b.sensoryScore) ? v : b), versions[0]) : null;
  const rows = versions.map((v) => {
    const ingList = (v.ingredients || []).map((i) => `${esc(Q.material(i.materialId)?.name || i.materialId)} (${fmtDec(i.qty, 2)} ${esc(Q.material(i.materialId)?.unit || '')})`).join(', ');
    return `<tr>
        <td><span class="code">${v.version}</span></td>
        <td>${fmtDate(v.date)}</td>
        <td>${esc(Q.employeeName(v.author))}</td>
        <td>${esc(ingList)}</td>
        <td class="right num">${fmtN(v.yieldQty)} ${esc(v.yieldUnit)}</td>
        <td class="right num" style="${bestCost && v.id === bestCost.id ? 'color:var(--green);font-weight:700' : ''}">${fmtVND(rndVersionUnitCost(v))}</td>
        <td class="right num" style="${bestSensory && v.id === bestSensory.id ? 'color:var(--green);font-weight:700' : ''}">${fmtDec(v.sensoryScore, 1)}/10</td>
        <td>${rndBadge(RND_VERSION_STATUS, v.status)}</td>
		<td>
		${rowActions([
			{
			act: 'rnd-version-edit',
			data: `data-id="${v.id}"`,
			icon: 'fa-pen',
			title: 'Sửa chi tiết'
			}
		])}
		</td>
      </tr>`;
  });
  Modal.open({
    title: `So sánh các phiên bản · ${fm.name}`, size: 'xl',
    sub: `Công thức ${fm.id} — Dự án ${esc(rndProject(fm.projectId)?.name || fm.projectId)}`,
    body: tableShell([{ t: 'Phiên bản' }, { t: 'Ngày' }, { t: 'Người thực hiện' }, { t: 'Nguyên liệu chính' }, { t: 'Sản lượng mẻ' }, { t: 'Giá thành/đv' }, { t: 'Cảm quan' }, { t: 'Trạng thái' }, { t: '', w: '70px' }],  rows, { emptyTitle: 'Chưa có phiên bản nào' }),
    foot: `<button class="btn" data-act="modal-close">Đóng</button><button class="btn btn-primary" data-act="rnd-version-new" data-formulaid="${fm.id}"><i class="fa-solid fa-plus"></i>Thêm phiên bản mới</button>`,
  });
};

/* -------------------------------------------------------------- THỬ NGHIỆM */
Actions['rnd-trial-new'] = () => {
  const allVersions = DB.rndFormulaVersions.map((v) => `<option value="${esc(v.id)}">${esc(v.formulaId)} · ${esc(v.version)} — ${esc(rndFormula(v.formulaId)?.name || '')}</option>`).join('');
  Modal.open({
    title: 'Ghi nhận thử nghiệm', size: 'md',
    body: `<div class="form-grid">
        <div class="field" style="grid-column:1/-1"><label>Phiên bản công thức *</label><select class="inp" id="rndTVersion">${allVersions}</select></div>
        <div class="field"><label>Ngày thử nghiệm</label><input class="inp" type="date" id="rndTDate" value="${currentDateYMD()}"></div>
        <div class="field"><label>Người thử nghiệm</label><select class="inp" id="rndTTester">${rndEmployeeOptions('NV-015')}</select></div>
        <div class="field"><label>Số lượng mẻ</label><input class="inp right num" type="number" min="0" id="rndTQty" value="50"></div>
        <div class="field"><label>Đơn vị</label><input class="inp" id="rndTUnit" value="Hộp"></div>
        <div class="field"><label>Kết quả</label><select class="inp" id="rndTResult">${Object.entries(RND_TRIAL_RESULT).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></div>
        <div class="field"><label>Điểm cảm quan (0–10)</label><input class="inp right num" type="number" min="0" max="10" step="0.1" id="rndTSensory" value="7"></div>
        <div class="field" style="grid-column:1/-1"><label>Chi phí thực tế (VNĐ)</label><input class="inp right num" type="number" min="0" id="rndTCost" value="1000000"></div>
        <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea class="inp" id="rndTNote" rows="2"></textarea></div>
      </div>`,
    foot: '<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="rnd-trial-save"><i class="fa-solid fa-floppy-disk"></i>Lưu thử nghiệm</button>',
  });
};
Actions['rnd-trial-save'] = () => {
  const versionId = $('#rndTVersion')?.value || '';
  const v = rndFormulaVersion(versionId);
  if (!v) { Toast.err('Chưa chọn phiên bản', 'Vui lòng chọn phiên bản công thức cần thử nghiệm.'); return; }
  const id = nextCode('TN-2026-', DB.rndTrials);
  let sensoryScore = Number($('#rndTSensory')?.value);
  if (!Number.isFinite(sensoryScore)) sensoryScore = 0;
  if (sensoryScore < 0 || sensoryScore > 10) {
	Toast.err('Điểm cảm quan không hợp lệ', 'Điểm cảm quan phải nằm trong khoảng từ 0 đến 10.');
	return;
  }
  sensoryScore = Math.round(sensoryScore * 10) / 10;
  DB.rndTrials.unshift({
    id, projectId: rndFormula(v.formulaId)?.projectId || '', formulaVersionId: versionId, date: $('#rndTDate')?.value || currentDateYMD(),
    batchQty: Number($('#rndTQty')?.value) || 0, batchUnit: $('#rndTUnit')?.value.trim() || 'Đơn vị', result: $('#rndTResult')?.value || 'PARTIAL',
    sensoryScore, costActual: Number($('#rndTCost')?.value) || 0, testerId: $('#rndTTester')?.value || 'NV-001', note: $('#rndTNote')?.value.trim() || '',
  });
  if (typeof RNDApi !== 'undefined') RNDApi.scheduleSync(['rndTrials']);
  Modal.close(); go('rnd', { tab: 'trials' });
  Toast.ok('Đã ghi nhận thử nghiệm', id);
};

/* -------------------------------------------------------------- CHI PHÍ */
Actions['rnd-cost-new'] = () => {
  Modal.open({
    title: 'Ghi nhận chi phí nghiên cứu', size: 'sm',
    body: `<div class="form-grid">
        <div class="field" style="grid-column:1/-1"><label>Dự án *</label><select class="inp" id="rndCProject">${rndProjectOptions('')}</select></div>
        <div class="field"><label>Ngày</label><input class="inp" type="date" id="rndCDate" value="${currentDateYMD()}"></div>
        <div class="field"><label>Loại chi phí</label><select class="inp" id="rndCCategory">${RND_COST_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Số tiền (VNĐ) *</label><input class="inp right num" type="number" min="0" id="rndCAmount" value="1000000"></div>
        <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea class="inp" id="rndCNote" rows="2"></textarea></div>
      </div>`,
    foot: '<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="rnd-cost-save"><i class="fa-solid fa-floppy-disk"></i>Lưu chi phí</button>',
  });
};
Actions['rnd-cost-save'] = () => {
  const projectId = $('#rndCProject')?.value || '';
  const amount = Number($('#rndCAmount')?.value) || 0;
  if (!projectId) { Toast.err('Chưa chọn dự án', 'Vui lòng chọn dự án cần ghi nhận chi phí.'); return; }
  if (amount <= 0) { Toast.err('Số tiền không hợp lệ', 'Vui lòng nhập số tiền lớn hơn 0.'); return; }
  const id = nextCode('CPNC-2026-', DB.rndCosts);
  DB.rndCosts.unshift({ id, projectId, date: $('#rndCDate')?.value || currentDateYMD(), category: $('#rndCCategory')?.value || RND_COST_CATEGORIES[0], amount, note: $('#rndCNote')?.value.trim() || '', recordedBy: DB.currentUser?.id || 'NV-001' });
  if (typeof RNDApi !== 'undefined') RNDApi.scheduleSync(['rndCosts']);
  Modal.close(); go('rnd', { tab: 'costs' });
  Toast.ok('Đã ghi nhận chi phí', `${id} · ${fmtVND(amount)}`);
};
Actions['rnd-export-costs'] = () => Exporter.csv('Chi-phi-nghien-cuu-RD.csv',
  ['Mã CP', 'Dự án', 'Ngày', 'Loại chi phí', 'Số tiền', 'Ghi chú', 'Người ghi nhận'],
  DB.rndCosts.map((c) => [c.id, rndProject(c.projectId)?.name || c.projectId, c.date, c.category, c.amount, c.note, Q.employeeName(c.recordedBy)]));
Actions['rnd-export-projects'] = () => Exporter.csv('Bao-cao-du-an-RD.csv',
  ['Mã dự án', 'Tên dự án', 'Trạng thái', 'Giai đoạn', 'Ngày bắt đầu', 'Ngày tung SP', 'Thời gian (ngày)', 'Ngân sách', 'Chi phí thực tế'],
  DB.rndProjects.map((p) => [p.id, p.name, RND_PROJECT_STATUS[p.status]?.label || p.status, RND_STAGE_LABEL[p.stage] || p.stage, p.startDate, p.actualLaunchDate || '', rndProjectDevDays(p), p.budget, rndProjectCostTotal(p.id)]));

/* -------------------------------------------------------------- QUY TRÌNH DUYỆT (NPD) */
Actions['rnd-approval-request'] = (d) => {
  const p = rndProject(d.id); if (!p) return;
  if (rndPendingApproval(p.id, p.stage)) { Toast.warn('Đã có yêu cầu chờ duyệt', 'Giai đoạn hiện tại đang chờ phê duyệt.'); return; }
  const id = nextCode('DUYET-2026-', DB.rndApprovals);
  DB.rndApprovals.unshift({ id, projectId: p.id, stage: p.stage, status: 'PENDING', approverId: '', date: currentDateYMD(), note: '' });
  if (typeof RNDApi !== 'undefined') RNDApi.scheduleSync(['rndApprovals']);
  render();
  Toast.ok('Đã gửi yêu cầu duyệt', `${p.id} · Giai đoạn "${RND_STAGE_LABEL[p.stage]}"`);
};
Actions['rnd-approval-decide'] = (d) => {
  const a = DB.rndApprovals.find((x) => x.id === d.id); if (!a) return;
  const p = rndProject(a.projectId); if (!p) return;
  const decision = d.decision === 'REJECTED' ? 'REJECTED' : 'APPROVED';
  confirmBox({
    title: decision === 'APPROVED' ? 'Duyệt qua giai đoạn tiếp theo' : 'Từ chối / Dừng dự án',
    tone: decision === 'APPROVED' ? 'primary' : 'danger', icon: decision === 'APPROVED' ? 'fa-check' : 'fa-xmark',
    okText: decision === 'APPROVED' ? 'Xác nhận duyệt' : 'Xác nhận dừng dự án',
    message: `${decision === 'APPROVED' ? 'Duyệt' : 'Từ chối'} giai đoạn <b>${esc(RND_STAGE_LABEL[a.stage])}</b> của dự án <b>${esc(p.name)}</b>?`,
    onOk: () => {
      a.status = decision; a.approverId = DB.currentUser?.id || 'NV-001'; a.date = currentDateYMD();
      if (decision === 'REJECTED') {
        p.status = 'REJECTED';
        Toast.warn('Đã dừng dự án', `${p.id} · Giai đoạn ${RND_STAGE_LABEL[a.stage]} không đạt yêu cầu.`);
      } else {
        const next = rndNextStage(a.stage);
        if (next) { p.stage = next; Toast.ok('Đã duyệt', `${p.id} · Chuyển sang giai đoạn "${RND_STAGE_LABEL[next]}"`); }
        else { p.status = 'LAUNCHED'; p.actualLaunchDate = currentDateYMD(); Toast.ok('Đã tung sản phẩm', `${p.id} · Dự án hoàn tất.`); }
      }
      if (typeof RNDApi !== 'undefined') RNDApi.scheduleSync(['rndApprovals', 'rndProjects']);
      render();
    },
  });
};
Actions['rnd-project-launch'] = (d) => {
  const p = rndProject(d.id); if (!p) return;
  confirmBox({
    title: 'Xác nhận tung sản phẩm', tone: 'primary', icon: 'fa-rocket', okText: 'Xác nhận',
    message: `Xác nhận dự án <b>${esc(p.name)}</b> đã hoàn tất và sẵn sàng chuyển giao sản xuất đại trà?`,
    onOk: () => {
      p.status = 'LAUNCHED'; p.actualLaunchDate = currentDateYMD();
      if (typeof RNDApi !== 'undefined') RNDApi.scheduleSync(['rndProjects']);
      render();
      Toast.ok('Đã tung sản phẩm', `${p.id} — thời gian phát triển ${rndProjectDevDays(p)} ngày.`);
    },
  });
};
