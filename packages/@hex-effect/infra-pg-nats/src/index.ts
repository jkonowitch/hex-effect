import { Layer } from 'effect';
import { EventConsumerLive, EventPublisherDaemon } from '@hex-effect/infra-nats';
import { WithTransactionLive } from './transactional-boundary.js';

export { PgConfig } from './sql.js';
export { WithTransactionLive };
export {
  NatsConfig,
  WriteStatement,
  UseCaseCommit,
  EventConsumerLive,
  EventPublisherDaemon
} from '@hex-effect/infra-nats';

export const Live = EventPublisherDaemon.pipe(
  Layer.provideMerge(Layer.merge(EventConsumerLive, WithTransactionLive))
).pipe(Layer.orDie);
