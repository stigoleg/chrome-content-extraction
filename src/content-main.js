import { getPageMetadata } from "./content-metadata.js";
import {
  BUBBLE_MENU_LAYOUTS,
  BUBBLE_MENU_STYLES,
  DEFAULT_BUBBLE_MENU_ENABLED,
  DEFAULT_BUBBLE_MENU_LAYOUT,
  DEFAULT_BUBBLE_MENU_ORDER,
  DEFAULT_BUBBLE_MENU_STYLE,
  normalizeBubbleMenuConfig
} from "./bubble-settings.js";
import { parseYouTubeVideoId } from "./url-helpers.js";

function normalizeText(value) {
  return (value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isYouTubePage() {
  return Boolean(getYouTubeVideoId());
}

function looksLikePdfUrl(rawUrl, depth = 0) {
  if (!rawUrl) {
    return false;
  }
  if (depth > 3) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl, window.location.href);
    if (/\.pdf([?#]|$)/i.test(parsed.pathname)) {
      return true;
    }

    const candidates = [
      parsed.searchParams.get("file"),
      parsed.searchParams.get("src"),
      parsed.searchParams.get("url"),
      parsed.searchParams.get("doc")
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        if (looksLikePdfUrl(decodeURIComponent(candidate), depth + 1)) {
          return true;
        }
      } catch (_error) {
        if (looksLikePdfUrl(candidate, depth + 1)) {
          return true;
        }
      }
    }

    return /\.pdf([?#]|$)/i.test(parsed.hash || "");
  } catch (_error) {
    return /\.pdf([?#]|$)/i.test(String(rawUrl));
  }
}

function isPdfPage() {
  const type = (document.contentType || "").toLowerCase();
  if (type.includes("pdf")) {
    return true;
  }
  if (looksLikePdfUrl(window.location.href)) {
    return true;
  }
  const embeddedPdf = document.querySelector(
    'embed[type*="pdf"], object[type*="pdf"], iframe[src*=".pdf"], iframe[src*="file="], iframe[src*="src="]'
  );
  return Boolean(embeddedPdf);
}


const MAIN_CONTENT_HINT_SELECTORS = [
  "article",
  "main",
  '[role="main"]',
  '[itemprop="articleBody"]',
  ".article-content",
  ".article-body",
  ".entry-content",
  ".post-content",
  ".story-body",
  ".content-body",
  "#main-content",
  "#main",
  "#content"
];

const CONTENT_STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "video",
  "audio",
  "source",
  "track",
  "form",
  "input",
  "textarea",
  "button",
  "select",
  "menu",
  "dialog",
  "figure button",
  ".visually-hidden",
  ".sr-only"
];

const CONTENT_NOISE_SELECTORS = [
  "nav",
  "aside",
  "footer",
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
  '[role="search"]',
  ".comments",
  "#comments",
  ".comment-list",
  ".related",
  ".related-posts",
  ".recommended",
  ".recommendations",
  ".newsletter",
  ".subscribe",
  ".social",
  ".share",
  ".breadcrumbs",
  ".cookie",
  ".consent",
  '[class*="advert"]',
  '[id*="advert"]',
  '[class*="sponsor"]',
  '[id*="sponsor"]',
  '[class*="promo"]',
  '[id*="promo"]',
  '[class*="banner"]',
  '[id*="banner"]',
  '[class*="sidebar"]',
  '[id*="sidebar"]',
  '[class*="outbrain"]',
  '[id*="outbrain"]',
  '[class*="taboola"]',
  '[id*="taboola"]',
  '[class*="recirc"]',
  '[id*="recirc"]',
  '[class*="recommend"]',
  '[id*="recommend"]',
  '[class*="reader"]',
  '[id*="reader"]',
  '[class*="summary"]',
  '[id*="summary"]',
  '[class*="paywall"]',
  '[id*="paywall"]',
  '[class*="toolbar"]',
  '[id*="toolbar"]',
  '[class*="sticky"]',
  '[id*="sticky"]',
  '[class*="affiliate"]',
  '[id*="affiliate"]',
  '[class*="commercial"]',
  '[id*="commercial"]',
  '[class*="sponsored"]',
  '[id*="sponsored"]',
  '[class*="native-ad"]',
  '[id*="native-ad"]',
  '[data-nosnippet="true"]',
  '[data-testid*="recirc"]',
  '[data-testid*="recommend"]',
  '[data-testid*="related"]',
  '[data-testid*="paywall"]',
  '[data-testid*="summary"]',
  '[data-testid*="reader"]',
  '[aria-hidden="true"]',
  "[hidden]"
];

const CONTENT_UI_NOISE_SELECTORS = [
  '[class*="player-control"]',
  '[class*="video-control"]',
  '[class*="video-player"]',
  '[class*="audio-player"]',
  '[class*="podcast-player"]',
  '[class*="listen-button"]',
  '[class*="audio-controls"]',
  '[class*="keyboard-shortcuts"]',
  '[class*="shortcut-list"]',
  '[class*="hotkey"]',
  '[class*="help-modal"]',
  '[class*="vjs-"]',
  '[class*="jw-"]',
  '[class*="plyr"]',
  '[class*="mejs"]',
  '[aria-label*="keyboard"]',
  '[data-testid*="video"]'
];

const CONTENT_POSITIVE_RE = /(article|content|entry|post|story|main|body|blog|news|read)/i;
const CONTENT_NEGATIVE_RE =
  /(nav|menu|footer|header|sidebar|aside|comment|share|social|related|recommend|advert|sponsor|promo|cookie|consent|subscribe|newsletter|breadcrumb|toolbar|pagination|modal|popup|banner|outbrain|taboola|paywall|recirc|affiliate)/i;

const CONTENT_LINE_NOISE_RE =
  /^(advertisement|sponsored|cookie settings|accept all|reject all|privacy policy|terms of use|all rights reserved|sign in|log in|subscribe|read more|summary|ai summary|listen to article|share this article)$/i;

const CONTENT_CTA_HINT_RE =
  /(tip|tips|tips oss|har du tips|contact us|send us|send oss|submit|feedback|newsletter|subscribe|follow us|download app|whatsapp|telegram|kontakt oss|les mer|read more)/i;

const UI_NOISE_PATTERNS = [
  /press shift question mark/i,
  /keyboard shortcuts?/i,
  /tastatur-?snarveier/i,
  /shortcuts?\s+open\/close/i,
  /\b\d+\s*seconds?\s+of\s+\d+\s*seconds?/i,
  /\bvolume\s*\d+%/i,
  /decrease caption size/i,
  /increase caption size/i,
  /play\/pause/i,
  /spill av\/pause/i,
  /mute\/unmute/i,
  /skru av lyd\/skru på lyd/i,
  /seek forward/i,
  /seek backward/i,
  /søk fremover/i,
  /søk bakover/i,
  /\bfull screen\b/i,
  /\bfull skjerm\b/i,
  /\bfullskjerm\b/i,
  /\bundertekster\b/i,
  /\blytt til saken\b/i,
  /\blytt igjen\b/i,
  /\bavspilling har en varighet\b/i,
  /↑/,
  /↓/,
  /←/,
  /→/,
  /\b%0-9\b/
];

const UI_NOISE_STRONG_PATTERNS = [
  /press shift question mark/i,
  /keyboard shortcuts?/i,
  /tastatur-?snarveier/i,
  /\b\d+\s*seconds?\s+of\s+\d+\s*seconds?/i,
  /\bvolume\s*\d+%/i,
  /decrease caption size/i,
  /increase caption size/i,
  /\blytt til saken\b/i,
  /\bavspilling har en varighet\b/i
];

const NON_ARTICLE_TEXT_PATTERNS = [
  /oppsummeringen er laget med kunstig intelligens/i,
  /kvalitetssikret av .+ journalister/i,
  /kortversjonen/i,
  /les hele saken/i,
  /this summary was (generated|created) (by|with|using) (ai|artificial intelligence)/i,
  /ai[- ]generated summary/i,
  /key (takeaways|points|highlights)/i,
  /^(summary|tldr|tl;dr)$/i
];

const PROMO_BOX_PATTERNS = [
  "share",
  "subscribe",
  "newsletter",
  "donate",
  "paywall",
  "register",
  "login",
  "related",
  "recommended",
  "trending",
  "outbrain",
  "taboola",
  "sponsored",
  "promo",
  "cta",
  "signup",
  "follow",
  "social",
  "comment",
  "disqus",
  "ad",
  "advert",
  "banner",
  "sidebar"
];

const SUMMARY_BOX_PATTERNS = [
  "summary",
  "ai-summary",
  "tldr",
  "tl-dr",
  "key-points",
  "highlights",
  "quick-read",
  "brief",
  "takeaway",
  "oppsummering",
  "sammendrag",
  "kortversjon",
  "hovedpoeng"
];

const INFO_BOX_PATTERNS = [
  "infobox",
  "info-box",
  "factbox",
  "fact-box",
  "callout",
  "pullquote",
  "faktaboks",
  "infoboks"
];

const SUMMARY_HEADING_PATTERNS = [
  /^(ai\s+)?summary$/i,
  /^key\s+(takeaways?|points?|highlights?)$/i,
  /^(in\s+brief|tl;?dr|highlights?)$/i,
  /^what\s+you('ll)?\s+(learn|need\s+to\s+know)$/i,
  /^(quick\s+)?overview$/i,
  /^at\s+a\s+glance$/i,
  /^the\s+bottom\s+line$/i,
  /^(ai\s+)?oppsummering$/i,
  /^kort\s+fortalt$/i,
  /^hovedpoeng(er)?$/i,
  /^n[øo]kkelpunkt(er)?$/i,
  /^sammendrag$/i,
  /^det\s+viktigste$/i,
  /^kort\s+og\s+godt$/i
];

function normalizeComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDocumentText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function countPatternHits(value, patterns) {
  const text = String(value || "");
  let hits = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      hits += 1;
    }
  }
  return hits;
}

function getLetterRatio(value) {
  const text = String(value || "");
  if (!text) {
    return 0;
  }
  const letters = text.match(/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF]/g)?.length || 0;
  return letters / text.length;
}

function isLikelyUiNoiseText(value) {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return false;
  }
  if (normalized.length > 1200) {
    return false;
  }

  const hits = countPatternHits(normalized, UI_NOISE_PATTERNS);
  if (hits === 0) {
    return false;
  }

  const strongHits = countPatternHits(normalized, UI_NOISE_STRONG_PATTERNS);
  const letterRatio = getLetterRatio(normalized);

  if (strongHits >= 1 && hits >= 2) {
    return true;
  }
  if (hits >= 4) {
    return true;
  }
  if (hits >= 3 && letterRatio < 0.72) {
    return true;
  }

  return false;
}

function elementContainsSelection(element, normalizedSelection) {
  if (!normalizedSelection || normalizedSelection.length < 16) {
    return false;
  }
  const normalizedText = normalizeComparableText(element?.textContent || "");
  return normalizedText.includes(normalizedSelection);
}

function buildPatternSelectors(patterns) {
  const tags = ["div", "section", "aside", "nav", "header", "footer"];
  const selectors = [];
  for (const pattern of patterns) {
    for (const tag of tags) {
      selectors.push(`${tag}[class*="${pattern}"]`);
      selectors.push(`${tag}[id*="${pattern}"]`);
    }
  }
  return selectors;
}

function removePatternMatchedContainers(root, patterns, preferredSelection = "") {
  const normalizedPreferred = normalizeComparableText(preferredSelection);
  const selectors = buildPatternSelectors(patterns);
  for (const selector of selectors) {
    try {
      const nodes = Array.from(root.querySelectorAll(selector));
      for (const node of nodes) {
        if (elementContainsSelection(node, normalizedPreferred)) {
          continue;
        }
        node.remove();
      }
    } catch (_error) {
      continue;
    }
  }
}

function getHeadingLevel(element) {
  const match = element?.tagName?.match(/^H([1-6])$/i);
  if (!match) {
    return null;
  }
  return Number(match[1]) || null;
}

function removeSummaryHeadingSections(root, preferredSelection = "") {
  const normalizedPreferred = normalizeComparableText(preferredSelection);
  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  for (const heading of headings) {
    const headingText = normalizeText(heading.textContent || "");
    if (!headingText) {
      continue;
    }
    if (!SUMMARY_HEADING_PATTERNS.some((pattern) => pattern.test(headingText))) {
      continue;
    }

    const level = getHeadingLevel(heading);
    if (!level) {
      continue;
    }

    const toRemove = [heading];
    let sibling = heading.nextElementSibling;
    while (sibling) {
      const siblingLevel = getHeadingLevel(sibling);
      if (siblingLevel && siblingLevel <= level) {
        break;
      }
      toRemove.push(sibling);
      sibling = sibling.nextElementSibling;
    }

    if (
      normalizedPreferred &&
      normalizedPreferred.length >= 16 &&
      toRemove.some((node) => elementContainsSelection(node, normalizedPreferred))
    ) {
      continue;
    }

    for (const node of toRemove) {
      node.remove();
    }
  }
}

function removeNodesBySelectors(root, selectors) {
  for (const selector of selectors) {
    try {
      const nodes = Array.from(root.querySelectorAll(selector));
      for (const node of nodes) {
        node.remove();
      }
    } catch (_error) {
      continue;
    }
  }
}

function appendTextSeparators(root) {
  const blockNodes = root.querySelectorAll(
    "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, section, article, div, br, hr, tr"
  );
  for (const node of blockNodes) {
    node.append("\n");
  }
}

function cleanExtractedLines(rawText) {
  const lines = String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const cleaned = [];
  let previous = "";

  for (const line of lines) {
    if (line.length < 2) {
      continue;
    }
    if (CONTENT_LINE_NOISE_RE.test(line)) {
      continue;
    }
    if (/^\d+\s*(min|mins|minutes)$/i.test(line)) {
      continue;
    }
    if (/^(share|follow)\s+/i.test(line) && line.length <= 60) {
      continue;
    }
    if (/^[\W\d_]{3,}$/.test(line)) {
      continue;
    }
    if (NON_ARTICLE_TEXT_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }
    if (isLikelyUiNoiseText(line)) {
      continue;
    }
    if (line === previous) {
      continue;
    }
    cleaned.push(line);
    previous = line;
  }

  const trimmed = stripTrailingNoiseLines(cleaned);
  return normalizeText(trimmed.join("\n"));
}

function isLikelyCtaLine(line) {
  const normalized = normalizeComparableText(line);
  if (!normalized) {
    return false;
  }
  if (normalized.length > 180) {
    return false;
  }

  if (CONTENT_LINE_NOISE_RE.test(line)) {
    return true;
  }

  if (/^(har du tips\??|tips oss|got a tip\??|have a tip\??)$/i.test(line)) {
    return true;
  }

  if (/^send\s+(us|oss)\b/i.test(normalized)) {
    return true;
  }

  if (!CONTENT_CTA_HINT_RE.test(normalized)) {
    return false;
  }

  const sentencePunctuation = (line.match(/[.!?]/g) || []).length;
  return sentencePunctuation <= 2;
}

function stripTrailingNoiseLines(lines) {
  if (!Array.isArray(lines) || lines.length < 5) {
    return Array.isArray(lines) ? lines : [];
  }

  const cleaned = [...lines];
  let removed = 0;
  while (cleaned.length > 0 && removed < 4) {
    const line = cleaned[cleaned.length - 1];
    if (!isLikelyCtaLine(line)) {
      break;
    }
    cleaned.pop();
    removed += 1;
  }

  return cleaned.length > 0 ? cleaned : lines;
}

function getElementSignalText(element) {
  const className =
    typeof element.className === "string"
      ? element.className
      : element.className?.baseVal || "";
  return [
    element.tagName?.toLowerCase() || "",
    element.id || "",
    className,
    element.getAttribute("role") || "",
    element.getAttribute("aria-label") || ""
  ].join(" ");
}

function looksLikeNoiseContainer(element) {
  const signal = getElementSignalText(element);
  return CONTENT_NEGATIVE_RE.test(signal) && !CONTENT_POSITIVE_RE.test(signal);
}

function getNodeTextLength(element) {
  return normalizeText(element?.textContent || "").length;
}

function getLinkDensity(element) {
  const textLength = getNodeTextLength(element);
  if (!textLength) {
    return 0;
  }

  const linkTextLength = Array.from(element.querySelectorAll("a"))
    .map((link) => getNodeTextLength(link))
    .reduce((sum, length) => sum + length, 0);
  return linkTextLength / textLength;
}

function removeHighLinkDensityBlocks(root) {
  const candidates = root.querySelectorAll("div, section, ul, ol, aside");
  for (const node of candidates) {
    const textLength = getNodeTextLength(node);
    if (textLength < 140) {
      continue;
    }
    const linkDensity = getLinkDensity(node);
    if (linkDensity > 0.72) {
      node.remove();
    }
  }
}

function removeLowContentInteractiveBlocks(root) {
  const candidates = root.querySelectorAll("section, div, aside");
  for (const node of candidates) {
    const textLength = getNodeTextLength(node);
    if (textLength === 0 || textLength > 300) {
      continue;
    }
    const interactiveCount = node.querySelectorAll("a[href], button, form, input, textarea").length;
    const paragraphCount = node.querySelectorAll("p").length;
    const headingCount = node.querySelectorAll("h1, h2, h3, h4, h5, h6").length;
    const normalizedText = normalizeComparableText(node.textContent || "");
    if (interactiveCount >= 3 && paragraphCount <= 1) {
      node.remove();
      continue;
    }
    if (interactiveCount >= 2 && headingCount >= 1 && paragraphCount <= 1 && textLength < 240) {
      node.remove();
      continue;
    }
    if (interactiveCount >= 2 && paragraphCount <= 2 && textLength < 180) {
      node.remove();
      continue;
    }
    if (interactiveCount >= 1 && paragraphCount <= 2 && textLength < 220 && CONTENT_CTA_HINT_RE.test(normalizedText)) {
      node.remove();
    }
  }
}

function removeUiNoiseContainers(root, preferredSelection = "") {
  const normalizedPreferred = normalizeComparableText(preferredSelection);
  const candidates = root.querySelectorAll("section, div, aside, p, li, span");

  for (const node of candidates) {
    const text = normalizeText(node.textContent || "");
    if (text.length < 24 || text.length > 1200) {
      continue;
    }

    if (normalizedPreferred && normalizedPreferred.length >= 16) {
      const normalizedText = normalizeComparableText(text);
      if (normalizedText.includes(normalizedPreferred)) {
        continue;
      }
    }

    if (isLikelyUiNoiseText(text)) {
      node.remove();
    }
  }
}

function removeEmptyContainers(root) {
  const nodes = root.querySelectorAll("div, section, article, main");
  for (const node of nodes) {
    const textLength = getNodeTextLength(node);
    if (textLength > 0) {
      continue;
    }
    if (node.querySelector("img, video, iframe")) {
      continue;
    }
    node.remove();
  }
}

function buildSanitizedClone(element, preferredSelection = "") {
  const clone = element.cloneNode(true);
  removeNodesBySelectors(clone, CONTENT_STRIP_SELECTORS);
  removeNodesBySelectors(clone, CONTENT_NOISE_SELECTORS);
  removeNodesBySelectors(clone, CONTENT_UI_NOISE_SELECTORS);
  removePatternMatchedContainers(clone, PROMO_BOX_PATTERNS, preferredSelection);
  removePatternMatchedContainers(clone, SUMMARY_BOX_PATTERNS, preferredSelection);
  removePatternMatchedContainers(clone, INFO_BOX_PATTERNS, preferredSelection);
  removeSummaryHeadingSections(clone, preferredSelection);
  removeHighLinkDensityBlocks(clone);
  removeLowContentInteractiveBlocks(clone);
  removeUiNoiseContainers(clone, preferredSelection);
  removeEmptyContainers(clone);
  appendTextSeparators(clone);
  return clone;
}

function extractTextFromElement(element, preferredSelection = "") {
  const clone = buildSanitizedClone(element, preferredSelection);
  const raw = String(clone.textContent || "").replace(/\u00a0/g, " ");
  return cleanExtractedLines(raw);
}

function getClassWeight(element) {
  const signal = getElementSignalText(element);
  let weight = 0;
  if (CONTENT_POSITIVE_RE.test(signal)) {
    weight += 25;
  }
  if (CONTENT_NEGATIVE_RE.test(signal)) {
    weight -= 25;
  }
  return weight;
}

function initializeCandidateScore(scoreMap, element) {
  if (!element) {
    return null;
  }
  if (scoreMap.has(element)) {
    return scoreMap.get(element);
  }

  const tag = element.tagName?.toLowerCase() || "";
  let score = getClassWeight(element);
  if (tag === "article") {
    score += 20;
  } else if (tag === "section") {
    score += 8;
  } else if (tag === "main") {
    score += 12;
  } else if (tag === "div") {
    score += 5;
  } else if (tag === "blockquote") {
    score += 3;
  }

  const entry = { score };
  scoreMap.set(element, entry);
  return entry;
}

function addCandidateScore(scoreMap, element, delta) {
  const entry = initializeCandidateScore(scoreMap, element);
  if (!entry) {
    return;
  }
  entry.score += delta;
}

function scoreCandidates(root, preferredSelection = "") {
  const scoreMap = new Map();
  const normalizedPreferred = normalizeComparableText(preferredSelection);
  const nodes = root.querySelectorAll("p, pre, td, blockquote, li");

  for (const node of nodes) {
    const text = normalizeText(node.textContent || "");
    const length = text.length;
    if (length < 60) {
      continue;
    }

    const parent = node.parentElement;
    const grandparent = parent?.parentElement || null;
    if (!parent) {
      continue;
    }
    if (looksLikeNoiseContainer(parent)) {
      continue;
    }

    let score = 1;
    score += text.split(",").length;
    score += Math.min(Math.floor(length / 120), 3);
    score += Math.min((text.match(/[.!?](\s|$)/g) || []).length, 10);

    addCandidateScore(scoreMap, parent, score);
    addCandidateScore(scoreMap, grandparent, score / 2);
  }

  for (const selector of MAIN_CONTENT_HINT_SELECTORS) {
    for (const node of root.querySelectorAll(selector)) {
      addCandidateScore(scoreMap, node, 20);
    }
  }

  for (const [node, entry] of scoreMap.entries()) {
    const linkDensity = getLinkDensity(node);
    entry.score *= 1 - Math.min(linkDensity, 0.95);

    if (normalizedPreferred && normalizedPreferred.length >= 16) {
      const nodeText = normalizeComparableText(node.textContent || "");
      if (nodeText.includes(normalizedPreferred)) {
        entry.score += 160;
      }
    }
  }

  return scoreMap;
}

function getTopCandidate(scoreMap) {
  let topNode = null;
  let topScore = Number.NEGATIVE_INFINITY;
  for (const [node, entry] of scoreMap.entries()) {
    if (entry.score > topScore) {
      topScore = entry.score;
      topNode = node;
    }
  }
  return { topNode, topScore };
}

function buildArticleContainer(topNode, scoreMap, preferredSelection = "") {
  if (!topNode) {
    return null;
  }

  const output = document.createElement("div");
  const parent = topNode.parentElement || topNode;
  const topScore = scoreMap.get(topNode)?.score || 0;
  const siblingThreshold = Math.max(10, topScore * 0.2);
  const normalizedPreferred = normalizeComparableText(preferredSelection);

  for (const sibling of Array.from(parent.children)) {
    let append = sibling === topNode;
    const siblingScore = scoreMap.get(sibling)?.score || 0;
    if (!append && siblingScore >= siblingThreshold) {
      append = true;
    }

    if (!append) {
      const text = normalizeText(sibling.textContent || "");
      const length = text.length;
      const linkDensity = getLinkDensity(sibling);
      const paragraphCount = sibling.querySelectorAll("p").length;
      const sentenceCount = (text.match(/[.!?](\s|$)/g) || []).length;
      if (
        length > 220 &&
        linkDensity < 0.3 &&
        !looksLikeNoiseContainer(sibling) &&
        (paragraphCount >= 2 || sentenceCount >= 2)
      ) {
        append = true;
      }
      if (!append && normalizedPreferred && normalizedPreferred.length >= 16) {
        if (normalizeComparableText(text).includes(normalizedPreferred)) {
          append = true;
        }
      }
    }

    if (append) {
      output.appendChild(sibling.cloneNode(true));
    }
  }

  return output;
}

function ensureSelectionIncluded(documentText, selectedText) {
  const normalizedDocument = normalizeComparableText(documentText);
  const normalizedSelected = normalizeComparableText(selectedText);
  if (!normalizedSelected || normalizedSelected.length < 16) {
    return normalizeDocumentText(documentText);
  }
  if (normalizedDocument.includes(normalizedSelected)) {
    return normalizeDocumentText(documentText);
  }
  return normalizeDocumentText(`${documentText} ${selectedText}`);
}

function getDocumentText(selectedText = "") {
  const bodyText = normalizeText(document.body?.innerText || "");
  if (!bodyText) {
    return "";
  }

  const bodyClone = buildSanitizedClone(document.body, selectedText);
  const scores = scoreCandidates(bodyClone, selectedText);
  const { topNode, topScore } = getTopCandidate(scores);
  let bestText = "";

  if (topNode && Number.isFinite(topScore) && topScore > 0) {
    const articleContainer = buildArticleContainer(topNode, scores, selectedText);
    if (articleContainer) {
      bestText = extractTextFromElement(articleContainer, selectedText);
    }
  }

  if (bestText) {
    const coverage = bestText.length / Math.max(bodyText.length, 1);
    if (bestText.length >= 360 || coverage >= 0.2) {
      return ensureSelectionIncluded(bestText, selectedText);
    }
  }

  const cleanedBody = extractTextFromElement(document.body, selectedText);
  if (cleanedBody.length >= Math.min(360, bodyText.length)) {
    return ensureSelectionIncluded(cleanedBody, selectedText);
  }

  return ensureSelectionIncluded(bodyText, selectedText);
}

const TOAST_STYLE_ID = "ccs-toast-style";
const TOAST_ID = "ccs-toast";
const COMMENT_STYLE_ID = "ccs-comment-style";
const COMMENT_OVERLAY_ID = "ccs-comment-overlay";
const NOTES_PANEL_ID = "ccs-notes-panel";
const NOTES_COUNT_ID = "ccs-notes-count";
const NOTES_LIST_ID = "ccs-notes-list";
const SELECTION_BUBBLE_ID = "ccs-selection-bubble";
const CAPTURE_SETTINGS_KEY = "captureSettings";

const supportsCssHighlights = typeof globalThis.Highlight === "function" && Boolean(globalThis.CSS?.highlights);
const pendingAnnotationPreviews = new Map();
const pendingAnnotationSnapshot = new Map();
const pendingAnnotationFallbackWrappers = new Map();
const MAX_DOM_PREVIEW_WRAPPERS = 120;
const MAX_DOM_PREVIEW_TEXT_CHARS = 900;

const BUBBLE_ACTION_META = {
  save_content: {
    label: "Save content",
    variant: "primary"
  },
  save_content_with_highlight: {
    label: "Save content with highlight",
    variant: "secondary"
  },
  save_content_with_note: {
    label: "Save content with a note",
    variant: "secondary"
  },
  highlight: {
    label: "Highlight",
    variant: "secondary"
  },
  highlight_with_note: {
    label: "Highlight with a note",
    variant: "secondary"
  }
};

const YOUTUBE_BUBBLE_ACTIONS = [
  {
    key: "save_youtube_transcript",
    label: "Save YouTube transcript",
    variant: "primary"
  },
  {
    key: "save_youtube_transcript_with_note",
    label: "Save transcript with a note",
    variant: "secondary"
  }
];

const bubbleMenuConfig = {
  order: [...DEFAULT_BUBBLE_MENU_ORDER],
  enabled: [...DEFAULT_BUBBLE_MENU_ENABLED],
  layout: DEFAULT_BUBBLE_MENU_LAYOUT,
  style: DEFAULT_BUBBLE_MENU_STYLE
};

async function loadBubbleMenuConfig() {
  try {
    const result = await chrome.storage?.local?.get(CAPTURE_SETTINGS_KEY);
    const settings = result?.[CAPTURE_SETTINGS_KEY] || {};
    const normalized = normalizeBubbleMenuConfig(settings);
    bubbleMenuConfig.order = normalized.order;
    bubbleMenuConfig.enabled = normalized.enabled;
    bubbleMenuConfig.layout = normalized.layout;
    bubbleMenuConfig.style = normalized.style;
  } catch (_error) {
    bubbleMenuConfig.order = [...DEFAULT_BUBBLE_MENU_ORDER];
    bubbleMenuConfig.enabled = [...DEFAULT_BUBBLE_MENU_ENABLED];
    bubbleMenuConfig.layout = DEFAULT_BUBBLE_MENU_LAYOUT;
    bubbleMenuConfig.style = DEFAULT_BUBBLE_MENU_STYLE;
  }
}

loadBubbleMenuConfig().catch(() => undefined);
chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes?.[CAPTURE_SETTINGS_KEY]) {
    return;
  }
  const next = changes[CAPTURE_SETTINGS_KEY]?.newValue || {};
  const normalized = normalizeBubbleMenuConfig(next);
  bubbleMenuConfig.order = normalized.order;
  bubbleMenuConfig.enabled = normalized.enabled;
  bubbleMenuConfig.layout = normalized.layout;
  bubbleMenuConfig.style = normalized.style;
  hideSelectionBubble();
  scheduleSelectionBubbleUpdate();
});

