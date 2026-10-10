import { describe, expect, it } from "vitest";
import type { Prediction } from "@/simulation/vehicle-sim";
import { evaluateRisk } from "./risk";

const H = 3_600_000;
const p = (arrivalH: number, extra: Partial<Prediction> = {}): Prediction => ({
  arrivalMs: arrivalH * H,
  drivingMin: 0,
  breakMin: 0,
  restMin: 0,
  waitMin: 0,
  handlingMin: 0,
  breaks: 0,
  restRequired: false,
  firstBreakAfterDrivingMin: null,
  ...extra,
});

describe("evaluateRisk", () => {
  it("is green with time to spare and no break soon", () => {
    expect(evaluateRisk({ subjectTo561: true, delivery: p(3), deliveryToMs: 5 * H })).toMatchObject({ state: "green", bufferMin: 120 });
  });

  it("is yellow when a break is due within an hour of driving", () => {
    const r = evaluateRisk({ subjectTo561: true, delivery: p(3, { firstBreakAfterDrivingMin: 15, breaks: 1 }), deliveryToMs: 5 * H });
    expect(r).toMatchObject({ state: "yellow", reasons: ["break_soon"] });
  });

  it("stays green when the next break is hours away", () => {
    const r = evaluateRisk({ subjectTo561: true, delivery: p(8, { firstBreakAfterDrivingMin: 240, breaks: 1 }), deliveryToMs: 10 * H });
    expect(r.state).toBe("green");
  });

  it("is yellow with less than 30 minutes to spare", () => {
    expect(evaluateRisk({ subjectTo561: true, delivery: p(4.75), deliveryToMs: 5 * H }).reasons).toEqual(["tight_buffer"]);
  });

  it("is red when late or when a daily rest is needed", () => {
    expect(evaluateRisk({ subjectTo561: true, delivery: p(6), deliveryToMs: 5 * H })).toMatchObject({ state: "red", reasons: ["late_delivery"] });
    expect(evaluateRisk({ subjectTo561: true, delivery: p(3, { restRequired: true }), deliveryToMs: 20 * H }).reasons).toEqual(["daily_rest_needed"]);
  });

  it("checks the pickup window before loading", () => {
    const r = evaluateRisk({ subjectTo561: true, delivery: p(6), deliveryToMs: 9 * H, pickup: { prediction: p(3), toMs: 2 * H } });
    expect(r).toMatchObject({ state: "red", reasons: ["late_pickup"] });
  });

  it("ignores breaks and rests for vans outside Regulation 561/2006", () => {
    const r = evaluateRisk({ subjectTo561: false, delivery: p(3, { restRequired: true, firstBreakAfterDrivingMin: 5 }), deliveryToMs: 5 * H });
    expect(r.state).toBe("green");
  });

  it("is red without a prediction", () => {
    expect(evaluateRisk({ subjectTo561: true, delivery: null, deliveryToMs: 5 * H }).state).toBe("red");
  });
});
