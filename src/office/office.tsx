import { Application, extend, useApplication, useTick } from "@pixi/react";
import {
  Container,
  Graphics,
  Sprite,
  Text,
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
import { useAnyPopoverStore } from "../state/modifier-popover.store";
import { useOfficeStore } from "../state/office.store";
import { useSlopPitStore, SLOP_PIT_UNLOCK_COUNT } from "../state/slop-pit.store";
import { useThemeStore } from "../state/theme.store";
import { loadIsometricAtlasTextures } from "../iso/atlas/load-isometric-atlases";
import { onKitsChanged } from "./city/building-kits";
import { computeCity, type CityScene } from "./city/compute-city";
import { AVENUE_ROWS, generateWorld, SLOP_PIT_CENTER, SLOP_PIT_BLOCK } from "./city/generate-world";
import {
  avenueTileFor,
  cityRoadSpriteFor,
  roadMaskAt,
  roadSpriteFor,
} from "./city/road-autotile";
import { cellKey } from "./city/types";
import type { SpriteId } from "./map/types";
import { cityDepthKey, ISO_CELL_STRIDE, mapToWorld } from "./math-utils";
import { sweH, sweReset, sweSplash, sweApplyModalForcing, sweStep, sweNormalizeMean, SIM_N, SIM_N1, SWE_MAX_AMP, PIT_DEPTH_HH } from "./slop-pit-fluid";
import { useDisableDOMZoom } from "../utils/use-disable-dom-zoom";
import { AppViewport } from "./viewport";

extend({
  Container,
  Graphics,
  Sprite,
  Text,
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
  // Sludge/pit graphics: floor, walls, and the fluid mesh — all in this container
  // so they depth-sort against grass and roads via cityDepthKey.
  const sludgeGraphicsRef = useRef<Container[]>([]);
  // Single Graphics object redrawn each frame as the fluid mesh.
  const meshGRef = useRef<Graphics | null>(null);
  // Pre-computed base vertex screen positions (excluding sludge offset + wave).
  // Rebuilt in the pit useEffect whenever ox/oy/scale changes.
  const meshBaseVxRef = useRef(new Float32Array(0));
  const meshBaseVyRef = useRef(new Float32Array(0));
  const pitPrevFillRef = useRef(0);
  // 8 pre-shaded variants of the current tier base color — recomputed when tier
  // changes so we never allocate inside the per-frame hot path.
  const pitTierRef    = useRef(-1);
  const pitShadesRef  = useRef(new Int32Array(32));
  const sloshTimeRef  = useRef(0);
  const pitScaleRef = useRef(scale);
  pitScaleRef.current = scale;
  const slopVibeCoderCount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "vibe_coder")?.amount ?? 0,
  );
  const pitUnlockedRef = useRef(false);
  pitUnlockedRef.current = slopVibeCoderCount >= SLOP_PIT_UNLOCK_COUNT;

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
      sludgeGraphicsRef.current = []; // destroyed with removeChildren above
      meshGRef.current = null;
    };
  }, [textures, wrapperSize.width, wrapperSize.height, scale, ox, oy]);

  // Pit rendering: floor, camera-facing walls, and fluid mesh (single Graphics).
  // Surface position is driven per-frame by useTick via meshGRef.
  // textures dep ensures re-run when the static tiles effect rebuilt the container.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;

    // Destroy any existing pit graphics (floor, walls, mesh) before rebuilding.
    if (meshGRef.current) { meshGRef.current = null; }
    for (const g of sludgeGraphicsRef.current) {
      if (g.parent) { g.parent.removeChild(g); g.destroy({ children: true }); }
    }
    sludgeGraphicsRef.current = [];

    if (!pitUnlockedRef.current) { c.sortChildren(); return; }

    const HW = ISO_CELL_STRIDE * scale / 2;
    const HH = ISO_CELL_STRIDE * scale / 4;
    const DEPTH = HH * PIT_DEPTH_HH;

    // Pit floor — very dark base at the bottom
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const mapX = SLOP_PIT_MAP_X + dx;
        const mapY = SLOP_PIT_MAP_Y + dy;
        const { x: wx, y: wy } = mapToWorld(mapX, mapY, 0, scale);
        const g = new Graphics();
        g.moveTo(0, -HH); g.lineTo(HW, 0); g.lineTo(0, HH); g.lineTo(-HW, 0); g.closePath();
        g.fill({ color: 0x0a0b0d, alpha: 1 });
        g.x = wx + ox;
        g.y = wy + oy - HH + DEPTH;
        g.zIndex = cityDepthKey(mapX, mapY, 0.55);
        c.addChild(g);
        sludgeGraphicsRef.current.push(g);
      }
    }

    const dirtTex = textures['landscapeTiles_083.png'];

    // Place dirt wall tiles at the terrain positions JUST OUTSIDE the pit.
    // The existing terrain tile at that position is d=0 (ground level cover).
    // d=1..PIT_DEPTH_HH are placed at y + d*HH, each one's top 66px covered
    // by the tile above it — exposing only the 33px bottom skirt as the wall face.
    // zIndex must be below the terrain tile (0.25) so terrain stays on top.
    const placeDirtColumn = (mapX: number, mapY: number, tint: number) => {
      const { x: wx, y: wy } = mapToWorld(mapX, mapY, 0, scale);
      for (let d = 1; d <= PIT_DEPTH_HH + 1; d++) {
        const s = new Sprite(dirtTex);
        s.anchor.set(0.5, 1);
        s.scale.set(TILE_BLEED);
        s.tint = tint;
        s.x = wx + ox;
        s.y = wy + oy + d * HH;
        // d=1 closest to surface, all below terrain floor 0 so grass draws on top
        s.zIndex = cityDepthKey(mapX, mapY, -d * 0.04);
        c.addChild(s);
        sludgeGraphicsRef.current.push(s);
      }
    };

    // SE wall (lit) — terrain row just outside right pit edge (mapX = SLOP_PIT_MAP_X + 3)
    for (let dy = -2; dy <= 2; dy++) placeDirtColumn(SLOP_PIT_MAP_X + 3, SLOP_PIT_MAP_Y + dy, 0xccb89a);

    // SW wall (shadow) — terrain row just outside bottom pit edge (mapY = SLOP_PIT_MAP_Y + 3)
    for (let dx = -2; dx <= 2; dx++) placeDirtColumn(SLOP_PIT_MAP_X + dx, SLOP_PIT_MAP_Y + 3, 0x88795e);

    // NE wall (lit) — terrain row just outside top pit edge (mapY = SLOP_PIT_MAP_Y - 3)
    for (let dx = -2; dx <= 2; dx++) placeDirtColumn(SLOP_PIT_MAP_X + dx, SLOP_PIT_MAP_Y - 3, 0xccb89a);

    // NW wall (shadow) — terrain row just outside left pit edge (mapX = SLOP_PIT_MAP_X - 3)
    for (let dy = -2; dy <= 2; dy++) placeDirtColumn(SLOP_PIT_MAP_X - 3, SLOP_PIT_MAP_Y + dy, 0x88795e);

    // Fluid surface — single Graphics mesh redrawn every frame by useTick.
    // Position (0,0): vertex coords are absolute (ox/oy baked into base arrays).
    const meshG = new Graphics();
    meshG.zIndex = cityDepthKey(SLOP_PIT_MAP_X, SLOP_PIT_MAP_Y, 0.6);
    c.addChild(meshG);
    sludgeGraphicsRef.current.push(meshG);
    meshGRef.current = meshG;

    // Precompute base vertex screen positions for the (SIM_N+1)² grid.
    // These are constant until ox/oy/scale changes (i.e. this effect re-runs).
    // Pit covers mapX ∈ [14,18], mapY ∈ [21,25] (4 iso-cell span each side).
    const PIT_X0   = SLOP_PIT_BLOCK.x0 - 0.5; // 13.5 — half-tile before left edge
    const PIT_Y0   = SLOP_PIT_BLOCK.y0 - 0.5; // 20.5
    const PIT_SPAN = SLOP_PIT_BLOCK.x1 - SLOP_PIT_BLOCK.x0 + 1; // 5 — full tile extent
    const bvx = new Float32Array(SIM_N1 * SIM_N1);
    const bvy = new Float32Array(SIM_N1 * SIM_N1);
    for (let gi = 0; gi <= SIM_N; gi++) {
      for (let gj = 0; gj <= SIM_N; gj++) {
        const mfx = PIT_X0 + (gi / SIM_N) * PIT_SPAN;
        const mfy = PIT_Y0 + (gj / SIM_N) * PIT_SPAN;
        bvx[gi * SIM_N1 + gj] = (mfx - mfy) * HW + ox;
        // Diamond centre Y (not bottom): wy - HH = (mfx+mfy)*HH - HH
        bvy[gi * SIM_N1 + gj] = (mfx + mfy) * HH - HH + oy;
      }
    }
    meshBaseVxRef.current = bvx;
    meshBaseVyRef.current = bvy;

    c.sortChildren();
  }, [slopVibeCoderCount, ox, oy, scale, textures]);

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

  // SWE fluid simulation + mesh redraw — runs every frame when pit is active.
  // Reads fill directly from store (no React subscription) to avoid re-renders.
  useTick((ticker) => {
    const mg = meshGRef.current;
    if (!pitUnlockedRef.current || !mg) return;

    const dt   = ((ticker as unknown as { deltaMS?: number }).deltaMS ?? 16.7) / 1000;
    const fill = useSlopPitStore.getState().fill;
    const pct  = fill / 100;

    if (fill <= 0 && pitPrevFillRef.current > 0) sweReset();
    pitPrevFillRef.current = fill;

    // Smooth modal forcing: energy is spread across all cells via the basin's
    // natural mode shapes (zero at walls, smooth humps inside).  Can only
    // excite long-wavelength sloshing — structurally incapable of creating peaks.
    if (fill > 0) {
      sloshTimeRef.current += dt;
      sweApplyModalForcing(0.0065 * pct, sloshTimeRef.current);
    }

    sweStep(dt);
    sweNormalizeMean(); // prevent brightness drift from net-negative drip impulses

    const sc    = pitScaleRef.current;
    const HH    = ISO_CELL_STRIDE * sc / 4;
    const DEPTH = HH * PIT_DEPTH_HH;
    const sludgeOffset = HH * (PIT_DEPTH_HH - 1) * (1 - pct);

    const SURF_FC = [0x12261a, 0x1e3a1e, 0x92400e, 0x7c2d12] as const;
    const tier = pct > 0.8 ? 3 : pct > 0.5 ? 2 : pct > 0.25 ? 1 : 0;
    const fc   = SURF_FC[tier];

    // Rebuild the 8 shaded variants whenever the tier (and thus base color) changes.
    // 8 levels span brightness 0.30× (deep trough) → 1.60× (crest highlight).
    // Quantizing to 8 levels bounds Pixi batch-breaks to ≤8 per draw list.
    if (tier !== pitTierRef.current) {
      pitTierRef.current = tier;
      const r0 = (fc >> 16) & 0xff;
      const g0 = (fc >> 8)  & 0xff;
      const b0 =  fc        & 0xff;
      const shades = pitShadesRef.current;
      for (let s = 0; s < 32; s++) {
        const bright = 0.30 + s * (1.30 / 31); // 0.30 → 1.60
        shades[s] =
          (Math.min(255, (r0 * bright) | 0) << 16) |
          (Math.min(255, (g0 * bright) | 0) <<  8) |
           Math.min(255, (b0 * bright) | 0);
      }
    }
    const shades = pitShadesRef.current;

    const bvx = meshBaseVxRef.current;
    const bvy = meshBaseVyRef.current;

    mg.clear();

    // Normal-based diffuse shading per quad:
    // Surface gradient (dhi, dhj) approximates the slope in i and j directions.
    // Light from upper-left in iso view → brightness ∝ dhi − dhj:
    //   slope facing upper-left = bright crest; facing lower-right = dark trough.
    // Quantised to 8 shades so consecutive same-shade quads batch in one draw call.
    for (let gi = 0; gi < SIM_N; gi++) {
      for (let gj = 0; gj < SIM_N; gj++) {
        const i00 = gi       * SIM_N1 +  gj;
        const i10 = (gi + 1) * SIM_N1 +  gj;
        const i11 = (gi + 1) * SIM_N1 + (gj + 1);
        const i01 = gi       * SIM_N1 + (gj + 1);

        const h00 = sweH[i00], h10 = sweH[i10], h11 = sweH[i11], h01 = sweH[i01];

        // Vertex Y = bvy + sludgeOffset + h*sc: positive h pushes DOWN (deeper = trough),
        // negative h pushes UP (shallower = crest).  Crests catch more light → brighter,
        // so brightness is INVERSELY proportional to h.
        const h_avg      = (h00 + h10 + h11 + h01) * 0.25;
        const brightness = Math.max(0, Math.min(1, 0.5 - h_avg / (SWE_MAX_AMP * 0.5)));
        const shadeIdx   = Math.round(brightness * 31);

        mg.poly([
          bvx[i00], bvy[i00] + sludgeOffset + h00 * sc,
          bvx[i10], bvy[i10] + sludgeOffset + h10 * sc,
          bvx[i11], bvy[i11] + sludgeOffset + h11 * sc,
          bvx[i01], bvy[i01] + sludgeOffset + h01 * sc,
        ]);
        mg.fill({ color: shades[shadeIdx], alpha: 0.93 });
      }
    }

  });

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
  const [animDone, setAnimDone] = useState(progRef.current >= 1);

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

  useTick({
    isEnabled: !animDone,
    callback: (ticker) => {
      const s = ref.current;
      if (!s || progRef.current >= 1) return;
      const dt = (ticker as { deltaMS?: number })?.deltaMS ?? 16.7;
      progRef.current = Math.min(1, progRef.current + dt / GROW_IN_MS);
      const t = easeOutCubic(progRef.current);
      s.alpha = t;
      s.scale.set(scale * (0.72 + 0.28 * t));
      s.y = y + (1 - t) * 16 * scale;
      if (progRef.current >= 1) setAnimDone(true);
    },
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
    if (useAnyPopoverStore.getState().openCount > 0) return;
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

  // Clear the map hover whenever any modifier popover opens so the building
  // tooltip doesn't stay stuck behind the modifier popover.
  useEffect(() => {
    return useAnyPopoverStore.subscribe((state) => {
      if (state.openCount > 0) {
        if (clearTimerRef.current != null) {
          clearTimeout(clearTimerRef.current);
          clearTimerRef.current = null;
        }
        hoverKeyRef.current = null;
        setHoveredKey(null);
      }
    });
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
        <SlopPitLayer wrapperSize={wrapperSize} scale={scale} />
      </pixiContainer>
    </pixiContainer>
  );
};

const SLOP_PIT_MAP_X = SLOP_PIT_CENTER.x;
const SLOP_PIT_MAP_Y = SLOP_PIT_CENTER.y;
void SLOP_PIT_BLOCK;

// ── Slop Pit FX helpers (must be defined before SlopPitLayer uses SlopPitFX) ──

const PIPE_EMIT_RATE = 0.7; // drips / second at 100% fill

// groundY: tap's ground-level Y in local FX space (used to compute dynamic target)
// splashed: whether the drip has already triggered a fluid impulse on landing
type SlopDrip = {
  x: number; y: number; vy: number; alpha: number; r: number; groundY: number; splashed: boolean;
  phase: 'forming' | 'falling';
  sx: number; sy: number; maxR: number; formT: number; formDur: number;
};
type SlopBubble = { x: number; y: number; r: number; maxR: number; decay: number };
type SlopRing   = { x: number; y: number; r: number; maxR: number; alpha: number };

// drawIsoPipe: isometric cylinder pipe protruding from the inside face of the top-right pit wall.
// Uses computed perpendicular vectors for proper isometric cylinder shading and polygon end caps.
function drawIsoPipe(g: Graphics, ax: number, ay: number, ex: number, ey: number, HW: number, _HH: number) {
  const r = Math.max(4, HW * 0.10);
  const ddx = ex - ax, ddy = ey - ay;
  const dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
  // Unit vector along pipe axis
  const ux = ddx / dlen, uy = ddy / dlen;
  // Perpendicular: 90° CW = shadow/lower side in iso view
  const px = uy, py = -ux;

  // Helper: polygon for an iso-foreshortened ellipse (end cap)
  // major axis r along (px,py), minor axis r*0.42 along (ux,uy)
  function endCapPoly(cx: number, cy: number, pts = 14) {
    const poly: number[] = [];
    for (let i = 0; i < pts; i++) {
      const t = (i / pts) * Math.PI * 2;
      poly.push(cx + px * r * Math.cos(t) + ux * r * 0.42 * Math.sin(t));
      poly.push(cy + py * r * Math.cos(t) + uy * r * 0.42 * Math.sin(t));
    }
    return poly;
  }

  // ── Wall attachment end cap (drawn first so pipe body occludes it) ──────────
  const attachPoly = endCapPoly(ax, ay);
  g.poly(attachPoly);
  g.fill({ color: 0x1e2d3c });
  const boreR = r * 0.38;
  const borePoly: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2;
    borePoly.push(ax + px * boreR * Math.cos(t) + ux * boreR * 0.42 * Math.sin(t));
    borePoly.push(ay + py * boreR * Math.cos(t) + uy * boreR * 0.42 * Math.sin(t));
  }
  g.poly(borePoly);
  g.fill({ color: 0x374556 });

  // ── Pipe body: 3-strip shading (shadow bottom → main face → highlight top) ─
  // Shadow strip: far side of cylinder
  g.moveTo(ax + px * r * 0.50, ay + py * r * 0.50);
  g.lineTo(ex + px * r * 0.50, ey + py * r * 0.50);
  g.lineTo(ex + px * r,        ey + py * r);
  g.lineTo(ax + px * r,        ay + py * r);
  g.closePath();
  g.fill({ color: 0x1a2a38 });

  // Main face: center of cylinder
  g.moveTo(ax - px * r * 0.70, ay - py * r * 0.70);
  g.lineTo(ex - px * r * 0.70, ey - py * r * 0.70);
  g.lineTo(ex + px * r * 0.50, ey + py * r * 0.50);
  g.lineTo(ax + px * r * 0.50, ay + py * r * 0.50);
  g.closePath();
  g.fill({ color: 0x2c3e50 });

  // Highlight strip: near side of cylinder (toward camera)
  g.moveTo(ax - px * r,        ay - py * r);
  g.lineTo(ex - px * r,        ey - py * r);
  g.lineTo(ex - px * r * 0.70, ey - py * r * 0.70);
  g.lineTo(ax - px * r * 0.70, ay - py * r * 0.70);
  g.closePath();
  g.fill({ color: 0x4a6070 });

  // ── Open spout end cap (drips fall from here) ─────────────────────────────
  // Shadow rim slightly offset toward shadow side
  const rimPoly = endCapPoly(ex + px * 0.12 * r, ey + py * 0.12 * r);
  g.poly(rimPoly);
  g.fill({ color: 0x182530 });
  const spoutPoly = endCapPoly(ex, ey);
  g.poly(spoutPoly);
  g.fill({ color: 0x2c3e50 });
  // Dark bore hole
  const boreSpoutPoly: number[] = [];
  const br = r * 0.50;
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2;
    boreSpoutPoly.push(ex + px * br * Math.cos(t) + ux * br * 0.42 * Math.sin(t));
    boreSpoutPoly.push(ey + py * br * Math.cos(t) + uy * br * 0.42 * Math.sin(t));
  }
  g.poly(boreSpoutPoly);
  g.fill({ color: 0x04080e });

}

