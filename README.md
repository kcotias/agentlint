<!-- ![Version](https://img.shields.io/visual-studio-marketplace/v/promptlint.promptlint) -->
<!-- ![License](https://img.shields.io/github/license/promptlint/promptlint) -->

# PromptLint

**Your AI agent only follows the instructions it actually understands.** PromptLint finds the ones it won't — vague rules, hedging language, bloated files, leaked secrets, conflicting constraints — and shows you exactly how to fix them. In your editor, on every save, before they cost you tokens or debugging time.

The first linter built specifically for AI agent instruction files.

<!-- TODO: Add hero GIF showing CLAUDE.md with inline diagnostics + quick-fix applied -->

## The Problem

You write a 300-line CLAUDE.md. Claude ignores half of it. You don't know which half.

Anthropic's research shows instruction adherence **degrades uniformly** beyond ~200 lines. Hedging language like "try to" and "consider" is treated as optional. Vague instructions waste token budget on things Claude already does by default. And a single leaked API key in your instruction file is one `git push` away from a production incident.

You'd never ship code without a linter. Why are you shipping AI instructions without one?

## What It Does

PromptLint runs **two phases of analysis** on your agent instruction files:

**Phase 1 — Local Rules (free, instant, every save)**
13 deterministic rules catch the most common problems with zero API cost:

| Rule | Severity | What It Catches |
|------|----------|-----------------|
| `SENSITIVE_DATA` | Error | API keys, tokens, private keys in instruction files |
| `SKILL_MISSING_FRONTMATTER` | Error | SKILL.md without required name/description |
| `SKILL_INVALID_NAME` | Error | Name format violations (case, hyphens, length) |
| `FILE_TOO_LONG` | Warning | Files exceeding Anthropic's recommended limits |
| `HEDGING_LANGUAGE` | Warning | "try to", "consider", "if possible" — treated as optional |
| `VAGUE_INSTRUCTION` | Warning | "write clean code", "follow best practices" — Claude already does this |
| `MISSING_COMMANDS` | Warning | No build/test/lint commands — the #1 most valuable content |
| `SKILL_TOKEN_BUDGET` | Warning | SKILL.md body exceeding ~5,000 token budget |
| `PROSE_PARAGRAPH` | Info | Dense prose blocks — bullets are parsed more reliably |
| `DISCOVERABLE_INFO` | Info | File-by-file descriptions Claude discovers by reading your code |
| `MISSING_NEGATIVE_CONSTRAINTS` | Info | No NEVER/MUST NOT rules — the #2 most effective instruction type |

Most rules have **one-click quick-fixes** — look for the lightbulb icon.

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

1. Install from the VS Code marketplace (search "PromptLint")
2. Open any supported file — diagnostics appear instantly
3. That's it. No configuration required for local rules.

For deep analysis, add your Anthropic API key:

```json
// .vscode/settings.json
{
  "promptlint.anthropicApiKey": "sk-ant-..."
}
```

Or set the `ANTHROPIC_API_KEY` environment variable.

## AI-Readiness Report

Run **`PromptLint: AI-Readiness Report`** from the command palette to get a full workspace audit:

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

Switching to Claude Code? Run **`PromptLint: Migrate to CLAUDE.md`** to convert:

- `.cursorrules` → `CLAUDE.md`
- `.cursor/rules/*.mdc` → `CLAUDE.md`
- `.github/copilot-instructions.md` → `CLAUDE.md`
- `AGENTS.md` → `CLAUDE.md`

PromptLint auto-categorizes your existing content into proper CLAUDE.md sections (Commands, Architecture, Constraints, Gotchas, Verification) and flags anything it can't classify for manual review.

## Agent Context Export

Run **`PromptLint: Export Agent Context`** to see exactly what your AI agent reads — every instruction file in Claude's load order, with token counts per file.

Think of it as "View Source" for your agent's brain:

- Files shown in **priority order** (project CLAUDE.md → scoped rules → local overrides → skills)
- Each file tagged: always loaded, path-scoped, on-demand, or other-tool-only
- Full content with token estimates and metadata extraction

## Templates

Start from best practices instead of a blank file:

| Command | Creates |
|---------|---------|
| `PromptLint: Create CLAUDE.md from Template` | Skeleton with 7 research-backed sections |
| `PromptLint: Create SKILL.md from Template` | Agent Skill with valid frontmatter and structure |
| `PromptLint: Create .claude/rules/ File` | Path-scoped rule with glob pattern |

## All Commands

| Command | Description |
|---------|-------------|
| `PromptLint: Analyze Current File` | Run full analysis on the active file |
| `PromptLint: AI-Readiness Report` | Workspace-wide audit with score and roadmap |
| `PromptLint: Migrate to CLAUDE.md` | Convert .cursorrules or other formats |
| `PromptLint: Export Agent Context` | View all instruction files in load order |
| `PromptLint: Create CLAUDE.md from Template` | Generate best-practices skeleton |
| `PromptLint: Create SKILL.md from Template` | Generate Agent Skill file |
| `PromptLint: Create .claude/rules/ File` | Generate path-scoped rule |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `promptlint.anthropicApiKey` | `""` | Anthropic API key for deep analysis. Falls back to `ANTHROPIC_API_KEY` env var. |
| `promptlint.model` | `claude-sonnet-4-20250514` | Claude model for deep analysis. |

## How It Works

PromptLint activates automatically when you open a workspace containing agent instruction files. On every file save and open:

1. **Detects** the file type (CLAUDE.md, .cursorrules, SKILL.md, etc.)
2. **Runs local rules** — 13 deterministic checks, instant, free
3. **Shows diagnostics** inline in the editor with severity icons
4. **Offers quick-fixes** via the lightbulb menu
5. **Optionally enriches** with Claude API deep analysis (if API key configured)
6. **Updates the status bar** with file type and issue count

The AI-Readiness Report scans your entire workspace, computes a weighted score with bonuses and penalties, determines your maturity level, and generates a prioritized adoption roadmap.

## Built On Research

PromptLint's rules aren't opinions — they're based on documented findings:

- **Anthropic's CLAUDE.md documentation** — file hierarchy, recommended structure, line limits
- **Boris Cherny's best practices** (Claude Code tech lead) — verification gives 2-3x quality improvement
- **Agent Skills specification** (agentskills.io) — progressive disclosure, token budgets, frontmatter requirements
- **LLM instruction adherence research** — adherence degrades uniformly beyond recommended limits
- **RFC 2119 keyword effectiveness** — MUST/NEVER/ALWAYS followed more reliably than hedging language

## Contributing

Issues and PRs welcome. See the [GitHub repository](https://github.com/promptlint/promptlint).

## License

MIT
