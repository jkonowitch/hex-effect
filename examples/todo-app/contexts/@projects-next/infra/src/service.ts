import { Effect, Layer, pipe } from 'effect';
import { isTagged } from 'effect/Predicate';
import { SqlClient, SqlError } from '@effect/sql';
import { InfrastructureError } from '@hex-effect/core';
import { WriteStatement } from '@hex-effect/infra-libsql-nats';
import { Services } from '@projects-next/application';

const logAndMap = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  pipe(
    effect,
    Effect.tapError(Effect.logError),
    Effect.mapError<E, Exclude<E | InfrastructureError, SqlError.SqlError>>(
      (e) =>
        (isTagged('SqlError')(e) ? new InfrastructureError({ cause: e }) : e) as Exclude<
          E | InfrastructureError,
          SqlError.SqlError
        >
    )
  );

export const SaveProjectLive = Layer.effect(
  Services.SaveProject,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const write = yield* WriteStatement;

    return {
      save(p) {
        return write(sql`INSERT INTO projects ${sql.insert(p)};`).pipe(logAndMap);
      }
    };
  })
);
