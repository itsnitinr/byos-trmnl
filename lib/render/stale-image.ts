import sharp from "sharp";

export async function stampStaleImage(
	png: Buffer,
	updatedAt: number,
): Promise<Buffer> {
	const { width = 800, height = 480 } = await sharp(png).metadata();
	const fontSize = Math.max(10, Math.round(width / 70));
	const barHeight = fontSize + 12;
	const text = `Source unavailable · Updated ${new Date(updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`;
	const label = Buffer.from(
		`<svg width="${width}" height="${barHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="8" y="${fontSize + 4}" fill="black" font-family="sans-serif" font-size="${fontSize}">${text}</text></svg>`,
	);
	return sharp(png)
		.composite([
			{ input: label, left: 0, top: Math.max(0, height - barHeight) },
		])
		.png()
		.toBuffer();
}
