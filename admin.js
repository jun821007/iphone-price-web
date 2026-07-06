const pendingDate = document.getElementById("pendingDate");
const refreshPendingBtn = document.getElementById("refreshPendingBtn");
const pendingList = document.getElementById("pendingList");
const newBrandName = document.getElementById("newBrandName");
const addBrandBtn = document.getElementById("addBrandBtn");
const brandList = document.getElementById("brandList");

const CATEGORY_OPTIONS = [
  { value: "new", label: "新機" },
  { value: "used", label: "二手" },
  { value: "new_ipad", label: "iPad" },
  { value: "accessory", label: "配件" },
];

const CONDITION_OPTIONS = [
  { value: "new", label: "全新" },
  { value: "used", label: "二手" },
  { value: "refurbished", label: "整新" },
  { value: "unknown", label: "未知" },
];

const CAPACITY_OPTIONS = ["", "64", "128", "256", "512", "1T", "2T"];
const COLOR_OPTIONS = ["", "黑", "白", "金", "藍", "綠", "黃", "橘", "紫", "粉", "鈦", "原", "銀", "灰", "星光", "午夜"];

const COLOR_RE = /(黑|白|金|藍|綠|黃|橘|紫|粉|鈦|原|銀|灰|星光|午夜)$/;

const FALLBACK_DEVICE_TYPES = [
  { code: "phone", label: "手機" },
  { code: "tablet", label: "平板" },
  { code: "accessory", label: "配件" },
  { code: "wearable", label: "穿戴" },
  { code: "computer", label: "電腦" },
];

const FALLBACK_BRANDS = [
  { code: "apple", name: "Apple" },
  { code: "samsung", name: "Samsung" },
  { code: "other", name: "其他" },
];

let supabaseClient = null;
let modelOptions = [];
let catalogByCategory = {};
let deviceTypes = [...FALLBACK_DEVICE_TYPES];
let brands = [...FALLBACK_BRANDS];
let pendingRowsById = {};

function table(name) {
  return window[name] || name;
}

