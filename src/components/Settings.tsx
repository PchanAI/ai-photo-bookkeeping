import React, { useState, useEffect } from 'react';
import { db, type Category, seedDefaultData } from '../db';
import { getGeminiApiKeys, saveGeminiApiKeys } from '../services/gemini';
import { 
  Key, Save, Eye, EyeOff, Trash2, Download, Upload, 
  RotateCcw, Sparkles, Check, Plus, Smartphone, X
} from 'lucide-react';

interface SettingsProps {
  currentTheme: 'light' | 'dark' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'violet' | 'rose' | 'emerald' | 'slate' | 'charcoal' | 'arctic' | 'golden' | 'cyberpunk';
  setTheme: (theme: 'light' | 'dark' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'violet' | 'rose' | 'emerald' | 'slate' | 'charcoal' | 'arctic' | 'golden' | 'cyberpunk') => void;
  textSize: 'sm' | 'md' | 'lg';
  setTextSize: (size: 'sm' | 'md' | 'lg') => void;
  onRefreshData: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ 
  currentTheme, setTheme, textSize, setTextSize, onRefreshData 
}) => {
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [newApiKey, setNewApiKey] = useState('');
  const [showNewKey, setShowNewKey] = useState(false);
  const [showKeyIndices, setShowKeyIndices] = useState<number[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Taiwan MOF E-Invoice API Keys & Carrier Settings
  const [mofAppId, setMofAppId] = useState('');
  const [mofApiKey, setMofApiKey] = useState('');
  const [mofCardNo, setMofCardNo] = useState('');
  const [mofCardEncrypt, setMofCardEncrypt] = useState('');
  const [mofSaveSuccess, setMofSaveSuccess] = useState(false);
  const [showMofGuide, setShowMofGuide] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'expense' | 'income'>('expense');
  const [newCatColor, setNewCatColor] = useState('#6c5ce7');
  const [newCatIcon, setNewCatIcon] = useState('Tag');
  const [ocrEngineSaved, setOcrEngineSaved] = useState(false);

  const [ocrEngine, setOcrEngine] = useState<'gemini' | 'local'>(
    (localStorage.getItem('ocrEngine') as 'gemini' | 'local') || 'gemini'
  );
  const [storageEstimate, setStorageEstimate] = useState<{ usage: string; quota: string; percent: string } | null>(null);
  // PWA Install Prompt
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);

  const availableIcons = ['Utensils', 'ShoppingBag', 'Car', 'Gamepad2', 'Home', 'HeartPulse', 'BookOpen', 'Briefcase', 'TrendingUp', 'Sparkles', 'Coins', 'Tag', 'Gift', 'Coffee', 'Shirt', 'Plane', 'Tv', 'Activity', 'MoreHorizontal'];
  const availableColors = ['#ff7675', '#74b9ff', '#55efc4', '#a29bfe', '#ffeaa7', '#ff8787', '#81ecec', '#b2bec3', '#00b894', '#0984e3', '#fdcb6e', '#fd79a8', '#e84393', '#e17055', '#2d3436'];

  const updateStorageEstimate = async () => {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usageMB = ((estimate.usage || 0) / (1024 * 1024)).toFixed(1);
        const quotaMB = ((estimate.quota || 0) / (1024 * 1024)).toFixed(0);
        const percent = estimate.quota 
          ? ((estimate.usage || 0) / estimate.quota * 100).toFixed(2) 
          : '0.00';
        setStorageEstimate({
          usage: `${usageMB} MB`,
          quota: `${Number(quotaMB).toLocaleString()} MB`,
          percent: `${percent}%`
        });
      } catch (err) {
        console.error('Failed to get storage estimate:', err);
      }
    }
  };

  useEffect(() => {
    setApiKeys(getGeminiApiKeys());
    setMofAppId(localStorage.getItem('mof_app_id') || '');
    setMofApiKey(localStorage.getItem('mof_api_key') || '');
    setMofCardNo(localStorage.getItem('mof_card_no') || '');
    setMofCardEncrypt(localStorage.getItem('mof_card_encrypt') || '');
    loadCategories();
    updateStorageEstimate();

    // Listen for PWA install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Detect if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsAppInstalled(true);
    }
    window.addEventListener('appinstalled', () => setIsAppInstalled(true));

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleSaveOcrEngine = () => {
    localStorage.setItem('ocrEngine', ocrEngine);
    setOcrEngineSaved(true);
    setTimeout(() => setOcrEngineSaved(false), 2000);
  };

  const handleSaveMofSettings = () => {
    localStorage.setItem('mof_app_id', mofAppId.trim());
    localStorage.setItem('mof_api_key', mofApiKey.trim());
    localStorage.setItem('mof_card_no', mofCardNo.trim());
    localStorage.setItem('mof_card_encrypt', mofCardEncrypt.trim());
    setMofSaveSuccess(true);
    setTimeout(() => setMofSaveSuccess(false), 2000);
  };

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setIsAppInstalled(true);
    }
    setDeferredPrompt(null);
  };

  const loadCategories = async () => {
    const list = await db.categories.toArray();
    setCategories(list);
  };

  const handleSaveApiKey = () => {
    saveGeminiApiKeys(apiKeys);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleAddApiKey = () => {
    const trimmed = newApiKey.trim();
    if (!trimmed) return;
    if (apiKeys.includes(trimmed)) {
      alert('此 API Key 已經在列表中！');
      return;
    }
    if (apiKeys.length >= 50) {
      alert('最多只能儲存 50 組 API Key！');
      return;
    }
    setApiKeys([...apiKeys, trimmed]);
    setNewApiKey('');
    setShowNewKey(false);
  };

  const handleDeleteApiKey = (index: number) => {
    const newList = apiKeys.filter((_, idx) => idx !== index);
    setApiKeys(newList);
  };

  const toggleShowKey = (index: number) => {
    if (showKeyIndices.includes(index)) {
      setShowKeyIndices(showKeyIndices.filter(i => i !== index));
    } else {
      setShowKeyIndices([...showKeyIndices, index]);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    const id = `cat_${Date.now()}`;
    await db.categories.add({
      id,
      name: newCatName,
      type: newCatType,
      icon: newCatIcon,
      color: newCatColor
    });

    setNewCatName('');
    loadCategories();
    onRefreshData();
  };

  const handleDeleteCategory = async (id: string) => {
    if (confirm('確定要刪除此分類嗎？這不會刪除已記帳的交易，但交易分類可能會顯示為未知。')) {
      await db.categories.delete(id);
      loadCategories();
      onRefreshData();
    }
  };

  const handleResetDatabase = async () => {
    if (confirm('警告！這將清除所有記帳交易、帳戶餘額、相片及自訂分類，並恢復到預設狀態。確定要繼續嗎？')) {
      await db.transaction('rw', [db.transactions, db.photos, db.accounts, db.categories], async () => {
        await db.transactions.clear();
        await db.photos.clear();
        await db.accounts.clear();
        await db.categories.clear();
      });
      await seedDefaultData();
      loadCategories();
      onRefreshData();
      await updateStorageEstimate();
      alert('資料庫已重設！');
    }
  };

  const handleExportData = async () => {
    const hasKeys = getGeminiApiKeys().length > 0 ||
      localStorage.getItem('mof_api_key') ||
      localStorage.getItem('mof_app_id');
    if (hasKeys && !confirm('備份檔案將包含您的 Gemini 金鑰與財政部 API 憑證，請妥善保管，勿分享給他人。確定要匯出嗎？')) {
      return;
    }
    try {
      const transactions = await db.transactions.toArray();
      const photos = await db.photos.toArray();
      const accounts = await db.accounts.toArray();
      const categories = await db.categories.toArray();

      const exportObj = {
        version: 1,
        exportedAt: new Date().toISOString(),
        geminiApiKeys: getGeminiApiKeys(),
        data: {
          transactions,
          photos,
          accounts,
          categories
        }
      };

      const jsonString = JSON.stringify(exportObj);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", url);
      downloadAnchor.setAttribute("download", `bookkeeping_backup_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      URL.revokeObjectURL(url); // Clean up memory allocation from DOM
    } catch (err) {
      alert('匯出失敗: ' + err);
    }
  };

  const handleImportData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (!json.data || !json.data.transactions || !json.data.accounts) {
          throw new Error('無效的備份檔案格式');
        }

        if (confirm('匯入備份將會覆蓋您目前的帳本資料。確定要繼續嗎？')) {
          await db.transaction('rw', [db.transactions, db.photos, db.accounts, db.categories], async () => {
            await db.transactions.clear();
            await db.photos.clear();
            await db.accounts.clear();
            await db.categories.clear();

            if (json.data.transactions) await db.transactions.bulkAdd(json.data.transactions);
            if (json.data.photos) await db.photos.bulkAdd(json.data.photos);
            if (json.data.accounts) await db.accounts.bulkAdd(json.data.accounts);
            if (json.data.categories) await db.categories.bulkAdd(json.data.categories);
          });

          if (json.geminiApiKeys && Array.isArray(json.geminiApiKeys)) {
            const slicedKeys = json.geminiApiKeys.slice(0, 50);
            saveGeminiApiKeys(slicedKeys);
            setApiKeys(slicedKeys);
          }

          loadCategories();
          onRefreshData();
          await updateStorageEstimate();
          alert('資料匯入成功！');
        }
      } catch (err) {
        alert('解析備份檔案失敗: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 animate-slide-up">
      {/* PWA Install Banner */}
      {!isAppInstalled && (
        <div className="glass-panel p-6">
          <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
            <Smartphone className="text-indigo-400" /> 安裝為 APP
          </h2>
          <p className="text-sm text-gray-400 mb-4 leading-relaxed">
            將此記帳助理安裝為獨立 APP，享受全螢幕體驗、離線使用、以及從桌面或主畫面快速啟動。
          </p>
          {deferredPrompt ? (
            <button
              onClick={handleInstallApp}
              className="glass-button w-full py-3 text-base font-semibold flex items-center justify-center gap-2"
            >
              <Smartphone size={20} /> 立即安裝到裝置
            </button>
          ) : (
            <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-sm leading-relaxed text-indigo-200">
              <strong className="block mb-1">📱 安裝方式：</strong>
              <ul className="list-disc list-inside space-y-1 text-indigo-300/80">
                <li><strong>Android Chrome</strong>：點選右上角選單（⋮）→「安裝應用程式」或「新增至主畫面」</li>
                <li><strong>iPhone Safari</strong>：點選底部分享按鈕（□↑）→「加入主畫面」</li>
                <li><strong>電腦 Chrome/Edge</strong>：網址列右側的安裝圖示（⊕）→「安裝」</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Preferences Panel (Theme & Text Size) */}
      <div className="glass-panel p-6">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Sparkles className="text-indigo-400" /> 介面偏好設定
        </h2>
        
        {/* Theme Selection Grid */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">主題樣式（共 14 種）</h3>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
            {[
              { id: 'light', label: '淺色', gradient: 'from-slate-100 to-slate-200', textColor: 'text-slate-800' },
              { id: 'dark', label: '深色', gradient: 'from-slate-800 to-slate-950', textColor: 'text-slate-200' },
              { id: 'midnight', label: '午夜幽靈', gradient: 'from-indigo-900 to-slate-900', textColor: 'text-indigo-200' },
              { id: 'ocean', label: '深海藍調', gradient: 'from-cyan-900 to-blue-900', textColor: 'text-sky-200' },
              { id: 'forest', label: '翠林秘境', gradient: 'from-emerald-900 to-green-900', textColor: 'text-emerald-200' },
              { id: 'sunset', label: '夕陽餘暉', gradient: 'from-orange-900 to-amber-900', textColor: 'text-amber-200' },
              { id: 'violet', label: '紫羅蘭夢', gradient: 'from-violet-900 to-purple-900', textColor: 'text-violet-200' },
              { id: 'rose', label: '玫瑰園', gradient: 'from-rose-900 to-pink-900', textColor: 'text-rose-200' },
              { id: 'emerald', label: '翡翠森林', gradient: 'from-teal-900 to-emerald-900', textColor: 'text-teal-200' },
              { id: 'slate', label: '板岩質感', gradient: 'from-slate-900 to-gray-900', textColor: 'text-slate-200' },
              { id: 'charcoal', label: '炭灰沉穩', gradient: 'from-zinc-900 to-neutral-900', textColor: 'text-zinc-200' },
              { id: 'arctic', label: '北極冰雪', gradient: 'from-sky-50 to-blue-100', textColor: 'text-slate-800' },
              { id: 'golden', label: '金色輝煌', gradient: 'from-yellow-50 to-amber-100', textColor: 'text-amber-900' },
              { id: 'cyberpunk', label: '賽博龐克', gradient: 'from-fuchsia-950 to-slate-950', textColor: 'text-fuchsia-200' },
            ].map(th => (
              <button
                key={th.id}
                onClick={() => setTheme(th.id as any)}
                className={`group relative h-16 rounded-xl bg-gradient-to-br ${th.gradient} border-2 transition-all hover:scale-105 ${
                  currentTheme === th.id ? 'border-white ring-2 ring-white/30' : 'border-white/10 hover:border-white/30'
                }`}
              >
                <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${th.textColor} drop-shadow-md`}>
                  {currentTheme === th.id && <span className="absolute top-1 right-1"><Check size={10} /></span>}
                  {th.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col justify-between p-4 rounded-xl bg-white/5 border border-white/5">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-200">介面文字大小</h3>
              <p className="text-xs text-gray-400 mt-1">調整系統整體的文字大小與比例</p>
            </div>
            <div className="flex gap-2">
              {(['sm', 'md', 'lg'] as const).map(size => {
                const label = size === 'sm' ? '小 (S)' : size === 'md' ? '中 (M)' : '大 (L)';
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setTextSize(size)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                      textSize === size
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Gemini API Settings */}
      <div className="glass-panel p-6">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Key className="text-indigo-400" /> Gemini AI 智慧識別設定
        </h2>
        
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-sm leading-relaxed text-indigo-200">
            <span className="font-semibold flex items-center gap-1 text-indigo-300 mb-1">
              <Sparkles size={16} /> 如何取得免費的 Gemini API Key？
            </span>
            1. 前往 <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="underline font-bold text-indigo-400 hover:text-indigo-300">Google AI Studio</a>。<br />
            2. 使用您的 Google 帳戶登入。<br />
            3. 點選 <strong>"Get API key"</strong> 並點選 <strong>"Create API key"</strong>。<br />
            4. 複製產生的 Key 並在下方貼上。API Key 將完全儲存在您的瀏覽器中，不會上傳到任何第三方伺服器。
          </div>

          {/* Key List */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-300">已設定的 API 金鑰列表 ({apiKeys.length})</label>
            {apiKeys.length === 0 ? (
              <div className="p-4 text-center rounded-xl bg-white/5 border border-dashed border-white/10 text-gray-400 text-sm">
                目前無設定任何金鑰，請於下方輸入並新增金鑰。
              </div>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {apiKeys.map((key, index) => {
                  const isVisible = showKeyIndices.includes(index);
                  const displayValue = isVisible ? key : `${key.slice(0, 8)}...${key.slice(-4)}`;
                  return (
                    <div key={index} className="flex gap-2 items-center p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all duration-200">
                      <div className="flex-1 font-mono text-sm text-gray-200 truncate select-all">
                        {displayValue}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleShowKey(index)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                          title={isVisible ? "隱藏金鑰" : "顯示金鑰"}
                        >
                          {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteApiKey(index)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/5 transition-colors"
                          title="刪除金鑰"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add Key Input */}
          <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
            <label className="text-xs font-semibold text-gray-400">新增 API 金鑰</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showNewKey ? 'text' : 'password'}
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="輸入新的 AIzaSy... 金鑰"
                  className="glass-input w-full pr-10 text-sm font-mono"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddApiKey();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewKey(!showNewKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showNewKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleAddApiKey}
                className="glass-button flex items-center gap-1.5 px-4 text-sm shrink-0"
              >
                <Plus size={16} /> 新增
              </button>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-4 border-t border-white/5">
            <span className="text-xs text-indigo-300/80 leading-normal max-w-md">
              💡 設定多組金鑰時，系統會在辨識時自動進行負載平衡（隨機分配）與容錯切換（若其中一組金鑰達到頻率上限或發生錯誤，將自動使用其他金鑰重試）。
            </span>
            <button
              onClick={handleSaveApiKey}
              className="glass-button flex items-center justify-center gap-2 px-6 py-2.5 shrink-0"
            >
              {saveSuccess ? <Check size={18} /> : <Save size={18} />}
              {saveSuccess ? '已儲存' : '儲存設定'}
            </button>
          </div>
        </div>
      </div>

      {/* OCR Engine Selection */}
      <div className="glass-panel p-6">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Sparkles className="text-indigo-400" /> 單據辨識引擎
        </h2>
        <p className="text-sm text-gray-400 mb-4 leading-relaxed">
          決定「重新辨識單據」（單筆與批次）使用哪個引擎。
          「PaddleOCR 本地離線」不需要 Gemini API 金鑰，首次使用會下載約 15MB 模型。
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setOcrEngine('gemini')}
            className={`flex-1 py-3 text-sm font-bold rounded-xl border transition-all ${
              ocrEngine === 'gemini'
                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
            }`}
          >
            ✨ Gemini 雲端
          </button>
          <button
            type="button"
            onClick={() => setOcrEngine('local')}
            className={`flex-1 py-3 text-sm font-bold rounded-xl border transition-all ${
              ocrEngine === 'local'
                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
            }`}
          >
            💻 PaddleOCR 本地離線
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={handleSaveOcrEngine}
            className="glass-button flex items-center justify-center gap-2 px-6 py-2 text-sm"
          >
            {ocrEngineSaved ? <Check size={16} /> : <Save size={16} />}
            {ocrEngineSaved ? '已儲存' : '儲存'}
          </button>
        </div>
      </div>

      {/* Taiwan MOF E-Invoice API Settings */}
      <div className="glass-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Smartphone className="text-indigo-400" /> 財政部電子發票 API 設定
          </h2>
          <button
            type="button"
            onClick={() => setShowMofGuide(true)}
            className="text-xs bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 font-bold px-3 py-1.5 rounded-xl border border-indigo-500/20 transition-all flex items-center gap-1 font-sans"
          >
            💡 申請流程指引
          </button>
        </div>
        
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-sm leading-relaxed text-indigo-200">
            <span className="font-semibold flex items-center gap-1 text-indigo-300 mb-1">
              🧾 如何啟用自動線上查詢發票明細功能？
            </span>
            本記帳助理支援直接向財政部平台查詢發票的消費品項與金額。若您已向財政部申請電子發票 API 權限，可在下方輸入您的 <strong>App ID</strong> 與 <strong>API Key</strong>。資料將安全儲存於您的本機瀏覽器。
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-gray-300 font-sans">財政部 App ID</label>
              <input
                type="text"
                value={mofAppId}
                onChange={(e) => setMofAppId(e.target.value)}
                placeholder="例如：E-INV1234567890"
                className="glass-input text-sm font-mono py-2 px-3"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-gray-300 font-sans">財政部 API Key</label>
              <input
                type="password"
                value={mofApiKey}
                onChange={(e) => setMofApiKey(e.target.value)}
                placeholder="輸入您的 API Key 密鑰"
                className="glass-input text-sm font-mono py-2 px-3"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-gray-300 font-sans">預設個人載具號碼 (手機條碼)</label>
              <input
                type="text"
                value={mofCardNo}
                onChange={(e) => setMofCardNo(e.target.value)}
                placeholder="例如：/AB12345 (首字需為斜線)"
                className="glass-input text-sm font-mono py-2 px-3"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-gray-300 font-sans">載具驗證碼/密碼 (cardEncrypt)</label>
              <input
                type="password"
                value={mofCardEncrypt}
                onChange={(e) => setMofCardEncrypt(e.target.value)}
                placeholder="手機條碼的驗證碼密碼"
                className="glass-input text-sm font-mono py-2 px-3"
              />
            </div>
          </div>

          {/* Action Row */}
          <div className="flex justify-end pt-4 border-t border-white/5">
            <button
              onClick={handleSaveMofSettings}
              className="glass-button flex items-center justify-center gap-2 px-6 py-2.5 shrink-0"
            >
              {mofSaveSuccess ? <Check size={18} /> : <Save size={18} />}
              {mofSaveSuccess ? '已儲存' : '儲存財政部設定'}
            </button>
          </div>
        </div>
      </div>

      {/* Category Management */}
      <div className="glass-panel p-6">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Check className="text-indigo-400" /> 分類管理
        </h2>

        {/* Add Category Form */}
        <form onSubmit={handleAddCategory} className="mb-6 grid grid-cols-1 md:grid-cols-5 gap-4 items-end p-4 rounded-xl bg-white/5 border border-white/5">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-400">分類名稱</label>
            <input
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="例如：寵物開銷"
              className="glass-input text-sm"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-400">收支類型</label>
            <select
              value={newCatType}
              onChange={(e) => setNewCatType(e.target.value as 'expense' | 'income')}
              className="glass-input text-sm bg-indigo-950/20 border-white/10 text-white"
            >
              <option value="expense" className="bg-slate-900">支出</option>
              <option value="income" className="bg-slate-900">收入</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-400">選擇圖標</label>
            <select
              value={newCatIcon}
              onChange={(e) => setNewCatIcon(e.target.value)}
              className="glass-input text-sm bg-indigo-950/20 border-white/10 text-white font-sans"
            >
              {availableIcons.map(icon => (
                <option key={icon} value={icon} className="bg-slate-900">{icon}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-400">代表顏色</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={newCatColor}
                onChange={(e) => setNewCatColor(e.target.value)}
                className="w-10 h-10 p-0 rounded-lg border-0 cursor-pointer overflow-hidden bg-transparent"
              />
              <div className="flex flex-wrap gap-1">
                {availableColors.slice(0, 6).map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewCatColor(c)}
                    className="w-5 h-5 rounded-full border border-white/20"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <button type="submit" className="glass-button py-2.5 text-sm flex items-center justify-center gap-1">
            <Plus size={16} /> 新增分類
          </button>
        </form>

        {/* Categories List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-2">支出分類</h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {categories.filter(c => c.type === 'expense').map(c => (
                <div key={c.id} className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="font-medium text-sm">{c.name}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteCategory(c.id)}
                    className="text-gray-400 hover:text-red-400 p-1"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-2">收入分類</h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {categories.filter(c => c.type === 'income').map(c => (
                <div key={c.id} className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="font-medium text-sm">{c.name}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteCategory(c.id)}
                    className="text-gray-400 hover:text-red-400 p-1"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="glass-panel p-6">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Download className="text-indigo-400" /> 系統資料備份與還原
        </h2>
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 mb-4 text-xs text-indigo-200 space-y-2">
          <p className="font-bold flex items-center gap-1.5 text-indigo-300">
            📊 資料庫儲存媒介說明：
          </p>
          <p>
            本帳本完全採用未來性的 <strong>IndexedDB (瀏覽器本地關聯資料庫)</strong> 進行儲存，儲存空間上限可隨您的硬碟剩餘空間彈性調整（通常最大可達數 GB），
            完全避開了傳統 LocalStorage 僅有 5MB 的容量限制。
          </p>
          {storageEstimate && (
            <div className="pt-2 border-t border-indigo-500/10 flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-mono text-indigo-300/90">
              <div>目前已用空間：<span className="font-bold text-white">{storageEstimate.usage}</span></div>
              <div>可用最大配額：<span className="font-bold text-white">{storageEstimate.quota}</span></div>
              <div>配額使用佔比：<span className="font-bold text-white">{storageEstimate.percent}</span></div>
            </div>
          )}
        </div>
        <p className="text-sm text-gray-400 mb-4">
          由於您的記帳交易與單據相片皆完整儲存在本機 IndexedDB 內，我們建議您定期匯出備份，以防瀏覽器快取被清理而造成資料遺失。
        </p>
        <div className="flex flex-wrap gap-4">
          <button
            onClick={handleExportData}
            className="glass-button glass-button-secondary flex-1 py-3"
          >
            <Download size={18} /> 匯出資料備份 (JSON)
          </button>
          
          <label className="glass-button glass-button-secondary flex-1 py-3 cursor-pointer text-center flex items-center justify-center gap-2">
            <Upload size={18} /> 匯入備份檔案
            <input
              type="file"
              accept=".json"
              onChange={handleImportData}
              className="hidden"
            />
          </label>
          
          <button
            onClick={handleResetDatabase}
            className="glass-button glass-button-danger w-full md:w-auto px-6 py-3"
          >
            <RotateCcw size={18} /> 重設資料庫
          </button>
        </div>
      </div>

      {/* MOF Guide Modal */}
      {showMofGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in font-sans">
          <div className="glass-panel w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-6 relative animate-slide-up shadow-2xl border-indigo-500/20">
            <button
              type="button"
              onClick={() => setShowMofGuide(false)}
              className="absolute right-4 top-4 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <X size={20} />
            </button>

            <div className="border-b border-white/10 pb-3">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                🧾 財政部電子發票 API 申請指南
              </h3>
              <p className="text-xs text-gray-400 mt-1">協助您合法向財政部申請 App ID 與 API Key 設定資料</p>
            </div>

            <div className="space-y-4 text-sm leading-relaxed text-gray-300">
              {/* Alert */}
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">
                <strong className="block text-sm mb-1 text-amber-300 font-bold">⚠️ 重要申請資格限制</strong>
                自 2025 年 3 月底起，財政部已<strong>停止受理個人名義</strong>申請電子發票應用 API。目前僅限以下資格者申請：
                <ul className="list-disc list-inside mt-1.5 space-y-1 text-amber-300/80">
                  <li><strong>營業人</strong>（即公司、獨資或合夥行號，需有稅籍登記）</li>
                  <li><strong>政府機關、公立學校、非營利組織</strong></li>
                  <li><strong>合法登記之軟體開發商/廠商</strong>（開發記帳或對獎服務供公眾使用）</li>
                </ul>
              </div>

              {/* Requirements */}
              <div className="space-y-2">
                <h4 className="font-bold text-gray-200 text-base">📋 申請前準備資料</h4>
                <ul className="list-decimal list-inside space-y-1 text-xs text-gray-400 pl-1">
                  <li>公司或組織的<strong>統一編號 (VAT)</strong>。</li>
                  <li>實體<strong>工商憑證卡片</strong>（需搭配讀卡機）或組織憑證（供登入使用）。</li>
                  <li>已開通之財政部電子發票平台<strong>營業人帳號密碼</strong>。</li>
                </ul>
              </div>

              {/* Steps */}
              <div className="space-y-3">
                <h4 className="font-bold text-gray-200 text-base">🚀 申請五步驟</h4>
                
                <div className="space-y-3 font-sans text-xs">
                  <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                    <span className="font-bold text-indigo-400 block">第一步：登入電子發票整合服務平台</span>
                    <p className="text-gray-400">
                      使用電腦連接讀卡機並插上工商憑證，進入 <a href="https://www.einvoice.nat.gov.tw/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline hover:text-indigo-300">財政部電子發票整合服務平台</a>，以「營業人」身分登入。
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                    <span className="font-bold text-indigo-400 block">第二步：進入應用 API 申請選單</span>
                    <p className="text-gray-400">
                      登入後，點選選單中的「營業人功能」→「電子發票應用 API 申請」或「系統介接申請」以開啟表單。
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                    <span className="font-bold text-indigo-400 block">第三步：填寫應用程式基本資訊</span>
                    <p className="text-gray-400">
                      填寫應用程式名稱（如「個人智慧記帳助理」）及介接目的（如「讀取電子發票證明聯明細以匯入個人記帳紀錄」）。
                      在介接 API 項目中，務必勾選<strong>「查詢發票明細 (qryInvDetail)」</strong>。
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                    <span className="font-bold text-indigo-400 block">第四步：送出申請並等待審查</span>
                    <p className="text-gray-400">
                      送出申請後，國稅局與財政部財政資訊中心會進行資格審查，通常需時 **3 至 7 個工作天**。審查通過後，系統會發送 E-mail 審核通過通知。
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                    <span className="font-bold text-indigo-400 block">第五步：複製 App ID 與 API Key 設定資料</span>
                    <p className="text-gray-400">
                      審核通過後，重新登入整合服務平台的 API 申請查詢選單，即可查看到您的專屬 <strong>App ID</strong>。
                      點選顯示金鑰，即可取得用於 HMAC-SHA256 簽章加密的 <strong>API Key</strong>（金鑰種子）。請複製這兩組資料並貼回記帳設定頁面即可啟用！
                    </p>
                  </div>
                </div>
              </div>

              {/* Notice */}
              <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/20 text-[11px] text-indigo-300">
                💡 <strong>小提示：</strong> 申請到的 App ID 與 API Key 屬於您或您公司的私密憑證，請勿隨意分享給他人。本記帳軟體完全在瀏覽器本地運行，您的金鑰僅會保存在您自己電腦的本地快取中，不會傳送給任何第三方。
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowMofGuide(false)}
                className="glass-button px-6 py-2 text-sm font-semibold"
              >
                我瞭解了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
