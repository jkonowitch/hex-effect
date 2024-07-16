import { Schema } from '@effect/schema';
import { Effect } from 'effect';
import { nanoid } from 'nanoid';

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

export type DomainEventPublisher = {
  publish(event: EventBaseWithTag): Effect.Effect<void>;
};

export type EventHandlerService = {
  register<Q extends EventBaseWithTag, I, R extends never, Err, Req>(
    eventSchema: Schema.Schema<Q, I, R>,
    eventNames: `${Schema.Schema<Q, I, R>['Type']['_context']}/${Schema.Schema<Q, I, R>['Type']['_tag']}`[],
    handler: (e: Schema.Schema<Q, I, R>['Type']) => Effect.Effect<void, Err, Req>,
    config: { $durableName: string }
  ): Effect.Effect<void, never, Req>;
};

// function registerEventHandler<Q extends EventBaseWithTag, I, R extends never>(
//   eventSchema: Schema.Schema<Q, I, R>,
//   eventNames: `${Schema.Schema<Q, I, R>['Type']['_context']}/${Schema.Schema<Q, I, R>['Type']['_tag']}`[],
//   handler: (e: Schema.Schema<Q, I, R>['Type']) => Effect.Effect<void>,
//   config: { $durableName: string }
// ) {
//   const r = Schema.decodeUnknownSync(eventSchema)('asdasd');
//   handler(r);
// }
