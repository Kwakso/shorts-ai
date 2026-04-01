import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

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
      maxOutputTokens: 4096,
      temperature: 0.7,
      responseMimeType: 'application/json',
    },
  })

  const styleGuide = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.realistic
  const lang = language === 'ko' ? '한국어' : 'English' // ← lang 변수 선언

  const prompt = `주제:"${topic}" 스타일:${style} 언어:${lang}

다음 JSON 형식으로만 응답하세요:
{
  "title": "#Shorts 포함 20자 이내 제목",
  "description": "50자 이내 설명 해시태그 포함",
  "script": "30자 이내 나레이션",
  "videoPrompt": "${styleGuide} vertical 9:16 about ${topic} 20 words",
  "searchKeywords": ["영어키워드1", "영어키워드2", "영어키워드3"],
  "tags": ["한국어태그", "Shorts", "YouTubeShorts"]
}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text()
  console.log('[Gemini 전체 응답]:', raw)

  // 코드블록 제거 후 JSON 추출
  const cleaned = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim()

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`JSON을 찾을 수 없습니다: ${raw.slice(0, 200)}`)
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as ScriptResult

    if (!parsed.searchKeywords || parsed.searchKeywords.length === 0) {
      parsed.searchKeywords = [topic, style, 'nature', 'lifestyle', 'korea']
    }

    return parsed
  } catch {
    throw new Error(`Gemini 응답 파싱 실패: ${jsonMatch[0].slice(0, 200)}`)
  }
}