import { Schema } from '@effect/schema';
import { ParseError } from '@effect/schema/ParseResult';
import type { PersistenceError } from '@hex-effect/core';
import { isPersistenceError } from '@hex-effect/core';
import { Effect } from 'effect';
import { isTagged } from 'effect/Predicate';

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
  >(effect, (e) => {
    if (e instanceof ApplicationError) {
      return e;
    } else if (isPersistenceError(e)) {
      return new ApplicationError({ kind: ErrorKinds.Infrastructure });
    } else if (isTagged('ParseError')(e)) {
      return new ApplicationError({ kind: ErrorKinds.BadRequest });
    } else {
      return e as Exclude<E, PersistenceError | ParseError>;
    }
  });
