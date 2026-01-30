import * as vscode from 'vscode';

export function isExtensionInstalled(extensionId: string): boolean {
  return vscode.extensions.getExtension(extensionId) !== undefined;
}

export function getSemanticTokenTypesFromExtension(extensionId: string): string[] {
  const ext = vscode.extensions.getExtension(extensionId);
  if (!ext) {
    return [];
  }
  const pkg = ext.packageJSON as { contributes?: unknown } | undefined;
  const contributes = pkg?.contributes as { semanticTokenTypes?: unknown } | undefined;
  return normalizeSemanticTokenTypes(contributes?.semanticTokenTypes);
}

// semanticTokenTypes 可能是 string[] 或 { id: string }[]（取 id）
function normalizeSemanticTokenTypes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const output: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      output.push(item.trim());
      continue;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const obj = item as { id?: unknown };
      if (typeof obj.id === 'string' && obj.id.trim()) {
        output.push(obj.id.trim());
      }
    }
  }
  return [...new Set(output)].sort();
}

