import { Application, extend, useApplication, useTick } from "@pixi/react";
import {
  Container,
  Graphics,
  Sprite,
  Texture,
  TextureSource,
} from "pixi.js";
import {
  memo,
  type MutableRefObject,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useGeneratorStore } from "../state/generators.store";
import { useOfficeStore } from "../state/office.store";
import { useThemeStore } from "../state/theme.store";
import { loadIsometricAtlasTextures } from "./atlas/load-isometric-atlases";
import { onKitsChanged } from "./city/building-kits";
import { computeCity, type CityScene } from "./city/compute-city";
import { AVENUE_ROWS, generateWorld } from "./city/generate-world";
import {
  avenueTileFor,
  cityRoadSpriteFor,
  roadMaskAt,
  roadSpriteFor,
} from "./city/road-autotile";
import { cellKey } from "./city/types";
import type { SpriteId } from "./map/types";
import { cityDepthKey, mapToWorld } from "./math-utils";
import { useDisableDOMZoom } from "./utils/use-disable-dom-zoom";
import { AppViewport } from "./viewport";

extend({
  Container,
  Graphics,
  Sprite,
});

type OfficeProps = {
  wrapperRef: RefObject<HTMLDivElement | null>;
  wrapperSize: { width: number; height: number };
};

export const Office = ({ wrapperRef, wrapperSize }: OfficeProps) => {
  useDisableDOMZoom({ wrapperRef });

  return (
    <Application
      resizeTo={wrapperRef}
      antialias={true}
      autoDensity={true}
      preference="webgpu"
      resolution={Math.min(window.devicePixelRatio, 2)}
    >
      <AppViewport screenSize={wrapperSize}>
        <World wrapperSize={wrapperSize} />
      </AppViewport>
    </Application>
  );
};

const lightBg = window
  .getComputedStyle(document.body)
  ?.getPropertyValue("--color-primary-100");

const darkBg = window
  .getComputedStyle(document.body)
  ?.getPropertyValue("--color-primary-700");

// city renderer layers
type Textures = Record<string, Texture<TextureSource>>;
type WrapperSize = { width: number; height: number };

// ~1px bleed: tiles drawn a hair larger than their cell so neighbours overlap
// and hide sub-pixel diamond seams at fractional zoom. roundPixels keeps edges crisp.
const TILE_BLEED = 1.02;

// Warm multiplicative tint applied to every sprite of the hovered building so the
// whole stack glows gold. 0xffffff = untinted. Tunable.
const HOVER_TINT = 0xffd97a;

/**
 * City base: dense ground + the full road network, PLUS each building's ground
 * floor. Built imperatively into one sorted Pixi Container so grass, roads and
 * building bases all depth-sort together by `cityDepthKey` — essential because a
 * tile in front of a road must draw over it (separate layers would force roads
 * permanently on top). Grass + roads are static (rebuilt only on textures/size);
 * the building base tiles are reconciled incrementally as you hire.
 *
 * The base tile sits at floor `0.25` — above the grass it replaces, below the
 * roads. Building base tiles are buildings on a plinth wider than their cell, so
 * the plinth spills onto the camera-facing neighbours; keeping it under the road
 * layer means an adjacent road cleanly overdraws the spill instead of the
 * building appearing to sit on the tarmac. Floors above the ground live in
 * {@link BuildingLayer}, drawn over the roads so towers rise over the street.
 */
