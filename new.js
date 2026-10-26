/**
 * 新品行情（剔除模式）。目錄跟首頁同一套：iphone_prices + product_msrp，
 * 依分頁 category 取 new／new_ipad／accessory。
 * 顯示名沿用 app.js：Duo、ipadRowModelLabel、rowModelLabel／watchRowModelLabel。
 * 行情只算目前分頁的賣單。買單不進區間，也不拿來剔除。
 * 剔除規則寫入該筆自己的 category，不一律寫 new。
 */
const TIMEZONE = "Asia/Taipei";
const CAPACITY_RANK = { "64": 1, "128": 2, "256": 3, "512": 4, "1T": 5, "2T": 6 };
const TICK_PAGE = 1000;
const RULES_TABLE = "tick_exclusion_rules";
const MARKET_TABS = [
  { category: "new", label: "新機" },
  { category: "new_ipad", label: "iPad" },
  { category: "accessory", label: "配件" },
];
const MODEL_COLOR_RE = /(勃根地紅|冰川藍|太空黑|太空灰|天藍|淺綠|薄荷綠|海藍|珊瑚紅|鈦灰|鈦黑|鈦銀|鈦藍|鈦金|鈦白|星光白|星光|夜空色|夜空|午夜|薄荷|黑|白|金|藍|綠|黃|橘|紫|粉|鈦|原|銀|灰|紅)$/;

const monthPrevBtn = document.getElementById("weekPrevBtn");
const monthNextBtn = document.getElementById("weekNextBtn");
const monthTodayBtn = document.getElementById("weekTodayBtn");
const monthLabel = document.getElementById("weekLabel");
const modelSearch = document.getElementById("modelSearch");
const onlyWithData = document.getElementById("onlyWithData");
const newStatus = document.getElementById("newStatus");
const newPriceList = document.getElementById("newPriceList");
const quoteModal = document.getElementById("newQuoteModal");
const quoteTitle = document.getElementById("newQuoteTitle");
const quoteSubtitle = document.getElementById("newQuoteSubtitle");
const quoteList = document.getElementById("newQuoteList");
const quoteClose = document.getElementById("newQuoteClose");
const marketTabs = document.getElementById("marketTabs");

let supabaseClient = null;
let monthStart = "";
let activeCategory = "new";
let viewToken = 0;
let catalogRows = [];
let allTicks = [];
let ticksByModel = new Map();
let openModelKey = null;

window._newExcludeHandler = null;

function table(name) {
  const value = window[name];
  if (typeof value === "string" && value && !value.startsWith("你的")) return value;
  const fallbacks = {
    SUPABASE_TABLE: "iphone_prices",
    SUPABASE_TICKS_TABLE: "quote_ticks",
    SUPABASE_MSRP_TABLE: "product_msrp",
  };
  return fallbacks[name] || name;
}

function ensureConfig() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) throw new Error("請設定 config.js");
  if (window.SUPABASE_URL.includes("你的專案") || window.SUPABASE_ANON_KEY.includes("你的anon"))
    throw new Error("config.js 還是範例文字");
}

function initClient() {
  ensureConfig();
  supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "ipw-anon-data" },
  });
}

function taipeiToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function currentMonth() {
  return taipeiToday().slice(0, 7);
}

