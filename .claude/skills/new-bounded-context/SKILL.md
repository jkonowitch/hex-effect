---
name: new-bounded-context
description: Scaffold a new bounded context following the domain/application/infra layered architecture used in this todo-app example. Use when the user wants to add a new domain (like @badges was added alongside @projects).
argument-hint: <context-name>
---

Scaffold a new bounded context named `$ARGUMENTS` under `examples/todo-app/contexts/@$ARGUMENTS/`.

## Directory structure to create

```
examples/todo-app/contexts/@<name>/
  domain/
    package.json
    tsconfig.json
    src/
      index.ts        (re-exports everything from domain files)
      <name>.ts       (Schema, domain events, pure domain functions)
  application/
    package.json
    tsconfig.json
    src/
      index.ts
      services.ts     (Context.Tag service ports)
      use-cases.ts    (Effect.gen use cases wrapped with withTXBoundary)
  infra/
    package.json
    tsconfig.json
    src/
      index.ts        (export <Name>InfraLive layer)
      service.ts      (Layer implementations of service ports)
      event-handlers.ts (NatsEventConsumer registrations)
```

## package.json pattern

Copy the pattern from `examples/todo-app/contexts/@badges/domain/package.json` — same `"type": "module"`, `exports` with `node`/`default` conditions pointing to `./src/index.ts`.

- domain deps: `@hex-effect/core`, `effect`
- application deps: `@hex-effect/core`, `@<name>/domain`, `effect`
- infra deps: `@<name>/application`, `@<name>/domain`, `@hex-effect/core`, `@hex-effect/infra-libsql-nats`, `@effect/sql`, `effect`

## tsconfig.json pattern

Copy from `examples/todo-app/contexts/@badges/domain/tsconfig.json`.

## Key implementation rules

### Domain layer

- Use `makeDomainEvent` from `@hex-effect/core` for all events.
- Use `Schema.Struct`, `Schema.brand`, `Schema.Literal` for value objects.
- Pure functions only — no Effect services, no I/O.

### Application layer

- Service ports: `Context.Tag` only, typed as `{ methodName: (...) => Effect<A, PersistenceError> }`.
- Use cases: `Effect.gen` + `withTXBoundary(IsolationLevel.Batched)` or `Serializable`.
- Return `ReadonlyArray<SomeEvent>` from each use case.

### Infra layer

- Service implementations: `Layer.effect(Port, SqlClient.SqlClient.pipe(Effect.map(...)))`.
- Event handlers: `Layer.effectDiscard(Effect.gen(function* () { yield* EventConsumer... }))`.
- `<Name>InfraLive` merges all layers — consumers and services. Does NOT provide `EventConsumer`, `WithTransaction`, `LibsqlClient`, or `UUIDGenerator` (those come from `BaseLive` in `@projects/infra`).

## After scaffolding

1. Add `@<name>/infra` to `examples/todo-app/web/package.json` dependencies.
2. Import `<Name>InfraLive` in `examples/todo-app/contexts/@projects/infra/src/index.ts` and merge it into `Live`.
3. Add any new table migrations to the `MigrationsLive` array in `@projects/infra/src/index.ts`.
4. Run `pnpm install` from the repo root to link the new workspace packages.
5. Run `pnpm check` in each new package to verify types.
