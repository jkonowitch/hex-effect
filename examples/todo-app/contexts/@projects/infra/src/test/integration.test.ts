import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Deferred, Effect, Option } from 'effect';
import { UseCases } from '@projects/application';
import { EventConsumer } from '@hex-effect/core';
import { Task } from '@projects/domain';
import { Badge } from '@badges/domain';
import { BadgesUseCases } from '../index.js';
import { backends, type AppRuntime } from './util.js';

describe.each(backends)('$name backend', ({ makeRuntime, cleanup }) => {
  let runtime: AppRuntime;

  beforeAll(async () => {
    runtime = makeRuntime();
    await runtime.runPromise(Effect.void);
  }, 120_000);

  afterAll(() => runtime.dispose());

  beforeEach(() => runtime.runPromise(cleanup), 30_000);

  it('creates a project and retrieves it', async () => {
    await runtime.runPromise(UseCases.createProject('Test Project'));

    const projects = await runtime.runPromise(UseCases.getAllProjects);
    expect(projects.some((p) => p.title === 'Test Project')).toBe(true);
  }, 30_000);

  it('adds tasks to a project', async () => {
    await runtime.runPromise(UseCases.createProject('My Project'));
    const projects = await runtime.runPromise(UseCases.getAllProjects);
    const project = projects.find((p) => p.title === 'My Project')!;

    await runtime.runPromise(
      UseCases.addTaskToProject({ projectId: project.id, description: 'First task' })
    );
    await runtime.runPromise(
      UseCases.addTaskToProject({ projectId: project.id, description: 'Second task' })
    );

    const result = await runtime.runPromise(UseCases.getProjectWithTasks(project.id));
    const withTasks = Option.getOrThrow(result);
    expect(withTasks.tasks).toHaveLength(2);
    expect(withTasks.tasks.map((t) => t.description)).toEqual(['First task', 'Second task']);
  }, 30_000);

  it('completes a task and publishes a TaskCompletedEvent via NATS', async () => {
    const deferred = await runtime.runPromise(
      Deferred.make<typeof Task.Model.TaskCompletedEvent.schema.Type>()
    );

    await runtime.runPromise(
      EventConsumer.pipe(
        Effect.flatMap((c) =>
          c.register([Task.Model.TaskCompletedEvent], (e) => Deferred.succeed(deferred, e), {
            $durableName: 'test-task-completed'
          })
        )
      )
    );

    await runtime.runPromise(UseCases.createProject('P'));
    const projects = await runtime.runPromise(UseCases.getAllProjects);
    const project = projects.find((p) => p.title === 'P')!;
    await runtime.runPromise(
      UseCases.addTaskToProject({ projectId: project.id, description: 'Do it' })
    );
    const result = await runtime.runPromise(UseCases.getProjectWithTasks(project.id));
    const { tasks } = Option.getOrThrow(result);

    await runtime.runPromise(UseCases.completeTask(tasks[0]!.id));

    const received = await runtime.runPromise(Deferred.await(deferred));
    expect(received.taskId).toEqual(tasks[0]!.id);

    const updated = await runtime.runPromise(UseCases.getProjectWithTasks(project.id));
    expect(Option.getOrThrow(updated).tasks[0]!.completed).toBe(true);
  }, 30_000);

  it('awards a trailblazer badge after completing the first task', async () => {
    const deferred = await runtime.runPromise(
      Deferred.make<typeof Badge.BadgeAwardedEvent.schema.Type>()
    );

    await runtime.runPromise(
      EventConsumer.pipe(
        Effect.flatMap((c) =>
          c.register([Badge.BadgeAwardedEvent], (e) => Deferred.succeed(deferred, e), {
            $durableName: 'test-badge-awarded'
          })
        )
      )
    );

    await runtime.runPromise(UseCases.createProject('Badge Project'));
    const projects = await runtime.runPromise(UseCases.getAllProjects);
    const project = projects.find((p) => p.title === 'Badge Project')!;
    await runtime.runPromise(
      UseCases.addTaskToProject({ projectId: project.id, description: 'First task' })
    );
    const result = await runtime.runPromise(UseCases.getProjectWithTasks(project.id));
    const { tasks } = Option.getOrThrow(result);

    await runtime.runPromise(UseCases.completeTask(tasks[0]!.id));

    const badgeEvent = await runtime.runPromise(Deferred.await(deferred));
    expect(badgeEvent.badgeType).toBe('trailblazer');

    const badges = await runtime.runPromise(BadgesUseCases.getAllBadges);
    expect(badges.some((b) => b.badgeType === 'trailblazer')).toBe(true);
  }, 30_000);
});
