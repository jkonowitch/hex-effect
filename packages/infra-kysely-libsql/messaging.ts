import { Schema } from '@effect/schema';
import { LibsqlError } from '@libsql/client';
import { Config, Effect } from 'effect';
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

const publishEvents = (events: Events, jetstream: JetStreamClient) =>
  Effect.gen(function* () {
    const applicationName = yield* Config.string('APPLICATION_NAME');
    yield* Effect.forEach(events, (event) =>
      Effect.tryPromise(() =>
        jetstream.publish(`${applicationName}.${event.context}.${event.tag}`, event.payload, {
          msgID: event.id
        })
      )
    );
    yield* Effect.log('publishing events');
  });

export const doThing = (publisher: EventStoreService, jetstream: JetStreamClient) =>
  publisher
    .getUnpublished()
    .pipe(
      Effect.andThen((events) =>
        Effect.zip(
          publishEvents(events, jetstream),
          publisher.markPublished(events.map((e) => e.id))
        )
      )
    );