function ensureToastStyles() {
  if (document.getElementById(TOAST_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = TOAST_STYLE_ID;
  style.textContent = `
    .ccs-toast {
      position: fixed;
      right: 16px;
      bottom: 16px;
      max-width: 360px;
      background: #152238;
      color: #f8fafc;
      border-radius: 12px;
      padding: 12px 14px;
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.28);
      font: 13px/1.4 "Segoe UI", Arial, sans-serif;
      z-index: 2147483647;
      display: grid;
      gap: 6px;
    }

    .ccs-toast__title {
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.2px;
    }

    .ccs-toast__detail {
      color: #d5dfef;
      font-size: 12px;
      word-break: break-word;
      white-space: pre-wrap;
    }
  `;
  document.head?.appendChild(style);
}

function showSaveToast({ captureType, title, annotationCount, lastAnnotation, fileName }) {
  ensureToastStyles();

  const existing = document.getElementById(TOAST_ID);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "ccs-toast";

  const titleEl = document.createElement("div");
  titleEl.className = "ccs-toast__title";
  titleEl.textContent =
    captureType === "youtube_transcript" ? "Saved YouTube transcript" : "Saved page content";

  const detailEl = document.createElement("div");
  detailEl.className = "ccs-toast__detail";

  const lines = [];
  if (title) {
    lines.push(`Title: ${title}`);
  }

  if (captureType === "youtube_transcript") {
    lines.push("Transcript extracted from this page.");
  } else if (annotationCount && annotationCount > 0) {
    lines.push(`Highlights: ${annotationCount}`);
    if (lastAnnotation?.selectedText) {
      const preview = lastAnnotation.selectedText.trim().replace(/\s+/g, " ").slice(0, 160);
      lines.push(`Selected: "${preview}${lastAnnotation.selectedText.trim().length > 160 ? "..." : ""}"`);
    }
    if (lastAnnotation?.comment) {
      lines.push(
        `Note: "${lastAnnotation.comment.trim().slice(0, 120)}${
          lastAnnotation.comment.trim().length > 120 ? "..." : ""
        }"`
      );
    }
  } else {
    lines.push("No highlights. Saved full page content.");
  }

  if (fileName) {
    lines.push(`File: ${fileName}`);
  }

  detailEl.textContent = lines.join("\n");

  toast.append(titleEl, detailEl);
  document.body?.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

function showProgressToast({ title, detail }) {
  ensureToastStyles();

  const existing = document.getElementById(TOAST_ID);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "ccs-toast";
  toast.style.background = "#1d2f4f";

  const titleEl = document.createElement("div");
  titleEl.className = "ccs-toast__title";
  titleEl.textContent = title || "Capturing...";

  const detailEl = document.createElement("div");
  detailEl.className = "ccs-toast__detail";
  detailEl.textContent = detail || "Working...";

  toast.append(titleEl, detailEl);
  document.body?.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 2200);
}

function showErrorToast(message) {
  ensureToastStyles();

  const existing = document.getElementById(TOAST_ID);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "ccs-toast";
  toast.style.background = "#5f1b1b";

  const titleEl = document.createElement("div");
  titleEl.className = "ccs-toast__title";
  titleEl.textContent = "Capture failed";

  const detailEl = document.createElement("div");
  detailEl.className = "ccs-toast__detail";
  detailEl.textContent = message || "Unknown error";

  toast.append(titleEl, detailEl);
  document.body?.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3600);
}

function showInfoToast({ title, detail }) {
  ensureToastStyles();

  const existing = document.getElementById(TOAST_ID);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "ccs-toast";
  toast.style.background = "#1c3b2b";

  const titleEl = document.createElement("div");
  titleEl.className = "ccs-toast__title";
  titleEl.textContent = title || "Info";

  const detailEl = document.createElement("div");
  detailEl.className = "ccs-toast__detail";
  detailEl.textContent = detail || "";

  toast.append(titleEl, detailEl);
  document.body?.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 2200);
}