function SlopPitFX({
  cx, cy, fill, scale, vibeCoderCount,
}: {
  cx: number; cy: number; fill: number; scale: number; vibeCoderCount: number;
}) {
  const HW = ISO_CELL_STRIDE * scale / 2;
  const HH = ISO_CELL_STRIDE * scale / 4;

  const taps = useMemo(() => {
    // NE wall rim: connects right corner (5HW, 0) to far corner (0, -5HH).
    // y_rim(x) = x*(HH/HW) - 5*HH
    //   At x=3HW: rim y = -2HH.  At x=HW: rim y = -4HH.
    // Attach pipes slightly above the NE rim so they sit at tile-surface level.
    // RISE lifts the attach point above the geometric rim into the visible grass layer.
    // Pipe extends LX screen-x inward along iso +j direction (screen: -LX, +LY).
    // groundY = spoutX*(HH/HW): sludge surface y at 100% fill at that iso-x.
    const RISE = HH * 0.5;
    const LX   = HW * 1.5;
    const LY   = LX * (HH / HW); // = 1.5*HH
    const rimY = (x: number) => x * (HH / HW) - 5 * HH;
    return [
      { // near right corner, x=3HW
        attachX: 3 * HW,      attachY: rimY(3 * HW) - RISE,        // -2.5HH
        spoutX:  3 * HW - LX, spoutY:  rimY(3 * HW) - RISE + LY,   // -1HH
        groundY: (3 * HW - LX) * (HH / HW),                         // 1.5HH
      },
      { // near far corner, x=HW
        attachX: HW,           attachY: rimY(HW) - RISE,             // -4.5HH
        spoutX:  HW - LX,      spoutY:  rimY(HW) - RISE + LY,        // -3HH
        groundY: (HW - LX) * (HH / HW),                              // -0.5HH
      },
    ];
  }, [HW, HH]);

  const dripsRef   = useRef<SlopDrip[]>([]);
  const bubblesRef = useRef<SlopBubble[]>([]);
  const ringsRef   = useRef<SlopRing[]>([]);
  const emitAccRef   = useRef([0, 0]);
  const bubbleAccRef = useRef(0);
  const pipeGRef     = useRef<Graphics>(null);
  const fxGRef       = useRef<Graphics>(null);

  useEffect(() => {
    const g = pipeGRef.current;
    if (!g) return;
    g.clear();
    if (vibeCoderCount < SLOP_PIT_UNLOCK_COUNT) return;
    for (const tap of taps) drawIsoPipe(g, tap.attachX, tap.attachY, tap.spoutX, tap.spoutY, HW, HH);
  }, [vibeCoderCount, taps, HW, HH]);

  // Clip drips to the pit polygon so they never bleed onto surrounding tiles.
  // fxGRef lives in the building-layer container (above ground), so zIndex alone
  // can't fix the overlap — a mask is the only way to constrain the painted area.
  useEffect(() => {
    const g = fxGRef.current;
    if (!g) return;
    const mask = new Graphics();
    // 5×5 pit diamond in FX-local coords: N(0,-6HH) E(5HW,-HH) S(0,4HH) W(-5HW,-HH)
    mask.poly([0, -6 * HH, 5 * HW, -HH, 0, 4 * HH, -5 * HW, -HH]).fill({ color: 0xffffff });
    g.addChild(mask);
    g.mask = mask;
    return () => {
      g.mask = null;
      mask.destroy();
    };
  }, [HW, HH]);

  useTick((ticker) => {
    const g = fxGRef.current;
    if (!g) return;
    const active = fill > 0 && vibeCoderCount >= SLOP_PIT_UNLOCK_COUNT;
    if (!active) { g.clear(); dripsRef.current = []; bubblesRef.current = []; ringsRef.current = []; return; }

    const dt = ((ticker as unknown as { deltaMS?: number }).deltaMS ?? 16.7) / 1000;
    const pct = fill / 100;
    const SURF_FC = [0x12261a, 0x1e3a1e, 0x92400e, 0x7c2d12] as const;
    const fc = SURF_FC[pct > 0.8 ? 3 : pct > 0.5 ? 2 : pct > 0.25 ? 1 : 0];
    const dripColor = (Math.min(255, (((fc >> 16) & 0xff) * 1.60) | 0) << 16) |
                      (Math.min(255, (((fc >>  8) & 0xff) * 1.60) | 0) <<  8) |
                       Math.min(255, (( fc        & 0xff) * 1.60) | 0);
    // Sludge surface Y in local FX space (container is centred at pit centre, ground level)
    const sludgeOffset = HH * (PIT_DEPTH_HH - 1) * (1 - pct);

    for (let i = 0; i < taps.length; i++) {
      emitAccRef.current[i] = (emitAccRef.current[i] ?? 0) + dt * PIPE_EMIT_RATE * pct;
      while (emitAccRef.current[i] >= 1) {
        emitAccRef.current[i] -= 1;
        const sx = taps[i].spoutX + (Math.random() - 0.5) * 2;
        dripsRef.current.push({
          x: sx, y: taps[i].spoutY, vy: 0,
          alpha: 0.9 + Math.random() * 0.1,
          r: 0, maxR: 3 + Math.random() * 2.5,
          groundY: taps[i].groundY, splashed: false,
          phase: 'forming', sx, sy: taps[i].spoutY, formT: 0,
          formDur: 0.5 + Math.random() * 0.4,
        });
      }
    }
    if (dripsRef.current.length > 12) dripsRef.current.splice(0, dripsRef.current.length - 12);

    // Bubbles across the full 5×5 pit when there is any sludge
    if (fill > 0) {
      bubbleAccRef.current += dt * pct * 1.8;
      while (bubbleAccRef.current >= 1) {
        bubbleAccRef.current -= 1;
        const angle = Math.random() * Math.PI * 2;
        const dist  = Math.random() * 2 * HW * 0.55; // always full pit (radius=2)
        bubblesRef.current.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.4, r: 0, maxR: 1 + Math.random() * 2.5, decay: 0 });
      }
    }
    if (bubblesRef.current.length > 18) bubblesRef.current.splice(0, bubblesRef.current.length - 18);

    g.clear();
    dripsRef.current = dripsRef.current.filter(d => d.alpha > 0.05);
    for (const d of dripsRef.current) {
      const target = d.groundY + sludgeOffset;

      if (d.phase === 'forming') {
        d.formT += dt / d.formDur;
        const t  = Math.min(d.formT, 1);
        const tE = t * t * (3 - 2 * t);
        d.r = d.maxR * Math.pow(tE, 0.55);
        // Thread grows from pipe down to bead; bead hangs at thread end
        const threadLen = tE * d.maxR * 2.0;
        const threadW   = Math.max(0.5, d.maxR * 0.07);
        d.y = d.sy + threadLen + d.r;
        d.x = d.sx;
        // Tapered filament: full width at spout, pinched to a neck at bead tip
        if (threadLen > 0.5) {
          const neckW = threadW * 0.15;
          const threadBot = d.sy + threadLen;
          g.moveTo(d.sx - threadW, d.sy);
          g.lineTo(d.sx + threadW, d.sy);
          g.lineTo(d.sx + neckW, threadBot);
          g.lineTo(d.sx - neckW, threadBot);
          g.closePath();
          g.fill({ color: dripColor, alpha: d.alpha });
        }
        if (d.formT >= 1) { d.phase = 'falling'; d.vy = 4; }
      } else {
        // ── Falling phase ─────────────────────────────────────────────────────
        if (d.y < target) {
          d.vy = Math.min(d.vy + 45 * dt, 55);
          d.y  = Math.min(d.y + d.vy * dt, target);
        } else {
          d.alpha -= dt * 4.5;
          if (!d.splashed) {
            d.splashed = true;
            const dmapX = (d.x / HW + d.groundY / HH) * 0.5;
            const dmapY = (d.groundY / HH - d.x / HW) * 0.5;
            const simI  = Math.max(0, Math.min(SIM_N, Math.round((2.5 + dmapX) / 5 * SIM_N)));
            const simJ  = Math.max(0, Math.min(SIM_N, Math.round((2.5 + dmapY) / 5 * SIM_N)));
            sweSplash(simI, simJ, -16);
            ringsRef.current.push({ x: d.x, y: target, r: d.r * 0.2, alpha: 0.75, maxR: d.r * 4 });
          }
        }

        // Short tail: fades quickly after detach, proportional to speed
        const tailLen = Math.min(d.vy * 0.035, d.r * 1.6);
        if (tailLen > 0.5 && !d.splashed) {
          g.moveTo(d.x, d.y - d.r * 1.0);
          g.lineTo(d.x, d.y - d.r * 1.0 - tailLen);
          g.stroke({ color: dripColor, alpha: d.alpha * 0.4, width: d.r * 0.2 });
        }
      }

      // Drop body: teardrop — pointed at TOP (neck/trailing), round bulge at BOTTOM
      if (d.r > 0.2) {
        const stretch = d.phase === 'forming' ? 1 : 1 + d.vy * 0.007;
        const rx  = d.r * 0.54;
        // During forming, tip = d.y - d.r = thread bottom (flush with neck end)
        const tip = d.phase === 'forming' ? (d.y - d.r) : d.y - d.r * 1.05 * stretch;
        const bot = d.y + d.r * 0.72;            // rounded cap at BOTTOM
        g.moveTo(d.x, tip);
        // right side: from tip sweep wide in the lower half, end at rounded bottom
        g.bezierCurveTo(d.x + rx * 0.5, d.y - d.r * 0.3, d.x + rx * 1.25, d.y + d.r * 0.35, d.x, bot);
        // left side: from rounded bottom back up to tip
        g.bezierCurveTo(d.x - rx * 1.25, d.y + d.r * 0.35, d.x - rx * 0.5, d.y - d.r * 0.3, d.x, tip);
        g.fill({ color: dripColor, alpha: d.alpha });
      }
    }
    // Impact rings
    ringsRef.current = ringsRef.current.filter(r => r.alpha > 0.02);
    for (const ring of ringsRef.current) {
      ring.r = Math.min(ring.r + dt * ring.maxR * 3.5, ring.maxR);
      ring.alpha -= dt * 3.2;
      if (ring.alpha > 0.02) {
        g.ellipse(ring.x, ring.y, ring.r * 0.52, ring.r * 0.28);
        g.stroke({ color: dripColor, alpha: ring.alpha, width: 0.7 });
      }
    }
    bubblesRef.current = bubblesRef.current.filter(b => b.decay < 1);
    for (const b of bubblesRef.current) {
      b.r < b.maxR ? (b.r += dt * 7) : (b.decay += dt * 2.5);
      // Bubbles float at sludge surface Y
      g.ellipse(b.x, b.y + sludgeOffset, b.r, b.r * 0.45);
      g.stroke({ color: 0x5a7a3a, width: 0.8, alpha: (1 - b.decay) * 0.5 });
    }
  });

  return (
    <>
      <pixiGraphics ref={pipeGRef} x={cx} y={cy} zIndex={cityDepthKey(SLOP_PIT_MAP_X, SLOP_PIT_MAP_Y, 2)} />
      <pixiGraphics ref={fxGRef}   x={cx} y={cy} zIndex={cityDepthKey(SLOP_PIT_MAP_X, SLOP_PIT_MAP_Y, 3)} />
    </>
  );
}

