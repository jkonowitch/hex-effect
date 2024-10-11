import { beforeEach, describe, expect, layer } from '@effect/vitest';
import {
  Effect,
  Config,
  Context,
  Layer,
  Stream,
  Fiber,
  Chunk,
  ConfigProvider,
  Deferred,
  pipe
} from 'effect';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { NatsClient, NatsEventConsumer, PublishEvent } from './messaging.js';
import { UnpublishedEventRecord } from './index.js';
import { makeDomainEvent } from '@hex-effect/core';
import { Schema } from '@effect/schema';
import { omit } from 'effect/Struct';

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
    let event: ReturnType<(typeof SomeEvent)['make']>;

    const publish = (e: typeof event) =>
      PublishEvent.publish(
        UnpublishedEventRecord.make({
          ...e,
          payload: JSON.stringify(e)
        })
      );

    beforeEach(() => {
      event = SomeEvent.make({ name: 'Jeff' });
    });

    it.scoped('it can publish', () =>
      Effect.gen(function* () {
        const conn = yield* NatsClient;
        const sub = conn.subscribe(
          `${yield* Config.string('APPLICATION_NAMESPACE')}.${event._context}.${event._tag}`,
          {
            timeout: 2000,
            max: 1
          }
        );
        yield* publish(event);
        const stream = yield* Stream.fromAsyncIterable(sub, () => new Error('uh oh')).pipe(
          Stream.runCollect,
          Effect.fork
        );
        const msg = yield* Fiber.join(stream).pipe(Effect.flatMap(Chunk.get(0)));
        expect(msg.string()).toEqual(JSON.stringify(event));
      })
    );

    it.effect('EventConsumer', () =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<typeof SomeEvent.schema.Type>();
        yield* NatsEventConsumer.use((c) =>
          c.register([SomeEvent], (e) => Deferred.succeed(deferred, e), { $durableName: 'shmee' })
        );
        yield* publish(event);
        const received = yield* Deferred.await(deferred);
        expect(received).toEqual(pipe(event, omit('encode')));
      }).pipe(Effect.provide(NatsEventConsumer.Default))
    );

    it.effect('Retries when there is an error?', () =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<typeof SomeEvent.schema.Type>();
        let i = 0;
        yield* NatsEventConsumer.use((c) =>
          c.register(
            [SomeEvent],
            (e) => {
              i++;
              console.log('here', i, e.name);
              return i === 3 ? Deferred.succeed(deferred, e) : Effect.dieMessage('error dawg');
            },
            { $durableName: 'shmee' }
          )
        );
        yield* publish(event);
        const e2 = SomeEvent.make({ name: 'Kralf' });
        yield* publish(e2);

        const received = yield* Deferred.await(deferred);
        expect(received).toEqual(pipe(event, omit('encode')));
      }).pipe(Effect.provide(NatsEventConsumer.Default))
    );
  });
});
