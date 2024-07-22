import { Schema } from '@effect/schema';
import { Effect, Scope } from 'effect';
import { nanoid } from 'nanoid';

/**
 * All events must extend from this base, and are expected to have a `_tag` as well (see `EventBaseWithTag`)
 */
export const EventBase = Schema.Struct({
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

type EventBaseWithTag = typeof EventBase.Type & { _tag: string };

/**
 * Abstract service, defined in the `domain` layer, that allows publishing of arbitrary domain events
 */
export type DomainEventPublisher<EventType extends EventBaseWithTag> = {
  publish(event: EventType): Effect.Effect<void>;
};

/**
 * Service which allows an `application` to connect a Domain Event with a handler
 * This is a linchpin service that enables an event-driven architecture
 */
export type EventHandlerService = {
  register<Q extends EventBaseWithTag, I, R extends never, Err, Req>(
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
