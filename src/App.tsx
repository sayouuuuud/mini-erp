import { CloudSaveStatus } from './components/common/CloudSaveStatus';
import {
  isRemovedSection
} from './config/sections';
import React, { useState, useEffect } from 'react';
import {
  supabaseStorage
} from './database/supabaseStorage';
import {
  ThemeProvider
} from './context/ThemeContext';
import {
  AuthProvider,
  useAuth
} from './context/AuthContext';
import {
  HistoryProvider
} from './context/HistoryContext';
import {
  NotificationProvider
} from './context/NotificationContext';
import {
  TabsProvider,
  useTabs
} from './context/TabsContext';
import {
  LayoutOrderProvider
} from './context/LayoutOrderContext';
import {
  KeyboardProvider
} from './context/KeyboardContext';
import {
  AccessibilityProvider
} from './context/AccessibilityContext';
import {
  WorkspaceProvider
} from './context/WorkspaceContext';
import {
  SplashScreen
} from './modules/splash/SplashScreen';
import {
  UserSelection
} from './modules/auth/UserSelection';
import {
  Header
} from './components/layout/Header';
import {
  Sidebar
} from './components/layout/Sidebar';
import {
  TabsBar
} from './components/layout/TabsBar';
import {
  CommandPalette
} from './components/common/CommandPalette';
import {
  Dashboard
} from './modules/dashboard/Dashboard';
import {
  TicketsModule
} from './modules/tickets/TicketsModule';
import {
  CustomersList
} from './modules/customers/CustomersList';
import {
  CustomersDashboard
} from './modules/customers/CustomersDashboard';
import {
  CatalogModule
} from './modules/catalog/CatalogModule';
import {
  CouponsModule
} from './modules/coupons/CouponsModule';

import {
  DataAnalyticsModule
} from './modules/analytics/DataAnalyticsModule';
import {
  FinanceModule
} from './modules/finance/FinanceModule';
import {
  MerchantsModule
} from './modules/merchants/MerchantsModule';
import {
  SettingsModule
} from './modules/settings/SettingsModule';
import {
  CustomerSettingsSubModule
} from './modules/customerSettings/CustomerSettingsSubModule';
import {
  CustomerFinanceModule
} from './modules/customers/finance/CustomerFinanceModule';
import {
  ToastContainer
} from './components/feedback/ToastContainer';
import {
  ErrorBoundary
} from './components/common/ErrorBoundary';
import {
  ShieldAlert
} from 'lucide-react';


