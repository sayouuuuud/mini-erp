const assert=require('node:assert/strict'),esbuild=require('esbuild'),Module=require('node:module'),path=require('node:path');
(async()=>{
 const tables=new Map([['store_wallets',[{id:'cash',data:{id:'cash',balance:100,createdAt:'2026-01-01',_erpOrder:0}}]]]);
 const kv=new Map(),calls=[],notifications=[];let fault=null;
 globalThis.__atomicTransport={
  from(table){return {select(){let start=0,end=Infinity;const q={order(){return q;},range(a,b){start=a;end=b+1;return q;},then(ok,bad){return Promise.resolve({data:structuredClone((table==='system_kv'?[...kv].map(([key,value])=>({key,value})):tables.get(table)||[]).slice(start,end)),error:null}).then(ok,bad);}};return q;}}},
  channel(){return {on(){return this;},subscribe(){return this;}}},removeChannel:async()=>{},
  async rpc(_,args){calls.push(structuredClone(args));await new Promise(r=>setTimeout(r,5));
   if(fault){const error=fault;fault=null;return {data:null,error};}
   for(const c of args.p_changes){if(c.table==='system_kv'){kv.set(c.id,c.after);continue;}const rows=tables.get(c.table)||[];const index=rows.findIndex(r=>r.id===c.id);if(c.after===null){if(index>=0)rows.splice(index,1);}else if(index>=0)rows[index]={id:c.id,data:c.after};else rows.push({id:c.id,data:c.after});tables.set(c.table,rows);}
   return {data:{committedAt:new Date().toISOString()},error:null};
  }
 };
 const result=await esbuild.build({stdin:{contents:"export {supabaseStorage} from './src/database/supabaseStorage';export {eventBus} from './src/services/eventBus';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mock',setup(b){b.onResolve({filter:/lib\/supabase$/},()=>({path:'network',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const supabase=globalThis.__atomicTransport;'}));}}]});
 const m=new Module(path.resolve('atomic-storage.bundle.cjs'),module);m.filename=path.resolve('atomic-storage.bundle.cjs');m.paths=module.paths;m._compile(result.outputFiles[0].text,m.filename);
 const {supabaseStorage:s,eventBus}=m.exports;await s.waitForHydration();eventBus.subscribe('STORAGE_ERROR',p=>notifications.push(p));
 s.setItem('store_wallets',[{id:'cash',balance:75,createdAt:'2026-01-01',_erpOrder:0},{id:'w_profits',isSystemWallet:true,balance:999}]);
 s.setItem('safe_tx',[{id:'receipt',amount:25}]);await s.flush();
 assert.equal(calls.length,1);assert.equal(calls[0].p_changes.length,2);assert.equal(tables.get('store_wallets')[0].data.balance,75);assert.equal(tables.get('safe_transactions')[0].data.amount,25);assert(!calls[0].p_changes.some(c=>c.id==='w_profits'));
 console.log('PASS: all collections commit in one batch, virtual wallets excluded, flush waits for acknowledgement');
 fault={message:'network unavailable',code:'FETCH_ERROR'};s.setItem('store_wallets',[{id:'cash',balance:70,createdAt:'2026-01-01',_erpOrder:0}]);await s.flush();
 assert.equal(calls[1].p_operation_id,calls[2].p_operation_id);assert.deepEqual(calls[1].p_changes,calls[2].p_changes);console.log('PASS: ambiguous retry keeps the same operation id and payload');
 // The server's authoritative balance changes while this page has an old snapshot.
 tables.get('store_wallets')[0].data.balance=60;fault={message:'erp_conflict',code:'PT409'};
 s.setItem('store_wallets',[{id:'cash',balance:65,createdAt:'2026-01-01',_erpOrder:0}]);
 await assert.rejects(s.flush(),/تعارض/);assert.equal(s.getItem('store_wallets',[])[0].balance,60);assert.equal(notifications.length,1);assert(notifications[0].conflict);
 console.log('PASS: conflict rejects confirmation and reloads the authoritative balance');
 let release;const gate=new Promise(r=>release=r);const active=s.withMaintenance(async()=>{await gate;});
 assert.throws(()=>s.setItem('store_wallets',[]),/انتظر/);release();await active;
 tables.set('customer_notes',Array.from({length:1501},(_,i)=>({id:'note'+i,data:{id:'note'+i}})));
 await s.resetAndHydrate();assert.equal(s.getItem('notes',[]).length,1501);console.log('PASS: maintenance blocks intervening writes; hydration reads every page beyond 1000 records');
 s.clearSession();assert.equal(s.isStorageHydrated(),false);console.log('PASS: sign-out clears cached financial data and the write guard');
})().catch(e=>{console.error(e);process.exitCode=1});
