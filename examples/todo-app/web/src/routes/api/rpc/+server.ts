// import { app } from '$lib/server';
// import { Effect } from 'effect';
import type { RequestHandler } from './$types';
// import { HttpApp } from '@effect/platform';
// import { managedRuntime } from '@projects/infra';

// export const POST: RequestHandler = async ({ request }) => {
//   return HttpApp.toWebHandlerRuntime(await managedRuntime.runtime())(
//     app.pipe(Effect.tapError(Effect.logError))
//   )(request);
// };

export const GET: RequestHandler = async () => {
  return new Response('hello');
};
