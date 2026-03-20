# @hex-effect/infra-nats

Shared NATS JetStream infrastructure for [`@hex-effect/core`](../core/README.md). Provides the event store, outbox publisher, and durable consumer — without coupling to any specific SQL dialect.

Database-specific providers build on top of this package:

- [`@hex-effect/infra-libsql-nats`](../infra-libsql-nats/README.md) — LibSQL / Turso / D1
- [`@hex-effect/infra-pg-nats`](../infra-pg-nats/README.md) — PostgreSQL

## What this package provides

- `EventStoreLive` — creates the `hex_effect_events` outbox table and wires up `SaveEvents`, `GetUnpublishedEvents`, `MarkAsPublished`
- `EventPublisherDaemon` — background fiber that relays committed events to NATS JetStream
- `EventConsumerLive` — maps `NatsEventConsumer` to the abstract `EventConsumer` interface
- `NatsConfig` / `NatsClient` — NATS connection configuration and lifecycle
- `WriteStatement` — SQL write interceptor that enables atomic batching in `Batched` transactions
- `UseCaseCommit` — `PubSub` used to signal the publisher daemon after a transaction commits

## Configuration

### `NatsConfig`

```typescript
import { NatsConfig } from '@hex-effect/infra-nats';
import { Config, Layer } from 'effect';

Layer.succeed(NatsConfig, {
  config: Config.map(Config.string('NATS_SERVER'), (servers) => ({ servers })),
  appNamespace: Config.string('APP_NAMESPACE')
});
```

`appNamespace` becomes the NATS stream name and subject prefix (e.g. `my-app.@projects.TaskCompletedEvent`).

## Event Store

The `EventStoreLive` layer creates the outbox table on startup via `sql.unsafe(ddl)`. Database providers supply the DDL string so the column types can be dialect-appropriate:

```sql
-- Used by both LibSQL and PostgreSQL providers
CREATE TABLE IF NOT EXISTS hex_effect_events (
  message_id TEXT PRIMARY KEY NOT NULL,
  occurred_on TEXT NOT NULL,
  delivered  INTEGER NOT NULL DEFAULT 0,
  payload    TEXT NOT NULL
);
```

## `WriteStatement`

A `Context.Tag` for SQL write statements. During normal execution it delegates directly to the SQL client. During a `Batched` transaction the provider swaps in an executor that collects statements instead of running them, enabling atomic batch submission.

Always use `WriteStatement` (never the SQL client directly) for INSERT/UPDATE/DELETE operations:

```typescript
const write = yield* WriteStatement;
yield* write(sql`INSERT INTO projects ${sql.insert(project)}`);
```

## `EventPublisherDaemon`

A `Layer.scopedDiscard` that runs a background fiber:

1. Drains any `delivered = 0` events on startup (crash recovery)
2. Subscribes to `UseCaseCommit` notifications
3. For each commit: reads undelivered events, publishes to NATS (idempotent via `msgID`), marks as delivered

## `EventConsumerLive`

Maps `NatsEventConsumer` to the abstract `EventConsumer` from `@hex-effect/core`. Register handlers using the standard interface:

```typescript
const consumer = yield* EventConsumer;
yield* consumer.register(
  [TaskCompletedEvent],
  (event) => Effect.log(`Task completed: ${event.taskId}`),
  { $durableName: 'projects-task-completed' }
);
```

- Successful handlers: `ackAck()`
- Decode/handler failures: `term()` (no retry)
- Infrastructure failures: `nak()` with exponential backoff
