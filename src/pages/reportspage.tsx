import * as React from "react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  canViewAllProgrammes,
  isHummanResourceManager,
  isProjectManager,
  resolvePermissionPrincipal,
} from "@/contexts/authhelper";
import { db, ref, push, update, remove, fetchCollectionByProgrammes, invalidateCollectionCache } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area,
  LineChart, Line, RadialBarChart,RadialBar,PolarGrid,PolarAngleAxis,PolarRadiusAxis
} from "recharts";

import { 
  Users, GraduationCap, Beef, TrendingUp, Award, 
  MapPin, Syringe, TargetIcon, Loader2, Calendar, PencilLine, Trash2, UserX, MoreVertical, ChevronLeft, ChevronRight, Clock, Package, ShoppingCart, Warehouse, Droplets, ClipboardList
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DashboardInsights } from "@/components/DashboardInsights";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSharedProgrammeSelection } from "@/hooks/use-shared-programme-selection";
import { toast } from "@/hooks/use-toast";
import { fetchAnalysisSummary } from "@/lib/analysis";
import { fetchCollectionsBatch } from "@/lib/firebase";
import {
  ALL_PROGRAMMES_VALUE,
  PROGRAMME_OPTIONS,
  matchesProgrammeSelection,
  resolveAccessibleProgrammes,
} from "@/lib/programme-access";
import Chart from "react-apexcharts";
import { get } from "firebase/database";

// --- Constants ---
const COLORS = {
  darkBlue: "#1e3a8a",
  orange: "#f97316", 
  yellow: "#f59e0b",
  green: "#16a34a",
  maroon: "#991b1b",
  purple: "#7c3aed",
  teal: "#0d9488",
  red: "#dc2626"
};

const BAR_COLORS = [
  COLORS.darkBlue, COLORS.orange, COLORS.yellow, COLORS.green, 
  COLORS.purple, COLORS.teal, COLORS.maroon
];

const REPORT_DONUT_HEIGHT = 280;
const REPORT_DONUT_INNER_RADIUS = 58;
const REPORT_DONUT_OUTER_RADIUS = 90;
const REPORT_DONUT_PADDING_ANGLE = 2;
const REPORT_DONUT_CORNER_RADIUS = 0;

const HORIZONTAL_BAR_CHART_MARGIN = { top: 0, right: 12, left: 48, bottom: 0 };
const HORIZONTAL_BAR_CHART_Y_AXIS_WIDTH = 68;

// Cache duration: 30 minutes. Collection fetches also use the shared tiered cache.
const CACHE_DURATION = 30 * 60 * 1000; 

// --- Types ---
interface Farmer {
  id: string;
  name: string;
  farmerName?: string;
  gender: string;
  phone: string;
  county: string;
  subcounty: string;
  location: string;
  goats: { total?: number; female?: number; male?: number };
  sheep: string | number;
  cattle: string | number;
  vaccinated: boolean;
  vaccines: string[];
  createdAt: number | string;
  registrationDate: string;
  femaleBreeds: string | number;
  maleBreeds: string | number;
  newBreedsFemale?: string | number;
  newBreedsMale?: string | number;
  ageDistribution?: any;
  aggregationGroup?: string;
  bucksServed?: string;
  farmerId?: string;
  traceability?: boolean;
  username?: string;
  programme?: string;
}

interface TrainingRecord {
  id: string;
  totalFarmers: number;
  county: string;
  subcounty: string;
  location: string;
  startDate: string;
  endDate: string;
  topicTrained: string;
  createdAt?: string | number;
  programme?: string;
  fieldOfficer?: string;
  username?: string;
  generatedAt?: string | number;
  uploadedAtISO?: string;
  entries?: Array<Record<string, any>> | Record<string, Record<string, any>>;
}

interface OfftakeRecord {
  id: string;
  date?: string | number | Date;
  Date?: string | number | Date;
  createdAt?: string | number;
  programme?: string;
  totalGoats?: number | string;
  goatsBought?: number | string;
  goats?: unknown;
  Goats?: unknown;
}

interface AnimalHealthVaccine {
  type?: string;
  doses?: number | string;
}

interface AnimalHealthRecord {
  id: string;
  date?: string;
  createdAt?: string | number;
  programme?: string;
  county?: string;
  subcounty?: string;
  location?: string;
  vaccines?: AnimalHealthVaccine[];
  vaccinetype?: string;
  number_doses?: number | string;
}

interface StaffMarkRecord {
  id: string;
  staffName?: string;
  staff?: string;
  name?: string;
  marks?: number | string;
  note?: string;
  programme?: string;
  Programme?: string;
  dateAwarded?: string;
  createdAt?: number | string;
  awardedBy?: string;
  periodStart?: string;
  periodEnd?: string;
}

interface StaffDirectoryRecord {
  id: string;
  staffName?: string;
  role?: string;
  county?: string;
  phone?: string;
  notes?: string;
  programme?: string;
  Programme?: string;
  status?: string;
  createdAt?: number | string;
  createdBy?: string;
  updatedAt?: number | string;
  updatedBy?: string;
}

// A fodder-farm registration record. Each entry represents one fodder site
// (community owned / individual / etc.) and bundles the farmers registered at
// that site via the `farmers` array. The record-level fields (county, date,
// totalBales, etc.) describe the site, while per-farmer info (gender, name,
// phoneNo, idNo) lives inside the `farmers` list.
interface FodderFarmerEntry {
  gender?: string;
  name?: string;
  idNo?: string;
  phoneNo?: string;
}

interface FodderFarmerRecord {
  id: string;
  county?: string;
  subcounty?: string;
  location?: string;
  date?: string;
  timestamp?: number;
  createdAt?: number | string;
  farmers?: FodderFarmerEntry[];
  programme?: string;
  username?: string;
  totalBales?: string | number;
  totalAcresPasture?: string | number;
  yieldPerHarvest?: string | number;
  landSize?: string | number;
  model?: string;
}

// A borehole infrastructure record. The actual Firebase collection uses
// PascalCase field names (County, SubCounty, BoreholeLocation,
// PeopleUsingBorehole, WaterUsed) — those are the primary fields. The
// camelCase variants are tolerated as a fallback in case the schema ever
// changes.
interface BoreholeRecord {
  id: string;
  county?: string;
  County?: string;
  subcounty?: string;
  SubCounty?: string;
  location?: string;
  BoreholeLocation?: string;
  ward?: string;
  peopleUsingBorehole?: string | number;
  PeopleUsingBorehole?: string | number;
  waterUsed?: number;
  WaterUsed?: number;
  drilled?: boolean;
  equipped?: boolean;
  maintained?: boolean;
  rehabilitated?: boolean;
  programme?: string;
  createdAt?: number | string;
  date?: string | number;
  status?: string;
  username?: string;
}

const isRecordObject = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const BOREHOLE_RECORD_FIELDS = [
  "BoreholeLocation", "Borehole Location", "location", "County", "county",
  "PeopleUsingBorehole", "People Using Borehole", "people", "WaterUsed", "waterUsed",
  "date", "Date", "createdAt", "created_at", "programme", "Programme",
] as const;

const isBoreholeRecord = (value: unknown): value is Record<string, any> =>
  isRecordObject(value) && BOREHOLE_RECORD_FIELDS.some((field) => field in value);

// BoreholeStorage can be keyed directly by record id or nested beneath a
// programme. Flatten both structures before the report aggregates counties.
const flattenBoreholeStorage = (rawData: unknown): BoreholeRecord[] => {
  if (!isRecordObject(rawData)) return [];

  const records: BoreholeRecord[] = [];
  const visit = (value: unknown, id: string, programme = "", depth = 0) => {
    if (!isRecordObject(value) || depth > 2) return;

    if (isBoreholeRecord(value)) {
      records.push({
        ...value,
        id,
        programme: value.programme || value.Programme || programme || undefined,
      });
      return;
    }

    Object.entries(value).forEach(([childId, childValue]) => {
      visit(childValue, childId, programme || id, depth + 1);
    });
  };

  Object.entries(rawData).forEach(([id, value]) => visit(value, id));
  return records;
};

type StaffManagementRow = {
  id: string;
  staffName: string;
  role: string;
  county: string;
  phone: string;
  programme: string;
  status: string;
  notes: string;
  totalMarks: number;
  awardCount: number;
  lastAwardDate: string;
  lastAwardNote: string;
  managedInDirectory: boolean;
};

type CreateStaffFormState = {
  staffName: string;
  role: string;
  county: string;
  phone: string;
  notes: string;
};

type StaffMarkFormState = {
  staffName: string;
  marks: string;
  note: string;
  dateAwarded: string;
};

type SummaryItem = {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
};

type SummaryGroup = {
  title: string;
  items: SummaryItem[];
};

// Keeps populated metrics first, zero-value metrics pushed to the end
const sortZeroLast = (items: SummaryItem[]): SummaryItem[] =>
  [...items].sort((a, b) => {
    const aZero = Number(a.value) === 0 ? 1 : 0;
    const bZero = Number(b.value) === 0 ? 1 : 0;
    return aZero - bZero;
  });

// Youth/Adult classification threshold — adjust if your programme
// definition of "youth" uses a different cutoff age.
const YOUTH_AGE_CUTOFF = 35;

// Farmer.ageDistribution is typed `any` in this codebase, so this
// tolerates a plain age number, a category string ("Youth"/"Adult"),
// or an object like { category } / { age }.
const classifyFarmerAgeGroup = (farmer: Farmer): "adult" | "youth" | null => {
  const raw = farmer.ageDistribution;
  if (raw === undefined || raw === null || raw === "") return null;

  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized.includes("youth")) return "youth";
    if (normalized.includes("adult")) return "adult";
    const numeric = parseNumericValue(raw);
    if (numeric > 0) return numeric < YOUTH_AGE_CUTOFF ? "youth" : "adult";
    return null;
  }

  if (typeof raw === "number") {
    return raw < YOUTH_AGE_CUTOFF ? "youth" : "adult";
  }

  if (typeof raw === "object") {
    const category = String(raw.category || raw.ageGroup || raw.group || "").trim().toLowerCase();
    if (category.includes("youth")) return "youth";
    if (category.includes("adult")) return "adult";
    const numeric = parseNumericValue(raw.age ?? raw.value);
    if (numeric > 0) return numeric < YOUTH_AGE_CUTOFF ? "youth" : "adult";
  }

  return null;
};


const EMPTY_STAFF_MARK_RECORDS: StaffMarkRecord[] = [];
const EMPTY_STAFF_DIRECTORY_RECORDS: StaffDirectoryRecord[] = [];
const EMPTY_STAFF_MANAGEMENT_ROWS: StaffManagementRow[] = [];

const createDefaultStaffForm = (): CreateStaffFormState => ({
  staffName: "",
  role: "",
  county: "",
  phone: "",
  notes: "",
});

const createDefaultStaffMarkForm = (): StaffMarkFormState => ({
  staffName: "",
  marks: "",
  note: "",
  dateAwarded: formatDateToLocal(new Date()),
});

const getReportRecordProgramme = (record: { programme?: string; Programme?: string }): string =>
  normalizeProgramme(record.programme ?? record.Programme);

// --- Helper Functions ---
const parseNumericValue = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const parseDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (date?.toDate && typeof date.toDate === 'function') return date.toDate(); 
    if (date instanceof Date) return date;
    if (typeof date === 'number') return new Date(date);
    if (typeof date === 'string') {
      const parsedCustom = new Date(date);
      if (!isNaN(parsedCustom.getTime())) return parsedCustom;
    } 
    if (date?.seconds) return new Date(date.seconds * 1000);
  } catch (error) {
    console.error('Error parsing date:', error, date);
  }
  return null;
};

const formatDateToLocal = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getNumberField = (obj: any, ...fieldNames: string[]): number => {
  for (const fieldName of fieldNames) {
    const value = obj[fieldName];
    if (value !== undefined && value !== null && value !== '') {
      const num = parseNumericValue(value);
      return isNaN(num) ? 0 : num;
    }
  }
  return 0;
};

const hasNumberFieldValue = (obj: any, fieldName: string): boolean => {
  return obj[fieldName] !== undefined && obj[fieldName] !== null && obj[fieldName] !== "";
};

const getFarmerBreedCounts = (farmer: Farmer): { male: number; female: number } => {
  const hasNewBreedFields =
    hasNumberFieldValue(farmer, "newBreedsMale") ||
    hasNumberFieldValue(farmer, "newBreedsFemale");

  return hasNewBreedFields
    ? {
        male: Math.max(0, getNumberField(farmer, "newBreedsMale")),
        female: Math.max(0, getNumberField(farmer, "newBreedsFemale")),
      }
    : {
        male: Math.max(0, getNumberField(farmer, "maleBreeds")),
        female: Math.max(0, getNumberField(farmer, "femaleBreeds")),
      };
};

const getArrayLikeSize = (value: unknown): number => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return 0;
};

const getTrainingRecordDate = (record: TrainingRecord): unknown => {
  if (record.createdAt || record.startDate || record.generatedAt || record.uploadedAtISO) {
    return record.createdAt || record.startDate || record.generatedAt || record.uploadedAtISO;
  }
  const entries = Array.isArray(record.entries)
    ? record.entries
    : record.entries && typeof record.entries === "object"
      ? Object.values(record.entries as Record<string, any>)
      : [];
  return entries[0]?.startDateISO || entries[0]?.startDate || entries[0]?.createdAt;
};

const getTrainingRecordFarmers = (record: TrainingRecord): number => {
  const entries = Array.isArray(record.entries)
    ? record.entries
    : record.entries && typeof record.entries === "object"
      ? Object.values(record.entries as Record<string, any>)
      : [];
  if (entries.length > 0) {
    return entries.reduce((sum, entry) => sum + getNumberField(entry, "totalFarmers", "trainedFarmers", "farmersTrained"), 0);
  }
  return getNumberField(record, "totalFarmers", "trainedFarmers", "farmersTrained", "numberOfFarmers", "numberOfPersons", "participants");
};

const getLeaderName = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
};

const normalizeStaffName = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const getGoatTotal = (goats: any): number => {
  if (typeof goats === "number" || typeof goats === "string") return parseNumericValue(goats);
  if (typeof goats === "object" && goats !== null) {
    if (Object.prototype.hasOwnProperty.call(goats, "total")) {
      return parseNumericValue(goats.total);
    }
    return parseNumericValue(goats.male) + parseNumericValue(goats.female);
  }
  return 0;
};

const formatDisplayDate = (value: unknown): string => {
  const parsed = parseDate(value);
  if (!parsed) return "N/A";
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const getOfftakeGoatsTotal = (record: OfftakeRecord): number =>
  Math.max(
    getNumberField(record, "totalGoats"),
    getNumberField(record, "goatsBought"),
    getNumberField(record, "goats"),
    getArrayLikeSize(record.goats),
    getArrayLikeSize(record.Goats),
    0,
  );

const getAnimalHealthTotalDoses = (record: AnimalHealthRecord): number => {
  if (Array.isArray(record.vaccines)) {
    return record.vaccines.reduce((sum, vaccine) => sum + (Number(vaccine?.doses) || 0), 0);
  }
  return getNumberField(record, "number_doses");
};

const getAnimalHealthVaccineDoses = (record: AnimalHealthRecord): Array<{ type: string; doses: number }> => {
  if (Array.isArray(record.vaccines)) {
    return record.vaccines
      .map((vaccine) => ({
        type: String(vaccine?.type || "Unknown").trim() || "Unknown",
        doses: Number(vaccine?.doses) || 0,
      }))
      .filter((vaccine) => vaccine.doses > 0);
  }

  const doses = getNumberField(record, "number_doses");
  if (doses <= 0) return [];
  return [{ type: String(record.vaccinetype || "Unknown").trim() || "Unknown", doses }];
};

const formatVaccineDisplayName = (name: string): string =>
  name.trim().toLowerCase() === "sheep and goat pox" ? "Pox" : name;

const getAnimalHealthLocationName = (record: AnimalHealthRecord): string =>
  String(record.location || record.subcounty || record.county || "Unknown").trim() || "Unknown";

const buildLocationMetricSeries = (entries: Array<{ name: string; value: number }>) => {
  const totals = new Map<string, number>();

  entries.forEach((entry) => {
    const locationName = String(entry.name || "Unknown").trim() || "Unknown";
    const value = Number(entry.value || 0);
    if (value <= 0) return;
    totals.set(locationName, (totals.get(locationName) || 0) + value);
  });

  return Array.from(totals.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
};

const hasMetricData = (entries: Array<{ value?: number | string }> | undefined): boolean =>
  Array.isArray(entries) && entries.some((entry) => parseNumericValue(entry.value) > 0);

const hasRegistrationTrendData = (
  entries: Array<{ registrations?: number | string; training?: number | string }> | undefined,
): boolean =>
  Array.isArray(entries) &&
  entries.some((entry) => parseNumericValue(entry.registrations) > 0 || parseNumericValue(entry.training) > 0);

const isDateInRange = (date: any, startDate: string, endDate: string): boolean => {
  if (!startDate && !endDate) return true;
  const parsedDate = parseDate(date);
  if (!parsedDate) return false;

  const dateOnly = new Date(parsedDate);
  dateOnly.setHours(0, 0, 0, 0);

  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  
  if (start) start.setHours(0, 0, 0, 0);
  if (end) end.setHours(23, 59, 59, 999);

  if (start && dateOnly < start) return false;
  if (end && dateOnly > end) return false;
  return true;
};

const getCurrentWeekDates = () => {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  return {
    startDate: formatDateToLocal(startOfWeek),
    endDate: formatDateToLocal(endOfWeek)
  };
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: formatDateToLocal(startOfMonth),
    endDate: formatDateToLocal(endOfMonth)
  };
};

const getCurrentYearDates = () => {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return {
    startDate: formatDateToLocal(startOfYear),
    endDate: formatDateToLocal(now),
  };
};

const USE_REMOTE_ANALYTICS = false;

// How long fetched collections are considered fresh before a background refetch is required.
const STALE_AFTER_MS = CACHE_DURATION;
// Retry a flaky fetch (network blip, momentary Firebase timeout) before giving up and
// showing the user an error toast. This is what was causing the "error fetching records"
// popups: a single failed request had no retry, so any transient hiccup surfaced as an error.
const RETRY_DELAYS_MS = [500, 1500];

async function withRetry<T>(fn: () => Promise<T>, retries: number = RETRY_DELAYS_MS.length): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt] ?? 1000));
      }
    }
  }
  throw lastError;
}

type PerformanceReportData = {
  scope: "performance-report";
  resolvedProgrammes: string[];
  totalFarmers: number;
  maleFarmers: number;
  femaleFarmers: number;
  malePercentage: string;
  femalePercentage: string;
  totalAnimals: number;
  totalGoats: number;
  totalSheep: number;
  goatsPercentage: string;
  sheepPercentage: string;
  totalTrainedFarmers: number;
  countyPerformanceData: Array<{ name: string; value: number }>;
  subcountyPerformanceData: Array<{ name: string; value: number; county: string }>;
  wardPerformanceData: Array<{ name: string; value: number; county: string }>;
  registrationTrendData: Array<{ name: string; registrations: number; training: number }>;
  registrationTrendComparisonData: Array<{ name: string; registrations: number; training: number }>;
  topLocations: Array<{ name: string; value: number; county: string }>;
  topCustomers: Array<{ name: string; value: number; county: string }>;
  totalGoatsPurchased: number;
  topFieldOfficers: Array<{ name: string; value: number; county: string }>;
  topStaffAwarded: Array<{ name: string; value: number }>;
  totalDosesGivenOut: number;
  vaccineDoseBreakdown: Array<{ name: string; value: number }>;
  uniqueCounties: number;
  totalBreedsDistributed: number;
  breedsMale: number;
  breedsFemale: number;
  breedsMalePercentage: string;
  breedsFemalePercentage: string;
  farmersWithBreedData: number;
  vaccinationRate: string;
  vaccinatedAnimals: number;
  vaccinatedFarmersCount: number;
  breedsByCountyData: Array<{ name: string; value: number }>;
  breedsBySubcountyData: Array<{ name: string; value: number }>;
  breedsByLocationData: Array<{ name: string; value: number }>;
 vaccinationByCountyData: Array<{ name: string; value: number }>;
  vaccinationBySubcountyData: Array<{ name: string; value: number }>;
  dosesByLocationData: Array<{ name: string; value: number; county: string }>;
  adultFarmers: number;
  youthFarmers: number;
  adultFarmersPercentage: string;
  youthFarmersPercentage: string;
  maleTrainedFarmers: number;
  femaleTrainedFarmers: number;
  adultTrainedFarmers: number;
  youthTrainedFarmers: number;
  maleTrainedPercentage: string;
  femaleTrainedPercentage: string;
  adultTrainedPercentage: string;
  youthTrainedPercentage: string;
  totalLocationsVisited: number;
};

