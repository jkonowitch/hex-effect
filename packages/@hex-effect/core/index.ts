/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Schema } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { Context, Data, Effect, Fiber, Layer, Scope } from 'effect';
import { nanoid } from 'nanoid';

/**
 * All events must extend from this base
 */
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

export type EventBaseType = typeof EventBaseSchema.Type & {
  encode: (
    args: typeof EventBaseSchema.Type
  ) => Effect.Effect<typeof EventBaseSchema.Encoded, ParseError, never>;
};

type Jawn<Z extends Schema.Schema<any, any, any>> = Z['Type'] & {
  encode: (args: Z['Type']) => Effect.Effect<Z['Encoded'], ParseError, never>;
};

type EventSchemas = {
  schema: Schema.Schema<any, any, any>;
  metadata: Pick<EventBaseType, '_context' | '_tag'>;
  _tag: 'EventSchema';
  make: (...args: any[]) => Jawn<Schema.Schema<any, any, any>>;
};

const makeDomainEvent = <T extends string, C extends string, F extends Schema.Struct.Fields>(
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

  const encode = Schema.encode(schema);

  return {
    schema,
    make: (...args: Parameters<typeof schema.make>) => ({ ...schema.make(...args), encode }),
    metadata,
    _tag: 'EventSchema'
  } as const satisfies EventSchemas;
};

const PersonCreatedEvent = makeDomainEvent(
  { _tag: 'jawn', _context: 'kralf' },
  { sid: Schema.String }
);

const BlahPerson = makeDomainEvent({ _tag: 'shmee', _context: 'kralf' }, { id: Schema.String });

const r = BlahPerson.make({ id: 'asd' });
const ss = <A extends typeof EventBaseSchema.Type, I, R>(e: Jawn<Schema.Schema<A, I, R>>) => null;

ss(r);

function eventConsumer<E extends EventSchemas[], Err, Req>(
  eventSchemas: E,
  handler: (e: E[number]['schema']['Type']) => Effect.Effect<void, Err, Req>,
  config: { $durableName: string }
) {
  const union = Schema.Union(...eventSchemas.map((s) => s.schema));
}

eventConsumer([PersonCreatedEvent, BlahPerson], (e) => Effect.void, { $durableName: 'asd' });

export class EventConsumer extends Context.Tag('@hex-effect/EventConsumer')<
  EventConsumer,
  {
    register<Q extends EventBaseType, I, R extends never, Err, Req>(
      eventSchema: Schema.Schema<Q, I, R>,
      triggers: {
        context: Schema.Schema<Q, I, R>['Type']['_context'];
        tag: Schema.Schema<Q, I, R>['Type']['_tag'];
      }[],
      handler: (e: Schema.Schema<Q, I, R>['Type']) => Effect.Effect<void, Err, Req>,
      config: { $durableName: string }
    ): Effect.Effect<void, never, Req>;
  }
>() {}

/**
 * Service which allows an `application` to connect a Domain Event with a handler
 * This is a linchpin service that enables an event-driven architecture
 */
export class EventHandlerService extends Context.Tag('EventHandlerService')<
  EventHandlerService,
  {
    register<Q extends EventBaseType, I, R extends never, Err, Req>(
      eventSchema: Schema.Schema<Q, I, R>,
      triggers: {
        context: Schema.Schema<Q, I, R>['Type']['_context'];
        tag: Schema.Schema<Q, I, R>['Type']['_tag'];
      }[],
      handler: (e: Schema.Schema<Q, I, R>['Type']) => Effect.Effect<void, Err, Req>,
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
  <A extends EventBaseType[], E, R>(
    eff: Effect.Effect<A, E, R>,
    isolationLevel: IsolationLevel
  ) => Effect.Effect<A, E | TransactionError, R>
>() {}

export function withNextTXBoundary(level: IsolationLevel) {
  return <A extends EventBaseType[], E, R>(
    useCase: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | TransactionError, WithTransaction | R> =>
    Effect.gen(function* () {
      const withTx = yield* WithTransaction;
      const events = yield* withTx(useCase, level);
      return events;
    });
}
