import * as vscode from 'vscode';
import { TOKEN_STYLER_PREVIEW_SCHEME } from './constants';
import { applyLanguageFontFamily, getLanguageFontFamily } from './fontApplier';
import { getSemanticTokenTypesFromExtension, isExtensionInstalled } from './languageContributions';
import { OFFICIAL_LANGUAGES, OfficialLanguage } from './officialLanguages';
import {
  getLanguagePreset,
  initSync,
  loadPresets,
  PresetScope,
  savePresets,
  upsertLanguagePreset
} from './presetStore';
import { TokenStylerPreviewProvider } from './previewProvider';
import { TokenStyle, TokenStyleRules } from './profile';
import {
  applyRulesToSettingsSilently,
  restoreSemanticTokenCustomizationsSnapshotSilently,
  takeSemanticTokenColorCustomizationsSnapshot
} from './settingsApplier';
import { getPreviewContent, getPreviewFileExtension, PreviewLanguageKey } from './previewSnippets';

type WebviewLanguageItem = {
  key: string;
  label: string;
  installed: boolean;
};

type WebviewState = {
  themeName: string;
  scope: PresetScope;
  languages: WebviewLanguageItem[];
  selectedLanguageKey: string;
  tokenTypes: string[];
  selectedTokenType?: string;
  fontFamily: string;
  style?: TokenStyle;
  dirty: boolean;
};

type TokenSelection = { languageKey: string; tokenType: string };

