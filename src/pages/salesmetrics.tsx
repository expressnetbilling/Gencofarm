import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue, memo, startTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  canViewAllProgrammes,
  isAdmin,
  resolvePermissionPrincipal,
} from "@/contexts/authhelper";
import { db, fetchCollectionByProgrammes, ref, query, orderByChild, equalTo, get, set, type DataSnapshot } from "@/lib/firebase";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  XAxis, YAxis, CartesianGrid, AreaChart, Area, Legend,
  BarChart, Bar, LineChart, Line
} from "recharts";
import {
  Beef, TrendingUp, Award, Star,
  MapPin, DollarSign, Package, Users, Loader2, Calendar,
  Zap, ChevronDown, Calculator, ChevronLeft, ChevronRight,
  ClipboardList, History
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSharedProgrammeSelection } from "@/hooks/use-shared-programme-selection";
import { useToast } from "@/hooks/use-toast";
import { millify } from "millify";
import { fetchAnalysisSummary } from "@/lib/analysis";
import {
  ALL_PROGRAMMES_VALUE,
  PROGRAMME_OPTIONS,
  isAllProgrammesSelection,
  normalizeProgramme,
  resolveAccessibleProgrammes,
} from "@/lib/programme-access";
import Chart from "react-apexcharts";


const COLORS = {
  darkBlue: "#1e3a8a",
  orange: "#f97316",
  yellow: "#f59e0b",
  green: "#16a34a",
  maroon: "#991b1b",
  purple: "#7c3aed",
  teal: "#0d9488",
  red: "#dc2626",
  gray: "#9ca3af",
  pink: "#db2777",
  lightBlue: "#eff6ff",
} as const;

const BAR_COLORS = [
  COLORS.darkBlue, COLORS.orange, COLORS.yellow, COLORS.green,
  COLORS.purple, COLORS.teal, COLORS.maroon, COLORS.red, COLORS.gray, COLORS.darkBlue,
] as const;

const TREND_SERIES_COLORS = [
  COLORS.darkBlue,
  COLORS.orange,
  COLORS.green,
  COLORS.purple,
  COLORS.teal,
  COLORS.maroon,
  COLORS.red,
  COLORS.yellow,
  COLORS.gray,
] as const;

const ALL_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const ALL_YEARS_OPTION = "all";
const ALL_COUNTIES_OPTION = "all_counties";

const normalizeCountyFilterValue = (value: unknown): string =>
  String(value || "").trim().toLowerCase();

const matchesCountySelection = (recordCounty: unknown, selectedCounty: string): boolean => {
  if (!selectedCounty || selectedCounty === ALL_COUNTIES_OPTION) return true;
  const county = normalizeCountyFilterValue(recordCounty);
  return county ? county === normalizeCountyFilterValue(selectedCounty) : true;
};

const SALES_INPUTS_STORAGE_KEY = "sales-metrics-inputs-v1";

const USE_REMOTE_ANALYTICS = false;

const SALES_ANALYTICS_QUERY_VERSION = "v7";

const RECENT_OFFTAKES_LIMIT = 6;

// ---------------------------------------------------------------------------
// Sales prices are stored separately for the mobile app.
// These values must not feed the web dashboard sales computations.
// Path in Realtime DB:  prices  (single flat document)
//   { pricePerKg: number, expenses: number, carcassRatio: number, updatedAt: number }
// ---------------------------------------------------------------------------

const PRICES_COLLECTION_PATH = "prices";

const pricesCollectionRef = () => ref(db, PRICES_COLLECTION_PATH);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OfftakeData {
  id: string;
  date: Date | string | number;
  farmerName: string;
  gender: string;
  idNumber: string;
  county?: string;
  location: string;
  programme?: string;
  goats?: Array<{ live: string; carcass: string; price: string }>;
  sheep?: Array<{ live: string; carcass: string; price: string }>;
  cattle?: Array<{ live: string; carcass: string; price: string }>;
  totalGoats?: number;
  noSheepGoats?: number;
  totalPrice?: number;
  phone?: string;
  username?: string;
}

interface SalesInputs {
  pricePerKg: number;
  expenses: number;
}

interface PriceConfig extends SalesInputs {
  carcassRatio: number;
}

interface OrderAnalyticsItem {
  goats?: unknown;
}

interface OrderAnalyticsRecord {
  id: string;
  date?: Date | string | number;
  completedAt?: Date | string | number;
  createdAt?: Date | string | number;
  timestamp?: number;
  goats?: number;
  goatsBought?: number;
  remainingGoats?: number;
  targetGoats?: number;
  totalGoats?: number;
  programme?: string;
  sourcePage?: string;
  parentOrderId?: string;
  requestId?: string;
  targetOrderId?: string;
  offtakeOrderId?: string;
  orders?: OrderAnalyticsItem[] | Record<string, OrderAnalyticsItem>;
  purchaseHistory?: OrderAnalyticsItem[] | Record<string, OrderAnalyticsItem>;
}

interface RequisitionAnalyticsRecord {
  id: string;
  type?: string;
  status?: string;
  programme?: string;
  submittedAt?: Date | string | number;
  createdAt?: Date | string | number;
  approvedAt?: Date | string | number;
  authorizedAt?: Date | string | number;
  transactionCompletedAt?: Date | string | number;
  completedAt?: Date | string | number;
  rejectedAt?: Date | string | number;
  totalAmount?: number;
  total?: number;
  fuelAmount?: number;
  transactedAmount?: number;
}

interface TrendPoint {
  month: string;
  [key: string]: string | number;
}

interface TrendSeriesMeta {
  key: string;
  label: string;
  year: string;
  color: string;
}

interface CountyGenderPoint {
  name: string;
  Male: number;
  Female: number;
}

interface RecentOfftakeItem {
  id: string;
  name: string;
  county: string;
  location: string;
  animals: number;
  purchaseCost: number;
  dateLabel: string;
  sortTime: number;
}

interface SalesAnalyticsPayload {
  filteredCount: number;
  stats: {
    totalPurchaseCost: number;
    totalRevenue: number;
    costPerGoat: number;
    totalAnimals: number;
    totalGoats: number;
    totalSheep: number;
    totalCattle: number;
    totalLiveWeight: number;
    avgLiveWeight: number;
    totalCarcassWeight: number;
    avgCarcassWeight: number;
    pricePerKg: number;
    expenses: number;
    netProfit: number;
    avgCostPerKgCarcass: number;
    totalGoatOrdersPlaced: number;
    totalGoatsPurchasedFromOrders: number;
    requisitionExpenses: number;
    totalRequisitions: number;
    completedRequisitions: number;
    completedRequisitionAmount: number;
  };
  genderData: Array<{ name: string; value: number }>;
  countyData: Array<{ name: string; count: number }>;
  countyGenderData: CountyGenderPoint[];
  topLocations: Array<{ name: string; count: number }>;
  topFarmers: Array<{
    name: string;
    purchaseCost?: number;
    revenue?: number;
    animals: number;
    goats: number;
    county: string;
    records: number;
  }>;
  recentOfftakes: RecentOfftakeItem[];
  monthlyTrend: TrendPoint[];
  monthlyTrendSeries: TrendSeriesMeta[];
  orderPurchaseComparison: Array<{
    month: string;
    county: string;
    ordersPlaced: number;
    goatsPurchased: number;
  }>;
  requisitionTrend: TrendPoint[];
  requisitionTrendSeries: TrendSeriesMeta[];
  top3Months: Array<{ month: string; animalsPurchased: number; purchaseCost: number }>;
}

// ---------------------------------------------------------------------------
// Data Cache Manager
// ---------------------------------------------------------------------------

class DataCache {
  private cache = new Map<string, { data: OfftakeData[]; timestamp: number }>();
  private readonly maxAge = 5 * 60 * 1000; // 5 minutes

  get(key: string): OfftakeData[] | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  set(key: string, data: OfftakeData[]): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const dataCache = new DataCache();

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

const parseDate = (date: unknown): Date | null => {
  if (!date) return null;
  try {
    if (typeof date === "object" && date !== null && "toDate" in date && typeof (date as { toDate: unknown }).toDate === "function") {
      return (date as { toDate: () => Date }).toDate();
    }
    if (date instanceof Date) return date;
    if (typeof date === "number") return new Date(date);
    if (typeof date === "string") {
      const parsedISO = new Date(date);
      if (!isNaN(parsedISO.getTime())) return parsedISO;
    }
    if (typeof date === "object" && date !== null && "seconds" in date) {
      return new Date((date as { seconds: number }).seconds * 1000);
    }
  } catch (error) {
    console.error("Error parsing date:", error);
  }
  return null;
};

const formatDateToLocal = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isDateInRange = (
  date: unknown,
  startDate: string,
  endDate: string,
): boolean => {
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
  return { startDate: formatDateToLocal(startOfWeek), endDate: formatDateToLocal(endOfWeek) };
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { startDate: formatDateToLocal(startOfMonth), endDate: formatDateToLocal(endOfMonth) };
};

const getRollingSalesChartDates = () => {
  const now = new Date();
  const startOfWindow = new Date(now.getFullYear(), now.getMonth() - 18, 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: formatDateToLocal(startOfWindow),
    endDate: formatDateToLocal(endOfMonth),
  };
};

const getCurrentYearDates = () => {
  const now = new Date();
  return {
    startDate: `${now.getFullYear()}-01-01`,
    endDate: `${now.getFullYear()}-12-31`,
  };
};

const getQDates = (year: number, quarter: 1 | 2 | 3 | 4) => {
  const start = `${year}-${(quarter - 1) * 3 + 1}-01`;
  const endMonth = quarter * 3;
  const endDay = new Date(year, endMonth, 0).getDate();
  return {
    startDate: start,
    endDate: `${year}-${String(endMonth).padStart(2, "0")}-${endDay}`,
  };
};

const mergeBoundedDateRanges = (
  primaryRange: { startDate: string; endDate: string },
  fallbackRange: { startDate: string; endDate: string },
) => {
  const startDates = [primaryRange.startDate, fallbackRange.startDate].filter(Boolean);
  const endDates = [primaryRange.endDate, fallbackRange.endDate].filter(Boolean);

  return {
    startDate: startDates.length > 0 ? startDates.sort()[0] : fallbackRange.startDate,
    endDate: endDates.length > 0 ? endDates.sort()[endDates.length - 1] : fallbackRange.endDate,
  };
};

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

const getAnalyticsProgrammeToken = (value: unknown): string => {
  return normalizeProgramme(value);
};

const normalizeLooseText = (value: unknown): string =>
  typeof value === "string"
    ? value.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ")
    : "";

const parseNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const getArrayLikeSize = (value: unknown): number => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return 0;
};

const getGoatCountFromUnknown = (value: unknown): number => {
  if (typeof value === "number" || typeof value === "string") return parseNumber(value);
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.total !== undefined) return parseNumber(obj.total);
    return parseNumber(obj.male) + parseNumber(obj.female);
  }
  return 0;
};

const getAnimalArray = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value.filter(Boolean) as Array<Record<string, unknown>>) : [];

const getOfftakeGoatTotal = (record: Partial<OfftakeData>): number => {
  const goatEntries = getAnimalArray(record.goats ?? (record as Record<string, unknown>)?.Goats);
  if (goatEntries.length > 0) return goatEntries.length;

  return Math.max(
    parseNumber(record.totalGoats),
    parseNumber(record.noSheepGoats),
    getGoatCountFromUnknown(record.goats),
    parseNumber((record as Record<string, unknown>)?.Goats),
    0,
  );
};

const getAnimalPurchaseCost = (animals: Array<Record<string, unknown>>): number =>
  animals.reduce(
    (sum, animal) => sum + Math.max(parseNumber(animal.price ?? animal.Price ?? animal.totalPrice), 0),
    0,
  );

const getOfftakePurchaseCost = (record: Partial<OfftakeData>): number => {
  const animalCost = getAnimalPurchaseCost([
    ...getAnimalArray(record.goats ?? (record as Record<string, unknown>)?.Goats),
    ...getAnimalArray(record.sheep ?? (record as Record<string, unknown>)?.Sheep),
    ...getAnimalArray(record.cattle ?? (record as Record<string, unknown>)?.Cattle),
  ]);

  if (animalCost > 0) return animalCost;
  return parseNumber(record.totalPrice ?? (record as Record<string, unknown>)?.totalprice);
};

const normalizeIdentityToken = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

// ---------------------------------------------------------------------------
// FIX #3: Beneficiary aggregation now prioritises farmerName over idNumber
// ---------------------------------------------------------------------------

