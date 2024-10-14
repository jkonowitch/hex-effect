import { EventConsumer } from '@hex-effect/core';
import { Context, Layer } from 'effect';
import { NatsEventConsumer } from './messaging.js';
import { WithTransactionLive } from './transactional-boundary.js';
import { EventPublisherDaemon } from './daemon.js';

const EventConsumerLive = Layer.map(NatsEventConsumer.Default, (ctx) => {
  const service = Context.get(ctx, NatsEventConsumer);
  return ctx.pipe(
    Context.omit(NatsEventConsumer),
    Context.add(EventConsumer, service as typeof EventConsumer.Service)
  );
});

export { NatsClient } from './messaging.js';
export { LibsqlSdk, LibsqlConfig } from './sql.js';
export const Live = EventPublisherDaemon.pipe(
  Layer.provideMerge(Layer.merge(EventConsumerLive, WithTransactionLive))
);
