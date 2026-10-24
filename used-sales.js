/** 與 used.js 的 USED_CATALOG_KEYS 相同。本頁只看選中的那一個月，不回溯。 */
const USED_CATALOG_KEYS = [
  "11 64", "11 128",
  "12 128", "12 256", "12pro 128", "12pro 256", "12pro 512", "12promax 128", "12promax 256", "12mini 64", "12mini 128",
  "13 128", "13 256", "13pro 128", "13pro 256", "13promax 128", "13promax 256", "13mini 128",
  "14 128", "14 256", "14plus 128", "14pro 128", "14pro 256", "14promax 128", "14promax 256",
  "15 128", "15 256", "15plus 128", "15pro 128", "15pro 256", "15promax 256", "15promax 512",
  "16 128", "16 256", "16plus 128", "16pro 128", "16pro 256", "16promax 256", "16promax 512",
  "17 256", "17 512",
  "17air 256", "17air 512", "17air 1T",
  "17pro 256", "17pro 512", "17pro 1T",
  "17promax 256", "17promax 512", "17promax 1T", "17promax 2T",
  "17e 256 黑", "17e 256 白", "17e 256 粉",
  "17e 512 黑", "17e 512 白", "17e 512 粉",
  "18pro 256", "18pro 512", "18pro 1T", "18pro 2T",
  "18promax 256", "18promax 512", "18promax 1T", "18promax 2T",
  "16e 128 黑", "16e 128 白", "16e 256 黑", "16e 256 白",
  "iPad7 WiFi", "iPad7 LTE", "iPad8 WiFi", "iPad8 LTE", "iPad9 WiFi", "iPad9 LTE",
  "iPad10 WiFi", "iPad10 LTE", "iPadAir4 WiFi", "iPadAir4 LTE",
  "iPadAir5 WiFi", "iPadAir5 LTE", "iPadAir6 WiFi", "iPadAir6 LTE",
];

const TIMEZONE = "Asia/Taipei";
const CAPACITY_RANK = { "64": 1, "128": 2, "256": 3, "512": 4, "1T": 5, "2T": 6, WiFi: 10, LTE: 11 };
const TICK_PAGE = 1000;
const CATALOG_KEY_SET = new Set(USED_CATALOG_KEYS);

const monthPrevBtn = document.getElementById("weekPrevBtn");
const monthNextBtn = document.getElementById("weekNextBtn");
const monthTodayBtn = document.getElementById("weekTodayBtn");
const monthLabel = document.getElementById("weekLabel");
const pageTitle = document.getElementById("salesPageTitle");
const modelSearch = document.getElementById("modelSearch");
const onlyWithData = document.getElementById("onlyWithData");
const usedStatus = document.getElementById("usedStatus");
const salesList = document.getElementById("usedSalesList");
const usedQuoteModal = document.getElementById("usedQuoteModal");
const usedQuoteTitle = document.getElementById("usedQuoteTitle");
const usedQuoteSubtitle = document.getElementById("usedQuoteSubtitle");
const usedQuoteList = document.getElementById("usedQuoteList");
const usedQuoteClose = document.getElementById("usedQuoteClose");

let supabaseClient = null;
let monthStart = "";
let allTicks = [];
let ticksByModelMonth = new Map();
/** model_key → { ticks }，只有這個月、未剔除的賣單 */
let resolvedByModel = new Map();

