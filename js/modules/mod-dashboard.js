/* ============================================================================
 * MODULE: DASHBOARD — Tổng quan doanh nghiệp
 * Dashboard quản trị tổng hợp, sử dụng dữ liệu runtime hiện có trong DB.
 * ==========================================================================*/

const DASHBOARD_PERIODS = {
  day: 'Ngày',
  w7: '7 ngày',
  month: 'Tháng',
  quarter: 'Quý',
  year: 'Năm',
};

function dashboardDate(v){
  const s=String(v||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';
}
function dashboardToday(){
  if(typeof currentDateYMD==='function') return currentDateYMD();
  return dashboardDate(DB.today)||new Date().toISOString().slice(0,10);
}
function dashboardAddDays(iso,n){ const d=new Date(`${iso}T00:00:00`); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function dashboardMonthEnd(ym){ const [y,m]=String(ym||'').split('-').map(Number); if(!y||!m)return dashboardToday(); return new Date(y,m,0).toISOString().slice(0,10); }
function dashboardPeriodRange(f){
  const today=dashboardToday();
  const currentMonth=today.slice(0,7);
  const currentYear=Number(today.slice(0,4));
  const currentQuarter=Math.floor((Number(today.slice(5,7))-1)/3)+1;
  const mode=f?.period||'month';
  if(mode==='day'){
    const d=dashboardDate(f?.date)||today;
    return {start:d,end:d,label:`ngày ${fmtDate(d)}`};
  }
  if(mode==='w7'){
    const end=dashboardDate(f?.w7End)||today;
    const start=dashboardAddDays(end,-6);
    return {start,end,label:`7 ngày ${fmtDate(start)} – ${fmtDate(end)}`};
  }
  if(mode==='quarter'){
    const year=Number(f?.year)||currentYear;
    const q=Math.min(4,Math.max(1,Number(f?.quarterValue)||currentQuarter));
    const sm=(q-1)*3+1;
    const em=sm+2;
    const start=`${year}-${String(sm).padStart(2,'0')}-01`;
    const end=dashboardMonthEnd(`${year}-${String(em).padStart(2,'0')}`);
    return {start,end,label:`Quý ${['I','II','III','IV'][q-1]}/${year}`};
  }
  if(mode==='year'){
    const year=Number(f?.year)||currentYear;
    return {start:`${year}-01-01`,end:`${year}-12-31`,label:`năm ${year}`};
  }
  const ym=/^\d{4}-\d{2}$/.test(String(f?.month||''))?String(f.month):currentMonth;
  return {start:`${ym}-01`,end:dashboardMonthEnd(ym),label:`tháng ${Number(ym.slice(5,7))}/${ym.slice(0,4)}`};
}
function dashboardPeriodControls(f){
  const today=dashboardToday();
  const year=Number(f.year)||Number(today.slice(0,4));
  const curQ=Math.floor((Number(today.slice(5,7))-1)/3)+1;
  const years=[]; for(let y=Number(today.slice(0,4))+1;y>=2024;y--) years.push(y);
  let picker='';
  if((f.period||'month')==='day') picker=`<input class="inp" type="date" data-f="dashboard.date" data-allow-past="1" value="${esc(dashboardDate(f.date)||today)}">`;
  else if(f.period==='w7') picker=`<input class="inp" type="date" data-f="dashboard.w7End" data-allow-past="1" value="${esc(dashboardDate(f.w7End)||today)}" title="Chọn ngày kết thúc của khoảng 7 ngày">`;
  else if(f.period==='quarter') picker=`<select class="inp" data-f="dashboard.quarterValue">${[1,2,3,4].map(q=>`<option value="${q}" ${Number(f.quarterValue||curQ)===q?'selected':''}>Quý ${['I','II','III','IV'][q-1]}</option>`).join('')}</select><select class="inp" data-f="dashboard.year">${years.map(y=>`<option value="${y}" ${year===y?'selected':''}>${y}</option>`).join('')}</select>`;
  else if(f.period==='year') picker=`<select class="inp" data-f="dashboard.year">${years.map(y=>`<option value="${y}" ${year===y?'selected':''}>${y}</option>`).join('')}</select>`;
  else picker=`<input class="inp" type="month" data-f="dashboard.month" value="${esc(/^\d{4}-\d{2}$/.test(String(f.month||''))?f.month:today.slice(0,7))}">`;
  return `<select class="inp" data-f="dashboard.period" style="min-width:120px">${Object.entries(DASHBOARD_PERIODS).map(([k,v])=>`<option value="${k}" ${(f.period||'month')===k?'selected':''}>${v}</option>`).join('')}</select>${picker}`;
}
function dashboardInRange(date,range){ const d=dashboardDate(date); return !!d && d>=range.start && d<=range.end; }
function dashboardSum(arr,fn){ return (arr||[]).reduce((s,x)=>s+Number(fn(x)||0),0); }
function dashboardOrderRevenue(o){ return Number(o?.total||0); }
function dashboardRestaurantTotal(o){
  if(typeof restaurantOrderTotal==='function') return Number(restaurantOrderTotal(o)||0);
  return (o?.items||[]).reduce((s,i)=>s+Number(i.quantity||i.qty||0)*Number(i.price||0),0);
}
function dashboardInventoryValue(){
  if(typeof Q!=='undefined' && typeof Q.inventoryValue==='function') return Number(Q.inventoryValue()||0);
  return dashboardSum(DB.materials,m=>Number(m.stock||0)*Number(m.price||0));
}
function dashboardPayable(){ return dashboardSum(DB.purchaseOrders,po=>Math.max(0,Number(po.total||0)-Number(po.paid||0))); }
function dashboardReceivable(){ return dashboardSum(DB.customers,c=>Math.max(0,Number(c.debt||0))); }
function dashboardKpi({label,value,unit='',icon='fa-chart-line',tone='blue',note='',act='',data=''}){
  return `<div class="kpi" ${act?`data-act="${act}" ${data}`:''}>
    <div class="kpi-top"><span class="kpi-ico t-${tone}"><i class="fa-solid ${icon}"></i></span><div style="min-width:0"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}${unit?`<span class="kpi-unit">${esc(unit)}</span>`:''}</div></div></div>
    <div class="kpi-foot"><span class="kpi-note">${note}</span></div>
  </div>`;
}
function dashboardMonthKey(date){ const s=dashboardDate(date); return s?s.slice(0,7):''; }
function dashboardMonthLabel(key){ if(!key)return ''; const [y,m]=key.split('-'); return `T${Number(m)}/${y}`; }
function dashboardLastMonths(count=6){
  const d=new Date(`${dashboardToday()}T00:00:00`), out=[];
  for(let i=count-1;i>=0;i--){ const x=new Date(d.getFullYear(),d.getMonth()-i,1); out.push(`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`); }
  return out;
}
function dashboardMetrics(filters){
  const range=dashboardPeriodRange(filters);
  const sales=(DB.orders||[]).filter(o=>dashboardInRange(o.date,range)&&o.status!=='dh_da_huy');
  const recognized=sales.filter(o=>['dh_hoan_thanh','dh_da_giao'].includes(o.status));
  const rest=(DB.posOrders||[]).filter(o=>dashboardInRange(o.date||o.createdAt,range));
  const restPaid=rest.filter(o=>o.status==='PAID');
  const salesRevenue=dashboardSum(recognized,dashboardOrderRevenue);
  const restaurantRevenue=dashboardSum(restPaid,dashboardRestaurantTotal);
  const revenue=salesRevenue+restaurantRevenue;
  const activeProduction=(DB.productionOrders||[]).filter(p=>!['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(p.status));
  const qcWaiting=(DB.productionOrders||[]).filter(p=>p.status==='lsx_dang_qc').length;
  const lowStock=(typeof Q!=='undefined'&&typeof Q.lowStock==='function')?Q.lowStock():[];
  const late=(typeof Q!=='undefined'&&typeof Q.lateProduction==='function')?Q.lateProduction():[];
  const pendingPR=(DB.purchases||[]).filter(p=>['mh_cho_duyet','PENDING_APPROVAL'].includes(p.status));
  const poInbound=(DB.purchaseOrders||[]).filter(po=>['SHIPPING','PARTIAL_RECEIVED'].includes(po.status));
  const restaurantOpen=(DB.posOrders||[]).filter(o=>['OPEN','KITCHEN_WAITING','COOKING','READY','SERVED'].includes(o.status));
  return {range,sales,recognized,rest,restPaid,revenue,salesRevenue,restaurantRevenue,activeProduction,qcWaiting,lowStock,late,pendingPR,poInbound,restaurantOpen};
}


function dashboardAuditDate(a){ return dashboardDate(String(a?.createdAt||'').replace(' ','T')); }
function dashboardAuditTime(v){
  const s=String(v||'').trim(); if(!s)return '—';
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m?`${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}${m[6]?`:${m[6]}`:''}`:s;
}
function dashboardAuditTone(module){
  const m=String(module||'').toUpperCase();
  if(m==='PURCHASE')return 'orange'; if(m==='INVENTORY'||m==='WAREHOUSE')return 'teal'; if(m==='CRM')return 'blue';
  if(m==='PRODUCTION')return 'indigo'; if(m==='QUALITY')return 'red'; if(m==='ACCOUNTING')return 'green'; if(m==='AUTH'||m==='SYSTEM')return 'slate';
  return 'blue';
}
function dashboardAuditIcon(module){
  const m=String(module||'').toUpperCase();
  return ({PURCHASE:'fa-cart-shopping',INVENTORY:'fa-warehouse',WAREHOUSE:'fa-warehouse',CRM:'fa-handshake',PRODUCTION:'fa-industry',QUALITY:'fa-flask',ACCOUNTING:'fa-calculator',AUTH:'fa-right-to-bracket',SYSTEM:'fa-shield-halved'})[m]||'fa-clock-rotate-left';
}
function dashboardAuditRows(filters={}){
  const q=String(filters.q||'').trim().toLowerCase(), module=String(filters.module||''), userId=String(filters.userId||'');
  const from=dashboardDate(filters.from), to=dashboardDate(filters.to);
  return [...(DB.auditLogs||[])].filter(a=>{
    const d=dashboardAuditDate(a);
    if(from && (!d || d<from))return false; if(to && (!d || d>to))return false;
    if(module && String(a.module||'')!==module)return false;
    if(userId && String(a.userId||a.employeeId||'')!==userId && String(a.employeeId||'')!==userId)return false;
    if(q){ const hay=`${a.fullName||''} ${a.username||''} ${a.description||''} ${a.entityId||''} ${a.action||''} ${a.module||''}`.toLowerCase(); if(!hay.includes(q))return false; }
    return true;
  }).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
function dashboardOpenAuditModal(filters={}){
  const rows=dashboardAuditRows(filters);
  const modules=[...new Set((DB.auditLogs||[]).map(a=>String(a.module||'')).filter(Boolean))].sort();
  const users=[...new Map((DB.auditLogs||[]).map(a=>[String(a.userId||a.employeeId||a.username||''),{id:String(a.userId||a.employeeId||a.username||''),name:a.fullName||a.username||'—'}])).values()].filter(x=>x.id).sort((a,b)=>a.name.localeCompare(b.name,'vi'));
  const bodyRows=rows.map(a=>`<tr><td class="num">${esc(dashboardAuditTime(a.createdAt))}</td><td>${cell2(esc(a.fullName||a.username||'Hệ thống'),esc(a.department||a.roleName||''))}</td><td><span class="badge ${dashboardAuditTone(a.module)}">${esc(a.module||'SYSTEM')}</span></td><td>${cell2(esc(a.description||a.action||'—'),a.entityId?`<span class="code">${esc(a.entityId)}</span>`:'')}</td></tr>`).join('');
  Modal.open({title:'Dấu vết hoạt động hệ thống',sub:`${fmtN(rows.length)} bản ghi thao tác từ KIO · xem được hoạt động của tất cả tài khoản ERP`,size:'xl',body:`
    <div class="filters" style="margin-bottom:12px;grid-template-columns:minmax(220px,1fr) 180px 220px 160px 160px auto">
      <input class="inp" id="dashAuditQ" value="${esc(filters.q||'')}" placeholder="Tìm người dùng, chứng từ, thao tác...">
      <select class="inp" id="dashAuditModule"><option value="">Tất cả phân hệ</option>${modules.map(m=>`<option value="${esc(m)}" ${filters.module===m?'selected':''}>${esc(m)}</option>`).join('')}</select>
      <select class="inp" id="dashAuditUser"><option value="">Tất cả nhân viên</option>${users.map(u=>`<option value="${esc(u.id)}" ${filters.userId===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select>
      <input class="inp" id="dashAuditFrom" type="date" data-allow-past="1" value="${esc(filters.from||'')}">
      <input class="inp" id="dashAuditTo" type="date" data-allow-past="1" value="${esc(filters.to||'')}">
      <button class="btn" data-act="dashboard-activity-apply"><i class="fa-solid fa-filter"></i>Lọc</button>
    </div>
    ${tableShell([{t:'Thời gian',w:'165px'},{t:'Nhân viên',w:'220px'},{t:'Phân hệ',w:'135px'},{t:'Dấu vết thao tác'}],bodyRows,{emptyTitle:'Không có hoạt động phù hợp bộ lọc'})}
  `,foot:`<button class="btn" data-act="dashboard-activity-reset"><i class="fa-solid fa-rotate-left"></i>Xóa lọc</button><button class="btn btn-primary" data-act="modal-close">Đóng</button>`});
}

Views.dashboard=function(){
  const f=F('dashboard',{period:'month',date:dashboardToday(),w7End:dashboardToday(),month:dashboardToday().slice(0,7),quarterValue:String(Math.floor((Number(dashboardToday().slice(5,7))-1)/3)+1),year:dashboardToday().slice(0,4)}); const M=dashboardMetrics(f);
  const inventoryValue=dashboardInventoryValue(), receivable=dashboardReceivable(), payable=dashboardPayable();
  const orderStatuses=['dh_cho_xu_ly','dh_cho_san_xuat','dh_dang_san_xuat','dh_hoan_thanh','dh_da_giao','dh_da_huy'];
  const orderCounts=orderStatuses.map(s=>(DB.orders||[]).filter(o=>o.status===s).length);
  const productionStatuses=[
    ['Đang sản xuất',(DB.productionOrders||[]).filter(x=>x.status==='lsx_dang_san_xuat').length,'blue'],
    ['Chờ QC',(DB.productionOrders||[]).filter(x=>x.status==='lsx_dang_qc').length,'orange'],
    ['Hoàn thành',(DB.productionOrders||[]).filter(x=>['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(x.status)).length,'green'],
    ['Khác',(DB.productionOrders||[]).filter(x=>!['lsx_dang_san_xuat','lsx_dang_qc','lsx_hoan_thanh','lsx_da_nhap_kho'].includes(x.status)).length,'slate'],
  ];
  const alerts=[
    M.lowStock.length?{icon:'fa-box-open',title:`${M.lowStock.length} vật tư dưới tồn tối thiểu`,sub:`Ưu tiên: ${M.lowStock.slice(0,2).map(x=>x.name).join(', ')}`,id:'warehouse',tab:'inventory'}:null,
    M.late.length?{icon:'fa-clock',title:`${M.late.length} lệnh sản xuất sắp/đã trễ`,sub:`Cần kiểm tra tiến độ và nguồn lực sản xuất`,id:'production',tab:'progress'}:null,
    M.pendingPR.length?{icon:'fa-cart-shopping',title:`${M.pendingPR.length} đề nghị mua đang chờ duyệt`,sub:`Giá trị ${fmtVND(dashboardSum(M.pendingPR,x=>x.total))}`,id:'purchases',tab:'pr'}:null,
    M.poInbound.length?{icon:'fa-truck-ramp-box',title:`${M.poInbound.length} PO đang giao / nhận một phần`,sub:'Theo dõi tiến độ nhập kho từ nhà cung cấp',id:'purchases',tab:'po'}:null,
    M.restaurantOpen.length?{icon:'fa-utensils',title:`${M.restaurantOpen.length} đơn Nhà hàng đang xử lý`,sub:'POS / Tablet / QR / Bếp',id:'restaurant',tab:'pos'}:null,
  ].filter(Boolean);

  const recent=[...(DB.orders||[])].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,6);
  const recentRows=recent.map(o=>`<tr class="clickable" data-act="open-order" data-id="${esc(o.id)}"><td><span class="code">${esc(o.id)}</span></td><td>${esc(Q.customerName(o.customerId)||o.customerId)}</td><td class="hide-sm">${esc((o.items||[])[0]?.name||'—')}${(o.items||[]).length>1?`<div class="cell-sub">+ ${(o.items||[]).length-1} sản phẩm khác</div>`:''}</td><td class="right num">${fmtVND(o.total||0)}</td><td>${badge(o.status)}</td></tr>`).join('');

  return `${pageHead('Tổng quan doanh nghiệp','Theo dõi nhanh các chỉ số quan trọng của bán hàng, sản xuất, kho, mua hàng và tài chính',`
    ${dashboardPeriodControls(f)}
    <button class="btn" data-act="export-dashboard"><i class="fa-solid fa-file-arrow-down"></i>Xuất báo cáo</button>`)}

  <div class="grid g-auto" style="margin-bottom:14px">
    ${dashboardKpi({label:`Doanh thu ${M.range.label.toLowerCase()}`,value:fmtShort(M.revenue),icon:'fa-sack-dollar',tone:'green',note:`Bán hàng ${fmtShort(M.salesRevenue)} · Nhà hàng ${fmtShort(M.restaurantRevenue)}`,act:'go',data:'data-id="crm" data-tab="orders"'})}
    ${dashboardKpi({label:'Đơn bán phát sinh',value:fmtN(M.sales.length+M.rest.length),unit:'đơn',icon:'fa-cart-flatbed',tone:'blue',note:`CRM ${M.sales.length} · Nhà hàng ${M.rest.length}`,act:'go',data:'data-id="crm" data-tab="orders"'})}
    ${dashboardKpi({label:'Lệnh SX đang mở',value:fmtN(M.activeProduction.length),unit:'lệnh',icon:'fa-industry',tone:'indigo',note:`${M.qcWaiting} lệnh đang chờ QC`,act:'go',data:'data-id="production" data-tab="progress"'})}
    ${dashboardKpi({label:'Giá trị tồn NVL',value:fmtShort(inventoryValue),icon:'fa-warehouse',tone:'teal',note:`${M.lowStock.length} vật tư dưới định mức`,act:'go',data:'data-id="warehouse" data-tab="inventory"'})}
    ${dashboardKpi({label:'Công nợ phải thu',value:fmtShort(receivable),icon:'fa-file-invoice-dollar',tone:'orange',note:`${(DB.customers||[]).filter(c=>Number(c.debt||0)>0).length} khách hàng còn dư nợ`,act:'go',data:'data-id="accounting" data-tab="ar"'})}
    ${dashboardKpi({label:'Công nợ phải trả',value:fmtShort(payable),icon:'fa-money-bill-transfer',tone:'red',note:`${(DB.purchaseOrders||[]).filter(po=>Number(po.total||0)>Number(po.paid||0)).length} PO còn phải thanh toán`,act:'go',data:'data-id="purchases" data-tab="debts"'})}
  </div>

  <div class="grid g-31" style="margin-bottom:14px">
    <div class="card"><div class="card-head"><div><h3>Doanh thu 6 tháng gần nhất</h3><p>Doanh thu đã ghi nhận từ đơn bán hoàn thành/đã giao và đơn nhà hàng đã thanh toán</p></div></div><div class="card-body"><div class="chart-box"><canvas id="chRevenue"></canvas></div></div></div>
    <div class="card"><div class="card-head"><div><h3>Trạng thái đơn bán</h3><p>${fmtN((DB.orders||[]).length)} đơn CRM đang được theo dõi</p></div></div><div class="card-body"><div class="chart-box sm"><canvas id="chOrderStatus"></canvas></div><div class="legend">${orderStatuses.map((s,i)=>`<span class="legend-item"><span class="legend-dot" style="background:var(--${statusTone(s)})"></span>${esc(statusLabel(s))} · <b>${orderCounts[i]}</b></span>`).join('')}</div></div></div>
  </div>

  <div class="grid g-31" style="margin-bottom:14px">
    <div class="card"><div class="card-head"><div><h3>Tình hình sản xuất</h3><p>Phân bổ lệnh sản xuất theo trạng thái hiện tại</p></div><div class="right"><button class="btn btn-sm" data-act="go" data-id="production" data-tab="progress">Xem tiến độ</button></div></div><div class="card-body"><div class="chart-box"><canvas id="chProductionStatus"></canvas></div></div></div>
    <div class="card"><div class="card-head"><div><h3>Cần xử lý</h3><p>Các điểm quản trị cần chú ý ngay</p></div></div><div class="card-body" style="display:flex;flex-direction:column;gap:9px">${alerts.length?alerts.slice(0,5).map(a=>`<div class="alert-item" data-act="go" data-id="${a.id}" data-tab="${a.tab}"><span class="alert-ico t-orange"><i class="fa-solid ${a.icon}"></i></span><span style="min-width:0"><span class="alert-title">${esc(a.title)}</span><div class="alert-sub">${esc(a.sub)}</div></span><i class="fa-solid fa-chevron-right"></i></div>`).join(''):`<div class="empty"><div class="empty-ico t-green"><i class="fa-solid fa-check"></i></div><h4>Không có cảnh báo</h4><p>Các chỉ số chính đang trong ngưỡng bình thường.</p></div>`}</div></div>
  </div>

  <div class="grid g-31">
    <div class="card"><div class="card-head"><div><h3>Đơn bán gần đây</h3><p>6 đơn CRM mới nhất</p></div><div class="right"><button class="btn btn-sm" data-act="go" data-id="crm" data-tab="orders">Xem tất cả <i class="fa-solid fa-arrow-right"></i></button></div></div>${tableShell([{t:'Mã đơn'},{t:'Khách hàng'},{t:'Sản phẩm',cls:'hide-sm'},{t:'Giá trị',cls:'right'},{t:'Trạng thái'}],recentRows,{emptyTitle:'Chưa có đơn bán'})}</div>
    <div class="card"><div class="card-head"><div><h3>Hoạt động gần đây</h3><p>Dấu vết thao tác thật từ nhật ký hệ thống</p></div><div class="right"><button class="btn btn-sm" data-act="dashboard-activity-all">Xem tất cả <i class="fa-solid fa-arrow-right"></i></button></div></div><div class="card-body"><div class="tline">${dashboardAuditRows().slice(0,7).map(a=>{const tone=dashboardAuditTone(a.module);return `<div class="tline-item done clickable" data-act="dashboard-activity-all"><span class="tline-dot t-${tone}" style="background:var(--surface);border-color:var(--${tone})"><i class="fa-solid ${dashboardAuditIcon(a.module)}" style="color:var(--${tone})"></i></span><div class="tline-title">${esc(a.fullName||a.username||'Hệ thống')} <span style="font-weight:400;color:var(--text-2)">${esc(a.description||a.action||'')}</span></div><div class="tline-sub">${a.entityId?`<span class="code">${esc(a.entityId)}</span> · `:''}${esc(a.module||'SYSTEM')} · ${esc(dashboardAuditTime(a.createdAt))}</div></div>`;}).join('')||'<div class="empty"><p>Chưa có dấu vết hoạt động trên server.</p></div>'}</div></div></div>
  </div>`;
};

Views.dashboard.after=function(){
  const months=dashboardLastMonths(6);
  const crm=(DB.orders||[]).filter(o=>['dh_hoan_thanh','dh_da_giao'].includes(o.status));
  const rest=(DB.posOrders||[]).filter(o=>o.status==='PAID');
  const values=months.map(m=>dashboardSum(crm.filter(o=>dashboardMonthKey(o.date)===m),dashboardOrderRevenue)+dashboardSum(rest.filter(o=>dashboardMonthKey(o.date||o.createdAt)===m),dashboardRestaurantTotal));
  Charts.line('chRevenue',months.map(dashboardMonthLabel),values,{label:'Doanh thu'});
  const orderStatuses=['dh_cho_xu_ly','dh_cho_san_xuat','dh_dang_san_xuat','dh_hoan_thanh','dh_da_giao','dh_da_huy'];
  Charts.donut('chOrderStatus',orderStatuses.map(statusLabel),orderStatuses.map(s=>(DB.orders||[]).filter(o=>o.status===s).length),orderStatuses.map(statusTone));
  const ps=[
    ['Đang sản xuất',(DB.productionOrders||[]).filter(x=>x.status==='lsx_dang_san_xuat').length],
    ['Chờ QC',(DB.productionOrders||[]).filter(x=>x.status==='lsx_dang_qc').length],
    ['Hoàn thành',(DB.productionOrders||[]).filter(x=>['lsx_hoan_thanh','lsx_da_nhap_kho'].includes(x.status)).length],
    ['Khác',(DB.productionOrders||[]).filter(x=>!['lsx_dang_san_xuat','lsx_dang_qc','lsx_hoan_thanh','lsx_da_nhap_kho'].includes(x.status)).length],
  ];
  Charts.bar('chProductionStatus',ps.map(x=>x[0]),[{label:'Số lệnh',data:ps.map(x=>x[1]),color:'indigo'}]);
};
