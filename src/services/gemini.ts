import jsQR from 'jsqr';

export interface ExtractedItem {
  originalName: string;
  translatedName: string;
  quantity: number;
  originalUnitPrice: number;
  convertedUnitPriceTWD: number;
  originalTotalPrice: number;
  convertedTotalPriceTWD: number;
}

export interface GeminiScanResult {
  merchant: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  originalCurrency: string; // e.g. JPY, USD, TWD
  exchangeRateUsed: number; // e.g. 0.215
  exchangeRateExplanation: string; // e.g. Bank of Taiwan cash selling rate for JPY on 2026-06-25
  originalTotalAmount: number;
  convertedTotalAmountTWD: number;
  category: string; // Food, Shopping, Transportation, Entertainment, Housing, Medical, Education, Others
  paymentMethod?: string; // e.g. 現金, 信用卡, 行動支付, 轉帳, etc.
  rotationNeeded?: number; // 0, 90, 180, 270 (degrees clockwise to rotate to make it upright)
  invoiceNumber?: string; // Taiwan electronic invoice number (e.g. AB-12345678)
  randomCode?: string; // Taiwan electronic invoice random code (4 digits)
  sellerTaxId?: string; // Seller's VAT number (8 digits)
  buyerTaxId?: string; // Buyer's VAT number (8 digits)
  carrier?: string; // Mobile carrier barcode (e.g. /AB12345)
  items: ExtractedItem[];
}

export function getGeminiApiKeys(): string[] {
  const stored = localStorage.getItem('gemini_api_keys');
  if (stored) {
    try {
      const keys = JSON.parse(stored);
      if (Array.isArray(keys) && keys.length > 0) {
        return keys.filter(k => typeof k === 'string' && k.trim().length > 0);
      }
    } catch {
      // Fallback
    }
  }
  // Fallback to legacy single key
  const legacyKey = localStorage.getItem('gemini_api_key');
  return legacyKey ? [legacyKey.trim()] : [];
}

export function saveGeminiApiKeys(keys: string[]) {
  const cleanKeys = keys.map(k => k.trim()).filter(k => k.length > 0);
  localStorage.setItem('gemini_api_keys', JSON.stringify(cleanKeys));
  if (cleanKeys.length > 0) {
    localStorage.setItem('gemini_api_key', cleanKeys[0]);
  } else {
    localStorage.removeItem('gemini_api_key');
  }
}

export function getGeminiApiKey(): string {
  const keys = getGeminiApiKeys();
  return keys[0] || '';
}

export function saveGeminiApiKey(key: string) {
  const keys = getGeminiApiKeys();
  const trimmed = key.trim();
  if (trimmed) {
    if (!keys.includes(trimmed)) {
      keys.push(trimmed);
    }
    saveGeminiApiKeys(keys);
  }
}

/**
 * Query available models from Gemini API and select the best supported Flash model.
 * Helps adapt automatically to Gemini model deprecations/updates.
 */
export async function getBestAvailableModel(apiKey: string): Promise<string> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!response.ok) {
      throw new Error(`列出模型失敗: HTTP ${response.status}`);
    }
    const data = await response.json();
    const availableModels = data.models || [];
    
    // Filter models that support generateContent
    const genModels = availableModels.filter((m: any) => 
      m.supportedGenerationMethods?.includes('generateContent')
    );
    
    // Priority checklist of full Flash models. We prefer full models over Lite/experimental.
    const priorityList = [
      'models/gemini-2.5-flash',
      'models/gemini-2.0-flash',
      'models/gemini-1.5-flash',
      'models/gemini-flash-lite-latest',
      'models/gemini-2.0-flash-exp',
      'models/gemini-2.5-flash-exp'
    ];
    
    for (const modelId of priorityList) {
      const found = genModels.find((m: any) => m.name === modelId);
      if (found) {
        return found.name;
      }
    }
    
    // Sort and find best "flash" model if none in priorityList matched
    const flashModels = genModels.filter((m: any) => 
      m.name.toLowerCase().includes('flash')
    );
    
    if (flashModels.length > 0) {
      // Sort alphabetically descending to get latest version (e.g. gemini-2.0-flash over gemini-1.5-flash)
      flashModels.sort((a: any, b: any) => b.name.localeCompare(a.name));
      return flashModels[0].name;
    }
    
    // Fallback to any gemini model
    const geminiModels = genModels.filter((m: any) => 
      m.name.toLowerCase().includes('gemini')
    );
    if (geminiModels.length > 0) {
      geminiModels.sort((a: any, b: any) => b.name.localeCompare(a.name));
      return geminiModels[0].name;
    }
    
    return 'models/gemini-1.5-flash';
  } catch (err) {
    console.warn('查詢可用模型失敗，使用預設 models/gemini-1.5-flash:', err);
    return 'models/gemini-1.5-flash';
  }
}

/**
 * Calls Gemini to scan and process the receipt image.
 * Dynamically queries available models to adapt to API model deprecations/updates.
 * Uses Google Search Grounding to fetch the Bank of Taiwan historical exchange rate on the receipt's date
 * if it's in a foreign currency, translating items and converting amounts to TWD.
 */
