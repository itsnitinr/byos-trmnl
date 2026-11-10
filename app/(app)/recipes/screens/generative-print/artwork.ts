import { dailySeed, seededRandom } from "@/lib/recipes/art/daily";

export const printStyles = [
	"contours",
	"orbits",
	"tiles",
	"flow",
	"weave",
	"strata",
	"fans",
	"blocks",
	"phyllotaxis",
] as const;
export type PrintStyle = (typeof printStyles)[number];

type Draw = (width: number, height: number, random: () => number) => string;

const titles: Record<PrintStyle, string> = {
	contours: "Folded terrain",
	orbits: "Orbital study",
	tiles: "Quarter turns",
	flow: "Lines of drift",
	weave: "Over & under",
	strata: "Land memory",
	fans: "Radial rhythm",
	blocks: "Counterweight",
	phyllotaxis: "Golden angle",
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

const point = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;

function contours(width: number, height: number, random: () => number): string {
	const phase = random() * Math.PI * 2;
	const centerX = width * (0.35 + random() * 0.3);
	const centerY = height * (0.3 + random() * 0.4);
	const spacing = 10;
	const count = Math.ceil(Math.hypot(width, height) / spacing);
	return Array.from({ length: count }, (_, ring) => {
		const radius = 12 + ring * spacing;
		const points = Array.from({ length: 181 }, (_, index) => {
			const angle = (index / 180) * Math.PI * 2;
			const ripple =
				1 +
				0.15 * Math.sin(angle * 3 + phase + ring * 0.035) +
				0.07 * Math.cos(angle * 5 - phase);
			return `${index ? "L" : "M"}${point(centerX + Math.cos(angle) * radius * ripple * 1.25, centerY + Math.sin(angle) * radius * ripple * 0.85)}`;
		}).join("");
		return `<path d="${points}Z" stroke-width="${ring % 5 === 0 ? 3 : 1.6}"/>`;
	}).join("");
}

function orbits(width: number, height: number, random: () => number): string {
	const centerX = width * (0.35 + random() * 0.3);
	const centerY = height * (0.35 + random() * 0.3);
	const angle = -35 + random() * 70;
	const count = Math.ceil(Math.hypot(width, height) / 12);
	let drawing = `<g transform="rotate(${angle.toFixed(2)} ${centerX} ${centerY})">`;
	for (let ring = 1; ring <= count; ring++) {
		const radius = ring * 12;
		drawing += `<ellipse cx="${centerX}" cy="${centerY}" rx="${radius * 1.45}" ry="${radius * 0.7}" stroke-width="${ring % 4 === 0 ? 3 : 1.6}"/>`;
	}
	const disk = Math.min(width, height) * (0.12 + random() * 0.04);
	drawing += `<circle cx="${centerX}" cy="${centerY}" r="${disk + 8}" fill="white" stroke="none"/><circle cx="${centerX}" cy="${centerY}" r="${disk}" fill="black" stroke="none"/></g>`;
	return drawing;
}

function tiles(width: number, height: number, random: () => number): string {
	const columns = Math.max(3, Math.round(width / 80));
	const size = width / columns;
	const rows = Math.ceil(height / size);
	const offsetY = (height - rows * size) / 2;
	let drawing = "";
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			const rotate = random() < 0.5 ? 0 : 90;
			drawing += `<g transform="translate(${column * size} ${offsetY + row * size}) rotate(${rotate} ${size / 2} ${size / 2})">`;
			// Complementary radii meet exactly at adjacent tile edges.
			for (const fraction of [0.32, 0.44, 0.56, 0.68]) {
				const radius = size * fraction;
				drawing += `<path d="M0 ${radius}A${radius} ${radius} 0 0 0 ${radius} 0M${size - radius} ${size}A${radius} ${radius} 0 0 1 ${size} ${size - radius}" stroke-width="${fraction === 0.44 ? 3 : 1.6}"/>`;
			}
			drawing += "</g>";
		}
	}
	return drawing;
}