const getBeneficiaryAggregationKey = (record: Partial<OfftakeData>): string => {
  const nameToken = normalizeIdentityToken(record.farmerName);
  if (nameToken) return `name:${nameToken}`;

  const idToken = normalizeIdentityToken(record.idNumber);
  if (idToken) return `id:${idToken}`;

  const phoneToken = normalizeIdentityToken(record.phone);
  if (phoneToken) return `phone:${phoneToken}`;

  const usernameToken = normalizeIdentityToken(record.username);
  if (usernameToken) return `user:${usernameToken}`;

  return `record:${String(record.id || "").trim()}`;
};

// ---------------------------------------------------------------------------
// Order & Requisition helpers
// ---------------------------------------------------------------------------

const getOrderEntries = (orders: OrderAnalyticsRecord["orders"]): OrderAnalyticsItem[] => {
  if (Array.isArray(orders)) return orders.filter(Boolean);
  if (orders && typeof orders === "object") return Object.values(orders).filter(Boolean) as OrderAnalyticsItem[];
  return [];
};

const getOrderPurchaseEntries = (purchaseHistory: OrderAnalyticsRecord["purchaseHistory"]): OrderAnalyticsItem[] => {
  if (Array.isArray(purchaseHistory)) return purchaseHistory.filter(Boolean);
  if (purchaseHistory && typeof purchaseHistory === "object") {
    return Object.values(purchaseHistory).filter(Boolean) as OrderAnalyticsItem[];
  }
  return [];
};

const getOrderReferenceId = (record: OrderAnalyticsRecord): string => {
  const recordId = String(record.id || "").trim();
  const candidates = [
    record.parentOrderId,
    record.requestId,
    record.targetOrderId,
    record.offtakeOrderId,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized && normalized !== recordId) return normalized;
  }
  return "";
};

const getOrderTotalGoats = (record: OrderAnalyticsRecord): number => {
  const embeddedItemsTotal = getOrderEntries(record.orders).reduce(
    (sum, item) => sum + parseNumber(item.goats),
    0,
  );

  return Math.max(
    embeddedItemsTotal,
    parseNumber(record.targetGoats),
    parseNumber(record.totalGoats),
    parseNumber(record.goats),
    parseNumber(record.goatsBought) + parseNumber(record.remainingGoats),
    0,
  );
};

const isBatchOrderRecord = (record: OrderAnalyticsRecord): boolean => {
  if (getOrderReferenceId(record)) return false;

  const hasEmbeddedOrders = getOrderEntries(record.orders).length > 0;
  const hasTarget = getOrderTotalGoats(record) > 0;
  const sourcePage = normalizeLooseText(record.sourcePage);

  if (sourcePage && sourcePage !== "orders" && !hasEmbeddedOrders && parseNumber(record.totalGoats) <= 0) {
    return false;
  }

  return hasEmbeddedOrders || hasTarget;
};

const getOrderRecordDate = (
  record: OrderAnalyticsRecord,
): unknown =>
  record.date || record.completedAt || record.createdAt || record.timestamp;

const getRequisitionRequestedAmount = (record: RequisitionAnalyticsRecord): number => {
  const recordType = normalizeLooseText(record.type);
  if (recordType === "fuel and service") {
    return Math.max(parseNumber(record.fuelAmount), parseNumber(record.totalAmount), 0);
  }
  return Math.max(parseNumber(record.total), parseNumber(record.totalAmount), 0);
};

const getRequisitionRecordDate = (
  record: RequisitionAnalyticsRecord,
): unknown =>
  record.submittedAt ||
  record.createdAt ||
  record.approvedAt ||
  record.authorizedAt ||
  record.transactionCompletedAt ||
  record.completedAt ||
  record.rejectedAt;

const getRequisitionStatus = (record: RequisitionAnalyticsRecord): string => {
  const normalizedStatus = normalizeLooseText(record.status);
  if (normalizedStatus) return normalizedStatus;
  if (record.transactionCompletedAt || record.completedAt) return "complete";
  if (record.rejectedAt) return "rejected";
  if (record.authorizedAt || record.approvedAt) return "approved";
  return "pending";
};

const getRequisitionAnalyticsAmount = (
  record: RequisitionAnalyticsRecord,
): number => {
  const transactedAmount = parseNumber(record.transactedAmount);
  if (
    transactedAmount > 0 &&
    (record.transactionCompletedAt || record.completedAt || getRequisitionStatus(record) === "complete")
  ) {
    return transactedAmount;
  }

  return getRequisitionRequestedAmount(record);
};

const getOrderPurchasedGoats = (record: OrderAnalyticsRecord): number => {
  const purchasedFromHistory = getOrderPurchaseEntries(record.purchaseHistory).reduce(
    (sum, item) => sum + parseNumber(item.goats),
    0,
  );
  const purchasedGoats = Math.max(parseNumber(record.goatsBought), purchasedFromHistory, 0);
  const totalGoats = Math.max(getOrderTotalGoats(record), 0);

  return Math.min(purchasedGoats, totalGoats);
};

const buildTrendSeries = (
  monthlyValues: Record<string, number>,
): { data: TrendPoint[]; series: TrendSeriesMeta[] } => {
  const years = Array.from(
    new Set(
      Object.keys(monthlyValues)
        .map((monthKey) => monthKey.slice(0, 4))
        .filter((year) => /^\d{4}$/.test(year)),
    ),
  ).sort();

  const series = years.map((year, index) => ({
    key: `year_${year}`,
    label: year,
    year,
    color: TREND_SERIES_COLORS[index % TREND_SERIES_COLORS.length],
  }));

  const data = ALL_MONTHS.map((month, monthIndex) => {
    const point: TrendPoint = { month };
    const monthToken = String(monthIndex + 1).padStart(2, "0");

    series.forEach(({ key, year }) => {
      point[key] = monthlyValues[`${year}-${monthToken}`] ?? 0;
    });

    return point;
  });

  return { data, series };
};

// ---------------------------------------------------------------------------
// Empty-state factory
// ---------------------------------------------------------------------------

const createEmptySalesAnalytics = (salesInputs: SalesInputs): SalesAnalyticsPayload => ({
  filteredCount: 0,
  stats: {
    totalPurchaseCost: 0,
    totalRevenue: 0,
    costPerGoat: 0,
    totalAnimals: 0,
    totalGoats: 0,
    totalSheep: 0,
    totalCattle: 0,
    totalLiveWeight: 0,
    avgLiveWeight: 0,
    totalCarcassWeight: 0,
    avgCarcassWeight: 0,
    pricePerKg: salesInputs.pricePerKg,
    expenses: salesInputs.expenses,
    netProfit: -salesInputs.expenses,
    avgCostPerKgCarcass: 0,
    totalGoatOrdersPlaced: 0,
    totalGoatsPurchasedFromOrders: 0,
    requisitionExpenses: 0,
    totalRequisitions: 0,
    completedRequisitions: 0,
    completedRequisitionAmount: 0,
  },
  genderData: [],
  countyData: [],
  countyGenderData: [],
  topLocations: [],
  topFarmers: [],
  recentOfftakes: [],
  monthlyTrend: [],
  monthlyTrendSeries: [],
  orderPurchaseComparison: [],
  requisitionTrend: [],
  requisitionTrendSeries: [],
  top3Months: [],
});

// ---------------------------------------------------------------------------
// Offtake record transformer – extracted for reuse & testability
// ---------------------------------------------------------------------------

const toAnimalArr = (value: unknown): Array<{ live: string; carcass: string; price: string }> => {
  if (Array.isArray(value)) return value.filter(Boolean) as Array<{ live: string; carcass: string; price: string }>;
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .filter(Boolean) as Array<{ live: string; carcass: string; price: string }>;
  }
  return [];
};

const transformOfftakeSnapshot = (
  snapshot: Record<string, Record<string, unknown>>,
  normalizedActive: string,
  allowedProgrammes: readonly string[] = [],
): OfftakeData[] => {
  const allowedProgrammeSet = new Set(
    allowedProgrammes.map((programme) => getAnalyticsProgrammeToken(programme)).filter(Boolean),
  );

  return Object.entries(snapshot).map(([key, item]) => {
    // Defensive programme filter
    const recProg = getAnalyticsProgrammeToken(item.programme ?? item.Programme ?? "");
    if (normalizedActive) {
      if (!recProg || recProg !== normalizedActive) return null;
    } else if (allowedProgrammeSet.size > 0 && !allowedProgrammeSet.has(recProg)) {
      return null;
    }

    let dateValue: Date | string | number =
      (item.date ?? item.Date ?? item.createdAt) as Date | string | number;
    if (typeof dateValue === "number") {
      dateValue = new Date(dateValue);
    } else if (typeof dateValue === "string") {
      const d = new Date(dateValue);
      if (!isNaN(d.getTime())) dateValue = d;
    }

    const goatsArr = toAnimalArr(item.goats);
    const sheepArr = toAnimalArr(item.sheep);
    const cattleArr = toAnimalArr(item.cattle);

    return {
      id: key,
      date: dateValue,
      farmerName: (item.farmerName ?? item.name ?? "") as string,
      gender: (item.gender ?? "") as string,
      idNumber: (item.idNumber ?? "") as string,
      location: (item.location ?? item.Location ?? "") as string,
      county: (item.county ?? item.region ?? item.County ?? "") as string,
      programme: (item.programme ?? item.Programme ?? "") as string,
      phone: (item.phone ?? item.phoneNumber ?? "") as string,
      username: (item.username ?? item.offtakeUserId ?? "") as string,
      goats: goatsArr,
      sheep: sheepArr,
      cattle: cattleArr,
      totalGoats:
        goatsArr.length > 0
          ? goatsArr.length
          : (Number(item.totalGoats) || Number(item.noSheepGoats) || 0),
      noSheepGoats: Number(item.noSheepGoats) || 0,
      totalPrice:
        Number(item.totalPrice ?? item.totalprice ?? 0) || 0,
    } as OfftakeData;
  }).filter((r): r is OfftakeData => r !== null);
};

// ---------------------------------------------------------------------------
// Core analytics builder
// ---------------------------------------------------------------------------

