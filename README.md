# Token Styler（开发中）

目标：提供语义 Token 配色的图形化配置与预览（见 `docs/`）。

## 开发与运行（Extension Development Host）

1) 安装依赖：`npm install`
2) 编译：`npm run compile`
3) 在 VS Code 打开本仓库，按 `F5` 启动 Extension Development Host

## 当前可用能力（MVP）

- `Token Styler: Open`：打开配置面板（左侧）并自动在右侧打开预览文档（真实 VS Code 渲染）
- `Token Styler: Open Preview`：单独打开预览文档（写入并打开工作区内 `.vscode/tokenstyler-preview/preview.cs` 或全局存储目录文件）
- 配置面板：顶部仅 4 个按钮（保存/恢复当前配置；保存/恢复所有语言预设）
- 语言列表：内置若干“官方/事实标准”语义 token 支持语言（未安装会提示安装并建议重载）
- Token Types：支持在“标准（LSP 23）”与“语言扩展（contributes.semanticTokenTypes）”两层间切换编辑
- 字体配置：可为所选语言配置 `editor.fontFamily`（以 VS Code language override 写入；按 scope+主题存储）

## 注意

- 当前为“静态模式（按主题）”写入：只会写入当前选择的主题 block（`[ThemeName]`）。
- TokenType 发现来源：
  - 标准层：内置 LSP 23 个标准 token types
  - 语言层：读取对应语言扩展的 `contributes.semanticTokenTypes`（若扩展未安装则该语言 token 列表为空）
- `editor.semanticTokenColorCustomizations` 是“按主题的全局规则”：对某个 tokenType/selector 的定制会影响所有提供该 tokenType 的语言（无法在 VS Code 原生层面做到真正按语言隔离）。

## 同步（Settings Sync）

- 本扩展的“用户级预设”使用 `globalState.setKeysForSync(...)` 标记参与 VS Code Settings Sync（需要用户在 VS Code 启用同步）。
