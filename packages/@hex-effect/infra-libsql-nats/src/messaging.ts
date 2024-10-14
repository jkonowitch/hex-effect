import {
  Config,
  Context,
  Data,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Stream,
  Struct,
  Supervisor
} from 'effect';
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
import { UnknownException } from 'effect/Cause';
import { constTrue, constVoid, pipe } from 'effect/Function';
import type { UnpublishedEventRecord } from './event-store.js';

export const NatsConfig = Context.GenericTag<{
  config: Config.Config.Wrap<ConnectionOptions>;
  appNamespace: Config.Config<string>;
}>('@hex-effect/NatsConfig');

export class NatsClient extends Context.Tag('@hex-effect/nats-client')<
  NatsClient,
  NatsConnection
>() {
  public static layer = Layer.scoped(
    this,
    Effect.gen(function* () {
      const config = yield* NatsConfig.pipe(
        Effect.map(Struct.get('config')),
        Effect.flatMap(Config.unwrap)
      );
      return yield* Effect.acquireRelease(
        Effect.promise(() => connect(config)),
        (conn) => Effect.promise(() => conn.drain())
      );
    })
  );
}

class EstablishedJetstream extends Effect.Service<EstablishedJetstream>()(
  '@hex-effect/EstablishedJetstream',
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const appNamespace = yield* NatsConfig.pipe(
        Effect.map(Struct.get('appNamespace')),
        Effect.flatMap(Config.unwrap)
      );
      const conn = yield* NatsClient;
      const jsm = yield* Effect.promise(() => jetstreamManager(conn));
      const streamInfo = yield* callNats(
        jsm.streams.add({
          name: appNamespace,
          subjects: [`${appNamespace}.>`],
          retention: RetentionPolicy.Interest
        })
      );
      return {
        streamInfo,
        jsm,
        js: jetstream(conn),
        appNamespace,
        asSubject(e: typeof EventMetadata.Type): string {
          return `${appNamespace}.${e._context}.${e._tag}`;
        }
      } as const;
    }),
    dependencies: [NatsClient.layer]
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

class EventConsumerSupervisor extends Effect.Service<EventConsumerSupervisor>()(
  'EventConsumerSupervisor',
  {
    scoped: Effect.gen(function* () {
      const supervisor = yield* Supervisor.track;
      const scope = yield* Effect.scope;

      const track = <A, R, S extends Stream.Stream<A, Error, never>>(
        createStream: Effect.Effect<S, never, Scope.Scope>,
        processStream: (v: A) => Effect.Effect<void, never, R>
      ) =>
        Effect.gen(function* () {
          const stream = yield* createStream.pipe(Scope.extend(scope));
          yield* Stream.runForEach(stream, processStream).pipe(
            Effect.supervised(supervisor),
            Effect.fork
          );
        });

      yield* Effect.addFinalizer(() => supervisor.value.pipe(Effect.flatMap(Fiber.interruptAll)));

      return { track };
    })
  }
) {}

export class NatsEventConsumer extends Effect.Service<NatsEventConsumer>()(
  '@hex-effect/NatsEventConsumer',
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const ctx = yield* Effect.context<EstablishedJetstream>();
      const supervisor = yield* EventConsumerSupervisor;

      const register: (typeof EventConsumer.Service)['register'] = (
        eventSchemas,
        handler,
        config
      ) => {
        const allSchemas = Schema.Union(...eventSchemas.map(Struct.get('schema'))) as Schema.Schema<
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          any,
          // remove the `unknown` context.
          never
        >;
        const subjects = eventSchemas.map((s) =>
          Context.get(ctx, EstablishedJetstream).asSubject(s.metadata)
        );

        const stream = pipe(
          upsertConsumer({
            $durableName: config.$durableName,
            subjects
          }),
          Effect.flatMap(createStream),
          Effect.provide(ctx),
          Effect.orDie
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
                onSuccess: () => Effect.promise(() => m.ackAck()).pipe(Effect.map(constVoid)),
                onFailure: (c) =>
                  // `nak` (e.g. retry) if it died or was interrupted, etc.
                  c._tag === 'Fail'
                    ? Effect.sync(() => m.term())
                    : // could make this exponential
                      Effect.sync(() => m.nak(m.info.redeliveryCount * 1000))
              })
          ).pipe(Effect.ignoreLogged);

        return supervisor.track(stream, processMessage);
      };
      return { register };
    }),
    dependencies: [EstablishedJetstream.Default, EventConsumerSupervisor.Default]
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

export class NatsError extends Data.TaggedError('NatsError')<{ raw: RawNatsError }> {
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
