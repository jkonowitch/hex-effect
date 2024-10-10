import { describe, expect, layer } from '@effect/vitest';
import {
  Effect,
  Config,
  Context,
  Layer,
  Stream,
  Fiber,
  Chunk,
  Console,
  ConfigProvider
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
    const e = SomeEvent.make({ name: 'Jeff' });
    const event = UnpublishedEventRecord.make({
      ...e,
      payload: JSON.stringify(e)
    });

    it.scoped('it can publish', () =>
      Effect.gen(function* () {
        const conn = yield* NatsClient;
        const sub = conn.subscribe(`kralf.${event._context}.${event._tag}`, {
          timeout: 2000,
          max: 1
        });
        yield* PublishEvent.publish(event);
        const stream = yield* Stream.fromAsyncIterable(sub, () => new Error('uh oh')).pipe(
          Stream.runCollect,
          Effect.fork
        );
        const msg = yield* Fiber.join(stream).pipe(Effect.flatMap(Chunk.get(0)));
        expect(msg.string()).toEqual(event.payload);
      })
    );

    it.effect('EventConsumer', () =>
      Effect.gen(function* () {
        const handler = yield* NatsEventConsumer.use((c) =>
          c.register([SomeEvent], (e) => Console.log('recieved', e), { $durableName: 'shmee' })
        ).pipe(Effect.fork);
        yield* Fiber.await(handler);
      }).pipe(Effect.provide(NatsEventConsumer.Default))
    );
  });
});
