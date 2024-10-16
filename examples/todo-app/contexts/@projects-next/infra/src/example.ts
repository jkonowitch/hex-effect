import { Effect } from 'effect';
import { UseCases } from '@projects-next/application';
import { Live } from './index.js';
import { SaveProjectLive } from './service.js';

const program = UseCases.createProject('My project').pipe(
  Effect.provide(SaveProjectLive),
  Effect.provide(Live)
);

const result = await Effect.runPromise(program);

console.log(result[0]);
