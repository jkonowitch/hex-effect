import { GetProjectWithTasks } from '@projects/application';
import type { PageServerLoad } from './$types';
import { ProjectId } from '@projects/domain';
import { error } from '@sveltejs/kit';
import { run, undecodedHandler } from '$lib/server';
import { Cause, Exit } from 'effect';

export const load = (async () => {
	const res = await undecodedHandler(
		new GetProjectWithTasks({ projectId: ProjectId.make('1oYFtjjN2eZDQ6RnbUsQ1') })
	).pipe(run);

	return Exit.match(res, {
		onSuccess: (data) => ({ data, hello: 'hello world' }),
		onFailure: (cause) => (Cause.isFailType(cause) ? error(404, cause.error.message) : error(500))
	});
}) satisfies PageServerLoad;
