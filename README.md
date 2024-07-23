# Hex-Effect

A reference implementation of the [Hexagonal Architecture](<https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)>) for [Domain Driven Design](https://www.domainlanguage.com/ddd/).

Written in Typescript, built with [`Effect`](https://effect.website/).

## Overview

### Motivation

This project is intended to serve as a guide for Typescript developers wanting to write full stack, domain driven applications with a "clean" architecture. Hopefully this makes it a little bit easier to get started.

### Key Features

- Clean separation of domain, application, and infrastructure layers
- Communication between bounded contexts via domain events, backed by a durable message queue
- Example application which demonstrates "how to", as well as an example integration with a UI (Sveltekit, in this case)

All of this is made easy by the incredibly powerful `Effect` library. The centrality of `Effect` to making this approach practicable and production-ready deserves its own section. For now, I'll just mention some of the features that `Effect` lends to this project:

- Dependency injection: abstract services are able to be used/passed around in the "inner" domain/application layers without a clue as to their implementation
- Typesafe serialization / deserialization via `@effect/schema`
- Applications expose their use cases as `@effect/rpc` routers - which are platform and transport agnostic descriptions of an application interface
- Side effect management (concurrency control, retries, logging, observability, etc. etc.) in the infrastructure layer
- And more...

### Brief overview of DDD and Hexagonal Architecture

![hexagonal architecutre](https://wata.es/wp-content/uploads/2021/05/diagrama-arquitectura-hexagonal-wata-factory-1024x796.png)

_source: [Wata Factory](https://wata.es/hexagonal-architecture-introduction-and-structure/)_

- Software is organized into multiple `bounded context`s.
- Each `bounded context` is implemented as three concentric "layers": `domain`, `application` and `infrastructure`.
  - `domain`: expresses the ubiquitous language of your context through its data types and functions (aggregates, entities, repositories, domain events, e.g.).
  - `application`: organizes the domain into named "use cases" and calls domain functions to fulfill these use cases.
  - `infrastructure`: implements incoming adapters (HTTP, message broker consumption, e.g.) as well as outgoing adapters (databases, external APIS, e.g.).
- `bounded context`s communicate asynchronously and in a decoupled manner via domain events, or via RPC if synchronous communication is needed

## Getting Started

- Review the project management context [`contexts/@projects`](./contexts/@projects/) to see how it implements `domain`, `application` and `infrastructure` layers.
  - Note the use of `@hex-effect/infra-kysely-libsql-nats` package in the infrastructure layer. This is a reusable library that implements and structures important features such as the Transactional Boundary, and a durable event consumer.
- Review how bounded contexts are integrated into a UI in [`apps/web`](./apps/web/)
- Implement your own app! You can reuse the `infra-kysely-libsql-nats` adapter, or write your own.

## To Do

- [ ] Demonstration of how authentication/authorization would be integrated via an abstract `RequestContext` service
- [ ] Improve documentation
- [ ] Add a `@hex-effect/infra-postgres` adapter. I suspect an entire infra could be implemented with postgres, including a durable event queue.

## Reference

This project was developed with heavy inspiration and reference to the following books.

- <u>[Implementing Domain-Driven Design](https://www.amazon.com/Implementing-Domain-Driven-Design-Vaughn-Vernon/dp/0321834577)</u> by Vaughn Vernon
  - This was the main inspiration. I borrow heavily from the techniques introduced here. This is an absolutely brilliant book, and though it was published in 2013, it is still incredibly relevant. This book uses Java and OO, which I have adapted to Typescript / functional.
- <u>[Domain-Driven Design: Tackling Complexity in the Heart of Software](https://www.amazon.com/Domain-Driven-Design-Tackling-Complexity-Software/dp/0321125215/)</u> by Eric Evans
  - This is the book that describes DDD for the first time, and defined its foundational principles/approach.
- <u>[Get Your Hands Dirty on Clean Architecture](https://www.amazon.com/Hands-Dirty-Clean-Architecture-hands/dp/1839211962)</u> by Tom Hombergs
  - While this implementation differs significantly from what Hombergs describes, it nonetheless was a helpful aid to understanding how a "hexagonal" or "ports and adapters" architecture works.
