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
        "cursor-pointer justify-center leading-3 p-2 border-primary-800 border-[1px] hover:border-primary-500 hover:text-primary-500 hover:bg-primary-50 outline-none  disabled:bg-primary-100 disabled:text-primary-500 disabled:cursor-not-allowed disabled:border-primary-300",
        className
      )}
      ref={ref}
    >
      {children}
      {loading ? <Spinner width={20} /> : null}
    </button>
  );
});
