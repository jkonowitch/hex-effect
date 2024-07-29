export { LibsqlDialect } from './src/libsql-dialect.js';
export { withTransactionalBoundary } from './src/transaction-boundary.js';
export { makeEventHandlerService } from './src/messaging.js';
export {
  type EventStoreService,
  type INatsService as NatsService,
  NatsSubject
} from './src/service-definitions.js';

import {
  DatabaseConnection,
  DatabaseSession,
  TransactionEvents
} from './src/service-definitions.js';
import { Layer } from 'effect';
import { TransactionalBoundary } from './src/transaction-boundary.js';

const WithoutDependencies = TransactionalBoundary.live.pipe(
  Layer.provide(TransactionEvents.live),
  Layer.provideMerge(DatabaseSession.live),
  Layer.provide(DatabaseConnection.live({ url: 'http://localhost:8080' }))
);

export { TransactionalBoundary, WithoutDependencies, DatabaseSession };
