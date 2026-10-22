import { useState, useEffect, useCallback, useMemo, useRef, useTransition, useDeferredValue, ChangeEvent, memo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db, ref, set, update, remove, push, fetchCollectionByProgrammes, subscribeCollectionByProgrammes, type DatabaseRecord } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollableFilterBar } from "@/components/ScrollableFilterBar";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Download, Users, MapPin, Eye, Calendar, Scale, Phone,
  CreditCard, Edit, Trash2, ShieldCheck, Activity,
  ChevronRight, Upload
} from "lucide-react";
import { useSharedProgrammeSelection } from "@/hooks/use-shared-programme-selection";
import { useToast } from "@/hooks/use-toast";
import { canViewAllProgrammes, isAdmin } from "@/contexts/authhelper";
import {
  ALL_PROGRAMMES_VALUE, normalizeProgramme,
  resolveAccessibleProgrammes
} from "@/lib/programme-access";
import { sendBulkSms } from "@/lib/sms";

// --- Types ---

interface AgeDistribution {
  "1-4"?: number;
  "5-8"?: number;
  "8+": number;
}

interface GoatsData {
  female?: number;
  male?: number;
  total: number;
  idNumber?: string;
}

interface FarmerData {
  id: string;
  createdAt: number | string;
  farmerId: string;
  name: string;
  gender: string;
  idNumber?: string;
  phone: string;
  county: string;
  subcounty: string;
  ward?: string;
  location: string;
  cattle: string | number;
  goats: number | GoatsData;
  sheep: string | number;
  vaccinated: boolean;
  traceability: boolean;
  vaccines: string[];
  ageDistribution?: AgeDistribution;
  registrationDate: string;
  programme: string;
  username?: string;
  aggregationGroup?: string;
  bucksServed?: string;
  femaleBreeds?: string;
  maleBreeds?: string;
  dewormed?: boolean;
  dewormingDate?: string;
  vaccinationDate?: string;
  acres?: number;
  newBreedsMale?: string;
  newBreedsFemale?: string;
  tugNumberMale?: string;
  tugNumberFemale?: string;
  age?: number | string;
  animalManager?: string;
  householdRole?: string;
  incomeControl?: string;
  livestockInsurance?: string;
  livestockOwnership?: string;
  marketInformation?: string;
  offtakerNegotiator?: string;
  saleDecision?: string;
  trainingInterest?: string;
  registeringAs?: string;
  groupName?: string;
}

interface TrainingData {
  id: string;
  county?: string;
  subcounty?: string;
  location?: string;
  topicTrained?: string;
  totalFarmers?: number;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  rawTimestamp?: number;
  programme?: string;
  username?: string;
  fieldOfficer?: string;
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  county: string;
  subcounty: string;
  ward: string;
  gender: string;
  location: string;
  duplicateStatus: "unique" | "repeated" | "all";
  breedsStatus: "all" | "withBreeds" | "withoutBreeds";
}

interface Stats {
  totalFarmers: number;
  totalGoats: number;
  totalSheep: number;
  totalCattle: number;
  totalAcres: number;
  vaccinatedCount: number;
  maleFarmers: number;
  femaleFarmers: number;
  totalVisitedLocations: number;
}

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface EditForm {
  farmerId: string;
  name: string;
  gender: string;
  idNumber: string;
  phone: string;
  county: string;
  subcounty: string;
  location: string;
  cattle: number;
  goats: number;
  sheep: number;
  vaccinated: boolean;
  programme: string;
  bucksServed: string;
  maleBreeds: string;
  femaleBreeds: string;
  newBreedsMale: string;
  newBreedsFemale: string;
  tugNumberMale: string;
  tugNumberFemale: string;
}

const PAGE_LIMIT = 15;

// --- Utility Functions ---

const parseDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (date instanceof Date) return date;
    if (typeof date === "number") return new Date(date);
    if (typeof date === "string") {
      const trimmed = date.trim();
      const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoDateOnly) {
        const [, year, month, day] = isoDateOnly;
        const parsed = new Date(Number(year), Number(month) - 1, Number(day));
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      const slashDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slashDate) {
        const [, first, second, year] = slashDate;
        const firstNumber = Number(first);
        const secondNumber = Number(second);
        const parsed = firstNumber > 12
          ? new Date(Number(year), secondNumber - 1, firstNumber)
          : new Date(Number(year), firstNumber - 1, secondNumber);
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      const parsed = new Date(trimmed);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
  } catch (error) {
    console.error("Error parsing date:", error, date);
  }
  return null;
};

const formatDate = (date: any): string => {
  const parsedDate = parseDate(date);
  return parsedDate
    ? parsedDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "N/A";
};

const getFarmerTimestamp = (record: Partial<FarmerData> | null | undefined): number => {
  if (!record) return 0;
  const parsed = parseDate(record.createdAt) || parseDate(record.registrationDate);
  return parsed ? parsed.getTime() : 0;
};

const sortFarmersByLatest = (records: FarmerData[]): FarmerData[] =>
  [...records].sort((a, b) => {
    const timeDiff = getFarmerTimestamp(b) - getFarmerTimestamp(a);
    // Secondary sort by id for stability (prevents fluctuation when timestamps match)
    if (timeDiff !== 0) return timeDiff;
    return b.id.localeCompare(a.id);
  });

const formatDateForExcel = (date: any): string => {
  const parsedDate = parseDate(date);
  if (!parsedDate) return "";
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");
  const year = parsedDate.getFullYear();
  return `${month}/${day}/${year}`;
};

const escapeCsvCell = (value: unknown): string => {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
};

const getGoatTotal = (goats: any): number => {
  if (typeof goats === "number") return goats;
  if (typeof goats === "object" && goats !== null) {
    return typeof goats.total === "number" ? goats.total : 0;
  }
  return 0;
};

const getAcreTotal = (item: Record<string, any>): number => {
  const rawAcreValue =
    item.acres ??
    item.totalAcres ??
    item.totalAcresPasture ??
    item.landSize ??
    item.land_under_pasture ??
    item.landUnderPasture;
  if (typeof rawAcreValue === "number")
    return Number.isFinite(rawAcreValue) ? rawAcreValue : 0;
  if (typeof rawAcreValue === "string") {
    const parsed = Number(rawAcreValue.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

// --- Record Processors ---

const processFarmerRecord = (
  key: string,
  item: any,
  fallbackProgramme?: string
): FarmerData => {
  let dateValue = item.createdAt;
  if (typeof dateValue !== "number") {
    dateValue = parseDate(item.registrationDate)?.getTime() || Date.now();
  }

  return {
    id: key,
    createdAt: dateValue,
    farmerId: item.farmerId || "N/A",
    name: item.name || "",
    gender: item.gender || "",
    idNumber: item.idNumber || "",
    phone: item.phone || "",
    county: item.county || "",
    subcounty: item.subcounty || "",
    ward: item.ward || item.Ward || "",
    location: item.location || item.subcounty || "",
    cattle: item.cattle || "0",
    goats: item.goats || 0,
    sheep: item.sheep || "0",
    vaccinated: !!item.vaccinated,
    traceability: !!item.traceability,
    vaccines: Array.isArray(item.vaccines) ? item.vaccines : [],
    ageDistribution: item.ageDistribution || {},
    registrationDate: item.registrationDate || formatDate(dateValue),
    programme:
      normalizeProgramme(item.programme ?? item.Programme) ||
      fallbackProgramme ||
      "",
    username: item.username || "Unknown",
    aggregationGroup: item.aggregationGroup || "",
    bucksServed: item.bucksServed || "0",
    femaleBreeds: item.femaleBreeds || "0",
    maleBreeds: item.maleBreeds || "0",
    dewormed: !!item.dewormed,
    dewormingDate: item.dewormingDate || null,
    vaccinationDate: item.vaccinationDate || null,
    acres: getAcreTotal(item),
    newBreedsMale: item.newBreedsMale || "0",
    newBreedsFemale: item.newBreedsFemale || "0",
    tugNumberMale: item.tugNumberMale || item.tagNumberMale || item.maleTagNumber || "",
    tugNumberFemale: item.tugNumberFemale || item.tagNumberFemale || item.femaleTagNumber || "",
    age: item.age ?? "",
    animalManager: item.animalManager || "",
    householdRole: item.householdRole || "",
    incomeControl: item.incomeControl || "",
    livestockInsurance: item.livestockInsurance || "",
    livestockOwnership: item.livestockOwnership || "",
    marketInformation: item.marketInformation || "",
    offtakerNegotiator: item.offtakerNegotiator || "",
    saleDecision: item.saleDecision || "",
    trainingInterest: item.trainingInterest || "",
    registeringAs: item.registeringAs || "",
    groupName: item.groupName || "",
  };
};

// =============================================================================
// DEDUPLICATION HELPERS
// =============================================================================

const normalizeDuplicateToken = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const isUsableIdentityValue = (value: unknown): boolean => {
  const normalized = normalizeDuplicateToken(value);
  return (
    Boolean(normalized) &&
    !["n/a", "na", "/a", "0", "0.0", "null", "undefined", ""].includes(normalized)
  );
};

const buildProfileKey = (record: FarmerData): string =>
  [
    "profile",
    normalizeDuplicateToken(record.name),
    normalizeDuplicateToken(record.county),
    normalizeDuplicateToken(record.subcounty),
    normalizeDuplicateToken(record.location),
    normalizeDuplicateToken(record.programme),
  ].join(":");

const getFarmerDuplicateKey = (record: FarmerData): string => {
  if (isUsableIdentityValue(record.idNumber)) {
    return `id:${normalizeDuplicateToken(record.idNumber)}`;
  }
  return buildProfileKey(record);
};

const dedupeFarmers = (records: FarmerData[]): FarmerData[] => {
  const uniqueRecords = new Map<string, FarmerData>();
  sortFarmersByLatest(records).forEach((record) => {
    const key = getFarmerDuplicateKey(record);
    if (!uniqueRecords.has(key)) {
      uniqueRecords.set(key, record);
    }
  });
  return sortFarmersByLatest(Array.from(uniqueRecords.values()));
};

const getDuplicateKeyCounts = (records: FarmerData[]): Map<string, number> => {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    const key = getFarmerDuplicateKey(record);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
};

// A farmer "has breeding data" if any breeding-related numeric field is
// greater than zero, or either tag number field holds a usable value.
const hasBreedingData = (record: FarmerData): boolean => {
  const numericFields = [
    record.bucksServed,
    record.maleBreeds,
    record.femaleBreeds,
    record.newBreedsMale,
    record.newBreedsFemale,
  ];
  const hasNumeric = numericFields.some((val) => {
    const num = Number(val);
    return Number.isFinite(num) && num > 0;
  });
  const hasTagNumber =
    isUsableIdentityValue(record.tugNumberMale) || isUsableIdentityValue(record.tugNumberFemale);
  return hasNumeric || hasTagNumber;
};

const processTrainingRecord = (
  key: string,
  item: any,
  fallbackProgramme?: string
): TrainingData => ({
  id: key,
  ...item,
  programme:
    normalizeProgramme(item?.programme ?? item?.Programme) ||
    fallbackProgramme ||
    "",
});

// --- Utility Functions ---

const formatLocalDateForInput = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getCurrentMonthRange = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: formatLocalDateForInput(startOfMonth),
    endDate: formatLocalDateForInput(endOfMonth),
  };
};

const matchesDateRange = (
  rawDate: any,
  startDateStr: string,
  endDateStr: string,
): boolean => {
  if (!startDateStr && !endDateStr) return true;

  const recordDate = parseDate(rawDate);
  if (!recordDate) return !startDateStr && !endDateStr;

  const recordDateOnly = new Date(recordDate);
  recordDateOnly.setHours(0, 0, 0, 0);

  if (startDateStr) {
    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    if (recordDateOnly < startDate) return false;
  }

  if (endDateStr) {
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);
    if (recordDateOnly > endDate) return false;
  }

  return true;
};

