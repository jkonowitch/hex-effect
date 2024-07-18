import { Schema } from '@effect/schema';
import { EventHandlerService } from '@hex-effect/core';
import { LibsqlError } from '@libsql/client';
import { Context, Data, Effect, Layer } from 'effect';
import { UnknownException } from 'effect/Cause';
import type { JetStreamClient, JetStreamManager, StreamInfo } from 'nats';
import { NatsError as RawNatsError } from 'nats';

type Events = {
  id: string;
  payload: string;
  tag: string;
  context: string;
}[];

export type EventStoreService = {
  getUnpublished: () => Effect.Effect<Events, LibsqlError>;
  markPublished: (ids: string[]) => Effect.Effect<void, LibsqlError>;
  save: (event: { occurredOn: string; messageId: string }) => Effect.Effect<void, LibsqlError>;
};

export class NatsSubject extends Schema.Class<NatsSubject>('NatsSubject')({
  ApplicationNamespace: Schema.String,
  BoundedContext: Schema.String,
  EventTag: Schema.String
}) {
  get asSubject(): string {
    return `${this.ApplicationNamespace}.${this.BoundedContext}.${this.EventTag}`;
  }
}

export type NatsService = {
  jetstream: JetStreamClient;
  jetstreamManager: JetStreamManager;
  streamInfo: StreamInfo;
  eventToSubject: (event: Events[number]) => NatsSubject;
};

class NatsError extends Data.TaggedError('NatsError')<{ raw: RawNatsError }> {
  static isNatsError(e: unknown): e is RawNatsError {
    return e instanceof RawNatsError;
  }
}

const callNats = <T>(operation: Promise<T>) =>
  Effect.tryPromise({
    try: () => operation,
    catch: (e) => (NatsError.isNatsError(e) ? new NatsError({ raw: e }) : new UnknownException(e))
  }).pipe(Effect.catchTag('UnknownException', (e) => Effect.die(e)));

export const makePublishingPipeline = (eventStore: EventStoreService, natsService: NatsService) => {
  const publishEvent = (event: Events[number]) =>
    callNats(
      natsService.jetstream.publish(natsService.eventToSubject(event).asSubject, event.payload, {
        msgID: event.id,
        timeout: 1000
      })
    );

  return eventStore
    .getUnpublished()
    .pipe(
      Effect.andThen((events) =>
        Effect.zip(
          Effect.forEach(events, publishEvent),
          eventStore.markPublished(events.map((e) => e.id))
        )
      )
    )
    .pipe(Effect.catchAll((e) => Effect.logError(e)));
};

export const makeEventHandlerService = <Tag>(
  natsService: NatsService,
  tag: Context.Tag<Tag, EventHandlerService>
) => {
  const s: EventHandlerService = {
    register(eventSchema, triggers, handler, config) {
      const decoded = Schema.decodeUnknownSync(eventSchema)('asdasd');
      handler(decoded);
      return Effect.log('Adding handler for ', triggers);
    }
  };

  return Layer.succeed(tag, s);
};

// upsert consumer
// create a stream from the async iterable
// which hits the handler

// const upsertConsumer = (natsService: NatsService) => Effect.gen(function*() {

// })
