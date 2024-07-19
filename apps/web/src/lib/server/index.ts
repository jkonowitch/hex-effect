import { HttpServer } from '@effect/platform';
import { Router } from '@effect/rpc';
import { HttpRouter } from '@effect/rpc-http';
import { router } from '@projects/application';

Router.toHandler;

const kralf = HttpRouter.toHttpApp(router);
