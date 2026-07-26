import { OUTFIT_CATEGORIES, OutfitCategory } from './catalog';

export const OCCASIONS = ['Wedding', 'Festive', 'Party', 'Vacation', 'Everyday'] as const;
export type Occasion = (typeof OCCASIONS)[number];

/**
 * The design brief being built up across the conversation. Every field is
 * optional/nullable — it starts empty and fills in slot by slot as Diya
 * extracts information from the user's speech or typed text.
 */
export interface Brief {
  occasion?: Occasion | null;
  outfitType?: OutfitCategory | null;
  fabricFolder?: string | null;
  fabricFile?: string | null;
  color?: string | null;
  styleDetails?: string | null;
  size?: string | null;
  neededBy?: string | null;
  sketchId?: string | null;
}

export const EMPTY_BRIEF: Brief = {
  occasion: null,
  outfitType: null,
  fabricFolder: null,
  fabricFile: null,
  color: null,
  styleDetails: null,
  size: null,
  neededBy: null,
  sketchId: null,
};

/** A brief is "complete" once the four core slots are filled, per spec. */
export function isBriefComplete(brief: Brief): boolean {
  return Boolean(brief.occasion && brief.outfitType && brief.fabricFolder && brief.color);
}

export function mergeBrief(current: Brief, patch: Partial<Brief>): Brief {
  const next: Brief = { ...current };
  for (const key of Object.keys(patch) as (keyof Brief)[]) {
    const value = patch[key];
    if (value !== undefined && value !== null && value !== '') {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

export function isValidOccasion(value: unknown): value is Occasion {
  return typeof value === 'string' && (OCCASIONS as readonly string[]).includes(value);
}

export function isValidOutfitType(value: unknown): value is OutfitCategory {
  return typeof value === 'string' && (OUTFIT_CATEGORIES as readonly string[]).includes(value);
}
