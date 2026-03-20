<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  export let data: PageData;
</script>

{#if data.project}
  <h2>{data.project.title}</h2>
  <h3>Tasks</h3>
  <ul>
    {#each data.tasks as task (task.id)}
      <li>
        <span style={task.completed ? 'text-decoration: line-through; opacity: 0.6' : ''}>
          {task.description}
        </span>
        {#if !task.completed}
          <form
            method="POST"
            action="?/completeTask"
            use:enhance={() =>
              async ({ update }) => {
                await update();
                // Badge award is async (event → NATS → handler → DB).
                // Re-fetch after a short delay so badges show up.
                setTimeout(() => invalidateAll(), 800);
              }}
            style="display:inline"
          >
            <input type="hidden" name="taskId" value={task.id} />
            <button type="submit">Mark Complete</button>
          </form>
        {/if}
        <form method="POST" action="?/removeTask" use:enhance style="display:inline">
          <input type="hidden" name="taskId" value={task.id} />
          <button type="submit">Remove</button>
        </form>
      </li>
    {/each}
  </ul>
  <form method="POST" action="?/addTask" use:enhance>
    <input type="text" name="description" placeholder="Task description" required />
    <button>Add Task</button>
  </form>
{:else}
  <p>Project not found.</p>
{/if}

{#if data.badges.length > 0}
  <h3>Badges Earned</h3>
  <ul>
    {#each data.badges as badge (badge.id)}
      <li>{badge.badgeType} — {badge.awardedAt.toLocaleString()}</li>
    {/each}
  </ul>
{/if}
