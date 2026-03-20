import { runtime } from './runtime.js';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  if (!event.platform?.runtime) {
    event.platform = { runtime };
  }
  return resolve(event);
};
