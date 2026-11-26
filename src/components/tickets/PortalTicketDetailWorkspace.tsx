/**
 * @deprecated Lookalike portal ticket UI retired.
 * Portal mounts the exact staff TicketDetailView + TicketDetailContextPane
 * via PortalTicketStaffDetailHost (zero /api/db).
 *
 * Kept as a thin re-export so any lingering imports / string asserts resolve.
 */

export { PortalTicketStaffDetailHost as PortalTicketDetailWorkspace } from './PortalTicketStaffDetailHost';
