import { Schema } from "@effect/schema";
import { Context, Effect } from "effect";

/**
 * Model
 */

const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"))

export class Project extends Schema.TaggedClass<Project>()("Project", {
  id: ProjectId,
  title: Schema.String
}) { }

const TaskId = Schema.String.pipe(Schema.brand('TaskId'))

export class Task extends Schema.TaggedClass<Task>()("Task", {
  projectId: ProjectId,
  id: TaskId,
  description: Schema.String,
  completed: Schema.Boolean,
}) { }

export const ProjectCreatedEvent = Schema.TaggedStruct("ProjectCreatedEvent", {
  projectId: ProjectId
})

export const TaskCompletedEvent = Schema.TaggedStruct("TaskCompletedEvent", {
  taskId: TaskId,
})

export function completeTask(task: Task): Task {
  return new Task({ ...task, completed: true })
}

/**
 * Services
 */

export class ProjectRepository extends Context.Tag("ProjectRepository")<ProjectRepository, {
  save(project: Project): Effect.Effect<void>;
  findById(id: typeof ProjectId.Type): Effect.Effect<Project>;
  nextId(): Effect.Effect<typeof ProjectId.Type>;
}>() { }

export class TaskRepository extends Context.Tag("TaskRepository")<TaskRepository, {
  save(task: Task): Effect.Effect<void>;
  findById(id: typeof TaskId.Type): Effect.Effect<Task>;
  nextId(): Effect.Effect<typeof TaskId.Type>;
}>() { }
