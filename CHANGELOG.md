# Changelog

## 0.2.0

### AI-Readiness Report Overhaul

- **Executive Summary** — score, grade, cost, savings, and top 3 actions at a glance
- **Token Cost Analysis** — per-file $/month cost breakdown (always-loaded vs conditional vs on-demand), with annual projections
- **Savings Estimation** — actionable optimizations with concrete $/month savings per fix
- **AI Tool Fit** — scores your setup across Claude Code, Cursor, and GitHub Copilot; detects "multi-tool ready" projects
- **Maturity Levels** — renamed L0-L6 (Unconfigured, Foundation, Intentional, Organized, Context-Aware, Optimized, Autonomous) with progress bar visualization
- **Roadmap by Effort Tier** — Quick Wins / Medium Effort / Strategic, each with points recoverable and monthly savings
- **"Why It Hurts" explanations** — every penalty now includes 2-3 sentences of research-backed detail
- **CLI `--report` flag** — `npx agentlint --report` outputs the full readiness report to stdout

### Scoring Fixes

- Section detection now aggregates across ALL agent files (not just CLAUDE.md)
- `.cursor/rules/` files correctly classified as conditionally-loaded (not always-loaded)
- Grade thresholds adjusted (D starts at 40, not 50)
- Points format fixed: `+15` for found, `0 of 15` for missing

### Architecture

- Refactored monolithic `readinessScanner.ts` into modular `src/readiness/` directory
- Pure core with no VS Code dependency — shared between extension and CLI
- Deleted old `readinessScanner.ts`

## 0.1.0

Initial release.

- 67 lint rules across 15 categories
- VS Code extension with real-time diagnostics and quick-fixes
- CLI with `--fix`, `--score`, `--format json/github`, `--strict`, `--quiet`
- GitHub Action for CI
- Deep analysis via Claude API (optional)
- Cross-tool migration (Cursor/Copilot -> CLAUDE.md)
- Agent context export
- Templates for CLAUDE.md, SKILL.md, .claude/rules/
- Configuration via `.agentlint.json`
