# Token Styler (WIP)

A GUI panel for configuring VS Code **Semantic Tokens** and **TextMate scopes**, with a real-rendered preview document.

> 中文版：see `README.md`.

## Features (current implementation)

- Live preview: opens a preview document on the right (`tokenstyler-preview:` virtual document; no workspace files are written)
- 3 edit modes (dropdown at the top of the token list):
  - Semantic: Language extension (from `contributes.semanticTokenTypes/modifiers`) → writes `editor.semanticTokenColorCustomizations`
  - Semantic: Standard (LSP 23) → writes `editor.semanticTokenColorCustomizations`
  - TextMate Scopes (copy scopes from Inspect) → writes `editor.tokenColorCustomizations`
- Write target: User / Workspace
- Font: writes `[language].editor.fontFamily` (stored/applied per scope)
- Semantic highlighting toggles:
  - `editor.semanticHighlighting.enabled`
  - `<language>.semanticHighlighting.enabled`
  - `[language].editor.semanticHighlighting.enabled`
- Session safety: if you close the panel without saving, all temporary changes (settings/font/toggles) are rolled back (also with a startup rollback fallback)

## Usage

1) Open Command Palette (Ctrl/Cmd+Shift+P)
2) Run one of:
   - `Token Styler: Open` (panel + preview)
   - `Token Styler: Open Preview` (preview only)
3) For cases where Inspect shows **TextMate scopes** (not semantic tokens), e.g. C/C++:
   - Run `Developer: Inspect Editor Tokens and Scopes` in the preview editor
   - Copy a scope (e.g. `entity.name.function.definition.cpp`)
   - In Token Styler, select `TextMate Scopes` from the token dropdown, paste into the search box and press Enter to select, then set color/styles

## Language & isolation (important)

- Both `editor.semanticTokenColorCustomizations` and `editor.tokenColorCustomizations` are **theme-scoped global rules** in VS Code; they cannot truly isolate per languageId.
- Many TextMate scopes include suffixes like `.cpp` / `.cs`; this is typically a grammar naming convention (so it “naturally” separates), but it is not a VS Code language-level isolation mechanism.

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