const GroundRoadLayer = memo(function GroundRoadLayer({
  textures,
  wrapperSize,
  scale,
  scene,
  hoveredKey,
  onHover,
  onUnhover,
}: {
  textures: Textures;
  wrapperSize: WrapperSize;
  scale: number;
  scene: CityScene;
  hoveredKey: string | null;
  onHover: (key: string) => void;
  onUnhover: (key: string) => void;
}) {
  const containerRef = useRef<Container>(null);
  // Ground-level dynamic sprites in the container (building bases + props),
  // keyed so they can be reconciled as the scene changes.
  const baseSpritesRef = useRef<Map<string, Sprite>>(new Map());
  // Hover handlers kept in a ref so the (heavy) reconcile effect can wire them
  // onto new base sprites without depending on their identity.
  const handlersRef = useRef({ onHover, onUnhover });
  handlersRef.current = { onHover, onUnhover };
  // Thin grid road sprites, keyed by cell, so they can be swapped to their
  // pavemented city twin when a building lands next to them (and back again).
  const roadSpritesRef = useRef<
    Map<string, { sprite: Sprite; mask: number; plainId: SpriteId; curId: SpriteId }>
  >(new Map());

  const ox = wrapperSize.width / 2;
  const oy = wrapperSize.height / 4;

  // Static grass + roads. Rebuilt only when textures/size/scale change.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    c.sortableChildren = true;

    const world = generateWorld();
    const place = (
      spriteId: SpriteId,
      mapX: number,
      mapY: number,
      floor: number,
    ): Sprite | null => {
      const tex = textures[spriteId];
      if (!tex) return null;
      const { x, y } = mapToWorld(mapX, mapY, 0, scale);
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      s.x = x + ox;
      s.y = y + oy;
      s.scale.set(scale * TILE_BLEED);
      s.roundPixels = true;
      s.zIndex = cityDepthKey(mapX, mapY, floor);
      c.addChild(s);
      return s;
    };

    for (const t of world.ground) place(t.spriteId, t.mapX, t.mapY, 0);
    for (const key of world.roadCells) {
      const [mx, my] = key.split(",").map(Number);
      const lane = AVENUE_ROWS.indexOf(my);
      if (lane >= 0) {
        // 2-wide thick avenue: pick lane tile, branching where a connector tees
        // in. Avenue cells keep a clear building buffer, so they never pave.
        const outer = lane === 0 ? cellKey(mx, my - 1) : cellKey(mx, my + 1);
        place(avenueTileFor(lane, world.roadCells.has(outer)), mx, my, 0.5);
      } else {
        const mask = roadMaskAt(mx, my, world.roadCells);
        const plainId = roadSpriteFor(mask);
        const s = place(plainId, mx, my, 0.5);
        if (s) roadSpritesRef.current.set(key, { sprite: s, mask, plainId, curId: plainId });
      }
    }
    c.sortChildren();

    return () => {
      c.removeChildren().forEach((child) => child.destroy());
      baseSpritesRef.current.clear(); // base sprites were destroyed too
      roadSpritesRef.current.clear();
    };
  }, [textures, wrapperSize.width, wrapperSize.height, scale, ox, oy]);

  // Reconcile building base tiles into the same sorted container as the scene
  // changes (hiring). Only the small set of bases is touched, not the ~2,800
  // static tiles.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const map = baseSpritesRef.current;

    // Each building's base tile (floor 0) sits in the ground plane at z 0.25 —
    // above the grass it replaces, below the roads — so an adjacent road
    // overdraws its plinth spill. (Ground props are NOT here: they rise off the
    // ground like buildings and would be occluded by the front ground tile, so
    // they render in the upper BuildingLayer instead.)
    type GroundSprite = {
      spriteId: SpriteId;
      mapX: number;
      mapY: number;
      lift: number;
      z: number;
    };
    const wanted = new Map<string, GroundSprite>();
    for (const b of scene.buildings) {
      const base = b.parts.find((p) => p.depth === 1);
      if (base) {
        wanted.set(b.key, {
          spriteId: base.spriteId,
          mapX: b.mapX,
          mapY: b.mapY,
          lift: base.lift,
          z: 0.25,
        });
      }
    }

    for (const [key, s] of map) {
      if (!wanted.has(key)) {
        c.removeChild(s);
        s.destroy();
        map.delete(key);
      }
    }

    for (const [key, g] of wanted) {
      const tex = textures[g.spriteId];
      if (!tex) continue;
      const { x, y } = mapToWorld(g.mapX, g.mapY, 0, scale);
      let s = map.get(key);
      if (!s) {
        s = new Sprite(tex);
        s.anchor.set(0.5, 1);
        s.roundPixels = true;
        // Base tile is part of the building's hover target (so short buildings,
        // whose mass is mostly the ground floor, still highlight + pop a tooltip).
        s.eventMode = "static";
        s.cursor = "pointer";
        s.on("pointerover", () => handlersRef.current.onHover(key));
        s.on("pointerout", () => handlersRef.current.onUnhover(key));
        c.addChild(s);
        map.set(key, s);
      } else {
        s.texture = tex;
      }
      s.x = x + ox;
      s.y = y + oy - g.lift * scale;
      s.scale.set(scale * TILE_BLEED);
      s.zIndex = cityDepthKey(g.mapX, g.mapY, g.z);
    }
    c.sortChildren();

    // Pave roads that now touch a building: swap each adjacent thin road tile to
    // its city twin (and revert when the building's gone). Only changed sprites
    // are re-textured.
    const built = new Set(
      scene.buildings.map((b) => cellKey(b.mapX, b.mapY)),
    );
    for (const [key, r] of roadSpritesRef.current) {
      const [mx, my] = key.split(",").map(Number);
      const touchesBuilding =
        built.has(cellKey(mx + 1, my)) ||
        built.has(cellKey(mx - 1, my)) ||
        built.has(cellKey(mx, my + 1)) ||
        built.has(cellKey(mx, my - 1));
      const twin = touchesBuilding ? cityRoadSpriteFor(r.mask) : null;
      const wantId = twin && textures[twin] ? twin : r.plainId;
      if (wantId !== r.curId) {
        r.sprite.texture = textures[wantId];
        r.curId = wantId;
      }
    }
  }, [scene, textures, scale, ox, oy]);

  // Tint the hovered building's base tile gold (matching its floors in the layer
  // above), so the whole stack — ground floor included — glows on hover.
  useEffect(() => {
    for (const [key, s] of baseSpritesRef.current) {
      s.tint = key === hoveredKey ? HOVER_TINT : 0xffffff;
    }
  }, [hoveredKey, scene]);

  return <pixiContainer ref={containerRef} />;
});

