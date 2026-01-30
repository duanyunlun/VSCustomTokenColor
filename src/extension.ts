import * as vscode from 'vscode';
import { TOKEN_STYLER_PREVIEW_SCHEME } from './constants';
import { applyLanguageFontFamily, getLanguageFontFamily } from './fontApplier';
import {
  getSemanticTokenModifierItemsFromExtension,
  getSemanticTokenTypeItemsFromExtension,
  isExtensionInstalled
} from './languageContributions';
import { OFFICIAL_LANGUAGES } from './officialLanguages';
import {
  getLanguagePreset,
  initSync,
  loadPresets,
  PresetsByTheme,
  PresetScope,
  savePresets,
  upsertLanguagePreset
} from './presetStore';
import { TokenStylerPreviewProvider } from './previewProvider';
import { TokenStyle, TokenStyleRules } from './profile';
import {
  applyRulesToSettingsSilently,
  isSemanticTokenCustomizationsRollbackPending,
  restoreSemanticTokenCustomizationsSnapshotSilently,
  setSemanticTokenCustomizationsRollbackPending,
  takeSemanticTokenColorCustomizationsSnapshot
} from './settingsApplier';
import {
  applyTextMateRulesToSettingsSilently,
  isTokenColorCustomizationsRollbackPending,
  restoreTokenColorCustomizationsSnapshotSilently,
  setTokenColorCustomizationsRollbackPending,
  takeTokenColorCustomizationsSnapshot
} from './tokenColorApplier';
import { getPreviewFileExtensionForLanguageId } from './previewSnippets';
import { parseVsCodeSemanticTokenRuleValue } from './semanticTokenCustomizations';
import { LSP_STANDARD_TOKEN_MODIFIERS, LSP_STANDARD_TOKEN_TYPES } from './tokenDiscovery';
import { discoverSemanticTokenLanguageBindings, LanguageBinding } from './languageDiscovery';
import { parseVsCodeTextMateRuleSettings } from './textMateCustomizations';

type WebviewLanguageItem = {
  key: string;
  label: string;
  installed: boolean;
};

type EditableLayer = 'standard' | 'language';

type TriState = 'inherit' | 'on' | 'off';

type CustomSelectorType = 'semantic' | 'textmate';

type WebviewState = {
  themeName: string;
  scope: PresetScope;
  layer: EditableLayer;
  uiLanguage: 'zh-cn' | 'en';
  hasWorkspace: boolean;
  languages: WebviewLanguageItem[];
  selectedLanguageKey: string;
  tokenTypes: string[];
  tokenModifiers: string[];
  selectedTokenType?: string;
  selectedModifiers: string[];
  selector?: string;
  useCustomSelector: boolean;
  customSelectorType: CustomSelectorType;
  customSelectorText: string;
  fontFamily: string;
  layerStyle?: TokenStyle;
  effectiveStyle?: TokenStyle;
  effectiveStyleSource?: 'settings.themeRules' | 'settings.globalRules' | 'theme';
  overrideWarning?: string;
  tokenHelp?: string;
  semanticHighlightingEnabled: boolean;
  languageSemanticHighlighting?: { exists: boolean; state: TriState };
  editorSemanticHighlightingOverride?: { state: TriState };
  semanticTokensAvailability?: 'unknown' | 'available' | 'empty' | 'unsupported' | 'error';
  dirty: boolean;
};

type TokenSelection = { languageKey: string; tokenType: string };

const STANDARD_PRESET_KEY = '__standard__';
const MISC_SNAPSHOT_STATE_KEY = 'tokenstyler.snapshot.misc.v1';
const MISC_PENDING_STATE_KEY = 'tokenstyler.pendingRollback.misc.v1';

type MiscSnapshot = {
  scope: PresetScope;
  languageId: string;
  preEditorSemanticGlobalState?: TriState;
  preFontFamily?: string;
  preLangSemanticState?: TriState;
  preLangSemanticExists?: boolean;
  preEditorSemanticState?: TriState;
};

async function probeDocumentSemanticTokensAvailability(doc: vscode.TextDocument): Promise<WebviewState['semanticTokensAvailability']> {
  try {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('vscode.provideDocumentSemanticTokens')) {
      return 'unsupported';
    }

    const tokens = await vscode.commands.executeCommand<unknown>('vscode.provideDocumentSemanticTokens', doc.uri);
    if (!tokens || typeof tokens !== 'object') {
      return 'empty';
    }
    const anyTokens = tokens as { data?: unknown };
    const data = anyTokens.data as unknown;
    if (data instanceof Uint32Array) {
      return data.length > 0 ? 'available' : 'empty';
    }
    if (Array.isArray(data)) {
      return data.length > 0 ? 'available' : 'empty';
    }
    if (data && typeof data === 'object' && typeof (data as any).length === 'number') {
      return (data as any).length > 0 ? 'available' : 'empty';
    }
    return 'empty';
  } catch {
    return 'error';
  }
}

function getMiscState(context: vscode.ExtensionContext, scope: PresetScope): vscode.Memento {
  return scope === 'user' ? context.globalState : context.workspaceState;
}

async function saveMiscSnapshot(context: vscode.ExtensionContext, snapshot: MiscSnapshot): Promise<void> {
  const state = getMiscState(context, snapshot.scope);
  await state.update(MISC_SNAPSHOT_STATE_KEY, snapshot);
  await state.update(MISC_PENDING_STATE_KEY, true);
}

function loadMiscSnapshot(context: vscode.ExtensionContext, scope: PresetScope): MiscSnapshot | undefined {
  const state = getMiscState(context, scope);
  return state.get<MiscSnapshot>(MISC_SNAPSHOT_STATE_KEY);
}

function isMiscRollbackPending(context: vscode.ExtensionContext, scope: PresetScope): boolean {
  const state = getMiscState(context, scope);
  return state.get<boolean>(MISC_PENDING_STATE_KEY) === true;
}

async function clearMiscRollbackPending(context: vscode.ExtensionContext, scope: PresetScope): Promise<void> {
  const state = getMiscState(context, scope);
  await state.update(MISC_PENDING_STATE_KEY, undefined);
  await state.update(MISC_SNAPSHOT_STATE_KEY, undefined);
}

async function tryAutoRollbackOnActivate(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  try {
    if (isSemanticTokenCustomizationsRollbackPending(context, 'global')) {
      output.appendLine('[startup] 检测到用户级未保存预览更改，正在自动回滚…');
      await restoreSemanticTokenCustomizationsSnapshotSilently(context, 'global');
    }
  } catch (e) {
    const msg = e instanceof Error ? (e.message || String(e)) : String(e);
    output.appendLine(`[startup] 用户级回滚失败：${msg}`);
  }

  try {
    const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    if (hasWorkspace && isSemanticTokenCustomizationsRollbackPending(context, 'workspace')) {
      output.appendLine('[startup] 检测到工作区级未保存预览更改，正在自动回滚…');
      await restoreSemanticTokenCustomizationsSnapshotSilently(context, 'workspace');
    }
  } catch (e) {
    const msg = e instanceof Error ? (e.message || String(e)) : String(e);
    output.appendLine(`[startup] 工作区级回滚失败：${msg}`);
  }

  try {
    if (isTokenColorCustomizationsRollbackPending(context, 'global')) {
      output.appendLine('[startup] 检测到用户级未保存的 TextMate 配色更改，正在自动回滚…');
      await restoreTokenColorCustomizationsSnapshotSilently(context, 'global');
    }
  } catch (e) {
    const msg = e instanceof Error ? (e.message || String(e)) : String(e);
    output.appendLine(`[startup] 用户级 TextMate 回滚失败：${msg}`);
  }

  try {
    const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    if (hasWorkspace && isTokenColorCustomizationsRollbackPending(context, 'workspace')) {
      output.appendLine('[startup] 检测到工作区级未保存的 TextMate 配色更改，正在自动回滚…');
      await restoreTokenColorCustomizationsSnapshotSilently(context, 'workspace');
    }
  } catch (e) {
    const msg = e instanceof Error ? (e.message || String(e)) : String(e);
    output.appendLine(`[startup] 工作区级 TextMate 回滚失败：${msg}`);
  }

  for (const scope of ['user', 'workspace'] as const) {
    try {
      const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
      if (scope === 'workspace' && !hasWorkspace) continue;
      if (!isMiscRollbackPending(context, scope)) continue;
      const snapshot = loadMiscSnapshot(context, scope);
      if (!snapshot) {
        await clearMiscRollbackPending(context, scope);
        continue;
      }
      output.appendLine(`[startup] 检测到${scope === 'user' ? '用户' : '工作区'}级未保存的语义/字体更改，正在自动回滚…`);
      await restoreMiscSnapshot(snapshot);
      await clearMiscRollbackPending(context, scope);
    } catch (e) {
      const msg = e instanceof Error ? (e.message || String(e)) : String(e);
      output.appendLine(`[startup] ${scope} misc 回滚失败：${msg}`);
    }
  }
}

let activeSessionCleanup: (() => Promise<void>) | undefined;

