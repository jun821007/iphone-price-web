/** 貨源推斷：讀 supply_signals（Win11 analyze_supply_signals.py 每晚 22:00 寫入） */
const SIGNAL_TABLE = "supply_signals";
const VERDICT = {
  surge_drop_ecom: { label: "🛒 可能電商", cls: "supply-tag--ecom", order: 0 },
  surge_drop_other: { label: "📶 非電商", cls: "supply-tag--other", order: 1 },
  normal: { label: "平穩", cls: "supply-tag--normal", order: 2 },
};

const dayPrevBtn = document.getElementById("dayPrevBtn");
const dayNextBtn = document.getElementById("dayNextBtn");
const dayLatestBtn = document.getElementById("dayLatestBtn");
const dayLabel = document.getElementById("dayLabel");
const modelSearch = document.getElementById("modelSearch");
const onlyAlerts = document.getElementById("onlyAlerts");
const supplyStatus = document.getElementById("supplyStatus");
const supplyList = document.getElementById("supplyList");
const supplyModal = document.getElementById("supplyModal");
const supplyModalTitle = document.getElementById("supplyModalTitle");
const supplyModalSubtitle = document.getElementById("supplyModalSubtitle");
const supplyModalBody = document.getElementById("supplyModalBody");
const supplyModalClose = document.getElementById("supplyModalClose");

let supabaseClient = null;
/** 有資料的日期（新到舊） */
let availableDates = [];
let currentDate = "";
let rows = [];

function initClient() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) throw new Error("請設定 config.js");
  // RLS 只開放 anon，資料查詢不能帶登入 session，否則會變成 authenticated 而查不到
  supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "ipw-anon-data" },
  });
}

function money(v) {
  return v === null || v === undefined ? "—" : `$${Number(v).toLocaleString("en-US")}`;
}

