import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
    try {
          const { searchParams } = new URL(req.url)
          const code = searchParams.get('code')
          const state = searchParams.get('state')
          const error = searchParams.get('error')

          const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get('host')}`

          if (error || !code) {
                  return NextResponse.redirect(`${appUrl}/dashboard/settings?error=calendar_denied`)
                }

          let userEmail: string
          try {
                  const decoded = JSON.parse(Buffer.from(state!, 'base64').toString())
                  userEmail = decoded.email
                } catch {
                  return NextResponse.redirect(`${appUrl}/dashboard/settings?error=invalid_state`)
                }

          const redirectUri = `${appUrl}/api/integrations/google-calendar/callback`

          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({
                            code,
                            client_id: process.env.GOOGLE_CLIENT_ID!,
                            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                            redirect_uri: redirectUri,
                            grant_type: 'authorization_code',
                          }),
                })

          if (!tokenRes.ok) {
                  const err = await tokenRes.text()
                  console.error('Token exchange failed:', err)
                  return NextResponse.redirect(`${appUrl}/dashboard/settings?error=token_exchange_failed`)
                }

          const tokens = await tokenRes.json()

          const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                  headers: { Authorization: `Bearer ${tokens.access_token}` },
                })
          const userInfo = await userInfoRes.json()

          const { data: practice } = await supabaseAdmin
            .from('practices')
            .select('id')
            .eq('notification_email', userEmail)
            .single()

          if (!practice) {
                  return NextResponse.redirect(`${appUrl}/dashboard/settings?error=practice_not_found`)
                }

          await supabaseAdmin.from('practices').update({
                  google_calendar_token: {
                            access_token: tokens.access_token,
                            refresh_token: tokens.refresh_token,
                            expiry_date: Date.now() + (tokens.expires_in * 1000),
                            token_type: tokens.token_type,
                            scope: tokens.scope,
                          },
                  google_calendar_email: userInfo.email,
                }).eq('id', practice.id)

          return NextResponse.redirect(`${appUrl}/dashboard/settings?success=calendar_connected`)
        } catch (error: any) {
          console.error('Calendar callback error:', error)
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get('host')}`
          return NextResponse.redirect(`${appUrl}/dashboard/settings?error=callback_error`)
        }
  }
