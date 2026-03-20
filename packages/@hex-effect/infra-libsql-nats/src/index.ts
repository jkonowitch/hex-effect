import { Layer } from 'effect';
import { EventConsumerLive, EventPublisherDaemon } from '@hex-effect/infra-nats';
import { WithTransactionLive } from './transactional-boundary.js';
import { LibsqlSdk } from './sql.js';

export { NatsConfig, WriteStatement, UseCaseCommit } from '@hex-effect/infra-nats';
export { LibsqlSdk, LibsqlConfig } from './sql.js';
export { WithTransactionLive };
export { EventConsumerLive, EventPublisherDaemon } from '@hex-effect/infra-nats';

export const Live = EventPublisherDaemon.pipe(
  Layer.provideMerge(Layer.merge(EventConsumerLive, WithTransactionLive)),
  Layer.provideMerge(LibsqlSdk.Default)
).pipe(Layer.orDie);