function flow(width: number, height: number, random: () => number): string {
	const phase = random() * Math.PI * 2;
	const bend = 0.6 + random() * 0.6;
	const amplitude = Math.min(width * 0.16, height * 0.3);
	const spacing = 9;
	let drawing = "";
	for (let line = -6; line <= Math.ceil(height / spacing) + 6; line++) {
		let path = "";
		for (let step = 0; step <= 100; step++) {
			const x = (step / 100) * width;
			const t = x / width;
			const y =
				line * spacing +
				amplitude *
					Math.sin(t * Math.PI * 2 * bend + phase) *
					Math.sin(((line * spacing) / height) * 1.9 + t * 2) +
				amplitude * 0.3 * Math.cos(t * 9 + phase);
			path += `${step ? "L" : "M"}${point(x, y)}`;
		}
		drawing += `<path d="${path}" stroke-width="${line % 6 === 0 ? 3 : 1.7}"/>`;
	}
	return drawing;
}

function weave(width: number, height: number, random: () => number): string {
	const size = Math.min(width, height) / (4 + Math.floor(random() * 2));
	const ribbon = size * 0.56;
	const offsetX = random() * size;
	const offsetY = random() * size;
	const columns = Math.ceil(width / size) + 1;
	const rows = Math.ceil(height / size) + 1;
	// First lay the warp, then mask each crossing before drawing its top ribbon.
	let drawing = "";
	const strip = (x: number, y: number, length: number, vertical: boolean) => {
		let lines = "";
		for (let thread = 0; thread <= 4; thread++) {
			const shift = -ribbon / 2 + (thread * ribbon) / 4;
			lines += `<path d="M${point(vertical ? x + shift : x, vertical ? y : y + shift)}${vertical ? "v" : "h"}${length}" stroke-width="${thread === 0 || thread === 4 ? 2.5 : 1.5}"/>`;
		}
		return lines;
	};
	for (let col = 0; col < columns; col++) {
		drawing += strip(col * size + offsetX, 0, height, true);
	}
	for (let row = 0; row < rows; row++) {
		const y = row * size + offsetY;
		drawing += `<rect x="0" y="${y - ribbon / 2 - 3}" width="${width}" height="${ribbon + 6}" fill="white" stroke="none"/>`;
		drawing += strip(0, y, width, false);
	}
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) {
			if ((row + col) % 2) continue;
			const x = col * size + offsetX;
			const y = row * size + offsetY;
			drawing += `<rect x="${x - ribbon / 2 - 3}" y="${y - ribbon / 2 - 4}" width="${ribbon + 6}" height="${ribbon + 8}" fill="white" stroke="none"/>`;
			drawing += strip(x, y - ribbon / 2 - 5, ribbon + 10, true);
		}
	}
	return drawing;
}

function strata(width: number, height: number, random: () => number): string {
	const phase = random() * Math.PI * 2;
	const sunX = width * (0.2 + random() * 0.6);
	const sunY = height * 0.23;
	const radius = Math.min(width, height) * 0.12;
	let drawing = `<circle cx="${sunX}" cy="${sunY}" r="${radius}" fill="black" stroke="none"/>`;
	for (let layer = 0; layer < 7; layer++) {
		const base = height * (0.39 + layer * 0.105);
		const amplitude = height * (0.1 - layer * 0.008);
		const ridge = (offset: number) => {
			let path = "";
			for (let step = 0; step <= 80; step++) {
				const x = (width * step) / 80;
				const y =
					base +
					offset +
					amplitude *
						(Math.sin((x / width) * 5 + phase + layer * 0.7) +
							0.35 * Math.cos((x / width) * 11 - layer * 0.8));
				path += `${step ? "L" : "M"}${point(x, y)}`;
			}
			return path;
		};
		drawing += `<path d="${ridge(0)}L${width} ${height}H0Z" fill="white" stroke="none"/>`;
		drawing += `<path d="${ridge(0)}" stroke-width="3"/>`;
		for (let line = 1; line <= 7; line++) {
			drawing += `<path d="${ridge(line * 6)}" stroke-width="1.5"/>`;
		}
	}
	return drawing;
}

function fans(width: number, height: number, random: () => number): string {
	const columns = Math.max(2, Math.round(width / 150));
	const size = width / columns;
	const rows = Math.max(1, Math.round(height / size));
	const cellHeight = height / rows;
	let drawing = "";
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) {
			const angle = Math.floor(random() * 4) * 90;
			drawing += `<g transform="translate(${col * size} ${row * cellHeight}) scale(1 ${cellHeight / size}) rotate(${angle} ${size / 2} ${size / 2})">`;
			// Each wedge stays inside its square, so neighboring fans remain distinct.
			for (let ray = 0; ray < 18; ray++) {
				const a = ((ray / 18) * Math.PI) / 2;
				const b = (((ray + 0.5) / 18) * Math.PI) / 2;
				drawing += `<path d="M0 0L${point(Math.cos(a) * size, Math.sin(a) * size)}A${size} ${size} 0 0 1 ${point(Math.cos(b) * size, Math.sin(b) * size)}Z" fill="black" stroke="none"/>`;
			}
			drawing += "</g>";
		}
	}
	return drawing;
}

