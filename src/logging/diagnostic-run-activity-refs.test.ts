// Covers release of retained session activity refs for long-lived Gateways.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activityByRef,
  pruneDiagnosticSessionActivityRefs,
  resolveSessionActivity,
} from "./diagnostic-run-activity-state.js";
import {
  createDiagnosticEmbeddedRunOwner,
  markDiagnosticEmbeddedRunStarted,
  markDiagnosticRunProgress,
  resetDiagnosticRunActivityForTest,
  startDiagnosticRunActivityTracking,
} from "./diagnostic-run-activity.js";

const TTL_MS = 30 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
  resetDiagnosticRunActivityForTest();
});

describe("diagnostic session activity refs", () => {
  it("releases idle activities whose ttl expired", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.parse("2026-10-20T00:00:00Z");
    vi.setSystemTime(startedAt);
    startDiagnosticRunActivityTracking();
    markDiagnosticRunProgress({
      sessionId: "idle-session",
      sessionKey: "agent:main:webchat",
      reason: "model_call:stream_progress",
    });
    expect(activityByRef.size).toBeGreaterThan(0);

    vi.setSystemTime(startedAt + TTL_MS + 60_000);
    pruneDiagnosticSessionActivityRefs(Date.now(), true);

    expect(activityByRef.size).toBe(0);
  });

  it("keeps activities that still have an active embedded run", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.parse("2026-10-20T00:00:00Z");
    vi.setSystemTime(startedAt);
    startDiagnosticRunActivityTracking();
    const ref = {
      sessionId: "active-session",
      sessionKey: "agent:main:webchat",
      runId: "active-run",
    };
    const owner = createDiagnosticEmbeddedRunOwner(ref);
    markDiagnosticEmbeddedRunStarted({ ...ref, owner });
    expect(activityByRef.size).toBeGreaterThan(0);

    vi.setSystemTime(startedAt + TTL_MS + 60_000);
    pruneDiagnosticSessionActivityRefs(Date.now(), true);

    expect(activityByRef.size).toBeGreaterThan(0);
    expect(resolveSessionActivity({ sessionId: ref.sessionId })).toBeDefined();
  });

  it("releases both refs of an evicted activity", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.parse("2026-10-20T00:00:00Z");
    vi.setSystemTime(startedAt);
    startDiagnosticRunActivityTracking();
    markDiagnosticRunProgress({
      sessionId: "paired-session",
      sessionKey: "agent:main:webchat",
      reason: "model_call:stream_progress",
    });
    expect(activityByRef.has("id:paired-session")).toBe(true);
    expect(activityByRef.has("key:agent:main:webchat")).toBe(true);

    vi.setSystemTime(startedAt + TTL_MS + 60_000);
    pruneDiagnosticSessionActivityRefs(Date.now(), true);

    // Releasing only one ref would keep the activity reachable through the other.
    expect(activityByRef.has("id:paired-session")).toBe(false);
    expect(activityByRef.has("key:agent:main:webchat")).toBe(false);
  });

  it("caps the retained activity set", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.parse("2026-10-20T00:00:00Z");
    vi.setSystemTime(startedAt);
    startDiagnosticRunActivityTracking();
    // Each run mints its own session identity, so each adds a distinct activity.
    for (let index = 0; index < 2_100; index++) {
      markDiagnosticRunProgress({
        sessionId: `run-${index}`,
        sessionKey: `agent:main:cron:job:run:${index}`,
        reason: "model_call:stream_progress",
      });
    }
    // The cap holds during normal operation, not only after an explicit prune.
    // An insertion may exceed the cap by one, exactly like the sibling session-state index.
    expect(new Set(activityByRef.values()).size).toBeLessThanOrEqual(2_001);

    pruneDiagnosticSessionActivityRefs(Date.now(), true);

    expect(new Set(activityByRef.values()).size).toBeLessThanOrEqual(2_000);
  });
});
