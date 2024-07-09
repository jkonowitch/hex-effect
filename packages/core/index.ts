import { Schema } from '@effect/schema';
import { Effect } from 'effect';

export const EventBase = Schema.Struct({
  _context: Schema.String,
  occurredOn: Schema.Date.pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => new Date())
  ),
  messageId: Schema.String.pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => '')
  )
});

export type DomainEventPublisher = {
  publish(event: typeof EventBase.Type & { _tag: string }): Effect.Effect<void>;
};