function ensureCommentStyles() {
  if (document.getElementById(COMMENT_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = COMMENT_STYLE_ID;
  style.textContent = `
    .ccs-comment-overlay {
      position: fixed;
      inset: 0;
      background: rgba(9, 16, 28, 0.58);
      display: grid;
      place-items: center;
      z-index: 2147483647;
      font: 14px/1.4 "Segoe UI", Arial, sans-serif;
    }

    .ccs-comment-panel {
      width: min(420px, calc(100vw - 32px));
      background: #f8fafc;
      color: #0f172a;
      border-radius: 14px;
      padding: 16px;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28);
      display: grid;
      gap: 10px;
    }

    .ccs-comment-panel h2 {
      margin: 0;
      font-size: 16px;
    }

    .ccs-comment-panel p {
      margin: 0;
      color: #475569;
      font-size: 12px;
    }

    .ccs-comment-panel textarea {
      width: 100%;
      min-height: 110px;
      border: 1px solid #cbd5f5;
      border-radius: 10px;
      padding: 10px;
      font: inherit;
      resize: vertical;
    }

    .ccs-comment-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }

    .ccs-comment-actions button {
      border: 0;
      border-radius: 10px;
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
    }

    .ccs-comment-actions .primary {
      background: #1d4ed8;
      color: #fff;
    }

    .ccs-comment-actions .ghost {
      background: #e2e8f0;
      color: #0f172a;
    }

    .ccs-notes-panel {
      position: fixed;
      right: 18px;
      bottom: 88px;
      background: #0f172a;
      color: #f8fafc;
      border-radius: 14px;
      padding: 12px 14px;
      display: grid;
      gap: 8px;
      font: 13px/1.4 "Segoe UI", Arial, sans-serif;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.3);
      z-index: 2147483646;
      width: min(360px, calc(100vw - 28px));
      max-height: min(60vh, 480px);
    }

    .ccs-notes-panel__count {
      font-weight: 700;
      font-size: 13px;
    }

    .ccs-notes-panel__list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 6px;
      max-height: min(34vh, 280px);
      overflow: auto;
    }

    .ccs-notes-panel__item {
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 10px;
      padding: 8px;
      display: grid;
      gap: 4px;
    }

    .ccs-notes-panel__item-text {
      color: #e2e8f0;
      font-size: 12px;
      white-space: normal;
      word-break: break-word;
    }

    .ccs-notes-panel__item-comment {
      color: #bae6fd;
      font-size: 12px;
      white-space: normal;
      word-break: break-word;
    }

    .ccs-notes-panel__item-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .ccs-notes-panel__item-kind {
      font-size: 11px;
      color: #cbd5e1;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .ccs-notes-panel__remove {
      border: 1px solid rgba(248, 113, 113, 0.5);
      background: rgba(127, 29, 29, 0.2);
      color: #fecaca;
      border-radius: 8px;
      padding: 4px 8px;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-weight: 700;
    }

    .ccs-notes-panel__remove:hover {
      background: rgba(127, 29, 29, 0.36);
    }

    .ccs-notes-panel__actions {
      display: flex;
      gap: 8px;
    }

    .ccs-notes-panel__actions button {
      border: 0;
      border-radius: 10px;
      padding: 8px 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .ccs-notes-panel__actions .primary {
      background: #38bdf8;
      color: #0f172a;
    }

    .ccs-notes-panel__actions .ghost {
      background: rgba(148, 163, 184, 0.2);
      color: #f8fafc;
    }

    ::highlight(ccs-pending-highlight) {
      background: rgba(251, 191, 36, 0.42);
      color: inherit;
    }

    ::highlight(ccs-pending-note) {
      background: rgba(250, 204, 21, 0.48);
      color: inherit;
    }

    .ccs-pending-highlight-fallback {
      background: rgba(251, 191, 36, 0.42);
      color: inherit;
      border-radius: 2px;
    }

    .ccs-pending-note-fallback {
      background: rgba(250, 204, 21, 0.48);
      color: inherit;
      border-radius: 2px;
      box-shadow: inset 0 -1px 0 rgba(124, 45, 18, 0.35);
    }

    .ccs-selection-bubble {
      position: fixed;
      --bubble-bg: rgba(12, 19, 32, 0.88);
      --bubble-border: rgba(123, 172, 255, 0.35);
      --bubble-shadow: 0 12px 32px rgba(2, 6, 23, 0.32);
      --bubble-text: #e6eefc;
      --bubble-primary-bg: rgba(56, 189, 248, 0.22);
      --bubble-primary-border: rgba(56, 189, 248, 0.42);
      --bubble-primary-hover: rgba(56, 189, 248, 0.32);
      --bubble-secondary-bg: rgba(148, 163, 184, 0.12);
      --bubble-secondary-border: rgba(148, 163, 184, 0.26);
      --bubble-secondary-hover: rgba(148, 163, 184, 0.22);
      background: var(--bubble-bg);
      color: var(--bubble-text);
      border: 1px solid var(--bubble-border);
      border-radius: 12px;
      padding: 7px;
      display: grid;
      gap: 6px;
      max-width: min(96vw, 620px);
      min-width: min(280px, 90vw);
      box-shadow: var(--bubble-shadow);
      font: 12px/1.2 "Segoe UI", Arial, sans-serif;
      z-index: 2147483646;
      pointer-events: auto;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .ccs-selection-bubble.ccs-selection-bubble--above {
      transform: translate(-50%, -100%);
    }

    .ccs-selection-bubble.ccs-selection-bubble--below {
      transform: translate(-50%, 0);
    }

    .ccs-selection-bubble .ccs-selection-bubble__actions {
      gap: 6px;
    }

    .ccs-selection-bubble.ccs-selection-bubble--layout-horizontal .ccs-selection-bubble__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: stretch;
    }

    .ccs-selection-bubble.ccs-selection-bubble--layout-vertical .ccs-selection-bubble__actions {
      display: grid;
      grid-template-columns: 1fr;
    }

    .ccs-selection-bubble .ccs-selection-bubble__action {
      border: 1px solid transparent;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      min-height: 32px;
      padding: 7px 10px;
      border-radius: 8px;
      letter-spacing: 0.1px;
      transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease;
      white-space: normal;
      text-align: center;
    }

    .ccs-selection-bubble.ccs-selection-bubble--layout-horizontal .ccs-selection-bubble__action {
      flex: 0 1 auto;
      white-space: nowrap;
      text-align: center;
    }

    .ccs-selection-bubble .ccs-selection-bubble__action--primary {
      background: var(--bubble-primary-bg);
      border-color: var(--bubble-primary-border);
    }

    .ccs-selection-bubble .ccs-selection-bubble__action--primary:hover {
      background: var(--bubble-primary-hover);
      transform: translateY(-1px);
    }

    .ccs-selection-bubble .ccs-selection-bubble__action--secondary {
      background: var(--bubble-secondary-bg);
      border-color: var(--bubble-secondary-border);
    }

    .ccs-selection-bubble .ccs-selection-bubble__action--secondary:hover {
      background: var(--bubble-secondary-hover);
      transform: translateY(-1px);
    }

    .ccs-selection-bubble .ccs-selection-bubble__action:focus-visible {
      outline: 2px solid rgba(56, 189, 248, 0.7);
      outline-offset: 1px;
    }

    .ccs-selection-bubble.ccs-selection-bubble--clean {
      --bubble-bg: rgba(250, 252, 255, 0.97);
      --bubble-border: rgba(148, 163, 184, 0.34);
      --bubble-shadow: 0 10px 26px rgba(15, 23, 42, 0.18);
      --bubble-text: #0f172a;
      --bubble-primary-bg: rgba(37, 99, 235, 0.12);
      --bubble-primary-border: rgba(37, 99, 235, 0.3);
      --bubble-primary-hover: rgba(37, 99, 235, 0.2);
      --bubble-secondary-bg: rgba(15, 23, 42, 0.05);
      --bubble-secondary-border: rgba(15, 23, 42, 0.14);
      --bubble-secondary-hover: rgba(15, 23, 42, 0.1);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    .ccs-selection-bubble.ccs-selection-bubble--midnight {
      --bubble-bg: rgba(9, 13, 28, 0.94);
      --bubble-border: rgba(99, 102, 241, 0.42);
      --bubble-shadow: 0 16px 34px rgba(2, 6, 23, 0.42);
      --bubble-text: #f8fafc;
      --bubble-primary-bg: rgba(79, 70, 229, 0.24);
      --bubble-primary-border: rgba(129, 140, 248, 0.55);
      --bubble-primary-hover: rgba(79, 70, 229, 0.34);
      --bubble-secondary-bg: rgba(51, 65, 85, 0.35);
      --bubble-secondary-border: rgba(148, 163, 184, 0.36);
      --bubble-secondary-hover: rgba(71, 85, 105, 0.5);
    }

    @media (max-width: 640px) {
      .ccs-selection-bubble {
        min-width: 0;
        max-width: calc(100vw - 14px);
      }

      .ccs-selection-bubble.ccs-selection-bubble--layout-horizontal .ccs-selection-bubble__actions {
        display: grid;
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head?.appendChild(style);
}

function truncatePreviewText(value, maxLength = 180) {
  const text = normalizeText(value || "");
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function buildNodePath(node) {
  const parts = [];
  let current = node;
  while (current && current !== document.body) {
    const parent = current.parentNode;
    if (!parent) {
      break;
    }
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    parts.push(index);
    current = parent;
  }
  return parts.reverse().join(".");
}

function buildRangeKey(range) {
  if (!range) {
    return null;
  }
  return [
    buildNodePath(range.startContainer),
    range.startOffset,
    buildNodePath(range.endContainer),
    range.endOffset
  ].join(":");
}

function mapCollapsedIndexToRawIndex(raw, targetIndex) {
  let rawIndex = 0;
  let collapsedIndex = 0;
  let previousWasWhitespace = false;
  while (rawIndex < raw.length && collapsedIndex < targetIndex) {
    const char = raw[rawIndex];
    const isWhitespace = /\s/.test(char);
    if (isWhitespace) {
      if (!previousWasWhitespace) {
        collapsedIndex += 1;
      }
      previousWasWhitespace = true;
    } else {
      collapsedIndex += 1;
      previousWasWhitespace = false;
    }
    rawIndex += 1;
  }
  return Math.max(0, Math.min(rawIndex, raw.length));
}

function isRenderableTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return false;
  }
  const text = node.textContent || "";
  if (!text.trim()) {
    return false;
  }
  const parent = node.parentElement;
  if (!parent) {
    return false;
  }
  if (parent.closest(`#${COMMENT_OVERLAY_ID}, #${NOTES_PANEL_ID}, #${SELECTION_BUBBLE_ID}`)) {
    return false;
  }
  const tagName = parent.tagName.toUpperCase();
  if (tagName === "SCRIPT" || tagName === "STYLE" || tagName === "NOSCRIPT") {
    return false;
  }
  if (tagName === "TEXTAREA" || tagName === "INPUT" || tagName === "OPTION") {
    return false;
  }
  return true;
}

function createRangeFromNodeOffsets(node, startOffset, endOffset) {
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const textLength = (node.textContent || "").length;
  const safeStart = Math.max(0, Math.min(startOffset, textLength));
  const safeEnd = Math.max(safeStart, Math.min(endOffset, textLength));
  if (safeEnd <= safeStart) {
    return null;
  }
  const range = document.createRange();
  range.setStart(node, safeStart);
  range.setEnd(node, safeEnd);
  return range;
}

function findAnnotationPreviewRange(annotation, usedRangeKeys = new Set()) {
  const selectedText = normalizeText(annotation?.selectedText || "");
  if (!selectedText) {
    return null;
  }

  const selectedTextLower = selectedText.toLowerCase();
  const fallbackToken = selectedText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 5)
    .sort((left, right) => right.length - left.length)[0] || "";

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (isRenderableTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
  });

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const raw = node.textContent || "";
    let range = null;

    let directIndex = raw.indexOf(selectedText);
    if (directIndex < 0) {
      directIndex = raw.toLowerCase().indexOf(selectedTextLower);
    }
    if (directIndex >= 0) {
      range = createRangeFromNodeOffsets(node, directIndex, directIndex + selectedText.length);
    }

    if (!range) {
      const collapsed = raw.replace(/\s+/g, " ");
      const collapsedLower = collapsed.toLowerCase();
      const collapsedIndex = collapsedLower.indexOf(selectedTextLower);
      if (collapsedIndex >= 0) {
        const rawStart = mapCollapsedIndexToRawIndex(raw, collapsedIndex);
        const rawEnd = mapCollapsedIndexToRawIndex(raw, collapsedIndex + selectedText.length);
        range = createRangeFromNodeOffsets(node, rawStart, rawEnd);
      }
    }

    if (!range && fallbackToken) {
      const tokenIndex = raw.toLowerCase().indexOf(fallbackToken.toLowerCase());
      if (tokenIndex >= 0) {
        range = createRangeFromNodeOffsets(node, tokenIndex, tokenIndex + fallbackToken.length);
      }
    }

    if (!range) {
      continue;
    }
    const rangeKey = buildRangeKey(range);
    if (!rangeKey || usedRangeKeys.has(rangeKey)) {
      continue;
    }
    return {
      range,
      rangeKey
    };
  }
  return null;
}

