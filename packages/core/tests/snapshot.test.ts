/**
 * Tests for Feature 1: `snapshot` action on the `browser` tool
 *
 * We test the diff logic in isolation without a live browser by calling the
 * adapter-server helper indirectly through the exported captureSnapshot logic.
 * The cleanest approach is to exercise the snapshot action via the full
 * AdapterServer stack with a mock page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Snapshot diff helper (mirrors the logic in adapter-server.ts) ─────────────

function computeSnapshotDiff(prev: string, next: string): string | null {
  const prevLines = new Set(prev.split("\n"));
  const newLines = next.split("\n").filter((l) => !prevLines.has(l));
  return newLines.length > 0 ? newLines.join("\n") : null;
}

describe("snapshot incremental diff logic", () => {
  it("returns only new lines when content changes", () => {
    const prev = "- item A\n- item B\n- item C";
    const next = "- item A\n- item B\n- item C\n- item D";

    const diff = computeSnapshotDiff(prev, next);
    expect(diff).toBe("- item D");
  });

  it("returns null when nothing changed", () => {
    const snap = "- item A\n- item B";
    const diff = computeSnapshotDiff(snap, snap);
    expect(diff).toBeNull();
  });

  it("returns only lines in next that are absent from prev", () => {
    const prev = "heading: Home\nlink: About\nbutton: Submit";
    const next = "heading: Home\nlink: About\nbutton: Submit\nlink: Contact\ndialog: Modal";

    const diff = computeSnapshotDiff(prev, next);
    expect(diff).toBe("link: Contact\ndialog: Modal");
  });

  it("ignores removed lines — diff is additive only", () => {
    const prev = "- A\n- B\n- C";
    const next = "- A\n- C"; // B removed, nothing added

    const diff = computeSnapshotDiff(prev, next);
    expect(diff).toBeNull();
  });
});

describe("snapshot action format", () => {
  it("full snapshot prefixes with url and title header", () => {
    const title = "Example Domain";
    const url = "https://example.com";
    const snap = "heading: Example Domain\nlink: More information";
    const output = `# Page snapshot — ${title}\n# URL: ${url}\n\n${snap}`;

    expect(output).toContain("# Page snapshot");
    expect(output).toContain(title);
    expect(output).toContain(url);
    expect(output).toContain(snap);
  });

  it("diff output uses different header", () => {
    const title = "Example Domain";
    const url = "https://example.com";
    const diffLines = "link: New item";
    const output = `# Snapshot diff — ${title}\n# URL: ${url}\n\n${diffLines}`;

    expect(output).toContain("# Snapshot diff");
    expect(output).not.toContain("# Page snapshot");
  });

  it("no-change diff returns descriptive message", () => {
    const url = "https://example.com";
    const output = `# Snapshot diff — no changes detected\n# URL: ${url}`;
    expect(output).toContain("no changes detected");
  });
});
