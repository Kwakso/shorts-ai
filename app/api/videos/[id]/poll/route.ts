import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pollKlingJob } from '@/lib/video-pipeline/kling'

export async function GET(
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

    // 2. 영상 조회
    const { data: video } = await supabase
      .from('videos')
      .select('id, sora_job_id, status, polling_attempts')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!video) {
      return NextResponse.json({ error: '영상을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 3. 이미 완료된 경우 바로 반환
    if (video.status === 'ready' || video.status === 'failed' || video.status === 'published') {
      return NextResponse.json({ status: video.status })
    }

    // 4. Kling 상태 확인
    if (!video.sora_job_id) {
      return NextResponse.json({ status: video.status })
    }

    const result = await pollKlingJob(video.sora_job_id)

    // 5. 상태 업데이트
    if (result.status === 'succeed' && result.videoUrl) {
      await supabase.from('videos').update({
        status: 'ready',
        storage_url: result.videoUrl,
        polling_attempts: video.polling_attempts + 1,
        last_polled_at: new Date().toISOString(),
      }).eq('id', video.id)

      return NextResponse.json({ status: 'ready', videoUrl: result.videoUrl })

    } else if (result.status === 'failed') {
      await supabase.from('videos').update({
        status: 'failed',
        error_message: result.errorMessage ?? '영상 생성 실패',
        polling_attempts: video.polling_attempts + 1,
      }).eq('id', video.id)

      return NextResponse.json({ status: 'failed', error: result.errorMessage })

    } else {
      // 아직 처리 중
      await supabase.from('videos').update({
        polling_attempts: video.polling_attempts + 1,
        last_polled_at: new Date().toISOString(),
      }).eq('id', video.id)

      return NextResponse.json({ status: 'generating' })
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[/api/videos/poll]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}