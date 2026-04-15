import { CHANNEL_TEMPLATES, getTemplate } from "@/lib/templates";

describe("channel templates", () => {
  it("exposes the seeded GanSystems templates", () => {
    expect(CHANNEL_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(getTemplate("tank_level").label).toBe("Main Tank Level");
    expect(getTemplate("unknown").id).toBe("custom");
  });
});
