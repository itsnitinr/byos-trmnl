/**
 * Jest stand-in for next/font/google and next/font/local, which only work
 * under the Next.js compiler. Rendering reads font files directly, so tests
 * only need the shape these loaders return.
 */
type FontOptions = { variable?: string };

function font(options: FontOptions = {}) {
	const name = options.variable?.replace(/^--font-/, "") ?? "font";
	return {
		className: `font-${name}`,
		variable: options.variable ?? "",
		style: { fontFamily: name },
	};
}

export default font;
export const Geist = font;
export const Geist_Mono = font;
export const Inter = font;
