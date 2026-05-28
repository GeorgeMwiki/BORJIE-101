'use client';

/**
 * board-element-renderer — discriminated-union dispatcher.
 *
 * Pure render switch. Every element type has its own component; this
 * module fans the envelope out to the right renderer. Keeps the
 * Blackboard.tsx orchestrator free of element-specific imports.
 */

import type { ReactElement } from 'react';
import type { BoardElement } from './types';
import { ChartElement } from './elements/ChartElement';
import { ComparisonElement } from './elements/ComparisonElement';
import { DiagramElement } from './elements/DiagramElement';
import { FormulaElement } from './elements/FormulaElement';
import {
  ArrowElement,
  HighlightElement,
  ImageElement,
  SketchElement,
  TextElement,
} from './elements/SimpleElements';

export interface BoardElementRendererProps {
  readonly element: BoardElement;
  readonly languagePreference: 'sw' | 'en';
}

export function BoardElementRenderer({
  element,
  languagePreference,
}: BoardElementRendererProps): ReactElement | null {
  switch (element.type) {
    case 'formula':
      return <FormulaElement payload={element} languagePreference={languagePreference} />;
    case 'diagram':
      return <DiagramElement payload={element} languagePreference={languagePreference} />;
    case 'chart':
      return <ChartElement payload={element} languagePreference={languagePreference} />;
    case 'comparison':
      return <ComparisonElement payload={element} languagePreference={languagePreference} />;
    case 'image':
      return <ImageElement payload={element} languagePreference={languagePreference} />;
    case 'text':
      return <TextElement payload={element} languagePreference={languagePreference} />;
    case 'highlight':
      return <HighlightElement payload={element} languagePreference={languagePreference} />;
    case 'arrow':
      return <ArrowElement payload={element} languagePreference={languagePreference} />;
    case 'sketch':
      return <SketchElement payload={element} languagePreference={languagePreference} />;
    default: {
      // Exhaustiveness check — TS will error here if a new element
      // type is added to the union and not handled above.
      const _never: never = element;
      return null;
    }
  }
}
