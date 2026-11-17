import { supabase } from '../lib/supabase';
import type { User } from '../types/auth.types';

export async function loginEmail(username: string): Promise<string> {
  const bytes = new TextEncoder().encode(username.trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')+'@erp.ammar.invalid';
}

export async function verifiedUser(): Promise<(User & {_testScope?:string}) | null> {
  const { data, error } = await supabase.rpc('erp_current_user');
  if (error) throw new Error(error.message || 'تعذر التحقق من الجلسة');
  if (!data?.isActive) return null;
  return data;
}

export async function authenticate(username: string,password: string) {
  const { error } = await supabase.auth.signInWithPassword({email:await loginEmail(username),password});
  if (error) return null;
  return verifiedUser();
}

// Reauthentication always uses the signed-in identity, never a cached password or
// a demo fallback. Do not switch to the first admin record in a user list.
export async function reauthenticateCurrentUser(password: string): Promise<void> {
  const current = await supabase.auth.getUser();
  if (current.error || !current.data.user?.email || !password) throw new Error('تعذر التحقق من حسابك الحالي');
  const result = await supabase.auth.signInWithPassword({email: current.data.user.email, password});
  if (result.error || result.data.user?.id !== current.data.user.id) throw new Error('كلمة المرور الحالية غير صحيحة');
  const actor = await verifiedUser();
  if (!actor || actor.role !== 'admin') throw new Error('هذه العملية متاحة لحساب المدير فقط');
}

export async function changeCurrentPassword(currentPassword: string, newPassword: string): Promise<void> {
  await reauthenticateCurrentUser(currentPassword);
  const {error} = await supabase.auth.updateUser({password: newPassword});
  if (error) throw new Error('لم يتم تغيير كلمة المرور؛ راجع متطلبات كلمة المرور وأعد المحاولة');
}
