import { Kysely, type CompiledQuery } from 'kysely';
import { Effect, Context } from 'effect';
import { UnknownException } from 'effect/Cause';

export type UnitOfWork<DB, E> = {
  readonly write: (op: CompiledQuery) => Effect.Effect<void>;
  readonly commit: () => Effect.Effect<void, E | UnknownException>;
  readonly session: DatabaseSession<DB, E>;
};

type DatabaseSession<DB, E> = {
  direct: Kysely<DB>;
  call: <A>(f: (db: Kysely<DB>) => Promise<A>) => Effect.Effect<A, E | UnknownException>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const assertUnitOfWork = <DB, E>(tag: Context.Tag<any, UnitOfWork<DB, E>>) =>
  Effect.serviceOptional(tag).pipe(
    Effect.catchTag('NoSuchElementException', () =>
      Effect.dieMessage('TransactionalBoundary#begin not called!')
    )
  );
