const CATEGORY_LABELS = { new: "新機", new_ipad: "iPad", accessory: "配件", used: "二手" };
const MARKET_LABELS = {
  "": "全部",
  new: "全新",
  used: "二手",
  phone: "手機",
  tablet: "平板",
  accessory: "配件",
  wearable: "穿戴",
  computer: "電腦",
};
const TIMEZONE = "Asia/Taipei";

const CONDITION_OPTIONS = [
  { value: "new", label: "全新" },
  { value: "used", label: "二手" },
  { value: "refurbished", label: "整新" },
  { value: "unknown", label: "未知" },
];

const CAPACITY_OPTIONS = ["", "64", "128", "256", "512", "1T", "2T"];
const COLOR_OPTIONS = ["", "黑", "白", "金", "藍", "綠", "黃", "橘", "紫", "粉", "鈦", "原", "銀", "灰", "星光", "午夜"];

const FALLBACK_DEVICE_TYPES = [
  { code: "phone", label: "手機" },
  { code: "tablet", label: "平板" },
  { code: "accessory", label: "配件" },
  { code: "wearable", label: "穿戴" },
  { code: "computer", label: "電腦" },
];

const FALLBACK_BRANDS = [
  { code: "apple", name: "Apple" },
  { code: "samsung", name: "Samsung" },
  { code: "other", name: "其他" },
];

const dateSelect = document.getElementById("dateSelect");
const searchInput = document.getElementById("searchInput");
const marketFilter = document.getElementById("marketFilter");
const reloadBtn = document.getElementById("reloadBtn");
const tableBody = document.getElementById("tableBody");
const compactPriceList = document.getElementById("compactPriceList");
const priceTable = document.querySelector(".table-wrap table");
const summary = document.getElementById("summary");
const lastUpdated = document.getElementById("lastUpdated");
const categoryTabs = document.getElementById("categoryTabs");
const statMessages = document.getElementById("statMessages");
const statObservations = document.getElementById("statObservations");
const statRecords = document.getElementById("statRecords");
const statQuotes = document.getElementById("statQuotes");
const senderLeaderboard = document.getElementById("senderLeaderboard");
const modelLeaderboard = document.getElementById("modelLeaderboard");
const detailModal = document.getElementById("detailModal");
const detailTitle = document.getElementById("detailTitle");
const detailSubtitle = document.getElementById("detailSubtitle");
const detailStats = document.getElementById("detailStats");
const detailTicks = document.getElementById("detailTicks");
const detailClose = document.getElementById("detailClose");
const priceChartCanvas = document.getElementById("priceChart");
const discountChartCanvas = document.getElementById("discountChart");
const classifyCurrent = document.getElementById("classifyCurrent");
const classifyBaseModel = document.getElementById("classifyBaseModel");
const classifyCapacity = document.getElementById("classifyCapacity");
const classifyColor = document.getElementById("classifyColor");
const classifyBrand = document.getElementById("classifyBrand");
const classifyCondition = document.getElementById("classifyCondition");
const classifySave = document.getElementById("classifySave");
const classifyStatus = document.getElementById("classifyStatus");

let supabaseClient = null;
let allRows = [];
let dayTopPriceCounts = new Map();
let activeCategory = "new";
let activeMarketFilter = "";
let latestSyncTime = null;
let priceChart = null;
let discountChart = null;
let currentDetailRow = null;
let deviceTypes = [...FALLBACK_DEVICE_TYPES];
let brands = [...FALLBACK_BRANDS];
let catalogByCategory = {};
let modelCatalogLoaded = false;

