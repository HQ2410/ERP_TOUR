/* ============================================================================
 * KIO DATA UTILITIES
 * ----------------------------------------------------------------------------
 * Utility dùng chung cho PurchaseAPI và InventoryAPI.
 * Không xử lý nghiệp vụ PR/PO/Kho/QC; chỉ hỗ trợ clone, cache và merge demo.
 * ========================================================================== */
const KioDataUtils = (() => {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function readJson(key) {
    const raw = storageGet(key);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : null;
    } catch (_) {
      return null;
    }
  }

  function writeJson(key, value) {
    if (!value || typeof value !== 'object') return false;
    return storageSet(key, JSON.stringify(value));
  }

  function recordKey(item, index = 0) {
    if (item && typeof item === 'object') {
      const candidates = [
        item.id, item.code, item.key, item.lotId, item.lotNumber,
        item.transactionId, item.transferId, item.countId, item.requestId,
        item.inspectionId, item.moveId, item.poId, item.quoteId,
      ];
      const found = candidates.find(v => v !== undefined && v !== null && String(v) !== '');
      if (found !== undefined) return String(found);
    }
    return `ROW-${index + 1}`;
  }

  // Demo được đưa vào trước; record server ghi đè nếu trùng key.
  // Nhờ vậy dữ liệu người dùng trên server luôn được ưu tiên.
  function mergeServerOverDemo(serverItems, demoItems) {
    const merged = new Map();
    (Array.isArray(demoItems) ? demoItems : []).forEach((item, index) => {
      merged.set(recordKey(item, index), item);
    });
    (Array.isArray(serverItems) ? serverItems : []).forEach((item, index) => {
      merged.set(recordKey(item, index), item);
    });
    return [...merged.values()];
  }

  function snapshotCollections(tableMap, source = DB) {
    return Object.fromEntries(Object.keys(tableMap).map(key => [
      key,
      clone(Array.isArray(source[key]) ? source[key] : []),
    ]));
  }

  return {
    clone,
    storageGet,
    storageSet,
    readJson,
    writeJson,
    recordKey,
    mergeServerOverDemo,
    snapshotCollections,
  };
})();
