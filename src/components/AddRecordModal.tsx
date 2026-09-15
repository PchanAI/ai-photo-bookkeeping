import React, { useState, useEffect, useRef } from 'react';
import { db, generateUUID } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { scanReceiptWithGemini, type GeminiScanResult, getGeminiApiKeys, rotateBase64Image, decodeReceiptQRCode, fetchTaiwanInvoiceDetails, normalizeInvoiceNumber } from '../services/gemini';
import { scanReceiptLocally } from '../services/localOcr';
import { 
  X, Camera, Loader2, Calendar, FileText, 
  Wallet, Sparkles, CheckCircle2, RefreshCw, ChevronDown, ChevronUp, Plus, Minus
} from 'lucide-react';
import { LucideIcon } from '../App';

interface AddRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshData: () => void;
  editingTransactionId?: string; // If provided, we are in edit mode
}

// Helper to compute a SHA-256 hash of a base64 photo data url
async function computeStringHash(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper to resize and compress receipt images before uploading.
// Reduces upload network bandwidth by ~95% and significantly speeds up Gemini OCR processing.
function compressImage(dataUrl: string, maxWidth: number = 1024, quality: number = 0.8): Promise<{ dataUrl: string, mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxWidth) {
          width = Math.round((width * maxWidth) / height);
          height = maxWidth;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ dataUrl, mimeType: 'image/jpeg' });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({
        dataUrl: compressedDataUrl,
        mimeType: 'image/jpeg'
      });
    };
    img.onerror = (err) => reject(err);
  });
}

