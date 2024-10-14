import { Context, Effect } from 'effect';
import { Project } from '@projects-next/domain';

export class SaveProject extends Context.Tag('@projects/application/SaveProject')<
  SaveProject,
  { save: (p: typeof Project.Model.Project.Type) => Effect.Effect<void> }
>() {}
