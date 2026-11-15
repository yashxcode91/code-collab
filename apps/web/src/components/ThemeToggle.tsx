import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
  className?: string;
  variant?: 'glass' | 'ghost';
}

/** Accessible Light/Dark theme switch button with active luminous radiant aura and icon glow. */
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
        'group relative inline-flex items-center justify-center transition-all duration-300 select-none',
        variant === 'ghost'
          ? 'h-8 w-8 rounded-lg'
          : 'glass-control h-9 w-9 rounded-xl',
        isDark
          ? 'border-amber-500/40 shadow-[0_0_16px_rgba(245,158,11,0.25)] hover:border-amber-400/70 hover:shadow-[0_0_22px_rgba(245,158,11,0.45)]'
          : 'border-indigo-400/40 shadow-[0_0_16px_rgba(99,102,241,0.2)] hover:border-indigo-500/70 hover:shadow-[0_0_22px_rgba(99,102,241,0.38)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      {/* Ambient Pulsing Aura Layer */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -inset-0.5 rounded-xl blur-sm transition-opacity duration-300 -z-10',
          isDark
            ? 'bg-gradient-to-tr from-amber-500/30 via-orange-500/25 to-yellow-400/20 opacity-70 group-hover:opacity-100'
            : 'bg-gradient-to-tr from-indigo-500/25 via-sky-400/20 to-blue-500/20 opacity-60 group-hover:opacity-100',
        )}
      />

      {/* Sun Icon (Glows Golden/Amber in Dark Mode) */}
      <Sun
        className={cn(
          'h-4 w-4 transition-all duration-300',
          isDark
            ? 'rotate-0 scale-100 opacity-100 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.85)] group-hover:rotate-45'
            : 'pointer-events-none absolute rotate-90 scale-50 opacity-0 text-amber-500',
        )}
        aria-hidden="true"
      />

      {/* Moon Icon (Glows Celestial Indigo in Light Mode) */}
      <Moon
        className={cn(
          'h-4 w-4 transition-all duration-300',
          isDark
            ? 'pointer-events-none absolute -rotate-90 scale-50 opacity-0 text-indigo-400'
            : 'rotate-0 scale-100 opacity-100 text-indigo-500 drop-shadow-[0_0_8px_rgba(99,102,241,0.75)] group-hover:-rotate-12',
        )}
        aria-hidden="true"
      />
    </button>
  );
}
