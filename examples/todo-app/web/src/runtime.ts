import { Live, PgLive } from '@projects/infra';
import { Layer, ManagedRuntime } from 'effect';

const layer = process.env.DB_PROVIDER === 'pg' ? PgLive : Live;

export const runtime = ManagedRuntime.make(layer) as ManagedRuntime.ManagedRuntime<
  Layer.Layer.Success<typeof Live>,
  never
>;

process.on('sveltekit:shutdown', async () => {
  console.log('Disposing runtime...');
  await runtime.dispose();
  console.log('Done.');
});
