import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getAuth } from "firebase/auth";
import { db, ref, set, update, remove, push, subscribeCollectionByProgrammes } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollableFilterBar } from "@/components/ScrollableFilterBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, Users, MapPin, Eye, Calendar, Scale, Phone, CreditCard, Edit, Trash2, Weight, Upload, Loader2 } from "lucide-react";
import { useSharedProgrammeSelection } from "@/hooks/use-shared-programme-selection";
import { toast, useToast } from "@/hooks/use-toast";
import { canViewAllProgrammes, isAdmin } from "@/contexts/authhelper";
import { ALL_PROGRAMMES_VALUE, matchesActiveProgramme, normalizeProgramme, PROGRAMME_OPTIONS, resolveAccessibleProgrammes, resolveActiveProgramme } from "@/lib/programme-access";
import { sendBulkSms } from "@/lib/sms";

// Types
interface OfftakeData {
  id: string;
  date: Date | string;
  farmerName: string;
  gender: string;
  idNumber: string;
  liveWeight: number[];
  carcassWeight: number[];
  location: string;
  noSheepGoats: number;
  phoneNumber: string;
  pricePerGoatAndSheep: number[];
  region: string;
  programme: string;
  subcounty: string;
  username: string;
  offtakeUserId: string;
  totalprice: number;
  createdAt: number;
  paidAt: string | number;
  animalType: string;
  carcassRatio: number;
  offtakeType: string;
  farmerCount: number;
  groupName: string;
  representative: string;
  ward: string;
  previewTotalPrice: number;
  pricePerKg: number;
  previewPricePerAnimal: number[];
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  region: string;
  gender: string;
}

interface Stats {
  totalRegions: number;
  totalAnimals: number;
  totalRevenue: number;
  averageLiveWeight: number;
  averageCarcassWeight: number;
  averageRevenue: number;
  totalFarmers: number;
  totalSessions: number;
  totalMaleFarmers: number;
  totalFemaleFarmers: number;
  avgPricePerCarcassKg: number;
}

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface EditForm {
  date: string;
  farmerName: string;
  gender: string;
  idNumber: string;
  phoneNumber: string;
  region: string;
  location: string;
  paidAt: string;
}

interface WeightEditForm {
  liveWeights: number[];
  carcassWeights: number[];
  prices: number[];
}

type DateRangeBounds = Pick<Filters, "startDate" | "endDate">;
type QuickRangeKey = "thisMonth" | "lastMonth" | "last3Months" | "allTime" | "custom";
type FetchMode = "dateRange" | "all";

// Constants
const PAGE_LIMIT = 15;

// --- HELPERS ---
const cleanNumber = (val: string): number => {
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
};

const parseExcelSerialDate = (value: number): Date | null => {
  if (!Number.isFinite(value) || value < 20000 || value > 80000) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const parsed = new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
  return isNaN(parsed.getTime()) ? null : parsed;
};

const parseDate = (date: any): Date | null => {
  if (!date) return null;

  try {
    if (date instanceof Date) {
      return isNaN(date.getTime()) ? null : date;
    }

    if (typeof date === "number") {
      const excelDate = parseExcelSerialDate(date);
      if (excelDate) return excelDate;

      const timestamp = date > 0 && date < 10_000_000_000 ? date * 1000 : date;
      const parsed = new Date(timestamp);
      return isNaN(parsed.getTime()) ? null : parsed;
    }

    let trimmed = String(date).trim();

    // Normalize ISO strings with timestamps (e.g., from Edit Form) to avoid timezone day-shifting
    const fullIsoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (fullIsoMatch) {
      trimmed = trimmed.substring(0, 10);
    }

    const numericDate = Number(trimmed);
    if (!isNaN(numericDate) && trimmed !== '') {
      const excelDate = parseExcelSerialDate(numericDate);
      if (excelDate) return excelDate;

      const timestamp = numericDate > 0 && numericDate < 10_000_000_000 ? numericDate * 1000 : numericDate;
      const parsedNumericDate = new Date(timestamp);
      if (!isNaN(parsedNumericDate.getTime())) return parsedNumericDate;
    }

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
  } catch (error) {
    console.error('Error parsing date:', error, date);
  }

  return null;
};

const formatDate = (date: any): string => {
  const parsedDate = parseDate(date);
  return parsedDate ? parsedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }) : 'N/A';
};

// Formats a createdAt millisecond timestamp into a human readable date + time string,
// used to show "when" a record was submitted (alongside "who" submitted it).
const formatDateTime = (timestamp: number | null | undefined): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return 'N/A';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getOfftakeTimestamp = (record: Partial<OfftakeData> | null | undefined): number => {
  if (!record) return 0;
  if (record.createdAt && typeof record.createdAt === 'number' && record.createdAt > 0) {
    return record.createdAt;
  }
  const parsed = parseDate(record.date);
  return parsed ? parsed.getTime() : 0;
};

const sortOfftakeByLatest = (records: OfftakeData[]): OfftakeData[] =>
  [...records].sort((a, b) => getOfftakeTimestamp(b) - getOfftakeTimestamp(a));

