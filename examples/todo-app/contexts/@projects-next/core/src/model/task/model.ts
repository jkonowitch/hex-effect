import { Schema } from '@effect/schema';
import { ProjectId } from '../project/model.js';
import { makeDomainEvent } from '@hex-effect/core';
import { ContextName } from '../shared.js';

export const TaskId = Schema.String.pipe(Schema.brand('TaskId'));

export const Task = Schema.Struct({
  projectId: ProjectId,
  id: TaskId,
  description: Schema.NonEmptyString,
  completed: Schema.Boolean.pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => false)
  )
});

export const TaskAddedEvent = makeDomainEvent(
  { _context: ContextName, _tag: 'TaskAddedEvent' },
  { projectId: ProjectId, taskId: TaskId }
);

export const TaskCompletedEvent = makeDomainEvent(
  { _context: ContextName, _tag: 'TaskCompletedEvent' },
  { taskId: TaskId }
);
