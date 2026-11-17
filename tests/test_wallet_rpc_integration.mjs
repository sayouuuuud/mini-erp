// Explicit isolated QA identities only. Never seeds or resets production accounts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const fixturePath=process.env.ERP_QA_FIXTURE;
assert(fixturePath,'Set ERP_QA_FIXTURE to a private, explicitly provisioned test workspace');
const {scope,users}=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
assert(/^__qa_[a-z0-9]+$/.test(scope));assert(users.every(u=>u.id.startsWith('__qa_user_')));
const source=fs.readFileSync(new URL('../src/lib/supabase.ts',import.meta.url),'utf8');
const url=process.env.VITE_SUPABASE_URL||source.match(/'(https:\/\/[^']+supabase.co)'/)[1];
const key=process.env.VITE_SUPABASE_ANON_KEY||source.match(/'(eyJ[^']+)'/)[1];
const clients=users.map(()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(20000)})}}));
const id=tag=>'__qa_'+tag+'_'+crypto.randomUUID();
const data=(rowId,extra={})=>({id:rowId,_erpTestScope:scope,createdAt:new Date().toISOString(),...extra});
const change=(table,rowId,before,after)=>({table,id:rowId,exists:before!==null,before,after});
const commit=(client,changes,operationId=crypto.randomUUID())=>client.rpc('erp_commit_changes',{p_operation_id:operationId,p_changes:changes});
const read=async(client,table,rowId)=>{const {data,error}=await client.from(table).select('id,data').eq('id',rowId);assert.ifError(error);return data[0]?.data||null;};
let assertions=0;
function pass(name){assertions++;console.log('PASS:',name);}
try{
 for(let i=0;i<users.length;i++){
  const email=crypto.createHash('sha256').update(users[i].username).digest('hex')+'@erp.ammar.invalid';
  const login=await clients[i].auth.signInWithPassword({email,password:users[i].password});assert.ifError(login.error);
  const actor=await clients[i].rpc('erp_current_user');assert.ifError(actor.error);assert.equal(actor.data._testScope,scope);
 }
 pass('separate authenticated sessions resolve to the isolated workspace');
 const [a,b,employee]=clients;
 const walletId=id('wallet');const wallet=data(walletId,{name:'QA operating',type:'operating',currency:'EGP',balance:100,numbers:[]});
 assert.ifError((await commit(a,[change('store_wallets',walletId,null,wallet)])).error);
 const nextA={...wallet,balance:110},nextB={...wallet,balance:120};
 const concurrent=await Promise.all([commit(a,[change('store_wallets',walletId,wallet,nextA)]),commit(b,[change('store_wallets',walletId,wallet,nextB)])]);
 console.log('Concurrent statuses:',concurrent.map(x=>x.error ? {code:x.error.code,message:x.error.message} : {committed:true}));
 assert.equal(concurrent.filter(x=>!x.error).length,1);assert.equal(concurrent.filter(x=>x.error?.message==='erp_conflict').length,1);
 assert([110,120].includes((await read(a,'store_wallets',walletId)).balance));pass('two simultaneous stale balance updates: one commits and one conflicts');
 const noteId=id('note'),note=data(noteId,{content:'rollback check'});
 const failed=await commit(a,[change('customer_notes',noteId,null,note),change('store_wallets',walletId,wallet,{...wallet,balance:900})]);
 assert.equal(failed.error?.message,'erp_conflict');assert.equal(await read(a,'customer_notes',noteId),null);pass('a conflict rolls back the entire multi-table batch');
 const current=await read(a,'store_wallets',walletId),operationId=crypto.randomUUID();const payload=[change('store_wallets',walletId,current,{...current,balance:125})];
 const first=await commit(a,payload,operationId);assert.ifError(first.error);const retry=await commit(a,payload,operationId);assert.ifError(retry.error);assert.deepEqual(first.data,retry.data);
 assert((await commit(a,[change('store_wallets',walletId,current,{...current,balance:500})],operationId)).error);pass('same operation id is safe to retry and cannot carry a changed payload');
 const ticketId=id('ticket');const ticket=data(ticketId,{ticketNumber:ticketId,status:'completed',receivedAmount:100,requiredAmount:100,netProfit:23,totalProfitMargin:23});
 assert.ifError((await commit(a,[change('tickets',ticketId,null,ticket)])).error);
 function transferPayload(){const ref=id('profit'),outId=id('out'),inId=id('in');return [change('store_wallet_transactions',outId,null,data(outId,{walletId:'w_profits',walletName:'QA profits',type:'withdrawal',amount:23,currency:'EGP',balanceBefore:23,balanceAfter:0,sourceType:'manual_withdrawal',sourceName:'profit_transfer',targetWalletId:'vault_main',referenceNumber:ref,description:'QA transfer'})),change('safe_transactions',inId,null,data(inId,{type:'cash_in',amount:23,currency:'EGP',category:'wallet_transfer',referenceId:ref,description:'QA transfer'}))];}
 const profitRace=await Promise.all([commit(a,transferPayload()),commit(b,transferPayload())]);
 assert.equal(profitRace.filter(x=>!x.error).length,1);assert(profitRace.some(x=>x.error?.message.includes('erp_insufficient_profit')));
 const safeRows=await a.from('safe_transactions').select('data').eq('data->>_erpTestScope',scope);assert.ifError(safeRows.error);assert.equal(safeRows.data.reduce((sum,r)=>sum+r.data.amount,0),23);pass('two sessions cannot transfer the same profit twice; destination only credited once');
 assert((await commit(employee,transferPayload())).error);pass('employee cannot transfer profit by forging client-side role');
 const userRow=await read(employee,'users',users[2].id);assert(userRow && !('password' in userRow));
 assert((await commit(employee,[change('users',users[2].id,userRow,{...userRow,role:'admin'})])).error);pass('employee cannot promote their own account');
 // An invalid destination must roll back even when enough profit exists.
 const extraId=id('extra_ticket');assert.ifError((await commit(a,[change('tickets',extraId,null,data(extraId,{ticketNumber:extraId,status:'completed',receivedAmount:100,netProfit:23}))])).error);
 const orphan=transferPayload()[0];const bad=await commit(a,[orphan]);assert(bad.error?.message.includes('erp_transfer_destination_missing'));
 assert.equal(await read(a,'store_wallet_transactions',orphan.id),null);pass('a missing transfer destination leaves no outgoing record');
 if(process.env.ERP_VERIFY_RLS==='1'){
  const anon=createClient(url,key,{auth:{persistSession:false}});
  const anonymous=await anon.from('tickets').select('id').limit(1);assert(anonymous.error || anonymous.data?.length===0);
  assert((await anon.rpc('erp_commit_changes',{p_operation_id:crypto.randomUUID(),p_changes:[]})).error);
  const denied=await a.from('store_wallets').upsert({id:id('direct'),data:{id:id('direct')}});assert(denied.error);
  const isolated=await a.from('tickets').select('data');assert.ifError(isolated.error);assert(isolated.data.every(r=>r.data._erpTestScope===scope));
  pass('RLS blocks anonymous data, direct writes and records outside the authenticated workspace');
 }
 console.log(JSON.stringify({passed:assertions,scope:'isolated QA only',transport:'actual Supabase Auth + transactional RPC',rls:process.env.ERP_VERIFY_RLS==='1'}));
}finally{
 const a=clients[0];
 // Remove only the exact isolated workspace's business fixtures, retaining QA logins for browser checks.
 for(const table of ['store_wallet_transactions','safe_transactions','customer_notes','tickets','store_wallets']){
  const {data:rows,error}=await a.from(table).select('id,data').eq('data->>_erpTestScope',scope);
  if(error)continue;
  if(rows.length){const result=await commit(a,rows.map(row=>change(table,row.id,row.data,null)));if(result.error)console.error('QA cleanup requires review:',table,result.error.code);}
 }
 await Promise.all(clients.map(c=>c.auth.signOut()));
}
