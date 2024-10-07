import {
  IsolationLevel,
  TransactionError,
  WithTransaction,
  type EventBaseType
} from '@hex-effect/core';
import { Context, Effect, Layer, Option, Ref } from 'effect';
import { Model, type Statement } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { LibsqlClient } from './libsql-client/index.js';
import type { InValue } from '@libsql/client';
import type { ParseError } from '@effect/schema/ParseResult';
import { Schema } from '@effect/schema';

class WriteExecutor extends Context.Tag('WriteExecutor')<
  WriteExecutor,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {
  public static live = Layer.succeed(this, (stm) => stm);
}

export class WriteStatement extends Context.Tag('WriteStatement')<
  WriteStatement,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {
  public static live = Layer.succeed(WriteStatement, (stm) =>
    Effect.serviceOption(WriteExecutor).pipe(
      Effect.map(Option.getOrThrowWith(() => new Error('WriteExecutor not initialized'))),
      Effect.andThen((wr) => wr(stm))
    )
  ).pipe(Layer.provideMerge(WriteExecutor.live));
}

const BoolFromNumber = Schema.transform(Schema.Number, Schema.Boolean, {
  strict: true,
  decode: (fromA) => (fromA === 0 ? false : true),
  encode: (toI) => (toI ? 1 : 0)
});

class EventModel extends Model.Class<EventModel>('EventModel')({
  messageId: Schema.String,
  occurredOn: Schema.DateFromNumber,
  delivered: BoolFromNumber,
  payload: Schema.String
}) {}

class EventStore extends Context.Tag('@hex-effect/libsql/event-store')<
  EventStore,
  {
    save: (e: EventBaseType[]) => Effect.Effect<void, ParseError | SqlError>;
  }
>() {
  public static live = Layer.effect(
    this,
    Effect.gen(function* () {
      const sql = yield* LibsqlClient.LibsqlClient;
      const writer = yield* WriteStatement;
      const [ensureEventTableStmt] = sql`CREATE TABLE IF NOT EXISTS hex_effect_events (
        message_id TEXT PRIMARY KEY NOT NULL,
        occurred_on DATETIME NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL
      );`.compile();

      yield* Effect.promise(() => sql.sdk.migrate([{ sql: ensureEventTableStmt, args: [] }]));

      return {
        save: (events) =>
          Effect.forEach(
            events,
            (e) =>
              e.encode().pipe(
                Effect.flatMap((e) =>
                  Schema.encode(EventModel)({
                    delivered: false,
                    messageId: e.messageId,
                    occurredOn: Schema.decodeSync(Schema.DateFromString)(e.occurredOn),
                    payload: JSON.stringify(e)
                  })
                ),
                Effect.tap((e) => writer(sql`insert into events ${sql.insert(e)};`))
              ),
            {
              concurrency: 'unbounded'
            }
          )
      };
    })
  );
}

export const WTLive = Layer.effect(
  WithTransaction,
  Effect.gen(function* () {
    const client = yield* LibsqlClient.LibsqlClient;

    return <A extends EventBaseType[], E, R>(
      eff: Effect.Effect<A, E, R>,
      isolationLevel: IsolationLevel
    ) => {
      if (isolationLevel === IsolationLevel.Batched) {
        const prog = Effect.gen(function* () {
          const ref = yield* Ref.make<Statement.Statement<unknown>[]>([]);
          const results = yield* Effect.provideService(eff, WriteExecutor, (stm) =>
            Ref.update(ref, (a) => [...a, stm])
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

        return prog;
      } else if (isolationLevel === IsolationLevel.Serializable) {
        return eff.pipe(
          client.withTransaction,
          Effect.catchTag('SqlError', (e) => Effect.fail(new TransactionError({ cause: e })))
        );
      } else {
        return Effect.dieMessage(`${isolationLevel} not supported`);
      }
    };
  })
);
