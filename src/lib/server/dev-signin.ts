/**
 * Whether the dev-only email/password sign-in form should render.
 *
 * Mirrors, exactly, the check that gates the email/password provider itself in
 * `src/lib/server/auth.ts` (`env.ALLOW_TEST_SIGNIN === '1'`), so the two can
 * never disagree: when the provider is off, the endpoints this form posts to
 * don't exist, and this same check is why the form doesn't render. Read from a
 * server load function and passed to the client as page/layout data — see
 * `src/routes/ask/+layout.server.ts`.
 *
 * ALLOW_TEST_SIGNIN is never set in production; see CLAUDE.md and README.md.
 */
export function allowTestSignIn(env: App.Platform['env'] | undefined): boolean {
	return env?.ALLOW_TEST_SIGNIN === '1';
}
