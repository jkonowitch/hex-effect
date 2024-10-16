import { Effect, Layer, pipe } from 'effect';
import { isTagged } from 'effect/Predicate';
import { SqlClient, SqlError } from '@effect/sql';
import { InfrastructureError } from '@hex-effect/core';
import { WriteStatement } from '@hex-effect/infra-libsql-nats';
import { Services } from '@projects-next/application';
import { Schema } from '@effect/schema';
import { Project } from '@projects-next/domain';

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
  pipe(
    Effect.zip(SqlClient.SqlClient, WriteStatement),
    Effect.map(([sql, write]) => {
      const service: typeof Services.SaveProject.Service = {
        save: (p) => write(sql`INSERT INTO projects ${sql.insert(p)};`).pipe(logAndMap)
      };
      return service;
    })
  )
);

export const GetAllProjectsLive = Layer.effect(
  Services.GetAllProjects,
  SqlClient.SqlClient.pipe(
    Effect.map((sql) => ({
      getAll: () =>
        sql`SELECT * FROM projects`.pipe(
          Schema.decodeUnknown(Schema.Array(Project.Model.Project)),
          Effect.mapError((e) => new InfrastructureError({ cause: e }))
        )
    }))
  )
);
