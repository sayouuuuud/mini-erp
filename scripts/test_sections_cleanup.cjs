// Isolated component test: no API or database connections.
const esbuild = require('esbuild');
const path = require('node:path');
(async () => {
  const result = await esbuild.build({
    stdin: { contents: `
      import React from 'react';
      import {renderToStaticMarkup} from 'react-dom/server';
      import {TabsProvider, useTabs} from './src/context/TabsContext';
      import {Sidebar} from './src/components/layout/Sidebar';
      import {TabsReorderModal} from './src/components/common/TabsReorderModal';
      import {isRemovedSection} from './src/config/sections';
      import {workspaceService} from './src/services/workspaceService';
      import assert from 'node:assert/strict';
      const storage = new Map();
      globalThis.localStorage = {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
      const retired = ['dealers','dealer_dashboard','dealer_tickets','dealer_catalog','dealer_coupons','dealer_competitions','dealer_finance','dealer_reports','dealer_settings','dealer_123','brokerage','middleman','middleman_dashboard','middleman_deals','middleman_accounts','middleman_sell','middleman_clients','middleman_reports','middleman_settings','subscriptions','subscriptions_dashboard','subscriptions_list','subscriptions_clients','subscriptions_plans','subscriptions_payments','subscriptions_notifications','subscriptions_reports','subscriptions_settings','competitions'];
      retired.forEach(s=>assert(isRemovedSection(s),s));
      ['dashboard','customer_dashboard','customers','tickets','catalog','coupons','reports','customer_finance','customer_settings','finance','finance_wallets','merchants','settings'].forEach(s=>assert(!isRemovedSection(s),s));
      storage.set('nzm_jkr_active_tabs',JSON.stringify([{id:'dashboard',section:'dashboard',title:'Home'},...retired.map(s=>({id:s,section:s,title:s}))]));
      storage.set('nzm_jkr_active_tab_id','subscriptions_list');
      let state;
      function Probe(){state=useTabs();return null;}
      renderToStaticMarkup(<TabsProvider><Probe/></TabsProvider>);
      assert.deepEqual(state.tabs.map(t=>t.section),['dashboard']);assert.equal(state.activeTabId,'dashboard');
      storage.set('nzm_jkr_active_tabs',JSON.stringify([{id:'dealer_1',section:'dealers'}]));
      renderToStaticMarkup(<TabsProvider><Probe/></TabsProvider>);assert.equal(state.activeTab.section,'dashboard');
      storage.set('nzm_jkr_ws_test',JSON.stringify({kpiCards:[{id:'retired',targetSection:'middleman_dashboard'}]}));
      assert(workspaceService.getWorkspace('test').kpiCards.every(c=>c.id!=='retired'));
      const sidebar=renderToStaticMarkup(<Sidebar activeSection="dashboard" onNavigate={()=>{}} isCollapsed={false} onToggleCollapse={()=>{}}/>);
      assert(sidebar.includes('8 أقسام'));assert(sidebar.includes('قسم الزبائن والشحن'));assert(sidebar.includes('المالية والخزينة'));
      const reorder=renderToStaticMarkup(<TabsReorderModal isOpen onClose={()=>{}}/>);
      for(const html of [sidebar,reorder]) assert(!/قسم التجار|قسم الوساطة|قسم الاشتراكات|المسابقات والمكافآت/.test(html));
      console.log('PASS: retired routes blocked, retained routes available, saved tabs migrated, empty restore falls back to dashboard, old KPI filtered, sidebar and reorder modal cleaned.');
    `, resolveDir: process.cwd(), loader: 'tsx'},
    bundle:true,platform:'node',format:'cjs',write:false,
    plugins:[{name:'isolated-contexts',setup(build){
      build.onResolve({filter:/context\/(AuthContext|LayoutOrderContext|NotificationContext)$/},args=>({path:args.path.split('/').pop(),namespace:'stub'}));
      build.onResolve({filter:/common\/Modal$|^\.\/Modal$/},()=>({path:'Modal',namespace:'stub'}));
      build.onResolve({filter:/database\/db$/},()=>({path:'db',namespace:'stub'}));
      build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:({
        AuthContext:"export const useAuth=()=>({user:{role:'admin'},canAccessDepartment:()=>true});",
        LayoutOrderContext:"export const useLayoutOrder=()=>({orders:{},canReorder:false,getOrderedItems:(_,items)=>items,moveItemUp:()=>{},moveItemDown:()=>{},resetContainerOrder:()=>{},resetAllOrders:()=>{},setActiveDragItem:()=>{},setDragOverInfo:()=>{}});",
        NotificationContext:"export const useNotifications=()=>({showToast:()=>{}});",
        Modal:"import React from 'react';export const Modal=({isOpen,children})=>isOpen?React.createElement('div',null,children):null;",
        db:"export const db={};"
      })[args.path],resolveDir:process.cwd()}));
    }}]
  });
  const Module = require('node:module');const m=new Module(path.resolve('test-cleanup.bundle.cjs'),module);m.filename=path.resolve('test-cleanup.bundle.cjs');m.paths=module.paths;m._compile(result.outputFiles[0].text,m.filename);
})().catch(e=>{console.error(e);process.exitCode=1;});
