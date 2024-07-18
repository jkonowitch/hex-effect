import { Schema } from '@effect/schema';
import { EventHandlerService } from '@hex-effect/core';
import { LibsqlError } from '@libsql/client';
import { Context, Effect, Layer } from 'effect';
import type { JetStreamClient, JetStreamManager, StreamInfo } from 'nats';

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

export const makePublishingPipeline = (eventStore: EventStoreService, natsService: NatsService) => {
  const publishEvent = (event: Events[number]) =>
    Effect.tryPromise(() =>
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
      return Effect.log('Adding handler for ', triggers);
    }
  };

  return Layer.succeed(tag, s);
};
