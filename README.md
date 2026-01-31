# Token Styler（WIP）

一个用于配置 VS Code **语义 Token（Semantic Tokens）** 与 **TextMate scopes** 的 GUI 面板，并提供真实渲染的预览文档（用于所见即所得验证）。

语言 / Language： [中文](#中文) | [English](#english)

说明：VS Code 扩展详情页/Marketplace 目前只会展示一个 README（即 `README.md`），无法随 UI 语言自动切换；因此这里采用同一 README 内提供中英文分区的方式。

---

## 中文

## 适用场景（你可能需要它的原因）

- 你想用 UI 方式配置高亮（而不是手写 settings JSON）。
- 你想“改一个 token 就立刻看到预览效果”，避免反复开关文件/切主题验证。
- 你遇到一种常见情况：**Inspect 面板里看到的是 TextMate scopes（如 `entity.name.function.definition.cpp`），而不是语义 token** —— 这时需要写入 `editor.tokenColorCustomizations`，而不是 `editor.semanticTokenColorCustomizations`。

## 功能概览（当前实现）

- 真实预览：打开面板后自动在右侧打开预览文档（虚拟文档 `tokenstyler-preview:`；不会写入工作区文件）
- Tokens 顶部下拉支持 3 种编辑层级：
  - `语义：语言扩展`（从语言扩展的 `contributes.semanticTokenTypes/modifiers` 读取列表）→ 写入 `editor.semanticTokenColorCustomizations`
  - `语义：标准（LSP）`（使用 LSP 标准 token types/modifiers）→ 写入 `editor.semanticTokenColorCustomizations`
  - `TextMate Scopes`（从 Inspect 复制 scope）→ 写入 `editor.tokenColorCustomizations`
- 范围（写入位置）：`用户` / `工作区`
- 字体：按语言写入 `[languageId].editor.fontFamily`（在扩展内按“主题+语言”保存，并可一键应用）
- 语义高亮开关（三态）：
  - `editor.semanticHighlighting.enabled`（全局总开关）
  - `<languageId>.semanticHighlighting.enabled`
  - `[languageId].editor.semanticHighlighting.enabled`
- 会话安全：修改会立即用于预览（通过“临时写入 settings”实现）；若未点击“保存当前配置”，关闭面板/切语言/切范围会自动回滚本次会话更改（启动时也会兜底回滚未完成会话）

## 使用方式

### 1) 打开面板与预览

1) 打开命令面板（Ctrl/Cmd+Shift+P）
2) 执行以下命令之一：
   - `Token Styler: Open`：打开配置面板 + 预览
   - `Token Styler: Open Preview`：只打开预览

### 2) 选择“范围 / 语言 / 编辑层级”

面板顶部：

- `范围`：工作区 / 用户
  - `用户`：写入用户 settings（影响你的所有工作区）
  - `工作区`：写入当前工作区 settings（只影响当前工作区）
- `Tokens` 右上角下拉（编辑层级）：
  - `语义：语言扩展`：当你希望使用语言扩展自定义的 token types/modifiers 时选它
  - `语义：标准（LSP）`：当你只需要标准 token types/modifiers 时选它
  - `TextMate Scopes`：当你要配置 Inspect 里看到的 scope（例如 `.cpp/.cs` 后缀那种）时选它

### 3) 选择 Token/Scope，并设置样式

- 语义模式：左侧选择 `tokenType`，右侧勾选 `modifiers`，最终 selector 形如：
  - `function`
  - `function.declaration`
  - `function.declaration.static`（多个 modifier 会用 `.` 拼接）
- TextMate Scopes 模式：selector 直接就是 scope 字符串，例如：
  - `entity.name.function.definition.cpp`
  - 输入/粘贴到搜索框，按回车可直接选中该 scope

样式（当前支持）：`foreground`（颜色）、`bold`、`italic`、`underline`。

### 4) 保存 / 恢复 / 回滚（很重要）

- 修改会立即作用到右侧预览（通过临时写入 settings 实现）。
- `保存当前配置`：把当前草稿保存为扩展内预设，并让 settings 保持为当前值。
- `恢复当前配置`：丢弃未保存改动，恢复为“上次保存的配置”。
- 若你做了改动但没有保存：关闭面板、切换语言、切换范围时会自动回滚，避免污染 settings。

### 5) 处理 “C/C++ function token（红框）找不到 semantic token 定义” 的情况

如果你看到的红框 selector 是类似 `entity.name.function.definition.cpp`：

1) 在预览编辑器里运行：`Developer: Inspect Editor Tokens and Scopes`
2) 复制弹窗中的 TextMate scope
3) 回到 Token Styler：`Tokens` 下拉选择 `TextMate Scopes`，粘贴到搜索框并回车选中，再设置颜色/样式

## 语言与隔离（重要）

- `editor.semanticTokenColorCustomizations` 与 `editor.tokenColorCustomizations` 都是“按主题的全局规则”，无法做到真正意义上的“按 languageId 隔离”。
- TextMate scopes 常带 `.cpp/.cs` 等后缀，这通常是 grammar 的命名约定，因而在实践中会“自然区分语言”，但并非 VS Code 的语言级隔离机制。

## semanticTokenColorCustomizations vs tokenColorCustomizations（区别与建议）

- `editor.semanticTokenColorCustomizations`：用于 **Semantic Tokens**（依赖语言服务/LSP 是否真的产出语义 token）。优点是语义更稳定；缺点是某些语言/某些场景可能根本没有语义 token 数据，配置不会生效。
- `editor.tokenColorCustomizations`：用于 **TextMate scopes**（来自语法高亮 grammar）。优点是覆盖面广；缺点是 scope 命名更“语法实现相关”。

