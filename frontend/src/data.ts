export type MemoryScope = "general" | "project" | "conversation";
export type MemoryKind = "context" | "demo";
export type RelationType =
  | "belonging"
  | "thematic"
  | "derivation"
  | "correction";
export type Memory = {
  id: string;
  title: string;
  content: string;
  scope: MemoryScope;
  kind: MemoryKind;
  project?: string;
  folder?: string;
  conversation?: string;
  source?: string;
  date?: string;
  tags: string[];
  position: [number, number, number];
  relations: string[];
  relationTypes?: Record<string, RelationType>;
};
export const palette = [
  "#65e2d4",
  "#83a8ff",
  "#bd91f7",
  "#f2b879",
  "#ef829e",
  "#8ad4a4",
];
export const groupKey = (memory: Memory) => memory.project || "Contexto geral";
export function hash(value: string) {
  let h = 2166136261;
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}
export function seededRandom(seed: string) {
  let state = Math.floor(hash(seed) * 4294967296);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function groupColor(key: string) {
  const known = [
    "Contexto geral",
    "Atlas",
    "Orion",
    "Nexus",
    "Aurora",
    "Helix",
  ];
  return palette[
    known.includes(key)
      ? known.indexOf(key)
      : Math.floor(hash(key) * palette.length)
  ];
}
export function clusterCenter(
  key: string,
  index: number,
  total: number,
): [number, number, number] {
  if (total === 1) return [0, 0, 0];
  const angle = (index / total) * Math.PI * 2 + 0.3;
  return [
    Math.cos(angle) * 21,
    (hash(key + "height") - 0.5) * 13,
    Math.sin(angle) * 17,
  ];
}
// Position assignment is independent of filters. Existing imported coordinates are authoritative.
export function layoutMemories(
  memories: Memory[],
  missingIds: Set<string>,
): Memory[] {
  const groups = [...new Set(memories.map(groupKey))].sort();
  return memories.map((m) => {
    if (!missingIds.has(m.id)) return m;
    const center = clusterCenter(
      groupKey(m),
      groups.indexOf(groupKey(m)),
      groups.length,
    );
    const random = seededRandom(m.id);
    const theta = random() * Math.PI * 2;
    const z = random() * 2 - 1;
    const radius = 3 + Math.cbrt(random()) * 9;
    const planar = Math.sqrt(1 - z * z);
    return {
      ...m,
      position: [
        center[0] + Math.cos(theta) * planar * radius,
        center[1] + z * radius * 0.8,
        center[2] + Math.sin(theta) * planar * radius,
      ],
    };
  });
}
export function createDemoMemories(count = 1000): Memory[] {
  const projects = ["Atlas", "Orion", "Nexus", "Aurora", "Helix"];
  const topics = [
    "arquitetura",
    "interface",
    "agentes",
    "memória",
    "automação",
    "qualidade",
    "pesquisa",
    "produto",
  ];
  const memories = Array.from(
    { length: count },
    (_, i): Memory => ({
      id: `demo-${String(i + 1).padStart(4, "0")}`,
      title: `Registro demonstrativo ${String(i + 1).padStart(4, "0")}`,
      content: `Exemplo sintético de ${topics[i % topics.length]} para explorar a rede neural do Aurora. Este registro não representa uma memória real.`,
      scope: i % 6 === 0 ? "general" : i % 2 ? "project" : "conversation",
      kind: "demo",
      project: i % 6 === 0 ? undefined : projects[(i % 6) - 1],
      conversation:
        i % 2 === 0 && i % 6 !== 0 ? `conversa-${(i % 24) + 1}` : undefined,
      source: "Demonstração sintética",
      tags: [topics[i % topics.length]],
      position: [0, 0, 0],
      relations: [],
    }),
  );
  return layoutMemories(memories, new Set(memories.map((m) => m.id)));
}
/** Only synthetic data is wired automatically. Imported edges must never be replaced. */
export function linkMemories(memories: Memory[]): Memory[] {
  const groups = new Map<string, Memory[]>();
  memories.forEach((m) => {
    const key = groupKey(m);
    groups.set(key, [...(groups.get(key) || []), m]);
  });
  return memories.map((m) => {
    if (m.kind !== "demo" || m.relations.length) return m;
    const group = groups.get(groupKey(m))!;
    const i = group.indexOf(m);
    const parent = i > 0 ? group[Math.floor((i - 1) / 4)] : null;
    return {
      ...m,
      relations: parent ? [parent.id] : [],
      relationTypes: parent ? { [parent.id]: "belonging" } : {},
    };
  });
}
export function importMemories(raw: unknown): Memory[] {
  if (!Array.isArray(raw))
    throw new Error("O JSON deve conter uma lista de memórias.");
  if (raw.length > 10000)
    throw new Error("Importe no máximo 10.000 memórias por coleção.");
  const ids = new Set<string>(),
    missing = new Set<string>();
  const memories = raw.map((item: unknown, index): Memory => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`Registro ${index + 1}: objeto inválido.`);
    const v = item as Record<string, unknown>;
    const id = String(v.id ?? `import-${index + 1}`).trim();
    if (!id || ids.has(id))
      throw new Error(`ID vazio ou duplicado no registro ${index + 1}.`);
    ids.add(id);
    const scope = v.scope ?? "general",
      kind = v.kind ?? "context";
    if (!["general", "project", "conversation"].includes(String(scope)))
      throw new Error(`Escopo inválido em ${id}.`);
    if (!["context", "demo"].includes(String(kind)))
      throw new Error(`Origem inválida em ${id}.`);
    if (
      v.position !== undefined &&
      (!Array.isArray(v.position) ||
        v.position.length !== 3 ||
        !v.position.every((n) => typeof n === "number" && Number.isFinite(n)))
    )
      throw new Error(`Posição inválida em ${id}: use três números finitos.`);
    if (v.position === undefined) missing.add(id);
    for (const field of ["tags", "relations"])
      if (
        v[field] !== undefined &&
        (!Array.isArray(v[field]) ||
          !(v[field] as unknown[]).every((x) => typeof x === "string"))
      )
        throw new Error(`${field} inválido em ${id}.`);
    const relationTypes = v.relationTypes ?? {};
    if (
      !relationTypes ||
      typeof relationTypes !== "object" ||
      Array.isArray(relationTypes) ||
      !Object.values(relationTypes).every((t) =>
        ["belonging", "thematic", "derivation", "correction"].includes(t),
      )
    )
      throw new Error(`Tipos de relação inválidos em ${id}.`);
    const optional = (key: string) =>
      typeof v[key] === "string" ? (v[key] as string) : undefined;
    return {
      id,
      title: String(v.title ?? v.label ?? `Memória importada ${index + 1}`),
      content: String(v.content ?? ""),
      scope: scope as MemoryScope,
      kind: kind as MemoryKind,
      project: optional("project"),
      folder: optional("folder"),
      conversation: optional("conversation"),
      source: optional("source") || "Importado pelo usuário",
      date: optional("date"),
      tags: (v.tags as string[]) || [],
      position: (v.position as Memory["position"]) || [0, 0, 0],
      relations: [...new Set((v.relations as string[]) || [])],
      relationTypes: relationTypes as Record<string, RelationType>,
    };
  });
  for (const memory of memories)
    for (const id of memory.relations)
      if (!ids.has(id))
        throw new Error(
          `Relação de ${memory.id} aponta para ID inexistente: ${id}.`,
        );
  return layoutMemories(memories, missing);
}
