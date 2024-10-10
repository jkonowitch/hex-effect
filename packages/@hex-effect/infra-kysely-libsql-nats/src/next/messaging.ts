import { Config, Context, Data, Effect, Layer } from 'effect';
import {
  connect,
  type ConnectionOptions,
  type NatsConnection,
  NatsError as RawNatsError
} from '@nats-io/transport-node';
import { jetstream, jetstreamManager, RetentionPolicy } from '@nats-io/jetstream';
import { Schema } from '@effect/schema';
import { EventBaseSchema, EventConsumer } from '@hex-effect/core';
import type { UnpublishedEventRecord } from './index.js';
import { UnknownException } from 'effect/Cause';
import { get } from 'effect/Struct';

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

const ensureJetstream = (app: ApplicationNamespace) =>
  Effect.gen(function* () {
    const conn = yield* NatsClient;
    const jsm = yield* Effect.promise(() => jetstreamManager(conn));
    yield* callNats(
      jsm.streams.add({
        name: app.AppNamespace,
        subjects: [`${app.AppNamespace}.>`],
        retention: RetentionPolicy.Interest
      })
    );
  });

export class PublishEvent extends Context.Tag('@hex-effect/PublishEvent')<
  PublishEvent,
  (e: typeof UnpublishedEventRecord.Type) => Effect.Effect<void, NatsError>
>() {
  public static layer = (app: ApplicationNamespace) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const conn = yield* NatsClient;
        const js = jetstream(conn);
        yield* ensureJetstream(app);

        return (e) =>
          callNats(js.publish(app.asSubject(e), e.payload, { msgID: e.messageId, timeout: 1000 }));
      })
    );
}

const EventMetadata = EventBaseSchema.pick('_context', '_tag');

export class ApplicationNamespace extends Schema.Class<ApplicationNamespace>(
  'ApplicationNamespace'
)({
  AppNamespace: Schema.NonEmptyTrimmedString
}) {
  asSubject(e: typeof EventMetadata.Type): string {
    return `${this.AppNamespace}.${e._context}.${e._tag}`;
  }
}

export class NatsEventConsumer extends Effect.Service<NatsEventConsumer>()(
  '@hex-effect/NatsEventConsumer',
  {
    effect: Effect.gen(function* () {
      yield* Effect.log('');
      const q: typeof EventConsumer.Service = {
        register(schema, handler, config) {
          const allSchemas = Schema.Union(...schema.map(get('schema'))) as Schema.Schema<
            unknown,
            unknown
          >;
          const subjects = schema.map(get('metadata'));
          console.log(allSchemas, subjects);
          const e = Schema.decodeUnknownSync(allSchemas)('');

          return handler(e).pipe(Effect.orDie);
        }
      };
      return q;
    }),
    accessors: true
  }
) {}
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
