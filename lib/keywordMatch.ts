/**
 * Instant, deterministic (pure-function, no network) keyword matcher.
 *
 * Purpose: light up the design-brief chips the moment a transcript exists —
 * before the sarvam-30b call (which, even merged into one request, still
 * takes several seconds) has a chance to respond. Runs in well under 1ms.
 *
 * Covers the 8 outfit types, 8 fabric folders (all but "instantly-available",
 * which has no natural spoken keyword), the 5 occasions, and a curated set of
 * common color names — each with English keywords plus Hindi/Telugu/Kannada
 * transliterations of common spoken forms. This is intentionally a coarse
 * net, not a replacement for the LLM: it only ever returns values it is
 * confident about via exact substring matches.
 */

import { Brief, Occasion } from './brief';
import { OutfitCategory, findBestSwatchMatch } from './catalog';

interface KeywordEntry<T extends string> {
  value: T;
  keywords: string[];
}

const isAsciiKeyword = (s: string) => /^[a-z0-9\s'-]+$/i.test(s);

/**
 * Substring match, with a word-boundary guard for plain-ASCII keywords (so
 * short English words like "top" don't fire inside unrelated words). Indic
 * scripts use a plain substring check — JS's \b is ASCII-centric and not
 * reliable across combining marks.
 */
function containsKeyword(hay: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (isAsciiKeyword(kw)) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(hay);
  }
  return hay.includes(kw);
}

function firstMatch<T extends string>(hay: string, entries: KeywordEntry<T>[]): T | null {
  for (const entry of entries) {
    if (entry.keywords.some((k) => containsKeyword(hay, k))) return entry.value;
  }
  return null;
}

const OUTFIT_TYPE_KEYWORDS: KeywordEntry<OutfitCategory>[] = [
  {
    value: 'maxi-dresses',
    keywords: ['maxi dress', 'maxi', 'मैक्सी ड्रेस', 'मैक्सी', 'మాక్సీ డ్రెస్', 'మాక్సీ', 'ಮ್ಯಾಕ್ಸಿ ಡ್ರೆಸ್', 'ಮ್ಯಾಕ್ಸಿ'],
  },
  {
    // Checked before "shorts" — "short dress" / "షార్ట్ డ్రెస్" must not fall through to shorts.
    value: 'short-dresses',
    keywords: [
      'short dress',
      'shortdress',
      'frock',
      'शॉर्ट ड्रेस',
      'छोटी ड्रेस',
      'షార్ట్ డ్రెస్',
      'ಶಾರ್ಟ್ ಡ್ರೆಸ್',
    ],
  },
  {
    value: 'jumpsuits',
    keywords: ['jumpsuit', 'जंपसूट', 'జంప్ సూట్', 'జంప్‌సూట్', 'ಜಂಪ್‌ಸೂಟ್'],
  },
  {
    value: 'skirts',
    keywords: ['skirt', 'स्कर्ट', 'స్కర్ట్', 'ಸ್ಕರ್ಟ್'],
  },
  {
    value: 'tops',
    keywords: ['top', 'टॉप', 'టాప్', 'ಟಾಪ್'],
  },
  {
    value: 'pants',
    keywords: ['pants', 'trousers', 'पैंट', 'ప్యాంట్', 'ಪ್ಯಾಂಟ್'],
  },
  {
    value: 'shorts',
    keywords: ['shorts', 'hot pants', 'शॉर्ट्स', 'షార్ట్స్', 'ಶಾರ್ಟ್ಸ್'],
  },
  {
    value: 'coord-sets',
    keywords: [
      'coord set',
      'co-ord set',
      'coordinate set',
      'co-ord',
      'को-ऑर्ड सेट',
      'కో-ఆర్డ్ సెట్',
      'ಕೋ-ಆರ್ಡ್ ಸೆಟ್',
    ],
  },
];

const FABRIC_FOLDER_KEYWORDS: KeywordEntry<string>[] = [
  { value: 'satin', keywords: ['satin', 'सैटिन', 'साटन', 'సాటిన్', 'ಸ್ಯಾಟಿನ್'] },
  { value: 'organza', keywords: ['organza', 'ऑर्गेंज़ा', 'आर्गंजा', 'ఆర్గంజా', 'ಆರ್ಗಂಜಾ'] },
  { value: 'georgette-floral', keywords: ['georgette', 'जॉर्जेट', 'జార్జెట్', 'ಜಾರ್ಜೆಟ್'] },
  { value: 'checks', keywords: ['checks', 'checked', 'चेक्स', 'चेक', 'చెక్స్', 'ಚೆಕ್ಸ್'] },
  { value: 'stripes', keywords: ['stripes', 'striped', 'स्ट्राइप्स', 'స్ట్రైప్స్', 'ಸ್ಟ್ರೈಪ್ಸ್'] },
  { value: 'plain', keywords: ['plain', 'solid color', 'solid colour', 'प्लेन', 'ప్లెయిన్', 'ಪ್ಲೇನ್'] },
  {
    value: 'floral-cotton',
    keywords: ['floral cotton', 'cotton floral', 'फ्लोरल कॉटन', 'ఫ్లోరల్ కాటన్', 'ಫ್ಲೋರಲ್ ಕಾಟನ್'],
  },
  {
    value: 'small-prints',
    keywords: ['small prints', 'small print', 'स्मॉल प्रिंट', 'స్మాల్ ప్రింట్', 'ಸ್ಮಾಲ್ ಪ್ರಿಂಟ್'],
  },
];

