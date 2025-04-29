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
import tailwindColors from "tailwindcss/colors";
import { useThemeStore } from "../state/theme.store";
import { convertColorToHex } from "../utils/okl-to-rgb";
import { generateGrid, getHoveredTile, screenToIsometric } from "./math-utils";
import { atlasData } from "./sprites";

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
  return (
    <Application
      resizeTo={wrapperRef}
      antialias={true}
      autoDensity={true}
      preference="webgpu"
      resolution={4}
    >
      <World wrapperSize={wrapperSize} />
    </Application>
  );
};

const lightBg = window
  .getComputedStyle(document.body)
  ?.getPropertyValue("--color-primary-100");

const darkBg = window
  .getComputedStyle(document.body)
  ?.getPropertyValue("--color-primary-700");

const tileHover = convertColorToHex(tailwindColors.green["400"]);

const World = ({
  wrapperSize,
}: {
  wrapperSize: { width: number; height: number };
}) => {
  const [textures, setTextures] =
    useState<Record<string, Texture<TextureSource>>>();
  const { app } = useApplication();

  const theme = useThemeStore((state) => state.theme);

  const rows = 16;
  const cols = 16;

  const grid = useMemo(
    () => generateGrid(rows, cols, (x, y) => ({ x, y })),
    []
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

  const scale = 2;
  const TILE_HEIGHT = 18;

  const checkHoveredTile = () => {
    const pos = app.renderer.events.pointer.global;
    const { x, y } = getHoveredTile(
      pos.x - wrapperSize.width / 2,
      pos.y - wrapperSize.height / 4 + TILE_HEIGHT / 2, // subtract half-tile to match anchor center

      scale
    );
    console.log({ x, y });
    setHoveredTile({ x, y });
  };

  useTick(() => {
    checkHoveredTile();
  });

  return (
    <pixiContainer>
      {textures && wrapperSize
        ? grid.map(({ x, y }) => {
            // convert the screen coordinate to isometric coordinate
            const [isometric_x, isometric_y] = screenToIsometric(x, y, scale);

            const key = `${x}_${y}`;
            const isHovered =
              hoveredTile && hoveredTile.x === x && hoveredTile.y === y;

            return (
              <pixiSprite
                key={key}
                texture={textures["dark_floor"]}
                x={isometric_x + wrapperSize.width / 2} // center horizontally
                y={isometric_y + wrapperSize.height / 4} // align the y axis to one fourth of the screen
                scale={scale} // scale into 4x
                anchor={{ x: 0.5, y: 0.5 }}
                tint={isHovered ? tileHover : 0xffffff} // highlight tint on hover
              />
            );
          })
        : null}
    </pixiContainer>
  );
};
