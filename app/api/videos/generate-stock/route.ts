import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { generateVideoScript } from '@/lib/video-pipeline/gemini'
import { generateTTS } from '@/lib/video-pipeline/tts'
import { searchPexelsVideos, getBestVideoFileUrl } from '@/lib/video-pipeline/pexels'

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
    const { topic, style = 'documentary', language = 'ko' } = await req.json()
    if (!topic?.trim()) {
      return NextResponse.json({ error: '주제를 입력해 주세요.' }, { status: 400 })
    }

    // 4. videos 레코드 생성
    const { data: video, error: insertError } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        topic,
        style,
        language,
        status: 'draft',
        video_type: 'stock',
      })
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
      description: `스톡 영상 생성: ${topic}`,
      reference_id: video.id,
    })

    // 6. Gemini 스크립트 + 검색 키워드 생성
    await supabase.from('videos').update({ status: 'generating' }).eq('id', video.id)
    const script = await generateVideoScript(topic, style, language)

    await supabase.from('videos').update({
      title: script.title,
      description: script.description,
      script: script.script,
      video_prompt: script.videoPrompt,
      tags: script.tags,
    }).eq('id', video.id)

    console.log('[Stock] 검색 키워드:', script.searchKeywords)

    const adminSupabase = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 7. TTS 음성 생성
    let audioUrl: string | null = null
    try {
      const { audioBuffer } = await generateTTS(script.script, language)

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

        await supabase.from('videos')
          .update({ audio_url: audioUrl })
          .eq('id', video.id)

        console.log('[TTS] 음성 생성 완료:', audioUrl)
      }
    } catch (ttsErr) {
      console.error('[TTS 생성 실패]', ttsErr)
    }

    // 8. Pexels 스톡 영상 검색
    const keywords = script.searchKeywords ?? [topic, style]
    const stockVideos = await searchPexelsVideos(keywords, 5)

    if (stockVideos.length === 0) {
      // 키워드로 못 찾으면 일반 검색
      const fallbackVideos = await searchPexelsVideos(['nature', 'lifestyle', 'people'], 3)
      stockVideos.push(...fallbackVideos)
    }

    const videoUrls = stockVideos.map(v => getBestVideoFileUrl(v))
    console.log('[Pexels] 스톡 영상 검색 완료:', videoUrls.length, '개')

    // 9. 스톡 영상 URL 저장 및 상태 업데이트
    // 첫 번째 영상을 대표 영상으로 저장 (ffmpeg 합성 전 임시)
    const primaryVideoUrl = videoUrls[0] ?? null

    await supabase.from('videos').update({
      storage_url: primaryVideoUrl,
      status: 'ready',  // ffmpeg 합성 완료 전까지 ready로 설정
      // 추후 ffmpeg 합성 후 최종 영상으로 교체
    }).eq('id', video.id)

    // Supabase Edge Function으로 ffmpeg 합성 요청 (비동기)
    if (audioUrl && videoUrls.length > 0) {
      try {
        adminSupabase.functions.invoke('compose-video', {
          body: {
            videoId: video.id,
            audioUrl,
            videoUrls,
            script: script.script,
          },
        }).then(({ error }) => {
          if (error) console.error('[compose-video] Edge Function 오류:', error)
          else console.log('[compose-video] 합성 요청 완료')
        })
      } catch (fnErr) {
        console.error('[compose-video] 호출 실패:', fnErr)
      }
    }

    return NextResponse.json({
      success: true,
      videoId: video.id,
      audioUrl,
      videoUrls,
      primaryVideoUrl,
      message: `스톡 영상 ${stockVideos.length}개 검색 완료!`,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[/api/videos/generate-stock]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}