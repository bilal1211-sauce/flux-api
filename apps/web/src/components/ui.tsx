"use client";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { X, LoaderCircle, Trash2, Inbox } from "lucide-react";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Panel({
  children,
  className = "",
  id,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section id={id} className={`panel ${className}`} {...props}>
      {children}
    </section>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const id = useId();
  const control = isValidElement<{
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
  }>(children)
    ? cloneElement(children, {
        "aria-labelledby": `${id}-label`,
        ...(hint ? { "aria-describedby": `${id}-hint` } : {}),
      })
    : children;
  return (
    <label className="field">
      <span id={`${id}-label`}>{label}</span>
      {control}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={24} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> Loading your workspace…
    </div>
  );
}
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} className="dialog" aria-label={title}>
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close dialog"
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function DeleteButton({
  name,
  remove,
  disabled,
}: {
  name: string;
  remove: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="icon-button danger-text"
        aria-label={`Delete ${name}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Trash2 size={15} />
      </button>
      {open && (
        <Dialog title={`Delete ${name}?`} close={() => setOpen(false)}>
          <p className="muted">
            This permanently removes this item and its associated configuration.
          </p>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await remove();
                setOpen(false);
              }}
            >
              Delete
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
