import type { Database as SqliteDB } from 'better-sqlite3';
import { Data, Effect, Context, Layer, Ref } from 'effect';
import type { UnknownException } from 'effect/Cause';
import type { Kysely, CompiledQuery } from 'kysely';
import type { DB } from './persistence/schema.js';

export class KyselyError extends Data.TaggedError('KyselyError')<{
  readonly error: unknown;
}> {}

export class Database extends Context.Tag('KyselyEffect')<
  Database,
  {
    direct: Kysely<DB>;
    call: <A>(f: (db: Kysely<DB>) => Promise<A>) => Effect.Effect<A, KyselyError>;
  }
>() {}

export class SqliteClient extends Context.Tag('SqliteClient')<
  SqliteClient,
  { client: SqliteDB }
>() {}

export class UnitOfWork extends Context.Tag('UnitOfWork')<
  UnitOfWork,
  {
    readonly write: (op: CompiledQuery) => Effect.Effect<void>;
    readonly commit: () => Effect.Effect<void, KyselyError | UnknownException, Database>;
  }
>() {}

const UnitOfWorkLive = Layer.effect(
  UnitOfWork,
  Effect.gen(function* () {
    const units = yield* Ref.make<ReadonlyArray<CompiledQuery>>([]);
    return {
      write(op) {
        return Ref.update(units, (a) => [...a, op]);
      },
      commit: () =>
        Effect.gen(function* () {
          const operations = yield* Ref.getAndSet(units, []);
          const db = yield* Database;
          yield* db.call((db) =>
            db.transaction().execute(async (tx) => {
              for (const op of operations) {
                await tx.executeQuery(op);
              }
            })
          );
        })
    };
  })
);
