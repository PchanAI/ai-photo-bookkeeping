# 部署到 Cloudflare Pages

本專案為純前端 PWA（無後端、無 API 金鑰需注入環境變數），只要把 `dist/` 部署上去即可。

## 部署參數（Cloudflare Dashboard 輸入）

| 欄位 | 值 |
|---|---|
| Framework preset | Vite |
| Build command | `npm run zip-ext && npm run build` |
| Build output directory | `dist` |
| Root directory | (空白，專案根目錄) |
| Node version | 22（專案內有 `.nvmrc`，Pages 會自動讀取） |

> 不需要設定環境變數。Gemini 金鑰、財政部 API 金鑰皆由使用者在瀏覽器 `localStorage` 內自行填入。

## 步驟 A：透過 Git 整合（推薦）

1. 在 GitHub 建一個新的空 repo（例如 `ai-photo-bookkeeping`），不要勾 README / .gitignore。
2. 本機連線：
   ```powershell
   cd "D:\Cursor AI\AI-Photo-BookKeeping"
   git remote add origin https://github.com/<你的帳號>/ai-photo-bookkeeping.git
   git push -u origin master
   ```
3. 到 Cloudflare Dashboard → Workers & Pages → **Create application** → **Pages** → **Connect to Git**，選剛建的 repo。
4. 填入上方「部署參表」的欄位，點 **Deploy site**。
5. 之後每次 `git push` 都會自動觸發建置與部署。

### 常見坑
- **分支名稱**：Cloudflare 預設部署 `main`。本專案 `git init` 後預設是 `master`，建遠端 repo 時把預設分支改成 `master`，或在 Cloudflare 的「Branches」區把 `master` 設為 production branch。
- **首次建置逾時**：若看到 `The build process appears to be stuck`，通常是 `npm install` 下載了 27MB 的 `ort-wasm-simd-threaded.jsep.wasm`。已可透過 `.nvmrc` 指定 Node 22；若仍慢，可於 Cloudflare 的 Build 環境變數加 `NODE_OPTIONS=--max-old-space-size=4096`。
- **Service Worker 沒生效**：只有 HTTPS 或 `localhost` 才會註冊 SW（見 `index.html` 的註冊條件）。部署後請用 `https://<subdomain>.pages.dev` 測試，不要在 http 或 127.0.0.1 上測試。
- **chrome-extension.zip 缺**：`.gitignore` 把它排除了。部署前請確認 `public/chrome-extension.zip` 存在（執行 `npm run zip-ext` 產生），並在 Cloudflare 的 Build 命令改為 `npm run zip-ext && npm run build`，讓每次部署都重產 zip。

## 步驟 B：直接上傳 dist（不需 git）

1. 本機執行：
   ```powershell
   cd "D:\Cursor AI\AI-Photo-BookKeeping"
   npm run zip-ext
   npm run build
   ```
2. 把 `dist/` 整個壓縮成 zip（或留成資料夾）。
3. Cloudflare Dashboard → Pages → **Upload assets**，選 repo 名稱後上傳。
4. 上傳完成後會自動發布。

> 此法每次都要手動上傳，不適合持續更新。

## 部署後驗證

- 開啟部署網址，瀏覽器 DevTools → Application → Service Workers 應有 `sw.js` 已啟用
- Application → IndexedDB → `BookKeepingDatabase` 應能正常讀寫
- Application → Manifest 應顯示 14 種圖示與 PWA 安裝選項
- 手機：Chrome 點「安裝應用程式」可成功安裝
- 切到「統計分析」應看到 Chart.js 圖表正常渲染
