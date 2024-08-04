import { Effect, Layer, Logger, LogLevel, ManagedRuntime } from 'effect';
import { InfrastructureLayer } from '@hex-effect/infra-kysely-libsql-nats';
import { DomainServiceLive } from './repositories.js';
import { registerEvents } from '@projects/application';

const EventDaemonLive = Layer.effectDiscard(registerEvents.pipe(Effect.forkDaemon));

export const managedRuntime = ManagedRuntime.make(
  Layer.empty.pipe(
    Layer.provide(EventDaemonLive),
    Layer.provideMerge(DomainServiceLive),
    Layer.provideMerge(InfrastructureLayer),
    Layer.provide(Logger.minimumLogLevel(LogLevel.All)),
    Layer.orDie
  )
);
