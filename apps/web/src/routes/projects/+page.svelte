<script lang="ts">
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<ul>
  {#each data.data as project}
    <li><a href={`/projects/${project.id}`}>{project.title}</a></li>
  {/each}
</ul>
