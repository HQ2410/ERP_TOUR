/* ============================================================================
 * RESTAURANT SALES REALISTIC TEST DATA
 * --------------------------------------------------------------------------
 * Bộ dữ liệu mô phỏng thực tế dùng riêng để test Nhà hàng & Cửa hàng.
 * KHÔNG tự chạy và KHÔNG ghi server khi tải trang.
 *
 * Cách dùng trong DevTools Console:
 *   await RestaurantSalesTestData.seedToServer()
 *
 * Dữ liệu được MERGE theo id TEST, không xóa dữ liệu Restaurant đang có.
 * ========================================================================== */
window.RestaurantSalesTestData = (() => {
  const DATA_URL = 'docs/restaurant_sales_realistic_test_data.json?v=20260918a';
  const MAP = {
    stores: 'stores',
    recipes: 'restaurantRecipes',
    orders: 'posOrders',
    replenishments: 'storeReplenishmentRequests',
    storeStocks: 'restaurantStoreStocks',
    storeStockTransactions: 'restaurantStoreStockTransactions',
  };

  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function mergeById(current, incoming){
    const map = new Map((Array.isArray(current)?current:[]).map(x => [String(x?.id||''), x]));
    for (const row of (Array.isArray(incoming)?incoming:[])) {
      if (!row?.id) continue;
      map.set(String(row.id), clone(row));
    }
    return [...map.values()];
  }

  async function load(){
    const res = await fetch(DATA_URL, { cache:'no-store' });
    if (!res.ok) throw new Error(`Không đọc được dữ liệu test (${res.status})`);
    return res.json();
  }

  async function seedToServer(){
    if (typeof DB === 'undefined') throw new Error('DB chưa sẵn sàng. Hãy mở ERP rồi chạy lại.');
    if (typeof RestaurantQualityAPI === 'undefined') throw new Error('RestaurantQualityAPI chưa sẵn sàng.');
    const data = await load();
    const keys = ['stores','recipes','orders','replenishments','storeStocks','storeStockTransactions'];
    for (const key of keys) {
      const dbKey = MAP[key];
      DB[dbKey] = mergeById(DB[dbKey], data[key]);
    }
    // Ghi từng collection để nếu bảng nào lỗi có thể báo chính xác tên nhóm dữ liệu.
    for (const key of keys) {
      try {
        await RestaurantQualityAPI.syncRestaurant([key]);
      } catch (err) {
        throw new Error(`Không ghi được dữ liệu ${key} lên server: ${err?.message || err}`);
      }
    }
    // Xóa dữ liệu local vừa merge rồi đọc NGƯỢC hoàn toàn từ server.
    // Như vậy không thể xảy ra trường hợp UI đang hiển thị dữ liệu local giả.
    for (const key of keys) {
      const dbKey = MAP[key];
      DB[dbKey] = [];
    }
    await RestaurantQualityAPI.refreshRestaurant(keys);

    const checks = {
      stores: ['stores', data.stores],
      recipes: ['restaurantRecipes', data.recipes],
      orders: ['posOrders', data.orders],
      replenishments: ['storeReplenishmentRequests', data.replenishments],
      storeStocks: ['restaurantStoreStocks', data.storeStocks],
      storeStockTransactions: ['restaurantStoreStockTransactions', data.storeStockTransactions],
    };
    const verification = {};
    for (const [key, [dbKey, expected]] of Object.entries(checks)) {
      const expectedIds = new Set((expected || []).map(x => String(x.id)));
      const actualRows = Array.isArray(DB[dbKey]) ? DB[dbKey] : [];
      const found = actualRows.filter(x => expectedIds.has(String(x?.id || ''))).length;
      verification[key] = { expected: expectedIds.size, found };
      if (found !== expectedIds.size) {
        throw new Error(`Server chưa lưu đủ ${key}: tìm thấy ${found}/${expectedIds.size} record TEST.`);
      }
    }
    if (typeof render === 'function') render();
    console.table([
      {nhom:'Chi nhánh',so_luong:data.stores.length},
      {nhom:'Món / Recipe',so_luong:data.recipes.length},
      {nhom:'Đơn hàng',so_luong:data.orders.length},
      {nhom:'Tồn cửa hàng',so_luong:data.storeStocks.length},
      {nhom:'Giao dịch xuất theo POS',so_luong:data.storeStockTransactions.length},
      {nhom:'Yêu cầu bổ sung',so_luong:data.replenishments.length},
    ]);
    return { ...data, verification };
  }

  async function preview(){
    const data = await load();
    console.log('[RestaurantSalesTestData] Dữ liệu test mô phỏng thực tế:', data);
    return data;
  }

  return { load, preview, seedToServer };
})();
