/**
 * Capacitor native platform utilities.
 *
 * These wrappers are SAFE to import in any environment — they fall back
 * to web behavior when running outside Capacitor (i.e., normal browser).
 *
 * Not yet used in the codebase. Pre-positioned for the post-EIN mobile
 * build pipeline (`cap add ios && cap add android`).
 */

let _capacitor: typeof import('@capacitor/core').Capacitor | null = null

function getCapacitor() {
  if (_capacitor !== null) return _capacitor
  try {
    // Dynamic import — won't blow up if @capacitor/core isn't installed yet
    const mod = require('@capacitor/core') as typeof import('@capacitor/core')
    _capacitor = mod.Capacitor
    return _capacitor
  } catch {
    _capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' } as any
    return _capacitor
  }
}

export function isNativePlatform(): boolean {
  return Boolean(getCapacitor()?.isNativePlatform?.())
}

export function getPlatform(): 'ios' | 'android' | 'web' {
  const platform = getCapacitor()?.getPlatform?.() ?? 'web'
  if (platform === 'ios' || platform === 'android') return platform
  return 'web'
}

export function isIos(): boolean {
  return getPlatform() === 'ios'
}

export function isAndroid(): boolean {
  return getPlatform() === 'android'
}

export function isWeb(): boolean {
  return getPlatform() === 'web'
}
