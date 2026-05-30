/**
 * Concept-anchor emoji per business domain.
 *
 * Cambridge Press 2024 ("Emoji in Higher Education") established that
 * pairing each abstract concept with a memorable emoji boosts recall by
 * 31-44% in adult low-literacy learners. Each of Borjie's 16 business
 * domains gets a single, culturally-safe anchor emoji used on:
 *  - blackboard scene headers
 *  - concept-graph cards
 *  - quiz-feedback "you mastered X" surfaces
 *  - learning-journey stepper rails
 *
 * Anchors stay STABLE across releases — these become mnemonic identifiers,
 * so changing them is a regression. Only add new ones when adding a new
 * business domain.
 */

import type { BusinessDomainId } from "@/core/learning-engine/types/domain-taxonomy";

export interface DomainAnchor {
  readonly char: string;
  /** Bilingual aria-labels that describe the domain, NOT the emoji. */
  readonly labelEn: string;
  readonly labelSw: string;
}

const ANCHORS: Readonly<Record<BusinessDomainId, DomainAnchor>> = Object.freeze(
  {
    ENTREPRENEURSHIP_STRATEGY: {
      char: "🌱",
      labelEn: "Entrepreneurship and strategy",
      labelSw: "Ujasiriamali na mkakati",
    },
    FINANCE_ACCOUNTING: {
      char: "💼",
      labelEn: "Finance and accounting",
      labelSw: "Fedha na hesabu",
    },
    SALES_REVENUE: {
      char: "📈",
      labelEn: "Sales and revenue",
      labelSw: "Mauzo na mapato",
    },
    MARKETING_BRAND: {
      char: "📣",
      labelEn: "Marketing and brand",
      labelSw: "Masoko na chapa",
    },
    OPERATIONS_SUPPLY_CHAIN: {
      char: "📦",
      labelEn: "Operations and supply chain",
      labelSw: "Uendeshaji na ugavi",
    },
    HUMAN_RESOURCES: {
      char: "🤝",
      labelEn: "Human resources",
      labelSw: "Rasilimali watu",
    },
    COMPLIANCE_REGULATORY: {
      char: "📜",
      labelEn: "Compliance and regulatory",
      labelSw: "Kufuata sheria",
    },
    CUSTOMER_SERVICE: {
      char: "💬",
      labelEn: "Customer service",
      labelSw: "Huduma kwa wateja",
    },
    LEADERSHIP_MANAGEMENT: {
      char: "🧭",
      labelEn: "Leadership and management",
      labelSw: "Uongozi na usimamizi",
    },
    RISK_MANAGEMENT: {
      char: "🛡️",
      labelEn: "Risk management",
      labelSw: "Usimamizi wa hatari",
    },
    TECHNOLOGY_DIGITAL: {
      char: "💻",
      labelEn: "Technology and digital",
      labelSw: "Teknolojia na kidijitali",
    },
    CREDIT_LENDING: {
      char: "🏦",
      labelEn: "Credit and lending",
      labelSw: "Mikopo na ukopeshaji",
    },
    ECONOMICS_MARKETS: {
      char: "🌍",
      labelEn: "Economics and markets",
      labelSw: "Uchumi na masoko",
    },
    QUANTITATIVE_ANALYTICS: {
      char: "📊",
      labelEn: "Quantitative analytics",
      labelSw: "Uchanganuzi wa takwimu",
    },
    COMMUNICATION_NEGOTIATION: {
      char: "🗣️",
      labelEn: "Communication and negotiation",
      labelSw: "Mawasiliano na majadiliano",
    },
    PERSONAL_FINANCE: {
      char: "🪙",
      labelEn: "Personal finance",
      labelSw: "Fedha binafsi",
    },
  },
);

/** Lookup a domain anchor. Returns null for unknown domain id (graceful). */
export function domainAnchor(
  id: BusinessDomainId | string,
): DomainAnchor | null {
  const key = id as BusinessDomainId;
  return ANCHORS[key] ?? null;
}

/** Render the anchor as a plain string with prefix + label. */
export function domainAnchorPrefix(
  id: BusinessDomainId | string,
  lang: "en" | "sw" = "en",
): string {
  const anchor = domainAnchor(id);
  if (!anchor) return "";
  const label = lang === "sw" ? anchor.labelSw : anchor.labelEn;
  return `${anchor.char} ${label}`;
}

/** Frozen map for callers needing exhaustive iteration. */
export const DOMAIN_ANCHORS: Readonly<Record<BusinessDomainId, DomainAnchor>> =
  ANCHORS;
