import { EventConsumer, type EventSchemas } from '@hex-effect/core';
import { Effect, Layer } from 'effect';
import type { Struct } from 'effect/Schema';
import { Task } from '@projects/domain';

export const EventHandlersLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const consumer = yield* EventConsumer;

    yield* consumer.register(
      [Task.Model.TaskCompletedEvent] as unknown as EventSchemas<Struct.Fields>[],
      (event) => Effect.log(`[Projects] Task completed: ${event.taskId}`),
      { $durableName: 'projects-task-completed' }
    );
  })
);
