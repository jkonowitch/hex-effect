import { Effect } from 'effect';
import { ServiceLive } from '@projects/infra';
import { UseCases, Error as AppError } from '@projects/application';
import type { PageServerLoad } from './$types';

export const load = (async ({ platform }) => {
  const projects = await platform!.runtime.runPromise(
    UseCases.getAllProjects.pipe(Effect.provide(ServiceLive))
  );
  return { projects };
}) satisfies PageServerLoad;

export const actions = {
  createProject: async ({ request, platform }) => {
    const data = await request.formData();
    const title = data.get('title')?.toString();
    if (!title) return { success: false, error: 'Title is required' };
    return platform!.runtime.runPromise(
      UseCases.createProject(title).pipe(
        Effect.provide(ServiceLive),
        AppError.mapErrors,
        Effect.match({
          onFailure: () => ({ success: false, error: 'Failed to create project' }),
          onSuccess: () => ({ success: true })
        })
      )
    );
  }
};
