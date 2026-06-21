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
import { avenueTileFor, roadMaskAt, roadSpriteFor } from "./city/road-autotile";
import { cellKey } from "./city/types";
import type { SpriteId } from "./map/types";
import {
  cityDepthKey,
  mapToWorld,
  pickTopTileAtPlane,
  viewportWorldToTilePlane,
} from "./math-utils";
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
      resolution={4}
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
}: {
  textures: Textures;
  wrapperSize: WrapperSize;
  scale: number;
  scene: CityScene;
}) {
  const containerRef = useRef<Container>(null);
  // Ground-level dynamic sprites in the container (building bases + props),
  // keyed so they can be reconciled as the scene changes.
  const baseSpritesRef = useRef<Map<string, Sprite>>(new Map());

  const ox = wrapperSize.width / 2;
  const oy = wrapperSize.height / 4;

  // Static grass + roads. Rebuilt only when textures/size/scale change.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    c.sortableChildren = true;

    const world = generateWorld();
    const place = (spriteId: SpriteId, mapX: number, mapY: number, floor: number) => {
      const tex = textures[spriteId];
      if (!tex) return;
      const { x, y } = mapToWorld(mapX, mapY, 0, scale);
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      s.x = x + ox;
      s.y = y + oy;
      s.scale.set(scale * TILE_BLEED);
      s.roundPixels = true;
      s.zIndex = cityDepthKey(mapX, mapY, floor);
      c.addChild(s);
    };

    for (const t of world.ground) place(t.spriteId, t.mapX, t.mapY, 0);
    for (const key of world.roadCells) {
      const [mx, my] = key.split(",").map(Number);
      const lane = AVENUE_ROWS.indexOf(my);
      let sprite: SpriteId;
      if (lane >= 0) {
        // 2-wide thick avenue: pick lane tile, branching where a connector tees in.
        const outer = lane === 0 ? cellKey(mx, my - 1) : cellKey(mx, my + 1);
        sprite = avenueTileFor(lane, world.roadCells.has(outer));
      } else {
        sprite = roadSpriteFor(roadMaskAt(mx, my, world.roadCells));
      }
      place(sprite, mx, my, 0.5);
    }
    c.sortChildren();

    return () => {
      c.removeChildren().forEach((child) => child.destroy());
      baseSpritesRef.current.clear(); // base sprites were destroyed too
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
      tint: number;
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
          tint: base.tint ?? 0xffffff,
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
        c.addChild(s);
        map.set(key, s);
      } else {
        s.texture = tex;
      }
      s.x = x + ox;
      s.y = y + oy - g.lift * scale;
      s.scale.set(scale * TILE_BLEED);
      s.tint = g.tint;
      s.zIndex = cityDepthKey(g.mapX, g.mapY, g.z);
    }
    c.sortChildren();
  }, [scene, textures, scale, ox, oy]);

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
  tint,
  zIndex,
  enabledRef,
}: {
  texture: Texture<TextureSource>;
  x: number;
  y: number;
  scale: number;
  tint: number;
  zIndex: number;
  enabledRef: MutableRefObject<boolean>;
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
      tint={tint}
      zIndex={zIndex}
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
}: {
  textures: Textures;
  wrapperSize: WrapperSize;
  scale: number;
  scene: CityScene;
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
              tint={part.tint ?? 0xffffff}
              zIndex={cityDepthKey(b.mapX, b.mapY, part.depth)}
              enabledRef={entrancesEnabledRef}
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

  const viewport = useOfficeStore((state) => state.viewport);

  const theme = useThemeStore((state) => state.theme);

  const world = useMemo(() => generateWorld(), []);

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

  const [, setHoveredTile] = useState<{
    mapX: number;
    mapY: number;
    z: number;
  } | null>(null);

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

  const checkHoveredTile = () => {
    if (!viewport) return;

    const pos = viewport.toWorld(app.renderer.events.pointer.global);
    const local = viewportWorldToTilePlane(pos.x, pos.y, wrapperSize);
    setHoveredTile(pickTopTileAtPlane(world.ground, local.x, local.y, scale));
  };

  useTick(() => {
    checkHoveredTile();
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
      />
      <pixiContainer sortableChildren={true} zIndex={1}>
        <BuildingLayer
          textures={textures}
          wrapperSize={wrapperSize}
          scale={scale}
          scene={scene}
        />
      </pixiContainer>
    </pixiContainer>
  );
};
