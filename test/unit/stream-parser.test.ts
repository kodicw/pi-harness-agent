/**
 * Test: Stream JSON Parser
 *
 * Tests the streaming JSON parsing logic that processes Gemini CLI's
 * stream-json output format. This is the core parsing logic extracted
 * from the extension, run standalone without pi dependencies.
 */
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

// ---------------------------------------------------------------------------
// Inline copy of the stream parser from extensions/harness-agent/index.ts
// ---------------------------------------------------------------------------

interface ParsedEvent {
  type: "assistant_delta" | "tool_use" | "tool_result" | "error";
  content?: string;
  toolName?: string;
  toolArgs?: string;
  message?: string;
}

/**
 * Creates a streaming JSON parser for Gemini CLI's stream-json output.
 * Returns a feed function that accepts raw chunks and accumulates ParsedEvents.
 * Deduplicates consecutive identical assistant content.
 */
function createStreamParser(): {
  feed: (chunk: string) => ParsedEvent[];
  flush: () => ParsedEvent[];
} {
  let buffer = "";
  let lastContent = "";
  const collected: ParsedEvent[] = [];
  let collectedIndex = 0;

  const parseLine = (line: string): ParsedEvent | null => {
    if (!line.trim()) return null;
    try {
      const event = JSON.parse(line);
      if (event.type === "message" && event.role === "assistant" && event.content) {
        if (event.content !== lastContent) {
          lastContent = event.content;
          return { type: "assistant_delta" as const, content: event.content };
        }
        return null; // dedup
      }
      if (event.type === "tool_use") {
        return {
          type: "tool_use" as const,
          toolName: event.tool_name,
          toolArgs: JSON.stringify(event.parameters || {}),
        };
      }
      if (event.type === "tool_result") {
        return { type: "tool_result" as const };
      }
      if (event.type === "error" && event.message) {
        return { type: "error" as const, message: event.message };
      }
    } catch {
      // Non-JSON line – ignore
    }
    return null;
  };

  return {
    feed(chunk: string): ParsedEvent[] {
      const before = collectedIndex;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const parsed = parseLine(line);
        if (parsed) collected.push(parsed);
      }
      const result = collected.slice(before);
      collectedIndex = collected.length;
      return result;
    },
    flush(): ParsedEvent[] {
      const before = collectedIndex;
      if (buffer.trim()) {
        const parsed = parseLine(buffer);
        if (parsed) collected.push(parsed);
        buffer = "";
      }
      const result = collected.slice(before);
      collectedIndex = collected.length;
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Stream JSON Parser", () => {
  test("parses assistant message events", () => {
    const parser = createStreamParser();

    const events = parser.feed('{"type":"message","role":"assistant","content":"Hello world"}\n');

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "assistant_delta");
    assert.equal((events[0] as any).content, "Hello world");
  });

  test("parses tool_use events", () => {
    const parser = createStreamParser();

    const events = parser.feed(
      '{"type":"tool_use","tool_name":"bash","parameters":{"command":"ls"}}\n',
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "tool_use");
    assert.equal((events[0] as any).toolName, "bash");
    assert.equal((events[0] as any).toolArgs, '{"command":"ls"}');
  });

  test("parses tool_result events", () => {
    const parser = createStreamParser();

    const events = parser.feed('{"type":"tool_result"}\n');

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "tool_result");
  });

  test("parses error events", () => {
    const parser = createStreamParser();

    const events = parser.feed('{"type":"error","message":"Something went wrong"}\n');

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.equal((events[0] as any).message, "Something went wrong");
  });

  test("handles partial chunks (line buffering)", () => {
    const parser = createStreamParser();

    const r1 = parser.feed('{"type":"message","role":"assistant",');
    assert.equal(r1.length, 0, "no events on partial chunk");

    const r2 = parser.feed('"content":"Partial"}\n');
    assert.equal(r2.length, 1);
    assert.equal(r2[0].type, "assistant_delta");
    assert.equal((r2[0] as any).content, "Partial");
  });

  test("handles content split across chunk boundaries", () => {
    const parser = createStreamParser();

    parser.feed('{"type":"message","role":"assistant","content":"Hello ');
    const r2 = parser.feed('world"}\n');

    assert.equal(r2.length, 1);
    assert.equal((r2[0] as any).content, "Hello world");
  });

  test("ignores non-JSON lines (raw terminal output)", () => {
    const parser = createStreamParser();

    const events = parser.feed("[0m[32m$ ls[0m\n");

    assert.equal(events.length, 0);
  });

  test("handles multiple events in one chunk", () => {
    const parser = createStreamParser();

    const events = parser.feed(
      '{"type":"message","role":"assistant","content":"Hi"}\n{"type":"tool_use","tool_name":"bash","parameters":{"command":"ls"}}\n',
    );

    assert.equal(events.length, 2);
    assert.equal(events[0].type, "assistant_delta");
    assert.equal((events[0] as any).content, "Hi");
    assert.equal(events[1].type, "tool_use");
    assert.equal((events[1] as any).toolName, "bash");
  });

  test("deduplicates consecutive identical assistant content", () => {
    const parser = createStreamParser();

    parser.feed('{"type":"message","role":"assistant","content":"Hello"}\n');
    const r2 = parser.feed('{"type":"message","role":"assistant","content":"Hello"}\n');

    // Second identical content should NOT produce an event (dedup)
    assert.equal(r2.length, 0);
  });

  test("allows new content after dedup", () => {
    const parser = createStreamParser();

    parser.feed('{"type":"message","role":"assistant","content":"Hello"}\n');
    const r2 = parser.feed('{"type":"message","role":"assistant","content":"Hello world"}\n');

    assert.equal(r2.length, 1);
    assert.equal((r2[0] as any).content, "Hello world");
  });

  test("flush processes remaining buffer", () => {
    const parser = createStreamParser();

    parser.feed('{"type":"message","role":"assistant","content":"No newline"}');
    const events = parser.flush();

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "assistant_delta");
    assert.equal((events[0] as any).content, "No newline");
  });

  test("handles empty input gracefully", () => {
    const parser = createStreamParser();

    assert.equal(parser.feed("").length, 0);
    assert.equal(parser.feed("\n").length, 0);
    assert.equal(parser.feed("").length, 0);
  });
});
