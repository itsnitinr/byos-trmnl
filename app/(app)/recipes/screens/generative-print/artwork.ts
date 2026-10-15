import { dailySeed, seededRandom } from "@/lib/recipes/art/daily";

export const printStyles = ["contours", "orbits", "tiles"] as const;
export type PrintStyle = (typeof printStyles)[number];

const titles: Record<PrintStyle, string> = {
	contours: "Folded terrain",
	orbits: "Orbital study",
	tiles: "Quarter turns",
};

export function resolvePrintStyle(
	style: PrintStyle | "daily",
	date: string,
): PrintStyle {
	if (style !== "daily") return style;
	const day = Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
	return printStyles[
		((day % printStyles.length) + printStyles.length) % printStyles.length
	];
}

function contours(width: number, height: number, random: () => number): string {
	const phase = random() * Math.PI * 2;
	const centerX = width * (0.4 + random() * 0.2);
	const centerY = height * (0.4 + random() * 0.2);
	const spacing = 9;
	const count = Math.ceil(Math.hypot(width, height) / spacing);
	return Array.from({ length: count }, (_, ring) => {
		const radius = 12 + ring * spacing;
		const points = Array.from({ length: 181 }, (_, point) => {
			const angle = (point / 180) * Math.PI * 2;
			const ripple =
				1 +
				0.12 * Math.sin(angle * 3 + phase + ring * 0.035) +
				0.06 * Math.cos(angle * 5 - phase);
			const x = centerX + Math.cos(angle) * radius * ripple * 1.25;
			const y = centerY + Math.sin(angle) * radius * ripple * 0.85;
			return `${point ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
		}).join("");
		return `<path d="${points}Z" stroke-width="${ring % 5 === 0 ? 3 : 2}"/>`;
	}).join("");
}

function orbits(width: number, height: number, random: () => number): string {
	const centerX = width * (0.35 + random() * 0.3);
	const centerY = height * (0.35 + random() * 0.3);
	const angle = -35 + random() * 70;
	const spacing = 11;
	const count = Math.ceil(Math.hypot(width, height) / spacing);
	let drawing = `<g transform="rotate(${angle.toFixed(2)} ${centerX} ${centerY})">`;
	for (let ring = 1; ring <= count; ring++) {
		const radius = ring * spacing;
		drawing += `<ellipse cx="${centerX}" cy="${centerY}" rx="${radius * 1.45}" ry="${radius * 0.7}" stroke-width="${ring % 4 === 0 ? 3 : 2}"/>`;
	}
	const disk = Math.min(width, height) * (0.12 + random() * 0.04);
	drawing += `<circle cx="${centerX}" cy="${centerY}" r="${disk + 7}" fill="white" stroke="none"/><circle cx="${centerX}" cy="${centerY}" r="${disk}" fill="black" stroke="none"/></g>`;
	return drawing;
}

function tiles(width: number, height: number, random: () => number): string {
	const columns = Math.max(3, Math.round(width / 76));
	const size = width / columns;
	const rows = Math.ceil(height / size);
	const offsetY = (height - rows * size) / 2;
	let drawing = "";
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			const rotate = random() < 0.5 ? 0 : 90;
			drawing += `<g transform="translate(${column * size} ${offsetY + row * size}) rotate(${rotate} ${size / 2} ${size / 2})">`;
			// Complementary radii meet exactly at adjacent tile edges.
			for (const fraction of [0.2, 0.4, 0.6, 0.8]) {
				const radius = size * fraction;
				drawing += `<path d="M0 ${radius}A${radius} ${radius} 0 0 0 ${radius} 0M${size - radius} ${size}A${radius} ${radius} 0 0 1 ${size} ${size - radius}" stroke-width="2"/>`;
			}
			drawing += "</g>";
		}
	}
	return drawing;
}

/** Pure, local SVG geometry: the same edition and seed always reproduce a print. */
export function generatePrint({
	date,
	style,
	seed,
	width,
	height,
}: {
	date: string;
	style: PrintStyle | "daily";
	seed: string;
	width: number;
	height: number;
}) {
	const resolvedStyle = resolvePrintStyle(style, date);
	const editionSeed = dailySeed(
		`generative-print:${resolvedStyle}:${date}:${seed}`,
	);
	const draw = { contours, orbits, tiles }[resolvedStyle];
	const drawing = draw(width, height, seededRandom(editionSeed));
	return {
		style: resolvedStyle,
		title: titles[resolvedStyle],
		number: String(editionSeed % 10000).padStart(4, "0"),
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/><g fill="none" stroke="black" stroke-linejoin="round">${drawing}</g></svg>`,
	};
}
