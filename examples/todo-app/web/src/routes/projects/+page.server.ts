import { Effect } from 'effect';
import { ServiceLive } from '@projects-next/infra';
import { UseCases } from '@projects-next/application';
import type { PageServerLoad } from './$types';

export const load = (async ({ platform }) => {
  const projects = await platform!.runtime.runPromise(
    UseCases.getAllProjects.pipe(Effect.provide(ServiceLive))
  );

  return { projects: projects };
}) satisfies PageServerLoad;

// export const actions = {
//   createProject: async ({ request }) => {
//     const data = await request.formData();
//     const command = Schema.decodeUnknownEither(CreateProject)(
//       {
//         title: data.get('title')?.toString(),
//         _tag: 'CreateProject'
//       },
//       { onExcessProperty: 'error', errors: 'all' }
//     );

//     return Either.match(command, {
//       onLeft: (e) => fail(400, { errors: ArrayFormatter.formatErrorSync(e) }),
//       onRight: async (a) => {
//         await undecodedHandler(a).pipe(managedRuntime.runPromise);

//         return { success: true };
//       }
//     });
//   }
// } satisfies Actions;
