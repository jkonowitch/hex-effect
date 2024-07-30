/**
 * Application and Domain Service Implementations
 */

import { Schema } from '@effect/schema';
import {
  ProjectRepository,
  ProjectId,
  Project,
  Task,
  TaskRepository,
  TaskId
} from '@projects/domain';
import { Layer, Effect, FiberRef, Option, Context } from 'effect';
import { omit } from 'effect/Struct';
import { nanoid } from 'nanoid';
import { DatabaseSession, type EventStoreService } from '@hex-effect/infra-kysely-libsql-nats';
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler
} from 'kysely';
import type { DB } from './persistence/schema.js';

const queryBuilder = new Kysely<DB>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler()
  }
});

const ProjectRepositoryLive = Layer.effect(
  ProjectRepository,
  DatabaseSession.pipe(
    Effect.map((session) => ({
      nextId() {
        return Effect.succeed(ProjectId.make(nanoid()));
      },
      save: (project: Project) =>
        Effect.gen(function* () {
          const encoded = Schema.encodeSync(Project)(project);
          const { write } = yield* FiberRef.get(session);
          yield* write(
            queryBuilder
              .insertInto('projects')
              .values({ id: encoded.id, title: encoded.title })
              .onConflict((oc) => oc.doUpdateSet((eb) => ({ title: eb.ref('excluded.title') })))
              .compile()
          ).pipe(Effect.orDie);
        }),
      findById: (id: (typeof ProjectId)['Type']) =>
        Effect.gen(function* () {
          const { read } = yield* FiberRef.get(session);

          const record = yield* read(
            queryBuilder.selectFrom('projects').selectAll().where('id', '=', id).compile()
          ).pipe(
            Effect.orDie,
            Effect.map((result) => Option.fromNullable(result.rows.at(0)))
          );

          if (Option.isNone(record)) return Option.none<Project>();

          const project = Schema.decodeSync(Project)({
            id: record.value.id,
            title: record.value.title,
            _tag: 'Project'
          });

          return Option.some(project);
        }),
      findAll: () =>
        Effect.gen(function* () {
          const { read } = yield* FiberRef.get(session);

          const records = yield* read(
            queryBuilder.selectFrom('projects').selectAll().compile()
          ).pipe(Effect.orDie);

          return records.rows.map((project) =>
            Schema.decodeSync(Project)({ ...project, _tag: 'Project' })
          );
        })
    }))
  )
);

// Sqlite does not have a bool type, so we will encode to 0 / 1
const RefinedTask = Schema.Struct({
  ...Task.fields,
  completed: Schema.transform(Schema.Int, Schema.Boolean, {
    strict: true,
    decode: (fromA) => (fromA === 0 ? false : true),
    encode: (toI) => (toI ? 1 : 0)
  })
});

const TaskRepositoryLive = Layer.effect(
  TaskRepository,
  DatabaseSession.pipe(
    Effect.map((session) => ({
      nextId() {
        return Effect.succeed(TaskId.make(nanoid()));
      },
      save: (task: Task) =>
        Effect.gen(function* () {
          const encoded = Schema.encodeSync(RefinedTask)(task);
          const { write } = yield* FiberRef.get(session);
          yield* write(
            queryBuilder
              .insertInto('tasks')
              .values(omit(encoded, '_tag'))
              .onConflict((oc) =>
                oc.doUpdateSet((eb) => ({
                  completed: eb.ref('excluded.completed'),
                  description: eb.ref('excluded.description')
                }))
              )
              .compile()
          ).pipe(Effect.orDie);
        }),
      findById: (id: (typeof TaskId)['Type']) =>
        Effect.gen(function* () {
          const { read } = yield* FiberRef.get(session);

          const record = yield* read(
            queryBuilder.selectFrom('tasks').selectAll().where('id', '=', id).compile()
          ).pipe(
            Effect.orDie,
            Effect.map((result) => Option.fromNullable(result.rows.at(0)))
          );

          if (Option.isNone(record)) return Option.none<Task>();

          const decoded = Schema.decodeSync(RefinedTask)({
            ...record.value,
            _tag: 'Task'
          });

          return Option.some(new Task(decoded));
        }),
      findAllByProjectId: (projectId: (typeof ProjectId)['Type']) =>
        Effect.gen(function* () {
          const { read } = yield* FiberRef.get(session);

          const { rows: records } = yield* read(
            queryBuilder
              .selectFrom('tasks')
              .selectAll()
              .where('projectId', '=', projectId)
              .compile()
          ).pipe(Effect.orDie);

          return Option.some(
            records.map((v) => Schema.decodeSync(RefinedTask)({ ...v, _tag: 'Task' }))
          );
        })
    }))
  )
);

export class EventStore extends Context.Tag('ProjectEventStore')<EventStore, EventStoreService>() {
  public static live = Layer.effect(
    EventStore,
    DatabaseSession.pipe(
      Effect.map((session) => {
        const service: EventStoreService = {
          getUnpublished: () =>
            Effect.gen(function* () {
              const { read } = yield* FiberRef.get(session);

              return yield* read(
                queryBuilder
                  .selectFrom('events')
                  .select(({ fn, val }) => [
                    'payload',
                    'id',
                    fn<string>('json_extract', ['payload', val('$._tag')]).as('tag'),
                    fn<string>('json_extract', ['payload', val('$._context')]).as('context')
                  ])
                  .where('delivered', '=', 0)
                  .compile()
              ).pipe(Effect.map((r) => r.rows));
            }),
          markPublished: (ids: string[]) =>
            Effect.gen(function* () {
              const { write } = yield* FiberRef.get(session);
              yield* write(
                queryBuilder
                  .updateTable('events')
                  .set({ delivered: 1 })
                  .where('id', 'in', ids)
                  .compile()
              );
            }),
          save: (encoded) =>
            Effect.gen(function* () {
              const { write } = yield* FiberRef.get(session);

              yield* write(
                queryBuilder
                  .insertInto('events')
                  .values({
                    occurredOn: encoded.occurredOn,
                    id: encoded.messageId,
                    delivered: 0,
                    payload: JSON.stringify(encoded)
                  })
                  .compile()
              );
            })
        };

        return service;
      })
    )
  );
}

export const DomainServiceLive = Layer.mergeAll(TaskRepositoryLive, ProjectRepositoryLive);
