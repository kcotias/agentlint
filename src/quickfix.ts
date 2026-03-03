import * as vscode from 'vscode';

/**
 * CodeActionProvider for AgentLint quick-fixes.
 * Provides lightbulb actions for fixable diagnostics.
 */
export class AgentLintCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'agentlint') continue;

      // Create quick-fix actions based on the diagnostic code
      switch (diagnostic.code) {
        case 'HEDGING_LANGUAGE':
          actions.push(...this.createHedgingFixes(document, diagnostic));
          break;

        case 'VAGUE_INSTRUCTION':
          actions.push(this.createRemoveLineFix(document, diagnostic, 'Remove vague instruction'));
          break;

        case 'SKILL_MISSING_FRONTMATTER':
          actions.push(this.createInsertFrontmatterFix(document, diagnostic));
          break;

        case 'PROSE_PARAGRAPH':
          actions.push(this.createConvertToBulletsFix(document, diagnostic));
          break;

        case 'SENSITIVE_DATA':
          actions.push(this.createRemoveLineFix(document, diagnostic, 'Remove line with sensitive data'));
          break;

        case 'FILE_TOO_LONG':
          // No auto-fix, but provide a suggestion action
          actions.push(this.createInfoAction(diagnostic, 'Move specialized content to .claude/rules/ or skills'));
          break;

        case 'MISSING_COMMANDS':
          actions.push(this.createInsertCommandsSectionFix(document, diagnostic));
          break;

        case 'MISSING_NEGATIVE_CONSTRAINTS':
          actions.push(this.createInsertConstraintsSectionFix(document, diagnostic));
          break;

        case 'MISSING_PROJECT_CONTEXT':
          actions.push(this.createInsertProjectContextFix(document, diagnostic));
          break;
      }
    }

    return actions;
  }

  private createHedgingFixes(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(diagnostic.range.start.line).text;

    // Common hedging → imperative replacements
    const replacements: Array<{ pattern: RegExp; replacement: string; label: string }> = [
      { pattern: /\btry to\s+/gi, replacement: '', label: 'Remove "try to"' },
      { pattern: /\bconsider\s+(using|adding|implementing)\s+/gi, replacement: 'MUST $1 ', label: 'Replace with "MUST"' },
      { pattern: /\byou might want to\s+/gi, replacement: 'MUST ', label: 'Replace with "MUST"' },
      { pattern: /\bif possible,?\s*/gi, replacement: '', label: 'Remove "if possible"' },
      { pattern: /\bmaybe\s+/gi, replacement: '', label: 'Remove "maybe"' },
      { pattern: /\bperhaps\s+/gi, replacement: '', label: 'Remove "perhaps"' },
      { pattern: /\bshould probably\s+/gi, replacement: 'MUST ', label: 'Replace with "MUST"' },
      { pattern: /\bideally,?\s*/gi, replacement: '', label: 'Remove "ideally"' },
    ];

    for (const { pattern, replacement, label } of replacements) {
      if (pattern.test(line)) {
        const newLine = line.replace(pattern, replacement);
        const action = new vscode.CodeAction(`AgentLint: ${label}`, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(
          document.uri,
          new vscode.Range(diagnostic.range.start.line, 0, diagnostic.range.start.line, line.length),
          newLine
        );
        action.isPreferred = true;
        actions.push(action);
        break; // Only offer the first matching fix
      }
    }

    return actions;
  }

  private createRemoveLineFix(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    title: string
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(`AgentLint: ${title}`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();

    const startLine = diagnostic.range.start.line;
    const endLine = Math.min(diagnostic.range.end.line + 1, document.lineCount);
    action.edit.delete(document.uri, new vscode.Range(startLine, 0, endLine, 0));

    return action;
  }

  private createInsertFrontmatterFix(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'AgentLint: Add SKILL.md frontmatter template',
      vscode.CodeActionKind.QuickFix
    );
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();
    action.edit.insert(
      document.uri,
      new vscode.Position(0, 0),
      '---\nname: my-skill-name\ndescription: What this skill does and when to use it.\n---\n\n'
    );
    action.isPreferred = true;
    return action;
  }

  private createConvertToBulletsFix(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'AgentLint: Convert to bullet points',
      vscode.CodeActionKind.QuickFix
    );
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();

    const startLine = diagnostic.range.start.line;
    const endLine = diagnostic.range.end.line;

    const bulletLines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      const text = document.lineAt(i).text.trim();
      if (text.length > 0) {
        bulletLines.push(`- ${text}`);
      }
    }

    action.edit.replace(
      document.uri,
      new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length),
      bulletLines.join('\n')
    );

    return action;
  }

  private createInsertCommandsSectionFix(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'AgentLint: Add Commands section template',
      vscode.CodeActionKind.QuickFix
    );
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();

    const template = `\n## Commands\n\n- \`npm run build\` — Build the project\n- \`npm test\` — Run all tests\n- \`npm run lint\` — Lint the codebase\n`;

    // Insert at end of file
    const lastLine = document.lineCount - 1;
    action.edit.insert(document.uri, new vscode.Position(lastLine, document.lineAt(lastLine).text.length), template);

    return action;
  }

  private createInsertConstraintsSectionFix(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'AgentLint: Add Constraints section template',
      vscode.CodeActionKind.QuickFix
    );
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();

    const template = `\n## Constraints\n\n- NEVER modify files in \`/config\` without explicit approval\n- MUST NOT commit directly to main branch\n- DO NOT use \`any\` type in TypeScript\n`;

    const lastLine = document.lineCount - 1;
    action.edit.insert(document.uri, new vscode.Position(lastLine, document.lineAt(lastLine).text.length), template);

    return action;
  }

  private createInsertProjectContextFix(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'AgentLint: Add project context line',
      vscode.CodeActionKind.QuickFix
    );
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();
    action.edit.insert(
      document.uri,
      new vscode.Position(0, 0),
      '# Project Name\n\nBrief one-liner: [Framework] [type] app with [key integrations].\n\n'
    );
    return action;
  }

  private createInfoAction(diagnostic: vscode.Diagnostic, title: string): vscode.CodeAction {
    const action = new vscode.CodeAction(`AgentLint: ${title}`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    // No edit — just an informational suggestion
    return action;
  }
}
