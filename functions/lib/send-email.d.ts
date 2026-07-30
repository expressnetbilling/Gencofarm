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
export declare const sendEmail: import("firebase-functions/v2/https").HttpsFunction;
