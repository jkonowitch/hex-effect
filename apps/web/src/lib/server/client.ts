import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Resolver } from '@effect/rpc';
import { HttpResolver } from '@effect/rpc-http';
import type { AppRouter } from '@projects/application';

export const client = HttpResolver.make<AppRouter>(
	HttpClient.fetchOk.pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl('/api/rpc')))
).pipe(Resolver.toClient);
