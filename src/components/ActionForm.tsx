"use client";

import { useActionState, useCallback, type ReactNode, type ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "./Toaster";

export type ActionResult = { ok: boolean; message?: string; redirectTo?: string } | null;
export type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/** Runs a server action, shows its message as a toast and follows any redirect — safe even if the form unmounts afterwards. */
export function useActionWithToast(action: FormAction) {
  const router = useRouter();
  return useCallback(
    async (prev: ActionResult, fd: FormData): Promise<ActionResult> => {
      const r = await action(prev, fd);
      if (r?.message) toast(r.message, r.ok ? "ok" : "error");
      if (r?.redirectTo) router.push(r.redirectTo);
      return r;
    },
    [action, router],
  );
}

/**
 * Form wrapper for server actions that keeps the page on screen:
 * the action revalidates data in place, the result is shown as a toast,
 * and only real page changes navigate (via router.push, so content never blanks).
 */
export function ActionForm({ action, children, className, confirm }: { action: FormAction; children: ReactNode; className?: string; confirm?: string }) {
  const wrapped = useActionWithToast(action);
  const [, formAction] = useActionState(wrapped, null);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}

/** Submit button that shows a pending state while the action runs. */
export function SubmitButton({ children, pendingText = "Working…", className = "btn btn-primary", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || rest.disabled} {...rest}>
      {pending ? pendingText : children}
    </button>
  );
}
