type SmsConfig = {
  apiKey: string;
  partnerId: string;
  shortCode: string;
  sendUrl: string;
  balanceUrl: string;
};

export type SmsSendResult = {
  phone: string;
  success: boolean;
  statusCode: number;
  response: unknown;
  error?: string;
};

export type SmsBatchResult = {
  successCount: number;
  failureCount: number;
  results: SmsSendResult[];
};

const DEFAULT_SEND_URL = "https://isms.celcomafrica.com/api/services/sendsms/";
const DEFAULT_BALANCE_URL = "https://isms.celcomafrica.com/api/services/getbalance/";

const getEnvValue = (...keys: string[]): string => {
  const env = import.meta.env as Record<string, string | undefined>;
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const getSmsConfig = (): SmsConfig => {
  const apiKey = getEnvValue("VITE_ROAMTECH_API_KEY", "ROAMTECH_API_KEY");
  const partnerId = getEnvValue("VITE_ROAMTECH_PARTNER_ID", "ROAMTECH_PARTNER_ID");
  const shortCode = getEnvValue("VITE_SHORTCODE", "SHORTCODE", "VITE_ROAMTECH_SHORTCODE");
  const sendUrl = getEnvValue("VITE_ROAMTECH_SMS_URL") || DEFAULT_SEND_URL;
  const balanceUrl = getEnvValue("VITE_ROAMTECH_BALANCE_URL") || DEFAULT_BALANCE_URL;

  if (!apiKey || !partnerId || !shortCode) {
    throw new Error("SHORTCODE, ROAMTECH_API_KEY, and ROAMTECH_PARTNER_ID must be set in .env.");
  }

  return { apiKey, partnerId, shortCode, sendUrl, balanceUrl };
};

export const normalizeKenyanPhone = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!digits || /^0+$/.test(digits)) return "";

  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return `254${digits}`;

  return digits.length >= 9 ? digits : "";
};

const parseSmsResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const responseIndicatesSuccess = (body: unknown): boolean => {
  if (!body || typeof body !== "object") return false;
  const data = body as Record<string, any>;
  const responses = Array.isArray(data.responses) ? data.responses : [];
  if (responses.length === 0) return false;
  return responses.every((item) => {
    const code = String(item?.["respose-code"] ?? item?.["response-code"] ?? item?.code ?? "");
    const description = String(item?.["response-description"] ?? item?.description ?? "").toLowerCase();
    return code === "200" || description.includes("success");
  });
};

export const sendSms = async (phone: string, message: string): Promise<SmsSendResult> => {
  const config = getSmsConfig();
  const normalizedPhone = normalizeKenyanPhone(phone);
  const cleanMessage = message.trim();

  if (!normalizedPhone) {
    return { phone: String(phone || ""), success: false, statusCode: 0, response: null, error: "Invalid phone number." };
  }

  if (!cleanMessage) {
    return { phone: normalizedPhone, success: false, statusCode: 0, response: null, error: "SMS message is required." };
  }

  try {
    const response = await fetch(config.sendUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: config.apiKey,
        partnerID: config.partnerId,
        mobile: normalizedPhone,
        message: cleanMessage,
        shortcode: config.shortCode,
        pass_type: "plain",
      }),
    });

    const body = await parseSmsResponse(response);
    const success = response.ok && (responseIndicatesSuccess(body) || !body);

    return {
      phone: normalizedPhone,
      success,
      statusCode: response.status,
      response: body,
      error: success ? undefined : `SMS provider rejected the message for ${normalizedPhone}.`,
    };
  } catch (error) {
    return {
      phone: normalizedPhone,
      success: false,
      statusCode: 0,
      response: null,
      error: error instanceof Error ? error.message : "Unknown SMS error.",
    };
  }
};

export const sendBulkSms = async (phones: unknown[], message: string): Promise<SmsBatchResult> => {
  const uniquePhones = Array.from(new Set(phones.map(normalizeKenyanPhone).filter(Boolean)));
  const results = await Promise.all(uniquePhones.map((phone) => sendSms(phone, message)));
  const successCount = results.filter((result) => result.success).length;
  return {
    successCount,
    failureCount: results.length - successCount,
    results,
  };
};

export const getSmsBalance = async (): Promise<unknown> => {
  const config = getSmsConfig();
  const response = await fetch(config.balanceUrl, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apikey: config.apiKey,
      partnerID: config.partnerId,
    }),
  });

  const body = await parseSmsResponse(response);
  if (!response.ok) {
    throw new Error(`SMS balance request failed with HTTP ${response.status}.`);
  }

  return body;
};

