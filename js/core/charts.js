/* ============================================================================
 * VYKO MANUFACTURING ERP — BIỂU ĐỒ (Chart.js)
 * Mọi biểu đồ được đăng ký vào Charts.registry để:
 *   - hủy đúng cách khi chuyển module (tránh rò rỉ bộ nhớ / lỗi canvas)
 *   - vẽ lại toàn bộ khi người dùng đổi Dark mode
 * ==========================================================================*/
const Charts = (function () {
  const registry = new Map();   // canvasId -> { chart, factory }

  /** Lấy màu hiện hành từ CSS variable để biểu đồ khớp với theme */
  function css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function palette() {
    const dark = document.documentElement.dataset.theme === 'dark';
    return {
      dark,
      text:   css('--text-2', '#4b5a70'),
      muted:  css('--text-3', '#8593a8'),
      grid:   dark ? 'rgba(255,255,255,.07)' : 'rgba(15,27,51,.07)',
      surface: css('--surface', '#fff'),
      border: css('--border', '#e4e9f0'),
      blue:   css('--blue', '#2563eb'),
      green:  css('--green', '#15a34a'),
      orange: css('--orange', '#ea6a0c'),
      red:    css('--red', '#dc2626'),
      teal:   css('--teal', '#0d9488'),
      indigo: css('--indigo', '#5b48d6'),
      slate:  css('--slate', '#64748b'),
    };
  }

  /** Rút gọn tiền tệ cho trục biểu đồ: 4.860.000.000 -> 4,86 tỷ */
  function shortMoney(v) {
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2).replace('.', ',') + ' tỷ';
    if (Math.abs(v) >= 1e6) return Math.round(v / 1e6) + ' tr';
    if (Math.abs(v) >= 1e3) return Math.round(v / 1e3) + 'k';
    return String(v);
  }

  function baseOptions(p, opts = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 650, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: p.dark ? '#1c2745' : '#0f1b33',
          titleColor: '#fff', bodyColor: p.dark ? '#cfd9ea' : '#dbe4f2',
          borderColor: p.dark ? 'rgba(255,255,255,.12)' : 'transparent',
          borderWidth: 1, padding: 11, cornerRadius: 9, displayColors: true,
          boxWidth: 9, boxHeight: 9, boxPadding: 4,
          titleFont: { size: 12.5, weight: '700' }, bodyFont: { size: 12.5 },
          callbacks: opts.tooltipCallbacks || {},
        },
      },
      ...opts.extra,
    };
  }

  function axis(p, money) {
    return {
      x: {
        grid: { display: false, drawBorder: false },
        ticks: { color: p.muted, font: { size: 11.5 } },
        border: { color: p.grid },
      },
      y: {
        beginAtZero: true,
        grid: { color: p.grid, drawBorder: false },
        border: { display: false, dash: [4, 4] },
        ticks: {
          color: p.muted, font: { size: 11.5 }, padding: 6,
          callback: (v) => (money ? shortMoney(v) : v.toLocaleString('vi-VN')),
        },
      },
    };
  }

  /** Đăng ký + vẽ; factory nhận palette hiện tại và trả về config Chart.js */
  function mount(canvasId, factory) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === 'undefined') return null;
    if (registry.has(canvasId)) { registry.get(canvasId).chart.destroy(); }
    const chart = new Chart(el.getContext('2d'), factory(palette()));
    registry.set(canvasId, { chart, factory });
    return chart;
  }

  return {
    registry,
    palette,
    shortMoney,

    /** Hủy toàn bộ biểu đồ (gọi trước khi render module khác) */
    destroyAll() {
      registry.forEach((r) => r.chart.destroy());
      registry.clear();
    },

    /** Vẽ lại toàn bộ với bảng màu mới (dùng khi bật/tắt Dark mode) */
    retheme() {
      const items = [...registry.entries()];
      items.forEach(([id, r]) => {
        r.chart.destroy();
        const el = document.getElementById(id);
        if (!el) { registry.delete(id); return; }
        const chart = new Chart(el.getContext('2d'), r.factory(palette()));
        registry.set(id, { chart, factory: r.factory });
      });
    },

    /** Biểu đồ đường (doanh thu theo tháng) */
    line(canvasId, labels, data, { money = true, color, fill = true, label = 'Giá trị' } = {}) {
      return mount(canvasId, (p) => {
        const c = color || p.blue;
        return {
          type: 'line',
          data: {
            labels,
            datasets: [{
              label, data,
              borderColor: c, borderWidth: 2.6,
              pointBackgroundColor: p.surface, pointBorderColor: c, pointBorderWidth: 2.4,
              pointRadius: 4, pointHoverRadius: 6.5, tension: .38,
              fill,
              backgroundColor: (ctx) => {
                const { ctx: g, chartArea } = ctx.chart;
                if (!chartArea) return 'transparent';
                const grad = g.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                grad.addColorStop(0, c + (p.dark ? '55' : '38'));
                grad.addColorStop(1, c + '00');
                return grad;
              },
            }],
          },
          options: {
            ...baseOptions(p, {
              tooltipCallbacks: { label: (i) => ' ' + (money ? i.parsed.y.toLocaleString('vi-VN') + ' đ' : i.parsed.y.toLocaleString('vi-VN')) },
            }),
            scales: axis(p, money),
          },
        };
      });
    },

    /** Biểu đồ tròn khuyết (trạng thái đơn hàng) */
    donut(canvasId, labels, data, colorNames) {
      return mount(canvasId, (p) => ({
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: colorNames.map((n) => p[n] || n),
            borderColor: p.surface, borderWidth: 3, hoverOffset: 8,
          }],
        },
        options: {
          ...baseOptions(p, {
            extra: { cutout: '64%' },
            tooltipCallbacks: {
              label: (i) => {
                const tot = i.dataset.data.reduce((s, x) => s + x, 0);
                const pct = tot ? Math.round((i.parsed / tot) * 100) : 0;
                return ` ${i.label}: ${i.parsed} đơn (${pct}%)`;
              },
            },
          }),
        },
      }));
    },

    /** Biểu đồ cột (sản lượng phân xưởng, doanh thu…) */
    bar(canvasId, labels, datasets, { money = false, stacked = false, horizontal = false } = {}) {
      return mount(canvasId, (p) => {
        const ds = datasets.map((d) => ({
          label: d.label,
          data: d.data,
          backgroundColor: d.colorFn ? d.colorFn(p) : (p[d.color] || d.color || p.blue),
          borderRadius: 6, borderSkipped: false,
          barPercentage: .72, categoryPercentage: .72,
        }));
        const sc = axis(p, money);
        return {
          type: 'bar',
          data: { labels, datasets: ds },
          options: {
            ...baseOptions(p, {
              tooltipCallbacks: { label: (i) => ` ${i.dataset.label}: ${money ? i.parsed[horizontal ? 'x' : 'y'].toLocaleString('vi-VN') + ' đ' : i.parsed[horizontal ? 'x' : 'y'].toLocaleString('vi-VN')}` },
              extra: { indexAxis: horizontal ? 'y' : 'x' },
            }),
            scales: horizontal
              ? { x: { ...sc.y, beginAtZero: true }, y: { ...sc.x, stacked } }
              : { x: { ...sc.x, stacked }, y: { ...sc.y, stacked } },
          },
        };
      });
    },

    /** Sparkline SVG nhỏ trong KPI card (không dùng Chart.js cho nhẹ) */
    sparkline(values, tone = 'blue') {
      const w = 96, h = 40, pad = 3;
      const min = Math.min(...values), max = Math.max(...values);
      const span = max - min || 1;
      const pts = values.map((v, i) => {
        const x = pad + (i * (w - pad * 2)) / (values.length - 1 || 1);
        const y = h - pad - ((v - min) / span) * (h - pad * 2);
        return [x, y];
      });
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const area = d + ` L${w - pad} ${h} L${pad} ${h} Z`;
      const id = 'sg' + Math.random().toString(36).slice(2, 8);
      return `<svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--${tone})" stop-opacity=".28"/>
          <stop offset="100%" stop-color="var(--${tone})" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${area}" fill="url(#${id})"/>
        <path d="${d}" fill="none" stroke="var(--${tone})" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    },

    /** Vòng tròn tiến độ dạng SVG (dùng ở chi tiết lệnh sản xuất) */
    ring(percent, tone) {
      const t = tone || (percent >= 100 ? 'green' : percent >= 50 ? 'blue' : 'orange');
      const r = 50, c = 2 * Math.PI * r;
      const off = c - (Math.max(0, Math.min(100, percent)) / 100) * c;
      return `<svg viewBox="0 0 120 120" style="width:100%;height:100%;transform:rotate(-90deg)">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="11"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--${t})" stroke-width="11" stroke-linecap="round"
          stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
          style="transition:stroke-dashoffset .8s cubic-bezier(.4,0,.2,1)"/>
      </svg>`;
    },
  };
})();
