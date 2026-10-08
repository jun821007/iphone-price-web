/** 新機庫存：唯讀 in stock 後端 /api/newphone-stock（Google 試算表「新機庫存」），只列庫存中 */
const OWN_LABEL = "自有";
const ALL_VALUE = "__all__";
const OWNER_STORAGE_KEY = "ipw-stock-owner";
// in stock 後端的登入 token（session 存在後端記憶體，Railway 重啟後會失效，要重登）
const TOKEN_STORAGE_KEY = "ipw-instock-token";

const loginCard = document.getElementById("stockLoginCard");
const loginForm = document.getElementById("stockLoginForm");
const loginError = document.getElementById("stockLoginError");
const mainCard = document.getElementById("stockMain");
const ownerSelect = document.getElementById("ownerSelect");
const stockReloadBtn = document.getElementById("stockReloadBtn");
const stockSummary = document.getElementById("stockSummary");
const stockStatus = document.getElementById("stockStatus");
const stockList = document.getElementById("stockList");

let items = [];

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function money(v) {
  return `$${Math.round(Number(v) || 0).toLocaleString("en-US")}`;
}

function ownerOf(item) {
  if (item.stockType !== "寄賣") return OWN_LABEL;
  return (item.owner || "").trim() || "寄賣（沒填件主）";
}

function specOf(item) {
  return [item.model, item.capacity, item.color].map((s) => String(s || "").trim()).filter(Boolean).join(" ");
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
        const meta = [shortDate(i.inDate) && `入庫 ${shortDate(i.inDate)}`, i.sourceChannel, showOwner && ownerOf(i), i.serialNumber && `序號 ${i.serialNumber}`]
          .filter(Boolean).map(esc).join("｜");
        return `<li class="stock-unit"><span class="stock-unit-meta">${meta || esc(i.stockId)}</span><span class="stock-unit-cost"><span class="muted">${costLabel}</span> ${money(i.cost)}</span></li>`;
      })
      .join("");
    return `<details class="card stock-group">
      <summary><span class="stock-spec">${esc(spec)} <span class="stock-qty">×${rows.length}</span></span><span class="stock-sum">${money(sum)}</span></summary>
      <ul class="stock-units">${detail}</ul>
    </details>`;
  }).join("");
}

function render() {
  const list = selectedItems();
  renderSummary(list);
  renderList(list);
  stockStatus.textContent = list.length ? "" : "這個件主目前沒有庫存中的新機";
}

function apiBase() {
  return String(window.INSTOCK_API_BASE || "").replace(/\/+$/, "");
}

function showLogin(message = "") {
  loginCard.hidden = false;
  mainCard.hidden = true;
  stockList.innerHTML = "";
  loginError.textContent = message;
}

async function login(event) {
  event.preventDefault();
  loginError.textContent = "登入中…";
  try {
    const res = await fetch(`${apiBase()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: document.getElementById("stockAccount").value.trim(),
        password: document.getElementById("stockPassword").value,
        remember: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(typeof data.error === "string" ? data.error : "帳號或密碼錯誤");
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    loginForm.reset();
    loginCard.hidden = true;
    mainCard.hidden = false;
    load();
  } catch (err) {
    loginError.textContent = err.message;
  }
}

function applyItems(data) {
  loginCard.hidden = true;
  mainCard.hidden = false;
  items = (data.items || []).filter((i) => i.status === "庫存中");
  renderOwnerSelect();
  render();
}

async function load() {
  const base = apiBase();
  if (!base) {
    stockStatus.textContent = "還沒設定 in stock 後端網址（config.js 的 INSTOCK_API_BASE）";
    return;
  }
  stockStatus.textContent = "載入中…";
  stockReloadBtn.disabled = true;
  try {
    // 優先用報價網頁的登入（in stock 驗證本站 Supabase 登入）；in stock 還沒開放時退回 in stock 帳密
    const siteToken = await window.authGate?.getAccessToken?.();
    if (siteToken) {
      const res = await fetch(`${base}/api/price-web/newphone-stock`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${siteToken}` },
      });
      if (res.ok) {
        applyItems(await res.json());
        return;
      }
    }
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      showLogin();
      return;
    }
    const res = await fetch(`${base}/api/newphone-stock?status=${encodeURIComponent("庫存中")}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      showLogin("登入已過期（in stock 重新部署過），請再登入一次");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyItems(await res.json());
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
loginForm.addEventListener("submit", login);
load();
