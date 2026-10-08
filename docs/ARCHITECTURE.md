# アーキテクチャ

## MVPの構成
```text
Browser UI (src/main.js)
     ↕ HTTP commands / Server-Sent Events
Node HTTP server (server.js: auth, rooms, timer, fan-out)
     ↓ authoritative actions
Domain (src/domain.js: reducer, rules, scoring)
```

画面は即時の押下反応のため早押しを楽観表示し、サーバー配信状態で確定する。HTTP POSTで操作を送り、SSEで全端末にスナップショットを配る。Nodeのイベントループが一つのルームの操作を逐次適用する。ルーム、参加者トークン、タイマーはメモリ上にあり、再起動後は復元されない。

`src/platform.js` が端末APIの境界で、UIとドメインはDOM以外のブラウザー機能へ直接依存しない。WebではPWAのアプリシェルをキャッシュし、ネイティブでは同じ画面をCapacitor WebViewで動かす。ネイティブ起動側は `globalThis.QROOM_PLATFORM` でAPI接続先、HTTP要求、非同期ストレージ、触覚、共有、イベントストリーム、ライフサイクルイベントを注入できる。Appプラグインで復帰時に最新状態を再取得し、Androidの戻るボタンを画面遷移へ結び付ける。セッショントークンはSecure Storageプラグインを通してiOS Keychain / Android Keystoreで保護する。APIサーバー側CSP接続先は `QROOM_API_ORIGIN` で指定する。ゲームの通信契約（HTTPコマンド + SSE）は共通である。

## 将来のオンライン構成
```text
Web / iOS / Android clients
       ↕ WSS or HTTP commands + SSE events
Room service (authentication, authorization, room membership)
       ↕
Game domain / rule engine → durable event log and snapshots
```

サーバーを唯一の状態確定者とする。入力端末は触れた時点で押下中の表示・振動を出し、SSE状態で確定または訂正する。現在のMVPはWSSではなくHTTP POST + SSEを選択した。ブラウザー標準だけでサーバー配信を実装でき、依存なしで複数端末のコア体験を早く試せる。切断中の操作はサーバーで拒否され、再接続後に最新状態を受け取る。

## 公平性
単一端末MVPでは同じJavaScriptイベントループが受け取った順で判定する。複数端末ではネットワーク到着順は物理的な押下順を保証しない。サーバー到着時刻と単調時計、接続RTTの計測、時刻同期誤差の記録を組み合わせても、経路差・ジッター・端末入力遅延は消せない。許容窓で同着扱いにし、運用ルールにより判定する余地を残す。WebRTCやBluetooth等も異なる端末間の完全公平を自動的には実現せず、MVPでは導入しない。

## セキュリティ・信頼性
- 参加コードは暗号学的乱数で生成し、参加/API操作をIP単位でレート制限する。ホストと参加者には別々の推測困難なBearer tokenを割り当て、サーバーが操作ごとに認可する。
- ブラウザーからの得点・時刻を信用せず、サーバー側で遷移と得点を再計算する。
- ユーザー入力はテキストとしてエスケープする。個人情報を初期MVPで収集しない。
- ルームコードは参加権限を持つため、共有範囲に注意する。MVPはTLS終端を内包せず、公開時はHTTPSリバースプロキシが必要。
- HTTPではホスト/プレイヤーBearer tokenが平文で送られる。信頼できるLANでの試用に限定し、外部公開時はTLSを必須とする。
- ルームはメモリ上に最大1000件保持し、未接続で12時間更新がないルームを破棄する。サーバー再起動時の復元、切断参加者の整理、永続化は未実装。
