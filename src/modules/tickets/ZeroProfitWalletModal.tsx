import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Badge } from '../../components/common/Badge';
import { db } from '../../database/db';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { formatCurrency } from '../../utils/formatters';
import { TrendingUp, Check, AlertCircle } from 'lucide-react';
import { StoreWallet } from '../../types/topup.types';

interface ZeroProfitWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  currentBalance: number;
  sourceWalletId?: string;
}

export const ZeroProfitWalletModal: React.FC<ZeroProfitWalletModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  currentBalance,
  sourceWalletId = 'w_profits'
}) => {
  const { user } = useAuth();
  const { showToast } = useNotifications();

  const [selectedDestination, setSelectedDestination] = useState<string>(currentBalance < 0 ? 'loss_settlement' : 'vault_main');
  const [transferAmount, setTransferAmount] = useState<number>(Math.abs(currentBalance));
  const [notes, setNotes] = useState<string>('تصفير وتفريغ رصيد محفظة الأرباح وتحويلها للخزنة الرئيسية');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const transferLock = React.useRef(false);
  const [wallets, setWallets] = useState<StoreWallet[]>([]);

  useEffect(() => {
    if (isOpen) {
      setTransferAmount(Math.abs(currentBalance));
      setSelectedDestination(currentBalance < 0 ? 'loss_settlement' : 'vault_main');
      setNotes(currentBalance < 0 ? 'تسجيل تسوية خسارة وتصفير عجز الأرباح دون تغيير رصيد الخزنة' : 'تصفير وتفريغ رصيد محفظة الأرباح وتحويلها للخزنة الرئيسية');
      setWallets(sourceWalletId === 'mw_profits' ? [] : db.getStoreWallets());
    }
  }, [isOpen, currentBalance, sourceWalletId]);

  const canTransfer = Number.isFinite(currentBalance) && currentBalance > 0;
  const isLossSettlement = selectedDestination === 'loss_settlement';
  const canSettleLoss = Number.isFinite(currentBalance) && currentBalance < 0;
  const canSubmit = isLossSettlement ? canSettleLoss : canTransfer;
  const maximumAmount = isLossSettlement ? Math.abs(currentBalance) : Math.max(0, currentBalance);

  const bankWallets = wallets.filter(
    w =>
      !w.isSystemWallet &&
      !['w_profits', 'w_cashback', 'w_referrals', 'w_trust'].includes(w.id) &&
      (w.category === 'bank' || w.id.includes('bank') || w.name.includes('بنك') || w.category === 'cash')
  );

  const getDestinationLabel = () => {
    if (isLossSettlement) return 'تسجيل تسوية خسارة';
    if (selectedDestination === 'vault_main') {
      return sourceWalletId === 'mw_profits' ? 'خزنة قسم التجار' : 'الخزنة الرئيسية';
    }
    const found = wallets.find(w => w.id === selectedDestination);
    return found ? found.name : selectedDestination;
  };

  const handleConfirmZeroing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (transferLock.current) return;

    if (!canSubmit) {
      showToast('error','العملية غير متاحة',currentBalance < 0 ? 'اختر تسجيل تسوية خسارة لتصفير العجز دون تغيير الخزنة.' : 'لا يوجد عجز لتسويته أو رصيد متاح للتحويل.');
      return;
    }
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      showToast('error', 'مبلغ غير صحيح', 'يرجى إدخال مبلغ أكبر من 0 للتحويل.');
      return;
    }

    if (isLossSettlement && transferAmount !== maximumAmount) {
      showToast('error', 'مبلغ التسوية غير صحيح', 'أدخل قيمة العجز الحالي بالكامل لتصفير المحفظة.');
      return;
    }
    if (transferAmount > maximumAmount) {
      showToast('error', 'الرصيد غير كافٍ', 'المبلغ المطلوب تحويله أكبر من رصيد محفظة الأرباح الحالي.');
      return;
    }

    if (!selectedDestination) {
      showToast('error', 'وجهة الرصيد مطلوبة', 'يرجى تحديد وجهة الرصيد قبل إتمام العملية.');
      return;
    }

    transferLock.current = true; setIsSubmitting(true);
    try {
    const refNumber = `${isLossSettlement ? 'PRF-LOSS' : 'PRF-TR'}-${crypto.randomUUID()}`;
    const destLabel = getDestinationLabel();
    const actor = { id: user?.id || 'owner', name: user?.fullName || 'المالك', role: user?.role || '' };
    const result = isLossSettlement
      ? db.settleProfitLoss(transferAmount, refNumber, actor, notes, sourceWalletId)
      : db.transferSystemProfits(transferAmount, selectedDestination, refNumber, actor, notes, sourceWalletId);

    if (result.success) {
      // 3. Log audit action
      db.logAction(
        { id: user?.id || 'owner', name: user?.fullName || 'المالك', role: user?.role || 'admin', department: 'المالية' },
        'vault_transaction',
        isLossSettlement ? 'تسجيل تسوية خسارة محفظة الأرباح' : 'تصفير وتحويل رصيد محفظة الأرباح',
        sourceWalletId,
        refNumber,
        isLossSettlement ? `تمت تسوية خسارة ${transferAmount} ج وتصفير عجز الأرباح دون تغيير رصيد الخزنة.` : `تم تصفير وتحويل ${transferAmount} ج من محفظة الأرباح إلى ${destLabel} مع بقاء كامل السجل التاريخي دون حذف.`
      );

      await db.flushFinancialChanges();
      showToast(
        'success',
        isLossSettlement ? 'تمت تسوية الخسارة وتصفير المحفظة' : '🎉 تم تصفير وتحويل الأرباح بنجاح',
        isLossSettlement ? `تم تسجيل تسوية خسارة بقيمة ${formatCurrency(transferAmount)}. رصيد الخزنة لم يتغير.` : `تم تحويل ${formatCurrency(transferAmount)} إلى ${destLabel} وتوثيق القيد في الوجهة المختارة.`
      );

      onSuccess?.();
      onClose();
    } else {
      showToast('error', 'فشلت العملية', result.message);
    }
    } catch (error) { showToast('error','لم تكتمل العملية',(error as Error).message); } finally { transferLock.current = false; setIsSubmitting(false); }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="💰 تصفير وتحويل محفظة الأرباح"
      subtitle="تحويل الأرباح المتاحة أو تسجيل تسوية خسارة للعجز مع الحفاظ على السجل التاريخي"
      maxWidth="md"
    >
      <form onSubmit={handleConfirmZeroing} className="space-y-4 text-right text-xs">
        {/* Current Balance Box */}
        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent border border-emerald-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-500">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-zinc-400 block font-medium">الرصيد الحالي بمحفظة الأرباح</span>
              <strong className="text-base text-emerald-500 font-mono font-black">
                {formatCurrency(currentBalance)}
              </strong>
            </div>
          </div>

          <Badge variant={canTransfer ? "success" : "warning"} size="sm" className="font-bold">
            {canTransfer ? 'جاهز للتحويل' : currentBalance < 0 ? 'رصيد سالب — يحتاج تسوية' : 'لا يوجد رصيد للتحويل'}
          </Badge>
        </div>

        {/* Destination Selection */}
        <div>
          <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1.5 text-xs">
            اختر وجهة الرصيد *
          </label>
          <div className="relative">
            <select
              value={selectedDestination}
              onChange={e => setSelectedDestination(e.target.value)}
              className="w-full rounded-xl bg-white dark:bg-[#141417] border border-gray-200 dark:border-[#27272A] p-2.5 text-zinc-900 dark:text-zinc-100 font-bold outline-none text-xs focus:ring-2 focus:ring-emerald-500"
            >
              <option value="vault_main" disabled={!canTransfer}>
                {sourceWalletId === 'mw_profits' ? 'خزنة قسم التجار' : 'الخزنة الرئيسية'} — الخزنة المعتمدة
              </option>
              {bankWallets.map(w => (
                <option key={w.id} value={w.id} disabled={!canTransfer}>
                  🏛️ {w.name} ({formatCurrency(w.balance, w.currency)})
                </option>
              ))}
              <option value="loss_settlement" disabled={!canSettleLoss}>تسجيل تسوية خسارة — دون تغيير رصيد الخزنة</option>
            </select>
          </div>
          <span className="text-[10px] text-zinc-400 block mt-1">
            {isLossSettlement ? 'ستصبح المحفظة صفرًا بتسجيل تسوية خسارة. رصيد الخزنة يظل كما هو.' : 'سيتم إنشاء قيد إيداع فعلي في الوجهة المختارة فور التأكيد.'}
          </span>
        </div>

        {/* Amount Input */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="font-bold text-zinc-700 dark:text-zinc-300 text-xs">
              {isLossSettlement ? 'مبلغ تسوية الخسارة (جنيه) *' : 'المبلغ المراد تحويله (جنيه) *'}
            </label>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => setTransferAmount(maximumAmount)}
              className="text-[10px] font-bold text-emerald-500 hover:underline cursor-pointer"
            >
              تصفير كامل الرصيد ({formatCurrency(maximumAmount)})
            </button>
          </div>
          <Input
            type="number"
            step="0.01"
            min={0}
            max={maximumAmount}
            value={transferAmount || ''}
            onChange={e => setTransferAmount(parseFloat(e.target.value) || 0)}
            placeholder="أدخل المبلغ..."
          />
        </div>

        {/* Notes Input */}
        <div>
          <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1 text-xs">
            ملاحظات العملية
          </label>
          <Input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ملاحظات حول سبب تصفية وتحويل الأرباح..."
          />
        </div>

        {/* Audit Safety Warning Box */}
        <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-[11px] space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>حماية دفتر الأستاذ والسجل التاريخي:</span>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400 text-[10.5px]">
            {isLossSettlement ? 'تُحفظ التسوية بقيمتها ومرجعها والمسؤول عنها، دون حذف السجل السابق أو تسجيل ربح جديد أو إيداع أو سحب من الخزنة.' : 'لن يتم حذف أي حركات قديمة من دفتر الأستاذ. التصفير يتم بتسجيل حركة تحويل مالية جديدة موثقة بمرجع ورقم عملية رسمي يظهر في قسم المالية.'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 dark:border-[#27272A]">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || !canSubmit || !Number.isFinite(transferAmount) || transferAmount <= 0 || transferAmount > maximumAmount || (isLossSettlement && transferAmount !== maximumAmount)}
            variant="primary"
            size="sm"
            icon={<Check className="w-4 h-4" />}
            className="bg-emerald-600 hover:bg-emerald-700 font-bold"
          >
            {isLossSettlement ? 'تأكيد تسوية الخسارة والتصفير' : 'تأكيد التصفير والتحويل للخزنة'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
