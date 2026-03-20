# @projects/application

Application layer for the "projects & tasks" bounded context. Orchestrates domain logic into named use cases and declares abstract service ports.

## Use Cases

| Export                                         | Description                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `createProject(title)`                         | Creates a project and fires `ProjectCreatedEvent`                              |
| `addTaskToProject({ projectId, description })` | Adds a task to an existing project; fails with `ApplicationError` if not found |
| `getAllProjects`                               | Returns all projects                                                           |

All mutating use cases are wrapped with `withTXBoundary(IsolationLevel.Batched)`, which:

- Executes the use case within an atomic database batch
- Persists returned domain events to the event store
- Triggers the `EventPublisherDaemon` to forward events to NATS

## Service Ports

Abstract `Context.Tag` services that the application layer depends on. Implementations are provided by `@projects/infra`.

| Service           | Description                                |
| ----------------- | ------------------------------------------ |
| `SaveProject`     | Persist a `Project` aggregate              |
| `GetAllProjects`  | Retrieve all projects                      |
| `FindProjectById` | Look up a project by ID (returns `Option`) |
| `SaveTask`        | Persist a `Task` aggregate                 |

## Error Handling

`ApplicationError` with `ErrorKinds.NotFound` is returned when referenced aggregates don't exist. Infrastructure errors (`PersistenceError`) bubble up from service calls.
