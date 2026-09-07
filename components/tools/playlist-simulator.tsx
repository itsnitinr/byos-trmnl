"use client";
import { useState } from "react";
import { fetchPlaylistWithItems } from "@/app/actions/playlist";
import { Button } from "@/components/ui/button";
import { simulatePlaylist } from "@/lib/playlists/schedule";
import type { Playlist, PlaylistItem } from "@/lib/types";

const sample: PlaylistItem[] = [
	{
		id: "morning",
		playlist_id: null,
		screen_id: "moon-almanac",
		duration: 900,
		start_time: "06:00",
		end_time: "18:00",
		days_of_week: null,
		order_index: 0,
		created_at: null,
	},
	{
		id: "print",
		playlist_id: null,
		screen_id: "daily-print",
		duration: 1800,
		start_time: null,
		end_time: null,
		days_of_week: null,
		order_index: 10,
		created_at: null,
	},
];
export function PlaylistSimulator({ playlists }: { playlists: Playlist[] }) {
	const [selected, setSelected] = useState(playlists[0]?.id ?? "sample");
	const [instant, setInstant] = useState(() => new Date().toISOString());
	const [zone, setZone] = useState("UTC");
	const [index, setIndex] = useState(-1);
	const [steps, setSteps] = useState<ReturnType<typeof simulatePlaylist>>([]);
	const [resultZone, setResultZone] = useState("UTC");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const inputClass = "rounded border bg-background p-2";
	return (
		<div className="space-y-6">
			<form
				className="flex flex-wrap items-end gap-4 rounded-lg border p-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setBusy(true);
					setError("");
					try {
						if (!/(Z|[+-]\d{2}:\d{2})$/.test(instant))
							throw Error(
								"Include a UTC offset, for example 2026-09-08T09:00:00+05:30.",
							);
						const items =
							selected === "sample"
								? sample
								: (await fetchPlaylistWithItems(selected)).items;
						if (!items.length)
							throw Error(
								"This playlist has no screens. Add a screen before simulating.",
							);
						const result = simulatePlaylist(
							items,
							new Date(instant),
							zone,
							index,
						);
						setSteps(result);
						setResultZone(zone);
					} catch (e) {
						setError(
							e instanceof Error ? e.message : "Could not simulate playlist",
						);
					} finally {
						setBusy(false);
					}
				}}
			>
				<label className="grid gap-1 text-sm" htmlFor="sim-playlist">
					Playlist
					<select
						id="sim-playlist"
						className={inputClass}
						value={selected}
						onChange={(e) => setSelected(e.target.value)}
					>
						<option value="sample">Example playlist</option>
						{playlists.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>
				</label>
				<label className="grid gap-1 text-sm" htmlFor="sim-instant">
					First wake-up (ISO time with offset)
					<input
						id="sim-instant"
						className={`${inputClass} min-w-72`}
						required
						value={instant}
						onChange={(e) => setInstant(e.target.value)}
					/>
				</label>
				<label className="grid gap-1 text-sm" htmlFor="sim-zone">
					Device timezone
					<input
						id="sim-zone"
						className={inputClass}
						required
						value={zone}
						placeholder="Asia/Kolkata"
						onChange={(e) => setZone(e.target.value)}
					/>
				</label>
				<label className="grid gap-1 text-sm" htmlFor="sim-index">
					Last shown order (−1 starts first)
					<input
						id="sim-index"
						className={`${inputClass} w-40`}
						type="number"
						step="1"
						required
						value={index}
						onChange={(e) => setIndex(Number(e.target.value))}
					/>
				</label>
				<Button disabled={busy}>
					{busy ? "Simulating…" : "Simulate 12 wake-ups"}
				</Button>
			</form>
			{selected === "sample" && (
				<p className="text-sm text-muted-foreground">
					Example: Moon almanac from 06:00 to 18:00 for 15 minutes, alternating
					with Daily print for 30 minutes. Choose a saved playlist to inspect
					your own schedule.
				</p>
			)}
			<p className="text-sm text-muted-foreground">
				Time windows include their start and exclude their end. Overnight
				windows belong to the starting weekday. This predicts playlist selection
				during awake operation; device sleep, network delays and manual actions
				are excluded.
			</p>
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
			{steps.length > 0 && (
				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full text-left text-sm">
						<thead className="bg-muted">
							<tr>
								{["Wake-up", "Screen", "Next wake in", "Inactive screens"].map(
									(s) => (
										<th key={s} className="p-3">
											{s}
										</th>
									),
								)}
							</tr>
						</thead>
						<tbody>
							{steps.map((step) => (
								<tr key={step.at} className="border-t">
									<td className="p-3">
										{new Intl.DateTimeFormat(undefined, {
											timeZone: resultZone,
											dateStyle: "medium",
											timeStyle: "long",
										}).format(new Date(step.at))}
									</td>
									<td className="p-3">
										{step.item?.screen_id ??
											"No active item — device error screen"}
									</td>
									<td className="p-3">{step.seconds} seconds</td>
									<td className="p-3">
										{step.skipped
											.map((s) => `${s.screen}: ${s.reason}`)
											.join("; ") || "—"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
