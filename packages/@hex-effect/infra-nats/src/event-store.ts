import { type EncodableEventBase } from '@hex-effect/core';
import { Context, Effect, Layer, pipe } from 'effect';
import { SqlClient } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import * as Schema from 'effect/Schema';
import type { ParseError } from 'effect/ParseResult';
import { WriteStatement } from './sql.js';

// Stored in DB as: message_id TEXT, occurred_on TEXT (ISO), delivered INTEGER (0/1), payload TEXT
// This DDL works for both SQLite/LibSQL and PostgreSQL.
export const EVENT_TABLE_DDL = `CREATE TABLE IF NOT EXISTS hex_effect_events (
  message_id TEXT PRIMARY KEY NOT NULL,
  occurred_on TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
)`;

export const UnpublishedEventRecord = Schema.Struct({
  _context: Schema.String,
  _tag: Schema.String,
  messageId: Schema.String,
  payload: Schema.String
});

// Used only for decoding raw DB rows (message_id → messageId via snakeToCamel transform)
const RawEventRow = Schema.Struct({
  messageId: Schema.String,
  payload: Schema.String
});

// Parses the stored JSON payload to extract event metadata
const EventPayloadMeta = Schema.parseJson(
  Schema.Struct({
    _tag: Schema.String,
    _context: Schema.String
  })
);

export class SaveEvents extends Effect.Service<SaveEvents>()('SaveEvents', {
  effect: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const write = yield* WriteStatement;

    const save = <A extends EncodableEventBase>(events: ReadonlyArray<A>) =>
      Effect.forEach(
        events,
        (e) =>
          pipe(
            Schema.serialize(e),
            Effect.flatMap((serialized) =>
              write(
                sql`insert into hex_effect_events ${sql.insert({
                  messageId: serialized.messageId,
                  occurredOn: serialized.occurredOn,
                  delivered: 0,
                  payload: JSON.stringify(serialized)
                })};`
              )
            )
          ),
        { concurrency: 'unbounded' }
      );

    return { save };
  }),
  dependencies: [WriteStatement.live],
  accessors: true
}) {}

export class GetUnpublishedEvents extends Context.Tag('@hex-effect/GetUnpublishedEvents')<
  GetUnpublishedEvents,
  () => Effect.Effect<ReadonlyArray<typeof UnpublishedEventRecord.Type>, ParseError | SqlError>
>() {
  public static live = Layer.effect(
    this,
    SqlClient.SqlClient.pipe(
      Effect.map(
        (sql) => () =>
          sql`SELECT message_id, payload FROM hex_effect_events WHERE delivered = 0;`.pipe(
            Effect.flatMap(Schema.decodeUnknown(Schema.Array(RawEventRow))),
            Effect.flatMap(
              Effect.forEach((row) =>
                Schema.decode(EventPayloadMeta)(row.payload).pipe(
                  Effect.map(
                    (meta) =>
                      ({
                        _tag: meta._tag,
                        _context: meta._context,
                        messageId: row.messageId,
                        payload: row.payload
                      }) satisfies typeof UnpublishedEventRecord.Type
                  )
                )
              )
            )
          )
      )
    )
  );
}

export class MarkAsPublished extends Effect.Service<MarkAsPublished>()('MarkAsPublished', {
  effect: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const markAsPublished = (ids: string[]) =>
      sql`update hex_effect_events set delivered = 1 where message_id in ${sql.in(ids)};`;

    return { markAsPublished };
  }),
  accessors: true
}) {}

export const EventStoreLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(EVENT_TABLE_DDL);
    return Layer.mergeAll(SaveEvents.Default, GetUnpublishedEvents.live, MarkAsPublished.Default);
  })
);
