import React, { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/shared/utils";

const regularCells = [
  { delay: "d-0", color: "var(--theme-text)" },
  { delay: "d-1", color: "color-mix(in oklab, var(--theme-text) 85%, var(--theme-text-subtle))" },
  { delay: "d-2", color: "color-mix(in oklab, var(--theme-text) 70%, var(--theme-text-subtle))" },
  { delay: "d-1", color: "color-mix(in oklab, var(--theme-text) 55%, var(--theme-text-subtle))" },
  { delay: "d-2", color: "color-mix(in oklab, var(--theme-text) 40%, var(--theme-text-subtle))" },
  {
    delay: "d-2",
    color: "color-mix(in oklab, var(--theme-text-subtle) 85%, var(--theme-text-muted))",
  },
  {
    delay: "d-3",
    color: "color-mix(in oklab, var(--theme-text-subtle) 65%, var(--theme-text-muted))",
  },
  {
    delay: "d-3",
    color: "color-mix(in oklab, var(--theme-text-subtle) 45%, var(--theme-text-muted))",
  },
  { delay: "d-4", color: "var(--theme-text-muted)" },
];

const ARROW_ALPHAS = [1.0, 0.35];
const EXPAND_ALPHAS = [1.0, 0.5, 0.15];

type ArrowDirection = "left" | "right" | "up" | "down";

function getArrowBand(idx: number, size: 3 | 5, dir: ArrowDirection): number {
  const row = Math.floor(idx / size);
  const col = idx % size;
  const center = (size - 1) / 2;
  if (dir === "left") return size - 1 - col + Math.abs(row - center);
  if (dir === "right") return col + Math.abs(row - center);
  if (dir === "up") return size - 1 - row + Math.abs(col - center);
  return row + Math.abs(col - center);
}

function getExpandBand(idx: number, size: 3 | 5): number {
  const row = Math.floor(idx / size);
  const col = idx % size;
  const center = (size - 1) / 2;
  return Math.abs(row - center) + Math.abs(col - center);
}

function getPerimeterIndices(size: 3 | 5): number[] {
  const indices: number[] = [];
  for (let col = 0; col < size; col += 1) indices.push(col);
  for (let row = 1; row < size - 1; row += 1) indices.push(row * size + (size - 1));
  for (let col = size - 1; col >= 0; col -= 1) indices.push((size - 1) * size + col);
  for (let row = size - 2; row >= 1; row -= 1) indices.push(row * size);
  return indices;
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

function getDefaultRippleCellStyle(
  idx: number,
  gridSize: 3 | 5,
  totalCells: number,
): React.CSSProperties {
  const row = Math.floor(idx / gridSize);
  const col = idx % gridSize;
  const diagonalBand = row + col;
  const maxBand = (gridSize - 1) * 2;
  const colorIdx = Math.round((idx * (regularCells.length - 1)) / Math.max(1, totalCells - 1));
  return {
    "--cell-color": regularCells[colorIdx]?.color ?? regularCells[0]!.color,
    animationDelay: `${Math.round((diagonalBand * 4) / Math.max(1, maxBand)) * 100}ms`,
  } as React.CSSProperties;
}

type DotGridLoaderProps = {
  variant?:
    | "default"
    | "spinner"
    | "expand"
    | "arrow-up"
    | "arrow-down"
    | "arrow-left"
    | "arrow-right";
  gridSize?: 3 | 5;
  sizeClassName?: string;
  className?: string;
  cellGapPx?: number;
  cellRadiusPx?: number;
};

const DotGridLoader = ({
  variant = "default",
  gridSize = 3,
  sizeClassName = "h-3.5 w-3.5",
  className,
  cellGapPx = 1,
  cellRadiusPx = 0,
}: DotGridLoaderProps) => {
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const spinnerHeadRef = useRef(0);
  const expandStepRef = useRef(0);
  const arrowStepRef = useRef(0);
  const isSpinner = variant === "spinner";
  const isExpand = variant === "expand";
  const totalCells = gridSize * gridSize;
  const spinnerBorder = useMemo(() => getPerimeterIndices(gridSize), [gridSize]);
  const spinnerTrail = Math.min(4, Math.max(2, Math.floor(spinnerBorder.length / 3)));
  const arrowDirection: ArrowDirection | null =
    variant === "arrow-left"
      ? "left"
      : variant === "arrow-right"
        ? "right"
        : variant === "arrow-up"
          ? "up"
          : variant === "arrow-down"
            ? "down"
            : null;
  const isArrow = arrowDirection !== null;

  useEffect(() => {
    if (!isSpinner) return;
    const id = setInterval(() => {
      const head = spinnerHeadRef.current;
      spinnerBorder.forEach((idx, i) => {
        const dist =
          (((head - i) % spinnerBorder.length) + spinnerBorder.length) % spinnerBorder.length;
        const el = cellRefs.current[idx];
        if (!el) return;
        if (dist < spinnerTrail) {
          const alpha = 1 - dist / spinnerTrail;
          const colorIdx = Math.round(
            (i * (regularCells.length - 1)) / Math.max(1, spinnerBorder.length - 1),
          );
          el.style.backgroundColor = regularCells[colorIdx]?.color ?? regularCells[0]!.color;
          el.style.opacity = alpha.toFixed(2);
        } else {
          el.style.backgroundColor = "transparent";
          el.style.opacity = "0";
        }
      });
      spinnerHeadRef.current = (head + 1) % spinnerBorder.length;
    }, 120);
    return () => clearInterval(id);
  }, [isSpinner, spinnerBorder, spinnerTrail]);

  useEffect(() => {
    if (!isExpand) return;
    const bands = Array.from({ length: totalCells }, (_, i) => getExpandBand(i, gridSize));
    const maxBand = Math.max(...bands);
    const cellColors = bands.map((band) => colorForBrightnessLevel(maxBand - band, maxBand + 1));
    const total = maxBand + EXPAND_ALPHAS.length;
    const id = setInterval(() => {
      const step = expandStepRef.current;
      for (let i = 0; i < totalCells; i += 1) {
        const el = cellRefs.current[i];
        if (!el) continue;
        const behind = step - bands[i]!;
        if (behind >= 0 && behind < EXPAND_ALPHAS.length) {
          el.style.backgroundColor = cellColors[i]!;
          el.style.opacity = `${EXPAND_ALPHAS[behind]!}`;
        } else {
          el.style.backgroundColor = "transparent";
          el.style.opacity = "0";
        }
      }
      expandStepRef.current = (step + 1) % total;
    }, 160);
    return () => clearInterval(id);
  }, [gridSize, isExpand, totalCells]);

  useEffect(() => {
    if (!isArrow) return;
    const bands = Array.from({ length: totalCells }, (_, i) =>
      getArrowBand(i, gridSize, arrowDirection),
    );
    const total = Math.max(...bands) + ARROW_ALPHAS.length + 2;
    const id = setInterval(() => {
      const step = arrowStepRef.current;
      for (let i = 0; i < totalCells; i += 1) {
        const el = cellRefs.current[i];
        if (!el) continue;
        const behind = step - bands[i]!;
        if (behind >= 0 && behind < ARROW_ALPHAS.length) {
          el.style.backgroundColor = colorForBrightnessLevel(behind, ARROW_ALPHAS.length);
          el.style.opacity = `${ARROW_ALPHAS[behind]!}`;
        } else {
          el.style.backgroundColor = "transparent";
          el.style.opacity = "0";
        }
      }
      arrowStepRef.current = (step + 1) % total;
    }, 160);
    return () => clearInterval(id);
  }, [arrowDirection, gridSize, isArrow, totalCells]);

  return (
    <div
      className={cn(
        "dot-grid-loader",
        (isSpinner || isExpand || isArrow) && "rounded-[12px]",
        sizeClassName,
        className,
      )}
      style={
        {
          "--dot-grid-gap": `${cellGapPx}px`,
          "--dot-grid-cell-radius": `${cellRadiusPx}px`,
          gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
        } as React.CSSProperties
      }
    >
      {Array.from({ length: totalCells }, (_, i) =>
        isSpinner || isExpand || isArrow ? (
          <div
            key={i}
            ref={(el) => {
              cellRefs.current[i] = el;
            }}
            className="dot-grid-loader-cell"
            style={{
              backgroundColor: "transparent",
              opacity: 0,
              transition: "background-color 60ms linear, opacity 60ms linear",
            }}
          />
        ) : (
          <div
            key={i}
            className="dot-grid-loader-cell dot-grid-loader-cell-ripple"
            style={getDefaultRippleCellStyle(i, gridSize, totalCells)}
          />
        ),
      )}
    </div>
  );
};

export default DotGridLoader;
