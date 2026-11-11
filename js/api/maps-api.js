(function(){
  'use strict';
  const DEFAULT_RATE = 10000;
  const PROXY = 'api/osm-proxy.php';
  const n = v => Number(v || 0);

  async function fetchJson(url, options={}) {
    const res = await fetch(url, options);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || data?.ok === false) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.details = data?.details;
      throw err;
    }
    return data;
  }

  async function geocode(address) {
    const q = String(address || '').trim();
    if (!q) throw new Error('Thiếu địa chỉ để tìm tọa độ.');
    const data = await fetchJson(`${PROXY}?action=geocode&q=${encodeURIComponent(q)}`);
    return {
      lat:Number(data.lat),
      lng:Number(data.lng),
      displayName:data.displayName || q,
      provider:data.provider || 'OpenStreetMap'
    };
  }

  async function resolvePoint(p) {
    if (!p) throw new Error('Thiếu điểm trên tuyến.');
    const lat = n(p.lat), lng = n(p.lng);
    if (lat && lng) return {...p, lat, lng};
    const g = await geocode(p.address || p.name || '');
    return {...p, ...g};
  }

  async function config(){
    try {
      const data = await fetchJson(`${PROXY}?action=config`);
      return {...data, browserKey:'', defaultRatePerKm:Number(data.defaultRatePerKm||DEFAULT_RATE)};
    } catch (_) {
      return {ok:true,configured:true,provider:'OpenStreetMap + OSRM',browserKey:'',defaultRatePerKm:DEFAULT_RATE,freeDemo:true,proxied:true};
    }
  }

  async function route(payload={}){
    const origin = await resolvePoint(payload.origin);
    const rawStops = Array.isArray(payload.stops) ? payload.stops : [];
    if (!rawStops.length) throw new Error('Chưa có điểm giao hàng.');
    const stops=[];
    for (const p of rawStops) stops.push(await resolvePoint(p));
    const pts=[origin,...stops];

    const data = await fetchJson(`${PROXY}?action=route`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({points:pts.map(p=>({lat:p.lat,lng:p.lng}))})
    });

    return {
      ok:true,
      provider:data.provider || 'OpenStreetMap + OSRM',
      distanceKm:Number(data.distanceKm||0),
      durationMinutes:Number(data.durationMinutes||0),
      geometry:data.geometry || null,
      resolvedOrigin:origin,
      resolvedStops:stops,
      browserKey:'',
      defaultRatePerKm:DEFAULT_RATE
    };
  }

  function directionsUrl(origin, stops){
    const pts=[origin,...(stops||[])].filter(Boolean).filter(p=>n(p.lat)&&n(p.lng));
    if (pts.length < 2) return 'https://www.openstreetmap.org/';
    const start=pts[0], end=pts[pts.length-1];
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${start.lat}%2C${start.lng}%3B${end.lat}%2C${end.lng}`;
  }

  window.MapsRouteAPI={config,route,directionsUrl,geocode};
})();