const buildLocalSalesAnalytics = (
  records: OfftakeData[],
  orders: OrderAnalyticsRecord[],
  requisitions: RequisitionAnalyticsRecord[],
  dateRange: { startDate: string; endDate: string },
  selectedProgramme: string | null,
  salesInputs: SalesInputs,
  topMonthsRecords: OfftakeData[] = records,
  selectedCounty = ALL_COUNTIES_OPTION,
): SalesAnalyticsPayload => {
  const targetProgramme = getAnalyticsProgrammeToken(selectedProgramme);

  const filteredData = records.filter((record) => {
    const recordProgramme = getAnalyticsProgrammeToken(record.programme);
    const matchesProgramme = !targetProgramme || recordProgramme === targetProgramme;
    return matchesProgramme &&
      matchesCountySelection(record.county, selectedCounty) &&
      isDateInRange(record.date, dateRange.startDate, dateRange.endDate);
  });

  // Accumulators
  let totalPurchaseCost = 0;
  let totalRevenue = 0;
  let totalGoats = 0;
  let totalSheep = 0;
  let totalCattle = 0;
  let totalLiveWeight = 0;
  let totalCarcassWeight = 0;
  let totalAnimalsCount = 0;
  let totalGoatOrdersPlaced = 0;
  let totalGoatsPurchasedFromOrders = 0;
  let requisitionExpenses = 0;
  let totalRequisitions = 0;
  let completedRequisitions = 0;
  let completedRequisitionAmount = 0;

  const genderCounts: Record<string, number> = { Male: 0, Female: 0 };
  const countySales: Record<string, number> = {};
  const countyGenderCounts: Record<string, { Male: number; Female: number }> = {};
  const locationSales: Record<string, number> = {};
  const farmerSales: Record<string, {
    name: string;
    purchaseCost: number;
    animals: number;
    goats: number;
    county: string;
    records: number;
  }> = {};
  const monthlyData: Record<string, {
    year: string;
    monthName: string;
    revenue: number;
    volume: number;
    animalsPurchased: number;
    purchaseCost: number;
  }> = {};
  const requisitionMonthlyData: Record<string, {
    year: string;
    monthName: string;
    count: number;
    amount: number;
  }> = {};
  const orderMonthlyData: Record<string, {
    year: string;
    monthName: string;
    ordersPlaced: number;
    goatsPurchased: number;
  }> = {};
  const topMonthsMonthlyData: Record<string, {
    year: string;
    monthName: string;
    animalsPurchased: number;
    purchaseCost: number;
  }> = {};
  const recentOfftakesList: RecentOfftakeItem[] = [];

  // Pre-filter orders & requisitions
  const filteredOrders = orders.filter((record) => {
    const recordProgramme = getAnalyticsProgrammeToken(record.programme);
    const matchesProgramme = !targetProgramme || recordProgramme === targetProgramme;
    return matchesProgramme &&
      matchesCountySelection((record as any).county ?? (record as any).County, selectedCounty) &&
      isDateInRange(getOrderRecordDate(record), dateRange.startDate, dateRange.endDate);
  });

  const filteredRequisitions = requisitions.filter((record) => {
    const recordProgramme = getAnalyticsProgrammeToken(record.programme);
    const matchesProgramme = !targetProgramme || recordProgramme === targetProgramme;
    return matchesProgramme &&
      matchesCountySelection((record as any).county ?? (record as any).County, selectedCounty) &&
      isDateInRange(getRequisitionRecordDate(record), dateRange.startDate, dateRange.endDate);
  });

  const topMonthsData = topMonthsRecords.filter((record) => {
    const recordProgramme = getAnalyticsProgrammeToken(record.programme);
    return (!targetProgramme || recordProgramme === targetProgramme) &&
      matchesCountySelection(record.county, selectedCounty);
  });

  // ---- Process offtake records ----
  for (const record of filteredData) {
    const goatsArr: Array<{ live: string; carcass: string; price: string }> = Array.isArray(record.goats)
      ? record.goats
      : [];
    const sheepArr: Array<{ live: string; carcass: string; price: string }> = Array.isArray(record.sheep)
      ? record.sheep
      : [];
    const cattleArr: Array<{ live: string; carcass: string; price: string }> = Array.isArray(record.cattle)
      ? record.cattle
      : [];

    const txGoats = getOfftakeGoatTotal(record);
    const txSheep = sheepArr.length;
    const txCattle = cattleArr.length;
    const txCost = getOfftakePurchaseCost(record);

    totalPurchaseCost += txCost;
    totalGoats += txGoats;
    totalSheep += txSheep;
    totalCattle += txCattle;
    totalAnimalsCount += txGoats + txSheep + txCattle;

    const allAnimals = [...goatsArr, ...sheepArr, ...cattleArr];
    let txCarcassWeight = 0;

    for (const animal of allAnimals) {
      totalLiveWeight += parseNumber(animal?.live);
      const cw = parseNumber(animal?.carcass);
      totalCarcassWeight += cw;
      txCarcassWeight += cw;
    }

    totalRevenue += txCarcassWeight * salesInputs.pricePerKg;

    // Gender
    let normalizedGender = "";
    if (record.gender) {
      normalizedGender =
        record.gender.charAt(0).toUpperCase() +
        record.gender.slice(1).toLowerCase();
      if (normalizedGender in genderCounts) genderCounts[normalizedGender] += 1;
    }

    // County, location, farmer
    const county = String(record.county || "Unknown").trim() || "Unknown";
    const location = String(record.location || "Unknown").trim() || "Unknown";
    const farmerName =
      String(record.farmerName || record.username || "Unknown").trim() || "Unknown";
    const txAnimals = txGoats + txSheep + txCattle;
    const beneficiaryKey = getBeneficiaryAggregationKey(record);

    countySales[county] = (countySales[county] || 0) + txGoats;
    locationSales[location] = (locationSales[location] || 0) + txAnimals;

    if (normalizedGender === "Male" || normalizedGender === "Female") {
      if (!countyGenderCounts[county]) countyGenderCounts[county] = { Male: 0, Female: 0 };
      countyGenderCounts[county][normalizedGender] += 1;
    }

    if (!farmerSales[beneficiaryKey]) {
      farmerSales[beneficiaryKey] = {
        name: farmerName,
        purchaseCost: 0,
        animals: 0,
        goats: 0,
        county,
        records: 0,
      };
    } else if (county !== "Unknown") {
      farmerSales[beneficiaryKey].county = county;
    }
    farmerSales[beneficiaryKey].name = farmerName || farmerSales[beneficiaryKey].name;
    farmerSales[beneficiaryKey].purchaseCost += txCost;
    farmerSales[beneficiaryKey].animals += txAnimals;
    farmerSales[beneficiaryKey].goats += txGoats;
    farmerSales[beneficiaryKey].records += 1;

    // Monthly trend
    const date = parseDate(record.date);
    if (date) {
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const monthName = date.toLocaleString("default", { month: "short" });
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          year: String(date.getFullYear()),
          monthName,
          revenue: 0,
          volume: 0,
          animalsPurchased: 0,
          purchaseCost: 0,
        };
      }
      monthlyData[monthKey].revenue += txCarcassWeight * salesInputs.pricePerKg;
      monthlyData[monthKey].volume += txAnimals;
      monthlyData[monthKey].animalsPurchased += txAnimals;
      monthlyData[monthKey].purchaseCost += txCost;

      // Recent offtakes – individual record entry, most recent first
      recentOfftakesList.push({
        id: record.id,
        name: farmerName,
        county,
        location,
        animals: txAnimals,
        purchaseCost: txCost,
        dateLabel: date.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        sortTime: date.getTime(),
      });
    }
  }

  for (const record of topMonthsData) {
    const date = parseDate(record.date);
    if (!date) continue;

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const monthName = date.toLocaleString("default", { month: "short" });
    if (!topMonthsMonthlyData[monthKey]) {
      topMonthsMonthlyData[monthKey] = {
        year: String(date.getFullYear()),
        monthName,
        animalsPurchased: 0,
        purchaseCost: 0,
      };
    }
    topMonthsMonthlyData[monthKey].animalsPurchased +=
      getOfftakeGoatTotal(record) +
      (Array.isArray(record.sheep) ? record.sheep.length : 0) +
      (Array.isArray(record.cattle) ? record.cattle.length : 0);
    topMonthsMonthlyData[monthKey].purchaseCost += getOfftakePurchaseCost(record);
  }

  // ---- Process orders ----
  filteredOrders.forEach((record) => {
    if (!isBatchOrderRecord(record)) return;
    const orderedGoats = getOrderTotalGoats(record);
    const purchasedGoats = getOrderPurchasedGoats(record);
    totalGoatOrdersPlaced += orderedGoats;
    totalGoatsPurchasedFromOrders += purchasedGoats;

    const date = parseDate(getOrderRecordDate(record));
    if (!date) return;

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const monthName = date.toLocaleString("default", { month: "short" });
    if (!orderMonthlyData[monthKey]) {
      orderMonthlyData[monthKey] = {
        year: String(date.getFullYear()),
        monthName,
        ordersPlaced: 0,
        goatsPurchased: 0,
      };
    }
    orderMonthlyData[monthKey].ordersPlaced += orderedGoats;
    orderMonthlyData[monthKey].goatsPurchased += purchasedGoats;
  });

  // ---- Process requisitions ----
  filteredRequisitions.forEach((record) => {
    const requisitionAmount = getRequisitionAnalyticsAmount(record);
    requisitionExpenses += requisitionAmount;
    totalRequisitions += 1;
    if (getRequisitionStatus(record) === "complete") {
      completedRequisitions += 1;
      completedRequisitionAmount += requisitionAmount;
    }

    const date = parseDate(getRequisitionRecordDate(record));
    if (!date) return;

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const monthName = date.toLocaleString("default", { month: "short" });
    if (!requisitionMonthlyData[monthKey]) {
      requisitionMonthlyData[monthKey] = {
        year: String(date.getFullYear()),
        monthName,
        count: 0,
        amount: 0,
      };
    }
    requisitionMonthlyData[monthKey].count += 1;
    requisitionMonthlyData[monthKey].amount += requisitionAmount;
  });

  // ---- Derived stats ----
  const costPerGoat =
    totalGoats > 0 ? totalPurchaseCost / totalGoats : 0;
  const avgLiveWeight =
    totalAnimalsCount > 0 ? totalLiveWeight / totalAnimalsCount : 0;
  const avgCarcassWeight =
    totalAnimalsCount > 0 ? totalCarcassWeight / totalAnimalsCount : 0;
  const netProfit = totalRevenue - totalPurchaseCost - salesInputs.expenses;
  const avgCostPerKgCarcass =
    totalCarcassWeight > 0 ? totalPurchaseCost / totalCarcassWeight : 0;

  const monthlyTrendValues = Object.fromEntries(
    Object.entries(monthlyData).map(([monthKey, entry]) => [monthKey, entry.volume]),
  );
  const requisitionTrendValues = Object.fromEntries(
    Object.entries(requisitionMonthlyData).map(([monthKey, entry]) => [monthKey, entry.count]),
  );
  const { data: monthlyTrend, series: monthlyTrendSeries } = buildTrendSeries(monthlyTrendValues);
  const { data: requisitionTrend, series: requisitionTrendSeries } = buildTrendSeries(requisitionTrendValues);
  const includesMultipleTopMonthYears =
    new Set(Object.values(topMonthsMonthlyData).map((entry) => entry.year)).size > 1;
  const firstPurchasedMonthKey = Object.entries(monthlyData)
    .filter(([, entry]) => entry.animalsPurchased > 0)
    .map(([monthKey]) => monthKey)
    .sort((left, right) => left.localeCompare(right))[0];
  const orderPurchaseMonthKeys = Array.from(
    new Set([...Object.keys(monthlyData), ...Object.keys(orderMonthlyData)]),
  )
    .filter((monthKey) => !firstPurchasedMonthKey || monthKey >= firstPurchasedMonthKey)
    .sort((left, right) => left.localeCompare(right));
  const orderPurchaseComparison = orderPurchaseMonthKeys.map((monthKey) => {
    const purchaseEntry = monthlyData[monthKey];
    const orderEntry = orderMonthlyData[monthKey];
    const [year, monthToken] = monthKey.split("-");
    const monthIndex = Number(monthToken) - 1;
    const monthName = ALL_MONTHS[monthIndex] ?? monthToken;

    return {
      month: `${monthName} ${year}`,
      county: selectedCounty === ALL_COUNTIES_OPTION ? "All counties" : selectedCounty,
      ordersPlaced: orderEntry?.ordersPlaced ?? 0,
      goatsPurchased: purchaseEntry?.animalsPurchased ?? orderEntry?.goatsPurchased ?? 0,
    };
  });

  const countyGenderData: CountyGenderPoint[] = Object.entries(countyGenderCounts)
    .map(([name, counts]) => ({ name, Male: counts.Male, Female: counts.Female }))
    .sort((a, b) => (b.Male + b.Female) - (a.Male + a.Female))
    .slice(0, 10);

  const recentOfftakes = recentOfftakesList
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, RECENT_OFFTAKES_LIMIT);

  return {
    filteredCount: filteredData.length,
    stats: {
      totalPurchaseCost,
      totalRevenue,
      costPerGoat,
      totalAnimals: totalAnimalsCount,
      totalGoats,
      totalSheep,
      totalCattle,
      totalLiveWeight,
      avgLiveWeight,
      totalCarcassWeight,
      avgCarcassWeight,
      pricePerKg: salesInputs.pricePerKg,
      expenses: salesInputs.expenses,
      netProfit,
      avgCostPerKgCarcass,
      totalGoatOrdersPlaced,
      totalGoatsPurchasedFromOrders,
      requisitionExpenses,
      totalRequisitions,
      completedRequisitions,
      completedRequisitionAmount,
    },
    genderData: [
      { name: "Male", value: genderCounts.Male },
      { name: "Female", value: genderCounts.Female },
    ].filter((item) => item.value > 0),
    countyData: Object.entries(countySales)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    countyGenderData,
    topLocations: Object.entries(locationSales)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    topFarmers: Object.values(farmerSales)
      .sort(
        (a, b) =>
          (b.animals - a.animals) || (b.purchaseCost - a.purchaseCost),
      )
      .slice(0, 5),
    recentOfftakes,
    monthlyTrend,
    monthlyTrendSeries,
    orderPurchaseComparison,
    requisitionTrend,
    requisitionTrendSeries,
    top3Months: Object.values(topMonthsMonthlyData)
      .sort(
        (a, b) =>
          (b.animalsPurchased - a.animalsPurchased) ||
          (b.purchaseCost - a.purchaseCost),
      )
      .slice(0, 5)
      .map((entry) => ({
        month: includesMultipleTopMonthYears
          ? `${entry.monthName} ${entry.year}`
          : entry.monthName,
        animalsPurchased: entry.animalsPurchased,
        purchaseCost: entry.purchaseCost,
      })),
  };
};

// ---------------------------------------------------------------------------
// Custom Hook – useOfftakeData
// ---------------------------------------------------------------------------

