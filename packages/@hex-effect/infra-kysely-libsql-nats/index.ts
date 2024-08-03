export { LibsqlDialect } from './src/libsql-dialect.js';
export { makeEventHandlerService } from './src/messaging.js';
export {
  EventStore,
  type INatsService as NatsService,
  NatsSubject
} from './src/service-definitions.js';

import {
  DatabaseConnection,
  DatabaseSession,
  EventStore,
  NatsService,
  TransactionEvents
} from './src/service-definitions.js';
import { Context, Layer } from 'effect';
import { TransactionalBoundaryProviderLive as kralf } from './src/transaction-boundary.js';
import { EventPublishingDaemon } from './src/messaging.js';
import type { TransactionalBoundaryProvider } from '@hex-effect/core';

const WithoutDependencies = kralf.pipe(
  Layer.provideMerge(EventStore.live),
  Layer.provideMerge(TransactionEvents.live),
  Layer.provideMerge(DatabaseSession.live),
  Layer.provideMerge(DatabaseConnection.live({ url: 'http://localhost:8080' }))
);

const shmee = EventPublishingDaemon.pipe(
  Layer.provideMerge(WithoutDependencies),
  Layer.provide(NatsService.live())
);

const z = Layer.context<
  Context.Tag.Identifier<DatabaseSession | TransactionalBoundaryProvider>
>().pipe(Layer.provide(shmee));

export { z as WithoutDependencies, DatabaseSession };
