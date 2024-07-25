import { Config, Context, Effect, Layer } from 'effect';
import {
  NatsSubject,
  type NatsService as INatsService
} from '@hex-effect/infra-kysely-libsql-nats';
import { connect, RetentionPolicy } from 'nats';

export class NatsService extends Context.Tag('ProjectNatsConnection')<NatsService, INatsService>() {
  public static live = Layer.scoped(
    NatsService,
    Effect.gen(function* () {
      const connection = yield* Effect.promise(() => connect());
      const jetstreamManager = yield* Effect.promise(() => connection.jetstreamManager());
      const applicationName = yield* Config.string('APPLICATION_NAME');
      const streamInfo = yield* Effect.promise(() =>
        jetstreamManager.streams.add({
          name: applicationName,
          subjects: [`${applicationName}.>`],
          retention: RetentionPolicy.Interest
        })
      );
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => connection.drain()).pipe(
          Effect.tap(Effect.logDebug('Nats connection closed'))
        )
      );
      return {
        jetstream: connection.jetstream(),
        streamInfo: streamInfo,
        jetstreamManager,
        eventToSubject: (event) => {
          return NatsSubject.make({
            ApplicationNamespace: applicationName,
            BoundedContext: event.context,
            EventTag: event.tag
          });
        }
      };
    })
  );
}
