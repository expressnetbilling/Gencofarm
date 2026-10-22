import { useState, useEffect, useCallback, useMemo, type KeyboardEvent } from "react";
import { fetchCollectionByProgrammes, type DatabaseRecord } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { fetchAnalysisSummary } from "@/lib/analysis";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users, GraduationCap, Beef, UserCheck, AlertCircle, Eye, MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardInsights } from "@/components/DashboardInsights";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSharedProgrammeSelection } from "@/hooks/use-shared-programme-selection";
import { canViewAllProgrammes, isAdmin } from "@/contexts/authhelper";
import {
  ALL_PROGRAMMES_VALUE,
  normalizeProgramme as normalizeProg,
  resolveAccessibleProgrammes,
} from "@/lib/programme-access";

// --- Constants ---
const COLORS = {
  navy: "#1e3a8a",
  orange: "#f97316",
  yellow: "#f59e0b",
  maroon: "#7f1d1d"
};

// Target Constants
const TARGETS = {
  weekly: 30,
  monthly: 117,
  yearly: 1404
};
const QUARTER_TARGET = 351;
const QUARTER_TARGET_MILESTONES = [351, 351, 351, 351];
const PROGRESS_ANALYTICS_QUERY_VERSION = "v6";
const ALL_COUNTIES_VALUE = "ALL_COUNTIES";

const normalizeCountyFilterValue = (value: unknown): string =>
  String(value || "").trim().toLowerCase();

const matchesCountySelection = (recordCounty: unknown, selectedCounty: string): boolean => {
  if (!selectedCounty || selectedCounty === ALL_COUNTIES_VALUE) return true;
  return normalizeCountyFilterValue(recordCounty) === normalizeCountyFilterValue(selectedCounty);
};
const EMPTY_STATS = {
  total: 0,
  trained: 0,
  totalAnimals: 0,
  trainingRate: 0,
  maleFarmers: 0,
  femaleFarmers: 0,
  totalTrainedFromCapacity: 0,
};

// --- Interfaces ---
interface FarmerData {
  id: string;
  createdAt: number | string;
  created_at?: number | string;
  registrationDate?: number | string;
  registration_date?: number | string;
  registeredAt?: number | string;
  timestamp?: number | string;
  date?: number | string;
  name: string;
  gender: string;
  phone: string;
  county: string;
  subcounty: string;
  location: string;
  goats: number | string | { male?: number | string; female?: number | string; total?: number | string };
  sheep: number | string;
  programme?: string;
  username?: string;
}

interface TrainingData {
  id: string;
  startDate?: string;
  createdAt?: number | string;
  totalFarmers?: number;
  programme?: string;
  county?: string;
}

type ProgressStatus = "target-met" | "completed" | "in-progress" | "below-average" | "action-needed" | "not-started";

type ProgressPeriodKey = "q1" | "q2" | "q3" | "q4";

interface ProgressPeriod {
  key: ProgressPeriodKey;
  label: string;
  count: number;
  target: number;
  progressPercentage: number;
  status: ProgressStatus;
  met: boolean;
  upcoming?: boolean;
}

interface UserProgress {
  id: string;
  name: string;
  region: string;
  farmersRegistered: number;
  target: number; // Dynamic target
  progressPercentage: number;
  status: ProgressStatus;
  periods: ProgressPeriod[];
}

type FilterMode = "weekly" | "monthly" | "yearly" | "custom";

// --- Helper Functions ---

const parseDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (date instanceof Date) return date;
    if (typeof date === 'number') return new Date(date);
    if (typeof date === 'string') {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
  } catch (error) {
    console.error('Error parsing date:', error);
  }
  return null;
};

const formatDateToLocal = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const getToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const getDateTimestamp = (value: unknown): number => parseDate(value)?.getTime() || 0;

const getFarmerRegistrationDateValue = (farmer: FarmerData): unknown =>
  farmer.createdAt ??
  farmer.created_at ??
  farmer.registrationDate ??
  farmer.registration_date ??
  farmer.registeredAt ??
  farmer.timestamp ??
  farmer.date;

const getCurrentMonthDates = () => {
  const now = getToday();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    startDate: formatDateToLocal(startOfMonth),
    endDate: formatDateToLocal(now),
  };
};

const getCurrentYearDates = () => {
  const now = getToday();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return {
    startDate: formatDateToLocal(startOfYear),
    endDate: formatDateToLocal(now),
  };
};

const getCurrentWeekDates = () => {
  const now = getToday();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  return {
    startDate: formatDateToLocal(startOfWeek),
    endDate: formatDateToLocal(now),
  };
};

const getQuarterKeyForDate = (date: Date): ProgressPeriodKey =>
  `q${Math.floor(date.getMonth() / 3) + 1}` as ProgressPeriodKey;

const getQuarterKeysForDateRange = (range: { startDate?: string; endDate?: string }): ProgressPeriodKey[] => {
  if (!range.startDate && !range.endDate) return [];
  const { start, end } = normalizeDateRange(range);
  const keys: ProgressPeriodKey[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const key = getQuarterKeyForDate(cursor);
    if (!keys.includes(key)) keys.push(key);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const endKey = getQuarterKeyForDate(end);
  if (!keys.includes(endKey)) keys.push(endKey);
  return keys;
};

const normalizeDateRange = (range: { startDate?: string; endDate?: string }) => {
  const today = getToday();
  const start = parseDate(range.startDate) ?? parseDate(range.endDate) ?? today;
  const end = parseDate(range.endDate) ?? parseDate(range.startDate) ?? today;
  const normalizedStart = new Date(start);
  const normalizedEnd = new Date(end);
  normalizedStart.setHours(0, 0, 0, 0);
  normalizedEnd.setHours(0, 0, 0, 0);

  if (normalizedEnd > today) {
    normalizedEnd.setTime(today.getTime());
  }

  if (normalizedStart > normalizedEnd) {
    return {
      start: normalizedEnd,
      end: normalizedStart > today ? today : normalizedStart,
    };
  }

  return { start: normalizedStart, end: normalizedEnd };
};

const getInclusiveDayCount = (start: Date, end: Date): number =>
  Math.max(1, Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1);

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(0, 0, 0, 0);
  return result;
};

