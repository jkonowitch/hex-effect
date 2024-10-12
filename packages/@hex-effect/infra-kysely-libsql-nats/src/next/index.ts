import { EventConsumer } from '@hex-effect/core';
import { Context, Layer } from 'effect';
import { NatsEventConsumer } from './messaging.js';
import { WithTransactionLive } from './transactional-boundary.js';

const EventConsumerLive = Layer.map(NatsEventConsumer.Default, (ctx) => {
  const service = Context.get(ctx, NatsEventConsumer);
  return ctx.pipe(Context.omit(NatsEventConsumer), Context.add(EventConsumer, service));
});

export { NatsClient } from './messaging.js';
export { LibsqlSdk, LibsqlConfig } from './sql.js';
export const Live = Layer.merge(EventConsumerLive, WithTransactionLive);
