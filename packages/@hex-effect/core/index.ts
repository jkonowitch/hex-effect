/* eslint-disable @typescript-eslint/no-explicit-any */

import { Schema } from '@effect/schema';
import { Serializable } from '@effect/schema';
import type { Struct } from '@effect/schema/Schema';
import { Context, Data, Effect } from 'effect';
import { nanoid } from 'nanoid';

export const EventBaseSchema = Schema.Struct({
  _context: Schema.String,
  _tag: Schema.String,
  occurredOn: Schema.Date.pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => new Date())
  ),
  messageId: Schema.String.pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => nanoid())
  )
});

export type EncodableEventBase = Encodable<typeof EventBaseSchema.fields>;

export type Encodable<F extends Struct.Fields> = Schema.Struct<F>['Type'] & {
  readonly [Serializable.symbol]: Schema.Struct<F>;
};

export type EventSchemas<F extends Struct.Fields, Z extends Schema.Struct<F>> = {
  schema: Z;
  metadata: Pick<typeof EventBaseSchema.Type, '_context' | '_tag'>;
  _tag: 'EventSchema';
  make: (...args: Parameters<Z['make']>) => Encodable<F>;
};

/**
 * Builder for Domain Events
 */
export const makeDomainEvent = <T extends string, C extends string, F extends Schema.Struct.Fields>(
  metadata: { _tag: T; _context: C },
  fields: F
) => {
  const schema = Schema.TaggedStruct(metadata._tag, {
    ...EventBaseSchema.omit('_context', '_tag').fields,
    ...fields,
    _context: Schema.Literal(metadata._context).pipe(
      Schema.propertySignature,
      Schema.withConstructorDefault(() => metadata._context)
    )
  });

  const domainEvent: EventSchemas<typeof schema.fields, typeof schema> = {
    schema,
    make: (...args: Parameters<typeof schema.make>) => {
      const made = schema.make(...args);
      return {
        ...made,
        get [Serializable.symbol]() {
          return schema;
        }
      };
    },
    metadata,
    _tag: 'EventSchema'
  } as const;

  return domainEvent;
};

/**
 * Service which allows an `application` to connect a Domain Event with a handler
 * This is a linchpin service that enables an event-driven architecture
 */
export class EventConsumer extends Context.Tag('@hex-effect/EventConsumer')<
  EventConsumer,
  {
    register<
      E extends EventSchemas<typeof EventBaseSchema.fields, typeof EventBaseSchema>[],
      Err,
      Req
    >(
      eventSchemas: E,
      handler: (e: E[number]['schema']['Type']) => Effect.Effect<void, Err, Req>,
      config: { $durableName: string }
    ): Effect.Effect<void, never, Req>;
  }
>() {}

export enum IsolationLevel {
  ReadCommitted = 'ReadCommitted',
  RepeatableReads = 'RepeatableReads',
  Serializable = 'Serializable',
  /** A non-standard isolation level, supported by libsql and d1. No read-your-writes semantics within a transaction as all writes are committed at once at the end of a tx. */
  Batched = 'Batched'
}

export class TransactionError extends Data.TaggedError('@hex-effect/TransactionError')<{
  cause: unknown;
}> {}

export class WithTransaction extends Context.Tag('@hex-effect/WithTransaction')<
  WithTransaction,
  <E, R, A extends Encodable<any>>(
    eff: Effect.Effect<A[], E, R>,
    isolationLevel: IsolationLevel
  ) => Effect.Effect<A[], E | TransactionError, R>
>() {}

export function withNextTXBoundary(level: IsolationLevel) {
  return <E, R, A extends Encodable<any>>(
    useCase: Effect.Effect<A[], E, R>
  ): Effect.Effect<A[], E | TransactionError, WithTransaction | R> =>
    Effect.gen(function* () {
      const withTx = yield* WithTransaction;
      const events = yield* withTx(useCase, level);
      return events;
    });
}
