/**
 * Type declarations for scripts/check-bundle-size.mjs (imported by tests).
 */
export interface BundleRow {
  path: string;
  rawKiB: number;
  gzipKiB: number;
}

export interface BundleMeasurement {
  rows: BundleRow[];
  totalKiB: number;
}

export function measureGzipKb(
  paths: readonly string[],
  read?: (path: string) => Uint8Array,
  stat?: (path: string) => { size: number },
): BundleMeasurement;
