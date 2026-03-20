import { Effect, Layer, Option, pipe, Schema } from 'effect';
import { isTagged } from 'effect/Predicate';
import { SqlClient, SqlError } from '@effect/sql';
import { InfrastructureError } from '@hex-effect/core';
import { WriteStatement } from '@hex-effect/infra-nats';
import { Services } from '@projects/application';
import { Project, Task } from '@projects/domain';

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
        sql`SELECT * FROM projects;`.pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(Project.Model.Project))),
          Effect.mapError((e) => new InfrastructureError({ cause: e }))
        )
    }))
  )
);

export const FindProjectByIdLive = Layer.effect(
  Services.FindProjectById,
  SqlClient.SqlClient.pipe(
    Effect.map((sql) => ({
      findById: (id: typeof Project.Model.ProjectId.Type) =>
        sql`SELECT * FROM projects WHERE id = ${id};`.pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(Project.Model.Project))),
          Effect.map((results) => Option.fromNullable(results[0])),
          Effect.mapError((e) => new InfrastructureError({ cause: e }))
        )
    }))
  )
);

// Handles both SQLite (0/1 integers) and PostgreSQL (native booleans)
const BoolFromDb = Schema.Union(
  Schema.Boolean,
  Schema.transform(Schema.Number, Schema.Boolean, {
    decode: (n) => n !== 0,
    encode: (b) => (b ? 1 : 0)
  })
);

const TaskFromDb = Schema.Struct({
  id: Task.Model.TaskId,
  projectId: Project.Model.ProjectId,
  description: Schema.NonEmptyString,
  completed: BoolFromDb
});

export const SaveTaskLive = Layer.effect(
  Services.SaveTask,
  pipe(
    Effect.zip(SqlClient.SqlClient, WriteStatement),
    Effect.map(([sql, write]) => {
      const service: typeof Services.SaveTask.Service = {
        save: (t) =>
          write(
            sql`INSERT INTO tasks ${sql.insert({ ...t, completed: t.completed ? 1 : 0 })};`
          ).pipe(logAndMap)
      };
      return service;
    })
  )
);

export const DeleteTaskLive = Layer.effect(
  Services.DeleteTask,
  pipe(
    Effect.zip(SqlClient.SqlClient, WriteStatement),
    Effect.map(([sql, write]) => ({
      delete: (id: typeof Task.Model.TaskId.Type) =>
        write(sql`DELETE FROM tasks WHERE id = ${id};`).pipe(logAndMap)
    }))
  )
);

export const GetTasksByProjectIdLive = Layer.effect(
  Services.GetTasksByProjectId,
  SqlClient.SqlClient.pipe(
    Effect.map((sql) => ({
      getByProjectId: (projectId: typeof Project.Model.ProjectId.Type) =>
        sql`SELECT * FROM tasks WHERE project_id = ${projectId};`.pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(TaskFromDb))),
          Effect.mapError((e) => new InfrastructureError({ cause: e }))
        )
    }))
  )
);

export const FindTaskByIdLive = Layer.effect(
  Services.FindTaskById,
  SqlClient.SqlClient.pipe(
    Effect.map((sql) => ({
      findById: (id: typeof Task.Model.TaskId.Type) =>
        sql`SELECT * FROM tasks WHERE id = ${id};`.pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(TaskFromDb))),
          Effect.map((results) => Option.fromNullable(results[0])),
          Effect.mapError((e) => new InfrastructureError({ cause: e }))
        )
    }))
  )
);

export const UpdateTaskLive = Layer.effect(
  Services.UpdateTask,
  pipe(
    Effect.zip(SqlClient.SqlClient, WriteStatement),
    Effect.map(([sql, write]) => ({
      update: (t: typeof Task.Model.Task.Type) =>
        write(sql`UPDATE tasks SET completed = ${t.completed ? 1 : 0} WHERE id = ${t.id};`).pipe(
          logAndMap
        )
    }))
  )
);
