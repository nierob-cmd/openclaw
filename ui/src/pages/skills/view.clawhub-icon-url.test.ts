/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDialogMethodInstaller, createProps } from "./view.test-support.ts";
import { normalizeClawHubSkillIconUrl, renderSkills } from "./view.ts";

const dialogRestores: Array<() => void> = [];
const containers: HTMLElement[] = [];
const installDialogMethod = createDialogMethodInstaller(dialogRestores);

afterEach(() => {
  vi.restoreAllMocks();
  while (dialogRestores.length > 0) {
    dialogRestores.pop()?.();
  }
  while (containers.length > 0) {
    containers.pop()?.remove();
  }
});

describe("normalizeClawHubSkillIconUrl", () => {
  it.each([
    `https://clawhub.ai/api/v1/skill-icons/${"a".repeat(64)}`,
    `https://registry.example.test/api/v1/skill-icons/${"a".repeat(64)}`,
    `https://registry.example.test/clawhub/api/v1/skill-icons/${"a".repeat(64)}`,
    `https://registry.example.test/tenant/clawhub/api/v1/skill-icons/${"a".repeat(64)}`,
  ])("accepts canonical skill artwork %s", (iconUrl) => {
    expect(normalizeClawHubSkillIconUrl(iconUrl)).toBe(iconUrl);
  });

  it.each([
    `http://clawhub.ai/api/v1/skill-icons/${"a".repeat(64)}`,
    `https://clawhub.ai/api/v1/skill-icons/${"A".repeat(64)}`,
    `https://clawhub.ai/api/v1/skill-icons/${"a".repeat(64)}?download=1`,
    `https://clawhub.ai/api/v1/skill-icons/${"a".repeat(64)}#image`,
    `https://user@clawhub.ai/api/v1/skill-icons/${"a".repeat(64)}`,
    `https://clawhub.ai/clawhub//api/v1/skill-icons/${"a".repeat(64)}`,
    `https://clawhub.ai/clawhub%2Fprivate/api/v1/skill-icons/${"a".repeat(64)}`,
    `https://clawhub.ai/clawhub/api/v1/skill-icons/${"a".repeat(64)}/extra`,
    "https://clawhub.ai/profile.png",
    "/api/v1/skill-icons/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "not a url",
  ])("rejects noncanonical ClawHub icon source %s", (iconUrl) => {
    expect(normalizeClawHubSkillIconUrl(iconUrl)).toBeNull();
  });

  it("never renders unproxied ClawHub skill or owner images", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    installDialogMethod("showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    const icon = `https://clawhub.ai/api/v1/skill-icons/${"c".repeat(64)}`;
    render(
      renderSkills(
        createProps({
          clawhubResults: [{ score: 1, slug: "github", displayName: "GitHub", icon }],
          clawhubDetailRef: "github",
          clawhubDetail: {
            skill: {
              slug: "github",
              displayName: "GitHub",
              icon,
              createdAt: 1,
              updatedAt: 1,
            },
            owner: { image: "https://attacker.example/profile.png" },
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".clawhub-skill-icon")).toBeNull();
    expect(container.querySelector('img[src^="https:"]')).toBeNull();
    expect(container.querySelector(".clawhub-skill-icon--profile")).toBeNull();
  });
});
