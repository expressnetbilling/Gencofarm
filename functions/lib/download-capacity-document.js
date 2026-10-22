"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadCapacityDocument = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const ALLOWED_ORIGINS = new Set([
    "http://localhost:8080",
    "http://127.0.0.1:4173",
    "https://genco-export.web.app",
    "https://genco-export.firebaseapp.com",
    "https://gencofarm.com",
    "https://www.gencofarm.com",
]);
const setCorsHeaders = (req, res) => {
    const origin = String(req.headers.origin || "");
    if (ALLOWED_ORIGINS.has(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
};
exports.downloadCapacityDocument = (0, https_1.onRequest)({ region: "us-central1" }, async (req, res) => {
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
    }
    catch {
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
    }
    catch (error) {
        console.error("Unable to download capacity-building document", { storagePath, error });
        res.status(404).json({ error: "Document not found" });
    }
});
