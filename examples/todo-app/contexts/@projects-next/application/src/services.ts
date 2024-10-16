import { Context, Effect, Option } from 'effect';
import { Project, Task } from '@projects-next/domain';
import type { PersistenceError } from '@hex-effect/core';

export class SaveProject extends Context.Tag('@projects/application/SaveProject')<
  SaveProject,
  { save: (p: typeof Project.Model.Project.Type) => Effect.Effect<void, PersistenceError> }
>() {}

export class FindProjectById extends Context.Tag('@projects/application/FindProjectById')<
  FindProjectById,
  {
    findById: (
      p: typeof Project.Model.ProjectId.Type
    ) => Effect.Effect<Option.Option<typeof Project.Model.Project.Type>, PersistenceError>;
  }
>() {}

export class SaveTask extends Context.Tag('@projects/application/SaveTask')<
  SaveTask,
  {
    save: (p: typeof Task.Model.Task.Type) => Effect.Effect<void, PersistenceError>;
  }
>() {}