export async function scanReceiptWithKey(
  base64Image: string,
  mimeType: string,
  apiKey: string
): Promise<GeminiScanResult> {
  // Query best available Flash model dynamically
  const modelName = await getBestAvailableModel(apiKey);

  // Robust base64 stripping: split by comma to capture content after 'data:image/...;base64,'
  const base64Data = base64Image.split(',')[1] || base64Image;

  // Sanitize MIME type: Gemini supports standard formats; default HEIC/unknown to image/jpeg
  let apiMimeType = mimeType;
  if (!apiMimeType || !apiMimeType.startsWith('image/')) {
    apiMimeType = 'image/jpeg';
  }

  const currentDateStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
  const currentTimeStr = new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei' });
  const prompt = `
當前系統的現在時間為：臺灣時間 ${currentDateStr} ${currentTimeStr}。
你是一個智慧記帳助理。請幫我分析這張收據/發票的影像，並精確提取其內容。

特別要求：
1. 識別收據上的商家名稱 (merchant)、交易日期 (date，格式為 YYYY-MM-DD，若發票上是民國年如 115 年，請轉換為西元年如 2026 年)、交易時間 (time，格式為 HH:mm，24小時制，如果收據上完全無標示具體時間，請回傳 "00:00")、收據的原始貨幣種類 (originalCurrency，如 TWD, JPY, USD, EUR 等)、商品品項明細、總金額，以及付款方式 (paymentMethod，例如：現金、信用卡、行動支付、轉帳、LINE Pay、Apple Pay 等，若無法辨識請寫「未指定」)。
2. 針對台灣統一發票，請盡可能提取以下欄位（若不存在則回傳空字串 ""）：
   - 發票號碼 (invoiceNumber)：格式為「英文大寫2碼-數字8碼」，如 "AB-12345678"。
   - 隨機碼 (randomCode)：發票上的四位數字隨機碼（通常標記在發票號碼下方或QRCode旁），如 "5678"。
   - 店家統一編號 (sellerTaxId)：發票上店家的八位數字統一編號，如 "12345678"。
   - 買方統一編號 (buyerTaxId)：發票上買方的八位數字統一編號（若有打統編報帳），如 "87654321"。
   - 手機條碼載具 (carrier)：手機條碼載具（常為「/」斜線開頭、共7碼的英數字元碼），如 "/AB12345"。
   ⚠️ 重要分類區別：
   a. 【紙本電子發票證明聯】：右下角印有「兩個 QR Code」（左QR含加密驗證資訊，右QR含完整消費明細）。此類型絕對不會印有載具條碼（carrier 請填空字串），通常也不會有個人化買方統一編號，除非對方是營業人且打統編。
   b. 【雲端發票（含消費明細）】：消費者使用手機載具（如手機條碼、悠遊卡載具等）時，店家只開雲端發票，紙本只列印消費明細單（非電子發票證明聯）。此類明細單上通常會印有載具條碼（如 /AB12345），但沒有電子發票QR Code。請正確提取此類單據上的載具條碼並填入 carrier 欄位。
   c. 【傳統二聯/三聯式發票】：印有發票號碼但無QR Code，亦無載具條碼。
3. 判斷這筆消費的記帳分類 (category)，必須是以下之一：
   - Food (對應餐飲食品)
   - Shopping (對應購物消費)
   - Transportation (對應交通出行)
   - Entertainment (對應娛樂消遣)
   - Housing (對應居家生活)
   - Medical (對應醫療保健)
   - Education (對應教育學習)
   - Others (對應其他支出)
    4. 匯率換算與繁體中文翻譯（核心功能）：
      - 如果收據的原始貨幣**不是**新台幣 (TWD) 或語言**不是**台灣繁體中文：
        a. 使用你的 Google Search 搜尋功能，查詢該交易日期 (date) 當天「台灣銀行 (Bank of Taiwan)」的官方外幣對新台幣 (TWD) 匯率（優先採用現鈔賣出價或收盤匯率，若當天非交易日，請採用前一個交易日的匯率）。
        b. 將所有商品的名稱 (originalName) 依據商家的所在地，**透過 Google Search 搜尋並翻譯為台灣本地最常見的「繁體中文名稱」(translatedName)**。務必使用台灣慣用詞彙，例如：日本收據的 "コーラ" 應搜尋確認後翻譯為 "可樂" 而非 "可拉"；"マックフライポテト" 應翻譯為 "麥當勞薯條"；"セブン-イレブン" 應翻譯為 "7-11"。美國收據的 "French fries" 應翻譯為 "炸薯條" 而非 "法國馬鈴薯"；"Ground beef" 應翻譯為 "絞肉" 而非 "地面牛肉"。**如果商品名稱在台灣有特定俗稱或品牌譯名，請優先使用台灣俗稱**。
        c. 將所有商品的單價 (originalUnitPrice)、總價 (originalTotalPrice) 以及收據總金額 (originalTotalAmount) 乘以該匯率，自動轉換成新台幣 (TWD) 的價格與金額（四捨五入至整數）。
        d. 在說明 (exchangeRateExplanation) 中簡述使用的匯率及來源（例如：「臺灣銀行 2026-06-25 日圓現鈔賣出匯率為 0.215」）。
      - 如果收據原始貨幣**就是**新台幣 (TWD)：
        a. 匯率 (exchangeRateUsed) 設為 1.0.
        b. 說明 (exchangeRateExplanation) 寫「新台幣，不需匯率換算」。
        c. 翻譯名稱 (translatedName) 保持與原始名稱相同，或做簡短的繁體化美化。
        d. 所有 TWD 金額與原始金額一致。
5. 偵測單據影像旋轉方向：
   - 判斷發票或收據中的文字是否傾斜或旋轉（例如倒置或橫向）。請分析「將此影像旋轉至文字正向（即由左至右、由上至下正常閱讀）所需的『順時針旋轉角度』」。
   - 數值必須是以下之一：0（文字已正向，不需旋轉）、90（需要順時針旋轉 90 度）、180（需要旋轉 180 度）、270（需要順時針旋轉 270 度）。請將此旋轉角度值填入 "rotationNeeded" 欄位。

請將結果嚴格按照以下 JSON 格式回傳，不要包含 any markdown 標記（如 \`\`\`json ），只需純 JSON 字串：
{
  "merchant": "商家名稱",
  "date": "YYYY-MM-DD",
  "time": "HH:mm",
  "originalCurrency": "貨幣三位代碼",
  "exchangeRateUsed": 匯率數值(浮點數),
  "exchangeRateExplanation": "匯率查詢說明文字",
  "originalTotalAmount": 原始總金額(數值),
  "convertedTotalAmountTWD": 換算後台幣總金額(整數),
  "category": "Food|Shopping|Transportation|Entertainment|Housing|Medical|Education|Others",
  "paymentMethod": "現金|信用卡|行動支付|轉帳|未指定(或其他具體付款方式)",
  "rotationNeeded": 0|90|180|270,
  "invoiceNumber": "AB-12345678 或 空字串",
  "randomCode": "隨機碼 或 空字串",
  "sellerTaxId": "統一編號 或 空字串",
  "buyerTaxId": "買方編號 或 空字串",
  "carrier": "載具條碼 或 空字串",
  "items": [
    {
      "originalName": "原始商品名稱",
      "translatedName": "台灣繁體中文商品名稱",
      "quantity": 數量(整數),
      "originalUnitPrice": 原始單價(數值),
      "convertedUnitPriceTWD": 換算後台幣單價(整數),
      "originalTotalPrice": 原始品項總價(數值),
      "convertedTotalPriceTWD": 換算後台幣品項總價(整數)
    }
  ]
}
  `;

  // Helper function to build and send the request
  const makeRequest = async (toolMode: 'new_search' | 'old_search' | 'none') => {
    const requestBody: any = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: apiMimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {}, // Conditionally configured
    };

    // Gemini API does NOT support structured JSON outputs (responseMimeType: 'application/json')
    // in combination with search grounding tools. Setting both triggers a 400 Bad Request.
    if (toolMode === 'none') {
      requestBody.generationConfig = {
        responseMimeType: 'application/json',
      };
    } else {
      requestBody.generationConfig = {};
    }

    if (toolMode === 'new_search') {
      requestBody.tools = [
        {
          google_search: {}
        }
      ];
    } else if (toolMode === 'old_search') {
      requestBody.tools = [
        {
          googleSearchRetrieval: {
            dynamicRetrievalConfig: {
              mode: 'MODE_DYNAMIC',
              dynamicThreshold: 0.0, // Force search for maximum grounding accuracy
            },
          },
        },
      ];
    }

    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );
  };

  let response;
  try {
    // 1. Try with modern "google_search" tool (required by Gemini 2.0+ models)
    response = await makeRequest('new_search');
    
    if (!response.ok) {
      console.warn('Gemini API with modern google_search failed. Status code:', response.status);
      if (response.status === 429) {
        throw { status: 429 };
      }
      
      // 2. Try with legacy "googleSearchRetrieval" tool
      console.log('Retrying with legacy googleSearchRetrieval...');
      response = await makeRequest('old_search');
      
      if (!response.ok) {
        console.warn('Gemini API with legacy googleSearchRetrieval failed. Status code:', response.status);
        if (response.status === 429) {
          throw { status: 429 };
        }
        
        // 3. Fallback to no tools
        console.log('Retrying without search tools...');
        response = await makeRequest('none');
      }
    }
  } catch (err: any) {
    if (err?.status === 429) {
      console.warn('Rate limit hit. Retrying without search tools...');
      response = await makeRequest('none');
    } else {
      console.warn('Network error or search failed. Retrying without search tools... Error:', err);
      response = await makeRequest('none');
    }
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const errMsg = errData?.error?.message || `HTTP 錯誤碼: ${response.status}`;
    
    if (response.status === 429) {
      throw new Error('Gemini API 呼叫頻率已達上限 (Too Many Requests / 429 錯誤)。如果您使用的是免費版金鑰，限制為每分鐘 15 次請求，請等待一分鐘後再試，或於設定中換用其他金鑰。');
    }
    
    throw new Error(`Gemini API 呼叫失敗: ${errMsg}`);
  }

  const result = await response.json();
  
  try {
    const textResult = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) {
      throw new Error('Gemini 未回傳有效內容');
    }
    
    // Safely extract JSON text if enclosed in markdown code fences
    let cleanedText = textResult.trim();
    if (cleanedText.includes('```')) {
      const match = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        cleanedText = match[1].trim();
      }
    }
    
    // Parse the JSON output
    const parsedData: GeminiScanResult = JSON.parse(cleanedText);
    
    // Safety fallback validations
    if (!parsedData.merchant) parsedData.merchant = '未知商家';
    if (!parsedData.date) parsedData.date = new Date().toISOString().split('T')[0];
    if (!parsedData.originalCurrency) parsedData.originalCurrency = 'TWD';
    if (!parsedData.exchangeRateUsed) parsedData.exchangeRateUsed = 1.0;
    if (!parsedData.convertedTotalAmountTWD) {
      parsedData.convertedTotalAmountTWD = Math.round(parsedData.originalTotalAmount * parsedData.exchangeRateUsed) || 0;
    }
    if (!parsedData.category) parsedData.category = 'Others';
    if (!parsedData.items) parsedData.items = [];
    if (!parsedData.invoiceNumber) parsedData.invoiceNumber = '';
    if (!parsedData.randomCode) parsedData.randomCode = '';
    if (!parsedData.sellerTaxId) parsedData.sellerTaxId = '';
    if (!parsedData.buyerTaxId) parsedData.buyerTaxId = '';
    if (!parsedData.carrier) parsedData.carrier = '';
    
    return parsedData;
  } catch (parseError) {
    console.error('Gemini 回傳解析失敗:', parseError, result);
    throw new Error('無法解析 Gemini 的辨識結果，請重試或手動輸入。');
  }
}

