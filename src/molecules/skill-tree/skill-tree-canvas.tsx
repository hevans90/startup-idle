import { Application, extend, useApplication, useTick } from "@pixi/react";
import { Viewport } from "pixi-viewport";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  buildAdjacency,
  isReachable,
  nodeById,
  type SkillNode,
  SKILL_TREE,
  treeBounds,
} from "../../game/skill-tree";
import { usePrestigeStore } from "../../state/prestige.store";
import { useSkillTreeUiStore } from "../../state/skill-tree-ui.store";
import { useResizeToWrapper } from "../../hooks/use-resize-to-wrapper";
import { useDisableDOMZoom } from "../../office/utils/use-disable-dom-zoom";

extend({ Container, Graphics, Sprite, Viewport });

const ADJ = buildAdjacency(SKILL_TREE);
const NODES = nodeById(SKILL_TREE);

// State colours (shown as the node's ring + inner glow).
const C_ALLOCATED = 0xffd97a; // gold
const C_AVAILABLE = 0x6ee7b7; // green — reachable + affordable
const C_HOVER = 0xeafff4; // bright mint — hovering an allocatable node
const C_REACHABLE = 0xe0a23a; // amber — reachable but can't afford
const C_LOCKED = 0x47506a; // dim
const C_INNER = 0x161b29; // dark disc behind the icon
const C_EDGE_LIT = 0xffd97a; // gold — both ends allocated
const C_EDGE_PREVIEW = 0x6ee7b7; // green — path you'd connect by allocating
const C_EDGE_DIM = 0x3a4258;

const radiusFor = (n: SkillNode) =>
  n.kind === "notable" ? 24 : n.kind === "root" ? 20 : 15;

// Cache icon textures by url so we don't re-create them each render.
const iconCache = new Map<string, Texture>();
const iconTexture = (url: string): Texture => {
  let tex = iconCache.get(url);
  if (!tex) {
    tex = Texture.from(url);
    iconCache.set(url, tex);
  }
  return tex;
};

/** The nodes + edges, redrawn whenever allocation or Equity changes. Hover is
 * published to the UI store for the DOM tooltip; no text is rendered on-canvas. */
const TreeScene = memo(function TreeScene() {
  const allocated = usePrestigeStore((s) => s.allocated);
  const equity = usePrestigeStore((s) => s.equity);
  const allocatedSet = useMemo(() => new Set(allocated), [allocated]);

  // Subscribe to the hovered NODE ID only — it changes when you move between
  // nodes, not every frame (the position updates separately), so this re-renders
  // (and recolours) the scene only on real hover changes.
  const hoveredId = useSkillTreeUiStore((s) => s.hovered?.id ?? null);
  const hoverNode = hoveredId ? NODES.get(hoveredId) : undefined;
  const hoverAvailable =
    !!hoverNode &&
    !allocatedSet.has(hoverNode.id) &&
    isReachable(SKILL_TREE, allocatedSet, hoverNode.id, ADJ) &&
    equity.gte(hoverNode.cost);

  // Hover tracking (mirrors the city): set on pointerover, debounced clear on
  // pointerout so crossing between nodes doesn't flicker the tooltip.
  const hoverIdRef = useRef<string | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const wroteRef = useRef(false);

  const onHover = useCallback((id: string) => {
    if (clearTimerRef.current != null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    hoverIdRef.current = id;
  }, []);
  const onUnhover = useCallback((id: string) => {
    if (clearTimerRef.current != null) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      if (hoverIdRef.current === id) hoverIdRef.current = null;
    }, 60);
  }, []);

  // Each frame, project the hovered node to screen space for the DOM tooltip.
  useTick(() => {
    const store = useSkillTreeUiStore.getState();
    const id = hoverIdRef.current;
    const vp = store.viewport;
    if (!id || !vp) {
      if (wroteRef.current) {
        store.setHovered(null);
        wroteRef.current = false;
      }
      return;
    }
    const node = NODES.get(id);
    if (!node) return;
    const screen = vp.toScreen(node.x, node.y);
    store.setHovered({ id, x: screen.x, y: screen.y });
    wroteRef.current = true;
  });

  return (
    <pixiContainer>
      {SKILL_TREE.edges.map(([a, b], i) => {
        const na = NODES.get(a)!;
        const nb = NODES.get(b)!;
        const lit = allocatedSet.has(a) && allocatedSet.has(b);
        // Preview the connection from a hovered allocatable node to its
        // already-allocated neighbour (the path you'd light up by allocating).
        const preview =
          hoverAvailable &&
          ((a === hoveredId && allocatedSet.has(b)) ||
            (b === hoveredId && allocatedSet.has(a)));
        return (
          <pixiGraphics
            key={`e${i}`}
            draw={(g: Graphics) => {
              g.clear();
              const line = () => {
                g.moveTo(na.x, na.y);
                g.lineTo(nb.x, nb.y);
              };
              if (lit) {
                // subtle glow underlay + crisp core
                line();
                g.stroke({ width: 9, color: C_EDGE_LIT, alpha: 0.16 });
                line();
                g.stroke({ width: 3, color: C_EDGE_LIT, alpha: 0.85 });
              } else if (preview) {
                line();
                g.stroke({ width: 4, color: C_EDGE_PREVIEW, alpha: 0.7 });
              } else {
                line();
                g.stroke({ width: 4, color: C_EDGE_DIM, alpha: 0.7 });
              }
            }}
          />
        );
      })}

      {SKILL_TREE.nodes.map((node) => {
        const isAlloc = allocatedSet.has(node.id);
        const reachable = isReachable(SKILL_TREE, allocatedSet, node.id, ADJ);
        const affordable = equity.gte(node.cost);
        const available = !isAlloc && reachable && affordable;
        // Hovering an allocatable node lights it up brightly (PoE-style).
        const hot = available && node.id === hoveredId;
        const ring = isAlloc
          ? C_ALLOCATED
          : hot
            ? C_HOVER
            : available
              ? C_AVAILABLE
              : reachable
                ? C_REACHABLE
                : C_LOCKED;
        const r = radiusFor(node);

        return (
          <pixiContainer key={node.id} x={node.x} y={node.y}>
            <pixiGraphics
              eventMode="static"
              cursor="pointer"
              onPointerTap={() => usePrestigeStore.getState().allocate(node.id)}
              onPointerOver={() => onHover(node.id)}
              onPointerOut={() => onUnhover(node.id)}
              draw={(g: Graphics) => {
                g.clear();
                // outer glow when hovering an allocatable node
                if (hot) {
                  g.circle(0, 0, r + 7);
                  g.fill({ color: C_AVAILABLE, alpha: 0.28 });
                }
                g.circle(0, 0, r);
                g.fill(C_INNER);
                if (isAlloc) {
                  g.circle(0, 0, r);
                  g.fill({ color: ring, alpha: 0.22 });
                }
                g.circle(0, 0, r);
                g.stroke({ width: hot ? 4 : 3, color: ring, alpha: hot ? 1 : 0.95 });
              }}
            />
            {node.icon && (
              <pixiSprite
                texture={iconTexture(node.icon)}
                anchor={0.5}
                width={r * 1.5}
                height={r * 1.5}
                eventMode="none"
              />
            )}
          </pixiContainer>
        );
      })}
    </pixiContainer>
  );
});

