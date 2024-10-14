import { beforeEach, describe, expect, it } from '@effect/vitest';
import {
  addPerson,
  GetByIdResolver,
  LibsqlContainer,
  Migrations,
  NatsContainer,
  PersonCreatedEvent
} from './util.js';
import { ConfigProvider, Deferred, Effect, Layer, ManagedRuntime, Option } from 'effect';
import { LibsqlSdk } from '../sql.js';
import { Live } from '../index.js';
import { EventConsumer, IsolationLevel, UUIDGenerator, withTXBoundary } from '@hex-effect/core';

const IntegrationLive = Live.pipe(
  Layer.provideMerge(UUIDGenerator.Default),
  Layer.provideMerge(LibsqlSdk.Default),
  Layer.provide(Layer.merge(LibsqlContainer.ConfigLive, NatsContainer.ClientLive)),
  Layer.provide(
    Layer.setConfigProvider(ConfigProvider.fromMap(new Map([['APPLICATION_NAMESPACE', 'kralf']])))
  )
);

const makeRuntime = () => ManagedRuntime.make(IntegrationLive);

describe('Integration Test', () => {
  let runtime: ReturnType<typeof makeRuntime>;

  beforeEach(() => {
    runtime = makeRuntime();
  });

  it.scoped('works', () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => runtime.disposeEffect);
      const deferred = yield* Deferred.make<typeof PersonCreatedEvent.schema.Type>();

      const { register } = yield* EventConsumer;
      yield* register([PersonCreatedEvent], (e) => Deferred.succeed(deferred, e), {
        $durableName: 'test-consumer'
      });
      const [event] = yield* addPerson('Jeff').pipe(withTXBoundary(IsolationLevel.Batched));

      // ensure entity was persisted
      const GetById = yield* GetByIdResolver;
      const res = yield* GetById.execute(event!.id).pipe(Effect.map(Option.getOrThrow));
      expect(res.name).toEqual('Jeff');

      // ensure event is received
      const received = yield* Deferred.await(deferred);
      expect(event).toMatchObject(received);
    }).pipe(Effect.provide(Migrations), Effect.provide(runtime))
  );
});
