const QualityDashboardState={ready:false,updatedAt:'',sources:{}};
const QUALITY_DASHBOARD_TYPES={IQC:['Kiểm tra đầu vào','iqc','goodsReceipts'],PQC:['Kiểm tra bán thành phẩm','pqc','productionOrders'],FQC:['Kiểm tra thành phẩm','fqc','productionFinalInspections'],GC:['Kiểm tra gia công','subcontracting_qc','localSubcontract']};
function qualityDashboardDay(value) {
  if(!value)return '';
  const text=String(value);
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)){
    const d=new Date(text+'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===text ? text : '';
  }
  const d=new Date(text);if(Number.isNaN(d.getTime()))return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function qualityDashboardUnique(rows,keyOf) {
  const map=new Map();
  for(const row of rows || []){
    const key=keyOf(row);if(!key)continue;
    const old=map.get(key);
    if(!old || String(row.updatedAt||row.inspectedAt||row.qcAt||row.date||'')>=String(old.updatedAt||old.inspectedAt||old.qcAt||old.date||''))map.set(key,row);
  }
  return [...map.values()];
}
function qualityDashboardStatus(status) {
  const key=String(status||'PENDING').toUpperCase();
  const mapped=({QC_PENDING:'PENDING',WAITING_QC:'PENDING',PARTIAL_PASSED:'PARTIAL_FAILED'})[key] || key;
  return ['PENDING','IN_PROGRESS','REWORK_PENDING','READY_RETEST','PASSED','PARTIAL_FAILED','FAILED'].includes(mapped) ? mapped : 'UNKNOWN';
}
function qualityDashboardData(filter={},available=null) {
  const records=[], completedStatuses=['PASSED','PARTIAL_FAILED','FAILED'];
  const allowed=key=>!available || !!available[key];
  if(allowed('goodsReceipts'))for(const r of incomingInspectionReceipts()){
    if(!r.poId || !(r.items||[]).length || r.status==='CANCELLED')continue;
    const status=qualityDashboardStatus(incomingInspectionStatus(r)), po=Q.purchaseOrder(r.poId);
    records.push({key:`IQC:${r.id}`,id:r.id,type:'IQC',status,ref:r.poId,
      name:(r.items||[]).map(i=>i.name||Q.material(i.materialId)?.name||i.materialId).join(', '),
      partner:Q.supplierName(po?.supplierId||r.supplierId),date:qualityDashboardDay(r.date),checkedAt:r.inspectedAt||'',inspector:Q.employeeName(r.inspectedBy)||r.inspectedBy||'',
      qtyText:(r.items||[]).map(i=>`${fmtDec(i.qty||0,3)} ${i.unit||''}`).join('; '),
      resultText:(r.items||[]).map(i=>{const known=i.failedQty!==undefined && Number.isFinite(Number(i.failedQty));return known?`${i.name||i.materialId}: ${fmtDec(Number(i.acceptedQty??Math.max(0,Number(i.qty||0)-Number(i.failedQty))),3)} / ${fmtDec(i.failedQty,3)} ${i.unit||''}`:'Chưa đủ số liệu đạt/lỗi';}).join('; '),
      note:r.inspectionNote||'',action:'iqc-open-inspection',data:{id:r.id}});
  }
  if(allowed('productionOrders'))for(const po of qualityDashboardUnique(DB.productionOrders,r=>r.id)){
    (po.stages||[]).forEach((stage,index)=>{
      if(typeof isProcessQcStage!=='function' || !isProcessQcStage(po,index))return;
      if(!(stage.status==='doing'||stage.status==='done'||Number(stage.qtyDone||0)>0||(stage.processQcHistory||[]).length))return;
      const q=stage.processQc||{},legacy=q.status==='FAILED'?Number(q.lastFailQty||0):0;
      const pending=Math.max(0,Number(q.pendingReworkQty??legacy)),retest=Math.max(0,Number(q.readyRetestQty||0));
      const status=stage.status==='done'||q.status==='PASSED'?'PASSED':pending>0?'REWORK_PENDING':retest>0?'READY_RETEST':qualityDashboardStatus(q.status);
      const latest=(stage.processQcHistory||[]).filter(h=>h.eventType!=='REWORK').slice().sort((a,b)=>String(b.inspectedAt||'').localeCompare(String(a.inspectedAt||'')))[0];
      records.push({key:`PQC:${po.id}:${index}`,id:`${po.id} / ${stage.name||stage.operationId||'QC'}`,type:'PQC',status,ref:po.id,name:po.productName||Q.product(po.productId)?.name||po.productId||'',partner:'Sản xuất nội bộ',
        date:qualityDashboardDay(po.startDate||po.date),checkedAt:q.inspectedAt||latest?.inspectedAt||'',inspector:q.inspectorName||latest?.inspectorName||Q.employeeName(q.inspectorId)||'',
        qtyText:`${fmtDec(Number(stage.qtyPlan||po.qty||0),3)} ${po.unit||Q.product(po.productId)?.unit||''}`,resultText:q.lastPassQty!==undefined&&q.lastFailQty!==undefined?`${fmtDec(q.lastPassQty,3)} / ${fmtDec(q.lastFailQty,3)} ${po.unit||Q.product(po.productId)?.unit||''} (lần kiểm gần nhất)`:'Chưa đủ số liệu đạt/lỗi',note:q.note||'',action:'pqc-open',data:{id:po.id,i:index}});
    });
  }
  if(allowed('productionFinalInspections'))for(const ins of qualityDashboardUnique(DB.productionFinalInspections,r=>r.id)){
    if(ins.status==='CANCELLED')continue;
    records.push({key:`FQC:${ins.id}`,id:ins.id,type:'FQC',status:qualityDashboardStatus(ins.status),ref:ins.productionOrderId||'',name:ins.productName||Q.product(ins.productId)?.name||ins.productId||'',partner:'Sản xuất nội bộ',
      date:qualityDashboardDay(ins.createdAt||ins.date),checkedAt:ins.inspectedAt||'',inspector:ins.inspectedByName||Q.employeeName(ins.inspectedBy)||ins.inspectedBy||'',
      qtyText:`${fmtDec(ins.qty||0,3)} ${ins.unit||Q.product(ins.productId)?.unit||''}`,resultText:ins.passQty!==undefined&&ins.failQty!==undefined?`${fmtDec(ins.passQty,3)} / ${fmtDec(ins.failQty,3)} ${ins.unit||Q.product(ins.productId)?.unit||''}`:'Chưa đủ số liệu đạt/lỗi',note:ins.note||'',action:'fqc-open',data:{id:ins.id}});
  }
  if(allowed('localSubcontract'))for(const o of qualityDashboardUnique(DB.subcontractingOrders,r=>r.id)){
    for(const r of qualityDashboardUnique(o.receipts,r=>r.id)){
      if(r.status==='CANCELLED')continue;
      const done=r.qcStatus==='DONE',bad=Number(r.defectQty||0),good=Number(r.goodQty||0);
      const valid=Number.isFinite(good)&&Number.isFinite(bad)&&good>=0&&bad>=0&&Number(r.qty)>0&&Math.abs(good+bad-Number(r.qty))<1e-6;
      const status=done?(valid?(bad>0?(good>0?'PARTIAL_FAILED':'FAILED'):'PASSED'):'UNKNOWN'):'PENDING';
      records.push({key:`GC:${o.id}:${r.id}`,id:r.id,type:'GC',status,ref:o.id,name:Q.product(o.productId)?.name||o.productId||'',partner:o.partner||'',date:qualityDashboardDay(r.date),checkedAt:r.qcAt||'',
        inspector:Q.employeeName(r.qcBy)||r.qcBy||'',qtyText:`${fmtDec(r.qty||0,3)} ${Q.product(o.productId)?.unit||o.unit||''}`,resultText:valid?`${fmtDec(good,3)} / ${fmtDec(bad,3)} ${Q.product(o.productId)?.unit||o.unit||''}`:'Chưa đủ số liệu đạt/lỗi',note:r.qcNote||'',action:'subcontracting-qc',data:{id:o.id,receipt:r.id}});
    }
  }
  const scoped=records.filter(r=>!filter.type || r.type===filter.type);
  const backlog=scoped.filter(r=>['PENDING','IN_PROGRESS','REWORK_PENDING','READY_RETEST','UNKNOWN'].includes(r.status)).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.key.localeCompare(b.key));
  const complete=scoped.filter(r=>completedStatuses.includes(r.status));
  const completed=complete.filter(r=>{
    const day=qualityDashboardDay(r.checkedAt);
    return (!filter.from||day&&day>=filter.from) && (!filter.to||day&&day<=filter.to);
  }).sort((a,b)=>String(b.checkedAt||'').localeCompare(String(a.checkedAt||''))||a.key.localeCompare(b.key));
  const count=(rows,status)=>rows.filter(r=>r.status===status).length;
  const byType=Object.keys(QUALITY_DASHBOARD_TYPES).map(type=>{
    const all=scoped.filter(r=>r.type===type),done=completed.filter(r=>r.type===type);
    return {type,total:all.length,pending:count(all,'PENDING'),processing:count(all,'IN_PROGRESS'),rework:count(all,'REWORK_PENDING'),retest:count(all,'READY_RETEST'),checked:done.length,passed:count(done,'PASSED'),partial:count(done,'PARTIAL_FAILED'),failed:count(done,'FAILED')};
  });
  const today=currentDateYMD();
  const capa=allowed('capa')?qualityDashboardUnique(DB.qualityCapa,r=>r.id):[];
  const openCapa=capa.filter(r=>!['CLOSED','DONE','COMPLETED'].includes(r.status));
  const overdueCapa=openCapa.filter(r=>qualityDashboardDay(r.dueDate)&&qualityDashboardDay(r.dueDate)<today);
  const recalls=allowed('recalls')?qualityDashboardUnique(DB.qualityRecalls,r=>r.id):[];
  const openRecalls=recalls.filter(r=>!['CLOSED','DONE','COMPLETED'].includes(r.status));
  const coa=allowed('coa')?qualityDashboardUnique(DB.qualityCoa,r=>r.id):[];
  const pendingCoa=coa.filter(r=>!['PASSED','FAILED'].includes(r.result));
  const returns=allowed('materialReturnRequests')?qualityDashboardUnique(DB.materialReturnRequests,r=>r.id).filter(r=>['PENDING_WAREHOUSE','WAITING_WAREHOUSE','WAITING_WAREHOUSE_CONFIRMATION'].includes(r.status)&&Number(r.qty||0)>0):[];
  const passed=count(completed,'PASSED');
  return {records,scoped,backlog,completed,byType,passed,partial:count(completed,'PARTIAL_FAILED'),failed:count(completed,'FAILED'),passRate:completed.length?passed/completed.length*100:null,
    missingDates:complete.filter(r=>!qualityDashboardDay(r.checkedAt)).length,openCapa,overdueCapa,openRecalls,pendingCoa,returns};
}
function qualityDashboardMarkLoaded(changed={}) {
  const keys=['goodsReceipts','productionOrders','productionFinalInspections','coa','capa','recalls','materialReturnRequests'];
  QualityDashboardState.sources=Object.fromEntries(keys.map(k=>[k,Object.prototype.hasOwnProperty.call(changed,k)]));
  QualityDashboardState.sources.localSubcontract=true;
  QualityDashboardState.ready=true;QualityDashboardState.updatedAt=new Date().toISOString();
}
function qualityDashboardBadge(status) {
  const labels={PENDING:['Chờ kiểm','orange'],IN_PROGRESS:['Đang kiểm','blue'],REWORK_PENDING:['Chờ sửa / tái chế','red'],READY_RETEST:['Chờ tái kiểm','orange'],PASSED:['Đạt toàn bộ','green'],PARTIAL_FAILED:['Đạt một phần','orange'],FAILED:['Không đạt','red']};
  const x=labels[status]||['Chưa rõ kết quả','slate'];return `<span class="badge ${x[1]}">${x[0]}</span>`;
}
function qualityDashboardView() {
  const head=pageHead('Tổng quan chất lượng','Theo dõi kiểm tra đầu vào, bán thành phẩm, thành phẩm và gia công', '<button class="btn" data-act="quality-dashboard-refresh"><i class="fa-solid fa-rotate"></i>Cập nhật dữ liệu</button>');
  if(!QualityDashboardState.ready)return `${head}<div class="card"><div class="card-body"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải phiếu kiểm tra và hồ sơ chất lượng…</div></div>`;
  const f=F('quality-dashboard',{type:'',from:'',to:''}),available=QualityDashboardState.sources;
  const d=qualityDashboardData(f,available),missing=Object.entries({goodsReceipts:'Đầu vào',productionOrders:'Bán thành phẩm',productionFinalInspections:'Thành phẩm',coa:'Hồ sơ kiểm nghiệm',capa:'CAPA',recalls:'Thu hồi',materialReturnRequests:'Trả NCC'}).filter(([k])=>!available[k]).map(([,label])=>label);
  const typeRows=d.byType.filter(x=>!f.type||x.type===f.type).map(x=>{
    const [label,tab,key]=QUALITY_DASHBOARD_TYPES[x.type],ok=available[key];
    return `<tr><td><button class="btn btn-sm" data-act="quality-dashboard-tab" data-id="quality" data-tab="${tab}">${esc(label)}</button></td><td class="right num">${ok?x.pending:'—'}</td><td class="right num">${ok?x.processing:'—'}</td><td class="right num">${ok?x.rework:'—'}</td><td class="right num">${ok?x.retest:'—'}</td><td class="right num">${ok?x.checked:'—'}</td><td class="right num">${ok?x.passed:'—'}</td><td class="right num">${ok?x.partial:'—'}</td><td class="right num">${ok?x.failed:'—'}</td></tr>`;
  });
  const pending=(type,key)=>available[key]?d.backlog.filter(r=>r.type===type).length:'—';
  const tableRows=(rows,history)=>rows.map(r=>`<tr><td>${cell2(`<span class="code">${esc(r.id)}</span>`,esc(QUALITY_DASHBOARD_TYPES[r.type][0]))}</td><td>${cell2(esc(r.name),esc(r.ref))}</td><td>${esc(r.qtyText||'—')}</td>${history?`<td>${esc(r.resultText||'—')}</td>`:''}<td>${qualityDashboardBadge(r.status)}</td><td>${esc(r.partner||'—')}</td><td>${history?cell2(esc(r.inspector||'—'),r.checkedAt?fmtDate(qualityDashboardDay(r.checkedAt)):'Chưa có ngày kiểm'):(r.date?fmtDate(r.date):'—')}</td><td>${rowActions([{act:'quality-dashboard-open',data:`data-key="${esc(r.key)}"`,icon:'fa-eye',title:'Mở phiếu kiểm tra'}])}</td></tr>`);
  const pendingPage=paged(d.backlog,'qualityDashboardPending',10),historyPage=paged(d.completed,'qualityDashboardHistory',10);
  const capaRows=d.openCapa.slice().sort((a,b)=>String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'))).slice(0,5).map(x=>`<tr><td>${cell2(esc(x.id),esc(x.issue||''))}</td><td>${esc(x.owner||'—')}</td><td>${x.dueDate?fmtDate(x.dueDate):'—'}</td><td>${qualityDashboardDay(x.dueDate)&&qualityDashboardDay(x.dueDate)<currentDateYMD()?'<span class="badge red">Quá hạn</span>':esc(x.status||'OPEN')}</td><td>${rowActions([{act:'quality-capa-view',data:`data-id="${esc(x.id)}"`,icon:'fa-eye',title:'Xem CAPA'}])}</td></tr>`);
  return `${head}
    ${missing.length?`<div class="alert-item" style="margin-bottom:14px"><i class="fa-solid fa-triangle-exclamation"></i><div><b>Chưa tải được: ${esc(missing.join(', '))}</b><div class="muted">Nhấn Cập nhật dữ liệu để thử lại. Nguồn chưa tải được không được tính là không có công việc.</div></div></div>`:''}
    <div class="card" style="margin-bottom:14px"><div class="toolbar">${selectFilter('quality-dashboard','type',Object.entries(QUALITY_DASHBOARD_TYPES).map(([k,v])=>[k,v[0]]),'Tất cả loại kiểm tra')}
    <label>Từ ngày <input class="inp" type="date" data-f="quality-dashboard.from" value="${esc(f.from||'')}"></label><label>Đến ngày <input class="inp" type="date" data-f="quality-dashboard.to" value="${esc(f.to||'')}"></label>${f.type||f.from||f.to?'<button class="btn btn-sm" data-act="clear-filter" data-key="quality-dashboard">Xóa lọc</button>':''}</div>
    <div class="card-body" style="padding-top:0;font-size:12px;color:var(--text-3)">Bộ lọc ngày áp dụng theo ngày kiểm của kết quả đã hoàn tất. Công việc đang chờ luôn phản ánh hiện tại.${d.missingDates?` Có ${d.missingDates} bản ghi đã kiểm chưa có ngày kiểm; các bản ghi này chỉ được tính khi không lọc ngày.`:''}</div></div>
    ${f.from&&f.to&&f.from>f.to?'<div class="alert-item" style="margin-bottom:14px">Khoảng ngày chưa hợp lệ: Từ ngày phải trước hoặc bằng Đến ngày.</div>':''}
    <div class="form-sec-title">Công việc cần xử lý hiện tại</div><div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Đầu vào chờ kiểm',pending('IQC','goodsReceipts'),'fa-box-open','orange','quality-dashboard-tab','',{tab:'iqc'})}
    ${mkpi('Bán thành phẩm cần xử lý',pending('PQC','productionOrders'),'fa-vials','orange','quality-dashboard-tab','',{tab:'pqc'})}
    ${mkpi('Thành phẩm chờ kiểm',pending('FQC','productionFinalInspections'),'fa-clipboard-check','blue','quality-dashboard-tab','',{tab:'fqc'})}
    ${mkpi('Gia công chờ kiểm',pending('GC','localSubcontract'),'fa-industry','indigo','quality-dashboard-tab','',{tab:'subcontracting_qc'})}
    ${mkpi('CAPA quá hạn',available.capa?d.overdueCapa.length:'—','fa-clock','red','quality-dashboard-tab','',{tab:'capa'})}
    ${mkpi('Thu hồi chưa hoàn tất',available.recalls?d.openRecalls.length:'—','fa-rotate-left','red','quality-dashboard-tab','',{tab:'recall'})}</div>
    <div class="form-sec-title">Kết quả kiểm tra ${f.from||f.to?'trong kỳ':'toàn bộ thời gian'}</div><div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Đã kiểm hoàn tất',d.completed.length,'fa-list-check','blue')}${mkpi('Đạt toàn bộ',d.passed,'fa-circle-check','green')}${mkpi('Đạt một phần',d.partial,'fa-circle-half-stroke','orange')}${mkpi('Không đạt',d.failed,'fa-circle-xmark','red')}${mkpi('Tỷ lệ đạt toàn bộ',d.passRate===null?'—':fmtDec(d.passRate,1)+'%','fa-chart-simple','teal')}</div>
    <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Tình hình theo loại kiểm tra</h3><p>Mỗi phiếu nhập, checkpoint QC, phiếu FQC hoặc đợt nhận gia công tính một bản ghi. Tái kiểm cùng checkpoint không tính thành phiếu mới.</p></div></div>
    ${tableShell([{t:'Loại kiểm tra'},{t:'Chờ kiểm',cls:'right'},{t:'Đang kiểm',cls:'right'},{t:'Chờ sửa',cls:'right'},{t:'Chờ tái kiểm',cls:'right'},{t:'Đã kiểm trong kỳ',cls:'right'},{t:'Đạt',cls:'right'},{t:'Một phần',cls:'right'},{t:'Không đạt',cls:'right'}],typeRows,{emptyTitle:'Chưa có dữ liệu kiểm tra'})}
    <div class="card-body" style="font-size:12px;color:var(--text-3)">Tỷ lệ đạt toàn bộ = số bản ghi đạt toàn bộ / số bản ghi đã hoàn tất trong kỳ; không phải tỷ lệ đạt theo số lượng hàng. Các nguồn chưa tải được không nằm trong mẫu tính.</div></div>
    <div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Danh sách cần kiểm tra / xử lý</h3><span class="chip">${d.backlog.length} công việc</span></div>${tableShell([{t:'Chứng từ / Loại'},{t:'Hàng hóa / Tham chiếu'},{t:'SL / Đơn vị'},{t:'Trạng thái'},{t:'Nguồn / Đối tác'},{t:'Ngày phát sinh'},{t:'Thao tác'}],tableRows(pendingPage.items,false),{emptyTitle:'Không có công việc chờ xử lý từ các nguồn đã tải'})}${pagiHTML('qualityDashboardPending',pendingPage,'công việc')}</div>
    <div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Kết quả kiểm tra gần đây</h3></div>${tableShell([{t:'Chứng từ / Loại'},{t:'Hàng hóa / Tham chiếu'},{t:'SL / Đơn vị'},{t:'Đạt / Không đạt'},{t:'Kết quả'},{t:'Nguồn / Đối tác'},{t:'Người / Ngày kiểm'},{t:'Thao tác'}],tableRows(historyPage.items,true),{emptyTitle:'Chưa có kết quả hoàn tất trong kỳ'})}${pagiHTML('qualityDashboardHistory',historyPage,'kết quả')}</div>
    <div class="grid g-21" style="margin-bottom:14px"><div class="card"><div class="card-head"><h3>CAPA đang theo dõi</h3><button class="btn btn-sm" data-act="quality-dashboard-tab" data-id="quality" data-tab="capa">Xem tất cả</button></div>${tableShell([{t:'CAPA / Vấn đề'},{t:'Phụ trách'},{t:'Hạn xử lý'},{t:'Trạng thái'},{t:''}],capaRows,{emptyTitle:available.capa?'Chưa có CAPA đang mở':'Chưa tải được dữ liệu CAPA'})}</div>
    <div class="card"><div class="card-head"><h3>Theo dõi liên quan</h3></div><div class="card-body"><p>Hồ sơ kiểm nghiệm chờ kết quả: <b>${available.coa?d.pendingCoa.length:'—'}</b> <button class="btn btn-sm" data-act="quality-dashboard-tab" data-id="quality" data-tab="coa">Mở hồ sơ</button></p><p>Yêu cầu trả NCC chờ kho xử lý: <b>${available.materialReturnRequests?d.returns.length:'—'}</b> ${Auth.canAccess('warehouse','issues')?'<button class="btn btn-sm" data-act="go" data-id="warehouse" data-tab="issues">Mở xuất kho</button>':'<span class="cell-sub">Kho thực hiện xuất trả.</span>'}</p><p>Thu hồi chưa hoàn tất: <b>${available.recalls?d.openRecalls.length:'—'}</b> <button class="btn btn-sm" data-act="quality-dashboard-tab" data-id="quality" data-tab="recall">Mở thu hồi</button></p></div></div></div>
    <div class="cell-sub">Dữ liệu gia công hiện lấy từ phân hệ Gia công lưu trên trình duyệt này. Tổng quan chỉ đọc dữ liệu, không tự tạo phiếu kiểm tra hay thay đổi tồn kho. Lần cập nhật màn hình: ${esc(new Date(QualityDashboardState.updatedAt).toLocaleString('vi-VN'))}.</div>`;
}

/* ============================================================================
 * MODULE: CÁC PHÂN HỆ DOANH NGHIỆP LÊ NAM
 * Bảng điều hành nhẹ cho các phân hệ chưa có backend riêng trong bản SPA demo.
 * ==========================================================================*/

const ENTERPRISE_MODULES = {
  subcontracting: {
    title: 'Quản lý gia công',
    sub: 'Theo dõi nguyên liệu gửi đối tác, tiến độ, hao hụt, lỗi và công nợ gia công',
    icon: 'fa-industry',
    columns: ['Mã lệnh', 'Đối tác', 'Sản phẩm', 'SL giao', 'Tiến độ', 'Tỷ lệ lỗi', 'Trạng thái'],
    rows: [
      ['GC-2026-001', 'Cơ sở Đậu Hủ Tân Phúc', 'Đậu hủ cứng đóng khuôn', '500 Kg', '80%', '1,2%', 'Đang thực hiện'],
      ['GC-2026-002', 'Xưởng Đóng Gói An Bình', 'Đậu hủ chiên giòn', '2.000 Gói', '100%', '0,5%', 'Chờ QC'],
    ],
  },
  restaurant: {
    title: 'Nhà hàng & POS',
    sub: 'Theo dõi doanh thu cửa hàng, ca bán hàng, định lượng món và chi phí nguyên liệu',
    icon: 'fa-utensils',
    columns: ['Cửa hàng', 'Doanh thu hôm nay', 'Đơn hàng', 'Food Cost', 'Ca hiện tại', 'Trạng thái'],
    rows: [
      ['Cửa hàng Lê Văn Việt', '18.450.000đ', '126', '32,4%', 'Ca sáng', 'Đang bán'],
      ['Quầy Bún Đậu Thủ Đức', '12.680.000đ', '94', '30,8%', 'Ca trưa', 'Đang bán'],
    ],
  },
  accounting: {
    title: 'Kế toán & tài chính',
    sub: 'Tổng hợp doanh thu, công nợ, dòng tiền và giá vốn liên thông từ bán hàng, mua hàng và kho',
    icon: 'fa-file-invoice-dollar',
    columns: ['Chỉ tiêu', 'Tháng này', 'Tháng trước', 'Biến động', 'Nguồn dữ liệu'],
    rows: [
      ['Doanh thu thuần', '486.000.000đ', '455.000.000đ', '+6,8%', 'Đơn hàng'],
      ['Giá vốn hàng bán', '298.000.000đ', '281.000.000đ', '+6,0%', 'Kho & sản xuất'],
      ['Công nợ phải thu', '128.000.000đ', '121.000.000đ', '+5,8%', 'Bán hàng'],
      ['Công nợ phải trả', '76.500.000đ', '82.000.000đ', '-6,7%', 'Mua hàng'],
    ],
  },
  quality: {
    title: 'QC / QA & truy xuất nguồn gốc',
    sub: 'Kiểm tra nguyên liệu, bán thành phẩm, thành phẩm và truy xuất từ lô đến nhà cung cấp',
    icon: 'fa-clipboard-check',
    columns: ['Mã kiểm tra', 'Đối tượng', 'Lô', 'Kết quả', 'Người kiểm', 'Trạng thái'],
    rows: [],
  },
  maintenance: {
    title: 'Bảo trì thiết bị',
    sub: 'Lịch bảo trì máy xay, nồi nấu, máy ép, máy đóng gói và kho lạnh',
    icon: 'fa-screwdriver-wrench',
    columns: ['Thiết bị', 'Khu vực', 'Bảo trì gần nhất', 'Lần kế tiếp', 'Tổng thời gian máy ngừng hoạt động', 'Trạng thái'],
    rows: [
      ['Máy xay XD-200', 'Khu Xay', '2026-08-01', '2026-09-01', '2,5 giờ', 'Đúng hạn'],
      ['Kho lạnh KL-01', 'Kho thành phẩm', '2026-07-28', '2026-08-28', '0 giờ', 'Đến hạn'],
    ],
  },
  logistics: {
    title: 'Logistics & đội xe',
    sub: 'Điều phối giao đậu hủ, theo dõi tài xế, chi phí/km và tỷ lệ giao đúng hạn',
    icon: 'fa-truck-fast',
    columns: ['Mã chuyến', 'Tuyến giao', 'Xe', 'Tài xế', 'Giờ dự kiến', 'Trạng thái'],
    rows: [
      ['GH-2026-084', 'Kho lạnh → Quận 9', '51C-123.45', 'Đinh Thị Hương', '09:30', 'Đang giao'],
      ['GH-2026-085', 'Kho lạnh → Bình Dương', '51C-678.90', 'Nguyễn Văn Bình', '13:00', 'Đã lập kế hoạch'],
    ],
  },
  rnd: {
    title: 'R&D công thức sản phẩm',
    sub: 'Quản lý thử nghiệm, phiên bản công thức, chi phí và quy trình duyệt sản phẩm mới',
    icon: 'fa-flask',
    columns: ['Mã dự án', 'Sản phẩm thử nghiệm', 'Phiên bản', 'Chi phí thử', 'Người phụ trách', 'Trạng thái'],
    rows: [
      ['RND-2026-004', 'Đậu hủ rong biển', 'v0.3', '8.500.000đ', 'Ngô Thị Lan', 'Đang thử nghiệm'],
      ['RND-2026-003', 'Đậu hủ protein cao', 'v1.0', '12.200.000đ', 'Phạm Quốc Bảo', 'Chờ duyệt'],
    ],
  },
  approvals: {
    title: 'Phê duyệt nghiệp vụ',
    sub: 'Tập trung các yêu cầu mua, thanh toán, xuất kho đặc biệt, hủy hàng và điều chỉnh sản xuất',
    icon: 'fa-signature',
    columns: ['Mã yêu cầu', 'Loại', 'Người đề nghị', 'Số tiền / SL', 'Hạn duyệt', 'Trạng thái'],
    rows: [
      ['YCM-2026-0044', 'Đề nghị mua nguyên liệu', 'Võ Thị Kim Ngân', '12.400.000đ', '2026-08-28', 'Chờ duyệt'],
      ['PX-2026-0320', 'Xuất kho đặc biệt', 'Cao Văn Thắng', '120 Kg', '2026-08-28', 'Chờ quản lý'],
    ],
  },
};

function enterpriseView(key) {
  const module = ENTERPRISE_MODULES[key];
  const rowHtml = module.rows.map((row) => `<tr>${row.map((cell, index) => `<td class="${index === row.length - 1 ? '' : 'num'}">${esc(cell)}</td>`).join('')}</tr>`);
  return `${pageHead(module.title, module.sub, `<button class="btn" data-act="export-enterprise" data-key="${key}"><i class="fa-solid fa-file-export"></i>Xuất báo cáo</button><button class="btn btn-primary" data-act="enterprise-action" data-key="${key}"><i class="fa-solid fa-plus"></i>Tạo mới</button>`)}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Bản ghi đang theo dõi', module.rows.length, module.icon, 'blue')}
      ${mkpi('Cập nhật hôm nay', module.rows.length, 'fa-clock', 'teal')}
      ${mkpi('Cần xử lý', module.rows.filter((row) => /Chờ|Đến hạn|Đang/.test(row[row.length - 1])).length, 'fa-triangle-exclamation', 'orange')}
    </div>
    <div class="card"><div class="card-head"><div><h3>${esc(module.title)}</h3><p>${esc(module.sub)}</p></div></div>${tableShell(module.columns.map((t) => ({ t })), rowHtml, { emptyTitle: 'Chưa có dữ liệu phân hệ' })}</div>`;
}

// Object.keys(ENTERPRISE_MODULES).forEach((key) => { Views[key] = () => enterpriseView(key); });

/* ==========================================================================
 * NHÀ HÀNG & CỬA HÀNG
 * Dùng dữ liệu POS/cửa hàng/công thức đã có, không tạo thêm request mạng.
 * ======================================================================= */
let __restaurantHydrated = false;
function restaurantHydrate() {
  if (__restaurantHydrated) return;
  __restaurantHydrated = true;
  DB.stores = Array.isArray(DB.stores) ? DB.stores : [];
  DB.restaurantRecipes = Array.isArray(DB.restaurantRecipes) ? DB.restaurantRecipes : [];
  DB.posOrders = Array.isArray(DB.posOrders) ? DB.posOrders : [];
  DB.storeReplenishmentRequests = Array.isArray(DB.storeReplenishmentRequests) ? DB.storeReplenishmentRequests : [];
  DB.restaurantStoreStocks = Array.isArray(DB.restaurantStoreStocks) ? DB.restaurantStoreStocks : [];
  DB.restaurantStoreStockTransactions = Array.isArray(DB.restaurantStoreStockTransactions) ? DB.restaurantStoreStockTransactions : [];
  // Backfill chứng từ xuất cho các yêu cầu cửa hàng đã xuất trước khi hệ thống lưu goodsIssues.
  // Chỉ dựng chứng từ lịch sử từ issuedLines, tuyệt đối không trừ tồn lần nữa.
  DB.goodsIssues = Array.isArray(DB.goodsIssues) ? DB.goodsIssues : [];
  let issueChanged=false, replenishmentChanged=false;
  for(const req of (DB.storeReplenishmentRequests||[])){
    if(!['ISSUED','RECEIVED'].includes(req.status)||!(req.issuedLines||[]).length) continue;
    let gi=req.goodsIssueId ? DB.goodsIssues.find(x=>x.id===req.goodsIssueId) : DB.goodsIssues.find(x=>x.replenishmentId===req.id);
    if(!gi){
      const store=restaurantStore(req.storeId);
      const id=nextCode('PX-2026-',DB.goodsIssues);
      gi={id,type:'TRANSFER_OUT',warehouseId:req.sourceWarehouseId||store?.sourceWarehouseId||'',refDoc:req.id,replenishmentId:req.id,transferId:req.transferId||'',storeId:req.storeId,date:String(req.issuedAt||req.date||restaurantToday()).slice(0,10),status:'COMPLETED',createdBy:req.issuedBy||req.createdBy||'',note:`Xuất hàng cho ${store?.name||req.storeId} theo yêu cầu ${req.id}`,items:(req.issuedLines||[]).map(line=>({productId:line.productId,lotId:line.lotId||'',qty:Number(line.qty||0),unit:line.unit||'',locationId:line.sourceLocationId||''}))};
      DB.goodsIssues.unshift(gi); issueChanged=true;
    }
    if(req.goodsIssueId!==gi.id){req.goodsIssueId=gi.id;replenishmentChanged=true;}
  }
  if(issueChanged&&typeof InventoryAPI!=='undefined'&&InventoryAPI.scheduleCollections) InventoryAPI.scheduleCollections(['goodsIssues'],250);
  if(replenishmentChanged&&typeof RestaurantQualityAPI!=='undefined') RestaurantQualityAPI.syncRestaurant(['replenishments']).catch(err=>console.warn('[Restaurant] Không backfill được mã phiếu xuất:',err));
}
function restaurantPersist(keys) {
  if (typeof RestaurantQualityAPI === 'undefined') return Promise.resolve(false);
  return RestaurantQualityAPI.syncRestaurant(keys).catch(err => {
    console.error('[RestaurantAPI] Không đồng bộ được dữ liệu server:', err);
    if (typeof Toast !== 'undefined') Toast.err('Không lưu được lên server', err?.message || 'Kiểm tra bảng lenam_restaurant_* trên KIO.');
    throw err;
  });
}
function restaurantToday(){ return typeof currentDateYMD==='function' ? currentDateYMD() : (DB.today || new Date().toISOString().slice(0,10)); }
function restaurantStore(id){ return (DB.stores||[]).find(x=>x.id===id); }
function restaurantAccount(){ return (typeof Auth!=='undefined'&&Auth.currentAccount)?Auth.currentAccount():null; }
function restaurantBoundStoreId(){
  const acc=restaurantAccount();
  return String(acc?.storeId||DB.currentUser?.storeId||'').trim();
}
function restaurantIsStoreStaff(){ return String(restaurantAccount()?.roleId||DB.currentUser?.roleId||'')==='ROLE_RESTAURANT_STAFF'; }
function restaurantCanAccessStore(storeId){
  const bound=restaurantBoundStoreId();
  return !restaurantIsStoreStaff() || (!!bound && String(storeId||'')===bound);
}
function restaurantVisibleStores(){
  const rows=(DB.stores||[]).filter(s=>s.status!=='inactive');
  return restaurantIsStoreStaff()?rows.filter(s=>restaurantCanAccessStore(s.id)):rows;
}
function restaurantVisibleOrders(source=DB.posOrders||[]){ return (source||[]).filter(o=>restaurantCanAccessStore(o.storeId)); }
function restaurantVisibleStocks(source=DB.restaurantStoreStocks||[]){ return (source||[]).filter(x=>restaurantCanAccessStore(x.storeId)); }
function restaurantVisibleReplenishments(source=DB.storeReplenishmentRequests||[]){ return (source||[]).filter(x=>restaurantCanAccessStore(x.storeId)); }
function restaurantVisibleStockTransactions(source=DB.restaurantStoreStockTransactions||[]){ return (source||[]).filter(x=>restaurantCanAccessStore(x.storeId)); }
function restaurantDashboardRange(period='day', selection={}){
  const today=restaurantToday();
  const pad=n=>String(n).padStart(2,'0');
  const ymd=x=>`${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;
  const safeDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):today;
  const currentYear=Number(today.slice(0,4))||new Date().getFullYear();
  let start, end, label='';

  if(period==='day'){
    const value=safeDate(selection.date||today);
    start=end=new Date(`${value}T12:00:00`);
    label=`Ngày ${fmtDate(value)}`;
  } else if(period==='week'){
    // input[type=week] trả YYYY-Www. Nếu chưa chọn thì lấy tuần ISO hiện tại.
    let week=String(selection.week||'');
    if(!/^\d{4}-W\d{2}$/.test(week)){
      const d=new Date(`${today}T12:00:00`), tmp=new Date(d);
      tmp.setHours(0,0,0,0); tmp.setDate(tmp.getDate()+3-((tmp.getDay()+6)%7));
      const week1=new Date(tmp.getFullYear(),0,4);
      const no=1+Math.round(((tmp-week1)/86400000-3+((week1.getDay()+6)%7))/7);
      week=`${tmp.getFullYear()}-W${pad(no)}`;
    }
    const [yearPart,weekPart]=week.split('-W');
    const year=Number(yearPart), weekNo=Number(weekPart);
    const jan4=new Date(year,0,4,12); const jan4Dow=(jan4.getDay()+6)%7;
    start=new Date(jan4); start.setDate(jan4.getDate()-jan4Dow+(weekNo-1)*7);
    end=new Date(start); end.setDate(start.getDate()+6);
    label=`Tuần ${weekNo}/${year}`;
  } else if(period==='month'){
    let month=String(selection.month||today.slice(0,7));
    if(!/^\d{4}-\d{2}$/.test(month)) month=today.slice(0,7);
    const [y,m]=month.split('-').map(Number);
    start=new Date(y,m-1,1,12); end=new Date(y,m,0,12);
    label=`Tháng ${m}/${y}`;
  } else if(period==='quarter'){
    const year=Math.min(2100,Math.max(2000,Number(selection.year)||currentYear));
    const quarter=Math.min(4,Math.max(1,Number(selection.quarter)||Math.floor((Number(today.slice(5,7))-1)/3)+1));
    const qm=(quarter-1)*3;
    start=new Date(year,qm,1,12); end=new Date(year,qm+3,0,12);
    label=`Quý ${quarter}/${year}`;
  } else {
    const year=Math.min(2100,Math.max(2000,Number(selection.year)||currentYear));
    start=new Date(year,0,1,12); end=new Date(year,11,31,12);
    label=`Năm ${year}`;
  }
  return {from:ymd(start),to:ymd(end),label};
}
function restaurantReplenishment(id){ return (DB.storeReplenishmentRequests||[]).find(x=>x.id===id); }
function restaurantItem(id){ return Q.product(id)||Q.material(id); }
function restaurantFinishedWarehouses(){ return (DB.warehouses||[]).filter(w=>w.type==='FINISHED_GOODS'&&w.status!=='inactive'); }
function restaurantStockItemId(row){ return String(row?.productId||row?.materialId||row?.itemId||'').trim(); }
function restaurantRecipeItemId(item){ return String(item?.materialId||item?.productId||item?.itemId||'').trim(); }
function restaurantStoreQty(storeId, productId){
  const target=String(productId||'').trim();
  return (DB.restaurantStoreStocks||[])
    .filter(r=>r.storeId===storeId&&restaurantStockItemId(r)===target)
    // qtyOnHand là tồn vật lý. Reservation của đơn nhà hàng được trừ riêng ở restaurantStoreUsableQty,
    // tránh dùng qtyAvailable rồi trừ reservation lần hai.
    .reduce((sum,r)=>sum+Number(r.qtyOnHand??r.qtyAvailable??0),0);
}
function restaurantMinStock(productId){ return Number(Q.material(productId)?.minStock || DB.finishedMinStock?.[productId] || 0); }
function restaurantReplenishmentStatus(status){ const m={REQUESTED:['Chờ kho xử lý','orange'],ISSUED:['Kho đã xuất · chờ cửa hàng nhận','blue'],PARTIAL_RECEIVED:['Đã nhận một phần · còn thiếu','orange'],RECEIVED:['Cửa hàng đã nhập đủ','green'],CANCELLED:['Đã hủy','gray']}; const x=m[status]||[status||'—','gray']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`; }
function restaurantRequestItems(req){
  if(Array.isArray(req?.items)&&req.items.length) return req.items.map(x=>({productId:x.productId,quantity:Number(x.quantity||0)})).filter(x=>x.productId&&x.quantity>0);
  if(req?.productId&&Number(req?.quantity||0)>0) return [{productId:req.productId,quantity:Number(req.quantity||0)}];
  return [];
}
// Theo dõi nhiều đợt xuất/nhận cho cùng một YCBS. Các request cũ chỉ có issuedLines
// được xem như một đợt legacy để không làm mất lịch sử đã xuất trước đây.
function restaurantReplenishmentIssueBatches(req){
  if(Array.isArray(req?.issueBatches)&&req.issueBatches.length) return req.issueBatches.map((b,i)=>({
    id:b.id||b.goodsIssueId||`BATCH-${i+1}`, goodsIssueId:b.goodsIssueId||'', goodsIssueIds:b.goodsIssueIds || [b.goodsIssueId].filter(Boolean), transferId:b.transferId||'',
    issuedLines:Array.isArray(b.issuedLines)?b.issuedLines:[], issuedAt:b.issuedAt||'', issuedBy:b.issuedBy||'',
    receivedAt:b.receivedAt||'', receivedBy:b.receivedBy||''
  }));
  const legacyLines=Array.isArray(req?.issuedLines)?req.issuedLines:[];
  if(!legacyLines.length) return [];
  // Request legacy đã ở RECEIVED nghĩa là số thực tế đã xuất ở issuedLines cũng đã được cửa hàng nhận.
  const legacyReceived=req?.status==='RECEIVED'||req?.status==='PARTIAL_RECEIVED'||!!req?.receivedAt;
  return [{id:req?.goodsIssueId||req?.transferId||'LEGACY-1',goodsIssueId:req?.goodsIssueId||'',transferId:req?.transferId||'',issuedLines:legacyLines,issuedAt:req?.issuedAt||'',issuedBy:req?.issuedBy||'',receivedAt:legacyReceived?(req?.receivedAt||req?.issuedAt||req?.createdAt||'legacy'):'',receivedBy:legacyReceived?(req?.receivedBy||''):''}];
}
function restaurantReplenishmentProgress(req){
  const requested=restaurantRequestItems(req), batches=restaurantReplenishmentIssueBatches(req), eps=1e-6;
  const issuedMap=new Map(), receivedMap=new Map();
  for(const b of batches){
    for(const line of (b.issuedLines||[])){
      const pid=String(line.productId||''); if(!pid)continue;
      const qty=Number(line.qty??line.quantity??0); issuedMap.set(pid,(issuedMap.get(pid)||0)+qty);
      if(b.receivedAt) receivedMap.set(pid,(receivedMap.get(pid)||0)+qty);
    }
  }
  const items=requested.map(it=>{
    const requestedQty=Number(it.quantity||0), issuedQty=Number(issuedMap.get(it.productId)||0), receivedQty=Number(receivedMap.get(it.productId)||0);
    return {productId:it.productId,requestedQty,issuedQty,receivedQty,remainingToIssue:Math.max(0,requestedQty-issuedQty),waitingReceive:Math.max(0,issuedQty-receivedQty),remainingToReceive:Math.max(0,requestedQty-receivedQty)};
  });
  const hasPendingBatch=batches.some(b=>!b.receivedAt&&(b.issuedLines||[]).some(x=>Number(x.qty??x.quantity??0)>eps));
  const anyIssued=items.some(x=>x.issuedQty>eps), anyReceived=items.some(x=>x.receivedQty>eps);
  const allReceived=items.length>0&&items.every(x=>x.remainingToReceive<=eps);
  let status=req?.status==='CANCELLED'?'CANCELLED':hasPendingBatch?'ISSUED':allReceived?'RECEIVED':(anyIssued||anyReceived)?'PARTIAL_RECEIVED':'REQUESTED';
  return {status,items,batches,remainingToIssueTotal:items.reduce((s,x)=>s+x.remainingToIssue,0),remainingToReceiveTotal:items.reduce((s,x)=>s+x.remainingToReceive,0),issuedTotal:items.reduce((s,x)=>s+x.issuedQty,0),receivedTotal:items.reduce((s,x)=>s+x.receivedQty,0)};
}
function restaurantReplenishmentDerivedStatus(req){ return restaurantReplenishmentProgress(req).status; }

function restaurantReplenishmentSuggestions(){
  const rows=[];
  for(const store of restaurantVisibleStores()){
    const sourceWarehouseId=store.sourceWarehouseId||'';
    if(!sourceWarehouseId) continue;
    const productIds=[...new Set((DB.restaurantStoreStocks||[]).filter(x=>x.storeId===store.id).map(x=>x.productId))];
    for(const productId of productIds){
      const min=restaurantMinStock(productId); if(min<=0) continue;
      const qty=restaurantStoreQty(store.id,productId);
      if(qty<=min){ const target=Math.max(min*2,min); rows.push({store,productId,qty,min,suggested:Math.max(0,target-qty)}); }
    }
  }
  return rows;
}
function restaurantRecipe(id){ return (DB.restaurantRecipes||[]).find(x=>x.id===id); }
function restaurantOrderTotal(order){ return (order?.items||[]).reduce((s,i)=>s+Number(i.quantity||0)*Number(i.price||0),0); }
function restaurantChannelLabel(channel){ return ({POS:'POS tại quầy',TABLET:'Tablet Ordering',QR:'QR Ordering'})[channel||'POS'] || channel || 'POS tại quầy'; }
function restaurantStatus(status){
  const m={PAID:['Đã thanh toán','green'],OPEN:['Chờ bếp','orange'],KITCHEN_WAITING:['Chờ bếp','orange'],COOKING:['Đang chế biến','blue'],READY:['Món đã hoàn thành','teal'],SERVED:['Đã phục vụ','indigo'],CANCELLED:['Đã hủy','gray']}; const x=m[status]||[status||'—','gray'];
  return `<span class="badge ${x[1]}">${esc(x[0])}</span>`;
}

function restaurantOrderDate(order){ return String(order?.paidAt||order?.createdAt||order?.date||'').slice(0,10); }
function restaurantOrderPaymentLabel(value){
  const v=String(value||'').trim();
  return v||'—';
}
function restaurantBankAccount(id){ return (DB.bankAccounts||[]).find(x=>String(x.id)===String(id)); }
function restaurantEligibleBankAccounts(storeId){
  // Thanh toán tại cửa hàng phải ưu tiên đúng tài khoản đã gắn với cửa hàng của đơn.
  // Chỉ fallback về tài khoản Công ty khi cửa hàng CHƯA được khai báo tài khoản riêng.
  const active=(DB.bankAccounts||[]).filter(x=>x.active!==false);
  const storeRows=active.filter(x=>x.scopeType==='STORE' && String(x.storeId||'')===String(storeId||''));
  const rows=storeRows.length ? storeRows : active.filter(x=>x.scopeType==='COMPANY');
  return rows.sort((a,b)=>Number(b.isDefault)-Number(a.isDefault) || String(a.bankName||a.name||'').localeCompare(String(b.bankName||b.name||''),'vi'));
}
function restaurantBankScopeLabel(a){
  if(a?.scopeType==='STORE') return restaurantStore(a.storeId)?.name||a.storeId||'Chi nhánh';
  return 'Công ty Lê Nam';
}
function restaurantBankInfoHtml(a){
  if(!a) return '<div class="note-box"><b>Chưa có tài khoản nhận tiền phù hợp</b><div class="cell-sub">Hãy khai báo tài khoản Công ty hoặc tài khoản của chi nhánh này.</div></div>';
  return `<div class="note-box"><div class="detail-grid"><div><span>Ngân hàng</span><b>${esc(a.bankName||a.name||'—')}</b></div><div><span>Số tài khoản</span><b class="code">${esc(a.accountNumber||'—')}</b></div><div><span>Chủ tài khoản</span><b>${esc(a.accountName||a.ownerName||'—')}</b></div><div><span>Phạm vi</span><b>${esc(restaurantBankScopeLabel(a))}</b></div>${a.branch?`<div><span>Chi nhánh NH</span><b>${esc(a.branch)}</b></div>`:''}</div></div>`;
}
function restaurantPaymentMethodChanged(orderId){
  const order=(DB.posOrders||[]).find(x=>x.id===orderId); if(!order)return;
  const method=$('#restaurantOrderPayment')?.value||'Tiền mặt';
  const entry=typeof accountingResolveRestaurantEntry==='function'?accountingResolveRestaurantEntry(method):null;
  const hidden=$('#restaurantOrderAccountingEntry'); if(hidden) hidden.value=entry?.id||'';
  const display=$('#restaurantOrderAccountingEntryDisplay'); if(display) display.textContent=entry?`${entry.number||entry.id} · ${entry.name||''}`:`Chưa cấu hình định khoản bán hàng ${method.toLowerCase()}`;
  const host=$('#restaurantBankPaymentArea'); if(!host)return;
  if(method!=='Chuyển khoản'){ host.innerHTML=''; return; }
  const accounts=restaurantEligibleBankAccounts(order.storeId);
  if(!accounts.length){ host.innerHTML=restaurantBankInfoHtml(null); return; }
  const selected=accounts[0];
  host.innerHTML=`<div class="field"><label>Tài khoản nhận tiền *</label><select class="inp" id="restaurantOrderBankAccount" onchange="restaurantRenderSelectedBankAccount()">${accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.bankName)} · ${esc(a.accountNumber)} · ${esc(restaurantBankScopeLabel(a))}</option>`).join('')}</select></div><div id="restaurantBankAccountInfo">${restaurantBankInfoHtml(selected)}</div>`;
}
function restaurantRenderSelectedBankAccount(){
  const a=restaurantBankAccount($('#restaurantOrderBankAccount')?.value); const host=$('#restaurantBankAccountInfo'); if(host)host.innerHTML=restaurantBankInfoHtml(a);
}
function restaurantFilterOrders(key, source){
  const f=F(key,{q:'',storeId:'',channel:'',status:'',dateFrom:'',dateTo:''});
  const q=String(f.q||'').trim().toLowerCase();
  return (source||[]).filter(o=>{
    if(f.storeId&&o.storeId!==f.storeId)return false;
    if(f.channel&&(o.channel||'POS')!==f.channel)return false;
    if(f.status&&o.status!==f.status)return false;
    const d=String(o.date||restaurantOrderDate(o)||'').slice(0,10);
    if(f.dateFrom&&d<f.dateFrom)return false;
    if(f.dateTo&&d>f.dateTo)return false;
    const store=restaurantStore(o.storeId);
    const hay=[o.id,store?.name,o.tableNo,o.shift,o.payment,restaurantChannelLabel(o.channel),...(o.items||[]).map(i=>restaurantRecipe(i.recipeId)?.name||i.recipeId)].join(' ').toLowerCase();
    return !q||hay.includes(q);
  });
}
function restaurantTabs(active){
  const orderTabs=['pos','tablet','qr','orders'];
  if(!orderTabs.includes(active)) return '';
  return `<div class="tabs restaurant-order-tabs" style="margin-bottom:16px">
    ${[
      {id:'pos',label:'POS bán hàng',icon:'fa-cash-register'},
      {id:'tablet',label:'Tablet Ordering',icon:'fa-tablet-screen-button'},
      {id:'qr',label:'QR Ordering',icon:'fa-qrcode'},
      {id:'orders',label:'Danh sách đơn hàng',icon:'fa-receipt'}
    ].map(tab=>`<button class="tab restaurant-order-tab ${active===tab.id?'active':''}" data-act="nav" data-id="restaurant" data-tab="${tab.id}"><i class="fa-solid ${tab.icon}"></i><span>${esc(tab.label)}</span></button>`).join('')}
  </div>`;
}

function restaurantOrderRows(list){
  return (list||[]).map(order=>{
    const store=restaurantStore(order.storeId); const total=restaurantOrderTotal(order);
    const acts=[{act:'restaurant-order-view',data:`data-id="${esc(order.id)}"`,icon:'fa-eye',title:'Xem chi tiết'}];
    if(['READY','SERVED'].includes(order.status)) acts.push({act:'restaurant-order-pay',data:`data-id="${esc(order.id)}"`,icon:'fa-credit-card',title:'Thanh toán'});
    if(['OPEN','KITCHEN_WAITING'].includes(order.status)) acts.push({act:'restaurant-order-delete',data:`data-id="${esc(order.id)}"`,icon:'fa-trash',title:'Hủy đơn trước khi bếp chế biến'});
    return `<tr><td><span class="code">${esc(order.id)}</span></td><td>${fmtDate(order.date)}</td><td>${esc(store?.name||order.storeId)}</td><td>${esc(restaurantChannelLabel(order.channel))}</td><td>${esc(order.tableNo||'—')}</td><td>${esc(order.shift||'—')}</td><td class="right num">${fmtVND(total)}</td><td>${restaurantStatus(order.status)}</td><td>${rowActions(acts)}</td></tr>`;
  }).join('');
}
function restaurantRecipeRows(mode='menu'){
  const rf=F('restaurant-recipe',{storeId:''});
  const activeStores=restaurantVisibleStores();
  const checkStoreId=rf.storeId||activeStores[0]?.id||'';
  return (DB.restaurantRecipes||[]).map(r=>{
    const foodCost=restaurantRecipeFoodCost(r);
    let detail=esc(r.unit||'');
    if(mode==='recipe'){
      const av=restaurantPosAvailability(r,checkStoreId);
      detail=(r.items||[]).map(i=>{
        const id=restaurantRecipeItemId(i), master=Q.material?.(id)||Q.product?.(id), need=Number(i.quantity||i.qty||0);
        const d=(av.details||[]).find(x=>x.itemId===id); const lack=d?d.usable+1e-9<need:false;
        const text=`${esc(master?.name||id)}: ${fmtDec(need,3)} ${esc(i.unit||master?.unit||'')}`;
        return lack?`<strong>${text}</strong>`:text;
      }).join('<br>');
    }
    return `<tr><td><span class="code">${esc(r.id)}</span></td><td>${cell2(esc(r.name),esc(r.group||''))}</td><td class="right num">${fmtVND(r.price||0)}</td>${mode==='recipe'?`<td>${detail||'—'}</td><td class="right num">${fmtVND(foodCost)}</td>`:`<td>${detail}</td>`}<td>${r.active!==false?'<span class="badge green">Đang bán</span>':'<span class="badge gray">Ngừng bán</span>'}</td><td>${rowActions([{act:'restaurant-recipe-view',data:`data-id="${esc(r.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},{act:'restaurant-recipe-edit',data:`data-id="${esc(r.id)}"`,icon:'fa-pen',title:'Sửa'},{act:'restaurant-recipe-delete',data:`data-id="${esc(r.id)}"`,icon:'fa-trash',title:'Xóa'}])}</td></tr>`;
  }).join('');
}
function restaurantStoreStockRows(){
  return restaurantVisibleStocks().map(x=>{
    const st=restaurantStore(x.storeId); const p=Q.product(x.productId)||restaurantItem(x.productId);
    return `<tr><td>${esc(st?.name||x.storeId)}</td><td><span class="code">${esc(x.productId)}</span></td><td>${esc(p?.name||x.productId)}</td><td class="right num">${fmtDec(x.qtyAvailable??x.qtyOnHand??0,3)} ${esc(p?.unit||x.unit||'')}</td><td>${esc(x.lotId||'—')}</td></tr>`;
  }).join('');
}


function restaurantReplenishmentSiteId(storeId, sourceId) {
  const id=sourceId || restaurantStore(storeId)?.sourceWarehouseId || '';
  if ((DB.warehouseSites || []).some(s=>s.id===id)) return id;
  if ((DB.warehouses || []).some(w=>w.siteId===id)) return id;
  const zone=Q.warehouse(id);
  return zone?.siteId || (typeof warehouseSiteIdOf==='function' ? warehouseSiteIdOf(zone) : '') || '';
}
function restaurantReplenishmentWarehouses(storeId, sourceId) {
  const linked=sourceId || restaurantStore(storeId)?.sourceWarehouseId || '';
  const siteId=restaurantReplenishmentSiteId(storeId,linked);
  return (DB.warehouses || []).filter(w=>w.status!=='inactive' &&
    ['RAW_MATERIAL','FINISHED_GOODS'].includes(w.type) &&
    (siteId ? restaurantReplenishmentSiteId(storeId,w.id)===siteId : w.id===linked));
}
function restaurantReplenishmentSourceId(storeId) {
  return restaurantStore(storeId)?.sourceWarehouseId || '';
}
function restaurantReplenishmentSourceLabel(storeId, req) {
  const linked=req?.sourceSiteId || req?.sourceWarehouseId || restaurantReplenishmentSourceId(storeId);
  const siteId=restaurantReplenishmentSiteId(storeId,linked);
  const site=(DB.warehouseSites || []).find(s=>s.id===siteId);
  if (site) return site.name;
  const name=Q.warehouse(req?.sourceWarehouseId || restaurantReplenishmentSourceId(storeId))?.name || '';
  return name.replace(/^(Kho|Khu)\s+(thành phẩm|nguyên liệu)\s*[-–:]\s*/i,'Kho ') || 'Chưa liên kết kho nguồn';
}
function restaurantRequestSourceWarehouses(req) {
  // Legacy requests stay bound to their original zone; new requests bind to a physical site.
  if (req?.sourceSiteId) return restaurantReplenishmentWarehouses(req.storeId,req.sourceSiteId);
  const zone=Q.warehouse(req?.sourceWarehouseId || restaurantReplenishmentSourceId(req?.storeId));
  return zone && zone.status!=='inactive' && ['RAW_MATERIAL','FINISHED_GOODS'].includes(zone.type) ? [zone] : [];
}
function restaurantSourceProducts(storeId, sourceId) {
  const zoneIds=new Set(restaurantReplenishmentWarehouses(storeId,sourceId).map(w=>w.id));
  const members=new Set((DB.inventory || []).filter(r=>zoneIds.has(r.warehouseId)).map(r=>r.productId || r.materialId));
  return [...(DB.products || []),...(DB.materials || [])]
    .filter(p=>p?.id && members.has(p.id) && p.active!==false && !['inactive','INACTIVE'].includes(p.status))
    .sort((a,b)=>String(a.name||a.id).localeCompare(String(b.name||b.id),'vi',{sensitivity:'base',numeric:true}))
    .map(p=>p.id).filter((id,i,ids)=>ids.indexOf(id)===i);
}
function restaurantReplenishmentItemLabel(id) {
  const item=restaurantItem(id);
  return item ? `${id} — ${item.name || id} (${item.unit || ''})` : '';
}
function restaurantRefreshReplenishmentWarehouses() {
  const storeId=document.getElementById('rrStore')?.value || '';
  const label=document.getElementById('rrSourceWarehouseLabel');
  if (label) label.value=restaurantReplenishmentSourceLabel(storeId);
  restaurantRefreshReplenishmentProducts();
}
function restaurantReplenishmentLineHtml(storeId,item={}) {
  const ids=restaurantSourceProducts(storeId);
  const selected=ids.includes(item.productId)?item.productId:'';
  return `<div class="restaurant-replenishment-line" style="display:grid;grid-template-columns:minmax(260px,1fr) 150px 42px;gap:8px;align-items:end;margin-bottom:8px">
    <div class="field" style="margin:0"><label>Hàng hóa *</label><div class="rr-product-picker">
      <input type="hidden" class="rr-product-select" value="${esc(selected)}">
      <div class="rr-product-search-wrap"><input class="inp rr-product-search" role="combobox" aria-label="Tìm hàng hóa theo mã hoặc tên" aria-autocomplete="list" aria-expanded="false" autocomplete="off" placeholder="Nhập mã hoặc tên hàng hóa để tìm…" value="${esc(restaurantReplenishmentItemLabel(selected))}" onfocus="restaurantSearchReplenishmentItems(this)" oninput="restaurantSearchReplenishmentItems(this,true)" onkeydown="restaurantReplenishmentSearchKey(event,this)"><button class="rr-product-toggle" type="button" data-act="restaurant-replenishment-toggle" aria-label="Mở danh sách hàng hóa"><i class="fa-solid fa-chevron-down"></i></button></div>
      <div class="rr-product-options" role="listbox" hidden></div></div></div>
    <div class="field" style="margin:0"><label>Số lượng *</label><input class="inp right num rr-qty" type="number" min="0.001" step="0.001" value="${Number(item.quantity || 1)}"></div>
    <button class="btn btn-sm" type="button" data-act="restaurant-replenishment-remove-line" title="Xóa dòng"><i class="fa-solid fa-trash"></i></button></div>`;
}
function restaurantRefreshReplenishmentProducts() {
  const storeId=document.getElementById('rrStore')?.value || '';
  const ids=restaurantSourceProducts(storeId);
  document.querySelectorAll('#rrLines .restaurant-replenishment-line').forEach(row=>{
    const selected=row.querySelector('.rr-product-select'), input=row.querySelector('.rr-product-search'), menu=row.querySelector('.rr-product-options');
    if (!ids.includes(selected.value)) selected.value='';
    input.value=restaurantReplenishmentItemLabel(selected.value);
    if (menu) menu.hidden=true;
    input.setAttribute('aria-expanded','false');
  });
}
function restaurantReplenishmentSearchText(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().trim();
}
function restaurantSearchReplenishmentItems(input, edited=false) {
  const row=input.closest('.restaurant-replenishment-line'); if (!row) return;
  const selected=row.querySelector('.rr-product-select'), menu=row.querySelector('.rr-product-options');
  if (edited) selected.value='';
  const q=selected.value && !edited ? '' : restaurantReplenishmentSearchText(input.value);
  const storeId=document.getElementById('rrStore')?.value || '';
  const ids=restaurantSourceProducts(storeId).filter(id=>restaurantReplenishmentSearchText(restaurantReplenishmentItemLabel(id)).includes(q));
  document.querySelectorAll('.rr-product-options').forEach(other=>{if(other!==menu){other.hidden=true;other.closest('.rr-product-picker')?.querySelector('.rr-product-search')?.setAttribute('aria-expanded','false');}});
  menu.innerHTML=ids.length ? ids.map(id=>`<button class="rr-product-option" type="button" role="option" data-act="restaurant-replenishment-pick" data-product="${esc(id)}" aria-selected="${id===selected.value?'true':'false'}"><strong>${esc(restaurantItem(id)?.name || id)}</strong><span>${esc(id)} · ${esc(restaurantItem(id)?.unit || '')} · ${Q.material(id)?'Nguyên liệu':'Thành phẩm'}</span></button>`).join('') : '<div class="rr-product-empty">Không có hàng hóa phù hợp trong kho nguồn.</div>';
  menu.hidden=false;input.setAttribute('aria-expanded','true');row.dataset.activeOption='-1';
  const rect=input.getBoundingClientRect?.(), boundary=input.closest('.modal-body')?.getBoundingClientRect?.();
  menu.classList.toggle('rr-product-options-above',!!rect && !!boundary && boundary.bottom-rect.bottom<160 && rect.top-boundary.top>160);
}
function restaurantSelectReplenishmentItem(row,id) {
  const storeId=document.getElementById('rrStore')?.value || '';
  if (!restaurantSourceProducts(storeId).includes(id)) return;
  row.querySelector('.rr-product-select').value=id;
  const input=row.querySelector('.rr-product-search');input.value=restaurantReplenishmentItemLabel(id);input.setAttribute('aria-expanded','false');
  row.querySelector('.rr-product-options').hidden=true;
}
function restaurantReplenishmentSearchKey(event,input) {
  const row=input.closest('.restaurant-replenishment-line'), menu=row?.querySelector('.rr-product-options');if(!menu)return;
  if(event.key==='Escape'){if(!menu.hidden){event.preventDefault();event.stopPropagation?.();}menu.hidden=true;input.setAttribute('aria-expanded','false');return;}
  if(!['ArrowDown','ArrowUp','Enter'].includes(event.key))return;
  event.preventDefault();
  event.stopPropagation?.();
  if(menu.hidden)restaurantSearchReplenishmentItems(input);
  const options=[...menu.querySelectorAll('.rr-product-option')];if(!options.length)return;
  let index=Number(row.dataset.activeOption ?? -1);
  if(event.key==='Enter'){restaurantSelectReplenishmentItem(row,options[Math.max(0,index)]?.dataset.product);return;}
  index=event.key==='ArrowDown'?Math.min(options.length-1,index+1):Math.max(0,index-1);
  row.dataset.activeOption=String(index);options.forEach((o,i)=>o.classList.toggle('rr-product-option-active',i===index));options[index].scrollIntoView?.({block:'nearest'});
}
if (!window.__restaurantReplenishmentPickerBound) {
  window.__restaurantReplenishmentPickerBound=true;
  document.addEventListener('click',event=>{
    if(event.target.closest?.('.rr-product-picker'))return;
    document.querySelectorAll('.rr-product-options').forEach(menu=>{menu.hidden=true;menu.closest('.rr-product-picker')?.querySelector('.rr-product-search')?.setAttribute('aria-expanded','false');});
  });
}

function openRestaurantReplenishmentForm(prefill={}){
  DB.storeReplenishmentRequests=DB.storeReplenishmentRequests||[];
  const stores=restaurantVisibleStores();
  const selectedStore=(prefill.storeId?restaurantStore(prefill.storeId):null)||stores[0];
  const sourceWarehouseId=selectedStore?.sourceWarehouseId||'';
  const initItems=Array.isArray(prefill.items)&&prefill.items.length?prefill.items:[{productId:prefill.productId||'',quantity:Number(prefill.quantity||1)}];
  Modal.open({title:'Yêu cầu bổ sung hàng',sub:'Yêu cầu nguyên liệu và thành phẩm từ kho nguồn của cửa hàng. Gõ mã hoặc tên hàng để tìm.',size:'lg',body:`
    <div class="form-grid cols-2">
      <div class="field"><label>Cửa hàng *</label><select class="inp" id="rrStore" onchange="restaurantRefreshReplenishmentWarehouses()" ${stores.length?'':'disabled'}>${stores.length?stores.map(s=>`<option value="${esc(s.id)}" ${s.id===selectedStore?.id?'selected':''}>${esc(s.name)}${s.sourceWarehouseId?'':' · chưa liên kết kho'}</option>`).join(''):'<option value="">Chưa có chi nhánh hoạt động</option>'}</select>${stores.length?'':'<div class="cell-sub" style="color:var(--red)">Chưa đọc được chi nhánh từ server. Hãy tạo/kiểm tra Chi nhánh trước.</div>'}</div>
      <div class="field"><label>Kho nguồn</label><input class="inp" id="rrSourceWarehouseLabel" value="${esc(restaurantReplenishmentSourceLabel(selectedStore?.id))}" readonly></div>
    </div>
    <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>Danh sách hàng hóa cần bổ sung</div>
    <div id="rrLines">${initItems.map(it=>restaurantReplenishmentLineHtml(selectedStore?.id||'',it)).join('')}</div>
    <button class="btn btn-sm" type="button" data-act="restaurant-replenishment-add-line"><i class="fa-solid fa-plus"></i>Thêm hàng hóa</button>
    <div class="field" style="margin-top:12px"><label>Ghi chú</label><input class="inp" id="rrNote" placeholder="Ví dụ: bổ sung cho ca bán cuối tuần"></div>
    <div class="alert-item" style="margin-top:12px"><i class="fa-solid fa-circle-info"></i><div><b>Luồng nhập hàng cửa hàng</b><div class="muted">Chọn nguyên liệu và thành phẩm thuộc kho nguồn trên cùng phiếu → Kho xuất đúng khu/lô → Cửa hàng xác nhận nhập. Tồn cửa hàng chỉ tăng sau khi nhận.</div></div></div>`,
    foot:'<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="restaurant-replenishment-save"><i class="fa-solid fa-paper-plane"></i>Gửi yêu cầu</button>'});
}
function openRestaurantReplenishmentFulfill(id){
  const req=restaurantReplenishment(id); if(!req)return;
  const progress=restaurantReplenishmentProgress(req);
  if(!['REQUESTED','PARTIAL_RECEIVED'].includes(progress.status))return;
  const store=restaurantStore(req.storeId); const sourceWarehouseId=req.sourceWarehouseId||store?.sourceWarehouseId||'';
  const sourceWarehouse=Q.warehouse(sourceWarehouseId);
  const sourceIds=new Set(restaurantRequestSourceWarehouses(req).map(w=>w.id));
  const items=progress.items.filter(x=>x.remainingToIssue>1e-6).map(x=>({productId:x.productId,quantity:x.remainingToIssue,requestedQty:x.requestedQty,issuedQty:x.issuedQty}));
  const rows=items.map(it=>{
    const item=Q.product(it.productId)||restaurantItem(it.productId);
    const available=(DB.inventory||[]).filter(r=>sourceIds.has(r.warehouseId)&&r.productId===it.productId&&Number(r.qtyAvailable??r.qtyOnHand??0)>0&&inventoryRowIsUsableForIssue(r)).reduce((sum,r)=>sum+Number(r.qtyAvailable??r.qtyOnHand??0),0);
    return `<tr><td><span class="code">${esc(it.productId)}</span><div class="cell-sub">${esc(item?.name||it.productId)}</div></td><td class="right num">${fmtDec(it.requestedQty,3)} ${esc(item?.unit||'')}</td><td class="right num">${fmtDec(it.issuedQty,3)} ${esc(item?.unit||'')}</td><td class="right num strong">${fmtDec(it.quantity,3)} ${esc(item?.unit||'')}</td><td class="right num">${fmtDec(available,3)} ${esc(item?.unit||'')}</td><td style="width:160px"><input class="inp right num rr-approved-qty" data-product="${esc(it.productId)}" data-remaining="${Number(it.quantity||0)}" type="number" min="0.001" step="0.001" value="${Number(it.quantity||0)}"></td></tr>`;
  }).join('');
  const canIssue=sourceIds.size>0&&items.length>0;
  Modal.open({title:`Kho xuất hàng · ${esc(req.id)}`,sub:`${esc(store?.name||req.storeId)} · xuất phần còn thiếu`,size:'lg',body:`<div class="detail-grid"><div><span>Kho nguồn</span><b>${esc(restaurantReplenishmentSourceLabel(req.storeId,req))}</b></div><div><span>Trạng thái yêu cầu</span><b>${restaurantReplenishmentStatus(progress.status)}</b></div></div><div class="form-sec-title" style="margin-top:14px">Chi tiết xuất phần còn thiếu</div>${tableShell([{t:'Hàng hóa'},{t:'Yêu cầu',cls:'right'},{t:'Đã xuất',cls:'right'},{t:'Còn thiếu',cls:'right'},{t:'Tồn khả dụng',cls:'right'},{t:'SL kho xuất'}],rows,{emptyTitle:'Yêu cầu đã được xuất đủ'})}${canIssue?'':'<div class="alert-item"><i class="fa-solid fa-triangle-exclamation"></i><div><b>Không còn phần cần xuất hoặc Kho nguồn chưa đủ điều kiện</b><div class="muted">Chỉ phần còn thiếu mới được phép xuất tiếp.</div></div></div>'}`,foot:`<button class="btn" data-act="modal-close">Đóng</button>${canIssue?`<button class="btn btn-primary" data-act="restaurant-replenishment-fulfill-save" data-id="${esc(req.id)}"><i class="fa-solid fa-truck-ramp-box"></i>Xác nhận xuất phần còn thiếu</button>`:''}`});
}

function restaurantRemoteOrderLineHtml(it={},storeId=''){
  const recipes=(DB.restaurantRecipes||[]).filter(recipe=>recipe.active!==false);
  const options=recipes.map(recipe=>{
    const av=restaurantPosAvailability(recipe,storeId||restaurantStore($('#posStore')?.value)?.id||'');
    const disabled=!av.available; const suffix=disabled?' · Tạm hết':` · còn ~${fmtN(av.maxQty)} phần`;
    return `<option value="${esc(recipe.id)}" ${recipe.id===it.recipeId?'selected':''} ${disabled?'disabled':''}>${esc(recipe.name)} · ${fmtVND(recipe.price)}/${esc(recipe.unit)}${esc(suffix)}</option>`;
  }).join('');
  return `<div class="restaurant-remote-order-line" style="display:grid;grid-template-columns:minmax(0,1fr) 110px 42px;gap:8px;align-items:end;margin-bottom:8px">
    <div class="field" style="margin:0"><label>Món</label><select class="inp remote-recipe">${options}</select></div>
    <div class="field" style="margin:0"><label>Số lượng</label><input class="inp num remote-qty" type="number" min="1" step="1" value="${Math.max(1,Number(it.quantity||1))}"></div>
    <button class="btn btn-sm" type="button" data-act="restaurant-remote-remove-line" title="Xóa món"><i class="fa-solid fa-trash"></i></button>
  </div>`;
}
function restaurantRemoteRefreshAvailability(){
  const storeId=$('#posStore')?.value||'';
  document.querySelectorAll('.restaurant-remote-order-line').forEach(row=>{
    const sel=row.querySelector('.remote-recipe'); const qty=row.querySelector('.remote-qty'); if(!sel)return;
    const current=sel.value;
    [...sel.options].forEach(opt=>{
      const recipe=restaurantRecipe(opt.value); const av=restaurantPosAvailability(recipe,storeId);
      opt.disabled=!av.available;
      const base=recipe?`${recipe.name} · ${fmtVND(recipe.price)}/${recipe.unit}`:opt.textContent.split(' · Tạm hết')[0];
      opt.textContent=av.available?`${base} · còn ~${fmtN(av.maxQty)} phần`:`${base} · Tạm hết`;
    });
    const currentOpt=[...sel.options].find(o=>o.value===current&&!o.disabled);
    if(currentOpt) sel.value=current; else { const first=[...sel.options].find(o=>!o.disabled); if(first)sel.value=first.value; }
    const av=restaurantPosAvailability(restaurantRecipe(sel.value),storeId);
    if(qty){ qty.max=String(Math.max(1,av.maxQty||1)); if(Number(qty.value||1)>av.maxQty&&av.maxQty>0)qty.value=String(av.maxQty); qty.disabled=!av.available; }
  });
  restaurantRemoteOrderRefreshTotal();
}
function restaurantRemoteOrderRefreshTotal(){
  const el=document.getElementById('restaurantRemoteOrderTotal'); if(!el)return;
  let total=0;
  document.querySelectorAll('.restaurant-remote-order-line').forEach(row=>{
    const recipe=restaurantRecipe(row.querySelector('.remote-recipe')?.value);
    const qty=Math.max(0,Number(row.querySelector('.remote-qty')?.value||0));
    total+=Number(recipe?.price||0)*qty;
  });
  el.textContent=fmtVND(total);
}
function openRestaurantPos(channel='POS') {
  restaurantHydrate();
  const isRemote=channel==='TABLET'||channel==='QR';
  if(isRemote){
    const recipes=(DB.restaurantRecipes||[]).filter(recipe=>recipe.active!==false);
    Modal.open({
      title: channel==='TABLET'?'Tạo đơn Tablet':'Tạo đơn QR',
      sub:'Chọn nhiều món trong cùng một đơn. Đơn được gửi về POS và chờ nhân viên xử lý/thanh toán.', size:'lg',
      body:`<input type="hidden" id="posChannel" value="${esc(channel)}">
        <div class="form-grid cols-2"><div class="field"><label>Cửa hàng</label><select class="inp" id="posStore" onchange="restaurantRemoteRefreshAvailability()">${restaurantVisibleStores().map(store=>`<option value="${esc(store.id)}">${esc(store.name)}</option>`).join('')}</select></div><div class="field"><label>Ca bán hàng</label><select class="inp" id="posShift"><option>Ca sáng</option><option>Ca trưa</option><option>Ca tối</option></select></div></div>
        <div class="field"><label>Bàn / Mã nhận đơn *</label><input class="inp" id="posTable" placeholder="Ví dụ: Bàn 05"></div>
        <div class="form-sec-title"><i class="fa-solid fa-utensils"></i>Danh sách món</div>
        <div id="restaurantRemoteOrderLines">${recipes.length?restaurantRemoteOrderLineHtml({},restaurantVisibleStores()[0]?.id||''):'<div class="empty-state"><b>Chưa có món đang bán</b><div>Hãy khai báo Menu / Công thức món trước.</div></div>'}</div>
        ${recipes.length?'<button class="btn btn-sm" type="button" data-act="restaurant-remote-add-line"><i class="fa-solid fa-plus"></i>Thêm món</button>':''}
        <div class="detail-grid" style="margin-top:14px"><div><span>Tạm tính</span><b id="restaurantRemoteOrderTotal">${fmtVND(recipes[0]?.price||0)}</b></div><div><span>Trạng thái sau khi gửi</span><b>Chờ POS xử lý</b></div></div>`,
      foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="restaurant-pos-save" ${recipes.length?'':'disabled'}><i class="fa-solid fa-paper-plane"></i>Gửi đơn</button>`
    });
    setTimeout(()=>{
      document.querySelectorAll('.restaurant-remote-order-line .remote-recipe,.restaurant-remote-order-line .remote-qty').forEach(el=>el.addEventListener('change',restaurantRemoteOrderRefreshTotal));
      restaurantRemoteRefreshAvailability();
    },0);
    return;
  }
  Modal.open({
    title:'POS bán hàng tại quầy',
    sub:'Chọn món và số lượng; hệ thống tự lấy Recipe để tính thành phẩm sử dụng tại cửa hàng.', size:'md',
    body: `<input type="hidden" id="posChannel" value="POS"><div class="form-grid"><div class="field"><label>Cửa hàng</label><select class="inp" id="posStore">${restaurantVisibleStores().map(store=>`<option value="${store.id}">${esc(store.name)}</option>`).join('')}</select></div><div class="field"><label>Ca bán hàng</label><select class="inp" id="posShift"><option>Ca sáng</option><option>Ca trưa</option><option>Ca tối</option></select></div></div><div class="field"><label>Món bán</label><select class="inp" id="posRecipe">${(DB.restaurantRecipes||[]).filter(recipe=>recipe.active!==false).map(recipe=>`<option value="${recipe.id}">${esc(recipe.name)} · ${fmtVND(recipe.price)}/${esc(recipe.unit)}</option>`).join('')}</select></div><div class="form-grid"><div class="field"><label>Số lượng</label><input class="inp num" id="posQty" type="number" min="1" value="1" /></div><div class="field"><label>Thanh toán</label><select class="inp" id="posPayment"><option>Tiền mặt</option><option>Chuyển khoản</option><option>Ví điện tử</option></select></div></div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="restaurant-pos-save"><i class="fa-solid fa-check"></i>Thanh toán và ghi kho</button>`
  });
}
function restaurantRecipeComponent(id){
  return Q.material(id) || (DB.products||[]).find(x=>x.id===id) || null;
}
function restaurantRecipeComponentType(id){
  return Q.material(id) ? 'RAW_MATERIAL' : 'FINISHED_GOODS';
}
function restaurantRecipeComponentOptions(selected=''){
  const raw=(DB.materials||[]).filter(x=>x.status!=='inactive');
  const finished=(DB.products||[]).filter(x=>x.status!=='inactive');
  return `<option value="">— Chọn nguyên liệu / thành phẩm —</option>`
    +(raw.length?`<optgroup label="Nguyên liệu">${raw.map(m=>`<option value="${esc(m.id)}" ${m.id===selected?'selected':''}>${esc(m.id)} — ${esc(m.name)} (${esc(m.unit||'')})</option>`).join('')}</optgroup>`:'')
    +(finished.length?`<optgroup label="Thành phẩm">${finished.map(m=>`<option value="${esc(m.id)}" ${m.id===selected?'selected':''}>${esc(m.id)} — ${esc(m.name)} (${esc(m.unit||'')})</option>`).join('')}</optgroup>`:'');
}
function restaurantRecipeComponentUnitCost(id){
  // Food Cost của món dùng đúng ĐƠN GIÁ MASTER của thành phần.
  // - Nguyên liệu: ưu tiên price/unitPrice đang lưu trong master nguyên liệu.
  // - Thành phẩm SP-*: dùng trực tiếp product.price (Đơn giá thành phẩm), KHÔNG lấy Q.costOf/unitCost.
  //   Ví dụ SP-008 = 35.000đ/Hộp thì Recipe 1 Hộp phải đóng góp đúng 35.000đ vào Food Cost.
  const material = Q.material?.(id) || (DB.materials||[]).find(x=>String(x.id)===String(id));
  if(material){
    return Number(material.price ?? material.unitPrice ?? material.lastPrice ?? material.cost ?? 0) || 0;
  }
  const product = Q.product?.(id) || (DB.products||[]).find(x=>String(x.id)===String(id));
  if(product){
    return Number(product.price ?? product.unitPrice ?? 0) || 0;
  }
  return 0;
}
function restaurantRecipeFoodCost(recipe){
  return (recipe?.items||[]).reduce((sum,it)=>{
    const id=restaurantRecipeItemId(it);
    const qty=Number(it.quantity||it.qty||0);
    return sum + qty * restaurantRecipeComponentUnitCost(id);
  },0);
}
function restaurantRecipeDraftFoodCost(){
  let total=0;
  document.querySelectorAll('.restaurant-recipe-line').forEach(row=>{
    const id=row.querySelector('[name="material"]')?.value||'';
    const qty=Number(row.querySelector('[name="qty"]')?.value||0);
    if(id&&qty>0) total += qty * restaurantRecipeComponentUnitCost(id);
  });
  return total;
}
function restaurantRefreshRecipeFoodCost(){
  document.querySelectorAll('.restaurant-recipe-line').forEach(row=>{
    const id=row.querySelector('[name=\"material\"]')?.value||'';
    const qty=Number(row.querySelector('[name=\"qty\"]')?.value||0);
    const unitCost=restaurantRecipeComponentUnitCost(id);
    const unitEl=row.querySelector('[name=\"unitCostDisplay\"]');
    const lineEl=row.querySelector('[name=\"lineCostDisplay\"]');
    if(unitEl) unitEl.value=id?new Intl.NumberFormat('vi-VN').format(Math.round(unitCost)):'';
    if(lineEl) lineEl.value=id?new Intl.NumberFormat('vi-VN').format(Math.round(unitCost*qty)):'';
  });
  const el=document.getElementById('restaurantRecipeFoodCost');
  if(!el) return;
  const value=restaurantRecipeDraftFoodCost();
  el.value = new Intl.NumberFormat('vi-VN').format(Math.round(value));
  el.dataset.value=String(value);
  const hint=document.getElementById('restaurantRecipeFoodCostHint');
  const price=parseMoney(document.getElementById('restaurantRecipePrice')?.value||0);
  if(hint){
    const gross=price-value;
    const pct=price>0?(value/price*100):0;
    hint.textContent=price>0?`Food Cost ${pct.toFixed(1)}% · Lãi gộp dự kiến ${new Intl.NumberFormat('vi-VN').format(Math.round(gross))}đ`:'Food Cost = tổng (định lượng × đơn giá/giá thành hiện tại) của nguyên liệu và thành phẩm trong công thức.';
  }
}
function openRestaurantRecipeForm(id=''){
  const r=restaurantRecipe(id)||{id:'',name:'',group:'Món chính',price:0,unit:'Phần',active:true,items:[]};
  const line=(it={})=>{ const c=restaurantRecipeComponent(it.materialId); const unitCost=restaurantRecipeComponentUnitCost(it.materialId||''); const qty=Number(it.quantity||1); return `<div class="restaurant-recipe-line" style="display:grid;grid-template-columns:125px minmax(250px,1fr) 105px 90px 120px 120px 42px;gap:8px;margin-bottom:8px;align-items:center"><select class="inp" name="itemType" disabled><option>${it.materialId?(Q.material(it.materialId)?'Nguyên liệu':'Thành phẩm'):'Tự nhận diện'}</option></select><select class="inp" name="material">${restaurantRecipeComponentOptions(it.materialId||'')}</select><input class="inp right num" name="qty" type="number" min="0.0001" step="0.0001" value="${qty}"><input class="inp" name="unitDisplay" value="${esc(it.unit||c?.unit||'')}" placeholder="ĐVT" readonly><input class="inp right num" name="unitCostDisplay" value="${unitCost?new Intl.NumberFormat('vi-VN').format(Math.round(unitCost)):''}" placeholder="0" readonly><input class="inp right num" name="lineCostDisplay" value="${unitCost?new Intl.NumberFormat('vi-VN').format(Math.round(unitCost*qty)):''}" placeholder="0" readonly><button class="btn btn-sm" type="button" data-act="restaurant-recipe-remove-line"><i class="fa-solid fa-trash"></i></button></div>`; };
  Modal.open({title:id?`Sửa món · ${id}`:'Thêm món / công thức',size:'xl',body:`<input type="hidden" id="restaurantRecipeId" value="${esc(id)}"><div class="form-grid cols-2"><div class="field"><label>Tên món *</label><input class="inp" id="restaurantRecipeName" value="${esc(r.name)}"></div><div class="field"><label>Nhóm</label><input class="inp" id="restaurantRecipeGroup" value="${esc(r.group||'')}"></div><div class="field"><label>Đơn vị</label><input class="inp" id="restaurantRecipeUnit" value="${esc(r.unit||'Phần')}"></div><div class="field"><label>Giá bán *</label><input class="inp right num" id="restaurantRecipePrice" data-money="1" type="text" inputmode="numeric" min="0" value="${Number(r.price||0)}" oninput="restaurantRefreshRecipeFoodCost()"></div><div class="field" style="grid-column:1/-1"><label>Food Cost tự động theo giá nguyên liệu</label><input class="inp right num" id="restaurantRecipeFoodCost" type="text" readonly value="0"><div class="cell-sub" id="restaurantRecipeFoodCostHint">Food Cost tự tính từ định lượng × đơn giá hiện tại của nguyên liệu / thành phẩm.</div></div></div><div class="form-sec-title"><i class="fa-solid fa-list"></i>Định lượng nguyên liệu / thành phẩm dùng chế biến món</div><div class="cell-sub" style="margin:-4px 0 10px">Có thể chọn nguyên liệu mua ngoài (dầu ăn, sả, ớt, gia vị...) hoặc thành phẩm Lê Nam làm nguyên liệu chính của món.</div><div style="display:grid;grid-template-columns:125px minmax(250px,1fr) 105px 90px 120px 120px 42px;gap:8px;margin-bottom:6px;padding:0 2px"><b>Loại</b><b>Nguyên liệu / thành phẩm</b><b class="right">Định lượng</b><b>Đơn vị</b><b class="right">Đơn giá</b><b class="right">Thành tiền</b><span></span></div><div id="restaurantRecipeLines">${(r.items||[]).length?r.items.map(line).join(''):line()}</div><button class="btn btn-sm" type="button" data-act="restaurant-recipe-add-line"><i class="fa-solid fa-plus"></i>Thêm nguyên liệu / thành phẩm</button><div class="field" style="margin-top:12px"><label><input type="checkbox" id="restaurantRecipeActive" ${r.active!==false?'checked':''}> Đang kinh doanh</label></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="restaurant-recipe-save"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`});
  setTimeout(()=>{
    document.querySelectorAll('.restaurant-recipe-line').forEach(row=>{
      const sel=row.querySelector('[name="material"]');
      const qty=row.querySelector('[name="qty"]');
      if(sel) sel.addEventListener('change',()=>{
        const c=restaurantRecipeComponent(sel.value);
        const type=row.querySelector('[name="itemType"]'); if(type) type.innerHTML=`<option>${sel.value?(Q.material(sel.value)?'Nguyên liệu':'Thành phẩm'):'Tự nhận diện'}</option>`;
        const unit=row.querySelector('[name="unitDisplay"]'); if(unit) unit.value=c?.unit||'';
        restaurantRefreshRecipeFoodCost();
      });
      if(qty) qty.addEventListener('input',restaurantRefreshRecipeFoodCost);
    });
    restaurantRefreshRecipeFoodCost();
  },0);
}
function openRestaurantStoreForm(id=''){
  const finishedWarehouses=restaurantFinishedWarehouses();
  const s=restaurantStore(id)||{name:'',code:'',sourceWarehouseId:finishedWarehouses[0]?.id||'',address:'',status:'active'};
  const selected=s.sourceWarehouseId || (Q.warehouse(s.warehouseId)?.type==='FINISHED_GOODS'?s.warehouseId:'') || finishedWarehouses[0]?.id || '';
  Modal.open({title:id?`Sửa chi nhánh · ${id}`:'Thêm chi nhánh',size:'md',body:`<input type="hidden" id="restaurantStoreId" value="${esc(id)}"><div class="form-grid cols-2"><div class="field"><label>Mã chi nhánh</label><input class="inp" id="restaurantStoreCode" value="${esc(s.code||'')}"></div><div class="field"><label>Tên chi nhánh *</label><input class="inp" id="restaurantStoreName" value="${esc(s.name||'')}"></div><div class="field"><label>Kho thành phẩm nguồn *</label><select class="inp" id="restaurantStoreWarehouse">${finishedWarehouses.map(w=>`<option value="${esc(w.id)}" ${w.id===selected?'selected':''}>${esc(w.name)}</option>`).join('')}</select><div class="cell-sub">Chỉ chọn Kho Thành phẩm - Thủ Đức / Bình Dương / Đồng Nai.</div></div><div class="field"><label>Trạng thái</label><select class="inp" id="restaurantStoreStatus"><option value="active" ${s.status!=='inactive'?'selected':''}>Hoạt động</option><option value="inactive" ${s.status==='inactive'?'selected':''}>Ngưng hoạt động</option></select></div></div><div class="field"><label>Địa chỉ</label><input class="inp" id="restaurantStoreAddress" value="${esc(s.address||'')}"></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="restaurant-store-save"><i class="fa-solid fa-floppy-disk"></i>Lưu</button>`});
}
function openRestaurantOrderDetail(id){
  const o=(DB.posOrders||[]).find(x=>x.id===id); if(!o||!restaurantCanAccessStore(o.storeId))return; const store=restaurantStore(o.storeId);
  const rows=(o.items||[]).map(i=>{const r=restaurantRecipe(i.recipeId);return `<tr><td><span class="code">${esc(i.recipeId)}</span></td><td>${esc(r?.name||i.recipeId)}</td><td class="right num">${fmtN(i.quantity)}</td><td class="right num">${fmtVND(i.price)}</td><td class="right num">${fmtVND(Number(i.quantity||0)*Number(i.price||0))}</td></tr>`;}).join('');
  Modal.open({title:`Chi tiết đơn · ${esc(o.id)}`,size:'lg',body:`<div class="detail-grid"><div><span>Cửa hàng</span><b>${esc(store?.name||o.storeId)}</b></div><div><span>Ngày</span><b>${fmtDate(o.date)}</b></div><div><span>Kênh</span><b>${esc(restaurantChannelLabel(o.channel))}</b></div><div><span>Bàn / Mã</span><b>${esc(o.tableNo||'—')}</b></div><div><span>Ca</span><b>${esc(o.shift||'—')}</b></div><div><span>Thanh toán</span><b>${esc(restaurantOrderPaymentLabel(o.payment))}</b>${o.payment==='Chuyển khoản'&&o.bankAccountSnapshot?`<div class="cell-sub">${esc(o.bankAccountSnapshot.bankName||'')} · ${esc(o.bankAccountSnapshot.accountNumber||'')}</div>`:''}</div><div><span>Trạng thái</span><b>${restaurantStatus(o.status)}</b></div></div><div class="form-sec-title" style="margin-top:14px">Món đã gọi</div>${tableShell([{t:'Mã'},{t:'Món'},{t:'SL',cls:'right'},{t:'Đơn giá',cls:'right'},{t:'Thành tiền',cls:'right'}],rows)}<div class="right strong" style="font-size:18px;margin-top:12px">Tổng: ${fmtVND(restaurantOrderTotal(o))}</div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button>${['READY','SERVED'].includes(o.status)?`<button class="btn btn-primary" data-act="restaurant-order-pay" data-id="${esc(o.id)}"><i class="fa-solid fa-credit-card"></i>Thanh toán</button>`:''}`});
}
function restaurantOrderMaterialNeeds(order){
  const needs={};
  for(const item of order?.items||[]){
    const recipe=restaurantRecipe(item.recipeId); if(!recipe)continue;
    for(const b of recipe.items||[]){
      const materialId=restaurantRecipeItemId(b); const qty=Number(b.quantity||b.qty||0)*Number(item.quantity||item.qty||0);
      if(materialId&&qty>0) needs[materialId]=(needs[materialId]||0)+qty;
    }
  }
  return needs;
}
function restaurantReservedNeeds(storeId,excludeOrderId=''){
  const reserved={};
  const reservingStatuses=new Set(['OPEN','KITCHEN_WAITING','COOKING']);
  for(const order of DB.posOrders||[]){
    if(order.storeId!==storeId||order.id===excludeOrderId||order.inventoryPostedAt||!reservingStatuses.has(order.status))continue;
    const needs=restaurantOrderMaterialNeeds(order);
    for(const [materialId,qty] of Object.entries(needs)) reserved[materialId]=(reserved[materialId]||0)+Number(qty||0);
  }
  return reserved;
}
function restaurantStoreUsableQty(storeId,materialId,excludeOrderId=''){
  const physical=restaurantStoreQty(storeId,materialId);
  const reserved=restaurantReservedNeeds(storeId,excludeOrderId)[materialId]||0;
  return Math.max(0,physical-reserved);
}
function restaurantCanFulfill(order){
  const store=restaurantStore(order.storeId); if(!store)return {ok:false,message:'Không tìm thấy cửa hàng.'};
  const needs=restaurantOrderMaterialNeeds(order);
  for(const [productId,qty] of Object.entries(needs)){
    const available=restaurantStoreUsableQty(store.id,productId,order.id||'');
    if(available+1e-9<qty){
      const master=Q.material?.(productId)||Q.product?.(productId);
      return {ok:false,message:`${master?.name||productId}: cần ${fmtDec(qty,3)}, khả dụng ${fmtDec(available,3)} sau khi trừ lượng đã giữ cho các order khác.`};
    }
  }
  return {ok:true,store,needs};
}
function restaurantPostOrder(order){
  if(order.inventoryPostedAt) return {ok:true}; const check=restaurantCanFulfill(order); if(!check.ok)return check;
  DB.restaurantStoreStockTransactions=DB.restaurantStoreStockTransactions||[];
  for(const [productId,need] of Object.entries(check.needs)){
    let remaining=need;
    const stocks=(DB.restaurantStoreStocks||[]).filter(r=>r.storeId===check.store.id&&restaurantStockItemId(r)===productId&&Number(r.qtyOnHand??r.qtyAvailable??0)>0).sort((a,b)=>String(Q.lot(a.lotId)?.expiryDate||a.expiryDate||'9999').localeCompare(String(Q.lot(b.lotId)?.expiryDate||b.expiryDate||'9999')));
    for(const stock of stocks){ if(remaining<=0)break; const take=Math.min(remaining,Number(stock.qtyOnHand??stock.qtyAvailable??0)); const before=Number(stock.qtyOnHand??stock.qtyAvailable??0); stock.qtyOnHand=Math.max(0,before-take); stock.qtyAvailable=Math.max(0,Number(stock.qtyAvailable??before)-take); stock.updatedAt=new Date().toISOString(); DB.restaurantStoreStockTransactions.unshift({id:`RSTX-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,storeId:check.store.id,productId,lotId:stock.lotId||'',type:'KITCHEN_ISSUE',qty:-take,qtyBefore:before,qtyAfter:stock.qtyOnHand,refType:'KITCHEN',refId:order.id,date:restaurantToday(),createdAt:new Date().toISOString()}); remaining-=take; }
  }
  order.inventoryPostedAt=new Date().toISOString(); return {ok:true};
}

/* POS bán hàng kiểu quầy: danh sách món bên trái, đơn hiện tại bên phải. */
const RestaurantPOSState = window.RestaurantPOSState || (window.RestaurantPOSState = { storeId:'', channel:'POS', shift:'Ca sáng', q:'', cart:[] });
function restaurantPosStore(){
  const stores=restaurantVisibleStores();
  if(!RestaurantPOSState.storeId || !stores.some(x=>x.id===RestaurantPOSState.storeId)) RestaurantPOSState.storeId=stores[0]?.id||'';
  return restaurantStore(RestaurantPOSState.storeId);
}
function restaurantPosCartTotal(){ return (RestaurantPOSState.cart||[]).reduce((s,x)=>s+Number(x.qty||0)*Number(x.price||0),0); }
function restaurantPosQty(recipeId){ return Number((RestaurantPOSState.cart||[]).find(x=>x.recipeId===recipeId)?.qty||0); }
function restaurantPosAvailability(recipe, storeId=RestaurantPOSState.storeId){
  if(!recipe || recipe.active===false || !storeId) return {available:false,maxQty:0,missing:[],details:[],pending:false};
  // Không kết luận "Tạm hết" khi dữ liệu tồn/BOM/đơn giữ chỗ chưa sẵn sàng.
  // Menu vẫn render ngay; trạng thái sẽ tự cập nhật sau khi dữ liệu server về.
  const availabilityKeys=['stores','recipes','orders','storeStocks'];
  const dataReady = typeof RestaurantQualityAPI!=='undefined' && (
    (typeof RestaurantQualityAPI.hasSnapshot==='function' && RestaurantQualityAPI.hasSnapshot(availabilityKeys)) ||
    (typeof RestaurantQualityAPI.areFresh==='function' && RestaurantQualityAPI.areFresh(availabilityKeys))
  );
  if(!dataReady) return {available:false,maxQty:0,missing:[],details:[],pending:true};
  const items=(recipe.items||[])
    .map(x=>({ ...x, _itemId:restaurantRecipeItemId(x), _need:Number(x.quantity||x.qty||0) }))
    .filter(x=>x._itemId && x._need>0);
  if(!items.length) return {available:false,maxQty:0,missing:['Chưa có định lượng/BOM'],details:[],pending:false};
  let maxQty=Infinity; const missing=[],details=[];
  const reservedMap=restaurantReservedNeeds(storeId);
  for(const item of items){
    const itemId=item._itemId, need=item._need;
    const physical=restaurantStoreQty(storeId,itemId);
    const reserved=Number(reservedMap[itemId]||0);
    const usable=Math.max(0,physical-reserved);
    const possible=need>0?Math.floor((usable+1e-9)/need):0;
    maxQty=Math.min(maxQty,possible);
    const master=Q.material?.(itemId)||Q.product?.(itemId);
    details.push({itemId,name:master?.name||itemId,need,physical,reserved,usable,possible,unit:item.unit||master?.unit||''});
    if(usable+1e-9<need) missing.push(master?.name||itemId);
  }
  if(!Number.isFinite(maxQty)) maxQty=0;
  return {available:maxQty>0,maxQty:Math.max(0,maxQty),missing,details,pending:false};
}
function restaurantPosAdd(recipeId){
  const r=restaurantRecipe(recipeId); if(!r||r.active===false)return;
  const availability=restaurantPosAvailability(r);
  const current=restaurantPosQty(recipeId);
  if(availability.pending){
    if(typeof Toast!=='undefined') Toast.show?.('Đang kiểm tra tồn kho cửa hàng, vui lòng thử lại ngay sau khi dữ liệu đồng bộ xong.','info');
    restaurantKickDataLoad?.('pos');
    return;
  }
  if(!availability.available || current>=availability.maxQty){
    if(typeof Toast!=='undefined') Toast.show?.('Món tạm hết hoặc không đủ nguyên liệu tại cửa hàng này.','warning');
    return;
  }
  let line=RestaurantPOSState.cart.find(x=>x.recipeId===recipeId);
  if(line) line.qty+=1; else RestaurantPOSState.cart.push({recipeId:r.id,qty:1,price:Number(r.price||0)});
  render();
}
function restaurantPosChange(recipeId,delta){
  const line=RestaurantPOSState.cart.find(x=>x.recipeId===recipeId); if(!line)return;
  line.qty=Math.max(0,Number(line.qty||0)+delta); if(line.qty<=0) RestaurantPOSState.cart=RestaurantPOSState.cart.filter(x=>x.recipeId!==recipeId); render();
}

// POS là điểm tổng hợp đơn tại quầy + đơn gửi lên từ Tablet/QR.
// Chỉ khi POS đang mở mới polling nhẹ collection orders; không reload menu/tồn kho/chi nhánh.
let __restaurantPosOrdersPollTimer = null;
let __restaurantPosOrdersSignature = '';
function restaurantOrdersSignature(){
  return (DB.posOrders||[]).map(o=>`${o.id}|${o.status}|${o.updatedAt||o.paidAt||o.createdAt||''}|${o.channel||'POS'}`).sort().join('~');
}
function restaurantEnsurePosOrderPolling(){
  if(__restaurantPosOrdersPollTimer) return;
  __restaurantPosOrdersSignature = restaurantOrdersSignature();
  __restaurantPosOrdersPollTimer = setInterval(async()=>{
    if(State.module!=='restaurant' || (State.tab||'dashboard')!=='pos'){
      clearInterval(__restaurantPosOrdersPollTimer); __restaurantPosOrdersPollTimer=null; return;
    }
    if(typeof RestaurantQualityAPI==='undefined' || typeof RestaurantQualityAPI.ensureFresh!=='function') return;
    try{
      await RestaurantQualityAPI.ensureFresh(['orders'],{force:true});
      const next=restaurantOrdersSignature();
      if(next!==__restaurantPosOrdersSignature){
        __restaurantPosOrdersSignature=next;
        const active=document.activeElement;
        const editing=active&&['INPUT','SELECT','TEXTAREA'].includes(active.tagName);
        const modalOpen=typeof Modal!=='undefined'&&Modal.isOpen?.();
        if(!editing&&!modalOpen&&typeof render==='function') render();
      }
    }catch(err){ console.warn('[Restaurant POS] Không đồng bộ được đơn Tablet/QR:',err); }
  },6000);
}
function restaurantPosView(){
  restaurantEnsurePosOrderPolling();
  const today=restaurantToday();
  // Dashboard POS chỉ lấy dữ liệu kênh POS; Tablet/QR có dashboard riêng.
  const orders=restaurantVisibleOrders().filter(o=>o.date===today && (o.channel||'POS')==='POS');
  const paid=orders.filter(o=>o.status==='PAID');
  const revenue=paid.reduce((s,o)=>s+restaurantOrderTotal(o),0), avg=paid.length?revenue/paid.length:0;
  const pendingRemote=restaurantVisibleOrders().filter(o=>o.date===today&&['TABLET','QR'].includes(o.channel)&&['OPEN','KITCHEN_WAITING','COOKING','READY','SERVED'].includes(o.status)).sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||'')));
  const pendingRemoteRows=pendingRemote.map(o=>{
    const store=restaurantStore(o.storeId);
    const acts=[{act:'restaurant-order-view',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem đơn'}]; if(['READY','SERVED'].includes(o.status)) acts.push({act:'restaurant-order-pay',data:`data-id="${esc(o.id)}"`,icon:'fa-credit-card',title:'Thanh toán'});
    return `<tr><td><span class="code">${esc(o.id)}</span><div class="cell-sub">${esc(restaurantChannelLabel(o.channel))}</div></td><td>${esc(store?.name||o.storeId)}</td><td>${esc(o.tableNo||'—')}</td><td>${esc(o.shift||'—')}</td><td class="right num">${fmtVND(restaurantOrderTotal(o))}</td><td>${restaurantStatus(o.status)}</td><td>${rowActions(acts)}</td></tr>`;
  }).join('');
  const q=String(RestaurantPOSState.q||'').toLowerCase();
  const recipeStates=(DB.restaurantRecipes||[])
    .filter(r=>r.active!==false && (!q || `${r.name} ${r.group||''}`.toLowerCase().includes(q)))
    .map(r=>({recipe:r,stock:restaurantPosAvailability(r)}))
    .sort((a,b)=>Number(b.stock.available)-Number(a.stock.available) || String(a.recipe.group||'').localeCompare(String(b.recipe.group||''),'vi') || String(a.recipe.name||'').localeCompare(String(b.recipe.name||''),'vi'));
  const recipes=recipeStates.map(x=>x.recipe);
  const groups=[...new Set(recipes.map(r=>r.group||'Khác'))];
  const productCards=recipeStates.map(({recipe:r,stock})=>{
    const qty=restaurantPosQty(r.id); const fc=restaurantRecipeFoodCost(r);
    const pending=!!stock.pending;
    const soldOut=!pending && !stock.available;
    const stockText=pending?'Đang kiểm tra tồn…':(soldOut?'Tạm hết':`Còn bán được khoảng ${fmtN(stock.maxQty)} phần`);
    const disabled=pending||soldOut;
    return `<button class="restaurant-pos-product ${soldOut?'is-sold-out':''} ${pending?'is-checking':''}" ${disabled?'disabled aria-disabled="true"':''} data-act="restaurant-pos-add" data-id="${esc(r.id)}"><div class="restaurant-pos-product-icon"><i class="fa-solid fa-bowl-food"></i></div><b>${esc(r.name)}</b><span>${esc(r.group||'Món')}</span><strong>${fmtVND(r.price||0)}</strong>${qty?`<em>${qty}</em>`:''}<small>Food cost ${fmtVND(fc)}</small><small class="restaurant-pos-stock ${soldOut?'out':''}">${pending?'<i class="fa-solid fa-spinner fa-spin"></i> ':(soldOut?'<i class="fa-solid fa-circle-xmark"></i> ':'<i class="fa-solid fa-circle-check"></i> ')}${esc(stockText)}</small></button>`;
  }).join('');
  const cartRows=(RestaurantPOSState.cart||[]).map(x=>{const r=restaurantRecipe(x.recipeId);return `<div class="restaurant-pos-cart-row"><div><b>${esc(r?.name||x.recipeId)}</b><span>${fmtVND(x.price)}</span></div><div class="restaurant-pos-stepper"><button data-act="restaurant-pos-dec" data-id="${esc(x.recipeId)}">−</button><b>${fmtN(x.qty)}</b><button data-act="restaurant-pos-inc" data-id="${esc(x.recipeId)}">+</button></div><strong>${fmtVND(Number(x.qty)*Number(x.price))}</strong></div>`}).join('') || `<div class="restaurant-pos-empty"><i class="fa-solid fa-basket-shopping"></i><b>Chưa có món trong đơn</b><span>Chọn món ở danh sách bên trái để bắt đầu bán hàng.</span></div>`;
  const storeOptions=restaurantVisibleStores().map(s=>`<option value="${esc(s.id)}" ${RestaurantPOSState.storeId===s.id?'selected':''}>${esc(s.name)}</option>`).join('');
  return `${pageHead('POS bán hàng','Tổng quan và tạo đơn bán trực tiếp tại quầy POS','')}
  ${restaurantTabs('pos')}
  <div class="grid g-auto-sm restaurant-pos-kpis" style="margin-bottom:16px">${mkpi('Doanh thu hôm nay',fmtVND(revenue),'fa-money-bill-wave','green')}${mkpi('Đơn hàng',orders.length,'fa-receipt','blue')}${mkpi('Giá trị đơn bình quân',fmtVND(avg),'fa-chart-line','orange')}${mkpi('Đơn POS hôm nay',orders.length,'fa-cash-register','teal')}</div>
  <div class="restaurant-pos-layout">
    <div class="card restaurant-pos-catalog"><div class="card-head"><div><h3><i class="fa-solid fa-utensils"></i> Chọn món</h3><p>Menu lấy trực tiếp từ Menu / Công thức món hiện có.</p></div></div>
      <div class="toolbar"><div class="search"><i class="fa-solid fa-magnifying-glass"></i><input id="restaurantPosSearch" value="${esc(RestaurantPOSState.q||'')}" placeholder="Tìm món..." oninput="window.RestaurantPOSState.q=this.value;render()"></div><span class="spacer"></span><span class="chip">${recipes.length} món</span></div>
      <div class="restaurant-pos-groups">${groups.map(g=>`<span class="chip">${esc(g)}</span>`).join('')}</div>
      <div class="restaurant-pos-products">${productCards||'<div class="empty">Không có món phù hợp.</div>'}</div>
    </div>
    <div class="card restaurant-pos-order"><div class="card-head"><div><h3><i class="fa-solid fa-basket-shopping"></i> Đơn hiện tại</h3><p>${fmtN(RestaurantPOSState.cart.length)} dòng món</p></div><button class="btn btn-sm" data-act="restaurant-pos-clear">Xóa đơn</button></div>
      <div class="form-grid cols-2 restaurant-pos-order-meta"><div class="field"><label>Chi nhánh</label><select class="inp" id="restaurantPosStore" onchange="window.RestaurantPOSState.storeId=this.value;render()">${storeOptions}</select></div><div class="field"><label>Kênh bán</label><input class="inp" id="restaurantPosChannel" value="POS tại quầy" disabled></div><div class="field"><label>Ca bán hàng</label><select class="inp" id="restaurantPosShift" onchange="window.RestaurantPOSState.shift=this.value"><option ${RestaurantPOSState.shift==='Ca sáng'?'selected':''}>Ca sáng</option><option ${RestaurantPOSState.shift==='Ca trưa'?'selected':''}>Ca trưa</option><option ${RestaurantPOSState.shift==='Ca tối'?'selected':''}>Ca tối</option></select></div><div class="field"><label>Kho thành phẩm nguồn</label><input class="inp" disabled value="${esc(Q.warehouseName(restaurantPosStore()?.sourceWarehouseId)||'Chưa liên kết')}"></div></div>
      <div class="restaurant-pos-cart">${cartRows}</div>
      <div class="restaurant-pos-summary"><div><span>Tạm tính</span><b>${fmtVND(restaurantPosCartTotal())}</b></div><div class="total"><span>Tổng thanh toán</span><strong>${fmtVND(restaurantPosCartTotal())}</strong></div></div>
      <button class="btn btn-primary restaurant-pos-pay" data-act="restaurant-pos-checkout" ${RestaurantPOSState.cart.length?'':'disabled'}><i class="fa-solid fa-credit-card"></i> Gửi đơn xuống bếp</button>
    </div>
  </div>`;
}


/* --------------------------------------------------------------------------
 * Restaurant view data gate
 * Không được dùng DB cache/rỗng để kết luận món "Tạm hết". Các màn có kiểm tra
 * khả năng chế biến chỉ render menu sau khi đủ Stores + Recipe + Orders đang giữ
 * nguyên liệu + Store Stock từ server trong phiên hiện tại.
 * -------------------------------------------------------------------------- */
const __restaurantViewLoad = window.__restaurantViewLoad || (window.__restaurantViewLoad = { promise:null, key:'' });
function restaurantRequiredKeys(tab){
  const t=tab==='menu'?'recipe':tab;
  const map={
    dashboard:['stores','recipes','orders','storeStocks','storeStockTransactions'],
    pos:['stores','recipes','orders','storeStocks'],
    tablet:['stores','recipes','orders','storeStocks'],
    qr:['stores','recipes','orders','storeStocks'],
    kitchen:['stores','recipes','orders','storeStocks'],
    recipe:['stores','recipes','orders','storeStocks'],
    orders:['stores','recipes','orders'],
    store_stock:['stores','storeStocks','storeStockTransactions'],
    replenishment:['stores','replenishments','storeStocks'],
    issue:['stores','storeStockTransactions'],
    revenue:['stores','orders'],
    reports:['stores','recipes','orders','storeStocks','storeStockTransactions'],
  };
  return map[t]||[];
}
function restaurantDataReady(tab){
  const keys=restaurantRequiredKeys(tab);
  if(!keys.length) return true;
  if(!window.RestaurantQualityAPI) return false;
  // Snapshot gần nhất đã được đọc từ chính KIO server ở lần đồng bộ trước.
  // Cho phép render ngay từ snapshot để F5/chuyển trang không bị khóa màn hình;
  // scheduleRouteDataRefresh sẽ xác minh lại server ở nền và render lại nếu có đổi.
  if(typeof RestaurantQualityAPI.hasSnapshot==='function' && RestaurantQualityAPI.hasSnapshot(keys)) return true;
  return !!(typeof RestaurantQualityAPI.areFresh==='function' && RestaurantQualityAPI.areFresh(keys));
}
function restaurantKickDataLoad(tab){
  const keys=restaurantRequiredKeys(tab); if(!keys.length||!window.RestaurantQualityAPI?.ensureFresh)return;
  const key=`${tab}:${keys.join(',')}`;
  if(__restaurantViewLoad.promise && __restaurantViewLoad.key===key) return;
  __restaurantViewLoad.key=key;
  __restaurantViewLoad.promise=(async()=>{
    try{
      await RestaurantQualityAPI.ensureFresh(keys,{force:false});
    }catch(err){
      console.warn('[Restaurant] Không đồng bộ đủ dữ liệu màn hình:',err);
    }finally{
      __restaurantViewLoad.promise=null;
      if(State.module==='restaurant' && (State.tab||'dashboard')===tab && typeof render==='function') render();
    }
  })();
}
function restaurantLoadingView(tab,title,sub){
  restaurantKickDataLoad(tab);
  return `${pageHead(title,sub,'')}${restaurantTabs(tab)}<div class="card" style="padding:28px;text-align:center"><div style="font-size:28px;margin-bottom:10px"><i class="fa-solid fa-arrows-rotate fa-spin"></i></div><b>Đang đồng bộ dữ liệu cửa hàng...</b><div class="cell-sub" style="margin-top:6px">Đang đọc Menu/BOM, đơn đang giữ nguyên liệu và tồn kho cửa hàng từ server. Hệ thống sẽ không hiển thị “Tạm hết” trước khi dữ liệu này sẵn sàng.</div></div>`;
}


function restaurantRecipeUnitFoodCost(recipe){
  return restaurantRecipeFoodCost(recipe);
}
function restaurantPaidOrders(source){ return (source||DB.posOrders||[]).filter(o=>o.status==='PAID'); }
function restaurantLaborEstimate(orders){
  const keys=new Set();
  (orders||[]).forEach(o=>{ if(o.employeeId&&o.date) keys.add(`${o.employeeId}|${String(o.date).slice(0,10)}`); });
  let cost=0;
  keys.forEach(k=>{ const emp=Q.employee?.(k.split('|')[0]); cost += Number(emp?.salary||0)/26; });
  return {cost,workDays:keys.size};
}
function restaurantRevenueBreakdowns(orders){
  const byStore={},byShift={},byEmployee={},byGroup={};
  for(const o of restaurantPaidOrders(orders)){
    const amount=restaurantOrderTotal(o), store=restaurantStore(o.storeId);
    const st=byStore[o.storeId]||(byStore[o.storeId]={name:store?.name||o.storeId,orders:0,revenue:0}); st.orders++; st.revenue+=amount;
    const sh=o.shift||'Chưa xác định'; const sr=byShift[sh]||(byShift[sh]={name:sh,orders:0,revenue:0}); sr.orders++; sr.revenue+=amount;
    const eid=o.employeeId||''; const en=eid?(Q.employeeName?.(eid)||eid):'Chưa xác định'; const er=byEmployee[eid||'NONE']||(byEmployee[eid||'NONE']={id:eid,name:en,orders:0,revenue:0}); er.orders++; er.revenue+=amount;
    for(const it of o.items||[]){ const r=restaurantRecipe(it.recipeId); const group=r?.group||'Khác'; const gr=byGroup[group]||(byGroup[group]={name:group,qty:0,revenue:0}); gr.qty+=Number(it.quantity||0); gr.revenue+=Number(it.quantity||0)*Number(it.price||0); }
  }
  return {byStore:Object.values(byStore).sort((a,b)=>b.revenue-a.revenue),byShift:Object.values(byShift).sort((a,b)=>b.revenue-a.revenue),byEmployee:Object.values(byEmployee).sort((a,b)=>b.revenue-a.revenue),byGroup:Object.values(byGroup).sort((a,b)=>b.revenue-a.revenue)};
}
function restaurantShortageSummary(){
  const rows=[];
  const stores=restaurantVisibleStores();
  for(const store of stores) for(const recipe of (DB.restaurantRecipes||[]).filter(r=>r.active!==false)){
    const av=restaurantPosAvailability(recipe,store.id);
    if(av.pending||av.available) continue;
    rows.push({store,recipe,missing:av.missing||[]});
  }
  return rows;
}
function restaurantWasteTransactions(){
  return (DB.restaurantStoreStockTransactions||[]).filter(t=>['WASTE','ADJUSTMENT_OUT','KITCHEN_WASTE'].includes(String(t.type||'').toUpperCase()));
}
function restaurantWasteCost(tx){
  const id=restaurantStockItemId(tx), master=Q.material?.(id)||Q.product?.(id)||restaurantItem(id);
  return Math.abs(Number(tx.qty||0))*Number(master?.price||0);
}
function restaurantKitchenPrintHtml(order){
  const store=restaurantStore(order.storeId);
  const items=(order.items||[]).map(i=>`<tr><td>${esc(restaurantRecipe(i.recipeId)?.name||i.recipeId)}</td><td style="text-align:right;font-weight:700">${fmtN(i.quantity)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Phiếu bếp ${esc(order.id)}</title><style>body{font-family:Arial,sans-serif;padding:16px;color:#111}h2{margin:0 0 6px}.meta{font-size:12px;margin-bottom:12px}table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px dashed #bbb} .note{margin-top:12px;font-size:12px}</style></head><body><h2>PHIẾU BẾP</h2><div class="meta"><b>${esc(store?.name||order.storeId)}</b><br>Đơn: ${esc(order.id)} · ${esc(order.tableNo||'Quầy')} · ${esc(order.shift||'')}<br>${esc(restaurantChannelLabel(order.channel))}</div><table>${items}</table><div class="note">In lúc: ${new Date().toLocaleString('vi-VN')}</div><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}<\/script></body></html>`;
}

Views.restaurant = function () {
  restaurantHydrate();
  let tab=State.tab||'dashboard';
  // Tương thích link cũ: Menu/Combo đã được gộp vào Menu / Công thức món.
  if(tab==='menu') tab='recipe';
  if(tab==='reports') tab='dashboard'; // Báo cáo cửa hàng đã tích hợp vào Tổng quan.
  const today=restaurantToday(); const orders=restaurantVisibleOrders(); const todayOrders=orders.filter(o=>o.date===today); const revenue=todayOrders.filter(o=>o.status==='PAID').reduce((s,o)=>s+restaurantOrderTotal(o),0);
  const pageMeta={
    dashboard:['Tổng quan Nhà hàng & Cửa hàng','Doanh thu, đơn hàng, cửa hàng và tình trạng bán hàng theo thời gian thực'],
    pos:['POS bán hàng','Bán hàng tại quầy, thanh toán và tự động trừ tồn điểm bán theo Recipe/BOM'],
    tablet:['Tablet Ordering','Nhân viên phục vụ tạo đơn tại bàn và chuyển đơn về hệ thống xử lý'],
    qr:['QR Ordering','Theo dõi các đơn khách gọi món qua QR và chuyển bếp xử lý'],
    kitchen:['Bếp / Chế biến','Nhận order từ POS / Tablet / QR, chế biến món, hoàn thành và bàn giao phục vụ'],
    recipe:['Menu / Công thức món','Quản lý món bán, giá bán, trạng thái kinh doanh và Recipe/BOM nguyên liệu – thành phẩm'],
    orders:['Đơn hàng Nhà hàng','Theo dõi tập trung đơn POS, Tablet và QR của toàn bộ chi nhánh'],
    branches:['Chi nhánh / Cửa hàng','Mỗi chi nhánh liên kết một Kho thành phẩm nguồn tại Thủ Đức, Bình Dương hoặc Đồng Nai'],
    store_stock:['Tồn kho cửa hàng','Chỉ hiển thị thành phẩm cửa hàng đã thực nhận qua quy trình yêu cầu bổ sung → kho xuất → cửa hàng nhập'],
    replenishment:['Yêu cầu bổ sung hàng','Cửa hàng yêu cầu thành phẩm hoặc nguyên liệu; kho xuất và cửa hàng xác nhận nhập'],
    issue:['Xuất kho nguyên liệu','Theo dõi thành phẩm đã sử dụng tại điểm bán theo đơn POS/Tablet/QR'],
    revenue:['Doanh thu cửa hàng','Theo dõi doanh thu và số đơn theo từng chi nhánh'],
    reports:['Báo cáo Nhà hàng','Doanh thu theo món và dữ liệu phục vụ quản trị Food Cost / hiệu quả bán hàng']
  };
  const meta=pageMeta[tab]||pageMeta.dashboard;
  const headActions = tab==='dashboard'
    ? ''
    : tab==='pos'?`<button class="btn btn-primary" data-act="restaurant-pos-open"><i class="fa-solid fa-cash-register"></i>Bán tại quầy</button>`
    : tab==='tablet'?`<button class="btn btn-primary" data-act="restaurant-tablet-open"><i class="fa-solid fa-tablet-screen-button"></i>Tạo đơn Tablet</button>`
    : tab==='qr'?`<button class="btn btn-primary" data-act="restaurant-qr-open"><i class="fa-solid fa-qrcode"></i>Tạo đơn QR</button>`
    : tab==='recipe'?`<button class="btn btn-primary" data-act="restaurant-recipe-new"><i class="fa-solid fa-plus"></i>Thêm món</button>`
    : tab==='branches'?`<button class="btn btn-primary" data-act="restaurant-store-new"><i class="fa-solid fa-plus"></i>Thêm chi nhánh</button>`
    : tab==='store_stock'?`<button class="btn btn-primary" data-act="restaurant-waste-new"><i class="fa-solid fa-trash-can"></i>Ghi nhận hao hụt</button>`
    : tab==='replenishment'?`<button class="btn btn-primary" data-act="restaurant-replenishment-new"><i class="fa-solid fa-plus"></i>Tạo yêu cầu</button>`:'';
  const head=pageHead(meta[0],meta[1],headActions);
  // Không chặn toàn màn hình để chờ server. Chỉ kick load đúng dữ liệu của tab
  // ở nền; từng món sẽ hiện "Đang kiểm tra tồn…" cho tới khi đủ dữ liệu.
  if(restaurantRequiredKeys(tab).length) restaurantKickDataLoad(tab);
  let body='';
  if(tab==='pos') return restaurantPosView();
  if(tab==='dashboard'){
    const currentYear=Number(today.slice(0,4))||new Date().getFullYear();
    const currentQuarter=Math.floor((Number(today.slice(5,7))-1)/3)+1;
    const df=F('restaurant-dashboard',{period:'day',storeId:'',date:today,week:'',month:today.slice(0,7),quarter:String(currentQuarter),year:String(currentYear)});
    const period=['day','week','month','quarter','year'].includes(df.period)?df.period:'day';
    const range=restaurantDashboardRange(period,df);
    const stores=restaurantVisibleStores();
    if(restaurantIsStoreStaff()) df.storeId=restaurantBoundStoreId();
    else if(df.storeId && !stores.some(s=>s.id===df.storeId)) df.storeId='';
    const scopedOrders=orders.filter(o=>{
      if(df.storeId&&o.storeId!==df.storeId)return false;
      const d=restaurantOrderDate(o)||String(o.date||'').slice(0,10);
      return d>=range.from&&d<=range.to;
    });
    const paid=scopedOrders.filter(o=>o.status==='PAID');
    const liveRevenue=paid.reduce((sum,o)=>sum+restaurantOrderTotal(o),0);
    const bd=restaurantRevenueBreakdowns(paid);
    const shortages=restaurantShortageSummary().filter(x=>!df.storeId||x.store.id===df.storeId);
    const wastePeriod=restaurantVisibleStockTransactions(restaurantWasteTransactions()).filter(t=>{
      if(df.storeId&&t.storeId!==df.storeId)return false;
      const d=String(t.date||t.createdAt||'').slice(0,10); return d>=range.from&&d<=range.to;
    });
    const wasteCost=wastePeriod.reduce((sum,t)=>sum+restaurantWasteCost(t),0);
    const compact=(title,rows,valueKey='revenue',subKey='orders')=>`<div class="card"><div class="card-head"><div><h3>${title}</h3></div></div>${tableShell([{t:'Nhóm'},{t:subKey==='qty'?'SL':'Đơn',cls:'right'},{t:'Doanh thu',cls:'right'}],rows.slice(0,6).map(x=>`<tr><td>${esc(x.name)}</td><td class="right num">${fmtN(x[subKey]||0)}</td><td class="right num strong">${fmtVND(x[valueKey]||0)}</td></tr>`).join(''),{emptyTitle:`Chưa có dữ liệu ${range.label.toLowerCase()}`})}</div>`;
    const shortageRows=shortages.slice(0,8).map(x=>`<tr><td>${esc(x.store.name)}</td><td>${esc(x.recipe.name)}</td><td>${(x.missing||[]).map(id=>`<strong>${esc((Q.material?.(id)||Q.product?.(id)||restaurantItem(id))?.name||id)}</strong>`).join(', ')||'Thiếu định mức'}</td><td>${rowActions([{act:'restaurant-replenishment-new',data:`data-store="${esc(x.store.id)}"`,icon:'fa-paper-plane',title:'Tạo yêu cầu bổ sung'}])}</td></tr>`).join('');
    const selectedStore=stores.find(s=>s.id===df.storeId);
    const yearValues=[...new Set([
      currentYear-3,currentYear-2,currentYear-1,currentYear,currentYear+1,
      ...orders.map(o=>Number(restaurantOrderDate(o)?.slice(0,4)||0)).filter(y=>y>=2000&&y<=2100)
    ])].sort((a,b)=>b-a);
    const yearSelect=`<select class="inp" data-f="restaurant-dashboard.year" title="Chọn năm">${yearValues.map(y=>`<option value="${y}" ${Number(df.year||currentYear)===y?'selected':''}>${y}</option>`).join('')}</select>`;
    const periodPicker=period==='day'
      ? `<input class="inp" type="date" data-f="restaurant-dashboard.date" value="${esc(df.date||today)}" title="Chọn ngày">`
      : period==='week'
        ? `<input class="inp" type="week" data-f="restaurant-dashboard.week" value="${esc(df.week||'')}" title="Chọn tuần">`
        : period==='month'
          ? `<input class="inp" type="month" data-f="restaurant-dashboard.month" value="${esc(df.month||today.slice(0,7))}" title="Chọn tháng">`
          : period==='quarter'
            ? `<select class="inp" data-f="restaurant-dashboard.quarter" title="Chọn quý"><option value="1" ${String(df.quarter)==='1'?'selected':''}>Quý 1</option><option value="2" ${String(df.quarter)==='2'?'selected':''}>Quý 2</option><option value="3" ${String(df.quarter)==='3'?'selected':''}>Quý 3</option><option value="4" ${String(df.quarter)==='4'?'selected':''}>Quý 4</option></select>${yearSelect}`
            : yearSelect;
    const dashboardToolbar=`<div class="card" style="margin-bottom:14px"><div class="toolbar"><select class="inp" data-f="restaurant-dashboard.period"><option value="day" ${period==='day'?'selected':''}>Ngày</option><option value="week" ${period==='week'?'selected':''}>Tuần</option><option value="month" ${period==='month'?'selected':''}>Tháng</option><option value="quarter" ${period==='quarter'?'selected':''}>Quý</option><option value="year" ${period==='year'?'selected':''}>Năm</option></select>${periodPicker}${restaurantIsStoreStaff()?`<span class="chip"><i class="fa-solid fa-store"></i> ${esc(selectedStore?.name||restaurantStore(restaurantBoundStoreId())?.name||'Cửa hàng của tôi')}</span>`:selectFilter('restaurant-dashboard','storeId',stores.map(s=>[s.id,s.name]),'Tất cả cửa hàng')}<span class="spacer"></span><span class="chip">${esc(range.label)} · ${fmtDate(range.from)} → ${fmtDate(range.to)}</span></div></div>`;
    body=`${dashboardToolbar}<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Doanh thu',fmtVND(liveRevenue),'fa-sack-dollar','green')}${mkpi('Đơn đã thanh toán',paid.length,'fa-receipt','blue')}${mkpi('Đơn đang xử lý',scopedOrders.filter(o=>['OPEN','KITCHEN_WAITING','COOKING','READY','SERVED'].includes(o.status)).length,'fa-fire-burner','orange')}${mkpi('Món tạm hết',shortages.length,'fa-triangle-exclamation','red')}${mkpi('Hao hụt',fmtVND(wasteCost),'fa-trash-can','orange')}</div>
      <div class="grid g-2" style="margin-bottom:14px">${compact('Doanh thu theo cửa hàng',bd.byStore)}${compact('Doanh thu theo ca',bd.byShift)}</div>
      <div class="grid g-2" style="margin-bottom:14px">${compact('Doanh thu theo nhân viên',bd.byEmployee)}${compact('Doanh thu theo nhóm món',bd.byGroup,'revenue','qty')}</div>
      <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Cảnh báo thiếu nguyên liệu</h3><p>Tính trực tiếp từ Recipe/BOM và tồn khả dụng của ${restaurantIsStoreStaff()?'cửa hàng đang đăng nhập':'các cửa hàng trong phạm vi xem'}.</p></div></div>${tableShell([{t:'Cửa hàng'},{t:'Món'},{t:'Nguyên liệu thiếu'},{t:'Thao tác'}],shortageRows,{emptyTitle:'Tất cả món đang đủ nguyên liệu'})}</div>
      <div class="card"><div class="card-head"><div><h3>Đơn gần nhất trong kỳ</h3><p>${esc(range.label)} · đúng phạm vi cửa hàng của tài khoản.</p></div></div>${tableShell([{t:'Đơn'},{t:'Ngày'},{t:'Cửa hàng'},{t:'Kênh'},{t:'Bàn'},{t:'Ca'},{t:'Doanh thu',cls:'right'},{t:'Trạng thái'},{t:'Thao tác'}],restaurantOrderRows(scopedOrders.slice().sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||''))).slice(0,10)),{emptyTitle:'Chưa có đơn hàng trong kỳ'})}</div>`;
  } else if(tab==='kitchen'){
    const filterKey='restaurant-kitchen-orders';
    const f=F(filterKey,{q:'',storeId:'',channel:'',status:'',dateFrom:today,dateTo:today});
    const kitchenSource=orders.filter(o=>['OPEN','KITCHEN_WAITING','COOKING','READY','SERVED','PAID'].includes(o.status));
    const kitchenOrders=restaurantFilterOrders(filterKey,kitchenSource).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
    const stores=restaurantVisibleStores();
    const toolbar=`<div class="toolbar">${searchBox(filterKey,'Tìm mã đơn, món, bàn, ca…')}${selectFilter(filterKey,'storeId',stores.map(x=>[x.id,x.name]),'Tất cả cửa hàng')}${selectFilter(filterKey,'channel',[['POS','POS tại quầy'],['TABLET','Tablet'],['QR','QR']],'Tất cả kênh')}${selectFilter(filterKey,'status',[['OPEN','Chờ bếp'],['KITCHEN_WAITING','Chờ bếp'],['COOKING','Đang chế biến'],['READY','Chờ phục vụ'],['SERVED','Đã phục vụ'],['PAID','Đã thanh toán']],'Tất cả trạng thái')}<input class="inp" type="date" data-f="${filterKey}.dateFrom" value="${esc(f.dateFrom||'')}" title="Từ ngày"><input class="inp" type="date" data-f="${filterKey}.dateTo" value="${esc(f.dateTo||'')}" title="Đến ngày"><span class="spacer"></span><span class="chip">${fmtN(kitchenOrders.length)} đơn</span></div>`;
    const rows=kitchenOrders.map(o=>{const store=restaurantStore(o.storeId); const items=(o.items||[]).map(i=>`${fmtN(i.quantity)} × ${esc(restaurantRecipe(i.recipeId)?.name||i.recipeId)}`).join('<br>'); const acts=[{act:'restaurant-order-view',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem đơn'},{act:'restaurant-kitchen-print',data:`data-id="${esc(o.id)}"`,icon:'fa-print',title:'In phiếu bếp'}]; if(['OPEN','KITCHEN_WAITING'].includes(o.status))acts.push({act:'restaurant-kitchen-start',data:`data-id="${esc(o.id)}"`,icon:'fa-fire-burner',title:'Bắt đầu chế biến'}); if(o.status==='COOKING')acts.push({act:'restaurant-kitchen-ready',data:`data-id="${esc(o.id)}"`,icon:'fa-bell-concierge',title:'Hoàn thành món'}); if(o.status==='READY')acts.push({act:'restaurant-kitchen-serve',data:`data-id="${esc(o.id)}"`,icon:'fa-utensils',title:'Xác nhận đã phục vụ'}); return `<tr><td><span class="code">${esc(o.id)}</span><div class="cell-sub">${esc(restaurantChannelLabel(o.channel))}</div></td><td>${esc(store?.name||o.storeId)}</td><td>${esc(o.tableNo||'Quầy')}</td><td>${items||'—'}</td><td>${restaurantStatus(o.status)}</td><td>${rowActions(acts)}</td></tr>`;}).join('');
    body=`<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Chờ bếp',kitchenOrders.filter(o=>['OPEN','KITCHEN_WAITING'].includes(o.status)).length,'fa-clock','orange')}${mkpi('Đang chế biến',kitchenOrders.filter(o=>o.status==='COOKING').length,'fa-fire-burner','blue')}${mkpi('Chờ phục vụ',kitchenOrders.filter(o=>o.status==='READY').length,'fa-bell-concierge','teal')}</div><div class="card"><div class="card-head"><div><h3>Phiếu bếp</h3><p>Mặc định hiển thị đơn hôm nay; chọn khoảng ngày để xem lại lịch sử.</p></div></div>${toolbar}${tableShell([{t:'Đơn / Kênh'},{t:'Cửa hàng'},{t:'Bàn'},{t:'Món cần chế biến'},{t:'Trạng thái'},{t:'Thao tác'}],rows,{emptyTitle:'Không có đơn bếp phù hợp',emptyDesc:'Thử thay đổi bộ lọc hoặc khoảng ngày để xem lịch sử.'})}</div>`;
  } else if(['tablet','qr'].includes(tab)){
    const channel=tab==='tablet'?'TABLET':'QR';
    const list=orders.filter(o=>(o.channel||'POS')===channel).sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||'')));
    const todayList=list.filter(o=>String(o.date||o.createdAt||'').slice(0,10)===today);
    const paid=todayList.filter(o=>o.status==='PAID');
    const active=todayList.filter(o=>['OPEN','KITCHEN_WAITING','COOKING','READY','SERVED'].includes(o.status));
    const revenue=paid.reduce((sum,o)=>sum+restaurantOrderTotal(o),0);
    const recent=list.slice(0,5);
    body=`<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Đơn hôm nay',todayList.length,'fa-receipt','blue')}${mkpi('Đang xử lý',active.length,'fa-clock','orange')}${mkpi('Đã thanh toán',paid.length,'fa-circle-check','green')}${mkpi('Doanh thu hôm nay',fmtVND(revenue),'fa-money-bill-wave','teal')}</div>
      <div class="card"><div class="card-head"><div><h3>Tổng quan ${tab==='tablet'?'Tablet Ordering':'QR Ordering'}</h3><p>Đơn tạo từ kênh này được chuyển tập trung về Danh sách đơn hàng và Bếp / Chế biến.</p></div><button class="btn btn-primary" data-act="${tab==='tablet'?'restaurant-tablet-open':'restaurant-qr-open'}"><i class="fa-solid ${tab==='tablet'?'fa-tablet-screen-button':'fa-qrcode'}"></i>Tạo đơn ${tab==='tablet'?'Tablet':'QR'}</button></div>
      ${tableShell([{t:'Đơn gần nhất'},{t:'Ngày'},{t:'Cửa hàng'},{t:'Bàn'},{t:'Tổng tiền',cls:'right'},{t:'Trạng thái'}],recent.map(o=>`<tr><td><span class="code">${esc(o.id)}</span></td><td>${fmtDate(o.date)}</td><td>${esc(restaurantStore(o.storeId)?.name||o.storeId)}</td><td>${esc(o.tableNo||'—')}</td><td class="right num">${fmtVND(restaurantOrderTotal(o))}</td><td>${restaurantStatus(o.status)}</td></tr>`).join(''),{emptyTitle:'Chưa có đơn từ kênh này'})}</div>`;
  } else if(tab==='orders'){
    const filterKey='restaurant-orders-orders';
    const f=F(filterKey,{q:'',storeId:'',channel:'',status:'',dateFrom:today,dateTo:today});
    const list=restaurantFilterOrders(filterKey,orders);
    const stores=restaurantVisibleStores();
    const paid=list.filter(o=>o.status==='PAID');
    const toolbar=`<div class="toolbar">${searchBox(filterKey,'Tìm mã đơn, món, bàn, ca, thanh toán…')}${selectFilter(filterKey,'storeId',stores.map(x=>[x.id,x.name]),'Tất cả cửa hàng')}${selectFilter(filterKey,'channel',[['POS','POS tại quầy'],['TABLET','Tablet'],['QR','QR']],'Tất cả kênh')}${selectFilter(filterKey,'status',[['KITCHEN_WAITING','Chờ bếp'],['COOKING','Đang chế biến'],['READY','Món hoàn thành'],['SERVED','Đã phục vụ'],['PAID','Đã thanh toán'],['CANCELLED','Đã hủy']],'Tất cả trạng thái')}<input class="inp" type="date" data-f="${filterKey}.dateFrom" value="${esc(f.dateFrom||'')}" title="Từ ngày"><input class="inp" type="date" data-f="${filterKey}.dateTo" value="${esc(f.dateTo||'')}" title="Đến ngày"><span class="spacer"></span><span class="chip">${fmtN(list.length)} đơn</span></div>`;
    body=`<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Tổng đơn',list.length,'fa-receipt','blue')}${mkpi('Đang xử lý',list.filter(o=>['OPEN','KITCHEN_WAITING','COOKING','READY','SERVED'].includes(o.status)).length,'fa-clock','orange')}${mkpi('Đã thanh toán',paid.length,'fa-circle-check','green')}${mkpi('Doanh thu',fmtVND(paid.reduce((s,o)=>s+restaurantOrderTotal(o),0)),'fa-money-bill-wave','teal')}</div><div class="card">${toolbar}${tableShell([{t:'Đơn'},{t:'Ngày'},{t:'Cửa hàng'},{t:'Kênh'},{t:'Bàn'},{t:'Ca'},{t:'Tổng tiền',cls:'right'},{t:'Trạng thái'},{t:'Thao tác'}],restaurantOrderRows(list),{emptyTitle:'Chưa có đơn hàng phù hợp'})}</div>`;
  } else if(tab==='recipe'){
    const f=F(`restaurant-${tab}`,{q:'',group:'',status:''});
    const q=String(f.q||'').trim().toLowerCase();
    const groups=[...new Set((DB.restaurantRecipes||[]).map(x=>x.group||'Khác'))].sort().map(x=>[x,x]);
    const filtered=(DB.restaurantRecipes||[]).filter(r=>(!f.group||(r.group||'Khác')===f.group)&&(!f.status||(f.status==='ACTIVE'?r.active!==false:r.active===false))&&(!q||`${r.id} ${r.name} ${r.group||''}`.toLowerCase().includes(q)));
    const original=DB.restaurantRecipes; DB.restaurantRecipes=filtered; const rowsHtml=restaurantRecipeRows('recipe'); DB.restaurantRecipes=original;
    const recipeStores=restaurantVisibleStores();
    body=`<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Tổng món',(DB.restaurantRecipes||[]).length,'fa-utensils','blue')}${mkpi('Đang bán',(DB.restaurantRecipes||[]).filter(x=>x.active!==false).length,'fa-circle-check','green')}${mkpi('Ngừng bán',(DB.restaurantRecipes||[]).filter(x=>x.active===false).length,'fa-circle-pause','slate')}${mkpi('Nhóm món',groups.length,'fa-layer-group','orange')}</div><div class="card"><div class="toolbar">${searchBox(`restaurant-${tab}`,'Tìm mã món, tên món, nhóm…')}${selectFilter(`restaurant-${tab}`,'group',groups,'Tất cả nhóm')}${selectFilter(`restaurant-${tab}`,'status',[['ACTIVE','Đang bán'],['INACTIVE','Ngừng bán']],'Tất cả trạng thái')}${selectFilter(`restaurant-${tab}`,'storeId',recipeStores.map(x=>[x.id,x.name]),'Kiểm tra thiếu theo cửa hàng')}<span class="spacer"></span><span class="chip">${fmtN(filtered.length)} món</span></div>${tableShell(tab==='recipe'?[{t:'Mã món'},{t:'Tên món'},{t:'Giá bán',cls:'right'},{t:'Định lượng NVL / TP'},{t:'Food Cost',cls:'right'},{t:'Trạng thái'},{t:'Thao tác'}]:[{t:'Mã món'},{t:'Tên món'},{t:'Giá bán',cls:'right'},{t:'Đơn vị'},{t:'Trạng thái'},{t:'Thao tác'}],rowsHtml,{emptyTitle:'Chưa có món phù hợp'})}</div>`;
  } else if(tab==='branches'){
    const rows=(DB.stores||[]).map(s=>`<tr><td><span class="code">${esc(s.id)}</span></td><td>${cell2(esc(s.name),esc(s.address||''))}</td><td>${esc(Q.warehouseName(s.sourceWarehouseId)||'Chưa liên kết')}</td><td>${s.status!=='inactive'?'<span class="badge green">Hoạt động</span>':'<span class="badge gray">Ngưng</span>'}</td><td>${rowActions([{act:'restaurant-store-view',data:`data-id="${esc(s.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},{act:'restaurant-store-edit',data:`data-id="${esc(s.id)}"`,icon:'fa-pen',title:'Sửa'},{act:'restaurant-store-delete',data:`data-id="${esc(s.id)}"`,icon:'fa-trash',title:'Xóa'}])}</td></tr>`).join('');
    body=`<div class="card">${tableShell([{t:'Mã'},{t:'Chi nhánh'},{t:'Kho liên kết'},{t:'Trạng thái'},{t:'Thao tác'}],rows,{emptyTitle:'Chưa có chi nhánh'})}</div>`;
  } else if(tab==='store_stock'){
    const f=F('restaurant-store-stock',{q:'',storeId:'',stockStatus:''});
    const q=String(f.q||'').toLowerCase().trim();
    const stores=restaurantVisibleStores();
    const rowsData=restaurantVisibleStocks().map(stock=>{
      const store=restaurantStore(stock.storeId); const item=Q.product(stock.productId)||restaurantItem(stock.productId); const min=restaurantMinStock(stock.productId); const qty=Number(stock.qtyAvailable??stock.qtyOnHand??0); const status=qty<=0?'OUT':(min>0&&qty<=min?'LOW':'OK'); return {store,productId:stock.productId,item,min,qty,lotId:stock.lotId||'',status};
    }).filter(x=>x.store);
    const filtered=rowsData.filter(x=>{ if(f.storeId&&x.store.id!==f.storeId)return false; if(f.stockStatus&&x.status!==f.stockStatus)return false; if(q&&!`${x.productId} ${x.item?.name||''} ${x.store.name}`.toLowerCase().includes(q))return false; return true; });
    const rows=filtered.map(x=>{ const status=x.status==='OUT'?'<span class="badge red">Hết hàng</span>':x.status==='LOW'?'<span class="badge orange">Sắp hết</span>':'<span class="badge green">Đủ hàng</span>'; const acts=[]; if(x.status!=='OK') acts.push({act:'restaurant-replenishment-new',data:`data-store="${esc(x.store.id)}" data-product="${esc(x.productId)}" data-qty="${Number(Math.max((x.min||0)*2-x.qty, x.min||1))}"`,icon:'fa-paper-plane',title:'Tạo yêu cầu bổ sung'}); return `<tr><td>${esc(x.store.name)}</td><td><span class="code">${esc(x.productId)}</span></td><td>${esc(x.item?.name||x.productId)}</td><td>${esc(x.lotId||'—')}</td><td class="right num">${fmtDec(x.qty,3)} ${esc(x.item?.unit||'')}</td><td class="right num">${fmtDec(x.min,3)} ${esc(x.item?.unit||'')}</td><td>${status}</td><td>${acts.length?rowActions(acts):'<span class="muted">—</span>'}</td></tr>`; }).join('');
    const totalItems=rowsData.length, low=rowsData.filter(x=>x.status==='LOW').length, out=rowsData.filter(x=>x.status==='OUT').length;
    body=`<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Mặt hàng đã nhập',totalItems,'fa-boxes-stacked','blue')}${mkpi('Sắp hết',low,'fa-triangle-exclamation','orange')}${mkpi('Hết hàng',out,'fa-circle-xmark','red')}${mkpi('Cửa hàng',stores.length,'fa-store','teal')}</div><div class="card"><div class="toolbar">${searchBox('restaurant-store-stock','Tìm mã hàng, tên hàng, cửa hàng…')}${selectFilter('restaurant-store-stock','storeId',stores.map(s=>[s.id,s.name]),'Tất cả cửa hàng')}${selectFilter('restaurant-store-stock','stockStatus',[['OK','Đủ hàng'],['LOW','Sắp hết'],['OUT','Hết hàng']],'Tất cả trạng thái')}${(f.q||f.storeId||f.stockStatus)?'<button class="btn btn-sm" data-act="clear-filter" data-key="restaurant-store-stock"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}<span class="spacer"></span><span class="chip">${fmtN(filtered.length)} dòng tồn</span></div>${tableShell([{t:'Cửa hàng'},{t:'Mã TP'},{t:'Thành phẩm'},{t:'Lô'},{t:'Tồn khả dụng',cls:'right'},{t:'Tồn tối thiểu',cls:'right'},{t:'Trạng thái'},{t:'Thao tác'}],rows,{emptyTitle:'Cửa hàng chưa có tồn',emptyDesc:'Đúng nghiệp vụ: tạo Yêu cầu bổ sung → Kho thành phẩm xuất hàng → Cửa hàng xác nhận nhập. Sau bước nhập, dữ liệu mới xuất hiện tại đây.'})}</div>`;
  } else if(tab==='replenishment'){
    DB.storeReplenishmentRequests=DB.storeReplenishmentRequests||[];
    const f=F('restaurant-replenishment',{q:'',storeId:'',status:'',dateFrom:'',dateTo:''});
    const q=String(f.q||'').trim().toLowerCase();
    const stores=restaurantVisibleStores();
    const suggestions=restaurantReplenishmentSuggestions()
      .filter(x=>!f.storeId||x.store.id===f.storeId)
      .filter(x=>!q||`${x.store.name} ${x.productId} ${restaurantItem(x.productId)?.name||''}`.toLowerCase().includes(q));
    // Chỉ thay đổi cách hiển thị: gom cảnh báo thiếu theo cửa hàng để danh sách yêu cầu bên dưới luôn dễ tiếp cận.
    // Logic tính thiếu, số lượng đề xuất và thao tác tạo yêu cầu vẫn giữ nguyên.
    const suggestionGroups=[...suggestions.reduce((m,x)=>{const key=String(x.store?.id||'');if(!m.has(key))m.set(key,{store:x.store,items:[]});m.get(key).items.push(x);return m;},new Map()).values()]
      .sort((a,b)=>String(a.store?.name||'').localeCompare(String(b.store?.name||''),'vi'));
    const suggestionGroupedHtml=suggestionGroups.length?suggestionGroups.map((g,idx)=>{
      const store=g.store||{};
      const itemRows=g.items.map(x=>{const item=restaurantItem(x.productId);return `<tr><td><span class="code">${esc(x.productId)}</span><div class="cell-sub">${esc(item?.name||x.productId)}</div></td><td class="right num">${fmtDec(x.qty,3)} ${esc(item?.unit||'')}</td><td class="right num">${fmtDec(x.min,3)} ${esc(item?.unit||'')}</td><td class="right num strong">${fmtDec(x.suggested,3)} ${esc(item?.unit||'')}</td><td>${rowActions([{act:'restaurant-replenishment-new',data:`data-store="${esc(store.id)}" data-product="${esc(x.productId)}" data-qty="${Number(x.suggested||0)}"`,icon:'fa-paper-plane',title:'Tạo yêu cầu bổ sung'}])}</td></tr>`}).join('');
      const autoOpen=!!f.storeId||suggestionGroups.length===1;
      return `<details ${autoOpen?'open':''} style="border:1px solid var(--line,#e5e7eb);border-radius:10px;margin:10px 0;overflow:hidden;background:#fff"><summary style="cursor:pointer;list-style:none;padding:14px 16px;display:flex;align-items:center;gap:12px;font-weight:700"><i class="fa-solid fa-store"></i><span>${esc(store.name||store.id||'Cửa hàng')}</span><span class="spacer"></span><span class="chip">${fmtN(g.items.length)} mặt hàng thiếu</span><i class="fa-solid fa-chevron-down" style="margin-left:4px"></i></summary><div style="border-top:1px solid var(--line,#e5e7eb)">${tableShell([{t:'Hàng hóa'},{t:'Tồn hiện tại',cls:'right'},{t:'Tồn tối thiểu',cls:'right'},{t:'SL đề xuất',cls:'right'},{t:'Thao tác'}],itemRows,{emptyTitle:'Không có mặt hàng dưới mức tối thiểu'})}</div></details>`;
    }).join(''):`<div style="padding:32px 16px;text-align:center"><div class="muted">Không có mặt hàng dưới mức tối thiểu</div></div>`;
    const requestList=restaurantVisibleReplenishments().filter(r=>{
      if(f.storeId&&r.storeId!==f.storeId)return false;
      const derivedStatus=restaurantReplenishmentDerivedStatus(r); if(f.status&&derivedStatus!==f.status)return false;
      const d=String(r.date||String(r.createdAt||'').slice(0,10));
      if(f.dateFrom&&d<f.dateFrom)return false;
      if(f.dateTo&&d>f.dateTo)return false;
      const store=restaurantStore(r.storeId),items=restaurantRequestItems(r);
      const hay=[r.id,store?.name,r.transferId,r.goodsIssueId,r.note,...items.map(it=>`${it.productId} ${restaurantItem(it.productId)?.name||''}`)].join(' ').toLowerCase();
      return !q||hay.includes(q);
    }).sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||''))||String(b.id||'').localeCompare(String(a.id||'')));
    const requestRows=requestList.map(r=>{const store=restaurantStore(r.storeId),items=restaurantRequestItems(r);const acts=[{act:'restaurant-replenishment-view',data:`data-id="${esc(r.id)}"`,icon:'fa-eye',title:'Xem yêu cầu'}];const derivedStatus=restaurantReplenishmentDerivedStatus(r);if(derivedStatus==='ISSUED')acts.push({act:'restaurant-replenishment-receive',data:`data-id="${esc(r.id)}"`,icon:'fa-box-open',title:'Cửa hàng nhập hàng'});const itemText=items.slice(0,2).map(it=>esc(restaurantItem(it.productId)?.name||it.productId)).join('<br>')+(items.length>2?`<div class="cell-sub">+${items.length-2} mặt hàng khác</div>`:'');const qtyText=items.slice(0,2).map(it=>{const item=restaurantItem(it.productId);return `${fmtDec(it.quantity,3)} ${esc(item?.unit||'')}`}).join('<br>')+(items.length>2?'<div class="cell-sub">…</div>':'');const actor=derivedStatus==='RECEIVED'?(r.receivedBy||r.issuedBy||r.createdBy):(derivedStatus==='ISSUED'?(r.issuedBy||r.createdBy):r.createdBy);return `<tr><td><span class="code">${esc(r.id)}</span><div class="cell-sub">${fmtDate(r.date)}</div></td><td>${esc(store?.name||r.storeId)}</td><td>${itemText||'—'}</td><td class="right num">${qtyText||'—'}</td><td>${restaurantReplenishmentStatus(derivedStatus)}</td><td>${r.goodsIssueId?`<span class="code">${esc(r.goodsIssueId)}</span><div class="cell-sub">${esc(r.transferId||'')}</div>`:(r.transferId?`<span class="code">${esc(r.transferId)}</span>`:'—')}</td><td>${esc(Q.employeeName(actor)||actor||'—')}</td><td>${rowActions(acts)}</td></tr>`}).join('');
    const all=restaurantVisibleReplenishments();
    body=`<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Cảnh báo thiếu',restaurantReplenishmentSuggestions().length,'fa-triangle-exclamation','orange')}${mkpi('Chờ kho xử lý',all.filter(r=>['REQUESTED','PARTIAL_RECEIVED'].includes(restaurantReplenishmentDerivedStatus(r))).length,'fa-clock','blue')}${mkpi('Chờ cửa hàng nhận',all.filter(r=>restaurantReplenishmentDerivedStatus(r)==='ISSUED').length,'fa-truck','blue')}${mkpi('Đã nhập cửa hàng',all.filter(r=>restaurantReplenishmentDerivedStatus(r)==='RECEIVED').length,'fa-circle-check','green')}</div>
    <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Cảnh báo thiếu thành phẩm tại cửa hàng</h3><p>Đã gom theo từng cửa hàng. Bấm vào cửa hàng để xem các mặt hàng thiếu và tạo yêu cầu bổ sung; Kho là nơi duyệt và xuất.</p></div><span class="chip">${fmtN(suggestionGroups.length)} cửa hàng</span></div><div style="padding:0 14px 10px">${suggestionGroupedHtml}</div></div>
    <div class="card"><div class="card-head"><div><h3>Yêu cầu bổ sung hàng</h3><p>Cửa hàng lập yêu cầu → Kho duyệt & xuất → Cửa hàng xác nhận nhập. Phiếu xuất kho được lưu để truy vết lịch sử lô.</p></div></div>
      <div class="toolbar">${searchBox('restaurant-replenishment','Tìm yêu cầu, cửa hàng, hàng hóa, phiếu xuất…')}${selectFilter('restaurant-replenishment','storeId',stores.map(s=>[s.id,s.name]),'Tất cả cửa hàng')}${selectFilter('restaurant-replenishment','status',[['REQUESTED','Chờ kho xử lý'],['PARTIAL_RECEIVED','Đã nhận một phần · còn thiếu'],['ISSUED','Kho đã xuất · chờ nhận'],['RECEIVED','Cửa hàng đã nhập đủ'],['CANCELLED','Đã hủy']],'Tất cả trạng thái')}<input class="inp" type="date" data-f="restaurant-replenishment.dateFrom" value="${esc(f.dateFrom||'')}" title="Từ ngày"><input class="inp" type="date" data-f="restaurant-replenishment.dateTo" value="${esc(f.dateTo||'')}" title="Đến ngày">${(f.q||f.storeId||f.status||f.dateFrom||f.dateTo)?'<button class="btn btn-sm" data-act="clear-filter" data-key="restaurant-replenishment"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}<span class="spacer"></span><span class="chip">${fmtN(requestList.length)} yêu cầu</span></div>
      ${tableShell([{t:'Yêu cầu / Ngày'},{t:'Cửa hàng'},{t:'Hàng hóa'},{t:'SL yêu cầu',cls:'right'},{t:'Trạng thái'},{t:'Phiếu xuất / chuyển'},{t:'Người thực hiện'},{t:'Thao tác'}],requestRows,{emptyTitle:'Không có yêu cầu bổ sung phù hợp'})}</div>`;
  } else if(tab==='issue'){
    const f=F('restaurant-issue',{q:'',storeId:'',dateFrom:'',dateTo:''});
    const q=String(f.q||'').trim().toLowerCase();
    const stores=restaurantVisibleStores();
    const tx=restaurantVisibleStockTransactions().filter(t=>['POS_ISSUE','KITCHEN_ISSUE'].includes(t.type)).filter(t=>{
      if(f.storeId&&t.storeId!==f.storeId)return false;
      const d=String(t.date||t.createdAt||'').slice(0,10); if(f.dateFrom&&d<f.dateFrom)return false; if(f.dateTo&&d>f.dateTo)return false;
      return !q||`${t.id} ${t.refId||''} ${restaurantStore(t.storeId)?.name||''} ${Q.product(t.productId)?.name||t.productId}`.toLowerCase().includes(q);
    });
    const rows=tx.map(t=>`<tr><td><span class="code">${esc(t.id)}</span></td><td>${fmtDate(t.date)}</td><td>${esc(restaurantStore(t.storeId)?.name||t.storeId)}</td><td>${esc(Q.product(t.productId)?.name||t.productId)}</td><td>${esc(t.lotId||'—')}</td><td class="right num">${fmtDec(Math.abs(Number(t.qty||0)),3)} ${esc(Q.product(t.productId)?.unit||'')}</td><td><span class="code">${esc(t.refId||'—')}</span></td></tr>`).join('');
    body=`<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Lượt xuất',tx.length,'fa-arrow-up-from-bracket','blue')}${mkpi('Cửa hàng có xuất',new Set(tx.map(x=>x.storeId)).size,'fa-store','teal')}${mkpi('Mặt hàng đã dùng',new Set(tx.map(x=>x.productId)).size,'fa-box-open','orange')}</div><div class="card"><div class="toolbar">${searchBox('restaurant-issue','Tìm giao dịch, đơn, thành phẩm…')}${selectFilter('restaurant-issue','storeId',stores.map(x=>[x.id,x.name]),'Tất cả cửa hàng')}<input class="inp" type="date" data-f="restaurant-issue.dateFrom" value="${esc(f.dateFrom||'')}" title="Từ ngày"><input class="inp" type="date" data-f="restaurant-issue.dateTo" value="${esc(f.dateTo||'')}" title="Đến ngày"><span class="spacer"></span><span class="chip">${fmtN(tx.length)} giao dịch</span></div>${tableShell([{t:'Giao dịch'},{t:'Ngày'},{t:'Cửa hàng'},{t:'Thành phẩm'},{t:'Lô'},{t:'SL sử dụng',cls:'right'},{t:'Đơn hàng'}],rows,{emptyTitle:'Chưa có giao dịch xuất phù hợp'})}</div>`;
  } else if(tab==='revenue'){
    const f=F('restaurant-revenue',{storeId:'',channel:'',dateFrom:'',dateTo:''});
    const paid=orders.filter(o=>o.status==='PAID').filter(o=>{
      if(f.storeId&&o.storeId!==f.storeId)return false; if(f.channel&&(o.channel||'POS')!==f.channel)return false;
      const d=String(o.date||'').slice(0,10); if(f.dateFrom&&d<f.dateFrom)return false; if(f.dateTo&&d>f.dateTo)return false; return true;
    });
    const stores=restaurantVisibleStores();
    const byStore=stores.map(st=>{const os=paid.filter(o=>o.storeId===st.id);return {s:st,count:os.length,amount:os.reduce((n,o)=>n+restaurantOrderTotal(o),0)};}).filter(x=>!f.storeId||x.s.id===f.storeId);
    const rows=byStore.map(x=>`<tr><td>${esc(x.s.name)}</td><td class="right num">${x.count}</td><td class="right num">${fmtVND(x.amount)}</td><td class="right num">${fmtVND(x.count?x.amount/x.count:0)}</td><td>${rowActions([{act:'restaurant-store-view',data:`data-id="${esc(x.s.id)}"`,icon:'fa-eye',title:'Xem chi tiết chi nhánh'}])}</td></tr>`).join('');
    const total=paid.reduce((n,o)=>n+restaurantOrderTotal(o),0);
    body=`<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Doanh thu',fmtVND(total),'fa-sack-dollar','green')}${mkpi('Đơn đã thanh toán',paid.length,'fa-receipt','blue')}${mkpi('Giá trị TB/đơn',fmtVND(paid.length?total/paid.length:0),'fa-chart-line','orange')}${mkpi('Chi nhánh phát sinh',new Set(paid.map(x=>x.storeId)).size,'fa-store','teal')}</div><div class="card"><div class="toolbar">${selectFilter('restaurant-revenue','storeId',stores.map(x=>[x.id,x.name]),'Tất cả cửa hàng')}${selectFilter('restaurant-revenue','channel',[['POS','POS tại quầy'],['TABLET','Tablet'],['QR','QR']],'Tất cả kênh')}<input class="inp" type="date" data-f="restaurant-revenue.dateFrom" value="${esc(f.dateFrom||'')}" title="Từ ngày"><input class="inp" type="date" data-f="restaurant-revenue.dateTo" value="${esc(f.dateTo||'')}" title="Đến ngày"></div>${tableShell([{t:'Cửa hàng'},{t:'Số đơn',cls:'right'},{t:'Doanh thu',cls:'right'},{t:'TB/đơn',cls:'right'},{t:'Thao tác'}],rows,{emptyTitle:'Chưa có doanh thu phù hợp'})}</div>`;
  } else if(tab==='reports'){
    const f=F('restaurant-reports',{storeId:'',dateFrom:'',dateTo:''});
    const stores=restaurantVisibleStores();
    const paid=orders.filter(o=>o.status==='PAID').filter(o=>{
      if(f.storeId&&o.storeId!==f.storeId)return false; const d=String(o.date||'').slice(0,10); if(f.dateFrom&&d<f.dateFrom)return false; if(f.dateTo&&d>f.dateTo)return false; return true;
    });
    const sales={};
    for(const o of paid) for(const i of o.items||[]){
      const k=i.recipeId, recipe=restaurantRecipe(k), fc=restaurantRecipeUnitFoodCost(recipe);
      sales[k]=sales[k]||{qty:0,amount:0,cost:0}; sales[k].qty+=Number(i.quantity||0); sales[k].amount+=Number(i.quantity||0)*Number(i.price||0); sales[k].cost+=Number(i.quantity||0)*fc;
    }
    const labor=restaurantLaborEstimate(paid);
    const totalRevenue=paid.reduce((s,o)=>s+restaurantOrderTotal(o),0), totalCost=Object.values(sales).reduce((s,x)=>s+x.cost,0), primeCost=totalCost+labor.cost;
    const rows=Object.entries(sales).sort((a,b)=>b[1].amount-a[1].amount).map(([id,x])=>`<tr><td><span class="code">${esc(id)}</span></td><td>${esc(restaurantRecipe(id)?.name||id)}</td><td class="right num">${fmtN(x.qty)}</td><td class="right num">${fmtVND(x.amount)}</td><td class="right num">${fmtVND(x.cost)}</td><td class="right num strong">${fmtVND(x.amount-x.cost)}</td><td class="right num">${x.amount?fmtDec((x.cost/x.amount)*100,1)+'%':'—'}</td><td>${rowActions([{act:'restaurant-recipe-view',data:`data-id="${esc(id)}"`,icon:'fa-eye',title:'Xem chi tiết món'}])}</td></tr>`).join('');
    const waste=restaurantWasteTransactions().filter(t=>{ if(f.storeId&&t.storeId!==f.storeId)return false; const d=String(t.date||t.createdAt||'').slice(0,10); if(f.dateFrom&&d<f.dateFrom)return false;if(f.dateTo&&d>f.dateTo)return false;return true;});
    const wasteRows=waste.map(t=>{const id=restaurantStockItemId(t),m=Q.material?.(id)||Q.product?.(id)||restaurantItem(id);return `<tr><td>${fmtDate(t.date||t.createdAt)}</td><td>${esc(restaurantStore(t.storeId)?.name||t.storeId)}</td><td>${esc(m?.name||id)}</td><td class="right num">${fmtDec(Math.abs(Number(t.qty||0)),3)} ${esc(m?.unit||'')}</td><td class="right num">${fmtVND(restaurantWasteCost(t))}</td><td>${esc(t.note||t.reason||'—')}</td></tr>`;}).join('');
    const bd=restaurantRevenueBreakdowns(paid);
    const empRows=bd.byEmployee.map(x=>`<tr><td>${esc(x.name)}</td><td class="right num">${fmtN(x.orders)}</td><td class="right num">${fmtVND(x.revenue)}</td><td class="right num">${fmtVND(x.orders?x.revenue/x.orders:0)}</td></tr>`).join('');
    const shiftRows=bd.byShift.map(x=>`<tr><td>${esc(x.name)}</td><td class="right num">${fmtN(x.orders)}</td><td class="right num">${fmtVND(x.revenue)}</td></tr>`).join('');
    body=`<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Tổng doanh thu',fmtVND(totalRevenue),'fa-chart-line','green')}${mkpi('Food Cost',fmtVND(totalCost),'fa-bowl-food','orange')}${mkpi('Prime Cost ước tính',fmtVND(primeCost),'fa-calculator','blue')}${mkpi('Lãi gộp món',fmtVND(totalRevenue-totalCost),'fa-coins','teal')}${mkpi('Hao hụt ghi nhận',fmtVND(waste.reduce((s,t)=>s+restaurantWasteCost(t),0)),'fa-trash-can','orange')}</div>
      <div class="card" style="margin-bottom:14px"><div class="toolbar">${selectFilter('restaurant-reports','storeId',stores.map(x=>[x.id,x.name]),'Tất cả cửa hàng')}<input class="inp" type="date" data-f="restaurant-reports.dateFrom" value="${esc(f.dateFrom||'')}" title="Từ ngày"><input class="inp" type="date" data-f="restaurant-reports.dateTo" value="${esc(f.dateTo||'')}" title="Đến ngày"><span class="spacer"></span><span class="chip">Food Cost ${totalRevenue?fmtDec(totalCost/totalRevenue*100,1):'0'}%</span><span class="chip">Prime Cost ${totalRevenue?fmtDec(primeCost/totalRevenue*100,1):'0'}%</span></div><div class="note-box" style="margin:0 14px 14px"><b>Prime Cost hiện là số ước tính:</b> Food Cost + chi phí nhân công phân bổ theo lương tháng/26 ngày cho nhân viên có phát sinh đơn trong kỳ. Khi có dữ liệu chấm công theo ca, công thức có thể thay bằng chi phí nhân công thực tế.</div>${tableShell([{t:'Mã món'},{t:'Món'},{t:'SL bán',cls:'right'},{t:'Doanh thu',cls:'right'},{t:'Food Cost',cls:'right'},{t:'Lãi gộp',cls:'right'},{t:'Food Cost %',cls:'right'},{t:'Thao tác'}],rows,{emptyTitle:'Chưa có dữ liệu báo cáo phù hợp'})}</div>
      <div class="grid g-2" style="margin-bottom:14px"><div class="card"><div class="card-head"><div><h3>Doanh thu theo ca</h3></div></div>${tableShell([{t:'Ca'},{t:'Đơn',cls:'right'},{t:'Doanh thu',cls:'right'}],shiftRows,{emptyTitle:'Chưa có dữ liệu ca'})}</div><div class="card"><div class="card-head"><div><h3>Hiệu quả nhân viên</h3><p>Dựa trên đơn nhân viên phụ trách.</p></div></div>${tableShell([{t:'Nhân viên'},{t:'Đơn',cls:'right'},{t:'Doanh thu',cls:'right'},{t:'TB/đơn',cls:'right'}],empRows,{emptyTitle:'Chưa có dữ liệu nhân viên'})}</div></div>
      <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Hao hụt / thất thoát nguyên liệu đã ghi nhận</h3><p>Chỉ tính các giao dịch WASTE/ADJUSTMENT_OUT/KITCHEN_WASTE, không trộn với xuất theo định mức món.</p></div><button class="btn btn-sm btn-primary" data-act="restaurant-waste-new"><i class="fa-solid fa-plus"></i>Ghi nhận hao hụt</button></div>${tableShell([{t:'Ngày'},{t:'Cửa hàng'},{t:'Nguyên liệu / TP'},{t:'Số lượng',cls:'right'},{t:'Giá trị',cls:'right'},{t:'Lý do'}],wasteRows,{emptyTitle:'Chưa có hao hụt được ghi nhận'})}</div>
      <div class="card"><div class="card-head"><div><h3>Thiết bị vận hành</h3><p>POS chạy trên trình duyệt; in bếp sử dụng máy in đã cấu hình trên máy trạm.</p></div></div><div class="grid g-auto-sm" style="padding:14px">${mkpi('POS','Sẵn sàng','fa-cash-register','green')}${mkpi('Máy in bếp','Qua trình duyệt','fa-print','blue')}<div class="card" style="padding:14px"><b>Kiểm tra máy in bếp</b><div class="cell-sub" style="margin:6px 0 10px">Mở hộp thoại in của trình duyệt để kiểm tra máy in mặc định.</div><button class="btn btn-sm" data-act="restaurant-printer-test"><i class="fa-solid fa-print"></i>In thử</button></div></div></div>`;
  } else body='<div class="empty-state">Chưa có dữ liệu.</div>';
  return `${head}${restaurantTabs(tab)}${body}`;
};


const SUPPLIER_TABS=[{id:'overview',label:'Tổng quan'},{id:'orders',label:'Đơn mua'},{id:'debt',label:'Công nợ'},{id:'history',label:'Lịch sử giao dịch'}];
function supplierDrawerBody(supplier){
  const tab=State.supplierTab||'overview';
  const pos=(DB.purchaseOrders||[]).filter(po=>po.supplierId===supplier.id).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.id||'').localeCompare(String(a.id||'')));
  const refunds=(DB.supplierRefunds||[]).filter(r=>r.supplierId===supplier.id).sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||'')));
  const payments=(DB.supplierPayments||[]).filter(r=>r.supplierId===supplier.id).sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||'')));
  const purchases=pos.reduce((n,po)=>n+Number(po.total||0),0), payable=pos.reduce((n,po)=>n+(typeof purchasePayableRemaining==='function'?purchasePayableRemaining(po):0),0), refundDue=pos.reduce((n,po)=>n+(typeof purchaseSupplierRefundDue==='function'?purchaseSupplierRefundDue(po):0),0), refunded=refunds.reduce((n,r)=>n+Number(r.amount||0),0);
  const tabs=`<div class="tabs">${SUPPLIER_TABS.map(t=>`<button class="tab ${tab===t.id?'active':''}" data-act="supplier-tab" data-tab="${t.id}" data-id="${esc(supplier.id)}">${t.label}${t.id==='orders'?`<span class="cnt">${pos.length}</span>`:''}</button>`).join('')}</div>`;
  let inner='';
  if(tab==='overview') inner=`<div class="grid g-auto-sm" style="margin-bottom:16px">${mkpi('Tổng đơn mua',pos.length,'fa-cart-shopping','blue')}${mkpi('Giá trị mua lũy kế',fmtShort(purchases),'fa-sack-dollar','green')}${mkpi('Còn phải trả',fmtShort(payable),'fa-file-invoice-dollar',payable>0?'red':'slate')}${mkpi('NCC còn phải hoàn',fmtShort(refundDue),'fa-rotate-left',refundDue>0?'orange':'slate')}</div>
  <div class="form-sec-title"><i class="fa-solid fa-building"></i>Thông tin nhà cung cấp</div><div class="info-grid" style="margin-bottom:18px">${infoItem('Mã NCC',`<span class="code">${esc(supplier.id)}</span>`)}${infoItem('Tên nhà cung cấp',esc(supplier.name||'—'))}${infoItem('Nhóm cung ứng',esc(supplier.group||'—'))}${infoItem('Mã số thuế',esc(supplier.taxCode||'—'))}${infoItem('Địa chỉ',esc(supplier.address||'—'))}${infoItem('Điều khoản thanh toán',esc(supplier.paymentTerm||'Theo hợp đồng'))}</div>
  <div class="form-sec-title"><i class="fa-solid fa-address-card"></i>Đầu mối liên hệ</div><div class="info-grid" style="margin-bottom:18px">${infoItem('Người liên hệ',esc(supplier.contact||'—'))}${infoItem('Số điện thoại',esc(supplier.phone||'—'))}${infoItem('Email',esc(supplier.email||'—'))}${infoItem('Tài khoản NCC',supplier.bankAccount?`${esc(supplier.bankAccount)} · ${esc(supplier.bankName||'')}`:'—')}</div>
  <div class="form-sec-title"><i class="fa-solid fa-star"></i>Đánh giá</div><div class="info-grid">${infoItem('Đánh giá hiện tại',Number(supplier.rating||0)?`<b>${Number(supplier.rating).toFixed(1)} / 5</b>`:'Chưa đánh giá')}${infoItem('NCC đã hoàn tiền',`<b class="num">${fmtVND(refunded)}</b>`)}</div>`;
  if(tab==='orders') inner=tableShell([{t:'Mã PO'},{t:'Ngày'},{t:'Giá trị',cls:'right'},{t:'Đã trả',cls:'right'},{t:'Còn phải trả',cls:'right'},{t:'NCC còn phải hoàn',cls:'right'},{t:'Trạng thái'}],pos.map(po=>`<tr class="clickable" data-act="po-view" data-id="${esc(po.id)}"><td><span class="code">${esc(po.id)}</span></td><td>${fmtDate(po.date)}</td><td class="right num">${fmtVND(po.total)}</td><td class="right num">${fmtVND(purchasePaidAmount(po))}</td><td class="right num">${fmtVND(purchasePayableRemaining(po))}</td><td class="right num" style="color:${purchaseSupplierRefundDue(po)>0?'var(--orange)':'var(--text-3)'}">${fmtVND(purchaseSupplierRefundDue(po))}</td><td>${badge(po.status)}</td></tr>`),{emptyTitle:'Chưa có đơn mua'});
  if(tab==='debt'){
    const debtRows=pos.map(po=>{const remain=purchasePayableRemaining(po),due=purchaseSupplierRefundDue(po),gross=purchaseSupplierRefundGrossDue(po),got=purchaseSupplierRefundedAmount(po);return `<tr><td><span class="code">${esc(po.id)}</span></td><td>${fmtDate(po.date)}</td><td class="right num">${fmtVND(po.total)}</td><td class="right num">${fmtVND(purchasePaidAmount(po))}</td><td class="right num">${fmtVND(remain)}</td><td class="right num">${fmtVND(gross)}</td><td class="right num" style="color:var(--green)">${fmtVND(got)}</td><td class="right strong num" style="color:${due>0?'var(--orange)':'var(--text-3)'}">${fmtVND(due)}</td><td>${remain>0?`<button class="btn btn-xs btn-primary" data-act="supplier-pay-modal" data-id="${esc(po.id)}">Thanh toán</button>`:due>0?`<button class="btn btn-xs btn-primary" data-act="supplier-refund-modal" data-id="${esc(po.id)}">Ghi nhận hoàn tiền</button>`:'<span class="badge green">Tất toán</span>'}</td></tr>`;});
    const refRows=refunds.map(r=>`<tr><td><span class="code">${esc(r.id)}</span></td><td>${fmtDate(r.date)}</td><td><span class="code">${esc(r.poId)}</span></td><td class="right strong num">${fmtVND(r.amount)}</td><td>${esc(r.method==='BANK_TRANSFER'?'Chuyển khoản ngân hàng':r.method==='CASH'?'Tiền mặt':r.method||'—')}</td><td>${esc(r.bankName||'—')}</td><td>${esc(r.receivedByName||r.createdByName||'—')}</td><td>${esc(r.reference||'')}</td></tr>`);
    inner=`<div class="grid g-auto-sm" style="margin-bottom:16px">${mkpi('Còn phải trả NCC',fmtShort(payable),'fa-money-bill-transfer',payable>0?'red':'slate')}${mkpi('NCC phải hoàn',fmtShort(refundDue),'fa-rotate-left',refundDue>0?'orange':'slate')}${mkpi('NCC đã hoàn',fmtShort(refunded),'fa-circle-check','green')}</div><div class="card" style="margin-bottom:14px">${tableShell([{t:'PO'},{t:'Ngày'},{t:'Tổng PO',cls:'right'},{t:'Đã trả',cls:'right'},{t:'Còn phải trả',cls:'right'},{t:'Phát sinh hoàn',cls:'right'},{t:'Đã hoàn',cls:'right'},{t:'Còn phải hoàn',cls:'right'},{t:'Thao tác'}],debtRows,{emptyTitle:'Không có công nợ'})}</div><div class="card"><div class="card-head"><div><h3>Lịch sử NCC hoàn tiền</h3><p>Mỗi lần hoàn tiền được ghi nhận riêng, mới nhất trước.</p></div></div>${tableShell([{t:'Mã nhận hoàn'},{t:'Ngày'},{t:'PO'},{t:'Số tiền',cls:'right'},{t:'Phương thức'},{t:'Ngân hàng nhận'},{t:'Người ghi nhận'},{t:'Tham chiếu'}],refRows,{emptyTitle:'Chưa có lần NCC hoàn tiền'})}</div>`;
  }
  if(tab==='history'){
    const events=[]; pos.forEach(po=>events.push({d:po.date,t:`Đơn mua ${po.id}`,s:`${fmtVND(po.total)} · ${Q.supplierName(po.supplierId)}`,icon:'fa-cart-shopping',tone:'blue'})); payments.forEach(x=>events.push({d:x.date,t:`Thanh toán ${x.id}`,s:`Đã trả ${fmtVND(x.amount)} · PO ${x.poId}`,icon:'fa-money-bill-transfer',tone:'red'})); refunds.forEach(x=>events.push({d:x.date,t:`NCC hoàn tiền ${x.id}`,s:`Đã nhận ${fmtVND(x.amount)} · PO ${x.poId}`,icon:'fa-rotate-left',tone:'green'})); events.sort((a,b)=>String(b.d||'').localeCompare(String(a.d||''))); inner=events.length?`<div class="tline">${events.map(e=>`<div class="tline-item done"><span class="tline-dot" style="background:var(--surface);border-color:var(--${e.tone})"><i class="fa-solid ${e.icon}" style="color:var(--${e.tone})"></i></span><div class="tline-title">${esc(e.t)}</div><div class="tline-sub">${esc(e.s)} · ${fmtDate(e.d)}</div></div>`).join('')}</div>`:'<div class="empty-state">Chưa có giao dịch.</div>';
  }
  return tabs+`<div style="padding:17px 18px">${inner}</div>`;
}
function openSupplierDrawer(id){ const s=Q.supplier(id); if(!s)return; State.supplierTab=State.supplierTab||'overview'; const canEdit=typeof Auth==='undefined'||Auth.hasPermission('PURCHASE_SUPPLIER_MANAGE'); Drawer.open({title:`<div style="display:flex;align-items:center;gap:11px">${avatarHTML(s.name,'lg')}<span>${esc(s.name)}<div style="font-size:12.5px;font-weight:500;color:var(--text-3);margin-top:2px">${esc(s.id)} · ${esc(s.group||'Nhà cung cấp')}</div></span></div>`,wide:true,body:supplierDrawerBody(s),foot:`<button class="btn" data-act="drawer-close">Đóng</button>${canEdit?`<button class="btn" data-act="supplier-edit" data-id="${esc(s.id)}"><i class="fa-solid fa-pen"></i>Sửa thông tin</button>`:''}`}); }

Views.suppliers = function () {
  const f = F('suppliers', { q: '', group: '' });
  const q = (f.q || '').toLowerCase().trim();
  const groups = [...new Set((DB.itemCategories || []).filter((category) =>category.type === 'RAW_MATERIAL' &&category.status !== 'inactive').map((category) => category.name).filter(Boolean)
  )
]
  .sort((a, b) => String(a).localeCompare(String(b), 'vi'))
  .map((group) => [group, group]);
  const list = DB.suppliers.filter((supplier) => {
    if (f.group && supplier.group !== f.group) return false;
    return !q || [supplier.id, supplier.name, supplier.contact, supplier.group, supplier.address].some((value) => String(value || '').toLowerCase().includes(q));
  });
  const rows = list.map((supplier) => `<tr>
    <td><span class="code">${esc(supplier.id)}</span></td>
    <td>${cell2(esc(supplier.name), esc(supplier.address || ''))}</td>
    <td>${esc(supplier.group)}</td>
    <td>${esc(supplier.contact)}<div class="cell-sub">${esc(supplier.phone)}</div></td>
    <td class="center strong" style="${supplier.ratingStatus === 'UNRATED' || !Number(supplier.rating) ? 'color:var(--text-3)' : Number(supplier.rating) < 4 ? 'color:var(--red)' : ''}">${Number(supplier.rating || 0) ? Number(supplier.rating).toFixed(1) + ' / 5' : 'Chưa đánh giá'}</td>
    <td>${esc(supplier.paymentTerm || 'Theo hợp đồng')}</td>
    <td>${rowActions([{ act: 'supplier-detail', data: `data-id="${supplier.id}"`, icon: 'fa-eye', title: 'Xem chi tiết nhà cung cấp' }, { act: 'supplier-edit', data: `data-id="${supplier.id}"`, icon: 'fa-pen', title: 'Sửa nhà cung cấp' }, { act: 'supplier-delete', data: `data-id="${supplier.id}"`, icon: 'fa-trash', title: 'Xóa nhà cung cấp' }])}</td>
  </tr>`);

  // [DASHBOARD CONSISTENCY]
  // Chỉ tính trung bình trên các nhà cung cấp đã có đánh giá > 0.
  // NCC chưa được đánh giá sẽ không bị tính là 0 điểm.
  const ratedSuppliers = (DB.suppliers || []).filter((supplier) => {
    const rating = Number(supplier.rating);
    return Number.isFinite(rating) && rating > 0;
  });

  const ratedSupplierCount = ratedSuppliers.length;
  const totalSuppliers = (DB.suppliers || []).length;

  const avgRating = ratedSupplierCount > 0
    ? ratedSuppliers.reduce(
        (sum, supplier) => sum + Number(supplier.rating),
        0
      ) / ratedSupplierCount
    : 0;
  const canManageSupplier=typeof Auth==='undefined'||Auth.hasPermission('PURCHASE_SUPPLIER_MANAGE');
  return `${pageHead('Nhà cung cấp', 'Đối tác nguyên liệu đậu nành, phụ gia, bao bì, nước sạch, vận chuyển và dịch vụ của Lê Nam', canManageSupplier?'<button class="btn btn-primary" data-act="enterprise-action" data-key="suppliers"><i class="fa-solid fa-plus"></i>Thêm nhà cung cấp</button>':'')}
  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi(
      'Tổng nhà cung cấp',
      totalSuppliers,
      'fa-handshake',
      'blue'
    )}

    ${mkpi(
      'Nhóm cung ứng',
      groups.length,
      'fa-layer-group',
      'teal'
    )}

    ${mkpi(
      'Đánh giá trung bình',
      ratedSupplierCount > 0
        ? `${avgRating.toFixed(1)} / 5`
        : 'Chưa có đánh giá',
      'fa-star',
      'orange',
      null,
      ratedSupplierCount > 0
        ? `Dựa trên ${ratedSupplierCount}/${totalSuppliers} NCC đã đánh giá`
        : `${totalSuppliers} NCC chưa có dữ liệu đánh giá`
    )}
  </div>  
  <div class="card"><div class="toolbar">${searchBox('suppliers', 'Tìm mã, tên, người liên hệ, nhóm hàng…')}${selectFilter('suppliers', 'group', groups, 'Tất cả nhóm cung ứng')}${(f.q || f.group) ? '<button class="btn btn-sm" data-act="clear-filter" data-key="suppliers"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>' : ''}<span class="spacer"></span><span class="chip"><i class="fa-solid fa-list"></i> ${list.length} nhà cung cấp</span></div>${tableShell([{ t: 'Mã NCC' }, { t: 'Tên nhà cung cấp' }, { t: 'Nhóm cung ứng' }, { t: 'Liên hệ' }, { t: 'Đánh giá', cls: 'center' }, { t: 'Thanh toán' }, { t: '', cls: 'right' }], rows, { emptyTitle: 'Không tìm thấy nhà cung cấp' })}</div>`;
};

// Views['subcontracting-overview'] = function () {
//   const rows = DB.subcontractingOrders.map(order => {
//     const progress = order.plannedQty
//       ? Math.round((order.receivedQty / order.plannedQty) * 100)
//       : 0;

//     const amount = order.plannedQty * order.unitCost;

//     return `<tr>
//       <td><span class="code">${order.id}</span></td>
//       <td class="strong">${esc(order.partner)}</td>
//       <td>${esc(Q.product(order.productId)?.name || order.productId)}</td>
//       <td class="right num">${fmtDec(order.plannedQty, 2)}</td>
//       <td class="right num">${fmtDec(order.issuedQty, 2)}</td>
//       <td class="right num">
//         ${fmtDec(order.receivedQty, 2)} (${progress}%)
//       </td>
//       <td class="right num">${fmtVND(amount)}</td>
//       <td>${badge(order.status)}</td>
//       <td>
//         ${rowActions([{
//           act: 'subcontracting-issue',
//           data: `data-id="${order.id}"`,
//           icon: 'fa-arrow-right-from-bracket',
//           title: 'Xuất nguyên liệu gia công'
//         }])}
//       </td>
//     </tr>`;
//   });

//   return `${pageHead(
//     'Gia công',
//     'Quản lý kế hoạch, nguyên liệu giao đối tác, tiến độ nhận hàng, hao hụt, chất lượng và công nợ',
//     `
//       <button class="btn btn-primary" data-act="subcontracting-new">
//         <i class="fa-solid fa-plus"></i>
//         Tạo kế hoạch gia công
//       </button>
//     `
//   )}

//   <div class="grid g-auto-sm" style="margin-bottom:14px">
//     ${mkpi(
//       'Đơn gia công',
//       DB.subcontractingOrders.length,
//       'fa-industry',
//       'blue'
//     )}

//     ${mkpi(
//       'Sản lượng đã giao',
//       fmtDec(
//         DB.subcontractingOrders.reduce(
//           (sum, order) => sum + order.issuedQty,
//           0
//         ),
//         2
//       ),
//       'fa-truck-ramp-box',
//       'orange'
//     )}

//     ${mkpi(
//       'Sản lượng đã nhận',
//       fmtDec(
//         DB.subcontractingOrders.reduce(
//           (sum, order) => sum + order.receivedQty,
//           0
//         ),
//         2
//       ),
//       'fa-box-open',
//       'green'
//     )}

//     ${mkpi(
//       'Công nợ còn lại',
//       fmtVND(
//         DB.subcontractingOrders.reduce(
//           (sum, order) =>
//             sum + (order.plannedQty * order.unitCost - order.paid),
//           0
//         )
//       ),
//       'fa-file-invoice-dollar',
//       'red'
//     )}
//   </div>

//   <div class="card">
//     ${tableShell(
//       [
//         { t: 'Mã đơn' },
//         { t: 'Đối tác' },
//         { t: 'Sản phẩm' },
//         { t: 'Kế hoạch', cls: 'right' },
//         { t: 'Đã giao', cls: 'right' },
//         { t: 'Đã nhận', cls: 'right' },
//         { t: 'Giá trị', cls: 'right' },
//         { t: 'Trạng thái' },
//         { t: '', cls: 'right' }
//       ],
//       rows,
//       {
//         emptyTitle: 'Chưa có kế hoạch gia công'
//       }
//     )}
//   </div>`;
// };

Views['subcontracting-overview'] = function () {

  const orders = DB.subcontractingOrders;

  const totalPlanned = orders.reduce(
    (sum, order) => sum + (Number(order.plannedQty) || 0),
    0
  );

  const totalIssued = orders.reduce(
    (sum, order) => sum + (Number(order.issuedQty) || 0),
    0
  );

  const totalReceived = orders.reduce(
    (sum, order) => sum + (Number(order.receivedQty) || 0),
    0
  );

  const totalDebt = orders.reduce(
    (sum, order) =>
      sum +
      ((Number(order.plannedQty) || 0) *
        (Number(order.unitCost) || 0)) -
      (Number(order.paid) || 0),
    0
  );

  const inProgress = orders.filter(
    order => order.status === 'IN_PROGRESS'
  ).length;

  const completed = orders.filter(
    order => order.status === 'COMPLETED'
  ).length;

  const overdue = orders.filter(order => {
    if (!order.dueDate || order.status === 'COMPLETED') {
      return false;
    }

    return order.dueDate < DB.today;
  }).length;

  return `${pageHead(
    'Gia công',
    'Tổng quan hoạt động gia công, tiến độ, sản lượng, chất lượng và công nợ',
    `
      <button class="btn btn-primary" data-act="subcontracting-new">
        <i class="fa-solid fa-plus"></i>
        Tạo kế hoạch gia công
      </button>
    `
  )}

  <div class="grid g-auto-sm" style="margin-bottom:14px">

    ${mkpi(
      'Đơn gia công',
      orders.length,
      'fa-industry',
      'blue'
    )}

    ${mkpi(
      'Sản lượng kế hoạch',
      fmtDec(totalPlanned, 2),
      'fa-clipboard-list',
      'teal'
    )}

    ${mkpi(
      'Đang thực hiện',
      inProgress,
      'fa-spinner',
      'orange'
    )}

    ${mkpi(
      'Đã hoàn thành',
      completed,
      'fa-circle-check',
      'green'
    )}

    ${mkpi(
      'Công nợ còn lại',
      fmtVND(totalDebt),
      'fa-file-invoice-dollar',
      'red'
    )}

  </div>

  <div class="grid g-auto-sm">

    <div class="card">
      <div class="card-head">
        <div>
          <h3>Tình hình sản lượng</h3>
          <p>Tổng hợp sản lượng gia công hiện tại</p>
        </div>
      </div>

      <div class="grid g-auto-sm">

        ${mkpi(
          'Đã giao nguyên liệu',
          fmtDec(totalIssued, 2),
          'fa-truck-ramp-box',
          'orange'
        )}

        ${mkpi(
          'Đã nhận về',
          fmtDec(totalReceived, 2),
          'fa-box-open',
          'green'
        )}

      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h3>Cảnh báo</h3>
          <p>Các đơn cần được theo dõi</p>
        </div>
      </div>

      <div class="grid g-auto-sm">

        ${mkpi(
          'Đơn đang thực hiện',
          inProgress,
          'fa-clock',
          'orange'
        )}

        ${mkpi(
          'Đơn quá hạn',
          overdue,
          'fa-triangle-exclamation',
          'red'
        )}

      </div>
    </div>

  </div>`;
};

Views.subcontracting = function () {
  const tab = State.tab || 'dashboard';

  switch (tab) {
    case 'dashboard':
      return Views['subcontracting-overview']
        ? Views['subcontracting-overview']()
        : '';

    case 'orders':
      return Views['subcontracting-orders']
        ? Views['subcontracting-orders']()
        : '';

    case 'issue':
      return Views['subcontracting-issue']
        ? Views['subcontracting-issue']()
        : '';

    case 'progress':
      return Views['subcontracting-progress']
        ? Views['subcontracting-progress']()
        : '';

    case 'receive':
      return Views['subcontracting-receive']
        ? Views['subcontracting-receive']()
        : '';

    case 'debt':
      return Views['subcontracting-debt']
        ? Views['subcontracting-debt']()
        : '';

    case 'partners':
      return Views['subcontracting-partners']
        ? Views['subcontracting-partners']()
        : '';

    default:
      return '';
  }
};

Views['subcontracting-orders'] = function () {

  const rows = DB.subcontractingOrders.map(order => {

    const progress = order.plannedQty
      ? Math.round(
          (order.receivedQty / order.plannedQty) * 100
        )
      : 0;

    const amount =
      (Number(order.plannedQty) || 0) *
      (Number(order.unitCost) || 0);

    return `<tr>

      <td>
        <span class="code">${esc(order.id)}</span>
      </td>

      <td class="strong">
        ${esc(order.partner)}
      </td>

      <td>
        ${esc(
          Q.product(order.productId)?.name ||
          order.productId
        )}
      </td>

      <td class="right num">
        ${fmtDec(order.plannedQty, 2)}
      </td>

      <td class="right num">
        ${fmtDec(order.issuedQty, 2)}
      </td>

      <td class="right num">
        ${fmtDec(order.receivedQty, 2)}
      </td>

      <td class="right num">
        ${progress}%
      </td>

      <td class="right num">
        ${fmtVND(amount)}
      </td>

      <td>
        ${badge(order.status)}
      </td>

      <td>
        ${rowActions([
          {
            act: 'subcontracting-issue',
            data: `data-id="${order.id}"`,
            icon: 'fa-arrow-right-from-bracket',
            title: 'Xuất nguyên liệu'
          }
        ])}
      </td>

    </tr>`;
  });

  return `${pageHead(
    'Đơn gia công',
    'Quản lý danh sách đơn gia công, số lượng, tiến độ và trạng thái thực hiện',
    `
      <button class="btn btn-primary"
        data-act="subcontracting-new">
        <i class="fa-solid fa-plus"></i>
        Tạo đơn gia công
      </button>
    `
  )}

  <div class="grid g-auto-sm" style="margin-bottom:14px">

    ${mkpi(
      'Tổng đơn',
      DB.subcontractingOrders.length,
      'fa-industry',
      'blue'
    )}

    ${mkpi(
      'Đang thực hiện',
      DB.subcontractingOrders.filter(
        order => order.status === 'IN_PROGRESS'
      ).length,
      'fa-spinner',
      'orange'
    )}

    ${mkpi(
      'Hoàn thành',
      DB.subcontractingOrders.filter(
        order => order.status === 'COMPLETED'
      ).length,
      'fa-circle-check',
      'green'
    )}

    ${mkpi(
      'Bản nháp',
      DB.subcontractingOrders.filter(
        order => order.status === 'DRAFT'
      ).length,
      'fa-file',
      'teal'
    )}

  </div>

  <div class="card">

    ${tableShell(
      [
        { t: 'Mã đơn' },
        { t: 'Đối tác' },
        { t: 'Sản phẩm' },
        { t: 'Kế hoạch', cls: 'right' },
        { t: 'Đã giao', cls: 'right' },
        { t: 'Đã nhận', cls: 'right' },
        { t: 'Tiến độ', cls: 'right' },
        { t: 'Giá trị', cls: 'right' },
        { t: 'Trạng thái' },
        { t: '', cls: 'right' }
      ],
      rows,
      {
        emptyTitle: 'Chưa có đơn gia công'
      }
    )}

  </div>`;
};

Views['subcontracting-issue'] = function () {

  const orders = DB.subcontractingOrders.filter(
    order => order.issuedQty < order.plannedQty
  );

  const rows = orders.map(order => {

    const remaining =
      Math.max(
        (Number(order.plannedQty) || 0) -
        (Number(order.issuedQty) || 0),
        0
      );

    const productName =
      Q.product(order.productId)?.name ||
      order.productId;

    return `<tr>

      <td>
        <span class="code">${esc(order.id)}</span>
      </td>

      <td class="strong">
        ${esc(order.partner)}
      </td>

      <td>
        ${esc(productName)}
      </td>

      <td class="right num">
        ${fmtDec(order.plannedQty, 2)}
      </td>

      <td class="right num">
        ${fmtDec(order.issuedQty, 2)}
      </td>

      <td class="right num strong">
        ${fmtDec(remaining, 2)}
      </td>

      <td>
        ${badge(order.status)}
      </td>

      <td>
        ${rowActions([
          {
            act: 'subcontracting-issue',
            data: `data-id="${order.id}"`,
            icon: 'fa-arrow-right-from-bracket',
            title: 'Xuất nguyên liệu'
          }
        ])}
      </td>

    </tr>`;
  });

  const totalPlanned = DB.subcontractingOrders.reduce(
    (sum, order) =>
      sum + (Number(order.plannedQty) || 0),
    0
  );

  const totalIssued = DB.subcontractingOrders.reduce(
    (sum, order) =>
      sum + (Number(order.issuedQty) || 0),
    0
  );

  const totalRemaining = Math.max(
    totalPlanned - totalIssued,
    0
  );

  return `${pageHead(
    'Xuất nguyên liệu',
    'Quản lý nguyên liệu cần giao cho đối tác gia công theo từng đơn',
    ''
  )}

  <div class="grid g-auto-sm" style="margin-bottom:14px">

    ${mkpi(
      'Đơn cần xuất',
      orders.length,
      'fa-truck-ramp-box',
      'orange'
    )}

    ${mkpi(
      'Sản lượng kế hoạch',
      fmtDec(totalPlanned, 2),
      'fa-clipboard-list',
      'blue'
    )}

    ${mkpi(
      'Đã xuất',
      fmtDec(totalIssued, 2),
      'fa-boxes-stacked',
      'green'
    )}

    ${mkpi(
      'Còn cần xuất',
      fmtDec(totalRemaining, 2),
      'fa-arrow-right-from-bracket',
      'red'
    )}

  </div>

  <div class="card">

    <div class="card-head">
      <div>
        <h3>Danh sách xuất nguyên liệu</h3>
        <p>Các đơn chưa hoàn tất việc giao nguyên liệu cho đối tác</p>
      </div>
    </div>

    ${tableShell(
      [
        { t: 'Mã đơn' },
        { t: 'Đối tác' },
        { t: 'Sản phẩm' },
        { t: 'Kế hoạch', cls: 'right' },
        { t: 'Đã xuất', cls: 'right' },
        { t: 'Còn cần xuất', cls: 'right' },
        { t: 'Trạng thái' },
        { t: '', cls: 'right' }
      ],
      rows,
      {
        emptyTitle: 'Không có đơn cần xuất nguyên liệu'
      }
    )}

  </div>`;
};

Views['subcontracting-progress'] = function () {

  const orders = DB.subcontractingOrders;

  const rows = orders.map(order => {

    const planned =
      Number(order.plannedQty) || 0;

    const received =
      Number(order.receivedQty) || 0;

    const progress = planned
      ? Math.min(
          Math.round((received / planned) * 100),
          100
        )
      : 0;

    const isOverdue =
      order.dueDate &&
      order.dueDate < DB.today &&
      order.status !== 'COMPLETED';

    let progressStatus = '';

    if (order.status === 'COMPLETED') {
      progressStatus = badge('COMPLETED');
    } else if (isOverdue) {
      progressStatus = badge('OVERDUE');
    } else if (progress > 0) {
      progressStatus = badge('IN_PROGRESS');
    } else {
      progressStatus = badge('DRAFT');
    }

    return `<tr>

      <td>
        <span class="code">${esc(order.id)}</span>
      </td>

      <td class="strong">
        ${esc(order.partner)}
      </td>

      <td>
        ${esc(
          Q.product(order.productId)?.name ||
          order.productId
        )}
      </td>

      <td class="right num">
        ${fmtDec(planned, 2)}
      </td>

      <td class="right num">
        ${fmtDec(order.issuedQty, 2)}
      </td>

      <td class="right num">
        ${fmtDec(received, 2)}
      </td>

      <td class="right num strong">
        ${progress}%
      </td>

      <td>
        ${esc(order.dueDate || '-')}
      </td>

      <td>
        ${progressStatus}
      </td>

    </tr>`;
  });

  const completed = orders.filter(
    order => order.status === 'COMPLETED'
  ).length;

  const inProgress = orders.filter(
    order => order.status === 'IN_PROGRESS'
  ).length;

  const overdue = orders.filter(order =>
    order.dueDate &&
    order.dueDate < DB.today &&
    order.status !== 'COMPLETED'
  ).length;

  const avgProgress = orders.length
    ? Math.round(
        orders.reduce((sum, order) => {
          const planned =
            Number(order.plannedQty) || 0;

          const received =
            Number(order.receivedQty) || 0;

          return sum + (
            planned
              ? Math.min((received / planned) * 100, 100)
              : 0
          );
        }, 0) / orders.length
      )
    : 0;

  return `${pageHead(
    'Theo dõi tiến độ',
    'Theo dõi tình trạng thực hiện và tiến độ nhận hàng của các đơn gia công',
    ''
  )}

  <div class="grid g-auto-sm" style="margin-bottom:14px">

    ${mkpi(
      'Tiến độ trung bình',
      `${avgProgress}%`,
      'fa-chart-line',
      'blue'
    )}

    ${mkpi(
      'Đang thực hiện',
      inProgress,
      'fa-spinner',
      'orange'
    )}

    ${mkpi(
      'Đã hoàn thành',
      completed,
      'fa-circle-check',
      'green'
    )}

    ${mkpi(
      'Quá hạn',
      overdue,
      'fa-triangle-exclamation',
      'red'
    )}

  </div>

  <div class="card">

    <div class="card-head">
      <div>
        <h3>Tiến độ đơn gia công</h3>
        <p>Theo dõi sản lượng đã giao và sản lượng đã nhận</p>
      </div>
    </div>

    ${tableShell(
      [
        { t: 'Mã đơn' },
        { t: 'Đối tác' },
        { t: 'Sản phẩm' },
        { t: 'Kế hoạch', cls: 'right' },
        { t: 'Đã giao', cls: 'right' },
        { t: 'Đã nhận', cls: 'right' },
        { t: 'Tiến độ', cls: 'right' },
        { t: 'Hạn hoàn thành' },
        { t: 'Tình trạng' }
      ],
      rows,
      {
        emptyTitle: 'Chưa có đơn gia công'
      }
    )}

  </div>`;
};

Views['subcontracting-receive'] = function () {

  const orders = DB.subcontractingOrders;

  const rows = orders.map(order => {

    const received =
      Number(order.receivedQty) || 0;

    const good =
      Number(order.goodQty) || 0;

    const defect =
      Number(order.defectQty) || 0;

    const defectRate =
      received > 0
        ? ((defect / received) * 100).toFixed(1)
        : '0.0';

    let qualityStatus = 'Chưa nhận';

    if (received > 0 && defect === 0) {
      qualityStatus = 'Đạt';
    } else if (defect > 0) {
      qualityStatus = 'Có lỗi';
    }

    return `<tr>

      <td>
        <span class="code">${esc(order.id)}</span>
      </td>

      <td class="strong">
        ${esc(order.partner)}
      </td>

      <td>
        ${esc(
          Q.product(order.productId)?.name ||
          order.productId
        )}
      </td>

      <td class="right num">
        ${fmtDec(order.plannedQty, 2)}
      </td>

      <td class="right num">
        ${fmtDec(received, 2)}
      </td>

      <td class="right num">
        ${fmtDec(good, 2)}
      </td>

      <td class="right num">
        ${fmtDec(defect, 2)}
      </td>

      <td class="right num">
        ${defectRate}%
      </td>

      <td>
        ${esc(qualityStatus)}
      </td>

      <td>
        ${rowActions([
          {
            act: 'subcontracting-receive',
            data: `data-id="${order.id}"`,
            icon: 'fa-box-open',
            title: 'Ghi nhận nhận hàng'
          }
        ])}
      </td>

    </tr>`;
  });

  const totalReceived = orders.reduce(
    (sum, order) =>
      sum + (Number(order.receivedQty) || 0),
    0
  );

  const totalGood = orders.reduce(
    (sum, order) =>
      sum + (Number(order.goodQty) || 0),
    0
  );

  const totalDefect = orders.reduce(
    (sum, order) =>
      sum + (Number(order.defectQty) || 0),
    0
  );

  const defectRate =
    totalReceived > 0
      ? ((totalDefect / totalReceived) * 100).toFixed(1)
      : '0.0';

  return `${pageHead(
    'Nhận hàng & chất lượng',
    'Ghi nhận sản lượng nhận về và theo dõi chất lượng sản phẩm gia công',
    ''
  )}

  <div class="grid g-auto-sm" style="margin-bottom:14px">

    ${mkpi(
      'Đã nhận',
      fmtDec(totalReceived, 2),
      'fa-box-open',
      'blue'
    )}

    ${mkpi(
      'Số lượng đạt',
      fmtDec(totalGood, 2),
      'fa-circle-check',
      'green'
    )}

    ${mkpi(
      'Số lượng lỗi',
      fmtDec(totalDefect, 2),
      'fa-circle-xmark',
      'red'
    )}

    ${mkpi(
      'Tỷ lệ lỗi',
      `${defectRate}%`,
      'fa-triangle-exclamation',
      'orange'
    )}

  </div>

  <div class="card">

    <div class="card-head">
      <div>
        <h3>Nhận hàng & kiểm soát chất lượng</h3>
        <p>Theo dõi số lượng nhận, số lượng đạt và số lượng lỗi</p>
      </div>
    </div>

    ${tableShell(
      [
        { t: 'Mã đơn' },
        { t: 'Đối tác' },
        { t: 'Sản phẩm' },
        { t: 'Kế hoạch', cls: 'right' },
        { t: 'Đã nhận', cls: 'right' },
        { t: 'Đạt', cls: 'right' },
        { t: 'Lỗi', cls: 'right' },
        { t: 'Tỷ lệ lỗi', cls: 'right' },
        { t: 'Chất lượng' },
        { t: '', cls: 'right' }
      ],
      rows,
      {
        emptyTitle: 'Chưa có dữ liệu nhận hàng'
      }
    )}

  </div>`;
};

Views['subcontracting-debt'] = function () {

  const orders = DB.subcontractingOrders;

  const rows = orders.map(order => {

    const amount =
      (Number(order.plannedQty) || 0) *
      (Number(order.unitCost) || 0);

    const paid =
      Number(order.paid) || 0;

    const debt =
      Math.max(amount - paid, 0);

    let debtStatus = 'Chưa thanh toán';

    if (debt <= 0) {
      debtStatus = 'Đã thanh toán';
    } else if (paid > 0) {
      debtStatus = 'Thanh toán một phần';
    }

    return `<tr>

      <td>
        <span class="code">${esc(order.id)}</span>
      </td>

      <td class="strong">
        ${esc(order.partner)}
      </td>

      <td>
        ${esc(
          Q.product(order.productId)?.name ||
          order.productId
        )}
      </td>

      <td class="right num">
        ${fmtDec(order.plannedQty, 2)}
      </td>

      <td class="right num">
        ${fmtVND(order.unitCost)}
      </td>

      <td class="right num">
        ${fmtVND(amount)}
      </td>

      <td class="right num">
        ${fmtVND(paid)}
      </td>

      <td class="right num strong">
        ${fmtVND(debt)}
      </td>

      <td>
        ${esc(debtStatus)}
      </td>

    </tr>`;
  });

  const totalAmount = orders.reduce(
    (sum, order) =>
      sum +
      (Number(order.plannedQty) || 0) *
      (Number(order.unitCost) || 0),
    0
  );

  const totalPaid = orders.reduce(
    (sum, order) =>
      sum + (Number(order.paid) || 0),
    0
  );

  const totalDebt =
    Math.max(totalAmount - totalPaid, 0);

  const paidOrders = orders.filter(order => {

    const amount =
      (Number(order.plannedQty) || 0) *
      (Number(order.unitCost) || 0);

    return amount > 0 &&
      (Number(order.paid) || 0) >= amount;

  }).length;

  const unpaidOrders = orders.filter(order => {

    const amount =
      (Number(order.plannedQty) || 0) *
      (Number(order.unitCost) || 0);

    return amount >
      (Number(order.paid) || 0);

  }).length;

  return `${pageHead(
    'Công nợ',
    'Theo dõi giá trị gia công, số tiền đã thanh toán và công nợ còn lại',
    ''
  )}

  <div class="grid g-auto-sm" style="margin-bottom:14px">

    ${mkpi(
      'Tổng giá trị',
      fmtVND(totalAmount),
      'fa-file-invoice',
      'blue'
    )}

    ${mkpi(
      'Đã thanh toán',
      fmtVND(totalPaid),
      'fa-money-bill-transfer',
      'green'
    )}

    ${mkpi(
      'Còn phải trả',
      fmtVND(totalDebt),
      'fa-file-invoice-dollar',
      'red'
    )}

    ${mkpi(
      'Đơn chưa thanh toán',
      unpaidOrders,
      'fa-clock',
      'orange'
    )}

  </div>

  <div class="card">

    <div class="card-head">
      <div>
        <h3>Công nợ gia công</h3>
        <p>Theo dõi thanh toán theo từng đơn gia công</p>
      </div>
    </div>

    ${tableShell(
      [
        { t: 'Mã đơn' },
        { t: 'Đối tác' },
        { t: 'Sản phẩm' },
        { t: 'SL', cls: 'right' },
        { t: 'Đơn giá', cls: 'right' },
        { t: 'Giá trị', cls: 'right' },
        { t: 'Đã trả', cls: 'right' },
        { t: 'Còn nợ', cls: 'right' },
        { t: 'Trạng thái' }
      ],
      rows,
      {
        emptyTitle: 'Chưa có dữ liệu công nợ'
      }
    )}

  </div>`;
};

Views['subcontracting-partners'] = function () {

  const partnerMap = {};

  DB.subcontractingOrders.forEach(order => {

    const partner = order.partner;

    if (!partnerMap[partner]) {
      partnerMap[partner] = {
        partner,
        orders: 0,
        plannedQty: 0,
        issuedQty: 0,
        receivedQty: 0,
        goodQty: 0,
        defectQty: 0,
        amount: 0,
        paid: 0
      };
    }

    const item = partnerMap[partner];

    item.orders += 1;

    item.plannedQty +=
      Number(order.plannedQty) || 0;

    item.issuedQty +=
      Number(order.issuedQty) || 0;

    item.receivedQty +=
      Number(order.receivedQty) || 0;

    item.goodQty +=
      Number(order.goodQty) || 0;

    item.defectQty +=
      Number(order.defectQty) || 0;

    item.amount +=
      (Number(order.plannedQty) || 0) *
      (Number(order.unitCost) || 0);

    item.paid +=
      Number(order.paid) || 0;
  });

  const partners = Object.values(partnerMap);

  const rows = partners.map(item => {

    const debt =
      Math.max(
        item.amount - item.paid,
        0
      );

    const defectRate =
      item.receivedQty > 0
        ? (
            item.defectQty /
            item.receivedQty *
            100
          ).toFixed(1)
        : '0.0';

    return `<tr>

      <td class="strong">
        ${esc(item.partner)}
      </td>

      <td class="right num">
        ${item.orders}
      </td>

      <td class="right num">
        ${fmtDec(item.plannedQty, 2)}
      </td>

      <td class="right num">
        ${fmtDec(item.issuedQty, 2)}
      </td>

      <td class="right num">
        ${fmtDec(item.receivedQty, 2)}
      </td>

      <td class="right num">
        ${fmtDec(item.goodQty, 2)}
      </td>

      <td class="right num">
        ${defectRate}%
      </td>

      <td class="right num">
        ${fmtVND(item.amount)}
      </td>

      <td class="right num">
        ${fmtVND(debt)}
      </td>

      <td>
        ${rowActions([
          {
            act: 'subcontracting-partner-detail',
            data: `data-partner="${esc(item.partner)}"`,
            icon: 'fa-eye',
            title: 'Xem chi tiết'
          }
        ])}
      </td>

    </tr>`;
  });

  const totalPartners = partners.length;

  const totalOrders = partners.reduce(
    (sum, item) =>
      sum + item.orders,
    0
  );

  const totalAmount = partners.reduce(
    (sum, item) =>
      sum + item.amount,
    0
  );

  const totalDebt = partners.reduce(
    (sum, item) =>
      sum + Math.max(item.amount - item.paid, 0),
    0
  );

  return `${pageHead(
    'Đối tác gia công',
    'Quản lý và theo dõi tình hình thực hiện của các đối tác gia công',
    `
      <button class="btn btn-primary"
        data-act="subcontracting-partner-new">
        <i class="fa-solid fa-plus"></i>
        Thêm đối tác
      </button>
    `
  )}

  <div class="grid g-auto-sm" style="margin-bottom:14px">

    ${mkpi(
      'Đối tác',
      totalPartners,
      'fa-handshake',
      'blue'
    )}

    ${mkpi(
      'Tổng đơn gia công',
      totalOrders,
      'fa-industry',
      'teal'
    )}

    ${mkpi(
      'Tổng giá trị',
      fmtVND(totalAmount),
      'fa-file-invoice',
      'green'
    )}

    ${mkpi(
      'Công nợ',
      fmtVND(totalDebt),
      'fa-file-invoice-dollar',
      'red'
    )}

  </div>

  <div class="card">

    <div class="card-head">
      <div>
        <h3>Danh sách đối tác gia công</h3>
        <p>Tổng hợp sản lượng, chất lượng và công nợ theo đối tác</p>
      </div>
    </div>

    ${tableShell(
      [
        { t: 'Đối tác' },
        { t: 'Số đơn', cls: 'right' },
        { t: 'Kế hoạch', cls: 'right' },
        { t: 'Đã giao', cls: 'right' },
        { t: 'Đã nhận', cls: 'right' },
        { t: 'Đạt', cls: 'right' },
        { t: 'Tỷ lệ lỗi', cls: 'right' },
        { t: 'Giá trị', cls: 'right' },
        { t: 'Công nợ', cls: 'right' },
        { t: '', cls: 'right' }
      ],
      rows,
      {
        emptyTitle: 'Chưa có đối tác gia công'
      }
    )}

  </div>`;
};
function openSubcontractingForm() {
  Modal.open({ title: 'Tạo kế hoạch gia công', sub: 'Khai báo đối tác, sản phẩm, số lượng và hạn hoàn thành', size: 'md', body: `<div class="form-grid"><div class="field"><label>Đối tác gia công</label><input class="inp" id="subPartner" value="Cơ sở Đậu Hủ Tân Phúc" /></div><div class="field"><label>Sản phẩm</label><select class="inp" id="subProduct">${DB.products.map((product) => `<option value="${product.id}">${esc(product.name)}</option>`).join('')}</select></div></div><div class="form-grid"><div class="field"><label>Số lượng kế hoạch</label><input class="inp num" id="subQty" type="number" min="1" value="500" /></div><div class="field"><label>Đơn giá gia công</label><input class="inp num" id="subCost" data-money="1" type="text" inputmode="numeric" min="0" value="1500" /></div></div><div class="form-grid"><div class="field"><label>Ngày giao nguyên liệu</label><input class="inp" id="subIssueDate" type="date" value="${currentDateYMD()}" min="${currentDateYMD()}" /></div><div class="field"><label>Ngày cần hoàn thành</label><input class="inp" id="subDueDate" type="date" value="${addDays(currentDateYMD(), 10)}" min="${currentDateYMD()}" /></div></div>`, foot: '<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-save"><i class="fa-solid fa-floppy-disk"></i>Lưu kế hoạch</button>' });
}


function incomingInspectionView() {
  const f = F('quality-iqc', { q: '', status: '' });
  const q = (f.q || '').toLowerCase().trim();
  const receipts = incomingInspectionReceipts().filter(r => {
    // Phiếu nhập phát sinh từ PO chính là nguồn chờ IQC. Không bắt buộc
    // purchaseOrders phải hydrate xong mới cho hiển thị, vì khi QC đăng nhập
    // trực tiếp thì goodsReceipts có thể về server trước metadata PO.
    if (!r.poId || !(r.items || []).length) return false;
    const po = Q.purchaseOrder(r.poId);
    if (f.status && incomingInspectionStatus(r) !== f.status) return false;
    if (q && ![r.id, r.poId, r.prId, Q.supplierName(po?.supplierId || r.supplierId), r.note].some(v => String(v || '').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b) => String(b.id).localeCompare(String(a.id)));
  const pg = paged(receipts, 'quality-iqc');
  const rows = pg.items.map(r => {
    const po = Q.purchaseOrder(r.poId);
    const status = incomingInspectionStatus(r);
    const statusHtml = status === 'PASSED' ? '<span class="badge green">Đạt</span>' : (status === 'FAILED' || status === 'PARTIAL_FAILED') ? '<span class="badge red">Có nguyên liệu không đạt</span>' : '<span class="badge orange">Chờ kiểm</span>';
    return `<tr>
      <td><span class="code">${esc(r.id)}</span><div class="cell-sub">Đợt nhập ${fmtN((Q.receiptsOfPo(r.poId).sort((a,b)=>String(a.id).localeCompare(String(b.id))).findIndex(x=>x.id===r.id)+1) || 1)}</div></td>
      <td><span class="code">${esc(r.poId)}</span></td>
      <td>${esc(Q.supplierName(po?.supplierId))}</td>
      <td class="num">${fmtDate(r.date)}</td>
      <td>${esc(r.warehouse || Q.warehouseName(r.warehouseId))}</td>
      <td>${esc((r.items||[]).map(i=>`${i.name} (${fmtN(i.qty)} ${i.unit})`).join(', '))}</td>
      <td>${statusHtml}</td>
      <td class="right">${status === 'PENDING' ? `<button class="btn btn-sm btn-primary" data-act="iqc-open-inspection" data-id="${esc(r.id)}"><i class="fa-solid fa-clipboard-check"></i>Kiểm tra</button>` : `<button class="btn btn-sm" data-act="iqc-open-inspection" data-id="${esc(r.id)}"><i class="fa-solid fa-eye"></i>Xem kết quả</button>`}</td>
    </tr>`;
  });
  return `${pageHead('Kiểm tra nguyên liệu đầu vào', 'Kiểm tra theo từng phiếu nhập/đợt nhập. Nguyên liệu không đạt sẽ sinh yêu cầu trả chuyển sang Kho nguyên liệu.', '')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Đợt chờ kiểm', receipts.filter(r => incomingInspectionStatus(r) === 'PENDING').length, 'fa-clock', 'orange')}
      ${mkpi('Đợt đạt', receipts.filter(r => r.inspectionStatus === 'PASSED').length, 'fa-circle-check', 'green')}
      ${mkpi('Đợt có lỗi', receipts.filter(r => ['FAILED','PARTIAL_FAILED'].includes(r.inspectionStatus)).length, 'fa-triangle-exclamation', 'red')}
      ${mkpi('Yêu cầu trả chờ kho', (DB.materialReturnRequests||[]).filter(r=>r.status==='PENDING_WAREHOUSE').length, 'fa-rotate-left', 'blue')}
    </div>
    <div class="card"><div class="toolbar">${searchBox('quality-iqc','Tìm phiếu nhập, PO, NCC…')}${selectFilter('quality-iqc','status',[['PENDING','Chờ kiểm'],['PASSED','Đạt'],['PARTIAL_FAILED','Có lỗi một phần'],['FAILED','Không đạt']], 'Tất cả kết quả')}${(f.q||f.status)?'<button class="btn btn-sm" data-act="clear-filter" data-key="quality-iqc"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}<span class="spacer"></span><span class="chip">${receipts.length} đợt nhập</span></div>
    ${tableShell([{t:'Phiếu nhập / Đợt'},{t:'PO'},{t:'Nhà cung cấp'},{t:'Ngày nhập'},{t:'Kho'},{t:'Nguyên liệu'},{t:'Kết quả'},{t:'',cls:'right'}], rows, {emptyTitle:'Chưa có đợt nhập nào cần kiểm tra'})}${pagiHTML('quality-iqc', pg, 'đợt nhập')}</div>`;
}

function openIncomingInspectionModal(receiptId) {
  const receipt = (DB.goodsReceipts || []).find(r => r.id === receiptId);
  if (!receipt) return;
  const po = Q.purchaseOrder(receipt.poId);
  const readonly = incomingInspectionStatus(receipt) !== 'PENDING' || !Auth.hasPermission('QC_INSPECT');
  Modal.open({
    title: `Kiểm tra nguyên liệu · ${receipt.id}`,
    sub: `${receipt.poId} · ${esc(Q.supplierName(po?.supplierId))} · kiểm tra theo đúng đợt nhập ngày ${fmtDate(receipt.date)}`,
    size: 'lg',
    body: `
      <div class="info-grid" style="margin-bottom:16px">
        ${infoItem('Phiếu nhập', `<span class="code">${esc(receipt.id)}</span>`)}
        ${infoItem('Đơn đặt hàng', `<span class="code">${esc(receipt.poId)}</span>`)}
        ${infoItem('Kho / Kệ', `${esc(receipt.warehouse || Q.warehouseName(receipt.warehouseId))} · ${esc(receipt.location || Q.locationName(receipt.locationId))}`)}
        ${infoItem('Người nhập kho', esc(Q.employeeName(receipt.receivedBy)))}
      </div>
      <div class="form-grid"><div class="field"><label>Người kiểm tra</label><input class="inp" value="${esc(readonly ? Q.employeeName(receipt.inspectedBy) : (DB.currentUser?.name || Q.employeeName(DB.currentUser?.id)))}" disabled><div class="cell-sub" style="margin-top:5px">${readonly ? 'Người đã thực hiện kiểm tra của đợt nhập này.' : 'Tự động lấy theo tài khoản đang đăng nhập; không cho chọn thay người khác.'}</div></div><div class="field"><label>Ngày kiểm tra</label><input class="inp" value="${esc(qualityDashboardDay(receipt.inspectedAt)||currentDateYMD())}" disabled></div></div>
      <div class="form-sec-title"><i class="fa-solid fa-vials"></i>Kết quả theo từng nguyên liệu</div>
      <div class="tbl-wrap"><table class="line-tbl"><thead><tr><th>Nguyên liệu</th><th>SL nhập</th><th>Lô hệ thống</th><th>Lô SP/NCC</th><th class="right">SL không đạt / trả</th><th>Lý do</th></tr></thead><tbody>
      ${(receipt.items||[]).map(i=>`<tr><td>${cell2(esc(i.name),esc(i.materialId))}</td><td class="num">${fmtN(i.qty)} ${esc(i.unit)}</td><td><span class="code">${esc(i.lotNumber||'—')}</span></td><td>${esc(i.supplierLot||Q.lot(i.lotId)?.supplierLot||'—')}</td><td><input class="inp right num iqc-fail-qty" data-mid="${esc(i.materialId)}" type="number" min="0" step="any" max="${Number(i.qty||0)}" value="${Number(i.failedQty||0)}" ${readonly?'disabled':''}></td><td><input class="inp iqc-reason" data-mid="${esc(i.materialId)}" value="${esc(i.qcReason||'')}" placeholder="Mùi, màu, bao bì, độ ẩm…" ${readonly?'disabled':''}></td></tr>`).join('')}
      </tbody></table></div>
      <div class="field" style="margin-top:12px"><label>Ghi chú kiểm tra</label><textarea class="inp" id="iqcNote" rows="2" ${readonly?'disabled':''}>${esc(receipt.inspectionNote||'')}</textarea></div>
      ${readonly ? `<div class="alert-item"><i class="fa-solid fa-circle-info"></i><div><b>Đợt nhập đã được kiểm tra</b><div class="muted">Kết quả đã khóa. Yêu cầu trả nguyên liệu (nếu có) đang/đã được xử lý ở Kho → Xuất kho → Kho nguyên liệu.</div></div></div>` : ''}`,
    foot: `<button class="btn" data-act="modal-close">Đóng</button>${readonly?'':`<button class="btn btn-primary" data-act="iqc-save-inspection" data-id="${esc(receipt.id)}"><i class="fa-solid fa-floppy-disk"></i>Lưu kết quả kiểm tra</button>`}`
  });
  setTimeout(() => document.querySelectorAll('.iqc-fail-qty').forEach(inp => {
    const total = Number(inp.max || 0); const out = document.createElement('div'); out.className = 'cell-sub';
    inp.insertAdjacentElement('afterend', out);
    const upd = () => { const f = Math.min(total, Math.max(0, Number(inp.value || 0))); out.innerHTML = `Đạt: <b>${fmtN(Math.round((total - f) * 10000) / 10000)}</b>`; };
    inp.addEventListener('input', upd); upd();
  }), 0);
}


/* ==========================================================================\n * QC THÀNH PHẨM - nhận trực tiếp từ Lệnh sản xuất\n * Thành phẩm chỉ là tồn chờ QC (qtyPending), chưa được cộng qtyOnHand.\n * ======================================================================= */

/* ============================================================================
 * QC BÁN THÀNH PHẨM - checkpoint PROCESS_QC trong routing
 * - Không phát sinh tồn kho / lô thành phẩm.
 * - Kết quả lưu trong stage của lenam_production_orders trên KIO server.
 * ========================================================================== */
function processQcStatusHtml(stage) {
  const q = stage?.processQc || {};
  const legacyPending = q.status === 'FAILED' ? Math.max(0, Number(q.lastFailQty || 0)) : 0;
  const pending = Math.max(0, Number(q.pendingReworkQty ?? legacyPending));
  const ready = Math.max(0, Number(q.readyRetestQty || 0));
  if (stage?.status === 'done' || q.status === 'PASSED') return '<span class="badge green">Đạt</span>';
  if (pending > 0 || q.status === 'REWORK_PENDING' || q.status === 'FAILED') return `<span class="badge red">Chờ sửa/tái chế${pending?` ${fmtN(pending)}`:''}</span>`;
  if (ready > 0 || q.status === 'READY_RETEST') return `<span class="badge orange">Chờ tái kiểm${ready?` ${fmtN(ready)}`:''}</span>`;
  if (Number(stage?.qtyDone || 0) > 0 || q.status === 'IN_PROGRESS') return '<span class="badge blue">Đang kiểm</span>';
  return '<span class="badge orange">Chờ kiểm</span>';
}

function processInspectionRows() {
  const out = [];
  (DB.productionOrders || []).forEach(po => {
    (po.stages || []).forEach((stage, index) => {
      if (typeof isProcessQcStage !== 'function' || !isProcessQcStage(po, index)) return;
      const reached = stage.status === 'doing' || stage.status === 'done' || Number(stage.qtyDone || 0) > 0 || (stage.processQcHistory || []).length;
      if (!reached) return;
      out.push({ po, stage, index, id:`${po.id}::${index}` });
    });
  });
  return out;
}

function processInspectionView() {
  const f = F('quality-pqc', { q:'', status:'' });
  const q = String(f.q || '').toLowerCase().trim();
  let list = processInspectionRows().filter(x => {
    const sq=x.stage.processQc||{};
    const legacyPending=sq.status==='FAILED'?Math.max(0,Number(sq.lastFailQty||0)):0;
    const pending=Math.max(0,Number(sq.pendingReworkQty??legacyPending));
    const ready=Math.max(0,Number(sq.readyRetestQty||0));
    const status = x.stage.status === 'done' ? 'PASSED' : pending>0?'REWORK_PENDING':ready>0?'READY_RETEST':(sq.status || 'PENDING');
    if (f.status && status !== f.status) return false;
    if (q && ![x.po.id,x.po.productName,x.po.productId,x.stage.name,x.stage.operationId,Q.employeeName(x.stage.leadId)].some(v=>String(v||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b)=>String(b.po.id).localeCompare(String(a.po.id),'vi',{numeric:true}) || b.index-a.index);
  const pg = paged(list,'quality-pqc');
  const rows = pg.items.map(({po,stage,index}) => {
    const plan=Number(stage.qtyPlan||po.qty||0);
    const passed=Number(stage.qtyDone||0);
    const qv=stage.processQc||{};
    const legacyPending=qv.status==='FAILED'?Math.max(0,Number(qv.lastFailQty||0)):0;
    const pending=Math.max(0,Number(qv.pendingReworkQty??legacyPending));
    const ready=Math.max(0,Number(qv.readyRetestQty||0));
    const remaining = Math.max(0, plan-passed);
    const hist = stage.processQcHistory || [];
    const last = hist.length ? hist[hist.length-1] : null;
    return `<tr class="clickable" data-act="pqc-open" data-id="${esc(po.id)}" data-i="${index}">
      <td>${cell2(`<span class="code">${esc(po.id)}</span>`, esc(po.productName||po.productId))}</td>
      <td>${cell2(`<b>${esc(stage.name)}</b>`, esc(stage.operationId||'PROCESS_QC'))}</td>
      <td class="right num">${fmtN(passed)} / ${fmtN(plan)} ${esc(po.unit||'')}</td>
      <td class="right num">${fmtN(remaining)} ${esc(po.unit||'')}</td>
      <td>${processQcStatusHtml(stage)}${pending?`<div class="muted" style="margin-top:3px">Lỗi chờ sửa: ${fmtN(pending)}</div>`:''}${ready?`<div class="muted" style="margin-top:3px">Sẵn sàng tái kiểm: ${fmtN(ready)}</div>`:''}</td>
      <td>${last ? cell2(esc(last.inspectorName||Q.employeeName(last.inspectorId)||'QC'), `${last.inspectionType==='RETEST'?'Tái kiểm':'Kiểm lần đầu'} · ${fmtDate(String(last.inspectedAt||'').slice(0,10))}`) : '<span class="muted">—</span>'}</td>
      <td class="right">${rowActions([{act:'pqc-open',data:`data-id="${esc(po.id)}" data-i="${index}"`,icon:'fa-vial-circle-check',title:'Kiểm tra bán thành phẩm'}])}</td>
    </tr>`;
  });
  const reworkCount=list.filter(x=>{const q=x.stage.processQc||{};return Number(q.pendingReworkQty||(q.status==='FAILED'?q.lastFailQty:0)||0)>0}).length;
  const retestCount=list.filter(x=>Number(x.stage.processQc?.readyRetestQty||0)>0).length;
  return `${pageHead('Kiểm tra bán thành phẩm','QC giữa quy trình sản xuất. Hàng lỗi phải sửa/tái chế và tái kiểm đạt trước khi đi công đoạn tiếp theo.','')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Chờ / đang kiểm',list.filter(x=>x.stage.status!=='done' && !Number(x.stage.processQc?.pendingReworkQty||0) && !Number(x.stage.processQc?.readyRetestQty||0)).length,'fa-clock','orange')}
      ${mkpi('Chờ sửa / tái chế',reworkCount,'fa-screwdriver-wrench','red')}
      ${mkpi('Chờ tái kiểm',retestCount,'fa-rotate','orange')}
      ${mkpi('Đạt',list.filter(x=>x.stage.status==='done').length,'fa-circle-check','green')}
    </div>
    <div class="card"><div class="toolbar">${searchBox('quality-pqc','Tìm LSX, thành phẩm, công đoạn QC…')}${selectFilter('quality-pqc','status',[['PENDING','Chờ kiểm'],['IN_PROGRESS','Đang kiểm'],['REWORK_PENDING','Chờ sửa/tái chế'],['READY_RETEST','Chờ tái kiểm'],['PASSED','Đạt']],'Tất cả kết quả')}${(f.q||f.status)?'<button class="btn btn-sm" data-act="clear-filter" data-key="quality-pqc"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}<span class="spacer"></span><span class="chip">${fmtN(list.length)} checkpoint QC</span></div>
      ${tableShell([{t:'LSX / Thành phẩm'},{t:'Công đoạn QC'},{t:'Đã đạt / Kế hoạch',cls:'right'},{t:'Còn phải đạt',cls:'right'},{t:'Kết quả'},{t:'Lần kiểm gần nhất'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có bán thành phẩm chờ kiểm',emptyDesc:'Khi LSX đi tới một công đoạn PROCESS_QC, checkpoint sẽ tự xuất hiện tại đây.'})}${pagiHTML('quality-pqc',pg,'checkpoint QC')}
    </div>`;
}

function openProcessInspectionModal(poId, index) {
  const po = Q.po(poId); if (!po) return;
  const stage = (po.stages || [])[Number(index)];
  if (!stage || typeof isProcessQcStage !== 'function' || !isProcessQcStage(po, Number(index))) return;
  const plan = Number(stage.qtyPlan || po.qty || 0);
  const passed = Number(stage.qtyDone || 0);
  const q = stage.processQc || {};
  const legacyPending = q.status === 'FAILED' ? Math.max(0, Number(q.lastFailQty || 0)) : 0;
  const pending = Math.max(0, Number(q.pendingReworkQty ?? legacyPending));
  const ready = Math.max(0, Number(q.readyRetestQty || 0));
  const uninspected = Math.max(0, Number(q.uninspectedQty ?? (plan - passed - pending - ready)));
  const isRetest = ready > 0;
  const maxCheck = isRetest ? ready : uninspected;
  const readonly = stage.status === 'done' || !Auth.hasPermission('QC_INSPECT') || (pending > 0 && ready <= 0);
  const history = (stage.processQcHistory || []).filter(h=>h && h.eventType !== 'REWORK');
  const historyRows = history.slice().reverse().map((h,revIdx)=>`<tr><td class="center">${fmtN(h.inspectionNo || (history.length-revIdx))}</td><td>${h.inspectionType==='RETEST'?'<span class="badge orange">Tái kiểm</span>':'<span class="badge blue">Kiểm lần đầu</span>'}</td><td>${typeof fmtDateTime==='function' ? fmtDateTime(h.inspectedAt) : esc(String(h.inspectedAt||'').replace('T',' ').slice(0,16))}</td><td>${esc(h.inspectorName||Q.employeeName(h.inspectorId)||'QC')}</td><td class="right num">${fmtN(h.checkedQty ?? (Number(h.passQty||0)+Number(h.failQty||0)))}</td><td class="right num">${fmtN(h.passQty||0)}</td><td class="right num">${fmtN(h.failQty||0)}</td><td>${esc(h.note||'—')}</td></tr>`).join('');
  const reworks = stage.processQcReworkHistory || [];
  const reworkRows = reworks.slice().reverse().map(h=>`<tr><td>${typeof fmtDateTime==='function'?fmtDateTime(h.reworkedAt):esc(String(h.reworkedAt||'').replace('T',' ').slice(0,16))}</td><td>${esc(h.userName||Q.employeeName(h.userId)||'Sản xuất')}</td><td class="right num">${fmtN(h.qty||0)} ${esc(po.unit||'')}</td></tr>`).join('');
  const stateNote = pending > 0 && ready <= 0
    ? `<div class="note-box warn" style="margin-bottom:14px"><b>Đang chờ Sản xuất sửa/tái chế ${fmtN(pending)} ${esc(po.unit||'')}.</b> QC chỉ được tái kiểm sau khi Sản xuất xác nhận đã xử lý xong phần lỗi.</div>`
    : isRetest
      ? `<div class="note-box" style="margin-bottom:14px"><b>Tái kiểm ${fmtN(ready)} ${esc(po.unit||'')} đã sửa/tái chế.</b> Chỉ phần tái kiểm đạt mới được cộng vào tổng sản lượng đạt QC.</div>`
      : `<div class="note-box" style="margin-bottom:14px"><b>QC bán thành phẩm không nhập kho.</b> Nếu phát hiện lỗi, phần lỗi sẽ chuyển sang Sản xuất sửa/tái chế; công đoạn tiếp theo vẫn bị khóa.</div>`;
  Modal.open({
    title:`${isRetest?'Tái kiểm':'Kiểm tra'} bán thành phẩm · ${stage.name}`,
    sub:`${po.id} · ${po.productName} · Kế hoạch ${fmtN(plan)} ${po.unit||''}`,
    size:'lg',
    body:`<div class="info-grid" style="margin-bottom:14px">
      ${infoItem('Lệnh sản xuất',`<span class="code">${esc(po.id)}</span>`)}
      ${infoItem('Công đoạn',esc(stage.name))}
      ${infoItem('Đã đạt QC',`<b>${fmtN(passed)} / ${fmtN(plan)} ${esc(po.unit||'')}</b>`)}
      ${infoItem('Chưa kiểm lần đầu',`<b>${fmtN(uninspected)} ${esc(po.unit||'')}</b>`)}
      ${infoItem('Chờ sửa/tái chế',`<b style="color:${pending?'var(--red)':'inherit'}">${fmtN(pending)} ${esc(po.unit||'')}</b>`)}
      ${infoItem('Sẵn sàng tái kiểm',`<b>${fmtN(ready)} ${esc(po.unit||'')}</b>`)}
      ${infoItem('Người phụ trách SX',esc(Q.employeeName(stage.leadId)))}
      ${infoItem('Trạng thái',processQcStatusHtml(stage))}
    </div>
    ${stateNote}
    ${readonly ? '' : `<div class="form-grid cols-2">
      <div class="field"><label>${isRetest?'Số lượng đạt tái kiểm':'Số lượng đạt lần này'} *</label><input class="inp right num" id="pqcPass" type="number" min="0" max="${maxCheck}" step="0.0001" value="" placeholder="Tối đa ${fmtN(maxCheck)}"></div>
      <div class="field"><label>${isRetest?'Số lượng vẫn lỗi':'Số lượng không đạt lần này'} *</label><input class="inp right num" id="pqcFail" type="number" min="0" max="${maxCheck}" step="0.0001" value="0"></div>
      <div class="field"><label>Người kiểm</label><input class="inp" value="${esc(DB.currentUser?.name||'QC/QA')}" disabled></div>
      <div class="field"><label>Ngày kiểm</label><input class="inp" value="${esc(currentDateYMD())}" disabled></div>
      <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea class="inp" id="pqcNote" rows="3" placeholder="${isRetest?'Kết quả sau sửa/tái chế…':'Nguyên nhân lỗi, hướng xử lý…'}"></textarea></div>
    </div>`}
    <div class="form-sec-title" style="margin-top:14px">Lịch sử kiểm tra / tái kiểm</div>
    ${tableShell([{t:'Lần',cls:'center'},{t:'Loại'},{t:'Thời gian'},{t:'Người kiểm'},{t:'SL kiểm',cls:'right'},{t:'Đạt',cls:'right'},{t:'Lỗi',cls:'right'},{t:'Ghi chú'}],historyRows,{emptyTitle:'Chưa có lần kiểm nào'})}
    ${reworks.length?`<div class="form-sec-title" style="margin-top:14px">Lịch sử sửa / tái chế</div>${tableShell([{t:'Thời gian'},{t:'Người xác nhận'},{t:'Số lượng',cls:'right'}],reworkRows,{emptyTitle:'Chưa có lần sửa/tái chế'})}`:''}`,
    foot:`<button class="btn" data-act="modal-close">Đóng</button>${readonly?'':`<button class="btn btn-primary" data-act="pqc-save" data-id="${esc(po.id)}" data-i="${Number(index)}"><i class="fa-solid fa-vial-circle-check"></i>${isRetest?'Lưu kết quả tái kiểm':'Lưu kết quả QC'}</button>`}`
  });
  qcBindComplement('#pqcPass', '#pqcFail', maxCheck);
}

/* ============================================================================
 * Tự tính SL đạt / không đạt theo chỉ số còn lại: nhập một ô thì ô kia = tổng − giá trị vừa nhập.
 * ========================================================================== */
function qcBindComplementEls(passEl, failEl, total) {
  if (!passEl || !failEl || passEl.disabled || failEl.disabled) return;
  const max = Number(total || 0);
  const r4 = (n) => Math.round(n * 10000) / 10000;
  const clamp = (n) => Math.min(max, Math.max(0, n));
  passEl.addEventListener('input', () => { if (passEl.value === '') return; failEl.value = r4(clamp(max - Number(passEl.value || 0))); });
  failEl.addEventListener('input', () => { if (failEl.value === '') return; passEl.value = r4(clamp(max - Number(failEl.value || 0))); });
}
function qcBindComplement(passSel, failSel, total) {
  setTimeout(() => qcBindComplementEls(document.querySelector(passSel), document.querySelector(failSel), total), 0);
}

/* ============================================================================
 * QC XUẤT KHO (OQC): đơn hàng → QC → Kho → Logistics.
 * Phiếu SALES_ISSUE chờ xác nhận phải có gi.qcStatus = PASSED thì Kho mới được xuất.
 * ========================================================================== */
function outboundQcStatusHtml(gi) {
  const st = String(gi?.qcStatus || 'PENDING').toUpperCase();
  if (st === 'PASSED') return '<span class="badge green">QC đạt</span>';
  if (st === 'FAILED') return '<span class="badge red">QC không đạt</span>';
  return '<span class="badge orange">Chờ QC</span>';
}
function outboundInspectionRows() {
  return (DB.goodsIssues || []).filter(g => g && g.type === 'SALES_ISSUE' && (g.status === 'PENDING_CONFIRMATION' || g.qcStatus));
}
function outboundInspectionView() {
  const f = F('quality-oqc', { q: '', status: '' });
  const q = String(f.q || '').toLowerCase().trim();
  const all = outboundInspectionRows();
  const st = (g) => String(g.qcStatus || 'PENDING').toUpperCase();
  const list = all.filter(g => {
    if (f.status && st(g) !== f.status) return false;
    const o = Q.order(g.orderId || g.refDoc);
    return !q || [g.id, g.orderId, g.refDoc, o && Q.customerName(o.customerId), ...(g.items || []).map(i => Q.product(i.productId)?.name)].some(v => String(v || '').toLowerCase().includes(q));
  }).sort((a, b) => String(b.id).localeCompare(String(a.id), 'vi', { numeric: true }));
  const pg = paged(list, 'quality-oqc');
  const rows = pg.items.map(g => {
    const o = Q.order(g.orderId || g.refDoc);
    const total = (g.items || []).reduce((n, i) => n + Number(i.qty || 0), 0);
    return `<tr class="clickable" data-act="oqc-open" data-id="${esc(g.id)}">
      <td>${cell2(`<span class="code">${esc(g.id)}</span>`, `Đơn <span class="code">${esc(g.orderId || g.refDoc || '—')}</span>`)}</td>
      <td>${esc(o ? Q.customerName(o.customerId) : '—')}</td>
      <td>${esc(Q.warehouseName(g.warehouseId))}</td>
      <td>${(g.items || []).map(i => `${esc(Q.product(i.productId)?.name || i.productId)} · <b>${fmtN(i.qty)}</b>`).join('<br>')}<div class="cell-sub">Tổng ${fmtN(total)}</div></td>
      <td>${outboundQcStatusHtml(g)}${g.status === 'COMPLETED' ? '<div class="cell-sub">Đã xuất kho</div>' : ''}</td>
      <td>${fmtDate(String(g.qcInspectedAt || g.date || '').slice(0, 10))}</td>
      <td class="right">${rowActions([{ act: 'oqc-open', data: `data-id="${esc(g.id)}"`, icon: st(g) === 'PENDING' ? 'fa-vial-circle-check' : 'fa-eye', title: st(g) === 'PENDING' ? 'Kiểm tra' : 'Xem' }])}</td></tr>`;
  });
  const count = (s) => all.filter(g => st(g) === s).length;
  return `${pageHead('Kiểm tra chất lượng xuất kho', 'Luồng xuất bán: Đơn hàng → QC → Kho → Logistics. Kho chỉ được xác nhận xuất khi QC đạt.')}
  <div class="grid g-auto-sm" style="margin-bottom:14px">
    ${mkpi('Chờ QC', count('PENDING'), 'fa-hourglass-half', 'orange')}
    ${mkpi('QC đạt', count('PASSED'), 'fa-circle-check', 'green')}
    ${mkpi('QC không đạt', count('FAILED'), 'fa-circle-xmark', 'red')}
  </div>
  <div class="card"><div class="toolbar">${searchBox('quality-oqc', 'Tìm phiếu xuất, đơn hàng, khách hàng…')}${selectFilter('quality-oqc', 'status', [['PENDING', 'Chờ QC'], ['PASSED', 'QC đạt'], ['FAILED', 'QC không đạt']], 'Tất cả trạng thái')}</div>
  ${tableShell([{ t: 'Phiếu xuất / Đơn' }, { t: 'Khách hàng' }, { t: 'Kho' }, { t: 'Hàng xuất' }, { t: 'Trạng thái QC' }, { t: 'Ngày' }, { t: '', cls: 'right', w: '80px' }], rows, { emptyTitle: 'Chưa có phiếu xuất cần kiểm tra' })}
  ${pagiHTML('quality-oqc', pg, 'phiếu xuất')}</div>`;
}
function openOutboundInspectionModal(id) {
  const gi = (DB.goodsIssues || []).find(x => x.id === id); if (!gi) return;
  const o = Q.order(gi.orderId || gi.refDoc);
  const st = String(gi.qcStatus || 'PENDING').toUpperCase();
  const readonly = st !== 'PENDING' || gi.status !== 'PENDING_CONFIRMATION' || !Auth.hasPermission('QC_INSPECT');
  const prev = gi.qcLines || [];
  const lines = (gi.items || []).map((i, idx) => {
    const lot = Q.lot(i.lotId); const item = Q.product(i.productId);
    const old = prev.find(l => l.productId === i.productId && String(l.lotId || '') === String(i.lotId || ''));
    const qty = Number(i.qty || 0);
    const pass = old ? Number(old.passQty || 0) : qty; const fail = old ? Number(old.failQty || 0) : 0;
    const exp = lot?.expiryDate ? (typeof inventoryExpiryHtml === 'function' ? inventoryExpiryHtml(lot) : fmtDate(lot.expiryDate)) : '<span class="muted">—</span>';
    return `<tr data-idx="${idx}"><td>${cell2(esc(item?.name || i.productId), `<span class="code">${esc(i.productId)}</span>`)}</td>
      <td><span class="code">${esc(lot?.lotNumber || i.lotNumber || '—')}</span></td><td>${exp}</td>
      <td class="right num"><b>${fmtN(qty)}</b> ${esc(item?.unit || i.unit || '')}</td>
      <td><input class="inp right num oqc-pass" type="number" min="0" max="${qty}" step="any" value="${pass}" ${readonly ? 'disabled' : ''}></td>
      <td><input class="inp right num oqc-fail" type="number" min="0" max="${qty}" step="any" value="${fail}" ${readonly ? 'disabled' : ''}></td>
      <td><input class="inp oqc-reason" value="${esc(old?.reason || '')}" placeholder="Móp bao bì, sai quy cách…" ${readonly ? 'disabled' : ''}></td></tr>`;
  }).join('');
  const hist = (gi.qcHistory || []).slice().reverse().map(h => `<tr><td>${esc(String(h.at || '').replace('T', ' ').slice(0, 16))}</td><td>${esc(h.byName || '—')}</td><td>${h.status === 'PASSED' ? '<span class="badge green">Đạt</span>' : h.status === 'FAILED' ? '<span class="badge red">Không đạt</span>' : '<span class="badge orange">Yêu cầu kiểm lại</span>'}</td><td>${esc(h.note || '')}</td></tr>`).join('');
  Modal.open({
    title: `Kiểm tra chất lượng xuất kho · ${gi.id}`,
    sub: `Đơn ${esc(gi.orderId || gi.refDoc || '—')} · ${esc(o ? Q.customerName(o.customerId) : '—')} · ${esc(Q.warehouseName(gi.warehouseId))}`,
    size: 'xl',
    body: `<div class="info-grid" style="margin-bottom:14px">
        ${infoItem('Phiếu xuất', `<span class="code">${esc(gi.id)}</span>`)}${infoItem('Đơn hàng', `<span class="code">${esc(gi.orderId || gi.refDoc || '—')}</span>`)}
        ${infoItem('Trạng thái QC', outboundQcStatusHtml(gi))}${infoItem('Người kiểm', esc(readonly ? (gi.qcInspectedByName || '—') : (DB.currentUser?.name || 'QC/QA')))}
      </div>
      <div class="form-sec-title"><i class="fa-solid fa-vials"></i>Kết quả theo từng lô xuất</div>
      <div class="tbl-wrap"><table class="line-tbl"><thead><tr><th>Thành phẩm</th><th>Lô</th><th>Hạn dùng</th><th class="right">SL xuất</th><th class="right">SL đạt</th><th class="right">SL không đạt</th><th>Lý do</th></tr></thead><tbody>${lines}</tbody></table></div>
      <div class="cell-sub" style="margin-top:6px">SL đạt + SL không đạt = SL xuất; nhập một ô, ô còn lại tự tính.</div>
      <div class="field" style="margin-top:12px"><label>Ghi chú QC</label><textarea class="inp" id="oqcNote" rows="2" ${readonly ? 'disabled' : ''}>${esc(gi.qcNote || '')}</textarea></div>
      ${st === 'FAILED' ? '<div class="note-box warn" style="margin-top:12px"><b>QC không đạt.</b> Phiếu bị chặn tại Kho. Kho xử lý hàng lỗi (Kho → Hàng lỗi) rồi gửi yêu cầu QC kiểm tra lại.</div>' : ''}
      ${hist ? `<div class="form-sec-title" style="margin-top:14px">Lịch sử kiểm tra</div>${tableShell([{ t: 'Thời gian' }, { t: 'Người' }, { t: 'Kết quả' }, { t: 'Ghi chú' }], hist, { emptyTitle: '' })}` : ''}`,
    foot: `<button class="btn" data-act="modal-close">Đóng</button>${readonly ? '' : `<button class="btn btn-primary" data-act="oqc-save" data-id="${esc(gi.id)}"><i class="fa-solid fa-clipboard-check"></i>Xác nhận kết quả QC</button>`}`
  });
  setTimeout(() => document.querySelectorAll('tr[data-idx]').forEach(tr => {
    const pass = tr.querySelector('.oqc-pass'), fail = tr.querySelector('.oqc-fail');
    qcBindComplementEls(pass, fail, Number(pass?.max || 0));
  }), 0);
}

function finalInspectionStatusHtml(status) {
  if (status === 'PASSED') return '<span class="badge green">Đạt</span>';
  if (status === 'PARTIAL_FAILED') return '<span class="badge orange">Đạt một phần</span>';
  if (status === 'FAILED') return '<span class="badge red">Không đạt</span>';
  return '<span class="badge orange">Chờ kiểm</span>';
}

function finalInspectionView() {
  DB.productionFinalInspections = DB.productionFinalInspections || [];
  // [PERFORMANCE] Render FQC chỉ ĐỌC dữ liệu.
  // Không tự tạo phiếu QC/lô/tồn ở đây, vì render có thể chạy nhiều lần và
  // mỗi lần ensureFinishedQcPending() sẽ kích hoạt sync Production + Inventory,
  // gây hàng trăm request list/krud. Phiếu FQC phải được tạo tại đúng thời điểm
  // LSX chuyển sang công đoạn QC (stage-start / po-qc), không phải khi mở màn hình.
  const f = F('quality-fqc', { q:'', status:'' });
  const q = String(f.q || '').toLowerCase().trim();
  let list = (DB.productionFinalInspections || []).filter(ins => {
    if (f.status && (ins.status || 'PENDING') !== f.status) return false;
    if (q && ![ins.id,ins.productionOrderId,ins.productId,ins.productName,ins.lotNumber].some(v=>String(v||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b)=>String(b.id).localeCompare(String(a.id),'vi',{numeric:true}));
  const pg = paged(list,'quality-fqc');
  const rows = pg.items.map(ins => {
    const po = Q.po(ins.productionOrderId);
    return `<tr class="clickable" data-act="fqc-open" data-id="${esc(ins.id)}">
      <td>${cell2(`<span class="code">${esc(ins.id)}</span>`, `<span class="code">${esc(ins.productionOrderId)}</span>`)}</td>
      <td>${cell2(esc(ins.productName || Q.product(ins.productId)?.name || ins.productId), esc(ins.productId))}</td>
      <td class="right num">${fmtN(ins.qty)} ${esc(ins.unit||po?.unit||'')}</td>
      <td><span class="code">${esc(ins.lotNumber||'—')}</span><div class="cell-sub">${esc(Q.warehouseName(ins.warehouseId))}</div></td>
      <td>${finalInspectionStatusHtml(ins.status||'PENDING')}</td>
      <td class="right num">${ins.status==='PENDING'?'—':`${fmtN(ins.passQty||0)} / ${fmtN(ins.failQty||0)}`}</td>
      <td class="num">${ins.inspectedAt ? fmtDate(String(ins.inspectedAt).slice(0,10)) : '—'}</td>
      <td class="right">${rowActions([{act:'fqc-open',data:`data-id="${esc(ins.id)}"`,icon:'fa-eye',title:'Xem chi tiết / kiểm tra'}])}</td>
    </tr>`;
  });
  return `${pageHead('Kiểm tra thành phẩm', 'Kiểm tra thành phẩm từ sản xuất nội bộ. Chỉ hàng đạt mới được cập nhật vào Kho thành phẩm.', '')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Chờ kiểm',list.filter(x=>(x.status||'PENDING')==='PENDING').length,'fa-clock','orange')}
      ${mkpi('Đạt',list.filter(x=>x.status==='PASSED').length,'fa-circle-check','green')}
      ${mkpi('Đạt một phần',list.filter(x=>x.status==='PARTIAL_FAILED').length,'fa-circle-half-stroke','orange')}
      ${mkpi('Không đạt',list.filter(x=>x.status==='FAILED').length,'fa-circle-xmark','red')}
    </div>
    <div class="card"><div class="toolbar">${searchBox('quality-fqc','Tìm FQC, LSX, thành phẩm, lô…')}${selectFilter('quality-fqc','status',[['PENDING','Chờ kiểm'],['PASSED','Đạt'],['PARTIAL_FAILED','Đạt một phần'],['FAILED','Không đạt']],'Tất cả kết quả')}${(f.q||f.status)?'<button class="btn btn-sm" data-act="clear-filter" data-key="quality-fqc"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}<span class="spacer"></span><span class="chip">${fmtN(list.length)} phiếu</span></div>
    ${tableShell([{t:'Phiếu QC / LSX'},{t:'Thành phẩm'},{t:'SL chờ kiểm',cls:'right'},{t:'Lô / Kho'},{t:'Kết quả'},{t:'Đạt / Lỗi',cls:'right'},{t:'Ngày kiểm'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có thành phẩm sản xuất nội bộ chờ kiểm tra',emptyDesc:'Khi công đoạn sản xuất hoàn tất, thành phẩm sẽ tự xuất hiện tại đây.'})}${pagiHTML('quality-fqc',pg,'phiếu QC')}</div>`;
}

function openFinalInspectionModal(id) {
  const ins = (DB.productionFinalInspections || []).find(x=>x.id===id); if (!ins) return;
  const po = Q.po(ins.productionOrderId);
  const row = (DB.inventory || []).find(r=>r.lotId===ins.lotId && r.productId===ins.productId);
  const lot = Q.lot(ins.lotId);
  const readonly = (ins.status||'PENDING') !== 'PENDING' || !Auth.hasPermission('QC_INSPECT');
  const total = Number(ins.qty || row?.qtyPending || po?.qty || 0);
  Modal.open({
    title:`Kiểm tra thành phẩm · ${ins.id}`,
    sub:`${esc(ins.productionOrderId)} · ${esc(ins.productName||po?.productName||'')} · lô ${esc(ins.lotNumber||'')}`,
    size:'lg',
    body:`<div class="info-grid" style="margin-bottom:14px">
      ${infoItem('Lệnh sản xuất',`<span class="code">${esc(ins.productionOrderId)}</span>`)}
      ${infoItem('Thành phẩm',esc(ins.productName||po?.productName||ins.productId))}
      ${infoItem('Số lượng chờ QC',`<b>${fmtN(total)} ${esc(ins.unit||po?.unit||'')}</b>`)}
      ${infoItem('Kho chờ QC',`${esc(Q.warehouseName(ins.warehouseId))} · ${esc(Q.locationName(ins.locationId))}`)}
      ${infoItem('Mã lô',`<span class="code">${esc(ins.lotNumber||'—')}</span>`)}
      ${infoItem('Ngày sản xuất', lot?.mfgDate ? fmtDate(lot.mfgDate) : '—')}
      ${infoItem('Hạn sử dụng', lot?.expiryDate ? fmtDate(lot.expiryDate) : '<span class="muted">Chưa quy định</span>')}
      ${infoItem('Trạng thái',finalInspectionStatusHtml(ins.status||'PENDING'))}
      ${infoItem('Người kiểm tra', esc((ins.status||'PENDING')==='PENDING' ? (DB.currentUser?.name || Q.employeeName(DB.currentUser?.id) || 'QC/QA') : (ins.inspectedByName || Q.employeeName(ins.inspectedBy) || 'QC/QA')))}
      ${infoItem('Thời gian kiểm', ins.inspectedAt ? new Date(ins.inspectedAt).toLocaleString('vi-VN') : '<span class="muted">Sẽ ghi khi xác nhận</span>')}
    </div>
    <div class="note-box" style="margin-bottom:14px"><b>Nguyên tắc tồn kho:</b> ${fmtN(total)} ${esc(ins.unit||po?.unit||'')} hiện chỉ là <b>tồn chờ QC</b>, chưa được tính vào tồn khả dụng. Khi QC xác nhận, chỉ số lượng đạt mới được cộng vào tồn kho thành phẩm.</div>
    <div class="form-grid cols-2">
      <div class="field"><label>Số lượng đạt *</label><input class="inp right num" id="fqcPass" type="number" min="0" max="${total}" step="0.01" value="${readonly?Number(ins.passQty||0):total}" ${readonly?'disabled':''}></div>
      <div class="field"><label>Số lượng không đạt *</label><input class="inp right num" id="fqcFail" type="number" min="0" max="${total}" step="0.01" value="${Number(ins.failQty||0)}" ${readonly?'disabled':''}></div>
      <div class="field" style="grid-column:1/-1"><label>Ghi chú QC</label><textarea class="inp" id="fqcNote" rows="3" ${readonly?'disabled':''}>${esc(ins.note||'')}</textarea></div>
    </div>
    ${readonly?`<div class="alert-item"><i class="fa-solid fa-lock"></i><div><b>Kết quả đã được xác nhận</b><div class="muted">Đạt ${fmtN(ins.passQty||0)} · không đạt ${fmtN(ins.failQty||0)} ${esc(ins.unit||'')}. Kết quả đã khóa để bảo toàn lịch sử tồn kho.</div></div></div>`:''}`,
    foot:`<button class="btn" data-act="modal-close">Đóng</button>${readonly?'':`<button class="btn btn-primary" data-act="fqc-save" data-id="${esc(ins.id)}"><i class="fa-solid fa-clipboard-check"></i>Xác nhận QC & cập nhật tồn</button>`}`
  });
  qcBindComplement('#fqcPass', '#fqcFail', total);
}


/* ==========================================================================\n * QC GIA CÔNG - nhận hàng hoàn thành từ đối tác, độc lập với FQC nội bộ.\n * Sau QC, hàng đạt/lỗi chỉ chuyển sang bước Kho nhập; QC không tự cộng tồn.\n * ======================================================================= */
function subcontractingInspectionView() {
  const orders = typeof subcontractV3Orders === 'function' ? subcontractV3Orders() : (DB.subcontractingOrders || []);
  const f = F('quality-subcontracting', { q:'', status:'' });
  const q = String(f.q || '').toLowerCase().trim();
  let data = [];
  orders.forEach(o => {
    const receipts = typeof subcontractV3Receipts === 'function' ? subcontractV3Receipts(o) : (o.receipts || []);
    receipts.forEach(r => data.push({ o, r }));
  });
  data = data.filter(({o,r}) => {
    const status = r.qcStatus === 'DONE' ? 'DONE' : 'PENDING';
    if (f.status && status !== f.status) return false;
    if (q && ![o.id,o.partner,o.productId,Q.product(o.productId)?.name,r.id,r.date].some(v=>String(v||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b)=>String(b.r.id||'').localeCompare(String(a.r.id||''),'vi',{numeric:true}));
  const pg = paged(data,'quality-subcontracting');
  const rows = pg.items.map(({o,r}) => `<tr class="clickable" data-act="subcontracting-qc" data-id="${esc(o.id)}" data-receipt="${esc(r.id)}">
      <td>${cell2(`<span class="code">${esc(r.id)}</span>`,`<span class="code">${esc(o.id)}</span>`)}</td>
      <td>${cell2(esc(Q.product(o.productId)?.name||o.productId),esc(o.partner||'—'))}</td>
      <td class="right num">${fmtDec(r.qty,2)} ${esc(Q.product(o.productId)?.unit||'')}</td>
      <td>${r.qcStatus==='DONE' ? '<span class="badge green">Đã kiểm</span>' : '<span class="badge orange">Chờ kiểm</span>'}</td>
      <td class="right num">${r.qcStatus==='DONE'?fmtDec(r.goodQty,2):'—'}</td>
      <td class="right num">${r.qcStatus==='DONE'?fmtDec(r.defectQty,2):'—'}</td>
      <td>${r.warehoused?`<span class="badge green">Đã nhập kho</span>`:(r.qcStatus==='DONE'?'<span class="badge blue">Chờ Kho nhập</span>':'—')}</td>
      <td class="num">${fmtDate(r.date)}</td>
    </tr>`).join('');
  return `${pageHead('Kiểm tra gia công','Kiểm tra chất lượng hàng đối tác gia công giao về. QC chỉ xác nhận đạt/lỗi; việc nhập kho do phân hệ Kho thực hiện.', '')}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Chờ kiểm',data.filter(x=>x.r.qcStatus!=='DONE').length,'fa-clock','orange')}
      ${mkpi('Đã kiểm',data.filter(x=>x.r.qcStatus==='DONE').length,'fa-circle-check','green')}
      ${mkpi('Chờ Kho nhập',data.filter(x=>x.r.qcStatus==='DONE'&&!x.r.warehoused).length,'fa-warehouse','blue')}
      ${mkpi('Tổng lỗi',fmtN(data.reduce((n,x)=>n+Number(x.r.defectQty||0),0)),'fa-triangle-exclamation','red')}
    </div>
    <div class="card"><div class="toolbar">${searchBox('quality-subcontracting','Tìm phiếu nhận, kế hoạch, đối tác, thành phẩm…')}${selectFilter('quality-subcontracting','status',[['PENDING','Chờ kiểm'],['DONE','Đã kiểm']],'Tất cả trạng thái')}${(f.q||f.status)?'<button class="btn btn-sm" data-act="clear-filter" data-key="quality-subcontracting"><i class="fa-solid fa-filter-circle-xmark"></i>Xóa lọc</button>':''}<span class="spacer"></span><span class="chip">${fmtN(data.length)} đợt nhận</span></div>
      ${tableShell([{t:'Phiếu nhận / KHGC'},{t:'Thành phẩm / Đối tác'},{t:'SL nhận',cls:'right'},{t:'QC'},{t:'Đạt',cls:'right'},{t:'Lỗi',cls:'right'},{t:'Kho'},{t:'Ngày nhận'}],rows,{emptyTitle:'Chưa có hàng gia công cần kiểm tra',emptyDesc:'Khi đối tác hoàn thành và ghi nhận nhận hàng, dữ liệu sẽ xuất hiện tại đây.'})}
      ${pagiHTML('quality-subcontracting',pg,'đợt nhận')}
    </div>`;
}


/* ==========================================================================
 * QC/QA - Hồ sơ kiểm nghiệm, CAPA, Thu hồi sản phẩm
 * Dữ liệu nghiệp vụ riêng; tham chiếu master lô/sản phẩm đã có, không nhân đôi.
 * ======================================================================= */
let __qualityOpsHydrated=false;
function qualityOpsHydrate(){
  if(__qualityOpsHydrated)return;
  __qualityOpsHydrated=true;
  DB.qualityCoa=Array.isArray(DB.qualityCoa)?DB.qualityCoa:[];
  DB.qualityCapa=Array.isArray(DB.qualityCapa)?DB.qualityCapa:[];
  DB.qualityRecalls=Array.isArray(DB.qualityRecalls)?DB.qualityRecalls:[];
}
function qualityOpsPersist(keys){
  if(typeof RestaurantQualityAPI==='undefined') return Promise.resolve(false);
  return RestaurantQualityAPI.syncQuality(keys).catch(err=>{
    console.error('[QualityAPI] Không đồng bộ được dữ liệu server:',err);
    if(typeof Toast!=='undefined') Toast.err('Không lưu được lên server',err?.message||'Kiểm tra bảng lenam_quality_* trên KIO.');
    throw err;
  });
}
function qualityLotLabel(lotId){const l=(DB.inventoryLots||[]).find(x=>x.id===lotId);const p=Q.product(l?.productId)||Q.material(l?.productId);return l?`${l.lotNumber||l.id} · ${p?.name||l.productId}`:lotId||'—';}
function qualityCoaView(){qualityOpsHydrate();const rows=(DB.qualityCoa||[]).map(x=>`<tr><td><span class="code">${esc(x.id)}</span></td><td>${cell2(esc(qualityLotLabel(x.lotId)),esc(x.productId||''))}</td><td>${fmtDate(x.testDate)}</td><td>${esc(x.inspector||'—')}</td><td>${x.result==='PASSED'?'<span class="badge green">Đạt</span>':x.result==='FAILED'?'<span class="badge red">Không đạt</span>':'<span class="badge orange">Chờ kết quả</span>'}</td><td>${rowActions([{act:'quality-coa-view',data:`data-id="${esc(x.id)}"`,icon:'fa-eye',title:'Xem hồ sơ'},{act:'quality-coa-edit',data:`data-id="${esc(x.id)}"`,icon:'fa-pen',title:'Cập nhật'}])}</td></tr>`).join('');return `${pageHead('Hồ sơ kiểm nghiệm','Quản lý kết quả kiểm nghiệm theo đúng lô/sản phẩm đã tồn tại trong hệ thống.',`<button class="btn btn-primary" data-act="quality-coa-new"><i class="fa-solid fa-plus"></i>Lập hồ sơ</button>`)}<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Tổng hồ sơ',(DB.qualityCoa||[]).length,'fa-flask-vial','blue')}${mkpi('Đạt',(DB.qualityCoa||[]).filter(x=>x.result==='PASSED').length,'fa-circle-check','green')}${mkpi('Không đạt',(DB.qualityCoa||[]).filter(x=>x.result==='FAILED').length,'fa-circle-xmark','red')}</div><div class="card">${tableShell([{t:'Mã hồ sơ'},{t:'Lô / Sản phẩm'},{t:'Ngày kiểm'},{t:'Người kiểm'},{t:'Kết quả'},{t:'Thao tác'}],rows,{emptyTitle:'Chưa có hồ sơ kiểm nghiệm'})}</div>`;}
function openQualityCoaForm(id=''){qualityOpsHydrate();const x=(DB.qualityCoa||[]).find(v=>v.id===id)||{};const lots=(DB.inventoryLots||[]);Modal.open({title:id?`Cập nhật hồ sơ · ${id}`:'Lập hồ sơ kiểm nghiệm',size:'lg',body:`<input type="hidden" id="qualityCoaId" value="${esc(id)}"><div class="form-grid cols-2"><div class="field"><label>Lô kiểm nghiệm *</label><select class="inp" id="qualityCoaLot">${lots.map(l=>`<option value="${esc(l.id)}" ${x.lotId===l.id?'selected':''}>${esc(qualityLotLabel(l.id))}</option>`).join('')}</select></div><div class="field"><label>Ngày kiểm *</label><input class="inp" id="qualityCoaDate" type="date" value="${esc(x.testDate||restaurantToday())}"></div><div class="field"><label>Người kiểm</label><input class="inp" id="qualityCoaInspector" value="${esc(x.inspector||DB.currentUser?.name||'QC/QA')}"></div><div class="field"><label>Kết quả</label><select class="inp" id="qualityCoaResult"><option value="PENDING" ${x.result==='PENDING'?'selected':''}>Chờ kết quả</option><option value="PASSED" ${x.result==='PASSED'?'selected':''}>Đạt</option><option value="FAILED" ${x.result==='FAILED'?'selected':''}>Không đạt</option></select></div></div><div class="field"><label>Nội dung / chỉ tiêu kiểm nghiệm</label><textarea class="inp" id="qualityCoaTests" rows="4" placeholder="Ví dụ: Cảm quan: Đạt; Khối lượng: Đạt; Vi sinh: Đạt">${esc((x.tests||[]).map(t=>`${t.name}: ${t.result}`).join('; '))}</textarea></div><div class="field"><label>Ghi chú</label><textarea class="inp" id="qualityCoaNote" rows="3">${esc(x.note||'')}</textarea></div>`,foot:'<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="quality-coa-save"><i class="fa-solid fa-floppy-disk"></i>Lưu hồ sơ</button>'});}
function qualityCapaView(){qualityOpsHydrate();const rows=(DB.qualityCapa||[]).map(x=>`<tr><td><span class="code">${esc(x.id)}</span></td><td>${cell2(esc(x.issue),esc(x.source||''))}</td><td>${esc(x.owner||'—')}</td><td>${fmtDate(x.dueDate)}</td><td>${x.status==='CLOSED'?'<span class="badge green">Đã đóng</span>':x.status==='IN_PROGRESS'?'<span class="badge blue">Đang xử lý</span>':'<span class="badge orange">Mở</span>'}</td><td>${rowActions([{act:'quality-capa-view',data:`data-id="${esc(x.id)}"`,icon:'fa-eye',title:'Xem CAPA'},{act:'quality-capa-edit',data:`data-id="${esc(x.id)}"`,icon:'fa-pen',title:'Cập nhật'}])}</td></tr>`).join('');return `${pageHead('CAPA','Theo dõi hành động khắc phục và phòng ngừa từ sai lệch, lỗi QC hoặc khiếu nại.',`<button class="btn btn-primary" data-act="quality-capa-new"><i class="fa-solid fa-plus"></i>Tạo CAPA</button>`)}<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('CAPA đang mở',(DB.qualityCapa||[]).filter(x=>x.status!=='CLOSED').length,'fa-screwdriver-wrench','orange')}${mkpi('Đang xử lý',(DB.qualityCapa||[]).filter(x=>x.status==='IN_PROGRESS').length,'fa-spinner','blue')}${mkpi('Đã đóng',(DB.qualityCapa||[]).filter(x=>x.status==='CLOSED').length,'fa-circle-check','green')}</div><div class="card">${tableShell([{t:'Mã CAPA'},{t:'Vấn đề / Nguồn'},{t:'Phụ trách'},{t:'Hạn xử lý'},{t:'Trạng thái'},{t:'Thao tác'}],rows,{emptyTitle:'Chưa có CAPA'})}</div>`;}
function openQualityCapaForm(id=''){qualityOpsHydrate();const x=(DB.qualityCapa||[]).find(v=>v.id===id)||{};Modal.open({title:id?`Cập nhật CAPA · ${id}`:'Tạo CAPA',size:'lg',body:`<input type="hidden" id="qualityCapaId" value="${esc(id)}"><div class="form-grid cols-2"><div class="field"><label>Nguồn phát hiện</label><select class="inp" id="qualityCapaSource"><option>Kiểm tra chất lượng</option><option>Khiếu nại khách hàng</option><option>Kiểm kê / thất thoát</option><option>Thu hồi sản phẩm</option></select></div><div class="field"><label>Phụ trách *</label><input class="inp" id="qualityCapaOwner" value="${esc(x.owner||'QC/QA')}"></div><div class="field"><label>Hạn xử lý</label><input class="inp" type="date" id="qualityCapaDue" value="${esc(x.dueDate||restaurantToday())}"></div><div class="field"><label>Trạng thái</label><select class="inp" id="qualityCapaStatus"><option value="OPEN" ${x.status==='OPEN'?'selected':''}>Mở</option><option value="IN_PROGRESS" ${x.status==='IN_PROGRESS'?'selected':''}>Đang xử lý</option><option value="CLOSED" ${x.status==='CLOSED'?'selected':''}>Đã đóng</option></select></div></div><div class="field"><label>Vấn đề / sai lệch *</label><textarea class="inp" id="qualityCapaIssue" rows="2">${esc(x.issue||'')}</textarea></div><div class="field"><label>Nguyên nhân gốc</label><textarea class="inp" id="qualityCapaRoot" rows="2">${esc(x.rootCause||'')}</textarea></div><div class="field"><label>Hành động khắc phục</label><textarea class="inp" id="qualityCapaCorrection" rows="2">${esc(x.correction||'')}</textarea></div><div class="field"><label>Hành động phòng ngừa</label><textarea class="inp" id="qualityCapaPreventive" rows="2">${esc(x.preventive||'')}</textarea></div>`,foot:'<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="quality-capa-save"><i class="fa-solid fa-floppy-disk"></i>Lưu CAPA</button>'});}
function qualityRecallView(){qualityOpsHydrate();const rows=(DB.qualityRecalls||[]).map(x=>`<tr><td><span class="code">${esc(x.id)}</span></td><td>${cell2(esc(qualityLotLabel(x.lotId)),esc(x.reason||''))}</td><td>${fmtDate(x.date)}</td><td class="right num">${fmtDec(x.qty||0,2)}</td><td>${x.status==='CLOSED'?'<span class="badge green">Đã hoàn tất</span>':x.status==='IN_PROGRESS'?'<span class="badge red">Đang thu hồi</span>':'<span class="badge orange">Khởi tạo</span>'}</td><td>${rowActions([{act:'quality-recall-view',data:`data-id="${esc(x.id)}"`,icon:'fa-eye',title:'Xem thu hồi'},{act:'quality-recall-edit',data:`data-id="${esc(x.id)}"`,icon:'fa-pen',title:'Cập nhật'}])}</td></tr>`).join('');return `${pageHead('Thu hồi sản phẩm','Quản lý thu hồi theo lô để đảm bảo truy xuất và kiểm soát sản phẩm không phù hợp.',`<button class="btn btn-primary" data-act="quality-recall-new"><i class="fa-solid fa-plus"></i>Tạo đợt thu hồi</button>`)}<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Đợt thu hồi',(DB.qualityRecalls||[]).length,'fa-rotate-left','blue')}${mkpi('Đang thu hồi',(DB.qualityRecalls||[]).filter(x=>x.status==='IN_PROGRESS').length,'fa-triangle-exclamation','red')}${mkpi('Đã hoàn tất',(DB.qualityRecalls||[]).filter(x=>x.status==='CLOSED').length,'fa-circle-check','green')}</div><div class="card">${tableShell([{t:'Mã thu hồi'},{t:'Lô / Lý do'},{t:'Ngày'},{t:'SL mục tiêu',cls:'right'},{t:'Trạng thái'},{t:'Thao tác'}],rows,{emptyTitle:'Chưa có đợt thu hồi'})}</div>`;}
function openQualityRecallForm(id=''){qualityOpsHydrate();const x=(DB.qualityRecalls||[]).find(v=>v.id===id)||{};const lots=(DB.inventoryLots||[]).filter(l=>Q.product(l.productId));Modal.open({title:id?`Cập nhật thu hồi · ${id}`:'Tạo đợt thu hồi sản phẩm',size:'lg',body:`<input type="hidden" id="qualityRecallId" value="${esc(id)}"><div class="form-grid cols-2"><div class="field"><label>Lô thành phẩm *</label><select class="inp" id="qualityRecallLot">${lots.map(l=>`<option value="${esc(l.id)}" ${x.lotId===l.id?'selected':''}>${esc(qualityLotLabel(l.id))}</option>`).join('')}</select></div><div class="field"><label>Ngày khởi tạo</label><input class="inp" type="date" id="qualityRecallDate" value="${esc(x.date||restaurantToday())}"></div><div class="field"><label>Số lượng mục tiêu</label><input class="inp right num" type="number" min="0" step="0.01" id="qualityRecallQty" value="${Number(x.qty||0)}"></div><div class="field"><label>Trạng thái</label><select class="inp" id="qualityRecallStatus"><option value="OPEN" ${x.status==='OPEN'?'selected':''}>Khởi tạo</option><option value="IN_PROGRESS" ${x.status==='IN_PROGRESS'?'selected':''}>Đang thu hồi</option><option value="CLOSED" ${x.status==='CLOSED'?'selected':''}>Đã hoàn tất</option></select></div></div><div class="field"><label>Lý do thu hồi *</label><textarea class="inp" id="qualityRecallReason" rows="3">${esc(x.reason||'')}</textarea></div><div class="field"><label>Phạm vi / hướng xử lý</label><textarea class="inp" id="qualityRecallAction" rows="3">${esc(x.action||'')}</textarea></div>`,foot:'<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="quality-recall-save"><i class="fa-solid fa-floppy-disk"></i>Lưu đợt thu hồi</button>'});}

/* Đăng ký Views cho các phân hệ doanh nghiệp tiêu chuẩn */
['accounting', 'quality', 'maintenance', 'logistics', 'rnd', 'approvals', 'bi'].forEach(key => {
  Views[key] = function (params = {}) {
    const tab = State.tab || (params && params.tab) || 'dashboard';
    if (key === 'quality' && tab === 'dashboard') return qualityDashboardView();
    if (key === 'quality' && tab === 'iqc') return incomingInspectionView();
    if (key === 'quality' && tab === 'pqc') return processInspectionView();
    if (key === 'quality' && tab === 'fqc') return finalInspectionView();
    if (key === 'quality' && tab === 'oqc') return outboundInspectionView();
    if (key === 'quality' && tab === 'subcontracting_qc') return subcontractingInspectionView();
    if (key === 'quality' && tab === 'coa') return qualityCoaView();
    if (key === 'quality' && tab === 'capa') return qualityCapaView();
    if (key === 'quality' && tab === 'recall') return qualityRecallView();
    if (!tab || tab === 'dashboard') {
      if (ENTERPRISE_MODULES[key]) return enterpriseView(key);
      if (key === 'bi' && typeof Views.reports === 'function') return Views.reports(params);
    }
    return '';
  };
});
function openSupplierForm(id = '') {
  const supplier = id ? DB.suppliers.find((x) => x.id === id) : null;
  // [DATA CONSISTENCY] Nhóm cung ứng dùng đúng master Danh mục nguyên liệu.
  // Nếu dữ liệu cũ từng có 2 record cùng tên (Bao bì/Phụ gia), dropdown chỉ
  // hiện một lựa chọn. InventoryAPI đồng thời dọn record trùng trên KIO server.
  const seenGroups = new Set();
  const rawMaterialCategories = (DB.itemCategories || [])
    .filter((c) => c.type === 'RAW_MATERIAL' && c.status !== 'inactive' && c.name)
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''), 'vi', { numeric: true }))
    .filter((c) => {
      const key = String(c.name).trim().toLocaleLowerCase('vi');
      if (seenGroups.has(key)) return false;
      seenGroups.add(key);
      return true;
    });

  const groupOptions = rawMaterialCategories
    .map((c) => `<option value="${esc(c.name)}" ${supplier?.group === c.name ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');
  Modal.open({
    title: supplier ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp',
    sub: supplier ? `${supplier.id} · Cập nhật hồ sơ nhà cung cấp` : 'Tạo hồ sơ nhà cung cấp mới · ban đầu chưa đánh giá',
    size: 'md',
    body: `<div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Tên nhà cung cấp <span class="req">*</span></label><input class="inp" id="supName" value="${esc(supplier?.name || '')}" placeholder="Tên công ty / hộ kinh doanh / đối tác"></div>
      <div class="field"><label>Nhóm cung ứng <span class="req">*</span></label><select class="inp" id="supGroup"><option value="">-- Chọn nhóm cung ứng --</option>${groupOptions}</select><div class="cell-sub" style="margin-top:5px">Danh sách lấy trực tiếp từ danh mục nguyên liệu hiện hành.</div></div>
      <div class="field"><label>Người liên hệ</label><input class="inp" id="supContact" value="${esc(supplier?.contact || '')}" placeholder="Họ và tên"></div>
      <div class="field"><label>Số điện thoại</label><input class="inp" id="supPhone" value="${esc(supplier?.phone || '')}" placeholder="Số điện thoại"></div>
      <div class="field"><label>Email</label><input class="inp" id="supEmail" type="email" value="${esc(supplier?.email || '')}" placeholder="email@congty.vn"></div>
      <div class="field"><label>Mã số thuế</label><input class="inp" id="supTaxCode" value="${esc(supplier?.taxCode || '')}" placeholder="Mã số thuế"></div>
      <div class="field"><label>Tài khoản ngân hàng</label><input class="inp" id="supBankAccount" value="${esc(supplier?.bankAccount || '')}" placeholder="Số tài khoản"></div>
      <div class="field"><label>Ngân hàng</label><input class="inp" id="supBankName" value="${esc(supplier?.bankName || '')}" placeholder="Tên ngân hàng"></div>
      <div class="field" style="grid-column:1/-1"><label>Địa chỉ</label><input class="inp" id="supAddress" value="${esc(supplier?.address || '')}" placeholder="Địa chỉ nhà cung cấp"></div>
      <div class="field"><label>Điều khoản thanh toán</label><input class="inp" id="supPayment" value="${esc(supplier?.paymentTerm || '')}" placeholder="Ví dụ: 30 ngày sau giao hàng"></div>
      <div class="field"><label>Đánh giá</label><input class="inp" value="${supplier && Number(supplier.rating) ? Number(supplier.rating).toFixed(1) + ' / 5' : 'Chưa đánh giá'}" disabled></div>
    </div>`,
    foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="supplier-save" data-id="${esc(supplier?.id || '')}"><i class="fa-solid fa-floppy-disk"></i>${supplier ? 'Lưu thay đổi' : 'Lưu nhà cung cấp'}</button>`
  });
}

/* ==========================================================================\n * GIA CÔNG - quy trình hoàn chỉnh\n * Luồng: Nháp -> Duyệt -> Xuất NVL -> Đối tác thực hiện -> Nhận hàng & QC\n *       -> Hàng đạt vào kho thành phẩm, hàng lỗi vào kho lỗi -> Công nợ.\n * Dữ liệu lưu local để không phát sinh thêm request KIO ngoài các biến động kho.\n * ======================================================================= */
let __subcontractHydrated = false;
function subcontractToday(){ return typeof currentDateYMD==='function' ? currentDateYMD() : new Date().toISOString().slice(0,10); }
function subcontractHydrate(){
  if(__subcontractHydrated) return; __subcontractHydrated=true;
  try{
    const raw=localStorage.getItem('lenam_subcontracting_v2');
    if(raw){
      const saved=JSON.parse(raw);
      if(Array.isArray(saved.orders)) DB.subcontractingOrders=saved.orders;
      if(Array.isArray(saved.partners)) DB.subcontractingPartners=saved.partners;
    }
  }catch(err){console.warn('[Subcontracting] Không đọc được cache local:',err);}
  if(!Array.isArray(DB.subcontractingPartners) || !DB.subcontractingPartners.length){
    const names=[...new Set((DB.subcontractingOrders||[]).map(x=>x.partner).filter(Boolean))];
    DB.subcontractingPartners=names.map((name,i)=>({id:`DTC-${String(i+1).padStart(3,'0')}`,name,phone:'',contact:'',address:'',status:'active',note:''}));
  }
}
function subcontractPersist(){
  try{ localStorage.setItem('lenam_subcontracting_v2',JSON.stringify({orders:DB.subcontractingOrders||[],partners:DB.subcontractingPartners||[]})); }
  catch(err){console.warn('[Subcontracting] Không lưu được cache local:',err);}
}
function subcontractPartner(idOrName){ subcontractHydrate(); return (DB.subcontractingPartners||[]).find(x=>x.id===idOrName||x.name===idOrName); }
function subcontractProduct(o){ return Q.product(o?.productId); }
function subcontractStatusHtml(status){
  const m={DRAFT:['Nháp','slate'],APPROVED:['Đã duyệt','blue'],IN_PROGRESS:['Đang gia công','orange'],PARTIAL_RECEIVED:['Nhận một phần','indigo'],COMPLETED:['Hoàn thành','green'],CANCELLED:['Đã hủy','red']};
  const x=m[status]||[status||'—','slate']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`;
}
function subcontractOrderAmount(o){
  const billQty=Number(o.receivedQty||0)>0 ? Number(o.goodQty||0) : Number(o.plannedQty||0);
  return Math.max(0,billQty*Number(o.unitCost||0));
}
function subcontractDebt(o){ return Math.max(0,subcontractOrderAmount(o)-Number(o.paid||0)); }
function subcontractBomLines(order){
  const p=subcontractProduct(order); const qty=Number(order?.plannedQty||0);
  return (p?.bom||[]).map(row=>{
    if(Array.isArray(row)){ const [materialId,per]=row; return {materialId,per:Number(per||0),qty:Number(per||0)*qty}; }
    const materialId=row.materialId||row.id||row.productId; const per=Number(row.qtyPerUnit??row.quantity??row.qty??0); const loss=Number(row.lossPct||row.wastePct||0);
    const base=per*qty; const need=loss>0&&loss<100 ? base/(1-loss/100) : base;
    return {materialId,per,lossPct:loss,qty:need};
  }).filter(x=>x.materialId&&x.qty>0);
}
function subcontractAvailable(materialId){
  return (DB.inventory||[]).filter(r=>r.productId===materialId && Number(r.qtyAvailable||0)>0 && Q.warehouse(r.warehouseId)?.type==='RAW_MATERIAL').reduce((s,r)=>s+Number(r.qtyAvailable||0),0);
}
function subcontractSyncInventory(){
  if(typeof InventoryAPI!=='undefined' && InventoryAPI.scheduleCollections) InventoryAPI.scheduleCollections(['inventory','inventoryLots','inventoryTransactions','goodsIssues','goodsReceipts'],220);
}
function subcontractNextLot(order,suffix=''){ return `LOT-${order.id.replace('GC-','GC')}${suffix}`; }

function openSubcontractingForm(id=''){
  subcontractHydrate(); const o=id?(DB.subcontractingOrders||[]).find(x=>x.id===id):null;
  if(o && o.status!=='DRAFT'){ Toast.warn('Không thể sửa đơn gia công','Chỉ đơn ở trạng thái Nháp mới được sửa.'); return; }
  const today=subcontractToday();
  Modal.open({
    title:o?`Sửa đơn gia công · ${o.id}`:'Tạo đơn gia công',
    sub:'Chọn đối tác, thành phẩm cần gia công, số lượng và hạn nhận hàng',size:'lg',
    body:`<div class="form-grid cols-2">
      <div class="field"><label>Đối tác gia công *</label><select class="inp" id="subPartner"><option value="">-- Chọn đối tác --</option>${(DB.subcontractingPartners||[]).filter(p=>p.status!=='inactive').map(p=>`<option value="${esc(p.id)}" ${(o?.partnerId===p.id||o?.partner===p.name)?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Thành phẩm *</label><select class="inp" id="subProduct">${(DB.products||[]).slice().sort((a,b)=>String(a.id||'').localeCompare(String(b.id||''),'vi',{numeric:true})).map(p=>`<option value="${esc(p.id)}" ${o?.productId===p.id?'selected':''}>${esc(p.id)} — ${esc(p.name)} (${esc(p.unit||'')})</option>`).join('')}</select></div>
      <div class="field"><label>Số lượng kế hoạch *</label><input class="inp right num" id="subQty" type="number" min="0.01" step="0.01" value="${Number(o?.plannedQty||100)}"></div>
      <div class="field"><label>Đơn giá gia công</label><input class="inp right num" id="subCost" data-money="1" type="text" inputmode="numeric" min="0" step="100" value="${Number(o?.unitCost||1500)}"></div>
      <div class="field"><label>Ngày giao NVL dự kiến</label><input class="inp" id="subIssueDate" type="date" min="${today}" value="${o?.issueDate&&o.issueDate>=today?o.issueDate:today}"></div>
      <div class="field"><label>Ngày cần nhận hàng *</label><input class="inp" id="subDueDate" type="date" min="${today}" value="${o?.dueDate&&o.dueDate>=today?o.dueDate:addDays(today,7)}"></div>
      <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea class="inp" id="subNote" rows="3" placeholder="Yêu cầu đóng gói, quy cách, điều kiện giao nhận…">${esc(o?.note||'')}</textarea></div>
    </div>`,
    foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-save" data-id="${esc(o?.id||'')}"><i class="fa-solid fa-floppy-disk"></i>${o?'Lưu thay đổi':'Tạo đơn gia công'}</button>`
  });
}
function subcontractingSaveOrder(id=''){
  subcontractHydrate(); const partner=subcontractPartner($('#subPartner')?.value); const product=Q.product($('#subProduct')?.value); const qty=Number($('#subQty')?.value||0); const cost=parseMoney($('#subCost')?.value||0); const today=subcontractToday(); const issueDate=$('#subIssueDate')?.value||today; const dueDate=$('#subDueDate')?.value||addDays(today,7);
  if(!partner||!product||qty<=0){Toast.err('Thiếu thông tin','Vui lòng chọn đối tác, thành phẩm và nhập số lượng lớn hơn 0.');return;}
  if(issueDate<today||dueDate<today||dueDate<issueDate){Toast.err('Ngày không hợp lệ','Ngày giao NVL và ngày cần nhận phải từ ngày hiện tại; ngày nhận không được trước ngày giao NVL.');return;}
  const payload={partnerId:partner.id,partner:partner.name,productId:product.id,plannedQty:qty,unit:product.unit,issueDate,dueDate,unitCost:cost,note:$('#subNote')?.value?.trim()||''};
  if(id){const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o||o.status!=='DRAFT')return;Object.assign(o,payload, {updatedAt:new Date().toISOString()});}
  else{const code=nextCode('GC-2026-',DB.subcontractingOrders||[]);(DB.subcontractingOrders||(DB.subcontractingOrders=[])).unshift({id:code,...payload,issuedQty:0,receivedQty:0,goodQty:0,defectQty:0,status:'DRAFT',paid:0,partnerProgress:0,createdAt:new Date().toISOString(),createdBy:DB.currentUser?.id||''});}
  subcontractPersist(); Modal.close(); go('subcontracting',{tab:'orders'}); Toast.ok(id?'Đã cập nhật đơn gia công':'Đã tạo đơn gia công',id||DB.subcontractingOrders[0].id);
}
function subcontractingDeleteOrder(id){const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o||o.status!=='DRAFT'){Toast.warn('Không thể xóa','Chỉ đơn gia công Nháp mới được xóa.');return;}confirmBox({title:'Xóa đơn gia công',message:`Xóa <b>${esc(id)}</b>?`,okText:'Xóa',onOk:()=>{DB.subcontractingOrders=DB.subcontractingOrders.filter(x=>x.id!==id);subcontractPersist();render();Toast.ok('Đã xóa đơn gia công',id);}});}
function subcontractingApproveOrder(id){const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o||o.status!=='DRAFT')return;o.status='APPROVED';o.approvedAt=new Date().toISOString();o.approvedBy=DB.currentUser?.id||'';subcontractPersist();render();Toast.ok('Đã duyệt đơn gia công',`${id} · có thể xuất NVL cho đối tác.`);}

function openSubcontractingDetail(id){
  subcontractHydrate(); const o=(DB.subcontractingOrders||[]).find(x=>x.id===id); if(!o)return; const p=subcontractProduct(o); const bom=subcontractBomLines(o); const amount=subcontractOrderAmount(o); const debt=subcontractDebt(o);
  const mats=bom.map(x=>`<tr><td><span class="code">${esc(x.materialId)}</span></td><td>${esc(Q.material(x.materialId)?.name||x.materialId)}</td><td class="right num">${fmtDec(x.qty,3)} ${esc(Q.material(x.materialId)?.unit||'')}</td><td class="right num">${fmtDec(subcontractAvailable(x.materialId),3)}</td></tr>`).join('');
  Modal.open({title:`Đơn gia công · ${o.id}`,sub:`${esc(o.partner)} · ${esc(p?.name||o.productId)}`,size:'xl',body:`
    <div class="info-grid" style="margin-bottom:14px">${infoItem('Trạng thái',subcontractStatusHtml(o.status))}${infoItem('Đối tác',esc(o.partner))}${infoItem('Thành phẩm',`${esc(p?.name||o.productId)} · ${fmtDec(o.plannedQty,2)} ${esc(p?.unit||o.unit||'')}`)}${infoItem('Ngày giao NVL',fmtDate(o.actualIssueDate||o.issueDate))}${infoItem('Hạn nhận',fmtDate(o.dueDate))}${infoItem('Đã nhận',`${fmtDec(o.receivedQty,2)} / ${fmtDec(o.plannedQty,2)} ${esc(p?.unit||'')}`)}${infoItem('QC đạt / lỗi',`${fmtDec(o.goodQty,2)} / ${fmtDec(o.defectQty,2)}`)}${infoItem('Giá trị được tính',fmtVND(amount))}${infoItem('Công nợ',fmtVND(debt))}</div>
    <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>Nguyên liệu theo BOM</div>
    ${tableShell([{t:'Mã NVL'},{t:'Nguyên liệu'},{t:'Cần giao',cls:'right'},{t:'Tồn khả dụng',cls:'right'}],mats,{emptyTitle:'Thành phẩm chưa có BOM'})}
    <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-clock-rotate-left"></i>Lịch sử xử lý</div>
    <div class="info-grid">${infoItem('Duyệt',o.approvedAt?`${fmtDate(String(o.approvedAt).slice(0,10))} · ${esc(Q.employeeName(o.approvedBy)||o.approvedBy||'')}`:'—')}${infoItem('Xuất NVL',o.actualIssueDate?`${fmtDate(o.actualIssueDate)} · ${esc(o.issueId||'')}`:'—')}${infoItem('Cập nhật tiến độ',o.progressUpdatedAt?`${fmtDate(String(o.progressUpdatedAt).slice(0,10))} · ${Number(o.partnerProgress||0)}%`:'—')}${infoItem('Nhận/QC gần nhất',o.lastReceivedAt?fmtDate(String(o.lastReceivedAt).slice(0,10)):'—')}</div>
    ${o.note?`<div class="note-box" style="margin-top:14px"><b>Ghi chú:</b> ${esc(o.note)}</div>`:''}`,
    foot:`<button class="btn" data-act="modal-close">Đóng</button>${o.status==='DRAFT'?`<button class="btn" data-act="subcontracting-edit" data-id="${esc(o.id)}"><i class="fa-solid fa-pen"></i>Sửa</button><button class="btn btn-primary" data-act="subcontracting-approve" data-id="${esc(o.id)}"><i class="fa-solid fa-check"></i>Duyệt</button>`:''}${o.status==='APPROVED'?`<button class="btn btn-primary" data-act="subcontracting-issue" data-id="${esc(o.id)}"><i class="fa-solid fa-arrow-right-from-bracket"></i>Xuất NVL</button>`:''}${['IN_PROGRESS','PARTIAL_RECEIVED'].includes(o.status)?`<button class="btn" data-act="subcontracting-progress-update" data-id="${esc(o.id)}"><i class="fa-solid fa-chart-line"></i>Cập nhật tiến độ</button><button class="btn btn-primary" data-act="subcontracting-receive" data-id="${esc(o.id)}"><i class="fa-solid fa-box-open"></i>Nhận hàng & QC</button>`:''}${debt>0?`<button class="btn" data-act="subcontracting-pay" data-id="${esc(o.id)}"><i class="fa-solid fa-money-bill-transfer"></i>Thanh toán</button>`:''}`
  });
}
function openSubcontractingIssueModal(id){
  const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o)return;if(o.status!=='APPROVED'){Toast.warn('Chưa thể xuất NVL','Đơn gia công phải được duyệt trước.');return;} const bom=subcontractBomLines(o); if(!bom.length){Toast.warn('Chưa có BOM','Thành phẩm chưa được khai báo BOM / định mức.');return;}
  const rows=bom.map(x=>{const avail=subcontractAvailable(x.materialId),ok=avail+1e-9>=x.qty;return `<tr><td>${cell2(`<span class="code">${esc(x.materialId)}</span>`,esc(Q.material(x.materialId)?.name||''))}</td><td class="right num">${fmtDec(x.qty,3)} ${esc(Q.material(x.materialId)?.unit||'')}</td><td class="right num">${fmtDec(avail,3)}</td><td>${ok?'<span class="badge green">Đủ</span>':'<span class="badge red">Thiếu</span>'}</td></tr>`}).join('');
  Modal.open({title:`Xuất NVL gia công · ${o.id}`,sub:`Giao nguyên liệu cho ${esc(o.partner)} theo BOM của ${esc(Q.product(o.productId)?.name||o.productId)}`,size:'lg',body:`${tableShell([{t:'Nguyên liệu'},{t:'Cần xuất',cls:'right'},{t:'Tồn khả dụng',cls:'right'},{t:'Kiểm tra'}],rows,{emptyTitle:'Không có BOM'})}<div class="note-box" style="margin-top:12px">Kho sẽ xuất theo lô khả dụng. Phiếu xuất kho được tạo để truy vết đơn gia công.</div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-issue-confirm" data-id="${esc(o.id)}"><i class="fa-solid fa-truck-ramp-box"></i>Xác nhận xuất NVL</button>`});
}
function subcontractingIssueMaterials(id){
  const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o||o.status!=='APPROVED')return; const bom=subcontractBomLines(o); for(const x of bom){if(subcontractAvailable(x.materialId)+1e-9<x.qty){Toast.err('Không đủ nguyên liệu',`${Q.material(x.materialId)?.name||x.materialId}: cần ${fmtDec(x.qty,3)}, tồn ${fmtDec(subcontractAvailable(x.materialId),3)}.`);return;}}
  const issueId=nextCode('PXGC-2026-',DB.goodsIssues||[]), issueItems=[]; const today=subcontractToday();
  for(const x of bom){let remain=x.qty;const stocks=(DB.inventory||[]).filter(r=>r.productId===x.materialId&&Number(r.qtyAvailable||0)>0&&Q.warehouse(r.warehouseId)?.type==='RAW_MATERIAL').sort((a,b)=>String(Q.lot(a.lotId)?.expiryDate||'9999').localeCompare(String(Q.lot(b.lotId)?.expiryDate||'9999')));for(const row of stocks){if(remain<=1e-9)break;const take=Math.min(remain,Number(row.qtyAvailable||0));const posted=InventoryService.apply({productId:x.materialId,warehouseId:row.warehouseId,locationId:row.locationId,lotId:row.lotId,quantity:take,type:'PRODUCTION_ISSUE',refType:'SUBCONTRACTING',refId:issueId,note:`Xuất NVL cho đơn gia công ${o.id}`});if(!posted.ok){Toast.err('Không thể xuất NVL',posted.message);return;}issueItems.push({productId:x.materialId,lotId:row.lotId,qty:take,locationId:row.locationId,unit:Q.material(x.materialId)?.unit||''});remain-=take;}}
  (DB.goodsIssues||(DB.goodsIssues=[])).unshift({id:issueId,type:'SUBCONTRACT_ISSUE',warehouseId:'WH-001',refDoc:o.id,date:today,status:'COMPLETED',createdBy:DB.currentUser?.id||'',note:`Xuất nguyên liệu cho đối tác ${o.partner}`,items:issueItems});
  o.issueId=issueId;o.actualIssueDate=today;o.issuedQty=o.plannedQty;o.status='IN_PROGRESS';o.partnerProgress=Math.max(Number(o.partnerProgress||0),5);subcontractPersist();subcontractSyncInventory();Modal.close();render();Toast.ok('Đã xuất nguyên liệu gia công',`${issueId} · ${o.id}`);
}
function openSubcontractingProgressModal(id){const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o)return;Modal.open({title:`Cập nhật tiến độ · ${o.id}`,sub:esc(o.partner),size:'md',body:`<div class="field"><label>Tiến độ đối tác (%)</label><input class="inp right num" id="subProgress" type="number" min="0" max="100" value="${Number(o.partnerProgress||0)}"></div><div class="field"><label>Ghi chú tiến độ</label><textarea class="inp" id="subProgressNote" rows="3">${esc(o.progressNote||'')}</textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-progress-save" data-id="${esc(o.id)}">Lưu tiến độ</button>`});}
function subcontractingSaveProgress(id){const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o)return;o.partnerProgress=Math.max(0,Math.min(100,Number($('#subProgress')?.value||0)));o.progressNote=$('#subProgressNote')?.value?.trim()||'';o.progressUpdatedAt=new Date().toISOString();subcontractPersist();Modal.close();render();Toast.ok('Đã cập nhật tiến độ',`${id} · ${o.partnerProgress}%`);}
function openSubcontractingReceiveModal(id){
  const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o)return;if(!['IN_PROGRESS','PARTIAL_RECEIVED'].includes(o.status)){Toast.warn('Chưa thể nhận hàng','Đơn phải đã xuất NVL và đang gia công.');return;} const remain=Math.max(0,Number(o.plannedQty||0)-Number(o.receivedQty||0));
  Modal.open({title:`Nhận hàng & QC · ${o.id}`,sub:`${esc(o.partner)} · còn cần nhận ${fmtDec(remain,2)} ${esc(Q.product(o.productId)?.unit||'')}`,size:'lg',body:`<div class="form-grid cols-3"><div class="field"><label>Số lượng nhận đợt này *</label><input class="inp right num" id="subReceiveQty" type="number" min="0.01" max="${remain}" step="0.01" value="${remain}"></div><div class="field"><label>Số lượng đạt *</label><input class="inp right num" id="subGoodQty" type="number" min="0" max="${remain}" step="0.01" value="${remain}"></div><div class="field"><label>Số lượng lỗi *</label><input class="inp right num" id="subDefectQty" type="number" min="0" max="${remain}" step="0.01" value="0"></div><div class="field" style="grid-column:1/-1"><label>Ghi chú nhận hàng / QC</label><textarea class="inp" id="subReceiveNote" rows="3" placeholder="Tình trạng bao bì, ngoại quan, chất lượng…"></textarea></div></div><div class="note-box">Số đạt sẽ nhập <b>Kho thành phẩm</b>; số lỗi sẽ nhập <b>Kho Hàng lỗi</b> để tách riêng khỏi tồn bán được.</div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-receive-confirm" data-id="${esc(o.id)}"><i class="fa-solid fa-clipboard-check"></i>Xác nhận nhận hàng & QC</button>`});
}
function subcontractingReceiveGoods(id){
  const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o)return;const remain=Math.max(0,Number(o.plannedQty||0)-Number(o.receivedQty||0));const recv=Number($('#subReceiveQty')?.value||0),good=Number($('#subGoodQty')?.value||0),bad=Number($('#subDefectQty')?.value||0);if(recv<=0||recv>remain+1e-9||Math.abs(good+bad-recv)>1e-6){Toast.err('Số lượng không hợp lệ','Số đạt + số lỗi phải bằng số lượng nhận và không vượt phần còn lại.');return;} const today=subcontractToday(); const product=Q.product(o.productId); const receiptId=nextCode('PNGC-2026-',DB.goodsReceipts||[]); const items=[];
  function post(qty,warehouseId,locationId,suffix,qc){if(qty<=0)return;const lotId=nextCode('LOT-',DB.inventoryLots||[]),lotNumber=subcontractNextLot(o,suffix);(DB.inventoryLots||(DB.inventoryLots=[])).unshift({id:lotId,lotNumber,productId:o.productId,productionOrderId:'',mfgDate:today,expiryDate:addDays(today,7),supplierLot:'',supplierId:'',qcStatus:qc,status:'active',createdAt:`${today} 09:00`,subcontractingOrderId:o.id});const r=InventoryService.apply({productId:o.productId,warehouseId,locationId,lotId,quantity:qty,type:'PRODUCTION_RECEIPT',refType:'SUBCONTRACTING',refId:receiptId,note:`Nhận hàng gia công ${o.id}`,updateMaterial:false});if(!r.ok)throw new Error(r.message);items.push({materialId:o.productId,name:product?.name||o.productId,unit:product?.unit||'',qty,lotNumber,locationId,qcStatus:qc});}
  try{post(good,'WH-004','LOC-007','-OK','PASSED');post(bad,'WH-006','LOC-010','-DEF','FAILED');}catch(err){Toast.err('Không thể nhập kho',err.message);return;}
  (DB.goodsReceipts||(DB.goodsReceipts=[])).unshift({id:receiptId,poId:'',prId:'',date:today,receivedBy:DB.currentUser?.id||'',warehouse:'Gia công',warehouseId:'WH-004',locationId:'LOC-007',status:'RECEIVED',note:`Nhận hàng từ ${o.partner} · ${o.id}`,sourceType:'SUBCONTRACTING',refDoc:o.id,items});
  o.receivedQty=Number(o.receivedQty||0)+recv;o.goodQty=Number(o.goodQty||0)+good;o.defectQty=Number(o.defectQty||0)+bad;o.lastReceivedAt=new Date().toISOString();o.lastReceiptId=receiptId;o.receiveNote=$('#subReceiveNote')?.value?.trim()||'';o.partnerProgress=Math.max(Number(o.partnerProgress||0),Math.round(o.receivedQty/Number(o.plannedQty||1)*100));o.status=o.receivedQty+1e-9>=Number(o.plannedQty||0)?'COMPLETED':'PARTIAL_RECEIVED';subcontractPersist();subcontractSyncInventory();Modal.close();render();Toast.ok('Đã nhận hàng gia công',`${receiptId} · đạt ${fmtDec(good,2)} · lỗi ${fmtDec(bad,2)}`);
}
function openSubcontractingPaymentModal(id){const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o)return;const debt=subcontractDebt(o);if(debt<=0){Toast.info('Không còn công nợ',id);return;}Modal.open({title:`Thanh toán gia công · ${id}`,sub:`${esc(o.partner)} · còn phải trả ${fmtVND(debt)}`,size:'md',body:`<div class="field"><label>Số tiền thanh toán *</label><input class="inp right num" id="subPayAmount" data-money="1" type="text" inputmode="numeric" min="1" max="${debt}" value="${debt}"></div><div class="field"><label>Ghi chú</label><textarea class="inp" id="subPayNote" rows="2"></textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-pay-save" data-id="${esc(id)}">Ghi nhận thanh toán</button>`});}
function subcontractingSavePayment(id){const o=(DB.subcontractingOrders||[]).find(x=>x.id===id);if(!o)return;const debt=subcontractDebt(o),amt=parseMoney($('#subPayAmount')?.value||0);if(amt<=0||amt>debt+1e-9){Toast.err('Số tiền không hợp lệ',`Số tiền phải từ 1 đến ${fmtVND(debt)}.`);return;}o.paid=Number(o.paid||0)+amt;(o.payments||(o.payments=[])).unshift({date:subcontractToday(),amount:amt,note:$('#subPayNote')?.value?.trim()||'',by:DB.currentUser?.id||''});subcontractPersist();Modal.close();render();Toast.ok('Đã ghi nhận thanh toán',`${id} · ${fmtVND(amt)}`);}

function openSubcontractingPartnerForm(id=''){
  subcontractHydrate();const p=id?(DB.subcontractingPartners||[]).find(x=>x.id===id):null;Modal.open({title:p?'Sửa đối tác gia công':'Thêm đối tác gia công',sub:p?`${p.id} · ${esc(p.name)}`:'Khai báo đơn vị nhận gia công',size:'md',body:`<div class="form-grid cols-2"><div class="field" style="grid-column:1/-1"><label>Tên đối tác *</label><input class="inp" id="subPartnerName" value="${esc(p?.name||'')}"></div><div class="field"><label>Người liên hệ</label><input class="inp" id="subPartnerContact" value="${esc(p?.contact||'')}"></div><div class="field"><label>Điện thoại</label><input class="inp" id="subPartnerPhone" value="${esc(p?.phone||'')}"></div><div class="field" style="grid-column:1/-1"><label>Địa chỉ</label><input class="inp" id="subPartnerAddress" value="${esc(p?.address||'')}"></div><div class="field"><label>Trạng thái</label><select class="inp" id="subPartnerStatus"><option value="active" ${p?.status!=='inactive'?'selected':''}>Đang hoạt động</option><option value="inactive" ${p?.status==='inactive'?'selected':''}>Ngừng hoạt động</option></select></div><div class="field"><label>Ghi chú</label><input class="inp" id="subPartnerNote" value="${esc(p?.note||'')}"></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-partner-save" data-id="${esc(p?.id||'')}">Lưu đối tác</button>`});
}
function subcontractingSavePartner(id=''){const name=$('#subPartnerName')?.value?.trim();if(!name){Toast.err('Thiếu tên đối tác','Vui lòng nhập tên đối tác.');return;}const payload={name,contact:$('#subPartnerContact')?.value?.trim()||'',phone:$('#subPartnerPhone')?.value?.trim()||'',address:$('#subPartnerAddress')?.value?.trim()||'',status:$('#subPartnerStatus')?.value||'active',note:$('#subPartnerNote')?.value?.trim()||''};if(id){const p=(DB.subcontractingPartners||[]).find(x=>x.id===id);if(p){const old=p.name;Object.assign(p,payload);(DB.subcontractingOrders||[]).filter(o=>o.partnerId===id||o.partner===old).forEach(o=>{o.partnerId=id;o.partner=name;});}}else{(DB.subcontractingPartners||(DB.subcontractingPartners=[])).unshift({id:nextCode('DTC-',DB.subcontractingPartners),...payload});}subcontractPersist();Modal.close();render();Toast.ok('Đã lưu đối tác gia công',name);}
function openSubcontractingPartnerDetail(idOrName){const p=subcontractPartner(idOrName);if(!p)return;const orders=(DB.subcontractingOrders||[]).filter(o=>o.partnerId===p.id||o.partner===p.name);Modal.open({title:`Đối tác gia công · ${p.name}`,sub:p.id,size:'lg',body:`<div class="info-grid">${infoItem('Người liên hệ',esc(p.contact||'—'))}${infoItem('Điện thoại',esc(p.phone||'—'))}${infoItem('Địa chỉ',esc(p.address||'—'))}${infoItem('Trạng thái',p.status==='inactive'?'<span class="badge slate">Ngừng hoạt động</span>':'<span class="badge green">Đang hoạt động</span>')}${infoItem('Số đơn gia công',orders.length)}${infoItem('Công nợ',fmtVND(orders.reduce((s,o)=>s+subcontractDebt(o),0)))}</div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn" data-act="subcontracting-partner-edit" data-id="${esc(p.id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`});}
function subcontractingDeletePartner(id){const p=subcontractPartner(id);if(!p)return;if((DB.subcontractingOrders||[]).some(o=>o.partnerId===id||o.partner===p.name)){Toast.warn('Không thể xóa','Đối tác đã phát sinh đơn gia công. Hãy chuyển trạng thái sang Ngừng hoạt động.');return;}DB.subcontractingPartners=DB.subcontractingPartners.filter(x=>x.id!==id);subcontractPersist();render();}

/* Ghi đè các view Gia công cũ bằng phiên bản có CRUD / xem chi tiết và luồng kho đầy đủ. */
Views['subcontracting-overview']=function(){subcontractHydrate();const orders=DB.subcontractingOrders||[];const active=orders.filter(o=>['APPROVED','IN_PROGRESS','PARTIAL_RECEIVED'].includes(o.status));const debt=orders.reduce((s,o)=>s+subcontractDebt(o),0);const rows=orders.slice(0,8).map(o=>`<tr class="clickable" data-act="subcontracting-open" data-id="${esc(o.id)}"><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(o.plannedQty,2)}</td><td class="right num">${fmtDec(o.receivedQty,2)}</td><td>${subcontractStatusHtml(o.status)}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'}])}</td></tr>`).join('');return `${pageHead('Gia công','Quản lý đối tác, nguyên liệu gửi đi, tiến độ, nhận hàng, QC và công nợ',`<button class="btn btn-primary" data-act="subcontracting-new"><i class="fa-solid fa-plus"></i>Tạo đơn gia công</button>`)}<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Tổng đơn',orders.length,'fa-industry','blue')}${mkpi('Đang xử lý',active.length,'fa-spinner','orange')}${mkpi('Hoàn thành',orders.filter(o=>o.status==='COMPLETED').length,'fa-circle-check','green')}${mkpi('Công nợ',fmtVND(debt),'fa-file-invoice-dollar','red')}</div><div class="card"><div class="card-head"><div><h3>Đơn gia công gần đây</h3><p>Click vào dòng để xem toàn bộ lịch sử</p></div></div>${tableShell([{t:'Mã đơn'},{t:'Đối tác'},{t:'Thành phẩm'},{t:'SL',cls:'right'},{t:'Đã nhận',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có đơn gia công'})}</div>`;};
Views['subcontracting-orders']=function(){subcontractHydrate();const rows=(DB.subcontractingOrders||[]).map(o=>{const acts=[{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'}];if(o.status==='DRAFT')acts.push({act:'subcontracting-edit',data:`data-id="${esc(o.id)}"`,icon:'fa-pen',title:'Sửa'},{act:'subcontracting-approve',data:`data-id="${esc(o.id)}"`,icon:'fa-check',title:'Duyệt'},{act:'subcontracting-delete',data:`data-id="${esc(o.id)}"`,icon:'fa-trash',title:'Xóa'});if(o.status==='APPROVED')acts.push({act:'subcontracting-issue',data:`data-id="${esc(o.id)}"`,icon:'fa-arrow-right-from-bracket',title:'Xuất NVL'});if(['IN_PROGRESS','PARTIAL_RECEIVED'].includes(o.status))acts.push({act:'subcontracting-receive',data:`data-id="${esc(o.id)}"`,icon:'fa-box-open',title:'Nhận hàng & QC'});return `<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(o.plannedQty,2)}</td><td class="right num">${fmtDec(o.receivedQty,2)}</td><td>${fmtDate(o.dueDate)}</td><td>${subcontractStatusHtml(o.status)}</td><td class="right">${rowActions(acts)}</td></tr>`}).join('');return `${pageHead('Đơn gia công','Tạo, duyệt và theo dõi toàn bộ đơn gia công',`<button class="btn btn-primary" data-act="subcontracting-new"><i class="fa-solid fa-plus"></i>Tạo đơn gia công</button>`)}<div class="card">${tableShell([{t:'Mã đơn'},{t:'Đối tác'},{t:'Thành phẩm'},{t:'Kế hoạch',cls:'right'},{t:'Đã nhận',cls:'right'},{t:'Hạn nhận'},{t:'Trạng thái'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có đơn gia công'})}</div>`;};
Views['subcontracting-issue']=function(){subcontractHydrate();const list=(DB.subcontractingOrders||[]).filter(o=>['APPROVED','IN_PROGRESS','PARTIAL_RECEIVED','COMPLETED'].includes(o.status));const rows=list.map(o=>`<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${subcontractBomLines(o).length} NVL</td><td>${o.issueId?`<span class="code">${esc(o.issueId)}</span>`:'—'}</td><td>${o.actualIssueDate?fmtDate(o.actualIssueDate):'—'}</td><td>${o.issueId?'<span class="badge green">Đã xuất</span>':'<span class="badge orange">Chờ xuất</span>'}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},...(o.status==='APPROVED'?[{act:'subcontracting-issue',data:`data-id="${esc(o.id)}"`,icon:'fa-arrow-right-from-bracket',title:'Xuất NVL'}]:[])])}</td></tr>`).join('');return `${pageHead('Xuất nguyên liệu gia công','Xuất NVL theo BOM sau khi đơn gia công được duyệt')}<div class="card">${tableShell([{t:'Đơn GC'},{t:'Đối tác'},{t:'Thành phẩm'},{t:'BOM',cls:'right'},{t:'Phiếu xuất'},{t:'Ngày xuất'},{t:'Tình trạng'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có đơn cần xuất nguyên liệu'})}</div>`;};
Views['subcontracting-progress']=function(){subcontractHydrate();const rows=(DB.subcontractingOrders||[]).map(o=>{const pct=o.status==='COMPLETED'?100:Math.max(Number(o.partnerProgress||0),Number(o.plannedQty||0)?Math.round(Number(o.receivedQty||0)/Number(o.plannedQty||1)*100):0);return `<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td style="min-width:180px">${progressBar(pct)}<div class="cell-sub">${pct}%</div></td><td>${fmtDate(o.dueDate)}</td><td>${subcontractStatusHtml(o.status)}</td><td class="muted">${esc(o.progressNote||'—')}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},...(['IN_PROGRESS','PARTIAL_RECEIVED'].includes(o.status)?[{act:'subcontracting-progress-update',data:`data-id="${esc(o.id)}"`,icon:'fa-chart-line',title:'Cập nhật tiến độ'}]:[])])}</td></tr>`}).join('');return `${pageHead('Theo dõi tiến độ','Theo dõi tiến độ đối tác và hạn nhận hàng')}<div class="card">${tableShell([{t:'Đơn GC'},{t:'Đối tác'},{t:'Thành phẩm'},{t:'Tiến độ'},{t:'Hạn nhận'},{t:'Trạng thái'},{t:'Ghi chú'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có đơn gia công'})}</div>`;};
Views['subcontracting-receive']=function(){subcontractHydrate();const rows=(DB.subcontractingOrders||[]).filter(o=>o.status!=='DRAFT'&&o.status!=='APPROVED').map(o=>`<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(o.receivedQty,2)} / ${fmtDec(o.plannedQty,2)}</td><td class="right num" style="color:var(--green)">${fmtDec(o.goodQty,2)}</td><td class="right num" style="color:${Number(o.defectQty||0)>0?'var(--red)':'inherit'}">${fmtDec(o.defectQty,2)}</td><td>${o.lastReceiptId?`<span class="code">${esc(o.lastReceiptId)}</span>`:'—'}</td><td>${subcontractStatusHtml(o.status)}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},...(['IN_PROGRESS','PARTIAL_RECEIVED'].includes(o.status)?[{act:'subcontracting-receive',data:`data-id="${esc(o.id)}"`,icon:'fa-box-open',title:'Nhận hàng & QC'}]:[])])}</td></tr>`).join('');return `${pageHead('Nhận hàng & chất lượng','Nhận thành phẩm gia công, kiểm tra chất lượng và nhập đúng kho')}<div class="card">${tableShell([{t:'Đơn GC'},{t:'Đối tác'},{t:'Thành phẩm'},{t:'Đã nhận / KH',cls:'right'},{t:'Đạt',cls:'right'},{t:'Lỗi',cls:'right'},{t:'Phiếu nhập'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có hàng gia công nhận về'})}</div>`;};
Views['subcontracting-debt']=function(){subcontractHydrate();const rows=(DB.subcontractingOrders||[]).map(o=>`<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td class="right num">${fmtVND(subcontractOrderAmount(o))}</td><td class="right num">${fmtVND(o.paid||0)}</td><td class="right num strong">${fmtVND(subcontractDebt(o))}</td><td>${subcontractDebt(o)<=0?'<span class="badge green">Đã thanh toán</span>':Number(o.paid||0)>0?'<span class="badge orange">Một phần</span>':'<span class="badge slate">Chưa thanh toán</span>'}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},...(subcontractDebt(o)>0?[{act:'subcontracting-pay',data:`data-id="${esc(o.id)}"`,icon:'fa-money-bill-transfer',title:'Thanh toán'}]:[])])}</td></tr>`).join('');return `${pageHead('Công nợ gia công','Giá trị thanh toán tính theo số lượng QC đạt khi đã nhận hàng')}<div class="card">${tableShell([{t:'Đơn GC'},{t:'Đối tác'},{t:'Giá trị',cls:'right'},{t:'Đã trả',cls:'right'},{t:'Còn nợ',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có công nợ'})}</div>`;};
Views['subcontracting-partners']=function(){subcontractHydrate();const rows=(DB.subcontractingPartners||[]).map(p=>{const os=(DB.subcontractingOrders||[]).filter(o=>o.partnerId===p.id||o.partner===p.name);return `<tr><td><span class="code">${esc(p.id)}</span></td><td class="strong">${esc(p.name)}</td><td>${esc(p.contact||'—')}</td><td>${esc(p.phone||'—')}</td><td class="right num">${os.length}</td><td class="right num">${fmtVND(os.reduce((s,o)=>s+subcontractDebt(o),0))}</td><td>${p.status==='inactive'?'<span class="badge slate">Ngừng hoạt động</span>':'<span class="badge green">Đang hoạt động</span>'}</td><td class="right">${rowActions([{act:'subcontracting-partner-detail',data:`data-id="${esc(p.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},{act:'subcontracting-partner-edit',data:`data-id="${esc(p.id)}"`,icon:'fa-pen',title:'Sửa'},{act:'subcontracting-partner-delete',data:`data-id="${esc(p.id)}"`,icon:'fa-trash',title:'Xóa'}])}</td></tr>`}).join('');return `${pageHead('Đối tác gia công','Danh mục đối tác nhận gia công',`<button class="btn btn-primary" data-act="subcontracting-partner-new"><i class="fa-solid fa-plus"></i>Thêm đối tác</button>`)}<div class="card">${tableShell([{t:'Mã'},{t:'Đối tác'},{t:'Liên hệ'},{t:'Điện thoại'},{t:'Số đơn',cls:'right'},{t:'Công nợ',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có đối tác gia công'})}</div>`;};


/* ==========================================================================
 * GIA CÔNG V3 - đúng luồng nghiệp vụ
 * Kế hoạch -> Duyệt -> Xuất NVL -> Giao đối tác -> Theo dõi tiến độ
 * -> Nhận hàng hoàn thành -> QC -> Nhập kho -> Đối chiếu công nợ
 * ========================================================================== */
function subcontractV3Receipts(o){ return Array.isArray(o?.receipts) ? o.receipts : (o.receipts=[]); }
function subcontractV3NormalizeOrder(o){
  if(!o) return o;
  if(!Array.isArray(o.receipts)) o.receipts=[];
  if(!Array.isArray(o.materialIssues)) o.materialIssues=[];
  if(!Array.isArray(o.payments)) o.payments=[];
  if(o.status==='IN_PROGRESS' && o.issueId && !o.handoverAt) { o.handoverAt=o.actualIssueDate||o.issueDate||subcontractToday(); o.handoverLegacy=true; }
  if(o.status==='PARTIAL_RECEIVED' && !o.handoverAt) { o.handoverAt=o.actualIssueDate||o.issueDate||subcontractToday(); }
  return o;
}
function subcontractV3Orders(){ subcontractHydrate(); return (DB.subcontractingOrders||[]).map(subcontractV3NormalizeOrder); }
function subcontractV3StatusHtml(status){
  const m={
    DRAFT:['Nháp','slate'], APPROVED:['Đã duyệt kế hoạch','blue'], MATERIAL_ISSUED:['Đã xuất NVL','indigo'],
    HANDED_OVER:['Đã giao đối tác','teal'], IN_PROGRESS:['Đang gia công','orange'], PARTIAL_RECEIVED:['Nhận một phần','orange'],
    RECEIVED_PENDING_QC:['Chờ QC','orange'], QC_COMPLETED:['Đã QC','blue'], COMPLETED:['Hoàn thành','green'], CANCELLED:['Đã hủy','red']
  }; const x=m[status]||[status||'—','slate']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`;
}
function subcontractOrderAmount(o){
  if(Number.isFinite(Number(o?.reconciledAmount)) && o?.reconciledAt) return Math.max(0,Number(o.reconciledAmount));
  return Math.max(0,Number(o?.goodQty||0)*Number(o?.unitCost||0));
}
function subcontractDebt(o){ return Math.max(0,subcontractOrderAmount(o)-Number(o?.paid||0)); }
function subcontractV3BomBase(order, outputQty){
  const p=subcontractProduct(order); const qty=Number(outputQty||0);
  return (p?.bom||[]).map(row=>{
    if(Array.isArray(row)){ const [materialId,per]=row; return {materialId,per:Number(per||0),lossPct:0,standardQty:Number(per||0)*qty}; }
    const materialId=row.materialId||row.id||row.productId; const per=Number(row.qtyPerUnit??row.quantity??row.qty??0); const lossPct=Number(row.lossPct||row.wastePct||0);
    return {materialId,per,lossPct,standardQty:per*qty};
  }).filter(x=>x.materialId&&x.standardQty>=0);
}
function subcontractV3IssueLines(o){
  if(Array.isArray(o?.materialIssues) && o.materialIssues.length) return o.materialIssues;
  if(o?.issueId){ return subcontractBomLines(o).map(x=>({materialId:x.materialId,standardQty:Number(x.per||0)*Number(o.plannedQty||0),plannedQty:x.qty,issuedQty:x.qty,unit:Q.material(x.materialId)?.unit||'',lossPct:Number(x.lossPct||0)})); }
  return [];
}
function subcontractV3WasteRows(o){
  const outputQty=Number(o?.receivedQty||0); if(outputQty<=0) return [];
  const standards=new Map(subcontractV3BomBase(o,outputQty).map(x=>[x.materialId,x]));
  return subcontractV3IssueLines(o).map(line=>{
    const std=standards.get(line.materialId); const issued=Number(line.issuedQty??line.qty??0); const standard=Number(std?.standardQty||0);
    const waste=Math.max(0,issued-standard); const pct=issued>0?waste/issued*100:0;
    return {materialId:line.materialId,issued,standard,waste,pct,unit:line.unit||Q.material(line.materialId)?.unit||''};
  });
}
function subcontractV3WasteRate(o){ const rows=subcontractV3WasteRows(o).filter(x=>x.issued>0); return rows.length?rows.reduce((s,x)=>s+x.pct,0)/rows.length:0; }
function subcontractV3DefectRate(o){ const r=Number(o?.receivedQty||0); return r>0?Number(o?.defectQty||0)/r*100:0; }
function subcontractV3OnTime(o){ const d=String(o?.lastReceivedAt||o?.completedAt||'').slice(0,10); return !!(d&&o?.dueDate&&d<=o.dueDate); }
function subcontractV3PartnerMetrics(p){
  const os=subcontractV3Orders().filter(o=>o.partnerId===p.id||o.partner===p.name); const completed=os.filter(o=>o.status==='COMPLETED');
  const received=os.reduce((s,o)=>s+Number(o.receivedQty||0),0), good=os.reduce((s,o)=>s+Number(o.goodQty||0),0), defect=os.reduce((s,o)=>s+Number(o.defectQty||0),0);
  const defectRate=received>0?defect/received*100:0; const wasteRates=os.map(subcontractV3WasteRate).filter(x=>x>=0); const wasteRate=wasteRates.length?wasteRates.reduce((a,b)=>a+b,0)/wasteRates.length:0;
  const onTime=completed.length?completed.filter(subcontractV3OnTime).length/completed.length*100:0; const completion=os.length?completed.length/os.length*100:0;
  const cost=os.reduce((s,o)=>s+subcontractOrderAmount(o),0); const score=Math.max(0,Math.min(100,(100-defectRate)*0.45+(100-wasteRate)*0.25+onTime*0.2+completion*0.1));
  return {orders:os.length,completed:completed.length,received,good,defect,defectRate,wasteRate,onTime,completion,cost,debt:os.reduce((s,o)=>s+subcontractDebt(o),0),score};
}
function subcontractV3RecalcStatus(o){
  const receipts=subcontractV3Receipts(o); const pendingQc=receipts.some(r=>r.qcStatus!=='DONE'); const pendingWarehouse=receipts.some(r=>r.qcStatus==='DONE'&&!r.warehoused);
  if(Number(o.receivedQty||0)>=Number(o.plannedQty||0)-1e-9){
    if(pendingQc) o.status='RECEIVED_PENDING_QC'; else if(pendingWarehouse) o.status='QC_COMPLETED'; else {o.status='COMPLETED';o.completedAt=o.completedAt||new Date().toISOString();o.partnerProgress=100;}
  } else if(pendingQc) o.status='RECEIVED_PENDING_QC'; else if(o.handoverAt) o.status='IN_PROGRESS';
}

Views.subcontracting=function(){
  let tab=State.tab||'dashboard';
  // Tương thích link cũ: Menu/Combo đã được gộp vào Menu / Công thức món.
  if(tab==='menu') tab='recipe'; const map={dashboard:'subcontracting-overview',orders:'subcontracting-orders',issue:'subcontracting-issue',handover:'subcontracting-handover',progress:'subcontracting-progress',receive:'subcontracting-receive',qc:'subcontracting-qc',warehouse:'subcontracting-warehouse',debt:'subcontracting-debt',partners:'subcontracting-partners',evaluation:'subcontracting-partners',reports:'subcontracting-reports'};
  return Views[map[tab]]?Views[map[tab]]():'';
};

function openSubcontractingForm(id=''){
  subcontractHydrate(); const o=id?subcontractV3Orders().find(x=>x.id===id):null; if(o&&o.status!=='DRAFT'){Toast.warn('Không thể sửa kế hoạch','Chỉ kế hoạch Nháp mới được sửa.');return;} const today=subcontractToday();
  Modal.open({title:o?`Sửa kế hoạch gia công · ${o.id}`:'Tạo kế hoạch gia công',sub:'Nhận kế hoạch gia công: chọn đối tác, thành phẩm, số lượng, đơn giá và thời hạn',size:'lg',body:`<div class="form-grid cols-2">
    <div class="field"><label>Đối tác gia công *</label><select class="inp" id="subPartner"><option value="">-- Chọn đối tác --</option>${(DB.subcontractingPartners||[]).filter(p=>p.status!=='inactive').map(p=>`<option value="${esc(p.id)}" ${(o?.partnerId===p.id||o?.partner===p.name)?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Thành phẩm *</label><select class="inp" id="subProduct">${(DB.products||[]).slice().sort((a,b)=>String(a.id||'').localeCompare(String(b.id||''),'vi',{numeric:true})).map(p=>`<option value="${esc(p.id)}" ${o?.productId===p.id?'selected':''}>${esc(p.id)} — ${esc(p.name)} (${esc(p.unit||'')})</option>`).join('')}</select></div>
    <div class="field"><label>Số lượng kế hoạch *</label><input class="inp right num" id="subQty" type="number" min="0.01" step="0.01" value="${Number(o?.plannedQty||100)}"></div>
    <div class="field"><label>Đơn giá gia công / đơn vị *</label><input class="inp right num" id="subCost" data-money="1" type="text" inputmode="numeric" min="0" step="100" value="${Number(o?.unitCost||1500)}"></div>
    <div class="field"><label>Ngày dự kiến giao NVL</label><input class="inp" id="subIssueDate" type="date" min="${today}" value="${o?.issueDate&&o.issueDate>=today?o.issueDate:today}"></div>
    <div class="field"><label>Ngày cần hoàn thành *</label><input class="inp" id="subDueDate" type="date" min="${today}" value="${o?.dueDate&&o.dueDate>=today?o.dueDate:addDays(today,7)}"></div>
    <div class="field" style="grid-column:1/-1"><label>Yêu cầu kỹ thuật / ghi chú</label><textarea class="inp" id="subNote" rows="3" placeholder="Quy cách, đóng gói, tiêu chuẩn chất lượng, điều kiện giao nhận…">${esc(o?.note||'')}</textarea></div>
  </div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-save" data-id="${esc(o?.id||'')}"><i class="fa-solid fa-floppy-disk"></i>${o?'Lưu kế hoạch':'Tạo kế hoạch'}</button>`});
}
function subcontractingSaveOrder(id=''){
  subcontractHydrate(); const partner=subcontractPartner($('#subPartner')?.value), product=Q.product($('#subProduct')?.value), qty=Number($('#subQty')?.value||0), cost=parseMoney($('#subCost')?.value||0), today=subcontractToday(), issueDate=$('#subIssueDate')?.value||today, dueDate=$('#subDueDate')?.value||addDays(today,7);
  if(!partner||!product||qty<=0||cost<0){Toast.err('Thiếu thông tin','Vui lòng chọn đối tác, sản phẩm, số lượng và đơn giá hợp lệ.');return;} if(issueDate<today||dueDate<today||dueDate<issueDate){Toast.err('Ngày không hợp lệ','Ngày phải từ hiện tại và hạn hoàn thành không được trước ngày giao NVL.');return;}
  const payload={partnerId:partner.id,partner:partner.name,productId:product.id,plannedQty:qty,unit:product.unit,issueDate,dueDate,unitCost:cost,note:$('#subNote')?.value?.trim()||''};
  if(id){const o=subcontractV3Orders().find(x=>x.id===id);if(!o||o.status!=='DRAFT')return;Object.assign(o,payload,{updatedAt:new Date().toISOString()});}
  else{const code=nextCode('GC-2026-',DB.subcontractingOrders||[]);(DB.subcontractingOrders||(DB.subcontractingOrders=[])).unshift({id:code,...payload,status:'DRAFT',issuedQty:0,receivedQty:0,goodQty:0,defectQty:0,storedGoodQty:0,storedDefectQty:0,paid:0,partnerProgress:0,receipts:[],materialIssues:[],payments:[],createdAt:new Date().toISOString(),createdBy:DB.currentUser?.id||''});}
  subcontractPersist();Modal.close();go('subcontracting',{tab:'orders'});Toast.ok(id?'Đã cập nhật kế hoạch gia công':'Đã tạo kế hoạch gia công',id||DB.subcontractingOrders[0].id);
}
function subcontractingApproveOrder(id){const o=subcontractV3Orders().find(x=>x.id===id);if(!o||o.status!=='DRAFT')return;o.status='APPROVED';o.approvedAt=new Date().toISOString();o.approvedBy=DB.currentUser?.id||'';subcontractPersist();render();Toast.ok('Đã duyệt kế hoạch gia công',`${id} · bước tiếp theo: xuất nguyên liệu gia công.`);}

function openSubcontractingIssueModal(id){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o)return;if(o.status!=='APPROVED'){Toast.warn('Chưa thể xuất NVL','Kế hoạch phải được duyệt trước.');return;} const bom=subcontractBomLines(o);if(!bom.length){Toast.warn('Chưa có BOM','Sản phẩm chưa được khai báo BOM / định mức.');return;}
  const rows=bom.map(x=>{const m=Q.material(x.materialId),avail=subcontractAvailable(x.materialId),ok=avail+1e-9>=x.qty;return `<tr><td>${cell2(`<span class="code">${esc(x.materialId)}</span>`,esc(m?.name||''))}</td><td class="right num">${fmtDec(Number(x.per||0)*Number(o.plannedQty||0),3)} ${esc(m?.unit||'')}</td><td class="right num">${fmtDec(Number(x.lossPct||0),2)}%</td><td class="right num strong">${fmtDec(x.qty,3)}</td><td class="right num">${fmtDec(avail,3)}</td><td>${ok?'<span class="badge green">Đủ</span>':'<span class="badge red">Thiếu</span>'}</td></tr>`}).join('');
  Modal.open({title:`Xuất nguyên liệu gia công · ${o.id}`,sub:`Theo BOM của ${esc(Q.product(o.productId)?.name||o.productId)} · giao cho ${esc(o.partner)}`,size:'xl',body:`${tableShell([{t:'Nguyên liệu'},{t:'ĐM chuẩn',cls:'right'},{t:'Hao hụt BOM',cls:'right'},{t:'Cần xuất',cls:'right'},{t:'Tồn khả dụng',cls:'right'},{t:'Kiểm tra'}],rows,{emptyTitle:'Không có BOM'})}<div class="note-box" style="margin-top:12px">Bước này chỉ <b>xuất NVL khỏi kho</b>. Sau khi xuất xong phải xác nhận <b>Giao đối tác</b> thì mới chuyển sang theo dõi gia công.</div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-issue-confirm" data-id="${esc(o.id)}"><i class="fa-solid fa-truck-ramp-box"></i>Xác nhận xuất NVL</button>`});
}
function subcontractingIssueMaterials(id){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o||o.status!=='APPROVED')return;const bom=subcontractBomLines(o);for(const x of bom){if(subcontractAvailable(x.materialId)+1e-9<x.qty){Toast.err('Không đủ nguyên liệu',`${Q.material(x.materialId)?.name||x.materialId}: cần ${fmtDec(x.qty,3)}, tồn ${fmtDec(subcontractAvailable(x.materialId),3)}.`);return;}}
  const issueId=nextCode('PXGC-2026-',DB.goodsIssues||[]),items=[],materialIssues=[],today=subcontractToday();
  for(const x of bom){let remain=x.qty,issued=0;const stocks=(DB.inventory||[]).filter(r=>r.productId===x.materialId&&Number(r.qtyAvailable||0)>0&&Q.warehouse(r.warehouseId)?.type==='RAW_MATERIAL').sort((a,b)=>String(Q.lot(a.lotId)?.expiryDate||'9999').localeCompare(String(Q.lot(b.lotId)?.expiryDate||'9999')));for(const row of stocks){if(remain<=1e-9)break;const take=Math.min(remain,Number(row.qtyAvailable||0));const posted=InventoryService.apply({productId:x.materialId,warehouseId:row.warehouseId,locationId:row.locationId,lotId:row.lotId,quantity:take,type:'PRODUCTION_ISSUE',refType:'SUBCONTRACTING',refId:issueId,note:`Xuất NVL gia công ${o.id}`});if(!posted.ok){Toast.err('Không thể xuất NVL',posted.message);return;}items.push({productId:x.materialId,lotId:row.lotId,qty:take,locationId:row.locationId,unit:Q.material(x.materialId)?.unit||''});issued+=take;remain-=take;}materialIssues.push({materialId:x.materialId,standardQty:Number(x.per||0)*Number(o.plannedQty||0),plannedQty:x.qty,issuedQty:issued,lossPct:Number(x.lossPct||0),unit:Q.material(x.materialId)?.unit||''});}
  (DB.goodsIssues||(DB.goodsIssues=[])).unshift({id:issueId,type:'SUBCONTRACT_ISSUE',warehouseId:'WH-001',refDoc:o.id,date:today,status:'COMPLETED',createdBy:DB.currentUser?.id||'',note:`Xuất nguyên liệu gia công cho ${o.partner}`,items});
  o.issueId=issueId;o.actualIssueDate=today;o.materialIssues=materialIssues;o.issuedQty=Number(o.plannedQty||0);o.status='MATERIAL_ISSUED';subcontractPersist();subcontractSyncInventory();Modal.close();render();Toast.ok('Đã xuất nguyên liệu gia công',`${issueId} · bước tiếp theo: giao đối tác.`);
}

function openSubcontractingHandoverModal(id){const o=subcontractV3Orders().find(x=>x.id===id);if(!o||o.status!=='MATERIAL_ISSUED'){Toast.warn('Chưa thể giao đối tác','Phải xuất nguyên liệu gia công trước.');return;}const today=subcontractToday();Modal.open({title:`Giao đối tác · ${o.id}`,sub:`${esc(o.partner)} · ${esc(Q.product(o.productId)?.name||o.productId)}`,size:'md',body:`<div class="form-grid cols-2"><div class="field"><label>Ngày giao thực tế *</label><input class="inp" id="subHandoverDate" type="date" min="${today}" value="${today}"></div><div class="field"><label>Phiếu xuất NVL</label><input class="inp" value="${esc(o.issueId||'—')}" disabled></div><div class="field" style="grid-column:1/-1"><label>Biên bản / ghi chú giao nhận</label><textarea class="inp" id="subHandoverNote" rows="3" placeholder="Người nhận, tình trạng NVL, phương tiện giao…"></textarea></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-handover-confirm" data-id="${esc(id)}"><i class="fa-solid fa-handshake"></i>Xác nhận giao đối tác</button>`});}
function subcontractingHandoverConfirm(id){const o=subcontractV3Orders().find(x=>x.id===id);if(!o||o.status!=='MATERIAL_ISSUED')return;const date=$('#subHandoverDate')?.value||subcontractToday();if(date<subcontractToday()){Toast.err('Ngày không hợp lệ','Ngày giao thực tế không được ở quá khứ.');return;}o.handoverAt=date;o.handoverNote=$('#subHandoverNote')?.value?.trim()||'';o.handoverBy=DB.currentUser?.id||'';o.status='HANDED_OVER';o.partnerProgress=Math.max(Number(o.partnerProgress||0),1);subcontractPersist();Modal.close();render();Toast.ok('Đã ghi nhận giao đối tác',`${id} · bắt đầu theo dõi tiến độ.`);}

function openSubcontractingProgressModal(id){const o=subcontractV3Orders().find(x=>x.id===id);if(!o||!['HANDED_OVER','IN_PROGRESS'].includes(o.status)){Toast.warn('Chưa thể cập nhật tiến độ','Đơn phải được giao cho đối tác trước.');return;}Modal.open({title:`Cập nhật tiến độ · ${o.id}`,sub:esc(o.partner),size:'md',body:`<div class="field"><label>Tiến độ đối tác (%)</label><input class="inp right num" id="subProgress" type="number" min="0" max="100" value="${Number(o.partnerProgress||0)}"></div><div class="field"><label>Ghi chú tiến độ</label><textarea class="inp" id="subProgressNote" rows="3">${esc(o.progressNote||'')}</textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-progress-save" data-id="${esc(o.id)}">Lưu tiến độ</button>`});}
function subcontractingSaveProgress(id){const o=subcontractV3Orders().find(x=>x.id===id);if(!o)return;o.partnerProgress=Math.max(0,Math.min(100,Number($('#subProgress')?.value||0)));o.progressNote=$('#subProgressNote')?.value?.trim()||'';o.progressUpdatedAt=new Date().toISOString();if(o.status==='HANDED_OVER')o.status='IN_PROGRESS';subcontractPersist();Modal.close();render();if(o.partnerProgress>=100) Toast.ok('Đối tác đã hoàn thành','Tiếp theo ghi nhận hàng hoàn thành để chuyển QC/QA kiểm tra chất lượng.'); else Toast.ok('Đã cập nhật tiến độ',`${id} · ${o.partnerProgress}%`);}

function openSubcontractingReceiveModal(id){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o||!['HANDED_OVER','IN_PROGRESS','PARTIAL_RECEIVED'].includes(o.status)){Toast.warn('Chưa thể nhận hàng','Hàng phải được giao cho đối tác và đang thực hiện.');return;}const remain=Math.max(0,Number(o.plannedQty||0)-Number(o.receivedQty||0));if(remain<=1e-9){Toast.info('Đã nhận đủ số lượng kế hoạch','Chuyển sang bước kiểm tra chất lượng.');return;}
  Modal.open({title:`Nhận hàng hoàn thành · ${o.id}`,sub:`${esc(o.partner)} · còn cần nhận ${fmtDec(remain,2)} ${esc(Q.product(o.productId)?.unit||'')}`,size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Ngày nhận *</label><input class="inp" id="subReceiveDate" type="date" value="${subcontractToday()}" min="${subcontractToday()}"></div><div class="field"><label>Số lượng nhận đợt này *</label><input class="inp right num" id="subReceiveQty" type="number" min="0.01" max="${remain}" step="0.01" value="${remain}"></div><div class="field" style="grid-column:1/-1"><label>Ghi chú nhận hàng</label><textarea class="inp" id="subReceiveNote" rows="3" placeholder="Tình trạng bao bì, số kiện, chứng từ giao nhận…"></textarea></div></div><div class="note-box">Nhận hàng ở bước này <b>chưa cộng tồn kho</b>. Lô hàng sẽ chuyển sang <b>Kiểm tra chất lượng</b>.</div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-receive-confirm" data-id="${esc(o.id)}"><i class="fa-solid fa-box-open"></i>Xác nhận nhận hàng</button>`});
}
function subcontractingReceiveGoods(id){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o)return;const remain=Math.max(0,Number(o.plannedQty||0)-Number(o.receivedQty||0)),qty=Number($('#subReceiveQty')?.value||0),date=$('#subReceiveDate')?.value||subcontractToday();if(qty<=0||qty>remain+1e-9){Toast.err('Số lượng không hợp lệ',`Số lượng nhận phải > 0 và không vượt ${fmtDec(remain,2)}.`);return;}if(date<subcontractToday()){Toast.err('Ngày không hợp lệ','Ngày nhận không được ở quá khứ.');return;}
  const receiptNo=nextCode('NHGC-2026-',subcontractV3Orders().flatMap(x=>x.receipts||[]));const r={id:receiptNo,date,qty,qcStatus:'PENDING',warehoused:false,note:$('#subReceiveNote')?.value?.trim()||'',receivedBy:DB.currentUser?.id||'',createdAt:new Date().toISOString()};subcontractV3Receipts(o).push(r);o.receivedQty=Number(o.receivedQty||0)+qty;o.lastReceivedAt=new Date().toISOString();o.partnerProgress=Math.max(Number(o.partnerProgress||0),Math.round(o.receivedQty/Number(o.plannedQty||1)*100));subcontractV3RecalcStatus(o);subcontractPersist();Modal.close();render();Toast.ok('Đã nhận hàng hoàn thành',`${receiptNo} · chờ QC ${fmtDec(qty,2)} ${Q.product(o.productId)?.unit||''}`);
}

function openSubcontractingQcModal(id,receiptId=''){
  const o=subcontractV3Orders().find(x=>x.id===id); if(!o) return;
  const r=subcontractV3Receipts(o).find(x=>x.id===receiptId) || subcontractV3Receipts(o).find(x=>x.qcStatus!=='DONE');
  if(!r){ Toast.info('Không có lô chờ QC',id); return; }
  const readonly=r.qcStatus==='DONE';
  const unit=Q.product(o.productId)?.unit||'';
  Modal.open({
    title:`Kiểm tra gia công · ${r.id}`,
    sub:`${o.id} · ${esc(o.partner)} · ${esc(Q.product(o.productId)?.name||o.productId)}`,
    size:'lg',
    body:`<div class="info-grid" style="margin-bottom:14px">
      ${infoItem('Kế hoạch gia công',`<span class="code">${esc(o.id)}</span>`)}
      ${infoItem('Đối tác',esc(o.partner||'—'))}
      ${infoItem('Số lượng nhận',`<b>${fmtDec(r.qty,2)} ${esc(unit)}</b>`)}
      ${infoItem('Ngày nhận',fmtDate(r.date))}
      ${infoItem('Trạng thái QC',readonly?'<span class="badge green">Đã kiểm</span>':'<span class="badge orange">Chờ kiểm</span>')}
      ${infoItem('Trạng thái kho',r.warehoused?'<span class="badge green">Đã nhập kho</span>':(readonly?'<span class="badge blue">Chờ Kho nhập</span>':'—'))}
    </div>
    <div class="form-grid cols-2">
      <div class="field"><label>Số lượng đạt *</label><input class="inp right num" id="subQcGood" type="number" min="0" max="${r.qty}" step="0.01" value="${readonly?Number(r.goodQty||0):Number(r.qty||0)}" ${readonly?'disabled':''}></div>
      <div class="field"><label>Số lượng lỗi *</label><input class="inp right num" id="subQcBad" type="number" min="0" max="${r.qty}" step="0.01" value="${Number(r.defectQty||0)}" ${readonly?'disabled':''}></div>
      <div class="field" style="grid-column:1/-1"><label>Ghi chú QC</label><textarea class="inp" id="subQcNote" rows="3" ${readonly?'disabled':''} placeholder="Ngoại quan, quy cách, chất lượng, nguyên nhân lỗi…">${esc(r.qcNote||'')}</textarea></div>
    </div>
    <div class="note-box" style="margin-top:12px"><b>Luồng xử lý:</b> QC chỉ xác nhận số đạt / lỗi. Sau khi QC hoàn tất, lô này chuyển sang <b>Kho → Nhập kho → Kho thành phẩm</b>; Kho mới thực hiện nhập hàng đạt và tách hàng lỗi vào Kho Hàng lỗi.</div>`,
    foot:`<button class="btn" data-act="modal-close">Đóng</button>${readonly?'':`<button class="btn btn-primary" data-act="subcontracting-qc-confirm" data-id="${esc(id)}" data-receipt="${esc(r.id)}"><i class="fa-solid fa-clipboard-check"></i>Xác nhận QC</button>`}`
  });
}
function subcontractingQcConfirm(id,receiptId){const o=subcontractV3Orders().find(x=>x.id===id);if(!o)return;const r=subcontractV3Receipts(o).find(x=>x.id===receiptId);if(!r||r.qcStatus==='DONE')return;const good=Number($('#subQcGood')?.value||0),bad=Number($('#subQcBad')?.value||0);if(good<0||bad<0||Math.abs(good+bad-Number(r.qty||0))>1e-6){Toast.err('Kết quả QC không hợp lệ','Số đạt + số lỗi phải bằng số lượng nhận.');return;}r.goodQty=good;r.defectQty=bad;r.qcNote=$('#subQcNote')?.value?.trim()||'';r.qcStatus='DONE';r.qcAt=new Date().toISOString();r.qcBy=DB.currentUser?.id||'';o.goodQty=subcontractV3Receipts(o).reduce((s,x)=>s+Number(x.goodQty||0),0);o.defectQty=subcontractV3Receipts(o).reduce((s,x)=>s+Number(x.defectQty||0),0);subcontractV3RecalcStatus(o);subcontractPersist();Modal.close();render();Toast.ok('Đã kiểm tra chất lượng',`${r.id} · đạt ${fmtDec(good,2)} · lỗi ${fmtDec(bad,2)}. Kết quả đã chuyển sang Kho → Nhập kho → Kho thành phẩm.`);}

function openSubcontractingWarehouseModal(id,receiptId=''){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o)return;
  const r=subcontractV3Receipts(o).find(x=>x.id===receiptId)||(subcontractV3Receipts(o).find(x=>x.qcStatus==='DONE'&&!x.warehoused));
  if(!r){Toast.info('Không có lô chờ nhập kho',id);return;}
  const product=Q.product(o.productId)||{};
  const mfgDate=r.mfgDate||r.date||subcontractToday();
  const shelfLifeDays=Math.max(0,Number(product.shelfLifeDays||0));
  const expiryDate=shelfLifeDays>0?addDays(mfgDate,shelfLifeDays):'';
  const finished=(DB.warehouses||[]).filter(w=>w.type==='FINISHED_GOODS'&&w.status!=='inactive');
  const defect=(DB.warehouses||[]).find(w=>w.type==='DEFECTIVE'&&w.status!=='inactive');
  const first=finished[0];const locs=first?Q.locationsOf(first.id).filter(l=>l.status!=='inactive'):[];
  Modal.open({title:`Nhập kho hàng gia công · ${r.id}`,sub:`${o.id} · ${esc(product.name||o.productId)}`,size:'lg',body:`
    <div class="info-grid">${infoItem('QC đạt',`${fmtDec(r.goodQty,2)} ${esc(product.unit||'')}`)}${infoItem('QC lỗi',`${fmtDec(r.defectQty,2)} ${esc(product.unit||'')}`)}${infoItem('Hàng lỗi',esc(defect?.name||'Chưa cấu hình Kho Hàng lỗi'))}</div>
    <div class="form-grid cols-2" style="margin-top:14px">
      <div class="field"><label>Kho thành phẩm nhận hàng đạt *</label><select class="inp" id="subWarehouseGoodWh">${finished.map(w=>`<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Vị trí/kệ nhận *</label><select class="inp" id="subWarehouseGoodLoc">${locs.map(l=>`<option value="${esc(l.id)}">${esc(l.name)} · ${esc(l.code)}</option>`).join('')}</select></div>
      <div class="field"><label>Số lô từ đối tác *</label><input class="inp" id="subWarehouseLotNumber" value="${esc(r.lotNumber||'')}" placeholder="Nhập đúng số lô trên hàng/chứng từ đối tác"></div>
      <div class="field"><label>Ngày sản xuất / hoàn thành *</label><input class="inp" id="subWarehouseMfgDate" type="date" value="${esc(mfgDate)}"></div>
      <div class="field"><label>Hạn sử dụng theo quy định thành phẩm</label><input class="inp" value="${expiryDate?esc(fmtDate(expiryDate)):'Chưa quy định số ngày HSD'}" disabled></div>
      <div class="field"><label>Quy định HSD</label><input class="inp" value="${shelfLifeDays>0?`${shelfLifeDays} ngày từ ngày sản xuất`:'Chưa khai báo'}" disabled></div>
    </div>
    <div class="note-box" style="margin-top:12px"><b>Quy tắc lô:</b> hàng từ gia công không tự sinh số lô. Kho phải nhập số lô thực tế từ đối tác. HSD được hệ thống tính từ ngày sản xuất theo quy định của master Thành phẩm.</div>
    <div class="note-box" style="margin-top:8px">Hàng đạt vào <b>Kho thành phẩm được chọn ở trên</b>; hàng lỗi vào <b>Kho Hàng lỗi</b>, không tính vào tồn bán được.</div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-warehouse-confirm" data-id="${esc(id)}" data-receipt="${esc(r.id)}"><i class="fa-solid fa-warehouse"></i>Xác nhận nhập kho</button>`});
  const whSel=document.querySelector('#subWarehouseGoodWh'),locSel=document.querySelector('#subWarehouseGoodLoc');
  const fill=()=>{const ls=Q.locationsOf(whSel?.value||'').filter(l=>l.status!=='inactive');if(locSel)locSel.innerHTML=ls.map(l=>`<option value="${esc(l.id)}">${esc(l.name)} · ${esc(l.code)}</option>`).join('');};
  whSel?.addEventListener('change',fill);
}

function subcontractingWarehouseConfirm(id,receiptId){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o)return;
  const r=subcontractV3Receipts(o).find(x=>x.id===receiptId);if(!r||r.qcStatus!=='DONE'||r.warehoused)return;
  const today=subcontractToday(),product=Q.product(o.productId)||{},receiptIdDoc=nextCode('PNGC-2026-',DB.goodsReceipts||[]),items=[];
  const lotNumber=String($('#subWarehouseLotNumber')?.value||'').trim();
  const mfgDate=$('#subWarehouseMfgDate')?.value||'';
  const shelfLifeDays=Math.max(0,Number(product.shelfLifeDays||0));
  if(!lotNumber){Toast.err('Thiếu số lô','Hàng gia công phải nhập số lô thực tế từ đối tác; hệ thống không tự sinh lô.');return;}
  if(!mfgDate){Toast.err('Thiếu ngày sản xuất','Vui lòng nhập ngày sản xuất / hoàn thành từ đối tác.');return;}
  if(mfgDate>today){Toast.err('Ngày sản xuất không hợp lệ','Ngày sản xuất / hoàn thành không được lớn hơn ngày hiện tại.');return;}
  const expiryDate=shelfLifeDays>0?addDays(mfgDate,shelfLifeDays):'';
  let lot=(DB.inventoryLots||[]).find(x=>x.productId===o.productId&&String(x.lotNumber||'').trim().toLowerCase()===lotNumber.toLowerCase());
  if(lot && String(lot.subcontractingOrderId||'')!==String(o.id)){
    Toast.err('Số lô đã tồn tại',`${lotNumber} đã thuộc nguồn khác. Vui lòng kiểm tra số lô đối tác.`);return;
  }
  if(!lot){
    lot={id:nextCode('LOT-',DB.inventoryLots||[]),lotNumber,productId:o.productId,productionOrderId:'',mfgDate,expiryDate,supplierLot:lotNumber,supplierId:'',qcStatus:Number(r.defectQty||0)>0?(Number(r.goodQty||0)>0?'PARTIAL_FAILED':'FAILED'):'PASSED',status:'active',createdAt:`${today} 09:00`,subcontractingOrderId:o.id,subcontractingReceiptId:r.id};
    (DB.inventoryLots||(DB.inventoryLots=[])).unshift(lot);
  }
  function post(qty,warehouseId,locationId,qc){
    if(Number(qty||0)<=0)return;
    const result=InventoryService.apply({productId:o.productId,warehouseId,locationId,lotId:lot.id,quantity:Number(qty),type:'PRODUCTION_RECEIPT',refType:'SUBCONTRACTING',refId:receiptIdDoc,note:`Nhập hàng gia công ${o.id} · ${r.id}`,updateMaterial:false});
    if(!result.ok)throw new Error(result.message);
    items.push({materialId:o.productId,name:product.name||o.productId,unit:product.unit||'',qty:Number(qty),lotId:lot.id,lotNumber,locationId,qcStatus:qc,mfgDate,expiryDate});
  }
  const goodWhId=document.querySelector('#subWarehouseGoodWh')?.value||'';const goodLocId=document.querySelector('#subWarehouseGoodLoc')?.value||'';
  const goodWh=(DB.warehouses||[]).find(w=>w.id===goodWhId&&w.type==='FINISHED_GOODS'&&w.status!=='inactive');const goodLoc=(DB.warehouseLocations||[]).find(l=>l.id===goodLocId&&l.warehouseId===goodWhId&&l.status!=='inactive');
  if(Number(r.goodQty||0)>0&&(!goodWh||!goodLoc)){Toast.err('Thiếu kho thành phẩm','Hãy chọn Kho thành phẩm và vị trí nhận hàng đạt.');return;}
  const defectWh=(DB.warehouses||[]).find(w=>w.type==='DEFECTIVE'&&w.status!=='inactive');const defectLoc=(DB.warehouseLocations||[]).find(l=>l.warehouseId===defectWh?.id&&l.status!=='inactive');
  if(Number(r.defectQty||0)>0&&(!defectWh||!defectLoc)){Toast.err('Thiếu Kho Hàng lỗi','Cần cấu hình Kho Hàng lỗi và vị trí lưu.');return;}
  try{post(r.goodQty,goodWhId,goodLocId,'PASSED');post(r.defectQty,defectWh?.id||'',defectLoc?.id||'','FAILED');}catch(err){Toast.err('Không thể nhập kho',err.message);return;}
  (DB.goodsReceipts||(DB.goodsReceipts=[])).unshift({id:receiptIdDoc,poId:'',prId:'',date:today,receivedBy:DB.currentUser?.id||'',warehouse:'Gia công',warehouseId:goodWhId,locationId:goodLocId,status:'RECEIVED',note:`Nhập kho sau QC từ ${o.partner} · ${o.id} · ${r.id}`,sourceType:'SUBCONTRACTING',refDoc:o.id,sourceReceiptId:r.id,items});
  r.lotNumber=lotNumber;r.lotId=lot.id;r.mfgDate=mfgDate;r.expiryDate=expiryDate;r.warehoused=true;r.warehouseAt=new Date().toISOString();r.warehouseBy=DB.currentUser?.id||'';r.goodsReceiptId=receiptIdDoc;
  o.storedGoodQty=subcontractV3Receipts(o).filter(x=>x.warehoused).reduce((s,x)=>s+Number(x.goodQty||0),0);o.storedDefectQty=subcontractV3Receipts(o).filter(x=>x.warehoused).reduce((s,x)=>s+Number(x.defectQty||0),0);o.lastReceiptId=receiptIdDoc;subcontractV3RecalcStatus(o);subcontractPersist();subcontractSyncInventory();Modal.close();render();Toast.ok('Đã nhập kho hàng gia công',`${receiptIdDoc} · lô ${lotNumber} · đạt ${fmtDec(r.goodQty,2)} · lỗi ${fmtDec(r.defectQty,2)}`);
}

function openSubcontractingReconcileModal(id){const o=subcontractV3Orders().find(x=>x.id===id);if(!o||o.status!=='COMPLETED'){Toast.warn('Chưa thể đối chiếu','Chỉ đối chiếu công nợ sau khi nhận, QC và nhập kho hoàn tất.');return;}const expected=Number(o.goodQty||0)*Number(o.unitCost||0);Modal.open({title:`Đối chiếu công nợ · ${o.id}`,sub:`${esc(o.partner)} · nghiệm thu ${fmtDec(o.goodQty,2)} ${esc(Q.product(o.productId)?.unit||'')}`,size:'md',body:`<div class="info-grid">${infoItem('SL QC đạt',fmtDec(o.goodQty,2))}${infoItem('Đơn giá',fmtVND(o.unitCost||0))}${infoItem('Giá trị theo hệ thống',fmtVND(expected))}</div><div class="field" style="margin-top:14px"><label>Giá trị đối chiếu *</label><input class="inp right num" id="subReconcileAmount" data-money="1" type="text" inputmode="numeric" min="0" value="${Number(o.reconciledAmount??expected)}"></div><div class="field"><label>Ghi chú đối chiếu</label><textarea class="inp" id="subReconcileNote" rows="3">${esc(o.reconcileNote||'')}</textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-reconcile-confirm" data-id="${esc(id)}"><i class="fa-solid fa-scale-balanced"></i>Xác nhận đối chiếu</button>`});}
function subcontractingReconcileConfirm(id){const o=subcontractV3Orders().find(x=>x.id===id);if(!o||o.status!=='COMPLETED')return;const amount=parseMoney($('#subReconcileAmount')?.value||0);if(amount<0){Toast.err('Giá trị không hợp lệ','Giá trị đối chiếu không được âm.');return;}o.reconciledAmount=amount;o.reconciledAt=new Date().toISOString();o.reconciledBy=DB.currentUser?.id||'';o.reconcileNote=$('#subReconcileNote')?.value?.trim()||'';subcontractPersist();Modal.close();render();Toast.ok('Đã đối chiếu công nợ',`${id} · ${fmtVND(amount)}`);}

function openSubcontractingDetail(id){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o)return;const p=subcontractProduct(o),bom=subcontractBomLines(o),wasteRows=subcontractV3WasteRows(o),receipts=subcontractV3Receipts(o),amount=subcontractOrderAmount(o),debt=subcontractDebt(o);
  const mats=bom.map(x=>`<tr><td><span class="code">${esc(x.materialId)}</span></td><td>${esc(Q.material(x.materialId)?.name||x.materialId)}</td><td class="right num">${fmtDec(x.qty,3)} ${esc(Q.material(x.materialId)?.unit||'')}</td><td class="right num">${fmtDec(subcontractAvailable(x.materialId),3)}</td></tr>`).join('');
  const waste=wasteRows.map(x=>`<tr><td>${esc(Q.material(x.materialId)?.name||x.materialId)}</td><td class="right num">${fmtDec(x.issued,3)} ${esc(x.unit)}</td><td class="right num">${fmtDec(x.standard,3)}</td><td class="right num">${fmtDec(x.waste,3)}</td><td class="right num">${fmtDec(x.pct,2)}%</td></tr>`).join('');
  const receiptRows=receipts.map(r=>`<tr><td><span class="code">${esc(r.id)}</span></td><td>${fmtDate(r.date)}</td><td class="right num">${fmtDec(r.qty,2)}</td><td>${r.qcStatus==='DONE'?'<span class="badge green">Đã QC</span>':'<span class="badge orange">Chờ QC</span>'}</td><td class="right num">${r.qcStatus==='DONE'?fmtDec(r.goodQty,2):'—'}</td><td class="right num">${r.qcStatus==='DONE'?fmtDec(r.defectQty,2):'—'}</td><td>${r.warehoused?`<span class="code">${esc(r.goodsReceiptId||'Đã nhập')}</span>`:'—'}</td></tr>`).join('');
  Modal.open({title:`Kế hoạch gia công · ${o.id}`,sub:`${esc(o.partner)} · ${esc(p?.name||o.productId)}`,size:'xl',body:`<div class="info-grid" style="margin-bottom:14px">${infoItem('Trạng thái',subcontractV3StatusHtml(o.status))}${infoItem('Số lượng kế hoạch',`${fmtDec(o.plannedQty,2)} ${esc(p?.unit||o.unit||'')}`)}${infoItem('Hạn hoàn thành',fmtDate(o.dueDate))}${infoItem('Tiến độ',`${Number(o.partnerProgress||0)}%`)}${infoItem('Đã nhận',fmtDec(o.receivedQty,2))}${infoItem('QC đạt / lỗi',`${fmtDec(o.goodQty,2)} / ${fmtDec(o.defectQty,2)}`)}${infoItem('Tỷ lệ lỗi',`${fmtDec(subcontractV3DefectRate(o),2)}%`)}${infoItem('Hao hụt NVL TB',`${fmtDec(subcontractV3WasteRate(o),2)}%`)}${infoItem('Chi phí gia công',fmtVND(amount))}${infoItem('Công nợ còn lại',fmtVND(debt))}</div>
  <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>Nguyên liệu giao gia công</div>${tableShell([{t:'Mã'},{t:'Nguyên liệu'},{t:'Cần giao',cls:'right'},{t:'Tồn khả dụng',cls:'right'}],mats,{emptyTitle:'Sản phẩm chưa có BOM'})}
  <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-chart-pie"></i>Kiểm soát hao hụt</div>${tableShell([{t:'Nguyên liệu'},{t:'Đã giao',cls:'right'},{t:'Định mức theo SL nhận',cls:'right'},{t:'Hao hụt',cls:'right'},{t:'Tỷ lệ',cls:'right'}],waste,{emptyTitle:'Chưa đủ dữ liệu để tính hao hụt'})}
  <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-box-open"></i>Các đợt nhận hàng / QC / nhập kho</div>${tableShell([{t:'Đợt nhận'},{t:'Ngày'},{t:'SL nhận',cls:'right'},{t:'QC'},{t:'Đạt',cls:'right'},{t:'Lỗi',cls:'right'},{t:'Phiếu nhập'}],receiptRows,{emptyTitle:'Chưa nhận hàng'})}
  <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-clock-rotate-left"></i>Truy vết quy trình</div><div class="info-grid">${infoItem('Duyệt kế hoạch',o.approvedAt?fmtDate(String(o.approvedAt).slice(0,10)):'—')}${infoItem('Xuất NVL',o.issueId?`${esc(o.issueId)} · ${fmtDate(o.actualIssueDate)}`:'—')}${infoItem('Giao đối tác',o.handoverAt?fmtDate(String(o.handoverAt).slice(0,10)):'—')}${infoItem('Đã thanh toán gia công',fmtVND(o.paid||0))}</div>${o.note?`<div class="note-box" style="margin-top:14px"><b>Yêu cầu:</b> ${esc(o.note)}</div>`:''}`,
  foot:`<button class="btn" data-act="modal-close">Đóng</button>${o.status==='DRAFT'?`<button class="btn" data-act="subcontracting-edit" data-id="${esc(o.id)}"><i class="fa-solid fa-pen"></i>Sửa</button><button class="btn btn-primary" data-act="subcontracting-approve" data-id="${esc(o.id)}"><i class="fa-solid fa-check"></i>Duyệt</button>`:''}${['HANDED_OVER','IN_PROGRESS'].includes(o.status)?`<button class="btn" data-act="subcontracting-progress-update" data-id="${esc(o.id)}"><i class="fa-solid fa-chart-line"></i>Cập nhật tiến độ</button><button class="btn btn-primary" data-act="subcontracting-receive" data-id="${esc(o.id)}"><i class="fa-solid fa-box-open"></i>Nhận hàng</button>`:''}${receipts.some(r=>r.qcStatus!=='DONE')&&typeof Auth!=='undefined'&&Auth.canAccess('quality','subcontracting_qc')?`<button class="btn btn-primary" data-act="subcontracting-go-qc"><i class="fa-solid fa-shield-halved"></i>Đi đến Kiểm tra gia công</button>`:''}${receipts.some(r=>r.qcStatus==='DONE'&&!r.warehoused)&&typeof Auth!=='undefined'&&Auth.canAccess('warehouse','receipts')?`<button class="btn btn-primary" data-act="subcontracting-go-warehouse"><i class="fa-solid fa-warehouse"></i>Đi đến Kho nhập thành phẩm</button>`:''}${o.status==='COMPLETED'&&debt>0?`<button class="btn btn-primary" data-act="subcontracting-pay" data-id="${esc(o.id)}"><i class="fa-solid fa-money-bill-transfer"></i>Thanh toán gia công</button>`:''}`});
}

Views['subcontracting-overview']=function(){
  const os=subcontractV3Orders();
  const active=os.filter(o=>!['DRAFT','COMPLETED','CANCELLED'].includes(o.status));
  const waitingIssue=os.filter(o=>['APPROVED','MATERIAL_ISSUED'].includes(o.status)).length;
  const inProgress=os.filter(o=>['HANDED_OVER','IN_PROGRESS','PARTIAL_RECEIVED','RECEIVED_PENDING_QC','QC_COMPLETED'].includes(o.status)).length;
  const rows=os.map(o=>{
    const acts=[{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'}];
    if(o.status==='DRAFT') acts.push(
      {act:'subcontracting-edit',data:`data-id="${esc(o.id)}"`,icon:'fa-pen',title:'Sửa'},
      {act:'subcontracting-approve',data:`data-id="${esc(o.id)}"`,icon:'fa-check',title:'Duyệt'},
      {act:'subcontracting-delete',data:`data-id="${esc(o.id)}"`,icon:'fa-trash',title:'Xóa'}
    );
    return `<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(o.plannedQty,2)}</td><td>${fmtDate(o.issueDate)}</td><td>${fmtDate(o.dueDate)}</td><td>${subcontractV3StatusHtml(o.status)}</td><td class="right">${rowActions(acts)}</td></tr>`;
  }).join('');
  return `${pageHead('Đơn gia công','Tạo và duyệt đơn gia công. Sau khi duyệt, yêu cầu xuất NVL tự chuyển sang Kho → Xuất kho → Kho nguyên liệu.',`<button class="btn btn-primary" data-act="subcontracting-new"><i class="fa-solid fa-plus"></i>Tạo đơn gia công</button>`)}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng đơn',os.length,'fa-clipboard-list','blue')}
      ${mkpi('Chờ xuất / giao NVL',waitingIssue,'fa-truck-ramp-box','orange')}
      ${mkpi('Đang gia công',inProgress,'fa-gears','teal')}
      ${mkpi('Hoàn thành',os.filter(o=>o.status==='COMPLETED').length,'fa-circle-check','green')}
      ${mkpi('Công nợ',fmtVND(os.reduce((a,o)=>a+subcontractDebt(o),0)),'fa-file-invoice-dollar','red')}
    </div>
    <div class="card"><div class="card-head"><div><h3>Danh sách đơn gia công</h3><p>Duyệt tại đây; Kho chịu trách nhiệm xuất NVL và giao đối tác.</p></div></div>${tableShell([{t:'Mã đơn'},{t:'Đối tác'},{t:'Thành phẩm'},{t:'SL kế hoạch',cls:'right'},{t:'Ngày giao NVL'},{t:'Hạn hoàn thành'},{t:'Trạng thái'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có đơn gia công'})}</div>`;
};
Views['subcontracting-orders']=function(){const rows=subcontractV3Orders().map(o=>{const acts=[{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'}];if(o.status==='DRAFT')acts.push({act:'subcontracting-edit',data:`data-id="${esc(o.id)}"`,icon:'fa-pen',title:'Sửa'},{act:'subcontracting-approve',data:`data-id="${esc(o.id)}"`,icon:'fa-check',title:'Duyệt'},{act:'subcontracting-delete',data:`data-id="${esc(o.id)}"`,icon:'fa-trash',title:'Xóa'});return `<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(o.plannedQty,2)}</td><td>${fmtDate(o.issueDate)}</td><td>${fmtDate(o.dueDate)}</td><td>${subcontractV3StatusHtml(o.status)}</td><td class="right">${rowActions(acts)}</td></tr>`}).join('');return `${pageHead('Kế hoạch gia công','Nhận, duyệt và kiểm soát kế hoạch trước khi giao nguyên liệu cho đối tác',`<button class="btn btn-primary" data-act="subcontracting-new"><i class="fa-solid fa-plus"></i>Tạo kế hoạch gia công</button>`)}<div class="card">${tableShell([{t:'Mã kế hoạch'},{t:'Đối tác'},{t:'Sản phẩm'},{t:'SL kế hoạch',cls:'right'},{t:'Ngày giao NVL'},{t:'Hạn hoàn thành'},{t:'Trạng thái'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch gia công'})}</div>`;};
Views['subcontracting-issue']=function(){const list=subcontractV3Orders().filter(o=>o.status!=='DRAFT');const rows=list.map(o=>`<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${subcontractBomLines(o).length}</td><td>${o.issueId?`<span class="code">${esc(o.issueId)}</span>`:'—'}</td><td>${o.actualIssueDate?fmtDate(o.actualIssueDate):'—'}</td><td>${o.issueId?'<span class="badge green">Đã xuất</span>':'<span class="badge orange">Chờ xuất</span>'}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},...(o.status==='APPROVED'?[{act:'subcontracting-issue',data:`data-id="${esc(o.id)}"`,icon:'fa-arrow-right-from-bracket',title:'Xuất NVL'}]:[])])}</td></tr>`).join('');return `${pageHead('Xuất nguyên liệu gia công','Kiểm soát nguyên liệu giao gia công theo BOM và tồn kho thực tế')}<div class="card">${tableShell([{t:'Kế hoạch'},{t:'Đối tác'},{t:'Sản phẩm'},{t:'Số NVL',cls:'right'},{t:'Phiếu xuất'},{t:'Ngày xuất'},{t:'Tình trạng'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch đã duyệt'})}</div>`;};
Views['subcontracting-handover']=function(){const list=subcontractV3Orders().filter(o=>o.issueId);const rows=list.map(o=>`<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td><span class="code">${esc(o.issueId||'—')}</span></td><td>${fmtDate(o.actualIssueDate||o.issueDate)}</td><td>${o.handoverAt?fmtDate(String(o.handoverAt).slice(0,10)):'—'}</td><td>${o.handoverAt?'<span class="badge green">Đã giao</span>':'<span class="badge orange">Chờ giao</span>'}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},...(o.status==='MATERIAL_ISSUED'?[{act:'subcontracting-handover',data:`data-id="${esc(o.id)}"`,icon:'fa-handshake',title:'Giao đối tác'}]:[])])}</td></tr>`).join('');return `${pageHead('Giao đối tác','Xác nhận bàn giao nguyên liệu và chứng từ cho đơn vị gia công')}<div class="card">${tableShell([{t:'Kế hoạch'},{t:'Đối tác'},{t:'Phiếu xuất NVL'},{t:'Ngày xuất'},{t:'Ngày giao đối tác'},{t:'Tình trạng'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có nguyên liệu chờ giao đối tác'})}</div>`;};
Views['subcontracting-progress']=function(){
  const os=subcontractV3Orders().filter(o=>['HANDED_OVER','IN_PROGRESS','PARTIAL_RECEIVED','RECEIVED_PENDING_QC','QC_COMPLETED','COMPLETED'].includes(o.status));
  const rows=os.map(o=>{
    const pct=Math.max(0,Math.min(100,Number(o.partnerProgress||0)));
    const acts=[{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'}];
    if(['HANDED_OVER','IN_PROGRESS'].includes(o.status)) acts.push({act:'subcontracting-progress-update',data:`data-id="${esc(o.id)}"`,icon:'fa-chart-line',title:'Cập nhật tiến độ'});
    if(['HANDED_OVER','IN_PROGRESS','PARTIAL_RECEIVED'].includes(o.status) && pct>=100) acts.push({act:'subcontracting-receive',data:`data-id="${esc(o.id)}"`,icon:'fa-box-open',title:'Ghi nhận hàng hoàn thành'});
    return `<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td style="min-width:180px"><div class="progress"><span style="width:${pct}%"></span></div><div class="cell-sub">${fmtDec(pct,0)}%</div></td><td>${fmtDate(o.dueDate)}</td><td>${subcontractV3StatusHtml(o.status)}</td><td class="right">${rowActions(acts)}</td></tr>`;
  }).join('');
  return `${pageHead('Theo dõi tiến độ','Sau khi Kho xuất NVL và giao đối tác, theo dõi tiến độ tại đây. Khi đạt 100%, ghi nhận hàng hoàn thành để chuyển QC/QA.', '')}<div class="card">${tableShell([{t:'Đơn GC'},{t:'Đối tác'},{t:'Thành phẩm'},{t:'Tiến độ'},{t:'Hạn hoàn thành'},{t:'Trạng thái'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có đơn đã giao đối tác'})}</div>`;
};
Views['subcontracting-receive']=function(){const list=subcontractV3Orders().filter(o=>o.handoverAt);const rows=list.map(o=>{const remain=Math.max(0,Number(o.plannedQty||0)-Number(o.receivedQty||0));return `<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(o.plannedQty,2)}</td><td class="right num">${fmtDec(o.receivedQty,2)}</td><td class="right num strong">${fmtDec(remain,2)}</td><td>${subcontractV3StatusHtml(o.status)}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},...(remain>0&&['HANDED_OVER','IN_PROGRESS','PARTIAL_RECEIVED'].includes(o.status)?[{act:'subcontracting-receive',data:`data-id="${esc(o.id)}"`,icon:'fa-box-open',title:'Nhận hàng hoàn thành'}]:[])])}</td></tr>`}).join('');return `${pageHead('Nhận hàng hoàn thành','Ghi nhận hàng đối tác giao về; chưa cộng tồn trước khi QC')}<div class="card">${tableShell([{t:'Kế hoạch'},{t:'Đối tác'},{t:'Sản phẩm'},{t:'Kế hoạch',cls:'right'},{t:'Đã nhận',cls:'right'},{t:'Còn nhận',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch đã giao đối tác'})}</div>`;};
Views['subcontracting-qc']=function(){const data=[];subcontractV3Orders().forEach(o=>subcontractV3Receipts(o).forEach(r=>data.push({o,r})));const rows=data.map(({o,r})=>`<tr><td><span class="code">${esc(r.id)}</span><div class="cell-sub">${esc(o.id)}</div></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(r.qty,2)}</td><td>${r.qcStatus==='DONE'?'<span class="badge green">Đã kiểm</span>':'<span class="badge orange">Chờ kiểm</span>'}</td><td class="right num">${r.qcStatus==='DONE'?fmtDec(r.goodQty,2):'—'}</td><td class="right num">${r.qcStatus==='DONE'?fmtDec(r.defectQty,2):'—'}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem kế hoạch'},...(r.qcStatus!=='DONE'?[{act:'subcontracting-qc',data:`data-id="${esc(o.id)}" data-receipt="${esc(r.id)}"`,icon:'fa-clipboard-check',title:'Kiểm tra chất lượng'}]:[])])}</td></tr>`).join('');return `${pageHead('Kiểm tra chất lượng gia công','Tách riêng bước QC trước khi nhập kho')}<div class="card">${tableShell([{t:'Đợt nhận'},{t:'Đối tác'},{t:'Sản phẩm'},{t:'SL nhận',cls:'right'},{t:'QC'},{t:'Đạt',cls:'right'},{t:'Lỗi',cls:'right'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có hàng chờ kiểm tra'})}</div>`;};
Views['subcontracting-warehouse']=function(){const data=[];subcontractV3Orders().forEach(o=>subcontractV3Receipts(o).filter(r=>r.qcStatus==='DONE').forEach(r=>data.push({o,r})));const rows=data.map(({o,r})=>`<tr><td><span class="code">${esc(r.id)}</span><div class="cell-sub">${esc(o.id)}</div></td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(r.goodQty,2)}</td><td class="right num">${fmtDec(r.defectQty,2)}</td><td>${r.warehoused?`<span class="code">${esc(r.goodsReceiptId||'Đã nhập')}</span>`:'<span class="badge orange">Chờ nhập kho</span>'}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem kế hoạch'},...(!r.warehoused?[{act:'subcontracting-warehouse',data:`data-id="${esc(o.id)}" data-receipt="${esc(r.id)}"`,icon:'fa-warehouse',title:'Nhập kho'}]:[])])}</td></tr>`).join('');return `${pageHead('Nhập kho hàng gia công','Hàng đạt vào Kho thành phẩm; hàng lỗi vào Kho Hàng lỗi')}<div class="card">${tableShell([{t:'Đợt nhận / KH'},{t:'Sản phẩm'},{t:'Đạt',cls:'right'},{t:'Lỗi',cls:'right'},{t:'Phiếu nhập / trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có hàng đã QC'})}</div>`;};
Views['subcontracting-debt']=function(){const rows=subcontractV3Orders().filter(o=>o.status==='COMPLETED'||o.reconciledAt).map(o=>{const expected=Number(o.goodQty||0)*Number(o.unitCost||0),amount=subcontractOrderAmount(o),debt=subcontractDebt(o);return `<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td class="right num">${fmtDec(o.goodQty,2)}</td><td class="right num">${fmtVND(o.unitCost||0)}</td><td class="right num">${fmtVND(expected)}</td><td>${o.reconciledAt?'<span class="badge green">Đã đối chiếu</span>':'<span class="badge orange">Chờ đối chiếu</span>'}</td><td class="right num">${fmtVND(amount)}</td><td class="right num strong">${fmtVND(debt)}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},...(!o.reconciledAt?[{act:'subcontracting-reconcile',data:`data-id="${esc(o.id)}"`,icon:'fa-scale-balanced',title:'Đối chiếu'}]:[]),...(o.reconciledAt&&debt>0?[{act:'subcontracting-pay',data:`data-id="${esc(o.id)}"`,icon:'fa-money-bill-transfer',title:'Thanh toán'}]:[])])}</td></tr>`}).join('');return `${pageHead('Đối chiếu công nợ','Đối chiếu số lượng nghiệm thu, đơn giá, chi phí gia công và số tiền phải trả')}<div class="card">${tableShell([{t:'Kế hoạch'},{t:'Đối tác'},{t:'SL nghiệm thu',cls:'right'},{t:'Đơn giá',cls:'right'},{t:'Giá trị HT',cls:'right'},{t:'Đối chiếu'},{t:'Giá trị xác nhận',cls:'right'},{t:'Còn nợ',cls:'right'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch hoàn tất nhập kho'})}</div>`;};
Views['subcontracting-partners']=function(){subcontractHydrate();const rows=(DB.subcontractingPartners||[]).map(p=>{const m=subcontractV3PartnerMetrics(p);return `<tr><td><span class="code">${esc(p.id)}</span></td><td class="strong">${esc(p.name)}</td><td>${esc(p.contact||'—')}</td><td>${esc(p.phone||'—')}</td><td class="right num">${m.orders}</td><td class="right num">${fmtDec(m.defectRate,2)}%</td><td class="right num">${fmtDec(m.wasteRate,2)}%</td><td class="right num">${fmtVND(m.debt)}</td><td>${p.status==='inactive'?'<span class="badge slate">Ngừng hoạt động</span>':'<span class="badge green">Đang hoạt động</span>'}</td><td class="right">${rowActions([{act:'subcontracting-partner-detail',data:`data-id="${esc(p.id)}"`,icon:'fa-eye',title:'Xem chi tiết'},{act:'subcontracting-partner-edit',data:`data-id="${esc(p.id)}"`,icon:'fa-pen',title:'Sửa'},{act:'subcontracting-partner-delete',data:`data-id="${esc(p.id)}"`,icon:'fa-trash',title:'Xóa'}])}</td></tr>`}).join('');return `${pageHead('Đối tác gia công','Danh mục và chất lượng thực hiện của từng đơn vị gia công',`<button class="btn btn-primary" data-act="subcontracting-partner-new"><i class="fa-solid fa-plus"></i>Thêm đối tác</button>`)}<div class="card">${tableShell([{t:'Mã'},{t:'Đối tác'},{t:'Liên hệ'},{t:'Điện thoại'},{t:'Số KH',cls:'right'},{t:'Lỗi',cls:'right'},{t:'Hao hụt',cls:'right'},{t:'Công nợ',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có đối tác gia công'})}</div>`;};
Views['subcontracting-evaluation']=function(){subcontractHydrate();const rows=(DB.subcontractingPartners||[]).map(p=>{const m=subcontractV3PartnerMetrics(p);return `<tr><td class="strong">${esc(p.name)}</td><td class="right num">${m.orders}</td><td class="right num">${fmtDec(m.completion,1)}%</td><td class="right num">${fmtDec(m.onTime,1)}%</td><td class="right num">${fmtDec(m.defectRate,2)}%</td><td class="right num">${fmtDec(m.wasteRate,2)}%</td><td class="right num">${fmtVND(m.cost)}</td><td class="right num strong">${fmtDec(m.score,1)}/100</td><td class="right">${rowActions([{act:'subcontracting-partner-detail',data:`data-id="${esc(p.id)}"`,icon:'fa-eye',title:'Xem chi tiết'}])}</td></tr>`}).join('');return `${pageHead('Hiệu quả từng đối tác','Đánh giá theo chất lượng, hao hụt, đúng hạn và mức hoàn thành')}<div class="note-box" style="margin-bottom:14px"><b>Cách tính điểm hiệu quả (100 điểm):</b> Chất lượng (100 − tỷ lệ lỗi) × <b>45%</b> + Kiểm soát NVL (100 − tỷ lệ hao hụt) × <b>25%</b> + Đúng hạn × <b>20%</b> + Tỷ lệ hoàn thành kế hoạch × <b>10%</b>. Chi phí được theo dõi riêng để so sánh, chưa cộng vào điểm nhằm tránh thiên lệch do mỗi sản phẩm có đơn giá gia công khác nhau.</div><div class="card">${tableShell([{t:'Đối tác'},{t:'Số KH',cls:'right'},{t:'Hoàn thành',cls:'right'},{t:'Đúng hạn',cls:'right'},{t:'Tỷ lệ lỗi',cls:'right'},{t:'Hao hụt',cls:'right'},{t:'Chi phí',cls:'right'},{t:'Điểm hiệu quả',cls:'right'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có dữ liệu đánh giá'})}</div>`;};
Views['subcontracting-reports']=function(){const os=subcontractV3Orders(),received=os.reduce((s,o)=>s+Number(o.receivedQty||0),0),good=os.reduce((s,o)=>s+Number(o.goodQty||0),0),bad=os.reduce((s,o)=>s+Number(o.defectQty||0),0),cost=os.reduce((s,o)=>s+subcontractOrderAmount(o),0),debt=os.reduce((s,o)=>s+subcontractDebt(o),0),waste=os.length?os.reduce((s,o)=>s+subcontractV3WasteRate(o),0)/os.length:0;const rows=os.map(o=>`<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(o.plannedQty,2)}</td><td class="right num">${fmtDec(o.goodQty,2)}</td><td class="right num">${fmtDec(subcontractV3DefectRate(o),2)}%</td><td class="right num">${fmtDec(subcontractV3WasteRate(o),2)}%</td><td class="right num">${fmtVND(subcontractOrderAmount(o))}</td><td>${subcontractV3StatusHtml(o.status)}</td><td class="right">${rowActions([{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'}])}</td></tr>`).join('');return `${pageHead('Báo cáo gia công','Tổng hợp nguyên liệu, hao hụt, lỗi, chi phí, công nợ và chất lượng')}<div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Đã nhận',fmtDec(received,2),'fa-box-open','blue')}${mkpi('QC đạt',fmtDec(good,2),'fa-circle-check','green')}${mkpi('Tỷ lệ lỗi',`${received?fmtDec(bad/received*100,2):'0'}%`,'fa-triangle-exclamation','red')}${mkpi('Hao hụt TB',`${fmtDec(waste,2)}%`,'fa-arrow-trend-down','orange')}${mkpi('Chi phí gia công',fmtVND(cost),'fa-coins','indigo')}${mkpi('Công nợ',fmtVND(debt),'fa-file-invoice-dollar','red')}</div><div class="card">${tableShell([{t:'Kế hoạch'},{t:'Đối tác'},{t:'Sản phẩm'},{t:'SL KH',cls:'right'},{t:'QC đạt',cls:'right'},{t:'Lỗi',cls:'right'},{t:'Hao hụt',cls:'right'},{t:'Chi phí',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có dữ liệu gia công'})}</div>`;};

function openSubcontractingPartnerDetail(idOrName){
  const p=subcontractPartner(idOrName); if(!p)return;
  const m=subcontractV3PartnerMetrics(p),orders=subcontractV3Orders().filter(o=>o.partnerId===p.id||o.partner===p.name);
  const rows=orders.slice(0,10).map(o=>`<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td>${subcontractV3StatusHtml(o.status)}</td><td class="right num">${fmtDec(subcontractV3DefectRate(o),2)}%</td><td class="right num">${fmtDec(subcontractV3WasteRate(o),2)}%</td></tr>`).join('');
  const qualityScore=Math.max(0,100-Number(m.defectRate||0))*0.45;
  const materialScore=Math.max(0,100-Number(m.wasteRate||0))*0.25;
  const onTimeScore=Math.max(0,Math.min(100,Number(m.onTime||0)))*0.20;
  const completionScore=Math.max(0,Math.min(100,Number(m.completion||0)))*0.10;
  Modal.open({title:`Đối tác gia công · ${p.name}`,sub:p.id,size:'xl',body:`
    <div class="info-grid">${infoItem('Người liên hệ',esc(p.contact||'—'))}${infoItem('Điện thoại',esc(p.phone||'—'))}${infoItem('Số kế hoạch',m.orders)}${infoItem('Tỷ lệ hoàn thành',`${fmtDec(m.completion,1)}%`)}${infoItem('Tỷ lệ đúng hạn',`${fmtDec(m.onTime,1)}%`)}${infoItem('Tỷ lệ lỗi',`${fmtDec(m.defectRate,2)}%`)}${infoItem('Hao hụt nguyên liệu trung bình',`${fmtDec(m.wasteRate,2)}%`)}${infoItem('Tổng chi phí gia công',fmtVND(m.cost))}${infoItem('Công nợ còn lại',fmtVND(m.debt))}${infoItem('Điểm hiệu quả',`<b>${fmtDec(m.score,1)}/100</b>`)}</div>
    <div class="note-box" style="margin-top:14px"><b>Cách tính điểm hiệu quả:</b> Chất lượng (100 − tỷ lệ lỗi) × 45% + Kiểm soát nguyên liệu (100 − tỷ lệ hao hụt) × 25% + Tỷ lệ đúng hạn × 20% + Tỷ lệ hoàn thành kế hoạch × 10%.<div class="cell-sub" style="margin-top:6px">Điểm hiện tại: chất lượng ${fmtDec(qualityScore,1)} + nguyên liệu ${fmtDec(materialScore,1)} + đúng hạn ${fmtDec(onTimeScore,1)} + hoàn thành ${fmtDec(completionScore,1)} = <b>${fmtDec(m.score,1)}/100</b>. Chi phí được theo dõi riêng, không cộng trực tiếp vào điểm để tránh lệch giữa các sản phẩm có đơn giá gia công khác nhau.</div></div>
    <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-list"></i>Kế hoạch gần đây</div>${tableShell([{t:'Kế hoạch'},{t:'Sản phẩm'},{t:'Trạng thái'},{t:'Lỗi',cls:'right'},{t:'Hao hụt',cls:'right'}],rows,{emptyTitle:'Chưa phát sinh kế hoạch'})}
  `,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn" data-act="subcontracting-partner-edit" data-id="${esc(p.id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`});
}

/* Thanh toán gia công: công nợ phát sinh trực tiếp sau khi nghiệm thu/nhập kho hoàn tất. */
function openSubcontractingPaymentModal(id){const o=subcontractV3Orders().find(x=>x.id===id);if(!o)return;if(o.status!=='COMPLETED'){Toast.warn('Chưa phát sinh công nợ','Chỉ thanh toán sau khi kế hoạch gia công hoàn thành và hàng đạt đã nhập kho.');return;}const debt=subcontractDebt(o);if(debt<=0){Toast.info('Không còn công nợ',id);return;}Modal.open({title:`Thanh toán gia công · ${id}`,sub:`${esc(o.partner)} · còn phải trả ${fmtVND(debt)}`,size:'md',body:`<div class="info-grid" style="margin-bottom:12px">${infoItem('Giá trị gia công',fmtVND(subcontractOrderAmount(o)))}${infoItem('Đã thanh toán',fmtVND(o.paid||0))}${infoItem('Còn phải trả',`<b>${fmtVND(debt)}</b>`)}</div><div class="field"><label>Số tiền thanh toán *</label><input class="inp right num" id="subPayAmount" data-money="1" type="text" inputmode="numeric" min="1" max="${debt}" value="${debt}"></div><div class="field"><label>Ghi chú</label><textarea class="inp" id="subPayNote" rows="2"></textarea></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-pay-save" data-id="${esc(id)}">Ghi nhận thanh toán</button>`});}
function subcontractingSavePayment(id){const o=subcontractV3Orders().find(x=>x.id===id);if(!o||o.status!=='COMPLETED'){Toast.warn('Chưa phát sinh công nợ','Kế hoạch gia công chưa hoàn thành.');return;}const debt=subcontractDebt(o),amt=parseMoney($('#subPayAmount')?.value||0);if(amt<=0||amt>debt+1e-9){Toast.err('Số tiền không hợp lệ',`Số tiền phải từ 1 đến ${fmtVND(debt)}.`);return;}o.paid=Number(o.paid||0)+amt;(o.payments||(o.payments=[])).unshift({date:subcontractToday(),amount:amt,note:$('#subPayNote')?.value?.trim()||'',by:DB.currentUser?.id||''});subcontractPersist();Modal.close();render();Toast.ok('Đã ghi nhận thanh toán',`${id} · ${fmtVND(amt)}`);}


/* ========================================================================== 
 * UI33 — Gộp Dashboard vào Kế hoạch gia công; xuất NVL chỉ thực hiện tại Kho.
 * ======================================================================= */
Views.subcontracting = function () {
  const tab = State.tab || 'orders';
  const map = {
    orders:'subcontracting-orders', handover:'subcontracting-handover',
    progress:'subcontracting-progress', receive:'subcontracting-receive',
    qc:'subcontracting-qc', warehouse:'subcontracting-warehouse',
    debt:'subcontracting-debt', partners:'subcontracting-partners',
    evaluation:'subcontracting-partners', reports:'subcontracting-reports'
  };
  const key = map[tab] || 'subcontracting-orders';
  return Views[key] ? Views[key]() : '';
};

Views['subcontracting-orders'] = function () {
  subcontractHydrate();
  const orders = typeof subcontractV3Orders === 'function' ? subcontractV3Orders() : (DB.subcontractingOrders||[]);
  const processing = orders.filter(o=>['APPROVED','MATERIAL_ISSUED','HANDED_OVER','IN_PROGRESS','PARTIAL_RECEIVED','RECEIVED_PENDING_QC','QC_PASSED','WAREHOUSE_PENDING'].includes(o.status)).length;
  const completed = orders.filter(o=>o.status==='COMPLETED').length;
  const waitingIssue = orders.filter(o=>o.status==='APPROVED').length;
  const debt = orders.reduce((sum,o)=>sum+(typeof subcontractDebt==='function'?Number(subcontractDebt(o)||0):0),0);
  const rows=orders.map(o=>{
    const acts=[{act:'subcontracting-open',data:`data-id="${esc(o.id)}"`,icon:'fa-eye',title:'Xem chi tiết'}];
    if(o.status==='DRAFT') acts.push(
      {act:'subcontracting-edit',data:`data-id="${esc(o.id)}"`,icon:'fa-pen',title:'Sửa'},
      {act:'subcontracting-approve',data:`data-id="${esc(o.id)}"`,icon:'fa-check',title:'Duyệt'},
      {act:'subcontracting-delete',data:`data-id="${esc(o.id)}"`,icon:'fa-trash',title:'Xóa'}
    );
    return `<tr><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner||'—')}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(o.plannedQty,2)}</td><td>${fmtDate(o.issueDate)}</td><td>${fmtDate(o.dueDate)}</td><td>${subcontractV3StatusHtml(o.status)}</td><td class="right">${rowActions(acts)}</td></tr>`;
  }).join('');
  return `${pageHead('Kế hoạch gia công','Lập, duyệt và theo dõi kế hoạch gia công. Kế hoạch đã duyệt được chuyển sang Kho → Xuất kho → Kho nguyên liệu để xuất NVL.',`<button class="btn btn-primary" data-act="subcontracting-new"><i class="fa-solid fa-plus"></i>Tạo kế hoạch gia công</button>`)}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng kế hoạch',orders.length,'fa-list-check','blue')}
      ${mkpi('Chờ Kho xuất NVL',waitingIssue,'fa-boxes-stacked','orange')}
      ${mkpi('Đang xử lý',processing,'fa-spinner','indigo')}
      ${mkpi('Hoàn thành',completed,'fa-circle-check','green')}
      ${mkpi('Công nợ',fmtVND(debt),'fa-file-invoice-dollar','red')}
    </div>
    <div class="card"><div class="card-head"><div><h3>Danh sách kế hoạch gia công</h3><p>Dashboard và danh sách kế hoạch được quản lý chung trên một màn hình.</p></div></div>
      ${tableShell([{t:'Mã kế hoạch'},{t:'Đối tác'},{t:'Sản phẩm'},{t:'SL kế hoạch',cls:'right'},{t:'Ngày giao NVL'},{t:'Hạn hoàn thành'},{t:'Trạng thái'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch gia công'})}
    </div>`;
};


/* ========================================================================== 
 * UI34 — Kế hoạch gia công: click dòng xem chi tiết, CRUD trước duyệt,
 * giao đối tác và theo dõi tiến độ ngay trong chi tiết. Không đổi nghiệp vụ.
 * ======================================================================= */
Views.subcontracting = function () {
  const tab = State.tab || 'orders';
  // URL cũ của hai menu đã gộp vào chi tiết kế hoạch sẽ quay về Kế hoạch gia công.
  const normalized = ['handover','progress','qc','warehouse'].includes(tab) ? 'orders' : tab;
  const map = {
    orders:'subcontracting-orders', receive:'subcontracting-receive',
    qc:'subcontracting-qc', warehouse:'subcontracting-warehouse',
    debt:'subcontracting-debt', partners:'subcontracting-partners',
    evaluation:'subcontracting-partners', reports:'subcontracting-reports'
  };
  const key = map[normalized] || 'subcontracting-orders';
  return Views[key] ? Views[key]() : '';
};

Views['subcontracting-orders'] = function () {
  subcontractHydrate();
  const orders = typeof subcontractV3Orders === 'function' ? subcontractV3Orders() : (DB.subcontractingOrders||[]);
  const processing = orders.filter(o=>['APPROVED','MATERIAL_ISSUED','HANDED_OVER','IN_PROGRESS','PARTIAL_RECEIVED','RECEIVED_PENDING_QC','QC_COMPLETED'].includes(o.status)).length;
  const completed = orders.filter(o=>o.status==='COMPLETED').length;
  const waitingIssue = orders.filter(o=>o.status==='APPROVED').length;
  const waitingHandover = orders.filter(o=>o.status==='MATERIAL_ISSUED').length;
  const debt = orders.reduce((sum,o)=>sum+(typeof subcontractDebt==='function'?Number(subcontractDebt(o)||0):0),0);
  const rows=orders.map(o=>{
    const acts=[];
    if(o.status==='DRAFT') acts.push(
      {act:'subcontracting-edit',data:`data-id="${esc(o.id)}"`,icon:'fa-pen',title:'Sửa'},
      {act:'subcontracting-approve',data:`data-id="${esc(o.id)}"`,icon:'fa-check',title:'Duyệt'},
      {act:'subcontracting-delete',data:`data-id="${esc(o.id)}"`,icon:'fa-trash',title:'Xóa'}
    );
    if(o.status==='MATERIAL_ISSUED') acts.push({act:'subcontracting-handover',data:`data-id="${esc(o.id)}"`,icon:'fa-handshake',title:'Giao cho đối tác'});
    const pct=o.status==='COMPLETED'?100:Math.max(0,Math.min(100,Number(o.partnerProgress||0)));
    return `<tr class="clickable" data-act="subcontracting-open" data-id="${esc(o.id)}">
      <td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner||'—')}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td>
      <td class="right num">${fmtDec(o.plannedQty,2)}</td><td>${fmtDate(o.issueDate)}</td><td>${fmtDate(o.dueDate)}</td>
      <td style="min-width:140px">${progressBar(pct)}<div class="cell-sub">${pct}%</div></td><td>${subcontractV3StatusHtml(o.status)}</td>
      <td class="right">${acts.length?rowActions(acts):'<span class="muted">—</span>'}</td></tr>`;
  }).join('');
  return `${pageHead('Kế hoạch gia công','Lập, duyệt và theo dõi kế hoạch gia công. Click vào một dòng để mở chi tiết; tiến độ và giao đối tác được xử lý ngay trong kế hoạch.',`<button class="btn btn-primary" data-act="subcontracting-new"><i class="fa-solid fa-plus"></i>Tạo kế hoạch gia công</button>`)}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng kế hoạch',orders.length,'fa-list-check','blue')}
      ${mkpi('Chờ Kho xuất NVL',waitingIssue,'fa-boxes-stacked','orange')}
      ${mkpi('Chờ giao đối tác',waitingHandover,'fa-handshake','indigo')}
      ${mkpi('Đang xử lý',processing,'fa-spinner','teal')}
      ${mkpi('Hoàn thành',completed,'fa-circle-check','green')}
      ${mkpi('Công nợ',fmtVND(debt),'fa-file-invoice-dollar','red')}
    </div>
    <div class="card"><div class="card-head"><div><h3>Danh sách kế hoạch gia công</h3><p>Click trực tiếp vào dòng để xem BOM, phiếu xuất, giao đối tác, tiến độ, QC và nhập kho.</p></div></div>
      ${tableShell([{t:'Mã kế hoạch'},{t:'Đối tác'},{t:'Sản phẩm'},{t:'SL kế hoạch',cls:'right'},{t:'Ngày giao NVL'},{t:'Hạn hoàn thành'},{t:'Tiến độ'},{t:'Trạng thái'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch gia công'})}
    </div>`;
};

function openSubcontractingDetail(id){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o)return;
  const p=subcontractProduct(o),bom=subcontractBomLines(o),wasteRows=subcontractV3WasteRows(o),receipts=subcontractV3Receipts(o),amount=subcontractOrderAmount(o),debt=subcontractDebt(o);
  const pct=o.status==='COMPLETED'?100:Math.max(0,Math.min(100,Number(o.partnerProgress||0)));
  const mats=bom.map(x=>`<tr><td><span class="code">${esc(x.materialId)}</span></td><td>${esc(Q.material(x.materialId)?.name||x.materialId)}</td><td class="right num">${fmtDec(x.qty,3)} ${esc(Q.material(x.materialId)?.unit||'')}</td><td class="right num">${fmtDec(subcontractAvailable(x.materialId),3)}</td></tr>`).join('');
  const waste=wasteRows.map(x=>`<tr><td>${esc(Q.material(x.materialId)?.name||x.materialId)}</td><td class="right num">${fmtDec(x.issued,3)} ${esc(x.unit)}</td><td class="right num">${fmtDec(x.standard,3)}</td><td class="right num">${fmtDec(x.waste,3)}</td><td class="right num">${fmtDec(x.pct,2)}%</td></tr>`).join('');
  const receiptRows=receipts.map(r=>`<tr><td><span class="code">${esc(r.id)}</span></td><td>${fmtDate(r.date)}</td><td class="right num">${fmtDec(r.qty,2)}</td><td>${r.qcStatus==='DONE'?'<span class="badge green">Đã QC</span>':'<span class="badge orange">Chờ QC</span>'}</td><td class="right num">${r.qcStatus==='DONE'?fmtDec(r.goodQty,2):'—'}</td><td class="right num">${r.qcStatus==='DONE'?fmtDec(r.defectQty,2):'—'}</td><td>${r.warehoused?`<span class="code">${esc(r.goodsReceiptId||'Đã nhập')}</span>`:'—'}</td></tr>`).join('');
  const canProgress=['HANDED_OVER','IN_PROGRESS'].includes(o.status);
  Modal.open({title:`Kế hoạch gia công · ${o.id}`,sub:`${esc(o.partner)} · ${esc(p?.name||o.productId)}`,size:'xl',body:`
    <div class="info-grid" style="margin-bottom:14px">${infoItem('Trạng thái',subcontractV3StatusHtml(o.status))}${infoItem('Số lượng kế hoạch',`${fmtDec(o.plannedQty,2)} ${esc(p?.unit||o.unit||'')}`)}${infoItem('Hạn hoàn thành',fmtDate(o.dueDate))}${infoItem('Đã nhận',fmtDec(o.receivedQty,2))}${infoItem('QC đạt / lỗi',`${fmtDec(o.goodQty,2)} / ${fmtDec(o.defectQty,2)}`)}${infoItem('Tỷ lệ lỗi',`${fmtDec(subcontractV3DefectRate(o),2)}%`)}${infoItem('Hao hụt NVL TB',`${fmtDec(subcontractV3WasteRate(o),2)}%`)}${infoItem('Chi phí gia công',fmtVND(amount))}${infoItem('Công nợ còn lại',fmtVND(debt))}</div>
    <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3><i class="fa-solid fa-chart-line"></i> Theo dõi tiến độ đối tác</h3><p>Tiến độ được quản lý ngay trong chi tiết kế hoạch, không tách thành menu riêng.</p></div>${canProgress?`<button class="btn btn-sm btn-primary" data-act="subcontracting-progress-update" data-id="${esc(o.id)}"><i class="fa-solid fa-pen"></i>Cập nhật tiến độ</button>`:''}</div><div style="padding:0 16px 16px"><div style="margin-bottom:8px">${progressBar(pct)}</div><div class="info-grid">${infoItem('Tiến độ hiện tại',`<b>${pct}%</b>`)}${infoItem('Cập nhật gần nhất',o.progressUpdatedAt?fmtDate(String(o.progressUpdatedAt).slice(0,10)):'—')}${infoItem('Ghi chú tiến độ',esc(o.progressNote||'—'))}${infoItem('Ngày giao đối tác',o.handoverAt?fmtDate(String(o.handoverAt).slice(0,10)):'—')}</div></div></div>
    <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>Nguyên liệu giao gia công</div>${tableShell([{t:'Mã'},{t:'Nguyên liệu'},{t:'Cần giao',cls:'right'},{t:'Tồn khả dụng',cls:'right'}],mats,{emptyTitle:'Sản phẩm chưa có BOM'})}
    <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-chart-pie"></i>Kiểm soát hao hụt</div>${tableShell([{t:'Nguyên liệu'},{t:'Đã giao',cls:'right'},{t:'Định mức theo SL nhận',cls:'right'},{t:'Hao hụt',cls:'right'},{t:'Tỷ lệ',cls:'right'}],waste,{emptyTitle:'Chưa đủ dữ liệu để tính hao hụt'})}
    <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-box-open"></i>Các đợt nhận hàng / QC / nhập kho</div>${tableShell([{t:'Đợt nhận'},{t:'Ngày'},{t:'SL nhận',cls:'right'},{t:'QC'},{t:'Đạt',cls:'right'},{t:'Lỗi',cls:'right'},{t:'Phiếu nhập'}],receiptRows,{emptyTitle:'Chưa nhận hàng'})}
    <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-clock-rotate-left"></i>Truy vết quy trình</div><div class="info-grid">${infoItem('Duyệt kế hoạch',o.approvedAt?fmtDate(String(o.approvedAt).slice(0,10)):'—')}${infoItem('Xuất NVL',o.issueId?`${esc(o.issueId)} · ${fmtDate(o.actualIssueDate)}`:'—')}${infoItem('Giao đối tác',o.handoverAt?fmtDate(String(o.handoverAt).slice(0,10)):'—')}${infoItem('Đã thanh toán gia công',fmtVND(o.paid||0))}</div>${o.note?`<div class="note-box" style="margin-top:14px"><b>Yêu cầu:</b> ${esc(o.note)}</div>`:''}`,
    foot:`<button class="btn" data-act="modal-close">Đóng</button>${o.status==='DRAFT'?`<button class="btn" data-act="subcontracting-delete" data-id="${esc(o.id)}"><i class="fa-solid fa-trash"></i>Xóa</button><button class="btn" data-act="subcontracting-edit" data-id="${esc(o.id)}"><i class="fa-solid fa-pen"></i>Sửa</button><button class="btn btn-primary" data-act="subcontracting-approve" data-id="${esc(o.id)}"><i class="fa-solid fa-check"></i>Duyệt</button>`:''}${o.status==='MATERIAL_ISSUED'?`<button class="btn btn-primary" data-act="subcontracting-handover" data-id="${esc(o.id)}"><i class="fa-solid fa-handshake"></i>Giao cho đối tác</button>`:''}${['HANDED_OVER','IN_PROGRESS'].includes(o.status)&&pct>=100?`<button class="btn btn-primary" data-act="subcontracting-receive" data-id="${esc(o.id)}"><i class="fa-solid fa-box-open"></i>Ghi nhận hàng hoàn thành</button>`:''}${receipts.some(r=>r.qcStatus!=='DONE')&&typeof Auth!=='undefined'&&Auth.canAccess('quality','subcontracting_qc')?`<button class="btn btn-primary" data-act="subcontracting-go-qc"><i class="fa-solid fa-shield-halved"></i>Đi đến Kiểm tra gia công</button>`:''}${receipts.some(r=>r.qcStatus==='DONE'&&!r.warehoused)&&typeof Auth!=='undefined'&&Auth.canAccess('warehouse','receipts')?`<button class="btn btn-primary" data-act="subcontracting-go-warehouse"><i class="fa-solid fa-warehouse"></i>Đi đến Kho nhập thành phẩm</button>`:''}${o.status==='COMPLETED'&&debt>0?`<button class="btn btn-primary" data-act="subcontracting-pay" data-id="${esc(o.id)}"><i class="fa-solid fa-money-bill-transfer"></i>Thanh toán gia công</button>`:''}`
  });
}

/* ========================================================================== 
 * UI36 — Gia công: Tổng quan riêng; Nhận hàng trong chi tiết kế hoạch;
 * đối chiếu công nợ theo sản lượng nghiệm thu thực tế. Báo cáo tạm ẩn.
 * ======================================================================= */
function subcontractV4AcceptedQty(o){
  return subcontractV3Receipts(o).filter(r=>r.qcStatus==='DONE'&&r.warehoused).reduce((s,r)=>s+Number(r.goodQty||0),0);
}
function subcontractV4ExpectedAmount(o){
  if(o?.status!=='COMPLETED') return 0;
  return Math.max(0, subcontractV4AcceptedQty(o) * Number(o?.unitCost||0));
}
function subcontractV4ReconciledAmount(o){
  // Công nợ gia công phát sinh trực tiếp theo số lượng QC đạt đã nhập kho × đơn giá.
  // Không bắt buộc thêm bước đối chiếu riêng.
  return subcontractV4ExpectedAmount(o);
}
function subcontractV4DebtStatus(o){
  const amount=subcontractV4ExpectedAmount(o), paid=Number(o?.paid||0), due=Math.max(0,amount-paid);
  if(amount<=1e-9) return '<span class="badge slate">Chưa phát sinh</span>';
  if(due<=1e-9) return '<span class="badge green">Đã thanh toán</span>';
  if(paid>0) return '<span class="badge blue">Thanh toán một phần</span>';
  return '<span class="badge orange">Chưa thanh toán</span>';
}
function subcontractOrderAmount(o){ return subcontractV4ExpectedAmount(o); }
function subcontractDebt(o){ return Math.max(0,subcontractV4ExpectedAmount(o)-Number(o?.paid||0)); }

Views.subcontracting = function () {
  let tab=State.tab||'dashboard';
  // Tương thích link cũ: Menu/Combo đã được gộp vào Menu / Công thức món.
  if(tab==='menu') tab='recipe';
  // Các route cũ đã gộp vào chi tiết kế hoạch.
  const normalized=['receive','handover','progress','qc','warehouse','reports','debt'].includes(tab)?'orders':tab;
  const map={dashboard:'subcontracting-overview',orders:'subcontracting-orders',partners:'subcontracting-partners',evaluation:'subcontracting-partners'};
  const key=map[normalized]||'subcontracting-overview';
  return Views[key]?Views[key]():'';
};

Views['subcontracting-overview']=function(){
  subcontractHydrate();
  const orders=subcontractV3Orders();
  const draft=orders.filter(o=>o.status==='DRAFT').length;
  const waitingIssue=orders.filter(o=>o.status==='APPROVED').length;
  const waitingHandover=orders.filter(o=>o.status==='MATERIAL_ISSUED').length;
  const processing=orders.filter(o=>['HANDED_OVER','IN_PROGRESS','PARTIAL_RECEIVED','RECEIVED_PENDING_QC','QC_COMPLETED'].includes(o.status)).length;
  const completed=orders.filter(o=>o.status==='COMPLETED').length;
  const waitingQc=orders.reduce((s,o)=>s+subcontractV3Receipts(o).filter(r=>r.qcStatus!=='DONE').length,0);
  const waitingWarehouse=orders.reduce((s,o)=>s+subcontractV3Receipts(o).filter(r=>r.qcStatus==='DONE'&&!r.warehoused).length,0);
  const debt=orders.reduce((s,o)=>s+subcontractDebt(o),0);
  const overdue=orders.filter(o=>o.dueDate&&o.dueDate<subcontractToday()&&!['COMPLETED','CANCELLED'].includes(o.status)).length;
  const recent=orders.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,8).map(o=>`<tr class="clickable" data-act="subcontracting-open" data-id="${esc(o.id)}"><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner||'—')}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(o.plannedQty,2)}</td><td>${fmtDate(o.dueDate)}</td><td>${subcontractV3StatusHtml(o.status)}</td></tr>`).join('');
  return `${pageHead('Tổng quan gia công','Theo dõi kế hoạch, tiến độ, QC, nhập kho và công nợ gia công',`<button class="btn btn-primary" data-act="subcontracting-new"><i class="fa-solid fa-plus"></i>Tạo kế hoạch gia công</button>`)}
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Tổng kế hoạch',orders.length,'fa-list-check','blue')}
      ${mkpi('Chờ duyệt',draft,'fa-clock','slate')}
      ${mkpi('Chờ Kho xuất NVL',waitingIssue,'fa-boxes-stacked','orange')}
      ${mkpi('Chờ giao đối tác',waitingHandover,'fa-handshake','indigo')}
      ${mkpi('Đang gia công',processing,'fa-gears','teal')}
      ${mkpi('Hoàn thành',completed,'fa-circle-check','green')}
    </div>
    <div class="grid g-auto-sm" style="margin-bottom:14px">
      ${mkpi('Chờ QC',waitingQc,'fa-shield-halved','orange')}
      ${mkpi('Chờ nhập kho',waitingWarehouse,'fa-warehouse','blue')}
      ${mkpi('Công nợ còn lại',fmtVND(debt),'fa-file-invoice-dollar','red')}
      ${mkpi('Quá hạn',overdue,'fa-triangle-exclamation','red')}
    </div>
    <div class="card"><div class="card-head"><div><h3>Kế hoạch gần đây</h3><p>Click vào dòng để mở toàn bộ chi tiết và thao tác nghiệp vụ.</p></div><button class="btn btn-sm" data-act="nav" data-id="subcontracting" data-tab="orders">Xem tất cả</button></div>
      ${tableShell([{t:'Mã kế hoạch'},{t:'Đối tác'},{t:'Sản phẩm'},{t:'SL',cls:'right'},{t:'Hạn hoàn thành'},{t:'Trạng thái'}],recent,{emptyTitle:'Chưa có kế hoạch gia công'})}
    </div>`;
};

Views['subcontracting-orders']=function(){
  subcontractHydrate();const orders=subcontractV3Orders();
  const rows=orders.map(o=>{
    const acts=[];
    if(o.status==='DRAFT') acts.push(
      {act:'subcontracting-edit',data:`data-id="${esc(o.id)}"`,icon:'fa-pen',title:'Sửa'},
      {act:'subcontracting-approve',data:`data-id="${esc(o.id)}"`,icon:'fa-check',title:'Duyệt'},
      {act:'subcontracting-delete',data:`data-id="${esc(o.id)}"`,icon:'fa-trash',title:'Xóa'}
    );
    if(o.status==='MATERIAL_ISSUED') acts.push({act:'subcontracting-handover',data:`data-id="${esc(o.id)}"`,icon:'fa-handshake',title:'Giao cho đối tác'});
    const pct=o.status==='COMPLETED'?100:Math.max(0,Math.min(100,Number(o.partnerProgress||0)));
    return `<tr class="clickable" data-act="subcontracting-open" data-id="${esc(o.id)}"><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner||'—')}</td><td>${esc(Q.product(o.productId)?.name||o.productId)}</td><td class="right num">${fmtDec(o.plannedQty,2)}</td><td>${fmtDate(o.issueDate)}</td><td>${fmtDate(o.dueDate)}</td><td style="min-width:140px">${progressBar(pct)}<div class="cell-sub">${pct}%</div></td><td>${subcontractV3StatusHtml(o.status)}</td><td class="right">${acts.length?rowActions(acts):'<span class="muted">—</span>'}</td></tr>`;
  }).join('');
  return `${pageHead('Kế hoạch gia công','Lập và theo dõi kế hoạch. Nhận hàng hoàn thành và cập nhật tiến độ được thực hiện ngay trong chi tiết kế hoạch.',`<button class="btn btn-primary" data-act="subcontracting-new"><i class="fa-solid fa-plus"></i>Tạo kế hoạch gia công</button>`)}
    <div class="card">${tableShell([{t:'Mã kế hoạch'},{t:'Đối tác'},{t:'Sản phẩm'},{t:'SL kế hoạch',cls:'right'},{t:'Ngày giao NVL'},{t:'Hạn hoàn thành'},{t:'Tiến độ'},{t:'Trạng thái'},{t:'Thao tác',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch gia công'})}</div>`;
};

function openSubcontractingReconcileModal(id){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o||o.status!=='COMPLETED'){Toast.warn('Chưa thể đối chiếu','Chỉ đối chiếu sau khi tất cả hàng đã QC và nhập kho.');return;}
  const accepted=subcontractV4AcceptedQty(o),unitCost=Number(o.unitCost||0),base=accepted*unitCost,oldAdj=Number(o.reconcileAdjustment||0),final=Math.max(0,base+oldAdj),paid=Number(o.paid||0);
  Modal.open({title:`Đối chiếu công nợ · ${o.id}`,sub:`${esc(o.partner)} · đối chiếu trên số lượng nghiệm thu thực tế`,size:'lg',body:`
    <div class="info-grid" style="margin-bottom:14px">${infoItem('SL kế hoạch',fmtDec(o.plannedQty,2))}${infoItem('SL đã nhận',fmtDec(o.receivedQty,2))}${infoItem('SL QC đạt & nhập kho',`<b>${fmtDec(accepted,2)}</b>`)}${infoItem('SL lỗi',fmtDec(o.defectQty,2))}${infoItem('Đơn giá gia công',fmtVND(unitCost))}${infoItem('Giá trị nghiệm thu',fmtVND(base))}${infoItem('Đã thanh toán',fmtVND(paid))}</div>
    <div class="form-grid cols-2"><div class="field"><label>Điều chỉnh tăng/giảm</label><input class="inp right num" id="subReconcileAdjustment" type="number" step="100" value="${oldAdj}"><div class="hint">Nhập số âm nếu giảm trừ do lỗi/chậm tiến độ; số dương nếu có khoản bổ sung.</div></div><div class="field"><label>Số chứng từ / hóa đơn đối tác</label><input class="inp" id="subReconcileInvoice" value="${esc(o.reconcileInvoice||'')}" placeholder="VD: HDGC-001"></div><div class="field" style="grid-column:1/-1"><label>Ghi chú đối chiếu</label><textarea class="inp" id="subReconcileNote" rows="3">${esc(o.reconcileNote||'')}</textarea></div></div>
    <div class="note-box"><b>Công thức:</b> SL QC đạt đã nhập kho × Đơn giá + Điều chỉnh. Hệ thống không cho xác nhận giá trị cuối nhỏ hơn số tiền đã thanh toán.</div>
  `,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="subcontracting-reconcile-confirm" data-id="${esc(id)}"><i class="fa-solid fa-scale-balanced"></i>Xác nhận đối chiếu</button>`});
}
function subcontractingReconcileConfirm(id){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o||o.status!=='COMPLETED')return;
  const accepted=subcontractV4AcceptedQty(o),base=accepted*Number(o.unitCost||0),adj=Number($('#subReconcileAdjustment')?.value||0),amount=Math.max(0,base+adj),paid=Number(o.paid||0);
  if(amount+1e-9<paid){Toast.err('Không thể đối chiếu',`Giá trị sau đối chiếu ${fmtVND(amount)} nhỏ hơn số đã thanh toán ${fmtVND(paid)}.`);return;}
  o.reconciledQty=accepted;o.reconcileBaseAmount=base;o.reconcileAdjustment=adj;o.reconciledAmount=amount;o.reconcileInvoice=$('#subReconcileInvoice')?.value?.trim()||'';o.reconciledAt=new Date().toISOString();o.reconciledBy=DB.currentUser?.id||'';o.reconcileNote=$('#subReconcileNote')?.value?.trim()||'';
  subcontractPersist();Modal.close();render();Toast.ok('Đã đối chiếu công nợ',`${id} · phải trả ${fmtVND(amount)}`);
}

Views['subcontracting-debt']=function(){
  const rows=subcontractV3Orders().filter(o=>o.status==='COMPLETED'||o.reconciledAt).map(o=>{
    const accepted=subcontractV4AcceptedQty(o),base=accepted*Number(o.unitCost||0),final=subcontractV4ReconciledAmount(o),paid=Number(o.paid||0),debt=Math.max(0,final-paid);
    const acts=[];if(!o.reconciledAt)acts.push({act:'subcontracting-reconcile',data:`data-id="${esc(o.id)}"`,icon:'fa-scale-balanced',title:'Đối chiếu'});if(o.reconciledAt&&debt>0)acts.push({act:'subcontracting-pay',data:`data-id="${esc(o.id)}"`,icon:'fa-money-bill-transfer',title:'Thanh toán'});
    return `<tr class="clickable" data-act="subcontracting-open" data-id="${esc(o.id)}"><td><span class="code">${esc(o.id)}</span></td><td>${esc(o.partner)}</td><td class="right num">${fmtDec(accepted,2)}</td><td class="right num">${fmtVND(o.unitCost||0)}</td><td class="right num">${fmtVND(base)}</td><td class="right num">${o.reconciledAt?fmtVND(o.reconcileAdjustment||0):'—'}</td><td class="right num strong">${fmtVND(final)}</td><td class="right num">${fmtVND(paid)}</td><td class="right num strong">${fmtVND(debt)}</td><td>${subcontractV4DebtStatus(o)}</td><td class="right">${acts.length?rowActions(acts):'<span class="muted">—</span>'}</td></tr>`;
  }).join('');
  return `${pageHead('Đối chiếu công nợ','Công nợ chỉ phát sinh trên sản lượng QC đạt đã nhập kho; sau đối chiếu mới được ghi nhận thanh toán.')}
    <div class="card">${tableShell([{t:'Kế hoạch'},{t:'Đối tác'},{t:'SL nghiệm thu',cls:'right'},{t:'Đơn giá',cls:'right'},{t:'Giá trị gốc',cls:'right'},{t:'Điều chỉnh',cls:'right'},{t:'Phải trả',cls:'right'},{t:'Đã trả',cls:'right'},{t:'Còn nợ',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có kế hoạch đủ điều kiện đối chiếu'})}</div>`;
};

function openSubcontractingDetail(id){
  const o=subcontractV3Orders().find(x=>x.id===id);if(!o)return;
  const p=subcontractProduct(o),bom=subcontractBomLines(o),wasteRows=subcontractV3WasteRows(o),receipts=subcontractV3Receipts(o),amount=subcontractOrderAmount(o),debt=subcontractDebt(o);
  const pct=o.status==='COMPLETED'?100:Math.max(0,Math.min(100,Number(o.partnerProgress||0)));
  const accepted=subcontractV4AcceptedQty(o),base=subcontractV4ExpectedAmount(o);
  const mats=bom.map(x=>`<tr><td><span class="code">${esc(x.materialId)}</span></td><td>${esc(Q.material(x.materialId)?.name||x.materialId)}</td><td class="right num">${fmtDec(x.qty,3)} ${esc(Q.material(x.materialId)?.unit||'')}</td><td class="right num">${fmtDec(subcontractAvailable(x.materialId),3)}</td></tr>`).join('');
  const waste=wasteRows.map(x=>`<tr><td>${esc(Q.material(x.materialId)?.name||x.materialId)}</td><td class="right num">${fmtDec(x.issued,3)} ${esc(x.unit)}</td><td class="right num">${fmtDec(x.standard,3)}</td><td class="right num">${fmtDec(x.waste,3)}</td><td class="right num">${fmtDec(x.pct,2)}%</td></tr>`).join('');
  const receiptRows=receipts.map(r=>`<tr><td><span class="code">${esc(r.id)}</span></td><td>${fmtDate(r.date)}</td><td class="right num">${fmtDec(r.qty,2)}</td><td>${r.qcStatus==='DONE'?'<span class="badge green">Đã QC</span>':'<span class="badge orange">Chờ QC</span>'}</td><td class="right num">${r.qcStatus==='DONE'?fmtDec(r.goodQty,2):'—'}</td><td class="right num">${r.qcStatus==='DONE'?fmtDec(r.defectQty,2):'—'}</td><td>${r.warehoused?`<span class="code">${esc(r.goodsReceiptId||'Đã nhập')}</span>`:'—'}</td></tr>`).join('');
  const canProgress=['HANDED_OVER','IN_PROGRESS'].includes(o.status),canReceive=canProgress&&pct>=100&&Number(o.receivedQty||0)<Number(o.plannedQty||0)-1e-9;
  Modal.open({title:`Kế hoạch gia công · ${o.id}`,sub:`${esc(o.partner)} · ${esc(p?.name||o.productId)}`,size:'xl',body:`
    <div class="info-grid" style="margin-bottom:14px">${infoItem('Trạng thái',subcontractV3StatusHtml(o.status))}${infoItem('Số lượng kế hoạch',`${fmtDec(o.plannedQty,2)} ${esc(p?.unit||o.unit||'')}`)}${infoItem('Hạn hoàn thành',fmtDate(o.dueDate))}${infoItem('Đã nhận',fmtDec(o.receivedQty,2))}${infoItem('QC đạt / lỗi',`${fmtDec(o.goodQty,2)} / ${fmtDec(o.defectQty,2)}`)}${infoItem('Tỷ lệ lỗi',`${fmtDec(subcontractV3DefectRate(o),2)}%`)}${infoItem('Hao hụt NVL TB',`${fmtDec(subcontractV3WasteRate(o),2)}%`)}${infoItem('Giá trị nghiệm thu',fmtVND(base))}${infoItem('Công nợ còn lại',fmtVND(debt))}</div>
    <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3><i class="fa-solid fa-chart-line"></i> Theo dõi tiến độ & nhận hàng</h3><p>Toàn bộ cập nhật tiến độ và nhận hàng hoàn thành nằm ngay trong kế hoạch.</p></div><div style="display:flex;gap:8px">${canProgress?`<button class="btn btn-sm" data-act="subcontracting-progress-update" data-id="${esc(o.id)}"><i class="fa-solid fa-pen"></i>Cập nhật tiến độ</button>`:''}${canReceive?`<button class="btn btn-sm btn-primary" data-act="subcontracting-receive" data-id="${esc(o.id)}"><i class="fa-solid fa-box-open"></i>Nhận hàng hoàn thành</button>`:''}</div></div><div style="padding:0 16px 16px"><div style="margin-bottom:8px">${progressBar(pct)}</div><div class="info-grid">${infoItem('Tiến độ hiện tại',`<b>${pct}%</b>`)}${infoItem('Cập nhật gần nhất',o.progressUpdatedAt?fmtDate(String(o.progressUpdatedAt).slice(0,10)):'—')}${infoItem('Ghi chú tiến độ',esc(o.progressNote||'—'))}${infoItem('Ngày giao đối tác',o.handoverAt?fmtDate(String(o.handoverAt).slice(0,10)):'—')}</div></div></div>
    <div class="form-sec-title"><i class="fa-solid fa-boxes-stacked"></i>Nguyên liệu giao gia công</div>${tableShell([{t:'Mã'},{t:'Nguyên liệu'},{t:'Cần giao',cls:'right'},{t:'Tồn khả dụng',cls:'right'}],mats,{emptyTitle:'Sản phẩm chưa có BOM'})}
    <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-chart-pie"></i>Kiểm soát hao hụt</div>${tableShell([{t:'Nguyên liệu'},{t:'Đã giao',cls:'right'},{t:'Định mức theo SL nhận',cls:'right'},{t:'Hao hụt',cls:'right'},{t:'Tỷ lệ',cls:'right'}],waste,{emptyTitle:'Chưa đủ dữ liệu để tính hao hụt'})}
    <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-box-open"></i>Các đợt nhận hàng / QC / nhập kho</div>${tableShell([{t:'Đợt nhận'},{t:'Ngày'},{t:'SL nhận',cls:'right'},{t:'QC'},{t:'Đạt',cls:'right'},{t:'Lỗi',cls:'right'},{t:'Phiếu nhập'}],receiptRows,{emptyTitle:'Chưa nhận hàng'})}
    <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-file-invoice-dollar"></i>Công nợ gia công</div><div class="info-grid">${infoItem('SL nghiệm thu',o.status==='COMPLETED'?fmtDec(accepted,2):'Chưa hoàn tất')}${infoItem('Đơn giá gia công',fmtVND(o.unitCost||0))}${infoItem('Giá trị phải trả',o.status==='COMPLETED'?fmtVND(amount):'Chưa phát sinh')}${infoItem('Đã thanh toán',fmtVND(o.paid||0))}${infoItem('Còn phải trả',o.status==='COMPLETED'?fmtVND(debt):'—')}${infoItem('Trạng thái',subcontractV4DebtStatus(o))}</div>
    <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-clock-rotate-left"></i>Truy vết quy trình</div><div class="info-grid">${infoItem('Duyệt kế hoạch',o.approvedAt?fmtDate(String(o.approvedAt).slice(0,10)):'—')}${infoItem('Xuất NVL',o.issueId?`${esc(o.issueId)} · ${fmtDate(o.actualIssueDate)}`:'—')}${infoItem('Giao đối tác',o.handoverAt?fmtDate(String(o.handoverAt).slice(0,10)):'—')}${infoItem('Đã thanh toán gia công',fmtVND(o.paid||0))}</div>${o.note?`<div class="note-box" style="margin-top:14px"><b>Yêu cầu:</b> ${esc(o.note)}</div>`:''}`,
    foot:`<button class="btn" data-act="modal-close">Đóng</button>${o.status==='DRAFT'?`<button class="btn" data-act="subcontracting-delete" data-id="${esc(o.id)}"><i class="fa-solid fa-trash"></i>Xóa</button><button class="btn" data-act="subcontracting-edit" data-id="${esc(o.id)}"><i class="fa-solid fa-pen"></i>Sửa</button><button class="btn btn-primary" data-act="subcontracting-approve" data-id="${esc(o.id)}"><i class="fa-solid fa-check"></i>Duyệt</button>`:''}${o.status==='MATERIAL_ISSUED'?`<button class="btn btn-primary" data-act="subcontracting-handover" data-id="${esc(o.id)}"><i class="fa-solid fa-handshake"></i>Giao cho đối tác</button>`:''}${receipts.some(r=>r.qcStatus!=='DONE')&&typeof Auth!=='undefined'&&Auth.canAccess('quality','subcontracting_qc')?`<button class="btn btn-primary" data-act="subcontracting-go-qc"><i class="fa-solid fa-shield-halved"></i>Đi đến Kiểm tra gia công</button>`:''}${receipts.some(r=>r.qcStatus==='DONE'&&!r.warehoused)&&typeof Auth!=='undefined'&&Auth.canAccess('warehouse','receipts')?`<button class="btn btn-primary" data-act="subcontracting-go-warehouse"><i class="fa-solid fa-warehouse"></i>Đi đến Kho nhập thành phẩm</button>`:''}${o.status==='COMPLETED'&&debt>0?`<button class="btn btn-primary" data-act="subcontracting-pay" data-id="${esc(o.id)}"><i class="fa-solid fa-money-bill-transfer"></i>Thanh toán gia công</button>`:''}`
  });
}

/* ========================================================================== 
 * UI37 — PHÂN HỆ BẢO TRÌ THIẾT BỊ (MAINTENANCE)
 * Danh mục máy móc · Lịch bảo trì · Phiếu sửa chữa · Nhật ký máy
 * KPI: Thời gian hoạt động trung bình giữa hai lần hỏng · Thời gian sửa chữa trung bình · Chi phí bảo trì · Thời gian ngừng máy · Cảnh báo định kỳ
 * Dữ liệu demo được lưu localStorage độc lập, không tác động các module khác.
 * ======================================================================= */
let __maintenanceHydrated = false;
function maintenanceToday(){ return typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0,10); }
function maintenanceSeed(){
  const today=maintenanceToday();
  return {
    equipment:[
      {id:'TB-001',code:'XD-200',name:'Máy xay đậu nành XD-200',type:'Máy xay',area:'Khu Xay',department:'Sản xuất',manufacturer:'Lê Nam Tech',model:'XD-200',serial:'XD200-26001',installDate:'2024-01-15',cycleDays:30,status:'OPERATING',lastMaintenance:addDays(today,-14),nextMaintenance:addDays(today,16),note:''},
      {id:'TB-002',code:'NN-300',name:'Nồi nấu inox 2 lớp 300L',type:'Nồi nấu',area:'Khu Nấu',department:'Sản xuất',manufacturer:'Lê Nam Tech',model:'NN-300',serial:'NN300-26002',installDate:'2024-03-01',cycleDays:30,status:'OPERATING',lastMaintenance:addDays(today,-26),nextMaintenance:addDays(today,4),note:''},
      {id:'TB-003',code:'EP-01',name:'Máy ép đậu hủ EP-01',type:'Máy ép',area:'Khu Ép',department:'Sản xuất',manufacturer:'An Phát',model:'EP-01',serial:'EP01-25008',installDate:'2024-06-10',cycleDays:45,status:'OPERATING',lastMaintenance:addDays(today,-20),nextMaintenance:addDays(today,25),note:''},
      {id:'TB-004',code:'DG-01',name:'Máy đóng gói DG-01',type:'Máy đóng gói',area:'Khu Đóng gói',department:'Sản xuất',manufacturer:'Tân Tiến',model:'DG-01',serial:'DG01-24012',installDate:'2023-12-20',cycleDays:30,status:'OPERATING',lastMaintenance:addDays(today,-29),nextMaintenance:addDays(today,1),note:''},
      {id:'TB-005',code:'KL-01',name:'Kho lạnh thành phẩm KL-01',type:'Kho lạnh',area:'Kho thành phẩm',department:'Kho vận',manufacturer:'ColdTech',model:'CT-10',serial:'KL01-23009',installDate:'2023-08-01',cycleDays:60,status:'OPERATING',lastMaintenance:addDays(today,-50),nextMaintenance:addDays(today,10),note:''}
    ],
    schedules:[
      {id:'BT-2026-0001',equipmentId:'TB-004',planDate:addDays(today,1),type:'PREVENTIVE',task:'Kiểm tra bộ gia nhiệt, cảm biến và vệ sinh cụm đóng gói',estimatedHours:2,status:'PLANNED',note:''},
      {id:'BT-2026-0002',equipmentId:'TB-002',planDate:addDays(today,4),type:'PREVENTIVE',task:'Kiểm tra điện trở, van xả, đồng hồ nhiệt và vệ sinh nồi',estimatedHours:1.5,status:'PLANNED',note:''},
      {id:'BT-2026-0003',equipmentId:'TB-005',planDate:addDays(today,10),type:'PREVENTIVE',task:'Kiểm tra gas lạnh, dàn lạnh, cảm biến nhiệt độ',estimatedHours:3,status:'PLANNED',note:''}
    ],
    workOrders:[
      {id:'SC-2026-0001',equipmentId:'TB-001',type:'CORRECTIVE',priority:'MEDIUM',reportedDate:addDays(today,-10),issue:'Máy rung mạnh khi xay tải cao',status:'COMPLETED',startedDate:addDays(today,-10),completedDate:addDays(today,-10),downtimeHours:1.5,cost:350000,resolution:'Căn chỉnh khớp nối và siết lại chân máy',createdBy:'USR-MAINT-MGR'},
      {id:'SC-2026-0002',equipmentId:'TB-004',type:'CORRECTIVE',priority:'HIGH',reportedDate:addDays(today,-4),issue:'Cảm biến màng đóng gói đọc sai vị trí',status:'COMPLETED',startedDate:addDays(today,-4),completedDate:addDays(today,-4),downtimeHours:2.25,cost:780000,resolution:'Thay cảm biến quang và hiệu chỉnh lại vị trí',createdBy:'USR-MAINT-MGR'}
    ],
    logs:[
      {id:'NKM-2026-0001',equipmentId:'TB-001',date:addDays(today,-10),type:'REPAIR',refId:'SC-2026-0001',downtimeHours:1.5,cost:350000,note:'Sửa rung máy xay; đã vận hành ổn định sau kiểm tra.'},
      {id:'NKM-2026-0002',equipmentId:'TB-004',date:addDays(today,-4),type:'REPAIR',refId:'SC-2026-0002',downtimeHours:2.25,cost:780000,note:'Thay cảm biến quang máy đóng gói.'}
    ]
  };
}
function maintenanceHydrate(){
  if(__maintenanceHydrated) return; __maintenanceHydrated=true;
  let saved=null; try{ saved=JSON.parse(localStorage.getItem('lenam_maintenance_v1')||'null'); }catch(_){ }
  const seed=maintenanceSeed();
  DB.maintenanceEquipment=Array.isArray(saved?.equipment)?saved.equipment:seed.equipment;
  const seedCatalogs=(seed.equipment||[]).map((e,i)=>({id:`DM-${String(i+1).padStart(3,'0')}`,name:e.type||e.name,type:e.type||'',group:e.department||'Sản xuất',manufacturer:e.manufacturer||'',model:e.model||'',defaultCycleDays:Number(e.cycleDays||30),active:true}));
  DB.maintenanceEquipmentCatalogs=Array.isArray(saved?.catalogs)&&saved.catalogs.length?saved.catalogs:seedCatalogs;
  (DB.maintenanceEquipment||[]).forEach(e=>{if(!e.categoryId){const c=(DB.maintenanceEquipmentCatalogs||[]).find(x=>x.type===e.type&&x.model===e.model)|| (DB.maintenanceEquipmentCatalogs||[]).find(x=>x.type===e.type); if(c)e.categoryId=c.id;}});
  DB.maintenanceSchedules=Array.isArray(saved?.schedules)?saved.schedules:seed.schedules;
  DB.maintenanceWorkOrders=Array.isArray(saved?.workOrders)?saved.workOrders:seed.workOrders;
  DB.maintenanceLogs=Array.isArray(saved?.logs)?saved.logs:seed.logs;
  // Tự sinh lịch bảo trì khi thiết bị bước vào cửa sổ 7 ngày trước kỳ bảo trì kế tiếp.
  // Cache chỉ được ghi lại khi thực sự có lịch mới để không ảnh hưởng các module khác.
  if(maintenanceEnsureUpcomingSchedules()) maintenancePersist();
}
function maintenancePersist(){
  try{localStorage.setItem('lenam_maintenance_v1',JSON.stringify({equipment:DB.maintenanceEquipment||[],catalogs:DB.maintenanceEquipmentCatalogs||[],schedules:DB.maintenanceSchedules||[],workOrders:DB.maintenanceWorkOrders||[],logs:DB.maintenanceLogs||[]}));}catch(e){console.warn('[Maintenance] Không lưu được local cache:',e);}
}
function maintenanceEquipment(id){maintenanceHydrate();return (DB.maintenanceEquipment||[]).find(x=>x.id===id);}
function maintenanceStatusHtml(s){const m={OPERATING:['Đang hoạt động','green'],MAINTENANCE:['Đang bảo trì','orange'],DOWN:['Dừng máy','red'],INACTIVE:['Ngừng sử dụng','slate']};const v=m[s]||[s||'—','slate'];return `<span class="badge ${v[1]}">${esc(v[0])}</span>`;}
function maintenanceWoStatusHtml(s){const m={OPEN:['Mới tạo','orange'],IN_PROGRESS:['Đang sửa','blue'],COMPLETED:['Hoàn thành','green'],CANCELLED:['Đã hủy','slate']};const v=m[s]||[s||'—','slate'];return `<span class="badge ${v[1]}">${esc(v[0])}</span>`;}
function maintenanceDaysUntil(planDate){
  const today=new Date(maintenanceToday()+'T00:00:00');
  const plan=new Date((planDate||maintenanceToday())+'T00:00:00');
  return Math.ceil((plan-today)/86400000);
}
function maintenanceEnsureUpcomingSchedules(){
  // Một thiết bị chỉ được tự sinh lịch khi còn tối đa 7 ngày tới kỳ bảo trì.
  // Nếu người dùng mở hệ thống sau ngày đến hạn, lịch vẫn được tạo để cảnh báo quá hạn.
  // Khóa chống trùng: equipmentId + planDate + PREVENTIVE.
  const eqs=DB.maintenanceEquipment||[], schedules=DB.maintenanceSchedules||(DB.maintenanceSchedules=[]);
  let created=0;
  eqs.forEach(e=>{
    if(!e||e.status==='INACTIVE'||!e.nextMaintenance) return;
    const days=maintenanceDaysUntil(e.nextMaintenance);
    if(days>7) return;
    const exists=schedules.some(s=>s.equipmentId===e.id&&s.planDate===e.nextMaintenance&&s.type==='PREVENTIVE');
    if(exists) return;
    schedules.push({
      id:nextCode('BT-2026-',schedules),
      equipmentId:e.id,
      planDate:e.nextMaintenance,
      type:'PREVENTIVE',
      task:`Bảo trì định kỳ ${e.name}`,
      estimatedHours:1,
      status:'PLANNED',
      note:'Tự động tạo trước kỳ bảo trì 7 ngày',
      autoGenerated:true
    });
    created++;
  });
  return created;
}
function maintenanceScheduleStatus(x){
  if(x.status==='DONE')return 'DONE';
  if(x.status==='CANCELLED')return 'CANCELLED';
  const days=maintenanceDaysUntil(x.planDate);
  if(days<0)return 'OVERDUE';
  if(days<=7)return 'DUE_SOON';
  return 'PLANNED';
}
function maintenanceScheduleStatusHtml(x){
  const s=maintenanceScheduleStatus(x),days=maintenanceDaysUntil(x.planDate);
  const m={DONE:['Đã thực hiện','green'],CANCELLED:['Đã hủy','slate'],OVERDUE:['Quá hạn bảo trì','red'],DUE_SOON:[days===0?'Đến hạn hôm nay':`Sắp đến hạn · còn ${days} ngày`,'orange'],PLANNED:['Đã lên lịch','blue']};
  const v=m[s]||['Đã lên lịch','blue'];return `<span class="badge ${v[1]}">${v[0]}</span>`;
}
function maintenanceMetrics(equipmentId=''){
  maintenanceHydrate();
  const eqs=equipmentId?[maintenanceEquipment(equipmentId)].filter(Boolean):(DB.maintenanceEquipment||[]).filter(e=>e.status!=='INACTIVE');
  const ids=new Set(eqs.map(e=>e.id));
  const repairs=(DB.maintenanceWorkOrders||[]).filter(w=>ids.has(w.equipmentId)&&w.type==='CORRECTIVE'&&w.status==='COMPLETED');
  const failures=repairs.length;
  const downtime=repairs.reduce((s,w)=>s+Number(w.downtimeHours||0),0);
  const cost=(DB.maintenanceWorkOrders||[]).filter(w=>ids.has(w.equipmentId)&&w.status==='COMPLETED').reduce((s,w)=>s+Number(w.cost||0),0);
  const now=new Date(maintenanceToday()+'T00:00:00');
  let observed=0;
  eqs.forEach(e=>{const d=new Date((e.installDate||maintenanceToday())+'T00:00:00');observed+=Math.max(0,(now-d)/3600000);});
  const uptime=Math.max(0,observed-downtime);
  return {failures,downtime,cost,mttr:failures?downtime/failures:null,mtbf:failures?uptime/failures:null};
}
function maintenanceDueAlerts(){maintenanceHydrate();return (DB.maintenanceSchedules||[]).filter(s=>s.status!=='DONE'&&s.status!=='CANCELLED').map(s=>({...s,days:maintenanceDaysUntil(s.planDate)})).filter(s=>s.days<=7).sort((a,b)=>a.days-b.days);}
function maintenanceFmtHours(v){return v==null?'—':`${fmtDec(v,2)} giờ`;}

Views.maintenance=function(){
  maintenanceHydrate();
  // Kiểm tra lại mỗi khi mở phân hệ để nếu ngày hiện tại đã bước vào cửa sổ 7 ngày,
  // lịch định kỳ được tạo đúng lúc mà không cần người dùng lập thủ công.
  if(maintenanceEnsureUpcomingSchedules()) maintenancePersist();
  let tab=State.tab||'dashboard';
  // Tương thích link cũ: Menu/Combo đã được gộp vào Menu / Công thức món.
  if(tab==='menu') tab='recipe';
  const map={dashboard:'maintenance-dashboard',equipment:'maintenance-equipment',equipment_catalog:'maintenance-equipment-catalog',schedule:'maintenance-schedule',work_orders:'maintenance-work-orders',logs:'maintenance-logs'};
  const key=map[tab]||'maintenance-dashboard';return Views[key]?Views[key]() : '';
};
Views['maintenance-dashboard']=function(){
  maintenanceHydrate();const m=maintenanceMetrics(),alerts=maintenanceDueAlerts();const eqs=DB.maintenanceEquipment||[],open=(DB.maintenanceWorkOrders||[]).filter(w=>w.status!=='COMPLETED'&&w.status!=='CANCELLED');
  const alertRows=alerts.map(s=>{const e=maintenanceEquipment(s.equipmentId);return `<tr class="clickable" data-act="maintenance-schedule-open" data-id="${esc(s.id)}"><td><span class="code">${esc(s.id)}</span></td><td>${cell2(esc(e?.name||s.equipmentId),esc(e?.area||''))}</td><td>${fmtDate(s.planDate)}</td><td>${s.days<0?`<span class="badge red">Quá ${Math.abs(s.days)} ngày</span>`:s.days===0?'<span class="badge orange">Hôm nay</span>':`<span class="badge orange">Còn ${s.days} ngày</span>`}</td><td>${esc(s.task||'')}</td></tr>`}).join('');
  const woRows=(DB.maintenanceWorkOrders||[]).slice().sort((a,b)=>String(b.reportedDate).localeCompare(String(a.reportedDate))).slice(0,6).map(w=>{const e=maintenanceEquipment(w.equipmentId);return `<tr class="clickable" data-act="maintenance-wo-open" data-id="${esc(w.id)}"><td><span class="code">${esc(w.id)}</span></td><td>${esc(e?.name||w.equipmentId)}</td><td>${fmtDate(w.reportedDate)}</td><td>${maintenanceWoStatusHtml(w.status)}</td><td class="right num">${maintenanceFmtHours(w.downtimeHours)}</td><td class="right num">${fmtVND(w.cost||0)}</td></tr>`}).join('');
  return `${pageHead('Tổng quan bảo trì thiết bị','Theo dõi độ ổn định của máy, thời gian sửa chữa, thời gian máy ngừng hoạt động, chi phí và lịch bảo trì định kỳ')}
  <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Thiết bị hoạt động',eqs.filter(e=>e.status==='OPERATING').length,'fa-gears','green')}${mkpi('Cảnh báo bảo trì',alerts.length,'fa-bell','orange')}${mkpi('Phiếu sửa đang mở',open.length,'fa-screwdriver-wrench','red')}${mkpi('Tổng thời gian máy ngừng hoạt động',maintenanceFmtHours(m.downtime),'fa-pause','orange')}</div>
  <div class="grid g-auto-sm" style="margin-bottom:14px">${mkpi('Thời gian máy chạy ổn định giữa các lần hỏng',m.mtbf==null?'Chưa đủ dữ liệu':maintenanceFmtHours(m.mtbf),'fa-arrow-trend-up','blue')}${mkpi('Thời gian trung bình để sửa xong một sự cố',m.mttr==null?'Chưa đủ dữ liệu':maintenanceFmtHours(m.mttr),'fa-stopwatch','teal')}${mkpi('Chi phí bảo trì',fmtVND(m.cost),'fa-coins','indigo')}${mkpi('Sự cố đã sửa',m.failures,'fa-triangle-exclamation','slate')}</div>
  <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Giải thích chỉ số</h3><p>Các tên dưới đây được viết theo cách dễ hiểu để người dùng không cần nhớ thuật ngữ kỹ thuật.</p></div></div><div class="info-grid" style="padding:14px">${infoItem('Thời gian máy chạy ổn định giữa các lần hỏng','Trung bình máy hoạt động được bao lâu trước khi phát sinh một sự cố mới. Giá trị càng cao càng tốt.')}${infoItem('Thời gian trung bình để sửa xong một sự cố','Trung bình cần bao nhiêu thời gian từ lúc bắt đầu sửa đến khi máy được khôi phục. Giá trị càng thấp càng tốt.')}${infoItem('Tổng thời gian máy ngừng hoạt động','Tổng số giờ thiết bị không thể vận hành do sự cố hoặc hoạt động bảo trì có ghi nhận thời gian dừng.')}</div></div>
  <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>Cảnh báo bảo trì định kỳ</h3><p><b>Sắp đến hạn bảo trì</b>: còn từ 0 đến 7 ngày. <b>Quá hạn bảo trì</b>: ngày kế hoạch đã qua nhưng lịch chưa hoàn thành.</p></div></div>${tableShell([{t:'Mã lịch'},{t:'Thiết bị'},{t:'Ngày dự kiến'},{t:'Cảnh báo'},{t:'Nội dung'}],alertRows,{emptyTitle:'Không có lịch bảo trì sắp đến hạn'})}</div>
  <div class="card"><div class="card-head"><div><h3>Phiếu sửa chữa gần đây</h3><p>Click vào dòng để xem chi tiết.</p></div></div>${tableShell([{t:'Phiếu'},{t:'Thiết bị'},{t:'Ngày báo'},{t:'Trạng thái'},{t:'Tổng thời gian máy ngừng hoạt động',cls:'right'},{t:'Chi phí',cls:'right'}],woRows,{emptyTitle:'Chưa có phiếu sửa chữa'})}</div>`;
};

function maintenanceCatalog(id){maintenanceHydrate();return (DB.maintenanceEquipmentCatalogs||[]).find(x=>x.id===id);}
function maintenanceCatalogOptions(selected=''){
  maintenanceHydrate();
  return (DB.maintenanceEquipmentCatalogs||[]).filter(x=>x.active!==false||x.id===selected).map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.id)} — ${esc(c.name||c.type||'Danh mục')} ${c.model?`· ${esc(c.model)}`:''}</option>`).join('');
}
Views['maintenance-equipment-catalog']=function(){
  maintenanceHydrate();
  const rows=(DB.maintenanceEquipmentCatalogs||[]).map(c=>{
    const used=(DB.maintenanceEquipment||[]).filter(e=>e.categoryId===c.id).length;
    return `<tr class="clickable" data-act="maintenance-catalog-open" data-id="${esc(c.id)}"><td><span class="code">${esc(c.id)}</span></td><td>${cell2(`<b>${esc(c.name||c.type||'—')}</b>`,esc(c.type||''))}</td><td>${esc(c.group||'—')}</td><td>${esc(c.manufacturer||'—')}</td><td>${esc(c.model||'—')}</td><td class="right num">${fmtN(c.defaultCycleDays||0)} ngày</td><td class="right num">${fmtN(used)}</td><td>${c.active===false?'<span class="badge slate">Ngừng dùng</span>':'<span class="badge green">Đang dùng</span>'}</td><td class="right">${rowActions([{act:'maintenance-catalog-edit',data:`data-id="${esc(c.id)}"`,icon:'fa-pen',title:'Sửa'},{act:'maintenance-catalog-delete',data:`data-id="${esc(c.id)}"`,icon:'fa-trash',title:'Xóa'}])}</td></tr>`;
  }).join('');
  return `${pageHead('Danh mục máy móc','Dữ liệu chuẩn về loại/nhóm/hãng/model dùng khi khai báo máy mới',`<button class="btn btn-primary" data-act="maintenance-catalog-new"><i class="fa-solid fa-plus"></i>Thêm danh mục</button>`)}<div class="card">${tableShell([{t:'Mã danh mục'},{t:'Tên / Loại'},{t:'Nhóm thiết bị'},{t:'Hãng'},{t:'Model'},{t:'Chu kỳ mặc định',cls:'right'},{t:'Số máy',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có danh mục máy móc'})}</div>`;
};
function openMaintenanceCatalogForm(id=''){
  maintenanceHydrate(); const c=id?maintenanceCatalog(id):null;
  Modal.open({title:c?`Sửa danh mục · ${c.id}`:'Thêm danh mục máy móc',sub:'Danh mục là mẫu chuẩn; danh sách máy là từng thiết bị thực tế',size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Tên danh mục *</label><input class="inp" id="mntCatName" value="${esc(c?.name||'') }" placeholder="Ví dụ: Máy xay đậu nành"></div><div class="field"><label>Loại thiết bị *</label><input class="inp" id="mntCatType" value="${esc(c?.type||'') }" placeholder="Máy xay, Máy ép, Nồi nấu..."></div><div class="field"><label>Nhóm thiết bị</label><input class="inp" id="mntCatGroup" value="${esc(c?.group||'Sản xuất')}" placeholder="Sản xuất, Đóng gói, Kho lạnh..."></div><div class="field"><label>Hãng sản xuất</label><input class="inp" id="mntCatMaker" value="${esc(c?.manufacturer||'')}"></div><div class="field"><label>Model</label><input class="inp" id="mntCatModel" value="${esc(c?.model||'')}"></div><div class="field"><label>Chu kỳ bảo trì mặc định (ngày) *</label><input class="inp right num" id="mntCatCycle" type="number" min="1" value="${Number(c?.defaultCycleDays||30)}"></div><div class="field"><label>Trạng thái</label><select class="inp" id="mntCatActive"><option value="1" ${c?.active!==false?'selected':''}>Đang dùng</option><option value="0" ${c?.active===false?'selected':''}>Ngừng dùng</option></select></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="maintenance-catalog-save" data-id="${esc(c?.id||'')}">Lưu danh mục</button>`});
}
function maintenanceSaveCatalog(id=''){
  const name=$('#mntCatName')?.value?.trim(),type=$('#mntCatType')?.value?.trim(),cycle=Number($('#mntCatCycle')?.value||0);
  if(!name||!type||cycle<=0){Toast.err('Thiếu thông tin','Tên danh mục, loại thiết bị và chu kỳ bảo trì là bắt buộc.');return;}
  const payload={name,type,group:$('#mntCatGroup')?.value?.trim()||'',manufacturer:$('#mntCatMaker')?.value?.trim()||'',model:$('#mntCatModel')?.value?.trim()||'',defaultCycleDays:cycle,active:$('#mntCatActive')?.value!=='0'};
  if(id)Object.assign(maintenanceCatalog(id),payload); else (DB.maintenanceEquipmentCatalogs||(DB.maintenanceEquipmentCatalogs=[])).push({id:nextCode('DM-',DB.maintenanceEquipmentCatalogs||[]),...payload});
  maintenancePersist();Modal.close();render();Toast.ok(id?'Đã cập nhật danh mục':'Đã thêm danh mục',name);
}
function openMaintenanceCatalogDetail(id){const c=maintenanceCatalog(id);if(!c)return;const machines=(DB.maintenanceEquipment||[]).filter(e=>e.categoryId===id);Modal.open({title:c.name||c.type,sub:`${c.id} · ${c.type||''}`,size:'lg',body:`<div class="info-grid">${infoItem('Nhóm thiết bị',esc(c.group||'—'))}${infoItem('Hãng sản xuất',esc(c.manufacturer||'—'))}${infoItem('Model',esc(c.model||'—'))}${infoItem('Chu kỳ bảo trì mặc định',`${fmtN(c.defaultCycleDays||0)} ngày`)}${infoItem('Trạng thái',c.active===false?'<span class="badge slate">Ngừng dùng</span>':'<span class="badge green">Đang dùng</span>')}${infoItem('Số máy đang khai báo',fmtN(machines.length))}</div><div class="form-sec-title" style="margin-top:14px">Máy thuộc danh mục</div>${tableShell([{t:'Mã'},{t:'Tên máy'},{t:'Khu vực'},{t:'Serial'},{t:'Trạng thái'}],machines.map(e=>`<tr><td><span class="code">${esc(e.id)}</span></td><td>${esc(e.name)}</td><td>${esc(e.area||'—')}</td><td>${esc(e.serial||'—')}</td><td>${maintenanceStatusHtml(e.status)}</td></tr>`).join(''),{emptyTitle:'Chưa có máy nào thuộc danh mục này'})}`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn" data-act="maintenance-catalog-edit" data-id="${esc(id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`});}
function maintenanceDeleteCatalog(id){const c=maintenanceCatalog(id);if(!c)return;const used=(DB.maintenanceEquipment||[]).some(e=>e.categoryId===id);if(used){c.active=false;maintenancePersist();render();Toast.warn('Danh mục đang được sử dụng','Đã chuyển sang Ngừng dùng thay vì xóa.');return;}const i=(DB.maintenanceEquipmentCatalogs||[]).findIndex(x=>x.id===id);if(i>=0)DB.maintenanceEquipmentCatalogs.splice(i,1);maintenancePersist();render();Toast.ok('Đã xóa danh mục',id);}
Views['maintenance-equipment']=function(){maintenanceHydrate();const rows=(DB.maintenanceEquipment||[]).map(e=>{const m=maintenanceMetrics(e.id);return `<tr class="clickable" data-act="maintenance-equipment-open" data-id="${esc(e.id)}"><td>${cell2(`<span class="code">${esc(e.id)}</span>`,esc(e.code||''))}</td><td>${cell2(`<b>${esc(e.name)}</b>`,esc(e.type||''))}</td><td>${esc(e.area||'—')}</td><td>${maintenanceStatusHtml(e.status)}</td><td>${e.lastMaintenance?fmtDate(e.lastMaintenance):'—'}</td><td>${e.nextMaintenance?fmtDate(e.nextMaintenance):'—'}</td><td class="right num">${m.mtbf==null?'—':fmtDec(m.mtbf,1)}</td><td class="right num">${m.mttr==null?'—':fmtDec(m.mttr,1)}</td><td class="right">${rowActions([{act:'maintenance-equipment-edit',data:`data-id="${esc(e.id)}"`,icon:'fa-pen',title:'Sửa'},{act:'maintenance-equipment-delete',data:`data-id="${esc(e.id)}"`,icon:'fa-trash',title:'Xóa'}])}</td></tr>`}).join('');return `${pageHead('Danh sách máy móc','Quản lý từng máy/thiết bị cụ thể và chu kỳ bảo trì định kỳ',`<button class="btn btn-primary" data-act="maintenance-equipment-new"><i class="fa-solid fa-plus"></i>Thêm thiết bị</button>`)}<div class="card">${tableShell([{t:'Mã thiết bị'},{t:'Thiết bị'},{t:'Khu vực'},{t:'Trạng thái'},{t:'Bảo trì gần nhất'},{t:'Lần kế tiếp'},{t:'Thời gian máy chạy ổn định giữa các lần hỏng (giờ)',cls:'right'},{t:'Thời gian trung bình để sửa xong một sự cố (giờ)',cls:'right'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có thiết bị'})}</div>`;};
Views['maintenance-schedule']=function(){maintenanceHydrate();const rows=(DB.maintenanceSchedules||[]).slice().sort((a,b)=>String(a.planDate).localeCompare(String(b.planDate))).map(s=>{const e=maintenanceEquipment(s.equipmentId);const editable=s.status!=='DONE'&&s.status!=='CANCELLED';return `<tr class="clickable" data-act="maintenance-schedule-open" data-id="${esc(s.id)}"><td><span class="code">${esc(s.id)}</span></td><td>${cell2(esc(e?.name||s.equipmentId),esc(e?.area||''))}</td><td>${fmtDate(s.planDate)}</td><td>${esc(s.type==='PREVENTIVE'?'Bảo trì định kỳ':'Kiểm tra')}</td><td>${esc(s.task||'')}</td><td class="right num">${maintenanceFmtHours(s.estimatedHours)}</td><td>${maintenanceScheduleStatusHtml(s)}</td><td class="right">${editable?rowActions([{act:'maintenance-schedule-edit',data:`data-id="${esc(s.id)}"`,icon:'fa-pen',title:'Sửa'},{act:'maintenance-schedule-complete',data:`data-id="${esc(s.id)}"`,icon:'fa-check',title:'Hoàn thành bảo trì'},{act:'maintenance-schedule-delete',data:`data-id="${esc(s.id)}"`,icon:'fa-trash',title:'Xóa'}]):'<span class="muted">—</span>'}</td></tr>`}).join('');return `${pageHead('Lịch bảo trì','Lập kế hoạch và cảnh báo bảo trì định kỳ',`<button class="btn btn-primary" data-act="maintenance-schedule-new"><i class="fa-solid fa-plus"></i>Lập lịch bảo trì</button>`)}<div class="card">${tableShell([{t:'Mã lịch'},{t:'Thiết bị'},{t:'Ngày dự kiến'},{t:'Loại'},{t:'Nội dung'},{t:'TG dự kiến',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có lịch bảo trì'})}</div>`;};
Views['maintenance-work-orders']=function(){maintenanceHydrate();const rows=(DB.maintenanceWorkOrders||[]).slice().sort((a,b)=>String(b.reportedDate).localeCompare(String(a.reportedDate))).map(w=>{const e=maintenanceEquipment(w.equipmentId);const acts=[];if(w.status==='OPEN')acts.push({act:'maintenance-wo-start',data:`data-id="${esc(w.id)}"`,icon:'fa-play',title:'Bắt đầu sửa'});if(w.status==='IN_PROGRESS')acts.push({act:'maintenance-wo-complete',data:`data-id="${esc(w.id)}"`,icon:'fa-check',title:'Hoàn tất sửa chữa'});return `<tr class="clickable" data-act="maintenance-wo-open" data-id="${esc(w.id)}"><td><span class="code">${esc(w.id)}</span></td><td>${esc(e?.name||w.equipmentId)}</td><td>${fmtDate(w.reportedDate)}</td><td>${esc(w.priority||'—')}</td><td>${esc(w.issue||'')}</td><td>${maintenanceWoStatusHtml(w.status)}</td><td class="right num">${maintenanceFmtHours(w.downtimeHours)}</td><td class="right num">${fmtVND(w.cost||0)}</td><td class="right">${acts.length?rowActions(acts):'<span class="muted">—</span>'}</td></tr>`}).join('');return `${pageHead('Phiếu sửa chữa','Ghi nhận sự cố, sửa chữa, thời gian ngừng máy và chi phí thực tế',`<button class="btn btn-primary" data-act="maintenance-wo-new"><i class="fa-solid fa-plus"></i>Tạo phiếu sửa chữa</button>`)}<div class="card">${tableShell([{t:'Phiếu'},{t:'Thiết bị'},{t:'Ngày báo'},{t:'Ưu tiên'},{t:'Sự cố'},{t:'Trạng thái'},{t:'Tổng thời gian máy ngừng hoạt động',cls:'right'},{t:'Chi phí',cls:'right'},{t:'',cls:'right'}],rows,{emptyTitle:'Chưa có phiếu sửa chữa'})}</div>`;};
Views['maintenance-logs']=function(){maintenanceHydrate();const rows=(DB.maintenanceLogs||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(l=>{const e=maintenanceEquipment(l.equipmentId);return `<tr class="clickable" data-act="maintenance-log-open" data-id="${esc(l.id)}"><td><span class="code">${esc(l.id)}</span></td><td>${esc(e?.name||l.equipmentId)}</td><td>${fmtDate(l.date)}</td><td>${esc(({REPAIR:'Sửa chữa',MAINTENANCE:'Bảo trì',INSPECTION:'Kiểm tra',DOWNTIME:'Dừng máy',NOTE:'Ghi chú'}[l.type]||l.type))}</td><td><span class="code">${esc(l.refId||'—')}</span></td><td class="right num">${maintenanceFmtHours(l.downtimeHours)}</td><td class="right num">${fmtVND(l.cost||0)}</td><td>${esc(l.note||'')}</td></tr>`}).join('');return `${pageHead('Nhật ký máy','Lịch sử bảo trì, sửa chữa, kiểm tra và thời gian ngừng máy theo từng thiết bị',`<button class="btn btn-primary" data-act="maintenance-log-new"><i class="fa-solid fa-plus"></i>Ghi nhật ký</button>`)}<div class="card">${tableShell([{t:'Mã nhật ký'},{t:'Thiết bị'},{t:'Ngày'},{t:'Loại'},{t:'Tham chiếu'},{t:'Tổng thời gian máy ngừng hoạt động',cls:'right'},{t:'Chi phí',cls:'right'},{t:'Nội dung'}],rows,{emptyTitle:'Chưa có nhật ký máy'})}</div>`;};

function openMaintenanceEquipmentForm(id=''){maintenanceHydrate();const e=id?maintenanceEquipment(id):null;const selected=e?.categoryId||'';Modal.open({title:e?`Sửa thiết bị · ${e.id}`:'Thêm thiết bị',sub:'Khai báo một máy/thiết bị cụ thể từ danh mục chuẩn',size:'lg',body:`<div class="form-grid cols-2"><div class="field" style="grid-column:1/-1"><label>Danh mục máy móc *</label><select class="inp" id="mntEqCategory"><option value="">— Chọn danh mục —</option>${maintenanceCatalogOptions(selected)}</select><div class="muted" style="font-size:12px;margin-top:4px">Loại, hãng, model và chu kỳ mặc định lấy từ Danh mục máy móc.</div></div><div class="field"><label>Mã nội bộ</label><input class="inp" id="mntEqCode" value="${esc(e?.code||'')}"></div><div class="field"><label>Tên thiết bị *</label><input class="inp" id="mntEqName" value="${esc(e?.name||'')}"></div><div class="field"><label>Khu vực *</label><input class="inp" id="mntEqArea" value="${esc(e?.area||'')}"></div><div class="field"><label>Serial</label><input class="inp" id="mntEqSerial" value="${esc(e?.serial||'')}"></div><div class="field"><label>Ngày lắp đặt</label><input class="inp" id="mntEqInstall" type="date" value="${esc(e?.installDate||maintenanceToday())}"></div><div class="field"><label>Chu kỳ bảo trì (ngày)</label><input class="inp right num" id="mntEqCycle" type="number" min="1" value="${Number(e?.cycleDays||maintenanceCatalog(selected)?.defaultCycleDays||30)}"></div><div class="field"><label>Trạng thái</label><select class="inp" id="mntEqStatus"><option value="OPERATING" ${e?.status!=='INACTIVE'?'selected':''}>Đang hoạt động</option><option value="INACTIVE" ${e?.status==='INACTIVE'?'selected':''}>Ngừng sử dụng</option></select></div><div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea class="inp" id="mntEqNote" rows="2">${esc(e?.note||'')}</textarea></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="maintenance-equipment-save" data-id="${esc(e?.id||'')}">Lưu thiết bị</button>`});setTimeout(()=>{const sel=$('#mntEqCategory');if(sel)sel.addEventListener('change',()=>{const c=maintenanceCatalog(sel.value);if(!c)return;const cyc=$('#mntEqCycle');if(cyc)cyc.value=Number(c.defaultCycleDays||30);const nm=$('#mntEqName');if(nm&&!nm.value.trim())nm.value=[c.name,c.model].filter(Boolean).join(' ');});},0);}
function maintenanceSaveEquipment(id=''){const name=$('#mntEqName')?.value?.trim(),area=$('#mntEqArea')?.value?.trim(),cycle=Number($('#mntEqCycle')?.value||0),categoryId=$('#mntEqCategory')?.value||'',c=maintenanceCatalog(categoryId);if(!categoryId||!c||!name||!area||cycle<=0){Toast.err('Thiếu thông tin','Danh mục máy móc, tên thiết bị, khu vực và chu kỳ bảo trì là bắt buộc.');return;}const payload={categoryId,code:$('#mntEqCode')?.value?.trim()||'',name,type:c.type||'',area,department:c.group||'',manufacturer:c.manufacturer||'',model:c.model||'',serial:$('#mntEqSerial')?.value?.trim()||'',cycleDays:cycle,status:$('#mntEqStatus')?.value||'OPERATING',note:$('#mntEqNote')?.value?.trim()||'',installDate:$('#mntEqInstall')?.value||maintenanceToday()};if(id){Object.assign(maintenanceEquipment(id),payload);}else{const eid=nextCode('TB-',DB.maintenanceEquipment||[]);(DB.maintenanceEquipment||(DB.maintenanceEquipment=[])).push({id:eid,...payload,lastMaintenance:'',nextMaintenance:addDays(maintenanceToday(),cycle)});}maintenanceEnsureUpcomingSchedules();maintenancePersist();Modal.close();render();Toast.ok(id?'Đã cập nhật thiết bị':'Đã thêm thiết bị',name);}
function openMaintenanceEquipmentDetail(id){const e=maintenanceEquipment(id);if(!e)return;const m=maintenanceMetrics(id),schedules=(DB.maintenanceSchedules||[]).filter(s=>s.equipmentId===id).sort((a,b)=>String(b.planDate).localeCompare(String(a.planDate))),wos=(DB.maintenanceWorkOrders||[]).filter(w=>w.equipmentId===id).sort((a,b)=>String(b.reportedDate).localeCompare(String(a.reportedDate)));Modal.open({title:e.name,sub:`${e.id} · ${e.code||'Không có mã nội bộ'}`,size:'xl',body:`<div class="info-grid">${infoItem('Danh mục',esc(maintenanceCatalog(e.categoryId)?.name||'—'))}${infoItem('Loại',esc(e.type||'—'))}${infoItem('Nhóm thiết bị',esc(e.department||maintenanceCatalog(e.categoryId)?.group||'—'))}${infoItem('Khu vực',esc(e.area||'—'))}${infoItem('Trạng thái',maintenanceStatusHtml(e.status))}${infoItem('Chu kỳ bảo trì',`${fmtN(e.cycleDays)} ngày`)}${infoItem('Bảo trì gần nhất',e.lastMaintenance?fmtDate(e.lastMaintenance):'—')}${infoItem('Lần kế tiếp',e.nextMaintenance?fmtDate(e.nextMaintenance):'—')}${infoItem('Thời gian hoạt động trung bình giữa hai lần hỏng',m.mtbf==null?'Chưa đủ dữ liệu':maintenanceFmtHours(m.mtbf))}${infoItem('Thời gian sửa chữa trung bình',m.mttr==null?'Chưa đủ dữ liệu':maintenanceFmtHours(m.mttr))}${infoItem('Tổng thời gian máy ngừng hoạt động',maintenanceFmtHours(m.downtime))}${infoItem('Chi phí',fmtVND(m.cost))}</div><div class="form-sec-title" style="margin-top:14px">Lịch bảo trì</div>${tableShell([{t:'Mã'},{t:'Ngày'},{t:'Nội dung'},{t:'Trạng thái'}],schedules.map(s=>`<tr><td><span class="code">${esc(s.id)}</span></td><td>${fmtDate(s.planDate)}</td><td>${esc(s.task||'')}</td><td>${maintenanceScheduleStatusHtml(s)}</td></tr>`).join(''),{emptyTitle:'Chưa có lịch bảo trì'})}<div class="form-sec-title" style="margin-top:14px">Phiếu sửa chữa</div>${tableShell([{t:'Phiếu'},{t:'Ngày'},{t:'Sự cố'},{t:'Trạng thái'},{t:'Tổng thời gian máy ngừng hoạt động',cls:'right'}],wos.map(w=>`<tr><td><span class="code">${esc(w.id)}</span></td><td>${fmtDate(w.reportedDate)}</td><td>${esc(w.issue)}</td><td>${maintenanceWoStatusHtml(w.status)}</td><td class="right">${maintenanceFmtHours(w.downtimeHours)}</td></tr>`).join(''),{emptyTitle:'Chưa có phiếu sửa chữa'})}`,foot:`<button class="btn" data-act="modal-close">Đóng</button><button class="btn" data-act="maintenance-equipment-edit" data-id="${esc(id)}"><i class="fa-solid fa-pen"></i>Sửa</button>`});}
function maintenanceDeleteEquipment(id){const used=(DB.maintenanceSchedules||[]).some(x=>x.equipmentId===id)||(DB.maintenanceWorkOrders||[]).some(x=>x.equipmentId===id)||(DB.maintenanceLogs||[]).some(x=>x.equipmentId===id);if(used){Toast.warn('Không thể xóa thiết bị','Thiết bị đã có lịch sử bảo trì/sửa chữa. Hãy chuyển trạng thái sang Ngừng sử dụng.');return;}(DB.maintenanceEquipment||[]).splice((DB.maintenanceEquipment||[]).findIndex(x=>x.id===id),1);maintenancePersist();render();Toast.ok('Đã xóa thiết bị',id);}

function openMaintenanceScheduleForm(id=''){maintenanceHydrate();const s=id?(DB.maintenanceSchedules||[]).find(x=>x.id===id):null;if(s&&s.status==='DONE'){Toast.warn('Không thể sửa','Lịch đã hoàn thành.');return;}const today=maintenanceToday();Modal.open({title:s?`Sửa lịch bảo trì · ${s.id}`:'Lập lịch bảo trì',sub:'Lịch định kỳ sẽ tạo cảnh báo khi gần đến hạn',size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Thiết bị *</label><select class="inp" id="mntSchEq">${(DB.maintenanceEquipment||[]).filter(e=>e.status!=='INACTIVE').map(e=>`<option value="${esc(e.id)}" ${s?.equipmentId===e.id?'selected':''}>${esc(e.id)} — ${esc(e.name)}</option>`).join('')}</select></div><div class="field"><label>Ngày dự kiến *</label><input class="inp" id="mntSchDate" type="date" min="${today}" value="${s?.planDate&&s.planDate>=today?s.planDate:today}"></div><div class="field"><label>Thời gian dự kiến (giờ)</label><input class="inp right num" id="mntSchHours" type="number" min="0" step="0.25" value="${Number(s?.estimatedHours||1)}"></div><div class="field"><label>Loại</label><select class="inp" id="mntSchType"><option value="PREVENTIVE">Bảo trì định kỳ</option><option value="INSPECTION" ${s?.type==='INSPECTION'?'selected':''}>Kiểm tra định kỳ</option></select></div><div class="field" style="grid-column:1/-1"><label>Nội dung *</label><textarea class="inp" id="mntSchTask" rows="3">${esc(s?.task||'')}</textarea></div><div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea class="inp" id="mntSchNote" rows="2">${esc(s?.note||'')}</textarea></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="maintenance-schedule-save" data-id="${esc(s?.id||'')}">Lưu lịch</button>`});}
function maintenanceSaveSchedule(id=''){const equipmentId=$('#mntSchEq')?.value,planDate=$('#mntSchDate')?.value,task=$('#mntSchTask')?.value?.trim();if(!equipmentId||!planDate||!task){Toast.err('Thiếu thông tin','Vui lòng chọn thiết bị, ngày và nội dung bảo trì.');return;}if(planDate<maintenanceToday()){Toast.err('Ngày không hợp lệ','Ngày bảo trì không được ở quá khứ.');return;}const payload={equipmentId,planDate,type:$('#mntSchType')?.value||'PREVENTIVE',task,estimatedHours:Number($('#mntSchHours')?.value||0),note:$('#mntSchNote')?.value?.trim()||'',status:'PLANNED'};if(id)Object.assign((DB.maintenanceSchedules||[]).find(x=>x.id===id),payload);else(DB.maintenanceSchedules||(DB.maintenanceSchedules=[])).push({id:nextCode('BT-2026-',DB.maintenanceSchedules||[]),...payload});maintenancePersist();Modal.close();render();Toast.ok(id?'Đã cập nhật lịch':'Đã lập lịch bảo trì',task);}
function openMaintenanceScheduleDetail(id){const s=(DB.maintenanceSchedules||[]).find(x=>x.id===id);if(!s)return;const e=maintenanceEquipment(s.equipmentId);Modal.open({title:`Lịch bảo trì · ${s.id}`,sub:e?.name||s.equipmentId,size:'md',body:`<div class="info-grid">${infoItem('Thiết bị',esc(e?.name||s.equipmentId))}${infoItem('Ngày dự kiến',fmtDate(s.planDate))}${infoItem('Trạng thái',maintenanceScheduleStatusHtml(s))}${infoItem('TG dự kiến',maintenanceFmtHours(s.estimatedHours))}</div><div class="note-box" style="margin-top:14px"><b>Nội dung:</b> ${esc(s.task||'')}</div>${s.note?`<div class="note-box" style="margin-top:8px"><b>Ghi chú:</b> ${esc(s.note)}</div>`:''}`,foot:`<button class="btn" data-act="modal-close">Đóng</button>${s.status!=='DONE'?`<button class="btn btn-primary" data-act="maintenance-schedule-complete" data-id="${esc(id)}"><i class="fa-solid fa-check"></i>Hoàn thành bảo trì</button>`:''}`});}
function openMaintenanceScheduleComplete(id){const s=(DB.maintenanceSchedules||[]).find(x=>x.id===id);if(!s||s.status==='DONE')return;Modal.open({title:`Hoàn thành bảo trì · ${id}`,sub:maintenanceEquipment(s.equipmentId)?.name||s.equipmentId,size:'md',body:`<div class="form-grid cols-2"><div class="field"><label>Ngày thực hiện</label><input class="inp" id="mntSchDoneDate" type="date" min="${maintenanceToday()}" value="${maintenanceToday()}"></div><div class="field"><label>Tổng thời gian máy ngừng hoạt động (giờ)</label><input class="inp right num" id="mntSchDowntime" type="number" min="0" step="0.25" value="0"></div><div class="field"><label>Chi phí</label><input class="inp right num" id="mntSchCost" type="number" min="0" step="1000" value="0"></div><div class="field" style="grid-column:1/-1"><label>Kết quả / ghi chú</label><textarea class="inp" id="mntSchResult" rows="3"></textarea></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="maintenance-schedule-complete-save" data-id="${esc(id)}">Xác nhận hoàn thành</button>`});}
function maintenanceCompleteSchedule(id){const s=(DB.maintenanceSchedules||[]).find(x=>x.id===id);if(!s||s.status==='DONE')return;const e=maintenanceEquipment(s.equipmentId),date=$('#mntSchDoneDate')?.value||maintenanceToday(),downtime=Number($('#mntSchDowntime')?.value||0),cost=Number($('#mntSchCost')?.value||0),result=$('#mntSchResult')?.value?.trim()||'';s.status='DONE';s.completedDate=date;s.actualDowntime=downtime;s.cost=cost;s.result=result;if(e){e.lastMaintenance=date;e.nextMaintenance=addDays(date,Number(e.cycleDays||30));e.status='OPERATING';}(DB.maintenanceLogs||(DB.maintenanceLogs=[])).unshift({id:nextCode('NKM-2026-',DB.maintenanceLogs||[]),equipmentId:s.equipmentId,date,type:'MAINTENANCE',refId:s.id,downtimeHours:downtime,cost,note:result||s.task});/* Không tạo lịch kỳ kế tiếp ngay. Hệ thống chỉ tự tạo khi còn <= 7 ngày tới e.nextMaintenance. */maintenanceEnsureUpcomingSchedules();maintenancePersist();Modal.close();render();Toast.ok('Đã hoàn thành bảo trì',`${id} · kỳ kế tiếp ${e?.nextMaintenance?fmtDate(e.nextMaintenance):''}; lịch sẽ tự tạo trước 7 ngày`);}
function maintenanceDeleteSchedule(id){const i=(DB.maintenanceSchedules||[]).findIndex(x=>x.id===id);if(i<0)return;if(DB.maintenanceSchedules[i].status==='DONE'){Toast.warn('Không thể xóa','Lịch đã hoàn thành.');return;}DB.maintenanceSchedules.splice(i,1);maintenancePersist();render();Toast.ok('Đã xóa lịch bảo trì',id);}

function openMaintenanceWoForm(){maintenanceHydrate();Modal.open({title:'Tạo phiếu sửa chữa',sub:'Ghi nhận sự cố thiết bị và theo dõi từ lúc báo hỏng đến khi khôi phục',size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Thiết bị *</label><select class="inp" id="mntWoEq">${(DB.maintenanceEquipment||[]).filter(e=>e.status!=='INACTIVE').map(e=>`<option value="${esc(e.id)}">${esc(e.id)} — ${esc(e.name)}</option>`).join('')}</select></div><div class="field"><label>Ngày báo hỏng</label><input class="inp" id="mntWoDate" type="date" min="${maintenanceToday()}" value="${maintenanceToday()}"></div><div class="field"><label>Mức ưu tiên</label><select class="inp" id="mntWoPriority"><option value="LOW">Thấp</option><option value="MEDIUM" selected>Trung bình</option><option value="HIGH">Cao</option><option value="CRITICAL">Khẩn cấp</option></select></div><div class="field"><label>Loại phiếu</label><select class="inp" id="mntWoType"><option value="CORRECTIVE">Sửa chữa sự cố</option><option value="INSPECTION">Kiểm tra kỹ thuật</option></select></div><div class="field" style="grid-column:1/-1"><label>Mô tả sự cố *</label><textarea class="inp" id="mntWoIssue" rows="3" placeholder="Triệu chứng, vị trí, ảnh hưởng sản xuất…"></textarea></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="maintenance-wo-save">Tạo phiếu</button>`});}
function maintenanceSaveWo(){const equipmentId=$('#mntWoEq')?.value,issue=$('#mntWoIssue')?.value?.trim(),date=$('#mntWoDate')?.value||maintenanceToday();if(!equipmentId||!issue){Toast.err('Thiếu thông tin','Vui lòng chọn thiết bị và mô tả sự cố.');return;}const id=nextCode('SC-2026-',DB.maintenanceWorkOrders||[]);(DB.maintenanceWorkOrders||(DB.maintenanceWorkOrders=[])).unshift({id,equipmentId,type:$('#mntWoType')?.value||'CORRECTIVE',priority:$('#mntWoPriority')?.value||'MEDIUM',reportedDate:date,issue,status:'OPEN',downtimeHours:0,cost:0,createdBy:DB.currentUser?.id||''});const e=maintenanceEquipment(equipmentId);if(e)e.status='DOWN';maintenancePersist();Modal.close();render();Toast.ok('Đã tạo phiếu sửa chữa',id);}
function openMaintenanceWoDetail(id){const w=(DB.maintenanceWorkOrders||[]).find(x=>x.id===id);if(!w)return;const e=maintenanceEquipment(w.equipmentId);Modal.open({title:`Phiếu sửa chữa · ${w.id}`,sub:e?.name||w.equipmentId,size:'lg',body:`<div class="info-grid">${infoItem('Trạng thái',maintenanceWoStatusHtml(w.status))}${infoItem('Ngày báo',fmtDate(w.reportedDate))}${infoItem('Ưu tiên',esc(w.priority||'—'))}${infoItem('Bắt đầu',w.startedDate?fmtDate(w.startedDate):'—')}${infoItem('Hoàn tất',w.completedDate?fmtDate(w.completedDate):'—')}${infoItem('Tổng thời gian máy ngừng hoạt động',maintenanceFmtHours(w.downtimeHours))}${infoItem('Chi phí',fmtVND(w.cost||0))}</div><div class="note-box" style="margin-top:14px"><b>Sự cố:</b> ${esc(w.issue||'')}</div>${w.resolution?`<div class="note-box" style="margin-top:8px"><b>Xử lý:</b> ${esc(w.resolution)}</div>`:''}`,foot:`<button class="btn" data-act="modal-close">Đóng</button>${w.status==='OPEN'?`<button class="btn btn-primary" data-act="maintenance-wo-start" data-id="${esc(id)}"><i class="fa-solid fa-play"></i>Bắt đầu sửa</button>`:''}${w.status==='IN_PROGRESS'?`<button class="btn btn-primary" data-act="maintenance-wo-complete" data-id="${esc(id)}"><i class="fa-solid fa-check"></i>Hoàn tất sửa chữa</button>`:''}`});}
function maintenanceStartWo(id){const w=(DB.maintenanceWorkOrders||[]).find(x=>x.id===id);if(!w||w.status!=='OPEN')return;w.status='IN_PROGRESS';w.startedDate=maintenanceToday();const e=maintenanceEquipment(w.equipmentId);if(e)e.status='DOWN';maintenancePersist();Modal.close();render();Toast.ok('Đã bắt đầu sửa chữa',id);}
function openMaintenanceWoComplete(id){const w=(DB.maintenanceWorkOrders||[]).find(x=>x.id===id);if(!w||w.status!=='IN_PROGRESS')return;Modal.open({title:`Hoàn tất sửa chữa · ${id}`,sub:maintenanceEquipment(w.equipmentId)?.name||w.equipmentId,size:'md',body:`<div class="form-grid cols-2"><div class="field"><label>Ngày hoàn tất</label><input class="inp" id="mntWoDoneDate" type="date" min="${maintenanceToday()}" value="${maintenanceToday()}"></div><div class="field"><label>Tổng thời gian máy ngừng hoạt động (giờ) *</label><input class="inp right num" id="mntWoDowntime" type="number" min="0" step="0.25" value="1"></div><div class="field"><label>Chi phí sửa chữa</label><input class="inp right num" id="mntWoCost" type="number" min="0" step="1000" value="0"></div><div class="field" style="grid-column:1/-1"><label>Biện pháp xử lý *</label><textarea class="inp" id="mntWoResolution" rows="3"></textarea></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="maintenance-wo-complete-save" data-id="${esc(id)}">Xác nhận hoàn tất</button>`});}
function maintenanceCompleteWo(id){const w=(DB.maintenanceWorkOrders||[]).find(x=>x.id===id);if(!w||w.status!=='IN_PROGRESS')return;const downtime=Number($('#mntWoDowntime')?.value||0),resolution=$('#mntWoResolution')?.value?.trim();if(!resolution){Toast.err('Thiếu thông tin','Vui lòng nhập biện pháp xử lý.');return;}w.status='COMPLETED';w.completedDate=$('#mntWoDoneDate')?.value||maintenanceToday();w.downtimeHours=downtime;w.cost=Number($('#mntWoCost')?.value||0);w.resolution=resolution;const e=maintenanceEquipment(w.equipmentId);if(e)e.status='OPERATING';(DB.maintenanceLogs||(DB.maintenanceLogs=[])).unshift({id:nextCode('NKM-2026-',DB.maintenanceLogs||[]),equipmentId:w.equipmentId,date:w.completedDate,type:'REPAIR',refId:w.id,downtimeHours:w.downtimeHours,cost:w.cost,note:resolution});maintenancePersist();Modal.close();render();Toast.ok('Đã hoàn tất sửa chữa',id);}

function openMaintenanceLogForm(){maintenanceHydrate();Modal.open({title:'Ghi nhật ký máy',sub:'Ghi nhận kiểm tra, dừng máy hoặc ghi chú vận hành',size:'md',body:`<div class="form-grid cols-2"><div class="field"><label>Thiết bị *</label><select class="inp" id="mntLogEq">${(DB.maintenanceEquipment||[]).map(e=>`<option value="${esc(e.id)}">${esc(e.id)} — ${esc(e.name)}</option>`).join('')}</select></div><div class="field"><label>Ngày</label><input class="inp" id="mntLogDate" type="date" min="${maintenanceToday()}" value="${maintenanceToday()}"></div><div class="field"><label>Loại nhật ký</label><select class="inp" id="mntLogType"><option value="INSPECTION">Kiểm tra</option><option value="DOWNTIME">Dừng máy</option><option value="NOTE">Ghi chú</option></select></div><div class="field"><label>Tổng thời gian máy ngừng hoạt động (giờ)</label><input class="inp right num" id="mntLogDowntime" type="number" min="0" step="0.25" value="0"></div><div class="field" style="grid-column:1/-1"><label>Nội dung *</label><textarea class="inp" id="mntLogNote" rows="3"></textarea></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="maintenance-log-save">Lưu nhật ký</button>`});}
function maintenanceSaveLog(){const equipmentId=$('#mntLogEq')?.value,note=$('#mntLogNote')?.value?.trim();if(!equipmentId||!note){Toast.err('Thiếu thông tin','Vui lòng chọn thiết bị và nhập nội dung.');return;}const type=$('#mntLogType')?.value||'NOTE',downtime=Number($('#mntLogDowntime')?.value||0);(DB.maintenanceLogs||(DB.maintenanceLogs=[])).unshift({id:nextCode('NKM-2026-',DB.maintenanceLogs||[]),equipmentId,date:$('#mntLogDate')?.value||maintenanceToday(),type,refId:'',downtimeHours:downtime,cost:0,note});const e=maintenanceEquipment(equipmentId);if(e&&type==='DOWNTIME'&&downtime>0)e.status='DOWN';maintenancePersist();Modal.close();render();Toast.ok('Đã ghi nhật ký máy',note);}
function openMaintenanceLogDetail(id){const l=(DB.maintenanceLogs||[]).find(x=>x.id===id);if(!l)return;const e=maintenanceEquipment(l.equipmentId);Modal.open({title:`Nhật ký máy · ${l.id}`,sub:e?.name||l.equipmentId,size:'md',body:`<div class="info-grid">${infoItem('Ngày',fmtDate(l.date))}${infoItem('Loại',esc(l.type))}${infoItem('Tham chiếu',`<span class="code">${esc(l.refId||'—')}</span>`)}${infoItem('Tổng thời gian máy ngừng hoạt động',maintenanceFmtHours(l.downtimeHours))}${infoItem('Chi phí',fmtVND(l.cost||0))}</div><div class="note-box" style="margin-top:14px">${esc(l.note||'')}</div>`,foot:'<button class="btn" data-act="modal-close">Đóng</button>'});}
