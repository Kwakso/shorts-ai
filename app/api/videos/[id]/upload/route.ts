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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const { id } = await params

    // 영상 정보 조회
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

    // 프로필에서 YouTube 토큰 조회
    const { data: profile } = await supabase
      .from('profiles')
      .select('yt_access_token, yt_refresh_token, yt_channel_id')
      .eq('id', user.id)
      .single()

    if (!profile?.yt_access_token) {
      return NextResponse.json({ error: 'YouTube 채널 연동이 필요합니다.' }, { status: 400 })
    }

    // OAuth 클라이언트 설정
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/youtube/callback`
    )
    oauth2Client.setCredentials({
      access_token: profile.yt_access_token,
      refresh_token: profile.yt_refresh_token,
    })

    // 영상 파일 다운로드
    const videoRes = await fetch(video.storage_url)
    if (!videoRes.ok) throw new Error('영상 파일 다운로드 실패')
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

    // #Shorts 태그 보장
    const title = video.title || `${video.topic} #Shorts`
    const description = video.description || `${video.topic}\n\n#Shorts #YouTubeShorts`
    const tags = video.tags || ['Shorts', 'YouTubeShorts']

    // YouTube 업로드
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client })
    
    await supabase.from('videos').update({ status: 'uploading' }).eq('id', id)

    const uploadRes = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title.includes('#Shorts') ? title : `${title} #Shorts`,
          description: description.includes('#Shorts')
            ? description
            : `${description}\n\n#Shorts #YouTubeShorts`,
          tags: tags.includes('Shorts') ? tags : [...tags, 'Shorts', 'YouTubeShorts'],
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

    // DB 업데이트
    await supabase.from('videos').update({
      status: 'published',
      youtube_video_id: youtubeVideoId,
      youtube_url: youtubeUrl,
    }).eq('id', id)

    return NextResponse.json({
      success: true,
      youtubeUrl,
      youtubeVideoId,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[/api/videos/upload]', message)
    
    await supabase.from('videos')
      .update({ status: 'failed', error_message: message })
      .eq('id', (await params).id)

    return NextResponse.json({ error: message }, { status: 500 })
  }
}