function unwrapPendingFallbackWrappers(annotationId = null) {
  const targets = annotationId
    ? [[annotationId, pendingAnnotationFallbackWrappers.get(annotationId) || []]]
    : [...pendingAnnotationFallbackWrappers.entries()];

  for (const [id, wrappers] of targets) {
    for (const wrapper of wrappers) {
      if (!(wrapper instanceof HTMLElement) || !wrapper.isConnected) {
        continue;
      }
      const parent = wrapper.parentNode;
      if (!parent) {
        continue;
      }
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      parent.removeChild(wrapper);
      parent.normalize();
    }
    pendingAnnotationFallbackWrappers.delete(id);
  }
}

function applyPendingFallbackWrappers() {
  unwrapPendingFallbackWrappers();
  let wrappedCount = 0;
  for (const [annotationId, preview] of pendingAnnotationPreviews.entries()) {
    if (!preview?.range || wrappedCount >= MAX_DOM_PREVIEW_WRAPPERS) {
      continue;
    }
    const range = preview.range.cloneRange();
    const rangeText = normalizeText(range.toString() || "");
    if (!rangeText || rangeText.length > MAX_DOM_PREVIEW_TEXT_CHARS) {
      continue;
    }

    const wrapper = document.createElement("span");
    wrapper.className = preview.comment
      ? "ccs-pending-note-fallback"
      : "ccs-pending-highlight-fallback";
    wrapper.dataset.ccsPendingPreview = annotationId;

    try {
      range.surroundContents(wrapper);
    } catch (_error) {
      try {
        const extracted = range.extractContents();
        wrapper.appendChild(extracted);
        range.insertNode(wrapper);
      } catch (_innerError) {
        continue;
      }
    }

    const existing = pendingAnnotationFallbackWrappers.get(annotationId) || [];
    existing.push(wrapper);
    pendingAnnotationFallbackWrappers.set(annotationId, existing);
    wrappedCount += 1;
  }
}

function refreshPendingAnnotationHighlights() {
  if (!supportsCssHighlights) {
    applyPendingFallbackWrappers();
    return;
  }

  const highlights = new globalThis.Highlight();
  const noteHighlights = new globalThis.Highlight();

  for (const preview of pendingAnnotationPreviews.values()) {
    if (!preview?.range) {
      continue;
    }
    if (preview.comment) {
      noteHighlights.add(preview.range);
    } else {
      highlights.add(preview.range);
    }
  }

  if (highlights.size > 0) {
    globalThis.CSS.highlights.set("ccs-pending-highlight", highlights);
  } else {
    globalThis.CSS.highlights.delete("ccs-pending-highlight");
  }

  if (noteHighlights.size > 0) {
    globalThis.CSS.highlights.set("ccs-pending-note", noteHighlights);
  } else {
    globalThis.CSS.highlights.delete("ccs-pending-note");
  }
}

