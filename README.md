# Q-Room Pro

競技クイズルームのWeb MVPです。ホストとプレイヤーはルームコードで参加し、サーバー経由でゲーム状態をリアルタイム共有します。

## 起動

WebサーバーはNode.js 20以降で動作します。ネイティブ用のCapacitor 8 CLIはNode.js 22以降が必要です。Webだけを動かす場合、サーバー起動に外部パッケージのインストールは不要です。

```sh
npm start
```

同じ端末では `http://localhost:8000` を開きます。同じWi-Fiのスマートフォンから試す場合は、ホストPCのLANアドレス（例：`http://192.168.1.20:8000`）を開きます。ファイアウォールでポート8000への接続許可が必要な場合があります。

HTTPSで開くWebアプリはPWAとしてインストールできます。画面シェルはService Workerでキャッシュしますが、ルームの作成・参加・同期はオンライン接続が必要です。

## VercelへのWebデプロイ

リポジトリをVercelへインポートすると、`vercel.json` が `npm run build:vercel` を実行し、生成した `www/` を静的サイトとして公開します。Vercelプロジェクトの Environment Variables に `QROOM_API_BASE` を設定してください。値は別途稼働させるAPIサーバーのHTTPSオリジンです（例: `https://api.example.com`）。未設定やHTTPはビルド時にエラーになります。

このアプリのAPIはインメモリのルーム状態と長時間のSSE接続を使うため、フロントエンドの静的デプロイだけではゲーム機能は動きません。APIサーバーは常時稼働するNode.jsホストで動かし、`QROOM_WEB_ORIGINS` にVercelの本番ドメインを指定してください。プレビュー環境からも接続する場合は、そのプレビューURLも許可リストへ追加します。Vercel Functionsには実行時間上限があるため、現在のSSEサーバーをそのまま長時間接続用Functionにする構成は対象外です。[VercelのFunction実行時間](https://vercel.com/docs/functions/configuring-functions/duration)

Vercelの Build and Development Settings は `vercel.json` の設定を使います。Vercel側で独自のOutput Directoryを上書きしないでください。APIサーバーが別オリジンなら、そのサーバーでTLSとCORSを設定し、Webアプリの本番オリジンからのリクエストを許可します。

## ネイティブアプリの土台

画面とドメインはES Modulesのまま共有し、`src/platform.js` に保存・振動・共有・全画面・イベント接続などの端末差を集めています。Capacitor設定、Android/iOSプロジェクト、`www/` へのビルド処理を追加しました。ランチャーアイコンと起動画面は Web の SVG マークから依存なしで生成します。ストア署名・配布設定と実機検証はまだです。

ネイティブ専用バンドルはCapacitor App / Haptics / ShareとSecure Storageを利用します。セッショントークンはiOS KeychainまたはAndroid Keystoreで暗号化して保存します。Androidの戻るボタンは画面状態に応じてホームへ戻る、ルーム退出を確認する、アプリを閉じる動作にしています。アプリ復帰時はルームの最新状態を再取得します。追加の端末実装は `globalThis.QROOM_PLATFORM` で注入でき、`request(url, options)`、非同期 `storage.get/set/remove`、`haptics.buzz(ms)`、`share({title,text})`、`openRoomEvents(url)` を差し替えられます。イベント接続は `onmessage` / `onerror` を設定でき、`close()` を持つオブジェクトを返してください。

例: `globalThis.QROOM_PLATFORM = { apiBase: "https://api.example.com", storage: secureStorageAdapter }`。別オリジンのWebフロントエンドを使う場合は `QROOM_WEB_ORIGINS=https://app.example.com` をAPIサーバーに設定します。`QROOM_API_ORIGIN` はCSPの接続先に追加するAPI URLです。CORSはCapacitorのローカルオリジンと明示したWebオリジンだけ許可します。公開時はAPIもHTTPSにしてください。

ホストは参加リンクを共有できます。Web URLはブラウザーで開くとルームコードが参加フォームに自動入力され、`qroom://join?room=CODE` はインストール済みの Android / iOS アプリで参加画面を開きます。Webでは共有API、ネイティブではCapacitor Shareを使います。WebViewがEventSourceに対応しない場合は `openRoomEvents` にネイティブ側のSSE実装を渡せます。

ネイティブ資産の同期:

```sh
npm install
npx cap add android
# macOSでiOSも作る場合
npx cap add ios
QROOM_NATIVE_BUILD=1 QROOM_API_BASE=https://api.example.com QROOM_WEB_BASE=https://app.example.com npm run cap:sync
```

Android Studio / Android SDK、iOSではmacOS / Xcodeが別途必要です。`www/` はビルド生成物です。ネイティブビルドでは `QROOM_API_BASE` に到達可能なHTTPS APIを必ず指定してください。`QROOM_WEB_BASE` は共有リンクを開く公開WebアプリのHTTPSオリジンです。APIとWebアプリが同じオリジンなら省略でき、その場合はAPIオリジンを使います。Android/iOSのプロジェクトは `npx cap add` 済みです。既存環境では追加コマンドを省略し、`QROOM_NATIVE_BUILD=1 QROOM_API_BASE=https://api.example.com QROOM_WEB_BASE=https://app.example.com npm run cap:sync` でWeb資産と同期できます。

LAN上のHTTP接続では認証トークンが暗号化されません。信頼できるネットワークでの動作確認に限り、公開利用では必ずHTTPS終端を持つリバースプロキシの背後に配置してください。サーバー再起動時にルームとスコアは消去されます。

## 操作

- 司会がルームを作り、表示された8文字のコードをプレイヤーに共有します。
- プレイヤーは別端末からコードと名前を入力して参加します。
- ゲーム開始後、プレイヤー端末の大型ボタンから早押しします。
- 司会が正解/不正解を判定し、次の問題へ進行します。
- 誤答したプレイヤーはその問題の受付から外れ、ほかの参加者が続けて回答できます。
- 問題は20秒で自動終了し、司会の「回答なし」操作でも次問へ進めます。
- サーバーはSSEで状態を配信し、ゲーム操作をHTTP POSTで受け付けます。早押しはサーバーが受信・処理した順で確定し、物理的な押下順の公平性は保証しません。

ゲームルールと状態遷移は `src/domain.js` にあります。設計の詳細は `docs/PROJECT_SPEC.md`、`docs/ARCHITECTURE.md`、`docs/DOMAIN_MODEL.md`、`docs/TECH_STACK.md`、`docs/ROADMAP.md` を参照してください。
