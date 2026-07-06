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
const classifyDevice = document.getElementById("classifyDevice");
const classifyBrand = document.getElementById("classifyBrand");
const classifyCondition = document.getElementById("classifyCondition");
const classifySave = document.getElementById("classifySave");
const classifyStatus = document.getElementById("classifyStatus");

let supabaseClient = null;
let allRows = [];
let activeCategory = "new";
let activeMarketFilter = "";
let latestSyncTime = null;
let priceChart = null;
let discountChart = null;
let currentDetailRow = null;
let deviceTypes = [...FALLBACK_DEVICE_TYPES];
let brands = [...FALLBACK_BRANDS];

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
  const device = inferDeviceType(row);
  const brand = row.brand || "apple";
  const condition = inferCondition(row);
  fillSelect(
    classifyDevice,
    deviceTypes.map((d) => ({ value: d.code, label: d.label })),
    device,
  );
  fillSelect(
    classifyBrand,
    brands.map((b) => ({ value: b.code, label: b.name })),
    brand,
  );
  fillSelect(classifyCondition, CONDITION_OPTIONS, condition);
  if (classifyCurrent) {
    classifyCurrent.textContent = `目前：${deviceTypeLabel(device)} · ${brandLabel(brand)} · ${conditionLabel(condition)}`;
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
  const deviceType = classifyDevice?.value || inferDeviceType(row);
  const brand = classifyBrand?.value || row.brand || "apple";
  const condition = classifyCondition?.value || inferCondition(row);
  const tradeSide = row.trade_side || "sell";
  const now = new Date().toISOString();
  const pricesTable = table("SUPABASE_TABLE");
  const ticksTable = table("SUPABASE_TICKS_TABLE") || "quote_ticks";

  setClassifyStatus("儲存中…");

  const { error: priceError } = await supabaseClient
    .from(pricesTable)
    .update({
      device_type: deviceType,
      brand,
      condition_state: condition,
      updated_at: now,
    })
    .eq("quote_date", quoteDate)
    .eq("category", row.category)
    .eq("model_key", row.model_key)
    .eq("trade_side", tradeSide);
  if (priceError) throw priceError;

  if (row.id) {
    const { error: overrideError } = await supabaseClient.from("classification_overrides").upsert({
      target_table: "iphone_prices",
      target_id: row.id,
      device_type_code: deviceType,
      brand_code: brand,
      condition_state: condition,
      model_display: row.model || row.model_key,
      capacity: row.capacity || "",
      color: row.color || "",
      corrected_by: "main_board",
    }, { onConflict: "target_table,target_id" });
    if (overrideError) throw overrideError;
  }

  const { error: tickError } = await supabaseClient
    .from(ticksTable)
    .update({
      device_type: deviceType,
      brand,
      condition_state: condition,
    })
    .eq("quote_date", quoteDate)
    .eq("category", row.category)
    .eq("model_key", row.model_key)
    .eq("trade_side", tradeSide);
  if (tickError) throw tickError;

  row.device_type = deviceType;
  row.brand = brand;
  row.condition_state = condition;
  currentDetailRow = row;
  populateClassifyForm(row);
  setClassifyStatus("已儲存分類（含當日 quote_ticks）", "ok");
  applyFilters();
}

function tradeSideTag(side) {
  if (side === "buy") return '<span class="side-tag side-buy">買單</span>';
  return '<span class="side-tag side-sell">賣單</span>';
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
      bucket.discountHigh = bucket.discountHigh == null ? zhe : Math.max(bucket.discountHigh, zhe);
      bucket.discountLow = bucket.discountLow == null ? zhe : Math.min(bucket.discountLow, zhe);
    }
    byDay.set(day, bucket);
  }
  const days = [...byDay.keys()].sort();
  return days.map((day) => ({ day, ...byDay.get(day) }));
}

