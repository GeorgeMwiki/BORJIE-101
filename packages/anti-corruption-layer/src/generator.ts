/**
 * Code-gen helper. Produces an ACL subclass stub for new boundaries.
 *
 * Pure string-builder — does not write to disk. Caller does:
 *   const src = generateACL({ className, domainType, externalType, mappings });
 *   fs.writeFileSync("...", src);
 *
 * For interactive use we could wrap this in a CLI; out of scope for
 * the parity item.
 */

export interface FieldMapping {
  readonly domainField: string;
  readonly externalField: string;
  /** Optional inline transform expression — e.g. "row.created_at" → "new Date(row.created_at)". */
  readonly toDomainExpr?: string;
  readonly fromDomainExpr?: string;
}

export interface GenerateACLOptions {
  readonly className: string;
  readonly domainType: string;
  readonly externalType: string;
  readonly mappings: readonly FieldMapping[];
}

export function generateACL(opts: GenerateACLOptions): string {
  const toDomain = opts.mappings
    .map((m) => {
      const expr = m.toDomainExpr ?? `external.${m.externalField}`;
      return `      ${m.domainField}: ${expr},`;
    })
    .join("\n");

  const fromDomain = opts.mappings
    .map((m) => {
      const expr = m.fromDomainExpr ?? `domain.${m.domainField}`;
      return `      ${m.externalField}: ${expr},`;
    })
    .join("\n");

  return `import { BaseACL, type BaseACLOptions } from "@borjie/anti-corruption-layer";
import type { ${opts.domainType} } from "./domain.js";
import type { ${opts.externalType} } from "./external.js";

export class ${opts.className} extends BaseACL<${opts.domainType}, ${opts.externalType}> {
  constructor(opts: BaseACLOptions = {}) {
    super(opts);
  }

  protected override mapToDomain(external: ${opts.externalType}): ${opts.domainType} {
    return {
${toDomain}
    };
  }

  protected override mapFromDomain(domain: ${opts.domainType}): ${opts.externalType} {
    return {
${fromDomain}
    };
  }
}
`;
}
