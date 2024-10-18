import { EventConsumer } from '@hex-effect/core';
import { Context, Layer } from 'effect';
import { NatsEventConsumer } from './messaging.js';
import { WithTransactionLive } from './transactional-boundary.js';
import { EventPublisherDaemon } from './daemon.js';
import { LibsqlSdk } from './sql.js';

const EventConsumerLive = Layer.map(NatsEventConsumer.Default, (ctx) => {
  const service = Context.get(ctx, NatsEventConsumer);
  return ctx.pipe(Context.omit(NatsEventConsumer), Context.add(EventConsumer, service));
});

export { NatsConfig } from './messaging.js';
export { LibsqlSdk, LibsqlConfig, WriteStatement } from './sql.js';
export { WithTransactionLive };
export { EventConsumerLive };
export { EventPublisherDaemon };
export const Live = EventPublisherDaemon.pipe(
  Layer.provideMerge(Layer.merge(EventConsumerLive, WithTransactionLive)),
  Layer.provideMerge(LibsqlSdk.Default)
).pipe(Layer.orDie);
