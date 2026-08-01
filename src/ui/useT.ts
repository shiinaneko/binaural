import { useMemo } from 'react';
import { createTranslate, type Translate } from '../i18n';
import { useAppStore } from '../state/store';

/** 現在の言語で文言を引く。言語が変われば全画面が自動で再描画される。 */
export function useT(): Translate {
  const language = useAppStore((s) => s.language);
  return useMemo(() => createTranslate(language), [language]);
}
