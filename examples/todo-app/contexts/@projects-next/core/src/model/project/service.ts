import { Effect, Random } from 'effect';
import { Project, ProjectCreatedEvent, ProjectId } from './model.js';

export const createProject = (
  title: string
): Effect.Effect<
  [typeof Project.Type, ReturnType<typeof ProjectCreatedEvent.make>],
  never,
  Random.Random
> =>
  Effect.serviceConstants(Random.Random).next.pipe(
    Effect.map((rand) => Project.make({ title, id: ProjectId.make(`${rand}`) })),
    Effect.map((project) => [project, ProjectCreatedEvent.make({ id: project.id })] as const)
  );