export function activate(context: vscode.ExtensionContext): void {
  initSync(context);

  const previewProvider = new TokenStylerPreviewProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(TOKEN_STYLER_PREVIEW_SCHEME, previewProvider));

  context.subscriptions.push(
    vscode.commands.registerCommand('tokenstyler.openPreview', async () => {
      const uri = await ensurePreviewFile(context, 'csharp');
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tokenstyler.open', async () => {
      await ensureTwoColumnLayout();

      const themeName = getCurrentThemeName();
      let scope: PresetScope = 'workspace';
      const languages = getLanguageItems();

      // 默认选第一个语言
      let selectedLanguage = OFFICIAL_LANGUAGES[0]!;
      let presetsByTheme = loadPresets(context, scope);
      let selectedTokenType: string | undefined;

      // 当前语言的“已保存预设”与“编辑草稿”
      let savedPreset = getLanguagePreset(presetsByTheme, themeName, selectedLanguage.key) ?? {
        tokenRules: {},
        fontFamily: ''
      };
      let draftPreset = clonePreset(savedPreset);
      let dirty = false;
      let sessionSnapshotTaken = false;
      let preEditFontFamily: string | undefined;

      const panel = vscode.window.createWebviewPanel('tokenStyler', 'Token Styler', vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true
      });

      const openOrRevealPreview = async (): Promise<void> => {
        const uri = await ensurePreviewFile(context, selectedLanguage.key as PreviewLanguageKey);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Two });
      };

      const computeTokenTypes = (): string[] => {
        const extId = selectedLanguage.recommendedExtensionId;
        if (!isExtensionInstalled(extId)) {
          return [];
        }
        return getSemanticTokenTypesFromExtension(extId);
      };

      const buildState = (): WebviewState => {
        const tokenTypes = computeTokenTypes();
        const nextSelectedTokenType =
          selectedTokenType && tokenTypes.includes(selectedTokenType)
            ? selectedTokenType
            : tokenTypes.length > 0
              ? tokenTypes[0]
              : undefined;
        selectedTokenType = nextSelectedTokenType;
        const style = selectedTokenType ? draftPreset.tokenRules[selectedTokenType] : undefined;
        return {
          themeName,
          scope,
          languages: getLanguageItems(),
          selectedLanguageKey: selectedLanguage.key,
          tokenTypes,
          selectedTokenType,
          fontFamily: draftPreset.fontFamily ?? '',
          style,
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
        preEditFontFamily = await getLanguageFontFamily(selectedLanguage.languageId, scope);
        sessionSnapshotTaken = true;
      };

      const applyPreview = async (): Promise<void> => {
        await ensureSessionSnapshot();
        // WYSIWYG：把“全部语言预设 + 当前语言草稿”合并写入 settings
        presetsByTheme = loadPresets(context, scope);
        const unionRules = buildUnionRules(presetsByTheme, themeName, selectedLanguage.key, draftPreset.tokenRules);
        await applyRulesToSettingsSilently(
          context,
          unionRules,
          themeName,
          scope === 'user' ? 'global' : 'workspace'
        );

        // 字体：仅对当前语言做临时应用（不影响其它语言）
        await applyLanguageFontFamily(selectedLanguage.languageId, draftPreset.fontFamily, scope);

        await openOrRevealPreview();
      };

      const applyAllPresetsToSettings = async (): Promise<void> => {
        presetsByTheme = loadPresets(context, scope);
        const unionRules = buildUnionRules(
          presetsByTheme,
          themeName,
          // 不叠加草稿：只应用已保存预设
          '',
          {}
        );
        await applyRulesToSettingsSilently(context, unionRules, themeName, scope === 'user' ? 'global' : 'workspace');

        const themePresets = presetsByTheme[themeName] ?? {};
        for (const lang of OFFICIAL_LANGUAGES) {
          const preset = themePresets[lang.key];
          if (!preset) {
            continue;
          }
          await applyLanguageFontFamily(lang.languageId, preset.fontFamily, scope);
        }
      };

      const restoreToSaved = async (): Promise<void> => {
        presetsByTheme = loadPresets(context, scope);
        savedPreset = getLanguagePreset(presetsByTheme, themeName, selectedLanguage.key) ?? { tokenRules: {}, fontFamily: '' };
        draftPreset = clonePreset(savedPreset);
        dirty = false;
        if (sessionSnapshotTaken) {
          const target = scope === 'user' ? 'global' : 'workspace';
          await restoreSemanticTokenCustomizationsSnapshotSilently(context, target);
          await applyLanguageFontFamily(selectedLanguage.languageId, preEditFontFamily, scope);
          sessionSnapshotTaken = false;
          preEditFontFamily = undefined;
        }
        await applyAllPresetsToSettings(); // 用户主动“恢复”，再应用已保存预设
        await postState();
      };

      const saveCurrentLanguagePreset = async (): Promise<void> => {
        presetsByTheme = loadPresets(context, scope);
        presetsByTheme = upsertLanguagePreset(presetsByTheme, themeName, selectedLanguage.key, {
          tokenRules: { ...draftPreset.tokenRules },
          fontFamily: draftPreset.fontFamily ?? ''
        });
        await savePresets(context, scope, presetsByTheme);
        savedPreset = clonePreset(draftPreset);
        dirty = false;
        await applyAllPresetsToSettings();
        sessionSnapshotTaken = false;
        preEditFontFamily = undefined;
        await postState();
      };

      const saveAllLanguages = async (): Promise<void> => {
        if (dirty) {
          await saveCurrentLanguagePreset();
          return;
        }
        await applyAllPresetsToSettings();
        await postState();
      };

      const restoreAllPresets = async (): Promise<void> => {
        presetsByTheme = loadPresets(context, scope);
        savedPreset = getLanguagePreset(presetsByTheme, themeName, selectedLanguage.key) ?? { tokenRules: {}, fontFamily: '' };
        draftPreset = clonePreset(savedPreset);
        dirty = false;
        if (sessionSnapshotTaken) {
          const target = scope === 'user' ? 'global' : 'workspace';
          await restoreSemanticTokenCustomizationsSnapshotSilently(context, target);
          await applyLanguageFontFamily(selectedLanguage.languageId, preEditFontFamily, scope);
          sessionSnapshotTaken = false;
          preEditFontFamily = undefined;
        }
        await applyAllPresetsToSettings();
        await postState();
      };

      // 初始：加载 token list、打开预览、渲染 state
      panel.webview.html = getWebviewHtml(panel.webview, buildState());
      await openOrRevealPreview();

      panel.onDidDispose(() => {
        // 这里不能再 postMessage（webview 已销毁），只做 settings 回滚
        if (!dirty) {
          return;
        }
        void (async () => {
          // 未保存即恢复（回滚到编辑前快照）
          if (sessionSnapshotTaken) {
            const target = scope === 'user' ? 'global' : 'workspace';
            await restoreSemanticTokenCustomizationsSnapshotSilently(context, target);
            await applyLanguageFontFamily(selectedLanguage.languageId, preEditFontFamily, scope);
          }
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
            if (nextScope === scope) {
              return;
            }
            // 切换 scope 前：未保存即恢复
            if (dirty) {
              if (sessionSnapshotTaken) {
                const target = scope === 'user' ? 'global' : 'workspace';
                await restoreSemanticTokenCustomizationsSnapshotSilently(context, target);
                await applyLanguageFontFamily(selectedLanguage.languageId, preEditFontFamily, scope);
                sessionSnapshotTaken = false;
                preEditFontFamily = undefined;
              }
              dirty = false;
            }
            scope = nextScope;
            presetsByTheme = loadPresets(context, scope);
            savedPreset = getLanguagePreset(presetsByTheme, themeName, selectedLanguage.key) ?? { tokenRules: {}, fontFamily: '' };
            draftPreset = clonePreset(savedPreset);
            dirty = false;
            await postState();
            return;
          }

          if (msg.type === 'selectLanguage') {
            const payload = msg.payload as { languageKey?: unknown };
            if (typeof payload.languageKey !== 'string') {
              return;
            }
            const next = OFFICIAL_LANGUAGES.find((l) => l.key === payload.languageKey);
            if (!next) {
              return;
            }

            // 切换语言前：未保存即恢复
            if (dirty) {
              if (sessionSnapshotTaken) {
                const target = scope === 'user' ? 'global' : 'workspace';
                await restoreSemanticTokenCustomizationsSnapshotSilently(context, target);
                await applyLanguageFontFamily(selectedLanguage.languageId, preEditFontFamily, scope);
                sessionSnapshotTaken = false;
                preEditFontFamily = undefined;
              }
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
          savedPreset = getLanguagePreset(presetsByTheme, themeName, selectedLanguage.key) ?? { tokenRules: {}, fontFamily: '' };
          draftPreset = clonePreset(savedPreset);
          dirty = false;
          selectedTokenType = undefined;
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
          await postState();
          return;
        }

        if (msg.type === 'setFontFamily') {
          const payload = msg.payload as { fontFamily?: unknown };
          const fontFamily = typeof payload.fontFamily === 'string' ? payload.fontFamily : '';
          draftPreset = { ...draftPreset, fontFamily };
          dirty = true;
          await applyPreview();
          await postState();
          return;
        }

        if (msg.type === 'setTokenStyle') {
          const payload = msg.payload as { tokenType?: unknown; style?: unknown };
          if (typeof payload.tokenType !== 'string' || !payload.tokenType.trim()) {
            return;
          }
          const tokenType = payload.tokenType.trim();
          const style = sanitizeTokenStyle(payload.style);
          const nextRules = { ...draftPreset.tokenRules };
          if (style) {
            nextRules[tokenType] = style;
          } else {
            delete nextRules[tokenType];
          }
          draftPreset = { ...draftPreset, tokenRules: nextRules };
          dirty = true;
          selectedTokenType = tokenType;
          await applyPreview();
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
        if (msg.type === 'actionSaveAll') {
          await saveAllLanguages();
          return;
        }
        if (msg.type === 'actionRestoreAll') {
          await restoreAllPresets();
          return;
        }
      });
    })
  );
}

