import { Schema } from '@effect/schema';
import { Context, Effect, PubSub, Scope } from 'effect';
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

type EventBaseType = typeof EventBaseSchema.Type & { _tag: string };

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

/**
 * Service which controls the opening and closing of a "transaction"
 * Abstracted from a particular infrastructure.
 * `Modes` are like isolation levels - generically defined and implemented by an infra-specific adapter
 */
export type TransactionalBoundary<Modes> = {
  begin(mode: Modes): Effect.Effect<void, never, Scope.Scope>;
  commit(): Effect.Effect<void, never>;
  rollback(): Effect.Effect<void>;
};
