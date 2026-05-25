/**
 * Wave 2 React Query hooks barrel.
 *
 * Every hook here relies on `@tanstack/react-query` being available in
 * the consuming app and on `initializeApiClient()` having been called
 * so `getApiClient()` returns a configured singleton.
 */

export * from './query-keys';
export * from './shared';

export * from './useApprovalPolicies';
export * from './useNegotiations';
export * from './useMarketplaceListings';
export * from './useTenders';
export * from './useWaitlist';
export * from './useGamification';
export * from './useArrears';
export * from './useGepgPayment';
export * from './useLetterRequests';
export * from './useDocChat';
export * from './useScans';
export * from './useInteractiveReports';
export * from './useOccupancyTimeline';
export * from './useStationMasterCoverage';
export * from './useMigration';
export * from './useRiskReports';
export * from './useCompliance';
export * from './useFinancialProfile';
export * from './useRenewals';
export * from './useNotificationPreferences';
export * from './useConditionalSurveys';
export * from './useApplications';
