import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

// ─── 스타일별 전용 프롬프트 ───────────────────────────────────
const STYLE_PROMPTS: Record<string, string> = {
  cinematic:   'Cinematic film quality, anamorphic lens, shallow depth of field, professional color grading, dramatic lighting, movie-like composition, Hollywood style',
  documentary: 'Documentary style, natural lighting, handheld camera feel, authentic atmosphere, realistic environment, journalistic approach, observational filmmaking',
  anime:       'Anime style, vibrant saturated colors, detailed character design, dynamic motion blur, Japanese animation aesthetic, expressive visuals, Studio Ghibli inspired',
  realistic:   'Photorealistic, 8K resolution, ultra detailed textures, professional DSLR photography, sharp focus, natural golden hour lighting, lifelike',
  cartoon:     'Colorful cartoon style, bold clean outlines, exaggerated fun expressions, energetic movement, bright saturated colors, Pixar-like quality',
  abstract:    'Abstract art style, flowing organic shapes, vibrant neon colors, surreal dreamlike composition, artistic visual effects, mesmerizing patterns',
}

export interface ScriptResult {
  title: string
  description: string
  script: string
  videoPrompt: string
  searchKeywords: string[]
  tags: string[]
}

export async function generateVideoScript(
  topic: string,
  style: string,
  language: string = 'ko'
): Promise<ScriptResult> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.7,
    },
  })

  const styleGuide = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.cinematic

  const prompt = `YouTube Shorts 콘텐츠를 만들어주세요.
주제: "${topic}"
스타일: ${style}
언어: ${language === 'ko' ? '한국어' : 'English'}

반드시 아래 JSON만 출력하세요. 마크다운이나 코드블록 없이 순수 JSON만:
{"title":"제목(50자이내,#Shorts포함)","description":"설명(150자이내,해시태그포함)","script":"나레이션(80자이내,핵심만간결하게)","videoPrompt":"${styleGuide}. Vertical 9:16 format. Ultra detailed scene description for AI video generation about ${topic}: specific subjects, precise lighting setup, camera angle and movement, color palette, background environment, emotional atmosphere, cinematic composition. 80-100 words in English.","searchKeywords":["영어키워드1","영어키워드2","영어키워드3","영어키워드4","영어키워드5"],"tags":["태그1","태그2","Shorts","YouTubeShorts","쇼츠"]}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text()

  // 코드블록 제거 후 JSON 추출
  const cleaned = raw.replace(/```json\n?|```\n?/g, '').trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)

  if (!jsonMatch) {
    throw new Error(`JSON을 찾을 수 없습니다: ${raw.slice(0, 200)}`)
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as ScriptResult

    // searchKeywords 없으면 기본값 설정
    if (!parsed.searchKeywords || parsed.searchKeywords.length === 0) {
      parsed.searchKeywords = [topic, style, 'nature', 'lifestyle', 'korea']
    }

    return parsed
  } catch {
    throw new Error(`Gemini 응답 파싱 실패: ${jsonMatch[0].slice(0, 200)}`)
  }
}
