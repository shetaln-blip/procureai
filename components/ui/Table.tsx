import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  );
}

export function Th({ className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`border-b border-border bg-surface-raised px-4 py-3 font-ledger-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-text-secondary ${className}`.trim()}
      {...props}
    />
  );
}

export function Td({ className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={`border-b border-border px-4 py-3 align-top text-text-primary ${className}`.trim()}
      {...props}
    />
  );
}
