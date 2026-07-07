# puerts_uehper

`puerts_uehper` 是基于 `Puerts + UEHper` 的 TypeScript 框架层，目标是为 Unreal 展项、XR、LBE 和交互内容项目提供可复用的业务开发底座。

当前权威文档见：

1. [docs/puerts_uehper-framework-architecture.md](../../docs/puerts_uehper-framework-architecture.md)
2. [docs/puerts_uehper-usage.md](../../docs/puerts_uehper-usage.md)
3. [docs/puerts_uehper-implementation-log.md](../../docs/puerts_uehper-implementation-log.md)
4. [docs/puerts_uehper-release-checklist.md](../../docs/puerts_uehper-release-checklist.md)

## 当前定位

1. `Puerts` 是第三方脚本运行时和 UE 绑定层，不修改源码。
2. `UEHper` 是 C++ Runtime Host，负责 Unreal 生命周期、配置、World 上下文、Bridge 和诊断。
3. `puerts_uehper` 是 TS Application Container，负责 `FrameworkApp`、`FrameworkContext`、服务注册、UI/资源/场景等默认服务。
4. 当前项目业务代码直接放在 `TypeScript` 根；旧项目也可以继续使用 `TypeScript/Game` 兼容布局。业务代码不应写进框架包。

## 重要说明

旧版 `TS_GameMode + TS_UEHperEntry + Managements` 入口不再保留为框架兼容层，相关源码已从框架默认结构中移除。

新架构目标是由 `UEHperRuntimeSubsystem` 启动 Puerts Runtime 和 TS Framework bootstrap，项目不需要为了启动框架而继承指定 GameMode。

## 推荐落点

```text
Plugins/Unreal.AIHper/UEHper
Plugins/Unreal.AIHper/puerts/unreal/Puerts
TypeScript/GameApp.ts
TypeScript/ProjectConfig.ts
TypeScript/Manifests
TypeScript/Modules
node_modules/puerts_uehper
```

当前 SVN 协作阶段以 `Plugins/Unreal.AIHper/puerts_uehper` 作为源码包位置；消费项目默认通过项目根 `node_modules/puerts_uehper + dist` 使用框架。

## npm 过渡形态

当前包清单已声明全局 CLI：

```powershell
npm install -g puerts_uehper
puerts-uehper --help
puerts-uehper doctor
npx puerts_uehper doctor
```

现阶段发布策略是“dist 入口 + JS CLI”：`main` / `types` 已指向 `dist/index.js` 与 `dist/index.d.ts`，`bin.puerts-uehper` 和 `bin.puerts_uehper` 均指向 `uehper.js`，`exports` 暴露 `dist` 下的根入口、`Framework/*`、`Services/*`、`UEHelpers` 和明确列出的 CLI JS 子路径，CLI 使用 JS 文件；源码仓执行 `npm pack` 时会通过 `prepack` 自动生成 `dist` 与 `.d.ts`，并在 tarball 内生成无 scripts 的消费态 `package.json`。发布包只包含 `dist`、明确列出的运行态 `Cli/*.js`、入口脚本和 README，不再携带 TS 源码目录、测试、`tsconfig.package.json` 或 package build 工具；`Cli/package-build` 等源码仓工具也不会通过 `exports` 暴露。bootstrap 默认 `frameworkSource=package`，会把框架 materialize 到项目根 `node_modules/puerts_uehper`，`tsconfig.paths` 指向 `node_modules/puerts_uehper/dist`；`--framework-source=source` 主要用于本仓库开发态或旧源码调试。

```powershell
npm run build:package
npm run pack:dry-run
```

消费项目的业务 TS 日常开发可使用：

```powershell
npm run watch
npx --no-install puerts_uehper watch
```

`watch` 只监听项目业务层 `TypeScript/**/*` 并输出到 `Content/JavaScript`。它不会自动重建本框架包源码；修改 `Plugins/Unreal.AIHper/puerts_uehper` 后仍需执行 `npm run build:package` 并由消费项目同步 runtime package。

`sync-runtime` 现在支持 `--runtime-source=auto|compiled|dist|package`，可以显式选择运行时包来源；在 package 模式下，`auto` 会优先使用项目根 `node_modules/puerts_uehper/dist`：

```powershell
node .\uehper.js sync-runtime --runtime-source=dist
```

## 当前已落地

1. 在 `UEHper` 中实现 `UEHperSettings`、`UEHperRuntimeSubsystem`、`UEHperWorldSubsystem`。
2. 在 `puerts_uehper` 中实现 `FrameworkApp`、`FrameworkContext`、`ServiceRegistry`。
3. 补齐 `init`、`make app`、`make module`、`make ui`、`make resource`、`smoke` 等命令式脚手架能力。
4. 将当前项目业务入口迁移到 `TypeScript/GameApp.ts`。
5. 删除旧 `TS_GameMode`、`TS_UEHperEntry`、`Managements`、`UIManager`、`ResourceManager`。

## 下一阶段实现重点

1. 由 registry 管理侧确认 `puerts_uehper` 包名和 `mrbaoquan` 发布权限后，执行内部预发布。
2. 评估 Puerts 退出阶段 `~FScriptArrayEx/Set/MapEx: Property is invalid` 第三方析构噪音是否需要单独治理。
3. 可选新增 `doctor --require-runtime-ready`，让 CI 在最新日志不是 `ready` 时直接失败。
