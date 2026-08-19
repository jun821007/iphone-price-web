/** 與 line_price_pipeline.build_used_catalog() 同步的固定二手目錄 */
const USED_CATALOG_KEYS = [
  "11 64", "11 128",
  "12 128", "12 256", "12pro 128", "12pro 256", "12pro 512", "12promax 128", "12promax 256", "12mini 64", "12mini 128",
  "13 128", "13 256", "13pro 128", "13pro 256", "13promax 128", "13promax 256", "13mini 128",
  "14 128", "14 256", "14plus 128", "14pro 128", "14pro 256", "14promax 128", "14promax 256",
  "15 128", "15 256", "15plus 128", "15pro 128", "15pro 256", "15promax 256", "15promax 512",
  "16 128", "16 256", "16plus 128", "16pro 128", "16pro 256", "16promax 256", "16promax 512",
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
const monthHint = document.getElementById("weekHint");
const modelSearch = document.getElementById("modelSearch");
const expandAllBtn = document.getElementById("expandAllBtn");
const usedStatus = document.getElementById("usedStatus");
const usedPriceList = document.getElementById("usedPriceList");
const usedQuoteModal = document.getElementById("usedQuoteModal");
const usedQuoteTitle = document.getElementById("usedQuoteTitle");
const usedQuoteSubtitle = document.getElementById("usedQuoteSubtitle");
const usedQuoteList = document.getElementById("usedQuoteList");
const usedQuoteClose = document.getElementById("usedQuoteClose");

let supabaseClient = null;
/** 基準月 YYYY-MM */
let monthStart = "";
/** 全部歷史 ticks（catalog 內、賣單、excluded=false） */
let allTicks = [];
/**
 * model_key → 當月所有 ticks（陣列，排序由新到舊）
 * @type {Map<string, object[]>}
 */
let ticksByModel = new Map();
/** null = 預設收合；true/false = 使用者按過全展開/收折 */
let expandPreference = null;
/** 當前開啟 modal 的 modelKey */
let openModelKey = null;

/**
 * admin 模式：URL 帶 ?admin=1 時啟用剔除按鈕。
 * 剔除需要 service_role key 或 RLS policy 允許 update excluded。
 * 這裡使用同一個 anon key，需確認 Supabase RLS 允許 update excluded=true。
 */
window._usedExcludeHandler = null;

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
  supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
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

function formatMd(iso) {
  return (iso || "").slice(5);
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

function renderQuoteModal(modelKey) {
  const ticks = ticksByModel.get(modelKey) || [];
  const row = CATALOG_ROWS.find((r) => r.model_key === modelKey);
  const title = [row?.model, row?.capacity, row?.color].filter(Boolean).join(" ") || modelKey;
  if (usedQuoteTitle) usedQuoteTitle.textContent = title;
  if (usedQuoteSubtitle) {
    const cnt = ticks.length;
    usedQuoteSubtitle.textContent = `${monthStart} · 共 ${cnt} 筆報價`;
  }
  if (!usedQuoteList) return;
  if (!ticks.length) {
    usedQuoteList.innerHTML = '<p class="muted">本月無資料</p>';
    return;
  }

  const canExclude = typeof window._usedExcludeHandler === "function";
  usedQuoteList.innerHTML = ticks.map((t) => {
    const mid = (t.from_mid || "").trim();
    const midShort = mid ? mid.slice(-8) : "";
    const who = (t.sender_name || "").trim() || (midShort ? `未知(${midShort})` : "未知");
    const group = (t.chat_name || "").trim();
    const line = (t.raw_line || "").trim();
    const when = formatTickWhen(t);
    const priceStr = formatPrice(t.price);
    const metaBits = [escapeHtml(when), escapeHtml(who), escapeHtml(group || "群組未知")].join(" · ");
    const body = line
      ? `<pre class="used-quote-raw">${escapeHtml(line)}</pre>`
      : `<p class="used-quote-missing muted">此筆無原文（歷史缺欄）。若 LINE 訊息仍在，更新 run.py 後重跑可回填；訊息已不在則無法還原。</p>`;
    const excludeBtn = canExclude
      ? `<button type="button" class="btn-exclude" data-tick-id="${escapeHtml(String(t.id || ""))}" data-model-key="${escapeHtml(modelKey)}" title="標記此筆為錯誤並剔除">⊘ 剔除</button>`
      : "";
    return `
    <article class="used-quote-card${line ? "" : " used-quote-card--missing"}" data-tick-id="${escapeHtml(String(t.id || ""))}">
      <div class="used-quote-meta">
        <span class="used-quote-price">$${escapeHtml(priceStr)}</span>
        ${metaBits}
        ${excludeBtn}
      </div>
      ${body}
    </article>`;
  }).join("");
}

function openModelModal(modelKey) {
  if (!usedQuoteModal) return;
  openModelKey = modelKey;
  renderQuoteModal(modelKey);
  usedQuoteModal.showModal();
}

function closePriceQuotes() {
  usedQuoteModal?.close();
  openModelKey = null;
}

async function fetchAllUsedTicks() {
  const ticksTable = table("SUPABASE_TICKS_TABLE");
  const { start, end } = monthRangeIso(monthStart);
  const selectCols = "id,model_key,price,quote_date,quoted_at,from_mid,sender_name,chat_name,raw_line";
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

function buildTicksByModel(ticks) {
  const byModel = new Map();
  for (const t of ticks) {
    const key = (t.model_key || "").trim();
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key).push(t);
  }
  return byModel;
}

function formatModelRangeHtml(modelKey) {
  const ticks = ticksByModel.get(modelKey);
  if (!ticks || !ticks.length) return '<span class="muted">—</span>';

  const prices = ticks.map((t) => Number(t.price)).filter(Number.isFinite);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const cnt = ticks.length;

  const minBtn = `<button type="button" class="used-price-btn" data-model-key="${escapeHtml(modelKey)}" title="查看本月所有報價">${formatPrice(min)}</button>`;
  const range = min === max
    ? minBtn
    : `${minBtn}<span class="weekly-range-sep">~</span><button type="button" class="used-price-btn" data-model-key="${escapeHtml(modelKey)}" title="查看本月所有報價">${formatPrice(max)}</button>`;

  return `<span class="used-weekly-range">${range}<span class="compact-count">×${cnt}筆</span></span>`;
}

function updateExpandButton() {
  if (!expandAllBtn || !usedPriceList) return;
  const groups = usedPriceList.querySelectorAll("details.model-group");
  if (!groups.length) { expandAllBtn.disabled = true; expandAllBtn.textContent = "全展開"; return; }
  expandAllBtn.disabled = false;
  const allOpen = [...groups].every((g) => g.open);
  expandAllBtn.textContent = allOpen ? "收折" : "全展開";
}

function applyExpandState() {
  if (!usedPriceList) return;
  const groups = usedPriceList.querySelectorAll("details.model-group");
  if (expandPreference !== null) groups.forEach((el) => { el.open = expandPreference; });
  updateExpandButton();
}

function renderList() {
  if (!usedPriceList) return;
  const rows = filteredCatalog();
  if (!rows.length) {
    usedPriceList.innerHTML = '<div class="compact-empty muted">沒有符合搜尋的型號</div>';
    updateExpandButton();
    return;
  }

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.series)) groups.set(row.series, { label: row.series, rows: [] });
    groups.get(row.series).rows.push(row);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) =>
    a[1].label.localeCompare(b[1].label, "zh-Hant", { numeric: true }),
  );

  let withData = 0;
  usedPriceList.innerHTML = sortedGroups.map(([, group]) => {
    const sortedRows = [...group.rows].sort((a, b) => {
      const cap = capacityRank(a.capacity) - capacityRank(b.capacity);
      if (cap) return cap;
      return String(a.color || "").localeCompare(String(b.color || ""), "zh-Hant");
    });

    const rowsHtml = sortedRows.map((row) => {
      const hasTicks = (ticksByModel.get(row.model_key) || []).length > 0;
      if (hasTicks) withData += 1;
      return `
      <div class="used-spec-block">
        <div class="compact-row used-market-row">
          <span class="compact-model">${escapeHtml(row.model)}</span>
          <span class="compact-capacity">${escapeHtml(row.capacity || "—")}</span>
          <span class="compact-color">${escapeHtml(row.color || "—")}</span>
          <span class="compact-discount-low">${formatModelRangeHtml(row.model_key)}</span>
        </div>
      </div>`;
    }).join("");

    return `
    <details class="model-group">
      <summary class="model-group-summary">
        <span class="model-group-name">${escapeHtml(group.label)}</span>
        <span class="model-group-meta">${sortedRows.length} 規格</span>
      </summary>
      <div class="model-group-body">
        <div class="compact-row compact-header used-market-row">
          <span>型號</span><span>容量</span><span>顏色</span><span>本月行情（點看所有報價）</span>
        </div>
        ${rowsHtml}
      </div>
    </details>`;
  }).join("");

  applyExpandState();
  setStatus(`${monthStart} · 目錄 ${rows.length} 規格 · 有行情 ${withData} · 賣單`);
}

