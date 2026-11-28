/**
 * A BUILDING'S LITTLE PICTURE, for a picker's card: a home as a block in its district's colour, as many floors as it
 * is grown; anything else drawn finished, as the map draws it. @see useLandmarkPicture, BuildBar, ToolDock
 */
import { IconBuildingMonument } from "@tabler/icons-react";
import { twMerge } from "tailwind-merge";

import type { StructureDef } from "../structures/def";
import { KIND_COLOUR } from "./building-info";
import { useLandmarkPicture } from "./landmark-picture";

const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** A home, as a little block: `colour` its district's, else read off its name. */
function Block({ def, colour, className }: { def: StructureDef; colour?: number; className?: string }) {
  const m = /^(intern|vibe_coder|10x_dev)\.(?:t(\d)|landmark)$/.exec(def.name);
  const n = m ? (m[2] ? Number(m[2]) + 2 : 5) : 2, hh = 5, h = n * hh;
  const c = css(colour ?? KIND_COLOUR[(m?.[1] ?? "intern") as keyof typeof KIND_COLOUR] ?? 0x8a8475);
  return (
    <svg viewBox="0 0 44 44" className={twMerge("h-10 w-11", className)} aria-hidden>
      <g transform={`translate(22 ${34 - h})`} stroke="rgb(0 0 0 / .35)" strokeWidth=".6">
        <path d={`M-14 0 L0 7 V${7 + h} L-14 ${h} Z`} fill={`color-mix(in oklab, ${c} 78%, black)`} />
        <path d={`M14 0 L0 7 V${7 + h} L14 ${h} Z`} fill={`color-mix(in oklab, ${c} 55%, black)`} />
        <path d="M0 -7 L14 0 L0 7 L-14 0 Z" fill={`color-mix(in oklab, ${c} 85%, white)`} />
        {Array.from({ length: n }, (_, i) => <path key={i} stroke="rgb(255 244 200 / .75)" strokeWidth="1.4" strokeDasharray="2.5 2.2" d={`M-12 ${4 + i * hh} L-2 ${9 + i * hh} M2 ${9 + i * hh} L12 ${4 + i * hh}`} />)}
      </g>
    </svg>
  );
}

function Picture({ def, className }: { def: StructureDef; className?: string }) {
  const url = useLandmarkPicture(def.id);
  return url
    ? <img src={url} alt="" draggable={false} className={twMerge("h-10 w-full object-contain", className)} />
    : <IconBuildingMonument size={26} stroke={1.2} className={twMerge("h-10 text-fg-faint", className)} />;
}

/** The picture: a home's block when `home` (or its kit is tiles), else the building drawn. */
export function BuildingThumb({ def, home, colour, className }: { def: StructureDef; home?: boolean; colour?: number; className?: string }) {
  return home || def.render.kind === "tiles" ? <Block def={def} colour={colour} className={className} /> : <Picture def={def} className={className} />;
}
