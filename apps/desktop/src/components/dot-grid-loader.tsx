import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/shared/utils';

const regularCells = [
  { delay: 'd-0', color: 'var(--theme-text)' },
  { delay: 'd-1', color: 'color-mix(in oklab, var(--theme-text) 85%, var(--theme-text-subtle))' },
  { delay: 'd-2', color: 'color-mix(in oklab, var(--theme-text) 70%, var(--theme-text-subtle))' },
  { delay: 'd-1', color: 'color-mix(in oklab, var(--theme-text) 55%, var(--theme-text-subtle))' },
  { delay: 'd-2', color: 'color-mix(in oklab, var(--theme-text) 40%, var(--theme-text-subtle))' },
  { delay: 'd-2', color: 'color-mix(in oklab, var(--theme-text-subtle) 85%, var(--theme-text-muted))' },
  { delay: 'd-3', color: 'color-mix(in oklab, var(--theme-text-subtle) 65%, var(--theme-text-muted))' },
  { delay: 'd-3', color: 'color-mix(in oklab, var(--theme-text-subtle) 45%, var(--theme-text-muted))' },
  { delay: 'd-4', color: 'var(--theme-text-muted)' },
];

const SPINNER_BORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const SPINNER_TRAIL = 4;
const ARROW_ALPHAS = [1.0, 0.35];

type ArrowDirection = 'left' | 'right' | 'up' | 'down';

function getArrowBand(idx: number, dir: ArrowDirection): number {
  const row = Math.floor(idx / 3);
  const col = idx % 3;
  if (dir === 'left') return (2 - col) + Math.abs(row - 1);
  if (dir === 'right') return col + Math.abs(row - 1);
  if (dir === 'up') return (2 - row) + Math.abs(col - 1);
  return row + Math.abs(col - 1);
}

function colorForBrightnessLevel(level: number, totalLevels: number): string {
  if (totalLevels === 2) {
    return level === 0 ? regularCells[0]!.color : regularCells[3]!.color;
  }
  if (totalLevels <= 1) {
    return regularCells[0]!.color;
  }
  const colorIdx = Math.round((level * (regularCells.length - 1)) / (totalLevels - 1));
  return regularCells[colorIdx]?.color ?? regularCells[0]!.color;
}

const delayMap: Record<string, string> = {
  'd-0': '0ms',
  'd-1': '100ms',
  'd-2': '200ms',
  'd-3': '300ms',
  'd-4': '400ms',
};

type DotGridLoaderProps = {
  variant?: 'default' | 'spinner' | 'arrow-up' | 'arrow-down' | 'arrow-left' | 'arrow-right';
  sizeClassName?: string;
  className?: string;
  cellGapPx?: number;
  cellRadiusPx?: number;
};

const DotGridLoader = ({
  variant = 'default',
  sizeClassName = 'h-3.5 w-3.5',
  className,
  cellGapPx = 1,
  cellRadiusPx = 0,
}: DotGridLoaderProps) => {
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const spinnerHeadRef = useRef(0);
  const arrowStepRef = useRef(0);
  const isSpinner = variant === 'spinner';
  const arrowDirection: ArrowDirection | null =
    variant === 'arrow-left'
      ? 'left'
      : variant === 'arrow-right'
        ? 'right'
        : variant === 'arrow-up'
          ? 'up'
          : variant === 'arrow-down'
            ? 'down'
            : null;
  const isArrow = arrowDirection !== null;

  useEffect(() => {
    if (!isSpinner) return;
    const id = setInterval(() => {
      const head = spinnerHeadRef.current;
      SPINNER_BORDER.forEach((idx, i) => {
        const dist = ((head - i) % SPINNER_BORDER.length + SPINNER_BORDER.length) % SPINNER_BORDER.length;
        const el = cellRefs.current[idx];
        if (!el) return;
        if (dist < SPINNER_TRAIL) {
          const alpha = 1 - dist / SPINNER_TRAIL;
          const colorIdx = Math.round((i * (regularCells.length - 1)) / (SPINNER_BORDER.length - 1));
          el.style.backgroundColor = regularCells[colorIdx]?.color ?? regularCells[0]!.color;
          el.style.opacity = alpha.toFixed(2);
        } else {
          el.style.backgroundColor = 'transparent';
          el.style.opacity = '0';
        }
      });
      if (cellRefs.current[4]) {
        cellRefs.current[4].style.backgroundColor = 'transparent';
        cellRefs.current[4].style.opacity = '0';
      }
      spinnerHeadRef.current = (head + 1) % SPINNER_BORDER.length;
    }, 120);
    return () => clearInterval(id);
  }, [isSpinner]);

  useEffect(() => {
    if (!isArrow) return;
    const bands = Array.from({ length: 9 }, (_, i) => getArrowBand(i, arrowDirection));
    const total = Math.max(...bands) + ARROW_ALPHAS.length + 2;
    const id = setInterval(() => {
      const step = arrowStepRef.current;
      for (let i = 0; i < 9; i += 1) {
        const el = cellRefs.current[i];
        if (!el) continue;
        const behind = step - bands[i]!;
        if (behind >= 0 && behind < ARROW_ALPHAS.length) {
          el.style.backgroundColor = colorForBrightnessLevel(behind, ARROW_ALPHAS.length);
          el.style.opacity = `${ARROW_ALPHAS[behind]!}`;
        } else {
          el.style.backgroundColor = 'transparent';
          el.style.opacity = '0';
        }
      }
      arrowStepRef.current = (step + 1) % total;
    }, 160);
    return () => clearInterval(id);
  }, [arrowDirection, isArrow]);

  return (
    <div
      className={cn(
        'dot-grid-loader',
        (isSpinner || isArrow) && 'rounded-[12px]',
        sizeClassName,
        className,
      )}
      style={
        {
          '--dot-grid-gap': `${cellGapPx}px`,
          '--dot-grid-cell-radius': `${cellRadiusPx}px`,
        } as React.CSSProperties
      }
    >
      {Array.from({ length: 9 }, (_, i) =>
        isSpinner || isArrow ? (
          <div
            key={i}
            ref={(el) => {
              cellRefs.current[i] = el;
            }}
            className="dot-grid-loader-cell"
            style={{
              backgroundColor: 'transparent',
              opacity: 0,
              transition: 'background-color 60ms linear, opacity 60ms linear',
            }}
          />
        ) : (
          <div
            key={i}
            className="dot-grid-loader-cell dot-grid-loader-cell-ripple"
            style={
              {
                '--cell-color': regularCells[i]!.color,
                animationDelay: delayMap[regularCells[i]!.delay],
              } as React.CSSProperties
            }
          />
        ),
      )}
    </div>
  );
};

export default DotGridLoader;