export async function scanReceiptWithGemini(
  base64Image: string,
  mimeType: string
): Promise<GeminiScanResult> {
  const apiKeys = getGeminiApiKeys();
  if (apiKeys.length === 0) {
    throw new Error('請先在設定中輸入 Gemini API Key。');
  }

  let lastError: any = null;
  
  // Choose a random starting index to distribute the load among valid keys (load balancing)
  const startIndex = Math.floor(Math.random() * apiKeys.length);

  for (let i = 0; i < apiKeys.length; i++) {
    const currentIndex = (startIndex + i) % apiKeys.length;
    const apiKey = apiKeys[currentIndex];
    const keyDisplay = `第 ${currentIndex + 1} 組金鑰 (${apiKey.substring(0, 6)}...)`;
    
    try {
      console.log(`開始使用 ${keyDisplay} 進行單據智慧辨識...`);
      const result = await scanReceiptWithKey(base64Image, mimeType, apiKey);
      console.log(`使用 ${keyDisplay} 辨識成功！`);
      return result;
    } catch (err: any) {
      console.warn(`使用 ${keyDisplay} 辨識失敗:`, err);
      lastError = err;
      
      // If it's the only key, throw immediately
      if (apiKeys.length === 1) {
        throw err;
      }
    }
  }

  // If we got here, all keys failed. Throw combined error.
  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`所有設定的 Gemini API 金鑰皆辨識失敗。最後一個錯誤為: ${errMsg}`);
}

