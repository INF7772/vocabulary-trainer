import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

interface FitState {
  height: number | null;
  scale: number;
}

export function PracticeViewport({ children }: { children: ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<FitState>({ height: null, scale: 1 });

  const measure = useCallback(() => {
    const shell = shellRef.current;
    const content = contentRef.current;
    if (!shell || !content) return;
    const naturalHeight = content.scrollHeight;
    if (naturalHeight <= 0) return;
    const availableHeight = Math.max(
      160,
      window.innerHeight - shell.getBoundingClientRect().top - 12,
    );
    const scale = Math.min(1, availableHeight / naturalHeight);
    const height = Math.ceil(naturalHeight * scale);
    setFit((current) =>
      Math.abs(current.scale - scale) < 0.002 && current.height === height
        ? current
        : { height, scale },
    );
  }, []);

  useLayoutEffect(() => {
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (contentRef.current) observer?.observe(contentRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return (
    <div
      className="w-full overflow-hidden"
      data-practice-scale={fit.scale.toFixed(3)}
      data-testid="practice-viewport"
      ref={shellRef}
      style={fit.height === null ? undefined : { height: fit.height }}
    >
      <div
        ref={contentRef}
        style={{
          transform: `scale(${fit.scale})`,
          transformOrigin: "top center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
