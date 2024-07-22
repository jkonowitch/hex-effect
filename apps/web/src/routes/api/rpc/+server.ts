import { webHandler } from '$lib/server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) => {
  return webHandler(request);
};
