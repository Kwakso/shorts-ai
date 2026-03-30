import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { google } from 'googleapis'
import { Readable } from 'stream'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()

  try {
    // 1. 인증 확인
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const { id } = await params

    // 2. 영상 정보 조회
    const { data: video } = await supabase
      .from('videos')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!video) {
      return NextResponse.json({ error: '영상을 찾을 수 없습니다.' }, { status: 404 })
    }

    if (video.status !== 'ready') {
      return NextResponse.json({ error: '업로드 준비가 되지 않았습니다.' }, { status: 400 })
    }

    if (!video.storage_url) {
      return NextResponse.json({ error: '영상 URL이 없습니다.' }, { status: 400 })
    }

    // 3. 채널 조회 (요청 body의 channelId or 기본 채널 or profiles 테이블)
    let accessToken: string | null = null
    let refreshToken: string | null = null

    const body = await req.json().catch(() => ({}))
    const channelId = body?.channelId

    // youtube_channels 테이블에서 먼저 조회
    let channelQuery = supabase
      .from('youtube_channels')
      .select('*')
      .eq('user_id', user.id)

    if (channelId) {
      channelQuery = channelQuery.eq('id', channelId)
    } else {
      channelQuery = channelQuery.eq('is_default', true)
    }

    const { data: channel } = await channelQuery.single()

    if (channel) {
      accessToken = channel.access_token
      refreshToken = channel.refresh_token
    } else {
      // youtube_channels 없으면 profiles 테이블 fallback
      const { data: profile } = await supabase
        .from('profiles')
        .select('yt_access_token, yt_refresh_token, yt_channel_id')
        .eq('id', user.id)
        .single()

      if (!profile?.yt_access_token) {
        return NextResponse.json({ error: 'YouTube 채널 연동이 필요합니다.' }, { status: 400 })
      }

      accessToken = profile.yt_access_token
      refreshToken = profile.yt_refresh_token
    }

    // 4. OAuth 클라이언트 설정
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/youtube/callback`
    )
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    })

    // 토큰 갱신 시 DB 업데이트
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token && channel) {
        await supabase
          .from('youtube_channels')
          .update({
            access_token: tokens.access_token,
            token_expires_at: tokens.expiry_date
              ? new Date(tokens.expiry_date).toISOString()
              : null,
          })
          .eq('id', channel.id)
      }
    })

    // 5. 영상 파일 다운로드
    const videoRes = await fetch(video.storage_url)
    if (!videoRes.ok) throw new Error('영상 파일 다운로드 실패')
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

    // 6. 메타데이터 준비 (#Shorts 보장)
    const title = video.title
      ? (video.title.includes('#Shorts') ? video.title : `${video.title} #Shorts`)
      : `${video.topic} #Shorts`

    const description = video.description
      ? (video.description.includes('#Shorts') ? video.description : `${video.description}\n\n#Shorts #YouTubeShorts`)
      : `${video.topic}\n\n#Shorts #YouTubeShorts`

    const tags = Array.isArray(video.tags)
      ? (video.tags.includes('Shorts') ? video.tags : [...video.tags, 'Shorts', 'YouTubeShorts'])
      : ['Shorts', 'YouTubeShorts']

    // 7. YouTube 업로드 상태 업데이트
    await supabase.from('videos').update({ status: 'uploading' }).eq('id', id)

    // 8. YouTube 업로드
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client })

    const uploadRes = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          tags,
          categoryId: '22',
          defaultLanguage: 'ko',
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        mimeType: 'video/mp4',
        body: Readable.from(videoBuffer),
      },
    })

    const youtubeVideoId = uploadRes.data.id!
    const youtubeUrl = `https://www.youtube.com/shorts/${youtubeVideoId}`

    // 9. DB 업데이트
    await supabase.from('videos').update({
      status: 'published',
      youtube_video_id: youtubeVideoId,
      youtube_url: youtubeUrl,
      ...(channel ? { channel_id: channel.id } : {}),
    }).eq('id', id)

    return NextResponse.json({
      success: true,
      youtubeUrl,
      youtubeVideoId,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[/api/videos/upload]', message)

    const { id } = await params
    await supabase.from('videos')
      .update({ status: 'failed', error_message: message })
      .eq('id', id)

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
