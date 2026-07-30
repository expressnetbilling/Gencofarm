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
exports.sendQueuedSms = void 0;
const admin = __importStar(require("firebase-admin"));
const firebase_functions_1 = require("firebase-functions");
const database_1 = require("firebase-functions/v2/database");
const DEFAULT_SMS_API_URL = "https://isms.celcomafrica.com/api/services/sendsms/";
const envValue = (...keys) => {
    for (const key of keys) {
        const value = process.env[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return "";
};
const getSmsConfig = () => {
    const apiKey = envValue("SMS_API_KEY", "VITE_SMS_API_KEY");
    const senderId = envValue("SMS_SENDER_ID", "VITE_SMS_SENDER_ID");
    const shortCode = envValue("SMS_SHORT_CODE", "SMS_SHORTCODE", "VITE_SMS_SHORT_CODE", "VITE_SMS_SHORTCODE");
    const apiUrl = envValue("SMS_API_URL", "VITE_SMS_API_URL") || DEFAULT_SMS_API_URL;
    const provider = envValue("SMS_PROVIDER", "VITE_SMS_PROVIDER").toLowerCase() === "generic" ? "generic" : "celcom";
    if (!apiKey || !senderId || !shortCode) {
        throw new Error("SMS_API_KEY, SMS_SENDER_ID, and SMS_SHORT_CODE must be set in the functions environment.");
    }
    return { apiUrl, apiKey, senderId, shortCode, provider };
};
const normalizeKenyanPhone = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw)
        return "";
    const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
    if (!digits || /^0+$/.test(digits))
        return "";
    if (digits.startsWith("254") && digits.length === 12)
        return digits;
    if (digits.startsWith("0") && digits.length === 10)
        return `254${digits.slice(1)}`;
    if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9)
        return `254${digits}`;
    return digits.length >= 9 ? digits : "";
};
const normalizeRecipients = (record) => {
    const rawRecipients = Array.isArray(record.recipients)
        ? record.recipients
        : [record.recipient, record.phone, record.to];
    return Array.from(new Set(rawRecipients.map(normalizeKenyanPhone).filter(Boolean)));
};
const parseProviderResponse = async (response) => {
    const text = await response.text();
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
};
const extractProviderMessageId = (body) => {
    if (!body || typeof body !== "object")
        return undefined;
    const data = body;
    return String(data.messageId ??
        data.message_id ??
        data["message-id"] ??
        data.requestId ??
        data.request_id ??
        data.responses?.[0]?.messageid ??
        data.responses?.[0]?.messageId ??
        "") || undefined;
};
const buildSmsPayload = (config, phone, message) => {
    if (config.provider === "generic") {
        return {
            apiKey: config.apiKey,
            api_key: config.apiKey,
            senderId: config.senderId,
            sender_id: config.senderId,
            shortCode: config.shortCode,
            shortcode: config.shortCode,
            to: phone,
            mobile: phone,
            message,
        };
    }
    return {
        partnerID: config.senderId,
        apikey: config.apiKey,
        mobile: phone,
        message,
        shortcode: config.shortCode,
        pass_type: "plain",
    };
};
const sendSingleSms = async (config, phone, message) => {
    try {
        const response = await fetch(config.apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildSmsPayload(config, phone, message)),
        });
        const body = await parseProviderResponse(response);
        return {
            phone,
            success: response.ok,
            statusCode: response.status,
            providerMessageId: extractProviderMessageId(body),
            response: body,
            error: response.ok ? undefined : `SMS provider returned HTTP ${response.status}`,
        };
    }
    catch (error) {
        return {
            phone,
            success: false,
            error: error instanceof Error ? error.message : "Unknown SMS provider error",
        };
    }
};
exports.sendQueuedSms = (0, database_1.onValueCreated)({
    ref: "/smsOutbox/{smsId}",
    region: "us-central1",
    timeoutSeconds: 540,
    maxInstances: 5,
}, async (event) => {
    const smsId = event.params.smsId;
    const record = (event.data.val() || {});
    const outboxRef = admin.database().ref(`smsOutbox/${smsId}`);
    if (record.status && record.status !== "pending") {
        firebase_functions_1.logger.info("[sendQueuedSms] Skipping non-pending SMS record", { smsId, status: record.status });
        return;
    }
    const message = String(record.message ?? "").trim();
    const recipients = normalizeRecipients(record);
    if (!message || recipients.length === 0) {
        await outboxRef.update({
            status: "failed",
            processedAt: Date.now(),
            error: !message ? "SMS message is required." : "At least one valid recipient is required.",
            normalizedRecipientCount: recipients.length,
        });
        return;
    }
    await outboxRef.update({
        status: "processing",
        processingStartedAt: Date.now(),
        normalizedRecipients: recipients,
        normalizedRecipientCount: recipients.length,
    });
    try {
        const config = getSmsConfig();
        const results = await Promise.all(recipients.map((phone) => sendSingleSms(config, phone, message)));
        const successCount = results.filter((result) => result.success).length;
        const failureCount = results.length - successCount;
        await outboxRef.update({
            status: failureCount === 0 ? "sent" : successCount > 0 ? "partial" : "failed",
            processedAt: Date.now(),
            sentAt: successCount > 0 ? Date.now() : null,
            successCount,
            failureCount,
            deliveryResults: results,
            senderId: config.senderId,
            shortCode: config.shortCode,
            provider: config.provider,
        });
        firebase_functions_1.logger.info("[sendQueuedSms] SMS outbox processed", {
            smsId,
            successCount,
            failureCount,
            sourcePage: record.sourcePage,
            createdBy: record.createdBy,
        });
    }
    catch (error) {
        const messageText = error instanceof Error ? error.message : "Unknown SMS configuration error";
        await outboxRef.update({
            status: "failed",
            processedAt: Date.now(),
            error: messageText,
        });
        firebase_functions_1.logger.error("[sendQueuedSms] Failed to process SMS outbox record", { smsId, error: messageText });
    }
});
