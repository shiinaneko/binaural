/**
 * 安全性の注意事項（SPEC.md §14）。
 * 初回起動時に必ず表示し、設定からいつでも再表示できる。
 */

interface SafetyNoticeProps {
  mode: 'first-run' | 'review';
  onAcknowledge(): void;
}

export function SafetyNotice({ mode, onAcknowledge }: SafetyNoticeProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="safety-title">
      <div className="modal">
        <h2 id="safety-title">使用前にお読みください</h2>
        <p className="faint">
          バイノーラルビートは左右で異なる音を聴かせる仕組みのため、
          <strong>ヘッドホンやイヤホンが必要</strong>です。
        </p>
        <ul>
          <li>
            <strong>運転中・機械の操作中</strong>、その他注意力を要する場面では使用しないでください。
          </li>
          <li>
            てんかん・発作の既往、心疾患・不整脈、ペースメーカーの使用、妊娠中、精神疾患の治療中、
            補聴器・人工内耳を使用している場合は、使用前に医師に相談してください。
          </li>
          <li>
            <strong>本アプリは医療機器ではなく、診断・治療を目的としたものではありません。</strong>
            脳波同調（entrainment）の効果に関する研究結果は一貫しておらず、効果には個人差があります。
            「気分と集中を切り替えるための道具」として使ってください。
          </li>
          <li>
            聴覚保護のため、最大音量の 60% 以下・60 分ごとに休憩（60/60 ルール）をおすすめします。
          </li>
          <li>点滅やストロボは含みません。気分が悪くなった場合は直ちに使用を中止してください。</li>
          <li>
            すべてのデータはこの端末内にのみ保存され、外部に送信されることはありません。
          </li>
        </ul>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={onAcknowledge} autoFocus>
            {mode === 'first-run' ? '理解しました' : '閉じる'}
          </button>
        </div>
      </div>
    </div>
  );
}
