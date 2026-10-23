import type { KeeperView, MemoryGraph, SectionState } from "./adapter";
import type { Vec3 } from "./layout";
import type { AtlasLayout } from "./atlas";

/** Detail of the terrain (the grid its relief and shores are measured on). */
export type Quality = "alta" | "media" | "baixa";
/** autoFocus: the camera goes by itself to what is happening. */
export type MapSettings = { paused: boolean; quality: Quality; labels: boolean; reducedMotion: boolean; autoFocus: boolean };
export type Highlight = { kind: "recalled" | "created" | "search" | "read" | "linked" | "flagged" | "joined"; at: number; score?: number; note?: string };
/** A turn of the Aurora as it happens: where it goes and what it reaches (all from real events). */
export type AgentTentacle = { id: string; kind: "scanned" | "recalled" | "created" | "used"; strength: number; order: number };
export type AgentState = { key: string; target: Vec3 | null; tentacles: AgentTentacle[]; ended: boolean } | null;
/** Where the view goes: its centre and how far away (what is seen is 2·distance·tan(22.5°) tall). */
export type CameraCommand = { target: Vec3; distance: number; key: number; front?: boolean } | null;
export type Merge = { from: Vec3[]; to: Vec3; at: number };
/** A recent answer and the memories it used. */
export type RecallBush = { id: string; at: string; prompt: string; used: string[] };

export type MapProps = {
  graph: MemoryGraph;
  layout: AtlasLayout;
  settings: MapSettings;
  selectedId: string | null;
  hoveredId: string | null;
  focusClusterId: string | null;
  highlights: Map<string, Highlight>;
  camera: CameraCommand;
  agent: AgentState;
  keeper: KeeperView | null;
  /** Each section's state in the Zeladora's round. */
  sections: Map<string, SectionState>;
  /** The memories the Zeladora has read in this round (the rest stay dim while she works); null: all lit. */
  readSet: Set<string> | null;
  /** Memories she is pulling into one (compaction / join), with where they were. */
  merges: Merge[];
  recalls: RecallBush[];
  /** The person moved the map: automatic camera moves stop for a while. */
  onUserMove: () => void;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onCluster: (id: string, double: boolean) => void;
};
