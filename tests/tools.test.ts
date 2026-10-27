// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateCost,
  calculateCostInput,
  checkAvailability,
  checkAvailabilityInput,
  copperTools,
  getPrices,
  listProducts,
} from "@/lib/copper/assistant/tools";
import { getPlans, getProducts } from "@/lib/copper/catalog";
import * as inventory from "@/lib/copper/inventory";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockStock(rows: inventory.InventoryRow[] | null) {
  vi.spyOn(inventory, "readInventory").mockResolvedValue(rows);
}

const row = (
  product: string,
  color: string,
  units: number,
): inventory.InventoryRow => ({
  sku: `${product}-${color}`,
  product,
  color,
  units_in_stock: units,
  next_shipment: "2026-12-01",
});

describe("get_products and get_prices", () => {
  it("lists every product with its colors from the catalog", () => {
    const { products } = listProducts();
    expect(products.map((p) => [p.id, p.colors])).toEqual(
      getProducts().map((p) => [p.id, p.colors]),
    );
    expect(products[0]).not.toHaveProperty("features");
  });

  it("lists every product and plan price from the catalog", () => {
    const prices = getPrices();
    expect(prices.products.map((p) => p.priceUsd)).toEqual(
      getProducts().map((p) => p.priceUsd),
    );
    expect(prices.plans.map((p) => [p.monthlyUsd, p.annualUsd])).toEqual(
      getPlans().map((p) => [p.monthlyUsd, p.annualUsd]),
    );
  });
});

describe("calculate_cost", () => {
  it("counts Copper Plus once: Copper Home, yearly, 2 years is $307", () => {
    const result = calculateCost({
      products: ["copper-home"],
      plan: "copper-plus",
      billing: "annual",
      years: 2,
    });
    expect(result.totalUsd).toBe(307);
    expect(result.lines.map((l) => l.usd)).toEqual([149, 158]);
  });

  it("adds each device but still counts the plan once", () => {
    const result = calculateCost({
      products: ["copper-home", "copper-home"],
      plan: "copper-plus",
      billing: "annual",
      years: 2,
    });
    expect(result.totalUsd).toBe(456);
  });

  it("bills monthly as 12 months a year, rounded to cents", () => {
    const result = calculateCost({
      products: ["copper-notes"],
      plan: "copper-plus",
      billing: "monthly",
      years: 3,
    });
    expect(result.lines.map((l) => l.usd)).toEqual([129, 287.64]);
    expect(result.totalUsd).toBe(416.64);
  });

  it("adds no line for the free plan", () => {
    const result = calculateCost({
      products: ["copper-home", "copper-notes"],
      plan: "free",
      billing: "monthly",
      years: 1,
    });
    expect(result.lines).toHaveLength(2);
    expect(result.totalUsd).toBe(278);
  });

  it("rejects input outside the contract", () => {
    const ok = {
      products: ["copper-home"],
      plan: "copper-plus",
      billing: "annual",
      years: 2,
    };
    expect(calculateCostInput.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, products: ["copper-watch"] },
      { ...ok, products: Array(6).fill("copper-home") },
      { ...ok, plan: "copper-max" },
      { ...ok, billing: "weekly" },
      { ...ok, years: 0 },
      { ...ok, years: 6 },
      { ...ok, years: 1.5 },
    ]) {
      expect(calculateCostInput.safeParse(bad).success).toBe(false);
    }
  });
});

describe("check_availability", () => {
  it("sorts each color into in stock, low stock or back-ordered", async () => {
    mockStock([
      row("Copper Home", "Polished Copper", 10),
      row("Copper Home", "Patina Teal", 9),
      row("Copper Home", "Night Sky", 0),
      row("Copper Notes", "Night Sky", 50),
    ]);
    expect(await checkAvailability({ product: "copper-home" })).toEqual({
      status: "ok",
      product: "Copper Home",
      colors: [
        { color: "Polished Copper", stock: "in_stock", restockDate: null },
        { color: "Patina Teal", stock: "low_stock", restockDate: null },
        { color: "Night Sky", stock: "backordered", restockDate: "2026-12-01" },
      ],
    });
  });

  it("matches one color in any capitalization and answers in the catalog's", async () => {
    mockStock([row("Copper Notes", "Night Sky", 0)]);
    const result = await checkAvailability({
      product: "copper-notes",
      color: "night SKY",
    });
    expect(result).toEqual({
      status: "ok",
      product: "Copper Notes",
      colors: [
        { color: "Night Sky", stock: "backordered", restockDate: "2026-12-01" },
      ],
    });
  });

  it("leaves out a color with no stock row", async () => {
    mockStock([row("Copper Home", "Night Sky", 40)]);
    const result = await checkAvailability({ product: "copper-home" });
    expect(result.status === "ok" && result.colors.map((c) => c.color)).toEqual(
      ["Night Sky"],
    );
  });

  it("reads stock every time it runs", async () => {
    mockStock([row("Copper Home", "Night Sky", 40)]);
    await checkAvailability({ product: "copper-home", color: "Night Sky" });
    mockStock([row("Copper Home", "Night Sky", 0)]);
    const result = await checkAvailability({
      product: "copper-home",
      color: "Night Sky",
    });
    expect(result.status === "ok" && result.colors[0].stock).toBe(
      "backordered",
    );
  });

  it('says "not_a_color" for Copper Notes in Patina Teal, even when stock is down', async () => {
    mockStock(null);
    expect(
      await checkAvailability({
        product: "copper-notes",
        color: "Patina Teal",
      }),
    ).toEqual({
      status: "not_a_color",
      product: "Copper Notes",
      color: "Patina Teal",
      colors: ["Brushed Copper", "Desert Sand", "Night Sky"],
    });
  });

  it("says stock can't be checked, without any stock levels", async () => {
    mockStock(null);
    const result = await checkAvailability({ product: "copper-home" });
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toMatch(
      /in_stock|low_stock|backordered/,
    );
  });

  it("only accepts a Copper product", () => {
    expect(
      checkAvailabilityInput.safeParse({ product: "copper-watch" }).success,
    ).toBe(false);
    expect(
      checkAvailabilityInput.safeParse({
        product: "copper-home",
        color: "Night Sky",
      }).success,
    ).toBe(true);
  });
});

describe("copperTools", () => {
  it("has exactly the four tools, each described", () => {
    expect(Object.keys(copperTools).sort()).toEqual([
      "calculate_cost",
      "check_availability",
      "get_prices",
      "get_products",
    ]);
    for (const t of Object.values(copperTools)) {
      expect(t.description).toBeTruthy();
    }
  });
});