export function activate(context: vscode.ExtensionContext): void {
  initSync(context);

  const output = vscode.window.createOutputChannel('Token Styler');
  context.subscriptions.push(output);
  void tryAutoRollbackOnActivate(context, output);

  const previewProvider = new TokenStylerPreviewProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(TOKEN_STYLER_PREVIEW_SCHEME, previewProvider));

  context.subscriptions.push(
    vscode.commands.registerCommand('tokenstyler.openPreview', async () => {
      const uri = await ensurePreviewFile('csharp');
      const doc0 = await vscode.workspace.openTextDocument(uri);
      const doc = await vscode.languages.setTextDocumentLanguage(doc0, 'csharp');
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tokenstyler.open', async () => {
      await ensureTwoColumnLayout();

      const themeName = getCurrentThemeName();
      const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
      const preferWorkspaceScope = hasWorkspace && workspaceHasSemanticTokenColorCustomizations();
      let scope: PresetScope = preferWorkspaceScope ? 'workspace' : 'user';
      let layer: EditableLayer = 'language';
      const languageBindings = getLanguageBindings().filter((l) => isExtensionInstalled(l.recommendedExtensionId));

      // 默认选第一个语言
      let selectedLanguage = languageBindings.find((x) => x.key === 'csharp') ?? languageBindings[0] ?? {
        key: 'csharp',
        label: 'C#',
        languageId: 'csharp',
        recommendedExtensionId: 'ms-dotnettools.csharp',
        semanticTokenTypeCount: 0
      };
      let semanticTokensAvailability: WebviewState['semanticTokensAvailability'] = 'unknown';
      let presetsByTheme = loadPresets(context, scope);
      let selectedTokenType: string | undefined;
      let selectedModifiers: string[] = [];
      let useCustomSelector = false;
      let customSelectorType: CustomSelectorType = 'semantic';
      let customSelectorText = '';

      let savedStandardPreset = getLanguagePreset(presetsByTheme, themeName, STANDARD_PRESET_KEY) ?? { tokenRules: {}, textMateRules: {}, fontFamily: '' };
      let draftStandardPreset = clonePreset(savedStandardPreset);

      // 当前语言的“已保存预设”与“编辑草稿”
      let savedPreset = getLanguagePreset(presetsByTheme, themeName, selectedLanguage.key) ?? {
        tokenRules: {},
        textMateRules: {},
        fontFamily: ''
      };
      let draftPreset = clonePreset(savedPreset);
      let dirty = false;
      let sessionSnapshotTaken = false;
      let preEditFontFamily: string | undefined;
      let preMiscSnapshot: MiscSnapshot | undefined;
      let applyTimer: NodeJS.Timeout | undefined;
      let applyInFlight = false;
      let applyPending = false;

      const panel = vscode.window.createWebviewPanel('tokenStyler', 'Token Styler', vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true
      });

      activeSessionCleanup = async () => {
        // VS Code 关闭窗口时可能来不及执行 Webview dispose 的异步回滚；这里作为兜底尝试恢复。
        if (!dirty) return;
        if (sessionSnapshotTaken) {
          const target = scope === 'user' ? 'global' : 'workspace';
          await restoreSemanticTokenCustomizationsSnapshotSilently(context, target);
          await restoreTokenColorCustomizationsSnapshotSilently(context, target);
          const misc = preMiscSnapshot ?? loadMiscSnapshot(context, scope);
          if (misc) {
            await restoreMiscSnapshot(misc);
          }
          await clearMiscRollbackPending(context, scope);
          await setSemanticTokenCustomizationsRollbackPending(context, target, false);
          await setTokenColorCustomizationsRollbackPending(context, target, false);
        }
      };

      const openOrRevealPreview = async (): Promise<void> => {
        const uri = await ensurePreviewFile(selectedLanguage.languageId);
        const doc0 = await vscode.workspace.openTextDocument(uri);
        const doc = await vscode.languages.setTextDocumentLanguage(doc0, selectedLanguage.languageId);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Two });

        // 探测该 languageId 是否实际产出语义 tokens（某些语言仅有 TextMate 高亮，例如 XAML 场景）。
        semanticTokensAvailability = await probeDocumentSemanticTokensAvailability(doc);
      };

      const computeLanguageTokenTypes = (): string[] => {
        const extId = selectedLanguage.recommendedExtensionId;
        if (!isExtensionInstalled(extId)) {
          return [...LSP_STANDARD_TOKEN_TYPES];
        }
        const items = getSemanticTokenTypeItemsFromExtension(extId).map((x) => x.id);
        return items.length > 0 ? items : [...LSP_STANDARD_TOKEN_TYPES];
      };

      const computeLanguageTokenModifiers = (): string[] => {
        const extId = selectedLanguage.recommendedExtensionId;
        if (!isExtensionInstalled(extId)) {
          return [...LSP_STANDARD_TOKEN_MODIFIERS];
        }
        const extMods = getSemanticTokenModifierItemsFromExtension(extId).map((x) => x.id);
        const all = [...LSP_STANDARD_TOKEN_MODIFIERS, ...extMods];
        const uniq = [...new Set(all)].sort();
        return uniq.length > 0 ? uniq : [...LSP_STANDARD_TOKEN_MODIFIERS];
      };

      const buildState = (): WebviewState => {
        const uiLanguage = getUiLanguage();
        const tokenTypes = layer === 'standard' ? [...LSP_STANDARD_TOKEN_TYPES] : computeLanguageTokenTypes();
        const tokenModifiers = layer === 'standard' ? [...LSP_STANDARD_TOKEN_MODIFIERS] : computeLanguageTokenModifiers();
        const nextSelectedTokenType =
          selectedTokenType && tokenTypes.includes(selectedTokenType)
            ? selectedTokenType
            : tokenTypes.length > 0
              ? tokenTypes[0]
              : undefined;
        if (nextSelectedTokenType !== selectedTokenType) {
          selectedModifiers = [];
        }
        selectedTokenType = nextSelectedTokenType;

        selectedModifiers = selectedModifiers.filter((m) => tokenModifiers.includes(m));
        const selectorBase = selectedTokenType ? [selectedTokenType, ...selectedModifiers].join('.') : undefined;
        const customRaw = customSelectorText.trim();
        const selector =
          useCustomSelector && customRaw
            ? (customSelectorType === 'textmate' ? (customRaw.split(/[,\\n\\r]+/g).map((x) => x.trim()).filter(Boolean)[0] ?? customRaw) : customRaw)
            : selectorBase;

        const activeSemanticRules = layer === 'standard' ? draftStandardPreset.tokenRules : draftPreset.tokenRules;
        const activeTextMateRules = layer === 'standard' ? draftStandardPreset.textMateRules : draftPreset.textMateRules;
        const activeRules =
          useCustomSelector && customSelectorType === 'textmate' ? (activeTextMateRules ?? {}) : activeSemanticRules;
        const layerStyle = selector ? (activeRules as TokenStyleRules)[selector] : undefined;

        const effective = selector
          ? (
              useCustomSelector && customSelectorType === 'textmate'
                ? getEffectiveTextMateStyleFromSettings(themeName, selector)
                : getEffectiveStyleFromSettings(themeName, selector)
            )
          : { hasRule: false as const, style: undefined, source: undefined };
        const effectiveStyle = effective.style;
        const effectiveStyleSource: WebviewState['effectiveStyleSource'] =
          effective.source === 'themeRules'
            ? 'settings.themeRules'
            : effective.source === 'globalRules'
              ? 'settings.globalRules'
              : 'theme';

        const overrideWarning =
          (!useCustomSelector || customSelectorType !== 'textmate') && layer === 'standard' && selector
            ? buildOverrideWarning(presetsByTheme, themeName, selector, uiLanguage)
            : undefined;

        const semanticHighlightingEnabled = getSemanticHighlightingEnabled();
        const languageSemanticHighlighting = getLanguageSemanticHighlightingSetting(selectedLanguage.languageId, scope);
        const editorSemanticHighlightingOverride = getEditorSemanticHighlightingOverride(selectedLanguage.languageId, scope);
        return {
          themeName,
          scope,
          layer,
          uiLanguage,
          hasWorkspace,
          languages: getLanguageItems(),
          selectedLanguageKey: selectedLanguage.key,
          tokenTypes,
          tokenModifiers,
          selectedTokenType,
          selectedModifiers,
          selector,
          useCustomSelector,
          customSelectorType,
          customSelectorText,
          fontFamily: draftPreset.fontFamily ?? '',
          layerStyle,
          effectiveStyle,
          effectiveStyleSource,
          overrideWarning,
          tokenHelp: selector
            ? (useCustomSelector && customSelectorType === 'textmate'
                ? buildTextMateHelpText(selector, uiLanguage)
                : buildTokenHelpText(selectedLanguage, layer, selector))
            : undefined,
          semanticHighlightingEnabled,
          languageSemanticHighlighting,
          editorSemanticHighlightingOverride,
          semanticTokensAvailability,
          dirty
        };
      };

      const postState = async (): Promise<void> => {
        void panel.webview.postMessage({ type: 'state', payload: buildState() });
      };

      const ensureSessionSnapshot = async (): Promise<void> => {
        if (sessionSnapshotTaken) {
          return;
        }
        const target = scope === 'user' ? 'global' : 'workspace';
        await takeSemanticTokenColorCustomizationsSnapshot(context, target);
        await takeTokenColorCustomizationsSnapshot(context, target);
        preEditFontFamily = await getLanguageFontFamily(selectedLanguage.languageId, scope);

        const editorSemanticGlobal = getEditorSemanticHighlightingSetting(scope);
        const langSemantic = getLanguageSemanticHighlightingSetting(selectedLanguage.languageId, scope);
        const editorSemantic = getEditorSemanticHighlightingOverride(selectedLanguage.languageId, scope);
        preMiscSnapshot = {
          scope,
          languageId: selectedLanguage.languageId,
          preEditorSemanticGlobalState: editorSemanticGlobal.state,
          preFontFamily: preEditFontFamily,
          preLangSemanticExists: langSemantic.exists,
          preLangSemanticState: langSemantic.state,
          preEditorSemanticState: editorSemantic.state
        };
        await saveMiscSnapshot(context, preMiscSnapshot);
        sessionSnapshotTaken = true;
      };

      const applyPreview = async (): Promise<void> => {
        await ensureSessionSnapshot();
        try {
          // WYSIWYG：把“标准层 + 全部语言预设 + 当前语言草稿”合并写入 settings
          presetsByTheme = loadPresets(context, scope);
          const unionRules = buildUnionRules(
            presetsByTheme,
            themeName,
            selectedLanguage.key,
            draftPreset.tokenRules,
            draftStandardPreset.tokenRules
          );
          const unionTextMateRules = buildUnionTextMateRules(
            presetsByTheme,
            themeName,
            selectedLanguage.key,
            draftPreset.textMateRules ?? {},
            draftStandardPreset.textMateRules ?? {}
          );
          const target = scope === 'user' ? 'global' : 'workspace';

          const selector = selectedTokenType ? [selectedTokenType, ...selectedModifiers].join('.') : undefined;
          const expectedStyle = selector ? unionRules[selector] : undefined;
          output.appendLine(
            `[applyPreview] target=${target} theme=${toThemeKey(themeName)} selector=${selector ?? '(none)'} expected=${formatTokenStyle(expectedStyle)}`
          );

          await applyRulesToSettingsSilently(context, unionRules, themeName, target);
          await applyTextMateRulesToSettingsSilently(context, unionTextMateRules, themeName, target);

          // 字体：仅对当前语言做临时应用（不影响其它语言）
          await applyLanguageFontFamily(selectedLanguage.languageId, draftPreset.fontFamily, scope);

          // 读回确认：target 级别是否写入成功？是否被更高优先级覆盖？
          if (selector) {
            const editorConfig = vscode.workspace.getConfiguration('editor');
            const inspected = editorConfig.inspect<unknown>('semanticTokenColorCustomizations');
            const targetValue = target === 'global' ? inspected?.globalValue : inspected?.workspaceValue;
            const targetRule = getRuleFromCustomizationsValue(targetValue, themeName, selector);
            const effectiveRule = getRuleFromCustomizationsValue(editorConfig.get<unknown>('semanticTokenColorCustomizations'), themeName, selector);

            output.appendLine(
              `[applyPreview] readback targetRule=${formatTokenStyle(targetRule)} effectiveRule=${formatTokenStyle(effectiveRule)}`
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? (e.message || String(e)) : String(e);
          output.appendLine(`[applyPreview] ERROR ${msg}`);
          void vscode.window.showErrorMessage(`Token Styler 写入失败：${msg}`);
        }
      };

      const scheduleApplyPreview = (): void => {
        applyPending = true;
        if (applyTimer) {
          clearTimeout(applyTimer);
        }
        applyTimer = setTimeout(() => {
          applyTimer = undefined;
          void runApplyPreview();
        }, 150);
      };

      const runApplyPreview = async (): Promise<void> => {
        if (applyInFlight) {
          return;
        }
        if (!applyPending) {
          return;
        }
        applyInFlight = true;
        try {
          applyPending = false;
          await applyPreview();
        } finally {
          applyInFlight = false;
          if (applyPending) {
            scheduleApplyPreview();
          }
        }
      };

      const rollbackSessionIfNeeded = async (): Promise<void> => {
        if (!sessionSnapshotTaken) {
          return;
        }
        const target = scope === 'user' ? 'global' : 'workspace';
        await restoreSemanticTokenCustomizationsSnapshotSilently(context, target);
        await restoreTokenColorCustomizationsSnapshotSilently(context, target);
        const misc = preMiscSnapshot ?? loadMiscSnapshot(context, scope);
        if (misc) {
          await restoreMiscSnapshot(misc);
        }
        await clearMiscRollbackPending(context, scope);
        await setSemanticTokenCustomizationsRollbackPending(context, target, false);
        await setTokenColorCustomizationsRollbackPending(context, target, false);
        sessionSnapshotTaken = false;
        preEditFontFamily = undefined;
        preMiscSnapshot = undefined;
      };

      const applyAllPresetsToSettings = async (): Promise<void> => {
        try {
          presetsByTheme = loadPresets(context, scope);
          savedStandardPreset = getLanguagePreset(presetsByTheme, themeName, STANDARD_PRESET_KEY) ?? { tokenRules: {}, textMateRules: {}, fontFamily: '' };
          const unionRules = buildUnionRules(
            presetsByTheme,
            themeName,
            // 不叠加草稿：只应用已保存预设
            '',
            {},
            savedStandardPreset.tokenRules
          );
          const unionTextMateRules = buildUnionTextMateRules(
            presetsByTheme,
            themeName,
            '',
            {},
            (savedStandardPreset.textMateRules ?? {}) as TokenStyleRules
          );
          const target = scope === 'user' ? 'global' : 'workspace';
          output.appendLine(`[applyAll] target=${target} theme=${toThemeKey(themeName)} rules=${Object.keys(unionRules).length}`);
          await applyRulesToSettingsSilently(context, unionRules, themeName, target);
          await applyTextMateRulesToSettingsSilently(context, unionTextMateRules, themeName, target);

          const themePresets = presetsByTheme[themeName] ?? {};
          const bindings = getLanguageBindings();
          for (const [langKey, preset] of Object.entries(themePresets)) {
            if (langKey === STANDARD_PRESET_KEY) continue;
            if (!preset) continue;
            const langId =
              bindings.find((b) => b.key === langKey)?.languageId ??
              OFFICIAL_LANGUAGES.find((o) => o.key === langKey)?.languageId ??
              langKey;
            await applyLanguageFontFamily(langId, (preset as any).fontFamily, scope);
          }
        } catch (e) {
          const msg = e instanceof Error ? (e.message || String(e)) : String(e);
          output.appendLine(`[applyAll] ERROR ${msg}`);
          void vscode.window.showErrorMessage(`Token Styler 写入失败：${msg}`);
        }
      };

      const restoreToSaved = async (): Promise<void> => {
        presetsByTheme = loadPresets(context, scope);
        savedStandardPreset = getLanguagePreset(presetsByTheme, themeName, STANDARD_PRESET_KEY) ?? { tokenRules: {}, textMateRules: {}, fontFamily: '' };
        draftStandardPreset = clonePreset(savedStandardPreset);
        savedPreset = getLanguagePreset(presetsByTheme, themeName, selectedLanguage.key) ?? { tokenRules: {}, textMateRules: {}, fontFamily: '' };
        draftPreset = clonePreset(savedPreset);
        dirty = false;
        await rollbackSessionIfNeeded();
        await applyAllPresetsToSettings(); // 用户主动“恢复”，再应用已保存预设
        await postState();
      };

      const saveCurrentLanguagePreset = async (): Promise<void> => {
        presetsByTheme = loadPresets(context, scope);

        presetsByTheme = upsertLanguagePreset(presetsByTheme, themeName, STANDARD_PRESET_KEY, {
          tokenRules: { ...draftStandardPreset.tokenRules },
          textMateRules: { ...(draftStandardPreset.textMateRules ?? {}) }
        });
        presetsByTheme = upsertLanguagePreset(presetsByTheme, themeName, selectedLanguage.key, {
          tokenRules: { ...draftPreset.tokenRules },
          textMateRules: { ...(draftPreset.textMateRules ?? {}) },
          fontFamily: draftPreset.fontFamily ?? ''
        });
        await savePresets(context, scope, presetsByTheme);
        savedStandardPreset = clonePreset(draftStandardPreset);
        savedPreset = clonePreset(draftPreset);
        dirty = false;
        await applyAllPresetsToSettings();
        sessionSnapshotTaken = false;
        preEditFontFamily = undefined;
        preMiscSnapshot = undefined;
        await clearMiscRollbackPending(context, scope);
        const target = scope === 'user' ? 'global' : 'workspace';
        await setSemanticTokenCustomizationsRollbackPending(context, target, false);
        await setTokenColorCustomizationsRollbackPending(context, target, false);
        await postState();
      };

      // 初始：加载 token list、打开预览、渲染 state
      panel.webview.html = getWebviewHtml(panel.webview, buildState());
      await openOrRevealPreview();

      panel.onDidDispose(() => {
        if (applyTimer) {
          clearTimeout(applyTimer);
          applyTimer = undefined;
        }
        // 这里不能再 postMessage（webview 已销毁），只做 settings 回滚
        if (!dirty) {
          activeSessionCleanup = undefined;
          return;
        }
        void (async () => {
          // 未保存即恢复（回滚到编辑前快照）
          await rollbackSessionIfNeeded();
          activeSessionCleanup = undefined;
        })();
      });

      panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!message || typeof message !== 'object') {
          return;
        }
        const msg = message as { type?: unknown; payload?: unknown };

          if (msg.type === 'setScope') {
            const payload = msg.payload as { scope?: unknown };
            const nextScope: PresetScope = payload.scope === 'user' ? 'user' : 'workspace';
            if (nextScope === 'workspace' && !hasWorkspace) {
              void vscode.window.showWarningMessage('当前窗口未打开任何工作区文件夹，无法写入“工作区”设置。请切换为“用户”，或先打开一个文件夹。');
              await postState();
              return;
            }
            if (nextScope === scope) {
              return;
            }

            // 切换 scope 时：
            // - 如果当前有未保存改动：把“临时预览写入”从旧 scope 迁移到新 scope（保证 UI/预览不丢失），同时恢复旧 scope，避免污染。
            // - 如果当前没有未保存改动：直接切到新 scope 并加载其已保存预设。
            const wasDirty = dirty;
            if (wasDirty) {
              await rollbackSessionIfNeeded();
            }

            scope = nextScope;
            presetsByTheme = loadPresets(context, scope);
            savedStandardPreset =
              getLanguagePreset(presetsByTheme, themeName, STANDARD_PRESET_KEY) ?? { tokenRules: {}, textMateRules: {}, fontFamily: '' };
            savedPreset =
              getLanguagePreset(presetsByTheme, themeName, selectedLanguage.key) ?? { tokenRules: {}, textMateRules: {}, fontFamily: '' };

            if (!wasDirty) {
              draftStandardPreset = clonePreset(savedStandardPreset);
              draftPreset = clonePreset(savedPreset);
              dirty = false;
              await postState();
              return;
            }

            // 继续保留当前草稿（迁移到新 scope），并把预览写入到新 scope。
            dirty = true;
            await applyPreview();
            await postState();
            return;
          }

          if (msg.type === 'setLayer') {
            const payload = msg.payload as { layer?: unknown };
            const nextLayer: EditableLayer = payload.layer === 'standard' ? 'standard' : 'language';
            if (nextLayer === layer) {
              return;
            }
            layer = nextLayer;
            selectedTokenType = undefined;
            selectedModifiers = [];
            await openOrRevealPreview();
            await postState();
            return;
          }

          if (msg.type === 'selectLanguage') {
            const payload = msg.payload as { languageKey?: unknown };
            if (typeof payload.languageKey !== 'string') {
              return;
            }
            const next = getLanguageBindings().find((l) => l.key === payload.languageKey);
            if (!next) {
              return;
            }

            // 切换语言前：未保存即恢复
            if (dirty) {
              await rollbackSessionIfNeeded();
              dirty = false;
            }

          if (!isExtensionInstalled(next.recommendedExtensionId)) {
            const action = await vscode.window.showInformationMessage(
              `检测到未安装 ${next.label} 扩展（${next.recommendedExtensionId}）。是否安装？`,
              { modal: true },
              '安装'
            );
            if (action !== '安装') {
              return;
            }

            try {
              await vscode.commands.executeCommand('workbench.extensions.installExtension', next.recommendedExtensionId);
            } catch {
              // 兜底：打开扩展搜索
              await vscode.commands.executeCommand('workbench.extensions.search', next.recommendedExtensionId);
            }

            const reload = await vscode.window.showInformationMessage(
              '扩展安装完成（或已开始安装）。请重载窗口以生效。',
              '重载窗口'
            );
            if (reload === '重载窗口') {
              await vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
            return;
          }

          selectedLanguage = next;
          presetsByTheme = loadPresets(context, scope);
          savedStandardPreset = getLanguagePreset(presetsByTheme, themeName, STANDARD_PRESET_KEY) ?? { tokenRules: {}, textMateRules: {}, fontFamily: '' };
          draftStandardPreset = clonePreset(savedStandardPreset);
          savedPreset = getLanguagePreset(presetsByTheme, themeName, selectedLanguage.key) ?? { tokenRules: {}, textMateRules: {}, fontFamily: '' };
          draftPreset = clonePreset(savedPreset);
          dirty = false;
          selectedTokenType = undefined;
          selectedModifiers = [];
          await openOrRevealPreview();
          await postState();
          return;
          }

        if (msg.type === 'selectTokenType') {
          const payload = msg.payload as { tokenType?: unknown };
          if (typeof payload.tokenType !== 'string' || !payload.tokenType.trim()) {
            return;
          }
          selectedTokenType = payload.tokenType.trim();
          selectedModifiers = [];
          await postState();
          return;
        }

        if (msg.type === 'setTokenModifiers') {
          const payload = msg.payload as { modifiers?: unknown };
          if (!Array.isArray(payload.modifiers)) {
            return;
          }
          const next = payload.modifiers
            .filter((x): x is string => typeof x === 'string' && !!x.trim())
            .map((x) => x.trim());
          selectedModifiers = [...new Set(next)].sort();
          await postState();
          return;
        }

        if (msg.type === 'setCustomSelectorEnabled') {
          const payload = msg.payload as { enabled?: unknown };
          useCustomSelector = payload.enabled === true;
          dirty = true;
          scheduleApplyPreview();
          await postState();
          return;
        }

        if (msg.type === 'setCustomSelectorType') {
          const payload = msg.payload as { selectorType?: unknown };
          const t = payload.selectorType;
          customSelectorType = t === 'textmate' ? 'textmate' : 'semantic';
          dirty = true;
          scheduleApplyPreview();
          await postState();
          return;
        }

        if (msg.type === 'setCustomSelectorText') {
          const payload = msg.payload as { text?: unknown };
          customSelectorText = typeof payload.text === 'string' ? payload.text : '';
          dirty = true;
          scheduleApplyPreview();
          await postState();
          return;
        }

        if (msg.type === 'setFontFamily') {
          const payload = msg.payload as { fontFamily?: unknown };
          const fontFamily = typeof payload.fontFamily === 'string' ? payload.fontFamily : '';
          draftPreset = { ...draftPreset, fontFamily };
          dirty = true;
          scheduleApplyPreview();
          await postState();
          return;
        }

        if (msg.type === 'setTokenStyle') {
          const payload = msg.payload as { selector?: unknown; style?: unknown };
          if (typeof payload.selector !== 'string' || !payload.selector.trim()) {
            return;
          }
          const selector = payload.selector.trim();
          const style = sanitizeTokenStyle(payload.style);

          const targetPreset: any = layer === 'standard' ? draftStandardPreset : draftPreset;
          const ruleKey = useCustomSelector && customSelectorText.trim() ? customSelectorText.trim() : selector;
          const isTextMate = useCustomSelector && customSelectorType === 'textmate';
          const currentRules: TokenStyleRules = isTextMate
            ? { ...(targetPreset.textMateRules ?? {}) }
            : { ...(targetPreset.tokenRules ?? {}) };

          if (style) {
            // 支持把一个输入拆成多个 TextMate scopes（逗号/换行分隔）
            if (isTextMate) {
              const parts = ruleKey.split(/[,\\n\\r]+/g).map((x) => x.trim()).filter(Boolean);
              if (parts.length <= 1) {
                currentRules[ruleKey] = style;
              } else {
                for (const p of parts) {
                  currentRules[p] = style;
                }
              }
            } else {
              currentRules[ruleKey] = style;
            }
          } else {
            if (isTextMate) {
              const parts = ruleKey.split(/[,\\n\\r]+/g).map((x) => x.trim()).filter(Boolean);
              if (parts.length <= 1) {
                delete currentRules[ruleKey];
              } else {
                for (const p of parts) {
                  delete currentRules[p];
                }
              }
            } else {
              delete currentRules[ruleKey];
            }
          }

          if (isTextMate) {
            if (layer === 'standard') {
              draftStandardPreset = { ...(draftStandardPreset as any), textMateRules: currentRules };
            } else {
              draftPreset = { ...(draftPreset as any), textMateRules: currentRules };
            }
          } else {
            if (layer === 'standard') {
              draftStandardPreset = { ...draftStandardPreset, tokenRules: currentRules };
            } else {
              draftPreset = { ...draftPreset, tokenRules: currentRules };
            }
          }
          dirty = true;
          if (!useCustomSelector) {
            const parts = selector.split('.').map((x) => x.trim()).filter(Boolean);
            selectedTokenType = parts[0] ?? selectedTokenType;
            selectedModifiers = parts.slice(1);
          }
          scheduleApplyPreview();
          await postState();
          return;
        }

        if (msg.type === 'enableSemanticHighlighting') {
          await ensureSessionSnapshot();
          dirty = true;
          await setEditorSemanticHighlightingSetting(scope, 'on');
          await postState();
          return;
        }

        if (msg.type === 'setLanguageSemanticHighlighting') {
          const payload = msg.payload as { state?: unknown };
          const stateValue = payload?.state;
          const next: TriState =
            stateValue === 'on' ? 'on' : stateValue === 'off' ? 'off' : 'inherit';
          await ensureSessionSnapshot();
          dirty = true;
          await setLanguageSemanticHighlightingSetting(selectedLanguage.languageId, scope, next);
          await postState();
          return;
        }

        if (msg.type === 'setEditorSemanticHighlighting') {
          const payload = msg.payload as { state?: unknown };
          const stateValue = payload?.state;
          const next: TriState =
            stateValue === 'on' ? 'on' : stateValue === 'off' ? 'off' : 'inherit';
          await ensureSessionSnapshot();
          dirty = true;
          await setEditorSemanticHighlightingOverride(selectedLanguage.languageId, scope, next);
          await postState();
          return;
        }

        if (msg.type === 'actionSaveCurrent') {
          await saveCurrentLanguagePreset();
          return;
        }
        if (msg.type === 'actionRestoreCurrent') {
          await restoreToSaved();
          return;
        }
      });
    })
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (!activeSessionCleanup) {
    return undefined;
  }
  return activeSessionCleanup();
}

