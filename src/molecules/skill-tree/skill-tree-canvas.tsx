import { Application, extend, useApplication, useTick } from "@pixi/react";
import { Viewport } from "pixi-viewport";
import { Circle, Container, Graphics, Sprite, Texture } from "pixi.js";
import { memo, useCallback, useEffect, useRef } from "react";
import {
  buildAdjacency,
  frontierPath,
  isReachable,
  nodeById,
  nodeCost,
  nodesToRemove,
  type SkillNode,
  SKILL_TREE,
  treeBounds,
} from "../../game/skill-tree";
import { usePrestigeStore } from "../../state/prestige.store";
import { useSkillTreeUiStore } from "../../state/skill-tree-ui.store";
import { useThemeStore } from "../../state/theme.store";
import { useResizeToWrapper } from "../../hooks/use-resize-to-wrapper";
import { useDisableDOMZoom } from "../../office/utils/use-disable-dom-zoom";

extend({ Container, Graphics, Sprite, Viewport });

const ADJ = buildAdjacency(SKILL_TREE);
const NODES = nodeById(SKILL_TREE);

// State colours (applied as a TINT on a white ring — cheap, no redraw).
// Allocated nodes/links use a neutral grey that flips with the app theme: light
// grey reads on the dark theme, a darker grey on the light theme.
const C_ALLOC_DARK = 0xd7dbe6; // light grey — on the dark theme
const C_ALLOC_LIGHT = 0x5b6373; // mid grey — on the light theme
const C_AVAILABLE = 0x6ee7b7; // green — reachable + affordable
const C_HOVER = 0xeafff4; // bright mint — hovering an allocatable node
const C_REACHABLE = 0xe0a23a; // amber — reachable but can't afford
const C_LOCKED = 0x47506a; // dim — unallocated ring on the dark theme
const C_LOCKED_LIGHT = 0xccd0d8; // faint grey — unallocated ring on the light theme
const C_RESPEC = 0xfb7185; // rose — refundable in respec mode
const C_RESPEC_HOT = 0xffc2cb; // bright rose — in the refund set under the cursor
const C_EDGE_RESPEC = 0xfb7185; // rose — edge inside the previewed refund set
const C_INNER = 0x161b29; // dark disc behind the icon (fallback / path nodes)
const C_INNER_LIGHT = 0xe7e9ec; // light disc (light theme fallback)
const C_HOVER_LIGHT = 0x0f9d6b; // emerald — hovered allocatable node on the light theme
const C_ON_PATH = 0x2563eb; // blue — node lies on the previewed route to the hovered node
const C_EDGE_PREVIEW = 0x2563eb; // blue — edge on the previewed route
const C_EDGE_DIM = 0x3a4258; // dark theme idle edge
const C_EDGE_DIM_LIGHT = 0xd2d6dd; // light theme idle edge (faint)

// Per-theme disc fills so the 11 clusters read as distinct regions. State
// (allocated / available / locked) stays on the ring; identity lives on the disc.
// Faint-dark tints on the dark theme, faint-pale tints on the light theme.
const CLUSTER_FILL_DARK: Record<string, number> = {
  growth: 0x16251c,
  vc: 0x2a2410,
  movefast: 0x2c1717,
  lean: 0x12262a,
  crunch: 0x2c1f10,
  aihype: 0x231630,
  empire: 0x141d2e,
  opensource: 0x123028,
  exit: 0x2a1620,
  founder: 0x2b2610,
  enshit: 0x1f2810,
};
const CLUSTER_FILL_LIGHT: Record<string, number> = {
  growth: 0xd8efdf,
  vc: 0xeee7cf,
  movefast: 0xf2dada,
  lean: 0xd6ecf0,
  crunch: 0xf1e6cf,
  aihype: 0xe7daf2,
  empire: 0xd9e2f2,
  opensource: 0xd3efe7,
  exit: 0xf2dae3,
  founder: 0xf1ebcf,
  enshit: 0xe4eed2,
};
const discTint = (cluster: string, theme: "light" | "dark") =>
  theme === "dark"
    ? (CLUSTER_FILL_DARK[cluster] ?? C_INNER)
    : (CLUSTER_FILL_LIGHT[cluster] ?? C_INNER_LIGHT);

