import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { Effect, Option } from 'effect';
import { ServiceLive } from '@projects/infra';
import { UseCases } from '@projects/application';

export function GET({ params, platform }: RequestEvent<{ id: string }>) {
  return platform!.runtime.runPromise(
    UseCases.getProjectWithTasks(params.id).pipe(
      Effect.provide(ServiceLive),
      Effect.map(
        Option.match({
          onNone: () => json({ error: 'Project not found' }, { status: 404 }),
          onSome: ({ tasks, ...project }) => json({ project, tasks })
        })
      )
    )
  );
}

export async function POST({ params, request, platform }: RequestEvent<{ id: string }>) {
  const { description } = await request.json();
  return platform!.runtime.runPromise(
    UseCases.addTaskToProject({ projectId: params.id, description }).pipe(
      Effect.provide(ServiceLive),
      Effect.match({
        onFailure: () => json({ error: 'Failed to add task' }, { status: 400 }),
        onSuccess: () => json({ success: true })
      })
    )
  );
}
