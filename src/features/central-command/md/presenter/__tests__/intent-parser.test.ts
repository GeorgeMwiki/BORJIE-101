/**
 * Intent Parser — fixture coverage.
 *
 * Every rule in `intent-parser.ts` MUST have at least one fixture
 * here. The fixtures double as ground-truth examples of how the
 * owner speaks.
 */

import { describe, expect, it } from "vitest";

import {
  parseOwnerIntent,
  inferOwnerStyleHint,
  listIntentRules,
} from "../intent-parser";

interface Fixture {
  readonly text: string;
  readonly expectKind:
    | "table"
    | "chart"
    | "metric-grid"
    | "file-preview"
    | "diagram"
    | "form";
  readonly expectSubject:
    | "employees"
    | "team"
    | "customers"
    | "top-customer"
    | "sales-trend"
    | "revenue"
    | "cash-position"
    | "supplier-contract"
    | "org-chart"
    | "kpi-summary"
    | "expenses"
    | "outstanding-invoices"
    | "pending-approvals";
}

const FIXTURES: ReadonlyArray<Fixture> = [
  // table — team
  { text: "show me the team", expectKind: "table", expectSubject: "employees" },
  { text: "List the staff", expectKind: "table", expectSubject: "employees" },
  {
    text: "who is on the team?",
    expectKind: "table",
    expectSubject: "employees",
  },
  { text: "give me the crew", expectKind: "table", expectSubject: "employees" },
  { text: "team roster", expectKind: "table", expectSubject: "employees" },

  // diagram — org chart
  {
    text: "what's the org chart",
    expectKind: "diagram",
    expectSubject: "org-chart",
  },
  {
    text: "show the organization chart",
    expectKind: "diagram",
    expectSubject: "org-chart",
  },
  {
    text: "who reports to who?",
    expectKind: "diagram",
    expectSubject: "org-chart",
  },

  // metric-grid — top customer
  {
    text: "who's our top customer",
    expectKind: "metric-grid",
    expectSubject: "top-customer",
  },
  {
    text: "biggest client this quarter",
    expectKind: "metric-grid",
    expectSubject: "top-customer",
  },

  // table — customers
  { text: "show customers", expectKind: "table", expectSubject: "customers" },
  {
    text: "list our customers",
    expectKind: "table",
    expectSubject: "customers",
  },

  // chart — sales-trend / revenue
  {
    text: "how are sales trending",
    expectKind: "chart",
    expectSubject: "sales-trend",
  },
  {
    text: "sales over time",
    expectKind: "chart",
    expectSubject: "sales-trend",
  },
  {
    text: "how are sales this month?",
    expectKind: "chart",
    expectSubject: "sales-trend",
  },
  { text: "revenue chart", expectKind: "chart", expectSubject: "revenue" },

  // metric-grid — kpis / dashboard
  {
    text: "show the KPIs",
    expectKind: "metric-grid",
    expectSubject: "kpi-summary",
  },
  {
    text: "how are we doing",
    expectKind: "metric-grid",
    expectSubject: "kpi-summary",
  },
  {
    text: "business overview",
    expectKind: "metric-grid",
    expectSubject: "kpi-summary",
  },

  // metric-grid — cash
  {
    text: "how much cash do we have",
    expectKind: "metric-grid",
    expectSubject: "cash-position",
  },
  {
    text: "cash on hand",
    expectKind: "metric-grid",
    expectSubject: "cash-position",
  },

  // chart — expenses
  {
    text: "expenses trend last quarter",
    expectKind: "chart",
    expectSubject: "expenses",
  },
  {
    text: "spend breakdown by category",
    expectKind: "chart",
    expectSubject: "expenses",
  },

  // table — outstanding invoices
  {
    text: "outstanding invoices",
    expectKind: "table",
    expectSubject: "outstanding-invoices",
  },
  {
    text: "show overdue receivables",
    expectKind: "table",
    expectSubject: "outstanding-invoices",
  },

  // table — pending approvals
  {
    text: "pending approvals",
    expectKind: "table",
    expectSubject: "pending-approvals",
  },
  {
    text: "outstanding sign-offs",
    expectKind: "table",
    expectSubject: "pending-approvals",
  },

  // file-preview — supplier contract
  {
    text: "show the supplier contract",
    expectKind: "file-preview",
    expectSubject: "supplier-contract",
  },
  {
    text: "open the vendor agreement",
    expectKind: "file-preview",
    expectSubject: "supplier-contract",
  },
  {
    text: "pull up our supplier contract",
    expectKind: "file-preview",
    expectSubject: "supplier-contract",
  },

  // form — log a new hire
  { text: "log a new hire", expectKind: "form", expectSubject: "employees" },
  {
    text: "register a new employee",
    expectKind: "form",
    expectSubject: "employees",
  },
];