function initClient() {
  supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

function splitModelKey(modelKey) {
  const key = (modelKey || "").trim();
  const colorMatch = key.match(COLOR_RE);
  const color = colorMatch ? colorMatch[1] : "";
  const body = color ? key.slice(0, -color.length) : key;
  const capMatch = body.match(/(64|128|256|512|1T|2T)$/i);
  const capacity = capMatch ? capMatch[1].toUpperCase() : "";
  const model = capacity ? body.slice(0, -capacity.length).trim() : body.trim();
  return { model, capacity, color };
}

function normalizeKey(text) {
  return String(text || "").toLowerCase().replace(/[\s\-_/]/g, "");
}

function classifySpec(category, modelKey) {
  const key = normalizeKey(modelKey);
  const cat = (category || "").toLowerCase();
  let deviceType = "phone";
  if (key.startsWith("s11") || key.startsWith("se") || key.includes("watch")) deviceType = "wearable";
  else if (key.startsWith("macbook") || key.includes("mac")) deviceType = "computer";
  else if (cat === "new_ipad" || key.startsWith("ipad")) deviceType = "tablet";
  else if (key.includes("airpods") || key.includes("applepencil") || cat === "accessory") deviceType = "accessory";
  const condition = cat === "used" ? "used" : "new";
  return { deviceType, brand: "apple", condition };
}

function suggestCategory(deviceType, condition) {
  if (condition === "used") return "used";
  if (deviceType === "tablet") return "new_ipad";
  if (deviceType === "accessory" || deviceType === "wearable") return "accessory";
  return "new";
}

function buildCatalogIndex(rows) {
  catalogByCategory = {};
  for (const row of rows) {
    const category = row.category || "new";
    if (!catalogByCategory[category]) {
      catalogByCategory[category] = { rows: [], baseModels: new Set() };
    }
    catalogByCategory[category].rows.push(row);
    catalogByCategory[category].baseModels.add(splitModelKey(row.model_key).model);
  }
}

async function loadTaxonomy() {
  const [{ data: dt, error: dtErr }, { data: br, error: brErr }] = await Promise.all([
    supabaseClient.from("device_types").select("code,label,sort_order").order("sort_order"),
    supabaseClient.from("brands").select("code,name,is_active").eq("is_active", true).order("name"),
  ]);
  if (!dtErr && dt?.length) deviceTypes = dt;
  if (!brErr && br?.length) brands = br;
  renderBrandList();
}

function renderBrandList() {
  if (!brandList) return;
  brandList.innerHTML = brands.map((b) => `<span class="price-chip">${b.name} <code>${b.code}</code></span>`).join("")
    || '<span class="muted">尚無品牌</span>';
}

async function loadModelOptions() {
  const { data, error } = await supabaseClient
    .from(table("SUPABASE_TABLE"))
    .select("category,model_key,model,capacity,color,msrp")
    .order("model_key");
  if (error) throw error;
  const seen = new Set();
  modelOptions = [];
  for (const row of data || []) {
    const key = `${row.category}|${row.model_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    modelOptions.push(row);
  }
  buildCatalogIndex(modelOptions);
}

function buildSelect(className, options, selected = "") {
  return `<select class="${className}">${options.map((opt) => {
    const value = typeof opt === "string" ? opt : opt.value;
    const label = typeof opt === "string" ? (opt || "—") : opt.label;
    const sel = value === selected ? " selected" : "";
    return `<option value="${value}"${sel}>${label}</option>`;
  }).join("")}</select>`;
}

function deviceTypeSelect(selected = "phone") {
  const options = deviceTypes.map((d) => ({ value: d.code, label: d.label }));
  return buildSelect("bind-device-type", options, selected);
}

function brandSelect(selected = "apple") {
  const options = brands.map((b) => ({ value: b.code, label: b.name }));
  return buildSelect("bind-brand", options, selected);
}

function conditionSelect(selected = "new") {
  return buildSelect("bind-condition", CONDITION_OPTIONS, selected);
}

function categorySelect(selected = "new") {
  return buildSelect("bind-category", CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.label })), selected);
}

function baseModelSelect(category, selected = "") {
  const bases = [...(catalogByCategory[category]?.baseModels || [])].sort();
  const options = [{ value: "", label: "請選型號" }, ...bases.map((b) => ({ value: b, label: b }))];
  return buildSelect("bind-base-model", options, selected);
}

function capacitySelect(selected = "") {
  const options = [{ value: "", label: "容量" }, ...CAPACITY_OPTIONS.filter(Boolean).map((c) => ({ value: c, label: c }))];
  return buildSelect("bind-capacity", options, selected);
}

function colorSelect(selected = "") {
  const options = [{ value: "", label: "顏色" }, ...COLOR_OPTIONS.filter(Boolean).map((c) => ({ value: c, label: c }))];
  return buildSelect("bind-color", options, selected);
}

function guessCategory(rawLine) {
  const line = (rawLine || "").toLowerCase();
  if (/二手|中古|整新/.test(line)) return "used";
  if (/ipad/.test(line)) return "new_ipad";
  if (/airpods|pencil|配件|保護貼|充電|原廠|watch|s11\b|se\d/.test(line)) return "accessory";
  return "new";
}

function guessBinding(rawLine) {
  const compact = (rawLine || "").toLowerCase().replace(/\s/g, "");
  for (const row of modelOptions) {
    const keyCompact = row.model_key.toLowerCase().replace(/\s/g, "");
    if (compact.includes(keyCompact)) {
      const parts = splitModelKey(row.model_key);
      const category = row.category;
      const composed = row.model_key;
      const cls = classifySpec(category, composed);
      return {
        category,
        baseModel: parts.model,
        capacity: row.capacity || parts.capacity,
        color: row.color || parts.color,
        deviceType: cls.deviceType,
        brand: cls.brand,
        condition: cls.condition,
      };
    }
  }
  const category = guessCategory(rawLine);
  const cls = classifySpec(category, compact);
  return {
    category,
    baseModel: "",
    capacity: "",
    color: "",
    deviceType: cls.deviceType,
    brand: cls.brand,
    condition: cls.condition,
  };
}

function resolveModelBinding(category, baseModel, capacity, color) {
  if (!baseModel) return null;
  const colorPart = color || "";
  const rows = catalogByCategory[category]?.rows || [];
  const exact = rows.find((row) => {
    const parts = splitModelKey(row.model_key);
    return parts.model === baseModel
      && (parts.capacity || "") === (capacity || "")
      && (parts.color || "") === colorPart;
  });
  if (exact) {
    return {
      category,
      model_key: exact.model_key,
      model: exact.model || baseModel,
      capacity: exact.capacity || capacity || "",
      color: exact.color || colorPart,
      msrp: exact.msrp || null,
    };
  }
  const composed = `${baseModel}${capacity || ""}${colorPart}`.toLowerCase().replace(/\s/g, "");
  return {
    category,
    model_key: composed,
    model: baseModel,
    capacity: capacity || "",
    color: colorPart,
    msrp: null,
  };
}

function formatDiscountZhe(price, msrp) {
  if (!price || !msrp) return "";
  return `${(price / msrp * 10).toFixed(1)}折`;
}

function formatSenderLabel(row) {
  const name = (row.sender_name || "").trim();
  const mid = (row.from_mid || "").trim();
  const midShort = mid ? mid.slice(-8) : "—";
  const who = name || `未知(${midShort})`;
  const group = (row.chat_name || "").trim();
  return { who, group };
}

function renderPending(rows) {
  pendingRowsById = {};
  if (!rows.length) {
    pendingList.innerHTML = '<div class="card muted">今天沒有待審核訊息</div>';
    return;
  }

  pendingList.innerHTML = rows.map((row) => {
    pendingRowsById[row.id] = row;
    const side = row.trade_side === "buy" ? "買單" : "賣單";
    const { who, group } = formatSenderLabel(row);
    const guess = guessBinding(row.raw_line || "");
    return `
    <article class="card pending-card" data-id="${row.id}" data-trade-side="${row.trade_side || "sell"}">
      <div class="pending-meta">#${row.id} · ${side} · ${who}</div>
      <div class="pending-sub">${group || "（群組未知）"}</div>
      <pre class="pending-text">${row.raw_line}</pre>
      <div class="pending-price">偵測價格：${row.detected_price ?? "—"}</div>
      <div class="pending-actions">
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem">階層分類（任務三/四）</p>
        <div class="pending-bind-grid">
          <label>設備${deviceTypeSelect(guess.deviceType)}</label>
          <label>品牌${brandSelect(guess.brand)}</label>
          <label>新舊${conditionSelect(guess.condition)}</label>
          <label>pipeline 分類${categorySelect(guess.category)}</label>
          <label>型號${baseModelSelect(guess.category, guess.baseModel)}</label>
          <label>${capacitySelect(guess.capacity)}</label>
          <label>${colorSelect(guess.color)}</label>
          <label>價格<input class="bind-price" type="number" placeholder="綁定價格" value="${row.detected_price || ""}" /></label>
        </div>
        <button type="button" class="btn-primary approve-btn">核准綁定並建檔</button>
        <button type="button" class="btn-secondary reject-btn">忽略</button>
      </div>
    </article>`;
  }).join("");
}

function refreshCascade(card, changed) {
  const deviceType = card.querySelector(".bind-device-type").value;
  const condition = card.querySelector(".bind-condition").value;
  const categoryEl = card.querySelector(".bind-category");
  if (changed === "device" || changed === "condition") {
    const suggested = suggestCategory(deviceType, condition);
    categoryEl.value = suggested;
  }
  const category = categoryEl.value;
  const current = card.querySelector(".bind-base-model")?.value || "";
  const modelLabel = card.querySelector(".bind-base-model")?.closest("label");
  if (modelLabel) modelLabel.innerHTML = `型號${baseModelSelect(category, current)}`;
}

async function loadPendingDates() {
  const { data, error } = await supabaseClient
    .from(table("SUPABASE_PENDING_TABLE"))
    .select("quote_date")
    .eq("status", "pending")
    .order("quote_date", { ascending: false });
  if (error) throw error;
  const dates = [...new Set((data || []).map((r) => r.quote_date))];
  pendingDate.innerHTML = dates.length
    ? dates.map((d) => `<option value="${d}">${d}</option>`).join("")
    : '<option value="">無待審</option>';
}

async function loadPending() {
  const date = pendingDate.value;
  if (!date) {
    pendingList.innerHTML = '<div class="card muted">無待審核日期</div>';
    return;
  }
  const { data, error } = await supabaseClient
    .from(table("SUPABASE_PENDING_TABLE"))
    .select("*")
    .eq("quote_date", date)
    .eq("status", "pending")
    .order("id", { ascending: false });
  if (error) throw error;
  renderPending(data || []);
}

async function saveClassificationOverride(rowId, deviceType, brand, condition, binding) {
  await supabaseClient.from("classification_overrides").upsert({
    target_table: "pending_quotes",
    target_id: rowId,
    device_type_code: deviceType,
    brand_code: brand,
    condition_state: condition,
    model_display: binding.model,
    capacity: binding.capacity,
    color: binding.color,
    corrected_by: "admin",
  }, { onConflict: "target_table,target_id" });
}

async function insertQuoteTick(pendingRow, binding, bindPrice, tradeSide, deviceType, brand, condition, date, now) {
  const ticksTable = table("SUPABASE_TICKS_TABLE") || "quote_ticks";
  const discountZhe = formatDiscountZhe(bindPrice, binding.msrp);
  await supabaseClient.from(ticksTable).upsert({
    quoted_at: now,
    quote_date: date,
    category: binding.category,
    model_key: binding.model_key,
    model: binding.model,
    capacity: binding.capacity,
    color: binding.color,
    price: bindPrice,
    trade_side: tradeSide,
    msrp: binding.msrp,
    discount_zhe: discountZhe,
    device_type: deviceType,
    brand,
    condition_state: condition,
    chat_id: pendingRow.chat_id || "",
    chat_name: pendingRow.chat_name || "",
    from_mid: pendingRow.from_mid || "",
    sender_name: pendingRow.sender_name || "",
    message_id: pendingRow.message_id,
  }, { onConflict: "message_id,category,model_key,price,trade_side" });
}

async function approvePending(card, rowId) {
  const pendingRow = pendingRowsById[rowId];
  const deviceType = card.querySelector(".bind-device-type").value;
  const brand = card.querySelector(".bind-brand").value;
  const condition = card.querySelector(".bind-condition").value;
  const category = card.querySelector(".bind-category").value;
  const baseModel = card.querySelector(".bind-base-model").value;
  const capacity = card.querySelector(".bind-capacity").value;
  const color = card.querySelector(".bind-color").value;
  const bindPrice = Number(card.querySelector(".bind-price").value);
  const binding = resolveModelBinding(category, baseModel, capacity, color);

  if (!binding || !bindPrice) {
    alert("請選擇分類、型號並填價格");
    return;
  }

  const { model_key, model } = binding;
  const date = pendingDate.value;
  const now = new Date().toISOString();
  const tradeSide = card.dataset.tradeSide === "buy" ? "buy" : "sell";

  const { data: existing } = await supabaseClient
    .from(table("SUPABASE_TABLE"))
    .select("id,price_stats,total_quotes,trade_side")
    .eq("quote_date", date)
    .eq("category", category)
    .eq("model_key", model_key)
    .eq("trade_side", tradeSide)
    .maybeSingle();

  let priceStats = existing?.price_stats || [];
  const hit = priceStats.find((p) => p.price === bindPrice);
  const discountZhe = formatDiscountZhe(bindPrice, binding.msrp);
  if (hit) {
    hit.count += 1;
    if (discountZhe) hit.discount_zhe = discountZhe;
  } else {
    const item = { price: bindPrice, count: 1 };
    if (discountZhe) item.discount_zhe = discountZhe;
    priceStats.push(item);
  }
  const totalQuotes = priceStats.reduce((s, p) => s + p.count, 0);
  const topPrice = priceStats.reduce(
    (best, p) => (p.count > best.count || (p.count === best.count && p.price < best.price) ? p : best),
    priceStats[0],
  ).price;

  await supabaseClient.from(table("SUPABASE_TABLE")).upsert({
    quote_date: date,
    category,
    model_key,
    model,
    capacity: binding.capacity,
    color: binding.color,
    trade_side: tradeSide,
    price_stats: priceStats,
    filtered_out: [],
    top_price: topPrice,
    msrp: binding.msrp,
    top_discount_zhe: formatDiscountZhe(topPrice, binding.msrp),
    total_quotes: totalQuotes,
    device_type: deviceType,
    brand,
    condition_state: condition,
    chat_id: pendingRow?.chat_id || "",
    chat_name: pendingRow?.chat_name || "",
    updated_at: now,
  }, { onConflict: "quote_date,category,model_key,trade_side" });

  if (pendingRow) {
    await insertQuoteTick(pendingRow, binding, bindPrice, tradeSide, deviceType, brand, condition, date, now);
  }
  await saveClassificationOverride(rowId, deviceType, brand, condition, binding);

  await supabaseClient.from(table("SUPABASE_PENDING_TABLE")).update({
    status: "approved",
    bound_category: category,
    bound_model_key: model_key,
    reviewed_at: now,
    updated_at: now,
  }).eq("id", rowId);

  await loadPending();
}

async function rejectPending(rowId) {
  const now = new Date().toISOString();
  await supabaseClient.from(table("SUPABASE_PENDING_TABLE")).update({
    status: "rejected",
    reviewed_at: now,
    updated_at: now,
  }).eq("id", rowId);
  await loadPending();
}

async function addBrand() {
  const name = (newBrandName?.value || "").trim();
  if (!name) {
    alert("請輸入品牌名稱");
    return;
  }
  const code = normalizeKey(name).replace(/[^a-z0-9]/g, "") || `brand_${Date.now()}`;
  const { error } = await supabaseClient.from("brands").upsert({
    code,
    name,
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "code" });
  if (error) {
    alert(error.message);
    return;
  }
  newBrandName.value = "";
  await loadTaxonomy();
  await loadPending();
}

async function initAdmin() {
  try {
    initClient();
    await loadTaxonomy();
    await loadModelOptions();
    await loadPendingDates();
    await loadPending();
  } catch (error) {
    pendingList.innerHTML = `<div class="card error">${error.message}</div>`;
  }
}

initAdmin();

refreshPendingBtn?.addEventListener("click", () => loadPending().catch((e) => alert(e.message)));
addBrandBtn?.addEventListener("click", () => addBrand().catch((e) => alert(e.message)));

pendingList.addEventListener("change", (event) => {
  const card = event.target.closest(".pending-card");
  if (!card) return;
  if (event.target.classList.contains("bind-device-type")) refreshCascade(card, "device");
  if (event.target.classList.contains("bind-condition")) refreshCascade(card, "condition");
  if (event.target.classList.contains("bind-category")) refreshCascade(card, "category");
});

pendingList.addEventListener("click", async (event) => {
  const card = event.target.closest(".pending-card");
  if (!card) return;
  const rowId = Number(card.dataset.id);
  try {
    if (event.target.classList.contains("approve-btn")) await approvePending(card, rowId);
    if (event.target.classList.contains("reject-btn")) await rejectPending(rowId);
  } catch (error) {
    alert(error.message);
  }
});

pendingDate.addEventListener("change", () => loadPending());
