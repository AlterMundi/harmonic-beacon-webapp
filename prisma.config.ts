// Prisma config file for migration and database connection
import { defineConfig } from "prisma/config";

// dotenv is loaded by Next.js in dev; production sets env vars directly.
// Import only in dev to avoid requiring dotenv in the production image.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require("dotenv");
  config({ path: ".env.local" });
  config({ path: ".env" });
} catch {
  // dotenv not available in production; env vars are already set
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
