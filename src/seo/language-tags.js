// Checks language tags, as written in lang and hreflang attributes, against the BCP 47 syntax
// and against compact built-in lists: every ISO 639-1 two-letter language code, the ISO 3166-1
// region codes, and the three-letter codes that have a two-letter form, which are therefore not
// valid tags. Other three-letter languages are accepted: the full ISO 639-3 list has thousands of
// entries, and a rare language reported as a typo would be a false alarm.

const LANGUAGES = new Set((
  "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy " +
  "da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu " +
  "hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb " +
  "lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om " +
  "or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg sh si sk sl sm sn so sq sr ss st su sv " +
  "sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu"
).split(" "));

// ISO 3166-1 alpha-2, plus the codes the language subtag registry adds: the European Union,
// the United Nations, the exceptionally reserved codes, and old codes kept for existing content.
// Private use codes (AA, QM to QZ, XA to XZ, ZZ) are allowed by pattern below.
const REGIONS = new Set((
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR " +
  "BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ " +
  "EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW " +
  "GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY " +
  "KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV " +
  "MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY " +
  "QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG " +
  "TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM " +
  "ZW EU EZ UN AC CP DG EA IC TA AN BU CS DD FX NT SU TP YD YU ZR"
).split(" "));
const PRIVATE_REGION = /^(?:AA|Q[M-Z]|X[A-Z]|ZZ)$/;

// Two-letter codes that were withdrawn, and what replaced them.
const WITHDRAWN = { iw: "he", in: "id", ji: "yi", jw: "jv", mo: "ro" };

// Country codes, and one common misspelling, written where the language code belongs.
const COUNTRY_MISTAKES = {
  jp: "ja", cn: "zh", gr: "el", dk: "da", cz: "cs", ua: "uk", vn: "vi", us: "en", gb: "en",
  il: "he", ir: "fa", rs: "sr", by: "be", kz: "kk", ge: "ka", al: "sq", mx: "es", hk: "zh", sp: "es",
};

// Three-letter codes of languages that have a two-letter code. The registry holds only the
// two-letter form, so "eng" is not a valid tag.
const THREE_LETTER = Object.fromEntries((
  "eng:en fra:fr fre:fr deu:de ger:de spa:es ita:it por:pt nld:nl dut:nl rus:ru jpn:ja zho:zh " +
  "chi:zh kor:ko ara:ar hin:hi ben:bn tur:tr pol:pl ukr:uk ces:cs cze:cs slk:sk slo:sk swe:sv " +
  "nor:no dan:da fin:fi ell:el gre:el heb:he ind:id msa:ms may:ms tha:th vie:vi fas:fa per:fa " +
  "ron:ro rum:ro hun:hu bul:bg hrv:hr srp:sr slv:sl cat:ca eus:eu baq:eu glg:gl isl:is ice:is " +
  "gle:ga cym:cy wel:cy est:et lav:lv lit:lt urd:ur tam:ta tel:te mar:mr guj:gu kan:kn mal:ml " +
  "pan:pa swa:sw afr:af zul:zu xho:xh amh:am sqi:sq alb:sq hye:hy arm:hy kat:ka geo:ka aze:az " +
  "kaz:kk uzb:uz mkd:mk mac:mk bel:be mon:mn nep:ne sin:si khm:km lao:lo mya:my bur:my tgl:tl " +
  "epo:eo lat:la"
).split(" ").map((pair) => pair.split(":")));

// Tags from before the current syntax, kept valid by the standard.
const GRANDFATHERED = new Set([
  "i-ami", "i-bnn", "i-default", "i-enochian", "i-hak", "i-klingon", "i-lux", "i-mingo",
  "i-navajo", "i-pwn", "i-tao", "i-tay", "i-tsu", "sgn-be-fr", "sgn-be-nl", "sgn-ch-de",
  "en-gb-oed", "art-lojban", "cel-gaulish", "no-bok", "no-nyn", "zh-guoyu", "zh-hakka",
  "zh-min", "zh-min-nan", "zh-xiang",
]);

// Languages that name the same thing for the purpose of matching a page to its hreflang: a
// macrolanguage and its main member, or two codes in common use for one language.
const SAME_LANGUAGE = [
  ["no", "nb", "nn"], ["tl", "fil"], ["zh", "cmn", "yue", "wuu", "nan", "hak"],
  ["ms", "zsm"], ["fa", "pes"], ["sw", "swh"], ["et", "ekk"], ["lv", "lvs"],
];

function invalid(reason) {
  return { ok: false, reason };
}

// The language a subtag stands for once three-letter aliases are folded in, for comparisons.
function canonicalLanguage(language) {
  return THREE_LETTER[language] ?? WITHDRAWN[language] ?? language;
}

export function sameLanguage(a, b) {
  const first = canonicalLanguage(a.toLowerCase());
  const second = canonicalLanguage(b.toLowerCase());
  if (first === second) return true;
  return SAME_LANGUAGE.some((group) => group.includes(first) && group.includes(second));
}

