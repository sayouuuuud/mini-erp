// Run with Node 24+: node tests/test_wallet_receiving_regression.mjs
// Exercise the actual database method with isolated storage; never connect to Supabase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(process.argv[2] || new URL('../src/database/db.ts', import.meta.url), 'utf8');
const start = source.indexOf('  public recordWalletReceivingPayment(');
const end = source.indexOf('\n  public ', start + 1);
assert(start >= 0 && end > start, 'Receiving method must exist');
const method = stripTypeScriptTypes(`class ReceivingDatabase {\n${source.slice(start, end)}\n}`);
const context = vm.createContext({ STORAGE_KEYS: { STORE_WALLETS: 'wallets', STORE_WALLET_TRANSACTIONS: 'transactions' }, initialStoreWalletTransactions: [], Date });
vm.runInContext(`${method}\nglobalThis.db = new ReceivingDatabase();`, context);
const db = context.db;
const ticketNumber = 'JKR-2026-4369';
let wallets;
let transactions;
db.getStoreWallets = () => wallets;
db.getItem = () => transactions;
db.setItem = (key, value) => { assert.equal(key, 'wallets'); wallets = value; };
db.addStoreWalletTransaction = tx => transactions.push(tx);
db.addNotification = () => {};

function reset(existing = []) {
  wallets = [{ id: 'receiving', name: 'Receiving cash', type: 'operating', currency: 'EGP', balance: 0,
    numbers: [{ id: 'line', phoneNumber: 'test-line', currentBalance: 0, monthlyReceived: 0, monthlyLimit: 200000, dailyLimit: 60000, status: 'active' }] }];
  transactions = structuredClone(existing);
}
function receive(wallet = 'receiving') {
  return db.recordWalletReceivingPayment(wallet, 'line', 803, ticketNumber, 'Test customer', undefined, { ticketId: 'test-ticket' });
}

reset([{ walletId: 'w_profits', type: 'deposit', amount: 93.97, sourceType: 'ticket', referenceNumber: ticketNumber }]);
assert.equal(receive().success, true);
assert.equal(wallets[0].balance, 803, 'A prior profit deposit must not suppress the receiving-wallet payment');
assert.equal(wallets[0].numbers[0].currentBalance, 803, 'The balance displayed by the wallet card must update');
assert.equal(wallets[0].numbers[0].dailyReceived, 803);
assert.equal(wallets[0].numbers[0].monthlyReceived, 803);
assert.equal(wallets[0].dailyIncome, 803);
assert.equal(wallets[0].monthlyIncome, 803);
assert.equal(transactions.length, 2);
receive();
assert.equal(wallets[0].balance, 803, 'Retry must not credit the payment twice');
assert.equal(wallets[0].numbers[0].operationsCount, 1);
assert.equal(transactions.length, 2);
console.log('PASS: profit entry, wallet/line balance, limits, and duplicate retry');

reset([{ walletId: 'another-wallet', type: 'deposit', sourceType: 'ticket', sourceTicketNumber: ticketNumber }]);
receive('Receiving cash');
assert.equal(wallets[0].balance, 803, 'Resolve the destination before checking duplicate receipts');
console.log('PASS: unrelated wallet entry and destination lookup by name');

reset([{ walletId: 'receiving', type: 'deposit', description: `Legacy receipt ${ticketNumber}`, referenceNumber: ticketNumber }]);
receive();
assert.equal(wallets[0].balance, 0, 'Legacy receiving entries must still prevent duplicate posting');
assert.equal(transactions.length, 1);
console.log('PASS: legacy receipt deduplication');

reset([{ walletId: 'receiving', type: 'refund', sourceType: 'ticket', referenceNumber: ticketNumber }]);
receive();
assert.equal(wallets[0].balance, 803, 'A non-deposit entry must not suppress receiving');
console.log('PASS: non-deposit entry');
