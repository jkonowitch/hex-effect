import { run, undecodedHandler } from '$lib/server';
import { GetAllProjects } from '@projects/application';
import type { PageServerLoad } from './$types';
import { Cause, Exit } from 'effect';
import { error } from '@sveltejs/kit';

export const load = (async () => {
  const res = await undecodedHandler(new GetAllProjects()).pipe(run);

  return Exit.match(res, {
    onSuccess: (data) => ({ data }),
    onFailure: (cause) => (Cause.isFailType(cause) ? error(404, cause.error.message) : error(500))
  });
}) satisfies PageServerLoad;