/**
 * Rotates a base64 image (Data URL) by the specified degrees (90, 180, 270) using canvas.
 * Returns the rotated base64 image Data URL.
 */
export function rotateBase64Image(base64DataUrl: string, degrees: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (degrees === 0 || degrees === 360) {
      resolve(base64DataUrl);
      return;
    }
    
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }
      
      const normalizedDegrees = ((degrees % 360) + 360) % 360;
      
      // Calculate new dimensions
      if (normalizedDegrees === 90 || normalizedDegrees === 270) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      
      // Draw rotated image to canvas
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((normalizedDegrees * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      
      // Get base64 representation of canvas
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = (err) => reject(err);
    img.src = base64DataUrl;
  });
}

export interface ExtractedQRInvoice {
  invoiceNumber: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  randomCode: string;
  amount: number;
  sellerTaxId: string;
  buyerTaxId?: string;
  items: { name: string; qty: number; price: number; total: number }[];
}

/**
 * Parse the LEFT QR Code of a Taiwan paper e-invoice.
 *
 * ACTUAL format (based on taiwan-invoice open-source parser):
 * Fixed-length positional fields (NO colons) in first 53 characters:
 *   slice(0,10)  = Invoice number  (2 letters + 8 digits)
 *   slice(10,17) = Date            (ROC year yyyMMdd)
 *   slice(17,21) = Random code     (4 digits)
 *   slice(21,29) = Sales amount    (hex 8 chars)
 *   slice(29,37) = Total amount    (hex 8 chars)
 *   slice(37,45) = Buyer tax ID    (8 digits, 00000000 for B2C)
 *   slice(45,53) = Seller tax ID   (8 digits)
 *
 * Variable section after position 53, colon-delimited:
 *   rest[0] = AES digest (24 chars Base64)
 *   rest[1] = Seller custom area / MOF verification code
 *   rest[2] = Total item count
 *   rest[3] = Item count in this QR
 *   rest[4] = Encoding flag (usually '1')
 *   rest[5], rest[6], rest[7]  = name1, qty1, price1
 *   rest[8], rest[9], rest[10] = name2, qty2, price2
 *   ...
 */
/**
 * Helper to decode base64 strings containing UTF-8 characters.
 */
function decodeBase64String(base64: string): string {
  try {
    const trimmed = base64.trim();
    if (!trimmed || !/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
      return trimmed;
    }
    // Pure-numeric tokens (e.g. quantity "123") are NOT base64 — atob would corrupt them.
    // Require at least one non-digit character to qualify as base64.
    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }
    const binaryString = atob(trimmed);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    return base64;
  }
}

