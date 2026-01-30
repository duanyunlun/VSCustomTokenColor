import { TokenStyle, TokenStyleRules } from './profile';

export type VsCodeTextMateRule = {
  name?: string;
  scope: string | string[];
  settings: {
    foreground?: string;
    fontStyle?: string;
  };
};

export function parseVsCodeTextMateRuleSettings(value: unknown): TokenStyle | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const obj = value as { foreground?: unknown; fontStyle?: unknown };
  const style: TokenStyle = {};
  if (typeof obj.foreground === 'string' && obj.foreground.trim()) {
    style.foreground = obj.foreground.trim();
  }
  if (typeof obj.fontStyle === 'string' && obj.fontStyle.trim()) {
    applyFontStyleFlags(style, obj.fontStyle);
  }
  if (!style.foreground && !style.bold && !style.italic && !style.underline) {
    return undefined;
  }
  return style;
}

function applyFontStyleFlags(style: TokenStyle, fontStyle: string): void {
  const parts = fontStyle
    .split(/\s+/g)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  for (const p of parts) {
    if (p === 'bold') style.bold = true;
    if (p === 'italic') style.italic = true;
    if (p === 'underline') style.underline = true;
  }
}

export function toVsCodeTextMateRules(rules: TokenStyleRules, options?: { namePrefix?: string }): VsCodeTextMateRule[] {
  const namePrefix = options?.namePrefix ?? 'tokenstyler';
  const output: VsCodeTextMateRule[] = [];
  for (const [scope, style] of Object.entries(rules)) {
    const scopeKey = (scope || '').trim();
    if (!scopeKey) continue;
    const settings = toTextMateSettings(style);
    if (!settings) continue;
    output.push({
      name: `${namePrefix}:${scopeKey}`,
      scope: scopeKey,
      settings
    });
  }
  return output;
}

function toTextMateSettings(style: TokenStyle): { foreground?: string; fontStyle?: string } | undefined {
  const hasAnyStyleFlag = style.bold !== undefined || style.italic !== undefined || style.underline !== undefined;
  const fontStyle = hasAnyStyleFlag ? buildFontStyle(style) : undefined;
  if (!style.foreground && fontStyle === undefined) {
    return undefined;
  }
  const out: { foreground?: string; fontStyle?: string } = {};
  if (style.foreground) out.foreground = style.foreground;
  if (fontStyle !== undefined) out.fontStyle = fontStyle;
  return out;
}

function buildFontStyle(style: TokenStyle): string {
  const parts: string[] = [];
  if (style.bold) parts.push('bold');
  if (style.italic) parts.push('italic');
  if (style.underline) parts.push('underline');
  return parts.join(' ');
}

