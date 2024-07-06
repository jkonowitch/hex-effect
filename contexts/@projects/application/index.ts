import { Schema } from "@effect/schema";
import { Project, ProjectId, ProjectRepository, TaskId } from "@projects/domain";
import { Effect, type Request } from "effect";

/**
 * Requests
 */

export class CreateProject extends Schema.TaggedRequest<CreateProject>()("CreateProject", Schema.Never, ProjectId, {
  title: Schema.String
}) { }

export class AddTask extends Schema.TaggedRequest<AddTask>()("AddTask", Schema.Never, TaskId, {
  description: Schema.String,
  projectId: ProjectId
}) { }

/**
 * Application Services
 */

type RequestHandler<A extends Request.Request<unknown, unknown>> = Effect.Effect<Request.Request.Success<A>, Request.Request.Error<A>, unknown>

export const createProject = ({ title }: CreateProject) => Project.create(title).pipe(Effect.map(project => project.id)) satisfies RequestHandler<CreateProject>;

export const addTask = ({ description, projectId }: AddTask) => Effect.gen(function* () {
  const project = yield* Effect.serviceFunctions(ProjectRepository).findById(projectId);
  const task = yield* project.addTask(description);
  return task.id
}) satisfies RequestHandler<AddTask>;
