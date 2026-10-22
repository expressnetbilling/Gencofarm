import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  HeartPulse,
  Lightbulb,
  Loader2,
  PackageCheck,
  Plus,
  Sprout,
  TrendingDown,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { push, ref } from "firebase/database";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db, fetchCollection, type DatabaseRecord } from "@/lib/firebase";
import {
  ALL_PROGRAMMES_VALUE,
  normalizeProgramme,
  type ProgrammeOption,
} from "@/lib/programme-access";

const INSIGHTS_PATH = "dashboardInsights";

const INSIGHT_FIELD_OPTIONS = [
  { value: "farmers", label: "Livestock Farmers" },
  { value: "capacityBuilding", label: "Capacity Building" },
  { value: "livestock", label: "Livestock" },
  { value: "hayStorage", label: "Hay Storage" },
  { value: "offtake", label: "Offtake" },
  { value: "animalHealth", label: "Animal Health" },
] as const;

const INSIGHT_ICON_OPTIONS = [
  { value: "increase", label: "Increase", icon: TrendingUp, color: "text-emerald-500" },
  { value: "decrease", label: "Decrease", icon: TrendingDown, color: "text-rose-500" },
  { value: "up", label: "Positive change", icon: ArrowUp, color: "text-blue-500" },
  { value: "down", label: "Negative change", icon: ArrowDown, color: "text-orange-500" },
  { value: "deviation", label: "Deviation", icon: Activity, color: "text-violet-500" },
  { value: "status", label: "Status", icon: BarChart3, color: "text-amber-500" },
] as const;

type InsightField = (typeof INSIGHT_FIELD_OPTIONS)[number]["value"];

type DashboardInsightRecord = DatabaseRecord<{
  date?: string;
  insight?: string;
  field?: InsightField | string;
  fieldLabel?: string;
  programme?: string;
  createdAt?: number;
  createdBy?: string;
  createdByUid?: string;
  icon?: string;
}>;

type DashboardInsightsProps = {
  allowAdd?: boolean;
  accessibleProgrammes: readonly string[];
  selectedProgramme?: string | null;
  dateRange?: { startDate?: string; endDate?: string } | null;
  title?: string;
  description?: string;
  className?: string;
  maxRows?: number;
};

