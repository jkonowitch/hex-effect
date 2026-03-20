import { Context, Effect } from 'effect';
import type { PersistenceError } from '@hex-effect/core';
import type { Badge } from '@badges/domain';

export class GetCompletedTaskCount extends Context.Tag('@badges/GetCompletedTaskCount')<
  GetCompletedTaskCount,
  { getCount: () => Effect.Effect<number, PersistenceError> }
>() {}

export class SaveBadge extends Context.Tag('@badges/SaveBadge')<
  SaveBadge,
  { save: (b: typeof Badge.Badge.Type) => Effect.Effect<void, PersistenceError> }
>() {}

export class GetAllBadges extends Context.Tag('@badges/GetAllBadges')<
  GetAllBadges,
  { getAll: () => Effect.Effect<ReadonlyArray<typeof Badge.Badge.Type>, PersistenceError> }
>() {}
