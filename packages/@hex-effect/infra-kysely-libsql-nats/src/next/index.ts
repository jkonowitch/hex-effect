import {
  IsolationLevel,
  TransactionError,
  WithTransaction,
  type EventBaseType
} from '@hex-effect/core';
import { Context, Effect, Layer, Option, Ref } from 'effect';
import { SqlClient, type Statement } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { LibsqlClient } from './libsql-client/index.js';
import type { InValue } from '@libsql/client';
import type { ParseError } from '@effect/schema/ParseResult';
import { Schema } from '@effect/schema';
import { isTagged } from 'effect/Predicate';

class _WriteExecutor extends Context.Tag('@hex-effect/_WriteExecutor')<
  _WriteExecutor,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {
  public static live = Layer.succeed(this, (stm) => stm);
}

export class WriteStatement extends Context.Tag('WriteStatement')<
  WriteStatement,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {
  public static live = Layer.succeed(WriteStatement, (stm) =>
    Effect.serviceOption(_WriteExecutor).pipe(
      Effect.map(Option.getOrThrowWith(() => new Error('WriteExecutor not initialized'))),
      Effect.andThen((wr) => wr(stm))
    )
  ).pipe(Layer.provideMerge(_WriteExecutor.live));
}

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

const UnpublishedEventRecord = Schema.Struct({
  ...EventRecordInsert.pick('messageId', 'payload').fields,
  tag: Schema.String,
  context: Schema.String
});

class SaveEvents extends Context.Tag('@hex-effect/libsql/save-events')<
  SaveEvents,
  (e: EventBaseType[]) => Effect.Effect<void, ParseError | SqlError>
>() {
  public static live = Layer.effect(
    this,
    Effect.zip(SqlClient.SqlClient, WriteStatement).pipe(
      Effect.map(
        ([sql, write]) =>
          (events: EventBaseType[]) =>
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
            )
      )
    )
  );
}

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
            json_extract(payload, '$._tag') AS tag,
            json_extract(payload, '$._context') AS context
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
    const [ensureEventTableStmt] = sql`CREATE TABLE IF NOT EXISTS hex_effect_events (
        message_id TEXT PRIMARY KEY NOT NULL,
        occurred_on DATETIME NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL
      );`.compile();
    yield* Effect.promise(() => sql.sdk.migrate([{ sql: ensureEventTableStmt, args: [] }]));

    return Layer.mergeAll(SaveEvents.live, GetUnpublishedEvents.live);
  })
);

const isTaggedError = (e: unknown) => isTagged(e, 'SqlError') || isTagged(e, 'ParseError');

export const WTLive = Layer.effect(
  WithTransaction,
  Effect.gen(function* () {
    const client = yield* LibsqlClient.LibsqlClient;
    const save = yield* SaveEvents;
    return <A extends EventBaseType[], E, R>(
      useCase: Effect.Effect<A, E, R>,
      isolationLevel: IsolationLevel
    ) => {
      const useCaseWithEventStorage = useCase.pipe(
        Effect.tap(save),
        Effect.mapError((e) => (isTaggedError(e) ? new TransactionError({ cause: e }) : e))
      );

      if (isolationLevel === IsolationLevel.Batched) {
        return Effect.gen(function* () {
          const ref = yield* Ref.make<Statement.Statement<unknown>[]>([]);
          const results = yield* Effect.provideService(
            useCaseWithEventStorage,
            _WriteExecutor,
            (stm) => Ref.update(ref, (a) => [...a, stm])
          );
          const writes = yield* Ref.get(ref);
          yield* Effect.tryPromise({
            try: () =>
              client.sdk.batch(
                writes.map((w) => {
                  const [sql, args] = w.compile();
                  return {
                    args: args as Array<InValue>,
                    sql: sql
                  };
                })
              ),
            catch: (e) => new TransactionError({ cause: e })
          });
          return results;
        });
      } else if (isolationLevel === IsolationLevel.Serializable) {
        return useCaseWithEventStorage.pipe(
          client.withTransaction,
          Effect.catchTag('SqlError', (e) => Effect.fail(new TransactionError({ cause: e })))
        );
      } else {
        return Effect.dieMessage(`${isolationLevel} not supported`);
      }
    };
  })
);
