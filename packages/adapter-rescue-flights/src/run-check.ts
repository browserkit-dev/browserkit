/**
 * Scraper runner for agent-check.
 *
 * Calls the rescue-flights adapter tools over MCP HTTP (port 52746).
 * The adapter's own Patchright browser does all the work — no second
 * browser process is spawned here.
 *
 * Requires: `browserkit start` to be running with @browserkit/adapter-rescue-flights.
 *
 * Writes agent-check-results.json to the repo root and exits 0.
 * Visual pass/fail is determined by the agent via /agent-check.
 */
import { writeFileSync } from "node:fs";
import { createTestMcpClient } from "@browserkit/core/testing";

const ADAPTER_URL = "http://127.0.0.1:52746/mcp";

async function callTool(
  client: Awaited<ReturnType<typeof createTestMcpClient>>,
  name: string,
  args: Record<string, unknown>
) {
  const result = await client.callTool(name, args);
  if (result.isError) throw new Error(result.content[0]?.text ?? "tool error");
  const text = result.content[0]?.text ?? "[]";
  return JSON.parse(text);
}

async function main() {
  let client: Awaited<ReturnType<typeof createTestMcpClient>> | null = null;

  try {
    client = await createTestMcpClient(ADAPTER_URL);
  } catch {
    console.error(`\nCannot connect to rescue-flights adapter at ${ADAPTER_URL}`);
    console.error("Make sure the adapter is running:  browserkit start\n");
    process.exit(1);
  }

  const errors: Record<string, string> = {};

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      const arr = Array.isArray(result) ? result : [];
      console.log(`  ✓ ${label}: ${arr.length} entries`);
      return arr;
    } catch (err) {
      const msg = (err as Error).message;
      errors[label] = msg;
      console.log(`  ✗ ${label}: ${msg}`);
      return [];
    }
  };

  console.log(`\nConnected to adapter at ${ADAPTER_URL}`);
  console.log("Calling tools...");

  const [elal_to_israel, elal_from_israel, israir_to_tlv, israir_from_tlv] =
    await Promise.all([
      run("elal to_israel",       () => callTool(client!, "get_elal_flights",    { direction: "to_israel" })),
      run("elal from_israel",     () => callTool(client!, "get_elal_flights",    { direction: "from_israel" })),
      run("israir to_tel_aviv",   () => callTool(client!, "get_israir_flights",  { direction: "to_tel_aviv" })),
      run("israir from_tel_aviv", () => callTool(client!, "get_israir_flights",  { direction: "from_tel_aviv" })),
    ]);

  await client.close();

  const results = {
    timestamp: new Date().toISOString(),
    elal:   { to_israel: elal_to_israel,  from_israel: elal_from_israel },
    israir: { to_tel_aviv: israir_to_tlv, from_tel_aviv: israir_from_tlv },
    errors,
  };

  const outPath = `${process.cwd()}/agent-check-results.json`;
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to agent-check-results.json`);
  console.log("Now use /agent-check to verify against live browser screenshots.\n");
}

main().catch((err) => {
  console.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