/** Grow-in tween: a new floor fades + scales + rises into place. */
const GROW_IN_MS = 260;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A building floor sprite that plays a short construction "grow-in" (fade +
 * scale-up + rise) when it first appears — but only once `enabledRef` is set,
 * which happens after the initial city paint. So the existing skyline doesn't
 * animate on load; only floors added by hiring (new keys → fresh mounts) do.
 * The tween is driven imperatively so settled sprites cost a cheap early-return.
 */
function GrowInPart({
  texture,
  x,
  y,
  scale,
  zIndex,
  enabledRef,
  tint,
  onPointerOver,
  onPointerOut,
}: {
  texture: Texture<TextureSource>;
  x: number;
  y: number;
  scale: number;
  zIndex: number;
  enabledRef: MutableRefObject<boolean>;
  tint?: number;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
}) {
  const ref = useRef<Sprite>(null);
  // Read the enable flag at mount: parent flips it true only after first paint.
  const progRef = useRef(enabledRef.current ? 0 : 1);

  useLayoutEffect(() => {
    const s = ref.current;
    if (s && progRef.current < 1) {
      // Set the entrance start state before the first frame paints (no flash).
      s.alpha = 0;
      s.scale.set(scale * 0.72);
      s.y = y + 16 * scale;
    }
    // mount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useTick((ticker) => {
    const s = ref.current;
    if (!s || progRef.current >= 1) return;
    const dt = (ticker as { deltaMS?: number })?.deltaMS ?? 16.7;
    progRef.current = Math.min(1, progRef.current + dt / GROW_IN_MS);
    const t = easeOutCubic(progRef.current);
    s.alpha = t;
    s.scale.set(scale * (0.72 + 0.28 * t));
    s.y = y + (1 - t) * 16 * scale;
  });

  return (
    <pixiSprite
      ref={ref}
      texture={texture}
      x={x}
      y={y}
      scale={scale}
      anchor={{ x: 0.5, y: 1 }}
      zIndex={zIndex}
      tint={tint ?? 0xffffff}
      eventMode="static"
      cursor="pointer"
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    />
  );
}

