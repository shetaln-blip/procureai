import type { ReactNode } from "react";

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}

/** Shared modal shell (overlay + centered panel) for the supplier
 *  detail drawer and the comparison table — previously two
 *  independently hand-rolled overlays with slightly different
 *  className strings. */
export function Modal({ onClose, children, maxWidth = "max-w-3xl" }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className={`max-h-[90vh] w-full ${maxWidth} overflow-y-auto rounded-md border border-border bg-surface`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Close"
      className="rounded-md px-3 py-2 text-xl text-text-tertiary transition hover:bg-white/5 hover:text-text-primary"
    >
      ×
    </button>
  );
}
