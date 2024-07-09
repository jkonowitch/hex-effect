/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('events')
    .addColumn('id', 'text', (c) => c.notNull().primaryKey())
    .addColumn('occurredOn', 'text', (c) => c.notNull())
    .addColumn('delivered', 'integer', (c) => c.notNull())
    .addColumn('payload', 'text', (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('events').ifExists().execute();
}
