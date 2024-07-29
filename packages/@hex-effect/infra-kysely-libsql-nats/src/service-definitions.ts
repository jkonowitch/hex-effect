import {
  createClient,
  type Client,
  type LibsqlError,
  type Config as LibsqlConfig
} from '@libsql/client';
import { Option, Context, Effect, FiberRef, Layer, PubSub, Config } from 'effect';
import {
  Kysely,
  type InsertResult,
  type UpdateResult,
  type DeleteResult,
  type CompiledQuery,
  type QueryResult,
  Transaction,
  SqliteAdapter,
  DummyDriver,
  SqliteIntrospector,
  SqliteQueryCompiler
} from 'kysely';
import {
  connect,
  RetentionPolicy,
  type ConnectionOptions,
  type JetStreamClient,
  type JetStreamManager,
  type StreamInfo
} from 'nats';
import { Schema } from '@effect/schema';
import type { EventBaseSchema, TransactionalBoundary } from '@hex-effect/core';
import { LibsqlDialect } from './libsql-dialect.js';

export type StoredEvent = {
  id: string;
  payload: string;
  tag: string;
  context: string;
};

/**
 * "Repository"-like store for events. Used to persist events during a transaction, ensuring atomic domain operations.
 * Events will be published/forwarded to an event bus from the store
 */
export type EventStoreService = {
  getUnpublished: () => Effect.Effect<StoredEvent[], LibsqlError>;
  markPublished: (ids: string[]) => Effect.Effect<void, LibsqlError>;
  save: (event: Schema.Schema.Encoded<typeof EventBaseSchema>) => Effect.Effect<void, LibsqlError>;
};

export class EventStore extends Context.Tag('EventStore')<EventStore, EventStoreService>() {
  public static live = Layer.effect(
    EventStore,
    Effect.gen(function* () {
      if (!(yield* EventStore.hasEventsTable)) yield* Effect.dieMessage('No events table!');
      const session = yield* DatabaseSession;
      const service: EventStoreService = {
        getUnpublished: () =>
          Effect.gen(function* () {
            const { read } = yield* FiberRef.get(session);

            return yield* read(
              EventStore.queryBuilder
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
              EventStore.queryBuilder
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
              EventStore.queryBuilder
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
  );

  private static queryBuilder = new Kysely<{
    events: {
      delivered: number;
      id: string;
      occurredOn: string;
      payload: string;
    };
  }>({
    dialect: {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new SqliteIntrospector(db),
      createQueryCompiler: () => new SqliteQueryCompiler()
    }
  });

  private static hasEventsTable = Effect.gen(function* () {
    const { db } = yield* DatabaseConnection;
    const tables = yield* Effect.promise(() => db.introspection.getTables());
    const maybeEventTable = Option.fromNullable(tables.find((t) => t.name === 'events'));
    if (Option.isNone(maybeEventTable)) {
      return false;
    } else {
      // TODO: ensure table has correct columns/types
      // const eventTable = maybeEventTable.value;
      // eventTable.columns.
      return true;
    }
  });
}

export class NatsSubject extends Schema.Class<NatsSubject>('NatsSubject')({
  ApplicationNamespace: Schema.String,
  BoundedContext: Schema.String,
  EventTag: Schema.String
}) {
  get asSubject(): string {
    return `${this.ApplicationNamespace}.${this.BoundedContext}.${this.EventTag}`;
  }
}

export type INatsService = {
  jetstream: JetStreamClient;
  jetstreamManager: JetStreamManager;
  streamInfo: StreamInfo;
  eventToSubject: (event: Pick<StoredEvent, 'context' | 'tag'>) => NatsSubject;
};

export class NatsService extends Context.Tag('NatsService')<NatsService, INatsService>() {
  public static live = (connectionOptions?: ConnectionOptions) =>
    Layer.scoped(
      NatsService,
      Effect.gen(function* () {
        const connection = yield* Effect.promise(() => connect(connectionOptions));
        const jetstreamManager = yield* Effect.promise(() => connection.jetstreamManager());
        const applicationName = yield* Config.string('APPLICATION_NAME');
        const streamInfo = yield* Effect.promise(() =>
          jetstreamManager.streams.add({
            name: applicationName,
            subjects: [`${applicationName}.>`],
            retention: RetentionPolicy.Interest
          })
        );
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => connection.drain()).pipe(
            Effect.tap(Effect.logDebug('Nats connection closed'))
          )
        );
        const service: INatsService = {
          jetstream: connection.jetstream(),
          streamInfo: streamInfo,
          jetstreamManager,
          eventToSubject: (event) => {
            return NatsSubject.make({
              ApplicationNamespace: applicationName,
              BoundedContext: event.context,
              EventTag: event.tag
            });
          }
        };
        return service;
      })
    );
}

type ExcludedTypes = [InsertResult, UpdateResult, DeleteResult];

type ReadonlyQuery<C> =
  C extends CompiledQuery<infer T>
    ? T extends ExcludedTypes[number]
      ? never
      : CompiledQuery<T>
    : never;

export class DatabaseConnection extends Context.Tag('DatabaseConnection')<
  DatabaseConnection,
  {
    db: Kysely<unknown>;
    client: Client;
  }
>() {
  public static live = (config: LibsqlConfig) =>
    Layer.scoped(
      DatabaseConnection,
      Effect.gen(function* () {
        const client = createClient(config);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => client.close()).pipe(
            Effect.tap(Effect.logDebug('Database connection closed'))
          )
        );
        return {
          client,
          db: new Kysely({ dialect: new LibsqlDialect({ client }) })
        };
      })
    );
}

type FiberRefValue<T> = T extends FiberRef.FiberRef<infer V> ? V : never;

/**
 * Service which controls read/write access to the database, as well as providing a query builder.
 * Database interaction is mediated by this service to ensure it behaves properly within a `TransactionalBoundary`
 */
export class DatabaseSession extends Context.Tag('DatabaseSession')<
  DatabaseSession,
  FiberRef.FiberRef<{
    readonly write: (op: CompiledQuery) => Effect.Effect<void, LibsqlError>;
    readonly read: <Q>(
      op: ReadonlyQuery<CompiledQuery<Q>>
    ) => Effect.Effect<QueryResult<Q>, LibsqlError>;
  }>
>() {
  public static live = Layer.scoped(
    DatabaseSession,
    DatabaseConnection.pipe(
      Effect.andThen(({ db }) => FiberRef.make(this.createDatabaseSession(db)))
    )
  );

  public static createDatabaseSession = (
    db: Kysely<unknown> | Transaction<unknown>
  ): FiberRefValue<Context.Tag.Service<typeof DatabaseSession>> => {
    return {
      read<Q>(op: ReadonlyQuery<CompiledQuery<Q>>) {
        return Effect.promise(() => db.executeQuery(op));
      },
      write(op) {
        return Effect.promise(() => db.executeQuery(op));
      }
    };
  };
}

export class TransactionEvents extends Context.Tag('TransactionEvents')<
  TransactionEvents,
  PubSub.PubSub<keyof TransactionalBoundary<unknown>>
>() {
  public static live = Layer.effect(
    TransactionEvents,
    PubSub.sliding<keyof TransactionalBoundary<unknown>>(10)
  );
}
