import { EventConsumer } from '@hex-effect/core';
import { Context, Layer } from 'effect';
import { NatsEventConsumer } from './messaging.js';

export const EventConsumerLive = Layer.map(NatsEventConsumer.Default, (ctx) => {
  const service = Context.get(ctx, NatsEventConsumer);
  return ctx.pipe(Context.omit(NatsEventConsumer), Context.add(EventConsumer, service));
});

export { WriteStatement } from './sql.js';
export { UseCaseCommit } from './commit.js';
export {
  SaveEvents,
  GetUnpublishedEvents,
  MarkAsPublished,
  EventStoreLive,
  UnpublishedEventRecord,
  EVENT_TABLE_DDL
} from './event-store.js';
export { NatsConfig, NatsClient, PublishEvent, NatsEventConsumer, NatsError } from './messaging.js';
export { EventPublisherDaemon } from './daemon.js';
