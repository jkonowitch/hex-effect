import { Config, Context, Effect, FiberRef, Layer } from 'effect';
import { Kysely } from 'kysely';
import { DB } from './persistence/schema.js';
import { createClient, type LibsqlError } from '@libsql/client';
import {
  createDatabaseSession,
  LibsqlDialect,
  NatsSubject,
  type DatabaseConnection as DatabaseConnectionService,
  type NatsService as INatsService
} from '@hex-effect/infra-kysely-libsql';
import type { DatabaseSession as DatabaseSessionService } from '@hex-effect/infra';
import { connect, RetentionPolicy } from 'nats';

export class DatabaseConnection extends Context.Tag('ProjectDatabaseConnection')<
  DatabaseConnection,
  DatabaseConnectionService<DB>
>() {
  public static live = Layer.scoped(
    DatabaseConnection,
    Effect.gen(function* () {
      const connectionString = yield* Config.string('PROJECT_DB');
      const client = createClient({ url: connectionString });
      yield* Effect.addFinalizer(() => Effect.sync(() => client.close()));
      return {
        client,
        db: new Kysely<DB>({ dialect: new LibsqlDialect({ client }) })
      };
    })
  );
}

export class DatabaseSession extends Context.Tag('ProjectDatabaseSession')<
  DatabaseSession,
  DatabaseSessionService<DB, LibsqlError>
>() {
  public static live = Layer.scoped(
    DatabaseSession,
    DatabaseConnection.pipe(Effect.andThen(({ db }) => FiberRef.make(createDatabaseSession(db))))
  );
}

export class NatsService extends Context.Tag('ProjectNatsConnection')<NatsService, INatsService>() {
  public static live = Layer.scoped(
    NatsService,
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
        Effect.promise(() => connection.drain()).pipe(
          Effect.tap(Effect.log('Nats connection closed'))
        )
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
