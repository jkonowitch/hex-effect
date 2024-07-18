import { Effect, Fiber, Layer, ManagedRuntime } from 'effect';
import { TaskId } from '@projects/domain';
import {
  router,
  TransactionalBoundary,
  CompleteTask,
  registerEvents,
  EventHandlerService
} from '@projects/application';
import { Router } from '@effect/rpc';
import {
  makeEventHandlerService,
  makeTransactionalBoundary
} from '@hex-effect/infra-kysely-libsql';
import { asyncExitHook } from 'exit-hook';
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

const InfrastructureLive = TransactionalBoundaryLive.pipe(
  Layer.provideMerge(EventHandlerLive),
  Layer.provideMerge(NatsService.live),
  Layer.provideMerge(EventStore.live),
  Layer.provideMerge(DatabaseSession.live),
  Layer.provideMerge(DatabaseConnection.live)
);

const runtime = ManagedRuntime.make(InfrastructureLive);

const handler = Router.toHandlerUndecoded(router);

const program = Effect.zip(
  handler(CompleteTask.make({ taskId: TaskId.make('SS8yZPEBhpn_6W1_hB0ay') })),
  Effect.log('kralf'),
  { concurrent: true }
);

const eventDaemon = registerEvents.pipe(Effect.provide(DomainServiceLive), runtime.runFork);
await program.pipe(Effect.provide(DomainServiceLive), runtime.runPromise);
// await program.pipe(Effect.provide(DomainServiceLive), runtime.runPromise);

asyncExitHook(
  async () => {
    await runtime.runPromise(eventDaemon.pipe(Fiber.interruptFork));
    await runtime.dispose();
  },
  { wait: 1000 }
);
