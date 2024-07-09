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