function getLanguageBindings(): LanguageBinding[] {
  const discovered = discoverSemanticTokenLanguageBindings();
  const officialByLanguageId = new Map<string, { key: string; label: string; languageId: string; recommendedExtensionId: string }>();
  for (const o of OFFICIAL_LANGUAGES) {
    officialByLanguageId.set(o.languageId, o);
  }

  const byKey = new Map<string, LanguageBinding>();

  for (const d of discovered) {
    const official = officialByLanguageId.get(d.languageId);
    const merged: LanguageBinding = official
      ? {
          key: official.key,
          label: official.label,
          languageId: official.languageId,
          recommendedExtensionId: d.recommendedExtensionId,
          semanticTokenTypeCount: d.semanticTokenTypeCount
        }
      : d;
    byKey.set(merged.key, merged);
  }

  for (const o of OFFICIAL_LANGUAGES) {
    if (byKey.has(o.key)) continue;
    byKey.set(o.key, {
      key: o.key,
      label: o.label,
      languageId: o.languageId,
      recommendedExtensionId: o.recommendedExtensionId,
      semanticTokenTypeCount: 0
    });
  }

  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function getLanguageItems(): WebviewLanguageItem[] {
  return getLanguageBindings()
    .filter((l) => isExtensionInstalled(l.recommendedExtensionId))
    .map((l) => ({
      key: l.key,
      label: l.label,
      installed: true
    }));
}

function getCurrentThemeName(): string {
  return vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '';
}

function getSemanticHighlightingEnabled(): boolean {
  const v = vscode.workspace.getConfiguration('editor').get<unknown>('semanticHighlighting.enabled');
  return v !== false;
}

function getEditorSemanticHighlightingSetting(scope: PresetScope): { state: TriState } {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const inspected = editorConfig.inspect<boolean>('semanticHighlighting.enabled');
  const scopedValue =
    scope === 'user'
      ? (inspected?.globalValue as boolean | undefined)
      : ((inspected?.workspaceFolderValue ?? inspected?.workspaceValue) as boolean | undefined);
  return { state: scopedValue === true ? 'on' : scopedValue === false ? 'off' : 'inherit' };
}

async function setEditorSemanticHighlightingSetting(scope: PresetScope, next: TriState): Promise<void> {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  await editorConfig.update(
    'semanticHighlighting.enabled',
    next === 'inherit' ? undefined : next === 'on',
    scope === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
  );
}

function getLanguageSemanticHighlightingSetting(languageId: string, scope: PresetScope): { exists: boolean; state: TriState } {
  const cfg = vscode.workspace.getConfiguration(languageId);
  const inspected = cfg.inspect<boolean>('semanticHighlighting.enabled');
  const exists =
    inspected?.defaultValue !== undefined ||
    inspected?.globalValue !== undefined ||
    inspected?.workspaceValue !== undefined ||
    inspected?.workspaceFolderValue !== undefined;

  if (!exists) {
    return { exists: false, state: 'inherit' };
  }

  const scopedValue =
    scope === 'user'
      ? (inspected?.globalValue as boolean | undefined)
      : ((inspected?.workspaceFolderValue ?? inspected?.workspaceValue) as boolean | undefined);

  return {
    exists: true,
    state: scopedValue === true ? 'on' : scopedValue === false ? 'off' : 'inherit'
  };
}

function getEditorSemanticHighlightingOverride(languageId: string, scope: PresetScope): { state: TriState } {
  const cfg = vscode.workspace.getConfiguration();
  const key = `[${languageId}]`;
  const inspected = cfg.inspect<Record<string, unknown>>(key);
  const scopedValue =
    scope === 'user'
      ? (inspected?.globalValue as Record<string, unknown> | undefined)
      : ((inspected?.workspaceFolderValue ?? inspected?.workspaceValue) as Record<string, unknown> | undefined);
  const v = scopedValue ? (scopedValue['editor.semanticHighlighting.enabled'] as unknown) : undefined;
  return { state: v === true ? 'on' : v === false ? 'off' : 'inherit' };
}

async function setSemanticHighlightingEnabled(scope: PresetScope, enabled: boolean): Promise<void> {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  await editorConfig.update(
    'semanticHighlighting.enabled',
    enabled,
    scope === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
  );
}

async function setLanguageSemanticHighlightingSetting(languageId: string, scope: PresetScope, next: TriState): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(languageId);
  await cfg.update(
    'semanticHighlighting.enabled',
    next === 'inherit' ? undefined : next === 'on',
    scope === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
  );
}

