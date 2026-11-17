// src/database/supabaseStorage.ts
// Reactive In-Memory Supabase Storage Adapter for Ammar ERP
// High performance: 0ms synchronous reads, asynchronous persistence to Supabase PostgreSQL 17,
// realtime sync across clients, and zero dependence on legacy browser localStorage.

import { supabase } from '../lib/supabase';
import { eventBus } from '../services/eventBus';

export const KEY_TO_TABLE_MAP: Record<string, string> = {
  'nzm_jkr_users': 'users',
  'nzm_jkr_customers': 'customers',
  'nzm_jkr_dealers': 'dealers',
  'nzm_jkr_merchants': 'merchants',
  'nzm_jkr_tickets': 'tickets',
  'nzm_jkr_dealer_tickets': 'dealer_tickets',
  'nzm_jkr_store_wallets': 'store_wallets',
  'nzm_jkr_store_wallet_transactions': 'store_wallet_transactions',
  'nzm_jkr_dealer_wallets': 'dealer_wallets',
  'nzm_jkr_dealer_wallet_tx': 'dealer_wallet_transactions',
  'nzm_jkr_deposit_bonds_fifo': 'deposit_bonds_fifo',
  'nzm_jkr_safe_tx': 'safe_transactions',
  'nzm_jkr_dealer_safe_tx': 'dealer_safe_transactions',
  'nzm_jkr_expenses': 'expenses',
  'nzm_jkr_dealer_expenses': 'dealer_expenses',
  'nzm_jkr_debts': 'debts',
  'nzm_jkr_dealer_debts': 'dealer_debts',
  'nzm_jkr_settlements': 'shift_settlements',
  'nzm_jkr_dealer_settlements': 'dealer_settlements',
  'nzm_jkr_daily_closures': 'daily_closures',
  'nzm_jkr_dealer_daily_closures': 'dealer_daily_closures',
  'nzm_jkr_employees': 'employees',
  'nzm_jkr_dealer_employees': 'dealer_employees',
  'nzm_jkr_attendance': 'attendance',
  'nzm_jkr_dealer_attendance': 'dealer_attendance',
  'nzm_jkr_salaries': 'salaries',
  'nzm_jkr_dealer_salaries': 'dealer_salaries',
  'nzm_jkr_audit_logs': 'audit_logs',
  'nzm_jkr_notifications': 'notifications',
  'nzm_jkr_coupons': 'coupons',
  'nzm_jkr_merchant_invoices': 'merchant_invoices',
  'nzm_jkr_merchant_transactions': 'merchant_transactions',
  'nzm_jkr_merchant_reminders': 'merchant_reminders',
  'nzm_jkr_merchant_product_rules': 'merchant_product_rules',
  'nzm_jkr_merchant_notes': 'merchant_notes',
  'nzm_jkr_merchant_files': 'merchant_files',
  'nzm_jkr_notes': 'customer_notes',
  'nzm_jkr_dealer_notes': 'dealer_notes',
  'nzm_jkr_middleman_deals': 'middleman_deals',
  'nzm_jkr_middleman_accounts': 'middleman_accounts',
  'nzm_jkr_middleman_notifications': 'middleman_notifications',
  'nzm_jkr_middleman_followups': 'middleman_followups',
  'nzm_jkr_subscription_plans': 'subscription_plans',
  'nzm_jkr_subscriptions': 'subscriptions',
  'nzm_jkr_subscription_payments': 'subscription_payments',
  'nzm_jkr_subscription_notifications': 'subscription_notifications',
  'nzm_jkr_balance_withdrawals': 'balance_withdrawals',
  'nzm_jkr_dealer_balance_withdrawals': 'dealer_balance_withdrawals',
  'nzm_jkr_competitions': 'competitions',
  'nzm_jkr_competition_participants': 'competition_participants',
  'nzm_jkr_competition_rewards': 'competition_rewards',
  'nzm_jkr_competition_draws': 'competition_draws',
  'nzm_jkr_marketing_campaigns_v1': 'marketing_campaigns'
};

