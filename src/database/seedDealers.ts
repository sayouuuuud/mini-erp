// =============================================================
// NZM JKR TOP UP ERP — Dealers & Wholesale Seed Data
// =============================================================

import { Dealer, DealerNote, DealerReferral, DealerModuleSettings } from '../types/dealer.types';
import { UnifiedWalletTransaction } from '../types/customer.types';

export const initialDealerModuleSettings: DealerModuleSettings = {
  defaultCurrencyDisplay: 'EGP',
  businessName: 'NZM JKR Top Up — قسم تجار الجملة والموزعين',
  businessPhone: '',
  businessAddress: 'المنصورة، جمهورية مصر العربية - مجمع تجار الجملة',
  commercialRegistrationNumber: 'CR-98241-W',
  invoicePaperFormat: 'thermal_80mm',
  showLogoOnInvoice: true,
  showPhoneOnInvoice: true,
  showCashbackOnInvoice: true,
  showEmployeeOnInvoice: true,
  showCommercialIdOnInvoice: true,
  showDealerTierOnInvoice: true,
  invoiceFooterNote: 'شكراً لتعاملكم مع قطاع تجار الجملة والموزعين المعتمدين — NZM JKR TOP UP 💼',
  costingMethod: 'FIFO',
  priceRounding: true,

  // Wholesale Pricing Engine Fields
  rateUSD_EGP: 39.25,
  fixedCostMode: 'manual',
  manualFixedCostEGP: 2.5,
  monthlyBreakEvenTargetOrders: 1500,
  defaultWholesaleProfitMarginPercent: 3.5, // هامش ربح الجملة 3.5%
  defaultCashbackPercent: 0.5,
  defaultPartnerCommissionPercent: 1.5,
  reservePercent: 0.5,
  developmentPercent: 0.5,
  offersPercent: 0.5,
  minCashbackAmountEGP: 10.0
};

export const initialDealers: Dealer[] = [];

export const initialDealerNotes: DealerNote[] = [];

export const initialDealerReferrals: DealerReferral[] = [];

export const initialDealerTransactions: UnifiedWalletTransaction[] = [];
