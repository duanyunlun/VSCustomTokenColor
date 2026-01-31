# Token Styler（开发中）

一个用于配置 VS Code 语义 Token（Semantic Tokens）与 TextMate scopes 的 GUI 面板，并提供真实渲染的预览文档。

> English: see `README.en.md`.

## 功能概览（当前实现）

- 真实预览：打开面板后自动在右侧打开预览文档（虚拟文档 `tokenstyler-preview:`；不会写入工作区文件）
- 三种编辑模式（Token 列表顶部下拉）：
  - 语义：语言扩展（来自扩展 `contributes.semanticTokenTypes/modifiers`）→ 写入 `editor.semanticTokenColorCustomizations`
  - 语义：标准（LSP 23）→ 写入 `editor.semanticTokenColorCustomizations`
  - TextMate Scopes（从 Inspect 复制 scope）→ 写入 `editor.tokenColorCustomizations`
- Scope（写入位置）：用户（User）/ 工作区（Workspace）
- 字体：按语言写入 `[language].editor.fontFamily`（按 scope 存储/应用）
- 语义高亮开关：可配置 `editor.semanticHighlighting.enabled`、`<language>.semanticHighlighting.enabled`、`[language].editor.semanticHighlighting.enabled`
- 会话安全：未保存关闭面板会自动回滚本次会话对 settings/字体/开关的临时更改（下次启动也会尝试兜底回滚未完成会话）

## 使用方式

1) 打开命令面板（Ctrl/Cmd+Shift+P）
2) 执行以下命令之一：
   - `Token Styler: Open`：打开配置面板 + 预览
   - `Token Styler: Open Preview`：只打开预览
3) 若要配置 C/C++ 这类“Inspect 显示的是 textmate scopes、而不是语义 token”的高亮：
   - 在预览中执行 `Developer: Inspect Editor Tokens and Scopes` 或者 快捷键：Ctrl+Shift+I (默认就是这个)
   - 复制弹窗中的 scope（例如 `entity.name.function.definition.cpp`）
   - 回到 Token Styler，Token 下拉选择 `TextMate Scopes`，在搜索框粘贴并回车选中，再设置颜色/样式

## 语言与隔离（重要）

- `editor.semanticTokenColorCustomizations` 与 `editor.tokenColorCustomizations` 都是“按主题的全局规则”，无法做到真正意义上的“按 languageId 隔离”。
- TextMate scopes 常带 `.cpp/.cs` 等后缀，这通常是 grammar 的命名约定，因而在实践中会“自然区分语言”，但并非 VS Code 的语言级隔离机制。

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