export function parseTaiwanInvoiceLeftQR(
  text: string, 
  encoding: 'utf-8' | 'big5' | 'base64' = 'utf-8'
): ExtractedQRInvoice | null {
  if (text.length < 53) return null;

  // Fixed-length positional parsing of the first 53 chars
  const invNum    = text.slice(0, 10);  // e.g. "AB12345678"
  const rocDate   = text.slice(10, 17); // e.g. "1150630"
  const randCode  = text.slice(17, 21); // e.g. "5678"
  const totalHex  = text.slice(29, 37); // hex
  const buyerTaxRaw = text.slice(37, 45);
  const sellerTax = text.slice(45, 53);


  // Validate: invoice number must be 2 uppercase letters + 8 digits
  if (!/^[A-Z]{2}\d{8}$/.test(invNum)) return null;

  const invoiceNumber = `${invNum.slice(0, 2)}-${invNum.slice(2)}`;

  const rocYear = parseInt(rocDate.slice(0, 3));
  const month   = rocDate.slice(3, 5);
  const day     = rocDate.slice(5, 7);
  if (isNaN(rocYear)) return null;
  const date = `${rocYear + 1911}-${month}-${day}`;

  const randomCode  = randCode;
  const amount      = parseInt(totalHex, 16);
  const buyerTaxId  = buyerTaxRaw === '00000000' ? '' : buyerTaxRaw;
  const sellerTaxId = sellerTax;

  // Variable section: everything after position 53, split by ':'
  const rest = text.slice(53).split(':');
  const itemsFromRest = parseItemTriplets(rest, 5, encoding === 'base64');

  // Also try the ** section if present
  const itemsFromStar = parseStarStarSection(text, encoding === 'base64');

  const items = itemsFromStar.length >= itemsFromRest.length ? itemsFromStar : itemsFromRest;

  console.log('[QR left] invoice:', invoiceNumber, 'date:', date, 'amount:', amount, 'encoding:', encoding);
  console.log('[QR left] rest fields:', rest.slice(0, 8));
  console.log('[QR left] items from rest[5+]:', itemsFromRest);
  console.log('[QR left] items from **:', itemsFromStar);

  return { invoiceNumber, date, randomCode, amount, sellerTaxId, buyerTaxId, items };
}

// Keep old name as alias for backward compatibility
/**
 * Normalize a Taiwan invoice number to the canonical "AB12345678" form
 * (uppercase 2 letters + 8 digits, no dash, no whitespace).
 */
export function normalizeInvoiceNumber(raw: string | undefined | null): string {
  if (!raw) return '';
  const stripped = raw.replace(/[-\s]/g, '').toUpperCase();
  return stripped;
}

export function parseTaiwanInvoiceQRText(text: string): ExtractedQRInvoice | null {
  return parseTaiwanInvoiceLeftQR(text);
}

/**
 * Parse items from the RIGHT QR Code of a Taiwan paper e-invoice.
 * Right QR starts with '**' followed by:
 *   {totalCount}:{name1}:{qty1}:{unitPrice1}:{name2}:{qty2}:{unitPrice2}:...
 * If items were too many to fit, the right QR just contains '**' alone.
 */
export function parseRightQRItems(
  text: string, 
  decodeBase64: boolean = false
): { name: string; qty: number; price: number; total: number }[] | null {
  if (!text.startsWith('**')) return null;
  return parseStarStarSection(text, decodeBase64);
}

/**
 * Parse items from a '**' section.
 * Format: **{count}:{name1}:{qty1}:{price1}:{name2}:{qty2}:{price2}:...
 * Items are strict 3-tuples (name : qty : unitPrice).
 */
function parseStarStarSection(text: string, decodeBase64: boolean = false): { name: string; qty: number; price: number; total: number }[] {
  const starIdx = text.indexOf('**');
  if (starIdx === -1) return [];

  const after = text.substring(starIdx + 2);
  const tokens = after.split(':');

  // First token is item count (integer) — skip it
  let start = 0;
  if (tokens.length > 0 && /^\d+$/.test(tokens[0].trim())) {
    start = 1;
  }

  return parseItemTriplets(tokens, start, decodeBase64);
}

/**
 * Parse items from the LEFT QR item section.
 * After the fixed 53-char positional header, the rest is colon-delimited:
 *   rest[0] = AES digest (24 chars Base64)
 *   rest[1] = Seller custom area (variable, often empty or '**')
 *   rest[2] = Total item count
 *   rest[3] = Item count in this QR
 *   rest[4] = Encoding flag ('1')
 *   rest[5+] = items (name, qty, price triplets)
 *
 * HOWEVER: different POS vendors may include different numbers of metadata fields.
 * We scan forward from rest[1] to find the first valid item triplet.
 */
function parseLeftQRItemSection(text: string, decodeBase64: boolean = false): { name: string; qty: number; price: number; total: number }[] {
  if (text.length < 53) return [];
  const rest = text.slice(53).split(':');
  // Scan from index 1 (skip AES at index 0) looking for first valid item triplet
  // A valid triplet: name is non-empty, non-pure-number, non-base64; qty and price are numbers
  const startIdx = findItemsStartIndex(rest);
  if (startIdx === -1) return [];
  return parseItemTriplets(rest, startIdx, decodeBase64);
}

/**
 * Find the starting index of item triplets within a colon-split token array.
 * Scans forward looking for the first token that looks like a product name
 * (non-empty, not a pure number, not a Base64/AES digest block)
 * followed by two numeric tokens.
 * Returns -1 if no valid triplet start found.
 */
function findItemsStartIndex(tokens: string[]): number {
  // Skip index 0 (AES digest). Start scanning from 1.
  for (let i = 1; i + 2 < tokens.length; i++) {
    const t0 = tokens[i].trim();
    const t1 = tokens[i + 1].trim();
    const t2 = tokens[i + 2].trim();
    // t0 must be a plausible product name:
    //   - non-empty
    //   - not a pure integer (would be a metadata count)
    //   - not the single encoding char '1'
    //   - not a 24+ char Base64-looking block (AES digest / cipher, length varies by POS vendor)
    if (!t0) continue;
    if (/^\d+$/.test(t0)) continue;           // skip pure numbers
    if (t0.length >= 24 && /^[A-Za-z0-9+/=]+$/.test(t0)) continue; // skip AES digest
    // t1 must be a positive quantity
    const qty = parseFloat(t1);
    if (isNaN(qty) || qty <= 0) continue;
    // t2 must be a non-negative price
    const price = parseFloat(t2);
    if (isNaN(price) || price < 0) continue;
    return i; // found!
  }
  return -1;
}

