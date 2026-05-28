import { defineConfig } from "prisma/config";
import "dotenv/config";

export default defineConfig({
  earlyAccess: true,
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrate: {
    async adapter(env) {
      const { PrismaPg } = await import("@prisma/adapter-pg");
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({
        connectionString: env.DATABASE_URL,
      });
      return new PrismaPg(pool);
    },
  },
});
