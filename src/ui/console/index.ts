/**
 * THE CONSOLE'S KIT: every piece of the UI built from its tokens and frames,
 * StrictMode-safe, both themes, keyboard-complete. arwes is used here and
 * nowhere else. @see plans/ui-overhaul.md §2, src/ui/theme, src/ui/motion
 */
export { Frame, ASSEMBLE, toneStyle, type FrameKind, type Tone } from "./frame";
export { Text, type TextMode } from "./text";
export { Backdrop } from "./backdrop";
export { Button, IconButton, Toggle, Segmented, Slider, FOCUS, type ButtonProps, type ButtonVariant } from "./controls";
export { Panel, Card, Section, Dialog, Label } from "./layout";
export { Num, Meter, Badge, Chip, Kbd, Tooltip, Locked, POPOVER } from "./feedback";
export { Tabs, type TabItem } from "./tabs";