const formatDateToLocal = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getCurrentMonthDates = (): DateRangeBounds => {
  const now = new Date();
  return {
    startDate: formatDateToLocal(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: formatDateToLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

const getDefaultOfftakeFetchDates = (): DateRangeBounds => {
  return getCurrentMonthDates();
};

const createDefaultFilters = (defaultDates: DateRangeBounds = getDefaultOfftakeFetchDates()): Filters => {
  return {
    search: "",
    startDate: defaultDates.startDate,
    endDate: defaultDates.endDate,
    region: "all",
    gender: "all",
  };
};

// Returns the date bounds for a quick-range preset. Always computed fresh (never memoized)
// so every call reflects "now" and produces a new object reference, which matters for
// forcing React state updates even when the resulting values happen to be unchanged.
const getQuickRangeDates = (key: QuickRangeKey): DateRangeBounds | null => {
  const now = new Date();
  switch (key) {
    case "thisMonth":
      return getCurrentMonthDates();
    case "lastMonth":
      return {
        startDate: formatDateToLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        endDate: formatDateToLocal(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "last3Months":
      return {
        startDate: formatDateToLocal(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
        endDate: formatDateToLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    case "allTime":
      return {
        startDate: "2000-01-01",
        endDate: formatDateToLocal(new Date(now.getFullYear() + 1, 11, 31)),
      };
    default:
      return null;
  }
};

// Widens a fetch window to include newly requested bounds instead of overwriting it.
// This guarantees that whichever date range the user asks for (via manual inputs or the
// quick-range picker) is always covered by the live Firebase subscription, so the fetched
// dataset - and therefore the stats derived from it - actually changes when filters change.
const unionDateRange = (base: DateRangeBounds, addStart?: string, addEnd?: string): DateRangeBounds => {
  let { startDate, endDate } = base;
  if (addStart) {
    if (!startDate || addStart < startDate) startDate = addStart;
  }
  if (addEnd) {
    if (!endDate || addEnd > endDate) endDate = addEnd;
  }
  return { startDate, endDate };
};

const parseDateInputValue = (value: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return parseDate(value);
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return isNaN(parsed.getTime()) ? null : parsed;
};

const getFirstValue = (record: Record<string, any>, fields: string[]) => {
  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
};

const getOfftakeDateValue = (record: Record<string, any>) =>
  getFirstValue(record, ["date", "Date", "purchaseDate", "purchase_date", "completedAt", "completed_at", "createdAt", "created_at", "timestamp"]);

const getOfftakeProgrammeValue = (record: Record<string, any>) =>
  getFirstValue(record, ["programme", "Programme", "program", "Program"]);

const getOfftakeCountyValue = (record: Record<string, any>) =>
  getFirstValue(record, ["county", "County", "region", "Region"]);

const formatDateForInput = (date: any): string => {
  const parsedDate = parseDate(date);
  return parsedDate ? formatDateToLocal(parsedDate) : '';
};

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
  }).format(amount || 0);
};

const calculateAverage = (data: number[]): number => {
  if (!data || data.length === 0) return 0;
  const sum = data.reduce((acc, val) => acc + (Number(val) || 0), 0);
  return sum / data.length;
};

const calculateTotal = (data: number[]): number => {
  if (!data || data.length === 0) return 0;
  return data.reduce((acc, val) => acc + (Number(val) || 0), 0);
};

const isMissingFarmerId = (value: unknown): boolean => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (
    !normalized ||
    normalized === "0" ||
    normalized === "0.0" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "/a" ||
    normalized === "a" ||
    normalized === "null" ||
    normalized === "undefined"
  );
};

const sanitizeGeneratedIdSegment = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);

const generateFarmerId = (
  seed: string,
  record?: Partial<Pick<OfftakeData, "farmerName" | "phoneNumber" | "location">> & {
    name?: string;
    phone?: string;
  },
): string => {
  const nameSegment = sanitizeGeneratedIdSegment(record?.farmerName || record?.name || "FARMER") || "FARMER";
  const phoneSegment = sanitizeGeneratedIdSegment(record?.phoneNumber || record?.phone || "");
  const locationSegment = sanitizeGeneratedIdSegment(record?.location || "");
  const seedValue = `${seed}|${nameSegment}|${phoneSegment}|${locationSegment}`;
  let hash = 0;

  for (let index = 0; index < seedValue.length; index += 1) {
    hash = (hash * 31 + seedValue.charCodeAt(index)) >>> 0;
  }

  const suffix = hash.toString(36).toUpperCase().padStart(6, "0").slice(-6);
  return `GEN-${nameSegment.slice(0, 4)}-${suffix}`;
};

const resolveFarmerId = (
  value: unknown,
  seed: string,
  record?: Partial<Pick<OfftakeData, "farmerName" | "phoneNumber" | "location">> & {
    name?: string;
    phone?: string;
  },
): string => (isMissingFarmerId(value) ? generateFarmerId(seed, record) : String(value).trim());

const getFarmerPhoneFromRecord = (record: Record<string, unknown>): string => {
  const candidates = [record.phone, record.phoneNumber, record.mobile, record.telephone, record.contact];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return "";
};

const getFarmerGroupingKey = (record: OfftakeData): string => {
  const normalizedId = String(record.idNumber || '').trim().toLowerCase();
  return normalizedId ? `id:${normalizedId}` : `record:${record.id}`;
};

const mapRawOfftakeRecord = (
  key: string,
  item: Record<string, any>,
  fallbackProgramme: string,
): { record: OfftakeData; missingIdUpdate?: string } => {
  const rawDateValue = getOfftakeDateValue(item);
  const parsedItemDate = parseDate(rawDateValue);
  const dateValue: Date | string = parsedItemDate ?? rawDateValue ?? "";
  const programmeValue = getOfftakeProgrammeValue(item) || fallbackProgramme;
  const countyValue = getOfftakeCountyValue(item) || "";

  const goats = Array.isArray(item.goats) ? item.goats : [];
  const liveWeights = goats.map((g: any) => parseFloat(g.live) || 0);
  const carcassWeights = goats.map((g: any) => parseFloat(g.carcass) || 0);
  const prices = goats.map((g: any) => parseFloat(g.price) || 0);
  const previewPrices = goats.map((g: any) => parseFloat(g.previewPrice) || 0);

  const resolvedIdNumber = resolveFarmerId(item.idNumber, key, {
    name: item.name || item.farmerName || "",
    phone: item.phone || item.phoneNumber || "",
    location: item.location || countyValue || "",
  });

  return {
    record: {
      id: key,
      date: dateValue,
      farmerName: item.name || item.farmerName || "",
      gender: item.gender || "",
      idNumber: resolvedIdNumber,
      liveWeight: liveWeights,
      carcassWeight: carcassWeights,
      location: item.location || "",
      noSheepGoats: Number(item.totalGoats || goats.length || 0),
      phoneNumber: item.phone || item.phoneNumber || "",
      pricePerGoatAndSheep: prices,
      region: String(countyValue),
      programme: String(programmeValue),
      subcounty: item.subcounty || item.Subcounty || item["Sub County"] || "",
      username: item.username || "",
      offtakeUserId: item.offtakeUserId || "",
      totalprice: Number(item.totalPrice || item.totalprice || 0),
      createdAt: Number(item.createdAt || parsedItemDate?.getTime() || 0),
      paidAt: item.paidAt || item.paid_at || "",
      animalType: item.animalType || "",
      carcassRatio: Number(item.carcassRatio) || 0,
      offtakeType: item.offtakeType || "",
      farmerCount: Number(item.farmerCount) || 0,
      groupName: item.groupName || "",
      representative: item.representative || "",
      ward: item.ward || item.Ward || "",
      previewTotalPrice: Number(item.previewTotalPrice) || 0,
      pricePerKg: Number(item.pricePerKg) || 0,
      previewPricePerAnimal: previewPrices,
    },
    missingIdUpdate: isMissingFarmerId(item.idNumber) ? resolvedIdNumber : undefined,
  };
};

function safeTruncate(value: string | number) {
  let str = String(value).replace(/[^0-9.]/g, "");
  const num = Number(str);
  if (isNaN(num)) return "Invalid Number";
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString();
}

// --- SUB-COMPONENTS ---
interface FilterSectionProps {
  localSearchInput: string;
  filters: Filters;
  quickRange: QuickRangeKey;
  uniqueRegions: string[];
  uniqueGenders: string[];
  onSearchChange: (value: string) => void;
  onFilterChange: (key: keyof Filters, value: string) => void;
  onQuickRangeChange: (value: QuickRangeKey) => void;
}

const FilterSection = memo(({
  localSearchInput,
  filters,
  quickRange,
  uniqueRegions,
  uniqueGenders,
  onSearchChange,
  onFilterChange,
  onQuickRangeChange
}: FilterSectionProps) => (
  <ScrollableFilterBar ariaLabel="Livestock offtake filters" contentClassName="sm:grid-cols-2 lg:grid-cols-6">
    <div className="w-[240px] shrink-0 space-y-2 sm:w-auto">
      <Label htmlFor="search" className="font-semibold text-gray-700">Search</Label>
      <Input
        id="search"
        placeholder="Search farmers..."
        value={localSearchInput}
        onChange={(e) => onSearchChange(e.target.value)}
        className="border-gray-300 focus:border-blue-500 bg-white"
      />
    </div>

    <div className="w-[170px] shrink-0 space-y-2 sm:w-auto">
      <Label htmlFor="quickRange" className="font-semibold text-gray-700">Date Range</Label>
      <Select value={quickRange} onValueChange={(value) => onQuickRangeChange(value as QuickRangeKey)}>
        <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="thisMonth">This Month</SelectItem>
          <SelectItem value="lastMonth">Last Month</SelectItem>
          <SelectItem value="last3Months">Last 3 Months</SelectItem>
          <SelectItem value="allTime">All Time</SelectItem>
          <SelectItem value="custom">Custom</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div className="w-[190px] shrink-0 space-y-2 sm:w-auto">
      <Label htmlFor="region" className="font-semibold text-gray-700">Counties</Label>
      <Select value={filters.region} onValueChange={(value) => onFilterChange("region", value)}>
        <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white">
          <SelectValue placeholder="Select region" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">County</SelectItem>
          {uniqueRegions.slice(0, 20).map(region => (
            <SelectItem key={region} value={region}>{region}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="w-[190px] shrink-0 space-y-2 sm:w-auto">
      <Label htmlFor="gender" className="font-semibold text-gray-700">Gender</Label>
      <Select value={filters.gender} onValueChange={(value) => onFilterChange("gender", value)}>
        <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white">
          <SelectValue placeholder="Select gender" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Genders</SelectItem>
          {uniqueGenders.slice(0, 20).map(gender => (
            <SelectItem key={gender} value={gender}>{gender}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="w-[156px] shrink-0 space-y-2 sm:w-auto">
      <Label htmlFor="startDate" className="font-semibold text-gray-700">From Date</Label>
      <Input
        id="startDate"
        type="date"
        value={filters.startDate}
        onChange={(e) => onFilterChange("startDate", e.target.value)}
        className="border-gray-300 focus:border-blue-500 bg-white"
      />
    </div>

    <div className="w-[156px] shrink-0 space-y-2 sm:w-auto">
      <Label htmlFor="endDate" className="font-semibold text-gray-700">To Date</Label>
      <Input
        id="endDate"
        type="date"
        value={filters.endDate}
        onChange={(e) => onFilterChange("endDate", e.target.value)}
        className="border-gray-300 focus:border-blue-500 bg-white"
      />
    </div>
  </ScrollableFilterBar>
));
FilterSection.displayName = "FilterSection";

interface StatsCardProps {
  title: string;
  value: string;
  icon: any;
  description?: string;
  subValue?: string;
}

const StatsCard = ({ title, value, icon: Icon, description, subValue }: StatsCardProps) => (
  <Card className="bg-white text-slate-900 shadow-lg border border-gray-200 relative overflow-hidden">
    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-purple-600"></div>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
      <CardTitle className="text-sm font-medium text-gray-400">{title}</CardTitle>
    </CardHeader>
    <CardContent className="pl-6 pb-4 flex flex-row">
      <div className="mr-2 rounded-full">
        <Icon className="h-8 w-8 text-blue-600" />
      </div>
      <div>
        <div className="text-xl font-bold text-green-500 mb-2">{value}</div>
        {subValue && <div className="text-sm font-medium text-slate-600 mb-2">{subValue}</div>}
        {description && <p className="text-[10px] mt-2 bg-orange-50 px-2 py-1 rounded-md border border-slate-100">{description}</p>}
      </div>
    </CardContent>
  </Card>
);

// --- MAIN PAGE COMPONENT ---
const LivestockOfftakePage = () => {
  const { userRole, userAttribute, allowedProgrammes } = useAuth();
  const { toast } = useToast();
  const auth = getAuth();

  // State
  const [allOfftake, setAllOfftake] = useState<OfftakeData[]>([]);
  const [filteredOfftake, setFilteredOfftake] = useState<OfftakeData[]>([]);
  const [localSearchInput, setLocalSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<any[]>([]);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isWeightEditDialogOpen, setIsWeightEditDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isBulkSmsDialogOpen, setIsBulkSmsDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSingleDeleteDialogOpen, setIsSingleDeleteDialogOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<OfftakeData | null>(null);
  const [editingRecord, setEditingRecord] = useState<OfftakeData | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<OfftakeData | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [bulkSmsMessage, setBulkSmsMessage] = useState("");
  const [bulkSmsSending, setBulkSmsSending] = useState(false);
  const [uploadFile, setUploadFile] = useState<File[] | null>(null);

  const [filters, setFilters] = useState<Filters>(() => {
    return createDefaultFilters();
  });
  // fetchRange represents the window actually requested from Firebase. It includes
  // only the current month by default to avoid expensive all-time reads, widens as
  // users request older dates, and only fetches all data when explicitly requested.
  const [fetchRange, setFetchRange] = useState<DateRangeBounds>(() => getDefaultOfftakeFetchDates());
  const [fetchMode, setFetchMode] = useState<FetchMode>("dateRange");
  const [quickRange, setQuickRange] = useState<QuickRangeKey>("thisMonth");
  const [filterResetKey, setFilterResetKey] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const processedKeysRef = useRef<Set<string>>(new Set());
  const skipNextSearchDebounceRef = useRef(false);

  const [stats, setStats] = useState<Stats>({
    totalRegions: 0,
    totalAnimals: 0,
    totalRevenue: 0,
    averageLiveWeight: 0,
    averageCarcassWeight: 0,
    averageRevenue: 0,
    totalFarmers: 0,
    totalSessions: 0,
    totalMaleFarmers: 0,
    totalFemaleFarmers: 0,
    avgPricePerCarcassKg: 0
  });

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });

  const [editForm, setEditForm] = useState<EditForm>({
    date: "",
    farmerName: "",
    gender: "",
    idNumber: "",
    phoneNumber: "",
    region: "",
    location: "",
    paidAt: ""
  });

  const [weightEditForm, setWeightEditForm] = useState<WeightEditForm>({
    liveWeights: [],
    carcassWeights: [],
    prices: []
  });

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

  // Debounce Search Input
  useEffect(() => {
    if (skipNextSearchDebounceRef.current) {
      skipNextSearchDebounceRef.current = false;
      return;
    }

    const delay = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: localSearchInput }));
      setPagination(prev => ({ ...prev, page: 1 }));
    }, 500);

    return () => clearTimeout(delay);
  }, [localSearchInput]);

  // CSV Line Parsing (Handles Quotes Safely)
  const parseCSVLine = (text: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const parseCSVFile = (file: File): Promise<any[]> => new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = text.split('\n').filter(r => r.trim() !== '');

      if (rows.length < 2) {
        toast({ title: "Error", description: "CSV file is empty or invalid.", variant: "destructive" });
        resolve([]);
        return;
      }

      const rawHeaders = parseCSVLine(rows[0]);
      const headers = rawHeaders.map(h => ({
        original: h.trim(),
        clean: h.trim().toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
      }));

      const findIndex = (keys: string[]) => headers.findIndex(h => keys.some(k => h.clean.includes(k)));

      const idxDate = findIndex(['date']);
      const idxName = findIndex(['farmer name', 'name']);
      const idxGender = findIndex(['gender']);
      const idxId = findIndex(['id number', 'idnumber', 'id']);
      const idxPhone = findIndex(['phone number', 'phone']);
      const idxCounty = findIndex(['county', 'region']);
      const idxSub = findIndex(['subcounty', 'sub county']);
      const idxLoc = findIndex(['location', 'village']);
      const idxProg = findIndex(['programme']);
      const idxUser = findIndex(['username', 'user']);
      const idxUserId = findIndex(['user id', 'offtake user id']);

      const idxPricePerAnimal = findIndex(['price per animal', 'price per goat', 'price per sheep']);
      const idxPrice = idxPricePerAnimal !== -1 ? idxPricePerAnimal : findIndex(['price']);
      const idxLive = headers.findIndex(h => h.clean.startsWith('live weight'));
      const idxCarcass = headers.findIndex(h => h.clean.startsWith('carcass weight'));

      const animalColumnMap = new Map<number, { live?: number; carcass?: number; price?: number; number?: number }>();
      headers.forEach((h, i) => {
        const match = h.clean.match(/(\d+)/);
        if (!match) return;
        const num = parseInt(match[1], 10);
        if (Number.isNaN(num)) return;

        const isLive = h.clean.includes('live weight');
        const isCarcass = h.clean.includes('carcass weight') || h.clean.includes('carcass');
        const isPrice = h.clean.includes('price');
        const isGoatNo = h.clean.includes('goat') && (h.clean.includes('number') || h.clean.includes('no'));

        if (!isLive && !isCarcass && !isPrice && !isGoatNo) return;
        const existing = animalColumnMap.get(num) || {};
        if (isLive) existing.live = i;
        if (isCarcass) existing.carcass = i;
        if (isPrice) existing.price = i;
        if (isGoatNo) existing.number = i;
        animalColumnMap.set(num, existing);
      });

      const animalColumnIndices = Array.from(animalColumnMap.keys()).sort((a, b) => a - b);
      const hasMultiAnimalColumns = animalColumnIndices.length > 0;
      const transactionsMap = new Map<string, any>();
      let lastTransactionKey: string | null = null;

      const buildGoatsFromMultiColumnRow = (cols: string[]) => {
        const goats: { live: string; carcass: string; price: string }[] = [];
        for (const idx of animalColumnIndices) {
          const col = animalColumnMap.get(idx);
          const liveVal = col?.live !== undefined ? cols[col.live] : '';
          const carcassVal = col?.carcass !== undefined ? cols[col.carcass] : '';
          const priceVal = col?.price !== undefined ? cols[col.price] : (idxPrice !== -1 ? cols[idxPrice] : '');

          if (![liveVal, carcassVal, priceVal].some(v => v && v.trim() !== '')) continue;
          goats.push({
            live: liveVal ? cleanNumber(liveVal).toFixed(1) : '',
            carcass: carcassVal ? cleanNumber(carcassVal).toFixed(2) : '',
            price: priceVal ? cleanNumber(priceVal).toFixed(2) : ''
          });
        }
        return goats;
      };

      const buildGoatsFromSingleRow = (cols: string[]) => {
        const goats: { live: string; carcass: string; price: string }[] = [];
        const liveVal = idxLive !== -1 ? cols[idxLive] : '';
        const carcassVal = idxCarcass !== -1 ? cols[idxCarcass] : '';
        const priceVal = idxPrice !== -1 ? cols[idxPrice] : '';

        if (![liveVal, carcassVal, priceVal].some(v => v && v.trim() !== '')) return goats;
        goats.push({
          live: liveVal ? cleanNumber(liveVal).toFixed(1) : '',
          carcass: carcassVal ? cleanNumber(carcassVal).toFixed(2) : '',
          price: priceVal ? cleanNumber(priceVal).toFixed(2) : ''
        });
        return goats;
      };

      for (let i = 1; i < rows.length; i++) {
        const cols = parseCSVLine(rows[i]);
        if (!cols || cols.every(c => !c.trim())) continue;

        const firstColVal = (cols[0] || '').trim().toUpperCase();
        if (firstColVal.startsWith('GRAND TOTAL') || firstColVal === 'TOTAL') continue;

        const rawId = idxId !== -1 ? cols[idxId]?.trim() : '';
        const rawDate = cols[idxDate]?.trim() || '';
        const hasFarmerDetails = [idxName, idxPhone, idxCounty, idxSub, idxLoc, idxProg].some((idx) => idx !== -1 && Boolean(cols[idx]?.trim()));
        const isHeaderRow = !!(rawDate && (!isMissingFarmerId(rawId) || hasFarmerDetails));

        const generatedSeed = `${rawDate}_${cols[idxName] || ''}_${cols[idxPhone] || ''}_${i}`;
        const id = resolveFarmerId(rawId, generatedSeed, {
          name: (cols[idxName] || '').trim(),
          phone: (cols[idxPhone] || '').trim(),
          location: (cols[idxLoc] || cols[idxCounty] || '').trim(),
        });
        const uniqueKey = isHeaderRow ? `${id}_${rawDate}` : (lastTransactionKey || '');
        if (!uniqueKey) continue;

        if (isHeaderRow && !transactionsMap.has(uniqueKey)) {
          const loc = (cols[idxLoc] || cols[idxCounty] || 'UNK').trim();
          const prefix = loc.substring(0, 3).toUpperCase();
          const generatedUserId = `${prefix}${Math.floor(1000 + Math.random() * 9000)}`;
          let formattedDate = rawDate;
          const parsedDate = parseDate(rawDate);
          if (parsedDate) {
            formattedDate = formatDateToLocal(parsedDate);
          }

          let rawPhone = (cols[idxPhone] || '').trim();
          if (rawPhone === '0' || rawPhone === '0.0') rawPhone = '';

          transactionsMap.set(uniqueKey, {
            date: formattedDate,
            name: (cols[idxName] || '').trim(),
            gender: (cols[idxGender] || '').trim(),
            idNumber: id,
            phone: rawPhone,
            county: (cols[idxCounty] || '').trim(),
            subcounty: (cols[idxSub] || '').trim(),
            location: loc,
            programme: (cols[idxProg] || activeProgram).trim(),
            username: (cols[idxUser] || '').trim() || auth.currentUser?.displayName || auth.currentUser?.email || 'admin',
            createdAt: parsedDate ? parsedDate.getTime() : 0,
            offtakeUserId: idxUserId !== -1 ? (cols[idxUserId] || '').trim() : generatedUserId,
            goats: []
          });
        }

        const transaction = transactionsMap.get(uniqueKey);
        if (!transaction) continue;
        lastTransactionKey = uniqueKey;

        const goats = hasMultiAnimalColumns ? buildGoatsFromMultiColumnRow(cols) : buildGoatsFromSingleRow(cols);
        goats.forEach(goat => transaction.goats.push(goat));
      }

      const transactions = Array.from(transactionsMap.values());
      if (transactions.length === 0) {
        toast({ title: "No Data", description: "No valid transactions found.", variant: "destructive" });
        resolve([]);
      } else {
        toast({ title: "Parsed Successfully", description: `Found ${transactions.length} transactions` });
        resolve(transactions);
      }
    };
    reader.readAsText(file);
  });

  // Realtime Subscriptions
  useEffect(() => {
    if (!activeProgram) {
      setAllOfftake([]);
      setLoading(false);
      return;
    }

    const programmeValues =
      activeProgram === ALL_PROGRAMMES_VALUE
        ? accessibleProgrammes
        : [activeProgram];

    if (programmeValues.length === 0) {
      setAllOfftake([]);
      setLoading(false);
      return;
    }

    const queryStartDate = fetchRange.startDate;
    const queryEndDate = fetchRange.endDate;

    setLoading(true);
    setAllOfftake([]);

    const handleMergedData = (data: Record<string, any> | null) => {
      if (!data || Object.keys(data).length === 0) {
        setAllOfftake([]);
        setLoading(false);
        return;
      }

      const missingIdUpdates: Record<string, string> = {};
      const accessibleProgrammeSet = new Set(accessibleProgrammes.map((programme) => normalizeProgramme(programme)).filter(Boolean));
      const offtakeList = Object.keys(data)
        .map((key) => {
          const { record, missingIdUpdate } = mapRawOfftakeRecord(key, data[key], activeProgram);
          if (missingIdUpdate) missingIdUpdates[`offtakes/${key}/idNumber`] = missingIdUpdate;
          return record;
        })
        .filter((record) => {
          if (userCanViewAllProgrammeData && activeProgram === ALL_PROGRAMMES_VALUE) return true;
          if (activeProgram === ALL_PROGRAMMES_VALUE) {
            return accessibleProgrammeSet.has(normalizeProgramme(record.programme));
          }
          return matchesActiveProgramme(record.programme, activeProgram);
        });

      if (Object.keys(missingIdUpdates).length > 0) {
        const newUpdates: Record<string, string> = {};
        for (const [path, idValue] of Object.entries(missingIdUpdates)) {
          const key = path.replace('offtakes/', '');
          if (!processedKeysRef.current.has(key)) {
            newUpdates[path] = idValue;
            processedKeysRef.current.add(key);
          }
        }
        if (Object.keys(newUpdates).length > 0) {
          update(ref(db), newUpdates).catch(err => console.error("Failed to backfill IDs:", err));
        }
      }

      setAllOfftake(sortOfftakeByLatest(offtakeList));
      setLoading(false);
    };

    const handleError = (error: Error) => {
      console.error(error);
      toast({ title: "Error", description: "Failed to load database stream.", variant: "destructive" });
      setLoading(false);
    };

    const unsubscribers = fetchMode === "all"
      ? [
          subscribeCollectionByProgrammes<Record<string, any>>(
            "offtakes",
            programmeValues,
            handleMergedData,
            handleError,
            { noDateFilter: true },
          ),
        ]
      : [
          subscribeCollectionByProgrammes<Record<string, any>>(
            "offtakes",
            programmeValues,
            handleMergedData,
            handleError,
            {
              dateField: "createdAt",
              dateValueType: "timestamp-ms" as const,
              startDate: queryStartDate,
              endDate: queryEndDate,
            },
          ),
        ];

    return () => {
      unsubscribers.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') unsubscribe();
      });
    };
  }, [accessibleProgrammes, activeProgram, fetchMode, fetchRange.endDate, fetchRange.startDate, toast, userCanViewAllProgrammeData]);

  // Filtering System
  useEffect(() => {
    if (allOfftake.length === 0) {
      setFilteredOfftake([]);
      setStats({
        totalRegions: 0, totalAnimals: 0, totalRevenue: 0, averageLiveWeight: 0,
        averageCarcassWeight: 0, averageRevenue: 0, totalFarmers: 0, totalSessions: 0,
        totalMaleFarmers: 0, totalFemaleFarmers: 0, avgPricePerCarcassKg: 0
      });
      return;
    }

    const filtered = allOfftake.filter(record => {
      if (filters.region !== "all" && record.region?.toLowerCase() !== filters.region.toLowerCase()) return false;
      if (filters.gender !== "all" && record.gender?.toLowerCase() !== filters.gender.toLowerCase()) return false;

      if (filters.startDate || filters.endDate) {
        const parsedRecordDate = parseDate(getOfftakeDateValue(record));
        const recordTimestamp = parsedRecordDate ? parsedRecordDate.getTime() : (record.createdAt || 0);
        if (!recordTimestamp) return false;

        const recordDateOnly = new Date(recordTimestamp);
        recordDateOnly.setHours(0, 0, 0, 0);

        const startDate = filters.startDate ? parseDateInputValue(filters.startDate) : null;
        const endDate = filters.endDate ? parseDateInputValue(filters.endDate) : null;

        if (startDate) startDate.setHours(0, 0, 0, 0);
        if (endDate) endDate.setHours(23, 59, 59, 999);

        if (startDate && recordDateOnly < startDate) return false;
        if (endDate && recordDateOnly > endDate) return false;
      }

      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        return [record.farmerName, record.location, record.region, record.subcounty, record.idNumber, record.phoneNumber, record.offtakeUserId]
          .some(field => field?.toLowerCase().includes(searchTerm));
      }
      return true;
    });

    const sortedFiltered = sortOfftakeByLatest(filtered);
    setFilteredOfftake(sortedFiltered);

    const totalAnimals = sortedFiltered.reduce((sum, r) => sum + (r.noSheepGoats || 0), 0);
    const totalRevenue = sortedFiltered.reduce((sum, r) => sum + (r.totalprice || 0), 0);
    const uniqueRegions = new Set(sortedFiltered.map(f => f.region).filter(Boolean));

    // Group records by farmer (via idNumber, falling back to record id) so that a farmer
    // who appears in the filtered set multiple times - e.g. because a search matched
    // several of their sale records - is only counted once as a "farmer", while every
    // one of their matching records still counts as a "session" (a time they sold).
    const farmerMap = new Map<string, { gender: string }>();
    sortedFiltered.forEach(r => {
      const key = getFarmerGroupingKey(r);
      if (!farmerMap.has(key)) {
        farmerMap.set(key, { gender: r.gender || '' });
      }
    });

    let totalMaleFarmers = 0, totalFemaleFarmers = 0;
    farmerMap.forEach(f => {
      if (f.gender?.toLowerCase() === 'male') totalMaleFarmers++;
      else if (f.gender?.toLowerCase() === 'female') totalFemaleFarmers++;
    });

    const totalLiveWeight = sortedFiltered.reduce((sum, r) => sum + calculateTotal(r.liveWeight), 0);
    const totalCarcassWeight = sortedFiltered.reduce((sum, r) => sum + calculateTotal(r.carcassWeight), 0);

    setStats({
      totalRegions: uniqueRegions.size,
      totalAnimals,
      totalRevenue,
      averageLiveWeight: totalAnimals > 0 ? totalLiveWeight / totalAnimals : 0,
      averageCarcassWeight: totalAnimals > 0 ? totalCarcassWeight / totalAnimals : 0,
      averageRevenue: totalAnimals > 0 ? totalRevenue / totalAnimals : 0,
      totalFarmers: farmerMap.size,
      totalSessions: sortedFiltered.length,
      totalMaleFarmers,
      totalFemaleFarmers,
      avgPricePerCarcassKg: totalCarcassWeight > 0 ? totalRevenue / totalCarcassWeight : 0
    });

    const totalPages = Math.ceil(sortedFiltered.length / pagination.limit);
    const currentPage = Math.min(pagination.page, Math.max(1, totalPages));
    setPagination(prev => ({ ...prev, page: currentPage, totalPages, hasNext: currentPage < totalPages, hasPrev: currentPage > 1 }));
  }, [allOfftake, filters, pagination.limit]);

  // Handlers
  const handleProgramChange = (program: string) => {
    setActiveProgram(program);
    processedKeysRef.current.clear();
    const fresh = getDefaultOfftakeFetchDates();
    skipNextSearchDebounceRef.current = true;
    setFilters(createDefaultFilters(fresh));
    setFetchRange(fresh);
    setFetchMode("dateRange");
    setQuickRange("thisMonth");
    setLocalSearchInput("");
    setPagination(prev => ({ ...prev, page: 1 }));
    setSelectedRecords([]);
  };

  // Applies a concrete start/end date pair: updates the visible filter values and widens
  // the live fetch window to guarantee the requested range is actually loaded.
  const applyDateRange = useCallback((startDate: string, endDate: string) => {
    setFilters(prev => ({ ...prev, startDate, endDate }));
    setFetchMode("dateRange");
    setFetchRange(prev => unionDateRange(prev, startDate, endDate));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handleQuickRangeChange = useCallback((value: QuickRangeKey) => {
    setQuickRange(value);
    if (value === "custom") return;
    const range = getQuickRangeDates(value);
    if (range) applyDateRange(range.startDate, range.endDate);
  }, [applyDateRange]);

  const handleFilterChange = useCallback((key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    if (key === "startDate" || key === "endDate") {
      setQuickRange("custom");
      setFetchMode("dateRange");
      setFetchRange((current) => unionDateRange(
        current,
        key === "startDate" ? value : undefined,
        key === "endDate" ? value : undefined
      ));
    }
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handleLocalSearchChange = useCallback((value: string) => {
    setLocalSearchInput(value);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPagination(prev => {
      const totalPages = Math.ceil(filteredOfftake.length / prev.limit);
      const validatedPage = Math.max(1, Math.min(newPage, totalPages));
      return { ...prev, page: validatedPage, hasNext: validatedPage < totalPages, hasPrev: validatedPage > 1 };
    });
  }, [filteredOfftake.length]);

  const currentPageRecords = useMemo(() => {
    const startIndex = (pagination.page - 1) * pagination.limit;
    return filteredOfftake.slice(startIndex, startIndex + pagination.limit);
  }, [filteredOfftake, pagination.page, pagination.limit]);

  const handleSelectRecord = useCallback((recordId: string) => {
    setSelectedRecords(prev => prev.includes(recordId) ? prev.filter(id => id !== recordId) : [...prev, recordId]);
  }, []);

  const handleSelectAll = useCallback(() => {
    const currentPageIds = currentPageRecords.map(f => f.id);
    setSelectedRecords(prev => prev.length === currentPageIds.length ? [] : currentPageIds);
  }, [currentPageRecords]);

  // Exporters
  const handleExport = async () => {
    try {
      setExportLoading(true);
      if (filteredOfftake.length === 0) {
        toast({ title: "No Data to Export", description: "There are no records matching your filters", variant: "destructive" });
        return;
      }

      const headers = ['Date', 'Farmer Name', 'Gender', 'ID Number', 'Programme', 'Region (County)', 'Subcounty', 'Ward', 'Location', 'Phone Number', 'Offtake Type', 'Group Name', 'Representative', 'Farmer Count', 'Animal Type', 'Total Animals', 'Live Weight (kg)', 'Carcass Weight (kg)', 'Carcass Ratio', 'Price per Kg (KES)', 'Preview Price per Animal (KES)', 'Price per Animal (KES)', 'Preview Total Price (KES)', 'Total Price (KES)', 'Offtake User ID', 'Submitted By', 'Created At', 'Paid At'];
      const csvData: any[] = [];

      filteredOfftake.forEach(record => {
        const liveWeights = record.liveWeight || [];
        const carcassWeights = record.carcassWeight || [];
        const prices = record.pricePerGoatAndSheep || [];
        const numAnimals = Math.max(liveWeights.length, carcassWeights.length, prices.length, record.noSheepGoats || 1);

        for (let i = 0; i < numAnimals; i++) {
          csvData.push([
            i === 0 ? formatDate(record.date) : '',
            i === 0 ? (record.farmerName || 'N/A') : '',
            i === 0 ? (record.gender || 'N/A') : '',
            i === 0 ? (record.idNumber || 'N/A') : '',
            i === 0 ? (record.programme || 'N/A') : '',
            i === 0 ? (record.region || 'N/A') : '',
            i === 0 ? (record.subcounty || 'N/A') : '',
            i === 0 ? (record.ward || 'N/A') : '',
            i === 0 ? (record.location || 'N/A') : '',
            i === 0 ? (record.phoneNumber || 'N/A') : '',
            i === 0 ? (record.offtakeType || 'N/A') : '',
            i === 0 ? (record.groupName || 'N/A') : '',
            i === 0 ? (record.representative || 'N/A') : '',
            i === 0 ? (record.farmerCount || 0).toString() : '',
            i === 0 ? (record.animalType || 'N/A') : '',
            i === 0 ? (record.noSheepGoats || 0).toString() : '',
            liveWeights[i] > 0 ? liveWeights[i].toFixed(1) : '',
            carcassWeights[i] > 0 ? carcassWeights[i].toFixed(2) : '',
            i === 0 ? (record.carcassRatio || 0).toString() : '',
            i === 0 ? (record.pricePerKg || 0).toString() : '',
            record.previewPricePerAnimal[i] > 0 ? record.previewPricePerAnimal[i].toFixed(2) : '',
            prices[i] > 0 ? prices[i].toFixed(2) : '',
            i === 0 ? (record.previewTotalPrice || 0).toFixed(2) : '',
            i === 0 ? (record.totalprice || 0).toFixed(2) : '',
            i === 0 ? (record.offtakeUserId || 'N/A') : '',
            i === 0 ? (record.username || 'N/A') : '',
            i === 0 ? formatDateTime(record.createdAt) : '',
            i === 0 ? (record.paidAt ? formatDate(record.paidAt) : 'Not Paid') : ''
          ]);
        }
        csvData.push(Array(headers.length).fill(''));
      });

      const csvContent = [headers, ...csvData].map(row => row.map(f => `"${String(f ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `livestock-offtake-${activeProgram}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(err);
    } finally { setExportLoading(false); }
  };

  const handleExportAggregatedByFarmer = async () => {
    try {
      setExportLoading(true);
      if (filteredOfftake.length === 0) return;

      const groupedFarmers = new Map<string, any>();
      filteredOfftake.forEach((record) => {
        const groupKey = getFarmerGroupingKey(record);
        const existing = groupedFarmers.get(groupKey);
        const liveWeightSum = calculateTotal(record.liveWeight);
        const carcassWeightSum = calculateTotal(record.carcassWeight);

        if (!existing) {
          groupedFarmers.set(groupKey, {
            idNumber: record.idNumber || 'N/A', farmerName: record.farmerName || 'N/A', gender: record.gender || 'N/A',
            programme: record.programme || 'N/A', region: record.region || 'N/A', subcounty: record.subcounty || 'N/A',
            location: record.location || 'N/A', phoneNumber: record.phoneNumber || 'N/A', sessions: 1,
            totalAnimals: Number(record.noSheepGoats) || 0, totalLiveWeight: liveWeightSum, totalCarcassWeight: carcassWeightSum, totalRevenue: Number(record.totalprice) || 0
          });
        } else {
          existing.sessions += 1;
          existing.totalAnimals += Number(record.noSheepGoats) || 0;
          existing.totalLiveWeight += liveWeightSum;
          existing.totalCarcassWeight += carcassWeightSum;
          existing.totalRevenue += Number(record.totalprice) || 0;
        }
      });

      // "Average Price" is the farmer's overall revenue divided by the total number of
      // animals they sold across all their sessions - i.e. what they earned per animal
      // on average - rather than a lump total revenue figure.
      const headers = ['ID Number', 'Farmer Name', 'Gender', 'Programme', 'Region (County)', 'Subcounty', 'Location', 'Phone Number', 'Sessions', 'Total Animals', 'Total Live Weight (kg)', 'Total Carcass Weight (kg)', 'Average Price (KES)'];
      const csvRows = Array.from(groupedFarmers.values()).map(f => [
        f.idNumber, f.farmerName, f.gender, f.programme, f.region, f.subcounty, f.location, f.phoneNumber,
        f.sessions.toString(), f.totalAnimals.toString(), f.totalLiveWeight.toFixed(1), f.totalCarcassWeight.toFixed(2),
        (f.totalAnimals > 0 ? f.totalRevenue / f.totalAnimals : 0).toFixed(2)
      ]);

      const csvContent = [headers, ...csvRows].map(row => row.map(f => `"${f}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `aggregated-farmers-${activeProgram}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) { console.error(err); } finally { setExportLoading(false); }
  };

  const handleExportFarmerOfftakeSummary = async () => {
    try {
      setExportLoading(true);
      if (filteredOfftake.length === 0) return;

      const summaries = new Map<string, any>();
      filteredOfftake.forEach((record) => {
        const key = (record.farmerName || "N/A").trim().toLowerCase();
        const existing = summaries.get(key);
        const liveTotal = calculateTotal(record.liveWeight);
        const carcassTotal = calculateTotal(record.carcassWeight);

        if (!existing) {
          summaries.set(key, {
            farmerName: record.farmerName, latestDate: formatDate(record.date), latestTimestamp: getOfftakeTimestamp(record),
            totalAnimals: record.noSheepGoats, carcassWeightTotal: carcassTotal, carcassCount: record.carcassWeight.length,
            liveWeightTotal: liveTotal, liveCount: record.liveWeight.length, priceTotal: record.totalprice, priceCount: 1
          });
        } else {
          if (getOfftakeTimestamp(record) > existing.latestTimestamp) {
            existing.latestDate = formatDate(record.date);
            existing.latestTimestamp = getOfftakeTimestamp(record);
          }
          existing.totalAnimals += record.noSheepGoats;
          existing.carcassWeightTotal += carcassTotal;
          existing.carcassCount += record.carcassWeight.length;
          existing.liveWeightTotal += liveTotal;
          existing.liveCount += record.liveWeight.length;
          existing.priceTotal += record.totalprice;
          existing.priceCount += 1;
        }
      });

      const headers = ["Date", "Farmer Name", "Number of Animals", "Average Carcass Weight (kg)", "Average Live Weight (kg)", "Average Price (KES)"];
      const rows = Array.from(summaries.values()).map(s => [
        s.latestDate, s.farmerName, s.totalAnimals.toString(),
        (s.carcassCount > 0 ? s.carcassWeightTotal / s.carcassCount : 0).toFixed(2),
        (s.liveCount > 0 ? s.liveWeightTotal / s.liveCount : 0).toFixed(1),
        // Average Price is spread across every animal the farmer sold (not per session),
        // so it reflects the average price per animal rather than a lump total price.
        (s.totalAnimals > 0 ? s.priceTotal / s.totalAnimals : 0).toFixed(2)
      ]);

      const csvContent = [headers, ...rows].map(row => row.map(f => `"${f}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `farmer-summary-${activeProgram}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) { console.error(err); } finally { setExportLoading(false); }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    setUploadFile(files);
    setUploadProgress({ current: 0, total: 0 });
    const parsedSets = await Promise.all(files.map(parseCSVFile));
    setUploadPreview(parsedSets.flat());
  };

  const getUploadDateRange = (records: readonly any[]): DateRangeBounds | null => {
    const timestamps = records
      .map((record) => parseDate(record?.date)?.getTime() || Number(record?.createdAt || 0))
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
    if (timestamps.length === 0) return null;
    return {
      startDate: formatDateToLocal(new Date(Math.min(...timestamps))),
      endDate: formatDateToLocal(new Date(Math.max(...timestamps))),
    };
  };

  // Safe Non-Blocking Bulk Uploader
  const handleUpload = async () => {
    if (!requireAdmin()) return;
    if (uploadPreview.length === 0) {
      toast({ title: "Error", description: "No data to upload", variant: "destructive" });
      return;
    }

    try {
      setUploadLoading(true);
      const totalRecords = uploadPreview.length;
      setUploadProgress({ current: 0, total: totalRecords });

      const BATCH_SIZE = 100; // Smaller chunk sizes yield better UI responsiveness
      let processedCount = 0;
      const uploadedRecords: OfftakeData[] = [];

      const processBatch = async (startIndex: number) => {
        if (startIndex >= totalRecords) {
          const uploadedRange = getUploadDateRange(uploadedRecords.length > 0 ? uploadedRecords : uploadPreview);
          if (uploadedRange) {
            // Widen the fetch window (not overwrite) so uploaded data outside the
            // currently visible range is guaranteed to be included and visible.
            setFetchRange((current) => unionDateRange(current, uploadedRange.startDate, uploadedRange.endDate));
            setFilters((current) => ({ ...current, startDate: uploadedRange.startDate, endDate: uploadedRange.endDate }));
            setQuickRange("custom");
            setPagination((current) => ({ ...current, page: 1 }));
          }

          setUploadLoading(false);
          setIsUploadDialogOpen(false);
          setUploadFile(null);
          setUploadPreview([]);
          setUploadProgress({ current: 0, total: 0 });
          toast({ title: "Upload Successful", description: `Uploaded ${uploadedRecords.length} transactions successfully.` });
          return;
        }

        const endIndex = Math.min(startIndex + BATCH_SIZE, totalRecords);
        const batch = uploadPreview.slice(startIndex, endIndex);
        const uploadedInBatch: OfftakeData[] = [];

        // Correctly handling mapping via async Promise awaiting
        await Promise.all(batch.map(async (record) => {
          try {
            const totalGoats = record.goats.length;
            const totalPrice = record.goats.reduce((sum: number, g: any) => sum + (parseFloat(g.price) || 0), 0);
            const generatedCreatedAt = record.createdAt || Date.now();

            const resolvedProg =
              normalizeProgramme(record.programme) ||
              (activeProgram !== ALL_PROGRAMMES_VALUE ? normalizeProgramme(activeProgram) : "") ||
              normalizeProgramme(accessibleProgrammes[0]);

            if (!resolvedProg) {
              throw new Error("No valid programme selected for uploaded offtake record.");
            }

            const recordData = {
              county: record.county,
              createdAt: generatedCreatedAt,
              date: record.date,
              gender: record.gender,
              idNumber: record.idNumber,
              location: record.location,
              name: record.name,
              offtakeUserId: record.offtakeUserId,
              phone: record.phone,
              programme: resolvedProg,
              Programme: resolvedProg,
              subcounty: record.subcounty,
              username: record.username,
              totalGoats,
              totalPrice,
              goats: record.goats,
              paidAt: record.paidAt || null
            };

            const newRef = await push(ref(db, 'offtakes'), recordData);
            const newKey = newRef?.key;
            if (!newKey) return;

            uploadedInBatch.push({
              id: newKey,
              date: parseDate(recordData.date) || recordData.date,
              farmerName: String(recordData.name || ""),
              gender: String(recordData.gender || ""),
              idNumber: String(recordData.idNumber || ""),
              liveWeight: record.goats.map((g: any) => parseFloat(g.live) || 0),
              carcassWeight: record.goats.map((g: any) => parseFloat(g.carcass) || 0),
              location: String(recordData.location || ""),
              noSheepGoats: Number(totalGoats || 0),
              phoneNumber: String(recordData.phone || ""),
              pricePerGoatAndSheep: record.goats.map((g: any) => parseFloat(g.price) || 0),
              region: String(recordData.county || ""),
              programme: String(resolvedProg),
              subcounty: String(recordData.subcounty || ""),
              username: String(recordData.username || ""),
              offtakeUserId: String(recordData.offtakeUserId || ""),
              totalprice: Number(totalPrice || 0),
              createdAt: Number(generatedCreatedAt),
              paidAt: recordData.paidAt || ""
            });
          } catch (err) { console.error("Error pushing single record:", err); }
        }));

        if (uploadedInBatch.length > 0) {
          uploadedRecords.push(...uploadedInBatch);
          setAllOfftake((current) => {
            const nextById = new Map(current.map((r) => [r.id, r]));
            uploadedInBatch.forEach((r) => nextById.set(r.id, r));
            return sortOfftakeByLatest(Array.from(nextById.values()));
          });
          processedCount += uploadedInBatch.length;
          setUploadProgress({ current: processedCount, total: totalRecords });
        }

        setTimeout(() => processBatch(endIndex), 0);
      };

      await processBatch(0);
    } catch (error) {
      console.error(error);
      setUploadLoading(false);
      toast({ title: "Upload Failed", description: "Internal submission error.", variant: "destructive" });
    }
  };

  // Dialog Toggles
  const openViewDialog = useCallback((record: OfftakeData) => { setViewingRecord(record); setIsViewDialogOpen(true); }, []);
  const openEditDialog = useCallback((record: OfftakeData) => {
    if (!userIsAdmin) return;
    setViewingRecord(record);
    setEditForm({
      date: formatDateForInput(record.date), farmerName: record.farmerName || "", gender: record.gender || "",
      idNumber: record.idNumber || "", phoneNumber: record.phoneNumber || "", region: record.region || "", location: record.location || "",
      paidAt: formatDateForInput(record.paidAt)
    });
    setIsEditDialogOpen(true);
  }, [userIsAdmin]);

  const openWeightEditDialog = useCallback((record: OfftakeData) => {
    if (!userIsAdmin) return;
    setViewingRecord(record);
    const live = record.liveWeight || [];
    const carcass = record.carcassWeight || [];
    const prices = record.pricePerGoatAndSheep || [];
    const len = Math.max(live.length, carcass.length, prices.length, record.noSheepGoats || 1);

    const pad = (arr: number[]) => [...arr, ...Array(Math.max(0, len - arr.length)).fill(0)];
    setWeightEditForm({ liveWeights: pad(live), carcassWeights: pad(carcass), prices: pad(prices) });
    setIsWeightEditDialogOpen(true);
  }, [userIsAdmin]);

  const openSingleDeleteConfirm = useCallback((record: OfftakeData) => { if (!userIsAdmin) return; setRecordToDelete(record); setIsSingleDeleteDialogOpen(true); }, [userIsAdmin]);
  const openBulkDeleteConfirm = () => { if (requireAdmin() && selectedRecords.length > 0) setIsDeleteConfirmOpen(true); };
  const openBulkSmsDialog = () => { if (selectedRecords.length > 0) setIsBulkSmsDialogOpen(true); };

  const handleSingleDelete = async () => {
    if (!requireAdmin() || !recordToDelete) return;
    try {
      setDeleteLoading(true);
      await remove(ref(db, `offtakes/${recordToDelete.id}`));
      setAllOfftake(curr => curr.filter(r => r.id !== recordToDelete.id));
      setSelectedRecords(p => p.filter(id => id !== recordToDelete.id));
      setIsSingleDeleteDialogOpen(false);
      toast({ title: "Success", description: "Record deleted" });
    } catch (err) { console.error(err); } finally { setDeleteLoading(false); }
  };

  const handleDeleteMultiple = async () => {
    if (!requireAdmin() || selectedRecords.length === 0) return;
    try {
      setDeleteLoading(true);
      await Promise.all(selectedRecords.map(id => remove(ref(db, `offtakes/${id}`))));
      const targetSet = new Set(selectedRecords);
      setAllOfftake(curr => curr.filter(r => !targetSet.has(r.id)));
      setSelectedRecords([]);
      setIsDeleteConfirmOpen(false);
      toast({ title: "Success", description: "Bulk items purged" });
    } catch (err) { console.error(err); } finally { setDeleteLoading(false); }
  };

  const handleSendBulkSms = async () => {
    const msg = bulkSmsMessage.trim();
    if (!msg) return;
    setBulkSmsSending(true);
    try {
      const activeSet = new Set(selectedRecords);
      const targets = allOfftake.filter(r => activeSet.has(r.id));
      const numbers = Array.from(new Set(targets.map(t => t.phoneNumber).filter(Boolean)));

      if (numbers.length === 0) {
        toast({ title: "Failure", description: "No valid destination phone lines found", variant: "destructive" });
        return;
      }

      const result = await sendBulkSms(numbers, msg);

      setIsBulkSmsDialogOpen(false);
      setBulkSmsMessage("");
      toast({
        title: result.failureCount > 0 ? "SMS Partially Sent" : "SMS Sent",
        description: `Sent ${result.successCount} SMS${result.successCount === 1 ? "" : "es"}${result.failureCount ? `, ${result.failureCount} failed.` : "."}`,
        variant: result.successCount === 0 ? "destructive" : "default",
      });
    } catch (err) { console.error(err); } finally { setBulkSmsSending(false); }
  };

  const handleEditSubmit = async () => {
    if (!requireAdmin() || !viewingRecord) return;
    try {
      // Direct formatted assignment string helps parsing correctly
      const updatePayload = {
        date: editForm.date ? editForm.date : null,
        name: editForm.farmerName, gender: editForm.gender, idNumber: editForm.idNumber,
        phone: editForm.phoneNumber, county: editForm.region, location: editForm.location,
        paidAt: editForm.paidAt ? editForm.paidAt : null
      };
      await update(ref(db, `offtakes/${viewingRecord.id}`), updatePayload);
      setIsEditDialogOpen(false);
      toast({ title: "Success", description: "Farmer updates committed." });
    } catch (err) { console.error(err); }
  };

  const handleWeightEditSubmit = async () => {
    if (!requireAdmin() || !viewingRecord) return;
    try {
      const live = weightEditForm.liveWeights.filter(w => w > 0);
      const carcass = weightEditForm.carcassWeights.filter(w => w > 0);
      const prices = weightEditForm.prices.filter(p => p > 0);

      const combinedGoats = live.map((l, i) => ({
        live: String(l.toFixed(1)), carcass: String((carcass[i] || 0).toFixed(2)), price: String((prices[i] || 0).toFixed(2))
      }));
      const totalCost = prices.reduce((a, b) => a + b, 0);

      await update(ref(db, `offtakes/${viewingRecord.id}`), { goats: combinedGoats, totalGoats: combinedGoats.length, totalPrice: totalCost });
      setIsWeightEditDialogOpen(false);
      toast({ title: "Success", description: "Animal aggregates adjusted successfully" });
    } catch (err) { console.error(err); }
  };

  const clearAllFilters = useCallback(() => {
    skipNextSearchDebounceRef.current = true;
    setFilters({ search: "", startDate: "", endDate: "", region: "all", gender: "all" });
    setFetchRange(getQuickRangeDates("allTime") ?? getCurrentMonthDates());
    setFetchMode("all");
    setQuickRange("allTime");
    setLocalSearchInput("");
    setFilterResetKey((current) => current + 1);
    setPagination(prev => ({ ...prev, page: 1 }));
    setSelectedRecords([]);
  }, []);

  const resetToCurrentMonth = useCallback(() => {
    const fresh = getCurrentMonthDates();
    setFilters(prev => ({ ...prev, startDate: fresh.startDate, endDate: fresh.endDate }));
    setFetchRange(fresh);
    setFetchMode("dateRange");
    setQuickRange("thisMonth");
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const uniqueRegions = useMemo(() => [...new Set(allOfftake.map(f => f.region).filter(Boolean))], [allOfftake]);
  const uniqueGenders = useMemo(() => [...new Set(allOfftake.map(f => f.gender).filter(Boolean))], [allOfftake]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-md font-bold mb-2 bg-gradient-to-r from-green-600 to-emerald-700 bg-clip-text text-transparent">
            Livestock Offtake Data
          </h2>
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-bold px-3 py-1 w-fit">
            {activeProgram === ALL_PROGRAMMES_VALUE ? "ALL PROGRAMMES" : `${activeProgram} PROGRAMME`}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2 items-center w-full xl:w-auto">
          {accessibleProgrammes.length > 1 && (
            <div className="mr-4">
              <Select value={activeProgram} onValueChange={handleProgramChange}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white w-full sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROGRAMMES_VALUE}>All Programmes</SelectItem>
                  {accessibleProgrammes.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedRecords.length > 0 && isAdmin(userRole) && (
            <Button variant="destructive" size="sm" onClick={openBulkDeleteConfirm} disabled={deleteLoading} className="text-xs">
              <Trash2 className="h-4 w-4 mr-2" /> Delete ({selectedRecords.length})
            </Button>
          )}
          {selectedRecords.length > 0 && (
            <Button variant="outline" size="sm" onClick={openBulkSmsDialog} className="text-xs border-green-300 text-green-700 hover:bg-green-50">
              <Phone className="h-4 w-4 mr-2" /> Send SMS ({selectedRecords.length})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={clearAllFilters} className="text-xs border-gray-300 hover:bg-gray-50">Clear Filters</Button>
          <Button variant="outline" size="sm" onClick={resetToCurrentMonth} className="text-xs border-gray-300 hover:bg-gray-50">This Month</Button>
          <Button variant="outline" size="sm" onClick={() => setIsUploadDialogOpen(true)} className="text-xs border-green-300 text-green-700 hover:bg-green-50">
            <Upload className="h-4 w-4 mr-2" /> Upload Data
          </Button>

          {isAdmin(userRole) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={exportLoading || filteredOfftake.length === 0} className="bg-green-600 text-white shadow-md hover:bg-green-700 text-xs">
                  <Download className="h-4 w-4 mr-2" /> {exportLoading ? "Exporting..." : `Export (${filteredOfftake.length})`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onSelect={handleExport}><Download className="h-4 w-4 mr-2" /> Export Detailed Data</DropdownMenuItem>
                <DropdownMenuItem onSelect={handleExportAggregatedByFarmer}><Users className="h-4 w-4 mr-2" /> Export Summed by Farmer ID</DropdownMenuItem>
                <DropdownMenuItem onSelect={handleExportFarmerOfftakeSummary}><Users className="h-4 w-4 mr-2" /> Export Farmer Summary</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard
          title="TOTAL FARMERS"
          value={stats.totalFarmers.toLocaleString()}
          icon={Users}
          subValue={`${stats.totalSessions.toLocaleString()} Session${stats.totalSessions === 1 ? '' : 's'}`}
          description={`${stats.totalMaleFarmers} Males | ${stats.totalFemaleFarmers} Females`}
        />
        <StatsCard title="ANIMALS PURCHASED" value={stats.totalAnimals.toLocaleString()} icon={Scale} description={`Avg Live: ${stats.averageLiveWeight.toFixed(1)}kg | Avg Carcass: ${stats.averageCarcassWeight.toFixed(1)}kg`} />
        <StatsCard title="PURCHASE COST" value={safeTruncate(formatCurrency(stats.totalRevenue))} icon={CreditCard} description={`Avg Price: ${formatCurrency(stats.averageRevenue)} | Avg per Kg: ${formatCurrency(stats.avgPricePerCarcassKg)}`} />
      </div>

      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="space-y-4 pt-6">
          <FilterSection
            key={filterResetKey}
            localSearchInput={localSearchInput}
            filters={filters}
            quickRange={quickRange}
            uniqueRegions={uniqueRegions}
            uniqueGenders={uniqueGenders}
            onSearchChange={handleLocalSearchChange}
            onFilterChange={handleFilterChange}
            onQuickRangeChange={handleQuickRangeChange}
          />
        </CardContent>
      </Card>

      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-muted-foreground mt-2">Loading stream allocations...</p>
            </div>
          ) : currentPageRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No matching livestock profiles active.</div>
          ) : (
            <>
              <div className="w-full overflow-x-auto rounded-md">
                <table className="w-full border-collapse border border-gray-300 text-sm text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-green-100 text-green-900">
                      <th className="py-2 px-4">
                        <Checkbox checked={selectedRecords.length === currentPageRecords.length && currentPageRecords.length > 0} onCheckedChange={handleSelectAll} />
                      </th>
                      <th className="py-1 px-6 font-medium text-green-900">Date</th>
                      <th className="py-1 px-6 font-medium text-green-900">Farmer Name</th>
                      <th className="py-1 px-6 font-medium text-green-900">Gender</th>
                      <th className="py-1 px-6 font-medium text-green-900">ID No</th>
                      <th className="py-1 px-6 font-medium text-green-900">County</th>
                      <th className="py-1 px-6 font-medium text-green-900">Sub County</th>
                      <th className="py-1 px-6 font-medium text-green-900">No.Animals</th>
                      <th className="py-1 px-6 font-medium text-green-900">Total Price</th>
                      {/* <th className="py-1 px-6 font-medium text-gray-600">Submitted By</th> */}
                      {/* <th className="py-1 px-6 font-medium text-gray-600">Created At</th> */}
                      {/* <th className="py-2 px-4 font-medium text-gray-600">Paid At</th> */}
                      <th className="py-1 px-6 font-medium text-green-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageRecords.map((record) => (
                      <tr key={record.id} className="border-b hover:bg-green-50 transition-all text-sm">
                        <td className="py-1 px-4">
                          <Checkbox checked={selectedRecords.includes(record.id)} onCheckedChange={() => handleSelectRecord(record.id)} />
                        </td>
                        <td className="py-1 px-6 text-xs">{formatDate(record.date)}</td>
                        <td className="py-1 px-6 text-xs">{record.farmerName || 'N/A'}</td>
                        <td className="py-1 px-6 text-xs">{record.gender || 'N/A'}</td>
                        <td className="py-1 px-6 text-xs">
                          <code className="text-sm bg-gray-100 px-2 py-1 rounded text-gray-700">{record.idNumber || record.offtakeUserId || 'N/A'}</code>
                        </td>
                        <td className="py-1 px-6 text-xs">{record.region || 'N/A'}</td>
                        <td className="py-1 px-6 text-xs">{record.subcounty || 'N/A'}</td>
                        <td className="py-1 px-6 text-xs font-bold">{record.noSheepGoats || 0}</td>
                        <td className="py-1 px-6 text-xs font-bold text-green-600">{formatCurrency(record.totalprice || 0)}</td>
                        {/* <td className="py-1 px-6 text-xs">{record.username || 'N/A'}</td> */}
                        {/* <td className="py-1 px-6 text-xs">{formatDateTime(record.createdAt)}</td> */}
                        {/* <td className="py-1 px-6 text-xs">
                          {record.paidAt ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-normal">
                              {formatDate(record.paidAt)}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 font-normal">
                              Not Paid
                            </Badge>
                          )}
                        </td> */}
                        <td className="py-1 px-6 text-xs">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => openViewDialog(record)} className="h-8 w-8 p-0 hover:bg-green-100 border-green-200">
                              <Eye className="h-4 w-4 text-green-500" />
                            </Button>
                            {isAdmin(userRole) && (
                              <>
                                <Button variant="outline" size="sm" onClick={() => openEditDialog(record)} className="h-8 w-8 p-0 hover:bg-yellow-100 border-white">
                                  <Edit className="h-4 w-4 text-orange-500" />
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => openSingleDeleteConfirm(record)} className="h-8 w-8 p-0 hover:bg-red-100 border-white">
                                  <Trash2 className="h-4 w-4 text-red-500" />
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
              <div className="flex items-center justify-between p-4 border-t bg-gray-50">
                <div className="text-sm text-muted-foreground">{filteredOfftake.length} records - Page {pagination.page} of {pagination.totalPages}</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => handlePageChange(pagination.page - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => handlePageChange(pagination.page + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-4xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-slate-900"><Eye className="h-5 w-5 text-green-600" /> Livestock Offtake Details</DialogTitle></DialogHeader>
          {viewingRecord && (
            <div className="space-y-6 py-4 overflow-y-auto max-h-[60vh]">
              <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-blue-50/50 p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-200">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-11 w-11 shrink-0 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-semibold">
                      {(viewingRecord.farmerName || '?').trim().charAt(0).toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-slate-900 leading-tight truncate">{viewingRecord.farmerName || 'N/A'}</p>
                      <p className="text-xs text-slate-500">{viewingRecord.gender || 'N/A'} Farmer</p>
                    </div>
                  </div>

                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {[
                    { label: "ID Number", value: viewingRecord.idNumber || 'N/A', icon: CreditCard },
                    { label: "County", value: viewingRecord.region || 'N/A', icon: MapPin },
                    { label: "Subcounty", value: viewingRecord.subcounty || 'N/A', icon: MapPin },
                    { label: "Ward", value: viewingRecord.ward || 'N/A', icon: MapPin },
                    { label: "Location", value: viewingRecord.location || 'N/A', icon: MapPin },
                    { label: "Offtake Type", value: viewingRecord.offtakeType || 'N/A', icon: Users },
                    { label: "Group Name", value: viewingRecord.groupName || 'N/A', icon: Users },
                    { label: "Representative", value: viewingRecord.representative || 'N/A', icon: Users },
                    { label: "Farmer Count", value: viewingRecord.farmerCount || 'N/A', icon: Users },
                    { label: "Animal Type", value: viewingRecord.animalType || 'N/A', icon: Scale },
                    { label: "Carcass Ratio", value: viewingRecord.carcassRatio ? `${viewingRecord.carcassRatio}` : 'N/A', icon: Weight },
                    { label: "Price per Kg", value: viewingRecord.pricePerKg ? formatCurrency(viewingRecord.pricePerKg) : 'N/A', icon: CreditCard },
                    { label: "Preview Total Price", value: viewingRecord.previewTotalPrice ? formatCurrency(viewingRecord.previewTotalPrice) : 'N/A', icon: CreditCard },
                    { label: "Total Price", value: formatCurrency(viewingRecord.totalprice || 0), icon: CreditCard },
                    { label: "Offtake User ID", value: viewingRecord.offtakeUserId || 'N/A', icon: CreditCard },
                    { label: "Avg Carcass Wt", value: `${calculateAverage(viewingRecord.carcassWeight).toFixed(2)} kg`, icon: Weight },
                    { label: "Avg Live Wt", value: `${calculateAverage(viewingRecord.liveWeight).toFixed(1)} kg`, icon: Scale },
                    { label: "Submitted By", value: viewingRecord.username || 'N/A', icon: Users },
                    { label: "Created At", value: formatDateTime(viewingRecord.createdAt), icon: Calendar },
                    { label: "Paid At", value: viewingRecord.paidAt ? formatDate(viewingRecord.paidAt) : 'Not Paid', icon: CreditCard },
                  ].map((field) => (
                    <div key={field.label} className="bg-white rounded-lg border border-slate-100 p-3 shadow-sm">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-green-700 mb-1.5">
                        <field.icon className="h-3 w-3" /> {field.label}
                      </div>
                      <p className="text-sm font-semibold text-slate-800 break-words">{field.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Weight className="h-4 w-4" /> Animal Details Table</h3>
                  {isAdmin(userRole) && <Button variant="outline" size="sm" onClick={() => openWeightEditDialog(viewingRecord)}><Edit className="h-4 w-4 mr-2" /> Edit Weights</Button>}
                </div>
                <table className="w-full border border-gray-300 text-sm">
                  <thead>
                    <tr className="bg-green-100 text-green-900">
                      <th className="border p-2 text-left">Animal #</th>
                      <th className="border p-2 text-left">Live Weight (kg)</th>
                      <th className="border p-2 text-left">Carcass Weight (kg)</th>
                      <th className="border p-2 text-left">Preview Price (Ksh)</th>
                      <th className="border p-2 text-left">Price (Ksh)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingRecord.liveWeight.map((_, index) => (
                      <tr key={index} className="border-b">
                        <td className="p-2">Animal {index + 1}</td>
                        <td className="p-2">{viewingRecord.liveWeight[index]?.toFixed(1)}</td>
                        <td className="p-2">{viewingRecord.carcassWeight[index]?.toFixed(2) || 'N/A'}</td>
                        <td className="p-2">{formatCurrency(viewingRecord.previewPricePerAnimal[index] || 0)}</td>
                        <td className="p-2 text-green-700 font-medium">{formatCurrency(viewingRecord.pricePerGoatAndSheep[index] || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={() => setIsViewDialogOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Form Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl">
          <DialogHeader><DialogTitle><Edit className="h-5 w-5 text-green-600 inline mr-2" />Edit Record</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Date</Label><Input type="date" value={editForm.date} onChange={(e) => setEditForm(p => ({ ...p, date: e.target.value }))} /></div>
              <div><Label>Name</Label><Input value={editForm.farmerName} onChange={(e) => setEditForm(p => ({ ...p, farmerName: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Gender</Label>
                <Select value={editForm.gender} onValueChange={(v) => setEditForm(p => ({ ...p, gender: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>ID Number</Label><Input value={editForm.idNumber} onChange={(e) => setEditForm(p => ({ ...p, idNumber: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Paid At</Label>
                <Input type="date" value={editForm.paidAt} onChange={(e) => setEditForm(p => ({ ...p, paidAt: e.target.value }))} />
                <p className="text-[11px] text-gray-400 mt-1">Leave blank if the farmer hasn't been paid yet.</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSubmit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Weights Matrix adjustment dialog */}
      <Dialog open={isWeightEditDialogOpen} onOpenChange={setIsWeightEditDialogOpen}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader><DialogTitle>Adjust Live & Carcass Metrics</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
            <table className="w-full border text-sm">
              <thead>
                <tr className="bg-green-100 text-green-900">
                  <th className="p-2 text-left">Animal</th>
                  <th className="p-2 text-left">Live Weight (kg)</th>
                  <th className="p-2 text-left">Carcass Weight (kg)</th>
                  <th className="p-2 text-left">Price (KES)</th>
                </tr>
              </thead>
              <tbody>
                {weightEditForm.liveWeights.map((_, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="p-2">#{idx+1}</td>
                    <td className="p-2">
                      <Input type="number" value={weightEditForm.liveWeights[idx] || 0} onChange={(e) => {
                        const next = [...weightEditForm.liveWeights]; next[idx] = parseFloat(e.target.value) || 0;
                        setWeightEditForm(p => ({ ...p, liveWeights: next }));
                      }} />
                    </td>
                    <td className="p-2">
                      <Input type="number" value={weightEditForm.carcassWeights[idx] || 0} onChange={(e) => {
                        const next = [...weightEditForm.carcassWeights]; next[idx] = parseFloat(e.target.value) || 0;
                        setWeightEditForm(p => ({ ...p, carcassWeights: next }));
                      }} />
                    </td>
                    <td className="p-2">
                      <Input type="number" value={weightEditForm.prices[idx] || 0} onChange={(e) => {
                        const next = [...weightEditForm.prices]; next[idx] = parseFloat(e.target.value) || 0;
                        setWeightEditForm(p => ({ ...p, prices: next }));
                      }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsWeightEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleWeightEditSubmit}>Commit Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle><Upload className="h-5 w-5 inline mr-2" />Upload CSV Data</DialogTitle>
            <DialogDescription>Select row-spanning files. Quantities and dates will update active layout filtering automatically.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input id="csvUpload" type="file" accept=".csv" multiple ref={fileInputRef} onChange={handleFileSelect} disabled={uploadLoading} />
            {uploadLoading && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-500"><span>Streaming batches to cloud storage...</span><span>{uploadProgress.current} / {uploadProgress.total}</span></div>
                <div className="w-full bg-slate-100 h-2 rounded-full"><div className="bg-green-600 h-2 rounded-full transition-all duration-300" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}></div></div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { if(!uploadLoading) setIsUploadDialogOpen(false); }}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploadLoading || uploadPreview.length === 0}>
              {uploadLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Upload Processing Chunk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete/Purge Confirmations */}
      <Dialog open={isSingleDeleteDialogOpen} onOpenChange={setIsSingleDeleteDialogOpen}>
        <DialogContent className="bg-white rounded-xl">
          <DialogHeader><DialogTitle className="text-red-500">Confirm purge allocation</DialogTitle></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSingleDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleSingleDelete} disabled={deleteLoading}>Purge permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="bg-white rounded-xl">
          <DialogHeader><DialogTitle className="text-red-500">Confirm bulk removal</DialogTitle></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteMultiple} disabled={deleteLoading}>Purge targets</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk SMS */}
      <Dialog open={isBulkSmsDialogOpen} onOpenChange={setIsBulkSmsDialogOpen}>
        <DialogContent className="bg-white rounded-2xl">
          <DialogHeader><DialogTitle>Send Bulk SMS</DialogTitle></DialogHeader>
          <Textarea rows={4} value={bulkSmsMessage} onChange={e => setBulkSmsMessage(e.target.value)} placeholder="Type communication details explicitly..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkSmsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSendBulkSms} disabled={bulkSmsSending}>{bulkSmsSending ? "Sending..." : "Send SMS"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LivestockOfftakePage;

