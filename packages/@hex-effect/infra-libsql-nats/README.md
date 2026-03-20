# @hex-effect/infra-libsql-nats

LibSQL database provider for [`@hex-effect/core`](../core/README.md), built on top of [`@hex-effect/infra-nats`](../infra-nats/README.md).

Provides:

- `WithTransactionLive` — implements the transactional boundary with LibSQL-specific `Batched` (sdk.batch) and `Serializable` (client.withTransaction) isolation strategies
- `LibsqlConfig` / `LibsqlSdk` — LibSQL client configuration and lifecycle management
- Re-exports `EventConsumerLive`, `EventPublisherDaemon`, `NatsConfig`, `WriteStatement` from `@hex-effect/infra-nats`
- A composed `Live` layer that wires everything together

See [`@hex-effect/infra-pg-nats`](../infra-pg-nats/README.md) for the PostgreSQL equivalent.

## Installation

```bash
pnpm add @hex-effect/infra-libsql-nats
```

## Quick Start

```typescript
import { Live, NatsConfig, LibsqlConfig } from '@hex-effect/infra-libsql-nats';
import { Config, Layer } from 'effect';

const ConfigLive = Layer.succeed(LibsqlConfig, {
  config: Config.succeed({ url: 'http://localhost:8080' })
}).pipe(
  Layer.merge(
    Layer.succeed(NatsConfig, {
      config: Config.succeed({ servers: 'nats://localhost:4222' }),
      appNamespace: Config.succeed('my-app')
    })
  )
);

const AppLive = Live.pipe(Layer.provide(ConfigLive));
```

`Live` is the fully composed layer. It provides `WithTransaction`, `EventConsumer`, and the `EventPublisherDaemon`.

## Configuration

### `LibsqlConfig`

A `Context.Tag` for LibSQL client configuration. Provide a `Config`-wrapped `LibsqlClientConfig` object:

```typescript
Layer.succeed(LibsqlConfig, {
  config: Config.all({
    url: Config.string('DATABASE_URL'),
    authToken: Config.string('DATABASE_AUTH_TOKEN').pipe(Config.withDefault(undefined))
  })
});
```

### `NatsConfig`

A `Context.Tag` for NATS connection configuration:

```typescript
Layer.succeed(NatsConfig, {
  config: Config.all({
    servers: Config.string('NATS_SERVER')
  }),
  appNamespace: Config.string('APP_NAMESPACE')
});
```

`appNamespace` is used as the NATS stream name and subject prefix (e.g. `my-app.@projects.ProjectCreatedEvent`).

## Modules

### `WithTransactionLive`

Implements the `WithTransaction` abstract service from `@hex-effect/core`.

Supports two isolation strategies:

**`IsolationLevel.Batched`** (recommended for LibSQL / Turso / D1)

All SQL writes produced by the use case are collected and submitted as a single atomic `sdk.batch()` call. There are no read-your-writes semantics within the transaction — reads see the pre-transaction state.

```typescript
export const createProject = (title: string) =>
  Effect.gen(function* () {
    // ...
    return [event];
  }).pipe(withTXBoundary(IsolationLevel.Batched));
```

**`IsolationLevel.Serializable`**

Uses LibSQL's `client.withTransaction` for a true serializable transaction. Reads within the use case see committed writes.

After a successful commit, `WithTransactionLive` publishes a notification to `UseCaseCommit`, which wakes the `EventPublisherDaemon`.

### `EventConsumerLive`

Maps `NatsEventConsumer` to the abstract `EventConsumer` interface. Use it to register handlers for domain events:

```typescript
const handler = yield * EventConsumer;
yield *
  handler.register([ProjectCreatedEvent], (event) => Effect.log(`Project created: ${event.id}`), {
    $durableName: 'send-welcome-email'
  });
```

- Each `$durableName` corresponds to a durable NATS consumer — messages are re-delivered on failure.
- Successful handlers are acknowledged with `ackAck()`; decode/handler failures call `term()` (no retry); infrastructure failures call `nak()` with exponential backoff based on delivery count.
- Consumers are created or updated on startup, so adding new subjects to an existing consumer is handled automatically.

### `EventPublisherDaemon`

A scoped `Layer` that runs a background fiber. It:

1. Subscribes to `UseCaseCommit` notifications
2. Queries the database for undelivered events
3. Publishes each event to NATS JetStream (idempotent via `msgID`)
4. Marks events as delivered

Because events are durably stored before the daemon publishes them, event delivery survives application restarts.

### `LibsqlSdk`

Manages the raw `@libsql/client` SDK lifecycle (acquire on startup, close on shutdown). Exposed for use cases that need direct SDK access (e.g. running migrations via `sdk.migrate()`).

```typescript
const { sdk } = yield * LibsqlSdk;
await sdk.migrate([{ sql: 'CREATE TABLE ...', args: [] }]);
```

### `WriteStatement`

A `Context.Tag` for executing SQL write statements. Normally delegates to the LibSQL client directly, but during a `Batched` transaction it is transparently swapped out to collect statements instead.

Use `WriteStatement` instead of calling `sql` directly for all INSERT/UPDATE/DELETE operations so they participate correctly in `Batched` transactions:

```typescript
const write = yield * WriteStatement;
yield * write(sql`INSERT INTO people ${sql.insert(record)}`);
```

## Event Store

The adapter automatically creates a `hex_effect_events` table on startup:

```sql
CREATE TABLE IF NOT EXISTS hex_effect_events (
  message_id TEXT PRIMARY KEY NOT NULL,
  occurred_on TEXT NOT NULL,
  delivered  INTEGER NOT NULL DEFAULT 0,
  payload    TEXT NOT NULL
);
```

Domain events are stored here before being forwarded to NATS, providing an outbox pattern for reliable delivery.

## Testing

The package ships test utilities in `src/test/util.ts` using [Testcontainers](https://testcontainers.com/) to spin up real LibSQL and NATS containers.

> When running inside a devcontainer, set `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` so that the test process can reach the container ports.
