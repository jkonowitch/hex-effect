# @hex-effect/core

Core types and abstractions for building domain-driven applications with [Effect](https://effect.website/).

This package defines the shared vocabulary used across all layers of a bounded context: domain events, transactional boundaries, error types, and abstract service interfaces.

## Installation

```bash
pnpm add @hex-effect/core
```

## API

### Domain Events

#### `EventBaseSchema`

The base `Schema.Struct` shared by all domain events. Contains:

| Field        | Type     | Description                |
| ------------ | -------- | -------------------------- |
| `_tag`       | `string` | Event type name            |
| `_context`   | `string` | Bounded context name       |
| `occurredOn` | `Date`   | When the event occurred    |
| `messageId`  | `string` | Unique message ID (nanoid) |

#### `makeDomainEvent(metadata, fields)`

Builder for creating type-safe domain event schemas.

```typescript
import { makeDomainEvent } from '@hex-effect/core';
import { Schema } from 'effect';

const ProjectId = Schema.String.pipe(Schema.brand('ProjectId'));

export const ProjectCreatedEvent = makeDomainEvent(
  { _tag: 'ProjectCreatedEvent', _context: 'Projects' },
  { id: ProjectId }
);

// Create an event instance (requires UUIDGenerator in context):
const event = yield * ProjectCreatedEvent.make({ id: someProjectId });
```

`makeDomainEvent` returns an `EventSchemas` object with:

- `.schema` — the full Effect `Schema.Struct` (includes `EventBaseSchema` fields)
- `.metadata` — `{ _tag, _context }` (used for NATS subject routing)
- `.make(args)` — `Effect` that constructs an event instance, auto-filling `messageId` (nanoid) and `occurredOn` (current time). Requires `UUIDGenerator` in the Effect context.
- `._tag: 'EventSchema'` — discriminant for use with `EventSchemas[]`

#### `EncodableEventBase`

Type alias for any value that satisfies the base event shape and carries a serializable `Schema`. Used as a constraint in `WithTransaction` and `SaveEvents`.

#### `Encodable<F>`

Type alias for a concrete event struct with fields `F`, its serializable schema, and the `DomainEvent` brand. Returned by `make()`.

---

### Transactional Boundary

#### `WithTransaction` (Context service)

Abstract service that wraps a use case in a database transaction. Implemented by the infrastructure layer.

```typescript
class WithTransaction extends Context.Tag('@hex-effect/WithTransaction')<
  WithTransaction,
  <E, R, A extends EncodableEventBase>(
    eff: Effect.Effect<ReadonlyArray<A>, E, R>,
    isolationLevel: IsolationLevel
  ) => Effect.Effect<ReadonlyArray<A>, E | PersistenceError, R>
>() {}
```

The use case `Effect` must return a `ReadonlyArray` of domain events. The transaction implementation is responsible for:

1. Executing the use case within a DB transaction
2. Persisting the returned events to the event store
3. Notifying the `EventPublisherDaemon` to relay them to the message broker

#### `withTXBoundary(level)`

Convenience helper that wraps a use case with `WithTransaction`:

```typescript
import { withTXBoundary, IsolationLevel } from '@hex-effect/core';

export const createProject = (title: string) =>
  Effect.gen(function* () {
    // ... domain logic ...
    return [event];
  }).pipe(withTXBoundary(IsolationLevel.Batched));
```

The resulting `Effect` requires `WithTransaction` in its context, which is provided by the infrastructure layer's `WithTransactionLive`.

#### `IsolationLevel`

```typescript
enum IsolationLevel {
  ReadCommitted = 'ReadCommitted',
  RepeatableReads = 'RepeatableReads',
  Serializable = 'Serializable',
  Batched = 'Batched' // LibSQL / D1: all writes committed atomically at end of tx
}
```

`Batched` is a non-standard mode supported by LibSQL and Cloudflare D1. All writes are collected and submitted as a single `sdk.batch()` call — there are no read-your-writes semantics within the transaction.

---

### Error Types

#### `DataIntegrityError`

Indicates a database constraint or schema violation.

```typescript
class DataIntegrityError extends Data.TaggedError('@hex-effect/DataIntegrityError')<{
  cause: unknown;
}> {}
```

#### `InfrastructureError`

Indicates an infrastructure failure (network, server unavailable, etc.).

```typescript
class InfrastructureError extends Data.TaggedError('@hex-effect/InfrastructureError')<{
  cause: unknown;
}> {}
```

#### `PersistenceError`

```typescript
type PersistenceError = DataIntegrityError | InfrastructureError;
```

#### `isPersistenceError(a)`

Type guard for `PersistenceError`.

---

### Event Consumer

#### `EventConsumer` (Context service)

Abstract service for registering event handlers. Implemented by the infrastructure layer.

```typescript
class EventConsumer extends Context.Tag('@hex-effect/EventConsumer')<
  EventConsumer,
  {
    register<S extends EventSchemas<Schema.Struct.Fields>[], Err, Req>(
      eventSchemas: S,
      handler: (e: S[number]['schema']['Type']) => Effect.Effect<void, Err, Req>,
      config: { $durableName: string }
    ): Effect.Effect<void, never, Req>;
  }
>() {}
```

`$durableName` maps to a durable NATS consumer — messages are delivered at-least-once and retried on failure.

---

### Utilities

#### `UUIDGenerator` (Service)

Generates unique IDs using [nanoid](https://github.com/ai/nanoid). Required by `makeDomainEvent`'s `.make()` method.

```typescript
// Default implementation (uses nanoid):
UUIDGenerator.Default;

// In tests, provide a deterministic override:
Layer.succeed(UUIDGenerator, { generate: () => 'fixed-id' });
```
