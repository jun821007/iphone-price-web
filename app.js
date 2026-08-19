const CATEGORY_LABELS = { new: "新機", new_ipad: "iPad", mac: "Mac", android: "Android", accessory: "配件", used: "二手" };
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
const marketFilter = document.getElementById("marketFilter");
const tableBody = document.getElementById("tableBody");
const compactPriceList = document.getElementById("compactPriceList");
const tradeSideToggle = document.getElementById("tradeSideToggle");
const priceTable = document.querySelector(".table-wrap table");
const summary = document.getElementById("summary");
const lastUpdated = document.getElementById("lastUpdated");
const categoryTabs = document.getElementById("categoryTabs");
const statMessages = document.getElementById("statMessages");
const statObservations = document.getElementById("statObservations");
const statRecords = document.getElementById("statRecords");
const statQuotes = document.getElementById("statQuotes");
const senderLeaderboard = document.getElementById("senderLeaderboard");
const senderLeaderboardSummary = document.getElementById("senderLeaderboardSummary");
const modelLeaderboard = document.getElementById("modelLeaderboard");
const modelLeaderboardSummary = document.getElementById("modelLeaderboardSummary");
const detailModal = document.getElementById("detailModal");
const detailTitle = document.getElementById("detailTitle");
const detailSubtitle = document.getElementById("detailSubtitle");
const detailStats = document.getElementById("detailStats");
const detailTicks = document.getElementById("detailTicks");
const detailTicksTitle = document.getElementById("detailTicksTitle");
const detailClose = document.getElementById("detailClose");
const detailChartLink = document.getElementById("detailChartLink");
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
let dayLowestDiscountBySpec = new Map();
let activeCategory = "new";
let activeTradeSide = "sell";
let activeMarketFilter = "";
let allBuyDemandRows = [];
let buyDemandTicks = [];
let latestSyncTime = null;
let currentDetailRow = null;
let currentSenderLeaderboardRows = [];
let currentModelLeaderboardRows = [];
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
    SUPABASE_BUY_DEMAND_TABLE: "buy_demand_ticks",
    SUPABASE_BUY_DEMAND_PENDING_TABLE: "buy_demand_pending",
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
  if (row.category === "mac") return "computer";
  if (row.category === "android") return "phone";
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

const MODEL_COLOR_RE = /(太空黑|太空灰|天藍|淺綠|薄荷綠|海藍|珊瑚紅|鈦灰|鈦黑|鈦銀|鈦藍|鈦金|鈦白|星光|午夜|薄荷|黑|白|金|藍|綠|黃|橘|紫|粉|鈦|原|銀|灰)$/;

const CAPACITY_ORDER = { "64": 0, "128": 1, "256": 2, "512": 3, "1T": 4, "2T": 5 };

function capacityRank(cap) {
  const key = String(cap || "").toUpperCase().replace("TB", "T");
  return CAPACITY_ORDER[key] ?? 99;
}

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

function ipadConnectionFromKey(modelKey) {
  const parts = String(modelKey || "").trim().split(/\s+/);
  const last = (parts[parts.length - 1] || "").toLowerCase();
  if (last === "lte") return "LTE";
  if (last === "wifi") return "WiFi";
  return "";
}

function ipadBaseModelName(row) {
  const name = row.model || splitModelKey(row.model_key).model || row.model_key || "";
  return name.replace(/\s*(WiFi|LTE)\s*$/i, "").trim();
}

function isWatchAccessoryRow(row) {
  const key = (row.model_key || "");
  if (/^(S11|SE|Ultra)/i.test(key)) return true;
  return inferDeviceType(row) === "wearable";
}

function watchConnectionFromKey(modelKey) {
  const key = String(modelKey || "");
  if (/LTE/i.test(key)) return "LTE";
  if (/GPS/i.test(key)) return "GPS";
  return "";
}

function watchBaseModelLabel(row) {
  const fromFields = `${row.model || ""} ${row.capacity || ""}`.trim();
  if (fromFields) return fromFields.replace(/\s*(GPS|LTE)\s*$/i, "").trim();
  const key = (row.model_key || "").replace(/(GPS|LTE).*/i, "").trim();
  return key || row.model_key || "";
}

function watchRowModelLabel(row) {
  if (!isWatchAccessoryRow(row)) {
    return row.model || splitModelKey(row.model_key).model || row.model_key || "—";
  }
  const base = watchBaseModelLabel(row);
  const conn = watchConnectionFromKey(row.model_key)
    || (/\bLTE\b/i.test(row.model || "") ? "LTE" : "")
    || (/\bGPS\b/i.test(row.model || "") ? "GPS" : "");
  if (conn) return `${base} ${conn}`;
  if (/^(S11|SE|Ultra)/i.test(row.model_key || "")) return `${base} GPS`;
  return base || row.model_key || "—";
}

