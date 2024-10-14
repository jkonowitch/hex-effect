import { Effect } from 'effect';
import { Project, ProjectCreatedEvent, ProjectId } from './model.js';
import { UUIDGenerator } from '@hex-effect/core';

export const createProject = (
  title: string
): Effect.Effect<
  [typeof Project.Type, ReturnType<typeof ProjectCreatedEvent.make>],
  never,
  UUIDGenerator
> =>
  UUIDGenerator.generate().pipe(
    Effect.map((uuid) => Project.make({ title, id: ProjectId.make(uuid) })),
    Effect.map((project) => [project, ProjectCreatedEvent.make({ id: project.id })] as const)
  );
