import { Effect } from 'effect';
import { Project, ProjectCreatedEvent } from './model.js';
import { UUIDGenerator } from '@hex-effect/core';
import { Schema } from '@effect/schema';

export const createProject = (title: string) =>
  Effect.gen(function* () {
    const project = yield* Schema.decode(Project)({ title, id: yield* UUIDGenerator.generate() });
    const event = yield* ProjectCreatedEvent.make({ id: project.id });
    return [project, event] as const;
  });
