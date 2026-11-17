import React,{createContext,useContext,useState,useCallback,useEffect,useRef} from 'react';
import {supabase} from '../lib/supabase';
import {supabaseStorage} from '../database/supabaseStorage';
import {useAuth} from './AuthContext';
import {useNotifications} from './NotificationContext';
import {eventBus} from '../services/eventBus';
export interface SavedAction {id:string;description:string;timestamp:string;state:'applied'|'undone';blockedReason?:string}
interface HistoryContextType {
 canUndo:boolean;canRedo:boolean;busy:boolean;actions:SavedAction[];
 pushAction:(description:string,undo:()=>void|Promise<void>,redo:()=>void|Promise<void>)=>void;
 undo:(id?:string)=>Promise<void>;redo:(id?:string)=>Promise<void>;refresh:()=>Promise<void>;
 lastActionDescription?:string;nextActionDescription?:string;clearHistory:()=>void;
}
const HistoryContext=createContext<HistoryContextType|undefined>(undefined);
export const HistoryProvider:React.FC<{children:React.ReactNode}>=({children})=>{
 const {user}=useAuth();const {showToast}=useNotifications();
 const [actions,setActions]=useState<SavedAction[]>([]);const [busy,setBusy]=useState(false);
 const lock=useRef(false);const identity=useRef(user?.id);identity.current=user?.id;
 const refresh=useCallback(async()=>{
  const owner=user?.id;if(!owner){setActions([]);return;}
  const {data,error}=await supabase.rpc('erp_action_history');
  if(error)throw new Error('تعذر تحميل سجل الإجراءات؛ حاول مرة أخرى');
  if(identity.current===owner)setActions((data||[]).slice(0,10));
 },[user?.id]);
 useEffect(()=>{
  setActions([]);if(!user)return;
  const reload=()=>{void refresh().catch(()=>{});};reload();
  return eventBus.subscribe('STORAGE_SAVED',reload);
 },[refresh,user?.id]);
 const replay=useCallback(async(direction:'undo'|'redo',id?:string)=>{
  if(lock.current)return;
  const action=actions.find(a=>a.id===id)||(id?undefined:actions.find(a=>a.state===(direction==='undo'?'applied':'undone')&&!a.blockedReason));
  if(!action)return;
  lock.current=true;setBusy(true);
  try{
   await supabaseStorage.withMaintenance(async()=>{
    const operationId=crypto.randomUUID();
    const send=()=>supabase.rpc('erp_replay_action',{p_action_id:action.id,p_direction:direction,p_operation_id:operationId});
    let response=await send();
    if(response.error&&(!response.error.code||response.error.code==='FETCH_ERROR'))response=await send();
    if(response.error)throw new Error(response.error.code==='PT409'?'الإجراء مرتبط ببيانات تغيّرت بعده، أو بتسوية مقفولة. لم يتم تغيير أي بيانات.':response.error.message||'تعذر تنفيذ الإجراء');
    await supabaseStorage.resetAndHydrate();
   });
   await refresh();window.dispatchEvent(new Event('storage'));
   showToast('success',direction==='undo'?'تم التراجع عن الإجراء المختار':'تمت إعادة الإجراء المختار',action.description);
  }catch(e){showToast('error','لم يكتمل الإجراء',(e as Error).message);await refresh().catch(()=>{});}
  finally{lock.current=false;setBusy(false);}
 },[actions,refresh,showToast]);
 // Server acknowledgment records history; legacy closure callbacks must not
 // restore entire stale collections or record the same operation twice.
 const pushAction=useCallback((_d:string,_u:()=>void|Promise<void>,_r:()=>void|Promise<void>)=>{},[]);
 return <HistoryContext.Provider value={{actions,busy,refresh,pushAction,
  undo:id=>replay('undo',id),redo:id=>replay('redo',id),
  canUndo:!busy&&actions.some(a=>a.state==='applied'&&!a.blockedReason),
  canRedo:!busy&&actions.some(a=>a.state==='undone'&&!a.blockedReason),
  lastActionDescription:actions.find(a=>a.state==='applied')?.description,
  nextActionDescription:actions.find(a=>a.state==='undone')?.description,
  clearHistory:()=>setActions([])}}>{children}</HistoryContext.Provider>;
};
export const useHistory=()=>{const c=useContext(HistoryContext);if(!c)throw new Error('useHistory must be used within a HistoryProvider');return c;};
export const recordUndoableAction=(_d:string,_u:()=>void|Promise<void>,_r:()=>void|Promise<void>)=>{};
