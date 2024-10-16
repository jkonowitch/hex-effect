import { Live } from '@projects/infra';
import type { Handle } from '@sveltejs/kit';
import { ManagedRuntime } from 'effect';

let globalPlatform: globalThis.App.Platform | undefined;

process.on('sveltekit:shutdown', async () => {
  console.log('Disposing runtime...');
  globalPlatform && (await globalPlatform.runtime.dispose());
  console.log('Done.');
});

export const handle: Handle = async ({ event, resolve }) => {
  if (!event.platform?.runtime) {
    if (typeof globalPlatform === 'undefined') {
      globalPlatform = { runtime: ManagedRuntime.make(Live) };
    }
    event.platform = globalPlatform;
  }
  const response = await resolve(event);
  return response;
};