/**
 * Everything that rises off the ground, drawn in a container above the roads so
 * it stands over the street: the floors ABOVE each building's ground tile
 * (mids → roof → rooftop props) and the scattered ground props (trees). The
 * building ground floor itself is rendered into {@link GroundRoadLayer}.
 * Depth-sorted with `cityDepthKey` (column-dominant) so nothing draws over what
 * sits in front of it. New floors play a construction grow-in (props do not).
 */
const BuildingLayer = memo(function BuildingLayer({
  textures,
  wrapperSize,
  scale,
  scene,
  hoveredKey,
  onHover,
  onUnhover,
}: {
  textures: Textures;
  wrapperSize: WrapperSize;
  scale: number;
  scene: CityScene;
  hoveredKey: string | null;
  onHover: (key: string) => void;
  onUnhover: (key: string) => void;
}) {
  const ox = wrapperSize.width / 2;
  const oy = wrapperSize.height / 4;

  // Entrances are suppressed for the first paint (the standing skyline) and
  // enabled afterwards, so only floors added by hiring animate in.
  const entrancesEnabledRef = useRef(false);
  useEffect(() => {
    entrancesEnabledRef.current = true;
  }, []);

  return (
    <>
      {scene.buildings.flatMap((b) => {
        const { x: worldX, y: worldY } = mapToWorld(b.mapX, b.mapY, 0, scale);
        const baseY = worldY + oy;
        const tint = b.key === hoveredKey ? HOVER_TINT : 0xffffff;
        // Ground floor (depth 1) is drawn in the ground layer; here we draw the
        // mids → roof → props that rise above the street.
        return b.parts.flatMap((part, idx) => {
          if (part.depth <= 1) return [];
          const tex = textures[part.spriteId];
          if (!tex) return [];
          return [
            <GrowInPart
              key={`${b.key}_p${idx}`}
              texture={tex}
              x={worldX + ox}
              y={baseY - part.lift * scale}
              scale={scale}
              zIndex={cityDepthKey(b.mapX, b.mapY, part.depth)}
              enabledRef={entrancesEnabledRef}
              tint={tint}
              onPointerOver={() => onHover(b.key)}
              onPointerOut={() => onUnhover(b.key)}
            />,
          ];
        });
      })}
      {scene.props.map((p) => {
        const tex = textures[p.spriteId];
        if (!tex) return null;
        const { x: worldX, y: worldY } = mapToWorld(p.mapX, p.mapY, 0, scale);
        return (
          <pixiSprite
            key={p.key}
            texture={tex}
            x={worldX + ox}
            y={worldY + oy}
            scale={scale}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={cityDepthKey(p.mapX, p.mapY, 1)}
          />
        );
      })}
    </>
  );
});

