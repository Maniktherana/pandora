/** Map file extension → Monaco language ID. */
const EXT_LANG: Record<string, string> = {
  // TypeScript / JavaScript
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",

  // Web
  html: "html",
  htm: "html",
  vue: "html",
  svelte: "html",
  css: "css",
  scss: "scss",
  less: "less",
  pug: "pug",
  hbs: "handlebars",
  handlebars: "handlebars",
  liquid: "liquid",
  razor: "razor",

  // Data / Config
  json: "json",
  jsonc: "json",
  json5: "json",
  geojson: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "ini",
  env: "ini",
  xml: "xml",
  svg: "xml",
  xsl: "xml",
  xslt: "xml",
  plist: "xml",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  hcl: "hcl",
  tf: "hcl",
  tfvars: "hcl",
  bicep: "bicep",

  // Markdown / Docs
  md: "markdown",
  mdx: "mdx",
  rst: "restructuredtext",
  tex: "latex",
  latex: "latex",

  // Systems
  rs: "rust",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  m: "objective-c",
  mm: "objective-c",
  cs: "csharp",
  csx: "csharp",
  fs: "fsharp",
  fsx: "fsharp",
  fsi: "fsharp",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  sc: "scala",
  swift: "swift",
  dart: "dart",
  vb: "vb",

  // Scripting
  py: "python",
  pyw: "python",
  pyi: "python",
  rb: "ruby",
  rake: "ruby",
  gemspec: "ruby",
  pl: "perl",
  pm: "perl",
  php: "php",
  phtml: "php",
  lua: "lua",
  r: "r",
  R: "r",
  jl: "julia",
  ex: "elixir",
  exs: "elixir",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  edn: "clojure",
  coffee: "coffee",
  scm: "scheme",
  rkt: "scheme",
  tcl: "tcl",

  // Shell
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  bat: "bat",
  cmd: "bat",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",

  // Database
  sql: "sql",
  mysql: "mysql",
  pgsql: "pgsql",

  // HDL / Low-level
  sv: "systemverilog",
  svh: "systemverilog",
  v: "systemverilog",
  wgsl: "wgsl",

  // Solidity / Blockchain
  sol: "solidity",

  // Pascal
  pas: "pascal",
  pp: "pascal",

  // ABAP
  abap: "abap",

  // Misc
  dockerfile: "dockerfile",
  twig: "twig",
};

/** Map special filenames → Monaco language ID. */
const FILENAME_LANG: Record<string, string> = {
  dockerfile: "dockerfile",
  "docker-compose.yml": "yaml",
  "docker-compose.yaml": "yaml",
  makefile: "shell",
  rakefile: "ruby",
  gemfile: "ruby",
  vagrantfile: "ruby",
  cmakelists: "cmake",
  ".gitignore": "ini",
  ".gitattributes": "ini",
  ".editorconfig": "ini",
  ".env": "ini",
  ".env.local": "ini",
  ".env.development": "ini",
  ".env.production": "ini",
  ".npmrc": "ini",
  ".eslintrc": "json",
  ".prettierrc": "json",
  ".babelrc": "json",
  "tsconfig.json": "json",
  "package.json": "json",
  "composer.json": "json",
  "cargo.toml": "ini",
};

export function languageFromRelativePath(relativePath: string): string {
  const base = (relativePath.split("/").pop() ?? "").toLowerCase();

  // Check exact filename match first
  const byName = FILENAME_LANG[base];
  if (byName) return byName;

  // Check .env* pattern
  if (base.startsWith(".env")) return "ini";

  // Check extension
  const dot = base.lastIndexOf(".");
  if (dot >= 0) {
    const ext = base.slice(dot + 1);
    const byExt = EXT_LANG[ext];
    if (byExt) return byExt;
  }

  return "plaintext";
}
