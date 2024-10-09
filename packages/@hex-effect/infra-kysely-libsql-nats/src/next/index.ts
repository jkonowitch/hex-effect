import {
  EventBaseSchema,
  IsolationLevel,
  TransactionError,
  WithTransaction,
  type EventBaseType
} from '@hex-effect/core';
import { Config, Context, Effect, Layer, Option, PubSub, Ref } from 'effect';
import { SqlClient, type Statement } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { LibsqlClient } from '@effect/sql-libsql';
import { createClient, type InValue } from '@libsql/client';
import type { ParseError } from '@effect/schema/ParseResult';
import { Schema } from '@effect/schema';
import { isTagged } from 'effect/Predicate';

class _WriteExecutor extends Context.Tag('@hex-effect/_WriteExecutor')<
  _WriteExecutor,
  (stm: Statement.Statement<unknown>) => Effect.Effect<void, SqlError>
>() {
  public static live = Layer.succeed(this, (stm) => stm);
}

export class LibsqlSdk extends Effect.Service<LibsqlSdk>()('@hex-effect/LibsqlSdk', {
  scoped: Effect.gen(function* () {
    const url = yield* Config.string('TURSO_URL');
    const sdk = yield* Effect.acquireRelease(
      Effect.sync(() => createClient({ url })),
      (a) => Effect.sync(() => a.close())
    );

    return { sdk };
  }),
  accessors: true
}) {}

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

export const UnpublishedEventRecord = Schema.Struct({
  ...EventBaseSchema.omit('occurredOn').fields,
  ...EventRecordInsert.pick('payload').fields
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

    return Layer.mergeAll(SaveEvents.live, GetUnpublishedEvents.live);
  })
);

const isTaggedError = (e: unknown) => isTagged(e, 'SqlError') || isTagged(e, 'ParseError');

export const WithTransactionLive = Layer.effect(
  WithTransaction,
  Effect.gen(function* () {
    const client = yield* LibsqlClient.LibsqlClient;
    const sdk = yield* LibsqlSdk.sdk;

    const save = yield* SaveEvents;
    const pub = yield* UseCaseCommit;
    return <A extends EventBaseType[], E, R>(
      useCase: Effect.Effect<A, E, R>,
      isolationLevel: IsolationLevel
    ) => {
      const useCaseWithEventStorage = useCase.pipe(
        Effect.tap(save),
        Effect.mapError((e) => (isTaggedError(e) ? new TransactionError({ cause: e }) : e))
      );

      let program: Effect.Effect<A, E | TransactionError, R>;

      if (isolationLevel === IsolationLevel.Batched) {
        program = Effect.gen(function* () {
          const ref = yield* Ref.make<Statement.Statement<unknown>[]>([]);
          const results = yield* Effect.provideService(
            useCaseWithEventStorage,
            _WriteExecutor,
            (stm) => Ref.update(ref, (a) => [...a, stm])
          );
          const writes = yield* Ref.get(ref);
          yield* Effect.tryPromise({
            try: () =>
              sdk.batch(
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
        program = useCaseWithEventStorage.pipe(
          client.withTransaction,
          Effect.mapError((e) => (isTaggedError(e) ? new TransactionError({ cause: e }) : e))
        );
      } else {
        return Effect.dieMessage(`${isolationLevel} not supported`);
      }

      return program.pipe(Effect.tap(() => pub.publish()));
    };
  })
);

export class UseCaseCommit extends Context.Tag('@hex-effect/UseCaseCommit')<
  UseCaseCommit,
  PubSub.PubSub<void>
>() {
  public static live = Layer.effect(UseCaseCommit, PubSub.sliding<void>(10));
}
