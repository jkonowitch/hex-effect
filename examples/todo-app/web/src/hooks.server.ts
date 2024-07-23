import { managedRuntime } from '@projects/infra';
import { asyncExitHook } from 'exit-hook';

asyncExitHook(
  async () => {
    await managedRuntime.dispose();
  },
  { wait: 500 }
);