function addMonthsYM(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRangeIso(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = `${ym}-01`;
  const next = new Date(y, m, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  return { start, end };
}

function formatPrice(price) {
  return Number(price).toLocaleString("zh-TW");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function displayColor(color) {
  if (color === "勃根地紅") return "紅";
  return color || "";
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

function isMarketCategory(category) {
  return MARKET_TABS.some((tab) => tab.category === category);
}

function categoryLabel(category) {
  return MARKET_TABS.find((tab) => tab.category === category)?.label || category || "";
}

function syncMarketTabs() {
  marketTabs?.querySelectorAll(".tab").forEach((btn) => {
    const on = btn.dataset.category === activeCategory;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

/** 與 app.js rowModelLabel 的 Duo 規則一致。 */
function displayModelName(model) {
  if (/^duo$/i.test(String(model || "").trim())) return "iPhone Duo";
  return String(model || "").trim();
}

/** 以下顯示名與 app.js 同名函式一致，不載入 app.js。 */
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
  if (/^(S1[12]|SE|Ultra)/i.test(key)) return true;
  return inferDeviceType(row) === "wearable";
}

function watchConnectionFromKey(modelKey) {
  const key = String(modelKey || "");
  if (/LTE/i.test(key)) return "LTE";
  if (/GPS/i.test(key)) return "GPS";
  return "";
}

function watchBaseModelLabel(row) {
  let model = String(row.model || "").replace(/\b(GPS|LTE)\b/gi, "").replace(/\s+/g, " ").trim();
  const cap = String(row.capacity || "").trim();
  if (model && cap && !model.toLowerCase().includes(cap.toLowerCase())) model = `${model} ${cap}`;
  if (!model) model = (row.model_key || "").replace(/(GPS|LTE).*/i, "").trim();
  return model.replace(/^SE(?=\s|\d{2}mm|$)/i, "SE3") || row.model_key || "";
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
  if (/^(S1[12]|SE|Ultra)/i.test(row.model_key || "")) return `${base} GPS`;
  return base || row.model_key || "—";
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

function rowModelLabel(row) {
  if (row.category === "new_ipad") return ipadRowModelLabel(row);
  if (isWatchAccessoryRow(row)) return watchRowModelLabel(row);
  const raw = row.model || splitModelKey(row.model_key).model || row.model_key || "—";
  if (/^duo$/i.test(String(raw).trim())) return "iPhone Duo";
  return raw;
}

function capacityRank(cap) {
  const key = String(cap || "").toUpperCase().replace("TB", "T");
  return CAPACITY_RANK[key] ?? 99;
}

function setStatus(text, kind = "") {
  if (!newStatus) return;
  newStatus.textContent = text;
  newStatus.classList.toggle("error", kind === "error");
}

function isAdminMode() {
  return new URLSearchParams(window.location.search).get("admin") === "1";
}

function specFromParts(modelKey, model, capacity, color, category) {
  const parsed = splitModelKey(modelKey);
  return {
    category: category || activeCategory,
    model_key: modelKey,
    model: (model || parsed.model || "").trim(),
    capacity: (capacity || parsed.capacity || "").trim(),
    color: (color || parsed.color || "").trim(),
  };
}

async function fetchPaged(makeQuery) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await makeQuery().range(from, from + TICK_PAGE - 1);
    if (error) {
      if (error.code === "42P01") return rows;
      throw error;
    }
    const page = data || [];
    rows.push(...page);
    if (page.length < TICK_PAGE) break;
    from += TICK_PAGE;
    if (from >= 20000) break;
  }
  return rows;
}

/**
 * 跟首頁 loadModelCatalog 一樣合併 iphone_prices 與 product_msrp。
 * 價格表已經有「duo256夜空」這類完整規格時，不再另列無顏色的 msrp 鍵（duo256）。
 */
async function loadCatalog(category) {
  const pricesTable = table("SUPABASE_TABLE");
  const msrpTable = table("SUPABASE_MSRP_TABLE");
  const [priceRows, msrpRows] = await Promise.all([
    fetchPaged(() => supabaseClient.from(pricesTable).select("category,model_key,model,capacity,color").eq("category", category).order("model_key")),
    fetchPaged(() => supabaseClient.from(msrpTable).select("category,model_key").eq("category", category).order("model_key")),
  ]);

  const byKey = new Map();
  for (const row of priceRows) {
    const modelKey = (row.model_key || "").trim();
    if (!modelKey || byKey.has(modelKey)) continue;
    byKey.set(modelKey, specFromParts(modelKey, row.model, row.capacity, row.color, row.category || category));
  }

  const specKeys = [...byKey.keys()];
  const seenMsrp = new Set();
  for (const row of msrpRows) {
    const modelKey = (row.model_key || "").trim();
    if (!modelKey || seenMsrp.has(modelKey)) continue;
    seenMsrp.add(modelKey);
    const lower = modelKey.toLowerCase();
    const covered = specKeys.some((key) => {
      const spec = key.toLowerCase();
      return spec === lower || spec.startsWith(lower);
    });
    if (covered || byKey.has(modelKey)) continue;
    byKey.set(modelKey, specFromParts(modelKey, "", "", "", category));
  }
  return [...byKey.values()];
}

function rememberTickSpec(tick) {
  const modelKey = (tick.model_key || "").trim();
  if (!modelKey || catalogRows.some((row) => row.model_key === modelKey)) return;
  catalogRows.push(specFromParts(modelKey, tick.model, tick.capacity, tick.color, tick.category || activeCategory));
}

async function fetchMonthTicks(category) {
  const ticksTable = table("SUPABASE_TICKS_TABLE");
  const { start, end } = monthRangeIso(monthStart);
  const selectCols = "id,model_key,model,capacity,color,price,quote_date,quoted_at,from_mid,sender_name,chat_name,raw_line,excluded,trade_side,category";
  const collected = [];
  let from = 0;

  while (true) {
    let query = supabaseClient
      .from(ticksTable)
      .select(selectCols)
      .eq("category", category)
      .eq("trade_side", "sell")
      .not("price", "is", null)
      .gte("quote_date", start)
      .lt("quote_date", end);
    if (!isAdminMode()) query = query.eq("excluded", false);

    const { data, error } = await query
      .order("quoted_at", { ascending: false })
      .range(from, from + TICK_PAGE - 1);

    if (error) {
      if (error.code === "42P01") return [];
      throw error;
    }
    const rows = data || [];
    collected.push(...rows);
    if (rows.length < TICK_PAGE) break;
    from += TICK_PAGE;
    if (from >= 80000) break;
  }
  return collected;
}

function indexTicks(ticks) {
  const byKey = new Map();
  for (const tick of ticks) {
    const modelKey = (tick.model_key || "").trim();
    if (!modelKey) continue;
    if (!byKey.has(modelKey)) byKey.set(modelKey, []);
    byKey.get(modelKey).push(tick);
  }
  return byKey;
}

function activeTicks(modelKey) {
  return (ticksByModel.get(modelKey) || []).filter((tick) => !tick.excluded && tick.trade_side !== "buy");
}

function marketBounds(modelKey) {
  if (typeof peerMarketBounds === "function") return peerMarketBounds(ticksByModel.get(modelKey) || []);
  const prices = activeTicks(modelKey).map((tick) => Number(tick.price)).filter(Number.isFinite);
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices), count: prices.length };
}

function rowLabel(row) {
  return rowModelLabel(row) || row.model_key;
}

function groupLabel(row) {
  if (row.category === "new_ipad") return ipadBaseModelName(row) || "其他";
  if (isWatchAccessoryRow(row)) return watchBaseModelLabel(row) || "其他";
  return displayModelName(row.model || splitModelKey(row.model_key).model) || rowLabel(row) || "其他";
}

function filteredCatalog() {
  const kw = (modelSearch?.value || "").trim().toLowerCase();
  if (!kw) return catalogRows;
  return catalogRows.filter((row) => {
    const label = rowLabel(row);
    const hay = [row.model_key, row.model, row.capacity, row.color, label, groupLabel(row), displayColor(row.color)].join(" ").toLowerCase();
    return hay.includes(kw);
  });
}

function formatTickWhen(tick) {
  const raw = tick.quoted_at || tick.quote_date || "";
  if (!raw) return "—";
  const d = new Date(String(raw).trim().replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 16);
  return d.toLocaleString("zh-TW", {
    timeZone: TIMEZONE, month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function formatMarketHtml(modelKey) {
  const bounds = marketBounds(modelKey);
  const ticks = ticksByModel.get(modelKey) || [];
  if (!bounds) {
    if (ticks.length && isAdminMode()) {
      return `<button type="button" class="used-price-btn" data-model-key="${escapeHtml(modelKey)}">—</button>`;
    }
    return '<span class="muted">—</span>';
  }
  const btn = (value) =>
    `<button type="button" class="used-price-btn" data-model-key="${escapeHtml(modelKey)}" title="查看 ${monthStart} 賣單">${formatPrice(value)}</button>`;
  const range = bounds.min === bounds.max
    ? btn(bounds.min)
    : `${btn(bounds.min)}<span class="weekly-range-sep">~</span>${btn(bounds.max)}`;
  return `<span class="used-weekly-range">${range}<span class="compact-count">×${bounds.count}筆</span></span>`;
}

function renderQuoteModal(modelKey) {
  const row = catalogRows.find((item) => item.model_key === modelKey);
  const ticks = ticksByModel.get(modelKey) || [];
  const title = row
    ? [rowLabel(row), row.capacity, displayColor(row.color)].filter(Boolean).join(" ")
    : modelKey;
  if (quoteTitle) quoteTitle.textContent = title;
  const bounds = marketBounds(modelKey);
  const excludedCount = ticks.filter((tick) => tick.excluded).length;
  if (quoteSubtitle) {
    const range = bounds
      ? `行情 ${formatPrice(bounds.min)}${bounds.min === bounds.max ? "" : "~" + formatPrice(bounds.max)}`
      : "本月沒有計入的賣單";
    const tail = excludedCount ? ` · 已剔除 ${excludedCount} 筆（不計入行情）` : "";
    quoteSubtitle.textContent = `${monthStart} · ${range}${tail}`;
  }
  if (!quoteList) return;
  if (!ticks.length) {
    quoteList.innerHTML = '<p class="muted">這個月份沒有賣單</p>';
    return;
  }
  const canExclude = typeof window._newExcludeHandler === "function";
  const ordered = [...ticks].sort((a, b) => Number(!!a.excluded) - Number(!!b.excluded));
  quoteList.innerHTML = ordered.map((tick) => {
    const mid = (tick.from_mid || "").trim();
    const who = (tick.sender_name || "").trim() || (mid ? `未知(${mid.slice(-8)})` : "未知");
    const line = (tick.raw_line || "").trim();
    const body = line
      ? `<pre class="used-quote-raw">${escapeHtml(line)}</pre>`
      : `<p class="used-quote-missing muted">此筆無原文</p>`;
    const tickId = escapeHtml(String(tick.id || ""));
    let actionBtn = "";
    if (canExclude && tick.excluded) {
      actionBtn = `<button type="button" class="btn-restore" data-tick-id="${tickId}" title="取消剔除，重新計入行情">↺ 取消剔除</button>`;
    } else if (canExclude) {
      const ruleBtn = line
        ? `<button type="button" class="btn-exclude-rule" data-tick-id="${tickId}" title="建立規則：這句原文以後出現都自動剔除">⊘ 剔除這句話</button>`
        : "";
      actionBtn = `${ruleBtn}<button type="button" class="btn-exclude" data-tick-id="${tickId}" title="只剔除這一筆">⊘ 只這筆</button>`;
    }
    const stateCls = tick.excluded ? " used-quote-card--excluded" : "";
    const excludedTag = tick.excluded ? '<span class="used-quote-tag">已剔除</span>' : "";
    return `
    <article class="used-quote-card${stateCls}" data-tick-id="${tickId}">
      <div class="used-quote-meta">
        <span class="used-quote-price">$${escapeHtml(formatPrice(tick.price))}</span>
        ${escapeHtml(formatTickWhen(tick))} · ${escapeHtml(who)} · ${escapeHtml((tick.chat_name || "").trim() || "群組未知")}
        ${excludedTag}
        ${actionBtn}
      </div>
      ${body}
    </article>`;
  }).join("");
}

function openModelModal(modelKey) {
  if (!quoteModal) return;
  openModelKey = modelKey;
  renderQuoteModal(modelKey);
  quoteModal.showModal();
}

function closeQuotes() {
  quoteModal?.close();
  openModelKey = null;
}

function renderList() {
  if (!newPriceList) return;
  let rows = filteredCatalog();
  const hasMarket = (row) => !!marketBounds(row.model_key);
  const totalSpecs = rows.length;
  const withData = rows.filter(hasMarket).length;
  if (onlyWithData?.checked) rows = rows.filter(hasMarket);

  const groups = new Map();
  for (const row of rows) {
    const label = groupLabel(row);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(row);
  }
  const labels = [...groups.keys()].sort((a, b) => {
    if (a === "iPhone Duo") return -1;
    if (b === "iPhone Duo") return 1;
    return a.localeCompare(b, "zh-Hant", { numeric: true });
  });

  if (!labels.length) {
    newPriceList.innerHTML = '<div class="compact-empty muted">沒有符合條件的型號</div>';
    setStatus(`${monthStart} · 目錄 ${catalogRows.length} 規格 · 有行情 0`);
    return;
  }

  newPriceList.innerHTML = labels.map((label) => {
    const groupRows = groups.get(label).sort((a, b) => {
      const cap = capacityRank(a.capacity) - capacityRank(b.capacity);
      if (cap) return cap;
      return String(displayColor(a.color) || "").localeCompare(String(displayColor(b.color) || ""), "zh-Hant");
    });
    const body = groupRows.map((row) => `
      <div class="compact-row used-market-row" data-model-label="${escapeHtml(label)}">
        <span class="compact-model">${escapeHtml(rowLabel(row))}</span>
        <span class="compact-capacity">${escapeHtml(row.capacity || "—")}</span>
        <span class="compact-color">${escapeHtml(displayColor(row.color) || "—")}</span>
        <span class="compact-peer"><span class="price-field-label">行情</span>${formatMarketHtml(row.model_key)}</span>
      </div>`).join("");
    const open = label === "iPhone Duo" ? " open" : "";
    return `
    <details class="model-group"${open}>
      <summary class="model-group-summary">
        <span class="model-group-name">${escapeHtml(label)}</span>
        <span class="model-group-meta">${groupRows.length} 規格</span>
      </summary>
      <div class="model-group-body">
        <div class="compact-row compact-header used-market-row">
          <span>型號</span><span>容量</span><span>顏色</span><span>行情</span>
        </div>
        ${body}
      </div>
    </details>`;
  }).join("");

  const bits = [
    monthStart,
    categoryLabel(activeCategory),
    `目錄 ${totalSpecs} 規格`,
    `有行情 ${withData}`,
    `${categoryLabel(activeCategory)}賣單`,
  ];
  if (activeCategory === "new") {
    const duoCount = catalogRows.filter((row) => rowLabel(row) === "iPhone Duo").length;
    bits.push(duoCount ? `iPhone Duo ${duoCount} 規格` : "目錄沒有 iPhone Duo");
  }
  const excludedCount = allTicks.filter((tick) => tick.excluded).length;
  if (excludedCount) bits.push(`已剔除 ${excludedCount} 筆`);
  setStatus(bits.join(" · "));
}

function updateMonthChrome() {
  if (monthLabel) monthLabel.textContent = monthStart;
  const isCurrent = monthStart === currentMonth();
  if (monthNextBtn) monthNextBtn.disabled = isCurrent;
  if (monthTodayBtn) monthTodayBtn.disabled = isCurrent;
}

async function refresh() {
  const token = ++viewToken;
  const category = activeCategory;
  updateMonthChrome();
  try {
    setStatus(`載入${categoryLabel(category)}賣單中…`);
    const ticks = await fetchMonthTicks(category);
    if (token !== viewToken) return;
    allTicks = ticks;
    for (const tick of allTicks) rememberTickSpec(tick);
    ticksByModel = indexTicks(allTicks);
    renderList();
    if (openModelKey) renderQuoteModal(openModelKey);
  } catch (error) {
    if (token !== viewToken) return;
    allTicks = [];
    ticksByModel = new Map();
    if (newPriceList) newPriceList.innerHTML = "";
    setStatus(error.message || String(error), "error");
  }
}

async function switchCategory(category) {
  if (!isMarketCategory(category) || category === activeCategory) return;
  activeCategory = category;
  syncMarketTabs();
  closeQuotes();
  const token = ++viewToken;
  try {
    setStatus(`載入${categoryLabel(category)}目錄中…`);
    const catalog = await loadCatalog(category);
    if (token !== viewToken) return;
    catalogRows = catalog;
    allTicks = [];
    ticksByModel = new Map();
    openModelKey = null;
    setStatus(`載入${categoryLabel(category)}賣單中…`);
    const ticks = await fetchMonthTicks(category);
    if (token !== viewToken) return;
    allTicks = ticks;
    for (const tick of allTicks) rememberTickSpec(tick);
    ticksByModel = indexTicks(allTicks);
    renderList();
  } catch (error) {
    if (token !== viewToken) return;
    allTicks = [];
    ticksByModel = new Map();
    if (newPriceList) newPriceList.innerHTML = "";
    setStatus(error.message || String(error), "error");
  }
}

async function shiftMonth(delta) {
  monthStart = addMonthsYM(monthStart, delta);
  await refresh();
}

monthPrevBtn?.addEventListener("click", () => shiftMonth(-1));
monthNextBtn?.addEventListener("click", () => { if (monthStart < currentMonth()) shiftMonth(1); });
monthTodayBtn?.addEventListener("click", async () => { monthStart = currentMonth(); await refresh(); });
marketTabs?.addEventListener("click", (event) => {
  const btn = event.target.closest(".tab");
  if (!btn?.dataset.category) return;
  switchCategory(btn.dataset.category);
});
modelSearch?.addEventListener("input", () => renderList());
onlyWithData?.addEventListener("change", () => renderList());
newPriceList?.addEventListener("click", (event) => {
  const btn = event.target.closest(".used-price-btn");
  if (!btn) return;
  event.preventDefault();
  openModelModal(btn.dataset.modelKey);
});
quoteClose?.addEventListener("click", closeQuotes);
quoteModal?.addEventListener("click", (event) => {
  if (event.target === quoteModal) closeQuotes();
});

function rebuildAfterExclude() {
  ticksByModel = indexTicks(allTicks);
  renderList();
  if (openModelKey) renderQuoteModal(openModelKey);
}

quoteList?.addEventListener("click", async (event) => {
  const btn = event.target.closest(".btn-exclude, .btn-restore, .btn-exclude-rule");
  if (!btn) return;
  const tickId = btn.dataset.tickId;
  if (!tickId) return;
  const tick = allTicks.find((item) => String(item.id) === String(tickId));
  if (!tick) return;
  const isRule = btn.classList.contains("btn-exclude-rule");
  const isRestore = btn.classList.contains("btn-restore");
  const handler = isRule ? window._newRuleHandler : (isRestore ? window._newRestoreHandler : window._newExcludeHandler);
  if (typeof handler !== "function") return;

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = isRestore ? "復原中…" : "剔除中…";
  try {
    if (isRule) {
      const category = tickCategory(tick);
      const affected = await window._newRuleHandler(tick.raw_line, category);
      const line = (tick.raw_line || "").trim();
      for (const item of allTicks) {
        if ((item.raw_line || "").trim() === line && tickCategory(item) === category) item.excluded = true;
      }
      rebuildAfterExclude();
      alert(`已建立規則，這句原文的 ${affected} 筆${categoryLabel(category)}報價全部剔除，以後再出現也會自動擋掉。`);
      return;
    }
    if (isRestore) {
      const category = tickCategory(tick);
      const affected = await window._newRestoreHandler(tick);
      const line = (tick.raw_line || "").trim();
      if (affected.ruleRemoved && line) {
        for (const item of allTicks) {
          if ((item.raw_line || "").trim() === line && tickCategory(item) === category) item.excluded = false;
        }
      } else {
        tick.excluded = false;
      }
      rebuildAfterExclude();
      return;
    }
    await window._newExcludeHandler(tickId, true);
    tick.excluded = true;
    rebuildAfterExclude();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = originalText;
    alert(`${isRestore ? "取消剔除" : "剔除"}失敗：${err.message || err}`);
  }
});

function tickCategory(tick) {
  const category = String(tick?.category || activeCategory || "").trim();
  return isMarketCategory(category) ? category : activeCategory;
}

function installAdminHandlers() {
  const ticksTable = table("SUPABASE_TICKS_TABLE");

  window._newExcludeHandler = async function setTickExcluded(tickId, excluded = true) {
    if (!tickId) throw new Error("缺少 tick id");
    const tick = allTicks.find((item) => String(item.id) === String(tickId));
    const category = tickCategory(tick);
    const { data, error } = await supabaseClient
      .from(ticksTable)
      .update({ excluded })
      .eq("id", tickId)
      .eq("category", category)
      .select("id");
    if (error) throw new Error(error.message || "更新失敗");
    if (!data?.length) throw new Error("沒有更新到任何列（檢查 Supabase RLS update policy）");
  };

  window._newRuleHandler = async function excludeByRawLine(rawLine, category) {
    const line = (rawLine || "").trim();
    const ruleCategory = isMarketCategory(category) ? category : activeCategory;
    if (!line) throw new Error("這筆沒有原文，只能用「只這筆」剔除");

    const { error: ruleError } = await supabaseClient
      .from(RULES_TABLE)
      .upsert(
        { category: ruleCategory, raw_line: line, model_key: "", reason: "前台標記解析錯誤", active: true },
        { onConflict: "category,raw_line,model_key" },
      );
    if (ruleError) {
      const hint = ruleError.code === "42P01"
        ? "找不到 tick_exclusion_rules，請先在 Supabase 執行建表 migration"
        : ruleError.message;
      throw new Error(hint || "規則建立失敗");
    }

    const { data, error } = await supabaseClient
      .from(ticksTable)
      .update({ excluded: true })
      .eq("category", ruleCategory)
      .eq("trade_side", "sell")
      .eq("raw_line", line)
      .select("id");
    if (error) throw new Error(error.message || "套用規則失敗");
    return data?.length || 0;
  };

  window._newRestoreHandler = async function restoreTick(tick) {
    const category = tickCategory(tick);
    const line = (tick.raw_line || "").trim();
    if (line) {
      const { data: rules, error: findError } = await supabaseClient
        .from(RULES_TABLE)
        .select("id")
        .eq("category", category)
        .eq("raw_line", line)
        .eq("model_key", "");
      if (findError && findError.code !== "42P01") throw new Error(findError.message);

      if (rules?.length) {
        const { error: delError } = await supabaseClient
          .from(RULES_TABLE).delete().eq("category", category).eq("raw_line", line).eq("model_key", "");
        if (delError) throw new Error(delError.message || "規則刪除失敗");
        const { error } = await supabaseClient
          .from(ticksTable)
          .update({ excluded: false })
          .eq("category", category)
          .eq("trade_side", "sell")
          .eq("raw_line", line);
        if (error) throw new Error(error.message || "復原失敗");
        return { ruleRemoved: true };
      }
    }
    await window._newExcludeHandler(tick.id, false);
    return { ruleRemoved: false };
  };
}

async function boot() {
  try {
    initClient();
    document.title = "新品行情（剔除模式）";
    if (isAdminMode()) {
      installAdminHandlers();
      const hint = document.querySelector(".used-week-hint");
      if (hint && !hint.textContent.includes("依該筆 category")) {
        hint.textContent += " · Admin：可整句剔除／單筆剔除（依該筆 category）";
      }
    }
    monthStart = currentMonth();
    activeCategory = "new";
    syncMarketTabs();
    catalogRows = await loadCatalog(activeCategory);
    await refresh();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
}

boot();
