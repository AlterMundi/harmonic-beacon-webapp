export type HistoricalMigrationChecksum = {
  migrationName: string;
  historicalChecksum: string;
  historicalSourceCommit: string;
  currentChecksum: string;
  currentSelectedAtCommit: string;
};

// Closed evidence for two migrations whose applied production bytes remain in
// Git history but whose checked-in bytes were later changed by reviewed merges.
// An alias is usable only while the current file still has currentChecksum.
export const HISTORICAL_MIGRATION_CHECKSUMS: readonly HistoricalMigrationChecksum[] = Object.freeze([
  Object.freeze({
    migrationName: '20260728120000_weekend_mvp',
    historicalChecksum: '0ebfb48f939f53716f741c62751c82fcfe2f57c461896dc7127ce6ecf8b8eb0b',
    historicalSourceCommit: '29b0f567e0e280f4b57674be6d6d56a352716832',
    currentChecksum: 'e654db87b9d8b0fa996a89a83938ff53260abf1b278e84d43f949a1fde040ab4',
    currentSelectedAtCommit: 'e6b70f1559bf5ceadba0f1b7ecfa0f91f16103b8',
  }),
  Object.freeze({
    migrationName: '20260818030000_four_saturday_public_cycle',
    historicalChecksum: 'eb2984af3f82406a8e33752d6fbcf6f2afe32e31d1e97a5f6fb2b12467970eb0',
    historicalSourceCommit: '82f0b246d416a8c01846465b55b9f6cf340f2b9e',
    currentChecksum: '3418053a797b9d71bbee7a52a76d479694ad6d64e86232f35b464462bf00f9fa',
    currentSelectedAtCommit: '4d6d90956374b04d5156ddaecdc5135c6592186a',
  }),
]);
