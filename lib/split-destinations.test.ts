import { describe, expect, it } from 'vitest';

import { mintApprovalToken } from './approvals';
import { resetStore } from './store';

/**
 * #18's target kinds covered orders, invoices and customers, the refund vocabulary. Payouts name
 * where the money goes differently: a vendor, merchant, supplier, beneficiary, employee or
 * contractor; a destination account, IBAN, card, wallet or phone. None of those were a target, so
 * with a new reason a split payout to the same vendor or IBAN ran on one approval (19 of 20 such
 * names did; `bank_account` was caught only because its last word is "account").
 *
 * Left out on purpose, because they'd add up payments to different people: `client` (`client_id`
 * is usually the app's own credential), `routing_number` (a bank, not an account) and a bare
 * `address` (often a postal address; `wallet_address` counts).
 */

const YOU = 'you@company.com';
type S = ReturnType<typeof resetStore>;

function pay(store: S, args: Record<string, unknown>, cents: number) {
  return store.propose({ agent: 'billing-agent', tool: 'payout.send', args: { ...args, amount_cents: cents }, estimatedCostCents: cents });
}
const approve = (store: S, id: string) =>
  store.decide(id, true, YOU, 'ok', mintApprovalToken(store.actions().find((a) => a.proposal.id === id)!.proposal, YOU));

function secondPart(first: Record<string, unknown>, second: Record<string, unknown>) {
  const store = resetStore();
  expect(approve(store, pay(store, { ...first, reason: 'a' }, 20_000).proposal.id)?.state).toBe('EXECUTED');
  return approve(store, pay(store, { ...second, reason: 'b' }, 10_000).proposal.id)?.state;
}

describe('payout destinations', () => {
  it.each([
    ['vendor', { vendor: 'acme-supplies' }, { vendor: 'acme-supplies' }],
    ['vendor_id', { vendor_id: 'v_1' }, { vendorId: 'v_1' }],
    ['merchant', { merchant: 'm_1' }, { merchant_id: 'm_1' }],
    ['supplier', { supplier: 's_1' }, { supplier: 's_1' }],
    ['beneficiary', { beneficiary: 'b_1' }, { beneficiary_id: 'b_1' }],
    ['employee', { employee: 'e_1' }, { employeeId: 'e_1' }],
    ['contractor', { contractor: 'c_1' }, { contractor: 'c_1' }],
    ['counterparty', { counterparty: 'cp_1' }, { counterparty_id: 'cp_1' }],
    ['member', { member: 'mem_1' }, { member_id: 'mem_1' }],
    ['destination', { destination: 'acct_1' }, { destination: 'acct_1' }],
    ['destination account by another name', { destination: 'acct_1' }, { destination_account: 'acct_1' }],
    ['iban', { iban: 'DE89370400440532013000' }, { iban: 'DE89370400440532013000' }],
    ['card', { card: 'card_1' }, { card_id: 'card_1' }],
    ['wallet', { wallet: '0xabc' }, { wallet_address: '0xABC' }],
    ['phone', { phone: '+15550100' }, { phone_number: '+15550100' }],
    ['paypal', { paypal: 'pp@x.com' }, { paypal_email: 'pp@x.com' }],
  ])('a split to the same %s still needs a second person', (_label, first, second) => {
    expect(secondPart(first, second)).toBe('PENDING_APPROVAL');
  });

  it.each([
    ['different vendors', { vendor: 'v_1' }, { vendor: 'v_2' }],
    ['different IBANs', { iban: 'DE89370400440532013000' }, { iban: 'GB33BUKB20201555555555' }],
    ['the same app credential', { client_id: 'app_1', vendor: 'v_1' }, { client_id: 'app_1', vendor: 'v_2' }],
    ['the same bank, different accounts', { routing_number: '110000000', bank_account: '1' }, { routing_number: '110000000', bank_account: '2' }],
    ['the same postal address', { address: '1 Main St', vendor: 'v_1' }, { address: '1 Main St', vendor: 'v_2' }],
  ])('%s stay separate', (_label, first, second) => {
    expect(secondPart(first, second)).toBe('EXECUTED');
  });
});
