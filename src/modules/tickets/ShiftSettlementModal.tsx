import { TREASURIES } from '../../services/shiftDistribution';
import { money, retainedTicketRatio, ticketContribution } from '../../services/systemWalletProjection';
import React, { useState, useMemo, useEffect } from 'react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Badge } from '../../components/common/Badge';
import { db } from '../../database/db';
import { useNotifications } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import { JKRWalletEngine } from '../../services/financial/jkrWalletEngine';
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  Wallet,
  Clock,
  Printer,
  ShieldCheck,
  Lock,
  ArrowLeft,
  FileText,
  AlertCircle,
  Plus,
  Check,
  ChevronDown,
  ChevronUp,
  Filter,
  Package,
  Boxes,
  Eye,
  EyeOff,
  Search,
} from 'lucide-react';
import { eventBus, SYSTEM_EVENTS } from '../../services/eventBus';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters';
import { ReportEngine } from '../../services/reporting/reportEngine';
import { ReportConfig } from '../../services/reporting/reportTypes';
import { CustomerTicket } from '../../types/customer.types';
import { StoreWallet } from '../../types/topup.types';
import { JKRWallet } from '../../types/jkrWallet.types';
import {
  ShiftDeficitItem,
  ShiftSettlement,
} from '../../types/finance.types';

interface ShiftSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'audit' | 'settlement';
  department?: 'customers' | 'dealers';
}

