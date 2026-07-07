# Unreal_AIHper

Unreal_AIHper 是把 **UEHper**（C++ Runtime Host）+ **puerts_uehper**（TypeScript 应用容器）+ **Puerts**（第三方脚本运行时）+ 可选 **McpAutomationBridge**（编辑器自动化）整合到一起的 UE 插件框架，让你可以在任意 UE 5.5 项目里用 TypeScript 写业务逻辑，由 C++ 负责 Actor/碰撞/动画/网络复制。

## 五层架构

```
L0  UEHper C++              框架底座（不随业务变化）
L1  业务 C++                 Actor / 碰撞 / 动画 / 导航 / 投射物 / 高频 Tick / 网络复制
L2  puerts_uehper TS         通用 TS 框架（可跨项目复用）
L3  业务 TypeScript           项目业务层
```

## 仓库布局

```
Unreal_AIHper/
├── install.ps1                  # 一键安装到任意 UE 5.5 项目（网络模式）
├── package.json                 # 顶层 workspace 根
├── .uehper-version              # 版本 + submodule 锁定
├── .gitmodules                  # puerts / Unreal_mcp submodule
├── Plugins/
│   ├── UEHper/                  # C++ 插件（4 模块: UEHper/UEHperEditor/UEHperXR/UEHperXRPico）
│   └── puerts_uehper/           # TS 框架包（dist/ + Cli/ + Framework/ + Services/）
├── ThirdParty/
│   ├── puerts/                  # submodule: Tencent/puerts@a50fbae
│   └── Unreal_mcp/              # submodule: ChiR24/Unreal_mcp@v0.5.30
└── docs/                        # 框架文档
```

## 快速安装（网络一行模式）

在**目标 UE 工程根**执行：

```powershell
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/<org>/Unreal_AIHper/main/install.ps1').Content)) -ProjectRoot $PWD -Version latest
```

或先下载再执行：

```powershell
Invoke-WebRequest 'https://raw.githubusercontent.com/<org>/Unreal_AIHper/main/install.ps1' -OutFile install-aihper.ps1
./install-aihper.ps1 -ProjectRoot F:/UEProjects/YourProject -Version v1.0.0
```

安装器三层架构：L1 Fetch（git clone）→ L2 Integrate（copy 4 子目录到 Plugins/Unreal.AIHper/）→ L3 Configure（npm install + puerts_uehper bootstrap）。详见 [docs/uehper-monorepo-plan.md](docs/uehper-monorepo-plan.md) §5。

## 安装后验证

```powershell
npx puerts_uehper doctor
```

首次安装通常报 `backendReady=false` + `typingsReady=false`，需先：
1. `./Scripts/build-editor.ps1` 编译 C++（含 Puerts 后端）
2. 启动 UE 编辑器 → `npx puerts_uehper gen-typings`
3. `npx puerts_uehper build` 编译 TS

## 日常命令

| 任务 | 命令 |
|---|---|
| 编译 TS | `npx puerts_uehper build` |
| 监听 TS | `npm run watch` |
| 生成 typings | `npx puerts_uehper gen-typings` |
| Smoke | `npx puerts_uehper smoke` |
| Doctor | `npx puerts_uehper doctor` |
| 脚手架 | `npx puerts_uehper make module MyFlow` |

## 升级

```powershell
./install-aihper.ps1 -ProjectRoot <YourProject> -Version v1.2.3 -Force
```

## 卸载

```powershell
Remove-Item -Recurse -Force Plugins/Unreal.AIHper/{UEHper,puerts_uehper,puerts,McpAutomationBridge}
```

## 文档

| 主题 | 文档 |
|---|---|
| 整合方案 | [docs/uehper-monorepo-plan.md](docs/uehper-monorepo-plan.md) |
| 快速使用 | [docs/uehper-quick-start.md](docs/uehper-quick-start.md) |
| 框架架构 | [docs/puerts_uehper-框架.md](docs/puerts_uehper-框架.md) |

## 第三方

- [Puerts](https://github.com/Tencent/puerts) — MIT，锁定 commit `a50fbae`
- [Unreal_mcp](https://github.com/ChiR24/Unreal_mcp) — MIT，锁定 tag `v0.5.30`

## License

MIT
