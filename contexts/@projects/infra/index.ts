import { Effect, Context, Layer, Config, ManagedRuntime } from 'effect';
import { TaskId } from '@projects/domain';
import { router, ProjectTransactionalBoundary, CompleteTask } from '@projects/application';
import { Router } from '@effect/rpc';
import { makeTransactionalBoundary2 } from '@hex-effect/infra-kysely-libsql';
import { connect, JetStreamClient, RetentionPolicy, StreamInfo } from 'nats';
import { asyncExitHook } from 'exit-hook';
import { DatabaseConnection, DatabaseSession } from './services.js';
import { DomainServiceLive, EventStore } from './repositories.js';

// all of this stuff can now exist "inside" the transaction boundary

// In the services.js file, there will be a Nats connection service, defined in the hex-effect package,
// which exposes the jetstream, jetstream manager, and stream info
// that gets passed in to the transactional boundary (for publishing)

// and into the yet to be implemented EventHandlerService

class NatsService extends Context.Tag('ProjectNatsConnection')<
  NatsService,
  { jetstream: JetStreamClient; stream: StreamInfo }
>() {
  public static live = Layer.scoped(
    NatsService,
    Effect.gen(function* () {
      const connection = yield* Effect.promise(() => connect());
      const jsm = yield* Effect.promise(() => connection.jetstreamManager());
      const applicationName = yield* Config.string('APPLICATION_NAME');
      const streamInfo = yield* Effect.promise(() =>
        jsm.streams.add({
          name: applicationName,
          subjects: [`${applicationName}.>`],
          retention: RetentionPolicy.Interest
        })
      );
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => connection.drain()).pipe(Effect.andThen(Effect.log('done')))
      );
      return { jetstream: connection.jetstream(), stream: streamInfo };
    })
  );
}

// const EventPublishingDaemon = Layer.scopedDiscard(
//   Effect.gen(function* () {
//     const pub = yield* TransactionEvents;
//     const dequeue = yield* PubSub.subscribe(pub);
//     const { jetstream } = yield* NatsService;
//     const q = doThing(yield* EventStore, jetstream);
//     yield* Queue.take(dequeue)
//       .pipe(
//         Effect.map((a) => a === 'commit'),
//         Effect.if({
//           onTrue: () =>
//             Effect.retry(q.pipe(Effect.tapError((e) => Effect.logError(e))), { times: 3 }),
//           onFalse: () => Effect.void
//         }),
//         Effect.forever
//       )
//       .pipe(Effect.forkScoped);
//   })
// ).pipe(Layer.provide(NatsService.live));

const q = Effect.all([DatabaseConnection, DatabaseSession, EventStore])
  .pipe(Effect.andThen((deps) => makeTransactionalBoundary2(...deps, ProjectTransactionalBoundary)))
  .pipe(Layer.unwrapEffect);

// const TransactionalBoundaryLive = Layer.effect(
//   ProjectTransactionalBoundary,
//   Effect.all([DatabaseConnection, DatabaseSession, TransactionEvents]).pipe(
//     Effect.andThen((deps) => makeTransactionalBoundary(...deps))
//   )
// ).pipe(Layer.provide(EventPublishingDaemon), Layer.provide(TransactionEvents.live));

const InfrastructureLive = q.pipe(
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

await program.pipe(Effect.provide(DomainServiceLive), runtime.runPromise);
await program.pipe(Effect.provide(DomainServiceLive), runtime.runPromise);

asyncExitHook(
  async () => {
    await runtime.dispose();
  },
  { wait: 500 }
);
