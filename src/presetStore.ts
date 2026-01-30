import * as vscode from 'vscode';
import { TokenStyleRules } from './profile';

export type PresetScope = 'user' | 'workspace';

export type LanguagePreset = {
  tokenRules: TokenStyleRules;
  textMateRules?: TokenStyleRules;
  fontFamily?: string;
};

export type ThemePresets = Record<string, LanguagePreset>;
export type PresetsByTheme = Record<string, ThemePresets>;

const USER_PRESETS_KEY = 'tokenstyler.presets.user.v1';
const WORKSPACE_PRESETS_KEY = 'tokenstyler.presets.workspace.v1';

export function initSync(context: vscode.ExtensionContext): void {
  context.globalState.setKeysForSync([USER_PRESETS_KEY]);
}

export function loadPresets(context: vscode.ExtensionContext, scope: PresetScope): PresetsByTheme {
  const key = scope === 'user' ? USER_PRESETS_KEY : WORKSPACE_PRESETS_KEY;
  const store = scope === 'user' ? context.globalState : context.workspaceState;
  return (store.get<PresetsByTheme>(key) ?? {}) as PresetsByTheme;
}

export async function savePresets(
  context: vscode.ExtensionContext,
  scope: PresetScope,
  presets: PresetsByTheme
): Promise<void> {
  const key = scope === 'user' ? USER_PRESETS_KEY : WORKSPACE_PRESETS_KEY;
  const store = scope === 'user' ? context.globalState : context.workspaceState;
  await store.update(key, presets);
}

export function getLanguagePreset(
  presets: PresetsByTheme,
  themeName: string,
  languageKey: string
): LanguagePreset | undefined {
  return presets[themeName]?.[languageKey];
}

export function upsertLanguagePreset(
  presets: PresetsByTheme,
  themeName: string,
  languageKey: string,
  preset: LanguagePreset
): PresetsByTheme {
  const theme = presets[themeName] ?? {};
  return {
    ...presets,
    [themeName]: {
      ...theme,
      [languageKey]: preset
    }
  };
}

