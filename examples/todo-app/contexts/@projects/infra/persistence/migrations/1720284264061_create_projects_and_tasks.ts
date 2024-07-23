/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  db.schema
    .createTable('projects')
    .addColumn('id', 'text', (c) => c.notNull().primaryKey())
    .addColumn('title', 'text', (c) => c.notNull())
    .execute();

  db.schema
    .createTable('tasks')
    .addColumn('id', 'text', (c) => c.notNull().primaryKey())
    .addColumn('projectId', 'text', (c) => c.notNull().references('projects.id'))
    .addColumn('completed', 'integer', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  db.schema.dropTable('tasks').ifExists().execute();
  db.schema.dropTable('projects').ifExists().execute();
  // down migration code goes here...
  // note: down migrations are optional. you can safely delete this function.
  // For more info, see: https://kysely.dev/docs/migrations
}