async function setEditorSemanticHighlightingOverride(languageId: string, scope: PresetScope, next: TriState): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const key = `[${languageId}]`;
  const inspected = cfg.inspect<Record<string, unknown>>(key);
  const current =
    scope === 'user'
      ? (inspected?.globalValue as Record<string, unknown> | undefined)
      : ((inspected?.workspaceFolderValue ?? inspected?.workspaceValue) as Record<string, unknown> | undefined);
  const nextObj: Record<string, unknown> = { ...(current ?? {}) };
  if (next === 'inherit') {
    delete nextObj['editor.semanticHighlighting.enabled'];
  } else {
    nextObj['editor.semanticHighlighting.enabled'] = next === 'on';
  }
  const hasAny = Object.keys(nextObj).length > 0;
  await cfg.update(
    key,
    hasAny ? nextObj : undefined,
    scope === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
  );
}

async function restoreMiscSnapshot(snapshot: MiscSnapshot): Promise<void> {
  await setEditorSemanticHighlightingSetting(snapshot.scope, snapshot.preEditorSemanticGlobalState ?? 'inherit');
  await applyLanguageFontFamily(snapshot.languageId, snapshot.preFontFamily, snapshot.scope);

  if (snapshot.preLangSemanticExists) {
    await setLanguageSemanticHighlightingSetting(
      snapshot.languageId,
      snapshot.scope,
      snapshot.preLangSemanticState ?? 'inherit'
    );
  }

  await setEditorSemanticHighlightingOverride(
    snapshot.languageId,
    snapshot.scope,
    snapshot.preEditorSemanticState ?? 'inherit'
  );
}

