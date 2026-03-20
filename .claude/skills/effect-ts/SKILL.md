---
name: effect-ts
description: This skill should be used when the user is working with Effect-TS, asks to "write Effect code", "use Effect", "functional TypeScript", "handle errors with Effect", "dependency injection Effect", or needs expert-level guidance on Effect-TS patterns, error handling, services/layers, concurrency, and best practices. Also activates when refactoring imperative TypeScript (if/else if chains, try/catch, let mutation, unsafe forks) to idiomatic Effect patterns.
---

# Effect-TS Expert

Expert guidance for functional programming with the Effect library, covering error handling, dependency injection,
composability, concurrency, and production-ready patterns.

## Prerequisites Check

Before starting any Effect-related work, verify the Effect-TS source code exists at `~/.effect`.

**If missing, stop immediately and inform the user.** Clone it before proceeding:

```bash
git clone https://github.com/Effect-TS/effect.git ~/.effect
```

## Research Strategy

Effect-TS has many ways to accomplish the same task. Proactively research best practices by spawning research agents
when working with Effect patterns, especially for moderate to high complexity tasks.

### Research Sources (Priority Order)

1. **Codebase Patterns First** — Examine similar patterns in the current project before implementing. If Effect patterns
   exist in the codebase, follow them for consistency.

2. **Effect Source Code** — For complex type errors, unclear behavior, or implementation details, examine
   `~/.effect/packages/effect/src/`.

### When to Research

**HIGH Priority (Always Research):**

- Implementing Services, Layers, or complex dependency injection
- Error handling with multiple error types or complex error hierarchies
- Stream-based operations and reactive patterns
- Resource management with scoped effects and cleanup
- Concurrent/parallel operations and performance-critical code

**MEDIUM Priority (Research if Complex):**

- Refactoring imperative code (try-catch, promises) to Effect patterns
- Adding new service dependencies or restructuring service layers
- Integrations with external systems (databases, APIs, third-party services)

## Codebase Pattern Discovery

When working in a project that uses Effect, check for existing patterns before implementing new code:

1. **Search for Effect imports** — Look for files importing from `'effect'` to understand existing usage
2. **Identify service patterns** — Find how Services and Layers are structured in the project
3. **Note error handling conventions** — Check how errors are defined and propagated
4. **Examine test patterns** — Look at how Effect code is tested in the project

## Critical Rules

- **INEFFECTIVE:** try-catch inside `Effect.gen` (Effect failures are not thrown — they never reach a catch block)
- **AVOID:** Type assertions (`as never/any/unknown`) except when TypeScript cannot infer Match return types
- **RECOMMENDED:** `return yield*` pattern for errors (makes termination explicit)
- **PREFER:** `Effect.fn()` for named functions — provides automatic tracing, telemetry, and better stack traces

## The Effect Type

```typescript
Effect<Success, Error, Requirements>;
//     ^        ^       ^
//     |        |       └── Services/dependencies needed (Context)
//     |        └────────── Typed error channel
//     └─────────────────── Success value type
```

Effects are lazy descriptions of computations. They don't execute until run.

## Creating Effects

```typescript
Effect.succeed(value); // Wrap success value
Effect.fail(error); // Create typed failure
Effect.sync(fn); // Wrap synchronous non-throwing function
Effect.try({ try: fn, catch: fn }); // Wrap synchronous throwing function
Effect.promise(fn); // Wrap promise (failures become defects)
Effect.tryPromise(fn); // Wrap promise — failures as UnknownException (.error holds raw error)
Effect.tryPromise({ try: fn, catch: fn }); // Wrap promise with explicit error mapping

// From callbacks
Effect.async<string, Error>((resume) => {
  someCallbackApi((err, result) => {
    if (err) resume(Effect.fail(err));
    else resume(Effect.succeed(result));
  });
});
```

## Running Effects

```typescript
Effect.runSync(effect); // Sync only — throws on async or error
Effect.runPromise(effect); // Returns Promise<A>, rejects on error
Effect.runPromiseExit(effect); // Returns Promise<Exit<A, E>>

// Production: use a ManagedRuntime
const runtime = ManagedRuntime.make(AppLayer);
await runtime.runPromise(effect);
await runtime.dispose(); // cleanup on shutdown
```

## Building Pipelines

```typescript
// pipe (point-free style)
const program = pipe(
  Effect.succeed(5),
  Effect.map((n) => n * 2),
  Effect.flatMap((n) => (n > 5 ? Effect.succeed(n) : Effect.fail(new SmallError())))
);

// Effect.gen (RECOMMENDED for readable sequential code)
const program = Effect.gen(function* () {
  const n = yield* Effect.succeed(5);
  const doubled = n * 2;
  if (doubled <= 5) return yield* Effect.fail(new SmallError());
  yield* Effect.log(`Result: ${doubled}`);
  return doubled;
});

// Effect.fn — automatic tracing for named functions
const fetchUser = Effect.fn('fetchUser')(function* (id: string) {
  const db = yield* Database;
  return yield* db.query(id);
});
```

