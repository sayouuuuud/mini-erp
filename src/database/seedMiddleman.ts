import {
  MiddlemanDeal,
  GameAccountAsset,
  MiddlemanNotificationItem,
  MiddlemanModuleSettings
} from '../types/middleman.types';
import { Customer } from '../types/customer.types';

export const initialBrokerageClients: Customer[] = [];

export const initialMiddlemanModuleSettings: MiddlemanModuleSettings = {
  defaultCurrency: 'EGP',
  defaultCompanyCommissionType: 'percentage',
  defaultCompanyCommissionPercent: 5.0,
  defaultCompanyCommissionFixedEGP: 100.0,
  defaultExternalMiddlemanCommissionPercent: 2.0,
  maxStalledDealDaysAlert: 2,
  maxUnsoldAccountDaysAlert: 20,
  customDealTypes: [
    'بيع حساب',
    'شراء حساب',
    'بيع عملات',
    'شراء عملات',
    'بيع سكربت',
    'بيع منتج رقمي',
    'بيع خدمة'
  ],
  clientSourcesList: [
    'جروباتنا',
    'تيليجرام',
    'فيسبوك',
    'واتساب',
    'ديسكورد',
    'صديق',
    'إعلان',
    'مكان آخر'
  ],
  businessName: 'NZM JKR TOP UP — قطاع الوساطة والضمان المعتمد',
  businessPhone: '',
  businessAddress: 'المنصورة - جمهورية مصر العربية',
  invoiceFooterNote: 'شكراً لتعاملكم مع نظام الوساطة والضمان الآمن الأول — NZM JKR ESCROW ★',
  invoicePaperFormat: 'thermal_80mm',
  showLogoOnInvoice: true,
  showPhoneOnInvoice: true,
  showEmployeeOnInvoice: true,
  showExternalMiddlemanOnInvoice: true,
  whatsappDealTemplate: `🛡️ *إشعار وساطة وضمان رسمي — NZM JKR* 🛡️
رقم العملية: {{رقم_الوساطة}}
نوع العملية: {{نوع_الوساطة}}
قيمة الصفقة: {{قيمة_الصفقة}} {{العملة}}
البائع: {{اسم_البائع}}
المشتري: {{اسم_المشتري}}
الحالة الحالية: {{حالة_الوساطة}}
--------------------------------
نضمن لكم حقكم المالي والتقني بنسبة 100% ★`,
  whatsappAccountSaleTemplate: `🎉 *فاتورة شراء حساب رسمي — NZM JKR* 🎉
رقم الفاتورة: {{رقم_الفاتورة}}
الحساب: {{اسم_الحساب}}
اللعبة: {{اسم_اللعبة}}
سعر الشراء: {{سعر_البيع}} ج
المشتري: {{اسم_المشتري}}
--------------------------------
تم فحص وتأمين الحساب وتسليم البيانات بنجاح ★`,
  telegramDealTemplate: `🛡️ *تحديث صفقة الوساطة #{{رقم_الوساطة}}*
الحالة: {{حالة_الوساطة}}
المبلغ: {{قيمة_الصفقة}} {{العملة}}
البائع: {{اسم_البائع}} | المشتري: {{اسم_المشتري}}`
};

export const initialMiddlemanDeals: MiddlemanDeal[] = [];

export const initialMiddlemanAccounts: GameAccountAsset[] = [];

export const initialMiddlemanNotifications: MiddlemanNotificationItem[] = [];
