import { useMemo } from 'react';

import { useAppStore } from '@/lib/store';

import { getMessages } from './messages';

export function useI18n() {
  const locale = useAppStore(state => state.locale);
  const setLocale = useAppStore(state => state.setLocale);
  const toggleLocale = useAppStore(state => state.toggleLocale);

  const copy = useMemo(() => getMessages(locale), [locale]);

  return {
    locale,
    copy,
    setLocale,
    toggleLocale,
  };
}
