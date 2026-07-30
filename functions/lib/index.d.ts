/**
 * Genco Export — Firebase Cloud Functions
 *
 * After migrating the React app to direct RTDB SDK access, most HTTP proxy
 * functions are no longer needed. This file now contains ONLY:
 *   1. Firebase Admin initialization (required for auth token verification)
 *   2. The sendEmail function (HTTP v2, for email sending)
 *   3. SMS sending is handled directly by the React app.
 *
 * All data reads/writes now happen directly from the client SDK.
 */
import * as admin from "firebase-admin";
/**
 * Helper to get the admin database instance.
 * Used by functions that need admin-level RTDB access.
 */
export declare const getDb: () => admin.database.Database;
export { sendEmail } from "./send-email";
