import type { CustomerTicket, UnifiedWalletTransaction } from '../types/customer.types';
import type { StoreWallet, StoreWalletTransaction } from '../types/topup.types';

export const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// A cumulative wallet is a projection of current tickets, never a replay of undo entries.
export function isEligibleTicket(ticket: CustomerTicket): boolean {
  return ticket.status !== 'canceled' && ticket.status !== 'refunded' && ticket.status !== 'fraud';
}

export function retainedTicketRatio(ticket: CustomerTicket): number {
  const paid = Number(ticket.receivedAmount ?? ticket.requiredAmount ?? 0);
  const refunded = Number(ticket.refundDetails?.amount || 0);
  return paid > 0 ? Math.max(0, Math.min(1, (paid - refunded) / paid)) : 1;
}

export function ticketContribution(ticket: CustomerTicket, systemType?: string): number {
  if (!isEligibleTicket(ticket)) return 0;
  const retained = retainedTicketRatio(ticket);
  if (systemType === 'trust') {
    const pending = (ticket.isReservation || ticket.operationMode === 'reservation') && ticket.status !== 'completed';
    return money(pending
      ? Number(ticket.reservationTrustHeld ?? ticket.receivedAmount ?? 0) * retained
      : Number(ticket.overpaymentAmount || 0) * retained);
  }
  if (ticket.status !== 'completed') return 0;
  switch (systemType) {
    case 'profits': return money(Number(ticket.netProfit ?? ticket.totalProfitMargin ?? 0) * retained);
    case 'operating_expenses': return money(Number(ticket.fixedCostAmount ?? ticket.pricingSnapshot?.fixedCostEGP ?? 0) * retained);
    case 'cashback': return money(Number(ticket.cashbackEarned ?? ticket.pricingSnapshot?.cashbackAmountEGP ?? 0) * retained);
    case 'referrals': return money(Number(ticket.referralCommissionEarned ?? ticket.pricingSnapshot?.referralAmountEGP ?? 0) * retained);
    default: return 0;
  }
}

export function contributionTransactions(wallet: StoreWallet, tickets: CustomerTicket[]): StoreWalletTransaction[] {
  return tickets.flatMap(ticket => {
    const value = ticketContribution(ticket, wallet.systemType || (wallet.type === 'profits' ? 'profits' : undefined));
    if (!value) return [];
    return [{
      id: `contribution:${wallet.id}:${ticket.id}`,
      walletId: wallet.id, walletName: wallet.name, type: value > 0 ? 'deposit' : 'loss',
      amount: Math.abs(value), currency: wallet.currency, balanceBefore: 0, balanceAfter: value,
      description: `مساهمة التذكرة الحالية #${ticket.ticketNumber}`,
      sourceType: 'ticket', sourceTicketId: ticket.id, sourceTicketNumber: ticket.ticketNumber,
      referenceNumber: ticket.ticketNumber, customerName: ticket.customerName,
      customerPhone: ticket.customerPhone, gameName: ticket.gameName,
      createdAt: ticket.createdAt
    } satisfies StoreWalletTransaction];
  });
}

// Explicit noncash loss settlements also affect available profits. Ticket undo
// records remain in the audit ledger and must never turn into phantom expenditures.
export function isActualWalletMovement(tx: StoreWalletTransaction): boolean {
  if (tx.reclassifiedToTreasuryAt) return false;
  return ['manual_withdrawal', 'manual_deposit', 'transfer', 'opening_balance', 'loss_settlement'].includes(tx.sourceType || '') ||
    (!tx.sourceType && ['withdrawal', 'transfer_out', 'transfer_in'].includes(tx.type));
}

export function unifiedWalletDelta(tx: Pick<UnifiedWalletTransaction, 'type' | 'amount' | 'fraudExcluded'>): number {
  if (tx.fraudExcluded) return 0;
  if (tx.type === 'adjustment') return Number(tx.amount) || 0;
  return ['earned', 'credit', 'bonus', 'commission'].includes(tx.type) ? Math.abs(Number(tx.amount) || 0) : -Math.abs(Number(tx.amount) || 0);
}
