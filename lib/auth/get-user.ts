import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "./auth";

/**
 * Stable user id for PostgreSQL RLS when authentication is disabled (`AUTH_ENABLED=false`).
 * Must match `migrations/0013_seed_mono_user.sql`.
 */
export const BYOS_MONO_USER_ID = "byos_mono_user";

export type CurrentUser = {
	id: string;
	name: string;
	email: string;
	image?: string | null;
	role?: string;
} | null;

/**
 * The signed-in user for this request. Memoized per server render, so the
 * layout, data loaders and scoped queries share one session lookup instead
 * of each hitting the session table. (Outside a render, `cache` is a no-op.)
 */
const loadCurrentUser = cache(async (): Promise<CurrentUser> => {
	if (!auth) {
		return null;
	}

	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		return null;
	}

	return {
		id: session.user.id,
		name: session.user.name,
		email: session.user.email,
		image: session.user.image,
		role: (session.user as { role?: string }).role,
	};
});

/**
 * Get the current authenticated user from the session.
 * Returns null if auth is disabled or user is not authenticated.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
	return loadCurrentUser();
}

/**
 * Ensure the current user is a signed-in admin; throws "Unauthorized" otherwise.
 * Shared by admin server actions.
 */
export async function requireAdmin(): Promise<NonNullable<CurrentUser>> {
	const user = await getCurrentUser();
	if (user?.role !== "admin") {
		throw new Error("Unauthorized");
	}
	return user;
}

/**
 * Get the current user ID for row-level security scoping.
 * When auth is disabled, returns {@link BYOS_MONO_USER_ID} so inserts pass recipes RLS and FK checks.
 * When auth is enabled, returns the signed-in user's id, or null if not authenticated.
 */
export async function getCurrentUserId(): Promise<string | null> {
	if (!auth) {
		return BYOS_MONO_USER_ID;
	}
	const user = await getCurrentUser();
	return user?.id ?? null;
}
