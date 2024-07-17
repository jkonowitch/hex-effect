import { Effect, Context, Layer, FiberRef, Config, PubSub, Queue, ManagedRuntime } from 'effect';
import { TaskId } from '@projects/domain';
import { router, ProjectTransactionalBoundary, CompleteTask } from '@projects/application';
import { Router } from '@effect/rpc';
import { makeTransactionalBoundary, TransactionalBoundary } from '@hex-effect/infra-kysely-libsql';
import { connect, JetStreamClient, RetentionPolicy, StreamInfo } from 'nats';
import { asyncExitHook } from 'exit-hook';
import { doThing, EventStore } from '@hex-effect/infra-kysely-libsql/messaging.js';
import { DatabaseConnection, DatabaseSession } from './services.js';
import { DomainServiceLive } from './repositories.js';

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

class EventStoreService extends Context.Tag('ProjectEventStore')<EventStoreService, EventStore>() {
  public static live = Layer.effect(
    EventStoreService,
    DatabaseSession.pipe(
      Effect.map((session) => ({
        getUnpublished: () =>
          Effect.gen(function* () {
            const { read, queryBuilder } = yield* FiberRef.get(session);
            return yield* read(
              queryBuilder
                .selectFrom('events')
                .select(({ fn, val }) => [
                  'payload',
                  'id',
                  fn<string>('json_extract', ['payload', val('$._tag')]).as('tag'),
                  fn<string>('json_extract', ['payload', val('$._context')]).as('context')
                ])
                .where('delivered', '=', 0)
                .compile()
            ).pipe(Effect.map((r) => r.rows));
          }),
        markPublished: (ids: string[]) =>
          Effect.gen(function* () {
            const { write, queryBuilder } = yield* FiberRef.get(session);
            yield* write(
              queryBuilder
                .updateTable('events')
                .set({ delivered: 1 })
                .where('id', 'in', ids)
                .compile()
            );
          })
      }))
    )
  );
}

const EventPublishingDaemon = Layer.scopedDiscard(
  Effect.gen(function* () {
    const pub = yield* TransactionEvents;
    const dequeue = yield* PubSub.subscribe(pub);
    const { jetstream } = yield* NatsService;
    const q = doThing(yield* EventStoreService, jetstream);
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
).pipe(Layer.provide(NatsService.live), Layer.provide(EventStoreService.live));

const TransactionalBoundaryLive = Layer.effect(
  ProjectTransactionalBoundary,
  Effect.all([DatabaseConnection, DatabaseSession, TransactionEvents]).pipe(
    Effect.andThen((deps) => makeTransactionalBoundary(...deps))
  )
).pipe(Layer.provide(EventPublishingDaemon), Layer.provide(TransactionEvents.live));

const InfrastructureLive = TransactionalBoundaryLive.pipe(
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
