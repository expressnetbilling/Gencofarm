"use strict";
/**
 * Genco Export — Send Email HTTP Cloud Function (v2)
 *
 * Firebase Functions v2 (`onRequest` from `firebase-functions/v2/https`).
 *
 * Architecture decision:
 *   - Since RTDB security rules CANNOT be modified (shared with mobile app),
 *     we cannot add a database queue node for outgoing emails.
 *   - Instead, this function accepts authenticated HTTP POST requests
 *     directly from the React client and sends emails via Nodemailer/SMTP.
 *
 * Cost optimization:
 *   - `minInstances: 0` — no idle server cost. The function spins up only
 *     when an email needs to be sent, then scales to zero immediately after.
 *   - With the Firebase free tier (2M invocations/month, 400K GB-sec),
 *     this function can handle thousands of emails per month at zero cost.
 *
 * Security:
 *   - Every request MUST include a valid Firebase Auth ID token in the
 *     `Authorization: Bearer <token>` header.
 *   - The token is verified using `firebase-admin/auth`.
 *   - Unauthenticated requests are rejected with 401.
 *
 * Usage from client:
 * ```ts
 * const sendEmail = async (to: string, subject: string, body: string) => {
 *   const idToken = await auth.currentUser?.getIdToken();
 *   const res = await fetch(
 *     "https://us-central1-genco-export.cloudfunctions.net/sendEmail",
 *     {
 *       method: "POST",
 *       headers: {
 *         "Authorization": `Bearer ${idToken}`,
 *         "Content-Type": "application/json",
 *       },
 *       body: JSON.stringify({ to, subject, body }),
 *     },
 *   );
 *   return res.json();
 * };
 * ```
 */
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
exports.sendEmail = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
// ---------------------------------------------------------------------------
// SMTP Configuration via Firebase Secrets
// ---------------------------------------------------------------------------
// These are set via:
//   firebase functions:secrets:set SMTP_HOST
//   firebase functions:secrets:set SMTP_PORT
//   firebase functions:secrets:set SMTP_USER
//   firebase functions:secrets:set SMTP_PASS
//   firebase functions:secrets:set SMTP_FROM
//
// Alternatively, set them as environment variables in the Firebase Console
// under Cloud Functions configuration.
const smtpHost = (0, params_1.defineSecret)("SMTP_HOST");
const smtpPort = (0, params_1.defineSecret)("SMTP_PORT");
const smtpUser = (0, params_1.defineSecret)("SMTP_USER");
const smtpPass = (0, params_1.defineSecret)("SMTP_PASS");
const smtpFrom = (0, params_1.defineSecret)("SMTP_FROM");
// ---------------------------------------------------------------------------
// CORS Handling (manual — consistent with existing functions pattern)
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "https://genco-export.web.app",
    "https://genco-export.firebaseapp.com",
    "https://gencofarm.com",
    "https://www.gencofarm.com",
];
const corsHeaders = (req) => {
    const origin = req.headers.origin || "";
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
    };
};
const setCorsHeaders = (res, headers) => {
    for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
    }
};
// ---------------------------------------------------------------------------
// Input Validation
// ---------------------------------------------------------------------------
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validateRequest = (body) => {
    if (!body || typeof body !== "object") {
        return { valid: false, error: "Request body must be a JSON object." };
    }
    const { to, subject, body: emailBody } = body;
    if (!to || typeof to !== "string" || !isValidEmail(to)) {
        return { valid: false, error: "A valid 'to' email address is required." };
    }
    if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
        return { valid: false, error: "A non-empty 'subject' is required." };
    }
    if (!emailBody || typeof emailBody !== "string" || emailBody.trim().length === 0) {
        return { valid: false, error: "A non-empty 'body' is required." };
    }
    // Subject length limit (RFC 5322 recommends 78 chars, we allow 500)
    if (subject.length > 500) {
        return { valid: false, error: "Subject must be under 500 characters." };
    }
    // Body length limit (prevent abuse — 1 MB max)
    if (emailBody.length > 1_000_000) {
        return { valid: false, error: "Body must be under 1 MB." };
    }
    return {
        valid: true,
        data: {
            to: to.trim(),
            subject: subject.trim(),
            body: emailBody,
            bodyType: body.bodyType === "html" ? "html" : "plain",
            cc: body.cc,
            bcc: body.bcc,
            replyTo: body.replyTo,
        },
    };
};
// ---------------------------------------------------------------------------
// The Cloud Function
// ---------------------------------------------------------------------------
exports.sendEmail = (0, https_1.onRequest)({
    // minInstances: 0 (default) — function spins up on demand only.
    // This is critical for cost: no idle instance billing.
    // Uncomment and set if you need a minimum for cold-start latency:
    // minInstances: 0,
    region: "us-central1",
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom],
}, async (req, res) => {
    // ── CORS preflight ──
    if (req.method === "OPTIONS") {
        setCorsHeaders(res, corsHeaders(req));
        res.status(204).end();
        return;
    }
    // Set CORS headers on all responses
    setCorsHeaders(res, corsHeaders(req));
    // ── Method enforcement ──
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed. Use POST." });
        return;
    }
    try {
        // ── Auth verification ──
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
            res.status(401).json({ error: "Missing or invalid Authorization header." });
            return;
        }
        const idToken = authHeader.split("Bearer ")[1];
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
        }
        catch {
            res.status(401).json({ error: "Invalid or expired ID token." });
            return;
        }
        // ── Request validation ──
        const validation = validateRequest(req.body);
        if (!validation.valid) {
            res.status(400).json({ error: validation.error });
            return;
        }
        const emailData = validation.data;
        // ── Send email via Nodemailer ──
        // Dynamic import to keep the function bundle smaller.
        // Nodemailer is only loaded when this function actually runs.
        const nodemailer = await Promise.resolve().then(() => __importStar(require("nodemailer")));
        const transporter = nodemailer.createTransport({
            host: smtpHost.value(),
            port: parseInt(smtpPort.value(), 10) || 587,
            secure: parseInt(smtpPort.value(), 10) === 465, // true for 465, false for 587
            auth: {
                user: smtpUser.value(),
                pass: smtpPass.value(),
            },
        });
        const mailOptions = {
            from: smtpFrom.value(),
            to: emailData.to,
            subject: emailData.subject,
            [emailData.bodyType === "html" ? "html" : "text"]: emailData.body,
        };
        // Optional fields
        if (emailData.cc) {
            mailOptions.cc = emailData.cc;
        }
        if (emailData.bcc) {
            mailOptions.bcc = emailData.bcc;
        }
        if (emailData.replyTo) {
            mailOptions.replyTo = emailData.replyTo;
        }
        const info = await transporter.sendMail(mailOptions);
        console.log(`[sendEmail] Email sent by ${decodedToken.uid} to ${emailData.to} — ` +
            `Message-ID: ${info.messageId}`);
        const response = {
            success: true,
            message: "Email sent successfully.",
            messageId: info.messageId,
        };
        res.status(200).json(response);
    }
    catch (error) {
        console.error("[sendEmail] Error:", error);
        // Don't leak SMTP details to the client
        res.status(500).json({
            error: "Failed to send email. Please try again later.",
        });
    }
});
