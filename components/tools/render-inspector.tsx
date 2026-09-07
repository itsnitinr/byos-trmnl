"use client";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RenderDiagnostic } from "@/lib/render/diagnostics";

type Model = {
	name: string;
	label: string;
	width: number;
	height: number;
	palette_ids: string[];
};
export function RenderInspector({
	recipes,
	models,
}: {
	recipes: { slug: string; title: string }[];
	models: Model[];
}) {
	const [recipe, setRecipe] = useState("device-calibration");
	const [modelName, setModelName] = useState("og_plus");
	const model = models.find((item) => item.name === modelName) ?? models[0];
	const [palette, setPalette] = useState("bw");
	const [rows, setRows] = useState<RenderDiagnostic[]>([]);
	const [preview, setPreview] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const reload = useCallback(async () => {
		const response = await fetch("/api/render-diagnostics", {
			cache: "no-store",
		});
		if (!response.ok) throw Error("Could not load render history");
		setRows((await response.json()).renders);
	}, []);
	useEffect(() => {
		void reload().catch(() => setError("Could not load render history"));
	}, [reload]);
	useEffect(
		() => () => {
			if (preview) URL.revokeObjectURL(preview);
		},
		[preview],
	);
	return (
		<div className="space-y-6">
			<form
				className="flex flex-wrap items-end gap-4 rounded-lg border p-4"
				onSubmit={async (event) => {
					event.preventDefault();
					if (!model) return;
					setBusy(true);
					setError("");
					try {
						const query = new URLSearchParams({
							model: model.name,
							palette_id: palette,
							width: String(model.width),
							height: String(model.height),
						});
						const response = await fetch(
							`/api/bitmap/${encodeURIComponent(recipe)}.png?${query}`,
							{ cache: "no-store" },
						);
						if (!response.ok) throw Error(`Render failed (${response.status})`);
						setPreview(URL.createObjectURL(await response.blob()));
						await reload();
					} catch (e) {
						setError(e instanceof Error ? e.message : "Render failed");
					} finally {
						setBusy(false);
					}
				}}
			>
				<label className="grid gap-1 text-sm" htmlFor="inspector-recipe">
					Recipe
					<select
						id="inspector-recipe"
						className="rounded border bg-background p-2"
						value={recipe}
						onChange={(e) => setRecipe(e.target.value)}
					>
						{recipes.map((item) => (
							<option key={item.slug} value={item.slug}>
								{item.title}
							</option>
						))}
					</select>
				</label>
				<label className="grid gap-1 text-sm" htmlFor="inspector-model">
					Display
					<select
						id="inspector-model"
						className="rounded border bg-background p-2"
						value={model?.name}
						onChange={(e) => {
							setModelName(e.target.value);
							setPalette(
								models.find((item) => item.name === e.target.value)
									?.palette_ids[0] ?? "bw",
							);
						}}
					>
						{models.map((item) => (
							<option key={item.name} value={item.name}>
								{item.label}
							</option>
						))}
					</select>
				</label>
				<label className="grid gap-1 text-sm" htmlFor="inspector-palette">
					Palette
					<select
						id="inspector-palette"
						className="rounded border bg-background p-2"
						value={palette}
						onChange={(e) => setPalette(e.target.value)}
					>
						{model?.palette_ids.map((id) => (
							<option key={id}>{id}</option>
						))}
					</select>
				</label>
				<Button disabled={busy || !model}>
					{busy ? "Rendering…" : "Render image"}
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={() =>
						void reload().catch(() => setError("Could not load render history"))
					}
				>
					Refresh history
				</Button>
			</form>
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
			{preview && (
				<Image
					unoptimized
					width={model?.width ?? 800}
					height={model?.height ?? 480}
					src={preview}
					alt="Latest device render"
					className="max-h-[480px] max-w-full border object-contain"
				/>
			)}
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-left text-sm">
					<thead className="bg-muted">
						<tr>
							{[
								"Recipe",
								"Dimensions",
								"Fetch",
								"Raster",
								"Encode",
								"Total",
								"Bytes",
								"Cache",
								"Result",
							].map((label) => (
								<th key={label} className="p-3">
									{label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.id} className="border-t">
								<td className="p-3">
									{row.recipe}
									<div className="text-xs text-muted-foreground">
										{new Date(row.startedAt).toLocaleTimeString()}
									</div>
								</td>
								<td className="p-3">
									{row.width}×{row.height}
								</td>
								{[
									row.stages.fetch,
									row.stages.raster,
									row.stages.encode,
									row.totalMs,
								].map((ms, index) => (
									<td key={String(index)} className="p-3 tabular-nums">
										{ms === undefined ? "—" : `${ms.toFixed(1)} ms`}
									</td>
								))}
								<td className="p-3 tabular-nums">
									{row.bytes?.toLocaleString() ?? "—"}
								</td>
								<td className="p-3">
									{row.cache.raster ?? "—"} / {row.cache.encode ?? "—"}
								</td>
								<td className="p-3">
									{row.fallback ? "Size fallback" : row.status}
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{rows.length === 0 && (
					<p className="p-6 text-muted-foreground">
						Render an image to see its timings here.
					</p>
				)}
			</div>
			<p className="text-sm text-muted-foreground">
				Shows your latest 50 renders on this server process. Cache columns show
				raster / encoding reuse; skipped stages display a dash.
			</p>
		</div>
	);
}
