import type { RequestEvent } from '@sveltejs/kit';
import { Context } from 'effect';

export class SvelteKitLoadEvent extends Context.Tag('SvelteKitLoadEvent')<
	SvelteKitLoadEvent,
	RequestEvent
>() {}