function table(name) {
  const value = window[name];
  if (typeof value === "string" && value && !value.startsWith("你的")) return value;
  const fallbacks = {
    SUPABASE_TABLE: "iphone_prices",
    SUPABASE_STATS_TABLE: "daily_run_stats",
    SUPABASE_SENDER_STATS_TABLE: "sender_daily_stats",
    SUPABASE_PENDING_TABLE: "pending_quotes",
    SUPABASE_TICKS_TABLE: "quote_ticks",
    SUPABASE_MSRP_TABLE: "product_msrp",
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

function formatPrice(price) {
  return Number(price).toLocaleString("zh-TW");
}

function formatMaybePrice(price) {
  return price != null ? formatPrice(price) : "—";
}

function parseTimestamp(value) {
  if (!value) return null;
  const text = String(value).trim().replace(" ", "T");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatUpdatedAt(date) {
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-TW", {
    hour12: false, timeZone: TIMEZONE,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function inferCondition(row) {
  if (row.condition_state) return row.condition_state;
  if (row.category === "used") return "used";
  return "new";
}

function inferDeviceType(row) {
  if (row.device_type) return row.device_type;
  if (row.category === "new_ipad") return "tablet";
  if (row.category === "accessory") return "accessory";
  if (row.category === "used") {
    const key = String(row.model_key || row.model || "").toLowerCase();
    if (key.includes("ipad")) return "tablet";
    if (key.includes("airpods") || key.includes("watch")) return "wearable";
    if (key.includes("mac")) return "computer";
  }
  return "phone";
}

function rowMatchesMarketFilter(row) {
  const filter = activeMarketFilter;
  if (!filter) return true;
  if (filter === "new" || filter === "used") return inferCondition(row) === filter;
  return inferDeviceType(row) === filter;
}

function sortRowsForView(rows) {
  if (!activeMarketFilter) return rows;
  return [...rows].sort((a, b) => {
    const pa = a.top_price ?? Number.POSITIVE_INFINITY;
    const pb = b.top_price ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return (b.total_quotes || 0) - (a.total_quotes || 0);
  });
}

function deviceTypeLabel(code) {
  return deviceTypes.find((d) => d.code === code)?.label || code || "—";
}

function brandLabel(code) {
  return brands.find((b) => b.code === code)?.name || code || "—";
}

function conditionLabel(code) {
  return CONDITION_OPTIONS.find((c) => c.value === code)?.label || code || "—";
}

function fillSelect(el, options, selected) {
  if (!el) return;
  el.innerHTML = options.map((opt) => {
    const value = typeof opt === "string" ? opt : opt.value;
    const label = typeof opt === "string" ? opt : opt.label;
    const sel = value === selected ? " selected" : "";
    return `<option value="${value}"${sel}>${label}</option>`;
  }).join("");
}

async function loadTaxonomy() {
  const [{ data: dt, error: dtErr }, { data: br, error: brErr }] = await Promise.all([
    supabaseClient.from("device_types").select("code,label,sort_order").order("sort_order"),
    supabaseClient.from("brands").select("code,name,is_active").eq("is_active", true).order("name"),
  ]);
  if (!dtErr && dt?.length) deviceTypes = dt;
  if (!brErr && br?.length) brands = br;
}

function buildCatalogIndex(rows) {
  catalogByCategory = {};
  for (const row of rows) {
    const category = row.category || "new";
    if (!catalogByCategory[category]) {
      catalogByCategory[category] = { baseModels: new Set() };
    }
    const base = row.model || splitModelKey(row.model_key).model;
    if (base) catalogByCategory[category].baseModels.add(base);
  }
}

async function loadModelCatalog() {
  if (modelCatalogLoaded) return;
  const msrpTable = table("SUPABASE_MSRP_TABLE");
  const [{ data, error }, { data: msrpRows, error: msrpError }] = await Promise.all([
    supabaseClient.from(table("SUPABASE_TABLE")).select("category,model_key,model").order("model_key").limit(5000),
    supabaseClient.from(msrpTable).select("category,model_key").order("model_key"),
  ]);
  if (error) throw error;
  if (msrpError && msrpError.code !== "42P01") throw msrpError;
  const rows = [];
  const seen = new Set();
  for (const row of data || []) {
    const key = `${row.category}|${row.model_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  for (const row of msrpRows || []) {
    const key = `${row.category}|${row.model_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ category: row.category, model_key: row.model_key, model: splitModelKey(row.model_key).model });
  }
  buildCatalogIndex(rows);
  modelCatalogLoaded = true;
}

function getBaseModelsForCategory(category) {
  const fromCatalog = [...(catalogByCategory[category]?.baseModels || [])];
  const fromDay = [...new Set(
    allRows
      .filter((r) => r.category === category)
      .map((r) => r.model || splitModelKey(r.model_key).model)
      .filter(Boolean),
  )];
  return [...new Set([...fromCatalog, ...fromDay])].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function composeModelKey(baseModel, capacity, color) {
  if (!baseModel) return "";
  return `${baseModel}${capacity || ""}${color || ""}`.toLowerCase().replace(/\s/g, "");
}

function mergePriceStats(a, b) {
  const out = [...(a || [])];
  for (const item of b || []) {
    const hit = out.find((p) => p.price === item.price);
    if (hit) hit.count += item.count;
    else out.push({ ...item });
  }
  return out;
}

function pickTopPrice(priceStats) {
  if (!priceStats?.length) return null;
  return priceStats.reduce(
    (best, p) => (p.count > best.count || (p.count === best.count && p.price < best.price) ? p : best),
    priceStats[0],
  ).price;
}

function renderClassificationBadges(row) {
  const device = deviceTypeLabel(inferDeviceType(row));
  const brand = brandLabel(row.brand || "apple");
  const condition = conditionLabel(inferCondition(row));
  return `<div class="classify-badges">
    <span class="classify-badge">${device}</span>
    <span class="classify-badge">${brand}</span>
    <span class="classify-badge">${condition}</span>
  </div>`;
}

function populateClassifyForm(row) {
  const parts = splitModelKey(row.model_key);
  const baseModel = row.model || parts.model || "";
  const capacity = row.capacity || parts.capacity || "";
  const color = row.color || parts.color || "";
  const brand = row.brand || "apple";
  const condition = inferCondition(row);
  fillSelect(
    classifyBaseModel,
    [{ value: "", label: "請選型號" }, ...getBaseModelsForCategory(row.category).map((b) => ({ value: b, label: b }))],
    baseModel,
  );
  fillSelect(
    classifyCapacity,
    [{ value: "", label: "容量" }, ...CAPACITY_OPTIONS.filter(Boolean).map((c) => ({ value: c, label: c }))],
    capacity,
  );
  fillSelect(
    classifyColor,
    [{ value: "", label: "顏色" }, ...COLOR_OPTIONS.filter(Boolean).map((c) => ({ value: c, label: c }))],
    color,
  );
  fillSelect(
    classifyBrand,
    brands.map((b) => ({ value: b.code, label: b.name })),
    brand,
  );
  fillSelect(classifyCondition, CONDITION_OPTIONS, condition);
  if (classifyCurrent) {
    const spec = [baseModel, capacity, color].filter(Boolean).join(" ");
    classifyCurrent.textContent = `目前：${spec || row.model_key} · ${brandLabel(brand)} · ${conditionLabel(condition)}`;
  }
  if (classifyStatus) {
    classifyStatus.textContent = "";
    classifyStatus.className = "classify-status muted";
  }
}

function setClassifyStatus(message, kind = "") {
  if (!classifyStatus) return;
  classifyStatus.textContent = message;
  classifyStatus.className = `classify-status${kind ? ` ${kind}` : ""}`;
}

async function saveClassification(row) {
  if (!row) return;
  const quoteDate = dateSelect.value;
  if (!quoteDate) {
    setClassifyStatus("請先選擇日期", "error");
    return;
  }
  const parts = splitModelKey(row.model_key);
  const baseModel = (classifyBaseModel?.value || row.model || parts.model || "").trim();
  const capacity = classifyCapacity?.value ?? row.capacity ?? "";
  const color = classifyColor?.value ?? row.color ?? "";
  if (!baseModel) {
    setClassifyStatus("請選擇型號", "error");
    return;
  }
  const brand = classifyBrand?.value || row.brand || "apple";
  const condition = classifyCondition?.value || inferCondition(row);
  const tradeSide = row.trade_side || "sell";
  const oldModelKey = row.model_key;
  const newModelKey = composeModelKey(baseModel, capacity, color);
  const deviceType = inferDeviceType({ ...row, model_key: newModelKey, model: baseModel, category: row.category });
  const now = new Date().toISOString();
  const pricesTable = table("SUPABASE_TABLE");
  const ticksTable = table("SUPABASE_TICKS_TABLE") || "quote_ticks";

  setClassifyStatus("儲存中…");

  if (newModelKey !== oldModelKey) {
    const { data: existing, error: findError } = await supabaseClient
      .from(pricesTable)
      .select("id,price_stats,total_quotes,top_price,top_discount_zhe")
      .eq("quote_date", quoteDate)
      .eq("category", row.category)
      .eq("model_key", newModelKey)
      .eq("trade_side", tradeSide)
      .maybeSingle();
    if (findError) throw findError;

    if (existing && existing.id !== row.id) {
      const mergedStats = mergePriceStats(existing.price_stats, row.price_stats);
      const totalQuotes = mergedStats.reduce((s, p) => s + p.count, 0);
      const { error: mergeError } = await supabaseClient.from(pricesTable).update({
        price_stats: mergedStats,
        total_quotes: totalQuotes,
        top_price: pickTopPrice(mergedStats),
        device_type: deviceType,
        brand,
        condition_state: condition,
        model: baseModel,
        capacity,
        color,
        updated_at: now,
      }).eq("id", existing.id);
      if (mergeError) throw mergeError;
      const { error: deleteError } = await supabaseClient.from(pricesTable).delete().eq("id", row.id);
      if (deleteError) throw deleteError;
      row.id = existing.id;
    } else {
      const { error: priceError } = await supabaseClient.from(pricesTable).update({
        model_key: newModelKey,
        model: baseModel,
        capacity,
        color,
        device_type: deviceType,
        brand,
        condition_state: condition,
        updated_at: now,
      }).eq("id", row.id);
      if (priceError) throw priceError;
    }

    const { error: tickError } = await supabaseClient.from(ticksTable).update({
      model_key: newModelKey,
      model: baseModel,
      capacity,
      color,
      device_type: deviceType,
      brand,
      condition_state: condition,
    })
      .eq("quote_date", quoteDate)
      .eq("category", row.category)
      .eq("model_key", oldModelKey)
      .eq("trade_side", tradeSide);
    if (tickError) throw tickError;
  } else {
    const { error: priceError } = await supabaseClient.from(pricesTable).update({
      model: baseModel,
      capacity,
      color,
      device_type: deviceType,
      brand,
      condition_state: condition,
      updated_at: now,
    }).eq("id", row.id);
    if (priceError) throw priceError;

    const { error: tickError } = await supabaseClient.from(ticksTable).update({
      model: baseModel,
      capacity,
      color,
      device_type: deviceType,
      brand,
      condition_state: condition,
    })
      .eq("quote_date", quoteDate)
      .eq("category", row.category)
      .eq("model_key", oldModelKey)
      .eq("trade_side", tradeSide);
    if (tickError) throw tickError;
  }

  if (row.id) {
    const { error: overrideError } = await supabaseClient.from("classification_overrides").upsert({
      target_table: "iphone_prices",
      target_id: row.id,
      device_type_code: deviceType,
      brand_code: brand,
      condition_state: condition,
      model_display: baseModel,
      capacity,
      color,
      corrected_by: "main_board",
    }, { onConflict: "target_table,target_id" });
    if (overrideError) throw overrideError;
  }

  const oldId = row.id;
  row.model_key = newModelKey;
  row.model = baseModel;
  row.capacity = capacity;
  row.color = color;
  row.device_type = deviceType;
  row.brand = brand;
  row.condition_state = condition;
  currentDetailRow = row;

  const oldIdx = allRows.findIndex((r) => r.id === oldId);
  if (oldIdx >= 0) {
    if (newModelKey !== oldModelKey) {
      const dupIdx = allRows.findIndex((r) => r.id !== oldId && r.model_key === newModelKey && r.category === row.category && (r.trade_side || "sell") === tradeSide);
      if (dupIdx >= 0) allRows.splice(oldIdx, 1);
      else allRows[oldIdx] = { ...allRows[oldIdx], ...row };
    } else {
      allRows[oldIdx] = { ...allRows[oldIdx], ...row };
    }
  }

  populateClassifyForm(row);
  setClassifyStatus("已儲存分類（含當日 quote_ticks）", "ok");
  applyFilters();
}

function tradeSideTag(side) {
  if (side === "buy") return '<span class="side-tag side-buy">買單</span>';
  return '<span class="side-tag side-sell">賣單</span>';
}

const MODEL_COLOR_RE = /(黑|白|金|藍|綠|黃|橘|紫|粉|鈦|原|銀|灰|星光|午夜)$/;

function splitModelKey(modelKey) {
  const key = (modelKey || "").trim();
  const colorMatch = key.match(MODEL_COLOR_RE);
  const color = colorMatch ? colorMatch[1] : "";
  const body = color ? key.slice(0, -color.length) : key;
  const capMatch = body.match(/(64|128|256|512|1T|2T)$/i);
  const capacity = capMatch ? capMatch[1].toUpperCase() : "";
  const model = capacity ? body.slice(0, -capacity.length).trim() : body.trim();
  return { model, capacity, color };
}

function modelGroupKey(row) {
  return (row.model || splitModelKey(row.model_key).model || row.model_key || "").toLowerCase();
}

function modelGroupLabel(row) {
  return row.model || splitModelKey(row.model_key).model || row.model_key || "—";
}

function showCompactPriceView() {
  if (priceTable) priceTable.hidden = true;
  if (compactPriceList) compactPriceList.hidden = false;
}

function topPriceQuoteCount(row) {
  const top = row.top_price;
  if (top == null) return 0;
  const tickKey = rowCountKey(row.category, row.model_key, row.trade_side, Number(top));
  if (dayTopPriceCounts.has(tickKey)) {
    return dayTopPriceCounts.get(tickKey);
  }
  const hit = (row.price_stats || []).find((p) => Number(p.price) === Number(top));
  return hit?.count ?? 0;
}

function renderCompactPriceList(rows) {
  if (!compactPriceList) return;
  if (!rows.length) {
    compactPriceList.innerHTML = '<div class="compact-empty muted">這個分類今天沒有資料</div>';
    return;
  }

  const groups = new Map();
  for (const row of rows) {
    const key = modelGroupKey(row);
    if (!groups.has(key)) {
      groups.set(key, { label: modelGroupLabel(row), rows: [] });
    }
    groups.get(key).rows.push(row);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "zh-Hant"));
  compactPriceList.innerHTML = sortedGroups.map(([, group]) => {
    const sortedRows = [...group.rows].sort((a, b) => {
      const cap = String(a.capacity || "").localeCompare(String(b.capacity || ""), undefined, { numeric: true });
      if (cap) return cap;
      const color = String(a.color || "").localeCompare(String(b.color || ""), "zh-Hant");
      if (color) return color;
      return (a.top_price ?? Number.POSITIVE_INFINITY) - (b.top_price ?? Number.POSITIVE_INFINITY);
    });
    const rowsHtml = sortedRows.map((row) => {
      const index = rows.indexOf(row);
      const modelLabel = row.model || group.label;
      return `
      <div class="compact-row row-clickable" data-row-index="${index}" tabindex="0" role="button" aria-label="查看 ${modelLabel}">
        <span class="compact-model">${modelLabel}</span>
        <span class="compact-color">${row.color || "—"}</span>
        <span class="compact-capacity">${row.capacity || "—"}</span>
        <span class="compact-price">${formatMaybePrice(row.top_price)}<span class="compact-count">×${topPriceQuoteCount(row)}</span></span>
      </div>`;
    }).join("");

    return `
    <details class="model-group">
      <summary class="model-group-summary">
        <span class="model-group-name">${group.label}</span>
        <span class="model-group-meta">${sortedRows.length} 規格</span>
      </summary>
      <div class="model-group-body">
        <div class="compact-row compact-header">
          <span>型號</span><span>顏色</span><span>容量</span><span>價格</span>
        </div>
        ${rowsHtml}
      </div>
    </details>`;
  }).join("");
}

function renderPriceView(rows) {
  showCompactPriceView();
  renderCompactPriceList(rows);
}

function setPriceViewMessage(message, type = "muted") {
  showCompactPriceView();
  if (compactPriceList) {
    compactPriceList.innerHTML = `<div class="compact-empty ${type}">${message}</div>`;
  }
}

function renderPriceStats(priceStats) {
  if (!priceStats?.length) return '<span class="muted">無</span>';
  const visible = priceStats.slice(0, 3);
  const hiddenCount = priceStats.length - visible.length;
  const chips = visible.map((item) => {
    const discount = item.discount_zhe ? ` · ${item.discount_zhe}` : "";
    return `<span class="price-chip">${formatPrice(item.price)} × ${item.count}${discount}</span>`;
  }).join("");
  return hiddenCount > 0
    ? `${chips}<span class="price-chip more-chip">+${hiddenCount}</span>`
    : chips;
}

function formatShortTime(value) {
  const date = parseTimestamp(value);
  if (!date) return "—";
  return date.toLocaleString("zh-TW", {
    hour12: false,
    timeZone: TIMEZONE,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseDiscountNumber(text) {
  const match = String(text || "").match(/([\d.]+)/);
  return match ? Number(match[1]) : null;
}

function formatDiscountValue(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(2)}折`;
}

function formatDiscountLabel(text) {
  const num = parseDiscountNumber(text);
  if (num == null) return (text || "").trim() || "—";
  return formatDiscountValue(num);
}

function destroyCharts() {
  if (priceChart) {
    priceChart.destroy();
    priceChart = null;
  }
  if (discountChart) {
    discountChart.destroy();
    discountChart = null;
  }
}

function buildHighLowChart(ctx, labels, highs, lows, colors, yTickFormatter) {
  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "最高",
          data: highs,
          borderColor: colors.high,
          backgroundColor: `${colors.high}22`,
          tension: 0.2,
          pointRadius: 3,
          fill: false,
        },
        {
          label: "最低",
          data: lows,
          borderColor: colors.low,
          backgroundColor: `${colors.low}22`,
          tension: 0.2,
          pointRadius: 3,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: "top" } },
      scales: {
        y: {
          ticks: {
            callback: (value) => (yTickFormatter ? yTickFormatter(value) : value),
          },
        },
      },
    },
  });
}

function aggregateDaily(ticks) {
  const byDay = new Map();
  for (const t of ticks) {
    const day = String(t.quote_date || t.quoted_at || "").slice(0, 10);
    if (!day || t.price == null) continue;
    const bucket = byDay.get(day) || { high: -Infinity, low: Infinity, discountHigh: null, discountLow: null };
    bucket.high = Math.max(bucket.high, t.price);
    bucket.low = Math.min(bucket.low, t.price);
    const zhe = parseDiscountNumber(t.discount_zhe);
    if (zhe != null) {
      const rounded = Math.round(zhe * 100) / 100;
      bucket.discountHigh = bucket.discountHigh == null ? rounded : Math.max(bucket.discountHigh, rounded);
      bucket.discountLow = bucket.discountLow == null ? rounded : Math.min(bucket.discountLow, rounded);
    }
    byDay.set(day, bucket);
  }
  const days = [...byDay.keys()].sort();
  return days.map((day) => ({ day, ...byDay.get(day) }));
}

async function openDetailPanel(row) {
  if (!detailModal) return;
  await loadModelCatalog();
  currentDetailRow = row;
  populateClassifyForm(row);
  const classifyDetails = document.querySelector(".detail-classify-details");
  if (classifyDetails) classifyDetails.open = false;
  setClassifyStatus("");
  const label = [row.model || row.model_key, row.capacity, row.color].filter(Boolean).join(" ");
  detailTitle.textContent = label || row.model_key;
  detailSubtitle.textContent = `${CATEGORY_LABELS[row.category] || row.category} · ${row.trade_side === "buy" ? "買單" : "賣單"} · ${row.model_key}`;
  detailStats.innerHTML = `
    <div class="detail-stat"><span class="muted">建議售價</span><strong>${formatMaybePrice(row.msrp)}</strong></div>
    <div class="detail-stat"><span class="muted">今日熱門價</span><strong>${formatMaybePrice(row.top_price)}</strong></div>
    <div class="detail-stat"><span class="muted">目前折數</span><strong>${formatDiscountLabel(row.top_discount_zhe)}</strong></div>
  `;
  detailTicks.textContent = "載入中…";
  destroyCharts();
  detailModal.showModal();

  const selectedDate = dateSelect?.value || "";
  const ticksTable = table("SUPABASE_TICKS_TABLE") || "quote_ticks";
  let tickQuery = supabaseClient
    .from(ticksTable)
    .select("quoted_at,quote_date,price,discount_zhe,chat_name,sender_name,from_mid")
    .eq("category", row.category)
    .eq("model_key", row.model_key)
    .eq("trade_side", row.trade_side || "sell");
  if (selectedDate) {
    tickQuery = tickQuery.eq("quote_date", selectedDate);
  }
  const { data, error } = await tickQuery
    .order("quoted_at", { ascending: true })
    .limit(800);

  if (error) {
    detailTicks.innerHTML = `<span class="error">${error.message}</span>`;
    return;
  }

  const ticks = data || [];
  if (!ticks.length) {
    const dayHint = selectedDate ? `${selectedDate} ` : "";
    detailTicks.textContent = `${dayHint}尚無逐筆報價資料`;
    return;
  }

  const daily = aggregateDaily(ticks);
  const labels = daily.map((d) => d.day.slice(5));
  const highs = daily.map((d) => d.high);
  const lows = daily.map((d) => d.low);

  priceChart = buildHighLowChart(
    priceChartCanvas, labels, highs, lows,
    { high: "#dc2626", low: "#2563eb" },
    (v) => formatPrice(v),
  );

  const discountHighs = daily.map((d) => d.discountHigh);
  const discountLows = daily.map((d) => d.discountLow);
  if (discountHighs.some((v) => v != null)) {
    discountChart = buildHighLowChart(
      discountChartCanvas, labels, discountHighs, discountLows,
      { high: "#dc2626", low: "#047857" },
      (v) => formatDiscountValue(v),
    );
  }

  detailTicks.innerHTML = renderPriceCountStats(ticks);
}

const PRICE_PEOPLE_LIMIT = 30;

function personKeyFromTick(t) {
  return (t.from_mid || "").trim()
    || (t.sender_name || "").trim()
    || `${t.quoted_at || ""}`;
}

function rowCountKey(category, modelKey, tradeSide, price) {
  return `${category}|${(modelKey || "").trim()}|${tradeSide || "sell"}|${price}`;
}

function rebuildDayTopPriceCounts(ticks) {
  const byKey = new Map();
  for (const t of ticks || []) {
    if (t.price == null) continue;
    const modelKey = (t.model_key || "").trim();
    if (!modelKey) continue;
    const key = rowCountKey(t.category, modelKey, t.trade_side, Number(t.price));
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(personKeyFromTick(t));
  }
  dayTopPriceCounts = new Map([...byKey.entries()].map(([k, people]) => [k, people.size]));
}

function formatPersonLabel(t) {
  const mid = (t.from_mid || "").trim();
  const midShort = mid ? mid.slice(-8) : "—";
  const who = (t.sender_name || "").trim() || `未知(${midShort})`;
  const group = (t.chat_name || "").trim();
  return { who, group };
}

function buildPriceStatsBuckets(ticks) {
  const byPrice = new Map();
  for (const t of ticks) {
    if (t.price == null) continue;
    const price = Number(t.price);
    if (!byPrice.has(price)) {
      byPrice.set(price, { price, people: new Map(), discount: "" });
    }
    const bucket = byPrice.get(price);
    const pk = personKeyFromTick(t);
    const existing = bucket.people.get(pk);
    const ts = parseTimestamp(t.quoted_at)?.getTime() ?? 0;
    const existingTs = existing ? (parseTimestamp(existing.quoted_at)?.getTime() ?? 0) : -1;
    if (!existing || ts >= existingTs) {
      bucket.people.set(pk, t);
    }
    if (!bucket.discount && t.discount_zhe) bucket.discount = t.discount_zhe;
  }

  return [...byPrice.values()].map((b) => ({
    price: b.price,
    count: b.people.size,
    discount: b.discount,
    people: [...b.people.values()].sort(
      (a, c) => (parseTimestamp(c.quoted_at)?.getTime() ?? 0) - (parseTimestamp(a.quoted_at)?.getTime() ?? 0),
    ),
  })).sort((a, b) => b.price - a.price);
}

function renderPricePeopleList(people) {
  const visible = people.slice(0, PRICE_PEOPLE_LIMIT);
  const rest = people.length - visible.length;
  const rows = visible.map((t) => {
    const { who, group } = formatPersonLabel(t);
    const when = formatShortTime(t.quoted_at);
    const meta = [group, when].filter(Boolean).join(" · ");
    return `<div class="price-person-row"><span class="price-person-name">${who}</span><span class="price-person-meta muted">${meta || "—"}</span></div>`;
  }).join("");
  const more = rest > 0 ? `<div class="price-person-more muted">還有 ${rest} 人</div>` : "";
  return rows + more;
}

function renderPriceCountStats(ticks) {
  const stats = buildPriceStatsBuckets(ticks);
  if (!stats.length) return '<span class="muted">尚無報價統計</span>';

  return stats.map((s) => {
    const discount = s.discount ? `<span class="muted">${formatDiscountLabel(s.discount)}</span>` : "";
    const peopleHtml = s.count > 0
      ? `<div class="price-people-list">${renderPricePeopleList(s.people)}</div>`
      : "";
    return `
    <details class="price-count-item">
      <summary class="detail-tick-row price-count-row">
        <strong>${formatPrice(s.price)}</strong>
        <span class="count-badge">× ${s.count}</span>
        ${discount}
      </summary>
      ${peopleHtml}
    </details>`;
  }).join("");
}

function renderTable(rows) {
  if (!rows.length) {
    tableBody.innerHTML = '<tr><td colspan="9" class="muted">這個分類今天沒有資料</td></tr>';
    return;
  }
  tableBody.innerHTML = rows.map((row, index) => {
    const discount = (row.top_discount_zhe || "").trim() || "—";
    return `
    <tr class="data-row row-clickable" data-row-index="${index}" tabindex="0" role="button" aria-label="查看歷史走勢">
      <td data-label="方向">${tradeSideTag(row.trade_side || "sell")}</td>
      <td data-label="型號"><div class="model-name">${row.model || row.model_key}</div><div class="model-key">${row.model_key || ""}</div>${renderClassificationBadges(row)}<button type="button" class="btn-classify" data-row-index="${index}">修正分類</button></td>
      <td data-label="容量">${row.capacity || "—"}</td>
      <td data-label="顏色">${row.color || "—"}</td>
      <td data-label="建議售價">${formatMaybePrice(row.msrp)}</td>
      <td class="top-price" data-label="熱門價">${formatMaybePrice(row.top_price)}</td>
      <td class="discount-cell" data-label="目前折數">${discount}</td>
      <td data-label="總次數">${row.total_quotes ?? 0}</td>
      <td class="price-stats" data-label="價格分布">${renderPriceStats(row.price_stats)}</td>
    </tr>`;
  }).join("");
}

function updateLastUpdated(syncTime, selectedDate) {
  const formatted = syncTime ? formatUpdatedAt(syncTime) : "—";
  lastUpdated.textContent = selectedDate
    ? `${selectedDate} 最後同步：${formatted}`
    : `最後同步：${formatted}`;
}

async function fetchLatestSyncTime(selectedDate) {
  const statsTable = table("SUPABASE_STATS_TABLE");
  const { data: stats, error: statsError } = await supabaseClient
    .from(statsTable)
    .select("updated_at")
    .eq("quote_date", selectedDate)
    .maybeSingle();
  if (statsError) throw statsError;
  const statsTime = parseTimestamp(stats?.updated_at);
  if (statsTime) return statsTime;

  const { data: latestRow, error: rowError } = await supabaseClient
    .from(table("SUPABASE_TABLE"))
    .select("updated_at")
    .eq("quote_date", selectedDate)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rowError) throw rowError;
  return parseTimestamp(latestRow?.updated_at);
}

function renderSummary(rows, selectedDate) {
  const label = CATEGORY_LABELS[activeCategory] || activeCategory;
  summary.innerHTML = `<div class="summary-badge">${label}</div><div class="summary-text"><strong>${selectedDate}</strong> 共 <strong>${rows.length}</strong> 個商品規格</div>`;
}

function formatSenderDisplay(row) {
  const name = (row.sender_name || "").trim();
  const mid = (row.from_mid || "").trim();
  const midShort = mid ? mid.slice(-8) : "—";
  const who = name || `未知(${midShort})`;
  const group = (row.top_chat_name || row.chat_name || "").trim();
  return { who, group };
}

function senderRankTitle(row) {
  const parts = [];
  if (row.from_mid) parts.push(row.from_mid);
  const group = (row.top_chat_name || row.chat_name || "").trim();
  if (group) parts.push(`主要群組：${group}`);
  return parts.join(" · ");
}

function renderLeaderboards(senderRows, modelRows) {
  senderLeaderboard.innerHTML = senderRows.length
    ? senderRows.map((r) => {
      const { who } = formatSenderDisplay(r);
      return `<li><span class="rank-name" title="${senderRankTitle(r)}">${who}</span><span class="rank-meta">訊息 ${r.message_count} · 報價 ${r.quote_count}</span></li>`;
    }).join("")
    : '<li class="muted">尚無資料（需執行 migration + 重跑腳本）</li>';

  modelLeaderboard.innerHTML = modelRows.length
    ? modelRows.map((r) => `<li><span class="rank-name">${r.model_key}</span><span class="rank-meta">${r.total} 人</span></li>`).join("")
    : '<li class="muted">尚無資料</li>';
}

async function loadDashboard(selectedDate) {
  const statsTable = table("SUPABASE_STATS_TABLE");
  const senderTable = table("SUPABASE_SENDER_STATS_TABLE");
  const ticksTable = table("SUPABASE_TICKS_TABLE") || "quote_ticks";

  const [
    { data: stats, error: statsError },
    { data: senders, error: senderError },
    { data: ticks, error: ticksError },
  ] = await Promise.all([
    supabaseClient.from(statsTable).select("*").eq("quote_date", selectedDate).maybeSingle(),
    supabaseClient.from(senderTable).select("from_mid,sender_name,top_chat_name,message_count,quote_count").eq("quote_date", selectedDate).order("quote_count", { ascending: false }).limit(10),
    supabaseClient.from(ticksTable).select("category,model_key,trade_side,price,from_mid,sender_name").eq("quote_date", selectedDate).limit(10000),
  ]);

  rebuildDayTopPriceCounts(ticksError ? [] : (ticks || []));

  if (statsError?.code === "42P01") {
    statMessages.textContent = "—";
    statObservations.textContent = "—";
    statRecords.textContent = "—";
    statQuotes.textContent = "—";
    senderLeaderboard.innerHTML = '<li class="muted">資料表不存在，請在 Supabase 執行 supabase_migration_v2.sql</li>';
    renderLeaderboards([], buildModelRowsFromTicks(ticks));
    return;
  }
  if (statsError) throw statsError;
  if (senderError && senderError.code !== "42P01") throw senderError;
  if (ticksError && ticksError.code !== "42P01") throw ticksError;

  const modelRows = buildModelRowsFromTicks(ticks);

  if (!stats) {
    statMessages.textContent = "—";
    statObservations.textContent = "—";
    statRecords.textContent = "—";
    statQuotes.textContent = "—";
    senderLeaderboard.innerHTML = '<li class="muted">尚無同步紀錄（手機 run.py / config.py 需 v2 版，跑完應寫入 daily_run_stats）</li>';
    modelLeaderboard.innerHTML = modelRows.length
      ? modelRows.map((r) => `<li><span class="rank-name">${r.model_key}</span><span class="rank-meta">${r.total} 人</span></li>`).join("")
      : '<li class="muted">尚無資料</li>';
  } else {
    statMessages.textContent = stats.total_messages ?? "—";
    statObservations.textContent = stats.total_observations ?? "—";
    statRecords.textContent = stats.total_records ?? "—";
    statQuotes.textContent = stats.total_quotes ?? "—";
    renderLeaderboards(mergeSenderQuoteCounts(senders, ticks), modelRows);
  }
}

function buildModelRowsFromTicks(ticks) {
  const byModel = new Map();
  for (const t of ticks || []) {
    const modelKey = (t.model_key || "").trim();
    if (!modelKey) continue;
    if (!byModel.has(modelKey)) byModel.set(modelKey, new Set());
    byModel.get(modelKey).add(personKeyFromTick(t));
  }
  return [...byModel.entries()]
    .map(([model_key, people]) => ({ model_key, total: people.size }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

function buildSenderQuoteCountsFromTicks(ticks) {
  const bySender = new Map();
  for (const t of ticks || []) {
    const mid = (t.from_mid || "").trim();
    if (!mid) continue;
    const quoteKey = `${t.category}|${(t.model_key || "").trim()}|${t.trade_side || "sell"}|${t.price}`;
    if (!bySender.has(mid)) bySender.set(mid, new Set());
    bySender.get(mid).add(quoteKey);
  }
  return new Map([...bySender.entries()].map(([mid, quotes]) => [mid, quotes.size]));
}

function mergeSenderQuoteCounts(senderRows, ticks) {
  const counts = buildSenderQuoteCountsFromTicks(ticks);
  return (senderRows || [])
    .map((r) => {
      const mid = (r.from_mid || "").trim();
      const derived = counts.get(mid);
      return { ...r, quote_count: derived != null ? derived : (r.quote_count ?? 0) };
    })
    .sort((a, b) => (b.quote_count || 0) - (a.quote_count || 0));
}

function applyFilters() {
  const keyword = searchInput.value.trim().toLowerCase();
  const selectedDate = dateSelect.value;
  const filtered = sortRowsForView(allRows.filter((row) => {
    if (row.category !== activeCategory) return false;
    if (!rowMatchesMarketFilter(row)) return false;
    if (!keyword) return true;
    const haystack = [row.model, row.model_key, row.capacity, row.color, row.chat_name].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(keyword);
  }));
  window.filteredRows = filtered;
  renderPriceView(filtered);
  renderSummary(filtered, selectedDate);
  updateLastUpdated(latestSyncTime, selectedDate);
}

function setActiveCategory(category) {
  activeCategory = category;
  categoryTabs.querySelectorAll(".tab").forEach((btn) => {
    const on = btn.dataset.category === category;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  applyFilters();
}

async function loadAvailableDates() {
  const statsTable = table("SUPABASE_STATS_TABLE");
  const [{ data: priceDates, error: priceError }, { data: statDates, error: statError }] = await Promise.all([
    supabaseClient.from(table("SUPABASE_TABLE")).select("quote_date").order("quote_date", { ascending: false }),
    supabaseClient.from(statsTable).select("quote_date").order("quote_date", { ascending: false }),
  ]);
  if (priceError) throw priceError;
  if (statError && statError.code !== "42P01") throw statError;
  const dates = [...new Set([
    ...(priceDates || []).map((r) => r.quote_date),
    ...(statDates || []).map((r) => r.quote_date),
  ])].sort().reverse();
  dateSelect.innerHTML = dates.length ? "" : '<option value="">尚無資料</option>';
  for (const day of dates) {
    const opt = document.createElement("option");
    opt.value = day; opt.textContent = day;
    dateSelect.appendChild(opt);
  }
  if (dates.length) dateSelect.value = dates[0];
}

async function loadRowsForDate(selectedDate) {
  if (!selectedDate) return;
  setPriceViewMessage("載入中…");
  const { data, error } = await supabaseClient
    .from(table("SUPABASE_TABLE"))
    .select("id,category,model_key,model,capacity,color,msrp,top_discount_zhe,top_price,total_quotes,price_stats,trade_side,chat_name,updated_at,device_type,condition_state,brand")
    .eq("quote_date", selectedDate)
    .order("category").order("model_key");
  if (error) throw error;
  allRows = data || [];
  latestSyncTime = await fetchLatestSyncTime(selectedDate);
  await loadDashboard(selectedDate);
  if (!allRows.length) {
    const statsTable = table("SUPABASE_STATS_TABLE");
    const { data: stats } = await supabaseClient
      .from(statsTable)
      .select("total_messages,total_records,updated_at")
      .eq("quote_date", selectedDate)
      .maybeSingle();
    if (stats?.updated_at) {
      setPriceViewMessage(`手機已同步（${stats.total_messages ?? 0} 則訊息），報價尚在累積中；請稍後再刷新或先開 LINE 讓訊息同步。`);
    } else {
      setPriceViewMessage("這個分類今天沒有資料");
    }
  } else {
    applyFilters();
  }
  updateLastUpdated(latestSyncTime, selectedDate);
}

async function boot() {
  try {
    initClient();
    await loadTaxonomy();
    await loadModelCatalog();
    await loadAvailableDates();
    if (dateSelect.value) await loadRowsForDate(dateSelect.value);
  } catch (error) {
    setPriceViewMessage(error.message, "error");
  }
}

dateSelect.addEventListener("change", () => loadRowsForDate(dateSelect.value).catch((e) => {
  setPriceViewMessage(e.message, "error");
}));
categoryTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (btn) setActiveCategory(btn.dataset.category);
});
searchInput.addEventListener("input", applyFilters);
if (marketFilter) {
  marketFilter.addEventListener("change", () => {
    activeMarketFilter = marketFilter.value;
    applyFilters();
  });
}
reloadBtn.addEventListener("click", () => boot());

tableBody.addEventListener("click", (event) => {
  if (event.target.classList.contains("btn-classify")) {
    event.stopPropagation();
    const index = Number(event.target.dataset.rowIndex);
    const row = window.filteredRows?.[index];
    if (row) {
      openDetailPanel(row).catch((e) => {
        setClassifyStatus(e.message, "error");
      });
      classifyBaseModel?.focus();
    }
    return;
  }
  const rowEl = event.target.closest(".data-row");
  if (!rowEl) return;
  const index = Number(rowEl.dataset.rowIndex);
  const row = window.filteredRows?.[index];
  if (row) openDetailPanel(row).catch((e) => {
    detailTicks.innerHTML = `<span class="error">${e.message}</span>`;
  });
});

function openRowDetailFromIndex(index) {
  const row = window.filteredRows?.[index];
  if (!row) return;
  openDetailPanel(row).catch((e) => {
    detailTicks.innerHTML = `<span class="error">${e.message}</span>`;
  });
}

if (compactPriceList) {
  compactPriceList.addEventListener("click", (event) => {
    const rowEl = event.target.closest(".compact-row.row-clickable");
    if (!rowEl) return;
    event.preventDefault();
    openRowDetailFromIndex(Number(rowEl.dataset.rowIndex));
  });
  compactPriceList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const rowEl = event.target.closest(".compact-row.row-clickable");
    if (!rowEl) return;
    event.preventDefault();
    openRowDetailFromIndex(Number(rowEl.dataset.rowIndex));
  });
}

tableBody.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const rowEl = event.target.closest(".data-row");
  if (!rowEl) return;
  event.preventDefault();
  rowEl.click();
});

if (detailClose) {
  detailClose.addEventListener("click", () => {
    destroyCharts();
    currentDetailRow = null;
    detailModal.close();
  });
}
if (detailModal) {
  detailModal.addEventListener("click", (event) => {
    if (event.target === detailModal) {
      destroyCharts();
      currentDetailRow = null;
      detailModal.close();
    }
  });
}
if (classifySave) {
  classifySave.addEventListener("click", () => {
    saveClassification(currentDetailRow).catch((e) => setClassifyStatus(e.message, "error"));
  });
}

boot();
