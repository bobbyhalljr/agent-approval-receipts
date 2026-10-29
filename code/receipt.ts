import { randomUUID } from 'node:crypto';

export type Context = Readonly<{ tenant: string; actor: string; task: string }>;
export type Refund = Readonly<{
  tool: 'refund'; order: string; orderVersion: number;
  amountCents: number; currency: 'USD';
}>;
type Receipt = {
  id: string; context: Context; action: Refund; expiresAt: number;
  approvedBy?: string; state: 'pending' | 'approved' | 'consumed';
};
function requireText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw Error('invalid text');
}
function validateContext(c: Context) {
  requireText(c.tenant); requireText(c.actor); requireText(c.task);
}
function normalize(a: Refund): Refund {
  const keys = Object.keys(a).sort().join(',');
  if (keys !== 'amountCents,currency,order,orderVersion,tool') throw Error('unexpected fields');
  requireText(a.order);
  if (a.tool !== 'refund' || a.currency !== 'USD' ||
      !Number.isSafeInteger(a.amountCents) || a.amountCents <= 0 ||
      !Number.isSafeInteger(a.orderVersion) || a.orderVersion < 1) throw Error('invalid refund');
  return Object.freeze({ tool: a.tool, order: a.order, orderVersion: a.orderVersion,
    amountCents: a.amountCents, currency: a.currency });
}
// This class belongs behind trusted server routes. The model cannot call approve().
export class ApprovalGate {
  #receipts = new Map<string, Receipt>();
  #now: () => number;
  constructor(now: () => number = Date.now) { this.#now = now; }
  propose(context: Context, action: Refund, ttlMs = 60_000): string {
    validateContext(context);
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 300_000) throw Error('invalid lifetime');
    const receipt: Receipt = { id: randomUUID(), context: Object.freeze({ ...context }),
      action: normalize(action), expiresAt: this.#now() + ttlMs, state: 'pending' };
    this.#receipts.set(receipt.id, receipt);
    return receipt.id;
  }
  #get(id: string, context: Context): Receipt {
    const r = this.#receipts.get(id);
    if (!r || r.context.tenant !== context.tenant || r.context.actor !== context.actor ||
        r.context.task !== context.task) throw Error('receipt unavailable');
    if (this.#now() >= r.expiresAt) throw Error('expired');
    return r;
  }
  review(id: string, context: Context) {
    const r = this.#get(id, context);
    // Return detached copies, never the mutable receipt record.
    return { id: r.id, context: { ...r.context }, action: { ...r.action },
      expiresAt: r.expiresAt, state: r.state };
  }
  // reviewer is supplied by a separately authorized human approval route.
  approve(id: string, context: Context, reviewer: string) {
    requireText(reviewer);
    const r = this.#get(id, context);
    if (r.state !== 'pending') throw Error('not pending');
    r.approvedBy = reviewer; r.state = 'approved';
  }
  async execute(id: string, context: Context, proposed: Refund,
    dispatch: (action: Refund, operationId: string) => Promise<string>): Promise<string> {
    const r = this.#get(id, context);
    if (r.state !== 'approved') throw Error('not approved');
    const action = normalize(proposed);
    if (JSON.stringify(action) !== JSON.stringify(r.action)) {
      throw Error('payload changed');
    }
    // No await between validation and consume: one admission in this process.
    r.state = 'consumed';
    return dispatch(r.action, r.id);
  }
}
