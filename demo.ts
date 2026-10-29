import { ApprovalGate } from './receipt.ts';
const gate = new ApprovalGate();
const context = { tenant: 'shop-a', actor: 'agent-7', task: 'ticket-42' };
const action = { tool: 'refund' as const, order: 'order-1042', orderVersion: 3, amountCents: 4800, currency: 'USD' as const };
const id = gate.propose(context, action);
console.log('Review: refund USD 48.00 for order-1042, version 3');
gate.approve(id, context, 'human-1');
let calls = 0;
const tool = async () => { calls++; return 'refund accepted'; };
try { await gate.execute(id, context, {...action,amountCents:48000},tool); }
catch(e) { console.log('USD 480.00 attempt:', (e as Error).message); }
console.log('Tool calls after changed payload:', calls);
console.log('USD 48.00 attempt:', await gate.execute(id,context,action,tool));
try { await gate.execute(id,context,action,tool); }
catch(e) { console.log('Replay:', (e as Error).message); }
console.log('Total tool calls:', calls);
