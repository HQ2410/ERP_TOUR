/* ============================================================================
 * NGÀY GIỜ CHI TIẾT (đợt 6) — CRM đơn hàng bán + lịch sử trạng thái sản phẩm
 * ----------------------------------------------------------------------------
 *  - Đơn hàng bán lưu thêm `orderedAt` (ISO) song song với `date` (YYYY-MM-DD, các báo cáo cũ vẫn dùng).
 *  - Giao dịch kho ghi thêm `createdAt` (ISO) → biết giờ nhập/xuất.
 *  - Chi tiết đơn hàng có mục "Lịch sử trạng thái sản phẩm" liệt kê từng lần thay đổi trạng thái kèm ngày giờ:
 *    đặt hàng, duyệt, sản xuất, QC, nhập kho, QC xuất kho, xuất kho, giao hàng, khách nhận hàng…
 * ========================================================================== */
(function () {
  'use strict';
  const p2 = (v) => String(v).padStart(2, '0');
  /** dd/mm/yyyy hh:mm khi có giờ, dd/mm/yyyy khi chỉ có ngày. */
  window.fmtDT = function (v) {
    if (!v) return '—'; const s = String(v);
    if (s.length <= 10) return typeof fmtDate === 'function' ? fmtDate(s) : s;
    const d = new Date(s); if (isNaN(d)) return typeof fmtDate === 'function' ? fmtDate(s.slice(0, 10)) : s;
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };
  /** ISO → giá trị cho <input type="datetime-local"> theo giờ địa phương. */
  window.toLocalDT = function (iso) {
    if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return String(iso).length === 10 ? String(iso) + 'T00:00' : '';
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };
  window.nowLocalDT = () => window.toLocalDT(new Date().toISOString());
  /** Giá trị datetime-local → ISO (UTC). Chỉ có ngày thì lấy 00:00 giờ địa phương. */
  window.localDTToIso = function (v) { if (!v) return ''; const s = String(v); const d = new Date(s.length === 10 ? s + 'T00:00' : s); return isNaN(d) ? '' : d.toISOString(); };

  const TX_LABEL = { RECEIPT: 'Nhập kho', PRODUCTION_RECEIPT: 'Nhập kho thành phẩm', SALES_ISSUE: 'Xuất kho bán hàng', PRODUCTION_ISSUE: 'Xuất kho sản xuất', TRANSFER_IN: 'Chuyển kho (nhập)', TRANSFER_OUT: 'Chuyển kho (xuất)', ADJUSTMENT: 'Điều chỉnh tồn', RETURN: 'Nhập trả hàng', DEFECT: 'Chuyển hàng lỗi' };
  function logisticsDeliveries(o) {
    try { const L = JSON.parse(localStorage.getItem('lenam_logistics_v2') || 'null'); return (L?.deliveries || []).filter((d) => d.orderId === o.id || d.id === o.logisticsDeliveryId); } catch (_) { return []; }
  }
  /** Gom mọi mốc thời gian thay đổi trạng thái liên quan tới đơn và từng sản phẩm của đơn. */
  function orderProductEvents(o) {
    const ev = []; const add = (at, label, extra = {}) => { if (at) ev.push({ at: String(at), label, ...extra }); };
    add(o.orderedAt || o.date, 'Đặt hàng', { icon: 'fa-file-signature' });
    add(o.approvedAt, 'Duyệt đơn và giữ chỗ tồn kho', { icon: 'fa-circle-check' });
    const pos = typeof Q !== 'undefined' && Q.posOfOrder ? Q.posOfOrder(o.id) : [];
    const refs = new Set([o.id]);
    pos.forEach((po) => {
      refs.add(po.id); const pid = po.productId;
      add(po.createdAt, `Tạo lệnh sản xuất ${po.id}`, { productId: pid, icon: 'fa-industry' }); add(po.approvedAt, `Duyệt lệnh sản xuất ${po.id}`, { productId: pid, icon: 'fa-industry' });
      add(po.materialIssuedAt, `Kho cấp nguyên vật liệu cho ${po.id}`, { productId: pid, icon: 'fa-boxes-stacked' });
      add((po.stages || []).map((s) => s.actualStartedAt).filter(Boolean).sort()[0], `Bắt đầu sản xuất ${po.id}`, { productId: pid, icon: 'fa-gears' });
      add(po.qcAt, `QC thành phẩm ${po.id}`, { productId: pid, icon: 'fa-clipboard-check' }); add(po.completedAt, `Hoàn thành sản xuất ${po.id}`, { productId: pid, icon: 'fa-flag-checkered' }); add(po.receivedAt, `Nhập kho thành phẩm ${po.id}`, { productId: pid, icon: 'fa-warehouse' });
    });
    (DB.productionFinalInspections || []).filter((i) => refs.has(i.poId)).forEach((i) => add(i.inspectedAt, `Phiếu QC thành phẩm ${i.id}: ${i.status === 'PASSED' || i.status === 'COMPLETED' ? 'đã kiểm' : (i.status || '')}`, { productId: i.productId, icon: 'fa-clipboard-check' }));
    const gis = (DB.goodsIssues || []).filter((g) => g.orderId === o.id || g.refDoc === o.id); gis.forEach((g) => { refs.add(g.id);
      add(g.qcRequestedAt, `Yêu cầu QC xuất kho (${g.id})`, { icon: 'fa-vial' }); add(g.qcInspectedAt, `QC xuất kho ${g.id}: ${g.qcStatus === 'FAILED' ? 'không đạt' : 'đạt'}`, { icon: 'fa-clipboard-check' }); add(g.confirmedAt, `Kho xuất hàng (${g.id})`, { icon: 'fa-box-open' }); });
    (DB.inventoryTransactions || []).filter((t) => refs.has(t.refId) || refs.has(t.transactionNumber)).forEach((t) => add(t.createdAt || t.date, `${TX_LABEL[t.type] || t.type}: ${Math.abs(Number(t.qty || 0)).toLocaleString('vi-VN')}${t.lotId ? ' · lô ' + (Q.lot?.(t.lotId)?.lotNumber || t.lotId) : ''}`, { productId: t.productId, icon: Number(t.qty) < 0 ? 'fa-arrow-up' : 'fa-arrow-down', kind: 'tx' }));
    logisticsDeliveries(o).forEach((d) => { add(d.dispatchedAt || d.departedAt || d.startedAt, `Xe xuất phát giao hàng (${d.id})`, { icon: 'fa-truck-fast' }); add(d.actualDelivered, `Giao hàng thành công (${d.id})`, { icon: 'fa-truck-ramp-box' }); add(d.customerReceivedAt, `Khách đã nhận hàng${d.customerReceiver ? ' · ' + d.customerReceiver : ''}`, { icon: 'fa-handshake' }); });
    add(o.completedAt, 'Hoàn tất đơn hàng', { icon: 'fa-circle-check' });
    const seen = new Set();
    return ev.filter((e) => { const k = e.at + '|' + e.label + '|' + (e.productId || ''); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  window.orderProductEvents = orderProductEvents;

  function productHistoryCard(o) {
    const events = orderProductEvents(o); const items = o.items || [];
    const ico = (e) => `<i class="fa-solid ${e.icon || 'fa-circle'}" style="width:18px;color:var(--text-3)"></i>`;
    const line = (e) => `<div style="display:grid;grid-template-columns:150px 1fr;gap:8px;padding:3px 0;border-bottom:1px dashed var(--border,#e3e8ef)"><span class="num cell-sub" style="font-weight:600">${esc(fmtDT(e.at))}</span><span>${ico(e)} ${esc(e.label)}</span></div>`;
    const blocks = items.map((it) => {
      const own = events.filter((e) => !e.productId || e.productId === it.productId);
      const last = own[own.length - 1];
      return `<div style="margin-bottom:12px"><div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><b>${esc(it.name || (Q.product?.(it.productId)?.name) || it.productId)}</b><span class="code">${esc(it.productId || '')}</span><span class="cell-sub">SL ${Number(it.qty || 0).toLocaleString('vi-VN')} ${esc(it.unit || '')}</span>${last ? `<span class="chip"><i class="fa-regular fa-clock"></i> ${esc(last.label)} · ${esc(fmtDT(last.at))}</span>` : ''}</div>${own.length ? own.map(line).join('') : '<div class="cell-sub">Chưa có lịch sử.</div>'}</div>`;
    }).join('');
    return `<div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Lịch sử trạng thái sản phẩm</h3><p>Ngày giờ từng lần sản phẩm trong đơn đổi trạng thái: sản xuất, QC, nhập kho, xuất kho, giao hàng</p></div></div><div style="padding:6px 4px">${blocks || '<div class="cell-sub">Đơn chưa có sản phẩm.</div>'}</div></div>`;
  }
  const _od = Views['order-detail'];
  if (typeof _od === 'function') { Views['order-detail'] = function (params) { const html = _od.apply(this, arguments); const o = Q.order(params?.id); return o ? html + productHistoryCard(o) : html; }; Views['order-detail'].after = _od.after; }
})();
