# Examples

`❌ Instead` / `✅ Write` pairs for the rules in `SKILL.md`. Each pair is a pattern seen in
real test suites; the left column is what to replace, the right is what to replace it with.

## Behaviour over implementation

Assert the observable outcome. If a refactor that preserves behaviour breaks the test, the test
was wrong.

```ts
// ❌ Instead — spies on an internal collaborator; proves only that it was wired up
const spy = vi.spyOn(taxCalculator, "compute");
checkout(cart);
expect(spy).toHaveBeenCalledWith(cart);

// ✅ Write — asserts what the caller observes
expect(checkout(cart).total).toBe(90);
```

```ts
// ❌ Instead — recomputes the expected value with the implementation's own logic,
// so a bug in that logic passes the test
const expected = subtotal * (1 - discountRate);
expect(computeTotal(cart)).toBe(expected);

// ✅ Write — a known-good case with a hard-coded result
expect(computeTotal(cartOf100With10PercentDiscount)).toBe(90);
```

```ts
// ❌ Instead — exports an internal helper so the test can reach it
export const __testOnlyNormalise = (s: string) => s.trim().toLowerCase();

// ✅ Write — drive the behaviour through the public entry point that uses it
expect(parseEmail("  Ada@Example.COM ")).toStrictEqual({ address: "ada@example.com" });
```

## Test data: vital visible, incidental hidden

The values that drive the case belong in the test body. Everything else takes an obvious
default in a factory.

```ts
// ❌ Instead — the value under test is hidden in a top-of-file constant.
// A reader cannot see which field makes this case "admin".
const ADMIN_USER: User = { id: "u1", name: "Ada", isAdmin: true, locale: "en-GB" };

it("grants admin access", () => {
  expect(canEdit(ADMIN_USER)).toBe(true);
});

// ✅ Write — the driving value is on the assertion's line
it("grants admin access", () => {
  expect(canEdit(createUser({ isAdmin: true }))).toBe(true);
});
```

```ts
// ❌ Instead — one module-scope object, mutated and reused across tests.
// These tests now depend on each other and on their order.
const user: User = { id: "u1", name: "Ada", isAdmin: false };

it("denies guest access", () => {
  expect(canEdit(user)).toBe(false);
});

it("grants admin access", () => {
  user.isAdmin = true;
  expect(canEdit(user)).toBe(true);
}); // order-dependent: the first test fails if this one runs first

// ✅ Write — fresh data per test, produced by a factory
const createUser = (overrides: Partial<User> = {}): User => ({
  id: "u1",
  name: "Ada",
  isAdmin: false,
  ...overrides,
});

it("grants admin access", () => {
  expect(canEdit(createUser({ isAdmin: true }))).toBe(true);
});

it("denies guest access", () => {
  expect(canEdit(createUser())).toBe(false);
});
```

```ts
// ❌ Instead — the full literal is re-spelled in every test, obscuring the one field that changes
it("grants admin access", () => {
  expect(canEdit({ id: "u1", name: "Ada", isAdmin: true, locale: "en-GB" })).toBe(true);
});

// ✅ Write — a factory defaults the incidental data, overrides carry the case
interface SomeThing {
  prop: number;
  otherProp: string;
}

// Colocated with the tests, named for what it builds. Partial is enough for a flat
// type; reach for a deep-partial only when the type nests.
const createSomething = (overrides: Partial<SomeThing> = {}): SomeThing => ({
  prop: 0,
  otherProp: "{other-prop}",
  ...overrides,
});

it("overrides only the value under test", () => {
  const fixture = createSomething({ prop: 1 });

  expect(fixture).toStrictEqual({ prop: 1, otherProp: "{other-prop}" });
});
```

## Mocking: boundaries, not internals

Mock the genuine external edge — network, clock, third-party SDK. Do not mock a collaborator
inside the application; a real or in-memory one is usually cheaper and never lies.

```ts
// ❌ Instead — the mock replaces an internal collaborator, so the test
// proves nothing about the real interaction
vi.mock("../repository/userRepository");
await saveUser(user);
expect(userRepository.save).toHaveBeenCalledWith(user);

// ✅ Write — a real in-memory implementation at the genuine boundary
const repository = new InMemoryUserRepository();
const service = new UserService(repository);

await service.save(user);

expect(await repository.get(user.id)).toStrictEqual(user);
```

