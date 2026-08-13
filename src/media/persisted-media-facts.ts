import { mediaKindFromMime, type MediaKind } from "@openclaw/media-core/constants";
import {
  asFiniteNumberInRange,
  asPositiveSafeInteger,
} from "@openclaw/normalization-core/number-coercion";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";

type PersistedMediaFactDefaults<TInput> = {
  kind?: MediaKind;
  messageId?: string;
  workspaceDir?: string;
  transcribed?: (media: TInput, index: number) => boolean;
};

/** Reads only the canonical persisted envelope; retired top-level carriers do not count. */
export function readPersistedMediaFactInputs(message: object): unknown[] | undefined {
  const metadata = (message as Record<string, unknown>)["__openclaw"];
  const media =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).media
      : undefined;
  return Array.isArray(media) ? media : undefined;
}

/** Normalizes one fact without importing filesystem-only MIME detection into browsers. */
export function normalizePersistedMediaFact<TInput>(
  media: TInput,
  index: number,
  defaults: PersistedMediaFactDefaults<TInput> = {},
) {
  // Sparse arrays serialize missing attachment positions as null; malformed
  // persisted slots must remain empty facts instead of crashing transcript hydration.
  const input =
    media && typeof media === "object" && !Array.isArray(media)
      ? (media as Record<string, unknown>)
      : {};
  const workspaceDir = normalizeOptionalString(input.workspaceDir) ?? defaults.workspaceDir;
  const contentType = normalizeOptionalString(input.contentType);
  const normalizedMime = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  const kind =
    normalizedMime === "application/octet-stream" || normalizedMime === "binary/octet-stream"
      ? undefined
      : mediaKindFromMime(normalizedMime);
  const durationMs = asPositiveSafeInteger(input.durationMs);
  const width = asPositiveSafeInteger(input.width);
  const height = asPositiveSafeInteger(input.height);
  return {
    path: normalizeOptionalString(input.path),
    url: normalizeOptionalString(input.url),
    contentType,
    kind: (input.kind as MediaKind | undefined) ?? defaults.kind ?? kind,
    fileName: normalizeOptionalString(input.fileName),
    sizeBytes: asFiniteNumberInRange(input.sizeBytes, { min: 0 }),
    ...(durationMs ? { durationMs } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    transcribed:
      input.transcribed === true || defaults.transcribed?.(input as TInput, index) === true,
    messageId: normalizeOptionalString(input.messageId) ?? defaults.messageId,
    ...(workspaceDir ? { workspaceDir } : {}),
    ...(input.staged === true ? { staged: true } : {}),
    ...(input.hydrationSuppressed === true ? { hydrationSuppressed: true } : {}),
  };
}

/** Preserves sparse fact positions and every runtime normalization default. */
export function normalizePersistedMediaFacts<TInput>(
  media: readonly TInput[] | null | undefined,
  defaults: PersistedMediaFactDefaults<TInput> = {},
) {
  return Array.isArray(media)
    ? media.map((entry, index) => normalizePersistedMediaFact(entry, index, defaults))
    : [];
}

/** Reads normalized facts from the sole canonical persisted message envelope. */
export function readCanonicalPersistedMediaFacts(message: object) {
  const media = readPersistedMediaFactInputs(message);
  return media ? normalizePersistedMediaFacts(media) : undefined;
}

// Empty facts preserve legacy positional alignment but are not attachments;
// treating placeholders as media would expose blank rows and misroute turns.
export function isMeaningfulPersistedMediaFact(fact: {
  path?: string;
  url?: string;
  contentType?: string;
  kind?: MediaKind;
}): boolean {
  return Boolean(
    fact.path?.trim() ||
    fact.url?.trim() ||
    fact.contentType ||
    (fact.kind && fact.kind !== "unknown"),
  );
}
