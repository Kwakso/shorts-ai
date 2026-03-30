import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateVideoScript } from '@/lib/video-pipeline/gemini'
import { submitKlingJob } from '@/lib/video-pipeline/kling'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  try {
    // 1. 인증 확인
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 2. 요청 파싱
    const { topics, style = 'cinematic', language = 'ko' } = await req.json()
    
    if (!Array.isArray(topics) || topics.length === 0) {
      return NextResponse.json({ error: '주제 목록이 비어있습니다.' }, { status: 400 })
    }

    if (topics.length > 20) {
      return NextResponse.json({ error: '한 번에 최대 20개까지 생성 가능합니다.' }, { status: 400 })
    }

    // 3. 크레딧 확인
    const { data: creditData } = await supabase
      .from('credit_transactions')
      .select('balance_after')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const balance = creditData?.balance_after ?? 0
    if (balance < topics.length) {
      return NextResponse.json({
        error: `크레딧이 부족합니다. 필요: ${topics.length}개, 보유: ${balance}개`
      }, { status: 402 })
    }

    // 4. 배치 처리 결과
    const results: { topic: string; videoId: string; success: boolean; error?: string }[] = []

    for (const topic of topics) {
      if (!topic?.trim()) continue

      try {
        // DB 레코드 생성
        const { data: video, error: insertError } = await supabase
          .from('videos')
          .insert({
            user_id: user.id,
            topic: topic.trim(),
            style,
            language,
            status: 'draft',
          })
          .select()
          .single()

        if (insertError || !video) throw new Error('DB 삽입 실패')

        // 크레딧 차감
        await supabase.from('credit_transactions').insert({
          user_id: user.id,
          type: 'usage',
          amount: -1,
          balance_after: balance - results.length - 1,
          description: `배치 영상 생성: ${topic.trim()}`,
          reference_id: video.id,
        })

        // Gemini 스크립트 생성
        await supabase.from('videos').update({ status: 'generating' }).eq('id', video.id)
        const script = await generateVideoScript(topic.trim(), style, language)

        await supabase.from('videos').update({
          title: script.title,
          description: script.description,
          script: script.script,
          video_prompt: script.videoPrompt,
          tags: script.tags,
        }).eq('id', video.id)

        // Kling 영상 생성 요청
        const taskId = await submitKlingJob(script.videoPrompt)

        await supabase.from('videos').update({
          sora_job_id: taskId,
          status: 'generating',
          last_polled_at: new Date().toISOString(),
        }).eq('id', video.id)

        results.push({ topic: topic.trim(), videoId: video.id, success: true })

        // API 레이트 리밋 방지 (1초 대기)
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (err) {
        const message = err instanceof Error ? err.message : '알 수 없는 오류'
        results.push({ topic: topic.trim(), videoId: '', success: false, error: message })
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length

    return NextResponse.json({
      success: true,
      total: topics.length,
      successCount,
      failCount,
      results,
      message: `${successCount}개 영상 생성 시작, ${failCount}개 실패`,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[/api/videos/batch]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}