const EMPTY_PERFORMANCE_DATA: PerformanceReportData = {
  scope: "performance-report",
  resolvedProgrammes: [],
  totalFarmers: 0,
  maleFarmers: 0,
  femaleFarmers: 0,
  malePercentage: "0.0",
  femalePercentage: "0.0",
  totalAnimals: 0,
  totalGoats: 0,
  totalSheep: 0,
  goatsPercentage: "0.0",
  sheepPercentage: "0.0",
  totalTrainedFarmers: 0,
  countyPerformanceData: [],
  subcountyPerformanceData: [],
  wardPerformanceData: [],
  registrationTrendData: [],
  registrationTrendComparisonData: [],
  topLocations: [],
  topCustomers: [],
  totalGoatsPurchased: 0,
  topFieldOfficers: [],
  topStaffAwarded: [],
  totalDosesGivenOut: 0,
  vaccineDoseBreakdown: [],
  uniqueCounties: 0,
  totalBreedsDistributed: 0,
  breedsMale: 0,
  breedsFemale: 0,
  breedsMalePercentage: "0.0",
  breedsFemalePercentage: "0.0",
  farmersWithBreedData: 0,
  vaccinationRate: "0.0",
  vaccinatedAnimals: 0,
  vaccinatedFarmersCount: 0,
  breedsByCountyData: [],
  breedsBySubcountyData: [],
  breedsByLocationData: [],
    vaccinationByCountyData: [],
  vaccinationBySubcountyData: [],
  dosesByLocationData: [],
  adultFarmers: 0,
  youthFarmers: 0,
  adultFarmersPercentage: "0.0",
  youthFarmersPercentage: "0.0",
  maleTrainedFarmers: 0,
  femaleTrainedFarmers: 0,
  adultTrainedFarmers: 0,
  youthTrainedFarmers: 0,
  maleTrainedPercentage: "0.0",
  femaleTrainedPercentage: "0.0",
  adultTrainedPercentage: "0.0",
  youthTrainedPercentage: "0.0",
  totalLocationsVisited: 0,
};

const normalizeProgramme = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  if (normalized === "KPMD 2" || normalized === "KPMD-2") return "KPMD 2";
  return normalized;
};

const QUARTERLY_FARMER_TARGET = 117 * 3;

