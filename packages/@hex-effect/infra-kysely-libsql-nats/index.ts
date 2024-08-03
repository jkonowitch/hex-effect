import type { TransactionalBoundaryProvider } from '@hex-effect/core';
export { LibsqlDialect } from './src/libsql-dialect.js';
export { makeEventHandlerService } from './src/messaging.js';
export { EventStore, NatsSubject } from './src/service-definitions.js';

import {
  DatabaseConnection,
  DatabaseSession,
  EventStore,
  NatsService,
  TransactionEvents
} from './src/service-definitions.js';
import { Context, Layer } from 'effect';
import { TransactionalBoundaryProviderLive } from './src/transaction-boundary.js';
import { EventPublishingDaemon } from './src/messaging.js';

const WithoutDependencies = TransactionalBoundaryProviderLive.pipe(
  Layer.provideMerge(EventStore.live),
  Layer.provideMerge(TransactionEvents.live),
  Layer.provideMerge(DatabaseSession.live),
  Layer.provideMerge(DatabaseConnection.live({ url: 'http://localhost:8080' }))
);

const WithEventPublishingDaemon = EventPublishingDaemon.pipe(
  Layer.provideMerge(WithoutDependencies),
  Layer.provide(NatsService.live())
);

const InfrastructureLayer = Layer.context<
  Context.Tag.Identifier<DatabaseSession | TransactionalBoundaryProvider>
>().pipe(Layer.provide(WithEventPublishingDaemon));

export { InfrastructureLayer, DatabaseSession };
