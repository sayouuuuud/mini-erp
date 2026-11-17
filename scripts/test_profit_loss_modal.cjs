// Real React DOM modal test; DB/Auth are isolated test boundaries.
// Requires jsdom (or ERP_JSDOM_MODULE pointing to an installed copy).
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const esbuild=require('esbuild');const {JSDOM}=require(process.env.ERP_JSDOM_MODULE||'jsdom');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profit-loss-modal-'));
 const root=path.resolve(__dirname,'..');
 const entry=`import React from 'react'; import {createRoot} from 'react-dom/client'; import {ZeroProfitWalletModal} from './src/modules/tickets/ZeroProfitWalletModal';
 window.__calls=[];window.__toasts=[];window.__closed=0;
 window.__db={getStoreWallets:()=>[],settleProfitLoss:(...args)=>{window.__calls.push({kind:'loss',args});return {success:true}},transferSystemProfits:(...args)=>{window.__calls.push({kind:'transfer',args});return {success:true}},logAction:(...args)=>{window.__calls.push({kind:'audit',args})},flushFinancialChanges:async()=>{window.__calls.push({kind:'flush'})}};
 const root=createRoot(document.getElementById('root'));window.renderBalance=(balance)=>root.render(React.createElement(ZeroProfitWalletModal,{key:balance,isOpen:true,onClose:()=>window.__closed++,currentBalance:balance}));window.renderBalance(-50.69);`;
 await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',outfile:path.join(dir,'app.js'),plugins:[{name:'isolated-boundaries',setup(b){
  b.onResolve({filter:/\/database\/db$/},()=>({path:'db',namespace:'test'}));b.onResolve({filter:/\/context\/AuthContext$/},()=>({path:'auth',namespace:'test'}));b.onResolve({filter:/\/context\/NotificationContext$/},()=>({path:'toast',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='db'?`export const db=new Proxy({}, {get:(_,key)=>(...args)=>window.__db[key](...args)});`:a.path==='auth'?`export const useAuth=()=>({user:{id:'qa',fullName:'QA',role:'admin'}});`:`export const useNotifications=()=>({showToast:(...a)=>window.__toasts.push(a)});`,loader:'js'}));
 }}]});
 const dom=new JSDOM('<html dir="rtl"><body><div id="root"></div></body></html>',{runScripts:'dangerously',pretendToBeVisual:true,url:'https://test.invalid'});
 const w=dom.window;w.scrollTo=()=>{};
 const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('DOM did not reach expected state');};
 const amount=()=>w.document.querySelector('input[inputmode=decimal]'),submit=()=>w.document.querySelector('button[type=submit]');
 const fill=async(value)=>{Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(amount(),value);amount().dispatchEvent(new w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,30));};
 try{
  w.eval(fs.readFileSync(path.join(dir,'app.js'),'utf8'));
  await wait(()=>w.document.querySelector('select')?.value==='loss_settlement');assert.equal(amount().value,'50.69');assert.equal(submit().disabled,false);assert.match(submit().textContent,/تسوية الخسارة/);
  await fill('50');assert.equal(submit().disabled,true);await fill('50.69');assert.equal(submit().disabled,false);submit().click();
  await wait(()=>w.__closed===1);let calls=w.__calls;assert.equal(calls.filter(c=>c.kind==='loss').length,1);assert.equal(calls.some(c=>c.kind==='transfer'),false);assert.equal(calls.find(c=>c.kind==='loss').args[0],50.69);assert.equal(calls.at(-1).kind,'flush');
  w.renderBalance(25);await wait(()=>amount()?.value==='25');assert.equal(w.document.querySelector('select').value,'vault_main');assert.equal(submit().disabled,false);submit().click();await wait(()=>w.__closed===2);
  calls=w.__calls;assert.equal(calls.filter(c=>c.kind==='transfer').length,1);assert.equal(calls.find(c=>c.kind==='transfer').args[0],25);
  w.renderBalance(0);await wait(()=>amount()?.value==='');assert.equal(submit().disabled,true);
  console.log('PASS: negative balance prefills 50.69 and selects loss settlement; exact manual amount submits loss only and awaits flush; partial disabled; positive transfer preserved; zero disabled.');
 }finally{w.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
