import React, { useState } from 'react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title
} from 'chart.js';
import { Calendar, TrendingUp, DollarSign, PieChart as PieIcon, ChevronRight, X } from 'lucide-react';
import { LucideIcon } from '../App';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title
);

export const Stats: React.FC = () => {
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  // Filter Period states
  const [timeFilter, setTimeFilter] = useState<'week' | 'month' | 'year' | 'custom'>('month');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => {
    const d = new Date();
    // Default to Monday of current week
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d.setDate(diff));
    return mon.toISOString().split('T')[0];
  });
  const [customStart, setCustomStart] = useState(() => new Date().toISOString().split('T')[0]);
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().split('T')[0]);

  const [activeTab, setActiveTab] = useState<'expense' | 'income'>('expense');

  // Drill-down Modal state
  const [drillDownCategory, setDrillDownCategory] = useState<string | null>(null);

  // Helper date parsing/matching functions
  const getFilteredTransactions = () => {
    return transactions.filter(t => {
      if (timeFilter === 'month') {
        return t.date.startsWith(selectedMonth);
      } else if (timeFilter === 'year') {
        return t.date.startsWith(selectedYear);
      } else if (timeFilter === 'week') {
        const tDate = new Date(t.date);
        const wStart = new Date(selectedWeekStart);
        const wEnd = new Date(selectedWeekStart);
        wEnd.setDate(wEnd.getDate() + 6);
        return tDate >= wStart && tDate <= wEnd;
      } else {
        // Custom
        return t.date >= customStart && t.date <= customEnd;
      }
    });
  };

  const filteredTransactions = getFilteredTransactions();

  // Calculated Stats
  const totalExpense = filteredTransactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalIncome = filteredTransactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const netBalance = totalIncome - totalExpense;

  // Group by category for Doughnut chart
  const categoryTotals: { [key: string]: number } = {};
  const currentTypeTransactions = filteredTransactions.filter(t => t.type === activeTab);

  currentTypeTransactions.forEach(t => {
    const catObj = categories.find(c => c.id === t.category || c.name === t.category);
    const catName = catObj ? catObj.name : t.category;
    categoryTotals[catName] = (categoryTotals[catName] || 0) + t.amount;
  });

  const sortedCategories = Object.entries(categoryTotals)
    .map(([name, amount]) => {
      const catObj = categories.find(c => c.name === name);
      return {
        id: catObj?.id || name,
        name,
        amount,
        color: catObj?.color || '#b2bec3',
        percentage: currentTypeTransactions.reduce((sum, t) => sum + t.amount, 0) > 0
          ? (amount / currentTypeTransactions.reduce((sum, t) => sum + t.amount, 0)) * 100
          : 0
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const doughnutData = {
    labels: sortedCategories.map(c => c.name),
    datasets: [
      {
        data: sortedCategories.map(c => c.amount),
        backgroundColor: sortedCategories.map(c => c.color),
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1.5,
        hoverOffset: 8,
      },
    ],
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          color: '#b2bec3',
          font: { family: 'Noto Sans TC', size: 11 },
          padding: 10
        }
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const label = context.label || '';
            const value = context.raw || 0;
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
            return ` ${label}: $${value.toLocaleString()} (${percentage}%)`;
          }
        }
      }
    }
  };

  // Group trend chart by day (for Month / Week / Custom) or month (for Year)
  let trendLabels: string[] = [];
  let trendExpenses: number[] = [];
  let trendIncome: number[] = [];

  if (timeFilter === 'year') {
    // 12 Months
    trendLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);
    trendExpenses = Array(12).fill(0);
    trendIncome = Array(12).fill(0);

    filteredTransactions.forEach(t => {
      const monthIdx = parseInt(t.date.split('-')[1]) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        if (t.type === 'expense') trendExpenses[monthIdx] += t.amount;
        else if (t.type === 'income') trendIncome[monthIdx] += t.amount;
      }
    });
  } else if (timeFilter === 'week') {
    // 7 Days of the selected week
    trendLabels = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
    trendExpenses = Array(7).fill(0);
    trendIncome = Array(7).fill(0);

    const weekStart = new Date(selectedWeekStart);
    filteredTransactions.forEach(t => {
      const tDate = new Date(t.date);
      // Days difference from Monday
      const diffTime = tDate.getTime() - weekStart.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays < 7) {
        if (t.type === 'expense') trendExpenses[diffDays] += t.amount;
        else if (t.type === 'income') trendIncome[diffDays] += t.amount;
      }
    });
  } else if (timeFilter === 'month') {
    // Days in current selected month
    const [y, m] = selectedMonth.split('-');
    const daysInMonth = new Date(parseInt(y), parseInt(m), 0).getDate();
    trendLabels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
    trendExpenses = Array(daysInMonth).fill(0);
    trendIncome = Array(daysInMonth).fill(0);

    filteredTransactions.forEach(t => {
      const day = parseInt(t.date.split('-')[2]);
      if (day >= 1 && day <= daysInMonth) {
        if (t.type === 'expense') trendExpenses[day - 1] += t.amount;
        else if (t.type === 'income') trendIncome[day - 1] += t.amount;
      }
    });
  } else {
    // Custom dates - group by individual dates in list
    const dates = Array.from(new Set(filteredTransactions.map(t => t.date))).sort();
    trendLabels = dates.map(d => d.slice(5)); // Show MM-DD
    trendExpenses = Array(dates.length).fill(0);
    trendIncome = Array(dates.length).fill(0);

    filteredTransactions.forEach(t => {
      const idx = dates.indexOf(t.date);
      if (idx !== -1) {
        if (t.type === 'expense') trendExpenses[idx] += t.amount;
        else if (t.type === 'income') trendIncome[idx] += t.amount;
      }
    });
  }

  const barData = {
    labels: trendLabels,
    datasets: [
      {
        label: '支出 (TWD)',
        data: trendExpenses,
        backgroundColor: 'rgba(255, 118, 117, 0.6)',
        borderColor: 'rgba(255, 118, 117, 1)',
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: '收入 (TWD)',
        data: trendIncome,
        backgroundColor: 'rgba(85, 239, 196, 0.6)',
        borderColor: 'rgba(85, 239, 196, 1)',
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#b2bec3', font: { family: 'Noto Sans TC' } } }
    },
    scales: {
      x: {
        ticks: { color: '#636e72', font: { family: 'Outfit', size: 9 } },
        grid: { display: false }
      },
      y: {
        ticks: { color: '#636e72', font: { family: 'Outfit', size: 9 } },
        grid: { color: 'rgba(255, 255, 255, 0.05)' }
      }
    }
  };

  // Category drill-down list matching selected filters
  const drillDownTransactions = filteredTransactions.filter(
    t => (t.category === drillDownCategory || categories.find(c => c.id === t.category)?.name === drillDownCategory) && t.type === activeTab
  ).sort((a, b) => b.date.localeCompare(a.date));

  // Get available months / years for options
  const availableMonths = Array.from(new Set(transactions.map(t => t.date.substring(0, 7)).concat(selectedMonth))).sort().reverse();
  const availableYears = Array.from(new Set(transactions.map(t => t.date.substring(0, 4)).concat(selectedYear))).sort().reverse();
  const availableWeekStarts = Array.from(new Set(transactions.map(t => {
    // compute its week Monday
    const d = new Date(t.date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d.setDate(diff));
    return mon.toISOString().split('T')[0];
  }).concat(selectedWeekStart))).sort().reverse();

  return (
    <div className="space-y-6 animate-slide-up pb-10">
      {/* 1. Header Navigation Tabs: 週 / 月 / 年 / 自訂 */}
      <div className="glass-panel p-4 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="text-indigo-400" /> 記帳報表與穿透分析
          </h2>
          
          <div className="flex bg-white/5 rounded-xl p-0.5 border border-white/5 w-full md:w-auto">
            {[
              { id: 'week', label: '週' },
              { id: 'month', label: '月' },
              { id: 'year', label: '年' },
              { id: 'custom', label: '自訂' }
            ].map(period => (
              <button
                key={period.id}
                onClick={() => setTimeFilter(period.id as any)}
                className={`flex-1 md:flex-initial py-1.5 px-4 rounded-lg font-bold text-xs transition-all ${
                  timeFilter === period.id 
                    ? 'bg-indigo-600 text-white shadow shadow-indigo-500/10' 
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {period.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Dates Filter Input based on selection */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/5 text-xs text-gray-300">
          <Calendar size={14} className="text-indigo-400" />
          
          {timeFilter === 'week' && (
            <div className="flex items-center gap-2">
              <span>選擇週別 (起點週一):</span>
              <select
                value={selectedWeekStart}
                onChange={(e) => setSelectedWeekStart(e.target.value)}
                className="glass-input text-xs py-1 px-3 border-white/10"
              >
                {availableWeekStarts.map(w => {
                  const end = new Date(w);
                  end.setDate(end.getDate() + 6);
                  const endStr = end.toISOString().split('T')[0].slice(5);
                  return <option key={w} value={w}>{`${w} 至 ${endStr}`}</option>;
                })}
              </select>
            </div>
          )}

          {timeFilter === 'month' && (
            <div className="flex items-center gap-2">
              <span>選擇月份:</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="glass-input text-xs py-1 px-3 border-white/10"
              >
                {availableMonths.map(m => {
                  const [y, mon] = m.split('-');
                  return <option key={m} value={m}>{`${y} 年 ${mon} 月`}</option>;
                })}
              </select>
            </div>
          )}

          {timeFilter === 'year' && (
            <div className="flex items-center gap-2">
              <span>選擇年份:</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="glass-input text-xs py-1 px-3 border-white/10"
              >
                {availableYears.map(y => (
                  <option key={y} value={y}>{`${y} 年`}</option>
                ))}
              </select>
            </div>
          )}

          {timeFilter === 'custom' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span>日期區間:</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="glass-input text-xs py-1 px-2.5 border-white/10"
              />
              <span>至</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="glass-input text-xs py-1 px-2.5 border-white/10"
              />
            </div>
          )}
        </div>
      </div>

      {/* 2. Total Board Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-5 text-center border-b-4 border-b-rose-500/50">
          <span className="text-xs font-semibold text-gray-400 block mb-1">期間總支出</span>
          <span className="text-2xl font-black text-rose-400">${totalExpense.toLocaleString()}</span>
        </div>
        <div className="glass-panel p-5 text-center border-b-4 border-b-emerald-500/50">
          <span className="text-xs font-semibold text-gray-400 block mb-1">期間總收入</span>
          <span className="text-2xl font-black text-emerald-400">${totalIncome.toLocaleString()}</span>
        </div>
        <div className="glass-panel p-5 text-center border-b-4 border-b-indigo-500/50">
          <span className="text-xs font-semibold text-gray-400 block mb-1">期間結餘</span>
          <span className={`text-2xl font-black ${netBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {netBalance >= 0 ? '+' : ''}${netBalance.toLocaleString()}
          </span>
        </div>
      </div>

      {/* 3. Charts Area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Doughnut Chart */}
        <div className="glass-panel p-5 flex flex-col min-h-[400px]">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-base font-bold flex items-center gap-1.5 text-gray-300">
              <PieIcon size={16} className="text-indigo-400" /> 分類比率分析
            </h3>
            
            {/* Toggle Expense / Income */}
            <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5 text-[10px]">
              <button
                onClick={() => setActiveTab('expense')}
                className={`py-1 px-3 rounded-md font-bold transition-all ${
                  activeTab === 'expense'
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : 'text-gray-400 hover:text-white border border-transparent'
                }`}
              >
                支出
              </button>
              <button
                onClick={() => setActiveTab('income')}
                className={`py-1 px-3 rounded-md font-bold transition-all ${
                  activeTab === 'income'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-gray-400 hover:text-white border border-transparent'
                }`}
              >
                收入
              </button>
            </div>
          </div>

          {sortedCategories.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-xs">
              <span>此期間尚無任何{activeTab === 'expense' ? '支出' : '收入'}明細數據</span>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-between">
              <div className="h-[200px] relative">
                <Doughnut data={doughnutData} options={doughnutOptions} />
              </div>
              
              {/* Categories item lists with click for drilldown */}
              <div className="mt-4 space-y-2 max-h-[140px] overflow-y-auto pr-1">
                {sortedCategories.map(cat => (
                  <div
                    key={cat.id}
                    onClick={() => setDrillDownCategory(cat.name)}
                    className="text-xs space-y-1 cursor-pointer p-1.5 rounded-lg hover:bg-white/5 transition-all group"
                    title="點擊穿透查看明細"
                  >
                    <div className="flex justify-between font-semibold items-center">
                      <span className="text-gray-300 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: cat.color }} />
                        {cat.name}
                        <ChevronRight size={12} className="text-gray-600 group-hover:text-indigo-400 transition-all opacity-0 group-hover:opacity-100" />
                      </span>
                      <span className="text-white">
                        ${cat.amount.toLocaleString()} ({cat.percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${cat.percentage}%`, backgroundColor: cat.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Trend Bar Chart */}
        <div className="glass-panel p-5 flex flex-col min-h-[400px]">
          <h3 className="text-base font-bold flex items-center gap-1.5 mb-4 text-gray-300">
            <DollarSign size={16} className="text-indigo-400" /> 收支趨勢走勢圖
          </h3>
          {filteredTransactions.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-xs">
              <span>此期間無交易明細</span>
            </div>
          ) : (
            <div className="flex-1 h-[300px]">
              <Bar data={barData} options={barOptions} />
            </div>
          )}
        </div>
      </div>

      {/* 4. Drill-Down Category details list Modal popup */}
      {drillDownCategory && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
          <div className="glass-panel w-full max-w-xl p-5 flex flex-col max-h-[80vh] animate-scale-in border border-indigo-500/20">
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <h3 className="font-extrabold text-base flex items-center gap-2 text-indigo-300">
                <LucideIcon name={categories.find(c => c.name === drillDownCategory)?.icon || 'Tag'} style={{ color: categories.find(c => c.name === drillDownCategory)?.color }} />
                「{drillDownCategory}」分類明細穿透
              </h3>
              <button onClick={() => setDrillDownCategory(null)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto mt-4 pr-1 space-y-3.5">
              {drillDownTransactions.length === 0 ? (
                <p className="text-center text-xs text-gray-500">無記錄</p>
              ) : (
                drillDownTransactions.map(tx => {
                  const accObj = accounts.find(a => a.id === tx.account);
                  return (
                    <div key={tx.id} className="p-3 rounded-xl bg-white/3 border border-white/5 flex justify-between items-center text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-300">{tx.date}</span>
                          <span className="text-[9px] text-gray-500 bg-white/5 px-1 py-0.2 rounded">
                            {accObj ? accObj.name : '帳戶'}
                          </span>
                        </div>
                        {tx.note && <p className="text-gray-500 mt-1">{tx.note}</p>}
                        
                        {/* Display item details if OCR exists */}
                        {tx.items && tx.items.length > 0 && (
                          <div className="mt-2 pl-2 border-l border-white/10 space-y-0.5 text-[10px] text-gray-400">
                            {tx.items.map((it, idx) => (
                              <div key={idx}>{it.name} x{it.qty} (${it.total})</div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 font-bold text-sm">
                        <span className={tx.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'}>
                          {tx.type === 'expense' ? '-' : '+'}${tx.amount}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-white/5 mt-4 text-right">
              <button
                onClick={() => setDrillDownCategory(null)}
                className="glass-button py-1.5 px-4 text-xs font-bold"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
