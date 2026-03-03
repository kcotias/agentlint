# AI Agent Configuration Files — Comprehensive Knowledge Base

> For Circle's Notion AI Space. Compiled from Anthropic official docs, community research, and expert analysis. March 2026.

---

## Table of Contents

1. [The Landscape: Agent Instruction Files](#1-the-landscape)
2. [CLAUDE.md Deep Dive](#2-claudemd-deep-dive)
3. [Agent Skills (SKILL.md)](#3-agent-skills)
4. [.claude/rules/ System](#4-claude-rules-system)
5. [Hooks](#5-hooks)
6. [Subagents](#6-subagents)
7. [Plugins](#7-plugins)
8. [Cross-Tool Ecosystem](#8-cross-tool-ecosystem)
9. [Best Practices & Anti-Patterns](#9-best-practices--anti-patterns)
10. [DevX Pain Points & Solutions](#10-devx-pain-points--solutions)
11. [Maturity Model](#11-maturity-model)
12. [Key Numbers & Metrics](#12-key-numbers--metrics)

---

## 1. The Landscape

Every major AI coding tool now supports project-level configuration files:

| Tool | File(s) | Format | Scope |
|---|---|---|---|
| **Claude Code** | `CLAUDE.md`, `.claude/rules/*.md`, `SKILL.md` | Markdown + YAML frontmatter | Hierarchical (managed → project → user → local) |
| **Cursor** | `.cursor/rules/*.mdc`, `.cursorrules` (legacy) | MDC (Markdown + frontmatter) | Project-wide or path-scoped |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Markdown | Repository-wide |
| **Windsurf** | Global rules + per-workspace | Settings-based | Global or workspace |
| **Aider** | `.aider.conf.yml`, `CONVENTIONS.md` | YAML + Markdown | Project-wide |

**The convergence trend**: Tools are moving toward Markdown-based instruction files with YAML frontmatter for metadata. Anthropic's Agent Skills spec (agentskills.io) is pushing for an open standard across tools.

---

## 2. CLAUDE.md Deep Dive

### File Hierarchy & Precedence

```
Managed policy (IT admin)
  └─ Enterprise CLAUDE.md (/Library/Application Support/ClaudeCode/CLAUDE.md)
    └─ Project CLAUDE.md (./CLAUDE.md or ./.claude/CLAUDE.md)
      └─ User CLAUDE.md (~/.claude/CLAUDE.md)
        └─ Local CLAUDE.md (./CLAUDE.local.md — gitignored)
```

**Rules**: More specific files take precedence. Files walk up directory tree from CWD. Subdirectory CLAUDE.md files load on-demand when Claude reads files in those dirs.

### What to Include

- **Exact build/test/lint commands** with flags (Universal #1 recommendation)
- **Negative constraints** ("NEVER do X") — highly effective
- **Project-specific gotchas** agents can't discover by reading code
- **Architecture overview** — where to find things, briefly
- **Code style rules** NOT enforced by existing tooling
- **Verification instructions** — how Claude checks its own work

### What to Exclude

- Anything Claude discovers by reading code (file structure, obvious patterns)
- Standard conventions Claude already knows
- Linter/formatter rules (use deterministic tools instead)
- Long explanations, tutorials, or prose paragraphs
- Info that changes frequently (version numbers, dates)
- README content (installation guides, badges)

### The Golden Rule

Keep it concise. For each line ask: "Would removing this cause Claude to make mistakes?" If not, cut it.

### Key Constraint: Instruction Capacity

LLMs follow ~150-200 instructions with reasonable consistency. Claude Code's system prompt already uses ~50, leaving limited capacity for user instructions. ALL instructions degrade uniformly as count increases.

---

## 3. Agent Skills (SKILL.md)

### What Are Skills?

Skills are the open standard for extending AI agent capabilities. A skill is a folder with a `SKILL.md` file containing metadata and instructions, optionally bundled with scripts, templates, and reference materials.

**Open spec at**: agentskills.io (developed by Anthropic, adopted by growing ecosystem)

### Directory Structure

```
skill-name/
├── SKILL.md          # Required: instructions + metadata
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
└── assets/           # Optional: templates, resources
```

### SKILL.md Format

```yaml
---
name: pdf-processing            # Required. 1-64 chars, lowercase + hyphens
description: Extract text...    # Required. 1-1024 chars
license: Apache-2.0             # Optional
compatibility: Requires git...  # Optional. 1-500 chars
metadata:                       # Optional. Key-value pairs
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Read # Optional. Space-delimited
---

# Skill Instructions Here
(Markdown body — no format restrictions)
```

### Name Field Rules
- 1-64 characters
- Lowercase alphanumeric + hyphens only
- No starting/ending with hyphen
- No consecutive hyphens
- Must match parent directory name

### Progressive Disclosure (Key Architecture)

1. **Metadata** (~100 tokens): `name` + `description` loaded at startup for ALL skills
2. **Instructions** (<5000 tokens recommended): Full SKILL.md body loaded when skill activates
3. **Resources** (as needed): scripts/, references/, assets/ loaded only when required

**Critical implication**: Keep SKILL.md under 500 lines. Move detailed reference material to separate files.

### Skills vs CLAUDE.md

| Aspect | CLAUDE.md | SKILL.md |
|---|---|---|
| When loaded | Always at session start | On-demand when task matches |
| Token cost | Constant (always in context) | Variable (only when active) |
| Scope | Project configuration | Specific capability/workflow |
| Best for | Universal project rules | Specialized domain knowledge |

**Cost optimization tip**: Move specialized instructions from CLAUDE.md to skills. Keep CLAUDE.md under ~500 lines for essentials only.

### Example Skills (Anthropic Official)

- **docx**: Word document creation/editing
- **pdf**: PDF manipulation, form field extraction
- **pptx**: PowerPoint creation/editing
- **xlsx**: Excel spreadsheet creation/editing
- Community skills: code review, MCP server generation, testing, design

---

## 4. .claude/rules/ System

### Path-Specific Rules

Rules in `.claude/rules/` support path-based scoping via YAML frontmatter:

```yaml
---
description: TypeScript specific rules
globs: "src/**/*.ts"
---

# TypeScript Rules
- MUST use strict mode
- NEVER use `any` type
```

### How It Works

- Rules load conditionally based on which files Claude is working with
- The `globs` field determines which file paths trigger the rule
- Rules without `globs` apply globally
- Useful for different coding standards across monorepo packages

### When to Use Rules vs CLAUDE.md

- **CLAUDE.md**: Universal project rules (commands, architecture, gotchas)
- **.claude/rules/**: Path-specific rules (different standards per directory, language-specific patterns)

---

## 5. Hooks

### What Are Hooks?

Event-driven scripts that run at specific points in Claude's workflow. They enable deterministic behavior without consuming LLM context.

### Hook Events

| Event | When | Use Case |
|---|---|---|
| **PreToolUse** | Before tool execution | Validate, modify, or block tool calls |
| **PostToolUse** | After tool execution | Process output, run formatters |
| **Notification** | Claude needs attention | Desktop notifications |
| **Stop** | Before Claude stops | Validate output, force continuation |
| **SubagentStop** | Subagent completes | Process subagent results |
| **WorktreeCreate** | Worktree created | Custom VCS setup |
| **WorktreeRemove** | Worktree removed | Custom VCS cleanup |

### Hook Types

1. **command**: Run shell scripts
2. **prompt**: Inject text into context
3. **agent**: Spawn another Claude instance

### Configuration (settings.json)

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "npx prettier --write $TOOL_INPUT_FILE_PATH"
      }]
    }]
  }
}
```

### Key Insight for DevX

Hooks are **free** (no token cost) and **deterministic**. Use them for:
- Auto-formatting after edits
- Running linters after code changes
- Filtering verbose test output
- Desktop notifications when Claude needs input
- Blocking dangerous operations

---

## 6. Subagents

### What Are Subagents?

Independent Claude instances spawned for specific tasks. Each runs in its own context window — isolating verbose operations from your main conversation.

### Configuration (.claude/agents/)

```yaml
---
name: test-runner
description: Runs tests and reports results
model: haiku          # Cost-effective for simple tasks
allowed-tools: Bash Read
isolation: worktree   # Optional: isolate file changes
---

# Test Runner Agent
Run the project test suite and report only failures...
```

### Supported Models

- **opus**: Complex reasoning, architectural decisions
- **sonnet** (default): Most coding tasks
- **haiku**: Simple, cost-effective tasks (test running, formatting)

### When to Use Subagents

- Running tests (verbose output stays in subagent context)
- Processing log files
- Fetching documentation
- Any task with large output that would bloat main context

---

## 7. Plugins

### What Are Plugins?

Bundles that combine skills, agents, hooks, and MCP servers into distributable packages.

### Plugin Structure

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json       # Manifest (required)
├── commands/             # Slash commands (.md or SKILL.md)
├── agents/               # Subagent definitions
├── hooks/                # Event hooks
└── scripts/              # Supporting scripts
```

### Plugin Manifest (plugin.json)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "components": {
    "commands": "./commands",
    "agents": "./agents",
    "hooks": { ... }
  }
}
```

### Plugin Marketplaces

- **Official Anthropic marketplace**: Auto-available, maintained by Anthropic
- **Community marketplaces**: GitHub repos with marketplace.json
- **Local marketplaces**: For team-internal distribution

### Notable Official Plugins

**Code Intelligence** (LSP):
- TypeScript, Python, Rust, Go, Java, Kotlin, Swift, C/C++, C#, PHP, Lua

**External Integrations** (MCP):
- GitHub, GitLab, Jira/Confluence, Asana, Linear, Notion, Figma, Vercel, Firebase, Supabase, Slack, Sentry

**Development Workflows**:
- commit-commands, pr-review-toolkit, agent-sdk-dev, plugin-dev

### Plugin Scopes

| Scope | Location | Shared? |
|---|---|---|
| User | ~/.claude/settings.json | Just you |
| Project | .claude/settings.json | Team via git |
| Local | .claude/settings.local.json | Just you |
| Managed | Admin-controlled | Organization |

---

## 8. Cross-Tool Ecosystem

### File Comparison

| Feature | CLAUDE.md | .cursorrules | copilot-instructions.md | AGENTS.md |
|---|---|---|---|---|
| Hierarchy | 4-level (managed→local) | Project-level | Repo-level | Project-level |
| Path scoping | Via .claude/rules/ | Via .cursor/rules/ | No | No |
| Progressive loading | Via skills + rules | Via rule types | No | No |
| Format | Markdown | MDC (Markdown + frontmatter) | Markdown | Markdown |
| Size guidance | <200 lines | No official limit | <500 lines | No official limit |
| Tooling/ecosystem | Skills, hooks, plugins, MCP | Rules, context | Copilot extensions | Varies |

### Cursor Rules System

- `.cursorrules` (legacy, root-level)
- `.cursor/rules/*.mdc` (new, path-scoped)
- Rule types: Always, Auto (glob-matched), Agent Requested, Manual
- MDC format: Markdown with YAML frontmatter (similar to SKILL.md)
- Community: awesome-cursorrules repo with 1000+ community rules

### GitHub Copilot Instructions

- `.github/copilot-instructions.md`
- Simple Markdown, repo-wide scope
- No path scoping or progressive loading
- Kept under 500 lines per GitHub docs

### Convergence Points

All tools are converging on:
1. Markdown as base format
2. YAML frontmatter for metadata
3. Path-based scoping for large codebases
4. Separation of "always loaded" vs "on-demand" context

---

## 9. Best Practices & Anti-Patterns

### Best Practices (Ranked by Impact)

1. **Exact build/test/lint commands** — Universal #1 recommendation
2. **Negative constraints ("NEVER do X")** — Highly effective at preventing recurring mistakes
3. **Project-specific gotchas** — Non-obvious behaviors agents can't discover
4. **Brevity** — Under 200 lines (official), ideally under 60 (HumanLayer)
5. **Imperative mood with RFC 2119 keywords** — "MUST use", not "consider using"
6. **Iterative correction** — Add rules when Claude makes mistakes, prune when unnecessary
7. **Verification instructions** — Tell Claude how to check its own work
8. **Architecture overview** — Where to find things, briefly
9. **Code examples for ambiguous patterns** — Show the right way
10. **Progressive disclosure** — Brief pointers in CLAUDE.md, detail in separate files/skills

### Anti-Patterns (What to Avoid)

1. **Over-specified file** (>200 lines → Claude ignores half)
2. **Auto-generated boilerplate** (/init output without customization)
3. **Duplicating linter/formatter rules** (use deterministic tools)
4. **Vague instructions** ("Write clean code", "follow best practices")
5. **Prose paragraphs** (dense text instead of scannable bullets)
6. **README content** (installation guides, badges, human-oriented overviews)
7. **Discoverable info** (file structure, obvious tech stack)
8. **Stale references** (version numbers, deprecated APIs)
9. **Hedging language** ("try to", "consider", "you might want to")
10. **Not iterating** (writing once and never updating)
11. **Hotfix accumulation** (appending task-specific workarounds)
12. **Conflicting instructions** (rules that contradict across files)

### Boris Cherny's Workflow (Claude Code Creator)

- Shared team CLAUDE.md in git, updated multiple times/week
- "Anytime we see Claude do something incorrectly we add it to the CLAUDE.md"
- Uses Opus with thinking for everything
- Plan mode first (shift+tab), iterate on plan, then auto-accept
- Verification is #1 priority: "2-3x quality improvement"
- Setup is "surprisingly vanilla"
- Uses hooks for auto-formatting and deterministic checks

---

## 10. DevX Pain Points & Solutions

### Pain Point 1: Files Get Bloated Over Time

**Problem**: Teams keep adding rules but never prune. File exceeds 200 lines, instruction adherence degrades uniformly.

**Solutions**:
- Set up regular review cadence (monthly)
- Track staleness with dates/comments
- Move specialized content to skills (loaded on-demand)
- Use path-scoped rules for area-specific content
- Measure: run tasks with vs without specific rules

### Pain Point 2: Auto-Generated Files Are Noise

**Problem**: `/init` and similar generators produce generic content that duplicates discoverable information, increasing costs with minimal benefit (ETH Zurich: -2-3% success).

**Solutions**:
- Never use `/init` for high-stakes files
- Always customize aggressively after generation
- Focus only on non-discoverable information
- PromptLint can detect auto-generated boilerplate patterns

### Pain Point 3: No Feedback Loop

**Problem**: No way to know if instructions are working. "Nobody measures them."

**Solutions**:
- Run evals: agents with vs without specific instructions
- Track which rules prevent errors vs add noise
- Use hooks for deterministic validation (free, no tokens)
- PromptLint provides immediate feedback on quality

### Pain Point 4: Context Window Tax

**Problem**: Every token in CLAUDE.md costs money on every message. Average $6/dev/day, up to $12.

**Solutions**:
- Move specialized instructions to skills (loaded on-demand only)
- Use subagents to isolate verbose operations
- Install LSP plugins for code intelligence (reduces file reads)
- Use hooks to preprocess/filter data before Claude sees it
- Choose appropriate models (Haiku for simple tasks, Sonnet for most, Opus for complex)

### Pain Point 5: Cross-Tool Fragmentation

**Problem**: Teams using multiple tools need separate config files with duplicated content.

**Solutions**:
- Maintain one source of truth, generate tool-specific files
- Agent Skills spec (agentskills.io) pushing for universal standard
- Core best practices are identical across tools
- PromptLint can lint all file types with tool-aware rules

### Pain Point 6: No Quality Standards

**Problem**: No equivalent of ESLint/Prettier for agent instruction files. Quality varies wildly.

**Solutions**:
- PromptLint (this project!) — the first lint tool for agent instruction files
- Hybrid approach: free deterministic checks + LLM-powered nuanced analysis
- Community maturity model (L0-L6) provides aspirational target

---

## 11. Maturity Model

| Level | Name | Key Feature | Example |
|---|---|---|---|
| L0 | Absent | No file | New project, no agent configuration |
| L1 | Basic | File exists | Auto-generated boilerplate from /init |
| L2 | Scoped | RFC 2119 language | MUST, MUST NOT, NEVER used consistently |
| L3 | Structured | Multiple files | Split by concern, cross-referenced |
| L4 | Abstracted | Path-scoped loading | .claude/rules/ with glob patterns |
| L5 | Maintained | Staleness tracking | Regular review cadence, dated entries |
| L6 | Adaptive | Dynamic loading | Skills, MCP, plugins for on-demand context |

---

## 12. Key Numbers & Metrics

| Metric | Value | Source |
|---|---|---|
| Max recommended lines per file | 200 | Anthropic official |
| LLM instruction capacity | ~150-200 | HumanLayer |
| System prompt instructions used | ~50 | HumanLayer |
| Auto-generated file success change | -2 to -3% | ETH Zurich |
| Developer-written file success change | +4% | ETH Zurich |
| Cost increase from context files | +19-20% | ETH Zurich |
| Import max depth | 5 hops | Anthropic official |
| Avg cost per developer per day | $6 | Anthropic official |
| 90th percentile daily cost | $12 | Anthropic official |
| Avg monthly cost per developer | $100-200 | Anthropic official |
| Skill metadata token budget | ~100 tokens | Agent Skills spec |
| Skill instruction budget | <5000 tokens | Agent Skills spec |
| SKILL.md max recommended lines | 500 | Agent Skills spec |
| SKILL.md name max characters | 64 | Agent Skills spec |
| SKILL.md description max characters | 1024 | Agent Skills spec |

---

## Sources

### Anthropic Official
- [Memory Documentation](https://code.claude.com/docs/en/memory)
- [Best Practices](https://code.claude.com/docs/en/best-practices)
- [Skills](https://code.claude.com/docs/en/skills)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Plugins](https://code.claude.com/docs/en/plugins)
- [Plugins Reference](https://code.claude.com/docs/en/plugins-reference)
- [Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Discover Plugins](https://code.claude.com/docs/en/discover-plugins)
- [Settings](https://code.claude.com/docs/en/settings)
- [Features Overview](https://code.claude.com/docs/en/features-overview)
- [Cost Management](https://code.claude.com/docs/en/costs)
- [Agent Skills Spec](https://agentskills.io)
- [Agent Skills: What Are Skills](https://agentskills.io/what-are-skills)
- [Agent Skills: Specification](https://agentskills.io/specification)
- [Example Skills](https://github.com/anthropics/skills)

### Community & Expert
- [HumanLayer: Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [Builder.io: How to Write a Good CLAUDE.md](https://www.builder.io/blog/claude-md-guide)
- [DEV Community: Maturity Levels L0-L6](https://dev.to/cleverhoods/claudemd-best-practices-from-basic-to-adaptive-9lm)
- [Boris Cherny: How Boris Uses Claude Code](https://howborisusesclaudecode.com/)
- [Addy Osmani: Stop Using /init](https://addyosmani.com/blog/agents-md/)
- [Tessl: Your AGENTS.md Isn't the Problem](https://tessl.io/blog/your-agentsmd-file-isnt-the-problem-your-lack-of-evals-is/)
- [Theo: Delete Your CLAUDE.md (Video)](https://youtube.com/watch?v=GcNu6wrLTJc)
- [awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules)
