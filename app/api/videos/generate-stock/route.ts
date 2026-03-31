import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateVideoScript } from '@/lib/video-pipeline/gemini'
import { generateTTS } from '@/lib/video-pipeline/tts'
import { searchPexelsVideos, getBestVideoFile } from '@/lib/video-pipeline/pexels'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const { data: creditData } = await supabase
      .from('credit_transactions')
      .select('balance_after')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const balance = creditData?.balance_after ?? 0
    if (balance < 1) return NextResponse.json({ error: '크레딧 부족' }, { status: 402 })

    const { topic, style = 'documentary', language = 'ko' } = await req.json()
    if (!topic?.trim()) return NextResponse.json({ error: '주제 필요' }, { status: 400 })

    // DB 레코드 생성
    const { data: video } = await supabase
      .from('videos')
      .insert({ user_id: user.id, topic, style, language, status: 'draft', video_type: 'stock' })
      .select()
      .single()

    if (!video) throw new Error('DB 삽입 실패')

    // 크레딧 차감
    await supabase.from('credit_transactions').insert({
      user_id: user.id,
      type: 'usage',
      amount: -1,
      balance_after: balance - 1,
      description: `스톡 영상 생성: ${topic}`,
      reference_id: video.id,
    })

    // Gemini 스크립트 생성
    await supabase.from('videos').update({ status: 'generating' }).eq('id', video.id)
    const script = await generateVideoScript(topic, style, language)

    await supabase.from('videos').update({
      title: script.title,
      description: script.description,
      script: script.script,
      video_prompt: script.videoPrompt,
      tags: script.tags,
    }).eq('id', video.id)

    // TTS 음성 생성
    const adminSupabase = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { audioBuffer } = await generateTTS(script.script, language)
    const audioFileName = `${video.id}.mp3`
    await adminSupabase.storage.from('audio').upload(audioFileName, audioBuffer, {
      contentType: 'audio/mpeg',
      upsert: true,
    })
    const { data: audioUrlData } = adminSupabase.storage.from('audio').getPublicUrl(audioFileName)
    const audioUrl = audioUrlData.publicUrl

    await supabase.from('videos').update({ audio_url: audioUrl }).eq('id', video.id)

    // Pexels 스톡 영상 검색
    const keywords = (script as any).searchKeywords ?? [topic, style]
    const stockVideos = await searchPexelsVideos(keywords, 5)
    const videoUrls = stockVideos.map(v => getBestVideoFile(v))

    // Supabase Edge Function 호출 (합성)
    const { data: fnData, error: fnError } = await adminSupabase.functions.invoke('compose-video', {
      body: {
        videoId: video.id,
        audioUrl,
        videoUrls,
        script: script.script,
      },
    })

    if (fnError) throw fnError

    return NextResponse.json({
      success: true,
      videoId: video.id,
      audioUrl,
      videoUrls,
      message: '스톡 영상 생성 완료!',
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : '오류'
    console.error('[/api/videos/generate-stock]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}