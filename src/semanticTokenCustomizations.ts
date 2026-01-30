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
