2026-01-31 09:10:00

# VS Code Marketplace 发布流程（Token Styler）

目标：将本扩展发布到 VS Code 扩展市场（Visual Studio Marketplace）。

## 0. 前置约束
1) Marketplace 的扩展 ID = `publisher.name`：
   - `name`：来自 `package.json` 的 `"name"`
   - `publisher`：来自 `package.json` 的 `"publisher"`（需要与你在 Marketplace 创建的 Publisher ID 一致）
2) 本仓库当前 `"publisher": "local"` 仅用于本地调试；发布前必须改为真实 Publisher ID。

## 1. 准备账号与凭证（只做一次）
1) 在 Visual Studio Marketplace 创建 Publisher（获取 Publisher ID）。
2) 生成用于发布的 PAT（Personal Access Token，Azure DevOps PAT），并妥善保管：
   - 不要写入仓库文件
   - 不要写到进度文档/issue/commit message
   - 该 PAT **不可再次查看**，丢失只能重新生成

### 1.1 在哪里创建 PAT（Azure DevOps）
在任意组织下进入个人设置创建（不要求与你的 GitHub 仓库同源）：
1) 打开 Azure DevOps → 个人设置 → Personal access tokens
2) New Token：
   - Organization：选择任意可用组织
   - Scopes：选择 Marketplace 相关权限（至少包含 Publish）

## 2. 本地打包验证（建议每次发布前都做）
1) 安装依赖：`npm ci`
2) 编译：`npm run compile`
3) 打包：`npm run package`
   - 产物为 `*.vsix`（已在 `.gitignore` 忽略）

## 3. 本地发布（手工）
1) 把 `package.json` 的 `"publisher"` 改为你的 Publisher ID
2) 登录 publisher（首次一次）：`vsce login <publisher>`
3) 发布：`npm run publish`

## 4. CI 发布（可选）
可在 GitHub Actions 注入 `VSCE_PAT`，并在打 tag 或手动触发时自动执行 `vsce publish`：
1) GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret
2) 名称：`VSCE_PAT`
3) 值：上一步生成的 PAT

工作流示例已加入仓库：`.github/workflows/publish.yml`。

## 5. 常见注意事项
1) 版本号：发布前确保 `package.json.version` 递增（语义化版本）。
2) 说明文档：Marketplace 会展示 `README.md`（建议包含主要能力与使用说明）。
3) 文件体积：通过 `.vscodeignore` 控制打包内容，避免把源码/文档/开发依赖打进 vsix。
4) License：打包时如果没有 `LICENSE*` 文件会有警告。是否添加 License 属于授权决策，需由仓库负责人确认后再补充。
