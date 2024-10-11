import { Config, Context, Data, Effect, Exit, Layer, Predicate, Stream } from 'effect';
import {
  connect,
  type ConnectionOptions,
  ErrorCode,
  type NatsConnection,
  NatsError as RawNatsError
} from '@nats-io/transport-node';
import {
  AckPolicy,
  jetstream,
  jetstreamManager,
  RetentionPolicy,
  type ConsumerInfo,
  type ConsumerUpdateConfig,
  type JsMsg
} from '@nats-io/jetstream';
import { Schema } from '@effect/schema';
import { EventBaseSchema, EventConsumer } from '@hex-effect/core';
import type { UnpublishedEventRecord } from './index.js';
import { UnknownException } from 'effect/Cause';
import { get } from 'effect/Struct';
import { constTrue, constVoid, pipe } from 'effect/Function';

class NatsError extends Data.TaggedError('NatsError')<{ raw: RawNatsError }> {
  static isNatsError(e: unknown): e is RawNatsError {
    return e instanceof RawNatsError;
  }
  get message() {
    return `${this.raw.message}\n${this.raw.stack}`;
  }
}

const callNats = <T>(operation: Promise<T>) =>
  Effect.tryPromise({
    try: () => operation,
    catch: (e) => (NatsError.isNatsError(e) ? new NatsError({ raw: e }) : new UnknownException(e))
  }).pipe(Effect.catchTag('UnknownException', (e) => Effect.die(e)));

class EstablishedJetstream extends Effect.Service<EstablishedJetstream>()(
  '@hex-effect/EstablishedJetstream',
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const applicationNamespace = yield* Config.string('APPLICATION_NAMESPACE');
      const conn = yield* NatsClient;
      const jsm = yield* Effect.promise(() => jetstreamManager(conn));
      const streamInfo = yield* callNats(
        jsm.streams.add({
          name: applicationNamespace,
          subjects: [`${applicationNamespace}.>`],
          retention: RetentionPolicy.Interest
        })
      );
      return {
        streamInfo,
        jsm,
        js: jetstream(conn),
        applicationNamespace,
        asSubject(e: typeof EventMetadata.Type): string {
          return `${applicationNamespace}.${e._context}.${e._tag}`;
        }
      } as const;
    })
  }
) {}

export class PublishEvent extends Effect.Service<PublishEvent>()('@hex-effect/PublishEvent', {
  accessors: true,
  effect: Effect.gen(function* () {
    const { asSubject, js } = yield* EstablishedJetstream;

    return {
      publish: (e: typeof UnpublishedEventRecord.Type) =>
        callNats(js.publish(asSubject(e), e.payload, { msgID: e.messageId, timeout: 1000 }))
    };
  }),
  dependencies: [EstablishedJetstream.Default]
}) {}

const EventMetadata = EventBaseSchema.pick('_context', '_tag');

export class NatsEventConsumer extends Effect.Service<NatsEventConsumer>()(
  '@hex-effect/NatsEventConsumer',
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const ctx = yield* Effect.context<EstablishedJetstream>();

      const register: (typeof EventConsumer.Service)['register'] = (schema, handler, config) => {
        const allSchemas = Schema.Union(...schema.map(get('schema'))) as Schema.Schema<
          unknown,
          unknown
        >;
        const subjects = schema.map((s) =>
          Context.get(ctx, EstablishedJetstream).asSubject(s.metadata)
        );
        const processMessage = (msg: JsMsg) =>
          Effect.acquireUseRelease(
            Effect.succeed(msg),
            (a) =>
              pipe(
                Schema.decodeUnknown(Schema.parseJson(allSchemas))(a.string()),
                Effect.flatMap(handler)
              ),
            (m, exit) =>
              Exit.match(exit, {
                onSuccess: () => Effect.promise(() => m.ackAck()).pipe(Effect.as(constVoid())),
                onFailure: (c) =>
                  c._tag === 'Fail'
                    ? Predicate.isTagged('ParseError')(c.error)
                      ? Effect.sync(() => m.term())
                      : Effect.sync(() => m.nak())
                    : Effect.sync(() => m.term())
              })
          );
        return pipe(
          upsertConsumer({
            $durableName: config.$durableName,
            subjects
          }),
          Effect.flatMap(createStream),
          Effect.provide(ctx),
          Effect.orDie,
          Effect.flatMap((stream) => Stream.runForEach(stream, processMessage).pipe(Effect.fork))
        );
      };
      return { register };
    }),
    dependencies: [EstablishedJetstream.Default]
  }
) {}

const upsertConsumer = (params: { $durableName: string; subjects: string[] }) =>
  Effect.gen(function* () {
    const config: ConsumerUpdateConfig = {
      max_deliver: 3,
      filter_subjects: params.subjects
    };

    const stream = yield* EstablishedJetstream;

    const consumerExists = yield* callNats(
      stream.jsm.consumers.info(stream.streamInfo.config.name, params.$durableName)
    ).pipe(
      Effect.map(constTrue),
      Effect.catchIf(
        (e) => e.raw.code === ErrorCode.JetStream404NoMessages,
        () => Effect.succeed(false)
      )
    );

    if (consumerExists) {
      return yield* callNats(
        stream.jsm.consumers.update(stream.streamInfo.config.name, params.$durableName, config)
      );
    } else {
      return yield* callNats(
        stream.jsm.consumers.add(stream.streamInfo.config.name, {
          ...config,
          ack_policy: AckPolicy.Explicit,
          durable_name: params.$durableName
        })
      );
    }
    // the only allowable error is handled above
  }).pipe(Effect.orDie, Effect.tap(Effect.logDebug(`Added handler for ${params.$durableName}`)));

const createStream = (consumerInfo: ConsumerInfo) =>
  Effect.gen(function* () {
    const eJS = yield* EstablishedJetstream;

    const consumer = yield* Effect.acquireRelease(
      callNats(eJS.js.consumers.get(eJS.streamInfo.config.name, consumerInfo.name)).pipe(
        Effect.flatMap((c) => callNats(c.consume()))
      ),
      (consumer) => callNats(consumer.close()).pipe(Effect.orDie)
    );

    return Stream.fromAsyncIterable(consumer, (e) => new Error(`${e}`));
  });

export class NatsClient extends Context.Tag('@hex-effect/nats-client')<
  NatsClient,
  NatsConnection
>() {
  public static layer = (config: Config.Config.Wrap<ConnectionOptions>) =>
    Layer.scoped(
      this,
      Config.unwrap(config).pipe(
        Effect.flatMap((opts) =>
          Effect.acquireRelease(
            Effect.promise(() => connect(opts)),
            (conn) => Effect.promise(() => conn.drain())
          )
        )
      )
    );
}
