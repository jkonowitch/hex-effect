import {
  InfrastructureError,
  IsolationLevel,
  DataIntegrityError,
  WithTransaction,
  type EncodableEventBase
} from '@hex-effect/core';
import { Effect, Layer, Match } from 'effect';
import { SqlClient } from '@effect/sql';
import { isTagged } from 'effect/Predicate';
import { WriteStatement, EventStoreLive, SaveEvents, UseCaseCommit } from '@hex-effect/infra-nats';
import { PgClientLive } from './sql.js';

const isTaggedError = (e: unknown) => isTagged(e, 'SqlError') || isTagged(e, 'ParseError');

// PostgreSQL constraint violation class codes (class 23 = integrity constraint violation)
const isPgConstraintViolation = (e: unknown): boolean => {
  const raw = isTagged(e, 'SqlError') ? (e as unknown as { cause: unknown }).cause : e;
  return (
    raw instanceof Error &&
    'code' in raw &&
    typeof (raw as Error & { code: unknown }).code === 'string' &&
    (raw as Error & { code: string }).code.startsWith('23')
  );
};

const classifySqlError = (e: unknown): DataIntegrityError | InfrastructureError =>
  isPgConstraintViolation(e)
    ? new DataIntegrityError({ cause: e })
    : new InfrastructureError({ cause: e });

export const WithTransactionLive = Layer.effect(
  WithTransaction,
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;

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

      // PG has no sdk.batch() — Batched maps to Serializable (BEGIN/COMMIT transaction)
      const serializable = useCaseWithEventStorage.pipe(
        client.withTransaction,
        Effect.mapError((e) => (isTaggedError(e) ? classifySqlError(e) : e))
      );

      return Match.value(isolationLevel)
        .pipe(
          Match.when(IsolationLevel.Batched, () => serializable),
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
  Layer.provideMerge(PgClientLive)
);
