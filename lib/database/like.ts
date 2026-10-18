/** Escape `%`, `_` and `\` so user input matches literally in LIKE/ILIKE. */
export function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** ILIKE pattern matching `value` anywhere, with wildcards in `value` taken literally. */
export function containsPattern(value: string): string {
	return `%${escapeLike(value)}%`;
}
