import { Schema } from "@effect/schema";

const ProjectId = Schema.Number.pipe(Schema.int(), Schema.brand("UserId"))

export class Project extends Schema.TaggedClass<Project>()("Project", {
  id: ProjectId,
  title: Schema.String
}) { }

const TaskId = Schema.Number.pipe(Schema.int(), Schema.brand('TaskId'))

export class Task extends Schema.TaggedClass<Task>()("Task", {
  projectId: ProjectId,
  id: TaskId,
  description: Schema.String,
  completed: Schema.Boolean,
}) { }