function table(name) {
  const value = window[name];
  if (typeof value === "string" && value && !value.startsWith("你的")) return value;
  const fallbacks = { SUPABASE_TICKS_TABLE: "quote_ticks" };
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

function parseCatalogEntry(modelKey) {
  const parts = modelKey.trim().split(/\s+/);
  const series = parts[0] || modelKey;
  return { model_key: modelKey, series, model: series, capacity: parts[1] || "", color: parts.slice(2).join(" ") || "" };
}

const CATALOG_ROWS = USED_CATALOG_KEYS.map(parseCatalogEntry);

function capacityRank(cap) {
  return CAPACITY_RANK[String(cap || "").trim()] || 99;
}

function setStatus(text, kind = "") {
  if (!usedStatus) return;
  usedStatus.textContent = text;
  usedStatus.classList.toggle("error", kind === "error");
}

function filteredCatalog() {
  const kw = (modelSearch?.value || "").trim().toLowerCase();
  if (!kw) return CATALOG_ROWS;
  return CATALOG_ROWS.filter((row) => {
    const hay = [row.model_key, row.series, row.model, row.capacity, row.color].join(" ").toLowerCase();
    return hay.includes(kw);
  });
}

function formatTickWhen(t) {
  const raw = t.quoted_at || t.quote_date || "";
  if (!raw) return "—";
  const d = new Date(String(raw).trim().replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 16);
  return d.toLocaleString("zh-TW", {
    timeZone: TIMEZONE, month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function pricedForModel(modelKey) {
  const hit = resolvedByModel.get(modelKey);
  if (!hit || typeof mySellFromTicks !== "function") return null;
  return mySellFromTicks(hit.ticks);
}

function formatPeerHtml(modelKey) {
  const priced = pricedForModel(modelKey);
  if (!priced) return '<span class="muted">—</span>';
  const btn = (value) =>
    `<button type="button" class="used-price-btn" data-model-key="${escapeHtml(modelKey)}" title="查看本月報價">${formatPrice(value)}</button>`;
  const range = priced.peerMin === priced.peerMax
    ? btn(priced.peerMin)
    : `${btn(priced.peerMin)}<span class="weekly-range-sep">~</span>${btn(priced.peerMax)}`;
  return `<span class="used-weekly-range">${range}<span class="compact-count">×${priced.count}筆</span></span>`;
}

function formatMySellHtml(modelKey) {
  const priced = pricedForModel(modelKey);
  if (!priced || priced.sellMin == null || priced.sellMax == null) return '<span class="muted">—</span>';
  const text = priced.sellMin === priced.sellMax
    ? formatPrice(priced.sellMin)
    : `${formatPrice(priced.sellMin)}<span class="weekly-range-sep">~</span>${formatPrice(priced.sellMax)}`;
  return `<span class="my-sell-price">${text}</span>`;
}

function renderQuoteModal(modelKey) {
  const hit = resolvedByModel.get(modelKey);
  const ticks = hit?.ticks || [];
  const row = CATALOG_ROWS.find((r) => r.model_key === modelKey);
  const title = [row?.model, row?.capacity, row?.color].filter(Boolean).join(" ") || modelKey;
  if (usedQuoteTitle) usedQuoteTitle.textContent = title;
  const priced = typeof mySellFromTicks === "function" ? mySellFromTicks(ticks) : null;
  if (usedQuoteSubtitle) {
    const peer = priced
      ? `同行行情 ${formatPrice(priced.peerMin)}${priced.peerMin === priced.peerMax ? "" : "~" + formatPrice(priced.peerMax)} · 我的賣價 ${formatPrice(priced.sellMin)}${priced.sellMin === priced.sellMax ? "" : "~" + formatPrice(priced.sellMax)}`
      : "這個月份沒有未剔除的賣單";
    usedQuoteSubtitle.textContent = `${monthStart} · ${peer}`;
  }
  if (!usedQuoteList) return;
  if (!ticks.length) {
    usedQuoteList.innerHTML = '<p class="muted">這個月份沒有資料</p>';
    return;
  }
  usedQuoteList.innerHTML = ticks.map((t) => {
    const mid = (t.from_mid || "").trim();
    const who = (t.sender_name || "").trim() || (mid ? `未知(${mid.slice(-8)})` : "未知");
    const line = (t.raw_line || "").trim();
    const body = line
      ? `<pre class="used-quote-raw">${escapeHtml(line)}</pre>`
      : `<p class="used-quote-missing muted">此筆無原文</p>`;
    return `
    <article class="used-quote-card">
      <div class="used-quote-meta">
        <span class="used-quote-price">$${escapeHtml(formatPrice(t.price))}</span>
        ${escapeHtml(formatTickWhen(t))} · ${escapeHtml(who)} · ${escapeHtml((t.chat_name || "").trim() || "群組未知")}
      </div>
      ${body}
    </article>`;
  }).join("");
}

function openModelModal(modelKey) {
  if (!usedQuoteModal) return;
  renderQuoteModal(modelKey);
  usedQuoteModal.showModal();
}

function closePriceQuotes() {
  usedQuoteModal?.close();
}

async function fetchMonthTicks() {
  const ticksTable = table("SUPABASE_TICKS_TABLE");
  const { start, end } = monthRangeIso(monthStart);
  const selectCols = "id,model_key,price,quote_date,quoted_at,from_mid,sender_name,chat_name,raw_line,excluded,trade_side";
  const collected = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabaseClient
      .from(ticksTable)
      .select(selectCols)
      .eq("category", "used")
      .eq("trade_side", "sell")
      .eq("excluded", false)
      .not("price", "is", null)
      .gte("quote_date", start)
      .lt("quote_date", end)
      .order("quoted_at", { ascending: false })
      .range(from, from + TICK_PAGE - 1);

    if (error) {
      if (error.code === "42P01") return [];
      throw error;
    }
    const rows = data || [];
    for (const row of rows) {
      const key = (row.model_key || "").trim();
      if (CATALOG_KEY_SET.has(key)) collected.push(row);
    }
    if (rows.length < TICK_PAGE) break;
    from += TICK_PAGE;
    if (from >= 50000) break;
  }
  return collected;
}

function buildResolved() {
  const byKey = new Map();
  for (const tick of allTicks) {
    const modelKey = (tick.model_key || "").trim();
    if (!modelKey) continue;
    if (!byKey.has(modelKey)) byKey.set(modelKey, []);
    byKey.get(modelKey).push(tick);
  }
  ticksByModelMonth = byKey;
  const resolved = new Map();
  for (const key of USED_CATALOG_KEYS) {
    const ticks = byKey.get(key) || [];
    if (!ticks.length) continue;
    if (typeof mySellFromTicks === "function" && !mySellFromTicks(ticks)) continue;
    resolved.set(key, { ticks });
  }
  return resolved;
}

function sortedCatalogRows(rows) {
  return [...rows].sort((a, b) => {
    const series = String(a.series).localeCompare(String(b.series), "zh-Hant", { numeric: true });
    if (series) return series;
    const cap = capacityRank(a.capacity) - capacityRank(b.capacity);
    if (cap) return cap;
    return String(a.color || "").localeCompare(String(b.color || ""), "zh-Hant");
  });
}

function renderList() {
  if (!salesList) return;
  let rows = sortedCatalogRows(filteredCatalog());
  const totalSpecs = rows.length;
  const withData = rows.filter((row) => resolvedByModel.has(row.model_key)).length;
  if (onlyWithData?.checked) rows = rows.filter((row) => resolvedByModel.has(row.model_key));

  if (!rows.length) {
    salesList.innerHTML = '<div class="compact-empty muted">沒有符合條件的型號</div>';
    setStatus(`${monthStart} · 目錄 ${totalSpecs} 規格 · 有行情 0`);
    return;
  }

  const header = `
    <div class="compact-row compact-header used-sales-row">
      <span>型號</span><span>容量</span><span>顏色</span><span>同行行情</span><span>我的賣價</span>
    </div>`;
  const body = rows.map((row) => `
    <div class="compact-row used-sales-row">
      <span class="compact-model">${escapeHtml(row.model)}</span>
      <span class="compact-capacity">${escapeHtml(row.capacity || "—")}</span>
      <span class="compact-color">${escapeHtml(row.color || "—")}</span>
      <span class="compact-peer"><span class="price-field-label">同行行情</span>${formatPeerHtml(row.model_key)}</span>
      <span class="compact-mine"><span class="price-field-label">我的賣價</span>${formatMySellHtml(row.model_key)}</span>
    </div>`).join("");
  salesList.innerHTML = header + body;
  setStatus([monthStart, `目錄 ${totalSpecs} 規格`, `有行情 ${withData}`, "本月二手賣單", "未剔除"].join(" · "));
}

function updateMonthChrome() {
  const isCurrent = monthStart === currentMonth();
  if (monthLabel) monthLabel.textContent = monthStart;
  if (pageTitle) pageTitle.textContent = isCurrent ? "本月二手銷售行情" : `${monthStart} 二手銷售行情`;
  if (monthNextBtn) monthNextBtn.disabled = isCurrent;
  if (monthTodayBtn) monthTodayBtn.disabled = isCurrent;
}

async function refresh() {
  updateMonthChrome();
  try {
    setStatus("載入本月二手賣單中…");
    allTicks = await fetchMonthTicks();
    resolvedByModel = buildResolved();
    renderList();
  } catch (error) {
    ticksByModelMonth = new Map();
    resolvedByModel = new Map();
    if (salesList) salesList.innerHTML = "";
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
modelSearch?.addEventListener("input", () => renderList());
onlyWithData?.addEventListener("change", () => renderList());
salesList?.addEventListener("click", (event) => {
  const btn = event.target.closest(".used-price-btn");
  if (!btn) return;
  event.preventDefault();
  openModelModal(btn.dataset.modelKey);
});
usedQuoteClose?.addEventListener("click", closePriceQuotes);
usedQuoteModal?.addEventListener("click", (event) => {
  if (event.target === usedQuoteModal) closePriceQuotes();
});

async function boot() {
  try {
    initClient();
    monthStart = currentMonth();
    await refresh();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
}

boot();
