do $qa$
declare scope text:='__qa_refund_'||replace(gen_random_uuid()::text,'-',''); actor jsonb;
 before_w jsonb;before_l jsonb;after_w jsonb;after_l jsonb;refund_tx jsonb;payload jsonb;bad jsonb;blocked boolean;checks int:=0;
begin
 begin
 actor:=jsonb_build_object('_testScope',scope);
 before_w:='[{"id":"cashless_points","type":"SUB","pointsBalance":102.46}]';
 before_l:='[{"id":"lot","walletId":"cashless_points","currencyOrPoints":"POINTS","initialQuantity":200,"remainingQuantity":102.46}]';
 after_w:='[{"id":"cashless_points","type":"SUB","pointsBalance":297.54}]';
 after_l:=jsonb_set(before_l,'{0,remainingQuantity}','200');
 refund_tx:='[{"id":"refund","walletId":"cashless_points","referenceType":"TICKET","referenceId":"REFUND-QA","transactionType":"ADJUSTMENT","quantityIn":97.54}]';
 insert into public.system_kv(key,value) values(scope||':jkr_wallets_v2',before_w),(scope||':jkr_wallet_lots_v2',before_l),(scope||':jkr_wallet_transactions_v2','[]');
 payload:=jsonb_build_array(
  jsonb_build_object('table','system_kv','id','jkr_wallets_v2','after',after_w),
  jsonb_build_object('table','system_kv','id','jkr_wallet_lots_v2','after',after_l),
  jsonb_build_object('table','system_kv','id','jkr_wallet_transactions_v2','after',refund_tx));
 blocked:=false;begin perform erp_private.validate_inventory_refund(payload,actor);exception when sqlstate 'PT409' then blocked:=true;end;if not blocked then raise exception 'double_refund_accepted';end if;checks:=checks+1;
 payload:=jsonb_set(payload,'{0,after,0,pointsBalance}','200');perform erp_private.validate_inventory_refund(payload,actor);checks:=checks+1;
 bad:=jsonb_set(jsonb_set(payload,'{0,after,0,pointsBalance}','220'),'{1,after,0,remainingQuantity}','220');
 blocked:=false;begin perform erp_private.validate_inventory_refund(bad,actor);exception when sqlstate 'PT409' then blocked:=true;end;if not blocked then raise exception 'lot_overfill_accepted';end if;checks:=checks+1;
 bad:=jsonb_set(bad,'{1,after,0,initialQuantity}','300');
 blocked:=false;begin perform erp_private.validate_inventory_refund(bad,actor);exception when sqlstate 'PT409' then blocked:=true;end;if not blocked then raise exception 'principal_inflation_accepted';end if;checks:=checks+1;
 bad:=payload||jsonb_build_array(jsonb_build_object('table','system_kv','id','nzm_jkr_jkr_wallets_v2','after',after_w));
 blocked:=false;begin perform erp_private.validate_inventory_refund(bad,actor);exception when sqlstate 'PT409' then blocked:=true;end;if not blocked then raise exception 'alias_bypass_accepted';end if;checks:=checks+1;
 update public.system_kv set value='[{"id":"cashless_points","type":"SUB","pointsBalance":-20}]' where key=scope||':jkr_wallets_v2';
 update public.system_kv set value='[{"id":"lot","walletId":"cashless_points","currencyOrPoints":"POINTS","initialQuantity":10,"remainingQuantity":0}]' where key=scope||':jkr_wallet_lots_v2';
 payload:=jsonb_set(jsonb_set(jsonb_set(payload,'{0,after,0,pointsBalance}','10'),'{1,after,0,initialQuantity}','10'),'{1,after,0,remainingQuantity}','10');
 perform erp_private.validate_inventory_refund(payload,actor);checks:=checks+1;
 if checks<>6 then raise exception 'wrong_guard_check_count';end if;
 raise exception using errcode='ZX001',message='six_guard_checks_passed';
 exception when sqlstate 'ZX001' then null;
 end;
end $qa$;
