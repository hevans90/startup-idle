import { Application, extend, useApplication } from "@pixi/react";
import { Container, Graphics, Sprite } from "pixi.js";
import { RefObject, useEffect } from "react";
import { useThemeStore } from "../state/theme.store";

extend({
  Container,
  Graphics,
  Sprite,
});

type OfficeProps = {
  wrapperRef: RefObject<HTMLDivElement | null>;
};

export const Office = ({ wrapperRef }: OfficeProps) => {
  return (
    <Application resizeTo={wrapperRef}>
      <World />
    </Application>
  );
};

const lightBg = window
  .getComputedStyle(document.body)
  ?.getPropertyValue("--color-primary-100");
const darkBg = window
  .getComputedStyle(document.body)
  ?.getPropertyValue("--color-primary-700");

const World = () => {
  const { app } = useApplication();

  const theme = useThemeStore((state) => state.theme);

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

  return <pixiContainer></pixiContainer>;
};