/**
 * Common item 3-tuple parser: reads groups of {name, qty, unitPrice} from a token array.
 * Advances strictly by 3 to maintain alignment — never by 1 (which would break 3-tuple sync).
 */
function parseItemTriplets(
  tokens: string[], 
  startIndex: number,
  decodeBase64: boolean = false
): { name: string; qty: number; price: number; total: number }[] {
  const items: { name: string; qty: number; price: number; total: number }[] = [];
  let i = startIndex;
  while (i + 2 < tokens.length) {
    const rawName = tokens[i].trim();
    const name = decodeBase64 ? decodeBase64String(rawName) : rawName;
    const qtyStr = tokens[i + 1].trim();
    const priceStr = tokens[i + 2].trim();

    if (!name) { i += 3; continue; } // skip empty name (trailing colons)

    const qty = parseFloat(qtyStr);
    const price = parseFloat(priceStr);

    if (!isNaN(qty) && !isNaN(price)) {
      items.push({
        name,
        qty: Math.round(qty),
        price: Math.round(price),
        total: Math.round(qty * price)
      });
    }
    i += 3;
  }
  return items;
}

interface RawQRResult {
  utf8Text: string;
  big5Text: string;
  binaryData: number[];
}

/**
 * Scan a portion of an image for QR codes.
 * Returns the raw QR scan result or null.
 */
function scanQRFromCanvas(
  canvas: HTMLCanvasElement, 
  ctx: CanvasRenderingContext2D,
  srcImg: HTMLImageElement, 
  sx: number, 
  sy: number, 
  sw: number, 
  sh: number
): RawQRResult | null {
  canvas.width = sw;
  canvas.height = sh;
  ctx.clearRect(0, 0, sw, sh);
  ctx.drawImage(srcImg, sx, sy, sw, sh, 0, 0, sw, sh);
  const imageData = ctx.getImageData(0, 0, sw, sh);
  const code = jsQR(imageData.data, imageData.width, imageData.height);
  if (!code) return null;

  let big5Text = '';
  try {
    const binary = new Uint8Array(code.binaryData);
    big5Text = new TextDecoder('big5').decode(binary);
  } catch (e) {
    console.error('[QR] Failed to decode as Big5:', e);
  }

  return {
    utf8Text: code.data,
    big5Text: big5Text || code.data,
    binaryData: code.binaryData
  };
}

/**
 * Decode Taiwan electronic invoice QR code(s) from a base64 image.
 *
 * Taiwan paper e-invoice proof copy (紙本電子發票證明聯) has TWO QR codes:
 *   - Left QR: Invoice header + partial items (format: fixed header + AES + `:totalN:thisN:enc:name:qty:price:...`)
 *   - Right QR: Full item details (starts with `**{count}:{name}:{qty}:{price}:...`)
 *
 * BOTH QR codes can contain item details; we extract items from all found QR codes
 * and use the most complete set (highest item count).
 */
export function decodeReceiptQRCode(base64Image: string): Promise<ExtractedQRInvoice | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Image;
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }

        const W = img.width;
        const H = img.height;
        const halfW = Math.floor(W / 2);
        const halfH = Math.floor(H / 2);

        // Scan multiple regions to find both QR codes.
        // Taiwan receipts are usually photographed portrait; QR codes appear at the bottom.
        // We scan: full image, left/right halves, top/bottom halves, and all 4 quadrants.
        const regions: [number, number, number, number][] = [
          [0,     0,     W,          H         ], // full
          [0,     0,     halfW,      H         ], // left half
          [halfW, 0,     W - halfW,  H         ], // right half
          [0,     0,     W,          halfH     ], // top half
          [0,     halfH, W,          H - halfH ], // bottom half
          [0,     halfH, halfW,      H - halfH ], // bottom-left quadrant
          [halfW, halfH, W - halfW,  H - halfH ], // bottom-right quadrant
          [0,     0,     halfW,      halfH     ], // top-left quadrant
          [halfW, 0,     W - halfW,  halfH     ], // top-right quadrant
        ];

        // Collect all unique raw QR results from all regions
        const seen = new Set<string>();
        const allRaw: RawQRResult[] = [];
        for (const [sx, sy, sw, sh] of regions) {
          const raw = scanQRFromCanvas(canvas, ctx, img, sx, sy, sw, sh);
          if (raw && !seen.has(raw.utf8Text)) {
            seen.add(raw.utf8Text);
            allRaw.push(raw);
          }
        }

        console.log('[QR] all found raw utf8 texts:', allRaw.map(s => s.utf8Text.substring(0, 60)));

        // Classify: header (left) QR starts with 2 uppercase letters + 8 digits
        const isHeaderQR = (s: string) => /^[A-Z]{2}\d{8}/.test(s);
        const leftQRResult = allRaw.find(r => isHeaderQR(r.utf8Text));

        if (!leftQRResult) {
          resolve(null);
          return;
        }

        // Determine the encoding parameter from the Left QR
        let encoding: 'utf-8' | 'big5' | 'base64' = 'utf-8';
        const rest = leftQRResult.utf8Text.slice(53).split(':');
        const encodingFlag = rest[4]?.trim();
        if (encodingFlag === '0') {
          encoding = 'big5';
        } else if (encodingFlag === '2') {
          encoding = 'base64';
        }
        console.log('[QR] Detected E-Invoice Encoding:', encoding, 'Flag:', encodingFlag);

        // Select the correct decoded string representation based on the detected encoding
        const headerText = encoding === 'big5' ? leftQRResult.big5Text : leftQRResult.utf8Text;
        const headerData = parseTaiwanInvoiceLeftQR(headerText, encoding);

        if (!headerData) {
          resolve(null);
          return;
        }

        // Collect items from ALL scanned QR codes using the determined encoding
        let bestItems = headerData.items;

        const qrTexts = allRaw.map(r => (encoding === 'big5' ? r.big5Text : r.utf8Text));
        for (const text of qrTexts) {
          // Method 1: ** section (Right QR or Left QR custom area)
          const fromStar = parseStarStarSection(text, encoding === 'base64');
          if (fromStar.length > bestItems.length) {
            bestItems = fromStar;
          }
          // Method 2: Left QR colon section after AES
          const fromLeft = parseLeftQRItemSection(text, encoding === 'base64');
          if (fromLeft.length > bestItems.length) {
            bestItems = fromLeft;
          }
        }

        headerData.items = bestItems;
        console.log(`[QR] Final merged best items count (${bestItems.length}):`, bestItems);

        resolve(headerData);
      } catch (err) {
        console.error('QR code decoding error:', err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
  });
}

