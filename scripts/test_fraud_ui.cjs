const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://erp.test'});delete global.navigator;
Object.assign(global,{window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,IS_REACT_ACT_ENVIRONMENT:true});
window.scrollTo=()=>{};
let resolveSave,closed=0,updated=0;const toasts=[];
global.__fraudUI={user:{id:'owner',role:'admin',fullName:'Owner'},toast:(...args)=>toasts.push(args),db:{getStoreWallets:()=>[{id:'cash',type:'operating',balance:1254}],markTicketFraud:()=>new Promise(r=>resolveSave=r)}};
(async()=>{
const build=await esbuild.build({stdin:{contents:"export {TicketProblemModal} from './src/modules/tickets/TicketProblemModal';export {default as React,act} from 'react';export {createRoot} from 'react-dom/client';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',plugins:[{name:'isolated-ui',setup(b){
 b.onResolve({filter:/database\/db$/},()=>({path:'db',namespace:'mock'}));b.onResolve({filter:/context\/AuthContext$/},()=>({path:'auth',namespace:'mock'}));b.onResolve({filter:/context\/NotificationContext$/},()=>({path:'notify',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:{db:'export const db=global.__fraudUI.db;',auth:'export const useAuth=()=>({user:global.__fraudUI.user});',notify:'export const useNotifications=()=>({showToast:global.__fraudUI.toast});'}[a.path]}));
}}]});
const Module=require('node:module');const mod=new Module(path.resolve('fraud-ui.bundle.cjs'),module);mod.filename=path.resolve('fraud-ui.bundle.cjs');mod.paths=module.paths;mod._compile(build.outputFiles[0].text,mod.filename);
const {TicketProblemModal,React:R,act,createRoot}=mod.exports;let root=createRoot(document.getElementById('root'));
const ticket={id:'QA',ticketNumber:'QA',status:'completed',totalCostAmount:1084.50,receivedAmount:1254,customerName:'QA',fraudDetails:{reason:'إيصال مزيف'}};
const props={isOpen:true,ticket,initialTab:'fraud',onClose:()=>closed++,onUpdated:()=>updated++};
await act(async()=>root.render(R.createElement(TicketProblemModal,props)));
assert(document.body.textContent.includes('دون خصم إضافي'));assert(!document.body.textContent.includes('خصم تكلفة المنتج'));
await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
assert.equal(closed,0);assert.equal(updated,0);assert.equal(toasts.length,0);assert([...document.querySelectorAll('button')].some(b=>b.disabled));
await act(async()=>resolveSave({success:true,message:'saved'}));assert.equal(closed,1);assert.equal(updated,1);assert.equal(toasts[0][0],'success');
await act(async()=>root.render(R.createElement(TicketProblemModal,{...props,ticket:{...ticket,status:'fraud'}})));
assert(document.body.textContent.includes('لا يوجد تحصيل حقيقي'));assert(![...document.querySelectorAll('button')].some(b=>b.textContent.includes('استرداد تذكرة الاحتيال')));
await act(async()=>root.unmount());console.log('PASS: fraud UI states delivered stock stays deducted, waits for server acknowledgement before success/close, disables submit while saving, offers no fictitious refund');process.exit(0);
})().catch(e=>{console.error(e);process.exitCode=1});
