import {
  GameTreeItem,
  GameProduct,
  StoreWallet,
  StoreWalletTransaction,
  DepositBondFIFO,
  Coupon,
  DailyExchangeRate,
  SystemCodeItem,
  CustomerModuleSettings
} from '../types/topup.types';

export const initialCustomerModuleSettings: CustomerModuleSettings = {
  defaultCurrencyDisplay: 'EGP',
  businessName: 'NZM JKR Top Up ERP',
  businessPhone: '',
  businessAddress: 'المنصورة، جمهورية مصر العربية',
  invoicePaperFormat: 'thermal_80mm',
  showLogoOnInvoice: true,
  showPhoneOnInvoice: true,
  showCashbackOnInvoice: true,
  showEmployeeOnInvoice: true,
  invoiceFooterNote: 'شكراً لتعاملك مع NZM JKR Top Up — متجر شحن الألعاب الإلكترونية الأول 🌟',
  costingMethod: 'FIFO',
  priceRounding: true,
  minCashbackAmountEGP: 2.0,
  defaultCashbackPercent: 1.0,
  defaultPartnerCommissionPercent: 3.0,
  defaultProfitMarginPercent: 7.0,
  couponWhatsAppMessageTemplate: `🎮 مرحباً بك يا {{اسم_العميل}}! ✨
يسعدنا تقديم كوبون تعويض حصري لك:
🎁 كود الكوبون: {{كود_الكوبون}}
💰 قيمة الخصم: {{قيمة_الخصم}} ج
🌟 صالح للاستخدام في شحن جميع ألعابك مباشرة لدينا!
━━━━━━━━━━━━━━━
NZM JKR Top Up 🌟`,
  referralCodeMessageTemplate: `مرحبًا،

استخدم كود الإحالة التالي للحصول على المزايا والخصومات الحصرية:

{code}

شكرًا لاستخدام خدماتنا.`
};

export const initialExchangeRate: DailyExchangeRate = {
  rateUSD_EGP: 50.0,
  fixedCostPerOrderEGP: 5.0,
  monthlyBreakEvenTargetOrders: 1500, // 1500 طلب شهرياً لتغطية التشغيل
  updatedAt: new Date().toISOString(),
  updatedBy: 'المدير العام (Owner)',
  rateHistory: [
    { rate: 50.0, oldRate: 49.5, timestamp: '2026-08-29T10:00:00Z', changedBy: 'المدير العام (Owner)', notes: 'تحديث سعر الصرف اليومي وفقاً لـ Binance P2P' },
    { rate: 49.5, oldRate: 49.0, timestamp: '2026-08-28T09:30:00Z', changedBy: 'المدير العام (Owner)', notes: 'تعديل السعر المعتمد' },
    { rate: 49.0, oldRate: 48.5, timestamp: '2026-08-27T11:00:00Z', changedBy: 'المدير العام (Owner)', notes: 'بداية الأسبوع' }
  ]
};

export const initialSystemCodes: SystemCodeItem[] = [];

export const initialStoreWallets: StoreWallet[] = [];

export const initialGamesTree: GameTreeItem[] = [];

export const initialDepositBondsFIFO: DepositBondFIFO[] = [];

export const initialCoupons: Coupon[] = [];

export const initialStoreWalletTransactions: StoreWalletTransaction[] = [];

export const initialFirstShippingGameTree: GameTreeItem[] = [];
