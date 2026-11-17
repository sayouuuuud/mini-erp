import type { CustomerTicket } from '../types/customer.types';
import type { StoreWallet, StoreWalletTransaction } from '../types/topup.types';
import { money, retainedTicketRatio, ticketContribution } from './systemWalletProjection';
import { remainingTicketProfits } from './profitFunding';

export const TREASURIES = [
  {kind:'profits',id:'treasury_profits',name:'خزنة الأرباح'},
  {kind:'cashback',id:'treasury_cashback',name:'خزنة الكاش باك'},
  {kind:'referrals',id:'treasury_referrals',name:'خزنة الإحالات'},
  {kind:'trust',id:'treasury_trust',name:'خزنة الأمانات'},
  {kind:'operating_expenses',id:'treasury_operating_expenses',name:'خزنة مصاريف التشغيل'}
] as const;
export type TreasuryKind = typeof TREASURIES[number]['kind'];
export type DistributionAmounts = Record<'goods'|'profits'|'cashback'|'referrals'|'trust'|'operating_expenses',number>;
export const treasuryWallet = (kind: TreasuryKind): StoreWallet => {
  const t=TREASURIES.find(t=>t.kind===kind)!;
  return {id:t.id,name:t.name,type:'treasury',treasuryKind:kind,currency:'EGP',balance:0,controlledBy:'owner',allowWithdrawal:true,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'};
};

export function buildShiftDistribution(allTickets: CustomerTicket[], ticketIds: string[], wallets: StoreWallet[], ledger: StoreWalletTransaction[]) {
  const ids=new Set(ticketIds);
  const tickets=allTickets.filter(t=>ids.has(t.id));
  if(!ids.size || ids.size!==ticketIds.length || tickets.length!==ids.size || tickets.some(t=>t.status!=='completed'||t.shiftSettlementId)) throw new Error('لا توجد تذاكر جديدة صالحة للتصفية أو تمت تسويتها؛ حدّث الشاشة');
  const paid=new Map<string,number>();remainingTicketProfits(allTickets,ledger.filter(t=>t.walletId==='w_profits'),paid);
  const sum=(type:string)=>money(tickets.reduce((s,t)=>s+ticketContribution(t,type),0));
  const previousProfit=money(tickets.reduce((s,t)=>s+(paid.get(t.id)||0),0));
  const destinations:DistributionAmounts={goods:money(tickets.reduce((s,t)=>s+money(Number(t.totalCostAmount||0)*retainedTicketRatio(t)),0)),profits:money(sum('profits')-previousProfit),cashback:sum('cashback'),referrals:sum('referrals'),trust:sum('trust'),operating_expenses:sum('operating_expenses')};
  const credits={cashback:0,referrals:0,trust:0};
  for(const t of tickets){const r=retainedTicketRatio(t);credits.cashback=money(credits.cashback+money(Number(t.cashbackUsed||0)*r));credits.referrals=money(credits.referrals+money(Number(t.referralBalanceUsed||0)*r));credits.trust=money(credits.trust+money(Number(t.accountBalanceUsed||0)*r));}
  const sources:Record<string,number>={};
  const reception=wallets.filter(w=>!w.isSystemWallet&&w.type==='operating'&&w.balance>0);
  if(reception.some(w=>w.currency!=='EGP'))throw new Error('توجد أرصدة استقبال بعملة أخرى؛ طابق العملة قبل تصفية الجنيه');
  for(const w of reception)sources[w.id]=money(w.balance);
  for(const [kind,amount] of Object.entries(credits))if(amount>0)sources[TREASURIES.find(t=>t.kind===kind)!.id]=amount;
  for(const [kind,value] of Object.entries(destinations))if(value<0){if(kind!=='profits')throw new Error('مخصص مالي سالب يحتاج مراجعة');const id='treasury_profits';sources[id]=money((sources[id]||0)-value);destinations.profits=0;}
  for(const [id,amount] of Object.entries(sources)){const w=wallets.find(w=>w.id===id);if(!w||w.balance<amount)throw new Error('رصيد '+(w?.name||TREASURIES.find(t=>t.id===id)?.name||id)+' غير كافٍ لتغطية الأرصدة المستخدمة أو الخسارة؛ يلزم تمويلها أولًا');}
  const sourceTotal=money(Object.values(sources).reduce((s,a)=>s+a,0));
  const destinationTotal=money(Object.values(destinations).reduce((s,a)=>s+a,0));
  const difference=money(sourceTotal-destinationTotal);
  if(difference!==0)throw new Error(`فرق غير مخصص بقيمة ${difference} جنيه بين النقد والتذاكر. راجع الأرصدة الافتتاحية والتذاكر غير المكتملة؛ لن يُحسب الفرق كبضاعة أو ربح تلقائيًا`);
  const revenue=money(tickets.reduce((s,t)=>s+money(Number(t.receivedAmount??t.requiredAmount??0)*retainedTicketRatio(t)),0));
  const signature=JSON.stringify({tickets,sources,destinations,reception:reception.map(w=>({id:w.id,balance:w.balance,numbers:w.numbers})),previousProfit,credits});
  return {ticketIds,sources,destinations,sourceTotal,destinationTotal,revenue,previousProfit,credits,signature};
}