## Error Handling

### Typed Errors vs Defects

| Type            | Use Case                                             | Recovery                |
| --------------- | ---------------------------------------------------- | ----------------------- |
| **Typed Error** | Domain failures (validation, not found, permissions) | Yes — caller can handle |
| **Defect**      | Bugs, invariant violations, unrecoverable state      | No — terminates fiber   |

```typescript
// Typed errors — tracked in the type system
class NotFoundError extends Data.TaggedError('NotFoundError')<{
  readonly id: string;
}> {}

class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly message: string;
}> {}

// Defects — for bugs, not domain errors
const divide = (a: number, b: number) =>
  b === 0 ? Effect.die(new Error('Division by zero — this is a bug!')) : Effect.succeed(a / b);
```

### Error Recovery

```typescript
Effect.catchAll(effect, (error) => Effect.succeed(fallback));
Effect.catchTag(effect, 'NotFoundError', (e) => Effect.succeed(defaultUser));
Effect.catchTags(effect, {
  NotFoundError: (e) => Effect.succeed(defaultUser),
  ValidationError: (e) => Effect.fail(new HttpError(400, e.message))
});
Effect.either(effect); // Effect<Either<E, A>>
Effect.retry(effect, Schedule.recurs(3));
Effect.orElse(effect, () => fallbackEffect);

// Normalize unknown errors at a boundary
Effect.catchAllDefect(effect, (defect) => Effect.fail(new InfrastructureError({ cause: defect })));
```

### Error Taxonomy

| Category                | Examples                   | Handling                  |
| ----------------------- | -------------------------- | ------------------------- |
| **Expected Rejections** | User cancel, deny          | Graceful exit, no retry   |
| **Domain Errors**       | Validation, business rules | Show to user, don't retry |
| **Defects**             | Bugs, assertions           | Log + alert, investigate  |
| **Interruptions**       | Fiber cancel, timeout      | Cleanup, may retry        |
| **Unknown/Foreign**     | Thrown exceptions          | Normalize at boundary     |

## Refactoring Cheatsheet

Use these when replacing imperative TypeScript with Effect idioms.

### Dispatch: Replace if/else if/else with Match

**Before:**

```typescript
if (e instanceof ApplicationError) {
  return e;
} else if (isPersistenceError(e)) {
  return new ApplicationError({ kind: ErrorKinds.Infrastructure });
} else if (isTagged('ParseError')(e)) {
  return new ApplicationError({ kind: ErrorKinds.BadRequest });
} else {
  return e as never;
}
```

**After:**

```typescript
Match.type<E>().pipe(
  Match.when(Match.instanceOf(ApplicationError), (e) => e),
  Match.when(isPersistenceError, () => new ApplicationError({ kind: ErrorKinds.Infrastructure })),
  Match.when(isTagged('ParseError'), () => new ApplicationError({ kind: ErrorKinds.BadRequest })),
  Match.orElse((e) => e as never)
);
```

### Named effects over let mutation

**Before:**

```typescript
let program;
if (level === IsolationLevel.Batched) {
  program = batched;
} else {
  program = serializable;
}
return program;
```

**After:**

```typescript
return Match.value(level).pipe(
  Match.when(IsolationLevel.Batched, () => batched),
  Match.when(IsolationLevel.Serializable, () => serializable),
  Match.orElse(() => Effect.dieMessage(`${level} not supported`))
);
```

### Conditional effects: Replace if guard with Effect.when

**Before:**

```typescript
if (writes.length > 0) {
  yield * Effect.tryPromise(() => sdk.batch(writes));
}
```

**After:**

```typescript
yield * Effect.tryPromise(() => sdk.batch(writes)).pipe(Effect.when(() => writes.length > 0));
```

### Error mapping: Replace try/catch with Effect.tryPromise + mapError

**Before:**

```typescript
yield *
  Effect.tryPromise({
    try: () => sdk.batch(writes),
    catch: (e) => classifyError(e)
  });
```

**After:**

```typescript
yield *
  Effect.tryPromise(() => sdk.batch(writes)).pipe(Effect.mapError((e) => classifyError(e.error)));
```

> The single-argument form wraps failures as `UnknownException`; the raw error is in `.error`.

## Pattern Matching (Match Module)

**Default branching tool for tagged unions, complex conditionals, and imperative dispatch.**

