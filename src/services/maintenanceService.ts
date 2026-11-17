import { supabase } from '../lib/supabase';
import { KEY_TO_TABLE_MAP, supabaseStorage } from '../database/supabaseStorage';
import { eventBus } from './eventBus';

export interface BackupPayload { tables: Record<string, unknown[]>; kv: Record<string, unknown>; replaceKv: boolean; }
export interface CloudBackup extends BackupPayload {
  format: 'erp-cloud-backup'; version: '4.0'; systemName: string; exportedAt: string; revision: string;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const safeKey = (k: string) => /^[a-zA-Z0-9_]+$/.test(k) && !/password|token|session|credential|^sb_|^__qa_|^jkr_wallet_lock_/i.test(k) &&
  !['users','current_user','auth_user','current_dept','theme','font_size','active_tabs','active_tab_id','sidebar_groups'].includes(k);
const cleanKey = (key: string) => key.replace(/^nzm_jkr_/, '');
const allowedTables = new Set(Object.values(KEY_TO_TABLE_MAP).filter(t => t !== 'users'));

// Legacy structured fields are mapped explicitly; auth and native localStorage
// dumps are never applied to browser storage or to identity tables.
const legacyFields: Record<string, string> = {
  "settings": "SETTINGS",
  "users": "USERS",
  "customers": "CUSTOMERS",
  "customersRetail": "CUSTOMERS_RETAIL",
  "customersTraders": "CUSTOMERS_TRADERS",
  "customersBrokerage": "CUSTOMERS_BROKERAGE",
  "customersSubscriptions": "CUSTOMERS_SUBSCRIPTIONS",
  "merchants": "MERCHANTS",
  "merchantInvoices": "MERCHANT_INVOICES",
  "merchantReminders": "MERCHANT_REMINDERS",
  "merchantTransactions": "MERCHANT_TRANSACTIONS",
  "merchantProductRules": "MERCHANT_PRODUCT_RULES",
  "merchantNotes": "MERCHANT_NOTES",
  "merchantFiles": "MERCHANT_FILES",
  "notes": "NOTES",
  "tickets": "TICKETS",
  "referrals": "REFERRALS",
  "cashback": "CASHBACK",
  "customerTransactions": "CUSTOMER_TRANSACTIONS",
  "safeTransactions": "SAFE_TRANSACTIONS",
  "expenses": "EXPENSES",
  "debts": "DEBTS",
  "settlements": "SETTLEMENTS",
  "attendance": "ATTENDANCE",
  "salaries": "SALARIES",
  "auditLogs": "AUDIT_LOGS",
  "notifications": "NOTIFICATIONS",
  "gamesTree": "GAMES_TREE",
  "firstShippingGameTree": "FIRST_SHIPPING_GAME_TREE",
  "exchangeRate": "EXCHANGE_RATE",
  "storeWallets": "STORE_WALLETS",
  "storeWalletTransactions": "STORE_WALLET_TRANSACTIONS",
  "depositBondsFIFO": "DEPOSIT_BONDS_FIFO",
  "coupons": "COUPONS",
  "systemCodes": "SYSTEM_CODES",
  "customerModuleSettings": "CUSTOMER_MODULE_SETTINGS",
  "copyTemplates": "COPY_TEMPLATES",
  "marketingCopySettings": "MARKETING_COPY_SETTINGS",
  "dealers": "DEALERS",
  "dealerNotes": "DEALER_NOTES",
  "dealerTickets": "DEALER_TICKETS",
  "dealerReferrals": "DEALER_REFERRALS",
  "dealerCashback": "DEALER_CASHBACK",
  "dealerTransactions": "DEALER_TRANSACTIONS",
  "dealerModuleSettings": "DEALER_MODULE_SETTINGS",
  "dealerPricingAuditLogs": "DEALER_PRICING_AUDIT_LOGS",
  "dealerSafeTransactions": "DEALER_SAFE_TRANSACTIONS",
  "dealerWallets": "DEALER_WALLETS",
  "dealerWalletTransactions": "DEALER_WALLET_TRANSACTIONS",
  "dealerExpenses": "DEALER_EXPENSES",
  "dealerDebts": "DEALER_DEBTS",
  "dealerSettlements": "DEALER_SETTLEMENTS",
  "dealerShiftDeficits": "DEALER_SHIFT_DEFICITS",
  "dealerAttendance": "DEALER_ATTENDANCE",
  "dealerSalaries": "DEALER_SALARIES",
  "dealerEmployees": "DEALER_EMPLOYEES",
  "dealerDailyClosures": "DEALER_DAILY_CLOSURES",
  "middlemanDeals": "MIDDLEMAN_DEALS",
  "middlemanAccounts": "MIDDLEMAN_ACCOUNTS",
  "middlemanNotifications": "MIDDLEMAN_NOTIFICATIONS",
  "middlemanFollowups": "MIDDLEMAN_FOLLOWUPS",
  "middlemanSettings": "MIDDLEMAN_SETTINGS",
  "subscriptionPlans": "SUBSCRIPTION_PLANS",
  "subscriptions": "SUBSCRIPTIONS",
  "subscriptionPayments": "SUBSCRIPTION_PAYMENTS",
  "subscriptionNotifications": "SUBSCRIPTION_NOTIFICATIONS",
  "subscriptionSettings": "SUBSCRIPTION_SETTINGS",
  "subscriptionSavedFilters": "SUBSCRIPTION_SAVED_FILTERS",
  "subscriptionRetryQueue": "SUBSCRIPTION_RETRY_QUEUE",
  "subscriptionScheduler": "SUBSCRIPTION_SCHEDULER",
  "subscriptionFavReports": "SUBSCRIPTION_FAVORITE_REPORTS"
};
export function normalizeBackup(text: string, storageKeys: Record<string, string>): BackupPayload {
  if (text.length > 50 * 1024 * 1024) throw new Error('ملف النسخة الاحتياطية أكبر من الحد المسموح (50 ميجابايت)');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('ملف النسخة الاحتياطية ليس JSON صالحًا'); }
  if (!object(input)) throw new Error('تنسيق النسخة الاحتياطية غير صالح');
  const result: BackupPayload = { tables: {}, kv: {}, replaceKv: false };
  const addTable = (table: string, value: unknown) => {
    if (!allowedTables.has(table) || !Array.isArray(value)) throw new Error(`بيانات غير صالحة في النسخة: ${table}`);
    const ids = new Set<string>();
    for (const row of value) {
      if (!object(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error(`معرفات غير صالحة أو مكررة في: ${table}`);
      ids.add(row.id);
    }
    result.tables[table] = value;
  };
  if (input.format === 'erp-cloud-backup') {
    if (input.version !== '4.0' || !object(input.tables) || !object(input.kv)) throw new Error('إصدار النسخة الاحتياطية غير مدعوم');
    for (const [table, rows] of Object.entries(input.tables)) addTable(table, rows);
    for (const [key, value] of Object.entries(input.kv)) {
      if (!safeKey(key) || key !== cleanKey(key)) throw new Error(`مفتاح غير صالح في النسخة: ${key}`);
      result.kv[key] = value;
    }
    result.replaceKv = true;
  } else {
    const legacyAllowed = new Set([...Object.values(storageKeys).map(cleanKey), 'jkr_wallets_v2','jkr_wallet_lots_v2','jkr_wallet_transactions_v2','jkr_wallet_consumptions_v2','jkr_wallet_adjustments_v2','jkr_wallet_losses_v2','central_pricing_config_v3','pricing_config']);
    const addLegacy = (key: string, value: unknown) => {
      const clean = cleanKey(key);
      if (!safeKey(clean) || !legacyAllowed.has(clean) || value === null || value === undefined) return;
      const table = KEY_TO_TABLE_MAP[`nzm_jkr_${clean}`];
      if (table) addTable(table, value); else result.kv[clean] = value;
    };
    if (object(input.rawStorageDump)) for (const [key, value] of Object.entries(input.rawStorageDump)) {
      const clean = cleanKey(key);
      if (!safeKey(clean) || !legacyAllowed.has(clean)) continue;
      let parsed = value;
      if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { throw new Error(`بيانات تالفة في النسخة: ${clean}`); } }
      addLegacy(key, parsed);
    }
    if (object(input.explicitModules)) for (const [name, value] of Object.entries(input.explicitModules)) {
      if (storageKeys[name]) addLegacy(storageKeys[name], value);
    }
    for (const [field, name] of Object.entries(legacyFields)) if (Object.hasOwn(input, field)) addLegacy(storageKeys[name], input[field]);
  }
  if (!Object.keys(result.tables).length && !Object.keys(result.kv).length) throw new Error('الملف لا يحتوي على بيانات نسخة احتياطية معروفة');
  return result;
}

function failure(error: {message?: string; code?: string}): Error {
  if (error.code === 'PT409' || error.message === 'erp_maintenance_conflict') return new Error('تغيرت بيانات النظام أثناء العملية. لم يتم تطبيقها؛ أعد المحاولة.');
  if (error.message?.includes('admin') || error.code === '42501') return new Error('هذه العملية تتطلب تسجيل الدخول بحساب المدير');
  return new Error(error.message?.startsWith('erp_invalid') ? 'ملف النسخة الاحتياطية غير صالح؛ لم تتغير بيانات النظام.' : 'تعذر تأكيد العملية. لم يُعلن نجاحها؛ حدّث الصفحة وراجع البيانات قبل إعادة المحاولة.');
}
async function snapshot(): Promise<CloudBackup> {
  const {data, error} = await supabase.rpc('erp_export_backup');
  if (error) throw failure(error);
  if (!data?.revision || data.format !== 'erp-cloud-backup') throw new Error('لم يتم تحميل نسخة معتمدة من بيانات النظام');
  return data;
}
export async function exportCloudBackup(): Promise<CloudBackup> {
  return supabaseStorage.withMaintenance(snapshot);
}
export async function runCloudMaintenance(action: 'restore'|'wipe_all'|'wipe_finance', payload: unknown): Promise<void> {
  await supabaseStorage.withMaintenance(async () => {
    const current = await snapshot();
    const args = {p_operation_id: crypto.randomUUID(), p_action: action, p_payload: payload, p_expected_revision: current.revision};
    const send = () => supabase.rpc('erp_maintain_data', args);
    let response = await send();
    if (response.error && (!response.error.code || response.error.code === 'FETCH_ERROR')) response = await send();
    if (response.error) throw failure(response.error);
    // Reload is only allowed after the server acknowledges the entire operation.
    try { await supabaseStorage.resetAndHydrate(); } catch { throw new Error('تم حفظ العملية على الخادم، لكن تعذر تحديث العرض. أعد تحميل الصفحة دون تكرار العملية.'); }
    eventBus.publish('DATA_SYNCED', {maintenance: action});
  });
}
