import * as vscode from 'vscode';

export type LanguageBinding = {
  key: string;
  label: string;
  languageId: string;
  recommendedExtensionId: string;
  semanticTokenTypeCount: number;
};

type ContributedLanguage = { id?: unknown; aliases?: unknown };

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readContributedLanguages(ext: vscode.Extension<unknown>): Array<{ id: string; label?: string }> {
  const pkg = ext.packageJSON as { contributes?: unknown } | undefined;
  const contributes = pkg?.contributes as { languages?: unknown } | undefined;
  const raw = asArray(contributes?.languages);
  const out: Array<{ id: string; label?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as ContributedLanguage;
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    if (!id) continue;
    const aliases = asArray(obj.aliases).filter((x) => typeof x === 'string') as string[];
    const label = aliases.length > 0 ? (aliases[0] ?? '').trim() : undefined;
    out.push({ id, label: label || undefined });
  }
  return out;
}

function getSemanticTokenTypeCount(ext: vscode.Extension<unknown>): number {
  const pkg = ext.packageJSON as { contributes?: unknown } | undefined;
  const contributes = pkg?.contributes as { semanticTokenTypes?: unknown } | undefined;
  const raw = asArray(contributes?.semanticTokenTypes);
  // semanticTokenTypes 可能是 string[] 或 { id, ... }[]
  let count = 0;
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) count += 1;
    else if (item && typeof item === 'object' && !Array.isArray(item) && typeof (item as any).id === 'string') count += 1;
  }
  return count;
}

/**
 * 自动发现：扫描已安装扩展，若其 contributes.semanticTokenTypes 非空，则把它声明的语言（contributes.languages）
 * 加入语言列表。若多个扩展声明同一个 languageId，选择 semanticTokenTypes 数量更多的那个。
 */
export function discoverSemanticTokenLanguageBindings(): LanguageBinding[] {
  const bestByLanguageId = new Map<string, LanguageBinding>();

  for (const ext of vscode.extensions.all) {
    const semanticCount = getSemanticTokenTypeCount(ext);
    if (semanticCount <= 0) continue;

    const languages = readContributedLanguages(ext);
    if (languages.length === 0) continue;

    for (const lang of languages) {
      const languageId = lang.id;
      const label = lang.label || languageId;
      const candidate: LanguageBinding = {
        key: languageId,
        label,
        languageId,
        recommendedExtensionId: ext.id,
        semanticTokenTypeCount: semanticCount
      };

      const existing = bestByLanguageId.get(languageId);
      if (!existing || existing.semanticTokenTypeCount < candidate.semanticTokenTypeCount) {
        bestByLanguageId.set(languageId, candidate);
      }
    }
  }

  return [...bestByLanguageId.values()].sort((a, b) => a.label.localeCompare(b.label));
}
