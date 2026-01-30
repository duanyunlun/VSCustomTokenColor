import * as vscode from 'vscode';
import { Profile, TokenStyleRules } from './profile';
import { toVsCodeSemanticTokenRules } from './semanticTokenCustomizations';

export type WriteTarget = 'global' | 'workspace';

type SemanticTokenCustomizationsSnapshot = {
  takenAt: string;
  value: unknown;
};

const SNAPSHOT_STATE_KEY = 'tokenstyler.snapshot.editor.semanticTokenColorCustomizations.v1';
const MANAGED_SELECTORS_STATE_KEY = 'tokenstyler.managedSelectors.editor.semanticTokenColorCustomizations.v1';
const PENDING_ROLLBACK_STATE_KEY = 'tokenstyler.pendingRollback.editor.semanticTokenColorCustomizations.v1';

export function isSemanticTokenCustomizationsRollbackPending(
  context: vscode.ExtensionContext,
  target: WriteTarget
): boolean {
  const state = getState(context, target);
  return state.get<boolean>(PENDING_ROLLBACK_STATE_KEY) === true;
}

export async function setSemanticTokenCustomizationsRollbackPending(
  context: vscode.ExtensionContext,
  target: WriteTarget,
  pending: boolean
): Promise<void> {
  const state = getState(context, target);
  await state.update(PENDING_ROLLBACK_STATE_KEY, pending ? true : undefined);
}

export async function takeSemanticTokenColorCustomizationsSnapshot(
  context: vscode.ExtensionContext,
  target: WriteTarget
): Promise<void> {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const inspected = editorConfig.inspect<unknown>('semanticTokenColorCustomizations');
  const existingValue = target === 'global' ? inspected?.globalValue : inspected?.workspaceValue;
  await saveSnapshot(context, target, existingValue);
  await setSemanticTokenCustomizationsRollbackPending(context, target, true);
}

export async function restoreSemanticTokenCustomizationsSnapshotSilently(
  context: vscode.ExtensionContext,
  target: WriteTarget
): Promise<void> {
  const snapshot = await loadSnapshot(context, target);
  if (!snapshot) {
    return;
  }
  const editorConfig = vscode.workspace.getConfiguration('editor');
  await editorConfig.update(
    'semanticTokenColorCustomizations',
    snapshot.value as unknown,
    target === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
  );
  await clearManagedSelectors(context, target);
  await setSemanticTokenCustomizationsRollbackPending(context, target, false);
}

export async function pickWriteTarget(): Promise<WriteTarget | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: '用户（User）', description: '写入用户级 settings.json', target: 'global' as const },
      { label: '工作区（Workspace）', description: '写入当前工作区 .vscode/settings.json', target: 'workspace' as const }
    ],
    { placeHolder: '选择写入位置（MVP 默认建议：用户）' }
  );
  return pick?.target;
}

export async function pickThemeName(): Promise<string | undefined> {
  const current = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '';
  const input = await vscode.window.showInputBox({
    prompt: '主题名称（用于写入 editor.semanticTokenColorCustomizations 的 theme block）',
    value: current
  });
  return input?.trim() ? input.trim() : undefined;
}

export async function applyProfileToSettings(
  context: vscode.ExtensionContext,
  profile: Profile,
  themeName: string,
  target: WriteTarget
): Promise<void> {
  await applyRulesToSettings(context, profile.standardRules, themeName, target);
}

export async function applyRulesToSettings(
  context: vscode.ExtensionContext,
  rules: TokenStyleRules,
  themeName: string,
  target: WriteTarget
): Promise<void> {
  await applyRulesToSettingsInternal(context, rules, themeName, target, {
    confirm: true,
    takeSnapshot: true,
    notify: true
  });
}

export async function applyRulesToSettingsSilently(
  context: vscode.ExtensionContext,
  rules: TokenStyleRules,
  themeName: string,
  target: WriteTarget,
  options?: { takeSnapshot?: boolean }
): Promise<void> {
  await applyRulesToSettingsInternal(context, rules, themeName, target, {
    confirm: false,
    takeSnapshot: options?.takeSnapshot ?? false,
    notify: false
  });
}

