import { Schema } from '@effect/schema';
import { makeDomainEvent } from '@hex-effect/core';
import { ContextName } from '../shared.js';

export const ProjectId = Schema.String.pipe(Schema.brand('ProjectId'));

export const Project = Schema.Struct({
  id: ProjectId,
  title: Schema.NonEmptyString
});

export const ProjectCreatedEvent = makeDomainEvent(
  { _context: ContextName, _tag: 'ProjectCreatedEvent' },
  { id: ProjectId }
);
