import { run, undecodedHandler } from '$lib/server';
import { CreateProject, GetAllProjects } from '@projects/application';
import type { PageServerLoad, Actions } from './$types';
import { Cause, Either, Exit } from 'effect';
import { error, fail } from '@sveltejs/kit';
import { ArrayFormatter, Schema } from '@effect/schema';

export const load = (async () => {
  const res = await undecodedHandler(new GetAllProjects()).pipe(run);

  return Exit.match(res, {
    onSuccess: (data) => ({ data }),
    onFailure: (cause) => (Cause.isFailType(cause) ? error(404, cause.error.message) : error(500))
  });
}) satisfies PageServerLoad;

export const actions = {
  createProject: async ({ request }) => {
    const data = await request.formData();
    const command = Schema.decodeUnknownEither(CreateProject)(
      {
        title: data.get('title')?.toString(),
        _tag: 'CreateProject'
      },
      { onExcessProperty: 'error', errors: 'all' }
    );

    return Either.match(command, {
      onLeft: (e) => fail(400, { errors: ArrayFormatter.formatErrorSync(e) }),
      onRight: async (a) => {
        await undecodedHandler(a).pipe(run);

        return { success: true };
      }
    });
  }
} satisfies Actions;