async function applyRulesToSettingsInternal(
  context: vscode.ExtensionContext,
  rules: TokenStyleRules,
  themeName: string,
  target: WriteTarget,
  options: { confirm: boolean; takeSnapshot: boolean; notify: boolean }
): Promise<void> {
  if (options.confirm) {
    const confirmed = await confirmWrite(themeName, target);
    if (!confirmed) {
      return;
    }
  }

  const editorConfig = vscode.workspace.getConfiguration('editor');
  const inspected = editorConfig.inspect<unknown>('semanticTokenColorCustomizations');
  const existingValue =
    target === 'global' ? inspected?.globalValue : inspected?.workspaceValue;

  if (options.takeSnapshot) {
    await saveSnapshot(context, target, existingValue);
  }

  const themeKey = toThemeKey(themeName);
  const existingObj = asPlainObject(existingValue);
  const existingThemeObj = asPlainObject(existingObj[themeKey]);
  const existingRulesObj = asPlainObject(existingThemeObj.rules);

  const managedSelectors = await loadManagedSelectors(context, target);
  const previousSelectors = managedSelectors[themeKey] ?? [];
  const cleanedRules: Record<string, unknown> = { ...existingRulesObj };
  for (const selector of previousSelectors) {
    delete cleanedRules[selector];
  }

  const generatedRules = toVsCodeSemanticTokenRules(rules);
  const nextRules = {
    ...cleanedRules,
    ...generatedRules
  };

  const nextThemeObj: Record<string, unknown> = {
    ...existingThemeObj,
    enabled: true,
    rules: nextRules
  };

  const nextObj: Record<string, unknown> = {
    ...existingObj,
    [themeKey]: nextThemeObj
  };

  await editorConfig.update(
    'semanticTokenColorCustomizations',
    nextObj,
    target === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
  );

  managedSelectors[themeKey] = Object.keys(generatedRules);
  await saveManagedSelectors(context, target, managedSelectors);

  if (options.notify) {
    const targetLabel = target === 'global' ? '用户（User）' : '工作区（Workspace）';
    void vscode.window.showInformationMessage(
      `已写入 editor.semanticTokenColorCustomizations（主题：${themeName}，位置：${targetLabel}）。`
    );
  }
}

export async function restoreSemanticTokenCustomizationsSnapshot(
  context: vscode.ExtensionContext,
  target: WriteTarget
): Promise<void> {
  const snapshot = await loadSnapshot(context, target);
  if (!snapshot) {
    void vscode.window.showWarningMessage('未找到可恢复的快照（请先执行一次写入）。');
    return;
  }

  const confirmed = await confirmRestore(snapshot, target);
  if (!confirmed) {
    return;
  }

  const editorConfig = vscode.workspace.getConfiguration('editor');
  await editorConfig.update(
    'semanticTokenColorCustomizations',
    snapshot.value as unknown,
    target === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
  );

  await clearManagedSelectors(context, target);
  await setSemanticTokenCustomizationsRollbackPending(context, target, false);

  const targetLabel = target === 'global' ? '用户（User）' : '工作区（Workspace）';
  void vscode.window.showInformationMessage(
    `已恢复 editor.semanticTokenColorCustomizations（位置：${targetLabel}）。`
  );
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

async function saveSnapshot(
  context: vscode.ExtensionContext,
  target: WriteTarget,
  existingValue: unknown
): Promise<void> {
  const state = getState(context, target);
  const snapshot: SemanticTokenCustomizationsSnapshot = {
    takenAt: new Date().toISOString(),
    value: existingValue
  };
  await state.update(SNAPSHOT_STATE_KEY, snapshot);
}

async function loadSnapshot(
  context: vscode.ExtensionContext,
  target: WriteTarget
): Promise<SemanticTokenCustomizationsSnapshot | undefined> {
  const state = getState(context, target);
  return state.get<SemanticTokenCustomizationsSnapshot>(SNAPSHOT_STATE_KEY);
}

async function loadManagedSelectors(
  context: vscode.ExtensionContext,
  target: WriteTarget
): Promise<Record<string, string[]>> {
  const state = getState(context, target);
  return state.get<Record<string, string[]>>(MANAGED_SELECTORS_STATE_KEY) ?? {};
}

async function saveManagedSelectors(
  context: vscode.ExtensionContext,
  target: WriteTarget,
  map: Record<string, string[]>
): Promise<void> {
  const state = getState(context, target);
  await state.update(MANAGED_SELECTORS_STATE_KEY, map);
}

async function clearManagedSelectors(context: vscode.ExtensionContext, target: WriteTarget): Promise<void> {
  const state = getState(context, target);
  await state.update(MANAGED_SELECTORS_STATE_KEY, {});
}

async function confirmWrite(themeName: string, target: WriteTarget): Promise<boolean> {
  const targetLabel = target === 'global' ? '用户（User）' : '工作区（Workspace）';
  const action = await vscode.window.showWarningMessage(
    `即将写入 editor.semanticTokenColorCustomizations（主题：${themeName}，位置：${targetLabel}）。是否继续？`,
    { modal: true },
    '继续写入'
  );
  return action === '继续写入';
}

async function confirmRestore(snapshot: SemanticTokenCustomizationsSnapshot, target: WriteTarget): Promise<boolean> {
  const targetLabel = target === 'global' ? '用户（User）' : '工作区（Workspace）';
  const action = await vscode.window.showWarningMessage(
    `即将恢复 editor.semanticTokenColorCustomizations（位置：${targetLabel}，快照时间：${snapshot.takenAt}）。是否继续？`,
    { modal: true },
    '恢复'
  );
  return action === '恢复';
}
