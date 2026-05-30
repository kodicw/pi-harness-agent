/**
 * Test: Agent Profile Validation
 *
 * Validates the agent profile markdown files in agents/
 * are properly structured for pi-subagents discovery.
 */
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.resolve(__dirname, "..", "..", "agents");

interface AgentProfile {
  filename: string;
  name: string;
  description: string;
  tools: string[];
  systemPrompt: string;
  hasOutputFormat: boolean;
}

describe("Agent Profiles", () => {
  const files = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
  const profiles: AgentProfile[] = [];

  for (const file of files) {
    const filePath = path.join(AGENTS_DIR, file);
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n");

    // Parse YAML frontmatter
    const frontmatterEnd = raw.indexOf("---", 3); // skip opening ---
    const frontmatter = raw.slice(3, frontmatterEnd).trim();
    const content = raw.slice(frontmatterEnd + 3).trim();

    const name = frontmatter.match(/name:\s*(.+)/)?.[1]?.trim() || "";
    const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim() || "";
    const toolsRaw =
      frontmatter.match(/tools:\s*(.+)/)?.[1]?.trim() || "";
    const tools = toolsRaw.split(",").map((t) => t.trim()).filter(Boolean);

    profiles.push({
      filename: file,
      name,
      description,
      tools,
      systemPrompt: content,
      hasOutputFormat: content.includes("## Completed"),
    });
  }

  test("should have exactly 3 agent profiles", () => {
    assert.equal(profiles.length, 3, "Expected 3 agent files");
    const names = profiles.map((p) => p.filename).sort();
    assert.deepEqual(names, [
      "gemini-coder.md",
      "gemini-researcher.md",
      "gemini.md",
    ]);
  });

  test("all profiles should have a name", () => {
    for (const p of profiles) {
      assert.ok(p.name, `${p.filename}: missing name`);
    }
  });

  test("all profiles should have a description", () => {
    for (const p of profiles) {
      assert.ok(p.description, `${p.filename}: missing description`);
    }
  });

  test('all profiles should reference only built-in tools', () => {
    const builtinTools = new Set(["bash", "read", "write", "edit", "grep", "find", "ls"]);
    for (const p of profiles) {
      for (const tool of p.tools) {
        assert.ok(
          builtinTools.has(tool),
          `${p.filename}: "${tool}" is not a built-in tool`,
        );
      }
    }
  });

  test('all profiles should have "gemini_agent" NOT in the tools list', () => {
    for (const p of profiles) {
      assert.ok(
        !p.tools.includes("gemini_agent"),
        `${p.filename}: should NOT include gemini_agent in tools`,
      );
    }
  });

  test("all profiles should have a system prompt", () => {
    for (const p of profiles) {
      assert.ok(
        p.systemPrompt.length > 50,
        `${p.filename}: system prompt too short (${p.systemPrompt.length} chars)`,
      );
    }
  });

  test("all profiles should have an output format section", () => {
    for (const p of profiles) {
      assert.ok(p.hasOutputFormat, `${p.filename}: missing ## Completed output format`);
    }
  });

  test("profile name should match filename convention", () => {
    for (const p of profiles) {
      const stem = p.filename.replace(".md", "");
      assert.ok(
        p.name.startsWith(stem) || stem.startsWith(p.name),
        `${p.filename}: name "${p.name}" doesn't match filename stem "${stem}"`,
      );
    }
  });

  test("each profile should have unique name", () => {
    const names = profiles.map((p) => p.name);
    assert.equal(new Set(names).size, names.length, "Duplicate profile names");
  });

  test("descriptions should be non-trivial (>20 chars)", () => {
    for (const p of profiles) {
      assert.ok(
        p.description.length > 20,
        `${p.filename}: description too short`,
      );
    }
  });

  test("all profiles should use proper YAML frontmatter (--- delimiters)", () => {
    for (const file of files) {
      const raw = fs.readFileSync(path.join(AGENTS_DIR, file), "utf8");
      assert.ok(raw.startsWith("---"), `${file}: missing opening ---`);
      assert.ok(raw.includes("---", 3), `${file}: missing closing ---`);
    }
  });
});
