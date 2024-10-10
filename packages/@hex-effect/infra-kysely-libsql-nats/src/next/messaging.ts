import { Config, Context, Data, Effect, Layer } from 'effect';
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
  type ConsumerUpdateConfig
} from '@nats-io/jetstream';
import { Schema } from '@effect/schema';
import { EventBaseSchema, EventConsumer } from '@hex-effect/core';
import type { UnpublishedEventRecord } from './index.js';
import { UnknownException } from 'effect/Cause';
import { get } from 'effect/Struct';
import { constTrue } from 'effect/Function';

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

class AppNamespace extends Effect.Service<AppNamespace>()('@hex-effect/AppNamespace', {
  accessors: true,
  effect: Config.string('APPLICATION_NAMESPACE').pipe(
    Effect.map((applicationNamespace) => ({
      applicationNamespace
    }))
  )
}) {
  asSubject(e: typeof EventMetadata.Type): string {
    return `${this.applicationNamespace}.${e._context}.${e._tag}`;
  }
}

class EstablishedJetstream extends Effect.Service<EstablishedJetstream>()(
  '@hex-effect/EstablishedJetstream',
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const ns = yield* AppNamespace.applicationNamespace;
      const conn = yield* NatsClient;
      const jsm = yield* Effect.promise(() => jetstreamManager(conn));
      const streamInfo = yield* callNats(
        jsm.streams.add({
          name: ns,
          subjects: [`${ns}.>`],
          retention: RetentionPolicy.Interest
        })
      );

      return { streamInfo, jsm } as const;
    }),
    dependencies: [AppNamespace.Default]
  }
) {}

export class PublishEvent extends Effect.Service<PublishEvent>()('@hex-effect/PublishEvent', {
  accessors: true,
  effect: Effect.gen(function* () {
    const a = yield* AppNamespace;
    const conn = yield* NatsClient;
    const js = jetstream(conn);

    return {
      publish: (e: typeof UnpublishedEventRecord.Type) =>
        callNats(js.publish(a.asSubject(e), e.payload, { msgID: e.messageId, timeout: 1000 }))
    };
  }),
  dependencies: [AppNamespace.Default, EstablishedJetstream.Default]
}) {}

const EventMetadata = EventBaseSchema.pick('_context', '_tag');

export class NatsEventConsumer extends Effect.Service<NatsEventConsumer>()(
  '@hex-effect/NatsEventConsumer',
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const ns = yield* AppNamespace;
      const ctx = yield* Effect.context<EstablishedJetstream>();
      const q: typeof EventConsumer.Service = {
        register(schema, handler, config) {
          const allSchemas = Schema.Union(...schema.map(get('schema'))) as Schema.Schema<
            unknown,
            unknown
          >;
          const subjects = schema.map((s) => ns.asSubject(s.metadata));

          console.log(subjects);
          // const e = Schema.decodeUnknownSync(allSchemas)('');
          return handler('e').pipe(Effect.orDie);
        }
      };
      return q;
    }),
    dependencies: [AppNamespace.Default, EstablishedJetstream.Default]
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
