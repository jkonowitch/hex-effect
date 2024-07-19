<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<h1>{data.hello}</h1>
<h2>{data.data.project.title}</h2>
<ul>
	{#each data.data.tasks as task}
		<li>[{task.completed ? 'x' : ' '}]{task.description}</li>
	{/each}
</ul>
