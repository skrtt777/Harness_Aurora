const PATHS: Record<string, string> = {
  memory: "M12 3c-3.6 0-6 2.4-6 5.4 0 1.7.8 2.9 1.7 3.9C6.8 13.2 6 14.5 6 16c0 2.8 2.7 5 6 5s6-2.2 6-5c0-1.5-.8-2.8-1.7-3.7.9-1 1.7-2.2 1.7-3.9C18 5.4 15.6 3 12 3Z M9.5 9.5c0-1.4 1.1-2.5 2.5-2.5 M9 15.5c0 1.1.9 2 2 2",
  atlas: "M12 3v18 M3 12h18 M12 12a9 4.5 0 1 0 0 0.0001 M12 12a4.5 9 0 1 0 0 0.0001",
  flask: "M9 3h6 M10 3v6.2c0 .5-.2 1-.5 1.4L5.8 16c-1.3 1.8 0 4 2.3 4h7.8c2.3 0 3.6-2.2 2.3-4l-3.7-5.4c-.3-.4-.5-.9-.5-1.4V3 M8 15h8",
  cursor: "M6 3 18 10l-5 1.3L15 18 12.5 19 10.3 12.7 6 16Z",
  puzzle: "M9 4h4a1 1 0 0 1 1 1v2.2a1.6 1.6 0 0 0 2.8 1c.9-1 2.6-.3 2.6 1v3.6c0 1.3-1.7 2-2.6 1a1.6 1.6 0 0 0-2.8 1V17a1 1 0 0 1-1 1H9 M9 18H6a1 1 0 0 1-1-1v-4a1.6 1.6 0 0 0-2.8-1c-.9 1-2.6.3-2.6-1V7.4c0-1.3 1.7-2 2.6-1A1.6 1.6 0 0 0 5 5.4V4a1 1 0 0 1 1-1h3",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.8a7 7 0 0 0-2.1-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2.1 1.2l-2.3-.8-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.8c.6.5 1.3.9 2.1 1.2L10 21h4l.5-2.5a7 7 0 0 0 2.1-1.2l2.3.8 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M21 21l-4.6-4.6",
  plus: "M12 5v14 M5 12h14",
  edit: "M4 20l.8-3.6L16.4 4.8a1.7 1.7 0 0 1 2.4 0l.4.4a1.7 1.7 0 0 1 0 2.4L7.6 19.2 4 20Z M14.5 6.5l3 3",
  trash: "M5 7h14 M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2 M7 7l1 13h8l1-13",
  download: "M12 4v11 M8 11l4 4 4-4 M5 20h14",
  upload: "M12 15V4 M8 8l4-4 4 4 M5 20h14",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3.5 9h17 M3.5 15h17 M12 3c2.2 2.5 3.3 5.7 3.3 9s-1.1 6.5-3.3 9c-2.2-2.5-3.3-5.7-3.3-9s1.1-6.5 3.3-9Z",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v10 M9.5 9.5c0-1.1 1.1-2 2.5-2s2.5.7 2.5 1.8-1 1.6-2.5 1.9-2.5.9-2.5 2 1.1 1.8 2.5 1.8 2.5-.6 2.5-1.5",
  folder: "M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z",
  archive: "M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3H4Z M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8 M10 12h4",
  unarchive: "M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3H4Z M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8 M12 16v-4 M9.5 14.5 12 12l2.5 2.5",
  check: "M5 12.5 9.5 17 19 6.5",
  refresh: "M4 12a8 8 0 0 1 14-5.2M20 12a8 8 0 0 1-14 5.2 M17.5 7h3V4 M6.5 17H3.5V20",
  chevron: "M9 6l6 6-6 6",
  close: "M6 6l12 12 M18 6 6 18",
};

type IconName = keyof typeof PATHS;

/**
 * One stroke-based glyph set for the whole app, so nav/actions no longer mix
 * emoji (rendered inconsistently across OS font sets) with plain unicode
 * symbols. Single-color, currentColor-driven, no per-icon styling needed.
 */
export default function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
