import { Schema } from '@effect/schema';
import type { symbol } from '@effect/schema/Serializable';
import { Context, Effect, Fiber, Layer, PubSub, Scope } from 'effect';
import { nanoid } from 'nanoid';

/**
 * All events must extend from this base, and are expected to have a `_tag` as well (see `EventBaseType`)
 */
export const EventBaseSchema = Schema.Struct({
  _context: Schema.String,
  occurredOn: Schema.Date.pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => new Date())
  ),
  messageId: Schema.String.pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => nanoid())
  )
});

type EventBaseType = typeof EventBaseSchema.Type & { _tag: string } & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [symbol]: Schema.Schema<any, any, never>;
};

/**
 * Abstract service, defined in the `domain` layer, that allows publishing of arbitrary domain events
 */
export class DomainEventPublisher extends Context.Tag('DomainEventPublisher')<
  DomainEventPublisher,
  PubSub.PubSub<EventBaseType>
>() {
  public static live = Layer.effect(DomainEventPublisher, PubSub.bounded<EventBaseType>(2));
}

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

/**
 * Service which controls the opening and closing of a "transaction"
 * Abstracted from a particular infrastructure.
 * Isolation Levels are implemented by an infra-specific adapter
 */
export type ITransactionalBoundary = {
  begin(mode: IsolationLevel): Effect.Effect<void, never, Scope.Scope | DomainEventPublisher>;
  commit(): Effect.Effect<void, never, Scope.Scope | DomainEventPublisher>;
  rollback(): Effect.Effect<void, never, Scope.Scope | DomainEventPublisher>;
};

export class TransactionalBoundary extends Context.Tag('TransactionalBoundary')<
  TransactionalBoundary,
  ITransactionalBoundary
>() {}

export class TransactionalBoundaryProvider extends Context.Tag('TransactionalBoundaryProvider')<
  TransactionalBoundaryProvider,
  Layer.Layer<TransactionalBoundary | DomainEventPublisher>
>() {}

export function withTransactionalBoundary(level: IsolationLevel) {
  return <A, E, R>(
    useCase: Effect.Effect<A, E, R>
  ): Effect.Effect<
    A,
    E,
    | TransactionalBoundaryProvider
    | Exclude<Exclude<R, TransactionalBoundary | DomainEventPublisher>, Scope.Scope>
  > =>
    Effect.gen(function* () {
      const boundary = yield* TransactionalBoundaryProvider;

      const fiber = yield* Effect.gen(function* () {
        const tx = yield* TransactionalBoundary;
        yield* tx.begin(level);
        const result = yield* useCase.pipe(Effect.tapError(tx.rollback));
        yield* tx.commit();
        return result;
      }).pipe(Effect.provide(boundary), Effect.scoped, Effect.fork);

      const exit = yield* Fiber.await(fiber);
      return yield* exit;
    });
}

class EventStore extends Context.Tag('EventStore')<
  EventStore,
  { save: (e: EventBaseType[]) => Effect.Effect<void> }
>() {}

type WithTransaction = <A, E, R>(
  eff: Effect.Effect<A, E, R>,
  isolationLevel: IsolationLevel
) => Effect.Effect<A, E, R>;

const WithTransaction = Context.GenericTag<WithTransaction>('WithTransaction');

export class TransactionEvents extends Context.Tag('TransactionEvents')<
  TransactionEvents,
  PubSub.PubSub<'committed' | 'rolled-back'>
>() {
  public static live = Layer.effect(
    TransactionEvents,
    PubSub.sliding<'committed' | 'rolled-back'>(10)
  );
}

export function withNextTXBoundary(level: IsolationLevel) {
  return <A extends EventBaseType[], E, R>(
    useCase: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, WithTransaction | EventStore | TransactionEvents | R> =>
    Effect.gen(function* () {
      const withTx = yield* WithTransaction;
      const eventStore = yield* EventStore;
      const txEvents = yield* TransactionEvents;
      const events = yield* withTx(useCase.pipe(Effect.tap(eventStore.save)), level);
      yield* txEvents.publish('committed');
      return events;
    });
}
