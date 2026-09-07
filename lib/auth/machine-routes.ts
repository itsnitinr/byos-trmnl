/** These routes perform their own capability/session validation in the handler. */
export function isMachineAuthenticatedRoute(pathname: string): boolean {
	return (
		/^\/recipes\/[^/]+\/preview$/.test(pathname) ||
		/^\/api\/plugin_settings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/(?:data|image|settings|details|archive|markup\/(?:full|half_horizontal|half_vertical|quadrant)))?$/.test(
			pathname,
		)
	);
}
