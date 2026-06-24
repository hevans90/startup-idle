import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Phase = "idle" | "out" | "in";

const MAX_D = 10;
const STEP_MS = 16;
const STEP = MAX_D / (2000 / STEP_MS); // 2 s per phase

type SellTransitionCtx = { triggerSell: (onMidpoint: () => void) => void };
const Ctx = createContext<SellTransitionCtx>({ triggerSell: () => {} });
export const useSellTransition = () => useContext(Ctx);

export const SellTransitionProvider = ({ children }: { children: ReactNode }) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [d, setD] = useState(0);
  const midpointRef = useRef<(() => void) | null>(null);
  const firedRef = useRef(false);

  const triggerSell = useCallback((onMidpoint: () => void) => {
    midpointRef.current = onMidpoint;
    firedRef.current = false;
    setD(0);
    setPhase("out");
  }, []);

  // Drive d toward MAX_D (out) or 0 (in) at 60fps
  useEffect(() => {
    if (phase === "idle") return;
    const dir = phase === "out" ? 1 : -1;
    const id = setInterval(() => {
      setD((prev) => Math.max(0, Math.min(MAX_D, prev + dir * STEP)));
    }, STEP_MS);
    return () => clearInterval(id);
  }, [phase]);

  // Phase transitions at boundaries
  useEffect(() => {
    if (phase === "out" && d >= MAX_D && !firedRef.current) {
      firedRef.current = true;
      midpointRef.current?.();
      setPhase("in");
    } else if (phase === "in" && d <= 0) {
      setPhase("idle");
    }
  }, [phase, d]);

  const isActive = phase !== "idle";
  const showFilter = isActive && d >= 0.5;

  return (
    <Ctx.Provider value={{ triggerSell }}>
      {/* Filter def — 0×0, just registers the ID */}
      {isActive && (
        <svg
          width="0"
          height="0"
          aria-hidden
          style={{ position: "absolute", pointerEvents: "none" }}
        >
          <defs>
            <filter id="acq-pixelate" x="0%" y="0%" width="100%" height="100%">
              <feFlood x="2" y="2" height="1" width="1" />
              <feComposite width={d} height={d} />
              <feTile result="a" />
              <feComposite in="SourceGraphic" in2="a" operator="in" />
              <feMorphology operator="dilate" radius={d} />
            </filter>
          </defs>
        </svg>
      )}
      <div
        style={{
          width: "100%",
          height: "100%",
          ...(showFilter ? { filter: "url(#acq-pixelate)" } : {}),
        }}
      >
        {children}
      </div>
    </Ctx.Provider>
  );
};
