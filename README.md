# Hex-Effect

A functional reference implementation of the [Hexagonal Architecture](<https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)>) for [Domain Driven Design](https://www.domainlanguage.com/ddd/).

Written in Typescript, built with [`Effect`](https://effect.website/).

## Reference

This project was developed with heavy inspiration and reference to the following books.

- <u>[Implementing Domain-Driven Design](https://www.amazon.com/Implementing-Domain-Driven-Design-Vaughn-Vernon/dp/0321834577)</u> by Vaughn Vernon
  - This was the main inspiration. I borrow heavily from the techniques introduced here. This is an absolutely brilliant book, and though it was published in 2013, it is still incredibly relevant. This book uses Java and OO, which I have adapted to Typescript / functional.
- <u>[Domain-Driven Design: Tackling Complexity in the Heart of Software](https://www.amazon.com/Domain-Driven-Design-Tackling-Complexity-Software/dp/0321125215/)</u> by Eric Evans
  - This is the book that describes DDD for the first time, and defined its foundational principles/approach.
- <u>[Get Your Hands Dirty on Clean Architecture](https://www.amazon.com/Hands-Dirty-Clean-Architecture-hands/dp/1839211962)</u> by Tom Hombergs
  - While this implementation differs significantly from what Hombergs describes, it nonetheless was a helpful aid to understanding how a "hexagonal" or "ports and adapters" architecture works.

### Outline

- Motivation
  - Domain Driven Design
  - Hexagonal architecture
- Architecture
  - Domain
  - Application
  - Infrastructure
  - Events
- Packages that are available
