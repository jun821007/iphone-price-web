const pendingDate = document.getElementById("pendingDate");
const refreshPendingBtn = document.getElementById("refreshPendingBtn");
const dedupPendingBtn = document.getElementById("dedupPendingBtn");
const pendingList = document.getElementById("pendingList");
const buyDemandPendingList = document.getElementById("buyDemandPendingList");
const adminReviewTabs = document.getElementById("adminReviewTabs");
const newBrandName = document.getElementById("newBrandName");
const addBrandBtn = document.getElementById("addBrandBtn");
const brandList = document.getElementById("brandList");
const newModelCategory = document.getElementById("newModelCategory");
const newModelName = document.getElementById("newModelName");
const newModelMsrp = document.getElementById("newModelMsrp");
const newModelMsrpRow = document.getElementById("newModelMsrpRow");
const newModelHint = document.getElementById("newModelHint");
const addModelBtn = document.getElementById("addModelBtn");
const statPending = document.getElementById("statPending");
const statApproved = document.getElementById("statApproved");
const statRejected = document.getElementById("statRejected");
const statAutoHint = document.getElementById("statAutoHint");
const autoApproveLearned = document.getElementById("autoApproveLearned");

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

const PHONE_COLOR_TOKENS = ["星光", "午夜", "黑", "白", "金", "藍", "綠", "黃", "橘", "紫", "粉", "鈦", "原", "銀", "灰"];
const COLOR_ALIASES = [
  ["太空黑", "黑"], ["深空黑", "黑"], ["午夜黑", "黑"],
  ["雲白", "白"], ["雲白色", "白"],
  ["原色", "原"], ["原色鈦", "鈦"],
  ["銀橘色", "銀橘"], ["橘銀色", "橘銀"],
];

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
let buyDemandPendingRowsById = {};
let activeAdminTab = "quote";
let approvedBindingMap = new Map();
const AUTO_APPROVE_KEY = "audit_auto_approve_learned";

function pendingLineSignature(rawLine) {
  return normalizeKey(
    (rawLine || "")
      .replace(/\$?\s*\d{4,6}\b/g, "")
      .trim(),
  );
}

function autoApproveEnabled() {
  if (!autoApproveLearned) return true;
  const stored = localStorage.getItem(AUTO_APPROVE_KEY);
  if (stored === null) return autoApproveLearned.checked;
  return stored === "1";
}

async function loadApprovedBindings() {
  approvedBindingMap = new Map();
  const { data, error } = await supabaseClient
    .from(table("SUPABASE_PENDING_TABLE"))
    .select("id,raw_line,bound_category,bound_model_key,trade_side")
    .eq("status", "approved")
    .not("bound_model_key", "is", null)
    .order("reviewed_at", { ascending: false })
    .limit(3000);
  if (error || !data?.length) return;

  const ids = data.map((row) => row.id);
  const { data: overrides } = await supabaseClient
    .from("classification_overrides")
    .select("target_id,device_type_code,brand_code,condition_state,model_display,capacity,color")
    .eq("target_table", "pending_quotes")
    .in("target_id", ids);

  const overrideById = new Map((overrides || []).map((row) => [row.target_id, row]));

  for (const row of data) {
    const sig = pendingLineSignature(row.raw_line);
    if (!sig || approvedBindingMap.has(sig)) continue;
    const ov = overrideById.get(row.id);
    const parts = splitModelKey(row.bound_model_key || "");
    const category = row.bound_category || "new";
    const cls = classifySpec(category, row.bound_model_key || "");
    const parsedColors = extractColorsFromRawLine(row.raw_line);
    approvedBindingMap.set(sig, {
      category,
      baseModel: ov?.model_display || parts.model,
      capacity: ov?.capacity || parts.capacity,
      color: ov?.color || parts.color || parsedColors[0] || "",
      parsedColors,
      deviceType: ov?.device_type_code || cls.deviceType,
      brand: ov?.brand_code || cls.brand,
      condition: ov?.condition_state || cls.condition,
      autoMatched: true,
      learnedFrom: row.id,
    });
  }
}

