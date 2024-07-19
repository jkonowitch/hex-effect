import type { PageServerLoad } from './$types';

export const load = (async () => {
	return { hello: 'hello world' };
}) satisfies PageServerLoad;
