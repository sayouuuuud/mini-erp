const {JSDOM}=require('jsdom'),assert=require('node:assert/strict');
const dom=new JSDOM('<div id="root"></div>',{url:'https://erp.test'});
delete global.navigator;Object.assign(global,{window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,IS_REACT_ACT_ENVIRONMENT:true});
window.scrollTo=()=>{};global.requestAnimationFrame=cb=>setTimeout(cb,0);global.cancelAnimationFrame=clearTimeout;
let sessionEvent,signouts=0,profile=null,hydrate=async()=>{},replays=[],toasts=[],actions=[];
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
global.__test={shifts:[],toast:(...a)=>toasts.push(a),storage:{setTestScope(){},resetAndHydrate:()=>hydrate(),clearSession(){},withMaintenance:f=>f()},api:{auth:{getSession:async()=>({data:{session:{}}}),onAuthStateChange:cb=>{sessionEvent=cb;return {data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{signouts++;sessionEvent?.('SIGNED_OUT');}},rpc:async(name,args)=>{if(name==='erp_current_user')return profile;if(name==='erp_action_history')return {data:actions};if(name==='erp_replay_action'){replays.push(args);await replayWait.promise;return {data:{}};}throw Error(name);}}};
const {React:R,act,createRoot,AuthProvider,useAuth,HistoryProvider,ActionHistoryDialog,ShiftHistory}=require('./bundle.cjs');
const h=R.createElement;let auth,root;
function Probe(){auth=useAuth();return h('span',null,auth.isRestoring?'LOADING':auth.restoreError?'ERROR':auth.user?'SIGNED_IN':'LOGIN');}
const tick=()=>act(async()=>{await new Promise(r=>setTimeout(r,5));});
async function mount(child){root=createRoot(document.getElementById('root'));await act(async()=>root.render(child));}
async function unmount(){await act(async()=>root.unmount());document.body.innerHTML='<div id="root"></div>';}
(async()=>{
 let pd=defer(),hd=defer();profile=pd.promise;hydrate=()=>hd.promise;
 await mount(h(AuthProvider,null,h(Probe)));assert.equal(document.body.textContent,'LOADING');
 await act(async()=>pd.resolve({data:{id:'owner',fullName:'Owner',role:'admin',isActive:true}}));assert.equal(document.body.textContent,'LOADING');
 await act(async()=>hd.resolve());assert.equal(document.body.textContent,'SIGNED_IN');assert.equal(signouts,0);await unmount();
 profile={error:{message:'offline'}};hydrate=async()=>{};await mount(h(AuthProvider,null,h(Probe)));await tick();assert.equal(document.body.textContent,'ERROR');assert.equal(signouts,0);
 profile={data:{id:'owner',role:'admin',isActive:true}};await act(async()=>auth.retryRestore());await tick();assert.equal(document.body.textContent,'SIGNED_IN');await unmount();
 hd=defer();hydrate=()=>hd.promise;await mount(h(AuthProvider,null,h(Probe)));await tick();await act(async()=>sessionEvent('SIGNED_OUT'));await act(async()=>hd.resolve());assert.equal(document.body.textContent,'LOGIN');await unmount();
 hydrate=async()=>{};actions=[{id:'new',description:'New action',timestamp:'2026-11-17T00:00:00Z',state:'applied'},{id:'old',description:'Old action',timestamp:'2026-11-16T23:00:00Z',state:'applied'}];
 let replayWait=defer();global.replayWait=replayWait;
 await mount(h(AuthProvider,null,h(Probe),h(HistoryProvider,null,h(ActionHistoryDialog,{mode:'undo',onClose(){}}))));await tick();
 const buttons=[...document.querySelectorAll('button')].filter(b=>b.textContent==='تراجع عن ده');assert.equal(buttons.length,2);
 await act(async()=>{buttons[1].click();buttons[1].click();});assert.equal(replays.length,1);assert.equal(replays[0].p_action_id,'old');
 await act(async()=>replayWait.resolve());await tick();await unmount();
 global.__test.shifts=[{id:'closed',shiftNumber:'SHIFT-SAVED',status:'closed',startTime:'2026-11-16T10:00:00Z',endTime:'2026-11-16T22:30:00Z',closedBy:'Tester',totalRevenue:1000,totalCost:700,totalProfit:230,transfers:[{id:'x',sourceWalletName:'Cash',destination:'خزنة الأرباح',amount:230,currency:'EGP'}],auditSnapshot:{schemaVersion:1,capturedAt:'2026-11-16T22:30:00Z',mainBalanceBefore:0,mainBalanceAfter:700,walletsBefore:[{id:'cash',name:'Saved wallet',balance:1000}],walletsAfter:[{id:'cash',name:'Saved wallet',balance:0}],tickets:[{id:'ticket-saved',ticketNumber:'SAVED-TICKET',netProfit:230}],walletTransactions:[],safeTransactions:[],closingWalletTransactions:[],closingSafeTransactions:[],expenses:[],debts:[],withdrawals:[],auditLogs:[],inventoryBonds:[],financialState:{}}}];
 await mount(h(ShiftHistory));await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('سجل تصفية')).click());await tick();
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='عرض الوردية').click());assert(document.body.textContent.includes('SAVED-TICKET'));assert(document.body.textContent.includes('Saved wallet'));assert(document.body.textContent.includes('خزنة الأرباح'));await unmount();
 console.log('PASS: delayed session+profile+hydration, transient failure/retry without signout, signout race, selected action ID/doubleclick lock, saved shift detail view.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
