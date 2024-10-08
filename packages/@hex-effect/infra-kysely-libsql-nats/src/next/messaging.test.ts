import { describe, expect, layer } from '@effect/vitest';
import { Effect, Config, Context, Layer, Stream, Fiber } from 'effect';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { NatsClient } from './messaging.js';

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

describe('Messaging', () => {
  layer(NatsContainer.ClientLive)((it) => {
    it.scoped('it can publish', () =>
      Effect.gen(function* () {
        const conn = yield* NatsClient;
        const sub = conn.subscribe('KRALF', { timeout: 2000, max: 1 });
        yield* Effect.sync(() => conn.publish('KRALF'));
        const stream = yield* Stream.fromAsyncIterable(sub, () => new Error('uh oh')).pipe(
          Stream.runCount,
          Effect.fork
        );

        yield* Effect.promise(() => sub.drain());
        const n = yield* Fiber.join(stream);
        expect(n).toEqual(1);
      })
    );
  });
});
