import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Anti-regression test: Ensure no "trial", "pilot", "90-day", "free for 90 days", or "no card"
 * language appears in production components or i18n strings.
 *
 * This catches reintroductions of deprecated CTA language per the scrub task.
 */

describe('Borjie: No trial/pilot language (anti-regression)', () => {
  // CTA-specific patterns to catch marketing language that was removed
  // Legal/DPA "90-day" retention windows and other non-CTA uses are allowed
  // Free tier "no card required" is allowed; only pilot-related "no card" is forbidden
  const forbiddenPatterns = [
    /\btrial\b/gi,
    // Only catch "90-day pilot" CTA phrasing, not general audit retention
    /\b90-day\s+(pilot|trial)\b/gi,
    /\bfree for 90 days\b/gi,
    // "no card" in pilot CTA context is forbidden; free tier "no card required" is allowed
    /pilot.*no\s+card|no\s+card.*pilot/gi,
    // "pilot" is allowed in specific contexts (pilotRegions, "pilot data", etc.)
    // but NOT as a CTA verb like "Apply for the pilot", "Start the pilot", etc.
    /start\s+the\s+pilot/gi,
    /apply\s+for\s+(the\s+)?pilot\b/gi,
    /request\s+a?\s+pilot\b/gi,
    /pilot\s+slots?\s+remain/gi,
    /free\s+during\s+pilot/gi,
  ];

  it('should not contain forbidden trial/pilot CTA language in i18n JSON files', () => {
    const basePath = path.join(__dirname, '../../apps/marketing/src/i18n');
    const files = ['en.json', 'sw.json'];
    const matches: string[] = [];

    files.forEach((file) => {
      const filePath = path.join(basePath, file);
      if (!fs.existsSync(filePath)) {
        console.warn(`i18n file not found: ${filePath}`);
        return;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      forbiddenPatterns.forEach((pattern) => {
        const found = content.match(pattern);
        if (found) {
          matches.push(`${file}: ${found.join(', ')}`);
        }
      });
    });

    expect(matches, `i18n contains forbidden patterns:\n${matches.join('\n')}`).toHaveLength(0);
  });

  it('should not contain forbidden patterns in marketing app files', () => {
    const appDir = path.join(__dirname, '../../apps/marketing/src/app');
    const componentsDir = path.join(__dirname, '../../apps/marketing/src/components');

    const scanDir = (dir: string): string[] => {
      const matches: string[] = [];
      if (!fs.existsSync(dir)) return matches;

      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          matches.push(...scanDir(filePath));
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
          const content = fs.readFileSync(filePath, 'utf-8');
          forbiddenPatterns.forEach((pattern) => {
            const found = content.match(pattern);
            if (found) {
              matches.push(`${filePath}: ${found.join(', ')}`);
            }
          });
        }
      });

      return matches;
    };

    const appMatches = scanDir(appDir);
    const componentMatches = scanDir(componentsDir);
    const allMatches = [...appMatches, ...componentMatches];

    expect(allMatches, `Components contain forbidden patterns:\n${allMatches.join('\n')}`).toHaveLength(0);
  });
});
