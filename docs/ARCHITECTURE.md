# アーキテクチャ

## MVPの構成
```text
HTML / CSS / UI (src/main.js)
          ↓ actions
Application boundary (dispatch)
          ↓
Domain (src/domain.js: state reducer, rules, scoring)
          ↓
Browser APIs (localStorage preference, vibration, fullscreen)
```

MVPはサーバー・永続ゲームストアを持たず、ゲーム状態はメモリ上に置く。表示コードは状態を描画し、状態変更はドメイン reducer のアクションを通す。ゲームルールはデータとして分離し、画面にルール条件を埋め込まない。

## 将来のオンライン構成
```text
Web / iOS / Android clients
       ↕ WSS (commands + authoritative events)
Room service (authentication, authorization, room membership)
       ↕
Game domain / rule engine → durable event log and snapshots
```

サーバーを唯一の状態確定者とする。入力端末は触れた時点で押下中の表示・振動を出し、サーバー応答後に確定または訂正する。通信切断時は受付中表示を「同期中」に変え、古い状態で判定を続けない。

## 公平性
単一端末MVPでは同じJavaScriptイベントループが受け取った順で判定する。複数端末ではネットワーク到着順は物理的な押下順を保証しない。サーバー到着時刻と単調時計、接続RTTの計測、時刻同期誤差の記録を組み合わせても、経路差・ジッター・端末入力遅延は消せない。許容窓で同着扱いにし、運用ルールにより判定する余地を残す。WebRTCやBluetooth等も異なる端末間の完全公平を自動的には実現せず、MVPでは導入しない。

## セキュリティ・信頼性
- 将来のオンライン版では参加コードの総当たり制限、推測困難なルームID、ロール別認可、レート制限、WSS、入力検証を行う。
- ブラウザーからの得点・時刻を信用せず、サーバー側で遷移と得点を再計算する。
- ユーザー入力はテキストとしてエスケープする。個人情報を初期MVPで収集しない。
- 現状の表示用ルームコードは接続機能やアクセス制御を提供しない。
