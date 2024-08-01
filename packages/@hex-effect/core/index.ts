import { Schema } from '@effect/schema';
import type { symbol } from '@effect/schema/Serializable';
import { Context, Effect, Fiber, PubSub, Scope } from 'effect';
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
  public static live = Effect.provideServiceEffect(
    DomainEventPublisher,
    PubSub.unbounded<EventBaseType>()
  );
}

/**
 * Service which allows an `application` to connect a Domain Event with a handler
 * This is a linchpin service that enables an event-driven architecture
 */
export type EventHandlerService = {
  register<Q extends EventBaseType, I, R extends never, Err, Req>(
    eventSchema: Schema.Schema<Q, I, R>,
    triggers: {
      context: Schema.Schema<Q, I, R>['Type']['_context'];
      tag: Schema.Schema<Q, I, R>['Type']['_tag'];
    }[],
    handler: (e: Schema.Schema<Q, I, R>['Type']) => Effect.Effect<void, Err, Req>,
    config: { $durableName: string }
  ): Effect.Effect<void, never, Req>;
};

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

export function withTransactionalBoundary(level: IsolationLevel) {
  return <A, E, R>(
    useCase: Effect.Effect<A, E, R>
  ): Effect.Effect<
    A,
    E,
    TransactionalBoundary | Exclude<Exclude<R, DomainEventPublisher>, Scope.Scope>
  > =>
    Effect.gen(function* () {
      const fiber = yield* Effect.gen(function* () {
        const tx = yield* TransactionalBoundary;
        yield* tx.begin(level);
        const result = yield* useCase.pipe(Effect.tapError(tx.rollback));
        yield* tx.commit();
        return result;
      }).pipe(DomainEventPublisher.live, Effect.scoped, Effect.fork);

      const exit = yield* Fiber.await(fiber);
      return yield* exit;
    });
}
