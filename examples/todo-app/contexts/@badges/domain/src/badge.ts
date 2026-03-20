import { makeDomainEvent, UUIDGenerator } from '@hex-effect/core';
import { Effect, Match, Schema } from 'effect';

export const BadgeType = Schema.Literal('trailblazer', 'momentum', 'achiever');
export type BadgeType = typeof BadgeType.Type;

export const BadgeId = Schema.String.pipe(Schema.brand('BadgeId'));

export const Badge = Schema.Struct({
  id: BadgeId,
  badgeType: BadgeType,
  awardedAt: Schema.DateFromSelf
});

export const BadgeAwardedEvent = makeDomainEvent(
  { _context: '@badges', _tag: 'BadgeAwardedEvent' },
  { badgeType: BadgeType }
);

export const badgesForCount = (count: number): BadgeType[] =>
  Match.value(count).pipe(
    Match.when(1, (): BadgeType[] => ['trailblazer']),
    Match.when(5, (): BadgeType[] => ['momentum']),
    Match.when(10, (): BadgeType[] => ['achiever']),
    Match.orElse((): BadgeType[] => [])
  );

export const awardBadge = (type: BadgeType) =>
  Effect.gen(function* () {
    const id = yield* UUIDGenerator.generate();
    const badge = Badge.make({ id: BadgeId.make(id), badgeType: type, awardedAt: new Date() });
    const event = yield* BadgeAwardedEvent.make({ badgeType: type });
    return [badge, event] as const;
  });
