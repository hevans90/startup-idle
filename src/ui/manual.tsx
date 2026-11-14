/**
 * A CONTROL THAT CHANGES THE COMPANY: a hire, an upgrade, a tool. Under AI
 * mode it is not there, and what stands `instead` is, if anything.
 * @see useAiDriving
 */
import type { ReactNode } from "react";
import { useAiDriving } from "../hooks/use-ai-driving";

export function Manual({ children, instead = null }: { children: ReactNode; instead?: ReactNode }) {
  return <>{useAiDriving() ? instead : children}</>;
}
