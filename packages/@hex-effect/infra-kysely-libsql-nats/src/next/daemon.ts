import { Array, Effect, Layer, pipe, Stream, Struct } from 'effect';
import { UseCaseCommit } from './transactional-boundary.js';
import { GetUnpublishedEvents, MarkAsPublished, SaveEvents } from './event-store.js';
import { PublishEvent } from './messaging.js';
import { constVoid } from 'effect/Function';

export const EventPublisherDaemon = Layer.scopedDiscard(
  Effect.gen(function* () {
    const commitStream = yield* Effect.serviceConstants(UseCaseCommit).subscribe.pipe(
      Effect.map(Stream.fromQueue)
    );

    const publish = pipe(
      GetUnpublishedEvents,
      Effect.flatMap((getUnpublished) => getUnpublished()),
      Effect.tap((events) => Effect.forEach(events, PublishEvent.publish)),
      Effect.map(Array.map(Struct.get('messageId'))),
      Effect.flatMap(MarkAsPublished.markAsPublished),
      Effect.as(constVoid())
    );

    yield* commitStream.pipe(
      Stream.runForEach(() => publish),
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
