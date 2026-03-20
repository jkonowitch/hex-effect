# @projects/infra

Infrastructure layer for the "projects & tasks" bounded context. Provides concrete implementations of the abstract service ports declared in `@projects/application` and wires everything into deployable `Layer`s.

## Exports

### `Live`

Fully composed layer providing all infrastructure services. Reads configuration from environment variables:

| Variable       | Description                                         |
| -------------- | --------------------------------------------------- |
| `DATABASE_URL` | LibSQL HTTP endpoint (e.g. `http://localhost:8080`) |
| `NATS_SERVER`  | NATS server URL (e.g. `nats://localhost:4222`)      |

```typescript
import { Live } from '@projects/infra';
import { ManagedRuntime } from 'effect';

const runtime = ManagedRuntime.make(Live);
```

`Live` includes `WithTransaction`, `EventConsumer`, and the `EventPublisherDaemon` from `@hex-effect/infra-libsql-nats`, as well as `UUIDGenerator`.

### `ServiceLive`

Layer providing the application-layer service ports (`SaveProject`, `GetAllProjects`). Provide this separately from `Live` when composing in server request handlers:

```typescript
await runtime.runPromise(UseCases.getAllProjects.pipe(Effect.provide(ServiceLive)));
```

## Service Implementations

- **`SaveProjectLive`** — `INSERT INTO projects` via `WriteStatement` (participates in `Batched` transactions)
- **`GetAllProjectsLive`** — `SELECT * FROM projects` decoded through `Project.Model.Project` schema

SQL errors are mapped to `InfrastructureError` and logged before propagating.

## Database Migrations

Tables are created by the application on startup. Add your migration statements to the infrastructure setup using `LibsqlSdk`:

```typescript
const { sdk } = yield * LibsqlSdk;
await sdk.migrate([
  {
    sql: 'CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL)',
    args: []
  }
]);
```