function updateMonthChrome() {
  if (monthLabel) monthLabel.textContent = `${monthStart}`;
  if (monthHint) monthHint.textContent = "月份行情 · 點型號查看每筆報價 · 賣單";
  const isCurrent = monthStart === currentMonth();
  if (monthNextBtn) monthNextBtn.disabled = isCurrent;
  if (monthTodayBtn) monthTodayBtn.disabled = isCurrent;
}

async function refresh() {
  updateMonthChrome();
  try {
    setStatus("載入二手賣單中…");
    allTicks = await fetchAllUsedTicks();
    ticksByModel = buildTicksByModel(allTicks);
    renderList();
  } catch (error) {
    ticksByModel = new Map();
    if (usedPriceList) usedPriceList.innerHTML = "";
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
expandAllBtn?.addEventListener("click", () => {
  const groups = [...(usedPriceList?.querySelectorAll("details.model-group") || [])];
  if (!groups.length) return;
  const expand = !groups.every((g) => g.open);
  expandPreference = expand;
  groups.forEach((el) => { el.open = expand; });
  updateExpandButton();
});
usedPriceList?.addEventListener("toggle", (event) => {
  if (event.target.classList?.contains("model-group")) updateExpandButton();
}, true);
usedPriceList?.addEventListener("click", (event) => {
  const btn = event.target.closest(".used-price-btn");
  if (!btn) return;
  event.preventDefault();
  openModelModal(btn.dataset.modelKey);
});

usedQuoteClose?.addEventListener("click", closePriceQuotes);
usedQuoteModal?.addEventListener("click", (event) => {
  if (event.target === usedQuoteModal) closePriceQuotes();
});

usedQuoteList?.addEventListener("click", async (event) => {
  const btn = event.target.closest(".btn-exclude");
  if (!btn || typeof window._usedExcludeHandler !== "function") return;
  const tickId = btn.dataset.tickId;
  if (!tickId) return;
  btn.disabled = true;
  btn.textContent = "剔除中…";
  try {
    await window._usedExcludeHandler(tickId);
    const card = btn.closest(".used-quote-card");
    if (card) {
      card.classList.add("used-quote-card--excluded");
      card.querySelector(".btn-exclude").textContent = "✓ 已剔除";
    }
    allTicks = allTicks.filter((t) => String(t.id) !== String(tickId));
    ticksByModel = buildTicksByModel(allTicks);
    renderList();
    if (openModelKey) renderQuoteModal(openModelKey);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "⊘ 剔除";
    alert(`剔除失敗：${err.message || err}`);
  }
});

function isAdminMode() {
  return new URLSearchParams(window.location.search).get("admin") === "1";
}

async function boot() {
  try {
    initClient();
    if (isAdminMode()) {
      window._usedExcludeHandler = async function excludeUsedTick(tickId) {
        if (!tickId) throw new Error("缺少 tick id");
        const { error } = await supabaseClient
          .from(table("SUPABASE_TICKS_TABLE"))
          .update({ excluded: true })
          .eq("id", tickId);
        if (error) throw new Error(error.message || "剔除失敗");
      };
      document.title = "二手行情（Admin）";
      const hint = document.querySelector(".used-week-hint");
      if (hint) hint.textContent += " · Admin 模式：可剔除錯誤報價";
    }
    monthStart = currentMonth();
    await refresh();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
}

boot();
