import React, { useState, useEffect } from 'react';
import { db, type Transaction, type Category, generateUUID } from '../db';
import { fetchCarrierInvoiceHeaders, fetchCarrierInvoiceDetails, normalizeInvoiceNumber } from '../services/gemini';
import { X, Calendar, Download, RefreshCw, AlertCircle, Check, HelpCircle, Upload, FileSpreadsheet } from 'lucide-react';

interface ImportCarrierInvoicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshData: () => void;
}

export const ImportCarrierInvoicesModal: React.FC<ImportCarrierInvoicesModalProps> = ({
  isOpen,
  onClose,
  onRefreshData
}) => {
  const [cardNo, setCardNo] = useState('');
  const [cardEncrypt, setCardEncrypt] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [defaultAccountId, setDefaultAccountId] = useState('cash');
  
  // States
  const [importMode, setImportMode] = useState<'api' | 'csv'>('api');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [headers, setHeaders] = useState<any[]>([]);
  const [selectedInvoiceNums, setSelectedInvoiceNums] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (isOpen) {
      // Load saved values
      setCardNo(localStorage.getItem('mof_card_no') || '');
      setCardEncrypt(localStorage.getItem('mof_card_encrypt') || '');
      
      // Default to current month range
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      setStartDate(`${year}-${month}-01`);
      setEndDate(`${year}-${month}-${day}`);
      
      setErrorMsg('');
      setHeaders([]);
      setSelectedInvoiceNums(new Set());
      
      // Load categories
      db.categories.toArray().then(setCategories);
      
      // Load accounts to find default
      db.accounts.toArray().then(accounts => {
        if (accounts.length > 0) {
          setDefaultAccountId(accounts[0].id);
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Helper to split date range into single calendar month chunks
  const splitIntoMonthlyRanges = (startStr: string, endStr: string) => {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const chunks: { start: string; end: string }[] = [];

    let currentStart = new Date(start);
    while (currentStart <= end) {
      const year = currentStart.getFullYear();
      const month = currentStart.getMonth();
      
      // The end of the current month, or the final end date, whichever is earlier
      const lastDayOfMonth = new Date(year, month + 1, 0);
      const currentEnd = lastDayOfMonth < end ? lastDayOfMonth : new Date(end);

      const yyyy = year;
      const mm = String(month + 1).padStart(2, '0');
      const ddStart = String(currentStart.getDate()).padStart(2, '0');
      const ddEnd = String(currentEnd.getDate()).padStart(2, '0');

      chunks.push({
        start: `${yyyy}/${mm}/${ddStart}`,
        end: `${yyyy}/${mm}/${ddEnd}`
      });

      // Move to 1st of next month
      currentStart = new Date(year, month + 1, 1);
    }
    return chunks;
  };

  const handleFetchHeaders = async () => {
    setErrorMsg('');
    setHeaders([]);
    setSelectedInvoiceNums(new Set());

    const appId = localStorage.getItem('mof_app_id');
    const apiKey = localStorage.getItem('mof_api_key');

    if (!appId || !apiKey) {
      setErrorMsg('⚠️ 請先至「系統設定」輸入您的財政部 App ID 與 API Key，方能使用載具匯入功能。');
      return;
    }

    if (!cardNo.trim() || !cardEncrypt.trim()) {
      setErrorMsg('⚠️ 請輸入手機條碼與驗證碼密碼。');
      return;
    }

    if (!startDate || !endDate) {
      setErrorMsg('⚠️ 請選擇查詢日期區間。');
      return;
    }

    setLoading(true);
    setStatusText('正在連線財政部電子發票平台...');

    try {
      const chunks = splitIntoMonthlyRanges(startDate, endDate);
      let allHeaders: any[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        setStatusText(`正在載入發票清單 (${chunk.start} ~ ${chunk.end})...`);
        
        const result = await fetchCarrierInvoiceHeaders(
          cardNo.trim(),
          cardEncrypt.trim(),
          chunk.start,
          chunk.end,
          appId,
          apiKey
        );

        if (result.code !== '200') {
          throw new Error(result.msg || '財政部平台回應異常');
        }

        if (result.details && Array.isArray(result.details)) {
          allHeaders = [...allHeaders, ...result.details];
        }
      }

      if (allHeaders.length === 0) {
        setErrorMsg('此區間內無任何載具發票紀錄。');
      } else {
        // Sort headers by date descending
        allHeaders.sort((a, b) => {
          const dateA = String(a.invDate.year + 1911) + String(a.invDate.month).padStart(2, '0') + String(a.invDate.date).padStart(2, '0');
          const dateB = String(b.invDate.year + 1911) + String(b.invDate.month).padStart(2, '0') + String(b.invDate.date).padStart(2, '0');
          return dateB.localeCompare(dateA);
        });
        setHeaders(allHeaders);
        // Pre-select all
        setSelectedInvoiceNums(new Set(allHeaders.map(h => h.invNum)));
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`查詢失敗: ${err.message || '未知錯誤，請檢查網路連線或 API Key。'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedInvoiceNums.size === headers.length) {
      setSelectedInvoiceNums(new Set());
    } else {
      setSelectedInvoiceNums(new Set(headers.map(h => h.invNum)));
    }
  };

  const handleToggleSelect = (invNum: string) => {
    const next = new Set(selectedInvoiceNums);
    if (next.has(invNum)) {
      next.delete(invNum);
    } else {
      next.add(invNum);
    }
    setSelectedInvoiceNums(next);
  };

  const autoCategoryMatch = (productName: string, sellerName: string): string => {
    const text = (productName + ' ' + sellerName).toLowerCase();
    
    // Dynamically match database categories if possible
    const matchCategory = (keywordMap: Record<string, string[]>) => {
      for (const [catName, keywords] of Object.entries(keywordMap)) {
        if (keywords.some(kw => text.includes(kw))) {
          const cat = categories.find(c => c.name.includes(catName) || catName.includes(c.name));
          if (cat) return cat.id;
        }
      }
      return null;
    };

    const matchedId = matchCategory({
      '餐飲食品': ['早餐', '午餐', '晚餐', '便當', '麵', '飯', '茶', '咖啡', '肉', '菜', '麥當勞', '肯德基', '必勝客', '星巴克', '便利商店', '7-11', '全家', '萊爾富', 'ok超商', '美廉社', '全聯', '家樂福', '大潤發', '飲料'],
      '交通出行': ['高鐵', '台鐵', '火車', '捷運', '公車', '客運', '計程車', 'uber', '中油', '台塑', '加油', '車', '停車', '航', '機票'],
      '娛樂消遣': ['影城', '電影', '歌', 'ktv', '遊戲', '玩具', '樂園', '票券', '度假', '飯店', '民宿', '酒吧', '展覽'],
      '醫療保健': ['藥局', '診所', '醫院', '健保', '醫生', '感冒', '維他命', '眼鏡'],
      '教育學習': ['書', '補習', '課程', '學費', '文具', '誠品', '金石堂'],
      '購物消費': ['購物', '百貨', '服飾', '衣', '鞋', '包', '美妝', '屈臣氏', '康是美', '寶雅', 'momo', '蝦皮', 'pchome', '東森']
    });

    if (matchedId) return matchedId;

    // Fallback to "其他支出"
    const defaultCat = categories.find(c => c.name.includes('其他') || c.type === 'expense') || categories[0];
    return defaultCat ? defaultCat.id : '';
  };

  const handleImportSelected = async () => {
    if (selectedInvoiceNums.size === 0) return;

    const appId = localStorage.getItem('mof_app_id')!;
    const apiKey = localStorage.getItem('mof_api_key')!;

    setLoading(true);
    let successCount = 0;
    let skipCount = 0;

    try {
      const selectedHeaders = headers.filter(h => selectedInvoiceNums.has(h.invNum));
      
      for (let i = 0; i < selectedHeaders.length; i++) {
        const header = selectedHeaders[i];
        
        // Formulate date YYYY-MM-DD
        const yyyy = header.invDate.year + 1911;
        const mm = String(header.invDate.month).padStart(2, '0');
        const dd = String(header.invDate.date).padStart(2, '0');
        const formattedDate = `${yyyy}-${mm}-${dd}`;
        const queryDate = `${yyyy}/${mm}/${dd}`;

        // Check if invoice already exists in database to avoid duplicates
        // Use filter to normalize invoice number (handles "AB-12345678" vs "AB12345678")
        const existing = await db.transactions
          .filter(tx => Boolean(tx.invoiceNumber) && normalizeInvoiceNumber(tx.invoiceNumber) === normalizeInvoiceNumber(header.invNum))
          .first();

        if (existing) {
          skipCount++;
          continue;
        }

        setStatusText(`正在拉取發票明細 (${i + 1}/${selectedHeaders.length}): ${header.invNum}...`);

        const detailResult = await fetchCarrierInvoiceDetails(
          cardNo.trim(),
          cardEncrypt.trim(),
          header.invNum,
          queryDate,
          appId,
          apiKey
        );

        if (detailResult.code !== '200') {
          console.warn(`Failed to fetch detail for ${header.invNum}:`, detailResult.msg);
          // Fallback to import as a single item transaction without details
          const matchedCategory = autoCategoryMatch('', header.sellerName);
          const newTx: Transaction = {
            id: generateUUID(),
            amount: header.amount,
            type: 'expense',
            category: matchedCategory,
            account: defaultAccountId,
            date: formattedDate,
            time: '12:00',
            note: `${header.sellerName} (載具發票)`,
            invoiceNumber: normalizeInvoiceNumber(header.invNum),
            randomCode: '',
            sellerTaxId: header.sellerBan || '',
            buyerTaxId: '',
            items: [{
              name: '發票消費總額',
              qty: 1,
              price: header.amount,
              total: header.amount
            }],
            createdAt: Date.now()
          };
          await db.transactions.add(newTx);
          successCount++;
          continue;
        }

        // Parse detail items list
        const mofItems = detailResult.details || [];
        const items = mofItems.map((item: any) => ({
          name: item.description || '商品',
          qty: Math.max(1, Number(item.quantity) || 1),
          price: Number(item.unitPrice) || 0,
          total: Number(item.amount) || 0
        }));

        // Calculate matched category based on first item description
        const firstItemDesc = items[0]?.name || '';
        const matchedCategory = autoCategoryMatch(firstItemDesc, header.sellerName);

        const newTx: Transaction = {
          id: generateUUID(),
          amount: header.amount,
          type: 'expense',
          category: matchedCategory,
          account: defaultAccountId,
          date: formattedDate,
          time: '12:00',
          note: `${header.sellerName} (載具自動匯入)`,
          invoiceNumber: normalizeInvoiceNumber(header.invNum),
          randomCode: detailResult.randomNumber || '',
          sellerTaxId: header.sellerBan || '',
          buyerTaxId: '',
          items: items.length > 0 ? items : [{
            name: '發票消費明細',
            qty: 1,
            price: header.amount,
            total: header.amount
          }],
          createdAt: Date.now()
        };

        await db.transactions.add(newTx);
        successCount++;
      }

      alert(`🎉 匯入完成！\n成功匯入: ${successCount} 筆發票\n重複略過: ${skipCount} 筆發票`);
      onRefreshData();
      onClose();
    } catch (err: any) {
      console.error(err);
      alert(`匯入過程中發生錯誤: ${err.message || '未知錯誤'}`);
    } finally {
      setLoading(false);
    }
  };

  const parseInvoiceCsv = (csvText: string): Promise<any[]> => {
    return new Promise((resolve) => {
      const lines = csvText.split(/\r?\n/);
      if (lines.length <= 1) {
        resolve([]);
        return;
      }

      const headerLine = lines[0];
      const headers = headerLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
      
      const records: any[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values: string[] = [];
        let currentVal = '';
        let insideQuote = false;
        for (let j = 0; j < line.length; j++) {
          const char = line[j];
          if (char === '"') {
            insideQuote = !insideQuote;
          } else if (char === ',' && !insideQuote) {
            values.push(currentVal.trim().replace(/^["']|["']$/g, ''));
            currentVal = '';
          } else {
            currentVal += char;
          }
        }
        values.push(currentVal.trim().replace(/^["']|["']$/g, ''));

        if (values.length < headers.length) continue;

        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx] || '';
        });

        records.push(row);
      }
      resolve(records);
    });
  };

  const handleCsvImport = async (file: File) => {
    setLoading(true);
    setStatusText('正在讀取 CSV 檔案...');
    setErrorMsg('');
    
    try {
      const text = await file.text();
      const rows = await parseInvoiceCsv(text);
      
      if (rows.length === 0) {
        throw new Error('CSV 檔案為空或格式不正確');
      }

      setStatusText('正在解析發票與消費品項...');
      
      const groupedInvoices: Record<string, {
        invoiceNumber: string;
        date: string;
        sellerName: string;
        sellerBan: string;
        amount: number;
        items: { name: string; qty: number; price: number; total: number }[];
      }> = {};

      for (const row of rows) {
        const invNum = (row['發票號碼'] || row['發票ID'] || row['發票編號'] || '').trim().replace(/-/g, '').toUpperCase();
        if (!invNum || invNum.length !== 10) continue;

        let dateVal = (row['發票日期'] || row['開立日期'] || row['日期'] || '').trim();
        let formattedDate = '';
        if (dateVal.includes('/') || dateVal.includes('-')) {
          const parts = dateVal.split(/[-/]/);
          if (parts.length === 3) {
            let y = parseInt(parts[0]);
            let m = parts[1].padStart(2, '0');
            let d = parts[2].padStart(2, '0');
            if (y < 1000) {
              y += 1911;
            }
            formattedDate = `${y}-${m}-${d}`;
          }
        } else if (dateVal.length === 7) {
          const y = parseInt(dateVal.substring(0, 3)) + 1911;
          const m = dateVal.substring(3, 5);
          const d = dateVal.substring(5, 7);
          formattedDate = `${y}-${m}-${d}`;
        } else if (dateVal.length === 8) {
          const y = dateVal.substring(0, 4);
          const m = dateVal.substring(4, 6);
          const d = dateVal.substring(6, 8);
          formattedDate = `${y}-${m}-${d}`;
        } else {
          const now = new Date();
          formattedDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        }

        const sellerName = row['賣方名稱'] || row['營業人名稱'] || row['店家名稱'] || row['店家'] || '雲端載具消費';
        const sellerBan = row['賣方統一編號'] || row['營業人統一編號'] || row['統編'] || '';
        
        // 支援財政部匯出 CSV 欄名（常見：發票金額 / 消費明細_金額 / 消費明細_數量 / 消費明細_單價）
        // 發票金額欄位在不同匯出格式可能會不一致；用「消費明細_金額」加總作為最終總額



        // 財政部 CSV 欄位：消費明細_品名
        const itemName = row['消費明細_品名'] || row['品名'] || row['商品名稱'] || row['明細'] || row['商品品名'] || '';

        // 數量/單價/明細總額：以財政部匯出欄位為主，並允許小數（改用 parseFloat）

        const itemQty = Math.max(
          0,
          parseFloat(
            row['消費明細_數量'] ||
            row['數量'] ||
            '0'
          )
        );

        const itemPrice = parseFloat(
          row['消費明細_單價'] ||
          row['單價金額'] ||
          row['單價'] ||
          '0'
        );

        const itemTotal = parseFloat(
          row['消費明細_金額'] ||
          row['小計'] ||
          row['總價'] ||
          row['金額'] ||
          '0'
        );



        if (!groupedInvoices[invNum]) {
          groupedInvoices[invNum] = {
            invoiceNumber: invNum,
            date: formattedDate,
            sellerName,
            sellerBan,
            // 總額先用 0，後續用消費明細_金額加總
            amount: 0,
            items: []
          };
        }

        // 發票總額 = 同一發票所有「消費明細_金額」加總（含負數折讓）
        groupedInvoices[invNum].amount += itemTotal;


        // 避免把備註列（===以下為備註===）當成商品明細匯入
        const isMemoRow = typeof itemName === 'string' && itemName.includes('以下為備註');
        if (!isMemoRow && itemName) {
          groupedInvoices[invNum].items.push({
            name: itemName,
            qty: itemQty,
            price: itemPrice,
            // 明細總額（含負數折讓）以消費明細_金額為準
            total: itemTotal
          });
        }


      }

      const invoicesList = Object.values(groupedInvoices);
      if (invoicesList.length === 0) {
        throw new Error('未能從 CSV 檔案中解析出有效的發票號碼，請確認欄位名稱包含「發票號碼」與「發票日期」');
      }

      let successCount = 0;
      let skipCount = 0;
      
      for (const inv of invoicesList) {
        const normalizedInvNum = normalizeInvoiceNumber(inv.invoiceNumber);
        const existing = await db.transactions
          .filter(tx => Boolean(tx.invoiceNumber) && normalizeInvoiceNumber(tx.invoiceNumber) === normalizedInvNum)
          .first();

        if (existing) {
          skipCount++;
          continue;
        }

        const firstItemName = inv.items[0]?.name || '';
        const matchedCategory = autoCategoryMatch(firstItemName, inv.sellerName);

        const items = inv.items.length > 0 ? inv.items : [{
          name: '發票消費總額',
          qty: 1,
          price: inv.amount,
          total: inv.amount
        }];

        const amount = inv.amount > 0 ? inv.amount : items.reduce((sum, item) => sum + item.total, 0);

        const newTx: Transaction = {
          id: generateUUID(),
          amount,
          type: 'expense',
          category: matchedCategory,
          account: defaultAccountId,
          date: inv.date,
          time: '12:00',
          note: `${inv.sellerName} (載具 CSV 匯入)`,
          invoiceNumber: normalizeInvoiceNumber(inv.invoiceNumber),
          randomCode: '',
          sellerTaxId: inv.sellerBan,
          buyerTaxId: '',
          items,
          createdAt: Date.now()
        };

        await db.transactions.add(newTx);
        successCount++;
      }

      alert(`🎉 CSV 載具發票匯入完成！\n成功匯入: ${successCount} 筆發票\n重複略過: ${skipCount} 筆發票`);
      onRefreshData();
      onClose();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`CSV 解析匯入失敗: ${err.message || '未知錯誤'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col glass-panel border border-indigo-500/30 shadow-2xl shadow-indigo-500/10 rounded-2xl overflow-hidden animate-zoom-in">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5 bg-indigo-950/20">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
              <Download size={22} />
            </span>
            <div>
              <h3 className="text-lg font-bold text-white font-sans">匯入載具發票記帳</h3>
              <p className="text-xs text-indigo-300/80 font-sans">自財政部雲端載具同步明細，快速批量完成記帳</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-white/5 bg-white/5 p-1 mx-6 mt-4 rounded-xl border border-white/5">
          <button
            onClick={() => {
              setImportMode('api');
              setErrorMsg('');
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              importMode === 'api'
                ? 'bg-indigo-600 text-white shadow shadow-indigo-600/10'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <RefreshCw size={14} /> 🌐 API 線上同步
          </button>
          <button
            onClick={() => {
              setImportMode('csv');
              setErrorMsg('');
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              importMode === 'csv'
                ? 'bg-indigo-600 text-white shadow shadow-indigo-600/10'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <FileSpreadsheet size={14} /> 📋 匯入 CSV 檔案
          </button>
        </div>

        {/* Content Container */}
        <div className="flex-1 p-6 overflow-y-auto space-y-5 font-sans">
          
          {importMode === 'csv' ? (
            <div className="space-y-4">
              <div className="p-8 rounded-2xl border-2 border-dashed border-indigo-500/20 hover:border-indigo-500/50 bg-indigo-500/5 transition-all text-center flex flex-col items-center justify-center gap-3 relative cursor-pointer group">
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleCsvImport(file);
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  disabled={loading}
                />
                <span className="p-4 rounded-full bg-indigo-500/10 text-indigo-400 group-hover:scale-110 transition-all">
                  <Upload size={32} />
                </span>
                <div>
                   <p className="text-sm font-bold text-white font-sans">點擊或拖放發票 CSV 檔案至此</p>
                   <p className="text-xs text-gray-400 mt-1.5 font-sans leading-tight">
                     支援由財政部平台匯出之「載具發票明細查詢」或「消費發票彙整」之 CSV 檔案
                   </p>
                 </div>
              </div>

              <div className="text-center">
                <a 
                  href="https://www.einvoice.nat.gov.tw/portal/btc/mobile/btc502w/detail" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-indigo-300 underline hover:text-indigo-200 text-xs font-sans"
                >
                  點擊此處下載範例或前往匯出頁面
                </a>
              </div>

            </div>
          ) : (
            <>
              {/* Top Form Settings */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-[11px] font-bold text-gray-400">手機條碼 (cardNo)</label>
                    <input
                      type="text"
                      value={cardNo}
                      onChange={(e) => setCardNo(e.target.value)}
                      placeholder="例如：/AB12345"
                      className="glass-input text-xs font-mono py-1.5 px-2.5"
                      disabled={loading}
                    />
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-[11px] font-bold text-gray-400">驗證碼/密碼 (cardEncrypt)</label>
                    <input
                      type="password"
                      value={cardEncrypt}
                      onChange={(e) => setCardEncrypt(e.target.value)}
                      placeholder="手機條碼密碼"
                      className="glass-input text-xs font-mono py-1.5 px-2.5"
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-gray-400 flex items-center gap-1">
                      <Calendar size={12} /> 開始日期
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="glass-input text-xs py-1.5 px-2.5"
                      disabled={loading}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-gray-400 flex items-center gap-1">
                      <Calendar size={12} /> 結束日期
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="glass-input text-xs py-1.5 px-2.5"
                      disabled={loading}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleFetchHeaders}
                    disabled={loading}
                    className="w-full py-1.5 px-4 font-bold text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white rounded-xl transition-all flex items-center justify-center gap-1.5 border border-indigo-500/20"
                  >
                    {loading && <RefreshCw size={14} className="animate-spin" />}
                    查詢載具發票
                  </button>
                </div>
              </div>

              {/* Status / Error Block */}
              {loading && (
                <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10 flex items-center gap-3">
                  <RefreshCw className="text-indigo-400 animate-spin" size={18} />
                  <span className="text-xs text-indigo-300 font-bold animate-pulse">{statusText}</span>
                </div>
              )}

              {/* Headers list */}
              {headers.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-gray-400 px-1">
                    <span>找到 {headers.length} 筆發票，已選擇 {selectedInvoiceNums.size} 筆</span>
                    <button
                      onClick={handleToggleSelectAll}
                      className="text-indigo-400 hover:text-indigo-300 underline font-bold"
                    >
                      {selectedInvoiceNums.size === headers.length ? '全部取消' : '全選'}
                    </button>
                  </div>

                  <div className="border border-white/5 rounded-xl overflow-hidden max-h-[40vh] overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-white/5 text-gray-400 border-b border-white/5 font-bold">
                          <th className="py-2.5 px-3 w-10 text-center"></th>
                          <th className="py-2.5 px-3">日期</th>
                          <th className="py-2.5 px-3">發票號碼</th>
                          <th className="py-2.5 px-3">商家名稱</th>
                          <th className="py-2.5 px-3 text-right">金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {headers.map((h) => {
                          const isSelected = selectedInvoiceNums.has(h.invNum);
                          const yyyy = h.invDate.year + 1911;
                          const mm = String(h.invDate.month).padStart(2, '0');
                          const dd = String(h.invDate.date).padStart(2, '0');
                          
                          return (
                            <tr
                              key={h.invNum}
                              onClick={() => handleToggleSelect(h.invNum)}
                              className={`border-b border-white/5 cursor-pointer transition-all hover:bg-white/5 ${
                                isSelected ? 'bg-indigo-500/5' : ''
                              }`}
                            >
                              <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleSelect(h.invNum)}
                                  className="rounded border-white/10 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                />
                              </td>
                              <td className="py-2 px-3 font-mono text-gray-300">{`${yyyy}/${mm}/${dd}`}</td>
                              <td className="py-2 px-3 font-mono font-bold text-white">{h.invNum}</td>
                              <td className="py-2 px-3 text-gray-400 truncate max-w-[150px]" title={h.sellerName}>
                                {h.sellerName}
                              </td>
                              <td className="py-2 px-3 font-mono text-right font-bold text-indigo-300">${h.amount}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {errorMsg && (
            <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-2.5">
              <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={16} />
              <span className="text-xs text-amber-400 font-medium leading-relaxed font-sans">{errorMsg}</span>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-white/5 bg-indigo-950/20">
          <div className="text-[10px] text-gray-400 flex items-center gap-1">
            <HelpCircle size={12} />
            系統會自動過濾已匯入的發票號碼
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="py-1.5 px-4 font-bold text-xs bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl transition-all"
            >
              關閉
            </button>
            {importMode === 'api' && (
              <button
                onClick={handleImportSelected}
                disabled={loading || selectedInvoiceNums.size === 0}
                className="py-1.5 px-5 font-bold text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white rounded-xl transition-all flex items-center gap-1 border border-indigo-500/20"
              >
                <Check size={14} />
                匯入所選發票 ({selectedInvoiceNums.size})
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