export const ShiftSettlementModal: React.FC<ShiftSettlementModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'audit',
  department = 'customers'
}) => {
  const { user } = useAuth();
  const isOwner = user?.role === 'admin';
  const { showToast } = useNotifications();

  // Active Tab: 'audit' (for employees/review) vs 'settlement' (for owner only)
  const [activeTab, setActiveTab] = useState<'audit' | 'settlement'>(
    initialMode === 'settlement' && isOwner ? 'settlement' : 'audit'
  );

  // Stepper for Owner's Settlement Sequence
  const [settlementStep, setSettlementStep] = useState<number>(1);

  // -------------------------------------------------------------
  // 📅 CALENDAR & SHIFT DATE FILTERS
  // -------------------------------------------------------------
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const [datePreset, setDatePreset] = useState<'active_shift' | 'today' | 'yesterday' | 'custom' | 'history'>('active_shift');
  const [selectedHistorySettlementId, setSelectedHistorySettlementId] = useState<string>('');
  const [filterStartDate, setFilterStartDate] = useState<string>(todayStr);
  const [filterEndDate, setFilterEndDate] = useState<string>(todayStr);
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<'all' | 'customers' | 'dealers'>(department);

  // Toggle to hide lines/numbers that didn't work (received 0 in the shift)
  const [hideInactiveLines, setHideInactiveLines] = useState<boolean>(true);
  const [hideInactiveWallets, setHideInactiveWallets] = useState<boolean>(false);

  // Data Loading - reactive to state updates
  const [allCustomerTickets, setAllCustomerTickets] = useState<CustomerTicket[]>(() => db.getTickets());
  const [allDealerTickets, setAllDealerTickets] = useState<CustomerTicket[]>(() => db.getDealerTickets());
  const [settlements, setSettlements] = useState<ShiftSettlement[]>(() => db.getSettlements());

  const [wallets, setWallets] = useState<StoreWallet[]>(() => db.getStoreWallets());
  const [jkrWallets, setJkrWallets] = useState<JKRWallet[]>(() => JKRWalletEngine.getWallets());
  const [deficits, setDeficits] = useState<ShiftDeficitItem[]>(() => db.getShiftDeficits());

  const reloadData = () => {
    setAllCustomerTickets(db.getTickets());
    setAllDealerTickets(db.getDealerTickets());
    setSettlements(db.getSettlements());
    setWallets(db.getStoreWallets());
    setJkrWallets(JKRWalletEngine.getWallets());
    setDeficits(db.getShiftDeficits());
  };

  useEffect(() => {
    if (isOpen) {
      reloadData();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => reloadData();
    window.addEventListener('storage', refresh);
    window.addEventListener('tickets_updated', refresh);
    return () => {window.removeEventListener('storage', refresh);window.removeEventListener('tickets_updated', refresh);};
  }, [isOpen]);

  // Find the latest closed shift settlement for calculating active shift start time
  const latestSettlement = useMemo(() => {
    const closedList = settlements.filter(s => s.status === 'closed' || s.status === 'verified');
    if (closedList.length === 0) return null;

    const filtered = closedList.filter(s => {
      if (selectedDeptFilter === 'all') return true;
      if (selectedDeptFilter === 'customers') return s.department === 'قسم العملاء' || s.department === 'جميع الأقسام';
      if (selectedDeptFilter === 'dealers') return s.department === 'قسم التجار' || s.department === 'جميع الأقسام';
      return true;
    });

    if (filtered.length === 0) return null;

    return [...filtered].sort((a, b) => {
      const tA = new Date(a.closedAt || a.endTime || a.createdAt).getTime();
      const tB = new Date(b.closedAt || b.endTime || b.createdAt).getTime();
      return tB - tA;
    })[0];
  }, [settlements, selectedDeptFilter]);

  // Start time shown in the shift report; eligibility is determined by settlement stamps.
  const activeShiftStartTime = useMemo(() => {
    if (latestSettlement) {
      return latestSettlement.closedAt || latestSettlement.endTime || latestSettlement.createdAt;
    }
    return null;
  }, [latestSettlement]);

  // Filtered Tickets according to Active Shift, Calendar & Department
  const shiftTickets = useMemo(() => {
    let baseList: CustomerTicket[] = [];
    if (selectedDeptFilter === 'dealers') {
      baseList = allDealerTickets;
    } else if (selectedDeptFilter === 'customers') {
      baseList = allCustomerTickets;
    } else {
      baseList = [...allCustomerTickets, ...allDealerTickets];
    }

    // 1. History mode: viewing a past closed settlement
    if (datePreset === 'history') {
      const target = settlements.find(s => s.id === selectedHistorySettlementId) || latestSettlement;
      if (!target) return [];
      if(target.auditSnapshot)return target.auditSnapshot.tickets.filter(t=>target.ticketIds?.includes(t.id)) as CustomerTicket[];
      return baseList.filter(t => {
        if (t.status !== 'completed') return false;
        if (target.ticketIds && target.ticketIds.includes(t.id)) return true;
        if (t.shiftSettlementId && t.shiftSettlementId === target.id) return true;
        const tTime = new Date(t.completedAt || t.updatedAt || t.createdAt).getTime();
        const sStart = new Date(target.startTime).getTime();
        const sEnd = new Date(target.endTime || target.closedAt || target.createdAt).getTime();
        return tTime >= sStart && tTime <= sEnd;
      });
    }

    // 2. Active Shift mode: tickets completed since the last closed settlement
    // NOT bound to calendar date: DOES NOT reset at 12:00 AM midnight, only when user settles!
    if (datePreset === 'active_shift') {
      return baseList.filter(t => {
        if (t.status !== 'completed') return false;
        // If ticket is already stamped with a settlement ID, it is settled
        if (t.shiftSettlementId) return false;

        return true;
      });
    }

    // 3. Calendar filters (Today, Yesterday, Custom)
    return baseList.filter(t => {
      if (t.status !== 'completed') return false;
      const tDate = t.createdAt ? t.createdAt.split('T')[0] : '';
      if (!tDate) return false;

      if (datePreset === 'today') return tDate === todayStr;
      if (datePreset === 'yesterday') return tDate === yesterdayStr;
      if (datePreset === 'custom') {
        if (filterStartDate && tDate < filterStartDate) return false;
        if (filterEndDate && tDate > filterEndDate) return false;
        return true;
      }
      return true;
    });
  }, [
    allCustomerTickets,
    allDealerTickets,
    selectedDeptFilter,
    datePreset,
    selectedHistorySettlementId,
    latestSettlement,
    settlements,
    filterStartDate,
    filterEndDate,
    todayStr,
    yesterdayStr
  ]);

  // Financial KPIs for the Filtered Shift
  const totalShiftRevenue = useMemo(() => {
    return money(shiftTickets.reduce((sum, t) => sum + Number(t.receivedAmount ?? t.requiredAmount ?? 0) * retainedTicketRatio(t), 0));
  }, [shiftTickets]);

  const totalShiftCost = useMemo(() => {
    return money(shiftTickets.reduce((sum, t) => sum + Number(t.totalCostAmount || 0) * retainedTicketRatio(t), 0));
  }, [shiftTickets]);

  const totalShiftProfit = useMemo(() => {
    return money(shiftTickets.reduce((sum,t)=>sum+ticketContribution(t,'profits'),0));
  }, [shiftTickets]);

  const totalShiftCashback = useMemo(() => {
    return money(shiftTickets.reduce((sum,t)=>sum+ticketContribution(t,'cashback'),0));
  }, [shiftTickets]);

  const totalShiftReferral = useMemo(() => {
    return money(shiftTickets.reduce((sum,t)=>sum+ticketContribution(t,'referrals'),0));
  }, [shiftTickets]);

  const totalShiftOperatingExpenses = useMemo(() => {
    return money(shiftTickets.reduce((sum,t)=>sum+ticketContribution(t,'operating_expenses'),0));
  }, [shiftTickets]);

  // -------------------------------------------------------------
  // 💼 1. OPERATING WALLETS & RECEIVING LINES BREAKDOWN
  // -------------------------------------------------------------
  const walletBreakdown = useMemo(() => {
    const opWallets = wallets.filter(
      w => !w.isSystemWallet && w.type === 'operating'
    );

    return opWallets.map(w => {
      // All tickets received on this wallet
      const walletTickets = shiftTickets.filter(
        t => t.paymentWalletId === w.id || t.paymentWallet === w.name
      );

      const totalReceivedInShift = walletTickets.reduce(
        (sum, t) => sum + (t.receivedAmount || t.requiredAmount || 0),
        0
      );

      // Active lines map: Collect all numbers/lines that worked in this shift
      const linesMap = new Map<string, {
        numberId: string;
        phoneNumber: string;
        accountHolderName?: string;
        receivedInShift: number;
        currentBalance: number;
        monthlyLimit: number;
        monthlyReceived: number;
        wasUsedInShift: boolean;
      }>();

      // Check predefined numbers in wallet
      for (const num of w.numbers || []) {
        const numTickets = walletTickets.filter(
          t => t.paymentWalletNumberId === num.id || t.paymentReceivedPhone === num.phoneNumber
        );
        const receivedInShift = numTickets.reduce(
          (sum, t) => sum + (t.receivedAmount || t.requiredAmount || 0),
          0
        );

        linesMap.set(num.phoneNumber || num.id, {
          numberId: num.id,
          phoneNumber: num.phoneNumber,
          accountHolderName: num.accountHolderName,
          receivedInShift,
          currentBalance: num.currentBalance ?? 0,
          monthlyLimit: num.monthlyLimit || 100000,
          monthlyReceived: num.monthlyReceived || 0,
          wasUsedInShift: receivedInShift > 0
        });
      }

      // Check all actual receiving phone numbers registered in shift tickets
      // (ensures numbers switched due to limits or custom receiving lines appear accurately!)
      for (const t of walletTickets) {
        const phone = t.paymentReceivedPhone;
        if (phone && phone !== '—' && phone !== '01012345678' && !linesMap.has(phone)) {
          const matchingNum = (w.numbers || []).find(n => n.phoneNumber === phone || n.id === t.paymentWalletNumberId);
          const phoneTickets = walletTickets.filter(
            x => x.paymentReceivedPhone === phone || x.paymentWalletNumberId === t.paymentWalletNumberId
          );
          const receivedInShift = phoneTickets.reduce((sum, x) => sum + (x.receivedAmount || x.requiredAmount || 0), 0);

          if (receivedInShift > 0) {
            linesMap.set(phone, {
              numberId: t.paymentWalletNumberId || phone,
              phoneNumber: phone,
              accountHolderName: matchingNum?.accountHolderName || 'خط استقبال مسجل بالتذكرة',
              receivedInShift,
              currentBalance: matchingNum?.currentBalance ?? 0,
              monthlyLimit: matchingNum?.monthlyLimit || 100000,
              monthlyReceived: matchingNum?.monthlyReceived || 0,
              wasUsedInShift: true
            });
          }
        }
      }

      let allLines = Array.from(linesMap.values());

      // If user wants to hide inactive lines (received 0 in shift):
      if (hideInactiveLines) {
        allLines = allLines.filter(l => l.receivedInShift > 0);
      }

      return {
        walletId: w.id,
        walletName: w.name,
        accountNumber: w.accountNumber,
        currency: w.currency,
        totalReceivedInShift,
        currentBalance: w.balance,
        activeLinesCount: allLines.filter(l => l.receivedInShift > 0).length,
        numbersBreakdown: allLines
      };
    });
  }, [wallets, shiftTickets, hideInactiveLines]);

  // Filtered wallets list
  const displayedWallets = useMemo(() => {
    if (hideInactiveWallets) {
      return walletBreakdown.filter(wb => wb.totalReceivedInShift > 0);
    }
    return walletBreakdown;
  }, [walletBreakdown, hideInactiveWallets]);

  // -------------------------------------------------------------
  // 📦 2. GOODS / INVENTORY WALLETS BREAKDOWN (محافظ البضاعة)
  // -------------------------------------------------------------
  const inventoryWalletsBreakdown = useMemo(() => {
    // 1. Gather all SUB wallets from JKRWalletEngine
    const subWallets = jkrWallets.filter(w => w.type === 'SUB' || !!w.pointType);
    
    // 2. Also check store_wallets with type === 'inventory'
    const invStoreWallets = wallets.filter(w => w.type === 'inventory' || w.category === 'inventory');

    // Combine distinct inventory wallets
    const allInv: Array<{
      id: string;
      name: string;
      pointType: string;
      currentPoints: number;
      currency: string;
      safetyLimit?: number;
      status: string;
    }> = [];

    for (const sw of subWallets) {
      allInv.push({
        id: sw.id,
        name: sw.name,
        pointType: sw.pointType || 'نقاط',
        currentPoints: sw.pointsBalance || 0,
        currency: sw.currency || 'EGP',
        safetyLimit: sw.safetyLimit,
        status: sw.status || 'ACTIVE'
      });
    }

    for (const iw of invStoreWallets) {
      if (!allInv.some(x => x.id === iw.id)) {
        allInv.push({
          id: iw.id,
          name: iw.name,
          pointType: iw.category || 'كروت / بضاعة',
          currentPoints: iw.pointsBalance || iw.balance || 0,
          currency: iw.currency || 'EGP',
          status: iw.status || 'active'
        });
      }
    }

    // Calculate consumption from shiftTickets
    return allInv.map(inv => {
      let consumedPointsInShift = 0;
      let consumedCostEGPInShift = 0;
      let ticketItemsCount = 0;
      const ticketDetails: Array<{
        ticketId: string;
        ticketCode: string;
        customerName: string;
        productName: string;
        quantity: number;
        consumedPoints: number;
        costEGP: number;
        time: string;
      }> = [];

      for (const t of shiftTickets) {
        if (!t.items || t.items.length === 0) {
          // Check primary ticket item
          if (t.actualWalletId === inv.id) {
            consumedCostEGPInShift += t.totalCostAmount || 0;
            ticketItemsCount += 1;
            ticketDetails.push({
              ticketId: t.id,
              ticketCode: (t as any).ticketNumber || t.id.slice(-6),
              customerName: (t as any).customerName || 'عميل',
              productName: (t as any).productName || inv.name,
              quantity: (t as any).unitsRequired || 1,
              consumedPoints: (t as any).unitsRequired || 0,
              costEGP: t.totalCostAmount || 0,
              time: t.createdAt ? formatDateTime(t.createdAt) : '-'
            });
          }
          continue;
        }

        for (const item of t.items) {
          const isMatch = item.walletTypeId === inv.id || 
                          item.consumedWalletId === inv.id ||
                          item.gameName?.toLowerCase().includes(inv.name.toLowerCase()) ||
                          inv.name.toLowerCase().includes(item.gameName?.toLowerCase() || '');

          if (isMatch) {
            const qty = item.quantity || 1;
            const pts = item.consumedPoints || 0;
            const itemCost = (item.costPrice || 0) * qty;
            consumedPointsInShift += pts;
            consumedCostEGPInShift += itemCost;
            ticketItemsCount += 1;
            ticketDetails.push({
              ticketId: t.id,
              ticketCode: (t as any).ticketNumber || t.id.slice(-6),
              customerName: (t as any).customerName || 'عميل',
              productName: (item as any).packageName || item.gameName || inv.name,
              quantity: qty,
              consumedPoints: pts,
              costEGP: itemCost,
              time: t.createdAt ? formatDateTime(t.createdAt) : '-'
            });
          }
        }
      }

      // Lots breakdown from JKRWalletEngine
      const lots = JKRWalletEngine.getLotsByWallet(inv.id);

      // Expected Points = Current Balance + Consumed in this shift ("المفروض يكون في كام")
      const expectedPointsBeforeShift = inv.currentPoints + consumedPointsInShift;

      return {
        id: inv.id,
        name: inv.name,
        pointType: inv.pointType,
        currentPoints: inv.currentPoints,
        consumedPointsInShift,
        consumedCostEGPInShift,
        expectedPointsBeforeShift,
        ticketItemsCount,
        ticketDetails,
        lots,
        currency: inv.currency,
        status: inv.status
      };
    });
  }, [jkrWallets, wallets, shiftTickets]);

  // Sub-Tabs in Shift Audit: 'both' | 'reception' | 'inventory'
  const [auditSubTab, setAuditSubTab] = useState<'both' | 'reception' | 'inventory'>('both');
  const [expandedInventoryWallets, setExpandedInventoryWallets] = useState<Record<string, boolean>>({});
  const [inventorySearchQuery, setInventorySearchQuery] = useState('');
  const [hideUnconsumedInventory, setHideUnconsumedInventory] = useState(false);

  const toggleInventoryWalletExpand = (invId: string) => {
    setExpandedInventoryWallets(prev => ({ ...prev, [invId]: !prev[invId] }));
  };

  // Inventory Metrics Totals
  const totalInventoryCurrentPoints = useMemo(() => {
    return inventoryWalletsBreakdown.reduce((sum, inv) => sum + inv.currentPoints, 0);
  }, [inventoryWalletsBreakdown]);

  const totalInventoryConsumedPoints = useMemo(() => {
    return inventoryWalletsBreakdown.reduce((sum, inv) => sum + inv.consumedPointsInShift, 0);
  }, [inventoryWalletsBreakdown]);

  const totalInventoryExpectedPoints = useMemo(() => {
    return inventoryWalletsBreakdown.reduce((sum, inv) => sum + inv.expectedPointsBeforeShift, 0);
  }, [inventoryWalletsBreakdown]);

  const totalInventoryConsumedCost = useMemo(() => {
    return inventoryWalletsBreakdown.reduce((sum, inv) => sum + inv.consumedCostEGPInShift, 0);
  }, [inventoryWalletsBreakdown]);

  // Filtered Inventory list based on search and toggle
  const displayedInventoryWallets = useMemo(() => {
    let list = inventoryWalletsBreakdown;
    if (hideUnconsumedInventory) {
      list = list.filter(inv => inv.consumedPointsInShift > 0 || inv.consumedCostEGPInShift > 0);
    }
    if (inventorySearchQuery.trim()) {
      const q = inventorySearchQuery.trim().toLowerCase();
      list = list.filter(inv =>
        inv.name.toLowerCase().includes(q) ||
        inv.pointType.toLowerCase().includes(q)
      );
    }
    return list;
  }, [inventoryWalletsBreakdown, hideUnconsumedInventory, inventorySearchQuery]);

  // Deficit State
  const [isAddDeficitOpen, setIsAddDeficitOpen] = useState(false);
  const [deficitWalletId, setDeficitWalletId] = useState('');
  const [deficitPhoneNumberId, setDeficitPhoneNumberId] = useState('');
  const [deficitAmount, setDeficitAmount] = useState<number>(0);
  const [deficitExpectedBalance, setDeficitExpectedBalance] = useState<number>(0);
  const [deficitActualBalance, setDeficitActualBalance] = useState<number>(0);
  const [deficitReason, setDeficitReason] = useState('');

  // Resolution state in settlement step 2
  const [resolutionType, setResolutionType] = useState<'resolved_deducted' | 'resolved_store_loss' | 'resolved_adjusted'>('resolved_deducted');
  const [resolutionNotes, setResolutionNotes] = useState('');

  // Step 3: Currency & USDT Conversion Rate
  const usdtRate = 50.5;
  const profitInUSDT = usdtRate > 0 ? Math.round((totalShiftProfit / usdtRate) * 100) / 100 : 0;
  const revenueInUSDT = usdtRate > 0 ? Math.round((totalShiftRevenue / usdtRate) * 100) / 100 : 0;

  // Step 2: Sub-tabs and Actual Balances Entry
  const [step2WalletType, setStep2WalletType] = useState<'reception' | 'inventory'>('reception');
  const [actualReceptionBalances, setActualReceptionBalances] = useState<Record<string, number | string>>({});
  const [actualInventoryPoints, setActualInventoryPoints] = useState<Record<string, number | string>>({});

  // Filtered Wallets: ONLY Wallets used during this shift (لمنع ظهور مئات المحافظ غير المستخدمة)
  const usedReceptionWallets = useMemo(() => {
    return walletBreakdown.filter(wb => wb.totalReceivedInShift > 0);
  }, [walletBreakdown]);

  const usedInventoryWallets = useMemo(() => {
    return inventoryWalletsBreakdown.filter(inv => inv.consumedPointsInShift > 0 || inv.consumedCostEGPInShift > 0);
  }, [inventoryWalletsBreakdown]);

  // Step 3: Financial Allocations Breakdown (توزيع مخصصات الوارد لمنع خلط الأمانات بالبضاعة والأرباح)
  const revenueAllocationBreakdown = useMemo(() => {
    const totalRev = totalShiftRevenue || 1;
    return [
      {
        id: 'cost',
        title: '📦 تكلفة البضاعة (FIFO)',
        description: 'المبلغ المخصص لتغطية البضاعة المسحوبة للموردين ورأس المال',
        amount: totalShiftCost,
        percent: Math.round((totalShiftCost / totalRev) * 100),
        color: 'from-blue-500/20 to-indigo-500/10 text-blue-500 border-blue-500/30',
        targetVault: 'خزينة تغطية المخزون / سداد الموردين'
      },
      {id:'trust', title:'أمانات الأرصدة الزائدة', description:'مبالغ زائدة مستحقة للعملاء', amount:money(shiftTickets.reduce((sum,t)=>sum+ticketContribution(t,'trust'),0)), percent:0, color:'text-amber-500 border-amber-500/30', targetVault:'محفظة الأمانات'},
      {
        id: 'profit',
        title: '💰 صافي أرباح الشركة',
        description: 'الأرباح الحقيقية المحققة من عمليات البيع بالوردية',
        amount: totalShiftProfit,
        percent: Math.round((totalShiftProfit / totalRev) * 100),
        color: 'from-emerald-500/20 to-teal-500/10 text-emerald-500 border-emerald-500/30',
        targetVault: 'خزينة الأرباح المستقلة'
      },
      {
        id: 'cashback',
        title: '🎁 أمانات كاش باك العملاء',
        description: 'الأرصدة الممنوحة والمستحقة للعملاء ككاش باك على التذاكر',
        amount: totalShiftCashback,
        percent: Math.round((totalShiftCashback / totalRev) * 100),
        color: 'from-amber-500/20 to-orange-500/10 text-amber-500 border-amber-500/30',
        targetVault: 'محفظة / خزينة الكاش باك'
      },
      {
        id: 'referral',
        title: '👥 أمانات عمولات الإحالة',
        description: 'عمولات المسوقين والإحالات المحجوزة للمستفيدين',
        amount: totalShiftReferral,
        percent: Math.round((totalShiftReferral / totalRev) * 100),
        color: 'from-purple-500/20 to-pink-500/10 text-purple-500 border-purple-500/30',
        targetVault: 'محفظة / خزينة عمولات الإحالة'
      },
      {
        id: 'expenses',
        title: '⚙️ محفظة مصاريف التشغيل والسيرفرات',
        description: 'التكاليف الثابتة ورسوم بوابات الدفع المحملة على العمليات',
        amount: totalShiftOperatingExpenses,
        percent: Math.round((totalShiftOperatingExpenses / totalRev) * 100),
        color: 'from-rose-500/20 to-red-500/10 text-rose-500 border-rose-500/30',
        targetVault: 'محفظة مصاريف التشغيل'
      }
    ];
  }, [shiftTickets, totalShiftRevenue, totalShiftCost, totalShiftProfit, totalShiftCashback, totalShiftReferral, totalShiftOperatingExpenses]);

  // Step 3: Wallet Transfer & Mandatory Destination Selection

  // Final Settlement Notes
  const [settlementFinalNotes, setSettlementFinalNotes] = useState('');

  // Unresolved deficits check
  const pendingDeficits = useMemo(() => {
    return deficits.filter(d => d.status === 'pending_review');
  }, [deficits]);

  // Expandable Wallets list state
  const [expandedWallets, setExpandedWallets] = useState<Record<string, boolean>>({});
  const toggleWalletExpand = (wId: string) => {
    setExpandedWallets(prev => ({ ...prev, [wId]: !prev[wId] }));
  };

  // Quick Deficit Recording for Reception Wallet in Step 2
  const handleQuickRegisterDeficit = (
    walletId: string,
    walletName: string,
    expected: number,
    actual: number,
    phone?: string,
    phoneId?: string
  ) => {
    const diff = actual - expected;
    if (diff >= 0) {
      showToast('info', 'الرصيد مطابق', 'لا يوجد عجز مالي في هذه المحفظة.');
      return;
    }
    const defAmount = Math.abs(diff);
    const newDeficit: ShiftDeficitItem = {
      id: 'def_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      shiftId: `shift_${filterStartDate}`,
      walletId,
      walletName,
      phoneNumberId: phoneId,
      phoneNumber: phone,
      deficitAmount: defAmount,
      expectedBalance: expected,
      actualBalance: actual,
      employeeId: user?.id,
      employeeName: user?.fullName || 'الموظف',
      reason: `عجز تم رصده في تصفية الوردية (المتوقع دفترياً: ${expected} ج - الفعلي: ${actual} ج)`,
      reportedAt: new Date().toISOString(),
      status: 'pending_review'
    };

    db.saveShiftDeficit(newDeficit);
    db.logAction(
      { id: user?.id || 'sys', name: user?.fullName || 'الموظف', role: user?.role || 'user', department: 'المالية' },
      'add',
      'تسجيل عجز مالي في الوردية',
      newDeficit.id,
      `عجز بقيمة ${defAmount} ج`,
      `تم رصد وتسجيل عجز بقيمة ${defAmount} ج على ${walletName} وتم رفعه للمعالجة.`
    );

    showToast('warning', 'تم قيد العجز للمراجعة', `تم تسجيل عجز بقيمة ${defAmount} ج على ${walletName}. يمكنك حله أدناه.`);
    reloadData();
  };

  // Quick Deficit Recording for Inventory Wallet in Step 2
  const handleQuickRegisterInventoryDeficit = (
    invId: string,
    invName: string,
    expectedPts: number,
    actualPts: number,
    pointType: string
  ) => {
    const diff = actualPts - expectedPts;
    if (diff >= 0) {
      showToast('info', 'الرصيد مطابق', 'لا يوجد نقص في نقاط هذه المحفظة.');
      return;
    }
    const defPoints = Math.abs(diff);
    const newDeficit: ShiftDeficitItem = {
      id: 'def_inv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      shiftId: `shift_${filterStartDate}`,
      walletId: invId,
      walletName: `${invName} [مخزون]`,
      deficitAmount: defPoints,
      expectedBalance: expectedPts,
      actualBalance: actualPts,
      employeeId: user?.id,
      employeeName: user?.fullName || 'الموظف',
      reason: `نقص نقاط بضاعة في الوردية (المتوقع: ${expectedPts} ${pointType} - الفعلي: ${actualPts} ${pointType})`,
      reportedAt: new Date().toISOString(),
      status: 'pending_review'
    };

    db.saveShiftDeficit(newDeficit);
    db.logAction(
      { id: user?.id || 'sys', name: user?.fullName || 'الموظف', role: user?.role || 'user', department: 'المخزون' },
      'add',
      'تسجيل نقص بضاعة في الوردية',
      newDeficit.id,
      `نقص ${defPoints} ${pointType}`,
      `تم رصد وتسجيل نقص بضاعة بقيمة ${defPoints} ${pointType} على ${invName}.`
    );

    showToast('warning', 'تم قيد نقص البضاعة', `تم تسجيل نقص بقيمة ${defPoints} ${pointType} على ${invName}.`);
    reloadData();
  };

  // Submit New Deficit (Employee or Owner Manual Form)
  const handleSaveDeficit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deficitWalletId) {
      showToast('error', 'اختر المحفظة', 'يرجى تحديد المحفظة التي حدث بها العجز');
      return;
    }
    if (deficitAmount <= 0) {
      showToast('error', 'مبلغ العجز غير صحيح', 'يرجى كتابة قيمة العجز بالجنيه');
      return;
    }

    const selectedW = wallets.find(w => w.id === deficitWalletId);
    const selectedNum = (selectedW?.numbers || []).find(n => n.id === deficitPhoneNumberId);

    const newDeficit: ShiftDeficitItem = {
      id: 'def_' + Date.now(),
      shiftId: `shift_${filterStartDate}`,
      walletId: selectedW?.id || deficitWalletId,
      walletName: selectedW?.name || 'محفظة',
      phoneNumberId: selectedNum?.id,
      phoneNumber: selectedNum?.phoneNumber,
      deficitAmount,
      expectedBalance: deficitExpectedBalance || undefined,
      actualBalance: deficitActualBalance || undefined,
      employeeId: user?.id,
      employeeName: user?.fullName || 'الموظف',
      reason: deficitReason.trim() || 'عجز مالي مسجل في الوردية',
      reportedAt: new Date().toISOString(),
      status: 'pending_review'
    };

    db.saveShiftDeficit(newDeficit);
    db.logAction(
      { id: user?.id || 'sys', name: user?.fullName || 'الموظف', role: user?.role || 'user', department: 'المالية' },
      'add',
      'تسجيل عجز مالي في الوردية',
      newDeficit.id,
      `عجز بقيمة ${deficitAmount} ج`,
      `تم تسجيل عجز مالي على محفظة "${newDeficit.walletName}" بقيمة ${deficitAmount} جنيه وتم رفعه للمالك للمراجعة والحل.`
    );

    showToast('success', 'تم رفع تقرير العجز للمالك', `تم تسجيل عجز بقيمة ${deficitAmount} ج على ${newDeficit.walletName} بنجاح.`);
    setIsAddDeficitOpen(false);
    setDeficitAmount(0);
    setDeficitExpectedBalance(0);
    setDeficitActualBalance(0);
    setDeficitReason('');
    reloadData();
  };

  // Resolve Deficit (Owner Only)
  const handleConfirmResolveDeficit = (deficitId: string) => {
    if (!isOwner) {
      showToast('error', 'غير مصرح', 'معالجة العجز المالي مخصصة للمالك فقط.');
      return;
    }

    db.resolveShiftDeficit(
      deficitId,
      resolutionType,
      resolutionNotes.trim() || 'تمت المعالجة من قبل المالك أثناء تصفية الوردية',
      user?.fullName || 'المالك'
    );

    db.logAction(
      { id: user?.id || 'owner', name: user?.fullName || 'المالك', role: 'admin', department: 'المالية' },
      'edit',
      'معالجة عجز مالي في الوردية',
      deficitId,
      `معالجة عجز: ${resolutionType}`,
      `تم اعتماد حل العجز بنوع (${resolutionType}) مع ملاحظة: ${resolutionNotes}`
    );

    showToast('success', 'تمت معالجة العجز المالي', 'تم تحديث حالة العجز وتسويتها بنجاح');
    setResolutionNotes('');
    reloadData();
  };

  const [isSettling, setIsSettling] = useState(false);
  const settlementLock = React.useRef(false);
  const settlementRequestId = React.useRef('settle_' + crypto.randomUUID());
  const shiftPreview = useMemo(() => {
    try {
      return {plan: db.getShiftDistributionPlan(shiftTickets.map(t => t.id)), error: ''};
    } catch (error) { return {plan: null, error: (error as Error).message}; }
  }, [shiftTickets, wallets, settlements]);

  const handleConfirmFinalSettlement = async () => {
    if (settlementLock.current) return;
    if (!isOwner || selectedDeptFilter !== 'customers' || datePreset !== 'active_shift') {
      showToast('error','التصفية غير متاحة','اختر الوردية النشطة بقسم العملاء من حساب المالك؛ الفلاتر التاريخية للعرض فقط.');
      return;
    }
    if (!shiftPreview.plan || !shiftTickets.length || pendingDeficits.length) {
      showToast('error','لم تكتمل المراجعة',shiftPreview.error || 'لا توجد تذاكر جديدة أو يوجد عجز معلق.');
      return;
    }
    settlementLock.current = true; setIsSettling(true);
    try {
      // Flush earlier actions before taking the final plan. All following writes
      // are synchronous, and the adapter commits tickets, cash and close together.
      await db.flushFinancialChanges();
      const result = db.closeDistributedShift({id: settlementRequestId.current, ticketIds: shiftTickets.map(t=>t.id),
        expectedPlan: shiftPreview.plan.signature,
        notes: settlementFinalNotes.trim(), startTime: activeShiftStartTime || undefined,
        walletsSnapshot: walletBreakdown}, {id:user.id, name:user.fullName || 'المالك', role:user.role});
      if (!result.success) throw new Error(result.message);
      await db.flushFinancialChanges();
      const settlement = result.settlement!;
      window.dispatchEvent(new CustomEvent('shift_settled',{detail:settlement}));
      eventBus.publish(SYSTEM_EVENTS.WALLET_MUTATED,{});
      eventBus.publish(SYSTEM_EVENTS.VAULT_UPDATED,{});
      eventBus.publish('SHIFT_SETTLED',settlement);
      showToast('success','تم إغلاق الوردية',`تم تصفير الاستقبال وتوزيع ${formatCurrency(settlement.totalTransferredEGP||0)}؛ الرئيسية استلمت تكلفة البضاعة فقط ${formatCurrency(settlement.distribution?.goods||0)}.`);
      settlementRequestId.current = 'settle_' + crypto.randomUUID();
      reloadData(); setDatePreset('active_shift'); setSettlementStep(1); onClose();
    } catch(error) {
      showToast('error','لم تكتمل التصفية',(error as Error).message);
      reloadData();
    } finally {settlementLock.current=false;setIsSettling(false);}
  };

  // PDF Print (تقرير نهاية الوردية الموحد والشامل لكافة المحافظ)
  const handlePrintSettlement = () => {
    const config: ReportConfig = {
      startDate: filterStartDate,
      endDate: filterEndDate,
      reportType: 'detailed',
      showProfits: true,
      showCosts: true,
      showExpenses: true,
      showLogo: true,
      showUserData: true,
      showPageNumbers: true,
      showManagerSignature: true,
      paperSize: 'A4'
    };

    const payload = {
      revenue: totalShiftRevenue,
      cost: totalShiftCost,
      profit: totalShiftProfit,
      cashback: totalShiftCashback,
      referral: totalShiftReferral,
      operatingExpenses: totalShiftOperatingExpenses,
      receptionWallets: usedReceptionWallets.map(w => {
        const actual = actualReceptionBalances[w.walletId] !== undefined && actualReceptionBalances[w.walletId] !== ''
          ? Number(actualReceptionBalances[w.walletId])
          : w.currentBalance;
        const diff = actual - w.currentBalance;
        return {
          name: w.walletName,
          phone: w.accountNumber || (w.numbersBreakdown?.[0]?.phoneNumber) || '—',
          opening: (w.currentBalance || 0) - (w.totalReceivedInShift || 0),
          received: w.totalReceivedInShift,
          expected: w.currentBalance,
          actual: actual,
          diff: diff
        };
      }),
      inventoryWallets: usedInventoryWallets.map(inv => {
        const actual = actualInventoryPoints[inv.id] !== undefined && actualInventoryPoints[inv.id] !== ''
          ? Number(actualInventoryPoints[inv.id])
          : inv.currentPoints;
        const diff = actual - inv.currentPoints;
        return {
          name: inv.name,
          type: inv.pointType,
          opening: inv.expectedPointsBeforeShift,
          consumedPts: inv.consumedPointsInShift,
          consumedCost: inv.consumedCostEGPInShift,
          current: actual,
          diff: diff
        };
      }),
      allocation: revenueAllocationBreakdown,
      transfers: []
    };

    const doc = ReportEngine.generateReportDocument('shift_settlement', config, payload);
    ReportEngine.printReportDocument(doc, config);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="📑 إدارة وفحص وتصفية الوردية المالية"
      subtitle="نظام متكامل لمراجعة إيرادات ومحافظ الاستقبال والبضاعة وتسجيل العجز وتصفية الأرباح للمالك"
      maxWidth="4xl"
    >
      <div className="space-y-4 text-right text-xs">
        {/* Top Controls: Mode Switcher */}
        <div className="flex items-center justify-between p-1.5 rounded-2xl bg-gray-100 dark:bg-[#141417] border border-gray-200 dark:border-[#27272A]">
          <div className="flex items-center gap-1.5 w-full">
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`flex-1 py-2 px-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'audit'
                  ? 'bg-white dark:bg-[#1f1f23] text-zinc-900 dark:text-zinc-100 shadow-sm border border-gray-200 dark:border-zinc-700'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
              }`}
            >
              <FileText className="w-4 h-4 text-blue-500" />
              <span>🔍 فحص الوردية (Shift Audit)</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-normal">
                للموظف والمراجعة
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!isOwner) {
                  showToast('warning', 'صلاحية المالك فقط', 'زر تصفية الوردية مخصص للمالك حصرياً لإتمام الإغلاق المحاسبي وتوزيع الأرباح.');
                  return;
                }
                setActiveTab('settlement');
              }}
              className={`flex-1 py-2 px-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'settlement'
                  ? 'bg-white dark:bg-[#1f1f23] text-purple-600 dark:text-purple-400 shadow-sm border border-purple-500/30'
                  : 'text-zinc-500 hover:text-purple-400'
              }`}
            >
              <Lock className="w-3.5 h-3.5 text-purple-500" />
              <span>🔒 تصفية الوردية (Shift Settlement)</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 font-bold">
                للمالك فقط ⭐
              </span>
            </button>
          </div>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* 🗓️ INTERACTIVE CALENDAR & SHIFT FILTERS BAR                         */}
        {/* ----------------------------------------------------------------- */}
        <div className="p-3 rounded-2xl bg-white dark:bg-[#18181B] border border-gray-200 dark:border-[#27272A] space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Quick Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-zinc-400 font-bold text-[11px] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-orange-500" />
                <span>نظام الوردية:</span>
              </span>

              {/* 1. Active Shift Button (Default) */}
              <button
                type="button"
                onClick={() => setDatePreset('active_shift')}
                className={`py-1 px-3 rounded-lg font-bold text-[11px] transition-all flex items-center gap-1.5 cursor-pointer ${
                  datePreset === 'active_shift'
                    ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-500/30'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                }`}
                title="عرض تذاكر وأرصدة الوردية الحالية المفتوحة منذ آخر تصفية حتى اللحظة (لا تصفر عند 12:00 منتصف الليل)"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>🟢 الوردية الحالية (النشطة)</span>
              </button>

              {/* 2. Today Calendar */}
              <button
                type="button"
                onClick={() => {
                  setDatePreset('today');
                  setFilterStartDate(todayStr);
                  setFilterEndDate(todayStr);
                }}
                className={`py-1 px-2.5 rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
                  datePreset === 'today'
                    ? 'bg-orange-500 text-white shadow-xs'
                    : 'bg-gray-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
                }`}
              >
                📅 اليوم ({todayStr})
              </button>

              {/* 3. Yesterday Calendar */}
              <button
                type="button"
                onClick={() => {
                  setDatePreset('yesterday');
                  setFilterStartDate(yesterdayStr);
                  setFilterEndDate(yesterdayStr);
                }}
                className={`py-1 px-2.5 rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
                  datePreset === 'yesterday'
                    ? 'bg-orange-500 text-white shadow-xs'
                    : 'bg-gray-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
                }`}
              >
                ⏳ الأمس ({yesterdayStr})
              </button>

              {/* 4. History / Past Settlements Button */}
              {settlements.filter(s => s.status === 'closed' || s.status === 'verified').length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDatePreset('history');
                    if (!selectedHistorySettlementId && latestSettlement) {
                      setSelectedHistorySettlementId(latestSettlement.id);
                    }
                  }}
                  className={`py-1 px-2.5 rounded-lg font-bold text-[11px] transition-colors flex items-center gap-1 cursor-pointer ${
                    datePreset === 'history'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20'
                  }`}
                  title="عرض ومراجعة تفاصيل وأرقام الورديات التي تمت تصفيتها سابقاً"
                >
                  <Receipt className="w-3 h-3" />
                  <span>📜 الورديات السابقة ({settlements.filter(s => s.status === 'closed' || s.status === 'verified').length})</span>
                </button>
              )}

              {/* 5. Custom Range */}
              <button
                type="button"
                onClick={() => setDatePreset('custom')}
                className={`py-1 px-2.5 rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
                  datePreset === 'custom'
                    ? 'bg-orange-500 text-white shadow-xs'
                    : 'bg-gray-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
                }`}
              >
                🗓️ تاريخ مخصص
              </button>
            </div>

            {/* Department Filter & Active Line Toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Department */}
              <div className="flex items-center gap-1">
                <span className="text-zinc-400 text-[11px]">القسم:</span>
                <select
                  value={selectedDeptFilter}
                  onChange={e => setSelectedDeptFilter(e.target.value as any)}
                  className="rounded-lg bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 p-1 text-zinc-800 dark:text-zinc-200 font-bold outline-none text-[11px]"
                >
                  <option value="all">جميع الأقسام (عملاء + تجار)</option>
                  <option value="customers">قسم العملاء فقط</option>
                  <option value="dealers">قسم التجار فقط</option>
                </select>
              </div>

              {/* Hide 0-Lines Toggle */}
              <button
                type="button"
                onClick={() => setHideInactiveLines(prev => !prev)}
                className={`py-1 px-2 rounded-lg font-bold text-[10px] flex items-center gap-1 border transition-colors ${
                  hideInactiveLines
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500'
                    : 'bg-gray-100 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-zinc-400'
                }`}
                title="إخفاء الأرقام والخطوط التي لم تستلم أي تحويلات في هذه الوردية (0 ج)"
              >
                {hideInactiveLines ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                <span>{hideInactiveLines ? 'الأرقام النشطة فقط (استلمت > 0)' : 'عرض كل الأرقام حتى 0 ج'}</span>
              </button>
            </div>
          </div>

          {/* Active Shift Details Ribbon */}
          {datePreset === 'active_shift' && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-800 dark:text-emerald-300 animate-fade-in">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span>بداية الوردية الحالية:</span>
                </span>
                <span className="font-mono font-bold bg-white/70 dark:bg-zinc-900/70 px-2 py-0.5 rounded-md border border-emerald-500/20">
                  {latestSettlement ? formatDateTime(latestSettlement.closedAt || latestSettlement.endTime) : 'بداية تشغيل النظام'}
                </span>
                {latestSettlement && (
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                    (تاريخ آخر تصفية معتمدة #{latestSettlement.shiftNumber})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                  shiftTickets.length === 0
                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                    : 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30'
                }`}>
                  {shiftTickets.length === 0 ? '✨ الوردية جديدة ومصفاة (رصيد 0 ج.م)' : `⚡ ${shiftTickets.length} تذكرة مسددة خلال هذه الوردية`}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400 text-[10px]">
                  • مرتبطة بوقت التصفية ولا تصفر عند 12:00 منتصف الليل
                </span>
              </div>
            </div>
          )}

          {/* Historical Settlements Dropdown */}
          {datePreset === 'history' && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[11px] animate-fade-in">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-purple-700 dark:text-purple-300 font-bold flex items-center gap-1">
                  <Receipt className="w-3.5 h-3.5" />
                  <span>عرض وردية سابقة مصفاة:</span>
                </span>
                <select
                  value={selectedHistorySettlementId || (latestSettlement?.id || '')}
                  onChange={e => setSelectedHistorySettlementId(e.target.value)}
                  className="rounded-lg bg-white dark:bg-zinc-800 border border-purple-500/30 p-1.5 text-zinc-800 dark:text-zinc-200 font-bold outline-none text-[11px] shadow-xs"
                >
                  {settlements
                    .filter(s => s.status === 'closed' || s.status === 'verified')
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        #{s.shiftNumber} | {formatDateTime(s.endTime || s.closedAt)} | إيراد: {formatCurrency(s.totalRevenue || s.expectedCash)} ({s.employeeName})
                      </option>
                    ))}
                </select>
              </div>
              <span className="text-purple-600 dark:text-purple-400 font-mono text-[10px] font-bold">
                ({shiftTickets.length} تذكرة موثقة في هذه الوردية)
              </span>
            </div>
          )}

          {/* Date Range Inputs if Custom */}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-3 pt-1 border-t border-gray-100 dark:border-zinc-800 animate-fade-in flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400 text-[11px]">من تاريخ:</span>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={e => setFilterStartDate(e.target.value)}
                  className="p-1.5 rounded-lg bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 font-mono text-[11px] outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400 text-[11px]">إلى تاريخ:</span>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={e => setFilterEndDate(e.target.value)}
                  className="p-1.5 rounded-lg bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 font-mono text-[11px] outline-none"
                />
              </div>

              <span className="text-orange-500 font-mono text-[11px] font-bold">
                ({shiftTickets.length} تذكرة مسددة خلال هذه الفترة)
              </span>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* 1️⃣ TAB 1: SHIFT AUDIT (فحص الوردية)                                       */}
        {/* ========================================================================= */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            {/* Top 6 KPIs Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 font-mono">
              <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 space-y-1">
                <span className="text-blue-500 font-bold text-[10px] block font-sans">1. إجمالي الوارد</span>
                <strong className="text-sm font-black text-blue-600 dark:text-blue-400 block">
                  {formatCurrency(totalShiftRevenue)}
                </strong>
                <span className="text-[9px] text-zinc-500 font-sans block">{shiftTickets.length} تذكرة مسددة</span>
              </div>

              <div className="p-3 rounded-2xl bg-orange-500/10 border border-orange-500/20 space-y-1">
                <span className="text-orange-500 font-bold text-[10px] block font-sans">2. تكلفة البضاعة</span>
                <strong className="text-sm font-black text-orange-600 dark:text-orange-400 block">
                  {formatCurrency(totalShiftCost)}
                </strong>
                <span className="text-[9px] text-zinc-500 font-sans block">مسحوبة من المخزون</span>
              </div>

              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                <span className="text-emerald-500 font-bold text-[10px] block font-sans">3. إجمالي الأرباح</span>
                <strong className="text-sm font-black text-emerald-600 dark:text-emerald-400 block">
                  +{formatCurrency(totalShiftProfit)}
                </strong>
                <span className="text-[9px] text-emerald-500 font-sans block">${profitInUSDT} USDT</span>
              </div>

              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-1">
                <span className="text-amber-500 font-bold text-[10px] block font-sans">4. إجمالي الكاش باك</span>
                <strong className="text-sm font-black text-amber-600 dark:text-amber-400 block">
                  {formatCurrency(totalShiftCashback)}
                </strong>
                <span className="text-[9px] text-amber-500/70 font-sans block">أمانات العملاء</span>
              </div>

              <div className="p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 space-y-1">
                <span className="text-purple-500 font-bold text-[10px] block font-sans">5. رصيد الإحالة</span>
                <strong className="text-sm font-black text-purple-600 dark:text-purple-400 block">
                  {formatCurrency(totalShiftReferral)}
                </strong>
                <span className="text-[9px] text-purple-500/70 font-sans block">عمولات المسوقين</span>
              </div>

              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 space-y-1">
                <span className="text-rose-500 font-bold text-[10px] block font-sans">6. مصاريف التشغيل</span>
                <strong className="text-sm font-black text-rose-600 dark:text-rose-400 block">
                  {formatCurrency(totalShiftOperatingExpenses)}
                </strong>
                <span className="text-[9px] text-rose-500/70 font-sans block">رسوم وسيرفرات</span>
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 🎛️ SUB-TABS NAVIGATION: الخانة 1 vs الخانة 2                */}
            {/* ------------------------------------------------------------- */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-2xl bg-white dark:bg-[#18181B] border border-gray-200 dark:border-[#27272A] shadow-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setAuditSubTab('both')}
                  className={`px-3.5 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                    auditSubTab === 'both'
                      ? 'bg-gradient-to-r from-orange-500 via-purple-600 to-indigo-600 text-white font-black shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>عرض الخانتين معاً (شامل)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAuditSubTab('reception')}
                  className={`px-3.5 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                    auditSubTab === 'reception'
                      ? 'bg-orange-500 text-white font-black shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Wallet className="w-3.5 h-3.5" />
                  <span>الخانة 1: محافظ وأرقام الاستقبال ({displayedWallets.length})</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/20 text-white font-normal">
                    التي استلمت
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setAuditSubTab('inventory')}
                  className={`px-3.5 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                    auditSubTab === 'inventory'
                      ? 'bg-purple-600 text-white font-black shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Boxes className="w-3.5 h-3.5" />
                  <span>الخانة 2: محافظ البضاعة والمخزون ({inventoryWalletsBreakdown.length})</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/20 text-white font-normal">
                    فيها كام • استهلكنا كام • المفروض كام
                  </span>
                </button>
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 💳 الخانة 1: محافظ وأرقام الاستقبال                           */}
            {/* ------------------------------------------------------------- */}
            {(auditSubTab === 'both' || auditSubTab === 'reception') && (
              <div className="p-4 rounded-2xl bg-white dark:bg-[#18181B] border border-gray-200 dark:border-[#27272A] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center font-bold">
                      1
                    </div>
                    <div>
                      <strong className="font-bold text-zinc-900 dark:text-zinc-100 text-xs block">
                        محافظ وأرقام الاستقبال (الأرقام والخطوط التي استلمت في الوردية)
                      </strong>
                      <span className="text-[10px] text-zinc-400">
                        متابعة حركة الأرقام والمبالغ المستلمة والليميت والرصيد الحالي
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setHideInactiveWallets(prev => !prev)}
                      className="text-[10px] text-orange-500 hover:underline font-bold cursor-pointer"
                    >
                      {hideInactiveWallets ? 'عرض جميع المحافظ' : 'إخفاء المحافظ التي لم تستلم (0 ج)'}
                    </button>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      ({displayedWallets.filter(w => w.totalReceivedInShift > 0).length} محفظة استقبلت مبالغ)
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {displayedWallets.map(wb => {
                    const isExpanded = expandedWallets[wb.walletId] ?? true;
                    return (
                      <div
                        key={wb.walletId}
                        className="border border-gray-200 dark:border-[#27272A] rounded-xl overflow-hidden shadow-2xs"
                      >
                        {/* Wallet Header Bar */}
                        <div
                          onClick={() => toggleWalletExpand(wb.walletId)}
                          className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
                            wb.totalReceivedInShift > 0
                              ? 'bg-orange-500/5 hover:bg-orange-500/10'
                              : 'bg-gray-50 dark:bg-[#141417] hover:bg-gray-100 dark:hover:bg-zinc-800/60'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Wallet className={`w-4 h-4 ${wb.totalReceivedInShift > 0 ? 'text-orange-500' : 'text-zinc-400'}`} />
                            <div>
                              <strong className="font-bold text-zinc-900 dark:text-zinc-100 text-xs block">
                                {wb.walletName}
                              </strong>
                              <span className="font-mono text-[11px] text-zinc-400">
                                {wb.accountNumber || 'رقم رئيسي'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-left font-mono">
                              <span className="text-[10px] text-zinc-400 block">المستلم في الوردية:</span>
                              <strong className={`text-xs ${wb.totalReceivedInShift > 0 ? 'text-orange-500 font-black' : 'text-zinc-400 font-bold'}`}>
                                {formatCurrency(wb.totalReceivedInShift, wb.currency)}
                              </strong>
                            </div>

                            <div className="text-left font-mono">
                              <span className="text-[10px] text-zinc-400 block">الرصيد الفعلي الحالي:</span>
                              <strong className="text-emerald-500 font-bold text-xs">
                                {formatCurrency(wb.currentBalance, wb.currency)}
                              </strong>
                            </div>

                            <div className="text-zinc-400">
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </div>
                          </div>
                        </div>

                        {/* Sub-numbers List */}
                        {isExpanded && (
                          <div className="p-2 bg-white dark:bg-[#18181B] border-t border-gray-100 dark:border-[#27272A]">
                            {wb.numbersBreakdown.length > 0 ? (
                              <table className="w-full text-right text-[11px]">
                                <thead>
                                  <tr className="text-zinc-400 border-b border-gray-100 dark:border-zinc-800 pb-1">
                                    <th className="py-1 px-2">رقم الخط</th>
                                    <th className="py-1 px-2">صاحب الخط</th>
                                    <th className="py-1 px-2">استلم في الوردية</th>
                                    <th className="py-1 px-2">الرصيد الحالي للخط</th>
                                    <th className="py-1 px-2">المتبقي من الليمت</th>
                                    <th className="py-1 px-2 text-center">حالة الخط في الوردية</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 dark:divide-zinc-800/40 font-mono">
                                  {wb.numbersBreakdown.map(nb => {
                                    const rem = Math.max(0, nb.monthlyLimit - nb.monthlyReceived);
                                    return (
                                      <tr key={nb.numberId || nb.phoneNumber} className="hover:bg-gray-50/50 dark:hover:bg-zinc-800/30">
                                        <td className="py-1.5 px-2 font-bold text-zinc-800 dark:text-zinc-200">
                                          {nb.phoneNumber}
                                        </td>
                                        <td className="py-1.5 px-2 font-sans text-zinc-500">
                                          {nb.accountHolderName || '—'}
                                        </td>
                                        <td className="py-1.5 px-2 font-bold text-orange-500">
                                          {formatCurrency(nb.receivedInShift)}
                                        </td>
                                        <td className="py-1.5 px-2 font-bold text-emerald-500">
                                          {formatCurrency(nb.currentBalance)}
                                        </td>
                                        <td className="py-1.5 px-2 text-zinc-400">
                                          {formatCurrency(rem)}
                                        </td>
                                        <td className="py-1.5 px-2 text-center font-sans">
                                          {nb.receivedInShift > 0 ? (
                                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-bold">
                                              ✅ استلم تحويلات
                                            </span>
                                          ) : (
                                            <span className="text-zinc-400 text-[10px]">
                                              لم يستلم (0 ج)
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : (
                              <p className="text-[11px] text-zinc-400 py-1.5 text-center font-sans">
                                {hideInactiveLines
                                  ? 'لم يستلم أي رقم في هذه المحفظة خلال هذه الوردية (تم إخفاء الأرقام غير النشطة ذات 0 ج).'
                                  : 'لا توجد أرقام فرعية مسجلة.'}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* 📦 الخانة 2: محافظ البضاعة والمخزون                           */}
            {/* ------------------------------------------------------------- */}
            {(auditSubTab === 'both' || auditSubTab === 'inventory') && (
              <div className="p-4 rounded-2xl bg-white dark:bg-[#18181B] border border-gray-200 dark:border-[#27272A] space-y-4">
                {/* Header & Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-gray-100 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center font-bold">
                      2
                    </div>
                    <div>
                      <strong className="font-bold text-zinc-900 dark:text-zinc-100 text-xs block">
                        محافظ البضاعة والمخزون (فيها كام • استهلكنا كام • المفروض يكون في كام)
                      </strong>
                      <span className="text-[10px] text-zinc-400">
                        متابعة أرصدة الألعاب، الشدات، الجواهر، الكروت، ودفعات الـ FIFO المستهلكة
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Search */}
                    <div className="relative">
                      <input
                        type="text"
                        value={inventorySearchQuery}
                        onChange={e => setInventorySearchQuery(e.target.value)}
                        placeholder="بحث بمحفظة البضاعة أو اللعبة..."
                        className="p-1.5 pr-7 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-200 outline-none w-48 font-bold"
                      />
                      <Search className="w-3.5 h-3.5 text-zinc-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    {/* Toggle unconsumed */}
                    <button
                      type="button"
                      onClick={() => setHideUnconsumedInventory(prev => !prev)}
                      className={`py-1.5 px-2.5 rounded-xl font-bold text-[10px] flex items-center gap-1 border transition-colors cursor-pointer ${
                        hideUnconsumedInventory
                          ? 'bg-purple-500/15 border-purple-500/30 text-purple-400'
                          : 'bg-gray-100 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-zinc-400 hover:text-zinc-200'
                      }`}
                      title="عرض المحافظ التي تم استهلاك نقاط منها فقط خلال هذه الوردية"
                    >
                      {hideUnconsumedInventory ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      <span>{hideUnconsumedInventory ? 'المستهلكة فقط (> 0)' : 'عرض جميع محافظ البضاعة'}</span>
                    </button>

                    <span className="text-[11px] text-zinc-400 font-mono">
                      ({displayedInventoryWallets.length} محفظة)
                    </span>
                  </div>
                </div>

                {/* KPI Summary Strip for Inventory */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <span className="text-emerald-500 font-bold text-[10px] block">💎 فيها كام (الرصيد الفعلي الحالي)</span>
                    <strong className="text-sm font-black text-emerald-400 font-mono block mt-0.5">
                      {totalInventoryCurrentPoints.toLocaleString()} نقطة / وحدة
                    </strong>
                    <span className="text-[9px] text-zinc-400 block">إجمالي المتوفر حالياً في المخزن</span>
                  </div>

                  <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
                    <span className="text-purple-400 font-bold text-[10px] block">🔻 استهلكنا كام (في الوردية)</span>
                    <strong className="text-sm font-black text-purple-400 font-mono block mt-0.5">
                      -{totalInventoryConsumedPoints.toLocaleString()} نقطة / وحدة
                    </strong>
                    <span className="text-[9px] text-zinc-400 block">مسحوبة لطلبات وتذاكر الوردية</span>
                  </div>

                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <span className="text-blue-400 font-bold text-[10px] block">🎯 المفروض يكون في كام (قبل الوردية)</span>
                    <strong className="text-sm font-black text-blue-400 font-mono block mt-0.5">
                      {totalInventoryExpectedPoints.toLocaleString()} نقطة / وحدة
                    </strong>
                    <span className="text-[9px] text-zinc-400 block">الرصيد الافتتاحي قبل السحب</span>
                  </div>

                  <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
                    <span className="text-orange-400 font-bold text-[10px] block">💵 تكلفة البضاعة (FIFO EGP)</span>
                    <strong className="text-sm font-black text-orange-400 font-mono block mt-0.5">
                      {formatCurrency(totalInventoryConsumedCost)}
                    </strong>
                    <span className="text-[9px] text-zinc-400 block">التكلفة الفعلية المحتسبة للمبيعات</span>
                  </div>
                </div>

                {/* List of Detailed Inventory Wallets Cards */}
                <div className="space-y-3">
                  {displayedInventoryWallets.length === 0 ? (
                    <div className="p-8 text-center text-zinc-400 bg-gray-50 dark:bg-zinc-900/40 rounded-xl border border-dashed border-gray-200 dark:border-zinc-800">
                      <Boxes className="w-8 h-8 mx-auto text-zinc-500 mb-2 opacity-60" />
                      <p className="font-bold text-xs">لا توجد محافظ بضاعة مطابقة للفلتر المحدد</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">جرب تعديل البحث أو عرض جميع محافظ البضاعة</p>
                    </div>
                  ) : (
                    displayedInventoryWallets.map(inv => {
                      const isExpanded = expandedInventoryWallets[inv.id] ?? false;
                      const wasConsumed = inv.consumedPointsInShift > 0 || inv.consumedCostEGPInShift > 0;

                      return (
                        <div
                          key={inv.id}
                          className={`border rounded-2xl overflow-hidden transition-all shadow-2xs ${
                            wasConsumed
                              ? 'border-purple-500/30 bg-purple-500/5'
                              : 'border-gray-200 dark:border-[#27272A] bg-white dark:bg-[#18181B]'
                          }`}
                        >
                          {/* Wallet Header Bar */}
                          <div
                            onClick={() => toggleInventoryWalletExpand(inv.id)}
                            className="p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-gray-100/50 dark:hover:bg-zinc-800/40 transition-colors"
                          >
                            {/* Title & Info */}
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 border ${
                                wasConsumed
                                  ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                                  : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400'
                              }`}>
                                <Boxes className="w-4 h-4" />
                              </div>

                              <div>
                                <div className="flex items-center gap-2">
                                  <strong className="text-xs font-black text-zinc-900 dark:text-zinc-100">
                                    {inv.name}
                                  </strong>
                                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 font-bold border border-purple-500/20 font-sans">
                                    {inv.pointType}
                                  </span>
                                  {wasConsumed && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500 text-white font-bold animate-pulse">
                                      سحب بالوردية 🔥
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-zinc-400 font-mono block mt-0.5">
                                  {inv.ticketItemsCount > 0
                                    ? `تم تنفيذ ${inv.ticketItemsCount} طلب/تذكرة من هذه المحفظة`
                                    : 'لم يتم سحب أي طلبات في هذه الوردية'}
                                </span>
                              </div>
                            </div>

                            {/* The 3 Core Figures Requested: فيها كام • استهلكنا كام • المفروض يكون في كام */}
                            <div className="flex items-center gap-3 sm:gap-6 flex-wrap font-mono">
                              {/* 1. فيها كام */}
                              <div className="text-left bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/20">
                                <span className="text-[9px] text-emerald-500 font-bold block font-sans">
                                  💎 فيها كام (الحالي):
                                </span>
                                <strong className="text-xs font-black text-emerald-400 block">
                                  {inv.currentPoints.toLocaleString()} نقطة
                                </strong>
                              </div>

                              {/* 2. استهلكنا كام */}
                              <div className={`text-left px-3 py-1.5 rounded-xl border ${
                                wasConsumed
                                  ? 'bg-purple-500/15 border-purple-500/30'
                                  : 'bg-gray-100 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700'
                              }`}>
                                <span className={`text-[9px] font-bold block font-sans ${wasConsumed ? 'text-purple-400' : 'text-zinc-400'}`}>
                                  🔻 استهلكنا كام:
                                </span>
                                <strong className={`text-xs font-black block ${wasConsumed ? 'text-purple-300' : 'text-zinc-400'}`}>
                                  {wasConsumed ? `-${inv.consumedPointsInShift.toLocaleString()} نقطة` : '0 نقطة'}
                                </strong>
                                {wasConsumed && (
                                  <span className="text-[9px] text-orange-400 block">
                                    تكلفة: {formatCurrency(inv.consumedCostEGPInShift)}
                                  </span>
                                )}
                              </div>

                              {/* 3. المفروض يكون في كام */}
                              <div className="text-left bg-blue-500/10 px-3 py-1.5 rounded-xl border border-blue-500/20">
                                <span className="text-[9px] text-blue-400 font-bold block font-sans">
                                  🎯 المفروض يكون في كام:
                                </span>
                                <strong className="text-xs font-black text-blue-400 block">
                                  {inv.expectedPointsBeforeShift.toLocaleString()} نقطة
                                </strong>
                                <span className="text-[9px] text-zinc-400 block font-sans">
                                  (الافتتاحي قبل السحب)
                                </span>
                              </div>

                              {/* Expand Chevron */}
                              <div className="text-zinc-400 p-1 rounded-lg bg-gray-100 dark:bg-zinc-800">
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </div>
                            </div>
                          </div>

                          {/* Expanded Content: Complete Details (Lots Breakdown & Executed Tickets) */}
                          {isExpanded && (
                            <div className="p-3.5 bg-white dark:bg-[#18181B] border-t border-gray-200 dark:border-[#27272A] space-y-3.5 animate-fade-in">
                              {/* Sub-Section 1: FIFO Lots Batches */}
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold text-zinc-400 flex items-center gap-1">
                                    <Package className="w-3.5 h-3.5 text-blue-400" />
                                    <span>سجل دفعات الوارد والمخزون FIFO للمحفظة ({inv.lots.length} دفعة مسجلة)</span>
                                  </span>
                                </div>

                                {inv.lots.length > 0 ? (
                                  <div className="overflow-x-auto border border-gray-100 dark:border-zinc-800 rounded-xl">
                                    <table className="w-full text-right text-[11px]">
                                      <thead className="bg-gray-50 dark:bg-zinc-800/60 text-zinc-400 font-bold">
                                        <tr>
                                          <th className="py-1.5 px-2.5">رقم اللوت (Lot #)</th>
                                          <th className="py-1.5 px-2.5">الكمية الافتتاحية</th>
                                          <th className="py-1.5 px-2.5">المتبقي الفعلي</th>
                                          <th className="py-1.5 px-2.5">تكلفة الوحدة (USD)</th>
                                          <th className="py-1.5 px-2.5">تكلفة الوحدة (EGP)</th>
                                          <th className="py-1.5 px-2.5">إجمالي قيمة اللوت</th>
                                          <th className="py-1.5 px-2.5">تاريخ الإيداع</th>
                                          <th className="py-1.5 px-2.5 text-center">حالة الدفعة</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/40 font-mono">
                                        {inv.lots.map(lot => {
                                          const isDepleted = (lot.remainingQuantity || 0) <= 0;
                                          return (
                                            <tr key={lot.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/30">
                                              <td className="py-1.5 px-2.5 font-bold text-purple-400">
                                                {lot.lotNumber || lot.id.slice(-6)}
                                              </td>
                                              <td className="py-1.5 px-2.5 text-zinc-400">
                                                {(lot.initialQuantity || 0).toLocaleString()}
                                              </td>
                                              <td className="py-1.5 px-2.5 font-bold text-emerald-400">
                                                {(lot.remainingQuantity || 0).toLocaleString()}
                                              </td>
                                              <td className="py-1.5 px-2.5 text-blue-400">
                                                ${lot.unitCostUSD ? lot.unitCostUSD.toFixed(4) : '-'}
                                              </td>
                                              <td className="py-1.5 px-2.5 text-orange-400 font-bold">
                                                {formatCurrency(lot.unitCostEGP || 0)}
                                              </td>
                                              <td className="py-1.5 px-2.5 text-zinc-300">
                                                {formatCurrency(lot.totalCostEGP || 0)}
                                              </td>
                                              <td className="py-1.5 px-2.5 text-zinc-400 font-sans">
                                                {lot.createdAt ? formatDate(lot.createdAt) : '-'}
                                              </td>
                                              <td className="py-1.5 px-2.5 text-center font-sans">
                                                {isDepleted ? (
                                                  <span className="px-2 py-0.2 rounded bg-zinc-500/10 text-zinc-400 text-[10px]">
                                                    مستنفذة بالكامل
                                                  </span>
                                                ) : (
                                                  <span className="px-2 py-0.2 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-bold">
                                                    نشطة للـ FIFO
                                                  </span>
                                                )}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-zinc-400 py-1 font-sans">
                                    لا توجد دفعات FIFO مسجلة مسبقاً لهذه المحفظة (الرصيد مباشر).
                                  </p>
                                )}
                              </div>

                              {/* Sub-Section 2: Tickets Consumed in Shift */}
                              <div className="space-y-1.5 pt-2 border-t border-gray-100 dark:border-zinc-800">
                                <span className="text-[11px] font-bold text-zinc-400 flex items-center gap-1">
                                  <Receipt className="w-3.5 h-3.5 text-orange-400" />
                                  <span>تفاصيل التذاكر المنفذة من هذه المحفظة في هذه الوردية ({inv.ticketDetails.length} طلب)</span>
                                </span>

                                {inv.ticketDetails.length > 0 ? (
                                  <div className="overflow-x-auto border border-gray-100 dark:border-zinc-800 rounded-xl">
                                    <table className="w-full text-right text-[11px]">
                                      <thead className="bg-gray-50 dark:bg-zinc-800/60 text-zinc-400 font-bold">
                                        <tr>
                                          <th className="py-1.5 px-2.5">كود التذكرة</th>
                                          <th className="py-1.5 px-2.5">العميل</th>
                                          <th className="py-1.5 px-2.5">الباقة / المنتج المشحون</th>
                                          <th className="py-1.5 px-2.5">الكمية</th>
                                          <th className="py-1.5 px-2.5">النقاط المسحوبة</th>
                                          <th className="py-1.5 px-2.5">تكلفة البضاعة (FIFO)</th>
                                          <th className="py-1.5 px-2.5">وقت التنفيذ</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/40 font-mono">
                                        {inv.ticketDetails.map((td, idx) => (
                                          <tr key={td.ticketId + '_' + idx} className="hover:bg-gray-50 dark:hover:bg-zinc-800/30">
                                            <td className="py-1.5 px-2.5 font-bold text-orange-400">
                                              #{td.ticketCode}
                                            </td>
                                            <td className="py-1.5 px-2.5 font-sans font-bold text-zinc-800 dark:text-zinc-200">
                                              {td.customerName}
                                            </td>
                                            <td className="py-1.5 px-2.5 font-sans text-zinc-400">
                                              {td.productName}
                                            </td>
                                            <td className="py-1.5 px-2.5 text-zinc-400">
                                              {td.quantity}
                                            </td>
                                            <td className="py-1.5 px-2.5 font-bold text-purple-400">
                                              -{td.consumedPoints.toLocaleString()}
                                            </td>
                                            <td className="py-1.5 px-2.5 font-bold text-emerald-400">
                                              {formatCurrency(td.costEGP)}
                                            </td>
                                            <td className="py-1.5 px-2.5 text-zinc-400 font-sans">
                                              {td.time}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-zinc-400 py-1 font-sans">
                                    لم يُسحب من هذه المحفظة في هذه الوردية (الرصيد لم يتغير).
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* ⚠️ C. DEFICITS ESCALATION & NOTES                             */}
            {/* ------------------------------------------------------------- */}
            <div className="p-4 rounded-2xl bg-white dark:bg-[#18181B] border border-gray-200 dark:border-[#27272A] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <strong className="font-bold text-zinc-900 dark:text-zinc-100 text-xs">
                    ملاحظات العجز المالي وتسجيل الفروقات للمالك
                  </strong>
                  {pendingDeficits.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-500 font-bold text-[10px]">
                      {pendingDeficits.length} عجز قيد المراجعة ⚠️
                    </span>
                  )}
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={<Plus className="w-3.5 h-3.5 text-rose-500" />}
                  onClick={() => setIsAddDeficitOpen(prev => !prev)}
                  className="border-rose-500/30 text-rose-500 hover:bg-rose-500/10 text-xs"
                >
                  {isAddDeficitOpen ? 'إلغاء النموذج' : '+ تسجيل عجز مالي'}
                </Button>
              </div>

              {/* Add Deficit Form */}
              {isAddDeficitOpen && (
                <form
                  onSubmit={handleSaveDeficit}
                  className="p-3.5 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-3 animate-fade-in"
                >
                  <strong className="text-rose-500 block text-xs font-bold">
                    📝 تسجيل عجز مالي جديد ورفعه لتقرير المالك:
                  </strong>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-bold text-zinc-600 dark:text-zinc-400 mb-1 text-[11px]">
                        المحفظة التي بها عجز *
                      </label>
                      <select
                        value={deficitWalletId}
                        onChange={e => {
                          setDeficitWalletId(e.target.value);
                          setDeficitPhoneNumberId('');
                        }}
                        className="w-full rounded-xl bg-white dark:bg-[#141417] border border-gray-200 dark:border-[#27272A] p-2 text-zinc-900 dark:text-zinc-100 font-bold outline-none"
                      >
                        <option value="">-- اختر المحفظة --</option>
                        {wallets.filter(w => !w.isSystemWallet).map(w => (
                          <option key={w.id} value={w.id}>
                            {w.name} (رصيدها: {formatCurrency(w.balance)})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-bold text-zinc-600 dark:text-zinc-400 mb-1 text-[11px]">
                        الرقم أو الخط (اختياري)
                      </label>
                      <select
                        value={deficitPhoneNumberId}
                        onChange={e => setDeficitPhoneNumberId(e.target.value)}
                        className="w-full rounded-xl bg-white dark:bg-[#141417] border border-gray-200 dark:border-[#27272A] p-2 text-zinc-900 dark:text-zinc-100 outline-none"
                      >
                        <option value="">-- كل أرقام المحفظة --</option>
                        {(wallets.find(w => w.id === deficitWalletId)?.numbers || []).map(n => (
                          <option key={n.id} value={n.id}>
                            {n.phoneNumber} ({n.accountHolderName || 'خط'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <Input
                        label="مبلغ العجز (جنيه) *"
                        type="number"
                        placeholder="مثال: 150"
                        value={deficitAmount || ''}
                        onChange={e => setDeficitAmount(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Input
                        label="الرصيد الدفتري المتوقع (جنيه)"
                        type="number"
                        placeholder="الرصيد المسجل بالسيستم..."
                        value={deficitExpectedBalance || ''}
                        onChange={e => setDeficitExpectedBalance(parseFloat(e.target.value) || 0)}
                      />
                    </div>

                    <div>
                      <Input
                        label="الرصيد الفعلي في المحفظة (جنيه)"
                        type="number"
                        placeholder="الموجود فعلياً في أبلكيشن الكاش..."
                        value={deficitActualBalance || ''}
                        onChange={e => setDeficitActualBalance(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </div>

                  <div>
                    <Input
                      label="سبب العجز / ملاحظة الموظف"
                      placeholder="اكتب سبب النقص أو الملاحظة للمالك..."
                      value={deficitReason}
                      onChange={e => setDeficitReason(e.target.value)}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsAddDeficitOpen(false)}
                    >
                      إلغاء
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      icon={<Check className="w-4 h-4" />}
                      className="bg-rose-600 hover:bg-rose-700"
                    >
                      تأكيد وتسجيل العجز ورفعه للمالك
                    </Button>
                  </div>
                </form>
              )}

              {/* Deficits Table */}
              {deficits.length > 0 ? (
                <div className="overflow-x-auto border border-gray-100 dark:border-[#27272A] rounded-xl">
                  <table className="w-full text-right text-[11px]">
                    <thead className="bg-gray-50 dark:bg-[#141417] text-zinc-400">
                      <tr>
                        <th className="py-2 px-3">المحفظة / الخط</th>
                        <th className="py-2 px-3">مبلغ العجز</th>
                        <th className="py-2 px-3">الموظف المسجل</th>
                        <th className="py-2 px-3">السبب / الملاحظة</th>
                        <th className="py-2 px-3">الحالة</th>
                        <th className="py-2 px-3">التاريخ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/40">
                      {deficits.map(d => (
                        <tr key={d.id} className="hover:bg-gray-50/50 dark:hover:bg-zinc-800/30">
                          <td className="py-2 px-3 font-bold text-zinc-800 dark:text-zinc-200">
                            {d.walletName} {d.phoneNumber ? `(${d.phoneNumber})` : ''}
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-rose-500">
                            -{formatCurrency(d.deficitAmount)}
                          </td>
                          <td className="py-2 px-3 text-zinc-500">{d.employeeName || '—'}</td>
                          <td className="py-2 px-3 text-zinc-400">{d.reason || '—'}</td>
                          <td className="py-2 px-3">
                            {d.status === 'pending_review' ? (
                              <Badge variant="warning" size="sm">
                                ⏳ قيد مراجعة المالك
                              </Badge>
                            ) : d.status === 'resolved_deducted' ? (
                              <Badge variant="default" size="sm">
                                ✂️ خُصم من الموظف
                              </Badge>
                            ) : d.status === 'resolved_store_loss' ? (
                              <Badge variant="danger" size="sm">
                                🏢 خسارة على المتجر
                              </Badge>
                            ) : (
                              <Badge variant="success" size="sm">
                                ✅ تسوية دفترياً
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 px-3 text-zinc-400 font-mono text-[10px]">
                            {formatDateTime(d.reportedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-zinc-400 text-center py-2 text-[11px]">
                  ✅ لا توجد أي عجوزات مالية مسجلة في هذه الوردية.
                </p>
              )}
            </div>

            {/* Print and Footer Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-[#27272A]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<Printer className="w-4 h-4 text-orange-500" />}
                onClick={handlePrintSettlement}
              >
                طباعة تقرير فحص الوردية PDF
              </Button>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>
                  إغلاق
                </Button>
                {isOwner && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Lock className="w-4 h-4" />}
                    onClick={() => setActiveTab('settlement')}
                    className="bg-purple-600 hover:bg-purple-700 font-bold"
                  >
                    الانتقال لتصفية الوردية (المالك) ➔
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2️⃣ TAB 2: SHIFT SETTLEMENT (تصفية الوردية - للمالك فقط)                     */}
        {/* ========================================================================= */}
        {activeTab === 'settlement' && (
          <div className="space-y-4">
            {!isOwner ? (
              <div className="p-8 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center space-y-3">
                <Lock className="w-10 h-10 text-rose-500 mx-auto" />
                <h3 className="font-bold text-zinc-900 dark:text-zinc-100 text-base">
                  ⛔ هذه الشاشة مخصصة للمالك فقط
                </h3>
                <p className="text-zinc-400 text-xs max-w-md mx-auto">
                  تصفية الوردية تتضمن تحويل الأرصدة وتسوية العجز وتوزيع الأرباح بالـ USDT، وهي صلاحية سيادية محصورة بمالك النظام. يمكنك استخدام تبويب "فحص الوردية" للمراجعة.
                </p>
                <Button variant="primary" size="sm" onClick={() => setActiveTab('audit')}>
                  العودة إلى فحص الوردية
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 4-Step Stepper Bar */}
                <div className="p-2.5 rounded-2xl bg-gray-50 dark:bg-[#141417] border border-gray-200 dark:border-[#27272A]">
                  <div className="grid grid-cols-4 gap-1 text-center font-bold text-[11px]">
                    {[
                      { step: 1, title: '1. فحص الوردية' },
                      { step: 2, title: '2. حل العجز' },
                      { step: 3, title: '3. تحويل المحافظ ووجهة الأموال' },
                      { step: 4, title: '4. تأكيد وتصفية الوردية' }
                    ].map(s => {
                      const isActive = settlementStep === s.step;
                      const isDone = settlementStep > s.step;
                      return (
                        <div
                          key={s.step}
                          onClick={() => {
                            if (s.step <= settlementStep) setSettlementStep(s.step);
                          }}
                          className={`py-2 px-1 rounded-xl cursor-pointer transition-colors flex items-center justify-center gap-1 ${
                            isActive
                              ? 'bg-purple-600 text-white shadow-sm'
                              : isDone
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : 'text-zinc-400'
                          }`}
                        >
                          {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                          <span>{s.title}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ----------------------------------------------------------------- */}
                {/* STEP 1: Audit Review (المرحلة 1: فحص مؤشرات الوردية الـ 6)        */}
                {/* ----------------------------------------------------------------- */}
                {settlementStep === 1 && (
                  <div className="space-y-3.5 animate-fade-in">
                    <div className="p-4 rounded-2xl bg-white dark:bg-[#18181B] border border-gray-200 dark:border-[#27272A] space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-zinc-900 dark:text-zinc-100 text-xs flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-purple-500" />
                          <span>المرحلة 1: مراجعة مؤشرات وأرصدة الوردية المالية الشاملة</span>
                        </h4>
                        <span className="text-[10px] text-zinc-400 font-mono">
                          {shiftTickets.length} تذكرة مسددة خلال هذه الوردية
                        </span>
                      </div>

                      {/* 6 Core KPIs Grid Requested by User */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 font-mono pt-1">
                        {/* 1. إجمالي الوارد */}
                        <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-blue-500 font-bold text-[11px] block font-sans">
                              1- إجمالي الوارد (Revenue):
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-500 font-bold">
                              الوارد المحصل
                            </span>
                          </div>
                          <strong className="text-base text-blue-600 dark:text-blue-400 block font-black">
                            {formatCurrency(totalShiftRevenue)}
                          </strong>
                          <span className="text-[10px] text-zinc-400 font-sans block">
                            ${revenueInUSDT} USDT (معادل بسعر صرف {usdtRate} ج)
                          </span>
                        </div>

                        {/* 2. إجمالي تكلفة البضاعة */}
                        <div className="p-3.5 rounded-xl bg-orange-500/10 border border-orange-500/20 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-orange-500 font-bold text-[11px] block font-sans">
                              2- إجمالي تكلفة البضاعة (FIFO):
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-orange-500/20 text-orange-500 font-bold">
                              تكلفة المخزون
                            </span>
                          </div>
                          <strong className="text-base text-orange-600 dark:text-orange-400 block font-black">
                            {formatCurrency(totalShiftCost)}
                          </strong>
                          <span className="text-[10px] text-zinc-400 font-sans block">
                            التكلفة المسحوبة من محافظ البضاعة والمخزون
                          </span>
                        </div>

                        {/* 3. إجمالي الأرباح */}
                        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-emerald-500 font-bold text-[11px] block font-sans">
                              3- إجمالي الأرباح (Net Profit):
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-500 font-bold">
                              أرباح صافية
                            </span>
                          </div>
                          <strong className="text-base text-emerald-600 dark:text-emerald-400 block font-black">
                            +{formatCurrency(totalShiftProfit)}
                          </strong>
                          <span className="text-[10px] text-emerald-500/80 font-sans block">
                            ${profitInUSDT} USDT أرباح موثقة ومسجلة
                          </span>
                        </div>

                        {/* 4. إجمالي الكاش باك */}
                        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-amber-500 font-bold text-[11px] block font-sans">
                              4- إجمالي الكاش باك (Cashback):
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-500 font-bold">
                              أمانات العملاء
                            </span>
                          </div>
                          <strong className="text-base text-amber-600 dark:text-amber-400 block font-black">
                            {formatCurrency(totalShiftCashback)}
                          </strong>
                          <span className="text-[10px] text-zinc-400 font-sans block">
                            أرصدة كاش باك مجنبة ومستحقة للمحافظ
                          </span>
                        </div>

                        {/* 5. إجمالي رصيد الإحالة */}
                        <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-purple-500 font-bold text-[11px] block font-sans">
                              5- إجمالي رصيد الإحالة (Referral):
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-500 font-bold">
                              عمولات المسوقين
                            </span>
                          </div>
                          <strong className="text-base text-purple-600 dark:text-purple-400 block font-black">
                            {formatCurrency(totalShiftReferral)}
                          </strong>
                          <span className="text-[10px] text-zinc-400 font-sans block">
                            عمولات الإحالة المحجوزة للمسوقين والشركاء
                          </span>
                        </div>

                        {/* 6. إجمالي رصيد محفظة مصاريف التشغيل */}
                        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-rose-500 font-bold text-[11px] block font-sans">
                              6- إجمالي رصيد مصاريف التشغيل:
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-500 font-bold">
                              تكاليف التشغيل
                            </span>
                          </div>
                          <strong className="text-base text-rose-600 dark:text-rose-400 block font-black">
                            {formatCurrency(totalShiftOperatingExpenses)}
                          </strong>
                          <span className="text-[10px] text-zinc-400 font-sans block">
                            رسوم بوابات وسيرفرات وتكاليف تشغيلية
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<ArrowLeft className="w-4 h-4" />}
                        onClick={() => setSettlementStep(2)}
                        className="bg-purple-600 hover:bg-purple-700 font-bold"
                      >
                        المتابعة إلى فحص وحل العجز ➔
                      </Button>
                    </div>
                  </div>
                )}

                {/* ----------------------------------------------------------------- */}
                {/* STEP 2: Resolve Deficits (المرحلة 2: حل العجز ومقارنة الأرصدة)     */}
                {/* ----------------------------------------------------------------- */}
                {settlementStep === 2 && (
                  <div className="space-y-3.5 animate-fade-in">
                    <div className="p-4 rounded-2xl bg-white dark:bg-[#18181B] border border-gray-200 dark:border-[#27272A] space-y-3">
                      {/* Step Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-[#27272A] pb-3">
                        <div>
                          <h4 className="font-bold text-zinc-900 dark:text-zinc-100 text-xs flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            <span>الخطوة 2: فحص مطابقة الأرصدة الفعلية وحل العجز</span>
                          </h4>
                          <p className="text-[10px] text-zinc-400 mt-0.5">
                            سجل الرقم الفعلي المتواجد بيدك في كل محفظة لمقارنته بالرصيد الدفتري ورصد أي عجز بدقة
                          </p>
                        </div>

                        {/* Sub-Tabs Switcher: Reception vs Inventory */}
                        <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-[#141417] p-1 rounded-xl border border-gray-200 dark:border-[#27272A]">
                          <button
                            type="button"
                            onClick={() => setStep2WalletType('reception')}
                            className={`py-1.5 px-3 rounded-lg font-bold text-xs transition-all flex items-center gap-1.5 ${
                              step2WalletType === 'reception'
                                ? 'bg-white dark:bg-[#1f1f23] text-blue-600 dark:text-blue-400 shadow-xs border border-gray-200 dark:border-zinc-700'
                                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                            }`}
                          >
                            <Wallet className="w-3.5 h-3.5 text-blue-500" />
                            <span>محافظ الاستلام النشطة</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-500/15 text-blue-500 font-mono">
                              {usedReceptionWallets.length}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setStep2WalletType('inventory')}
                            className={`py-1.5 px-3 rounded-lg font-bold text-xs transition-all flex items-center gap-1.5 ${
                              step2WalletType === 'inventory'
                                ? 'bg-white dark:bg-[#1f1f23] text-orange-600 dark:text-orange-400 shadow-xs border border-gray-200 dark:border-zinc-700'
                                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                            }`}
                          >
                            <Package className="w-3.5 h-3.5 text-orange-500" />
                            <span>محافظ البضاعة المستهلكة</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-orange-500/15 text-orange-500 font-mono">
                              {usedInventoryWallets.length}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Info Banner: Only Used Wallets Displayed */}
                      <div className="p-2.5 rounded-xl bg-purple-500/5 border border-purple-500/15 flex items-center gap-2 text-[11px] text-purple-400">
                        <Filter className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          يتم عرض المحافظ التي تم استخدامها وتحصيل أموال أو استهلاك بضاعة منها فقط خلال هذه الوردية ({filterStartDate}) لمنع التشويش.
                        </span>
                      </div>

                      {/* 1. RECEPTION WALLETS VIEW */}
                      {step2WalletType === 'reception' && (
                        <div className="space-y-3">
                          {usedReceptionWallets.length > 0 ? (
                            <div className="space-y-3">
                              {usedReceptionWallets.map(w => {
                                const openingBalance = (w.currentBalance || 0) - (w.totalReceivedInShift || 0);
                                const expectedBalance = w.currentBalance;
                                const rawInput = actualReceptionBalances[w.walletId];
                                const hasActual = rawInput !== undefined && rawInput !== '';
                                const actualVal = hasActual ? Number(rawInput) : null;
                                const diff = actualVal !== null ? actualVal - expectedBalance : null;
                                const isDeficit = diff !== null && diff < 0;
                                const isMatch = diff !== null && diff === 0;
                                const isSurplus = diff !== null && diff > 0;

                                return (
                                  <div
                                    key={w.walletId}
                                    className={`p-3.5 rounded-xl border transition-all space-y-3 ${
                                      isDeficit
                                        ? 'bg-rose-500/5 border-rose-500/30'
                                        : isMatch
                                        ? 'bg-emerald-500/5 border-emerald-500/30'
                                        : 'bg-gray-50 dark:bg-[#141417] border-gray-200 dark:border-[#27272A]'
                                    }`}
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                          <Wallet className="w-4 h-4" />
                                        </div>
                                        <div>
                                          <strong className="text-zinc-900 dark:text-zinc-100 block text-xs">
                                            {w.walletName}
                                          </strong>
                                          <span className="text-[10px] text-zinc-400 font-mono">
                                            الرقم: {w.accountNumber || '—'} | العملة: {w.currency}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Status Badge */}
                                      <div>
                                        {actualVal === null ? (
                                          <span className="px-2.5 py-1 rounded-lg bg-gray-200 dark:bg-zinc-800 text-zinc-500 text-[10px] font-bold">
                                            بانتظار إدخال الرصيد الفعلي ⌨️
                                          </span>
                                        ) : isMatch ? (
                                          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-500 text-[10px] font-bold flex items-center gap-1">
                                            <CheckCircle2 className="w-3 h-3" />
                                            <span>مطابق تماماً للسيستم ✅</span>
                                          </span>
                                        ) : isDeficit ? (
                                          <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-500 text-[10px] font-black font-mono flex items-center gap-1">
                                            <AlertTriangle className="w-3 h-3" />
                                            <span>عجز مالي: -{formatCurrency(Math.abs(diff))} ❌</span>
                                          </span>
                                        ) : (
                                          <span className="px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-500 text-[10px] font-bold font-mono">
                                            زيادة/فائض: +{formatCurrency(diff)} 📈
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* 4 Numbers Comparison Bar */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] pt-1">
                                      {/* بداية الوردية */}
                                      <div className="p-2 rounded-lg bg-white dark:bg-[#18181B] border border-gray-100 dark:border-[#27272A]">
                                        <span className="text-[10px] text-zinc-400 block font-sans">
                                          رصيد بداية الوردية:
                                        </span>
                                        <strong className="text-zinc-700 dark:text-zinc-300 font-bold block">
                                          {formatCurrency(openingBalance)}
                                        </strong>
                                      </div>

                                      {/* الوارد أثناء الوردية */}
                                      <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                                        <span className="text-[10px] text-blue-500 block font-sans">
                                          الوارد بالوردية (انتهت بكام):
                                        </span>
                                        <strong className="text-blue-600 dark:text-blue-400 font-bold block">
                                          +{formatCurrency(w.totalReceivedInShift)}
                                        </strong>
                                      </div>

                                      {/* المفروض يكون في كام */}
                                      <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                                        <span className="text-[10px] text-purple-400 block font-sans">
                                          المفروض يكون كام (دفترياً):
                                        </span>
                                        <strong className="text-purple-600 dark:text-purple-400 font-bold block">
                                          {formatCurrency(expectedBalance)}
                                        </strong>
                                      </div>

                                      {/* الرقم الفعلي في يدك */}
                                      <div className="p-1.5 rounded-lg bg-white dark:bg-[#18181B] border border-purple-500/40 focus-within:ring-1 focus-within:ring-purple-500">
                                        <span className="text-[10px] text-purple-500 block font-sans font-bold">
                                          الرصيد الفعلي في يدك *:
                                        </span>
                                        <input
                                          type="number"
                                          step="any"
                                          placeholder="أدخل الفعلي..."
                                          value={rawInput ?? ''}
                                          onChange={e =>
                                            setActualReceptionBalances(prev => ({
                                              ...prev,
                                              [w.walletId]: e.target.value
                                            }))
                                          }
                                          className="w-full bg-transparent font-mono font-black text-xs text-zinc-900 dark:text-zinc-100 outline-none pt-0.5"
                                        />
                                      </div>
                                    </div>

                                    {/* Action button if there is a deficit */}
                                    {isDeficit && (
                                      <div className="flex items-center justify-between p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs">
                                        <span>
                                          ⚠️ يوجد عجز بقيمة <strong>{formatCurrency(Math.abs(diff))}</strong> في هذه المحفظة.
                                        </span>
                                        <Button
                                          type="button"
                                          variant="primary"
                                          size="sm"
                                          icon={<AlertTriangle className="w-3.5 h-3.5" />}
                                          onClick={() =>
                                            handleQuickRegisterDeficit(
                                              w.walletId,
                                              w.walletName,
                                              expectedBalance,
                                              actualVal!,
                                              w.numbersBreakdown?.[0]?.phoneNumber,
                                              w.numbersBreakdown?.[0]?.numberId
                                            )
                                          }
                                          className="bg-rose-600 hover:bg-rose-700 text-xs py-1"
                                        >
                                          تسجيل وقيد هذا العجز للحل 🚨
                                        </Button>
                                      </div>
                                    )}

                                    {/* Active Phone Lines Breakdown if available */}
                                    {w.numbersBreakdown && w.numbersBreakdown.filter(l => l.receivedInShift > 0).length > 0 && (
                                      <div className="pt-1.5 border-t border-gray-100 dark:border-zinc-800/60">
                                        <span className="text-[10px] text-zinc-400 block mb-1">
                                          الخطوط التي استلمت تحويلات في هذه الوردية:
                                        </span>
                                        <div className="flex flex-wrap gap-2">
                                          {w.numbersBreakdown
                                            .filter(l => l.receivedInShift > 0)
                                            .map((line, idx) => (
                                              <span
                                                key={idx}
                                                className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white dark:bg-[#18181B] border border-gray-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
                                              >
                                                📱 {line.phoneNumber} ({line.accountHolderName || 'خط'}): <strong>+{formatCurrency(line.receivedInShift)}</strong>
                                              </span>
                                            ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="p-6 text-center text-zinc-400 bg-gray-50 dark:bg-[#141417] rounded-xl border border-gray-200 dark:border-[#27272A]">
                              ℹ️ لا توجد محافظ استلام تم استخدامها خلال هذه الوردية.
                            </div>
                          )}
                        </div>
                      )}

                      {/* 2. INVENTORY WALLETS VIEW */}
                      {step2WalletType === 'inventory' && (
                        <div className="space-y-3">
                          {usedInventoryWallets.length > 0 ? (
                            <div className="space-y-3">
                              {usedInventoryWallets.map(inv => {
                                const openingPoints = inv.expectedPointsBeforeShift;
                                const expectedPoints = inv.currentPoints;
                                const rawInput = actualInventoryPoints[inv.id];
                                const hasActualPts = rawInput !== undefined && rawInput !== '';
                                const actualPtsVal = hasActualPts ? Number(rawInput) : null;
                                const diffPts = actualPtsVal !== null ? actualPtsVal - expectedPoints : null;
                                const isDeficitPts = diffPts !== null && diffPts < 0;
                                const isMatchPts = diffPts !== null && diffPts === 0;
                                const isSurplusPts = diffPts !== null && diffPts > 0;

                                return (
                                  <div
                                    key={inv.id}
                                    className={`p-3.5 rounded-xl border transition-all space-y-3 ${
                                      isDeficitPts
                                        ? 'bg-rose-500/5 border-rose-500/30'
                                        : isMatchPts
                                        ? 'bg-emerald-500/5 border-emerald-500/30'
                                        : 'bg-gray-50 dark:bg-[#141417] border-gray-200 dark:border-[#27272A]'
                                    }`}
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500 border border-orange-500/20">
                                          <Package className="w-4 h-4" />
                                        </div>
                                        <div>
                                          <strong className="text-zinc-900 dark:text-zinc-100 block text-xs">
                                            {inv.name}
                                          </strong>
                                          <span className="text-[10px] text-zinc-400 font-mono">
                                            نوع الرصيد: {inv.pointType} | التكلفة بالجنيه: {formatCurrency(inv.consumedCostEGPInShift)}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Status Badge */}
                                      <div>
                                        {actualPtsVal === null ? (
                                          <span className="px-2.5 py-1 rounded-lg bg-gray-200 dark:bg-zinc-800 text-zinc-500 text-[10px] font-bold">
                                            بانتظار إدخال الرصيد الفعلي ⌨️
                                          </span>
                                        ) : isMatchPts ? (
                                          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-500 text-[10px] font-bold flex items-center gap-1">
                                            <CheckCircle2 className="w-3 h-3" />
                                            <span>مطابق تماماً للسيستم ✅</span>
                                          </span>
                                        ) : isDeficitPts ? (
                                          <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-500 text-[10px] font-black font-mono flex items-center gap-1">
                                            <AlertTriangle className="w-3 h-3" />
                                            <span>نقص مخزون: -{Math.abs(diffPts)} {inv.pointType} ❌</span>
                                          </span>
                                        ) : (
                                          <span className="px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-500 text-[10px] font-bold font-mono">
                                            زيادة: +{diffPts} {inv.pointType} 📈
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* 4 Numbers Comparison Bar */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] pt-1">
                                      {/* بداية الوردية */}
                                      <div className="p-2 rounded-lg bg-white dark:bg-[#18181B] border border-gray-100 dark:border-[#27272A]">
                                        <span className="text-[10px] text-zinc-400 block font-sans">
                                          الرصيد قبل الوردية:
                                        </span>
                                        <strong className="text-zinc-700 dark:text-zinc-300 font-bold block">
                                          {openingPoints.toLocaleString()} {inv.pointType}
                                        </strong>
                                      </div>

                                      {/* المستهلك في الوردية */}
                                      <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                                        <span className="text-[10px] text-orange-500 block font-sans">
                                          المستهلك في الوردية:
                                        </span>
                                        <strong className="text-orange-600 dark:text-orange-400 font-bold block">
                                          -{inv.consumedPointsInShift.toLocaleString()} {inv.pointType}
                                        </strong>
                                      </div>

                                      {/* المفروض يكون في كام */}
                                      <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                                        <span className="text-[10px] text-purple-400 block font-sans">
                                          المفروض يكون كام (دفترياً):
                                        </span>
                                        <strong className="text-purple-600 dark:text-purple-400 font-bold block">
                                          {expectedPoints.toLocaleString()} {inv.pointType}
                                        </strong>
                                      </div>

                                      {/* الرقم الفعلي في يدك */}
                                      <div className="p-1.5 rounded-lg bg-white dark:bg-[#18181B] border border-purple-500/40 focus-within:ring-1 focus-within:ring-purple-500">
                                        <span className="text-[10px] text-purple-500 block font-sans font-bold">
                                          الرصيد الفعلي في يدك *:
                                        </span>
                                        <input
                                          type="number"
                                          step="any"
                                          placeholder="أدخل الفعلي..."
                                          value={rawInput ?? ''}
                                          onChange={e =>
                                            setActualInventoryPoints(prev => ({
                                              ...prev,
                                              [inv.id]: e.target.value
                                            }))
                                          }
                                          className="w-full bg-transparent font-mono font-black text-xs text-zinc-900 dark:text-zinc-100 outline-none pt-0.5"
                                        />
                                      </div>
                                    </div>

                                    {/* Action button if there is a deficit */}
                                    {isDeficitPts && (
                                      <div className="flex items-center justify-between p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs">
                                        <span>
                                          ⚠️ يوجد نقص مخزون بقيمة <strong>{Math.abs(diffPts)} {inv.pointType}</strong> في هذه المحفظة.
                                        </span>
                                        <Button
                                          type="button"
                                          variant="primary"
                                          size="sm"
                                          icon={<AlertTriangle className="w-3.5 h-3.5" />}
                                          onClick={() =>
                                            handleQuickRegisterInventoryDeficit(
                                              inv.id,
                                              inv.name,
                                              expectedPoints,
                                              actualPtsVal!,
                                              inv.pointType
                                            )
                                          }
                                          className="bg-rose-600 hover:bg-rose-700 text-xs py-1"
                                        >
                                          تسجيل وقيد نقص البضاعة للحل 🚨
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="p-6 text-center text-zinc-400 bg-gray-50 dark:bg-[#141417] rounded-xl border border-gray-200 dark:border-[#27272A]">
                              ℹ️ لم يتم استهلاك أي نقاط من محافظ البضاعة خلال هذه الوردية.
                            </div>
                          )}
                        </div>
                      )}

                      {/* ------------------------------------------------------------- */}
                      {/* PENDING DEFICITS RESOLUTION PANEL (قائمة العجوزات المسجلة)   */}
                      {/* ------------------------------------------------------------- */}
                      <div className="pt-3 border-t border-gray-100 dark:border-[#27272A] space-y-3">
                        <div className="flex items-center justify-between">
                          <strong className="text-zinc-900 dark:text-zinc-100 text-xs flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4 text-amber-500" />
                            <span>قرارات معالجة العجوزات المسجلة في الوردية</span>
                          </strong>
                          {pendingDeficits.length === 0 ? (
                            <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-500 font-bold text-[10px]">
                              ✅ لا يوجد أي عجز معلق
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-lg bg-rose-500/15 text-rose-500 font-bold text-[10px]">
                              ⚠️ يلزم حل {pendingDeficits.length} عجز قبل المتابعة
                            </span>
                          )}
                        </div>

                        {pendingDeficits.length > 0 ? (
                          <div className="space-y-3">
                            {pendingDeficits.map(d => (
                              <div
                                key={d.id}
                                className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 space-y-2.5"
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <strong className="text-zinc-900 dark:text-zinc-100 block text-xs">
                                      عجز مسجل على: {d.walletName} {d.phoneNumber ? `(${d.phoneNumber})` : ''}
                                    </strong>
                                    <span className="text-[11px] text-zinc-400 font-mono">
                                      المسجل: {d.employeeName || 'الموظف'} | التاريخ: {formatDateTime(d.reportedAt)}
                                    </span>
                                  </div>
                                  <span className="font-mono text-base font-black text-rose-500">
                                    -{formatCurrency(d.deficitAmount)}
                                  </span>
                                </div>

                                <p className="text-[11px] text-zinc-400 bg-white/5 p-2 rounded-lg">
                                  ملاحظة العجز: {d.reason || 'لا توجد تفاصيل إضافية'}
                                </p>

                                <div className="pt-2 border-t border-rose-500/20 space-y-2">
                                  <span className="font-bold text-zinc-700 dark:text-zinc-300 text-[11px] block">
                                    اختر طريقة تسوية هذا العجز المالي:
                                  </span>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setResolutionType('resolved_deducted')}
                                      className={`p-2 rounded-xl border text-center font-bold text-xs transition-colors ${
                                        resolutionType === 'resolved_deducted'
                                          ? 'bg-rose-500 text-white border-rose-600'
                                          : 'bg-white dark:bg-[#141417] border-gray-200 dark:border-[#27272A] text-zinc-400'
                                      }`}
                                    >
                                      ✂️ خصم من راتب الموظف
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => setResolutionType('resolved_store_loss')}
                                      className={`p-2 rounded-xl border text-center font-bold text-xs transition-colors ${
                                        resolutionType === 'resolved_store_loss'
                                          ? 'bg-amber-500 text-white border-amber-600'
                                          : 'bg-white dark:bg-[#141417] border-gray-200 dark:border-[#27272A] text-zinc-400'
                                      }`}
                                    >
                                      🏢 تحميلها كخسارة على المتجر
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => setResolutionType('resolved_adjusted')}
                                      className={`p-2 rounded-xl border text-center font-bold text-xs transition-colors ${
                                        resolutionType === 'resolved_adjusted'
                                          ? 'bg-blue-500 text-white border-blue-600'
                                          : 'bg-white dark:bg-[#141417] border-gray-200 dark:border-[#27272A] text-zinc-400'
                                      }`}
                                    >
                                      📝 تسوية وتعديل رصيد المحفظة
                                    </button>
                                  </div>

                                  <Input
                                    placeholder="ملاحظات قرار المالك حول هذا العجز..."
                                    value={resolutionNotes}
                                    onChange={e => setResolutionNotes(e.target.value)}
                                  />

                                  <div className="flex justify-end pt-1">
                                    <Button
                                      type="button"
                                      variant="primary"
                                      size="sm"
                                      icon={<Check className="w-4 h-4" />}
                                      onClick={() => handleConfirmResolveDeficit(d.id)}
                                      className="bg-emerald-600 hover:bg-emerald-700"
                                    >
                                      اعتماد حل هذا العجز ومتابعة التصفية
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span className="text-xs">
                              الأرصدة متطابقة ومستقرة تماماً، ولا يوجد أي عجز معلق. يمكنك المتابعة لتحديد وجهة الأموال وتحويل المحافظ.
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSettlementStep(1)}
                      >
                        السابق
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<ArrowLeft className="w-4 h-4" />}
                        onClick={() => {
                          if (pendingDeficits.length > 0) {
                            showToast('error', 'يوجد عجز معلق', 'يرجى تسوية جميع العجوزات المسجلة أعلاه أولاً قبل المتابعة.');
                            return;
                          }
                          setSettlementStep(3);
                        }}
                        className="bg-purple-600 hover:bg-purple-700 font-bold"
                      >
                        المتابعة إلى تحويل المحافظ ووجهة الأموال ➔
                      </Button>
                    </div>
                  </div>
                )}

                {/* ----------------------------------------------------------------- */}
                {/* STEP 3: Mandatory Destination & Wallets Sweep                     */}
                {/* ----------------------------------------------------------------- */}
                {settlementStep === 3 && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl border border-purple-500/30 space-y-2">
                      <h4 className="font-bold">تصفير محافظ الاستقبال وتوزيع النقد على الخزن</h4>
                      <p className="text-xs text-zinc-500">تكلفة البضاعة تُحوّل للخزنة الرئيسية. الأرباح والكاش باك والإحالات والأمانات ومصاريف التشغيل تُموّل في خزن مستقلة. كل مبلغ يُخصم من مصدره مرة واحدة.</p>
                    </div>
                    {shiftPreview.error?<p role="alert" className="p-3 text-rose-500 border border-rose-500/30 rounded-xl">{shiftPreview.error}</p>:<>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[{key:'goods',name:'الخزنة الرئيسية — تكلفة البضاعة'},...TREASURIES.map(t=>({key:t.kind,name:t.name}))].map(item=><div key={item.key} className="p-3 border border-purple-500/30 rounded-xl"><strong className="text-xs block">{item.name}</strong><span className="font-bold font-mono block mt-1">{formatCurrency(shiftPreview.plan?.destinations[item.key as keyof typeof shiftPreview.plan.destinations]||0)}</span></div>)}
                      </div>
                      <div className="p-4 border border-emerald-500/30 rounded-xl space-y-2 text-xs">
                        <p>إجمالي النقد الموزع: <strong>{formatCurrency(shiftPreview.plan?.destinationTotal||0)}</strong></p>
                        <table className="w-full text-right"><thead><tr><th className="p-2">مصدر النقد</th><th>المبلغ المخصوم</th><th>المتبقي بعد التصفية</th></tr></thead><tbody>{Object.entries(shiftPreview.plan?.sources||{}).map(([id,amount])=>{const w=wallets.find(w=>w.id===id);return <tr key={id}><td className="p-2">{w?.name||db.getFinancialTreasuries().find(t=>t.id===id)?.name}</td><td>{formatCurrency(amount)}</td><td>{formatCurrency((w?.balance||0)-amount)}</td></tr>;})}</tbody></table>
                        <p>محافظ الاستقبال تصبح صفرًا؛ الخزن المنفصلة تحتفظ بمخصصاتها ويمكن التحويل منها للرئيسية لاحقًا.</p>
                        {(shiftPreview.plan?.previousProfit||0)>0&&<p>سبق تحويل ربح {formatCurrency(shiftPreview.plan!.previousProfit)}؛ تم استبعاده من التوزيع الجديد.</p>}
                      </div>
                    </>}
                    <div className="flex justify-between"><Button variant="outline" onClick={()=>setSettlementStep(2)}>السابق</Button><Button variant="primary" disabled={!!shiftPreview.error||!shiftTickets.length||datePreset!=='active_shift'} onClick={()=>setSettlementStep(4)}>مراجعة التصفية النهائية</Button></div>
                  </div>
                )}

                {/* ----------------------------------------------------------------- */}
                {/* STEP 4: Final Confirmation & Shift Closure                        */}
                {/* ----------------------------------------------------------------- */}
                {settlementStep === 4 && (
                  <div className="space-y-3.5 animate-fade-in">
                    <div className="p-4 rounded-2xl bg-white dark:bg-[#18181B] border border-gray-200 dark:border-[#27272A] space-y-3">
                      <h4 className="font-bold text-zinc-900 dark:text-zinc-100 text-xs flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-500" />
                        <span>الخطوة 4: التأكيد النهائي وتصفية وإغلاق الوردية</span>
                      </h4>

                      <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-[#141417] border border-gray-200 dark:border-[#27272A] space-y-2.5 font-mono text-xs">
                        <div className="flex items-center justify-between border-b border-gray-200 dark:border-[#27272A] pb-2">
                          <span className="font-sans text-zinc-500">إجمالي إيراد الوردية المحصل:</span>
                          <strong className="text-zinc-900 dark:text-zinc-100 font-bold">
                            {formatCurrency(totalShiftRevenue)} (${revenueInUSDT} USDT)
                          </strong>
                        </div>

                        <div className="flex items-center justify-between border-b border-gray-200 dark:border-[#27272A] pb-2">
                          <span className="font-sans text-zinc-500">إجمالي تكلفة البضاعة المسحوبة (FIFO):</span>
                          <strong className="text-zinc-700 dark:text-zinc-300 font-bold">
                            {formatCurrency(totalShiftCost)}
                          </strong>
                        </div>

                        <div className="flex items-center justify-between border-b border-gray-200 dark:border-[#27272A] pb-2">
                          <span className="font-sans text-emerald-500 font-bold">صافي الأرباح المحققة:</span>
                          <div className="text-left">
                            <strong className="text-emerald-500 font-black text-sm block">
                              {formatCurrency(totalShiftProfit)} (${profitInUSDT} USDT)
                            </strong>
                            <span className="text-[10px] text-zinc-400 font-sans">
                              (يُحفظ في خزنة الأرباح المنفصلة)
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between border-b border-gray-200 dark:border-[#27272A] pb-2">
                          <span className="font-sans text-purple-400 font-bold">وجهة الأموال المعتمدة للتصفية:</span>
                          <span className="font-sans font-bold text-xs text-purple-400 bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-500/20">
                            تكلفة البضاعة للرئيسية؛ الباقي للخزن المختصة
                          </span>
                        </div>

                        <div className="p-3 rounded-xl border border-emerald-500/30 text-xs space-y-2">
                          <p>تكلفة البضاعة التي ستصل للرئيسية: <strong>{formatCurrency(shiftPreview.plan?.destinations.goods || 0)}</strong></p>
                          <p>محافظ الاستقبال تصبح صفرًا. الأرباح والكاش باك والإحالات والأمانات والمصاريف تصل لخزنها المنفصلة.</p>
                          <p>توزيع النقد على جميع الخزن وإغلاق الوردية عملية واحدة؛ لا يظهر النجاح قبل تأكيد الحفظ.</p>
                          {shiftPreview.error && <p role="alert" className="text-rose-500">{shiftPreview.error}</p>}
                        </div>
                      </div>

                      <div>
                        <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1 text-[11px]">
                          ملاحظات وتوقيع الإغلاق النهائي للتصفية
                        </label>
                        <textarea
                          rows={2}
                          placeholder="اكتب أي ملاحظات إدارية ترغب في توثيقها في سجل تدقيق الوردية..."
                          value={settlementFinalNotes}
                          onChange={e => setSettlementFinalNotes(e.target.value)}
                          className="w-full rounded-xl bg-white dark:bg-[#141417] border border-gray-200 dark:border-[#27272A] p-2.5 text-zinc-900 dark:text-zinc-100 outline-none text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSettlementStep(3)}
                      >
                        السابق
                      </Button>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          icon={<Printer className="w-4 h-4 text-orange-500" />}
                          onClick={handlePrintSettlement}
                        >
                          طباعة مسودة التقرير PDF
                        </Button>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          icon={<CheckCircle2 className="w-4 h-4" />}
                          disabled={isSettling || !!shiftPreview.error || !shiftTickets.length || datePreset!=='active_shift'}
                          onClick={handleConfirmFinalSettlement}
                          className="bg-emerald-600 hover:bg-emerald-700 font-black text-xs"
                        >
                          {isSettling ? 'جارٍ حفظ التصفية...' : 'اعتماد التوزيع وتصفير محافظ الاستقبال'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
