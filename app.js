const CATEGORY_LABELS = { new: "新機", new_ipad: "iPad", accessory: "配件", used: "二手" };
const TIMEZONE = "Asia/Taipei";

const dateSelect = document.getElementById("dateSelect");
const searchInput = document.getElementById("searchInput");
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

let supabaseClient = null;
let allRows = [];
let activeCategory = "new";
let latestSyncTime = null;
let priceChart = null;
let discountChart = null;

function table(name) {
  return window[name] || name;
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

function tradeSideTag(side) {
  if (side === "buy") return '<span class="side-tag side-buy">買單</span>';
  return '<span class="side-tag side-sell">賣單</span>';
}

function renderPriceStats(priceStats) {
  if (!priceStats?.length) return '<span class="muted">無</span>';
  return priceStats.map((item) => {
    const discount = item.discount_zhe ? ` · ${item.discount_zhe}` : "";
    return `<span class="price-chip">${formatPrice(item.price)} × ${item.count}${discount}</span>`;
  }).join("");
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
    tableBody.innerHTML = '<tr><td colspan="10" class="muted">這個分類今天沒有資料</td></tr>';
    return;
  }
  tableBody.innerHTML = rows.map((row, index) => {
    const source = (row.chat_name || "").trim();
    const sourceLabel = source || "—";
    const discount = (row.top_discount_zhe || "").trim() || "—";
    return `
    <tr class="data-row row-clickable" data-row-index="${index}" tabindex="0" role="button" aria-label="查看歷史走勢">
      <td data-label="方向">${tradeSideTag(row.trade_side || "sell")}</td>
      <td data-label="型號"><div class="model-name">${row.model || row.model_key}</div><div class="model-key">${row.model_key || ""}</div></td>
      <td data-label="容量">${row.capacity || "—"}</td>
      <td data-label="顏色">${row.color || "—"}</td>
      <td data-label="建議售價">${formatMaybePrice(row.msrp)}</td>
      <td class="top-price" data-label="熱門價">${formatMaybePrice(row.top_price)}</td>
      <td class="discount-cell" data-label="目前折數">${discount}</td>
      <td data-label="總次數">${row.total_quotes ?? 0}</td>
      <td class="source-cell" data-label="來源群組" title="${row.chat_id || ""}">${sourceLabel}</td>
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
  const filtered = allRows.filter((row) => {
    if (row.category !== activeCategory) return false;
    if (!keyword) return true;
    const haystack = [row.model, row.model_key, row.capacity, row.color, row.chat_name].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(keyword);
  });
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
  tableBody.innerHTML = '<tr><td colspan="10" class="muted">載入中…</td></tr>';
  const { data, error } = await supabaseClient
    .from(table("SUPABASE_TABLE"))
    .select("category,model_key,model,capacity,color,msrp,top_discount_zhe,top_price,total_quotes,price_stats,trade_side,chat_name,updated_at")
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
    await loadAvailableDates();
    if (dateSelect.value) await loadRowsForDate(dateSelect.value);
  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="10" class="error">${error.message}</td></tr>`;
  }
}

dateSelect.addEventListener("change", () => loadRowsForDate(dateSelect.value).catch((e) => {
  tableBody.innerHTML = `<tr><td colspan="10" class="error">${e.message}</td></tr>`;
}));
categoryTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (btn) setActiveCategory(btn.dataset.category);
});
searchInput.addEventListener("input", applyFilters);
reloadBtn.addEventListener("click", () => boot());

tableBody.addEventListener("click", (event) => {
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
    detailModal.close();
  });
}
if (detailModal) {
  detailModal.addEventListener("click", (event) => {
    if (event.target === detailModal) {
      destroyCharts();
      detailModal.close();
    }
  });
}

boot();
