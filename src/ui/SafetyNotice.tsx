/**
 * 安全性の注意事項（SPEC.md §14）。
 * 初回起動時に必ず表示し、設定からいつでも再表示できる。
 */

import { useT } from './useT';

interface SafetyNoticeProps {
  mode: 'first-run' | 'review';
  onAcknowledge(): void;
}

export function SafetyNotice({ mode, onAcknowledge }: SafetyNoticeProps) {
  const t = useT();
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="safety-title">
      <div className="modal">
        <h2 id="safety-title">{t('safety.title')}</h2>
        <p className="faint">
          {t('safety.intro')}
          <strong>{t('safety.introStrong')}</strong>
          {t('safety.introEnd')}
        </p>
        <ul>
          <li>
            <strong>{t('safety.driving')}</strong>
            {t('safety.drivingEnd')}
          </li>
          <li>{t('safety.medical')}</li>
          <li>
            <strong>{t('safety.notMedicalStrong')}</strong>
            {t('safety.notMedical')}
          </li>
          <li>{t('safety.hearing')}</li>
          <li>{t('safety.noFlashing')}</li>
          <li>{t('safety.localOnly')}</li>
        </ul>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={onAcknowledge} autoFocus>
            {mode === 'first-run' ? t('safety.accept') : t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
