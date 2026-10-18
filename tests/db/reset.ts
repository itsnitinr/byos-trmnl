import { Client } from "pg";

/** Drop everything in `public` so each suite starts from an empty database. */
export async function resetDatabase(connectionString: string): Promise<void> {
	const client = new Client({ connectionString });
	await client.connect();
	try {
		await client.query(`
			DROP SCHEMA public CASCADE;
			CREATE SCHEMA public;
			GRANT ALL ON SCHEMA public TO public;
		`);
	} finally {
		await client.end();
	}
}

export async function withClient<T>(
	connectionString: string,
	work: (client: Client) => Promise<T>,
): Promise<T> {
	const client = new Client({ connectionString });
	await client.connect();
	try {
		return await work(client);
	} finally {
		await client.end();
	}
}
