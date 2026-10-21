/** 新機庫存：唯讀 in stock 後端 /api/price-web/newphone-stock（Google 試算表「新機庫存」）。
 *  列出庫存中與客訂中，同一規格放同一組；已售出不顯示。客訂中仍計入台數與成本。
 *  驗證用本站 Supabase 登入的 access_token；Supabase 專案或 anon key 換了要通知 in stock 一起改。
 *  建議同行售價另用 anon client 讀 quote_ticks（不帶登入 session），取台北時間今天與昨天的新機與配件同行賣價。 */
const OWN_LABEL = "自有";
const ALL_VALUE = "__all__";
const OWNER_STORAGE_KEY = "ipw-stock-owner";
const DEFAULT_API_BASE = "https://in-stock-production.up.railway.app";
const TICK_PAGE = 1000;
const TAIPEI = "Asia/Taipei";

const ownerSelect = document.getElementById("ownerSelect");
const stockReloadBtn = document.getElementById("stockReloadBtn");
const stockSummary = document.getElementById("stockSummary");
const stockStatus = document.getElementById("stockStatus");
const stockList = document.getElementById("stockList");

let items = [];
let suggestedBySpec = new Map();
let quoteUnavailable = false;
let quoteClient = null;

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function money(v) {
  return `$${Math.round(Number(v) || 0).toLocaleString("en-US")}`;
}

function normText(value) {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

function normCapacity(value) {
  return normText(value).replace(/gb$|g$/, "");
}

const STORAGE_SIZES = ["2048", "1024", "512", "256", "128", "64", "32"];

/** 容量欄黏著顏色，例如 256紅、256GB紅、1TB藍。單位本身不是顏色。 */
function splitCapacityField(capacity) {
  const raw = String(capacity ?? "").trim();
  if (!raw) return { capacity: "", color: "" };
  const withUnit = raw.match(/^(\d+)\s*(tb|gb|t|g)\s*(.*)$/i);
  if (withUnit) {
    const rest = withUnit[3].trim();
    if (rest && !/^(tb|gb|t|g)$/i.test(rest)) {
      return { capacity: `${withUnit[1]}${withUnit[2]}`, color: rest };
    }
    return { capacity: raw, color: "" };
  }
  for (const size of STORAGE_SIZES) {
    if (!raw.startsWith(size)) continue;
    const rest = raw.slice(size.length).trim();
    if (!rest || /^\d/.test(rest) || /^(tb|gb|t|g)$/i.test(rest)) continue;
    return { capacity: size, color: rest };
  }
  return { capacity: raw, color: "" };
}

/** 型號整串含容量（容量欄是空的），例如 18pro max 256紅。從尾巴拆，避免把 18 當成容量。 */
function splitTrailingStorage(model) {
  const raw = String(model ?? "").trim();
  if (!raw) return null;
  const withUnit = raw.match(/^(.*?)(\d+)\s*(tb|gb|t|g)\s*([^\d]*)$/i);
  if (withUnit) {
    const head = withUnit[1].trim();
    const color = withUnit[4].trim();
    if (head || color) return { model: head, capacity: `${withUnit[2]}${withUnit[3]}`, color };
  }
  for (const size of STORAGE_SIZES) {
    const idx = raw.lastIndexOf(size);
    if (idx < 0) continue;
    const before = raw.slice(0, idx);
    const after = raw.slice(idx + size.length);
    if (/\d$/.test(before) || /\d/.test(after)) continue;
    const head = before.trim();
    const color = after.trim();
    if (!head && !color) continue;
    if (/^(tb|gb|t|g)$/i.test(color)) continue;
    return { model: head, capacity: size, color };
  }
  return null;
}

function canonColor(modelKey, color) {
  const c = normText(color);
  if (modelKey !== "18pro" && modelKey !== "18promax") return c;
  if (c === "紅" || c === "酒紅" || c === "勃根地") return "勃根地紅";
  if (c === "冰川藍" || c === "冰藍") return "藍";
  return c;
}

function airpodsSpec(model, capacity, color) {
  const joined = normText(`${model}${capacity}${color}`);
  const hit = joined.includes("airpods5") || joined.includes("airpod5");
  if (!hit || joined.includes("pro")) return null;
  if (joined.includes("無線")) return { model: "airpods5無線充電", capacity: "", color: "" };
  return { model: "airpods5", capacity: "", color: "" };
}

/** 庫存和報價走同一套，才對得上 18 Pro 勃根地紅與 AirPods 5 無線。 */
function matchSpec(model, capacity, color) {
  let m = String(model ?? "").trim();
  let cap = String(capacity ?? "").trim();
  let col = String(color ?? "").trim();

  const capSplit = splitCapacityField(cap);
  cap = capSplit.capacity;
  if (!col && capSplit.color) col = capSplit.color;

  if (!String(cap).trim()) {
    const bundled = splitTrailingStorage(m);
    if (bundled) {
      m = bundled.model;
      cap = bundled.capacity;
      if (!col && bundled.color) col = bundled.color;
    }
  }

  const air = airpodsSpec(m, cap, col);
  if (air) return air;

  const modelKey = normText(m);
  return { model: modelKey, capacity: normCapacity(cap), color: canonColor(modelKey, col) };
}

function specKey(model, capacity, color) {
  const spec = matchSpec(model, capacity, color);
  return `${spec.model}|${spec.capacity}|${spec.color}`;
}

function taipeiToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TAIPEI });
}