const formatDateToLocal = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const parseDateValue = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const getCurrentMonthRange = () => {
  const now = new Date();
  return {
    startDate: formatDateToLocal(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: formatDateToLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

const isDateWithinRange = (
  value: unknown,
  range?: { startDate?: string; endDate?: string } | null,
): boolean => {
  const effectiveRange = range?.startDate && range?.endDate ? range : getCurrentMonthRange();
  const valueMs = parseDateValue(value);
  const startMs = parseDateValue(effectiveRange.startDate);
  const endMs = parseDateValue(effectiveRange.endDate);
  if (!valueMs || !startMs || !endMs) return false;

  const start = new Date(startMs);
  const end = new Date(endMs);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return valueMs >= start.getTime() && valueMs <= end.getTime();
};

const getFieldLabel = (field: unknown, fallback?: string): string => {
  const option = INSIGHT_FIELD_OPTIONS.find((item) => item.value === field);
  return option?.label || fallback || "Livestock";
};

const getInsightIcon = (field: unknown) =>
  INSIGHT_ICON_OPTIONS.find((item) => item.value === field)?.icon || Lightbulb;

const resolveVisibleProgrammes = (
  accessibleProgrammes: readonly string[],
  selectedProgramme?: string | null,
): ProgrammeOption[] => {
  const normalizedAccess = accessibleProgrammes
    .map((programme) => normalizeProgramme(programme))
    .filter(Boolean) as ProgrammeOption[];
  const uniqueAccess = Array.from(new Set(normalizedAccess));
  const selected = normalizeProgramme(selectedProgramme);

  if (selected && uniqueAccess.includes(selected)) return [selected];
  if (selectedProgramme === ALL_PROGRAMMES_VALUE || !selectedProgramme) return uniqueAccess;
  return uniqueAccess;
};

export function DashboardInsights({
  allowAdd = false,
  accessibleProgrammes,
  selectedProgramme,
  dateRange,
  title = "Insights",
  description: _description,
  className,
  maxRows = 8,
}: DashboardInsightsProps) {
  const { user, userName } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: formatDateToLocal(new Date()),
    field: "farmers" as InsightField,
    icon: "increase",
    insight: "",
    programme: "",
  });

  const visibleProgrammes = useMemo(
    () => resolveVisibleProgrammes(accessibleProgrammes, selectedProgramme),
    [accessibleProgrammes, selectedProgramme],
  );

  const defaultProgramme = useMemo(() => {
    const selected = normalizeProgramme(selectedProgramme);
    return selected && visibleProgrammes.includes(selected) ? selected : visibleProgrammes[0] || "";
  }, [selectedProgramme, visibleProgrammes]);

  const insightDateRange = useMemo(
    () => (dateRange?.startDate && dateRange?.endDate ? dateRange : getCurrentMonthRange()),
    [dateRange?.endDate, dateRange?.startDate],
  );

  const insightsQuery = useQuery({
    queryKey: ["dashboard-insights", visibleProgrammes.join("|"), insightDateRange.startDate, insightDateRange.endDate],
    queryFn: async () => {
      if (visibleProgrammes.length === 0) return [];
      const records = await fetchCollection<DashboardInsightRecord>(
        INSIGHTS_PATH,
        { noDateFilter: true },
      );
      return records
        .filter((record) => visibleProgrammes.includes(normalizeProgramme(record.programme) as ProgrammeOption))
        .map((record) => ({
          ...record,
          date: record.date || "",
          insight: String(record.insight || "").trim(),
          fieldLabel: getFieldLabel(record.field, record.fieldLabel),
          icon: record.icon || "increase",
        }))
        .filter((record) => record.insight && isDateWithinRange(record.date, insightDateRange))
        .sort(
          (a, b) =>
            parseDateValue(b.date) - parseDateValue(a.date) ||
            Number(b.createdAt || 0) - Number(a.createdAt || 0),
        );
    },
    enabled: visibleProgrammes.length > 0,
    staleTime: 60 * 1000,
  });

  const rows = (insightsQuery.data || []).slice(0, maxRows);
  const canCreate = allowAdd && visibleProgrammes.length > 0;

  const openAddDialog = () => {
    setForm({
      date: insightDateRange.startDate || formatDateToLocal(new Date()),
      field: "farmers",
      icon: "increase",
      insight: "",
      programme: defaultProgramme,
    });
    setDialogOpen(true);
  };

  const saveInsight = async () => {
    const insight = form.insight.trim();
    const programme = normalizeProgramme(form.programme || defaultProgramme);
    if (!form.date || !insight || !programme) {
      toast({
        title: "Missing insight details",
        description: "Choose a date, field, programme, and write the insight.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSaving(true);
      const selectedField = INSIGHT_FIELD_OPTIONS.find((item) => item.value === form.field);
      await push(ref(db, INSIGHTS_PATH), {
        date: form.date,
        insight,
        field: form.field,
        fieldLabel: selectedField?.label || getFieldLabel(form.field),
        icon: form.icon,
        programme,
        createdAt: Date.now(),
        createdBy: userName || user?.email || "Dashboard User",
        createdByUid: user?.uid || "",
      });
      setDialogOpen(false);
      await insightsQuery.refetch();
      toast({
        title: "Insight added",
        description: "The note is now visible across the dashboards.",
      });
    } catch (error) {
      console.error("Error saving dashboard insight:", error);
      toast({
        title: "Could not save insight",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={`relative ${className || "border-0 bg-white shadow-lg"}`}>
      <CardContent className="p-0">
        <div className="flex min-h-[92px] items-stretch overflow-x-auto rounded-[10px] border border-slate-200 bg-[#f2f8fd] px-5 py-3 shadow-sm">
          <div className="flex w-[190px] shrink-0 items-center gap-3 border-r border-slate-300 pr-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1267b1] text-white shadow-sm">
              <Lightbulb className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#22527d]">{title || "Key Insights"}</p>
            </div>
          </div>

          <div className="flex min-w-[820px] flex-1 items-stretch">
            {insightsQuery.isLoading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading insights...
              </div>
            ) : rows.length > 0 ? (
              rows.slice(0, 4).map((row, index) => {
                const Icon = getInsightIcon(row.icon);
                const option = INSIGHT_ICON_OPTIONS.find((item) => item.value === row.icon);
                return (
                  <div key={row.id} className={`flex min-w-0 flex-1 items-center gap-3 px-5 ${index > 0 ? "border-l border-slate-300" : ""}`}>
                    <Icon className={`h-6 w-6 shrink-0 ${option?.color || "text-emerald-500"}`} />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold text-slate-800">{row.fieldLabel}</p>
                      <p className="line-clamp-2 text-xs leading-4 text-slate-700">{row.insight}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">No insights added yet</div>
            )}
          </div>

          {canCreate ? (
            <Button type="button" size="sm" onClick={openAddDialog} className="absolute right-0 top-0 z-10 rounded-none rounded-bl-md bg-[#1267b1] text-xs shadow-md hover:bg-[#0d568f]">
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          ) : null}
        </div>

        {/* Keep the legacy card body closed below the banner. */}
        <div className="hidden">
        {insightsQuery.isLoading ? (
          <div className="flex h-24 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading insights...
          </div>
        ) : rows.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-5">
            {rows.slice(0, 5).map((row) => {
              const Icon = getInsightIcon(row.icon || row.field);
              const option = INSIGHT_ICON_OPTIONS.find((item) => item.value === row.icon);
              return (
                <div key={row.id} className="min-h-[118px] rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className={`h-6 w-6 ${option?.color || "text-amber-500"}`} />
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{row.fieldLabel}</span>
                  </div>
                  <p className="text-sm leading-5 text-slate-700">{row.insight}</p>
                  <p className="mt-2 text-xs text-slate-400">{row.date || "N/A"}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-slate-300 text-sm text-slate-500">No insights added yet</div>
        )}
        </div>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Insight</DialogTitle>
            <DialogDescription>
              Add a dated note for the dashboards and reports.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="insightDate">Date</Label>
                <Input
                  id="insightDate"
                  type="date"
                  value={form.date}
                  min={insightDateRange.startDate}
                  max={insightDateRange.endDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.field}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, field: value as InsightField }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INSIGHT_FIELD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Trend icon</Label>
                <Select
                  value={form.icon}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, icon: value }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INSIGHT_ICON_OPTIONS.map((option) => {
                      const Icon = option.icon;
                      return (
                        <SelectItem key={option.value} value={option.value}>
                          <span className="flex items-center gap-2"><Icon className={`h-4 w-4 ${option.color}`} />{option.label}</span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Programme</Label>
              <Select
                value={form.programme || defaultProgramme}
                onValueChange={(value) => setForm((prev) => ({ ...prev, programme: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select programme" />
                </SelectTrigger>
                <SelectContent>
                  {visibleProgrammes.map((programme) => (
                    <SelectItem key={programme} value={programme}>
                      {programme}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="insightText">Insight</Label>
              <Textarea
                id="insightText"
                value={form.insight}
                onChange={(event) => setForm((prev) => ({ ...prev, insight: event.target.value }))}
                placeholder="Write the insight..."
                rows={4}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={saveInsight} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Insight
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
