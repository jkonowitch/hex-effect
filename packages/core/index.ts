import { Schema } from '@effect/schema';
import { Effect, Scope } from 'effect';
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
//write-consistent, write-lazy, read-lazy, read-consistent
export type TransactionalBoundary = {
  begin(
    mode: 'write-consistent' | 'write-lazy' | 'read-lazy' | 'read-consistent'
  ): Effect.Effect<void, never, Scope.Scope>;
  commit(): Effect.Effect<void, never, Scope.Scope>;
  rollback(): Effect.Effect<void>;
};
