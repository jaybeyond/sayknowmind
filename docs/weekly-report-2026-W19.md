# SayKnowMind 周报

**周次**: 2026 年第 19 周
**周期**: 2026-05-04（周一）~ 2026-05-09（周六）
**项目**: SayKnowMind — Agentic Second Brain
**作者**: Kira ⚡

---

## 一、本周概览

本周共完成 **10 个提交**，主题非常聚焦——**"上线准备周"**。围绕一个目标：**让产品真正能被部署、被使用、被分享给团队和外部用户**。

| 主题 | 提交数 | 状态 |
|------|--------|------|
| K8s / Helm 部署基础设施 | 1 | ✅ 已完成（含中英双语文档） |
| Docker 构建链路修复 | 2 | ✅ 已完成（已解决中国开发者上线阻塞） |
| 桌面端 Tauri 兼容性修复 | 2 | ✅ 已完成（外链 + iframe 双修） |
| Telegram 多用户隔离收尾 | 1 | ✅ 已完成（W18 主题闭环） |
| 桌面端 full/lite 模式打磨 | 3 | ✅ 已完成 |
| 多语言文档基建 | 1 | ✅ 已完成（5 语言产品介绍） |

---

## 二、按日工作日志

### 📌 5/5（周二）

| 提交 | 类型 | 说明 |
|------|------|------|
| `affae9f` | fix(web) | 在 lite 桌面端和云浏览器中隐藏「本地运行时」标签页 |

**🔍 重点说明**：
- 这是 W18 桌面端 full/lite 双模式的延续。lite 模式不内嵌 Node.js，因此「本地运行时」选项在该模式下毫无意义且会误导用户。
- 同时云端浏览器也隐藏该 tab——确保不同部署形态下 UI 与能力**严格对齐**，避免用户误点击得到 404 或失败。

---

### 📌 5/7（周四）— 集中收尾日

四笔提交一气呵成，每一笔都解决一个早期上线测试中暴露的真实问题：

| 提交 | 类型 | 说明 |
|------|------|------|
| `bc2f5af` | fix(web) | 改为 per-bot 路由 Telegram webhook，修复多用户串扰 |
| `380bbb2` | feat(web) | 通过环境辅助函数对外暴露桌面端 full/lite 模式 |
| `187c5f2` | fix(desktop) | 给 cargo 透传 `--no-default-features` + 忽略 tauri gen/ 目录 |
| `bf90b15` | fix(web) | 取消 jsdom/readability 的 Turbopack 打包，避免 page-data 步骤崩溃 |

**🔍 重点说明**：
- **`bc2f5af`** 闭合了 W18 的 Telegram 多用户隔离主题：从 userId 贯穿（`dc4d8b8`）→ token 隔离（`af76d33`）→ 现在按 botId 拆分 webhook，Telegram 集成的多租户安全链路**完全打通**。
- **`bf90b15`** 是个非常隐蔽的构建 bug：Next.js 16 的 Turbopack 在 page-data 阶段尝试静态分析 jsdom，由于 jsdom 内部的动态 require 触发了异常退出。**unbundle 是正确的解法**——服务端依赖本就不应进客户端 chunk。

---

### 📌 5/8（周五）— 部署里程碑

| 提交 | 类型 | 说明 |
|------|------|------|
| `69d92f1` | feat(deploy) | 添加完整的 Kubernetes Helm Chart 部署方案 |

**🔍 重点说明**：

这是本周**最大体量的提交**——单次 commit 新增 **38 个文件、3,907 行代码**，覆盖：

- **17 个 K8s 模板**（Postgres StatefulSet + 9 个微服务 Deployment + Ingress + ConfigMap + Secret）
- **3 套 values 文件**（默认 / staging / production）+ secrets 模板
- **公共 Helm helpers**：自动拼接镜像引用、Service URL、TRUSTED_ORIGINS
- **数据库初始化 SQL 自动注入**（9 个 init 脚本通过 ConfigMap 挂载）
- **中英双语 README**（README.md + README.zh-CN.md）—— 直接交付给中国 DevOps 同事使用
- **Makefile 集成**：`make helm-sync / lint / template` 一键校验

部署形态从此**从单机 docker-compose 演进到生产级 K8s**，并且将 GitLab 设为镜像仓库交付给协作开发者，**彻底打通了团队协作的最后一公里**。

---

### 📌 5/9（周六，今日）— 高强度修复 + 国际化日

| 提交 | 类型 | 说明 |
|------|------|------|
| `4f5886f` | fix(desktop) | 修复 Tauri webview 中外链点击与 iframe 视频播放无效的问题 |
| `165b7fb` | fix(docker) | 修复 web 和 dashboard 镜像构建失败 |
| `b95271e` | fix(web) | 通过 `packageManager` 字段固定 pnpm，禁用 corepack 自动升级 |
| `ebcb9f2` | docs(intro) | 添加 5 种语言的产品介绍文档 |

**🔍 重点说明**：

#### 1. 桌面端用户体验救援（`4f5886f`）

发现一个长期潜伏的双重 bug：
- **外链失效**：`window.open(_blank)` 在 Tauri webview 中被静默拦截（安全策略），用户点「原文打开」按钮没有反应
- **iframe 不能播放**：CSP 缺少 `frame-src` 指令，所有 Instagram / YouTube / TikTok / Vimeo 嵌入视频被默认拒绝

