import { IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";

export function Toast({
  children,
  onClose,
  icon,
}: {
  children: ReactNode | string;
  onClose: () => void;
  icon?: ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between space-x-2 bg-primary-50 dark:bg-primary-900 border border-primary-800 dark:border-primary-200 dark:text-primary-50 p-2"
      data-test="toast-notification"
    >
      {icon}
      <div className="text-md leading-4 [grid-area:_title]">{children}</div>
      <button
        aria-label="Close"
        data-test="close-button"
        onClick={onClose}
        className="cursor-pointer"
      >
        <span aria-hidden>
          <IconX />
        </span>
        <span className="sr-only">Close</span>
      </button>
    </div>
  );
}
