/** 與 line_price_pipeline.build_used_catalog() 同步的固定二手目錄 */
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
/** 基準月沒報價時最多往前撈幾個月 */
const LOOKBACK_MONTHS = 3;
const RULES_TABLE = "tick_exclusion_rules";

const monthPrevBtn = document.getElementById("weekPrevBtn");
const monthNextBtn = document.getElementById("weekNextBtn");
const monthTodayBtn = document.getElementById("weekTodayBtn");
const monthLabel = document.getElementById("weekLabel");
const monthHint = document.getElementById("weekHint");
const modelSearch = document.getElementById("modelSearch");
const onlyWithData = document.getElementById("onlyWithData");
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
/** 基準月與回溯範圍內的 ticks（catalog 內、賣單；admin 模式含已剔除） */
let allTicks = [];
/**
 * `model_key|YYYY-MM` → 該月所有 ticks
 * @type {Map<string, object[]>}
 */
let ticksByModelMonth = new Map();
/**
 * model_key → { month, ticks, isLookback }；month 為實際採用的月份。
 * 基準月有報價就用基準月，否則往前找到第一個有報價的月份。
 * @type {Map<string, object>}
 */
let resolvedByModel = new Map();
/** 當前開啟 modal 的 modelKey */
let openModelKey = null;

/**
 * admin 模式（URL 帶 ?admin=1）才會被指派，用來切換 excluded。
 * 用的是 anon key，Supabase 需有允許 update excluded 兩個方向的 RLS policy。
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

/** 基準月往前 LOOKBACK_MONTHS 個月，由新到舊 */
function candidateMonths(ym) {
  const months = [];
  for (let i = 0; i <= LOOKBACK_MONTHS; i += 1) months.push(addMonthsYM(ym, -i));
  return months;
}

/** 涵蓋基準月與整個回溯範圍的日期區間，一次 query 撈完 */
function lookbackRangeIso(ym) {
  return {
    start: monthRangeIso(addMonthsYM(ym, -LOOKBACK_MONTHS)).start,
    end: monthRangeIso(ym).end,
  };
}

