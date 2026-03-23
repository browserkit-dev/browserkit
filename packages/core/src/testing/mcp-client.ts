import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export interface TestMcpClient {
  /** List all tools registered on the server. */
  listTools(): Promise<Array<{ name: string; description?: string }>>;
  /** Call a tool by name and return its result. */
  callTool(name: string, args?: Record<string, unknown>): Promise<McpToolResult>;
  /** Close the client transport. */
  close(): Promise<void>;
}

/**
 * Create a connected MCP test client pointed at the given server URL.
 * Performs the MCP initialize handshake automatically.
 */
export async function createTestMcpClient(url: string): Promise<TestMcpClient> {
  const client = new Client(
    { name: "browserkit-test-client", version: "0.1.0" },
    { capabilities: {} }
  );

  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);

  return {
    async listTools() {
      const result = await client.listTools();
      return result.tools.map((t) => ({ name: t.name, description: t.description }));
    },

    async callTool(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      return {
        content: result.content as McpToolResult["content"],
        isError: (result.isError as boolean | undefined) ?? false,
      };
    },

    async close() {
      await client.close();
    },
  };
}
