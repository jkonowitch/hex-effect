import { Live } from '@projects-next/infra';
import type { Handle } from '@sveltejs/kit';
import { ManagedRuntime } from 'effect';

export const handle: Handle = async ({ event, resolve }) => {
  if (!event.platform) {
    const runtime: globalThis.App.Platform = { runtime: ManagedRuntime.make(Live) };
    event.platform = runtime;
    process.on('sveltekit:shutdown', async () => {
      await runtime.runtime.dispose();
    });
  }
  const response = await resolve(event);
  return response;
};
