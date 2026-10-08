window.setTimeout(() => {
  const app = document.querySelector("#app");
  if (!app || app.dataset.ready === "true") return;
  app.innerHTML = `<main class="boot-fallback" role="alert"><strong>画面を読み込めませんでした</strong><p>配信ファイルを取得できません。デプロイ状態とネットワークを確認して、再読み込みしてください。</p></main>`;
}, 12_000);
