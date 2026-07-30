import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// `src/lib/content/load.ts` globs `$content/**` non-eagerly, so in dev each
		// section is a lazy import Vite serves over HTTP at request time. `content/`
		// sits outside the project root's default allow list, so without this every
		// section 404s in `npm run dev`. Production builds bundle the globs and
		// never hit this path, which is why the e2e suite (it builds first) passes
		// either way.
		fs: { allow: ['content'] }
	},
	test: {
		include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
		environment: 'node'
	}
});