export function deactivate(): void {}

function getLanguageItems(): WebviewLanguageItem[] {
  return OFFICIAL_LANGUAGES.map((l) => ({
    key: l.key,
    label: l.label,
    installed: isExtensionInstalled(l.recommendedExtensionId)
  }));
}

function getCurrentThemeName(): string {
  return vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '';
}

function buildUnionRules(
  presetsByTheme: Record<string, Record<string, { tokenRules: TokenStyleRules }>>,
  themeName: string,
  activeLanguageKey: string,
  activeDraftRules: TokenStyleRules
): TokenStyleRules {
  const theme = presetsByTheme[themeName] ?? {};
  const output: TokenStyleRules = {};

  // 先合并所有已保存预设
  for (const lang of OFFICIAL_LANGUAGES) {
    const preset = theme[lang.key];
    if (!preset) {
      continue;
    }
    Object.assign(output, preset.tokenRules ?? {});
  }

  // 再覆盖当前语言草稿（未保存也能预览）
  if (activeLanguageKey) {
    Object.assign(output, activeDraftRules);
  }

  return output;
}

// 已改为“编辑前快照回滚”，不再使用该函数。

async function ensurePreviewFile(context: vscode.ExtensionContext, languageKey: PreviewLanguageKey): Promise<vscode.Uri> {
  const ext = getPreviewFileExtension(languageKey);
  const content = getPreviewContent(languageKey);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const baseDir = workspaceFolder ? vscode.Uri.joinPath(workspaceFolder, '.vscode', 'tokenstyler-preview') : context.globalStorageUri;
  const fileUri = vscode.Uri.joinPath(baseDir, `preview.${ext}`);

  await vscode.workspace.fs.createDirectory(baseDir);
  await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));

  return fileUri;
}

