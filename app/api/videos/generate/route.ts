import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateVideoScript } from '@/lib/video-pipeline/gemini'
import { submitKlingJob } from '@/lib/video-pipeline/kling'
import { generateTTS } from '@/lib/video-pipeline/tts'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

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

    // 7. TTS 음성 생성
    let audioUrl: string | null = null
    try {
      const { audioBuffer } = await generateTTS(script.script, language)

      const adminSupabase = createSupabaseAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      const audioFileName = `${video.id}.mp3`
      const { error: uploadError } = await adminSupabase.storage
        .from('audio')
        .upload(audioFileName, audioBuffer, {
          contentType: 'audio/mpeg',
          upsert: true,
        })

      if (!uploadError) {
        const { data: urlData } = adminSupabase.storage
          .from('audio')
          .getPublicUrl(audioFileName)
        audioUrl = urlData.publicUrl

        // audio_url DB 저장
        await supabase.from('videos')
          .update({ audio_url: audioUrl })
          .eq('id', video.id)

        console.log('[TTS] 음성 생성 완료:', audioUrl)
      }
    } catch (ttsErr) {
      console.error('[TTS 생성 실패]', ttsErr)
      // TTS 실패해도 영상 생성은 계속 진행
    }

    // 8. Kling 영상 생성 요청
    const taskId = await submitKlingJob(script.videoPrompt)

    await supabase.from('videos').update({
      sora_job_id: taskId,
      status: 'generating',
      last_polled_at: new Date().toISOString(),
    }).eq('id', video.id)

    return NextResponse.json({
      success: true,
      videoId: video.id,
      taskId,
      audioUrl,
      message: '영상 생성이 시작되었습니다!',
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[/api/videos/generate]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}