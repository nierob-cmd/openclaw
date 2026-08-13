import { describe, expect, it } from "vitest";
import type { MediaFactInput } from "./media-facts.js";
import {
  isMeaningfulPersistedMediaFact,
  normalizePersistedMediaFacts,
  readCanonicalPersistedMediaFacts,
} from "./persisted-media-facts.js";

describe("browser-safe persisted media facts", () => {
  it("normalizes serialized sparse nulls without losing attachment positions", () => {
    expect(
      readCanonicalPersistedMediaFacts({
        __openclaw: {
          media: [null, { path: "/media/image.png", contentType: "image/png" }],
        },
      }),
    ).toEqual([
      {
        path: undefined,
        url: undefined,
        contentType: undefined,
        kind: undefined,
        transcribed: false,
        messageId: undefined,
      },
      {
        path: "/media/image.png",
        url: undefined,
        contentType: "image/png",
        kind: "image",
        transcribed: false,
        messageId: undefined,
      },
    ]);
  });

  it("preserves defaults and index callbacks for serialized sparse attachment slots", () => {
    const media = JSON.parse('[null,{"url":"media://inbound/voice.ogg"}]') as MediaFactInput[];

    expect(
      normalizePersistedMediaFacts(media, {
        kind: "audio",
        messageId: "message-1",
        workspaceDir: "/workspace",
        transcribed: (_fact, index) => index === 1,
      }),
    ).toEqual([
      {
        path: undefined,
        url: undefined,
        contentType: undefined,
        kind: "audio",
        transcribed: false,
        messageId: "message-1",
        workspaceDir: "/workspace",
      },
      {
        path: undefined,
        url: "media://inbound/voice.ogg",
        contentType: undefined,
        kind: "audio",
        transcribed: true,
        messageId: "message-1",
        workspaceDir: "/workspace",
      },
    ]);
  });

  it.each([
    { contentType: " IMAGE/PNG ; charset=binary ", kind: "image" },
    { contentType: "image/apng", kind: "image" },
    { contentType: " AUDIO/OGG; codecs=opus ", kind: "audio" },
    { contentType: "application/pdf; charset=binary", kind: "document" },
    { contentType: "unknown/custom", kind: undefined },
  ])("classifies $contentType without changing its persisted value", ({ contentType, kind }) => {
    expect(normalizePersistedMediaFacts([{ contentType }])).toEqual([
      {
        path: undefined,
        url: undefined,
        contentType: contentType.trim(),
        kind,
        transcribed: false,
        messageId: undefined,
      },
    ]);
  });

  it("preserves sparse positions, explicit kinds, staging, and hydration suppression", () => {
    expect(
      readCanonicalPersistedMediaFacts({
        __openclaw: {
          media: [
            {},
            {
              path: " /media/image.png ",
              contentType: "image/png",
              kind: "sticker",
              staged: true,
              hydrationSuppressed: true,
            },
          ],
        },
      }),
    ).toEqual([
      {
        path: undefined,
        url: undefined,
        contentType: undefined,
        kind: undefined,
        transcribed: false,
        messageId: undefined,
      },
      {
        path: "/media/image.png",
        url: undefined,
        contentType: "image/png",
        kind: "sticker",
        transcribed: false,
        messageId: undefined,
        staged: true,
        hydrationSuppressed: true,
      },
    ]);
  });

  it("ignores retired top-level attachment carriers", () => {
    expect(
      readCanonicalPersistedMediaFacts({
        media: [{ path: "/media/legacy.png", contentType: "image/png" }],
        MediaPath: "/media/other-legacy.png",
      }),
    ).toBeUndefined();
  });

  it("does not classify sparse placeholders or unknown kinds as attachments", () => {
    expect(isMeaningfulPersistedMediaFact({})).toBe(false);
    expect(isMeaningfulPersistedMediaFact({ kind: "unknown" })).toBe(false);
    expect(isMeaningfulPersistedMediaFact({ contentType: "image/png" })).toBe(true);
    expect(isMeaningfulPersistedMediaFact({ kind: "sticker" })).toBe(true);
  });
});
