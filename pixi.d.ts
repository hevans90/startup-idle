import { PixiReactNode } from "@pixi/react";
import { Viewport } from "pixi-viewport";
// export {}; // <-- makes the file a module

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      viewport: PixiReactNode<typeof Viewport>;
    }
  }
}