function monthShortLabel(ym) {
  return `${Number((ym || "").slice(5, 7))}月`;
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
  const hit = resolvedByModel.get(modelKey);
  // 回溯時看的是來源月份；完全沒行情時退回基準月（admin 可能仍有已剔除紀錄）
  const shownMonth = hit?.month || monthStart;
  const ticks = hit?.ticks || ticksByModelMonth.get(`${modelKey}|${monthStart}`) || [];
  const row = CATALOG_ROWS.find((r) => r.model_key === modelKey);
  const title = [row?.model, row?.capacity, row?.color].filter(Boolean).join(" ") || modelKey;
  if (usedQuoteTitle) usedQuoteTitle.textContent = title;
  const excludedCount = ticks.filter((t) => t.excluded).length;
  if (usedQuoteSubtitle) {
    const activeCount = ticks.length - excludedCount;
    const lookbackBit = hit?.isLookback ? "（本月無報價，回溯）" : "";
    const tail = excludedCount ? ` · 已剔除 ${excludedCount} 筆（不計入行情）` : "";
    usedQuoteSubtitle.textContent = `${shownMonth}${lookbackBit} · 共 ${activeCount} 筆報價${tail}`;
  }
  if (!usedQuoteList) return;
  if (!ticks.length) {
    usedQuoteList.innerHTML = '<p class="muted">這個月份沒有資料</p>';
    return;
  }

  const canExclude = typeof window._usedExcludeHandler === "function";
  // 已剔除的排到最後，避免干擾閱讀
  const ordered = [...ticks].sort((a, b) => Number(!!a.excluded) - Number(!!b.excluded));
  usedQuoteList.innerHTML = ordered.map((t) => {
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
    const tickId = escapeHtml(String(t.id || ""));
    const hasLine = !!line;
    let actionBtn = "";
    if (canExclude && t.excluded) {
      actionBtn = `<button type="button" class="btn-restore" data-tick-id="${tickId}" data-next="0" title="取消剔除，重新計入行情">↺ 取消剔除</button>`;
    } else if (canExclude) {
      // 同一盤商每天貼同一份清單，整句建規則才能一次擋掉過去與未來的重複
      const ruleBtn = hasLine
        ? `<button type="button" class="btn-exclude-rule" data-tick-id="${tickId}" title="建立規則：這句原文以後出現都自動剔除">⊘ 剔除這句話</button>`
        : "";
      actionBtn = `${ruleBtn}<button type="button" class="btn-exclude" data-tick-id="${tickId}" data-next="1" title="只剔除這一筆">⊘ 只這筆</button>`;
    }
    const stateCls = t.excluded ? " used-quote-card--excluded" : (line ? "" : " used-quote-card--missing");
    const excludedTag = t.excluded ? '<span class="used-quote-tag">已剔除</span>' : "";
    return `
    <article class="used-quote-card${stateCls}" data-tick-id="${tickId}">
      <div class="used-quote-meta">
        <span class="used-quote-price">$${escapeHtml(priceStr)}</span>
        ${metaBits}
        ${excludedTag}
        ${actionBtn}
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
  const { start, end } = lookbackRangeIso(monthStart);
  const selectCols = "id,model_key,price,quote_date,quoted_at,from_mid,sender_name,chat_name,raw_line,excluded";
  const collected = [];
  let from = 0;

  while (true) {
    // admin 模式要看得到已剔除的筆數才能復原，一般模式直接濾掉。
    let query = supabaseClient
      .from(ticksTable)
      .select(selectCols)
      .eq("category", "used")
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

function buildTicksByModelMonth(ticks) {
  const byKey = new Map();
  for (const t of ticks) {
    const modelKey = (t.model_key || "").trim();
    const month = String(t.quote_date || "").slice(0, 7);
    if (!modelKey || !month) continue;
    const key = `${modelKey}|${month}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(t);
  }
  return byKey;
}

/**
 * 每個型號挑出「基準月，沒有就往前找」的第一個有報價月份。
 * 行情區間只算沒被剔除的筆數，但 admin 要看得到剔除紀錄，
 * 所以 ticks 保留全部、另外回傳 active 供計算。
 */
function buildResolvedByModel() {
  const months = candidateMonths(monthStart);
  const resolved = new Map();
  for (const key of USED_CATALOG_KEYS) {
    for (const month of months) {
      const ticks = ticksByModelMonth.get(`${key}|${month}`) || [];
      const active = ticks.filter((t) => !t.excluded);
      if (!active.length) continue;
      resolved.set(key, { month, ticks, active, isLookback: month !== monthStart });
      break;
    }
  }
  return resolved;
}

function formatModelRangeHtml(modelKey) {
  const hit = resolvedByModel.get(modelKey);
  if (!hit) return '<span class="muted">—</span>';

  const prices = hit.active.map((t) => Number(t.price)).filter(Number.isFinite);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const cnt = hit.active.length;

  const btn = (value) =>
    `<button type="button" class="used-price-btn" data-model-key="${escapeHtml(modelKey)}" title="查看 ${hit.month} 所有報價">${formatPrice(value)}</button>`;
  const range = min === max
    ? btn(min)
    : `${btn(min)}<span class="weekly-range-sep">~</span>${btn(max)}`;

  return `<span class="used-weekly-range">${range}<span class="compact-count">×${cnt}筆</span></span>`;
}

function formatSourceMonthHtml(modelKey) {
  const hit = resolvedByModel.get(modelKey);
  if (!hit) return '<span class="muted">—</span>';
  if (!hit.isLookback) return '<span class="used-month-current">本月</span>';
  return `<span class="used-month-lookback" title="${hit.month} 的報價（本月尚無）">${monthShortLabel(hit.month)} 回溯</span>`;
}

/** 目錄順序：系列 → 容量 → 顏色，攤平成一張表 */
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
  if (!usedPriceList) return;
  let rows = sortedCatalogRows(filteredCatalog());
  const totalSpecs = rows.length;
  const withData = rows.filter((row) => resolvedByModel.has(row.model_key)).length;
  if (onlyWithData?.checked) rows = rows.filter((row) => resolvedByModel.has(row.model_key));

  if (!rows.length) {
    usedPriceList.innerHTML = '<div class="compact-empty muted">沒有符合條件的型號</div>';
    setStatus(`${monthStart} · 目錄 ${totalSpecs} 規格 · 有行情 0`);
    return;
  }

  const header = `
    <div class="compact-row compact-header used-market-row">
      <span>型號</span><span>容量</span><span>顏色</span><span>資料月份</span><span>行情（點看報價）</span>
    </div>`;

  const body = rows.map((row) => `
    <div class="compact-row used-market-row">
      <span class="compact-model">${escapeHtml(row.model)}</span>
      <span class="compact-capacity">${escapeHtml(row.capacity || "—")}</span>
      <span class="compact-color">${escapeHtml(row.color || "—")}</span>
      <span class="compact-source-month">${formatSourceMonthHtml(row.model_key)}</span>
      <span class="compact-discount-low">${formatModelRangeHtml(row.model_key)}</span>
    </div>`).join("");

  usedPriceList.innerHTML = header + body;

  const lookbackCount = [...resolvedByModel.values()].filter((h) => h.isLookback).length;
  const excludedCount = allTicks.filter((t) => t.excluded).length;
  const bits = [
    `${monthStart}`,
    `目錄 ${totalSpecs} 規格`,
    `有行情 ${withData}`,
  ];
  if (lookbackCount) bits.push(`回溯 ${lookbackCount}`);
  if (excludedCount) bits.push(`已剔除 ${excludedCount} 筆`);
  bits.push("賣單");
  setStatus(bits.join(" · "));
}

