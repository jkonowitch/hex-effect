import { Dialect, Kysely, type CompiledQuery } from 'kysely';
import { Effect, Context, Layer, Scope, Config, Ref, FiberRef } from 'effect';
import { Database as SQLite, SQLiteError } from 'bun:sqlite';
import { UnknownException } from 'effect/Cause';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import type { TransactionalBoundary } from '@hex-effect/core';

export type UnitOfWork<DB> = {
  readonly write: (op: CompiledQuery) => Effect.Effect<void>;
  readonly commit: () => Effect.Effect<void, SQLiteError | UnknownException>;
  readonly session: DatabaseSession<DB>;
};

type DatabaseSession<DB> = {
  direct: Kysely<DB>;
  call: <A>(f: (db: Kysely<DB>) => Promise<A>) => Effect.Effect<A, SQLiteError | UnknownException>;
};

export const makeTransactionalBoundary = (
  txBoundaryTag: Context.Tag<unknown, TransactionalBoundary>,
  uowTag: Context.Tag<unknown, UnitOfWork<unknown>>
) =>
  Layer.effect(
    txBoundaryTag,
    Effect.gen(function* () {
      const connectionString = yield* Config.string('PROJECT_DB');
      const readonlyConnection = new SQLite(connectionString, { readonly: true });
      const writableConnection = new SQLite(connectionString);

      return {
        begin: (mode) =>
          Effect.gen(function* () {
            yield* Effect.log('begin called');
            const dialect = new BunSqliteDialect({
              database: mode === 'readonly' ? readonlyConnection : writableConnection
            });
            const uow = yield* UnitOfWorkLive(dialect);
            yield* FiberRef.getAndUpdate(FiberRef.currentContext, Context.add(uowTag, uow));
          }),
        commit: () =>
          Effect.gen(function* () {
            yield* Effect.log('commit called');
            const uow = yield* assertUnitOfWork(uowTag);
            // TODO - this should return some sort of abstracted Transaction error to the application service under certain conditions...
            yield* uow.commit().pipe(Effect.orDie);
          }),
        rollback: () => Effect.log('no op')
      };
    })
  );

const UnitOfWorkLive = (dialect: Dialect): Effect.Effect<UnitOfWork<unknown>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const units = yield* Ref.make<ReadonlyArray<CompiledQuery>>([]);
    const kyselyClient = new Kysely<unknown>({
      dialect
    });
    let committed = false;

    yield* Effect.addFinalizer(() =>
      committed ? Effect.void : Effect.logError('This unit of work was not committed!')
    );

    const session = {
      direct: kyselyClient,
      call: <A>(f: (db: Kysely<unknown>) => Promise<A>) =>
        Effect.tryPromise({
          try: () => f(kyselyClient),
          catch: (error) => {
            return error instanceof SQLiteError ? error : new UnknownException(error);
          }
        })
    };
    return {
      write(op: CompiledQuery<unknown>) {
        return Ref.update(units, (a) => [...a, op]);
      },
      commit() {
        return Effect.gen(function* () {
          const operations = yield* Ref.getAndSet(units, []);
          if (operations.length === 0) return;
          yield* session.call((db) =>
            db.transaction().execute(async (tx) => {
              for (const op of operations) {
                await tx.executeQuery(op);
              }
            })
          );
          committed = true;
        });
      },
      session
    };
  });

export const assertUnitOfWork = (tag: Context.Tag<unknown, UnitOfWork<unknown>>) =>
  Effect.serviceOptional(tag).pipe(
    Effect.catchTag('NoSuchElementException', () =>
      Effect.dieMessage('TransactionalBoundary#begin not called!')
    )
  );
