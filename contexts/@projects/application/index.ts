import { Schema } from "@effect/schema";
import { Project, ProjectId, ProjectRepository, TaskId } from "@projects/domain";
import { Router, Rpc } from "@effect/rpc"
import { Effect } from "effect";

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

const createProject = Rpc.effect(CreateProject, ({ title }) => Project.create(title).pipe(Effect.map(project => project.id)));

const addTask = Rpc.effect(AddTask, ({ description, projectId }) => Effect.gen(function* () {
  const project = yield* Effect.serviceFunctions(ProjectRepository).findById(projectId);
  const task = yield* project.addTask(description);
  return task.id
}));

export const router = Router.make(createProject, addTask);