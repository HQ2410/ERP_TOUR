/* Vietnam administrative address selector — mô hình 2 cấp sau sáp nhập 01/07/2025.
 * Tỉnh/Thành phố -> Phường/Xã/Đặc khu. Cấp Quận/Huyện đã được loại khỏi địa chỉ mới.
 * Nguồn runtime: Province Open API v2 (post-07/2025). Fallback giữ đủ 34 tỉnh/thành.
 */
(function(){
  const API='https://provinces.open-api.vn/api/v2/?depth=2';
  const CACHE_KEY='lenam_vn_admin_divisions_v2_2025';
  const CACHE_MS=7*24*60*60*1000;
  let mem=null;

  const PROVINCES_34=[
    ['01','Thành phố Hà Nội'],['04','Tỉnh Cao Bằng'],['08','Tỉnh Tuyên Quang'],['11','Tỉnh Điện Biên'],['12','Tỉnh Lai Châu'],['14','Tỉnh Sơn La'],['15','Tỉnh Lào Cai'],['19','Tỉnh Thái Nguyên'],['20','Tỉnh Lạng Sơn'],['22','Tỉnh Quảng Ninh'],['24','Tỉnh Bắc Ninh'],['25','Tỉnh Phú Thọ'],['31','Thành phố Hải Phòng'],['33','Tỉnh Hưng Yên'],['37','Tỉnh Ninh Bình'],['38','Tỉnh Thanh Hóa'],['40','Tỉnh Nghệ An'],['42','Tỉnh Hà Tĩnh'],['44','Tỉnh Quảng Trị'],['46','Thành phố Huế'],['48','Thành phố Đà Nẵng'],['51','Tỉnh Quảng Ngãi'],['52','Tỉnh Gia Lai'],['56','Tỉnh Khánh Hòa'],['66','Tỉnh Đắk Lắk'],['68','Tỉnh Lâm Đồng'],['75','Tỉnh Đồng Nai'],['79','Thành phố Hồ Chí Minh'],['80','Tỉnh Tây Ninh'],['82','Tỉnh Đồng Tháp'],['86','Tỉnh Vĩnh Long'],['91','Tỉnh An Giang'],['92','Thành phố Cần Thơ'],['96','Tỉnh Cà Mau']
  ];
  const FALLBACK=PROVINCES_34.map(([code,name])=>({code,name,wards:[]}));

  const LEGACY_PROVINCE_MAP={
    'Hà Giang':'Tỉnh Tuyên Quang','Tỉnh Hà Giang':'Tỉnh Tuyên Quang','Tuyên Quang':'Tỉnh Tuyên Quang',
    'Yên Bái':'Tỉnh Lào Cai','Tỉnh Yên Bái':'Tỉnh Lào Cai','Lào Cai':'Tỉnh Lào Cai',
    'Bắc Kạn':'Tỉnh Thái Nguyên','Tỉnh Bắc Kạn':'Tỉnh Thái Nguyên','Thái Nguyên':'Tỉnh Thái Nguyên',
    'Vĩnh Phúc':'Tỉnh Phú Thọ','Tỉnh Vĩnh Phúc':'Tỉnh Phú Thọ','Hòa Bình':'Tỉnh Phú Thọ','Tỉnh Hòa Bình':'Tỉnh Phú Thọ','Phú Thọ':'Tỉnh Phú Thọ',
    'Bắc Giang':'Tỉnh Bắc Ninh','Tỉnh Bắc Giang':'Tỉnh Bắc Ninh','Bắc Ninh':'Tỉnh Bắc Ninh',
    'Thái Bình':'Tỉnh Hưng Yên','Tỉnh Thái Bình':'Tỉnh Hưng Yên','Hưng Yên':'Tỉnh Hưng Yên',
    'Hải Dương':'Thành phố Hải Phòng','Tỉnh Hải Dương':'Thành phố Hải Phòng','Hải Phòng':'Thành phố Hải Phòng','TP. Hải Phòng':'Thành phố Hải Phòng',
    'Hà Nam':'Tỉnh Ninh Bình','Tỉnh Hà Nam':'Tỉnh Ninh Bình','Nam Định':'Tỉnh Ninh Bình','Tỉnh Nam Định':'Tỉnh Ninh Bình','Ninh Bình':'Tỉnh Ninh Bình',
    'Quảng Bình':'Tỉnh Quảng Trị','Tỉnh Quảng Bình':'Tỉnh Quảng Trị','Quảng Trị':'Tỉnh Quảng Trị',
    'Quảng Nam':'Thành phố Đà Nẵng','Tỉnh Quảng Nam':'Thành phố Đà Nẵng','Đà Nẵng':'Thành phố Đà Nẵng','TP. Đà Nẵng':'Thành phố Đà Nẵng',
    'Kon Tum':'Tỉnh Quảng Ngãi','Tỉnh Kon Tum':'Tỉnh Quảng Ngãi','Quảng Ngãi':'Tỉnh Quảng Ngãi',
    'Bình Định':'Tỉnh Gia Lai','Tỉnh Bình Định':'Tỉnh Gia Lai','Gia Lai':'Tỉnh Gia Lai',
    'Ninh Thuận':'Tỉnh Khánh Hòa','Tỉnh Ninh Thuận':'Tỉnh Khánh Hòa','Khánh Hòa':'Tỉnh Khánh Hòa',
    'Đắk Nông':'Tỉnh Lâm Đồng','Tỉnh Đắk Nông':'Tỉnh Lâm Đồng','Bình Thuận':'Tỉnh Lâm Đồng','Tỉnh Bình Thuận':'Tỉnh Lâm Đồng','Lâm Đồng':'Tỉnh Lâm Đồng',
    'Phú Yên':'Tỉnh Đắk Lắk','Tỉnh Phú Yên':'Tỉnh Đắk Lắk','Đắk Lắk':'Tỉnh Đắk Lắk',
    'Bình Dương':'Thành phố Hồ Chí Minh','Tỉnh Bình Dương':'Thành phố Hồ Chí Minh','Bà Rịa - Vũng Tàu':'Thành phố Hồ Chí Minh','Tỉnh Bà Rịa - Vũng Tàu':'Thành phố Hồ Chí Minh','TP. Hồ Chí Minh':'Thành phố Hồ Chí Minh','Hồ Chí Minh':'Thành phố Hồ Chí Minh',
    'Bình Phước':'Tỉnh Đồng Nai','Tỉnh Bình Phước':'Tỉnh Đồng Nai','Đồng Nai':'Tỉnh Đồng Nai',
    'Long An':'Tỉnh Tây Ninh','Tỉnh Long An':'Tỉnh Tây Ninh','Tây Ninh':'Tỉnh Tây Ninh',
    'Tiền Giang':'Tỉnh Đồng Tháp','Tỉnh Tiền Giang':'Tỉnh Đồng Tháp','Đồng Tháp':'Tỉnh Đồng Tháp',
    'Bến Tre':'Tỉnh Vĩnh Long','Tỉnh Bến Tre':'Tỉnh Vĩnh Long','Trà Vinh':'Tỉnh Vĩnh Long','Tỉnh Trà Vinh':'Tỉnh Vĩnh Long','Vĩnh Long':'Tỉnh Vĩnh Long',
    'Kiên Giang':'Tỉnh An Giang','Tỉnh Kiên Giang':'Tỉnh An Giang','An Giang':'Tỉnh An Giang',
    'Hậu Giang':'Thành phố Cần Thơ','Tỉnh Hậu Giang':'Thành phố Cần Thơ','Sóc Trăng':'Thành phố Cần Thơ','Tỉnh Sóc Trăng':'Thành phố Cần Thơ','Cần Thơ':'Thành phố Cần Thơ','TP. Cần Thơ':'Thành phố Cần Thơ',
    'Bạc Liêu':'Tỉnh Cà Mau','Tỉnh Bạc Liêu':'Tỉnh Cà Mau','Cà Mau':'Tỉnh Cà Mau'
  };

  function escText(v){return String(v??'');}
  function normalizeProvince(v){
    const s=String(v||'').trim(); if(!s)return '';
    if(LEGACY_PROVINCE_MAP[s]) return LEGACY_PROVINCE_MAP[s];
    const exact=PROVINCES_34.find(([,name])=>name===s); if(exact)return exact[1];
    const loose=PROVINCES_34.find(([,name])=>name.replace(/^(Tỉnh|Thành phố)\s+/,'')===s.replace(/^(Tỉnh|Thành phố|TP\.)\s+/,'').trim());
    return loose?.[1]||s;
  }
  function normalizePayload(data){
    return (Array.isArray(data)?data:[]).map(p=>({
      ...p,
      code:String(p.code??''),
      name:p.name,
      wards:Array.isArray(p.wards)?p.wards:[]
    }));
  }
  async function load(){
    if(mem)return mem;
    try{
      const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
      if(cached?.ts&&Date.now()-cached.ts<CACHE_MS&&Array.isArray(cached.data)&&cached.data.length===34){mem=cached.data;return mem;}
    }catch(_){ }
    try{
      const res=await fetch(API,{headers:{Accept:'application/json'},cache:'no-store'});
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const data=normalizePayload(await res.json());
      if(data.length!==34)throw new Error(`Danh mục sau sáp nhập không đủ 34 tỉnh/thành (${data.length})`);
      mem=data;
      try{localStorage.setItem(CACHE_KEY,JSON.stringify({ts:Date.now(),data:mem}));}catch(_){ }
      return mem;
    }catch(err){console.warn('[VNAddress] Dùng danh mục 34 tỉnh/thành dự phòng; danh sách xã/phường cần API v2:',err);mem=FALLBACK;return mem;}
  }
  function selectedName(el){return el?.value?.trim()||'';}
  function setOptions(el,items,placeholder,current=''){
    if(!el)return;
    const cur=String(current||'').trim();
    el.innerHTML=`<option value="">${placeholder}</option>`+(items||[]).map(x=>`<option value="${escText(x.name).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}" data-code="${x.code}" ${x.name===cur?'selected':''}>${escText(x.name)}</option>`).join('');
  }
  async function init(cfg){
    const p=document.getElementById(cfg.provinceId), w=document.getElementById(cfg.wardId), d=cfg.districtId?document.getElementById(cfg.districtId):null;
    if(!p||!w)return;
    const initial={province:normalizeProvince(cfg.province||''),ward:cfg.ward||''};
    if(d){d.value='';d.disabled=true;const wrap=d.closest('.field');if(wrap)wrap.style.display='none';}
    const fail=()=>{
      p.disabled=w.disabled=false;
      const note=document.getElementById(cfg.noteId||'');
      if(note)note.textContent='Không tải được danh sách xã/phường. Danh sách 34 tỉnh/thành vẫn dùng được; vui lòng thử lại khi có mạng.';
    };
    try{
      p.disabled=w.disabled=true;
      const provinces=await load();
      setOptions(p,provinces,'-- Chọn Tỉnh/Thành phố --',initial.province);
      const province=provinces.find(x=>x.name===selectedName(p));
      setOptions(w,province?.wards||[],'-- Chọn Phường/Xã/Đặc khu --',initial.ward);
      p.disabled=w.disabled=false;
      p.onchange=()=>{
        const pp=provinces.find(x=>x.name===selectedName(p));
        setOptions(w,pp?.wards||[],'-- Chọn Phường/Xã/Đặc khu --','');
      };
    }catch(err){console.warn('[VNAddress]',err);fail();}
  }
  async function setValues(cfg){await init(cfg);}
  function compose(detail,ward,district,province){
    const parts=[detail,ward,province].map(x=>String(x||'').trim()).filter(Boolean);
    return [...new Set(parts)].join(', ');
  }
  function read(prefix){
    const province=document.getElementById(prefix+'Province')?.value?.trim()||'';
    const ward=document.getElementById(prefix+'Ward')?.value?.trim()||'';
    const detail=document.getElementById(prefix+'AddressDetail')?.value?.trim()||'';
    return {province,district:'',ward,addressDetail:detail,address:compose(detail,ward,'',province)};
  }
  window.VNAddress={load,init,setValues,compose,read,normalizeProvince,model:'VN_2_LEVEL_POST_2025'};
})();
