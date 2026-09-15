import type { GeminiScanResult } from './gemini';

// PaddleOCR + ONNX Runtime are loaded at runtime from jsDelivr via dynamic import.
// This keeps the Vite bundle small (under Cloudflare's 25 MiB per-asset limit).
// The PaddleOCR engine fetches its own WASM binaries from the same CDN at init time.

let ocrInstance: any = null;

const PADDLEOCR_CDN = 'https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/dist/paddleocr.js';
const ONNX_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';

async function loadPaddleOCR(): Promise<any> {
  // Dynamically import PaddleOCR from CDN so the main bundle stays small.
  const module = await import(/* @vite-ignore */ PADDLEOCR_CDN);
  return module.default?.PaddleOCR ?? module.PaddleOCR;
}

/**
 * Initialize the local PaddleOCR engine using ONNX Runtime Web.
 * All WASM & model files are fetched from the jsDelivr CDN at runtime.
 */
export async function initLocalOcr(onProgress?: (progressText: string) => void): Promise<any> {
  if (ocrInstance) return ocrInstance;

  if (onProgress) onProgress('正在初始化 ONNX Runtime 運算晶片 & 下載輕量化 OCR 模型 (約 15MB)，請稍候...');

  try {
    const PaddleOCR = await loadPaddleOCR();
    ocrInstance = await PaddleOCR.create({
      lang: 'ch',
      ocrVersion: 'PP-OCRv5',
      worker: false, // Run in main thread to bypass CORS and Web Worker bundler issues in dev server
      ortOptions: {
        backend: 'wasm',
        wasmPaths: ONNX_CDN,
        numThreads: 1, // Must be 1 unless crossOriginIsolated headers are enabled on the server
        simd: true,
      },
    });

    if (onProgress) onProgress('本地辨識引擎載入成功！');
    return ocrInstance;
  } catch (err) {
    console.error('Failed to initialize local PaddleOCR:', err);
    ocrInstance = null;
    throw new Error('無法載入本地 OCR 模型，請檢查網路連線或改用 Gemini API 智慧辨識。');
  }
}

/**
 * Runs PaddleOCR locally in the browser on the provided image element, canvas, or base64 data.
 */
export async function scanReceiptLocally(
  base64Image: string,
  onProgress?: (progressText: string) => void
): Promise<GeminiScanResult> {
  const ocr = await initLocalOcr(onProgress);

  if (onProgress) onProgress('本地引擎正在掃描並識別單據影像文字...');

  // Convert base64 data URL to Blob to support PaddleOCR image source requirement
  const response = await fetch(base64Image);
  const blob = await response.blob();

  // Predict returns array of { text, confidence, box }
  const predictions = await ocr.predict(blob);

  if (!predictions || predictions.length === 0) {
    throw new Error('本地辨識未偵測到任何單據文字，請確保單據拍攝清晰且光源充足。');
  }

  if (onProgress) onProgress('正在對識別文字進行智慧關聯與欄位提取...');

  // Flatten all items from all results into a single text array
  const allTexts = predictions.flatMap((r: any) => (r.items || []).map((i: any) => i.text));
  return parseLocalOcrResults(allTexts);
}

/**
 * Heuristically parses raw OCR bounding boxes and texts into structured receipt format.
 * Acts as a local frontend rule-based parser mapping items, merchant, dates, total cost, and categories.
 */
