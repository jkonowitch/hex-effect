/* eslint-disable @typescript-eslint/no-explicit-any */
import { Kysely, type CompiledQuery } from 'kysely';
import { Effect, Context } from 'effect';
import { UnknownException } from 'effect/Cause';
import type { TransactionalBoundary } from '@hex-effect/core';

export type UnitOfWork<DB, E> = {
  readonly write: (op: CompiledQuery) => Effect.Effect<void>;
  readonly commit: () => Effect.Effect<void, E | UnknownException>;
  readonly session: DatabaseSession<DB, E>;
};

type DatabaseSession<DB, E> = {
  direct: Kysely<DB>;
  call: <A>(f: (db: Kysely<DB>) => Promise<A>) => Effect.Effect<A, E | UnknownException>;
};

export const assertUnitOfWork = <DB, E, Z extends Context.Tag<any, TransactionalBoundary>>(
  uowTag: Context.Tag<any, UnitOfWork<DB, E>>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _: Z
): Effect.Effect<UnitOfWork<DB, E>, never, Context.Tag.Identifier<Z>> =>
  Effect.serviceOptional(uowTag).pipe(
    Effect.catchTag('NoSuchElementException', () =>
      Effect.dieMessage('TransactionalBoundary#begin not called!')
    )
  );
