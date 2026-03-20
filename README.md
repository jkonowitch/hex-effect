# Hex-Effect

A reference implementation of [Hexagonal Architecture](<https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)>) for [Domain-Driven Design](https://www.domainlanguage.com/ddd/), written in TypeScript with [`Effect`](https://effect.website/).

## Overview

### Motivation

This project serves as a guide for TypeScript developers building full-stack, domain-driven applications with a clean architecture. It provides reusable libraries and a worked example so you can see the patterns in action before adapting them to your own use cases.

### Key Features

- Clean separation of `domain`, `application`, and `infrastructure` layers
- Domain events as first-class citizens, published durably via NATS JetStream
- Transactional boundaries that atomically commit both database writes and event records
- Type-safe serialization and dependency injection throughout, powered by `Effect`
- An example full-stack application (SvelteKit + LibSQL + NATS)

### How Effect Enables This

[Effect](https://effect.website/) is the backbone of the entire architecture:

- **Dependency injection** — abstract services (`Context.Tag`) are defined in inner layers, with concrete implementations injected via `Layer` at the infrastructure boundary
- **Type-safe serialization** — `Schema` drives all domain event encoding/decoding and database round-trips
- **Structured concurrency** — background daemons, scoped resources, and fiber management are all handled by the Effect runtime
- **Error modeling** — domain, application, and infrastructure errors are distinct tagged types tracked in the type signature

## Architecture

```
bounded context
├── domain        Pure business logic: aggregates, domain events, invariants
├── application   Use case orchestration: abstract service ports, workflows
└── infrastructure  Concrete adapters: SQL, NATS, HTTP handlers
```

Multiple bounded contexts communicate asynchronously via domain events. Within a context, the application layer calls domain functions and depends on abstract services whose implementations are provided by the infrastructure layer.

```
┌─────────────────────────────────────────────────────┐
│                  infrastructure                      │
│  ┌───────────────────────────────────────────────┐  │
│  │                  application                  │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │               domain                   │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Repository Layout

```
packages/
  @hex-effect/core                  Core DDD types and abstractions
  @hex-effect/infra-libsql-nats     Infrastructure adapter (LibSQL + NATS JetStream)

examples/
  todo-app/
    contexts/@projects/
      domain                        Domain layer for the "projects" bounded context
      application                   Application layer (use cases + service ports)
      infra                         Infrastructure implementations
    web/                            SvelteKit frontend
```

## Getting Started

> ⚠️ Alpha quality — breaking changes are expected.

**Requirements:** pnpm ≥ 9, Bun ≥ 1, Docker (for testcontainers / local NATS + LibSQL)

```bash
pnpm install
pnpm build
pnpm test
```

### Running the Example App

The example app requires a running LibSQL server and NATS server. Configure them via environment variables:

```
DATABASE_URL=http://localhost:8080
NATS_SERVER=nats://localhost:4222
```

Then:

```bash
pnpm dev
```

## Packages

| Package                                                                               | Description                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`@hex-effect/core`](./packages/@hex-effect/core/README.md)                           | Base types for domain events, transactions, and service ports |
| [`@hex-effect/infra-libsql-nats`](./packages/@hex-effect/infra-libsql-nats/README.md) | Ready-to-use infrastructure adapter for LibSQL + NATS         |

## Example Application

See [`examples/todo-app`](./examples/todo-app/README.md) for a full walkthrough of the "projects & tasks" bounded context and how it integrates into a SvelteKit UI.

## References

- [Implementing Domain-Driven Design](https://www.amazon.com/Implementing-Domain-Driven-Design-Vaughn-Vernon/dp/0321834577) — Vaughn Vernon
- [Domain Modeling Made Functional](https://pragprog.com/titles/swdddf/domain-modeling-made-functional/) — Scott Wlaschin
- [Domain-Driven Design](https://www.amazon.com/Domain-Driven-Design-Tackling-Complexity-Software/dp/0321125215/) — Eric Evans
- [Get Your Hands Dirty on Clean Architecture](https://www.amazon.com/Hands-Dirty-Clean-Architecture-hands/dp/1839211962) — Tom Hombergs
