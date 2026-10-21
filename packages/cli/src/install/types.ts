/**
 * Shared types for host installers.
 */

export interface InstallReport {
  changed: boolean;
  backedUpTo?: string;
  entries: string[];
}

export interface InstallOpenCodeDeps {
  hostConfigPath: string;
  pluginEntry: string;
  stateDir?: string;
  now?: () => Date;
  dryRun?: boolean;
}

export interface UninstallOpenCodeDeps {
  hostConfigPath: string;
  stateDir?: string;
  purge?: boolean;
}

/**
 * Marker written under the state directory. It records exactly what the
 * installer owns so uninstall can be conservative.
 */
export interface OpenCodeInstallMarker {
  configPath: string;
  pluginEntry: string;
  backupPath: string | null;
  createdConfig: boolean;
  installedContentSha256: string;
}
