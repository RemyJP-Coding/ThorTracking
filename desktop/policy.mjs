export const APP_URL = 'thor-track://app/';

export function isDevelopmentLaunch(args) {
  return args.includes('--dev');
}

export function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'thor-track:' && url.host === 'app' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.ayntec.com' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function restoreWindowState(saved, workAreas) {
  const fallback = { width: 1180, height: 820 };
  if (!saved || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(saved[key]))) {
    return fallback;
  }
  const area = workAreas.find((area) =>
    saved.x >= area.x && saved.y >= area.y && saved.x + 100 <= area.x + area.width && saved.y + 60 <= area.y + area.height,
  );
  if (!area) return fallback;
  const width = Math.min(Math.max(saved.width, 640), area.width);
  const height = Math.min(Math.max(saved.height, 480), area.height);
  return {
    x: Math.min(saved.x, area.x + area.width - width),
    y: Math.min(saved.y, area.y + area.height - height),
    width,
    height,
  };
}
