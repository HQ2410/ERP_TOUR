/* ============================================================================
 * RESTAURANT + QUALITY API - SHARED KIO CACHE
 * ----------------------------------------------------------------------------
 * - Dữ liệu vẫn đọc/ghi thật trên KIO server.
 * - Bootstrap chỉ hydrate snapshot server gần nhất từ localStorage để UI mở ngay.
 * - Mọi read dùng KioStore chung -> cache/inflight/dedupe dùng chung toàn ERP.
 * - Sau write, cache local được cập nhật ngay nên F5 không nhảy về state cũ.
 * ========================================================================== */
const RestaurantQualityAPI = (() => {
  const RT = KIO_CONFIG.restaurantTables;
  const QT = KIO_CONFIG.qualityTables;
  const REST_CACHE_KEY = KIO_CONFIG.storageKeys.restaurantCache || 'lenam:kio:restaurant-cache:v1';
  const QUAL_CACHE_KEY = KIO_CONFIG.storageKeys.qualityCache || 'lenam:kio:quality-cache:v1';
  const FRESH_TTL = 2 * 60 * 1000;
  const lastLoaded = new Map();
  const inflightLoads = new Map();
  const snapshotKeys = new Set();
  let booted = false;

  const restaurantMap = Object.freeze({
    stores: ['stores', RT.stores],
    recipes: ['restaurantRecipes', RT.recipes],
    orders: ['posOrders', RT.orders],
    replenishments: ['storeReplenishmentRequests', RT.replenishments],
    storeStocks: ['restaurantStoreStocks', RT.storeStocks],
    storeStockTransactions: ['restaurantStoreStockTransactions', RT.storeStockTransactions],
    // Dùng chung master tài khoản ngân hàng của Kế toán – Tài chính.
    bankAccounts: ['bankAccounts', RT.bankAccounts],    
	cashTransactions: ['cashTransactions', RT.cashTransactions],
    bankTransactions: ['bankTransactions', RT.bankTransactions],
    fixedAssets: ['fixedAssets', RT.fixedAssets],

  });
  const qualityMap = Object.freeze({
    coa: ['qualityCoa', QT.coa],
    capa: ['qualityCapa', QT.capa],
    recalls: ['qualityRecalls', QT.recalls],
  });

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const now = () => Date.now();
  function readJson(key){ return typeof KioDataUtils!=='undefined' ? KioDataUtils.readJson(key) : null; }
  function writeJson(key,v){ return typeof KioDataUtils!=='undefined' ? KioDataUtils.writeJson(key,v) : false; }

  function cachePayload(map){
    const data={};
    for(const [key,[dbKey]] of Object.entries(map)) data[key]=clone(Array.isArray(DB[dbKey])?DB[dbKey]:[]);
    return { syncedAt: now(), data };
  }
  function writeMapCache(map, key){ writeJson(key, cachePayload(map)); }
  function applyCache(map, cache){
    if(!cache || !cache.data) return false;
    let any=false;
    for(const [key,[dbKey]] of Object.entries(map)){
      if(Array.isArray(cache.data[key])){ DB[dbKey]=cache.data[key]; snapshotKeys.add(key); any=true; }
    }
    return any;
  }

  async function bootstrap(){
    if(booted) return true;
    booted=true;
    const rc=readJson(REST_CACHE_KEY), qc=readJson(QUAL_CACHE_KEY);
    if(applyCache(restaurantMap,rc)) console.info('[RestaurantAPI] Đã nạp snapshot server gần nhất từ cache.');
    if(applyCache(qualityMap,qc)) console.info('[QualityAPI] Đã nạp snapshot server gần nhất từ cache.');
    // Cache chỉ giúp render tức thì; timestamp server freshness KHÔNG giả lập.
    // ensureFresh nền sẽ xác minh server và cập nhật DB/cache.
    return true;
  }

  function entryForKey(key){ return restaurantMap[key] || qualityMap[key] || null; }
  function mapForKey(key){ return restaurantMap[key] ? restaurantMap : qualityMap[key] ? qualityMap : null; }
  function cacheKeyForKey(key){ return restaurantMap[key] ? REST_CACHE_KEY : QUAL_CACHE_KEY; }

  async function loadKey(key,{force=false}={}){
    const entry=entryForKey(key); if(!entry) return false;
    if(!force && inflightLoads.has(key)) return inflightLoads.get(key);
    const task=(async()=>{
      const [dbKey,table]=entry;
      try{
        const rows=await KioStore.listCollection(table, { force });
        DB[dbKey]=Array.isArray(rows)?rows:[];
        lastLoaded.set(key,now());
        snapshotKeys.add(key);
        const map=mapForKey(key); if(map) writeMapCache(map,cacheKeyForKey(key));
        return true;
      }catch(err){
        DB[dbKey]=Array.isArray(DB[dbKey])?DB[dbKey]:[];
        console.warn(`[RestaurantQualityAPI] Không đọc được bảng ${table}:`,err);
        return false;
      }finally{ inflightLoads.delete(key); }
    })();
    inflightLoads.set(key,task);
    return task;
  }

  function hasSnapshot(keys){
    const wanted=[...new Set(Array.isArray(keys)?keys:[])].filter(entryForKey);
    if(!wanted.length) return true;
    return wanted.every(k=>snapshotKeys.has(k));
  }

  function areFresh(keys){
    const wanted=[...new Set(Array.isArray(keys)?keys:[])];
    if(!wanted.length) return true;
    const t=now();
    return wanted.every(k=>!entryForKey(k) || (t-Number(lastLoaded.get(k)||0))<FRESH_TTL);
  }

  async function ensureFresh(keys,{force=false}={}){
    await bootstrap();
    const wanted=[...new Set(Array.isArray(keys)?keys:[])].filter(entryForKey);
    const changed={};
    // KioStore tự dedupe/cache và tự điều phối list request; API này không tạo queue riêng.
    await Promise.all(wanted.map(async key=>{
      const last=Number(lastLoaded.get(key)||0);
      if(!force && last && now()-last<FRESH_TTL) return;
      if(await loadKey(key,{force})) changed[key]=true;
    }));
    return changed;
  }

  async function syncMap(map,keys){
    await bootstrap();
    const wanted=Array.isArray(keys)&&keys.length?[...new Set(keys)]:Object.keys(map);
    for(const key of wanted){
      const entry=map[key]; if(!entry) continue;
      const [dbKey,table]=entry;
      await KioStore.syncCollection(table,clone(Array.isArray(DB[dbKey])?DB[dbKey]:[]));
      lastLoaded.set(key,now());
      snapshotKeys.add(key);
    }
    if(map===restaurantMap) writeMapCache(restaurantMap,REST_CACHE_KEY);
    if(map===qualityMap) writeMapCache(qualityMap,QUAL_CACHE_KEY);
    return true;
  }

  async function saveRestaurantRecord(key, record){
    await bootstrap();
    const entry=restaurantMap[key];
    if(!entry || !record) return false;
    const [,table]=entry;
    // Ghi đúng một record thay đổi thay vì sync lại cả collection. KioStore vẫn
    // đối chiếu dữ liệu server theo key nên đây vẫn là persistence thật.
    await KioStore.saveSingleton(table, String(record.id||record.code||''), clone(record));
    lastLoaded.set(key,now()); snapshotKeys.add(key);
    writeMapCache(restaurantMap,REST_CACHE_KEY);
    return true;
  }

  async function refreshRestaurant(keys){
    const wanted=Array.isArray(keys)&&keys.length?[...new Set(keys)]:Object.keys(restaurantMap);
    return ensureFresh(wanted,{force:true});
  }

  async function deleteFrom(map,key,id){
    const e=map[key]; if(!e||!id) return false;
    await KioStore.deleteKeys(e[1],[id]);
    const [dbKey]=e; DB[dbKey]=(DB[dbKey]||[]).filter(x=>String(x?.id||x?.code||'')!==String(id));
    lastLoaded.set(key,now());
    snapshotKeys.add(key);
    if(map===restaurantMap) writeMapCache(restaurantMap,REST_CACHE_KEY); else writeMapCache(qualityMap,QUAL_CACHE_KEY);
    return true;
  }

  async function debugTables(){
    const rows=[];
    for(const [moduleName,map] of [['Restaurant',restaurantMap],['Quality',qualityMap]]){
      for(const [key,[,table]] of Object.entries(map)){
        try{const data=await KioStore.listCollection(table,{force:true});rows.push({module:moduleName,key,table,records:data.length,status:'OK'});}
        catch(err){rows.push({module:moduleName,key,table,records:0,status:String(err?.message||err)});}
      }
    }
    console.table(rows); return rows;
  }

  return {
    bootstrap,
    areFresh,
    hasSnapshot,
    ensureFresh,
    syncRestaurant:(keys)=>syncMap(restaurantMap,keys),
    syncQuality:(keys)=>syncMap(qualityMap,keys),
    refreshRestaurant,
    saveRestaurantRecord,
    deleteRestaurant:(key,id)=>deleteFrom(restaurantMap,key,id),
    deleteQuality:(key,id)=>deleteFrom(qualityMap,key,id),
    debugTables,
    listCollection:(table,opts)=>KioStore.listCollection(table,opts),
  };
})();