function computeLocalPerformanceReportData(
  farmers: Farmer[],
  trainingRecords: TrainingRecord[],
  animalHealthActivities: AnimalHealthRecord[],
  offtakeRecords: OfftakeRecord[],
  staffMarkRecords: StaffMarkRecord[],
  dateRange: { startDate: string; endDate: string },
  timeFrame: "weekly" | "monthly" | "yearly",
  selectedProgramme: string | null,
  selectedYear: number | null,
  canViewAllProgrammeData: boolean,
  selectedCounty = ALL_COUNTIES_VALUE,
): PerformanceReportData {
  if (!selectedProgramme) return EMPTY_PERFORMANCE_DATA;

  const filteredFarmers = farmers.filter((farmer) => {
    const farmerDate = farmer.createdAt || farmer.registrationDate;
    return matchesProgrammeSelection(farmer.programme, selectedProgramme, canViewAllProgrammeData) &&
      matchesCountySelection(farmer.county, selectedCounty) &&
      isDateInRange(farmerDate, dateRange.startDate, dateRange.endDate);
  });

  const filteredTraining = trainingRecords.filter((record) => {
    const recordDate = getTrainingRecordDate(record);
    return matchesProgrammeSelection(record.programme, selectedProgramme, canViewAllProgrammeData) &&
      matchesCountySelection(record.county, selectedCounty) &&
      isDateInRange(recordDate, dateRange.startDate, dateRange.endDate);
  });
  const filteredAnimalHealthActivities = animalHealthActivities.filter((record) => {
    const recordDate = record.createdAt || record.date;
    return matchesProgrammeSelection(record.programme, selectedProgramme, canViewAllProgrammeData) &&
      matchesCountySelection(record.county, selectedCounty) &&
      isDateInRange(recordDate, dateRange.startDate, dateRange.endDate);
  });
  const filteredOfftakeRecords = offtakeRecords.filter((record) => {
    const recordDate = record.date || record.Date || record.createdAt;
    return matchesProgrammeSelection(record.programme, selectedProgramme, canViewAllProgrammeData) &&
      matchesCountySelection((record as any).county ?? (record as any).County, selectedCounty) &&
      isDateInRange(recordDate, dateRange.startDate, dateRange.endDate);
  });
  const filteredStaffMarks = staffMarkRecords.filter((record) => {
    const recordDate = record.dateAwarded || record.createdAt;
    return matchesProgrammeSelection(record.programme, selectedProgramme, canViewAllProgrammeData) &&
      matchesCountySelection((record as any).county ?? (record as any).County, selectedCounty) &&
      isDateInRange(recordDate, dateRange.startDate, dateRange.endDate);
  });
  const requestedProgramme = normalizeProgramme(selectedProgramme);
  const includeAllProgrammes = selectedProgramme === ALL_PROGRAMMES_VALUE || !requestedProgramme;
  const programmeFarmers = farmers.filter((farmer) =>
    matchesProgrammeSelection(farmer.programme, selectedProgramme, canViewAllProgrammeData) &&
    matchesCountySelection(farmer.county, selectedCounty)
  );

  let maleFarmers = 0;
  let femaleFarmers = 0;
  let totalGoats = 0;
  let totalSheep = 0;
  let totalCattle = 0;
  let totalGoatsPurchased = 0;
  let totalDosesGivenOut = 0;
  let totalVaccinatedAnimals = 0;
  let vaccinatedFarmersCount = 0;
   let breedsMale = 0;
  let breedsFemale = 0;
  let farmersWithBreedData = 0;
  let adultFarmers = 0;
  let youthFarmers = 0;
  const countyMap: Record<string, number> = {};
  const subcountyMap: Record<string, number> = {};
  const locationMap: Record<string, number> = {};
  // Tracks, per location name, how many farmers were registered under each county —
  // used to resolve the county that most likely "owns" a given location for display.
  const locationCountyMap: Record<string, Record<string, number>> = {};
  // Same idea as locationCountyMap, but keyed by subcounty — lets the subcounty
  // registration donut chart show which county each subcounty belongs to on hover.
  const subcountyCountyMap: Record<string, Record<string, number>> = {};
  const topCustomersMap: Record<string, { name: string; value: number; county: string }> = {};
  const topFieldOfficersMap: Record<string, { value: number; counties: Record<string, number> }> = {};
  const topStaffAwardedMap: Record<string, number> = {};
  const breedsByCountyMap: Record<string, number> = {};
  const breedsBySubcountyMap: Record<string, number> = {};
  const breedsByLocationMap: Record<string, number> = {};
  const vaccinationByCountyMap: Record<string, number> = {};
  const vaccinationBySubcountyMap: Record<string, number> = {};
  const dosesByLocationMap: Record<string, number> = {};
  const dosesLocationCountyMap: Record<string, Record<string, number>> = {};
  const vaccineDoseMap: Record<string, number> = {};
  const selectedYearNumber = selectedYear && Number.isFinite(selectedYear) ? selectedYear : null;
  const currentYear = new Date().getFullYear();
  const trendYear = selectedYearNumber ?? null;
  const trendComparisonYears = Array.from({ length: 5 }, (_, index) => currentYear - 4 + index);

  for (const farmer of filteredFarmers) {
    const gender = String(farmer.gender || "").trim().toLowerCase();
    if (gender === "male") maleFarmers += 1;
    else if (gender === "female") femaleFarmers += 1;

    const goats = getGoatTotal(farmer.goats);
    const sheep = getNumberField(farmer, "sheep");
    const cattle = getNumberField(farmer, "cattle");
    const totalAnimalsForFarmer = goats + sheep + cattle;
    totalGoats += goats;
    totalSheep += sheep;
    totalCattle += cattle;

    const { male: maleBreedCount, female: femaleBreedCount } = getFarmerBreedCounts(farmer);
    breedsMale += maleBreedCount;
    breedsFemale += femaleBreedCount;

    const ageGroup = classifyFarmerAgeGroup(farmer);
    if (ageGroup === "adult") adultFarmers += 1;
    else if (ageGroup === "youth") youthFarmers += 1;

    const county = String(farmer.county || "Unknown").trim() || "Unknown";
    const subcounty = String(farmer.subcounty || "Unknown").trim() || "Unknown";
    const location = String(farmer.location || "Unknown").trim() || "Unknown";
    countyMap[county] = (countyMap[county] || 0) + 1;
    subcountyMap[subcounty] = (subcountyMap[subcounty] || 0) + 1;
    locationMap[location] = (locationMap[location] || 0) + 1;
    locationCountyMap[location] = locationCountyMap[location] || {};
    locationCountyMap[location][county] = (locationCountyMap[location][county] || 0) + 1;
    subcountyCountyMap[subcounty] = subcountyCountyMap[subcounty] || {};
    subcountyCountyMap[subcounty][county] = (subcountyCountyMap[subcounty][county] || 0) + 1;

    const farmerName = String(farmer.name || farmer.farmerName || farmer.farmerId || farmer.id || "Unknown").trim() || "Unknown";
    const currentTop = topCustomersMap[farmerName] || { name: farmerName, value: 0, county };
    currentTop.value += totalAnimalsForFarmer;
    if (county !== "Unknown") currentTop.county = county;
    topCustomersMap[farmerName] = currentTop;

    const fieldOfficerName = typeof farmer.username === "string" ? farmer.username.trim() : "";
    if (fieldOfficerName) {
      const currentOfficer = topFieldOfficersMap[fieldOfficerName] || { value: 0, counties: {} };
      currentOfficer.value += 1;
      currentOfficer.counties[county] = (currentOfficer.counties[county] || 0) + 1;
      topFieldOfficersMap[fieldOfficerName] = currentOfficer;
    }

    if (farmer.vaccinated === true) {
      totalVaccinatedAnimals += totalAnimalsForFarmer;
      vaccinatedFarmersCount += 1;
      vaccinationByCountyMap[county] = (vaccinationByCountyMap[county] || 0) + totalAnimalsForFarmer;
      vaccinationBySubcountyMap[subcounty] = (vaccinationBySubcountyMap[subcounty] || 0) + totalAnimalsForFarmer;
    }

    if (maleBreedCount + femaleBreedCount > 0) {
      farmersWithBreedData += 1;
      breedsByCountyMap[county] = (breedsByCountyMap[county] || 0) + maleBreedCount + femaleBreedCount;
      breedsBySubcountyMap[subcounty] = (breedsBySubcountyMap[subcounty] || 0) + maleBreedCount + femaleBreedCount;
      breedsByLocationMap[location] = (breedsByLocationMap[location] || 0) + maleBreedCount + femaleBreedCount;
    }
  }

  filteredStaffMarks.forEach((record) => {
    const staffName = getLeaderName(
      record.staffName || record.staff || record.name,
      "",
    );
    const awardedMarks = getNumberField(record, "marks", "score", "awardedMarks");
    if (!staffName || awardedMarks <= 0) return;
    topStaffAwardedMap[staffName] = (topStaffAwardedMap[staffName] || 0) + awardedMarks;
  });

  filteredAnimalHealthActivities.forEach((record) => {
    const doses = getAnimalHealthTotalDoses(record);
    totalDosesGivenOut += doses;
    const location = getAnimalHealthLocationName(record);
    const county = String(record.county || "Unknown").trim() || "Unknown";
    if (doses > 0) {
      dosesByLocationMap[location] = (dosesByLocationMap[location] || 0) + doses;
      dosesLocationCountyMap[location] = dosesLocationCountyMap[location] || {};
      dosesLocationCountyMap[location][county] = (dosesLocationCountyMap[location][county] || 0) + doses;
    }
    getAnimalHealthVaccineDoses(record).forEach((vaccine) => {
      const vaccineName = formatVaccineDisplayName(vaccine.type);
      vaccineDoseMap[vaccineName] = (vaccineDoseMap[vaccineName] || 0) + vaccine.doses;
    });
  });

  filteredOfftakeRecords.forEach((record) => {
    totalGoatsPurchased += getOfftakeGoatsTotal(record);
  });

  const totalAnimals = totalGoats + totalSheep + totalCattle;
  const totalTrainedFarmers = filteredTraining.reduce((sum, record) => sum + getTrainingRecordFarmers(record), 0);

  let maleTrainedFarmers = 0;
  let femaleTrainedFarmers = 0;
  let adultTrainedFarmers = 0;
  let youthTrainedFarmers = 0;

  filteredTraining.forEach((record) => {
    const entries = Array.isArray(record.entries)
      ? record.entries
      : record.entries && typeof record.entries === "object"
        ? Object.values(record.entries as Record<string, any>)
        : [record as Record<string, any>];

    entries.forEach((entry) => {
      maleTrainedFarmers += getNumberField(entry, "maleFarmers", "male", "trainedMale", "maleTrained");
      femaleTrainedFarmers += getNumberField(entry, "femaleFarmers", "female", "trainedFemale", "femaleTrained");
      adultTrainedFarmers += getNumberField(entry, "adultFarmers", "adult", "adultsTrained");
      youthTrainedFarmers += getNumberField(entry, "youthFarmers", "youth", "youthsTrained");
    });
  });

  const totalLocationsVisited = new Set(
    filteredAnimalHealthActivities.map((record) => getAnimalHealthLocationName(record)),
  ).size;
  const countyPerformanceData = Object.entries(countyMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const subcountyPerformanceData = Object.entries(subcountyMap)
    .map(([name, value]) => {
      const countyEntries = Object.entries(subcountyCountyMap[name] || {});
      const county =
        countyEntries.length > 0 ?
          countyEntries.sort((left, right) => right[1] - left[1])[0][0] :
          "Unknown";
      return { name, value, county };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const wardPerformanceData = Object.entries(locationMap)
    .map(([name, value]) => {
      const countyEntries = Object.entries(locationCountyMap[name] || {});
      const county =
        countyEntries.length > 0 ?
          countyEntries.sort((left, right) => right[1] - left[1])[0][0] :
          "Unknown";
      return { name, value, county };
    })
    .sort((a, b) => b.value - a.value);
  const topLocations = Object.entries(locationMap)
    .map(([name, value]) => {
      const countyEntries = Object.entries(locationCountyMap[name] || {});
      const county =
        countyEntries.length > 0 ?
          countyEntries.sort((left, right) => right[1] - left[1])[0][0] :
          "Unknown";
      return { name, value, county };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const topCustomers = Object.values(topCustomersMap)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const topFieldOfficers = Object.entries(topFieldOfficersMap)
    .map(([name, entry]) => {
      const countyEntries = Object.entries(entry.counties);
      const county =
        countyEntries.length > 0 ?
          countyEntries.sort((left, right) => right[1] - left[1])[0][0] :
          "Unknown";
      return { name, value: entry.value, county };
    })
    .sort((a, b) => b.value - a.value);
  const topStaffAwarded = Object.entries(topStaffAwardedMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const registrationTrendData = (() => {
    const trendData: Array<{ name: string; registrations: number; training: number }> = [];
    if (timeFrame === "weekly") {
      for (let offset = 3; offset >= 0; offset -= 1) {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - (offset * 7) - weekStart.getDay());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const count = filteredFarmers.filter((farmer) => {
          const date = parseDate(farmer.createdAt || farmer.registrationDate);
          return !!date && date >= weekStart && date <= weekEnd;
        }).length;
        const training = filteredTraining.reduce((sum, record) => {
          const date = parseDate(getTrainingRecordDate(record));
          return date && date >= weekStart && date <= weekEnd ? sum + getTrainingRecordFarmers(record) : sum;
        }, 0);
        trendData.push({ name: `Week ${4 - offset}`, registrations: count, training });
      }
      return trendData;
    }

    if (timeFrame === "monthly") {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const analysisYear = trendYear ?? currentYear;
      months.forEach((monthName, index) => {
        const count = filteredFarmers.filter((farmer) => {
          const date = parseDate(farmer.createdAt || farmer.registrationDate);
          if (!date) return false;
          if (trendYear === null) return date.getMonth() === index;
          const monthStart = new Date(analysisYear, index, 1);
          const monthEnd = new Date(analysisYear, index + 1, 0);
          return date >= monthStart && date <= monthEnd;
        }).length;
        const training = filteredTraining.reduce((sum, record) => {
          const date = parseDate(getTrainingRecordDate(record));
          if (!date) return sum;
          if (trendYear === null) return date.getMonth() === index ? sum + getTrainingRecordFarmers(record) : sum;
          const monthStart = new Date(analysisYear, index, 1);
          const monthEnd = new Date(analysisYear, index + 1, 0);
          return date >= monthStart && date <= monthEnd ? sum + getTrainingRecordFarmers(record) : sum;
        }, 0);
        trendData.push({ name: monthName, registrations: count, training });
      });
      return trendData;
    }

    if (trendYear !== null) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      months.forEach((monthName, index) => {
        const monthStart = new Date(trendYear, index, 1);
        const monthEnd = new Date(trendYear, index + 1, 0);
        const count = filteredFarmers.filter((farmer) => {
          const date = parseDate(farmer.createdAt || farmer.registrationDate);
          return !!date && date >= monthStart && date <= monthEnd;
        }).length;
        const training = filteredTraining.reduce((sum, record) => {
          const date = parseDate(getTrainingRecordDate(record));
          return date && date >= monthStart && date <= monthEnd ? sum + getTrainingRecordFarmers(record) : sum;
        }, 0);
        trendData.push({ name: monthName, registrations: count, training });
      });
      return trendData;
    }

    const resolvedYears =
      Array.from(
        new Set(
          filteredFarmers
            .map((farmer) => parseDate(farmer.createdAt || farmer.registrationDate)?.getFullYear() ?? null)
            .filter((year): year is number => year !== null),
        ),
      ).sort((left, right) => left - right);

    for (const year of (resolvedYears.length > 0 ? resolvedYears : trendComparisonYears)) {
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31);
      const count = filteredFarmers.filter((farmer) => {
        const date = parseDate(farmer.createdAt || farmer.registrationDate);
        return !!date && date >= yearStart && date <= yearEnd;
      }).length;
      const training = filteredTraining.reduce((sum, record) => {
        const date = parseDate(getTrainingRecordDate(record));
        return date && date >= yearStart && date <= yearEnd ? sum + getTrainingRecordFarmers(record) : sum;
      }, 0);
      trendData.push({ name: String(year), registrations: count, training });
    }
    return trendData;
  })();
  const registrationTrendComparisonData = trendComparisonYears.map((year) => {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const count = programmeFarmers.filter((farmer) => {
      const date = parseDate(farmer.createdAt || farmer.registrationDate);
      return !!date && date >= yearStart && date <= yearEnd;
    }).length;
    const training = trainingRecords.reduce((sum, record) => {
      const date = parseDate(getTrainingRecordDate(record));
      return matchesProgrammeSelection(record.programme, selectedProgramme, canViewAllProgrammeData) &&
        matchesCountySelection(record.county, selectedCounty) &&
        date && date >= yearStart && date <= yearEnd
        ? sum + getTrainingRecordFarmers(record)
        : sum;
    }, 0);
    return { name: String(year), registrations: count, training };
  });
  const uniqueCounties = new Set(
    filteredFarmers.map((farmer) => String(farmer.county || "").trim()).filter(Boolean),
  ).size;
  const totalBreedsDistributed = breedsMale + breedsFemale;
  const breedsByCountyData = Object.entries(breedsByCountyMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const breedsBySubcountyData = Object.entries(breedsBySubcountyMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const breedsByLocationData = Object.entries(breedsByLocationMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const vaccinationByCountyData = Object.entries(vaccinationByCountyMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const vaccinationBySubcountyData = Object.entries(vaccinationBySubcountyMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const dosesByLocationData = Object.entries(dosesByLocationMap)
    .map(([name, value]) => {
      const countyEntries = Object.entries(dosesLocationCountyMap[name] || {});
      const county =
        countyEntries.length > 0 ?
          countyEntries.sort((left, right) => right[1] - left[1])[0][0] :
          "Unknown";
      return { name, value, county };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const vaccineDoseBreakdown = Object.entries(vaccineDoseMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return {
    scope: "performance-report",
    resolvedProgrammes: includeAllProgrammes ? [...PROGRAMME_OPTIONS] : [requestedProgramme],
    totalFarmers: filteredFarmers.length,
    maleFarmers,
    femaleFarmers,
    malePercentage: filteredFarmers.length > 0 ? ((maleFarmers / filteredFarmers.length) * 100).toFixed(1) : "0.0",
    femalePercentage: filteredFarmers.length > 0 ? ((femaleFarmers / filteredFarmers.length) * 100).toFixed(1) : "0.0",
    totalAnimals,
    totalGoats,
    totalSheep,
    goatsPercentage: totalAnimals > 0 ? ((totalGoats / totalAnimals) * 100).toFixed(1) : "0.0",
    sheepPercentage: totalAnimals > 0 ? ((totalSheep / totalAnimals) * 100).toFixed(1) : "0.0",
    totalTrainedFarmers,
    countyPerformanceData,
    subcountyPerformanceData,
    wardPerformanceData,
    registrationTrendData,
    registrationTrendComparisonData,
    topLocations,
    topCustomers,
    totalGoatsPurchased,
    topFieldOfficers,
    topStaffAwarded,
    totalDosesGivenOut,
    vaccineDoseBreakdown,
    uniqueCounties,
    totalBreedsDistributed,
    breedsMale,
    breedsFemale,
    breedsMalePercentage: totalBreedsDistributed > 0 ? ((breedsMale / totalBreedsDistributed) * 100).toFixed(1) : "0.0",
    breedsFemalePercentage: totalBreedsDistributed > 0 ? ((breedsFemale / totalBreedsDistributed) * 100).toFixed(1) : "0.0",
    farmersWithBreedData,
    vaccinationRate: totalAnimals > 0 ? ((totalVaccinatedAnimals / totalAnimals) * 100).toFixed(1) : "0.0",
    vaccinatedAnimals: totalVaccinatedAnimals,
    vaccinatedFarmersCount,
        breedsByCountyData,
    breedsBySubcountyData,
    breedsByLocationData,
    vaccinationByCountyData,
    vaccinationBySubcountyData,
    dosesByLocationData,
    adultFarmers,
    youthFarmers,
    adultFarmersPercentage: filteredFarmers.length > 0 ? ((adultFarmers / filteredFarmers.length) * 100).toFixed(1) : "0.0",
    youthFarmersPercentage: filteredFarmers.length > 0 ? ((youthFarmers / filteredFarmers.length) * 100).toFixed(1) : "0.0",
    maleTrainedFarmers,
    femaleTrainedFarmers,
    adultTrainedFarmers,
    youthTrainedFarmers,
    maleTrainedPercentage: totalTrainedFarmers > 0 ? ((maleTrainedFarmers / totalTrainedFarmers) * 100).toFixed(1) : "0.0",
    femaleTrainedPercentage: totalTrainedFarmers > 0 ? ((femaleTrainedFarmers / totalTrainedFarmers) * 100).toFixed(1) : "0.0",
    adultTrainedPercentage: totalTrainedFarmers > 0 ? ((adultTrainedFarmers / totalTrainedFarmers) * 100).toFixed(1) : "0.0",
    youthTrainedPercentage: totalTrainedFarmers > 0 ? ((youthTrainedFarmers / totalTrainedFarmers) * 100).toFixed(1) : "0.0",
    totalLocationsVisited,
  
  };
}

// --- Custom Hook for Data Processing ---
const useProcessedData = (
  _allFarmers: Farmer[],
  _trainingRecords: TrainingRecord[],
  _animalHealthActivities: AnimalHealthRecord[],
  _offtakeRecords: OfftakeRecord[],
  _staffMarkRecords: StaffMarkRecord[],
  dateRange: { startDate: string; endDate: string },
  timeFrame: 'weekly' | 'monthly' | 'yearly',
  selectedProgramme: string | null,
  selectedYear: number | null,
  canViewAllProgrammeData: boolean,
  selectedCounty: string,
) => {
  const queryResult = useQuery({
    queryKey: [
      "performance-report",
      selectedProgramme,
      dateRange.startDate,
      dateRange.endDate,
      timeFrame,
      selectedYear,
      selectedCounty,
    ],
    queryFn: () =>
      fetchAnalysisSummary({
        scope: "performance-report",
        programme: selectedProgramme,
        dateRange,
        timeFrame,
        selectedYear,
      }),
    enabled: USE_REMOTE_ANALYTICS && !!selectedProgramme,
    placeholderData: (previousData) => previousData,
    staleTime: 10 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const localData = useMemo(
    () =>
      USE_REMOTE_ANALYTICS
        ? undefined
        : computeLocalPerformanceReportData(
            _allFarmers,
            _trainingRecords,
            _animalHealthActivities,
            _offtakeRecords,
            _staffMarkRecords,
            dateRange,
            timeFrame,
            selectedProgramme,
            selectedYear,
            canViewAllProgrammeData,
            selectedCounty,
          ),
    [_allFarmers, _trainingRecords, _animalHealthActivities, _offtakeRecords, _staffMarkRecords, dateRange, timeFrame, selectedProgramme, selectedYear, canViewAllProgrammeData, selectedCounty],
  );

  const remoteData = useMemo(
    () => ({ ...EMPTY_PERFORMANCE_DATA, ...(queryResult.data as Partial<PerformanceReportData> | undefined) }),
    [queryResult.data],
  );

  return {
    data: USE_REMOTE_ANALYTICS ? remoteData : localData ?? EMPTY_PERFORMANCE_DATA,
    isLoading: queryResult.isLoading,
    isError: queryResult.isError,
    error: queryResult.error,
  };
};

// --- Sub Components ---

interface StatsCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  icon: React.ElementType;
  color?: 'blue' | 'orange' | 'yellow' | 'green' | 'red' | 'purple' | 'teal';
}

const StatsCard = React.memo(({ title, value, subtext, icon: Icon, color = "blue" }: StatsCardProps) => {
  const colorMap: Record<string, { border: string, bg: string, text: string }> = {
    blue: { border: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-600' },
    orange: { border: 'bg-orange-500', bg: 'bg-orange-50', text: 'text-orange-600' },
    yellow: { border: 'bg-yellow-500', bg: 'bg-yellow-50', text: 'text-yellow-600' },
    green: { border: 'bg-green-500', bg: 'bg-green-50', text: 'text-green-600' },
    red: { border: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-600' },
    purple: { border: 'bg-purple-500', bg: 'bg-purple-50', text: 'text-purple-600' },
    teal: { border: 'bg-teal-500', bg: 'bg-teal-50', text: 'text-teal-600' },
  };

  const theme = colorMap[color];

  return (
    <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-0 bg-gradient-to-br from-white to-gray-50">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${theme.border}`}></div>
      
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
        <CardTitle className="text-xs font-medium text-gray-600">{title}</CardTitle>
        <div className={`p-2 rounded-xl ${theme.bg} shadow-sm`}>
          <Icon className={`h-4 w-4 ${theme.text}`} />
        </div>
      </CardHeader>
      <CardContent className="pl-6 pb-4">
        <div className="text-xl font-bold text-gray-900">{value}</div>
        {subtext && (
          <p className="text-[11px] text-gray-500 mt-2 font-medium leading-relaxed">{subtext}</p>
        )}
      </CardContent>
    </Card>
  );
});

const SectionHeader = React.memo(({ title }: { title: string }) => (
  <h2 className="text-lg font-semibold text-gray-900 mb-4 pb-2 flex items-center border-b border-gray-200">
    {title}
  </h2>
));

// Shared list layout for "top location" style rankings — used anywhere top
// locations are shown so the location name, its county, the share bar, and the
// value badge line up consistently instead of drifting per-section.
const TopLocationsList = React.memo(
  ({
    locations,
    unitLabel = "farmers",
    accent = "green",
  }: {
    locations: Array<{ name: string; value: number; county: string }>;
    unitLabel?: string;
    accent?: "green" | "blue";
  }) => {
    const peak = locations[0]?.value || 0;
    const accentClasses =
      accent === "blue"
        ? {
            badge: "bg-blue-600",
            bar: "from-blue-500 to-blue-700",
            pill: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50",
          }
        : {
            badge: "bg-green-600",
            bar: "from-green-500 to-green-700",
            pill: "border-green-200 bg-green-50 text-green-700 hover:bg-green-50",
          };

    if (locations.length === 0) {
      return (
        <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
          No location data found for the selected filters.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {locations.map((location, index) => {
          const share = peak > 0 ? (location.value / peak) * 100 : 0;
          return (
            <div
              key={`${location.name}-${index}`}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm"
            >
              <div className="flex items-center gap-4">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${accentClasses.badge} text-xs font-semibold text-white shadow-sm`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{location.name}</p>
                    <p className="truncate text-xs text-slate-500">County: {location.county}</p>
                  </div>
                </div>
                <div className="min-w-[140px] max-w-[220px] flex-1">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${accentClasses.bar} transition-all`}
                      style={{ width: `${Math.max(share, 10)}%` }}
                    />
                  </div>
                </div>
                <Badge className={`shrink-0 whitespace-nowrap px-3 py-1 ${accentClasses.pill}`}>
                  {Number(location.value).toLocaleString()} {unitLabel}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    );
  },
);

type ReportAudience = "hr" | "project-manager" | "default";
type ReportSectionId =
  | "hr-summary"
  | "hr-rankings"
  | "hr-distribution"
  | "project-manager-report"
  | "default-registration"
  | "default-animal-health";

const REPORT_VIEW_PROFILES: Record<ReportAudience, { title: string; sections: ReportSectionId[] }> = {
  hr: {
    title: "Performance Report",
    sections: ["default-registration", "default-animal-health"],
  },
  "project-manager": {
    title: "Project Manager Report",
    sections: ["project-manager-report"],
  },
  default: {
    title: "Performance Dashboard",
    sections: ["default-registration", "default-animal-health"],
  },
};

const ALL_YEARS_VALUE = "ALL";
const ALL_COUNTIES_VALUE = "ALL_COUNTIES";

const normalizeCountyFilterValue = (value: unknown): string =>
  String(value || "").trim().toLowerCase();

const matchesCountySelection = (recordCounty: unknown, selectedCounty: string): boolean => {
  if (!selectedCounty || selectedCounty === ALL_COUNTIES_VALUE) return true;
  return normalizeCountyFilterValue(recordCounty) === normalizeCountyFilterValue(selectedCounty);
};

const resolveReportAudience = (
  userRole: string | null | undefined,
  userAttribute?: string | null,
): ReportAudience => {
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  if (isHummanResourceManager(principal)) return "hr";
  if (isProjectManager(principal)) return "project-manager";
  return "default";
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const BalesTrendsComboChart = ({ hayStorageRecords }: { hayStorageRecords: any[] }) => {
  const chartData = useMemo(() => {
    const monthlyData: Record<string, { harvested: number; sold: number }> = {};
    hayStorageRecords.forEach((r: any) => {
      const dateStr = r.date_sold || r.createdAt || r.created_at;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!monthlyData[key]) monthlyData[key] = { harvested: 0, sold: 0 };
      monthlyData[key].harvested += r.bales_harvested_stored || 0;
      monthlyData[key].sold += r.bales_sold || 0;
    });
    const sorted = Object.entries(monthlyData).sort(([a], [b]) => a.localeCompare(b));
    return {
      categories: sorted.map(([k]) => k),
      harvested: sorted.map(([, v]) => v.harvested),
      sold: sorted.map(([, v]) => v.sold),
    };
  }, [hayStorageRecords]);

  const options: ApexCharts.ApexOptions = {
    chart: { type: "bar", height: 280, background: "transparent", toolbar: { show: false }, fontFamily: "inherit" },
    plotOptions: { bar: { columnWidth: "55%", borderRadius: 4 } },
    colors: ["#3b82f6", "#eab308"],
    xaxis: { categories: chartData.categories, labels: { style: { fontSize: "11px" } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { fontSize: "11px" } } },
    grid: { borderColor: "#f1f5f9", strokeDashArray: 4 },
    dataLabels: { enabled: false },
    stroke: { width: [0, 3], curve: "smooth" },
    tooltip: { shared: true, intersect: false },
    legend: { position: "bottom", fontSize: "12px" },
  };

  return (
    <Chart
      options={options}
      series={[
        { name: "Bales Harvested", type: "column", data: chartData.harvested },
        { name: "Bales Sold", type: "line", data: chartData.sold },
      ]}
      type="bar"
      height={280}
    />
  );
};

// Doughnut comparing bales sourced by harvesting on-farm vs bales bought in
// (purchased) and put into storage. Center label shows the combined total so
// the ring reads at a glance like a classic doughnut summary chart.
const HAY_SOURCE_COLORS = ["#16a34a", "#f97316"];

const HayBalesSourceDonutChart = ({
  harvested,
  purchased,
}: {
  harvested: number;
  purchased: number;
}) => {
  const total = harvested + purchased;
  const data = [
    { name: "Harvested Bales", value: harvested },
    { name: "Purchased Bales", value: purchased },
  ];

  if (total <= 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No hay bales data found for the selected filters.
      </div>
    );
  }

  const renderLabel = ({ percent }: any) => (percent > 0 ? `${(percent * 100).toFixed(0)}%` : "");

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={REPORT_DONUT_HEIGHT}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={REPORT_DONUT_INNER_RADIUS}
            outerRadius={REPORT_DONUT_OUTER_RADIUS}
            paddingAngle={REPORT_DONUT_PADDING_ANGLE}
            cornerRadius={0}
            dataKey="value"
            label={renderLabel}
            labelLine={false}
          >
            {data.map((entry, index) => (
              <Cell key={`hay-source-${index}`} fill={HAY_SOURCE_COLORS[index % HAY_SOURCE_COLORS.length]} stroke="#fff" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip formatter={(value: number | string, name: string) => [`${Number(value).toLocaleString()} bales`, name]} />
          <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute left-1/2 top-[44%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <span className="text-[11px] font-medium text-slate-500">Total Bales</span>
        <span className="text-xl font-bold text-slate-900">{total.toLocaleString()}</span>
      </div>
    </div>
  );
};

const VaccinationMonthlyTrendChart = ({ animalHealthRecords }: { animalHealthRecords: any[] }) => {
  const chartData = useMemo(() => {
    const yearData: Record<number, number[]> = {};
    animalHealthRecords.forEach((r: any) => {
      const dateStr = r.date || r.createdAt || r.created_at;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return;
      const year = d.getFullYear();
      const month = d.getMonth();
      if (!yearData[year]) yearData[year] = new Array(12).fill(0);
      // Use the shared doses helper (handles both the `vaccines[]` shape and the
      // flat `number_doses` field) instead of the previous ad-hoc `r.totalDoses`
      // lookup, which didn't match any real field and always evaluated to 0 —
      // that mismatch was why this trend chart never showed any data.
      yearData[year][month] += getAnimalHealthTotalDoses(r);
    });
    
    const currentYear = new Date().getFullYear();
    const years = Object.keys(yearData).map(Number).sort().filter(y => y >= currentYear - 2);
    if (years.length === 0) return { categories: MONTH_NAMES, series: [] };
    
    return {
      categories: MONTH_NAMES,
      series: years.map(year => ({
        name: String(year),
        data: yearData[year] || new Array(12).fill(0),
      })),
    };
  }, [animalHealthRecords]);

  const options: ApexCharts.ApexOptions = {
    chart: { height: 300, background: "transparent", toolbar: { show: false }, fontFamily: "inherit",zoom: { enabled: false }, selection: { enabled: false } },
    colors: ["#ef4444", "#f97316", "#3b82f6"],
    xaxis: { categories: chartData.categories },
    yaxis: { labels: { style: { fontSize: "11px" } } },
    grid: { borderColor: "#f1f5f9", strokeDashArray: 4 },
    dataLabels: { enabled: false },
    stroke: { width: 2, curve: "smooth" },
    tooltip: { shared: true, intersect: false },
    legend: { position: "bottom", fontSize: "12px" },
  };

  if (chartData.series.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No animal health vaccination records found for the last 3 years.
      </div>
    );
  }

  return <Chart options={options} series={chartData.series} type="line" height={300} />;
};

// Farmer registration equivalent of VaccinationMonthlyTrendChart: buckets every
// farmer's registration date into (year, month) and plots one line per year so
// the "Farmers Registration Trend" card gets the same full-year, multi-year
// month-by-month read as the vaccination trend chart.
const RegistrationMonthlyTrendChart = ({ farmers }: { farmers: Farmer[] }) => {
  const chartData = useMemo(() => {
    const yearData: Record<number, number[]> = {};
    farmers.forEach((farmer) => {
      const date = parseDate(farmer.createdAt || farmer.registrationDate);
      if (!date) return;
      const year = date.getFullYear();
      const month = date.getMonth();
      if (!yearData[year]) yearData[year] = new Array(12).fill(0);
      yearData[year][month] += 1;
    });

    const currentYear = new Date().getFullYear();
    const years = Object.keys(yearData).map(Number).sort().filter((year) => year >= currentYear - 2);
    if (years.length === 0) return { categories: MONTH_NAMES, series: [] };

    return {
      categories: MONTH_NAMES,
      series: years.map((year) => ({
        name: String(year),
        data: yearData[year] || new Array(12).fill(0),
      })),
    };
  }, [farmers]);

  const options: ApexCharts.ApexOptions = {
    chart: {
      height: 300,
      background: "transparent",
      toolbar: { show: false },
      fontFamily: "inherit",
      zoom: { enabled: false }, // disables mouse-wheel / pinch zoom
      selection: { enabled: false }, // disables click-drag selection/zoom
      animations: { enabled: true },
    },
    colors: ["#1e3a8a", "#f97316", "#16a34a"],
    xaxis: { categories: chartData.categories },
    yaxis: { labels: { style: { fontSize: "11px" } } },
    grid: { borderColor: "#f1f5f9", strokeDashArray: 4 },
    dataLabels: { enabled: false },
    stroke: { width: 2, curve: "smooth" },
    tooltip: { shared: true, intersect: false },
    legend: { position: "bottom", fontSize: "12px" },
  };

  if (chartData.series.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No farmer registration records found for the last 3 years.
      </div>
    );
  }

  return <Chart options={options} series={chartData.series} type="line" height={300} />;
};

// Compares farmer-reported vaccinations (self-reported by the farmer during
// registration/visits) against animal-health-aid vaccinations (doses
// administered under the AnimalHealthActivities aid programme), month by
// month for the current year, so the two vaccination channels can be read
// side by side.
const VaccinationSourceComparisonChart = ({
  farmers,
  animalHealthRecords,
}: {
  farmers: Farmer[];
  animalHealthRecords: AnimalHealthRecord[];
}) => {
  const chartData = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const farmerMonthly = new Array(12).fill(0);

    farmers.forEach((farmer) => {
      if (farmer.vaccinated !== true) return;
      const date = parseDate(farmer.createdAt || farmer.registrationDate);
      if (!date || date.getFullYear() !== currentYear) return;
      const animalsForFarmer =
        getGoatTotal(farmer.goats) + getNumberField(farmer, "sheep") + getNumberField(farmer, "cattle");
      farmerMonthly[date.getMonth()] += animalsForFarmer;
    });

    const aidMonthly = new Array(12).fill(0);
    animalHealthRecords.forEach((record) => {
      const date = parseDate(record.date || record.createdAt);
      if (!date || date.getFullYear() !== currentYear) return;
      aidMonthly[date.getMonth()] += getAnimalHealthTotalDoses(record);
    });

    return MONTH_NAMES.map((name, index) => ({
      name,
      "Farmer-Reported Vaccinations": farmerMonthly[index],
      "Aid vaccination": aidMonthly[index],
    }));
  }, [farmers, animalHealthRecords]);

  const hasData = chartData.some(
    (entry) => entry["Farmer-Reported Vaccinations"] > 0 || entry["Aid vaccination"] > 0,
  );

  if (!hasData) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No vaccination activity found for the current year.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData} margin={{ top: 8, right: 20, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip />
        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Line
          type="monotone"
          dataKey="Farmer-Reported Vaccinations"
          stroke={COLORS.darkBlue}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="Aid vaccination"
          stroke={COLORS.red}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

// Renders the year-over-year (or period) farmer registration trend as a clean
// line chart, matching the visual language of VaccinationSourceComparisonChart
// (no axis lines/ticks, dashed horizontal grid only, dotted markers, bottom legend)
// so the two "trend" style charts on the dashboard read consistently.
const RegistrationTrendChart = ({
  data,
}: {
  data: Array<{ name: string; registrations: number; training?: number }>;
}) => {
  const hasData = hasRegistrationTrendData(data);

  if (!hasData) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No registration activity found for the selected filters.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(value: number | string, name: string) => [Number(value).toLocaleString(), name]} />
        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Line
          type="monotone"
          dataKey="registrations"
          name="Registrations"
          stroke={COLORS.darkBlue}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="training"
          name="Training"
          stroke={COLORS.orange}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

// Donut/pinwheel chart for "Registration Per Subcounty", styled after the
// reference design: dark navy card, rounded donut segments with padding
// between them, percentage labels on leader lines outside the ring, and a
// small icon badge at the center. Hovering any segment shows the county,
// subcounty name, and number of farmers registered there.
const SUBCOUNTY_DONUT_COLORS = [
  "#22d3ee", "#f97316", "#a78bfa", "#34d399", "#f472b6",
  "#facc15", "#60a5fa", "#fb7185", "#4ade80", "#c084fc",
];

const SubcountyRegistrationDonutChart = ({
  data,
}: {
  data: Array<{ name: string; value: number; county: string }>;
}) => {
  const total = useMemo(() => data.reduce((sum, entry) => sum + (entry.value || 0), 0), [data]);

  if (data.length === 0 || total <= 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No subcounty registration data found for the selected filters.
      </div>
    );
  }

  const renderOuterLabel = ({ cx, cy, midAngle, outerRadius, percent, index }: any) => {
    if (!percent) return null;
    const RADIAN = Math.PI / 180;
    const sin = Math.sin(-midAngle * RADIAN);
    const cos = Math.cos(-midAngle * RADIAN);
    const sx = cx + outerRadius * cos;
    const sy = cy + outerRadius * sin;
    const mx = cx + (outerRadius + 14) * cos;
    const my = cy + (outerRadius + 14) * sin;
    const ex = mx + (cos >= 0 ? 1 : -1) * 10;
    const ey = my;
    const textAnchor = cos >= 5 ? "start" : "end";
    const color = SUBCOUNTY_DONUT_COLORS[index % SUBCOUNTY_DONUT_COLORS.length];

    return (
      <g>
        <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke="none" fill="none" strokeWidth={0} />
        <circle cx={ex} cy={ey} r={0} fill={color} stroke="none" />
        <text
          x={ex + (cos >= 0 ? 1 : -1) * 6}
          y={ey}
          textAnchor={textAnchor}
          dominantBaseline="central"
          fontSize={10}
          fontWeight={700}
          fill="#1d1d1e"
        >
          {`${(percent * 100).toFixed(0)}%`}
        </text>
      </g>
    );
  };

  const renderDonutTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const entry = payload[0].payload as { name: string; value: number; county: string };
    return (
      <div
        style={{
          background: "#0f172a",
          borderRadius: 10,
          padding: "8px 12px",
          color: "#fff",
          fontSize: 12,
          lineHeight: 1.6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ fontWeight: 700 }}>{entry.name}</div>
        <div style={{ color: "#94a3b8" }}>County: {entry.county}</div>
        <div>
          Farmers registered: <strong>{Number(entry.value).toLocaleString()}</strong>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-2xl p-2">
      <div className="relative">
        <ResponsiveContainer width="100%" height={REPORT_DONUT_HEIGHT}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={REPORT_DONUT_INNER_RADIUS}
              outerRadius={REPORT_DONUT_OUTER_RADIUS}
              paddingAngle={REPORT_DONUT_PADDING_ANGLE}
              cornerRadius={REPORT_DONUT_CORNER_RADIUS}
              dataKey="value"
              label={renderOuterLabel}
              labelLine={false}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`subcounty-donut-${index}`}
                  fill={SUBCOUNTY_DONUT_COLORS[index % SUBCOUNTY_DONUT_COLORS.length]}
                  stroke="none"
                  strokeWidth={0}
                />
              ))}
            </Pie>
            <Tooltip content={renderDonutTooltip} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-slate-800 shadow-lg ring-2 ring-slate-700">
          <MapPin className="h-4 w-4 text-cyan-400" />
        </div>
      </div>
      {/* Color-coded indicator row — one dot + subcounty name per slice, using the
          same SUBCOUNTY_DONUT_COLORS mapping as the ring so each segment is
          identifiable at a glance instead of relying on the leader-line labels alone. */}
    </div>
  );
};

const OPERATIONS_ROSE_COLORS: Record<string, string> = {
  Receiving: "#ef4444",
  Packing: "#fde68a",
  Shipping: "#94a3b8",
  Inventory: "#0d9488",
  Returns: "#9ca3af",
};

type DayRow = {
  day: string;
  Receiving: number;
  Packing: number;
  Shipping: number;
  Inventory: number;
  Returns: number;
};

const renderRoseTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: "#0f172a",
        borderRadius: 10,
        padding: "10px 14px",
        color: "#fff",
        fontSize: 12,
        lineHeight: 1.6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {payload
        .slice()
        .reverse()
        .map((entry: any) => (
          <div key={entry.dataKey} style={{ color: entry.fill }}>
            {entry.dataKey}: <strong>{Number(entry.value).toLocaleString()}</strong>
          </div>
        ))}
    </div>
  );
};

const WeeklyOperationsRoseChart = ({ data }: { data: DayRow[] }) => {
  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-4">
      <ResponsiveContainer width="100%" height={420}>
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="4%"
          outerRadius="88%"
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis
            dataKey="day"
            tick={{ fontSize: 11, fontStyle: "italic", fontWeight: 700, fill: "#334155" }}
          />
          <PolarRadiusAxis
            angle={90}
            tick={{ fontSize: 10, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
          />

          {/* Order matters: first = innermost ring, last = outermost ring */}
          <RadialBar dataKey="Receiving" stackId="ops" fill={OPERATIONS_ROSE_COLORS.Receiving} />
          <RadialBar dataKey="Packing" stackId="ops" fill={OPERATIONS_ROSE_COLORS.Packing} />
          <RadialBar dataKey="Shipping" stackId="ops" fill={OPERATIONS_ROSE_COLORS.Shipping} />
          <RadialBar dataKey="Inventory" stackId="ops" fill={OPERATIONS_ROSE_COLORS.Inventory} />
          <RadialBar dataKey="Returns" stackId="ops" fill={OPERATIONS_ROSE_COLORS.Returns} />

          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            iconType="square"
            wrapperStyle={{ fontSize: 12 }}
          />
          <Tooltip content={renderRoseTooltip} />
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
};
// Pin + label + bold value + full-width colored progress pill, one row per
// county — styled after the compact ranked-list reference (icon, name,
// right-aligned value, thick rounded bar scaled against the top entry).
const VACCINATION_LIST_PALETTE = [
  COLORS.orange, COLORS.maroon, COLORS.teal, COLORS.darkBlue,
  COLORS.purple, COLORS.green, COLORS.yellow, COLORS.red,
];

const VaccinationAreaList = ({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) => {
  const peak = data[0]?.value || 0;

  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No vaccination data found for the selected filters.
      </div>
    );
  }

  return (
    <div className="max-h-[320px] space-y-4 overflow-y-auto pr-1 py-1">
      {data.map((entry, index) => {
        const share = peak > 0 ? (entry.value / peak) * 100 : 0;
        const color = VACCINATION_LIST_PALETTE[index % VACCINATION_LIST_PALETTE.length];
        return (
          <div key={`${entry.name}-${index}`}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                <p className="truncate text-sm font-medium text-slate-700">{entry.name}</p>
              </div>
              <p className="shrink-0 text-sm font-semibold text-slate-900">
                {Number(entry.value).toLocaleString()}
              </p>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(share, 4)}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Matches the compact cyan Apex column chart used for registration wards:
// hidden crowded x-axis labels, dashed grid, and hover-only category details.
const VaccinationSubcountyBarChart = ({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) => {
  const { categories, counts } = useMemo(() => {
    const cats: string[] = [];
    const vals: number[] = [];
    data.forEach((entry) => {
      cats.push(entry.name);
      vals.push(entry.value);
    });
    return { categories: cats, counts: vals };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No vaccination data found for the selected filters.
      </div>
    );
  }

  const options: ApexCharts.ApexOptions = {
    chart: { height: 280, background: "transparent", toolbar: { show: false }, fontFamily: "inherit", zoom: { enabled: false }, selection: { enabled: false } },
    plotOptions: {
      bar: {
        columnWidth: "80%",
        borderRadius: 0,
        borderRadiusApplication: "end",
      },
    },
    colors: ["#22d3ee"],
    xaxis: {
      categories,
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      title: { text: "Registrations", style: { fontSize: "11px", color: "#64748b" } },
      labels: { style: { fontSize: "11px" } },
    },
    grid: { borderColor: "#f1f5f9", strokeDashArray: 4 },
    dataLabels: { enabled: false },
    tooltip: {
      shared: false,
      intersect: true,
      custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
        const subcounty = categories[dataPointIndex] || "Unknown";
        const vaccinated = counts[dataPointIndex] || 0;
        return `
          <div style="padding:8px 12px;font-size:12px;line-height:1.5;">
            <div style="font-weight:600;color:#0f172a;">${subcounty}</div>
            <div style="color:#0f172a;">Vaccinated animals: <strong>${Number(vaccinated).toLocaleString()}</strong></div>
          </div>
        `;
      },
    },
    legend: { show: false },
  };

  return (
    <Chart
      options={options}
      series={[{ name: "Vaccinated Animals", data: counts }]}
      type="bar"
      height={280}
    />
  );
};

// Single-series column chart for ward registrations: every ward is plotted
// (not just a top-N slice), bars have a flat bottom with a rounded top edge
// only, and ward names stay off the axis — hovering a bar reveals the ward,
// its county, and the number of registered farmers.
const WardRegistrationChart = ({
  data,
}: {
  data: Array<{ name: string; value: number; county: string }>;
}) => {
  const { categories, counts, counties } = useMemo(() => {
    const cats: string[] = [];
    const vals: number[] = [];
    const cty: string[] = [];
    data.forEach((entry) => {
      cats.push(entry.name);
      vals.push(entry.value);
      cty.push(entry.county);
    });
    return { categories: cats, counts: vals, counties: cty };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No ward registration data found for the selected filters.
      </div>
    );
  }

  const options: ApexCharts.ApexOptions = {
    chart: { height: 280, background: "transparent", toolbar: { show: false }, fontFamily: "inherit",zoom: { enabled: false }, selection: { enabled: false } },
    plotOptions: {
      bar: {
        columnWidth: "80%",
        borderRadius: 0,
        // Rounds only the top edge of each column, leaving the bottom flat.
        borderRadiusApplication: "end",
      },
    },
    colors: ["#22d3ee"],
    xaxis: {
      categories,
      // Ward names are intentionally hidden on the axis — with dozens of
      // wards, printed labels overlap into an unreadable smear. The name
      // still surfaces in the tooltip on hover via the custom formatter below.
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      title: { text: "Registrations", style: { fontSize: "11px", color: "#64748b" } },
      labels: { style: { fontSize: "11px" } },
      // Note: ApexYAxis has no `allowDecimals` option (that's a Recharts prop).
      // Passing it here was a type error and had no runtime effect on Apex —
      // whole-number tick formatting for this count-based series is handled
      // by the default Apex y-axis label formatter, so it's simply omitted.
    },
    grid: { borderColor: "#f1f5f9", strokeDashArray: 4 },
    dataLabels: { enabled: false },
    tooltip: {
      shared: false,
      intersect: true,
      custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
        const ward = categories[dataPointIndex] || "Unknown";
        const county = counties[dataPointIndex] || "Unknown";
        const farmers = counts[dataPointIndex] || 0;
        return `
          <div style="padding:8px 12px;font-size:12px;line-height:1.5;">
            <div style="font-weight:600;color:#0f172a;">${ward}</div>
            <div style="color:#64748b;">County: ${county}</div>
            <div style="color:#0f172a;">Farmers registered: <strong>${Number(farmers).toLocaleString()}</strong></div>
          </div>
        `;
      },
    },
    legend: { show: false },
  };

  return (
    <Chart
      options={options}
      series={[{ name: "Ward Registrations", data: counts }]}
      type="bar"
      height={280}
    />
  );
};

// --- Main Component ---

const PerformanceReport = () => {
  const { userRole, userAttribute, userName, allowedProgrammes } = useAuth();
  const currentMonthDates = useMemo(() => getCurrentMonthDates(), []);
  
  const cacheRef = useRef<{
    farmers: Farmer[] | null;
    training: TrainingRecord[] | null;
    animalHealth: AnimalHealthRecord[] | null;
    offtakes: OfftakeRecord[] | null;
    hayStorage: any[] | null;
    fodderFarmers: FodderFarmerRecord[] | null;
    boreholes: BoreholeRecord[] | null;
    programmes: string;
    timestamp: number;
  }>({ farmers: null, training: null, animalHealth: null, offtakes: null, hayStorage: null, fodderFarmers: null, boreholes: null, programmes: "", timestamp: 0 });
  
  const [loading, setLoading] = useState(true);
  const [allFarmers, setAllFarmers] = useState<Farmer[]>([]);
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);
  const [animalHealthActivities, setAnimalHealthActivities] = useState<AnimalHealthRecord[]>([]);
  const [offtakeRecords, setOfftakeRecords] = useState<OfftakeRecord[]>([]);
  const [hayStorageRecords, setHayStorageRecords] = useState<any[]>([]);
  const [fodderFarmersRecords, setFodderFarmersRecords] = useState<FodderFarmerRecord[]>([]);
  const [boreholesRecords, setBoreholesRecords] = useState<BoreholeRecord[]>([]);
  const [staffDirectoryRecords, setStaffDirectoryRecords] = useState<StaffDirectoryRecord[]>([]);
  const [staffMarkRecords, setStaffMarkRecords] = useState<StaffMarkRecord[]>([]);
  const [createStaffForm, setCreateStaffForm] = useState<CreateStaffFormState>(createDefaultStaffForm);
  const [staffMarkForm, setStaffMarkForm] = useState<StaffMarkFormState>(createDefaultStaffMarkForm);
  const [isCreateStaffOpen, setIsCreateStaffOpen] = useState(false);
  const [editingStaffRow, setEditingStaffRow] = useState<StaffManagementRow | null>(null);
  const [isAwardDialogOpen, setIsAwardDialogOpen] = useState(false);
  const [selectedStaffRow, setSelectedStaffRow] = useState<StaffManagementRow | null>(null);
  const [isSavingStaffDirectory, setIsSavingStaffDirectory] = useState(false);
  const [isSavingStaffMark, setIsSavingStaffMark] = useState(false);
  
  const [dateRange, setDateRange] = useState(() => getCurrentMonthDates());
  const [timeFrame, setTimeFrame] = useState<'weekly' | 'monthly' | 'yearly'>('yearly');
  const [registrationTrendMode, setRegistrationTrendMode] = useState<"auto" | "yearly">("yearly");

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<string>(ALL_YEARS_VALUE);
  const [selectedCounty, setSelectedCounty] = useState<string>(ALL_COUNTIES_VALUE);
  const [quarterlyReportYear, setQuarterlyReportYear] = useState(String(currentYear));
  
  const availableYears = useMemo(() => {
    const years: string[] = [];
    for(let i = 0; i < 5; i++) {
      years.push(String(currentYear - i));
    }
    return years;
  }, [currentYear]);

  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute, allowedProgrammes),
    [allowedProgrammes, userRole, userAttribute]
  );
  const accessibleProgrammes = useMemo(
    () => resolveAccessibleProgrammes(userCanViewAllProgrammeData, allowedProgrammes),
    [allowedProgrammes, userCanViewAllProgrammeData]
  );
  const reportAudience = useMemo(
    () => resolveReportAudience(userRole, userAttribute),
    [allowedProgrammes, userRole, userAttribute]
  );
  const showHrStaffTools = false;
  const reportViewProfile = REPORT_VIEW_PROFILES[reportAudience];
  const hasSection = useCallback(
    (section: ReportSectionId) => reportViewProfile.sections.includes(section),
    [reportViewProfile.sections]
  );
  const showProgrammeFilter = accessibleProgrammes.length > 1;
  const canViewAllReportProgrammes = userCanViewAllProgrammeData || accessibleProgrammes.length > 1;
  const [activeProgram, setActiveProgram] = useSharedProgrammeSelection(accessibleProgrammes, {
    allowAll: canViewAllReportProgrammes,
    fallbackToAll: accessibleProgrammes.length > 1,
  });
  const appliedDefaultProgrammeRef = useRef(false);

  useEffect(() => {
    if (appliedDefaultProgrammeRef.current || accessibleProgrammes.length <= 1) return;
    appliedDefaultProgrammeRef.current = true;
    setActiveProgram(ALL_PROGRAMMES_VALUE);
  }, [accessibleProgrammes.length, setActiveProgram]);

  const filterStripRef = useRef<HTMLDivElement | null>(null);
  
  const selectedYearNum = useMemo(() => {
    const parsed = parseInt(selectedYear, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [selectedYear]);
  const countyOptions = useMemo(() => {
    const counties = new Map<string, string>();
    const addCounty = (value: unknown) => {
      const county = String(value || "").trim();
      if (!county) return;
      const key = normalizeCountyFilterValue(county);
      if (key && !counties.has(key)) counties.set(key, county);
    };

    allFarmers.forEach((record) => addCounty(record.county));
    trainingRecords.forEach((record) => addCounty(record.county));
    animalHealthActivities.forEach((record) => addCounty(record.county));
    offtakeRecords.forEach((record) => addCounty((record as any).county ?? (record as any).County));
    hayStorageRecords.forEach((record) => addCounty(record.county || record.County));
    fodderFarmersRecords.forEach((record) => addCounty(record.county));
    boreholesRecords.forEach((record) => addCounty(record.county || record.County));

    return Array.from(counties.values()).sort((left, right) => left.localeCompare(right));
  }, [allFarmers, animalHealthActivities, boreholesRecords, fodderFarmersRecords, hayStorageRecords, offtakeRecords, trainingRecords]);
  const allowedProgrammeSet = useMemo(
    () =>
      userCanViewAllProgrammeData ?
        null :
        new Set(accessibleProgrammes.map((programme) => normalizeProgramme(programme))),
    [accessibleProgrammes, userCanViewAllProgrammeData],
  );
  
  const { data, isLoading: analysisLoading, isError: analysisError } = useProcessedData(
    allFarmers,
    trainingRecords,
    animalHealthActivities,
    offtakeRecords,
    staffMarkRecords,
    dateRange,
    timeFrame,
    activeProgram || null,
    selectedYearNum,
    userCanViewAllProgrammeData,
    selectedCounty,
  );
  const projectManagerBreedsByLocationData = useMemo(
    () => buildLocationMetricSeries(data.breedsByLocationData),
    [data.breedsByLocationData],
  );
  const projectManagerVaccinesByLocationData = useMemo(
    () => buildLocationMetricSeries(data.dosesByLocationData),
    [data.dosesByLocationData],
  );
  const queryableProgrammes = useMemo(
    () => Array.from(new Set(accessibleProgrammes)),
    [accessibleProgrammes],
  );
  const programmeCacheKey = useMemo(
    () => `v2|${queryableProgrammes.join("|")}`,
    [queryableProgrammes],
  );
  const reportFetchOptions = useMemo(
    () => ({
      ttlMs: CACHE_DURATION,
      noDateFilter: true,
    }),
    [],
  );
  const reportCacheKey = useMemo(
    () => programmeCacheKey,
    [programmeCacheKey],
  );

  const fetchReportCollection = useCallback(
    async <T extends Record<string, any>>(path: string) => {
      if (queryableProgrammes.length === 0) return [];
      // Wrapped in withRetry so a single transient failure (network blip, momentary
      // Firebase timeout) doesn't immediately surface as a user-facing error toast.
      return withRetry(() => fetchCollectionByProgrammes<T>(path, queryableProgrammes, reportFetchOptions));
    },
    [queryableProgrammes, reportFetchOptions],
  );

  const fetchAllData = useCallback(async () => {
    if (USE_REMOTE_ANALYTICS) {
      setLoading(false);
      return;
    }

    if (queryableProgrammes.length === 0) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const now = Date.now();
      let farmersList: Farmer[] = [];
      let trainingList: TrainingRecord[] = [];
      let animalHealthList: AnimalHealthRecord[] = [];
      let offtakeList: OfftakeRecord[] = [];

      if (cacheRef.current.farmers && 
          cacheRef.current.training && 
          cacheRef.current.animalHealth &&
          cacheRef.current.offtakes &&
          cacheRef.current.hayStorage &&
          cacheRef.current.fodderFarmers &&
          cacheRef.current.boreholes &&
          cacheRef.current.programmes === reportCacheKey &&
          (now - cacheRef.current.timestamp < CACHE_DURATION)) {
        farmersList = cacheRef.current.farmers;
        trainingList = cacheRef.current.training;
        animalHealthList = cacheRef.current.animalHealth;
        offtakeList = cacheRef.current.offtakes;
        setHayStorageRecords(cacheRef.current.hayStorage);
        setFodderFarmersRecords(cacheRef.current.fodderFarmers);
        setBoreholesRecords(cacheRef.current.boreholes);
      } else {
        // NOTE: `boreholes` is intentionally NOT in the batch array. The batch
        // function uses Promise.all internally, so a single rejection (e.g.
        // permission-denied on the new `boreholes` collection) would throw
        // the entire batch and abort fetchAllData. Instead, boreholes is
        // fetched via the per-collection fallback path below, which uses
        // Promise.allSettled — so its rejection is isolated and the rest of
        // the dashboard still loads. Same goes for fodderFarmers (also a newer
        // collection whose Firebase rules may not yet be deployed).
        let batchResult: Record<string, any> = {};
        try {
          batchResult = await fetchCollectionsBatch<Record<string, any>>([
            { key: "farmers", path: "farmers", programmes: queryableProgrammes, options: reportFetchOptions },
            { key: "training", path: "capacityBuilding", programmes: queryableProgrammes, options: reportFetchOptions },
            { key: "animalHealth", path: "AnimalHealthActivities", programmes: queryableProgrammes, options: reportFetchOptions },
            { key: "offtakes", path: "offtakes", programmes: queryableProgrammes, options: reportFetchOptions },
            { key: "hayStorage", path: "HayStorage", programmes: queryableProgrammes, options: reportFetchOptions },
            { key: "fodderFarmers", path: "fodderFarmers", programmes: queryableProgrammes, options: reportFetchOptions },
          ]);
        } catch (batchError) {
          // Batch failed (likely one collection rejected inside the batch's
          // internal Promise.all). Fall through with an empty batchResult so
          // every collection goes through its per-collection fallback below —
          // Promise.allSettled will isolate any further rejections cleanly.
          console.warn("Batch fetch failed, falling back to per-collection fetches", batchError);
          batchResult = {};
        }

        // Keep the existing per-collection fallback path. It protects the report
        // if the deployed batch function is missing or temporarily failing.
        const [
          farmersResult,
          trainingResult,
          animalHealthResult,
          offtakeResult,
          hayStorageResult,
          fodderFarmersResult,
          boreholesResult,
        ] = await Promise.allSettled([
          Object.prototype.hasOwnProperty.call(batchResult, "farmers") ? Promise.resolve(batchResult.farmers as Farmer[]) : fetchReportCollection<Farmer>("farmers"),
          Object.prototype.hasOwnProperty.call(batchResult, "training") ? Promise.resolve(batchResult.training as TrainingRecord[]) : fetchReportCollection<TrainingRecord>("capacityBuilding"),
          Object.prototype.hasOwnProperty.call(batchResult, "animalHealth") ? Promise.resolve(batchResult.animalHealth as AnimalHealthRecord[]) : fetchReportCollection<AnimalHealthRecord>("AnimalHealthActivities"),
          Object.prototype.hasOwnProperty.call(batchResult, "offtakes") ? Promise.resolve(batchResult.offtakes as OfftakeRecord[]) : fetchReportCollection<OfftakeRecord>("offtakes"),
          Object.prototype.hasOwnProperty.call(batchResult, "hayStorage") ? Promise.resolve(batchResult.hayStorage) : fetchReportCollection<any>("HayStorage"),
          Object.prototype.hasOwnProperty.call(batchResult, "fodderFarmers") ? Promise.resolve(batchResult.fodderFarmers as FodderFarmerRecord[]) : fetchReportCollection<FodderFarmerRecord>("fodderFarmers"),
          // Boreholes is always fetched via the per-collection path (not the
          // batch) because it's the newest collection and most likely to be
          // missing Firebase read rules. Promise.allSettled isolates the
          // rejection so the rest of the dashboard still loads.
          // Borehole records are stored in BoreholeStorage and may be nested
          // beneath programme keys, so query the collection root and flatten it.
          get(ref(db, "BoreholeStorage")).then((snapshot) => flattenBoreholeStorage(snapshot.val())),
        ]);

        // Core collections are the ones the whole dashboard is built around —
        // farmers, training, animal-health, offtakes. If any of those fail we
        // want the cache marked stale and the user notified, because the
        // numbers on the cards will be wrong.
        const coreCollectionsFailed =
          farmersResult.status === "rejected" ||
          trainingResult.status === "rejected" ||
          animalHealthResult.status === "rejected" ||
          offtakeResult.status === "rejected";

        // Infrastructure collections (hay storage, fodder farmers, boreholes)
        // are treated as optional. They're newer additions and may not yet
        // have read rules in Firebase security rules — a permission-denied
        // on one of them shouldn't break the rest of the dashboard or
        // trigger an aggressive refetch loop. The empty-state fallbacks on
        // the affected charts (e.g. "No borehole data found") handle the UX.
        const infrastructureCollectionsFailed =
          hayStorageResult.status === "rejected" ||
          fodderFarmersResult.status === "rejected" ||
          boreholesResult.status === "rejected";

        if (coreCollectionsFailed) {
          // Only the core failures surface a user-facing toast — infrastructure
          // failures are logged quietly so missing read rules on a new
          // collection don't pepper the user with "couldn't refresh" popups.
          console.error("Some performance report collections failed to load", {
            farmers: farmersResult.status === "rejected" ? farmersResult.reason : undefined,
            training: trainingResult.status === "rejected" ? trainingResult.reason : undefined,
            animalHealth: animalHealthResult.status === "rejected" ? animalHealthResult.reason : undefined,
            offtakes: offtakeResult.status === "rejected" ? offtakeResult.reason : undefined,
            hayStorage: hayStorageResult.status === "rejected" ? hayStorageResult.reason : undefined,
            fodderFarmers: fodderFarmersResult.status === "rejected" ? fodderFarmersResult.reason : undefined,
            boreholes: boreholesResult.status === "rejected" ? boreholesResult.reason : undefined,
          });
          toast({
            title: "Some data couldn't refresh",
            description: "Showing the most recent data we have. The report will try again automatically.",
            variant: "destructive",
          });
        } else if (infrastructureCollectionsFailed) {
          // Quiet log only — these are typically "collection not in security
          // rules yet" errors, not real failures. The affected chart will
          // show its empty state.
          console.warn("Optional infrastructure collections skipped (likely missing Firebase read rules)", {
            hayStorage: hayStorageResult.status === "rejected" ? hayStorageResult.reason : undefined,
            fodderFarmers: fodderFarmersResult.status === "rejected" ? fodderFarmersResult.reason : undefined,
            boreholes: boreholesResult.status === "rejected" ? boreholesResult.reason : undefined,
          });
        }

        const farmersRaw = farmersResult.status === "fulfilled" ? farmersResult.value : cacheRef.current.farmers ?? [];
        const trainingRaw = trainingResult.status === "fulfilled" ? trainingResult.value : cacheRef.current.training ?? [];
        const animalHealthRaw = animalHealthResult.status === "fulfilled" ? animalHealthResult.value : cacheRef.current.animalHealth ?? [];
        const offtakeRaw = offtakeResult.status === "fulfilled" ? offtakeResult.value : cacheRef.current.offtakes ?? [];
        const hayStorageRaw = hayStorageResult.status === "fulfilled" ? hayStorageResult.value : cacheRef.current.hayStorage ?? [];
        const fodderFarmersRaw = fodderFarmersResult.status === "fulfilled" ? fodderFarmersResult.value : cacheRef.current.fodderFarmers ?? [];
        const boreholesRaw = boreholesResult.status === "fulfilled" ? boreholesResult.value : cacheRef.current.boreholes ?? [];

        farmersList = farmersRaw.map((record) => ({
          ...record,
          goats: record.goats || { total: 0, male: 0, female: 0 },
          sheep: record.sheep || 0,
          cattle: record.cattle || 0,
          vaccinated: record.vaccinated || false,
          vaccines: record.vaccines || [],
          femaleBreeds: record.femaleBreeds || 0,
          maleBreeds: record.maleBreeds || 0,
          programme: record.programme || undefined,
        }));

        trainingList = trainingRaw.map((record) => ({
          ...record,
          programme: record.programme || undefined,
        }));

        animalHealthList = animalHealthRaw.map((record) => ({
          ...record,
          date: record.date || "",
          createdAt: record.createdAt,
          programme: record.programme || undefined,
          county: record.county || "",
          subcounty: record.subcounty || "",
          location: record.location || record.subcounty || record.county || "",
          vaccines: Array.isArray(record.vaccines) ? record.vaccines : undefined,
          vaccinetype: record.vaccinetype || undefined,
          number_doses: record.number_doses,
        }));

        offtakeList = offtakeRaw.map((record) => ({
          ...record,
          date: record.date,
          Date: record.Date,
          createdAt: record.createdAt,
          programme: record.programme || undefined,
          totalGoats: record.totalGoats,
          goatsBought: record.goatsBought,
          goats: record.goats,
          Goats: record.Goats,
        }));

        cacheRef.current = {
          farmers: farmersList,
          training: trainingList,
          animalHealth: animalHealthList,
          offtakes: offtakeList,
          hayStorage: hayStorageRaw,
          fodderFarmers: fodderFarmersRaw,
          boreholes: boreholesRaw,
          programmes: reportCacheKey,
          // Only mark the cache as "fresh" when every CORE collection actually
          // loaded. Infrastructure collection failures (hay storage, fodder
          // farmers, boreholes — typically missing Firebase read rules) don't
          // invalidate the cache, otherwise every tab focus would trigger a
          // refetch storm against a collection that will keep rejecting.
          // Core failures still mark the cache stale so the next visibility
          // tick retries them automatically.
          timestamp: coreCollectionsFailed ? 0 : now,
        };
        setHayStorageRecords(hayStorageRaw);
        setFodderFarmersRecords(fodderFarmersRaw);
        setBoreholesRecords(boreholesRaw);
      }

      setAllFarmers(farmersList);
      setTrainingRecords(trainingList);
      setAnimalHealthActivities(animalHealthList);
      setOfftakeRecords(offtakeList);
      
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, [fetchReportCollection, queryableProgrammes.length, reportCacheKey, toast]);

  const fetchStaffDirectory = useCallback(async () => {
    if (!showHrStaffTools) {
      setStaffDirectoryRecords((current) => (current.length > 0 ? EMPTY_STAFF_DIRECTORY_RECORDS : current));
      return;
    }

    try {
      const staffDirectory = await fetchReportCollection<StaffDirectoryRecord>("hrStaffDirectory");
      const filteredDirectory = staffDirectory
        .filter((record) => {
          if (!allowedProgrammeSet) return true;
          const programme = getReportRecordProgramme(record);
          return allowedProgrammeSet.has(programme);
        })
        .sort((first, second) => {
          const firstDate = parseDate(second.createdAt || second.updatedAt)?.getTime() || 0;
          const secondDate = parseDate(first.createdAt || first.updatedAt)?.getTime() || 0;
          return firstDate - secondDate;
      });

      setStaffDirectoryRecords(filteredDirectory);
    } catch (error) {
      console.error("Error fetching HR staff directory:", error);
      toast({
        title: "Error",
        description: "Unable to load the HR staff list at the moment.",
        variant: "destructive",
      });
    }
  }, [allowedProgrammeSet, fetchReportCollection, showHrStaffTools, toast]);

  const fetchStaffMarks = useCallback(async () => {
    if (!showHrStaffTools) {
      setStaffMarkRecords((current) => (current.length > 0 ? EMPTY_STAFF_MARK_RECORDS : current));
      return;
    }

    try {
      const marks = (await fetchReportCollection<StaffMarkRecord>("hrStaffMarks"))
        .filter((record) => {
          if (!allowedProgrammeSet) return true;
          const programme = getReportRecordProgramme(record);
          return allowedProgrammeSet.has(programme);
        })
        .sort((a, b) => {
          const first = parseDate(b.dateAwarded || b.createdAt)?.getTime() || 0;
          const second = parseDate(a.dateAwarded || a.createdAt)?.getTime() || 0;
          return first - second;
        });

      setStaffMarkRecords(marks);
    } catch (error) {
      console.error("Error fetching HR staff marks:", error);
      toast({
        title: "Error",
        description: "Unable to load staff marks at the moment.",
        variant: "destructive",
      });
    }
  }, [allowedProgrammeSet, fetchReportCollection, showHrStaffTools, toast]);

  const filteredStaffMarkRecords = useMemo(
    () => {
      if (!showHrStaffTools) return EMPTY_STAFF_MARK_RECORDS;
      return (
      staffMarkRecords.filter((record) => {
        const recordDate = record.dateAwarded || record.createdAt;
        return matchesProgrammeSelection(getReportRecordProgramme(record), activeProgram, userCanViewAllProgrammeData) &&
          isDateInRange(recordDate, dateRange.startDate, dateRange.endDate);
      })
      );
    },
    [activeProgram, dateRange.endDate, dateRange.startDate, showHrStaffTools, staffMarkRecords, userCanViewAllProgrammeData],
  );

  const filteredStaffDirectoryRecords = useMemo(
    () => {
      if (!showHrStaffTools) return EMPTY_STAFF_DIRECTORY_RECORDS;
      return (
      staffDirectoryRecords.filter((record) => {
        return matchesProgrammeSelection(getReportRecordProgramme(record), activeProgram, userCanViewAllProgrammeData);
      })
      );
    },
    [activeProgram, showHrStaffTools, staffDirectoryRecords, userCanViewAllProgrammeData],
  );

  const staffManagementRows = useMemo(() => {
    if (!showHrStaffTools) return EMPTY_STAFF_MANAGEMENT_ROWS;

    const rows = new Map<string, StaffManagementRow>();
    const marksByStaff = new Map<string, {
      totalMarks: number;
      awardCount: number;
      lastAwardDate: string;
      lastAwardTimestamp: number;
      lastAwardNote: string;
      displayName: string;
    }>();

    filteredStaffMarkRecords.forEach((record) => {
      const staffName = getLeaderName(record.staffName, "");
      const normalizedName = normalizeStaffName(staffName);
      if (!normalizedName) return;

      const marks = getNumberField(record, "marks", "score", "awardedMarks");
      const awardTimestamp = parseDate(record.dateAwarded || record.createdAt)?.getTime() || 0;
      const current = marksByStaff.get(normalizedName) || {
        totalMarks: 0,
        awardCount: 0,
        lastAwardDate: "N/A",
        lastAwardTimestamp: 0,
        lastAwardNote: "",
        displayName: staffName,
      };

      current.totalMarks += marks;
      current.awardCount += 1;
      if (awardTimestamp >= current.lastAwardTimestamp) {
        current.lastAwardTimestamp = awardTimestamp;
        current.lastAwardDate = formatDisplayDate(record.dateAwarded || record.createdAt);
        current.lastAwardNote = record.note?.trim() || "";
        current.displayName = staffName || current.displayName;
      }
      marksByStaff.set(normalizedName, current);
    });

    filteredStaffDirectoryRecords.forEach((record) => {
      const staffName = getLeaderName(record.staffName, "Unnamed staff");
      const normalizedName = normalizeStaffName(staffName);
      const markSummary = marksByStaff.get(normalizedName);
      rows.set(normalizedName || record.id, {
        id: record.id,
        staffName,
        role: record.role?.trim() || "Not assigned",
        county: record.county?.trim() || "N/A",
        phone: record.phone?.trim() || "N/A",
        programme: getReportRecordProgramme(record) || activeProgram || "N/A",
        status: record.status?.trim() || "active",
        notes: record.notes?.trim() || "",
        totalMarks: markSummary?.totalMarks || 0,
        awardCount: markSummary?.awardCount || 0,
        lastAwardDate: markSummary?.lastAwardDate || "Not awarded",
        lastAwardNote: markSummary?.lastAwardNote || "",
        managedInDirectory: true,
      });
    });

    marksByStaff.forEach((markSummary, normalizedName) => {
      if (rows.has(normalizedName)) return;
      rows.set(normalizedName, {
        id: `marks-${normalizedName}`,
        staffName: markSummary.displayName || "Unlisted staff",
        role: "Not in staff list",
        county: "N/A",
        phone: "N/A",
        programme: activeProgram || "N/A",
        status: "marks-only",
        notes: "",
        totalMarks: markSummary.totalMarks,
        awardCount: markSummary.awardCount,
        lastAwardDate: markSummary.lastAwardDate,
        lastAwardNote: markSummary.lastAwardNote,
        managedInDirectory: false,
      });
    });

    return [...rows.values()].sort((first, second) => {
      if (first.managedInDirectory !== second.managedInDirectory) {
        return first.managedInDirectory ? -1 : 1;
      }
      if (first.status !== second.status) {
        return first.status === "active" ? -1 : 1;
      }
      if (second.totalMarks !== first.totalMarks) {
        return second.totalMarks - first.totalMarks;
      }
      return first.staffName.localeCompare(second.staffName);
    });
  }, [activeProgram, filteredStaffDirectoryRecords, filteredStaffMarkRecords, showHrStaffTools]);

  const openCreateStaffDialog = useCallback(() => {
    setEditingStaffRow(null);
    setCreateStaffForm(createDefaultStaffForm());
    setIsCreateStaffOpen(true);
  }, []);

  const openEditStaffDialog = useCallback((staffRow: StaffManagementRow) => {
    setEditingStaffRow(staffRow);
    setCreateStaffForm({
      staffName: staffRow.staffName,
      role: staffRow.role === "Not assigned" ? "" : staffRow.role,
      county: staffRow.county === "N/A" ? "" : staffRow.county,
      phone: staffRow.phone === "N/A" ? "" : staffRow.phone,
      notes: staffRow.notes,
    });
    setIsCreateStaffOpen(true);
  }, []);

  const openAwardDialog = useCallback((staffRow: StaffManagementRow | null = null) => {
    setSelectedStaffRow(staffRow);
    setStaffMarkForm({
      ...createDefaultStaffMarkForm(),
      staffName: staffRow?.staffName || "",
    });
    setIsAwardDialogOpen(true);
  }, []);

  const handleCreateStaff = useCallback(async () => {
    const staffName = createStaffForm.staffName.trim();
    const role = createStaffForm.role.trim();

    if (!staffName || !role) {
      toast({
        title: "Staff details required",
        description: "Enter at least the staff name and role.",
        variant: "destructive",
      });
      return;
    }

    if (!activeProgram || activeProgram === ALL_PROGRAMMES_VALUE) {
      toast({
        title: "Programme required",
        description: "Select a specific programme before saving staff.",
        variant: "destructive",
      });
      return;
    }

    const alreadyExists = staffDirectoryRecords.some((record) =>
      record.id !== editingStaffRow?.id &&
      normalizeStaffName(record.staffName) === normalizeStaffName(staffName) &&
      getReportRecordProgramme(record) === normalizeProgramme(activeProgram),
    );

    if (alreadyExists) {
      toast({
        title: "Staff already exists",
        description: `${staffName} is already in the HR staff table for ${activeProgram}.`,
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSavingStaffDirectory(true);
      const payload = {
        staffName,
        role,
        county: createStaffForm.county.trim(),
        phone: createStaffForm.phone.trim(),
        notes: createStaffForm.notes.trim(),
        programme: normalizeProgramme(activeProgram),
        Programme: normalizeProgramme(activeProgram),
        status: editingStaffRow?.status || "active",
        updatedAt: Date.now(),
        updatedBy: userName || "HR Manager",
      };

      if (editingStaffRow) {
        await update(ref(db, `hrStaffDirectory/${editingStaffRow.id}`), payload);
      } else {
        await push(ref(db, "hrStaffDirectory"), {
          ...payload,
          status: "active",
          createdAt: Date.now(),
          createdBy: userName || "HR Manager",
        });
      }

      invalidateCollectionCache("hrStaffDirectory");
      setCreateStaffForm(createDefaultStaffForm());
      setEditingStaffRow(null);
      setIsCreateStaffOpen(false);
      await fetchStaffDirectory();
      toast({
        title: editingStaffRow ? "Staff updated" : "Staff created",
        description: editingStaffRow ?
          `${staffName} has been updated in the HR staff table.` :
          `${staffName} is now available in the HR staff table.`,
      });
    } catch (error) {
      console.error("Error saving HR staff:", error);
      toast({
        title: editingStaffRow ? "Update failed" : "Create failed",
        description: "We could not save the staff record right now.",
        variant: "destructive",
      });
    } finally {
      setIsSavingStaffDirectory(false);
    }
  }, [activeProgram, createStaffForm, editingStaffRow, fetchStaffDirectory, staffDirectoryRecords, toast, userName]);

  const handleToggleStaffStatus = useCallback(async (staffRow: StaffManagementRow) => {
    if (!staffRow.managedInDirectory) return;

    const nextStatus = staffRow.status === "active" ? "inactive" : "active";

    try {
      await update(ref(db, `hrStaffDirectory/${staffRow.id}`), {
        status: nextStatus,
        updatedAt: Date.now(),
        updatedBy: userName || "HR Manager",
      });
      invalidateCollectionCache("hrStaffDirectory");
      await fetchStaffDirectory();
      toast({
        title: "Staff updated",
        description: `${staffRow.staffName} is now ${nextStatus}.`,
      });
    } catch (error) {
      console.error("Error updating HR staff status:", error);
      toast({
        title: "Update failed",
        description: "We could not update the staff status right now.",
      variant: "destructive",
      });
    }
  }, [fetchStaffDirectory, toast, userName]);

  const handleDeleteStaff = useCallback(async (staffRow: StaffManagementRow) => {
    if (!staffRow.managedInDirectory) return;

    const confirmed = window.confirm(`Delete ${staffRow.staffName} from the HR staff table?`);
    if (!confirmed) return;

    try {
      setIsSavingStaffDirectory(true);
      await remove(ref(db, `hrStaffDirectory/${staffRow.id}`));
      if (selectedStaffRow?.id === staffRow.id) {
        setSelectedStaffRow(null);
      }
      invalidateCollectionCache("hrStaffDirectory");
      await fetchStaffDirectory();
      toast({
        title: "Staff deleted",
        description: `${staffRow.staffName} has been removed from the HR staff table.`,
      });
    } catch (error) {
      console.error("Error deleting HR staff:", error);
      toast({
        title: "Delete failed",
        description: "We could not delete the staff record right now.",
        variant: "destructive",
      });
    } finally {
      setIsSavingStaffDirectory(false);
    }
  }, [fetchStaffDirectory, selectedStaffRow, toast]);

  const handleStaffMarkSubmit = useCallback(async () => {
    const staffName = staffMarkForm.staffName.trim();
    const marks = parseNumericValue(staffMarkForm.marks);

    if (!staffName) {
      toast({
        title: "Staff name required",
        description: "Enter the staff member you want to score.",
        variant: "destructive",
      });
      return;
    }

    if (!activeProgram || activeProgram === ALL_PROGRAMMES_VALUE) {
      toast({
        title: "Programme required",
        description: "Select a specific programme before awarding marks.",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isFinite(marks) || marks <= 0 || marks > 100) {
      toast({
        title: "Invalid marks",
        description: "Enter marks between 1 and 100.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSavingStaffMark(true);
      await push(ref(db, "hrStaffMarks"), {
        staffName,
        marks,
        note: staffMarkForm.note.trim(),
        programme: normalizeProgramme(activeProgram),
        Programme: normalizeProgramme(activeProgram),
        dateAwarded: staffMarkForm.dateAwarded || formatDateToLocal(new Date()),
        createdAt: Date.now(),
        awardedBy: userName || "HR Manager",
        periodStart: dateRange.startDate || "",
        periodEnd: dateRange.endDate || "",
      });

      invalidateCollectionCache("hrStaffMarks");
      setStaffMarkForm(createDefaultStaffMarkForm());
      setSelectedStaffRow(null);
      setIsAwardDialogOpen(false);
      await fetchStaffMarks();
      toast({
        title: "Marks saved",
        description: `${staffName} has been scored successfully.`,
      });
    } catch (error) {
      console.error("Error saving HR staff marks:", error);
      toast({
        title: "Save failed",
        description: "We could not save the staff marks right now.",
        variant: "destructive",
      });
    } finally {
      setIsSavingStaffMark(false);
    }
  }, [activeProgram, dateRange.endDate, dateRange.startDate, fetchStaffMarks, staffMarkForm, toast, userName]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    fetchStaffDirectory();
  }, [fetchStaffDirectory]);

  useEffect(() => {
    fetchStaffMarks();
  }, [fetchStaffMarks]);

  // Auto-refresh whenever the tab regains focus/visibility and the cached data has
  // gone stale, so records created elsewhere in the app while this tab was in the
  // background show up without the user needing to manually refresh.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - cacheRef.current.timestamp >= STALE_AFTER_MS) {
        fetchAllData();
      }
      fetchStaffDirectory();
      fetchStaffMarks();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [fetchAllData, fetchStaffDirectory, fetchStaffMarks]);

  const scrollFilterStripBy = useCallback((direction: "left" | "right") => {
    const strip = filterStripRef.current;
    if (!strip) return;
    const delta = Math.max(220, Math.floor(strip.clientWidth * 0.75));
    strip.scrollBy({ left: direction === "left" ? -delta : delta, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const strip = filterStripRef.current;
    if (!strip) return;

    const handleResize = () => {
      strip.scrollTo({ left: Math.min(strip.scrollLeft, Math.max(0, strip.scrollWidth - strip.clientWidth)), behavior: "auto" });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const handleDateRangeChange = useCallback((key: string, value: string) => {
    setDateRange(prev => ({ ...prev, [key]: value }));
    setRegistrationTrendMode("auto");
  }, []);

  const handleYearChange = useCallback((year: string) => {
    if (year === ALL_YEARS_VALUE) {
      setSelectedYear(ALL_YEARS_VALUE);
      setDateRange({
        startDate: "",
        endDate: "",
      });
      setTimeFrame('yearly');
      setRegistrationTrendMode("auto");
      return;
    }
    const yearNum = parseInt(year, 10);
    setSelectedYear(year);
    setDateRange({ 
      startDate: `${yearNum}-01-01`, 
      endDate: `${yearNum}-12-31` 
    });
    setTimeFrame('yearly'); 
    setRegistrationTrendMode("auto");
  }, []);

  // --- Updated Clear Filters ---
  const clearFilters = useCallback(() => {
    setSelectedYear(ALL_YEARS_VALUE);
    setSelectedCounty(ALL_COUNTIES_VALUE);
    setDateRange({
      startDate: "",
      endDate: "",
    });
    setTimeFrame('yearly');
    setRegistrationTrendMode("auto");
  }, []);

  const setWeekFilter = useCallback(() => {
    const dates = getCurrentWeekDates();
    setDateRange(dates);
    setTimeFrame('weekly');
    setSelectedYear(String(currentYear));
    setRegistrationTrendMode("auto");
  }, []);

  const setMonthFilter = useCallback(() => {
    const dates = getCurrentMonthDates();
    setDateRange(dates);
    setTimeFrame('monthly');
    setSelectedYear(String(currentYear));
    setRegistrationTrendMode("auto");
  }, []);

  const setYearFilter = useCallback(() => {
    setSelectedYear(String(currentYear));
    setDateRange({
      startDate: `${currentYear}-01-01`,
      endDate: `${currentYear}-12-31`,
    });
    setTimeFrame('yearly');
    setRegistrationTrendMode("auto");
  }, [currentYear]);

  const renderCustomizedLabel = useCallback(({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if (percent === 0) return null;
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text 
        x={x} 
        y={y} 
        fill="#111827" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        fontSize="10"
        fontWeight="700"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  }, []);

  const topFieldOfficerPeak = data.topFieldOfficers[0]?.value || 0;
  const topCustomerPeak = data.topCustomers[0]?.value || 0;
  const registrationTrendChartData = useMemo(
    () =>
      registrationTrendMode === "yearly" && data.registrationTrendComparisonData.length > 0 ?
        data.registrationTrendComparisonData :
        data.registrationTrendData,
    [data.registrationTrendComparisonData, data.registrationTrendData, registrationTrendMode],
  );

  const trainingStatsSubtext = useMemo(() => {
    const totalTrainingConducted = trainingRecords.length;
    const totalParticipants = trainingRecords.reduce((sum, r) => sum + getNumberField(r, "totalFarmers"), 0);
    const avgAttendance = totalTrainingConducted > 0 ? Math.round(totalParticipants / totalTrainingConducted) : 0;
    return `Training : ${totalTrainingConducted} | Avg Attendance: ${avgAttendance}`;
  }, [trainingRecords]);

  const {
    totalBalesHarvested,
    totalBalesPurchased,
    totalBalesSold,
    totalBalesBalance,
    totalRevenue,
    averageRevenue,
  } = useMemo(() => {
    const harvested = hayStorageRecords.reduce((sum: number, r: any) => sum + (r.bales_harvested_stored || 0), 0);
    const purchased = hayStorageRecords.reduce((sum: number, r: any) => sum + (r.bales_purchased_stored || 0), 0);
    const sold = hayStorageRecords.reduce((sum: number, r: any) => sum + (r.bales_sold || 0), 0);
    const revenue = hayStorageRecords.reduce((sum: number, r: any) => sum + (r.revenue_generated || 0), 0);
    const recordCount = hayStorageRecords.length;
    // Average revenue per hay-storage record — what the revenue card under
    // Infrastructure & Fodder Farmers now surfaces (instead of the lump sum,
    // which lived on this card before).
    const avgRevenue = recordCount > 0 ? Math.round(revenue / recordCount) : 0;
    return {
      totalBalesHarvested: harvested,
      totalBalesPurchased: purchased,
      totalBalesSold: sold,
      totalBalesBalance: harvested + purchased - sold,
      totalRevenue: revenue,
      averageRevenue: avgRevenue,
    };
  }, [hayStorageRecords]);

  // Aggregated fodder-farmer stats. Sourced ONLY from the `fodderFarmers`
  // collection so livestock farmers (the `farmers` collection) don't leak
  // into the Total Fodder Farmers count on the Infrastructure card.
  // - Counts every individual farmer inside every record's `farmers[]` array.
  // - Buckets per county (using the record's `county` field) so the doughnut
  //   chart on the right of the trend row can render.
  // - Buckets per year (using `date`/`timestamp`/`createdAt`) so the trend
  //   chart on the left of the trend row mirrors the livestock farmer
  //   "Farmers Registration Trend" card.
  const fodderFarmersStats = useMemo(() => {
    const filtered = fodderFarmersRecords.filter((record) => {
      const recordDate = record.date || record.timestamp || record.createdAt;
      return matchesProgrammeSelection(record.programme, activeProgram, userCanViewAllProgrammeData) &&
        matchesCountySelection(record.county, selectedCounty) &&
        isDateInRange(recordDate, dateRange.startDate, dateRange.endDate);
    });

    let totalFarmers = 0;
    let maleFarmers = 0;
    let femaleFarmers = 0;
    const countyMap: Record<string, number> = {};
    const yearMap: Record<number, number> = {};

    filtered.forEach((record) => {
      const farmers = Array.isArray(record.farmers) ? record.farmers : [];
      const county = String(record.county || "Unknown").trim() || "Unknown";
      const recordDate = parseDate(record.date || record.timestamp || record.createdAt);
      const year = recordDate?.getFullYear() ?? null;

      farmers.forEach((farmer) => {
        const gender = String(farmer.gender || "").trim().toLowerCase();
        if (gender === "male") maleFarmers += 1;
        else if (gender === "female") femaleFarmers += 1;
        totalFarmers += 1;
        countyMap[county] = (countyMap[county] || 0) + 1;
        if (year !== null) {
          yearMap[year] = (yearMap[year] || 0) + 1;
        }
      });
    });

    const countyPerformanceData = Object.entries(countyMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Mirror the livestock registration trend: always render the last 5 years
    // (with zeroed buckets where there's no data) so the line chart's x-axis
    // is stable regardless of filter state — same UX as the livestock chart.
    const trendComparisonYears = Array.from({ length: 5 }, (_, index) => currentYear - 4 + index);
    const registrationTrendData = trendComparisonYears.map((year) => ({
      name: String(year),
      registrations: yearMap[year] || 0,
    }));

    const malePercentage = totalFarmers > 0 ? ((maleFarmers / totalFarmers) * 100).toFixed(1) : "0.0";
    const femalePercentage = totalFarmers > 0 ? ((femaleFarmers / totalFarmers) * 100).toFixed(1) : "0.0";

    return {
      totalFarmers,
      maleFarmers,
      femaleFarmers,
      malePercentage,
      femalePercentage,
      countyPerformanceData,
      registrationTrendData,
    };
  }, [fodderFarmersRecords, activeProgram, userCanViewAllProgrammeData, selectedCounty, dateRange.startDate, dateRange.endDate, currentYear]);

  // Hay storage records grouped by storage facility. Each HayStorage row is one
  // storage facility entry; we sum the bales stored (harvested + purchased)
  // and balance remaining per facility, then sort by total stored desc so the
  // horizontal list mirrors the "Vaccinated Animals per County" layout.
  // The facility name is pulled defensively from any of several possible
  // fields — `storage_facility`, `facility_name`, `storage_type`, `facility`,
  // `site_name` — so the chart still renders if the collection's schema
  // differs from what we assumed.
  const storageFacilityBales = useMemo(() => {
    const facilityMap: Record<string, { name: string; value: number; county: string; counties: Record<string, number> }> = {};

    hayStorageRecords.forEach((r: any) => {
      if (!matchesCountySelection(r.county || r.County, selectedCounty)) return;
      const facilityName =
        String(
          r.storage_facility || r.storageFacility || r.facility_name ||
          r.facilityName || r.storage_type || r.storageType ||
          r.facility || r.site_name || r.siteName || r.location || "Unknown Facility",
        ).trim() || "Unknown Facility";

      const harvested = Number(r.bales_harvested_stored || 0);
      const purchased = Number(r.bales_purchased_stored || 0);
      const stored = harvested + purchased;
      const county = String(r.county || r.County || "Unknown").trim() || "Unknown";

      const current = facilityMap[facilityName] || { name: facilityName, value: 0, county, counties: {} };
      current.value += stored;
      current.counties[county] = (current.counties[county] || 0) + stored;
      current.county = Object.entries(current.counties).sort((left, right) => right[1] - left[1])[0]?.[0] || county;
      facilityMap[facilityName] = current;
    });

    return Object.values(facilityMap)
      .map(({ name, value, county }) => ({ name, value, county }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [hayStorageRecords, selectedCounty]);

  // Borehole count per county, plus per-county aggregates (people served,
  // water used, drilled/equipped/maintained/rehabilitated counts, and the
  // list of locations). The county is read defensively from `County` (the
  // actual PascalCase field in Firebase) with a camelCase fallback. The
  // PeopleUsingBorehole field is a string like "190 Households" — we parse
  // the leading number out so we can sum household counts per county.
  const boreholesByCounty = useMemo(() => {
    const filtered = boreholesRecords.filter((record) => {
      const recordDate = record.date || record.createdAt;
      return matchesProgrammeSelection(record.programme, activeProgram, userCanViewAllProgrammeData) &&
        matchesCountySelection(record.County || record.county, selectedCounty) &&
        isDateInRange(recordDate, dateRange.startDate, dateRange.endDate);
    });

    type CountyAgg = {
      name: string;
      value: number;
      locations: string[];
      peopleServed: number;
      waterUsed: number;
      drilled: number;
      equipped: number;
      maintained: number;
      rehabilitated: number;
    };

    const countyMap: Record<string, CountyAgg> = {};

    filtered.forEach((record) => {
      // PascalCase first — that's what the Firebase collection actually uses.
      const county = String(record.County || record.county || "Unknown").trim() || "Unknown";
      const location = String(record.BoreholeLocation || record.location || "Unknown").trim() || "Unknown";

      // PeopleUsingBorehole is stored as a string like "190 Households".
      // Pull the leading integer out so household counts can be summed per county.
      const peopleStr = String(record.PeopleUsingBorehole ?? record.peopleUsingBorehole ?? "0");
      const peopleMatch = peopleStr.match(/(\d+)/);
      const peopleServed = peopleMatch ? parseInt(peopleMatch[1], 10) : 0;

      const waterUsed = Number(record.WaterUsed ?? record.waterUsed ?? 0);

      const current = countyMap[county] || {
        name: county,
        value: 0,
        locations: [],
        peopleServed: 0,
        waterUsed: 0,
        drilled: 0,
        equipped: 0,
        maintained: 0,
        rehabilitated: 0,
      };

      current.value += 1;
      if (location && !current.locations.includes(location)) {
        current.locations.push(location);
      }
      current.peopleServed += peopleServed;
      current.waterUsed += waterUsed;
      if (record.drilled) current.drilled += 1;
      if (record.equipped) current.equipped += 1;
      if (record.maintained) current.maintained += 1;
      if (record.rehabilitated) current.rehabilitated += 1;
      countyMap[county] = current;
    });

    return Object.values(countyMap)
      .map((agg) => ({
        name: agg.name,
        value: agg.value,
        locations: agg.locations.join(", "),
        peopleServed: agg.peopleServed,
        waterUsed: agg.waterUsed,
        drilled: agg.drilled,
        equipped: agg.equipped,
        maintained: agg.maintained,
        rehabilitated: agg.rehabilitated,
      }))
      .sort((a, b) => b.value - a.value);
  }, [boreholesRecords, activeProgram, userCanViewAllProgrammeData, selectedCounty, dateRange.startDate, dateRange.endDate]);

    const formatFullValue = useCallback((val?: number | null) => {
      const num = Number(val);
      if (!Number.isFinite(num)) return "0";
      const rounded = Math.round(num * 100) / 100;
      return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }, []);
  
     const summaryGroups = useMemo<SummaryGroup[]>(() => {
  const farmersEnrolledItems: SummaryItem[] = [
    { label: "Total Farmers Enrolled", value: data.totalFarmers },
    { label: "No of Male Farmers", value: data.maleFarmers, suffix: ` (${data.malePercentage}%)` },
    { label: "No of Female Farmers", value: data.femaleFarmers, suffix: ` (${data.femalePercentage}%)` },
    { label: "No of Adult Farmers", value: data.adultFarmers, suffix: ` (${data.adultFarmersPercentage}%)` },
    { label: "No of Youth Farmers", value: data.youthFarmers, suffix: ` (${data.youthFarmersPercentage}%)` },
  ];

  const farmersTrainedItems: SummaryItem[] = [
    { label: "Total Farmers Trained", value: data.totalTrainedFarmers },
    { label: "No of Male Farmers", value: data.maleTrainedFarmers, suffix: ` (${data.maleTrainedPercentage}%)` },
    { label: "No of Female Farmers", value: data.femaleTrainedFarmers, suffix: ` (${data.femaleTrainedPercentage}%)` },
    { label: "No of Adult Farmers", value: data.adultTrainedFarmers, suffix: ` (${data.adultTrainedPercentage}%)` },
    { label: "No of Youth Farmers", value: data.youthTrainedFarmers, suffix: ` (${data.youthTrainedPercentage}%)` },
  ];

  const animalHealthItems: SummaryItem[] = [
    { label: "Total Animals", value: data.totalAnimals },
    { label: "Total Locations Visited", value: data.totalLocationsVisited },
    { label: "No of Goats", value: data.totalGoats, suffix: ` (${data.goatsPercentage}%)` },
    { label: "No of Sheep", value: data.totalSheep, suffix: ` (${data.sheepPercentage}%)` },
  ];

  return [
    { title: "Farmers Enrolled", items: sortZeroLast(farmersEnrolledItems) },
    { title: "Farmers Trained", items: sortZeroLast(farmersTrainedItems) },
    { title: "Animal Health", items: sortZeroLast(animalHealthItems) },
  ];
}, [data]);

  const enrolledTrainingCoverage = data.totalFarmers > 0
    ? Math.min(100, (data.totalTrainedFarmers / data.totalFarmers) * 100)
    : 0;
  const recordedLivestockCoverage = data.totalAnimals > 0
    ? Math.min(100, ((data.totalGoats + data.totalSheep) / data.totalAnimals) * 100)
    : 0;
  const remainingLivestockCoverage = Math.max(0, 100 - recordedLivestockCoverage);

  const quarterlyReport = useMemo(() => {
    const year = Number(quarterlyReportYear);
    const quarters = [
      { label: "Q1", startMonth: 0 },
      { label: "Q2", startMonth: 3 },
      { label: "Q3", startMonth: 6 },
      { label: "Q4", startMonth: 9 },
    ];

    return quarters.map(({ label, startMonth }) => {
      const quarterStart = new Date(year, startMonth, 1);
      const quarterEnd = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
      const today = new Date();
      const quarterFarmers = allFarmers.filter((farmer) => {
        const date = parseDate(farmer.createdAt || farmer.registrationDate);
        if (!date || date.getFullYear() !== year || date.getMonth() < startMonth || date.getMonth() >= startMonth + 3) {
          return false;
        }
        return matchesProgrammeSelection(farmer.programme, activeProgram, userCanViewAllProgrammeData);
      });
      const maleFarmers = quarterFarmers.filter((farmer) => String(farmer.gender || "").trim().toLowerCase() === "male").length;
      const femaleFarmers = quarterFarmers.filter((farmer) => String(farmer.gender || "").trim().toLowerCase() === "female").length;
      const adults = quarterFarmers.filter((farmer) => classifyFarmerAgeGroup(farmer) === "adult").length;
      const youths = quarterFarmers.filter((farmer) => classifyFarmerAgeGroup(farmer) === "youth").length;
      const actual = quarterFarmers.length;
      const progress = Math.min(100, Math.round((actual / QUARTERLY_FARMER_TARGET) * 100));

      return {
        label,
        actual,
        maleFarmers,
        femaleFarmers,
        adults,
        youths,
        progress,
        status: quarterEnd < today ? "Completed" : quarterStart > today ? "Not Started" : "In Progress",
      };
    });
  }, [activeProgram, allFarmers, quarterlyReportYear, userCanViewAllProgrammeData]);
  
  if (loading && !USE_REMOTE_ANALYTICS) {
    return (
      <div className="flex flex-col justify-center items-center h-96 space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <p className="text-gray-600 font-medium animate-pulse">Loading analytics data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-1 bg-gray-50/50 min-h-screen pb-10">
      <div className="flex flex-col gap-2">
        {reportViewProfile.title ? (
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{reportViewProfile.title}</h1>
          </div>
        ) : null}

        {analysisError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Analytics took too long to load. Adjust the filters or try again.
          </div>
        ) : null}

        <Card className="w-full border-0 shadow-lg bg-white">
          <CardContent className="px-3 py-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => scrollFilterStripBy("left")}
                className="hidden h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50 max-[900px]:inline-flex"
              >
                <ChevronLeft className="h-5 w-5" />
                <span className="sr-only">Scroll filters left</span>
              </Button>

              <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div
                  ref={filterStripRef}
                  className="w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden lg:overflow-x-visible"
                >
                  <div className="flex min-w-max flex-nowrap items-center gap-2 p-1 lg:min-w-0 lg:w-full lg:flex-wrap lg:justify-between">
                    <Select value={selectedYear || undefined} onValueChange={handleYearChange}>
                      <SelectTrigger className="h-9 w-[150px] shrink-0 lg:flex-1">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-gray-500" />
                          <SelectValue placeholder="Select Year" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_YEARS_VALUE}>Years</SelectItem>
                        {availableYears.map((year) => (
                          <SelectItem key={year} value={year}>{year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {showProgrammeFilter && (
                      <Select value={activeProgram} onValueChange={setActiveProgram}>
                        <SelectTrigger className="h-9 w-[150px] shrink-0 lg:flex-1">
                          <SelectValue placeholder="Select Programme" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_PROGRAMMES_VALUE}>All Programmes</SelectItem>
                          {accessibleProgrammes.map((programme) => (
                            <SelectItem key={programme} value={programme}>{programme}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    <Select value={selectedCounty} onValueChange={setSelectedCounty}>
                      <SelectTrigger className="h-9 w-[150px] shrink-0 lg:flex-1">
                        <SelectValue placeholder="Select County" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_COUNTIES_VALUE}>All Counties</SelectItem>
                        {countyOptions.map((county) => (
                          <SelectItem key={county} value={county}>{county}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Input
                      id="startDate"
                      type="date"
                      value={dateRange.startDate}
                      onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                      className="h-9 w-[150px] shrink-0 border-gray-200 pr-2 text-xs focus:border-blue-500 lg:flex-1"
                    />

                    <Input
                      id="endDate"
                      type="date"
                      value={dateRange.endDate}
                      onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                      className="h-9 w-[150px] shrink-0 border-gray-200 pr-2 text-xs focus:border-blue-500 lg:flex-1"
                    />

                    <Button variant="outline" onClick={setMonthFilter} size="sm" className="h-9 shrink-0 lg:flex-1">This Month</Button>
                    <Button onClick={clearFilters} variant="ghost" size="sm" className="h-9 shrink-0 text-red-500 hover:text-red-600 lg:flex-1">Clear</Button>
                  </div>
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => scrollFilterStripBy("right")}
                className="hidden h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50 max-[900px]:inline-flex"
              >
                <ChevronRight className="h-5 w-5" />
                <span className="sr-only">Scroll filters right</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {hasSection("hr-summary") && (
        <section>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-6">
            <StatsCard
              title="Goats Purchased"
              value={data.totalGoatsPurchased.toLocaleString()}
              icon={Beef}
              color="orange"
            />

            <StatsCard
              title="Registered Farmers"
              value={data.totalFarmers.toLocaleString()}
              icon={Users}
              subtext={`Trained farmers: ${data.totalTrainedFarmers.toLocaleString()}`}
              color="blue"
            />

            <StatsCard
              title="Animal Health"
              value={data.totalBreedsDistributed.toLocaleString()}
              icon={Syringe}
              subtext={`Breeds distributed: ${data.totalBreedsDistributed.toLocaleString()} | Doses given out: ${data.totalDosesGivenOut.toLocaleString()}`}
              color="teal"
            />
          </div>
        </section>
      )}

      {hasSection("hr-rankings") && (
        <section>
          <div className="grid gap-6 lg:grid-cols-2 mb-6">
            <Card className="overflow-hidden border border-slate-200 bg-white shadow-lg">
              <CardHeader className="border-b border-slate-100 bg-slate-50/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-sm text-gray-800">
                  <Users className="h-4 w-4 text-blue-600" />
                  Top Field Officers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {data.topFieldOfficers.length > 0 ? data.topFieldOfficers.map((officer, index) => {
                  const share = topFieldOfficerPeak > 0 ? (officer.value / topFieldOfficerPeak) * 100 : 0;
                  return (
                    <div key={`${officer.name}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-1 shadow-sm">
                      <div className="flex items-center gap-4">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white shadow-sm">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="truncate text-sm font-semibold text-slate-900">{officer.name}</p>
                            <p className="truncate text-xs text-slate-500">County: {officer.county}</p>
                          </div>
                        </div>
                        <div className="min-w-[160px] max-w-[260px] flex-1">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-700 transition-all"
                              style={{ width: `${Math.max(share, 10)}%` }}
                            />
                          </div>
                        </div>
                        <Badge className="shrink-0 whitespace-nowrap border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 hover:bg-blue-50">
                          {officer.value} farmers
                        </Badge>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                    No field officer activity found for the selected filters.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden border border-slate-200 bg-white shadow-lg">
              <CardHeader className="border-b border-slate-100 bg-slate-50/70 pb-3">
                {reportAudience === "hr" && (
                  <div className="mb-3 flex flex-wrap justify-end gap-2">
                    <Button size="sm" onClick={openCreateStaffDialog} className="bg-green-600 text-white hover:bg-green-700">
                      Create Staff
                    </Button>
                    <Button size="sm" onClick={() => openAwardDialog(null)} className="bg-green-600 text-white hover:bg-green-700">
                      <Award className="mr-1 h-4 w-4" />
                      Award Marks
                    </Button>
                  </div>
                )}
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <Users className="h-4 w-4 text-yellow-600" />
                  Staff Table
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[360px] overflow-auto">
                  <Table className="min-w-full">
                    <TableHeader className="sticky top-0 z-10 bg-green-600">
                      <TableRow>
                        <TableHead className="py-2 text-xs font-semibold text-white">Staff</TableHead>
                        <TableHead className="py-2 text-xs font-semibold text-white">County</TableHead>
                        <TableHead className="py-2 text-xs font-semibold text-white">Role</TableHead>
                        <TableHead className="py-2 text-xs font-semibold text-white">Status</TableHead>
                        <TableHead className="py-2 text-xs font-semibold text-white">Total Marks</TableHead>
                        <TableHead className="py-2 text-xs font-semibold text-white">Awards</TableHead>
                        <TableHead className="py-2 text-xs font-semibold text-white text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {staffManagementRows.length > 0 ? staffManagementRows.map((staffRow) => (
                        <TableRow key={staffRow.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50/80">
                          <TableCell className="py-1 text-xs text-slate-900">
                            <div className="leading-tight">{staffRow.staffName}</div>
                            {staffRow.lastAwardNote && (
                              <div className="mt-1 text-xs text-slate-500 line-clamp-2">{staffRow.lastAwardNote}</div>
                            )}
                          </TableCell>
                          <TableCell className="py-1 text-xs">{staffRow.county}</TableCell>
                          <TableCell className="py-1 text-xs">{staffRow.role}</TableCell>
                          <TableCell className="py-1 text-xs">
                            <Badge
                              className={
                                staffRow.status === "active" ?
                                  "border-green-200 bg-green-50 text-green-700 hover:bg-green-50" :
                                  staffRow.status === "inactive" ?
                                    "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-100" :
                                    "border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-50"
                              }
                            >
                              {staffRow.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-1 text-xs">{staffRow.totalMarks}</TableCell>
                          <TableCell className="py-1 text-xs">{staffRow.awardCount}</TableCell>
                          <TableCell className="py-1 text-xs text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-full border border-green-200 bg-green-50 hover:bg-green-100"
                                >
                                  <MoreVertical className="h-4 w-4 text-green-700" />
                                  <span className="sr-only">Open staff actions</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={() => openAwardDialog(staffRow)}>
                                  <Award className="mr-2 h-4 w-4" />
                                  Award Marks
                                </DropdownMenuItem>
                                {staffRow.managedInDirectory ? (
                                  <>
                                    <DropdownMenuItem onClick={() => openEditStaffDialog(staffRow)}>
                                      <PencilLine className="mr-2 h-4 w-4" />
                                      Edit Staff
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleToggleStaffStatus(staffRow)}>
                                      <UserX className="mr-2 h-4 w-4" />
                                      {staffRow.status === "active" ? "Deactivate" : "Activate"}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleDeleteStaff(staffRow)}
                                      className="text-red-600 focus:bg-red-50 focus:text-red-700"
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Delete Staff
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <DropdownMenuItem disabled>
                                    Marks only
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )) : (
                        <TableRow>
                          <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                            No staff records found for the selected filters.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

        </section>
      )}

      {hasSection("hr-distribution") && (
        <section>
          <div className="grid gap-6 md:grid-cols-2 mb-6 items-start">
            <div className="space-y-6">
              <Card className="border-0 shadow-lg bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                    <MapPin className="h-4 w-4 text-green-600" />
                    Top Location In Registration
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-[280px] overflow-y-auto pr-1">
                    <TopLocationsList locations={data.topLocations} unitLabel="farmers" accent="green" />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-lg bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                    <TrendingUp className="h-4 w-4 text-teal-600" />
                    Breeds Distributed Per Subcounty
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={data.breedsBySubcountyData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis dataKey="name" angle={-45} textAnchor="end" height={70} interval={0} tick={{ fontSize: 10 }} />
                      <YAxis />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={COLORS.teal}
                        strokeWidth={3}
                        fill={COLORS.teal}
                        fillOpacity={0.15}
                        activeDot={{ r: 5 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <Card className="border-0 shadow-lg bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <Award className="h-4 w-4 text-teal-600" />
                  Breeds Distributed By County
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={REPORT_DONUT_HEIGHT}>
                  <PieChart>
                    <Pie
                      data={data.breedsByCountyData}
                      cx="50%"
                      cy="50%"
                      outerRadius={REPORT_DONUT_OUTER_RADIUS}
                      innerRadius={REPORT_DONUT_INNER_RADIUS}
                      paddingAngle={REPORT_DONUT_PADDING_ANGLE}
                      cornerRadius={REPORT_DONUT_CORNER_RADIUS}
                      dataKey="value"
                      label={renderCustomizedLabel}
                      labelLine={false}
                    >
                      {data.breedsByCountyData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      <Dialog
        open={isCreateStaffOpen}
        onOpenChange={(open) => {
          setIsCreateStaffOpen(open);
          if (!open) {
            setCreateStaffForm(createDefaultStaffForm());
            setEditingStaffRow(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle>{editingStaffRow ? "Edit Staff" : "Create Staff"}</DialogTitle>
            <DialogDescription>
              {editingStaffRow ?
                `Update ${editingStaffRow.staffName} in the HR table for ${activeProgram || "the selected programme"}.` :
                `Add a staff member to the HR table for ${activeProgram || "the selected programme"}.`
              }
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="create-staff-name">Staff Name</Label>
              <Input
                id="create-staff-name"
                placeholder="Enter staff name"
                value={createStaffForm.staffName}
                onChange={(event) => setCreateStaffForm((current) => ({ ...current, staffName: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-staff-role">Role</Label>
              <Input
                id="create-staff-role"
                placeholder="Field Officer, Supervisor..."
                value={createStaffForm.role}
                onChange={(event) => setCreateStaffForm((current) => ({ ...current, role: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-staff-county">County</Label>
              <Input
                id="create-staff-county"
                placeholder="Assigned county"
                value={createStaffForm.county}
                onChange={(event) => setCreateStaffForm((current) => ({ ...current, county: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-staff-phone">Phone</Label>
              <Input
                id="create-staff-phone"
                placeholder="Optional phone number"
                value={createStaffForm.phone}
                onChange={(event) => setCreateStaffForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-staff-notes">Notes</Label>
            <Textarea
              id="create-staff-notes"
              placeholder="Optional staff notes"
              value={createStaffForm.notes}
              onChange={(event) => setCreateStaffForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">
              Programme: <span className="font-semibold text-slate-700">{activeProgram || "No programme selected"}</span>
            </p>
            <Button onClick={handleCreateStaff} disabled={isSavingStaffDirectory} className="bg-green-600 text-white hover:bg-green-700">
              {isSavingStaffDirectory ? "Saving..." : editingStaffRow ? "Save Changes" : "Create Staff"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAwardDialogOpen}
        onOpenChange={(open) => {
          setIsAwardDialogOpen(open);
          if (!open) {
            setSelectedStaffRow(null);
            setStaffMarkForm(createDefaultStaffMarkForm());
          }
        }}
      >
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle>Award Staff Marks</DialogTitle>
            <DialogDescription>
              Score {selectedStaffRow?.staffName || "the selected staff"} for the active reporting period.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="award-staff-name">Staff Name</Label>
              <Input
                id="award-staff-name"
                value={staffMarkForm.staffName}
                onChange={(event) => setStaffMarkForm((current) => ({ ...current, staffName: event.target.value }))}
                disabled={!!selectedStaffRow}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="award-staff-marks">Marks</Label>
                <Input
                  id="award-staff-marks"
                  type="number"
                  min="1"
                  max="100"
                  placeholder="1 - 100"
                  value={staffMarkForm.marks}
                  onChange={(event) => setStaffMarkForm((current) => ({ ...current, marks: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="award-staff-date">Award Date</Label>
                <Input
                  id="award-staff-date"
                  type="date"
                  value={staffMarkForm.dateAwarded}
                  onChange={(event) => setStaffMarkForm((current) => ({ ...current, dateAwarded: event.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="award-staff-note">Performance Note</Label>
              <Textarea
                id="award-staff-note"
                placeholder="Add a short reason for the award"
                value={staffMarkForm.note}
                onChange={(event) => setStaffMarkForm((current) => ({ ...current, note: event.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">
                Saving to: <span className="font-semibold text-slate-700">{activeProgram || "No programme selected"}</span>
              </p>
              <Button onClick={handleStaffMarkSubmit} disabled={isSavingStaffMark} className="bg-green-600 text-white hover:bg-green-700">
                {isSavingStaffMark ? "Saving..." : "Save Staff Marks"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {hasSection("project-manager-report") && (
      <section>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-6">
          <StatsCard
            title="Total Registered Farmers"
            value={data.totalFarmers.toLocaleString()}
            icon={Users}
            color="blue"
          />

          <StatsCard
            title="Trained Farmers"
            value={data.totalTrainedFarmers.toLocaleString()}
            icon={GraduationCap}
            subtext={trainingStatsSubtext}
            color="yellow"
          />

          <StatsCard
            title="Animal Census"
            value={data.totalAnimals.toLocaleString()}
            subtext={`Purchased goats: ${data.totalGoatsPurchased.toLocaleString()}`}
            icon={Beef}
            color="orange"
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2 mb-6">
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <MapPin className="h-4 w-4 text-purple-600" />
                Registered Farmers per County
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={REPORT_DONUT_HEIGHT}>
                <PieChart>
                  <Pie
                    data={data.countyPerformanceData}
                    cx="50%"
                    cy="50%"
                    outerRadius={REPORT_DONUT_OUTER_RADIUS}
                    innerRadius={REPORT_DONUT_INNER_RADIUS}
                    paddingAngle={REPORT_DONUT_PADDING_ANGLE}
                    cornerRadius={REPORT_DONUT_CORNER_RADIUS}
                    dataKey="value"
                    labelLine={false}
                  >
                    {data.countyPerformanceData.map((entry, index) => (
                      <Cell key={`county-cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number | string) => [Number(value).toLocaleString(), "Registered Farmers"]} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <MapPin className="h-4 w-4 text-blue-600" />
                Registered Farmers per Subcounty
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={data.subcountyPerformanceData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 52 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                    height={60}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number | string) => [Number(value).toLocaleString(), "Registered Farmers"]} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={24} fill={COLORS.darkBlue} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <TargetIcon className="h-4 w-4 text-teal-600" />
                Breeds Distributed per Location
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart
                  data={projectManagerBreedsByLocationData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 52 }}
                >
                  <defs>
                    <linearGradient id="pmBreedsLocationFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.teal} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={COLORS.teal} stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                    height={60}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number | string) => [Number(value).toLocaleString(), "Breeds Distributed"]} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="Breeds Distributed"
                    stroke={COLORS.teal}
                    strokeWidth={3}
                    fill="url(#pmBreedsLocationFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Syringe className="h-4 w-4 text-red-600" />
                Administered Vaccines per Location
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={projectManagerVaccinesByLocationData}
                  layout="vertical"
                  margin={HORIZONTAL_BAR_CHART_MARGIN}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                  <XAxis type="number" axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={HORIZONTAL_BAR_CHART_Y_AXIS_WIDTH}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip formatter={(value: number | string) => [Number(value).toLocaleString(), "Administered Doses"]} />
                  <Bar
                    dataKey="value"
                    name="Administered Doses"
                    radius={[0, 4, 4, 0]}
                    barSize={12}
                    fill={COLORS.red}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </section>
      )}

      {hasSection("default-registration") && (
      <section>
        <SectionHeader title="Livestock Farmer Registration" />
        
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <StatsCard 
            title="Farmers Registered" 
            value={data.totalFarmers.toLocaleString()} 
            icon={Users}
            subtext={`${data.maleFarmers} Male (${data.malePercentage}%) | ${data.femaleFarmers} Female (${data.femalePercentage}%)`}
            color="blue"
          />

          <StatsCard 
            title="Animal Census" 
            value={data.totalAnimals.toLocaleString()} 
            icon={Beef}
            subtext={`Goats: ${data.totalGoats} (${data.goatsPercentage}%) | Sheep: ${data.totalSheep} (${data.sheepPercentage}%)`}
            color="orange"
          />

          <StatsCard 
            title="Trained Farmers" 
            value={data.totalTrainedFarmers.toLocaleString()} 
            icon={GraduationCap}
            subtext={trainingStatsSubtext}
            color="yellow"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3 mb-6">
          <Card className="border-0 shadow-lg bg-white h-[350px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <MapPin className="h-4 w-4 text-purple-600" />
                  Registration (County)
                </CardTitle>
              </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={REPORT_DONUT_HEIGHT}>
                <PieChart>
                  <Pie
                    data={data.countyPerformanceData}
                    cx="50%"
                    cy="50%"
                    outerRadius={REPORT_DONUT_OUTER_RADIUS}
                    innerRadius={REPORT_DONUT_INNER_RADIUS}
                    paddingAngle={REPORT_DONUT_PADDING_ANGLE}
                    cornerRadius={REPORT_DONUT_CORNER_RADIUS}
                    dataKey="value"
                    label={renderCustomizedLabel}
                    labelLine={false}
                  >
                    {data.countyPerformanceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white h-[350px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <MapPin className="h-4 w-4 text-cyan-600" />
                  Registration (Subcounty)
                </CardTitle>
              </CardHeader>
            <CardContent>
              <SubcountyRegistrationDonutChart data={data.subcountyPerformanceData} />
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white h-[350px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <MapPin className="h-4 w-4 text-green-600" />
                  Registration (Ward)
                </CardTitle>
              </CardHeader>
            <CardContent>
              <WardRegistrationChart data={data.wardPerformanceData} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2 mb-6">
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  Farmers Registration vs Training Trend
                </CardTitle>
                <Button
                  type="button"
                  variant={registrationTrendMode === "yearly" ? "default" : "outline"}
                  size="sm"
                  className={
                    registrationTrendMode === "yearly"
                      ? "h-8 bg-green-600 px-3 text-xs text-white hover:bg-green-700"
                      : "h-8 border-green-600 px-3 text-xs text-green-700 hover:bg-green-50"
                  }
                  onClick={() =>
                    setRegistrationTrendMode((mode) => (mode === "yearly" ? "auto" : "yearly"))
                  }
                >
                  Yearly
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <RegistrationTrendChart data={registrationTrendChartData} />
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                Farmers Registration Monthly Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RegistrationMonthlyTrendChart farmers={allFarmers} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <MapPin className="h-4 w-4 text-green-600" />
                Top Locations in Registrations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] overflow-y-auto pr-2">
                <TopLocationsList locations={data.topLocations} unitLabel="farmers" accent="green" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Users className="h-4 w-4 text-green-600" />
                Top Farmers Per Herd Size
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] space-y-3 overflow-y-auto pr-2">
                {data.topCustomers.length > 0 ? (
                  data.topCustomers.map((farmer, index) => {
                    const share = topCustomerPeak > 0 ? (farmer.value / topCustomerPeak) * 100 : 0;
                    return (
                      <div
                        key={`${farmer.name}-${index}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm"
                      >
                        <div className="flex items-center gap-4">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-600 text-xs font-semibold text-white shadow-sm">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold text-slate-900">{farmer.name}</p>
                              <p className="truncate text-xs text-slate-500">County: {farmer.county || "N/A"}</p>
                            </div>
                          </div>
                          <div className="min-w-[140px] max-w-[220px] flex-1">
                            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-700 transition-all"
                                style={{ width: `${Math.max(share, 10)}%` }}
                              />
                            </div>
                          </div>
                          <Badge className="shrink-0 whitespace-nowrap border-green-200 bg-green-50 px-3 py-1 text-green-700 hover:bg-green-50">
                            {Number(farmer.value).toLocaleString()} goats
                          </Badge>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                    No farmer data available
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
      )}

 {hasSection("default-animal-health") && (
      <section>
        <SectionHeader title=" Infrastracture & Fodder Farmers" />
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <StatsCard 
            title="Total Fodder Farmers Registered" 
            value={fodderFarmersStats.totalFarmers.toLocaleString()} 
            icon={Users}
            subtext={`${fodderFarmersStats.maleFarmers} Male (${fodderFarmersStats.malePercentage}%) | ${fodderFarmersStats.femaleFarmers} Female (${fodderFarmersStats.femalePercentage}%)`}
            color="blue"
          />
          <StatsCard 
            title="Total Bales Stored" 
            value={(totalBalesHarvested + totalBalesPurchased).toLocaleString()} 
            icon={TrendingUp}
            subtext={`Harvested: ${totalBalesHarvested.toLocaleString()} | Purchased: ${totalBalesPurchased.toLocaleString()} | Sold: ${totalBalesSold.toLocaleString()} | Balance: ${totalBalesBalance.toLocaleString()}`}
            color="green"
          />
          <StatsCard 
            title="Average Revenue Generated" 
            value={`KES ${averageRevenue.toLocaleString()}`}
            icon={TrendingUp}
            subtext={`Total: KES ${totalRevenue.toLocaleString()} | Across ${hayStorageRecords.length} hay storage record${hayStorageRecords.length === 1 ? "" : "s"}`}
            color="orange"
          />
        </div>
        
        <div className="grid gap-6 md:grid-cols-3 mb-6">
          {/* Pie chart: Bales Sold vs Bales Balance */}
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Award className="h-4 w-4 text-green-600" />
                Bales Sold vs Balance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={REPORT_DONUT_HEIGHT}>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Bales Sold", value: totalBalesSold || 0 },
                      { name: "Bales Balance", value: Math.max(totalBalesBalance, 0) || 0 }
                    ]}
                    cx="50%"
                    cy="50%"
                    outerRadius={REPORT_DONUT_OUTER_RADIUS}
                    innerRadius={REPORT_DONUT_INNER_RADIUS}
                    paddingAngle={REPORT_DONUT_PADDING_ANGLE}
                    cornerRadius={REPORT_DONUT_CORNER_RADIUS}
                    dataKey="value"
                    labelLine={false}
                  >
                    <Cell fill="#22c55e" />
                    <Cell fill="#f59e0b" />
                  </Pie>
                  <Tooltip formatter={(value: number) => [Number(value).toLocaleString(), ""]} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Doughnut chart: Purchased vs Harvested Bales */}
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <ShoppingCart className="h-4 w-4 text-orange-600" />
                Purchased vs Harvested Bales
              </CardTitle>
            </CardHeader>
            <CardContent>
              <HayBalesSourceDonutChart harvested={totalBalesHarvested} purchased={totalBalesPurchased} />
            </CardContent>
          </Card>
           <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                Bales Trends
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BalesTrendsComboChart hayStorageRecords={hayStorageRecords} />
            </CardContent>
          </Card>
        </div>

        {/* Fodder farmers registration trend (left) + registration per county doughnut (right) —
            mirrors the layout/UX of the Livestock Farmer Registration section so
            the two dashboards read consistently. The trend buckets registrations
            per year (5-year window, same as the livestock chart) and the doughnut
            shows the share of fodder farmers registered per county for the active
            filters. */}
        <div className="grid gap-6 md:grid-cols-2 mb-6">
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                Fodder Farmers Registration Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RegistrationTrendChart data={fodderFarmersStats.registrationTrendData} />
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <MapPin className="h-4 w-4 text-purple-600" />
                Fodder Farmers Registration (County)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {fodderFarmersStats.countyPerformanceData.length > 0 ? (
                <ResponsiveContainer width="100%" height={REPORT_DONUT_HEIGHT}>
                  <PieChart>
                    <Pie
                      data={fodderFarmersStats.countyPerformanceData}
                      cx="50%"
                      cy="50%"
                      outerRadius={REPORT_DONUT_OUTER_RADIUS}
                      innerRadius={REPORT_DONUT_INNER_RADIUS}
                      paddingAngle={REPORT_DONUT_PADDING_ANGLE}
                      cornerRadius={REPORT_DONUT_CORNER_RADIUS}
                      dataKey="value"
                      label={renderCustomizedLabel}
                      labelLine={false}
                    >
                      {fodderFarmersStats.countyPerformanceData.map((entry, index) => (
                        <Cell key={`fodder-county-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number | string) => [Number(value).toLocaleString(), "Fodder Farmers"]} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                  No fodder farmer registration data found for the selected filters.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Storage facilities with bales stored (left) — horizontal ranked list
            styled exactly like "Vaccinated Animals per County". Each row is one
            storage facility with a colored progress bar scaled against the
            top facility. Hovering a row would show its bales balance, but the
            list itself surfaces the stored total per facility at a glance. */}
        <div className="grid gap-6 md:grid-cols-2 mb-6">
          <Card className="border-0 bg-white shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-gray-800">
                <Warehouse className="h-4 w-4 text-green-600" />
                Storage Facilities &amp; Bales Stored
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] overflow-y-auto pr-2">
                <TopLocationsList locations={storageFacilityBales} unitLabel="bales" accent="green" />
              </div>
            </CardContent>
          </Card>

          {/* Boreholes per County (right) — pie chart showing how boreholes are
              distributed across counties. Hovering a slice reveals the county's
              borehole count, total households served, water used, and
              drilled/equipped/maintained/rehabilitated tallies — much richer
              than the default "X Boreholes" tooltip. */}
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Droplets className="h-4 w-4 text-blue-600" />
                Boreholes(County)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {boreholesByCounty.length > 0 ? (
                <ResponsiveContainer width="100%" height={REPORT_DONUT_HEIGHT}>
                  <PieChart>
                    <Pie
                      data={boreholesByCounty}
                      cx="50%"
                      cy="50%"
                      outerRadius={REPORT_DONUT_OUTER_RADIUS}
                      innerRadius={REPORT_DONUT_INNER_RADIUS}
                      paddingAngle={REPORT_DONUT_PADDING_ANGLE}
                      cornerRadius={REPORT_DONUT_CORNER_RADIUS}
                      dataKey="value"
                      label={renderCustomizedLabel}
                      labelLine={false}
                    >
                      {boreholesByCounty.map((entry, index) => (
                        <Cell key={`borehole-county-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (!active || !payload || !payload.length) return null;
                        const entry = payload[0].payload as {
                          name: string;
                          value: number;
                          locations: string;
                          peopleServed: number;
                          waterUsed: number;
                          drilled: number;
                          equipped: number;
                          maintained: number;
                          rehabilitated: number;
                        };
                        return (
                          <div
                            style={{
                              background: "#0f172a",
                              borderRadius: 10,
                              padding: "10px 14px",
                              color: "#fff",
                              fontSize: 12,
                              lineHeight: 1.7,
                              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                              maxWidth: 280,
                            }}
                          >
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>{entry.name}</div>
                            <div>Boreholes: <strong>{entry.value}</strong></div>
                            <div>Households served: <strong>{entry.peopleServed.toLocaleString()}</strong></div>
                            <div>Water used: <strong>{entry.waterUsed.toLocaleString()}</strong></div>
                            <div>Drilled: <strong>{entry.drilled}</strong> | Equipped: <strong>{entry.equipped}</strong></div>
                            <div>Maintained: <strong>{entry.maintained}</strong> | Rehabilitated: <strong>{entry.rehabilitated}</strong></div>
                            {entry.locations && (
                              <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 4 }}>
                                Locations: {entry.locations}
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                  No borehole data found for the selected filters.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

       
      </section>
      )}


      {hasSection("default-animal-health") && (
      <section>
        <SectionHeader title="Animal Health" />

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card className="border-0 shadow-lg bg-white overflow-hidden">
            <CardHeader className="pb-2 bg-gradient-to-r from-purple-50 to-white">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-700">
                <MapPin className="h-4 w-4 text-purple-600" />
                Doses Administered
              </CardTitle>
            </CardHeader>
            <CardContent className="pl-6 pb-4">
              <div className="text-xl font-bold text-gray-900">{data.totalDosesGivenOut.toLocaleString()}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.vaccineDoseBreakdown.length > 0 ? (
                  data.vaccineDoseBreakdown.map((vaccine) => (
                    <Badge
                      key={vaccine.name}
                      className="border-green-200 bg-green-50 font-normal text-green-700 hover:bg-green-50"
                    >
                      {vaccine.name}: {Number(vaccine.value).toLocaleString()}
                    </Badge>
                  ))
                ) : (
                  <p className="text-[11px] font-medium text-gray-500">No vaccine types recorded</p>
                )}
              </div>
            </CardContent>
          </Card>

          <StatsCard 
            title="Breeds Distributed" 
            value={data.totalBreedsDistributed.toLocaleString()} 
            icon={TargetIcon}
            subtext={`Male: ${data.breedsMale} (${data.breedsMalePercentage}%) | Female: ${data.breedsFemale} (${data.breedsFemalePercentage}%)`}
            color="teal"
          />

          <StatsCard 
            title="Vaccinated Animals" 
            value={data.vaccinatedAnimals.toLocaleString()} 
            icon={Syringe}
            subtext={`${data.vaccinationRate}% coverage rate (${data.vaccinatedFarmersCount} farmers)`}
            color={Number(data.vaccinationRate) >= 75 ? "green" : Number(data.vaccinationRate) >= 50 ? "yellow" : "red"}
          />
        </div>

       

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Syringe className="h-4 w-4 text-red-600" />
                Vaccinated Animals(County)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] overflow-y-auto pr-2">
                <TopLocationsList
                  locations={data.vaccinationByCountyData.map((entry) => ({
                    ...entry,
                    county: entry.name,
                  }))}
                  unitLabel="animals"
                  accent="green"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Syringe className="h-4 w-4 text-red-600" />
                Vaccinated Animals(Subcounty)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <VaccinationSubcountyBarChart data={data.vaccinationBySubcountyData} />
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Syringe className="h-4 w-4 text-red-600" />
                Vaccination Monthly Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <VaccinationMonthlyTrendChart animalHealthRecords={animalHealthActivities} />
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Syringe className="h-4 w-4 text-blue-600" />
                Farmer vs Aid Vaccinations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <VaccinationSourceComparisonChart
                farmers={allFarmers}
                animalHealthRecords={animalHealthActivities}
              />
            </CardContent>
          </Card>
        </div>
         <div className="grid gap-6 md:grid-cols-2 mt-4">
          <Card className="border-0 shadow-lg bg-white h-[350px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Award className="h-4 w-4 text-teal-600" />
                Breeds Distribution (County)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={REPORT_DONUT_HEIGHT}>
                <PieChart>
                  <Pie
                    data={data.breedsByCountyData}
                    cx="50%"
                    cy="50%"
                    outerRadius={REPORT_DONUT_OUTER_RADIUS}
                    innerRadius={REPORT_DONUT_INNER_RADIUS}
                    paddingAngle={REPORT_DONUT_PADDING_ANGLE}
                    cornerRadius={REPORT_DONUT_CORNER_RADIUS}
                    dataKey="value"
                    label={renderCustomizedLabel}
                    labelLine={false}
                  >
                    {data.breedsByCountyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white h-[350px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <TrendingUp className="h-4 w-4 text-teal-600" />
                Subcounty Performance (Breeds)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.breedsBySubcountyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={70} interval={0} tick={{fontSize: 10}} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={20} fill={COLORS.teal} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </section>
      )}
       <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
        <Card className="border-0 shadow-lg bg-white rounded-2xl overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <TargetIcon className="h-4 w-4 text-teal-600" />
                  Quarterly Farmer Registration Report
                </CardTitle>
               
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="quarterly-report-year" className="text-xs font-medium text-slate-600">Year</Label>
                <Select value={quarterlyReportYear} onValueChange={setQuarterlyReportYear}>
                  <SelectTrigger id="quarterly-report-year" className="h-9 w-[110px] bg-white">
                    <SelectValue placeholder="Select year" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableYears.map((year) => <SelectItem key={year} value={year}>{year}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-green-600 hover:bg-green-600">
                    {['Quarter', 'No. of Farmers', 'Male Farmers', 'Female Farmers', 'Adults', 'Youths', 'Progress (%)', 'Status'].map((heading) => (
                      <TableHead key={heading} className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-white">{heading}</TableHead>
                    ))}
                    <TableHead className="w-10 text-white" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quarterlyReport.map((quarter, index) => (
                    <TableRow key={quarter.label}>
                      <TableCell className="px-4 py-4">
                        <span className={`inline-flex min-w-12 justify-center rounded-full px-3 py-1 text-xs font-semibold ${index === 2 ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-800'}`}>{quarter.label}</span>
                      </TableCell>
                      <TableCell className="px-4 py-4 font-medium">{quarter.actual.toLocaleString()}</TableCell>
                      <TableCell className="px-4 py-4">{quarter.maleFarmers.toLocaleString()}</TableCell>
                      <TableCell className="px-4 py-4">{quarter.femaleFarmers.toLocaleString()}</TableCell>
                      <TableCell className="px-4 py-4">{quarter.adults.toLocaleString()}</TableCell>
                      <TableCell className="px-4 py-4">{quarter.youths.toLocaleString()}</TableCell>
                      <TableCell className="px-4 py-4 font-semibold text-slate-700">{quarter.progress}%</TableCell>
                      <TableCell className="px-4 py-4">
                        <Badge className={quarter.status === "Completed" ? "border-0 bg-emerald-50 text-emerald-700" : quarter.status === "In Progress" ? "border-0 bg-blue-50 text-blue-700" : "border-0 bg-slate-100 text-slate-600"}>
                          <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${quarter.status === "Completed" ? "bg-emerald-500" : quarter.status === "In Progress" ? "bg-blue-500" : "bg-slate-400"}`} />
                          {quarter.status}
                        </Badge>
                      </TableCell>
                     
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>
      <section className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
            Report Summary
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Report Summary
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            A consolidated view of farmer participation, training reach, and livestock health activity.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <CardContent className="border-l-4 border-blue-500 p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                  <Users className="h-4 w-4 text-slate-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Farmers & Training</h3>
                  <p className="text-[11px] text-slate-500">Enrollment, demographics, and training reach</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1.25fr_1fr]">
                <div className="rounded-xl bg-blue-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-blue-600">Total Farmers Enrolled</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{formatFullValue(data.totalFarmers)}</p>
                  <div className="mt-4 space-y-2">
                    <div>
                      <div className="mb-1 flex justify-between text-[11px] font-semibold text-slate-700">
                        <span>Male Farmers</span>
                        <span>{data.malePercentage}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-blue-100">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${data.malePercentage}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-[11px] font-semibold text-slate-700">
                        <span>Female Farmers</span>
                        <span>{data.femalePercentage}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-blue-100">
                        <div className="h-full rounded-full bg-blue-300" style={{ width: `${data.femalePercentage}%` }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Male Farmers</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">{formatFullValue(data.maleFarmers)}</p>
                    <p className="text-[11px] font-semibold text-slate-500">({data.malePercentage}%)</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Female Farmers</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">{formatFullValue(data.femaleFarmers)}</p>
                    <p className="text-[11px] font-semibold text-slate-500">({data.femalePercentage}%)</p>
                  </div>
                </div>
              </div>

              <div className="my-5 border-t border-slate-200" />

              <div className="mb-3 flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-blue-600" />
                <h4 className="text-sm font-bold text-slate-800">Farmers Trained</h4>
              </div>
              <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total Trained</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{formatFullValue(data.totalTrainedFarmers)}</p>
                  <div className="mt-3 flex justify-between text-[11px] font-semibold text-slate-600">
                    <span>Coverage</span>
                    <span className="text-blue-600">{enrolledTrainingCoverage.toFixed(1)}%</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-blue-100">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${enrolledTrainingCoverage}%` }} />
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">
                    {formatFullValue(data.totalTrainedFarmers)} of {formatFullValue(data.totalFarmers)} enrolled
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Male</p>
                    <p className="text-sm font-bold text-slate-900">{formatFullValue(data.maleTrainedFarmers)}</p>
                    <p className="text-[11px] font-bold text-blue-600">{data.maleTrainedPercentage}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Adult</p>
                    <p className="text-sm font-bold text-slate-900">{formatFullValue(data.adultTrainedFarmers)}</p>
                    <p className="text-[11px] font-bold text-blue-600">{data.adultTrainedPercentage}%</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Female</p>
                    <p className="text-sm font-bold text-slate-900">{formatFullValue(data.femaleTrainedFarmers)}</p>
                    <p className="text-[11px] font-bold text-blue-600">{data.femaleTrainedPercentage}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Youth</p>
                    <p className="text-sm font-bold text-slate-900">{formatFullValue(data.youthTrainedFarmers)}</p>
                    <p className="text-[11px] font-bold text-blue-600">{data.youthTrainedPercentage}%</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <CardContent className="border-l-4 border-teal-600 p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50">
                  <Syringe className="h-4 w-4 text-slate-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Animal Health</h3>
                  <p className="text-[11px] text-slate-500">Livestock reached through program activity</p>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700">Total Animals</p>
                <p className="mt-1 text-3xl font-bold text-slate-900">{formatFullValue(data.totalAnimals)}</p>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700">Locations Visited</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{formatFullValue(data.totalLocationsVisited)}</p>
                  <p className="text-[11px] text-slate-500">Field activity locations</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700">Recorded Livestock</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{recordedLivestockCoverage.toFixed(1)}%</p>
                  <p className="text-[11px] text-slate-500">Goats and sheep combined</p>
                </div>
              </div>

              <div className="mt-5">
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                  <div className="bg-teal-700" style={{ width: `${data.goatsPercentage}%` }} />
                  <div className="bg-cyan-500" style={{ width: `${data.sheepPercentage}%` }} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-teal-700" />
                        <div>
                          <p className="text-xs font-bold text-slate-800">Goats</p>
                          <p className="text-[11px] text-slate-500">Livestock reached</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-900">{formatFullValue(data.totalGoats)}</p>
                        <p className="text-[11px] font-bold text-teal-700">{data.goatsPercentage}%</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-cyan-500" />
                        <div>
                          <p className="text-xs font-bold text-slate-800">Sheep</p>
                          <p className="text-[11px] text-slate-500">Livestock reached</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-900">{formatFullValue(data.totalSheep)}</p>
                        <p className="text-[11px] font-bold text-teal-700">{data.sheepPercentage}%</p>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-slate-500">
                  Remaining {remainingLivestockCoverage.toFixed(1)}% covers other livestock species reached.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
     

      <DashboardInsights
        allowAdd={userCanViewAllProgrammeData}
        accessibleProgrammes={accessibleProgrammes}
        selectedProgramme={activeProgram}
        dateRange={dateRange}
        title="Report Insights"
        description="Dated insights shared from the performance dashboard overview."
      />

    </div>
  );
};

export default PerformanceReport;
