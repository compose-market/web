export const MESH_RELEASES_URL = "https://github.com/compose-market/mesh/releases";

export type MeshDownloadPlatform = "android" | "macos" | "windows" | "linux";

export interface MeshDownloadOption {
  id: string;
  platform: MeshDownloadPlatform;
  title: string;
  hint: string;
  format: string;
  assetName: string;
  url: string;
  recommended?: boolean;
}

export interface MeshDownloadGroup {
  id: MeshDownloadPlatform;
  title: string;
  description: string;
  options: MeshDownloadOption[];
}

/* ── Dynamic version fetch from GitHub Releases API ── */

let versionCache: string | null = null;

async function fetchMeshVersion(): Promise<string> {
  if (versionCache) return versionCache;

  const res = await fetch(
    "https://api.github.com/repos/compose-market/mesh/releases/latest",
    { headers: { Accept: "application/vnd.github.v3+json" } },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch latest Mesh release: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { tag_name?: string };
  const tag = data.tag_name ?? "";
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  if (!version) {
    throw new Error("Latest Mesh release has no version tag.");
  }
  versionCache = version;
  return version;
}

function buildTaggedReleaseAssetUrl(version: string, assetName: string): string {
  return `https://github.com/compose-market/mesh/releases/download/v${version}/${assetName}`;
}

export async function getMeshReleaseUrl(): Promise<string> {
  const version = await fetchMeshVersion();
  return `https://github.com/compose-market/mesh/releases/tag/v${version}`;
}

export async function getMeshDownloadGroups(): Promise<MeshDownloadGroup[]> {
  const version = await fetchMeshVersion();

  return [
    {
      id: "android",
      title: "Android",
      description: "Direct APK for Android phones and tablets with sideloading or developer mode enabled.",
      options: [
        {
          id: "android-apk",
          platform: "android",
          title: "Android APK",
          hint: "Universal APK for direct install",
          format: ".apk",
          assetName: "android.apk",
          url: buildTaggedReleaseAssetUrl(version, "android.apk"),
          recommended: true,
        },
      ],
    },
    {
      id: "macos",
      title: "macOS",
      description: "Use the DMG installer. If your Mac is from 2020 or later, choose Apple Silicon.",
      options: [
        {
          id: "macos-apple-silicon",
          platform: "macos",
          title: "Apple Silicon",
          hint: "M1, M2, M3, and M4 Macs",
          format: ".dmg",
          assetName: "apple-silicon.dmg",
          url: buildTaggedReleaseAssetUrl(version, "apple-silicon.dmg"),
          recommended: true,
        },
        {
          id: "macos-intel",
          platform: "macos",
          title: "Intel Mac",
          hint: "Older Intel-based Macs",
          format: ".dmg",
          assetName: "intel.dmg",
          url: buildTaggedReleaseAssetUrl(version, "intel.dmg"),
        },
      ],
    },
    {
      id: "windows",
      title: "Windows",
      description: "Standard installer for Windows desktops and laptops.",
      options: [
        {
          id: "windows-installer",
          platform: "windows",
          title: "Windows Installer",
          hint: "Windows 10 and Windows 11",
          format: ".exe",
          assetName: "windows.exe",
          url: buildTaggedReleaseAssetUrl(version, "windows.exe"),
          recommended: true,
        },
      ],
    },
    {
      id: "linux",
      title: "Linux",
      description: "AppImage is the easiest option. Use DEB or RPM if you prefer native packages.",
      options: [
        {
          id: "linux-appimage",
          platform: "linux",
          title: "Linux AppImage",
          hint: "Best default for most distributions",
          format: ".AppImage",
          assetName: "linux.AppImage",
          url: buildTaggedReleaseAssetUrl(version, "linux.AppImage"),
          recommended: true,
        },
        {
          id: "linux-deb",
          platform: "linux",
          title: "Debian / Ubuntu",
          hint: "Native package for Ubuntu, Debian, Pop!_OS, Mint",
          format: ".deb",
          assetName: "linux.deb",
          url: buildTaggedReleaseAssetUrl(version, "linux.deb"),
        },
        {
          id: "linux-rpm",
          platform: "linux",
          title: "Fedora / RHEL",
          hint: "Native package for Fedora, RHEL, Rocky, AlmaLinux",
          format: ".rpm",
          assetName: "linux.rpm",
          url: buildTaggedReleaseAssetUrl(version, "linux.rpm"),
        },
      ],
    },
  ];
}
