import type {
  InsertResult,
  Kysely,
  CompiledQuery,
  UpdateResult,
  DeleteResult,
  QueryResult
} from 'kysely';
import { Effect, Ref } from 'effect';

type ExcludedTypes = [InsertResult, UpdateResult, DeleteResult];

export type ReadonlyQuery<C> =
  C extends CompiledQuery<infer T>
    ? T extends ExcludedTypes[number]
      ? never
      : CompiledQuery<T>
    : never;

export type DatabaseSession<DB, E> = Ref.Ref<{
  readonly write: (op: CompiledQuery) => Effect.Effect<void, E>;
  readonly read: <Q>(op: ReadonlyQuery<CompiledQuery<Q>>) => Effect.Effect<QueryResult<Q>, E>;
  readonly queryBuilder: Kysely<DB>;
}>;
