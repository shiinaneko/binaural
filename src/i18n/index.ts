/**
 * 文言の切り替え。
 *
 * 依存を増やさず、辞書引きと `{name}` の差し込みだけを行う小さな仕組みにしてある。
 * 初回は端末の言語設定から判定し、以降は設定画面で切り替えられる。
 */

import { dictionary, type Lang, type MessageKey } from './dictionary';

export type { Lang, MessageKey } from './dictionary';

export const LANGUAGES: Array<{ id: Lang; label: string }> = [
  { id: 'ja', label: '日本語' },
  { id: 'en', label: 'English' },
];

/** 端末の言語から初期値を決める。日本語以外はすべて英語にする。 */
export function detectLanguage(): Lang {
  if (typeof navigator === 'undefined') return 'ja';
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of languages) {
    if (typeof tag !== 'string') continue;
    if (tag.toLowerCase().startsWith('ja')) return 'ja';
    if (tag.toLowerCase().startsWith('en')) return 'en';
  }
  return 'en';
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function createTranslate(lang: Lang): Translate {
  const table = dictionary[lang] ?? dictionary.ja;
  return (key, params) => {
    const template = table[key] ?? dictionary.ja[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}
