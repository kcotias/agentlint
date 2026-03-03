# CLAUDE.md Best Practices — Research & Linting Rules Reference

> Compiled from Anthropic official docs, Boris Cherny (Claude Code creator), HumanLayer, Builder.io, Addy Osmani, Theo/t3.gg, DEV Community, and academic research. Last updated: March 2026.

---

## 1. Anthropic Official Guidance

### File Hierarchy & Precedence

| Scope | Location | Purpose | Shared? |
|---|---|---|---|
| Managed policy | `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS) | Org-wide, managed by IT | All users |
| Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Team-shared via git | Team via source control |
| User | `~/.claude/CLAUDE.md` | Personal, all projects | Just you |
| Local | `./CLAUDE.local.md` | Personal per-project, gitignored | Just you |

- More specific files take precedence over broader ones
- Files walk up directory tree from CWD
- Subdirectory CLAUDE.md files load on-demand when Claude reads files in those dirs
- `.claude/rules/` files support path-specific scoping via YAML frontmatter
- Imports use `@path/to/file` syntax, max 5 hops deep

### Official Size & Structure Rules

- **Target under 200 lines per CLAUDE.md file** — longer files consume more context and reduce adherence
- Use markdown headers and bullets to group related instructions
- Write instructions that are concrete enough to verify
- If two rules contradict, Claude picks one arbitrarily — review periodically
- You can add emphasis (e.g., "IMPORTANT" or "YOU MUST") to improve adherence
- CLAUDE.md fully survives `/compact` — it's re-read from disk

### Official Include vs. Exclude

| Include | Exclude |
|---|---|
| Bash commands Claude can't guess | Anything Claude can figure out by reading code |
| Code style rules that differ from defaults | Standard conventions Claude already knows |
| Testing instructions, preferred runners | Detailed API docs (link instead) |
| Repo etiquette (branch naming, PRs) | Info that changes frequently |
| Architectural decisions | Long explanations or tutorials |
| Dev environment quirks | File-by-file codebase descriptions |
| Common gotchas | Self-evident practices like "write clean code" |

### The Golden Rule (from official best practices page)

> "Keep it concise. For each line, ask: 'Would removing this cause Claude to make mistakes?' If not, cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions!"

---

## 2. Boris Cherny (Claude Code Creator)

Source: howborisusesclaudecode.com, @bcherny threads

- Shared team CLAUDE.md checked into git, updated multiple times/week
- **Iterative correction:** "Anytime we see Claude do something incorrectly we add it to the CLAUDE.md"
- Uses Opus 4.5 with thinking for everything — less steering = faster overall
- Starts in Plan mode (shift+tab), iterates on plan, then auto-accept
- Slash commands for every inner-loop workflow (`.claude/commands/`)
- **Verification is #1 priority:** "Give Claude a way to verify its work — 2-3x quality improvement"
- His setup is "surprisingly vanilla" — doesn't over-customize
- Runs 5 parallel Claudes locally + 5-10 on claude.ai/code
- Uses hooks for auto-formatting after generation and deterministic checks

---

## 3. HumanLayer Blog — Key Findings

Source: humanlayer.dev/blog/writing-a-good-claude-md

- **Instruction capacity limit:** Frontier LLMs follow ~150-200 instructions with reasonable consistency. Claude Code's system prompt already has ~50, leaving limited capacity for yours.
- **Degradation is uniform** — ALL instructions degrade as count increases, not just newer ones.
- **Don't use `/init` for high-stakes files** — manual crafting yields better results for this high-leverage file.
- **Never delegate code style to LLMs** — use deterministic tools (Biome, ESLint). Style guidelines bloat context and degrade performance.
- **Progressive disclosure:** Create `agent_docs/` directory with detailed files, reference them briefly. Use `file:line` pointers instead of copying code.
- **Claude's relevance filter:** The system injects "this context may or may not be relevant." The more universally applicable your content, the less likely it gets filtered.
- **HumanLayer's own root file: fewer than 60 lines.**

---

## 4. The "Delete Your CLAUDE.md" Debate (Feb 2026)

### Theo (t3.gg) — The Provocative Claim

Video: "Delete your CLAUDE.md (and your AGENT.md too)" — youtube.com/watch?v=GcNu6wrLTJc

Cites two studies:
1. **Lulla et al. (ICSE JAWs 2026):** 124 real GitHub PRs. AGENTS.md reduced runtime 28.64% and tokens 16.58%, but did NOT measure correctness.
2. **ETH Zurich (2602.11988):** LLM-generated files reduced success by 2-3%, increased costs 20%+. Developer-written files improved success by only ~4% but increased costs up to 19%.

When documentation was stripped from repos, auto-generated context files improved performance by 2.7% — proving the content was redundant with what existed in the codebase.

### Community Counter-Arguments

- **Addy Osmani:** Don't use `/init`. Only include what agents can't discover by reading code. Treat AGENTS.md as a "living list of codebase smells you haven't fixed yet."
- **Tessl.io:** "The problem isn't context files — it's that nobody measures them." Run evals: agents with vs. without specific instructions.
- **Charly Wargnier (@DataChaz):** "Auto-generated files are bloated. Handcrafted, concise files with non-obvious information still help."

### The Consensus

The debate isn't "files bad" — it's "bloated, undiscriminating files bad." The winning pattern: lean, handcrafted, only non-discoverable information, measured and iterated.

---

## 5. Maturity Model (DEV Community)

Source: dev.to/cleverhoods — "CLAUDE.md Best Practices: From Basic to Adaptive"

| Level | Name | Key Feature |
|---|---|---|
| L0 | Absent | No file |
| L1 | Basic | File exists, may be auto-generated boilerplate |
| L2 | Scoped | Uses RFC 2119 language: MUST, MUST NOT, NEVER |
| L3 | Structured | Multiple files split by concern, cross-referenced |
| L4 | Abstracted | Path-scoped loading, different rules per code area |
| L5 | Maintained | L4 + staleness tracking, regular review cadence |
| L6 | Adaptive | Dynamic loading via skills and MCP |

Key insight: RFC 2119 keywords work better than colloquial suggestions because they map to agent behavioral patterns.

---

## 6. Recommended Sections (Consensus Across All Sources)

1. **Project Context** — One-liner orientation ("Next.js e-commerce app with Stripe")
2. **Commands** — Exact, copy-paste build/test/lint/deploy commands with flags
3. **Code Style** — Only conventions NOT enforced by existing tooling
4. **Architecture** — Directory map with purpose per directory
5. **Gotchas** — Non-obvious behaviors, critical files not to modify, integration quirks
6. **Negative Constraints** — Explicit "NEVER do X" rules (highly effective)
7. **Cross-References** — `@path/to/file` for detailed docs

---

## 7. Anti-Patterns (Consensus)

1. **Over-specified file** — Too long → Claude ignores half. If >200 lines, prune.
2. **Auto-generated boilerplate** — `/init` output without customization adds noise.
3. **Duplicating linter/formatter rules** — Use deterministic tools; don't waste LLM context.
4. **Vague instructions** — "Write clean code", "follow best practices", "use good naming."
5. **Prose paragraphs** — Dense text instead of scannable bullets.
6. **README content** — Installation guides, badges, human-oriented overviews.
7. **Discoverable info** — File structure descriptions, obvious tech stack info the agent finds by reading code.
8. **Stale references** — Version numbers, deprecated tools, outdated API refs.
9. **Hedging language** — "try to", "consider", "you might want to" for critical behaviors.
10. **Not iterating** — Writing once and never updating. Treat like code.
11. **Hotfix accumulation** — Appending task-specific workarounds that trigger relevance filtering.
12. **Conflicting instructions** — Rules that contradict each other across files.

---

## 8. What Actually Helps (Ranked by Impact)

Based on frequency of mention across all sources:

1. **Exact build/test/lint commands** — Universal #1 recommendation
2. **Negative constraints ("NEVER do X")** — Highly effective at preventing recurring mistakes
3. **Project-specific gotchas** — Non-obvious behaviors agents can't discover alone
4. **Brevity** — Under 200 lines (official), ideally under 60 (HumanLayer)
5. **Imperative mood with RFC 2119 keywords** — "MUST use", not "consider using"
6. **Iterative correction** — Add rules when Claude makes mistakes, prune when unnecessary
7. **Verification instructions** — Tell Claude how to check its own work
8. **Architecture overview** — Where to find things, but brief
9. **Code examples for ambiguous patterns** — Show the right way, not just describe it
10. **Progressive disclosure** — Brief pointers in CLAUDE.md, detail in separate files

---

## 9. Key Numbers

| Metric | Value | Source |
|---|---|---|
| Max recommended lines per file | 200 | Anthropic official |
| LLM instruction capacity | ~150-200 | HumanLayer |
| System prompt instructions already used | ~50 | HumanLayer |
| Auto-generated file success improvement | -2 to -3% | ETH Zurich |
| Developer-written file success improvement | +4% | ETH Zurich |
| Cost increase from context files | +19-20% | ETH Zurich |
| Auto memory MEMORY.md loaded lines | First 200 | Anthropic official |
| Import max depth | 5 hops | Anthropic official |

---

## 10. Sources

- [Anthropic: Memory Documentation](https://code.claude.com/docs/en/memory)
- [Anthropic: Best Practices](https://code.claude.com/docs/en/best-practices)
- [HumanLayer: Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [Builder.io: How to Write a Good CLAUDE.md](https://www.builder.io/blog/claude-md-guide)
- [DEV Community: Maturity Levels L0-L6](https://dev.to/cleverhoods/claudemd-best-practices-from-basic-to-adaptive-9lm)
- [Boris Cherny's Thread](https://x.com/bcherny/status/2007179832300581177)
- [How Boris Uses Claude Code](https://howborisusesclaudecode.com/)
- [Addy Osmani: Stop Using /init](https://addyosmani.com/blog/agents-md/)
- [Tessl: Your AGENTS.md Isn't the Problem](https://tessl.io/blog/your-agentsmd-file-isnt-the-problem-your-lack-of-evals-is/)
- [Theo's Tweet + Video](https://x.com/theo/status/2025900730847232409)
- [Claude Blog: Using CLAUDE.md Files](https://claude.com/blog/using-claude-md-files)
- [Charly Wargnier's Take](https://x.com/DataChaz/status/2026236210444972107)
