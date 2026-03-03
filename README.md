# AgentLint

**Your AI agent only follows the instructions it actually understands.** AgentLint finds the ones it won't — vague rules, hedging language, bloated files, leaked secrets, conflicting constraints — and shows you exactly how to fix them.

The first linter built specifically for AI agent instruction files. Works in your editor, on every save, in CI, and from the command line.

## The Problem

You write a 300-line CLAUDE.md. Claude ignores half of it. You don't know which half.

Anthropic's research shows instruction adherence **degrades uniformly** beyond ~200 lines. Hedging language like "try to" and "consider" is treated as optional. Vague instructions waste token budget on things Claude already does by default. And a single leaked API key in your instruction file is one `git push` away from a production incident.

You'd never ship code without a linter. Why are you shipping AI instructions without one?

## What It Does

AgentLint runs **two phases of analysis** on your agent instruction files:

**Phase 1 — Local Rules (free, instant, every save)**
67 deterministic rules across 15 categories catch problems with zero API cost:

| Category | Rules | What It Catches |
|----------|-------|-----------------|
| **structure** | 5 | File length limits, missing commands, missing constraints, discoverable info, tool-specific context limits |
| **language** | 3 | Hedging language, vague instructions, dense prose blocks |
| **security** | 1 | API keys, tokens, passwords, private keys |
| **skill** | 10 | Frontmatter validation, name format, description quality, token budget, dangerous auto-invoke, triggers |
| **imports** | 3 | Missing imports, circular references, unresolved paths |
| **xml** | 3 | Malformed XML/HTML blocks, unclosed tags, entity encoding |
| **links** | 3 | Broken relative links, external URLs in instructions, anchor references |
| **prompt** | 5 | Contradictory instructions, repeated rules, instruction ordering, ambiguous scope, token-wasting patterns |
| **hooks** | 4 | Hook configuration issues, missing error handling, unsafe commands, permission gaps |
| **agents** | 4 | Multi-agent coordination issues, missing handoff protocols, role ambiguity, context sharing |
| **mcp** | 5 | MCP server configuration, tool naming, schema validation, error handling, transport issues |
| **cursor** | 5 | Cursor-specific rule formatting, MDC frontmatter, glob patterns, rule conflicts, deprecated patterns |
| **copilot** | 3 | Copilot instruction format, scope issues, conflicting settings |
| **crossPlatform** | 5 | Tool-specific syntax used across platforms, incompatible directives, migration hints |
| **memory** | 8 | CLAUDE.local.md hygiene, secrets in local files, stale references, override conflicts, file length |

Most rules have **one-click quick-fixes** in VS Code — look for the lightbulb icon.

**Phase 2 — Deep Analysis (optional, requires API key)**
Claude reviews your instruction file for semantic issues that rules can't catch: conflicting instructions, redundant linting rules, stale file references, missing verification steps, instruction overload.

## Supported Files

| File | Tool | Auto-detected |
|------|------|---------------|
| `CLAUDE.md` | Claude Code | Yes |
| `CLAUDE.local.md` | Claude Code | Yes |
| `.claude/rules/*.md` | Claude Code | Yes |
| `SKILL.md` | Agent Skills | Yes |
| `AGENTS.md` | Multi-agent | Yes |
| `.cursorrules` | Cursor | Yes |
| `.cursor/rules/*.mdc` | Cursor | Yes |
| `.github/copilot-instructions.md` | GitHub Copilot | Yes |

## Quick Start

### VS Code / Cursor

1. Install from the marketplace (search "AgentLint")
2. Open any supported file — diagnostics appear instantly
3. That's it. No configuration required for local rules.

For deep analysis, add your Anthropic API key:

```json
// .vscode/settings.json
{
  "agentlint.anthropicApiKey": "sk-ant-..."
}
```

Or set the `ANTHROPIC_API_KEY` environment variable.

### CLI

```bash
# Lint current directory
npx agentlint

# Lint a specific file
npx agentlint CLAUDE.md

# Auto-fix fixable issues
npx agentlint --fix

# Show readiness score
npx agentlint --score

# JSON output for scripting
npx agentlint --format json

# Errors only (suppress warnings/info)
npx agentlint --quiet

# Create a config file
npx agentlint --init

# List all 67 rules
npx agentlint --list-rules
```

**Exit codes:** `0` no errors, `1` lint errors found, `2` fatal error.

### GitHub Actions

```yaml
- uses: kcotias/agentlint@v1
```

Full example with all options:

```yaml
name: Lint Agent Instructions
on: [push, pull_request]

jobs:
  agentlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: kcotias/agentlint@v1
        with:
          path: '.'              # Directory to scan (default: repo root)
          strict: 'false'        # Treat warnings as errors
          score: 'true'          # Show readiness score
          annotate: 'true'       # Inline PR annotations
          config: ''             # Path to .agentlint.json
          fail-on-warning: 'false'
```

The action outputs `score`, `errors`, `warnings`, and `total` for use in subsequent steps.

## Configuration

Create a `.agentlint.json` in your project root (or run `npx agentlint --init`):

