# Ticket receiving wallet correction — 2026-11-02

The duplicate-payment guard previously matched any ticket deposit, including
the profit posting created before the cash receipt. It now resolves the
receiving wallet first and only recognizes a deposit in that wallet as an
existing receipt. Legacy receipt deduplication remains supported.

Regression verification (Node 24+; no database connections):

```sh
node scripts/test_wallet_receiving_regression.mjs
```

The regression fails against the original method and passes against the fix.
It checks profit/receipt separation, receiving wallet and line balances,
daily/monthly usage, repeat-call deduplication, legacy receipts, and unrelated
wallet entries.

Live data correction: ticket JKR-2026-4369 had received 803 EGP into its
Etisalat Cash destination but had no receiving ledger deposit. A guarded,
atomic repair credited the destination wallet and line, updated their receipt
counters, and inserted one traceable receiving entry. No profit or cashback
entry was changed.

Deployment: the source is corrected. The bundled dist directory is the
original build and does not contain this fix. Install the locked dependencies,
run npm run build, and deploy the newly generated dist before creating further
tickets in the hosted application. A complete build was unavailable in the
review environment because the dependencies were not cached.
