## Todo App Example

This is a minimal example demonstrating hex-effect in action.

`./contexts` contains several bounded contexts, each with a `domain`, `application` and `infra` package.
`./web` contains the Sveltekit UI which "plugs in" to the bounded contexts via adapters.
