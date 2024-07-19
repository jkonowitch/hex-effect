import { HttpApp, HttpRouter } from '@effect/platform';
import { HttpRouter as RpcRouter } from '@effect/rpc-http';
import { Router } from '@effect/rpc';
import { router } from '@projects/application';
import { managedRuntime } from '@projects/infra';
import { Effect, ManagedRuntime } from 'effect';
import { asyncExitHook } from 'exit-hook';

export const undecodedHandler = Router.toHandlerUndecoded(router);

export const run = <A, E, R extends ManagedRuntime.ManagedRuntime.Context<typeof managedRuntime>>(
	eff: Effect.Effect<A, E, R>
) => managedRuntime.runPromiseExit(eff);

const runtime = await managedRuntime.runtime();

asyncExitHook(
	async () => {
		await managedRuntime.dispose();
	},
	{ wait: 500 }
);

const app = HttpRouter.empty.pipe(HttpRouter.post('/api/rpc', RpcRouter.toHttpApp(router)));

export const webHandler = HttpApp.toWebHandlerRuntime(runtime)(
	app.pipe(Effect.tapError(Effect.logError))
);
