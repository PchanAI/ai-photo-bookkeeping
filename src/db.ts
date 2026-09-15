import Dexie, { type Table } from 'dexie';

export interface TransactionItem {
  name: string;
  qty: number;
  price: number; // in TWD
  total: number; // in TWD
  originalPrice?: number; // original currency
  originalTotal?: number; // original currency
}

export interface Transaction {
  id: string; // UUID
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  type: 'expense' | 'income' | 'transfer';
  amount: number; // TWD
  originalAmount?: number; // original currency
  originalCurrency?: string; // e.g., JPY, USD
  exchangeRate?: number; // conversion rate (multiply original by rate to get TWD)
  rateExplanation?: string; // e.g., Bank of Taiwan rate on date
  category: string;
  account: string;
  toAccount?: string; // for transfers
  note: string;
  photoId?: string; // references photos table
  photoHash?: string; // Hash of photo base64
  items?: TransactionItem[]; // item details
  invoiceNumber?: string; // Taiwan electronic invoice number (e.g. AB-12345678)
  randomCode?: string; // Taiwan electronic invoice random code (4 digits)
  sellerTaxId?: string; // Seller's VAT / Unified Business Number (8 digits)
  buyerTaxId?: string; // Buyer's VAT / Unified Business Number (8 digits)
  carrier?: string; // Taiwan mobile carrier barcode (e.g. /AB12345)
  createdAt: number;
}

export interface Photo {
  id: string; // UUID
  dataUrl: string; // base64 data url
}

export interface Account {
  id: string; // unique key e.g. cash, card, bank
  name: string;
  type: 'cash' | 'credit_card' | 'bank_account' | 'others';
  balance: number; // current balance in TWD
  color: string;
}

export interface Category {
  id: string;
  name: string;
  type: 'expense' | 'income';
  icon: string; // lucide icon name
  color: string; // CSS color variable or hex
}

class BookKeepingDatabase extends Dexie {
  transactions!: Table<Transaction>;
  photos!: Table<Photo>;
  accounts!: Table<Account>;
  categories!: Table<Category>;

  constructor() {
    super('BookKeepingDatabase');
    this.version(1).stores({
      transactions: 'id, date, type, category, account, photoId, createdAt',
      photos: 'id',
      accounts: 'id, name, type',
      categories: 'id, name, type',
    });
    this.version(2).stores({
      transactions: 'id, date, type, category, account, photoId, photoHash, createdAt',
      photos: 'id',
      accounts: 'id, name, type',
      categories: 'id, name, type',
    });
    this.version(3).stores({
      transactions: 'id, date, type, category, account, photoId, photoHash, invoiceNumber, createdAt',
      photos: 'id',
      accounts: 'id, name, type',
      categories: 'id, name, type',
    });
  }
}

export const db = new BookKeepingDatabase();

// Helper to generate UUID
export function generateUUID(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
}

// Initial default data seed helper
export async function seedDefaultData() {
  const categoryCount = await db.categories.count();
  if (categoryCount === 0) {
    const defaultCategories: Category[] = [
      // Expenses
      { id: 'cat_food', name: '餐飲食品', type: 'expense', icon: 'Utensils', color: '#ff7675' },
      { id: 'cat_shopping', name: '購物消費', type: 'expense', icon: 'ShoppingBag', color: '#74b9ff' },
      { id: 'cat_transport', name: '交通出行', type: 'expense', icon: 'Car', color: '#55efc4' },
      { id: 'cat_entertainment', name: '娛樂消遣', type: 'expense', icon: 'Gamepad2', color: '#a29bfe' },
      { id: 'cat_housing', name: '居家生活', type: 'expense', icon: 'Home', color: '#ffeaa7' },
      { id: 'cat_medical', name: '醫療保健', type: 'expense', icon: 'HeartPulse', color: '#ff8787' },
      { id: 'cat_education', name: '教育學習', type: 'expense', icon: 'BookOpen', color: '#81ecec' },
      { id: 'cat_others_exp', name: '其他支出', type: 'expense', icon: 'MoreHorizontal', color: '#b2bec3' },
      // Income
      { id: 'cat_salary', name: '薪資收入', type: 'income', icon: 'Briefcase', color: '#00b894' },
      { id: 'cat_investment', name: '投資理財', type: 'income', icon: 'TrendingUp', color: '#0984e3' },
      { id: 'cat_parttime', name: '兼職外快', type: 'income', icon: 'Sparkles', color: '#fdcb6e' },
      { id: 'cat_others_inc', name: '其他收入', type: 'income', icon: 'Coins', color: '#fd79a8' },
    ];
    await db.categories.bulkAdd(defaultCategories);
  }

  const accountCount = await db.accounts.count();
  if (accountCount === 0) {
    const defaultAccounts: Account[] = [
      { id: 'acc_cash', name: '現金', type: 'cash', balance: 5000, color: '#00cec9' },
      { id: 'acc_bank', name: '銀行帳戶', type: 'bank_account', balance: 50000, color: '#0984e3' },
      { id: 'acc_card', name: '信用卡', type: 'credit_card', balance: -2000, color: '#d63031' },
    ];
    await db.accounts.bulkAdd(defaultAccounts);
  }
}
