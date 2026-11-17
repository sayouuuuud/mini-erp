import {
  SubscriptionPlan,
  CustomerSubscription,
  SubscriptionPayment,
  SubscriptionModuleSettings
} from '../types/subscription.types';
import { Customer } from '../types/customer.types';

export const initialSubscriptionClients: Customer[] = [];

export const initialSubscriptionPlans: SubscriptionPlan[] = [];

export const initialCustomerSubscriptions: CustomerSubscription[] = [];

export const initialSubscriptionPayments: SubscriptionPayment[] = [];

export const initialSubscriptionSettings: SubscriptionModuleSettings = {
  autoExpiryCheck: true,
  gracePeriodDays: 3,
  enableProration: true,
  allowCustomerSelfRenewal: true,
  defaultPaymentMethod: 'safe_cash',
  defaultPaperFormat: 'thermal_80mm',
  defaultReceiptTemplate: 'thermal_80mm',
  defaultCurrency: 'EGP',
  currencyRates: {
    EGP: 1,
    USD: 48.5,
    SAR: 12.9,
    AED: 13.2
  },

  companyName: 'NZM JKR TOP UP ERP',
  companyPhone: '',
  companyAddress: 'المنصورة — جمهورية مصر العربية',
  invoiceFooterNote: 'نضمن لك استمرار الخدمة طوال فترة الاشتراك • دعم فني 24/7',
  termsAndConditions: '• لا يجوز مشاركة بيانات الحساب مع أطراف خارجية.\n• الضمان ساري طوال مدة الاشتراك مع استبدال فوري عند أي خلل فني.',

  templates: [
    {
      id: 'tpl_7d',
      type: 'expiring_7d',
      title: 'تنبيه انتهاء الاشتراك (قبل 7 أيام)',
      messageTemplate: 'عزيزنا {customer_name}، نود تذكيرك بأن اشتراكك في باقة *{plan_name}* سينتهي خلال 7 أيام بتاريخ {expiry_date}. للتجديد بدون انقطاع يمكنك التواصل معنا أو زيارة فرعنا.',
      enabled: true,
      daysBeforeExpiry: 7
    },
    {
      id: 'tpl_3d',
      type: 'expiring_3d',
      title: 'تنبيه عاجل (قبل 3 أيام)',
      messageTemplate: 'تنبيه مهم يا {customer_name} ⚠️: باقتك *{plan_name}* تنتهي خلال 3 أيام ({expiry_date}). قم بالتجديد الآن للاحتفاظ بإعداداتك وسجل حسابك بدون أي توقف!',
      enabled: true,
      daysBeforeExpiry: 3
    },
    {
      id: 'tpl_today',
      type: 'expired_today',
      title: 'إشعار انتهاء الاشتراك اليوم',
      messageTemplate: 'مرحباً {customer_name}، اشتراكك في *{plan_name}* ينتهي اليوم ({expiry_date}). تم تفعيل فترة سماح مؤقتة لخدمتك، يرجى سداد التجديد لتفادي إيقاف الخدمة.',
      enabled: true,
      daysBeforeExpiry: 0
    },
    {
      id: 'tpl_welcome',
      type: 'welcome',
      title: 'إيصال التفعيل والترحيب بالاشتراك الجديد',
      messageTemplate: 'أهلاً بك {customer_name} في *NZM JKR*! تم تفعيل اشتراكك في باقة *{plan_name}* بنجاح 🎉. رقم الإيصال: {receipt_number}، تاريخ الانتهاء: {expiry_date}. نتمنى لك تجربة ممتعة!',
      enabled: true
    }
  ]
};
