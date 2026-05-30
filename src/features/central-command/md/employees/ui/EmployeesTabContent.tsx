"use client";

/**
 * EmployeesTabContent — lazy-loaded client tab.
 *
 * Iter-28 Phase B proof of the lazy + realtime projection pattern:
 *   - The /md/employees route segment dynamic-imports this component
 *     so the initial MD chat bundle stays small (mobile-first).
 *   - The hook subscribes to supabase realtime so the table updates
 *     LIVE when the MD calls `create_employee_from_chat`.
 *   - NO mock rows. Empty-state UI says "no employees on record yet"
 *     with the path back to chat to add them via natural language.
 *
 * @module features/central-command/md/employees/ui/EmployeesTabContent
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useEmployeesRealtime, type EmployeeRow } from "./useEmployeesRealtime";

interface Identity {
  readonly tenantId: string;
  readonly userId: string;
}

function readContactSummary(row: EmployeeRow): string {
  const md = row.metadata ?? {};
  const channels: string[] = [];
  if (typeof md.whatsapp === "string" && md.whatsapp.length > 0)
    channels.push("WhatsApp");
  if (typeof md.phone === "string" && md.phone.length > 0) channels.push("SMS");
  if (typeof md.email === "string" && md.email.length > 0)
    channels.push("Email");
  if (channels.length === 0) return "(no contact on file)";
  return channels.join(" · ");
}

function formatHireDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export default function EmployeesTabContent(): React.JSX.Element {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  // Resolve identity from the supabase session. tenantId derives from
  // org_id metadata (multi-tenant orgs) or bank_id (vanilla banks).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (error) {
          setIdentityError(error.message);
          return;
        }
        if (!user) {
          setIdentityError("Not signed in.");
          return;
        }
        const md = (user.user_metadata ?? {}) as Record<string, unknown>;
        const tenantId =
          (typeof md.org_id === "string" && md.org_id) ||
          (typeof md.bank_id === "string" && md.bank_id) ||
          null;
        if (!tenantId) {
          setIdentityError(
            "No org_id / bank_id on profile — operator metadata missing.",
          );
          return;
        }
        setIdentity({ tenantId, userId: user.id });
      } catch (err) {
        if (!cancelled) {
          setIdentityError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { employees, hasData, isLoading, loadError } = useEmployeesRealtime(
    identity?.tenantId ?? null,
  );

  if (identityError) {
    return (
      <div
        role="alert"
        className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        {identityError}
      </div>
    );
  }
  if (!identity || isLoading) {
    return (
      <div
        role="status"
        className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
      >
        Loading employees…
      </div>
    );
  }
  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        {loadError}
      </div>
    );
  }
  if (!hasData) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
        <h2 className="text-base font-medium text-slate-800">
          No employees on record yet
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Open the MD chat and say something like{" "}
          <em>
            &ldquo;add Asha Mwamba as our new credit officer, hired today,
            whatsapp +255 712 345 678&rdquo;
          </em>
          . The Employees tab will update automatically.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Employees"
      data-testid="md-employees-tab"
      className="space-y-3"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-base font-medium text-slate-800">
          Employees ({employees.length})
        </h2>
        <p className="text-xs text-slate-500">Live · auto-updates from chat</p>
      </header>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {employees.map((row) => (
          <li
            key={row.id}
            data-testid={`md-employee-row-${row.id}`}
            className="flex items-center justify-between px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-slate-900">{row.name}</p>
              <p className="text-xs text-slate-500">
                {row.role} · hired {formatHireDate(row.hire_date)}
              </p>
            </div>
            <p className="text-xs text-slate-500">{readContactSummary(row)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
