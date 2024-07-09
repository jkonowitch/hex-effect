/* eslint-disable @typescript-eslint/no-explicit-any */
import { Dialect, Kysely, type CompiledQuery } from 'kysely';
import { Effect, Context, Layer, Scope, Ref, FiberRef, ConfigError } from 'effect';
import { Database as SQLite, SQLiteError } from 'bun:sqlite';
import { UnknownException } from 'effect/Cause';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import type { TransactionalBoundary } from '@hex-effect/core';
import { assertUnitOfWork, type UnitOfWork } from '@hex-effect/infra';

export const makeTransactionalBoundary = (
  txBoundaryTag: Context.Tag<any, TransactionalBoundary>,
  uowTag: Context.Tag<any, UnitOfWork<any, SQLiteError>>,
  getConnectionString: Effect.Effect<string, ConfigError.ConfigError>
) =>
  Layer.effect(
    txBoundaryTag,
    Effect.gen(function* () {
      const connectionString = yield* getConnectionString;
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

const UnitOfWorkLive = (
  dialect: Dialect
): Effect.Effect<UnitOfWork<unknown, SQLiteError>, never, Scope.Scope> =>
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
