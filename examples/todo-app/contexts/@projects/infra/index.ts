import { Effect, Layer, Logger, LogLevel, ManagedRuntime } from 'effect';
import { registerEvents, EventHandlerService } from '@projects/application';
import { makeEventHandlerService, WithoutDependencies } from '@hex-effect/infra-kysely-libsql-nats';
import { NatsService } from './services.js';
import { DomainServiceLive } from './repositories.js';

const EventHandlerLive = NatsService.pipe(
  Effect.andThen((nats) => makeEventHandlerService(nats, EventHandlerService))
).pipe(Layer.unwrapEffect);

const EventDaemonLive = Layer.effectDiscard(
  registerEvents.pipe(Effect.provide(DomainServiceLive), Effect.forkDaemon)
);

const InfrastructureLive = EventDaemonLive.pipe(
  Layer.provideMerge(EventHandlerLive),
  Layer.provide(NatsService.live),
  Layer.provideMerge(WithoutDependencies)
);

export const managedRuntime = ManagedRuntime.make(
  DomainServiceLive.pipe(
    Layer.provideMerge(InfrastructureLive),
    Layer.provide(Logger.minimumLogLevel(LogLevel.All)),
    Layer.orDie
  )
);
