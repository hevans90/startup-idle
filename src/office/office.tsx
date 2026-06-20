import { Application, extend, useApplication, useTick } from "@pixi/react";
import {
  Container,
  Graphics,
  Sprite,
  Texture,
  TextureSource,
} from "pixi.js";
import { memo, RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useGeneratorStore } from "../state/generators.store";
import { useOfficeStore } from "../state/office.store";
import { useThemeStore } from "../state/theme.store";
import { loadIsometricAtlasTextures } from "./atlas/load-isometric-atlases";
import { BUILDING_STYLES } from "./city/buildings";
import { computeCity } from "./city/compute-city";
import { AVENUE_ROWS, generateWorld } from "./city/generate-world";
import { avenueTileFor, roadMaskAt, roadSpriteFor } from "./city/road-autotile";
import { cellKey } from "./city/types";
import type { SpriteId } from "./map/types";
import {
  cityDepthKey,
  mapToWorld,
  pickTopTileAtPlane,
  stackedWorldY,
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

/**
 * Static city base: dense ground + the full road network. Built imperatively
 * into a Pixi Container (≈2,800 sprites) so React never reconciles them — it
 * rebuilds only when textures/size change. Roads sit just above ground in the
 * same column. Drawn behind everything dynamic (buildings/props/vehicles),
 * which is correct because the base is flat and never occludes a raised sprite.
 */
const GroundRoadLayer = memo(function GroundRoadLayer({
  textures,
  wrapperSize,
  scale,
}: {
  textures: Textures;
  wrapperSize: WrapperSize;
  scale: number;
}) {
  const containerRef = useRef<Container>(null);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    c.sortableChildren = true;

    const world = generateWorld();
    const ox = wrapperSize.width / 2;
    const oy = wrapperSize.height / 4;

    // Tiles are scaled a hair larger than their cell so neighbours overlap by
    // ~1px, hiding the sub-pixel seams that otherwise show between diamonds at
    // fractional viewport zoom. roundPixels keeps edges crisp.
    const BLEED = 1.02;
    const place = (spriteId: SpriteId, mapX: number, mapY: number, floor: number) => {
      const tex = textures[spriteId];
      if (!tex) return;
      const { x, y } = mapToWorld(mapX, mapY, 0, scale);
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      s.x = x + ox;
      s.y = y + oy;
      s.scale.set(scale * BLEED);
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
    };
  }, [textures, wrapperSize.width, wrapperSize.height, scale]);

  return <pixiContainer ref={containerRef} />;
});

/**
 * Buildings derived from employee counts. Subscribes only to the three counts
 * (primitive selectors), so it re-renders when you hire — not every tick. Each
 * building is a vertical stack of module sprites + a roof, lifted by FLOOR_LIFT
 * and depth-sorted with `cityDepthKey` (column-dominant) so towers never draw
 * over buildings in front of them. Tinted per district for identity.
 */
const BuildingLayer = memo(function BuildingLayer({
  textures,
  wrapperSize,
  scale,
}: {
  textures: Textures;
  wrapperSize: WrapperSize;
  scale: number;
}) {
  const intern = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "intern")?.amount ?? 0,
  );
  const vibeCoder = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "vibe_coder")?.amount ?? 0,
  );
  const dev10x = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "10x_dev")?.amount ?? 0,
  );

  const scene = useMemo(
    () =>
      computeCity({
        intern,
        vibe_coder: vibeCoder,
        "10x_dev": dev10x,
      }),
    [intern, vibeCoder, dev10x],
  );

  const ox = wrapperSize.width / 2;
  const oy = wrapperSize.height / 4;

  return (
    <>
      {scene.buildings.flatMap((b) => {
        const style = BUILDING_STYLES[b.district];
        const moduleTex = textures[style.module];
        const roofTex = textures[style.roof];
        if (!moduleTex || !roofTex) return [];
        const { x: worldX, y: worldY } = mapToWorld(b.mapX, b.mapY, 0, scale);
        const baseY = worldY + oy;
        const sprites = [];
        for (let floor = 0; floor < b.floors; floor++) {
          sprites.push(
            <pixiSprite
              key={`${b.key}_f${floor}`}
              texture={moduleTex}
              x={worldX + ox}
              y={stackedWorldY(baseY, floor)}
              scale={scale}
              anchor={{ x: 0.5, y: 1 }}
              tint={style.tint}
              zIndex={cityDepthKey(b.mapX, b.mapY, 1 + floor)}
            />,
          );
        }
        sprites.push(
          <pixiSprite
            key={`${b.key}_roof`}
            texture={roofTex}
            x={worldX + ox}
            y={stackedWorldY(baseY, b.floors)}
            scale={scale}
            anchor={{ x: 0.5, y: 1 }}
            tint={style.tint}
            zIndex={cityDepthKey(b.mapX, b.mapY, 1 + b.floors)}
          />,
        );
        return sprites;
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
      <GroundRoadLayer
        textures={textures}
        wrapperSize={wrapperSize}
        scale={scale}
      />
      <pixiContainer sortableChildren={true} zIndex={1}>
        <BuildingLayer
          textures={textures}
          wrapperSize={wrapperSize}
          scale={scale}
        />
      </pixiContainer>
    </pixiContainer>
  );
};