function blocks(width: number, height: number, random: () => number): string {
	const columns = Math.max(3, Math.round(width / 125));
	const size = width / columns;
	const rows = Math.max(1, Math.round(height / size));
	const cellHeight = height / rows;
	const tileSize = Math.min(size, cellHeight);
	const inset = tileSize * 0.1;
	const edge = tileSize - inset * 2;
	let drawing = "";
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) {
			const shape = Math.floor(random() * 5);
			const angle = Math.floor(random() * 4) * 90;
			drawing += `<g transform="translate(${col * size + (size - tileSize) / 2 + inset} ${row * cellHeight + (cellHeight - tileSize) / 2 + inset}) rotate(${angle} ${edge / 2} ${edge / 2})">`;
			if (shape === 0) {
				drawing += `<circle cx="${edge / 2}" cy="${edge / 2}" r="${edge / 2}" fill="black" stroke="none"/>`;
			} else if (shape === 1) {
				drawing += `<path d="M0 0H${edge}L0 ${edge}Z" fill="black" stroke="none"/>`;
			} else if (shape === 2) {
				drawing += `<path d="M0 ${edge}V0A${edge} ${edge} 0 0 1 ${edge} ${edge}Z" fill="black" stroke="none"/>`;
			} else if (shape === 3) {
				for (let line = 0; line < 6; line++) {
					drawing += `<path d="M0 ${(line * edge) / 5}H${edge}" stroke-width="${edge / 14}"/>`;
				}
			} else {
				drawing += `<rect x="2" y="2" width="${edge - 4}" height="${edge - 4}" stroke-width="4"/><circle cx="${edge / 2}" cy="${edge / 2}" r="${edge * 0.17}" fill="black" stroke="none"/>`;
			}
			drawing += "</g>";
		}
	}
	return drawing;
}

function phyllotaxis(
	width: number,
	height: number,
	random: () => number,
): string {
	const phase = random() * Math.PI * 2;
	const centerX = width * (0.46 + random() * 0.08);
	const centerY = height * (0.46 + random() * 0.08);
	const radius = Math.min(width, height) * 0.43;
	const count = Math.max(120, Math.round(radius * 2.7));
	const step = radius / Math.sqrt(count);
	let drawing = "";
	for (let seed = 1; seed <= count; seed++) {
		const distance = step * Math.sqrt(seed);
		const angle = seed * Math.PI * (3 - Math.sqrt(5)) + phase;
		const x = centerX + Math.cos(angle) * distance;
		const y = centerY + Math.sin(angle) * distance;
		const length = step * (0.38 + 0.5 * Math.sqrt(seed / count));
		drawing += `<ellipse cx="${x}" cy="${y}" rx="${length}" ry="${length * 0.48}" transform="rotate(${(angle * 180) / Math.PI + 35} ${x} ${y})" fill="black" stroke="none"/>`;
	}
	return drawing;
}

const drawings: Record<PrintStyle, Draw> = {
	contours,
	orbits,
	tiles,
	flow,
	weave,
	strata,
	fans,
	blocks,
	phyllotaxis,
};

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
	// Draw in a common design space: detail stays legible in half-screen slots
	// and scales with the artwork rather than becoming denser on larger panels.
	// Keep fine strokes above one pixel in short slots after 1-bit reduction.
	const scale = Math.max(0.75, Math.min(width, height) / 320);
	const drawing = drawings[resolvedStyle](
		width / scale,
		height / scale,
		seededRandom(editionSeed),
	);
	return {
		style: resolvedStyle,
		title: titles[resolvedStyle],
		number: String(editionSeed % 10000).padStart(4, "0"),
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width / scale} ${height / scale}"><rect width="100%" height="100%" fill="white"/><g fill="none" stroke="black" stroke-linejoin="round">${drawing}</g></svg>`,
	};
}