function num(v) {
  return v === null || v === undefined ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function diffText(now, base) {
  if (now === null || now === undefined || base === null || base === undefined) return "";
  const d = Number(now) - Number(base);
  if (!d) return "持平";
  return d > 0 ? `+${d.toLocaleString("en-US")}` : d.toLocaleString("en-US");
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function shortDate(iso) {
  const [, m, d] = iso.split("-");
  const w = "日一二三四五六"[new Date(`${iso}T00:00:00+08:00`).getDay()];
  return `${Number(m)}/${Number(d)}（${w}）`;
}

async function loadDates() {
  const { data, error } = await supabaseClient
    .from(SIGNAL_TABLE)
    .select("signal_date")
    .order("signal_date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  availableDates = [...new Set((data || []).map((r) => r.signal_date))];
}

async function loadDay(day) {
  supplyStatus.textContent = "載入中…";
  supplyStatus.classList.remove("error");
  const { data, error } = await supabaseClient.from(SIGNAL_TABLE).select("*").eq("signal_date", day).limit(500);
  if (error) throw error;
  currentDate = day;
  rows = (data || []).sort(
    (a, b) => VERDICT[a.verdict].order - VERDICT[b.verdict].order || b.recent_ticks_per_day - a.recent_ticks_per_day
  );
  render();
}

function render() {
  const idx = availableDates.indexOf(currentDate);
  dayLabel.textContent = currentDate ? shortDate(currentDate) : "—";
  dayPrevBtn.disabled = idx < 0 || idx >= availableDates.length - 1;
  dayNextBtn.disabled = idx <= 0;

  const q = modelSearch.value.trim().toLowerCase().replace(/\s+/g, "");
  const list = rows.filter((r) => {
    if (onlyAlerts.checked && r.verdict === "normal") return false;
    return !q || r.model_group.toLowerCase().replace(/\s+/g, "").includes(q);
  });
  const alerts = rows.filter((r) => r.verdict !== "normal").length;
  const updated = rows[0]?.updated_at ? new Date(rows[0].updated_at).toLocaleString("zh-TW", { hour12: false }) : "—";
  supplyStatus.textContent = `${rows.length} 個型號，其中 ${alerts} 個有異常 · 更新於 ${updated}`;

  if (!list.length) {
    supplyList.innerHTML = `<div class="card muted">${rows.length ? "這天沒有符合條件的型號" : "這天沒有資料"}</div>`;
    return;
  }
  supplyList.innerHTML = list.map(cardHtml).join("");
  supplyList.querySelectorAll("[data-model]").forEach((el) =>
    el.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      openDetail(el.dataset.model);
    })
  );
}

// 前 7 天（不含近 2 天）每天最低價的中間值，與分析腳本相同
function baseLow(r) {
  const lows = (r.daily || [])
    .slice(-9, -2)
    .map((d) => d.min)
    .filter((v) => v != null)
    .sort((a, b) => a - b);
  if (!lows.length) return null;
  const mid = Math.floor(lows.length / 2);
  return lows.length % 2 ? lows[mid] : Math.round((lows[mid - 1] + lows[mid]) / 2);
}

function cardHtml(r) {
  const v = VERDICT[r.verdict] || VERDICT.normal;
  const ecom = r.ecom_recent_min
    ? `${esc(r.ecom_recent_platform)} ${money(r.ecom_recent_min)}${
        r.ecom_recent_url ? ` <a href="${esc(r.ecom_recent_url)}" target="_blank" rel="noopener">開啟</a>` : ""
      }`
    : "沒有資料";
  return `
    <article class="card supply-card" data-model="${esc(r.model_group)}">
      <header class="supply-card-head">
        <strong class="supply-model">${esc(r.model_group)}</strong>
        <span class="supply-tag ${v.cls}">${v.label}</span>
      </header>
      <p class="supply-note">${esc(r.verdict_note)}</p>
      <dl class="supply-stats">
        <div><dt>賣家／天</dt><dd>${num(r.recent_senders_per_day)} <span class="muted">（前 7 天 ${num(r.base_senders_per_day)}）</span></dd></div>
        <div><dt>報價／天</dt><dd>${num(r.recent_ticks_per_day)} <span class="muted">（前 7 天 ${num(r.base_ticks_per_day)}）</span></dd></div>
        <div><dt>同行最低價</dt><dd>${money(r.recent_min)} <span class="muted">（前 7 天約 ${money(baseLow(r))}，${diffText(r.recent_min, baseLow(r))}）</span></dd></div>
        <div><dt>電商最低</dt><dd>${ecom}</dd></div>
      </dl>
    </article>`;
}

function openDetail(model) {
  const r = rows.find((x) => x.model_group === model);
  if (!r) return;
  supplyModalTitle.textContent = r.model_group;
  supplyModalSubtitle.textContent = `${shortDate(r.signal_date)} · ${(VERDICT[r.verdict] || VERDICT.normal).label}`;
  const daily = (r.daily || [])
    .map(
      (d) => `<tr><td>${shortDate(d.date)}</td><td>${d.ticks}</td><td>${d.senders}</td><td>${money(
        d.min
      )}</td><td>${money(d.ecom_min)}</td></tr>`
    )
    .join("");
  const sellers = (r.top_sellers || [])
    .map(
      (s) => `<li><strong>${money(s.price)}</strong> ${esc(s.sender || "（無名稱）")} <span class="muted">×${s.count} · ${esc(
        s.chat || ""
      )}</span><br /><span class="muted supply-raw">${esc(s.raw_line || "")}</span></li>`
    )
    .join("");
  supplyModalBody.innerHTML = `
    <p class="supply-note">${esc(r.verdict_note)}</p>
    <h3 class="supply-subhead">近 14 天</h3>
    <div class="table-wrap"><table class="supply-table">
      <thead><tr><th>日期</th><th>報價</th><th>賣家</th><th>最低</th><th>電商最低</th></tr></thead>
      <tbody>${daily}</tbody>
    </table></div>
    <h3 class="supply-subhead">近 2 天出價最低的賣家</h3>
    <ul class="supply-sellers">${sellers || '<li class="muted">沒有資料</li>'}</ul>`;
  supplyModal.showModal();
}

async function goTo(day) {
  try {
    await loadDay(day);
  } catch (err) {
    supplyStatus.textContent = `讀取失敗：${err.message || err}`;
    supplyStatus.classList.add("error");
  }
}

async function main() {
  try {
    initClient();
    await loadDates();
    if (!availableDates.length) {
      supplyStatus.textContent = "還沒有資料（每晚 22:00 產生）";
      return;
    }
    await goTo(availableDates[0]);
  } catch (err) {
    supplyStatus.textContent = `讀取失敗：${err.message || err}`;
    supplyStatus.classList.add("error");
  }
}

dayPrevBtn.addEventListener("click", () => {
  const i = availableDates.indexOf(currentDate);
  if (i >= 0 && i < availableDates.length - 1) goTo(availableDates[i + 1]);
});
dayNextBtn.addEventListener("click", () => {
  const i = availableDates.indexOf(currentDate);
  if (i > 0) goTo(availableDates[i - 1]);
});
dayLatestBtn.addEventListener("click", () => availableDates.length && goTo(availableDates[0]));
modelSearch.addEventListener("input", render);
onlyAlerts.addEventListener("change", render);
supplyModalClose.addEventListener("click", () => supplyModal.close());
supplyModal.addEventListener("click", (e) => {
  if (e.target === supplyModal) supplyModal.close();
});

main();
