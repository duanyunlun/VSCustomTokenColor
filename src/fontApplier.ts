import * as vscode from 'vscode';
import { PresetScope } from './presetStore';

export async function getLanguageFontFamily(languageId: string, scope: PresetScope): Promise<string | undefined> {
  const langKey = `[${languageId}]`;
  const config = vscode.workspace.getConfiguration(undefined);
  const inspected = config.inspect<Record<string, unknown>>(langKey);
  const existingValue = scope === 'user' ? inspected?.globalValue : inspected?.workspaceValue;
  const obj = asPlainObject(existingValue);
  const value = obj['editor.fontFamily'];
  return typeof value === 'string' ? value : undefined;
}

export async function applyLanguageFontFamily(
  languageId: string,
  fontFamily: string | undefined,
  scope: PresetScope
): Promise<void> {
  const langKey = `[${languageId}]`;
  const config = vscode.workspace.getConfiguration(undefined);
  const inspected = config.inspect<Record<string, unknown>>(langKey);
  const existingValue = scope === 'user' ? inspected?.globalValue : inspected?.workspaceValue;

  const existingObj = asPlainObject(existingValue);
  const nextObj: Record<string, unknown> = { ...existingObj };

  if (fontFamily && fontFamily.trim()) {
    nextObj['editor.fontFamily'] = fontFamily.trim();
  } else {
    delete nextObj['editor.fontFamily'];
  }

  // 如果为空对象，写 undefined 让 VS Code 清除该 language override
  const nextValue = Object.keys(nextObj).length > 0 ? nextObj : undefined;

  await config.update(
    langKey,
    nextValue,
    scope === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
  );
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