const MainApp: React.FC = () => {
  const { user, isAuthenticated, isRestoring, restoreError, retryRestore, canAccessDepartment, hasPermission } = useAuth();
  const { activeTab, openTab } = useTabs();
  const [isHydrated, setIsHydrated] = useState(() => supabaseStorage.isStorageHydrated());
  const [showSplash, setShowSplash] = useState(() => !supabaseStorage.isStorageHydrated());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const waitForHydration = async () => {
      try {
        await supabaseStorage.waitForHydration();
      } catch (err) {
        console.warn('Supabase hydration barrier warning:', err);
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    };

    if (!supabaseStorage.isStorageHydrated()) {
      waitForHydration();
    } else {
      setIsHydrated(true);
    }

    return () => {
      isMounted = false;
    };
  }, []);

  // Quick action triggers for Command Palette
  const [openNewCustomerTrigger, setOpenNewCustomerTrigger] = useState(false);
  const [openNewExpenseTrigger, setOpenNewExpenseTrigger] = useState(false);
  const [openVaultDepositTrigger, setOpenVaultDepositTrigger] = useState(false);

  if(isRestoring) return <div dir="rtl" role="status" className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">جارٍ استعادة الجلسة وتحميل بياناتك…</div>;
  if(restoreError) return <div dir="rtl" role="alert" className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col gap-4 items-center justify-center"><p>{restoreError}</p><button onClick={retryRestore} className="bg-orange-500 rounded-xl px-5 py-3">إعادة المحاولة</button></div>;
  // If splash screen is still running
  if (showSplash) {
    return <SplashScreen isReady={isHydrated || !isAuthenticated} onComplete={() => setShowSplash(false)} />;
  }

  // If user is not authenticated, show User Selection (Manager vs Employee)
  if (!isAuthenticated) {
    return (
      <UserSelection
        onSuccess={(targetSection?: string) => {
          if (targetSection && targetSection !== 'all') {
            const titleMap: Record<string, string> = {
              dashboard: 'الداشبورد',
              customer_dashboard: 'لوحة تحكم الزبائن',
              tickets: 'تذاكر الشحن',
              customers: 'البروفايلات والعملاء',
              catalog: 'المنتجات والمحافظ',
              coupons: 'كوبونات الخصم',
              customer_settings: 'إعدادات قسم الزبائن',
              customer_finance: 'المالية',
              reports: 'تحليل البيانات والذكاء',
              finance: 'المالية والخزينة',
              finance_overview: 'المركز المالي الشامل',
              finance_vault: 'الخزينة والسيولة النقدية',
              finance_wallets: 'المحافظ وحسابات البنوك',
              finance_expenses: 'المصروفات والبنود',
              finance_debts: 'الديون والمستحقات',
              finance_commissions: 'الكاش باك والعمولات',
              finance_payroll: 'الرواتب والحضور',
              finance_settlements: 'التسويات والورديات',
              finance_reports: 'التقارير والقوائم المالية',
              merchants: 'الموردين والخزائن الخارجية',
              settings: 'الإعدادات والرقابة',
            };
            const effectiveSection = isRemovedSection(targetSection) ? 'dashboard' : targetSection === 'customers' ? 'customer_dashboard' : targetSection;
            openTab({
              id: effectiveSection,
              title: titleMap[effectiveSection] || 'القسم المخصص',
              section: effectiveSection,
              iconType: effectiveSection as any
            });
          } else {
            openTab({
              id: 'dashboard',
              title: 'الداشبورد',
              section: 'dashboard',
              iconType: 'dashboard',
              closable: false
            });
          }
        }}
      />
    );
  }

  const currentSection = activeTab?.section || 'dashboard';

  const getSectionTitle = (sec: string) => {
    switch (sec) {
      case 'customer_dashboard':
        return 'لوحة تحكم الزبائن';
      case 'tickets':
        return 'تذاكر الشحن';
      case 'customers':
        return 'البروفايلات والعملاء';
      case 'catalog':
        return 'المنتجات والمحافظ';
      case 'coupons':
        return 'كوبونات الخصم';
      case 'customer_settings':
        return 'إعدادات قسم الزبائن';
      case 'customer_finance':
        return 'المالية';
      case 'reports':
        return 'تحليل البيانات والذكاء (الزبائن)';
      case 'finance':
        return 'المالية والخزينة';
      case 'finance_overview':
        return 'المركز المالي الشامل';
      case 'finance_vault':
        return 'الخزينة والسيولة النقدية';
      case 'finance_wallets':
        return 'المحافظ وحسابات البنوك';
      case 'finance_expenses':
        return 'المصروفات والبنود';
      case 'finance_debts':
        return 'الديون والمستحقات';
      case 'finance_commissions':
        return 'الكاش باك والعمولات';
      case 'finance_payroll':
        return 'الرواتب والحضور';
      case 'finance_settlements':
        return 'التسويات والورديات';
      case 'finance_reports':
        return 'التقارير والقوائم المالية';
      case 'merchants':
        return 'الموردين والخزائن الخارجية';
      case 'settings':
        return 'الإعدادات والرقابة';
      default:
        return 'الداشبورد';
    }
  };

  const isSectionAllowed = (sec: string): boolean => {
    if (!user || isRemovedSection(sec)) return false;
    if (user.role === 'admin') return true;
    if (sec === 'settings') return Boolean(hasPermission('manage_settings'));
    if (sec === 'finance' || sec.startsWith('finance_')) {
      return user.department === 'finance' || Boolean(hasPermission('manage_finance'));
    }
    if (sec === 'customer_settings') return canAccessDepartment('customers');
    return true;
  };

  const allowedToViewCurrent = isSectionAllowed(currentSection);

  return (
    <div className="flex h-screen bg-[#F8F9FA] dark:bg-[#0E0E10] text-[#0B0B0B] dark:text-[#FFFFFF] overflow-hidden" dir="rtl">
      <CloudSaveStatus />
      {/* Sidebar */}
      <Sidebar
        activeSection={currentSection}
        onNavigate={sec => {
          openTab({
            id: sec,
            title: getSectionTitle(sec),
            section: sec,
            iconType: sec as any,
            closable: sec !== 'dashboard'
          });
        }}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <Header activeSection={currentSection} />

        {/* Chrome/VS Code Style Multi-Tabs Bar */}
        <TabsBar />

        {/* Dynamic Page Content */}
        <main className="flex-1 overflow-y-auto p-2 sm:p-4">
          {!allowedToViewCurrent ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 mb-4 shadow-lg shadow-rose-500/10">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-black text-gray-900 dark:text-zinc-100 mb-2">غير مصرح بالوصول إلى هذا القسم</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mb-6 leading-relaxed">
                حسابك الحالي [{user?.fullName}] بصفة [{user?.role === 'admin' ? '👑 مدير عام' : user?.jobTitle || 'موظف'}] لا يمتلك الصلاحيات الإدارية المطلوبة لفتح هذا القسم. تم توثيق المحاولة في سجل التدقيق الأمني.
              </p>
              <button
                type="button"
                onClick={() => openTab({ id: 'dashboard', title: 'الداشبورد', section: 'dashboard', iconType: 'dashboard', closable: false })}
                className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow-md shadow-orange-500/20 transition-all cursor-pointer"
              >
                العودة للداشبورد المتاح
              </button>
            </div>
          ) : (
            <>
              {currentSection === 'dashboard' && (
            <Dashboard
              onNavigate={sec =>
                openTab({
                  id: sec,
                  title: getSectionTitle(sec),
                  section: sec,
                  iconType: sec as any
                })
              }
              onOpenCustomerModal={() => setOpenNewCustomerTrigger(true)}
              onOpenExpenseModal={() => setOpenNewExpenseTrigger(true)}
              onOpenVaultModal={() => setOpenVaultDepositTrigger(true)}
            />
          )}

          {/* Customer Department Sub-Tabs */}
          {currentSection === 'customer_dashboard' && (
            <CustomersDashboard
              onOpenNewCustomer={() => {
                openTab({
                  id: 'customers',
                  title: 'البروفايلات والعملاء',
                  section: 'customers',
                  iconType: 'customers'
                });
              }}
              onSelectCustomer={c => {
                openTab({
                  id: `customer_${c.id}`,
                  title: `عميل: ${c.name}`,
                  section: 'customers',
                  iconType: 'customer_profile' as any,
                  payload: c
                });
              }}
              onNavigateToDirectory={() => {
                openTab({
                  id: 'customers',
                  title: 'البروفايلات والعملاء',
                  section: 'customers',
                  iconType: 'customers'
                });
              }}
            />
          )}

          {/* Customer Shipping Sub-Tabs */}
          {currentSection === 'tickets' && <TicketsModule department="customers" />}

          {currentSection === 'customers' && (
            <CustomersList
              initialSelectedCustomer={activeTab?.iconType === 'customer_profile' ? activeTab.payload : null}
            />
          )}

          {/* Shared / Other Sections */}
          {currentSection === 'catalog' && <CatalogModule department="customers" />}

          {currentSection === 'coupons' && <CouponsModule department="customers" />}

          {currentSection === 'reports' && <DataAnalyticsModule department="customers" />}

          {currentSection === 'customer_settings' && <CustomerSettingsSubModule />}


          {currentSection === 'customer_finance' && <CustomerFinanceModule />}

          {(currentSection === 'finance' || currentSection.startsWith('finance_')) && (
            <FinanceModule subSection={currentSection} />
          )}

          {currentSection === 'merchants' && (
            <MerchantsModule
              initialMerchant={activeTab?.iconType === 'merchant_profile' ? activeTab.payload : null}
            />
          )}

          {currentSection === 'settings' && <SettingsModule />}
            </>
          )}
        </main>
      </div>

      {/* Command Palette (VS Code / Raycast Style - Ctrl+K) */}
      <CommandPalette
        onOpenNewCustomer={() => setOpenNewCustomerTrigger(true)}
        onOpenNewExpense={() => setOpenNewExpenseTrigger(true)}
        onOpenVaultDeposit={() => setOpenVaultDepositTrigger(true)}
      />

      {/* Floating Notifications Toast Container */}
      <ToastContainer />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AccessibilityProvider>
        <NotificationProvider>
          <AuthProvider>
            <LayoutOrderProvider>
              <HistoryProvider>
                <TabsProvider>
                  <WorkspaceProvider>
                    <KeyboardProvider>
                      <ErrorBoundary>
                        <MainApp />
                      </ErrorBoundary>
                    </KeyboardProvider>
                  </WorkspaceProvider>
                </TabsProvider>
              </HistoryProvider>
            </LayoutOrderProvider>
          </AuthProvider>
        </NotificationProvider>
      </AccessibilityProvider>
    </ThemeProvider>
  );
};

export default App;
