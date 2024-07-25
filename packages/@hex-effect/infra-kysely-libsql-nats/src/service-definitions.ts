import { createClient, type Client, type Config, type LibsqlError } from '@libsql/client';
import { Context, Effect, FiberRef, Layer, PubSub } from 'effect';
import {
  Kysely,
  type InsertResult,
  type UpdateResult,
  type DeleteResult,
  type CompiledQuery,
  type QueryResult,
  Transaction
} from 'kysely';
import type { JetStreamClient, JetStreamManager, StreamInfo } from 'nats';
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

export class NatsSubject extends Schema.Class<NatsSubject>('NatsSubject')({
  ApplicationNamespace: Schema.String,
  BoundedContext: Schema.String,
  EventTag: Schema.String
}) {
  get asSubject(): string {
    return `${this.ApplicationNamespace}.${this.BoundedContext}.${this.EventTag}`;
  }
}

export type NatsService = {
  jetstream: JetStreamClient;
  jetstreamManager: JetStreamManager;
  streamInfo: StreamInfo;
  eventToSubject: (event: Pick<StoredEvent, 'context' | 'tag'>) => NatsSubject;
};

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
  public static live = (config: Config) =>
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
