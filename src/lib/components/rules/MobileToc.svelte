<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { afterNavigate } from '$app/navigation';
	import TocSidebar from '$lib/components/rules/TocSidebar.svelte';
	import type { Manifest } from '$lib/content/types';

	let { manifest, current }: { manifest: Manifest; current: string } = $props();
	let open = $state(false);

	afterNavigate(() => {
		open = false;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger
		class="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-navy-deep/90 px-4 py-2 text-xs font-semibold tracking-wider text-white uppercase backdrop-blur lg:hidden"
	>
		<svg
			aria-hidden="true"
			class="h-4 w-4 shrink-0"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.4"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<line x1="8" y1="6" x2="20" y2="6" />
			<line x1="8" y1="12" x2="20" y2="12" />
			<line x1="8" y1="18" x2="20" y2="18" />
			<circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
			<circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
			<circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
		</svg>
		Sections
	</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-navy-deep/70 backdrop-blur-sm" />
		<Dialog.Content
			class="fixed inset-x-3 top-16 bottom-16 z-50 overflow-y-auto rounded-xl border border-white/10 bg-navy-deep p-4"
		>
			<div class="flex items-center justify-between">
				<Dialog.Title class="display text-2xl text-white">Sections</Dialog.Title>
				<Dialog.Close
					aria-label="Close"
					class="flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:text-white"
				>
					✕
				</Dialog.Close>
			</div>
			<div class="mt-4">
				<TocSidebar {manifest} {current} />
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
