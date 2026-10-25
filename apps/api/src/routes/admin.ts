// Owner: R1. Task C-12: header-protected admin reset.
//
// Equality is compared over SHA-256 digests with timingSafeEqual so neither the
// token contents nor its length leak through timing. A missing or empty token
// configuration always rejects.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export const ADMIN_RESET_HEADER = "x-admin-reset-token";

function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

export interface AdminResetDeps {
  token: string;
  reset: () => void | Promise<void>;
}

export type AdminResetHandler = (req: Request, res: Response) => Promise<void>;

export function createAdminResetHandler(
  deps: AdminResetDeps,
): AdminResetHandler {
  return async (req, res) => {
    const provided = req.get(ADMIN_RESET_HEADER);
    const configured = deps.token;
    if (
      configured.length === 0 ||
      provided === undefined ||
      !constantTimeEquals(provided, configured)
    ) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    await deps.reset();
    res.status(200).json({ status: "reset" });
  };
}
