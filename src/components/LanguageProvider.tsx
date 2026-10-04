'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { Lang, LANG_STORAGE_KEY, MESSAGES, Messages } from '@/lib/i18n';

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Messages;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'zh',
  setLang: () => undefined,
  t: MESSAGES.zh,
});

export const useI18n = () => useContext(LanguageContext);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // 服务端与首屏统一用中文渲染，挂载后再读取本地偏好，避免水合不一致
  const [lang, setLangState] = useState<Lang>('zh');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      if (saved === 'zh' || saved === 'en') setLangState(saved);
    } catch {
      // 隐私模式等情况下读取失败时保持默认
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({ lang, setLang, t: MESSAGES[lang] }),
    [lang, setLang]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
