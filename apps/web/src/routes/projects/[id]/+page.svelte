<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';

  export let data: PageData;
  export let form: ActionData;
</script>

<h1>Project {data.data.project.title}</h1>
<ul>
  {#each data.data.tasks as task}
    <li>[{task.completed ? 'x' : ' '}]{task.description}</li>
  {/each}
</ul>

{#if form?.errors}
  {#each form.errors as issue}
    <p>{issue.path}</p>
    <p>{issue.message}</p>
  {/each}
{/if}

<form method="POST" use:enhance>
  <label
    >Description
    <!-- svelte-ignore a11y-autofocus -->
    <input autofocus type="text" name="description" />
  </label>
  <button>Save</button>
</form>
