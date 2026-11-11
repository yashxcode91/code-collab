import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
  className?: string;
  variant?: 'glass' | 'ghost';
}

/** Accessible Light/Dark theme switch button supporting both `.glass-control` and flat ghost toolbar chrome. */
export function ThemeToggle({
  className,
  variant = 'glass',
}: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'group relative inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground',
        variant === 'ghost'
          ? 'h-8 w-8 rounded-lg hover:bg-foreground/[0.06]'
          : 'glass-control h-9 w-9 rounded-xl',
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
