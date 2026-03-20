import { Schema, Effect, Match } from 'effect';
import type { PersistenceError } from '@hex-effect/core';
import { isPersistenceError } from '@hex-effect/core';
import { isTagged } from 'effect/Predicate';
import type { ParseError } from 'effect/ParseResult';

export enum ErrorKinds {
  NotFound = 'NotFound',
  Infrastructure = 'Infrastructure',
  Authorization = 'Authorization',
  BadRequest = 'BadRequest'
}

export class ApplicationError extends Schema.TaggedError<ApplicationError>()('ApplicationError', {
  kind: Schema.Enums(ErrorKinds)
}) {}

export const mapErrors = <A, E extends PersistenceError | ParseError, R>(
  effect: Effect.Effect<A, E | ApplicationError, R>
) =>
  Effect.mapError<
    A,
    E | ApplicationError,
    R,
    Exclude<E, PersistenceError | ParseError> | ApplicationError
  >(
    effect,
    Match.type<E | ApplicationError>().pipe(
      Match.when(Match.instanceOf(ApplicationError), (e) => e),
      Match.when(
        isPersistenceError,
        () => new ApplicationError({ kind: ErrorKinds.Infrastructure })
      ),
      Match.when(
        isTagged('ParseError'),
        () => new ApplicationError({ kind: ErrorKinds.BadRequest })
      ),
      Match.orElse((e) => e as Exclude<E, PersistenceError | ParseError>)
    ) as (e: E | ApplicationError) => ApplicationError | Exclude<E, PersistenceError | ParseError>
  );
