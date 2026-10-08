import { RotateCcw, Trash2 } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import type { HandwritingDrawing, HandwritingPoint } from "../domain";
import { Button } from "./ui/Button";

export function HandwritingPad({
  disabled = false,
  drawing,
  guide,
  onChange,
}: {
  disabled?: boolean;
  drawing?: HandwritingDrawing;
  guide?: string;
  onChange?: (drawing: HandwritingDrawing) => void;
}) {
  const { t } = useTranslation();
  const [strokes, setStrokes] = useState<HandwritingDrawing>([]);
  const visibleStrokes = drawing ?? strokes;
  const activePointer = useRef<number | null>(null);

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): HandwritingPoint {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * 320,
      y: ((event.clientY - bounds.top) / bounds.height) * 320,
    };
  }

  function startStroke(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || activePointer.current !== null) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some touch/pen drivers release the pointer before React receives the event.
      // Drawing still works without capture until the next pointer boundary.
    }
    activePointer.current = event.pointerId;
    const next = [...visibleStrokes, [pointFromEvent(event)]];
    setStrokes(next);
    onChange?.(next);
  }

  function extendStroke(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || activePointer.current !== event.pointerId) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    if (visibleStrokes.length === 0) return;
    const next = [...visibleStrokes];
    next[next.length - 1] = [...next[next.length - 1]!, point];
    setStrokes(next);
    onChange?.(next);
  }

  function endStroke(event: ReactPointerEvent<SVGSVGElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Losing capture between separate strokes is normal for touch and pens.
    }
  }

  function undo() {
    const next = visibleStrokes.slice(0, -1);
    setStrokes(next);
    onChange?.(next);
  }

  function clear() {
    setStrokes([]);
    onChange?.([]);
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-3">
      <div className="overflow-hidden rounded-3xl border-2 border-slate-300 bg-white shadow-inner dark:border-slate-600 dark:bg-slate-950">
        <svg
          aria-label={t("handwriting.canvas")}
          className={`aspect-square w-full touch-none ${disabled ? "cursor-default opacity-75" : "cursor-crosshair"}`}
          onPointerCancel={endStroke}
          onPointerDown={startStroke}
          onPointerMove={extendStroke}
          onPointerUp={endStroke}
          onLostPointerCapture={() => {
            activePointer.current = null;
          }}
          role="img"
          viewBox="0 0 320 320"
        >
          <path d="M160 0V320M0 160H320M0 0L320 320M320 0L0 320" stroke="currentColor" strokeDasharray="7 7" strokeWidth="1" className="text-slate-200 dark:text-slate-800" />
          {guide ? (
            <text
              aria-hidden="true"
              className="text-sky-500/35 dark:text-sky-300/30"
              dominantBaseline="central"
              fill="none"
              fontFamily="sans-serif"
              fontSize={[...guide].length > 1 ? 190 : 255}
              fontWeight="500"
              stroke="currentColor"
              strokeDasharray="5 4"
              strokeWidth="2.5"
              textAnchor="middle"
              x="160"
              y="160"
            >
              {guide}
            </text>
          ) : null}
          {visibleStrokes.map((stroke, index) => (
            <polyline
              fill="none"
              key={index}
              points={stroke.map((point) => `${point.x},${point.y}`).join(" ")}
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="12"
              className="text-slate-950 dark:text-slate-50"
            />
          ))}
        </svg>
      </div>
      {!disabled ? (
        <div className="flex justify-center gap-2">
          <Button disabled={visibleStrokes.length === 0} icon={<RotateCcw size={17} aria-hidden="true" />} onClick={undo} type="button" variant="secondary">
            {t("handwriting.undo")}
          </Button>
          <Button disabled={visibleStrokes.length === 0} icon={<Trash2 size={17} aria-hidden="true" />} onClick={clear} type="button" variant="secondary">
            {t("handwriting.clear")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
