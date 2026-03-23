import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, closeDb } from "../db.js";

async function main() {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  const sqlDir = join(thisDir, "..", "..", "sql");
  const files = (await readdir(sqlDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sqlPath = join(sqlDir, file);
    const sql = readFileSync(sqlPath, "utf8");
    await db.query(sql);
    console.log(`Migration complete: sql/${file}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
