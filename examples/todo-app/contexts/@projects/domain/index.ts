import { Schema, Serializable } from '@effect/schema';
import { DomainEventPublisher, EventBaseSchema } from '@hex-effect/core';
import { Context, Effect } from 'effect';
import type { Option } from 'effect/Option';

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
  ): Effect.Effect<Project, never, ProjectRepository | DomainEventPublisher> {
    return Effect.gen(function* () {
      const project = new Project({
        id: yield* Effect.serviceFunctions(ProjectRepository).nextId(),
        title
      });
      yield* Effect.serviceFunctions(DomainEventPublisher).publish(
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

  public static complete(self: Task): Effect.Effect<Task, never, DomainEventPublisher> {
    return Effect.gen(function* () {
      const task = new Task({ ...self, completed: true });
      yield* Effect.serviceFunctions(DomainEventPublisher).publish(
        TaskCompletedEvent.make({ taskId: task.id })
      );
      return task;
    });
  }
}

const ProjectEventBase = Schema.Struct({
  ...EventBaseSchema.fields,
  _context: Schema.Literal('@projects').pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => '@projects' as const)
  )
});

export class ProjectCreatedEvent extends Schema.TaggedClass<ProjectCreatedEvent>()(
  'ProjectCreatedEvent',
  {
    ...ProjectEventBase.fields,
    projectId: ProjectId
  }
) {
  get [Serializable.symbol]() {
    return ProjectCreatedEvent;
  }
}

export class TaskCompletedEvent extends Schema.TaggedClass<TaskCompletedEvent>()(
  'TaskCompletedEvent',
  {
    ...ProjectEventBase.fields,
    taskId: TaskId
  }
) {
  get [Serializable.symbol]() {
    return TaskCompletedEvent;
  }
}

/**
 * Services
 */

export class ProjectRepository extends Context.Tag('ProjectRepository')<
  ProjectRepository,
  {
    save(project: Project): Effect.Effect<void>;
    findById(id: typeof ProjectId.Type): Effect.Effect<Option<Project>>;
    findAll(): Effect.Effect<Project[]>;
    nextId(): Effect.Effect<typeof ProjectId.Type>;
  }
>() {}

export class TaskRepository extends Context.Tag('TaskRepository')<
  TaskRepository,
  {
    save(task: Task): Effect.Effect<void>;
    findById(id: typeof TaskId.Type): Effect.Effect<Option<Task>>;
    findAllByProjectId(id: typeof ProjectId.Type): Effect.Effect<Option<Task[]>>;
    nextId(): Effect.Effect<typeof TaskId.Type>;
  }
>() {}

export const ProjectDomainEvents = Schema.Union(ProjectCreatedEvent, TaskCompletedEvent);
