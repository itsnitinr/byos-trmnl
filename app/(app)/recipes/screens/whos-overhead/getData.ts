import { z } from "zod";
import { modelName } from "./aircraft-models";
import { type OverheadData, type OverheadParams, paramsSchema } from "./schema";

const positionSchema = z.object({
	hex: z.string(),
	flight: z.string().optional(),
	r: z.string().optional(),
	t: z.string().optional(),
	lat: z.number().min(-90).max(90),
	lon: z.number().min(-180).max(180),
	alt_baro: z.union([z.number(), z.literal("ground")]).optional(),
	alt_geom: z.number().optional(),
	gs: z.number().optional(),
	track: z.number().optional(),
	seen_pos: z.number().min(0),
});
const airport = z.object({
	iata_code: z.string().nullish(),
	icao_code: z.string(),
	municipality: z.string().nullish(),
});
const airlineSchema = z.object({ name: z.string(), icao: z.string() });
const routeSchema = z.object({
	response: z.object({
		flightroute: z.object({
			origin: airport,
			destination: airport,
			airline: airlineSchema.nullish(),
		}),
	}),
});
const rad = (degrees: number) => (degrees * Math.PI) / 180;
export function relativePosition(
	lat: number,
	lon: number,
	otherLat: number,
	otherLon: number,
) {
	const dLat = rad(otherLat - lat),
		dLon = rad(otherLon - lon);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(rad(lat)) * Math.cos(rad(otherLat)) * Math.sin(dLon / 2) ** 2;
	return {
		distanceKm:
			6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))),
		bearing:
			((Math.atan2(
				Math.sin(dLon) * Math.cos(rad(otherLat)),
				Math.cos(rad(lat)) * Math.sin(rad(otherLat)) -
					Math.sin(rad(lat)) * Math.cos(rad(otherLat)) * Math.cos(dLon),
			) *
				180) /
				Math.PI +
				360) %
			360,
	};
}
export function selectAircraft(values: unknown[], params: OverheadParams) {
	return values
		.flatMap((value) => {
			const parsed = positionSchema.safeParse(value);
			if (!parsed.success) return [];
			const ac = parsed.data;
			if (
				ac.alt_baro === "ground" ||
				ac.seen_pos > 60 ||
				(ac.alt_baro ?? ac.alt_geom ?? 0) <= 0
			)
				return [];
			const position = relativePosition(
				params.latitude,
				params.longitude,
				ac.lat,
				ac.lon,
			);
			return position.distanceKm <= params.radiusKm
				? [{ ...ac, ...position }]
				: [];
		})
		.sort((a, b) => a.distanceKm - b.distanceKm || a.hex.localeCompare(b.hex));
}
async function json(
	url: string,
	signal: AbortSignal,
	revalidate: number,
): Promise<unknown> {
	const response = await fetch(url, {
		signal,
		next: { revalidate },
		headers: {
			"User-Agent": "BYOS-TRMNL/1.0 (+https://github.com/usetrmnl/byos_next)",
		},
	});
	if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
	return response.json();
}
async function logo(icao: string, signal: AbortSignal) {
	if (!/^[A-Z]{3}$/.test(icao)) return undefined;
	try {
		const response = await fetch(
			`https://raw.githubusercontent.com/Jxck-S/airline-logos/main/radarbox_logos/${icao}.png`,
			{ signal, next: { revalidate: 86400 } },
		);
		if (
			!response.ok ||
			Number(response.headers.get("content-length")) > 200_000
		)
			return undefined;
		const bytes = Buffer.from(await response.arrayBuffer());
		if (
			bytes.length > 200_000 ||
			bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
		)
			return undefined;
		return `data:image/png;base64,${bytes.toString("base64")}`;
	} catch {
		return undefined;
	}
}
export default async function getOverheadData(
	input: OverheadParams,
): Promise<OverheadData> {
	const params = paramsSchema.parse(input);
	const base = {
		location: params.location,
		radiusKm: params.radiusKm,
		updated: new Date().toISOString(),
		count: 0,
	};
	// One deadline for the complete enrichment chain; leave room for the runtime's 10s limit.
	const signal = AbortSignal.timeout(7500);
	if (params.demo)
		return {
			...base,
			status: "demo",
			count: 4,
			aircraft: {
				hex: "sample",
				callsign: "KLM880",
				registration: "PH-BKS",
				type: "B78X",
				model: modelName("B78X"),
				airline: "KLM Royal Dutch Airlines",
				logo: params.showLogo ? await logo("KLM", signal) : undefined,
				origin: "BLR",
				destination: "AMS",
				originCity: "Bengaluru",
				destinationCity: "Amsterdam",
				altitude: 12400,
				speed: 315,
				heading: 302,
				distanceKm: 3.2,
				bearing: 48,
			},
		};
	try {
		const feed = z
			.object({ ac: z.array(z.unknown()).default([]), now: z.number() })
			.parse(
				await json(
					`https://api.adsb.lol/v2/point/${params.latitude}/${params.longitude}/${(params.radiusKm / 1.852).toFixed(4)}`,
					signal,
					15,
				),
			);
		// readsb timestamps are milliseconds. Never present an old cached feed as live.
		if (Math.abs(Date.now() - feed.now) > 120_000)
			throw new Error("Stale feed");
		base.updated = new Date(feed.now).toISOString();
		const nearby = selectAircraft(feed.ac, params);
		const ac = nearby[0];
		if (!ac) return { ...base, status: "empty" };
		const callsign = ac.flight?.trim() || ac.r || ac.hex.toUpperCase();
		const data: OverheadData = {
			...base,
			status: "live",
			count: nearby.length,
			aircraft: {
				hex: ac.hex,
				callsign,
				registration: ac.r || "Registration unavailable",
				type: ac.t || "",
				model: modelName(ac.t || ""),
				airline: "Operator unidentified",
				origin: "—",
				destination: "—",
				originCity: "Route unavailable",
				destinationCity: "",
				altitude:
					typeof ac.alt_baro === "number" ? ac.alt_baro : (ac.alt_geom ?? null),
				speed: ac.gs ?? null,
				heading: ac.track ?? null,
				distanceKm: ac.distanceKm,
				bearing: ac.bearing,
			},
		};
		const aircraft = data.aircraft;
		if (!aircraft) return data;
		let airlineCode = /^[A-Z]{3}[0-9]/.test(callsign)
			? callsign.slice(0, 3)
			: "";
		try {
			const route = routeSchema.parse(
				await json(
					`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`,
					signal,
					3600,
				),
			).response.flightroute;
			aircraft.origin = route.origin.iata_code || route.origin.icao_code;
			aircraft.destination =
				route.destination.iata_code || route.destination.icao_code;
			aircraft.originCity = route.origin.municipality || "";
			aircraft.destinationCity = route.destination.municipality || "";
			if (route.airline) {
				aircraft.airline = route.airline.name;
				airlineCode = route.airline.icao;
			}
		} catch {
			/* Callsign routes are optional; keep the live position. */
		}
		if (params.showLogo) aircraft.logo = await logo(airlineCode, signal);
		return data;
	} catch {
		return { ...base, status: "error" };
	}
}
