import { Effect, Layer, Logger, LogLevel, ManagedRuntime } from 'effect';
import { TransactionalBoundary, registerEvents, EventHandlerService } from '@projects/application';
import {
  makeEventHandlerService,
  makeTransactionalBoundary
} from '@hex-effect/infra-kysely-libsql';
import { DatabaseConnection, DatabaseSession, NatsService } from './services.js';
import { DomainServiceLive, EventStore } from './repositories.js';

const TransactionalBoundaryLive = Effect.all([
  DatabaseConnection,
  DatabaseSession,
  EventStore,
  NatsService
])
  .pipe(Effect.andThen((deps) => makeTransactionalBoundary(...deps, TransactionalBoundary)))
  .pipe(Layer.unwrapEffect);

const EventHandlerLive = NatsService.pipe(
  Effect.andThen((nats) => makeEventHandlerService(nats, EventHandlerService))
).pipe(Layer.unwrapEffect);

const EventDaemonLive = Layer.effectDiscard(
  registerEvents.pipe(Effect.provide(DomainServiceLive), Effect.forkDaemon)
);

const InfrastructureLive = TransactionalBoundaryLive.pipe(
  Layer.provide(EventDaemonLive),
  Layer.provideMerge(EventHandlerLive),
  Layer.provide(NatsService.live),
  Layer.provideMerge(EventStore.live),
  Layer.provideMerge(DatabaseSession.live),
  Layer.provide(DatabaseConnection.live)
);

export const managedRuntime = ManagedRuntime.make(
  DomainServiceLive.pipe(
    Layer.provideMerge(InfrastructureLive),
    Layer.provide(Logger.minimumLogLevel(LogLevel.All)),
    Layer.orDie
  )
);
