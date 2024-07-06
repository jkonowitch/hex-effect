import { Schema } from '@effect/schema';
import { Context, Effect } from 'effect';

/**
 * Model
 */

export const ProjectId = Schema.String.pipe(Schema.brand('ProjectId'));

export class Project extends Schema.TaggedClass<Project>()('Project', {
  id: ProjectId,
  title: Schema.String
}) {
  public static create(
    title: string
  ): Effect.Effect<Project, never, ProjectRepository | ProjectDomainPublisher> {
    return Effect.gen(function* () {
      const project = new Project({
        id: yield* Effect.serviceFunctions(ProjectRepository).nextId(),
        title
      });
      yield* Effect.serviceFunctions(ProjectDomainPublisher).publish(
        ProjectCreatedEvent.make({ projectId: project.id })
      );
      return project;
    });
  }

  public addTask(description: string) {
    return Task.create(description, this.id);
  }
}

export const TaskId = Schema.String.pipe(Schema.brand('TaskId'));

export class Task extends Schema.TaggedClass<Task>()('Task', {
  projectId: ProjectId,
  id: TaskId,
  description: Schema.String,
  completed: Schema.Boolean
}) {
  public static create(
    description: string,
    projectId: typeof ProjectId.Type
  ): Effect.Effect<Task, never, TaskRepository> {
    return Effect.gen(function* () {
      return new Task({
        id: yield* Effect.serviceFunctions(TaskRepository).nextId(),
        completed: false,
        description,
        projectId
      });
    });
  }

  public static complete(self: Task): Effect.Effect<Task, never, ProjectDomainPublisher> {
    return Effect.gen(function* () {
      const task = new Task({ ...self, completed: true });
      yield* Effect.serviceFunctions(ProjectDomainPublisher).publish(
        TaskCompletedEvent.make({ taskId: task.id })
      );
      return task;
    });
  }
}

export const ProjectCreatedEvent = Schema.TaggedStruct('ProjectCreatedEvent', {
  projectId: ProjectId
});

export const TaskCompletedEvent = Schema.TaggedStruct('TaskCompletedEvent', {
  taskId: TaskId
});

/**
 * Services
 */

export class ProjectRepository extends Context.Tag('ProjectRepository')<
  ProjectRepository,
  {
    save(project: Project): Effect.Effect<void>;
    findById(id: typeof ProjectId.Type): Effect.Effect<Project>;
    nextId(): Effect.Effect<typeof ProjectId.Type>;
  }
>() {}

export class TaskRepository extends Context.Tag('TaskRepository')<
  TaskRepository,
  {
    save(task: Task): Effect.Effect<void>;
    findById(id: typeof TaskId.Type): Effect.Effect<Task>;
    nextId(): Effect.Effect<typeof TaskId.Type>;
  }
>() {}

const allEvents = Schema.Union(ProjectCreatedEvent, TaskCompletedEvent);

export class ProjectDomainPublisher extends Context.Tag('ProjectDomainPublisher')<
  ProjectDomainPublisher,
  {
    publish(event: typeof allEvents.Type): Effect.Effect<void>;
  }
>() {}