export function parseLocalOcrResults(lines: string[]): GeminiScanResult {
  let merchant = '本地辨識商家';
  let date = new Date().toISOString().split('T')[0];
  let originalTotalAmount = 0;
  const items: any[] = [];
  let category = 'Others';

  // 1. Merchant Extraction
  // Usually the first line of text that has no numbers is the merchant name
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const text = lines[i];
    // If it doesn't contain digits or contains common merchant suffixes
    if (!/\d/.test(text) && text.length > 2 && !/收據|發票|明細/i.test(text)) {
      merchant = text;
      break;
    }
  }

  // 2. Date Extraction
  // Look for dates like 2026/06/25 or 115-06-25
  const dateRegex = /(\d{3,4})[-/.](\d{1,2})[-/.](\d{1,2})/;
  for (const text of lines) {
    const match = text.match(dateRegex);
    if (match) {
      let year = parseInt(match[1]);
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');

      // Handle Taiwan ROC year (e.g. 115 -> 2026)
      if (year < 1000) {
        year += 1911;
      }
      date = `${year}-${month}-${day}`;
      break;
    }
  }

  // 3. Amount and Items extraction
  // Find all lines that contain numbers, which could be prices
  const priceRegex = /(\d+)\s*$/; // number at the end of the line
  const numbers: number[] = [];

  for (const text of lines) {
    // Check if it looks like an item: e.g. "肉燥飯 45" or "美式咖啡 數量1 55"
    const match = text.match(priceRegex);
    if (match) {
      const price = parseInt(match[1]);
      numbers.push(price);

      // If it's a potential item line, e.g. contains text and a price
      let name = text.replace(match[0], '').trim();
      // Strip residual quantity tokens like "數量1" / "数量 2" that OCR leaves in the name
      name = name.replace(/\s*數量?\s*[\d.]+\s*/g, ' ').trim();
      if (
        name.length > 1 &&
        !/總計|合計|金額|應付|實付|找零|找續|現金|刷卡|信用卡|稅|發票|統一發票|小計|折扣|優惠/i.test(name)
      ) {
        const item = {
          originalName: name,
          translatedName: name,
          quantity: 1,
          originalUnitPrice: price,
          convertedUnitPriceTWD: price,
          originalTotalPrice: price,
          convertedTotalPriceTWD: price,
        };
        items.push(item);
      }
    }
  }

  // Extract Total Amount:
  // Look for lines with "總計", "合計", "應付", "金額", etc.
  const totalKeywords = /總計|合計|應付|實付|金額|總金額|TOTAL|Total|AMOUNT|Amount|應收/i;
  for (let i = 0; i < lines.length; i++) {
    if (totalKeywords.test(lines[i])) {
      // Look for a price in this line or the next 2 lines
      for (let j = i; j <= Math.min(lines.length - 1, i + 2); j++) {
        const match = lines[j].match(priceRegex);
        if (match) {
          originalTotalAmount = parseInt(match[1]);
          break;
        }
      }
      if (originalTotalAmount > 0) break;
    }
  }

  // Fallback: If no total found from keywords, use the largest number found in the receipt (excluding dates)
  if (originalTotalAmount === 0 && numbers.length > 0) {
    // Filter out date numbers or extremely large outlier numbers (like invoice numbers)
    const validAmounts = numbers.filter((n) => n < 100000); // assume total is < 100,000
    if (validAmounts.length > 0) {
      originalTotalAmount = Math.max(...validAmounts);
    }
  }

  // 4. Category Classification based on keywords
  const foodKeywords = /餐|飲|食|飯|麵|咖啡|茶|奶|麥當勞|肯德基|便當|壽司|湯|肉|蛋|菜|堡|吐司|三明治|點心|甜點|蛋糕/;
  const transKeywords = /車|捷運|高鐵|火車|公車|加油|計程車|票|機票|路費|停車|悠遊卡|一卡通/;
  const entKeywords = /影|電影|歌|唱歌|KTV|樂園|遊戲|玩具|票|演唱會|展覽|派對|酒吧/;
  const houseKeywords = /租|水|電|瓦斯|衛生紙|洗|裝潢|家具|清潔|日用|垃圾|維修/;
  const medicalKeywords = /藥|醫|診所|醫院|牙|保健|口罩|感冒/;
  const eduKeywords = /書|課|學費|文具|筆|雜誌|補習/;
  const shopKeywords = /服飾|鞋|衣|包|褲|裙|帽|眼鏡|化妝|美妝|購物|屈臣氏|康是美|百貨|網購/;

  const fullText = lines.join(' ');
  if (foodKeywords.test(fullText)) category = 'Food';
  else if (transKeywords.test(fullText)) category = 'Transportation';
  else if (entKeywords.test(fullText)) category = 'Entertainment';
  else if (houseKeywords.test(fullText)) category = 'Housing';
  else if (medicalKeywords.test(fullText)) category = 'Medical';
  else if (eduKeywords.test(fullText)) category = 'Education';
  else if (shopKeywords.test(fullText)) category = 'Shopping';
  else category = 'Others';

  // 5. Payment Method Extraction
  let paymentMethod = '未指定';
  const cashKeywords = /現金|CASH|Cash|找零|找續/;
  const cardKeywords = /信用卡|刷卡|簽帳卡|VISA|Visa|Master|JCB|銀聯|CARD|Card|聯名卡|感應/;
  const mobileKeywords = /行動支付|LINE Pay|Linepay|Apple Pay|Applepay|Google Pay|Googlepay|Samsung Pay|街口|Jko|微信支付|支付寶|支付|掃碼|台灣 Pay|台灣Pay/;
  const transferKeywords = /轉帳|匯款|銀行轉帳|TRANSFER|Transfer/;

  if (mobileKeywords.test(fullText)) {
    paymentMethod = '行動支付';
  } else if (cardKeywords.test(fullText)) {
    paymentMethod = '信用卡';
  } else if (cashKeywords.test(fullText)) {
    paymentMethod = '現金';
  } else if (transferKeywords.test(fullText)) {
    paymentMethod = '轉帳';
  }

  // 5.1. Time Extraction (Heuristic)
  let time = '00:00';
  const timeRegex = /(?:[^\d:]|^)([0-1]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?:[^\d:]|$)/;
  for (const text of lines) {
    const match = text.match(timeRegex);
    if (match) {
      const hours = match[1].padStart(2, '0');
      const minutes = match[2].padStart(2, '0');
      time = `${hours}:${minutes}`;
      break;
    }
  }

  // If no items found, push a dummy item reflecting the total
  if (items.length === 0 && originalTotalAmount > 0) {
    items.push({
      originalName: '消費品項',
      translatedName: '消費品項',
      quantity: 1,
      originalUnitPrice: originalTotalAmount,
      convertedUnitPriceTWD: originalTotalAmount,
      originalTotalPrice: originalTotalAmount,
      convertedTotalPriceTWD: originalTotalAmount,
    });
  }

  return {
    merchant,
    date,
    time,
    originalCurrency: 'TWD',
    exchangeRateUsed: 1.0,
    exchangeRateExplanation: '本地影像辨識，預設為新台幣',
    originalTotalAmount,
    convertedTotalAmountTWD: originalTotalAmount,
    category,
    paymentMethod,
    items,
  };
}
