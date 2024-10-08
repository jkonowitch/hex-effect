import { describe, expect, layer } from '@effect/vitest';
import { Effect, Config, Context, Layer, Stream, Fiber, Chunk, identity } from 'effect';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { ApplicationNamespace, NatsClient, PublishEvent } from './messaging.js';
import { UnpublishedEventRecord } from './index.js';

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

const appNamespace = new ApplicationNamespace({ AppNamespace: 'kralf' });

describe('Messaging', () => {
  layer(PublishEvent.layer(appNamespace).pipe(Layer.provideMerge(NatsContainer.ClientLive)))(
    (it) => {
      it.scoped('it can publish', () =>
        Effect.gen(function* () {
          const conn = yield* NatsClient;
          const event = UnpublishedEventRecord.make({
            _context: '@some-context',
            _tag: 'some-event',
            payload: 'hello',
            messageId: '1234'
          });
          const sub = conn.subscribe(appNamespace.asSubject(event), {
            timeout: 2000,
            max: 1
          });
          yield* Effect.serviceFunctionEffect(PublishEvent, identity)(event);
          const stream = yield* Stream.fromAsyncIterable(sub, () => new Error('uh oh')).pipe(
            Stream.runCollect,
            Effect.fork
          );
          yield* Effect.promise(() => sub.drain());
          const msg = yield* Fiber.join(stream).pipe(Effect.flatMap(Chunk.get(0)));
          expect(msg.string()).toEqual('hello');
        })
      );
    }
  );
});
