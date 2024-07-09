import { Kysely, type CompiledQuery } from 'kysely';
import { Effect, Option, Ref } from 'effect';
import { UnknownException } from 'effect/Cause';

export type UnitOfWork<DB, E> = Ref.Ref<
  Option.Option<{
    readonly write: (op: CompiledQuery) => Effect.Effect<void>;
    readonly commit: () => Effect.Effect<void, E | UnknownException>;
    readonly session: DatabaseSession<DB, E>;
  }>
>;

export const getUnitOfWork = <DB, E>(uow: UnitOfWork<DB, E>) =>
  Ref.get(uow).pipe(Effect.map(Option.getOrThrow));

type DatabaseSession<DB, E> = {
  direct: Kysely<DB>;
  call: <A>(f: (db: Kysely<DB>) => Promise<A>) => Effect.Effect<A, E | UnknownException>;
};
