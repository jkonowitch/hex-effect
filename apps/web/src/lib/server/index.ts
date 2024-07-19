import { HttpApp, HttpRouter } from '@effect/platform';
import { HttpRouter as RpcRouter } from '@effect/rpc-http';
import { router } from '@projects/application';
import { managedRuntime, DomainServiceLive } from '@projects/infra';
import { Effect } from 'effect';

export const toHandler = async () => {
	const runtime = await managedRuntime.runtime();
	const app = HttpRouter.empty.pipe(HttpRouter.post('/rpc', RpcRouter.toHttpApp(router)));
	return HttpApp.toWebHandlerRuntime(runtime)(app.pipe(Effect.provide(DomainServiceLive)));
};
