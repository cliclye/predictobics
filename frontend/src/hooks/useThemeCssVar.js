import { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';

/**
 * Reads a CSS custom property from :root after theme switches (Recharts etc.).
 */
export function useThemeCssVar(name, fallback) {
  const { theme } = useTheme();
  return useMemo(() => {
    if (typeof window === 'undefined') return fallback;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return raw || fallback;
  }, [theme, name, fallback]);
}