```ts
// ❌ Instead — the test asserts the stub it just configured, not the mapping
vi.spyOn(http, "get").mockResolvedValue({ status: 200, body: apiUserResponse });
expect(await fetchUser("u1")).toStrictEqual(apiUserResponse);

// ✅ Write — stub the edge, assert the domain mapping the client performs
vi.spyOn(http, "get").mockResolvedValue({ status: 200, body: apiUserResponse });
expect(await fetchUser("u1")).toStrictEqual({ id: "u1", displayName: "Ada" });
```

Mock as little as possible: if a real collaborator is fast, deterministic, and side-effect free,
use it.

## Integration and e2e

These layers prove what units cannot: that your code speaks correctly to a real collaborator,
and that the assembled system works. They are the layers agents skip, and where flakiness is
born. See `SKILL.md` for the principles that govern them.

### What each layer proves

A unit proves logic in isolation. An integration test proves your code against a real
collaborator across **one seam**. An e2e test proves the assembled system on a user-visible
journey. Pick the lowest layer that can prove the behaviour.

```ts
// ❌ Instead — an "integration" test that mocks the collaborator it exists to integrate with
vi.mock("../db/pool");
await saveOrder(order);
expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO orders"));

// ✅ Write — exercises the real collaborator across the seam
await withPostgres(async (db) => {
  const repository = new OrderRepository(db);
  await repository.save(order);

  expect(await repository.get(order.id)).toMatchObject({ id: order.id });
});
```

```ts
// ❌ Instead — a unit-tested rule re-proved at e2e: slow, and it proves nothing new
it("applies a 10% discount to a £100 order", async () => {
  await addToCart(page, productPricedAt(100));
  await openCart(page);

  expect(await page.textContent(".total")).toBe("£90.00");
});

// ✅ Write — e2e proves the journey and the wiring; the rule stays a unit test
it("lets a signed-in customer complete checkout", async () => {
  await signIn(page, customer);
  await addToCart(page, product);
  await checkout(page);

  expect(await page.textContent(".confirmation")).toContain("Thank you");
});
```

### Real collaborators, not fakes

Run the genuine engine — Postgres, Redis, a queue, object storage — through TestContainers or
LocalStack. A fake drifts from the real contract and reintroduces exactly the bug the
integration test was written to catch. Fake only what you genuinely cannot run locally, and
use a contract double when you do.

```ts
// ❌ Instead — a hand-rolled fake that does not share the real broker's contract
const fakeQueue = { send: vi.fn() };
await publishOrder(queueAdapter(fakeQueue));
expect(fakeQueue.send).toHaveBeenCalled();

// ✅ Write — the real broker in a container
const queue = await startQueueContainer();
await publishOrder(queueAdapter(queue));

const [received] = await consumeOne(queue, ORDER_TOPIC);
expect(received).toMatchObject({ id: order.id });
```

```ts
// ❌ Instead — an ad-hoc stub invented per test; nothing pins it to the provider's API
vi.spyOn(stripe, "charge").mockResolvedValue({ id: "ch_1" });

// ✅ Write — a contract double generated from the provider's schema
server.use(http.post("/v1/charges", () => HttpResponse.json(stripeChargeFixture)));

expect(await client.charge(customer, 100)).toMatchObject({ id: "ch_1" });
```

### Isolation at the integration layer

State is the enemy here. Give every test its own data and its own schema, namespace, or
transaction; never share a seeded row or a long-lived database between tests or parallel
workers. Starting a container is expensive and legitimately belongs in `beforeAll` — data
does not.

```ts
// ❌ Instead — a shared seeded row mutated across tests; passes alone, fails in a parallel run
beforeAll(async () => {
  db = await startPostgresContainer();
  await db.exec(seedSql);
});

it("updates the account", async () => {
  await db.update("accounts", { id: "acc-1" }, { balance: 50 });
});

it("reads the seeded balance", async () => {
  expect(await db.get("accounts", "acc-1")).toMatchObject({ balance: 100 });
});

// ✅ Write — container per suite, data per test
beforeAll(async () => {
  db = await startPostgresContainer();
});

it("updates the account", async () => {
  const account = await createAccount(db, { balance: 100 });
  await updateBalance(db, account.id, 50);

  expect(await getAccount(db, account.id)).toMatchObject({ balance: 50 });
});

it("reads the inserted balance", async () => {
  const account = await createAccount(db, { balance: 100 });

  expect(await getAccount(db, account.id)).toMatchObject({ balance: 100 });
});
```

