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
const SHIFT_THRESHOLD = 500;
const MAX_SHIFTS_SHOWN = 5;
const TICK_PAGE = 1000;
const CATALOG_KEY_SET = new Set(USED_CATALOG_KEYS);

const weekPrevBtn = document.getElementById("weekPrevBtn");
const weekNextBtn = document.getElementById("weekNextBtn");
const weekTodayBtn = document.getElementById("weekTodayBtn");
const weekLabel = document.getElementById("weekLabel");
const weekHint = document.getElementById("weekHint");
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
/** 基準週週一 YYYY-MM-DD */
let weekStart = "";
/** 全部歷史 ticks（catalog 內、賣單） */
let allTicks = [];
/**
 * @type {Map<string, {
 *   min: number, max: number,
 *   minCount: number, maxCount: number,
 *   minDate: string, maxDate: string,
 *   sourceWeekStart: string, sourceWeekEnd: string,
 *   isLookback: boolean,
 *   minTicks: object[], maxTicks: object[],
 *   shifts: object[],
 * }>}
 */
let rangeByModelKey = new Map();
/** null = 預設收合；true/false = 使用者按過全展開/收折 */
let expandPreference = null;

function table(name) {
  const value = window[name];
  if (typeof value === "string" && value && !value.startsWith("你的")) return value;
  const fallbacks = { SUPABASE_TICKS_TABLE: "quote_ticks" };
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

function addDaysIso(isoDate, delta) {
  const d = new Date(`${isoDate}T12:00:00+08:00`);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function calendarWeekContaining(referenceDate) {
  const weekdays = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" })
    .format(new Date(`${referenceDate}T12:00:00+08:00`));
  const dayIndex = weekdays[wd] ?? 0;
  const start = addDaysIso(referenceDate, -dayIndex);
  return { weekStart: start, weekEnd: addDaysIso(start, 6) };
}

function currentWeekStart() {
  return calendarWeekContaining(taipeiToday()).weekStart;
}

function formatPrice(price) {
  return Number(price).toLocaleString("zh-TW");
}

function formatMd(iso) {
  return (iso || "").slice(5);
}

function formatWeekLabel(start, end) {
  return `${start.slice(0, 4)} ${formatMd(start)}～${formatMd(end)}`;
}

function formatMoneyDelta(delta) {
  if (delta > 0) return `漲 ${formatPrice(delta)}`;
  if (delta < 0) return `跌 ${formatPrice(Math.abs(delta))}`;
  return "持平";
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

function parseCatalogEntry(modelKey) {
  const parts = modelKey.trim().split(/\s+/);
  const series = parts[0] || modelKey;
  return {
    model_key: modelKey,
    series,
    model: series,
    capacity: parts[1] || "",
    color: parts.slice(2).join(" ") || "",
  };
}

const CATALOG_ROWS = USED_CATALOG_KEYS.map(parseCatalogEntry);

function capacityRank(cap) {
  return CAPACITY_RANK[String(cap || "").trim()] || 99;
}

function personKeyFromTick(t) {
  return (t.from_mid || "").trim()
    || (t.sender_name || "").trim()
    || `${t.quoted_at || ""}|${t.raw_line || ""}`;
}

function tickDate(t) {
  return String(t.quote_date || "").slice(0, 10);
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

/** 從一組 ticks 算出最低／最高（人次、最近日期、該價全部原文 ticks） */
function summarizeTicks(ticks) {
  const pricePeople = new Map();
  const priceTicks = new Map();
  const priceLatestDate = new Map();

  for (const t of ticks || []) {
    if (t.price == null) continue;
    const price = Number(t.price);
    if (!Number.isFinite(price)) continue;
    const day = tickDate(t);
    if (!pricePeople.has(price)) {
      pricePeople.set(price, new Set());
      priceTicks.set(price, []);
      priceLatestDate.set(price, day);
    }
    pricePeople.get(price).add(personKeyFromTick(t));
    priceTicks.get(price).push(t);
    if (day && day > (priceLatestDate.get(price) || "")) {
      priceLatestDate.set(price, day);
    }
  }

  const prices = [...pricePeople.keys()];
  if (!prices.length) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return {
    min,
    max,
    minCount: pricePeople.get(min).size,
    maxCount: pricePeople.get(max).size,
    minDate: priceLatestDate.get(min) || "",
    maxDate: priceLatestDate.get(max) || "",
    minTicks: priceTicks.get(min) || [],
    maxTicks: priceTicks.get(max) || [],
  };
}

/** model_key → weekStart → ticks[] */
function groupTicksByModelWeek(ticks, untilDate) {
  const byModel = new Map();
  for (const t of ticks || []) {
    const modelKey = (t.model_key || "").trim();
    if (!CATALOG_KEY_SET.has(modelKey)) continue;
    const day = tickDate(t);
    if (!day || day > untilDate) continue;
    if (t.price == null) continue;
    const ws = calendarWeekContaining(day).weekStart;
    if (!byModel.has(modelKey)) byModel.set(modelKey, new Map());
    const weeks = byModel.get(modelKey);
    if (!weeks.has(ws)) weeks.set(ws, []);
    weeks.get(ws).push(t);
  }
  return byModel;
}

function buildWeeklyStats(weekTicks) {
  const stats = summarizeTicks(weekTicks);
  if (!stats) return null;
  return {
    min: stats.min,
    max: stats.max,
    minCount: stats.minCount,
    maxCount: stats.maxCount,
    tickCount: weekTicks.length,
  };
}

function detectShifts(weeklyMap) {
  const starts = [...weeklyMap.keys()].sort();
  const shifts = [];
  for (let i = 1; i < starts.length; i += 1) {
    const prevStart = starts[i - 1];
    const curStart = starts[i];
    const prev = weeklyMap.get(prevStart);
    const cur = weeklyMap.get(curStart);
    if (!prev || !cur) continue;
    const minDelta = cur.min - prev.min;
    const maxDelta = cur.max - prev.max;
    if (Math.abs(minDelta) < SHIFT_THRESHOLD && Math.abs(maxDelta) < SHIFT_THRESHOLD) continue;
    shifts.push({
      weekStart: curStart,
      weekEnd: addDaysIso(curStart, 6),
      prevWeekStart: prevStart,
      prevMin: prev.min,
      prevMax: prev.max,
      min: cur.min,
      max: cur.max,
      minDelta,
      maxDelta,
    });
  }
  return shifts.reverse();
}

function buildRangeForModel(modelKey, byModelWeek, anchorWeekStart) {
  const weeks = byModelWeek.get(modelKey);
  if (!weeks || !weeks.size) return null;

  const weekStarts = [...weeks.keys()].filter((ws) => ws <= anchorWeekStart).sort().reverse();
  if (!weekStarts.length) return null;

  const sourceWeekStart = weekStarts.includes(anchorWeekStart)
    ? anchorWeekStart
    : weekStarts[0];
  const sourceTicks = weeks.get(sourceWeekStart) || [];
  const summary = summarizeTicks(sourceTicks);
  if (!summary) return null;

  const weeklyStats = new Map();
  for (const [ws, list] of weeks) {
    if (ws > anchorWeekStart) continue;
    const st = buildWeeklyStats(list);
    if (st) weeklyStats.set(ws, st);
  }

  return {
    ...summary,
    sourceWeekStart,
    sourceWeekEnd: addDaysIso(sourceWeekStart, 6),
    isLookback: sourceWeekStart !== anchorWeekStart,
    shifts: detectShifts(weeklyStats).slice(0, MAX_SHIFTS_SHOWN),
  };
}

function rebuildRanges() {
  const weekEnd = addDaysIso(weekStart, 6);
  const until = weekEnd > taipeiToday() ? taipeiToday() : weekEnd;
  const byModelWeek = groupTicksByModelWeek(allTicks, until);
  const merged = new Map();
  for (const row of CATALOG_ROWS) {
    const info = buildRangeForModel(row.model_key, byModelWeek, weekStart);
    if (info) merged.set(row.model_key, info);
  }
  rangeByModelKey = merged;
}

async function fetchAllUsedTicks() {
  const ticksTable = table("SUPABASE_TICKS_TABLE");
  const selectCols = "model_key,price,quote_date,quoted_at,from_mid,sender_name,chat_name,raw_line";
  const collected = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabaseClient
      .from(ticksTable)
      .select(selectCols)
      .eq("category", "used")
      .eq("trade_side", "sell")
      .not("price", "is", null)
      .order("quote_date", { ascending: false })
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

function formatRangeHtml(modelKey, info) {
  if (!info) return '<span class="muted">—</span>';

  const minBtn = `<button type="button" class="used-price-btn" data-model-key="${escapeHtml(modelKey)}" data-side="min" title="查看最低價原文">${formatPrice(info.min)}<span class="compact-count">×${info.minCount}</span><span class="used-price-date">(${formatMd(info.minDate) || "—"})</span></button>`;
  const maxBtn = `<button type="button" class="used-price-btn" data-model-key="${escapeHtml(modelKey)}" data-side="max" title="查看最高價原文">${formatPrice(info.max)}<span class="compact-count">×${info.maxCount}</span><span class="used-price-date">(${formatMd(info.maxDate) || "—"})</span></button>`;

  let rangeHtml;
  if (info.min === info.max) {
    rangeHtml = minBtn;
  } else {
    rangeHtml = `${minBtn}<span class="weekly-range-sep">~</span>${maxBtn}`;
  }

  const lookbackTag = info.isLookback
    ? `<span class="weekly-period-tag">回溯 ${formatMd(info.sourceWeekStart)}～${formatMd(info.sourceWeekEnd)}</span>`
    : "";
  const cls = info.isLookback ? "used-weekly-range used-weekly-range--prev" : "used-weekly-range";
  return `<span class="${cls}">${rangeHtml}${lookbackTag}</span>`;
}

function formatShiftsHtml(shifts) {
  if (!shifts?.length) return "";
  const items = shifts.map((s) => {
    const parts = [];
    if (Math.abs(s.minDelta) >= SHIFT_THRESHOLD) {
      parts.push(`最低 ${formatPrice(s.prevMin)}→${formatPrice(s.min)}（${formatMoneyDelta(s.minDelta)}）`);
    }
    if (Math.abs(s.maxDelta) >= SHIFT_THRESHOLD) {
      parts.push(`最高 ${formatPrice(s.prevMax)}→${formatPrice(s.max)}（${formatMoneyDelta(s.maxDelta)}）`);
    }
    return `<li><span class="used-shift-week">${formatMd(s.weekStart)}週</span> ${escapeHtml(parts.join(" · "))}</li>`;
  }).join("");
  return `<ul class="used-shift-list">${items}</ul>`;
}

function updateExpandButton() {
  if (!expandAllBtn || !usedPriceList) return;
  const groups = usedPriceList.querySelectorAll("details.model-group");
  if (!groups.length) {
    expandAllBtn.disabled = true;
    expandAllBtn.textContent = "全展開";
    return;
  }
  expandAllBtn.disabled = false;
  const allOpen = [...groups].every((g) => g.open);
  expandAllBtn.textContent = allOpen ? "收折" : "全展開";
}

function applyExpandState() {
  if (!usedPriceList) return;
  const groups = usedPriceList.querySelectorAll("details.model-group");
  if (expandPreference !== null) {
    groups.forEach((el) => { el.open = expandPreference; });
  }
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
    if (!groups.has(row.series)) {
      groups.set(row.series, { label: row.series, rows: [] });
    }
    groups.get(row.series).rows.push(row);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) =>
    a[1].label.localeCompare(b[1].label, "zh-Hant", { numeric: true }),
  );

  let withRange = 0;
  let lookbackCount = 0;
  let shiftModels = 0;

  usedPriceList.innerHTML = sortedGroups.map(([, group]) => {
    const sortedRows = [...group.rows].sort((a, b) => {
      const cap = capacityRank(a.capacity) - capacityRank(b.capacity);
      if (cap) return cap;
      return String(a.color || "").localeCompare(String(b.color || ""), "zh-Hant");
    });

    const rowsHtml = sortedRows.map((row) => {
      const info = rangeByModelKey.get(row.model_key);
      if (info) {
        withRange += 1;
        if (info.isLookback) lookbackCount += 1;
        if (info.shifts?.length) shiftModels += 1;
      }
      const shiftsHtml = formatShiftsHtml(info?.shifts);
      return `
      <div class="used-spec-block">
        <div class="compact-row used-market-row">
          <span class="compact-model">${escapeHtml(row.model)}</span>
          <span class="compact-capacity">${escapeHtml(row.capacity || "—")}</span>
          <span class="compact-color">${escapeHtml(row.color || "—")}</span>
          <span class="compact-discount-low">${formatRangeHtml(row.model_key, info)}</span>
        </div>
        ${shiftsHtml}
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
          <span>型號</span><span>容量</span><span>顏色</span><span>行情（點價看原文）</span>
        </div>
        ${rowsHtml}
      </div>
    </details>`;
  }).join("");

  applyExpandState();

  const weekEnd = addDaysIso(weekStart, 6);
  const parts = [
    `目錄 ${rows.length} 規格`,
    `有行情 ${withRange}`,
  ];
  if (lookbackCount) parts.push(`回溯填入 ${lookbackCount}`);
  if (shiftModels) parts.push(`有大變動 ${shiftModels}`);
  setStatus(`${formatWeekLabel(weekStart, weekEnd)} · ${parts.join(" · ")} · 門檻 $${SHIFT_THRESHOLD}`);
}

function updateWeekChrome() {
  const end = addDaysIso(weekStart, 6);
  if (weekLabel) weekLabel.textContent = formatWeekLabel(weekStart, end);
  const isCurrent = weekStart === currentWeekStart();
  if (weekHint) {
    weekHint.textContent = isCurrent
      ? "本週基準 · 沒資料往回推 · 賣單"
      : "基準週 · 沒資料往回推 · 賣單";
  }
  if (weekNextBtn) weekNextBtn.disabled = weekStart >= currentWeekStart();
  if (weekTodayBtn) weekTodayBtn.disabled = isCurrent;
}

function formatTickWhen(t) {
  const raw = t.quoted_at || t.quote_date || "";
  if (!raw) return "—";
  const d = new Date(String(raw).trim().replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 16);
  return d.toLocaleString("zh-TW", {
    timeZone: TIMEZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function openPriceQuotes(modelKey, side) {
  const info = rangeByModelKey.get(modelKey);
  if (!info || !usedQuoteModal) return;
  const ticks = side === "max" ? info.maxTicks : info.minTicks;
  const price = side === "max" ? info.max : info.min;
  const label = side === "max" ? "最高" : "最低";
  const row = CATALOG_ROWS.find((r) => r.model_key === modelKey);
  const title = [row?.model, row?.capacity, row?.color].filter(Boolean).join(" ") || modelKey;

  if (usedQuoteTitle) usedQuoteTitle.textContent = `${title} · ${label} ${formatPrice(price)}`;
  if (usedQuoteSubtitle) {
    usedQuoteSubtitle.textContent = `來源週 ${formatMd(info.sourceWeekStart)}～${formatMd(info.sourceWeekEnd)} · 共 ${ticks.length} 則`;
  }

  const sorted = [...ticks].sort((a, b) => String(b.quoted_at || b.quote_date || "").localeCompare(String(a.quoted_at || a.quote_date || "")));
  if (usedQuoteList) {
    if (!sorted.length) {
      usedQuoteList.innerHTML = '<p class="muted">沒有報價列</p>';
    } else {
      usedQuoteList.innerHTML = sorted.map((t) => {
        const mid = (t.from_mid || "").trim();
        const midShort = mid ? mid.slice(-8) : "";
        const who = (t.sender_name || "").trim() || (midShort ? `未知(${midShort})` : "未知");
        const group = (t.chat_name || "").trim();
        const line = (t.raw_line || "").trim();
        const when = formatTickWhen(t);
        const metaBits = [
          escapeHtml(when),
          escapeHtml(who),
          escapeHtml(group || "群組未知"),
        ].join(" · ");
        const body = line
          ? `<pre class="used-quote-raw">${escapeHtml(line)}</pre>`
          : `<p class="used-quote-missing muted">此筆無原文（歷史缺欄）。若 LINE 訊息仍在，更新 run.py 後重跑可回填；訊息已不在則無法還原。</p>`;
        return `
        <article class="used-quote-card${line ? "" : " used-quote-card--missing"}">
          <div class="used-quote-meta">${metaBits}</div>
          ${body}
        </article>`;
      }).join("");
    }
  }
  usedQuoteModal.showModal();
}

function closePriceQuotes() {
  usedQuoteModal?.close();
}

async function refresh() {
  updateWeekChrome();
  try {
    setStatus("載入全部二手賣單中…");
    if (!allTicks.length) {
      allTicks = await fetchAllUsedTicks();
    }
    rebuildRanges();
    renderList();
  } catch (error) {
    rangeByModelKey = new Map();
    if (usedPriceList) usedPriceList.innerHTML = "";
    setStatus(error.message || String(error), "error");
  }
}

function shiftWeek(deltaWeeks) {
  const next = addDaysIso(weekStart, deltaWeeks * 7);
  const cap = currentWeekStart();
  weekStart = next > cap ? cap : next;
  rebuildRanges();
  updateWeekChrome();
  renderList();
}

weekPrevBtn?.addEventListener("click", () => shiftWeek(-1));
weekNextBtn?.addEventListener("click", () => {
  if (weekStart < currentWeekStart()) shiftWeek(1);
});
weekTodayBtn?.addEventListener("click", () => {
  weekStart = currentWeekStart();
  rebuildRanges();
  updateWeekChrome();
  renderList();
});
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
  openPriceQuotes(btn.dataset.modelKey, btn.dataset.side);
});
usedQuoteClose?.addEventListener("click", closePriceQuotes);
usedQuoteModal?.addEventListener("click", (event) => {
  if (event.target === usedQuoteModal) closePriceQuotes();
});

async function boot() {
  try {
    initClient();
    weekStart = currentWeekStart();
    await refresh();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
}

boot();
