export const MESH_RELEASES_URL = "https://github.com/compose-market/mesh/releases";

const MESH_LATEST_DOWNLOAD_BASE = "https://github.com/compose-market/mesh/releases/latest/download";

export const MESH_MAC_DOWNLOADS = {
  appleSilicon: {
    label: "Apple Silicon",
    hint: "M1, M2, M3, and M4 Macs",
    dmgUrl: `${MESH_LATEST_DOWNLOAD_BASE}/compose-mesh-macos-aarch64.dmg`,
  },
  intel: {
    label: "Intel Mac",
    hint: "Older Intel-based Macs",
    dmgUrl: `${MESH_LATEST_DOWNLOAD_BASE}/compose-mesh-macos-x86_64.dmg`,
  },
} as const;
