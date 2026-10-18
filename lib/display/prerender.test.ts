import { contentFilename, prerenderDisplayImage } from "./prerender";

const renderRecipeForDevice = jest.fn();
jest.mock("@/lib/recipes/recipe-renderer", () => ({
	renderRecipeForDevice: (...args: unknown[]) => renderRecipeForDevice(...args),
}));
jest.mock("@/lib/mixup/render", () => ({ renderMixupImage: jest.fn() }));
jest.mock("@/lib/render/error-image", () => ({ renderErrorImage: jest.fn() }));
jest.mock("@/lib/render/diagnostics", () => ({
	diagnoseRender: async (
		_user: unknown,
		_slug: unknown,
		_w: unknown,
		_h: unknown,
		work: () => Promise<unknown>,
	) => ({ image: await work(), trace: {} }),
}));

const profile = {
	model: { mime_type: "image/webp" },
	palette: null,
} as never;
const context = { profile, width: 800, height: 480, userId: "u" };

test("content filenames fit the firmware's 31-character flash names", () => {
	const name = contentFilename(
		"GitHub Contributions!",
		Buffer.from("pixels"),
		profile,
	);
	expect(name).toMatch(/^github-con-[0-9a-f]{14}\.webp$/);
	expect(name.length).toBeLessThanOrEqual(31);
	expect(contentFilename("x", Buffer.from("pixels"), profile)).toBe(
		contentFilename("x", Buffer.from("pixels"), profile),
	);
	expect(contentFilename("x", Buffer.from("pixels"), profile)).not.toBe(
		contentFilename("x", Buffer.from("pixel"), profile),
	);
});

test("names a rendered image by its bytes", async () => {
	renderRecipeForDevice.mockResolvedValue({
		buffer: Buffer.from("png-bytes"),
		size_limit_exceeded: false,
	});
	const outcome = await prerenderDisplayImage(
		{ kind: "recipe", slug: "weather" },
		context,
	);
	expect(outcome).toMatchObject({
		kind: "ready",
		filename: contentFilename("weather", Buffer.from("png-bytes"), profile),
	});
});

test("reports failures and slow renders instead of waiting past the deadline", async () => {
	renderRecipeForDevice.mockRejectedValue(new Error("upstream down"));
	expect(
		(await prerenderDisplayImage({ kind: "recipe", slug: "weather" }, context))
			.kind,
	).toBe("failed");

	renderRecipeForDevice.mockResolvedValue(null);
	expect(
		(await prerenderDisplayImage({ kind: "recipe", slug: "weather" }, context))
			.kind,
	).toBe("failed");

	renderRecipeForDevice.mockImplementation(
		() => new Promise((resolve) => setTimeout(resolve, 1_000)),
	);
	const started = Date.now();
	const outcome = await prerenderDisplayImage(
		{ kind: "recipe", slug: "weather" },
		context,
		50,
	);
	expect(outcome.kind).toBe("timeout");
	expect(Date.now() - started).toBeLessThan(500);
});
