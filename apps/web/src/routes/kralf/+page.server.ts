import { AddTask, GetProjectWithTasks } from '@projects/application';
import type { PageServerLoad, Actions } from './$types';
import { ProjectId } from '@projects/domain';
import { error, fail } from '@sveltejs/kit';
import { run, undecodedHandler } from '$lib/server';
import { Cause, Exit, Either } from 'effect';
import { Schema } from '@effect/schema';

export const load = (async () => {
	const res = await undecodedHandler(
		new GetProjectWithTasks({ projectId: ProjectId.make('1oYFtjjN2eZDQ6RnbUsQ1') })
	).pipe(run);

	return Exit.match(res, {
		onSuccess: (data) => ({ data, hello: 'hello world' }),
		onFailure: (cause) => (Cause.isFailType(cause) ? error(404, cause.error.message) : error(500))
	});
}) satisfies PageServerLoad;

export const actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const command = Schema.decodeUnknownEither(AddTask)({
			description: data.get('description')?.toString(),
			projectId: '1oYFtjjN2eZDQ6RnbUsQ1',
			_tag: 'AddTask'
		});

		return Either.match(command, {
			onLeft: (e) => fail(400, { kralf: e.message }),
			onRight: async (a) => {
				await undecodedHandler(a).pipe(run);

				return { success: true };
			}
		});
	}
} satisfies Actions;