async function openDetailPanel(row) {
  if (!detailModal) return;
  currentDetailRow = row;
  populateClassifyForm(row);
  const label = [row.model || row.model_key, row.capacity, row.color].filter(Boolean).join(" ");
  detailTitle.textContent = label || row.model_key;
  detailSubtitle.textContent = `${CATEGORY_LABELS[row.category] || row.category} · ${row.trade_side === "buy" ? "買單" : "賣單"} · ${row.model_key}`;
  detailStats.innerHTML = `
    <div class="detail-stat"><span class="muted">建議售價</span><strong>${formatMaybePrice(row.msrp)}</strong></div>
    <div class="detail-stat"><span class="muted">今日熱門價</span><strong>${formatMaybePrice(row.top_price)}</strong></div>
    <div class="detail-stat"><span class="muted">目前折數</span><strong>${(row.top_discount_zhe || "—")}</strong></div>
  `;
  detailTicks.textContent = "載入中…";
  destroyCharts();
  detailModal.showModal();

  const ticksTable = table("SUPABASE_TICKS_TABLE") || "quote_ticks";
  const { data, error } = await supabaseClient
    .from(ticksTable)
    .select("quoted_at,quote_date,price,discount_zhe,chat_name,sender_name")
    .eq("category", row.category)
    .eq("model_key", row.model_key)
    .eq("trade_side", row.trade_side || "sell")
    .order("quoted_at", { ascending: true })
    .limit(800);

  if (error) {
    detailTicks.innerHTML = `<span class="error">${error.message}</span>`;
    return;
  }

  const ticks = data || [];
  if (!ticks.length) {
    detailTicks.textContent = "尚無歷史逐筆資料（需 v6 quote_ticks）";
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
      (v) => `${v}折`,
    );
  }

  const recent = [...ticks].reverse().slice(0, 15);
  detailTicks.innerHTML = recent.map((t) => {
    const who = (t.sender_name || "").trim() || "—";
    const group = (t.chat_name || "").trim();
    const meta = group ? ` · ${group}` : "";
    return `<div class="detail-tick-row"><span>${formatShortTime(t.quoted_at)}</span><strong>${formatPrice(t.price)}</strong><span>${t.discount_zhe || "—"}</span><span class="muted">${who}${meta}</span></div>`;
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
  const marketLabel = MARKET_LABELS[activeMarketFilter];
  const marketBadge = activeMarketFilter
    ? `<div class="summary-badge market-badge">${marketLabel} · 依熱門價由低到高</div>`
    : "";
  summary.innerHTML = `${marketBadge}<div class="summary-badge">${label}</div><div class="summary-text"><strong>${selectedDate}</strong> 共 <strong>${rows.length}</strong> 個商品規格</div>`;
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
    ? modelRows.map((r) => `<li><span class="rank-name">${r.model_key}</span><span class="rank-meta">${r.total} 次</span></li>`).join("")
    : '<li class="muted">尚無資料</li>';
}

async function loadDashboard(selectedDate) {
  const statsTable = table("SUPABASE_STATS_TABLE");
  const senderTable = table("SUPABASE_SENDER_STATS_TABLE");

  const [{ data: stats, error: statsError }, { data: senders, error: senderError }, { data: prices }] = await Promise.all([
    supabaseClient.from(statsTable).select("*").eq("quote_date", selectedDate).maybeSingle(),
    supabaseClient.from(senderTable).select("from_mid,sender_name,top_chat_name,message_count,quote_count").eq("quote_date", selectedDate).order("quote_count", { ascending: false }).limit(10),
    supabaseClient.from(table("SUPABASE_TABLE")).select("model_key,total_quotes").eq("quote_date", selectedDate),
  ]);

  if (statsError?.code === "42P01") {
    statMessages.textContent = "—";
    statObservations.textContent = "—";
    statRecords.textContent = "—";
    statQuotes.textContent = "—";
    senderLeaderboard.innerHTML = '<li class="muted">資料表不存在，請在 Supabase 執行 supabase_migration_v2.sql</li>';
    renderLeaderboards([], buildModelRows(prices));
    return;
  }
  if (statsError) throw statsError;
  if (senderError && senderError.code !== "42P01") throw senderError;

  if (!stats) {
    statMessages.textContent = "—";
    statObservations.textContent = "—";
    statRecords.textContent = "—";
    statQuotes.textContent = "—";
    senderLeaderboard.innerHTML = '<li class="muted">尚無同步紀錄（手機 run.py / config.py 需 v2 版，跑完應寫入 daily_run_stats）</li>';
    modelLeaderboard.innerHTML = buildModelRows(prices).length
      ? buildModelRows(prices).map((r) => `<li><span class="rank-name">${r.model_key}</span><span class="rank-meta">${r.total} 次</span></li>`).join("")
      : '<li class="muted">尚無資料</li>';
  } else {
    statMessages.textContent = stats.total_messages ?? "—";
    statObservations.textContent = stats.total_observations ?? "—";
    statRecords.textContent = stats.total_records ?? "—";
    statQuotes.textContent = stats.total_quotes ?? "—";
    renderLeaderboards(senders || [], buildModelRows(prices));
  }
}

function buildModelRows(prices) {
  const modelMap = {};
  for (const row of prices || []) {
    modelMap[row.model_key] = (modelMap[row.model_key] || 0) + (row.total_quotes || 0);
  }
  return Object.entries(modelMap).map(([model_key, total]) => ({ model_key, total }))
    .sort((a, b) => b.total - a.total).slice(0, 10);
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
  renderTable(filtered);
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
  const { data, error } = await supabaseClient.from(table("SUPABASE_TABLE")).select("quote_date").order("quote_date", { ascending: false });
  if (error) throw error;
  const dates = [...new Set((data || []).map((r) => r.quote_date))];
  dateSelect.innerHTML = dates.length ? "" : '<option value="">尚無資料</option>';
  for (const day of dates) {
    const opt = document.createElement("option");
    opt.value = day; opt.textContent = day;
    dateSelect.appendChild(opt);
  }
}

async function loadRowsForDate(selectedDate) {
  if (!selectedDate) return;
  tableBody.innerHTML = '<tr><td colspan="9" class="muted">載入中…</td></tr>';
  const { data, error } = await supabaseClient
    .from(table("SUPABASE_TABLE"))
    .select("id,category,model_key,model,capacity,color,msrp,top_discount_zhe,top_price,total_quotes,price_stats,trade_side,chat_name,updated_at,device_type,condition_state,brand")
    .eq("quote_date", selectedDate)
    .order("category").order("model_key");
  if (error) throw error;
  allRows = data || [];
  latestSyncTime = await fetchLatestSyncTime(selectedDate);
  await loadDashboard(selectedDate);
  applyFilters();
}

async function boot() {
  try {
    initClient();
    await loadTaxonomy();
    await loadAvailableDates();
    if (dateSelect.value) await loadRowsForDate(dateSelect.value);
  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="9" class="error">${error.message}</td></tr>`;
  }
}

dateSelect.addEventListener("change", () => loadRowsForDate(dateSelect.value).catch((e) => {
  tableBody.innerHTML = `<tr><td colspan="9" class="error">${e.message}</td></tr>`;
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
      classifyDevice?.focus();
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
