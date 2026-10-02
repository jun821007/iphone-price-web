// 網頁門鎖：沒登入就只看得到登入框。放在 <head>、config.js 之後同步載入，畫面顯示前就先擋住。
// 只擋網頁畫面，不改資料庫權限，所以手機報價抓取和 Win11 比價照常用 anon key 運作。
// Session 存在 localStorage 並自動續期，登入一次之後不會自己登出。
(function () {
  const LOCK_CLASS = "auth-locked";
  const root = document.documentElement;
  root.classList.add(LOCK_CLASS);

  const style = document.createElement("style");
  style.textContent = `
    html.${LOCK_CLASS} body > *:not(#authGate) { display: none !important; }
    #authGate {
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: #f3f5f9; padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif;
    }
    html:not(.${LOCK_CLASS}) #authGate { display: none; }
    .auth-card {
      width: 100%; max-width: 360px; background: #fff; border-radius: 14px;
      padding: 28px 24px; box-shadow: 0 8px 30px rgba(26, 39, 68, 0.12);
    }
    .auth-card h1 { margin: 0 0 4px; font-size: 1.25rem; color: #1a2744; }
    .auth-card p { margin: 0 0 20px; color: #6b7280; font-size: 0.9rem; }
    .auth-card label { display: block; font-size: 0.85rem; color: #374151; margin: 12px 0 6px; }
    .auth-card input {
      width: 100%; box-sizing: border-box; padding: 11px 12px; font-size: 1rem;
      border: 1px solid #d1d5db; border-radius: 9px;
    }
    .auth-card input:focus { outline: none; border-color: #1a2744; }
    .auth-card button {
      width: 100%; margin-top: 20px; padding: 12px; font-size: 1rem; font-weight: 600;
      color: #fff; background: #1a2744; border: 0; border-radius: 9px; cursor: pointer;
    }
    .auth-card button:disabled { opacity: 0.6; cursor: default; }
    .auth-error { min-height: 1.2em; margin-top: 12px; color: #b91c1c; font-size: 0.85rem; }
    .auth-checking .auth-form { display: none; }
    .auth-checking .auth-wait { display: block; }
    .auth-wait { display: none; color: #6b7280; text-align: center; }
  `;
  document.head.appendChild(style);

  const hasSupabase = window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY;
  const client = hasSupabase
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;

  let visitLogged = false;

  // 每次打開網頁記一次「帳號 × IP × 裝置」，Win11 發現新 IP／新裝置會推 Telegram 提醒管理者
  function logVisit() {
    if (visitLogged || !client) return;
    visitLogged = true;
    client.rpc("log_visit").then(
      () => {},
      () => {}
    );
  }

  function unlock() {
    root.classList.remove(LOCK_CLASS);
    logVisit();
  }

  function lock() {
    root.classList.add(LOCK_CLASS);
  }

  function hasStoredSession() {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || "";
        if (key.startsWith("sb-") && key.endsWith("-auth-token")) return true;
      }
    } catch (_) {
      return false;
    }
    return false;
  }

  function translateError(error) {
    const msg = String(error?.message || error || "");
    if (/invalid login credentials/i.test(msg)) return "帳號或密碼錯誤";
    if (/email not confirmed/i.test(msg)) return "帳號尚未啟用，請聯絡管理者";
    if (/network|fetch/i.test(msg)) return "網路連線失敗，請稍後再試";
    return msg || "登入失敗";
  }

  function buildGate() {
    if (document.getElementById("authGate")) return;
    const gate = document.createElement("div");
    gate.id = "authGate";
    gate.className = "auth-checking";
    gate.innerHTML = `
      <div class="auth-card">
        <div class="auth-wait">確認登入狀態…</div>
        <form class="auth-form" autocomplete="on">
          <h1>盤商報價</h1>
          <p>請登入後查看</p>
          <label for="authEmail">Email</label>
          <input id="authEmail" type="email" autocomplete="username" required />
          <label for="authPassword">密碼</label>
          <input id="authPassword" type="password" autocomplete="current-password" required />
          <button type="submit">登入</button>
          <div class="auth-error" role="alert"></div>
        </form>
      </div>`;
    document.body.prepend(gate);

    const form = gate.querySelector(".auth-form");
    const errorBox = gate.querySelector(".auth-error");
    const button = form.querySelector("button");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!client) {
        errorBox.textContent = "網站設定錯誤（缺少 Supabase 設定）";
        return;
      }
      errorBox.textContent = "";
      button.disabled = true;
      button.textContent = "登入中…";
      const { error } = await client.auth.signInWithPassword({
        email: form.querySelector("#authEmail").value.trim(),
        password: form.querySelector("#authPassword").value,
      });
      button.disabled = false;
      button.textContent = "登入";
      if (error) {
        errorBox.textContent = translateError(error);
        return;
      }
      // 一個帳號只留一台裝置：其他裝置的登入全部失效
      try {
        await client.auth.signOut({ scope: "others" });
      } catch (_) {}
      // 頁面腳本在鎖住時已經載入過資料，重新整理讓畫面以登入狀態完整初始化
      window.location.reload();
    });
  }

  function showLoginForm(message) {
    const gate = document.getElementById("authGate");
    if (!gate) return;
    gate.classList.remove("auth-checking");
    const box = gate.querySelector(".auth-error");
    if (box && message) box.textContent = message;
    const email = gate.querySelector("#authEmail");
    if (email) email.focus();
  }

  function isNetworkError(error) {
    return /retryable|network|fetch|timeout/i.test(`${error?.name || ""} ${error?.message || ""}`);
  }

  // 伺服器端確認登入還有效；被其他裝置登入擠掉時鎖回登入畫面（離線不踢人）
  async function verifyStillValid() {
    if (!client || root.classList.contains(LOCK_CLASS)) return;
    try {
      const { error } = await client.auth.getUser();
      if (!error || isNetworkError(error)) return;
      if (error.status === 401 || error.status === 403 || /session|jwt|token/i.test(error.message || "")) {
        await client.auth.signOut({ scope: "local" }).catch(() => {});
        lock();
        showLoginForm("這個帳號已在其他裝置登入，請重新登入");
      }
    } catch (_) {}
  }

  async function check() {
    if (!client) {
      showLoginForm();
      return;
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (data?.session) {
        unlock();
        verifyStillValid();
        return;
      }
      // 離線時續期會失敗，但本機有登入紀錄就不要把人踢出去；被登出（續期被拒）就不放行
      if (error && isNetworkError(error) && hasStoredSession()) {
        unlock();
        return;
      }
    } catch (_) {
      if (hasStoredSession()) {
        unlock();
        return;
      }
    }
    showLoginForm();
  }

  setInterval(verifyStillValid, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") verifyStillValid();
  });

  if (client) {
    client.auth.onAuthStateChange((event, session) => {
      if (session) unlock();
      if (event === "SIGNED_OUT") {
        lock();
        showLoginForm();
      }
    });
  }

  window.authGate = {
    async signOut() {
      if (client) await client.auth.signOut();
      window.location.reload();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      buildGate();
      check();
    });
  } else {
    buildGate();
    check();
  }
})();
