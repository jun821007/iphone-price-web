# 發佈成手機 Web App

## 方式 A：GitHub Pages（Win11 推薦）

### 一次性設定

1. PowerShell 登入 GitHub CLI：

```powershell
gh auth login
```

2. 在 GitHub 建立 repo 後，到 **Settings → Secrets and variables → Actions**，新增：

| Secret 名稱 | 值 |
|-------------|-----|
| `SUPABASE_URL` | `https://kabkrriksisiujfipevj.supabase.co` |
| `SUPABASE_ANON_KEY` | 你的 anon key |

3. 到 **Settings → Pages → Build and deployment**：
   - Source：**GitHub Actions**

### 每次更新（Win11）

```powershell
cd C:\Users\rsz97\iphone-price-web
git add .
git commit -m "update web"
git push
```

推送後 Actions 會自動部署，網址通常是：

```text
https://你的GitHub帳號.github.io/iphone-price-web/
```

### 手機安裝

1. 手機瀏覽器開上面的 GitHub Pages 網址
2. Android Chrome：選單 → **加入主畫面**
3. iPhone Safari：分享 → **加入主畫面**

---

## 方式 B：Netlify Drop（最快）

1. 開 <https://app.netlify.com/drop>
2. 把整個 `C:\Users\rsz97\iphone-price-web` 資料夾拖上去
3. Netlify 產生網址後，用手機 Chrome/Safari 開啟
4. Android Chrome：右上角選單 →「加入主畫面」
5. iPhone Safari：分享 →「加入主畫面」

## 方式 B：同 WiFi 本機測試

PowerShell：

```powershell
cd C:\Users\rsz97\iphone-price-web
python -m http.server 8080
```

手機瀏覽器開：

```text
http://電腦IPv4:8080
```

注意：PWA 安裝功能正式使用建議放 HTTPS（Netlify / Cloudflare Pages / Vercel）。

## 發佈前確認

- Supabase 已執行 `supabase_migration_v5_discount.sql`
- `config.js` 裡是正式 Supabase URL / anon key
- 手機 `run.py` 已更新到最新版並重跑
- 瀏覽器 Ctrl+F5 或清除站台資料，避免舊 service worker 快取