### Async and eventual consistency

Integration surfaces are asynchronous by nature. Await the observable signal with a bounded
deadline; a fixed sleep is both slow and a race it may still lose.

```ts
// ❌ Instead — sleeps past the queue, then races it anyway
await publishOrder(queue, order);
await new Promise((resolve) => setTimeout(resolve, 500));

expect(await findProjection(db, order.id)).toBeDefined();

// ✅ Write — poll the observable signal with a bounded deadline
await publishOrder(queue, order);
await waitFor(async () => (await findProjection(db, order.id)) !== null, {
  timeout: 5_000,
  description: "order projection",
});
```

```ts
// ❌ Instead — asserts a step that has not run yet
it("emits an audit event on save", async () => {
  await saveUser(user);

  expect(await auditLog.events()).toHaveLength(1);
});

// ✅ Write — await the event, then assert it
it("emits an audit event on save", async () => {
  await saveUser(user);
  const event = await waitForEvent(auditLog, { type: "user.saved" });

  expect(event).toMatchObject({ userId: user.id });
});
```

### Determinism at the edges

Pin the images, freeze the clock, and seed randomness. A test that pulls `latest` or reads the
wall clock fails eventually for reasons that have nothing to do with the code.

```ts
// ❌ Instead — floating image tag and the real clock
const container = await new GenericContainer("postgres:latest").start();
const invoice = createInvoice({ issuedAt: new Date() });

// ✅ Write — pinned image and an injected clock
const container = await new GenericContainer("postgres:16.4-alpine").start();
const clock = new FixedClock("2024-01-01T00:00:00Z");
const invoice = createInvoice({ issuedAt: clock.now() });
```

### What e2e should prove

E2E is the most expensive layer, so spend it only on what nothing else can prove: that the
parts are wired together, migrations ran, configuration loaded, and a user can complete the
journey. Keep the count small.

```ts
// ❌ Instead — reaches inside the system to assert call order
it("checks out", async () => {
  await checkout(page);

  expect(spyOn(inventoryService, "reserve")).toHaveBeenCalledBefore(
    spyOn(paymentService, "charge"),
  );
});

// ✅ Write — asserts what the journey produced
it("checks out", async () => {
  await checkout(page);

  expect(await page.textContent(".confirmation")).toContain("Thank you");
  expect(await api.getOrder(orderRef)).toMatchObject({ state: "confirmed" });
});
```

## Assertions: targeted, never tautological

```ts
// ❌ Instead — every field asserted; any unrelated field change breaks the test
expect(created).toStrictEqual({
  id: "u1",
  status: "active",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  version: 3,
});

// ✅ Write — assert the fields that carry the behaviour; use `expect.any` for the rest
expect(created).toMatchObject({ status: "active", id: expect.any(String) });
```

```ts
// ❌ Instead — the count is implied by the argument assertion
expect(mockSave).toHaveBeenCalledTimes(1);
expect(mockSave).toHaveBeenCalledWith(user);

// ✅ Write — the argument assertion already proves a single, correct call
expect(mockSave).toHaveBeenCalledWith(user);
```

```ts
// ❌ Instead — cannot fail; delete the implementation and this stays green
it("handles the request", async () => {
  const result = await handler(request);
  expect(result).toBeDefined();
});

// ✅ Write — names the observable contract
it("returns 200 for a valid request", async () => {
  const response = await handler(request);

  expect(response.status).toBe(200);
});
```

```ts
// ❌ Instead — no assertion at all; a smoke test that proves only "it did not throw"
it("processes an order", async () => {
  await processOrder(order);
});

// ✅ Write — assert the effect the call was supposed to have
it("marks a processed order as fulfilled", async () => {
  await processOrder(order);

  expect(await orders.get(order.id)).toMatchObject({ state: "fulfilled" });
});
```

