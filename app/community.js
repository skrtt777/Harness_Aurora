const DEFAULT_MANIFEST_URL =
  "https://raw.githubusercontent.com/skrtt777/Harness_Aurora/main/community-memories/manifest.json";

/**
 * Community memory bundles are pull-only, by design: the app never uploads
 * a user's own memories anywhere automatically (that would need a review
 * step this project doesn't have yet). It only fetches a manifest + bundle
 * files from a public repo, in the exact same JSON envelope already used by
 * the manual export/import feature, so the same import logic handles both.
 */
export async function fetchCommunityManifest(env = process.env) {
  const url = env.COMMUNITY_MANIFEST_URL || DEFAULT_MANIFEST_URL;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Falha ao buscar a lista de memórias da comunidade (${response.status}).`);
  const data = await response.json();
  if (!data || data.format !== "harness-aurora-community-manifest" || !Array.isArray(data.bundles)) {
    throw new Error("Manifesto da comunidade em formato inesperado.");
  }
  return data.bundles;
}

export async function fetchCommunityBundle(file, env = process.env) {
  if (!/^[a-zA-Z0-9_-]+\.json$/.test(file)) throw new Error("Nome de arquivo inválido.");
  const manifestUrl = env.COMMUNITY_MANIFEST_URL || DEFAULT_MANIFEST_URL;
  const baseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf("/"));
  const response = await fetch(`${baseUrl}/${file}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Falha ao buscar o pacote de memórias "${file}" (${response.status}).`);
  const data = await response.json();
  if (!data || data.format !== "harness-aurora-memories" || !Array.isArray(data.memories)) {
    throw new Error("Pacote de memórias em formato inesperado.");
  }
  return data;
}
