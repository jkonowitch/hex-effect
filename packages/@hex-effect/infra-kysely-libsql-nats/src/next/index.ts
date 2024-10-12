import { EventConsumer } from '@hex-effect/core';
import { Context, Layer } from 'effect';
import { NatsEventConsumer } from './messaging.js';

export const EventConsumerLive = Layer.map(NatsEventConsumer.Default, (ctx) => {
  const service = Context.get(ctx, NatsEventConsumer);
  return ctx.pipe(Context.omit(NatsEventConsumer), Context.add(EventConsumer, service));
});
export { NatsClient } from './messaging.js';
export { LibsqlSdk, LibsqlConfig } from './sql.js';
export { WithTransactionLive } from './transactional-boundary.js';
