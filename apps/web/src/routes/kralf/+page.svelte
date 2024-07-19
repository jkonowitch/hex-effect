<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';

	export let data: PageData;
	export let form: ActionData;
</script>

<h1>{data.hello}</h1>
<h2>{data.data.project.title}</h2>
<ul>
	{#each data.data.tasks as task}
		<li>[{task.completed ? 'x' : ' '}]{task.description}</li>
	{/each}
</ul>

{form?.kralf}

<form method="POST" use:enhance>
	<label
		>Description
		<!-- svelte-ignore a11y-autofocus -->
		<input autofocus type="text" name="description" />
	</label>
	<button>Save</button>
</form>