const countCoveredWeeks = (start: Date, end: Date): number => {
  let total = 0;
  let cursor = new Date(start);

  while (cursor <= end) {
    total += 1;
    const weekStart = new Date(cursor);
    weekStart.setDate(cursor.getDate() - cursor.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    cursor = addDays(weekEnd, 1);
  }

  return Math.max(1, total);
};

/**
 * Count full months between two dates.
 * A full month is counted when the day-of-month of end >= day-of-month of start.
 */
const countFullMonths = (start: Date, end: Date): number => {
  if (end < start) return 0;
  let months = 0;
  let cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  while (true) {
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const monthEnd = new Date(nextMonth);
    monthEnd.setDate(0); // Last day of current month

    // If the range includes this full month
    if (cursor <= end) {
      // Check if we have a full month or just a partial month at the end
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      if (monthStart >= start && monthEnd <= end) {
        months += 1;
      }
    }

    // Move to next month
    cursor = nextMonth;
    if (cursor > end) break;
  }

  return months;
};

/**
 * Calculate target based on exact duration of date range.
 * - Full months: 117 per month
 * - Remaining weeks: 30 per week
 * - Uses a hybrid approach for ranges spanning months + partial weeks
 */
const calculateDurationBasedTarget = (start: Date, end: Date): number => {
  if (end < start) return 0;

  const totalDays = getInclusiveDayCount(start, end);
  const fullMonths = countFullMonths(start, end);

  // Calculate remaining days after full months
  let remainingDays = totalDays;
  if (fullMonths > 0) {
    const monthsEnd = new Date(start.getFullYear(), start.getMonth() + fullMonths, 0);
    const daysInFullMonths = getInclusiveDayCount(start, monthsEnd);
    remainingDays = Math.max(0, totalDays - daysInFullMonths);
  }

  // Calculate weeks from remaining days
  const coveredWeeks = remainingDays > 0 ? Math.ceil(remainingDays / 7) : 0;

  // Apply targets
  const monthTarget = fullMonths * TARGETS.monthly;
  const weekTarget = coveredWeeks * TARGETS.weekly;

  return Math.max(1, monthTarget + weekTarget);
};

const resolveTargetMode = (
  dateRange: { startDate?: string; endDate?: string },
  filterMode: FilterMode,
): Exclude<FilterMode, "custom"> => {
  if (filterMode !== "custom") return filterMode;
  if (!dateRange.startDate && !dateRange.endDate) return "yearly";
  // If both dates are set and represent a single month, use monthly target
  if (dateRange.startDate && dateRange.endDate) {
    const start = parseDate(dateRange.startDate);
    const end = parseDate(dateRange.endDate);
    if (start && end &&
        start.getFullYear() === end.getFullYear() &&
        start.getMonth() === end.getMonth()) {
      return "monthly";
    }
  }
  return "weekly";
};

const calculateActiveTarget = (
  dateRange: { startDate?: string; endDate?: string },
  targetMode: Exclude<FilterMode, "custom">,
): number => {
  if (!dateRange.startDate && !dateRange.endDate) return TARGETS.yearly;
  const { start, end } = normalizeDateRange(dateRange);

  // For explicit filter modes (weekly/monthly buttons), use the simple calculation
  if (targetMode === "monthly") {
    // Check if it's a single month or multiple months
    const fullMonths = countFullMonths(start, end);
    if (fullMonths >= 1) {
      // Calculate remaining days for partial month
      const monthsEnd = new Date(start.getFullYear(), start.getMonth() + fullMonths, 0);
      const remainingDays = getInclusiveDayCount(monthsEnd, end);
      const monthPortion = fullMonths * TARGETS.monthly;
      const weekPortion = remainingDays > 0 ? Math.ceil(remainingDays / 7) * TARGETS.weekly : 0;
      return monthPortion + weekPortion;
    }
    return TARGETS.monthly;
  }

  if (targetMode === "weekly") {
    // For weekly mode, calculate based on covered weeks
    return countCoveredWeeks(start, end) * TARGETS.weekly;
  }

  // For yearly or custom ranges, use duration-based calculation
  return calculateDurationBasedTarget(start, end);
};

const normalizeProgramme = (value: unknown): string => normalizeProg(value);

const parseNumericValue = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

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

const getProgressStatus = (
  progressPercentage: number,
  options: { allowTargetMet?: boolean } = {},
): ProgressStatus => {
  if (options.allowTargetMet && progressPercentage >= 100) return "target-met";
  if (progressPercentage >= 50) return "in-progress";
  if (progressPercentage >= 30) return "below-average";
  return "action-needed";
};

const getProgressStatusLabel = (status: ProgressStatus): string => {
  if (status === "target-met") return "Target met";
  if (status === "completed") return "Complete";
  if (status === "in-progress") return "In Progress";
  if (status === "below-average") return "Below Average";
  if (status === "not-started") return "Not started";
  return "Action Needed";
};

const getProgressBarClass = (status: ProgressStatus): string => {
  if (status === "target-met") return "bg-green-500";
  if (status === "completed") return "bg-green-500";
  if (status === "in-progress") return "bg-blue-500";
  if (status === "below-average") return "bg-amber-400";
  if (status === "not-started") return "bg-slate-300";
  return "bg-red-400";
};

const getProgressTextClass = (status: ProgressStatus): string => {
  if (status === "target-met") return "text-green-700";
  if (status === "completed") return "text-green-700";
  if (status === "in-progress") return "text-blue-700";
  if (status === "below-average") return "text-amber-700";
  if (status === "not-started") return "text-slate-600";
  return "text-red-700";
};

const getStatusBadgeClass = (status: ProgressStatus): string => {
  if (status === "target-met") return "bg-green-50 text-green-700";
  if (status === "completed") return "bg-green-50 text-green-700";
  if (status === "in-progress") return "bg-blue-50 text-blue-700";
  if (status === "below-average") return "bg-amber-50 text-amber-700";
  if (status === "not-started") return "bg-slate-100 text-slate-600";
  return "bg-red-50 text-red-700";
};

const getStatusDotClass = (status: ProgressStatus): string => {
  if (status === "target-met") return "bg-green-500";
  if (status === "completed") return "bg-green-500";
  if (status === "in-progress") return "bg-blue-500";
  if (status === "below-average") return "bg-amber-500";
  if (status === "not-started") return "bg-slate-400";
  return "bg-red-500";
};

const getOfficerInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const isCompletedQuarter = (periodEnd: Date, analysisYear: number): boolean => {
  const today = getToday();
  const currentYear = today.getFullYear();
  if (analysisYear < currentYear) return true;
  if (analysisYear > currentYear) return false;
  const normalizedEnd = new Date(periodEnd);
  normalizedEnd.setHours(23, 59, 59, 999);
  return today > normalizedEnd;
};

const isPastAnalysisYear = (analysisYear: number): boolean =>
  analysisYear < getToday().getFullYear();

const getAnalysisYearFromDateRange = (
  dateRange: { startDate?: string; endDate?: string },
): number | null => {
  const startYear = parseDate(dateRange.startDate)?.getFullYear();
  if (typeof startYear === "number" && Number.isFinite(startYear)) return startYear;

  const endYear = parseDate(dateRange.endDate)?.getFullYear();
  if (typeof endYear === "number" && Number.isFinite(endYear)) return endYear;

  return null;
};

const getSelectedYearFromDateRange = (dateRange: { startDate?: string; endDate?: string }): string => {
  const startYear = parseDate(dateRange.startDate)?.getFullYear();
  const endYear = parseDate(dateRange.endDate)?.getFullYear();

  if (typeof startYear === "number" && Number.isFinite(startYear) &&
      typeof endYear === "number" && Number.isFinite(endYear)) {
    return startYear === endYear ? String(startYear) : "";
  }
  if (typeof startYear === "number" && Number.isFinite(startYear)) return String(startYear);
  if (typeof endYear === "number" && Number.isFinite(endYear)) return String(endYear);
  return "";
};

const getQuarterCountingCutoff = (year: number): Date | null => {
  const today = getToday();
  const currentYear = today.getFullYear();

  if (year < currentYear) {
    const endOfYear = new Date(year, 11, 31);
    endOfYear.setHours(23, 59, 59, 999);
    return endOfYear;
  }

  if (year > currentYear) {
    return null;
  }

  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);
  return endOfToday;
};

