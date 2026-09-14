import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/** Shared classNames for text input / select / textarea across the app
 *  (requirement box, RFQ composer fields, the supplier-facing quote
 *  form) so focus/border/placeholder treatment never drifts again. */
export const fieldClasses =
  "w-full rounded-md border border-border bg-surface px-3.5 py-2.5 text-sm text-text-primary outline-none transition placeholder:text-text-tertiary focus:border-accent";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${fieldClasses} ${className}`.trim()} {...rest} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea className={`${fieldClasses} resize-none ${className}`.trim()} {...rest} />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return <select className={`${fieldClasses} ${className}`.trim()} {...rest} />;
}

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, required, hint, children }: FieldProps) {
  return (
    <label className="block">
      <span className="font-ledger-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      <div className="mt-2">{children}</div>
      {hint && <p className="mt-1.5 text-xs text-text-tertiary">{hint}</p>}
    </label>
  );
}