function checkLanguageSubtag(language, extra) {
  if (extra.has(language)) return null;
  if (language.length === 2) {
    if (WITHDRAWN[language]) return `"${language}" is a withdrawn code, now "${WITHDRAWN[language]}"`;
    if (LANGUAGES.has(language)) return null;
    if (COUNTRY_MISTAKES[language]) return `"${language}" is not a language code (did you mean "${COUNTRY_MISTAKES[language]}"?)`;
    if (REGIONS.has(language.toUpperCase())) return `"${language}" is a country code, not a language code`;
    return `"${language}" is not an ISO 639-1 language code`;
  }
  if (language.length === 3) {
    const short = THREE_LETTER[language];
    return short ? `"${language}" has a two-letter code, "${short}", which must be used instead` : null;
  }
  if (language.length === 4) return `a four-letter first part such as "${language}" is reserved and never valid`;
  return `"${language}" is not a registered language`;
}

function checkRegionSubtag(region) {
  if (/^[0-9]{3}$/.test(region)) return null;
  const upper = region.toUpperCase();
  if (upper === "UK") return 'the region "UK" is not a country code (the United Kingdom is "GB")';
  if (REGIONS.has(upper) || PRIVATE_REGION.test(upper)) return null;
  return `the region "${upper}" is not an ISO 3166-1 country code`;
}

// Result: { ok: true, language, script, region, privateUse } or { ok: false, reason }. The parts
// come back lower case. `extraLanguages` lists language subtags to accept beyond the lists.
export function checkLanguageTag(raw, extraLanguages = []) {
  const value = raw.trim();
  if (value === "") return invalid("it is empty");
  const extra = new Set(extraLanguages.map((language) => language.toLowerCase()));
  if (value.includes("_")) {
    const fixed = value.replace(/_/g, "-");
    const hint = checkLanguageTag(fixed, extraLanguages).ok ? ` (write "${fixed}")` : "";
    return invalid(`it uses an underscore where a hyphen belongs${hint}`);
  }
  if (!/^[A-Za-z0-9-]+$/.test(value)) return invalid("it holds characters a language tag cannot contain");
  const lower = value.toLowerCase();
  if (GRANDFATHERED.has(lower)) return { ok: true, language: lower.split("-")[0], script: null, region: null, privateUse: false };
  const parts = lower.split("-");
  if (parts.includes("")) return invalid("it has an empty part");
  const long = parts.find((part) => part.length > 8);
  if (long) return invalid(`the part "${long}" is longer than eight characters`);
  if (parts[0] === "x") {
    return parts.length > 1 ? { ok: true, language: null, script: null, region: null, privateUse: true } : invalid('"x" must be followed by a private use part');
  }
  const language = parts[0];
  if (!/^[a-z]{2,8}$/.test(language)) return invalid(`it must start with a language code, not "${language}"`);
  let i = 1;
  if (language.length <= 3) {
    // Extended language subtags, as in zh-yue.
    for (let count = 0; count < 3 && i < parts.length && /^[a-z]{3}$/.test(parts[i]); count += 1) i += 1;
  }
  let script = null;
  let region = null;
  if (i < parts.length && /^[a-z]{4}$/.test(parts[i])) script = parts[i++];
  if (i < parts.length && /^(?:[a-z]{2}|[0-9]{3})$/.test(parts[i])) region = parts[i++];
  while (i < parts.length && /^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/.test(parts[i])) i += 1;
  const singletons = new Set();
  while (i < parts.length && /^[0-9a-wy-z]$/.test(parts[i])) {
    if (singletons.has(parts[i])) return invalid(`the extension "${parts[i]}" appears twice`);
    singletons.add(parts[i]);
    const start = i + 1;
    i = start;
    while (i < parts.length && /^[a-z0-9]{2,8}$/.test(parts[i])) i += 1;
    if (i === start) return invalid(`the extension "${parts[start - 1]}" has nothing after it`);
  }
  if (i < parts.length && parts[i] === "x") {
    if (i + 1 === parts.length) return invalid('"x" must be followed by a private use part');
    i = parts.length;
  }
  if (i < parts.length) return invalid(`"${parts[i]}" is not a script, region or variant in that position`);

  const problem = checkLanguageSubtag(language, extra) ?? (region ? checkRegionSubtag(region) : null);
  if (problem) return invalid(problem);
  return { ok: true, language, script, region, privateUse: false };
}

// The same check for an hreflang value, which also allows "x-default" and nothing else private.
export function checkHreflang(raw, extraLanguages = []) {
  const value = raw.trim();
  if (value.toLowerCase() === "x-default") return { ok: true, xDefault: true, language: null };
  if (/^x[-_ ]?default$|^default$/i.test(value)) return invalid('it must be written "x-default"');
  const result = checkLanguageTag(value, extraLanguages);
  if (result.ok && result.privateUse) return invalid('private use tags are not recognized; the only special value is "x-default"');
  return result.ok ? { ...result, xDefault: false } : result;
}
