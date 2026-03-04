# AgentLint

**Lint your AI agent instruction files. Find broken rules, cut token waste, and know exactly what you're spending.**

The first linter built specifically for AI agent instruction files. 67 rules catch vague language, security leaks, structural issues, and prompt anti-patterns — then cost analysis shows you exactly how much your context files cost per month and where to save. Works in VS Code and Cursor, across Claude Code, Cursor, and GitHub Copilot instruction files.

## The Problem

You write a 300-line CLAUDE.md. Claude ignores half of it. You don't know which half — but you're paying for all of it.

Hedging language like "try to" is treated as optional. Vague instructions waste tokens on things the AI already does. Contradictory rules cancel each other out. Exposed API keys sit in plain text. And bloated files degrade adherence for ALL your rules — not just the ones at the end. Meanwhile, every token in your always-loaded instruction files is sent with **every single message**, costing **$30-50/month per developer** in input tokens alone.

AgentLint catches the problems you can't see and quantifies the waste in dollars — so you get better AI behavior AND lower costs.

## What You Get

### 67 Lint Rules — Catch What You Can't See

**Phase 1 — Local Rules (free, instant, every save)**

| Category | Rules | What It Catches |
|----------|-------|-----------------|
| **structure** | 5 | File length, missing commands/constraints, discoverable info, context limits |
| **language** | 3 | Hedging language, vague instructions, dense prose |
| **security** | 1 | API keys, tokens, passwords, private keys |
| **skill** | 10 | Frontmatter, name format, description quality, token budget, triggers |
| **imports** | 3 | Missing imports, circular references, unresolved paths |
| **xml** | 3 | Malformed XML/HTML, unclosed tags, entity encoding |
| **links** | 3 | Broken links, external URLs, anchor references |
| **prompt** | 5 | Contradictions, repeated rules, ordering, ambiguous scope, token waste |
| **hooks** | 4 | Config issues, missing error handling, unsafe commands |
| **agents** | 4 | Multi-agent coordination, handoff protocols, role ambiguity |
| **mcp** | 5 | Server config, tool naming, schema validation, transport |
| **cursor** | 5 | MDC frontmatter, glob patterns, rule conflicts, deprecated patterns |
| **copilot** | 3 | Instruction format, scope issues, conflicting settings |
| **crossPlatform** | 5 | Tool-specific syntax across platforms, migration hints |
| **memory** | 8 | Local file hygiene, secrets, stale references, override conflicts |

Most rules have **one-click quick-fixes** in VS Code.

**Phase 2 — Deep Analysis (optional, requires API key)**
Claude reviews your files for semantic issues rules can't catch: conflicting instructions, stale references, missing verification steps, instruction overload.

### Cost Analysis — Know What You're Spending

```
> AgentLint: AI-Readiness Report

## Executive Summary

| Metric                    | Value                                    |
|---------------------------|------------------------------------------|
| AI Readiness Score        | 48/100 (Grade: D)                        |
| Monthly Context Cost      | ~$37.78/developer                        |
| Potential Monthly Savings | ~$8.12/developer (21% reduction)         |
| Best Suited For           | Claude Code (4/10 features)              |

## Token Budget & Cost Impact

| Category         | Files | Tokens  | $/month |
|------------------|-------|---------|---------|
| Always loaded    | 2     | ~5,465  | $27.05  |
| Conditional      | 4     | ~5,417  | ~$10.73 |
| On-demand        | 3     | ~1,432  | ~$0.00  |

### Potential Savings: ~$8.12/month ($97.44/year)

| Optimization                          | Monthly Savings |
|---------------------------------------|-----------------|
| Move specialized content to Skills    | $4.02           |
| Remove 18 discoverable info lines     | $2.48           |
| Convert prose to bullets (12 blocks)  | $1.19           |
| Remove 4 vague/redundant instructions | $0.43           |
```

Every file classified by how it's loaded (always, conditional, on-demand), with per-file $/month cost and concrete savings recommendations.

### AI Tool Fit — Multi-Tool Aware

AgentLint doesn't just lint Claude files. It scores your setup across all three major AI coding tools:

