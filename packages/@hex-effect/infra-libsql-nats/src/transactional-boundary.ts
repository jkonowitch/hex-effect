import {
  InfrastructureError,
  IsolationLevel,
  DataIntegrityError,
  WithTransaction,
  type EncodableEventBase
} from '@hex-effect/core';
import { Effect, Layer, Match, Ref } from 'effect';
import { type Statement } from '@effect/sql';
import { LibsqlClient } from '@effect/sql-libsql';
import { type InValue } from '@libsql/client';
import { isTagged } from 'effect/Predicate';
import { LibsqlClientLive, LibsqlSdk, WriteStatement } from './sql.js';
import { EventStoreLive, SaveEvents, UseCaseCommit } from '@hex-effect/infra-nats';

const isTaggedError = (e: unknown) => isTagged(e, 'SqlError') || isTagged(e, 'ParseError');

// LibsqlError.code starts with 'SQLITE_CONSTRAINT' for unique/fk/check/notnull violations.
// Everything else (network, malformed SQL, I/O) is an infrastructure problem.
const isConstraintViolation = (e: unknown): boolean => {
  const raw = isTagged(e, 'SqlError') ? (e as unknown as { cause: unknown }).cause : e;
  return (
    raw instanceof Error &&
    'code' in raw &&
    typeof (raw as Error & { code: unknown }).code === 'string' &&
    (raw as Error & { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  );
};

const classifySqlError = (e: unknown): DataIntegrityError | InfrastructureError =>
  isConstraintViolation(e)
    ? new DataIntegrityError({ cause: e })
    : new InfrastructureError({ cause: e });

export const WithTransactionLive = Layer.effect(
  WithTransaction,
  Effect.gen(function* () {
    const client = yield* LibsqlClient.LibsqlClient;
    const sdk = yield* LibsqlSdk.sdk;

    const { save } = yield* SaveEvents;
    const pub = yield* UseCaseCommit;
    return <E, R, A extends EncodableEventBase>(
      useCase: Effect.Effect<ReadonlyArray<A>, E, R>,
      isolationLevel: IsolationLevel
    ) => {
      const useCaseWithEventStorage = useCase.pipe(
        Effect.tap(save),
        Effect.mapError((e) => (isTaggedError(e) ? classifySqlError(e) : e))
      );

      const batched = Effect.gen(function* () {
        const ref = yield* Ref.make<Statement.Statement<unknown>[]>([]);
        const results = yield* WriteStatement.withExecutor(useCaseWithEventStorage, (stm) =>
          Ref.update(ref, (a) => [...a, stm])
        );
        const writes = yield* Ref.get(ref);
        yield* Effect.tryPromise(() =>
          sdk.batch(
            writes.map((w) => {
              const [sql, args] = w.compile();
              return { args: args as Array<InValue>, sql };
            })
          )
        ).pipe(
          Effect.mapError((e) => classifySqlError(e.error)),
          Effect.when(() => writes.length > 0)
        );
        return results;
      });

      const serializable = useCaseWithEventStorage.pipe(
        client.withTransaction,
        Effect.mapError((e) => (isTaggedError(e) ? classifySqlError(e) : e))
      );

      return Match.value(isolationLevel)
        .pipe(
          Match.when(IsolationLevel.Batched, () => batched),
          Match.when(IsolationLevel.Serializable, () => serializable),
          Match.orElse(() => Effect.dieMessage(`${isolationLevel} not supported`))
        )
        .pipe(Effect.tap(() => pub.publish()));
    };
  })
).pipe(
  Layer.provide(EventStoreLive),
  Layer.provideMerge(WriteStatement.live),
  Layer.provide(UseCaseCommit.live),
  Layer.provideMerge(LibsqlClientLive)
);