function getEffectiveStyleFromSettings(
  themeName: string,
  selector: string
): { hasRule: boolean; style?: TokenStyle; source?: 'themeRules' | 'globalRules' } {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const value = editorConfig.get<unknown>('semanticTokenColorCustomizations');
  const hit = getRuleFromCustomizationsValueDetailed(value, themeName, selector);
  if (!hit.source) {
    return { hasRule: false as const, style: undefined, source: undefined };
  }
  return { hasRule: true as const, style: hit.style, source: hit.source };
}

function getRuleFromCustomizationsValueDetailed(
  value: unknown,
  themeName: string,
  selector: string
): { source?: 'themeRules' | 'globalRules'; style?: TokenStyle } {
  const obj = asPlainObject(value);
  const globalRulesObj = asPlainObject(obj.rules);

  const themeObj = asPlainObject(obj[toThemeKey(themeName)]);
  const themeRulesObj = asPlainObject(themeObj.rules);

  // 规则优先级：主题 rules 覆盖顶层 rules
  if (selector in themeRulesObj) {
    return { source: 'themeRules', style: parseVsCodeSemanticTokenRuleValue(themeRulesObj[selector]) };
  }
  if (selector in globalRulesObj) {
    return { source: 'globalRules', style: parseVsCodeSemanticTokenRuleValue(globalRulesObj[selector]) };
  }
  return { source: undefined, style: undefined };
}

function getEffectiveTextMateStyleFromSettings(
  themeName: string,
  scope: string
): { hasRule: boolean; style?: TokenStyle; source?: 'themeRules' | 'globalRules' } {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const value = editorConfig.get<unknown>('tokenColorCustomizations');
  const hit = getTextMateRuleFromCustomizationsValueDetailed(value, themeName, scope);
  if (!hit.source) {
    return { hasRule: false as const, style: undefined, source: undefined };
  }
  return { hasRule: true as const, style: hit.style, source: hit.source };
}

function getTextMateRuleFromCustomizationsValueDetailed(
  value: unknown,
  themeName: string,
  scope: string
): { source?: 'themeRules' | 'globalRules'; style?: TokenStyle } {
  const obj = asPlainObject(value);

  const globalRules = Array.isArray((obj as any).textMateRules) ? ((obj as any).textMateRules as any[]) : [];
  const themeObj = asPlainObject(obj[toThemeKey(themeName)]);
  const themeRules = Array.isArray((themeObj as any).textMateRules) ? ((themeObj as any).textMateRules as any[]) : [];

  // 优先级：主题 textMateRules 覆盖顶层 textMateRules
  const themeHit = findTextMateRuleStyle(themeRules, scope);
  if (themeHit) {
    return { source: 'themeRules', style: themeHit };
  }
  const globalHit = findTextMateRuleStyle(globalRules, scope);
  if (globalHit) {
    return { source: 'globalRules', style: globalHit };
  }
  return { source: undefined, style: undefined };
}

function findTextMateRuleStyle(rules: any[], scope: string): TokenStyle | undefined {
  const target = (scope || '').trim();
  if (!target) return undefined;
  for (const r of rules) {
    if (!r || typeof r !== 'object') continue;
    const scopeValue = (r as any).scope as unknown;
    const settings = (r as any).settings as unknown;
    const scopes: string[] = [];
    if (typeof scopeValue === 'string' && scopeValue.trim()) {
      scopes.push(scopeValue.trim());
    } else if (Array.isArray(scopeValue)) {
      for (const s of scopeValue) {
        if (typeof s === 'string' && s.trim()) scopes.push(s.trim());
      }
    }
    if (!scopes.includes(target)) continue;
    return parseVsCodeTextMateRuleSettings(settings);
  }
  return undefined;
}

function buildOverrideWarning(
  presetsByTheme: PresetsByTheme,
  themeName: string,
  selector: string,
  uiLanguage: 'zh-cn' | 'en'
): string | undefined {
  const theme = presetsByTheme[themeName] ?? {};
  const overlapped: string[] = [];
  const bindings = getLanguageBindings();
  for (const [langKey, preset] of Object.entries(theme)) {
    if (langKey === STANDARD_PRESET_KEY) continue;
    if (!preset?.tokenRules) continue;
    if (selector in preset.tokenRules) {
      const label =
        bindings.find((b) => b.key === langKey)?.label ??
        OFFICIAL_LANGUAGES.find((o) => o.key === langKey)?.label ??
        langKey;
      overlapped.push(label);
    }
  }
  if (overlapped.length === 0) {
    return undefined;
  }
  if (uiLanguage === 'zh-cn') {
    return `提示：该 selector 已在语言层设置（${overlapped.join('、')}），会覆盖标准（LSP）层；标准层的修改可能不会在预览中体现。`;
  }
  return `Note: this selector is already set in language layer (${overlapped.join(', ')}), which overrides the Standard (LSP) layer; changes in Standard may not reflect in preview.`;
}

function buildTokenHelpText(language: LanguageBinding, layer: EditableLayer, selector: string): string {
  const uiLanguage = getUiLanguage();
  const parts = selector.split('.').map((x) => x.trim()).filter(Boolean);
  const tokenType = parts[0] ?? '';

  const tokenTypeDesc =
    layer === 'language'
      ? getLanguageLayerTokenTypeDescription(language, tokenType, uiLanguage)
      : getStandardTokenTypeDescription(tokenType, uiLanguage);

  if (tokenTypeDesc) {
    return tokenTypeDesc;
  }
  return uiLanguage === 'zh-cn' ? '暂无说明' : 'No description';
}

function buildTextMateHelpText(scope: string, uiLanguage: 'zh-cn' | 'en'): string {
  const s = (scope || '').trim();
  if (!s) {
    return uiLanguage === 'zh-cn' ? '未设置 TextMate scope' : 'No TextMate scope';
  }
  if (uiLanguage === 'zh-cn') {
    return `TextMate scope：${s}\n提示：该模式写入 editor.tokenColorCustomizations（主题块 textMateRules），用于处理 Inspect 面板里显示的 textmate scopes（如 entity.name.function.definition.cpp）。`;
  }
  return `TextMate scope: ${s}\nNote: this writes to editor.tokenColorCustomizations (theme textMateRules), for scopes shown in Inspect (e.g. entity.name.function.definition.cpp).`;
}

function getUiLanguage(): 'zh-cn' | 'en' {
  const lang = vscode.env.language.toLowerCase();
  if (lang === 'zh-cn' || lang.startsWith('zh-cn')) {
    return 'zh-cn';
  }
  return 'en';
}

function getStandardTokenTypeDescription(tokenType: string, uiLanguage: 'zh-cn' | 'en'): string | undefined {
  const zh: Record<string, string> = {
    namespace: '命名空间',
    type: '类型（泛化）',
    class: '类',
    enum: '枚举',
    interface: '接口',
    struct: '结构体',
    typeParameter: '类型参数',
    parameter: '参数',
    variable: '变量/标识符',
    property: '属性',
    enumMember: '枚举成员',
    event: '事件',
    function: '函数',
    method: '方法',
    macro: '宏',
    keyword: '关键字',
    modifier: '修饰符',
    comment: '注释',
    string: '字符串',
    number: '数字',
    regexp: '正则',
    operator: '运算符',
    decorator: '装饰器/注解'
  };
  const en: Record<string, string> = {
    namespace: 'namespace',
    type: 'type (generic)',
    class: 'class',
    enum: 'enum',
    interface: 'interface',
    struct: 'struct',
    typeParameter: 'type parameter',
    parameter: 'parameter',
    variable: 'variable/identifier',
    property: 'property',
    enumMember: 'enum member',
    event: 'event',
    function: 'function',
    method: 'method',
    macro: 'macro',
    keyword: 'keyword',
    modifier: 'modifier',
    comment: 'comment',
    string: 'string',
    number: 'number',
    regexp: 'regexp',
    operator: 'operator',
    decorator: 'decorator/annotation'
  };
  return uiLanguage === 'zh-cn' ? zh[tokenType] : en[tokenType];
}

function getLanguageLayerTokenTypeDescription(language: LanguageBinding, tokenType: string, uiLanguage: 'zh-cn' | 'en'): string | undefined {
  const extId = language.recommendedExtensionId;

  if (uiLanguage === 'zh-cn') {
    const zh = getKnownLanguageTokenTypeChineseDescription(language.languageId, tokenType);
    if (zh) {
      return zh;
    }
  }

  if (isExtensionInstalled(extId)) {
    const items = getSemanticTokenTypeItemsFromExtension(extId);
    const hit = items.find((x) => x.id === tokenType);
    if (hit?.description) {
      return hit.description;
    }
  }
  return getStandardTokenTypeDescription(tokenType, uiLanguage);
}

function getKnownLanguageTokenTypeChineseDescription(languageId: string, tokenType: string): string | undefined {
  if (languageId !== 'csharp') {
    return undefined;
  }

  const map: Record<string, string> = {
    // C# 常见（不同服务实现可能不完全一致，以 Inspect 为准）
    constant: '常量标识符（可能需要结合 modifiers 命中）',
    field: '字段标识符',
    local: '局部变量标识符',
    property: '属性标识符',
    method: '方法标识符',
    class: '类名',
    struct: '结构体名',
    interface: '接口名',
    enum: '枚举名',
    enumMember: '枚举成员名',
    parameter: '参数名',

    // C# 扩展中常见的 JSON 片段语义 token（例如: 生成的 JSON 字符串）
    jsonArray: 'JSON 数组',
    jsonComment: 'JSON 注释',
    jsonConstructorName: 'JSON 构造器名',
    jsonKeyword: 'JSON 关键字（true/false/null 等）',
    jsonNumber: 'JSON 数字',
    jsonObject: 'JSON 对象',
    jsonOperator: 'JSON 运算符',
    jsonPropertyName: 'JSON 属性名',
    jsonPunctuation: 'JSON 标点/分隔符',
    jsonQuote: 'JSON 引号',
    jsonString: 'JSON 字符串',
    jsonText: 'JSON 文本',

    // Razor/Markup（来自 C# 扩展常见贡献）
    razorComponentElement: 'Razor 组件元素',
    razorComponentAttribute: 'Razor 组件属性',
    razorTagHelperElement: 'Razor TagHelper 元素',
    razorTagHelperAttribute: 'Razor TagHelper 属性',
    razorTransition: 'Razor 过渡符号',
    razorDirectiveAttribute: 'Razor 指令属性',
    razorDirectiveColon: 'Razor 指令参数分隔冒号',
    razorDirective: 'Razor 指令（例如 code/function 等）',
    razorComment: 'Razor 注释',
    markupTagDelimiter: '标记语言标签分隔符（< > / 等）',
    markupOperator: '标记语言属性赋值分隔符',
    markupElement: '标记语言元素名',
    markupAttribute: '标记语言属性名',
    markupAttributeQuote: '标记语言属性引号',
    markupAttributeValue: '标记语言属性值',
    markupComment: '标记语言注释内容',
    markupCommentPunctuation: '标记语言注释标点',
    excludedCode: '非激活/被排除的代码'
  };
  return map[tokenType];
}

