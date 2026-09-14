import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

/** One empty-state shape for "no saved requests", "no RFQs yet", and
 *  any future empty list — icon + title + short explanation + action. */
export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="rounded-md border border-dashed border-border-strong bg-surface px-8 py-20 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-border text-2xl text-text-tertiary">
        {icon ?? "+"}
      </div>
      <h2 className="mt-5 font-ledger-serif text-xl font-medium text-text-primary">
        {title}
      </h2>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
          {description}
        </p>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
