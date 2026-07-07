# Unreal_AIHper

Unreal_AIHper 是把 **UEHper**（C++ Runtime Host）+ **puerts_uehper**（TypeScript 应用容器）+ **Puerts**（第三方脚本运行时）+ 可选 **McpAutomationBridge**（编辑器自动化）整合到一起的 UE 插件框架。

**这个仓库本身就是 UE 插件目录**——直接 `git clone` 到 UE 项目的 `Plugins/Unreal.AIHper/` 下即可，无需 copy、无需 junction。

## 仓库布局

```
Unreal_AIHper/                  # ← git clone 到 Plugins/Unreal.AIHper/
├── install.ps1                  # 一站式初始化（npm install + bootstrap）
├── package.json                 # 顶层（仅开发用，消费方用自己的 package.json）
├── .uehper-version              # 版本 + submodule 锁定
├── .gitmodules                  # puerts / Unreal_mcp submodule
├── UEHper/                      # C++ 插件（4 模块: UEHper/UEHperEditor/UEHperXR/UEHperXRPico）
├── puerts_uehper/               # TS 框架包（dist/ + Cli/ + Framework/ + Services/）
├── puerts/                      # submodule: Tencent/puerts@a50fbae
├── Unreal_mcp/                  # submodule: ChiR24/Unreal_mcp@v0.5.30
└── McpAutomationBridge/         # （可选，手动 junction，见下文"可选 MCP"）
```

## 安装（git clone 模式，保留版本控制和回流能力）

```powershell
# 1. 在 UE 项目根，clone 框架仓到 Plugins/Unreal.AIHper/
cd F:/UEProjects/YourProject
git clone --recurse-submodules https://github.com/MrBaoquan/Unreal_AIHper.git Plugins/Unreal.AIHper

# 2. 跑一站式初始化
./Plugins/Unreal.AIHper/install.ps1 -ProjectRoot .
```

`install.ps1` 完成：
1. 创建 `package.json`（若不存在，含 `puerts_uehper` file: 依赖）
2. 创建 `tsconfig.json`（若不存在，paths 指向 `node_modules/puerts_uehper/dist`）
3. 创建 `TypeScript/` 源码根目录
4. `npm install`
5. `npx puerts_uehper bootstrap`（写 tsconfig.paths / GameApp.ts / Manifests；backend 未编译时优雅降级）
6. 写 `UEHperFrameworkVersion.ini` 版本记录
7. SVN 工作副本检测 + 提示

## 可选：McpAutomationBridge（编辑器自动化）

需要 MCP 编辑器自动化时，手动 3 步（不内置到 install.ps1，保持安装器精简）：

```powershell
cd Plugins/Unreal.AIHper
# 1. junction McpAutomationBridge 到根目录（UE 才能发现插件）
cmd /c mklink /J McpAutomationBridge Unreal_mcp\plugins\McpAutomationBridge

# 2. 在 .uproject 的 Plugins 数组加入：
#   { "Name": "McpAutomationBridge", "Enabled": true }

# 3. 启动 UE 编辑器，确认 McpAutomationBridge 插件已加载
#    MCP server 端点：http://localhost:3000/mcp
```

## 持续沉淀（git 原生能力，无需额外工具）

```powershell
cd Plugins/Unreal.AIHper

# 拉最新框架
git pull --recurse-submodules

# 改了 UEHper C++ 或 puerts_uehper TS 后回流
git add -A
git commit -m "feat: improve xxx"
git push

# 多项目沉淀到同一仓，自然合并
```

## 安装后验证

```powershell
cd <UEProjectRoot>
npx puerts_uehper doctor
```

首次安装通常报 `backendReady=false` + `typingsReady=false`，需先：
1. 编译 C++（UEHper + Puerts 模块）
2. 启动 UE 编辑器 → `npx puerts_uehper gen-typings`
3. `npx puerts_uehper build`

## 日常命令

| 任务 | 命令 |
|---|---|
| 编译 TS | `npx puerts_uehper build` |
| 监听 TS | `npm run watch` |
| 生成 typings | `npx puerts_uehper gen-typings` |
| Smoke | `npx puerts_uehper smoke` |
| Doctor | `npx puerts_uehper doctor` |
| 脚手架 | `npx puerts_uehper make module MyFlow` |

## 升级框架

```powershell
cd Plugins/Unreal.AIHper
git pull --recurse-submodules
# 重跑初始化同步配置（可选，仅当框架引入新配置项时需要）
./install.ps1 -ProjectRoot ../..
```

## SVN 项目兼容

SVN 工作副本下，框架仓的 `.git` 需 svn:ignore：
```powershell
svn propset svn:ignore ".git" Plugins/Unreal.AIHper
```

## 第三方

- [Puerts](https://github.com/Tencent/puerts) — MIT，submodule @ a50fbae
- [Unreal_mcp](https://github.com/ChiR24/Unreal_mcp) — MIT，submodule @ v0.5.30

## License

MIT
