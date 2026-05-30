import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.join(__dirname, "..", "..", "agents");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

interface SpawnStreamEvents {
  onAssistantDelta?: (text: string) => void;
  onToolUse?: (name: string, args: string) => void;
  onToolResult?: () => void;
  onError?: (text: string) => void;
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a CLI harness, parse its JSON event stream, and report progress
 * via the onUpdate callback. Returns the full stdout + exit code on completion.
 */
function runHarnessWithStreaming(
  opts: SpawnOptions,
  streamEvents: SpawnStreamEvents,
  onUpdate?: (msg: { content: { type: "text"; text: string }[]; details?: Record<string, unknown> }) => void,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "1", ...opts.env },
    });

    let stdout = "";
    let stderr = "";
    let lastContent = "";

    const emitProgress = (newContent: string) => {
      if (newContent !== lastContent) {
        lastContent = newContent;
        onUpdate?.({
          content: [{ type: "text", text: newContent }],
        });
      }
    };

    // Parse JSON-stream lines
    const processLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);

        // Gemini stream-json events
        if (event.type === "message" && event.role === "assistant" && event.content) {
          streamEvents.onAssistantDelta?.(event.content);
          emitProgress(event.content);
        } else if (event.type === "tool_use") {
          streamEvents.onToolUse?.(event.tool_name, JSON.stringify(event.parameters || {}));
          emitProgress(`🛠  ${event.tool_name}(${JSON.stringify(event.parameters || {})})`);
        } else if (event.type === "tool_result") {
          streamEvents.onToolResult?.();
        } else if (event.type === "error" && event.message) {
          streamEvents.onError?.(event.message);
          emitProgress(`⚠️  Error: ${event.message}`);
        }
      } catch {
        // non-JSON lines — likely raw terminal output
      }
    };

    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    if (opts.signal) {
      opts.signal.addEventListener(
        "abort",
        () => {
          child.kill("SIGTERM");
        },
        { once: true },
      );
    }

    child.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
    child.on("error", (err) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// Harness runners
// ---------------------------------------------------------------------------

interface HarnessRunParams {
  task: string;
  cwd: string;
  model?: string;
  approvalMode?: string;
}

async function runGeminiAgent(
  params: HarnessRunParams,
  signal: AbortSignal | undefined,
  onUpdate: Function | undefined,
): Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
  details: Record<string, unknown>;
}> {
  const args = [
    "-p",
    params.task,
    "--approval-mode",
    params.approvalMode ?? "yolo",
    "--output-format",
    "stream-json",
  ];
  if (params.model) {
    args.push("-m", params.model);
  }

  let lastAssistantText = "";
  let lastToolName = "";
  let lastToolArgs = "";
  let toolCallCount = 0;

  const result = await runHarnessWithStreaming(
    {
      command: "gemini",
      args,
      cwd: params.cwd,
      signal,
    },
    {
      onAssistantDelta: (text) => {
        lastAssistantText += text;
      },
      onToolUse: (name, args) => {
        toolCallCount++;
        lastToolName = name;
        lastToolArgs = args;
      },
    },
    onUpdate as any,
  );

  if (result.exitCode !== 0 && !lastAssistantText) {
    return {
      content: [{ type: "text", text: `Gemini Agent failed with exit code ${result.exitCode}\n\n${result.stderr}` }],
      isError: true,
      details: { stderr: result.stderr, exitCode: result.exitCode },
    };
  }

  return {
    content: [{ type: "text", text: lastAssistantText || "Task completed." }],
    details: {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      toolCallCount,
      lastToolName,
      lastToolArgs,
    },
  };
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // Symlink agent profiles on session start for pi-subagents discovery
  pi.on("session_start", () => {
    const agentsTargetDir = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".pi",
      "agent",
      "agents",
    );
    if (!fs.existsSync(AGENTS_DIR) || !fs.existsSync(agentsTargetDir)) return;

    try {
      const files = fs.readdirSync(AGENTS_DIR);
      for (const file of files) {
        if (file.endsWith(".md")) {
          const src = path.join(AGENTS_DIR, file);
          const dest = path.join(agentsTargetDir, file);
          if (!fs.existsSync(dest)) {
            fs.symlinkSync(src, dest);
          }
        }
      }
    } catch {
      // best-effort symlink for subagent discovery
    }
  });

  // -----------------------------------------------------------------------
  // gemini_agent tool
  // -----------------------------------------------------------------------
  pi.registerTool({
    name: "gemini_agent",
    label: "Gemini Agent",
    description:
      "Delegate a task to Gemini CLI — best suited for documentation research and writing, " +
      "codebase analysis (1M-token context window), planning and architecture review, " +
      "quick prototyping, multi-modal analysis (images, PDFs, audio), and research " +
      "with web-grounded answers via Google Search. Use when Gemini's real-time " +
      "search grounding, large context, or multi-modal input are beneficial, or when " +
      "the user explicitly asks for Gemini. For complex multi-file refactoring or " +
      "production-grade code, prefer the current model or Claude Code instead.",
    promptSnippet: "Research, documentation, codebase analysis, and rapid prototyping via Gemini CLI",
    promptGuidelines: [
      "Use gemini_agent for documentation research and writing — Gemini's Google Search grounding gives it real-time access to current docs, APIs, and library versions.",
      "Use gemini_agent for codebase analysis and architecture review — its 1M-token context window can load entire repositories in one pass.",
      "Use gemini_agent for planning, prototyping, and multi-modal analysis (images, PDFs, audio).",
      "Use gemini_agent when the user explicitly asks for Gemini or agent mode.",
      "Do NOT use gemini_agent for complex multi-file refactoring — Gemini tends to get stuck in tool call loops on those tasks. Prefer the current model or Claude Code instead.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "The task to delegate to Gemini" }),
      cwd: Type.Optional(
        Type.String({ description: "Working directory for the agent (defaults to current directory)" }),
      ),
      model: Type.Optional(Type.String({ description: "Optional Gemini model override (e.g. gemini-2.5-pro)" })),
      approval_mode: Type.Optional(
        StringEnum(["yolo", "auto_edit", "default", "plan"] as const, {
          description:
            "Approval mode. 'yolo' is fully autonomous, 'auto_edit' auto-approves file edits, " +
            "'default' asks before each action, 'plan' only plans without executing.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const task = params.task;
      const cwd = params.cwd || ctx.cwd;

      return runGeminiAgent(
        {
          task,
          cwd,
          model: params.model,
          approvalMode: params.approval_mode,
        },
        signal,
        onUpdate,
      );
    },
  });

  // -----------------------------------------------------------------------
  // /gemini command
  // -----------------------------------------------------------------------
  pi.registerCommand("gemini", {
    description: "Run Gemini CLI harness. Best for documentation research & writing, codebase analysis, planning, and prototyping. Usage: /gemini [--model <id>] <task>",
    handler: async (args, ctx) => {
      let task = args.trim();
      if (!task) {
        ctx.ui.notify("Usage: /gemini [--model <id>] <task>", "error");
        return;
      }

      let model: string | undefined;
      const modelMatch = task.match(/(?:--model|-m)\s+(\S+)/);
      if (modelMatch) {
        model = modelMatch[1];
        task = task.replace(modelMatch[0], "").trim();
      }

      if (!task) {
        ctx.ui.notify("Usage: /gemini [--model <id>] <task>", "error");
        return;
      }

      ctx.ui.notify(`Starting Gemini Agent${model ? ` (${model})` : ""}...`, "info");
      pi.sendUserMessage(
        `Run gemini_agent with this task: "${task}"${model ? `, model: "${model}"` : ""}`,
      );
    },
  });
}
