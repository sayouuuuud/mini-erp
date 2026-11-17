// Tests the production storage adapter with an isolated in-memory Supabase transport.
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const Module = require('node:module');
const path = require('node:path');
const wait = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
 const tables = new Map([['store_wallets',[
  {id:'cash-b',data:{id:'cash-b',name:'B',balance:0,createdAt:'2026-02-01'}},
  {id:'cash-a',data:{id:'cash-a',name:'A',balance:10,createdAt:'2026-01-01'}}
 ]]]);
 const handlers = new Map(); const writes=[];let active=0,maxActive=0;
 globalThis.__testSupabase={
  from(table){return {
   select(){const promise=Promise.resolve({data:structuredClone(tables.get(table)||[]),error:null});promise.order=()=>promise;return promise;},
   async upsert(rows){active++;maxActive=Math.max(maxActive,active);writes.push({table,rows:structuredClone(rows)});await wait(15);active--;return {error:null};},
   delete(){return {in:async()=>({error:null}),neq:async()=>({error:null})};}
  };},
  channel(){return {on(_,filter,fn){handlers.set(filter.table,fn);return this;},subscribe(){return this;}}}
 };
 const result=await esbuild.build({stdin:{contents:"export {supabaseStorage} from './src/database/supabaseStorage';export {eventBus} from './src/services/eventBus';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mock-network',setup(b){b.onResolve({filter:/lib\/supabase$/},()=>({path:'supabase',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const supabase = globalThis.__testSupabase;'}));}}]});
 const m=new Module(path.resolve('storage-test.bundle.cjs'),module);m.filename=path.resolve('storage-test.bundle.cjs');m.paths=module.paths;m._compile(result.outputFiles[0].text,m.filename);
 const {supabaseStorage:s,eventBus}=m.exports;await s.waitForHydration();
 const read=()=>s.getItem('nzm_jkr_store_wallets',[]);
 assert.deepEqual(read().map(x=>x.id),['cash-a','cash-b'],'wallet hydration order must be deterministic');
 let events=0;eventBus.subscribe('DATA_SYNCED',()=>events++);
 const list=structuredClone(read());list[0].balance=803;s.setItem('store_wallets',list);
 list[0].balance=99999;assert.equal(read()[0].balance,803,'writes must capture an immutable snapshot');
 await Promise.resolve();assert.equal(events,1,'local changes notify UI without server echo');
 handlers.get('store_wallets')({eventType:'UPDATE',new:{id:'cash-a',data:{id:'cash-a',balance:10},updated_at:'2026-01-01'}});
 assert.equal(read()[0].balance,803,'pending local payment must not be overwritten by stale realtime echo');
 await wait(170);
 const next=structuredClone(read());next[0].balance=900;s.setItem('nzm_jkr_store_wallets',next);
 await wait(200);
 assert.equal(maxActive,1,'aliases use the same serialized write queue');
 const batches=writes.filter(w=>w.table==='store_wallets');assert.equal(batches.length,2);
 assert.equal(batches[1].rows.length,1,'unchanged wallets must not be rewritten');
 assert.equal(batches[1].rows[0].id,'cash-a');assert.equal(batches[1].rows[0].data.balance,900);
 const baseline=events;
 handlers.get('store_wallets')({eventType:'UPDATE',new:{id:'cash-b',updated_at:'2099-01-01',data:{id:'cash-b',name:'B',balance:77,createdAt:'2026-02-01',_erpOrder:1}}});
 assert.equal(read().find(w=>w.id==='cash-b').balance,77);assert(events>baseline,'remote updates notify UI');
 assert.deepEqual(read().map(w=>w.id),['cash-a','cash-b'],'remote updates do not move cards');
 handlers.get('store_wallets')({eventType:'UPDATE',new:{id:'cash-a',updated_at:'2026-01-01',data:{id:'cash-a',balance:1}}});
 assert.equal(read().find(w=>w.id==='cash-a').balance,900,'late stale echo is ignored after a successful write');
 assert.equal(read().find(w=>w.id==='cash-b').balance,77,'balance remains tied to its wallet ID');
 console.log('PASS: immediate local notifications, immutable snapshots, serialized aliases, changed-row-only persistence, stale echo protection, remote updates, stable card order, and wallet ID balances.');
})().catch(e=>{console.error(e);process.exitCode=1});
