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
    keywords: [
      'maxi dress',
      'maxi',
      'gown',
      'मैक्सी ड्रेस',
      'मैक्सी',
      'म्याक्सी',
      'गाउन',
      'మాక్సీ డ్రెస్',
      'మాక్సీ',
      'మ్యాక్సీ',
      'గౌన్',
      'ಮ್ಯಾಕ್ಸಿ ಡ್ರೆಸ್',
      'ಮ್ಯಾಕ್ಸಿ',
      'ಗೌನ್',
    ],
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
      'फ्रॉक',
      'షార్ట్ డ్రెస్',
      'ఫ్రాక్',
      'ಶಾರ್ಟ್ ಡ್ರೆಸ್',
      'ಫ್ರಾಕ್',
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
  // Indic keyword lists deliberately include STT spelling variants (Saaras is
  // not consistent about e.g. సా vs శా, or where the nukta lands in Hindi).
  { value: 'satin', keywords: ['satin', 'सैटिन', 'साटन', 'साटिन', 'సాటిన్', 'శాటిన్', 'సాటన్', 'ಸ್ಯಾಟಿನ್', 'ಸ್ಯಾಟಿನ್'] },
  {
    value: 'organza',
    keywords: ['organza', 'ऑर्गेंज़ा', 'ऑर्गन्ज़ा', 'ओरगंजा', 'आर्गंजा', 'ఆర్గంజా', 'ఆర్గన్జా', 'ಆರ್ಗಂಜಾ', 'ಆರ್ಗನ್ಜಾ'],
  },
  { value: 'georgette-floral', keywords: ['georgette', 'जॉर्जेट', 'जोर्जेट', 'జార్జెట్', 'జార్జట్', 'ಜಾರ್ಜೆಟ್'] },
  { value: 'checks', keywords: ['checks', 'checked', 'gingham', 'चेक्स', 'चेक', 'చెక్స్', 'ಚೆಕ್ಸ್'] },
  { value: 'stripes', keywords: ['stripes', 'striped', 'स्ट्राइप्स', 'స్ట్రైప్స్', 'ಸ್ಟ್ರೈಪ್ಸ್'] },
  { value: 'plain', keywords: ['plain', 'solid color', 'solid colour', 'प्लेन', 'ప్లెయిన్', 'ಪ್ಲೇನ್'] },
  {
    // Bare "cotton" maps here too — floral-cotton is the only cotton family
    // in the catalog, so the mapping is safe (their call proved the gap:
    // «కాటన్ దీనికంటే బెటరా?» matched nothing).
    value: 'floral-cotton',
    keywords: [
      'floral cotton',
      'cotton floral',
      'cotton',
      'फ्लोरल कॉटन',
      'कॉटन',
      'सूती',
      'ఫ్లోరల్ కాటన్',
      'కాటన్',
      'ಫ್ಲೋರಲ್ ಕಾಟನ್',
      'ಕಾಟನ್',
    ],
  },
  {
    value: 'small-prints',
    keywords: ['small prints', 'small print', 'स्मॉल प्रिंट', 'స్మాల్ ప్రింట్', 'ಸ್ಮಾಲ್ ಪ್ರಿಂಟ್'],
  },
];

