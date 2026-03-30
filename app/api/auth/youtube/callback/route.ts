import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { google } from 'googleapis'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?yt_error=1`
    )
  }

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/youtube/callback`
    )

    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // 채널 정보 조회
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client })
    const channelRes = await youtube.channels.list({
      part: ['id', 'snippet'],
      mine: true,
    })
    const channel = channelRes.data.items?.[0]
    if (!channel) throw new Error('YouTube 채널을 찾을 수 없습니다.')

    // youtube_channels 테이블에 저장 (중복이면 업데이트)
    const { error: upsertError } = await supabase
      .from('youtube_channels')
      .upsert({
        user_id: user.id,
        channel_id: channel.id!,
        channel_name: channel.snippet?.title ?? '알 수 없음',
        channel_thumbnail: channel.snippet?.thumbnails?.default?.url,
        access_token: tokens.access_token!,
        refresh_token: tokens.refresh_token ?? undefined,
        token_expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
      }, {
        onConflict: 'user_id,channel_id',
      })

    if (upsertError) throw upsertError

    // 첫 번째 채널이면 기본 채널로 설정
    const { count } = await supabase
      .from('youtube_channels')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (count === 1) {
      await supabase
        .from('youtube_channels')
        .update({ is_default: true })
        .eq('user_id', user.id)
        .eq('channel_id', channel.id!)
    }

    // 기존 profiles 테이블도 업데이트 (하위 호환)
    await supabase.from('profiles').update({
      yt_channel_id: channel.id,
      yt_channel_name: channel.snippet?.title,
      yt_access_token: tokens.access_token,
      yt_refresh_token: tokens.refresh_token,
      yt_token_expires_at: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
    }).eq('id', user.id)

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?yt_connected=1`
    )
  } catch (err) {
    console.error('[YouTube OAuth Callback]', err)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?yt_error=1`
    )
  }
}