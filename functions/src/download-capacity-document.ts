import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "http://127.0.0.1:4173",
  "https://genco-export.web.app",
  "https://genco-export.firebaseapp.com",
  "https://gencofarm.com",
  "https://www.gencofarm.com",
]);

const setCorsHeaders = (req: any, res: any) => {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
};

export const downloadCapacityDocument = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const authorization = String(req.headers.authorization || "");
    const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!idToken) {
      res.status(401).json({ error: "Authentication is required" });
      return;
    }

    try {
      await admin.auth().verifyIdToken(idToken);
    } catch {
      res.status(401).json({ error: "Invalid authentication token" });
      return;
    }

    const storagePath = String(req.body?.storagePath || "").trim();
    if (!storagePath.startsWith("capacityBuilding/") || storagePath.includes("..")) {
      res.status(400).json({ error: "Invalid document path" });
      return;
    }

    try {
      const file = admin.storage().bucket().file(storagePath);
      const [[metadata], bytes] = await Promise.all([file.getMetadata(), file.download()]);
      res.set("Content-Type", metadata.contentType || "application/octet-stream");
      res.set("Cache-Control", "private, max-age=300");
      res.status(200).send(bytes);
    } catch (error) {
      console.error("Unable to download capacity-building document", { storagePath, error });
      res.status(404).json({ error: "Document not found" });
    }
  },
);
