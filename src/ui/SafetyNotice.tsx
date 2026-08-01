/**
 * 安全性の注意事項（SPEC.md §14）。
 * 初回起動時に必ず表示し、設定からいつでも再表示できる。
 */

import { LANGUAGES } from '../i18n';
import { useAppStore } from '../state/store';
import { useT } from './useT';

interface SafetyNoticeProps {
  mode: 'first-run' | 'review';
  onAcknowledge(): void;
}

export function SafetyNotice({ mode, onAcknowledge }: SafetyNoticeProps) {
  const t = useT();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="safety-title">
      <div className="modal">
        {/*
          言語の選択は入口に置く。ここが最初に出る画面なので、
          「設定」という語が読めない人でも自分の言語に切り替えられる。
          各言語名はその言語自身で表記する（読めない言語で書かれていると意味がない）。
        */}
        <div className="chips" style={{ justifyContent: 'flex-end', marginBottom: 14 }}>
          {LANGUAGES.map((option) => (
            <button
              key={option.id}
              className="btn"
              aria-pressed={language === option.id}
              onClick={() => setLanguage(option.id)}
              lang={option.id}
              style={
                language === option.id
                  ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                  : undefined
              }
            >
              {option.label}
            </button>
          ))}
        </div>

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
