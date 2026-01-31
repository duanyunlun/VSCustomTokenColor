# Token Styler (WIP)

A GUI panel for configuring VS Code **Semantic Tokens** and **TextMate scopes**, with a real-rendered preview document for WYSIWYG verification.

> 中文版：see `README.md`.

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
