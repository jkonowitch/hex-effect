<script lang="ts">
  import type { PageData } from './$types';
  import { enhance } from '$app/forms';

  export let data: PageData;
</script>

<h3>Create Project</h3>
<form method="POST" action="?/createProject" use:enhance>
  <label>
    Title
    <input type="text" name="title" />
  </label>
  <button>Create</button>
</form>

<ul>
  {#each data.projects as project}
    <li><a href={`/projects/${project.id}`}>{project.title}</a></li>
  {/each}
</ul>