```json
{
  "disabledRules": ["PROSE_PARAGRAPH"],
  "disabledCategories": ["copilot"],
  "severityOverrides": {
    "HEDGING_LANGUAGE": "error",
    "FILE_TOO_LONG": "info"
  },
  "overrides": [
    {
      "files": ".claude/rules/*.md",
      "disabledRules": ["FILE_TOO_LONG"]
    }
  ]
}
```

In VS Code, you can also point to a specific config file:

```json
// .vscode/settings.json
{
  "agentlint.configPath": "configs/.agentlint.json"
}
```

## AI-Readiness Report

Run **`AgentLint: AI-Readiness Report`** from the VS Code command palette, or use `npx agentlint --score` from the CLI:

- **Score (0-100)** — bonus points for good practices, penalties for bad ones
- **Maturity Level (L0-L6)** — from Absent to Adaptive
- **Token Budget** — how many tokens your instruction files consume, per file
- **Penalties Breakdown** — which issues are actively hurting your score
- **Adoption Roadmap** — prioritized steps to improve, tailored to your current level

A bloated, poorly-written CLAUDE.md scores **lower** than having no CLAUDE.md at all. The score rewards quality, not quantity.

### Maturity Levels

| Level | Name | What It Means |
|-------|------|---------------|
| L0 | Absent | No agent instruction files |
| L1 | Basic | File exists, may need work |
| L2 | Scoped | Uses RFC 2119 language (MUST, NEVER, ALWAYS) |
| L3 | Structured | Multiple files split by concern |
| L4 | Abstracted | Path-scoped rules via `.claude/rules/` |
| L5 | Maintained | Comprehensive setup, regularly updated |
| L6 | Adaptive | Agent Skills + dynamic loading + full ecosystem |

## Cross-Tool Migration

Switching to Claude Code? Run **`AgentLint: Migrate to CLAUDE.md`** to convert:

- `.cursorrules` → `CLAUDE.md`
- `.cursor/rules/*.mdc` → `CLAUDE.md`
- `.github/copilot-instructions.md` → `CLAUDE.md`
- `AGENTS.md` → `CLAUDE.md`

AgentLint auto-categorizes your existing content into proper CLAUDE.md sections (Commands, Architecture, Constraints, Gotchas, Verification) and flags anything it can't classify for manual review.

## Agent Context Export

Run **`AgentLint: Export Agent Context`** to see exactly what your AI agent reads — every instruction file in Claude's load order, with token counts per file.

- Files shown in **priority order** (project CLAUDE.md → scoped rules → local overrides → skills)
- Each file tagged: always loaded, path-scoped, on-demand, or other-tool-only
- Full content with token estimates and metadata extraction

## Templates

Start from best practices instead of a blank file:

| Command | Creates |
|---------|---------|
| `AgentLint: Create CLAUDE.md from Template` | Skeleton with 7 research-backed sections |
| `AgentLint: Create SKILL.md from Template` | Agent Skill with valid frontmatter and structure |
| `AgentLint: Create .claude/rules/ File` | Path-scoped rule with glob pattern |

## VS Code Commands

| Command | Description |
|---------|-------------|
| `AgentLint: Analyze Current File` | Run full analysis on the active file |
| `AgentLint: AI-Readiness Report` | Workspace-wide audit with score and roadmap |
| `AgentLint: Migrate to CLAUDE.md` | Convert .cursorrules or other formats |
| `AgentLint: Export Agent Context` | View all instruction files in load order |
| `AgentLint: Create CLAUDE.md from Template` | Generate best-practices skeleton |
| `AgentLint: Create SKILL.md from Template` | Generate Agent Skill file |
| `AgentLint: Create .claude/rules/ File` | Generate path-scoped rule |

## VS Code Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `agentlint.anthropicApiKey` | `""` | Anthropic API key for deep analysis. Falls back to `ANTHROPIC_API_KEY` env var. |
| `agentlint.model` | `claude-sonnet-4-20250514` | Claude model for deep analysis. |
| `agentlint.configPath` | `""` | Path to `.agentlint.json` config file. Relative to workspace root. |

## How It Works

AgentLint activates automatically when you open a workspace containing agent instruction files. On every file open and edit (with 1s debounce):

1. **Detects** the file type (CLAUDE.md, .cursorrules, SKILL.md, etc.)
2. **Runs 67 local rules** across 15 categories — instant, free
3. **Shows diagnostics** inline in the editor with severity icons
4. **Offers quick-fixes** via the lightbulb menu
5. **Optionally enriches** with Claude API deep analysis (if API key configured)
6. **Updates the status bar** with file type and issue count

The AI-Readiness Report scans your entire workspace, computes a weighted score with bonuses and penalties, determines your maturity level, and generates a prioritized adoption roadmap.

## Built On Research

AgentLint's rules aren't opinions — they're based on documented findings:

- **Anthropic's CLAUDE.md documentation** — file hierarchy, recommended structure, line limits
- **Boris Cherny's best practices** (Claude Code tech lead) — verification gives 2-3x quality improvement
- **Agent Skills specification** (agentskills.io) — progressive disclosure, token budgets, frontmatter requirements
- **LLM instruction adherence research** — adherence degrades uniformly beyond recommended limits
- **RFC 2119 keyword effectiveness** — MUST/NEVER/ALWAYS followed more reliably than hedging language

## License

MIT
