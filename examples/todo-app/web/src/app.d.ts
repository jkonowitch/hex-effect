import type { Layer, ManagedRuntime } from 'effect';
import type { Live } from '@projects/infra';

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    interface Platform {
      runtime: ManagedRuntime.ManagedRuntime<Layer.Layer.Success<typeof Live>, never>;
    }
  }
}

export {};
