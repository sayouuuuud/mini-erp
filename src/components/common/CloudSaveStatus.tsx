import React, {useEffect,useState} from 'react';
import {eventBus} from '../../services/eventBus';
export const CloudSaveStatus:React.FC=()=>{
  const [status,setStatus]=useState(''); const [failed,setFailed]=useState(false);
  useEffect(()=>{
    const remove=[
      eventBus.subscribe('STORAGE_SAVING',()=>{setFailed(false);setStatus('جارٍ تأكيد الحفظ…');}),
      eventBus.subscribe('STORAGE_SAVED',()=>{setFailed(false);setStatus('');}),
      eventBus.subscribe('STORAGE_ERROR',(payload:any)=>{setFailed(true);setStatus(payload?.error?.message || 'تعذر تأكيد الحفظ. راجع آخر عملية.');})
    ]; return()=>remove.forEach(fn=>fn());
  },[]);
  if(!status)return null;
  return <div role={failed?'alert':'status'} className={`fixed bottom-4 left-4 z-[99999] max-w-lg rounded-xl p-3 text-sm shadow-lg ${failed?'bg-rose-700 text-white':'bg-zinc-800 text-white'}`} dir="rtl">{status}</div>;
};