/**
 * Slop Pit: a slowly-filling toxic pool in the vibe coder zone. Rendered
 * imperatively in Pixi (same pattern as GroundRoadLayer). The pit fills as
 * vibe coders work and penalises all income when it overflows; pressing DRAIN
 * empties it but immediately tanks vibe coder satisfaction.
 */
function SlopPitLayer({
  wrapperSize,
  scale,
}: {
  wrapperSize: WrapperSize;
  scale: number;
}) {
  const containerRef = useRef<Container>(null);
  const fill = useSlopPitStore((s) => s.fill);
  const vibeCoderCount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "vibe_coder")?.amount ?? 0,
  );

  const ox = wrapperSize.width / 2;
  const oy = wrapperSize.height / 4;
  const HH = ISO_CELL_STRIDE * scale / 4; // needed for tile-anchor alignment
  const { x: worldX, y: worldY } = mapToWorld(SLOP_PIT_MAP_X, SLOP_PIT_MAP_Y, 0, scale);
  const cx = worldX + ox;
  // Tile sprites use anchor(0.5,1) so the world position is the diamond BOTTOM.
  // The diamond centre is HH above that; align the sludge container to the centre.
  const cy = worldY + oy - HH;

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;

    c.removeChildren().forEach((child) => child.destroy());

    if (vibeCoderCount < SLOP_PIT_UNLOCK_COUNT) return;

    c.sortableChildren = true;

    c.sortChildren();
  }, [fill, vibeCoderCount, cx, cy, scale]);

  return (
    <>
      <pixiContainer
        ref={containerRef}
        x={cx}
        y={cy}
        zIndex={cityDepthKey(SLOP_PIT_MAP_X, SLOP_PIT_MAP_Y, 1)}
      />
      <SlopPitFX cx={cx} cy={cy} fill={fill} scale={scale} vibeCoderCount={vibeCoderCount} />
    </>
  );
}

