import { Schema } from '@effect/schema';
import * as Task from './task.js';
import { ProjectId } from './shared.js';

export const Project = Schema.Struct({
  id: ProjectId,
  title: Schema.String
});

export const addTask = (project: typeof Project.Type, description: string) =>
  Task.makeWithUUID({ description, projectId: project.id });
