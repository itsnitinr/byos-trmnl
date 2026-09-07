/**
 * Local registry for read-only TRMNL data (models, palettes, categories, ips).
 *
 * Strategy:
 *  - Bundled JSON snapshot under `data/trmnl/<resource>.json` ships with the repo.
 *  - First hit serves the bundled snapshot and schedules an upstream refresh that best-effort
 *    persists to disk so future cold starts have fresher data.
 *  - 24h TTL: stale entries are served while metadata refreshes after the response.
 *  - On upstream failure we fall back to whatever snapshot we have (in-memory or
 *    on-disk), so the endpoints keep working offline.
 *  - Set `TRMNL_PROXY_LIVE=true` to bypass the cache entirely and proxy every
 *    request to upstream (useful for debugging or when you must see live data).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { afterResponse } from "@/lib/cache/after-response";
import { createSnapshotCache } from "@/lib/cache/snapshot-cache";

const TRMNL_API_BASE = "https://usetrmnl.com";
const DATA_DIR = path.join(process.cwd(), "data", "trmnl");
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export type {
	RegistryResource,
	TrmnlModel,
	TrmnlPalette,
} from "./types";

import type { RegistryResource, TrmnlModel, TrmnlPalette } from "./types";
import { trmnlModelSchema, trmnlPaletteSchema } from "./types";

/**
 * Validate a `{ data: [...] }` registry payload against `itemSchema`,
 * returning only the entries that parse. Invalid entries are dropped and
 * logged rather than throwing, so a single malformed item (or an upstream
 * shape change) can't blank the whole catalog and break rendering.
 */
export function parseRegistryList<S extends z.ZodType>(
	resource: RegistryResource,
	itemSchema: S,
	payload: unknown,
): z.infer<S>[] {
	const rawData = (payload as { data?: unknown } | null | undefined)?.data;
	if (!Array.isArray(rawData)) {
		console.warn(`[registry] ${resource}: payload has no "data" array`);
		return [];
	}
	const items: z.infer<S>[] = [];
	for (const entry of rawData) {
		const result = itemSchema.safeParse(entry);
		if (result.success) {
			items.push(result.data);
		} else {
			console.warn(
				`[registry] ${resource}: dropping invalid entry`,
				result.error.issues,
			);
		}
	}
	return items;
}

const parsedModels = new WeakMap<object, TrmnlModel[]>();
const parsedPalettes = new WeakMap<object, TrmnlPalette[]>();
export async function listModels(): Promise<TrmnlModel[]> {
	const payload = await getRegistry("models");
	if (!payload || typeof payload !== "object") return [];
	let models = parsedModels.get(payload);
	if (!models) {
		models = parseRegistryList("models", trmnlModelSchema, payload);
		parsedModels.set(payload, models);
	}
	return models;
}
export async function listPalettes(): Promise<TrmnlPalette[]> {
	const payload = await getRegistry("palettes");
	if (!payload || typeof payload !== "object") return [];
	let palettes = parsedPalettes.get(payload);
	if (!palettes) {
		palettes = parseRegistryList("palettes", trmnlPaletteSchema, payload);
		parsedPalettes.set(payload, palettes);
	}
	return palettes;
}

export async function findModel(name: string): Promise<TrmnlModel | null> {
	const models = await listModels();
	return models.find((m) => m.name === name) ?? null;
}

export async function findPalette(id: string): Promise<TrmnlPalette | null> {
	const palettes = await listPalettes();
	return palettes.find((p) => p.id === id) ?? null;
}

export function isProxyLive(): boolean {
	return process.env.TRMNL_PROXY_LIVE === "true";
}

async function readSnapshot(
	resource: RegistryResource,
): Promise<unknown | null> {
	try {
		const file = path.join(DATA_DIR, `${resource}.json`);
		const raw = await fs.readFile(file, "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function writeSnapshot(
	resource: RegistryResource,
	data: unknown,
): Promise<void> {
	try {
		await fs.mkdir(DATA_DIR, { recursive: true });
		const file = path.join(DATA_DIR, `${resource}.json`);
		await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	} catch {
		// Best-effort: serverless filesystems are often read-only. The in-memory
		// cache still serves subsequent requests in the same instance.
	}
}

async function fetchUpstream(resource: RegistryResource): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(`${TRMNL_API_BASE}/api/${resource}`, {
			headers: { "Content-Type": "application/json" },
			signal: controller.signal,
		});
		if (!res.ok) {
			throw new Error(`TRMNL /api/${resource} returned ${res.status}`);
		}
		return await res.json();
	} finally {
		clearTimeout(timeout);
	}
}

const registryCache = createSnapshotCache<RegistryResource, unknown>({
	snapshot: readSnapshot,
	refresh: async (resource) => {
		const fresh = await fetchUpstream(resource);
		const data = (fresh as { data?: unknown } | null)?.data;
		if (!Array.isArray(data))
			throw new Error(`Invalid ${resource} registry response`);
		if (
			resource === "models" &&
			!parseRegistryList(resource, trmnlModelSchema, fresh).length
		)
			throw new Error("Empty valid model registry");
		if (
			resource === "palettes" &&
			!parseRegistryList(resource, trmnlPaletteSchema, fresh).length
		)
			throw new Error("Empty valid palette registry");
		await writeSnapshot(resource, fresh);
		return fresh;
	},
	schedule: afterResponse,
	ttlMs: TTL_MS,
});

export async function getRegistry(
	resource: RegistryResource,
): Promise<unknown> {
	if (process.env.TRMNL_REGISTRY_OFFLINE === "true")
		return registryCache.get(resource, true);
	if (isProxyLive()) return fetchUpstream(resource);
	return registryCache.get(resource);
}

/**
 * GET handler for a registry resource. The `/api/{models,palettes,categories,
 * ips}` routes are otherwise identical, so they share this factory.
 */
export function createRegistryRouteHandler(resource: RegistryResource) {
	return async function GET(): Promise<Response> {
		try {
			return Response.json(await getRegistry(resource));
		} catch (error) {
			return Response.json(
				{
					error: `Failed to load ${resource} registry`,
					message: error instanceof Error ? error.message : "Unknown error",
				},
				{ status: 502 },
			);
		}
	};
}