function rowModelLabel(row) {
  if (row.category === "new_ipad") return ipadRowModelLabel(row);
  if (isWatchAccessoryRow(row)) return watchRowModelLabel(row);
  return row.model || splitModelKey(row.model_key).model || row.model_key || "—";
}

function ipadRowModelLabel(row) {
  if (row.category !== "new_ipad") {
    return row.model || splitModelKey(row.model_key).model || row.model_key || "—";
  }
  const base = ipadBaseModelName(row);
  const conn = ipadConnectionFromKey(row.model_key)
    || (/\blte\b/i.test(row.model || "") ? "LTE" : "")
    || (/\bwifi\b/i.test(row.model || "") ? "WiFi" : "");
  return conn ? `${base} ${conn}` : base;
}

function modelGroupKey(row) {
  if (row.category === "new_ipad") {
    return ipadBaseModelName(row).toLowerCase();
  }
  if (isWatchAccessoryRow(row)) {
    return watchBaseModelLabel(row).toLowerCase();
  }
  return (row.model || splitModelKey(row.model_key).model || row.model_key || "").toLowerCase();
}

function modelGroupLabel(row) {
  if (row.category === "new_ipad") {
    return ipadBaseModelName(row) || "—";
  }
  if (isWatchAccessoryRow(row)) {
    return watchBaseModelLabel(row) || "—";
  }
  return row.model || splitModelKey(row.model_key).model || row.model_key || "—";
}

function showCompactPriceView() {
  if (priceTable) priceTable.hidden = true;
  if (compactPriceList) compactPriceList.hidden = false;
}

function aggregateBuyDemandRows(ticks) {
  const bySpec = new Map();
  for (const t of ticks || []) {
    const modelKey = (t.model_key || "").trim();
    if (!modelKey) continue;
    const specKey = `${t.category}|${modelKey}`;
    if (!bySpec.has(specKey)) {
      bySpec.set(specKey, {
        category: t.category,
        model_key: modelKey,
        model: t.model || "",
        capacity: t.capacity || "",
        color: t.color || "",
        trade_side: "buy",
        spec_clear: t.spec_clear !== false,
        seekers: new Map(),
      });
    }
    const bucket = bySpec.get(specKey);
    if (t.spec_clear === false) bucket.spec_clear = false;
    bucket.seekers.set(personKeyFromTick(t), t);
  }
  return [...bySpec.values()].map((b) => ({
    ...b,
    seeker_count: b.seekers.size,
    total_quotes: b.seekers.size,
  }));
}

function renderBuyDemandList(rows) {
  if (!compactPriceList) return;
  if (!rows.length) {
    compactPriceList.innerHTML = '<div class="compact-empty muted">這個分類今天沒有徵收需求</div>';
    return;
  }

  const sorted = [...rows].sort((a, b) => {
    const diff = (b.seeker_count || 0) - (a.seeker_count || 0);
    if (diff) return diff;
    return String(a.model_key).localeCompare(String(b.model_key), "zh-Hant");
  });

  const groups = new Map();
  for (const row of sorted) {
    const key = modelGroupKey(row);
    if (!groups.has(key)) {
      groups.set(key, { label: modelGroupLabel(row), rows: [] });
    }
    groups.get(key).rows.push(row);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const maxA = Math.max(...a[1].rows.map((r) => r.seeker_count || 0));
    const maxB = Math.max(...b[1].rows.map((r) => r.seeker_count || 0));
    if (maxB !== maxA) return maxB - maxA;
    return a[1].label.localeCompare(b[1].label, "zh-Hant");
  });

  compactPriceList.innerHTML = sortedGroups.map(([, group]) => {
    const groupRows = [...group.rows].sort((a, b) => {
      const cap = capacityRank(a.capacity) - capacityRank(b.capacity);
      if (cap) return cap;
      return String(a.color || "").localeCompare(String(b.color || ""), "zh-Hant");
    });
    const rowsHtml = groupRows.map((row) => {
      const index = rows.indexOf(row);
      const modelLabel = rowModelLabel(row);
      const specBadge = row.spec_clear
        ? ""
        : '<span class="spec-unclear-tag">規格未明</span>';
      return `
      <div class="compact-row row-clickable" data-row-index="${index}" tabindex="0" role="button" aria-label="查看 ${modelLabel}">
        <span class="compact-model">${modelLabel}${specBadge}</span>
        <span class="compact-capacity">${row.capacity || "—"}</span>
        <span class="compact-color">${row.color || "—"}</span>
        <span class="compact-price compact-demand-count"><span class="compact-count">×${row.seeker_count || 0}</span> 人</span>
        <span class="compact-discount-low muted">—</span>
      </div>`;
    }).join("");

    return `
    <details class="model-group" open>
      <summary class="model-group-summary">
        <span class="model-group-name">${group.label}</span>
        <span class="model-group-meta">${group.rows.length} 規格</span>
      </summary>
      <div class="model-group-body">
        <div class="compact-row compact-header compact-header--buy">
          <span>型號</span><span>容量</span><span>顏色</span><span>徵收人數</span><span></span>
        </div>
        ${rowsHtml}
      </div>
    </details>`;
  }).join("");
}

