import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'codecollab-theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Manages Light/Dark theme class toggling on `<html>` (`document.documentElement`),
 * syncs user choice to `localStorage`, and briefly adds `theme-transitioning`
 * during switches for smooth CSS color transitions without initial-load flicker.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Light is primary/default unless the anti-flash script applied `.dark` from localStorage
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark')
        ? 'dark'
        : 'light';
    }
    return 'light';
  });

  const isInitialMount = useRef(true);

  useEffect(() => {
    const root = document.documentElement;

    // Skip transition class on very first mount so initial render never fades colors slowly
    if (!isInitialMount.current) {
      root.classList.add('theme-transitioning');
    } else {
      isInitialMount.current = false;
    }

    // Apply `.dark` class for Tailwind darkMode:'class' & inform native scrollbars/form controls
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore storage access restrictions
    }

    // Remove transition class after swap so hovering buttons stays snappy (150ms)
    const timer = window.setTimeout(() => {
      root.classList.remove('theme-transitioning');
    }, 220);

    return () => window.clearTimeout(timer);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

