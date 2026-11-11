import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
  className?: string;
}

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
        'group relative inline-flex h-9 w-9 items-center justify-center rounded-lg',
        'border border-slate-900/10 bg-white/80 text-muted-foreground backdrop-blur-md',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(15,23,42,0.05)]',
        'hover:border-slate-900/20 hover:bg-white hover:text-foreground',
        'dark:border-white/[0.14] dark:bg-white/[0.06] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]',
        'dark:hover:border-white/25 dark:hover:bg-white/[0.1]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'transition-colors duration-150',
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