const World = ({
  wrapperSize,
}: {
  wrapperSize: { width: number; height: number };
}) => {
  const [textures, setTextures] =
    useState<Record<string, Texture<TextureSource>>>();
  const { app } = useApplication();

  const theme = useThemeStore((state) => state.theme);

  // City scene (count-derived). Subscribes only to the three headcounts, so it
  // recomputes when you hire — not every tick.
  const intern = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "intern")?.amount ?? 0,
  );
  const vibeCoder = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "vibe_coder")?.amount ?? 0,
  );
  const dev10x = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "10x_dev")?.amount ?? 0,
  );
  // Bumped when the labeller live-updates the kits (dev only) so the scene
  // recomputes against the freshly authored kits.
  const [kitsVersion, setKitsVersion] = useState(0);
  useEffect(() => onKitsChanged(() => setKitsVersion((v) => v + 1)), []);
  const scene = useMemo(
    () => computeCity({ intern, vibe_coder: vibeCoder, "10x_dev": dev10x }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intern, vibeCoder, dev10x, kitsVersion],
  );

  // The building under the cursor. `hoveredKey` (React state) drives the gold
  // tint on both layers; `hoverKeyRef` is read inside the tick (avoids stale
  // closures) to keep the DOM popover's screen anchor in sync with pan/zoom.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const hoverKeyRef = useRef<string | null>(null);
  // Moving between the many sprites of one building fires pointerout→pointerover
  // in the same frame; a tiny deferred clear (cancelled by the next enter) stops
  // the popover flickering as the cursor crosses internal sprite seams.
  const clearTimerRef = useRef<number | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const wroteHoverRef = useRef(false);

  const onHover = useCallback((key: string) => {
    if (clearTimerRef.current != null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (hoverKeyRef.current !== key) {
      hoverKeyRef.current = key;
      setHoveredKey(key);
    }
  }, []);

  const onUnhover = useCallback((key: string) => {
    if (clearTimerRef.current != null) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      if (hoverKeyRef.current === key) {
        hoverKeyRef.current = null;
        setHoveredKey(null);
      }
    }, 60);
  }, []);

  useEffect(() => {
    if (app && app?.renderer && theme) {
      if (theme === "light") {
        app.renderer.background.color = lightBg;
      }
      if (theme === "dark") {
        app.renderer.background.color = darkBg;
      }
    }
  }, [app, app.renderer, theme]);

  useEffect(() => {
    loadIsometricAtlasTextures().then(setTextures);
  }, []);

  /** Uniform scale for all isometric sprites (tune with `ISO_CELL_STRIDE` in math-utils). */
  const scale = 1;

  // Each frame, project the hovered building's roof to screen space and publish
  // it (with its info) for the DOM popover, so the tooltip rides along as the
  // camera pans/zooms. Reads via refs/getState to dodge stale-closure issues.
  useTick(() => {
    const store = useOfficeStore.getState();
    const key = hoverKeyRef.current;
    const vp = store.viewport;
    if (!key || !vp) {
      if (wroteHoverRef.current) {
        store.setHovered(null);
        wroteHoverRef.current = false;
      }
      return;
    }
    const b = sceneRef.current.buildings.find((x) => x.key === key);
    if (!b) {
      // The hovered building was rebuilt away (e.g. dev kit reload). Drop hover.
      hoverKeyRef.current = null;
      setHoveredKey(null);
      if (wroteHoverRef.current) {
        store.setHovered(null);
        wroteHoverRef.current = false;
      }
      return;
    }
    const ox = wrapperSize.width / 2;
    const oy = wrapperSize.height / 4;
    const { x: worldX, y: worldY } = mapToWorld(b.mapX, b.mapY, 0, scale);
    const topLift = b.parts.reduce((m, p) => Math.max(m, p.lift), 0);
    const screen = vp.toScreen(worldX + ox, worldY + oy - topLift * scale);
    store.setHovered({
      key,
      district: b.district,
      name: b.name,
      floors: b.floors,
      occupants: b.occupants,
      isLandmark: b.isLandmark,
      x: screen.x,
      y: screen.y,
    });
    wroteHoverRef.current = true;
  });

  if (!textures || !wrapperSize) return null;

  return (
    <pixiContainer sortableChildren={true}>
      {/* Grass + roads + building bases sort together here; floors above the
          ground rise over the roads in the layer on top. */}
      <GroundRoadLayer
        textures={textures}
        wrapperSize={wrapperSize}
        scale={scale}
        scene={scene}
        hoveredKey={hoveredKey}
        onHover={onHover}
        onUnhover={onUnhover}
      />
      <pixiContainer sortableChildren={true} zIndex={1}>
        <BuildingLayer
          textures={textures}
          wrapperSize={wrapperSize}
          scale={scale}
          scene={scene}
          hoveredKey={hoveredKey}
          onHover={onHover}
          onUnhover={onUnhover}
        />
      </pixiContainer>
    </pixiContainer>
  );
};
