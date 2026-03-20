import * as Schema from 'effect/Schema';
import { Clock, Context, Data, Effect } from 'effect';
import { isObject } from 'effect/Predicate';
import { nanoid } from 'nanoid';

export const EventBaseSchema = Schema.Struct({
  _context: Schema.String,
  _tag: Schema.String,
  occurredOn: Schema.Date,
  messageId: Schema.String
});

type DomainEventTag = { __type: 'DomainEvent' };

export type EncodableEventBase = typeof EventBaseSchema.Type & {
  readonly [Schema.symbolSerializable]: Schema.Schema.AnyNoContext;
} & DomainEventTag;

export type Encodable<F extends Schema.Struct.Fields> = Schema.Struct<F>['Type'] & {
  readonly [Schema.symbolSerializable]: Schema.Struct<F>;
} & DomainEventTag;

export type EventSchemas<F extends Schema.Struct.Fields> = {
  schema: Schema.Struct<F>;
  metadata: Pick<typeof EventBaseSchema.Type, '_context' | '_tag'>;
  _tag: 'EventSchema';
  make: (
    args: Omit<Parameters<Schema.Struct<F>['make']>[0], 'messageId' | 'occurredOn'>
  ) => Effect.Effect<Readonly<Encodable<F>>, never, UUIDGenerator>;
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

  const domainEvent: EventSchemas<typeof schema.fields> = {
    schema,
    make: (args) =>
      Effect.gen(function* () {
        const uuid = yield* UUIDGenerator.generate();
        const date = new Date(yield* Clock.currentTimeMillis);
        return {
          ...schema.make({
            ...(args as Parameters<typeof schema.make>[0]),
            messageId: uuid,
            occurredOn: date
          }),
          get [Schema.symbolSerializable]() {
            return schema;
          },
          __type: 'DomainEvent'
        } as unknown as Readonly<Encodable<typeof schema.fields>>;
      }),
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
    register<S extends EventSchemas<Schema.Struct.Fields>[], Err, Req>(
      eventSchemas: S,
      handler: (e: S[number]['schema']['Type']) => Effect.Effect<void, Err, Req>,
      config: { $durableName: string }
    ): Effect.Effect<void, never, Req>;
  }
>() {}

export class UUIDGenerator extends Effect.Service<UUIDGenerator>()('@hex-effect/UUIDGenerator', {
  succeed: {
    generate() {
      return nanoid();
    }
  } as const,
  accessors: true
}) {}

export enum IsolationLevel {
  ReadCommitted = 'ReadCommitted',
  RepeatableReads = 'RepeatableReads',
  Serializable = 'Serializable',
  /** A non-standard isolation level, supported by libsql and d1. No read-your-writes semantics within a transaction as all writes are committed at once at the end of a tx. */
  Batched = 'Batched'
}

export class DataIntegrityError extends Data.TaggedError('@hex-effect/DataIntegrityError')<{
  cause: unknown;
}> {}

export class InfrastructureError extends Data.TaggedError('@hex-effect/InfrastructureError')<{
  cause: unknown;
}> {
  get message() {
    return `${this.cause}`;
  }
}

export type PersistenceError = DataIntegrityError | InfrastructureError;

export const isPersistenceError = (a: unknown): a is PersistenceError =>
  isObject(a) && (a instanceof DataIntegrityError || a instanceof InfrastructureError);

export class WithTransaction extends Context.Tag('@hex-effect/WithTransaction')<
  WithTransaction,
  <E, R, A extends EncodableEventBase>(
    eff: Effect.Effect<ReadonlyArray<A>, E, R>,
    isolationLevel: IsolationLevel
  ) => Effect.Effect<ReadonlyArray<A>, E | PersistenceError, R>
>() {}

export function withTXBoundary(level: IsolationLevel) {
  return <E, R, A extends EncodableEventBase>(
    useCase: Effect.Effect<ReadonlyArray<A>, E, R>
  ): Effect.Effect<ReadonlyArray<A>, E | PersistenceError, WithTransaction | R> =>
    Effect.flatMap(WithTransaction, (withTx) => withTx(useCase, level));
}