/**
 * Computes standard HMAC-SHA256 signature using browser native SubtleCrypto API.
 */
async function computeHMACSHA256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(key);
  const messageData = enc.encode(message);
  
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await window.crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    messageData
  );
  
  // Convert buffer to Base64 string
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  const binaryString = hashArray.map(b => String.fromCharCode(b)).join('');
  return btoa(binaryString);
}

/**
 * Call Taiwan E-Invoice API to query complete invoice items and amount.
 * Endpoint: /PB2CAPIVAN/invapp///InvApp
 */
export async function fetchTaiwanInvoiceDetails(
  invNum: string,
  invDate: string, // YYYY-MM-DD
  randomNumber: string,
  appId: string,
  apiKey: string,
  sellerId: string = '',
  encrypt: string = ''
): Promise<any> {
  const formattedDate = invDate.replace(/-/g, '/');
  
  // Parse ROC Year Term (e.g. 2026-06-30 -> ROC 115, month 06 -> Term: 11506)
  const dateParts = invDate.split('-');
  if (dateParts.length < 3) {
    throw new Error('無效的日期格式，預期為 YYYY-MM-DD');
  }
  const westYear = parseInt(dateParts[0]);
  const monthVal = parseInt(dateParts[1]);
  const rocYear = westYear - 1911;
  // 期別為雙月：1-2月=01、3-4月=03、5-6月=05、7-8月=07、9-10月=09、11-12月=11
  const termMonth = Math.ceil(monthVal / 2) * 2 - 1;
  const invTerm = `${rocYear}${String(termMonth).padStart(2, '0')}`;

  const timeStamp = Math.floor(Date.now() / 1000) + 10;
  const uuid = 'bookkeeping-' + Math.random().toString(36).substring(2, 10);
  
  const params: Record<string, string> = {
    action: 'qryInvDetail',
    appID: appId,
    encrypt: encrypt,
    generation: 'V2',
    invDate: formattedDate,
    invNum: invNum.replace(/-/g, '').toUpperCase(),
    invTerm: invTerm,
    randomNumber: randomNumber.padStart(4, '0'),
    sellerID: sellerId,
    timeStamp: String(timeStamp),
    UUID: uuid,
    version: '0.6'
  };

  // Sort keys alphabetically
  const sortedKeys = Object.keys(params).sort();
  const stringToSign = sortedKeys.map(k => `${k}=${params[k]}`).join('&');

  const signature = await computeHMACSHA256(apiKey, stringToSign);
  
  const allParams = {
    ...params,
    signature: signature
  };
  
  const body = new URLSearchParams(allParams).toString();
  const directUrl = 'https://api.einvoice.nat.gov.tw/PB2CAPIVAN/invapp///InvApp';
  const proxyUrl = `https://api.codetabs.com/proxy?quest=${encodeURIComponent(directUrl)}`;

  try {
    console.log('[E-Invoice API] Requesting direct:', directUrl);
    const response = await fetch(directUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body
    });
    if (!response.ok) {
      throw new Error(`Direct HTTP Error: ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    console.warn('[E-Invoice API] Direct failed, falling back to CORS proxy...', err);
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    });
    if (!response.ok) {
      throw new Error(`Proxy HTTP Error: ${response.status}`);
    }
    return await response.json();
  }
}

export async function fetchCarrierInvoiceHeaders(
  cardNo: string,
  cardEncrypt: string,
  startDate: string, // Format: YYYY/MM/DD
  endDate: string,   // Format: YYYY/MM/DD
  appId: string,
  apiKey: string
): Promise<any> {
  const timeStamp = Math.floor(Date.now() / 1000) + 15;
  const uuid = 'bookkeeping-' + Math.random().toString(36).substring(2, 10);
  const expTimeStamp = String(timeStamp + 180);

  const params: Record<string, string> = {
    action: 'carrierInvHeader',
    appID: appId,
    cardEncrypt: cardEncrypt,
    cardNo: cardNo,
    cardType: '3J0002',
    endDate: endDate,
    expTimeStamp: expTimeStamp,
    onlyWinningInv: 'N',
    startDate: startDate,
    timeStamp: String(timeStamp),
    uuid: uuid,
    version: '0.5'
  };

  const sortedKeys = Object.keys(params).sort();
  const stringToSign = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  const signature = await computeHMACSHA256(apiKey, stringToSign);

  const allParams = {
    ...params,
    signature: signature
  };

  const body = new URLSearchParams(allParams).toString();
  const directUrl = 'https://api.einvoice.nat.gov.tw/PB2CAPIVAN/invServ/InvServ';
  const proxyUrl = `https://api.codetabs.com/proxy?quest=${encodeURIComponent(directUrl)}`;

  try {
    console.log('[Carrier API] Requesting direct headers:', directUrl);
    const response = await fetch(directUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body
    });
    if (!response.ok) throw new Error(`Direct HTTP Error: ${response.status}`);
    return await response.json();
  } catch (err) {
    console.warn('[Carrier API] Direct headers failed, falling back to CORS proxy...', err);
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    });
    if (!response.ok) throw new Error(`Proxy HTTP Error: ${response.status}`);
    return await response.json();
  }
}

