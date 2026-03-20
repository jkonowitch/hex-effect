import { Effect } from 'effect';
import { IsolationLevel, withTXBoundary } from '@hex-effect/core';
import { Badge } from '@badges/domain';
import { GetAllBadges, GetCompletedTaskCount, SaveBadge } from './services.js';

export const getAllBadges = Effect.serviceFunctions(GetAllBadges).getAll();

export const checkAndAwardBadges = Effect.gen(function* () {
  const count = yield* Effect.serviceFunctions(GetCompletedTaskCount).getCount();
  const badgeTypes = Badge.badgesForCount(count);
  return yield* Effect.forEach(badgeTypes, (type) =>
    Badge.awardBadge(type).pipe(
      Effect.tap(([badge]) => Effect.serviceFunctions(SaveBadge).save(badge)),
      Effect.map(([, event]) => event)
    )
  );
}).pipe(withTXBoundary(IsolationLevel.Batched));
