import { LibsqlError } from '@libsql/client';
import { Config, Effect } from 'effect';
import type { JetStreamClient } from 'nats';

type Events = {
  id: string;
  payload: string;
  tag: string;
  context: string;
}[];

export type EventPublisher = {
  getUnpublished: () => Effect.Effect<Events, LibsqlError>;
  markPublished: (ids: string[]) => Effect.Effect<void, LibsqlError>;
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

export const doThing = (publisher: EventPublisher, jetstream: JetStreamClient) =>
  Effect.gen(function* () {
    const events = yield* publisher.getUnpublished();
    yield* publishEvents(events, jetstream);
    yield* publisher.markPublished(events.map((e) => e.id));
  });