describe("parseOwnerIntent — fixtures", () => {
  for (const fx of FIXTURES) {
    it(`classifies "${fx.text}" → ${fx.expectKind}/${fx.expectSubject}`, () => {
      const result = parseOwnerIntent({ text: fx.text });
      expect(result).not.toBeNull();
      expect(result?.kind).toBe(fx.expectKind);
      expect(result?.subject).toBe(fx.expectSubject);
    });
  }
});

describe("parseOwnerIntent — negative cases", () => {
  it.each([
    "hello",
    "thanks!",
    "what's the weather",
    "approve the application",
    "",
    "   ",
  ])("returns null for non-inline-data turn: %s", (text) => {
    expect(parseOwnerIntent({ text })).toBeNull();
  });

  it("returns null when text is pathologically long", () => {
    const text = "show me the team " + "x".repeat(2_500);
    expect(parseOwnerIntent({ text })).toBeNull();
  });
});

describe("parseOwnerIntent — filter extraction", () => {
  it("extracts a window=last_month filter", () => {
    const result = parseOwnerIntent({
      text: "how are sales trending last month",
    });
    expect(result?.filters?.window).toBe("last_month");
  });

  it("extracts a window=this_quarter filter", () => {
    const result = parseOwnerIntent({
      text: "biggest client this quarter",
    });
    expect(result?.filters?.window).toBe("this_quarter");
  });

  it("extracts a department filter", () => {
    const result = parseOwnerIntent({
      text: "show me the team in engineering",
    });
    expect(result?.filters?.department).toBe("engineering");
  });

  it("returns no filters when none are present", () => {
    const result = parseOwnerIntent({ text: "show me the team" });
    expect(result?.filters).toBeUndefined();
  });
});

describe("parseOwnerIntent — owner-style hint", () => {
  it("respects an explicit hint from the caller", () => {
    const result = parseOwnerIntent({
      text: "show me the team",
      ownerStyleHint: "verbose",
    });
    expect(result?.ownerStyleHint).toBe("verbose");
  });

  it("infers a hint when none is supplied", () => {
    const result = parseOwnerIntent({ text: "show team" });
    expect(result?.ownerStyleHint).toBe("terse");
  });
});

describe("inferOwnerStyleHint", () => {
  it("returns terse for very short messages", () => {
    expect(inferOwnerStyleHint("show team")).toBe("terse");
  });

  it("returns verbose for long or narrative messages", () => {
    expect(
      inferOwnerStyleHint(
        "could you please walk me through the team and what they have been working on this year",
      ),
    ).toBe("verbose");
  });

  it("returns balanced for typical questions", () => {
    expect(inferOwnerStyleHint("show me the team please")).toBe("balanced");
  });
});

describe("listIntentRules", () => {
  it("returns a frozen catalogue", () => {
    const rules = listIntentRules();
    expect(rules.length).toBeGreaterThan(10);
    expect(Object.isFrozen(rules)).toBe(true);
  });
});
