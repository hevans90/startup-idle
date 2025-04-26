import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ForwardedRef,
  type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";
import { Spinner } from "./Spinner";

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "prefix"
> & { children?: ReactNode; loading?: boolean };

export const Button = forwardRef(function Button(
  { children, className, loading, ...rest }: ButtonProps,
  ref: ForwardedRef<HTMLButtonElement>
) {
  return (
    <button
      {...rest}
      className={twMerge(
        "cursor-pointer justify-center p-2  border-[1px] outline-none disabled:opacity-70 disabled:cursor-not-allowed",
        "border-primary-800  disabled:bg-primary-200 disabled:text-primary-500 disabled:border-primary-300",
        "dark:border-primary-500  dark:disabled:bg-primary-600 dark:disabled:text-primary-300 dark:disabled:border-primary-500",
        "hover:border-primary-500 hover:text-primary-500 hover:bg-primary-100",
        "dark:hover:border-primary-300 dark:hover:text-primary-200 dark:hover:bg-primary-600",
        className
      )}
      ref={ref}
    >
      {children}
      {loading ? <Spinner width={20} /> : null}
    </button>
  );
});
