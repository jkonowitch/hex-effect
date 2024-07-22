import type { Client, LibsqlError } from '@libsql/client';
import type { Effect, FiberRef } from 'effect';
import type {
  Kysely,
  InsertResult,
  UpdateResult,
  DeleteResult,
  CompiledQuery,
  QueryResult
} from 'kysely';
import type { JetStreamClient, JetStreamManager, StreamInfo } from 'nats';
import { Schema } from '@effect/schema';
import type { EventBaseSchema } from '@hex-effect/core';

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

export type DatabaseConnection<DB> = {
  db: Kysely<DB>;
  client: Client;
};

type ExcludedTypes = [InsertResult, UpdateResult, DeleteResult];

export type ReadonlyQuery<C> =
  C extends CompiledQuery<infer T>
    ? T extends ExcludedTypes[number]
      ? never
      : CompiledQuery<T>
    : never;

/**
 * Service which controls read/write access to the database, as well as providing a query builder.
 * Database interaction is mediated by this service to ensure it behaves properly within a `TransactionalBoundary`
 */
export type DatabaseSession<DB, E> = FiberRef.FiberRef<{
  readonly write: (op: CompiledQuery) => Effect.Effect<void, E>;
  readonly read: <Q>(op: ReadonlyQuery<CompiledQuery<Q>>) => Effect.Effect<QueryResult<Q>, E>;
  readonly queryBuilder: Kysely<DB>;
}>;
