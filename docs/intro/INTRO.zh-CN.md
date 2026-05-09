# SayKnowMind —— 智能第二大脑（Agentic Second Brain）

> **"Everything you say, we know, and mind forever."**
> 你说过的一切，我们都记得，并永远为你思考。

**其他语言版本：**
[English](./INTRO.md) · [한국어](./INTRO.ko.md) · [繁體中文](./INTRO.zh-TW.md) · [日本語](./INTRO.ja.md)

---

**SayKnowMind** 是一款开源的**个人智能知识管理平台**。AI 帮你自动捕捉、整理、检索你读过、看过、写过、聊过的一切信息，让它们变成可以随时调用的"第二大脑"。

## 三大核心原则

1. **本地优先（Local-First）**
   所有数据默认存储在你自己的设备上。开启**隐私模式**后，**完全不向外发送任何数据** —— 你的知识只属于你。

2. **智能体协作（Agentic Intelligence）**
   多个 AI Agent 自动分类、提取、总结、关联你的内容。无需手动打标签，知识图谱在你采集的瞬间自动生成。

3. **全平台覆盖**
   网页 · 桌面端（macOS / Windows / Linux，基于 Tauri）· 移动端（iOS / Android，基于 Capacitor）· MCP Server · SDK（TypeScript / Python / Go）· Telegram 机器人自动采集。

## 技术亮点 —— 三层 RAG 架构

| 层 | 引擎 | 作用 |
|---|---|---|
| L1 | **EdgeQuake**（Rust） | 高性能搜索引擎，融合 Apache AGE（图谱）+ pgvector（向量），支持 6 种查询模式 |
| L2 | **UltraRAG** | 智能体式 RAG 流水线 —— 自动分类、ZeroClaw 包装、基于 YAML 的 MCP Skills |
| L3 | **zvec** | 极轻量进程内向量引擎，加速混合搜索 |

## 适合人群

- 想构建私人知识库，但**不愿把数据上传到 Notion / ChatGPT / 任何纯云端服务**的用户
- 被标签页、收藏夹、截图淹没，需要 AI"真的记住"的研究者、开发者、内容创作者
- 希望**自部署**（Docker / Kubernetes / Railway），完全掌控数据主权的团队

## 开源 & 免费

Apache 2.0 协议 —— 100% 开源，永久免费。GitHub 与 GitLab 双仓库镜像维护，欢迎贡献。

---

**了解更多：**
[项目 README](../../README.md) · [架构](../../README.md#architecture) · [快速开始](../../README.md#getting-started) · [Kubernetes Helm Chart](../../deploy/helm/sayknowmind/README.zh-CN.md)
