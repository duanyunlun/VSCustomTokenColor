import * as vscode from 'vscode';
import { TokenStyleRules } from './profile';
import { toVsCodeTextMateRules, VsCodeTextMateRule } from './textMateCustomizations';

export type WriteTarget = 'global' | 'workspace';

type TokenColorCustomizationsSnapshot = {
  takenAt: string;
  value: unknown;
};

const SNAPSHOT_STATE_KEY = 'tokenstyler.snapshot.editor.tokenColorCustomizations.v1';
const PENDING_ROLLBACK_STATE_KEY = 'tokenstyler.pendingRollback.editor.tokenColorCustomizations.v1';

const RULE_NAME_PREFIX = 'tokenstyler:';

export function isTokenColorCustomizationsRollbackPending(context: vscode.ExtensionContext, target: WriteTarget): boolean {
  const state = getState(context, target);
  return state.get<boolean>(PENDING_ROLLBACK_STATE_KEY) === true;
}

export async function setTokenColorCustomizationsRollbackPending(
  context: vscode.ExtensionContext,
  target: WriteTarget,
  pending: boolean
): Promise<void> {
  const state = getState(context, target);
  await state.update(PENDING_ROLLBACK_STATE_KEY, pending ? true : undefined);
}

export async function takeTokenColorCustomizationsSnapshot(context: vscode.ExtensionContext, target: WriteTarget): Promise<void> {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const inspected = editorConfig.inspect<unknown>('tokenColorCustomizations');
  const existingValue = target === 'global' ? inspected?.globalValue : inspected?.workspaceValue;
  await saveSnapshot(context, target, existingValue);
  await setTokenColorCustomizationsRollbackPending(context, target, true);
}

export async function restoreTokenColorCustomizationsSnapshotSilently(
  context: vscode.ExtensionContext,
  target: WriteTarget
): Promise<void> {
  const snapshot = await loadSnapshot(context, target);
  if (!snapshot) {
    return;
  }
  const editorConfig = vscode.workspace.getConfiguration('editor');
  await editorConfig.update(
    'tokenColorCustomizations',
    snapshot.value as unknown,
    target === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
  );
  await setTokenColorCustomizationsRollbackPending(context, target, false);
}

export async function applyTextMateRulesToSettingsSilently(
  context: vscode.ExtensionContext,
  rules: TokenStyleRules,
  themeName: string,
  target: WriteTarget
): Promise<void> {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const inspected = editorConfig.inspect<unknown>('tokenColorCustomizations');
  const existingValue = target === 'global' ? inspected?.globalValue : inspected?.workspaceValue;

  const themeKey = toThemeKey(themeName);
  const existingObj = asPlainObject(existingValue);
  const existingThemeObj = asPlainObject(existingObj[themeKey]);
  const existingRules = normalizeTextMateRules(existingThemeObj.textMateRules);

  const cleanedRules = existingRules.filter((r) => !isManagedRule(r));
  const generatedRules = toVsCodeTextMateRules(rules, { namePrefix: 'tokenstyler' });
  const nextThemeObj: Record<string, unknown> = {
    ...existingThemeObj,
    // 仅覆盖 textMateRules，其它字段保持不变（comments/keywords 等）
    textMateRules: [...cleanedRules, ...generatedRules]
  };

  const nextObj: Record<string, unknown> = {
    ...existingObj,
    [themeKey]: nextThemeObj
  };

  await editorConfig.update(
    'tokenColorCustomizations',
    nextObj,
    target === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
  );
}

function isManagedRule(rule: VsCodeTextMateRule): boolean {
  const name = typeof rule.name === 'string' ? rule.name : '';
  return name.startsWith(RULE_NAME_PREFIX);
}

function normalizeTextMateRules(value: unknown): VsCodeTextMateRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: VsCodeTextMateRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as any;
    const scope = obj.scope;
    const settings = obj.settings;
    if (!scope || !settings || typeof settings !== 'object') continue;
    out.push(obj as VsCodeTextMateRule);
  }
  return out;
}

function toThemeKey(themeName: string): string {
  const trimmed = themeName.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed;
  }
  return `[${trimmed}]`;
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getState(context: vscode.ExtensionContext, target: WriteTarget): vscode.Memento {
  return target === 'global' ? context.globalState : context.workspaceState;
}

async function saveSnapshot(context: vscode.ExtensionContext, target: WriteTarget, existingValue: unknown): Promise<void> {
  const state = getState(context, target);
  const snapshot: TokenColorCustomizationsSnapshot = {
    takenAt: new Date().toISOString(),
    value: existingValue
  };
  await state.update(SNAPSHOT_STATE_KEY, snapshot);
}

async function loadSnapshot(
  context: vscode.ExtensionContext,
  target: WriteTarget
): Promise<TokenColorCustomizationsSnapshot | undefined> {
  const state = getState(context, target);
  return state.get<TokenColorCustomizationsSnapshot>(SNAPSHOT_STATE_KEY);
}

