import * as vscode from 'vscode';
import { createDefaultProfile, Profile } from './profile';

const PROFILES_STATE_KEY = 'tokenstyler.profiles.v1';
const SELECTED_PROFILE_BY_THEME_KEY = 'tokenstyler.selectedProfileByTheme.v1';

export async function ensureProfiles(
  context: vscode.ExtensionContext,
  boundThemeName?: string
): Promise<Profile[]> {
  const existing = context.globalState.get<Profile[]>(PROFILES_STATE_KEY);
  if (Array.isArray(existing) && existing.length > 0) {
    const migrated = migrateProfiles(existing, boundThemeName);
    if (migrated.changed) {
      await context.globalState.update(PROFILES_STATE_KEY, migrated.profiles);
    }
    return migrated.profiles;
  }

  const created = [createDefaultProfile(boundThemeName)];
  await context.globalState.update(PROFILES_STATE_KEY, created);
  return created;
}

export async function loadProfiles(context: vscode.ExtensionContext): Promise<Profile[]> {
  return context.globalState.get<Profile[]>(PROFILES_STATE_KEY) ?? [];
}

export async function saveProfiles(context: vscode.ExtensionContext, profiles: Profile[]): Promise<void> {
  await context.globalState.update(PROFILES_STATE_KEY, profiles);
}

export function getSelectedProfileId(context: vscode.ExtensionContext, themeName: string): string | undefined {
  const map = context.globalState.get<Record<string, string>>(SELECTED_PROFILE_BY_THEME_KEY) ?? {};
  return map[themeName];
}

export async function setSelectedProfileId(
  context: vscode.ExtensionContext,
  themeName: string,
  profileId: string
): Promise<void> {
  const map = context.globalState.get<Record<string, string>>(SELECTED_PROFILE_BY_THEME_KEY) ?? {};
  map[themeName] = profileId;
  await context.globalState.update(SELECTED_PROFILE_BY_THEME_KEY, map);
}

function migrateProfiles(
  profiles: Profile[],
  _boundThemeName?: string
): { profiles: Profile[]; changed: boolean } {
  let changed = false;
  const next = profiles.map((p) => {
    const standardRules = p.standardRules ?? {};
    const languageRules = p.languageRules ?? {};
    if (p.standardRules !== standardRules) {
      changed = true;
    }
    if (p.languageRules !== languageRules) {
      changed = true;
    }
    if (!languageRules.csharp) {
      languageRules.csharp = {};
      changed = true;
    }

    const boundThemes = Array.isArray(p.boundThemes) ? p.boundThemes : [];
    if (!Array.isArray(p.boundThemes)) {
      changed = true;
    }

    return {
      ...p,
      standardRules,
      languageRules,
      boundThemes
    };
  });
  return { profiles: next, changed };
}
