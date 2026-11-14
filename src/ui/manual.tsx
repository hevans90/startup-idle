/**
 * A CONTROL THAT CHANGES THE COMPANY: a hire, an upgrade, a tool. Under AI
 * mode it is not there, and what stands `instead` is, if anything — while
 * the `desk` that does that work is on: switched off, the control is back.
 * @see useAiDriving
 */
import type { ReactNode } from "react";
import { useAiDriving } from "../hooks/use-ai-driving";
import type { PilotDesk } from "../state/pilot-view.store";

export function Manual({ children, instead = null, desk }: { children: ReactNode; instead?: ReactNode; desk: PilotDesk }) {
  return <>{useAiDriving(desk) ? instead : children}</>;
}