function lowestDiscountLabelForRow(row) {
  const specKey = `${row.category}|${row.model_key}|${row.trade_side || "sell"}`;
  const zhe = dayLowestDiscountBySpec.get(specKey);
  if (zhe != null) return formatDiscountValue(zhe);
  return "—";
}

function renderCompactPriceList(rows) {
  const specKey = `${row.category}|${row.model_key}|${row.trade_side || "sell"}`;
  const zhe = dayLowestDiscountBySpec.get(specKey);
  if (zhe != null) return formatDiscountValue(zhe);
  return "—";
}

function rebuildDayLowestDiscount(ticks, rows) {
  const msrpBySpec = new Map();
  for (const r of rows || []) {
    const key = `${r.category}|${r.model_key}|${r.trade_side || "sell"}`;
    if (r.msrp) msrpBySpec.set(key, Number(r.msrp));
  }

  const bySpec = new Map();
  for (const t of ticks || []) {
    const modelKey = (t.model_key || "").trim();
    if (!modelKey) continue;
    const specKey = `${t.category}|${modelKey}|${t.trade_side || "sell"}`;
    let zhe = parseDiscountNumber(t.discount_zhe);
    if (zhe == null && t.price != null) {
      const msrp = msrpBySpec.get(specKey);
      if (msrp) zhe = Number(t.price) / msrp * 10;
    }
    if (zhe == null) continue;
    const cur = bySpec.get(specKey);
    if (cur == null || zhe < cur) bySpec.set(specKey, zhe);
  }

  for (const r of rows || []) {
    const specKey = `${r.category}|${r.model_key}|${r.trade_side || "sell"}`;
    if (bySpec.has(specKey)) continue;
    const msrp = Number(r.msrp);
    if (!msrp) continue;
    for (const p of r.price_stats || []) {
      let zhe = parseDiscountNumber(p.discount_zhe);
      if (zhe == null && p.price != null) zhe = Number(p.price) / msrp * 10;
      if (zhe == null) continue;
      const cur = bySpec.get(specKey);
      if (cur == null || zhe < cur) bySpec.set(specKey, zhe);
    }
  }

  dayLowestDiscountBySpec = bySpec;
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
  compactPriceList.classList.remove("compact-list--used-weekly");
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
      const cap = capacityRank(a.capacity) - capacityRank(b.capacity);
      if (cap) return cap;
      const color = String(a.color || "").localeCompare(String(b.color || ""), "zh-Hant");
      if (color) return color;
      return (a.top_price ?? Number.POSITIVE_INFINITY) - (b.top_price ?? Number.POSITIVE_INFINITY);
    });
    const rowsHtml = sortedRows.map((row) => {
      const index = rows.indexOf(row);
      const modelLabel = rowModelLabel(row);
      return `
      <div class="compact-row row-clickable" data-row-index="${index}" tabindex="0" role="button" aria-label="查看 ${modelLabel}">
        <span class="compact-model">${modelLabel}</span>
        <span class="compact-capacity">${row.capacity || "—"}</span>
        <span class="compact-color">${row.color || "—"}</span>
        <span class="compact-price">${formatMaybePrice(row.top_price)}<span class="compact-count">×${topPriceQuoteCount(row)}</span></span>
        <span class="compact-discount-low">${lowestDiscountLabelForRow(row)}</span>
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
          <span>型號</span><span>容量</span><span>顏色</span><span>價格</span><span>最低折</span>
        </div>
        ${rowsHtml}
      </div>
    </details>`;
  }).join("");
}

function renderPriceView(rows) {
  showCompactPriceView();
  if (activeTradeSide === "buy") {
    renderBuyDemandList(rows);
  } else {
    renderCompactPriceList(rows);
  }
  applyModelGroupsExpandState();
}

/** null = 依 HTML 預設；true/false = 使用者按過全展開/收折 */
let modelGroupsExpandPreference = null;

function applyModelGroupsExpandState() {
  if (!compactPriceList) return;
  const groups = compactPriceList.querySelectorAll("details.model-group");
  if (modelGroupsExpandPreference !== null) {
    groups.forEach((el) => {
      el.open = modelGroupsExpandPreference;
    });
  }
  updateExpandAllButtonLabel();
}

function updateExpandAllButtonLabel() {
  const btn = document.getElementById("expandAllBtn");
  if (!btn) return;
  const groups = compactPriceList?.querySelectorAll("details.model-group") || [];
  if (!groups.length) {
    btn.disabled = true;
    btn.textContent = "全展開";
    return;
  }
  btn.disabled = false;
  const allOpen = [...groups].every((g) => g.open);
  btn.textContent = allOpen ? "收折" : "全展開";
  btn.setAttribute("aria-expanded", allOpen ? "true" : "false");
}

