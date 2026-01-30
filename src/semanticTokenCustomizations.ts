import { TokenStyle, TokenStyleRules } from './profile';

export type VsCodeSemanticTokenRuleValue =
  | string
  | {
      foreground?: string;
      fontStyle?: string;
    };

export type VsCodeThemeSemanticTokenCustomization = {
  enabled?: boolean;
  rules?: Record<string, VsCodeSemanticTokenRuleValue>;
};

export function parseVsCodeSemanticTokenRuleValue(value: unknown): TokenStyle | undefined {
  if (typeof value === 'string') {
    const fg = value.trim();
    if (!fg) {
      return undefined;
    }
    return { foreground: fg };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const obj = value as {
    foreground?: unknown;
    fontStyle?: unknown;
    bold?: unknown;
    italic?: unknown;
    underline?: unknown;
  };
  const style: TokenStyle = {};
  if (typeof obj.foreground === 'string' && obj.foreground.trim()) {
    style.foreground = obj.foreground.trim();
  }
  if (typeof obj.fontStyle === 'string' && obj.fontStyle.trim()) {
    applyFontStyleFlags(style, obj.fontStyle);
  }
  // VS Code 在 semanticTokenColorCustomizations.rules 里也支持 bold/italic/underline 布尔值（用户现有配置就是这种结构）
  if (obj.bold === true) style.bold = true;
  if (obj.italic === true) style.italic = true;
  if (obj.underline === true) style.underline = true;
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

export function toVsCodeSemanticTokenRules(rules: TokenStyleRules): Record<string, VsCodeSemanticTokenRuleValue> {
  const output: Record<string, VsCodeSemanticTokenRuleValue> = {};
  for (const [selector, style] of Object.entries(rules)) {
    const ruleValue = toRuleValue(style);
    if (ruleValue) {
      output[selector] = ruleValue;
    }
  }
  return output;
}

function toRuleValue(style: TokenStyle): VsCodeSemanticTokenRuleValue | undefined {
  const hasAnyStyleFlag = style.bold !== undefined || style.italic !== undefined || style.underline !== undefined;
  const fontStyle = hasAnyStyleFlag ? buildFontStyle(style) : undefined;

  if (style.foreground && !hasAnyStyleFlag) {
    return style.foreground;
  }

  if (!style.foreground && fontStyle === undefined) {
    return undefined;
  }

  const rule: { foreground?: string; fontStyle?: string } = {};
  if (style.foreground) {
    rule.foreground = style.foreground;
  }
  if (fontStyle !== undefined) {
    rule.fontStyle = fontStyle;
  }
  return rule;
}

function buildFontStyle(style: TokenStyle): string {
  const parts: string[] = [];
  if (style.bold) {
    parts.push('bold');
  }
  if (style.italic) {
    parts.push('italic');
  }
  if (style.underline) {
    parts.push('underline');
  }
  return parts.join(' ');
}
