import { Pool } from "pg";
import { config } from "./config.js";

export const db = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
});

export type AgentRow = {
  id: number;
  wallet_address: string;
  agent_name: string;
  smart_account_address: string | null;
  delegation_json: unknown | null;
  created_at: Date;
  updated_at: Date;
};

export async function closeDb(): Promise<void> {
  await db.end();
}