// subscribeWithCache was removed â€” all collections now use realtime
// subscribeCollectionByProgrammes() subscriptions for live updates.

// =============================================================================
// FILTERING + DEDUPLICATION
// =============================================================================

const applyFiltersAndDedupe = (
  allFarmers: FarmerData[],
  trainingRecords: TrainingData[],
  filters: Filters,
): { filtered: FarmerData[]; filteredTraining: TrainingData[] } => {
  const filteredFarmersList = allFarmers.filter((record) => {
    if (!matchesDateRange(record.createdAt, filters.startDate, filters.endDate)) return false;
    if (filters.county !== "all" && record.county?.toLowerCase() !== filters.county.toLowerCase()) return false;
    if (filters.subcounty !== "all" && record.subcounty?.toLowerCase() !== filters.subcounty.toLowerCase()) return false;
    if (filters.ward !== "all" && record.ward?.toLowerCase() !== filters.ward.toLowerCase()) return false;
    if (filters.location !== "all" && record.location?.toLowerCase() !== filters.location.toLowerCase()) return false;
    if (filters.gender !== "all" && record.gender?.toLowerCase() !== filters.gender.toLowerCase()) return false;
    if (filters.breedsStatus === "withBreeds" && !hasBreedingData(record)) return false;
    if (filters.breedsStatus === "withoutBreeds" && hasBreedingData(record)) return false;
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      const searchMatch = [
        record.name, record.farmerId, record.location,
        record.county, record.idNumber, record.phone, record.username,
      ].some((field) => field?.toLowerCase().includes(searchTerm));
      if (!searchMatch) return false;
    }
    return true;
  });

  const duplicateKeyCounts = getDuplicateKeyCounts(filteredFarmersList);
  const sortedFilteredFarmers =
    filters.duplicateStatus === "repeated"
      ? sortFarmersByLatest(
          filteredFarmersList.filter(
            (record) => (duplicateKeyCounts.get(getFarmerDuplicateKey(record)) || 0) > 1
          )
        )
      : filters.duplicateStatus === "all"
        ? sortFarmersByLatest(filteredFarmersList)
        : dedupeFarmers(filteredFarmersList);

  const filteredTraining = trainingRecords.filter((record) =>
    matchesDateRange(record.startDate || record.createdAt || record.rawTimestamp, filters.startDate, filters.endDate)
  );

  return { filtered: sortedFilteredFarmers, filteredTraining };
};

const computeStats = (
  filteredFarmers: FarmerData[],
  filteredTraining: TrainingData[],
): Stats => {
  const totalFarmers = filteredFarmers.length;
  const totalGoats = filteredFarmers.reduce((sum, f) => sum + getGoatTotal(f.goats), 0);
  const totalSheep = filteredFarmers.reduce((sum, f) => sum + (Number(f.sheep) || 0), 0);
  const totalCattle = filteredFarmers.reduce((sum, f) => sum + (Number(f.cattle) || 0), 0);
  const totalAcres = filteredFarmers.reduce((sum, f) => sum + (Number(f.acres) || 0), 0);
  const vaccinatedCount = filteredFarmers.filter((f) => f.vaccinated).length;
  const maleFarmers = filteredFarmers.filter((f) => f.gender?.toLowerCase() === "male").length;
  const femaleFarmers = filteredFarmers.filter((f) => f.gender?.toLowerCase() === "female").length;
  const totalVisitedLocations = new Set(
    filteredFarmers
      .map((f) => f.location?.trim().toLowerCase())
      .filter((loc): loc is string => Boolean(loc))
  ).size;

  return {
    totalFarmers, totalGoats, totalSheep, totalCattle, totalAcres,
    vaccinatedCount, maleFarmers, femaleFarmers, totalVisitedLocations,
  };
};

// --- CSV helpers ---

const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
};

const FARMER_REGISTRATION_SMS =
  "You have been registered successfully with Genco Livestock. Thank you.";

// --- Component ---

