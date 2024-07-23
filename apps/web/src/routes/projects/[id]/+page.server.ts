import { AddTask, CompleteTask, GetProjectWithTasks } from '@projects/application';
import type { PageServerLoad, Actions } from './$types';
import { ProjectId } from '@projects/domain';
import { error, fail } from '@sveltejs/kit';
import { undecodedHandler } from '$lib/server';
import { Cause, Exit, Either } from 'effect';
import { Schema, ArrayFormatter } from '@effect/schema';
import { managedRuntime } from '@projects/infra';

export const load = (async ({ params }) => {
  const res = await undecodedHandler(
    new GetProjectWithTasks({ projectId: ProjectId.make(params.id) })
  ).pipe(managedRuntime.runPromiseExit);

  return Exit.match(res, {
    onSuccess: (data) => ({ data }),
    onFailure: (cause) => (Cause.isFailType(cause) ? error(404, cause.error.message) : error(500))
  });
}) satisfies PageServerLoad;

export const actions = {
  addTask: async ({ request, params }) => {
    const data = await request.formData();
    const command = Schema.decodeUnknownEither(AddTask)(
      {
        description: data.get('description')?.toString(),
        projectId: params.id,
        _tag: 'AddTask'
      },
      { onExcessProperty: 'error', errors: 'all' }
    );

    return Either.match(command, {
      onLeft: (e) => fail(400, { errors: ArrayFormatter.formatErrorSync(e) }),
      onRight: async (a) => {
        await undecodedHandler(a).pipe(managedRuntime.runPromise);

        return { success: true };
      }
    });
  },
  completeTask: async ({ request }) => {
    const data = await request.formData();
    const command = Schema.decodeUnknownEither(CompleteTask)(
      {
        taskId: data.get('taskId')?.toString(),
        _tag: 'CompleteTask'
      },
      { onExcessProperty: 'error', errors: 'all' }
    );

    return Either.match(command, {
      onLeft: (e) => fail(400, { errors: ArrayFormatter.formatErrorSync(e) }),
      onRight: async (a) => {
        await undecodedHandler(a).pipe(managedRuntime.runPromise);

        return { success: true };
      }
    });
  }
} satisfies Actions;
