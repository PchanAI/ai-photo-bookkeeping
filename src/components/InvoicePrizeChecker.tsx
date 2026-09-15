import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { fetchWinningListFromRss } from '../services/gemini';
import { Award, RefreshCw, AlertCircle, CheckCircle, Zap, ShieldCheck, Gift } from 'lucide-react';

interface PeriodWinningInfo {
  title: string; // e.g. "115年 03~04月"
  link: string;
  special: string; // 特別獎 8碼
  grand: string; // 特獎 8碼
  first: string[]; // 頭獎 8碼陣列
}

interface CheckedInvoice {
  id?: string;
  invoiceNumber: string;
  date: string;
  note: string;
  amount: number;
  isWon: boolean;
  prizeName: string;
  amountWon: number;
}

export const InvoicePrizeChecker: React.FC = () => {
  const [periods, setPeriods] = useState<PeriodWinningInfo[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Checking states
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanResults, setScanResults] = useState<{
    totalScanned: number;
    wonCount: number;
    wonTotalAmount: number;
    details: CheckedInvoice[];
  } | null>(null);

  // Load RSS on mount
  useEffect(() => {
    loadWinningPeriods();
  }, []);

  const loadWinningPeriods = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const data = await fetchWinningListFromRss();
      if (data.length === 0) {
        throw new Error('未取得任何開獎期數資料');
      }
      setPeriods(data);
      setSelectedPeriod(data[0].title); // Default to latest period
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`取得中獎號碼失敗: ${err.message || '請確認網路連線'}`);
    } finally {
      setLoading(false);
    }
  };

  // Check algorithm
  const checkPrize = (
    invoiceNum: string,
    winning: PeriodWinningInfo
  ): { isWon: boolean; prizeName: string; amountWon: number } => {
    // Extract only digits
    const digits = invoiceNum.replace(/[^0-9]/g, '');
    if (digits.length !== 8) {
      return { isWon: false, prizeName: '', amountWon: 0 };
    }

    // 1. 特別獎 (Special Prize - 10 million TWD)
    if (digits === winning.special) {
      return { isWon: true, prizeName: '特別獎', amountWon: 10000000 };
    }

    // 2. 特獎 (Grand Prize - 2 million TWD)
    if (digits === winning.grand) {
      return { isWon: true, prizeName: '特獎', amountWon: 2000000 };
    }

    // 3. 頭獎 to 六獎
    let maxPrize = { isWon: false, prizeName: '', amountWon: 0 };
    for (const firstPrize of winning.first) {
      if (!firstPrize || firstPrize.length !== 8) continue;
      
      // Match suffix from 8 digits down to 3 digits
      for (let len = 8; len >= 3; len--) {
        const firstSuffix = firstPrize.slice(8 - len);
        const invSuffix = digits.slice(8 - len);
        
        if (firstSuffix === invSuffix) {
          let prizeName = '';
          let amount = 0;
          switch (len) {
            case 8: prizeName = '頭獎'; amount = 200000; break;
            case 7: prizeName = '二獎'; amount = 40000; break;
            case 6: prizeName = '三獎'; amount = 10000; break;
            case 5: prizeName = '四獎'; amount = 4000; break;
            case 4: prizeName = '五獎'; amount = 1000; break;
            case 3: prizeName = '六獎'; amount = 200; break;
          }
          if (amount > maxPrize.amountWon) {
            maxPrize = { isWon: true, prizeName, amountWon: amount };
          }
        }
      }
    }

    return maxPrize;
  };

  // Helper to check if a Gregorian date matches a ROC period (e.g. "115年 03~04月")
  const isDateInPeriod = (dateStr: string, periodTitle: string): boolean => {
    // Parse ROC Year and months range
    // title format: "115年 03~04月" or "115年03-04月"
    const yearMatch = periodTitle.match(/(\d+)年/);
    const monthsMatch = periodTitle.match(/(\d+)[\s~-]*(0?\d+)月/);
    if (!yearMatch || !monthsMatch) return false;

    const rocYear = parseInt(yearMatch[1]);
    const mStart = parseInt(monthsMatch[1]);
    const mEnd = parseInt(monthsMatch[2]);

    const dateParts = dateStr.split('-');
    if (dateParts.length < 2) return false;

    const westYear = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]);
    const txRocYear = westYear - 1911;

    return txRocYear === rocYear && month >= mStart && month <= mEnd;
  };

  const triggerConfetti = () => {
    // Simple DOM-based confetti particles generator
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.inset = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '9999';
    document.body.appendChild(container);

    const colors = ['#f43f5e', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#10b981', '#eab308'];
    for (let i = 0; i < 150; i++) {
      const particle = document.createElement('div');
      particle.style.position = 'absolute';
      particle.style.width = `${Math.random() * 8 + 6}px`;
      particle.style.height = `${Math.random() * 8 + 6}px`;
      particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      particle.style.borderRadius = '2px';
      
      const left = Math.random() * 100;
      particle.style.left = `${left}%`;
      particle.style.top = '-10px';
      
      const duration = Math.random() * 2 + 2;
      const delay = Math.random() * 1.5;
      particle.style.animation = `fall ${duration}s linear ${delay}s infinite`;
      
      // Inject keyframes if not exist
      if (!document.getElementById('confetti-styles')) {
        const style = document.createElement('style');
        style.id = 'confetti-styles';
        style.textContent = `
          @keyframes fall {
            0% { transform: translateY(0) rotate(0deg); opacity: 1; }
            100% { transform: translateY(105vh) rotate(360deg); opacity: 0; }
          }
        `;
        document.head.appendChild(style);
      }

      container.appendChild(particle);
    }

    setTimeout(() => {
      container.remove();
    }, 4500);
  };

  const handleStartScan = async () => {
    const period = periods.find(p => p.title === selectedPeriod);
    if (!period) return;

    setScanning(true);
    setScanProgress(0);
    setScanResults(null);

    // Fetch all database transactions that have a invoiceNumber
    const txs = await db.transactions
      .filter(t => !!t.invoiceNumber && t.invoiceNumber.trim().length > 0)
      .toArray();

    // Filter by period
    const matchedTxs = txs.filter(t => isDateInPeriod(t.date, period.title));

    if (matchedTxs.length === 0) {
      setScanResults({
        totalScanned: 0,
        wonCount: 0,
        wonTotalAmount: 0,
        details: []
      });
      setScanning(false);
      return;
    }

    // Simulate gorgeous scanning radar effect progress
    const steps = matchedTxs.length;
    let details: CheckedInvoice[] = [];
    let wonCount = 0;
    let wonTotalAmount = 0;

    for (let i = 0; i < steps; i++) {
      const tx = matchedTxs[i];
      const invNum = tx.invoiceNumber || '';
      const checkRes = checkPrize(invNum, period);
      
      const resultItem: CheckedInvoice = {
        id: tx.id,
        invoiceNumber: invNum,
        date: tx.date,
        note: tx.note || '無備註消費',
        amount: tx.amount,
        isWon: checkRes.isWon,
        prizeName: checkRes.prizeName,
        amountWon: checkRes.amountWon
      };

      details.push(resultItem);
      if (checkRes.isWon) {
        wonCount++;
        wonTotalAmount += checkRes.amountWon;
      }

      // Update progress bar
      await new Promise(resolve => setTimeout(resolve, Math.min(100, 1500 / steps)));
      setScanProgress(Math.round(((i + 1) / steps) * 100));
    }

    // Sort: winning items first, then by date descending
    details.sort((a, b) => {
      if (a.isWon && !b.isWon) return -1;
      if (!a.isWon && b.isWon) return 1;
      return b.date.localeCompare(a.date);
    });

    setScanResults({
      totalScanned: steps,
      wonCount,
      wonTotalAmount,
      details
    });

    setScanning(false);

    if (wonCount > 0) {
      triggerConfetti();
    }
  };

  const activePeriodInfo = periods.find(p => p.title === selectedPeriod);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6 font-sans">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Award className="text-yellow-400 animate-bounce" size={26} />
            發票自動對獎系統
          </h1>
          <p className="text-sm text-gray-400 mt-1">一鍵比對本機所有雲端及紙本發票，快速獲取中獎統計</p>
        </div>

        {/* Period Selector & Manual Trigger */}
        <div className="flex flex-wrap items-center gap-3">
          {periods.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-400">選擇開獎期別:</span>
              <select
                value={selectedPeriod}
                onChange={(e) => {
                  setSelectedPeriod(e.target.value);
                  setScanResults(null);
                }}
                className="glass-input text-xs font-bold py-1.5 px-3 rounded-xl border border-indigo-500/25 bg-black/40 text-white cursor-pointer"
                disabled={scanning}
              >
                {periods.map((p) => (
                  <option key={p.title} value={p.title} className="font-sans font-bold">
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          <button
            onClick={loadWinningPeriods}
            disabled={loading || scanning}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all disabled:opacity-50"
            title="重新整理中獎號碼"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Error Block */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-3">
          <AlertCircle className="text-rose-500 mt-0.5" size={18} />
          <span className="text-sm text-rose-300 font-medium leading-relaxed">{errorMsg}</span>
        </div>
      )}

      {/* Main Grid: Winning Numbers display & Auto Scan card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Winning Numbers Info Card */}
        <div className="lg:col-span-2 glass-panel p-6 border border-white/5 space-y-5 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <ShieldCheck className="text-emerald-400" size={20} />
              財政部官方中獎獎號
            </h2>

            {activePeriodInfo ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col justify-center">
                    <span className="text-xs text-indigo-400 font-bold">特別獎 (1000 萬元)</span>
                    <span className="text-2xl font-mono font-black text-rose-500 mt-1 tracking-wider">
                      {activePeriodInfo.special || '無獎號'}
                    </span>
                  </div>
                  <div className="flex flex-col justify-center border-t md:border-t-0 md:border-l border-indigo-500/10 pt-3 md:pt-0 md:pl-5">
                    <span className="text-xs text-indigo-400 font-bold">特獎 (200 萬元)</span>
                    <span className="text-2xl font-mono font-black text-amber-500 mt-1 tracking-wider">
                      {activePeriodInfo.grand || '無獎號'}
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-2">
                  <span className="text-xs text-gray-400 font-bold block">頭獎 (20 萬元)</span>
                  <div className="flex flex-wrap gap-4 pt-1">
                    {activePeriodInfo.first.length > 0 ? (
                      activePeriodInfo.first.map((num, idx) => (
                        <span key={idx} className="text-lg font-mono font-extrabold text-white tracking-wider bg-white/5 px-3 py-1 rounded-lg border border-white/5">
                          {num}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-gray-400">無頭獎獎號</span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 leading-tight pt-1">
                    * 頭獎末 7 碼相符為二獎 ($40,000)；末 6 碼為三獎 ($10,000)；末 5 碼為四獎 ($4,000)；末 4 碼為五獎 ($1,000)；末 3 碼為六獎 ($200)
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-10 text-gray-400 text-sm">
                載入中或未選取開獎期別...
              </div>
            )}
          </div>

          {activePeriodInfo && (
            <div className="text-right border-t border-white/5 pt-3">
              <a
                href={activePeriodInfo.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 font-bold underline"
              >
                前往財政部官網查看完整中獎清冊 ↗
              </a>
            </div>
          )}
        </div>

        {/* Right Side: Scan trigger panel */}
        <div className="glass-panel p-6 border border-white/5 flex flex-col items-center justify-between text-center min-h-[250px]">
          <div className="space-y-3 w-full">
            <span className="p-3.5 rounded-2xl bg-indigo-500/10 text-indigo-400 inline-block mb-1">
              <Zap size={28} className={scanning ? 'animate-pulse' : ''} />
            </span>
            <h3 className="text-lg font-bold text-white font-sans">一鍵自動對獎</h3>
            <p className="text-xs text-gray-400 max-w-[250px] mx-auto leading-relaxed">
              系統將會自動檢索此期別（例如 3-4 月份）本機記帳中所有包含發票號碼的交易紀錄。
            </p>
          </div>

          <div className="w-full pt-6">
            {scanning ? (
              <div className="space-y-2.5">
                <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/5">
                  <div
                    className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${scanProgress}%` }}
                  ></div>
                </div>
                <span className="text-xs text-indigo-300 font-bold block animate-pulse">
                  正在掃描並比對發票庫... {scanProgress}%
                </span>
              </div>
            ) : (
              <button
                onClick={handleStartScan}
                disabled={loading || !selectedPeriod}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:from-indigo-900 disabled:to-violet-900 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/10 border border-indigo-500/30 flex items-center justify-center gap-1.5 font-sans"
              >
                <Zap size={16} />
                開始自動對獎 ⚡
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Sweep Results Display */}
      {scanResults && (
        <div className="space-y-6 animate-slide-down">
          
          {/* Results Overview Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-panel p-5 border border-white/5 flex flex-col justify-center">
              <span className="text-xs text-gray-400 font-bold">已掃描發票總數</span>
              <span className="text-3xl font-mono font-black text-white mt-1.5">{scanResults.totalScanned} 張</span>
            </div>
            
            <div className="glass-panel p-5 border border-indigo-500/20 bg-indigo-500/5 flex flex-col justify-center">
              <span className="text-xs text-indigo-400 font-bold">中獎發票數</span>
              <span className={`text-3xl font-mono font-black mt-1.5 ${scanResults.wonCount > 0 ? 'text-rose-500 animate-bounce' : 'text-white'}`}>
                {scanResults.wonCount} 張
              </span>
            </div>

            <div className="glass-panel p-5 border border-emerald-500/20 bg-emerald-500/5 flex flex-col justify-center">
              <span className="text-xs text-emerald-400 font-bold">中獎總獎金</span>
              <span className="text-3xl font-mono font-black text-emerald-400 mt-1.5">
                ${scanResults.wonTotalAmount.toLocaleString()} 元
              </span>
            </div>
          </div>

          {/* Detailed Sweep Result List */}
          <div className="glass-panel p-6 border border-white/5 space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <CheckCircle className="text-indigo-400" size={18} />
              對獎明細清單
            </h3>

            {scanResults.details.length > 0 ? (
              <div className="border border-white/5 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-white/5 text-gray-400 border-b border-white/5 font-bold">
                      <th className="py-2.5 px-4">消費日期</th>
                      <th className="py-2.5 px-4">發票號碼</th>
                      <th className="py-2.5 px-4">消費品項/備註</th>
                      <th className="py-2.5 px-4 text-right">原消費金額</th>
                      <th className="py-2.5 px-4 text-center">對獎結果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanResults.details.map((item, idx) => (
                      <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-all">
                        <td className="py-3 px-4 font-mono text-gray-300">{item.date}</td>
                        <td className="py-3 px-4 font-mono font-bold text-white">{item.invoiceNumber}</td>
                        <td className="py-3 px-4 text-gray-400 truncate max-w-[200px]" title={item.note}>
                          {item.note}
                        </td>
                        <td className="py-3 px-4 font-mono text-right text-gray-300">${item.amount}</td>
                        <td className="py-3 px-4 text-center">
                          {item.isWon ? (
                            <span className="inline-flex items-center gap-1 bg-rose-500/10 border border-rose-500/20 text-rose-500 font-bold px-2 py-0.5 rounded-lg text-[10px]">
                              <Gift size={10} />
                              中獎！{item.prizeName} (${item.amountWon}元)
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-lg border border-transparent">
                              未中獎
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                此期別無任何包含發票號碼的記帳數據。您可以新增發票或從載具匯入發票後重新對獎。
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
};
