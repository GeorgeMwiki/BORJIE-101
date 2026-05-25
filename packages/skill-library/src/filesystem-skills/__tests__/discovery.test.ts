import { describe, expect, it } from 'vitest';
import {
  discoverSkills,
  loadSkillBody,
  applyAllowlist,
  filterJurisdictionMisuse,
  InMemorySkillFileSystem,
} from '../index.js';

function setupFs(): InMemorySkillFileSystem {
  const fs = new InMemorySkillFileSystem();
  fs.addDir('/home/user/.borjie/skills');
  fs.addFile(
    '/home/user/.borjie/skills/handle-late-rent/SKILL.md',
    `---
name: handle-late-rent
description: Late-rent handler.
when_to_use:
  - tenant late
allowed_tools: [Read, Write]
jurisdiction_aware: true
---

Body.`
  );
  fs.addFile(
    '/home/user/.borjie/skills/compile-weekly-report/SKILL.md',
    `---
name: compile-weekly-report
description: Weekly report compiler.
when_to_use:
  - friday recap
allowed_tools: [Read]
jurisdiction_aware: false
---

Body.`
  );
  return fs;
}

describe('discoverSkills', () => {
  it('finds skills under the platform root', async () => {
    const fs = setupFs();
    const result = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    expect(result.skills.map((s) => s.manifest.name)).toEqual([
      'compile-weekly-report',
      'handle-late-rent',
    ]);
    expect(result.errors).toEqual([]);
  });

  it('returns name-sorted output deterministically', async () => {
    const fs = setupFs();
    fs.addFile(
      '/home/user/.borjie/skills/aaa-first/SKILL.md',
      `---
name: aaa-first
description: First alphabetically.
when_to_use:
  - first
allowed_tools: [Read]
jurisdiction_aware: false
---

body`
    );
    const r = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    expect(r.skills[0]?.manifest.name).toBe('aaa-first');
  });

  it('skips dirs without SKILL.md silently', async () => {
    const fs = setupFs();
    fs.addDir('/home/user/.borjie/skills/empty-dir');
    fs.addFile('/home/user/.borjie/skills/empty-dir/README.md', 'no manifest');
    const r = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    expect(r.skills.map((s) => s.manifest.name)).not.toContain('empty-dir');
    expect(r.errors).toEqual([]);
  });

  it('reports parse errors without halting discovery', async () => {
    const fs = setupFs();
    fs.addFile(
      '/home/user/.borjie/skills/broken/SKILL.md',
      'no frontmatter at all'
    );
    const r = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    expect(r.skills.map((s) => s.manifest.name).sort()).toEqual([
      'compile-weekly-report',
      'handle-late-rent',
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.skill_dir).toContain('broken');
  });

  it('returns empty when platform root does not exist', async () => {
    const fs = new InMemorySkillFileSystem();
    const r = await discoverSkills(fs, { platform_root: '/nonexistent' });
    expect(r.skills).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('discovers tenant-scoped skills alongside platform skills', async () => {
    const fs = setupFs();
    fs.addDir('/data/tenants/acme/skills');
    fs.addFile(
      '/data/tenants/acme/skills/acme-special/SKILL.md',
      `---
name: acme-special
description: Tenant-only skill.
when_to_use:
  - acme-specific case
allowed_tools: [Read]
jurisdiction_aware: false
---

body`
    );
    const r = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
      tenant_roots: [{ tenant_id: 'acme', root: '/data/tenants/acme/skills' }],
    });
    expect(r.skills.map((s) => s.manifest.name)).toContain('acme-special');
    const acme = r.skills.find((s) => s.manifest.name === 'acme-special');
    expect(acme?.scope.kind).toBe('tenant');
    if (acme?.scope.kind === 'tenant') {
      expect(acme.scope.tenant_id).toBe('acme');
    }
  });
});

describe('loadSkillBody', () => {
  it('returns the markdown body content', async () => {
    const fs = setupFs();
    const r = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    const skill = r.skills.find((s) => s.manifest.name === 'compile-weekly-report');
    expect(skill).toBeDefined();
    const loaded = await loadSkillBody(fs, skill!);
    expect(loaded.body).toBe('Body.');
  });
});

describe('applyAllowlist', () => {
  it('allows everything when allowlist is null', async () => {
    const fs = setupFs();
    const { skills } = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    const r = applyAllowlist(skills, null);
    expect(r.allowed.length).toBe(2);
    expect(r.excluded).toEqual([]);
  });

  it('allows everything when allowlist is undefined', async () => {
    const fs = setupFs();
    const { skills } = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    const r = applyAllowlist(skills, undefined);
    expect(r.allowed.length).toBe(2);
  });

  it('excludes everything when allowlist is empty array', async () => {
    const fs = setupFs();
    const { skills } = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    const r = applyAllowlist(skills, []);
    expect(r.allowed).toEqual([]);
    expect(r.excluded.length).toBe(2);
  });

  it('filters to only named skills', async () => {
    const fs = setupFs();
    const { skills } = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    const r = applyAllowlist(skills, ['handle-late-rent']);
    expect(r.allowed.map((s) => s.manifest.name)).toEqual(['handle-late-rent']);
    expect(r.excluded.map((s) => s.manifest.name)).toEqual([
      'compile-weekly-report',
    ]);
  });

  it('contract: unlisted skills are EXCLUDED but their files remain reachable on disk', async () => {
    const fs = setupFs();
    const { skills } = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    const r = applyAllowlist(skills, ['handle-late-rent']);
    // R1 §E.2: allowlist is a CONTEXT FILTER, not a sandbox.
    // The on-disk file is still readable; the loader does not delete or
    // hide it. We assert this via the InMemoryFs which still has the
    // SKILL.md present even though it's in `excluded`.
    const excluded = r.excluded[0];
    expect(excluded).toBeDefined();
    const stillReadable = await fs.readFile(excluded!.skill_md_path);
    expect(stillReadable).toContain('compile-weekly-report');
  });
});

describe('filterJurisdictionMisuse', () => {
  it('excludes platform-scoped jurisdiction-aware skills', async () => {
    const fs = setupFs();
    const { skills } = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
    });
    const { safe, excluded_for_jurisdiction } = filterJurisdictionMisuse(skills);
    expect(safe.map((s) => s.manifest.name)).toEqual(['compile-weekly-report']);
    expect(excluded_for_jurisdiction.map((s) => s.manifest.name)).toEqual([
      'handle-late-rent',
    ]);
  });

  it('keeps tenant-scoped jurisdiction-aware skills', async () => {
    const fs = setupFs();
    fs.addDir('/data/tenants/acme/skills');
    fs.addFile(
      '/data/tenants/acme/skills/kra/SKILL.md',
      `---
name: kra-thing
description: KE-only.
when_to_use:
  - KE filing
allowed_tools: [Read]
jurisdiction_aware: true
---

body`
    );
    const { skills } = await discoverSkills(fs, {
      platform_root: '/home/user/.borjie/skills',
      tenant_roots: [{ tenant_id: 'acme', root: '/data/tenants/acme/skills' }],
    });
    const { safe } = filterJurisdictionMisuse(skills);
    expect(safe.map((s) => s.manifest.name)).toContain('kra-thing');
  });
});
