/* eslint-disable @typescript-eslint/no-explicit-any */
import { Dialect, Kysely, type CompiledQuery } from 'kysely';
import { Effect, Context, Layer, Ref, ConfigError, Option } from 'effect';
import { Database as SQLite, SQLiteError } from 'bun:sqlite';
import { UnknownException } from 'effect/Cause';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import type { TransactionalBoundary } from '@hex-effect/core';
import { getUnitOfWork, type UnitOfWork } from '@hex-effect/infra';

export const makeTransactionalBoundary = <
  TX extends Context.Tag<any, TransactionalBoundary>,
  UOW extends Context.Tag<any, UnitOfWork<any, SQLiteError>>
>(
  txBoundaryTag: TX,
  uowTag: UOW,
  getConnectionString: Effect.Effect<string, ConfigError.ConfigError>
): Layer.Layer<Context.Tag.Identifier<TX>, ConfigError.ConfigError, Context.Tag.Identifier<UOW>> =>
  Layer.effect(
    txBoundaryTag,
    Effect.gen(function* () {
      const connectionString = yield* getConnectionString;
      const readonlyConnection = new SQLite(connectionString, { readonly: true });
      const writableConnection = new SQLite(connectionString);

      const uow = yield* uowTag;

      return {
        begin: (mode) =>
          Effect.gen(function* () {
            yield* Effect.log('begin called');
            const dialect = new BunSqliteDialect({
              database: mode === 'readonly' ? readonlyConnection : writableConnection
            });

            yield* Ref.set(uow, Option.some(yield* UnitOfWorkLive(dialect)));
          }),
        commit: () =>
          Effect.gen(function* () {
            yield* Effect.log('commit called');
            // TODO - this should return some sort of abstracted Transaction error to the application service under certain conditions...
            yield* getUnitOfWork(uow).pipe(Effect.andThen((live) => live.commit()));
          }),
        rollback: () => Effect.log('no op')
      } as Context.Tag.Service<TX>;
    })
  );

const UnitOfWorkLive = (dialect: Dialect) =>
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
