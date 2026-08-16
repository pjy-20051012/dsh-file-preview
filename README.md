# dsh-file-preview

[![CI](https://github.com/pjy-20051012/dsh-file-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/pjy-20051012/dsh-file-preview/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-0.4.0-1f6feb)](https://github.com/pjy-20051012/dsh-file-preview/releases)
[![license](https://img.shields.io/badge/license-MIT-2da44e)](LICENSE)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 网页端（`dsh web`）增加 Codex 风格的文件能力：

- **最近文件列表**：点击侧边栏「文件预览」入口，右侧面板直接展示本会话最近 10 个产出文件，点任意一个即可预览。
- **右侧文件预览栏**：像 Codex 一样「看文件长什么样」——图片/PDF 直接渲染，Word/Excel/PowerPoint（docx/xlsx/pptx）在服务端用本机 MS Office 转成 PDF 后可视化预览（转不了才退回文本）；支持「用默认程序打开」和「打开所在文件夹」，可从预览一键返回最近文件列表。
- **对话中的文件操作行**：每条助手回复下方（turn 尾部）展示该轮产出的文件，每个文件带三个动作：预览、打开、在文件夹中显示。

实现方式与 [dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) 完全一致：服务端 Cordis 插件注册回环-only 的 HTTP 端点，浏览器端手写 `__ModuleLoader__` bundle 注入界面，无构建步骤。

## 功能 / Features

| 功能 | 说明 |
| --- | --- |
| 最近文件列表 | 侧边栏入口打开后默认显示本会话最近 10 个产出文件（名称/路径/时间，可预览/打开/定位文件夹） |
| 右侧预览栏 | `shell.overlay` 全应用浮动层；文本/代码展示（截断保护）、图片、PDF 内嵌预览；Office 文档经 MS Office COM 转 PDF 可视化预览（带缓存，转不了回退文本）；半透明毛玻璃质感，不遮挡视野 |
| 对话文件操作行 | `conversation.chat.turnTail` chain 条目（`priority: -10`，优先于内置 deliverables 行），每文件提供 预览/打开/文件夹 三动作 |
| 打开所在文件夹 | Windows `explorer /select`（`windowsVerbatimArguments` 精确传参，含空格/中文路径可定位）、macOS `open -R`、Linux 打开所在目录 |
| 默认程序打开 | 复用会话层 `openFile`（宿主 `host.openPath`）；服务端也提供等价端点 |
| 安全边界 | 所有端点仅接受回环来源（peer socket + Host 双重校验）；路径必须为绝对路径；预览只读 |

## 安装 / Installation

需要 DeepSeek Harness 的 `web` profile（`@deepseek-ai/dsh >= 0.1.0-rc.6`）以及随 Node.js 提供的 `npx`。

在 PowerShell、命令提示符或 macOS/Linux 终端运行同一条命令：

```bash
npx --yes github:pjy-20051012/dsh-file-preview
```

安装器会自动完成两件事：把运行文件复制到 `~/.dsh/profiles/node_modules/dsh-file-preview`，并在 `profiles/web/cordis.patch.yml` 中幂等启用插件。重复运行同一命令即可更新，不会重复添加配置。

如设置了 `DSH_HOME`，安装器会使用该目录而不是 `~/.dsh`。可先预览或只检查现有安装：

```bash
npx --yes github:pjy-20051012/dsh-file-preview --dry-run
npx --yes github:pjy-20051012/dsh-file-preview --check
```

如果不希望安装器修改 Cordis patch，可加 `--no-enable`，再自行配置。

<details>
<summary>无法使用 npx 时：从源码安装</summary>

```bash
git clone https://github.com/pjy-20051012/dsh-file-preview.git
cd dsh-file-preview
node scripts/install.mjs
```

</details>

### 重启

```bash
dsh web
```

浏览器硬刷新后生效：侧边栏底部出现「文件预览」入口；新产生的助手回复下方出现「文件操作」行。

## 使用 / Usage

- 点击侧边栏底部「文件预览」→ 右侧面板打开**最近文件**列表（本会话最近 10 个产出文件），点文件名直接预览。
- 对话中「文件操作」行：点击文件名 → 预览；↗ 用默认程序打开；📂 打开所在文件夹。
- 预览面板标题栏：← 返回最近文件、↗ 打开、📂 打开所在文件夹、刷新、关闭。
- 最近文件列表随对话实时更新（隐藏收集器监听会话快照），无需手动刷新。

## Agent 友好安装 / Agent-friendly installation

可以把下面整段直接交给 Codex、Claude Code 或其他本地编码 Agent：

```text
Install or update dsh-file-preview from:
https://github.com/pjy-20051012/dsh-file-preview

Constraints:
- Resolve DSH_HOME from the environment; otherwise use ~/.dsh.
- Do not read, print, edit, or request .credentials.yaml or any API key.
- Do not expose the plugin through a reverse proxy.
- Do not restart or terminate an existing dsh process without asking me.

Procedure:
1. Confirm node, npx, and dsh are available.
2. Run: npx --yes github:pjy-20051012/dsh-file-preview
3. Require the installer to report a verified package and exactly one Cordis patch entry.
4. Report the resolved install and patch paths.
5. If dsh web is already running, tell me a restart is needed and stop.
```

安装器本身提供清晰的退出码：未知参数返回 `2`；文件、版本或配置验证失败返回非零；成功时输出已验证版本、安装路径和 patch 路径。因此 Agent 不需要自行解析或重写 YAML。

## 开发与验证 / Development

```bash
node --check lib/index.js && node --check lib/client.js
npm run test            # 离线：服务端冒烟 + 安装器幂等测试
```

`npm test` 完全离线：用临时文件驱动真实 HTTP 路由，校验回环围栏、路径校验、分类与全部端点；
安装器测试在临时 `DSH_HOME` 下验证幂等性与 `--check` 行为。

## API

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/file-preview/preview?path=<abs>` | 文件元数据 + 文本内容（≤1MB，超长截断标记）或 图片/PDF 的 raw URL |
| `GET` | `/api/file-preview/raw?path=<abs>` | 原始字节流（图片/PDF 预览，≤64MB），`Content-Disposition: inline` |
| `POST` | `/api/file-preview/open` | `{path}` 用系统默认程序打开 |
| `POST` | `/api/file-preview/reveal` | `{path}` 在所在文件夹中定位 |

其他方法返回 `405`，非回环请求返回 `403`；`preview`/`raw` 仅 GET，`open`/`reveal` 仅 POST。
预览端点只读，绝不写文件。

## 隐私与安全 / Privacy & security

- 所有端点校验 `req.socket.remoteAddress` 与 Host；仅回环可达，请勿经反向代理暴露到局域网/公网。
- 预览只读文件内容并回传浏览器；插件不读取凭据、不发送任何请求到外部网络。
- `open`/`reveal` 仅在本机启动系统程序（相当于你在本机执行打开操作）。

## 兼容性

当前版本 `0.1.0`。对话文件行依赖 ui-deliverables 发布的 `deliverables` turn 数据
（web roster 默认启用）；若该插件被移除，文件操作行会自动隐藏，预览面板与侧边栏入口不受影响。
Harness 预发布版本升级后如内部接口变化，可能需要同步适配。

## License

[MIT](LICENSE)
