import { HttpApp, HttpRouter } from '@effect/platform';
import { HttpRouter as RpcRouter } from '@effect/rpc-http';
import { router } from '@projects/application';
import { managedRuntime, DomainServiceLive } from '@projects/infra';
import { Effect } from 'effect';
import { asyncExitHook } from 'exit-hook';

export const toHandler = async () => {
	console.log('to handler called');
	const runtime = await managedRuntime.runtime();
	const app = HttpRouter.empty.pipe(HttpRouter.post('/api/rpc', RpcRouter.toHttpApp(router)));
	asyncExitHook(
		async () => {
			await managedRuntime.dispose();
		},
		{ wait: 500 }
	);
	return HttpApp.toWebHandlerRuntime(runtime)(
		app.pipe(Effect.provide(DomainServiceLive), Effect.tapError(Effect.logError))
	);
};