```typescript
import { Match } from 'effect';

// Match on _tag field — use Match.tag for tagged unions
const handleError = Match.type<AppError>().pipe(
  Match.tag('NotFoundError', (e) => `Not found: ${e.id}`),
  Match.tag('ValidationError', (e) => e.message),
  Match.tag('NetworkError', () => 'Connection failed'),
  Match.exhaustive // Compile error if a case is missing
);

// Match with predicates — use Match.when for instanceof, branded types, custom guards
const classify = Match.type<E>().pipe(
  Match.when(Match.instanceOf(ApplicationError), (e) => e),
  Match.when(isPersistenceError, () => new ApplicationError({ kind: 'Infrastructure' })),
  Match.when(isTagged('ParseError'), () => new ApplicationError({ kind: 'BadRequest' })),
  Match.orElse((e) => e)
);

// Match on a concrete value (cleaner than if/else)
const describe = Match.value(status).pipe(
  Match.when('pending', () => 'Loading...'),
  Match.when('success', () => 'Done!'),
  Match.orElse(() => 'Unknown')
);

// Replace nested catchTag chains
Effect.catchAll(effect, (error) =>
  Match.value(error).pipe(Match.tag('A', handleA), Match.tag('B', handleB), Match.exhaustive)
);
```

> **TypeScript caveat:** When Match return types fail to unify, add a cast: `as (e: T) => R`

## Services and Layers

### Context.Tag (implementation provided separately via Layer)

```typescript
class UserRepository extends Context.Tag('UserRepository')<
  UserRepository,
  {
    readonly findById: (id: string) => Effect.Effect<User, NotFoundError>;
    readonly save: (user: User) => Effect.Effect<void>;
  }
>() {}

const getUser = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* UserRepository;
    return yield* repo.findById(id);
  });
// Type: Effect<User, NotFoundError, UserRepository>

const UserRepositoryLive = Layer.effect(
  UserRepository,
  Effect.gen(function* () {
    const db = yield* Database;
    return {
      findById: (id) => db.query(id),
      save: (user) => db.save(user)
    };
  })
);
```

### Effect.Service (default implementation bundled)

```typescript
class Logger extends Effect.Service<Logger>()('Logger', {
  effect: Effect.gen(function* () {
    const config = yield* Config;
    return {
      log: (msg: string) => Effect.sync(() => console.log(`[${config.level}] ${msg}`))
    };
  }),
  dependencies: [ConfigLive],
  accessors: true
}) {}

Effect.provide(program, Logger.Default);
```

### Layer Composition

```typescript
// Merge independent layers
const BaseLayer = Layer.merge(ConfigLive, LoggerLive);

// Provide dependencies to a layer
const DbLayer = Layer.provide(DatabaseLive, ConfigLive);

// Full app composition
const AppLayer = pipe(
  Layer.merge(ConfigLive, LoggerLive),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(UserRepositoryLive)
);

// Shared infrastructure layers (e.g. DB + NATS shared across bounded contexts)
export const Live = Layer.mergeAll(ProjectsLive, BadgesLive).pipe(
  Layer.provideMerge(BaseLive) // BaseLive provides EventConsumer, WithTransaction, SqlClient
);
```

## Fiber Scoping

`Effect.fork` attaches the child fiber to the **parent fiber's scope**. When the parent exits (e.g. the
layer-build fiber finishes), the child is immediately interrupted. This is the root cause of long-lived
stream consumers or daemons dying after the first message.

```typescript
// BUG: stream fiber dies when the layer-build fiber exits
yield * Effect.fork(stream);

// FIX: tie to the runtime/scope lifetime, not the build fiber
const scope = yield * Effect.scope;
yield * Effect.forkIn(stream, scope);

// Shorthand when already inside a scoped effect
yield * stream.pipe(Effect.forkScoped);
```

## Concurrency

```typescript
// Fibers
const fiber = yield * Effect.fork(task); // scope = parent fiber
const fiber = yield * Effect.forkScoped(task); // scope = current scope
const fiber = yield * Effect.forkIn(task, scope); // explicit scope
const result = yield * Fiber.join(fiber);
yield * Fiber.interrupt(fiber);

// Parallelism
const results = yield * Effect.all([task1, task2, task3]);
const results = yield * Effect.all(tasks, { concurrency: 5 });
const fastest = yield * Effect.race(task1, task2);

// Synchronization
const counter = yield * Ref.make(0);
yield * Ref.update(counter, (n) => n + 1);

const queue = yield * Queue.bounded<number>(100);
yield * Queue.offer(queue, 42);
const item = yield * Queue.take(queue);

const sem = yield * Effect.makeSemaphore(3);
yield * sem.withPermits(1)(expensiveOperation);

const deferred = yield * Deferred.make<string, Error>();
yield * Deferred.succeed(deferred, 'done');
const value = yield * Deferred.await(deferred);
```

