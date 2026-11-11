/* ============================================================================
 * MODULE: LOGISTICS & FLEET
 * Phạm vi độc lập: quản lý chuyến giao, điều phối, xe, tài xế, GPS, bảo trì.
 * Đồng bộ Sales Order, Kho Hàng trả về và persistence KIO/server.
 * localStorage chỉ dùng làm cache khởi động nhanh; KIO là nguồn lưu trữ dùng chung.
 * ==========================================================================*/
(function () {
  'use strict';

  const KEY = (typeof KIO_CONFIG !== 'undefined' && KIO_CONFIG.storageKeys?.logisticsCache) || 'lenam_logistics_v2';
  const LEGACY_KEY = 'lenam_logistics_v1';
  const PENDING_KEY = `${KEY}:pending`; // outbox chống mất dữ liệu khi F5
  const TABLES = (typeof KIO_CONFIG !== 'undefined' && KIO_CONFIG.logisticsTables) || {
    vehicleTypes:'lenam_logistics_vehicle_types', vehicles:'lenam_logistics_vehicles', drivers:'lenam_logistics_drivers', deliveries:'lenam_logistics_deliveries', maintenance:'lenam_logistics_maintenance'
  };
  const COLLECTIONS = ['vehicleTypes','vehicles','drivers','deliveries','maintenance'];
  const FLEET_SERVER_DATA_VERSION = '20260916-v1';
  const FLEET_SERVER_DATA_MARKER = `lenam:logistics:fleet-server-data:${FLEET_SERVER_DATA_VERSION}`;
  let syncTimer = null;
  let serverRefreshStarted = false;
  let serverReady = false;
  let refreshPromise = null;
  let localVersion = 0;
  const lastSerialized = new Map();
  const today = () => (typeof currentDateYMD === 'function' ? currentDateYMD() : new Date().toISOString().slice(0, 10));
  const nowIso = () => new Date().toISOString();
  const n = (v) => Number(v || 0);
  const uid = (prefix, list) => {
    const year = today().slice(0, 4);
    const rx = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-' + year + '-(\\d+)$');
    let max = 0;
    (list || []).forEach(x => { const m = String(x.id || '').match(rx); if (m) max = Math.max(max, Number(m[1])); });
    return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`;
  };
  const addDaysLocal = (ymd, days) => {
    const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
  };
  const money = (v) => typeof fmtVND === 'function' ? fmtVND(n(v)) : `${n(v).toLocaleString('vi-VN')}đ`;
  const num = (v, digits = 0) => n(v).toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const e = (v) => typeof esc === 'function' ? esc(String(v ?? '')) : String(v ?? '');
  const dateFmt = (v) => typeof fmtDate === 'function' ? fmtDate(v) : (v || '—');

  const INITIAL_VEHICLE_TYPES = [
    { id:'LX-001', name:'Xe tải lạnh nhỏ', bodyType:'Thùng lạnh', refrigerated:true, defaultCapacityKg:500, defaultFuelType:'Diesel', defaultFuelNorm:8.5, maintenanceCycleKm:5000, status:'ACTIVE', note:'Phù hợp giao nội thành, đơn nhỏ và nhiều điểm giao.' },
    { id:'LX-002', name:'Xe van lạnh', bodyType:'Van lạnh', refrigerated:true, defaultCapacityKg:800, defaultFuelType:'Diesel', defaultFuelNorm:9, maintenanceCycleKm:5000, status:'ACTIVE', note:'Phù hợp giao thực phẩm cần giữ lạnh trong nội thành.' },
    { id:'LX-003', name:'Xe tải thùng', bodyType:'Thùng kín', refrigerated:false, defaultCapacityKg:1200, defaultFuelType:'Diesel', defaultFuelNorm:10, maintenanceCycleKm:5000, status:'ACTIVE', note:'Dùng cho hàng không yêu cầu lạnh hoặc tuyến ngắn.' },
    { id:'LX-004', name:'Xe tải lạnh', bodyType:'Thùng lạnh', refrigerated:true, defaultCapacityKg:1500, defaultFuelType:'Diesel', defaultFuelNorm:11, maintenanceCycleKm:5000, status:'ACTIVE', note:'Xe lạnh tiêu chuẩn cho giao thành phẩm đậu hũ.' },
    { id:'LX-005', name:'Xe tải lạnh lớn', bodyType:'Thùng lạnh', refrigerated:true, defaultCapacityKg:2000, defaultFuelType:'Diesel', defaultFuelNorm:13, maintenanceCycleKm:6000, status:'ACTIVE', note:'Dùng cho chuyến ghép nhiều đơn hoặc tuyến xa.' }
  ];
  const INITIAL_SERVER_VEHICLES = [
    { id:'XE-001', plate:'51C-123.45', typeId:'LX-004', type:'Xe tải lạnh', capacityKg:1500, fuelType:'Diesel', fuelNorm:11, odometer:48520, status:'AVAILABLE', gpsDevice:'GPS-001', nextMaintenanceDate:'2026-10-01', nextMaintenanceKm:50000, registrationExpiry:'2026-12-20', note:'' },
    { id:'XE-002', plate:'51C-678.90', typeId:'LX-003', type:'Xe tải thùng', capacityKg:1200, fuelType:'Diesel', fuelNorm:10, odometer:37640, status:'AVAILABLE', gpsDevice:'GPS-002', nextMaintenanceDate:'2026-09-28', nextMaintenanceKm:40000, registrationExpiry:'2027-02-15', note:'' },
    { id:'XE-003', plate:'50H-246.80', typeId:'LX-002', type:'Xe van lạnh', capacityKg:800, fuelType:'Diesel', fuelNorm:9, odometer:29850, status:'MAINTENANCE', gpsDevice:'GPS-003', nextMaintenanceDate:'2026-09-16', nextMaintenanceKm:30000, registrationExpiry:'2026-11-30', note:'Đang bảo trì định kỳ' },
    { id:'XE-004', plate:'51D-381.26', typeId:'LX-001', type:'Xe tải lạnh nhỏ', capacityKg:500, fuelType:'Diesel', fuelNorm:8.5, odometer:18320, status:'AVAILABLE', gpsDevice:'GPS-004', nextMaintenanceDate:'2026-10-12', nextMaintenanceKm:20000, registrationExpiry:'2027-03-18', note:'Ưu tiên đơn nhỏ và giao nội thành.' },
    { id:'XE-005', plate:'51D-527.18', typeId:'LX-002', type:'Xe van lạnh', capacityKg:800, fuelType:'Diesel', fuelNorm:9, odometer:22140, status:'AVAILABLE', gpsDevice:'GPS-005', nextMaintenanceDate:'2026-10-20', nextMaintenanceKm:25000, registrationExpiry:'2027-01-25', note:'' },
    { id:'XE-006', plate:'51C-842.39', typeId:'LX-003', type:'Xe tải thùng', capacityKg:1200, fuelType:'Diesel', fuelNorm:10, odometer:41360, status:'AVAILABLE', gpsDevice:'GPS-006', nextMaintenanceDate:'2026-09-30', nextMaintenanceKm:45000, registrationExpiry:'2027-05-11', note:'' },
    { id:'XE-007', plate:'50H-615.72', typeId:'LX-004', type:'Xe tải lạnh', capacityKg:1500, fuelType:'Diesel', fuelNorm:11, odometer:33780, status:'AVAILABLE', gpsDevice:'GPS-007', nextMaintenanceDate:'2026-10-08', nextMaintenanceKm:35000, registrationExpiry:'2027-04-09', note:'Phù hợp ghép 2-4 đơn cùng tuyến.' },
    { id:'XE-008', plate:'51D-906.44', typeId:'LX-005', type:'Xe tải lạnh lớn', capacityKg:2000, fuelType:'Diesel', fuelNorm:13, odometer:26890, status:'AVAILABLE', gpsDevice:'GPS-008', nextMaintenanceDate:'2026-10-25', nextMaintenanceKm:30000, registrationExpiry:'2027-06-22', note:'Ưu tiên chuyến tải lớn hoặc nhiều điểm giao.' }
  ];

  const seed = () => ({
    vehicleTypes: clone(INITIAL_VEHICLE_TYPES),
    vehicles: clone(INITIAL_SERVER_VEHICLES),
    drivers: [
      { id:'TX-001', employeeId:'NV-019', name:'Đinh Thị Hương', phone:'0909 000 019', licenseNo:'C123456789', licenseClass:'C', licenseExpiry:'2028-06-30', status:'AVAILABLE', note:'' },
      { id:'TX-002', employeeId:'', name:'Nguyễn Văn Bình', phone:'0908 220 118', licenseNo:'C987654321', licenseClass:'C', licenseExpiry:'2027-11-15', status:'AVAILABLE', note:'' },
      { id:'TX-003', employeeId:'', name:'Trần Quốc Nam', phone:'0917 330 225', licenseNo:'B212345678', licenseClass:'B2', licenseExpiry:'2027-04-10', status:'OFF', note:'Nghỉ phép' }
    ],
    deliveries: [
      { id:'GH-2026-084', orderId:'', customer:'Cửa hàng Lê Văn Việt', address:'TP. Thủ Đức, TP.HCM', promisedDate:'2026-09-15', promisedTime:'10:00', plannedStart:'2026-09-15T08:30', actualStart:'2026-09-15T08:37', actualDelivered:'', vehicleId:'XE-001', driverId:'TX-001', route:'Kho thành phẩm → Thủ Đức', estimatedKm:24, actualKm:18.5, cargoKg:620, deliveredQty:0, returnedQty:0, fuelLiters:0, tollCost:0, parkingCost:0, otherCost:0, status:'IN_TRANSIT', gpsLat:10.8508, gpsLng:106.7717, gpsUpdatedAt:'2026-09-15T09:14:00', note:'' },
      { id:'GH-2026-085', orderId:'', customer:'Đại lý Bình Dương', address:'Dĩ An, Bình Dương', promisedDate:'2026-09-15', promisedTime:'14:30', plannedStart:'2026-09-15T12:15', actualStart:'', actualDelivered:'', vehicleId:'XE-002', driverId:'TX-002', route:'Kho thành phẩm → Dĩ An', estimatedKm:36, actualKm:0, cargoKg:840, deliveredQty:0, returnedQty:0, fuelLiters:0, tollCost:0, parkingCost:0, otherCost:0, status:'DISPATCHED', gpsLat:10.8777, gpsLng:106.8060, gpsUpdatedAt:'2026-09-15T08:00:00', note:'' },
      { id:'GH-2026-081', orderId:'', customer:'Nhà hàng An Phú', address:'Quận 2, TP.HCM', promisedDate:'2026-09-13', promisedTime:'11:00', plannedStart:'2026-09-13T08:00', actualStart:'2026-09-13T08:10', actualDelivered:'2026-09-13T10:42', vehicleId:'XE-001', driverId:'TX-001', route:'Kho thành phẩm → An Phú', estimatedKm:42, actualKm:45, cargoKg:710, deliveredQty:710, returnedQty:0, fuelLiters:5.2, fuelCost:112000, tollCost:35000, parkingCost:10000, otherCost:0, status:'CLOSED', gpsLat:10.8025, gpsLng:106.7432, gpsUpdatedAt:'2026-09-13T10:42:00', note:'' },
      { id:'GH-2026-082', orderId:'', customer:'Siêu thị Minh Tâm', address:'Quận 7, TP.HCM', promisedDate:'2026-09-14', promisedTime:'09:30', plannedStart:'2026-09-14T07:00', actualStart:'2026-09-14T07:08', actualDelivered:'2026-09-14T09:48', vehicleId:'XE-002', driverId:'TX-002', route:'Kho thành phẩm → Quận 7', estimatedKm:52, actualKm:55, cargoKg:900, deliveredQty:885, returnedQty:15, fuelLiters:6.4, fuelCost:138000, tollCost:40000, parkingCost:15000, otherCost:25000, status:'CLOSED', gpsLat:10.7296, gpsLng:106.7219, gpsUpdatedAt:'2026-09-14T09:48:00', note:'Trả 15 kg do bao bì móp' }
    ],
    maintenance: [
      { id:'BTX-2026-001', vehicleId:'XE-003', type:'Định kỳ', scheduledDate:'2026-09-15', scheduledKm:30000, status:'IN_PROGRESS', vendor:'Garage Minh Phát', cost:650000, description:'Thay dầu, lọc dầu, kiểm tra phanh', completedDate:'', nextDate:'2026-12-15', nextKm:35000 }
    ]
  });

  let L = null;
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function writeCache() {
    try { localStorage.setItem(KEY, JSON.stringify(L)); }
    catch (err) { console.warn('[Logistics] Không lưu được cache local:', err); }
  }
  function rememberBaseline() { COLLECTIONS.forEach(k => lastSerialized.set(k, JSON.stringify(L?.[k] || []))); }
  function load() {
    if (L) return L;
    try { L = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { L = null; }
    if (!L || typeof L !== 'object') L = {};
    COLLECTIONS.forEach(k => { if (!Array.isArray(L[k])) L[k] = []; });
    normalizeStatuses(); rememberBaseline();
    if (!serverRefreshStarted) {
      serverRefreshStarted = true;
      let hasPending=false; try { hasPending=localStorage.getItem(PENDING_KEY)==='1'; } catch (_) {}
      setTimeout(async()=>{
        if(hasPending){ try{ await syncChanged(); localStorage.removeItem(PENDING_KEY); }catch(_){ return; } }
        await refreshFromServer();
      },0);
    }
    return L;
  }
  async function syncChanged() {
    if (typeof KioStore === 'undefined') return false;
    const changed = COLLECTIONS.filter(k => JSON.stringify(L?.[k] || []) !== lastSerialized.get(k));
    if (!changed.length) return true;
    for (const key of changed) {
      await KioStore.syncCollection(TABLES[key], clone(L[key] || []));
      lastSerialized.set(key, JSON.stringify(L[key] || []));
    }
    serverReady = true;
    try { localStorage.removeItem(PENDING_KEY); } catch (_) {}
    console.info(`[LogisticsAPI] Đã đồng bộ KIO: ${changed.join(', ')}`);
    return true;
  }
  function scheduleServerSync(delay = 180) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncChanged().catch(err => console.warn('[LogisticsAPI] Không đồng bộ được KIO; giữ cache local:', err)), 0);
  }
  async function ensureInitialFleetDataOnServer(incoming) {
    if (typeof KioStore === 'undefined') return incoming;
    let alreadyApplied = false;
    try { alreadyApplied = localStorage.getItem(FLEET_SERVER_DATA_MARKER) === '1'; } catch (_) {}
    // Không ghi đè dữ liệu người dùng/server. Chỉ bổ sung các mã chưa tồn tại.
    // Các bản ghi được sync qua KIO nên trở thành dữ liệu server thật, không chỉ là mock local.
    const typeRows = Array.isArray(incoming.vehicleTypes) ? incoming.vehicleTypes : [];
    const vehicleRows = Array.isArray(incoming.vehicles) ? incoming.vehicles : [];
    const typeIds = new Set(typeRows.map(x => String(x.id || '')));
    const vehicleIds = new Set(vehicleRows.map(x => String(x.id || '')));
    const missingTypes = INITIAL_VEHICLE_TYPES.filter(x => !typeIds.has(x.id));
    const missingVehicles = INITIAL_SERVER_VEHICLES.filter(x => !vehicleIds.has(x.id));

    if (!alreadyApplied || missingTypes.length || missingVehicles.length) {
      if (missingTypes.length) {
        incoming.vehicleTypes = [...typeRows, ...clone(missingTypes)];
        await KioStore.syncCollection(TABLES.vehicleTypes, clone(incoming.vehicleTypes));
        console.info(`[LogisticsAPI] Đã bổ sung ${missingTypes.length} danh mục xe lên KIO server.`);
      }
      if (missingVehicles.length) {
        incoming.vehicles = [...vehicleRows, ...clone(missingVehicles)];
        await KioStore.syncCollection(TABLES.vehicles, clone(incoming.vehicles));
        console.info(`[LogisticsAPI] Đã bổ sung ${missingVehicles.length} xe kiểm thử lên KIO server.`);
      }
      try { localStorage.setItem(FLEET_SERVER_DATA_MARKER, '1'); } catch (_) {}
    }
    return incoming;
  }

  async function refreshFromServer({ force = false } = {}) {
    if (typeof KioStore === 'undefined') return false;
    if (serverReady && !force) return true;
    if (refreshPromise) return refreshPromise;
    const versionAtStart = localVersion;
    refreshPromise = (async () => {
      try {
        const values = await Promise.all(COLLECTIONS.map(key => KioStore.listCollection(TABLES[key])));
        if (localVersion !== versionAtStart) return false;
        COLLECTIONS.forEach((key, index) => { L[key] = Array.isArray(values[index]) ? values[index] : []; });
        normalizeStatuses(); rememberBaseline(); writeCache(); serverReady = true;
        if (typeof State !== 'undefined' && State.module === 'logistics' && typeof render === 'function') render();
        console.info('[LogisticsAPI] Đã nạp dữ liệu Logistics thật từ KIO.');
        return true;
      } catch (err) {
        console.warn('[LogisticsAPI] Không refresh được KIO; giữ snapshot gần nhất:', err);
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }
  async function ensureFresh({ force = false } = {}) {
    load();
    return refreshFromServer({ force });
  }
  function save() { localVersion += 1; writeCache(); try{localStorage.setItem(PENDING_KEY,'1');}catch(_){} scheduleServerSync(); }
  function normalizeStatuses() {
    const activeVehicle = new Set((L.deliveries || []).filter(d => ['DISPATCHED','READY','IN_TRANSIT'].includes(d.status)).map(d => d.vehicleId));
    const activeDriver = new Set((L.deliveries || []).filter(d => ['DISPATCHED','READY','IN_TRANSIT'].includes(d.status)).map(d => d.driverId));
    (L.vehicles || []).forEach(v => {
      if (v.status === 'RETIRED') return;
      if ((L.maintenance || []).some(m => m.vehicleId === v.id && ['PLANNED','IN_PROGRESS'].includes(m.status))) v.status = 'MAINTENANCE';
      else v.status = activeVehicle.has(v.id) ? 'BUSY' : 'AVAILABLE';
    });
    (L.drivers || []).forEach(d => { if (d.status !== 'OFF' && d.status !== 'INACTIVE') d.status = activeDriver.has(d.id) ? 'BUSY' : 'AVAILABLE'; });
  }
  function rerender(msg, desc) { normalizeStatuses(); save(); if (typeof Modal !== 'undefined') Modal.close(); if (typeof render === 'function') render(); if (msg && typeof Toast !== 'undefined') Toast.ok(msg, desc || ''); }
  function vehicleType(id) { return load().vehicleTypes.find(x => x.id === id); }
  function vehicle(id) { return load().vehicles.find(x => x.id === id); }
  function driver(id) { return load().drivers.find(x => x.id === id); }
  function delivery(id) { return load().deliveries.find(x => x.id === id); }
  function maint(id) { return load().maintenance.find(x => x.id === id); }
  function statusBadge(status) {
    const map = {
      DRAFT:['Nháp','slate'], WAIT_WAREHOUSE:['Chờ Kho xuất','orange'], WAIT_DISPATCH:['Chờ điều phối','orange'], DISPATCHED:['Đã điều phối','blue'], READY:['Sẵn sàng giao','teal'], IN_TRANSIT:['Đang giao','blue'], PARTIAL:['Giao một phần','orange'], FAILED:['Giao thất bại','red'], DELIVERED:['Đã giao','green'], CLOSED:['Đã chốt chuyến','green'],
      AVAILABLE:['Sẵn sàng','green'], BUSY:['Đang chạy','blue'], MAINTENANCE:['Bảo trì','orange'], RETIRED:['Ngừng sử dụng','red'], OFF:['Nghỉ','slate'], INACTIVE:['Ngừng hoạt động','red'],
      PLANNED:['Đã lên lịch','blue'], IN_PROGRESS:['Đang bảo trì','orange'], DONE:['Hoàn thành','green'], CANCELLED:['Đã hủy','slate']
    };
    const x = map[status] || [status || '—','slate']; return `<span class="badge ${x[1]}">${e(x[0])}</span>`;
  }
  function deadline(d) { return d.promisedDate ? `${d.promisedDate}T${d.promisedTime || '23:59'}` : ''; }
  function isOnTime(d) { return !!(d.actualDelivered && deadline(d) && new Date(d.actualDelivered) <= new Date(deadline(d))); }
  function tripCost(d) { return n(d.fuelCost) + n(d.tollCost) + n(d.parkingCost) + n(d.otherCost); }
  function costPerKm(d) { return n(d.actualKm) > 0 ? tripCost(d) / n(d.actualKm) : 0; }
  function normFuel(d) { const v = vehicle(d.vehicleId); return v && n(d.actualKm) > 0 ? n(d.actualKm) * n(v.fuelNorm) / 100 : 0; }
  /* ===== Nhiên liệu: đề xuất vs thực tế; chuyến tổng hợp (đơn lẻ ↔ đơn theo chuyến) ===== */
  const FUEL_PRICE_KEY = 'lenam_lg_fuel_price_v1';
  const FUEL_VAR_LIMIT = 10; // % chênh lệch phải ghi chú
  const DONE_ST = ['DELIVERED', 'PARTIAL', 'CLOSED'];
  const r2 = (v) => Math.round(n(v) * 100) / 100;
  const pmoney = (v) => (typeof parseMoney === 'function' ? parseMoney(v) : n(String(v || '').replace(/[^\d.-]/g, '')));
  function nowLocalInput() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
  function getFuelPrice() {
    try { const v = n(localStorage.getItem(FUEL_PRICE_KEY)); if (v > 0) return v; } catch (_) {}
    const ds = (L?.deliveries || []).filter(x => n(x.fuelLiters) > 0 && n(x.fuelCost) > 0);
    if (ds.length) return Math.round(ds.reduce((a, x) => a + n(x.fuelCost), 0) / ds.reduce((a, x) => a + n(x.fuelLiters), 0));
    return 0;
  }
  function setFuelPrice(v) { try { if (n(v) > 0) localStorage.setItem(FUEL_PRICE_KEY, String(Math.round(n(v)))); } catch (_) {} }
  // Đề xuất = km × định mức xe / 100 (lít); chi phí = lít × đơn giá nhiên liệu.
  function fuelProposal(km, vehicleId, price) {
    const v = vehicle(vehicleId); const liters = v && n(km) > 0 ? r2(n(km) * n(v.fuelNorm) / 100) : 0;
    return { liters, cost: n(price) > 0 ? Math.round(liters * n(price)) : 0, price: n(price) };
  }
  function fuelVariance(prop, aL, aC) {
    const difL = n(aL) - n(prop.liters), difC = n(aC) - n(prop.cost);
    const pctL = n(prop.liters) > 0 ? difL / prop.liters * 100 : 0, pctC = n(prop.cost) > 0 && n(aC) > 0 ? difC / prop.cost * 100 : 0;
    return { difL, difC, pctL, pctC, needNote: (n(prop.liters) > 0 && n(aL) > 0 && Math.abs(pctL) > FUEL_VAR_LIMIT) || (n(prop.cost) > 0 && n(aC) > 0 && Math.abs(pctC) > FUEL_VAR_LIMIT) };
  }
  const signed = (v, d = 1) => `${n(v) >= 0 ? '+' : '−'}${num(Math.abs(n(v)), d)}`;
  function fuelCompareBlock(note = '') {
    return `<div id="lgFuelCmp" class="lg-fuel-cmp" style="margin-top:10px">
      <div class="field" style="max-width:260px"><label>Đơn giá nhiên liệu (đ/lít)</label><input class="inp num" id="lgFuelPrice" data-money="1" type="text" inputmode="numeric" value="${getFuelPrice() || ''}" placeholder="Nhập để đề xuất chi phí"></div>
      <div class="tbl-wrap"><table class="line-tbl"><thead><tr><th></th><th class="right">Đề xuất</th><th class="right">Thực tế</th><th class="right">Chênh lệch</th></tr></thead><tbody>
        <tr><td>Nhiên liệu (lít)</td><td class="right num" id="lgCmpPropL">—</td><td class="right num" id="lgCmpActL">—</td><td class="right num" id="lgCmpDifL">—</td></tr>
        <tr><td>Chi phí nhiên liệu</td><td class="right num" id="lgCmpPropC">—</td><td class="right num" id="lgCmpActC">—</td><td class="right num" id="lgCmpDifC">—</td></tr></tbody></table></div>
      <div class="field" style="margin-top:8px"><label>Ghi chú chênh lệch <span class="muted">(bắt buộc nếu lệch quá ${FUEL_VAR_LIMIT}% so với đề xuất)</span></label><textarea class="inp" id="lgFuelNote" rows="2" placeholder="Ví dụ: Kẹt xe, đi vòng do cấm tải, giá xăng tăng…">${e(note)}</textarea></div></div>`;
  }
  // Đọc ô nhập + cập nhật bảng so sánh. kmSel: ô nhập tổng km của chuyến.
  function fuelCompareRead(vehicleId, kmSel, paint = true) {
    const $q = (s) => document.querySelector(s);
    if (typeof vehicleId === 'function') vehicleId = vehicleId();
    const km = n($q(kmSel)?.value), price = pmoney($q('#lgFuelPrice')?.value), aL = n($q('#lgFuel')?.value), aC = pmoney($q('#lgFuelCost')?.value);
    const prop = fuelProposal(km, vehicleId, price), vr = fuelVariance(prop, aL, aC);
    if (paint) {
      const set = (id, t, color) => { const el = $q(id); if (el) { el.textContent = t; el.style.color = color || ''; } };
      set('#lgCmpPropL', prop.liters > 0 ? `${num(prop.liters, 1)} L` : '—'); set('#lgCmpActL', aL > 0 ? `${num(aL, 1)} L` : '—');
      set('#lgCmpDifL', prop.liters > 0 && aL > 0 ? `${signed(vr.difL)} L (${signed(vr.pctL, 1)}%)` : '—', Math.abs(vr.pctL) > FUEL_VAR_LIMIT && aL > 0 ? 'var(--orange)' : '');
      set('#lgCmpPropC', prop.cost > 0 ? money(prop.cost) : (price > 0 ? '—' : 'Nhập đơn giá')); set('#lgCmpActC', aC > 0 ? money(aC) : '—');
      set('#lgCmpDifC', prop.cost > 0 && aC > 0 ? `${signed(vr.difC, 0)}đ (${signed(vr.pctC, 1)}%)` : '—', Math.abs(vr.pctC) > FUEL_VAR_LIMIT && aC > 0 ? 'var(--orange)' : '');
    }
    return { km, price, aL, aC, prop, vr, note: ($q('#lgFuelNote')?.value || '').trim() };
  }
  function fuelCompareBind(vehicleId, kmSel) {
    const upd = () => fuelCompareRead(vehicleId, kmSel, true);
    ['#lgFuel', '#lgFuelCost', '#lgFuelPrice', kmSel].forEach(sel => document.querySelector(sel)?.addEventListener('input', upd));
    upd();
  }
  // Ghi đề xuất / ghi chú vào từng đơn theo tỷ lệ phân bổ.
  function applyFuelProposal(row, share, tripKm, info) {
    const prop = fuelProposal(tripKm, row.vehicleId, info.price);
    row.fuelPrice = info.price || 0; row.fuelProposedLiters = r2(prop.liters * share); row.fuelProposedCost = Math.round(prop.cost * share);
    row.fuelVarianceNote = info.note || '';
  }
  function tripBadge(d) { return d.tripId ? `<span class="badge blue">Theo chuyến ${e(d.tripId)}</span>` : '<span class="badge slate">Đơn lẻ</span>'; }
  function syncOrderCost(row) {
    const order = (typeof DB !== 'undefined' ? (DB.orders || []) : []).find(o => o.id === row.orderId); if (!order) return;
    const c = tripCost(row), tk = n(row.tripActualKm) || n(row.actualKm);
    order.actualTransportCost = c; order.transportCostPerKm = tk > 0 ? c / tk : 0; order.logisticsStatus = row.status; if (row.status === 'CLOSED') order.logisticsClosedAt = order.logisticsClosedAt || nowIso();
  }
  // Phân bổ tổng km / chi phí của chuyến cho các đơn theo khối lượng hàng.
  function allocateTrip(members, t) {
    const cargo = members.map(r => Math.max(0, deliveryCargoKg(r))), sum = cargo.reduce((a, b) => a + b, 0);
    members.forEach((r, i) => {
      const share = sum > 0 ? cargo[i] / sum : 1 / members.length;
      Object.assign(r, { tripShare: share, tripKmMode: 'ALLOCATED', tripActualKm: n(t.km), actualKm: r2(n(t.km) * share), fuelLiters: r2(n(t.fuelL) * share), fuelCost: Math.round(n(t.fuelCost) * share), tollCost: Math.round(n(t.toll) * share), parkingCost: Math.round(n(t.parking) * share), otherCost: Math.round(n(t.other) * share), tripTotals: { ...t } });
    });
  }
  function tripSnapshot(row) {
    return { tripId: row.tripId || '', mode: row.tripKmMode || (row.tripId ? 'DISPATCH' : 'SINGLE'), members: row.tripId ? tripMembers(row).map(x => x.id) : [], share: r2(n(row.tripShare)), allocatedKm: n(row.actualKm), tripTotalKm: n(row.tripActualKm), fuelLiters: n(row.fuelLiters), fuelCost: n(row.fuelCost), tollCost: n(row.tollCost), parkingCost: n(row.parkingCost), otherCost: n(row.otherCost), status: row.status };
  }
  function pushTripHistory(row, event, note, snapshot) { (row.tripHistory = row.tripHistory || []).push({ event, at: nowIso(), by: (typeof DB !== 'undefined' && (DB.currentUser?.name || DB.currentUser?.id)) || '', note: note || '', snapshot: snapshot || tripSnapshot(row) }); }
  function recordCustomerReceipt(x) {
    const recv = (document.querySelector('#lgReceiver')?.value || '').trim() || x.recipient || '';
    const at = document.querySelector('#lgReceivedAt')?.value; const iso = at ? new Date(at).toISOString() : nowIso();
    x.customerReceiver = recv; x.customerReceivedAt = iso;
    const order = (typeof DB !== 'undefined' ? (DB.orders || []) : []).find(o => o.id === x.orderId);
    if (order) { order.customerReceivedAt = iso; order.customerReceiver = recv; }
    if (typeof pushNotification === 'function') pushNotification({ level: 'info', icon: 'fa-handshake', title: `Khách đã nhận hàng · ${x.customer || x.id}`, desc: `${x.id}${x.orderId ? ' · đơn ' + x.orderId : ''}${recv ? ' · người nhận: ' + recv : ''}`, go: { module: 'logistics', tab: 'deliveries' } });
  }
  function maintenanceCostForVehicle(id) { return load().maintenance.filter(m => m.vehicleId === id && m.status === 'DONE').reduce((s,m) => s+n(m.cost),0); }
  function totalVehicleCost(id) { return load().deliveries.filter(d=>d.vehicleId===id && d.status==='CLOSED').reduce((s,d)=>s+tripCost(d),0) + maintenanceCostForVehicle(id); }
  function closedTrips() { return load().deliveries.filter(d => d.status === 'CLOSED'); }
  function driverScore(id) {
    const ds = closedTrips().filter(d => d.driverId === id); if (!ds.length) return 0;
    const on = ds.filter(isOnTime).length / ds.length * 100;
    const success = ds.filter(d => n(d.returnedQty) === 0).length / ds.length * 100;
    const fuel = ds.map(d => { const norm=normFuel(d); return norm>0 ? Math.max(0, Math.min(100, norm/n(d.fuelLiters||norm)*100)) : 100; }).reduce((a,b)=>a+b,0)/ds.length;
    return on*0.4 + fuel*0.25 + success*0.2 + 100*0.15;
  }
  function card(title, value, icon, tone='blue') { return typeof mkpi==='function' ? mkpi(title,value,icon,tone) : `<div class="card"><b>${e(title)}</b><div>${e(value)}</div></div>`; }
  function header(title, sub, actions='') { return typeof pageHead==='function' ? pageHead(title,sub,actions) : `<h2>${e(title)}</h2><p>${e(sub)}</p>${actions}`; }
  function table(cols, rows, empty='Chưa có dữ liệu') { return typeof tableShell==='function' ? tableShell(cols.map(c=>typeof c==='string'?{t:c}:c),rows,{emptyTitle:empty}) : `<table><tbody>${rows}</tbody></table>`; }

  // Bộ lọc dùng chung cho các danh sách Logistics. Dữ liệu chỉ lọc trên snapshot
  // đã hydrate; thay đổi filter không phát sinh thêm request server.
  function lgToolbar(parts){ return `<div class="toolbar" style="margin-bottom:12px">${parts.join('')}</div>`; }
  function lgDateInput(key, field, label){
    const f=F(key); return `<label class="date-filter" style="display:flex;align-items:center;gap:6px;white-space:nowrap"><span class="muted">${e(label)}</span><input class="inp" type="date" data-f="${e(key)}.${e(field)}" value="${e(f[field]||'')}"></label>`;
  }
  function lgIncludes(values,q){ if(!q)return true; const needle=String(q).trim().toLowerCase(); return values.some(v=>String(v??'').toLowerCase().includes(needle)); }

  function dashboardView() {
    load(); normalizeStatuses();
    const todayStr = today(); const active=L.deliveries.filter(d=>['DISPATCHED','READY','IN_TRANSIT'].includes(d.status)); const wait=L.deliveries.filter(d=>d.status==='WAIT_DISPATCH');
    const closed=closedTrips(); const onTime=closed.length?closed.filter(isOnTime).length/closed.length*100:0; const km=closed.reduce((s,d)=>s+n(d.actualKm),0); const totalCost=closed.reduce((s,d)=>s+tripCost(d),0)+L.maintenance.filter(m=>m.status==='DONE').reduce((s,m)=>s+n(m.cost),0);
    const rows=L.vehicles.map(v=>{const ds=closed.filter(d=>d.vehicleId===v.id),vk=ds.reduce((s,d)=>s+n(d.actualKm),0),c=ds.reduce((s,d)=>s+tripCost(d),0)+maintenanceCostForVehicle(v.id),ot=ds.length?ds.filter(isOnTime).length/ds.length*100:0;return `<tr><td><b>${e(v.plate)}</b><div class="cell-sub">${e(v.type)}</div></td><td class="right num">${ds.length}</td><td class="right num">${num(vk,1)}</td><td class="right num">${money(c)}</td><td class="right num">${vk?money(c/vk):'—'}</td><td class="right num">${ds.length?num(ot,1)+'%':'—'}</td><td>${statusBadge(v.status)}</td></tr>`}).join('');
    const schedule=L.deliveries.filter(d=>d.promisedDate===todayStr).sort((a,b)=>String(a.promisedTime).localeCompare(String(b.promisedTime))).map(d=>`<tr class="clickable" data-act="lg-delivery-view" data-id="${e(d.id)}"><td><span class="code">${e(d.id)}</span></td><td>${e(d.promisedTime||'—')}</td><td>${e(d.customer)}</td><td>${e(vehicle(d.vehicleId)?.plate||'Chưa điều phối')}</td><td>${e(driver(d.driverId)?.name||'—')}</td><td>${statusBadge(d.status)}</td></tr>`).join('');
    return `${header('Tổng quan Logistics & Fleet','Điều phối giao hàng, theo dõi đội xe và kiểm soát chi phí vận tải.',`<button class="btn btn-primary" data-act="lg-delivery-new"><i class="fa-solid fa-plus"></i>Tạo đơn giao</button>`)}
      <div class="grid g-auto-sm" style="margin-bottom:14px">${card('Chuyến hôm nay',L.deliveries.filter(d=>d.promisedDate===todayStr).length,'fa-truck-fast','blue')}${card('Đang giao',active.length,'fa-route','teal')}${card('Chờ điều phối',wait.length,'fa-clock','orange')}${card('Giao đúng hạn',closed.length?num(onTime,1)+'%':'—','fa-bullseye','green')}${card('Tổng km',num(km,1)+' km','fa-road','slate')}${card('Tổng chi phí',money(totalCost),'fa-coins','orange')}</div>
      <div class="grid g-2"><div class="card"><div class="card-head"><div><h3>Lịch giao hôm nay</h3><p>Các chuyến theo hạn giao</p></div></div>${table(['Mã giao','Giờ','Khách hàng','Xe','Tài xế','Trạng thái'],schedule,'Hôm nay chưa có chuyến giao')}</div><div class="card"><div class="card-head"><div><h3>Hiệu quả đội xe</h3><p>Chi phí và tỷ lệ đúng hạn theo từng xe</p></div></div>${table([{t:'Xe'},{t:'Chuyến',cls:'right'},{t:'Km',cls:'right'},{t:'Chi phí',cls:'right'},{t:'Chi phí/km',cls:'right'},{t:'Đúng hạn',cls:'right'},{t:'Trạng thái'}],rows,'Chưa có xe')}</div></div>`;
  }

  function deliveriesView(dispatchOnly=false) {
    load();
    const key='lg-deliveries', f=F(key,{q:'',status:'',vehicleId:'',driverId:'',dateFrom:'',dateTo:'',tripType:''});
    let data=L.deliveries.slice().filter(d=>{
      if(f.status && d.status!==f.status) return false;
      if(f.vehicleId && d.vehicleId!==f.vehicleId) return false;
      if(f.driverId && d.driverId!==f.driverId) return false;
      if(f.tripType==='TRIP' && !d.tripId) return false;
      if(f.tripType==='SINGLE' && d.tripId) return false;
      if(f.dateFrom && String(d.promisedDate||'')<f.dateFrom) return false;
      if(f.dateTo && String(d.promisedDate||'')>f.dateTo) return false;
      return lgIncludes([d.id,d.orderId,d.customer,d.address,d.route,vehicle(d.vehicleId)?.plate,driver(d.driverId)?.name],f.q);
    }).sort((a,b)=>String(b.id).localeCompare(String(a.id),'vi',{numeric:true}));
    const rows=data.map(d=>`<tr class="clickable" data-act="lg-delivery-view" data-id="${e(d.id)}"><td><span class="code">${e(d.id)}</span><div class="cell-sub">${e(d.orderId||'Không tham chiếu SO')}</div><div style="margin-top:3px">${tripBadge(d)}</div></td><td>${e(d.customer)}<div class="cell-sub">${e(d.address)}</div></td><td>${dateFmt(d.promisedDate)} ${e(d.promisedTime||'')}</td><td>${e(vehicle(d.vehicleId)?.plate||'—')}</td><td>${e(driver(d.driverId)?.name||'—')}</td><td class="right num">${num(d.cargoKg)} kg</td><td>${statusBadge(d.status)}</td><td class="right">${d.status==='WAIT_DISPATCH'?`<button class="btn btn-sm btn-primary" data-act="lg-dispatch" data-id="${e(d.id)}"><i class="fa-solid fa-route"></i>Điều phối</button>`:d.status==='DISPATCHED'?`<button class="btn btn-sm btn-primary" data-act="lg-trip-start" data-id="${e(d.id)}"><i class="fa-solid fa-play"></i>Bắt đầu</button>`:d.status==='IN_TRANSIT'?`<button class="btn btn-sm btn-primary" data-act="lg-trip-complete" data-id="${e(d.id)}"><i class="fa-solid fa-flag-checkered"></i>Giao hàng</button>`:''}</td></tr>`).join('');
    const waitWarehouse=L.deliveries.filter(d=>d.status==='WAIT_WAREHOUSE').length;
    const filters=lgToolbar([
      searchBox(key,'Tìm mã giao, đơn bán, khách hàng, địa chỉ…'),
      selectFilter(key,'status',[['WAIT_WAREHOUSE','Chờ Kho xuất'],['WAIT_DISPATCH','Chờ điều phối'],['DISPATCHED','Đã điều phối'],['IN_TRANSIT','Đang giao'],['CLOSED','Đã chốt chuyến']],'Tất cả trạng thái'),
      selectFilter(key,'vehicleId',(L.vehicles||[]).map(v=>[v.id,v.plate]),'Tất cả xe'),
      selectFilter(key,'driverId',(L.drivers||[]).map(d=>[d.id,d.name]),'Tất cả tài xế'),
      selectFilter(key,'tripType',[['SINGLE','Đơn lẻ'],['TRIP','Đơn theo chuyến']],'Tất cả loại đơn'),
      lgDateInput(key,'dateFrom','Từ ngày'),lgDateInput(key,'dateTo','Đến ngày')
    ]);
    return `${header(dispatchOnly?'Điều phối giao hàng':'Đơn giao hàng',dispatchOnly?'Phân xe, tài xế và thời gian xuất phát cho các đơn đang chờ.':'Theo dõi đơn giao từ lúc lập đến khi xác nhận giao và tự động chốt chuyến.',`<button class="btn" data-act="lg-trip-make"><i class="fa-solid fa-route"></i>Tạo chuyến</button><button class="btn btn-primary" data-act="lg-delivery-new"><i class="fa-solid fa-plus"></i>Tạo đơn giao</button>`)}<div class="grid g-auto-sm" style="margin-bottom:14px">${card('Chờ Kho xuất',waitWarehouse,'fa-box','orange')}${card('Chờ điều phối',L.deliveries.filter(d=>d.status==='WAIT_DISPATCH').length,'fa-clock','orange')}${card('Đã điều phối',L.deliveries.filter(d=>d.status==='DISPATCHED').length,'fa-calendar-check','blue')}${card('Đang giao',L.deliveries.filter(d=>d.status==='IN_TRANSIT').length,'fa-truck-fast','teal')}${card('Đã chốt',L.deliveries.filter(d=>d.status==='CLOSED').length,'fa-circle-check','green')}</div><div class="card">${filters}${table([{t:'Đơn giao / SO'},{t:'Khách hàng'},{t:'Hạn giao'},{t:'Xe'},{t:'Tài xế'},{t:'Khối lượng',cls:'right'},{t:'Trạng thái'},{t:'',cls:'right'}],rows,'Không có đơn giao phù hợp bộ lọc')}</div>`;
  }

  function fleetView() {
    load(); const key='lg-fleet',f=F(key,{q:'',status:'',typeId:''});
    const data=(L.vehicles||[]).filter(v=>(!f.status||v.status===f.status)&&(!f.typeId||v.typeId===f.typeId)&&lgIncludes([v.id,v.plate,v.type,v.gpsDevice],f.q));
    const rows=data.map(v=>{const c=totalVehicleCost(v.id),km=closedTrips().filter(d=>d.vehicleId===v.id).reduce((s,d)=>s+n(d.actualKm),0);return `<tr class="clickable" data-act="lg-vehicle-edit" data-id="${e(v.id)}"><td><span class="code">${e(v.id)}</span></td><td><b>${e(v.plate)}</b><div class="cell-sub">${e(v.type)}</div></td><td class="right num">${num(v.capacityKg)} kg</td><td class="right num">${num(v.fuelNorm,1)} L/100km</td><td class="right num">${num(v.odometer)} km</td><td>${dateFmt(v.nextMaintenanceDate)}<div class="cell-sub">${num(v.nextMaintenanceKm)} km</div></td><td class="right num">${money(c)}</td><td class="right num">${km?money(c/km):'—'}</td><td>${statusBadge(v.status)}</td></tr>`}).join('');
    const filters=lgToolbar([searchBox(key,'Tìm biển số, mã xe, loại xe…'),selectFilter(key,'status',[['AVAILABLE','Sẵn sàng'],['BUSY','Đang chạy'],['MAINTENANCE','Bảo trì'],['INACTIVE','Ngừng hoạt động']],'Tất cả trạng thái'),selectFilter(key,'typeId',(L.vehicleTypes||[]).map(t=>[t.id,t.name]),'Tất cả loại xe')]);
    return `${header('Danh sách xe','Danh sách phương tiện, tải trọng, định mức nhiên liệu, lịch bảo trì và chi phí vận hành.',`<button class="btn btn-primary" data-act="lg-vehicle-new"><i class="fa-solid fa-plus"></i>Thêm xe</button>`)}<div class="grid g-auto-sm" style="margin-bottom:14px">${card('Tổng xe',L.vehicles.length,'fa-truck','blue')}${card('Sẵn sàng',L.vehicles.filter(v=>v.status==='AVAILABLE').length,'fa-circle-check','green')}${card('Đang chạy',L.vehicles.filter(v=>v.status==='BUSY').length,'fa-road','teal')}${card('Bảo trì',L.vehicles.filter(v=>v.status==='MAINTENANCE').length,'fa-screwdriver-wrench','orange')}</div><div class="card">${filters}${table([{t:'Mã'},{t:'Xe'},{t:'Tải trọng',cls:'right'},{t:'ĐM nhiên liệu',cls:'right'},{t:'Odometer',cls:'right'},{t:'Bảo trì kế tiếp'},{t:'Tổng chi phí',cls:'right'},{t:'Chi phí/km',cls:'right'},{t:'Trạng thái'}],rows,'Không có xe phù hợp bộ lọc')}</div>`;
  }

  function vehicleTypesView() {
    load(); const key='lg-vehicle-types',f=F(key,{q:'',status:'',refrigerated:''});
    const data=(L.vehicleTypes||[]).filter(t=>(!f.status||t.status===f.status)&&(!f.refrigerated||String(!!t.refrigerated)===f.refrigerated)&&lgIncludes([t.id,t.name,t.bodyType,t.defaultFuelType],f.q));
    const rows=data.map(t=>{const used=(L.vehicles||[]).filter(v=>v.typeId===t.id || (!v.typeId && String(v.type||'').trim()===String(t.name||'').trim())).length;return `<tr class="clickable" data-act="lg-vehicle-type-edit" data-id="${e(t.id)}"><td><span class="code">${e(t.id)}</span></td><td><b>${e(t.name)}</b><div class="cell-sub">${e(t.bodyType||'—')}</div></td><td>${t.refrigerated?'Có':'Không'}</td><td class="right num">${num(t.defaultCapacityKg)} kg</td><td>${e(t.defaultFuelType||'—')}</td><td class="right num">${num(t.defaultFuelNorm,1)} L/100km</td><td class="right num">${num(t.maintenanceCycleKm)} km</td><td class="right num">${used}</td><td>${t.status==='INACTIVE'?'<span class="badge bad">Ngừng dùng</span>':'<span class="badge ok">Đang dùng</span>'}</td></tr>`}).join('');
    const filters=lgToolbar([searchBox(key,'Tìm mã hoặc loại xe…'),selectFilter(key,'status',[['ACTIVE','Đang dùng'],['INACTIVE','Ngừng dùng']],'Tất cả trạng thái'),selectFilter(key,'refrigerated',[['true','Có giữ lạnh'],['false','Không giữ lạnh']],'Tất cả cấu hình')]);
    return `${header('Danh mục xe','Khai báo loại xe và thông số mặc định. Xe thực tế trong Danh sách xe có thể chọn từ danh mục này.',`<button class="btn btn-primary" data-act="lg-vehicle-type-new"><i class="fa-solid fa-plus"></i>Thêm loại xe</button>`)}<div class="grid g-auto-sm" style="margin-bottom:14px">${card('Loại xe',(L.vehicleTypes||[]).length,'fa-truck-field','blue')}${card('Có thùng lạnh',(L.vehicleTypes||[]).filter(x=>x.refrigerated).length,'fa-snowflake','teal')}${card('Đang sử dụng',(L.vehicleTypes||[]).filter(x=>x.status!=='INACTIVE').length,'fa-circle-check','green')}${card('Xe thực tế',(L.vehicles||[]).length,'fa-truck','slate')}</div><div class="card">${filters}${table([{t:'Mã'},{t:'Loại xe'},{t:'Giữ lạnh'},{t:'Tải mặc định',cls:'right'},{t:'Nhiên liệu'},{t:'ĐM nhiên liệu',cls:'right'},{t:'Chu kỳ BT',cls:'right'},{t:'Số xe',cls:'right'},{t:'Trạng thái'}],rows,'Không có loại xe phù hợp bộ lọc')}</div>`;
  }

  function driversView() {
    load(); const key='lg-drivers',f=F(key,{q:'',status:'',licenseClass:''});
    const data=(L.drivers||[]).filter(d=>(!f.status||d.status===f.status)&&(!f.licenseClass||d.licenseClass===f.licenseClass)&&lgIncludes([d.id,d.employeeId,d.name,d.phone,d.licenseNo],f.q));
    const rows=data.map(d=>{const ds=closedTrips().filter(x=>x.driverId===d.id),ot=ds.length?ds.filter(isOnTime).length/ds.length*100:0;return `<tr class="clickable" data-act="lg-driver-edit" data-id="${e(d.id)}"><td><span class="code">${e(d.id)}</span><div class="cell-sub">${e(d.employeeId||'')}</div></td><td><b>${e(d.name)}</b><div class="cell-sub">${e(d.phone)}</div></td><td>${e(d.licenseClass)} · ${e(d.licenseNo)}<div class="cell-sub">Hết hạn ${dateFmt(d.licenseExpiry)}</div></td><td class="right num">${ds.length}</td><td class="right num">${ds.length?num(ot,1)+'%':'—'}</td><td class="right num"><b>${ds.length?num(driverScore(d.id),1)+'/100':'—'}</b></td><td>${statusBadge(d.status)}</td></tr>`}).join('');
    const classes=[...new Set((L.drivers||[]).map(d=>d.licenseClass).filter(Boolean))].sort().map(x=>[x,x]);
    const filters=lgToolbar([searchBox(key,'Tìm tài xế, SĐT, GPLX…'),selectFilter(key,'status',[['AVAILABLE','Sẵn sàng'],['BUSY','Đang chạy'],['OFF','Nghỉ'],['INACTIVE','Ngừng']],'Tất cả trạng thái'),selectFilter(key,'licenseClass',classes,'Tất cả hạng GPLX')]);
    return `${header('Danh sách tài xế','Hồ sơ tài xế, giấy phép lái xe và hiệu quả giao hàng.',`<button class="btn btn-primary" data-act="lg-driver-new"><i class="fa-solid fa-plus"></i>Thêm tài xế</button>`)}<div class="grid g-auto-sm" style="margin-bottom:14px">${card('Tổng tài xế',L.drivers.length,'fa-id-card','blue')}${card('Sẵn sàng',L.drivers.filter(d=>d.status==='AVAILABLE').length,'fa-user-check','green')}${card('Đang chạy',L.drivers.filter(d=>d.status==='BUSY').length,'fa-steering-wheel','teal')}${card('Nghỉ / ngừng',L.drivers.filter(d=>['OFF','INACTIVE'].includes(d.status)).length,'fa-user-clock','slate')}</div><div class="card">${filters}${table([{t:'Mã'},{t:'Tài xế'},{t:'GPLX'},{t:'Chuyến',cls:'right'},{t:'Đúng hạn',cls:'right'},{t:'Hiệu quả',cls:'right'},{t:'Trạng thái'}],rows,'Không có tài xế phù hợp bộ lọc')}</div>`;
  }

  function maintenanceView() {
    load(); const key='lg-maintenance',f=F(key,{q:'',status:'',vehicleId:'',dateFrom:'',dateTo:''});
    const warning=L.vehicles.filter(v=>v.status!=='RETIRED' && (v.nextMaintenanceDate<=addDaysLocal(today(),7) || (n(v.nextMaintenanceKm)>0 && n(v.nextMaintenanceKm)-n(v.odometer)<=500)));
    const data=L.maintenance.slice().filter(m=>(!f.status||m.status===f.status)&&(!f.vehicleId||m.vehicleId===f.vehicleId)&&(!f.dateFrom||String(m.scheduledDate||'')>=f.dateFrom)&&(!f.dateTo||String(m.scheduledDate||'')<=f.dateTo)&&lgIncludes([m.id,m.type,m.vendor,m.description,vehicle(m.vehicleId)?.plate],f.q)).sort((a,b)=>String(b.scheduledDate).localeCompare(String(a.scheduledDate)));
    const rows=data.map(m=>`<tr class="clickable" data-act="lg-maint-view" data-id="${e(m.id)}"><td><span class="code">${e(m.id)}</span></td><td><b>${e(vehicle(m.vehicleId)?.plate||m.vehicleId)}</b></td><td>${e(m.type)}</td><td>${dateFmt(m.scheduledDate)}<div class="cell-sub">${num(m.scheduledKm)} km</div></td><td>${e(m.vendor||'—')}</td><td class="right num">${money(m.cost)}</td><td>${statusBadge(m.status)}</td></tr>`).join('');
    const filters=lgToolbar([searchBox(key,'Tìm phiếu, xe, loại, đơn vị sửa chữa…'),selectFilter(key,'status',[['PLANNED','Kế hoạch'],['IN_PROGRESS','Đang bảo trì'],['DONE','Hoàn thành'],['CANCELLED','Đã hủy']],'Tất cả trạng thái'),selectFilter(key,'vehicleId',(L.vehicles||[]).map(v=>[v.id,v.plate]),'Tất cả xe'),lgDateInput(key,'dateFrom','Từ ngày'),lgDateInput(key,'dateTo','Đến ngày')]);
    return `${header('Bảo trì xe','Theo dõi bảo trì định kỳ theo ngày/km; xe đang bảo trì không được phép điều phối.',`<button class="btn btn-primary" data-act="lg-maint-new"><i class="fa-solid fa-plus"></i>Lập lịch bảo trì</button>`)}${warning.length?`<div class="alert-item" style="margin-bottom:14px"><i class="fa-solid fa-triangle-exclamation"></i><div><b>${warning.length} xe sắp đến hạn bảo trì</b><div class="muted">${warning.map(v=>`${e(v.plate)} · ${dateFmt(v.nextMaintenanceDate)} / ${num(v.nextMaintenanceKm)} km`).join(' &nbsp; • &nbsp; ')}</div></div></div>`:''}<div class="grid g-auto-sm" style="margin-bottom:14px">${card('Kế hoạch',L.maintenance.filter(m=>m.status==='PLANNED').length,'fa-calendar','blue')}${card('Đang bảo trì',L.maintenance.filter(m=>m.status==='IN_PROGRESS').length,'fa-screwdriver-wrench','orange')}${card('Hoàn thành',L.maintenance.filter(m=>m.status==='DONE').length,'fa-circle-check','green')}${card('Chi phí bảo trì',money(L.maintenance.filter(m=>m.status==='DONE').reduce((s,m)=>s+n(m.cost),0)),'fa-coins','slate')}</div><div class="card">${filters}${table([{t:'Phiếu'},{t:'Xe'},{t:'Loại'},{t:'Kế hoạch'},{t:'Đơn vị sửa chữa'},{t:'Chi phí',cls:'right'},{t:'Trạng thái'}],rows,'Không có phiếu bảo trì phù hợp bộ lọc')}</div>`;
  }

  function gpsView() {
    load(); const key='lg-gps',f=F(key,{q:'',vehicleId:'',driverId:''});
    const active=L.deliveries.filter(d=>d.status==='IN_TRANSIT'&&(!f.vehicleId||d.vehicleId===f.vehicleId)&&(!f.driverId||d.driverId===f.driverId)&&lgIncludes([d.id,d.customer,d.route,d.address,vehicle(d.vehicleId)?.plate,driver(d.driverId)?.name],f.q));
    const rows=active.map(d=>`<tr class="clickable" data-act="lg-delivery-view" data-id="${e(d.id)}"><td><span class="code">${e(d.id)}</span></td><td><b>${e(vehicle(d.vehicleId)?.plate||'—')}</b></td><td>${e(driver(d.driverId)?.name||'—')}</td><td>${e(d.route||d.address)}</td><td class="right num">${num(d.actualKm,1)} / ${num(d.estimatedKm,1)} km</td><td>${d.gpsLat&&d.gpsLng?`${num(d.gpsLat,5)}, ${num(d.gpsLng,5)}`:'Chưa có tọa độ'}</td><td>${d.gpsUpdatedAt?new Date(d.gpsUpdatedAt).toLocaleString('vi-VN'):'—'}</td><td><button class="btn btn-sm" data-act="lg-gps-update" data-id="${e(d.id)}"><i class="fa-solid fa-location-dot"></i>Cập nhật GPS</button></td></tr>`).join('');
    const filters=lgToolbar([searchBox(key,'Tìm chuyến, xe, tài xế, tuyến…'),selectFilter(key,'vehicleId',(L.vehicles||[]).map(v=>[v.id,v.plate]),'Tất cả xe'),selectFilter(key,'driverId',(L.drivers||[]).map(d=>[d.id,d.name]),'Tất cả tài xế')]);
    return `${header('GPS / Theo dõi xe','Theo dõi vị trí gần nhất, quãng đường và trạng thái các chuyến đang giao.')}<div class="grid g-auto-sm" style="margin-bottom:14px">${card('Xe đang chạy',L.deliveries.filter(d=>d.status==='IN_TRANSIT').length,'fa-satellite-dish','teal')}${card('Thiết bị GPS',L.vehicles.filter(v=>v.gpsDevice).length,'fa-location-crosshairs','blue')}${card('Mất tín hiệu',L.deliveries.filter(d=>d.status==='IN_TRANSIT'&&!d.gpsUpdatedAt).length,'fa-triangle-exclamation','orange')}</div><div class="card">${filters}${table([{t:'Chuyến'},{t:'Xe'},{t:'Tài xế'},{t:'Tuyến'},{t:'Tiến độ km',cls:'right'},{t:'Tọa độ'},{t:'Cập nhật cuối'},{t:''}],rows,'Không có xe đang giao phù hợp bộ lọc')}</div>`;
  }

  function scheduleView() {
    load(); const key='lg-schedule',f=F(key,{q:'',status:'',vehicleId:'',driverId:'',dateFrom:'',dateTo:''});
    const source=L.deliveries.filter(d=>(!f.status||d.status===f.status)&&(!f.vehicleId||d.vehicleId===f.vehicleId)&&(!f.driverId||d.driverId===f.driverId)&&(!f.dateFrom||String(d.promisedDate||'')>=f.dateFrom)&&(!f.dateTo||String(d.promisedDate||'')<=f.dateTo)&&lgIncludes([d.id,d.orderId,d.customer,d.route,d.address,vehicle(d.vehicleId)?.plate,driver(d.driverId)?.name],f.q));
    const groups={}; source.forEach(d=>{(groups[d.promisedDate] ||= []).push(d)});
    const blocks=Object.keys(groups).sort().map(day=>`<div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>${dateFmt(day)}</h3><p>${groups[day].length} chuyến giao</p></div></div>${table(['Giờ','Mã giao','Khách hàng','Tuyến','Xe / tài xế','Trạng thái'],groups[day].sort((a,b)=>String(a.promisedTime).localeCompare(String(b.promisedTime))).map(d=>`<tr class="clickable" data-act="lg-delivery-view" data-id="${e(d.id)}"><td><b>${e(d.promisedTime||'—')}</b></td><td><span class="code">${e(d.id)}</span></td><td>${e(d.customer)}</td><td>${e(d.route||d.address)}</td><td>${e(vehicle(d.vehicleId)?.plate||'Chưa điều phối')}<div class="cell-sub">${e(driver(d.driverId)?.name||'')}</div></td><td>${statusBadge(d.status)}</td></tr>`).join(''))}</div>`).join('');
    const filters=lgToolbar([searchBox(key,'Tìm chuyến, khách hàng, tuyến…'),selectFilter(key,'status',[['WAIT_WAREHOUSE','Chờ Kho xuất'],['WAIT_DISPATCH','Chờ điều phối'],['DISPATCHED','Đã điều phối'],['IN_TRANSIT','Đang giao'],['CLOSED','Đã chốt chuyến']],'Tất cả trạng thái'),selectFilter(key,'vehicleId',(L.vehicles||[]).map(v=>[v.id,v.plate]),'Tất cả xe'),selectFilter(key,'driverId',(L.drivers||[]).map(d=>[d.id,d.name]),'Tất cả tài xế'),lgDateInput(key,'dateFrom','Từ ngày'),lgDateInput(key,'dateTo','Đến ngày')]);
    return `${header('Lịch giao hàng','Lịch các chuyến theo ngày và giờ cam kết giao khách hàng.',`<button class="btn btn-primary" data-act="lg-delivery-new"><i class="fa-solid fa-plus"></i>Tạo đơn giao</button>`)}${filters}${blocks||'<div class="card"><div class="empty">Không có lịch giao phù hợp bộ lọc</div></div>'}`;
  }


  function fuelCompareSection(d) {
    const tk = n(d.tripActualKm) || n(d.actualKm);
    const hasProp = d.fuelProposedLiters != null && d.fuelProposedLiters !== '';
    const price = n(d.fuelPrice) || getFuelPrice();
    const propL = hasProp ? n(d.fuelProposedLiters) : fuelProposal(d.tripId ? tk * n(d.tripShare || 1) : tk, d.vehicleId, price).liters;
    const propC = hasProp ? n(d.fuelProposedCost) : (price > 0 ? Math.round(propL * price) : 0);
    const aL = n(d.fuelLiters), aC = n(d.fuelCost);
    if (!(propL > 0) && !(aL > 0)) return '';
    const vr = fuelVariance({ liters: propL, cost: propC }, aL, aC);
    const col = (b) => b ? 'style="color:var(--orange);font-weight:600"' : '';
    return `<div class="form-sec-title">Nhiên liệu: đề xuất so với thực tế</div>
      <div class="tbl-wrap"><table class="line-tbl"><thead><tr><th></th><th class="right">Đề xuất</th><th class="right">Thực tế</th><th class="right">Chênh lệch</th></tr></thead><tbody>
      <tr><td>Nhiên liệu (lít)</td><td class="right num">${propL > 0 ? num(propL, 1) + ' L' : '—'}</td><td class="right num">${aL > 0 ? num(aL, 1) + ' L' : '—'}</td><td class="right num" ${col(propL > 0 && aL > 0 && Math.abs(vr.pctL) > FUEL_VAR_LIMIT)}>${propL > 0 && aL > 0 ? `${signed(vr.difL)} L (${signed(vr.pctL, 1)}%)` : '—'}</td></tr>
      <tr><td>Chi phí nhiên liệu</td><td class="right num">${propC > 0 ? money(propC) : '—'}</td><td class="right num">${aC > 0 ? money(aC) : '—'}</td><td class="right num" ${col(propC > 0 && aC > 0 && Math.abs(vr.pctC) > FUEL_VAR_LIMIT)}>${propC > 0 && aC > 0 ? `${signed(vr.difC, 0)}đ (${signed(vr.pctC, 1)}%)` : '—'}</td></tr></tbody></table></div>
      ${d.fuelVarianceNote ? `<div class="cell-sub" style="margin-top:6px"><i class="fa-regular fa-note-sticky"></i> Ghi chú: ${e(d.fuelVarianceNote)}</div>` : ''}`;
  }
  function tripSection(d) {
    const members = d.tripId ? tripMembers(d) : [];
    const mrows = members.map(r => `<tr><td><span class="code">${e(r.id)}</span></td><td>${e(r.customer)}</td><td class="right num">${num(deliveryCargoKg(r), 1)} kg</td><td class="right num">${num(r.actualKm, 1)} km</td><td class="right num">${money(tripCost(r))}</td></tr>`).join('');
    const hist = (d.tripHistory || []).slice().reverse().map(h => {
      const sn = h.snapshot || {}; const ev = { JOINED: 'Vào chuyến', LEFT: 'Rời chuyến', MEMBER_LEFT: 'Đơn khác rời chuyến', REALLOC: 'Phân bổ lại' }[h.event] || h.event;
      return `<tr><td>${e(String(h.at || '').replace('T', ' ').slice(0, 16))}</td><td>${e(h.by || '')}</td><td>${e(ev)}</td><td>${e(sn.tripId || '—')}<div class="cell-sub">${sn.members && sn.members.length ? 'Gồm ' + sn.members.map(e).join(', ') : ''}</div></td><td class="right num">${num(sn.allocatedKm, 1)} km<div class="cell-sub">Tổng chuyến ${num(sn.tripTotalKm, 1)} km</div></td><td class="right num">${money(n(sn.fuelCost) + n(sn.tollCost) + n(sn.parkingCost) + n(sn.otherCost))}</td><td>${e(h.note || '')}</td></tr>`;
    }).join('');
    return `<div class="form-sec-title">Loại đơn: ${tripBadge(d)}</div>
      ${d.customerReceivedAt ? `<div class="cell-sub" style="margin-bottom:8px"><i class="fa-solid fa-handshake"></i> Khách đã nhận hàng lúc ${e(String(d.customerReceivedAt).replace('T', ' ').slice(0, 16))}${d.customerReceiver ? ' · người nhận: ' + e(d.customerReceiver) : ''}</div>` : ''}
      ${members.length ? `<div class="tbl-wrap"><table class="line-tbl"><thead><tr><th>Đơn giao</th><th>Khách hàng</th><th class="right">Khối lượng</th><th class="right">Km phân bổ</th><th class="right">Chi phí phân bổ</th></tr></thead><tbody>${mrows}</tbody></table></div>${d.tripTotals ? `<div class="cell-sub" style="margin-top:6px">Tổng chuyến: ${num(d.tripTotals.km, 1)} km${n(d.tripTotals.kmStart) || n(d.tripTotals.kmEnd) ? ` (công-tơ-mét ${num(d.tripTotals.kmStart, 0)} → ${num(d.tripTotals.kmEnd, 0)})` : ''} · phân bổ theo khối lượng hàng.</div>` : ''}` : ''}
      ${hist ? `<div class="form-sec-title">Nhật ký chuyến</div><div class="tbl-wrap"><table class="line-tbl"><thead><tr><th>Thời gian</th><th>Người</th><th>Sự kiện</th><th>Chuyến</th><th class="right">Km</th><th class="right">Chi phí</th><th>Ghi chú</th></tr></thead><tbody>${hist}</tbody></table></div>` : ''}`;
  }
  function deliveryDetail(d) {
    const v=vehicle(d.vehicleId),dr=driver(d.driverId),norm=normFuel(d);
    const actualFuel=n(d.fuelLiters), hasActualFuel=actualFuel>0;
    const variance=hasActualFuel ? actualFuel-norm : null;
    const actualCost=tripCost(d), hasActualCost=actualCost>0;
    const customerFee=n(d.shippingFee), hasCustomerFee=customerFee>0;
    const actualCostPerKm=n(d.actualKm)>0 && hasActualCost ? actualCost/n(d.actualKm) : 0;
    const topRateLabel=actualCostPerKm>0?'Chi phí thực tế/km':'Đơn giá dự kiến/km';
    const topRateValue=actualCostPerKm>0?money(actualCostPerKm):(n(d.routeRatePerKm)>0?money(d.routeRatePerKm):'—');
    const itemRows = (d.items || []).map(it => `<tr><td><b>${e(it.name||it.productId)}</b></td><td><span class="code">${e(it.productId||'—')}</span></td><td class="right num">${num(it.orderedQty,2)}</td><td class="right num">${num(it.deliveredQty,2)}</td><td class="right num">${num(it.returnedQty,2)}</td><td>${e(it.unit||'')}</td></tr>`).join('');
    const orderRef = d.orderId ? `<button class="btn btn-sm" data-act="open-order" data-id="${e(d.orderId)}"><i class="fa-solid fa-arrow-up-right-from-square"></i>${e(d.orderId)}</button>` : '—';
    const policyCard = (()=>{
      if(d.status!=='CLOSED') return card('Chính sách phí vận chuyển','Chờ hoàn tất chuyến','fa-scale-balanced','slate');
      if(!hasActualCost) return card('Chính sách phí vận chuyển','Chờ quyết toán chi phí','fa-scale-balanced','slate');
      if(!hasCustomerFee) return card('Phí vận chuyển thu khách','Chưa xác định','fa-receipt','slate');
      const diff=customerFee-actualCost;
      if(Math.abs(diff)<0.5) return card('Chính sách phí vận chuyển','Thu đúng chi phí','fa-scale-balanced','green');
      if(diff<0) return card('Doanh nghiệp hỗ trợ',money(Math.abs(diff)),'fa-hand-holding-dollar','orange');
      return card('Thu cao hơn chi phí',money(diff),'fa-arrow-trend-up','green');
    })();
    return `<div class="grid g-3" style="margin-bottom:14px">${card('Trạng thái', (statusBadge(d.status)), 'fa-circle-info','blue')}${card('Quãng đường',`${num(d.actualKm,1)} / ${num(d.estimatedKm,1)} km`,'fa-road','teal')}${card(topRateLabel,topRateValue,'fa-coins','orange')}</div>
      <div class="form-grid cols-2"><div class="field"><label>Khách hàng</label><div class="inp">${e(d.customer)}</div></div><div class="field"><label>Hạn giao</label><div class="inp">${dateFmt(d.promisedDate)} ${e(d.promisedTime||'')}</div></div><div class="field"><label>Địa chỉ</label><div class="inp">${e(d.address)}</div></div><div class="field"><label>Người nhận / SĐT</label><div class="inp">${e(d.recipient||'—')}${d.phone?` · ${e(d.phone)}`:''}</div></div><div class="field"><label>Tham chiếu đơn bán</label><div>${orderRef}</div></div><div class="field"><label>Phí vận chuyển thu khách</label><div class="inp">${hasCustomerFee?money(customerFee):'Chưa xác định'}</div></div><div class="field"><label>Chi phí vận chuyển dự kiến</label><div class="inp">${n(d.estimatedTransportFee)>0?money(d.estimatedTransportFee):'—'}${n(d.routeRatePerKm)>0?` · ${money(d.routeRatePerKm)}/km`:''}</div></div><div class="field"><label>Xe</label><div class="inp">${e(v?.plate||'Chưa điều phối')}</div></div><div class="field"><label>Tài xế</label><div class="inp">${e(dr?.name||'Chưa điều phối')}</div></div><div class="field"><label>Tuyến</label><div class="inp">${e(d.route||'—')}</div></div><div class="field"><label>Khối lượng vận chuyển</label><div class="inp">${n(d.cargoKg)>0?`${num(d.cargoKg,2)} kg`:'Chưa cập nhật'}</div></div>${d.deliveryNote?`<div class="field" style="grid-column:1/-1"><label>Ghi chú giao hàng</label><div class="inp">${e(d.deliveryNote)}</div></div>`:''}</div>
      ${(d.items||[]).length?`<div class="form-sec-title">Chi tiết hàng giao</div>${table([{t:'Thành phẩm'},{t:'Mã'},{t:'Theo đơn',cls:'right'},{t:'Khách nhận',cls:'right'},{t:'Trả về',cls:'right'},{t:'ĐVT'}],itemRows,'Chưa có dòng hàng')}`:''}
      <div class="form-sec-title">Chi phí chuyến</div><div class="grid g-auto-sm">${card('Quãng đường thực tế',n(d.actualKm)>0?`${num(d.actualKm,1)} km`:'Chưa cập nhật','fa-road','teal')}${card('Đơn giá dự kiến',n(d.routeRatePerKm)>0?`${money(d.routeRatePerKm)}/km`:'—','fa-calculator','slate')}${card('Chi phí dự kiến',n(d.estimatedTransportFee)>0?money(d.estimatedTransportFee):'—','fa-file-invoice-dollar','blue')}${card('Nhiên liệu định mức',norm>0?`${num(norm,1)} L`:'—','fa-gauge','slate')}${card('Nhiên liệu thực tế',hasActualFuel?`${num(actualFuel,1)} L`:'Chưa nhập','fa-gas-pump','blue')}${card('Chênh lệch nhiên liệu',variance==null?'—':`${variance>=0?'+':''}${num(variance,1)} L`,'fa-scale-balanced',variance==null?'slate':variance>0?'orange':'green')}${card('Chi phí thực tế',hasActualCost?money(actualCost):'Chưa quyết toán','fa-money-bill','teal')}${card('Phí thu khách',hasCustomerFee?money(customerFee):'Chưa xác định','fa-receipt','indigo')}${policyCard}</div>${fuelCompareSection(d)}${tripSection(d)}`;
  }

  // ---- Form helpers --------------------------------------------------------
  function salesIssueCompleted(orderId) {
    return ((typeof DB !== 'undefined' && DB.goodsIssues) || []).some(x => x.type === 'SALES_ISSUE' && x.status === 'COMPLETED' && String(x.orderId || x.refDoc || '') === String(orderId));
  }
  function eligibleSalesOrders() {
    return ((typeof DB !== 'undefined' && DB.orders) || []).filter(o =>
      o.status === 'dh_cho_van_chuyen' && salesIssueCompleted(o.id) && !L.deliveries.some(d => d.orderId === o.id && !['FAILED','CANCELLED'].includes(d.status))
    );
  }
  function readySalesOrdersAwaitingWarehouse() {
    return ((typeof DB !== 'undefined' && DB.orders) || []).filter(o =>
      o.status === 'dh_hoan_thanh' &&
      !salesIssueCompleted(o.id) &&
      !L.deliveries.some(d => d.orderId === o.id && !['FAILED','CANCELLED'].includes(d.status))
    ).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || String(b.id||'').localeCompare(String(a.id||''),'vi',{numeric:true}));
  }
  function crmOrderOptions(selected='') {
    const orders = eligibleSalesOrders();
    return `<option value="">-- Chọn đơn hàng đã xuất kho --</option>` + orders.map(o => `<option value="${e(o.id)}" ${o.id===selected?'selected':''}>${e(o.id)} · ${e((typeof Q!=='undefined'&&Q.customer?Q.customer(o.customerId)?.name:'')||o.customerName||o.customerId||'Khách hàng')}</option>`).join('');
  }
  function logisticsUnitIsKg(unit) {
    const u=String(unit||'').trim().toLowerCase().replace(/\s+/g,'');
    return ['kg','kgs','kilogram','kilograms','kilôgam','kilogam'].includes(u);
  }
  function orderItemWeightInfo(it) {
    const p = (typeof Q !== 'undefined' && Q.product) ? Q.product(it?.productId) : null;
    const unit = it?.unit || p?.unit || '';
    if (logisticsUnitIsKg(unit)) return { packedWeightKg:1, shippingWeightKg:Math.max(0,n(it?.qty)), unit, isKg:true };
    const packedWeightKg = n(it?.packedWeightKg) || (n(p?.packedWeightG)>0 ? n(p.packedWeightG)/1000 : n(p?.packedWeightKg));
    return { packedWeightKg, shippingWeightKg:Math.round(n(it?.qty)*packedWeightKg*1000)/1000, unit, isKg:false };
  }

  function orderShippingWeightKg(o) {
    if (!o) return 0;
    const fromOrder = n(o.shippingWeightKg);
    if (fromOrder > 0) return Math.round(fromOrder * 1000) / 1000;
    const total = (o.items || []).reduce((sum, it) => sum + orderItemWeightInfo(it).shippingWeightKg, 0);
    return Math.round(total * 1000) / 1000;
  }
  function orderSnapshot(o) {
    const customer = (typeof Q !== 'undefined' && Q.customer) ? Q.customer(o.customerId) : null;
    const items = (o.items || []).map(it => {
      const p = (typeof Q !== 'undefined' && Q.product) ? Q.product(it.productId) : null;
      const w = orderItemWeightInfo(it);
      return { productId:it.productId, name:it.name || p?.name || it.productId, unit:w.unit, orderedQty:n(it.qty), packedWeightKg:w.packedWeightKg, shippingWeightKg:w.shippingWeightKg, deliveredQty:0, returnedQty:0 };
    });
    return {
      customer: customer?.name || o.customerName || o.customerId || '',
      address: o.deliveryAddress || customer?.address || '',
      lat: n(o.deliveryLat || o.shippingLat || customer?.lat || customer?.latitude),
      lng: n(o.deliveryLng || o.shippingLng || customer?.lng || customer?.longitude),
      recipient: o.deliveryRecipient || customer?.contact || customer?.name || '',
      phone: o.deliveryPhone || customer?.phone || '',
      deliveryNote: o.deliveryNote || '',
      shippingFee: n(o.shippingFee),
      shippingWeightKg: orderShippingWeightKg(o),
      promisedDate: o.dueDate || today(),
      items
    };
  }
  function deliverySourceWarehouse(d) {
    if (typeof DB === 'undefined') return null;
    const issues = DB.goodsIssues || [];
    const issue = issues.find(x => d?.salesIssueId && x.id === d.salesIssueId)
      || issues.find(x => x.type === 'SALES_ISSUE' && x.status === 'COMPLETED' && String(x.orderId || x.refDoc || '') === String(d?.orderId || ''));
    const wh = (DB.warehouses || []).find(w => w.id === issue?.warehouseId)
      || (DB.warehouses || []).find(w => w.type === 'FINISHED_GOODS' && w.status === 'active')
      || (DB.warehouses || []).find(w => w.type === 'FINISHED_GOODS')
      || null;
    return wh;
  }
  function routePointFromWarehouse(wh) {
    if (!wh) return null;
    const lat = n(wh.lat || wh.latitude), lng = n(wh.lng || wh.longitude);
    return { name:wh.name || wh.code || wh.id, address:wh.address || '', lat:lat||0, lng:lng||0 };
  }
  function routePointFromDelivery(d) {
    if (!d) return null;
    const order = ((typeof DB !== 'undefined' && DB.orders) || []).find(o => o.id === d.orderId);
    const lat = n(d.deliveryLat || order?.deliveryLat || order?.shippingLat), lng = n(d.deliveryLng || order?.deliveryLng || order?.shippingLng);
    return { id:d.id, name:d.customer || d.id, address:d.address || order?.deliveryAddress || '', lat:lat||0, lng:lng||0 };
  }
  function formatDurationMinutes(v) {
    const m = Math.max(0, n(v));
    if (m < 60) return `${num(m,0)} phút`;
    const h = Math.floor(m/60), mm = Math.round(m%60);
    return `${h} giờ${mm ? ` ${mm} phút` : ''}`;
  }
  function mapEmbedHtml(browserKey, origin, stops) {
    return `<div class="note-box"><b>Bản đồ miễn phí:</b> quãng đường được tính bằng OpenStreetMap + OSRM. Dịch vụ public phù hợp demo/sinh viên, không nên dùng tải lớn. <span class="muted">© OpenStreetMap contributors</span></div>`;
  }

  function renderOrderPreview(orderId) {
    const box = document.querySelector('#lgOrderPreview'); if (!box) return;
    const o = ((typeof DB !== 'undefined' && DB.orders) || []).find(x => x.id === orderId);
    if (!o) { box.innerHTML = '<div class="note-box">Chọn đơn hàng đã được Kho xuất thành phẩm để tạo chuyến giao.</div>'; return; }
    const snap = orderSnapshot(o);
    const customer = document.querySelector('#lgCustomer'), address = document.querySelector('#lgAddress'), pd = document.querySelector('#lgPromiseDate'), cargo = document.querySelector('#lgCargo');
    if (customer) customer.value = snap.customer; if (address) address.value = snap.address; if (pd) pd.value = snap.promisedDate < today() ? today() : snap.promisedDate; if (cargo) cargo.value = snap.shippingWeightKg > 0 ? snap.shippingWeightKg : '';
    box.innerHTML = `<div class="form-sec-title">Hàng giao theo đơn ${e(o.id)}</div>${table([{t:'Thành phẩm'},{t:'Số lượng',cls:'right'},{t:'KL đóng gói / ĐVT',cls:'right'},{t:'Khối lượng',cls:'right'},{t:'ĐVT'}], snap.items.map(it=>`<tr><td>${e(it.name)}<div class="cell-sub">${e(it.productId)}</div></td><td class="right num">${num(it.orderedQty,2)}</td><td class="right num">${it.packedWeightKg>0?num(it.packedWeightKg*1000,2)+' g':'—'}</td><td class="right num">${num(it.shippingWeightKg,3)} kg</td><td>${e(it.unit)}</td></tr>`).join(''), 'Đơn hàng không có sản phẩm')}<div class="note-box" style="margin-top:10px"><b>Tổng khối lượng vận chuyển:</b> ${snap.shippingWeightKg>0?num(snap.shippingWeightKg,3)+' kg':'Chưa đủ dữ liệu khối lượng đóng gói trong master Thành phẩm.'}</div>`;
  }
  function openDeliveryForm() {
    load(); const t=today();
    Modal.open({title:'Tạo đơn giao hàng',sub:'Đơn giao được tạo trực tiếp từ Đơn hàng bán đã hoàn tất xuất kho.',size:'lg',body:`<div class="form-grid cols-2"><div class="field" style="grid-column:1/-1"><label>Đơn bán tham chiếu *</label><select class="inp" id="lgOrderId">${crmOrderOptions()}</select></div><div class="field"><label>Khách hàng</label><input class="inp" id="lgCustomer" readonly></div><div class="field"><label>Khối lượng vận chuyển (kg)</label><input class="inp num" id="lgCargo" type="number" readonly placeholder="Tự tính từ đơn bán"><small>ĐVT Kg: khối lượng = số lượng nhập CRM; ĐVT khác: số lượng × khối lượng đóng gói/ĐVT.</small></div><div class="field" style="grid-column:1/-1"><label>Địa chỉ giao</label><input class="inp" id="lgAddress" readonly></div><div class="field"><label>Ngày giao *</label><input class="inp" id="lgPromiseDate" type="date" min="${t}" value="${t}"></div><div class="field"><label>Giờ cam kết *</label><input class="inp" id="lgPromiseTime" type="time" value="10:00"></div><div class="field"><label>Km dự kiến (dự phòng)</label><input class="inp num" id="lgEstKm" type="number" min="0" step="0.1" value="0" placeholder="OpenStreetMap/OSRM sẽ tính khi điều phối"><small>Có thể nhập tay nếu dịch vụ bản đồ miễn phí không phản hồi.</small></div><div class="field"><label>Ghi chú</label><input class="inp" id="lgNote"></div><div id="lgOrderPreview" style="grid-column:1/-1"><div class="note-box">Chọn đơn hàng đã được Kho xuất thành phẩm để tạo chuyến giao.</div></div></div>`,foot:'<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-delivery-save"><i class="fa-solid fa-floppy-disk"></i>Lưu đơn giao</button>'});
    const select = document.querySelector('#lgOrderId'); if (select) select.addEventListener('change', () => renderOrderPreview(select.value));
  }
  function deliveryCargoKg(d) {
    if (!d) return 0;
    if (n(d.cargoKg) > 0) return n(d.cargoKg);
    const order = ((typeof DB !== 'undefined' && DB.orders) || []).find(o => o.id === d.orderId);
    return orderShippingWeightKg(order);
  }
  function timeToMinutes(v) {
    const m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function kgFmt(v) {
    const x = n(v);
    if (!Number.isFinite(x)) return '0 kg';
    return `${new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(x)} kg`;
  }
  function dispatchCompanions(d) {
    // Gợi ý ghép đơn theo cùng ngày giao và khung giờ gần nhau (±4 giờ).
    // Không ép phải ghép: người điều phối vẫn có thể chạy riêng một đơn rất nhẹ.
    const base = timeToMinutes(d.promisedTime);
    return (L.deliveries || []).filter(x => {
      if (x.id === d.id || x.status !== 'WAIT_DISPATCH' || x.promisedDate !== d.promisedDate || deliveryCargoKg(x) <= 0) return false;
      const tm = timeToMinutes(x.promisedTime);
      if (base == null || tm == null) return true;
      return Math.abs(tm - base) <= 240;
    });
  }
  function tripIdNew() {
    const y = today().slice(0,4); let max = 0;
    (L.deliveries || []).forEach(x => { const m = String(x.tripId || '').match(new RegExp(`^CH-${y}-(\\d+)$`)); if (m) max = Math.max(max, Number(m[1])); });
    return `CH-${y}-${String(max + 1).padStart(3,'0')}`;
  }
  function tripMembers(d) {
    if (!d?.tripId) return d ? [d] : [];
    return (L.deliveries || []).filter(x => x.tripId === d.tripId);
  }
  function timeConflict(a, b, hours = 4) {
    if (!a || !b) return false;
    const da = new Date(a), db = new Date(b); if (Number.isNaN(+da) || Number.isNaN(+db)) return false;
    return Math.abs(+da - +db) < hours * 3600000;
  }
  function vehicleAvailableAt(v, start, excludedIds = new Set()) {
    if (!v || v.status === 'RETIRED') return false;
    if ((L.maintenance || []).some(m => m.vehicleId === v.id && m.status === 'IN_PROGRESS')) return false;
    return !(L.deliveries || []).some(x => !excludedIds.has(x.id) && x.vehicleId === v.id && ['DISPATCHED','READY','IN_TRANSIT'].includes(x.status) && (x.status === 'IN_TRANSIT' || timeConflict(x.plannedStart, start)));
  }
  function driverAvailableAt(dr, start, excludedIds = new Set()) {
    if (!dr || ['OFF','INACTIVE'].includes(dr.status)) return false;
    if (dr.licenseExpiry && dr.licenseExpiry < today()) return false;
    return !(L.deliveries || []).some(x => !excludedIds.has(x.id) && x.driverId === dr.id && ['DISPATCHED','READY','IN_TRANSIT'].includes(x.status) && (x.status === 'IN_TRANSIT' || timeConflict(x.plannedStart, start)));
  }
  function openDispatch(d) {
    const cargo = deliveryCargoKg(d);
    if (cargo > 0) d.cargoKg = cargo;
    const defaultStart = `${d.promisedDate}T08:00`;
    const defaultKm = Math.max(0, n(d.estimatedKm));
    const defaultRate = Math.max(0, n(d.routeRatePerKm) || 10000);
    const defaultFee = Math.round(defaultKm * defaultRate);

    Modal.open({
      title:`Điều phối · ${d.id}`,
      sub:`${d.customer} · ${cargo > 0 ? kgFmt(cargo) : 'chưa có khối lượng đóng gói'}`,
      size:'xl',
      body:`
        <div class="card" style="padding:14px;margin-bottom:14px">
          <div class="form-sec-title" style="margin-bottom:10px">Quãng đường & chi phí dự kiến</div>
          <div class="cell-sub" style="margin-bottom:12px">Điều phối viên nhập tổng quãng đường dự kiến cho đơn giao. Hệ thống tự tính nhiên liệu định mức và phí vận chuyển theo xe.</div>
          <div class="form-grid cols-2">
            <div class="field">
              <label>Km dự kiến *</label>
              <input class="inp num" id="lgEstKm" type="number" min="0" step="0.1" value="${defaultKm || ''}" placeholder="Ví dụ: 25">
              <div class="cell-sub">Tổng km dự kiến từ kho đến điểm giao của đơn.</div>
            </div>
            <div class="field">
              <label>Nhiên liệu định mức dự kiến</label>
              <div class="inp" id="lgExpectedFuel">—</div>
              <div class="cell-sub">Tự tính = Km dự kiến × định mức L/100km của xe.</div>
            </div>
            <div class="field">
              <label>Đơn giá vận chuyển (đ/km)</label>
              <input class="inp num" id="lgRatePerKm" data-money="1" type="text" inputmode="numeric" min="0" step="1000" value="${defaultRate}">
              <div class="cell-sub">Có thể điều chỉnh cho đơn giao hiện tại.</div>
            </div>
            <div class="field">
              <label>Phí vận chuyển dự kiến</label>
              <input class="inp num" id="lgEstimatedFee" type="number" min="0" step="1000" value="${defaultFee}" readonly>
              <div class="cell-sub">Tự tính = Km dự kiến × Đơn giá/km.</div>
            </div>
          </div>
        </div>
        <div class="form-grid cols-2">
          <div class="field">
            <label>Ngày/giờ xuất phát *</label>
            <input class="inp" id="lgStart" type="datetime-local" value="${defaultStart}">
          </div>
          <div class="field">
            <label>Xe phù hợp *</label>
            <select class="inp" id="lgVehicle"><option value="">-- Chọn xe --</option></select>
            <div class="cell-sub" id="lgVehicleHint"></div>
          </div>
          <div class="field">
            <label>Tài xế *</label>
            <select class="inp" id="lgDriver"><option value="">-- Chọn tài xế --</option></select>
          </div>
          <div class="field">
            <label>Hiệu suất tải chuyến hiện tại</label>
            <div class="inp" id="lgLoadFactor">—</div>
            <div class="cell-sub">Khối lượng đơn / tải trọng xe. Không bắt buộc phải đầy xe.</div>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Tuyến giao</label>
            <input class="inp" id="lgRoute" value="Kho xuất hàng → ${e(d.address || '')}">
          </div>
        </div>`,
      foot:'<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-dispatch-save" data-id="'+e(d.id)+'"><i class="fa-solid fa-route"></i>Xác nhận điều phối</button>'
    });

    const selectedIds = new Set([d.id]);
    const refresh = () => {
      const total = cargo;
      const start = document.querySelector('#lgStart')?.value || defaultStart;
      const capable = (L.vehicles || []).filter(v =>
        n(v.capacityKg) >= total &&
        v.status !== 'RETIRED' &&
        !((L.maintenance || []).some(m => m.vehicleId === v.id && m.status === 'IN_PROGRESS'))
      );
      const vs = capable
        .filter(v => vehicleAvailableAt(v, start, selectedIds))
        .sort((a,b) => n(a.capacityKg) - n(b.capacityKg));
      const ds = (L.drivers || []).filter(dr => driverAvailableAt(dr, start, selectedIds));
      const vSel = document.querySelector('#lgVehicle');
      const dSel = document.querySelector('#lgDriver');
      const oldV = vSel?.value || '';
      const oldD = dSel?.value || '';

      if (vSel) {
        vSel.innerHTML = `<option value="">-- Chọn xe --</option>${vs.map((v,i) => {
          const util = n(v.capacityKg) > 0 ? total / n(v.capacityKg) * 100 : 0;
          const remain = Math.max(0, n(v.capacityKg) - total);
          return `<option value="${e(v.id)}" ${oldV===v.id?'selected':''}>${i===0?'★ ':''}${e(v.plate)} · tải ${kgFmt(v.capacityKg)} · chuyến này ${kgFmt(total)} · còn ${kgFmt(remain)} · ${num(util,1)}%</option>`;
        }).join('')}`;
      }
      if (dSel) {
        dSel.innerHTML = `<option value="">-- Chọn tài xế --</option>${ds.map(dr => `<option value="${e(dr.id)}" ${oldD===dr.id?'selected':''}>${e(dr.name)} · GPLX ${e(dr.licenseClass)}</option>`).join('')}`;
      }

      const hint = document.querySelector('#lgVehicleHint');
      if (hint) {
        if (vs.length) hint.innerHTML = `Có <b>${vs.length}</b> xe khả dụng cho tải ${kgFmt(total)}. Xe tải nhỏ phù hợp nhất được xếp trước.`;
        else if (capable.length) hint.innerHTML = `<span style="color:var(--orange)">Có ${capable.length} xe đủ tải nhưng đang bận/bảo trì tại thời điểm này.</span>`;
        else hint.innerHTML = `<span style="color:var(--red)">Không có xe đủ tải cho ${kgFmt(total)}.</span>`;
      }
      updateCalculated();
    };

    const updateCalculated = () => {
      const km = Math.max(0, n(document.querySelector('#lgEstKm')?.value));
      const rate = Math.max(0, parseMoney(document.querySelector('#lgRatePerKm')?.value));
      const vv = vehicle(document.querySelector('#lgVehicle')?.value);
      const fee = Math.round(km * rate);
      const feeBox = document.querySelector('#lgEstimatedFee');
      if (feeBox) feeBox.value = fee;

      const fuelBox = document.querySelector('#lgExpectedFuel');
      if (fuelBox) {
        if (vv && n(vv.fuelNorm) > 0 && km > 0) {
          const liters = km * n(vv.fuelNorm) / 100;
          fuelBox.textContent = `${num(liters,1)} L · ĐM ${num(vv.fuelNorm,1)} L/100km`;
        } else fuelBox.textContent = vv ? `0 L · ĐM ${num(vv.fuelNorm,1)} L/100km` : 'Chọn xe để tính';
      }

      const loadBox = document.querySelector('#lgLoadFactor');
      if (loadBox) {
        if (vv && n(vv.capacityKg) > 0) {
          const pct = cargo / n(vv.capacityKg) * 100;
          loadBox.textContent = `${num(pct,1)}% · ${kgFmt(cargo)} / ${kgFmt(vv.capacityKg)}`;
        } else loadBox.textContent = '—';
      }
    };

    document.querySelector('#lgStart')?.addEventListener('change', refresh);
    document.querySelector('#lgVehicle')?.addEventListener('change', updateCalculated);
    document.querySelector('#lgEstKm')?.addEventListener('input', updateCalculated);
    document.querySelector('#lgRatePerKm')?.addEventListener('input', updateCalculated);
    refresh();
  }

  function openVehicleForm(v=null) {
    const activeTypes=(L.vehicleTypes||[]).filter(t=>t.status!=='INACTIVE' || t.id===v?.typeId);
    const selectedTypeId=v?.typeId || activeTypes.find(t=>t.name===v?.type)?.id || '';
    const typeOptions=`<option value="">-- Chọn danh mục xe --</option>`+activeTypes.map(t=>`<option value="${e(t.id)}" ${t.id===selectedTypeId?'selected':''}>${e(t.id)} · ${e(t.name)} · ${num(t.defaultCapacityKg)} kg</option>`).join('');
    Modal.open({title:v?'Cập nhật xe':'Thêm xe',size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Biển số *</label><input class="inp" id="lgVPlate" value="${e(v?.plate||'')}"></div><div class="field"><label>Danh mục xe *</label><select class="inp" id="lgVTypeId">${typeOptions}</select><div class="hint">Chọn loại xe để lấy tải trọng và định mức mặc định.</div></div><div class="field"><label>Tải trọng (kg) *</label><input class="inp num" id="lgVCapacity" type="number" min="1" value="${n(v?.capacityKg)||1000}"></div><div class="field"><label>Nhiên liệu</label><select class="inp" id="lgVFuel"><option ${v?.fuelType==='Diesel'?'selected':''}>Diesel</option><option ${v?.fuelType==='Xăng'?'selected':''}>Xăng</option><option ${v?.fuelType==='Điện'?'selected':''}>Điện</option></select></div><div class="field"><label>Định mức (L/100km) *</label><input class="inp num" id="lgVNorm" type="number" step="0.1" min="0" value="${n(v?.fuelNorm)||10}"></div><div class="field"><label>Km hiện tại</label><input class="inp num" id="lgVOdo" type="number" min="0" value="${n(v?.odometer)}"></div><div class="field"><label>Thiết bị GPS</label><input class="inp" id="lgVGps" value="${e(v?.gpsDevice||'')}"></div><div class="field"><label>Hạn đăng kiểm</label><input class="inp" id="lgVReg" type="date" value="${e(v?.registrationExpiry||'')}"></div><div class="field"><label>Bảo trì kế tiếp</label><input class="inp" id="lgVNextDate" type="date" value="${e(v?.nextMaintenanceDate||addDaysLocal(today(),90))}"></div><div class="field"><label>Mốc km bảo trì</label><input class="inp num" id="lgVNextKm" type="number" min="0" value="${n(v?.nextMaintenanceKm)||5000}"></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-vehicle-save" ${v?`data-id="${e(v.id)}"`:''}><i class="fa-solid fa-floppy-disk"></i>Lưu xe</button>`});
    setTimeout(()=>{
      const sel=document.querySelector('#lgVTypeId');
      if(!sel)return;
      sel.addEventListener('change',()=>{
        const t=vehicleType(sel.value); if(!t)return;
        const cap=document.querySelector('#lgVCapacity'), fuel=document.querySelector('#lgVFuel'), norm=document.querySelector('#lgVNorm'), nextKm=document.querySelector('#lgVNextKm'), odo=document.querySelector('#lgVOdo');
        if(cap) cap.value=n(t.defaultCapacityKg);
        if(fuel) fuel.value=t.defaultFuelType||'Diesel';
        if(norm) norm.value=n(t.defaultFuelNorm);
        if(nextKm) nextKm.value=n(odo?.value)+n(t.maintenanceCycleKm||5000);
      });
    },0);
  }
  function openVehicleTypeForm(t=null) {
    Modal.open({title:t?'Cập nhật danh mục xe':'Thêm danh mục xe',size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Tên loại xe *</label><input class="inp" id="lgVTName" value="${e(t?.name||'')}"></div><div class="field"><label>Kiểu thùng</label><input class="inp" id="lgVTBody" value="${e(t?.bodyType||'Thùng lạnh')}"></div><div class="field"><label>Tải trọng mặc định (kg) *</label><input class="inp num" id="lgVTCapacity" type="number" min="1" value="${n(t?.defaultCapacityKg)||500}"></div><div class="field"><label>Nhiên liệu mặc định</label><select class="inp" id="lgVTFuel"><option ${t?.defaultFuelType==='Diesel'?'selected':''}>Diesel</option><option ${t?.defaultFuelType==='Xăng'?'selected':''}>Xăng</option><option ${t?.defaultFuelType==='Điện'?'selected':''}>Điện</option></select></div><div class="field"><label>Định mức mặc định (L/100km)</label><input class="inp num" id="lgVTNorm" type="number" min="0" step="0.1" value="${n(t?.defaultFuelNorm)||8}"></div><div class="field"><label>Chu kỳ bảo trì (km)</label><input class="inp num" id="lgVTCycle" type="number" min="0" value="${n(t?.maintenanceCycleKm)||5000}"></div><div class="field"><label>Giữ lạnh</label><select class="inp" id="lgVTCold"><option value="1" ${t?.refrigerated!==false?'selected':''}>Có</option><option value="0" ${t?.refrigerated===false?'selected':''}>Không</option></select></div><div class="field"><label>Trạng thái</label><select class="inp" id="lgVTStatus"><option value="ACTIVE" ${t?.status!=='INACTIVE'?'selected':''}>Đang sử dụng</option><option value="INACTIVE" ${t?.status==='INACTIVE'?'selected':''}>Ngừng sử dụng</option></select></div><div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea class="inp" id="lgVTNote" rows="2">${e(t?.note||'')}</textarea></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-vehicle-type-save" ${t?`data-id="${e(t.id)}"`:''}><i class="fa-solid fa-floppy-disk"></i>Lưu danh mục</button>`});
  }
  function openDriverForm(d=null) {
    Modal.open({title:d?'Cập nhật tài xế':'Thêm tài xế',size:'md',body:`<div class="form-grid cols-2"><div class="field"><label>Họ tên *</label><input class="inp" id="lgDName" value="${e(d?.name||'')}"></div><div class="field"><label>Số điện thoại</label><input class="inp" id="lgDPhone" value="${e(d?.phone||'')}"></div><div class="field"><label>Số GPLX *</label><input class="inp" id="lgDLicense" value="${e(d?.licenseNo||'')}"></div><div class="field"><label>Hạng bằng</label><input class="inp" id="lgDClass" value="${e(d?.licenseClass||'C')}"></div><div class="field"><label>Ngày hết hạn GPLX</label><input class="inp" id="lgDExpiry" type="date" value="${e(d?.licenseExpiry||addDaysLocal(today(),365))}"></div><div class="field"><label>Trạng thái</label><select class="inp" id="lgDStatus"><option value="AVAILABLE" ${d?.status==='AVAILABLE'?'selected':''}>Sẵn sàng</option><option value="OFF" ${d?.status==='OFF'?'selected':''}>Nghỉ</option><option value="INACTIVE" ${d?.status==='INACTIVE'?'selected':''}>Ngừng hoạt động</option></select></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-driver-save" ${d?`data-id="${e(d.id)}"`:''}><i class="fa-solid fa-floppy-disk"></i>Lưu tài xế</button>`});
  }
  function openMaintenanceForm() {
    const vs=L.vehicles.filter(v=>v.status!=='RETIRED' && v.status!=='BUSY');
    Modal.open({title:'Lập lịch bảo trì xe',size:'md',body:`<div class="form-grid cols-2"><div class="field"><label>Xe *</label><select class="inp" id="lgMVehicle"><option value="">-- Chọn xe --</option>${vs.map(v=>`<option value="${e(v.id)}">${e(v.plate)} · ${num(v.odometer)} km</option>`).join('')}</select></div><div class="field"><label>Loại bảo trì</label><select class="inp" id="lgMType"><option>Định kỳ</option><option>Sửa chữa</option><option>Đăng kiểm</option><option>Lốp / phanh</option></select></div><div class="field"><label>Ngày dự kiến *</label><input class="inp" id="lgMDate" type="date" min="${today()}" value="${addDaysLocal(today(),1)}"></div><div class="field"><label>Km dự kiến</label><input class="inp num" id="lgMKm" type="number" min="0"></div><div class="field" style="grid-column:1/-1"><label>Nội dung</label><textarea class="inp" id="lgMDesc" rows="3"></textarea></div><div class="field"><label>Đơn vị sửa chữa</label><input class="inp" id="lgMVendor"></div><div class="field"><label>Chi phí dự kiến</label><input class="inp num" id="lgMCost" type="number" min="0" value="0"></div></div>`,foot:'<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-maint-save"><i class="fa-solid fa-floppy-disk"></i>Lưu lịch</button>'});
  }

  function mergeReturnedItems(existing, additions) {
    const map = new Map();
    [...(existing||[]), ...(additions||[])].forEach(r => {
      const cur = map.get(r.productId) || { productId:r.productId, name:r.name||r.productId, unit:r.unit||'', qty:0 };
      cur.qty = Math.round((n(cur.qty) + n(r.qty)) * 1000) / 1000;
      map.set(r.productId, cur);
    });
    return [...map.values()];
  }
  function ensureReturnedWarehouse() {
    DB.warehouses = DB.warehouses || []; DB.warehouseLocations = DB.warehouseLocations || [];
    let wh = DB.warehouses.find(w => w.type === 'RETURNED' && w.status !== 'inactive');
    let repaired = false;
    if (!wh) { wh = { id:'WH-007', code:'RETURNED', name:'Kho Hàng trả về', type:'RETURNED', address:'Khu tiếp nhận trả hàng', managerId:'NV-019', status:'active', note:'Tiếp nhận hàng trả từ khách hàng' }; DB.warehouses.push(wh); repaired = true; }
    let loc = DB.warehouseLocations.find(l => l.warehouseId === wh.id && l.status !== 'inactive');
    if (!loc) {
      const used = new Set(DB.warehouseLocations.map(x => String(x?.id||''))); let no=23; while(used.has(`LOC-${String(no).padStart(3,'0')}`)) no++;
      loc = { id:`LOC-${String(no).padStart(3,'0')}`, warehouseId:wh.id, code:'RET-R1', name:'Kệ R1 - Hàng khách trả', parentLocation:'', locationType:'SHELF', capacity:2000, currentUsage:0, status:'active' };
      DB.warehouseLocations.push(loc); repaired = true;
    }
    if (repaired && typeof InventoryAPI !== 'undefined') InventoryAPI.scheduleCollections(['warehouses','warehouseLocations'],30);
    return { wh, loc };
  }
  function postLogisticsReturns(deliveryRow, returns, note='') {
    if (!deliveryRow?.orderId || !(returns||[]).length) return '';
    DB.goodsReceipts = DB.goodsReceipts || []; DB.inventory = DB.inventory || []; DB.inventoryLots = DB.inventoryLots || []; DB.inventoryTransactions = DB.inventoryTransactions || [];
    const existing = DB.goodsReceipts.find(r => r.type === 'SALES_RETURN_RECEIPT' && r.logisticsDeliveryId === deliveryRow.id);
    if (existing) return existing.id;
    const order = ((DB.orders||[]).find(o => o.id === deliveryRow.orderId)); if (!order) return '';
    const {wh,loc} = ensureReturnedWarehouse();
    const receiptId = typeof nextCode === 'function' ? nextCode('PNTR-2026-', DB.goodsReceipts) : `PNTR-${Date.now()}`;
    const receiptItems=[];
    returns.forEach(r => {
      const lotId = typeof nextCode === 'function' ? nextCode('LOT-',DB.inventoryLots) : `LOT-${Date.now()}-${r.productId}`;
      const lot={id:lotId,lotNumber:`RET-${order.id}-${deliveryRow.id}-${r.productId}`,productId:r.productId,salesOrderId:order.id,logisticsDeliveryId:deliveryRow.id,mfgDate:today(),expiryDate:'',qcStatus:'RETURNED',status:'active',createdAt:nowIso()};
      DB.inventoryLots.unshift(lot);
      DB.inventory.unshift({productId:r.productId,warehouseId:wh.id,locationId:loc.id,lotId:lot.id,qtyOnHand:r.qty,qtyPending:0,qtyRejected:0,qtyReserved:0,qtyAvailable:0,unit:r.unit,sourceType:'SALES_RETURN',sourceId:order.id,logisticsDeliveryId:deliveryRow.id,lastUpdated:nowIso()});
      DB.inventoryTransactions.unshift({id:typeof nextCode==='function'?nextCode('TX-',DB.inventoryTransactions):`TX-${Date.now()}`,transactionNumber:receiptId,type:'SALES_RETURN_RECEIPT',productId:r.productId,warehouseId:wh.id,locationId:loc.id,lotId:lot.id,qty:r.qty,qtyBefore:0,qtyAfter:r.qty,refType:'SALES_ORDER',refId:order.id,userId:DB.currentUser?.id||'',date:today(),note:`Hàng trả từ chuyến ${deliveryRow.id} · đơn ${order.id}`});
      receiptItems.push({materialId:r.productId,productId:r.productId,name:r.name,unit:r.unit,qty:r.qty,lotId:lot.id,lotNumber:lot.lotNumber,locationId:loc.id});
    });
    DB.goodsReceipts.unshift({id:receiptId,type:'SALES_RETURN_RECEIPT',salesOrderId:order.id,refDoc:order.id,logisticsDeliveryId:deliveryRow.id,date:today(),receivedBy:DB.currentUser?.id||'',warehouse:wh.name,warehouseId:wh.id,locationId:loc.id,location:loc.name,status:'RECEIVED',note:note||`Hàng trả từ chuyến ${deliveryRow.id}`,items:receiptItems});
    order.returnedItems = mergeReturnedItems(order.returnedItems, returns);
    order.returnReceiptIds = [...new Set([...(order.returnReceiptIds||[]), receiptId])]; order.returnReceiptId = receiptId; order.logisticsDeliveryId = deliveryRow.id; order.logisticsReturnProcessedAt = nowIso();
    if (typeof SalesCRM !== 'undefined') SalesCRM.saveLocal(['orders']);
    if (typeof InventoryAPI !== 'undefined') InventoryAPI.scheduleCollections(['goodsReceipts','inventoryLots','inventory','inventoryTransactions'],60);
    return receiptId;
  }

  // ---- Register view -------------------------------------------------------
  // [PERFORMANCE] Không gọi load() khi file module vừa được nạp. Trước đây dòng này
  // làm màn đăng nhập cũng tự refresh 5 bảng Logistics từ KIO. Mỗi view Logistics
  // tự gọi load() khi thực sự được mở, nên bỏ eager-load này không đổi nghiệp vụ.
  Views.logistics = function(params={}) {
    const tab=State.tab || params.tab || 'dashboard';
    if (tab==='deliveries') return deliveriesView(false);
    if (tab==='dispatch') { State.tab='deliveries'; return deliveriesView(false); }
    if (tab==='fleet') return fleetView();
    if (tab==='vehicle-types') return vehicleTypesView();
    if (tab==='drivers') return driversView();
    if (tab==='maintenance') return maintenanceView();
    if (tab==='gps') return gpsView();
    if (tab==='schedule') return scheduleView();
    return dashboardView();
  };

  // ---- Actions -------------------------------------------------------------
  Actions['lg-delivery-new']=()=>openDeliveryForm();
  Actions['lg-delivery-save']=()=>{
    const orderId=document.querySelector('#lgOrderId')?.value||'', pd=document.querySelector('#lgPromiseDate')?.value, pt=document.querySelector('#lgPromiseTime')?.value;
    const order=((typeof DB!=='undefined'&&DB.orders)||[]).find(o=>o.id===orderId);
    if(!order){Toast.err('Chưa chọn đơn hàng','Chỉ tạo đơn giao từ Đơn hàng bán đã được Kho xuất thành phẩm.');return;}
    if(!salesIssueCompleted(order.id)){Toast.err('Đơn chưa xuất kho','Kho phải xác nhận xuất thành phẩm trước khi Logistics tạo chuyến giao.');return;}
    if(L.deliveries.some(x=>x.orderId===order.id&&!['FAILED','CANCELLED'].includes(x.status))){Toast.warn('Đơn đã có chuyến giao',`Đơn ${order.id} đã được đưa vào Logistics.`);return;}
    const snap=orderSnapshot(order);
    const cargo=snap.shippingWeightKg;
    if(cargo<=0||!pd||!pt){Toast.err('Thiếu khối lượng đóng gói','Vui lòng khai báo Khối lượng đóng gói/ĐVT trong master Thành phẩm trước khi tạo đơn giao.');return;}
    L.deliveries.unshift({id:uid('GH',L.deliveries),orderId:order.id,customer:snap.customer,address:snap.address,recipient:snap.recipient,phone:snap.phone,deliveryNote:snap.deliveryNote,shippingFee:snap.shippingFee,deliveryLat:snap.lat,deliveryLng:snap.lng,salesIssueId:order.salesIssueId||'',promisedDate:pd,promisedTime:pt,items:snap.items,plannedStart:'',actualStart:'',actualDelivered:'',vehicleId:'',driverId:'',route:'',estimatedKm:n(document.querySelector('#lgEstKm')?.value),actualKm:0,cargoKg:cargo,deliveredQty:0,returnedQty:0,fuelLiters:0,fuelCost:0,tollCost:0,parkingCost:0,otherCost:0,status:'WAIT_DISPATCH',gpsLat:null,gpsLng:null,gpsUpdatedAt:'',note:document.querySelector('#lgNote')?.value.trim()||snap.deliveryNote||'',createdAt:nowIso()});
    order.logisticsDeliveryId=L.deliveries[0].id; order.logisticsStatus='WAIT_DISPATCH'; if(typeof SalesCRM!=='undefined') SalesCRM.saveLocal(['orders']);
    rerender('Đã tạo đơn giao',`${order.id} · đã đồng bộ sản phẩm và số lượng từ Đơn hàng bán.`);
  };
  Actions['lg-delivery-view']=(d)=>{const x=delivery(d.id);if(!x)return;let buttons='';const members=tripMembers(x),tripReadyToClose=members.length>0&&members.every(r=>['DELIVERED','PARTIAL','CLOSED'].includes(r.status));if(x.status==='WAIT_DISPATCH')buttons+=`<button class="btn btn-primary" data-act="lg-dispatch" data-id="${e(x.id)}"><i class="fa-solid fa-route"></i>Điều phối</button>`;if(x.status==='DISPATCHED'||x.status==='READY')buttons+=`<button class="btn btn-primary" data-act="lg-trip-start" data-id="${e(x.id)}"><i class="fa-solid fa-play"></i>Bắt đầu chuyến</button>`;if(x.status==='IN_TRANSIT')buttons+=`<button class="btn btn-primary" data-act="lg-trip-complete" data-id="${e(x.id)}"><i class="fa-solid fa-flag-checkered"></i>Xác nhận giao</button>`;if(DONE_ST.includes(x.status)){buttons+=x.tripId?`<button class="btn" data-act="lg-trip-leave" data-id="${e(x.id)}"><i class="fa-solid fa-link-slash"></i>Tách khỏi chuyến</button>`:`<button class="btn" data-act="lg-trip-join" data-id="${e(x.id)}"><i class="fa-solid fa-link"></i>Chuyển sang đơn theo chuyến</button>`;}Modal.open({title:`Chi tiết đơn giao · ${x.id}`,size:'xl',body:deliveryDetail(x),foot:`<button class="btn" data-act="modal-close">Đóng</button>${buttons}`});};
  Actions['lg-dispatch']=(d)=>{const x=delivery(d.id);if(x)openDispatch(x);};
  Actions['lg-dispatch-save']=(d)=>{
    const x=delivery(d.id), vid=document.querySelector('#lgVehicle')?.value, did=document.querySelector('#lgDriver')?.value, start=document.querySelector('#lgStart')?.value;
    const estimatedKm=Math.max(0,n(document.querySelector('#lgEstKm')?.value));
    const ratePerKm=Math.max(0,parseMoney(document.querySelector('#lgRatePerKm')?.value)||10000);
    if(!x||!vid||!did||!start){Toast.err('Chưa đủ điều phối','Vui lòng chọn xe, tài xế và thời gian xuất phát.');return;}
    if(estimatedKm<=0){Toast.err('Chưa có quãng đường','Vui lòng nhập Km dự kiến lớn hơn 0.');return;}
    const totalCargo=deliveryCargoKg(x);
    if(totalCargo<=0){Toast.err('Thiếu khối lượng','Đơn giao chưa có khối lượng đóng gói hợp lệ.');return;}
    const selectedIds=new Set([x.id]);
    const v=vehicle(vid), dr=driver(did);
    if(!v || n(v.capacityKg)<totalCargo || !vehicleAvailableAt(v,start,selectedIds)){Toast.err('Xe không khả dụng','Xe không đủ tải hoặc đang bận tại thời điểm đã chọn.');return;}
    if(!dr || !driverAvailableAt(dr,start,selectedIds)){Toast.err('Tài xế không khả dụng','Tài xế đang bận, nghỉ hoặc GPLX không còn hiệu lực.');return;}
    const tripId=tripIdNew();
    const route=document.querySelector('#lgRoute')?.value.trim() || `Kho xuất hàng → ${x.address||''}`;
    const estimatedFee=Math.round(estimatedKm*ratePerKm);
    const plannedFuelLiters=Math.round((estimatedKm*n(v.fuelNorm||0)/100)*1000)/1000;
    x.cargoKg=totalCargo;
    x.tripId=tripId;
    x.vehicleId=vid;
    x.driverId=did;
    x.plannedStart=start;
    x.route=route;
    x.status='DISPATCHED';
    x.estimatedKm=estimatedKm;
    x.routeRatePerKm=ratePerKm;
    x.estimatedTransportFee=estimatedFee;
    x.plannedFuelLiters=plannedFuelLiters;
    const order=(DB.orders||[]).find(o=>o.id===x.orderId);
    if(order){order.logisticsStatus='DISPATCHED';order.logisticsDeliveryId=x.id;}
    if(typeof SalesCRM!=='undefined') SalesCRM.saveLocal(['orders']);
    rerender('Đã điều phối',`${x.id} · ${num(estimatedKm,1)} km · ${kgFmt(totalCargo)} · ${e(v.plate)}`);
  };
  Actions['lg-trip-start']=(d)=>{
    const x=delivery(d.id);if(!x)return;
    const members=tripMembers(x); const startedAt=nowIso();
    members.forEach(row=>{ if(['DISPATCHED','READY'].includes(row.status)){row.status='IN_TRANSIT';row.actualStart=startedAt;row.gpsUpdatedAt=startedAt;} const order=(DB.orders||[]).find(o=>o.id===row.orderId);if(order){order.status='dh_dang_giao';order.logisticsStatus='IN_TRANSIT';order.logisticsDeliveryId=row.id;} });
    if(typeof SalesCRM!=='undefined') SalesCRM.saveLocal(['orders']);
    rerender('Đã bắt đầu chuyến',`${x.tripId||x.id} · ${members.length} điểm giao.`);
  };
  Actions['lg-trip-complete']=(d)=>{
    const x=delivery(d.id);if(!x)return;
    const itemLines=(x.items||[]).map((it,idx)=>`
      <div class="lg-delivery-item lg-complete-row" data-index="${idx}">
        <div class="lg-complete-product">
          <div class="lg-complete-product-icon"><i class="fa-solid fa-box-open"></i></div>
          <div><b>${e(it.name||it.productId)}</b><div class="cell-sub">${e(it.productId)} · Theo đơn ${num(it.orderedQty,2)} ${e(it.unit||'')}</div></div>
        </div>
        <div class="lg-complete-qty"><input class="inp num" name="deliveredQty" type="number" min="0" max="${n(it.orderedQty)}" step="0.01" value="${n(it.orderedQty)}" aria-label="Số lượng khách nhận"></div>
        <div class="lg-complete-qty"><input class="inp num" name="returnedQty" type="number" min="0" max="${n(it.orderedQty)}" step="0.01" value="0" aria-label="Số lượng trả về"></div>
        <div class="lg-complete-unit">${e(it.unit||'')}</div>
      </div>`).join('');
    const body=(x.items||[]).length?`
      <div class="lg-complete-wrap">
        <div class="lg-complete-table">
          <div class="lg-complete-table-head"><span>Thành phẩm</span><span>Khách nhận</span><span>Trả về</span><span>ĐVT</span></div>
          ${itemLines}
        </div>
        <div class="lg-complete-meta">
          <div class="field lg-complete-field"><label><i class="fa-solid fa-road"></i>Km thực tế</label><input class="inp num" id="lgActualKm" type="number" min="0" step="0.1" value="${n(x.estimatedKm)}"></div>
          <div class="field lg-complete-field"><label><i class="fa-regular fa-note-sticky"></i>Ghi chú giao hàng <span class="muted">(không bắt buộc)</span></label><textarea class="inp" id="lgCompleteNote" rows="2" placeholder="Ví dụ: Khách nhận đủ hàng, không phát sinh trả về…"></textarea></div>
        </div>
      </div>`:`
      <div class="lg-complete-wrap">
        <div class="lg-complete-meta">
          <div class="field lg-complete-field"><label><i class="fa-solid fa-weight-hanging"></i>Khối lượng đã giao (kg)</label><input class="inp num" id="lgDelivered" type="number" min="0" max="${n(x.cargoKg)}" value="${n(x.cargoKg)}"></div>
          <div class="field lg-complete-field"><label><i class="fa-solid fa-rotate-left"></i>Hàng trả về (kg)</label><input class="inp num" id="lgReturned" type="number" min="0" value="0"></div>
          <div class="field lg-complete-field"><label><i class="fa-solid fa-road"></i>Km thực tế</label><input class="inp num" id="lgActualKm" type="number" min="0" step="0.1" value="${n(x.estimatedKm)}"></div>
          <div class="field lg-complete-field"><label><i class="fa-regular fa-note-sticky"></i>Ghi chú giao hàng <span class="muted">(không bắt buộc)</span></label><textarea class="inp" id="lgCompleteNote" rows="2" placeholder="Ghi chú giao hàng…"></textarea></div>
        </div>
      </div>`;
    const tripRows=tripMembers(x);
    const isPotentialFinalPoint=tripRows.filter(r=>!['DELIVERED','PARTIAL','CLOSED'].includes(r.status)).length<=1;
    const tripKm=Math.max(n(x.estimatedKm), ...tripRows.map(r=>n(r.actualKm)), 0);
    const tripVehicle=vehicle(x.vehicleId);
    const tripFuelNorm=tripVehicle&&tripKm>0?tripKm*n(tripVehicle.fuelNorm)/100:0;
    const recvFields=`<div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-handshake"></i>Khách hàng nhận hàng</div>
      <div class="form-grid cols-2"><div class="field"><label>Người nhận hàng</label><input class="inp" id="lgReceiver" value="${e(x.recipient||'')}" placeholder="Họ tên người nhận"></div>
      <div class="field"><label>Thời điểm khách nhận</label><input class="inp" id="lgReceivedAt" type="datetime-local" value="${nowLocalInput()}"></div></div>`;
    const propNow=fuelProposal(tripKm,x.vehicleId,getFuelPrice());
    const closeFields=`<div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-receipt"></i>Chi phí chuyến</div>
      <div class="form-grid cols-2">
        <div class="field"><label>Nhiên liệu thực tế (L)</label><input class="inp num" id="lgFuel" type="number" min="0" step="0.1" value="${propNow.liters>0?propNow.liters:''}"></div>
        <div class="field"><label>Chi phí nhiên liệu thực tế</label><input class="inp num" id="lgFuelCost" data-money="1" type="text" inputmode="numeric" value="${propNow.cost>0?propNow.cost:0}"></div>
        <div class="field"><label>Phí cầu đường</label><input class="inp num" id="lgToll" data-money="1" type="text" inputmode="numeric" value="0"></div>
        <div class="field"><label>Phí bãi xe</label><input class="inp num" id="lgParking" data-money="1" type="text" inputmode="numeric" value="0"></div>
        <div class="field"><label>Chi phí khác</label><input class="inp num" id="lgOther" data-money="1" type="text" inputmode="numeric" value="0"></div>
      </div>
      <div class="form-sec-title" style="margin-top:14px"><i class="fa-solid fa-gas-pump"></i>Đề xuất so với thực tế</div>${fuelCompareBlock()}`;
    const bodyWithClose=body + recvFields + (isPotentialFinalPoint?closeFields:'');
    Modal.open({
      title:`Xác nhận giao hàng · ${x.id}`,
      sub:x.orderId?`Theo đơn bán ${x.orderId}`:'Chuyến giao trực tiếp',
      size:'lg',
      body:bodyWithClose,
      foot:`<button class="btn lg-complete-cancel" data-act="modal-close">Hủy</button><button class="btn btn-primary lg-complete-confirm" data-act="lg-trip-complete-save" data-id="${e(x.id)}"><i class="fa-solid fa-check"></i>Xác nhận</button>`,
      onMount:(m)=>{
        m.classList.add('lg-complete-modal');
        if(isPotentialFinalPoint) fuelCompareBind(x.vehicleId,'#lgActualKm');
        const head=m.querySelector('.modal-head');
        if(head&&!head.querySelector('.lg-complete-head-icon')) head.insertAdjacentHTML('afterbegin','<div class="lg-complete-head-icon"><i class="fa-solid fa-truck-fast"></i></div>');
      }
    });
  };
  Actions['lg-trip-complete-save']=(d)=>{
    const x=delivery(d.id);if(!x)return;const km=n(document.querySelector('#lgActualKm')?.value);if(km<=0){Toast.err('Dữ liệu chưa hợp lệ','Km thực tế phải lớn hơn 0.');return;}
    let returnedItems=[];
    if((x.items||[]).length){
      let invalid=''; let deliveredTotal=0, returnedTotal=0;
      document.querySelectorAll('.lg-delivery-item').forEach(row=>{const idx=Number(row.dataset.index),it=x.items[idx];const delivered=Math.max(0,n(row.querySelector('[name="deliveredQty"]')?.value)),returned=Math.max(0,n(row.querySelector('[name="returnedQty"]')?.value));if(delivered+returned>n(it?.orderedQty)+0.0001)invalid=`${it?.name||it?.productId}: số khách nhận + số trả vượt số lượng theo đơn.`;if(it){it.deliveredQty=delivered;it.returnedQty=returned;deliveredTotal+=delivered;returnedTotal+=returned;if(returned>0)returnedItems.push({productId:it.productId,name:it.name,unit:it.unit,qty:returned});}});
      if(invalid){Toast.err('Số lượng giao chưa hợp lệ',invalid);return;} x.deliveredQty=deliveredTotal;x.returnedQty=returnedTotal;
    } else {
      const delivered=n(document.querySelector('#lgDelivered')?.value),returned=n(document.querySelector('#lgReturned')?.value);if(delivered<0||returned<0){Toast.err('Dữ liệu chưa hợp lệ','Số lượng không được âm.');return;}x.deliveredQty=delivered;x.returnedQty=returned;
    }
    // Điểm giao cuối: nếu nhiên liệu/chi phí lệch quá ngưỡng so với đề xuất thì bắt buộc ghi chú.
    {
      const mem=tripMembers(x), isFinalPoint=mem.filter(r=>r.id!==x.id && !DONE_ST.includes(r.status)).length===0;
      if(isFinalPoint && document.querySelector('#lgFuel')){
        const tk=Math.max(km,...mem.filter(r=>r.id!==x.id).map(r=>n(r.actualKm)),0);
        const fi=fuelCompareRead(x.vehicleId,'#lgActualKm',false); const prop=fuelProposal(tk,x.vehicleId,fi.price); const vr=fuelVariance(prop,fi.aL,fi.aC);
        if(vr.needNote && !fi.note){Toast.err('Cần ghi chú chênh lệch nhiên liệu',`Nhiên liệu/chi phí lệch quá ${FUEL_VAR_LIMIT}% so với đề xuất (${num(prop.liters,1)} L). Hãy ghi lý do.`);return;}
      }
    }
    x.actualKm=km;x.actualDelivered=nowIso();x.note=[x.note,document.querySelector('#lgCompleteNote')?.value.trim()].filter(Boolean).join(' · ');recordCustomerReceipt(x);
    const hasPartial=(x.items||[]).some(it=>n(it.deliveredQty)+n(it.returnedQty)<n(it.orderedQty));x.status=n(x.returnedQty)>0||hasPartial?'PARTIAL':'DELIVERED';
    const v=vehicle(x.vehicleId);if(v)v.odometer=n(v.odometer)+km;
    const order=((DB.orders||[]).find(o=>o.id===x.orderId)); if(order){order.status='dh_da_giao';order.logisticsStatus=x.status;order.logisticsDeliveredAt=x.actualDelivered;order.deliveredDate=String(x.actualDelivered||'').slice(0,10)||today();order.logisticsDeliveryId=x.id;}
    const receiptId=returnedItems.length?postLogisticsReturns(x,returnedItems,document.querySelector('#lgCompleteNote')?.value.trim()||''):'';

    // Xác nhận điểm giao cuối = chốt chuyến luôn. Không còn bước "Chốt chuyến" riêng.
    const members=tripMembers(x);
    const allDelivered=members.every(r=>['DELIVERED','PARTIAL','CLOSED'].includes(r.status));
    if(allDelivered){
      const fuel=Math.max(0,n(document.querySelector('#lgFuel')?.value));
      const fuelCost=Math.max(0,parseMoney(document.querySelector('#lgFuelCost')?.value));
      const toll=Math.max(0,parseMoney(document.querySelector('#lgToll')?.value));
      const parking=Math.max(0,parseMoney(document.querySelector('#lgParking')?.value));
      const other=Math.max(0,parseMoney(document.querySelector('#lgOther')?.value));
      setFuelPrice(pmoney(document.querySelector('#lgFuelPrice')?.value));
      const totalCost=fuelCost+toll+parking+other;
      const totalCargo=members.reduce((sum,row)=>sum+deliveryCargoKg(row),0)||members.length;
      const tripKm=Math.max(...members.map(row=>n(row.actualKm)),0);
      members.forEach(row=>{
        const share=totalCargo>0?deliveryCargoKg(row)/totalCargo:1/members.length;
        row.fuelLiters=fuel*share; row.fuelCost=fuelCost*share; row.tollCost=toll*share; row.parkingCost=parking*share; row.otherCost=other*share; row.tripActualKm=tripKm; applyFuelProposal(row,share,tripKm,fuelCompareRead(row.vehicleId,'#lgActualKm',false)); row.status='CLOSED';
        const linkedOrder=(DB.orders||[]).find(o=>o.id===row.orderId);
        if(linkedOrder){linkedOrder.actualTransportCost=totalCost*share;linkedOrder.transportCostPerKm=tripKm>0?(totalCost*share)/tripKm:0;linkedOrder.logisticsStatus='CLOSED';linkedOrder.logisticsClosedAt=nowIso();}
      });
    }
    if(typeof SalesCRM!=='undefined')SalesCRM.saveLocal(['orders']);
    const msg=allDelivered
      ? `Giao hàng đã xác nhận và chuyến đã tự động chốt.${returnedItems.length?` Hàng trả đã vào Kho Hàng trả về${receiptId?` · ${receiptId}`:''}.`:''}`
      : (returnedItems.length?`Hàng trả đã vào Kho Hàng trả về${receiptId?` · ${receiptId}`:''}.`:'Điểm giao đã hoàn tất; chuyến còn điểm giao khác.');
    rerender(allDelivered?'Đã xác nhận & chốt chuyến':'Đã xác nhận giao hàng',msg);
  };
  /* ===== Chuyến tổng hợp: tạo chuyến từ nhiều đơn đã hoàn thành, tách/chuyển đơn lẻ ↔ đơn theo chuyến ===== */
  let tripMakeDate = '';
  function tripTotalsFields(v = {}) {
    return `<div class="form-grid cols-2">
      <div class="field"><label>Công-tơ-mét đầu ngày (km)</label><input class="inp num" id="lgTmKmStart" type="number" min="0" step="0.1" value="${n(v.kmStart) || ''}"></div>
      <div class="field"><label>Công-tơ-mét cuối ngày (km)</label><input class="inp num" id="lgTmKmEnd" type="number" min="0" step="0.1" value="${n(v.kmEnd) || ''}"></div>
      <div class="field"><label>Tổng km cả chuyến <span class="req">*</span></label><input class="inp num" id="lgTmKm" type="number" min="0" step="0.1" value="${n(v.km) || ''}"><div class="cell-sub">Tự tính = cuối ngày − đầu ngày, có thể nhập trực tiếp.</div></div>
      <div class="field"><label>Nhiên liệu thực tế (L)</label><input class="inp num" id="lgFuel" type="number" min="0" step="0.1" value="${n(v.fuelL) || ''}"></div>
      <div class="field"><label>Chi phí nhiên liệu thực tế</label><input class="inp num" id="lgFuelCost" data-money="1" type="text" inputmode="numeric" value="${n(v.fuelCost) || 0}"></div>
      <div class="field"><label>Phí cầu đường</label><input class="inp num" id="lgToll" data-money="1" type="text" inputmode="numeric" value="${n(v.toll) || 0}"></div>
      <div class="field"><label>Phí bãi xe</label><input class="inp num" id="lgParking" data-money="1" type="text" inputmode="numeric" value="${n(v.parking) || 0}"></div>
      <div class="field"><label>Chi phí khác</label><input class="inp num" id="lgOther" data-money="1" type="text" inputmode="numeric" value="${n(v.other) || 0}"></div></div>
      <div class="form-sec-title" style="margin-top:12px"><i class="fa-solid fa-gas-pump"></i>Đề xuất so với thực tế</div>${fuelCompareBlock(v.note || '')}`;
  }
  function tripTotalsBind(vehicleId) {
    const q = (s) => document.querySelector(s), s1 = q('#lgTmKmStart'), s2 = q('#lgTmKmEnd'), km = q('#lgTmKm');
    const calc = () => { const a = n(s1?.value), b = n(s2?.value); if (a > 0 && b > a && km) { km.value = r2(b - a); km.dispatchEvent(new Event('input')); } };
    s1?.addEventListener('input', calc); s2?.addEventListener('input', calc);
    fuelCompareBind(vehicleId, '#lgTmKm');
  }
  function tripTotalsRead(vehicleId) {
    const q = (s) => document.querySelector(s);
    const t = { km: n(q('#lgTmKm')?.value), kmStart: n(q('#lgTmKmStart')?.value), kmEnd: n(q('#lgTmKmEnd')?.value), fuelL: Math.max(0, n(q('#lgFuel')?.value)), fuelCost: Math.max(0, pmoney(q('#lgFuelCost')?.value)), toll: Math.max(0, pmoney(q('#lgToll')?.value)), parking: Math.max(0, pmoney(q('#lgParking')?.value)), other: Math.max(0, pmoney(q('#lgOther')?.value)) };
    if (!(t.km > 0)) { Toast.err('Thiếu tổng km', 'Nhập tổng km cả chuyến (hoặc công-tơ-mét đầu/cuối ngày).'); return null; }
    const fi = fuelCompareRead(vehicleId, '#lgTmKm', false);
    if (fi.vr.needNote && !fi.note) { Toast.err('Cần ghi chú chênh lệch nhiên liệu', `Nhiên liệu/chi phí lệch quá ${FUEL_VAR_LIMIT}% so với đề xuất (${num(fi.prop.liters, 1)} L). Hãy ghi lý do.`); return null; }
    t.price = fi.price; t.note = fi.note; t.at = nowIso(); setFuelPrice(fi.price);
    return t;
  }
  Actions['lg-trip-make-filter'] = () => { tripMakeDate = document.querySelector('#lgTmDate')?.value || ''; Actions['lg-trip-make'](); };
  Actions['lg-trip-make'] = () => {
    load();
    const eligible = (L.deliveries || []).filter(d => DONE_ST.includes(d.status) && !d.tripId && d.vehicleId)
      .filter(d => !tripMakeDate || String(d.actualDelivered || d.promisedDate || '').slice(0, 10) === tripMakeDate)
      .sort((a, b) => String(b.actualDelivered || '').localeCompare(String(a.actualDelivered || '')));
    const rows = eligible.map(d => `<tr><td><input type="checkbox" class="lg-tm-pick" value="${e(d.id)}" data-vehicle="${e(d.vehicleId)}"></td><td><span class="code">${e(d.id)}</span><div class="cell-sub">${e(d.orderId || '')}</div></td><td>${e(d.customer)}</td><td>${e(vehicle(d.vehicleId)?.plate || '—')}</td><td>${dateFmt(String(d.actualDelivered || d.promisedDate || '').slice(0, 10))}</td><td class="right num">${num(deliveryCargoKg(d), 1)} kg</td><td class="right num">${num(d.actualKm, 1)} km</td><td>${statusBadge(d.status)}</td></tr>`).join('');
    Modal.open({
      title: 'Tạo chuyến từ các đơn đã hoàn thành', sub: 'Tích chọn các đơn lẻ đã giao cùng một xe trong ngày, nhập chung tổng km từ đầu ngày đến cuối ngày', size: 'xl',
      body: `<div class="toolbar" style="margin-bottom:10px"><label class="cell-sub">Ngày giao</label><input class="inp" id="lgTmDate" type="date" value="${e(tripMakeDate)}"><button class="btn btn-sm" data-act="lg-trip-make-filter"><i class="fa-solid fa-filter"></i>Lọc</button><span class="cell-sub">Bỏ trống để xem tất cả đơn lẻ đã hoàn thành</span></div>
        <div class="tbl-wrap" style="max-height:260px;overflow:auto"><table class="line-tbl"><thead><tr><th></th><th>Đơn giao</th><th>Khách hàng</th><th>Xe</th><th>Ngày giao</th><th class="right">Khối lượng</th><th class="right">Km hiện tại</th><th>Trạng thái</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="cell-sub">Không có đơn lẻ đã hoàn thành phù hợp.</td></tr>'}</tbody></table></div>
        <div class="cell-sub" style="margin:6px 0 12px">Các đơn phải cùng một xe. Tổng km và chi phí được phân bổ cho từng đơn theo khối lượng hàng; đơn chuyển thành "Đơn theo chuyến" và vẫn tách ra được sau này.</div>
        <div class="form-sec-title"><i class="fa-solid fa-road"></i>Tổng km và chi phí cả chuyến</div>${tripTotalsFields()}`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-trip-make-save"><i class="fa-solid fa-route"></i>Tạo chuyến</button>`,
      onMount: () => {
        const vid = () => document.querySelector('.lg-tm-pick:checked')?.dataset.vehicle || '';
        tripTotalsBind(vid);
        document.querySelectorAll('.lg-tm-pick').forEach(c => c.addEventListener('change', () => fuelCompareRead(vid, '#lgTmKm', true)));
      }
    });
  };
  Actions['lg-trip-make-save'] = () => {
    const ids = [...document.querySelectorAll('.lg-tm-pick:checked')].map(c => c.value);
    const rowsSel = ids.map(delivery).filter(Boolean);
    if (rowsSel.length < 2) { Toast.err('Chọn ít nhất 2 đơn', 'Một chuyến tổng hợp cần từ 2 đơn đã hoàn thành trở lên.'); return; }
    const vids = new Set(rowsSel.map(r => r.vehicleId)); if (vids.size !== 1) { Toast.err('Khác xe', 'Các đơn trong cùng chuyến phải do cùng một xe giao.'); return; }
    if (rowsSel.some(r => r.tripId || !DONE_ST.includes(r.status))) { Toast.err('Đơn không hợp lệ', 'Chỉ chọn đơn lẻ đã hoàn thành.'); return; }
    const vehicleId = rowsSel[0].vehicleId, t = tripTotalsRead(vehicleId); if (!t) return;
    const tripId = tripIdNew(), v = vehicle(vehicleId);
    const oldKm = rowsSel.reduce((s, r) => s + n(r.actualKm), 0);
    const snaps = new Map(rowsSel.map(r => [r.id, tripSnapshot(r)]));
    rowsSel.forEach(r => { r.tripId = tripId; r.tripMode = 'MANUAL'; });
    allocateTrip(rowsSel, t);
    rowsSel.forEach(r => {
      applyFuelProposal(r, n(r.tripShare), t.km, { price: t.price, note: t.note });
      r.status = 'CLOSED';
      pushTripHistory(r, 'JOINED', `Tạo chuyến ${tripId} (${rowsSel.length} đơn, tổng ${num(t.km, 1)} km)`, snaps.get(r.id));
      syncOrderCost(r);
    });
    if (v) v.odometer = Math.max(0, n(v.odometer) + t.km - oldKm);
    if (typeof SalesCRM !== 'undefined') SalesCRM.saveLocal(['orders']);
    rerender('Đã tạo chuyến', `${tripId} · ${rowsSel.length} đơn · ${num(t.km, 1)} km, chi phí phân bổ theo khối lượng.`);
  };
  Actions['lg-trip-leave'] = (d) => {
    const x = delivery(d.id); if (!x || !x.tripId) return;
    const mem = tripMembers(x);
    Modal.open({ title: `Tách khỏi chuyến · ${x.id}`, sub: `Đơn đang thuộc chuyến ${e(x.tripId)} (${mem.length} đơn) · sẽ chuyển thành Đơn lẻ`, size: 'md',
      body: `<div class="cell-sub" style="margin-bottom:10px">Km và chi phí đã phân bổ cho đơn này được giữ lại khi tách. Nhật ký trạng thái chuyến cũ (mã chuyến, các đơn cùng chuyến, km, chi phí) được lưu vào đơn.${x.tripKmMode === 'ALLOCATED' && mem.length > 1 ? ' Các đơn còn lại được phân bổ lại theo khối lượng.' : ''}</div>
        <div class="field"><label>Lý do tách <span class="req">*</span></label><textarea class="inp" id="lgLeaveReason" rows="3"></textarea></div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-trip-leave-save" data-id="${e(x.id)}"><i class="fa-solid fa-link-slash"></i>Tách khỏi chuyến</button>` });
  };
  Actions['lg-trip-leave-save'] = (d) => {
    const x = delivery(d.id); if (!x || !x.tripId) return; const reason = (document.querySelector('#lgLeaveReason')?.value || '').trim();
    if (!reason) { Toast.err('Thiếu lý do', 'Nhập lý do tách đơn khỏi chuyến.'); return; }
    const old = tripSnapshot(x), oldTrip = x.tripId, others = tripMembers(x).filter(r => r.id !== x.id), allocated = x.tripKmMode === 'ALLOCATED';
    const keep = { km: n(x.actualKm), fuelL: n(x.fuelLiters), fuelCost: n(x.fuelCost), toll: n(x.tollCost), parking: n(x.parkingCost), other: n(x.otherCost) };
    const t0 = others[0]?.tripTotals || {};
    pushTripHistory(x, 'LEFT', reason, old);
    x.tripId = ''; x.tripMode = 'SINGLE'; x.tripKmMode = ''; x.tripShare = 0; x.tripActualKm = n(x.actualKm); x.tripTotals = null;
    if (allocated && others.length) {
      const t = { ...t0, km: Math.max(0, n(t0.km) - keep.km), fuelL: Math.max(0, n(t0.fuelL) - keep.fuelL), fuelCost: Math.max(0, n(t0.fuelCost) - keep.fuelCost), toll: Math.max(0, n(t0.toll) - keep.toll), parking: Math.max(0, n(t0.parking) - keep.parking), other: Math.max(0, n(t0.other) - keep.other) };
      others.forEach(r => pushTripHistory(r, 'MEMBER_LEFT', `Đơn ${x.id} rời chuyến: ${reason}`, tripSnapshot(r)));
      allocateTrip(others, t); others.forEach(r => syncOrderCost(r));
    } else others.forEach(r => pushTripHistory(r, 'MEMBER_LEFT', `Đơn ${x.id} rời chuyến: ${reason}`, tripSnapshot(r)));
    syncOrderCost(x); if (typeof SalesCRM !== 'undefined') SalesCRM.saveLocal(['orders']);
    rerender('Đã tách khỏi chuyến', `${x.id} thành Đơn lẻ · lưu nhật ký chuyến ${oldTrip}.`);
  };
  Actions['lg-trip-join'] = (d) => {
    const x = delivery(d.id); if (!x || x.tripId || !DONE_ST.includes(x.status)) return;
    const trips = new Map(); (L.deliveries || []).filter(r => r.tripId && r.vehicleId === x.vehicleId && r.tripKmMode === 'ALLOCATED').forEach(r => { if (!trips.has(r.tripId)) trips.set(r.tripId, r); });
    if (!trips.size) { Toast.info('Chưa có chuyến phù hợp', 'Dùng "Tạo chuyến" để gộp từ 2 đơn cùng xe trở lên.'); return; }
    const opts = [...trips.entries()].map(([id, r]) => `<option value="${e(id)}">${e(id)} · ${tripMembers(r).length} đơn · ${num(r.tripTotals?.km, 1)} km</option>`).join('');
    Modal.open({ title: `Chuyển sang đơn theo chuyến · ${x.id}`, sub: `${e(x.customer)} · xe ${e(vehicle(x.vehicleId)?.plate || '')}`, size: 'lg',
      body: `<div class="field"><label>Chuyến</label><select class="inp" id="lgJoinTrip">${opts}</select></div><div class="cell-sub" style="margin:6px 0 10px">Nhập lại tổng km và chi phí cả chuyến sau khi thêm đơn này; các đơn được phân bổ lại theo khối lượng.</div><div id="lgJoinFields"></div>`,
      foot: `<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-trip-join-save" data-id="${e(x.id)}"><i class="fa-solid fa-link"></i>Thêm vào chuyến</button>`,
      onMount: () => {
        const sel = document.querySelector('#lgJoinTrip'), host = document.querySelector('#lgJoinFields');
        const draw = () => { const r = trips.get(sel.value); const t = r?.tripTotals || {}; host.innerHTML = tripTotalsFields({ ...t, km: n(t.km) + n(x.actualKm), fuelL: n(t.fuelL) + n(x.fuelLiters), fuelCost: n(t.fuelCost) + n(x.fuelCost), toll: n(t.toll) + n(x.tollCost), parking: n(t.parking) + n(x.parkingCost), other: n(t.other) + n(x.otherCost) }); tripTotalsBind(x.vehicleId); };
        sel.addEventListener('change', draw); draw();
      } });
  };
  Actions['lg-trip-join-save'] = (d) => {
    const x = delivery(d.id); if (!x || x.tripId) return; const tripId = document.querySelector('#lgJoinTrip')?.value;
    const members = (L.deliveries || []).filter(r => r.tripId === tripId); if (!members.length) return;
    const t = tripTotalsRead(x.vehicleId); if (!t) return;
    const v = vehicle(x.vehicleId), oldTotalKm = n(members[0].tripTotals?.km), oldSelfKm = n(x.actualKm), snap = tripSnapshot(x);
    x.tripId = tripId; x.tripMode = 'MANUAL';
    const all = [...members, x]; allocateTrip(all, t);
    all.forEach(r => { applyFuelProposal(r, n(r.tripShare), t.km, { price: t.price, note: t.note }); r.status = 'CLOSED'; syncOrderCost(r); });
    pushTripHistory(x, 'JOINED', `Chuyển từ đơn lẻ vào chuyến ${tripId}`, snap);
    members.forEach(r => pushTripHistory(r, 'REALLOC', `Đơn ${x.id} vào chuyến, phân bổ lại km/chi phí`, tripSnapshot(r)));
    if (v) v.odometer = Math.max(0, n(v.odometer) + t.km - oldTotalKm - oldSelfKm);
    if (typeof SalesCRM !== 'undefined') SalesCRM.saveLocal(['orders']);
    rerender('Đã thêm vào chuyến', `${x.id} → ${tripId} · ${all.length} đơn.`);
  };
  // Legacy: giữ handler để tương thích dữ liệu/call cũ; UI không còn nút chốt chuyến riêng.
  Actions['lg-trip-close']=(d)=>{
    const x=delivery(d.id);if(!x)return;const members=tripMembers(x);
    if(!members.every(r=>['DELIVERED','PARTIAL','CLOSED'].includes(r.status))){Toast.warn('Chưa thể chốt chuyến','Còn điểm giao trong chuyến chưa xác nhận giao hàng.');return;}
    const km=Math.max(...members.map(r=>n(r.actualKm)),0); const v=vehicle(x.vehicleId); const norm=v&&km>0?km*n(v.fuelNorm)/100:0;
    Modal.open({title:`Chốt chuyến · ${x.tripId||x.id}`,sub:`${members.length} điểm giao · ${num(members.reduce((s,r)=>s+deliveryCargoKg(r),0),3)} kg · định mức ${num(norm,1)} L cho ${num(km,1)} km`,size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Nhiên liệu thực tế (L) *</label><input class="inp num" id="lgFuel" type="number" min="0" step="0.1" value="${num(norm,1)}"></div><div class="field"><label>Chi phí nhiên liệu *</label><input class="inp num" id="lgFuelCost" data-money="1" type="text" inputmode="numeric" min="0" value="0"></div><div class="field"><label>Phí cầu đường</label><input class="inp num" id="lgToll" data-money="1" type="text" inputmode="numeric" min="0" value="0"></div><div class="field"><label>Phí bãi xe</label><input class="inp num" id="lgParking" data-money="1" type="text" inputmode="numeric" min="0" value="0"></div><div class="field"><label>Chi phí khác</label><input class="inp num" id="lgOther" data-money="1" type="text" inputmode="numeric" min="0" value="0"></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-trip-close-save" data-id="${e(x.id)}"><i class="fa-solid fa-lock"></i>Chốt chuyến</button>`});
  };
  Actions['lg-trip-close-save']=(d)=>{
    const x=delivery(d.id);if(!x)return;const members=tripMembers(x);if(!members.every(r=>['DELIVERED','PARTIAL','CLOSED'].includes(r.status))){Toast.warn('Chưa thể chốt chuyến','Còn điểm giao chưa hoàn thành.');return;}
    const fuel=n(document.querySelector('#lgFuel')?.value),fuelCost=parseMoney(document.querySelector('#lgFuelCost')?.value),toll=parseMoney(document.querySelector('#lgToll')?.value),parking=parseMoney(document.querySelector('#lgParking')?.value),other=parseMoney(document.querySelector('#lgOther')?.value);
    const totalCost=fuelCost+toll+parking+other,totalCargo=members.reduce((s,r)=>s+deliveryCargoKg(r),0)||members.length,tripKm=Math.max(...members.map(r=>n(r.actualKm)),0);
    members.forEach(row=>{const share=totalCargo>0?deliveryCargoKg(row)/totalCargo:1/members.length;row.fuelLiters=fuel*share;row.fuelCost=fuelCost*share;row.tollCost=toll*share;row.parkingCost=parking*share;row.otherCost=other*share;row.tripActualKm=tripKm;row.status='CLOSED';const order=(DB.orders||[]).find(o=>o.id===row.orderId);if(order){order.actualTransportCost=totalCost*share;order.transportCostPerKm=tripKm>0?(totalCost*share)/tripKm:0;order.logisticsStatus='CLOSED';order.logisticsClosedAt=nowIso();}});
    if(typeof SalesCRM!=='undefined') SalesCRM.saveLocal(['orders']);
    rerender('Đã chốt chuyến',`${x.tripId||x.id} · tổng chi phí ${money(totalCost)} được phân bổ theo khối lượng từng đơn.`);
  };
  Actions['lg-gps-update']=(d)=>{const x=delivery(d.id);if(!x)return;Modal.open({title:`Cập nhật GPS · ${x.id}`,size:'sm',body:`<div class="form-grid cols-2"><div class="field"><label>Latitude</label><input class="inp num" id="lgLat" type="number" step="0.00001" value="${x.gpsLat||10.8231}"></div><div class="field"><label>Longitude</label><input class="inp num" id="lgLng" type="number" step="0.00001" value="${x.gpsLng||106.6297}"></div><div class="field" style="grid-column:1/-1"><label>Km đã đi</label><input class="inp num" id="lgGpsKm" type="number" min="0" step="0.1" value="${n(x.actualKm)}"></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-gps-update-save" data-id="${e(x.id)}">Cập nhật</button>`});};
  Actions['lg-gps-update-save']=(d)=>{const x=delivery(d.id);if(!x)return;x.gpsLat=n(document.querySelector('#lgLat')?.value);x.gpsLng=n(document.querySelector('#lgLng')?.value);x.actualKm=n(document.querySelector('#lgGpsKm')?.value);x.gpsUpdatedAt=nowIso();rerender('Đã cập nhật GPS',`${x.id} · ${num(x.actualKm,1)} km`);};

  Actions['lg-vehicle-new']=()=>openVehicleForm(); Actions['lg-vehicle-edit']=(d)=>{const v=vehicle(d.id);if(v)openVehicleForm(v);};
  Actions['lg-vehicle-save']=(d)=>{const plate=document.querySelector('#lgVPlate')?.value.trim(),typeId=document.querySelector('#lgVTypeId')?.value||'',t=vehicleType(typeId),cap=n(document.querySelector('#lgVCapacity')?.value),norm=n(document.querySelector('#lgVNorm')?.value);if(!plate||!t||cap<=0||norm<0){Toast.err('Dữ liệu xe chưa hợp lệ','Kiểm tra biển số, danh mục xe, tải trọng và định mức.');return;}let v=d.id?vehicle(d.id):null;if(!v){let no=1;const used=new Set((L.vehicles||[]).map(x=>x.id));while(used.has(`XE-${String(no).padStart(3,'0')}`))no++;v={id:`XE-${String(no).padStart(3,'0')}`,status:'AVAILABLE'};L.vehicles.push(v);}Object.assign(v,{plate,typeId,type:t.name,capacityKg:cap,fuelType:document.querySelector('#lgVFuel')?.value||t.defaultFuelType||'Diesel',fuelNorm:norm,odometer:n(document.querySelector('#lgVOdo')?.value),gpsDevice:document.querySelector('#lgVGps')?.value.trim()||'',registrationExpiry:document.querySelector('#lgVReg')?.value||'',nextMaintenanceDate:document.querySelector('#lgVNextDate')?.value||'',nextMaintenanceKm:n(document.querySelector('#lgVNextKm')?.value)});rerender('Đã lưu xe',`${v.id} · ${v.plate}`);};
  Actions['lg-vehicle-type-new']=()=>openVehicleTypeForm();
  Actions['lg-vehicle-type-edit']=(d)=>{const t=vehicleType(d.id);if(t)openVehicleTypeForm(t);};
  Actions['lg-vehicle-type-save']=(d)=>{const name=document.querySelector('#lgVTName')?.value.trim(),cap=n(document.querySelector('#lgVTCapacity')?.value);if(!name||cap<=0){Toast.err('Dữ liệu danh mục chưa hợp lệ','Tên loại xe và tải trọng mặc định là bắt buộc.');return;}let t=d.id?vehicleType(d.id):null;if(!t){let no=1;const used=new Set((L.vehicleTypes||[]).map(x=>x.id));while(used.has(`LX-${String(no).padStart(3,'0')}`))no++;t={id:`LX-${String(no).padStart(3,'0')}`};L.vehicleTypes.push(t);}Object.assign(t,{name,bodyType:document.querySelector('#lgVTBody')?.value.trim()||'',refrigerated:document.querySelector('#lgVTCold')?.value==='1',defaultCapacityKg:cap,defaultFuelType:document.querySelector('#lgVTFuel')?.value||'Diesel',defaultFuelNorm:n(document.querySelector('#lgVTNorm')?.value),maintenanceCycleKm:n(document.querySelector('#lgVTCycle')?.value),status:document.querySelector('#lgVTStatus')?.value||'ACTIVE',note:document.querySelector('#lgVTNote')?.value.trim()||''});(L.vehicles||[]).forEach(v=>{if(v.typeId===t.id)v.type=t.name;});rerender('Đã lưu danh mục xe',`${t.id} · ${t.name}`);};
  Actions['lg-driver-new']=()=>openDriverForm(); Actions['lg-driver-edit']=(d)=>{const x=driver(d.id);if(x)openDriverForm(x);};
  Actions['lg-driver-save']=(d)=>{const name=document.querySelector('#lgDName')?.value.trim(),lic=document.querySelector('#lgDLicense')?.value.trim();if(!name||!lic){Toast.err('Thiếu thông tin','Họ tên và số GPLX là bắt buộc.');return;}let x=d.id?driver(d.id):null;if(!x){x={id:`TX-${String(L.drivers.length+1).padStart(3,'0')}`,employeeId:''};L.drivers.push(x);}Object.assign(x,{name,phone:document.querySelector('#lgDPhone')?.value.trim()||'',licenseNo:lic,licenseClass:document.querySelector('#lgDClass')?.value.trim()||'',licenseExpiry:document.querySelector('#lgDExpiry')?.value||'',status:document.querySelector('#lgDStatus')?.value||'AVAILABLE'});rerender('Đã lưu tài xế',`${x.id} · ${x.name}`);};

  Actions['lg-maint-new']=()=>openMaintenanceForm();
  Actions['lg-maint-save']=()=>{const vid=document.querySelector('#lgMVehicle')?.value,date=document.querySelector('#lgMDate')?.value;if(!vid||!date){Toast.err('Thiếu thông tin','Vui lòng chọn xe và ngày bảo trì.');return;}const x={id:uid('BTX',L.maintenance),vehicleId:vid,type:document.querySelector('#lgMType')?.value||'Định kỳ',scheduledDate:date,scheduledKm:n(document.querySelector('#lgMKm')?.value)||n(vehicle(vid)?.odometer),status:'PLANNED',vendor:document.querySelector('#lgMVendor')?.value.trim()||'',cost:n(document.querySelector('#lgMCost')?.value),description:document.querySelector('#lgMDesc')?.value.trim()||'',completedDate:'',nextDate:'',nextKm:0};L.maintenance.unshift(x);rerender('Đã lập lịch bảo trì',`${x.id} · ${vehicle(vid)?.plate||vid}`);};
  Actions['lg-maint-view']=(d)=>{const x=maint(d.id);if(!x)return;const v=vehicle(x.vehicleId);let btn='';if(x.status==='PLANNED')btn=`<button class="btn btn-primary" data-act="lg-maint-start" data-id="${e(x.id)}"><i class="fa-solid fa-play"></i>Bắt đầu bảo trì</button>`;if(x.status==='IN_PROGRESS')btn=`<button class="btn btn-primary" data-act="lg-maint-finish" data-id="${e(x.id)}"><i class="fa-solid fa-check"></i>Hoàn thành</button>`;Modal.open({title:`Phiếu bảo trì · ${x.id}`,size:'lg',body:`<div class="form-grid cols-2"><div class="field"><label>Xe</label><div class="inp">${e(v?.plate||x.vehicleId)}</div></div><div class="field"><label>Trạng thái</label><div class="inp">${statusBadge(x.status)}</div></div><div class="field"><label>Loại</label><div class="inp">${e(x.type)}</div></div><div class="field"><label>Lịch</label><div class="inp">${dateFmt(x.scheduledDate)} · ${num(x.scheduledKm)} km</div></div><div class="field" style="grid-column:1/-1"><label>Nội dung</label><div class="inp">${e(x.description||'—')}</div></div><div class="field"><label>Đơn vị sửa chữa</label><div class="inp">${e(x.vendor||'—')}</div></div><div class="field"><label>Chi phí</label><div class="inp">${money(x.cost)}</div></div></div>`,foot:`<button class="btn" data-act="modal-close">Đóng</button>${btn}`});};
  Actions['lg-maint-start']=(d)=>{const x=maint(d.id),v=x&&vehicle(x.vehicleId);if(!x||!v)return;if(v.status==='BUSY'){Toast.err('Xe đang chạy chuyến','Không thể bắt đầu bảo trì khi xe đang được điều phối.');return;}x.status='IN_PROGRESS';rerender('Đã bắt đầu bảo trì',v.plate);};
  Actions['lg-maint-finish']=(d)=>{const x=maint(d.id);if(!x)return;Modal.open({title:`Hoàn thành bảo trì · ${x.id}`,size:'md',body:`<div class="form-grid cols-2"><div class="field"><label>Chi phí thực tế</label><input class="inp num" id="lgMFinalCost" data-money="1" type="text" inputmode="numeric" min="0" value="${n(x.cost)}"></div><div class="field"><label>Bảo trì kế tiếp</label><input class="inp" id="lgMNextDate" type="date" value="${addDaysLocal(today(),90)}"></div><div class="field"><label>Mốc km kế tiếp</label><input class="inp num" id="lgMNextKm" type="number" min="0" value="${n(vehicle(x.vehicleId)?.odometer)+5000}"></div></div>`,foot:`<button class="btn" data-act="modal-close">Hủy</button><button class="btn btn-primary" data-act="lg-maint-finish-save" data-id="${e(x.id)}">Xác nhận hoàn thành</button>`});};
  Actions['lg-maint-finish-save']=(d)=>{const x=maint(d.id),v=x&&vehicle(x.vehicleId);if(!x||!v)return;x.cost=parseMoney(document.querySelector('#lgMFinalCost')?.value);x.nextDate=document.querySelector('#lgMNextDate')?.value||'';x.nextKm=n(document.querySelector('#lgMNextKm')?.value);x.completedDate=today();x.status='DONE';v.nextMaintenanceDate=x.nextDate;v.nextMaintenanceKm=x.nextKm;rerender('Đã hoàn thành bảo trì',`${v.plate} trở lại trạng thái sẵn sàng.`);};

  function completedSalesIssue(orderId) {
    return ((typeof DB!=='undefined' && DB.goodsIssues) || []).find(g =>
      g && g.type === 'SALES_ISSUE' && (g.orderId === orderId || g.refDoc === orderId) && g.status === 'COMPLETED'
    ) || null;
  }

  function buildDeliveryRow(order, status, salesIssueId='') {
    const snap = orderSnapshot(order);
    const id = uid('GH', L.deliveries);
    return { id, orderId:order.id, salesIssueId:salesIssueId||order.salesIssueId||'', customer:snap.customer, address:snap.address, recipient:snap.recipient, phone:snap.phone, deliveryNote:snap.deliveryNote, shippingFee:snap.shippingFee, deliveryLat:snap.lat, deliveryLng:snap.lng, promisedDate:snap.promisedDate<today()?today():snap.promisedDate, promisedTime:'10:00', items:snap.items, plannedStart:'', actualStart:'', actualDelivered:'', vehicleId:'', driverId:'', route:'', estimatedKm:0, actualKm:0, cargoKg:snap.shippingWeightKg, deliveredQty:0, returnedQty:0, fuelLiters:0, fuelCost:0, tollCost:0, parkingCost:0, otherCost:0, status, gpsLat:null, gpsLng:null, gpsUpdatedAt:'', note:snap.deliveryNote||`${status==='WAIT_WAREHOUSE'?'Tạo từ đơn sẵn sàng xuất':'Tự động tạo sau khi Kho xuất'} ${order.id}`, createdAt:nowIso(), autoCreated:true };
  }

  function ensureDeliveryForSalesOrder(order, salesIssueId='') {
    if (!order) return { id:'', changed:false };
    load();
    const issue = completedSalesIssue(order.id);
    const issueId = salesIssueId || issue?.id || order.salesIssueId || '';
    const issued = !!issue;
    let existing = L.deliveries.find(d => d.orderId === order.id && !['FAILED','CANCELLED'].includes(d.status));
    let changed = false;

    if (!existing) {
      const eligible = ['dh_hoan_thanh','dh_cho_van_chuyen'].includes(order.status);
      if (!eligible) return { id:'', changed:false };
      existing = buildDeliveryRow(order, issued ? 'WAIT_DISPATCH' : 'WAIT_WAREHOUSE', issueId);
      L.deliveries.unshift(existing);
      changed = true;
    } else if (issued && existing.status === 'WAIT_WAREHOUSE') {
      existing.status = 'WAIT_DISPATCH';
      existing.salesIssueId = issueId;
      existing.note = existing.note || `Kho đã xuất đơn ${order.id}`;
      changed = true;
    }

    order.logisticsDeliveryId = existing.id;
    order.logisticsStatus = existing.status;
    if (issued && !['dh_da_giao','dh_hoan_tat'].includes(order.status)) order.status = 'dh_cho_van_chuyen';
    return { id:existing.id, changed };
  }

  function reconcileSalesOrders() {
    load();
    let changed = false;
    const orders = ((typeof DB!=='undefined' && DB.orders) || []).filter(o =>
      o && ['dh_hoan_thanh','dh_cho_van_chuyen'].includes(o.status) && !['dh_da_giao','dh_hoan_tat','dh_huy'].includes(o.status)
    );
    orders.forEach(order => {
      const result = ensureDeliveryForSalesOrder(order);
      changed = changed || result.changed;
    });
    if (changed) {
      SalesCRM?.saveLocal?.(['orders']);
      save();
    }
    return changed;
  }

  function createFromSalesOrder(orderId, salesIssueId='') {
    const order = ((typeof DB!=='undefined' && DB.orders) || []).find(o => o.id === orderId);
    if (!order) return '';
    const result = ensureDeliveryForSalesOrder(order, salesIssueId);
    if (result.changed) {
      SalesCRM?.saveLocal?.(['orders']);
      save();
    }
    return result.id;
  }

  window.LogisticsFleet = { load, save, data:()=>L, createFromSalesOrder, reconcileSalesOrders, flush:syncChanged, refreshFromServer, ensureFresh, isReady:()=>serverReady };
})();
