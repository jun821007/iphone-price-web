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

const weekPrevBtn = document.getElementById("weekPrevBtn");
const weekNextBtn = document.getElementById("weekNextBtn");
const weekTodayBtn = document.getElementById("weekTodayBtn");
const weekLabel = document.getElementById("weekLabel");
const weekHint = document.getElementById("weekHint");
const modelSearch = document.getElementById("modelSearch");
const expandAllBtn = document.getElementById("expandAllBtn");
const usedStatus = document.getElementById("usedStatus");
const usedPriceList = document.getElementById("usedPriceList");

let supabaseClient = null;
/** 當前檢視週的週一 YYYY-MM-DD */
let weekStart = "";
/** @type {Map<string, { min: number, max: number, minCount: number, maxCount: number, period: 'this-week'|'last-week' }>} */
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

function formatWeekLabel(start, end) {
  const s = start.slice(5);
  const e = end.slice(5);
  return `${start.slice(0, 4)} ${s}～${e}`;
}

function parseCatalogEntry(modelKey) {
  const parts = modelKey.trim().split(/\s+/);
  const series = parts[0] || modelKey;
  if (/^ipad/i.test(series)) {
    return {
      model_key: modelKey,
      series,
      model: series,
      capacity: parts[1] || "",
      color: parts.slice(2).join(" ") || "",
    };
  }
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
    || `${t.quoted_at || ""}`;
}

function aggregateRanges(ticks) {
  const byModel = new Map();
  for (const t of ticks || []) {
    if (t.price == null) continue;
    const modelKey = (t.model_key || "").trim();
    if (!modelKey) continue;
    const price = Number(t.price);
    if (!Number.isFinite(price)) continue;
    if (!byModel.has(modelKey)) byModel.set(modelKey, { pricePeople: new Map() });
    const bucket = byModel.get(modelKey);
    if (!bucket.pricePeople.has(price)) bucket.pricePeople.set(price, new Set());
    bucket.pricePeople.get(price).add(personKeyFromTick(t));
  }

  const result = new Map();
  for (const [modelKey, bucket] of byModel) {
    const prices = [...bucket.pricePeople.keys()];
    if (!prices.length) continue;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    result.set(modelKey, {
      min,
      max,
      minCount: bucket.pricePeople.get(min)?.size ?? 0,
      maxCount: bucket.pricePeople.get(max)?.size ?? 0,
    });
  }
  return result;
}

function setStatus(text, kind = "") {
  if (!usedStatus) return;
  usedStatus.textContent = text;
  usedStatus.classList.toggle("error", kind === "error");
}

function formatRangeHtml(info) {
  if (!info) return '<span class="muted">—</span>';
  let rangeHtml;
  if (info.min === info.max) {
    rangeHtml = `${formatPrice(info.min)}<span class="compact-count">×${info.minCount}</span>`;
  } else {
    rangeHtml = `${formatPrice(info.min)}<span class="compact-count">×${info.minCount}</span><span class="weekly-range-sep">~</span>${formatPrice(info.max)}<span class="compact-count">×${info.maxCount}</span>`;
  }
  const periodTag = info.period === "last-week" ? '<span class="weekly-period-tag">上週</span>' : "";
  const cls = info.period === "last-week" ? "used-weekly-range used-weekly-range--prev" : "used-weekly-range";
  return `<span class="${cls}">${rangeHtml}${periodTag}</span>`;
}

