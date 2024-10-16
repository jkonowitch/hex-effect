import { Live } from '@projects-next/infra';
import type { Handle } from '@sveltejs/kit';
import { ManagedRuntime } from 'effect';

export const handle: Handle = async ({ event, resolve }) => {
  if (!event.platform?.runtime) {
    const runtime: globalThis.App.Platform = { runtime: ManagedRuntime.make(Live) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event.platform as any).runtime = runtime;
  }
  const response = await resolve(event);
  return response;
};
