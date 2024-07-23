import { HttpRouter } from '@effect/platform';
import { HttpRouter as RpcRouter } from '@effect/rpc-http';
import { Router } from '@effect/rpc';
import { router } from '@projects/application';

export const undecodedHandler = Router.toHandlerUndecoded(router);

export const app = HttpRouter.empty.pipe(HttpRouter.post('/api/rpc', RpcRouter.toHttpApp(router)));
