/** Zeiterfassung — Domain-Typen (Collection `time_entries`). */

export type TimeSyncInterval = 'hourly' | 'daily' | 'disabled';

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

export interface TimeTrackingSettings {
  standardHourlyRate: number;
  specialHourlyRate: number;
  syncInterval: TimeSyncInterval;
  graph: TimeTrackingGraphConfig;
}

export interface TimeEntry {
  id: string;
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
  customerCompany: string;
  userId: string;
  agentName: string;
  kuerzel: string;
  hours: number;
  sonderzahlung: boolean;
  hourlyRate: number;
  totalAmount: number;
  description: string;
  date: string;
  createdAt: string;
  updatedAt?: string;
  /** Letzte erfolgreiche Graph-Sync-Zeit (ISO). */
  graphSyncedAt?: string | null;
}

export interface TimeEntryInput {
  ticketId: string;
  ticketNumber?: string;
  ticketSubject?: string;
  customerCompany?: string;
  kuerzel: string;
  hours: number;
  sonderzahlung?: boolean;
  description?: string;
  date?: string;
}

export interface TimeEntryUpdateInput {
  kuerzel?: string;
  hours?: number;
  sonderzahlung?: boolean;
  description?: string;
  date?: string;
  ticketNumber?: string;
  ticketSubject?: string;
  customerCompany?: string;
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
};
