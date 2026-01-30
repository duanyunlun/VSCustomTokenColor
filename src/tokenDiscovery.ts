import * as vscode from 'vscode';

export const LSP_STANDARD_TOKEN_TYPES: readonly string[] = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'event',
  'function',
  'method',
  'macro',
  'keyword',
  'modifier',
  'comment',
  'string',
  'number',
  'regexp',
  'operator',
  'decorator'
];

export type TokenTypeDiscovery = {
  standard: string[];
  csharp: string[];
  other: { extensionId: string; tokenTypes: string[] }[];
};

const CSHARP_EXTENSION_IDS = new Set<string>([
  'ms-dotnettools.csharp',
  'ms-dotnettools.csdevkit',
  'icsharpcode.ilspy-vscode'
]);

export function discoverTokenTypes(): TokenTypeDiscovery {
  const other: { extensionId: string; tokenTypes: string[] }[] = [];
  const csharpTypes = new Set<string>();

  for (const ext of vscode.extensions.all) {
    const pkg = ext.packageJSON as { contributes?: unknown } | undefined;
    const contributes = pkg?.contributes as { semanticTokenTypes?: unknown } | undefined;
    const contributedTypesRaw = contributes?.semanticTokenTypes;
    const tokenTypes = normalizeSemanticTokenTypes(contributedTypesRaw);
    if (tokenTypes.length === 0) {
      continue;
    }

    if (CSHARP_EXTENSION_IDS.has(ext.id) || ext.id.toLowerCase().includes('csharp')) {
      for (const t of tokenTypes) {
        csharpTypes.add(t);
      }
      continue;
    }

    other.push({ extensionId: ext.id, tokenTypes });
  }

  return {
    standard: [...LSP_STANDARD_TOKEN_TYPES],
    csharp: [...csharpTypes].sort(),
    other: other
      .map((x) => ({ ...x, tokenTypes: [...new Set(x.tokenTypes)].sort() }))
      .sort((a, b) => a.extensionId.localeCompare(b.extensionId))
  };
}

export function isCSharpExtensionInstalled(): boolean {
  for (const ext of vscode.extensions.all) {
    if (CSHARP_EXTENSION_IDS.has(ext.id)) {
      return true;
    }
  }
  return false;
}

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
  return output;
}
