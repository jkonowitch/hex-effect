import { toHandler } from '$lib/server';
import type { RequestHandler } from './$types';

const handler = await toHandler();

export const POST: RequestHandler = ({ request }) => {
	return handler(request);
};
