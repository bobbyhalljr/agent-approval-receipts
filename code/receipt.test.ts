import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalGate } from './receipt.ts';
import type { Context, Refund } from './receipt.ts';
const context: Context = { tenant: 'shop-a', actor: 'agent-7', task: 'ticket-42' };
const action: Refund = { tool: 'refund', order: 'order-1042', orderVersion: 3, amountCents: 4800, currency: 'USD' };
function fixture() {
  let now = 1000; const gate = new ApprovalGate(() => now);
  const id = gate.propose(context, action); const calls: unknown[] = [];
  const dispatch = async (a: Refund, op: string) => { calls.push({a,op}); return 'refund-1'; };
  return { gate, id, calls, dispatch, setNow: (v: number) => { now = v; } };
}
test('unapproved action makes no tool call', async () => {
 const f=fixture(); await assert.rejects(f.gate.execute(f.id,context,action,f.dispatch), /not approved/); assert.equal(f.calls.length,0);
});
test('approved exact action reaches the tool with its operation ID', async () => {
 const f=fixture(); f.gate.approve(f.id,context,'human-1'); assert.equal(await f.gate.execute(f.id,context,action,f.dispatch),'refund-1'); assert.deepEqual(f.calls,[{a:action,op:f.id}]);
});
for (const [field, value] of [['amountCents',48000],['order','order-9999'],['orderVersion',4]] as const) {
 test(`changed ${field} makes no call`,async()=>{ const f=fixture(); f.gate.approve(f.id,context,'human-1'); await assert.rejects(f.gate.execute(f.id,context,{...action,[field]:value},f.dispatch),/payload changed/);assert.equal(f.calls.length,0); });
}
for (const field of ['tenant','actor','task'] as const) {
 test(`wrong ${field} cannot use receipt`,async()=>{ const f=fixture(); f.gate.approve(f.id,context,'human-1'); await assert.rejects(f.gate.execute(f.id,{...context,[field]:'other'},action,f.dispatch),/unavailable/);assert.equal(f.calls.length,0); });
}
test('expiry at the exact boundary blocks execution',async()=>{const f=fixture();f.gate.approve(f.id,context,'human-1');f.setNow(61000);await assert.rejects(f.gate.execute(f.id,context,action,f.dispatch),/expired/);assert.equal(f.calls.length,0);});
test('expired pending receipt cannot be approved',()=>{const f=fixture();f.setNow(61000);assert.throws(()=>f.gate.approve(f.id,context,'human-1'),/expired/);});
test('replay makes no second call',async()=>{const f=fixture();f.gate.approve(f.id,context,'human-1');await f.gate.execute(f.id,context,action,f.dispatch);await assert.rejects(f.gate.execute(f.id,context,action,f.dispatch),/not approved/);assert.equal(f.calls.length,1);});
test('concurrent attempts admit once in this process',async()=>{const f=fixture();f.gate.approve(f.id,context,'human-1');const r=await Promise.allSettled([f.gate.execute(f.id,context,action,f.dispatch),f.gate.execute(f.id,context,action,f.dispatch)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.calls.length,1);});
test('source mutation cannot rewrite stored action',()=>{const f=fixture();const a={...action};const id=f.gate.propose(context,a);a.amountCents=999;assert.equal(f.gate.review(id,context).action.amountCents,4800);});
test('review mutation cannot rewrite stored action',()=>{const f=fixture();const view=f.gate.review(f.id,context);view.action.amountCents=999;assert.equal(f.gate.review(f.id,context).action.amountCents,4800);});
test('key order does not change meaning',async()=>{const f=fixture();f.gate.approve(f.id,context,'human-1');await f.gate.execute(f.id,context,{currency:'USD',amountCents:4800,orderVersion:3,order:'order-1042',tool:'refund'},f.dispatch);assert.equal(f.calls.length,1);});
test('unknown fields are refused',()=>{const f=fixture();assert.throws(()=>f.gate.propose(context,{...action,extra:'surprise'} as Refund),/unexpected/);});
for (const n of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
 test(`invalid amount ${n} is refused`,()=>{const f=fixture();assert.throws(()=>f.gate.propose(context,{...action,amountCents:n}),/invalid/);});
}
test('fresh identical proposals have distinct receipt IDs',()=>{const f=fixture();assert.notEqual(f.id,f.gate.propose(context,action));});
test('unknown outcome consumes admission and does not auto-retry',async()=>{const f=fixture();f.gate.approve(f.id,context,'human-1');let calls=0;const fail=async()=>{calls++;throw Error('connection lost');};await assert.rejects(f.gate.execute(f.id,context,action,fail),/connection lost/);await assert.rejects(f.gate.execute(f.id,context,action,fail),/not approved/);assert.equal(calls,1);});
test('consumed receipt cannot be reapproved',async()=>{const f=fixture();f.gate.approve(f.id,context,'human-1');await f.gate.execute(f.id,context,action,f.dispatch);assert.throws(()=>f.gate.approve(f.id,context,'human-1'),/not pending/);});
test('another tenant cannot review or approve',()=>{const f=fixture();const other={...context,tenant:'shop-b'};assert.throws(()=>f.gate.review(f.id,other),/unavailable/);assert.throws(()=>f.gate.approve(f.id,other,'human-1'),/unavailable/);});
test('invalid lifetime is refused',()=>{const f=fixture();for(const ttl of [0,-1,Infinity,300001])assert.throws(()=>f.gate.propose(context,action,ttl),/lifetime/);});