function clearPendingAnnotationHighlights() {
  pendingAnnotationSnapshot.clear();
  pendingAnnotationPreviews.clear();
  unwrapPendingFallbackWrappers();
  if (!supportsCssHighlights) {
    return;
  }
  globalThis.CSS.highlights.delete("ccs-pending-highlight");
  globalThis.CSS.highlights.delete("ccs-pending-note");
}

function syncPendingAnnotationPreviews(annotations = []) {
  const normalized = Array.isArray(annotations)
    ? annotations
        .map((annotation) => ({
          id: String(annotation?.id || "").trim(),
          selectedText: annotation?.selectedText || "",
          comment: annotation?.comment ?? null,
          createdAt: annotation?.createdAt || new Date().toISOString()
        }))
        .filter((annotation) => annotation.id)
    : [];

  if (!supportsCssHighlights) {
    // DOM fallback mutates text nodes, so reset wrappers and cached ranges before rematching.
    unwrapPendingFallbackWrappers();
    pendingAnnotationPreviews.clear();
  }

  const nextIds = new Set(normalized.map((annotation) => annotation.id));
  for (const existingId of [...pendingAnnotationSnapshot.keys()]) {
    if (!nextIds.has(existingId)) {
      pendingAnnotationSnapshot.delete(existingId);
      pendingAnnotationPreviews.delete(existingId);
    }
  }

  for (const annotation of normalized) {
    pendingAnnotationSnapshot.set(annotation.id, annotation);
  }

  const usedRangeKeys = new Set(
    [...pendingAnnotationPreviews.values()].map((preview) => preview?.rangeKey).filter(Boolean)
  );
  for (const annotation of normalized) {
    const current = pendingAnnotationPreviews.get(annotation.id);
    if (current && current.selectedText === annotation.selectedText) {
      current.comment = annotation.comment ?? null;
      continue;
    }
    if (current?.rangeKey) {
      usedRangeKeys.delete(current.rangeKey);
    }
    const nextRange = findAnnotationPreviewRange(annotation, usedRangeKeys);
    if (!nextRange) {
      pendingAnnotationPreviews.delete(annotation.id);
      continue;
    }
    usedRangeKeys.add(nextRange.rangeKey);
    pendingAnnotationPreviews.set(annotation.id, {
      range: nextRange.range,
      rangeKey: nextRange.rangeKey,
      selectedText: annotation.selectedText,
      comment: annotation.comment ?? null
    });
  }

  refreshPendingAnnotationHighlights();
  return normalized;
}

function ensureNotesPanel() {
  let panel = document.getElementById(NOTES_PANEL_ID);
  if (panel) {
    return panel;
  }

  ensureCommentStyles();

  panel = document.createElement("div");
  panel.id = NOTES_PANEL_ID;
  panel.className = "ccs-notes-panel";

  const count = document.createElement("div");
  count.id = NOTES_COUNT_ID;
  count.className = "ccs-notes-panel__count";
  count.textContent = "Highlights ready";

  const list = document.createElement("ul");
  list.id = NOTES_LIST_ID;
  list.className = "ccs-notes-panel__list";

  const actions = document.createElement("div");
  actions.className = "ccs-notes-panel__actions";

  const saveButton = document.createElement("button");
  saveButton.className = "primary";
  saveButton.type = "button";
  saveButton.textContent = "Save";

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
    try {
      const response = await chrome.runtime.sendMessage({ type: "RUN_CAPTURE", kind: "selection" });
      if (!response?.ok) {
        showErrorToast(response?.error || "Capture failed");
      }
    } catch (error) {
      showErrorToast(error?.message || "Capture failed");
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save";
    }
  });

  const clearButton = document.createElement("button");
  clearButton.className = "ghost";
  clearButton.type = "button";
  clearButton.textContent = "Clear all";
  clearButton.addEventListener("click", async () => {
    clearButton.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "CLEAR_PENDING_NOTES_STATE" });
      if (!response?.ok) {
        showErrorToast(response?.error || "Failed to clear highlights");
      }
      syncPendingAnnotations(response?.annotations || []);
    } catch (error) {
      showErrorToast(error?.message || "Failed to clear highlights");
    } finally {
      clearButton.disabled = false;
    }
  });

  actions.append(saveButton, clearButton);
  panel.append(count, list, actions);
  document.body?.appendChild(panel);
  return panel;
}

function renderNotesList(annotations = []) {
  const list = /** @type {HTMLUListElement|null} */ (document.getElementById(NOTES_LIST_ID));
  if (!list) {
    return;
  }
  list.textContent = "";
  for (const annotation of annotations) {
    const item = document.createElement("li");
    item.className = "ccs-notes-panel__item";

    const selectedText = truncatePreviewText(annotation.selectedText || "");
    const commentText = truncatePreviewText(annotation.comment || "", 140);

    const textEl = document.createElement("div");
    textEl.className = "ccs-notes-panel__item-text";
    textEl.textContent = selectedText || "(Note without selection)";

    const kindEl = document.createElement("span");
    kindEl.className = "ccs-notes-panel__item-kind";
    kindEl.textContent = annotation.comment ? "Note" : "Highlight";

    const meta = document.createElement("div");
    meta.className = "ccs-notes-panel__item-meta";
    meta.appendChild(kindEl);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ccs-notes-panel__remove";
    removeButton.textContent = "Delete";
    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({
          type: "REMOVE_PENDING_NOTE",
          annotationId: annotation.id
        });
        if (!response?.ok) {
          showErrorToast(response?.error || "Failed to remove highlight");
          return;
        }
        syncPendingAnnotations(response.annotations || []);
      } catch (error) {
        showErrorToast(error?.message || "Failed to remove highlight");
      } finally {
        removeButton.disabled = false;
      }
    });
    meta.appendChild(removeButton);

    item.append(textEl);
    if (commentText) {
      const commentEl = document.createElement("div");
      commentEl.className = "ccs-notes-panel__item-comment";
      commentEl.textContent = `Note: ${commentText}`;
      item.append(commentEl);
    }
    item.append(meta);
    list.appendChild(item);
  }
}

function updateNotesPanel(annotations = []) {
  const count = Array.isArray(annotations) ? annotations.length : 0;
  if (count <= 0) {
    const panel = document.getElementById(NOTES_PANEL_ID);
    panel?.remove();
    return;
  }

  const panel = ensureNotesPanel();
  renderNotesList(annotations);
  const countEl = document.getElementById(NOTES_COUNT_ID);
  if (countEl) {
    countEl.textContent = `${count} highlight${count === 1 ? "" : "s"} ready`;
  }
  panel.style.display = "grid";
}

function syncPendingAnnotations(annotations = []) {
  const normalized = syncPendingAnnotationPreviews(annotations);
  updateNotesPanel(normalized);
}

function clearNotesPanel() {
  clearPendingAnnotationHighlights();
  const panel = document.getElementById(NOTES_PANEL_ID);
  panel?.remove();
}

async function hydratePendingNotes() {
  if (isYouTubePage()) {
    clearNotesPanel();
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_PENDING_NOTES" });
    if (!response?.ok) {
      return;
    }
    syncPendingAnnotations(response.annotations || []);
  } catch (_error) {
    // Ignore bootstrap errors when the background worker is unavailable.
  }
}

async function resolveBubbleSelectionText(bubble, allowPdfClipboardCopy = true) {
  let text = normalizeText(bubble?.dataset?.selectionText || "");
  if (text || !isPdfPage()) {
    return text;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "RESOLVE_PDF_SELECTION",
      allowClipboardCopy: allowPdfClipboardCopy
    });
    if (response?.ok) {
      text = normalizeText(response.selectedText || "");
      if (text) {
        bubble.dataset.selectionText = text;
      }
    }
  } catch (_error) {
    text = "";
  }
  return text;
}

async function runBubbleAction(actionKey, bubble) {
  if (!bubble) {
    return;
  }

  const closeBubble = () => {
    bubble.remove();
  };

  if (actionKey === "save_content") {
    try {
      const response = await chrome.runtime.sendMessage({ type: "RUN_CAPTURE", kind: "selection" });
      if (!response?.ok) {
        showErrorToast(response?.error || "Capture failed");
      }
    } catch (error) {
      showErrorToast(error?.message || "Capture failed");
    } finally {
      closeBubble();
    }
    return;
  }

  if (actionKey === "save_content_with_note") {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "RUN_CAPTURE",
        kind: "selection_with_comment"
      });
      if (!response?.ok) {
        showErrorToast(response?.error || "Capture failed");
      }
    } catch (error) {
      showErrorToast(error?.message || "Capture failed");
    } finally {
      closeBubble();
    }
    return;
  }

  if (actionKey === "save_content_with_highlight") {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "RUN_CAPTURE",
        kind: "selection_with_highlight"
      });
      if (!response?.ok) {
        showErrorToast(response?.error || "Capture failed");
      }
    } catch (error) {
      showErrorToast(error?.message || "Capture failed");
    } finally {
      closeBubble();
    }
    return;
  }

  if (actionKey === "save_youtube_transcript") {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "RUN_CAPTURE",
        kind: "youtube_transcript"
      });
      if (!response?.ok) {
        showErrorToast(response?.error || "Capture failed");
      }
    } catch (error) {
      showErrorToast(error?.message || "Capture failed");
    } finally {
      closeBubble();
    }
    return;
  }

  if (actionKey === "save_youtube_transcript_with_note") {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "RUN_CAPTURE",
        kind: "youtube_transcript_with_comment"
      });
      if (!response?.ok) {
        showErrorToast(response?.error || "Capture failed");
      }
    } catch (error) {
      showErrorToast(error?.message || "Capture failed");
    } finally {
      closeBubble();
    }
    return;
  }

  const text = await resolveBubbleSelectionText(bubble, true);
  if (!text.trim()) {
    showErrorToast("Select text first.");
    closeBubble();
    return;
  }

  if (actionKey === "highlight") {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "ADD_NOTE",
        selectedText: text,
        comment: null
      });
      if (response?.ok) {
        syncPendingAnnotations(response.annotations || []);
        showInfoToast({ title: "Highlight added", detail: "Selection queued for saving." });
      } else {
        showErrorToast(response?.error || "Failed to add highlight");
      }
    } catch (error) {
      showErrorToast(error?.message || "Failed to add highlight");
    } finally {
      closeBubble();
    }
    return;
  }

  if (actionKey === "highlight_with_note") {
    const comment = await requestComment();
    if (comment === null) {
      closeBubble();
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ADD_NOTE",
        selectedText: text,
        comment
      });
      if (response?.ok) {
        syncPendingAnnotations(response.annotations || []);
        showInfoToast({ title: "Highlight added", detail: "Note queued for saving." });
      } else {
        showErrorToast(response?.error || "Failed to add highlight");
      }
    } catch (error) {
      showErrorToast(error?.message || "Failed to add highlight");
    } finally {
      closeBubble();
    }
  }
}

function buildDefaultBubbleActions() {
  const orderedEnabledActions = bubbleMenuConfig.order.filter((action) =>
    bubbleMenuConfig.enabled.includes(action)
  );
  const actionKeys = orderedEnabledActions.length
    ? orderedEnabledActions
    : ["save_content", "highlight", "highlight_with_note"];

  return actionKeys
    .map((actionKey, index) => {
      const meta = BUBBLE_ACTION_META[actionKey];
      if (!meta) {
        return null;
      }
      return {
        key: actionKey,
        label: meta.label,
        variant: index === 0 ? "primary" : meta.variant
      };
    })
    .filter(Boolean);
}

function buildBubbleActionsForMode(mode) {
  if (mode === "youtube") {
    return YOUTUBE_BUBBLE_ACTIONS;
  }
  return buildDefaultBubbleActions();
}