const OCCASION_KEYWORDS: KeywordEntry<Occasion>[] = [
  // Romanized forms included — code-mixed speech and text-mode input arrive
  // in Latin script ("shaadi ke liye"), not always Devanagari.
  {
    value: 'Wedding',
    keywords: ['wedding', 'shaadi', 'shadi', 'sangeet', 'reception', 'pelli', 'maduve', 'शादी', 'विवाह', 'संगीत', 'పెళ్లి', 'ಮದುವೆ'],
  },
  { value: 'Festive', keywords: ['festive', 'festival', 'diwali', 'त्योहार', 'दिवाली', 'పండుగ', 'ಹಬ್ಬ'] },
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
 * Style vocabulary for the styleDetails accumulator. Each entry's `value` is
 * clean English (it feeds the image prompt and the summary card); keywords
 * cover English plus Indic-script transliterations of the common spoken
 * forms (Saaras returns English fashion words in Devanagari/Telugu/Kannada
 * script when pronounced Indian-style, e.g. స్లీవ్ లెస్ for "sleeveless").
 * Only lines containing one of these produce styleDetails — call-control
 * chatter ("end the call", "yes correct") accumulates nothing.
 */
const STYLE_TERM_KEYWORDS: KeywordEntry<string>[] = [
  // necklines
  { value: 'sweetheart neckline', keywords: ['sweetheart', 'स्वीटहार्ट', 'స్వీట్ హార్ట్', 'ಸ್ವೀಟ್ ಹಾರ್ಟ್'] },
  { value: 'V-neck', keywords: ['v-neck', 'v neck', 'वी नेक', 'వీ నెక్', 'ವಿ ನೆಕ್'] },
  { value: 'halter neck', keywords: ['halter', 'हॉल्टर', 'హాల్టర్', 'ಹಾಲ್ಟರ್'] },
  { value: 'off-shoulder', keywords: ['off shoulder', 'off-shoulder', 'ऑफ शोल्डर', 'ఆఫ్ షోల్డర్', 'ಆಫ್ ಶೋಲ್ಡರ್'] },
  { value: 'square neckline', keywords: ['square neck', 'स्क्वायर नेक', 'స్క్వేర్ నెక్'] },
  { value: 'round neckline', keywords: ['round neck', 'राउंड नेक', 'రౌండ్ నెక్', 'ರೌಂಡ್ ನೆಕ್'] },
  { value: 'boat neckline', keywords: ['boat neck'] },
  { value: 'collared', keywords: ['collar', 'कॉलर', 'కాలర్', 'ಕಾಲರ್'] },
  { value: 'backless', keywords: ['backless', 'बैकलेस', 'బ్యాక్ లెస్'] },
  // sleeves
  {
    value: 'sleeveless',
    keywords: ['sleeveless', 'sleeve less', 'स्लीवलेस', 'స్లీవ్ లెస్', 'స్లీవ్‌లెస్', 'ಸ್ಲೀವ್ ಲೆಸ್', 'ಸ್ಲೀವ್‌ಲೆಸ್'],
  },
  { value: 'puff sleeves', keywords: ['puff sleeve', 'puff sleeves', 'पफ स्लीव', 'పఫ్ స్లీవ్', 'ಪಫ್ ಸ್ಲೀವ್'] },
  { value: 'balloon sleeves', keywords: ['balloon sleeve', 'balloon sleeves', 'बैलून स्लीव', 'బెలూన్ స్లీవ్'] },
  { value: 'long sleeves', keywords: ['long sleeve', 'long sleeves', 'full sleeve', 'full sleeves', 'फुल स्लीव', 'ఫుల్ స్లీవ్'] },
  { value: 'short sleeves', keywords: ['short sleeve', 'short sleeves', 'half sleeve', 'हाफ स्लीव', 'హాఫ్ స్లీవ్', 'ಹಾಫ್ ಸ್ಲೀವ್'] },
  { value: 'bell sleeves', keywords: ['bell sleeve', 'bell sleeves'] },
  { value: 'cap sleeves', keywords: ['cap sleeve', 'cap sleeves'] },
  { value: 'spaghetti straps', keywords: ['spaghetti', 'स्पेगेटी', 'స్పగెట్టి'] },
  // lengths
  { value: 'knee length', keywords: ['knee length', 'knee-length', 'नी लेंथ', 'నీ లెంగ్త్', 'ನೀ ಲೆಂತ್'] },
  { value: 'midi length', keywords: ['midi', 'मिडी', 'మిడీ', 'ಮಿಡಿ'] },
  { value: 'mini length', keywords: ['mini', 'मिनी', 'మినీ', 'ಮಿನಿ'] },
  { value: 'floor length', keywords: ['floor length', 'floor-length', 'फ्लोर लेंथ', 'ఫ్లోర్ లెంగ్త్'] },
  { value: 'ankle length', keywords: ['ankle length', 'ankle-length'] },
  // silhouettes
  { value: 'A-line', keywords: ['a-line', 'a line', 'ए लाइन', 'ఏ లైన్', 'ఎ లైన్', 'ಎ ಲೈನ್'] },
  { value: 'fit and flare', keywords: ['fit and flare', 'फिट एंड फ्लेयर', 'ఫిట్ అండ్ ఫ్లేర్'] },
  { value: 'bodycon', keywords: ['bodycon', 'बॉडीकॉन', 'బాడీకాన్'] },
  { value: 'wrap style', keywords: ['wrap', 'रैप', 'ర్యాప్'] },
  { value: 'tiered', keywords: ['tiered', 'tiers', 'टियर', 'టైర్డ్'] },
  { value: 'empire waist', keywords: ['empire waist', 'empire'] },
  { value: 'peplum', keywords: ['peplum', 'పెప్లం'] },
  { value: 'flowy', keywords: ['flowy', 'flowing', 'फ्लोई', 'ఫ్లోయీ'] },
  // details
  { value: 'ruffles', keywords: ['ruffle', 'ruffles', 'रफल', 'रफल्स', 'రఫుల్', 'రఫుల్స్', 'ರಫಲ್', 'ರಫಲ್ಸ್'] },
  { value: 'side slit', keywords: ['slit', 'स्लिट', 'స్లిట్', 'ಸ್ಲಿಟ್'] },
  { value: 'bow detail', keywords: ['bow', 'बो', 'బో'] },
  { value: 'pockets', keywords: ['pocket', 'pockets', 'पॉकेट', 'పాకెట్', 'ಪಾಕೆಟ್'] },
  { value: 'belted waist', keywords: ['belt', 'belted', 'बेल्ट', 'బెల్ట్', 'ಬೆಲ್ಟ್'] },
  { value: 'pleats', keywords: ['pleated', 'pleats', 'प्लीट', 'ప్లీట్'] },
  { value: 'lace detail', keywords: ['lace', 'लेस', 'లేస్', 'ಲೇಸ್'] },
  { value: 'embroidery', keywords: ['embroidery', 'embroidered', 'कढ़ाई', 'ఎంబ్రాయిడరీ', 'ಕಸೂತಿ'] },
  { value: 'cut-out detail', keywords: ['cut out', 'cutout', 'cut-out'] },
  { value: 'gathered', keywords: ['gathered', 'gathering'] },
  { value: 'scalloped hem', keywords: ['scalloped', 'scallop'] },
  { value: 'frills', keywords: ['frill', 'frills', 'फ्रिल', 'ఫ్రిల్'] },
  { value: 'floral', keywords: ['floral', 'flowers', 'फ्लोरल', 'फूल', 'ఫ్లోరల్', 'పూల', 'ಹೂವಿನ', 'ಫ್ಲೋರಲ್'] },
  // vibe adjectives (safe to render — they only add mood)
  { value: 'elegant', keywords: ['elegant', 'एलिगेंट', 'ఎలిగెంట్', 'ಎಲಿಗెಂಟ್'] },
  { value: 'playful', keywords: ['playful'] },
  { value: 'classy', keywords: ['classy', 'क्लासी', 'క్లాసీ', 'ಕ್ಲಾಸಿ'] },
  { value: 'chic', keywords: ['chic'] },
  { value: 'romantic', keywords: ['romantic'] },
  { value: 'cute', keywords: ['cute', 'क्यूट', 'క్యూట్'] },
  { value: 'comfortable', keywords: ['comfortable', 'comfy', 'कम्फर्टेबल', 'కంఫర్టబుల్'] },
];

/**
 * Extracts clean English style terms from a (possibly Indic-script,
 * code-mixed) transcript line. Returns [] for lines with no style content —
 * the accumulator in VoiceSession only grows when this finds something.
 */
export function extractStyleTerms(text: string): string[] {
  if (!text) return [];
  const hay = text.toLowerCase();
  const terms: string[] = [];
  for (const entry of STYLE_TERM_KEYWORDS) {
    if (entry.keywords.some((k) => containsKeyword(hay, k))) terms.push(entry.value);
  }
  return terms;
}

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
