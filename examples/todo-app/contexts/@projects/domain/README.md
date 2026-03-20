# @projects/domain

Pure domain layer for the "projects & tasks" bounded context. No IO, no framework dependencies.

## What's Here

Aggregates, value objects, domain events, and pure domain functions — all defined with Effect Schema for type-safe serialization.

### Project

```typescript
import { Project } from '@projects/domain';

// Value object
Project.Model.ProjectId; // branded string
Project.Model.Project; // Schema.Struct { id, title }
Project.Model.ProjectCreatedEvent; // EventSchemas — use .make() to create instances

// Domain function
const [project, event] = yield * Project.Service.createProject('My Project');
```

### Task

```typescript
import { Task } from '@projects/domain';

Task.Model.TaskId; // branded string
Task.Model.Task; // Schema.Struct { id, projectId, description, completed }
Task.Model.TaskAddedEvent;
Task.Model.TaskCompletedEvent;

const [task, event] = yield * Task.Service.addTaskToProject(project, 'Fix the bug');
```

## Design Notes

- Domain functions return `[aggregate, event]` tuples — callers (the application layer) decide what to persist
- Brand types (`ProjectId`, `TaskId`) prevent accidental mixing of IDs at compile time
- All schemas are composable with `@effect/sql` model helpers for database mapping
