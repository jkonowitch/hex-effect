import { SqlClient } from '@effect/sql';
import { InfrastructureError } from '@hex-effect/core';
import { WriteStatement } from '@hex-effect/infra-libsql-nats';
import { Services } from '@projects-next/application';
import { Effect, Layer } from 'effect';

export const SaveProjectLive = Layer.effect(
  Services.SaveProject,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const write = yield* WriteStatement;

    return {
      save(p) {
        return write(sql`INSERT INTO projects ${sql.insert(p)};`).pipe(
          Effect.tapError(Effect.logError),
          Effect.mapError((e) => new InfrastructureError({ cause: e }))
        );
      }
    };
  })
);
