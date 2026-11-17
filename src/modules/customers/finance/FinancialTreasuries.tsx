import {ShiftHistory} from '../../finance/ShiftHistory';
import React,{useMemo,useState,useRef,useEffect} from 'react';
import {db} from '../../../database/db';
import {useAuth} from '../../../context/AuthContext';
import {useNotifications} from '../../../context/NotificationContext';
import {formatCurrency,formatDateTime} from '../../../utils/formatters';
import type {StoreWallet} from '../../../types/topup.types';
import {Modal} from '../../../components/common/Modal';
import {Button} from '../../../components/common/Button';
import {Input} from '../../../components/common/Input';

export function FinancialTreasuries({revision,onChanged}:{revision:number;onChanged:()=>void}) {
  const {user}=useAuth();const {showToast}=useNotifications();
  const [liveRevision,setLiveRevision]=useState(0);
  useEffect(()=>{const refresh=()=>setLiveRevision(v=>v+1);window.addEventListener('storage',refresh);return()=>window.removeEventListener('storage',refresh);},[]);
  const treasuries=useMemo(()=>db.getFinancialTreasuries(),[revision,liveRevision]);
  const [selected,setSelected]=useState<StoreWallet|null>(null);const [amount,setAmount]=useState('');const [notes,setNotes]=useState('');const [saving,setSaving]=useState(false);const lock=useRef(false);
  const total=useMemo(()=>db.getMainVaultSummary().balanceEGP+treasuries.reduce((s,t)=>s+t.balance,0)+db.getStoreWallets().filter(w=>w.type==='operating'&&!w.isSystemWallet&&w.currency==='EGP').reduce((s,w)=>s+w.balance,0),[revision,liveRevision,treasuries]);
  const rows=selected?db.getStoreWalletTransactions(selected.id).slice(0,20):[];
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();if(lock.current||!selected)return;lock.current=true;setSaving(true);
    try{
      await db.flushFinancialChanges();
      const result=db.transferTreasuryFunds(selected.id,Number(amount),'TREASURY-'+crypto.randomUUID(),{id:user?.id||'',name:user?.fullName||'',role:user?.role||''},notes);
      if(!result.success)throw new Error(result.message);
      await db.flushFinancialChanges();showToast('success','تم التحويل',result.message);setAmount('');onChanged();setSelected(db.getFinancialTreasuries().find(t=>t.id===selected.id)||null);
    }catch(e){showToast('error','لم يكتمل التحويل',(e as Error).message);onChanged();}finally{lock.current=false;setSaving(false);}
  };
  return <section className="space-y-3" aria-label="الخزن المالية المنفصلة">
    <ShiftHistory/>
    <div className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5">
      <h3 className="font-bold">الخزن المالية المنفصلة</h3>
      <p className="text-xs text-zinc-500 mt-1">تصفية الوردية تنقل تكلفة البضاعة للرئيسية، وباقي النقد لكل خزنة مختصة. الرصيد هنا نقد ممول فعليًا. تحويل الأمانات للرئيسية يغيّر مكان النقد وتظل حقوق العملاء مستحقة.</p>
      <p className="text-sm mt-2">إجمالي النقد بالجنيه — الرئيسية والخزن والاستقبال: <strong>{formatCurrency(total)}</strong></p>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">{treasuries.map(t=><div key={t.id} className="p-4 rounded-2xl border border-purple-500/30 bg-purple-500/5 space-y-2">
      <h4 className="text-sm font-bold">{t.name}</h4><strong className="text-xl block font-mono">{formatCurrency(t.balance)}</strong><p className="text-xs text-zinc-500">النقد المتاح في هذه الخزنة</p>
      <Button variant="outline" size="sm" onClick={()=>{setSelected(t);setAmount('');setNotes('');}}>فتح الخزنة والتحويل للرئيسية</Button>
    </div>)}</div>
    <Modal isOpen={!!selected} onClose={()=>{if(!saving)setSelected(null);}} title={selected?.name||'الخزنة'} subtitle="تحويل جزء من النقد أو كله إلى الخزنة الرئيسية" maxWidth="xl">
      {selected&&<div className="space-y-4"><p>النقد المتاح: <strong>{formatCurrency(db.getFinancialTreasuries().find(t=>t.id===selected.id)?.balance||0)}</strong></p>
        {['admin','owner'].includes(user?.role||'')&&<form onSubmit={submit} className="space-y-3">
          <Input label="المبلغ المراد تحويله للرئيسية" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/>
          <Input label="ملاحظة التحويل" value={notes} onChange={e=>setNotes(e.target.value)}/>
          <Button type="submit" disabled={saving||!Number.isFinite(Number(amount))||Number(amount)<=0}>{saving?'جارٍ حفظ التحويل...':'تأكيد التحويل للرئيسية'}</Button>
        </form>}
        <h4 className="font-bold text-sm">سجل الخزنة</h4><table className="w-full text-right text-xs"><thead><tr><th>التاريخ</th><th>البيان</th><th>المبلغ</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td className="p-2">{formatDateTime(r.createdAt)}</td><td>{r.description}</td><td>{['deposit','transfer_in'].includes(r.type)?'+':'−'}{formatCurrency(r.amount)}</td></tr>)}</tbody></table>
      </div>}
    </Modal>
  </section>;
}
