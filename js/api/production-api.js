/* ============================================================================
 * PRODUCTION API - REAL SERVER COLLECTIONS v3
 * ----------------------------------------------------------------------------
 * Server/KIO là nguồn chuẩn. Mỗi collection sản xuất dùng một bảng lenam_*
 * riêng để màn nào cần gì chỉ đọc đúng bảng đó. localStorage chỉ là snapshot
 * khởi động + outbox chống mất dữ liệu nếu người dùng F5 ngay sau thao tác.
 * ========================================================================== */
const ProductionAPI = (() => {
  const TABLES = KIO_CONFIG.productionTables || {
    productionOrders:'lenam_production_orders',
    productionPlans:'lenam_production_plans',
    productionMaterialRequests:'lenam_production_material_requests',
    productionFinalInspections:'lenam_production_final_inspections',
  };
  const STAGE_TABLE = (KIO_CONFIG.productionStageProgressTable || 'lenam_production_stage_progress');
  const STAGE_REFRESH_TTL = 60*1000;
  let stageLastRefresh = 0;

  const LEGACY_TABLE = KIO_CONFIG.inventorySettingsTable;
  const LEGACY_STATE_ID = 'PRODUCTION_STATE';
  const LEGACY_IDS = Object.freeze({
    productionOrders:'PRODUCTION_ORDERS',
    productionPlans:'PRODUCTION_PLANS',
    productionMaterialRequests:'PRODUCTION_MATERIAL_REQUESTS',
    productionFinalInspections:'PRODUCTION_FINAL_INSPECTIONS',
  });
  const CACHE_KEY='lenam:production-cache:v3';
  const OLD_CACHE_KEY='lenam:production-cache:v2';
  const PENDING_KEY='lenam:production-pending:v3';
  const MIGRATION_KEY='lenam:production-dedicated-tables:migrated:v1';
  const REFRESH_TTL=60*1000;
  const lastRefresh=new Map();
  const localVersion=new Map();
  const pendingKeys=new Set();
  const syncingKeys=new Set();
  let syncTimer=null;
  let syncChain=Promise.resolve();
  let booted=false;
  let bootPromise=null;

  Object.keys(TABLES).forEach(k=>{ if(!Array.isArray(DB[k])) DB[k]=[]; });
  const clone=v=>JSON.parse(JSON.stringify(v));
  const normalizeKeys=keys=>{
    if(keys==null) return Object.keys(TABLES);
    const a=Array.isArray(keys)?keys:[keys];
    return [...new Set(a.filter(k=>TABLES[k]))];
  };
  const versionOf=k=>Number(localVersion.get(k)||0);
  function markLocal(keys){ normalizeKeys(keys).forEach(k=>localVersion.set(k,versionOf(k)+1)); }
  function readJson(key){ try{const x=JSON.parse(localStorage.getItem(key)||'null');return x&&typeof x==='object'?x:null;}catch(_){return null;} }
  function writeJson(key,val){ try{localStorage.setItem(key,JSON.stringify(val));return true;}catch(_){return false;} }
  function snapshot(){ return Object.fromEntries(Object.keys(TABLES).map(k=>[k,clone(DB[k]||[])])); }
  function writeCache(){ writeJson(CACHE_KEY,snapshot()); }
  function writePending(){
    if(pendingKeys.size) writeJson(PENDING_KEY,{keys:[...pendingKeys],at:Date.now()});
    else { try{localStorage.removeItem(PENDING_KEY);}catch(_){} }
  }
  function apply(data){ Object.keys(TABLES).forEach(k=>{if(Array.isArray(data?.[k])) DB[k]=data[k];}); }

  async function migrateLegacyIfNeeded(){
    try{
      if(localStorage.getItem(MIGRATION_KEY)==='1') return;
      // Chỉ probe bảng LSX. Nếu đã có dữ liệu thì bộ bảng dedicated đã được dùng,
      // không đọc 4 bảng + singleton legacy chỉ để kiểm tra migration.
      const probe=await KioStore.listCollection(TABLES.productionOrders);
      if(probe.length){ localStorage.setItem(MIGRATION_KEY,'1'); return; }
      const rows=await KioStore.listCollection(LEGACY_TABLE);
      const byId=new Map((rows||[]).map(r=>[String(r?.id||''),r]));
      const legacyState=byId.get(LEGACY_STATE_ID);
      let migrated=0;
      for(const [k,id] of Object.entries(LEGACY_IDS)){
        let items=[];
        const row=byId.get(id);
        if(row&&Array.isArray(row.items)) items=row.items;
        else if(legacyState&&Array.isArray(legacyState[k])) items=legacyState[k];
        if(items.length){ await KioStore.syncCollection(TABLES[k],items); migrated+=items.length; }
      }
      localStorage.setItem(MIGRATION_KEY,'1');
      if(migrated) console.info(`[ProductionAPI] Đã migrate ${migrated} bản ghi Production sang các bảng lenam_production_*.`);
    }catch(err){ console.warn('[ProductionAPI] Migration dữ liệu cũ chưa hoàn tất:',err); }
  }

  function syncCollections(keys){
    clearTimeout(syncTimer);
    const wanted=normalizeKeys(keys);
    syncChain=syncChain.catch(()=>{}).then(async()=>{
      for(const key of wanted){
        const started=versionOf(key);
        syncingKeys.add(key);
        try{
          await KioStore.syncCollection(TABLES[key],clone(DB[key]||[]));
          if(versionOf(key)===started) pendingKeys.delete(key);
        }finally{syncingKeys.delete(key);}
      }
      writeCache(); writePending();
      if(wanted.length) console.info(`[ProductionAPI] Đã lưu server: ${wanted.join(', ')}`);
      return true;
    }).catch(err=>{
      wanted.forEach(k=>pendingKeys.add(k)); writePending();
      console.error('[ProductionAPI] Không lưu được dữ liệu sản xuất:',err);
      if(typeof Toast!=='undefined') Toast.err('Không lưu được dữ liệu sản xuất',err.message);
      throw err;
    });
    return syncChain;
  }
  function scheduleCollections(keys){
    const wanted=normalizeKeys(keys); wanted.forEach(k=>pendingKeys.add(k)); markLocal(wanted);
    writeCache(); writePending();
    clearTimeout(syncTimer); syncTimer=setTimeout(()=>syncCollections([...pendingKeys]).catch(()=>{}),0);
  }

  // [PRODUCTION PERFORMANCE] Phần lớn action cũ gọi scheduleSync() chung dù chỉ
  // thay đổi đúng 1 collection. Trước đây điều này đánh dấu cả 4 bảng Production
  // là pending, khiến lần F5/đổi role tiếp theo ghi lại hàng loạt LSX/plan/FQC.
  // So sánh snapshot cache gần nhất để chỉ queue collection thực sự thay đổi.
  function dirtyKeysFromCache(){
    const cached=readJson(CACHE_KEY)||readJson(OLD_CACHE_KEY);
    if(!cached) return Object.keys(TABLES);
    const dirty=[];
    for(const key of Object.keys(TABLES)){
      try{
        if(JSON.stringify(cached?.[key]||[])!==JSON.stringify(DB[key]||[])) dirty.push(key);
      }catch(_){ dirty.push(key); }
    }
    return dirty;
  }
  function scheduleSync(){
    const dirty=dirtyKeysFromCache();
    if(dirty.length) scheduleCollections(dirty);
  }

  // Ghi ngay các collection vừa thay đổi và chỉ trả thành công sau khi KIO xác nhận.
  // Dùng cho KHSX/YCNVL để người dùng có thể đổi role/F5 ngay sau thao tác mà không mất dữ liệu.
  async function persistCollections(keys){
    const wanted=normalizeKeys(keys);
    if(!wanted.length) return true;
    wanted.forEach(k=>pendingKeys.add(k));
    markLocal(wanted);
    writeCache();
    writePending();
    return syncCollections(wanted);
  }

  async function syncNow(){ const keys=[...pendingKeys]; return keys.length?syncCollections(keys):true; }

  function collectionKey(item,index=0){
    const v=item&&typeof item==='object'?(item.id??item.code??item.key):null;
    return String(v??`ROW-${index+1}`);
  }
  function normalizedCollection(items){
    return (Array.isArray(items)?items:[])
      .map((item,index)=>[collectionKey(item,index),JSON.stringify(item)])
      .sort((a,b)=>a[0].localeCompare(b[0]));
  }
  function sameCollection(a,b){
    try{return JSON.stringify(normalizedCollection(a))===JSON.stringify(normalizedCollection(b));}
    catch(_){return false;}
  }
  async function reconcilePending(){
    // Pending cũ có thể chứa cả 4 bảng chỉ vì scheduleSync() legacy. Đọc từng
    // collection và bỏ pending nếu server đã giống snapshot. Chỉ ghi bảng thật
    // sự khác, tránh hàng chục/hàng trăm KRUD khi người dùng chỉ mở Dashboard.
    const keys=[...pendingKeys];
    for(const key of keys){
      if(!TABLES[key]){ pendingKeys.delete(key); continue; }
      try{
        const remote=await KioStore.listCollection(TABLES[key]);
        if(sameCollection(remote,DB[key]||[])){
          pendingKeys.delete(key);
          lastRefresh.set(key,Date.now());
          continue;
        }
        await syncCollections([key]);
      }catch(err){
        console.warn(`[ProductionAPI] Chưa đối chiếu được pending ${key}:`,err);
      }
    }
    writePending();
  }

  function stageProgressRecord(po,index){
    const st=(po?.stages||[])[index]; if(!po||!st) return null;
    return {
      id:`${po.id}::${index}`,
      productionOrderId:po.id,
      stageIndex:Number(index),
      orderStatus:po.status||'',
      orderCompletedAt:po.completedAt||'',
      finalInspectionId:po.finalInspectionId||'',
      finishedLotId:po.finishedLotId||'',
      stage:{
        status:st.status||'pending', qtyDone:Number(st.qtyDone||0), hours:Number(st.hours||0),
        leadId:st.leadId||'', machine:st.machine||'', note:st.note||'', start:st.start||'', end:st.end||'',
        actualStartedAt:st.actualStartedAt||'', processQc:st.processQc||null,
        processQcHistory:Array.isArray(st.processQcHistory)?st.processQcHistory:[],
        processQcReworkHistory:Array.isArray(st.processQcReworkHistory)?st.processQcReworkHistory:[]
      },
      updatedAt:new Date().toISOString()
    };
  }
  function applyStageProgress(rows){
    for(const r of (Array.isArray(rows)?rows:[])){
      const po=(DB.productionOrders||[]).find(x=>String(x.id)===String(r?.productionOrderId));
      if(!po) continue;
      const i=Number(r?.stageIndex); const st=(po.stages||[])[i];
      if(!st) continue;
      const x=r.stage||{};
      for(const k of ['status','qtyDone','hours','leadId','machine','note','start','end','actualStartedAt','processQc','processQcHistory','processQcReworkHistory']){
        if(x[k]!==undefined) st[k]=clone(x[k]);
      }
      if(r.orderStatus) po.status=r.orderStatus;
      if(r.orderCompletedAt!==undefined) po.completedAt=r.orderCompletedAt||'';
      if(r.finalInspectionId!==undefined) po.finalInspectionId=r.finalInspectionId||'';
      if(r.finishedLotId!==undefined) po.finishedLotId=r.finishedLotId||'';
    }
  }
  async function refreshStageProgress({force=false}={}){
    if(!force && Date.now()-stageLastRefresh<STAGE_REFRESH_TTL) return true;
    try{
      const rows=await KioStore.listCollection(STAGE_TABLE,{force});
      applyStageProgress(rows); stageLastRefresh=Date.now(); writeCache(); return true;
    }catch(err){ console.warn('[ProductionAPI] Không đọc được tiến độ công đoạn:',err); return false; }
  }
  async function persistStageProgress(po,indices){
    const list=[...new Set((Array.isArray(indices)?indices:[indices]).map(Number).filter(Number.isInteger))]
      .map(i=>stageProgressRecord(po,i)).filter(Boolean);
    if(!list.length) return true;
    await KioStore.syncCollection(STAGE_TABLE,list);
    stageLastRefresh=Date.now(); writeCache();
    return true;
  }

  async function bootstrap(){
    if(booted) return true;
    if(bootPromise) return bootPromise;
    bootPromise=(async()=>{
      const cached=readJson(CACHE_KEY)||readJson(OLD_CACHE_KEY);
      if(cached) apply(cached);
      const pending=readJson(PENDING_KEY)?.keys||[];
      normalizeKeys(pending).forEach(k=>pendingKeys.add(k));
      await migrateLegacyIfNeeded();
      // Nếu lần trước F5 đúng lúc đang ghi, đối chiếu server trước. Chỉ replay
      // collection thật sự khác; không ghi lại cả Production chỉ vì pending cũ.
      if(pendingKeys.size) await reconcilePending();
      booted=true;
      return true;
    })().finally(()=>{bootPromise=null;});
    return bootPromise;
  }

  async function refreshKeys(keys,{force=false}={}){
    const wanted=normalizeKeys(keys); const out={};
    for(const key of wanted){
      if(pendingKeys.has(key)||syncingKeys.has(key)) continue;
      const started=versionOf(key);
      try{
        const rows=await KioStore.listCollection(TABLES[key],{force});
        if(versionOf(key)!==started) continue;
        DB[key]=rows; out[key]=rows; lastRefresh.set(key,Date.now());
        if(key==='productionOrders') await refreshStageProgress({force});
      }catch(err){ console.warn(`[ProductionAPI] Không đọc được ${key}:`,err); }
    }
    if(Object.keys(out).length) writeCache();
    return out;
  }
  async function ensureFresh(keys=null,{force=false}={}){
    await bootstrap();
    const wanted=normalizeKeys(keys).filter(k=>{
      if(pendingKeys.has(k)||syncingKeys.has(k)) return false;
      return force || (Date.now()-Number(lastRefresh.get(k)||0)>=REFRESH_TTL);
    });
    return wanted.length?refreshKeys(wanted,{force}):{};
  }
  async function refreshFromServer({force=true}={}){ return ensureFresh(Object.keys(TABLES),{force}); }

  return {bootstrap,refreshFromServer,refreshKeys,ensureFresh,scheduleSync,scheduleCollections,persistCollections,persistStageProgress,refreshStageProgress,syncNow,syncCollections};
})();
