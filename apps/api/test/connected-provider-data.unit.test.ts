import { describe, expect, it, vi } from "vitest";
import { ConnectedProviderDataService } from "../src/connected-provider-data/connected-provider-data.service.js";

const owner = "00000000-0000-4000-8000-000000000001";
function fixture() {
  const store = { readFitnessDays: vi.fn().mockResolvedValue([]), readNutritionDay: vi.fn().mockResolvedValue(null), listBodyComposition: vi.fn().mockResolvedValue([]) };
  const service = new ConnectedProviderDataService({ getPersonId: () => owner } as never,
    { getPreferences: vi.fn().mockResolvedValue({ timezone: "Europe/Belgrade" }) } as never, store as never);
  return { service, store };
}

describe("connected provider reads", () => {
  it("binds every query to the authorized Person and retains absent nutrition as null", async () => {
    const { service, store } = fixture();
    expect(await service.fitness({ fromDate: "2026-11-20", toDate: "2026-11-21" })).toEqual({ items: [] });
    expect(store.readFitnessDays).toHaveBeenCalledWith(owner, "2026-11-20", "2026-11-21");
    expect(await service.nutrition("2026-11-21")).toEqual({ item: null });
    expect(store.readNutritionDay).toHaveBeenCalledWith(owner, "2026-11-21");
    await service.bodyComposition({ fromDate: "2026-11-20", limit: 10 });
    expect(store.listBodyComposition).toHaveBeenCalledWith(owner, { fromDate: "2026-11-20", limit: 10 });
  });
  it("rejects reversed, invalid and unbounded ranges before accessing storage", async () => {
    const { service, store } = fixture();
    await expect(service.fitness({ fromDate: "2026-11-21", toDate: "2026-11-20" })).rejects.toThrow();
    await expect(service.fitness({ fromDate: "2025-01-01", toDate: "2026-11-20" })).rejects.toThrow();
    await expect(service.nutrition("2026-02-30")).rejects.toThrow();
    await expect(service.bodyComposition({ limit: 101 })).rejects.toThrow();
    expect(store.readFitnessDays).not.toHaveBeenCalled();
    expect(store.readNutritionDay).not.toHaveBeenCalled();
    expect(store.listBodyComposition).not.toHaveBeenCalled();
  });
  it("reports an unavailable backend rather than fabricating an empty import", async () => {
    const service = new ConnectedProviderDataService({} as never, {} as never);
    expect(service.isConfigured()).toBe(false);
    await expect(service.nutrition("2026-11-21")).rejects.toThrow("unavailable");
  });
});
