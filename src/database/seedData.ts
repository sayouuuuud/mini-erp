import { User } from '../types/auth.types';
import {
  Customer,
  CustomerNote,
  CustomerTicket,
  CustomerReferral,
  UnifiedWalletTransaction,
  CustomerTransaction
} from '../types/customer.types';
import { SafeTransaction, Expense, Debt, ShiftSettlement, AttendanceRecord, SalarySlip, Employee } from '../types/finance.types';
import { AuditLog } from '../types/audit.types';
import { NotificationItem, SystemSettings } from '../types/common.types';

export const initialSettings: SystemSettings = {
  companyName: 'JKR Top Up - مركز شحن الألعاب والبطاقات',
  currency: 'EGP',
  currencySymbol: 'ج.م',
  phone: '',
  address: '',
  taxRate: 0,
  cashbackPercentage: 1.0, // 1%
  referralBonusAmount: 10.0,
  autoArchiveDays: 365,
  enableAuditLog: true,
  vaultInitialBalance: 0.0, // Initial capital is formally established via safe_1 transaction (25,000 EGP)
  systemVersion: 'v2.5 Pro Top-Up'
};

export const initialUsers: User[] = [];

export const initialCustomers: Customer[] = [];

export const initialNotes: CustomerNote[] = [];

export const initialTickets: CustomerTicket[] = [];

export const initialReferrals: CustomerReferral[] = [];

export const initialUnifiedWalletTransactions: UnifiedWalletTransaction[] = [];

export const initialCustomerTransactions: CustomerTransaction[] = [];

export const initialSafeTransactions: SafeTransaction[] = [];

export const initialExpenses: Expense[] = [];

export const initialDebts: Debt[] = [];

export const initialSettlements: ShiftSettlement[] = [];
export const initialAttendance: AttendanceRecord[] = [];
export const initialSalaries: SalarySlip[] = [];

export const initialEmployees: Employee[] = [];

export const initialAuditLogs: AuditLog[] = [];

export const initialNotifications: NotificationItem[] = [];
