import { Router } from "express";
import { revenuecatWebhook } from "../controllers/revenuecat.controller.js";

const router = Router();

// Optional shared-secret validation for webhook security
function verifySecret(req: any, res: any, next: any) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return next();
  const auth = (req.headers["authorization"] as string) || "";
  // Accept either raw secret or Bearer <secret>
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : auth.trim();
  if (token && token === secret) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

router.post("/webhook", verifySecret, revenuecatWebhook);

export default router;
