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
import { createRequire } from 'module';
import type {
  ConnectionOptions,
  NatsConnection,
  connect as ConnectFn
} from '@nats-io/transport-node';
const { connect } = createRequire(import.meta.url)('@nats-io/transport-node') as {
  connect: typeof ConnectFn;
};
import {
  AckPolicy,
  jetstream,
  jetstreamManager,
  JetStreamApiCodes,
  JetStreamApiError,
  RetentionPolicy,
  type ConsumerInfo,
  type ConsumerUpdateConfig,
  type JsMsg
} from '@nats-io/jetstream';
import * as Schema from 'effect/Schema';
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
        asSubject(e: EventMetadata): string {
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

type EventMetadata = Pick<typeof EventBaseSchema.Type, '_context' | '_tag'>;

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
          yield* Effect.forkIn(
            Stream.runForEach(stream, processStream).pipe(Effect.supervised(supervisor)),
            scope
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
        // cast removes the `unknown` context produced by Schema.Union
        const allSchemas = Schema.Union(
          ...eventSchemas.map(Struct.get('schema'))
        ) as Schema.Schema.AnyNoContext;
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
              Effect.uninterruptible(
                pipe(
                  Schema.decodeUnknown(Schema.parseJson(allSchemas))(a.string()),
                  Effect.flatMap(handler)
                )
              ),
            (m, exit) =>
              Exit.match(exit, {
                onSuccess: () => Effect.promise(() => m.ackAck()).pipe(Effect.map(constVoid)),
                onFailure: (c) =>
                  // `nak` (e.g. retry) if it died or was interrupted, etc.
                  c._tag === 'Fail'
                    ? Effect.sync(() => m.term())
                    : // could make this exponential
                      Effect.sync(() => m.nak(m.info.deliveryCount * 1000))
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
        (e) =>
          e.raw instanceof JetStreamApiError && e.raw.code === JetStreamApiCodes.ConsumerNotFound,
        () => Effect.succeed(false)
      )
    );

    return yield* Effect.if(consumerExists, {
      onTrue: () =>
        callNats(
          stream.jsm.consumers.update(stream.streamInfo.config.name, params.$durableName, config)
        ),
      onFalse: () =>
        callNats(
          stream.jsm.consumers.add(stream.streamInfo.config.name, {
            ...config,
            ack_policy: AckPolicy.Explicit,
            durable_name: params.$durableName
          })
        )
    });
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

export class NatsError extends Data.TaggedError('NatsError')<{ raw: Error }> {
  get message() {
    return `${this.raw.message}\n${this.raw.stack}`;
  }
}

const callNats = <T>(operation: Promise<T>) =>
  Effect.tryPromise({
    try: () => operation,
    catch: (e) => (e instanceof Error ? new NatsError({ raw: e }) : new UnknownException(e))
  }).pipe(Effect.catchTag('UnknownException', (e) => Effect.die(e)));
