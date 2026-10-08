# Q-Room Pro

競技クイズルームのWeb MVPです。ホストとプレイヤーはルームコードで参加し、サーバー経由でゲーム状態をリアルタイム共有します。

## 起動

WebサーバーはNode.js 20以降で動作します。ネイティブ用のCapacitor 8 CLIはNode.js 22以降が必要です。Webだけを動かす場合、サーバー起動に外部パッケージのインストールは不要です。

```sh
npm start
```

同じ端末では `http://localhost:8000` を開きます。同じWi-Fiのスマートフォンから試す場合は、ホストPCのLANアドレス（例：`http://192.168.1.20:8000`）を開きます。ファイアウォールでポート8000への接続許可が必要な場合があります。

HTTPSで開くWebアプリはPWAとしてインストールできます。画面シェルはService Workerでキャッシュしますが、ルームの作成・参加・同期はオンライン接続が必要です。

## ネイティブアプリの土台

画面とドメインはES Modulesのまま共有し、`src/platform.js` に保存・振動・共有・全画面・イベント接続などの端末差を集めています。Capacitor設定、Android/iOSプロジェクト、`www/` へのビルド処理を追加しました。ストア署名・配布設定と実機検証はまだです。

ネイティブ専用バンドルはCapacitor Haptics / Shareを利用します。追加の端末実装は `globalThis.QROOM_PLATFORM` で注入でき、`request(url, options)`、非同期 `storage.get/set/remove`、`haptics.buzz(ms)`、`share({title,text})`、`openRoomEvents(url)` を差し替えられます。イベント接続は `onmessage` / `onerror` を設定でき、`close()` を持つオブジェクトを返してください。ネイティブでは安全なストレージアダプターがない限り、セッショントークンを保存しません。その場合、アプリ再起動後はルームへ再参加が必要です。

例: `globalThis.QROOM_PLATFORM = { apiBase: "https://api.example.com", storage: secureStorageAdapter }`。APIサーバーには同じオリジンを `QROOM_API_ORIGIN` 環境変数で設定してください（CSPの接続先に追加されます）。CORSはBearer認証を使うAPI向けに有効です。公開時はAPIもHTTPSにしてください。

Webでは振動・共有の標準APIを使い、ネイティブではCapacitor Haptics / Shareを使います。WebViewがEventSourceに対応しない場合は `openRoomEvents` にネイティブ側のSSE実装を渡せます。

ネイティブ資産の同期:

```sh
npm install
npx cap add android
# macOSでiOSも作る場合
npx cap add ios
QROOM_NATIVE_BUILD=1 QROOM_API_BASE=https://api.example.com npm run cap:sync
```

Android Studio / Android SDK、iOSではmacOS / Xcodeが別途必要です。`www/` はビルド生成物です。ネイティブビルドでは `QROOM_API_BASE` に到達可能なHTTPS APIを必ず指定してください。Webサーバーと同一オリジンで使う場合だけ省略できます。Android/iOSのプロジェクトは `npx cap add` 済みです。既存環境では追加コマンドを省略し、`QROOM_NATIVE_BUILD=1 QROOM_API_BASE=https://api.example.com npm run cap:sync` でWeb資産と同期できます。

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
