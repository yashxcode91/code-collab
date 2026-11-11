'use client';

import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';

export interface MotionSubtitleProps {
  text: string;
  className?: string;
  direction?: 'top' | 'bottom';
  speed?: number;
  stagger?: number;
}

/**
 * Animated per-character blur/slide caption adapted from `@unlumen-ui/motion-subtitle`
 * to share CodeCollab's `motion/react` runtime with zero duplicate animation dependencies.
 */
export function MotionSubtitle({
  text,
  className,
  direction = 'top',
  speed = 1,
  stagger = 0.014,
}: MotionSubtitleProps) {
  const chars = Array.from(text);
  const safeSpeed = Math.min(3, Math.max(0.3, speed));
  const speedFactor = 1 / safeSpeed;
  const safeStagger = Math.min(0.08, Math.max(0, stagger));
  const directionY = direction === 'bottom' ? 9 : -9;
  const exitY = direction === 'bottom' ? -3 : 3;

  return (
    <span
      className={cn(
        'inline-flex min-h-[1.3em] max-w-full items-center justify-center overflow-hidden',
        className,
      )}
      aria-live="polite"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={text}
          className="inline-flex max-w-full flex-wrap justify-center"
          initial={{ opacity: 0, y: directionY * 0.75, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: exitY, filter: 'blur(4px)' }}
          transition={{ duration: 0.24 * speedFactor, ease: 'easeOut' }}
        >
          {chars.map((char, index) => (
            <motion.span
              key={`${text}-${index}`}
              className="inline-block"
              initial={{ opacity: 0, y: directionY, filter: 'blur(5px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: exitY, filter: 'blur(4px)' }}
              transition={{
                duration: 0.2 * speedFactor,
                ease: 'easeOut',
                delay: Math.min(index, 28) * safeStagger * speedFactor,
              }}
            >
              {char === ' ' ? '\u00A0' : char}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export default MotionSubtitle;
