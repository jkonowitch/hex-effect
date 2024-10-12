import { type EncodableEventBase, EventBaseSchema } from '@hex-effect/core';
import { Context, Effect, Layer } from 'effect';
import { SqlClient } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { LibsqlClient } from '@effect/sql-libsql';
import type { ParseError } from '@effect/schema/ParseResult';
import { Schema } from '@effect/schema';
import { LibsqlSdk, WriteStatement } from './sql.js';

const BoolFromNumber = Schema.transform(Schema.Number, Schema.Boolean, {
  strict: true,
  decode: (fromA) => (fromA === 0 ? false : true),
  encode: (toI) => (toI ? 1 : 0)
});

const EventRecordInsert = Schema.Struct({
  messageId: Schema.String,
  occurredOn: Schema.DateFromNumber,
  delivered: BoolFromNumber,
  payload: Schema.String
});

export const UnpublishedEventRecord = Schema.Struct({
  ...EventBaseSchema.omit('occurredOn').fields,
  ...EventRecordInsert.pick('payload').fields
});

export class SaveEvents extends Effect.Service<SaveEvents>()('SaveEvents', {
  effect: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const write = yield* WriteStatement;

    const save = (events: EncodableEventBase[]) =>
      Effect.forEach(
        events,
        (e) =>
          e.encode().pipe(
            Effect.flatMap((e) =>
              Schema.encode(EventRecordInsert)({
                delivered: false,
                messageId: e.messageId,
                occurredOn: Schema.decodeSync(Schema.DateFromString)(e.occurredOn),
                payload: JSON.stringify(e)
              })
            ),
            Effect.andThen((e) => write(sql`insert into hex_effect_events ${sql.insert(e)};`))
          ),
        {
          concurrency: 'unbounded'
        }
      );

    return { save };
  }),
  dependencies: [WriteStatement.live],
  accessors: true
}) {}

export class GetUnpublishedEvents extends Context.Tag('@hex-effect/libsql/GetUnpublishedEvents')<
  GetUnpublishedEvents,
  () => Effect.Effect<ReadonlyArray<typeof UnpublishedEventRecord.Type>, ParseError | SqlError>
>() {
  public static live = Layer.effect(
    this,
    SqlClient.SqlClient.pipe(
      Effect.map(
        (sql) => () =>
          sql`SELECT
            payload,
            message_id,
            json_extract(payload, '$._tag') AS _tag,
            json_extract(payload, '$._context') AS _context
          FROM hex_effect_events
          WHERE delivered = 0;`.pipe(
            Effect.andThen(Schema.decodeUnknown(Schema.Array(UnpublishedEventRecord)))
          )
      )
    )
  );
}

export const EventStoreLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const sql = yield* LibsqlClient.LibsqlClient;
    const sdk = yield* LibsqlSdk.sdk;
    const [ensureEventTableStmt] = sql`CREATE TABLE IF NOT EXISTS hex_effect_events (
        message_id TEXT PRIMARY KEY NOT NULL,
        occurred_on DATETIME NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL
      );`.compile();
    yield* Effect.promise(() => sdk.migrate([{ sql: ensureEventTableStmt, args: [] }]));

    return Layer.mergeAll(SaveEvents.Default, GetUnpublishedEvents.live);
  })
);