import pino from "pino";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

function buildLogger(): pino.Logger {
  const level = process.env["LOG_LEVEL"] ?? "info";
  const isTest = process.env["NODE_ENV"] === "test" || process.env["NODE_ENV"] === "production";
  if (!isTest) {
    try {
      _require.resolve("pino-pretty");
      return pino({ level, transport: { target: "pino-pretty", options: { colorize: true } } });
    } catch {
      // pino-pretty not installed — fall through to plain JSON logs
    }
  }
  return pino({ level });
}

const root = buildLogger();

export function getLogger(name: string): pino.Logger {
  return root.child({ component: name });
}