function formatModifierDescriptionSuffix(modifier: string, uiLanguage: 'zh-cn' | 'en'): string {
  const zh: Record<string, string> = {
    declaration: '声明',
    definition: '定义',
    readonly: '只读',
    static: '静态',
    deprecated: '已弃用',
    abstract: '抽象',
    async: '异步',
    modification: '修改',
    documentation: '文档',
    defaultLibrary: '默认库'
  };
  const en: Record<string, string> = {
    declaration: 'declaration',
    definition: 'definition',
    readonly: 'readonly',
    static: 'static',
    deprecated: 'deprecated',
    abstract: 'abstract',
    async: 'async',
    modification: 'modification',
    documentation: 'documentation',
    defaultLibrary: 'default library'
  };
  const desc = uiLanguage === 'zh-cn' ? zh[modifier] : en[modifier];
  return desc ? (uiLanguage === 'zh-cn' ? `：${desc}` : `: ${desc}`) : '';
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

function getRuleFromCustomizationsValue(value: unknown, themeName: string, selector: string): TokenStyle | undefined {
  const hit = getRuleFromCustomizationsValueDetailed(value, themeName, selector);
  return hit.style;
}

function workspaceHasSemanticTokenColorCustomizations(): boolean {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const inspected = editorConfig.inspect<unknown>('semanticTokenColorCustomizations');
  // 只要工作区层（workspace / workspaceFolder）显式配置过该键，就认为用户希望按工作区生效；否则默认用户级，避免生成 .vscode/settings.json 污染仓库。
  return inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined;
}

function formatTokenStyle(style: TokenStyle | undefined): string {
  if (!style) {
    return '(none)';
  }
  const parts: string[] = [];
  if (style.foreground) parts.push(`fg=${style.foreground}`);
  if (style.bold) parts.push('bold');
  if (style.italic) parts.push('italic');
  if (style.underline) parts.push('underline');
  return parts.length > 0 ? parts.join(' ') : '(empty)';
}

function buildUnionRules(
  presetsByTheme: PresetsByTheme,
  themeName: string,
  activeLanguageKey: string,
  activeDraftRules: TokenStyleRules,
  standardRulesOverride?: TokenStyleRules
): TokenStyleRules {
  const theme = presetsByTheme[themeName] ?? {};
  const output: TokenStyleRules = {};

  const standardPreset = theme[STANDARD_PRESET_KEY];
  Object.assign(output, standardRulesOverride ?? standardPreset?.tokenRules ?? {});

  // 先合并所有已保存预设
  for (const [langKey, preset] of Object.entries(theme)) {
    if (langKey === STANDARD_PRESET_KEY) continue;
    if (!preset) continue;
    Object.assign(output, preset.tokenRules ?? {});
  }

  // 再覆盖当前语言草稿（未保存也能预览）
  if (activeLanguageKey) {
    Object.assign(output, activeDraftRules);
  }

  return output;
}

function buildUnionTextMateRules(
  presetsByTheme: PresetsByTheme,
  themeName: string,
  activeLanguageKey: string,
  activeDraftRules: TokenStyleRules,
  standardRulesOverride?: TokenStyleRules
): TokenStyleRules {
  const theme = presetsByTheme[themeName] ?? {};
  const output: TokenStyleRules = {};

  const standardPreset = theme[STANDARD_PRESET_KEY];
  Object.assign(output, standardRulesOverride ?? standardPreset?.textMateRules ?? {});

  // 先合并所有已保存预设
  for (const [langKey, preset] of Object.entries(theme)) {
    if (langKey === STANDARD_PRESET_KEY) continue;
    if (!preset) continue;
    Object.assign(output, preset.textMateRules ?? {});
  }

  // 再覆盖当前语言草稿（未保存也能预览）
  if (activeLanguageKey) {
    Object.assign(output, activeDraftRules);
  }

  return output;
}

// 已改为“编辑前快照回滚”，不再使用该函数。

async function ensurePreviewFile(languageId: string): Promise<vscode.Uri> {
  const ext = getPreviewFileExtensionForLanguageId(languageId);
  // 使用虚拟文档（TextDocumentContentProvider）提供预览内容，避免在工作区写入任何文件污染仓库。
  // languageId 放在 query 中，provider 用它选择预览片段。
  const q = encodeURIComponent(languageId || '');
  return vscode.Uri.parse(`${TOKEN_STYLER_PREVIEW_SCHEME}:/preview.${ext}?lang=${q}`);
}

function clonePreset(preset: { tokenRules: TokenStyleRules; textMateRules?: TokenStyleRules; fontFamily?: string }): { tokenRules: TokenStyleRules; textMateRules: TokenStyleRules; fontFamily?: string } {
  return {
    tokenRules: { ...(preset.tokenRules ?? {}) },
    textMateRules: { ...(preset.textMateRules ?? {}) },
    fontFamily: preset.fontFamily ?? ''
  };
}

function sanitizeTokenStyle(value: unknown): TokenStyle | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const v = value as Partial<TokenStyle>;

  const style: TokenStyle = {};
  if (typeof v.foreground === 'string' && v.foreground.trim()) {
    style.foreground = v.foreground.trim();
  }
  if (v.bold === true) {
    style.bold = true;
  }
  if (v.italic === true) {
    style.italic = true;
  }
  if (v.underline === true) {
    style.underline = true;
  }

  if (!style.foreground && !style.bold && !style.italic && !style.underline) {
    return undefined;
  }
  return style;
}

