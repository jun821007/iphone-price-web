const CATEGORY_LABELS = { new: "新機", new_ipad: "iPad", android: "Android", accessory: "配件", used: "二手" };
const TIMEZONE = "Asia/Taipei";
const MAX_MODELS = 10;
const LINE_COLORS = [
  "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed",
  "#db2777", "#0891b2", "#65a30d", "#ea580c", "#4f46e5",
];

const categoryTabs = document.getElementById("categoryTabs");
const tradeSideToggle = document.getElementById("tradeSideToggle");
const rangePresets = document.getElementById("rangePresets");
const dateStart = document.getElementById("dateStart");
const dateEnd = document.getElementById("dateEnd");
const modelSearch = document.getElementById("modelSearch");
const modelPicker = document.getElementById("modelPicker");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const applyBtn = document.getElementById("applyBtn");
const chartStatus = document.getElementById("chartStatus");
const priceChartCanvas = document.getElementById("priceChart");
const countChartCanvas = document.getElementById("countChart");

const priceChartPanel = document.getElementById("priceChartPanel");
const countChartTitle = document.getElementById("countChartTitle");
const countChartDesc = document.getElementById("countChartDesc");

let supabaseClient = null;
let activeCategory = "new";
let activeTradeSide = "sell";
let presetDays = 7;
let catalogModels = [];
let priceChart = null;
let countChart = null;

function table(name) {
  const value = window[name];
  if (typeof value === "string" && value && !value.startsWith("你的")) return value;
  const fallbacks = {
    SUPABASE_TABLE: "iphone_prices",
    SUPABASE_TICKS_TABLE: "quote_ticks",
    SUPABASE_BUY_DEMAND_TABLE: "buy_demand_ticks",
  };
  return fallbacks[name] || name;
}

function ensureConfig() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    throw new Error("請設定 config.js");
  }
  if (window.SUPABASE_URL.includes("你的專案") || window.SUPABASE_ANON_KEY.includes("你的anon")) {
    throw new Error("config.js 還是範例文字");
  }
}

