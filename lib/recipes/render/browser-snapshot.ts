import { randomUUID } from "node:crypto";
import type { DataFreshness } from "../runtime/data-cache";

export type RecipeDataSnapshot = {
	params: Record<string, unknown>;
	data: Record<string, unknown>;
	freshness?: DataFreshness;
};
type StoredSnapshot = {
	value: RecipeDataSnapshot;
	userId: string | null;
	slug: string;
	expiresAt: number;
	bytes: number;
};
const state = globalThis as typeof globalThis & {
	byosRecipeSnapshots?: Map<string, StoredSnapshot>;
};
state.byosRecipeSnapshots ??= new Map();
const snapshots = state.byosRecipeSnapshots;

export function storeBrowserSnapshot(
	value: RecipeDataSnapshot,
	userId: string | null,
	slug: string,
): string {
	for (const [id, item] of snapshots)
		if (item.expiresAt <= Date.now()) snapshots.delete(id);
	const bytes = Buffer.byteLength(JSON.stringify(value));
	const used = Array.from(snapshots.values()).reduce(
		(sum, item) => sum + item.bytes,
		0,
	);
	if (snapshots.size >= 32 || bytes + used > 8 * 1024 * 1024)
		throw new Error("Browser snapshot capacity exceeded");
	const id = randomUUID();
	snapshots.set(id, {
		value,
		userId,
		slug,
		bytes,
		expiresAt: Date.now() + 30_000,
	});
	return id;
}

export function takeBrowserSnapshot(
	id: string,
	userId: string | null,
	slug: string,
): RecipeDataSnapshot | null {
	const stored = snapshots.get(id);
	if (!stored || stored.userId !== userId || stored.slug !== slug) return null;
	snapshots.delete(id);
	return stored.expiresAt > Date.now() ? stored.value : null;
}

export function discardBrowserSnapshot(id: string): void {
	snapshots.delete(id);
}