export const AddRecordModal: React.FC<AddRecordModalProps> = ({ 
  isOpen, onClose, onRefreshData, editingTransactionId 
}) => {
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  // Form states
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amountExpr, setAmountExpr] = useState('0'); // Stores mathematical equations like 100+50
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [note, setNote] = useState('');
  
  // Taiwan Electronic Invoice fields
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [randomCode, setRandomCode] = useState('');
  const [sellerTaxId, setSellerTaxId] = useState('');
  const [buyerTaxId, setBuyerTaxId] = useState('');
  const [carrier, setCarrier] = useState('');
  
  // Taiwan MOF E-Invoice API Query & Parse states
  const [apiQuerying, setApiQuerying] = useState(false);
  const [apiQueryStatus, setApiQueryStatus] = useState<string | null>(null);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [pasteParsing, setPasteParsing] = useState(false);
  const [showMofExtensionGuide, setShowMofExtensionGuide] = useState(false);

  // Advanced options accordion toggle
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false);

  // Photo states
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState<string | null>(null);
  const [photoHash, setPhotoHash] = useState<string>(''); // Hash of uploaded photo
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showScannerResult, setShowScannerResult] = useState(false);
  const [ocrEngine, setOcrEngine] = useState<'gemini' | 'local'>(
    () => (localStorage.getItem('ocrEngine') as 'gemini' | 'local') || 'gemini'
  );
  const [localOcrStatus, setLocalOcrStatus] = useState<string | null>(null); // downloading/scanning state
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Gemini Scan details
  const [scanResult, setScanResult] = useState<GeminiScanResult | null>(null);

  // Micro-interaction checkmark overlay state
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Keyboard pad popover state
  const [showNumpad, setShowNumpad] = useState(false);

  // Safe arithmetic evaluator
  const evaluateFormula = (expr: string): number => {
    // Sanitize string to only allow numbers and basic arithmetic operators
    const cleaned = expr.replace(/[^0-9.+-/*()]/g, '');
    if (!cleaned) return 0;
    try {
      // Evaluates formula expression safely
      const result = Function(`"use strict"; return (${cleaned})`)();
      return isNaN(result) || result === Infinity || result === -Infinity ? 0 : Number(result);
    } catch {
      return parseFloat(cleaned) || 0;
    }
  };

  // Load transaction if we are editing
  useEffect(() => {
    if (isOpen) {
      if (editingTransactionId) {
        db.transactions.get(editingTransactionId).then(tx => {
          if (tx) {
            setType(tx.type === 'transfer' ? 'expense' : tx.type);
            setAmountExpr(String(tx.amount));
            setSelectedCategory(tx.category);
            setSelectedAccount(tx.account);
            setDate(tx.date);
            setTime(tx.time || '00:00');
            setNote(tx.note);
            setInvoiceNumber(tx.invoiceNumber || '');
            setRandomCode(tx.randomCode || '');
            setSellerTaxId(tx.sellerTaxId || '');
            setBuyerTaxId(tx.buyerTaxId || '');
            setCarrier(tx.carrier || '');
            setIsAdvancedExpanded(true); // Auto expand in edit mode
            
            // Rehydrate photo if exists
            if (tx.photoId) {
              db.photos.get(tx.photoId).then(photo => {
                if (photo) {
                  setPhotoDataUrl(photo.dataUrl);
                  setPhotoMimeType(photo.dataUrl.split(';')[0].split(':')[1] || 'image/jpeg');
                  if (tx.photoHash) {
                    setPhotoHash(tx.photoHash);
                  } else {
                    computeStringHash(photo.dataUrl).then(h => setPhotoHash(h));
                  }
                }
              });
            } else {
              setPhotoDataUrl(null);
              setPhotoHash('');
            }

            // Rehydrate AI scan details
            if (tx.items) {
              setScanResult({
                merchant: tx.note.split(']')[0].replace('[', '') || '編輯項目',
                date: tx.date,
                time: tx.time || '00:00',
                originalCurrency: tx.originalCurrency || 'TWD',
                exchangeRateUsed: tx.exchangeRate || 1.0,
                exchangeRateExplanation: tx.rateExplanation || '',
                originalTotalAmount: tx.originalAmount || tx.amount,
                convertedTotalAmountTWD: tx.amount,
                category: tx.type === 'expense' ? 'Food' : 'Others', // simple mock map
                invoiceNumber: tx.invoiceNumber || '',
                randomCode: tx.randomCode || '',
                sellerTaxId: tx.sellerTaxId || '',
                buyerTaxId: tx.buyerTaxId || '',
                carrier: tx.carrier || '',
                items: tx.items.map(item => ({
                  originalName: item.name,
                  translatedName: item.name,
                  quantity: item.qty,
                  originalUnitPrice: item.originalPrice || item.price,
                  convertedUnitPriceTWD: item.price,
                  originalTotalPrice: item.originalTotal || item.total,
                  convertedTotalPriceTWD: item.total
                }))
              });
              setShowScannerResult(true);
            }
          }
        });
      } else {
        // Reset states for fresh addition
        setAmountExpr('0');
        setDate(new Date().toISOString().split('T')[0]);
        setTime(() => {
          const now = new Date();
          return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        });
        setNote('');
        setInvoiceNumber('');
        setRandomCode('');
        setSellerTaxId('');
        setBuyerTaxId('');
        setCarrier('');
        setPhotoDataUrl(null);
        setPhotoMimeType(null);
        setPhotoHash('');
        setScanResult(null);
        setShowScannerResult(false);
        setScanError(null);
        setIsAdvancedExpanded(false);
        
        // Smart prediction based on hours
        const hour = new Date().getHours();
        const defaultCat = categories.find(c => c.type === 'expense');
        
        if (hour >= 22 || hour < 4) {
          // Late night: Food ->宵夜
          const foodCat = categories.find(c => c.id === 'cat_food');
          if (foodCat) setSelectedCategory(foodCat.id);
          setNote('宵夜');
        } else if (hour >= 7 && hour < 10) {
          // Morning: Food -> 早餐
          const foodCat = categories.find(c => c.id === 'cat_food');
          if (foodCat) setSelectedCategory(foodCat.id);
          setNote('早餐');
        } else if (hour >= 11 && hour < 14) {
          // Noon: Food -> 午餐
          const foodCat = categories.find(c => c.id === 'cat_food');
          if (foodCat) setSelectedCategory(foodCat.id);
          setNote('午餐');
        } else {
          if (defaultCat) setSelectedCategory(defaultCat.id);
        }

        // Set default Account
        if (accounts.length > 0) {
          const cashAcc = accounts.find(a => a.type === 'cash') || accounts[0];
          if (cashAcc) setSelectedAccount(cashAcc.id);
        }

        // Focus input
        setTimeout(() => {
          amountInputRef.current?.focus();
          amountInputRef.current?.select();
        }, 100);
      }
    }
  }, [isOpen, editingTransactionId, categories, accounts]);

  if (!isOpen) return null;

  const handleCopyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 2000);
    }).catch(err => {
      console.error('Failed to copy: ', err);
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  const updateScanResultWithItems = (newItems: any[], totalAmount: number, merchantName: string) => {
    const mappedItems = newItems.map(item => ({
      originalName: item.name,
      translatedName: item.name,
      quantity: item.qty,
      originalUnitPrice: item.price,
      convertedUnitPriceTWD: item.price,
      originalTotalPrice: item.total,
      convertedTotalPriceTWD: item.total
    }));

    setScanResult(prev => {
      const base = prev || {
        merchant: merchantName || '電子發票',
        date: date,
        time: time || '00:00',
        originalCurrency: 'TWD',
        exchangeRateUsed: 1.0,
        exchangeRateExplanation: '',
        originalTotalAmount: totalAmount,
        convertedTotalAmountTWD: totalAmount,
        category: 'Others',
        invoiceNumber: invoiceNumber,
        randomCode: randomCode,
        sellerTaxId: sellerTaxId,
        buyerTaxId: buyerTaxId,
        carrier: carrier,
        items: []
      };

      return {
        ...base,
        merchant: merchantName || base.merchant || '電子發票',
        originalTotalAmount: totalAmount,
        convertedTotalAmountTWD: totalAmount,
        items: mappedItems
      };
    });

    setShowScannerResult(true);
  };

  const handleFetchFromMofApi = async () => {
    const appId = localStorage.getItem('mof_app_id') || '';
    const apiKey = localStorage.getItem('mof_api_key') || '';
    
    if (!appId || !apiKey) {
      alert('⚠️ 請先至「系統設定」輸入您的財政部 App ID 與 API Key，以啟用自動查詢功能。');
      return;
    }

    if (!invoiceNumber) {
      alert('請先輸入或掃描發票字軌號碼！');
      return;
    }
    
    if (!date) {
      alert('請確認發票開立日期！');
      return;
    }

    if (!randomCode) {
      alert('請輸入紙本發票上的 4 位隨機碼！');
      return;
    }

    setApiQuerying(true);
    setApiQueryStatus('正在連線財政部 API 查詢明細...');
    
    try {
      const res = await fetchTaiwanInvoiceDetails(
        invoiceNumber,
        date,
        randomCode,
        appId,
        apiKey,
        sellerTaxId,
        ''
      );
      
      console.log('[E-Invoice API Result]:', res);
      
      if (res && res.code === '200') {
        setApiQueryStatus('🎉 查詢成功！已載入發票明細。');
        
        let finalAmount = 0;
        if (res.amount) {
          finalAmount = Math.round(parseFloat(res.amount)) || 0;
          setAmountExpr(String(finalAmount));
        }
        
        let parsedItems: any[] = [];
        if (res.details && Array.isArray(res.details)) {
          parsedItems = res.details.map((d: any) => ({
            name: d.description || '商品',
            qty: Math.round(parseFloat(d.quantity) || 1),
            price: Math.round(parseFloat(d.unitPrice) || 0),
            total: Math.round(parseFloat(d.amount) || 0)
          }));
        }

        const merchantName = res.sellerName || '電子發票';
        if (res.sellerName) {
          setNote(`[${res.sellerName}] ` + note.replace(/^\[[^\]]+\]\s*/, ''));
        }

        updateScanResultWithItems(parsedItems, finalAmount, merchantName);
        setTimeout(() => setApiQueryStatus(null), 3000);
      } else {
        const errMsg = res ? (res.msg || `錯誤碼: ${res.code}`) : '未知錯誤';
        alert(`❌ 查詢失敗: ${errMsg}`);
        setApiQueryStatus(null);
      }
    } catch (err: any) {
      console.error(err);
      alert(`❌ 查詢失敗: ${err.message || err}`);
      setApiQueryStatus(null);
    } finally {
      setApiQuerying(false);
    }
  };

  const handleParsePastedText = async () => {
    if (!pasteContent.trim()) {
      alert('請先貼上內容！');
      return;
    }

    setPasteParsing(true);
    
    try {
      // Check if Gemini API key is configured (load-balanced across all keys)
      const geminiKeys = getGeminiApiKeys();
      if (geminiKeys.length > 0) {
        const prompt = `你是一個電子發票明細解析器。請解析以下從財政部全民稽核專區複製的網頁明細文字，提取出所有的購買品項。
請嚴格以 JSON 陣列格式回傳，格式為: [{"name": "商品名稱", "qty": 數量, "price": 單價, "total": 總額}]。
不要包含 markdown 標籤（如 \`\`\`json 標記）或任何說明文字，只回傳純 JSON 陣列。

網頁明細文字內容：
${pasteContent}`;

        const body = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        });

        // Load-balance: pick a random starting key, rotate on failure
        const startIndex = Math.floor(Math.random() * geminiKeys.length);
        let parsedItems: any[] = [];
        let lastKeyErr: unknown = null;

        for (let i = 0; i < geminiKeys.length; i++) {
          const key = geminiKeys[(startIndex + i) % geminiKeys.length];
          try {
            const response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
            );
            if (!response.ok) {
              throw new Error(`Gemini API 回傳錯誤: ${response.status}`);
            }
            const data = await response.json();
            const resText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            parsedItems = JSON.parse(resText.trim());
            break;
          } catch (keyErr) {
            console.warn(`Gemini 金鑰 ${i + 1} 失敗，換下一組...`, keyErr);
            lastKeyErr = keyErr;
            if (geminiKeys.length === 1) break;
          }
        }

        if (geminiKeys.length > 1 && parsedItems.length === 0 && lastKeyErr) {
          throw lastKeyErr instanceof Error ? lastKeyErr : new Error('所有 Gemini 金鑰皆失敗');
        }
        if (Array.isArray(parsedItems) && parsedItems.length > 0) {
          const newItems = parsedItems.map(item => ({
            name: item.name || '商品',
            qty: Number(item.qty) || 1,
            price: Number(item.price) || 0,
            total: Number(item.total) || (Number(item.qty) * Number(item.price))
          }));
          
          const sum = newItems.reduce((acc, curr) => acc + (Number(curr.total) || 0), 0);
          setAmountExpr(String(sum));
          
          const merchantName = '全民稽核匯入';
          setNote(`[${merchantName}] ` + note.replace(/^\[[^\]]+\]\s*/, ''));
          
          updateScanResultWithItems(newItems, sum, merchantName);

          alert('✨ 解析成功！已成功載入發票明細。');
          setShowPasteArea(false);
          setPasteContent('');
        } else {
          throw new Error('解析結果為空或格式不符');
        }
      } else {
        // Fallback to local rule-based parsing
        const parsed = parseInvoiceTextLocally(pasteContent);
        if (parsed.length > 0) {
          const sum = parsed.reduce((acc, curr) => acc + curr.total, 0);
          setAmountExpr(String(sum));
          
          const merchantName = '全民稽核匯入';
          setNote(`[${merchantName}] ` + note.replace(/^\[[^\]]+\]\s*/, ''));
          
          updateScanResultWithItems(parsed, sum, merchantName);

          alert(`✨ 本地解析成功！已載入 ${parsed.length} 筆商品。`);
          setShowPasteArea(false);
          setPasteContent('');
        } else {
          alert('⚠️ 無法解析貼上內容，請確認格式或配置 Gemini API Key 以使用智慧解析！');
        }
      }
    } catch (err: any) {
      console.error(err);
      alert(`❌ 解析失敗: ${err.message || err}`);
    } finally {
      setPasteParsing(false);
    }
  };

  // Helper rule-based local parser
  function parseInvoiceTextLocally(text: string): { name: string; qty: number; price: number; total: number }[] {
    const lines = text.split('\n');
    const items: { name: string; qty: number; price: number; total: number }[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const tokens = trimmed.split(/[\t\s]+/).map(t => t.trim()).filter(Boolean);
      if (tokens.length >= 3) {
        const numbers = tokens.filter(t => /^-?\d+(\.\d+)?$/.test(t)).map(Number);
        if (numbers.length >= 2) {
          let qty = 1;
          let price = 0;
          let total = 0;
          
          if (numbers.length >= 3) {
            qty = numbers[numbers.length - 3];
            price = numbers[numbers.length - 2];
            total = numbers[numbers.length - 1];
          } else {
            qty = numbers[0];
            price = numbers[1];
            total = qty * price;
          }
          
          const nonNumbers = tokens.filter(t => !/^-?\d+(\.\d+)?$/.test(t));
          const name = nonNumbers.join(' ').trim();
          if (name && !isNaN(qty) && !isNaN(price)) {
            items.push({
              name,
              qty: Math.round(Math.abs(qty)),
              price: Math.round(Math.abs(price)),
              total: Math.round(Math.abs(total))
            });
          }
        }
      }
    }
    return items;
  }

  const handleTypeChange = (newType: 'expense' | 'income') => {
    setType(newType);
    const cat = categories.find(c => c.type === newType);
    if (cat) setSelectedCategory(cat.id);
  };

  // Convert uploaded image
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      
      try {
        // Compress and resize image to maximum 1024px width/height and 0.8 quality
        const compressed = await compressImage(dataUrl, 1024, 0.8);
        setPhotoDataUrl(compressed.dataUrl);
        setPhotoMimeType(compressed.mimeType);
        
        // Calculate SHA-256 hash of the compressed image base64
        const hash = await computeStringHash(compressed.dataUrl);
        setPhotoHash(hash);
        
        // Scan database for duplicate photo hashes
        const existingTx = await db.transactions.where('photoHash').equals(hash).first();
        if (existingTx) {
          setScanError(`提示：系統偵測到此單據照片已被使用過！已於 ${existingTx.date} 記過帳，項目為「${existingTx.note}」，金額為 $${existingTx.amount}。請確認是否重複。`);
        } else {
          setScanError(null);
        }
      } catch (err) {
        console.error('Image processing or hash calculation error:', err);
        // Fallback to original if compression fails
        setPhotoDataUrl(dataUrl);
        setPhotoMimeType(file.type);
        setScanError(null);
      }
      
      setShowScannerResult(false);
      setIsAdvancedExpanded(true); // Auto expand accordion when uploading photo
    };
    reader.readAsDataURL(file);
  };

  const handleScanReceipt = async () => {
    if (!photoDataUrl || !photoMimeType) return;
    
    setIsScanning(true);
    setScanError(null);
    setLocalOcrStatus(null);

    try {
      let result;
      
      // Attempt local electronic invoice QR code decoding first
      const qrData = await decodeReceiptQRCode(photoDataUrl);
      if (qrData) {
        console.log("Successfully decoded Taiwan electronic invoice QR code locally!", qrData);
        result = {
          merchant: '電子發票',
          date: qrData.date,
          time: qrData.time || '00:00',
          originalCurrency: 'TWD',
          exchangeRateUsed: 1.0,
          exchangeRateExplanation: '電子發票 QRCode 本地解碼',
          originalTotalAmount: qrData.amount,
          convertedTotalAmountTWD: qrData.amount,
          category: 'Shopping',
          paymentMethod: '未指定',
          invoiceNumber: qrData.invoiceNumber,
          randomCode: qrData.randomCode,
          sellerTaxId: qrData.sellerTaxId,
          buyerTaxId: qrData.buyerTaxId || '',
          carrier: '',
          items: qrData.items.map(item => ({
            originalName: item.name,
            translatedName: item.name,
            quantity: item.qty,
            originalUnitPrice: item.price,
            convertedUnitPriceTWD: item.price,
            originalTotalPrice: item.total,
            convertedTotalPriceTWD: item.total
          }))
        };
        setLocalOcrStatus('✨ 成功解析電子發票 QRCode，已自動載入明細！');
      } else {
        if (ocrEngine === 'gemini') {
          if (getGeminiApiKeys().length === 0) {
            setScanError('請至系統設定輸入您的 Gemini API Key！');
            setIsScanning(false);
            return;
          }
          result = await scanReceiptWithGemini(photoDataUrl, photoMimeType);
        } else {
          // Run local PaddleOCR in the browser using WASM
          result = await scanReceiptLocally(photoDataUrl, (statusText) => {
            setLocalOcrStatus(statusText);
          });
        }
      }

      // Rotate the receipt photo if Gemini detects it's rotated
      if (result.rotationNeeded && result.rotationNeeded !== 0) {
        try {
          console.log(`單據影像偵測到需要旋轉 ${result.rotationNeeded} 度，正在自動轉正...`);
          const rotatedUrl = await rotateBase64Image(photoDataUrl, result.rotationNeeded);
          setPhotoDataUrl(rotatedUrl);
          console.log('單據影像自動轉正成功！');
        } catch (rotErr) {
          console.error('自動旋轉影像失敗:', rotErr);
        }
      }

      setScanResult(result);
      
      setAmountExpr(String(result.convertedTotalAmountTWD));
      setDate(result.date);
      setTime(result.time || '00:00');
      setNote(`[${result.merchant}] ` + (result.exchangeRateExplanation || ''));
      
      // Populate Taiwan e-invoice fields
      setInvoiceNumber(result.invoiceNumber || '');
      setRandomCode(result.randomCode || '');
      setSellerTaxId(result.sellerTaxId || '');
      setBuyerTaxId(result.buyerTaxId || '');
      setCarrier(result.carrier || '');
      
      const catMap: { [key: string]: string } = {
        'Food': 'cat_food',
        'Shopping': 'cat_shopping',
        'Transportation': 'cat_transport',
        'Entertainment': 'cat_entertainment',
        'Housing': 'cat_housing',
        'Medical': 'cat_medical',
        'Education': 'cat_education',
        'Others': 'cat_others_exp'
      };
      
      const targetCatId = catMap[result.category];
      const matchedCat = categories.find(c => c.id === targetCatId);
      if (matchedCat) {
        setSelectedCategory(matchedCat.id);
      }

      // Try to match account based on identified payment method
      if (result.paymentMethod) {
        const pMethod = result.paymentMethod.toLowerCase();
        let targetAccountType: 'cash' | 'credit_card' | 'bank_account' | null = null;
        
        if (pMethod.includes('現金') || pMethod.includes('cash') || pMethod.includes('coin')) {
          targetAccountType = 'cash';
        } else if (
          pMethod.includes('信用卡') || 
          pMethod.includes('簽帳卡') || 
          pMethod.includes('卡') || 
          pMethod.includes('card') || 
          pMethod.includes('visa') || 
          pMethod.includes('master') || 
          pMethod.includes('jcb') || 
          pMethod.includes('pay') || 
          pMethod.includes('支付') || 
          pMethod.includes('街口')
        ) {
          targetAccountType = 'credit_card';
        } else if (pMethod.includes('轉帳') || pMethod.includes('匯款') || pMethod.includes('銀行') || pMethod.includes('bank') || pMethod.includes('atm')) {
          targetAccountType = 'bank_account';
        }
        
        if (targetAccountType) {
          const matchedAcc = accounts.find(a => a.type === targetAccountType);
          if (matchedAcc) {
            setSelectedAccount(matchedAcc.id);
          }
        }
      }

      setShowScannerResult(true);
    } catch (err) {
      setScanError((err as Error).message || '辨識收據失敗。');
    } finally {
      setIsScanning(false);
      setLocalOcrStatus(null);
    }
  };

  // Custom Keypad Click Handlers
  const handleNumpadClick = (value: string) => {
    if (value === 'C') {
      setAmountExpr('0');
    } else if (value === 'DEL') {
      setAmountExpr(prev => {
        if (prev.length <= 1) return '0';
        return prev.substring(0, prev.length - 1);
      });
    } else if (value === '.') {
      setAmountExpr(prev => prev + '.');
    } else if (value === '+' || value === '-') {
      setAmountExpr(prev => {
        const lastChar = prev.slice(-1);
        if (['+', '-'].includes(lastChar)) {
          return prev.slice(0, -1) + value; // swap operator
        }
        return prev + value;
      });
    } else {
      setAmountExpr(prev => {
        if (prev === '0') return value;
        return prev + value;
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const evaluatedAmount = evaluateFormula(amountExpr);
    if (!evaluatedAmount || evaluatedAmount <= 0) {
      alert('請輸入有效的金額！');
      return;
    }
    if (!selectedCategory || !selectedAccount) {
      alert('請選擇分類與帳戶！');
      return;
    }

    const accountObj = accounts.find(a => a.id === selectedAccount);
    if (!accountObj) return;

    // Check for duplicate transaction (image hash or metadata match)
    try {
      let isDuplicate = false;
      let duplicateMsg = '';

      if (!editingTransactionId) {
        if (photoHash) {
          const existingByPhoto = await db.transactions.where('photoHash').equals(photoHash).first();
          if (existingByPhoto) {
            isDuplicate = true;
            duplicateMsg = `此單據照片已被使用於記帳紀錄：\n日期：${existingByPhoto.date}\n商家/備註：${existingByPhoto.note}\n金額：$${existingByPhoto.amount}\n\n您確定要重複儲存嗎？`;
          }
        }

        if (!isDuplicate) {
          const existingByMeta = await db.transactions
            .where('date')
            .equals(date)
            .filter(tx => {
              const invNumNorm = normalizeInvoiceNumber(invoiceNumber);
              // 0. Duplicate invoice number check
              if (invNumNorm && tx.invoiceNumber && normalizeInvoiceNumber(tx.invoiceNumber) === invNumNorm) {
                return true;
              }

              // 1. Basic matching: Type and Amount must match
              if (tx.amount !== evaluatedAmount || tx.type !== type) {
                return false;
              }

              // 2. Time matching (if time is specified and not default 00:00)
              if (time && time !== '00:00' && tx.time && tx.time !== '00:00') {
                if (tx.time === time) return true;
              }

              // 3. Identical notes
              if (note.trim() && tx.note.trim() && tx.note.trim() === note.trim()) {
                return true;
              }

              // 4. Merchant matching (extract [MerchantName] prefix from note)
              const getMerchant = (n: string) => {
                const match = n.match(/^\[([^\]]+)\]/);
                return match ? match[1].trim() : '';
              };
              const currentMerchant = getMerchant(note);
              const txMerchant = getMerchant(tx.note);
              if (currentMerchant && txMerchant && currentMerchant === txMerchant) {
                return true;
              }

              // 5. Item list matching (if details exist)
              if (scanResult && scanResult.items && tx.items && tx.items.length === scanResult.items.length) {
                const itemsMatch = tx.items.every((item, idx) => {
                  const scanItem = scanResult.items[idx];
                  const scanItemName = scanItem.translatedName || scanItem.originalName;
                  return item.name === scanItemName && item.qty === scanItem.quantity && item.total === scanItem.convertedTotalPriceTWD;
                });
                if (itemsMatch) return true;
              }

              return false;
            })
            .toArray();
          
          if (existingByMeta.length > 0) {
            isDuplicate = true;
            duplicateMsg = `系統偵測到高度疑似重複的記帳紀錄（相同日期、類型、金額與時間/商家/備註）：\n日期：${existingByMeta[0].date} ${existingByMeta[0].time || '00:00'}\n商家/備註：${existingByMeta[0].note}\n金額：$${existingByMeta[0].amount}\n\n您確定要重複儲存此筆交易嗎？`;
          }
        }

        if (isDuplicate) {
          const confirmSave = window.confirm(duplicateMsg);
          if (!confirmSave) {
            return; // Abort saving
          }
        }
      }
    } catch (dupErr) {
      console.warn('Duplicate check failed:', dupErr);
    }

    try {
      if (editingTransactionId) {
        // Mode: Edit existing transaction
        const oldTx = await db.transactions.get(editingTransactionId);
        if (!oldTx) return;

        await db.transaction('rw', [db.transactions, db.accounts, db.photos], async () => {
          // 1. Revert old account balance
          const oldAcc = await db.accounts.get(oldTx.account);
          if (oldAcc) {
            const oldRevert = oldTx.type === 'expense' ? oldTx.amount : -oldTx.amount;
            await db.accounts.update(oldTx.account, { balance: oldAcc.balance + oldRevert });
          }

          // 2. Adjust new account balance
          const currentAcc = await db.accounts.get(selectedAccount);
          if (currentAcc) {
            const newDiff = type === 'expense' ? -evaluatedAmount : evaluatedAmount;
            await db.accounts.update(selectedAccount, { balance: currentAcc.balance + newDiff });
          }

          // 3. Update photo
          let photoId = oldTx.photoId;
          if (photoDataUrl) {
            if (photoId) {
              await db.photos.update(photoId, { dataUrl: photoDataUrl });
            } else {
              photoId = `photo_${generateUUID()}`;
              await db.photos.add({ id: photoId, dataUrl: photoDataUrl });
            }
          } else if (photoId) {
            await db.photos.delete(photoId);
            photoId = undefined;
          }

          // 4. Update transaction
          const transactionItems = scanResult?.items.map(item => ({
            name: item.translatedName || item.originalName,
            qty: item.quantity,
            price: item.convertedUnitPriceTWD,
            total: item.convertedTotalPriceTWD,
            originalPrice: item.originalUnitPrice,
            originalTotal: item.originalTotalPrice
          })) || [];

          await db.transactions.update(editingTransactionId, {
            date,
            time,
            type,
            amount: evaluatedAmount,
            originalAmount: scanResult?.originalTotalAmount,
            originalCurrency: scanResult?.originalCurrency,
            exchangeRate: scanResult?.exchangeRateUsed,
            rateExplanation: scanResult?.exchangeRateExplanation,
            category: selectedCategory,
            account: selectedAccount,
            note: note.trim(),
            photoId,
            photoHash: photoHash || undefined, // Save photo hash
            invoiceNumber: normalizeInvoiceNumber(invoiceNumber) || undefined,
            randomCode: randomCode.trim() || undefined,
            sellerTaxId: sellerTaxId.trim() || undefined,
            buyerTaxId: buyerTaxId.trim() || undefined,
            carrier: carrier.trim() || undefined,
            items: transactionItems.length > 0 ? transactionItems : undefined
          });
        });
      } else {
        // Mode: Add new transaction
        await db.transaction('rw', [db.transactions, db.photos, db.accounts], async () => {
          let photoId = undefined;
          if (photoDataUrl) {
            photoId = `photo_${generateUUID()}`;
            await db.photos.add({ id: photoId, dataUrl: photoDataUrl });
          }

          const balanceDiff = type === 'expense' ? -evaluatedAmount : evaluatedAmount;
          await db.accounts.update(selectedAccount, { balance: accountObj.balance + balanceDiff });

          const transactionItems = scanResult?.items.map(item => ({
            name: item.translatedName || item.originalName,
            qty: item.quantity,
            price: item.convertedUnitPriceTWD,
            total: item.convertedTotalPriceTWD,
            originalPrice: item.originalUnitPrice,
            originalTotal: item.originalTotalPrice
          })) || [];

          await db.transactions.add({
            id: generateUUID(),
            date,
            time,
            type,
            amount: evaluatedAmount,
            originalAmount: scanResult?.originalTotalAmount,
            originalCurrency: scanResult?.originalCurrency,
            exchangeRate: scanResult?.exchangeRateUsed,
            rateExplanation: scanResult?.exchangeRateExplanation,
            category: selectedCategory,
            account: selectedAccount,
            note: note.trim(),
            photoId,
            photoHash: photoHash || undefined, // Save photo hash
            invoiceNumber: normalizeInvoiceNumber(invoiceNumber) || undefined,
            randomCode: randomCode.trim() || undefined,
            sellerTaxId: sellerTaxId.trim() || undefined,
            buyerTaxId: buyerTaxId.trim() || undefined,
            carrier: carrier.trim() || undefined,
            items: transactionItems.length > 0 ? transactionItems : undefined,
            createdAt: Date.now()
          });
        });
      }

      // Micro-animation display
      setShowSuccessOverlay(true);
      setTimeout(() => {
        setShowSuccessOverlay(false);
        onRefreshData();
        onClose();
      }, 700);

    } catch (err) {
      alert('儲存失敗: ' + err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-3 md:p-4 overflow-y-auto">
      <div className="glass-panel w-full max-w-4xl flex flex-col md:flex-row overflow-hidden max-h-[92vh] animate-scale-in relative">
        
        {/* Particle/Checkmark Success Micro-Interaction Overlay */}
        {showSuccessOverlay && (
          <div className="absolute inset-0 bg-slate-900/90 z-50 flex flex-col items-center justify-center animate-fade-in">
            <div className="w-20 h-20 rounded-full bg-emerald-500/10 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/20 scale-up">
              <CheckCircle2 size={48} className="animate-pulse" />
            </div>
            <p className="font-extrabold text-xl text-emerald-300 mt-4 tracking-wider">記帳完成！</p>
          </div>
        )}

        {/* Left Box: Photo Upload and Scanner details */}
        <div className="flex-1 p-5 border-b md:border-b-0 md:border-r border-white/5 flex flex-col bg-indigo-950/20 max-h-[92vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-extrabold flex items-center gap-1.5 text-gray-300">
              <Camera size={18} className="text-indigo-400" /> 單據影像辨識
            </h3>
            {photoDataUrl && (
              <button
                type="button"
                onClick={() => {
                  setPhotoDataUrl(null);
                  setPhotoMimeType(null);
                  setPhotoHash('');
                  setScanResult(null);
                  setShowScannerResult(false);
                  setScanError(null);
                }}
                className="text-gray-500 hover:text-white text-xs flex items-center gap-0.5"
              >
                <RefreshCw size={11} /> 重新上傳
              </button>
            )}
          </div>

          {!photoDataUrl ? (
            <div className="flex-1 min-h-[160px] md:min-h-[250px] flex flex-col justify-center items-center gap-4 border-2 border-dashed border-white/10 rounded-2xl p-5 text-center bg-white/2">
              <div className="text-gray-400">
                <p className="text-sm font-bold text-gray-300 mb-1">請上傳或拍攝單據影像</p>
                <p className="text-[10px] text-gray-500">系統將由 AI 自動識別品項、數量、單價與總額</p>
              </div>

              <div className="flex gap-3 w-full max-w-[320px]">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1 py-3 border border-white/10 rounded-xl flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-indigo-500/40 hover:bg-white/5 transition-all text-center"
                >
                  <div className="w-9 h-9 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <Camera size={18} />
                  </div>
                  <span className="text-xs font-bold text-gray-300">📷 拍攝單據</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-3 border border-white/10 rounded-xl flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-indigo-500/40 hover:bg-white/5 transition-all text-center"
                >
                  <div className="w-9 h-9 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <FileText size={18} />
                  </div>
                  <span className="text-xs font-bold text-gray-300">📁 選擇圖片</span>
                </button>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handlePhotoUpload}
                accept="image/*"
                className="hidden"
              />
              <input
                type="file"
                ref={cameraInputRef}
                onChange={handlePhotoUpload}
                accept="image/*"
                capture="environment"
                className="hidden"
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-4">
              <div className="relative rounded-2xl overflow-hidden border border-white/10 max-h-[200px] flex items-center justify-center bg-black/40">
                <img src={photoDataUrl} alt="Receipt Scan" className="max-h-[200px] object-contain w-full" />
                {isScanning && (
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="animate-spin text-indigo-400" size={32} />
                    <div className="text-xs font-bold text-white flex flex-col items-center gap-1 px-4 text-center">
                      <div className="flex items-center gap-1">
                        <Sparkles size={14} className="text-yellow-400 animate-pulse" /> 
                        {ocrEngine === 'gemini' ? 'AI 正在快速識別單據...' : '本地 OCR 正在辨識中...'}
                      </div>
                      {localOcrStatus && (
                        <div className="text-[10px] text-gray-400 font-normal mt-1 animate-pulse max-w-[200px]">
                          {localOcrStatus}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {!isScanning && !showScannerResult && (
                <div className="space-y-3">
                  {/* OCR Engine selector tab */}
                  <div className="flex bg-white/5 rounded-xl p-1 border border-white/5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                       setOcrEngine('gemini');
                       localStorage.setItem('ocrEngine', 'gemini');
                     }}
                      className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                        ocrEngine === 'gemini'
                          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      ✨ Gemini AI 雲端辨識
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                       setOcrEngine('local');
                       localStorage.setItem('ocrEngine', 'local');
                     }}
                      className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                        ocrEngine === 'local'
                          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      💻 PaddleOCR 本地離線
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleScanReceipt}
                    className="glass-button w-full py-2.5 flex items-center justify-center gap-1.5 font-bold bg-gradient-to-r from-indigo-500 to-violet-600"
                  >
                    <Sparkles size={16} className="text-yellow-400" /> 
                    {ocrEngine === 'gemini' ? '啟動 Gemini AI 智慧辨識' : '啟動本地離線單據辨識'}
                  </button>
                </div>
              )}

              {scanError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-300">
                  {scanError}
                </div>
              )}

              {/* Show AI Scan results */}
              {showScannerResult && scanResult && (
                <div className="space-y-3 animate-slide-up text-xs">
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-1.5">
                    <p className="font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={14} /> {scanResult.exchangeRateExplanation?.includes('本地') ? '本地離線辨識成功！' : 'AI 智慧識別成功！'}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 text-gray-300">
                      <div><span className="text-gray-500">商家:</span> {scanResult.merchant}</div>
                      <div><span className="text-gray-500">日期:</span> {scanResult.date}</div>
                      <div><span className="text-gray-500">原始幣別:</span> {scanResult.originalCurrency} (${scanResult.originalTotalAmount})</div>
                      <div><span className="text-gray-500">匯率:</span> {scanResult.exchangeRateUsed}</div>
                      <div className="col-span-2"><span className="text-gray-500">付款方式:</span> <span className="font-bold text-emerald-400">{scanResult.paymentMethod || '未指定'}</span></div>
                    </div>
                    {scanResult.originalCurrency !== 'TWD' && (
                      <p className="text-[10px] text-gray-400 border-t border-white/5 pt-1.5 mt-1.5">
                        {scanResult.exchangeRateExplanation}
                      </p>
                    )}
                  </div>

                  {/* Extract Items list table */}
                  {scanResult.items && scanResult.items.length > 0 && (
                    <div className="rounded-xl border border-white/5 overflow-hidden max-h-[160px] overflow-y-auto">
                      <table className="w-full text-[11px] text-left">
                        <thead className="bg-white/5 text-gray-400 font-semibold">
                          <tr>
                            <th className="p-2">商品名稱</th>
                            <th className="p-2 text-center">數量</th>
                            <th className="p-2 text-right">單價(TWD)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-gray-300 bg-white/2">
                          {scanResult.items.map((item, idx) => (
                            <tr key={idx} className="hover:bg-white/5">
                              <td className="p-2 font-medium">
                                <span>{item.translatedName || item.originalName}</span>
                              </td>
                              <td className="p-2 text-center">{item.quantity}</td>
                              <td className="p-2 text-right">${item.convertedUnitPriceTWD}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Box: Streamlined entry form */}
        <form onSubmit={handleSave} className="flex-1 p-5 flex flex-col justify-between max-h-[92vh] overflow-y-auto">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{editingTransactionId ? '編輯明細項目' : '快速記帳'}</h2>
              <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {/* Income / Expense Tab (Color psychology logic integrated) */}
            <div className="flex bg-white/5 rounded-xl p-1 border border-white/5 mb-4">
              <button
                type="button"
                onClick={() => handleTypeChange('expense')}
                className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all ${
                  type === 'expense'
                    ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                支出 (紅/橙 提醒警示)
              </button>
              <button
                type="button"
                onClick={() => handleTypeChange('income')}
                className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all ${
                  type === 'income'
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                收入 (翠綠 成長穩定)
              </button>
            </div>

            {/* Core Fields */}
            <div className="space-y-4">
              {/* Amount input magnified with formula support */}
              <div className="flex flex-col gap-1">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-3xl font-extrabold text-gray-400">$</span>
                  <input
                    type="text"
                    ref={amountInputRef}
                    value={amountExpr}
                    onChange={(e) => setAmountExpr(e.target.value)}
                    onClick={() => setShowNumpad(true)}
                    className="glass-input w-full pl-10 text-4xl font-black text-right tracking-tight cursor-pointer border-indigo-500/30"
                    placeholder="0"
                    required
                  />
                  {amountExpr !== '0' && amountExpr.match(/[+-]/) && (
                    <div className="absolute right-4 bottom-1.5 text-[10px] text-gray-400 font-bold">
                      計算結果: ${evaluateFormula(amountExpr)}
                    </div>
                  )}
                </div>
              </div>

              {/* Numpad Calculator overlay */}
              {showNumpad && (
                <div className="p-3 rounded-2xl bg-black/40 border border-white/5 animate-scale-in">
                  <div className="numpad">
                    {['1', '2', '3', 'DEL'].map(v => (
                      <button key={v} type="button" onClick={() => handleNumpadClick(v)} className="numpad-btn py-3 text-base">
                        {v}
                      </button>
                    ))}
                    {['4', '5', '6', 'C'].map(v => (
                      <button key={v} type="button" onClick={() => handleNumpadClick(v)} className="numpad-btn py-3 text-base">
                        {v}
                      </button>
                    ))}
                    {['7', '8', '9', '.'].map(v => (
                      <button key={v} type="button" onClick={() => handleNumpadClick(v)} className="numpad-btn py-3 text-base">
                        {v}
                      </button>
                    ))}
                    <button type="button" onClick={() => handleNumpadClick('+')} className="numpad-btn py-3 text-base text-indigo-400 bg-indigo-500/5">
                      <Plus size={16} />
                    </button>
                    <button type="button" onClick={() => handleNumpadClick('-')} className="numpad-btn py-3 text-base text-indigo-400 bg-indigo-500/5">
                      <Minus size={16} />
                    </button>
                    <button type="button" onClick={() => handleNumpadClick('0')} className="numpad-btn py-3 text-base">
                      0
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const evalVal = evaluateFormula(amountExpr);
                        setAmountExpr(String(evalVal));
                        setShowNumpad(false);
                      }}
                      className="numpad-btn py-3 text-sm bg-indigo-600 text-white font-bold"
                    >
                      完成
                    </button>
                  </div>
                </div>
              )}

              {/* Category Grid View (No dropdown, touch grid) */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">選擇分類</span>
                <div className="grid grid-cols-4 gap-2.5">
                  {categories
                    .filter(c => c.type === type)
                    .map(c => {
                      const isSelected = selectedCategory === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedCategory(c.id)}
                          className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all text-center gap-1.5 ${
                            isSelected 
                              ? 'bg-indigo-600/20 text-white' 
                              : 'bg-white/3 text-gray-400 border-white/3 hover:bg-white/5'
                          }`}
                          style={{ borderColor: isSelected ? c.color : 'rgba(255, 255, 255, 0.05)' }}
                        >
                          <div 
                            className="w-8 h-8 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: isSelected ? `${c.color}25` : 'transparent' }}
                          >
                            <LucideIcon name={c.icon} size={16} style={{ color: isSelected ? c.color : '#b2bec3' }} />
                          </div>
                          <span className="text-[10px] font-bold truncate max-w-full">{c.name}</span>
                        </button>
                      );
                    })
                  }
                </div>
              </div>

              {/* Accordion Expandable advanced items drawer */}
              <div className="border-t border-white/5 pt-3 mt-3">
                <button
                  type="button"
                  onClick={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
                  className="w-full flex justify-between items-center text-xs text-indigo-400 font-bold hover:underline"
                >
                  <span className="flex items-center gap-1.5">
                    <FileText size={14} /> 更多進階選項 (帳戶、備註、單據上傳)
                  </span>
                  {isAdvancedExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {isAdvancedExpanded && (
                  <div className="space-y-4 mt-4 p-4 rounded-2xl bg-white/2 border border-white/5 animate-slide-up">
                    {/* Account */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-gray-400 flex items-center gap-1"><Wallet size={12} /> 支付帳戶</label>
                      <select
                        value={selectedAccount}
                        onChange={(e) => setSelectedAccount(e.target.value)}
                        className="glass-input text-xs w-full"
                        required
                      >
                        <option value="" disabled>-- 選擇帳戶 --</option>
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>{a.name} (餘額: ${a.balance})</option>
                        ))}
                      </select>
                    </div>

                    {/* Date and Time Grid */}
                    <div className="grid grid-cols-2 gap-2">
                      {/* Date */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-gray-400 flex items-center gap-1"><Calendar size={12} /> 交易日期</label>
                        <input
                          type="date"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                          className="glass-input text-xs w-full"
                          required
                        />
                      </div>
                      {/* Time */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-gray-400 flex items-center gap-1"><LucideIcon name="Clock" size={12} /> 交易時間</label>
                        <input
                          type="time"
                          value={time}
                          onChange={(e) => setTime(e.target.value)}
                          className="glass-input text-xs w-full"
                          required
                        />
                      </div>
                    </div>

                    {/* Note */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-gray-400 flex items-center gap-1"><FileText size={12} /> 交易備註</label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="點擊輸入備忘錄、標籤..."
                        className="glass-input text-xs w-full resize-none h-[60px]"
                      />
                    </div>

                    {/* Taiwan E-Invoice Section */}
                    <div className="border-t border-white/5 pt-3">
                      <span className="text-[10px] font-bold text-indigo-300 block mb-2">🧾 台灣統一發票明細</span>
                      
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        {/* Invoice Number */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold text-gray-400">發票號碼</label>
                          <input
                            type="text"
                            value={invoiceNumber}
                            onChange={(e) => setInvoiceNumber(e.target.value.toUpperCase())}
                            placeholder="AB-12345678"
                            className="glass-input text-[11px] w-full font-mono py-1.5 px-2"
                          />
                        </div>
                        {/* Random Code */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold text-gray-400">隨機碼</label>
                          <input
                            type="text"
                            value={randomCode}
                            onChange={(e) => setRandomCode(e.target.value)}
                            placeholder="1234"
                            className="glass-input text-[11px] w-full font-mono py-1.5 px-2"
                            maxLength={4}
                          />
                        </div>
                        {/* Carrier */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold text-gray-400">手機載具</label>
                          <input
                            type="text"
                            value={carrier}
                            onChange={(e) => setCarrier(e.target.value)}
                            placeholder="/AB1234"
                            className="glass-input text-[11px] w-full font-mono py-1.5 px-2"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {/* Seller Tax ID */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold text-gray-400">店家統編 (8碼)</label>
                          <input
                            type="text"
                            value={sellerTaxId}
                            onChange={(e) => setSellerTaxId(e.target.value)}
                            placeholder="店家統編"
                            className="glass-input text-[11px] w-full font-mono py-1.5 px-2"
                            maxLength={8}
                          />
                        </div>
                        {/* Buyer Tax ID */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold text-gray-400">買方統編 (8碼)</label>
                          <input
                            type="text"
                            value={buyerTaxId}
                            onChange={(e) => setBuyerTaxId(e.target.value)}
                            placeholder="買方統編"
                            className="glass-input text-[11px] w-full font-mono py-1.5 px-2"
                            maxLength={8}
                          />
                        </div>
                      </div>
                      {invoiceNumber && (
                        <div className="mt-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 text-[11px] space-y-2 text-indigo-300">
                          <div className="flex items-center justify-between border-b border-indigo-500/15 pb-1">
                            <span className="font-bold flex items-center gap-1">🔍 財政部全民稽核查詢小幫手</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={handleFetchFromMofApi}
                                disabled={apiQuerying}
                                className="text-[9px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white font-bold px-2 py-0.5 rounded transition-all flex items-center gap-0.5"
                              >
                                {apiQuerying ? '查詢中...' : '🌐 線上查詢'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowPasteArea(!showPasteArea)}
                                className="text-[9px] bg-amber-600 hover:bg-amber-500 text-white font-bold px-2 py-0.5 rounded transition-all"
                              >
                                📋 貼上文字
                              </button>
                              <a 
                                href={`https://www.einvoice.nat.gov.tw/portal/btc/audit/btc601w/search?invoiceNumber=${invoiceNumber}&invoiceDate=${date ? date.replace(/-/g, '/') : ''}&randomNumber=${randomCode}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[9px] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2 py-0.5 rounded transition-all flex items-center gap-0.5"
                              >
                                打開網頁 ↗
                              </a>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-indigo-200 mt-2 p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 font-sans">
                            <span className="flex items-center gap-1">💡 支援 Chrome 自動帶入</span>
                            <button
                              type="button"
                              onClick={() => setShowMofExtensionGuide(true)}
                              className="underline text-indigo-400 hover:text-indigo-300 font-bold ml-1.5 shrink-0"
                            >
                              點此安裝指引
                            </button>
                          </div>

                          {apiQueryStatus && (
                            <div className="text-[10px] text-emerald-400 font-bold animate-pulse py-0.5">
                              {apiQueryStatus}
                            </div>
                          )}

                          {showPasteArea && (
                            <div className="space-y-1.5 p-2 rounded bg-black/30 border border-white/5 animate-slide-down">
                              <textarea
                                value={pasteContent}
                                onChange={(e) => setPasteContent(e.target.value)}
                                placeholder="在財政部全民稽核結果頁面，複製表格明細內容後在此貼上..."
                                className="glass-input text-[10px] w-full resize-none h-[65px] font-sans p-1.5 bg-black/40 border-white/10"
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setShowPasteArea(false)}
                                  className="text-[9px] text-gray-400 hover:text-white px-2 py-0.5"
                                >
                                  取消
                                </button>
                                <button
                                  type="button"
                                  onClick={handleParsePastedText}
                                  disabled={pasteParsing}
                                  className="text-[9px] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2.5 py-0.5 rounded"
                                >
                                  {pasteParsing ? '正在解析...' : '開始解析'}
                                </button>
                              </div>
                            </div>
                          )}

                          <p className="text-[10px] text-gray-400 font-sans leading-tight">可複製以下資訊至財政部專區查詢：</p>
                          <div className="grid grid-cols-1 gap-1.5 font-mono">
                            <div className="flex items-center justify-between bg-white/5 px-2 py-1 rounded border border-white/5">
                              <span className="text-gray-400">發票字軌號碼:</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-white font-bold">{invoiceNumber.replace('-', '')}</span>
                                <button 
                                  type="button" 
                                  onClick={() => handleCopyToClipboard(invoiceNumber.replace('-', ''), 'invoiceNum')} 
                                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-sans font-bold"
                                >
                                  {copiedField === 'invoiceNum' ? '已複製' : '複製'}
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center justify-between bg-white/5 px-2 py-1 rounded border border-white/5">
                              <span className="text-gray-400">開立日期:</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-white font-bold">{date}</span>
                                <button 
                                  type="button" 
                                  onClick={() => handleCopyToClipboard(date, 'date')} 
                                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-sans font-bold"
                                >
                                  {copiedField === 'date' ? '已複製' : '複製'}
                                </button>
                              </div>
                            </div>
                            {randomCode && (
                              <div className="flex items-center justify-between bg-white/5 px-2 py-1 rounded border border-white/5">
                                <span className="text-gray-400">隨機碼:</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-white font-bold">{randomCode}</span>
                                  <button 
                                    type="button" 
                                    onClick={() => handleCopyToClipboard(randomCode, 'randomCode')} 
                                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-sans font-bold"
                                  >
                                    {copiedField === 'randomCode' ? '已複製' : '複製'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-4 mt-6">
            <button type="button" onClick={onClose} className="glass-button glass-button-secondary flex-1 py-3 text-sm">
              取消
            </button>
            <button type="submit" className="glass-button flex-1 py-3 text-sm bg-indigo-600 hover:bg-indigo-500 font-bold">
              儲存記帳
            </button>
          </div>
        </form>
      </div>

      {showMofExtensionGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in font-sans">
          <div className="glass-panel w-full max-w-lg p-6 space-y-5 relative animate-slide-up shadow-2xl border-indigo-500/20">
            <button
              type="button"
              onClick={() => setShowMofExtensionGuide(false)}
              className="absolute right-4 top-4 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <X size={20} />
            </button>

            <div className="border-b border-white/10 pb-2">
              <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                🔌 全民稽核網頁自動帶入功能安裝指引
              </h3>
              <p className="text-[10px] text-gray-400 mt-0.5">配合 Chrome 擴充功能，一鍵開啟網頁自動填入發票資料！</p>
            </div>

            <div className="space-y-3.5 text-xs leading-relaxed text-gray-300">
              <p className="text-gray-400">
                由於瀏覽器的<strong>同源政策 (Same-Origin Policy)</strong> 安全限制，記帳網頁無法直接跨網域寫入財政部網頁。
                您可以下載我們的專屬 <strong>Chrome 擴充功能小助手</strong>，只需 3 步即可完成安裝，點選「打開網頁」即可自動填入資料！
              </p>

              <div className="space-y-2">
                <span className="font-bold text-indigo-300 block">🛠️ 安裝擴充功能步驟：</span>
                <ol className="list-decimal list-inside space-y-2 text-gray-300 bg-white/5 p-3 rounded-xl border border-white/5 pl-2">
                  <li className="space-y-1">
                    <span>點擊下方按鈕<strong>下載擴充功能 ZIP 壓縮檔</strong>，並在電腦中進行解壓縮：</span>
                    <div>
                      <a
                        href="/chrome-extension.zip"
                        download="chrome-extension.zip"
                        className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1.5 rounded-lg text-[10px] mt-1 transition-all shadow-md ml-1 font-sans"
                      >
                        📥 下載擴充功能 (ZIP)
                      </a>
                    </div>
                  </li>
                  <li>
                    開啟 Chrome 瀏覽器，在網址列前往：<br />
                    <code className="text-[10px] bg-black/40 px-1.5 py-0.5 rounded font-mono text-indigo-300 select-all">chrome://extensions/</code>
                  </li>
                  <li>
                    在頁面右上角開啟 <strong>「開發人員模式」</strong> (Developer mode) 開關。
                  </li>
                  <li>
                    點擊左上角的 <strong>「載入未封裝項目」</strong> (Load unpacked) 按鈕，並在對話框中選擇剛才解壓縮出來的 <strong><code className="text-indigo-300 font-mono">chrome-extension</code></strong> 資料夾即可完成加載！
                  </li>
                </ol>
              </div>

              <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/20 text-[10px] text-indigo-300">
                🎉 <strong>使用方式：</strong><br />
                安裝完成後，當您在記帳視窗點擊「打開網頁 ↗」時，擴充功能會自動從 URL 取得發票號碼、日期和隨機碼並自動填妥，您只需手動輸入網頁上的圖形驗證碼，即可秒速查詢！
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowMofExtensionGuide(false)}
                className="glass-button px-5 py-2 text-xs font-semibold"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
