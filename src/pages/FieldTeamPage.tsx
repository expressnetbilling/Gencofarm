import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Clock,
  Edit,
  Eye,
  FileCheck2,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import {
  canViewAllProgrammes,
  isAdmin,
  isHummanResourceManager,
  isMonitoringAndEvaluationOfficer,
  resolvePermissionPrincipal,
} from "@/contexts/authhelper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db, fetchCollection, push, ref, remove, set, update } from "@/lib/firebase";
import { sendEmail } from "@/lib/rtdb-operations";
import { normalizeProgramme, resolveAccessibleProgrammes, type ProgrammeOption } from "@/lib/programme-access";
import { useToast } from "@/hooks/use-toast";

type SavedFieldOfficerRow = {
  fieldOfficerName: string;
  totalLivestockFarmersRegistered: number;
  latestFarmerRegistered: string;
  latestFarmerLocation?: string;
  // Exact timestamp (ms) the most-recently-registered farmer was captured.
  latestFarmerRegisteredAt?: number;
  numberOfTraining: number;
  numberOfFarmersTrained: number;
  // Whether this field officer submitted a validation document for the period.
  validationDocumentSubmitted?: boolean;
};

type ReviewStatus = "pending" | "reviewed";

type FieldTeamReport = {
  id: string;
  reportId?: string;
  reportTitle?: string;
  programme?: string;
  reportDate: string;
  fromDate?: string;
  toDate?: string;
  weekStart: string;
  weekEnd: string;
  deadlineAt?: number;
  submittedAt?: number;
  submissionTime?: string;
  submittedTime?: string;
  submittedBy?: string;
  submittedByRole?: string;
  isLateSubmission?: boolean;
  submissionStatus?: "on-time" | "late";
  status?: ReviewStatus;
  reviewedAt?: number;
  reviewedBy?: string;
  records: SavedFieldOfficerRow[];
  totals?: {
    totalLivestockFarmersRegistered: number;
    numberOfTraining: number;
    numberOfFarmersTrained: number;
  };
};

type SourceFarmer = {
  id: string;
  name: string;
  location: string;
  officer: string;
  programme: string;
  timestamp: number;
};

type SourceTraining = {
  id: string;
  officer: string;
  programme: string;
  timestamp: number;
  totalFarmers: number;
  // FIX: whether the parent capacityBuilding record has a validation
  // document PDF attached (pdfUrl / validationDocumentPdfUrl / etc.).
  // This is the real, authoritative source of "submitted" status —
  // the separate "validationDocuments" collection is not being written
  // to by the app, so it was always empty.
  hasValidationDocument: boolean;
};

// A validation document uploaded/submitted by a field officer for a given
// programme. Sourced from the "validationDocuments" collection (kept as a
// secondary/fallback source in case that collection is used in future).
type SourceValidationDocument = {
  id: string;
  officer: string;
  programme: string;
  timestamp: number;
};

type UserDirectoryRecord = {
  id: string;
  name?: string;
  userName?: string;
  username?: string;
  displayName?: string;
  email?: string;
  role?: string;
  customAttribute?: string;
  accessControl?: {
    customAttribute?: string;
    customAttributes?: Record<string, unknown>;
  };
};

const UNKNOWN_OFFICER = "Unknown Officer";
const FIELD_TEAM_PATH = "fieldTeam";
const VALIDATION_DOCUMENTS_PATH = "validationDocuments";
const REPORT_ID_BY_PROGRAMME: Record<string, string> = {
  KPMD: "KPMD",
  RANGE: "RANGE",
  "KPMD 2": "KPMD2",
};

// FIX: same set of possible field names CapacityBuildingPage.tsx checks
// (getRecordPdfUrl) when it looks for an attached validation document PDF
// on a capacityBuilding record. Kept in sync with that file so both pages
// agree on what counts as "submitted".
const PDF_URL_FIELD_KEYS = [
  "pdfUrl",
  "pdfURL",
  "validationDocumentPdfUrl",
  "validationDocumentPdfURL",
  "validationDocumentUrl",
  "validationDocumentURL",
  "documentPdfUrl",
  "documentPdfURL",
  "pdfDownloadUrl",
  "pdfDownloadURL",
  "pdfLink",
  "pdfLINK",
  "PDFLink",
  "PDF_Link",
  "PDF link",
  "PDF Link",
  "Pdf Link",
  "Pdf_Link",
  "pdf_link",
  "downloadUrl",
  "downloadURL",
  "url",
  "uri",
];

const PDF_NESTED_PARENT_KEYS = ["pdfFile", "validationDocument", "validationDocumentPdf", "document", "file"];
const PDF_NESTED_CHILD_KEYS = ["url", "uri", "downloadUrl", "downloadURL", "pdfUrl", "pdfURL"];

// FIX: detects whether a raw capacityBuilding record has a validation
// document PDF attached to it, mirroring CapacityBuildingPage.tsx's
// getRecordPdfUrl logic so both pages treat "submitted" the same way.
const recordHasValidationDocument = (record: Record<string, unknown>): boolean => {
  for (const key of PDF_URL_FIELD_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return true;
  }

  for (const parentKey of PDF_NESTED_PARENT_KEYS) {
    const parent = record[parentKey];
    if (!parent || typeof parent !== "object") continue;
    const parentRecord = parent as Record<string, unknown>;
    for (const childKey of PDF_NESTED_CHILD_KEYS) {
      const value = parentRecord[childKey];
      if (typeof value === "string" && value.trim()) return true;
    }
  }

  return false;
};

const formatDateToLocal = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const parseLocalDate = (value: string): Date => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

const parseDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
      const [, year, month, day] = isoDateOnly;
      const parsed = new Date(Number(year), Number(month) - 1, Number(day));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const getTimestamp = (...values: unknown[]): number => {
  for (const value of values) {
    const parsed = parseDate(value);
    if (parsed) return parsed.getTime();
  }
  return 0;
};

const normalizeName = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const joinLocation = (...values: unknown[]): string =>
  values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .filter((value, index, allValues) => allValues.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
    .join(", ");

const getProgrammeValue = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = normalizeProgramme(value);
    if (normalized) return normalized;
  }
  return "";
};

const getReportId = (programme: string): string => REPORT_ID_BY_PROGRAMME[programme] || programme || "N/A";

const getInitialReportRange = () => {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return {
    fromDate: formatDateToLocal(monday),
    toDate: formatDateToLocal(friday),
  };
};

