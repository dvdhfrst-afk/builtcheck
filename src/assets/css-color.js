// Whether a string is a CSS color, as a web app manifest's theme_color and background_color must
// be. A browser ignores an invalid one and falls back to its own default, without a word.

const NAMED = new Set(`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred
darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray
green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen
lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen
linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy
oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip
peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal
thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor
accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext
graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext`.split(/\s+/));

const COMPONENT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:%|deg|grad|rad|turn)?$|^none$/i;
const COLOR_SPACES = new Set(["srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz", "xyz-d50", "xyz-d65"]);
const COMPONENT_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch"]);

// Three components and an optional alpha, separated by commas or spaces, alpha after a slash.
function hasComponents(parts) {
  return (parts.length === 3 || parts.length === 4) && parts.every((part) => COMPONENT.test(part));
}

export function isCssColor(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return true;
  if (NAMED.has(text.toLowerCase())) return true;
  const call = /^([a-z-]+)\((.*)\)$/is.exec(text);
  if (!call) return false;
  const name = call[1].toLowerCase();
  const inner = call[2].trim();
  let depth = 0;
  for (const ch of inner) {
    depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (depth < 0) return false;
  }
  if (depth !== 0 || inner === "") return false;
  // Relative colors, calc() and mixes take more than this reads. Trust them.
  if (/^from\s/i.test(inner) || inner.includes("(")) return COMPONENT_FUNCTIONS.has(name) || name === "color" || name === "color-mix" || name === "light-dark";
  if (name === "color-mix" || name === "light-dark") return true;
  const parts = inner.split(/\s*[\s,/]\s*/).filter(Boolean);
  if (name === "color") return COLOR_SPACES.has(parts[0]?.toLowerCase()) && hasComponents(parts.slice(1));
  return COMPONENT_FUNCTIONS.has(name) && hasComponents(parts);
}