function initClient() {
  ensureConfig();
  supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

function taipeiToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function addDays(isoDate, delta) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function enumerateDays(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function setStatus(text, kind = "") {
  if (!chartStatus) return;
  chartStatus.textContent = text;
  chartStatus.classList.remove("error");
  if (kind === "error") chartStatus.classList.add("error");
}

function formatPrice(price) {
  return Number(price).toLocaleString("zh-TW");
}

function formatDayLabel(iso) {
  return iso.slice(5);
}

function modelDisplayLabel(row) {
  const parts = [row.model || row.model_key, row.capacity, row.color].filter(Boolean);
  return parts.join(" ") || row.model_key;
}

function personKeyFromTick(t) {
  return (t.from_mid || "").trim()
    || (t.sender_name || "").trim()
    || `${t.quoted_at || ""}`;
}

function quoteCountKey(t) {
  return `${personKeyFromTick(t)}|${t.price}`;
}

function parseTickTime(t) {
  const raw = t.quoted_at || t.quote_date || "";
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function destroyChart(chart) {
  if (chart) chart.destroy();
  return null;
}

function registerFinancialCharts() {
  if (typeof Chart === "undefined") return;
  const fin = window.ChartFinancial || window["chartjs-chart-financial"];
  if (fin?.CandlestickController) {
    Chart.register(fin.CandlestickController, fin.CandlestickElement);
  }
}

function syncDateInputsFromPreset() {
  const end = dateEnd?.value || taipeiToday();
  const start = addDays(end, -(presetDays - 1));
  if (dateStart) dateStart.value = start;
  if (dateEnd) dateEnd.value = end;
}

function getDateRange() {
  const end = dateEnd?.value || taipeiToday();
  const start = dateStart?.value || addDays(end, -(presetDays - 1));
  if (start > end) return { start: end, end: start };
  return { start, end };
}

function filteredCatalog() {
  const kw = (modelSearch?.value || "").trim().toLowerCase();
  return catalogModels.filter((m) => {
    if (m.category !== activeCategory) return false;
    if (!kw) return true;
    const hay = [m.model, m.model_key, m.capacity, m.color].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(kw);
  });
}

function renderModelPicker() {
  const list = filteredCatalog();
  if (!list.length) {
    modelPicker.innerHTML = '<p class="muted">此區間尚無型號資料</p>';
    return;
  }
  const checkedKeys = new Set(
    [...modelPicker.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value),
  );
  modelPicker.innerHTML = list.map((m) => {
    const id = `m-${m.model_key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const checked = checkedKeys.has(m.model_key) ? "checked" : "";
    return `<label class="chart-model-item"><input type="checkbox" value="${m.model_key}" id="${id}" ${checked} /><span>${modelDisplayLabel(m)}</span><span class="muted chart-model-key">${m.model_key}</span></label>`;
  }).join("");
}

function getSelectedModelKeys() {
  return [...modelPicker.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
}

function selectAllVisible() {
  const boxes = [...modelPicker.querySelectorAll('input[type="checkbox"]')];
  boxes.forEach((el, i) => {
    el.checked = i < MAX_MODELS;
  });
  if (boxes.length > MAX_MODELS) {
    setStatus(`已選前 ${MAX_MODELS} 個型號（共 ${boxes.length} 個符合）`);
  }
}

function clearAllSelected() {
  modelPicker.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.checked = false; });
}

async function loadCatalogModels() {
  const { start, end } = getDateRange();
  if (activeTradeSide === "buy") {
    const demandTable = table("SUPABASE_BUY_DEMAND_TABLE");
    const { data, error } = await supabaseClient
      .from(demandTable)
      .select("model_key,model,capacity,color,category")
      .eq("category", activeCategory)
      .gte("quote_date", start)
      .lte("quote_date", end)
      .limit(8000);
    if (error) throw error;
    const byKey = new Map();
    for (const row of data || []) {
      const key = (row.model_key || "").trim();
      if (!key || byKey.has(key)) continue;
      byKey.set(key, {
        model_key: key,
        model: row.model || "",
        capacity: row.capacity || "",
        color: row.color || "",
        category: row.category,
      });
    }
    catalogModels = [...byKey.values()].sort((a, b) =>
      modelDisplayLabel(a).localeCompare(modelDisplayLabel(b), "zh-Hant"),
    );
    applyUrlPrefill();
    renderModelPicker();
    return;
  }

  const ticksTable = table("SUPABASE_TICKS_TABLE");
  const { data, error } = await supabaseClient
    .from(ticksTable)
    .select("model_key,model,capacity,color,category")
    .eq("category", activeCategory)
    .eq("trade_side", activeTradeSide)
    .gte("quote_date", start)
    .lte("quote_date", end)
    .limit(8000);
  if (error) throw error;

  const byKey = new Map();
  for (const row of data || []) {
    const key = (row.model_key || "").trim();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      model_key: key,
      model: row.model || "",
      capacity: row.capacity || "",
      color: row.color || "",
      category: row.category,
    });
  }
  catalogModels = [...byKey.values()].sort((a, b) =>
    modelDisplayLabel(a).localeCompare(modelDisplayLabel(b), "zh-Hant"),
  );
  applyUrlPrefill();
  renderModelPicker();
}

function syncBuyModeUi() {
  const isBuy = activeTradeSide === "buy";
  if (priceChartPanel) priceChartPanel.hidden = isBuy;
  if (countChartTitle) countChartTitle.textContent = isBuy ? "徵收人數走勢" : "報價次數 K 線";
  if (countChartDesc) {
    countChartDesc.textContent = isBuy
      ? "每日徵收人數（同人同規格只算 1 次）"
      : "每日總人次（同人同價只算 1 次）";
  }
}

function applyUrlPrefill() {
  const params = new URLSearchParams(window.location.search);
  const cat = params.get("category");
  const side = params.get("trade_side");
  const modelKey = params.get("model_key");
  if (cat && CATEGORY_LABELS[cat]) {
    activeCategory = cat;
    categoryTabs?.querySelectorAll(".tab").forEach((btn) => {
      const on = btn.dataset.category === cat;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }
  if (side === "buy" || side === "sell") {
    activeTradeSide = side;
    tradeSideToggle?.querySelectorAll(".segmented-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.side === side);
    });
    syncBuyModeUi();
  }
  if (modelKey && modelPicker) {
    renderModelPicker();
    const box = modelPicker.querySelector(`input[value="${CSS.escape(modelKey)}"]`);
    if (box) box.checked = true;
  }
}

function aggregatePriceOHLC(ticks, day) {
  const dayTicks = ticks
    .filter((t) => (t.quote_date || "").slice(0, 10) === day && t.price != null)
    .sort((a, b) => parseTickTime(a) - parseTickTime(b));
  if (!dayTicks.length) return null;
  const prices = dayTicks.map((t) => Number(t.price));
  return {
    o: prices[0],
    h: Math.max(...prices),
    l: Math.min(...prices),
    c: prices[prices.length - 1],
  };
}

function aggregateCountFlat(ticks, day) {
  const keys = new Set();
  for (const t of ticks) {
    if ((t.quote_date || "").slice(0, 10) !== day) continue;
    if (t.price == null) continue;
    keys.add(quoteCountKey(t));
  }
  if (!keys.size) return null;
  const n = keys.size;
  return { o: n, h: n, l: n, c: n };
}

function buildCloseLineDataset(label, days, dayMap, color) {
  return {
    label,
    data: days.map((day) => {
      const v = dayMap.get(day);
      return v ? v.c : null;
    }),
    borderColor: color,
    backgroundColor: `${color}22`,
    tension: 0.2,
    pointRadius: 3,
    spanGaps: true,
  };
}

function buildCountLineDataset(label, days, dayMap, color) {
  return {
    label,
    data: days.map((day) => {
      const v = dayMap.get(day);
      return v ? v.c : null;
    }),
    borderColor: color,
    backgroundColor: `${color}22`,
    tension: 0.2,
    pointRadius: 3,
    spanGaps: true,
  };
}

function renderCharts(modelSeries, days, isBuy = false) {
  priceChart = destroyChart(priceChart);
  countChart = destroyChart(countChart);

  const labels = days.map(formatDayLabel);
  const multi = modelSeries.length > 1;
  const countLabel = isBuy ? "人" : "次";

  if (!isBuy && multi) {
    priceChart = new Chart(priceChartCanvas, {
      type: "line",
      data: {
        labels,
        datasets: modelSeries.map((s, i) =>
          buildCloseLineDataset(s.label, days, s.priceByDay, LINE_COLORS[i % LINE_COLORS.length]),
        ),
      },
      options: chartOptions(true, (v) => formatPrice(v)),
    });
    countChart = new Chart(countChartCanvas, {
      type: "line",
      data: {
        labels,
        datasets: modelSeries.map((s, i) =>
          buildCountLineDataset(s.label, days, s.countByDay, LINE_COLORS[i % LINE_COLORS.length]),
        ),
      },
      options: chartOptions(true, (v) => `${v} ${countLabel}`),
    });
    return;
  }

  if (!isBuy && !multi) {
    const s = modelSeries[0];
    const priceDataset = days.map((day) => {
      const v = s.priceByDay.get(day);
      if (!v) return null;
      return { o: v.o, h: v.h, l: v.l, c: v.c };
    });
    const countDataset = days.map((day) => {
      const v = s.countByDay.get(day);
      if (!v) return null;
      return { o: v.o, h: v.h, l: v.l, c: v.c };
    });
    priceChart = new Chart(priceChartCanvas, {
      type: "candlestick",
      data: {
        labels,
        datasets: [{
          label: s.label,
          data: priceDataset,
          color: { up: "#dc2626", down: "#2563eb", unchanged: "#6b7280" },
        }],
      },
      options: chartOptions(false, (v) => formatPrice(v)),
    });
    countChart = new Chart(countChartCanvas, {
      type: "candlestick",
      data: {
        labels,
        datasets: [{
          label: s.label,
          data: countDataset,
          color: { up: "#059669", down: "#059669", unchanged: "#059669" },
        }],
      },
      options: chartOptions(false, (v) => `${v} ${countLabel}`),
    });
    return;
  }

  // 買單：只畫徵收人數（折線）
  countChart = new Chart(countChartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: modelSeries.map((s, i) =>
        buildCountLineDataset(s.label, days, s.countByDay, LINE_COLORS[i % LINE_COLORS.length]),
      ),
    },
    options: chartOptions(multi, (v) => `${v} 人`),
  });
}

function chartOptions(showLegend, yFormatter) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: showLegend, position: "top" },
      tooltip: {
        callbacks: {
          label(ctx) {
            const raw = ctx.raw;
            if (raw && raw.o != null) {
              return `${ctx.dataset.label || ""} O:${yFormatter(raw.o)} H:${yFormatter(raw.h)} L:${yFormatter(raw.l)} C:${yFormatter(raw.c)}`;
            }
            return `${ctx.dataset.label || ""}: ${yFormatter(ctx.parsed.y)}`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { maxRotation: 45, minRotation: 0 } },
      y: { ticks: { callback: (v) => yFormatter(v) } },
    },
  };
}

function aggregateDemandCountFlat(ticks, day) {
  const people = new Set();
  for (const t of ticks) {
    if ((t.quote_date || "").slice(0, 10) !== day) continue;
    people.add(personKeyFromTick(t));
  }
  if (!people.size) return null;
  const n = people.size;
  return { o: n, h: n, l: n, c: n };
}

async function fetchTicksForModels(modelKeys, start, end) {
  if (activeTradeSide === "buy") {
    const demandTable = table("SUPABASE_BUY_DEMAND_TABLE");
    const { data, error } = await supabaseClient
      .from(demandTable)
      .select("quote_date,quoted_at,from_mid,sender_name,model_key")
      .eq("category", activeCategory)
      .in("model_key", modelKeys)
      .gte("quote_date", start)
      .lte("quote_date", end)
      .order("quoted_at", { ascending: true })
      .limit(12000);
    if (error) throw error;
    return data || [];
  }

  const ticksTable = table("SUPABASE_TICKS_TABLE");
  const { data, error } = await supabaseClient
    .from(ticksTable)
    .select("quote_date,quoted_at,price,from_mid,sender_name,model_key")
    .eq("category", activeCategory)
    .eq("trade_side", activeTradeSide)
    .in("model_key", modelKeys)
    .gte("quote_date", start)
    .lte("quote_date", end)
    .order("quoted_at", { ascending: true })
    .limit(12000);
  if (error) throw error;
  return data || [];
}

async function drawCharts() {
  const selected = getSelectedModelKeys();
  if (!selected.length) {
    setStatus("請至少選擇一個型號", "error");
    return;
  }
  if (selected.length > MAX_MODELS) {
    setStatus(`最多 ${MAX_MODELS} 個型號，請減少選擇`, "error");
    return;
  }

  const { start, end } = getDateRange();
  const days = enumerateDays(start, end);
  setStatus("載入報價資料…");

  const ticks = await fetchTicksForModels(selected, start, end);
  const metaByKey = new Map(catalogModels.map((m) => [m.model_key, m]));
  const isBuy = activeTradeSide === "buy";
  const modelSeries = selected.map((key) => {
    const modelTicks = ticks.filter((t) => t.model_key === key);
    const priceByDay = new Map();
    const countByDay = new Map();
    for (const day of days) {
      if (!isBuy) {
        const ohlc = aggregatePriceOHLC(modelTicks, day);
        if (ohlc) priceByDay.set(day, ohlc);
      }
      const cnt = isBuy
        ? aggregateDemandCountFlat(modelTicks, day)
        : aggregateCountFlat(modelTicks, day);
      if (cnt) countByDay.set(day, cnt);
    }
    const meta = metaByKey.get(key) || { model_key: key };
    return { key, label: modelDisplayLabel(meta), priceByDay, countByDay };
  });

  const hasData = modelSeries.some((s) => (isBuy ? s.countByDay.size > 0 : s.priceByDay.size > 0));
  if (!hasData) {
    priceChart = destroyChart(priceChart);
    countChart = destroyChart(countChart);
    setStatus(
      `${start}～${end} 所選型號尚無${isBuy ? "徵收" : "報價"}資料`,
      "error",
    );
    return;
  }

  renderCharts(modelSeries, days, isBuy);
  const mode = isBuy
    ? "徵收人數"
    : (selected.length > 1 ? "收盤折線" : "K 線");
  setStatus(`已繪製 ${selected.length} 個型號（${start}～${end}，${mode}）`);
}

async function refreshCatalog() {
  try {
    setStatus("載入型號清單…");
    await loadCatalogModels();
    setStatus(`共 ${filteredCatalog().length} 個型號可選`);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

categoryTabs?.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  activeCategory = btn.dataset.category;
  categoryTabs.querySelectorAll(".tab").forEach((b) => {
    const on = b === btn;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  refreshCatalog();
});

tradeSideToggle?.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-btn");
  if (!btn) return;
  activeTradeSide = btn.dataset.side;
  tradeSideToggle.querySelectorAll(".segmented-btn").forEach((b) => {
    b.classList.toggle("active", b === btn);
  });
  syncBuyModeUi();
  refreshCatalog();
});

rangePresets?.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-btn");
  if (!btn) return;
  presetDays = Number(btn.dataset.days) || 7;
  rangePresets.querySelectorAll(".segmented-btn").forEach((b) => {
    b.classList.toggle("active", b === btn);
  });
  syncDateInputsFromPreset();
  refreshCatalog();
});

dateStart?.addEventListener("change", () => refreshCatalog());
dateEnd?.addEventListener("change", () => refreshCatalog());
modelSearch?.addEventListener("input", () => renderModelPicker());
selectAllBtn?.addEventListener("click", () => selectAllVisible());
clearAllBtn?.addEventListener("click", () => clearAllSelected());
applyBtn?.addEventListener("click", () => drawCharts().catch((e) => setStatus(e.message, "error")));

async function boot() {
  try {
    registerFinancialCharts();
    initClient();
    syncBuyModeUi();
    if (dateEnd) dateEnd.value = taipeiToday();
    syncDateInputsFromPreset();
    await refreshCatalog();
    const params = new URLSearchParams(window.location.search);
    if (params.get("model_key")) {
      await drawCharts();
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
}

boot();