const useOfftakeData = (
  offtakeData: OfftakeData[],
  topMonthsOfftakeData: OfftakeData[],
  orderData: OrderAnalyticsRecord[],
  requisitionData: RequisitionAnalyticsRecord[],
  dateRange: { startDate: string; endDate: string },
  selectedProgramme: string | null,
  salesInputs: SalesInputs,
  selectedCounty: string,
) => {
  const localData = useMemo(
    () =>
      buildLocalSalesAnalytics(
        offtakeData,
        orderData,
        requisitionData,
        dateRange,
        selectedProgramme,
        salesInputs,
        topMonthsOfftakeData,
        selectedCounty,
      ),
    [
      offtakeData,
      topMonthsOfftakeData,
      orderData,
      requisitionData,
      dateRange.endDate,
      dateRange.startDate,
      salesInputs.pricePerKg,
      salesInputs.expenses,
      selectedProgramme,
      selectedCounty,
    ],
  );

  const queryResult = useQuery({
    queryKey: [
      SALES_ANALYTICS_QUERY_VERSION,
      "sales-report",
      selectedProgramme,
      dateRange.startDate,
      dateRange.endDate,
      salesInputs.pricePerKg,
      salesInputs.expenses,
      selectedCounty,
    ],
    queryFn: () =>
      fetchAnalysisSummary({
        scope: "sales-report",
        programme: selectedProgramme,
        dateRange,
        salesInputs,
    }),
    enabled: USE_REMOTE_ANALYTICS && !!selectedProgramme,
    staleTime: 10 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
  });

  const data: SalesAnalyticsPayload = queryResult.data || localData;

  return {
    ...data,
    isLoading: queryResult.isLoading || queryResult.isFetching,
    isError: queryResult.isError,
  };
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  subText?: string;
  subLines?: string[];
  color?: "blue" | "orange" | "yellow" | "green" | "red" | "purple" | "teal";
  valueClassName?: string;
}

const STATS_COLOR_MAP: Record<
  StatsCardProps["color"],
  { border: string; bg: string; text: string }
