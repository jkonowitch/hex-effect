# @hex-effect/infra-pg-nats

PostgreSQL database provider for [`@hex-effect/core`](../core/README.md), built on top of [`@hex-effect/infra-nats`](../infra-nats/README.md).

Provides:

- `WithTransactionLive` — implements the transactional boundary using `client.withTransaction` (both `Batched` and `Serializable` isolation levels map to a serializable PG transaction)
- `PgConfig` — PostgreSQL client configuration
- Re-exports `EventConsumerLive`, `EventPublisherDaemon`, `NatsConfig`, `WriteStatement` from `@hex-effect/infra-nats`
- A composed `Live` layer that wires everything together

See [`@hex-effect/infra-libsql-nats`](../infra-libsql-nats/README.md) for the LibSQL equivalent.

## Installation

```bash
pnpm add @hex-effect/infra-pg-nats
```

## Quick Start

```typescript
import { Live, PgConfig } from '@hex-effect/infra-pg-nats';
import { NatsConfig } from '@hex-effect/infra-nats';
import { Config, Layer, Redacted } from 'effect';

const ConfigLive = Layer.succeed(PgConfig, {
  config: Config.map(Config.string('DATABASE_URL'), (url) => ({ url: Redacted.make(url) }))
}).pipe(
  Layer.merge(
    Layer.succeed(NatsConfig, {
      config: Config.map(Config.string('NATS_SERVER'), (servers) => ({ servers })),
      appNamespace: Config.string('APP_NAMESPACE')
    })
  )
);

const AppLive = Live.pipe(Layer.provide(ConfigLive));
```

## Configuration

### `PgConfig`

A `Context.Tag` wrapping `PgClientConfig` from `@effect/sql-pg`:

```typescript
Layer.succeed(PgConfig, {
  config: Config.map(Config.string('DATABASE_URL'), (url) => ({ url: Redacted.make(url) }))
});
```

The client is configured with `camelToSnake` query name transforms and `snakeToCamel` result transforms, so JavaScript camelCase properties map to snake_case columns automatically.

## `WithTransactionLive`

Both `IsolationLevel.Batched` and `IsolationLevel.Serializable` use `client.withTransaction` (PostgreSQL serializable transaction). Unlike LibSQL's `Batched` mode, PostgreSQL transactions provide full read-your-writes semantics within the use case.

PostgreSQL constraint violations (error class `23`) are mapped to `DataIntegrityError`; all other SQL errors map to `InfrastructureError`.

## Event Store

The adapter creates the `hex_effect_events` table on startup using the same dialect-agnostic schema as `@hex-effect/infra-libsql-nats`:

```sql
CREATE TABLE IF NOT EXISTS hex_effect_events (
  message_id TEXT PRIMARY KEY NOT NULL,
  occurred_on TEXT NOT NULL,
  delivered  INTEGER NOT NULL DEFAULT 0,
  payload    TEXT NOT NULL
);
```

## Schema considerations

PostgreSQL returns `COUNT(*)` as a bigint string (e.g. `"42"`). When decoding query results that include counts, use a union schema:

```typescript
Schema.Struct({
  count: Schema.Union(Schema.Number, Schema.NumberFromString)
})
```

## Testing

The package ships test utilities in `src/test/util.ts` using [Testcontainers](https://testcontainers.com/) to spin up real PostgreSQL and NATS containers.

> When running inside a devcontainer, set `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` so that the test process can reach the container ports.
