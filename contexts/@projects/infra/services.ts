import { Config, Context, Effect, FiberRef, Layer } from 'effect';
import { Kysely } from 'kysely';
import { DB } from './persistence/schema.js';
import { createClient, type LibsqlError } from '@libsql/client';
import {
  createDatabaseSession,
  LibsqlDialect,
  type DatabaseConnection as DatabaseConnectionService
} from '@hex-effect/infra-kysely-libsql';
import type { DatabaseSession as DatabaseSessionService } from '@hex-effect/infra';

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
