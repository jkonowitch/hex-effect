import { Array, Effect, Layer, pipe, Stream, Struct } from 'effect';
import { UseCaseCommit } from './commit.js';
import { GetUnpublishedEvents, MarkAsPublished, SaveEvents } from './event-store.js';
import { PublishEvent } from './messaging.js';

const publishPipeline = pipe(
  GetUnpublishedEvents,
  Effect.flatMap((getUnpublished) => getUnpublished()),
  Effect.tap((events) => Effect.forEach(events, PublishEvent.publish)),
  Effect.map(Array.map(Struct.get('messageId'))),
  Effect.flatMap((ids) => (ids.length === 0 ? Effect.void : MarkAsPublished.markAsPublished(ids)))
);

export const EventPublisherDaemon = Layer.scopedDiscard(
  Effect.gen(function* () {
    yield* publishPipeline;
    yield* Effect.serviceConstants(UseCaseCommit).subscribe.pipe(
      Effect.map(Stream.fromQueue),
      Effect.flatMap(Stream.runForEach(() => publishPipeline)),
      Effect.forkScoped
    );
  })
).pipe(
  Layer.provide(SaveEvents.Default),
  Layer.provide(GetUnpublishedEvents.live),
  Layer.provide(MarkAsPublished.Default),
  Layer.provide(PublishEvent.Default),
  Layer.provide(UseCaseCommit.live)
);
