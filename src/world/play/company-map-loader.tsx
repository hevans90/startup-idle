/**
 * THE COMPANY'S MAP, in its own chunk — fetched ahead where it can be, and
 * drawn at once when it was.
 *
 * `React.lazy` suspends on its first render even when the chunk is already in,
 * and React holds back what a suspense resolves into for about 300 ms. So once
 * the chunk has been fetched the map is rendered directly, and the lazy one is
 * only for when it has not. @see FounderSelect's useMapMadeReady
 */
import { lazy, type ComponentProps, type ComponentType } from "react";

type Map = typeof import("./company-map").default;

let loaded: Map | null = null;
let loading: Promise<{ default: Map }> | null = null;

/** Fetch the map's chunk: once, however often asked. */
export function loadCompanyMap(): Promise<{ default: Map }> {
  loading ??= import("./company-map").then((m) => {
    loaded = m.default;
    return m;
  });
  return loading;
}

const LazyMap = lazy(loadCompanyMap) as ComponentType<ComponentProps<Map>>;

/** The map: at once if its chunk is in, else through the nearest Suspense. */
export function CompanyMap(props: ComponentProps<Map>) {
  const Loaded = loaded;
  return Loaded ? <Loaded {...props} /> : <LazyMap {...props} />;
}
