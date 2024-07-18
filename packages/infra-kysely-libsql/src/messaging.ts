import { Schema } from '@effect/schema';
import { EventHandlerService } from '@hex-effect/core';
import { LibsqlError } from '@libsql/client';
import { Context, Data, Effect, Layer, Stream } from 'effect';
import { UnknownException } from 'effect/Cause';
import { constTrue } from 'effect/Function';
import type { ConsumerUpdateConfig, JetStreamClient, JetStreamManager, StreamInfo } from 'nats';
import { NatsError as RawNatsError, ErrorCode, AckPolicy } from 'nats';

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
  eventToSubject: (event: Pick<Events[number], 'context' | 'tag'>) => NatsSubject;
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
      Effect.gen(function* () {
        const consumerInfo = yield* upsertConsumer(natsService, config.$durableName, triggers);

        // const consumer = yield* callNats(
        //   natsService.jetstream.consumers.get(natsService.streamInfo.config.name, consumerInfo.name)
        // );

        // const asynIter = yield* callNats(consumer.consume());

        // const a = Stream.fromAsyncIterable(asynIter, (e) => new Error(`${e}`));
      });
      return upsertConsumer(natsService, config.$durableName, triggers).pipe(Effect.ignore);
    }
  };

  return Layer.succeed(tag, s);
};

// upsert consumer
// create a stream from the async iterable
// which hits the handler

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
  }).pipe(Effect.orDie, Effect.tap(Effect.log(`Added handler for ${$durableName}`)));