function addCalendarDays(ymd, delta) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** 不進位。整數不補小數，小數保留原值。 */
function formatSuggest(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const negative = n < 0;
  const [whole, frac] = String(Math.abs(n)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${frac != null ? `${grouped}.${frac}` : grouped}`;
}

/**
 * 同一規格的報價先取中位數，低於中位數 85% 的不列入，剩下的取最低。
 * 只有一筆就用那一筆。比較用整數比例，避免 0.85 浮點誤差把剛好卡在門檻的價格丟掉。
 */
function suggestFromPrices(prices) {
  if (!prices.length) return null;
  if (prices.length === 1) return prices[0];
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  const kept = sorted.filter((price) => {
    if (n % 2 === 1) return price * 20 >= sorted[mid] * 17;
    return price * 40 >= (sorted[mid - 1] + sorted[mid]) * 17;
  });
  return kept.length ? kept[0] : null;
}

function sellSide(tradeSide) {
  const side = String(tradeSide ?? "").trim().toLowerCase();
  return side === "" || side === "sell";
}

function buildSuggestedPrices(ticks, yesterday, today) {
  const days = new Set([yesterday, today]);
  const grouped = new Map();
  for (const tick of ticks || []) {
    if (tick.excluded === true) continue;
    if (!sellSide(tick.trade_side)) continue;
    const day = String(tick.quote_date || "").slice(0, 10);
    if (!days.has(day)) continue;
    const price = Number(tick.price);
    if (!Number.isFinite(price)) continue;
    const key = specKey(tick.model, tick.capacity, tick.color);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(price);
  }
  const out = new Map();
  for (const [key, prices] of grouped) {
    const suggest = suggestFromPrices(prices);
    if (suggest != null) out.set(key, suggest);
  }
  return out;
}

function belowAnyCost(price, rows) {
  return rows.some((item) => {
    const cost = Number(item.cost);
    return Number.isFinite(cost) && price < cost;
  });
}

function suggestHtml(rows) {
  const price = suggestedBySpec.get(specKey(rows[0].model, rows[0].capacity, rows[0].color));
  if (price == null) return `<span class="stock-suggest">建議同行售價</span>`;
  const warn = belowAnyCost(price, rows) ? `<span class="stock-below-cost">低於成本</span>` : "";
  return `<span class="stock-suggest">建議同行售價 ${formatSuggest(price)}${warn}</span>`;
}

function ownerOf(item) {
  if (item.stockType !== "寄賣") return OWN_LABEL;
  return (item.owner || "").trim() || "寄賣（沒填件主）";
}

function specOf(item) {
  return [item.model, item.capacity, item.color].map((s) => String(s || "").trim()).filter(Boolean).join(" ");
}

function stockStatusOf(item) {
  return String(item.status || "").trim();
}

function onHand(item) {
  return stockStatusOf(item) !== "已售出";
}

function shortDate(text) {
  const m = String(text || "").match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : String(text || "");
}

function ownerOptions() {
  const counts = new Map();
  for (const item of items) counts.set(ownerOf(item), (counts.get(ownerOf(item)) || 0) + 1);
  const owners = [...counts.keys()].filter((o) => o !== OWN_LABEL).sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, "zh-Hant"));
  const list = [{ value: ALL_VALUE, label: `全部（${items.length}）` }];
  if (counts.has(OWN_LABEL)) list.push({ value: OWN_LABEL, label: `${OWN_LABEL}（${counts.get(OWN_LABEL)}）` });
  for (const o of owners) list.push({ value: o, label: `${o}（${counts.get(o)}）` });
  return list;
}

function renderOwnerSelect() {
  const saved = new URLSearchParams(location.search).get("owner") || localStorage.getItem(OWNER_STORAGE_KEY) || ALL_VALUE;
  const options = ownerOptions();
  ownerSelect.innerHTML = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
  ownerSelect.value = options.some((o) => o.value === saved) ? saved : ALL_VALUE;
}

function selectedItems() {
  const owner = ownerSelect.value;
  return owner === ALL_VALUE ? items : items.filter((item) => ownerOf(item) === owner);
}

function renderSummary(list) {
  const total = list.reduce((s, i) => s + (Number(i.cost) || 0), 0);
  const own = list.filter((i) => i.stockType !== "寄賣").reduce((s, i) => s + (Number(i.cost) || 0), 0);
  const cards = [
    `<div class="stock-stat"><span class="muted">台數</span><strong>${list.length}</strong></div>`,
    `<div class="stock-stat"><span class="muted">總成本</span><strong>${money(total)}</strong></div>`,
  ];
  if (ownerSelect.value === ALL_VALUE && own && own !== total) {
    cards.push(`<div class="stock-stat"><span class="muted">自有成本</span><strong>${money(own)}</strong></div>`);
    cards.push(`<div class="stock-stat"><span class="muted">寄賣應付件主</span><strong>${money(total - own)}</strong></div>`);
  }
  stockSummary.innerHTML = cards.join("");
}

function renderList(list) {
  const groups = new Map();
  for (const item of list) {
    const key = specOf(item) || "（沒填型號）";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-Hant", { numeric: true }));
  const showOwner = ownerSelect.value === ALL_VALUE;
  stockList.innerHTML = sorted.map(([spec, rows]) => {
    const sum = rows.reduce((s, i) => s + (Number(i.cost) || 0), 0);
    const detail = rows
      .sort((a, b) => String(a.inDate).localeCompare(String(b.inDate)))
      .map((i) => {
        const costLabel = i.stockType === "寄賣" ? "應付件主" : "成本";
        const hold = stockStatusOf(i) === "客訂中" ? `<span class="stock-reserved">客訂中</span>` : "";
        const meta = [shortDate(i.inDate) && `入庫 ${shortDate(i.inDate)}`, i.sourceChannel, showOwner && ownerOf(i), i.serialNumber && `序號 ${i.serialNumber}`]
          .filter(Boolean).map(esc).join("｜");
        return `<li class="stock-unit">${hold}<span class="stock-unit-meta">${meta || esc(i.stockId)}</span><span class="stock-unit-cost"><span class="muted">${costLabel}</span> ${money(i.cost)}</span></li>`;
      })
      .join("");
    return `<details class="card stock-group">
      <summary><span class="stock-spec">${esc(spec)} <span class="stock-qty">×${rows.length}</span>${suggestHtml(rows)}</span><span class="stock-sum">${money(sum)}</span></summary>
      <ul class="stock-units">${detail}</ul>
    </details>`;
  }).join("");
}

function render() {
  const list = selectedItems();
  renderSummary(list);
  renderList(list);
  if (!list.length) {
    stockStatus.textContent = "這個件主目前沒有新機";
    return;
  }
  stockStatus.textContent = quoteUnavailable ? "建議同行售價暫時讀不到" : "";
}

function initQuoteClient() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || !window.supabase?.createClient) {
    throw new Error("請設定 config.js");
  }
  if (!quoteClient) {
    // RLS 只開放 anon，資料查詢不能帶登入 session，否則會變成 authenticated 而查不到
    quoteClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "ipw-anon-data" },
    });
  }
  return quoteClient;
}

async function fetchNewTicks(client, yesterday, today) {
  const tableName = window.SUPABASE_TICKS_TABLE || "quote_ticks";
  const rows = [];
  let from = 0;
  while (from < 50000) {
    const { data, error } = await client
      .from(tableName)
      .select("model,capacity,color,price,trade_side,excluded,quote_date")
      .in("category", ["new", "accessory"])
      .gte("quote_date", yesterday)
      .lte("quote_date", today)
      .order("id", { ascending: true })
      .range(from, from + TICK_PAGE - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < TICK_PAGE) break;
    from += TICK_PAGE;
  }
  return rows;
}

async function loadSuggestedPrices() {
  const today = taipeiToday();
  const yesterday = addCalendarDays(today, -1);
  const ticks = await fetchNewTicks(initQuoteClient(), yesterday, today);
  return buildSuggestedPrices(ticks, yesterday, today);
}

function apiBase() {
  const base = String(window.INSTOCK_API_BASE || DEFAULT_API_BASE).trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(base) ? base : `https://${base}`;
}

async function fetchStock(refresh) {
  const token = await window.authGate?.getAccessToken?.(refresh);
  if (!token) return null;
  return fetch(`${apiBase()}/api/price-web/newphone-stock`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function load() {
  stockStatus.textContent = "載入中…";
  stockReloadBtn.disabled = true;
  quoteUnavailable = false;
  const quotesPromise = loadSuggestedPrices().then(
    (map) => ({ ok: true, map }),
    (err) => {
      console.error(err);
      return { ok: false, map: new Map() };
    },
  );
  try {
    let res = await fetchStock(false);
    if (res && res.status === 401) res = await fetchStock(true);
    if (!res || res.status === 401) {
      stockStatus.textContent = "報價網頁登入已過期，請重新整理頁面再登入一次";
      return;
    }
    if (res.status === 503) throw new Error("in stock 端暫時無法驗證（請通知 in stock）");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    items = (data.items || []).filter(onHand);
    const quotes = await quotesPromise;
    suggestedBySpec = quotes.map;
    quoteUnavailable = !quotes.ok;
    renderOwnerSelect();
    render();
  } catch (err) {
    stockStatus.textContent = `讀不到 in stock 庫存：${err.message}`;
  } finally {
    stockReloadBtn.disabled = false;
  }
}

ownerSelect.addEventListener("change", () => {
  localStorage.setItem(OWNER_STORAGE_KEY, ownerSelect.value);
  render();
});
stockReloadBtn.addEventListener("click", load);
load();
