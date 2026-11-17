// Ephemeral delivery probe. Does not change wallets, tickets, or financial balances.
import { supabase } from '../src/lib/supabase';
const key = `realtime_probe_${Date.now()}`;
let timer: ReturnType<typeof setTimeout>;
const delivery = new Promise<void>((resolve,reject) => {
  timer = setTimeout(()=>reject(new Error('Realtime delivery timeout')),20000);
  supabase.channel(key).on('postgres_changes',{event:'INSERT',schema:'public',table:'system_kv',filter:`key=eq.${key}`},()=>resolve())
    .subscribe(async status => {
      if(status==='SUBSCRIBED'){
        console.log('SUBSCRIBED');
        const {error}=await supabase.from('system_kv').insert({key,value:{probe:true},updated_at:new Date().toISOString()});
        if(error)reject(error);
      }
      if(status==='CHANNEL_ERROR')reject(new Error('Realtime channel error'));
    });
});
try { await delivery;console.log('PASS: real Postgres INSERT reached the subscribed client without refreshing.'); }
finally {clearTimeout(timer!);await supabase.from('system_kv').delete().eq('key',key);await supabase.removeAllChannels();}