function getWebviewHtml(webview: vscode.Webview, initialState: WebviewState): string {
  const nonce = getNonce();
  const serializedState = JSON.stringify(initialState).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
      webview.cspSource
    } 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Token Styler</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
      button {
        padding: 7px 12px;
        border-radius: 10px;
        border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
        background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.18));
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, transform 60ms ease;
      }
      button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,0.28)); }
      button:active { transform: translateY(0.5px); }
      button:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
      button.primary {
        border: none;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      button.primary:hover { background: var(--vscode-button-hoverBackground); }
      button:disabled { opacity: 0.55; cursor: default; transform: none; }

      input, select { font-family: var(--vscode-editor-font-family); }
      select, input[type="text"] {
        border-radius: 10px;
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        padding: 6px 8px;
      }
      select {
        appearance: none;
        -webkit-appearance: none;
        padding-right: 28px;
        background-image:
          linear-gradient(45deg, transparent 50%, var(--vscode-input-foreground) 50%),
          linear-gradient(135deg, var(--vscode-input-foreground) 50%, transparent 50%);
        background-position:
          calc(100% - 14px) calc(50% - 2px),
          calc(100% - 9px) calc(50% - 2px);
        background-size: 5px 5px;
        background-repeat: no-repeat;
      }
      input[type="text"]::placeholder { color: var(--vscode-input-placeholderForeground); }
      input[type="color"] { width: 34px; height: 26px; padding: 0; border: none; background: transparent; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .muted { opacity: 0.8; }
      .hint { opacity: 0.8; margin-top: 8px; line-height: 1.4; }
      .grid { display: flex; gap: 10px; margin-top: 10px; align-items: stretch; }
      .colLang { flex: 0 0 160px; }
      .colTokens { flex: 0 0 300px; width: 300px; min-width: 300px; max-width: 300px; }
      .colConfig { flex: 1 1 320px; min-width: 280px; }
      .panel { border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; }
      .panelHeader { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; gap: 8px; align-items: center; }
      .panelBody { padding: 8px 8px; }
      .list { max-height: calc(100vh - 180px); overflow: auto; }
      .item { padding: 6px 8px; border-radius: 4px; cursor: pointer; }
      .item:hover { background: var(--vscode-list-hoverBackground); }
      .item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
      .field { display: grid; grid-template-columns: 70px 1fr; gap: 6px; align-items: center; margin-top: 10px; }
      .inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .danger { color: var(--vscode-errorForeground); }
      .divider { height: 1px; background: var(--vscode-panel-border); margin-top: 10px; }
      .toggleRow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 2px; }
      .toggleLeft { opacity: 0.9; }
      .triToggle { display: inline-flex; align-items: center; gap: 8px; user-select: none; cursor: pointer; }
      .triToggle:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; border-radius: 6px; }
      .triBox {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
      }
      .triBox.default { background: var(--vscode-badge-background, rgba(127,127,127,0.35)); }
      .triBox.checked::after {
        content: '';
        width: 8px;
        height: 4px;
        border-left: 2px solid var(--vscode-foreground);
        border-bottom: 2px solid var(--vscode-foreground);
        transform: rotate(-45deg);
        margin-top: -1px;
      }
      .triStateText { font-size: 12px; opacity: 0.8; }
    </style>
  </head>
  <body>
    <div class="row">
      <button id="btnSaveCurrent" class="primary">保存当前配置</button>
      <button id="btnRestoreCurrent">恢复当前配置</button>
      <span class="muted" style="margin-left:12px" id="scopeLabel">Scope:</span>
      <select id="scopeSelect">
        <option value="workspace">工作区</option>
        <option value="user">用户</option>
      </select>
      <span class="muted" style="margin-left:12px" id="themeLabel">Theme:</span>
      <span id="themeName"></span>
      <span id="dirtyFlag" class="danger" style="display:none">未保存</span>
    </div>

    <div class="grid" id="mainGrid">
      <div class="panel colLang" id="langPanel">
        <div class="panelHeader"><strong>语言</strong></div>
        <div class="panelBody list" id="languageList"></div>
      </div>

      <div class="panel colTokens" id="tokenPanel">
        <div class="panelHeader">
          <strong>Token Types</strong>
          <select id="layerSelect" title="编辑层级">
            <option value="language">语言扩展</option>
            <option value="standard">标准（LSP）</option>
          </select>
          <span class="muted" id="tokenCount"></span>
        </div>
        <div class="panelBody">
          <input id="tokenSearch" type="text" placeholder="搜索 tokenType..." style="width:100%" />
          <div class="list" id="tokenList" style="margin-top:8px"></div>
        </div>
      </div>

      <div class="panel colConfig" id="configPanel">
        <div class="panelHeader"><strong>配置</strong><span class="muted" id="selectedToken"></span></div>
        <div class="panelBody">
          <div id="semanticSection">
            <div class="toggleRow" id="langSemanticRow" style="display:none">
              <div class="toggleLeft" id="langSemanticLabel">语义扩展开关</div>
              <div class="triToggle" id="langSemanticToggle" tabindex="0" title="csharp.semanticHighlighting.enabled（示例）">
                <span class="triBox" id="langSemanticBox"></span>
                <span class="triStateText muted" id="langSemanticStateText"></span>
              </div>
            </div>

            <div class="toggleRow" id="editorSemanticRow">
              <div class="toggleLeft" id="editorSemanticLabel">编辑器语义响应</div>
              <div class="triToggle" id="editorSemanticToggle" tabindex="0" title="[csharp].editor.semanticHighlighting.enabled（示例）">
                <span class="triBox" id="editorSemanticBox"></span>
                <span class="triStateText muted" id="editorSemanticStateText"></span>
              </div>
            </div>
          </div>
          <div id="semanticAvailabilityHint" class="hint danger" style="display:none; margin-top:6px"></div>

          <div class="divider"></div>

          <div class="field">
            <div>解释</div>
            <div class="muted" id="tokenHelp" style="line-height:1.4"></div>
          </div>
          <div id="overrideWarning" class="danger" style="display:none; margin-top:6px; line-height:1.4"></div>

          <div class="field">
            <div>修饰符</div>
            <div class="inline" id="modifierList"></div>
          </div>
          <div class="muted" style="margin-top:6px; line-height:1.4" id="modifierInfo"></div>

          <div class="divider"></div>

          <div class="field">
            <div>高级</div>
            <div class="inline">
              <label><input id="useCustomSelector" type="checkbox" /> 使用自定义 selector</label>
              <select id="customSelectorType" title="selector 类型">
                <option value="semantic">语义（semanticTokenColorCustomizations）</option>
                <option value="textmate">TextMate scopes（tokenColorCustomizations）</option>
              </select>
            </div>
          </div>
          <div class="field">
            <div>selector</div>
            <div class="inline">
              <input id="customSelector" type="text" placeholder="例如：function.definition 或 entity.name.function.definition.cpp" style="width:100%" />
            </div>
          </div>
          <div class="muted" style="margin-top:6px; line-height:1.4" id="customSelectorHint"></div>

          <div class="field">
            <div>字体</div>
            <div class="inline">
              <input id="fontFamily" type="text" placeholder="例如: Consolas, 'Courier New', monospace" style="width:100%" />
            </div>
          </div>

          <div class="field">
            <div>颜色</div>
            <div class="inline">
              <input id="fgColor" type="color" />
              <input id="fgText" type="text" placeholder="#RRGGBB" style="width:120px" />
              <span class="muted" id="styleSource"></span>
            </div>
          </div>
          <div class="field">
            <div>样式</div>
            <div class="inline">
              <label><input id="boldChk" type="checkbox" /> bold</label>
              <label><input id="italicChk" type="checkbox" /> italic</label>
              <label><input id="underlineChk" type="checkbox" /> underline</label>
            </div>
          </div>

          <div class="hint">
            <div id="semanticWarning" class="danger" style="display:none; margin-bottom:6px">
              当前语义高亮已关闭（editor.semanticHighlighting.enabled=false），语义 Token 配色不会生效。
              <button id="btnEnableSemantic" style="margin-left:6px">启用</button>
            </div>
            说明：可在“标准（LSP）”与“语言扩展”两层分别编辑。修改会立即作用到右侧预览（通过临时写入 settings 实现）。未点击“保存”则切换语言/关闭面板会自动恢复。注意：语义 token 配色是“按主题的全局规则”，语言层的同名 tokenType 会覆盖标准层，但仍会影响所有语言（VS Code 原生限制）。如某些高亮来自 TextMate scopes，可在“高级”中切换到 TextMate 并粘贴 scope 进行设置。
          </div>
        </div>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      let state = ${serializedState};

      const scopeLabelEl = document.getElementById('scopeLabel');
      const themeLabelEl = document.getElementById('themeLabel');
      const themeNameEl = document.getElementById('themeName');
      const dirtyFlag = document.getElementById('dirtyFlag');
      const scopeSelect = document.getElementById('scopeSelect');
      const layerSelect = document.getElementById('layerSelect');
      const mainGrid = document.getElementById('mainGrid');
      const tokenPanel = document.getElementById('tokenPanel');
      const langPanel = document.getElementById('langPanel');
      const configPanel = document.getElementById('configPanel');

      const languageList = document.getElementById('languageList');
      const tokenSearch = document.getElementById('tokenSearch');
      const tokenList = document.getElementById('tokenList');
      const tokenCount = document.getElementById('tokenCount');

      const selectedTokenEl = document.getElementById('selectedToken');
      const tokenHelpEl = document.getElementById('tokenHelp');
      const overrideWarningEl = document.getElementById('overrideWarning');
      const langSemanticRowEl = document.getElementById('langSemanticRow');
      const langSemanticLabelEl = document.getElementById('langSemanticLabel');
      const langSemanticToggleEl = document.getElementById('langSemanticToggle');
      const langSemanticBoxEl = document.getElementById('langSemanticBox');
      const langSemanticStateTextEl = document.getElementById('langSemanticStateText');
      const editorSemanticRowEl = document.getElementById('editorSemanticRow');
      const editorSemanticLabelEl = document.getElementById('editorSemanticLabel');
      const editorSemanticToggleEl = document.getElementById('editorSemanticToggle');
      const editorSemanticBoxEl = document.getElementById('editorSemanticBox');
      const editorSemanticStateTextEl = document.getElementById('editorSemanticStateText');
      const semanticAvailabilityHintEl = document.getElementById('semanticAvailabilityHint');
      const modifierListEl = document.getElementById('modifierList');
      const modifierInfoEl = document.getElementById('modifierInfo');
      const useCustomSelectorEl = document.getElementById('useCustomSelector');
      const customSelectorTypeEl = document.getElementById('customSelectorType');
      const customSelectorEl = document.getElementById('customSelector');
      const customSelectorHintEl = document.getElementById('customSelectorHint');
      const fontFamilyEl = document.getElementById('fontFamily');
      const fgColor = document.getElementById('fgColor');
      const fgText = document.getElementById('fgText');
      const styleSourceEl = document.getElementById('styleSource');
      const boldChk = document.getElementById('boldChk');
      const italicChk = document.getElementById('italicChk');
      const underlineChk = document.getElementById('underlineChk');

      const semanticWarningEl = document.getElementById('semanticWarning');
      document.getElementById('btnEnableSemantic').addEventListener('click', () => vscode.postMessage({ type: 'enableSemanticHighlighting' }));

      document.getElementById('btnSaveCurrent').addEventListener('click', () => vscode.postMessage({ type: 'actionSaveCurrent' }));
      document.getElementById('btnRestoreCurrent').addEventListener('click', () => vscode.postMessage({ type: 'actionRestoreCurrent' }));
      scopeSelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'setScope', payload: { scope: scopeSelect.value } });
      });

      function cycleTriState(current) {
        if (current === 'inherit') return 'on';
        if (current === 'on') return 'off';
        return 'inherit';
      }

      function applyTriState(boxEl, textEl, stateValue) {
        boxEl.classList.remove('default', 'checked');
        if (stateValue === 'inherit') {
          boxEl.classList.add('default');
        } else if (stateValue === 'on') {
          boxEl.classList.add('checked');
        }
        if (state.uiLanguage === 'zh-cn') {
          textEl.textContent = stateValue === 'inherit' ? '默认' : stateValue === 'on' ? '开启' : '关闭';
        } else {
          textEl.textContent = stateValue === 'inherit' ? 'Inherit' : stateValue === 'on' ? 'On' : 'Off';
        }
      }

      function attachTriToggle(toggleEl, getCurrent, postType) {
        const fire = () => {
          const cur = getCurrent();
          const next = cycleTriState(cur);
          vscode.postMessage({ type: postType, payload: { state: next } });
        };
        toggleEl.addEventListener('click', fire);
        toggleEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fire();
          }
        });
      }

      attachTriToggle(
        langSemanticToggleEl,
        () => (state.languageSemanticHighlighting && state.languageSemanticHighlighting.state) ? state.languageSemanticHighlighting.state : 'inherit',
        'setLanguageSemanticHighlighting'
      );
      attachTriToggle(
        editorSemanticToggleEl,
        () => (state.editorSemanticHighlightingOverride && state.editorSemanticHighlightingOverride.state) ? state.editorSemanticHighlightingOverride.state : 'inherit',
        'setEditorSemanticHighlighting'
      );

      layerSelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'setLayer', payload: { layer: layerSelect.value } });
      });

      tokenSearch.addEventListener('input', () => renderTokenList());

      function isValidHexColor(value) {
        return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
      }

      function normalizeStyleFromEditor() {
        const style = {};
        const fg = (fgText.value || '').trim();
        if (isValidHexColor(fg)) style.foreground = fg.toUpperCase();
        if (boldChk.checked) style.bold = true;
        if (italicChk.checked) style.italic = true;
        if (underlineChk.checked) style.underline = true;
        return style;
      }

      function styleIsEmpty(style) {
        return !style.foreground && !style.bold && !style.italic && !style.underline;
      }

      function renderLanguageList() {
        languageList.innerHTML = '';
        for (const lang of state.languages) {
          const item = document.createElement('div');
          item.className = 'item' + (lang.key === state.selectedLanguageKey ? ' selected' : '');
          if (lang.installed) {
            item.textContent = lang.label;
          } else {
            item.textContent = lang.label + (state.uiLanguage === 'zh-cn' ? ' (未安装)' : ' (Not Installed)');
          }
          item.addEventListener('click', () => vscode.postMessage({ type: 'selectLanguage', payload: { languageKey: lang.key } }));
          languageList.appendChild(item);
        }
      }

      function renderTokenList() {
        const q = (tokenSearch.value || '').trim().toLowerCase();
        const tokens = (state.tokenTypes || []).filter(t => !q || t.toLowerCase().includes(q));
        tokenCount.textContent = '(' + tokens.length + ')';
        tokenList.innerHTML = '';
        for (const tokenType of tokens) {
          const item = document.createElement('div');
          item.className = 'item' + (tokenType === state.selectedTokenType ? ' selected' : '');
          item.textContent = tokenType;
          item.addEventListener('click', () => vscode.postMessage({ type: 'selectTokenType', payload: { tokenType } }));
          tokenList.appendChild(item);
        }
      }

      function applyEditorState() {
        themeNameEl.textContent = state.themeName || '';
        dirtyFlag.style.display = state.dirty ? 'inline' : 'none';
        scopeSelect.value = state.scope || 'workspace';
        layerSelect.value = state.layer || 'language';

        if (state.uiLanguage === 'zh-cn') {
          scopeLabelEl.textContent = '范围：';
          themeLabelEl.textContent = '主题：';
        } else {
          scopeLabelEl.textContent = 'Scope:';
          themeLabelEl.textContent = 'Theme:';
        }

        if (state.uiLanguage === 'zh-cn') {
          langSemanticLabelEl.textContent = '语义扩展开关';
          editorSemanticLabelEl.textContent = '编辑器语义响应';
        } else {
          langSemanticLabelEl.textContent = 'Semantic Extension';
          editorSemanticLabelEl.textContent = 'Editor Semantic Response';
        }

        if (state.languageSemanticHighlighting && state.languageSemanticHighlighting.exists) {
          langSemanticRowEl.style.display = 'flex';
          langSemanticToggleEl.title = state.selectedLanguageKey + '.semanticHighlighting.enabled';
          applyTriState(langSemanticBoxEl, langSemanticStateTextEl, state.languageSemanticHighlighting.state || 'inherit');
        } else {
          langSemanticRowEl.style.display = 'none';
          applyTriState(langSemanticBoxEl, langSemanticStateTextEl, 'inherit');
        }
        if (state.editorSemanticHighlightingOverride) {
          editorSemanticRowEl.style.display = 'flex';
          editorSemanticToggleEl.title = '[' + state.selectedLanguageKey + '].editor.semanticHighlighting.enabled';
          applyTriState(editorSemanticBoxEl, editorSemanticStateTextEl, state.editorSemanticHighlightingOverride.state || 'inherit');
        } else {
          applyTriState(editorSemanticBoxEl, editorSemanticStateTextEl, 'inherit');
        }

        if (state.layer === 'language' && state.semanticTokensAvailability && state.semanticTokensAvailability !== 'available' && state.semanticTokensAvailability !== 'unknown') {
          semanticAvailabilityHintEl.style.display = 'block';
          if (state.uiLanguage === 'zh-cn') {
            semanticAvailabilityHintEl.textContent =
              '提示：当前语言可能没有提供语义 Token（或数据为空），所以 editor.semanticTokenColorCustomizations 不一定会生效。这通常不是本扩展问题，而是语言服务能力/实现所致。' +
              ' 如需给该语言配色，可能需要使用 editor.tokenColorCustomizations（TextMate scopes）。你可以在“高级”里选择 TextMate 并粘贴 scope（例如 Inspect 里看到的 entity.name.function.definition.cpp）。';
          } else {
            semanticAvailabilityHintEl.textContent =
              'Note: this language may not provide semantic tokens (or returns empty data), so editor.semanticTokenColorCustomizations may not take effect. This is usually due to the language service. ' +
              ' You may need editor.tokenColorCustomizations (TextMate scopes) for coloring. You can use Advanced → TextMate and paste a scope (e.g. entity.name.function.definition.cpp from Inspect).';
          }
        } else {
          semanticAvailabilityHintEl.style.display = 'none';
          semanticAvailabilityHintEl.textContent = '';
        }

        const workspaceOption = scopeSelect.querySelector('option[value="workspace"]');
        if (workspaceOption) {
          workspaceOption.disabled = !state.hasWorkspace;
        }
        if (!state.hasWorkspace && scopeSelect.value === 'workspace') {
          scopeSelect.value = 'user';
        }

        fontFamilyEl.value = state.fontFamily || '';
        selectedTokenEl.textContent = state.useCustomSelector ? (state.selector || '') : (state.selectedTokenType ? state.selectedTokenType : '');
        tokenHelpEl.textContent = state.tokenHelp || '';
        overrideWarningEl.textContent = state.overrideWarning || '';
        overrideWarningEl.style.display = state.overrideWarning ? 'block' : 'none';

        semanticWarningEl.style.display = state.semanticHighlightingEnabled ? 'none' : 'block';

        const layerStyle = state.layerStyle || null;
        const effectiveStyle = state.effectiveStyle || null;

        // 标题右侧 tokenType 按“生效色”着色（无显式值则沿用默认前景色）
        selectedTokenEl.style.color = effectiveStyle && effectiveStyle.foreground ? effectiveStyle.foreground : '';

        useCustomSelectorEl.checked = !!state.useCustomSelector;
        customSelectorTypeEl.value = state.customSelectorType || 'semantic';
        customSelectorEl.value = state.customSelectorText || '';
        customSelectorTypeEl.disabled = !state.useCustomSelector;
        customSelectorEl.disabled = !state.useCustomSelector;
        customSelectorHintEl.style.display = state.useCustomSelector ? 'block' : 'none';
        if (state.uiLanguage === 'zh-cn') {
          customSelectorHintEl.textContent =
            state.customSelectorType === 'textmate'
              ? 'TextMate scopes 支持逗号/换行批量输入；建议从 “Developer: Inspect Editor Tokens and Scopes” 复制 scope。'
              : '语义 selector 形如：tokenType.modifier1.modifier2（例如 function.definition）。';
        } else {
          customSelectorHintEl.textContent =
            state.customSelectorType === 'textmate'
              ? 'TextMate scopes support comma/newline batch input; copy scopes from “Developer: Inspect Editor Tokens and Scopes”.'
              : 'Semantic selector format: tokenType.modifier1.modifier2 (e.g. function.definition).';
        }

        const isTextMateCustom = !!state.useCustomSelector && state.customSelectorType === 'textmate';
        modifierListEl.style.opacity = isTextMateCustom ? '0.55' : '1';
        modifierInfoEl.style.opacity = isTextMateCustom ? '0.55' : '1';

        renderModifierList();
        renderModifierInfo(effectiveStyle);

        // 编辑框默认展示“生效值”，避免看起来全是空白；但保存时仍按 selector 写入规则。
        const mergedFg = (layerStyle && layerStyle.foreground) ? layerStyle.foreground : (effectiveStyle && effectiveStyle.foreground ? effectiveStyle.foreground : '');
        fgText.value = mergedFg;
        fgColor.value = isValidHexColor(mergedFg) ? mergedFg : '#000000';
        boldChk.checked = !!((layerStyle && layerStyle.bold) || (effectiveStyle && effectiveStyle.bold));
        italicChk.checked = !!((layerStyle && layerStyle.italic) || (effectiveStyle && effectiveStyle.italic));
        underlineChk.checked = !!((layerStyle && layerStyle.underline) || (effectiveStyle && effectiveStyle.underline));

        const effectiveFg = effectiveStyle && effectiveStyle.foreground ? effectiveStyle.foreground : '';
        if (state.uiLanguage === 'zh-cn') {
          styleSourceEl.textContent =
            state.effectiveStyleSource === 'settings.themeRules'
              ? ('生效：' + (effectiveFg || '（无显式值）') + '（来自 settings：主题块 rules）')
              : state.effectiveStyleSource === 'settings.globalRules'
                ? ('生效：' + (effectiveFg || '（无显式值）') + '（来自 settings：顶层 rules）')
                : '生效：主题默认';
        } else {
          styleSourceEl.textContent =
            state.effectiveStyleSource === 'settings.themeRules'
              ? ('Effective: ' + (effectiveFg || '(no explicit value)') + ' (from settings: theme rules)')
              : state.effectiveStyleSource === 'settings.globalRules'
                ? ('Effective: ' + (effectiveFg || '(no explicit value)') + ' (from settings: global rules)')
                : 'Effective: theme default';
        }

        const disabled = state.useCustomSelector ? !((state.customSelectorText || '').trim()) : !state.selectedTokenType;
        fgColor.disabled = disabled;
        fgText.disabled = disabled;
        boldChk.disabled = disabled;
        italicChk.disabled = disabled;
        underlineChk.disabled = disabled;
      }

      function renderModifierInfo(effectiveStyle) {
        modifierInfoEl.textContent = '';
        if (!state.selectedTokenType) return;
        const selectorText = state.selector || '';
        const sel = document.createElement('span');
        sel.textContent = selectorText;
        if (effectiveStyle && effectiveStyle.foreground) {
          sel.style.color = effectiveStyle.foreground;
        }
        modifierInfoEl.appendChild(sel);
      }

      function renderModifierList() {
        modifierListEl.innerHTML = '';
        const mods = state.tokenModifiers || [];
        const selected = new Set(state.selectedModifiers || []);
        const disableAll = !state.selectedTokenType || (state.useCustomSelector && state.customSelectorType === 'textmate');
        for (const m of mods) {
          const label = document.createElement('label');
          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.checked = selected.has(m);
          chk.disabled = disableAll;
          chk.addEventListener('change', () => {
            const next = new Set(state.selectedModifiers || []);
            if (chk.checked) next.add(m); else next.delete(m);
            vscode.postMessage({ type: 'setTokenModifiers', payload: { modifiers: Array.from(next) } });
          });
          label.appendChild(chk);
          label.appendChild(document.createTextNode(' ' + m));
          modifierListEl.appendChild(label);
        }
      }

      function render() {
        renderLanguageList();
        renderTokenList();
        applyEditorState();
      }

      fontFamilyEl.addEventListener('input', () => {
        vscode.postMessage({ type: 'setFontFamily', payload: { fontFamily: fontFamilyEl.value } });
      });

      useCustomSelectorEl.addEventListener('change', () => {
        vscode.postMessage({ type: 'setCustomSelectorEnabled', payload: { enabled: useCustomSelectorEl.checked } });
      });

      customSelectorTypeEl.addEventListener('change', () => {
        vscode.postMessage({ type: 'setCustomSelectorType', payload: { selectorType: customSelectorTypeEl.value } });
      });

      customSelectorEl.addEventListener('input', () => {
        vscode.postMessage({ type: 'setCustomSelectorText', payload: { text: customSelectorEl.value } });
      });

      fgColor.addEventListener('input', () => {
        if (!state.selector) return;
        fgText.value = fgColor.value.toUpperCase();
        const style = normalizeStyleFromEditor();
        vscode.postMessage({
          type: 'setTokenStyle',
          payload: { selector: state.selector, style: styleIsEmpty(style) ? {} : style }
        });
      });

      fgText.addEventListener('input', () => {
        if (!state.selector) return;
        if (isValidHexColor((fgText.value || '').trim())) {
          fgColor.value = fgText.value.trim().toUpperCase();
        }
        const style = normalizeStyleFromEditor();
        vscode.postMessage({
          type: 'setTokenStyle',
          payload: { selector: state.selector, style: styleIsEmpty(style) ? {} : style }
        });
      });

      function onFontStyleChange() {
        if (!state.selector) return;
        const style = normalizeStyleFromEditor();
        vscode.postMessage({
          type: 'setTokenStyle',
          payload: { selector: state.selector, style: styleIsEmpty(style) ? {} : style }
        });
      }

      boldChk.addEventListener('change', onFontStyleChange);
      italicChk.addEventListener('change', onFontStyleChange);
      underlineChk.addEventListener('change', onFontStyleChange);

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'state') {
          state = msg.payload;
          render();
        }
      });

      render();
    </script>
  </body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function ensureTwoColumnLayout(): Promise<void> {
  try {
    await vscode.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      // 列表：配置：预览 = 1:1:3 => 左侧(列表+配置)=2/5，右侧预览=3/5
      groups: [{ size: 0.4 }, { size: 0.6 }]
    });
    return;
  } catch {
    // ignore
  }

  try {
    await vscode.commands.executeCommand('workbench.action.editorLayoutTwoColumns');
  } catch {
    // ignore
  }
}
