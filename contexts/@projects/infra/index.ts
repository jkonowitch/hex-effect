import { Effect, Context, Layer, Config, PubSub, Queue, ManagedRuntime } from 'effect';
import { TaskId } from '@projects/domain';
import { router, ProjectTransactionalBoundary, CompleteTask } from '@projects/application';
import { Router } from '@effect/rpc';
import { makeTransactionalBoundary, TransactionalBoundary } from '@hex-effect/infra-kysely-libsql';
import { connect, JetStreamClient, RetentionPolicy, StreamInfo } from 'nats';
import { asyncExitHook } from 'exit-hook';
import { doThing } from '@hex-effect/infra-kysely-libsql/messaging.js';
import { DatabaseConnection, DatabaseSession } from './services.js';
import { DomainServiceLive, EventStore } from './repositories.js';

class TransactionEvents extends Context.Tag('ProjectTransactionEvents')<
  TransactionEvents,
  PubSub.PubSub<keyof TransactionalBoundary>
>() {
  public static live = Layer.effect(
    TransactionEvents,
    PubSub.sliding<keyof TransactionalBoundary>(10)
  );
}

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

const EventPublishingDaemon = Layer.scopedDiscard(
  Effect.gen(function* () {
    const pub = yield* TransactionEvents;
    const dequeue = yield* PubSub.subscribe(pub);
    const { jetstream } = yield* NatsService;
    const q = doThing(yield* EventStore, jetstream);
    yield* Queue.take(dequeue)
      .pipe(
        Effect.map((a) => a === 'commit'),
        Effect.if({
          onTrue: () =>
            Effect.retry(q.pipe(Effect.tapError((e) => Effect.logError(e))), { times: 3 }),
          onFalse: () => Effect.void
        }),
        Effect.forever
      )
      .pipe(Effect.forkScoped);
  })
).pipe(Layer.provide(NatsService.live));

const TransactionalBoundaryLive = Layer.effect(
  ProjectTransactionalBoundary,
  Effect.all([DatabaseConnection, DatabaseSession, TransactionEvents]).pipe(
    Effect.andThen((deps) => makeTransactionalBoundary(...deps))
  )
).pipe(Layer.provide(EventPublishingDaemon), Layer.provide(TransactionEvents.live));

const InfrastructureLive = TransactionalBoundaryLive.pipe(
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
