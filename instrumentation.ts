// Next.js instrumentation hook — initializes Sentry on the server and edge runtimes.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = async (...args: unknown[]) => {
  const Sentry = await import('@sentry/nextjs')
  // @ts-expect-error — Sentry types lag behind Next.js instrumentation API
  return Sentry.captureRequestError(...args)
}