建议：
1) 优先用语义 token（如果该语言确实有语义 token 数据）
2) 不生效或 Inspect 里只看到 scopes → 用 TextMate Scopes 模式

## 扩展显示语言（中文/英文）

- 扩展在 VS Code 中显示的文本（扩展名、描述、命令标题等）会跟随 VS Code 的 UI 语言：
  - 中文环境显示中文
  - 英文环境显示英文

## 开发与运行（Extension Development Host）

1) 安装依赖：`npm install`
2) 编译：`npm run compile`
3) 在 VS Code 打开本仓库，按 `F5` 启动 Extension Development Host

## 同步（Settings Sync）

- 本扩展的“用户级预设”使用 `globalState.setKeysForSync(...)` 标记参与 VS Code Settings Sync（需要用户在 VS Code 启用同步）。

---

## English

> Full English version: see `README.en.md` (same content as below).

## When to use this

- You want a UI for token coloring instead of hand-editing settings JSON.
- You want instant preview while tweaking styles.
- You hit a common case: **Inspect shows TextMate scopes (e.g. `entity.name.function.definition.cpp`) instead of semantic tokens** — then you must use `editor.tokenColorCustomizations` rather than `editor.semanticTokenColorCustomizations`.

## Features (current implementation)

- Live preview: opens a preview document on the right (`tokenstyler-preview:` virtual document; no workspace files are written)
- 3 edit layers (dropdown at the top of the token list):
  - `Semantic: Language extension` (reads types/modifiers from `contributes.semanticTokenTypes/modifiers`) → writes `editor.semanticTokenColorCustomizations`
  - `Semantic: Standard (LSP)` (uses LSP standard token types/modifiers) → writes `editor.semanticTokenColorCustomizations`
  - `TextMate Scopes` (copy scopes from Inspect) → writes `editor.tokenColorCustomizations`
- Scope (write target): Workspace / User
- Font: writes `[languageId].editor.fontFamily` (saved inside the extension per theme+language, one-click apply)
- Semantic highlighting toggles (tri-state):
  - `editor.semanticHighlighting.enabled`
  - `<languageId>.semanticHighlighting.enabled`
  - `[languageId].editor.semanticHighlighting.enabled`
- Session safety: changes are applied immediately for preview (via temporary settings writes); if you close/switch without saving, changes are rolled back (also with a startup rollback fallback)

## Usage

### 1) Open panel + preview

1) Open Command Palette (Ctrl/Cmd+Shift+P)
2) Run one of:
   - `Token Styler: Open` (panel + preview)
   - `Token Styler: Open Preview` (preview only)

### 2) Choose Scope / Language / Layer

- `Scope`: Workspace / User
  - `User` writes to user settings (affects all your workspaces)
  - `Workspace` writes to current workspace settings
- `Layer` (token dropdown):
  - `Semantic: Language extension`: when you need extension-defined token types/modifiers
  - `Semantic: Standard (LSP)`: when you only need standard token types/modifiers
  - `TextMate Scopes`: when you want to style scopes shown in Inspect (often with `.cpp/.cs` suffixes)

### 3) Pick a token/scope and set styles

- Semantic layers: pick a `tokenType` and check `modifiers`; selector format:
  - `function`
  - `function.declaration`
  - `function.declaration.static` (multiple modifiers are joined by `.`)
- TextMate Scopes layer: the selector is the scope string itself, e.g. `entity.name.function.definition.cpp`
  - Paste into the search box and press Enter to select

Styles supported: `foreground`, `bold`, `italic`, `underline`.

### 4) Save / Restore / Rollback (important)

- Changes take effect immediately in the preview (via temporary settings writes).
- `Save current`: saves the current draft into the extension presets and keeps settings as-is.
- `Restore current`: discards unsaved changes and restores the last saved state.
- If you changed something but didn’t save: closing the panel, switching language, or switching scope will roll back changes to avoid polluting settings.

### 5) When “C/C++ function token” has no semantic token

If the selector you want looks like `entity.name.function.definition.cpp`:

1) In the preview editor run: `Developer: Inspect Editor Tokens and Scopes`
2) Copy the TextMate scope
3) In Token Styler choose `TextMate Scopes`, paste into search and press Enter, then set styles

## Language & isolation (important)

- Both `editor.semanticTokenColorCustomizations` and `editor.tokenColorCustomizations` are **theme-scoped global rules** in VS Code; they cannot truly isolate per languageId.
- Many TextMate scopes include suffixes like `.cpp` / `.cs`; this is typically a grammar naming convention (so it “naturally” separates), but it is not a VS Code language-level isolation mechanism.

## semanticTokenColorCustomizations vs tokenColorCustomizations

- `editor.semanticTokenColorCustomizations`: for **Semantic Tokens** (depends on whether the language service actually produces semantic tokens). More semantic/stable, but may not work for languages/scenarios with no semantic tokens.
- `editor.tokenColorCustomizations`: for **TextMate scopes** (grammar-based). Broad coverage, but scope names are grammar-implementation specific.

Recommendation:
1) Prefer semantic tokens when available
2) If it doesn’t apply / Inspect only shows scopes → use TextMate Scopes layer

## Extension UI language (Chinese/English)

- The extension’s display texts in VS Code (name, description, command titles) follow the VS Code UI language:
  - Chinese UI → Chinese texts
  - English UI → English texts

## Development

1) Install deps: `npm install`
2) Build: `npm run compile`
3) Open this repo in VS Code and press `F5` to run Extension Development Host

## Settings Sync

- User presets are marked for Settings Sync via `globalState.setKeysForSync(...)` (requires VS Code Settings Sync enabled by the user).
