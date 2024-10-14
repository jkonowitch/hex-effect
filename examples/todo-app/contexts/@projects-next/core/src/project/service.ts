import { Effect } from 'effect';
import { Project, ProjectCreatedEvent, ProjectId } from './model.js';
import { UUIDGenerator } from '@hex-effect/core';

export const createProject = (title: string) =>
  Effect.gen(function* () {
    const project = Project.make({ title, id: ProjectId.make(yield* UUIDGenerator.generate()) });
    const event = yield* ProjectCreatedEvent.make({ id: project.id });
    return [project, event] as const;
  });
