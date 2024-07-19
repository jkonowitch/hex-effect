import { client } from '$lib/server/client';
import { GetProjectWithTasks, ProjectWithTasks } from '@projects/application';
import type { PageServerLoad } from './$types';
import { ProjectId } from '@projects/domain';
import { Effect } from 'effect';
import { error } from '@sveltejs/kit';
import { Schema } from '@effect/schema';

export const load = (async () => {
	// const data = await fetch('/api/rpc', { method: 'POST' });
	const data = await client(
		new GetProjectWithTasks({ projectId: ProjectId.make('1oYFtjjN2eZDQ6RnbUsQ1') })
	).pipe(Effect.runPromiseExit);

	if (data._tag === 'Success') {
		return { hello: 'hello world', data: Schema.encodeSync(ProjectWithTasks)(data.value) };
	} else {
		return error(404, data.cause._tag === 'Fail' ? data.cause.error.message : data.cause._tag);
	}
}) satisfies PageServerLoad;
