export function gitStatus(xy) {
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "U";
  if (xy.includes("D")) return "D";
  if (xy === "??" || xy.includes("A")) return "A";
  return xy.trim() ? "M" : null;
}

export function statusColor(status, t) {
  return t[{ A: "ansi2", M: "ansi3", D: "ansi1", U: "ansi5" }[status] ?? "foreground"];
}

const FILES = {
  "package.json": "node",
  "package-lock.json": "npm-lock",
  "tsconfig.json": "typescript-config",
  "jsconfig.json": "javascript-config",
  "readme.md": "readme",
  "dockerfile": "docker",
  "makefile": "makefile",
  "license": "license",
  "license.md": "license",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git"
};
const EXTENSIONS = {
  "ts": "typescript",
  "mts": "typescript",
  "cts": "typescript",
  "tsx": "react-typescript",
  "js": "javascript",
  "mjs": "javascript",
  "cjs": "javascript",
  "jsx": "react",
  "py": "python",
  "java": "java",
  "rs": "rust",
  "go": "go",
  "json": "json",
  "jsonc": "json",
  "yaml": "yaml",
  "yml": "yaml",
  "toml": "toml",
  "xml": "xml",
  "ini": "config",
  "env": "config",
  "properties": "config",
  "lock": "lock",
  "md": "markdown",
  "mdx": "markdownx",
  "rst": "text",
  "txt": "text",
  "png": "image",
  "jpg": "image",
  "jpeg": "image",
  "gif": "image",
  "webp": "image",
  "svg": "svg",
  "ico": "image",
  "c": "c",
  "h": "c-header",
  "cpp": "cpp",
  "cs": "cs",
  "rb": "ruby",
  "php": "php",
  "sh": "shell",
  "bash": "shell",
  "zsh": "shell",
  "sql": "database",
  "css": "css",
  "scss": "scss",
  "html": "html",
  "vue": "vue",
  "svelte": "svelte",
  "kt": "kotlin",
  "swift": "swift"
};

export function fileAppearance(path) {
  const name = path.split("/").pop().toLowerCase();
  const icon = name.endsWith(".d.ts") ? "typescript-def" : name.startsWith(".env.") ? "config" : FILES[name] ?? EXTENSIONS[name.split(".").pop()] ?? "_file";
  return { icon };
}

const FOLDERS = {
  "src": "folder_source",
  "source": "folder_source",
  "components": "folder_component",
  "test": "folder_test",
  "tests": "folder_test",
  "__tests__": "folder_test",
  "docs": "folder_docs",
  "assets": "folder_assets",
  "config": "folder_config",
  "scripts": "folder_script"
};

export function folderAppearance(path, open) {
  const name = path.split("/").pop().toLowerCase();
  return (FOLDERS[name] ?? "_folder") + (open ? "_open" : "");
}
