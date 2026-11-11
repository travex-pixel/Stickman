"use client";

import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface RowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  leading?: ReactNode;
  title: ReactNode;
  /** One quiet line under the title (t2). */
  detail?: ReactNode;
  /** A value, a pill or a lock reason at the right. */
  trailing?: ReactNode;
  /** Show a chevron at the right (tappable rows that navigate). */
  chevron?: boolean;
  /** Horizontal inset. Rows bleed to the container edge and carry their own 16px gutter. */
  gutter?: boolean;
}

/**
 * A list row: 52 minimum height, a hairline below, optional leading glyph and trailing value.
 * Tappable rows press by filling bg-2.
 */
export function Row({ leading, title, detail, trailing, chevron, gutter = true, className, onClick, disabled, type = "button", ...rest }: RowProps) {
  const body = (
    <>
      {leading && <span className="shrink-0 flex items-center justify-center w-6 text-t2">{leading}</span>}
      <span className="flex-1 min-w-0 flex flex-col justify-center text-left">
        <span className="t-body text-t1 truncate">{title}</span>
        {detail && <span className="t-label text-t2 truncate">{detail}</span>}
      </span>
      {trailing && <span className="shrink-0 flex items-center gap-2">{trailing}</span>}
      {chevron && <Icon name="chevron" size={16} className="shrink-0 text-t3" />}
    </>
  );
  const cls = cn("relative w-full min-h-[52px] flex items-center gap-3 py-2 shadow-[inset_0_-1px_0_var(--line)]", gutter && "px-4", className);
  if (!onClick) {
    return (
      <div className={cls} {...(rest as HTMLAttributes<HTMLDivElement>)}>
        {body}
      </div>
    );
  }
  return (
    <button type={type} className={cn(cls, "press-fill", disabled && "opacity-40")} onClick={onClick} disabled={disabled} {...rest}>
      {body}
    </button>
  );
}
