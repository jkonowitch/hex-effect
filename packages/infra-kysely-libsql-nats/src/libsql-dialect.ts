/* eslint-disable @typescript-eslint/no-unused-vars */

// Adapted from https://github.com/libsql/kysely-libsql
// Needed more specific control over transaction behavior

import {
  type Client,
  type Config,
  createClient,
  type InValue,
  type Transaction
} from '@libsql/client';
import {
  CompiledQuery,
  IsolationLevel,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type QueryCompiler,
  type QueryResult,
  type TransactionSettings
} from 'kysely';

export type LibsqlDialectConfig =
  | {
      client: Client;
    }
  | Config;

export class LibsqlDialect implements Dialect {
  #config: LibsqlDialectConfig;

  constructor(config: LibsqlDialectConfig) {
    this.#config = config;
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createDriver(): Driver {
    let client: Client;
    let closeClient: boolean;
    if ('client' in this.#config) {
      client = this.#config.client;
      closeClient = false;
    } else if (this.#config.url !== undefined) {
      client = createClient(this.#config);
      closeClient = true;
    } else {
      throw new Error('Please specify either `client` or `url` in the LibsqlDialect config');
    }

    return new LibsqlDriver(client, closeClient);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }
}

export class LibsqlDriver implements Driver {
  client: Client;
  #closeClient: boolean;

  constructor(client: Client, closeClient: boolean) {
    this.client = client;
    this.#closeClient = closeClient;
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<LibsqlConnection> {
    return new LibsqlConnection(this.client);
  }

  async beginTransaction(
    connection: LibsqlConnection,
    settings: TransactionSettings
  ): Promise<void> {
    await connection.beginTransaction(settings.isolationLevel);
  }

  async commitTransaction(connection: LibsqlConnection): Promise<void> {
    await connection.commitTransaction();
  }

  async rollbackTransaction(connection: LibsqlConnection): Promise<void> {
    await connection.rollbackTransaction();
  }

  async releaseConnection(_conn: LibsqlConnection): Promise<void> {}

  async destroy(): Promise<void> {
    if (this.#closeClient) {
      this.client.close();
    }
  }
}

export class LibsqlConnection implements DatabaseConnection {
  client: Client;
  #transaction?: Transaction;

  constructor(client: Client) {
    this.client = client;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const target = this.#transaction ?? this.client;
    const result = await target.execute({
      sql: compiledQuery.sql,
      args: compiledQuery.parameters as Array<InValue>
    });
    return {
      insertId: result.lastInsertRowid,
      numAffectedRows: BigInt(result.rowsAffected),
      rows: result.rows as Array<R>
    };
  }

  async beginTransaction(isolationLevel?: IsolationLevel) {
    if (this.#transaction) {
      throw new Error('Transaction already in progress');
    }
    if (isolationLevel === 'serializable') {
      this.#transaction = await this.client.transaction('write');
    } else if (isolationLevel === 'snapshot') {
      this.#transaction = await this.client.transaction('read');
    } else if (typeof isolationLevel === 'undefined') {
      this.#transaction = await this.client.transaction('deferred');
    } else {
      throw new Error(`isolation level: ${isolationLevel} not supported`);
    }
  }

  async commitTransaction() {
    if (!this.#transaction) {
      throw new Error('No transaction to commit');
    }
    await this.#transaction.commit();
    this.#transaction = undefined;
  }

  async rollbackTransaction() {
    if (!this.#transaction) {
      throw new Error('No transaction to rollback');
    }
    await this.#transaction.rollback();
    this.#transaction = undefined;
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(
    _compiledQuery: CompiledQuery,
    _chunkSize: number
  ): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('Libsql Driver does not support streaming yet');
  }
}