```
| Tool           | Configured | Score |
|----------------|------------|-------|
| Claude Code    | ████░░░░░░ | 4/10  |
| Cursor         | ███        | 3/3   |
| GitHub Copilot | █░         | 1/2   |
```

Detects which tool your codebase is best configured for and flags when you're "multi-tool ready."

### Readiness Score & Maturity Roadmap

**Score (0-100)** with letter grade, combining good-practice bonuses and issue penalties.

**Maturity progression** from L0 to L6:

| Level | Name | What It Means |
|-------|------|---------------|
| L0 | Unconfigured | No AI agent instruction files |
| L1 | Foundation | Agent files exist with basic instructions |
| L2 | Intentional | Uses RFC 2119 language (MUST/NEVER) for reliable compliance |
| L3 | Organized | Multiple files split by concern, good section coverage |
| L4 | Context-Aware | Path-scoped rules load contextually, reducing token waste |
| L5 | Optimized | Comprehensive setup with hooks, MCP, full coverage |
| L6 | Autonomous | Skills + plugins + dynamic loading for on-demand context |

**Adoption roadmap** grouped by effort — Quick Wins, Medium Effort, Strategic — each with points recoverable and $/month savings.

## Supported Files

| File | Tool | Auto-detected |
|------|------|---------------|
| `CLAUDE.md` | Claude Code | Yes |
| `CLAUDE.local.md` | Claude Code | Yes |
| `.claude/rules/*.md` | Claude Code | Yes |
| `.claude/commands/*.md` | Claude Code | Yes |
| `SKILL.md` | Agent Skills | Yes |
| `AGENTS.md` / `*.agent.md` | Multi-agent | Yes |
| `.cursorrules` | Cursor | Yes |
| `.cursor/rules/*.mdc` | Cursor | Yes |
| `.github/copilot-instructions.md` | GitHub Copilot | Yes |

## Quick Start

1. Install from the VS Code marketplace (search **"AgentLint"**)
2. Open any supported file — diagnostics appear instantly with inline warnings and quick-fixes
3. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and explore:

| Command | What It Does |
|---------|-------------|
| `AgentLint: AI-Readiness Report` | Full audit — score, cost analysis, savings, maturity level, and adoption roadmap |
| `AgentLint: Analyze Current File` | Run deep analysis on the active file (requires API key) |
| `AgentLint: Migrate to CLAUDE.md` | Convert `.cursorrules` / Copilot instructions into a structured `CLAUDE.md` |
| `AgentLint: Export Agent Context` | See every instruction file your AI agent loads, in order, with token counts |
| `AgentLint: Create CLAUDE.md from Template` | Scaffold a best-practices `CLAUDE.md` with 7 research-backed sections |
| `AgentLint: Create SKILL.md from Template` | Generate an Agent Skill file with valid frontmatter |
| `AgentLint: Create .claude/rules/ File` | Generate a path-scoped rule with glob pattern |

For deep analysis (Phase 2), add your Anthropic API key:

```json
// .vscode/settings.json
{
  "agentlint.anthropicApiKey": "sk-ant-..."
}
```

Or set the `ANTHROPIC_API_KEY` environment variable.

## Configuration

Create a `.agentlint.json` in your project root:

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

## VS Code Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `agentlint.anthropicApiKey` | `""` | Anthropic API key for deep analysis. Falls back to `ANTHROPIC_API_KEY` env var. |
| `agentlint.model` | `claude-sonnet-4-20250514` | Claude model for deep analysis. |
| `agentlint.configPath` | `""` | Path to `.agentlint.json` config file. Relative to workspace root. |

## Built On Research

AgentLint's rules aren't opinions — they're based on documented findings:

- **Anthropic's CLAUDE.md documentation** — file hierarchy, recommended structure, line limits
- **Boris Cherny's best practices** (Claude Code tech lead) — verification gives 2-3x quality improvement
- **Agent Skills specification** (agentskills.io) — progressive disclosure, token budgets, frontmatter requirements
- **LLM instruction adherence research** — adherence degrades uniformly beyond recommended limits
- **RFC 2119 keyword effectiveness** — MUST/NEVER/ALWAYS followed more reliably than hedging language
- **ETH Zurich study** — auto-generated boilerplate decreases success rates by 2-3%

## License

MIT
