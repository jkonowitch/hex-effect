<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';

  export let data: PageData;
  export let form: ActionData;

  function submitCompletedForm(e: Event) {
    if (e.currentTarget instanceof HTMLFormElement) {
      e.currentTarget.submit();
    }
  }
</script>

<h1>Project {data.data.project.title}</h1>
<ul>
  {#each data.data.tasks as task}
    <li>
      <form method="POST" action="?/completeTask" on:change={submitCompletedForm}>
        <label>
          <input
            type="checkbox"
            name="completed"
            checked={task.completed}
            disabled={task.completed}
          />
          {task.description}
        </label>
        <input type="hidden" name="taskId" value={task.id} />
      </form>
    </li>
  {/each}
</ul>

{#if form?.errors}
  {#each form.errors as issue}
    <p>{issue.path}</p>
    <p>{issue.message}</p>
  {/each}
{/if}

<form method="POST" action="?/addTask" use:enhance>
  <label
    >Description
    <!-- svelte-ignore a11y-autofocus -->
    <input autofocus type="text" name="description" />
  </label>
  <button>Save</button>
</form>