export const UI_STORAGE_KEYS = new Set([
  'nzm_jkr_current_user',
  'nzm_jkr_current_dept',
  'nzm_jkr_theme',
  'nzm_jkr_active_tabs',
  'nzm_jkr_active_tab_id',
  'nzm_jkr_sidebar_groups',
  'nzm_jkr_font_size'
]);

class SupabaseStorageAdapter {
  private cache = new Map<string, any>();
  private syncQueue = new Map<string, any>();
  private isHydrated = false;
  private hydrationPromise: Promise<void> | null = null;
  private localNotificationPending = false;
  private writeChains = new Map<string, Promise<void>>();
  private persistedRecords = new Map<string, Map<string, string>>();
  private pendingWrites = new Set<string>();
  private rowVersions = new Map<string, string>();
  private kvRecords = new Map<string, string>();
  private pendingValues = new Map<string, any>();
  private atomicTimer: ReturnType<typeof setTimeout> | null = null;
  private atomicChain: Promise<void> = Promise.resolve();
  private syncFailure: Error | null = null;
  private testScope = '';
  private sessionGeneration = 0;
  private realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
  private maintenanceActive = false;

  public async withMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    if (this.maintenanceActive) throw new Error('توجد عملية صيانة قيد التنفيذ بالفعل');
    if (!this.isHydrated) throw new Error('انتظر اكتمال تحميل بيانات النظام ثم أعد المحاولة');
    this.maintenanceActive = true;
    try {
      // A previous failed write has already reloaded authoritative state. Maintenance
      // reads a fresh server snapshot, so it can safely start a new operation.
      if (this.syncFailure && !this.pendingValues.size) this.syncFailure = null;
      await this.flush();
      return await operation();
    } finally { this.maintenanceActive = false; }
  }

  public setTestScope(scope: string): void { this.testScope = scope || ''; }

  public async resetAndHydrate(): Promise<void> {
    this.sessionGeneration++;
    if (this.realtimeChannel) { await supabase.removeChannel(this.realtimeChannel); this.realtimeChannel = null; }
    this.cache.clear(); this.persistedRecords.clear(); this.knownIdsByTable.clear(); this.kvRecords.clear();
    this.hydrationPromise = null; this.isHydrated = false;
    await this.hydrateFromSupabase();
  }

  public clearSession(): void {
    this.sessionGeneration++;
    if (this.atomicTimer) clearTimeout(this.atomicTimer);
    this.atomicTimer = null; this.pendingValues.clear(); this.pendingWrites.clear();
    if (this.realtimeChannel) { void supabase.removeChannel(this.realtimeChannel); this.realtimeChannel = null; }
    this.cache.clear(); this.persistedRecords.clear(); this.kvRecords.clear(); this.knownIdsByTable.clear();
    this.isHydrated = false; this.hydrationPromise = null; this.testScope = '';
  }

  public async flush(): Promise<void> {
    if (typeof supabase.rpc !== 'function') return; // isolated legacy transport test double
    if (this.atomicTimer) { clearTimeout(this.atomicTimer); this.atomicTimer = null; }
    this.enqueueAtomicCommit();
    await this.atomicChain;
    if (this.syncFailure) throw this.syncFailure;
  }

  private enqueueAtomicCommit(): void {
    this.atomicChain = this.atomicChain.then(async () => {
      if (!this.pendingValues.size) return;
      const generation = this.sessionGeneration;
      const values = new Map(this.pendingValues); this.pendingValues.clear();
      const changes: Array<{table: string; id: string; exists: boolean; before: any; after: any}> = [];
      const nextCollections = new Map<string, Map<string, string>>();
      const nextKv = new Map<string, string | undefined>();
      for (const [key, value] of values) {
        const table = KEY_TO_TABLE_MAP[key];
        if (table && Array.isArray(value)) {
          const previous = this.persistedRecords.get(table) || new Map<string, string>();
          const next = new Map<string, string>();
          value.forEach((item: any, index: number) => {
            const id = String(item.id || item.code || `${table}_${index+1}`);
            let data = structuredClone(item);
            if ((table === 'store_wallets' || table === 'dealer_wallets') && (data.isSystemWallet || ['w_cashback','w_referrals','w_trust','w_profits','w_operating_expenses','mw_cashback','mw_referrals','mw_debts','mw_profits'].includes(id))) {
              if (previous.has(id)) next.set(id,previous.get(id)!);
              return; // virtual cumulative balances never enter the persistence batch
            }
            if (table === 'store_wallets' || table === 'dealer_wallets') data._erpOrder = index;
            if (this.testScope) data._erpTestScope = this.testScope;
            const serialized = JSON.stringify(data); next.set(id, serialized);
            if (previous.get(id) !== serialized) changes.push({table,id,exists:previous.has(id),before:previous.has(id)?JSON.parse(previous.get(id)!):null,after:data});
          });
          for (const [id, old] of previous) if (!next.has(id)) changes.push({table,id,exists:true,before:JSON.parse(old),after:null});
          nextCollections.set(table,next);
        } else {
          for (const id of [key.replace(/^nzm_jkr_/,''),key]) {
            const previous = this.kvRecords.get(id); const serialized = JSON.stringify(value);
            if (previous !== serialized) changes.push({table:'system_kv',id,exists:this.kvRecords.has(id),before:previous === undefined ? null : JSON.parse(previous),after:value});
            nextKv.set(id,serialized);
          }
        }
      }
      if (!changes.length) {
        for (const key of values.keys()) if (!this.pendingValues.has(key)) this.pendingWrites.delete(key);
        return;
      }
      const operationId = crypto.randomUUID();
      eventBus.publish('STORAGE_SAVING',{operationId});
      try {
        const send = () => supabase.rpc('erp_commit_changes',{p_operation_id:operationId,p_changes:changes});
        let response = await send();
        // Reuse the exact id/payload after ambiguous network failure; never replay with a new id.
        if (response.error && (!response.error.code || response.error.code === 'FETCH_ERROR')) response = await send();
        if (generation !== this.sessionGeneration) return;
        if (response.error) throw Object.assign(new Error(response.error.message || 'تعذر حفظ العملية'),{code:response.error.code});
        for (const [table,records] of nextCollections) {
          if (table === 'users') {
            for (const [id,serialized] of records) {
              const user = JSON.parse(serialized); delete user.password; user.hasPassword = true;
              records.set(id,JSON.stringify(user));
            }
          }
          this.persistedRecords.set(table,records);this.knownIdsByTable.set(table,new Set(records.keys()));
        }
        for (const [key,serialized] of nextKv) if (serialized !== undefined) this.kvRecords.set(key,serialized);
        for (const key of values.keys()) if (!this.pendingValues.has(key)) this.pendingWrites.delete(key);
        for(const record of response.data?.settlements || []) {
          const table='shift_settlements';
          this.persistedRecords.get(table)?.set(record.id,JSON.stringify(record));
          for(const key of ['nzm_jkr_settlements','settlements']) {
            const rows=this.cache.get(key);
            if(Array.isArray(rows))this.cache.set(key,rows.map(r=>r.id===record.id?structuredClone(record):r));
          }
        }
        this.syncFailure = null;
        eventBus.publish('STORAGE_SAVED',{operationId,committedAt:response.data?.committedAt});
      } catch (cause) {
        if (generation !== this.sessionGeneration) return;
        this.pendingValues.clear(); this.pendingWrites.clear();
        if (this.atomicTimer) clearTimeout(this.atomicTimer); this.atomicTimer = null;
        const conflict = ['40001','PT409'].includes((cause as any)?.code) || (cause as Error)?.message === 'erp_conflict';
        const failure = new Error(conflict ? 'حدث تعارض مع جلسة أخرى. لم تُحفظ العملية، وتم تحميل الأرصدة المعتمدة. أعد المحاولة.' : 'لم يكتمل تأكيد الحفظ. تم تحميل البيانات المعتمدة؛ راجع العملية قبل تكرارها.');
        this.syncFailure = failure;
        try { if ((cause as Error)?.message === 'erp_auth_required') await supabase.auth.signOut(); else await this.resetAndHydrate(); } catch { /* original failure remains visible */ }
        eventBus.publish('STORAGE_ERROR',{error:failure,conflict});
      }
    });
  }

  private canonicalKey(key: string): string {
    return key.startsWith('nzm_jkr_') ? key : `nzm_jkr_${key}`;
  }

  private notifyLocalChange(): void {
    if (!this.isHydrated || this.localNotificationPending) return;
    this.localNotificationPending = true;
    queueMicrotask(() => {
      this.localNotificationPending = false;
      eventBus.publish('DATA_SYNCED', { local: true });
    });
  }

  private orderedRows(table: string, rows: any[]): any[] {
    if (table !== 'store_wallets' && table !== 'dealer_wallets') return rows;
    return [...rows].sort((a, b) => {
      const ao = a._erpOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b._erpOrder ?? Number.MAX_SAFE_INTEGER;
      return ao - bo || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id));
    }).map((item, index) => ({ ...item, _erpOrder: item._erpOrder ?? index }));
  }

  private knownIdsByTable = new Map<string, Set<string>>();

  constructor() {
    this.installLocalStorageInterceptor();
    this.startBackgroundHydration();
  }

  // 1. Reactive In-Memory Read (0ms latency)
  public getItem<T>(key: string, defaultValue: T): T {
    if (this.cache.has(key)) {
      const val = this.cache.get(key);
      return val !== undefined && val !== null ? val : defaultValue;
    }

    // Check counterpart key (with or without nzm_jkr_ prefix)
    const altKey = key.startsWith('nzm_jkr_') ? key.replace(/^nzm_jkr_/, '') : `nzm_jkr_${key}`;
    if (this.cache.has(altKey)) {
      const altVal = this.cache.get(altKey);
      if (altVal !== undefined && altVal !== null) {
        this.cache.set(key, altVal);
        return altVal;
      }
    }

    // If not in cache yet, try legacy localStorage (during bootstrap) or defaultValue
    let initialVal = defaultValue;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(key) || window.localStorage.getItem(altKey);
        if (raw && raw !== 'null' && raw !== 'undefined') {
          initialVal = JSON.parse(raw);
        }
      }
    } catch (_) {}

    // CRITICAL: Only cache the fallback value if hydration is already complete.
    // If hydration is still in progress, returning the defaultValue without caching
    // prevents overwriting the real Supabase data that the hydration will populate.
    // Components that call this before hydration will get the defaultValue, but
    // the SUPABASE_HYDRATED event will trigger a re-read once data is available.
    if (this.isHydrated) {
      this.cache.set(key, initialVal);
      this.cache.set(altKey, initialVal);
    }
    return initialVal;
  }

  // 2. Reactive In-Memory Write + Asynchronous Supabase Persistence
  public setItem<T>(key: string, value: T): boolean {
    if (this.maintenanceActive) throw new Error('انتظر انتهاء مسح البيانات أو استعادة النسخة الاحتياطية');
    value = structuredClone(value);
    this.cache.set(key, value);
    const altKey = key.startsWith('nzm_jkr_') ? key.replace(/^nzm_jkr_/, '') : `nzm_jkr_${key}`;
    this.cache.set(altKey, value);

    // CRITICAL GUARD: Do NOT sync to Supabase until hydration is complete.
    // Before hydration, writes are seed/initialization data that should NOT overwrite
    // real cloud data. After hydration completes, the in-memory cache is populated
    // with the authoritative Supabase data, and only then are writes persisted.
    if (!this.isHydrated) {
      return true;
    }

    // Schedule debounced push to Supabase
    this.scheduleSyncToSupabase(key, value);
    this.notifyLocalChange();

    return true;
  }

  public removeItem(key: string): void {
    const canonical = this.canonicalKey(key);
    this.setItem(canonical, KEY_TO_TABLE_MAP[canonical] ? [] : null);
  }

  public isStorageHydrated(): boolean {
    return this.isHydrated;
  }

  public async waitForHydration(): Promise<void> {
    if (this.isHydrated) return;
    if (this.hydrationPromise) {
      await this.hydrationPromise;
    }
  }

  // 3. Clear legacy local database keys completely from browser localStorage
  public clearLegacyLocalStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const toDelete: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && (k.startsWith('nzm_jkr_') || k.startsWith('jkr_'))) {
            // Keep user auth session token and client UI preferences intact
            if (!UI_STORAGE_KEYS.has(k) && !k.startsWith('sb-')) {
              toDelete.push(k);
            }
          }
        }
        toDelete.forEach(k => {
          try {
            // CRITICAL: Call native Storage.prototype.removeItem directly to avoid
            // triggering our intercepted window.localStorage.removeItem which deletes rows in Supabase!
            Storage.prototype.removeItem.call(window.localStorage, k);
          } catch (_) {}
        });
        if (toDelete.length > 0) {
          console.log(`🧹 Cleared ${toDelete.length} legacy database items from native localStorage.`);
        }
      }
    } catch (e) {
      console.warn('Could not clear legacy localStorage:', e);
    }
  }

  // 4. Background Hydration from Supabase Cloud Database (Fast Batched Parallel Fetching)
  public async hydrateFromSupabase(): Promise<void> {
    if (this.hydrationPromise) return this.hydrationPromise;
    if (supabase.auth?.getSession) {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
    }

    const generation = this.sessionGeneration;
    this.hydrationPromise = (async () => {
      const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        console.log('🔄 Fast parallel hydrating in-memory cache from Supabase...');

        // 1. Fetch system_kv in parallel with tables
        const fetchKvPromise = (async () => {
          try {
            const kvRows = await this.readAllRows('system_kv', 'key, value, updated_at');
            if (generation !== this.sessionGeneration) return;
            if (kvRows) {
              for (const rawRow of kvRows) {
                const row = {...rawRow, key: this.testScope ? rawRow.key.replace(this.testScope+':','') : rawRow.key};
                this.kvRecords.set(row.key,JSON.stringify(row.value));
                this.cache.set(row.key, row.value);
                // Bidirectional sync: store both with and without prefix in cache
                if (!row.key.startsWith('nzm_jkr_')) {
                  this.cache.set(`nzm_jkr_${row.key}`, row.value);
                } else {
                  this.cache.set(row.key.replace(/^nzm_jkr_/, ''), row.value);
                }
              }
            }
          } catch (kvErr) {
            throw kvErr;
          }
        })();

        // 2. Fetch all tables concurrently in chunks of 15 to balance speed & connection limits
        const tableEntries = Object.entries(KEY_TO_TABLE_MAP);
        const fetchTablesPromise = (async () => {
          const batchSize = 15;
          for (let i = 0; i < tableEntries.length; i += batchSize) {
            const chunk = tableEntries.slice(i, i + batchSize);
            await Promise.all(
              chunk.map(async ([storageKey, tableName]) => {
                try {
                  const tableRows = await this.readAllRows(tableName, 'id, data');
                  if (generation !== this.sessionGeneration) return;
                  if (tableRows) {
                    const items = this.orderedRows(tableName, tableRows.map(r => r.data));
                    this.persistedRecords.set(tableName, new Map(tableRows.map(row => [String(row.id), JSON.stringify(row.data)])));
                    this.cache.set(storageKey, items);
                    const cleanStorageKey = storageKey.replace(/^nzm_jkr_/, '');
                    this.cache.set(cleanStorageKey, items);

                    const idSet = new Set<string>();
                    tableRows.forEach(r => idSet.add(r.id));
                    this.knownIdsByTable.set(tableName, idSet);
                  }
                } catch (tblErr) {
                  throw tblErr;
                }
              })
            );
          }
        })();

        // Run both KV and table fetch streams in parallel
        await Promise.all([fetchKvPromise, fetchTablesPromise]);

        if (generation !== this.sessionGeneration) return;
        this.isHydrated = true;
        this.clearLegacyLocalStorage();
        this.setupRealtimeSync();

        const duration = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime);
        console.log(`✅ In-memory cache successfully hydrated from Supabase in ${duration}ms.`);
        eventBus.publish('SUPABASE_HYDRATED', { timestamp: new Date().toISOString(), duration });
      } catch (err) {
        if (generation !== this.sessionGeneration) return;
        console.error('⚠️ Supabase hydration warning (offline or network error):', err);
        this.isHydrated = false;
        this.hydrationPromise = null;
        throw err;
      }
    })();

    return this.hydrationPromise;
  }

  private startBackgroundHydration(): void {
    if (typeof window !== 'undefined' || typeof globalThis !== 'undefined') {
      this.hydrateFromSupabase().catch(() => {});
    }
  }

  private async readAllRows(table: string, columns: string): Promise<any[]> {
    const rows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = supabase.from(table).select(columns).order(table === 'system_kv' ? 'key' : 'id', {ascending: true});
      const paginated = typeof query.range === 'function';
      if (paginated) query = query.range(offset, offset + 999);
      const {data, error} = await query;
      if (error) throw error;
      rows.push(...(data || []));
      if (!paginated || !data || data.length < 1000) return rows;
    }
  }

  // 5. Debounced persistence to Supabase
  private scheduleSyncToSupabase(key: string, value: any): void {
    key = this.canonicalKey(key);
    this.pendingWrites.add(key);
    if (typeof supabase.rpc === 'function') {
      this.pendingValues.set(key,structuredClone(value));
      if (this.atomicTimer) clearTimeout(this.atomicTimer);
      this.atomicTimer = setTimeout(() => {this.atomicTimer = null;this.enqueueAtomicCommit();},150);
      return;
    }
    const existing = this.syncQueue.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.syncQueue.delete(key);
      const previous = this.writeChains.get(key) || Promise.resolve();
      const write = previous.catch(() => {}).then(() => this.persistToSupabase(key, value));
      this.writeChains.set(key, write);
      write.catch(err => {
        console.error(`❌ Background sync error for "${key}":`, err);
        eventBus.publish('STORAGE_ERROR', { key, error: err });
      }).finally(() => {
        if (this.writeChains.get(key) === write) {
          this.writeChains.delete(key);
          if (!this.syncQueue.has(key)) this.pendingWrites.delete(key);
        }
      });
    }, 150);

    this.syncQueue.set(key, timer);
  }

  private async persistToSupabase(key: string, value: any): Promise<void> {
    const tableName = KEY_TO_TABLE_MAP[key] || KEY_TO_TABLE_MAP[`nzm_jkr_${key}`];

    if (tableName) {
      if (!Array.isArray(value)) {
        const prefixedKey = key.startsWith('nzm_jkr_') ? key : `nzm_jkr_${key}`;
        const cleanKey = key.replace(/^nzm_jkr_/, '');
        const now = new Date().toISOString();
        const rows = [{ key: cleanKey, value, updated_at: now }];
        if (prefixedKey !== cleanKey) {
          rows.push({ key: prefixedKey, value, updated_at: now });
        }
        const { error } = await supabase.from('system_kv').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
        return;
      }

      // It's a collection array
      const items = value as any[];
      const currentIds = new Set<string>();

      const previousRecords = this.persistedRecords.get(tableName) || new Map<string, string>();
      const nextRecords = new Map<string, string>();
      const records = items.map((item, idx) => {
        const id = String(item.id || item.code || `${tableName}_${idx + 1}`);
        currentIds.add(id);
        const data = tableName === 'store_wallets' || tableName === 'dealer_wallets' ? { ...item, _erpOrder: idx } : item;
        const serialized = JSON.stringify(data);
        nextRecords.set(id, serialized);
        if (previousRecords.get(id) === serialized) return null;
        return {
          id,
          data,
          updated_at: new Date().toISOString()
        };
      }).filter((record): record is NonNullable<typeof record> => record !== null);

      // Upsert in chunks
      const chunkSize = 50;
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        chunk.forEach(row => this.rowVersions.set(`${tableName}:${row.id}`, row.updated_at));
        const { error } = await supabase.from(tableName).upsert(chunk, { onConflict: 'id' });
        if (error) throw error;
      }

      // Check deleted items
      const previousIds = this.knownIdsByTable.get(tableName);
      if (previousIds) {
        const deletedIds = Array.from(previousIds).filter(id => !currentIds.has(id));
        if (deletedIds.length > 0) {
          const { error } = await supabase.from(tableName).delete().in('id', deletedIds);
          if (error) throw error;
        }
      }
      this.knownIdsByTable.set(tableName, currentIds);
      this.persistedRecords.set(tableName, nextRecords);

    } else {
      // Key-Value singleton
      const prefixedKey = key.startsWith('nzm_jkr_') ? key : `nzm_jkr_${key}`;
      const cleanKey = key.replace(/^nzm_jkr_/, '');
      const now = new Date().toISOString();
      const rows = [{ key: cleanKey, value, updated_at: now }];
      if (prefixedKey !== cleanKey) {
        rows.push({ key: prefixedKey, value, updated_at: now });
      }
      const { error } = await supabase.from('system_kv').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
    }
  }

  // 6. Supabase Realtime Channels
  private setupRealtimeSync(): void {
    try {
      if (this.realtimeChannel) return;
      const channel = supabase.channel('erp_cloud_sync');
      this.realtimeChannel = channel;

      // Listen to system_kv changes
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'system_kv' }, payload => {
        const rawEventKey = (payload.new as any)?.key || (payload.old as any)?.key;
        if (this.testScope && rawEventKey && !rawEventKey.startsWith(this.testScope+':')) return;
        const eventKey = this.testScope ? rawEventKey?.replace(this.testScope+':','') : rawEventKey;
        if (eventKey && this.pendingWrites.has(this.canonicalKey(eventKey))) return;
        if (payload.eventType === 'DELETE') {
          const oldKey = eventKey;
          if (oldKey) {
            this.cache.delete(oldKey);
            const altKey = oldKey.startsWith('nzm_jkr_') ? oldKey.replace(/^nzm_jkr_/, '') : `nzm_jkr_${oldKey}`;
            this.cache.delete(altKey);
            eventBus.publish('SUPABASE_KV_UPDATED', { key: oldKey });
            eventBus.publish('DATA_SYNCED', { table: 'system_kv', key: oldKey });
          }
        } else if (payload.new && (payload.new as any).key) {
          const k = eventKey;
          const v = (payload.new as any).value;
          this.kvRecords.set(k,JSON.stringify(v));
          this.cache.set(k, v);
          if (!k.startsWith('nzm_jkr_')) {
            this.cache.set(`nzm_jkr_${k}`, v);
          } else {
            this.cache.set(k.replace(/^nzm_jkr_/, ''), v);
          }
          eventBus.publish('SUPABASE_KV_UPDATED', { key: k });
          eventBus.publish('DATA_SYNCED', { table: 'system_kv', key: k });
        }
      });

      // Listen to high-traffic tables
      const trackedTables = ['tickets', 'dealer_tickets', 'store_wallets', 'store_wallet_transactions', 'dealer_wallets', 'customers', 'dealers', 'shift_settlements', 'dealer_settlements'];
      trackedTables.forEach(tbl => {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: tbl }, payload => {
          const storageKey = Object.keys(KEY_TO_TABLE_MAP).find(k => KEY_TO_TABLE_MAP[k] === tbl);
          if (!storageKey) return;
          if (this.pendingWrites.has(storageKey)) return;
          const row = (payload.new as any);
          const rowId = row?.id || (payload.old as any)?.id;
          const version = this.rowVersions.get(`${tbl}:${rowId}`);
          if (row?.updated_at && version && row.updated_at < version) return;
          if (row?.updated_at) this.rowVersions.set(`${tbl}:${rowId}`, row.updated_at);
          const cleanStorageKey = storageKey.replace(/^nzm_jkr_/, '');

          if (row?.data) {
            const records = this.persistedRecords.get(tbl) || new Map<string, string>();
            records.set(String(rowId), JSON.stringify(row.data));
            this.persistedRecords.set(tbl, records);
          }
          const currentList: any[] = this.cache.get(storageKey) || this.cache.get(cleanStorageKey) || [];
          if (payload.eventType === 'INSERT' && (payload.new as any)?.data) {
            const newItem = (payload.new as any).data;
            if (!currentList.some(x => x.id === newItem.id)) {
              const nextList = this.orderedRows(tbl, [newItem, ...currentList]);
              this.cache.set(storageKey, nextList);
              this.cache.set(cleanStorageKey, nextList);
              eventBus.publish('DATA_SYNCED', { table: tbl, id: newItem.id });
            }
          } else if (payload.eventType === 'UPDATE' && (payload.new as any)?.data) {
            const updatedItem = (payload.new as any).data;
            const idx = currentList.findIndex(x => x.id === updatedItem.id);
            if (idx >= 0) {
              currentList[idx] = (tbl === 'store_wallets' || tbl === 'dealer_wallets') ? { ...updatedItem, _erpOrder: updatedItem._erpOrder ?? currentList[idx]._erpOrder } : updatedItem;
            } else {
              currentList.unshift(updatedItem);
            }
            const nextList = this.orderedRows(tbl, currentList);
            this.cache.set(storageKey, nextList);
            this.cache.set(cleanStorageKey, nextList);
            eventBus.publish('DATA_SYNCED', { table: tbl, id: updatedItem.id });
          } else if (payload.eventType === 'DELETE' && (payload.old as any)?.id) {
            const deletedId = (payload.old as any).id;
            const nextList = currentList.filter(x => x.id !== deletedId);
            this.cache.set(storageKey, nextList);
            this.cache.set(cleanStorageKey, nextList);
            eventBus.publish('DATA_SYNCED', { table: tbl, id: deletedId });
          }
        });
      });

      channel.subscribe();
    } catch (e) {
      console.warn('Realtime sync setup warning:', e);
    }
  }

  // 7. Transparent localStorage Interceptor
  // Ensures any third-party or sub-service call to localStorage reads/writes from Supabase cache!
  private installLocalStorageInterceptor(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const origGetItem = window.localStorage.getItem.bind(window.localStorage);
      const origSetItem = window.localStorage.setItem.bind(window.localStorage);
      const origRemoveItem = window.localStorage.removeItem.bind(window.localStorage);

      window.localStorage.getItem = (key: string): string | null => {
        // UI preferences bypass interceptor directly to native localStorage
        if (UI_STORAGE_KEYS.has(key)) {
          return origGetItem(key);
        }

        if (key.startsWith('nzm_jkr_') || key.startsWith('jkr_') || KEY_TO_TABLE_MAP[key]) {
          if (this.cache.has(key)) {
            const val = this.cache.get(key);
            return val !== undefined ? JSON.stringify(val) : null;
          }
        }
        return origGetItem(key);
      };

      window.localStorage.setItem = (key: string, value: string): void => {
        // UI preferences bypass interceptor directly to native localStorage
        if (UI_STORAGE_KEYS.has(key)) {
          origSetItem(key, value);
          return;
        }

        if (key.startsWith('nzm_jkr_') || key.startsWith('jkr_') || KEY_TO_TABLE_MAP[key]) {
          try {
            const parsed = JSON.parse(value);
            this.setItem(key, parsed);
            return;
          } catch (_) {
            this.setItem(key, value);
            return;
          }
        }
        origSetItem(key, value);
      };

      window.localStorage.removeItem = (key: string): void => {
        // UI preferences bypass interceptor directly to native localStorage
        if (UI_STORAGE_KEYS.has(key)) {
          origRemoveItem(key);
          return;
        }

        if (key.startsWith('nzm_jkr_') || key.startsWith('jkr_') || KEY_TO_TABLE_MAP[key]) {
          this.removeItem(key);
        }
        origRemoveItem(key);
      };
    } catch (_) {}
  }
}

export const supabaseStorage = new SupabaseStorageAdapter();
