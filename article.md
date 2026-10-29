# Your agent’s approval button needs a receipt.

You approve a $48 refund.

The agent continues working. It reads another message, rebuilds the tool arguments, and submits $480.

Somewhere in your application, `approved` is still `true`.

That is a very small boolean carrying a very large assumption.

The interesting failure here does not require a malicious model. A stale UI, a retry, or an ordinary mutation can produce the same mismatch. The human reviewed one operation. Your code executed another.

**Approval needs an object to belong to.**

This is the idea behind the bound confirmations in Module 3 of [Ship a Safe Agent](https://bhjr.dev/courses/ship-a-safe-agent). For this article, I built a separate, small TypeScript example that makes the boundary visible. No model account. No real refunds. Just a proposed action and a gate we can try to break.

![An approval receipt binds a reviewed 48-dollar refund; changing it to 480 dollars blocks execution.](https://raw.githubusercontent.com/bobbyhalljr/agent-approval-receipts/main/images/cover.png)

## What exactly did the person approve?

Start with the screen the human sees.

If it says “Allow the agent to continue?”, the application has left the scope of that permission ambiguous. Continue reading? Continue issuing refunds? Continue on the same order?

For our example, the review screen should show a concrete operation:

```text
Refund USD 48.00
Order: order-1042
Order version: 3
Tenant: shop-a
Task: ticket-42
Requested by: agent-7
Expires: [server-generated timestamp]
```

The server stores the same fields and assigns a fresh operation ID. Clicking Approve changes the state of that stored record.

The model does not get to announce that a human approved it. The approval route obtains the reviewer’s identity from an authenticated session and checks that they may approve this operation.

That distinction matters even if your prompt is excellent.

A tool response containing `"approved": true` is data. It cannot grant itself access to the human approval route.

[OWASP’s transaction authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html) recommends server-side enforcement, verification of significant transaction data, a final authorization check tied to execution, limited validity, and credentials unique to an operation. It also describes invalidating authorization when transaction data changes.

Those principles give us a useful starting point for an agent approval flow.

## Give the operation a receipt

Here is the action shape in the companion example:

```ts
export type Refund = Readonly<{
  tool: 'refund';
  order: string;
  orderVersion: number;
  amountCents: number;
  currency: 'USD';
}>;
```

The receipt also binds the tenant, actor, and task. A new proposal gets a new random ID, even when two proposals have identical action fields.

That last choice is deliberate. Two legitimate $48 refunds should not become the same operation just because their payloads happen to match.

We use positive safe integers for cents, support only USD, and reject unknown action fields. This keeps the exercise narrow enough to inspect. An arbitrary nested payload would need its own schema and a carefully defined representation.

The receipt moves through three states:

```text
pending → approved → consumed
```

An expired receipt cannot advance. A consumed receipt cannot be approved again.

There is no “set approved back to true” recovery path.

![A server stores the proposed operation, a human approves that receipt, and an execution gate checks context, expiry, payload and state before consuming it and calling the tool.](https://raw.githubusercontent.com/bobbyhalljr/agent-approval-receipts/main/images/diagram.png)

## Check the payload where the tool becomes reachable

The execution method receives the current proposed action and compares its normalized form with the stored action.

Here is the critical part, taken from the runnable implementation:

```ts
const r = this.#get(id, context);
if (r.state !== 'approved') throw Error('not approved');
const action = normalize(proposed);
if (JSON.stringify(action) !== JSON.stringify(r.action)) {
  throw Error('payload changed');
}
r.state = 'consumed';
return dispatch(r.action, r.id);
```

`#get` checks the receipt’s tenant, actor, task, and expiry. `normalize` validates the action and constructs its fields in a fixed order, so input property order does not affect the comparison.

Then the tool receives the **stored action**.

That is an easy detail to miss. Checking one object and later forwarding another mutable object would reopen the gap we were trying to close.

The receipt owns a frozen copy of the action. The review method returns detached copies, so changing a review response cannot rewrite the stored operation either.

For this tiny schema, an explicit representation is enough. A digest can be useful for larger systems, but hashing data does not establish who approved it. The trusted approval path still has to exist.

## Make the failed action visible

The demo approves $48, tries $480, then submits the original action and attempts a replay.

Its output is:

```text
Review: refund USD 48.00 for order-1042, version 3
USD 480.00 attempt: payload changed
Tool calls after changed payload: 0
USD 48.00 attempt: refund accepted
Replay: not approved
Total tool calls: 1
```

The changed proposal does not consume the approval in this implementation. The original action remains eligible until expiry. That is a policy choice: a production system could instead revoke the receipt and require a fresh review after any mismatch.

Either way, the changed operation must stay outside the tool boundary.

The useful assertion is the call count. A rejection message looks reassuring, but we also need evidence that the mock refund function never ran.

The test suite checks changed amount, changed order, changed order version, wrong tenant, wrong actor, wrong task, expiry, replay, mutation, invalid input, and concurrent attempts.

These are deterministic fixtures. They exercise the gate, without testing a model’s likelihood of generating a particular mistake.

## One admission is not exactly-once payment processing

There is no `await` between checking the receipt and marking it consumed. Two execution attempts in this one JavaScript process therefore cannot both pass that transition.

That guarantee ends at the process boundary.

The example uses an in-memory map. It does not coordinate workers or survive a restart. A production store needs an atomic conditional transition from approved to consumed. Check the affected row count. Only the winner may dispatch.

Even that leaves a harder problem:

1. Your worker consumes the receipt.
2. The provider accepts the refund.
3. The connection drops before your worker receives the result.

You now have an unknown outcome.

Resetting the receipt and trying again may create a second refund. Leaving it consumed prevents an automatic second admission, but does not tell the customer what happened.

Use a durable operation record, a provider-supported idempotency key, and reconciliation. Pass the same operation ID through retries where the provider’s contract supports it.

[Stripe’s idempotency documentation](https://docs.stripe.com/api/idempotent_requests) describes how its API recognizes repeated requests using an idempotency key, including retention and parameter-matching rules. Read the contract for the specific API you use; a receipt ID alone cannot make an arbitrary tool idempotent.

Our demo deliberately stops after an uncertain failure. It does not implement that recovery system.

## A receipt does not freeze the world

An approved order version is only useful if something checks the current order version.

The demo compares the proposed version against the approved version. It does not query an order database. Your real refund service must also verify current ownership, refundable balance, order state, and version at the point where it commits the refund.

A person’s approval cannot make an already-refunded order refundable again.

Likewise, the `approve` method in this example is an internal boundary, not an authentication system. Putting it directly in the model’s tool list would undo the design. Trusted routes must derive context from authenticated state and enforce reviewer permissions. Add durable audit records, revocation, cleanup, and an accessible review interface before treating this as production infrastructure.

The point of a small example is to make one contract inspectable, including where it ends.

## Run it, then change the amount

The [companion repository](https://github.com/bobbyhalljr/agent-approval-receipts) includes `receipt.ts`, `receipt.test.ts`, and `demo.ts`.

With Node 22.18 or newer:

```sh
cd code
npm test
npm run demo
```

There are no npm dependencies and no provider calls. Node’s built-in TypeScript support executes the erasable syntax used here; it does not perform static type checking. See the [Node documentation](https://nodejs.org/api/typescript.html) for that distinction.

Try deleting the payload comparison. The changed-amount test should fail because the tool becomes reachable with a proposal that the human never reviewed.

That is a more useful starting point than debating whether your approval prompt sounds strict enough.

[Module 1 and its full walkthrough are free](https://bhjr.dev/courses/ship-a-safe-agent/module-1). Modules 2–8, including the action gates in Module 3, are included with the paid course. This companion example is prepared separately for the article.

I keep coming back to this boundary while building agents and Roster: a product needs to explain what someone allowed, then enforce that same operation when the work happens.

**A human’s yes should survive the journey from the review screen to the tool call without changing its meaning.**
