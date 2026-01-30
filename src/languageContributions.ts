import * as vscode from 'vscode';

export function isExtensionInstalled(extensionId: string): boolean {
  return vscode.extensions.getExtension(extensionId) !== undefined;
}

export type SemanticTokenContributionItem = {
  id: string;
  description?: string;
  superType?: string;
};

export function getSemanticTokenTypesFromExtension(extensionId: string): string[] {
  return getSemanticTokenTypeItemsFromExtension(extensionId).map((x) => x.id);
}

export function getSemanticTokenTypeItemsFromExtension(extensionId: string): SemanticTokenContributionItem[] {
  return getSemanticTokenContributionItemsFromExtension(extensionId, 'semanticTokenTypes');
}

export function getSemanticTokenModifierItemsFromExtension(extensionId: string): SemanticTokenContributionItem[] {
  return getSemanticTokenContributionItemsFromExtension(extensionId, 'semanticTokenModifiers');
}

function getSemanticTokenContributionItemsFromExtension(
  extensionId: string,
  key: 'semanticTokenTypes' | 'semanticTokenModifiers'
): SemanticTokenContributionItem[] {
  const ext = vscode.extensions.getExtension(extensionId);
  if (!ext) {
    return [];
  }
  const pkg = ext.packageJSON as { contributes?: unknown } | undefined;
  const contributes = pkg?.contributes as { semanticTokenTypes?: unknown; semanticTokenModifiers?: unknown } | undefined;
  const items = normalizeSemanticTokenContributionItems((contributes as any)?.[key]);
  return items;
}

// semanticTokenTypes / semanticTokenModifiers 可能是 string[] 或 { id, description?, superType? }[]
function normalizeSemanticTokenContributionItems(value: unknown): SemanticTokenContributionItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const output: SemanticTokenContributionItem[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      output.push({ id: item.trim() });
      continue;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const obj = item as { id?: unknown; description?: unknown; superType?: unknown };
      if (typeof obj.id === 'string' && obj.id.trim()) {
        const out: SemanticTokenContributionItem = { id: obj.id.trim() };
        if (typeof obj.description === 'string' && obj.description.trim()) {
          out.description = obj.description.trim();
        }
        if (typeof obj.superType === 'string' && obj.superType.trim()) {
          out.superType = obj.superType.trim();
        }
        output.push(out);
      }
    }
  }

  const byId = new Map<string, SemanticTokenContributionItem>();
  for (const x of output) {
    if (!byId.has(x.id)) {
      byId.set(x.id, x);
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