const getDateRange = (fromDateValue: string, toDateValue: string) => {
  const fromDate = parseLocalDate(fromDateValue || formatDateToLocal(new Date()));
  fromDate.setHours(0, 0, 0, 0);

  const toDate = parseLocalDate(toDateValue || fromDateValue || formatDateToLocal(new Date()));
  toDate.setHours(23, 59, 59, 999);

  const deadline = new Date(toDate);
  deadline.setHours(15, 0, 0, 0);

  return {
    fromDate: formatDateToLocal(fromDate),
    toDate: formatDateToLocal(toDate),
    startAt: fromDate.getTime(),
    endAt: toDate.getTime(),
    deadlineAt: deadline.getTime(),
    deadlineLabel: deadline.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
};

const getNextReportRange = (fromDateValue: string, toDateValue: string) => {
  const fromDate = parseLocalDate(fromDateValue);
  const toDate = parseLocalDate(toDateValue);
  const rangeLengthDays = Math.max(
    1,
    Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1,
  );

  const nextFrom = new Date(toDate);
  nextFrom.setDate(toDate.getDate() + 1);

  const nextTo = new Date(nextFrom);
  nextTo.setDate(nextFrom.getDate() + rangeLengthDays - 1);

  return {
    fromDate: formatDateToLocal(nextFrom),
    toDate: formatDateToLocal(nextTo),
  };
};

const formatTimestamp = (value: number | undefined): string => {
  if (!value) return "Not submitted";
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "Not submitted";

  return parsedDate.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Formats a timestamp down to the exact time (including seconds) for the
// "latest farmer registered" column, distinct from formatTimestamp above
// which is used for report-level submission/review timestamps.
const formatExactTime = (value: number | undefined): string => {
  if (!value) return "N/A";
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "N/A";

  return parsedDate.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const formatDate = (value: number | string | undefined): string => {
  const parsed = parseDate(value);
  if (!parsed) return "N/A";
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const getNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  return 0;
};

const computeTotals = (records: SavedFieldOfficerRow[]) =>
  records.reduce(
    (total, row) => ({
      totalLivestockFarmersRegistered:
        total.totalLivestockFarmersRegistered + getNumber(row.totalLivestockFarmersRegistered),
      numberOfTraining: total.numberOfTraining + getNumber(row.numberOfTraining),
      numberOfFarmersTrained: total.numberOfFarmersTrained + getNumber(row.numberOfFarmersTrained),
    }),
    {
      totalLivestockFarmersRegistered: 0,
      numberOfTraining: 0,
      numberOfFarmersTrained: 0,
    },
  );

// FIX: Firebase Realtime Database's set()/update() calls throw
// "value argument contains undefined" if ANY nested property is
// undefined (e.g. latestFarmerRegisteredAt is left undefined for an
// officer who only logged trainings, never registered a farmer). That
// exception was the actual cause of the recurring
// "field team report could not be saved" toast — it has nothing to do
// with permissions or network connectivity. Recursively strip out any
// key whose value is undefined before every push/set/update call.
const sanitizeForFirebase = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForFirebase(item)) as unknown as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entryValue]) => {
      if (entryValue === undefined) return; // drop the key entirely instead of writing "undefined"
      result[key] = sanitizeForFirebase(entryValue);
    });
    return result as T;
  }
  return value;
};

const getUserDirectoryAttribute = (record: UserDirectoryRecord): string => {
  const directAttribute = record.accessControl?.customAttribute;
  if (typeof directAttribute === "string" && directAttribute.trim()) return directAttribute.trim();

  const legacyAttributes = record.accessControl?.customAttributes;
  if (legacyAttributes && typeof legacyAttributes === "object") {
    const [firstAttribute] = Object.keys(legacyAttributes);
    if (firstAttribute) return firstAttribute;
  }

  return typeof record.customAttribute === "string" ? record.customAttribute.trim() : "";
};

const getUserDirectoryEmail = (record: UserDirectoryRecord): string =>
  typeof record.email === "string" ? record.email.trim() : "";

const getUserDirectoryName = (record: UserDirectoryRecord): string =>
  normalizeName(record.name, record.userName, record.username, record.displayName, record.email) || "HR";

const isHrDirectoryRecord = (record: UserDirectoryRecord): boolean => {
  const role = typeof record.role === "string" ? record.role : "";
  const attribute = getUserDirectoryAttribute(record);
  return isHummanResourceManager(resolvePermissionPrincipal(role, attribute));
};

const normalizeFarmerRecord = (record: Record<string, unknown> & { id: string }): SourceFarmer => ({
  id: record.id,
  name: normalizeName(record.name, record.farmerName, record.fullName) || "Unnamed farmer",
  location: joinLocation(record.county, record.subcounty, record.subCounty, record.location),
  officer:
    normalizeName(record.username, record.created_by, record.createdBy, record.fieldOfficer, record.officer) ||
    UNKNOWN_OFFICER,
  programme: getProgrammeValue(record.programme, record.Programme, record.program, record.Program),
  timestamp: getTimestamp(
    record.createdAt,
    record.created_at,
    record.registrationDate,
    record.registration_date,
    record.registeredAt,
    record.timestamp,
    record.date,
    record.Date,
  ),
});

const normalizeTrainingRecords = (record: Record<string, unknown> & { id: string }): SourceTraining[] => {
  const entries = Array.isArray(record.entries) ? (record.entries as Record<string, unknown>[]) : [];

  // FIX: the validation document PDF is attached at the record level
  // (top-level fields on the capacityBuilding record itself), not per
  // entry. So we compute this once per record and apply it to every
  // training row produced from that record.
  const hasValidationDocument = recordHasValidationDocument(record);

  if (entries.length > 0) {
    return entries.map((entry, index) => ({
      id: `${record.id}-${String(entry.id || index)}`,
      officer:
        normalizeName(entry.fieldOfficer, entry.username, record.fieldOfficer, record.username, record.createdBy) ||
        UNKNOWN_OFFICER,
      programme: getProgrammeValue(entry.programme, entry.Programme, record.programme, record.Programme),
      timestamp: getTimestamp(
        entry.startDateISO,
        entry.startDateLabel,
        entry.createdAt,
        record.startDate,
        record.createdAt,
        record.uploadedAtISO,
        record.generatedAt,
      ),
      totalFarmers: getNumber(entry.totalFarmers ?? record.totalFarmers),
      hasValidationDocument,
    }));
  }

  return [
    {
      id: record.id,
      officer:
        normalizeName(record.fieldOfficer, record.username, record.createdBy, record.created_by, record.officer) ||
        UNKNOWN_OFFICER,
      programme: getProgrammeValue(record.programme, record.Programme, record.program, record.Program),
      timestamp: getTimestamp(
        record.startDate,
        record.start_date,
        record.date,
        record.Date,
        record.createdAt,
        record.created_at,
        record.uploadedAtISO,
        record.generatedAt,
      ),
      totalFarmers: getNumber(record.totalFarmers ?? record.farmersTrained ?? record.participants),
      hasValidationDocument,
    },
  ];
};