/** Self-contained pan/zoom viewport (does NOT touch the office/city viewport). */
const TreeViewport = memo(function TreeViewport({
  screenSize,
  children,
}: {
  screenSize: { width: number; height: number };
  children: React.ReactNode;
}) {
  const pixiApp = useApplication();
  const events = pixiApp?.app.renderer?.events;
  const ticker = pixiApp?.app.ticker;
  const viewportRef = useRef<Viewport>(null);

  const init = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) {
      const id = setTimeout(init, 100);
      return () => clearTimeout(id);
    }
    vp.drag({ mouseButtons: "left-middle" })
      .pinch()
      .wheel({ percent: 2 })
      .clampZoom({ minScale: 0.25, maxScale: 2.5 });

    const b = treeBounds(SKILL_TREE);
    const treeW = b.maxX - b.minX + 320;
    vp.fitWidth(Math.max(treeW, screenSize.width), true);
    vp.moveCenter((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    useSkillTreeUiStore.getState().setViewport(vp);
  }, [screenSize.width]);

  useEffect(() => {
    const cleanup = init();
    return () => {
      cleanup?.();
      useSkillTreeUiStore.getState().setViewport(null);
      useSkillTreeUiStore.getState().setHovered(null);
    };
  }, [init]);

  if (!ticker || !events) return null;

  return (
    // @ts-expect-error pixi-viewport intrinsic
    <viewport
      label="skill-tree-viewport"
      screenWidth={screenSize.width}
      screenHeight={screenSize.height}
      events={events}
      ticker={ticker}
      ref={viewportRef}
    >
      {children}
      {/* @ts-expect-error pixi-viewport intrinsic */}
    </viewport>
  );
});

const bg = window
  .getComputedStyle(document.body)
  ?.getPropertyValue("--color-primary-900");

export const SkillTreeCanvas = () => {
  const { ref, setRef, size } = useResizeToWrapper();
  // Swallow the browser's ctrl/pinch page-zoom (and scroll) over the canvas so
  // only the Pixi viewport zooms — keeps the overlay header steady.
  useDisableDOMZoom({ wrapperRef: ref });

  return (
    <div ref={setRef} className="absolute inset-0 min-h-0">
      {size && (
        <Application
          resizeTo={ref}
          antialias={true}
          autoDensity={true}
          background={bg || "#10131c"}
          resolution={2}
        >
          <TreeViewport screenSize={size}>
            <TreeScene />
          </TreeViewport>
        </Application>
      )}
    </div>
  );
};
