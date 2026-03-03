import * as vscode from 'vscode';
import { PromptIssue } from './types';

function mapSeverity(severity: PromptIssue['severity']): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
  }
}

export function issuesToDiagnostics(
  issues: PromptIssue[],
  document: vscode.TextDocument
): vscode.Diagnostic[] {
  const lineCount = document.lineCount;

  return issues.map((issue) => {
    // Clamp line numbers to valid range (convert 1-indexed to 0-indexed)
    const startLine = Math.max(0, Math.min(issue.startLine - 1, lineCount - 1));
    const endLine = Math.max(startLine, Math.min(issue.endLine - 1, lineCount - 1));

    const startChar = 0;
    const endChar = document.lineAt(endLine).text.length;

    const range = new vscode.Range(startLine, startChar, endLine, endChar);

    const diagnostic = new vscode.Diagnostic(
      range,
      issue.message,
      mapSeverity(issue.severity)
    );

    diagnostic.code = issue.code;
    diagnostic.source = 'agentlint';

    // Suggestion appears in hover tooltip
    diagnostic.message = `${issue.message}\n\nSuggestion: ${issue.suggestion}`;

    return diagnostic;
  });
}
