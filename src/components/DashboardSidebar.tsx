import {
  Archive,
  BarChart3,
  BookOpenCheck,
  ChevronRight,
  CircleGauge,
  ClipboardPenLine,
  ClipboardPlus,
  DoorOpen,
  Factory,
  FileBarChart,
  Gauge,
  HandCoins,
  ListChecks,
  ShoppingBag,
  SlidersHorizontal,
  Stethoscope,
  Sprout,
  Target,
  UserPlus,
  UserRoundCheck,
  UsersRound,
  Waves,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import {
  canAccessDashboard,
  canAccessFarmerData,
  canAccessFieldActivities,
  canAccessInfrastructure,
  canAccessOrdersSection,
  canAccessProjectManagerSection,
  canAccessRequisition,
  canAccessReports,
  canAccessUserManagement,
  isAdmin,
  isFinance,
  isHummanResourceManager,
  isMonitoringAndEvaluationOfficer,
  isProjectManager,
  resolvePermissionPrincipal,
  canAccessSiteManagement,
} from "@/contexts/authhelper";

type NavSubItem = {
  title: string;
  url: string;
  icon: LucideIcon;
};

type NavSection = {
  title: string;
  icon: LucideIcon;
  visible: boolean;
  items: NavSubItem[];
};

const buildSections = (userRole: string | null, userAttribute: string | null): NavSection[] => {
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  const canAccessLivestockOfftake = canAccessProjectManagerSection(userRole, userAttribute);
  const canAccessFodderOfftake = canAccessSiteManagement(userRole, userAttribute);
  const canAccessFieldTeamPage =
    isAdmin(principal) ||
    isMonitoringAndEvaluationOfficer(principal) ||
    isHummanResourceManager(principal);

  return [
    {
      title: "Reports",
      icon: FileBarChart,
      visible: canAccessReports(userRole, userAttribute),
      items: [
        { title: "Performance Report", url: "/dashboard/reports", icon: FileBarChart },
        { title: "Sales Metrics", url: "/dashboard/salesreport", icon: TrendingUp },
      ],
    },
    {
      title: "Farmer Data",
      icon: UserRoundCheck,
      visible: canAccessFarmerData(userRole, userAttribute),
      items: [
         { title: "Progress Dashboard", url: "/dashboard/livestock/analytics", icon: CircleGauge },
        { title: "Livestock Farmers", url: "/dashboard/livestock", icon: UserRoundCheck },
       
        { title: "Fodder Farmers", url: "/dashboard/fodder", icon: Sprout },
        { title: "Capacity Building", url: "/dashboard/capacity", icon: BookOpenCheck },
      ],
    },
    {
      title: "Offtake",
      icon: ShoppingBag,
      visible: canAccessLivestockOfftake || canAccessFodderOfftake,
      items: [
        ...(canAccessLivestockOfftake
          ? [{ title: "Livestock Offtake", url: "/dashboard/livestock-offtake", icon: HandCoins }]
          : []),
      ],
    },
    {
      title: "Infrastructure",
      icon: Waves,
      visible: canAccessInfrastructure(userRole, userAttribute),
      items: [
        { title: "Hay Storage", url: "/dashboard/hay-storage", icon: Archive },
        { title: "Borehole", url: "/dashboard/borehole", icon: Waves },
      ],
    },
    {
      title: "Field Activities",
      icon: Target,
      visible: canAccessFieldActivities(userRole, userAttribute),
      items: [
        ...(canAccessFieldTeamPage
          ? [{ title: "Field Report", url: "/dashboard/field-team", icon: ClipboardPenLine }]
          : []),
        { title: "Activity Overview", url: "/dashboard/activities", icon: ListChecks },
        { title: "Animal Health", url: "/dashboard/animalhealth", icon: Stethoscope },
        { title: "Onboarding", url: "/dashboard/onboarding", icon: UserPlus },
      ],
    },
  ];
};

const buildHrSections = (userRole: string | null, userAttribute: string | null): NavSection[] => {
  return buildSections(userRole, userAttribute).filter((section) =>
    section.title === "Farmer Data" ||
    section.title === "Field Activities" ||
    section.title === "Infrastructure"
  );
};

const buildProjectManagerSections = (userRole: string | null, userAttribute: string | null): NavSection[] => {
  return buildSections(userRole, userAttribute)
    .filter((section) =>
      section.title === "Farmer Data" ||
      section.title === "Field Activities" ||
      section.title === "Infrastructure"
    )
    .map((section) =>
      section.title === "Farmer Data"
        ? {
            ...section,
            items: section.items.filter((item) => item.url === "/dashboard/livestock/analytics"),
          }
        : section
    );
};

const buildFinanceSections = (userRole: string | null, userAttribute: string | null): NavSection[] => {
  return buildSections(userRole, userAttribute).filter((section) => section.title === "Field Activities");
};

const buildRoleMenuItems = (userRole: string | null, userAttribute: string | null): NavSubItem[] => {
  const principal = resolvePermissionPrincipal(userRole, userAttribute);

  if (isProjectManager(principal)) {
    return [
      { title: "Dashboard Overview", url: "/dashboard", icon: Gauge },
      { title: "Field Team Page", url: "/dashboard/field-team", icon: ClipboardPenLine },
      { title: "Report", url: "/dashboard/reports", icon: FileBarChart },
    ];
  }

  if (isHummanResourceManager(principal)) {
    return [
      { title: "Dashboard Overview", url: "/dashboard", icon: Gauge },
      { title: "General Report", url: "/dashboard/reports", icon: FileBarChart },
      { title: "Progress Dashboard", url: "/dashboard/livestock/analytics", icon: BarChart3 },
      { title: "Capacity Building", url: "/dashboard/capacity", icon: BookOpenCheck },
    ];
  }

  if (isFinance(principal)) {
    return [
      { title: "Dashboard Overview", url: "/dashboard", icon: Gauge },
      { title: "Sales Metrics", url: "/dashboard/salesreport", icon: BarChart3 },
    ];
  }

  return [];
};

export function DashboardSidebar() {
  const { state } = useSidebar();
  const { signOutUser, userRole, userAttribute } = useAuth();
  const collapsed = state === "collapsed";
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  const sections = buildSections(userRole, userAttribute);
  const roleMenuItems = buildRoleMenuItems(userRole, userAttribute);
  const roleMenuSections = isProjectManager(principal)
    ? buildProjectManagerSections(userRole, userAttribute)
    : isHummanResourceManager(principal)
      ? buildHrSections(userRole, userAttribute)
      : isFinance(principal)
        ? buildFinanceSections(userRole, userAttribute)
        : roleMenuItems.length === 0
          ? sections
          : [];
  const showStandaloneDashboard = roleMenuItems.length === 0 && canAccessDashboard(userRole, userAttribute);
  const showBottomRequisition = canAccessRequisition(userRole, userAttribute);
  const sidebarItemClassName = "h-7 gap-1.5 px-1.5 py-0 text-[12.5px] font-normal tracking-normal antialiased";
  const sidebarSubItemClassName = "h-7 px-2 py-1 text-[12.5px] font-normal tracking-normal antialiased";
  const footerItemClassName = "h-10 gap-1.5 px-1.5 py-1 text-[12.5px] font-normal tracking-normal antialiased border-l-2 border-l-yellow-500/70";

  return (
    <Sidebar className={`${collapsed ? "w-14" : "w-64"} bg-green-600 text-white antialiased`} collapsible="icon">
      <SidebarHeader className="border-b border-orange-500 bg-white">
        <div className="flex items-center gap-2">
          <div className="flex h-[60px] w-[60px] items-center  bg-white/20">
            <img src="/img/EZEK.png" className="h-full w-full object-cover" alt="GenCo Logo" />
          </div>
          {!collapsed && (
            <div className="truncate">
              <h1 className="text-base font-semibold tracking-tight text-green-700">GENCO Livestock</h1>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-green-600 gap-0">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {showStandaloneDashboard && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild className={sidebarItemClassName}>
                    <NavLink
                      to="/dashboard"
                      end
                      className="text-green-50 transition-colors hover:bg-green-500"
                      activeClassName="bg-white font-medium text-green-700 shadow-sm"
                    >
                      <Gauge className="h-4 w-4" />
                      {!collapsed && <span>Dashboard Overview</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {roleMenuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild className={sidebarItemClassName}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="text-green-50 transition-colors hover:bg-green-500"
                      activeClassName="bg-white font-medium text-green-700 shadow-sm"
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {roleMenuSections.map((section) => {
          if (!section.visible) return null;

          return (
            <SidebarGroup key={section.title} className="py-0.5">
              <SidebarGroupContent>
                <SidebarMenu>
                  <Collapsible defaultOpen className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton className={`${sidebarItemClassName} text-green-50 transition-colors hover:bg-green-500`}>
                          <section.icon className="h-4 w-4" />
                          {!collapsed && (
                            <>
                              <span>{section.title}</span>
                              <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                            </>
                          )}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>

                      {!collapsed && (
                        <CollapsibleContent>
                          <SidebarMenuSub className="mx-0 gap-1.5 border-l border-green-400/50 pl-1">
                            {section.items.map((item) => (
                              <SidebarMenuSubItem key={item.title}>
                                <SidebarMenuSubButton asChild className={sidebarSubItemClassName}>
                                  <NavLink
                                    to={item.url}
                                    className="text-green-50/85 transition-colors hover:bg-green-500"
                                    activeClassName="bg-white font-medium text-green-700"
                                  >
                                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                                    <span>{item.title}</span>
                                  </NavLink>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      )}
                    </SidebarMenuItem>
                  </Collapsible>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}

        {canAccessOrdersSection(userRole, userAttribute) && (
          <SidebarGroup className="py-0.5">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild className={sidebarItemClassName}>
                    <NavLink
                      to="/dashboard/orders"
                      className="text-green-50 transition-colors hover:bg-green-500"
                      activeClassName="bg-white font-medium text-green-700 shadow-sm"
                    >
                      <ShoppingBag className="h-4 w-4" />
                      {!collapsed && <span>Orders</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showBottomRequisition && (
          <SidebarGroup className="py-0.5">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild className={sidebarItemClassName}>
                    <NavLink
                      to="/dashboard/requisition"
                      className="text-green-50 transition-colors hover:bg-green-500"
                      activeClassName="bg-white font-medium text-green-700 shadow-sm">
                      <ClipboardPlus className="h-4 w-4" />
                      {!collapsed && <span>Requisitions</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-yellow-500 bg-green-600 py-4 px-2">
        <SidebarMenu>
          {canAccessUserManagement(userRole, userAttribute) && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild className={footerItemClassName}>
                <NavLink
                  to="/dashboard/users"
                  className="text-green-50 transition-colors hover:bg-green-500"
                  activeClassName="border-yellow-500 bg-white font-medium text-green-700 shadow-sm"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {!collapsed && <span>Site Management</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={signOutUser}
              className={`${footerItemClassName} text-green-50 transition-colors hover:bg-green-500`}
            >
              <DoorOpen className="h-4 w-4" />
              {!collapsed && <span>Logout</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
