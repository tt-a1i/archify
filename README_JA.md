<p align="center">
  <a href="./README.md">English</a> · <a href="./README_ZH.md">简体中文</a> · <strong>日本語</strong>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/31352?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-31352" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/31352" alt="Trendshift の Archify" width="250" height="55"/></a>
</p>

![Archify の製品プレビュー](docs/assets/archify-readme-hero.png)

# Archify

**コードベースやシステムの説明を、洗練されたインタラクティブなシステムマップへ——チャット内で直接変換します。**

Archify は Claude、Codex CLI、opencode 向けのエージェントスキルです。システムの説明やリポジトリを渡すと、開いて探索し、プレゼンテーションや共有ができる洗練された図を生成します。

- **開いてそのままプレゼンテーション** — 5 種類の技術図、3 種類のビジュアルプリセット、ダーク／ライトテーマ、オプションの有限モーション
- **すべての操作が事実に基づく** — トポロジーを創作せず、ノードの検索、関係の確認、作成済み経路の追跡、役割の比較、ガイド付きストーリーの再生が可能
- **信頼して共有できる 1 ファイル** — 型付き JSON IR と決定論的なチェックにより、自己完結型 HTML に加え、PNG、SVG、WebM、1200×630 の共有カードを生成

![ライセンス](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![エージェントスキル](https://img.shields.io/badge/Agent-Skill-7C3AED?style=flat-square)
![バージョン](https://img.shields.io/badge/version-2.12.0-0891b2?style=flat-square)

**[プロジェクトページ](https://tt-a1i.github.io/archify/)** · **[シナリオガイド](https://tt-a1i.github.io/archify/guide.html)** · **[Proof Lab](https://tt-a1i.github.io/archify/gallery.html)**

```bash
npx skills add tt-a1i/archify -g
```

続いて、エージェントに指示します：`Use archify to map this repository's runtime architecture.`

## Archify の動作を見る

以下は製品モックアップではなく、Archify が実際に生成した成果物です。フレームをクリックすると、共有可能なライブ状態で開きます。

<p align="center">
  <a href="https://tt-a1i.github.io/archify/gallery.html"><img src="docs/assets/archify-live-proof.gif" alt="Signal Flow、Blueprint、Classic の各プリセットで動作する、検証済みの 3 つの Archify 成果物" width="960"/></a>
  <br/>
  <sub><strong>実際に生成された 3 つの成果物。</strong> Signal Flow · Blueprint · Classic · <a href="https://tt-a1i.github.io/archify/gallery.html">インタラクティブな Proof Lab を開く ↗</a></sub>
</p>

| ガイド付きストーリー | 経路プローブ | セマンティックレンズ |
|---|---|---|
| [![作成済みの 1 つのチャプターを再生するエージェントワークフロー](docs/assets/archify-demo-story.png)](https://tt-a1i.github.io/archify/gallery/artifacts/agent-tool-call.workflow.html?theme=dark&present=1&play=1#view=happy-path) | [![Web App から Postgres への経路を示すキャッシュミスシーケンス](docs/assets/archify-demo-route.png)](https://tt-a1i.github.io/archify/gallery/artifacts/cache-miss.sequence.html?theme=dark&present=1#route=web~db) | [![バックエンドとデータベースの役割を比較する本番アーキテクチャ](docs/assets/archify-demo-lens.png)](https://tt-a1i.github.io/archify/gallery/artifacts/production-deployment.architecture.html?theme=dark&present=1#lens=backend~database) |
| 名前付きの有限チャプターを 1 回再生します。 | 作成済みの最短有向経路を確認します。 | セマンティックな役割間の実際のトラフィックを比較します。 |

[Proof Lab](https://tt-a1i.github.io/archify/gallery.html) には、リポジトリに含まれる 11 個すべてのシナリオ、その JSON ソース、名前付きビュー、検証レシートが収録されています。

### 実際のリポジトリをソースからマッピング

[![公開リポジトリ mco-org/mco から生成した MCO ランタイムアーキテクチャ](docs/assets/mco-runtime-share-card.png)](https://tt-a1i.github.io/archify/cases/mco-runtime.architecture.html?theme=dark&present=1#view=dispatch-path)

Archify は [`mco-org/mco`](https://github.com/mco-org/mco) のコミット `9f1a1cf` を読み取り、CLI、ポリシー、プロバイダーアダプター、呼び出しランタイム、永続セッションを追跡して、検証済みのインタラクティブなマップを生成しました。**[ライブマップを開く ↗](https://tt-a1i.github.io/archify/cases/mco-runtime.architecture.html?theme=dark&present=1#view=dispatch-path)** · [型付きソースを確認](docs/cases/mco-runtime.architecture.json)

## プレビュー

同じ図を 2 つのテーマで表示し、ワンクリックで切り替えられます。

| ダーク | ライト |
|---|---|
| ![ダークテーマ](docs/assets/archify-dark.png) | ![ライトテーマ](docs/assets/archify-light.png) |

Export メニューでは、PNG をクリップボードへコピーし、静止画またはモーション形式をダウンロードできます。

![Export メニュー](docs/assets/archify-menu.png)

README、リリース、ソーシャル投稿向けの標準的な 1200×630 画像が必要な場合は、**Copy Share Card** を使用してください。

経路を追跡した後に **Export → Route Share Card** を開くと、完全な図をコンテキストとして残したまま、作成済みの正確な経路を 1200×630 の PNG としてダウンロードできます。これはオプションのダウンロード専用 Share Card バリアントであり、通常のエクスポートは標準形式のままです。

![完全なアーキテクチャをコンテキストとして残し、Users から API Server への正確な経路を示す Route Share Card](docs/assets/archify-route-share-card.png)

完全なビューアーを試すには、[`examples/web-app.html`](examples/web-app.html) をローカルで開いてください。

## クイックスタート

### 1. インストール

```bash
npx skills add tt-a1i/archify -g
```

恒久的にインストールせず試す場合：

```bash
npx skills use tt-a1i/archify@archify --agent codex
```

必要に応じて `codex` を `claude-code` または `opencode` に置き換えてください。同梱の [`archify.zip`](archify.zip) も `npm install` なしで動作します。

### 2. 範囲を限定したビューを依頼

```text
Analyze this repository, then use archify to create a high-level runtime architecture diagram.
Show 8–12 core components, one primary path, external dependencies, and trust boundaries.
Put supporting detail in cards instead of adding more edges.
```

特定のフローに絞る場合：

```text
Use archify to draw this login flow: Browser -> Web App -> API -> JWT validation ->
Redis session lookup -> PostgreSQL fallback. Keep the cache-miss path secondary.
```

### 3. チャットで調整

`add Redis`、`move auth to the left`、`highlight the rollback path` など、焦点を絞ったリクエストを続けてください。Archify は型付きソースを保持するため、対象を限定して反復できます。

## 適切な図を選ぶ

| 種類 | 最適な用途 | プロンプトに含める内容 |
|---|---|---|
| **Architecture** | コンポーネント、サービス、ストレージ、境界 | スコープ、主要コンポーネント、主要経路 |
| **Workflow** | CI/CD、承認、ツール呼び出し、ランブック | 参加者、順序、分岐、例外 |
| **Sequence** | API 呼び出し、キャッシュフォールバック、認証、非同期トレース | 呼び出し元、呼び出し先、戻り値、タイミング |
| **Data Flow** | パイプライン、リネージ、PII、コンシューマー | ソース、変換、ストア、境界 |
| **Lifecycle** | 状態、再試行、待機、終了結果 | 状態、イベント、再試行とキャンセルの経路 |

どれが適切かわからない場合は、[インタラクティブなシナリオガイド](https://tt-a1i.github.io/archify/guide.html)を使うか、依存関係のない CLI に質問してください。

```bash
node archify/bin/archify.mjs guide "Show an API request with Redis cache miss"
node archify/bin/archify.mjs guide "Map Kafka topics, consumer groups, replay, and DLQ" --json
```

Workflow はレーンをまたぐ正常系を明確に示します。

![Workflow の例](docs/assets/archify-workflow.png)

Sequence は 1 つのインタラクションを時系列で説明します。

![Sequence の例](docs/assets/archify-sequence.png)

Data Flow はデータの移動と機密性の境界を明確にします。

![Data Flow の例](docs/assets/archify-dataflow.png)

Lifecycle は進行、待機、再試行、終了結果を区別します。

![Lifecycle の例](docs/assets/archify-lifecycle.png)

Architecture の例：[`web-app`](examples/web-app.html) · [`Archify pipeline`](examples/archify-repo.html) · [`grid placement`](examples/archify-repo-grid.html) · [`desktop agent`](examples/maka-architecture.html)

## Archify を選ぶ理由

- **汎用的な自動レイアウトよりもレイアウト判断を重視** — エージェントが階層、間隔、経路、強調を選択します。共有の自動端点は 1 つの中点に矢印を集中させず、決定論的に分散されます。
- **型付き JSON IR** — レンダラー対応の各モードにはスキーマと再現可能なソースがあります。
- **配信前のアトミックな検証** — ショーケース成果物が最後に成功した出力を置き換える前に、スキーマ、レイアウト、HTML/SVG、経路、ラベルと経路のクリアランスに関するすべてのチェックに合格する必要があります。
- **最後に成功したライブプレビュー** — オプションのデスクトップループが 1 つの JSON ファイルを監視し、最新候補がすべてのゲートに合格した場合のみ更新します。保存が不完全または無効な場合も、以前の検証済み図を表示し続けます。
- **事実に忠実なインタラクション** — フォーカス、経路、役割比較、ストーリーは、トポロジーを創作せずに作成済みのノードと関係を再利用します。
- **標準でポータブル** — 結果は 1 つの HTML ファイルです。エクスポートは完全な図を維持し、一時的なビューアー状態を含みません。

Archify は汎用的な描画エディターでも Mermaid テーマでもありません。技術的な意図をコミュニケーション成果物へ変換します。

## 仕組み

| ステップ | 処理内容 |
|---|---|
| **Generate** | エージェントが説明から型付き JSON IR を作成します。 |
| **Validate** | 同梱のバリデーターとレイアウト規則がソースをチェックします。 |
| **Preview（オプション）** | ループバック専用のデスクトップセッションが 1 つのソースを監視し、検証済みのリビジョンのみを再読み込みします。失敗時は最後に成功した成果物を保持します。 |
| **Deliver** | 同じディレクトリ内の候補をレンダリングしてチェックし、合格した成果物だけが対象をアトミックに置き換えます。その後、オプションの `--open` でそのファイルを開きます。 |
| **Iterate** | 関係のない構造を安定させたまま、エージェントがソースを更新します。 |

リポジトリで利用できるコマンド：

```bash
cd archify
node bin/archify.mjs doctor
node bin/archify.mjs demo /tmp/archify-demo
node bin/archify.mjs guide "Show CI/CD checks, approval, deploy, and rollback"
node bin/archify.mjs validate workflow examples/agent-tool-call.workflow.json --quality showcase --json
node bin/archify.mjs preview workflow examples/agent-tool-call.workflow.json /tmp/workflow.html --quality showcase
node bin/archify.mjs deliver workflow examples/agent-tool-call.workflow.json /tmp/workflow.html --quality showcase --open --json
```

`preview` は、デフォルトのバックグラウンドサービスではなく、明示的に起動するデスクトップオーサリングモードです。ランダムなポートの `127.0.0.1` だけにバインドし、指定された 1 つの JSON ファイルを監視します。最新の変更がすべてのゲートに合格した場合のみ更新し、保存が不完全または無効な場合は以前の検証済み出力を保持します。Ctrl-C で停止してください。テスト時や表示されたローカル URL を自分で開く場合は、`--no-open` を追加します。生成された HTML にランタイムは追加されません。

1 回限りのインタラクティブなローカル受け渡しには `deliver --open` を使用します。これはデフォルトで無効で、検証済み成果物がコミットされた後にのみ実行されます。OS のオープナーが利用できない場合も成功した配信を失敗にはしません。JSON は stdout に出力され、手動で開くための絶対パスは stderr に出力されます。

オプションのモーションとプレゼンテーションスタイルは明示的に指定します。

```json
{
  "meta": {
    "animation": "trace",
    "visual_preset": "signal-flow"
  }
}
```

完全に静的な図にするには `animation` を省略してください。デフォルトのビジュアルプリセットは引き続き `classic` です。

## 出力を探索して共有する

| 操作 | コントロール |
|---|---|
| 事実に基づく Diagram Guide を開く | <kbd>?</kbd> |
| セマンティックノードを検索してフォーカス | <kbd>/</kbd> |
| 有向経路を調べ、その流れを確認 | <kbd>R</kbd> または `PATH` |
| 1 つまたは 2 つのセマンティックな役割を比較 | <kbd>L</kbd> または `LENS` |
| ライブ概要レーダーを開く | <kbd>M</kbd> または `MAP` |
| ガイド付きストーリーを再生／チャプターを変更 | <kbd>P</kbd> / <kbd>[</kbd> <kbd>]</kbd> |
| Presentation Stage に入る | <kbd>F</kbd> |
| ビジュアルスタイルを切り替え／テーマを切り替え／Export を開く | <kbd>S</kbd> / <kbd>T</kbd> / <kbd>E</kbd> |
| ズームまたはリセット | <kbd>+</kbd> / <kbd>-</kbd> / <kbd>0</kbd> |

固定リンクでは `#focus=<id>`、`#relation=<id>`、`#route=<source>~<target>`、`#lens=<kind>~<kind>`、`#view=<view-id>` を復元できます。読者が操作して開始するモーションは有限で、`prefers-reduced-motion` を尊重し、標準エクスポートには含まれません。

生成とビューアーに関する完全な契約は [`archify/SKILL.md`](archify/SKILL.md) にあります。

## インストール方法

| 環境 | インストール先または方法 | 機能 |
|---|---|---|
| **Claude Code** | `~/.claude/skills/` または `.claude/skills/` | 完全なレンダラーと検証ワークフロー |
| **Codex CLI** | `~/.agents/skills/` または `.agents/skills/` | 完全なレンダラーと検証ワークフロー |
| **opencode** | `~/.config/opencode/skills/`、`.opencode/skills/`、または `.agents/skills/` | 完全なレンダラーと検証ワークフロー |
| **Claude.ai** | Settings → Capabilities → Skills から `archify.zip` をアップロード | サンドボックス内での Node.js アクセスに依存 |
| **Project Knowledge** | プロジェクトに `archify.zip` をアップロード | プロンプト駆動のアーキテクチャフォールバック |

## リファレンスとスコープ

- [スキーマリファレンス](archify/schemas/README.md)
- [スキルとレンダラーの契約](archify/SKILL.md)
- [サンプル](archify/examples/)
- [変更履歴](CHANGELOG.md)
- [ロードマップ](ROADMAP.md)
- [生成済み Proof Lab](https://tt-a1i.github.io/archify/gallery.html)

Archify 2.12 は、5 つすべてのモードに対応する型付き IR、実際のリポジトリを使った実証、検証済みライブプレビュー、オプションの有限モーション、ガイド付きビュー、セマンティック検索と関係探索、共有可能なディープリンク、1200×630 の図および経路カード、ブラウザー標準の WebM 録画、明示的な `standard` / `showcase` 品質プロファイルを備えています。

Mermaid の自動解析、汎用的な自動レイアウト、ホスト型共有、WYSIWYG 編集は、意図的に現在のスコープ外としています。

## 帰属表示

Archify は [Cocoon-AI/architecture-diagram-generator](https://github.com/Cocoon-AI/architecture-diagram-generator) v1.0 のフォークおよびリライトです。元のビジュアル言語は引き続き Cocoon AI に帰属します。Archify 2.x では、テーマ、エクスポート、型付きレンダラー、検証、アクセシビリティ、インタラクション、統合 CLI が追加されています。両プロジェクトとも MIT License を使用しています。

## ライセンス

[MIT](LICENSE) — 自由に使用、変更、配布できます。

## コントリビューション

Issue、Pull Request、共有された図を歓迎します。生成出力に関する問題では、プロンプト、図の種類、Archify のバージョンを含めてください。同梱サンプルまたはスタンドアロンビューアーを変更した後は、`node scripts/build-gallery.mjs` を実行してください。
