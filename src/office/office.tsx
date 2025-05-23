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
import { generateGrid, getHoveredTile, screenToIsometric } from "./math-utils";
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

// const tileHover = convertColorToHex(tailwindColors.gray["200"]);

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

  const grid = useMemo(
    () =>
      generateGrid(rows, cols, (x, y) => {
        let terrain: TerrainKey;

        if (x === Math.floor(cols / 2) || x === Math.floor(cols / 2) + 4) {
          terrain = "paving"; // path
        } else if (
          x === Math.floor(cols / 2) + 1 ||
          x === Math.floor(cols / 2) + 3
        ) {
          terrain = "asphalt";
        } else if (x === Math.floor(cols / 2) + 2) {
          terrain = "road";
        } else if (x < cols / 2 && y < rows / 2) {
          terrain = "dark_green_grass"; // garden
        } else {
          terrain = "dirt"; // fallback
        }

        return { x, y, terrain };
      }),
    [rows, cols]
  );
  const [hoveredTile, setHoveredTile] = useState<{
    x: number;
    y: number;
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
  const TILE_HEIGHT = 18;

  const checkHoveredTile = () => {
    if (!viewport) return;

    const pos = viewport.toWorld(app.renderer.events.pointer.global);
    const { x, y } = getHoveredTile(
      pos.x - wrapperSize.width / 2,
      pos.y - wrapperSize.height / 4 + TILE_HEIGHT, // subtract half-tile to match anchor center
      scale
    );
    setHoveredTile({ x, y });
  };

  useTick(() => {
    checkHoveredTile();
  });

  return (
    <pixiContainer>
      {textures && wrapperSize
        ? grid.map(({ x, y, terrain }) => {
            // convert the screen coordinate to isometric coordinate
            const [isometric_x, isometric_y] = screenToIsometric(x, y, scale);

            const key = `${x}_${y}`;
            const isHovered =
              hoveredTile && hoveredTile.x === x && hoveredTile.y === y;

            return (
              <pixiSprite
                key={key}
                texture={textures[terrain]}
                x={isometric_x + wrapperSize.width / 2} // center horizontally
                y={isometric_y + wrapperSize.height / 4} // align the y axis to one fourth of the screen
                scale={scale} // scale into 4x
                anchor={{ x: 0.5, y: 0.5 }}
                tint={isHovered ? 0.7 * 0xffffff : 0xffffff} // highlight tint on hover
              />
            );
          })
        : null}
    </pixiContainer>
  );
};
