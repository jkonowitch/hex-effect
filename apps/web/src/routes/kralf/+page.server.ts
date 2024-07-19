import { GetProjectWithTasks } from '@projects/application';
import type { PageServerLoad } from './$types';
import { ProjectId } from '@projects/domain';
import { error } from '@sveltejs/kit';
import { undecodedHandler } from '$lib/server';
import { managedRuntime } from '@projects/infra';

export const load = (async () => {
	const res = await undecodedHandler(
		new GetProjectWithTasks({ projectId: ProjectId.make('1oYFtjjN2eZDQ6RnbUsQ1') })
	).pipe(managedRuntime.runPromiseExit);

	if (res._tag === 'Success') {
		return { hello: 'hello world', data: res.value };
	} else {
		return error(404, res.cause._tag === 'Fail' ? res.cause.error.toString() : res.cause._tag);
	}
}) satisfies PageServerLoad;