function ensureSelectionBubble(mode = "default") {
  let bubble = document.getElementById(SELECTION_BUBBLE_ID);
  if (bubble && (bubble.dataset.mode || "default") === mode) {
    return bubble;
  }
  if (bubble) {
    bubble.remove();
    bubble = null;
  }

  ensureCommentStyles();

  bubble = document.createElement("div");
  bubble.id = SELECTION_BUBBLE_ID;
  bubble.dataset.mode = mode;
  const bubbleLayout = BUBBLE_MENU_LAYOUTS.includes(bubbleMenuConfig.layout)
    ? bubbleMenuConfig.layout
    : DEFAULT_BUBBLE_MENU_LAYOUT;
  const bubbleStyle = BUBBLE_MENU_STYLES.includes(bubbleMenuConfig.style)
    ? bubbleMenuConfig.style
    : DEFAULT_BUBBLE_MENU_STYLE;
  bubble.className = `ccs-selection-bubble ccs-selection-bubble--${bubbleStyle} ` +
    `ccs-selection-bubble--layout-${bubbleLayout} ccs-selection-bubble--above`;
  bubble.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  const actions = buildBubbleActionsForMode(mode);

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "ccs-selection-bubble__actions";

  actions.forEach((action, index) => {
    const button = document.createElement("button");
    button.type = "button";
    const variant = action.variant || (index === 0 ? "primary" : "secondary");
    button.className = `ccs-selection-bubble__action ccs-selection-bubble__action--${variant}`;
    button.textContent = action.label;
    button.addEventListener("click", () => {
      void runBubbleAction(action.key, bubble);
    });
    actionsWrap.appendChild(button);
  });

  bubble.appendChild(actionsWrap);
  document.body?.appendChild(bubble);
  return bubble;
}

function hideSelectionBubble() {
  const bubble = document.getElementById(SELECTION_BUBBLE_ID);
  bubble?.remove();
}

let selectionBubbleTimer = null;
const lastPointerPosition = { x: 0, y: 0, has: false };
let pdfResolveInFlight = false;
let pdfResolveQueued = false;
let pdfSelectionPollTimer = null;
let pdfEmptyBubbleTimer = null;

function positionBubbleWithinViewport(bubble, anchorX, anchorTop, anchorBottom) {
  if (!bubble) {
    return;
  }

  const margin = 12;
  bubble.classList.remove("ccs-selection-bubble--below");
  bubble.classList.add("ccs-selection-bubble--above");
  bubble.style.visibility = "hidden";
  bubble.style.left = "0px";
  bubble.style.top = "0px";

  const rect = bubble.getBoundingClientRect();
  const bubbleWidth = Math.max(rect.width, 120);
  const bubbleHeight = Math.max(rect.height, 40);
  const halfWidth = bubbleWidth / 2;

  const left = Math.min(
    Math.max(anchorX, margin + halfWidth),
    Math.max(margin + halfWidth, window.innerWidth - margin - halfWidth)
  );

  const safeTop = Math.min(Math.max(anchorTop, margin), window.innerHeight - margin);
  const safeBottom = Math.min(Math.max(anchorBottom, margin), window.innerHeight - margin);
  const spaceAbove = safeTop - margin;
  const spaceBelow = window.innerHeight - safeBottom - margin;
  const placeBelow = spaceAbove < bubbleHeight && spaceBelow >= spaceAbove;

  bubble.classList.toggle("ccs-selection-bubble--below", placeBelow);
  bubble.classList.toggle("ccs-selection-bubble--above", !placeBelow);

  const top = placeBelow
    ? Math.min(safeBottom + 10, window.innerHeight - bubbleHeight - margin)
    : Math.max(safeTop - 10, bubbleHeight + margin);

  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.style.visibility = "";
}

function positionPdfBubble(bubble) {
  const left = lastPointerPosition.has
    ? Math.min(Math.max(lastPointerPosition.x, 16), window.innerWidth - 16)
    : Math.min(window.innerWidth - 24, Math.max(window.innerWidth / 2, 16));
  const top = lastPointerPosition.has
    ? Math.min(Math.max(lastPointerPosition.y, 24), window.innerHeight - 24)
    : Math.min(window.innerHeight - 24, Math.max(window.innerHeight / 2, 24));
  positionBubbleWithinViewport(bubble, left, top, top + 2);
}

function clearPdfEmptyBubbleTimer() {
  if (pdfEmptyBubbleTimer) {
    window.clearTimeout(pdfEmptyBubbleTimer);
    pdfEmptyBubbleTimer = null;
  }
}

function showPdfSelectionBubble(selectionText = "", options = {}) {
  const bubble = ensureSelectionBubble("default");
  const normalized = normalizeText(selectionText || "");
  bubble.dataset.selectionText = normalized;
  positionPdfBubble(bubble);
  clearPdfEmptyBubbleTimer();
  if (!normalized && options.ephemeral) {
    pdfEmptyBubbleTimer = window.setTimeout(() => {
      const currentBubble = document.getElementById(SELECTION_BUBBLE_ID);
      if (!currentBubble) {
        return;
      }
      const currentText = normalizeText(currentBubble.dataset.selectionText || "");
      if (!currentText) {
        hideSelectionBubble();
      }
    }, 1100);
  }
}

async function resolvePdfSelectionForBubble(options = {}) {
  if (!isPdfPage()) {
    return "";
  }

  if (pdfResolveInFlight) {
    pdfResolveQueued = true;
    return "";
  }

  pdfResolveInFlight = true;
  try {
    let text = normalizeText(window.getSelection()?.toString() || "");
    if (!text) {
      const response = await chrome.runtime.sendMessage({
        type: "RESOLVE_PDF_SELECTION",
        allowClipboardCopy: options.allowClipboardCopy === true
      });
      if (response?.ok) {
        text = normalizeText(response.selectedText || "");
      }
    }

    if (text) {
      showPdfSelectionBubble(text);
      return text;
    }

    if (options.allowEmptyBubble) {
      showPdfSelectionBubble("", { ephemeral: true });
      return "";
    }

    const bubble = document.getElementById(SELECTION_BUBBLE_ID);
    if (bubble && !normalizeText(bubble.dataset.selectionText || "")) {
      hideSelectionBubble();
    }
    return "";
  } catch (_error) {
    return "";
  } finally {
    pdfResolveInFlight = false;
    if (pdfResolveQueued) {
      pdfResolveQueued = false;
      void resolvePdfSelectionForBubble({ allowClipboardCopy: false, allowEmptyBubble: false });
    }
  }
}

function ensurePdfSelectionPoller() {
  if (!isPdfPage() || pdfSelectionPollTimer) {
    return;
  }
  pdfSelectionPollTimer = window.setInterval(() => {
    if (!isPdfPage()) {
      stopPdfSelectionPoller();
      return;
    }
    if (document.hidden) {
      return;
    }
    void resolvePdfSelectionForBubble({ allowClipboardCopy: false, allowEmptyBubble: false });
  }, 1400);
}

function stopPdfSelectionPoller() {
  if (!pdfSelectionPollTimer) {
    return;
  }
  window.clearInterval(pdfSelectionPollTimer);
  pdfSelectionPollTimer = null;
}

function isEditableFieldSelection(selection) {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    return end > start;
  }
  if (active instanceof HTMLInputElement) {
    const type = String(active.type || "").toLowerCase();
    const textLikeTypes = new Set([
      "text",
      "search",
      "url",
      "tel",
      "password",
      "email",
      "number"
    ]);
    if (textLikeTypes.has(type)) {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;
      return end > start;
    }
  }

  if (!selection) {
    return false;
  }

  let anchor = selection.anchorNode;
  if (anchor && anchor.nodeType === Node.TEXT_NODE) {
    anchor = anchor.parentElement;
  }
  if (!(anchor instanceof Element)) {
    return false;
  }

  return Boolean(anchor.closest("textarea, input, [contenteditable=''], [contenteditable='true'], [role='textbox']"));
}

function scheduleSelectionBubbleUpdate() {
  if (selectionBubbleTimer) {
    window.clearTimeout(selectionBubbleTimer);
  }

  selectionBubbleTimer = window.setTimeout(() => {
    void (async () => {
    if (isPdfPage()) {
      ensurePdfSelectionPoller();
      await resolvePdfSelectionForBubble({ allowClipboardCopy: false, allowEmptyBubble: false });
      return;
    }

    stopPdfSelectionPoller();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      hideSelectionBubble();
      return;
    }

    if (isEditableFieldSelection(selection)) {
      hideSelectionBubble();
      return;
    }

    let anchor = selection.anchorNode;
    if (anchor && anchor.nodeType === Node.TEXT_NODE) {
      anchor = anchor.parentElement;
    }
    if (anchor instanceof HTMLElement) {
      const inOverlay = anchor.closest(`#${COMMENT_OVERLAY_ID}`);
      const inNotes = anchor.closest(`#${NOTES_PANEL_ID}`);
      if (inOverlay || inNotes) {
        hideSelectionBubble();
        return;
      }
    }
    const text = normalizeText(selection.toString() || "");
    if (!text) {
      hideSelectionBubble();
      return;
    }
    if (!selection.rangeCount) {
      hideSelectionBubble();
      return;
    }

    const range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      const rects = range.getClientRects();
      if (rects.length) {
        rect = rects[0];
      }
    }
    if (!rect || (!rect.width && !rect.height)) {
      hideSelectionBubble();
      return;
    }

    const bubbleMode = isYouTubePage() ? "youtube" : "default";
    const bubble = ensureSelectionBubble(bubbleMode);
    bubble.dataset.selectionText = text;
    const anchorX = Math.min(Math.max(rect.left + rect.width / 2, 16), window.innerWidth - 16);
    const anchorTop = Math.max(rect.top, 8);
    const anchorBottom = Math.min(rect.bottom, window.innerHeight - 8);
    positionBubbleWithinViewport(bubble, anchorX, anchorTop, anchorBottom);
    })();
  }, 80);
}

function requestComment() {
  return new Promise((resolve) => {
    const existing = document.getElementById(COMMENT_OVERLAY_ID);
    if (existing) {
      existing.remove();
    }

    ensureCommentStyles();

    const overlay = document.createElement("div");
    overlay.id = COMMENT_OVERLAY_ID;
    overlay.className = "ccs-comment-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = "ccs-comment-panel";

    const heading = document.createElement("h2");
    heading.textContent = "Add a note";

    const hint = document.createElement("p");
    hint.textContent = "Your note will be saved alongside this capture.";

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Optional note about this content";

    const actions = document.createElement("div");
    actions.className = "ccs-comment-actions";

    const cancelButton = document.createElement("button");
    cancelButton.className = "ghost";
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";

    const saveButton = document.createElement("button");
    saveButton.className = "primary";
    saveButton.type = "button";
    saveButton.textContent = "Save";

    actions.append(cancelButton, saveButton);
    panel.append(heading, hint, textarea, actions);
    overlay.append(panel);
    document.body?.appendChild(overlay);

    const cleanup = (value) => {
      overlay.remove();
      resolve(value);
    };

    cancelButton.addEventListener("click", () => cleanup(null));
    saveButton.addEventListener("click", () => cleanup(textarea.value.trim()));
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(null);
      }

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        cleanup(textarea.value.trim());
      }
    });

    textarea.focus();
  });
}

function captureSelection() {
  const selection = normalizeText(window.getSelection()?.toString() || "");
  const page = getPageMetadata();
  const isPdf = isPdfPage();
  return {
    ok: true,
    type: "selected_text",
    isPdf,
    selectedText: selection,
    documentText: isPdf ? null : getDocumentText(selection),
    source: {
      ...page,
      metadata: {
        ...page.metadata,
        selectionLength: selection.length
      }
    },
    diagnostics: {
      missingFields: page.publishedAt ? [] : ["publishedAt"]
    }
  };
}

document.addEventListener("selectionchange", scheduleSelectionBubbleUpdate);
async function handleSelectionPointerEvent(event) {
  lastPointerPosition.x = event.clientX;
  lastPointerPosition.y = event.clientY;
  lastPointerPosition.has = true;
  if (isPdfPage()) {
    ensurePdfSelectionPoller();
    await resolvePdfSelectionForBubble({ allowClipboardCopy: false, allowEmptyBubble: true });
    return;
  }
  scheduleSelectionBubbleUpdate();
}

document.addEventListener("mouseup", handleSelectionPointerEvent);
window.addEventListener("mouseup", handleSelectionPointerEvent, true);
document.addEventListener("pointerup", handleSelectionPointerEvent, true);
window.addEventListener("pointerup", handleSelectionPointerEvent, true);
document.addEventListener("keyup", scheduleSelectionBubbleUpdate);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hideSelectionBubble();
    return;
  }
  if (isPdfPage()) {
    ensurePdfSelectionPoller();
    void resolvePdfSelectionForBubble({ allowClipboardCopy: false, allowEmptyBubble: false });
  }
});
window.addEventListener(
  "scroll",
  () => {
    hideSelectionBubble();
  },
  true
);

if (isPdfPage()) {
  ensurePdfSelectionPoller();
}

