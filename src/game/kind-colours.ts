/**
 * EACH KIND OF EMPLOYEE'S COLOUR: on the map (their homes, the build bar's
 * chips) and beside their name in the sidebar. A module of its own so the
 * sidebar takes it without the map's engine. @see building-info, EmployeeAvatar
 */
import type { GeneratorId } from "../state/generators.store";

export const KIND_COLOUR: Record<GeneratorId, number> = { intern: 0xf2b51d, vibe_coder: 0xff4fa3, "10x_dev": 0x2fb8a8 };
