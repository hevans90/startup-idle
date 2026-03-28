import { Application, extend, useApplication, useTick } from "@pixi/react";
import {
  Assets,
  Container,
  Graphics,
  Sprite,
  Spritesheet,
  Texture,
  TextureSource,
} from "pixi.js";
import { RefObject, useEffect, useMemo, useState } from "react";
import { useOfficeStore } from "../state/office.store";
import { useThemeStore } from "../state/theme.store";
import { buildOfficeMap } from "./map";
import {
  depthKey,
  mapToWorld,
  pickTopTileAtPlane,
  viewportWorldToTilePlane,
} from "./math-utils";
import { atlasData, TerrainKey } from "./sprites";
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

const World = ({
  wrapperSize,
}: {
  wrapperSize: { width: number; height: number };
}) => {
  const [textures, setTextures] =
    useState<Record<TerrainKey, Texture<TextureSource>>>();
  const { app } = useApplication();

  const viewport = useOfficeStore((state) => state.viewport);

  const theme = useThemeStore((state) => state.theme);

  const rows = 32;
  const cols = 32;

  const tiles = useMemo(
    () => buildOfficeMap(rows, cols),
    [rows, cols]
  );

  const [hoveredTile, setHoveredTile] = useState<{
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
    const loadSpriteSheet = async () => {
      const sheet: Texture = await Assets.load(atlasData.meta.image);

      sheet.source.scaleMode = "nearest";
      const spritesheet = new Spritesheet(sheet, atlasData);
      return spritesheet.parse();
    };

    loadSpriteSheet().then(setTextures);
  }, []);

  const scale = 3;

  const checkHoveredTile = () => {
    if (!viewport) return;

    const pos = viewport.toWorld(app.renderer.events.pointer.global);
    const local = viewportWorldToTilePlane(
      pos.x,
      pos.y,
      wrapperSize
    );
    setHoveredTile(pickTopTileAtPlane(tiles, local.x, local.y, scale));
  };

  useTick(() => {
    checkHoveredTile();
  });

  return (
    <pixiContainer sortableChildren={true}>
      {textures && wrapperSize
        ? tiles.map(({ mapX, mapY, z, terrain }) => {
            const { x: worldX, y: worldY } = mapToWorld(
              mapX,
              mapY,
              z,
              scale
            );

            const key = `${mapX}_${mapY}_${z}`;
            const zIndex = depthKey(mapX, mapY, z);
            const isHovered =
              hoveredTile != null &&
              hoveredTile.mapX === mapX &&
              hoveredTile.mapY === mapY &&
              hoveredTile.z === z;

            return (
              <pixiSprite
                key={key}
                texture={textures[terrain]}
                x={worldX + wrapperSize.width / 2}
                y={worldY + wrapperSize.height / 4}
                scale={scale}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={zIndex}
                tint={isHovered ? 0.7 * 0xffffff : 0xffffff}
              />
            );
          })
        : null}
    </pixiContainer>
  );
};