async function updateAuditStats(date) {
  if (!date) {
    if (statPending) statPending.textContent = "—";
    if (statApproved) statApproved.textContent = "—";
    if (statRejected) statRejected.textContent = "—";
    return;
  }
  const { data, error } = await supabaseClient
    .from(table("SUPABASE_PENDING_TABLE"))
    .select("status")
    .eq("quote_date", date);
  if (error) throw error;
  const rows = data || [];
  const pending = rows.filter((r) => r.status === "pending").length;
  const approved = rows.filter((r) => r.status === "approved").length;
  const rejected = rows.filter((r) => r.status === "rejected").length;
  if (statPending) statPending.textContent = String(pending);
  if (statApproved) statApproved.textContent = String(approved);
  if (statRejected) statRejected.textContent = String(rejected);
}

function table(name) {
  const value = window[name];
  if (typeof value === "string" && value && !value.startsWith("你的")) return value;
  const fallbacks = {
    SUPABASE_TABLE: "iphone_prices",
    SUPABASE_STATS_TABLE: "daily_run_stats",
    SUPABASE_SENDER_STATS_TABLE: "sender_daily_stats",
    SUPABASE_PENDING_TABLE: "pending_quotes",
    SUPABASE_TICKS_TABLE: "quote_ticks",
    SUPABASE_MSRP_TABLE: "product_msrp",
    SUPABASE_BUY_DEMAND_TABLE: "buy_demand_ticks",
    SUPABASE_BUY_DEMAND_PENDING_TABLE: "buy_demand_pending",
  };
  return fallbacks[name] || name;
}

function initClient() {
  supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

function normalizeColorAliases(text) {
  let out = String(text || "");
  for (const [alias, canonical] of COLOR_ALIASES) {
    out = out.split(alias).join(canonical);
  }
  return out;
}

function splitColorCluster(text) {
  const raw = normalizeColorAliases((text || "").trim());
  if (!raw || /不限色|全色|各色/.test(raw)) return [];
  const found = [];
  for (const part of raw.split(/[/、，,\s+]+/)) {
    if (!part || /不限色|全色|各色/.test(part)) continue;
    let pos = 0;
    while (pos < part.length) {
      let matched = "";
      for (const token of [...PHONE_COLOR_TOKENS].sort((a, b) => b.length - a.length)) {
        if (part.startsWith(token, pos)) {
          matched = token;
          break;
        }
      }
      if (matched) {
        if (!found.includes(matched)) found.push(matched);
        pos += matched.length;
      } else {
        pos += 1;
      }
    }
  }
  return found;
}

function extractColorsFromRawLine(rawLine) {
  const line = normalizeColorAliases(rawLine || "");
  const withoutPrice = line.replace(/\$?\s*\d{4,6}\b/g, " ").trim();
  const capMatch = withoutPrice.match(/(\d+)\s*[gG]\s*([^\d$]+)/);
  if (capMatch) {
    const colors = splitColorCluster(capMatch[2]);
    if (colors.length) return colors;
  }
  const tailMatch = withoutPrice.match(/([銀橘藍白黑金綠黃紫粉鈦原灰星光午夜\/、，]+)\s*$/);
  if (tailMatch) return splitColorCluster(tailMatch[1]);
  return [];
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
  const msrpTable = table("SUPABASE_MSRP_TABLE");
  const [{ data, error }, { data: msrpRows, error: msrpError }] = await Promise.all([
    supabaseClient
      .from(table("SUPABASE_TABLE"))
      .select("category,model_key,model,capacity,color,msrp")
      .order("model_key"),
    supabaseClient.from(msrpTable).select("category,model_key,msrp").order("model_key"),
  ]);
  if (error) throw error;
  if (msrpError && msrpError.code !== "42P01") throw msrpError;
  const seen = new Set();
  modelOptions = [];
  for (const row of data || []) {
    const key = `${row.category}|${row.model_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    modelOptions.push(row);
  }
  for (const row of msrpRows || []) {
    const category = row.category || "new";
    const modelKey = (row.model_key || "").trim();
    if (!modelKey) continue;
    const key = `${category}|${modelKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = splitModelKey(modelKey);
    modelOptions.push({
      category,
      model_key: modelKey,
      model: parts.model || modelKey,
      capacity: parts.capacity || "",
      color: parts.color || "",
      msrp: row.msrp || null,
    });
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
  const parsedColors = extractColorsFromRawLine(rawLine);
  const sig = pendingLineSignature(rawLine);
  const learned = approvedBindingMap.get(sig);
  if (learned) {
    return {
      ...learned,
      parsedColors: parsedColors.length ? parsedColors : learned.parsedColors,
      autoMatched: true,
    };
  }

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
        color: row.color || parts.color || parsedColors[0] || "",
        parsedColors,
        deviceType: cls.deviceType,
        brand: cls.brand,
        condition: cls.condition,
      };
    }
  }
  const category = guessCategory(rawLine);
  const cls = classifySpec(category, compact);
  const capMatch = (rawLine || "").match(/(\d+)\s*[gG]/i);
  let baseModel = "";
  const phoneMatch = compact.match(/(1[1-7])(promax|pro|plus|mini|air|e)?/);
  if (phoneMatch) {
    baseModel = phoneMatch[1] + (phoneMatch[2] || "");
  }
  return {
    category,
    baseModel,
    capacity: capMatch ? capMatch[1] : "",
    color: parsedColors[0] || "",
    parsedColors,
    deviceType: cls.deviceType,
    brand: cls.brand,
    condition: cls.condition,
  };
}

