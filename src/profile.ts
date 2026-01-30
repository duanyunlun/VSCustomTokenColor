export type TokenStyle = {
  foreground?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

export type TokenStyleRules = Record<string, TokenStyle>;
export type LanguageRules = Record<string, TokenStyleRules>;

export type Profile = {
  id: string;
  name: string;
  enabled: boolean;
  boundThemes: string[];
  standardRules: TokenStyleRules;
  languageRules: LanguageRules;
};

export type EditableScope = 'standard' | 'csharp';

export function createDefaultProfile(boundThemeName?: string): Profile {
  return {
    id: 'default',
    name: 'Default',
    enabled: true,
    boundThemes: boundThemeName ? [boundThemeName] : [],
    standardRules: {
      keyword: { foreground: '#C586C0' },
      class: { foreground: '#4EC9B0' },
      function: { foreground: '#DCDCAA' },
      comment: { foreground: '#6A9955', italic: true },
      string: { foreground: '#CE9178' },
      number: { foreground: '#B5CEA8' }
    },
    languageRules: {
      csharp: {}
    }
  };
}
