import type { CustomerTicket } from '../types/customer.types';
import type { StoreWalletTransaction } from '../types/topup.types';
import { isActualWalletMovement, money, ticketContribution } from './systemWalletProjection';

// Ticket earnings describe the cash; they are not another cash account. Track
// which earnings have already funded a payment, including payments before close.
export function remainingTicketProfits(tickets: CustomerTicket[], movements: StoreWalletTransaction[], paid = new Map<string, number>()) {
  const ordered = [...tickets].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const remaining = new Map(ordered.map(t => [t.id, Math.max(0, ticketContribution(t, 'profits'))]));
  for (const tx of [...movements].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (tx.reclassifiedToTreasuryAt) continue;
    if (!isActualWalletMovement(tx) || !['withdrawal', 'transfer_out'].includes(tx.type)) continue;
    if (tx.profitTicketAllocations) {
      for (const [id, amount] of Object.entries(tx.profitTicketAllocations)) {
        paid.set(id, money((paid.get(id) || 0) + amount));
        remaining.set(id, money(Math.max(0, (remaining.get(id) || 0) - amount)));
      }
    } else {
      // Legacy payments have no ticket allocation. Apply them chronologically;
      // future tickets cannot fund a past payment.
      let unpaid = money(tx.amount);
      for (const t of ordered) {
        if (t.createdAt > tx.createdAt || unpaid <= 0) continue;
        const take = Math.min(remaining.get(t.id) || 0, unpaid);
        paid.set(t.id, money((paid.get(t.id) || 0) + take));
        remaining.set(t.id, money((remaining.get(t.id) || 0) - take));
        unpaid = money(unpaid - take);
      }
    }
  }
  return remaining;
}
