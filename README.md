# Token Styler（开发中）

目标：提供语义 Token 配色的图形化配置与预览（见 `docs/`）。

## 开发与运行（Extension Development Host）

1) 安装依赖：`npm install`
2) 编译：`npm run compile`
3) 在 VS Code 打开本仓库，按 `F5` 启动 Extension Development Host

## 当前可用能力（MVP）

- `Token Styler: Open`：打开配置面板（左侧）并自动在右侧打开预览文档（真实 VS Code 渲染）
- `Token Styler: Open Preview`：单独打开预览文档（使用虚拟文档 `tokenstyler-preview:`；不会在工作区写入文件）
- 配置面板：顶部目前只有 2 个按钮（保存当前配置 / 恢复当前配置），并提供 Scope（用户/工作区）、主题名与“未保存”提示
- 语言列表：内置若干“官方/事实标准”语义 token 支持语言；当前仅展示“已安装/内置”的语言（若未安装扩展，需要先安装对应扩展后才会出现在列表中）
- Token Types：支持在“标准（LSP 23）”与“语言扩展（contributes.semanticTokenTypes）”两层间切换编辑
- 字体配置：可为所选语言配置 `editor.fontFamily`（以 VS Code language override 写入；按 scope+主题存储）
- 语义开关：支持编辑 `editor.semanticHighlighting.enabled`、`<language>.semanticHighlighting.enabled`、以及 `[language].editor.semanticHighlighting.enabled`（三态：继承/开/关）
- 高级：支持输入自定义 selector；可切换为 TextMate scopes 模式写入 `editor.tokenColorCustomizations`（适用于 Inspect 面板里显示的 textmate scopes）
- 会话安全：未保存时关闭面板会自动回滚本次会话对 settings/字体/语义开关的临时更改（下次启动也会尝试自动回滚未完成会话）

## 注意

- 当前为“静态模式（按主题）”写入：只会写入当前选择的主题 block（`[ThemeName]`）。
- TokenType 发现来源：
  - 标准层：内置 LSP 23 个标准 token types
  - 语言层：读取对应语言扩展的 `contributes.semanticTokenTypes`（若扩展未安装则该语言不会出现在语言列表中）
- `editor.semanticTokenColorCustomizations` 是“按主题的全局规则”：对某个 tokenType/selector 的定制会影响所有提供该 tokenType 的语言（无法在 VS Code 原生层面做到真正按语言隔离）。

## 同步（Settings Sync）

- 本扩展的“用户级预设”使用 `globalState.setKeysForSync(...)` 标记参与 VS Code Settings Sync（需要用户在 VS Code 启用同步）。