function toggleAllModelGroups() {
  const groups = [...(compactPriceList?.querySelectorAll("details.model-group") || [])];
  if (!groups.length) return;
  const expand = !groups.every((g) => g.open);
  modelGroupsExpandPreference = expand;
  groups.forEach((el) => {
    el.open = expand;
  });
  updateExpandAllButtonLabel();
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

function updateDetailChartLink(row) {
  if (!detailChartLink || !row) return;
  const params = new URLSearchParams({
    category: row.category || "new",
    trade_side: row.trade_side || "sell",
    model_key: row.model_key || "",
  });
  detailChartLink.href = `chart.html?${params.toString()}`;
}

async function openDetailPanel(row) {
  if (!detailModal) return;
  const isBuy = row.trade_side === "buy" || activeTradeSide === "buy";
  await loadModelCatalog();
  currentDetailRow = row;
  document.querySelector(".detail-classify")?.removeAttribute("hidden");
  detailChartLink?.closest(".detail-chart-link-wrap")?.removeAttribute("hidden");
  if (detailTicksTitle) {
    detailTicksTitle.textContent = isBuy ? "當日徵收紀錄" : "當日報價統計次數（同一人不累加）";
  }
  if (!isBuy) {
    populateClassifyForm(row);
  }
  const classifyDetails = document.querySelector(".detail-classify-details");
  if (classifyDetails) classifyDetails.open = false;
  setClassifyStatus("");
  const label = [rowModelLabel(row), row.capacity, row.color].filter(Boolean).join(" ");
  detailTitle.textContent = label || row.model_key;
  const specNote = isBuy && row.spec_clear === false ? " · 規格未明" : "";
  detailSubtitle.textContent = `${CATEGORY_LABELS[row.category] || row.category} · ${isBuy ? "買單徵收" : "賣單"} · ${row.model_key}${specNote}`;
  if (isBuy) {
    detailStats.innerHTML = `
      <div class="detail-stat"><span class="muted">徵收人數</span><strong>${row.seeker_count ?? 0} 人</strong></div>
      <div class="detail-stat"><span class="muted">規格狀態</span><strong>${row.spec_clear === false ? "規格未明" : "已辨識"}</strong></div>
    `;
  } else {
    detailStats.innerHTML = `
      <div class="detail-stat"><span class="muted">建議售價</span><strong>${formatMaybePrice(row.msrp)}</strong></div>
      <div class="detail-stat"><span class="muted">今日熱門價</span><strong>${formatMaybePrice(row.top_price)}</strong></div>
      <div class="detail-stat"><span class="muted">目前折數</span><strong>${formatDiscountLabel(row.top_discount_zhe)}</strong></div>
    `;
  }
  detailTicks.textContent = "載入中…";
  updateDetailChartLink(row);
  detailModal.showModal();

  const selectedDate = dateSelect?.value || "";
  if (isBuy) {
    const demandTable = table("SUPABASE_BUY_DEMAND_TABLE");
    let tickQuery = supabaseClient
      .from(demandTable)
      .select("quoted_at,quote_date,chat_name,sender_name,from_mid,raw_line,intent_keyword,spec_clear")
      .eq("category", row.category)
      .eq("model_key", row.model_key);
    if (selectedDate) tickQuery = tickQuery.eq("quote_date", selectedDate);
    const { data, error } = await tickQuery.order("quoted_at", { ascending: false }).limit(200);
    if (error) {
      detailTicks.innerHTML = `<span class="error">${error.message}</span>`;
      return;
    }
    const ticks = data || [];
    if (!ticks.length) {
      detailTicks.textContent = `${selectedDate} 尚無徵收紀錄`;
      return;
    }
    detailTicks.innerHTML = ticks.map((t) => {
      const { who, group } = formatPersonLabel(t);
      const when = formatShortTime(t.quoted_at);
      const kw = t.intent_keyword ? `「${t.intent_keyword}」` : "";
      const line = (t.raw_line || "").trim();
      return `<div class="detail-tick-row demand-person-row"><strong>${who}</strong><span class="muted">${[group, when, kw].filter(Boolean).join(" · ")}</span>${line ? `<div class="demand-raw-line muted">${line}</div>` : ""}</div>`;
    }).join("");
    return;
  }

  const ticksTable = table("SUPABASE_TICKS_TABLE") || "quote_ticks";
  let tickQuery = supabaseClient
    .from(ticksTable)
    .select("quoted_at,quote_date,price,discount_zhe,chat_name,sender_name,from_mid,raw_line")
    .eq("category", row.category)
    .eq("model_key", row.model_key)
    .eq("trade_side", row.trade_side || "sell")
    .eq("excluded", false);
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
    detailTicks.textContent = `${selectedDate} 尚無逐筆報價資料`;
    return;
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
    const line = (t.raw_line || "").trim();
    const rawHtml = line
      ? `<div class="demand-raw-line muted">${escapeHtml(line)}</div>`
      : '<div class="demand-raw-line muted">—</div>';
    return `<div class="price-person-row"><span class="price-person-name">${escapeHtml(who)}</span><span class="price-person-meta muted">${escapeHtml(meta || "—")}</span>${rawHtml}</div>`;
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
  const sideLabel = activeTradeSide === "buy" ? "徵收熱款" : "商品規格";
  const totalSeekers = activeTradeSide === "buy"
    ? rows.reduce((sum, r) => sum + (r.seeker_count || 0), 0)
    : 0;
  const extra = activeTradeSide === "buy" && totalSeekers
    ? ` · 合計 <strong>${totalSeekers}</strong> 人次（同人同規格只算 1）`
    : "";
  summary.innerHTML = `<div class="summary-badge">${label} · ${sideLabel}</div><div class="summary-text"><strong>${selectedDate}</strong> 共 <strong>${rows.length}</strong> 個型號規格${extra}</div><button type="button" id="expandAllBtn" class="btn-expand-all" aria-expanded="false">全展開</button>`;
  updateExpandAllButtonLabel();
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function groupSenderMessages(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = row.message_id != null && row.message_id !== ""
      ? String(row.message_id)
      : `${row.quoted_at || ""}|${row.raw_line || ""}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.values()];
}

function renderGroupedMessagesHtml(messages, isBuy) {
  return messages.map((items) => {
    const first = items[0];
    const { who } = formatPersonLabel(first);
    const meta = [who, first.chat_name, formatShortTime(first.quoted_at)].filter(Boolean).map(escapeHtml).join(" · ");
    if (isBuy) {
      const rawLines = [...new Set(items.map((item) => (item.raw_line || "").trim()).filter(Boolean))];
      const models = [...new Set(items.map((item) => item.model_key).filter(Boolean))];
      const content = rawLines.length ? rawLines : models;
      return `<div class="detail-tick-row sender-message-row"><span class="muted">${meta}</span>${content.map((line) => `<div class="sender-message-line">${escapeHtml(line)}</div>`).join("")}</div>`;
    }
    const saleLines = items.map((item) => {
      const spec = [item.model || item.model_key, item.capacity, item.color].filter(Boolean).join(" ");
      return `${spec || item.model_key || "未辨識型號"}${item.price != null ? `　$${formatPrice(item.price)}` : ""}`;
    });
    return `<div class="detail-tick-row sender-message-row"><span class="muted">${meta}</span>${saleLines.map((line) => `<div class="sender-message-line">${escapeHtml(line)}</div>`).join("")}</div>`;
  }).join("");
}

async function loadTradeMessages({ isBuy, selectedDate, fromMid, modelKey, category }) {
  const sourceTable = isBuy
    ? table("SUPABASE_BUY_DEMAND_TABLE")
    : (table("SUPABASE_TICKS_TABLE") || "quote_ticks");
  const columns = isBuy
    ? "quoted_at,message_id,chat_name,sender_name,from_mid,raw_line,intent_keyword,category,model_key,model,capacity,color,spec_clear"
    : "quoted_at,message_id,chat_name,sender_name,from_mid,category,model_key,model,capacity,color,price,trade_side";
  let query = supabaseClient.from(sourceTable).select(columns);
  if (selectedDate) query = query.eq("quote_date", selectedDate);
  if (!isBuy) { query = query.eq("trade_side", "sell").eq("excluded", false); }
  if (fromMid) query = query.eq("from_mid", fromMid);
  if (modelKey) query = query.eq("model_key", modelKey);
  if (category) query = query.eq("category", category);
  return query.order("quoted_at", { ascending: false }).limit(800);
}

async function openSenderDetail(row) {
  if (!detailModal || !row?.from_mid) return;
  const isBuy = activeTradeSide === "buy";
  const selectedDate = dateSelect?.value || "";
  const { who, group } = formatSenderDisplay(row);
  currentDetailRow = null;
  document.querySelector(".detail-classify")?.setAttribute("hidden", "");
  detailChartLink?.closest(".detail-chart-link-wrap")?.setAttribute("hidden", "");
  detailTitle.textContent = who;
  detailSubtitle.textContent = [selectedDate, isBuy ? "買單徵收訊息" : "賣貨報價訊息", group].filter(Boolean).join(" · ");
  detailStats.innerHTML = `
    <div class="detail-stat"><span class="muted">訊息數</span><strong>${row.message_count ?? 0}</strong></div>
    <div class="detail-stat"><span class="muted">${isBuy ? "徵收規格" : "報價規格"}</span><strong>${row.quote_count ?? 0}</strong></div>
  `;
  if (detailTicksTitle) detailTicksTitle.textContent = isBuy ? "當日徵收訊息" : "當日賣貨報價";
  detailTicks.textContent = "載入中…";
  detailModal.showModal();

  const { data, error } = await loadTradeMessages({
    isBuy,
    selectedDate,
    fromMid: row.from_mid,
  });
  if (error) {
    detailTicks.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
    return;
  }

  const messages = groupSenderMessages(data || []);
  if (!messages.length) {
    detailTicks.textContent = `${selectedDate} 尚無${isBuy ? "徵收" : "賣貨"}訊息`;
    return;
  }
  detailTicks.innerHTML = renderGroupedMessagesHtml(messages, isBuy);
}

async function openModelDetail(row) {
  if (!detailModal || !row?.model_key) return;
  const isBuy = activeTradeSide === "buy";
  const selectedDate = dateSelect?.value || "";
  const categoryLabel = CATEGORY_LABELS[row.category] || row.category || "";
  currentDetailRow = null;
  document.querySelector(".detail-classify")?.setAttribute("hidden", "");
  detailChartLink?.closest(".detail-chart-link-wrap")?.removeAttribute("hidden");
  if (detailChartLink) {
    const params = new URLSearchParams({
      category: row.category || "new",
      trade_side: isBuy ? "buy" : "sell",
      model_key: row.model_key,
    });
    detailChartLink.href = `chart.html?${params.toString()}`;
    detailChartLink.textContent = isBuy ? "在走勢頁查看此型號徵收熱度 →" : "在價格走勢頁查看此型號 →";
  }
  detailTitle.textContent = row.model_key;
  detailSubtitle.textContent = [selectedDate, isBuy ? "買單徵收訊息" : "賣貨報價訊息", categoryLabel].filter(Boolean).join(" · ");
  detailStats.innerHTML = `
    <div class="detail-stat"><span class="muted">${isBuy ? "徵收人數" : "報價人數"}</span><strong>${row.total ?? 0}</strong></div>
  `;
  if (detailTicksTitle) detailTicksTitle.textContent = isBuy ? "當日徵收訊息" : "當日賣貨報價";
  detailTicks.textContent = "載入中…";
  detailModal.showModal();

  const { data, error } = await loadTradeMessages({
    isBuy,
    selectedDate,
    modelKey: row.model_key,
    category: row.category,
  });
  if (error) {
    detailTicks.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
    return;
  }

  const messages = groupSenderMessages(data || []);
  if (!messages.length) {
    detailTicks.textContent = `${selectedDate} 尚無${isBuy ? "徵收" : "賣貨"}訊息`;
    return;
  }
  detailTicks.innerHTML = renderGroupedMessagesHtml(messages, isBuy);
}

function updateSenderLeaderboardHeading() {
  if (!senderLeaderboardSummary) return;
  const side = activeTradeSide === "buy" ? "買單徵收" : "賣單報價";
  senderLeaderboardSummary.textContent = `情報來源排行（${side} · 跨群累計）`;
}

function updateModelLeaderboardHeading() {
  if (!modelLeaderboardSummary) return;
  const side = activeTradeSide === "buy" ? "買單徵收" : "賣單報價";
  modelLeaderboardSummary.textContent = `機型熱度排行（${side} · 同一人只算 1 次）`;
}

function renderLeaderboards(senderRows, modelRows) {
  updateSenderLeaderboardHeading();
  updateModelLeaderboardHeading();
  const peopleLabel = activeTradeSide === "buy" ? "人徵收" : "人報價";
  const countLabel = activeTradeSide === "buy" ? "徵收" : "報價";

  if (senderRows !== null) {
    currentSenderLeaderboardRows = senderRows;
    senderLeaderboard.innerHTML = senderRows.length
      ? senderRows.map((r, index) => {
        const { who } = formatSenderDisplay(r);
        return `<li><button type="button" class="rank-name rank-name-button" data-sender-index="${index}" title="${escapeHtml(senderRankTitle(r))}">${escapeHtml(who)}</button><span class="rank-meta">訊息 ${r.message_count} · ${countLabel} ${r.quote_count}</span></li>`;
      }).join("")
      : '<li class="muted">尚無資料（需執行 migration + 重跑腳本）</li>';
  }

  currentModelLeaderboardRows = modelRows;
  modelLeaderboard.innerHTML = modelRows.length
    ? modelRows.map((r, index) => `<li><button type="button" class="rank-name rank-name-button" data-model-index="${index}" title="${escapeHtml(r.model_key)}">${escapeHtml(r.model_key)}</button><span class="rank-meta">${r.total} ${peopleLabel}</span></li>`).join("")
    : '<li class="muted">尚無資料</li>';
}

async function loadDashboard(selectedDate) {
  const statsTable = table("SUPABASE_STATS_TABLE");
  const senderTable = table("SUPABASE_SENDER_STATS_TABLE");
  const ticksTable = table("SUPABASE_TICKS_TABLE") || "quote_ticks";
  const isBuy = activeTradeSide === "buy";

  const tickQuery = isBuy
    ? Promise.resolve({ data: [], error: null })
    : supabaseClient
      .from(ticksTable)
      .select("category,model_key,trade_side,price,discount_zhe,from_mid,sender_name")
      .eq("quote_date", selectedDate)
      .eq("trade_side", "sell")
      .eq("excluded", false)
      .limit(10000);

  const [
    { data: stats, error: statsError },
    { data: senders, error: senderError },
    { data: ticks, error: ticksError },
  ] = await Promise.all([
    supabaseClient.from(statsTable).select("*").eq("quote_date", selectedDate).maybeSingle(),
    supabaseClient.from(senderTable).select("from_mid,sender_name,top_chat_name,message_count,quote_count").eq("quote_date", selectedDate).order("quote_count", { ascending: false }).limit(10),
    tickQuery,
  ]);

  const tickRows = ticksError ? [] : (ticks || []);
  if (!isBuy) {
    rebuildDayTopPriceCounts(tickRows);
    rebuildDayLowestDiscount(tickRows, allRows);
  }

  const modelRows = isBuy
    ? buildModelRowsFromBuyDemand(buyDemandTicks)
    : buildModelRowsFromTicks(tickRows);

  if (statsError?.code === "42P01") {
    statMessages.textContent = "—";
    statObservations.textContent = "—";
    statRecords.textContent = "—";
    statQuotes.textContent = "—";
    senderLeaderboard.innerHTML = '<li class="muted">資料表不存在，請在 Supabase 執行 supabase_migration_v2.sql</li>';
    renderLeaderboards([], modelRows);
    return;
  }
  if (statsError) throw statsError;
  if (senderError && senderError.code !== "42P01") throw senderError;
  if (!isBuy && ticksError && ticksError.code !== "42P01") throw ticksError;

  if (!stats) {
    statMessages.textContent = "—";
    statObservations.textContent = "—";
    statRecords.textContent = "—";
    statQuotes.textContent = "—";
    const senderRows = isBuy
      ? buildSenderRowsFromBuyDemand(buyDemandTicks)
      : [];
    if (isBuy) {
      renderLeaderboards(senderRows, modelRows);
    } else {
      senderLeaderboard.innerHTML = '<li class="muted">尚無同步紀錄（手機 run.py / config.py 需 v2 版，跑完應寫入 daily_run_stats）</li>';
      currentSenderLeaderboardRows = [];
      renderLeaderboards(null, modelRows);
    }
  } else {
    statMessages.textContent = stats.total_messages ?? "—";
    statObservations.textContent = stats.total_observations ?? "—";
    statRecords.textContent = stats.total_records ?? "—";
    statQuotes.textContent = stats.total_quotes ?? "—";
    const senderRows = isBuy
      ? buildSenderRowsFromBuyDemand(buyDemandTicks)
      : mergeSenderQuoteCounts(senders, tickRows);
    renderLeaderboards(senderRows, modelRows);
  }
}

function buildSenderRowsFromBuyDemand(ticks) {
  const byMid = new Map();
  for (const t of ticks || []) {
    const mid = (t.from_mid || "").trim();
    if (!mid) continue;
    if (!byMid.has(mid)) {
      byMid.set(mid, {
        from_mid: mid,
        sender_name: "",
        top_chat_name: "",
        message_count: new Set(),
        quote_count: new Set(),
      });
    }
    const item = byMid.get(mid);
    if (t.sender_name) item.sender_name = t.sender_name;
    if (t.chat_name) item.top_chat_name = t.chat_name;
    const msgKey = t.message_id != null && t.message_id !== ""
      ? String(t.message_id)
      : (t.raw_line || "").trim();
    if (msgKey) item.message_count.add(msgKey);
    const demandKey = `${t.category}|${(t.model_key || "").trim()}`;
    item.quote_count.add(demandKey);
  }
  return [...byMid.values()]
    .map((item) => ({
      from_mid: item.from_mid,
      sender_name: item.sender_name,
      top_chat_name: item.top_chat_name,
      message_count: item.message_count.size,
      quote_count: item.quote_count.size,
    }))
    .sort((a, b) => (b.quote_count || 0) - (a.quote_count || 0) || (b.message_count || 0) - (a.message_count || 0))
    .slice(0, 10);
}

function buildModelRowsFromBuyDemand(ticks) {
  const byModel = new Map();
  for (const t of ticks || []) {
    const modelKey = (t.model_key || "").trim();
    if (!modelKey) continue;
    if (!byModel.has(modelKey)) {
      byModel.set(modelKey, { people: new Set(), category: t.category || "new" });
    }
    const item = byModel.get(modelKey);
    item.people.add(personKeyFromTick(t));
    if (t.category) item.category = t.category;
  }
  return [...byModel.entries()]
    .map(([model_key, item]) => ({ model_key, category: item.category, total: item.people.size }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

function buildModelRowsFromTicks(ticks) {
  const byModel = new Map();
  for (const t of ticks || []) {
    const modelKey = (t.model_key || "").trim();
    if (!modelKey) continue;
    if (!byModel.has(modelKey)) {
      byModel.set(modelKey, { people: new Set(), category: t.category || "new" });
    }
    const item = byModel.get(modelKey);
    item.people.add(personKeyFromTick(t));
    if (t.category) item.category = t.category;
  }
  return [...byModel.entries()]
    .map(([model_key, item]) => ({ model_key, category: item.category, total: item.people.size }))
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
  const selectedDate = dateSelect.value;
  const sourceRows = activeTradeSide === "buy" ? allBuyDemandRows : allRows;
  const filtered = sortRowsForView(sourceRows.filter((row) => {
    if (row.category !== activeCategory) return false;
    if (activeTradeSide === "sell" && !rowMatchesMarketFilter(row)) return false;
    return true;
  }));
  window.filteredRows = filtered;
  renderPriceView(filtered);
  renderSummary(filtered, selectedDate);
  updateLastUpdated(latestSyncTime, selectedDate);
}

function setActiveTradeSide(side) {
  activeTradeSide = side === "buy" ? "buy" : "sell";
  if (tradeSideToggle) {
    tradeSideToggle.dataset.active = activeTradeSide;
    tradeSideToggle.querySelectorAll(".segmented-btn").forEach((btn) => {
      const on = btn.dataset.side === activeTradeSide;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }
  document.body.classList.toggle("mode-buy-demand", activeTradeSide === "buy");
  const selectedDate = dateSelect.value;
  if (selectedDate) {
    loadRowsForDate(selectedDate).catch((e) => setPriceViewMessage(e.message, "error"));
  }
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

async function loadBuyDemandForDate(selectedDate) {
  const demandTable = table("SUPABASE_BUY_DEMAND_TABLE");
  const { data, error } = await supabaseClient
    .from(demandTable)
    .select("quote_date,category,model_key,model,capacity,color,spec_clear,from_mid,sender_name,chat_name,message_id,raw_line,quoted_at,intent_keyword")
    .eq("quote_date", selectedDate)
    .limit(10000);
  if (error) {
    if (error.code === "42P01") {
      buyDemandTicks = [];
      allBuyDemandRows = [];
      return;
    }
    throw error;
  }
  buyDemandTicks = data || [];
  allBuyDemandRows = aggregateBuyDemandRows(buyDemandTicks);
}

async function loadRowsForDate(selectedDate) {
  if (!selectedDate) return;
  setPriceViewMessage("載入中…");
  if (activeTradeSide === "buy") {
    await loadBuyDemandForDate(selectedDate);
    latestSyncTime = await fetchLatestSyncTime(selectedDate);
    await loadDashboard(selectedDate);
    if (!allBuyDemandRows.length) {
      setPriceViewMessage("今天尚無徵收需求資料（請確認已執行 migration v7 並重跑 run.py）");
    } else {
      applyFilters();
    }
    updateLastUpdated(latestSyncTime, selectedDate);
    return;
  }

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
if (tradeSideToggle) {
  tradeSideToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    setActiveTradeSide(btn.dataset.side);
  });
}
if (senderLeaderboard) {
  senderLeaderboard.addEventListener("click", (event) => {
    const button = event.target.closest(".rank-name-button[data-sender-index]");
    if (!button) return;
    const row = currentSenderLeaderboardRows[Number(button.dataset.senderIndex)];
    if (row) {
      openSenderDetail(row).catch((error) => {
        detailTicks.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
      });
    }
  });
}
if (modelLeaderboard) {
  modelLeaderboard.addEventListener("click", (event) => {
    const button = event.target.closest(".rank-name-button[data-model-index]");
    if (!button) return;
    const row = currentModelLeaderboardRows[Number(button.dataset.modelIndex)];
    if (row) {
      openModelDetail(row).catch((error) => {
        detailTicks.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
      });
    }
  });
}
if (marketFilter) {
  marketFilter.addEventListener("change", () => {
    activeMarketFilter = marketFilter.value;
    applyFilters();
  });
}

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
  compactPriceList.addEventListener("toggle", (event) => {
    if (event.target.classList?.contains("model-group")) {
      updateExpandAllButtonLabel();
    }
  }, true);
}

if (summary) {
  summary.addEventListener("click", (event) => {
    if (event.target.id === "expandAllBtn") {
      toggleAllModelGroups();
    }
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
    currentDetailRow = null;
    detailModal.close();
  });
}
if (detailModal) {
  detailModal.addEventListener("click", (event) => {
    if (event.target === detailModal) {
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
