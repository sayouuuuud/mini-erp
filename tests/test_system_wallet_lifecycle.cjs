const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const assert=require('node:assert/strict');
process.chdir(path.resolve(__dirname, '..'));
const esbuild=require('esbuild');
const OUT=process.env.WALLET_TEST_OUTPUT;
let writes=0;const events=[];const cache=new Map();const legacy=new Map();
const canonical=k=>k.startsWith('nzm_jkr_')?k:'nzm_jkr_'+k;
globalThis.__auditStorage={getItem:(k,d)=>cache.has(canonical(k))?cache.get(canonical(k)):d,setItem:(k,v)=>{writes++;cache.set(canonical(k),structuredClone(v));return true;},removeItem:k=>cache.delete(canonical(k)),hydrateFromSupabase:async()=>{},waitForHydration:async()=>{},isStorageHydrated:()=>true,clearLegacyLocalStorage:()=>{}};
globalThis.localStorage={getItem:k=>legacy.get(k)??null,setItem:(k,v)=>legacy.set(k,String(v)),removeItem:k=>legacy.delete(k),clear:()=>legacy.clear(),key:i=>Array.from(legacy.keys())[i],get length(){return legacy.size;}};
globalThis.CustomEvent=class{constructor(type,o){this.type=type;this.detail=o?.detail;}};
globalThis.Event=class{constructor(type){this.type=type;}};
globalThis.window={localStorage:globalThis.localStorage,dispatchEvent:e=>{events.push(e.type);return true;},addEventListener:()=>{},removeEventListener:()=>{}};
globalThis.fetch=()=>{throw new Error('NETWORK_DISABLED_FOR_AUDIT');};
const actor={id:'audit-owner',name:'Audit Owner',fullName:'Audit Owner',role:'admin'};
const raw=fs.readFileSync('src/database/db.ts','utf8');
const originalNow=Date.now.bind(Date);let tick=0;
Date.now=()=>originalNow()+tick++;
(async()=>{
 const build=await esbuild.build({stdin:{contents:"export {db,auditKeys} from './src/database/db';export {initialSettings} from './src/database/seedData';export {initialExchangeRate,initialCustomerModuleSettings} from './src/database/seedTopUp';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',plugins:[{name:'offline-transport',setup(b){
  b.onResolve({filter:/supabaseStorage$/},()=>({path:'storage',namespace:'audit'}));
  b.onLoad({filter:/.*/,namespace:'audit'},()=>({contents:'export const supabaseStorage=globalThis.__auditStorage;export const KEY_TO_TABLE_MAP={};'}));
  b.onResolve({filter:/lib\/supabase$/},()=>({path:'supabase',namespace:'no-network'}));
  b.onLoad({filter:/.*/,namespace:'no-network'},()=>({contents:'export const supabase=new Proxy({}, {get(){throw new Error("NETWORK_DISABLED_FOR_AUDIT")}});'}));
  b.onLoad({filter:/database\/db\.ts$/},()=>({contents:raw.replace('db.initialize();','')+'\nexport {STORAGE_KEYS as auditKeys};',loader:'ts'}));
 }}]});
 const mod=new Module(path.resolve('audit-lifecycle.bundle.cjs'),module);mod.filename=path.resolve('audit-lifecycle.bundle.cjs');mod.paths=module.paths;mod._compile(build.outputFiles[0].text,mod.filename);
 const {db,auditKeys:K,initialSettings,initialExchangeRate,initialCustomerModuleSettings}=mod.exports;
 const results=[];
 const put=(name,v)=>cache.set(K[name],structuredClone(v));
 const read=name=>structuredClone(cache.get(K[name])||[]);
 const customer=(id,extra={})=>({id,code:id,name:id,phone:id==='customer'?'+201000000001':'+201000000002',profileType:'regular',status:'active',cashbackRate:1,referralCode:id==='referrer'?'AUDITREF':'AUDITCUST',cashbackBalance:0,totalCashbackEarned:0,referralWalletBalance:0,totalReferralCommissionEarned:0,accountBalance:0,balance:0,totalSpent:0,totalOrders:0,createdAt:new Date().toISOString(),...extra});
 function reset(extra={}){
  cache.clear();legacy.clear();events.length=0;
  for(const k of Object.values(K))cache.set(k,[]);
  put('SETTINGS',{...initialSettings,vaultInitialBalance:0});put('EXCHANGE_RATE',initialExchangeRate);put('CUSTOMER_MODULE_SETTINGS',initialCustomerModuleSettings);
  put('CUSTOMERS',[customer('customer',{referredByCode:'AUDITREF',referralLinkedAt:new Date().toISOString(),...extra}),customer('referrer')]);
  put('GAMES_TREE',[]);put('FIRST_SHIPPING_GAMES_TREE',[]);
  put('STORE_WALLETS',[{id:'audit_op',name:'Audit Operating',type:'operating',currency:'EGP',balance:0,allowWithdrawal:true,controlledBy:'owner',numbers:[{id:'audit_line',phoneNumber:'01000000003',currentBalance:0,isPrimary:true,status:'active',dailyLimit:1000000,monthlyLimit:1000000,dailyReceived:0,monthlyReceived:0,totalReceived:0,totalSent:0}],createdAt:new Date().toISOString()}]);
 }
 const makeTicket=(id='JKR-2026-9901',extra={})=>({id,ticketNumber:id,customerId:'customer',customerName:'customer',customerPhone:'+201000000001',department:'customers',ticketType:'regular',operationMode:'direct',status:'new',requiredAmount:100,totalProductsAmount:100,receivedAmount:100,totalCostAmount:70,costPrice:70,netProfit:23,totalProfitMargin:23,fixedCostAmount:5,cashbackEarned:1,cashbackPercent:1,referralCommissionEarned:1,referralPercent:1,profitSynced:false,cashbackSynced:false,stockDeducted:true,items:[],paymentWalletId:'audit_op',paymentWallet:'Audit Operating',paymentWalletNumberId:'audit_line',createdAt:new Date().toISOString(),...extra});
 function snap(label){const wallets=db.getStoreWallets();const balances=Object.fromEntries(wallets.filter(w=>w.isSystemWallet).map(w=>[w.id,w.balance]));const profiles=db.getCustomers(true).map(c=>({id:c.id,cashback:c.cashbackBalance,referral:c.referralWalletBalance,account:c.accountBalance}));const views=Object.fromEntries(wallets.filter(w=>w.isSystemWallet).map(w=>[w.id,{received:w.totalReceived||0,withdrawn:w.totalWithdrawn||0,count:db.getSystemWalletContributions(w.id).filter(x=>x.type==='deposit' && x.amount>0).length,entries:db.getSystemWalletViewTransactions(w.id)}]));return {label,balances,profiles,views,lines:wallets.find(w=>w.id==='audit_op')?.numbers,operating:wallets.find(w=>w.id==='audit_op')?.balance,vault:db.getVaultBalance(),tickets:db.getTickets().map(t=>({id:t.id,status:t.status,profit:t.netProfit,cb:t.cashbackEarned,ref:t.referralCommissionEarned,fixed:t.fixedCostAmount})),storeEntries:read('STORE_WALLET_TRANSACTIONS').length,unifiedEntries:read('CASHBACK').length};}
 function create(t){db.saveTicket(t);db.recordWalletReceivingPayment('audit_op','audit_line',t.receivedAmount,t.ticketNumber,t.customerName,actor);return t;}
 async function test(id,name,fn){reset();try{const data=await fn();results.push({id,name,...data});}catch(e){results.push({id,name,error:e.stack});}if(OUT)fs.writeFileSync(OUT,JSON.stringify({mode:'actual full DB methods and profile/ledger services, offline in-memory adapter; bootstrap disabled; no browser or live transport; monotonic Date.now for baseline IDs',tests:results},null,2));console.log((results.at(-1).error?'FAIL':'PASS')+': '+id+' '+name);}
 await test('L01','one ticket create, complete, delete, delete again across all five wallets',()=>{
  const t=create(makeTicket());const stages=[snap('created')];const completed=db.completeTopUpTicket(t.id,'Audit Owner');stages.push(snap('completed'));
  const deleted=db.deleteTicket(t.id,actor);stages.push(snap('deleted'));const deletedAgain=db.deleteTicket(t.id,actor);stages.push(snap('delete_again'));
  return {completed,deleted,deletedAgain,stages,ledger:read('STORE_WALLET_TRANSACTIONS').map(t=>({wallet:t.walletId,type:t.type,amount:t.amount,before:t.balanceBefore,after:t.balanceAfter,description:t.description}))};
 });
 await test('L02','100 required and 120 received with 20 excess then delete',()=>{
  const t=create(makeTicket('JKR-2026-9902',{receivedAmount:120,overpaymentAmount:20,overpaymentSettled:true,balanceSettled:true}));
  // Same profile + unified-account operations used by the ticket form.
  const c=db.getCustomerById('customer');c.accountBalance=20;c.balance=20;db.saveCustomer(c);db.addUnifiedWalletTransaction({customerId:c.id,walletType:'account_balance',type:'credit',operationName:'audit excess',amount:20,balanceAfter:20,orderNumber:t.ticketNumber});
  db.creditTrustToSystemWallet(20,c.name,'audit excess',t.ticketNumber);const stages=[snap('overpayment_created')];db.completeTopUpTicket(t.id,'Audit Owner');stages.push(snap('overpayment_completed'));db.deleteTicket(t.id,actor);stages.push(snap('overpayment_deleted'));
  return {stages};
 });
 await test('L03','full refund completed ticket and repeat refund',()=>{
  const t=create(makeTicket('JKR-2026-9903'));db.completeTopUpTicket(t.id,'Audit Owner');const stages=[snap('before_refund')];
  const refund=db.refundTicket(t.id,'audit_op','offline full refund',actor,'audit_line');stages.push(snap('after_refund'));const repeat=db.refundTicket(t.id,'audit_op','offline repeat refund',actor,'audit_line');stages.push(snap('after_repeat'));
  return {refund,repeat,stages};
 });
 await test('L04','partial refund then refund remaining cash',()=>{
  const t=create(makeTicket('JKR-2026-9904'));db.completeTopUpTicket(t.id,'Audit Owner');const stages=[snap('before_partial')];
  const first=db.refundTicket(t.id,'audit_op','offline partial',actor,'audit_line',40);stages.push(snap('after_partial_40'));const second=db.refundTicket(t.id,'audit_op','offline remainder',actor,'audit_line',60);stages.push(snap('after_remaining_60'));
  return {first,second,stages,refundDetails:db.getTicketById(t.id)?.refundDetails};
 });
 await test('L05','edit completed ticket money profit costs and rewards',()=>{
  const t=create(makeTicket('JKR-2026-9905'));db.completeTopUpTicket(t.id,'Audit Owner');const stages=[snap('before_edit')];const old=structuredClone(db.getTicketById(t.id));const updated={...old,requiredAmount:200,totalProductsAmount:200,receivedAmount:200,totalCostAmount:140,netProfit:46,totalProfitMargin:46,fixedCostAmount:10,cashbackEarned:2,referralCommissionEarned:2};
  const edit=db.reconcileTicketEdit(old,updated,actor);stages.push(snap('after_edit'));return {edit,stages,ledger:read('STORE_WALLET_TRANSACTIONS').map(t=>({wallet:t.walletId,type:t.type,amount:t.amount,before:t.balanceBefore,after:t.balanceAfter,description:t.description}))};
 });
 await test('L06','profit transfer to vault, read refresh and retry transfer',()=>{
  const t=create(makeTicket('JKR-2026-9906'));db.completeTopUpTicket(t.id,'Audit Owner');const stages=[snap('before_transfer')];
  function transfer(ref){const success=db.withdrawStoreWalletFunds('w_profits',23,'audit profit zeroing',ref,actor);if(success)db.addSafeTransaction('cash_in',23,'wallet_transfer','audit transfer','Audit Owner',ref,{currency:'EGP'});return success;}
  const first=transfer('AUDIT-TRANSFER-1');stages.push(snap('after_transfer_and_read'));db.recalculateSystemWallets();stages.push(snap('after_sync'));const second=transfer('AUDIT-TRANSFER-2');stages.push(snap('after_second_transfer'));return {first,second,stages};
 });
 await test('L07','cancel completed ticket then restore deleted ticket',()=>{
  const t=create(makeTicket('JKR-2026-9907'));db.completeTopUpTicket(t.id,'Audit Owner');const stages=[snap('completed')];const cancel=db.updateTicketStatus(t.id,'canceled',actor,'audit cancel');stages.push(snap('canceled'));const deleted=db.deleteTicket(t.id,actor);stages.push(snap('deleted_after_cancel'));const restored=db.restoreTicket(t.id,actor);stages.push(snap('restored'));return {cancel,deleted,restored,stages};
 });
 await test('L08','retail profits must not receive a dealer ticket posting',()=>{
  const t=makeTicket('JKR-2026-9908',{department:'dealers'});db.recordProfitOrLossToSystemWallet(23,t.ticketNumber,{customerName:t.customerName,gameName:'audit',isDealer:true});db.saveDealerTicket(t);return {stages:[snap('dealer_creation_without_flag_as_in_form')],ledger:read('STORE_WALLET_TRANSACTIONS').map(t=>({wallet:t.walletId,amount:t.amount}))};
 });
 await test('L09','same-millisecond unified entries collide by id',()=>{
  Date.now=()=>1793649600000;
  try{db.addUnifiedWalletTransaction({customerId:'customer',walletType:'cashback',type:'earned',operationName:'opening credit',amount:5,balanceAfter:5});db.addUnifiedWalletTransaction({customerId:'referrer',walletType:'referral',type:'commission',operationName:'ref commission',amount:7,balanceAfter:7});const entries=read('CASHBACK');return {ids:entries.map(x=>x.id),entries:entries.length,uniqueIds:new Set(entries.map(x=>x.id)).size};}finally{Date.now=()=>originalNow()+tick++;}
 });
 await test('L10','negative and positive customer balances in trust',()=>{const customers=read('CUSTOMERS');customers[0].accountBalance=20;customers[1].accountBalance=-15;put('CUSTOMERS',customers);return {stages:[snap('20_liability_and_15_receivable')]};});
 await test('L11','use cashback and referral credit then full refund restores opening balances',()=>{
  db.addUnifiedWalletTransaction({customerId:'customer',walletType:'cashback',type:'credit',amount:10,balanceAfter:10,operationName:'audit opening cashback'});
  db.addUnifiedWalletTransaction({customerId:'customer',walletType:'referral',type:'credit',amount:5,balanceAfter:5,operationName:'audit opening referral'});
  const t=create(makeTicket('JKR-2026-9911',{requiredAmount:85,receivedAmount:85,cashbackUsed:10,referralBalanceUsed:5}));
  db.addUnifiedWalletTransaction({customerId:'customer',walletType:'cashback',type:'redeemed',amount:10,balanceAfter:0,operationName:'audit cashback use',orderNumber:t.ticketNumber});
  db.addUnifiedWalletTransaction({customerId:'customer',walletType:'referral',type:'redeemed',amount:5,balanceAfter:0,operationName:'audit referral use',orderNumber:t.ticketNumber});
  const stages=[snap('before_completion')];db.completeTopUpTicket(t.id,'Audit Owner');stages.push(snap('after_completion'));const refund=db.refundTicket(t.id,'audit_op','audit credit redemption refund',actor,'audit_line');stages.push(snap('after_refund'));return {refund,stages};
 });
 await test('L12','reservation hold and release on delivery',()=>{
  const t=create(makeTicket('JKR-2026-9912',{operationMode:'reservation',isReservation:true,reservationTrustHeld:100}));const stages=[snap('reservation_created')];const completed=db.completeTopUpTicket(t.id,'Audit Owner');stages.push(snap('reservation_completed'));return {completed,stages};
 });
 await test('L13','restore a deleted completed ticket and check missing credits',()=>{
  const t=create(makeTicket('JKR-2026-9913'));db.completeTopUpTicket(t.id,'Audit Owner');const stages=[snap('original_completed')];db.deleteTicket(t.id,actor);stages.push(snap('deleted'));const restored=db.restoreTicket(t.id,actor);stages.push(snap('restored_completed'));return {restored,stages};
 });
 await test('L14','ticket form debits credit before ticket save and profile getters drop the debit',()=>{
  db.addUnifiedWalletTransaction({customerId:'customer',walletType:'cashback',type:'credit',amount:10,balanceAfter:10,operationName:'audit opening cashback'});
  db.addUnifiedWalletTransaction({customerId:'customer',walletType:'referral',type:'credit',amount:5,balanceAfter:5,operationName:'audit opening referral'});
  const t=makeTicket('JKR-2026-9914',{requiredAmount:85,receivedAmount:85,cashbackUsed:10,referralBalanceUsed:5});
  let active=db.getCustomerById('customer');active={...active,cashbackBalance:0};db.saveCustomer(active);db.addUnifiedWalletTransaction({customerId:active.id,walletType:'cashback',type:'redeemed',amount:10,balanceAfter:0,operationName:'استخدام كاش باك في سداد تذكرة',orderNumber:t.ticketNumber});db.debitCashbackFromSystemWallet(10,active.name,t.ticketNumber);
  active={...active,referralWalletBalance:0};db.saveCustomer(active);db.addUnifiedWalletTransaction({customerId:active.id,walletType:'referral',type:'redeemed',amount:5,balanceAfter:0,operationName:'استخدام عمولات إحالة في سداد تذكرة',orderNumber:t.ticketNumber});db.debitReferralFromSystemWallet(5,active.name,'استخدام عمولات إحالة في سداد تذكرة');
  db.saveTicket(t);db.recordWalletReceivingPayment('audit_op','audit_line',85,t.ticketNumber,'customer',actor);
  const stages=[snap('form_created_after_debits')];db.completeTopUpTicket(t.id,'Audit Owner');stages.push(snap('form_completed'));return {stages,unifiedLedger:read('CASHBACK').map(x=>({type:x.type,wallet:x.walletType,amount:x.amount,order:x.orderNumber}))};
 });

 await test('A15','projection reads do not mutate cache or persist financial changes',()=>{
  const t=create(makeTicket('JKR-2026-9915'));db.completeTopUpTicket(t.id,'Audit Owner');
  const before=JSON.stringify([...cache]);const count=writes;
  for(let i=0;i<3;i++){db.getStoreWallets();db.getDealerWallets();db.getCustomers(true);db.getDealers(true);db.recalculateSystemWallets();db.getSystemWalletViewTransactions('w_profits');}
  assert.equal(writes,count);assert.equal(JSON.stringify([...cache]),before);return {};
 });
 await test('A16','transfer API validates role destination duplicate and destination failure',()=>{
  create(makeTicket('JKR-2026-9916'));db.completeTopUpTicket('JKR-2026-9916','Audit Owner');
  assert.equal(db.transferSystemProfits(23,'missing','invalid',actor).success,false);
  assert.equal(db.transferSystemProfits(23,'vault_main','denied',{...actor,role:'employee'}).success,false);
  const before=JSON.stringify([...cache]);const deposit=db.depositStoreWalletFunds;
  db.depositStoreWalletFunds=()=>false;
  try{assert.equal(db.transferSystemProfits(23,'audit_op','failed',actor).success,false);}finally{db.depositStoreWalletFunds=deposit;}
  assert.equal(JSON.stringify([...cache]),before,'failed transfer restores all collections');
  assert.equal(db.transferSystemProfits(23,'vault_main','transfer-one',actor).success,true);
  assert.equal(db.transferSystemProfits(23,'vault_main','transfer-one',actor).success,false);
  assert.equal(db.getVaultBalance(),23);assert.equal(snap('after').balances.w_profits,0);return {};
 });
 await test('A17','refund with insufficient line balance is rejected before any change',()=>{
  const t=create(makeTicket('JKR-2026-9917'));db.completeTopUpTicket(t.id,'Audit Owner');
  const op=read('STORE_WALLETS');op.find(w=>w.id==='audit_op').numbers[0].currentBalance=20;put('STORE_WALLETS',op);
  const before=JSON.stringify([...cache]);const result=db.refundTicket(t.id,'audit_op','insufficient',actor,'audit_line',100);
  assert.equal(result.success,false);assert.equal(JSON.stringify([...cache]),before);return {};
 });
 await test('A18','loss remains signed and is excluded from positive contribution count',()=>{
  const t=create(makeTicket('JKR-2026-9918',{netProfit:-3,totalProfitMargin:-3}));db.completeTopUpTicket(t.id,'Audit Owner');
  const state=snap('loss');assert.equal(state.balances.w_profits,-3);assert.equal(state.views.w_profits.count,0);
  assert.equal(state.views.w_profits.entries[0].type,'loss');return {};
 });
 await test('A19','dealer contributions are isolated including operating expenses',()=>{
  put('DEALERS',[customer('dealer',{phone:'+201000000005',code:'dealer',referredByCode:undefined})]);
  const t=makeTicket('DTKT-2026-9919',{department:'dealers',customerId:'dealer',customerPhone:'+201000000005',referralCommissionEarned:0});
  db.saveDealerTicket(t);db.recordWalletReceivingPayment('audit_op','audit_line',100,t.ticketNumber,'dealer',actor);
  const completed=db.completeTopUpTicket(t.id,'Audit Owner');assert.equal(completed.success,true);
  assert.equal(snap('retail').balances.w_profits,0);assert.equal(snap('retail').balances.w_operating_expenses,0);
  assert.equal(db.getDealerWallets().find(w=>w.id==='mw_profits').balance,23);
  assert.equal(db.getSystemWalletContributions('mw_profits').length,1);
  db.refundTicket(t.id,'audit_op','dealer refund',actor,'audit_line');
  for(const w of db.getDealerWallets().filter(w=>w.isSystemWallet)){assert.equal(w.balance,0);assert.equal(db.getSystemWalletContributions(w.id).length,0);}
  return {};
 });
 await test('A20','canceled ticket can pay its physical refund without restoring rewards twice',()=>{
  const t=create(makeTicket('JKR-2026-9920'));db.completeTopUpTicket(t.id,'Audit Owner');
  assert.equal(db.updateTicketStatus(t.id,'canceled',actor,'cancel').success,true);
  assert.equal(snap('canceled').operating,100);
  assert.equal(db.refundTicket(t.id,'audit_op','actual refund after cancel',actor,'audit_line').success,true);
  const state=snap('refunded');assert.equal(state.operating,0);assert.equal(state.profiles[0].cashback,0);
  assert.equal(state.lines[0].monthlyReceived,100);assert.equal(state.lines[0].monthlySent,100);return {};
 });
 await test('A21','three partial refunds restore exact opening credits with cumulative rounding',()=>{
  db.addUnifiedWalletTransaction({customerId:'customer',walletType:'cashback',type:'credit',amount:10,balanceAfter:10,operationName:'opening'});
  const t=create(makeTicket('JKR-2026-9921',{cashbackUsed:10}));
  db.addUnifiedWalletTransaction({customerId:'customer',walletType:'cashback',type:'redeemed',amount:10,balanceAfter:0,operationName:'use',orderNumber:t.ticketNumber});
  db.completeTopUpTicket(t.id,'Audit Owner');
  for(const amount of [33.33,33.33,33.34])assert.equal(db.refundTicket(t.id,'audit_op','partial',actor,'audit_line',amount).success,true);
  assert.equal(snap('final').balances.w_cashback,10);assert.equal(snap('final').operating,0);return {};
 });

 await test('A22','zero cash paid and unknown refund wallet cannot debit unrelated money',()=>{
  const t=create(makeTicket('JKR-2026-9922',{receivedAmount:0}));db.completeTopUpTicket(t.id,'Audit Owner');
  const before=JSON.stringify([...cache]);assert.equal(db.refundTicket(t.id,'audit_op','unpaid',actor,'audit_line',100).success,false);assert.equal(JSON.stringify([...cache]),before);
  const paid=create(makeTicket('JKR-2026-9923'));db.completeTopUpTicket(paid.id,'Audit Owner');
  const next=JSON.stringify([...cache]);assert.equal(db.refundTicket(paid.id,'not-a-wallet','invalid',actor).success,false);assert.equal(JSON.stringify([...cache]),next);return {};
 });
 await test('A23','legacy system wallet IDs are normalized without writing saved balances',()=>{
  const t=create(makeTicket('JKR-2026-9924'));db.completeTopUpTicket(t.id,'Audit Owner');
  put('STORE_WALLETS',[...read('STORE_WALLETS').filter(w=>w.id!=='w_profits'),{id:'w_profits',name:'legacy',type:'profits',currency:'EGP',balance:999}]);
  const before=JSON.stringify([...cache]);const w=db.getStoreWallets().find(w=>w.id==='w_profits');assert.equal(w.balance,23);assert.equal(w.isSystemWallet,true);assert.equal(JSON.stringify([...cache]),before);return {};
 });
 await test('A24','cancellation then deletion restores used account credit exactly once',()=>{
  const c=db.getCustomerById('customer');c.accountBalance=30;c.balance=30;db.saveCustomer(c);
  const t=create(makeTicket('JKR-2026-9925',{accountBalanceUsed:20,creditDeducted:true,balanceSettled:true}));db.completeTopUpTicket(t.id,'Audit Owner');
  db.updateTicketStatus(t.id,'canceled',actor,'cancel');assert.equal(db.getCustomerById(c.id).accountBalance,50);
  db.deleteTicket(t.id,actor);assert.equal(db.getCustomerById(c.id).accountBalance,50);return {};
 });
 await test('A25','a fully refunded ticket cannot be completed and issue rewards again',()=>{
  const t=create(makeTicket('JKR-2026-9926'));db.completeTopUpTicket(t.id,'Audit Owner');db.refundTicket(t.id,'audit_op','full',actor,'audit_line');
  assert.equal(db.completeTopUpTicket(t.id,'Audit Owner').success,false);return {};
 });

 await test('A26','credit-only payment can be refunded without creating a cash movement',()=>{
  db.addUnifiedWalletTransaction({customerId:'customer',walletType:'cashback',type:'credit',amount:100,balanceAfter:100,operationName:'opening'});
  const t=create(makeTicket('JKR-2026-9927',{receivedAmount:0,requiredAmount:0,cashbackUsed:100}));
  db.addUnifiedWalletTransaction({customerId:'customer',walletType:'cashback',type:'redeemed',amount:100,balanceAfter:0,operationName:'use',orderNumber:t.ticketNumber});
  db.completeTopUpTicket(t.id,'Audit Owner');
  assert.equal(db.refundTicket(t.id,'audit_op','credit-only',actor,'audit_line').success,true);
  assert.equal(db.getCustomerById('customer').cashbackBalance,100);
  assert.equal(read('STORE_WALLET_TRANSACTIONS').filter(tx=>tx.walletId==='audit_op'&&tx.type==='refund').length,0);
  assert.equal(db.refundTicket(t.id,'audit_op','repeat',actor,'audit_line').success,false);return {};
 });

 await test('A27','dealer profit transfer credits only the dealer vault',()=>{
  put('DEALER_TICKETS',[makeTicket('DTKT-2026-9928',{department:'dealers',status:'completed'})]);
  const result=db.transferSystemProfits(23,'vault_main','dealer-profit-one',actor,'','mw_profits');assert.equal(result.success,true);
  assert.equal(db.getDealerWallets().find(w=>w.id==='mw_profits').balance,0);
  assert.equal(read('DEALER_SAFE_TRANSACTIONS').filter(tx=>tx.referenceId==='dealer-profit-one').reduce((s,tx)=>s+tx.amount,0),23);
  assert.equal(db.getVaultBalance(),0);assert.equal(db.transferSystemProfits(23,'vault_main','dealer-profit-two',actor,'','mw_profits').success,false);return {};
 });

 await test('A28','signed manual adjustments bonuses and debits agree with available balance and displayed ledger',()=>{
  for(const [type,amount] of [['adjustment',10],['adjustment',-3],['bonus',2],['debit',2]])
    db.addUnifiedWalletTransaction({customerId:'customer',walletType:'cashback',type,amount,balanceAfter:0,operationName:'manual'});
  const t=create(makeTicket('JKR-2026-9929'));db.completeTopUpTicket(t.id,'Audit Owner');
  const state=snap('adjusted');assert.equal(state.balances.w_cashback,8);
  assert.equal(state.views.w_cashback.received,13);assert.equal(state.views.w_cashback.withdrawn,5);
  assert.equal(state.views.w_cashback.entries[0].balanceAfter,8);return {};
 });

 await test('A29','voided duplicate transfer is neutral while retaining original audit amount',()=>{
  const t=create(makeTicket('JKR-2026-9930'));db.completeTopUpTicket(t.id,'Audit Owner');
  assert(db.transferSystemProfits(23,'vault_main','one-valid',actor).success);
  db.addStoreWalletTransaction({walletId:'w_profits',walletName:'profit',type:'withdrawal',amount:0,balanceBefore:23,balanceAfter:23,currency:'EGP',sourceType:'manual_withdrawal',referenceNumber:'old-voided',description:'voided duplicate',voidedAt:new Date().toISOString(),voidedOriginalAmount:23});
  db.addSafeTransaction('cash_in',0,'wallet_transfer','voided duplicate','QA','old-voided');
  assert.equal(snap('corrected').balances.w_profits,0);assert.equal(db.getVaultBalance(),23);
  assert.equal(db.transferSystemProfits(23,'vault_main','again',actor).success,false);
  assert.equal(read('STORE_WALLET_TRANSACTIONS').find(x=>x.referenceNumber==='old-voided').voidedOriginalAmount,23);return {};
 });
 await test('A30','noncash settlement clears a deleted ticket deficit once without cash or earned income',()=>{
  const t=create(makeTicket('JKR-2026-9931',{netProfit:50.69,totalProfitMargin:50.69}));db.completeTopUpTicket(t.id,'Audit Owner');
  assert(db.transferSystemProfits(50.69,'vault_main','prior-transfer',actor).success);
  db.deleteTicket(t.id,actor);assert.equal(snap('deleted').balances.w_profits,-50.69);
  const cash=JSON.stringify(read('SAFE_TRANSACTIONS')),operating=JSON.stringify(read('STORE_WALLETS'));
  assert.equal(db.settleProfitLoss(50.69,'loss-denied',{...actor,role:'employee'}).success,false);
  for(const amount of [NaN,-50.69,0,50,51,50.691]) assert.equal(db.settleProfitLoss(amount,'invalid-'+amount,actor).success,false);
  assert.equal(db.settleProfitLoss(50.69,'loss-one',actor).success,true);
  const after=snap('settled');assert.equal(after.balances.w_profits,0);assert.equal(after.views.w_profits.received,0);assert.equal(after.views.w_profits.count,0);
  assert.equal(after.views.w_profits.entries[0].balanceAfter,0);assert.equal(after.views.w_profits.entries.filter(x=>x.sourceType==='loss_settlement').length,1);
  assert.equal(JSON.stringify(read('SAFE_TRANSACTIONS')),cash);assert.equal(JSON.stringify(read('STORE_WALLETS')),operating);
  assert.equal(db.settleProfitLoss(50.69,'loss-one',actor).success,false);assert.equal(db.settleProfitLoss(50.69,'loss-two',actor).success,false);
  db.recalculateSystemWallets();assert.equal(snap('refreshed').balances.w_profits,0);
  const t2=create(makeTicket('JKR-2026-9932'));db.completeTopUpTicket(t2.id,'Audit Owner');assert.equal(snap('new-profit').balances.w_profits,23);
  assert.equal(db.settleProfitLoss(23,'positive-denied',actor).success,false);
  assert.equal(db.transferSystemProfits(23,'vault_main','next-profit',actor).success,true);assert.equal(db.getVaultBalance(),73.69);
  return {};
 });
 await test('A31','dealer deficit settlement remains in its profit wallet without changing either vault',()=>{
  put('DEALER_TICKETS',[makeTicket('DTKT-2026-9933',{department:'dealers',status:'completed'})]);
  assert(db.transferSystemProfits(23,'vault_main','dealer-prior',actor,'','mw_profits').success);put('DEALER_TICKETS',[]);
  const safe=JSON.stringify(read('DEALER_SAFE_TRANSACTIONS'));
  assert(db.settleProfitLoss(23,'dealer-loss',actor,'','mw_profits').success);
  assert.equal(db.getDealerWallets().find(w=>w.id==='mw_profits').balance,0);assert.equal(snap('retail').balances.w_profits,0);
  assert.equal(JSON.stringify(read('DEALER_SAFE_TRANSACTIONS')),safe);assert.equal(db.getVaultBalance(),0);return {};
 });
 const shiftTicket=(id='SHIFT-1000',extra={})=>makeTicket(id,{requiredAmount:1000,receivedAmount:1000,totalCostAmount:700,netProfit:230,totalProfitMargin:230,fixedCostAmount:50,cashbackEarned:10,referralCommissionEarned:10,...extra});
 const completeShiftTicket=(id,extra={})=>{const t=create(shiftTicket(id,extra));assert(db.completeTopUpTicket(t.id,'Audit Owner').success);return t;};
 const closeShift=(ids,id='close-test',dest='vault_main')=>{const plan=db.getShiftProfitPlan(ids,dest);return db.closeCustomerShift({id,ticketIds:ids,destinationId:dest,expectedPlan:plan.signature},actor);};
 await test('S01','1000 cash splits into 230 paid profit and 770 retained backing; no duplicated cash',()=>{
  const t=completeShiftTicket('SHIFT-1000');const result=closeShift([t.id]);assert(result.success,result.message);
  const state=snap('closed');assert.equal(state.operating,770);assert.equal(state.vault,230);assert.equal(state.operating+state.vault,1000);
  assert.equal(state.balances.w_profits,0);assert.equal(state.balances.w_cashback,10);assert.equal(state.balances.w_referrals,10);assert.equal(state.balances.w_operating_expenses,50);
  assert.equal(state.lines[0].monthlyReceived,1000);assert.equal(state.lines[0].monthlySent,230);
  assert.deepEqual(result.settlement.allocations,{goods:700,cashback:10,referrals:10,trust:0,expenses:50,netProfit:230,transferredProfit:230,previouslyTransferredProfit:0,retainedCash:770});
  assert.equal(db.getTicketById(t.id).shiftSettlementId,'close-test');assert.equal(db.transferSystemProfits(230,'vault_main','repeat',actor).success,false);return {};
 });
 await test('S02','profit paid before close is excluded from final payment',()=>{
  const t=completeShiftTicket('SHIFT-EARLY');assert(db.transferSystemProfits(100,'vault_main','early',actor).success);
  assert.equal(db.getShiftProfitPlan([t.id]).profitToTransfer,130);assert(closeShift([t.id]).success);
  assert.equal(db.getVaultBalance(),230);assert.equal(snap('remaining').operating,770);const record=db.getSettlements()[0];assert.equal(record.allocations.retainedCash,770);assert.equal(record.allocations.previouslyTransferredProfit,100);return {};
 });
 await test('S03','no source cash means no close or synthetic destination cash',()=>{
  const t=completeShiftTicket('SHIFT-NOCASH');const list=read('STORE_WALLETS');list.find(w=>w.id==='audit_op').numbers[0].currentBalance=0;put('STORE_WALLETS',list);
  const before=JSON.stringify([...cache]);assert.throws(()=>db.getShiftProfitPlan([t.id]),/نقد الربح غير كاف/);assert.equal(JSON.stringify([...cache]),before);
  assert.equal(db.transferSystemProfits(230,'vault_main','unfunded',actor).success,false);assert.equal(db.getVaultBalance(),0);return {};
 });
 await test('S04','stale ticket plan rejects close without partial writes',()=>{
  const t=completeShiftTicket('SHIFT-STALE');const plan=db.getShiftProfitPlan([t.id]);const list=read('TICKETS');list[0].netProfit=200;put('TICKETS',list);
  const before=JSON.stringify([...cache]);const result=db.closeCustomerShift({id:'stale',ticketIds:[t.id],destinationId:'vault_main',expectedPlan:plan.signature},actor);
  assert.equal(result.success,false);assert.equal(JSON.stringify([...cache]),before);return {};
 });
 await test('S05','a losing ticket offsets positive profit before any payout',()=>{
  const a=completeShiftTicket('SHIFT-GAIN');const b=completeShiftTicket('SHIFT-LOSS',{netProfit:-30,totalProfitMargin:-30});
  assert.equal(db.getShiftProfitPlan([a.id,b.id]).profitToTransfer,200);assert(closeShift([a.id,b.id]).success);
  assert.equal(db.getVaultBalance(),200);assert.equal(snap('closed').operating,1800);assert.equal(snap('closed').balances.w_profits,0);return {};
 });
 await test('S06','destination failure restores cash profits tickets and close receipt',()=>{
  const t=completeShiftTicket('SHIFT-FAIL');const old=db.addSafeTransaction;db.addSafeTransaction=()=>{throw new Error('safe-down');};
  const before=JSON.stringify([...cache]);try{const result=closeShift([t.id]);assert.equal(result.success,false);assert.equal(JSON.stringify([...cache]),before);}finally{db.addSafeTransaction=old;}
  assert(closeShift([t.id]).success);return {};
 });
 await test('S07','same tickets cannot close again with a different operation reference',()=>{
  const t=completeShiftTicket('SHIFT-REPEAT');assert(closeShift([t.id]).success);const before=JSON.stringify([...cache]);
  assert.throws(()=>closeShift([t.id],'another-close'),/تمت تسويتها/);assert.equal(JSON.stringify([...cache]),before);return {};
 });
 await test('S08','delete after paid close leaves deficit without inventing cash',()=>{
  const t=completeShiftTicket('SHIFT-DELETE');assert(closeShift([t.id]).success);db.deleteTicket(t.id,actor);
  assert.equal(snap('deleted').balances.w_profits,-230);assert.equal(db.getVaultBalance(),230);assert.equal(snap('deleted').operating,770);return {};
 });
 await test('S09','empty close and employee close reject without any write',()=>{
  const t=completeShiftTicket('SHIFT-ROLE');const plan=db.getShiftProfitPlan([t.id]);const before=JSON.stringify([...cache]);
  assert.equal(db.closeCustomerShift({id:'empty',ticketIds:[],destinationId:'vault_main',expectedPlan:''},actor).success,false);
  assert.equal(db.closeCustomerShift({id:'role',ticketIds:[t.id],destinationId:'vault_main',expectedPlan:plan.signature},{...actor,role:'employee'}).success,false);
  assert.equal(JSON.stringify([...cache]),before);return {};
 });
 await test('S10','opening funds and unrelated inventory wallets are preserved',()=>{
  const t=completeShiftTicket('SHIFT-OTHER');put('STORE_WALLETS',[...read('STORE_WALLETS'),{id:'goods',name:'Inventory',type:'inventory',currency:'EGP',balance:5000},{id:'othercash',name:'Other cash',type:'operating',currency:'EGP',balance:500}]);
  assert(closeShift([t.id]).success);const wallets=db.getStoreWallets();assert.equal(wallets.find(w=>w.id==='goods').balance,5000);assert.equal(wallets.find(w=>w.id==='othercash').balance,500);return {};
 });
 await test('S11','all prior earnings paid means zero-cash close with no second payout',()=>{
  const t=completeShiftTicket('SHIFT-PREPAID');assert(db.transferSystemProfits(230,'vault_main','prepaid',actor).success);
  const cashBefore=JSON.stringify(read('SAFE_TRANSACTIONS'));assert.equal(db.getShiftProfitPlan([t.id]).profitToTransfer,0);assert(closeShift([t.id]).success);
  assert.equal(JSON.stringify(read('SAFE_TRANSACTIONS')),cashBefore);assert.equal(snap('closed').operating,770);return {};
 });
 await test('S12','bank destination preserves total physical cash and only gets profit',()=>{
  const t=completeShiftTicket('SHIFT-BANK');put('STORE_WALLETS',[...read('STORE_WALLETS'),{id:'bank',name:'Bank',type:'operating',category:'bank',currency:'EGP',balance:0}]);
  assert(closeShift([t.id],'bank-close','bank').success);const wallets=db.getStoreWallets();assert.equal(wallets.find(w=>w.id==='bank').balance,230);assert.equal(snap('closed').operating,770);assert.equal(db.getVaultBalance(),0);return {};
 });

 await test('S13','reading a closed ticket does not rewrite profit when a referrer is no longer linked',()=>{
  const t=completeShiftTicket('SHIFT-SNAPSHOT');const customers=read('CUSTOMERS');customers[0].referredByCode=undefined;put('CUSTOMERS',customers);
  const before=JSON.stringify([...cache]);assert.equal(db.getTickets()[0].netProfit,230);assert.equal(db.getTicketById(t.id).referralCommissionEarned,10);
  assert.equal(db.getShiftProfitPlan([t.id]).profitToTransfer,230);assert.equal(JSON.stringify([...cache]),before);return {};
 });
 const split=(ids,id='dist-one',who=actor)=>{const plan=db.getShiftDistributionPlan(ids);return db.closeDistributedShift({id,ticketIds:ids,expectedPlan:plan.signature},who);};
 const physical=()=>Math.round((db.getVaultBalance()+db.getStoreWallets().filter(w=>!w.isSystemWallet&&['operating','treasury'].includes(w.type)).reduce((s,w)=>s+w.balance,0))*100)/100;
 const reserve=(kind)=>db.getFinancialTreasuries().find(w=>w.treasuryKind===kind).balance;
 const seedReserve=(kind,amount)=>put('STORE_WALLETS',[...read('STORE_WALLETS'),{id:'treasury_'+kind,name:kind,type:'treasury',treasuryKind:kind,currency:'EGP',balance:amount,controlledBy:'owner',allowWithdrawal:true,createdAt:new Date().toISOString()}]);
 await test('D01','full shift distributes 1000 and zeroes every reception line',()=>{
  const t=completeShiftTicket('DIST-1000');const before=physical();const result=split([t.id]);assert(result.success,result.message);
  assert.equal(snap('split').operating,0);assert.equal(snap('split').lines[0].currentBalance,0);assert.equal(snap('split').lines[0].monthlySent,1000);assert.equal(snap('split').lines[0].monthlyReceived,1000);
  assert.equal(db.getVaultBalance(),700);assert.equal(reserve('profits'),230);assert.equal(reserve('cashback'),10);assert.equal(reserve('referrals'),10);assert.equal(reserve('operating_expenses'),50);assert.equal(reserve('trust'),0);assert.equal(physical(),before);
  assert.equal(snap('book').balances.w_profits,230);assert.equal(result.settlement.settlementMode,'distribution_v2');return {};
 });
 await test('D02','partial profit treasury release to main preserves physical total and cannot repeat',()=>{
  const t=completeShiftTicket('DIST-PARTIAL');assert(split([t.id]).success);const before=physical();assert(db.transferTreasuryFunds('treasury_profits',100,'release-one',actor).success);
  assert.equal(db.getVaultBalance(),800);assert.equal(reserve('profits'),130);assert.equal(snap('book').balances.w_profits,130);assert.equal(physical(),before);
  assert.equal(db.transferTreasuryFunds('treasury_profits',100,'release-one',actor).success,false);assert(db.transferSystemProfits(130,'vault_main','release-rest',actor).success);assert.equal(reserve('profits'),0);assert.equal(db.getVaultBalance(),930);assert.equal(physical(),1000);return {};
 });
 await test('D03','moving cashback cash does not erase customer entitlement',()=>{
  const t=completeShiftTicket('DIST-CB');assert(split([t.id]).success);const entitlement=db.getCustomerById('customer').cashbackBalance;
  assert(db.transferTreasuryFunds('treasury_cashback',5,'cb-move',actor).success);assert.equal(reserve('cashback'),5);assert.equal(db.getCustomerById('customer').cashbackBalance,entitlement);assert.equal(physical(),1000);return {};
 });
 await test('D04','failed treasury deposit rolls back all legs including receipt close',()=>{
  const t=completeShiftTicket('DIST-FAIL');const original=db.depositStoreWalletFunds;db.depositStoreWalletFunds=()=>false;const before=JSON.stringify([...cache]);
  try{assert.equal(split([t.id]).success,false);assert.equal(JSON.stringify([...cache]),before);}finally{db.depositStoreWalletFunds=original;}
  assert(split([t.id]).success);return {};
 });
 await test('D05','cash and opening balance mismatch refuses arbitrary goods allocation',()=>{
  const t=completeShiftTicket('DIST-MISMATCH');db.depositStoreWalletFunds('audit_op',500,'opening');const before=JSON.stringify([...cache]);assert.throws(()=>db.getShiftDistributionPlan([t.id]),/فرق غير مخصص/);assert.equal(JSON.stringify([...cache]),before);return {};
 });
 await test('D06','cashback redemption releases funded reserve into the next distribution',()=>{
  seedReserve('cashback',20);const t=completeShiftTicket('DIST-CREDIT',{receivedAmount:980,requiredAmount:980,cashbackUsed:20});
  assert(split([t.id]).success);assert.equal(reserve('cashback'),10);assert.equal(snap('closed').operating,0);assert.equal(db.getVaultBalance(),700);assert.equal(physical(),1000);return {};
 });
 await test('D07','an unfunded redemption refuses closure without creating cash',()=>{
  const t=completeShiftTicket('DIST-UNFUNDED',{receivedAmount:980,requiredAmount:980,cashbackUsed:20});assert.throws(()=>db.getShiftDistributionPlan([t.id]),/غير كاف/);assert.equal(db.getVaultBalance(),0);return {};
 });
 await test('D08','a genuine losing sale is funded by the profit reserve',()=>{
  seedReserve('profits',30);const t=completeShiftTicket('DIST-LOSS',{receivedAmount:50,requiredAmount:50,totalCostAmount:70,netProfit:-27,totalProfitMargin:-27,fixedCostAmount:5,cashbackEarned:1,referralCommissionEarned:1});
  const result=split([t.id]);assert(result.success,result.message);assert.equal(reserve('profits'),3);assert.equal(db.getVaultBalance(),70);assert.equal(snap('closed').operating,0);assert.equal(physical(),80);return {};
 });
 await test('D09','previous direct profit payment is not funded twice at full close',()=>{
  const t=completeShiftTicket('DIST-PREPAID');assert(db.transferSystemProfits(100,'vault_main','early-profit',actor).success);assert(split([t.id]).success);
  assert.equal(reserve('profits'),130);assert.equal(db.getVaultBalance(),800);assert.equal(snap('closed').operating,0);assert.equal(physical(),1000);return {};
 });
 await test('D10','same completed tickets and stale plan cannot close twice',()=>{
  const t=completeShiftTicket('DIST-REPEAT');const plan=db.getShiftDistributionPlan([t.id]);assert(split([t.id]).success);const before=JSON.stringify([...cache]);
  assert.equal(db.closeDistributedShift({id:'second',ticketIds:[t.id],expectedPlan:plan.signature},actor).success,false);assert.equal(JSON.stringify([...cache]),before);return {};
 });
 await test('D11','treasury transfer validates amount role available cash and restores failed destination',()=>{
  const t=completeShiftTicket('DIST-GUARDS');assert(split([t.id]).success);const before=JSON.stringify([...cache]);
  for(const amount of [NaN,0,-1,10.001,231])assert.equal(db.transferTreasuryFunds('treasury_profits',amount,'invalid-'+amount,actor).success,false);
  assert.equal(db.transferTreasuryFunds('treasury_profits',10,'employee',{...actor,role:'employee'}).success,false);assert.equal(JSON.stringify([...cache]),before);
  const old=db.addSafeTransaction;db.addSafeTransaction=()=>{throw Error('safe failure');};try{assert.equal(db.transferTreasuryFunds('treasury_profits',10,'fail-safe',actor).success,false);assert.equal(JSON.stringify([...cache]),before);}finally{db.addSafeTransaction=old;}return {};
 });
 await test('D12','existing funded reserves carry forward independently of a new shift',()=>{
  seedReserve('cashback',90);const t=completeShiftTicket('DIST-CARRY');assert(split([t.id]).success);assert.equal(reserve('cashback'),100);assert.equal(physical(),1090);return {};
 });
 await test('D13','exact customer screenshot: 7330 goes to 6405 goods and five separate destinations',()=>{
  const t=completeShiftTicket('DIST-SCREEN',{receivedAmount:7330,requiredAmount:7330,totalCostAmount:6405,netProfit:748.4,totalProfitMargin:748.4,fixedCostAmount:30,cashbackEarned:73.3,referralCommissionEarned:73.3});
  const result=split([t.id]);assert(result.success,result.message);assert.equal(db.getVaultBalance(),6405);assert.equal(reserve('profits'),748.4);assert.equal(reserve('cashback'),73.3);assert.equal(reserve('referrals'),73.3);assert.equal(reserve('operating_expenses'),30);assert.equal(snap('done').operating,0);assert.equal(physical(),7330);return {};
 });
 await test('D14','overpayment funds a separate trust cash treasury',()=>{
  const t=completeShiftTicket('DIST-TRUST',{receivedAmount:1020,overpaymentAmount:20});const result=split([t.id]);assert(result.success,result.message);assert.equal(reserve('trust'),20);assert.equal(physical(),1020);return {};
 });
 await test('D15','reclassified old payout remains auditable but cannot suppress owned profit twice',()=>{
  const t=completeShiftTicket('DIST-RECLASS');db.addStoreWalletTransaction({walletId:'w_profits',walletName:'profit',type:'withdrawal',amount:230,currency:'EGP',balanceBefore:230,balanceAfter:0,description:'reclassified',sourceType:'manual_withdrawal',sourceName:'profit_transfer',referenceNumber:'old-reclassified',profitTicketAllocations:{[t.id]:230},reclassifiedToTreasuryAt:new Date().toISOString()});
  assert.equal(snap('book').balances.w_profits,230);assert(split([t.id]).success);assert.equal(reserve('profits'),230);assert(db.transferTreasuryFunds('treasury_profits',230,'real-release',actor).success);assert.equal(snap('book').balances.w_profits,0);assert.equal(physical(),1000);return {};
 });

 await test('D16','funded treasury cannot be used as a ticket receiving cash wallet',()=>{
  seedReserve('cashback',20);const before=JSON.stringify([...cache]);const result=db.recordWalletReceivingPayment('treasury_cashback',undefined,10,'INVALID-RECEIPT','customer',actor);
  assert.equal(result.success,false);assert.equal(JSON.stringify([...cache]),before);return {};
 });
 // New customer-approved acceptance contract. Old audit observations are not expected behavior.
 const by=id=>results.find(t=>t.id===id);const last=id=>by(id).stages.at(-1);
 const zeroWallets=state=>{for(const [id,balance] of Object.entries(state.balances)){assert.equal(balance,0,id);assert.equal(state.views[id].received,0,id+' received');assert.equal(state.views[id].withdrawn,0,id+' withdrawn');assert.equal(state.views[id].count,0,id+' count');assert.equal(state.views[id].entries.length,0,id+' entries');}};
 assert(results.every(t=>!t.error),results.filter(t=>t.error).map(t=>t.id+': '+t.error).join('\n'));
 assert.equal(by('L02').stages[0].balances.w_trust,20);assert.equal(last('L02').balances.w_trust,0);
 assert.equal(by('L08').ledger.every(tx=>tx.wallet==='mw_profits'),true);assert.equal(last('L10').balances.w_trust,5);
 assert.equal(by('L12').stages[0].balances.w_trust,100);assert.equal(last('L12').balances.w_trust,0);
 zeroWallets(last('L01'));assert.equal(last('L01').operating,100,'delete is not a refund');
 zeroWallets(last('L03'));assert.equal(last('L03').operating,0);assert.equal(by('L03').repeat.success,false);
 assert.equal(last('L03').lines[0].monthlyReceived,100);assert.equal(last('L03').lines[0].monthlySent,100);
 assert.equal(by('L04').first.success,true);assert.equal(by('L04').second.success,true);zeroWallets(last('L04'));
 assert.equal(by('L04').stages[1].balances.w_profits,13.8);assert.equal(by('L04').stages[1].balances.w_operating_expenses,3);
 assert.equal(last('L05').balances.w_profits,46);assert.equal(last('L05').views.w_profits.received,46);assert.equal(last('L05').views.w_profits.count,1);
 assert.equal(last('L05').views.w_operating_expenses.received,10);
 assert.equal(by('L06').first,true);assert.equal(by('L06').second,false);assert.equal(last('L06').balances.w_profits,0);assert.equal(last('L06').vault,23);
 zeroWallets(last('L07'));assert.equal(last('L07').operating,100);
 assert.equal(by('L09').uniqueIds,2);assert.equal(last('L11').balances.w_cashback,10);assert.equal(last('L11').balances.w_referrals,5);
 assert.equal(last('L13').operating,100);assert.equal(last('L13').balances.w_profits,23);
 assert.equal(last('L14').balances.w_cashback,1);assert.equal(last('L14').balances.w_referrals,1);
 console.log('PASS: customer wallet balances, totals, counters, contributor details, actual refunds, receiving/sending usage, edits, credits, transfers and read purity.');
 console.log('Lifecycle cases completed:',results.length,'Errors:',results.filter(r=>r.error).length);
})().catch(e=>{console.error(e);process.exitCode=1});
