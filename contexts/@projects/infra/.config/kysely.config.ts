import { defineConfig } from 'kysely-ctl';
import SQLite from 'better-sqlite3';
import { SqliteDialect } from 'kysely';

const dialect = new SqliteDialect({
  database: new SQLite(process.env.PROJECT_DB)
});

export default defineConfig({
  dialect,
  migrations: {
    migrationFolder: './persistence/migrations'
  }
});
