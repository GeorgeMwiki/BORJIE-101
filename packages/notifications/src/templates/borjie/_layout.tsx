/**
 * Borjie email layout — shared chrome for every transactional template.
 *
 * Gold accent header (mining-amber `#C8932A`), dark footer (`#17100A`),
 * warm paper body. Inline CSS only — most mail clients strip <style>.
 * Bilingual-agnostic: copy lives in each template, layout is neutral.
 */
import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

export type BorjieLang = 'sw' | 'en';

export interface BorjieLayoutProps {
  readonly preview: string;
  readonly lang: BorjieLang;
  readonly children: ReactNode;
}

const colors = {
  gold: '#C8932A',
  dark: '#17100A',
  paper: '#FBF7F0',
  ink: '#2D2419',
  muted: '#6B5D4A',
  border: '#E8DFD0',
} as const;

const styles = {
  body: {
    backgroundColor: colors.paper,
    color: colors.ink,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    margin: 0,
    padding: 0,
  },
  container: {
    margin: '0 auto',
    maxWidth: '560px',
    padding: '0',
  },
  header: {
    backgroundColor: colors.dark,
    borderTop: `4px solid ${colors.gold}`,
    padding: '24px 32px',
  },
  brand: {
    color: colors.gold,
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    margin: 0,
    textTransform: 'uppercase' as const,
  },
  tagline: {
    color: '#A89478',
    fontSize: '12px',
    margin: '4px 0 0 0',
  },
  content: {
    backgroundColor: '#FFFFFF',
    border: `1px solid ${colors.border}`,
    borderTop: 'none',
    padding: '32px',
  },
  footer: {
    backgroundColor: colors.dark,
    color: '#8A7960',
    fontSize: '11px',
    lineHeight: '1.6',
    padding: '20px 32px',
    textAlign: 'center' as const,
  },
  footerLink: {
    color: colors.gold,
    textDecoration: 'none',
  },
} as const;

const footerCopy: Record<BorjieLang, { tagline: string; address: string; rights: string }> = {
  sw: {
    tagline: 'Mfumo wa AI kwa migodi ya Tanzania',
    address: 'Borjie Ltd · Dar es Salaam, Tanzania',
    rights: 'Haki zote zimehifadhiwa.',
  },
  en: {
    tagline: 'AI operating system for Tanzanian mining',
    address: 'Borjie Ltd · Dar es Salaam, Tanzania',
    rights: 'All rights reserved.',
  },
};

export function BorjieLayout(props: BorjieLayoutProps) {
  const footer = footerCopy[props.lang];
  return (
    <Html lang={props.lang}>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.brand}>BORJIE</Text>
            <Text style={styles.tagline}>{footer.tagline}</Text>
          </Section>
          <Section style={styles.content}>{props.children}</Section>
          <Section style={styles.footer}>
            <Text style={{ margin: 0 }}>{footer.address}</Text>
            <Text style={{ margin: '4px 0 0 0' }}>
              &copy; {new Date().getFullYear()} Borjie. {footer.rights}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export const borjieColors = colors;
export const borjieStyles = {
  h1: {
    color: colors.ink,
    fontSize: '22px',
    fontWeight: 600,
    lineHeight: '1.3',
    margin: '0 0 16px 0',
  },
  p: {
    color: colors.ink,
    fontSize: '15px',
    lineHeight: '1.6',
    margin: '0 0 16px 0',
  },
  muted: {
    color: colors.muted,
    fontSize: '13px',
    lineHeight: '1.5',
    margin: '0 0 12px 0',
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: '6px',
    color: colors.dark,
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: 600,
    padding: '12px 22px',
    textDecoration: 'none',
  },
  divider: {
    border: 'none',
    borderTop: `1px solid ${colors.border}`,
    margin: '24px 0',
  },
  card: {
    backgroundColor: colors.paper,
    border: `1px solid ${colors.border}`,
    borderLeft: `3px solid ${colors.gold}`,
    borderRadius: '4px',
    padding: '16px 20px',
    marginBottom: '16px',
  },
} as const;

export function pickLang(lang: BorjieLang | undefined): BorjieLang {
  return lang === 'en' ? 'en' : 'sw';
}