const OCCASION_KEYWORDS: KeywordEntry<Occasion>[] = [
  { value: 'Wedding', keywords: ['wedding', 'शादी', 'विवाह', 'పెళ్లి', 'ಮದುವೆ'] },
  { value: 'Festive', keywords: ['festive', 'festival', 'त्योहार', 'పండుగ', 'ಹಬ್ಬ'] },
  {
    value: 'Party',
    keywords: [
      'party',
      'birthday',
      'पार्टी',
      'बर्थडे',
      'పార్టీ',
      'పుట్టినరోజు',
      'బర్త్ డే',
      'ಪಾರ್ಟಿ',
      'ಹುಟ್ಟುಹಬ್ಬ',
    ],
  },
  { value: 'Vacation', keywords: ['vacation', 'holiday', 'trip', 'छुट्टी', 'वेकेशन', 'సెలవు', 'ರಜೆ'] },
  {
    value: 'Everyday',
    keywords: ['everyday', 'daily wear', 'casual wear', 'रोज़ाना', 'డెయిలీ వియర్', 'రోజువారీ', 'ದೈನಂದಿನ'],
  },
];

const COLOR_KEYWORDS: KeywordEntry<string>[] = [
  { value: 'maroon', keywords: ['maroon', 'मरून', 'మెరూన్', 'ಮೆರೂನ್'] },
  { value: 'white', keywords: ['white', 'व्हाइट', 'सफेद', 'వైట్', 'తెల్ల', 'ಬಿಳಿ', 'ವೈಟ್'] },
  { value: 'black', keywords: ['black', 'ब्लैक', 'काला', 'బ్లాక్', 'నలుపు', 'ಕಪ್ಪು', 'ಬ್ಲ್ಯಾಕ್'] },
  { value: 'red', keywords: ['red', 'रेड', 'लाल', 'రెడ్', 'ఎరుపు', 'ಕೆಂಪು', 'ರೆಡ್'] },
  { value: 'blue', keywords: ['blue', 'ब्लू', 'नीला', 'బ్లూ', 'నీలం', 'ನೀಲಿ', 'ಬ್ಲೂ'] },
  { value: 'green', keywords: ['green', 'ग्रीन', 'हरा', 'గ్రీన్', 'ఆకుపచ్చ', 'ಹಸಿರು', 'ಗ್ರೀನ್'] },
  { value: 'yellow', keywords: ['yellow', 'येलो', 'पीला', 'ఎల్లో', 'పసుపు', 'ಹಳದಿ', 'ಯೆಲ್ಲೋ'] },
  { value: 'pink', keywords: ['pink', 'पिंक', 'गुलाबी', 'పింక్', 'గులాబీ', 'ಗುಲಾಬಿ', 'ಪಿಂಕ್'] },
  { value: 'purple', keywords: ['purple', 'पर्पल', 'बैंगनी', 'పర్పుల్', 'ఊదా', 'ನೇರಳೆ'] },
  { value: 'orange', keywords: ['orange', 'ऑरेंज', 'नारंगी', 'నారింజ', 'ಕಿತ್ತಳೆ'] },
  { value: 'gold', keywords: ['gold', 'गोल्ड', 'सुनहरा', 'గోల్డ్', 'బంగారు', 'ಚಿನ್ನ'] },
  { value: 'silver', keywords: ['silver', 'सिल्वर', 'चांदी', 'సిల్వర్', 'వెండి', 'ಬೆಳ್ಳಿ'] },
  { value: 'navy', keywords: ['navy'] },
  { value: 'teal', keywords: ['teal'] },
  { value: 'grey', keywords: ['grey', 'gray', 'ग्रे', 'బూడిద', 'ಬೂದು'] },
  { value: 'brown', keywords: ['brown', 'ब्राउन', 'भूरा', 'బ్రౌన్', 'గోధుమ', 'ಕಂದು'] },
  { value: 'ivory', keywords: ['ivory'] },
  { value: 'cream', keywords: ['cream', 'क्रीम', 'క్రీమ్', 'ಕ್ರೀಮ್'] },
  { value: 'mustard', keywords: ['mustard'] },
  { value: 'olive', keywords: ['olive'] },
  { value: 'wine', keywords: ['wine'] },
  { value: 'champagne', keywords: ['champagne'] },
  { value: 'rose', keywords: ['rose'] },
  { value: 'mauve', keywords: ['mauve'] },
  { value: 'beige', keywords: ['beige'] },
  { value: 'rust', keywords: ['rust'] },
  { value: 'coral', keywords: ['coral'] },
  { value: 'mint', keywords: ['mint'] },
  { value: 'lavender', keywords: ['lavender'] },
  { value: 'peach', keywords: ['peach'] },
  { value: 'rani', keywords: ['rani pink', 'रानी पिंक'] },
];

/**
 * Runs all keyword tables against a transcript and returns whatever slots it
 * is confident about. Never guesses — an unmatched slot is simply absent
 * from the returned patch (not null), so callers can safely merge it in
 * without clobbering anything.
 */
export function keywordMatchBrief(transcript: string): Partial<Brief> {
  if (!transcript) return {};
  const hay = transcript.toLowerCase();
  const patch: Partial<Brief> = {};

  const outfitType = firstMatch(hay, OUTFIT_TYPE_KEYWORDS);
  if (outfitType) patch.outfitType = outfitType;

  const fabricFolder = firstMatch(hay, FABRIC_FOLDER_KEYWORDS);
  if (fabricFolder) patch.fabricFolder = fabricFolder;

  const occasion = firstMatch(hay, OCCASION_KEYWORDS);
  if (occasion) patch.occasion = occasion;

  const color = firstMatch(hay, COLOR_KEYWORDS);
  if (color) patch.color = color;

  if (patch.fabricFolder && patch.color) {
    const match = findBestSwatchMatch(patch.fabricFolder, patch.color);
    if (match) patch.fabricFile = match.file;
  }

  return patch;
}