// Normalizes a raw "validationDocuments" record into a flat, per-officer
// submission event. Kept as a secondary/fallback source in case that
// collection is populated in the future; the primary source of truth is
// now the pdf fields on the capacityBuilding records themselves (see
// recordHasValidationDocument above).
const normalizeValidationDocumentRecord = (
  record: Record<string, unknown> & { id: string },
): SourceValidationDocument => ({
  id: record.id,
  officer:
    normalizeName(
      record.fieldOfficer,
      record.username,
      record.createdBy,
      record.created_by,
      record.officer,
      record.submittedBy,
    ) || UNKNOWN_OFFICER,
  programme: getProgrammeValue(record.programme, record.Programme, record.program, record.Program),
  timestamp: getTimestamp(
    record.submittedAt,
    record.submitted_at,
    record.uploadedAt,
    record.uploaded_at,
    record.createdAt,
    record.created_at,
    record.date,
    record.Date,
  ),
});

const buildWeeklyRows = (
  farmers: SourceFarmer[],
  trainings: SourceTraining[],
  validationDocuments: SourceValidationDocument[],
  weekStartAt: number,
  weekEndAt: number,
  programme: string,
): SavedFieldOfficerRow[] => {
  const rows = new Map<
    string,
    SavedFieldOfficerRow & {
      latestFarmerTimestamp: number;
    }
  >();

  const getRow = (officer: string) => {
    const key = officer.trim() || UNKNOWN_OFFICER;
    if (!rows.has(key)) {
      rows.set(key, {
        fieldOfficerName: key,
        totalLivestockFarmersRegistered: 0,
        latestFarmerRegistered: "",
        latestFarmerLocation: "",
        latestFarmerRegisteredAt: undefined,
        latestFarmerTimestamp: 0,
        numberOfTraining: 0,
        numberOfFarmersTrained: 0,
        validationDocumentSubmitted: false,
      });
    }
    return rows.get(key)!;
  };

  farmers
    .filter(
      (farmer) =>
        farmer.timestamp >= weekStartAt &&
        farmer.timestamp <= weekEndAt &&
        farmer.programme === programme,
    )
    .forEach((farmer) => {
      const row = getRow(farmer.officer);
      row.totalLivestockFarmersRegistered += 1;
      if (farmer.timestamp >= row.latestFarmerTimestamp) {
        row.latestFarmerTimestamp = farmer.timestamp;
        row.latestFarmerRegistered = farmer.name;
        row.latestFarmerLocation = farmer.location;
        row.latestFarmerRegisteredAt = farmer.timestamp;
      }
    });

  trainings
    .filter(
      (training) =>
        training.timestamp >= weekStartAt &&
        training.timestamp <= weekEndAt &&
        training.programme === programme,
    )
    .forEach((training) => {
      const row = getRow(training.officer);
      row.numberOfTraining += 1;
      row.numberOfFarmersTrained += training.totalFarmers;
      // FIX: mark "submitted" if the capacityBuilding record behind this
      // training has an attached validation document PDF.
      if (training.hasValidationDocument) {
        row.validationDocumentSubmitted = true;
      }
    });

  // Secondary/fallback source: a dedicated "validationDocuments" collection,
  // if it's ever populated.
  validationDocuments
    .filter(
      (document) =>
        document.timestamp >= weekStartAt &&
        document.timestamp <= weekEndAt &&
        document.programme === programme,
    )
    .forEach((document) => {
      const row = getRow(document.officer);
      row.validationDocumentSubmitted = true;
    });

  return [...rows.values()]
    .map(({ latestFarmerTimestamp: _latestFarmerTimestamp, ...row }) => row)
    .sort((a, b) => a.fieldOfficerName.localeCompare(b.fieldOfficerName));
};

const normalizeSavedReport = (record: FieldTeamReport & { id: string }): FieldTeamReport => {
  const records = Array.isArray(record.records)
    ? record.records.map((row) => ({
        fieldOfficerName: row.fieldOfficerName || UNKNOWN_OFFICER,
        totalLivestockFarmersRegistered: getNumber(row.totalLivestockFarmersRegistered),
        latestFarmerRegistered: row.latestFarmerRegistered || "",
        latestFarmerLocation: row.latestFarmerLocation || "",
        latestFarmerRegisteredAt:
          typeof row.latestFarmerRegisteredAt === "number" ? row.latestFarmerRegisteredAt : undefined,
        numberOfTraining: getNumber(row.numberOfTraining),
        numberOfFarmersTrained: getNumber(row.numberOfFarmersTrained),
        validationDocumentSubmitted: Boolean(row.validationDocumentSubmitted),
      }))
    : [];

  return {
    id: record.id,
    reportId: record.reportId || getReportId(record.programme || ""),
    reportTitle: record.reportTitle || "",
    programme: normalizeProgramme(record.programme) || record.programme || "",
    reportDate:
      (record.submittedAt ? formatDateToLocal(new Date(record.submittedAt)) : "") ||
      record.reportDate ||
      "",
    fromDate: record.fromDate || record.weekStart || record.reportDate || "",
    toDate: record.toDate || record.weekEnd || record.reportDate || "",
    weekStart: record.weekStart || record.fromDate || "",
    weekEnd: record.weekEnd || record.toDate || "",
    deadlineAt: record.deadlineAt,
    submittedAt: record.submittedAt,
    submissionTime: record.submissionTime,
    submittedTime: record.submittedTime,
    submittedBy: record.submittedBy,
    submittedByRole: record.submittedByRole,
    isLateSubmission: Boolean(record.isLateSubmission),
    submissionStatus: record.submissionStatus || (record.isLateSubmission ? "late" : "on-time"),
    // Reports are "pending" HR review until an HR user opens them.
    status: record.status === "reviewed" ? "reviewed" : "pending",
    reviewedAt: record.reviewedAt,
    reviewedBy: record.reviewedBy,
    records,
    totals: record.totals || computeTotals(records),
  };
};

