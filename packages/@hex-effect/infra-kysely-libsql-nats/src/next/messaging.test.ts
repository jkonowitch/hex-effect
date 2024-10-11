import { beforeEach, describe, expect, layer } from '@effect/vitest';
import {
  Effect,
  Config,
  Context,
  Layer,
  Stream,
  Fiber,
  Chunk,
  Console,
  ConfigProvider,
  Deferred
} from 'effect';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { NatsClient, NatsEventConsumer, PublishEvent } from './messaging.js';
import { UnpublishedEventRecord } from './index.js';
import { makeDomainEvent } from '@hex-effect/core';
import { Schema } from '@effect/schema';

class NatsContainer extends Context.Tag('test/NatsContainer')<
  NatsContainer,
  StartedTestContainer
>() {
  static Live = Layer.scoped(
    this,
    Effect.acquireRelease(
      Effect.promise(() =>
        new GenericContainer('nats:latest')
          .withCommand(['-js'])
          .withExposedPorts(4222)
          .withWaitStrategy(Wait.forLogMessage(/.*Server is ready.*/))
          .start()
      ),
      (container) => Effect.promise(() => container.stop())
    )
  );

  static ClientLive = Layer.unwrapEffect(
    Effect.gen(function* () {
      const container = yield* NatsContainer;
      return NatsClient.layer({
        servers: Config.succeed(`nats://localhost:${container.getMappedPort(4222)}`)
      });
    })
  ).pipe(Layer.provide(this.Live));
}

const SomeEvent = makeDomainEvent(
  { _tag: 'SomeEvent', _context: 'SomeContext' },
  { name: Schema.String }
);

const TestLive = PublishEvent.Default.pipe(
  Layer.provideMerge(NatsContainer.ClientLive),
  Layer.provide(
    Layer.setConfigProvider(ConfigProvider.fromMap(new Map([['APPLICATION_NAMESPACE', 'kralf']])))
  )
);

describe('Messaging', () => {
  layer(TestLive)((it) => {
    let e: (typeof SomeEvent)['schema']['Type'];

    const publish = (e: (typeof SomeEvent)['schema']['Type']) =>
      PublishEvent.publish(
        UnpublishedEventRecord.make({
          ...e,
          payload: JSON.stringify(e)
        })
      );

    beforeEach(() => {
      e = SomeEvent.make({ name: 'Jeff' });
    });

    it.scoped('it can publish', () =>
      Effect.gen(function* () {
        const conn = yield* NatsClient;
        const sub = conn.subscribe(
          `${yield* Config.string('APPLICATION_NAMESPACE')}.${e._context}.${e._tag}`,
          {
            timeout: 2000,
            max: 1
          }
        );
        yield* publish(e);
        const stream = yield* Stream.fromAsyncIterable(sub, () => new Error('uh oh')).pipe(
          Stream.runCollect,
          Effect.fork
        );
        const msg = yield* Fiber.join(stream).pipe(Effect.flatMap(Chunk.get(0)));
        expect(msg.string()).toEqual(JSON.stringify(e));
      })
    );

    it.scoped.only('EventConsumer', () =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<typeof e>();
        yield* NatsEventConsumer.use((c) =>
          c.register([SomeEvent], (e) => Deferred.succeed(deferred, e), { $durableName: 'shmee' })
        );
        yield* publish(e);
        const kralf = yield* Deferred.await(deferred);
        yield* Console.log(kralf);
      }).pipe(Effect.provide(NatsEventConsumer.Default))
    );
  });
});
