/* ============================================================================
 * KIO SERVER ADAPTER - CHUNKED PAYLOAD v2
 *
 * Dùng đúng API mẫu của công ty:
 *   - getKrudList(...) từ https://kio.dvqt.vn/list.js
 *   - sendFormDataKRUD(...) / krud(...) từ https://kio.dvqt.vn/krud.js
 *
 * KHÔNG thay đổi business logic. Các module vẫn dùng DB.* như cũ.
 *
 * Vì cột `payload` trên server có thể là VARCHAR ngắn, một object nghiệp vụ
 * lớn sẽ bị lỗi MySQL 1406 (Data too long). Adapter này chia một record JSON
 * thành nhiều dòng payload nhỏ, rồi tự ghép lại khi đọc.
 *
 * Server chỉ cần mỗi bảng có tối thiểu:
 *   id      : khóa chính tự tăng
 *   payload : VARCHAR/TEXT (VARCHAR ngắn vẫn dùng được)
 * ========================================================================== */
const KioStore = (() => {
  const PAGE_SIZE = 1000;
  const FORM_ID = '__kio_payload_form__';
  // 120 ký tự giúp payload hoàn chỉnh vẫn an toàn với VARCHAR(255).
  const CHUNK_SIZE = 120;
  const FORMAT_VERSION = 2;
  // [PERFORMANCE] Giới hạn số request ghi/xóa chạy song song. Chunk của cùng
  // một record độc lập (được ghép lại theo chỉ số i), nên có thể gửi theo nhóm
  // nhỏ mà không thay đổi dữ liệu nghiệp vụ. Không tăng quá cao để tránh quá tải KIO.
  const WRITE_CONCURRENCY = 3;

  // [KIO STABILITY] list.js của KIO dùng AbortController nội bộ. Khi nhiều
  // module (Auth/Purchase/Inventory/CRM) gọi getKrudList song song, request
  // trước có thể bị abort ('signal is aborted without reason'). Xếp hàng riêng
  // các request LIST để tránh chúng tự hủy nhau; không thay đổi nghiệp vụ.
  let listRequestChain = Promise.resolve();

  // [PERFORMANCE] Cache kết quả đọc vật lý theo bảng trong một khoảng ngắn.
  // Nhiều màn hình có thể cần cùng một bảng (ví dụ inventory/products/customers);
  // không gọi lại list.php nếu vừa đọc xong. Cache bị vô hiệu ngay khi có ghi/xóa.
  const ROW_CACHE_TTL = 30 * 1000;
  const rowCache = new Map();
  const rowInflight = new Map();

  function invalidateTable(table) {
    rowCache.delete(table);
  }

  function queuedGetKrudList(args) {
    const task = () => getKrudList(args);
    const current = listRequestChain.catch(() => {}).then(task);
    listRequestChain = current.catch(() => {});
    return current;
  }

  function assertReady() {
    if (typeof getKrudList !== 'function') {
      throw new Error('Chưa tải https://kio.dvqt.vn/list.js');
    }
    if (typeof sendFormDataKRUD !== 'function' || typeof krud !== 'function') {
      throw new Error('Chưa tải https://kio.dvqt.vn/krud.js');
    }
  }

  function clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function keyOf(item, index = 0) {
    if (item && typeof item === 'object') {
      const candidates = [
        item.id, item.code, item.key, item.lotId, item.lotNumber,
        item.transactionId, item.transferId, item.countId, item.requestId,
        item.inspectionId, item.moveId,
      ];
      const found = candidates.find(v => v !== undefined && v !== null && String(v) !== '');
      if (found !== undefined) return String(found);
    }
    return `ROW-${index + 1}`;
  }

  function splitText(text, size = CHUNK_SIZE) {
    const out = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out.length ? out : [''];
  }

  function encodeItem(item, index) {
    const key = keyOf(item, index);
    const raw = JSON.stringify(clonePlain(item));
    const chunks = splitText(raw);
    return {
      key,
      raw,
      payloads: chunks.map((data, i) => JSON.stringify({
        v: FORMAT_VERSION,
        k: key,
        i,
        n: chunks.length,
        d: data,
      })),
    };
  }

  function parsePayload(raw) {
    if (raw == null || raw === '') return null;
    let parsed = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); }
      catch (_) { return null; }
    }
    return parsed && typeof parsed === 'object' ? parsed : null;
  }

  async function listRows(table, { force = false } = {}) {
    assertReady();

    const now = Date.now();
    const cached = rowCache.get(table);
    if (!force && cached && (now - cached.at) < ROW_CACHE_TTL) {
      return cached.rows.slice();
    }

    // Nếu cùng bảng đang được đọc, các nơi khác dùng chung Promise thay vì tạo
    // thêm một list.php mới. Điều này giảm request trùng và tránh KIO tự abort.
    // Dedupe cả request force: nếu đúng bảng đang có một list.php chạy thì
    // mọi caller dùng chung Promise đó. Tránh nhiều route/badge cùng F5 tạo request trùng.
    if (rowInflight.has(table)) {
      return (await rowInflight.get(table)).slice();
    }

    const job = (async () => {
      const out = [];
      let page = 1;

      while (true) {
        let res;
        let lastErr;
        // KIO đôi lúc abort request khi server phản hồi chậm. Retry đúng 1 lần
        // sau một khoảng ngắn; không loop vô hạn làm trang càng chậm.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            res = await queuedGetKrudList({
              table,
              page,
              limit: PAGE_SIZE,
              sort: { id: 'ASC' },
              where: [],
            });
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (attempt === 0 && /abort/i.test(String(err?.message || err))) {
              await new Promise(resolve => setTimeout(resolve, 180));
              continue;
            }
            throw err;
          }
        }

        if (lastErr) throw lastErr;
        if (!res || !res.success) {
          throw new Error(res?.error || `Không đọc được bảng ${table}`);
        }
        const rows = Array.isArray(res.data) ? res.data : [];
        out.push(...rows);
        if (rows.length < PAGE_SIZE || out.length >= Number(res.total || 0)) break;
        page += 1;
      }

      rowCache.set(table, { at: Date.now(), rows: out.slice() });
      return out;
    })();

    rowInflight.set(table, job);
    try {
      return (await job).slice();
    } finally {
      rowInflight.delete(table);
    }
  }

  function groupRemoteRows(rows) {
    const groups = new Map();

    rows.forEach(row => {
      const parsed = parsePayload(row.payload);
      if (!parsed) return;

      // Format chunk v2.
      if (parsed.v === FORMAT_VERSION && parsed.k != null && Number.isInteger(Number(parsed.i))) {
        const key = String(parsed.k);
        if (!groups.has(key)) groups.set(key, { key, rows: [], parts: [], legacy: false });
        const g = groups.get(key);
        g.rows.push(row);
        g.parts.push({ i: Number(parsed.i), n: Number(parsed.n || 0), d: String(parsed.d ?? '') });
        return;
      }

      // Hỗ trợ payload cũ { key, data } từ adapter v1.
      if (Object.prototype.hasOwnProperty.call(parsed, 'data')) {
        const key = String(parsed.key ?? keyOf(parsed.data, 0));
        if (!groups.has(key)) groups.set(key, { key, rows: [], parts: [], legacy: true, legacyData: parsed.data });
        const g = groups.get(key);
        g.rows.push(row);
        g.legacy = true;
        g.legacyData = parsed.data;
        return;
      }

      // Hỗ trợ trường hợp trước đó payload lưu thẳng object.
      const key = keyOf(parsed, 0);
      if (!groups.has(key)) groups.set(key, { key, rows: [], parts: [], legacy: true, legacyData: parsed });
      const g = groups.get(key);
      g.rows.push(row);
      g.legacy = true;
      g.legacyData = parsed;
    });

    for (const g of groups.values()) {
      if (g.legacy) {
        try { g.raw = JSON.stringify(g.legacyData); } catch (_) { g.raw = ''; }
        g.data = g.legacyData;
        continue;
      }
      g.parts.sort((a, b) => a.i - b.i);
      const raw = g.parts.map(p => p.d).join('');
      g.raw = raw;
      try { g.data = JSON.parse(raw); }
      catch (_) { g.data = null; }
    }

    return groups;
  }

  async function listCollection(table, opts = {}) {
    const rows = await listRows(table, opts);
    const groups = groupRemoteRows(rows);
    return [...groups.values()].map(g => g.data).filter(Boolean);
  }

  let payloadFormSeq = 0;

  // Mỗi request ghi dùng form riêng để các request chunk có thể chạy song song
  // mà không ghi đè giá trị textarea của nhau. FORM_ID cũ vẫn giữ làm prefix
  // để không ảnh hưởng cách server nhận FormData.
  function createPayloadForm(payloadText) {
    const form = document.createElement('form');
    form.id = `${FORM_ID}_${++payloadFormSeq}`;
    form.style.display = 'none';
    form.innerHTML = '<textarea class="data-element" name="payload"></textarea>';
    form.querySelector('[name="payload"]').value = payloadText;
    document.body.appendChild(form);
    return form;
  }

  async function runLimited(items, limit, worker) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    const results = new Array(list.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(Math.max(1, limit), list.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= list.length) return;
        results[index] = await worker(list[index], index);
      }
    });
    await Promise.all(runners);
    return results;
  }

  async function writePayload(action, table, recordId, payloadText) {
    assertReady();
    const form = createPayloadForm(payloadText);
    try {
      const res = await sendFormDataKRUD(action, table, recordId || null, `#${form.id}`);
      if (!res || !res.success) {
        throw new Error(res?.error || `${action} thất bại ở bảng ${table}`);
      }
      invalidateTable(table);
      return res;
    } finally {
      form.remove();
    }
  }

  async function deleteRows(table, rows) {
    await runLimited(rows || [], WRITE_CONCURRENCY, async (row) => {
      const res = await krud('delete', table, {}, row.id);
      if (!res || !res.success) {
        throw new Error(res?.error || `Không xóa được record ${row.id} ở ${table}`);
      }
      return res;
    });
    if ((rows || []).length) invalidateTable(table);
  }

  async function insertEncoded(table, encoded) {
    // [PERFORMANCE] Chỉ chunk đầu tiên cần đi tuần tự để bảo đảm bảng vật lý đã
    // tồn tại. Sau khi chunk đầu thành công, các chunk còn lại của CÙNG record
    // có thể INSERT song song vì thứ tự ghép đã nằm trong trường `i`. Điều này
    // không đổi payload/logic nghiệp vụ nhưng giảm mạnh thời gian CREATE/UPDATE.
    const payloads = Array.isArray(encoded?.payloads) ? encoded.payloads : [];
    if (!payloads.length) return;

    const writeOne = async (payloadText) => {
      try {
        return await writePayload('insert', table, null, payloadText);
      } catch (err) {
        if (/SQLSTATE\[42S01\]|1050|already exists/i.test(String(err?.message || err))) {
          await new Promise(resolve => setTimeout(resolve, 180));
          return writePayload('insert', table, null, payloadText);
        }
        throw err;
      }
    };

    await writeOne(payloads[0]);
    if (payloads.length > 1) {
      await runLimited(payloads.slice(1), WRITE_CONCURRENCY, writeOne);
    }
  }

  // [PERFORMANCE] Append-only cho dữ liệu có khóa luôn mới (đặc biệt Audit).
  // Không đọc toàn bộ bảng trước khi insert, tránh audit log càng lớn càng chậm.
  async function appendCollection(table, items) {
    assertReady();
    const local = (Array.isArray(items) ? items : []).map(encodeItem);
    for (const encoded of local) await insertEncoded(table, encoded);
    invalidateTable(table);
    return true;
  }

  // Đồng bộ theo key nghiệp vụ: thêm record thiếu, thay record thay đổi;
  // không tự xóa record server chỉ vì frontend chưa có record đó.
  async function syncCollection(table, items) {

    assertReady();

    const local = (Array.isArray(items) ? items : []).map(encodeItem);

    const remoteRows = await listRows(table);
    const remoteGroups = groupRemoteRows(remoteRows);

    for (const encoded of local) {

        const remote = remoteGroups.get(encoded.key);

        if (!remote) {

            await insertEncoded(table, encoded);

            continue;
        }

        if (remote.raw !== encoded.raw || remote.legacy) {

            await deleteRows(table, remote.rows);

            await insertEncoded(table, encoded);
        }
    }

    return true;
  }

  // [DATA CLEANUP] Xóa chính xác một hoặc nhiều record theo khóa nghiệp vụ.
  // Chỉ dùng cho cleanup dữ liệu trùng đã được người dùng yêu cầu; KHÔNG dùng
  // để suy luận/xóa tự động các record chỉ vì frontend không nhìn thấy chúng.
  async function deleteKeys(table, keys) {
    assertReady();
    const wanted = new Set((Array.isArray(keys) ? keys : [keys]).map(String).filter(Boolean));
    if (!wanted.size) return true;
    const rows = await listRows(table);
    const groups = groupRemoteRows(rows);
    for (const key of wanted) {
      const group = groups.get(String(key));
      if (group) await deleteRows(table, group.rows);
    }
    return true;
  }

  // [DATA REPAIR] Thay toàn bộ collection bằng snapshot đã chuẩn hóa.
  // Chỉ dùng khi đã phát hiện dữ liệu vật lý trùng/lỗi; không dùng cho sync thường ngày.
  async function replaceCollection(table, items, options = {}) {
    assertReady();
    const incoming = Array.isArray(items) ? items : [];

    // DATA-SAFE: các collection nghiệp vụ quan trọng không bao giờ được xoá sạch
    // chỉ vì state/cache frontend đang rỗng. Nếu thực sự cần xoá hết, caller phải
    // truyền { allowEmpty: true, reason: '...' } một cách tường minh.
    const EMPTY_PROTECTED_TABLES = new Set([
      'lenam_customers',
      'lenam_sales_orders',
      'lenam_purchase_requests',
      'lenam_inventory_balances',
      'lenam_materials',
      'lenam_finished_products',
      'lenam_users'
    ]);
    if (incoming.length === 0 && EMPTY_PROTECTED_TABLES.has(String(table))) {
      const allowEmpty = options?.allowEmpty === true && String(options?.reason || '').trim().length >= 8;
      if (!allowEmpty) {
        const remote = await listCollection(table, { force: true }).catch(() => []);
        const remoteCount = Array.isArray(remote) ? remote.length : 0;
        throw new Error(`[DATA-SAFE] Chặn replaceCollection(${table}, []): server hiện có ${remoteCount} record. Muốn xoá toàn bộ phải truyền allowEmpty + reason rõ ràng.`);
      }
    }

    const rows = await listRows(table, { force: true });
    if (rows.length) await deleteRows(table, rows);
    const local = incoming.map(encodeItem);
    for (const encoded of local) await insertEncoded(table, encoded);
    invalidateTable(table);
    return true;
  }

  async function saveSingleton(table, key, data) {
    return syncCollection(table, [{ id: key, ...clonePlain(data) }]);
  }

  async function loadSingleton(table, key) {
    const rows = await listCollection(table);
    return rows.find(x => String(x?.id) === String(key)) || null;
  }

  return {
    listRows,
    listCollection,
    syncCollection,
    appendCollection,
    deleteKeys,
    replaceCollection,
    saveSingleton,
    loadSingleton,
    invalidateTable,
  };
})();
