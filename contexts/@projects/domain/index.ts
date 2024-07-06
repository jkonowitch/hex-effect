import { Schema } from "@effect/schema";

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