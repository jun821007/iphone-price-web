# 發佈成手機 Web App

## 方式 A：GitHub → Netlify（正式環境，Win11 推薦）

流程：**先把程式推上 GitHub → 再到 Netlify 選這個 repo 部署**。

### 第一步：推上 GitHub（Win11）

本機 repo：`C:\Users\rsz97\iphone-price-web`  
遠端：`https://github.com/jun821007/iphone-price-web`

若尚未登入 GitHub CLI：

```powershell
gh auth login
```

第一次建立並推送（若 repo 已存在可跳過）：

```powershell
cd C:\Users\rsz97\iphone-price-web
gh repo create iphone-price-web --public --source=. --remote=origin --push
```

之後每次改前端：

```powershell
cd C:\Users\rsz97\iphone-price-web
git add .
git commit -m "update web"
git push
```

`config.js` 已在 `.gitignore`，**不會**被推上 GitHub（金鑰留在本機）。

---

### 第二步：Netlify 連 GitHub repo

1. 開 <https://app.netlify.com/> 登入
2. **Add new site** → **Import an existing project**
3. 選 **GitHub**，授權 Netlify 讀取你的 repo
4. 選 **`jun821007/iphone-price-web`**
5. Build settings（通常會自動讀 `netlify.toml`，確認如下）：
   - **Branch to deploy**：`main`
   - **Build command**：`bash scripts/netlify-build.sh`
   - **Publish directory**：`.`（根目錄）
6. 展開 **Environment variables**，新增：

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | 你本機 `config.js` 的 URL |
| `SUPABASE_ANON_KEY` | 你本機 `config.js` 的 anon key |

7. 按 **Deploy site**

部署成功後 Netlify 會給一個 `https://xxxx.netlify.app` 網址；之後每次 `git push` 到 `main` 會自動重新部署。

### 手機安裝 PWA

1. 手機瀏覽器開 Netlify 網址
2. Android Chrome：選單 → **加入主畫面**
3. iPhone Safari：分享 → **加入主畫面**

---

## 方式 B：Netlify Drop（不經 GitHub，最快測試）

1. 開 <https://app.netlify.com/drop>
2. 把整個 `C:\Users\rsz97\iphone-price-web` 資料夾拖上去（含本機 `config.js`）
3. 用手機開產生的網址 → 加入主畫面

---

## 方式 C：同 WiFi 本機測試

PowerShell：

```powershell
cd C:\Users\rsz97\iphone-price-web
python -m http.server 8080
```

手機瀏覽器開 `http://電腦IPv4:8080`

---

## 發佈前確認

- Supabase 已執行 `supabase_migration_v5_discount.sql`
- 本機 `config.js` 是正式 Supabase URL / anon key
- Netlify 環境變數已設 `SUPABASE_URL`、`SUPABASE_ANON_KEY`
- 手機 `run.py` 已更新到最新版並重跑
- 瀏覽器 Ctrl+F5 或清除站台資料，避免舊 service worker 快取
