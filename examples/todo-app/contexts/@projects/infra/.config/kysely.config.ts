import { defineConfig } from 'kysely-ctl';
import { LibsqlDialect } from '@hex-effect/infra-kysely-libsql-nats';

const dialect = new LibsqlDialect({
  url: process.env.PROJECT_DB!
});

export default defineConfig({
  dialect,
  migrations: {
    migrationFolder: './persistence/migrations'
  }
});
