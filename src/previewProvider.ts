import * as vscode from 'vscode';
import { getPreviewContentForLanguageId } from './previewSnippets';

export class TokenStylerPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  public update(uri: vscode.Uri): void {
    this.onDidChangeEmitter.fire(uri);
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const params = new URLSearchParams(uri.query || '');
    const languageId = params.get('lang') || '';
    return getPreviewContentForLanguageId(languageId);
  }
}