const isUpcomingQuarter = (periodStart: Date, analysisYear: number): boolean => {
  const today = getToday();
  const currentYear = today.getFullYear();
  if (analysisYear > currentYear) return true;
  if (analysisYear < currentYear) return false;
  return periodStart > today;
};

const buildQuarterTargets = (year: number) => [
  {
    key: "q1" as const,
    label: `Q1 ${year}`,
    start: new Date(year, 0, 1),
    end: new Date(year, 2, 31),
    target: QUARTER_TARGET,
  },
  {
    key: "q2" as const,
    label: `Q2 ${year}`,
    start: new Date(year, 3, 1),
    end: new Date(year, 5, 30),
    target: QUARTER_TARGET,
  },
  {
    key: "q3" as const,
    label: `Q3 ${year}`,
    start: new Date(year, 6, 1),
    end: new Date(year, 8, 30),
    target: QUARTER_TARGET_MILESTONES[2],
  },
  {
    key: "q4" as const,
    label: `Q4 ${year}`,
    start: new Date(year, 9, 1),
    end: new Date(year, 11, 31),
    target: QUARTER_TARGET_MILESTONES[3],
  },
];

const USE_REMOTE_ANALYTICS = false;

const LivestockFarmersAnalytics = () => {
  const { user, userRole, userAttribute, allowedProgrammes } = useAuth();
  const [loading, setLoading] = useState(true);
  const [allFarmers, setAllFarmers] = useState<FarmerData[]>([]);
  const [trainingRecords, setTrainingRecords] = useState<TrainingData[]>([]);
  const [filteredData, setFilteredData] = useState<FarmerData[]>([]);
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>("monthly");

  const [localUserProgressData, setLocalUserProgressData] = useState<UserProgress[]>([]);
  const [selectedOfficer, setSelectedOfficer] = useState<UserProgress | null>(null);
  const [isOfficerTargetsOpen, setIsOfficerTargetsOpen] = useState(false);
  const [officerDialogYear, setOfficerDialogYear] = useState(() => String(getToday().getFullYear()));

  const [stats, setStats] = useState(EMPTY_STATS);

  const [dateRange, setDateRange] = useState<{ startDate: string; endDate: string }>(() => getCurrentMonthDates());
  const [draftDateRange, setDraftDateRange] = useState<{ startDate: string; endDate: string }>(() => getCurrentMonthDates());
  const [selectedYear, setSelectedYear] = useState(() => String(getToday().getFullYear()));
  const [selectedCounty, setSelectedCounty] = useState<string>(ALL_COUNTIES_VALUE);
  const [pendingDateKey, setPendingDateKey] = useState<"startDate" | "endDate" | null>(null);
  const hasActiveDateFilters = Boolean(dateRange.startDate || dateRange.endDate);
  const targetMode = useMemo(
    () => resolveTargetMode(dateRange, filterMode),
    [dateRange, filterMode],
  );
  const coverageYears = useMemo(() => {
    if (hasActiveDateFilters) return null;
    const years = allFarmers
      .map((farmer) => parseDate(getFarmerRegistrationDateValue(farmer))?.getFullYear())
      .filter((year): year is number => typeof year === "number" && Number.isFinite(year));
    if (years.length === 0) return null;
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    return {
      count: Math.max(1, maxYear - minYear + 1),
      start: minYear,
      end: maxYear,
    };
  }, [allFarmers, hasActiveDateFilters]);

  const computedTarget = useMemo(() => {
    if (!hasActiveDateFilters && coverageYears?.count) {
      return coverageYears.count * TARGETS.yearly;
    }
    return calculateActiveTarget(dateRange, targetMode);
  }, [coverageYears, dateRange, hasActiveDateFilters, targetMode]);

  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute, allowedProgrammes),
    [allowedProgrammes, userRole, userAttribute]
  );
  const userIsAdmin = useMemo(() => isAdmin(userRole), [userRole]);
  const analysisYear = useMemo(
    () => {
      const parsedSelectedYear = Number.parseInt(selectedYear, 10);
      if (Number.isFinite(parsedSelectedYear)) return parsedSelectedYear;
      return getAnalysisYearFromDateRange(dateRange);
    },
    [dateRange, selectedYear]
  );
  const quarterYear = analysisYear ?? getToday().getFullYear();
  const analysisYearLabel = analysisYear ?? "All years";
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 10 }, (_, index) => String(currentYear - index));
    return selectedYear && !years.includes(selectedYear) ? [selectedYear, ...years] : years;
  }, [selectedYear]);
  const countyOptions = useMemo(() => {
    const counties = new Map<string, string>();
    allFarmers.forEach((farmer) => {
      const county = String(farmer.county || "").trim();
      const key = normalizeCountyFilterValue(county);
      if (key && !counties.has(key)) counties.set(key, county);
    });
    return Array.from(counties.values()).sort((left, right) => left.localeCompare(right));
  }, [allFarmers]);
  const quarterTargets = useMemo(() => buildQuarterTargets(quarterYear), [quarterYear]);
  const accessibleProgrammes = useMemo(
    () => resolveAccessibleProgrammes(userCanViewAllProgrammeData, allowedProgrammes),
    [allowedProgrammes, userCanViewAllProgrammeData]
  );
  const [activeProgram, setActiveProgram] = useSharedProgrammeSelection(accessibleProgrammes, {
    allowAll: accessibleProgrammes.length > 1,
    fallbackToAll: accessibleProgrammes.length > 1,
  });
  const resetAnalyticsState = useCallback(() => {
    setStats(EMPTY_STATS);
    setFilteredData([]);
    setLocalUserProgressData([]);
  }, []);

  const analyticsQuery = useQuery({
    queryKey: [
      PROGRESS_ANALYTICS_QUERY_VERSION,
      "livestock-analytics",
      user?.uid,
      userRole,
      userAttribute,
      activeProgram,
      dateRange.startDate,
      dateRange.endDate,
      selectedYear,
      selectedCounty,
      targetMode,
      computedTarget,
    ],
    queryFn: () =>
      fetchAnalysisSummary({
        scope: "livestock-analytics",
        programme: activeProgram === ALL_PROGRAMMES_VALUE ? "All" : (activeProgram || null),
        dateRange: hasActiveDateFilters ? dateRange : null,
        selectedYear: selectedYear || null,
        county: selectedCounty === ALL_COUNTIES_VALUE ? null : selectedCounty,
        timeFrame: targetMode,
        target: hasActiveDateFilters ? computedTarget : null,
      }),
    enabled: USE_REMOTE_ANALYTICS && !!activeProgram,
    placeholderData: (previousData) => previousData,
    staleTime: 10 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const effectiveTarget = useMemo(() => {
    if (!hasActiveDateFilters && USE_REMOTE_ANALYTICS) {
      const serverTarget = Number((analyticsQuery.data as any)?.activeTarget);
      return Number.isFinite(serverTarget) && serverTarget > 0 ? serverTarget : computedTarget;
    }
    return computedTarget;
  }, [analyticsQuery.data, computedTarget, hasActiveDateFilters]);

  useEffect(() => {
    const analysis = analyticsQuery.data as any;
    if (!analysis) return;

    setStats({
      total: analysis.total || 0,
      trained: analysis.trained || 0,
      totalAnimals: analysis.totalAnimals || 0,
      trainingRate: analysis.trainingRate || 0,
      maleFarmers: analysis.maleFarmers || 0,
      femaleFarmers: analysis.femaleFarmers || 0,
      totalTrainedFromCapacity: analysis.totalTrainedFromCapacity || 0,
    });
    setFilteredData([]);
  }, [analyticsQuery.data, hasActiveDateFilters, resetAnalyticsState]);

  // --- 1. Fetch User Permissions ---
  useEffect(() => {
    setAvailablePrograms(accessibleProgrammes);
  }, [accessibleProgrammes]);

  // --- 2. Data Fetching (Farmers) ---
  useEffect(() => {
    let cancelled = false;

    if (USE_REMOTE_ANALYTICS) return;
    if (!activeProgram) {
        setAllFarmers([]);
        setLocalUserProgressData([]);
        setLoading(false);
        return;
    }
    setLoading(true);

    const normalizedActiveProgram = normalizeProgramme(activeProgram);
    const mapFarmers = (records: DatabaseRecord<Record<string, any>>[]): FarmerData[] =>
      records
        .map<FarmerData | null>((record) => {
          const item = record;
          const programme = normalizeProgramme(item.programme ?? item.Programme);
          if (normalizedActiveProgram && normalizedActiveProgram !== "ALL" && programme !== normalizedActiveProgram) {
            return null;
          }

          const parsedCreatedAt =
            parseDate(item.createdAt)?.getTime() ||
            parseDate(item.created_at)?.getTime() ||
            parseDate(item.registrationDate)?.getTime() ||
            parseDate(item.registration_date)?.getTime() ||
            parseDate(item.registeredAt)?.getTime() ||
            parseDate(item.timestamp)?.getTime() ||
            parseDate(item.date)?.getTime() ||
            Date.now();

          return {
            id: item.id,
            createdAt: parsedCreatedAt,
            created_at: item.created_at,
            registrationDate: item.registrationDate,
            registration_date: item.registration_date,
            registeredAt: item.registeredAt,
            timestamp: item.timestamp,
            date: item.date,
            name: item.name || item.farmerName || '',
            gender: item.gender || '',
            phone: item.phone || item.phoneNumber || '',
            county: item.county || item.County || '',
            subcounty: item.subcounty || item.Subcounty || item["Sub County"] || item["Sub-County"] || '',
            location: item.location || item.Location || item.subcounty || item.Subcounty || '',
            goats: item.goats ?? item.Goats ?? item.totalGoats ?? 0,
            sheep: item.sheep ?? item.Sheep ?? 0,
            programme,
            username: item.username || item.created_by || item.createdBy || item.fieldOfficer || item.officer || 'Unknown User'
          };
        })
        .filter((item): item is FarmerData => item !== null)
        .sort((a, b) => getDateTimestamp(b.createdAt) - getDateTimestamp(a.createdAt));

    const programmesToRead =
      activeProgram === ALL_PROGRAMMES_VALUE
        ? accessibleProgrammes
        : [normalizeProgramme(activeProgram)].filter(Boolean);

    if (programmesToRead.length === 0) {
      setAllFarmers([]);
      setLoading(false);
      return;
    }

    fetchCollectionByProgrammes<Record<string, any>>(
      "farmers",
      programmesToRead,
      hasActiveDateFilters
        ? {
            dateField: "createdAt",
            dateValueType: "timestamp-ms",
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
          }
        : { noDateFilter: true },
    )
      .then((records) => {
        if (cancelled) return;
        setAllFarmers(mapFarmers(records));
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error fetching farmers data:", error);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeProgram, accessibleProgrammes, dateRange.endDate, dateRange.startDate, hasActiveDateFilters]);

  // --- 3. Data Fetching (Capacity Building) ---
  useEffect(() => {
    let cancelled = false;

    if (USE_REMOTE_ANALYTICS) return;
    if (!activeProgram) {
        setTrainingRecords([]);
        return;
    }
    const normalizedActiveProgram = normalizeProgramme(activeProgram);
    const mapTraining = (records: DatabaseRecord<Record<string, any>>[]): TrainingData[] =>
      records
        .map((record): TrainingData | null => {
          const item = record;
          const programme = normalizeProgramme(item.programme ?? item.Programme);
          if (normalizedActiveProgram && normalizedActiveProgram !== "ALL" && programme !== normalizedActiveProgram) {
            return null;
          }
          return {
            id: item.id,
            ...item,
            programme,
            county: item.county || item.County || "",
            startDate: item.startDate || item.start_date || item.date || item.Date,
            createdAt: item.createdAt ?? item.created_at ?? item.startDate ?? item.start_date ?? item.date ?? item.Date,
          };
        })
        .filter((item): item is TrainingData => item !== null);

    const programmesToRead =
      activeProgram === ALL_PROGRAMMES_VALUE
        ? accessibleProgrammes
        : [normalizeProgramme(activeProgram)].filter(Boolean);

    if (programmesToRead.length === 0) {
      setTrainingRecords([]);
      return;
    }

    fetchCollectionByProgrammes<Record<string, any>>(
      "capacityBuilding",
      programmesToRead,
      hasActiveDateFilters
        ? {
            dateField: "startDate",
            dateValueType: "date-string",
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
          }
        : { noDateFilter: true },
    )
      .then((records) => {
        if (cancelled) return;
        setTrainingRecords(mapTraining(records));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error fetching training data:", error);
      });

    return () => { cancelled = true; };
  }, [activeProgram, accessibleProgrammes, dateRange.endDate, dateRange.startDate, hasActiveDateFilters]);

  // --- 4. Filtering & Analytics Logic ---
  useEffect(() => {
    if (USE_REMOTE_ANALYTICS) return;
    applyFilters();
  }, [allFarmers, dateRange, effectiveTarget, filterMode, hasActiveDateFilters, resetAnalyticsState, selectedCounty, trainingRecords]);

  const isDateInRange = (date: any, startDate: string, endDate: string): boolean => {
    if (!startDate && !endDate) return true;
    const farmerDate = parseDate(date);
    if (!farmerDate) return false;
    const farmerDateOnly = new Date(farmerDate);
    farmerDateOnly.setHours(0, 0, 0, 0);
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(23, 59, 59, 999);
    if (start && farmerDateOnly < start) return false;
    if (end && farmerDateOnly > end) return false;
    return true;
  };

  const applyFilters = () => {
    const filtered = allFarmers.filter((farmer) => {
      const matchesDate = hasActiveDateFilters
        ? isDateInRange(getFarmerRegistrationDateValue(farmer), dateRange.startDate, dateRange.endDate)
        : true;
      return matchesDate && matchesCountySelection(farmer.county, selectedCounty);
    });
    setFilteredData(filtered);
    updateAnalytics(filtered);
  };

  const updateAnalytics = (data: FarmerData[]) => {
    // Gender distribution
    const maleCount = data.filter(f => String(f.gender).toLowerCase() === 'male').length;
    const femaleCount = data.filter(f => String(f.gender).toLowerCase() === 'female').length;

    // Training Stats
    const filteredTrainingRecords = trainingRecords.filter((record) =>
      isDateInRange(record.startDate || record.createdAt, dateRange.startDate, dateRange.endDate) &&
      matchesCountySelection(record.county, selectedCounty)
    );
    const totalTrainedFromCapacity = filteredTrainingRecords.reduce(
      (sum, t) => sum + parseNumericValue(t.totalFarmers),
      0
    );

    // Capacity-building totals can include repeat attendees, so keep coverage bounded to registered farmers.
    const trainingRate = data.length > 0 ?
      (Math.min(totalTrainedFromCapacity, data.length) / data.length) * 100 :
      0;

    // Animal Census
    let totalGoats = 0;
    let totalSheep = 0;

    data.forEach(farmer => {
      const g = getGoatTotal(farmer.goats);
      totalGoats += g;
      totalSheep += parseNumericValue(farmer.sheep);
    });

    const totalAnimals = totalGoats + totalSheep;

    // Set Stats
    setStats({
      total: data.length,
      trained: totalTrainedFromCapacity,
      totalAnimals,
      trainingRate,
      maleFarmers: maleCount,
      femaleFarmers: femaleCount,
      totalTrainedFromCapacity
    });

    // Field officer performance (current period)
    const currentPeriodStats: Record<string, { count: number; counties: Set<string> }> = {};
    data.forEach((farmer) => {
      const officerName = String(farmer.username || "Unknown User").trim() || "Unknown User";
      if (!currentPeriodStats[officerName]) {
        currentPeriodStats[officerName] = {
          count: 0,
          counties: new Set<string>(),
        };
      }

      currentPeriodStats[officerName].count += 1;

      const county = String(farmer.county || "").trim();
      if (county) {
        currentPeriodStats[officerName].counties.add(county);
      }
    });

    const quarterCountingCutoff = getQuarterCountingCutoff(quarterYear);
    const quarterlyStats: Record<string, { periods: Record<ProgressPeriodKey, number>; counties: Set<string> }> = {};
    allFarmers.forEach((farmer) => {
      const officerName = String(farmer.username || "Unknown User").trim() || "Unknown User";
      if (!quarterlyStats[officerName]) {
        quarterlyStats[officerName] = {
          periods: { q1: 0, q2: 0, q3: 0, q4: 0 },
          counties: new Set<string>(),
        };
      }

      const farmerDate = parseDate(getFarmerRegistrationDateValue(farmer));
      if (
        farmerDate &&
        quarterCountingCutoff &&
        farmerDate.getFullYear() === quarterYear &&
        farmerDate <= quarterCountingCutoff
      ) {
        quarterTargets.forEach((period) => {
          if (farmerDate >= period.start && farmerDate <= period.end) {
            quarterlyStats[officerName].periods[period.key] += 1;
          }
        });
      }

      const county = String(farmer.county || "").trim();
      if (county) {
        quarterlyStats[officerName].counties.add(county);
      }
    });

    const officerNames = new Set<string>([
      ...Object.keys(currentPeriodStats),
      ...Object.keys(quarterlyStats),
    ]);
    const currentTarget = Math.max(1, Math.round(effectiveTarget));
    const isPastYearView = isPastAnalysisYear(quarterYear);

    const localProgress = [...officerNames]
      .map((name) => {
        const currentStats = currentPeriodStats[name] || { count: 0, counties: new Set<string>() };
        const quarterData = quarterlyStats[name] || {
          periods: { q1: 0, q2: 0, q3: 0, q4: 0 },
          counties: new Set<string>(),
        };
        const currentProgressPercentage = currentTarget > 0 ? (currentStats.count / currentTarget) * 100 : 0;
        const currentStatus: ProgressStatus = isPastYearView
          ? "completed"
          : getProgressStatus(currentProgressPercentage);
        const counties = [...new Set([...currentStats.counties, ...quarterData.counties])];
        const periods = quarterTargets.map((period) => {
          const count = quarterData.periods[period.key];
          const upcoming = isUpcomingQuarter(period.start, quarterYear);
          const completed = isCompletedQuarter(period.end, quarterYear);
          const progressPercentage = period.target > 0 ? (count / period.target) * 100 : 0;
          const status = upcoming
            ? "not-started"
            : isPastYearView
              ? "completed"
              : getProgressStatus(progressPercentage, { allowTargetMet: completed });
          return {
            key: period.key,
            label: period.label,
            count,
            target: period.target,
            progressPercentage,
            status,
            met: !upcoming && count >= period.target,
            upcoming,
          };
        });

        return {
          id: name,
          name,
          region: counties.slice(0, 3).join(", ") + (counties.length > 3 ? "..." : ""),
          farmersRegistered: currentStats.count,
          target: currentTarget,
          progressPercentage: currentProgressPercentage,
          status: currentStatus,
          periods,
        };
      })
      .sort((a, b) => b.farmersRegistered - a.farmersRegistered);
    setLocalUserProgressData(localProgress);
  };

  // User Progress with Dynamic Targets
  const userProgressData = useMemo(
    () => {
      const rawProgressData = USE_REMOTE_ANALYTICS ? (analyticsQuery.data as any)?.userProgressData || [] : localUserProgressData;
      return rawProgressData.map((user: any) => {
        const periods = (Array.isArray(user.periods) && user.periods.length > 0 ?
          user.periods :
          quarterTargets.map((period) => ({
            key: period.key,
            label: period.label,
            count: 0,
            target: period.target,
            progressPercentage: 0,
            status: (isUpcomingQuarter(period.start, quarterYear) ? "not-started" : "action-needed") as ProgressStatus,
            met: false,
            upcoming: isUpcomingQuarter(period.start, quarterYear),
          }))).map((period: any) => {
            const fallbackQuarter = quarterTargets.find((entry) => entry.key === period.key);
            const target = Number(fallbackQuarter?.target || period.target || QUARTER_TARGET);
            const count = Number(period.count || 0);
            const progressPercentage = target > 0 ? (count / target) * 100 : 0;
            const upcoming = fallbackQuarter ? isUpcomingQuarter(fallbackQuarter.start, quarterYear) : Boolean(period.upcoming);
            const completed = fallbackQuarter ? isCompletedQuarter(fallbackQuarter.end, quarterYear) : false;
            return {
              ...period,
              target,
              count,
              progressPercentage,
              status: upcoming
                ? "not-started"
                : getProgressStatus(progressPercentage, { allowTargetMet: completed }),
              met: !upcoming && count >= target,
              upcoming,
            };
          });
        const farmersRegistered = Number(user.farmersRegistered || 0);
        const target = Number(effectiveTarget || user.target || TARGETS.yearly);
        const progressPercentage = target > 0 ? (farmersRegistered / target) * 100 : 0;
        const status: ProgressStatus = isPastAnalysisYear(quarterYear)
          ? "completed"
          : getProgressStatus(progressPercentage);
        return {
          ...user,
          farmersRegistered,
          target,
          progressPercentage,
          status,
          periods,
        } as UserProgress;
      });
    },
    [analyticsQuery.data, effectiveTarget, localUserProgressData, quarterTargets, quarterYear],
  );
  const averageRegisteredFarmers = useMemo(() => {
    const activeOfficerCount = userProgressData.filter((user) => user.farmersRegistered > 0).length;
    return activeOfficerCount > 0 ? stats.total / activeOfficerCount : 0;
  }, [stats.total, userProgressData]);
  const selectedOfficerForYear = useMemo(() => {
    if (!selectedOfficer) return null;
    const year = Number.parseInt(officerDialogYear, 10);
    if (!Number.isFinite(year)) return selectedOfficer;

    const dialogQuarterTargets = buildQuarterTargets(year);
    const quarterCountingCutoff = getQuarterCountingCutoff(year);
    const isPastYearView = isPastAnalysisYear(year);
    const periodCounts: Record<ProgressPeriodKey, number> = { q1: 0, q2: 0, q3: 0, q4: 0 };
    const officerName = selectedOfficer.name.trim();

    allFarmers.forEach((farmer) => {
      const farmerOfficer = String(farmer.username || "Unknown User").trim() || "Unknown User";
      if (farmerOfficer !== officerName) return;

      const farmerDate = parseDate(getFarmerRegistrationDateValue(farmer));
      if (!farmerDate || !quarterCountingCutoff) return;
      if (farmerDate.getFullYear() !== year || farmerDate > quarterCountingCutoff) return;

      dialogQuarterTargets.forEach((period) => {
        if (farmerDate >= period.start && farmerDate <= period.end) {
          periodCounts[period.key] += 1;
        }
      });
    });

    const periods = dialogQuarterTargets.map((period) => {
      const count = periodCounts[period.key];
      const upcoming = isUpcomingQuarter(period.start, year);
      const completed = isCompletedQuarter(period.end, year);
      const progressPercentage = period.target > 0 ? (count / period.target) * 100 : 0;
      const status = upcoming
        ? "not-started"
        : isPastYearView
          ? "completed"
          : getProgressStatus(progressPercentage, { allowTargetMet: completed });

      return {
        key: period.key,
        label: period.label,
        count,
        target: period.target,
        progressPercentage,
        status,
        met: count >= period.target,
        upcoming,
      };
    });
    const farmersRegistered = periods.reduce((sum, period) => sum + period.count, 0);
    const target = dialogQuarterTargets.reduce((sum, period) => sum + period.target, 0);
    const progressPercentage = target > 0 ? (farmersRegistered / target) * 100 : 0;

    return {
      ...selectedOfficer,
      farmersRegistered,
      target,
      progressPercentage,
      status: isPastYearView ? "completed" : getProgressStatus(progressPercentage),
      periods,
    };
  }, [allFarmers, officerDialogYear, selectedOfficer]);
  const visibleOfficerPeriods = useMemo(() => {
    if (!selectedOfficerForYear) return [];
    if (!hasActiveDateFilters) return selectedOfficerForYear.periods;

    const visibleQuarterKeys = getQuarterKeysForDateRange(dateRange);
    return selectedOfficerForYear.periods.filter((period) => visibleQuarterKeys.includes(period.key));
  }, [dateRange, hasActiveDateFilters, selectedOfficerForYear]);

  const commitDateRange = useCallback((nextRange: { startDate: string; endDate: string }) => {
    setDateRange(nextRange);
    setSelectedYear(getSelectedYearFromDateRange(nextRange));

    if (nextRange.startDate && nextRange.endDate) {
      const start = parseDate(nextRange.startDate);
      const end = parseDate(nextRange.endDate);
      if (start && end) {
        if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
          setFilterMode("monthly");
          return;
        }
        const monthDiff = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
        if (monthDiff >= 1) {
          setFilterMode("custom");
          return;
        }
      }
    }
    setFilterMode("custom");
  }, []);

  const handleDateRangeChange = useCallback((key: "startDate" | "endDate", value: string) => {
    setDraftDateRange((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleDateInputFocus = useCallback((key: "startDate" | "endDate") => {
    setPendingDateKey(key);
  }, []);

  const handleDateInputBlur = useCallback(() => {
    setPendingDateKey(null);
    commitDateRange(draftDateRange);
  }, [commitDateRange, draftDateRange]);

  const handleDateInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    setPendingDateKey(null);
    commitDateRange(draftDateRange);
    event.currentTarget.blur();
  }, [commitDateRange, draftDateRange]);

  // Filter Buttons
  const setWeekFilter = () => {
    const nextRange = getCurrentWeekDates();
    setDateRange(nextRange);
    setDraftDateRange(nextRange);
    setSelectedYear(String(getToday().getFullYear()));
    setFilterMode("weekly");
    setPendingDateKey(null);
  };

  const setMonthFilter = () => {
    const nextRange = getCurrentMonthDates();
    setDateRange(nextRange);
    setDraftDateRange(nextRange);
    setSelectedYear(String(getToday().getFullYear()));
    setFilterMode("monthly");
    setPendingDateKey(null);
  };

  const setYearFilter = () => {
    const nextRange = getCurrentYearDates();
    setDateRange(nextRange);
    setDraftDateRange(nextRange);
    setSelectedYear(String(getToday().getFullYear()));
    setFilterMode("yearly");
    setPendingDateKey(null);
  };

  const handleYearChange = (yearValue: string) => {
    const year = Number.parseInt(yearValue, 10);
    if (!Number.isFinite(year)) return;

    setSelectedYear(yearValue);
    const nextRange = {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    };
    setDateRange(nextRange);
    setDraftDateRange(nextRange);
    setFilterMode("yearly");
    setPendingDateKey(null);
  };

  const clearFilters = () => {
    const nextRange = { startDate: "", endDate: "" };
    setDateRange(nextRange);
    setDraftDateRange(nextRange);
    setSelectedYear("");
    setSelectedCounty(ALL_COUNTIES_VALUE);
    setFilterMode("yearly"); // Reset to yearly as default after clearing
    setPendingDateKey(null);
    setSelectedOfficer(null);
    setIsOfficerTargetsOpen(false);
  };

  const getFilterButtonClass = (isActive: boolean) =>
    isActive
      ? "text-xs h-9 bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
      : "text-xs h-9";

  const openOfficerTargets = useCallback((officer: UserProgress) => {
    setOfficerDialogYear(selectedYear || String(quarterYear));
    setSelectedOfficer(officer);
    setIsOfficerTargetsOpen(true);
  }, [quarterYear, selectedYear]);

  const StatsCard = ({ title, value, icon: Icon, description, color = "navy" }: any) => (
    <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-0 bg-gradient-to-br from-white to-gray-50">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${
        color === 'navy' ? 'bg-blue-900' :
        color === 'orange' ? 'bg-orange-500' :
        color === 'yellow' ? 'bg-yellow-500' : 'bg-blue-900'
      }`}></div>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3 pl-5 pr-4">
        <CardTitle className="text-xs font-medium text-gray-600">{title}</CardTitle>
        <div className={`rounded-xl p-1.5 ${
          color === 'navy' ? 'bg-blue-100' :
          color === 'orange' ? 'bg-orange-100' :
          color === 'yellow' ? 'bg-yellow-100' : 'bg-blue-100'
        } shadow-sm`}>
          <Icon className={`h-3.5 w-3.5 ${
            color === 'navy' ? 'text-blue-900' :
            color === 'orange' ? 'text-orange-600' :
            color === 'yellow' ? 'text-yellow-600' : 'text-blue-900'
          }`} />
        </div>
      </CardHeader>
      <CardContent className="pl-5 pb-4">
        <div className="text-xl font-bold tracking-tight text-gray-900 sm:text-[1.65rem]">{value}</div>
        {description && (
          <p className="mt-1.5 text-[11px] font-medium text-gray-500">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );

  const isPageLoading = USE_REMOTE_ANALYTICS
    ? ((accessibleProgrammes.length > 0 && !activeProgram) || (analyticsQuery.isLoading && !analyticsQuery.isError && !analyticsQuery.data))
    : loading;

  if (isPageLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="ml-2 text-gray-600">Loading analytics data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-1">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">Livestock Farmers Dashboard</h1>

        {analyticsQuery.isError && !analyticsQuery.data ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Analytics took too long to load. Adjust the filters or try again.</span>
          </div>
        ) : null}

        <Card className="w-full border-0 bg-white shadow-lg">
          <CardContent className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input
                type="date"
                value={draftDateRange.startDate}
                onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                onFocus={() => handleDateInputFocus("startDate")}
                onBlur={handleDateInputBlur}
                onKeyDown={handleDateInputKeyDown}
                data-pending={pendingDateKey === "startDate" ? "true" : undefined}
                className="h-9 flex-1 min-w-[150px] border-gray-200 pr-2 text-xs focus:border-blue-500"
              />

              <Input
                type="date"
                value={draftDateRange.endDate}
                onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                onFocus={() => handleDateInputFocus("endDate")}
                onBlur={handleDateInputBlur}
                onKeyDown={handleDateInputKeyDown}
                data-pending={pendingDateKey === "endDate" ? "true" : undefined}
                className="h-9 flex-1 min-w-[150px] border-gray-200 pr-2 text-xs focus:border-blue-500"
              />

              {availablePrograms.length > 1 ? (
                <Select value={activeProgram} onValueChange={setActiveProgram}>
                  <SelectTrigger className="h-9 flex-1 min-w-[150px] border-gray-200 text-sm">
                    <SelectValue placeholder="Select Programme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Programmes</SelectItem>
                    {availablePrograms.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              <Select value={selectedCounty} onValueChange={setSelectedCounty}>
                <SelectTrigger className="h-9 flex-1 min-w-[150px] border-gray-200 text-sm">
                  <SelectValue placeholder="Select County" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_COUNTIES_VALUE}>All Counties</SelectItem>
                  {countyOptions.map((county) => (
                    <SelectItem key={county} value={county}>
                      {county}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedYear || ""} onValueChange={handleYearChange}>
                <SelectTrigger className="h-9 flex-1 min-w-[150px] border-gray-200 text-sm">
                  <SelectValue placeholder="Select Year" />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                onClick={setMonthFilter}
                size="sm"
                className={getFilterButtonClass(filterMode === "monthly")}
              >
                This Month
              </Button>
              <Button onClick={clearFilters} variant="ghost" size="sm" className="h-9 shrink-0 text-red-500 hover:text-red-600">
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {hasActiveDateFilters && stats.total === 0 && filteredData.length === 0 ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center text-base text-amber-800">
              <AlertCircle className="mr-2 h-5 w-5" />
              No farmer data for this filter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-amber-700">
              No farmers were found for the selected date range. Change the dates or use Clear to reset the filters.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
        <StatsCard
          title="Total Farmers"
          value={stats.total.toLocaleString()}
          icon={Users}
          description={`${stats.maleFarmers} Male (${stats.maleFarmers > 0 ? ((stats.maleFarmers / stats.total) * 100).toFixed(1) : 0}%) | ${stats.femaleFarmers} Female`}
          color="navy"
        />
        <StatsCard
          title="Average of Registered Farmers"
          value={averageRegisteredFarmers.toFixed(1)}
          icon={GraduationCap}
          description={`Per active field officer across ${stats.total.toLocaleString()} farmers`}
          color="yellow"
        />
        <StatsCard
          title="Animals Census"
          value={stats.totalAnimals.toLocaleString()}
          icon={Beef}
          description="Total livestock count"
          color="orange"
        />
      </div>

      <div className="space-y-6">
        <Card className="overflow-hidden border border-slate-200 bg-white shadow-lg">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                <UserCheck className="h-5 w-5 text-blue-600" />
                Field Officers Performance
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse text-left">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Field Officer</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Counties Active</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Farmers Registered</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Target</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Progress</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">View</th>
                  </tr>
                </thead>
                <tbody>
                  {userProgressData.map((user) => {
                    const statusLabel = getProgressStatusLabel(user.status);
                    return (
                      <tr key={user.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50/60">
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold text-emerald-700">
                              {getOfficerInitials(user.name)}
                            </div>
                            <div className="leading-tight">
                              <div className="font-medium text-slate-900">{user.name}</div>
                              <div className="text-xs text-slate-500">Active officer</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-1.5 text-sm text-slate-600">
                            <MapPin className="h-4 w-4 text-emerald-600" />
                            <span>{user.region || "N/A"}</span>
                          </div>
                        </td>
                        <td className="px-6 py-3 font-semibold text-emerald-600">
                          {user.farmersRegistered.toLocaleString()}
                        </td>
                        <td className="px-6 py-3 text-slate-600">{user.target.toLocaleString()}</td>
                        <td className="px-6 py-3">
                          <span className={`text-sm font-semibold ${getProgressTextClass(user.status)}`}>
                            {user.progressPercentage.toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(user.status)}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${getStatusDotClass(user.status)}`} />
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => openOfficerTargets(user)}
                            className="h-8 w-8 border-blue-200 p-0 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                            aria-label={`View quarterly targets for ${user.name}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {userProgressData.length === 0 && hasActiveDateFilters && stats.total === 0 && filteredData.length === 0 && (
                    <tr>
                      <td colSpan={7} className="bg-gray-50 py-8 text-center text-gray-500">
                        No farmer data available for the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isOfficerTargetsOpen} onOpenChange={setIsOfficerTargetsOpen}>
        <DialogContent className="max-w-3xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-gray-800">
              <Eye className="h-5 w-5 text-blue-600" />
              {selectedOfficerForYear ? `${selectedOfficerForYear.name} Quarterly Targets ${officerDialogYear}` : `Quarterly Targets (${officerDialogYear})`}
            </DialogTitle>

          </DialogHeader>

          {selectedOfficerForYear ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Target year</p>
                  <p className="mt-1 text-sm text-slate-600">Choose the year to view this officer's quarterly performance.</p>
                </div>
                <Select value={officerDialogYear} onValueChange={setOfficerDialogYear}>
                  <SelectTrigger className="h-9 w-full border-blue-200 bg-white text-sm sm:w-[170px]">
                    <SelectValue placeholder="Select Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableYears.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Analysis Year</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{officerDialogYear}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Registered</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {selectedOfficerForYear.farmersRegistered.toLocaleString()} farmers
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Target Result</p>
                  <p className={`mt-1 text-sm font-semibold ${getProgressTextClass(selectedOfficerForYear.status)}`}>
                    {getProgressStatusLabel(selectedOfficerForYear.status)}
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-blue-50">
                    <tr>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Period</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Farmers</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Target</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Progress</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOfficerPeriods.map((period) => {
                      const progressPercent = Math.min(period.progressPercentage, 100);
                      const isUpcoming = Boolean(period.upcoming);
                      return (
                        <tr key={period.key} className="border-b border-slate-100">
                          <td className="px-4 py-4 font-medium text-slate-900">{period.label}</td>
                          <td className="px-4 py-4 text-slate-700">{period.count.toLocaleString()}</td>
                          <td className="px-4 py-4 text-slate-700">{period.target.toLocaleString()}</td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="h-2 w-28 rounded-full bg-slate-100">
                                <div
                                className={`h-2 rounded-full transition-all duration-500 ${getProgressBarClass(period.status)}`}
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                              <span className="text-xs font-medium text-slate-600">
                                {period.progressPercentage.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`text-sm font-semibold ${getProgressTextClass(period.status)}`}>
                              {getProgressStatusLabel(period.status)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <DashboardInsights
        accessibleProgrammes={accessibleProgrammes}
        selectedProgramme={activeProgram}
        title="Progress Dashboard Insights"
        description="Dated insights shared from the performance dashboard overview."
      />
    </div>
  );
};

export default LivestockFarmersAnalytics;
