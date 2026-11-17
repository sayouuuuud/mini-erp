import type { CustomerTicket, UnifiedWalletTransaction } from '../types/customer.types';
import type { StoreWallet, StoreWalletTransaction } from '../types/topup.types';
import { money, unifiedWalletDelta } from './systemWalletProjection';

export function egyptPeriod(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('تاريخ تحصيل التذكرة غير صالح؛ يلزم مطابقته قبل تسجيل الاحتيال');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}

export function matchesFraudTicket(tx: StoreWalletTransaction, ticket: CustomerTicket): boolean {
  return tx.sourceTicketId === ticket.id || [tx.sourceTicketNumber, tx.referenceNumber].some(ref => ref === ticket.id || ref === ticket.ticketNumber);
}

// Prepare a complete transition without writing to storage. Goods, FIFO and real
// transfers are deliberately absent: delivery already happened, cash did not.
export function planFraudAccounting(ticket: CustomerTicket, sourceWallets: StoreWallet[], sourceLedger: StoreWalletTransaction[], now: string, actor: { id: string; name: string; role: string }) {
  const wallets = structuredClone(sourceWallets);
  const ledger = structuredClone(sourceLedger);
  const today = egyptPeriod(now), month = today.slice(0, 7);
  const linked = ledger.filter(tx => matchesFraudTicket(tx, ticket));
  const receipts = linked.filter(tx => tx.type === 'deposit' && tx.sourceType === 'ticket' && wallets.some(w => w.id === tx.walletId && !w.isSystemWallet && w.type === 'operating'));
  const cash = money(Number(ticket.receivedAmount ?? 0));
  if (!Number.isFinite(cash) || cash < 0) throw new Error('مبلغ التذكرة غير صالح');
  // Do not guess another wallet or silently reverse a different amount.
  if (money(receipts.reduce((sum, tx) => sum + tx.amount, 0)) !== cash) throw new Error('تعذر مطابقة إيصالات التحصيل الأصلية مع مبلغ التذكرة؛ راجع سجل الاستلام أولًا');
  const reversals: StoreWalletTransaction[] = [];
  for (const receipt of receipts) {
    const wallet = wallets.find(w => w.id === receipt.walletId)!;
    const amount = money(receipt.amount);
    if (!(amount > 0)) throw new Error('إيصال التحصيل الأصلي غير صالح');
    const date = egyptPeriod(receipt.createdAt);
    const before = wallet.balance;
    const ref = receipt.walletNumberId || receipt.walletPhoneNumber || receipt.receivingPhoneNumber || ticket.paymentWalletNumberId || ticket.paymentReceivedPhone;
    const line = wallet.numbers?.find(n => n.id === ref || n.phoneNumber === ref);
    if (wallet.numbers?.length && !line) throw new Error('تعذر مطابقة خط الاستلام الأصلي؛ لن يتم خصم خط بديل');
    const adjust = (row: any, key: string, delta: number, clamp = true) => { row[key] = money(clamp ? Math.max(0, Number(row[key] || 0) + delta) : Number(row[key] || 0) + delta); };
    adjust(wallet, 'balance', -amount, false);
    if (date === today) adjust(wallet, 'dailyIncome', -amount);
    if (date.slice(0, 7) === month) adjust(wallet, 'monthlyIncome', -amount);
    adjust(wallet, 'totalReceived', -amount);
    if (line) {
      adjust(line, 'currentBalance', -amount, false);
      if (date === today) adjust(line, 'dailyReceived', -amount);
      if (date.slice(0, 7) === month) adjust(line, 'monthlyReceived', -amount);
      adjust(line, 'totalReceived', -amount);
      adjust(line, 'operationsCount', -1);
      if (line.status === 'limit_reached' && (!line.dailyLimit || (line.dailyReceived || 0) < line.dailyLimit) && (!line.monthlyLimit || (line.monthlyReceived || 0) < line.monthlyLimit) && (!line.dailySendLimit || (line.dailySent || 0) < line.dailySendLimit) && (!line.monthlySendLimit || (line.monthlySent || 0) < line.monthlySendLimit)) line.status = 'active';
      wallet.balance = money(wallet.numbers!.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0));
    }
    wallet.updatedAt = now;
    reversals.push({ id: `fraud:${ticket.id}:receipt:${receipt.id}`, walletId: wallet.id, walletName: wallet.name, type: 'adjustment', amount, currency: wallet.currency,
      balanceBefore: before, balanceAfter: wallet.balance, sourceType: 'fraud', sourceName: 'احتيال — إلغاء تحصيل غير حقيقي', sourceTicketId: ticket.id, sourceTicketNumber: ticket.ticketNumber, referenceNumber: ticket.ticketNumber,
      walletNumberId: line?.id, receivingPhoneNumber: line?.phoneNumber, description: `احتيال — إلغاء إيصال ${receipt.id} للتذكرة #${ticket.ticketNumber} دون صرف نقدي أو إعادة بضاعة`, performedBy: actor, createdAt: now });
  }
  return { wallets, ledger: [...reversals, ...ledger], reversedCash: cash, receiptIds: receipts.map(tx => tx.id) };
}

export function excludeFraudRewards(rows: UnifiedWalletTransaction[], ticket: CustomerTicket, now: string): UnifiedWalletTransaction[] {
  return rows.map(row => {
    if (![ticket.id, ticket.ticketNumber].includes(row.orderNumber || '')) return row;
    // Existing legitimate wallet credits spent on delivered goods remain spent.
    // Earned benefits and any earlier refund/correction of those benefits vanish
    // together from the totals, but every original journal entry is retained.
    const benefit = unifiedWalletDelta(row) > 0 || /استرداد|إلغاء|عكس|تصحيح/.test(row.operationName || '') || (row.walletType === 'account_balance' && row.type === 'debit' && /عجز دفع/.test(row.operationName || ''));
    if (!benefit || row.fraudExcluded) return row;
    return { ...row, fraudExcluded: true, fraudMarkedAt: now, operationName: `${row.operationName} [احتيال — مستبعد من الرصيد]` };
  });
}
