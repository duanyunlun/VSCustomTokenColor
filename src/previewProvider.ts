import * as vscode from 'vscode';
import { getPreviewContent } from './previewSnippets';

export class TokenStylerPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  public update(uri: vscode.Uri): void {
    this.onDidChangeEmitter.fire(uri);
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const pathLower = uri.path.toLowerCase();
    if (pathLower.endsWith('.cs')) return getPreviewContent('csharp');
    if (pathLower.endsWith('.java')) return getPreviewContent('java');
    if (pathLower.endsWith('.cpp')) return getPreviewContent('cpp');
    if (pathLower.endsWith('.py')) return getPreviewContent('python');
    if (pathLower.endsWith('.go')) return getPreviewContent('go');
    if (pathLower.endsWith('.rs')) return getPreviewContent('rust');
    return getPreviewContent('generic');
  }
}
