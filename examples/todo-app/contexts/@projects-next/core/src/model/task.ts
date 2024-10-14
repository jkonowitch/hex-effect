import { Effect, Random } from 'effect';
import { Schema } from '@effect/schema';
import { ProjectId } from './shared.js';

export const Id = Schema.String.pipe(Schema.brand('TaskId'));

export const Task = Schema.Struct({
  projectId: ProjectId,
  id: Id,
  description: Schema.String,
  completed: Schema.Boolean.pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => false)
  )
});

export const makeWithUUID = (args: Omit<Parameters<(typeof Task)['make']>[0], 'id'>) =>
  Effect.serviceConstants(Random.Random).next.pipe(
    Effect.map((rand) => Task.make({ ...args, id: Id.make(`${rand}`) }))
  );

export const complete = (task: typeof Task.Type): typeof Task.Type => ({
  ...task,
  completed: true
});
