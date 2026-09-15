# AI 拍照記帳（AI-Photo-BookKeeping）

純前端記帳 Web App（PWA），支援手機與瀏覽器安裝。拍照或上傳單據即可自動辨識、翻譯品項、換算匯率並記帳；亦提供財政部電子發票 API 匯入、發票對獎、統計報表等完整功能。資料全數儲存在本機 IndexedDB，無後端、無帳號。

## 功能總覽

- **快速記帳**：手動輸入（支援算術式金額如 `100+50`）、拍照、上傳單據；自動偵測重複單據
- **AI 單據辨識**：
  - **Gemini 雲端辨識**：自動提取商家、日期、品項、付款方式、發票號碼、隨機碼、統編、載具條碼；支援外幣匯率換算（查臺灣銀行匯率）與品項翻譯為繁體中文；自動偵測旋轉角度並轉正影像
  - **PaddleOCR 本地離線**：純瀏覽器內執行（WASM + ONNX），首次需下載約 15MB 模型；無 Gemini 金鑰也能記帳
- **台灣發票專用**：
  - QRCode 本地解碼（紙本雙 QR、Big5 / Base64 編碼自動偵測）
  - 財政部 API 線上查詢發票明細（HMAC-SHA256 簽章，含 CORS 備援代理）
  - 全民稽核文字貼上解析（Gemini 或本地 rule-based）
  - 載具發票匯入（API 按月分片 + CSV 多格式欄位相容）
  - 發票自動對獎（財政部 RSS 中獎號 + 尾碼比對 + 彩帶動畫）
- **統計與資產**：週／月／季／年區間篩選、分類環形圖、收支趨勢圖、分類穿透、帳戶資產負債看板、帳戶互轉
- **介面**：14 種主題色調（含 4 種淺色）、文字大小調整、交易明細搜尋／篩選／排序、lightbox 縮放與拖曳
- **PWA**：Service Worker 離線快取、可安裝為獨立 App、桌面／主畫面捷徑

## 技術棧

- React 19 + TypeScript 6 + Vite 8
- Tailwind CSS 4
- Dexie（IndexedDB）
- Chart.js / react-chartjs-2
- `@paddleocr/paddleocr-js` + `onnxruntime-web`（本地 OCR）
- `jsqr`（QRCode 解碼）
- `lucide-react`（圖示）

## 安裝與執行

```bash
npm install
npm run dev
```

建置：

```bash
npm run lint
npm run build
```

## 取得 Gemini API Key（選用）

1. 前往 [Google AI Studio](https://aistudio.google.com/)，使用 Google 帳號登入
2. 點選 "Get API key" → "Create API key"
3. 複製金鑰，貼到 App 內「系統設定 → Gemini AI 智慧識別設定」
4. 金鑰僅儲存在您的瀏覽器 `localStorage`，不會上傳到任何第三方伺服器
5. 可新增多組金鑰做負載平衡與容錯切換

未設定 Gemini 金鑰時，仍可切換至「PaddleOCR 本地離線」引擎記帳。

## 財政部 API 申請（選用，載具匯入／線上查詢功能所需）

App 內「系統設定 → 財政部電子發票 API 設定」附完整申請指引。重點：

- 需向財政部申請 **App ID** 與 **API Key**（HMAC 金鑰種子）
- 自 2025 年 3 月底起，個人名義申請已停用，僅限營業人／政府機關／合法登記之軟體商
- 載具匯入另需 **手機條碼載具號碼（cardNo）** 與 **載具驗證碼（cardEncrypt）**

## Chrome 擴充功能（選用）

財政部「全民稽核」網頁無法被本 App 跨網域自動填入。附一個 Chrome 擴充來源於 `chrome-extension/`：

1. 執行 `npm run zip-ext` 產生 `public/chrome-extension.zip`
2. 下載 ZIP 並解壓縮
3. 開啟 `chrome://extensions/` → 開發人員模式 → 載入未封裝項目 → 選 `chrome-extension` 資料夾
4. 之後點 App 內「打開網頁 ↗」即自動帶入發票號碼、日期、隨機碼

## 財政部 CSV 自動下載（選用）

```bash
node scripts/download_invoices.js
```

會開啟 Chromium 讓您手動輸入圖形驗證碼並登入財政部平台，登入後自動導向「載具發票查詢」並下載 CSV，檔案存於專案根目錄。再回到 App「匯入載具發票 → 匯入 CSV 檔案」拖放即可完成記帳。

## 資料備份

設定頁提供「匯出資料備份 (JSON)」／「匯入備份檔案」／「重設資料庫」。備份包含交易、照片、帳戶、分類與 API 金鑰，請妥善保管，勿分享。

## 目錄結構

```
chrome-extension/        # 全民稽核自動帶入 Chrome 擴充（source of truth）
public/                  # 靜態資源：manifest、SW、icons、favicon
  chrome-extension.zip   # 由 npm run zip-ext 產生（已 .gitignore）
scripts/
  download_invoices.js   # Playwright 自動下載財政部 CSV
  zip_extension.js       # 打包 chrome-extension/ 為 public/chrome-extension.zip
src/
  App.tsx                # 主殼：分頁、主題、儀表板、明細、lightbox、批次辨識
  components/
    AddRecordModal.tsx         # 記帳＋單據辨識＋發票 API 查詢/貼上解析
    ImportCarrierInvoicesModal.tsx  # 載具發票 API + CSV 匯入
    Stats.tsx                # 統計報表與穿透
    AccountsManager.tsx      # 帳戶／轉帳
    InvoicePrizeChecker.tsx  # 發票對獎
    Settings.tsx             # 設定（金鑰、主題、分類、備份）
  services/
    gemini.ts                # Gemini OCR、QR 解析、財政部 API、RSS
    localOcr.ts              # PaddleOCR 本地引擎
  db.ts                      # Dexie schema 與 seed
```
