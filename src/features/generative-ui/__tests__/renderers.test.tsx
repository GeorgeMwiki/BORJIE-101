/**
 * RTL smoke tests for each generative-UI renderer.
 *
 * Goal: render each component with a valid spec, assert that the aria
 * label and key text content reach the DOM. Heavy interactive paths
 * (mapbox layout, mermaid render) are covered indirectly via fallback
 * branches because the real packages are not installed at test time.
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ChartRechartsTimeSeries from "../ChartRechartsTimeSeries";
import ChartVegaLite from "../ChartVegaLite";
import TableTanStack from "../TableTanStack";
import FormSchemaDriven from "../FormSchemaDriven";
import ConfirmDialog from "../ConfirmDialog";
import MetricGrid from "../MetricGrid";
import MapMapbox from "../MapMapbox";
import MermaidDiagram from "../MermaidDiagram";
import MarkdownRender from "../MarkdownRender";
import { GenerativeUiMessage } from "../GenerativeUiMessage";

describe("ChartRechartsTimeSeries", () => {
  it("renders the chart figure with derived aria label", () => {
    render(
      <ChartRechartsTimeSeries
        spec={{
          kind: "chart.recharts.timeseries",
          title: "LC arousal",
          ariaLabel: "LC arousal time series, 1 series, 2 points",
          series: [
            {
              name: "arousal",
              data: [
                { t: 1, y: 0.3 },
                { t: 2, y: 0.7 },
              ],
            },
          ],
        }}
      />,
    );
    const figure = screen.getByLabelText(/LC arousal/);
    expect(figure).toBeInTheDocument();
  });

  it("exposes a data table fallback summary for screen readers", () => {
    render(
      <ChartRechartsTimeSeries
        spec={{
          kind: "chart.recharts.timeseries",
          ariaLabel: "ts",
          series: [{ name: "a", data: [{ t: "x", y: 1 }] }],
        }}
      />,
    );
    expect(screen.getByText("Data table")).toBeInTheDocument();
  });
});

describe("ChartVegaLite", () => {
  it("renders a figcaption when title is supplied", () => {
    render(
      <ChartVegaLite
        spec={{
          kind: "chart.vega-lite",
          title: "Vega chart",
          spec: { mark: "bar" },
        }}
      />,
    );
    expect(screen.getByText("Vega chart")).toBeInTheDocument();
  });

  it("falls back to JSON preview when react-vega is unavailable", () => {
    render(
      <ChartVegaLite
        spec={{
          kind: "chart.vega-lite",
          spec: { mark: "bar", data: { values: [] } },
        }}
      />,
    );
    expect(screen.getByLabelText(/Vega-Lite chart/)).toBeInTheDocument();
  });
});

describe("TableTanStack", () => {
  it("renders columns and rows", () => {
    render(
      <TableTanStack
        spec={{
          kind: "table",
          title: "Officers",
          columns: [
            { key: "name", label: "Name" },
            { key: "tier", label: "Tier" },
          ],
          rows: [
            { name: "Asha", tier: "supervised" },
            { name: "Juma", tier: "sandbox" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Officers")).toBeInTheDocument();
    expect(screen.getByText("Asha")).toBeInTheDocument();
    expect(screen.getByText("Juma")).toBeInTheDocument();
  });

  it("renders a No rows message for empty tables", () => {
    render(
      <TableTanStack
        spec={{
          kind: "table",
          columns: [{ key: "x", label: "X" }],
          rows: [],
        }}
      />,
    );
    expect(screen.getByText("No rows")).toBeInTheDocument();
  });
});

describe("FormSchemaDriven", () => {
  it("renders labelled inputs from the spec", () => {
    render(
      <FormSchemaDriven
        spec={{
          kind: "form",
          title: "Officer",
          fields: [
            {
              name: "name",
              kind: "text",
              label: "Officer name",
              required: true,
            },
          ],
          submitAction: { tool: "officer.create" },
        }}
      />,
    );
    expect(screen.getByLabelText(/Officer name/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
  });

  it("shows the four-eye banner when requested", () => {
    render(
      <FormSchemaDriven
        spec={{
          kind: "form",
          fields: [{ name: "x", kind: "text", label: "x" }],
          submitAction: { tool: "noop" },
          requiresFourEye: true,
        }}
      />,
    );
    expect(screen.getByText(/four-eye approval/i)).toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("renders the title, body, and confirm button", () => {
    render(
      <ConfirmDialog
        spec={{
          kind: "confirm",
          title: "Approve disbursement",
          body: "This will release 50,000 USD.",
          severity: "destructive",
          confirmAction: { tool: "disbursement.release" },
        }}
      />,
    );
    expect(screen.getByText("Approve disbursement")).toBeInTheDocument();
    expect(
      screen.getByText("This will release 50,000 USD."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /confirm/i }),
    ).toBeInTheDocument();
  });
});

describe("MetricGrid", () => {
  it("renders metric labels and values", () => {
    render(
      <MetricGrid
        spec={{
          kind: "metric.grid",
          metrics: [
            { label: "DSCR", value: 1.4, unit: "x", delta: 0.1, trend: "up" },
            { label: "LTV", value: 65, unit: "%", delta: -2, trend: "down" },
          ],
        }}
      />,
    );
    expect(screen.getByText("DSCR")).toBeInTheDocument();
    expect(screen.getByText("LTV")).toBeInTheDocument();
    expect(screen.getByText("1.4")).toBeInTheDocument();
  });
});

describe("MapMapbox", () => {
  it("renders the figure and marker list", () => {
    render(
      <MapMapbox
        spec={{
          kind: "map",
          title: "Project sites",
          center: [-6.79, 39.2],
          zoom: 8,
          markers: [
            { lat: -6.78, lng: 39.21, label: "Dar HQ" },
            { lat: -3.36, lng: 36.68, label: "Arusha" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Project sites")).toBeInTheDocument();
    expect(screen.getByText(/Marker list/)).toBeInTheDocument();
  });
});

describe("MermaidDiagram", () => {
  it("renders the source listing while mermaid loads", () => {
    render(
      <MermaidDiagram
        spec={{
          kind: "mermaid",
          title: "Approval flow",
          diagram: "graph TD; A-->B",
        }}
      />,
    );
    expect(screen.getByText("Approval flow")).toBeInTheDocument();
    expect(screen.getByText("Diagram source")).toBeInTheDocument();
  });
});

describe("MarkdownRender", () => {
  it("renders markdown and drops raw HTML by default", () => {
    render(
      <MarkdownRender
        spec={{
          kind: "markdown",
          markdown:
            "# Heading\n\n<script>alert('xss')</script>\n\nSafe **bold** text.",
        }}
      />,
    );
    expect(screen.getByText("Heading")).toBeInTheDocument();
    // react-markdown without rehype-raw renders the script tag as plain
    // text, never as an executable script.
    expect(document.querySelector("script")).toBeNull();
  });
});

describe("GenerativeUiMessage", () => {
  it("splits a mixed message into text + spec segments", async () => {
    const message = `Here is your metric: <generative-ui>${JSON.stringify({
      kind: "metric.grid",
      metrics: [{ label: "Approval rate", value: "92%", unit: "" }],
    })}</generative-ui> Anything else?`;
    render(<GenerativeUiMessage content={message} />);
    expect(screen.getByText(/Here is your metric/)).toBeInTheDocument();
    expect(screen.getByText(/Anything else/)).toBeInTheDocument();
    // Suspense resolves the lazy renderer asynchronously.
    await waitFor(() =>
      expect(screen.getByText("Approval rate")).toBeInTheDocument(),
    );
  });

  it("renders an alert when a generative-ui block is malformed", () => {
    render(
      <GenerativeUiMessage
        content={`prefix <generative-ui>{not-json}</generative-ui> tail`}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("never executes injected scripts inside markdown specs", async () => {
    const payload = JSON.stringify({
      kind: "markdown",
      markdown: "<script>alert('xss')</script>**bold**",
    });
    render(
      <GenerativeUiMessage
        content={`<generative-ui>${payload}</generative-ui>`}
      />,
    );
    // Even after Suspense resolution, no script tag should exist.
    await waitFor(() => {
      expect(document.querySelector("script")).toBeNull();
    });
  });
});
