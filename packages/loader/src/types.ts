export interface ClientInstall {
  installRoot: string;
  version: string;
  versionDir: string;
  appDir: string;
  packageName: string;
  electronVersion?: string;
}

export interface PatchState {
  installed: boolean;
  loaderVersion?: string;
  installedAt?: string;
  clientVersion?: string;
  installRoot?: string;
  appDir?: string;
  preloadPatched: boolean;
  htmlPatched: boolean;
  runtimePresent: boolean;
}

export interface InstallManifest {
  loaderVersion: string;
  installedAt: string;
  clientVersion: string;
  installRoot: string;
  appDir: string;
  backedUpFiles: string[];
}