## Resource Management

```typescript
// Acquire/release
const resource = Effect.acquireRelease(
  Effect.sync(() => openResource()),
  (r) => Effect.sync(() => r.close())
);

const program = Effect.scoped(
  Effect.gen(function* () {
    const r = yield* resource;
    return yield* use(r);
  })
); // resource automatically closed after scope

// Finalizers
Effect.addFinalizer((exit) => Effect.log(`Cleanup: ${exit._tag}`));
```

## Configuration

```typescript
import { Config, ConfigProvider, Layer } from 'effect';

const port = Config.number('PORT');
const host = Config.string('HOST').pipe(Config.withDefault('localhost'));
const apiKey = Config.redacted('API_KEY'); // masked in logs; unwrap with Redacted.value(...)

// Nested with prefix: DATABASE_HOST, DATABASE_PORT
const dbConfig = Config.all({
  host: Config.string('HOST'),
  port: Config.number('PORT')
}).pipe(Config.nested('DATABASE'));

// Custom provider (e.g. for tests)
Effect.provide(
  program,
  Layer.setConfigProvider(ConfigProvider.fromMap(new Map([['PORT', '3000']])))
);
```

## Scheduling and Duration

```typescript
// Duration — string syntax preferred
Duration.toMillis('5 minutes'); // 300000
Duration.toMillis('30 seconds'); // 30000
Duration.toMillis('100 millis'); // 100
// Units: nanos, micros, millis, seconds, minutes, hours, days, weeks

// Scheduling
Effect.retry(effect, Schedule.exponential('100 millis'));
Effect.repeat(effect, Schedule.fixed('1 second'));
Schedule.compose(s1, s2);
```

## Array Operations

```typescript
import { Array as Arr, Order } from 'effect';

Arr.sort([3, 1, 2], Order.number);
Arr.sortWith(users, (u) => u.age, Order.number);
Arr.sortBy(
  users,
  Order.mapInput(Order.number, (u: User) => u.age),
  Order.mapInput(Order.string, (u: User) => u.name)
);
```

## Quick Reference

### Common Operators

| Operator            | Purpose                            |
| ------------------- | ---------------------------------- |
| `Effect.map`        | Transform success value            |
| `Effect.flatMap`    | Chain effects (monadic bind)       |
| `Effect.tap`        | Side effect, keep original value   |
| `Effect.andThen`    | Sequence — accepts value or effect |
| `Effect.catchAll`   | Handle all errors                  |
| `Effect.catchTag`   | Handle a specific tagged error     |
| `Effect.catchTags`  | Handle multiple tagged errors      |
| `Effect.provide`    | Inject dependencies                |
| `Effect.retry`      | Retry with a schedule              |
| `Effect.timeout`    | Add a timeout                      |
| `Effect.fork`       | Run concurrently (parent scope)    |
| `Effect.forkScoped` | Run concurrently (current scope)   |
| `Effect.all`        | Parallel execution                 |
| `Effect.when`       | Conditionally run an effect        |

### When to Use What

| Scenario                    | Use                                           |
| --------------------------- | --------------------------------------------- |
| Transform value             | `Effect.map`                                  |
| Chain effects               | `Effect.flatMap` or `Effect.gen`              |
| Error recovery              | `Effect.catchTag` / `Effect.catchAll`         |
| Dispatch on type            | `Match.type<T>().pipe(Match.tag/when, ...)`   |
| Conditional execution       | `Effect.when`                                 |
| Parallel execution          | `Effect.all` with `concurrency`               |
| Long-lived background fiber | `Effect.forkScoped` or `Effect.forkIn(scope)` |
| Share mutable state         | `Ref`                                         |
| Producer/consumer           | `Queue`                                       |
| One-time signal             | `Deferred`                                    |
| Limit concurrency           | `Semaphore`                                   |
| Cleanup resources           | `Effect.acquireRelease` + `Effect.scoped`     |

## Deprecations

- **`BigDecimal.fromNumber`** — Use `BigDecimal.unsafeFromNumber` instead (3.11.0+)
- **`Schema.annotations()`** — Now removes previously set identifier annotations (3.17.10)
- **`SubscriptionRef.unsafeMake`** — Use `SubscriptionRef.make` instead

## Additional Resources

- **`~/.effect/packages/effect/src/`** — Core Effect modules and implementation
- **Effect-Atom** — https://github.com/tim-smart/effect-atom (reactive state management)