export async function fetchCarrierInvoiceDetails(
  cardNo: string,
  cardEncrypt: string,
  invNum: string,   // e.g. AB12345678
  invDate: string,  // Format: YYYY/MM/DD
  appId: string,
  apiKey: string
): Promise<any> {
  const timeStamp = Math.floor(Date.now() / 1000) + 15;
  const uuid = 'bookkeeping-' + Math.random().toString(36).substring(2, 10);
  const expTimeStamp = String(timeStamp + 180);

  const params: Record<string, string> = {
    action: 'carrierInvDetail',
    appID: appId,
    cardEncrypt: cardEncrypt,
    cardNo: cardNo,
    cardType: '3J0002',
    expTimeStamp: expTimeStamp,
    invDate: invDate,
    invNum: invNum.replace(/-/g, '').toUpperCase(),
    timeStamp: String(timeStamp),
    uuid: uuid,
    version: '0.5'
  };

  const sortedKeys = Object.keys(params).sort();
  const stringToSign = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  const signature = await computeHMACSHA256(apiKey, stringToSign);

  const allParams = {
    ...params,
    signature: signature
  };

  const body = new URLSearchParams(allParams).toString();
  const directUrl = 'https://api.einvoice.nat.gov.tw/PB2CAPIVAN/invServ/InvServ';
  const proxyUrl = `https://api.codetabs.com/proxy?quest=${encodeURIComponent(directUrl)}`;

  try {
    console.log('[Carrier API] Requesting direct details:', directUrl);
    const response = await fetch(directUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body
    });
    if (!response.ok) throw new Error(`Direct HTTP Error: ${response.status}`);
    return await response.json();
  } catch (err) {
    console.warn('[Carrier API] Direct details failed, falling back to CORS proxy...', err);
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    });
    if (!response.ok) throw new Error(`Proxy HTTP Error: ${response.status}`);
    return await response.json();
  }
}

export async function fetchWinningListFromRss(): Promise<any[]> {
  const directUrl = 'https://invoice.etax.nat.gov.tw/invoice.xml';
  const proxyUrl1 = `https://api.codetabs.com/proxy?quest=${encodeURIComponent(directUrl)}`;
  const proxyUrl2 = `https://corsproxy.io/?${encodeURIComponent(directUrl)}`;

  let xmlText = '';
  try {
    console.log('[E-Invoice RSS] Fetching direct:', directUrl);
    const response = await fetch(directUrl);
    if (!response.ok) throw new Error(`Direct HTTP Error: ${response.status}`);
    xmlText = await response.text();
  } catch (err) {
    console.warn('[E-Invoice RSS] Direct failed, trying CORS proxies...', err);
    
    // Try multiple CORS proxies
    const proxies = [proxyUrl1, proxyUrl2];
    for (const proxyUrl of proxies) {
      try {
        console.log('[E-Invoice RSS] Trying proxy:', proxyUrl);
        const response = await fetch(proxyUrl);
        if (response.ok) {
          xmlText = await response.text();
          if (xmlText.includes('invoice')) break;
        }
      } catch (e) {
        console.warn('[E-Invoice RSS] Proxy failed:', e);
      }
    }
    
    if (!xmlText) {
      throw new Error('所有 CORS 代理皆無法取得發票中獎號碼');
    }
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  const items = xmlDoc.getElementsByTagName('item');
  const periods: any[] = [];
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const title = item.getElementsByTagName('title')[0]?.textContent || '';
    const desc = item.getElementsByTagName('description')[0]?.textContent || '';
    const link = item.getElementsByTagName('link')[0]?.textContent || '';
    
    const spMatch = desc.match(/特別獎[：:][\s]*(\d+)/) || desc.match(/特別獎[^\d]*(\d+)/);
    const tMatch = desc.match(/特獎[：:][\s]*(\d+)/) || desc.match(/特獎[^\d]*(\d+)/);
    const hMatch = desc.match(/頭獎[：:][\s]*([\d、]+)/) || desc.match(/頭獎[^\d]*([\d、]+)/);
    
    periods.push({
      title,
      link,
      special: spMatch ? spMatch[1] : '',
      grand: tMatch ? tMatch[1] : '',
      first: hMatch ? hMatch[1].split('、') : []
    });
  }

  return periods;
}




