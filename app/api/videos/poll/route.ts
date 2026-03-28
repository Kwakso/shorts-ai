import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { pollKlingJob } from '@/lib/video-pipeline/kling'

const MAX_ATTEMPTS = 40 // 40회 * 1분 = 40분 타임아웃

export async function GET(req: NextRequest) {
  // Cron Secret 검증
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 폴링 대상 조회
  const { data: pendingVideos } = await supabase
    .from('videos')
    .select('id, sora_job_id, polling_attempts')
    .eq('status', 'generating')
    .not('sora_job_id', 'is', null)
    .lt('polling_attempts', MAX_ATTEMPTS)
    .limit(20)

  if (!pendingVideos?.length) {
    return NextResponse.json({ processed: 0 })
  }

  const results = await Promise.allSettled(
    pendingVideos.map(async (video) => {
      const result = await pollKlingJob(video.sora_job_id!)

      if (result.status === 'succeed' && result.videoUrl) {
        await supabase.from('videos').update({
          status: 'ready',
          storage_url: result.videoUrl,
          polling_attempts: video.polling_attempts + 1,
          last_polled_at: new Date().toISOString(),
        }).eq('id', video.id)

      } else if (result.status === 'failed') {
        await supabase.from('videos').update({
          status: 'failed',
          error_message: result.errorMessage ?? '영상 생성 실패',
          polling_attempts: video.polling_attempts + 1,
        }).eq('id', video.id)

      } else {
        const newAttempts = video.polling_attempts + 1
        await supabase.from('videos').update({
          polling_attempts: newAttempts,
          last_polled_at: new Date().toISOString(),
          ...(newAttempts >= MAX_ATTEMPTS ? {
            status: 'failed',
            error_message: '영상 생성 시간 초과'
          } : {}),
        }).eq('id', video.id)
      }
    })
  )

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  return NextResponse.json({ processed: pendingVideos.length, succeeded })
}