/**
 * Initial camera, applied once when the viewport mounts (see TreeViewport). Tune
 * these to change where/how zoomed-in the tree opens — no flicker, since it's set
 * before the first frame paints.
 */
const TREE_CAMERA = {
  fitPaddingPx: 360, // extra world padding around the tree when fitting to width
  initialScale: null as number | null, // null = fit whole tree; e.g. 0.6 opens closer
  center: null as { x: number; y: number } | null, // null = tree centre (≈ the core)
  minScale: 0.12,
  maxScale: 2.5,
};

const radiusFor = (n: SkillNode) =>
  n.kind === "keystone" ? 48 : n.kind === "notable" ? 24 : n.kind === "root" ? 20 : 15;

// Icon textures cached by url (icon pack lands later; nodes are bare discs now).
const iconCache = new Map<string, Texture>();
const iconTexture = (url: string): Texture => {
  let tex = iconCache.get(url);
  if (!tex) {
    tex = Texture.from(url);
    iconCache.set(url, tex);
  }
  return tex;
};

type NodeView = { ring: Graphics; glow: Graphics; disc: Graphics };

/**
 * Imperative scene: every node/edge graphic is built ONCE into a Pixi container,
 * then state changes (allocation, hover, respec) are applied as cheap tint /
 * visibility mutations — no React reconciliation or per-node redraws, which
 * keeps 400+ nodes smooth. Hover is published to the UI store for the DOM tooltip.
 */
