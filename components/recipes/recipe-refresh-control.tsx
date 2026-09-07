"use client";
import { useEffect, useState } from "react";
import {
	getRecipeRefreshSettings,
	saveRecipeRefreshSettings,
} from "@/app/actions/recipe-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RecipeRefreshControl({ slug }: { slug: string }) {
	const [seconds, setSeconds] = useState(300);
	const [editable, setEditable] = useState(false);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("Loading refresh settings…");
	useEffect(() => {
		let alive = true;
		void getRecipeRefreshSettings(slug)
			.then((settings) => {
				if (alive) {
					setSeconds(settings.seconds);
					setEditable(settings.editable);
					setMessage(
						settings.editable
							? ""
							: "Connect and initialize the database to save settings.",
					);
				}
			})
			.catch(() => {
				if (alive) setMessage("Could not load refresh settings.");
			});
		return () => {
			alive = false;
		};
	}, [slug]);
	return (
		<section className="space-y-3 rounded-lg border p-4">
			<h3 className="font-medium">Data refresh</h3>
			<p className="text-sm text-muted-foreground">
				Fetch new data at this interval, independently of when your device
				wakes. Zero fetches on every request.
			</p>
			<form
				className="flex flex-wrap items-end gap-3"
				onSubmit={async (event) => {
					event.preventDefault();
					setSaving(true);
					try {
						const result = await saveRecipeRefreshSettings(slug, seconds);
						setMessage(
							result.success
								? "Refresh interval saved."
								: (result.error ?? "Could not save."),
						);
					} catch {
						setMessage("Could not save refresh settings.");
					} finally {
						setSaving(false);
					}
				}}
			>
				<label className="space-y-1 text-sm" htmlFor={`refresh-${slug}`}>
					Interval in seconds
					<Input
						id={`refresh-${slug}`}
						type="number"
						min={0}
						max={86400}
						step={1}
						required
						value={seconds}
						disabled={!editable || saving}
						onChange={(event) => setSeconds(Number(event.target.value))}
					/>
				</label>
				<Button type="submit" disabled={!editable || saving}>
					{saving ? "Saving…" : "Save interval"}
				</Button>
			</form>
			<p role="status" className="text-sm text-muted-foreground">
				{message}
			</p>
		</section>
	);
}
