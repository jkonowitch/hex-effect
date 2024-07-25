import { Schema } from '@effect/schema';
import type { EventHandlerService } from '@hex-effect/core';
import { Context, Data, Effect, Either, Equal, Layer, PubSub, Queue, Stream } from 'effect';
import { UnknownException } from 'effect/Cause';
import { constTrue } from 'effect/Function';
import type { ConsumerInfo, ConsumerUpdateConfig } from 'nats';
import { NatsError as RawNatsError, ErrorCode, AckPolicy } from 'nats';
import {
  TransactionEvents,
  type EventStoreService,
  type NatsService,
  type StoredEvent
} from './service-definitions.js';

class NatsError extends Data.TaggedError('NatsError')<{ raw: RawNatsError }> {
  static isNatsError(e: unknown): e is RawNatsError {
    return e instanceof RawNatsError;
  }
}

// const publishingPipeline = makePublishingPipeline(eventStore, natsService);

const EventPublishingDaemon = Layer.scopedDiscard(
  Effect.gen(function* () {
    const pub = yield* TransactionEvents;
    const dequeue = yield* PubSub.subscribe(pub);
    yield* Queue.take(dequeue)
      .pipe(
        Effect.map(Equal.equals('commit')),
        Effect.if({
          onTrue: () => publishingPipeline,
          onFalse: () => Effect.void
        }),
        Effect.forever
      )
      .pipe(Effect.forkScoped);
  })
);

const callNats = <T>(operation: Promise<T>) =>
  Effect.tryPromise({
    try: () => operation,
    catch: (e) => (NatsError.isNatsError(e) ? new NatsError({ raw: e }) : new UnknownException(e))
  }).pipe(Effect.catchTag('UnknownException', (e) => Effect.die(e)));

const makePublishingPipeline = (eventStore: EventStoreService, natsService: NatsService) => {
  const publishEvent = (event: StoredEvent) =>
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
  const live: EventHandlerService = {
    register(eventSchema, triggers, handler, config) {
      return Effect.gen(function* () {
        const consumerInfo = yield* upsertConsumer(natsService, config.$durableName, triggers);
        yield* streamEventsToHandler(consumerInfo, natsService, (payload: string) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknown(Schema.parseJson(eventSchema))(payload);
            yield* handler(decoded).pipe(Effect.annotateLogs('msgId', decoded.messageId));
          })
        );
      });
    }
  };

  return Layer.succeed(tag, live);
};

const streamEventsToHandler = <A, E, R>(
  consumerInfo: ConsumerInfo,
  natsService: NatsService,
  handler: (payload: string) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const consumer = yield* callNats(
      natsService.jetstream.consumers.get(natsService.streamInfo.config.name, consumerInfo.name)
    );

    const asynIter = yield* callNats(consumer.consume());
    const stream = Stream.fromAsyncIterable(asynIter, (e) => new Error(`${e}`));

    yield* Effect.addFinalizer(() =>
      Effect.zipRight(
        Effect.logDebug(`closing stream ${consumerInfo.name}`),
        callNats(asynIter.close()).pipe(Effect.ignoreLogged)
      )
    );

    yield* Stream.runForEach(stream, (msg) =>
      Effect.gen(function* () {
        const res = yield* handler(msg.data.toString()).pipe(Effect.either);

        yield* Either.match(res, {
          onLeft: (e) => {
            msg.term();
            return Effect.logError(`Message processing failed with: `, e);
          },
          onRight: () => callNats(msg.ackAck())
        });
      })
    );
  }).pipe(Effect.catchAll(Effect.logError), Effect.scoped);

const upsertConsumer = (
  natsService: NatsService,
  $durableName: string,
  triggers: { context: string; tag: string }[]
) =>
  Effect.gen(function* () {
    const config: ConsumerUpdateConfig = {
      max_deliver: 3,
      filter_subjects: triggers.map((t) => natsService.eventToSubject(t).asSubject)
    };

    const consumerExists = yield* callNats(
      natsService.jetstreamManager.consumers.info(natsService.streamInfo.config.name, $durableName)
    ).pipe(
      Effect.map(constTrue),
      Effect.catchIf(
        (e) => e.raw.code === ErrorCode.JetStream404NoMessages,
        () => Effect.succeed(false)
      )
    );

    if (consumerExists) {
      return yield* callNats(
        natsService.jetstreamManager.consumers.update(
          natsService.streamInfo.config.name,
          $durableName,
          config
        )
      );
    } else {
      return yield* callNats(
        natsService.jetstreamManager.consumers.add(natsService.streamInfo.config.name, {
          ...config,
          ack_policy: AckPolicy.Explicit,
          durable_name: $durableName
        })
      );
    }
    // the only allowable error is handled above
  }).pipe(Effect.orDie, Effect.tap(Effect.logDebug(`Added handler for ${$durableName}`)));