## Structure and naming

```ts
// ❌ Instead — the name describes the implementation, and "works" says nothing
it("calls send once", ...);
it("works", ...);

// ✅ Write — the name states the behaviour the test proves
it("sends a confirmation email after a successful checkout", ...);
it("rejects a checkout with an expired card", ...);
```

```ts
// ❌ Instead — unrelated behaviours in one test: a failure does not localise
it("handles users", async () => {
  expect(await createUser(valid)).toHaveProperty("id");
  await expect(createUser(invalid)).rejects.toThrow();
  expect(await listUsers()).toHaveLength(1);
});

// ✅ Write — one behaviour per test, so the failure name tells you what broke
it("assigns an id when creating a user", ...);
it("rejects a user with no email", ...);
it("lists every created user", ...);
```

```ts
// ❌ Instead — loops zero times and passes when there is nothing to check
for (const item of cart.items) {
  expect(item.price).toBeGreaterThan(0);
}

// ✅ Write — assert the collection, so an empty cart fails
expect(cart.items.map((item) => item.price)).toStrictEqual([10, 20, 30]);
```

## Determinism and async

```ts
// ❌ Instead — a sleep races the work and slows the suite
await new Promise((resolve) => setTimeout(resolve, 100));
expect(job.state).toBe("done");

// ✅ Write — await the observable completion signal
await job.completion;
expect(job.state).toBe("done");
```

```ts
// ❌ Instead — real wall clock and random ids make the expected value unknowable
const invoice = { id: crypto.randomUUID(), issuedAt: new Date() };

// ✅ Write — fixed values in the factory; override only what the case needs
const createInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "invoice-1",
  issuedAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});
```

```ts
// ❌ Instead — the promise is never returned or awaited, so a rejection
// becomes an unhandled rejection and the test stays green
it("rejects an invalid payload", () => {
  expect(handler(bad)).rejects.toThrow();
});

// ✅ Write — await the assertion
it("rejects an invalid payload", async () => {
  await expect(handler(bad)).rejects.toThrow();
});
```

## Isolation

```ts
// ❌ Instead — focus and skip markers committed; the suite silently runs less
it.only("saves the user", ...);
it.skip("handles a timeout", ...);

// ✅ Write — remove the marker; fix the failing test or delete it
it("saves the user", ...);
it("handles a timeout", ...);
```

```ts
// ❌ Instead — a shared row mutated by both tests; order now matters
let row: Row;

beforeEach(async () => {
  row = await db.insert(makeRow());
});

it("updates the row", async () => {
  await db.update(row.id, { name: "Ada" });
});

it("reads the row", async () => {
  expect(await db.get(row.id)).toMatchObject({ name: "Original" });
});

// ✅ Write — each test owns its data; no cross-test coupling
it("updates the row", async () => {
  const row = await db.insert(makeRow());
  await db.update(row.id, { name: "Ada" });

  expect(await db.get(row.id)).toMatchObject({ name: "Ada" });
});

it("reads the row as inserted", async () => {
  const row = await db.insert(makeRow());

  expect(await db.get(row.id)).toMatchObject({ name: "Original" });
});
```

`before`/`after` hooks are for expensive, non-observable infrastructure — starting a server,
opening a connection — never for data a test asserts on.

## Content assertions

Assert the behaviour the file participates in. A comparison against an expected file is a
content inventory; it breaks on a comment and proves nothing about the code.

```ts
// ❌ Instead — catalogues the generated file
const config = await readFile("generated/nginx.conf", "utf8");
expect(config).toBe("server { listen 80; }");

// ✅ Write — asserts what the generator did with the input
const config = await generateNginxConfig({ port: 8080 });

expect(config).toContain("listen 8080;");
```

```ts
// ❌ Instead — snapshots static markdown and calls it a test
expect(await renderReadme(project)).toMatchSnapshot();

// ✅ Write — asserts the renderer produced the section it was asked for
const readme = await renderReadme({ ...project, title: "Agent Cortex" });

expect(readme).toContain("# Agent Cortex");
```

A golden-output test is legitimate when the expected output is a **product of the behaviour
under test** — a parser's AST, a compiler's emitted artifact. It is illegitimate when the file
is static input the test simply re-reads.