> = {
  blue:   { border: "bg-blue-500",   bg: "bg-blue-50",   text: "text-blue-600" },
  orange: { border: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-600" },
  yellow: { border: "bg-yellow-500", bg: "bg-yellow-50", text: "text-yellow-600" },
  green:  { border: "bg-green-500",  bg: "bg-green-50",  text: "text-green-600" },
  red:    { border: "bg-red-500",    bg: "bg-red-50",    text: "text-red-600" },
  purple: { border: "bg-purple-500", bg: "bg-purple-50", text: "text-purple-600" },
  teal:   { border: "bg-teal-500",   bg: "bg-teal-50",   text: "text-teal-600" },
};

const StatsCard = memo(function StatsCard({
  title,
  value,
  icon: Icon,
  subText,
  subLines = [],
  color = "blue",
  valueClassName = "text-xl",
}: StatsCardProps) {
  const theme = STATS_COLOR_MAP[color];
  const detailLines = [subText, ...subLines].filter(
    (line): line is string => Boolean(line),
  );

  return (
    <Card className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:border-slate-300 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${theme.border} transition-all group-hover:w-1.5`} />

      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-5 pr-4">
        <CardTitle className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </CardTitle>
        <div
          className={`rounded-lg p-2 ${theme.bg} transition-transform group-hover:scale-105`}
        >
          <Icon className={`h-4 w-4 ${theme.text}`} />
        </div>
      </CardHeader>

      <CardContent className="pl-5 pb-4 pr-4">
        <div className={`${valueClassName} font-semibold tracking-tight text-slate-900`}>
          {value}
        </div>
        {detailLines.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {detailLines.map((line, index) => (
              <p
                key={`${title}-${index}`}
                className="text-[11px] font-medium leading-snug text-slate-500"
              >
                {line}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Reusable chart-card header for consistent, more legible chart canvases
// ---------------------------------------------------------------------------

interface SectionCardHeaderProps {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  tint?: "blue" | "orange" | "yellow" | "green" | "purple" | "teal" | "maroon";
}

const HEADER_TINTS: Record<string, { bg: string; text: string }> = {
  blue: { bg: "bg-blue-50", text: "text-blue-600" },
  orange: { bg: "bg-orange-50", text: "text-orange-600" },
  yellow: { bg: "bg-yellow-50", text: "text-yellow-600" },
  green: { bg: "bg-green-50", text: "text-green-600" },
  purple: { bg: "bg-purple-50", text: "text-purple-600" },
  teal: { bg: "bg-teal-50", text: "text-teal-600" },
  maroon: { bg: "bg-red-50", text: "text-red-700" },
};

const SectionCardHeader = ({ icon: Icon, title, subtitle, tint = "blue" }: SectionCardHeaderProps) => {
  const theme = HEADER_TINTS[tint];
  return (
    <CardHeader className="px-5 pb-2 pt-5">
      <div className="flex items-center gap-2.5">
        <div className={`shrink-0 rounded-lg p-2 ${theme.bg}`}>
          <Icon className={`h-3.5 w-3.5 ${theme.text}`} />
        </div>
        <div className="min-w-0">
          <CardTitle className="text-[13px] font-semibold text-slate-800">{title}</CardTitle>
          {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{subtitle}</p>}
        </div>
      </div>
    </CardHeader>
  );
};

// ---------------------------------------------------------------------------
// Shared doughnut chart layout so every doughnut in the report matches in
// size and design. Only the color palette differs per-chart.
//
// NOTE: the legend "cards" that used to render underneath each doughnut have
// been removed per request — the chart + center total label is now the only
// thing shown, keeping the card compact and free of extra chrome.
// ---------------------------------------------------------------------------

interface DoughnutBreakdownProps {
  data: Array<{ name: string; value: number; fill: string }>;
  total: number;
  totalLabel: string;
  valueSuffix?: string;
  formatValue?: (val: number) => string;
  emptyMessage?: string;
}

const DoughnutBreakdown = memo(function DoughnutBreakdown({
  data,
  total,
  totalLabel,
  valueSuffix = "",
  formatValue,
  emptyMessage = "No data available for the selected range",
}: DoughnutBreakdownProps) {
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  if (data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="relative mx-auto h-[240px] w-full max-w-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={62}
            outerRadius={94}
            paddingAngle={4}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number | string, name: string) => [
              `${fmt(Number(value))}${valueSuffix}`,
              name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-7">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {totalLabel}
        </span>
        <span className="text-xl font-semibold text-slate-900">{fmt(total)}</span>
      </div>
    </div>
  );
});

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: "8px",
  border: "none",
  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
};

const RequisitionTrendColumnChart = ({
  data,
  series,
}: {
  data: TrendPoint[];
  series: TrendSeriesMeta[];
}) => {
  const { categories, counts } = useMemo(() => {
    const cats: string[] = [];
    const vals: number[] = [];

    data.forEach((entry) => {
      cats.push(String(entry.month || "Unknown"));

      if (series.length === 0) {
        vals.push(Number(entry.count || 0));
        return;
      }

      vals.push(
        series.reduce((total, item) => total + Number(entry[item.key] || 0), 0),
      );
    });

    return { categories: cats, counts: vals };
  }, [data, series]);

  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No requisition trend data found for the selected filters.
      </div>
    );
  }

  const options: ApexCharts.ApexOptions = {
    chart: {
      height: 280,
      background: "transparent",
      toolbar: { show: false },
      fontFamily: "inherit",
      zoom: { enabled: false },
      selection: { enabled: false },
    },
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
      title: { text: "Requisitions", style: { fontSize: "11px", color: "#64748b" } },
      labels: { style: { fontSize: "11px" } },
    },
    grid: { borderColor: "#f1f5f9", strokeDashArray: 4 },
    dataLabels: { enabled: false },
    tooltip: {
      shared: false,
      intersect: true,
      custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
        const month = categories[dataPointIndex] || "Unknown";
        const requisitions = counts[dataPointIndex] || 0;
        return `
          <div style="padding:8px 12px;font-size:12px;line-height:1.5;">
            <div style="font-weight:600;color:#0f172a;">${month}</div>
            <div style="color:#0f172a;">Requisitions: <strong>${Number(requisitions).toLocaleString()}</strong></div>
          </div>
        `;
      },
    },
    legend: { show: false },
  };

  return (
    <Chart
      options={options}
      series={[{ name: "Requisitions", data: counts }]}
      type="bar"
      height={280}
    />
  );
};

// ---------------------------------------------------------------------------
// Report Summary helpers
//
// The report summary shows every headline metric in FULL (never millified),
// grouped into logical sections, with small/clean typography. Within each
// group, metrics that are still at zero are pushed to the bottom so the
// meaningful figures are seen first.
// ---------------------------------------------------------------------------

interface SummaryItem {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
}

interface SummaryGroup {
  title: string;
  items: SummaryItem[];
}

const sortZeroLast = (items: SummaryItem[]): SummaryItem[] => {
  const withValue = items.filter((item) => Number(item.value) !== 0);
  const zeroValue = items.filter((item) => Number(item.value) === 0);
  return [...withValue, ...zeroValue];
};

// ---------------------------------------------------------------------------
// Helper: safe Firebase multi-field query with index fallback
// ---------------------------------------------------------------------------

/**
 * Tries querying by "programme" (lowercase) first, then by "Programme"
 * (capitalised).  If the capitalised query fails because no composite index
 * exists it is silently skipped instead of crashing the entire data load.
 */
const safeGetByProgramme = async (
  path: string,
  programme: string,
): Promise<DataSnapshot[]> => {
  const results: DataSnapshot[] = [];

  // Always try the lowercase variant first – this is the primary field.
  try {
    const snap = await get(
      query(ref(db, path), orderByChild("programme"), equalTo(programme)),
    );
    results.push(snap);
  } catch (err) {
    console.warn(`[safeGetByProgramme] "programme" query failed on /${path}:`, err);
  }

  // Try the capitalised variant – gracefully skip if the index is missing.
  try {
    const snap = await get(
      query(ref(db, path), orderByChild("Programme"), equalTo(programme)),
    );
    results.push(snap);
  } catch (err) {
    // Index not defined for "Programme" – this is expected on some Realtime
    // Database instances.  Log at debug level and continue.
    console.debug(
      `[safeGetByProgramme] "Programme" index missing on /${path}, skipping. Error:`,
      err,
    );
  }

  return results;
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const SalesReport = () => {
  const { userRole, userAttribute, allowedProgrammes } = useAuth();
  const { toast } = useToast();
  // ----- State -----
  const [loading, setLoading] = useState(true);
  const [offtakeData, setOfftakeData] = useState<OfftakeData[]>([]);
  const [topMonthsOfftakeData, setTopMonthsOfftakeData] = useState<OfftakeData[]>([]);
  const [orderData, setOrderData] = useState<OrderAnalyticsRecord[]>([]);
  const [requisitionData, setRequisitionData] = useState<RequisitionAnalyticsRecord[]>(
    [],
  );
  const [isCacheHit, setIsCacheHit] = useState(false);

  const currentYear = new Date().getFullYear();
  const currentMonthDates = useMemo(() => getCurrentMonthDates(), []);
  const rollingSalesChartDates = useMemo(() => getRollingSalesChartDates(), []);
  const [selectedYear, setSelectedYear] = useState<string>(ALL_YEARS_OPTION);
  const [timeFrame, setTimeFrame] = useState<"weekly" | "monthly" | "yearly">(
    "monthly",
  );
  const [dateRange, setDateRange] = useState(currentMonthDates);
  const [selectedCounty, setSelectedCounty] = useState<string>(ALL_COUNTIES_OPTION);

  const [salesInputs, setSalesInputs] = useState<SalesInputs>({
    pricePerKg: 0,
    expenses: 0,
  });
  const [priceConfig, setPriceConfig] = useState<PriceConfig>({
    pricePerKg: 0,
    expenses: 0,
    carcassRatio: 0,
  });
  const [isSalesInputsDialogOpen, setIsSalesInputsDialogOpen] = useState(false);
  const [salesInputsForm, setSalesInputsForm] = useState<{
    pricePerKg: string;
    expenses: string;
    carcassRatio: string;
  }>({ pricePerKg: "0", expenses: "0", carcassRatio: "0" });
  const [isSavingSalesInputs, setIsSavingSalesInputs] = useState(false);

  // ----- Derived / Memos -----

  const availableYears = useMemo(() => {
    const years = new Set<string>([String(currentYear)]);
    offtakeData.forEach((record) => {
      const year = parseDate(record.date)?.getFullYear();
      if (year) years.add(String(year));
    });
    orderData.forEach((record) => {
      const year = parseDate(getOrderRecordDate(record))?.getFullYear();
      if (year) years.add(String(year));
    });
    requisitionData.forEach((record) => {
      const year = parseDate(getRequisitionRecordDate(record))?.getFullYear();
      if (year) years.add(String(year));
    });

    return Array.from(years).sort((left, right) => Number(right) - Number(left));
  }, [currentYear, offtakeData, orderData, requisitionData]);

  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute, allowedProgrammes),
    [userRole, userAttribute, allowedProgrammes],
  );

  // Cast to readonly string[] so that .includes() accepts a plain string
  // argument – fixes TS 2345 when resolveAccessibleProgrammes returns a
  // narrower union-typed array such as ("KPMD" | "RANGE" | "KPMD 2")[].
  const accessibleProgrammes = useMemo(
    () =>
      (resolveAccessibleProgrammes(
        userCanViewAllProgrammeData,
        allowedProgrammes,
      ) ?? []) as readonly string[],
    [userCanViewAllProgrammeData, allowedProgrammes],
  );

  const permissionPrincipal = useMemo(
    () => resolvePermissionPrincipal(userRole, userAttribute),
    [userRole, userAttribute],
  );

  // *** CHANGE 1: Allow both admin AND M&E to manage sales inputs / prices ***
  const userCanManageSalesInputs = useMemo(
    () => isAdmin(permissionPrincipal) || permissionPrincipal === "me",
    [permissionPrincipal],
  );

  const showProgrammeFilter = accessibleProgrammes.length > 1;

  // ---------------------------------------------------------------------------
  // FIX #2: Cast activeProgram to string to satisfy DataCache.get(string)
  // ---------------------------------------------------------------------------
  const sharedSelection = useSharedProgrammeSelection(accessibleProgrammes, {
    allowAll: accessibleProgrammes.length > 1,
    fallbackToAll: accessibleProgrammes.length > 1,
  });
  const activeProgram: string = String(sharedSelection[0] ?? "");
  const setActiveProgram = sharedSelection[1];

  const appliedDefaultProgrammeRef = useRef(false);

  useEffect(() => {
    if (appliedDefaultProgrammeRef.current || accessibleProgrammes.length <= 1) return;
    appliedDefaultProgrammeRef.current = true;
    setActiveProgram(ALL_PROGRAMMES_VALUE);
  }, [accessibleProgrammes.length, setActiveProgram]);
  const selectedProgramme = activeProgram || null;
  const analysisProgramme = activeProgram || null;
  const countyOptions = useMemo(() => {
    const counties = new Map<string, string>();
    offtakeData.forEach((record) => {
      const county = String(record.county || "").trim();
      const key = normalizeCountyFilterValue(county);
      if (key && !counties.has(key)) counties.set(key, county);
    });
    return Array.from(counties.values()).sort((left, right) => left.localeCompare(right));
  }, [offtakeData]);

  const hasConfiguredPriceConfig =
    priceConfig.pricePerKg > 0 || priceConfig.expenses > 0 || priceConfig.carcassRatio > 0;

  // ----- Refs -----
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const filterStripRef = useRef<HTMLDivElement | null>(null);

  // ----- Analytics hook (deferred for smooth UI during heavy computation) -----
  const deferredDateRange = useDeferredValue(dateRange);
  const deferredSalesInputs = useDeferredValue(salesInputs);
  const isComputing = deferredDateRange !== dateRange || deferredSalesInputs !== salesInputs;
  const effectiveFetchRange = useMemo(
    () => mergeBoundedDateRanges(dateRange, rollingSalesChartDates),
    [dateRange, rollingSalesChartDates],
  );
  const salesFetchOptions = useMemo(
    () => ({
      ttlMs: 30 * 60 * 1000,
      startDate: effectiveFetchRange.startDate,
      endDate: effectiveFetchRange.endDate,
    }),
    [effectiveFetchRange.endDate, effectiveFetchRange.startDate],
  );
  const topMonthsFetchOptions = useMemo(() => {
    const currentYearDates = getCurrentYearDates();
    return {
      ttlMs: 30 * 60 * 1000,
      dateField: "createdAt",
      dateValueType: "timestamp-ms" as const,
      startDate: currentYearDates.startDate,
      endDate: currentYearDates.endDate,
    };
  }, []);
  const salesDataCacheKey = useMemo(
    () => `${activeProgram}:${effectiveFetchRange.startDate}:${effectiveFetchRange.endDate}`,
    [activeProgram, effectiveFetchRange.endDate, effectiveFetchRange.startDate],
  );
  const topMonthsDataCacheKey = useMemo(
    () => `${activeProgram}:top-months:${currentYear}`,
    [activeProgram, currentYear],
  );

  const {
    stats,
    genderData,
    countyGenderData,
    topFarmers,
    recentOfftakes,
    monthlyTrend = [],
    monthlyTrendSeries = [],
    orderPurchaseComparison = [],
    requisitionTrend = [],
    requisitionTrendSeries = [],
    filteredCount,
    top3Months,
    isLoading: analysisLoading,
    isError: analysisError,
  } = useOfftakeData(
    offtakeData,
    topMonthsOfftakeData,
    orderData,
    requisitionData,
    deferredDateRange,
    analysisProgramme,
    deferredSalesInputs,
    selectedCounty,
  );

  const {
    orderPurchaseComparison: rollingOrderPurchaseComparison = [],
  } = useOfftakeData(
    offtakeData,
    topMonthsOfftakeData,
    orderData,
    requisitionData,
    rollingSalesChartDates,
    analysisProgramme,
    deferredSalesInputs,
    selectedCounty,
  );

  // Gender doughnut – keeps the navy blue / orange palette.
  const genderDoughnutData = useMemo(
    () =>
      genderData.map((item) => ({
        ...item,
        fill: item.name === "Male" ? COLORS.darkBlue : COLORS.orange,
      })),
    [genderData],
  );
  const genderDoughnutTotal = useMemo(
    () => genderDoughnutData.reduce((sum, item) => sum + item.value, 0),
    [genderDoughnutData],
  );

  // Orders vs Purchased doughnut – maroon (Ordered) / yellow (Purchased)
  // palette so it's visually distinct from the gender chart while matching
  // its size and design.
  const orderPurchaseDoughnutData = useMemo(() => {
    const totals = orderPurchaseComparison.reduce(
      (acc, item) => ({
        ordered: acc.ordered + Number(item.ordersPlaced || 0),
        purchased: acc.purchased + Number(item.goatsPurchased || 0),
      }),
      { ordered: 0, purchased: 0 },
    );

    return [
      { name: "Ordered", value: totals.ordered, fill: COLORS.maroon },
      { name: "Purchased", value: totals.purchased, fill: COLORS.yellow },
    ].filter((item) => item.value > 0);
  }, [orderPurchaseComparison]);
  const orderPurchaseDoughnutTotal = useMemo(
    () => orderPurchaseDoughnutData.reduce((sum, item) => sum + item.value, 0),
    [orderPurchaseDoughnutData],
  );

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Notify user when Cloud Function fails so they know local data is being used
  useEffect(() => {
    if (!analysisError) return;
    toast({
      title: "Analytics service unavailable",
      description: "Showing locally computed metrics. Data is still accurate.",
    });
  }, [analysisError, toast]);

  // ---------------------------------------------------------------------------
  // Load sales inputs from localStorage for the web calculations, and load
  // the separate prices collection for the mobile app price configuration.
  //
  // 1. Restore immediately from localStorage so the UI has values instantly.
  // 2. Then listen to the "prices" collection in Firebase without feeding
  //    those values into the web computation inputs.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // --- Step 1: fast local cache restore ------------------------------------
    try {
      const storedInputs = localStorage.getItem(SALES_INPUTS_STORAGE_KEY);
      if (storedInputs) {
        const parsed = JSON.parse(storedInputs) as Partial<SalesInputs>;
        const nextPrice = Number(parsed.pricePerKg);
        const nextExpenses = Number(parsed.expenses);

        startTransition(() => {
          setSalesInputs({
            pricePerKg:
              Number.isFinite(nextPrice) && nextPrice >= 0 ? nextPrice : 0,
            expenses:
              Number.isFinite(nextExpenses) && nextExpenses >= 0 ? nextExpenses : 0,
          });
        });
      }
    } catch (error) {
      console.error("Failed to load cached sales inputs:", error);
    }

    // --- Step 2: one-time Firebase prices read --------------------------------
    let cancelled = false;
    void get(pricesCollectionRef())
      .then((snapshot) => {
        if (cancelled) return;
        if (!snapshot.exists()) return;

        const data = snapshot.val() as {
          pricePerKg?: unknown;
          expenses?: unknown;
          carcassRatio?: unknown;
          "carcassRatio:"?: unknown;
        };

        const nextPrice = parseNumber(data.pricePerKg);
        const nextExpenses = parseNumber(data.expenses);
        const nextCarcassRatio = parseNumber(data.carcassRatio ?? data["carcassRatio:"]);

        startTransition(() => {
          setPriceConfig({
            pricePerKg: nextPrice,
            expenses: nextExpenses,
            carcassRatio: nextCarcassRatio,
          });
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error listening to prices collection:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Cache sales inputs to localStorage whenever they change (offline fallback)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    try {
      localStorage.setItem(SALES_INPUTS_STORAGE_KEY, JSON.stringify(salesInputs));
    } catch {
      // Ignore storage quota / private-mode failures.
    }
  }, [salesInputs]);

  // ---------------------------------------------------------------------------
  // Combined data loading – offtake listener + orders/requisitions fetch
  // coordinated to reduce overall loading time
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Cleanup previous listener
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (USE_REMOTE_ANALYTICS) {
      setOfftakeData([]);
      setTopMonthsOfftakeData([]);
      setOrderData([]);
      setRequisitionData([]);
      setLoading(false);
      return;
    }

    if (!activeProgram) {
      setOfftakeData([]);
      setTopMonthsOfftakeData([]);
      setOrderData([]);
      setRequisitionData([]);
      setLoading(false);
      return;
    }

    const normalizedActive = getAnalyticsProgrammeToken(activeProgram);
    let cancelled = false;
    const selectedFinanceProgrammes = isAllProgrammesSelection(activeProgram)
      ? [...accessibleProgrammes]
      : normalizedActive
        ? [normalizedActive]
        : [];

    // Check cache for offtake data
    const cachedData = dataCache.get(salesDataCacheKey);
    if (cachedData) {
      setOfftakeData(cachedData);
      setIsCacheHit(true);
      // Only clear loading if orders/requisitions are not needed
      // We still need to load them, so keep loading = true
    } else {
      setIsCacheHit(false);
    }

    const cachedTopMonthsData = dataCache.get(topMonthsDataCacheKey);
    if (cachedTopMonthsData) {
      setTopMonthsOfftakeData(cachedTopMonthsData);
    } else {
      setTopMonthsOfftakeData([]);
    }

    void fetchCollectionByProgrammes<Record<string, unknown>>(
      "offtakes",
      selectedFinanceProgrammes,
      topMonthsFetchOptions,
    )
      .then((records) => {
        if (cancelled) return;

        const topMonthsList = transformOfftakeSnapshot(
          Object.fromEntries(records.map((record) => [record.id, record])),
          "",
          selectedFinanceProgrammes,
        );

        dataCache.set(topMonthsDataCacheKey, topMonthsList);
        startTransition(() => {
          setTopMonthsOfftakeData(topMonthsList);
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error fetching top month offtake data:", error);
      });

    // Kick off orders + requisitions fetch in parallel with the offtake listener
    void (async () => {
      try {
        const [ordersRecords, requisitionsRecords] = await Promise.all([
          fetchCollectionByProgrammes<Record<string, unknown>>("orders", selectedFinanceProgrammes, salesFetchOptions),
          fetchCollectionByProgrammes<Record<string, unknown>>("requisitions", selectedFinanceProgrammes, salesFetchOptions),
        ]);

        if (cancelled) return;

        const ordersList = ordersRecords.length > 0
          ? ordersRecords
              .map((item) => {
                const rec = item as Record<string, unknown>;
                return {
                  id: String(item.id || ""),
                  date: rec.date,
                  completedAt: rec.completedAt,
                  createdAt: rec.createdAt,
                  timestamp: rec.timestamp,
                  goats: rec.goats,
                  goatsBought: rec.goatsBought,
                  remainingGoats: rec.remainingGoats,
                  targetGoats: rec.targetGoats,
                  totalGoats: rec.totalGoats,
                  programme: rec.programme || rec.Programme || "",
                  sourcePage: rec.sourcePage,
                  parentOrderId: rec.parentOrderId,
                  requestId: rec.requestId,
                  targetOrderId: rec.targetOrderId,
                  offtakeOrderId: rec.offtakeOrderId,
                  orders: rec.orders,
                  purchaseHistory: rec.purchaseHistory,
                } as OrderAnalyticsRecord;
              })
              .filter(
                (record) =>
                  selectedFinanceProgrammes.includes(getAnalyticsProgrammeToken(record.programme)),
              )
          : [];

        const requisitionsList = requisitionsRecords.length > 0
          ? requisitionsRecords
              .map((item) => {
                const rec = item as Record<string, unknown>;
                return {
                  id: String(item.id || ""),
                  type: rec.type,
                  status: typeof rec.status === "string" ? rec.status : undefined,
                  programme: rec.programme || rec.Programme || "",
                  submittedAt: rec.submittedAt,
                  createdAt: rec.createdAt,
                  approvedAt: rec.approvedAt,
                  authorizedAt: rec.authorizedAt,
                  transactionCompletedAt: rec.transactionCompletedAt,
                  completedAt: rec.completedAt,
                  rejectedAt: rec.rejectedAt,
                  totalAmount: rec.totalAmount,
                  total: rec.total,
                  fuelAmount: rec.fuelAmount,
                  transactedAmount: rec.transactedAmount,
                } as RequisitionAnalyticsRecord;
              })
              .filter(
                (record) =>
                  selectedFinanceProgrammes.includes(getAnalyticsProgrammeToken(record.programme)),
              )
          : [];

        startTransition(() => {
          setOrderData(ordersList);
          setRequisitionData(requisitionsList);
        });
      } catch (error) {
        console.error("Error fetching finance collections:", error);
        if (!cancelled) {
          toast({
            title: "Error",
            description: "Failed to load order and requisition data.",
            variant: "destructive",
          });
        }
      }
    })();

    const loadSelectedProgrammeOfftakes = async () => {
      try {
        const snapshotBatches = await Promise.all(
          [fetchCollectionByProgrammes<Record<string, unknown>>("offtakes", selectedFinanceProgrammes, salesFetchOptions)],
        );

        if (cancelled) return;

        const recordsById = new Map<string, Record<string, unknown>>();
        for (const batch of snapshotBatches) {
          batch.forEach((item) => {
            recordsById.set(String((item as any).id || ""), item);
          });
        }

        const offtakeList = transformOfftakeSnapshot(
          Object.fromEntries(recordsById),
          "",
          selectedFinanceProgrammes,
        );

        dataCache.set(salesDataCacheKey, offtakeList);

        startTransition(() => {
          setOfftakeData(offtakeList);
          setIsCacheHit(false);
          setLoading(false);
        });
      } catch (error) {
        if (cancelled) return;
        console.error("Error fetching offtake data:", error);
        toast({
          title: "Error",
          description: "Failed to load offtake data.",
          variant: "destructive",
        });
        setLoading(false);
      }
    };

    if (isAllProgrammesSelection(activeProgram)) {
      void loadSelectedProgrammeOfftakes();
      unsubscribeRef.current = () => {
        cancelled = true;
      };

      return () => {
        cancelled = true;
      };
    }

    // Set up real-time listener for offtake data (single programme –
    // lowercase "programme" field is indexed, so this is safe)
    void fetchCollectionByProgrammes<Record<string, unknown>>("offtakes", selectedFinanceProgrammes, salesFetchOptions)
      .then((records) => {
        if (cancelled) return;

        if (records.length === 0) {
          startTransition(() => {
            setOfftakeData([]);
            setLoading(false);
          });
          return;
        }

        const offtakeList = transformOfftakeSnapshot(
          Object.fromEntries(records.map((record) => [record.id, record])),
          normalizedActive,
          selectedFinanceProgrammes,
        );

        dataCache.set(salesDataCacheKey, offtakeList);

        startTransition(() => {
          setOfftakeData(offtakeList);
          setIsCacheHit(false);
          setLoading(false);
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error fetching offtake data:", error);
        toast({
          title: "Error",
          description: "Failed to load offtake data.",
          variant: "destructive",
        });
        setLoading(false);
      });

    unsubscribeRef.current = () => {
      cancelled = true;
    };

    return () => {
      cancelled = true;
    };
  }, [accessibleProgrammes, activeProgram, salesDataCacheKey, salesFetchOptions, toast, topMonthsDataCacheKey, topMonthsFetchOptions]);

  // ---------------------------------------------------------------------------
  // Callbacks
  // ---------------------------------------------------------------------------

  const handleDateRangeChange = useCallback(
    (key: "startDate" | "endDate", value: string) => {
      setDateRange((prev) => {
        if (key === "startDate" && value) {
          const currentMonth = getCurrentMonthDates();
          return { ...prev, startDate: value, endDate: currentMonth.endDate };
        }
        return { ...prev, [key]: value };
      });
    },
    [],
  );

  // Commit date only on blur (when user finishes picking) to avoid
  // visual re-renders while navigating months in the native date picker.
  const [pendingDateKey, setPendingDateKey] = useState<"startDate" | "endDate" | null>(null);
  const handleDateInputFocus = useCallback((key: "startDate" | "endDate") => {
    setPendingDateKey(key);
  }, []);
  const handleDateInputBlur = useCallback(() => {
    setPendingDateKey(null);
  }, []);

  const handleYearChange = useCallback((year: string) => {
    setSelectedYear(year);

    if (year === ALL_YEARS_OPTION) {
      setDateRange({ startDate: "", endDate: "" });
      setTimeFrame("yearly");
      return;
    }

    const yearNum = parseInt(year, 10);
    setDateRange({
      startDate: `${yearNum}-01-01`,
      endDate: `${yearNum}-12-31`,
    });
    setTimeFrame("yearly");
  }, []);

  const setWeekFilter = useCallback(() => {
    const dates = getCurrentWeekDates();
    setDateRange(dates);
    setTimeFrame("weekly");
  }, []);

  const setMonthFilter = useCallback(() => {
    const dates = getCurrentMonthDates();
    setDateRange(dates);
    setTimeFrame("monthly");
  }, []);

  const setYearFilter = useCallback(() => {
    const now = new Date();
    const year = String(now.getFullYear());
    setSelectedYear(year);
    setDateRange({
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    setTimeFrame("yearly");
  }, []);

  const setQFilter = useCallback(
    (q: 1 | 2 | 3 | 4) => {
      const quarterYear =
        selectedYear === ALL_YEARS_OPTION
          ? currentYear
          : parseInt(selectedYear, 10);
      setDateRange(getQDates(quarterYear, q));
      setTimeFrame("monthly");
    },
    [currentYear, selectedYear],
  );

  const clearFilters = useCallback(() => {
    setSelectedYear(ALL_YEARS_OPTION);
    setSelectedCounty(ALL_COUNTIES_OPTION);
    setDateRange({ startDate: "", endDate: "" });
    setTimeFrame("yearly");
    setPendingDateKey(null);
    if (accessibleProgrammes.length > 1 && activeProgram !== ALL_PROGRAMMES_VALUE) {
      setActiveProgram(ALL_PROGRAMMES_VALUE);
    }
  }, [accessibleProgrammes.length, activeProgram, setActiveProgram]);

  const handleProgramChange = useCallback((program: string) => {
    setActiveProgram(program);
  }, []);

  const scrollFilterStripBy = useCallback(
    (direction: "left" | "right") => {
      const strip = filterStripRef.current;
      if (!strip) return;
      const offset = direction === "left" ? -220 : 220;
      strip.scrollBy({ left: offset, behavior: "smooth" });
    },
    [],
  );

  const openSalesInputsDialog = useCallback(() => {
    if (!userCanManageSalesInputs) return;
    setSalesInputsForm({
      pricePerKg: priceConfig.pricePerKg.toString(),
      expenses: priceConfig.expenses.toString(),
      carcassRatio: priceConfig.carcassRatio.toString(),
    });
    setIsSalesInputsDialogOpen(true);
  }, [userCanManageSalesInputs, priceConfig]);

  // ---------------------------------------------------------------------------
  // Save mobile-app prices. This writes to Firebase /prices only and does not
  // update salesInputs, so it cannot change the web dashboard computations.
  // ---------------------------------------------------------------------------
  const saveSalesInputs = useCallback(async () => {
    if (!userCanManageSalesInputs) {
      // *** CHANGE 3: Updated toast message to include M&E ***
      toast({
        title: "Unauthorized",
        description:
          "Only admin or M&E can update expense inputs.",
        variant: "destructive",
      });
      return;
    }

    const parsedPricePerKg = Math.max(
      0,
      Number(salesInputsForm.pricePerKg) || 0,
    );
    const parsedExpenses = Math.max(
      0,
      Number(salesInputsForm.expenses) || 0,
    );
    const parsedCarcassRatio = Math.max(
      0,
      Number(salesInputsForm.carcassRatio) || 0,
    );

    setIsSavingSalesInputs(true);

    try {
      await set(pricesCollectionRef(), {
        pricePerKg: parsedPricePerKg,
        expenses: parsedExpenses,
        carcassRatio: parsedCarcassRatio,
        updatedAt: Date.now(),
      });

      startTransition(() => {
        setPriceConfig({
          pricePerKg: parsedPricePerKg,
          expenses: parsedExpenses,
          carcassRatio: parsedCarcassRatio,
        });
      });

      setIsSalesInputsDialogOpen(false);

      toast({
        title: "Prices Saved",
        description: "Prices collection updated for the mobile app.",
      });
    } catch (error) {
      console.error("Failed to save prices to Firebase:", error);
      toast({
        title: "Save Failed",
        description: "Could not create or update the prices collection.",
        variant: "destructive",
      });
    } finally {
      setIsSavingSalesInputs(false);
    }
  }, [userCanManageSalesInputs, salesInputsForm, toast]);

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------

  const formatCurrency = useCallback(
    (val?: number | null) =>
      `KES ${
        Number.isFinite(Number(val))
          ? Number(val).toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })
          : "0"
      }`,
    [],
  );

  const formatNumber = useCallback(
    (val?: number | null) =>
      Number.isFinite(Number(val)) ? Number(val).toLocaleString() : "0",
    [],
  );

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

  const goatPct =
    stats.totalAnimals > 0
      ? ((stats.totalGoats / stats.totalAnimals) * 100).toFixed(1)
      : "0";
  const sheepPct =
    stats.totalAnimals > 0
      ? ((stats.totalSheep / stats.totalAnimals) * 100).toFixed(1)
      : "0";
  const orderFulfillmentPct =
    stats.totalGoatOrdersPlaced > 0
      ? Math.min(100, (stats.totalGoatsPurchasedFromOrders / stats.totalGoatOrdersPlaced) * 100)
      : 0;
  const requisitionCompletionPct =
    stats.totalRequisitions > 0
      ? Math.min(100, (stats.completedRequisitions / stats.totalRequisitions) * 100)
      : 0;
  const purchaseCostSharePct =
    stats.totalRevenue > 0
      ? Math.min(100, (stats.totalPurchaseCost / stats.totalRevenue) * 100)
      : 0;
  const hasLegacyPurchaseTrend = monthlyTrendSeries.length === 0;
  const hasMultiplePurchaseYears = monthlyTrendSeries.length > 1;

  // ---------------------------------------------------------------------------
  // Report summary – every headline metric shown in FULL (never millified),
  // grouped into logical sections, with metrics still at zero pushed to the
  // bottom of each section.
  // ---------------------------------------------------------------------------

  const formatFullValue = useCallback((val?: number | null) => {
    const num = Number(val);
    if (!Number.isFinite(num)) return "0";
    const rounded = Math.round(num * 100) / 100;
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }, []);

  const summaryGroups = useMemo<SummaryGroup[]>(() => {
    // Only the metrics that are shown millified elsewhere (in the StatsCards
    // above) are repeated here — but in FULL, unmillified form.
    const purchaseItems: SummaryItem[] = [
      { label: "Total Animals Purchased", value: stats.totalAnimals },
      { label: "Total Purchase Cost", value: stats.totalPurchaseCost, prefix: "KES " },
      { label: "Total Live Weight", value: stats.totalLiveWeight, suffix: " kg" },
    ];

    const financialItems: SummaryItem[] = [
      { label: "Total Revenue", value: stats.totalRevenue, prefix: "KES " },
      { label: "Total Expenses", value: stats.expenses, prefix: "KES " },
      { label: "Net Profit", value: stats.netProfit, prefix: "KES " },
    ];

    const orderRequisitionItems: SummaryItem[] = [
      { label: "Total Goat Orders Placed", value: stats.totalGoatOrdersPlaced },
      { label: "Total Goats Purchased", value: stats.totalGoatsPurchasedFromOrders },
      { label: "Expenses In Requisitions", value: stats.requisitionExpenses, prefix: "KES " },
    ];

    return [
      { title: "Purchases", items: sortZeroLast(purchaseItems) },
      { title: "Financials", items: sortZeroLast(financialItems) },
      { title: "Orders & Requisitions", items: sortZeroLast(orderRequisitionItems) },
    ];
  }, [stats]);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loading || (analysisLoading && !analysisError)) {
    return (
      <div className="flex flex-col justify-center items-center h-96 space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <p className="text-gray-600 font-medium animate-pulse">
          Loading dashboard data...
        </p>
        {isCacheHit && (
          <p className="text-xs text-blue-500">Using cached data...</p>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50 p-2.5 md:p-4 lg:p-5">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ---------------------------------------------------------------- */}
        {/* Header Section                                                    */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-col gap-3 md:gap-4">
          <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:flex-row md:items-center">
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-900 md:text-lg">
                Sales Metrics Dashboard
              </h1>
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                Viewing Data:{" "}
                <span className="font-medium text-blue-700">
                  {activeProgram || "All Programmes"}
                </span>
                {isCacheHit && (
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
                    Cached
                  </span>
                )}
                {isComputing && (
                  <span className="animate-pulse rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                    Computing...
                  </span>
                )}
              </p>
            </div>

            {userCanManageSalesInputs && (
              <Button
                type="button"
                variant="outline"
                className="h-8 w-full border-green-600 bg-green-600 text-xs text-white hover:bg-green-700 hover:text-white md:w-auto"
                onClick={openSalesInputsDialog}
              >
                <Calculator className="mr-2 h-3.5 w-3.5" />
                {hasConfiguredPriceConfig
                  ? "Update Prices"
                  : "Add Prices"}
              </Button>
            )}
          </div>

          {/* -------------------------------------------------------------- */}
          {/* Filter Strip                                                    */}
          {/* -------------------------------------------------------------- */}
          <Card className="w-full rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <CardContent className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                {/* Left scroll arrow (mobile only) */}
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

                <div className="min-w-0 flex-1 overflow-hidden">
                  <div
                    ref={filterStripRef}
                    className="w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                  >
                    <div className="flex w-full flex-nowrap items-center justify-between gap-2 p-1">
                      {/* Year selector */}
                      <Select
                        value={selectedYear}
                        onValueChange={handleYearChange}
                      >
                        <SelectTrigger className="h-8 w-[145px] shrink-0 border-slate-200 text-xs">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5 text-slate-500" />
                            <SelectValue placeholder="Year" />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_YEARS_OPTION}>
                            All Years
                          </SelectItem>
                          {availableYears.map((year) => (
                            <SelectItem key={year} value={year}>
                              {year}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Programme selector */}
                      {showProgrammeFilter && (
                        <Select
                          value={activeProgram}
                          onValueChange={handleProgramChange}
                        >
                          <SelectTrigger className="h-8 w-[145px] shrink-0 border-slate-200 text-xs">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ALL_PROGRAMMES_VALUE}>
                              All Programmes
                            </SelectItem>
                            {accessibleProgrammes.map((programme) => (
                              <SelectItem key={programme} value={programme}>
                                {programme}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      <Select value={selectedCounty} onValueChange={setSelectedCounty}>
                        <SelectTrigger className="h-8 w-[145px] shrink-0 border-slate-200 text-xs">
                          <SelectValue placeholder="County" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_COUNTIES_OPTION}>All Counties</SelectItem>
                          {countyOptions.map((county) => (
                            <SelectItem key={county} value={county}>
                              {county}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Date inputs */}
                      <div className="relative">
                        <Input
                          id="startDate"
                          type="date"
                          value={dateRange.startDate}
                          onChange={(e) =>
                            handleDateRangeChange("startDate", e.target.value)
                          }
                          onFocus={() => handleDateInputFocus("startDate")}
                          onBlur={handleDateInputBlur}
                          className="h-8 w-[145px] shrink-0 border-slate-200 pr-2 text-xs focus:border-blue-500"
                        />
                        {isComputing && pendingDateKey === "startDate" && (
                          <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded">
                            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <Input
                          id="endDate"
                          type="date"
                          value={dateRange.endDate}
                          onChange={(e) =>
                            handleDateRangeChange("endDate", e.target.value)
                          }
                          onFocus={() => handleDateInputFocus("endDate")}
                          onBlur={handleDateInputBlur}
                          className="h-8 w-[145px] shrink-0 border-slate-200 pr-2 text-xs focus:border-blue-500"
                        />
                        {isComputing && pendingDateKey === "endDate" && (
                          <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded">
                            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                          </div>
                        )}
                      </div>

                      {/* Quick-range buttons */}
                      <Button
                        variant="outline"
                        onClick={setMonthFilter}
                        size="sm"
                        className="h-8 shrink-0 text-xs"
                      >
                        This Month
                      </Button>

                      {/* Quarters dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0 gap-1 text-xs"
                          >
                            Quarters <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setQFilter(1)}>
                            Q1 (Jan-Mar)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setQFilter(2)}>
                            Q2 (Apr-Jun)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setQFilter(3)}>
                            Q3 (Jul-Sep)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setQFilter(4)}>
                            Q4 (Oct-Dec)
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {/* Reset */}
                      <Button
                        type="button"
                        onClick={clearFilters}
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 text-xs text-red-500 hover:text-red-600"
                      >
                        Reset
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Right scroll arrow (mobile only) */}
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

          {filteredCount === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              No offtake records matched the current programme and date range.
              Try changing the programme or widening the dates.
            </div>
          )}
        </div>

        {/* ================================================================= */}
        {/* SECTION 1: PURCHASES                                              */}
        {/* ================================================================= */}
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-2 pb-1 border-b border-gray-200">
            <Beef className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">
              Purchases Overview
            </h2>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <StatsCard
              title="Animals Purchased"
              value={millify(stats.totalAnimals)}
              icon={Package}
              subText={`Goats: ${stats.totalGoats} (${goatPct}%)  Sheep: ${stats.totalSheep} (${sheepPct}%)`}
              color="blue"
              valueClassName="text-lg"
            />
            <StatsCard
              title="Purchase Cost"
              value={millify(stats.totalPurchaseCost)}
              icon={DollarSign}
              subText={`Cost/Goat: ${formatCurrency(stats.costPerGoat)}  Avg/Kg: ${formatCurrency(stats.avgCostPerKgCarcass)}`}
              color="green"
              valueClassName="text-lg"
            />
            <StatsCard
              title="Live Weight"
              value={`${formatNumber(stats.totalLiveWeight)} Kgs`}
              icon={TrendingUp}
              subText={``}
              subLines={[
                `Avg live: ${stats.avgLiveWeight.toFixed(1)} Kgs | Carcass: ${formatNumber(stats.totalCarcassWeight)} Kgs | Avg carcass: ${stats.avgCarcassWeight.toFixed(1)} kg`,
              ]}
              color="purple"
              valueClassName="text-lg"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Doughnut – Gender (navy blue / orange) */}
            <Card className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <SectionCardHeader
                icon={Users}
                title="Farmers Participating In Offtake"
                subtitle="Gender breakdown of beneficiaries for the selected period"
                tint="blue"
              />
              <CardContent className="px-4 pb-4 sm:px-5">
                <DoughnutBreakdown
                  data={genderDoughnutData}
                  total={genderDoughnutTotal}
                  totalLabel="Farmers"
                  formatValue={formatNumber}
                  emptyMessage="No gender data available"
                />
              </CardContent>
            </Card>

            {/* Top 5 Months */}
            <Card className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <SectionCardHeader
                icon={Zap}
                title="Top Performing Months"
                subtitle="Highest volume months by animals purchased"
                tint="yellow"
              />
              <CardContent className="flex flex-1 flex-col justify-center px-5 pb-5">
                {top3Months.length > 0 ? (
                  <div className="space-y-2.5">
                    {top3Months.map((m, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 transition-all hover:border-yellow-100 hover:bg-yellow-50/40"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                              index === 0
                                ? "bg-yellow-400 text-white"
                                : index === 1
                                  ? "bg-gray-300 text-white"
                                  : "bg-orange-300 text-white"
                            }`}
                          >
                            {index + 1}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-800">
                              {m.month}
                            </p>
                            <p className="text-[11px] text-gray-500">
                              {formatNumber(m.animalsPurchased)} animals
                              purchased
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-green-700">
                            {formatCurrency(m.purchaseCost ?? 0)}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            Purchase cost
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No performance data available for selected range
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Ordered vs purchased trend */}
            <Card className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <SectionCardHeader
                icon={TrendingUp}
                title="Animals Purchased (County)"
                subtitle="Rolling monthly comparison of ordered animals and purchases"
                tint="teal"
              />
              <CardContent className="px-5 pb-5">
                {rollingOrderPurchaseComparison.length > 0 ? (
                  <div className="h-[270px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={rollingOrderPurchaseComparison}
                        margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 10, fill: "#64748b" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "#334155" }}
                          allowDecimals={false}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          cursor={{ stroke: "#e2e8f0", strokeWidth: 1 }}
                          contentStyle={TOOLTIP_STYLE}
                          labelFormatter={(label, payload) => {
                            const county = payload?.[0]?.payload?.county;
                            return county ? `${label} - ${county}` : label;
                          }}
                          formatter={(value: number | string, name: string) => [
                            `${formatNumber(Number(value))} animals`,
                            name,
                          ]}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line
                          type="monotone"
                          dataKey="goatsPurchased"
                          name="Purchased"
                          stroke={COLORS.yellow}
                          strokeWidth={2}
                          dot={{ r: 4, fill: COLORS.yellow, strokeWidth: 2, stroke: "#fff" }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex h-[270px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
                    No ordered or purchased animal trend data available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Farmers */}
            <Card className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <SectionCardHeader
                icon={Award}
                title="Top Offtake Beneficiaries"
                subtitle="Farmers with the highest purchase volume"
                tint="purple"
              />
              <CardContent className="flex-1 px-5 pb-5">
                <div className="custom-scrollbar h-[270px] space-y-2.5 overflow-y-auto pr-2">
                  {topFarmers.length > 0 ? (
                    topFarmers.map((farmer, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 transition-all duration-200 hover:border-blue-100 hover:bg-blue-50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-blue-700">
                            {idx + 1}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-800">
                              <span className="inline md:hidden">
                                {farmer.name?.split(" ")[0] || farmer.name}
                              </span>
                              <span className="hidden md:inline">
                                {farmer.name}
                              </span>
                            </p>
                            <p className="text-[11px] text-gray-500 flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              <span>{farmer.county || "Unknown"}</span>
                              <span className="text-gray-300">|</span>
                              <span>
                                {formatNumber(farmer.animals)} animals
                                purchased
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-green-700">
                            {formatCurrency(
                              farmer.purchaseCost ?? farmer.revenue ?? 0,
                            )}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            Purchase cost
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-slate-400">
                      No farmer data available
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* -------------------------------------------------------------- */}
          {/* Farmers per county (gender split) histogram + Recent Offtakes  */}
          {/* -------------------------------------------------------------- */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <SectionCardHeader
                icon={Users}
                title="Male & Female Farmers(County)"
                subtitle="Beneficiary gender split across counties for the selected period"
                tint="blue"
              />
              <CardContent className="px-4 pb-5 sm:px-5">
                {countyGenderData.length > 0 ? (
                  <div className="h-[285px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={countyGenderData}
                        margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                        barGap={4}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#f1f5f9"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 10, fill: "#64748b" }}
                          interval={0}
                          angle={-25}
                          textAnchor="end"
                          height={60}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "#334155" }}
                          allowDecimals={false}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Tooltip
                          cursor={{ fill: "rgba(148,163,184,0.08)" }}
                          contentStyle={TOOLTIP_STYLE}
                          formatter={(value: number, name: string) => [
                            `${value} farmers`,
                            name,
                          ]}
                        />
                        <Bar
                          dataKey="Male"
                          name="Male"
                          fill={COLORS.darkBlue}
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="Female"
                          name="Female"
                          fill={COLORS.orange}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex h-[285px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
                    No county gender data available for the selected range
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Offtakes */}
            <Card className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <SectionCardHeader
                icon={History}
                title="Recent Offtakes"
                subtitle="Most recent offtake transactions recorded"
                tint="teal"
              />
              <CardContent className="flex-1 px-5 pb-5">
                {recentOfftakes.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-slate-100">
                    <div className="grid grid-cols-[1.05fr_1fr_1.2fr_0.75fr] bg-slate-50 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      <span>Date</span>
                      <span>County</span>
                      <span>Location</span>
                      <span className="text-right">Goats</span>
                    </div>
                    <div className="custom-scrollbar max-h-[235px] divide-y divide-slate-100 overflow-y-auto">
                      {recentOfftakes.map((offtake, idx) => (
                        <div
                          key={offtake.id || idx}
                          className="grid grid-cols-[1.05fr_1fr_1.2fr_0.75fr] items-center gap-3 px-3 py-2.5 text-xs"
                        >
                          <span className="font-medium text-slate-900">{offtake.dateLabel}</span>
                          <span className="truncate text-slate-600">{offtake.county || "Unknown"}</span>
                          <span className="truncate text-slate-600">{offtake.location || "Unknown"}</span>
                          <span className="text-right font-semibold tabular-nums text-slate-900">
                            {formatNumber(offtake.animals)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
                    No recent offtake records available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ================================================================= */}
        {/* SECTION 2: FINANCIALS & TREND                                      */}
        {/* ================================================================= */}
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
          <div className="flex items-center gap-2 pb-1 border-b border-gray-200">
            <DollarSign className="h-4 w-4 text-green-600" />
            <h2 className="text-sm font-semibold text-slate-800">
              Financial and Expenses Tracks
            </h2>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatsCard
              title="Purchase Cost"
              value={millify(stats.totalPurchaseCost)}
              icon={DollarSign}
              subText="Total buying cost from offtake records"
              color="green"
            />
            <StatsCard
              title="Total Revenue"
              value={millify(stats.totalRevenue)}
              icon={TrendingUp}
              subText={`Carcass ${millify(stats.totalCarcassWeight)}kg x ${formatCurrency(stats.pricePerKg)}/kg`}
              color="teal"
            />
            <StatsCard
              title="Total Expenses"
              value={millify(stats.expenses)}
              icon={DollarSign}
              subText="Additional operational expenses from dialog input"
              color="orange"
            />
            <StatsCard
              title="Net Profit"
              value={millify(stats.netProfit)}
              icon={Star}
              subText={
                stats.netProfit >= 0
                  ? "Revenue - Cost - Expenses (Positive)"
                  : "Revenue - Cost - Expenses (Negative)"
              }
              color={stats.netProfit >= 0 ? "blue" : "red"}
            />
          </div>

          {/* Monthly Purchase Trend */}
          <Card className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <SectionCardHeader
              icon={TrendingUp}
              title="Monthly Purchase Trend"
              subtitle="Animals purchased month over month"
              tint="blue"
            />
            <CardContent className="px-5 pb-5">
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={monthlyTrend}>
                  <defs>
                    {hasLegacyPurchaseTrend ? (
                      <linearGradient
                        id="colorTrend"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={COLORS.darkBlue}
                          stopOpacity={0.2}
                        />
                        <stop
                          offset="95%"
                          stopColor={COLORS.darkBlue}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    ) : (
                      monthlyTrendSeries.map((series) => (
                        <linearGradient
                          key={series.key}
                          id={`purchaseTrendGradient-${series.key}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={series.color}
                            stopOpacity={0.2}
                          />
                          <stop
                            offset="95%"
                            stopColor={series.color}
                            stopOpacity={0}
                          />
                        </linearGradient>
                      ))
                    )}
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#f1f5f9"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 9, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    minTickGap={0}
                    height={54}
                    tickMargin={12}
                    angle={-35}
                    textAnchor="end"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  {!hasLegacyPurchaseTrend && hasMultiplePurchaseYears && (
                    <Legend />
                  )}
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value: number | string, name: string) => [
                      `${formatNumber(Number(value))} Animals Purchased`,
                      name,
                    ]}
                  />
                  {hasLegacyPurchaseTrend ? (
                    <Area
                      type="monotone"
                      dataKey="volume"
                      stroke={COLORS.darkBlue}
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorTrend)"
                      name="Animals Purchased"
                    />
                  ) : (
                    monthlyTrendSeries.map((series) => (
                      <Area
                        key={series.key}
                        type="monotone"
                        dataKey={series.key}
                        stroke={series.color}
                        strokeWidth={2.4}
                        fillOpacity={hasMultiplePurchaseYears ? 0 : 1}
                        fill={
                          hasMultiplePurchaseYears
                            ? "transparent"
                            : `url(#purchaseTrendGradient-${series.key})`
                        }
                        name={series.label}
                      />
                    ))
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </section>

        {/* ================================================================= */}
        {/* SECTION 3: ORDERS & REQUISITIONS                                   */}
        {/* ================================================================= */}
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
          <div className="flex items-center gap-2 pb-1 border-b border-gray-200">
            <Calendar className="h-4 w-4 text-green-600" />
            <h2 className="text-sm font-semibold text-slate-800">
              Orders and Requisition Tracks
            </h2>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <StatsCard
              title="Animals Orders Placed"
              value={millify(stats.totalGoatOrdersPlaced)}
              icon={Package}
              subText=""
              color="blue"
            />
            <StatsCard
              title="Animals Purchased"
              value={millify(stats.totalGoatsPurchasedFromOrders)}
              icon={Beef}
              subText=""
              color="teal"
            />
            <StatsCard
              title="Expenses In Requisitions"
              value={millify(stats.requisitionExpenses)}
              icon={DollarSign}
              subText={`${formatNumber(stats.totalRequisitions)} requisitions`}
             
              color="orange"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* Doughnut – Orders vs Purchased (maroon / yellow) */}
            <Card className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <SectionCardHeader
                icon={Package}
                title="Orders vs Animals Purchased"
                subtitle="Total ordered goats compared with goats bought for the selected period"
                tint="maroon"
              />
              <CardContent className="px-4 pb-5 sm:px-5">
                <DoughnutBreakdown
                  data={orderPurchaseDoughnutData}
                  total={orderPurchaseDoughnutTotal}
                  totalLabel="Goats"
                  valueSuffix=" goats"
                  formatValue={formatNumber}
                  emptyMessage="No order purchase comparison data available"
                />
              </CardContent>
            </Card>

            <Card className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <SectionCardHeader
                icon={TrendingUp}
                title="Monthly Requisition Trend"
                subtitle="Requisition movement across the selected reporting window"
                tint="orange"
              />
              <CardContent className="px-4 pb-5 sm:px-5">
                <RequisitionTrendColumnChart
                  data={requisitionTrend}
                  series={requisitionTrendSeries}
                />
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ================================================================= */}
        {/* SECTION 4: REPORT SUMMARY                                          */}
        {/* Every metric shown in FULL (not millified), grouped into logical   */}
        {/* sections with small/clean typography. Zero-value metrics are      */}
        {/* pushed to the bottom of each section.                             */}
        {/* ================================================================= */}
        <section className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-green-700">
              Report Summary
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              Report Summary
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              A consolidated view of purchase volume, order fulfillment, revenue, and requisition activity.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <CardContent className="border-l-4 border-green-600 p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-50">
                    <Beef className="h-4 w-4 text-green-700" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Purchases & Orders</h3>
                    <p className="text-[11px] text-slate-500">Animals purchased, species mix, and order progress</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[1.25fr_1fr]">
                  <div className="rounded-xl bg-green-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-green-700">Total Animals Purchased</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{formatFullValue(stats.totalAnimals)}</p>
                    <div className="mt-4 space-y-2">
                      <div>
                        <div className="mb-1 flex justify-between text-[11px] font-semibold text-slate-700">
                          <span>Goats</span>
                          <span>{goatPct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-green-100">
                          <div className="h-full rounded-full bg-green-700" style={{ width: `${goatPct}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between text-[11px] font-semibold text-slate-700">
                          <span>Sheep</span>
                          <span>{sheepPct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-green-100">
                          <div className="h-full rounded-full bg-teal-400" style={{ width: `${sheepPct}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Goats Purchased</p>
                      <p className="mt-1 text-lg font-bold text-slate-900">{formatFullValue(stats.totalGoats)}</p>
                      <p className="text-[11px] font-semibold text-slate-500">({goatPct}%)</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Sheep Purchased</p>
                      <p className="mt-1 text-lg font-bold text-slate-900">{formatFullValue(stats.totalSheep)}</p>
                      <p className="text-[11px] font-semibold text-slate-500">({sheepPct}%)</p>
                    </div>
                  </div>
                </div>

                <div className="my-5 border-t border-slate-200" />

                <div className="mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4 text-green-700" />
                  <h4 className="text-sm font-bold text-slate-800">Orders Fulfilled</h4>
                </div>
                <div className="grid gap-3 md:grid-cols-[1.25fr_1fr]">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Order Fulfillment</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{orderFulfillmentPct.toFixed(1)}%</p>
                    <div className="mt-3 h-2 rounded-full bg-green-100">
                      <div className="h-full rounded-full bg-green-700" style={{ width: `${orderFulfillmentPct}%` }} />
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500">
                      {formatFullValue(stats.totalGoatsPurchasedFromOrders)} of {formatFullValue(stats.totalGoatOrdersPlaced)} ordered animals purchased
                    </p>
                  </div>
                  <div className="grid gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Ordered</p>
                      <p className="mt-1 text-lg font-bold text-slate-900">{formatFullValue(stats.totalGoatOrdersPlaced)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Purchased</p>
                      <p className="mt-1 text-lg font-bold text-slate-900">{formatFullValue(stats.totalGoatsPurchasedFromOrders)}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <CardContent className="border-l-4 border-emerald-600 p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                    <DollarSign className="h-4 w-4 text-emerald-700" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Financials & Requisitions</h3>
                    <p className="text-[11px] text-slate-500">Revenue, purchase cost, profit, and requisition completion</p>
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Net Profit</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">KES {formatFullValue(stats.netProfit)}</p>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Total Revenue</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">KES {formatFullValue(stats.totalRevenue)}</p>
                    <p className="text-[11px] text-slate-500">Carcass-weight revenue</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Purchase Cost Share</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">{purchaseCostSharePct.toFixed(1)}%</p>
                    <p className="text-[11px] text-slate-500">Purchase cost against revenue</p>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                    <div className="bg-emerald-700" style={{ width: `${purchaseCostSharePct}%` }} />
                    <div className="bg-lime-500" style={{ width: `${Math.max(0, 100 - purchaseCostSharePct)}%` }} />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Purchase Cost</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">KES {formatFullValue(stats.totalPurchaseCost)}</p>
                      <p className="mt-1 text-[11px] text-slate-500">Expenses: KES {formatFullValue(stats.expenses)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Requisitions Complete</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{requisitionCompletionPct.toFixed(1)}%</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {formatFullValue(stats.completedRequisitions)} of {formatFullValue(stats.totalRequisitions)} requisitions
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-slate-500">
                    Requisition expenses total KES {formatFullValue(stats.requisitionExpenses)} for the selected period.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ================================================================= */}
        {/* Sales Inputs Dialog                                               */}
        {/* ================================================================= */}
        <Dialog
          open={isSalesInputsDialogOpen}
          onOpenChange={setIsSalesInputsDialogOpen}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {hasConfiguredPriceConfig
                  ? "Update Prices"
                  : "Add Prices"}
              </DialogTitle>
              <DialogDescription>
                Create or update the prices collection used by the mobile app.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-xs text-slate-500">
                Use this dialog to set or update <code>Price per Kg</code>,{" "}
                <code>Carcass Ratio</code>, and <code>Total Expenses</code> in
                the cloud. These prices do not affect the dashboard computations.
              </p>
              <div className="space-y-2">
                <Label htmlFor="price-per-kg">Price per Kg (KES)</Label>
                <Input
                  id="price-per-kg"
                  type="number"
                  min="0"
                  step="0.01"
                  value={salesInputsForm.pricePerKg}
                  onChange={(e) =>
                    setSalesInputsForm((prev) => ({
                      ...prev,
                      pricePerKg: e.target.value,
                    }))
                  }
                />
                <p className="text-xs text-slate-500">
                  Revenue is computed from carcass weight only.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="carcass-ratio">Carcass Ratio (%)</Label>
                <Input
                  id="carcass-ratio"
                  type="number"
                  min="0"
                  step="0.01"
                  value={salesInputsForm.carcassRatio}
                  onChange={(e) =>
                    setSalesInputsForm((prev) => ({
                      ...prev,
                      carcassRatio: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="total-expenses">Total Expenses (KES)</Label>
                <Input
                  id="total-expenses"
                  type="number"
                  min="0"
                  step="0.01"
                  value={salesInputsForm.expenses}
                  onChange={(e) =>
                    setSalesInputsForm((prev) => ({
                      ...prev,
                      expenses: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsSalesInputsDialogOpen(false)}
                disabled={isSavingSalesInputs}
              >
                Cancel
              </Button>
              <Button
                onClick={saveSalesInputs}
                disabled={isSavingSalesInputs}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                {isSavingSalesInputs ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : hasConfiguredPriceConfig ? (
                  "Update Prices"
                ) : (
                  "Add Prices"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default SalesReport;
