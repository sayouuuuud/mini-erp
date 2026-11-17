import { isRemovedSection } from '../config/sections';
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { User, Department, Permission } from '../types/auth.types';
import { supabase } from '../lib/supabase';
import { supabaseStorage } from '../database/supabaseStorage';
import { authenticate, verifiedUser } from '../services/authService';

interface AuthContextType {
  isRestoring:boolean; restoreError:string; retryRestore:()=>void; user: User | null; isAuthenticated: boolean; selectedDepartment: Department | 'all' | null;
  loginAsAdmin: (password:string)=>Promise<boolean>;
  loginAsEmployee: (department:Department,username:string,password:string)=>Promise<{success:boolean;message?:string}>;
  logout: ()=>Promise<void>;
  hasPermission:(permission:Permission)=>boolean; canAccessDepartment:(department:Department)=>boolean;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export const AuthProvider:React.FC<{children:React.ReactNode}>=({children})=>{
  const [isRestoring,setRestoring]=useState(true);
  const [restoreError,setRestoreError]=useState('');
  const [restoreAttempt,setRestoreAttempt]=useState(0);
  const generation=useRef(0);
  const [user,setUser]=useState<User|null>(null);
  const [selectedDepartment,setDepartment]=useState<Department|'all'|null>(null);
  const accept = async (profile:User & {_testScope?:string}, department?:Department) => {
    supabaseStorage.setTestScope(profile._testScope || '');
    await supabaseStorage.resetAndHydrate();
    setUser(profile);setDepartment(department || (profile.role==='admin'?'all':profile.department || null));
  };
  useEffect(()=>{
    let alive=true;const token=++generation.current;
    setRestoring(true);setRestoreError('');
    const restore=async()=>{
      try{
        const {data,error}=await supabase.auth.getSession();
        if(error)throw error;
        if(!data.session)return;
        const profile=await verifiedUser();
        if(!alive||token!==generation.current)return;
        if(!profile){await supabase.auth.signOut();return;}
        supabaseStorage.setTestScope(profile._testScope||'');
        await supabaseStorage.resetAndHydrate();
        if(alive&&token===generation.current){setUser(profile);setDepartment(profile.role==='admin'?'all':profile.department||null);}
      }catch{if(alive&&token===generation.current)setRestoreError('تعذر استعادة الجلسة أو تحميل البيانات. تحقق من الاتصال وحاول مرة أخرى.');}
      finally{if(alive&&token===generation.current)setRestoring(false);}
    };
    void restore();
    const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{
      if(event==='SIGNED_OUT'){generation.current++;supabaseStorage.clearSession();setUser(null);setDepartment(null);setRestoreError('');setRestoring(false);}
    });
    return()=>{alive=false;subscription.unsubscribe();};
  },[restoreAttempt]);
  const loginAsAdmin=async(password:string)=>{
    try{
      const profile=await authenticate('admin',password);
      if(!profile || profile.role!=='admin'){await supabase.auth.signOut();return false;}
      await accept(profile);return true;
    }catch{await supabase.auth.signOut();return false;}
  };
  const loginAsEmployee=async(department:Department,username:string,password:string)=>{
    if(isRemovedSection(department))return {success:false,message:'هذا القسم لم يعد متاحاً'};
    try{
      const profile=await authenticate(username,password);
      if(!profile || (profile.role!=='admin' && profile.department!==department)){
        await supabase.auth.signOut();return {success:false,message:'بيانات الدخول غير صحيحة أو الحساب غير مخصص لهذا القسم'};
      }
      await accept(profile,department);return {success:true};
    }catch{return {success:false,message:'تعذر تحميل البيانات، حاول مرة أخرى'};}
  };
  const logout=async()=>{try{await supabaseStorage.flush();}catch{/* sync failure already visible */}await supabase.auth.signOut();supabaseStorage.clearSession();setUser(null);setDepartment(null);};
  return <AuthContext.Provider value={{isRestoring,restoreError,retryRestore:()=>setRestoreAttempt(n=>n+1),user,isAuthenticated:!!user,selectedDepartment,loginAsAdmin,loginAsEmployee,logout,
    hasPermission:p=>!!user && (user.role==='admin'||user.permissions?.includes(p)),
    canAccessDepartment:d=>!!user && (user.role==='admin'||user.department===d)}}>{children}</AuthContext.Provider>;
};
export const useAuth=():AuthContextType=>{const value=useContext(AuthContext);if(!value)throw new Error('useAuth must be used within AuthProvider');return value;};
