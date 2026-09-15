import React, { useState } from 'react';
import { db, type Account, generateUUID } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Wallet, Landmark, CreditCard, HelpCircle, Plus, Send, Trash2, Edit } from 'lucide-react';

interface AccountsManagerProps {
  onRefreshData: () => void;
}

export const AccountsManager: React.FC<AccountsManagerProps> = ({ onRefreshData }) => {
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  
  // Add Account form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'cash' | 'credit_card' | 'bank_account' | 'others'>('cash');
  const [balance, setBalance] = useState('');
  const [color, setColor] = useState('#00cec9');

  // Transfer form state
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');

  // Editing account state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBalance, setEditBalance] = useState('');

  const colors = ['#00cec9', '#0984e3', '#d63031', '#ffeaa7', '#e84393', '#6c5ce7', '#2d3436'];

  const getAccountIcon = (type: string) => {
    switch (type) {
      case 'cash':
        return <Wallet className="text-emerald-400" size={24} />;
      case 'bank_account':
        return <Landmark className="text-blue-400" size={24} />;
      case 'credit_card':
        return <CreditCard className="text-rose-400" size={24} />;
      default:
        return <HelpCircle className="text-gray-400" size={24} />;
    }
  };

  const getAccountTypeLabel = (type: string) => {
    switch (type) {
      case 'cash': return '現金袋';
      case 'bank_account': return '儲蓄卡';
      case 'credit_card': return '信用卡';
      default: return '其他帳戶';
    }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const id = `acc_${generateUUID()}`;
    await db.accounts.add({
      id,
      name,
      type,
      balance: parseFloat(balance) || 0,
      color
    });

    setName('');
    setBalance('');
    setShowAddForm(false);
    onRefreshData();
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(transferAmount);
    if (!fromAccount || !toAccount || !amountNum || amountNum <= 0) {
      alert('請填寫完整轉帳資訊！');
      return;
    }

    if (fromAccount === toAccount) {
      alert('來源帳戶與目的帳戶不能相同！');
      return;
    }

    const fromAcc = accounts.find(a => a.id === fromAccount);
    const toAcc = accounts.find(a => a.id === toAccount);

    if (!fromAcc || !toAcc) return;

    await db.transaction('rw', [db.accounts, db.transactions], async () => {
      await db.accounts.update(fromAccount, { balance: fromAcc.balance - amountNum });
      await db.accounts.update(toAccount, { balance: toAcc.balance + amountNum });

      await db.transactions.add({
        id: generateUUID(),
        date: new Date().toISOString().split('T')[0],
        type: 'transfer',
        amount: amountNum,
        category: '轉帳',
        account: fromAccount,
        toAccount: toAccount,
        note: transferNote || `從 ${fromAcc.name} 轉帳至 ${toAcc.name}`,
        createdAt: Date.now()
      });
    });

    setTransferAmount('');
    setTransferNote('');
    setShowTransferForm(false);
    onRefreshData();
    alert('轉帳成功！');
  };

  const handleDeleteAccount = async (id: string) => {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;

    // Check if any transactions reference this account (as source or destination)
    const referencingTxs = await db.transactions
      .filter(tx => tx.account === id || tx.toAccount === id)
      .count();
    if (referencingTxs > 0) {
      const proceed = confirm(
        `帳戶「${acc.name}」目前有 ${referencingTxs} 筆交易紀錄引用它。` +
        (id === 'acc_card' ? '' : '\n') +
        `刪除後，這些交易將顯示為「未指定」帳戶，統計中的資產/負債計算也會排除此帳戶。\n\n` +
        `請先確認這些交易已歸類到其他帳戶，或一併刪除。確定要繼續嗎？`
      );
      if (!proceed) return;
    } else {
      if (!confirm(`確定要刪除帳戶「${acc.name}」嗎？（目前無交易引用此帳戶）`)) return;
    }

    await db.accounts.delete(id);
    onRefreshData();
  };

  const handleStartEdit = (acc: Account) => {
    setEditingId(acc.id);
    setEditName(acc.name);
    setEditBalance(acc.balance.toString());
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) return;
    await db.accounts.update(id, {
      name: editName,
      balance: parseFloat(editBalance) || 0
    });
    setEditingId(null);
    onRefreshData();
  };

  // Group accounts by Assets vs Liabilities
  // Credit cards are usually negative/liabilities, but we filter by type.
  const assetAccounts = accounts.filter(acc => acc.type !== 'credit_card');
  const liabilityAccounts = accounts.filter(acc => acc.type === 'credit_card');

  const totalAssets = assetAccounts.reduce((sum, acc) => sum + (acc.balance >= 0 ? acc.balance : 0), 0);
  const totalLiabilities = liabilityAccounts.reduce((sum, acc) => sum + Math.abs(acc.balance), 0);
  const netWorth = totalAssets - totalLiabilities;

  return (
    <div className="space-y-6 animate-slide-up pb-10 text-xs">
      {/* 1. Scoreboards */}
      <div className="glass-panel p-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
        <div>
          <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase block mb-1">淨資產 (TWD)</span>
          <span className={`text-2xl font-black ${netWorth >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            ${netWorth.toLocaleString()}
          </span>
        </div>
        <div className="border-t md:border-t-0 md:border-l md:border-r border-white/5 py-4 md:py-0">
          <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase block mb-1">總資產 (存款/現金)</span>
          <span className="text-xl font-bold text-blue-400">
            ${totalAssets.toLocaleString()}
          </span>
        </div>
        <div>
          <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase block mb-1">總負債 (信用卡未結)</span>
          <span className="text-xl font-bold text-rose-400">
            ${totalLiabilities.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Control Actions */}
      <div className="flex gap-4">
        <button
          onClick={() => {
            setShowAddForm(!showAddForm);
            setShowTransferForm(false);
          }}
          className="glass-button flex-1 py-3 text-xs"
        >
          <Plus size={16} /> 新建金融帳戶
        </button>
        <button
          onClick={() => {
            setShowTransferForm(!showTransferForm);
            setShowAddForm(false);
          }}
          className="glass-button glass-button-secondary flex-1 py-3 text-xs"
        >
          <Send size={16} /> 帳戶互轉資金
        </button>
      </div>

      {/* Add Account form */}
      {showAddForm && (
        <form onSubmit={handleAddAccount} className="glass-panel p-5 space-y-4 animate-scale-in">
          <h3 className="text-sm font-bold">建立新資產/信用卡卡片</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-gray-400">帳戶名稱</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：國泰世華、LINE Bank、富邦信用卡"
                className="glass-input text-xs"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-400">帳戶類型</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="glass-input text-xs"
              >
                <option value="cash">現金</option>
                <option value="bank_account">銀行帳戶 (資產)</option>
                <option value="credit_card">信用卡 (負債)</option>
                <option value="others">其他</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-400">目前餘額 / 信用卡額度 (TWD)</label>
              <input
                type="number"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="0"
                className="glass-input text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-400">卡面色調</label>
              <div className="flex gap-2 items-center h-full">
                {colors.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="glass-button glass-button-secondary py-1.5 px-4"
            >
              取消
            </button>
            <button type="submit" className="glass-button py-1.5 px-5 font-bold">
              建立卡片
            </button>
          </div>
        </form>
      )}

      {/* Transfer Form */}
      {showTransferForm && (
        <form onSubmit={handleTransfer} className="glass-panel p-5 space-y-4 animate-scale-in">
          <h3 className="text-sm font-bold">帳戶互轉資金</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-gray-400">來源帳戶 (轉出)</label>
              <select
                value={fromAccount}
                onChange={(e) => setFromAccount(e.target.value)}
                className="glass-input text-xs"
                required
              >
                <option value="">-- 選擇來源 --</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} (餘額: ${a.balance})</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-400">目的帳戶 (轉入)</label>
              <select
                value={toAccount}
                onChange={(e) => setToAccount(e.target.value)}
                className="glass-input text-xs"
                required
              >
                <option value="">-- 選擇目的 --</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} (餘額: ${a.balance})</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-400">轉帳金額 (TWD)</label>
              <input
                type="number"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                placeholder="0"
                className="glass-input text-xs"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-400">備註</label>
              <input
                type="text"
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                placeholder="預設為帳戶互轉"
                className="glass-input text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowTransferForm(false)}
              className="glass-button glass-button-secondary py-1.5 px-4"
            >
              取消
            </button>
            <button type="submit" className="glass-button py-1.5 px-5 font-bold">
              確認轉帳
            </button>
          </div>
        </form>
      )}

      {/* 2. Visual card layouts split by Assets and Liabilities */}
      <div className="space-y-6">
        {/* Assets Section */}
        <div>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">本期資產 (存款/現金袋)</h3>
          {assetAccounts.length === 0 ? (
            <p className="text-gray-500 text-xs pl-1">尚無資產帳戶，點擊上方按鈕建立。</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {assetAccounts.map(acc => (
                <div
                  key={acc.id}
                  className="glass-panel p-5 relative overflow-hidden flex flex-col justify-between h-[155px] hover:scale-[1.02] transition-all duration-300"
                  style={{
                    background: `linear-gradient(135deg, rgba(25, 18, 52, 0.7) 0%, ${acc.color}15 100%)`,
                    border: '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  {/* Metallic gold IC chip mockup */}
                  <div className="absolute right-6 top-6 w-9 h-7 rounded bg-gradient-to-tr from-yellow-600 via-yellow-400 to-yellow-600 border border-yellow-700/20 shadow-inner flex flex-col justify-between p-1 opacity-70">
                    <div className="border-b border-yellow-700/30 h-1" />
                    <div className="border-b border-yellow-700/30 h-1" />
                    <div className="border-b border-yellow-700/30 h-1" />
                  </div>

                  {/* Header info */}
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      {getAccountIcon(acc.type)}
                      <div>
                        {editingId === acc.id ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="glass-input py-0.5 px-1.5 text-xs max-w-[110px]"
                          />
                        ) : (
                          <h4 className="font-extrabold text-sm text-white tracking-wide">{acc.name}</h4>
                        )}
                        <span className="text-[9px] text-gray-400 block">{getAccountTypeLabel(acc.type)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Card mockup layout number */}
                  <p className="text-[10px] text-gray-500 font-mono tracking-widest mt-1">
                    **** **** **** {acc.id.slice(-4)}
                  </p>

                  {/* Footer actions and balance */}
                  <div className="flex justify-between items-end mt-4">
                    <div>
                      <span className="text-[9px] text-gray-400 block">帳戶儲蓄</span>
                      {editingId === acc.id ? (
                        <input
                          type="number"
                          value={editBalance}
                          onChange={(e) => setEditBalance(e.target.value)}
                          className="glass-input py-0.5 px-1.5 text-xs max-w-[90px]"
                        />
                      ) : (
                        <span className="text-lg font-black text-emerald-400">${acc.balance.toLocaleString()}</span>
                      )}
                    </div>

                    <div className="flex gap-1.5 z-10">
                      {editingId === acc.id ? (
                        <button
                          onClick={() => handleSaveEdit(acc.id)}
                          className="text-[10px] text-emerald-400 hover:underline font-bold"
                        >
                          儲存
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStartEdit(acc)}
                          className="text-gray-500 hover:text-white p-1"
                        >
                          <Edit size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteAccount(acc.id)}
                        className="text-gray-500 hover:text-red-400 p-1"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Liabilities Section */}
        <div>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">本期負債 (信用卡帳單)</h3>
          {liabilityAccounts.length === 0 ? (
            <p className="text-gray-500 text-xs pl-1">尚無負債或信用卡帳戶。</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {liabilityAccounts.map(acc => (
                <div
                  key={acc.id}
                  className="glass-panel p-5 relative overflow-hidden flex flex-col justify-between h-[155px] hover:scale-[1.02] transition-all duration-300"
                  style={{
                    background: `linear-gradient(135deg, rgba(25, 18, 52, 0.7) 0%, ${acc.color}15 100%)`,
                    border: '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  {/* Metallic gold IC chip mockup */}
                  <div className="absolute right-6 top-6 w-9 h-7 rounded bg-gradient-to-tr from-yellow-600 via-yellow-400 to-yellow-600 border border-yellow-700/20 shadow-inner flex flex-col justify-between p-1 opacity-70">
                    <div className="border-b border-yellow-700/30 h-1" />
                    <div className="border-b border-yellow-700/30 h-1" />
                    <div className="border-b border-yellow-700/30 h-1" />
                  </div>

                  {/* Header info */}
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      {getAccountIcon(acc.type)}
                      <div>
                        {editingId === acc.id ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="glass-input py-0.5 px-1.5 text-xs max-w-[110px]"
                          />
                        ) : (
                          <h4 className="font-extrabold text-sm text-white tracking-wide">{acc.name}</h4>
                        )}
                        <span className="text-[9px] text-gray-400 block">{getAccountTypeLabel(acc.type)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Card mockup layout number */}
                  <p className="text-[10px] text-gray-500 font-mono tracking-widest mt-1">
                    **** **** **** {acc.id.slice(-4)}
                  </p>

                  {/* Footer actions and balance */}
                  <div className="flex justify-between items-end mt-4">
                    <div>
                      <span className="text-[9px] text-gray-400 block">信用卡未結帳單</span>
                      {editingId === acc.id ? (
                        <input
                          type="number"
                          value={editBalance}
                          onChange={(e) => setEditBalance(e.target.value)}
                          className="glass-input py-0.5 px-1.5 text-xs max-w-[90px]"
                        />
                      ) : (
                        <span className="text-lg font-black text-rose-400">${Math.abs(acc.balance).toLocaleString()}</span>
                      )}
                    </div>

                    <div className="flex gap-1.5 z-10">
                      {editingId === acc.id ? (
                        <button
                          onClick={() => handleSaveEdit(acc.id)}
                          className="text-[10px] text-emerald-400 hover:underline font-bold"
                        >
                          儲存
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStartEdit(acc)}
                          className="text-gray-500 hover:text-white p-1"
                        >
                          <Edit size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteAccount(acc.id)}
                        className="text-gray-500 hover:text-red-400 p-1"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
