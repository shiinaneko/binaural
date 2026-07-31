/**
 * Service Worker の更新を確実に反映させる。
 *
 * PWA には「新しい Service Worker が入る」のと「新しいコードで動き出す」のがズレる問題がある。
 * skipWaiting / clientsClaim で新しい SW はすぐ制御を取るが、
 * **すでに読み込まれている HTML と JS は古いまま**なので、
 * 一度アプリを開き直しても前の版が動き続けてしまう。
 *
 * そこで制御が入れ替わったら自動で読み込み直す。
 * ただし初回インストール時にも controllerchange は発火するため、
 * 「もともと制御されていた場合」だけに限らないと無限リロードになる。
 */
export function setupServiceWorkerAutoReload(): void {
  if (!('serviceWorker' in navigator)) return;

  // 読み込み時点で制御されていたか。初回インストールならここは null。
  const hadController = navigator.serviceWorker.controller !== null;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}