function dualColorBlock(parsedColors) {
  if (!parsedColors || parsedColors.length < 2) return "";
  const label = parsedColors.join("、");
  return `
    <div class="dual-color-box">
      <strong>偵測雙色：${label}</strong>
      <label class="dual-color-check">
        <input type="checkbox" class="bind-dual-color" checked />
        核准時拆成 ${parsedColors.length} 筆（同色同價，各一個 model_key）
      </label>
    </div>`;
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

function learnedBadge(guess) {
  if (!guess?.autoMatched) return "";
  return '<div class="learned-badge">曾核准過 · 已自動帶入綁定</div>';
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
    const parsedColorsAttr = (guess.parsedColors || []).join(",");
    return `
    <article class="card pending-card" data-id="${row.id}" data-trade-side="${row.trade_side || "sell"}" data-parsed-colors="${parsedColorsAttr}">
      <div class="pending-meta">#${row.id} · ${side} · ${who}</div>
      <div class="pending-sub">${group || "（群組未知）"}</div>
      <pre class="pending-text">${row.raw_line}</pre>
      <div class="pending-price">偵測價格：${row.detected_price ?? "—"}</div>
      ${learnedBadge(guess)}
      ${dualColorBlock(guess.parsedColors)}
      <div class="pending-actions">
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem">階層分類</p>
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

async function dedupePendingForDate() {
  const date = pendingDate.value;
  if (!date) return;
  const { data, error } = await supabaseClient
    .from(table("SUPABASE_PENDING_TABLE"))
    .select("id,raw_line,detected_price")
    .eq("quote_date", date)
    .eq("status", "pending")
    .order("id");
  if (error) throw error;
  const groups = new Map();
  for (const row of data || []) {
    const line = (row.raw_line || "").trim();
    if (!line) continue;
    if (!groups.has(line)) groups.set(line, []);
    groups.get(line).push(row);
  }
  const toDelete = [];
  for (const items of groups.values()) {
    if (items.length <= 1) continue;
    items.sort((a, b) => (a.detected_price ? 0 : 1) - (b.detected_price ? 0 : 1) || a.id - b.id);
    toDelete.push(...items.slice(1).map((r) => r.id));
  }
  if (!toDelete.length) {
    alert("本日沒有重複待審");
    return;
  }
  if (!confirm(`將刪除本日重複待審 ${toDelete.length} 筆，保留 ${groups.size} 筆唯一內容。確定？`)) return;
  for (let i = 0; i < toDelete.length; i += 200) {
    const chunk = toDelete.slice(i, i + 200);
    const { error: delErr } = await supabaseClient
      .from(table("SUPABASE_PENDING_TABLE"))
      .delete()
      .in("id", chunk);
    if (delErr) throw delErr;
  }
  alert(`已刪除 ${toDelete.length} 筆重複`);
  await loadPendingDates();
  await loadPending();
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
    await updateAuditStats(null);
    return;
  }

  await loadApprovedBindings();
  const { data, error } = await supabaseClient
    .from(table("SUPABASE_PENDING_TABLE"))
    .select("*")
    .eq("quote_date", date)
    .eq("status", "pending")
    .order("id", { ascending: false });
  if (error) throw error;

  const autoCount = await autoApproveLearnedRows(data || []);
  if (statAutoHint) {
    statAutoHint.textContent = autoCount > 0 ? `本輪自動核准 ${autoCount} 筆` : "";
  }

  const { data: remaining, error: remainError } = await supabaseClient
    .from(table("SUPABASE_PENDING_TABLE"))
    .select("*")
    .eq("quote_date", date)
    .eq("status", "pending")
    .order("id", { ascending: false });
  if (remainError) throw remainError;

  await updateAuditStats(date);
  renderPending(remaining || []);
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

async function personAlreadyQuoted(date, category, modelKey, price, tradeSide, fromMid, exceptMessageId) {
  const mid = (fromMid || "").trim();
  if (!mid) return false;
  const ticksTable = table("SUPABASE_TICKS_TABLE") || "quote_ticks";
  let query = supabaseClient
    .from(ticksTable)
    .select("message_id")
    .eq("quote_date", date)
    .eq("category", category)
    .eq("model_key", modelKey)
    .eq("price", price)
    .eq("trade_side", tradeSide)
    .eq("from_mid", mid);
  if (exceptMessageId != null) query = query.neq("message_id", exceptMessageId);
  const { data, error } = await query.limit(1);
  if (error) return false;
  return (data || []).length > 0;
}

async function upsertApprovedPrice(date, category, binding, bindPrice, tradeSide, deviceType, brand, condition, pendingRow, now) {
  const { data: existing } = await supabaseClient
    .from(table("SUPABASE_TABLE"))
    .select("id,price_stats,total_quotes,trade_side")
    .eq("quote_date", date)
    .eq("category", category)
    .eq("model_key", binding.model_key)
    .eq("trade_side", tradeSide)
    .maybeSingle();

  // 同一人同規格同價已報過 → 不重複累加次數（僅寫入 tick 供逐筆留存）
  const alreadyCounted = await personAlreadyQuoted(
    date, binding.category, binding.model_key, bindPrice, tradeSide,
    pendingRow?.from_mid, pendingRow?.message_id,
  );

  let priceStats = existing?.price_stats || [];
  const hit = priceStats.find((p) => p.price === bindPrice);
  const discountZhe = formatDiscountZhe(bindPrice, binding.msrp);
  if (hit) {
    if (!alreadyCounted) hit.count += 1;
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
    model_key: binding.model_key,
    model: binding.model,
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
}

async function executeApproval(pendingRow, options) {
  const {
    deviceType,
    brand,
    condition,
    category,
    baseModel,
    capacity,
    colorsToUse,
    bindPrice,
    tradeSide,
  } = options;

  const date = pendingDate.value;
  const now = new Date().toISOString();
  let lastBinding = null;

  for (const color of colorsToUse) {
    const binding = resolveModelBinding(category, baseModel, capacity, color);
    if (!binding) throw new Error("型號綁定失敗");
    await upsertApprovedPrice(date, category, binding, bindPrice, tradeSide, deviceType, brand, condition, pendingRow, now);
    lastBinding = binding;
  }

  if (lastBinding) {
    await saveClassificationOverride(pendingRow.id, deviceType, brand, condition, lastBinding);
  }

  await supabaseClient.from(table("SUPABASE_PENDING_TABLE")).update({
    status: "approved",
    bound_category: category,
    bound_model_key: lastBinding?.model_key || "",
    reviewed_at: now,
    updated_at: now,
  }).eq("id", pendingRow.id);

  const sig = pendingLineSignature(pendingRow.raw_line);
  if (sig) {
    approvedBindingMap.set(sig, {
      category,
      baseModel,
      capacity,
      color: colorsToUse[colorsToUse.length - 1] || "",
      parsedColors: colorsToUse.length >= 2 ? colorsToUse : extractColorsFromRawLine(pendingRow.raw_line),
      deviceType,
      brand,
      condition,
      autoMatched: true,
    });
  }
}

function buildApprovalOptions(pendingRow, guess, overrides = {}) {
  const parsedColors = guess.parsedColors || extractColorsFromRawLine(pendingRow.raw_line);
  const dualEnabled = overrides.dualEnabled ?? (parsedColors.length >= 2);
  const colorsToUse = dualEnabled && parsedColors.length >= 2
    ? parsedColors
    : [overrides.color || guess.color || parsedColors[0] || ""];
  return {
    deviceType: overrides.deviceType || guess.deviceType || "phone",
    brand: overrides.brand || guess.brand || "apple",
    condition: overrides.condition || guess.condition || "new",
    category: overrides.category || guess.category || "new",
    baseModel: overrides.baseModel || guess.baseModel,
    capacity: overrides.capacity || guess.capacity || "",
    colorsToUse,
    bindPrice: Number(overrides.bindPrice ?? pendingRow.detected_price),
    tradeSide: pendingRow.trade_side === "buy" ? "buy" : "sell",
  };
}

async function autoApproveLearnedRows(rows) {
  if (!autoApproveEnabled()) return 0;
  let count = 0;
  for (const row of rows) {
    const guess = guessBinding(row.raw_line || "");
    if (!guess.autoMatched || !guess.baseModel || !row.detected_price) continue;
    try {
      const options = buildApprovalOptions(row, guess);
      await executeApproval(row, options);
      count += 1;
    } catch (error) {
      console.warn("auto approve failed", row.id, error);
    }
  }
  return count;
}

function cloneApprovalOptions(options) {
  return {
    ...options,
    colorsToUse: [...(options.colorsToUse || [])],
  };
}

async function autoApproveExactRawLineMatches(pendingRow, options) {
  const rawLine = pendingRow?.raw_line;
  const date = pendingDate.value;
  if (!rawLine || !date) return 0;

  const { data, error } = await supabaseClient
    .from(table("SUPABASE_PENDING_TABLE"))
    .select("*")
    .eq("quote_date", date)
    .eq("status", "pending")
    .eq("raw_line", rawLine)
    .neq("id", pendingRow.id)
    .order("id", { ascending: false });
  if (error) throw error;

  let count = 0;
  for (const row of data || []) {
    try {
      await executeApproval(row, cloneApprovalOptions(options));
      count += 1;
    } catch (error) {
      console.warn("exact raw-line auto approve failed", row.id, error);
    }
  }
  return count;
}

async function approvePending(card, rowId) {
  const pendingRow = pendingRowsById[rowId];
  const parsedColors = (card.dataset.parsedColors || "").split(",").filter(Boolean);
  const dualEnabled = card.querySelector(".bind-dual-color")?.checked;
  const options = buildApprovalOptions(pendingRow, guessBinding(pendingRow.raw_line || ""), {
    deviceType: card.querySelector(".bind-device-type").value,
    brand: card.querySelector(".bind-brand").value,
    condition: card.querySelector(".bind-condition").value,
    category: card.querySelector(".bind-category").value,
    baseModel: card.querySelector(".bind-base-model").value,
    capacity: card.querySelector(".bind-capacity").value,
    color: card.querySelector(".bind-color").value,
    bindPrice: card.querySelector(".bind-price").value,
    dualEnabled: dualEnabled && parsedColors.length >= 2,
  });

  if (!options.baseModel || !options.bindPrice) {
    alert("請選擇型號並填價格");
    return;
  }

  await executeApproval(pendingRow, options);
  const exactAutoCount = await autoApproveExactRawLineMatches(pendingRow, options);
  await loadPending();
  if (statAutoHint) {
    statAutoHint.textContent = exactAutoCount > 0
      ? `同文字自動核准 ${exactAutoCount} 筆`
      : statAutoHint.textContent;
  }
}

async function rejectPending(rowId) {
  const now = new Date().toISOString();
  await supabaseClient.from(table("SUPABASE_PENDING_TABLE")).update({
    status: "rejected",
    reviewed_at: now,
    updated_at: now,
  }).eq("id", rowId);
  await loadPending();
  await updateAuditStats(pendingDate.value);
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

function refreshModelMsrpField() {
  const category = newModelCategory?.value || "new";
  const isUsed = category === "used";
  if (newModelMsrpRow) {
    newModelMsrpRow.style.display = isUsed ? "none" : "";
  }
  if (newModelMsrp) {
    newModelMsrp.required = !isUsed;
    if (isUsed) newModelMsrp.value = "";
  }
  if (newModelHint) {
    newModelHint.textContent = isUsed
      ? "二手寫入型號目錄即可，不需建議售價；待審下拉會出現新型號。"
      : "寫入 product_msrp，待審下拉選單會出現新型號（不含容量顏色後綴）；新機／iPad／配件需填建議售價。";
  }
}

async function addBaseModel() {
  const category = newModelCategory?.value || "new";
  const baseModel = normalizeKey(newModelName?.value || "");
  const isUsed = category === "used";
  const msrpRaw = newModelMsrp?.value;
  const msrp = msrpRaw ? Number(msrpRaw) : null;
  if (!baseModel) {
    alert("請輸入型號 key");
    return;
  }
  if (!isUsed && (!msrp || msrp <= 0)) {
    alert("新機／iPad／配件請填建議售價（正整數）");
    return;
  }
  const msrpTable = table("SUPABASE_MSRP_TABLE");
  const effectiveFrom = new Date().toISOString().slice(0, 10);
  const row = {
    model_key: baseModel,
    category,
    msrp: isUsed ? null : msrp,
    note: isUsed ? "二手型號目錄（無建議售價）" : "admin catalog",
    effective_from: effectiveFrom,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseClient.from(msrpTable).upsert(row, { onConflict: "model_key,effective_from" });
  if (error) {
    alert(error.message);
    return;
  }
  newModelName.value = "";
  if (newModelMsrp) newModelMsrp.value = "";
  await loadModelOptions();
  await loadPending();
  alert(`已新增型號 ${baseModel}（${category}）`);
}

function setAdminReviewTab(tab) {
  activeAdminTab = tab === "demand" ? "demand" : "quote";
  adminReviewTabs?.querySelectorAll(".tab").forEach((btn) => {
    const on = btn.dataset.tab === activeAdminTab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (pendingList) pendingList.hidden = activeAdminTab !== "quote";
  if (buyDemandPendingList) buyDemandPendingList.hidden = activeAdminTab !== "demand";
  if (dedupPendingBtn) dedupPendingBtn.hidden = activeAdminTab !== "quote";
  if (autoApproveLearned?.closest("label")) {
    autoApproveLearned.closest("label").hidden = activeAdminTab !== "quote";
  }
}

function renderBuyDemandPending(rows) {
  buyDemandPendingRowsById = {};
  if (!buyDemandPendingList) return;
  if (!rows.length) {
    buyDemandPendingList.innerHTML = '<div class="card muted">今天沒有徵收待綁定訊息</div>';
    return;
  }
  buyDemandPendingList.innerHTML = rows.map((row) => {
    buyDemandPendingRowsById[row.id] = row;
    const { who, group } = formatSenderLabel(row);
    const guess = guessBinding(row.raw_line || "");
    const kw = row.intent_keyword ? `「${row.intent_keyword}」` : "徵收";
    return `
    <article class="card pending-card buy-demand-card" data-id="${row.id}">
      <div class="pending-meta">#${row.id} · ${kw} · ${who}</div>
      <div class="pending-sub">${group || "（群組未知）"}</div>
      <pre class="pending-text">${row.raw_line}</pre>
      <p class="pending-price-note">無價格徵收訊息：綁定型號後寫入徵收熱度</p>
      ${learnedBadge(guess)}
      <div class="pending-actions">
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem">綁定型號</p>
        <div class="pending-bind-grid">
          <label>pipeline 分類${categorySelect(guess.category)}</label>
          <label>型號${baseModelSelect(guess.category, guess.baseModel)}</label>
          <label>${capacitySelect(guess.capacity)}</label>
          <label>${colorSelect(guess.color)}</label>
        </div>
        <button type="button" class="btn-primary approve-demand-btn">核准綁定</button>
        <button type="button" class="btn-secondary reject-demand-btn">忽略</button>
      </div>
    </article>`;
  }).join("");
}

async function loadBuyDemandPending() {
  const date = pendingDate.value;
  if (!date) return;
  const pendingTable = table("SUPABASE_BUY_DEMAND_PENDING_TABLE");
  const { data, error } = await supabaseClient
    .from(pendingTable)
    .select("*")
    .eq("quote_date", date)
    .eq("status", "pending")
    .order("id", { ascending: false });
  if (error) {
    if (error.code === "42P01") {
      if (buyDemandPendingList) {
        buyDemandPendingList.innerHTML = '<div class="card muted">請在 Supabase 執行 supabase_migration_v7_buy_demand.sql</div>';
      }
      return;
    }
    throw error;
  }
  renderBuyDemandPending(data || []);
}

async function approveBuyDemandPending(card, rowId) {
  const pendingRow = buyDemandPendingRowsById[rowId];
  if (!pendingRow) throw new Error("找不到待綁定資料");
  const category = card.querySelector(".bind-category").value;
  const baseModel = card.querySelector(".bind-base-model").value;
  const capacity = card.querySelector(".bind-capacity").value;
  const color = card.querySelector(".bind-color").value;
  const binding = resolveModelBinding(category, baseModel, capacity, color);
  if (!binding?.model_key) throw new Error("請選擇有效型號");

  const date = pendingDate.value;
  const now = new Date().toISOString();
  const demandTable = table("SUPABASE_BUY_DEMAND_TABLE");
  const specClear = Boolean(capacity || color);
  await supabaseClient.from(demandTable).upsert({
    quote_date: date,
    category: binding.category,
    model_key: binding.model_key,
    model: binding.model,
    capacity: binding.capacity,
    color: binding.color,
    spec_clear: specClear,
    intent_keyword: pendingRow.intent_keyword || "",
    from_mid: pendingRow.from_mid || "",
    sender_name: pendingRow.sender_name || "",
    chat_id: pendingRow.chat_id || "",
    chat_name: pendingRow.chat_name || "",
    message_id: pendingRow.message_id,
    raw_line: pendingRow.raw_line,
    quoted_at: now,
    updated_at: now,
  }, { onConflict: "quote_date,from_mid,category,model_key" });

  await supabaseClient.from(table("SUPABASE_BUY_DEMAND_PENDING_TABLE")).update({
    status: "approved",
    bound_category: binding.category,
    bound_model_key: binding.model_key,
    reviewed_at: now,
    updated_at: now,
  }).eq("id", pendingRow.id);

  await loadBuyDemandPending();
}

async function rejectBuyDemandPending(rowId) {
  const now = new Date().toISOString();
  await supabaseClient.from(table("SUPABASE_BUY_DEMAND_PENDING_TABLE")).update({
    status: "rejected",
    reviewed_at: now,
    updated_at: now,
  }).eq("id", rowId);
  await loadBuyDemandPending();
}

async function initAdmin() {
  try {
    initClient();
    if (autoApproveLearned) {
      const stored = localStorage.getItem(AUTO_APPROVE_KEY);
      if (stored !== null) autoApproveLearned.checked = stored === "1";
      autoApproveLearned.addEventListener("change", () => {
        localStorage.setItem(AUTO_APPROVE_KEY, autoApproveLearned.checked ? "1" : "0");
        loadPending().catch((e) => alert(e.message));
      });
    }
    await loadTaxonomy();
    refreshModelMsrpField();
    await loadModelOptions();
    await loadPendingDates();
    setAdminReviewTab("quote");
    await loadPending();
    await loadBuyDemandPending();
  } catch (error) {
    pendingList.innerHTML = `<div class="card error">${error.message}</div>`;
  }
}

initAdmin();

refreshPendingBtn?.addEventListener("click", () => {
  if (activeAdminTab === "demand") {
    loadBuyDemandPending().catch((e) => alert(e.message));
  } else {
    loadPending().catch((e) => alert(e.message));
  }
});
dedupPendingBtn?.addEventListener("click", () => dedupePendingForDate().catch((e) => alert(e.message)));
addBrandBtn?.addEventListener("click", () => addBrand().catch((e) => alert(e.message)));
addModelBtn?.addEventListener("click", () => addBaseModel().catch((e) => alert(e.message)));
newModelCategory?.addEventListener("change", refreshModelMsrpField);

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

pendingDate.addEventListener("change", () => {
  if (statAutoHint) statAutoHint.textContent = "";
  loadPending();
  loadBuyDemandPending().catch(() => {});
});

adminReviewTabs?.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  setAdminReviewTab(btn.dataset.tab);
  if (btn.dataset.tab === "demand") {
    loadBuyDemandPending().catch((err) => alert(err.message));
  }
});

buyDemandPendingList?.addEventListener("click", async (event) => {
  const card = event.target.closest(".buy-demand-card");
  if (!card) return;
  const rowId = Number(card.dataset.id);
  try {
    if (event.target.classList.contains("approve-demand-btn")) {
      await approveBuyDemandPending(card, rowId);
    }
    if (event.target.classList.contains("reject-demand-btn")) {
      await rejectBuyDemandPending(rowId);
    }
  } catch (error) {
    alert(error.message);
  }
});