function filteredCatalog() {
  const kw = (modelSearch?.value || "").trim().toLowerCase();
  if (!kw) return CATALOG_ROWS;
  return CATALOG_ROWS.filter((row) => {
    const hay = [row.model_key, row.series, row.model, row.capacity, row.color].join(" ").toLowerCase();
    return hay.includes(kw);
  });
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
  let fromPrevWeek = 0;

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
        if (info.period === "last-week") fromPrevWeek += 1;
      }
      return `
      <div class="compact-row used-market-row">
        <span class="compact-model">${row.model}</span>
        <span class="compact-capacity">${row.capacity || "—"}</span>
        <span class="compact-color">${row.color || "—"}</span>
        <span class="compact-discount-low">${formatRangeHtml(info)}</span>
      </div>`;
    }).join("");

    return `
    <details class="model-group">
      <summary class="model-group-summary">
        <span class="model-group-name">${group.label}</span>
        <span class="model-group-meta">${sortedRows.length} 規格</span>
      </summary>
      <div class="model-group-body">
        <div class="compact-row compact-header used-market-row">
          <span>型號</span><span>容量</span><span>顏色</span><span>行情</span>
        </div>
        ${rowsHtml}
      </div>
    </details>`;
  }).join("");

  applyExpandState();

  const { weekEnd } = { weekEnd: addDaysIso(weekStart, 6) };
  const total = rows.length;
  const parts = [`目錄 ${total} 規格`, `有行情 ${withRange}`];
  if (fromPrevWeek) parts.push(`其中上週備援 ${fromPrevWeek}`);
  setStatus(`${formatWeekLabel(weekStart, weekEnd)} · ${parts.join(" · ")}`);
}

function updateWeekChrome() {
  const end = addDaysIso(weekStart, 6);
  if (weekLabel) weekLabel.textContent = formatWeekLabel(weekStart, end);
  const isCurrent = weekStart === currentWeekStart();
  if (weekHint) {
    weekHint.textContent = isCurrent ? "本週 · 日曆週 · 賣單" : "日曆週 · 賣單";
  }
  if (weekNextBtn) weekNextBtn.disabled = weekStart >= currentWeekStart();
  if (weekTodayBtn) weekTodayBtn.disabled = isCurrent;
}

async function loadWeekRanges() {
  setStatus("載入行情中…");
  const end = addDaysIso(weekStart, 6);
  const prevStart = addDaysIso(weekStart, -7);
  const prevEnd = addDaysIso(weekStart, -1);
  const ticksTable = table("SUPABASE_TICKS_TABLE");
  const selectCols = "model_key,price,from_mid,sender_name,quoted_at";

  const [thisRes, prevRes] = await Promise.all([
    supabaseClient
      .from(ticksTable)
      .select(selectCols)
      .eq("category", "used")
      .eq("trade_side", "sell")
      .gte("quote_date", weekStart)
      .lte("quote_date", end)
      .limit(15000),
    supabaseClient
      .from(ticksTable)
      .select(selectCols)
      .eq("category", "used")
      .eq("trade_side", "sell")
      .gte("quote_date", prevStart)
      .lte("quote_date", prevEnd)
      .limit(15000),
  ]);

  if (thisRes.error && thisRes.error.code !== "42P01") throw thisRes.error;
  if (prevRes.error && prevRes.error.code !== "42P01") throw prevRes.error;

  const thisMap = aggregateRanges(thisRes.data || []);
  const prevMap = aggregateRanges(prevRes.data || []);
  const merged = new Map();
  for (const row of CATALOG_ROWS) {
    const key = row.model_key;
    if (thisMap.has(key)) {
      merged.set(key, { ...thisMap.get(key), period: "this-week" });
    } else if (prevMap.has(key)) {
      merged.set(key, { ...prevMap.get(key), period: "last-week" });
    }
  }
  rangeByModelKey = merged;
}

async function refresh() {
  updateWeekChrome();
  try {
    await loadWeekRanges();
    renderList();
  } catch (error) {
    rangeByModelKey = new Map();
    usedPriceList.innerHTML = "";
    setStatus(error.message || String(error), "error");
  }
}

function shiftWeek(deltaWeeks) {
  const next = addDaysIso(weekStart, deltaWeeks * 7);
  const cap = currentWeekStart();
  weekStart = next > cap ? cap : next;
  refresh();
}

weekPrevBtn?.addEventListener("click", () => shiftWeek(-1));
weekNextBtn?.addEventListener("click", () => {
  if (weekStart < currentWeekStart()) shiftWeek(1);
});
weekTodayBtn?.addEventListener("click", () => {
  weekStart = currentWeekStart();
  refresh();
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
