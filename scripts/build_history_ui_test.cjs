const fs=require('fs'),path=require('path'),esbuild=require('esbuild');
(async()=>{await esbuild.build({stdin:{contents:"export {AuthProvider,useAuth} from './src/context/AuthContext';export {HistoryProvider,useHistory} from './src/context/HistoryContext';export {ActionHistoryDialog} from './src/components/layout/ActionHistoryDialog';export {ShiftHistory} from './src/modules/finance/ShiftHistory';export {default as React,act} from 'react';export {createRoot} from 'react-dom/client';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'cjs',outfile:'/vercel/sandbox/ui-tests/bundle.cjs',plugins:[{name:'test-only-adapters',setup(b){
 b.onResolve({filter:/lib\/supabase$/},()=>({path:'api',namespace:'mock'}));
 b.onResolve({filter:/database\/supabaseStorage$/},()=>({path:'storage',namespace:'mock'}));
 b.onResolve({filter:/context\/NotificationContext$/},()=>({path:'notifications',namespace:'mock'}));
 b.onResolve({filter:/\.\/NotificationContext$/},()=>({path:'notifications',namespace:'mock'}));
 b.onResolve({filter:/database\/db$/},()=>({path:'db',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'js',contents:({
 api:'export const supabase=global.__test.api;',
 storage:'export const supabaseStorage=global.__test.storage;',
 notifications:'export const useNotifications=()=>({showToast:global.__test.toast});',
 db:'export const db={getShiftSettlements:()=>global.__test.shifts};'
 })[a.path]}));
}}]});})();