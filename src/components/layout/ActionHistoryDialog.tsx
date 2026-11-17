import React,{useEffect,useState} from 'react';
import {Modal} from '../common/Modal';
import {useHistory} from '../../context/HistoryContext';
export function ActionHistoryDialog({mode,onClose}:{mode:'undo'|'redo'|null;onClose:()=>void}){
 const {actions,busy,refresh,undo,redo}=useHistory();const [error,setError]=useState('');
 useEffect(()=>{if(mode){setError('');void refresh().catch(e=>setError(e.message));}},[mode,refresh]);
 const list=actions.filter(a=>a.state===(mode==='undo'?'applied':'undone'));
 return <Modal isOpen={!!mode} onClose={()=>{if(!busy)onClose();}} title={mode==='undo'?'اختار الإجراء اللي عايز تتراجع عنه':'اختار الإجراء اللي عايز تعيده'} maxWidth="2xl">
  <div dir="rtl" className="space-y-3"><p className="text-sm text-zinc-500">آخر 10 إجراءات محفوظة لحسابك، بما فيها الإجراءات التي تم التراجع عنها. يُنفَّذ الإجراء المختار فقط، بعد التحقق من عدم تغيّر بياناته.</p>
   {error&&<p role="alert">{error}</p>}
   {!error&&!list.length&&<p>لا توجد إجراءات متاحة في هذه القائمة.</p>}
   {list.map(a=><div key={a.id} className="border border-zinc-500/30 rounded-xl p-3 flex gap-3 justify-between items-center">
    <div><p className="font-bold">{a.description}</p><time className="text-xs text-zinc-500">{new Date(a.timestamp).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'})}</time>{a.blockedReason&&<p className="text-xs text-amber-600">{a.blockedReason}</p>}</div>
    <button disabled={busy||!!a.blockedReason} className="bg-orange-500 text-white rounded-lg p-2 disabled:opacity-40" onClick={()=>{void(mode==='undo'?undo(a.id):redo(a.id));}}>{busy?'جارٍ التنفيذ…':mode==='undo'?'تراجع عن ده':'إعادة ده'}</button>
   </div>)}
  </div>
 </Modal>;
}