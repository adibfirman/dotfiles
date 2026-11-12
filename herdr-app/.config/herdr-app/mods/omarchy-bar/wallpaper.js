import { exec, appHome, layout, home, settings, readTextFile, window } from "herdr";

export const desktopDirectory = () => `${home()}/.local/state/omarchy/current`;

const cache = () => `${appHome()}/backgrounds/desktop`;

// Copies the picture into backgrounds/desktop/ (the layout only takes paths in the app home).
// Its type comes from its first bytes: GNOME's ~/.config/background and Windows' TranscodedWallpaper have no extension.
// Named by content, so an edited file at the same path still changes; only the current one stays.
async function cached(src) {
  if (window()?.platform === "windows") return cachedOnWindows(src);
  const script = `
    src=$(readlink -f "$1") || exit 1
    magic=$(od -An -tx1 -N12 "$src" | tr -d ' \n') || exit 1
    case "$magic" in
      89504e47*) ext=png ;;
      ffd8ff*) ext=jpg ;;
      52494646????????57454250) ext=webp ;;
      *) exit 1 ;;
    esac
    hash=$(sha256sum < "$src") || exit 1
    hash=\${hash%% *}
    file="$2/current-$hash.$ext"
    mkdir -p "$2" || exit 1
    if [ ! -f "$file" ]; then cp -- "$src" "$file" || exit 1; fi
    for old in "$2"/current-*; do
      if [ "$old" != "$file" ] && [ -f "$old" ]; then rm -f -- "$old"; fi
    done
    printf 'backgrounds/desktop/current-%s.%s' "$hash" "$ext"
  `;
  const r = await exec("sh", ["-c", script, "sh", src, cache()]).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : null;
}

async function cachedOnWindows(src) {
  const quote = (s) => `'${s.replace(/'/g, "''")}'`;
  const script = `
    $ErrorActionPreference = 'Stop'
    $src = ${quote(src)}; $dir = ${quote(cache())}
    $bytes = New-Object byte[] 12
    $stream = [IO.File]::OpenRead($src); [void]$stream.Read($bytes, 0, 12); $stream.Close()
    $magic = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    if ($magic.StartsWith('89504e47')) { $ext = 'png' }
    elseif ($magic.StartsWith('ffd8ff')) { $ext = 'jpg' }
    elseif ($magic.StartsWith('52494646') -and $magic.EndsWith('57454250')) { $ext = 'webp' }
    else { exit 1 }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $src).Hash.ToLower()
    $name = "current-$hash.$ext"; $file = Join-Path $dir $name
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    if (-not (Test-Path -LiteralPath $file)) { Copy-Item -LiteralPath $src -Destination $file }
    Get-ChildItem -LiteralPath $dir -Filter 'current-*' -File | Where-Object { $_.Name -ne $name } | Remove-Item -Force
    [Console]::Out.Write("backgrounds/desktop/$name")
  `;
  const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : null;
}

const omarchyLink = async () => {
  const r = await exec("test", ["-e", `${desktopDirectory()}/background`]).catch(() => null);
  return r?.code === 0 ? `${desktopDirectory()}/background` : null;
};

// settings.json's "follow_desktop_wallpaper": off unless set (Omarchy follows either way).
async function following() {
  try {
    return JSON.parse((await readTextFile(`${appHome()}/settings.json`)) ?? "{}").follow_desktop_wallpaper === true;
  } catch {
    return false;
  }
}

async function gnomeWallpaper() {
  const get = async (key) => {
    const r = await exec("gsettings", ["get", ...key]).catch(() => null);
    return r?.code === 0 ? r.stdout.trim().replace(/^'|'$/g, "") : "";
  };
  const dark = (await get(["org.gnome.desktop.interface", "color-scheme"])) === "prefer-dark";
  const uri = (dark && (await get(["org.gnome.desktop.background", "picture-uri-dark"]))) || (await get(["org.gnome.desktop.background", "picture-uri"]));
  if (!uri.startsWith("file://")) return null;
  try {
    return decodeURIComponent(new URL(uri).pathname);
  } catch {
    return null;
  }
}

// Through PowerShell in UTF-8: reg.exe prints in the console's code page, which garbles accented paths.
async function windowsWallpaper() {
  const script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write((Get-ItemProperty 'HKCU:\\Control Panel\\Desktop').WallPaper)";
  const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]).catch(() => null);
  return (r?.code === 0 && r.stdout.trim()) || null;
}

// Where the desktop's picture is: Omarchy's link, or, when asked, GNOME's or Windows' setting.
// macOS is left out: it asks permission first, and its built-in pictures are HEIC.
async function desktopSource() {
  const omarchy = await omarchyLink();
  if (omarchy) return { omarchy: true, path: omarchy };
  if (!(await following())) return null;
  const platform = window()?.platform;
  const path = platform === "windows" ? await windowsWallpaper() : platform === "linux" ? await gnomeWallpaper() : null;
  return path ? { omarchy: false, path } : null;
}

async function desktopWallpaper() {
  const source = await desktopSource();
  return source ? cached(source.path) : null;
}

let updating = Promise.resolve();

export function matchWallpaper(name) {
  updating = updating.catch(() => {}).then(async () => {
    const desktop = await desktopWallpaper();
    if (desktop) {
      if (layout()?.background?.image !== desktop) await setWallpaper(desktop);
      return;
    }
    if (layout()?.background?.image?.startsWith(`backgrounds/omarchy/${name}/`)) return;
    const [first] = await wallpapers(name);
    if (first && settings().theme === name) await setWallpaper(first);
  });
  return updating;
}

// Omarchy: its own next wallpaper. Another desktop being followed: nothing (Herdr leaves the system's alone).
export async function nextWallpaper() {
  const source = await desktopSource();
  if (source?.omarchy) {
    await exec("omarchy-theme-bg-next", []).catch(() => null);
    return;
  }
  if (source && (await cached(source.path))) return;
  const all = await wallpapers(settings().theme);
  if (!all.length) return;
  await setWallpaper(all[(all.indexOf(layout()?.background?.image) + 1) % all.length]);
}

// A theme's wallpapers: backgrounds/omarchy/<theme>/, in name order. None: [].
export async function wallpapers(name) {
  const dir = `backgrounds/omarchy/${name}`;
  const r = await exec("ls", ["-1", `${appHome()}/${dir}`]).catch(() => null);
  if (r?.code !== 0) return [];
  return r.stdout.split("\n").filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).map((f) => `${dir}/${f}`);
}

// Through the CLI: run() refuses an argument nested deeper than 16 levels, and this layout's tree is deeper.
export async function setWallpaper(image) {
  const l = layout();
  if (!l) return;
  await exec("herdr-app", ["do", "layout.set", JSON.stringify({ layout: { ...l, background: { ...l.background, image } } })]);
}
