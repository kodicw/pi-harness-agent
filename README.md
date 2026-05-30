# ρ pi-harness-agent

A [pi coding agent](https://github.com/earendil-works/pi) extension that calls out to **other coding harnesses** like Gemini CLI, Claude Code, and more.

> **Currently implemented:** Gemini CLI Agent mode via `gemini` CLI.
> **Future:** Claude Code, Codex, OpenCode, and other harnesses.

## Features

- 🧠 **`gemini_agent` tool** — Pi's LLM can autonomously delegate multi-file, complex tasks to Gemini CLI.
- 💬 **`/gemini` command** — Manually trigger the Gemini harness from the Pi terminal.
- 📡 **Real-time streaming** — Assistant output and tool usage stream back into Pi's UI.
- 🤖 **Subagent integration** — Agent discovery files for use with [pi-subagents](https://github.com/nicobailon/pi-subagents) chaining.
- 🔌 **Extensible architecture** — Each harness gets its own registered tool, making it easy to add more.

## Prerequisites

- **Pi Coding Agent** installed and configured.
- **Gemini CLI** (`gemini`) installed and authenticated:
  ```bash
  # Install Gemini CLI
  npm install -g @google/gemini-cli
  # Authenticate
  gemini auth login
  ```
- (Optional) **pi-subagents** for agent chaining features.

## Installation

### From GitHub (recommended)

```bash
pi install git:github.com/kodicw/pi-harness-agent
```

### From source (development)

```bash
git clone https://github.com/kodicw/pi-harness-agent
cd pi-harness-agent
pi install . -l  # -l for local project install
```

Or copy the extension directly:

```bash
cp extensions/harness-agent/index.ts ~/.pi/agent/extensions/harness-agent.ts
```

After installing, restart pi or run `/reload`.

## Usage

### As a tool (automatic)

Pi will automatically choose to use `gemini_agent` when it detects a task suited for Gemini's native agent capabilities.

### As a command

```bash
/gemini Refactor the authentication module to use JWT
/gemini -m gemini-2.5-pro Research the latest React Server Components patterns
/gemini --model gemini-2.5-flash Write comprehensive tests for the API layer
```

### With pi-subagents agent chaining

If you have [pi-subagents](https://github.com/nicobailon/pi-subagents) installed:

```bash
/chain gemini-researcher "Analyze the codebase structure" -> gemini-coder "Refactor based on findings"
```

## Agent profiles

The extension provides three proxy agents for pi-subagents:

| Agent | Purpose |
|-------|---------|
| `gemini` | Research, documentation, codebase analysis, and prototyping |
| `gemini-coder` | Documentation writing, API research, quick prototyping |
| `gemini-researcher` | Deep research with web-grounding, large codebase analysis |

## When to use Gemini

Based on developer experience and benchmarks, **Gemini CLI excels at:**

- ✅ **Documentation research & writing** — Google Search grounding means it can pull current API docs, library versions, and tutorials in real-time
- ✅ **Codebase analysis** — 1M-token context window can load entire repositories for architecture review
- ✅ **Planning & architecture** — plan mode for code reviews, dependency analysis, and design docs
- ✅ **Quick prototyping** — fast for isolated scripts, utilities, and exploratory coding
- ✅ **Multi-modal analysis** — can handle images, PDFs, audio (great for reading diagrams, screenshots)
- ✅ **Web-grounded answers** — real-time search during sessions for up-to-date info

**Not recommended for:**
- ❌ Complex multi-file refactoring — Gemini tends to get stuck in tool call loops and produces verbose output

---

_Note: These recommendations are based on developer community reports and benchmarks from early 2026. LLM capabilities evolve rapidly — re-evaluate periodically._

## Architecture

Each coding harness is implemented as a separate registered tool:

```typescript
// Separate tools per harness — clean API, easy to maintain
pi.registerTool({ name: "gemini_agent", ... })
pi.registerTool({ name: "claude_agent", ... })  // future
pi.registerTool({ name: "codex_agent", ... })    // future
```

Each tool:
1. Spawns the CLI harness as a subprocess
2. Parses `stream-json` output events in real-time
3. Streams assistant deltas and tool usage back via `onUpdate`
4. Returns the final result with exit code and metadata

## Adding a new harness

1. Create a runner function in `extensions/harness-agent/index.ts`
2. Register a new tool with `pi.registerTool()`
3. Add a `/command` for manual triggering
4. (Optional) Create an agent profile in `agents/`

## License

MIT
