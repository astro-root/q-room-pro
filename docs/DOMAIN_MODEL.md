# ドメインモデル

## エンティティ
- **Game**: ルーム名、表示コード、ルールID、フェーズ、問題番号、参加プレイヤー、回答順、回答者。
- **Player**: ID、表示名、正解数、誤答数、得点、ペナルティ状態、失格状態。
- **GameRule**: ID、名称、勝利に必要な○数、失格となる×数（任意）、正解得点。
- 将来必要になればUser、Question、BuzzEvent、AnswerResult、GameResultを独立した永続モデルとして追加する。現時点でアカウントや問題保管庫は作らない。

## 状態遷移
```text
READY --START--> QUESTION --BUZZ--> BUZZED --JUDGE(correct)--> READY
     ^                                        |
     |                    JUDGE(incorrect)    +--> QUESTION (eligible players remain)
     |                                        +--> READY (no eligible player remains)
     +------------------------------- NEXT -----------------------+
QUESTION --NO_ANSWER / timeout--> READY
READY / QUESTION / BUZZED --END--> FINISHED
FINISHED --RESET--> READY
```
遷移は `reduceGame` に集約する。早押しはQUESTION中のみ有効。勝利条件成立または全員失格でFINISHEDとなる。無効なアクションは状態を変えない。

司会者は `SET_SCORE` でプレイヤーの得点を0〜999の整数へ修正できる。サーバーが司会者認証と対象プレイヤー、値域を検証する。判定・得点修正は直前の1操作をUndoでき、Undo時はQUESTIONの残り時間も復元する。

## ルール
- 7○3×: 正解1点、7○で勝利、3×で失格。
- 10by10: 正解1点、10○で勝利、誤答による失格なし。
- 誤答者は当該問題の再回答ができず、ほかに押せるプレイヤーがいれば同じ問題の受付を続ける。
- ペナルティ表示は誤答後から次の問題開始まで。7○3×では3×で失格。
- 拡張ルールはGameRuleの設定と独立した判定関数を追加する。UIに勝利条件を直接記述しない。

## 早押し
Nodeサーバーが受け付けた最初の有効なBUZZを回答者にする。`buzzOrder` はルーム内の受信順を記録し、最初の回答で受付を閉じる。同時到着の比較・同着裁定は実装していない。実押下時刻の完全な再現や公平性は保証できない。

## 結果順位
勝者、得点、○数、×数の順で並べる。同点時の追加ルールはMVPでは確定していないため、この順序は表示上の暫定タイブレークである。
