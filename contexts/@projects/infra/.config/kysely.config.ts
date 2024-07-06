import { defineConfig } from 'kysely-ctl';
import { Database as SQLite } from 'bun:sqlite';
import { BunSqliteDialect } from 'kysely-bun-sqlite';

const dialect = new BunSqliteDialect({
  database: new SQLite(process.env.PROJECT_DB)
});

export default defineConfig({
  dialect,
  migrations: {
    migrationFolder: './persistence/migrations'
  }
});
