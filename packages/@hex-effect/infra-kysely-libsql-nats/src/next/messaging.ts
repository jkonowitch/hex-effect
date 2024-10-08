import { Config, Context, Data, Effect, Layer } from 'effect';
import {
  connect,
  type ConnectionOptions,
  type NatsConnection,
  NatsError as RawNatsError
} from '@nats-io/transport-node';
import { jetstream } from '@nats-io/jetstream';
import { Schema } from '@effect/schema';
import { EventBaseSchema } from '@hex-effect/core';
import type { UnpublishedEventRecord } from './index.js';
import { UnknownException } from 'effect/Cause';
import { constVoid } from 'effect/Function';

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

export class ForwardEvent extends Context.Tag('@hex-effect/ForwardEvent')<
  ForwardEvent,
  (e: typeof UnpublishedEventRecord.Type) => Effect.Effect<void, NatsError>
>() {
  public static layer = (app: ApplicationNamespace) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const conn = yield* NatsClient;
        const js = jetstream(conn);
        return (e) =>
          callNats(js.publish(app.asSubject(e), e.payload, { msgID: e.messageId })).pipe(
            Effect.map(constVoid)
          );
      })
    );
}
// const stream = yield* Effect.promise(() =>
//   jsm.streams.add({
//     name: app.AppNamespace,
//     subjects: [`${app.AppNamespace}.>`],
//     retention: RetentionPolicy.Interest
//   })
// );

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