function updateMonthChrome() {
  if (monthLabel) monthLabel.textContent = `${monthStart}`;
  const isCurrent = monthStart === currentMonth();
  if (monthNextBtn) monthNextBtn.disabled = isCurrent;
  if (monthTodayBtn) monthTodayBtn.disabled = isCurrent;
}

async function refresh() {
  updateMonthChrome();
  try {
    setStatus("載入二手賣單中…");
    allTicks = await fetchAllUsedTicks();
    ticksByModelMonth = buildTicksByModelMonth(allTicks);
    resolvedByModel = buildResolvedByModel();
    renderList();
  } catch (error) {
    ticksByModelMonth = new Map();
    resolvedByModel = new Map();
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
onlyWithData?.addEventListener("change", () => renderList());
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

function rebuildFromTicks() {
  ticksByModelMonth = buildTicksByModelMonth(allTicks);
  resolvedByModel = buildResolvedByModel();
  renderList();
  if (openModelKey) renderQuoteModal(openModelKey);
}

usedQuoteList?.addEventListener("click", async (event) => {
  const btn = event.target.closest(".btn-exclude, .btn-restore, .btn-exclude-rule");
  if (!btn) return;
  const tickId = btn.dataset.tickId;
  if (!tickId) return;
  const tick = allTicks.find((t) => String(t.id) === String(tickId));
  if (!tick) return;

  const isRule = btn.classList.contains("btn-exclude-rule");
  const isRestore = btn.classList.contains("btn-restore");
  const handler = isRule ? window._usedRuleHandler : window._usedExcludeHandler;
  if (typeof handler !== "function") return;

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = isRestore ? "復原中…" : "剔除中…";
  try {
    if (isRule) {
      const affected = await window._usedRuleHandler(tick.raw_line);
      const line = (tick.raw_line || "").trim();
      for (const t of allTicks) {
        if ((t.raw_line || "").trim() === line) t.excluded = true;
      }
      rebuildFromTicks();
      alert(`已建立規則，這句原文的 ${affected} 筆報價全部剔除，以後再出現也會自動擋掉。`);
      return;
    }
    if (isRestore) {
      // 若這筆是規則擋掉的，只復原單筆會在下次上傳時又被擋回去
      const affected = await window._usedRestoreHandler(tick);
      const line = (tick.raw_line || "").trim();
      if (affected.ruleRemoved && line) {
        for (const t of allTicks) {
          if ((t.raw_line || "").trim() === line) t.excluded = false;
        }
      } else {
        tick.excluded = false;
      }
      rebuildFromTicks();
      return;
    }
    await window._usedExcludeHandler(tickId, true);
    tick.excluded = true;
    rebuildFromTicks();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = originalText;
    alert(`${isRestore ? "取消剔除" : "剔除"}失敗：${err.message || err}`);
  }
});

function isAdminMode() {
  return new URLSearchParams(window.location.search).get("admin") === "1";
}

function installAdminHandlers() {
  const ticksTable = table("SUPABASE_TICKS_TABLE");

  window._usedExcludeHandler = async function setTickExcluded(tickId, excluded = true) {
    if (!tickId) throw new Error("缺少 tick id");
    const { data, error } = await supabaseClient
      .from(ticksTable)
      .update({ excluded })
      .eq("id", tickId)
      .select("id");
    if (error) throw new Error(error.message || "更新失敗");
    if (!data?.length) throw new Error("沒有更新到任何列（檢查 Supabase RLS update policy）");
  };

  /** 建規則 + 把資料庫裡同一句原文的既有 tick 全部剔除，回傳影響筆數 */
  window._usedRuleHandler = async function excludeByRawLine(rawLine) {
    const line = (rawLine || "").trim();
    if (!line) throw new Error("這筆沒有原文，只能用「只這筆」剔除");

    const { error: ruleError } = await supabaseClient
      .from(RULES_TABLE)
      .upsert(
        { category: "used", raw_line: line, model_key: "", reason: "前台標記解析錯誤", active: true },
        { onConflict: "category,raw_line,model_key" },
      );
    if (ruleError) {
      const hint = ruleError.code === "42P01"
        ? "找不到 tick_exclusion_rules，請先在 Supabase 執行 supabase_migration_v15"
        : ruleError.message;
      throw new Error(hint || "規則建立失敗");
    }

    const { data, error } = await supabaseClient
      .from(ticksTable)
      .update({ excluded: true })
      .eq("category", "used")
      .eq("raw_line", line)
      .select("id");
    if (error) throw new Error(error.message || "套用規則失敗");
    return data?.length || 0;
  };

  /** 取消剔除：有規則就連規則一起移除，否則只復原單筆 */
  window._usedRestoreHandler = async function restoreTick(tick) {
    const line = (tick.raw_line || "").trim();
    if (line) {
      const { data: rules, error: findError } = await supabaseClient
        .from(RULES_TABLE)
        .select("id")
        .eq("category", "used")
        .eq("raw_line", line)
        .eq("model_key", "");
      if (findError && findError.code !== "42P01") throw new Error(findError.message);

      if (rules?.length) {
        const { error: delError } = await supabaseClient
          .from(RULES_TABLE).delete().eq("category", "used").eq("raw_line", line).eq("model_key", "");
        if (delError) throw new Error(delError.message || "規則刪除失敗");
        const { error } = await supabaseClient
          .from(ticksTable).update({ excluded: false }).eq("category", "used").eq("raw_line", line);
        if (error) throw new Error(error.message || "復原失敗");
        return { ruleRemoved: true };
      }
    }
    await window._usedExcludeHandler(tick.id, false);
    return { ruleRemoved: false };
  };
}

async function boot() {
  try {
    initClient();
    if (isAdminMode()) {
      installAdminHandlers();
      document.title = "二手行情（Admin）";
      const hint = document.querySelector(".used-week-hint");
      if (hint) hint.textContent += " · Admin：可整句剔除／單筆剔除";
    }
    monthStart = currentMonth();
    await refresh();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
}

boot();