const FieldTeamPage = () => {
  const { user, userName, userRole, userAttribute, allowedProgrammes } = useAuth();
  const { toast } = useToast();
  const initialReportRange = useMemo(() => getInitialReportRange(), []);

  const [fromDate, setFromDate] = useState(initialReportRange.fromDate);
  const [toDate, setToDate] = useState(initialReportRange.toDate);
  const [reportTitle, setReportTitle] = useState("");
  const [selectedProgramme, setSelectedProgramme] = useState<ProgrammeOption | "">("");
  const [reports, setReports] = useState<FieldTeamReport[]>([]);
  const [farmers, setFarmers] = useState<SourceFarmer[]>([]);
  const [trainings, setTrainings] = useState<SourceTraining[]>([]);
  const [validationDocuments, setValidationDocuments] = useState<SourceValidationDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewingReport, setViewingReport] = useState<FieldTeamReport | null>(null);
  const [editingReport, setEditingReport] = useState<FieldTeamReport | null>(null);
  const [editRows, setEditRows] = useState<SavedFieldOfficerRow[]>([]);
  const [updating, setUpdating] = useState(false);

  // Filters for the "Submitted Field Team Reports" table below — filter by
  // the date the report was submitted, independent from the from/to range
  // used to compute a new report above.
  const [reportsFilterFromDate, setReportsFilterFromDate] = useState("");
  const [reportsFilterToDate, setReportsFilterToDate] = useState("");

  const permissionPrincipal = useMemo(
    () => resolvePermissionPrincipal(userRole, userAttribute),
    [userRole, userAttribute],
  );

  const userCanSubmitReport = useMemo(
    () => isAdmin(permissionPrincipal) || isMonitoringAndEvaluationOfficer(permissionPrincipal),
    [permissionPrincipal],
  );
  const userCanManageReports = useMemo(() => isAdmin(permissionPrincipal), [permissionPrincipal]);
  const userIsHr = useMemo(() => isHummanResourceManager(permissionPrincipal), [permissionPrincipal]);
  const userCanViewReports = useMemo(
    () => userCanSubmitReport || userIsHr,
    [userCanSubmitReport, userIsHr],
  );
  // Status + submitted-by columns are relevant to whoever can manage
  // (Admin) or review (HR) reports — not just Admin.
  const userCanViewReportMeta = useMemo(
    () => userCanManageReports || userIsHr,
    [userCanManageReports, userIsHr],
  );
  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute, allowedProgrammes),
    [allowedProgrammes, userAttribute, userRole],
  );
  const accessibleProgrammes = useMemo(
    () => resolveAccessibleProgrammes(userCanViewAllProgrammeData, allowedProgrammes),
    [allowedProgrammes, userCanViewAllProgrammeData],
  );

  useEffect(() => {
    if (selectedProgramme && accessibleProgrammes.includes(selectedProgramme)) return;
    setSelectedProgramme(accessibleProgrammes[0] || "");
  }, [accessibleProgrammes, selectedProgramme]);

  const reportRange = useMemo(() => getDateRange(fromDate, toDate), [fromDate, toDate]);
  const reportId = useMemo(() => getReportId(selectedProgramme), [selectedProgramme]);
  const isInvalidDateRange = reportRange.startAt > reportRange.endAt;

  const computedRows = useMemo(
    () =>
      isInvalidDateRange || !selectedProgramme
        ? []
        : buildWeeklyRows(
            farmers,
            trainings,
            validationDocuments,
            reportRange.startAt,
            reportRange.endAt,
            selectedProgramme,
          ),
    [
      farmers,
      trainings,
      validationDocuments,
      isInvalidDateRange,
      reportRange.endAt,
      reportRange.startAt,
      selectedProgramme,
    ],
  );

  const computedTotals = useMemo(() => computeTotals(computedRows), [computedRows]);

  const notifyHrFieldTeamReportSubmitted = async (params: {
    savedReportKey: string | null;
    submittedAt: number;
    isLateSubmission: boolean;
  }) => {
    try {
      const userRecords = await fetchCollection<UserDirectoryRecord>("users", { noDateFilter: true, limit: 1000 });
      const hrRecipients = userRecords
        .filter(isHrDirectoryRecord)
        .map((record) => ({
          email: getUserDirectoryEmail(record),
          name: getUserDirectoryName(record),
        }))
        .filter((record) => record.email);

      const uniqueRecipients = Array.from(
        new Map(hrRecipients.map((recipient) => [recipient.email.toLowerCase(), recipient])).values(),
      );

      if (uniqueRecipients.length === 0) {
        console.warn("No HR email recipients found for field team report notification.");
        toast({
          title: "HR email not sent",
          description: "No HR user with an email address was found.",
          variant: "destructive",
        });
        return;
      }

      const submittedBy = userName || user?.displayName || user?.email || "Unknown user";
      const submittedAtLabel = formatTimestamp(params.submittedAt);
      const subject = `${reportId} field team report submitted for HR review`;
      const body = [
        "A field team report has been submitted and is ready for HR review.",
        "",
        `Report ID: ${reportId}`,
        `Report title: ${reportTitle || "N/A"}`,
        `Programme: ${selectedProgramme}`,
        `Date range: ${reportRange.fromDate} to ${reportRange.toDate}`,
        `Submitted by: ${submittedBy}`,
        `Submitted at: ${submittedAtLabel}`,
        `Submission status: ${params.isLateSubmission ? "Late" : "On time"}`,
        `Report record key: ${params.savedReportKey || "N/A"}`,
        "",
        "Totals",
        `Livestock farmers registered: ${computedTotals.totalLivestockFarmersRegistered.toLocaleString()}`,
        `Training sessions: ${computedTotals.numberOfTraining.toLocaleString()}`,
        `Farmers trained: ${computedTotals.numberOfFarmersTrained.toLocaleString()}`,
      ].join("\n");

      const results = await Promise.allSettled(
        uniqueRecipients.map((recipient) =>
          sendEmail(recipient.email, subject, body, {
            bodyType: "plain",
            replyTo: user?.email || undefined,
          }),
        ),
      );

      const failedCount = results.filter((result) => result.status === "rejected").length;
      if (failedCount > 0) {
        console.warn(`Failed to notify ${failedCount} HR recipient(s) about the field team report.`);
        toast({
          title: "HR email partially failed",
          description: `${uniqueRecipients.length - failedCount} of ${uniqueRecipients.length} HR email(s) were sent.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to notify HR about field team report:", error);
      toast({
        title: "HR email failed",
        description: "The report was saved, but HR could not be emailed.",
        variant: "destructive",
      });
    }
  };

  const submittedReports = useMemo(
    () =>
      reports.filter((report) => {
        const reportProgramme = normalizeProgramme(report.programme);
        return accessibleProgrammes.length === 0 || !report.programme || (reportProgramme !== "" && accessibleProgrammes.includes(reportProgramme));
      }),
    [accessibleProgrammes, reports],
  );

  // Applies the "From"/"To" date filter above the submitted-reports table,
  // matching against each report's actual submission date.
  const dateFilteredReports = useMemo(() => {
    if (!reportsFilterFromDate && !reportsFilterToDate) return submittedReports;

    const rangeStart = reportsFilterFromDate ? parseLocalDate(reportsFilterFromDate).getTime() : -Infinity;
    let rangeEnd = Infinity;
    if (reportsFilterToDate) {
      const endOfDay = parseLocalDate(reportsFilterToDate);
      endOfDay.setHours(23, 59, 59, 999);
      rangeEnd = endOfDay.getTime();
    }

    return submittedReports.filter((report) => {
      const reportTime = report.submittedAt || parseDate(report.reportDate)?.getTime() || 0;
      return reportTime >= rangeStart && reportTime <= rangeEnd;
    });
  }, [submittedReports, reportsFilterFromDate, reportsFilterToDate]);

  const loadReports = async () => {
    const records = await fetchCollection<FieldTeamReport>(FIELD_TEAM_PATH, { noDateFilter: true, limit: 1000 });
    const mappedReports = records
      .map((record) => normalizeSavedReport(record as FieldTeamReport & { id: string }))
      .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));

    setReports(mappedReports);
  };

  const loadSourceData = async () => {
    const [farmerRecords, capacityRecords, validationRecords] = await Promise.all([
      fetchCollection<Record<string, unknown>>("farmers", { noDateFilter: true, limit: 10000 }),
      fetchCollection<Record<string, unknown>>("capacityBuilding", { noDateFilter: true, limit: 10000 }),
      // Validation documents are optional: if the path doesn't exist yet or
      // security rules haven't been updated for it, don't let that take
      // down the farmers/trainings load — just show no validation data.
      fetchCollection<Record<string, unknown>>(VALIDATION_DOCUMENTS_PATH, { noDateFilter: true, limit: 10000 }).catch(
        (error) => {
          console.warn("Failed to load validation documents (non-fatal):", error);
          return [] as Record<string, unknown>[];
        },
      ),
    ]);

    setFarmers(farmerRecords.map((record) => normalizeFarmerRecord(record)));
    setTrainings(capacityRecords.flatMap((record) => normalizeTrainingRecords(record)));
    setValidationDocuments(validationRecords.map((record) => normalizeValidationDocumentRecord(record)));
  };

  const refreshAllData = async () => {
    try {
      setLoading(true);
      setSourceLoading(true);
      await Promise.all([userCanViewReports ? loadReports() : Promise.resolve(), userCanSubmitReport ? loadSourceData() : Promise.resolve()]);
    } catch (error) {
      console.error("Failed to load field team data:", error);
      toast({
        title: "Error",
        description: "Failed to load field team data.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setSourceLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setSourceLoading(true);

        const [reportRecords, farmerRecords, capacityRecords, validationRecords] = await Promise.all([
          userCanViewReports
            ? fetchCollection<FieldTeamReport>(FIELD_TEAM_PATH, { noDateFilter: true, limit: 1000 })
            : Promise.resolve([]),
          userCanSubmitReport
            ? fetchCollection<Record<string, unknown>>("farmers", { noDateFilter: true, limit: 10000 })
            : Promise.resolve([]),
          userCanSubmitReport
            ? fetchCollection<Record<string, unknown>>("capacityBuilding", { noDateFilter: true, limit: 10000 })
            : Promise.resolve([]),
          userCanSubmitReport
            ? fetchCollection<Record<string, unknown>>(VALIDATION_DOCUMENTS_PATH, {
                noDateFilter: true,
                limit: 10000,
              }).catch((error) => {
                // Optional collection: don't let a missing path or denied
                // security rule break farmers/trainings/reports loading.
                console.warn("Failed to load validation documents (non-fatal):", error);
                return [] as Record<string, unknown>[];
              })
            : Promise.resolve([]),
        ]);

        if (cancelled) return;

        setReports(
          reportRecords
            .map((record) => normalizeSavedReport(record as FieldTeamReport & { id: string }))
            .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)),
        );
        setFarmers(farmerRecords.map((record) => normalizeFarmerRecord(record)));
        setTrainings(capacityRecords.flatMap((record) => normalizeTrainingRecords(record)));
        setValidationDocuments(validationRecords.map((record) => normalizeValidationDocumentRecord(record)));
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load field team data:", error);
        toast({
          title: "Error",
          description: "Failed to load field team data.",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSourceLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [toast, userCanSubmitReport, userCanViewReports]);

  const handleSubmitReport = async () => {
    if (!userCanSubmitReport) {
      toast({
        title: "Unauthorized",
        description: "Only Admin or M&E can submit field reports.",
        variant: "destructive",
      });
      return;
    }

    if (!reportTitle.trim()) {
      toast({
        title: "Report title required",
        description: "Enter a title for this report before submitting.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedProgramme) {
      toast({
        title: "Select report ID",
        description: "Choose KPMD, RANGE, or KPMD2 before submitting.",
        variant: "destructive",
      });
      return;
    }

    if (isInvalidDateRange) {
      toast({
        title: "Invalid date range",
        description: "The From date must be before or equal to the To date.",
        variant: "destructive",
      });
      return;
    }

    if (computedRows.length === 0) {
      toast({
        title: "No records",
        description: "No farmer or capacity-building activity was found for the selected dates and report ID.",
        variant: "destructive",
      });
      return;
    }

    const submittedAt = Date.now();
    const submittedDate = new Date(submittedAt);
    const submittedDateValue = formatDateToLocal(submittedDate);
    const isLateSubmission = submittedAt > reportRange.deadlineAt;

    try {
      setSaving(true);
      const newReportRef = await push(ref(db, FIELD_TEAM_PATH));

      // FIX: sanitize computedRows before writing — Firebase RTDB's set()
      // rejects the entire write if any nested field (e.g.
      // latestFarmerRegisteredAt for an officer with no farmer
      // registrations yet) is undefined. This was the root cause of the
      // recurring "field team report could not be saved" error.
      const payload = sanitizeForFirebase({
        reportId,
        reportTitle: reportTitle.trim(),
        programme: selectedProgramme,
        reportDate: submittedDateValue,
        fromDate: reportRange.fromDate,
        toDate: reportRange.toDate,
        weekStart: reportRange.fromDate,
        weekEnd: reportRange.toDate,
        deadlineAt: reportRange.deadlineAt,
        submittedAt,
        submissionTime: submittedDate.toISOString(),
        submittedTime: submittedDate.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        isLateSubmission,
        submissionStatus: isLateSubmission ? "late" : "on-time",
        // New reports always start out awaiting HR review.
        status: "pending",
        reviewedAt: null,
        reviewedBy: null,
        submittedBy: userName || user?.displayName || user?.email || "Unknown user",
        submittedByRole: permissionPrincipal || "unknown",
        submittedByUid: user?.uid || "",
        sourceCollections: ["farmers", "capacityBuilding", VALIDATION_DOCUMENTS_PATH],
        records: computedRows,
        totals: computedTotals,
      });

      await set(ref(db, `${FIELD_TEAM_PATH}/${newReportRef.key}`), payload);

      await notifyHrFieldTeamReportSubmitted({
        savedReportKey: newReportRef.key,
        submittedAt,
        isLateSubmission,
      });

      await loadReports();
      const nextRange = getNextReportRange(reportRange.fromDate, reportRange.toDate);
      setFromDate(nextRange.fromDate);
      setToDate(nextRange.toDate);
      setReportTitle("");

      toast({
        title: isLateSubmission ? "Late report submitted" : "Report submitted",
        description: `${reportId} field report for ${reportRange.fromDate} to ${reportRange.toDate} has been saved.`,
      });
    } catch (error) {
      console.error("Failed to submit field team report:", error);
      toast({
        title: "Submission failed",
        description:
          error instanceof Error
            ? `The field team report could not be saved: ${error.message}`
            : "The field team report could not be saved. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Opens a report for viewing. If an HR user opens a report that is still
  // "pending", it is automatically marked as "reviewed" (Admin/HR visibility).
  const handleViewReport = async (report: FieldTeamReport) => {
    setViewingReport(report);

    if (!userIsHr || report.status === "reviewed") return;

    const reviewedAt = Date.now();
    const reviewedBy = userName || user?.displayName || user?.email || "Unknown user";

    try {
      await update(ref(db, `${FIELD_TEAM_PATH}/${report.id}`), {
        status: "reviewed",
        reviewedAt,
        reviewedBy,
      });

      setReports((currentReports) =>
        currentReports.map((currentReport) =>
          currentReport.id === report.id
            ? { ...currentReport, status: "reviewed", reviewedAt, reviewedBy }
            : currentReport,
        ),
      );
      setViewingReport((currentReport) =>
        currentReport && currentReport.id === report.id
          ? { ...currentReport, status: "reviewed", reviewedAt, reviewedBy }
          : currentReport,
      );
    } catch (error) {
      console.error("Failed to mark field team report as reviewed:", error);
    }
  };

  const openEditReport = (report: FieldTeamReport) => {
    setEditingReport(report);
    setEditRows(report.records.map((row) => ({ ...row })));
  };

  const updateEditRow = (
    index: number,
    key: keyof SavedFieldOfficerRow,
    value: string,
  ) => {
    setEditRows((currentRows) =>
      currentRows.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return {
          ...row,
          [key]:
            key === "fieldOfficerName" || key === "latestFarmerRegistered" || key === "latestFarmerLocation"
              ? value
              : getNumber(value),
        };
      }),
    );
  };

  const updateEditRowValidationStatus = (index: number, value: boolean) => {
    setEditRows((currentRows) =>
      currentRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, validationDocumentSubmitted: value } : row,
      ),
    );
  };

  const handleUpdateReport = async () => {
    if (!editingReport || !userCanManageReports) return;

    const cleanedRows = editRows
      .map((row) => ({
        fieldOfficerName: row.fieldOfficerName.trim() || UNKNOWN_OFFICER,
        totalLivestockFarmersRegistered: getNumber(row.totalLivestockFarmersRegistered),
        latestFarmerRegistered: row.latestFarmerRegistered.trim(),
        latestFarmerLocation: row.latestFarmerLocation?.trim() || "",
        latestFarmerRegisteredAt: row.latestFarmerRegisteredAt,
        numberOfTraining: getNumber(row.numberOfTraining),
        numberOfFarmersTrained: getNumber(row.numberOfFarmersTrained),
        validationDocumentSubmitted: Boolean(row.validationDocumentSubmitted),
      }))
      .filter((row) => row.fieldOfficerName);

    try {
      setUpdating(true);
      // FIX: same undefined-stripping treatment as handleSubmitReport —
      // latestFarmerRegisteredAt can be undefined here too.
      await update(
        ref(db, `${FIELD_TEAM_PATH}/${editingReport.id}`),
        sanitizeForFirebase({
          records: cleanedRows,
          totals: computeTotals(cleanedRows),
          updatedAt: Date.now(),
          updatedBy: userName || user?.displayName || user?.email || "Unknown user",
          updatedByRole: permissionPrincipal || "unknown",
        }),
      );

      setEditingReport(null);
      setEditRows([]);
      await loadReports();
      toast({ title: "Report updated", description: "The saved field team report has been updated." });
    } catch (error) {
      console.error("Failed to update field team report:", error);
      toast({
        title: "Update failed",
        description:
          error instanceof Error
            ? `The saved report could not be updated: ${error.message}`
            : "The saved report could not be updated.",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteReport = async (report: FieldTeamReport) => {
    if (!userCanManageReports) return;
    const confirmed = window.confirm(`Delete ${report.reportId || "field team"} report for ${report.fromDate || report.weekStart} to ${report.toDate || report.weekEnd}?`);
    if (!confirmed) return;

    try {
      await remove(ref(db, `${FIELD_TEAM_PATH}/${report.id}`));
      await loadReports();
      toast({ title: "Report deleted", description: "The field team report has been deleted." });
    } catch (error) {
      console.error("Failed to delete field team report:", error);
      toast({
        title: "Delete failed",
        description: "The field team report could not be deleted.",
        variant: "destructive",
      });
    }
  };

  if (!userCanViewReports) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Field reports are available to Admin, M&E, and Human Resource Manager users only.
      </div>
    );
  }

  // Table used both for the "Computed Field Officer Records" preview and
  // inside the "View" dialog. Tightened vertical padding + widened
  // horizontal padding per design feedback so rows read as compact but
  // not cramped, with no cell text wrapping into a paragraph.
  const ReportRowsTable = ({ records }: { records: SavedFieldOfficerRow[] }) => (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
            <th className="whitespace-nowrap px-6 py-2 text-[9px] font-medium">Field officer</th>
            <th className="whitespace-nowrap px-6 py-2 text-[9px] font-medium">Farmers registered</th>
            <th className="whitespace-nowrap px-6 py-2 text-[9px] font-medium">Latest registered</th>
            <th className="whitespace-nowrap px-6 py-2 text-[9px] font-medium">Location</th>
            <th className="whitespace-nowrap px-6 py-2 text-[9px] font-medium">Registered at</th>
            <th className="whitespace-nowrap px-6 py-2 text-[9px] font-medium">No of Training</th>
            <th className="whitespace-nowrap px-6 py-2 text-[9px] font-medium">Trained Farmers</th>
            <th className="whitespace-nowrap px-6 py-2 text-[9px] font-medium">Validation Doc</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => (
            <tr key={`${record.fieldOfficerName}-${index}`} className="border-b border-slate-100 last:border-b-0">
              <td className="whitespace-nowrap px-6 py-1.5 font-medium text-slate-800">{record.fieldOfficerName}</td>
              <td className="whitespace-nowrap px-6 py-1.5 text-slate-700">
                {record.totalLivestockFarmersRegistered.toLocaleString()}
              </td>
              <td className="whitespace-nowrap px-6 py-1.5 text-slate-700">{record.latestFarmerRegistered || "N/A"}</td>
              <td className="whitespace-nowrap px-6 py-1.5 text-slate-700">{record.latestFarmerLocation || "N/A"}</td>
              <td className="whitespace-nowrap px-6 py-1.5 text-slate-700">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-slate-400" />
                  {formatExactTime(record.latestFarmerRegisteredAt)}
                </span>
              </td>
              <td className="whitespace-nowrap px-6 py-1.5 text-slate-700">{record.numberOfTraining.toLocaleString()}</td>
              <td className="whitespace-nowrap px-6 py-1.5 text-slate-700">{record.numberOfFarmersTrained.toLocaleString()}</td>
              <td className="whitespace-nowrap px-6 py-1.5">
                <Badge
                  variant="outline"
                  className={
                    record.validationDocumentSubmitted
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-red-200 bg-red-50 text-red-700"
                  }
                >
                  {record.validationDocumentSubmitted ? "Submitted" : "Not submitted"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-row items-center gap-4 lg:justify-between w-full">
           <p className="text-xs font-medium uppercase tracking-wide text-green-700">Field Report</p>

          {/* From/To filters for the "Submitted Field Team Reports" table
              below, plus a clear-filter button — kept at the top of this
              card so they're visible to everyone who can view reports
              (Admin, M&E, and HR), not just those who can submit one. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-2/3">
            <div className="space-y-1">
             
              <Input
                id="reports-filter-from"
                type="date"
                value={reportsFilterFromDate}
                onChange={(event) => setReportsFilterFromDate(event.target.value)}
                className="bg-white text-sm"
              />
            </div>
            <div className="space-y-1">
              
              <Input
                id="reports-filter-to"
                type="date"
                value={reportsFilterToDate}
                onChange={(event) => setReportsFilterToDate(event.target.value)}
                className="bg-white text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setReportsFilterFromDate("");
                  setReportsFilterToDate("");
                }}
                disabled={!reportsFilterFromDate && !reportsFilterToDate}
              >
                Clear filter
              </Button>
            </div>
          </div>
        </div>
      </section>

      {userCanSubmitReport && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="space-y-2">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <FileCheck2 className="h-5 w-5 text-green-600" />
                <p className="text-sm fonts-medium">Computed Field Officer Records</p>
              </CardTitle>
              <Button type="button" variant="outline" onClick={refreshAllData} disabled={sourceLoading || saving}>
                {sourceLoading ? (
                  <Loader2 className="mr-2 h-3 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                <p className="text-sm font-medium"></p>Refresh Source Data
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
              <div className="space-y-2">
                <Input
                  id="field-team-report-title"
                  type="text"
                  placeholder="Report Title"
                  value={reportTitle}
                  onChange={(event) => setReportTitle(event.target.value)}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Input
                  id="field-team-from-date"
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Input
                  id="field-team-to-date"
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Select
                  value={selectedProgramme}
                  onValueChange={(value) => setSelectedProgramme(normalizeProgramme(value))}
                  disabled={accessibleProgrammes.length === 0}
                >
                  <SelectTrigger id="field-team-report-id" className="bg-white">
                    <SelectValue placeholder="Select report ID" />
                  </SelectTrigger>
                  <SelectContent>
                    {accessibleProgrammes.map((programme) => (
                      <SelectItem key={programme} value={programme}>
                        {getReportId(programme)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isInvalidDateRange && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                The From date must be before or equal to the To date.
              </div>
            )}
          </CardHeader>

          <CardContent className="space-y-4">
            {sourceLoading ? (
              <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Computing field team report...
                </div>
              </div>
            ) : computedRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                No farmer or capacity-building records were found for the selected dates and report ID.
              </div>
            ) : (
              <ReportRowsTable records={computedRows} />
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                className="bg-green-600 text-white hover:bg-green-700"
                onClick={handleSubmitReport}
                disabled={saving || sourceLoading || computedRows.length === 0 || isInvalidDateRange || !selectedProgramme || !reportTitle.trim()}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Submit Report
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="space-y-3">
          <CardTitle className="flex items-center gap-2 text-slate-900">
            {userIsHr ? (
              <ShieldCheck className="h-5 w-5 text-blue-600" />
            ) : (
              <Users className="h-5 w-5 text-blue-600" />
            )}
           <p className="text-sm font-semibold">Submitted Field Team Reports</p>
          </CardTitle>
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <CalendarDays className="h-4 w-4" />
            {dateFilteredReports.length.toLocaleString()} submitted report{dateFilteredReports.length === 1 ? "" : "s"}
          </p>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex min-h-[220px] items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading field team reports...
              </div>
            </div>
          ) : dateFilteredReports.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              {submittedReports.length === 0
                ? "No submitted field team report exists yet."
                : "No submitted field team reports match the selected date range."}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <th className="px-5 py-2 font-medium text-[10px]">Date</th>
                    <th className="px-5 py-2 font-medium text-[10px]">Report ID</th>
                    <th className="px-5 py-2 font-medium text-[10px]">Submitted by</th>
                    {userCanViewReportMeta && (
                      <th className="px-5 py-2 font-medium text-[10px]">Status</th>
                    )}
                    <th className="px-5 py-2 font-medium text-[10px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dateFilteredReports.map((report) => (
                    <tr key={report.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-5 py-1.5 text-slate-800">
                        {formatDate(report.reportDate)}
                      </td>
                      <td className="px-5 py-1.5 text-slate-700">
                        {report.reportTitle || "Untitled report"}
                      </td>
                      <td className="px-5 py-1.5 text-slate-700">
                        {report.submittedBy || "Unknown user"}
                      </td>
                      {userCanViewReportMeta && (
                        <td className="px-5 py-1.5">
                          <Badge
                            variant="outline"
                            className={
                              report.status === "reviewed"
                                ? "border-green-200 bg-green-50 text-green-700"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                            }
                          >
                            {report.status === "reviewed" ? "Reviewed" : "Pending"}
                          </Badge>
                        </td>
                      )}
                      <td className="px-5 py-1.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              <MoreHorizontal className="mr-2 h-4 w-4" />
                              
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-white">
                            <DropdownMenuItem onClick={() => handleViewReport(report)}>
                              <Eye className="mr-2 h-4 w-4" />
                              View
                            </DropdownMenuItem>
                            {userCanManageReports && (
                              <>
                                <DropdownMenuItem onClick={() => openEditReport(report)}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-700"
                                  onClick={() => handleDeleteReport(report)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(viewingReport)} onOpenChange={(open) => !open && setViewingReport(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Field Team Report Details</DialogTitle>
          </DialogHeader>
          {viewingReport && (
            <div className="space-y-4">
              {/* Summary info as small, presentable cards instead of a
                  cramped inline grid of plain text. */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Card className="border-slate-200 shadow-none">
                  <CardContent className="p-3">
                    <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Report title</p>
                    <p className="mt-1 text-xs font-medium text-slate-900">
                      {viewingReport.reportTitle || "Untitled report"}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-slate-200 shadow-none">
                  <CardContent className="p-3">
                    <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Report date</p>
                    <p className="mt-1 text-xs font-medium text-slate-900">{formatDate(viewingReport.reportDate)}</p>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-none">
                  <CardContent className="p-3">
                    <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Submitted</p>
                    <p className="mt-1 text-xs font-medium text-slate-900">{formatTimestamp(viewingReport.submittedAt)}</p>
                  </CardContent>
                </Card>
                <Card className="border-slate-200 shadow-none">
                  <CardContent className="p-3">
                    <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Submitted by</p>
                    <p className="mt-1 text-xs font-medium text-slate-900">{viewingReport.submittedBy || "Unknown user"}</p>
                  </CardContent>
                </Card>
              </div>
              <ReportRowsTable records={viewingReport.records} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingReport)} onOpenChange={(open) => !open && setEditingReport(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Edit Saved Field Team Report</DialogTitle>
          </DialogHeader>
          {editingReport && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Editing updates the saved `fieldTeam` report only. Source farmers, capacity-building, and validation
                document records are not changed.
              </p>
              <div className="space-y-3">
                {editRows.map((row, index) => (
                  <div key={`${row.fieldOfficerName}-${index}`} className="rounded-xl border border-slate-200 p-4">
                    <div className="grid gap-4 lg:grid-cols-[1.2fr,1fr,1.1fr,0.8fr,0.9fr,1fr]">
                      <div className="space-y-2">
                        <Label>Field officer</Label>
                        <Input
                          value={row.fieldOfficerName}
                          onChange={(event) => updateEditRow(index, "fieldOfficerName", event.target.value)}
                          disabled={updating}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Farmers registered</Label>
                        <Input
                          type="number"
                          min="0"
                          value={row.totalLivestockFarmersRegistered}
                          onChange={(event) => updateEditRow(index, "totalLivestockFarmersRegistered", event.target.value)}
                          disabled={updating}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Latest farmer registered</Label>
                        <Input
                          value={row.latestFarmerRegistered}
                          onChange={(event) => updateEditRow(index, "latestFarmerRegistered", event.target.value)}
                          disabled={updating}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Latest farmer location</Label>
                        <Input
                          value={row.latestFarmerLocation || ""}
                          onChange={(event) => updateEditRow(index, "latestFarmerLocation", event.target.value)}
                          disabled={updating}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Registered at</Label>
                        <p className="flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600">
                          <Clock className="h-3 w-3 text-slate-400" />
                          {formatExactTime(row.latestFarmerRegisteredAt)}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Number of training</Label>
                        <Input
                          type="number"
                          min="0"
                          value={row.numberOfTraining}
                          onChange={(event) => updateEditRow(index, "numberOfTraining", event.target.value)}
                          disabled={updating}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Farmers Trained</Label>
                        <Input
                          type="number"
                          min="0"
                          value={row.numberOfFarmersTrained}
                          onChange={(event) => updateEditRow(index, "numberOfFarmersTrained", event.target.value)}
                          disabled={updating}
                        />
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      <Label>Validation document</Label>
                      <Select
                        value={row.validationDocumentSubmitted ? "submitted" : "not-submitted"}
                        onValueChange={(value) => updateEditRowValidationStatus(index, value === "submitted")}
                        disabled={updating}
                      >
                        <SelectTrigger className="bg-white sm:w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="submitted">Submitted</SelectItem>
                          <SelectItem value="not-submitted">Not submitted</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditingReport(null)} disabled={updating}>
              Cancel
            </Button>
            <Button type="button" className="bg-green-600 text-white hover:bg-green-700" onClick={handleUpdateReport} disabled={updating || !userCanManageReports}>
              {updating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FieldTeamPage;