import { describe, expect, it } from "vitest";
import {
  ONBOARDING_FIELDS,
  buildConfirmationBanner,
  getNextField,
  initialState,
  isReadyToConfirm,
  selectRegister,
  updateField,
} from "../conversational-onboarding-state";

describe("conversational-onboarding-state", () => {
  it("starts at displayName step", () => {
    const s = initialState();
    expect(s.currentStep).toBe("displayName");
    expect(getNextField(s)?.id).toBe("displayName");
  });

  it("updateField is pure - never mutates input", () => {
    const before = initialState();
    const after = updateField({
      state: before,
      fieldId: "displayName",
      value: "Asha",
      fromMessage: "I am Asha",
    });
    expect(before.fields).toEqual({});
    expect(after.fields.displayName).toBe("Asha");
    expect(after).not.toBe(before);
  });

  it("records provenance with timestamp + source message", () => {
    const s = updateField({
      state: initialState(),
      fieldId: "displayName",
      value: "Asha",
      fromMessage: "I am Asha",
    });
    const prov = s.provenance.displayName;
    expect(prov).toBeDefined();
    expect(prov?.fromMessage).toBe("I am Asha");
    expect(prov?.confidence).toBe("high");
    expect(prov?.extractedAt).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("advances to confirm once all required fields are set", () => {
    let s = initialState();
    const required = ONBOARDING_FIELDS.filter((f) => f.required);
    for (const f of required) {
      s = updateField({
        state: s,
        fieldId: f.id,
        value: `value-for-${f.id}`,
        fromMessage: `from ${f.id}`,
      });
    }
    expect(s.currentStep).toBe("confirm");
    expect(isReadyToConfirm(s)).toBe(true);
  });

  it("buildConfirmationBanner shows every set field with provenance", () => {
    const s = updateField({
      state: initialState(),
      fieldId: "displayName",
      value: "Asha",
      fromMessage: "I am Asha",
    });
    const banner = buildConfirmationBanner(s);
    expect(banner.rows).toHaveLength(1);
    expect(banner.rows[0]?.value).toBe("Asha");
    expect(banner.rows[0]?.provenanceText).toMatch(/From your message/);
  });

  it("selectRegister maps affect to register", () => {
    expect(selectRegister("anxious")).toBe("gentle");
    expect(selectRegister("frustrated")).toBe("matter-of-fact");
    expect(selectRegister("curious")).toBe("encouraging");
    expect(selectRegister("neutral")).toBe("neutral");
  });
});