const LivestockFarmersPage = () => {
  const { user, userRole, userAttribute, userName, allowedProgrammes } = useAuth();
  const { toast } = useToast();

  // =========================================================================
  // State
  // =========================================================================

  const [allFarmers, setAllFarmers] = useState<FarmerData[]>([]);
  const [trainingRecords, setTrainingRecords] = useState<TrainingData[]>([]);
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isBulkSmsDialogOpen, setIsBulkSmsDialogOpen] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSingleDeleteDialogOpen, setIsSingleDeleteDialogOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<FarmerData | null>(null);
  const [editingRecord, setEditingRecord] = useState<FarmerData | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<FarmerData | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [bulkSmsMessage, setBulkSmsMessage] = useState("");
  const [bulkSmsSending, setBulkSmsSending] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentMonthRange = useMemo(() => getCurrentMonthRange(), []);

  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: currentMonthRange.startDate,
    endDate: currentMonthRange.endDate,
    county: "all",
    subcounty: "all",
    ward: "all",
    gender: "all",
    location: "all",
    duplicateStatus: "all",
    breedsStatus: "all",
  });

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });

  const [editForm, setEditForm] = useState<EditForm>({
    farmerId: "", name: "", gender: "", idNumber: "", phone: "",
    county: "", subcounty: "", location: "", cattle: 0, goats: 0, sheep: 0,
    vaccinated: false, programme: "",
    bucksServed: "", maleBreeds: "", femaleBreeds: "",
    newBreedsMale: "", newBreedsFemale: "",
    tugNumberMale: "", tugNumberFemale: "",
  });

  const [isPending, startTransition] = useTransition();

  const userIsAdmin = useMemo(() => isAdmin(userRole), [userRole]);
  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute, allowedProgrammes),
    [allowedProgrammes, userRole, userAttribute]
  );
  const accessibleProgrammes = useMemo(
    () => resolveAccessibleProgrammes(userCanViewAllProgrammeData, allowedProgrammes),
    [allowedProgrammes, userCanViewAllProgrammeData]
  );
  const [activeProgram, setActiveProgram] = useSharedProgrammeSelection(accessibleProgrammes, {
    allowAll: true,
    fallbackToAll: true,
  });

  const requireAdmin = () => {
    if (userIsAdmin) return true;
    toast({
      title: "Access denied",
      description: "Only Admin can create, edit, or delete records on this page.",
      variant: "destructive",
    });
    return false;
  };

  useEffect(() => {
    setAvailablePrograms(accessibleProgrammes);
  }, [accessibleProgrammes]);

  const deferredSearch = useDeferredValue(filters.search);

  // =========================================================================
  // Farmers â€” realtime subscription
  // =========================================================================
  useEffect(() => {
    let cancelled = false;

    if (!activeProgram) {
      setAllFarmers([]);
      setLoading(false);
      return;
    }

    const programmeValues =
      activeProgram === ALL_PROGRAMMES_VALUE
        ? accessibleProgrammes
        : [normalizeProgramme(activeProgram)];

    if (programmeValues.length === 0 || programmeValues.every((p) => !normalizeProgramme(p))) {
      setAllFarmers([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    fetchCollectionByProgrammes<Record<string, any>>("farmers", programmeValues, {
      noDateFilter: true,
      ttlMs: 5 * 60 * 1000,
    })
      .then((records) => {
        if (cancelled) return;
        const programmeSet = new Set(programmeValues.map((p) => normalizeProgramme(p)).filter(Boolean));
        const farmers = records
          .filter((record) => programmeSet.has(normalizeProgramme(record.programme ?? record.Programme)))
          .map((record) => processFarmerRecord(record.id, record));
        setAllFarmers(sortFarmersByLatest(farmers));
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error subscribing to livestock farmers:", error);
        toast({
          title: "Error",
          description: "Failed to load livestock farmers.",
          variant: "destructive",
        });
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [accessibleProgrammes, activeProgram, toast]);

  // =========================================================================
  // Training records â€” realtime subscription
  // =========================================================================
  useEffect(() => {
    if (!activeProgram) {
      setTrainingRecords([]);
      return;
    }

    const programmeValues =
      activeProgram === ALL_PROGRAMMES_VALUE
        ? accessibleProgrammes
        : [normalizeProgramme(activeProgram)];

    if (programmeValues.length === 0 || programmeValues.every((p) => !normalizeProgramme(p))) {
      setTrainingRecords([]);
      return;
    }

    const unsubscribe = subscribeCollectionByProgrammes<Record<string, any>>(
      "training",
      programmeValues,
      (data) => {
        const records = Object.values(data) as any[];
        const training = records.map((r) => processTrainingRecord(r.id, r));
        setTrainingRecords(training);
      },
      (error) => {
        console.error("Error subscribing to training records:", error);
      },
    );

    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [accessibleProgrammes, activeProgram]);

  // =========================================================================
  // Filtering + deduplication
  // =========================================================================

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch }),
    [filters, deferredSearch]
  );

  const { filtered: filteredFarmers, filteredTraining } = useMemo(
    () => applyFiltersAndDedupe(allFarmers, trainingRecords, effectiveFilters),
    [allFarmers, trainingRecords, effectiveFilters]
  );

  const stats = useMemo(
    () => computeStats(filteredFarmers, filteredTraining),
    [filteredFarmers, filteredTraining]
  );

  // =========================================================================
  // Pagination
  // =========================================================================

  const totalPages = useMemo(
    () => Math.ceil(filteredFarmers.length / PAGE_LIMIT),
    [filteredFarmers.length]
  );

  useEffect(() => {
    const currentPage = Math.min(pagination.page, Math.max(1, totalPages));
    setPagination((prev) => ({
      ...prev,
      page: currentPage,
      totalPages,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
    }));
  }, [totalPages, pagination.page]);

  const currentPageRecords = useMemo(() => {
    const startIndex = (pagination.page - 1) * pagination.limit;
    return filteredFarmers.slice(startIndex, startIndex + pagination.limit);
  }, [filteredFarmers, pagination.page, pagination.limit]);

  const removeFarmersFromState = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const deletedIds = new Set(ids);
    setAllFarmers((prev) => prev.filter((record) => !deletedIds.has(record.id)));
    setSelectedRecords((prev) => prev.filter((id) => !deletedIds.has(id)));
  }, []);

  // â”€â”€ Cascading location filter options â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Counties are always drawn from the full dataset. Subcounties are scoped
  // to farmers within the selected county (or all farmers when county is
  // "all"). Wards are further scoped to the selected county AND subcounty,
  // and locations are scoped to county + subcounty + ward, so each dropdown
  // only ever shows options that actually exist beneath the level above it.
  const uniqueCounties = useMemo(
    () => [...new Set(allFarmers.map((f) => f.county).filter(Boolean))],
    [allFarmers]
  );

  const uniqueSubcounties = useMemo(() => {
    const scoped = filters.county === "all"
      ? allFarmers
      : allFarmers.filter((f) => f.county?.toLowerCase() === filters.county.toLowerCase());
    return [...new Set(scoped.map((f) => f.subcounty).filter(Boolean))];
  }, [allFarmers, filters.county]);

  const uniqueWards = useMemo(() => {
    let scoped = allFarmers;
    if (filters.county !== "all") {
      scoped = scoped.filter((f) => f.county?.toLowerCase() === filters.county.toLowerCase());
    }
    if (filters.subcounty !== "all") {
      scoped = scoped.filter((f) => f.subcounty?.toLowerCase() === filters.subcounty.toLowerCase());
    }
    return [...new Set(scoped.map((f) => f.ward).filter(Boolean))];
  }, [allFarmers, filters.county, filters.subcounty]);

  const uniqueLocations = useMemo(() => {
    let scoped = allFarmers;
    if (filters.county !== "all") {
      scoped = scoped.filter((f) => f.county?.toLowerCase() === filters.county.toLowerCase());
    }
    if (filters.subcounty !== "all") {
      scoped = scoped.filter((f) => f.subcounty?.toLowerCase() === filters.subcounty.toLowerCase());
    }
    if (filters.ward !== "all") {
      scoped = scoped.filter((f) => f.ward?.toLowerCase() === filters.ward.toLowerCase());
    }
    return [...new Set(scoped.map((f) => f.location).filter(Boolean))];
  }, [allFarmers, filters.county, filters.subcounty, filters.ward]);

  const uniqueGenders = useMemo(
    () => [...new Set(allFarmers.map((f) => f.gender).filter(Boolean))],
    [allFarmers]
  );

  // =========================================================================
  // Handlers
  // =========================================================================

  const handleProgramChange = (program: string) => {
    setActiveProgram(program);
    setFilters({
      search: "", startDate: currentMonthRange.startDate, endDate: currentMonthRange.endDate,
      county: "all", subcounty: "all", ward: "all", gender: "all",
      location: "all", duplicateStatus: "all", breedsStatus: "all",
    });
    setSelectedRecords([]);
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleSearchChange = useCallback((value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      startTransition(() => {
        setFilters((prev) => ({ ...prev, search: value }));
        setPagination((prev) => ({ ...prev, page: 1 }));
      });
    }, 300);
  }, []);

  // Changing county resets subcounty + ward + location (they cascade from
  // it); changing subcounty resets ward + location; changing ward resets
  // location. Every other filter behaves as before.
  const handleFilterChange = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    startTransition(() => {
      setFilters((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "county") {
          next.subcounty = "all";
          next.ward = "all";
          next.location = "all";
        } else if (key === "subcounty") {
          next.ward = "all";
          next.location = "all";
        } else if (key === "ward") {
          next.location = "all";
        }
        return next;
      });
      setPagination((prev) => ({ ...prev, page: 1 }));
    });
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPagination((prev) => {
      const validatedPage = Math.max(1, Math.min(newPage, totalPages));
      return {
        ...prev,
        page: validatedPage,
        hasNext: validatedPage < totalPages,
        hasPrev: validatedPage > 1,
      };
    });
  }, [totalPages]);

  const handleSelectRecord = useCallback((recordId: string) => {
    setSelectedRecords((prev) =>
      prev.includes(recordId) ? prev.filter((id) => id !== recordId) : [...prev, recordId]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    const pageIds = currentPageRecords.map((f) => f.id);
    setSelectedRecords((prev) =>
      prev.length === pageIds.length ? [] : pageIds
    );
  }, [currentPageRecords]);

  const openViewDialog = useCallback((record: FarmerData) => {
    setViewingRecord(record);
    setIsViewDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((record: FarmerData) => {
    if (!userIsAdmin) return;
    setEditingRecord(record);
    const cattleVal = typeof record.cattle === "number" ? record.cattle : parseInt(record.cattle as string) || 0;
    const sheepVal = typeof record.sheep === "number" ? record.sheep : parseInt(record.sheep as string) || 0;
    const goatsVal = getGoatTotal(record.goats);

    setEditForm({
      farmerId: record.farmerId, name: record.name, gender: record.gender,
      idNumber: record.idNumber || "", phone: record.phone,
      county: record.county, subcounty: record.subcounty, location: record.location,
      cattle: cattleVal, goats: goatsVal, sheep: sheepVal,
      vaccinated: record.vaccinated, programme: record.programme,
      bucksServed: (record.bucksServed ?? "").toString(),
      maleBreeds: (record.maleBreeds ?? "").toString(),
      femaleBreeds: (record.femaleBreeds ?? "").toString(),
      newBreedsMale: (record.newBreedsMale ?? "").toString(),
      newBreedsFemale: (record.newBreedsFemale ?? "").toString(),
      tugNumberMale: (record.tugNumberMale ?? "").toString(),
      tugNumberFemale: (record.tugNumberFemale ?? "").toString(),
    });
    setIsEditDialogOpen(true);
  }, [userIsAdmin]);

  const openSingleDeleteConfirm = useCallback((record: FarmerData) => {
    if (!userIsAdmin) return;
    setRecordToDelete(record);
    setIsSingleDeleteDialogOpen(true);
  }, [userIsAdmin]);

  const openBulkDeleteConfirm = useCallback(() => {
    if (!userIsAdmin) return;
    setIsDeleteConfirmOpen(true);
  }, [userIsAdmin]);

  const handleEditSubmit = async () => {
    if (!requireAdmin()) return;
    if (!editingRecord) return;
    try {
      await update(ref(db, `farmers/${editingRecord.id}`), {
        farmerId: editForm.farmerId, name: editForm.name, gender: editForm.gender,
        idNumber: editForm.idNumber, phone: editForm.phone,
        county: editForm.county, subcounty: editForm.subcounty, location: editForm.location,
        cattle: Number(editForm.cattle), goats: Number(editForm.goats), sheep: Number(editForm.sheep),
        vaccinated: editForm.vaccinated, programme: editForm.programme,
        bucksServed: editForm.bucksServed, maleBreeds: editForm.maleBreeds,
        femaleBreeds: editForm.femaleBreeds,
        newBreedsMale: editForm.newBreedsMale, newBreedsFemale: editForm.newBreedsFemale,
        tugNumberMale: editForm.tugNumberMale, tugNumberFemale: editForm.tugNumberFemale,
      });
      toast({ title: "Success", description: "Farmer record updated" });
      setIsEditDialogOpen(false);
      setEditingRecord(null);
    } catch (error) {
      toast({ title: "Error", description: "Update failed", variant: "destructive" });
    }
  };

  const handleSingleDelete = async () => {
    if (!requireAdmin()) return;
    if (!recordToDelete) return;
    try {
      setDeleteLoading(true);
      await remove(ref(db, `farmers/${recordToDelete.id}`));
      // Bust cache so next mount picks up the deletion
      removeFarmersFromState([recordToDelete.id]);
      toast({ title: "Success", description: "Record deleted" });
      setIsSingleDeleteDialogOpen(false);
      setRecordToDelete(null);
    } catch (error) {
      toast({ title: "Error", description: "Deletion failed", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  };

  // FIX #1 (line 1081): `update(ref(db, "/"), updates)` â€” ref() needs a path
  const handleDeleteMultiple = async () => {
    if (!requireAdmin()) return;
    if (selectedRecords.length === 0) return;
    try {
      setDeleteLoading(true);
      const idsToDelete = [...selectedRecords];
      await Promise.all(idsToDelete.map((id) => remove(ref(db, `farmers/${id}`))));
      removeFarmersFromState(idsToDelete);
      toast({ title: "Success", description: `${idsToDelete.length} records deleted` });
      setIsDeleteConfirmOpen(false);
    } catch (error) {
      toast({ title: "Error", description: "Bulk delete failed", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  };

  const openBulkSmsDialog = () => {
    if (selectedRecords.length === 0) {
      toast({ title: "No Records Selected", description: "Select farmers to send bulk SMS.", variant: "destructive" });
      return;
    }
    setIsBulkSmsDialogOpen(true);
  };

  // FIX #2: push() in this project's firebase wrapper resolves asynchronously
  // with a generated key (Promise<{ key: string }>) rather than returning a
  // ref synchronously. It must be awaited, and the key used to build a
  // concrete ref before calling set() on it.
  const handleSendBulkSms = async () => {
    const message = bulkSmsMessage.trim();
    if (!message) {
      toast({ title: "Message Required", description: "Enter the SMS message to send.", variant: "destructive" });
      return;
    }

    const selectedSet = new Set(selectedRecords);
    const recipients = allFarmers
      .filter((record) => selectedSet.has(record.id))
      .map((record) => String(record.phone || "").trim())
      .filter((phone) => phone.length > 0);
    const uniqueRecipients = Array.from(new Set(recipients));

    if (uniqueRecipients.length === 0) {
      toast({ title: "No Phone Numbers", description: "Selected farmers have no valid phone numbers.", variant: "destructive" });
      return;
    }

    setBulkSmsSending(true);
    try {
      const result = await sendBulkSms(uniqueRecipients, message);
      toast({
        title: result.failureCount > 0 ? "SMS Partially Sent" : "SMS Sent",
        description: `Sent ${result.successCount} SMS${result.successCount === 1 ? "" : "es"}${result.failureCount ? `, ${result.failureCount} failed.` : "."}`,
        variant: result.successCount === 0 ? "destructive" : "default",
      });
      setBulkSmsMessage("");
      setIsBulkSmsDialogOpen(false);
    } catch (error) {
      console.error("Failed to send bulk SMS:", error);
      toast({ title: "SMS Failed", description: "Failed to send bulk SMS.", variant: "destructive" });
    } finally {
      setBulkSmsSending(false);
    }
  };

  const [uploadPreview, setUploadPreview] = useState<{ name: string; rows: number }[]>([]);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadFile(files[0]);
    setUploadPreview([]);
    setUploadProgress({ current: 0, total: 0 });

    // Quick preview: count rows for each file
    files.forEach(async (file) => {
      try {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        const dataRows = Math.max(0, lines.length - 1); // minus header
        setUploadPreview((prev) => [...prev, { name: file.name, rows: dataRows }]);
      } catch {
        setUploadPreview((prev) => [...prev, { name: file.name, rows: 0 }]);
      }
    });
  };

  // FIX #3: same push()/set() pattern as FIX #2 â€” await push() to resolve the
  // generated key, then build the ref from that key before calling set().
  const handleUpload = async () => {
    if (!requireAdmin()) return;
    if (!uploadFile) return;
    if (activeProgram === ALL_PROGRAMMES_VALUE) {
      toast({
        title: "Select a programme",
        description: "Choose KPMD, RANGE, or KPMD 2 before uploading farmer records.",
        variant: "destructive",
      });
      return;
    }
    setUploadLoading(true);
    setUploadProgress({ current: 0, total: 0 });
    try {
      const text = await uploadFile.text();
      const isJSON = uploadFile.name.endsWith(".json");
      let parsedData: any[] = [];

      if (isJSON) {
        const jsonData = JSON.parse(text);
        parsedData = Array.isArray(jsonData) ? jsonData : Object.values(jsonData);
        parsedData = parsedData.map((item) => {
          if (!item || typeof item !== "object") return item;
          const dateValue = item.createdAt ?? item.registrationDate ?? item.registration_date ?? item.registeredAt ?? item.date;
          const parsedDate = parseDate(dateValue);
          return {
            ...item,
            registrationDate: item.registrationDate || item.registration_date || item.registeredAt || item.date || "",
            createdAt: parsedDate ? parsedDate.getTime() : item.createdAt,
            // Normalize alternate tag-number key spellings so breeding data
            // saved under different JSON field names still lands correctly.
            tugNumberMale: item.tugNumberMale ?? item.tagNumberMale ?? item.maleTagNumber ?? "",
            tugNumberFemale: item.tugNumberFemale ?? item.tagNumberFemale ?? item.femaleTagNumber ?? "",
            bucksServed: item.bucksServed ?? "",
            maleBreeds: item.maleBreeds ?? "",
            femaleBreeds: item.femaleBreeds ?? "",
            newBreedsMale: item.newBreedsMale ?? "",
            newBreedsFemale: item.newBreedsFemale ?? "",
          };
        });
      } else {
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) throw new Error("CSV file is empty or has no data rows");

        const rawHeaders = parseCSVLine(lines[0]);
        const headers = rawHeaders.map((h) =>
          h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\(.*?\)/g, "")
            .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ")
        );

        const findIndex = (keys: string[]) =>
          headers.findIndex((h) => keys.some((k) => h.includes(k)));

        // Matches a header only if it contains ALL of `include` and NONE of
        // `exclude` â€” used for breeding fields whose plain-language column
        // names ("Male Breeds", "New Breeds Male", "Tag Number Male") would
        // otherwise collide with each other under simple substring matching.
        const findIndexAllExcluding = (include: string[], exclude: string[] = []) =>
          headers.findIndex(
            (h) => include.every((k) => h.includes(k)) && !exclude.some((k) => h.includes(k))
          );

        const idxName = findIndex(["farmer name", "name"]);
        const idxGender = findIndex(["gender"]);
        const idxCounty = findIndex(["county"]);
        const idxSub = findIndex(["subcounty", "sub county"]);
        const idxLoc = findIndex(["location"]);
        const idxCattle = findIndex(["cattle"]);
        const idxSheep = findIndex(["sheep"]);
        const idxIdNumber = findIndex(["id number", "idnumber"]);
        const idxPhone = findIndex(["phone"]);
        const idxFarmerId = findIndex(["farmer id"]);
        const idxRegDate = findIndex(["registration date", "reg date", "date"]);
        const idxVaccinated = findIndex(["vaccinated"]);
        const idxTrace = findIndex(["traceability"]);
        const idxVaccines = findIndex(["vaccine"]);
        const idxDewormed = findIndex(["dewormed"]);
        const idxDewormingDate = findIndex(["deworming date", "deworm date"]);
        const idxAggregationGroup = findIndex(["aggregation group", "group"]);
        const idxVaccinationDate = findIndex(["vaccination date", "vaccine date", "vax date"]);
        const idxFieldOfficer = findIndex(["field officer", "officer", "officer name", "created by", "username"]);

        // --- Breeding columns ---
        const idxBucksServed = findIndex(["bucks served", "bucksserved", "bucks"]);
        const idxNewBreedsMale = findIndexAllExcluding(["new", "male", "breed"]);
        const idxNewBreedsFemale = findIndexAllExcluding(["new", "female", "breed"]);
        const idxMaleBreeds = findIndexAllExcluding(["male", "breed"], ["new", "female"]);
        const idxFemaleBreeds = findIndexAllExcluding(["female", "breed"], ["new", "male"]);
        const idxTagNumberMale = findIndexAllExcluding(["tag", "male"], ["female"]);
        const idxTagNumberFemale = findIndexAllExcluding(["tag", "female"], ["male"]);

        const idxGoatsTotal = findIndex([
          "goats", "goats total", "total goats", "no of goats",
          "number of goats", "goats number", "goat count", "total goat",
        ]);
        const idxGoatsMale = findIndex([
          "male", "male goats", "male goat", "goat male", "goats m", "m goats", "goatsmale",
        ]);
        const idxGoatsFemale = findIndex([
          "female", "female goats", "female goat", "goat female", "goats f", "f goats", "goatsfemale",
        ]);

        const parseBool = (val: string) => {
          const v = (val || "").toLowerCase().trim();
          return v === "yes" || v === "true" || v === "1";
        };
        const valAt = (values: string[], idx: number) =>
          idx >= 0 && idx < values.length ? values[idx] : "";

        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          if (!values.some((v) => v.trim() !== "")) continue;

          const obj: any = {};
          if (idxName !== -1) obj.name = valAt(values, idxName).trim();
          if (idxGender !== -1) obj.gender = valAt(values, idxGender).trim();
          if (idxCounty !== -1) obj.county = valAt(values, idxCounty).trim();
          if (idxSub !== -1) obj.subcounty = valAt(values, idxSub).trim();
          if (idxLoc !== -1) obj.location = valAt(values, idxLoc).trim();
          if (idxCattle !== -1) obj.cattle = Number(valAt(values, idxCattle)) || 0;
          if (idxSheep !== -1) obj.sheep = Number(valAt(values, idxSheep)) || 0;
          if (idxIdNumber !== -1) obj.idNumber = valAt(values, idxIdNumber).trim();
          if (idxPhone !== -1) obj.phone = valAt(values, idxPhone).trim();
          if (idxFarmerId !== -1) obj.farmerId = valAt(values, idxFarmerId).trim();

          let createdAtTimestamp = Date.now();
          if (idxRegDate !== -1) {
            const regDateStr = valAt(values, idxRegDate).trim();
            obj.registrationDate = regDateStr;
            const dateObj = new Date(regDateStr);
            if (!isNaN(dateObj.getTime())) createdAtTimestamp = dateObj.getTime();
          }
          obj.createdAt = createdAtTimestamp;

          if (idxVaccinated !== -1) obj.vaccinated = parseBool(valAt(values, idxVaccinated));
          if (idxTrace !== -1) obj.traceability = parseBool(valAt(values, idxTrace));
          if (idxVaccines !== -1) {
            const raw = valAt(values, idxVaccines).trim();
            obj.vaccines = raw ? raw.split(";").map((s) => s.trim()).filter((s) => s) : [];
          }
          if (idxDewormed !== -1) obj.dewormed = parseBool(valAt(values, idxDewormed));
          if (idxDewormingDate !== -1) obj.dewormingDate = valAt(values, idxDewormingDate).trim();
          if (idxAggregationGroup !== -1) obj.aggregationGroup = valAt(values, idxAggregationGroup).trim();
          if (idxVaccinationDate !== -1) obj.vaccinationDate = valAt(values, idxVaccinationDate).trim();
          if (idxFieldOfficer !== -1) obj.username = valAt(values, idxFieldOfficer).trim();

          // --- Breeding fields: parsed from the CSV and written onto the
          // upload object so they actually reach the database. Previously
          // these columns were never read, so bucksServed / maleBreeds /
          // femaleBreeds / newBreedsMale / newBreedsFemale / tugNumberMale /
          // tugNumberFemale were always saved as their processFarmerRecord
          // defaults ("0" / "") regardless of what was in the file.
          if (idxBucksServed !== -1) obj.bucksServed = valAt(values, idxBucksServed).trim();
          if (idxMaleBreeds !== -1) obj.maleBreeds = valAt(values, idxMaleBreeds).trim();
          if (idxFemaleBreeds !== -1) obj.femaleBreeds = valAt(values, idxFemaleBreeds).trim();
          if (idxNewBreedsMale !== -1) obj.newBreedsMale = valAt(values, idxNewBreedsMale).trim();
          if (idxNewBreedsFemale !== -1) obj.newBreedsFemale = valAt(values, idxNewBreedsFemale).trim();
          if (idxTagNumberMale !== -1) obj.tugNumberMale = valAt(values, idxTagNumberMale).trim();
          if (idxTagNumberFemale !== -1) obj.tugNumberFemale = valAt(values, idxTagNumberFemale).trim();

          const foundGoatsMale = idxGoatsMale > -1;
          const foundGoatsFemale = idxGoatsFemale > -1;
          const foundGoatsTotal = idxGoatsTotal > -1;

          if (foundGoatsMale || foundGoatsFemale) {
            const maleCount = foundGoatsMale ? Number(valAt(values, idxGoatsMale)) || 0 : 0;
            const femaleCount = foundGoatsFemale ? Number(valAt(values, idxGoatsFemale)) || 0 : 0;
            const totalGoats = foundGoatsTotal ? Number(valAt(values, idxGoatsTotal)) || 0 : maleCount + femaleCount;
            obj.goats = { male: maleCount, female: femaleCount, total: totalGoats };
          } else if (foundGoatsTotal) {
            obj.goats = { total: Number(valAt(values, idxGoatsTotal)) || 0, male: 0, female: 0 };
          }
          parsedData.push(obj);
        }
      }

      let count = 0;
      const registrationSmsRecipients = new Set<string>();
      const collectionRef = ref(db, "farmers");
      const totalToUpload = parsedData.length;
      setUploadProgress({ current: 0, total: totalToUpload });

      for (let i = 0; i < parsedData.length; i++) {
        const item = parsedData[i];
        const phone = String(item.phone || item.phoneNumber || item.phoneNo || "").trim();
        await push(collectionRef, {
          ...item,
          programme: activeProgram,
          username: item.username || "Unknown",
        });
        if (phone) registrationSmsRecipients.add(phone);
        count++;
        // Update progress every 10 records to avoid excessive re-renders
        if (count % 10 === 0 || count === totalToUpload) {
          setUploadProgress({ current: count, total: totalToUpload });
        }
      }

      let sentSmsCount = 0;
      if (registrationSmsRecipients.size > 0) {
        try {
          const recipients = Array.from(registrationSmsRecipients);
          const result = await sendBulkSms(recipients, FARMER_REGISTRATION_SMS);
          sentSmsCount = result.successCount;
          if (result.failureCount > 0) {
            toast({
              title: "SMS Partially Sent",
              description: `${result.successCount} registration SMS sent, ${result.failureCount} failed.`,
              variant: result.successCount === 0 ? "destructive" : "default",
            });
          }
        } catch (smsError) {
          console.error("Failed to send farmer registration SMS:", smsError);
          toast({
            title: "SMS Failed",
            description: "Farmers were uploaded, but registration SMS was not sent.",
            variant: "destructive",
          });
        }
      }

      // Bust cache so the next subscription picks up the newly uploaded records

      toast({
        title: "Success",
        description: `Uploaded ${count} records to ${activeProgram}.${sentSmsCount ? ` SMS sent to ${sentSmsCount} farmers.` : ""}`,
      });
      setIsUploadDialogOpen(false);
      setUploadFile(null);
      setUploadPreview([]);
      setUploadProgress({ current: 0, total: 0 });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Upload failed. Please check file format.", variant: "destructive" });
    } finally {
      setUploadLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setExportLoading(true);
      if (filteredFarmers.length === 0) return;

      const headers = [
        "idNumber", "Name", "Gender", "Phone",
        "County", "Subcounty", "Location",
        "Cattle", "Goats (Total)", "Goats (Male)", "Goats (Female)", "Sheep",
        "Vaccinated", "Traceability", "Vaccines",
        "Programme", "Field Officer", "Created By", "Registration Date",
        "Dewormed", "Deworming Date", "Vaccination Date",
        "Aggregation Group", "Bucks Served", "Female Breeds", "Male Breeds",
        "New Breeds Female", "New Breeds Male", "Tag Number (Female)", "Tag Number (Male)",
        "Age 1-4", "Age 5-8", "Age 8+",
        "Age", "Animal Manager", "Household Role", "Income Control",
        "Livestock Insurance", "Livestock Ownership", "Market Information",
        "Offtaker Negotiator", "Sale Decision", "Training Interest",
        "Registration Type", "Group Name",
      ];

      const csvData = filteredFarmers.map((f) => [
        f.idNumber, f.name, f.gender, f.phone,
        f.county, f.subcounty, f.location,
        f.cattle, getGoatTotal(f.goats),
        (typeof f.goats === "object" && f.goats?.male) || 0,
        (typeof f.goats === "object" && f.goats?.female) || 0,
        f.sheep,
        f.vaccinated ? "Yes" : "No",
        f.traceability ? "Yes" : "No",
        f.vaccines.join("; "),
        f.programme, f.username, f.username,
        formatDateForExcel(f.createdAt),
        f.dewormed ? "Yes" : "No",
        formatDateForExcel(f.dewormingDate),
        formatDateForExcel(f.vaccinationDate),
        f.aggregationGroup || "",
        f.bucksServed || "",
        f.femaleBreeds || "",
        f.maleBreeds || "",
        f.newBreedsFemale || "",
        f.newBreedsMale || "",
        f.tugNumberFemale || "",
        f.tugNumberMale || "",
        f.ageDistribution?.["1-4"] || "",
        f.ageDistribution?.["5-8"] || "",
        f.ageDistribution?.["8+"] || "",
        f.age, f.animalManager, f.householdRole, f.incomeControl,
        f.livestockInsurance, f.livestockOwnership, f.marketInformation,
        f.offtakerNegotiator, f.saleDecision, f.trainingInterest,
        f.registeringAs, f.groupName,
      ]);

      const dateColumns = new Set([19, 21, 22]);
      const csvContent = [
        headers.map(escapeCsvCell).join(","),
        ...csvData.map((row) =>
          row.map((cell, index) =>
            dateColumns.has(index) ? String(cell ?? "") : escapeCsvCell(cell)
          ).join(",")
        ),
      ].join("\n");

      const blob = new Blob([`\uFEFF${csvContent}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `farmers_export_${activeProgram}_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: "Success", description: "Data exported successfully" });
    } catch (error) {
      toast({ title: "Error", description: "Export failed", variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  // =========================================================================
  // UI
  // =========================================================================

  const StatsCard = memo(
    ({ title, value, icon: Icon, description, color = "blue", children, maleCount, femaleCount, totalCount }: any) => (
      <Card className="bg-white text-slate-900 shadow-lg border border-gray-200 relative overflow-hidden">
        <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-${color}-600 to-purple-800`}></div>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
          <CardTitle className="text-sm font-medium text-gray-400">{title}</CardTitle>
        </CardHeader>
        <CardContent className="pl-6 pb-4 flex flex-col">
          <div className="flex items-center gap-3 mb-1">
            <div className="rounded-full bg-gray-50 p-2">
              <Icon className={`h-5 w-5 text-${color}-600`} />
            </div>
            <div className="text-xl font-bold text-gray-800">{value}</div>
          </div>
          {maleCount !== undefined && femaleCount !== undefined && (
            <div className="mt-3 flex items-center justify-between w-full bg-gray-50 text-xs">
              <div className="flex flex-row">
                <span className="text-gray-500">Male</span>
                <span className="text-gray-700 text-sm">
                  {maleCount} |{" "}
                  <span className="text-gray-400 font-normal">
                    ({totalCount > 0 ? Math.round((maleCount / totalCount) * 100) : 0}%)
                  </span>
                </span>
              </div>
              <div className="h-8 w-[1px] bg-gray-100"></div>
              <div className="flex flex-row text-right">
                <span className="text-gray-500">Female</span>
                <span className="text-gray-700 text-sm">
                  {femaleCount} |
                  <span className="text-gray-400 font-normal">
                    ({totalCount > 0 ? Math.round((femaleCount / totalCount) * 100) : 0}%)
                  </span>
                </span>
              </div>
            </div>
          )}
          {description && (
            <p className="text-xs mt-2 bg-gray-50 px-2 py-1 rounded-md border border-slate-100">{description}</p>
          )}
          {children}
        </CardContent>
      </Card>
    )
  );

  return (
    <div className="space-y-6 px-2 sm:px-4 md:px-0">
      {/* â”€â”€ Header â”€â”€ */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="w-full md:w-auto">
            <h2 className="text-md font-bold bg-gradient-to-r from-green-600 to-emerald-700 bg-clip-text text-transparent">
              Livestock Farmers
            </h2>
            <div className="flex items-center gap-2">
              <div className="bg-green-50 text-green-700 border-green-200 text-xs w-fit">
                {activeProgram === ALL_PROGRAMMES_VALUE ? "ALL PROGRAMMES" : activeProgram || "No Access"} PROJECT
              </div>
              {isPending && (
                <span className="text-xs text-gray-400 animate-pulse">Updating...</span>
              )}
            </div>
          </div>

          {/* Bulk action buttons now live where the search input used to be */}
          <div className="flex flex-row flex-wrap gap-2 items-center w-full md:w-auto justify-start md:justify-end">
            {selectedRecords.length > 0 && userIsAdmin && (
              <Button variant="destructive" size="sm" onClick={openBulkDeleteConfirm} disabled={deleteLoading} className="text-xs h-10">
                <Trash2 className="h-4 w-4 mr-2" /> Delete ({selectedRecords.length})
              </Button>
            )}
            {selectedRecords.length > 0 && (
              <Button variant="outline" size="sm" onClick={openBulkSmsDialog} className="border-green-300 text-green-700 h-10 hover:bg-green-50">
                <Phone className="h-4 w-4 mr-2" /> Send SMS ({selectedRecords.length})
              </Button>
            )}
            {userIsAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={() => setIsUploadDialogOpen(true)} className="border-green-300 text-green-700 h-10">
                  <Upload className="h-4 w-4 mr-2" /> Upload
                </Button>
                <Button
                  onClick={handleExport}
                  disabled={exportLoading || filteredFarmers.length === 0}
                  className="bg-green-600 text-white shadow-md hover:bg-green-700 text-xs h-10"
                >
                  <Download className="h-4 w-4 mr-2" /> Export ({filteredFarmers.length})
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row xl:flex-row lg:flex-row gap-2 w-full">
          <div className="flex flex-col md:flex-row lg:flex-row gap-2 items-center">
            <Input
              id="startDate"
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange("startDate", e.target.value)}
              className="border-gray-300 focus:border-blue-500 bg-white w-full text-sm pr-6 cursor-pointer appearance-auto"
            />
            <Input
              id="endDate"
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange("endDate", e.target.value)}
              className="border-gray-300 focus:border-blue-500 bg-white w-full text-sm pr-6 cursor-pointer appearance-auto"
            />
            {availablePrograms.length > 1 ? (
              <div className="space-y-2 w-full lg:w-[180px]">
                <Select value={activeProgram} onValueChange={handleProgramChange} disabled={availablePrograms.length === 0}>
                  <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-10 font-bold w-full">
                    <SelectValue placeholder="Select Programme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_PROGRAMMES_VALUE}>All Programmes</SelectItem>
                    {availablePrograms.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="hidden lg:block w-[180px]"></div>
            )}
          </div>

          {/* Clear Filters + search input now share the filter-buttons row */}
          <div className="flex flex-col md:flex-row lg:flex-row gap-2 items-center w-full md:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                startTransition(() => {
                  setFilters({
                    search: "", startDate: "", endDate: "",
                    county: "all", subcounty: "all", ward: "all", gender: "all",
                    location: "all", duplicateStatus: "all", breedsStatus: "all",
                  });
                  setPagination((prev) => ({ ...prev, page: 1 }));
                });
              }}
              className="h-10 px-6 w-full md:w-auto"
            >
              Clear Filters
            </Button>

            <Input
              placeholder="Name, ID, Phone, Officer..."
              defaultValue={filters.search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="border-gray-300 focus:border-blue-500 bg-white h-10 w-full md:w-72"
            />
          </div>
        </div>
      </div>

      {/* â”€â”€ Stats Cards â”€â”€ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
        <StatsCard
          title="FARMERS REGISTERED"
          value={stats.totalFarmers.toLocaleString()}
          icon={Users}
          color="blue"
          maleCount={stats.maleFarmers}
          femaleCount={stats.femaleFarmers}
          totalCount={stats.totalFarmers}
        />
        <StatsCard
          title="ANIMAL CENSUS"
          value={(stats.totalSheep + stats.totalGoats).toLocaleString()}
          icon={Activity}
          color="blue"
        >
          <div className="flex items-center justify-between w-full mt-3 text-xs border-t border-gray-100 pt-2">
            <div className="flex flex-row text-left">
              <span className="text-gray-500 font-medium">Goats</span>
              <span className="text-gray-700">
                {stats.totalGoats} |
                <span className="text-gray-400 font-normal ml-1">
                  {stats.totalSheep + stats.totalGoats > 0
                    ? Math.round((stats.totalGoats / (stats.totalSheep + stats.totalGoats)) * 100)
                    : 0}%
                </span>
              </span>
            </div>
            <div className="flex flex-row text-right">
              <span className="text-gray-500 font-medium">Sheep</span>
              <span className="text-gray-700">
                {stats.totalSheep} |
                <span className="text-gray-400 font-normal ml-1">
                  {stats.totalSheep + stats.totalGoats > 0
                    ? Math.round((stats.totalSheep / (stats.totalSheep + stats.totalGoats)) * 100)
                    : 0}%
                </span>
              </span>
            </div>
          </div>
        </StatsCard>
        <StatsCard
          title="VISITED LOCATIONS"
          value={stats.totalVisitedLocations.toLocaleString()}
          icon={MapPin}
          color="blue"
        />
      </div>

      {/* â”€â”€ Filters â”€â”€ */}
      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="space-y-6 pt-6">
          <ScrollableFilterBar ariaLabel="Livestock farmer filters" contentClassName="sm:grid-cols-2 lg:grid-cols-7">
            <div className="w-[190px] shrink-0 space-y-2 sm:w-auto">
              <Select value={filters.county} onValueChange={(value) => handleFilterChange("county", value)}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9">
                  <SelectValue placeholder="All Counties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Counties</SelectItem>
                  {uniqueCounties.map((county) => (
                    <SelectItem key={county} value={county}>{county}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[190px] shrink-0 space-y-2 sm:w-auto">
              <Select value={filters.subcounty} onValueChange={(value) => handleFilterChange("subcounty", value)}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9">
                  <SelectValue placeholder="All Subcounties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Subcounties</SelectItem>
                  {uniqueSubcounties.map((sub) => (
                    <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[190px] shrink-0 space-y-2 sm:w-auto">
              <Select value={filters.ward} onValueChange={(value) => handleFilterChange("ward", value)}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9">
                  <SelectValue placeholder="All Wards" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Wards</SelectItem>
                  {uniqueWards.map((ward) => (
                    <SelectItem key={ward} value={ward}>{ward}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[190px] shrink-0 space-y-2 sm:w-auto">
              <Select value={filters.location} onValueChange={(value) => handleFilterChange("location", value)}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {uniqueLocations.map((loc) => (
                    <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[190px] shrink-0 space-y-2 sm:w-auto">
              <Select value={filters.gender} onValueChange={(value) => handleFilterChange("gender", value)}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9">
                  <SelectValue placeholder="All Genders" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Genders</SelectItem>
                  {uniqueGenders.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[210px] shrink-0 space-y-2 sm:w-auto">
              <Select value={filters.duplicateStatus} onValueChange={(value) => handleFilterChange("duplicateStatus", value as Filters["duplicateStatus"])}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9">
                  <SelectValue placeholder="All Registrations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Registrations</SelectItem>
                  <SelectItem value="unique">Unique Farmers</SelectItem>
                  <SelectItem value="repeated">Repeated Registrations</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-[210px] shrink-0 space-y-2 sm:w-auto">
              <Select value={filters.breedsStatus} onValueChange={(value) => handleFilterChange("breedsStatus", value as Filters["breedsStatus"])}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9">
                  <SelectValue placeholder="All Records" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Records</SelectItem>
                  <SelectItem value="withBreeds">With Breeding Data</SelectItem>
                  <SelectItem value="withoutBreeds">Without Breeding Data</SelectItem>
                </SelectContent>
              </Select>
            </div>

          </ScrollableFilterBar>
        </CardContent>
      </Card>

      {/* â”€â”€ Table â”€â”€ */}
      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-muted-foreground mt-2">Loading farmers registry...</p>
            </div>
          ) : currentPageRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {activeProgram ? "No records found matching your criteria" : "You do not have access to any programme data."}
            </div>
          ) : (
            <>
              <div className="w-full overflow-x-auto rounded-md">
                <table className="w-full border-collapse border border-gray-300 text-sm text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-green-100 text-xs">
                      <th className="py-3 px-3">
                        <Checkbox
                          checked={selectedRecords.length === currentPageRecords.length && currentPageRecords.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </th>
                      <th className="py-3 px-3 font-semibold text-green-900">Date</th>
                      <th className="py-3 px-3 font-semibold text-green-900">Farmer Name</th>
                      <th className="py-3 px-3 font-semibold text-green-900">Gender</th>
                      <th className="py-3 px-3 font-semibold text-green-900">Phone</th>
                      <th className="py-3 px-3 font-semibold text-green-900 hidden sm:table-cell">idNumber</th>
                      <th className="py-3 px-3 font-semibold text-green-900">County</th>
                      <th className="py-3 px-3 font-semibold text-green-900">Subcounty</th>
                      <th className="py-3 px-3 font-semibold text-green-900">Location</th>
                      <th className="py-3 px-3 font-semibold text-green-900">Cattle</th>
                      <th className="py-3 px-3 font-semibold text-green-900">Goats</th>
                      <th className="py-3 px-3 font-semibold text-green-900">Sheep</th>
                      <th className="py-3 px-3 font-semibold text-green-900">Vaccinated</th>
                      <th className="py-3 px-3 font-semibold text-green-900">PROJECT</th>
                      <th className="py-3 px-3 font-semibold text-green-900 hidden sm:table-cell">Field Officer</th>
                      <th className="py-3 px-3 font-semibold text-green-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageRecords.map((record) => (
                      <tr key={record.id} className="border-b hover:bg-green-50 transition-colors group">
                        <td className="py-2 px-3">
                          <Checkbox
                            checked={selectedRecords.includes(record.id)}
                            onCheckedChange={() => handleSelectRecord(record.id)}
                          />
                        </td>
                        <td className="py-2 px-3 text-xs text-gray-500">{formatDate(record.createdAt)}</td>
                        <td className="py-2 px-3 text-sm">{record.name}</td>
                        <td className="py-2 px-3">{record.gender}</td>
                        <td className="py-2 px-3 text-xs">{record.phone}</td>
                        <td className="py-2 px-3 text-xs font-mono hidden sm:table-cell">{record.idNumber}</td>
                        <td className="py-2 px-3 text-xs">{record.county}</td>
                        <td className="py-2 px-3 text-xs">{record.subcounty}</td>
                        <td className="py-2 px-3 text-xs">{record.location}</td>
                        <td className="py-2 px-3 text-xs">{record.cattle}</td>
                        <td className="py-2 px-3 text-xs font-semibold text-green-700">{getGoatTotal(record.goats)}</td>
                        <td className="py-2 px-3 text-xs font-semibold text-purple-700">{record.sheep}</td>
                        <td className="py-2 px-3">
                          {record.vaccinated ? (
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[10px]">Yes</Badge>
                          ) : (
                            <Badge variant="outline" className="text-gray-400 text-[10px]">No</Badge>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant="outline" className="border-green-200 text-green-700 text-[10px]">
                            {record.programme || activeProgram}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-xs italic text-gray-500 hidden sm:table-cell">{record.username}</td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:bg-green-50"
                              onClick={() => openViewDialog(record)}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {userIsAdmin && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-green-700 hover:bg-green-50"
                                  onClick={() => openEditDialog(record)}>
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50"
                                  onClick={() => openSingleDeleteConfirm(record)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between p-4 border-t bg-gray-50 gap-4">
                <div className="text-sm text-muted-foreground">
                  {filteredFarmers.length} total records &bull; Page {pagination.page} of {pagination.totalPages}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => handlePageChange(pagination.page - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => handlePageChange(pagination.page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-6xl bg-slate-100 p-3 sm:p-5 rounded-2xl max-h-[96vh] overflow-y-auto w-[98vw]">
          {viewingRecord && (
            <div className="space-y-3 text-slate-800">
              <DialogHeader className="px-2 pt-1">
                <DialogTitle className="text-xl font-semibold text-emerald-700 flex items-center gap-2"><Users className="h-5 w-5" /> Customer Profile Details</DialogTitle>
                <DialogDescription>Complete information for {viewingRecord.name}</DialogDescription>
              </DialogHeader>
              <div className="rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-4"><div className="rounded-full bg-emerald-100 p-3 text-emerald-700"><Users className="h-7 w-7" /></div><div><h3 className="text-lg font-bold text-emerald-800">{viewingRecord.name}</h3><p className="text-sm text-slate-500">{viewingRecord.idNumber || "N/A"} <span className="px-2">•</span> {viewingRecord.programme}</p></div></div>
              </div>

              <section className="rounded-xl border border-sky-100 bg-white p-3 sm:p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 items-stretch gap-3">
                  <div className="grid content-start grid-cols-1 gap-x-4 rounded-lg border border-sky-100 p-3 sm:grid-cols-2"><ProfileRow label="Full Name" value={viewingRecord.name} /><ProfileRow label="National ID" value={viewingRecord.idNumber} /><ProfileRow label="Phone" value={viewingRecord.phone} /><ProfileRow label="Member Number" value={viewingRecord.farmerId} /><ProfileRow label="Registration Type" value={viewingRecord.registeringAs} /><ProfileRow label="Livestock Ownership" value={viewingRecord.livestockOwnership} /><ProfileRow label="Gender" value={viewingRecord.gender} /><ProfileRow label="Age" value={viewingRecord.age} /></div>
                  <div className="grid content-start grid-cols-1 gap-x-4 rounded-lg border border-sky-100 p-3 sm:grid-cols-2"><ProfileRow label="Animal Manager" value={viewingRecord.animalManager} /><ProfileRow label="Income Control" value={viewingRecord.incomeControl} /><ProfileRow label="Sale Decision" value={viewingRecord.saleDecision} /><ProfileRow label="Offtaker Negotiator" value={viewingRecord.offtakerNegotiator} /><ProfileRow label="Market Information Source" value={viewingRecord.marketInformation} /><ProfileRow label="Field Officer" value={viewingRecord.username} /><ProfileRow label="Household Role" value={viewingRecord.householdRole} /><ProfileRow label="Livestock Insurance" value={viewingRecord.livestockInsurance} /></div>
                  <div className="grid content-start grid-cols-1 gap-x-4 rounded-lg border border-sky-100 p-3 sm:grid-cols-2"><ProfileRow label="County" value={viewingRecord.county} /><ProfileRow label="Subcounty" value={viewingRecord.subcounty} /><ProfileRow label="Ward" value={viewingRecord.ward} /><ProfileRow label="Location" value={viewingRecord.location} /><ProfileRow label="Registration Date" value={viewingRecord.registrationDate} /><ProfileRow label="Training Interest" value={viewingRecord.trainingInterest} /><ProfileRow label="Group Name" value={viewingRecord.groupName} /><ProfileRow label="Aggregation Group" value={viewingRecord.aggregationGroup} /></div>
                </div>
              </section>

              <section className="rounded-xl border border-sky-100 bg-white p-3 sm:p-4"><h4 className="mb-3 font-semibold text-emerald-700 flex items-center gap-2"><Scale className="h-5 w-5" />Livestock Ownership</h4><div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[{ label: "Cattle", value: viewingRecord.cattle }, { label: "Goats", value: getGoatTotal(viewingRecord.goats) }, { label: "Sheep", value: viewingRecord.sheep }, { label: "Male Goats", value: typeof viewingRecord.goats === "object" && viewingRecord.goats ? viewingRecord.goats.male ?? 0 : "N/A" }, { label: "Female Goats", value: typeof viewingRecord.goats === "object" && viewingRecord.goats ? viewingRecord.goats.female ?? 0 : "N/A" }].map((animal) => <div key={animal.label} className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 text-center"><Scale className="mx-auto h-5 w-5 text-emerald-700" /><p className="mt-1 text-2xl font-bold text-emerald-700">{animal.value}</p><p className="text-xs uppercase tracking-wide text-slate-500">{animal.label}</p></div>)}</div></section>

              <section className="rounded-xl border border-sky-100 bg-white p-3 sm:p-4"><h4 className="mb-3 font-semibold text-emerald-700 flex items-center gap-2"><Users className="h-5 w-5" />Animals Age Distribution</h4><div className="grid grid-cols-3 divide-x divide-emerald-100">{[{ label: "Goat Ages 1–4", value: viewingRecord.ageDistribution?.["1-4"] }, { label: "Goat Ages 5–8", value: viewingRecord.ageDistribution?.["5-8"] }, { label: "Goat Ages 8+", value: viewingRecord.ageDistribution?.["8+"] }].map((age) => <div key={age.label} className="px-3"><p className="text-xs uppercase text-slate-500">{age.label}</p><p className="mt-1 text-lg font-semibold">{age.value ?? "N/A"}</p></div>)}</div></section>

              <section className="rounded-xl border border-sky-100 bg-white p-3 sm:p-4"><h4 className="mb-3 font-semibold text-emerald-700 flex items-center gap-2"><Activity className="h-5 w-5" />Health Status</h4><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[{ label: "Vaccinated", value: viewingRecord.vaccinated ? "Yes" : "No" }, { label: "Dewormed", value: viewingRecord.dewormed ? "Yes" : "No" }, { label: "Vaccination Date", value: viewingRecord.vaccinationDate }, { label: "Deworming Date", value: viewingRecord.dewormingDate }, { label: "Vaccines", value: viewingRecord.vaccines.join(", ") }].map((health) => <div key={health.label} className="flex items-center gap-3 rounded-lg border border-sky-100 p-3"><ShieldCheck className="h-5 w-5 text-emerald-700" /><div><p className="text-xs uppercase text-slate-500">{health.label}</p><p className="font-medium">{health.value || "N/A"}</p></div></div>)}</div></section>

              <section className="rounded-xl border border-sky-100 bg-white p-3 sm:p-4"><h4 className="mb-3 font-semibold text-emerald-700 flex items-center gap-2"><Scale className="h-5 w-5" />Breeding</h4><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[{ label: "Bucks Served", value: viewingRecord.bucksServed }, { label: "Male Breeds", value: viewingRecord.maleBreeds }, { label: "Female Breeds", value: viewingRecord.femaleBreeds }, { label: "New Breeds (Male)", value: viewingRecord.newBreedsMale }, { label: "New Breeds (Female)", value: viewingRecord.newBreedsFemale }, { label: "Tag Number (Male)", value: viewingRecord.tugNumberMale }, { label: "Tag Number (Female)", value: viewingRecord.tugNumberFemale }].map((breed) => <div key={breed.label} className="border-r border-emerald-100 px-2"><p className="text-xs uppercase text-slate-500">{breed.label}</p><p className="mt-1 font-medium">{breed.value || "N/A"}</p></div>)}</div></section>

              <section className="rounded-xl border border-sky-100 bg-white p-3 sm:p-4"><h4 className="mb-3 font-semibold text-emerald-700 flex items-center gap-2"><Activity className="h-5 w-5" />Traceability</h4><div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3"><p className="text-xs uppercase text-slate-500">Traceability</p><p className="font-medium">{viewingRecord.traceability ? "Enrolled" : "Not enrolled"}</p></div></section>
              <DialogFooter className="sticky bottom-0 bg-slate-100 py-2"><Button onClick={() => setIsViewDialogOpen(false)} className="bg-emerald-700 hover:bg-emerald-800">Close</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* â”€â”€ Edit Dialog â”€â”€ */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Farmer Details</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>idNumber</Label>
              <Input value={editForm.farmerId} onChange={(e) => setEditForm({ ...editForm, farmerId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Gender</Label>
              <Select value={editForm.gender} onValueChange={(val) => setEditForm({ ...editForm, gender: val })}>
                <SelectTrigger><SelectValue placeholder="Select Gender" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>ID Number</Label>
              <Input value={editForm.idNumber} onChange={(e) => setEditForm({ ...editForm, idNumber: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>County</Label>
              <Input value={editForm.county} onChange={(e) => setEditForm({ ...editForm, county: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Subcounty</Label>
              <Input value={editForm.subcounty} onChange={(e) => setEditForm({ ...editForm, subcounty: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Location</Label>
              <Input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
            </div>
            <div className="col-span-1 sm:col-span-2 my-2 border-t pt-2">
              <h4 className="text-sm font-semibold text-gray-500 uppercase">Livestock Counts</h4>
            </div>
            <div className="space-y-2">
              <Label>Cattle</Label>
              <Input type="number" value={editForm.cattle} onChange={(e) => setEditForm({ ...editForm, cattle: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Goats</Label>
              <Input type="number" value={editForm.goats} onChange={(e) => setEditForm({ ...editForm, goats: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Sheep</Label>
              <Input type="number" value={editForm.sheep} onChange={(e) => setEditForm({ ...editForm, sheep: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="col-span-1 sm:col-span-2 my-2 border-t pt-2">
              <h4 className="text-sm font-semibold text-gray-500 uppercase">Breeding</h4>
            </div>
            <div className="space-y-2">
              <Label>Bucks Served</Label>
              <Input type="number" value={editForm.bucksServed} onChange={(e) => setEditForm({ ...editForm, bucksServed: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Male Breeds</Label>
              <Input type="number" value={editForm.maleBreeds} onChange={(e) => setEditForm({ ...editForm, maleBreeds: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Female Breeds</Label>
              <Input type="number" value={editForm.femaleBreeds} onChange={(e) => setEditForm({ ...editForm, femaleBreeds: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>New Breeds (Male)</Label>
              <Input type="number" value={editForm.newBreedsMale} onChange={(e) => setEditForm({ ...editForm, newBreedsMale: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>New Breeds (Female)</Label>
              <Input type="number" value={editForm.newBreedsFemale} onChange={(e) => setEditForm({ ...editForm, newBreedsFemale: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Tag Number (Male Breeds)</Label>
              <Input value={editForm.tugNumberMale} onChange={(e) => setEditForm({ ...editForm, tugNumberMale: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Tag Number (Female Breeds)</Label>
              <Input value={editForm.tugNumberFemale} onChange={(e) => setEditForm({ ...editForm, tugNumberFemale: e.target.value })} />
            </div>
            <div className="col-span-1 sm:col-span-2 my-2 border-t pt-2">
              <h4 className="text-sm font-semibold text-gray-500 uppercase">Status & PROJECT</h4>
            </div>
            <div className="space-y-2">
              <Label>PROJECT</Label>
              <Select value={editForm.programme} onValueChange={(val) => setEditForm({ ...editForm, programme: val })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {availablePrograms.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 border p-3 rounded h-fit mt-6">
              <Checkbox checked={editForm.vaccinated} onCheckedChange={(c) => setEditForm({ ...editForm, vaccinated: !!c })} id="edit-vaccinated" />
              <Label htmlFor="edit-vaccinated" className="cursor-pointer">Vaccinated</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSubmit} className="bg-green-600 hover:bg-green-700 text-white">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* â”€â”€ Upload Dialog â”€â”€ */}
      <Dialog open={isUploadDialogOpen} onOpenChange={(open) => {
        if (!uploadLoading) {
          setIsUploadDialogOpen(open);
          if (!open) { setUploadFile(null); setUploadPreview([]); setUploadProgress({ current: 0, total: 0 }); }
        }
      }}>
        <DialogContent className="sm:max-w-lg w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-green-600" />
              Upload Farmers Data
            </DialogTitle>
            <DialogDescription>
              Upload a CSV or JSON file. Data will be assigned to <strong>{activeProgram}</strong> PROJECT.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="farmers-csv-upload" className="text-sm font-semibold text-gray-700">Select File</Label>
              <Input
                id="farmers-csv-upload"
                type="file"
                ref={fileInputRef}
                accept=".csv,.json"
                multiple
                onChange={handleFileSelect}
                disabled={uploadLoading}
                className="border-gray-300 focus:border-green-500"
              />
            </div>

            {uploadPreview.length > 0 && !uploadLoading && (
              <div className="bg-gray-50 border rounded-lg p-3 space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">File Preview</p>
                {uploadPreview.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate max-w-[250px]">{f.name}</span>
                    <Badge variant="outline" className="text-green-700 border-green-200 text-xs">{f.rows} rows</Badge>
                  </div>
                ))}
              </div>
            )}

            {uploadLoading && uploadProgress.total > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Uploading...</span>
                  <span className="font-medium text-gray-800">{uploadProgress.current} / {uploadProgress.total}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-green-500 to-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUploadDialogOpen(false)} disabled={uploadLoading}>Cancel</Button>
            <Button
              onClick={handleUpload}
              disabled={!uploadFile || uploadLoading}
              className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white"
            >
              {uploadLoading ? `Uploading (${uploadProgress.current}/${uploadProgress.total})...` : "Upload Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* â”€â”€ Single Delete Dialog â”€â”€ */}
      <Dialog open={isSingleDeleteDialogOpen} onOpenChange={setIsSingleDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] sm:w-full">
          <DialogHeader><DialogTitle>Confirm Deletion</DialogTitle></DialogHeader>
          <p>Are you sure you want to delete <strong>{recordToDelete?.name}</strong>? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSingleDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleSingleDelete} disabled={deleteLoading}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* â”€â”€ Bulk Delete Dialog â”€â”€ */}
      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] sm:w-full">
          <DialogHeader><DialogTitle>Bulk Delete</DialogTitle></DialogHeader>
          <p>Are you sure you want to delete {selectedRecords.length} selected records?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteMultiple} disabled={deleteLoading}>Delete All</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* â”€â”€ Bulk SMS Dialog â”€â”€ */}
      <Dialog
        open={isBulkSmsDialogOpen}
        onOpenChange={(open) => {
          if (!bulkSmsSending) setIsBulkSmsDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle>Send Bulk SMS to Farmers</DialogTitle>
            <DialogDescription>This message will be sent to selected farmers with valid phone numbers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="farmers-bulk-sms-message">SMS Message</Label>
            <Textarea
              id="farmers-bulk-sms-message"
              rows={5}
              value={bulkSmsMessage}
              onChange={(event) => setBulkSmsMessage(event.target.value)}
              placeholder="Type SMS message..."
              disabled={bulkSmsSending}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkSmsDialogOpen(false)} disabled={bulkSmsSending}>
              Cancel
            </Button>
            <Button onClick={handleSendBulkSms} disabled={bulkSmsSending}>
              {bulkSmsSending ? "Sending..." : "Send SMS"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const ProfileRow = ({ label, value }: { label: string; value: unknown }) => (
  <div className="min-w-0 border-b border-sky-100 py-2 last:border-0">
    <p className="text-xs leading-4 text-slate-500">{label}</p>
    <p className="break-words text-sm font-medium leading-5 text-slate-800">{value === null || value === undefined || value === "" ? "N/A" : String(value)}</p>
  </div>
);

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col">
    <span className="text-xs text-gray-500 font-bold uppercase">{label}</span>
    <span className="text-sm font-medium text-gray-900">{value || "N/A"}</span>
  </div>
);

export default LivestockFarmersPage;