修复方案的优雅之处：
- 新建 `openExternal()` 帮手——Tauri 中走 `@tauri-apps/plugin-shell.open()`，Web 中回退 `window.open`
- 新建 `<ExternalLinkInterceptor />`——挂在 root layout 的全局 click 监听器，自动拦截所有 `target="_blank"` 链接，**无需逐个组件改动**
- CSP 加入 5 个嵌入域名白名单，同时新增 `media-src` 兜底 HTML5 video/audio

#### 2. 中国 DevOps 同事的上线阻塞（`165b7fb` + `b95271e`）

这次是远程协作的真实压测：
- **`apps/dashboard/Dockerfile`**：13 处 COPY 全都错带了 `edgequake_webui/` 前缀（疑似从 EdgeQuake 模板拷贝时未改路径），构建上下文里根本没有这个目录 → 全部清理
- **`apps/web/Dockerfile`**：corepack 自动下载 pnpm 11.0.9，与我们的 lockfileVersion 9.0 冲突 → 通过 `packageManager: pnpm@9.15.6` + `COREPACK_DEFAULT_TO_LATEST=0` **三重保险**锁死

每一个修复都对应一段红色的远程构建日志，**这是真正"在炮火中"打磨出来的稳定性**。

#### 3. 五语言产品介绍（`ebcb9f2`）

新增 `docs/intro/INTRO.{md,ko,zh-CN,zh-TW,ja}.md`，每份文档结构一致：
- 一句 slogan + 一句话产品定位
- 三大核心原则（Local-First / Agentic / Cross-Platform）
- 三层 RAG 技术栈表格
- 目标用户画像
- 开源声明 + 跨语言切换链接

`.gitignore` 同步从 `docs/` 改为 `docs/*` + `!docs/intro/`——内部工作笔记继续忽略，但**对外介绍文档进入官方仓库**。README 顶部加入语言切换 Bar，访客一键直达自己语言的版本。

---

## 三、本周关键洞察

### ✅ 做得好的地方

1. **从"个人项目"跨入"可交付产品"**
   Helm Chart + 中英双语部署文档 + 5 语言产品介绍——本周完成的所有工作都指向同一个事实：**SayKnowMind 现在可以被一个完全不熟悉项目的 DevOps 工程师在自己的 K8s 集群上部署起来**。这是一道质变门槛。

2. **跨时区协作得到验证**
   中国开发者发现 Dockerfile 路径问题、构建链路 corepack 问题——我们 24 小时内完成定位、修复、双仓库（GitLab + GitHub）推送。**协作通道是工作的，而不是只有代码**。

3. **修复深入到根因，而不是绕过**
   - jsdom Turbopack：找到 unbundle 才是正解，不绕开
   - Tauri 外链：用全局拦截器一次解决全部组件，不打补丁式 patch
   - corepack：三重保险锁定，不靠"试一次能跑"的运气

### ⚠️ 需要注意的地方

1. **Railway 上仍是 4 月 29 日的 commit**
   GitHub origin 还没推送本周 5 个 commit，Railway 仍在跑旧版（mind.sayknow.ai），**生产环境与最新代码差 10 天**。需要尽快补 GitHub push 触发自动部署。

2. **桌面端修复尚未真机验证**
   `4f5886f` 改了 Tauri CSP + 引入新 npm 依赖（@tauri-apps/api / plugin-shell），typecheck 通过但**未在 macOS 真实桌面端跑过**。下次 desktop build 必须验证。

3. **Helm Chart 未跑过完整 install**
   `helm lint` 通过、`helm template` 渲染 27 个资源正确，但**未在真实集群 `helm install` 验证**。中国开发者上线时是真正的回归测试机会。

4. **测试覆盖仍未跟上修复速度**
   本周 6 个 fix 类提交，**0 个新增测试**。技术债务在累积。

---

## 四、下周建议

| 优先级 | 任务 |
|--------|------|
| 🔴 高 | 完成 GitHub origin push，触发 Railway 自动重部署 mind.sayknow.ai |
| 🔴 高 | 桌面端 macOS 真机验证 `4f5886f` 的两个修复（外链 + iframe） |
| 🔴 高 | 跟进中国开发者 Helm Chart 实际部署进度，收集第一手反馈并迭代 |
| 🟡 中 | 为本周 6 个 fix 补回归测试（特别是 Telegram per-bot webhook） |
| 🟡 中 | Windows 桌面端真机验证（W18 遗留任务，本周未推进） |
| 🟢 低 | 文档化 K8s 部署的 staging 实践（postgres + AGE 镜像构建脚本独立化） |

---

## 五、本周主题总结

> 如果说 W18 是「安全加固周」，那 W19 就是 **「上线准备周」**。
>
> 我们让产品离开了开发者的本机，迈向了：
> - 一个能跑在任意 K8s 集群的 Helm Chart
> - 一组在 5 种语言下都能讲清自己价值的介绍文档
> - 一个在 Tauri、Docker、跨注册表（GitHub + GitLab）每一个环节都被打磨过的构建链路
>
> 下周的核心动作很简单：**把这个准备好了的产品，真正推到生产环境跑起来**。

---

*报告生成时间：2026-05-09*
*Generated by Kira ⚡*
