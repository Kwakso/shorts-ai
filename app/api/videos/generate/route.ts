import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateVideoScript } from '@/lib/video-pipeline/gemini'
import { submitKlingJob } from '@/lib/video-pipeline/kling'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  try {
    // 1. 인증 확인
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 2. 크레딧 확인
    const { data: creditData } = await supabase
      .from('credit_transactions')
      .select('balance_after')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const balance = creditData?.balance_after ?? 0
    if (balance < 1) {
      return NextResponse.json({ error: '크레딧이 부족합니다.' }, { status: 402 })
    }

    // 3. 요청 파싱
    const { topic, style = 'cinematic', language = 'ko' } = await req.json()
    if (!topic?.trim()) {
      return NextResponse.json({ error: '주제를 입력해 주세요.' }, { status: 400 })
    }

    // 4. videos 레코드 생성
    const { data: video, error: insertError } = await supabase
      .from('videos')
      .insert({ user_id: user.id, topic, style, language, status: 'draft' })
      .select()
      .single()

    if (insertError || !video) {
      throw new Error(`DB 삽입 실패: ${insertError?.message}`)
    }

    // 5. 크레딧 차감
    await supabase.from('credit_transactions').insert({
      user_id: user.id,
      type: 'usage',
      amount: -1,
      balance_after: balance - 1,
      description: `영상 생성: ${topic}`,
      reference_id: video.id,
    })

    // 6. Gemini 스크립트 생성
    await supabase.from('videos').update({ status: 'generating' }).eq('id', video.id)
    const script = await generateVideoScript(topic, style, language)

    await supabase.from('videos').update({
      title: script.title,
      description: script.description,
      script: script.script,
      video_prompt: script.videoPrompt,
      tags: script.tags,
    }).eq('id', video.id)

    // 6. Gemini 스크립트 생성 (임시 Mock - 할당량 초과로 인해)
    /*const script = {
      title: `${topic} #Shorts`,
      description: `${topic}에 관한 흥미로운 쇼츠 영상입니다. #Shorts #YouTubeShorts`,
      script: `${topic}에 대해 알아봅시다.`,
      videoPrompt: `A ${style} style vertical 9:16 short video about ${topic}. High quality, cinematic.`,
      tags: ['Shorts', 'YouTubeShorts', style],
    }*/

    // 7. Kling 영상 생성 요청
    const taskId = await submitKlingJob(script.videoPrompt)

    await supabase.from('videos').update({
      sora_job_id: taskId,
      status: 'generating',  // ← 이거 추가
      last_polled_at: new Date().toISOString(),
    }).eq('id', video.id)

    return NextResponse.json({
      success: true,
      videoId: video.id,
      taskId,
      message: '영상 생성이 시작되었습니다!',
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[/api/videos/generate]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}