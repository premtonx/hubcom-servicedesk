/** Ticket-Kategorien — Collection `ticket_categories`. */

export const TICKET_CATEGORIES_COLLECTION = 'ticket_categories';

export interface TicketCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TicketCategoryInput {
  name: string;
  description?: string;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
  slug?: string;
}

export const DEFAULT_TICKET_CATEGORIES: Array<Omit<TicketCategory, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'First Level Support',
    slug: 'first-level-support',
    description: 'Erstkontakt, Standardanfragen und einfache Störungen.',
    color: '#1B6CA8',
    sortOrder: 10,
    isActive: true,
  },
  {
    name: 'Second Level Support',
    slug: 'second-level-support',
    description: 'Eskalierte technische Fälle und Expertenbearbeitung.',
    color: '#0B1F3A',
    sortOrder: 20,
    isActive: true,
  },
  {
    name: 'Netzwerk & Infrastruktur',
    slug: 'netzwerk-infrastruktur',
    description: 'Netzwerk, Server, VPN und Infrastrukturthemen.',
    color: '#0E7490',
    sortOrder: 30,
    isActive: true,
  },
  {
    name: 'Arbeitsplatz & Hardware',
    slug: 'arbeitsplatz-hardware',
    description: 'Endgeräte, Peripherie und Arbeitsplatzausstattung.',
    color: '#2E7D4F',
    sortOrder: 40,
    isActive: true,
  },
  {
    name: 'Abrechnung & Vertrag',
    slug: 'abrechnung-vertrag',
    description: 'Rechnungen, Verträge und kaufmännische Anliegen.',
    color: '#B45309',
    sortOrder: 50,
    isActive: true,
  },
];
