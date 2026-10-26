/**
 * 審計後台：Apify 活動日、執行狀態、電商對比手動行情。
 * 只讀寫 Supabase。不呼叫 Apify，頁面上不放 token。
 * iphone_prices 用 anon（既有 RLS）；三張新表用登入後的 access token。
 */
(function () {
  const STATUS_LABEL = {
    ran_ok: "已跑完",
    ran_error: "跑失敗",
    skipped_not_promo_day: "非活動日",
    skipped_outside_window: "不在時段",
    skipped_budget: "超過 5 美元上限",
    skipped_disabled: "本月設定關閉",
    skipped_already_ran: "本時段已跑過",
  };
  const DEFAULT_SLOTS = ["00:00", "02:00", "04:00"];
  const DEFAULT_NOTE = "活動日：每月 1、18、25 號，月份等於日期的雙數日（例如 10/10），加上刷卡活動檔與設定檔裡的手動日期；社群當天券達到 3 張也算。真正判斷在 Win11，網頁這段是說明。時段不是連續區間，是幾個鐘點。本機設定檔目前是 00:00、02:00、04:00。";
  const MODEL_COLOR_RE = /(勃根地紅|冰川藍|太空黑|太空灰|天藍|淺綠|薄荷綠|海藍|珊瑚紅|鈦灰|鈦黑|鈦銀|鈦藍|鈦金|鈦白|星光白|星光|夜空色|夜空|午夜|薄荷|黑|白|金|藍|綠|黃|橘|紫|粉|鈦|原|銀|灰|紅)$/;

  const apifyStatusTitle = document.getElementById("apifyStatusTitle");
  const apifySourceBadge = document.getElementById("apifySourceBadge");
  const apifyStatusBanner = document.getElementById("apifyStatusBanner");
  const apifyStatusMeta = document.getElementById("apifyStatusMeta");
  const apifyStatusNote = document.getElementById("apifyStatusNote");
  const apifyRunLog = document.getElementById("apifyRunLog");
  const refreshApifyStatusBtn = document.getElementById("refreshApifyStatusBtn");
  const apifyMonth = document.getElementById("apifyMonth");
  const apifyTimeStart = document.getElementById("apifyTimeStart");
  const apifyTimeEnd = document.getElementById("apifyTimeEnd");
  const apifyEnabled = document.getElementById("apifyEnabled");
  const apifyRangeList = document.getElementById("apifyRangeList");
  const addApifyRangeBtn = document.getElementById("addApifyRangeBtn");
  const saveApifyScheduleBtn = document.getElementById("saveApifyScheduleBtn");
  const apifyScheduleMsg = document.getElementById("apifyScheduleMsg");
  const ecomMarketCategory = document.getElementById("ecomMarketCategory");
  const ecomMarketSearch = document.getElementById("ecomMarketSearch");
  const ecomMarketMsg = document.getElementById("ecomMarketMsg");
  const ecomMarketList = document.getElementById("ecomMarketList");

  let anonClient = null;
  let authClient = null;
  let marketRows = [];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }

  function taipeiParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const bag = {};
    for (const part of fmt.formatToParts(date)) {
      if (part.type !== "literal") bag[part.type] = part.value;
    }
    let hour = bag.hour;
    if (hour === "24") hour = "00";
    return {
      yearMonth: `${bag.year}-${bag.month}`,
      date: `${bag.year}-${bag.month}-${bag.day}`,
      hm: `${hour}:${bag.minute}`,
      year: Number(bag.year),
      month: Number(bag.month),
      day: Number(bag.day),
    };
  }

  function formatTaipei(iso) {
    if (!iso) return "—";
    const parts = taipeiParts(new Date(iso));
    return `${parts.date} ${parts.hm}`;
  }

  function shiftDate(dateStr, days) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${dt.getUTCFullYear()}-${mm}-${dd}`;
  }

  function taipeiDayBounds(dateStr) {
    const start = new Date(`${dateStr}T00:00:00+08:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  function minutesOf(hhmm) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ""));
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  function isDefaultPromoDay(month, day) {
    if (day === 1 || day === 18 || day === 25) return true;
    return day === month && month % 2 === 0;
  }

  function dayInRanges(day, ranges) {
    if (!Array.isArray(ranges)) return false;
    return ranges.some((range) => {
      const start = Number(range?.start);
      const end = Number(range?.end);
      return Number.isFinite(start) && Number.isFinite(end) && day >= start && day <= end;
    });
  }

  function formatRanges(ranges) {
    if (!Array.isArray(ranges) || !ranges.length) return "（沒有日期）";
    return ranges.map((range) => {
      const start = Number(range.start);
      const end = Number(range.end);
      return start === end ? `${start} 日` : `${start}–${end} 日`;
    }).join("、");
  }

  function windowState(schedule, hm) {
    const nowMin = minutesOf(hm);
    if (!schedule) {
      return {
        inWindow: DEFAULT_SLOTS.includes(hm),
        windowStarted: DEFAULT_SLOTS.some((slot) => {
          const slotMin = minutesOf(slot);
          return slotMin != null && nowMin != null && nowMin >= slotMin;
        }),
      };
    }
    const start = minutesOf(schedule.time_start);
    const end = minutesOf(schedule.time_end);
    if (start == null || end == null || nowMin == null) return { inWindow: false, windowStarted: false };
    if (start <= end) {
      return { inWindow: nowMin >= start && nowMin <= end, windowStarted: nowMin >= start };
    }
    const inWindow = nowMin >= start || nowMin <= end;
    const inGap = nowMin > end && nowMin < start;
    return { inWindow, windowStarted: !inGap };
  }

  function todayIsPromo(schedule, parts) {
    if (!schedule) return isDefaultPromoDay(parts.month, parts.day);
    return dayInRanges(parts.day, schedule.day_ranges);
  }

  function decideApifyBanner(input) {
    const logs = input.todayLogs || [];
    const hasOk = logs.some((row) => row.status === "ran_ok");
    const hasError = logs.some((row) => row.status === "ran_error");
    const hasBudget = logs.some((row) => row.status === "skipped_budget");
    const disabled = input.hasScheduleRow && input.enabled === false;

    if (disabled && !hasError && !hasBudget && !hasOk) {
      return { tone: "gray", title: "本月設定已關閉，預期不跑" };
    }
    if (hasError && !hasOk) {
      return { tone: "red", title: "今天有執行失敗，且沒有成功紀錄" };
    }
    if (hasBudget && !hasOk) {
      return { tone: "red", title: "超過 5 美元上限，今天沒有成功執行" };
    }
    if (!input.todayIsPromo) {
      return { tone: "gray", title: "今日非活動日，預期不跑" };
    }
    if (hasOk) {
      return { tone: "green", title: "今天是活動日，已有成功執行" };
    }
    if (disabled) {
      return { tone: "gray", title: "本月設定已關閉，預期不跑" };
    }
    if (input.windowStarted && logs.length === 0) {
      return { tone: "red", title: "今天應跑，但完全沒有執行紀錄" };
    }
    if (!input.windowStarted) {
      return { tone: "yellow", title: "今天是活動日，時段還沒到" };
    }
    return { tone: "yellow", title: "今天是活動日，尚無成功執行" };
  }

  function pricesOfRow(row) {
    const prices = [];
    if (Array.isArray(row.price_stats)) {
      for (const item of row.price_stats) {
        const price = Number(item?.price);
        if (Number.isFinite(price)) prices.push(price);
      }
    }
    if (!prices.length && row.top_price != null && row.top_price !== "") {
      const price = Number(row.top_price);
      if (Number.isFinite(price)) prices.push(price);
    }
    return prices;
  }

  function autoMarketPriceFromRows(rows) {
    const sell = (rows || []).filter((row) => (row.trade_side || "sell") === "sell");
    if (!sell.length) return null;
    let latest = "";
    for (const row of sell) {
      const quoteDate = String(row.quote_date || "");
      if (quoteDate > latest) latest = quoteDate;
    }
    if (!latest) return null;
    let min = null;
    for (const row of sell) {
      if (String(row.quote_date || "") !== latest) continue;
      for (const price of pricesOfRow(row)) {
        if (min == null || price < min) min = price;
      }
    }
    return min;
  }

  function formatMoney(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    return Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
  }

  function splitModelKey(modelKey) {
    const key = (modelKey || "").trim();
    const colorMatch = key.match(MODEL_COLOR_RE);
    const color = colorMatch ? colorMatch[1] : "";
    const body = color ? key.slice(0, -color.length) : key;
    const capMatch = body.match(/(64|128|256|512|1T|2T)$/i);
    const capacity = capMatch ? capMatch[1].toUpperCase() : "";
    const model = capacity ? body.slice(0, -capacity.length).trim() : body.trim();
    return { model, capacity, color };
  }

  function inferDeviceType(row) {
    if (row.device_type) return row.device_type;
    if (row.category === "new_ipad") return "tablet";
    if (row.category === "mac") return "computer";
    if (row.category === "android") return "phone";
    if (row.category === "accessory") return "accessory";
    if (row.category === "used") {
      const key = String(row.model_key || row.model || "").toLowerCase();
      if (key.includes("ipad")) return "tablet";
      if (key.includes("airpods") || key.includes("watch")) return "wearable";
      if (key.includes("mac")) return "computer";
    }
    return "phone";
  }

  function ipadConnectionFromKey(modelKey) {
    const parts = String(modelKey || "").trim().split(/\s+/);
    const last = (parts[parts.length - 1] || "").toLowerCase();
    if (last === "lte") return "LTE";
    if (last === "wifi") return "WiFi";
    return "";
  }

  function ipadBaseModelName(row) {
    const name = row.model || splitModelKey(row.model_key).model || row.model_key || "";
    return name.replace(/\s*(WiFi|LTE)\s*$/i, "").trim();
  }

  function isWatchAccessoryRow(row) {
    const key = row.model_key || "";
    if (/^(S1[12]|SE|Ultra)/i.test(key)) return true;
    return inferDeviceType(row) === "wearable";
  }

  function watchConnectionFromKey(modelKey) {
    const key = String(modelKey || "");
    if (/LTE/i.test(key)) return "LTE";
    if (/GPS/i.test(key)) return "GPS";
    return "";
  }

  function watchBaseModelLabel(row) {
    let model = String(row.model || "").replace(/\b(GPS|LTE)\b/gi, "").replace(/\s+/g, " ").trim();
    const cap = String(row.capacity || "").trim();
    if (model && cap && !model.toLowerCase().includes(cap.toLowerCase())) model = `${model} ${cap}`;
    if (!model) model = (row.model_key || "").replace(/(GPS|LTE).*/i, "").trim();
    return model.replace(/^SE(?=\s|\d{2}mm|$)/i, "SE3") || row.model_key || "";
  }

  function watchRowModelLabel(row) {
    if (!isWatchAccessoryRow(row)) return row.model || splitModelKey(row.model_key).model || row.model_key || "—";
    const base = watchBaseModelLabel(row);
    const conn = watchConnectionFromKey(row.model_key)
      || (/\bLTE\b/i.test(row.model || "") ? "LTE" : "")
      || (/\bGPS\b/i.test(row.model || "") ? "GPS" : "");
    if (conn) return `${base} ${conn}`;
    if (/^(S1[12]|SE|Ultra)/i.test(row.model_key || "")) return `${base} GPS`;
    return base || row.model_key || "—";
  }

  function ipadRowModelLabel(row) {
    if (row.category !== "new_ipad") return row.model || splitModelKey(row.model_key).model || row.model_key || "—";
    const base = ipadBaseModelName(row);
    const conn = ipadConnectionFromKey(row.model_key)
      || (/\blte\b/i.test(row.model || "") ? "LTE" : "")
      || (/\bwifi\b/i.test(row.model || "") ? "WiFi" : "");
    return conn ? `${base} ${conn}` : base;
  }

  function rowModelLabel(row) {
    if (row.category === "new_ipad") return ipadRowModelLabel(row);
    if (isWatchAccessoryRow(row)) return watchRowModelLabel(row);
    const raw = row.model || splitModelKey(row.model_key).model || row.model_key || "—";
    if (/^duo$/i.test(String(raw).trim())) return "iPhone Duo";
    return raw;
  }

  function ecomDisplayName(row) {
    const label = rowModelLabel(row);
    const parts = splitModelKey(row.model_key);
    const cap = String(row.capacity || parts.capacity || "").trim();
    const color = String(row.color || parts.color || "").trim();
    let text = label === "—" ? "" : label;
    if (cap && !text.toLowerCase().includes(cap.toLowerCase())) text = `${text} ${cap}`.trim();
    if (color && !text.includes(color)) text = `${text} ${color}`.trim();
    return text || row.model_key || "—";
  }

  function needLoginError() {
    const error = new Error("請先登入。這三張表只開放已登入帳號。");
    error.code = "NEED_LOGIN";
    return error;
  }

  function readStoredSession() {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || "";
        if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        const parsed = JSON.parse(localStorage.getItem(key) || "null");
        const session = parsed?.currentSession || parsed?.session || parsed;
        if (session?.access_token) return session;
      }
    } catch (_) {}
    return null;
  }

  function initClients() {
    anonClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "ipw-anon-ecom",
      },
    });
    const options = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "ipw-ecom-auth",
      },
    };
    options.accessToken = async () => readStoredSession()?.access_token || null;
    authClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, options);
  }

  async function authed() {
    if (window.authGate?.getAccessToken) {
      const session = readStoredSession();
      const expMs = Number(session?.expires_at || 0) * 1000;
      if (!session?.access_token || (expMs && expMs < Date.now() + 15000)) {
        await window.authGate.getAccessToken(!session?.access_token || expMs < Date.now() + 15000);
      }
    }
    if (!readStoredSession()?.access_token) throw needLoginError();
    return authClient;
  }

  async function fetchPaged(makeQuery) {
    const rows = [];
    const pageSize = 1000;
    let from = 0;
    while (from <= 20000) {
      const { data, error } = await makeQuery().range(from, from + pageSize - 1);
      if (error) throw error;
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  }

  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("error", kind === "error");
    el.classList.toggle("ok", kind === "ok");
  }

  function paintBanner(tone, title, showDefault) {
    if (apifyStatusBanner) apifyStatusBanner.className = `ecom-status ecom-status--${tone}`;
    if (apifyStatusTitle) apifyStatusTitle.textContent = title;
    if (apifySourceBadge) apifySourceBadge.hidden = !showDefault;
  }

  function statusText(status) {
    return STATUS_LABEL[status] || status || "—";
  }

  function logDetail(row) {
    const bits = [];
    if (row.summary) bits.push(row.summary);
    if ((row.status === "ran_error" || row.status === "skipped_budget") && row.error_message && row.error_message !== row.summary) {
      bits.push(row.error_message);
    }
    return bits.join(" — ") || "—";
  }

  function renderRunLog(rows) {
    if (!apifyRunLog) return;
    if (!rows.length) {
      apifyRunLog.innerHTML = '<div class="muted">還沒有執行紀錄。</div>';
      return;
    }
    apifyRunLog.innerHTML = rows.map((row) => {
      const alert = row.status === "ran_error" || row.status === "skipped_budget";
      return `<article class="ecom-log-item${alert ? " is-alert" : ""}">
        <div><strong>${escapeHtml(formatTaipei(row.started_at))}</strong>${escapeHtml(statusText(row.status))}</div>
        <div>${escapeHtml(logDetail(row))}</div>
      </article>`;
    }).join("");
  }

  function describeMeta(schedule, parts, state) {
    const promo = todayIsPromo(schedule, parts);
    if (!schedule) {
      return [
        `現在（台北）${parts.date} ${parts.hm}`,
        "本月活動日：每月 1、18、25 號，以及月份等於日期的雙數日（例如 10/10）。另含刷卡活動檔、設定檔手動日期，與社群當天券滿 3 張（Win11 判斷）。",
        `以網頁能算的日曆來看，今天${promo ? "算" : "不是"}活動日。`,
        "時段：00:00、02:00、04:00（不是連續區間）。",
        state.inWindow ? "現在在窗內：這一分鐘對上其中一個鐘點。" : "現在不在窗內：這一分鐘沒有對上這三個鐘點。",
      ].join("\n");
    }
    const cross = minutesOf(schedule.time_end) != null
      && minutesOf(schedule.time_start) != null
      && minutesOf(schedule.time_end) < minutesOf(schedule.time_start);
    return [
      `現在（台北）${parts.date} ${parts.hm}`,
      `本月活動日：${formatRanges(schedule.day_ranges)}。`,
      `今天${promo ? "在" : "不在"}活動日裡。`,
      `時段：${schedule.time_start}–${schedule.time_end}（Asia/Taipei，含開始與結束${cross ? "，跨過午夜" : ""}）。`,
      state.inWindow ? "現在在窗內。" : "現在不在窗內。",
      schedule.enabled === false ? "本月設定已關閉，預期不跑。" : "",
    ].filter(Boolean).join("\n");
  }

  async function loadApifyStatus() {
    const client = await authed();
    const parts = taipeiParts();
    const bounds = taipeiDayBounds(parts.date);
    const [scheduleRes, recentRes, todayRes] = await Promise.all([
      client.from("ecom_apify_promo_schedule").select("year_month,day_ranges,time_start,time_end,enabled").eq("year_month", parts.yearMonth).maybeSingle(),
      client.from("ecom_apify_run_log").select("started_at,status,summary,error_message,schedule_source").order("started_at", { ascending: false }).limit(20),
      client.from("ecom_apify_run_log").select("started_at,status,summary,error_message").gte("started_at", bounds.start).lt("started_at", bounds.end).order("started_at", { ascending: false }).limit(100),
    ]);
    if (scheduleRes.error) throw scheduleRes.error;
    if (recentRes.error) throw recentRes.error;
    if (todayRes.error) throw todayRes.error;
    const schedule = scheduleRes.data || null;
    const state = windowState(schedule, parts.hm);
    const banner = decideApifyBanner({
      hasScheduleRow: Boolean(schedule),
      enabled: schedule ? schedule.enabled !== false : true,
      todayIsPromo: todayIsPromo(schedule, parts),
      windowStarted: state.windowStarted,
      inWindow: state.inWindow,
      todayLogs: todayRes.data || [],
    });
    paintBanner(banner.tone, banner.title, !schedule);
    if (apifyStatusMeta) apifyStatusMeta.textContent = describeMeta(schedule, parts, state);
    if (apifyStatusNote) apifyStatusNote.textContent = schedule ? "本月以這筆資料為準。" : DEFAULT_NOTE;
    renderRunLog(recentRes.data || []);
  }

  function renderRangeEditor(ranges) {
    if (!apifyRangeList) return;
    const list = ranges?.length ? ranges : [{ start: "", end: "" }];
    apifyRangeList.innerHTML = list.map((range) => `
      <div class="ecom-range-row">
        <label>開始日<input class="apify-range-start" type="number" min="1" max="31" step="1" value="${escapeHtml(range.start ?? "")}" /></label>
        <label>結束日<input class="apify-range-end" type="number" min="1" max="31" step="1" value="${escapeHtml(range.end ?? "")}" /></label>
        <button type="button" class="btn-secondary apify-range-remove">移除</button>
      </div>
    `).join("");
  }

  function readRanges() {
    if (!apifyRangeList) return [];
    return [...apifyRangeList.querySelectorAll(".ecom-range-row")].map((row) => ({
      start: row.querySelector(".apify-range-start")?.value?.trim() || "",
      end: row.querySelector(".apify-range-end")?.value?.trim() || "",
    })).filter((range) => range.start !== "" || range.end !== "");
  }

  function validateRanges(ranges) {
    if (!ranges.length) return "請至少填一段日期";
    for (const range of ranges) {
      const start = Number(range.start);
      const end = Number(range.end);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > 31 || end < 1 || end > 31) {
        return "日期要是 1 到 31 的整數";
      }
      if (start > end) return "同一段的開始日不能晚於結束日";
    }
    return "";
  }

  function validateClock(value) {
    return minutesOf(value) != null;
  }

  async function loadPromoSchedule() {
    const month = apifyMonth?.value || taipeiParts().yearMonth;
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const client = await authed();
    const { data, error } = await client
      .from("ecom_apify_promo_schedule")
      .select("year_month,day_ranges,time_start,time_end,enabled")
      .eq("year_month", month)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      renderRangeEditor([{ start: "", end: "" }]);
      if (apifyTimeStart) apifyTimeStart.value = "";
      if (apifyTimeEnd) apifyTimeEnd.value = "";
      if (apifyEnabled) apifyEnabled.checked = true;
      setMsg(apifyScheduleMsg, `${month} 還沒有資料列。掃描沿用程式預設，按儲存才會覆寫。`, "");
      return;
    }
    renderRangeEditor(data.day_ranges || []);
    if (apifyTimeStart) apifyTimeStart.value = data.time_start || "";
    if (apifyTimeEnd) apifyTimeEnd.value = data.time_end || "";
    if (apifyEnabled) apifyEnabled.checked = data.enabled !== false;
    setMsg(apifyScheduleMsg, `${month} 已有設定。`, "ok");
  }

  async function savePromoSchedule() {
    const month = apifyMonth?.value || "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setMsg(apifyScheduleMsg, "月份要是 YYYY-MM", "error");
      return;
    }
    const ranges = readRanges();
    const rangeError = validateRanges(ranges);
    if (rangeError) {
      setMsg(apifyScheduleMsg, rangeError, "error");
      return;
    }
    const timeStart = apifyTimeStart?.value || "";
    const timeEnd = apifyTimeEnd?.value || "";
    if (!validateClock(timeStart) || !validateClock(timeEnd)) {
      setMsg(apifyScheduleMsg, "時段要是 24 小時 HH:MM", "error");
      return;
    }
    const client = await authed();
    const { error } = await client.from("ecom_apify_promo_schedule").upsert({
      year_month: month,
      day_ranges: ranges.map((range) => ({ start: Number(range.start), end: Number(range.end) })),
      time_start: timeStart,
      time_end: timeEnd,
      enabled: Boolean(apifyEnabled?.checked),
      updated_at: new Date().toISOString(),
    }, { onConflict: "year_month" });
    if (error) throw error;
    setMsg(apifyScheduleMsg, `已儲存 ${month}`, "ok");
    await loadApifyStatus();
  }

  async function deletePromoSchedule(yearMonth) {
    const client = await authed();
    const { error } = await client.from("ecom_apify_promo_schedule").delete().eq("year_month", yearMonth);
    if (error) throw error;
  }

  function latestPriceRow(rows) {
    let best = null;
    for (const row of rows || []) {
      if (!best || String(row.quote_date || "") > String(best.quote_date || "")) best = row;
    }
    return best;
  }

  async function loadCompareMarket() {
    const category = ecomMarketCategory?.value || "new";
    const parts = taipeiParts();
    const fromDate = shiftDate(parts.date, -2);
    setMsg(ecomMarketMsg, "載入中…", "");
    const [priceRows, msrpRows] = await Promise.all([
      fetchPaged(() => anonClient
        .from("iphone_prices")
        .select("category,model_key,model,capacity,color,device_type,quote_date,trade_side,price_stats,top_price")
        .eq("category", category)
        .eq("trade_side", "sell")
        .gte("quote_date", fromDate)
        .lte("quote_date", parts.date)
        .order("model_key")
        .order("quote_date")),
      fetchPaged(() => anonClient
        .from("product_msrp")
        .select("category,model_key")
        .eq("category", category)
        .order("model_key")),
    ]);
    let overrides = [];
    let authNote = "";
    try {
      const client = await authed();
      const { data, error } = await client
        .from("ecom_compare_market_override")
        .select("category,model_key,manual_price,updated_at")
        .eq("category", category);
      if (error) throw error;
      overrides = data || [];
    } catch (error) {
      authNote = error.code === "NEED_LOGIN" || /登入|JWT|row-level security|permission/i.test(error.message || "")
        ? "手動行情需要登入後才能讀寫。"
        : `手動行情讀取失敗：${error.message}`;
    }
    const pricesByKey = new Map();
    for (const row of priceRows) {
      const key = (row.model_key || "").trim();
      if (!key) continue;
      if (!pricesByKey.has(key)) pricesByKey.set(key, []);
      pricesByKey.get(key).push(row);
    }
    const overrideByKey = new Map(overrides.map((row) => [row.model_key, row]));
    const keys = new Set([...pricesByKey.keys(), ...overrideByKey.keys()]);
    for (const row of msrpRows) {
      const key = (row.model_key || "").trim();
      if (key) keys.add(key);
    }
    marketRows = [...keys].map((modelKey) => {
      const samples = pricesByKey.get(modelKey) || [];
      const latest = latestPriceRow(samples);
      const spec = {
        category,
        model_key: modelKey,
        model: latest?.model || "",
        capacity: latest?.capacity || "",
        color: latest?.color || "",
        device_type: latest?.device_type || "",
      };
      const manual = overrideByKey.get(modelKey);
      return {
        ...spec,
        display: ecomDisplayName(spec),
        autoPrice: autoMarketPriceFromRows(samples),
        manualPrice: manual ? Number(manual.manual_price) : null,
      };
    }).sort((a, b) => a.display.localeCompare(b.display, "zh-Hant"));
    setMsg(ecomMarketMsg, authNote, authNote ? "error" : "");
    renderMarketRows();
  }

  function visibleMarketRows() {
    const query = (ecomMarketSearch?.value || "").trim().toLowerCase();
    const matched = marketRows.filter((row) => {
      if (!query) return true;
      return row.display.toLowerCase().includes(query) || row.model_key.toLowerCase().includes(query);
    });
    if (!query && matched.length > 80) {
      const pinned = matched.filter((row) => row.manualPrice != null);
      const rest = matched.filter((row) => row.manualPrice == null).slice(0, 80);
      const seen = new Set();
      const rows = [];
      for (const row of [...pinned, ...rest]) {
        if (seen.has(row.model_key)) continue;
        seen.add(row.model_key);
        rows.push(row);
      }
      return { rows, total: matched.length, truncated: true };
    }
    return { rows: matched.slice(0, 300), total: matched.length, truncated: matched.length > 300 };
  }

  function renderMarketRows() {
    if (!ecomMarketList) return;
    const view = visibleMarketRows();
    if (!view.rows.length) {
      ecomMarketList.innerHTML = '<tr><td colspan="5" class="muted">這個品類沒有對得上的型號。</td></tr>';
      return;
    }
    const note = view.truncated
      ? `<tr><td colspan="5" class="muted">共 ${view.total} 筆，畫面上先列 ${view.rows.length} 筆。輸入型號可再縮小。</td></tr>`
      : "";
    ecomMarketList.innerHTML = note + view.rows.map((row) => {
      const manual = row.manualPrice != null && Number.isFinite(row.manualPrice);
      const manualValue = manual ? String(row.manualPrice) : "";
      return `<tr data-category="${escapeHtml(row.category)}" data-model-key="${escapeHtml(row.model_key)}">
        <td>${escapeHtml(row.display)}<span class="ecom-key">${escapeHtml(row.model_key)}</span></td>
        <td>${escapeHtml(formatMoney(row.autoPrice))}</td>
        <td class="${manual ? "ecom-source-manual" : "ecom-source-auto"}">${manual ? "手動" : "自動"}</td>
        <td><input class="ecom-manual-input" type="number" min="0" step="1" value="${escapeHtml(manualValue)}" /></td>
        <td><div class="ecom-row-actions">
          <button type="button" class="btn-primary ecom-save-manual">儲存</button>
          <button type="button" class="btn-secondary ecom-clear-manual">清除</button>
        </div></td>
      </tr>`;
    }).join("");
  }

  async function saveMarketOverride(category, modelKey, price) {
    const client = await authed();
    const { error } = await client.from("ecom_compare_market_override").upsert({
      category,
      model_key: modelKey,
      manual_price: price,
      updated_at: new Date().toISOString(),
    }, { onConflict: "category,model_key" });
    if (error) throw error;
    const row = marketRows.find((item) => item.category === category && item.model_key === modelKey);
    if (row) row.manualPrice = price;
    renderMarketRows();
    setMsg(ecomMarketMsg, `已儲存 ${modelKey} 的手動行情`, "ok");
  }

  async function clearMarketOverride(category, modelKey) {
    const client = await authed();
    const { error } = await client.from("ecom_compare_market_override").delete().eq("category", category).eq("model_key", modelKey);
    if (error) throw error;
    const row = marketRows.find((item) => item.category === category && item.model_key === modelKey);
    if (row) row.manualPrice = null;
    renderMarketRows();
    setMsg(ecomMarketMsg, `已清除 ${modelKey} 的手動行情`, "ok");
  }

  function bindEvents() {
    refreshApifyStatusBtn?.addEventListener("click", () => {
      loadApifyStatus().catch((error) => {
        paintBanner("red", "狀態讀取失敗", false);
        if (apifyStatusNote) apifyStatusNote.textContent = error.message || "讀取失敗";
      });
    });
    apifyMonth?.addEventListener("change", () => {
      loadPromoSchedule().catch((error) => setMsg(apifyScheduleMsg, error.message, "error"));
    });
    addApifyRangeBtn?.addEventListener("click", () => {
      const ranges = readRanges();
      ranges.push({ start: "", end: "" });
      renderRangeEditor(ranges);
    });
    apifyRangeList?.addEventListener("click", (event) => {
      if (!event.target.classList?.contains("apify-range-remove")) return;
      const rows = [...apifyRangeList.querySelectorAll(".ecom-range-row")];
      if (rows.length <= 1) {
        renderRangeEditor([{ start: "", end: "" }]);
        return;
      }
      event.target.closest(".ecom-range-row")?.remove();
    });
    saveApifyScheduleBtn?.addEventListener("click", () => {
      savePromoSchedule().catch((error) => setMsg(apifyScheduleMsg, error.message, "error"));
    });
    ecomMarketCategory?.addEventListener("change", () => {
      loadCompareMarket().catch((error) => setMsg(ecomMarketMsg, error.message, "error"));
    });
    ecomMarketSearch?.addEventListener("input", () => renderMarketRows());
    ecomMarketList?.addEventListener("click", (event) => {
      const rowEl = event.target.closest("tr[data-model-key]");
      if (!rowEl) return;
      const category = rowEl.getAttribute("data-category");
      const modelKey = rowEl.getAttribute("data-model-key");
      if (event.target.classList.contains("ecom-save-manual")) {
        const raw = rowEl.querySelector(".ecom-manual-input")?.value?.trim() || "";
        if (raw === "") {
          setMsg(ecomMarketMsg, "請填手動行情，或按清除刪掉覆寫", "error");
          return;
        }
        const price = Number(raw);
        if (!Number.isFinite(price) || price < 0) {
          setMsg(ecomMarketMsg, "手動行情要是 0 以上的數字", "error");
          return;
        }
        saveMarketOverride(category, modelKey, price).catch((error) => setMsg(ecomMarketMsg, error.message, "error"));
      }
      if (event.target.classList.contains("ecom-clear-manual")) {
        const display = rowEl.querySelector("td")?.childNodes?.[0]?.textContent || modelKey;
        if (!window.confirm(`清除「${display}」的手動行情？這會刪掉覆寫，不會改成 0。`)) return;
        clearMarketOverride(category, modelKey).catch((error) => setMsg(ecomMarketMsg, error.message, "error"));
      }
    });
  }

  async function initEcomAdmin() {
    try {
      if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
        paintBanner("red", "缺少 Supabase 設定", false);
        return;
      }
      initClients();
      bindEvents();
      const parts = taipeiParts();
      if (apifyMonth && !apifyMonth.value) apifyMonth.value = parts.yearMonth;
      renderRangeEditor([{ start: "", end: "" }]);
      await Promise.all([
        loadApifyStatus().catch((error) => {
          paintBanner("gray", "登入後才能讀取執行狀態", false);
          if (apifyStatusMeta) apifyStatusMeta.textContent = "尚未讀到本月資料列。下面是沒有資料列時的程式預設，登入後會改看資料表。";
          if (apifyStatusNote) apifyStatusNote.textContent = `${error.message || "讀取失敗"}\n${DEFAULT_NOTE}`;
          if (apifyRunLog) apifyRunLog.textContent = "登入後才能看執行紀錄。重新整理只會重新查詢，不會觸發掃描。";
        }),
        loadPromoSchedule().catch((error) => setMsg(apifyScheduleMsg, error.message, "error")),
        loadCompareMarket().catch((error) => setMsg(ecomMarketMsg, error.message, "error")),
      ]);
    } catch (error) {
      paintBanner("red", "電商設定載入失敗", false);
      if (apifyStatusNote) apifyStatusNote.textContent = error.message || "載入失敗";
    }
  }

  window.ecomAdminApi = {
    loadApifyStatus,
    loadPromoSchedule,
    savePromoSchedule,
    deletePromoSchedule,
    loadCompareMarket,
    saveMarketOverride,
    clearMarketOverride,
    autoMarketPriceFromRows,
    decideApifyBanner,
    isDefaultPromoDay,
    ecomDisplayName,
    taipeiParts,
    windowState,
    todayIsPromo,
  };

  if (document.getElementById("apifyStatusPanel")) initEcomAdmin();
})();
