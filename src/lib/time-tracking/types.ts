/** Zeiterfassung — Domain-Typen (SQL table `time_entries` + settings). */

export type TimeSyncInterval = 'hourly' | 'daily' | 'monthly' | 'disabled';

export type TimeMonthlySyncDay = number | 'last'; // 1–28 or last day of month

export interface TimeTrackingGraphConfig {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** True wenn Secret serverseitig hinterlegt, aber nicht zurückgegeben wird. */
  hasClientSecret?: boolean;
  /** SharePoint Site-ID oder Drive-ID (Drive bevorzugt). */
  siteId: string;
  driveId: string;
  /** Relativer Dateipfad im Drive ODER Workbook-Item-ID. */
  workbookPathOrId: string;
  worksheetName: string;
  tableName: string;
}

export interface TimeTrackingMonthlySyncConfig {
  /** Automatische monatliche SharePoint-Synchronisation. */
  enabled: boolean;
  /** 1–28 oder `last` (letzter Tag des Monats). Default 27. */
  dayOfMonth: TimeMonthlySyncDay;
  /** HH:mm in Europe/Berlin. Default 23:00. */
  timeBerlin: string;
  lastRunAt?: string | null;
  lastRunExported?: number;
  lastRunError?: string | null;
  lastRunPeriodKey?: string | null;
}

export interface TimeTrackingSettings {
  standardHourlyRate: number;
  specialHourlyRate: number;
  syncInterval: TimeSyncInterval;
  graph: TimeTrackingGraphConfig;
  monthlySharePointSync: TimeTrackingMonthlySyncConfig;
}

export interface TimeEntry {
  id: string;
  /** Null for standalone customer/meeting entries. */
  ticketId: string | null;
  organizationId: string | null;
  ticketNumber: string;
  ticketSubject: string;
  customerCompany: string;
  userId: string;
  agentName: string;
  kuerzel: string;
  /** Decimal total hours (e.g. 1.25). */
  hours: number;
  /** Minutes component 0–59 (display / form). */
  minutes: number;
  sonderzahlung: boolean;
  hourlyRate: number;
  totalAmount: number;
  description: string;
  date: string;
  createdAt: string;
  updatedAt?: string;
  /** Alias for sharepoint_synced_at — last successful Graph sync (ISO). */
  graphSyncedAt?: string | null;
  sharepointSyncedAt?: string | null;
}

export interface TimeEntryInput {
  ticketId?: string | null;
  organizationId?: string | null;
  ticketNumber?: string;
  ticketSubject?: string;
  customerCompany?: string;
  kuerzel: string;
  hours: number;
  minutes?: number;
  sonderzahlung?: boolean;
  description?: string;
  date?: string;
}

export interface TimeEntryUpdateInput {
  kuerzel?: string;
  hours?: number;
  minutes?: number;
  sonderzahlung?: boolean;
  description?: string;
  date?: string;
  ticketId?: string | null;
  organizationId?: string | null;
  ticketNumber?: string;
  ticketSubject?: string;
  customerCompany?: string;
}

export interface TimeEntryListFilters {
  from?: string;
  to?: string;
  userId?: string;
  organizationId?: string;
  ticketId?: string;
  /** all | with_ticket | without_ticket */
  type?: 'all' | 'with_ticket' | 'without_ticket';
  onlyUnsynced?: boolean;
}

export const TIME_ENTRIES_COLLECTION = 'time_entries';

export const DEFAULT_TIME_TRACKING_SETTINGS: TimeTrackingSettings = {
  standardHourlyRate: 95,
  specialHourlyRate: 140,
  syncInterval: 'hourly',
  graph: {
    enabled: false,
    tenantId: '',
    clientId: '',
    clientSecret: '',
    siteId: '',
    driveId: '',
    workbookPathOrId: '',
    worksheetName: 'Zeiterfassung',
    tableName: 'Zeiteintraege',
  },
  monthlySharePointSync: {
    enabled: false,
    dayOfMonth: 27,
    timeBerlin: '23:00',
    lastRunAt: null,
    lastRunExported: 0,
    lastRunError: null,
    lastRunPeriodKey: null,
  },
};