function getYouTubeVideoId() {
  return parseYouTubeVideoId(window.location.href);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizeTimestamp(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function transcriptSegmentKey(segment) {
  return `${segment.timestamp || ""}\u241f${segment.text}`;
}

function collapseRepeatedTranscriptSequence(segments) {
  if (!Array.isArray(segments) || segments.length < 2) {
    return Array.isArray(segments) ? segments : [];
  }

  const keys = segments.map(transcriptSegmentKey);
  const length = keys.length;
  const candidateRepeats = [2, 3, 4];

  for (const repeat of candidateRepeats) {
    if (length % repeat !== 0) {
      continue;
    }
    const chunkLength = length / repeat;
    let repeated = true;
    for (let i = chunkLength; i < length; i += 1) {
      if (keys[i] !== keys[i % chunkLength]) {
        repeated = false;
        break;
      }
    }
    if (repeated) {
      return segments.slice(0, chunkLength);
    }
  }

  return segments;
}

function normalizeTranscriptSegments(rawSegments) {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return [];
  }

  const normalized = rawSegments
    .map((segment) => {
      const text = normalizeText(segment?.text || "");
      if (!text) {
        return null;
      }
      return {
        timestamp: normalizeTimestamp(segment?.timestamp),
        text
      };
    })
    .filter(Boolean);

  const adjacentDeduped = [];
  let previousKey = null;
  for (const segment of normalized) {
    const key = transcriptSegmentKey(segment);
    if (key === previousKey) {
      continue;
    }
    adjacentDeduped.push(segment);
    previousKey = key;
  }

  return collapseRepeatedTranscriptSequence(adjacentDeduped);
}

function transcriptTextFromSegments(segments) {
  return segments.map((segment) => segment.text).join("\n");
}

function extractBalancedJson(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaping = false;
  let start = -1;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function findJsonInText(text, marker) {
  let idx = text.indexOf(marker);
  while (idx !== -1) {
    const start = text.indexOf("{", idx);
    if (start === -1) {
      return null;
    }
    const jsonText = extractBalancedJson(text, start);
    if (!jsonText) {
      return null;
    }
    try {
      return JSON.parse(jsonText);
    } catch (_error) {
      idx = text.indexOf(marker, idx + marker.length);
    }
  }
  return null;
}

function findPlayerResponseInScripts() {
  const scripts = Array.from(document.scripts || []);
  for (const script of scripts) {
    const text = script.textContent || "";
    if (!text.includes("ytInitialPlayerResponse")) {
      continue;
    }
    const parsed = findJsonInText(text, "ytInitialPlayerResponse");
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

async function fetchPlayerResponseFromHtml() {
  try {
    const response = await fetch(window.location.href, { credentials: "include" });
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    return findJsonInText(text, "ytInitialPlayerResponse");
  } catch (_error) {
    return null;
  }
}

async function getPlayerResponseFromMainWorld() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_YT_PLAYER_RESPONSE" });
    if (response?.ok && response.playerResponse) {
      return response.playerResponse;
    }
  } catch (_error) {
    return null;
  }
  return null;
}

async function getPlayerResponse() {
  const fromMain = await getPlayerResponseFromMainWorld();
  if (fromMain) {
    return fromMain;
  }

  const fromScripts = findPlayerResponseInScripts();
  if (fromScripts) {
    return fromScripts;
  }
  return fetchPlayerResponseFromHtml();
}

function getCaptionTracks(playerResponse) {
  const captions =
    playerResponse?.captions?.playerCaptionsTracklistRenderer ||
    playerResponse?.captions?.playerCaptionsRenderer ||
    playerResponse?.playerCaptionsTracklistRenderer ||
    playerResponse?.playerCaptionsRenderer ||
    null;
  return captions?.captionTracks || null;
}

function isAutoGeneratedTrack(track) {
  if (!track) {
    return false;
  }
  if (track.kind === "asr") {
    return true;
  }
  const label = track.name?.simpleText || track.name?.runs?.map((run) => run?.text).join("") || "";
  return /auto-generated|auto generated|automatically/i.test(label);
}

function buildPreferredLanguages() {
  const preferred = [];
  const add = (value) => {
    const normalized = String(value || "").replace("_", "-").trim();
    if (!normalized) {
      return;
    }
    const lower = normalized.toLowerCase();
    if (!preferred.includes(lower)) {
      preferred.push(lower);
    }
    const base = lower.split("-")[0];
    if (base && !preferred.includes(base)) {
      preferred.push(base);
    }
  };

  add("en-US");
  add("en");
  const navLang = navigator.language || "";
  add(navLang);
  if (Array.isArray(navigator.languages)) {
    navigator.languages.forEach(add);
  }

  return preferred;
}

function pickCaptionTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  const preferred = buildPreferredLanguages();
  for (const lang of preferred) {
    const exact = tracks.find(
      (track) =>
        track.languageCode?.toLowerCase().startsWith(lang) && !isAutoGeneratedTrack(track)
    );
    if (exact) {
      return exact;
    }
  }
  for (const lang of preferred) {
    const fallback = tracks.find((track) => track.languageCode?.toLowerCase().startsWith(lang));
    if (fallback) {
      return fallback;
    }
  }

  const nonAuto = tracks.find((track) => !isAutoGeneratedTrack(track));
  return nonAuto || tracks[0];
}

async function fetchTimedTextTracks(videoId) {
  if (!videoId) {
    return null;
  }
  try {
    const url = `https://www.youtube.com/api/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
    let text = null;
    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) {
        text = await response.text();
      }
    } catch (_error) {
      text = null;
    }
    if (!text) {
      const fallback = await chrome.runtime.sendMessage({ type: "YT_FETCH_TEXT", url });
      if (fallback?.ok) {
        text = fallback.text;
      }
    }
    if (!text) {
      return null;
    }
    if (!text || !text.includes("<track")) {
      return null;
    }
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const tracks = Array.from(doc.querySelectorAll("track")).map((track) => ({
      lang: track.getAttribute("lang_code"),
      kind: track.getAttribute("kind"),
      name: track.getAttribute("name"),
      langOriginal: track.getAttribute("lang_original"),
      langTranslated: track.getAttribute("lang_translated")
    }));
    return tracks.filter((track) => track.lang);
  } catch (_error) {
    return null;
  }
}

function pickTimedTextTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  const preferred = buildPreferredLanguages();
  for (const lang of preferred) {
    const exact = tracks.find(
      (track) => track.lang?.toLowerCase().startsWith(lang) && track.kind !== "asr"
    );
    if (exact) {
      return exact;
    }
  }
  for (const lang of preferred) {
    const fallback = tracks.find((track) => track.lang?.toLowerCase().startsWith(lang));
    if (fallback) {
      return fallback;
    }
  }

  const nonAuto = tracks.find((track) => track.kind !== "asr");
  return nonAuto || tracks[0];
}

async function fetchTranscriptViaTimedText(videoId) {
  const tracks = await fetchTimedTextTracks(videoId);
  const track = pickTimedTextTrack(tracks);
  if (!track?.lang) {
    return null;
  }

  const params = new URLSearchParams({
    v: videoId,
    lang: track.lang,
    fmt: "json3"
  });
  if (track.kind) {
    params.set("kind", track.kind);
  }

  try {
    const url = `https://www.youtube.com/api/timedtext?${params.toString()}`;
    let data = null;
    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) {
        data = await response.json();
      }
    } catch (_error) {
      data = null;
    }
    if (!data) {
      const fallback = await chrome.runtime.sendMessage({ type: "YT_FETCH_JSON", url });
      if (fallback?.ok) {
        data = fallback.json;
      }
    }
    if (!data) {
      return null;
    }
    const events = Array.isArray(data?.events) ? data.events : [];
    const segments = normalizeTranscriptSegments(
      events
      .map((event) => {
        const text = normalizeText(
          (event?.segs || []).map((seg) => seg?.utf8 || "").join("")
        );
        if (!text) {
          return null;
        }
        return {
          timestamp: formatTimestamp(Number(event?.tStartMs || 0)),
          text
        };
      })
      .filter(Boolean)
    );

    if (!segments.length) {
      return null;
    }

    return {
      segments,
      transcriptText: transcriptTextFromSegments(segments),
      track
    };
  } catch (_error) {
    return null;
  }
}

async function fetchTranscriptFromTrack(track) {
  if (!track?.baseUrl) {
    return null;
  }
  let url = track.baseUrl;
  if (!/[?&]fmt=/.test(url)) {
    url += `${url.includes("?") ? "&" : "?"}fmt=json3`;
  }

  try {
    let data = null;
    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) {
        data = await response.json();
      }
    } catch (_error) {
      data = null;
    }
    if (!data) {
      const fallback = await chrome.runtime.sendMessage({ type: "YT_FETCH_JSON", url });
      if (fallback?.ok) {
        data = fallback.json;
      }
    }
    if (!data) {
      return null;
    }
    const events = Array.isArray(data?.events) ? data.events : [];
    const segments = normalizeTranscriptSegments(
      events
      .map((event) => {
        const text = normalizeText(
          (event?.segs || []).map((seg) => seg?.utf8 || "").join("")
        );
        if (!text) {
          return null;
        }
        return {
          timestamp: formatTimestamp(Number(event?.tStartMs || 0)),
          text
        };
      })
      .filter(Boolean)
    );

    if (!segments.length) {
      return null;
    }

    return {
      segments,
      transcriptText: transcriptTextFromSegments(segments)
    };
  } catch (_error) {
    return null;
  }
}

async function fetchTranscriptViaApi() {
  const playerResponse = await getPlayerResponse();
  if (playerResponse) {
    const tracks = getCaptionTracks(playerResponse);
    const track = pickCaptionTrack(tracks);
    if (track) {
      const transcript = await fetchTranscriptFromTrack(track);
      if (transcript) {
        return {
          ...transcript,
          track,
          source: "api"
        };
      }
    }
  }

  return null;
}

const YT_TRANSCRIPT_PANEL_TARGET_ID = "engagement-panel-searchable-transcript";

function getTranscriptRows() {
  const scopedPanels = Array.from(
    document.querySelectorAll(
      `ytd-engagement-panel-section-list-renderer[target-id="${YT_TRANSCRIPT_PANEL_TARGET_ID}"], ` +
        `ytd-engagement-panel-section-list-renderer[panel-identifier="${YT_TRANSCRIPT_PANEL_TARGET_ID}"]`
    )
  );

  const scopedRows = scopedPanels.flatMap((panel) =>
    Array.from(panel.querySelectorAll("ytd-transcript-segment-renderer"))
  );
  if (scopedRows.length > 0) {
    return scopedRows;
  }

  return Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));
}

