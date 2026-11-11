import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
  className?: string;
}

/** Accessible Light/Dark theme switch button built on the shared `.glass-control` surface. */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'glass-control group relative inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <Sun
        className={cn(
          'h-4 w-4 transition-all duration-200',
          isDark
            ? 'rotate-0 scale-100 opacity-100'
            : 'pointer-events-none absolute rotate-90 scale-50 opacity-0',
        )}
        aria-hidden="true"
      />
      <Moon
        className={cn(
          'h-4 w-4 transition-all duration-200',
          isDark
            ? 'pointer-events-none absolute -rotate-90 scale-50 opacity-0'
            : 'rotate-0 scale-100 opacity-100',
        )}
        aria-hidden="true"
      />
    </button>
  );
}
