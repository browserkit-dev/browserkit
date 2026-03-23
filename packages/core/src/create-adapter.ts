import fs from "node:fs";
import path from "node:path";

/**
 * Generate a standalone adapter project in the current directory.
 * Invoked via: npx @browserkit/core create-adapter <name>
 */
export function createAdapter(name: string): void {
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    console.error(
      `Error: adapter name must be lowercase alphanumeric with hyphens. Got: "${name}"`
    );
    process.exit(1);
  }

  const outDir = path.join(process.cwd(), `adapter-${name}`);
  if (fs.existsSync(outDir)) {
    console.error(`Error: directory "${outDir}" already exists`);
    process.exit(1);
  }

  fs.mkdirSync(path.join(outDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "tests"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "fixtures"), { recursive: true });

  writeFile(path.join(outDir, "package.json"), packageJson(name));
  writeFile(path.join(outDir, "tsconfig.json"), tsconfig());
  writeFile(path.join(outDir, "vitest.config.ts"), vitestConfig());
  writeFile(path.join(outDir, ".gitignore"), gitignore());
  writeFile(path.join(outDir, "src", "selectors.ts"), selectorsTs(name));
  writeFile(path.join(outDir, "src", "index.ts"), indexTs(name));
  writeFile(path.join(outDir, "tests", `${name}.test.ts`), testTs(name));
  writeFile(path.join(outDir, "README.md"), readme(name));

  console.log(`\nCreated adapter-${name}/\n`);
  console.log(`  src/index.ts        — adapter implementation`);
  console.log(`  src/selectors.ts    — DOM selectors`);
  console.log(`  tests/${name}.test.ts`);
  console.log(`  fixtures/           — store HTML snapshots for tests`);
  console.log(`\nNext steps:`);
  console.log(`  cd adapter-${name}`);
  console.log(`  pnpm install`);
  console.log(`  # Fill in src/selectors.ts and src/index.ts`);
  console.log(`  pnpm test`);
  console.log(`  npm publish\n`);
}

function writeFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf8");
}

function packageJson(name: string): string {
  return JSON.stringify(
    {
      name: `browserkit-adapter-${name}`,
      version: "0.1.0",
      description: `${name} adapter for browserkit`,
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
      scripts: {
        build: "tsc",
        test: "vitest run",
        lint: "tsc --noEmit",
      },
      peerDependencies: {
        "@browserkit/core": ">=0.1.0",
      },
      devDependencies: {
        "@browserkit/core": "^0.1.0",
        "@types/node": "^22.0.0",
        playwright: "^1.51.0",
        tsx: "^4.0.0",
        typescript: "^5.7.0",
        vitest: "^3.0.0",
        zod: "^3.24.0",
      },
    },
    null,
    2
  );
}

function tsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022"],
        strict: true,
        noUncheckedIndexedAccess: true,
        esModuleInterop: true,
        skipLibCheck: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        outDir: "dist",
        rootDir: "src",
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist", "tests"],
    },
    null,
    2
  );
}

function vitestConfig(): string {
  return `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: { NODE_ENV: "test" },
    include: ["tests/**/*.test.ts"],
  },
});
`;
}

function gitignore(): string {
  return `node_modules/
dist/
*.js.map
`;
}

function selectorsTs(name: string): string {
  return `/**
 * DOM selectors for ${name}.
 *
 * Primary strategy: getByRole / getByTestId (resilient to DOM changes).
 * CSS selectors as fallback only.
 *
 * Validate with: browserkit test-selectors ${name}
 * Update fixtures with: browserkit test-selectors ${name} --snapshot
 */

export const SELECTORS = {
  // Auth detection
  loggedInIndicator: "TODO: selector for element that only appears when logged in",
  loginForm: "TODO: selector for login form",

  // Add your selectors here…
} as const;
`;
}

function indexTs(name: string): string {
  const domain = `${name}.com`;
  const loginUrl = `https://www.${domain}/login`;
  return `import { defineAdapter } from "@browserkit/core";
import { z } from "zod";
import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";

export default defineAdapter({
  site: "${name}",
  domain: "${domain}",
  loginUrl: "${loginUrl}",
  rateLimit: { minDelayMs: 2000 },

  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      return await page.locator(SELECTORS.loggedInIndicator).isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  },

  tools: () => [
    {
      name: "get_data",
      description: "TODO: describe what this tool does",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
        count: z.number().int().min(1).max(20).default(10),
      }),
      async handler(page: Page, input: unknown) {
        const { query, count } = input as { query: string; count: number };

        await page.goto(\`https://www.${domain}/?q=\${encodeURIComponent(query)}\`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });

        // TODO: implement extraction logic
        const results: unknown[] = [];

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      },
    },
  ],
});
`;
}

function testTs(name: string): string {
  return `import { describe, it, expect } from "vitest";
import adapter from "../src/index.js";

describe("${name} adapter", () => {
  it("has required fields", () => {
    expect(adapter.site).toBe("${name}");
    expect(adapter.domain).toBe("${name}.com");
    expect(adapter.loginUrl).toMatch(/^https?:\\/\\//);
  });

  it("exposes at least one tool", () => {
    const tools = adapter.tools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it("all tools have required fields", () => {
    for (const tool of adapter.tools()) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.handler).toBe("function");
      expect(tool.inputSchema).toBeDefined();
    }
  });
});
`;
}

function readme(name: string): string {
  return `# browserkit adapter: ${name}

A [browserkit](https://github.com/jzarecki/browserkit) adapter for ${name}.

## Installation

\`\`\`bash
pnpm add @browserkit/core browserkit-adapter-${name}
\`\`\`

## Usage

In \`browserkit.config.ts\`:

\`\`\`typescript
import { defineConfig } from "@browserkit/core";

export default defineConfig({
  adapters: {
    "browserkit-adapter-${name}": { port: 3847 },
  },
});
\`\`\`

Then:

\`\`\`bash
browserkit login ${name}   # log in once
browserkit start           # start the server
\`\`\`

## Tools

| Tool | Description |
|------|-------------|
| \`get_data\` | TODO |

## Development

\`\`\`bash
pnpm install
pnpm test
pnpm run build
\`\`\`
`;
}