function clonePreset(preset: { tokenRules: TokenStyleRules; fontFamily?: string }): { tokenRules: TokenStyleRules; fontFamily?: string } {
  return {
    tokenRules: { ...(preset.tokenRules ?? {}) },
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
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
      button { padding: 6px 10px; }
      input, select { font-family: var(--vscode-editor-font-family); }
      .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .muted { opacity: 0.8; }
      .hint { opacity: 0.8; margin-top: 8px; line-height: 1.4; }
      .grid { display: grid; grid-template-columns: 160px 1fr 320px; gap: 10px; margin-top: 10px; }
      .panel { border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; }
      .panelHeader { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; gap: 8px; align-items: center; }
      .panelBody { padding: 8px 8px; }
      .list { max-height: calc(100vh - 180px); overflow: auto; }
      .item { padding: 6px 8px; border-radius: 4px; cursor: pointer; }
      .item:hover { background: var(--vscode-list-hoverBackground); }
      .item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
      .field { display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; margin-top: 10px; }
      .inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .danger { color: var(--vscode-errorForeground); }
    </style>
  </head>
  <body>
    <div class="row">
      <button id="btnSaveCurrent">保存当前语言配置</button>
      <button id="btnRestoreCurrent">恢复当前语言配置</button>
      <button id="btnSaveAll">保存所有语言配置</button>
      <button id="btnRestoreAll">恢复所有语言预设</button>
      <span class="muted" style="margin-left:12px">Scope:</span>
      <select id="scopeSelect">
        <option value="workspace">工作区</option>
        <option value="user">用户</option>
      </select>
      <span class="muted" style="margin-left:12px">Theme:</span>
      <span id="themeName"></span>
      <span id="dirtyFlag" class="danger" style="display:none">未保存</span>
    </div>

    <div class="grid">
      <div class="panel">
        <div class="panelHeader"><strong>语言</strong></div>
        <div class="panelBody list" id="languageList"></div>
      </div>

      <div class="panel">
        <div class="panelHeader">
          <strong>Token Types</strong>
          <span class="muted" id="tokenCount"></span>
        </div>
        <div class="panelBody">
          <input id="tokenSearch" type="text" placeholder="搜索 tokenType..." style="width:100%" />
          <div class="list" id="tokenList" style="margin-top:8px"></div>
        </div>
      </div>

      <div class="panel">
        <div class="panelHeader"><strong>配置</strong><span class="muted" id="selectedToken"></span></div>
        <div class="panelBody">
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
            说明：修改会立即作用到右侧预览（通过临时写入 settings 实现）。未点击“保存”则切换语言/关闭面板会自动恢复。注意：语义 token 配色是“按主题的全局规则”，本面板的“按语言”主要用于管理与发现 tokenType。
          </div>
        </div>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      let state = ${serializedState};

      const themeNameEl = document.getElementById('themeName');
      const dirtyFlag = document.getElementById('dirtyFlag');
      const scopeSelect = document.getElementById('scopeSelect');

      const languageList = document.getElementById('languageList');
      const tokenSearch = document.getElementById('tokenSearch');
      const tokenList = document.getElementById('tokenList');
      const tokenCount = document.getElementById('tokenCount');

      const selectedTokenEl = document.getElementById('selectedToken');
      const fontFamilyEl = document.getElementById('fontFamily');
      const fgColor = document.getElementById('fgColor');
      const fgText = document.getElementById('fgText');
      const boldChk = document.getElementById('boldChk');
      const italicChk = document.getElementById('italicChk');
      const underlineChk = document.getElementById('underlineChk');

      document.getElementById('btnSaveCurrent').addEventListener('click', () => vscode.postMessage({ type: 'actionSaveCurrent' }));
      document.getElementById('btnRestoreCurrent').addEventListener('click', () => vscode.postMessage({ type: 'actionRestoreCurrent' }));
      document.getElementById('btnSaveAll').addEventListener('click', () => vscode.postMessage({ type: 'actionSaveAll' }));
      document.getElementById('btnRestoreAll').addEventListener('click', () => vscode.postMessage({ type: 'actionRestoreAll' }));

      scopeSelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'setScope', payload: { scope: scopeSelect.value } });
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
          item.textContent = lang.label + (lang.installed ? '' : ' (未安装)');
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

        fontFamilyEl.value = state.fontFamily || '';
        selectedTokenEl.textContent = state.selectedTokenType ? state.selectedTokenType : '';

        const style = state.style || null;
        const fg = style && style.foreground ? style.foreground : '';
        fgText.value = fg;
        fgColor.value = isValidHexColor(fg) ? fg : '#000000';
        boldChk.checked = !!(style && style.bold);
        italicChk.checked = !!(style && style.italic);
        underlineChk.checked = !!(style && style.underline);

        const disabled = !state.selectedTokenType;
        fgColor.disabled = disabled;
        fgText.disabled = disabled;
        boldChk.disabled = disabled;
        italicChk.disabled = disabled;
        underlineChk.disabled = disabled;
      }

      function render() {
        renderLanguageList();
        renderTokenList();
        applyEditorState();
      }

      fontFamilyEl.addEventListener('input', () => {
        vscode.postMessage({ type: 'setFontFamily', payload: { fontFamily: fontFamilyEl.value } });
      });

      fgColor.addEventListener('input', () => {
        if (!state.selectedTokenType) return;
        fgText.value = fgColor.value.toUpperCase();
        const style = normalizeStyleFromEditor();
        vscode.postMessage({
          type: 'setTokenStyle',
          payload: { tokenType: state.selectedTokenType, style: styleIsEmpty(style) ? {} : style }
        });
      });

      fgText.addEventListener('input', () => {
        if (!state.selectedTokenType) return;
        if (isValidHexColor((fgText.value || '').trim())) {
          fgColor.value = fgText.value.trim().toUpperCase();
        }
        const style = normalizeStyleFromEditor();
        vscode.postMessage({
          type: 'setTokenStyle',
          payload: { tokenType: state.selectedTokenType, style: styleIsEmpty(style) ? {} : style }
        });
      });

      function onFontStyleChange() {
        if (!state.selectedTokenType) return;
        const style = normalizeStyleFromEditor();
        vscode.postMessage({
          type: 'setTokenStyle',
          payload: { tokenType: state.selectedTokenType, style: styleIsEmpty(style) ? {} : style }
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