async function waitForTranscriptRows(maxAttempts = 24, delayMs = 250) {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (getTranscriptRows().length > 0) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

function hasTranscriptKeyword(text) {
  const value = String(text || "").toLowerCase();
  return /(transcript|transkrips|transkrip|caption|subtit|untertitel|sous-?titres)/i.test(value);
}

function deepFindInObject(root, predicate) {
  if (!root || typeof root !== "object") {
    return null;
  }

  const stack = [root];
  const seen = new WeakSet();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (predicate(current)) {
      return current;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    for (const key of Object.keys(current)) {
      stack.push(current[key]);
    }
  }

  return null;
}

function hasTranscriptCommandData(element) {
  if (!element) {
    return false;
  }
  const anyElement = /** @type {any} */ (element);
  const roots = [
    anyElement.data,
    anyElement.__data,
    anyElement.__dataHost?.data,
    anyElement.__dataHost?.__data
  ];

  for (const root of roots) {
    const found = deepFindInObject(
      root,
      (node) =>
        node?.changeEngagementPanelVisibilityAction?.targetId === YT_TRANSCRIPT_PANEL_TARGET_ID ||
        typeof node?.getTranscriptEndpoint?.params === "string"
    );
    if (found) {
      return true;
    }
  }

  return false;
}

function executeYouTubeCommand(command) {
  if (!command || typeof command !== "object") {
    return false;
  }

  const targets = [
    document.querySelector("ytd-watch-flexy"),
    document.querySelector("ytd-app"),
    document.querySelector("ytd-page-manager")
  ];

  for (const target of targets) {
    const anyTarget = /** @type {any} */ (target);
    if (!anyTarget) {
      continue;
    }
    try {
      if (typeof anyTarget.resolveCommand === "function") {
        anyTarget.resolveCommand(command);
        return true;
      }
      if (typeof anyTarget.handleCommand === "function") {
        anyTarget.handleCommand(command);
        return true;
      }
    } catch (_error) {
      continue;
    }
  }

  return false;
}

function findInitialDataInScripts() {
  const scripts = Array.from(document.scripts || []);
  for (const script of scripts) {
    const text = script.textContent || "";
    if (!text.includes("ytInitialData")) {
      continue;
    }
    const parsed = findJsonInText(text, "ytInitialData");
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function findYtcfgInScripts() {
  const scripts = Array.from(document.scripts || []);
  for (const script of scripts) {
    const text = script.textContent || "";
    if (!text.includes("ytcfg.set(")) {
      continue;
    }
    const parsed = findJsonInText(text, "ytcfg.set");
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function findTranscriptInnertubeCommand(initialData) {
  return deepFindInObject(
    initialData,
    (node) =>
      typeof node?.getTranscriptEndpoint?.params === "string" &&
      node?.commandMetadata?.webCommandMetadata?.apiUrl === "/youtubei/v1/get_transcript"
  );
}

function parseTranscriptSegmentsFromInnerTubePayload(payload) {
  const segments = [];
  const stack = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }

    const renderer = current.transcriptSegmentRenderer;
    if (renderer) {
      const text = normalizeText((renderer.snippet?.runs || []).map((run) => run?.text || "").join(""));
      if (text) {
        const timestamp =
          renderer.startTimeText?.simpleText ||
          (renderer.startTimeText?.runs || []).map((run) => run?.text || "").join("").trim() ||
          null;
        segments.push({ timestamp, text });
      }
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    for (const key of Object.keys(current)) {
      stack.push(current[key]);
    }
  }

  return normalizeTranscriptSegments(segments);
}

async function fetchTranscriptViaInnertube() {
  const initialData = findInitialDataInScripts();
  const command = findTranscriptInnertubeCommand(initialData);
  const params = command?.getTranscriptEndpoint?.params || null;
  if (!params) {
    return null;
  }

  const ytcfg = findYtcfgInScripts() || {};
  const apiKey = ytcfg.INNERTUBE_API_KEY || null;
  if (!apiKey) {
    return null;
  }

  const context =
    ytcfg.INNERTUBE_CONTEXT || {
      client: {
        clientName: "WEB",
        clientVersion: ytcfg.INNERTUBE_CLIENT_VERSION || null,
        hl: document.documentElement.lang || "en"
      }
    };

  const headers = {
    "content-type": "application/json"
  };

  if (ytcfg.INNERTUBE_CONTEXT_CLIENT_NAME) {
    headers["x-youtube-client-name"] = String(ytcfg.INNERTUBE_CONTEXT_CLIENT_NAME);
  }
  if (ytcfg.INNERTUBE_CONTEXT_CLIENT_VERSION) {
    headers["x-youtube-client-version"] = String(ytcfg.INNERTUBE_CONTEXT_CLIENT_VERSION);
  }
  if (ytcfg.VISITOR_DATA || context?.client?.visitorData) {
    headers["x-goog-visitor-id"] = String(ytcfg.VISITOR_DATA || context.client.visitorData);
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false&key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ context, params })
      }
    );
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const segments = parseTranscriptSegmentsFromInnerTubePayload(payload);
    if (!segments.length) {
      return null;
    }
    return {
      segments,
      transcriptText: transcriptTextFromSegments(segments),
      source: "innertube"
    };
  } catch (_error) {
    return null;
  }
}

async function tryOpenTranscriptPanel() {
  if (getTranscriptRows().length > 0) {
    return true;
  }

  const openCommand = {
    changeEngagementPanelVisibilityAction: {
      targetId: YT_TRANSCRIPT_PANEL_TARGET_ID,
      visibility: "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"
    }
  };
  if (executeYouTubeCommand(openCommand) && (await waitForTranscriptRows(24, 250))) {
    return true;
  }

  const directTranscriptButton = Array.from(
    document.querySelectorAll(
      'button, tp-yt-paper-item, ytd-button-renderer, ytd-menu-service-item-renderer'
    )
  ).find((el) => hasTranscriptKeyword(el.textContent || "") || hasTranscriptCommandData(el));

  if (directTranscriptButton) {
    /** @type {HTMLElement} */ (directTranscriptButton).click();
    if (await waitForTranscriptRows(24, 250)) {
      return true;
    }
  }

  /** @type {HTMLElement|null} */
  const menuButton =
    document.querySelector('ytd-menu-renderer button[aria-label*="More actions" i]') ||
    document.querySelector('button[aria-label*="more actions" i]') ||
    document.querySelector("ytd-menu-renderer button");

  if (!menuButton) {
    const initialData = findInitialDataInScripts();
    const command = findTranscriptInnertubeCommand(initialData);
    if (command && executeYouTubeCommand(command) && (await waitForTranscriptRows(24, 250))) {
      return true;
    }
    return false;
  }

  menuButton.click();
  await sleep(250);

  const menuItems = Array.from(
    document.querySelectorAll("tp-yt-paper-item, ytd-menu-service-item-renderer")
  );
  const transcriptItem = menuItems.find(
    (item) => hasTranscriptKeyword(item.textContent || "") || hasTranscriptCommandData(item)
  );

  if (!transcriptItem) {
    /** @type {HTMLElement|null} */
    const dismiss = document.querySelector("tp-yt-iron-dropdown[opened] tp-yt-paper-item");
    dismiss?.click();
  } else {
    /** @type {HTMLElement} */ (transcriptItem).click();
    if (await waitForTranscriptRows(24, 250)) {
      return true;
    }
  }

  const initialData = findInitialDataInScripts();
  const command = findTranscriptInnertubeCommand(initialData);
  if (command && executeYouTubeCommand(command) && (await waitForTranscriptRows(24, 250))) {
      return true;
  }

  return false;
}

function extractTranscriptSegments() {
  const rows = getTranscriptRows();
  const rawSegments = rows
    .map((row) => {
      const timestamp =
        row.querySelector(".segment-timestamp")?.textContent?.trim() ||
        row.querySelector("#segment-timestamp")?.textContent?.trim() ||
        row.querySelector("yt-formatted-string.segment-timestamp")?.textContent?.trim() ||
        null;

      const text =
        row.querySelector(".segment-text")?.textContent?.trim() ||
        row.querySelector("#segment-text")?.textContent?.trim() ||
        row.querySelector("yt-formatted-string.segment-text")?.textContent?.trim() ||
        null;

      if (!text) {
        return null;
      }

      return { timestamp, text };
    })
    .filter(Boolean);

  return normalizeTranscriptSegments(rawSegments);
}

async function captureYouTubeTranscript() {
  const page = getPageMetadata();
  const videoId = getYouTubeVideoId();

  if (!videoId) {
    const missingFields = [];
    if (!page.publishedAt) {
      missingFields.push("publishedAt");
    }
    missingFields.push("transcript");

    return {
      ok: true,
      type: "youtube_transcript",
      selectedText: null,
      documentText: "",
      transcriptText: null,
      transcriptSegments: [],
      source: {
        ...page,
        metadata: {
          ...page.metadata,
          videoId: null,
          transcriptStatus: "transcript_unavailable",
          transcriptSource: "dom",
          transcriptLanguage: null,
          transcriptIsAutoGenerated: null
        }
      },
      diagnostics: {
        missingFields,
        transcriptOpenedByExtension: false,
        transcriptSource: "dom",
        reason: "No YouTube video context found in this frame."
      }
    };
  }

  const opened = await tryOpenTranscriptPanel();
  let segments = extractTranscriptSegments();
  let transcriptText = transcriptTextFromSegments(segments);
  let transcriptSource = "dom";
  let transcriptTrack = null;
  const transcriptDebug = {
    domRowsInitialRaw: getTranscriptRows().length,
    domRowsInitial: segments.length,
    transcriptOpenedByExtension: opened,
    apiAttempted: false,
    apiSucceeded: false,
    innertubeAttempted: false,
    innertubeSucceeded: false,
    timedtextAttempted: false,
    timedtextSucceeded: false
  };

  if (segments.length === 0) {
    transcriptDebug.apiAttempted = true;
    const apiResult = await fetchTranscriptViaApi();
    if (apiResult) {
      segments = apiResult.segments;
      transcriptText = apiResult.transcriptText;
      transcriptSource = apiResult.source || "api";
      transcriptTrack = apiResult.track;
      transcriptDebug.apiSucceeded = true;
    } else {
      transcriptDebug.innertubeAttempted = true;
      const innertubeResult = await fetchTranscriptViaInnertube();
      if (innertubeResult) {
        segments = innertubeResult.segments;
        transcriptText = innertubeResult.transcriptText;
        transcriptSource = "innertube";
        transcriptDebug.innertubeSucceeded = true;
      } else if (videoId) {
        transcriptDebug.timedtextAttempted = true;
        const timedTextResult = await fetchTranscriptViaTimedText(videoId);
        if (timedTextResult) {
          segments = timedTextResult.segments;
          transcriptText = timedTextResult.transcriptText;
          transcriptSource = "timedtext";
          transcriptTrack = timedTextResult.track;
          transcriptDebug.timedtextSucceeded = true;
        } else {
          transcriptSource = "timedtext";
        }
      }
    }
  }

  const transcriptUnavailable = segments.length === 0;
  transcriptDebug.finalSegmentCount = segments.length;
  transcriptDebug.finalDocumentTextLength = transcriptText.length;
  const missingFields = [];
  if (!page.publishedAt) {
    missingFields.push("publishedAt");
  }
  if (transcriptUnavailable) {
    missingFields.push("transcript");
  }

  return {
    ok: true,
    type: "youtube_transcript",
    selectedText: null,
    documentText: transcriptText || "",
    transcriptText: transcriptText || null,
    transcriptSegments: segments,
    source: {
      ...page,
      metadata: {
        ...page.metadata,
        videoId,
        transcriptStatus: transcriptUnavailable ? "transcript_unavailable" : "transcript_available",
        transcriptSource,
        transcriptLanguage: transcriptTrack?.languageCode || transcriptTrack?.lang || null,
        transcriptIsAutoGenerated: transcriptTrack ? isAutoGeneratedTrack(transcriptTrack) : null
      }
    },
    diagnostics: {
      missingFields,
      transcriptOpenedByExtension: opened,
      transcriptSource,
      transcriptDebug,
      reason: transcriptUnavailable
        ? "Transcript panel unavailable or no transcript rows found."
        : null
    }
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_SELECTION") {
    sendResponse(captureSelection());
    return;
  }

  if (message?.type === "CAPTURE_SELECTION_WITH_COMMENT") {
    const snapshot = captureSelection();
    requestComment()
      .then((comment) => {
        if (comment === null) {
          sendResponse({ ok: false, error: "Comment cancelled" });
          return;
        }

        sendResponse({
          ...snapshot,
          comment
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "Failed to capture note"
        });
      });
    return true;
  }

  if (message?.type === "CAPTURE_YOUTUBE_TRANSCRIPT") {
    captureYouTubeTranscript()
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "Failed to capture YouTube transcript"
        });
      });
    return true;
  }

  if (message?.type === "CAPTURE_YOUTUBE_TRANSCRIPT_WITH_COMMENT") {
    requestComment()
      .then((comment) => {
        if (comment === null) {
          sendResponse({ ok: false, error: "Comment cancelled" });
          return;
        }

        return captureYouTubeTranscript().then((result) => {
          sendResponse({
            ...result,
            comment
          });
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "Failed to capture transcript"
        });
      });
    return true;
  }

  if (message?.type === "SHOW_SAVE_TOAST") {
    showSaveToast(message.payload || {});
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "SHOW_PROGRESS_TOAST") {
    showProgressToast(message.payload || {});
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "SHOW_ERROR_TOAST") {
    showErrorToast(message.payload?.message || "Capture failed");
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "SHOW_INFO_TOAST") {
    showInfoToast(message.payload || {});
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "NOTES_UPDATED") {
    if (isYouTubePage()) {
      clearNotesPanel();
      sendResponse({ ok: true });
      return;
    }
    syncPendingAnnotations(Array.isArray(message.payload?.annotations) ? message.payload.annotations : []);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "CLEAR_PENDING_NOTES") {
    clearNotesPanel();
    sendResponse({ ok: true });
    return;
  }

  sendResponse({ ok: false, error: "Unknown message type" });
});

hydratePendingNotes().catch(() => undefined);
