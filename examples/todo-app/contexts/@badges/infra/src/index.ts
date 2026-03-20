import { EventConsumer, type EventSchemas } from '@hex-effect/core';
import { Effect, Layer } from 'effect';
import type { Struct } from 'effect/Schema';
import { Task } from '@projects/domain';
import { Services, UseCases } from '@badges/application';
import { SqlClient } from '@effect/sql';
import { GetAllBadgesLive, GetCompletedTaskCountLive, SaveBadgeLive } from './service.js';

const EventHandlersLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const consumer = yield* EventConsumer;

    yield* consumer.register(
      [Task.Model.TaskCompletedEvent] as unknown as EventSchemas<Struct.Fields>[],
      () =>
        UseCases.checkAndAwardBadges.pipe(
          Effect.tap((awarded) =>
            awarded.length > 0
              ? Effect.log(`[Badges] Awarded: ${awarded.map((e) => e.badgeType).join(', ')}`)
              : Effect.log('[Badges] No milestone reached')
          ),
          Effect.tapError((e) => Effect.logError('[Badges] Failed to award badge', e)),
          Effect.asVoid
        ),
      { $durableName: 'badges-task-completed' }
    );
  })
);

export const BadgesInfraLive = EventHandlersLive.pipe(
  Layer.provide(Layer.merge(GetCompletedTaskCountLive, SaveBadgeLive))
);

export const BadgesServiceLive: Layer.Layer<Services.GetAllBadges, never, SqlClient.SqlClient> =
  GetAllBadgesLive;

export { UseCases as BadgesUseCases } from '@badges/application';
