import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export interface ScriptResult {
  title: string
  description: string
  script: string
  videoPrompt: string
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
      maxOutputTokens: 2048,
      temperature: 0.8,
      responseMimeType: 'application/json',  // JSON 응답 강제
    },
  })

  const prompt = `당신은 YouTube Shorts 콘텐츠 크리에이터이자 AI 영상 전문가입니다.
  주제: "${topic}"
  스타일: ${style}
  언어: ${language === 'ko' ? '한국어' : 'English'}

  아래 JSON만 출력하세요:
  {
    "title": "제목 (50자 이내, #Shorts 포함)",
    "description": "설명 (200자 이내, 해시태그 포함)",
    "script": "나레이션 (100자 이내)",
    "videoPrompt": "Extremely detailed cinematic vertical 9:16 video prompt in English for ${style} style. Include: specific subject description, professional lighting setup (golden hour/studio/natural), camera movement (slow zoom/pan/dolly), color grading (warm/cool/cinematic), background details, emotional atmosphere, visual composition. Make it photorealistic and high quality. 80-100 words minimum.",
    "tags": ["태그1", "태그2", "Shorts", "YouTubeShorts"]
  }`

  const result = await model.generateContent(prompt)
  const text = result.response.text().replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(text) as ScriptResult
  } catch {
    throw new Error(`Gemini 응답 파싱 실패: ${text.slice(0, 500)}`)
  }
}