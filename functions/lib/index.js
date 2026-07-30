"use strict";
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
exports.sendEmail = exports.getDb = void 0;
const admin = __importStar(require("firebase-admin"));
// ---------------------------------------------------------------------------
// Admin SDK Initialization (singleton)
// ---------------------------------------------------------------------------
const app = admin.initializeApp();
/**
 * Helper to get the admin database instance.
 * Used by functions that need admin-level RTDB access.
 */
const getDb = () => admin.database();
exports.getDb = getDb;
// Re-export the sendEmail function from its own module
var send_email_1 = require("./send-email");
Object.defineProperty(exports, "sendEmail", { enumerable: true, get: function () { return send_email_1.sendEmail; } });
