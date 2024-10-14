import { Project } from '@projects-next/domain';
import { Effect } from 'effect';
import { SaveProject } from './services.js';
import { IsolationLevel, withTXBoundary } from '@hex-effect/core';

export const createProject = Effect.gen(function* () {
  const [project, event] = yield* Project.Service.createProject('hello');
  yield* Effect.serviceFunctions(SaveProject).save(project);
  return [event];
}).pipe(withTXBoundary(IsolationLevel.Batched));
