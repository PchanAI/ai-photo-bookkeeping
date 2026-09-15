import React, { useState, useEffect } from 'react';
import { db, seedDefaultData, type Transaction } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import * as Icons from 'lucide-react';
import { 
  Home as HomeIcon, TrendingUp, Wallet, Settings as SettingsIcon, 
  Plus, Calendar, Trash2, Tag, Sun, Info, Camera, Edit2, ChevronRight, X, Gift, Download, Check
} from 'lucide-react';
import { Settings } from './components/Settings';
import { AccountsManager } from './components/AccountsManager';
import { Stats } from './components/Stats';
import { AddRecordModal } from './components/AddRecordModal';
import { ImportCarrierInvoicesModal } from './components/ImportCarrierInvoicesModal';
import { InvoicePrizeChecker } from './components/InvoicePrizeChecker';
import { Doughnut } from 'react-chartjs-2';
import { rotateBase64Image, scanReceiptWithGemini, type GeminiScanResult } from './services/gemini';
import { scanReceiptLocally } from './services/localOcr';

// Helper component to render Lucide Icons dynamically
export const LucideIcon: React.FC<{ name: string; size?: number; className?: string; style?: React.CSSProperties }> = ({ 
  name, size = 18, className, style 
}) => {
  const IconComponent = (Icons as any)[name];
  if (!IconComponent) {
    return <Icons.HelpCircle size={size} className={className} style={style} />;
  }
  return <IconComponent size={size} className={className} style={style} />;
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'statistics' | 'accounts' | 'prizes' | 'settings'>('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'violet' | 'rose' | 'emerald' | 'slate' | 'charcoal' | 'arctic' | 'golden' | 'cyberpunk'>('midnight');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [showCarrierImport, setShowCarrierImport] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | undefined>(undefined);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [highlightedTransactionId, setHighlightedTransactionId] = useState<string | null>(null);
  const [transactionPhoto, setTransactionPhoto] = useState<string | null>(null);
  const [viewAllRecords, setViewAllRecords] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);

  // UI Adjustment Preferences
  const [textSize, setTextSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [copiedItemName, setCopiedItemName] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>('date_desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDateStart, setFilterDateStart] = useState('');
  const [filterDateEnd, setFilterDateEnd] = useState('');
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);

  // Batch and Single Rescan States
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<string>>(new Set());
  const [isSingleProcessing, setIsSingleProcessing] = useState(false);
  
  // Batch Progress Overlay states
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgressTotal, setBatchProgressTotal] = useState(0);
  const [batchProgressCurrent, setBatchProgressCurrent] = useState(0);
  const [batchProgressStatus, setBatchProgressStatus] = useState('');

  // Database subscriptions
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  // Period filter states & helpers
  const [periodType, setPeriodType] = useState<'day' | 'week' | 'month' | 'quarter' | 'year'>('month');
  const [periodAnchor, setPeriodAnchor] = useState<Date>(() => new Date());

  const getPeriodLabelAndValue = (anchor: Date, type: 'day' | 'week' | 'month' | 'quarter' | 'year') => {
    const y = anchor.getFullYear();
    const m = String(anchor.getMonth() + 1).padStart(2, '0');
    const d = String(anchor.getDate()).padStart(2, '0');
    
    switch (type) {
      case 'day': {
        const val = `${y}-${m}-${d}`;
        return {
          label: `${y} 年 ${m} 月 ${d} 日`,
          value: val
        };
      }
      case 'week': {
        const day = anchor.getDay();
        const diff = anchor.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(anchor);
        monday.setDate(diff);
        
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        
        const monY = monday.getFullYear();
        const monM = String(monday.getMonth() + 1).padStart(2, '0');
        const monD = String(monday.getDate()).padStart(2, '0');
        
        const sunM = String(sunday.getMonth() + 1).padStart(2, '0');
        const sunD = String(sunday.getDate()).padStart(2, '0');
        
        return {
          label: `${monY} 年 ${monM}/${monD} ~ ${sunM}/${sunD}`,
          value: `${monY}-${monM}-${monD}`
        };
      }
      case 'month': {
        return {
          label: `${y} 年 ${m} 月`,
          value: `${y}-${m}`
        };
      }
      case 'quarter': {
        const q = Math.floor(anchor.getMonth() / 3) + 1;
        return {
          label: `${y} 年 Q${q} 季度`,
          value: `${y}-Q${q}`
        };
      }
      case 'year': {
        return {
          label: `${y} 年`,
          value: `${y}`
        };
      }
    }
  };

  const adjustPeriod = (direction: 'prev' | 'next') => {
    setPeriodAnchor(prev => {
      const nextDate = new Date(prev);
      const delta = direction === 'next' ? 1 : -1;
      
      switch (periodType) {
        case 'day':
          nextDate.setDate(prev.getDate() + delta);
          break;
        case 'week':
          nextDate.setDate(prev.getDate() + delta * 7);
          break;
        case 'month':
          nextDate.setMonth(prev.getMonth() + delta);
          break;
        case 'quarter':
          nextDate.setMonth(prev.getMonth() + delta * 3);
          break;
        case 'year':
          nextDate.setFullYear(prev.getFullYear() + delta);
          break;
      }
      return nextDate;
    });
  };

  const filterTransactionsByPeriod = (allTxs: Transaction[], type: 'day' | 'week' | 'month' | 'quarter' | 'year', value: string): Transaction[] => {
    return allTxs.filter(t => {
      const tDate = new Date(t.date);
      if (isNaN(tDate.getTime())) return false;

      if (type === 'day') {
        return t.date === value;
      }

      if (type === 'week') {
        const start = new Date(value);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(start.getDate() + 7);
        
        const timeVal = tDate.getTime();
        return timeVal >= start.getTime() && timeVal < end.getTime();
      }

      if (type === 'month') {
        return t.date.startsWith(value);
      }

      if (type === 'quarter') {
        const [yearStr, qStr] = value.split('-Q');
        const year = parseInt(yearStr);
        const q = parseInt(qStr);
        const startMonth = (q - 1) * 3;
        const endMonth = startMonth + 3;
        
        const tYear = tDate.getFullYear();
        const tMonth = tDate.getMonth();
        return tYear === year && tMonth >= startMonth && tMonth < endMonth;
      }

      if (type === 'year') {
        return t.date.startsWith(value);
      }

      return false;
    });
  };

  const { label: periodLabel, value: periodValue } = getPeriodLabelAndValue(periodAnchor, periodType);



  // Seed default data on startup
  useEffect(() => {
    seedDefaultData();
    
    // Check local storage for theme preference
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'violet' | 'rose' | 'emerald' | 'slate' | 'charcoal' | 'arctic' | 'golden' | 'cyberpunk' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      applyTheme(savedTheme);
    } else {
      applyTheme('midnight');
    }

    // Check local storage for text size preference
    const savedTextSize = localStorage.getItem('textSize') as 'sm' | 'md' | 'lg' | null;
    if (savedTextSize) {
      setTextSize(savedTextSize);
      applyTextSize(savedTextSize);
    } else {
      applyTextSize('md');
    }

    // PWA shortcut: /?action=add opens the Add Record modal
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'add') {
      setIsAddModalOpen(true);
      window.history.replaceState(null, '', '/');
    }
  }, []);

  const applyTextSize = (size: 'sm' | 'md' | 'lg') => {
    const htmlElement = document.documentElement;
    if (size === 'sm') {
      htmlElement.style.fontSize = '14px';
    } else if (size === 'md') {
      htmlElement.style.fontSize = '16px';
    } else if (size === 'lg') {
      htmlElement.style.fontSize = '18px';
    }
  };

  const applyTheme = (t: 'light' | 'dark' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'violet' | 'rose' | 'emerald' | 'slate' | 'charcoal' | 'arctic' | 'golden' | 'cyberpunk') => {
    if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.removeAttribute('data-theme-mode');
    } else if (t === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.removeAttribute('data-theme-mode');
    } else {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.setAttribute('data-theme-mode', t);
    }
  };

  const handleSetTheme = (t: 'light' | 'dark' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'violet' | 'rose' | 'emerald' | 'slate' | 'charcoal' | 'arctic' | 'golden' | 'cyberpunk') => {
    setTheme(t);
    localStorage.setItem('theme', t);
    applyTheme(t);
  };

  const getThemeColors = (t: string) => {
    const colorMap: Record<string, { textPrimary: string; textSecondary: string; textMuted: string; textBright: string; bgPanel: string; borderColor: string; bgInput: string; accentText: string; hoverBg: string }> = {
      light: { textPrimary: 'text-slate-800', textSecondary: 'text-slate-600', textMuted: 'text-slate-400', textBright: 'text-slate-900', bgPanel: 'bg-white/80', borderColor: 'border-slate-300/30', bgInput: 'bg-white/90', accentText: 'text-indigo-600', hoverBg: 'hover:bg-slate-50', },
      dark: { textPrimary: 'text-gray-200', textSecondary: 'text-gray-300', textMuted: 'text-gray-500', textBright: 'text-white', bgPanel: 'bg-slate-900/60', borderColor: 'border-white/10', bgInput: 'bg-slate-900', accentText: 'text-indigo-400', hoverBg: 'hover:bg-white/5', },
      midnight: { textPrimary: 'text-slate-100', textSecondary: 'text-gray-300', textMuted: 'text-gray-500', textBright: 'text-white', bgPanel: 'bg-slate-900/60', borderColor: 'border-white/10', bgInput: 'bg-slate-900', accentText: 'text-indigo-300', hoverBg: 'hover:bg-white/5', },
      ocean: { textPrimary: 'text-sky-100', textSecondary: 'text-sky-200', textMuted: 'text-blue-400', textBright: 'text-white', bgPanel: 'bg-blue-900/60', borderColor: 'border-cyan-400/20', bgInput: 'bg-blue-950', accentText: 'text-cyan-300', hoverBg: 'hover:bg-cyan-500/10', },
      forest: { textPrimary: 'text-emerald-50', textSecondary: 'text-emerald-100', textMuted: 'text-green-400', textBright: 'text-white', bgPanel: 'bg-green-900/60', borderColor: 'border-emerald-400/20', bgInput: 'bg-green-950', accentText: 'text-emerald-300', hoverBg: 'hover:bg-emerald-500/10', },
      sunset: { textPrimary: 'text-amber-50', textSecondary: 'text-amber-100', textMuted: 'text-orange-400', textBright: 'text-white', bgPanel: 'bg-amber-900/60', borderColor: 'border-orange-400/20', bgInput: 'bg-amber-950', accentText: 'text-orange-300', hoverBg: 'hover:bg-orange-500/10', },
      violet: { textPrimary: 'text-violet-50', textSecondary: 'text-violet-100', textMuted: 'text-purple-400', textBright: 'text-white', bgPanel: 'bg-purple-900/60', borderColor: 'border-violet-400/20', bgInput: 'bg-purple-950', accentText: 'text-violet-300', hoverBg: 'hover:bg-violet-500/10', },
      rose: { textPrimary: 'text-rose-50', textSecondary: 'text-rose-100', textMuted: 'text-pink-400', textBright: 'text-white', bgPanel: 'bg-pink-900/60', borderColor: 'border-rose-400/20', bgInput: 'bg-pink-950', accentText: 'text-rose-300', hoverBg: 'hover:bg-rose-500/10', },
      emerald: { textPrimary: 'text-teal-50', textSecondary: 'text-teal-100', textMuted: 'text-teal-400', textBright: 'text-white', bgPanel: 'bg-teal-900/60', borderColor: 'border-teal-400/20', bgInput: 'bg-teal-950', accentText: 'text-teal-300', hoverBg: 'hover:bg-teal-500/10', },
      slate: { textPrimary: 'text-slate-200', textSecondary: 'text-slate-300', textMuted: 'text-slate-500', textBright: 'text-white', bgPanel: 'bg-gray-900/60', borderColor: 'border-slate-400/20', bgInput: 'bg-slate-900', accentText: 'text-slate-300', hoverBg: 'hover:bg-slate-500/10', },
      charcoal: { textPrimary: 'text-zinc-100', textSecondary: 'text-zinc-200', textMuted: 'text-zinc-500', textBright: 'text-white', bgPanel: 'bg-neutral-900/60', borderColor: 'border-zinc-400/20', bgInput: 'bg-zinc-900', accentText: 'text-zinc-300', hoverBg: 'hover:bg-zinc-500/10', },
      arctic: { textPrimary: 'text-slate-800', textSecondary: 'text-slate-700', textMuted: 'text-slate-400', textBright: 'text-slate-900', bgPanel: 'bg-white/80', borderColor: 'border-blue-300/30', bgInput: 'bg-white/90', accentText: 'text-blue-600', hoverBg: 'hover:bg-blue-50', },
      golden: { textPrimary: 'text-amber-900', textSecondary: 'text-amber-800', textMuted: 'text-amber-500', textBright: 'text-amber-950', bgPanel: 'bg-amber-50/80', borderColor: 'border-amber-300/30', bgInput: 'bg-white/90', accentText: 'text-amber-700', hoverBg: 'hover:bg-amber-100', },
      cyberpunk: { textPrimary: 'text-fuchsia-50', textSecondary: 'text-fuchsia-100', textMuted: 'text-fuchsia-400', textBright: 'text-white', bgPanel: 'bg-slate-950/70', borderColor: 'border-fuchsia-400/20', bgInput: 'bg-fuchsia-950', accentText: 'text-fuchsia-300', hoverBg: 'hover:bg-fuchsia-500/10', },
    };
    return colorMap[t] || colorMap.midnight;
  };

  const handleSetTextSize = (size: 'sm' | 'md' | 'lg') => {
    setTextSize(size);
    localStorage.setItem('textSize', size);
    applyTextSize(size);
  };

  const handleCopyItemName = (name: string) => {
    navigator.clipboard.writeText(name)
      .then(() => {
        setCopiedItemName(name);
        setTimeout(() => {
          setCopiedItemName(null);
        }, 1500);
      })
      .catch((err) => {
        console.error('Failed to copy text: ', err);
      });
  };

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


  const handleZoomIn = () => {
    setZoomScale(prev => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoomScale(prev => {
      const next = Math.max(prev - 0.25, 1);
      if (next === 1) {
        setPanOffset({ x: 0, y: 0 });
      }
      return next;
    });
  };

  const handleZoomReset = () => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Scroll up (deltaY < 0) zooms in, scroll down zooms out
    const zoomFactor = 0.1;
    const delta = e.deltaY < 0 ? 1 : -1;
    setZoomScale(prev => {
      const next = Math.max(1, Math.min(prev + delta * zoomFactor, 3));
      if (next === 1) {
        setPanOffset({ x: 0, y: 0 });
      }
      return next;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomScale <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoomScale <= 1) return;
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (zoomScale <= 1 || e.touches.length !== 1) return;
    setIsDragging(true);
    const touch = e.touches[0];
    setDragStart({ x: touch.clientX - panOffset.x, y: touch.clientY - panOffset.y });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || zoomScale <= 1 || e.touches.length !== 1) return;
    const touch = e.touches[0];
    setPanOffset({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  // Reset zoom states when lightbox closed
  useEffect(() => {
    if (!lightboxPhoto) {
      setZoomScale(1);
      setPanOffset({ x: 0, y: 0 });
      setIsDragging(false);
    }
  }, [lightboxPhoto]);

  const handleRotatePhoto = async () => {
    if (!selectedTransaction?.photoId || !transactionPhoto) return;
    setIsRotating(true);
    try {
      console.log(`正在手動將單據影像轉正 (旋轉 90 度)...`);
      const rotatedUrl = await rotateBase64Image(transactionPhoto, 90);
      
      // Update IndexedDB photo entry
      await db.photos.update(selectedTransaction.photoId, { dataUrl: rotatedUrl });
      
      // Update local preview state
      setTransactionPhoto(rotatedUrl);
      console.log(`手動旋轉影像並更新資料庫成功！`);
    } catch (err) {
      console.error('手動旋轉單據失敗:', err);
      alert('單據旋轉失敗，請重試。若持續失敗，請手動上傳正向照片。');
    } finally {
      setIsRotating(false);
    }
  };

  const performOcrRescan = async (tx: Transaction, engine: 'gemini' | 'local'): Promise<void> => {
    if (!tx.photoId) return;

    // 1. Fetch photo data from db
    const photo = await db.photos.get(tx.photoId);
    if (!photo) {
      throw new Error(`未找到單據照片資料`);
    }

    const photoDataUrl = photo.dataUrl;
    const photoMimeType = photoDataUrl.split(';')[0].split(':')[1] || 'image/jpeg';

    // 2. Perform scanning using the selected engine
    let result: GeminiScanResult;
    if (engine === 'gemini') {
      result = await scanReceiptWithGemini(photoDataUrl, photoMimeType);
    } else {
      result = await scanReceiptLocally(photoDataUrl);
    }

    // 3. Process the scanned result
    const evaluatedAmount = result.convertedTotalAmountTWD;
    if (!evaluatedAmount || isNaN(evaluatedAmount) || evaluatedAmount <= 0) {
      throw new Error('無法自辨識結果取得有效金額（0 或缺失），請手動編輯此筆交易。');
    }
    
    // Rotate photo if Gemini says so
    let updatedPhotoDataUrl = photoDataUrl;
    if (result.rotationNeeded && result.rotationNeeded !== 0) {
      try {
        console.log(`影像自動轉正 (${result.rotationNeeded} 度)...`);
        updatedPhotoDataUrl = await rotateBase64Image(photoDataUrl, result.rotationNeeded);
      } catch (rotErr) {
        console.error('轉正失敗:', rotErr);
      }
    }

    // 4. Update balance on accounts
    const accountObj = accounts.find(a => a.id === tx.account) || accounts[0];
    if (!accountObj) {
      throw new Error('未找到交易關聯的帳戶');
    }

    // Determine target account based on identified payment method
    let targetAccountId = tx.account;
    if (result.paymentMethod) {
      const pMethod = result.paymentMethod.toLowerCase();
      let targetAccountType: 'cash' | 'credit_card' | 'bank_account' | null = null;
      if (pMethod.includes('現金')) {
        targetAccountType = 'cash';
      } else if (pMethod.includes('信用卡') || pMethod.includes('visa') || pMethod.includes('master') || pMethod.includes('line pay') || pMethod.includes('pay')) {
        targetAccountType = 'credit_card';
      } else if (pMethod.includes('轉帳') || pMethod.includes('銀行') || pMethod.includes('匯款')) {
        targetAccountType = 'bank_account';
      }

      if (targetAccountType) {
        const matchedAccount = accounts.find(a => a.type === targetAccountType);
        if (matchedAccount) {
          targetAccountId = matchedAccount.id;
        }
      }
    }

    // Category mapping
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
    const targetCatId = catMap[result.category] || 'cat_others_exp';

    // Map items
    const transactionItems = result.items.map(item => ({
      name: item.translatedName || item.originalName,
      qty: item.quantity,
      price: item.convertedUnitPriceTWD,
      total: item.convertedTotalPriceTWD,
      originalPrice: item.originalUnitPrice,
      originalTotal: item.originalTotalPrice
    })) || [];

    // Dexie Transaction to update DB Atomically
    await db.transaction('rw', [db.transactions, db.accounts, db.photos], async () => {
      // Revert old transaction balance diff
      const oldAcc = await db.accounts.get(tx.account);
      if (oldAcc) {
        const oldRevert = tx.type === 'expense' ? tx.amount : -tx.amount;
        await db.accounts.update(tx.account, { balance: oldAcc.balance + oldRevert });
      }

      // Add new transaction balance diff
      const currentAcc = await db.accounts.get(targetAccountId);
      if (currentAcc) {
        const newDiff = tx.type === 'expense' ? -evaluatedAmount : evaluatedAmount;
        await db.accounts.update(targetAccountId, { balance: currentAcc.balance + newDiff });
      }

      // Update photo data URL if rotated
      if (updatedPhotoDataUrl !== photoDataUrl) {
        await db.photos.update(tx.photoId!, { dataUrl: updatedPhotoDataUrl });
      }

      // Update transaction metadata
      await db.transactions.update(tx.id, {
        date: result.date,
        time: result.time || '00:00',
        amount: evaluatedAmount,
        originalAmount: result.originalTotalAmount,
        originalCurrency: result.originalCurrency,
        exchangeRate: result.exchangeRateUsed,
        rateExplanation: result.exchangeRateExplanation,
        category: targetCatId,
        account: targetAccountId,
        note: `[${result.merchant}] ` + (result.exchangeRateExplanation || ''),
        items: transactionItems.length > 0 ? transactionItems : undefined
      });
    });
  };

  const handleSingleRescan = async (tx: Transaction) => {
    if (!tx.photoId) return;
    if (!confirm('確定要依據目前儲存的單據影像重新辨識此筆交易嗎？此動作將覆蓋商家、金額、分類、明細與日期時間。')) return;
    
    setIsSingleProcessing(true);
    const engine = (localStorage.getItem('ocrEngine') as 'gemini' | 'local') || 'gemini';
    
    try {
      await performOcrRescan(tx, engine);
      alert('單據重新辨識並更新成功！');
      
      // Update selectedTransaction preview state to show new changes
      const updatedTx = await db.transactions.get(tx.id);
      if (updatedTx) {
        setSelectedTransaction(updatedTx);
      }
    } catch (err: any) {
      console.error('重新辨識失敗:', err);
      alert(`單據重新辨識失敗：${err.message || err}。請稍後重試，或改用其他辨識引擎。`);
    } finally {
      setIsSingleProcessing(false);
    }
  };

  const handleBatchRescan = async () => {
    // Filter selected transactions to only those with photos
    const selectedTxs = transactions.filter(t => selectedTransactionIds.has(t.id) && t.photoId);
    
    if (selectedTxs.length === 0) {
      alert('請先選擇至少一筆附有單據影像的交易。');
      return;
    }
    
    if (!confirm(`確定要批次重新辨識已選擇的 ${selectedTxs.length} 筆單據嗎？此動作會以目前儲存的照片重新辨識並覆蓋商家、金額、分類、明細與日期時間。`)) {
      return;
    }

    setIsBatchProcessing(true);
    setBatchProgressTotal(selectedTxs.length);
    setBatchProgressCurrent(0);
    setBatchProgressStatus('初始化批次重新辨識中...');
    
    const engine = (localStorage.getItem('ocrEngine') as 'gemini' | 'local') || 'gemini';
    const failedIds: string[] = [];

    for (let i = 0; i < selectedTxs.length; i++) {
      const tx = selectedTxs[i];
      setBatchProgressCurrent(i + 1);
      setBatchProgressStatus(`正在辨識第 ${i + 1}/${selectedTxs.length} 筆交易...`);
      
      try {
        await performOcrRescan(tx, engine);
      } catch (err) {
        console.error(`批次辨識交易 ${tx.id} 失敗:`, err);
        failedIds.push(tx.id);
      }
    }
    
    setIsBatchProcessing(false);
    setIsSelectionMode(false);
    setSelectedTransactionIds(new Set());
    
    // If selectedTransaction is one of updated, refresh it
    if (selectedTransaction) {
      const refreshed = await db.transactions.get(selectedTransaction.id);
      setSelectedTransaction(refreshed || null);
    }
    
    if (failedIds.length > 0) {
      alert(`批次辨識完成：成功 ${selectedTxs.length - failedIds.length} 筆，失敗 ${failedIds.length} 筆。失敗的交易請手動編輯或重試。`);
    } else {
      alert(`批次辨識完成：${selectedTxs.length} 筆單據已重新辨識並更新。`);
    }
  };

  const toggleSelectTransaction = (id: string) => {
    setSelectedTransactionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedWithPhotosCount = Array.from(selectedTransactionIds).filter(id => {
    const tx = transactions.find(t => t.id === id);
    return tx && tx.photoId;
  }).length;
  // Fetch photo for transaction detail view
  useEffect(() => {
    if (selectedTransaction?.photoId) {
      db.photos.get(selectedTransaction.photoId).then(photo => {
        setTransactionPhoto(photo?.dataUrl || null);
      });
    } else {
      setTransactionPhoto(null);
    }
  }, [selectedTransaction]);

  const handleDeleteTransaction = async (tx: Transaction) => {
    const confirmMsg = tx.type === 'transfer'
      ? '確定要刪除這筆轉帳記錄嗎？（轉帳僅移動兩個帳戶餘額，刪除後不會回沖）'
      : '確定要刪除這筆交易記錄嗎？此動作將會恢復帳戶餘額。';
    if (!confirm(confirmMsg)) return;

    const accountObj = accounts.find(a => a.id === tx.account);
    
    await db.transaction('rw', [db.transactions, db.accounts, db.photos], async () => {
      // 1. Restore account balance (skip for transfers: they already moved balance without a journal-style amount)
      if (tx.type !== 'transfer' && accountObj) {
        const balanceDiff = tx.type === 'expense' ? tx.amount : -tx.amount;
        await db.accounts.update(tx.account, {
          balance: accountObj.balance + balanceDiff
        });
      }

      // 2. Delete photo if exists
      if (tx.photoId) {
        await db.photos.delete(tx.photoId);
      }

      // 3. Delete transaction record
      await db.transactions.delete(tx.id);
    });

    setSelectedTransaction(null);
    setHighlightedTransactionId(null);
  };

  const handleOpenAddModal = () => {
    setEditingTransactionId(undefined);
    setIsAddModalOpen(true);
  };

  const handleOpenEditModal = (tx: Transaction) => {
    setEditingTransactionId(tx.id);
    setIsAddModalOpen(true);
    setSelectedTransaction(null); // Close detail panel
  };

  // Group and filter transactions by active period (day, week, month, quarter, year) and sort based on selection
  const baseMonthlyTransactions = filterTransactionsByPeriod(transactions, periodType, periodValue);
  
  const filteredMonthlyTransactions = baseMonthlyTransactions.filter(t => {
    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const catObj = categories.find(c => c.id === t.category || c.name === t.category);
      const accObj = accounts.find(a => a.id === t.account);
      
      let matches = false;
      
      // Match category name
      if (catObj && catObj.name.toLowerCase().includes(q)) matches = true;
      // Match account name
      if (accObj && accObj.name.toLowerCase().includes(q)) matches = true;
      // Match note
      if (t.note && t.note.toLowerCase().includes(q)) matches = true;
      // Match items
      if (t.items && t.items.some(item => item.name.toLowerCase().includes(q))) matches = true;
      // Match amount
      if (String(t.amount).includes(q)) matches = true;
      // Match date
      if (t.date.includes(q)) matches = true;
      // Match merchant (from note prefix)
      if (t.note && t.note.startsWith('[') && t.note.toLowerCase().includes(q)) matches = true;
      
      if (!matches) return false;
    }
    
    // Date range filter
    if (filterDateStart) {
      if (t.date < filterDateStart) return false;
    }
    if (filterDateEnd) {
      if (t.date > filterDateEnd) return false;
    }
    
    return true;
  });
  
  const monthlyTransactions = filteredMonthlyTransactions
    .sort((a, b) => {
      if (sortBy === 'date_desc') {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        const timeCompare = (b.time || '00:00').localeCompare(a.time || '00:00');
        if (timeCompare !== 0) return timeCompare;
        return b.createdAt - a.createdAt;
      }
      if (sortBy === 'date_asc') {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        const timeCompare = (a.time || '00:00').localeCompare(b.time || '00:00');
        if (timeCompare !== 0) return timeCompare;
        return a.createdAt - b.createdAt;
      }
      if (sortBy === 'amount_desc') {
        return b.amount - a.amount;
      }
      if (sortBy === 'amount_asc') {
        return a.amount - b.amount;
      }
      return 0;
    });

  const totalExpense = monthlyTransactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalIncome = monthlyTransactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const isAllSelected = monthlyTransactions.length > 0 && 
    monthlyTransactions.every(t => selectedTransactionIds.has(t.id));

  const handleSelectAllVisible = () => {
    if (isAllSelected) {
      // Deselect all for this month
      setSelectedTransactionIds(prev => {
        const next = new Set(prev);
        monthlyTransactions.forEach(t => next.delete(t.id));
        return next;
      });
    } else {
      // Select all for this month
      setSelectedTransactionIds(prev => {
        const next = new Set(prev);
        monthlyTransactions.forEach(t => next.add(t.id));
        return next;
      });
    }
  };


  // Calculate Net Worth from accounts table
  const totalAssets = accounts.reduce((sum, acc) => sum + (acc.balance >= 0 ? acc.balance : 0), 0);
  const totalLiabilities = accounts.reduce((sum, acc) => sum + (acc.balance < 0 ? Math.abs(acc.balance) : 0), 0);
  const totalNetAssets = totalAssets - totalLiabilities;

  // Group transactions by Date for full list
  const groupedTransactions: { [date: string]: Transaction[] } = {};
  const listTransactions = viewAllRecords ? monthlyTransactions : monthlyTransactions.slice(0, 5);

  listTransactions.forEach(t => {
    if (!groupedTransactions[t.date]) {
      groupedTransactions[t.date] = [];
    }
    groupedTransactions[t.date].push(t);
  });

  const sortedDates = Object.keys(groupedTransactions).sort((a, b) => b.localeCompare(a));



  // Category Doughnut Chart calculation for Dashboard
  const categoryTotals: { [key: string]: number } = {};
  const currentMonthExpenses = monthlyTransactions.filter(t => t.type === 'expense');

  currentMonthExpenses.forEach(t => {
    const catObj = categories.find(c => c.id === t.category || c.name === t.category);
    const catName = catObj ? catObj.name : t.category;
    categoryTotals[catName] = (categoryTotals[catName] || 0) + t.amount;
  });

  const dashboardChartCategories = Object.entries(categoryTotals)
    .map(([name, amount]) => {
      const catObj = categories.find(c => c.name === name);
      return {
        name,
        amount,
        color: catObj?.color || '#b2bec3',
        percentage: currentMonthExpenses.reduce((sum, t) => sum + t.amount, 0) > 0
          ? (amount / currentMonthExpenses.reduce((sum, t) => sum + t.amount, 0)) * 100
          : 0
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const dashboardChartData = {
    labels: dashboardChartCategories.map(c => c.name),
    datasets: [
      {
        data: dashboardChartCategories.map(c => c.amount),
        backgroundColor: dashboardChartCategories.map(c => c.color),
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
      },
    ],
  };

  const dashboardChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          color: '#b2bec3',
          font: { family: 'Noto Sans TC', size: 10 },
          boxWidth: 10
        }
      }
    }
  };

  const tc = getThemeColors(theme);

  return (
    <div className={`min-h-screen flex flex-col md:flex-row pb-20 md:pb-0 ${tc.hoverBg}`} style={{ background: 'var(--bg-gradient)', backgroundAttachment: 'fixed' }}>
      {/* Desktop Sidebar Navigation */}
      <aside className={`hidden md:flex w-72 glass-panel p-6 flex-col justify-between h-[calc(100vh-32px)] sticky top-4 m-4 z-40 ${tc.borderColor}`}>
        <div className="space-y-8">
          {/* Logo / App Name */}
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Camera size={22} className="text-white" />
            </div>
            <div>
              <h1 className="font-extrabold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 to-violet-400">
                AI 拍照記帳
              </h1>
              <span className={`text-[10px] ${tc.textMuted} uppercase tracking-widest font-semibold`}>OCR Smart Bookkeeping</span>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="space-y-2">
            {[
              { id: 'dashboard', label: '首頁看板', icon: <HomeIcon size={18} /> },
              { id: 'statistics', label: '統計分析', icon: <TrendingUp size={18} /> },
              { id: 'accounts', label: '帳戶資產', icon: <Wallet size={18} /> },
              { id: 'prizes', label: '發票對獎', icon: <Gift size={18} /> },
              { id: 'settings', label: '系統設定', icon: <SettingsIcon size={18} /> },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as any);
                  setSelectedTransaction(null);
                  setHighlightedTransactionId(null);
                }}
                className={`w-full py-3.5 px-4 rounded-xl flex items-center gap-3 font-semibold text-sm transition-all ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                    : `${tc.textMuted} ${tc.hoverBg}`
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className={`space-y-4 pt-6 border-t ${tc.borderColor}`}>
          <div className="flex justify-between items-center px-2">
            <span className={`text-xs ${tc.textMuted}`}>外觀風格</span>
            <button
              onClick={() => setShowThemePicker(!showThemePicker)}
              className={`w-8 h-8 rounded-lg ${tc.hoverBg} flex items-center justify-center ${tc.textSecondary} ${tc.textBright}`}
            >
              <Sun size={16} />
            </button>
          </div>
          {showThemePicker && (
            <div className={`p-3 rounded-xl ${tc.hoverBg} border ${tc.borderColor} space-y-2 animate-scale-in`}>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'light', label: '淺色', color: 'from-slate-200 to-slate-300' },
                  { id: 'dark', label: '深色', color: 'from-slate-800 to-slate-950' },
                  { id: 'midnight', label: '午夜', color: 'from-indigo-900 to-slate-900' },
                  { id: 'ocean', label: '深海', color: 'from-cyan-900 to-blue-900' },
                  { id: 'forest', label: '森林', color: 'from-emerald-900 to-green-900' },
                  { id: 'sunset', label: '日落', color: 'from-orange-900 to-amber-900' },
                  { id: 'violet', label: '紫羅蘭', color: 'from-violet-900 to-purple-900' },
                  { id: 'rose', label: '玫瑰', color: 'from-rose-900 to-pink-900' },
                  { id: 'emerald', label: '翡翠', color: 'from-teal-900 to-emerald-900' },
                  { id: 'slate', label: '板岩', color: 'from-slate-900 to-gray-900' },
                  { id: 'charcoal', label: '炭灰', color: 'from-zinc-900 to-neutral-900' },
                  { id: 'arctic', label: '北極', color: 'from-sky-50 to-blue-100' },
                  { id: 'golden', label: '金色', color: 'from-yellow-50 to-amber-100' },
                  { id: 'cyberpunk', label: '賽博龐克', color: 'from-fuchsia-950 to-slate-950' },
                ].map(th => (
                  <button
                    key={th.id}
                    onClick={() => handleSetTheme(th.id as any)}
                    className={`h-8 rounded-lg bg-gradient-to-br ${th.color} border transition-all ${
                      theme === th.id ? 'border-white ring-2 ring-white/30 scale-105' : 'border-white/10 hover:border-white/30'
                    }`}
                    title={th.label}
                  >
                    {theme === th.id && <Check size={12} className="text-white mx-auto" />}
                  </button>
                ))}
              </div>
              <div className={`text-[9px] ${tc.textMuted} text-center`}>
                目前：{[
                  { id: 'light', label: '淺色明亮' },
                  { id: 'dark', label: '深色極客' },
                  { id: 'midnight', label: '午夜幽靈' },
                  { id: 'ocean', label: '深海藍調' },
                  { id: 'forest', label: '翠林秘境' },
                  { id: 'sunset', label: '夕陽餘暉' },
                  { id: 'violet', label: '紫羅蘭夢' },
                  { id: 'rose', label: '玫瑰園' },
                  { id: 'emerald', label: '翡翠森林' },
                  { id: 'slate', label: '板岩質感' },
                  { id: 'charcoal', label: '炭灰沉穩' },
                  { id: 'arctic', label: '北極冰雪' },
                  { id: 'golden', label: '金色輝煌' },
                  { id: 'cyberpunk', label: '賽博龐克' },
                ].find(t => t.id === theme)?.label}
              </div>
            </div>
          )}
          <div className={`text-[10px] ${tc.textMuted} text-center`}>
            AI 拍照記帳 © 2026
          </div>
        </div>
      </aside>

      {/* Mobile Sticky Bottom Tab Bar */}
      <nav className={`md:hidden fixed bottom-0 left-0 right-0 h-16 ${tc.bgPanel} backdrop-blur-lg border-t ${tc.borderColor} z-40 flex justify-around items-center px-2`}>
        {[
          { id: 'dashboard', label: '首頁', icon: <HomeIcon size={20} /> },
          { id: 'statistics', label: '分析', icon: <TrendingUp size={20} /> },
          { id: 'accounts', label: '帳戶', icon: <Wallet size={20} /> },
          { id: 'prizes', label: '對獎', icon: <Gift size={20} /> },
          { id: 'settings', label: '設定', icon: <SettingsIcon size={20} /> },
        ].map(tab => (
          <button
            key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as any);
                setSelectedTransaction(null);
                setHighlightedTransactionId(null);
              }}
            className={`flex flex-col items-center justify-center flex-1 py-1 text-xs gap-1 font-semibold ${
              activeTab === tab.id ? tc.accentText : tc.textMuted
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Global "+ 記帳" Floating Action Button (FAB) */}
      <button
        onClick={handleOpenAddModal}
        className="fixed bottom-20 right-6 md:bottom-8 md:right-8 w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-xl shadow-indigo-500/30 z-40 hover:scale-110 active:scale-95 transition-all animate-bounce"
        style={{ animationDuration: '3s' }}
        title="快速記帳"
      >
        <Plus size={28} />
      </button>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-6 space-y-6 max-h-screen">
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-slide-up">
            {/* Period selector */}
            <div className="glass-panel p-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
              <div className="flex items-center justify-between w-full lg:w-auto gap-4">
                <div className="flex items-center gap-2">
                  <Calendar size={18} className="text-indigo-400" />
                  <span className="text-sm font-bold text-gray-200 font-sans">收支時間區間篩選</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCarrierImport(true)}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 font-sans shadow shadow-indigo-500/10 hover:scale-[1.02] active:scale-95 shrink-0"
                >
                  <Download size={13} />
                  匯入發票（載具 / CSV）
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center w-full lg:w-auto">
                {/* Period Type Segmented Picker */}
                <div className="flex bg-white/5 p-0.5 rounded-lg border border-white/5 justify-between">
                  {(['day', 'week', 'month', 'quarter', 'year'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setPeriodType(type)}
                      className={`text-[11px] sm:text-xs px-3 py-1.5 rounded-md font-bold transition-all flex-1 sm:flex-initial text-center ${
                        periodType === type
                          ? 'bg-indigo-600 text-white shadow'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {type === 'day' ? '日' : type === 'week' ? '週' : type === 'month' ? '月' : type === 'quarter' ? '季' : '年'}
                    </button>
                  ))}
                </div>

                {/* Period Selector (Prev, Label, Next) */}
                <div className="flex items-center justify-between sm:justify-start gap-3 bg-white/5 py-1.5 px-3 rounded-lg border border-white/5">
                  <button
                    onClick={() => adjustPeriod('prev')}
                    className="text-gray-400 hover:text-white p-1 hover:bg-white/5 rounded transition-all"
                    title="上一個區間"
                  >
                    <LucideIcon name="ChevronLeft" size={14} />
                  </button>
                  <span className="text-xs font-bold text-gray-200 min-w-[130px] text-center select-none font-mono">
                    {periodLabel}
                  </span>
                  <button
                    onClick={() => adjustPeriod('next')}
                    className="text-gray-400 hover:text-white p-1 hover:bg-white/5 rounded transition-all"
                    title="下一個區間"
                  >
                    <LucideIcon name="ChevronRight" size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Upper: Asset dashboard scoreboard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Expense (Color psychology: Soft red reminding user of expense) */}
              <div className="glass-panel p-4 text-center relative overflow-hidden group border border-rose-500/10 hover:border-rose-500/20 transition-all">
                <span className="text-[11px] font-bold text-rose-300 tracking-wider uppercase block mb-1">期間總支出</span>
                <span className="text-3xl font-black text-rose-400">${totalExpense.toLocaleString()}</span>
                <div className="absolute -right-3 -bottom-3 w-8 h-8 rounded-full bg-rose-500/5 group-hover:scale-150 transition-all duration-300 animate-pulse" />
              </div>

              {/* Income (Color psychology: Stable blue/emerald representing income growth) */}
              <div className="glass-panel p-4 text-center relative overflow-hidden group border border-emerald-500/10 hover:border-emerald-500/20 transition-all">
                <span className="text-[11px] font-bold text-emerald-300 tracking-wider uppercase block mb-1">期間總收入</span>
                <span className="text-3xl font-black text-emerald-400">${totalIncome.toLocaleString()}</span>
                <div className="absolute -right-3 -bottom-3 w-8 h-8 rounded-full bg-emerald-500/5 group-hover:scale-150 transition-all duration-300 animate-pulse" />
              </div>

              {/* Net Assets (Visualized calculated asset amount) */}
              <div className="glass-panel p-4 text-center relative overflow-hidden group border border-indigo-500/10 hover:border-indigo-500/20 transition-all">
                <span className="text-[11px] font-bold text-indigo-300 tracking-wider uppercase block mb-1">目前總資產</span>
                <span className={`text-3xl font-black ${totalNetAssets >= 0 ? 'text-indigo-400' : 'text-rose-400'}`}>
                  ${totalNetAssets.toLocaleString()}
                </span>
                <div className="absolute -right-3 -bottom-3 w-8 h-8 rounded-full bg-indigo-500/5 group-hover:scale-150 transition-all duration-300 animate-pulse" />
              </div>
            </div>

            {/* Middle: Category ratios Doughnut chart */}
            {currentMonthExpenses.length > 0 && (
              <div className="glass-panel p-5 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <div className="h-[180px] relative">
                  <Doughnut data={dashboardChartData} options={dashboardChartOptions} />
                </div>
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">期間支出排名前三</h3>
                  <div className="space-y-2">
                    {dashboardChartCategories.slice(0, 3).map(cat => (
                      <div key={cat.name} className="flex justify-between items-center text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: cat.color }} />
                          <span className="font-semibold text-gray-300">{cat.name}</span>
                        </div>
                        <span className="text-white font-bold">${cat.amount.toLocaleString()} ({cat.percentage.toFixed(1)}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Lower Layout: Recent transactions (3-5 items) and Details slide panel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
              <div className="lg:col-span-2 space-y-4 h-full overflow-y-auto">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                    {viewAllRecords ? `所有明細（${periodLabel}）` : `近期流水帳（${periodLabel}，最近 5 筆）`}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Search Input */}
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="搜尋品名、金額、商家..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="glass-input text-[11px] py-1.5 pl-7 pr-2.5 w-40 border border-white/5 rounded-lg font-bold focus:outline-none focus:border-indigo-500/30 transition-all placeholder:text-gray-600"
                      />
                      <LucideIcon name="Search" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        >
                          <LucideIcon name="X" size={10} />
                        </button>
                      )}
                    </div>
                    
                    {/* Advanced Filter Toggle */}
                    <button
                      onClick={() => setShowAdvancedFilter(!showAdvancedFilter)}
                      className={`text-xs flex items-center gap-1 font-bold px-2 py-1.5 rounded-lg border transition-all ${
                        showAdvancedFilter || filterDateStart || filterDateEnd
                          ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30'
                          : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10'
                      }`}
                    >
                      <LucideIcon name="Filter" size={11} />
                      <span>篩選</span>
                    </button>
                    
                    {/* Sort Selector */}
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="glass-input text-[11px] py-1 px-2.5 border border-white/5 rounded-lg font-bold focus:outline-none cursor-pointer hover:bg-white/5"
                    >
                      <option value="date_desc">時間由新到舊</option>
                      <option value="date_asc">時間由舊到新</option>
                      <option value="amount_desc">金額由高到低</option>
                      <option value="amount_asc">金額由低到高</option>
                    </select>

                    <button
                      onClick={() => {
                        setIsSelectionMode(!isSelectionMode);
                        setSelectedTransactionIds(new Set());
                      }}
                      className={`text-xs flex items-center gap-1 font-bold px-2.5 py-1 rounded-lg border transition-all ${
                        isSelectionMode 
                          ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30' 
                          : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10'
                      }`}
                      title="開啟批次選擇以重新辨識多張單據"
                    >
                      <LucideIcon name="CheckSquare" size={12} />
                      <span>{isSelectionMode ? '退出選擇' : '選擇模式'}</span>
                    </button>
                    <button
                      onClick={() => setViewAllRecords(!viewAllRecords)}
                      className="text-xs text-indigo-400 hover:underline flex items-center font-bold"
                    >
                      {viewAllRecords ? '只看近期' : '查看完整明細'} <ChevronRight size={14} />
                    </button>
                  </div>
                </div>

                {/* Advanced Filter Panel */}
                {showAdvancedFilter && (
                  <div className="glass-panel p-3 flex flex-col sm:flex-row gap-3 items-center text-xs border border-indigo-500/20 animate-scale-in">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 font-bold">日期範圍：</span>
                      <input
                        type="date"
                        value={filterDateStart}
                        onChange={(e) => setFilterDateStart(e.target.value)}
                        className="glass-input text-[11px] py-1 px-2 border border-white/5 rounded-lg font-bold focus:outline-none"
                      />
                      <span className="text-gray-500">至</span>
                      <input
                        type="date"
                        value={filterDateEnd}
                        onChange={(e) => setFilterDateEnd(e.target.value)}
                        className="glass-input text-[11px] py-1 px-2 border border-white/5 rounded-lg font-bold focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                      {(filterDateStart || filterDateEnd || searchQuery) && (
                        <button
                          onClick={() => {
                            setFilterDateStart('');
                            setFilterDateEnd('');
                            setSearchQuery('');
                          }}
                          className="text-[10px] text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded transition-all font-semibold"
                        >
                          清除篩選
                        </button>
                      )}
                      <span className="text-gray-500">|</span>
                      <span className="text-indigo-300 font-bold">
                        符合 {filteredMonthlyTransactions.length} 筆
                      </span>
                    </div>
                  </div>
                )}

                {sortedDates.length === 0 ? (
                  <div className="glass-panel p-12 text-center text-gray-500 flex flex-col items-center justify-center gap-3">
                    <Info size={36} className="text-indigo-400/50 animate-pulse" />
                    <div>
                      {searchQuery || filterDateStart || filterDateEnd ? (
                        <>
                          <p className="font-semibold text-gray-300">找不到符合條件的交易</p>
                          <p className="text-xs text-gray-500 mt-1">請嘗試調整搜尋條件或日期範圍</p>
                        </>
                      ) : (
                        <>
                          <p className="font-semibold text-gray-300">此期間尚無任何交易明細</p>
                          <p className="text-xs text-gray-500 mt-1">點擊右下角「+」按鈕開始快速記帳或單據掃描！</p>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {isSelectionMode && (
                      <div className="glass-panel p-3.5 flex justify-between items-center text-xs border border-indigo-500/20 animate-scale-in mb-3">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-indigo-300">已選擇：{selectedTransactionIds.size} 筆</span>
                          <button
                            onClick={handleSelectAllVisible}
                            className="text-[10px] text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded transition-all font-semibold"
                          >
                            {isAllSelected ? '取消全選' : '全選此月份'}
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleBatchRescan}
                            disabled={selectedWithPhotosCount === 0 || isBatchProcessing}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/40 disabled:text-gray-500 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all text-xs"
                          >
                            {isBatchProcessing ? (
                              <LucideIcon name="Loader2" size={12} className="animate-spin" />
                            ) : (
                              <LucideIcon name="RefreshCw" size={12} />
                            )}
                            批次重新辨識 ({selectedWithPhotosCount})
                          </button>
                        </div>
                      </div>
                    )}
                    {sortBy.startsWith('date') ? (
                      // Grouped by Date Layout
                      sortedDates.map(dateStr => {
                        const txList = groupedTransactions[dateStr];
                        const [, m, d] = dateStr.split('-');

                        return (
                          <div key={dateStr} className="glass-panel overflow-hidden border border-white/5 hover:border-indigo-500/10 transition-all">
                            {/* Day Header */}
                            <div className="bg-white/5 py-2 px-4 flex justify-between items-center text-[10px] border-b border-white/5 text-gray-400">
                              <span className="font-bold text-gray-300">{`${m} 月 ${d} 日`}</span>
                            </div>

                            {/* List */}
                            <div className="divide-y divide-white/5">
                              {txList.map(tx => {
                                const catObj = categories.find(c => c.id === tx.category || c.name === tx.category);
                                const accObj = accounts.find(a => a.id === tx.account);
                                const isSelected = selectedTransactionIds.has(tx.id);

                                return (
                                   <div
                                     key={tx.id}
                                     onClick={() => {
                                       if (isSelectionMode) {
                                         toggleSelectTransaction(tx.id);
                                       } else {
                                         setSelectedTransaction(tx);
                                         setHighlightedTransactionId(tx.id);
                                       }
                                     }}
                                     className={`p-3 flex justify-between items-center hover:bg-white/5 transition-all cursor-pointer group ${
                                       highlightedTransactionId === tx.id && !isSelectionMode
                                         ? 'bg-indigo-500/20 border-l-2 border-indigo-500'
                                         : isSelected ? 'bg-indigo-500/10 border-l-2 border-indigo-500' : ''
                                     }`}
                                   >
                                    <div className="flex items-center gap-3">
                                      {isSelectionMode && (
                                        <div 
                                          className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                            isSelected 
                                              ? 'border-indigo-500 bg-indigo-500 text-white' 
                                              : 'border-white/20'
                                          }`}
                                        >
                                          {isSelected && (
                                            <div className="w-1.5 h-1.5 rounded-sm bg-white" />
                                          )}
                                        </div>
                                      )}
                                      {/* Icon */}
                                      <div
                                        className="w-9 h-9 rounded-xl flex items-center justify-center shadow-inner"
                                        style={{ backgroundColor: `${catObj?.color || '#b2bec3'}20` }}
                                      >
                                        <LucideIcon
                                          name={catObj?.icon || 'Tag'}
                                          size={18}
                                          style={{ color: catObj?.color || '#b2bec3' }}
                                        />
                                      </div>
                                      <div>
                                        <h4 className="font-bold text-sm text-gray-200">
                                          {catObj ? catObj.name : tx.category}
                                        </h4>
                                        <div className="flex items-center gap-2 mt-0.5">
                                          <span className="text-[9px] text-gray-500 bg-white/5 px-1 py-0.2 rounded">
                                            {accObj ? accObj.name : '帳戶'}
                                          </span>
                                          <span className="text-[9px] text-indigo-400 bg-indigo-500/10 px-1 py-0.2 rounded font-semibold">
                                            {tx.time || '00:00'}
                                          </span>
                                          {tx.note && (
                                            <span className="text-xs text-gray-500 truncate max-w-[150px]">{tx.note}</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                      {tx.photoId && <Camera size={13} className="text-indigo-400" />}
                                      <span className={`font-bold text-sm ${
                                        tx.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'
                                      }`}>
                                        {tx.type === 'expense' ? '-' : '+'}${tx.amount}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      // Flat Sorted List Layout
                      <div className="glass-panel overflow-hidden border border-white/5 divide-y divide-white/5">
                        {listTransactions.map(tx => {
                          const catObj = categories.find(c => c.id === tx.category || c.name === tx.category);
                          const accObj = accounts.find(a => a.id === tx.account);
                          const isSelected = selectedTransactionIds.has(tx.id);

                            return (
                              <div
                                key={tx.id}
                                onClick={() => {
                                  if (isSelectionMode) {
                                    toggleSelectTransaction(tx.id);
                                  } else {
                                    setSelectedTransaction(tx);
                                    setHighlightedTransactionId(tx.id);
                                  }
                                }}
                                className={`p-3 flex justify-between items-center hover:bg-white/5 transition-all cursor-pointer group ${
                                  highlightedTransactionId === tx.id && !isSelectionMode
                                    ? 'bg-indigo-500/20 border-l-2 border-indigo-500'
                                    : isSelected ? 'bg-indigo-500/10 border-l-2 border-indigo-500' : ''
                                }`}
                              >
                              <div className="flex items-center gap-3">
                                {isSelectionMode && (
                                  <div 
                                    className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                      isSelected 
                                        ? 'border-indigo-500 bg-indigo-500 text-white' 
                                        : 'border-white/20'
                                    }`}
                                  >
                                    {isSelected && (
                                      <div className="w-1.5 h-1.5 rounded-sm bg-white" />
                                    )}
                                  </div>
                                )}
                                {/* Icon */}
                                <div
                                  className="w-9 h-9 rounded-xl flex items-center justify-center shadow-inner"
                                  style={{ backgroundColor: `${catObj?.color || '#b2bec3'}20` }}
                                >
                                  <LucideIcon
                                    name={catObj?.icon || 'Tag'}
                                    size={18}
                                    style={{ color: catObj?.color || '#b2bec3' }}
                                  />
                                </div>
                                <div>
                                  <h4 className="font-bold text-sm text-gray-200">
                                    {catObj ? catObj.name : tx.category}
                                  </h4>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[9px] text-gray-500 bg-white/5 px-1 py-0.2 rounded">
                                      {accObj ? accObj.name : '帳戶'}
                                    </span>
                                    <span className="text-[9px] text-indigo-400 bg-indigo-500/10 px-1 py-0.2 rounded font-semibold">
                                      {tx.time || '00:00'}
                                    </span>
                                    <span className="text-[9px] text-gray-400 font-semibold bg-white/5 px-1 py-0.2 rounded">
                                      {tx.date}
                                    </span>
                                    {tx.note && (
                                      <span className="text-xs text-gray-500 truncate max-w-[120px]">{tx.note}</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                {tx.photoId && <Camera size={13} className="text-indigo-400" />}
                                <span className={`font-bold text-sm ${
                                  tx.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'
                                }`}>
                                  {tx.type === 'expense' ? '-' : '+'}${tx.amount}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Desktop Side Transaction Details View (collapsible on mobile to drawer) */}
              <div className="lg:col-span-1 h-full overflow-y-auto pr-4">
                {selectedTransaction && (
                  <div className="glass-panel p-4 sm:p-6 space-y-4 sm:space-y-6 sticky top-4 animate-scale-in border border-indigo-500/20 z-20">
                    <div className="flex justify-between items-center pb-3 border-b border-white/5">
                      <h3 className="font-bold text-sm sm:text-base flex items-center gap-1 text-indigo-300">
                        <Tag size={16} /> 交易詳情
                      </h3>
                      <button
                        onClick={() => {
                          setSelectedTransaction(null);
                          setHighlightedTransactionId(null);
                        }}
                        className="text-gray-400 hover:text-white"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="space-y-4">
                      {/* Category and Account info */}
                      <div className="flex justify-between items-center text-xs sm:text-sm">
                        <div>
                          <span className="text-gray-400">類別:</span>{' '}
                          <span className="font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                            {categories.find(c => c.id === selectedTransaction.category || c.name === selectedTransaction.category)?.name || selectedTransaction.category}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400">帳戶:</span>{' '}
                          <span className="font-bold text-gray-300 bg-white/5 px-2 py-0.5 rounded-full">
                            {accounts.find(a => a.id === selectedTransaction.account)?.name || '未指定'}
                          </span>
                        </div>
                      </div>

                      {/* Display Amount */}
                      <div className="text-center py-4 bg-white/5 rounded-2xl border border-white/5">
                        <span className="text-[11px] sm:text-xs text-gray-400 block mb-1">交易金額</span>
                        <span className={`text-2xl font-black ${
                          selectedTransaction.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'
                        }`}>
                          {selectedTransaction.type === 'expense' ? '-' : '+'}${selectedTransaction.amount.toLocaleString()} <span className="text-xs text-gray-500 font-bold">TWD</span>
                        </span>

                        {/* Foreign currency translation detail */}
                        {selectedTransaction.originalCurrency && selectedTransaction.originalCurrency !== 'TWD' && (
                          <div className="mt-3 pt-3 border-t border-white/5 text-xs text-gray-400 space-y-1">
                            <p>原幣金額: <span className="font-bold text-white">${selectedTransaction.originalAmount} {selectedTransaction.originalCurrency}</span></p>
                            <p>換算匯率: <span className="font-bold text-white">{selectedTransaction.exchangeRate}</span></p>
                            <p className="text-[11px] text-gray-500 leading-tight">{selectedTransaction.rateExplanation}</p>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-400">交易時間:</span>
                          <span className="text-gray-200 font-medium">{selectedTransaction.date} {selectedTransaction.time || '00:00'}</span>
                        </div>
                        <div className="flex flex-col gap-1 border-t border-white/5 pt-2 mt-2">
                          <span className="text-gray-400">備註說明:</span>
                          <p className="text-gray-200 bg-white/5 p-2.5 rounded-lg text-sm leading-relaxed whitespace-pre-wrap">
                            {selectedTransaction.note || '無備註'}
                          </p>
                        </div>

                        {/* Taiwan Electronic Invoice details Card */}
                        {(selectedTransaction.invoiceNumber || selectedTransaction.sellerTaxId || selectedTransaction.carrier) && (
                          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-3 text-[11px] space-y-1.5 font-mono text-indigo-300">
                            <div className="flex items-center gap-2 border-b border-indigo-500/10 pb-1">
                              <span className="font-black text-indigo-400 text-xs">🧾 統一發票資訊</span>
                              {/* Invoice type badge */}
                              {selectedTransaction.invoiceNumber && !selectedTransaction.carrier && (
                                <span className="ml-auto text-[9px] bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded-full font-sans">📄 紙本電子發票</span>
                              )}
                              {selectedTransaction.carrier && (
                                <span className="ml-auto text-[9px] bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded-full font-sans">☁️ 雲端發票</span>
                              )}
                              {!selectedTransaction.invoiceNumber && !selectedTransaction.carrier && selectedTransaction.sellerTaxId && (
                                <span className="ml-auto text-[9px] bg-gray-500/30 text-gray-400 px-1.5 py-0.5 rounded-full font-sans">🗒️ 統一發票</span>
                              )}
                            </div>
                            {selectedTransaction.invoiceNumber && (
                              <div className="flex justify-between">
                                <span className="text-gray-400">發票號碼:</span>
                                <span className="text-white font-bold">{selectedTransaction.invoiceNumber}</span>
                              </div>
                            )}
                            {selectedTransaction.randomCode && (
                              <div className="flex justify-between">
                                <span className="text-gray-400">發票隨機碼:</span>
                                <span className="text-white font-bold">{selectedTransaction.randomCode}</span>
                              </div>
                            )}
                            {selectedTransaction.carrier && (
                              <div className="flex justify-between">
                                <span className="text-gray-400">手機載具:</span>
                                <span className="text-purple-300 font-bold bg-purple-500/20 px-1 py-0.5 rounded">{selectedTransaction.carrier}</span>
                              </div>
                            )}
                            {selectedTransaction.sellerTaxId && (
                              <div className="flex justify-between">
                                <span className="text-gray-400">店家統編:</span>
                                <span className="text-white font-medium">{selectedTransaction.sellerTaxId}</span>
                              </div>
                            )}
                            {selectedTransaction.buyerTaxId && (
                              <div className="flex justify-between">
                                <span className="text-gray-400">買方統編:</span>
                                <span className="text-emerald-400 font-bold">{selectedTransaction.buyerTaxId}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {selectedTransaction.invoiceNumber && (
                          <div className="mt-2 bg-indigo-950/40 border border-indigo-500/20 rounded-2xl p-3 text-[11px] space-y-2 text-indigo-300">
                            <div className="flex items-center justify-between border-b border-indigo-500/15 pb-1 font-mono">
                              <span className="font-bold flex items-center gap-1">🔍 全民稽核查詢小幫手</span>
                              <a 
                                href={`https://www.einvoice.nat.gov.tw/portal/btc/audit/btc601w/search?invoiceNumber=${selectedTransaction.invoiceNumber}&invoiceDate=${selectedTransaction.date ? selectedTransaction.date.replace(/-/g, '/') : ''}&randomNumber=${selectedTransaction.randomCode || ''}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[9px] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2 py-0.5 rounded transition-all flex items-center gap-0.5 font-sans"
                              >
                                打開網頁 ↗
                              </a>
                            </div>
                            <p className="text-[10px] text-gray-400 font-sans leading-tight">若明細不完整，可至財政部專區複製以下資訊查詢：</p>
                            <div className="grid grid-cols-1 gap-1.5 font-mono">
                              <div className="flex items-center justify-between bg-white/5 px-2 py-1 rounded border border-white/5">
                                <span className="text-gray-400">發票號碼:</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-white font-bold">{selectedTransaction.invoiceNumber.replace('-', '')}</span>
                                  <button 
                                    type="button" 
                                    onClick={() => handleCopyToClipboard(selectedTransaction.invoiceNumber!.replace('-', ''), 'invoiceNum')} 
                                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-sans font-bold"
                                  >
                                    {copiedField === 'invoiceNum' ? '已複製' : '複製'}
                                  </button>
                                </div>
                              </div>
                              <div className="flex items-center justify-between bg-white/5 px-2 py-1 rounded border border-white/5">
                                <span className="text-gray-400">開立日期:</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-white font-bold">{selectedTransaction.date}</span>
                                  <button 
                                    type="button" 
                                    onClick={() => handleCopyToClipboard(selectedTransaction.date, 'date')} 
                                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-sans font-bold"
                                  >
                                    {copiedField === 'date' ? '已複製' : '複製'}
                                  </button>
                                </div>
                              </div>
                              {selectedTransaction.randomCode && (
                                <div className="flex items-center justify-between bg-white/5 px-2 py-1 rounded border border-white/5">
                                  <span className="text-gray-400">隨機碼:</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-white font-bold">{selectedTransaction.randomCode}</span>
                                    <button 
                                      type="button" 
                                      onClick={() => handleCopyToClipboard(selectedTransaction.randomCode || '', 'randomCode')} 
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

                      {/* Item Details */}
                      {selectedTransaction.items && selectedTransaction.items.length > 0 && (
                        <div className="space-y-1 text-sm">
                          <h4 className="font-bold text-gray-400">商品明細:</h4>
                          <div className="rounded-xl border border-white/5 overflow-hidden max-h-[140px] overflow-y-auto">
                            <table className="w-full text-xs text-left table-fixed">
                              <tbody className="divide-y divide-white/5 text-gray-300">
                                {selectedTransaction.items.map((item, idx) => (
                                  <tr key={idx} className="bg-white/5 hover:bg-white/10 group/row">
                                    <td className="p-2 font-medium break-words whitespace-normal w-[60%]">
                                      <div 
                                        className="flex items-center gap-1.5 cursor-pointer hover:text-indigo-300 transition-all"
                                        onClick={() => handleCopyItemName(item.name)}
                                        title="點擊複製商品名稱"
                                      >
                                        <span className="truncate max-w-[85%]">{item.name}</span>
                                        {copiedItemName === item.name ? (
                                          <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded font-bold whitespace-nowrap animate-scale-in shrink-0">已複製</span>
                                        ) : (
                                          <Icons.Copy size={10} className="text-gray-500 opacity-0 group-hover/row:opacity-100 transition-all shrink-0" />
                                        )}
                                      </div>
                                    </td>
                                    <td className="p-2 text-center text-gray-400 w-[15%]">{item.qty}x</td>
                                    <td className="p-2 text-right font-bold text-white w-[25%]">${item.total}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Photo attached */}
                      {selectedTransaction.photoId && (
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between items-center">
                            <h4 className="font-bold text-gray-400">單據影像:</h4>
                            {transactionPhoto && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRotatePhoto();
                                }}
                                disabled={isRotating}
                                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-lg border border-white/5 hover:border-white/10 transition-all font-semibold"
                                title="順時針旋轉 90 度"
                              >
                                {isRotating ? (
                                  <LucideIcon name="Loader2" size={11} className="animate-spin" />
                                ) : (
                                  <LucideIcon name="RotateCw" size={11} />
                                )}
                                <span>手動轉正</span>
                              </button>
                            )}
                          </div>
                          {transactionPhoto ? (
                            <div 
                              onClick={() => setLightboxPhoto(transactionPhoto)}
                              className="block relative group rounded-xl overflow-hidden border border-white/10 max-h-[160px] cursor-pointer"
                            >
                              <img
                                src={transactionPhoto}
                                alt="Receipt Base64"
                                className="w-full object-contain max-h-[150px] bg-black/40 hover:scale-105 transition-all"
                              />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                                <span className="text-[11px] text-white font-bold bg-indigo-600/80 px-2.5 py-1 rounded-lg flex items-center gap-1">
                                  <LucideIcon name="Maximize2" size={12} /> 點擊看大圖
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="w-full h-[100px] rounded-xl bg-white/5 animate-pulse" />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Edit, Rescan, and Delete Buttons */}
                    <div className="pt-2 border-t border-white/5 flex flex-col gap-2">
                      {selectedTransaction.photoId && (
                        <button
                          onClick={() => handleSingleRescan(selectedTransaction)}
                          disabled={isSingleProcessing}
                          className="glass-button w-full py-2.5 text-sm flex items-center justify-center gap-1.5 font-bold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/20 disabled:opacity-50"
                        >
                          {isSingleProcessing ? (
                            <LucideIcon name="Loader2" size={14} className="animate-spin" />
                          ) : (
                            <LucideIcon name="RefreshCw" size={14} />
                          )}
                          重新辨識單據
                        </button>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleOpenEditModal(selectedTransaction)}
                          className="glass-button flex-1 py-2.5 text-sm flex items-center justify-center gap-1 font-bold bg-white/10 border-white/10"
                        >
                          <Edit2 size={14} /> 編輯此筆
                        </button>
                        <button
                          onClick={() => handleDeleteTransaction(selectedTransaction)}
                          className="glass-button glass-button-danger flex-1 py-2.5 text-sm flex items-center justify-center gap-1 font-bold"
                        >
                          <Trash2 size={14} /> 刪除
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'statistics' && <Stats />}
        {activeTab === 'accounts' && <AccountsManager onRefreshData={() => {}} />}
        {activeTab === 'prizes' && <InvoicePrizeChecker />}
        {activeTab === 'settings' && (
          <Settings 
            currentTheme={theme} 
            setTheme={handleSetTheme} 
            textSize={textSize}
            setTextSize={handleSetTextSize}
            onRefreshData={() => {}} 
          />
        )}
      </main>

      {/* Mobile Transaction Details Panel (Bottom Sheet) */}
      {selectedTransaction && (
        <div className="fixed inset-0 z-50 lg:hidden animate-fade-in">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setSelectedTransaction(null);
              setHighlightedTransactionId(null);
            }}
          />
          <div className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto glass-panel rounded-t-2xl p-4 sm:p-6 space-y-4 border-t border-indigo-500/20 animate-slide-up pb-16">
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <h3 className="font-bold text-sm sm:text-base flex items-center gap-1 text-indigo-300">
                <Tag size={16} /> 交易詳情
              </h3>
              <button
                onClick={() => {
                  setSelectedTransaction(null);
                  setHighlightedTransactionId(null);
                }}
                className="text-gray-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center text-xs sm:text-sm">
                <div>
                  <span className="text-gray-400">類別:</span>{' '}
                  <span className="font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                    {categories.find(c => c.id === selectedTransaction.category || c.name === selectedTransaction.category)?.name || selectedTransaction.category}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">帳戶:</span>{' '}
                  <span className="font-bold text-gray-300 bg-white/5 px-2 py-0.5 rounded-full">
                    {accounts.find(a => a.id === selectedTransaction.account)?.name || '未指定'}
                  </span>
                </div>
              </div>

              <div className="text-center py-4 bg-white/5 rounded-2xl border border-white/5">
                <span className="text-[11px] sm:text-xs text-gray-400 block mb-1">交易金額</span>
                <span className={`text-2xl font-black ${
                  selectedTransaction.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'
                }`}>
                  {selectedTransaction.type === 'expense' ? '-' : '+'}${selectedTransaction.amount.toLocaleString()} <span className="text-xs text-gray-500 font-bold">TWD</span>
                </span>

                {selectedTransaction.originalCurrency && selectedTransaction.originalCurrency !== 'TWD' && (
                  <div className="mt-3 pt-3 border-t border-white/5 text-xs text-gray-400 space-y-1">
                    <p>原幣金額: <span className="font-bold text-white">${selectedTransaction.originalAmount} {selectedTransaction.originalCurrency}</span></p>
                    <p>換算匯率: <span className="font-bold text-white">{selectedTransaction.exchangeRate}</span></p>
                    <p className="text-[11px] text-gray-500 leading-tight">{selectedTransaction.rateExplanation}</p>
                  </div>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">交易時間:</span>
                  <span className="text-gray-200 font-medium">{selectedTransaction.date} {selectedTransaction.time || '00:00'}</span>
                </div>
                <div className="flex flex-col gap-1 border-t border-white/5 pt-2 mt-2">
                  <span className="text-gray-400">備註說明:</span>
                  <p className="text-gray-200 bg-white/5 p-2.5 rounded-lg text-sm leading-relaxed whitespace-pre-wrap">
                    {selectedTransaction.note || '無備註'}
                  </p>
                </div>

                {(selectedTransaction.invoiceNumber || selectedTransaction.sellerTaxId || selectedTransaction.carrier) && (
                  <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-3 text-[11px] space-y-1.5 font-mono text-indigo-300">
                    <div className="flex items-center gap-2 border-b border-indigo-500/10 pb-1">
                      <span className="font-black text-indigo-400 text-xs">🧾 統一發票資訊</span>
                      {selectedTransaction.invoiceNumber && !selectedTransaction.carrier && (
                        <span className="ml-auto text-[9px] bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded-full font-sans">📄 紙本電子發票</span>
                      )}
                      {selectedTransaction.carrier && (
                        <span className="ml-auto text-[9px] bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded-full font-sans">☁️ 雲端發票</span>
                      )}
                      {!selectedTransaction.invoiceNumber && !selectedTransaction.carrier && selectedTransaction.sellerTaxId && (
                        <span className="ml-auto text-[9px] bg-gray-500/30 text-gray-400 px-1.5 py-0.5 rounded-full font-sans">🗒️ 統一發票</span>
                      )}
                    </div>
                    {selectedTransaction.invoiceNumber && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">發票號碼:</span>
                        <span className="text-white font-bold">{selectedTransaction.invoiceNumber}</span>
                      </div>
                    )}
                    {selectedTransaction.randomCode && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">發票隨機碼:</span>
                        <span className="text-white font-bold">{selectedTransaction.randomCode}</span>
                      </div>
                    )}
                    {selectedTransaction.carrier && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">手機載具:</span>
                        <span className="text-purple-300 font-bold bg-purple-500/20 px-1 py-0.5 rounded">{selectedTransaction.carrier}</span>
                      </div>
                    )}
                    {selectedTransaction.sellerTaxId && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">店家統編:</span>
                        <span className="text-white font-medium">{selectedTransaction.sellerTaxId}</span>
                      </div>
                    )}
                    {selectedTransaction.buyerTaxId && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">買方統編:</span>
                        <span className="text-emerald-400 font-bold">{selectedTransaction.buyerTaxId}</span>
                      </div>
                    )}
                  </div>
                )}
                {selectedTransaction.invoiceNumber && (
                  <div className="mt-2 bg-indigo-950/40 border border-indigo-500/20 rounded-2xl p-3 text-[11px] space-y-2 text-indigo-300">
                    <div className="flex items-center justify-between border-b border-indigo-500/15 pb-1 font-mono">
                      <span className="font-bold flex items-center gap-1">🔍 全民稽核查詢小幫手</span>
                      <a 
                        href={`https://www.einvoice.nat.gov.tw/portal/btc/audit/btc601w/search?invoiceNumber=${selectedTransaction.invoiceNumber}&invoiceDate=${selectedTransaction.date ? selectedTransaction.date.replace(/-/g, '/') : ''}&randomNumber=${selectedTransaction.randomCode || ''}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-[9px] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2 py-0.5 rounded transition-all flex items-center gap-0.5 font-sans"
                      >
                        打開網頁 ↗
                      </a>
                    </div>
                    <p className="text-[10px] text-gray-400 font-sans leading-tight">若明細不完整，可至財政部專區複製以下資訊查詢：</p>
                    <div className="grid grid-cols-1 gap-1.5 font-mono">
                      <div className="flex items-center justify-between bg-white/5 px-2 py-1 rounded border border-white/5">
                        <span className="text-gray-400">發票號碼:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-white font-bold">{selectedTransaction.invoiceNumber.replace('-', '')}</span>
                          <button 
                            type="button" 
                            onClick={() => handleCopyToClipboard(selectedTransaction.invoiceNumber!.replace('-', ''), 'invoiceNum')} 
                            className="text-[10px] text-indigo-400 hover:text-indigo-300 font-sans font-bold"
                          >
                            {copiedField === 'invoiceNum' ? '已複製' : '複製'}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between bg-white/5 px-2 py-1 rounded border border-white/5">
                        <span className="text-gray-400">開立日期:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-white font-bold">{selectedTransaction.date}</span>
                          <button 
                            type="button" 
                            onClick={() => handleCopyToClipboard(selectedTransaction.date, 'date')} 
                            className="text-[10px] text-indigo-400 hover:text-indigo-300 font-sans font-bold"
                          >
                            {copiedField === 'date' ? '已複製' : '複製'}
                          </button>
                        </div>
                      </div>
                      {selectedTransaction.randomCode && (
                        <div className="flex items-center justify-between bg-white/5 px-2 py-1 rounded border border-white/5">
                          <span className="text-gray-400">隨機碼:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-white font-bold">{selectedTransaction.randomCode}</span>
                            <button 
                              type="button" 
                              onClick={() => handleCopyToClipboard(selectedTransaction.randomCode || '', 'randomCode')} 
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

              {selectedTransaction.items && selectedTransaction.items.length > 0 && (
                <div className="space-y-1 text-sm">
                  <h4 className="font-bold text-gray-400">商品明細:</h4>
                  <div className="rounded-xl border border-white/5 overflow-hidden max-h-[140px] overflow-y-auto">
                    <table className="w-full text-xs text-left table-fixed">
                      <tbody className="divide-y divide-white/5 text-gray-300">
                        {selectedTransaction.items.map((item, idx) => (
                          <tr key={idx} className="bg-white/5 hover:bg-white/10 group/row">
                            <td className="p-2 font-medium break-words whitespace-normal w-[60%]">
                              <div 
                                className="flex items-center gap-1.5 cursor-pointer hover:text-indigo-300 transition-all"
                                onClick={() => handleCopyItemName(item.name)}
                                title="點擊複製商品名稱"
                              >
                                <span className="truncate max-w-[85%]">{item.name}</span>
                                {copiedItemName === item.name ? (
                                  <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded font-bold whitespace-nowrap animate-scale-in shrink-0">已複製</span>
                                ) : (
                                  <Icons.Copy size={10} className="text-gray-500 opacity-0 group-hover/row:opacity-100 transition-all shrink-0" />
                                )}
                              </div>
                            </td>
                            <td className="p-2 text-center text-gray-400 w-[15%]">{item.qty}x</td>
                            <td className="p-2 text-right text-gray-400 w-[12.5%]">${item.price.toLocaleString()}</td>
                            <td className="p-2 text-right text-gray-200 font-bold w-[12.5%]">${item.total.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedTransaction.photoId && (
                <div className="pt-2 border-t border-white/5">
                  <h4 className="font-bold text-gray-400">單據影像:</h4>
                  <div className="relative rounded-xl overflow-hidden border border-white/10 bg-white/5">
                    <img
                      src={transactionPhoto || ''}
                      alt="單據"
                      className="w-full h-auto max-h-[200px] object-contain"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = '/placeholder.png';
                      }}
                    />
                    <button
                      onClick={() => setLightboxPhoto(transactionPhoto)}
                      className="absolute bottom-2 right-2 text-[10px] bg-black/60 text-white px-2 py-1 rounded-lg hover:bg-black/80 transition-all flex items-center gap-1"
                    >
                      <LucideIcon name="Maximize2" size={12} /> 點擊看大圖
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Edit, Rescan, and Delete Buttons */}
            <div className="pt-2 border-t border-white/5 flex flex-col gap-2">
              {selectedTransaction.photoId && (
                <button
                  onClick={() => handleSingleRescan(selectedTransaction)}
                  disabled={isSingleProcessing}
                  className="glass-button w-full py-2.5 text-sm flex items-center justify-center gap-1.5 font-bold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/20 disabled:opacity-50"
                >
                  {isSingleProcessing ? (
                    <>
                      <LucideIcon name="Loader2" size={16} className="animate-spin" /> 辨識中...
                    </>
                  ) : (
                    <>
                      <LucideIcon name="RefreshCw" size={16} /> 重新 AI 辨識
                    </>
                  )}
                </button>
              )}

              <button
                onClick={() => handleOpenEditModal(selectedTransaction)}
                className="glass-button w-full py-2.5 text-sm flex items-center justify-center gap-1.5 font-bold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/20"
              >
                <Edit2 size={16} /> 編輯交易
              </button>

              <button
                onClick={() => handleDeleteTransaction(selectedTransaction)}
                className="glass-button glass-button-danger w-full py-2.5 text-sm flex items-center justify-center gap-1.5 font-bold"
              >
                <Trash2 size={16} /> 刪除交易
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Record Modal Popups */}
      <AddRecordModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingTransactionId(undefined);
        }}
        editingTransactionId={editingTransactionId}
        onRefreshData={() => {}}
      />

      {/* Carrier Invoice Import Modal */}
      <ImportCarrierInvoicesModal
        isOpen={showCarrierImport}
        onClose={() => setShowCarrierImport(false)}
        onRefreshData={() => {}}
      />

      {/* Batch Processing Overlay */}
      {isBatchProcessing && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel max-w-sm w-full p-6 space-y-4 text-center border border-indigo-500/30 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
              <LucideIcon name="RefreshCw" size={24} className="animate-spin" />
            </div>
            <div>
              <h3 className="font-bold text-gray-200 text-base">批次重新辨識中</h3>
              <p className="text-xs text-gray-400 mt-1">{batchProgressStatus}</p>
            </div>
            
            {/* Progress Bar */}
            <div className="space-y-1">
              <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-300"
                  style={{ width: `${(batchProgressCurrent / batchProgressTotal) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-gray-500 font-mono">
                <span>{((batchProgressCurrent / batchProgressTotal) * 100).toFixed(0)}%</span>
                <span>{batchProgressCurrent} / {batchProgressTotal}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox / Large Image Viewer */}
      {lightboxPhoto && (
        <div 
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in select-none"
          onClick={() => setLightboxPhoto(null)}
          onWheel={handleWheel}
        >
          <button 
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all focus:outline-none z-50"
            onClick={() => setLightboxPhoto(null)}
          >
            <X size={24} />
          </button>
          <div 
            className="w-full h-full flex items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={lightboxPhoto} 
              alt="Receipt Large View" 
              className="max-w-full max-h-full object-contain select-none transition-transform duration-200"
              style={{
                transform: `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${panOffset.y / zoomScale}px)`,
                cursor: zoomScale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            />
          </div>

          {/* Zoom controls */}
          <div 
            className="absolute bottom-6 left-1/2 -translate-x-1/2 glass-panel py-2 px-4 flex items-center gap-4 border border-white/10 shadow-2xl z-50 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleZoomOut}
              disabled={zoomScale <= 1}
              className="text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition-all p-1"
              title="縮小"
            >
              <LucideIcon name="Minus" size={16} />
            </button>
            <span className="font-bold text-gray-200 min-w-[36px] text-center select-none font-mono">
              {zoomScale.toFixed(2)}x
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoomScale >= 3}
              className="text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition-all p-1"
              title="放大"
            >
              <LucideIcon name="Plus" size={16} />
            </button>
            <div className="w-[1px] h-4 bg-white/10" />
            <button
              onClick={handleZoomReset}
              className="text-indigo-400 hover:text-indigo-300 font-bold px-2 py-0.5 hover:bg-white/5 rounded transition-all"
              title="重設縮放"
            >
              重設
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