const TreeScene = memo(function TreeScene() {
  const containerRef = useRef<Container>(null);
  const nodeViews = useRef<Map<string, NodeView>>(new Map());
  const edgeViews = useRef<Graphics[]>([]);
  const pixiApp = useApplication();

  // State that drives reconciliation (component re-renders on these; the effect
  // below mutates Pixi objects rather than rebuilding anything).
  const allocated = usePrestigeStore((s) => s.allocated);
  const equity = usePrestigeStore((s) => s.equity);
  const respecMode = useSkillTreeUiStore((s) => s.respecMode);
  const hoveredId = useSkillTreeUiStore((s) => s.hovered?.id ?? null);
  const theme = useThemeStore((s) => s.theme);

  // Repaint the backdrop when the theme toggles while the tree is open.
  useEffect(() => {
    const renderer = pixiApp?.app?.renderer;
    if (renderer) renderer.background.color = theme === "dark" ? 0x1b1f23 : 0xf4f5f6;
  }, [pixiApp, theme]);

  // Hover tracking → publishes the hovered node + screen anchor each frame.
  const hoverIdRef = useRef<string | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const wroteRef = useRef(false);
  const onHover = useCallback((id: string) => {
    if (clearTimerRef.current != null) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
    hoverIdRef.current = id;
  }, []);
  const onUnhover = useCallback((id: string) => {
    if (clearTimerRef.current != null) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      if (hoverIdRef.current === id) hoverIdRef.current = null;
    }, 60);
  }, []);

  // BUILD ONCE.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.sortableChildren = true;

    // Edges first (drawn white, tinted in reconcile), trimmed rim-to-rim.
    for (const [a, b] of SKILL_TREE.edges) {
      const na = NODES.get(a)!;
      const nb = NODES.get(b)!;
      const dx = nb.x - na.x;
      const dy = nb.y - na.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const ra = radiusFor(na);
      const rb = radiusFor(nb);
      const g = new Graphics();
      g.zIndex = 0;
      g.moveTo(na.x + ux * ra, na.y + uy * ra);
      g.lineTo(nb.x - ux * rb, nb.y - uy * rb);
      g.stroke({ width: 3, color: 0xffffff });
      root.addChild(g);
      edgeViews.current.push(g);
    }

    for (const node of SKILL_TREE.nodes) {
      const r = radiusFor(node);
      const cont = new Container();
      cont.x = node.x;
      cont.y = node.y;
      cont.zIndex = 1;

      const glow = new Graphics();
      glow.circle(0, 0, r + 7).fill(0xffffff);
      glow.tint = C_AVAILABLE;
      glow.alpha = 0.3;
      glow.visible = false;
      glow.zIndex = 0;

      // Filled white; the per-theme cluster tint is applied in reconcile.
      const disc = new Graphics();
      disc.circle(0, 0, r).fill(0xffffff);
      disc.zIndex = 1;

      const ring = new Graphics();
      ring.circle(0, 0, r).stroke({ width: node.kind === "keystone" ? 4 : 3, color: 0xffffff });
      ring.zIndex = 3;

      cont.addChild(glow, disc, ring);

      if (node.icon) {
        const sp = new Sprite(iconTexture(node.icon));
        sp.anchor.set(0.5);
        sp.width = r * 1.5;
        sp.height = r * 1.5;
        sp.eventMode = "none";
        sp.zIndex = 2;
        cont.addChild(sp);
      }

      cont.eventMode = "static";
      cont.cursor = "pointer";
      cont.hitArea = new Circle(0, 0, r);
      cont.on("pointertap", () => {
        const store = usePrestigeStore.getState();
        if (useSkillTreeUiStore.getState().respecMode) store.respecPath(node.id);
        else store.allocatePath(node.id);
      });
      cont.on("pointerover", () => onHover(node.id));
      cont.on("pointerout", () => onUnhover(node.id));

      root.addChild(cont);
      nodeViews.current.set(node.id, { ring, glow, disc });
    }

    return () => {
      root.removeChildren().forEach((ch) => ch.destroy({ children: true }));
      nodeViews.current.clear();
      edgeViews.current = [];
    };
  }, [onHover, onUnhover]);

  // RECONCILE styles whenever allocation / affordability / hover / respec change.
  useEffect(() => {
    const allocatedSet = new Set(allocated);
    const affordable = equity.gte(nodeCost(allocated.length));
    const hoverNode = hoveredId ? NODES.get(hoveredId) : undefined;
    const cAlloc = theme === "dark" ? C_ALLOC_DARK : C_ALLOC_LIGHT;
    const cHover = theme === "dark" ? C_HOVER : C_HOVER_LIGHT;
    const cLocked = theme === "dark" ? C_LOCKED : C_LOCKED_LIGHT;
    const cEdgeDim = theme === "dark" ? C_EDGE_DIM : C_EDGE_DIM_LIGHT;

    // Cheapest route to reach the hovered node — drives the blue "what you'd buy
    // to get here" highlight (route nodes + edges) and the tooltip's total cost.
    const ekey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);
    const pathNodes = new Set<string>();
    const pathEdges = new Set<string>(); // allocate-mode route edges
    let path: string[] = [];
    let respecPreview = false;
    if (!respecMode && hoverNode && !allocatedSet.has(hoverNode.id)) {
      path = frontierPath(SKILL_TREE, allocatedSet, hoverNode.id, ADJ);
      for (let i = 0; i < path.length; i++) {
        pathNodes.add(path[i]);
        if (i > 0) pathEdges.add(ekey(path[i - 1], path[i]));
      }
      // edge linking the allocated frontier to the first new node
      if (path.length) {
        for (const nb of ADJ.get(path[0]) ?? []) {
          if (allocatedSet.has(nb)) {
            pathEdges.add(ekey(path[0], nb));
            break;
          }
        }
      }
    } else if (respecMode && hoverNode && allocatedSet.has(hoverNode.id)) {
      // the subtree a refund would remove (rose), edges drawn in the edge loop
      path = nodesToRemove(SKILL_TREE, allocatedSet, hoverNode.id, ADJ);
      for (const id of path) pathNodes.add(id);
      respecPreview = true;
    }
    const cur = useSkillTreeUiStore.getState().previewPath;
    if (cur.length !== path.length || cur.some((v, i) => v !== path[i])) {
      useSkillTreeUiStore.getState().setPreviewPath(path);
    }

    for (const node of SKILL_TREE.nodes) {
      const view = nodeViews.current.get(node.id);
      if (!view) continue;
      const isAlloc = allocatedSet.has(node.id);
      const reachable = isReachable(SKILL_TREE, allocatedSet, node.id, ADJ);
      const available = !isAlloc && reachable && affordable;
      const hot = available && node.id === hoveredId;
      const inRefund = respecPreview && pathNodes.has(node.id);
      // route nodes (including the hovered target) glow blue; a directly
      // affordable hover still wins the mint `hot` highlight (checked first).
      const onPath = !respecMode && pathNodes.has(node.id);
      view.disc.tint = discTint(node.cluster, theme);
      view.ring.tint =
        respecMode && isAlloc
          ? inRefund
            ? C_RESPEC_HOT
            : C_RESPEC
          : isAlloc
            ? cAlloc
            : hot
              ? cHover
              : onPath
                ? C_ON_PATH
                : available
                  ? C_AVAILABLE
                  : reachable
                    ? C_REACHABLE
                    : cLocked;
      view.glow.visible = hot;
    }

    SKILL_TREE.edges.forEach(([a, b], i) => {
      const g = edgeViews.current[i];
      if (!g) return;
      const removalEdge = respecPreview && pathNodes.has(a) && pathNodes.has(b);
      const lit = allocatedSet.has(a) && allocatedSet.has(b);
      const allocPreview = !respecMode && pathEdges.has(ekey(a, b));
      if (removalEdge) {
        g.tint = C_EDGE_RESPEC;
        g.alpha = 0.95;
      } else if (lit) {
        g.tint = cAlloc;
        g.alpha = 0.9;
      } else if (allocPreview) {
        g.tint = C_EDGE_PREVIEW;
        g.alpha = 0.85;
      } else {
        g.tint = cEdgeDim;
        g.alpha = theme === "dark" ? 0.55 : 0.55;
      }
    });
  }, [allocated, equity, respecMode, hoveredId, theme]);

  // Project the hovered node to screen space each frame for the DOM tooltip.
  useTick(() => {
    const store = useSkillTreeUiStore.getState();
    const id = hoverIdRef.current;
    const vp = store.viewport;
    if (!id || !vp) {
      if (wroteRef.current) {
        store.setHovered(null);
        if (store.previewPath.length) store.setPreviewPath([]);
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

  return <pixiContainer ref={containerRef} />;
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

  // Latest screen size, read inside the (stable) attach callback.
  const sizeRef = useRef(screenSize);
  sizeRef.current = screenSize;
  const didInit = useRef(false);

  // Callback ref: fires the instant the Viewport instance exists, during commit
  // and before the first frame paints — so we set the camera transform up front
  // and never show the default (zoomed-in) frame, which was the flicker.
  const attachViewport = useCallback((vp: Viewport | null) => {
    if (!vp) {
      didInit.current = false;
      useSkillTreeUiStore.getState().setViewport(null);
      useSkillTreeUiStore.getState().setHovered(null);
      return;
    }
    if (didInit.current) return;
    didInit.current = true;

    vp.drag({ mouseButtons: "left-middle" })
      .pinch()
      .wheel({ percent: 2 })
      .clampZoom({ minScale: TREE_CAMERA.minScale, maxScale: TREE_CAMERA.maxScale });

    const { width } = sizeRef.current;
    const b = treeBounds(SKILL_TREE);
    const cx = TREE_CAMERA.center?.x ?? (b.minX + b.maxX) / 2;
    const cy = TREE_CAMERA.center?.y ?? (b.minY + b.maxY) / 2;
    const treeW = b.maxX - b.minX + TREE_CAMERA.fitPaddingPx;
    const fitScale = width / Math.max(treeW, width); // ≤ 1 — fit the whole tree
    vp.setZoom(TREE_CAMERA.initialScale ?? fitScale, true);
    vp.moveCenter(cx, cy);
    useSkillTreeUiStore.getState().setViewport(vp);
  }, []);

  if (!ticker || !events) return null;

  return (
    // @ts-expect-error pixi-viewport intrinsic
    <viewport
      label="skill-tree-viewport"
      screenWidth={screenSize.width}
      screenHeight={screenSize.height}
      events={events}
      ticker={ticker}
      ref={attachViewport}
    >
      {children}
      {/* @ts-expect-error pixi-viewport intrinsic */}
    </viewport>
  );
});

// Canvas backdrop — flips with the app theme (primary-900 dark / primary-50 light).
const BG_DARK = "#1b1f23";
const BG_LIGHT = "#f4f5f6";

export const SkillTreeCanvas = () => {
  const { ref, setRef, size } = useResizeToWrapper();
  useDisableDOMZoom({ wrapperRef: ref });
  const theme = useThemeStore((s) => s.theme);

  return (
    <div ref={setRef} className="absolute inset-0 min-h-0">
      {size && (
        <Application
          resizeTo={ref}
          antialias={true}
          autoDensity={true}
          background={theme === "dark" ? BG_DARK : BG_LIGHT}
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
