# SayKnowMind —— 智慧第二大腦（Agentic Second Brain）

> **"Everything you say, we know, and mind forever."**
> 你說過的一切，我們都記得，並永遠為你思考。

**其他語言版本：**
[English](./INTRO.md) · [한국어](./INTRO.ko.md) · [简体中文](./INTRO.zh-CN.md) · [日本語](./INTRO.ja.md)

---

**SayKnowMind** 是一款開源的**個人智慧知識管理平台**。AI 幫你自動擷取、整理、檢索你讀過、看過、寫過、聊過的一切資訊，將它們變成可以隨時調用的「第二大腦」。

## 三大核心原則

1. **本地優先（Local-First）**
   所有資料預設儲存在你自己的裝置上。開啟**隱私模式**後，**完全不向外傳送任何資料** —— 你的知識只屬於你。

2. **代理人智慧（Agentic Intelligence）**
   多個 AI Agent 自動分類、擷取、摘要、關聯你的內容。無需手動標記，知識圖譜會在你擷取的瞬間自動建立。

3. **全平台支援**
   網頁 · 桌面版（macOS / Windows / Linux，基於 Tauri）· 行動版（iOS / Android，基於 Capacitor）· MCP Server · SDK（TypeScript / Python / Go）· Telegram 機器人自動擷取。

## 技術亮點 —— 三層 RAG 架構

| 層 | 引擎 | 作用 |
|---|---|---|
| L1 | **EdgeQuake**（Rust） | 高效能搜尋引擎，結合 Apache AGE（圖譜）+ pgvector（向量），支援 6 種查詢模式 |
| L2 | **UltraRAG** | 代理人式 RAG 流程 —— 自動分類、ZeroClaw 封裝、基於 YAML 的 MCP Skills |
| L3 | **zvec** | 極輕量行程內向量引擎，加速混合搜尋 |

## 適合對象

- 想建立私人知識庫，但**不願將資料上傳至 Notion / ChatGPT / 任何純雲端服務**的使用者
- 被分頁、書籤、截圖淹沒，需要 AI「真正記得」的研究者、開發者、內容創作者
- 希望**自架部署**（Docker / Kubernetes / Railway），完全掌握資料主權的團隊

## 開源 & 免費

Apache 2.0 授權 —— 100% 開源，永久免費。GitHub 與 GitLab 雙倉庫鏡像維護，歡迎貢獻。

---

**了解更多：**
[專案 README](../../README.md) · [架構](../../README.md#architecture) · [快速開始](../../README.md#getting-started) · [Kubernetes Helm Chart](../../deploy/helm/sayknowmind/README.md)
