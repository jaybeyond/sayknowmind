# SayKnowMind — Agentic Second Brain（自律型セカンドブレイン）

> **"Everything you say, we know, and mind forever."**
> あなたが言葉にしたすべてを、私たちは覚え、永遠に考え続けます。

**他言語版:**
[English](./INTRO.md) · [한국어](./INTRO.ko.md) · [简体中文](./INTRO.zh-CN.md) · [繁體中文](./INTRO.zh-TW.md)

---

**SayKnowMind** は、オープンソースの**個人向け自律型ナレッジ管理プラットフォーム**です。あなたが読んだ・見た・書いた・話したすべての情報を AI が自動でキャプチャ・整理・検索し、いつでも呼び出せる「第二の脳」へと変えます。

## 3 つの核心原則

1. **ローカルファースト（Local-First）**
   すべてのデータはデフォルトで自分のデバイスに保存されます。**プライベートモード**を有効にすると、外部への通信は一切行いません — あなたの知識はあなただけのものです。

2. **エージェント知能（Agentic Intelligence）**
   複数の AI エージェントがコンテンツを自動的に分類・抽出・要約・関連付けします。タグを手動で付ける必要はなく、キャプチャした瞬間にナレッジグラフが自動生成されます。

3. **クロスプラットフォーム対応**
   Web · デスクトップ（macOS / Windows / Linux、Tauri ベース）· モバイル（iOS / Android、Capacitor ベース）· MCP Server · SDK（TypeScript / Python / Go）· Telegram ボットによる自動収集。

## 技術ハイライト — 3 層 RAG スタック

| 層 | エンジン | 役割 |
|---|---|---|
| L1 | **EdgeQuake**（Rust） | 高性能検索エンジン。Apache AGE（グラフ）+ pgvector（ベクトル）を統合し、6 つのクエリモードに対応 |
| L2 | **UltraRAG** | エージェント型 RAG パイプライン — 自動カテゴリ分類、ZeroClaw ラッピング、YAML ベースの MCP Skills |
| L3 | **zvec** | 超軽量なプロセス内ベクトルエンジン。ハイブリッド検索を高速化 |

## こんな方におすすめ

- 個人ナレッジベースを構築したいが、**データを Notion / ChatGPT / 完全クラウド型サービスにアップロードしたくない**ユーザー
- タブ・ブックマーク・スクリーンショットに溺れ、「本当に覚えてくれる AI」を求める研究者・開発者・コンテンツクリエイター
- **セルフホスト**（Docker / Kubernetes / Railway）で、データ主権を完全に掌握したいチーム

## オープンソース & 無料

Apache 2.0 ライセンス — 100% オープンソース、永久無料。GitHub と GitLab の両方でミラーリング管理。コントリビューション歓迎。

---

**もっと詳しく:**
[プロジェクト README](../../README.md) · [アーキテクチャ](../../README.md#architecture) · [はじめに](../../README.md#getting-started) · [Kubernetes Helm Chart](../../deploy/helm/sayknowmind/README.md)
