import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import type { TestProject } from "vitest/node";

export const TEMPLATE_DB = "wattalis_template";
const root = path.resolve(import.meta.dirname, "../..");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      srv.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

export async function applySqlFiles(client: pg.Client, files: string[]) {
  for (const file of files) {
    const sql = await readFile(file, "utf8");
    try {
      await client.query(sql);
    } catch (error) {
      const e = error as Error & { position?: string; where?: string };
      throw new Error(`Error al aplicar ${path.relative(root, file)}: ${e.message}${e.where ? `\n${e.where}` : ""}`);
    }
  }
}

export async function migrationFiles(): Promise<string[]> {
  const dir = path.join(root, "supabase/migrations");
  return (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(dir, f));
}

export default async function setup(project: TestProject) {
  const port = await freePort();
  const databaseDir = path.join(root, ".tmp", `pg-${process.pid}-${Date.now()}`);
  await mkdir(path.dirname(databaseDir), { recursive: true });

  const server = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password: "postgres",
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "max_connections=200", "-c", "fsync=off", "-c", "timezone=UTC"],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();

  const admin = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();

  const template = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: TEMPLATE_DB });
  await template.connect();
  await applySqlFiles(template, [path.join(root, "tests/db/supabase-shim.sql"), ...(await migrationFiles())]);
  await template.end();

  project.provide("pg", { host: "127.0.0.1", port, user: "postgres", password: "postgres", template: TEMPLATE_DB });

  return async () => {
    await server.stop();
    await rm(databaseDir, { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    pg: { host: string; port: number; user: string; password: string; template: string };
  }
}
