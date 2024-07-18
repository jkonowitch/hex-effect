import { Effect, Context, Layer, Config, ManagedRuntime } from 'effect';
import { TaskId } from '@projects/domain';
import { router, ProjectTransactionalBoundary, CompleteTask } from '@projects/application';
import { Router } from '@effect/rpc';
import { makeTransactionalBoundary } from '@hex-effect/infra-kysely-libsql';
import { connect, RetentionPolicy } from 'nats';
import { asyncExitHook } from 'exit-hook';
import { DatabaseConnection, DatabaseSession } from './services.js';
import { DomainServiceLive, EventStore } from './repositories.js';
import { NatsService, NatsSubject } from '@hex-effect/infra-kysely-libsql/messaging.js';

// all of this stuff can now exist "inside" the transaction boundary

// In the services.js file, there will be a Nats connection service, defined in the hex-effect package,
// which exposes the jetstream, jetstream manager, and stream info
// that gets passed in to the transactional boundary (for publishing)

// and into the yet to be implemented EventHandlerService

class ProjectNatsService extends Context.Tag('ProjectNatsConnection')<
  ProjectNatsService,
  NatsService
>() {
  public static live = Layer.scoped(
    ProjectNatsService,
    Effect.gen(function* () {
      const connection = yield* Effect.promise(() => connect());
      const jetstreamManager = yield* Effect.promise(() => connection.jetstreamManager());
      const applicationName = yield* Config.string('APPLICATION_NAME');
      const streamInfo = yield* Effect.promise(() =>
        jetstreamManager.streams.add({
          name: applicationName,
          subjects: [`${applicationName}.>`],
          retention: RetentionPolicy.Interest
        })
      );
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => connection.drain()).pipe(Effect.andThen(Effect.log('done')))
      );
      return {
        jetstream: connection.jetstream(),
        streamInfo: streamInfo,
        jetstreamManager,
        eventToSubject: (event) => {
          return NatsSubject.make({
            ApplicationNamespace: applicationName,
            BoundedContext: event.context,
            EventTag: event.tag
          });
        }
      };
    })
  );
}

const q = Effect.all([DatabaseConnection, DatabaseSession, EventStore, ProjectNatsService])
  .pipe(Effect.andThen((deps) => makeTransactionalBoundary(...deps, ProjectTransactionalBoundary)))
  .pipe(Layer.unwrapEffect);

const InfrastructureLive = q.pipe(
  Layer.provideMerge(ProjectNatsService.live),
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
