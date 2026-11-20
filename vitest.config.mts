import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(new URL("./tests/unit/stubs/server-only.ts", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": src } },
  test: {
    projects: [
      {
        resolve: { alias: { "@": src, "server-only": serverOnlyStub } },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          // Simula un navegador en otro país: la app debe usar la zona del espacio.
          env: { TZ: "Asia/Tokyo" },
        },
      },
      {
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/db/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
